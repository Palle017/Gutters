import {DatabaseSync} from 'node:sqlite';
import {mkdirSync} from 'node:fs';
import {dirname} from 'node:path';
import {randomUUID} from 'node:crypto';
import {QUESTIONS,PHOTO_MAX_COUNT,sha,equal,fail} from './protocol.mjs';

const SCHEMA=`
CREATE TABLE IF NOT EXISTS schema_version(version INTEGER PRIMARY KEY CHECK(version=1));
INSERT OR IGNORE INTO schema_version(version) VALUES(1);
CREATE TABLE IF NOT EXISTS conversations(
 id TEXT PRIMARY KEY, token_hash TEXT NOT NULL, initial_operation TEXT NOT NULL, initial_hash TEXT NOT NULL,
 name TEXT NOT NULL, phone TEXT NOT NULL, answers_json TEXT NOT NULL,
 created_at TEXT NOT NULL, expires_at TEXT NOT NULL, revoked_at TEXT
);
CREATE TABLE IF NOT EXISTS quote_details(
 conversation_id TEXT PRIMARY KEY REFERENCES conversations(id),
 address TEXT, size_of_home TEXT, stories INTEGER CHECK(stories IS NULL OR stories IN(1,2)), gutter_length TEXT
);
CREATE TABLE IF NOT EXISTS messages(
 id TEXT PRIMARY KEY, conversation_id TEXT NOT NULL REFERENCES conversations(id), sequence INTEGER NOT NULL CHECK(sequence>0),
 role TEXT NOT NULL CHECK(role IN('guide','customer','owner')), body TEXT NOT NULL, created_at TEXT NOT NULL,
 operation_id TEXT NOT NULL, part INTEGER NOT NULL, UNIQUE(conversation_id,sequence), UNIQUE(conversation_id,operation_id,part)
);
CREATE TABLE IF NOT EXISTS operations(
 conversation_id TEXT NOT NULL REFERENCES conversations(id), operation_id TEXT NOT NULL,
 content_hash TEXT NOT NULL, actor TEXT NOT NULL CHECK(actor IN('create','customer','owner')),
 message_id TEXT NOT NULL REFERENCES messages(id), sequence INTEGER NOT NULL, created_at TEXT NOT NULL,
 PRIMARY KEY(conversation_id,operation_id)
);
CREATE TABLE IF NOT EXISTS rate_limits(bucket TEXT PRIMARY KEY,window_start INTEGER NOT NULL,count INTEGER NOT NULL);
CREATE INDEX IF NOT EXISTS conversations_created ON conversations(created_at DESC,id);
CREATE INDEX IF NOT EXISTS messages_conversation ON messages(conversation_id,sequence);
CREATE TABLE IF NOT EXISTS photos(
 id TEXT PRIMARY KEY,conversation_id TEXT NOT NULL REFERENCES conversations(id),filename TEXT NOT NULL,
 mime TEXT NOT NULL,size INTEGER NOT NULL CHECK(size>0 AND size<=5242880),bytes BLOB NOT NULL,created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS photos_conversation ON photos(conversation_id,created_at,id);
CREATE TABLE IF NOT EXISTS estimates(
 id TEXT PRIMARY KEY,number INTEGER NOT NULL UNIQUE,conversation_id TEXT NOT NULL REFERENCES conversations(id),
 scope TEXT NOT NULL,amount TEXT NOT NULL,notes TEXT NOT NULL,created_at TEXT NOT NULL,published_at TEXT,
 message_id TEXT REFERENCES messages(id)
);
CREATE INDEX IF NOT EXISTS estimates_conversation ON estimates(conversation_id,number DESC);
CREATE TABLE IF NOT EXISTS feature_operations(
 conversation_id TEXT NOT NULL REFERENCES conversations(id),operation_id TEXT NOT NULL,actor TEXT NOT NULL CHECK(actor IN('customer','owner')),
 kind TEXT NOT NULL,content_hash TEXT NOT NULL,entity_id TEXT NOT NULL,receipt_json TEXT NOT NULL,created_at TEXT NOT NULL,
 PRIMARY KEY(conversation_id,operation_id)
);
`;

export function openStore(filename,{now=Date.now}={}) {
  if (filename!==':memory:') mkdirSync(dirname(filename),{recursive:true,mode:0o700});
  const db=new DatabaseSync(filename);
  db.exec('PRAGMA foreign_keys=ON; PRAGMA busy_timeout=5000; PRAGMA journal_mode=WAL; PRAGMA synchronous=FULL;');
  db.exec(SCHEMA);
  const tx=fn=>{db.exec('BEGIN IMMEDIATE');try{const result=fn();db.exec('COMMIT');return result;}catch(error){db.exec('ROLLBACK');throw error;}};
  const stamp=()=>new Date(now()).toISOString();
  function record(id) {return db.prepare('SELECT * FROM conversations WHERE id=?').get(id);}
  function guest(id,token) {
    const row=record(id);
    if (!row || !token || !equal(sha(token),row.token_hash)) throw fail(404,'conversation_unavailable');
    if (row.revoked_at || Date.parse(row.expires_at)<=now()) throw fail(410,'access_expired');
    return row;
  }
  function receipt(row) {return {operationId:row.operation_id,messageId:row.message_id,sequence:row.sequence};}
  function operation(id,operationId) {return db.prepare('SELECT * FROM operations WHERE conversation_id=? AND operation_id=?').get(id,operationId);}
  function featureOperation(id,operationId){return db.prepare('SELECT * FROM feature_operations WHERE conversation_id=? AND operation_id=?').get(id,operationId);}
  const photoInfo=row=>({id:row.id,filename:row.filename,mime:row.mime,size:row.size,createdAt:row.created_at});
  const estimateInfo=row=>row?({id:row.id,number:'ESG-'+String(row.number).padStart(6,'0'),scope:row.scope,amount:row.amount,currency:'USD',notes:row.notes,status:row.published_at?'published':'draft',createdAt:row.created_at,publishedAt:row.published_at}):null;
  function retryFeature(id,input,actor,kind,hash){
    if(operation(id,input.operationId))throw fail(409,'operation_conflict');
    const saved=featureOperation(id,input.operationId);
    if(saved&&(saved.actor!==actor||saved.kind!==kind||saved.content_hash!==hash))throw fail(409,'operation_conflict');
    return saved;
  }
  function saveFeature(id,operationId,actor,kind,hash,entityId,value,at){db.prepare('INSERT INTO feature_operations(conversation_id,operation_id,actor,kind,content_hash,entity_id,receipt_json,created_at) VALUES(?,?,?,?,?,?,?,?)').run(id,operationId,actor,kind,hash,entityId,JSON.stringify(value),at);return value;}
  function snapshot(row) {
    const answers=JSON.parse(row.answers_json),provided=Object.fromEntries(answers.filter(x=>x.state==='provided').map(x=>[x.field,x.answer]));
    return {...provided,fieldStates:Object.fromEntries(answers.map(x=>[x.field,x.state]))};
  }
  function view(id,{after=0,owner=false}={}) {
    const row=record(id); if (!row) throw fail(404,'conversation_unavailable');
    const messages=db.prepare('SELECT id,sequence,role,body,created_at,operation_id FROM messages WHERE conversation_id=? AND sequence>? ORDER BY sequence LIMIT 100').all(id,after).map(x=>({id:x.id,sequence:x.sequence,role:x.role,body:x.body,createdAt:x.created_at,operationId:x.operation_id}));
    const data={ok:true,conversation:{id:row.id,leadId:row.id,expiresAt:row.expires_at,repair:snapshot(row)},messages,cursor:messages.at(-1)?.sequence||after};
    data.photos=db.prepare('SELECT id,filename,mime,size,created_at FROM photos WHERE conversation_id=? ORDER BY created_at,id').all(id).map(photoInfo);
    data.estimate=estimateInfo(db.prepare('SELECT * FROM estimates WHERE conversation_id=? AND published_at IS NOT NULL ORDER BY published_at DESC,number DESC LIMIT 1').get(id));
    if(owner) {
      data.estimates=db.prepare('SELECT * FROM estimates WHERE conversation_id=? ORDER BY number DESC LIMIT 50').all(id).map(estimateInfo);
      data.quoteDetails=db.prepare('SELECT address,size_of_home,stories,gutter_length FROM quote_details WHERE conversation_id=?').get(id);
      data.guestAccess={active:!row.revoked_at&&Date.parse(row.expires_at)>now(),revoked:Boolean(row.revoked_at),expiresAt:row.expires_at};
    }
    return data;
  }
  function append(id,role,body,operationId,part,at) {
    const sequence=db.prepare('SELECT COALESCE(MAX(sequence),0)+1 AS next FROM messages WHERE conversation_id=?').get(id).next;
    const row={id:randomUUID(),sequence};
    db.prepare('INSERT INTO messages(id,conversation_id,sequence,role,body,created_at,operation_id,part) VALUES(?,?,?,?,?,?,?,?)').run(row.id,id,sequence,role,body,at,operationId,part);
    return row;
  }
  function create(input) {
    return tx(()=>{
      const existing=record(input.conversationId);
      if(existing) {
        guest(input.conversationId,input.accessToken);
        if(existing.initial_operation!==input.operationId || existing.initial_hash!==input.hash) throw fail(409,'operation_conflict');
        const saved=operation(existing.id,input.operationId);
        if(!saved || saved.content_hash!==input.hash || saved.actor!=='create') throw fail(409,'operation_conflict');
        return {...view(existing.id),receipt:receipt(saved),duplicate:true};
      }
      const at=stamp(),expires=new Date(now()+90*86400000).toISOString(),i=input.intake;
      db.prepare('INSERT INTO conversations(id,token_hash,initial_operation,initial_hash,name,phone,answers_json,created_at,expires_at) VALUES(?,?,?,?,?,?,?,?,?)').run(input.conversationId,input.tokenHash,input.operationId,input.hash,i.name,i.phone,JSON.stringify(input.answers),at,expires);
      db.prepare('INSERT INTO quote_details(conversation_id,address,size_of_home,stories,gutter_length) VALUES(?,?,?,?,?)').run(input.conversationId,i.address??null,i.homeSize??null,i.stories?Number(i.stories):null,i.gutterLength??null);
      let last=null,part=0;
      for(const q of QUESTIONS) {
        const choice=input.answers.find(x=>x.field===q.field);
        if(choice.state!=='provided') continue;
        append(input.conversationId,'guide',q.prompt,input.operationId,++part,at);
        last=append(input.conversationId,'customer',choice.answer,input.operationId,++part,at);
      }
      db.prepare('INSERT INTO operations(conversation_id,operation_id,content_hash,actor,message_id,sequence,created_at) VALUES(?,?,?,?,?,?,?)').run(input.conversationId,input.operationId,input.hash,'create',last.id,last.sequence,at);
      return {...view(input.conversationId),receipt:{operationId:input.operationId,messageId:last.id,sequence:last.sequence}};
    });
  }
  function reply(id,input,{token,owner=false}={}) {
    return tx(()=>{
      const row=owner?record(id):guest(id,token); if(!row) throw fail(404,'conversation_unavailable');
      const actor=owner?'owner':'customer',hash=sha(JSON.stringify({actor,body:input.body})),saved=operation(id,input.operationId);
      if(featureOperation(id,input.operationId))throw fail(409,'operation_conflict');
      if(saved) {
        if(saved.actor!==actor || saved.content_hash!==hash) throw fail(409,'operation_conflict');
        return {ok:true,receipt:receipt(saved),duplicate:true};
      }
      if(db.prepare('SELECT COUNT(*) AS n FROM messages WHERE conversation_id=?').get(id).n>=1000) throw fail(409,'message_limit');
      const at=stamp(),message=append(id,actor,input.body,input.operationId,0,at);
      db.prepare('INSERT INTO operations(conversation_id,operation_id,content_hash,actor,message_id,sequence,created_at) VALUES(?,?,?,?,?,?,?)').run(id,input.operationId,hash,actor,message.id,message.sequence,at);
      return {ok:true,receipt:{operationId:input.operationId,messageId:message.id,sequence:message.sequence}};
    });
  }
  function operationReceipt(id,operationId,{token,owner=false}={}) {
    if(owner){if(!record(id))throw fail(404,'conversation_unavailable');}else guest(id,token);
    const op=operation(id,operationId);
    if(!op){const feature=featureOperation(id,operationId);if(!feature||feature.actor!==(owner?'owner':'customer'))throw fail(404,'operation_unavailable');return {ok:true,receipt:JSON.parse(feature.receipt_json)};}
    if(!op || op.actor===(owner?'customer':'owner')) throw fail(404,'operation_unavailable');
    return {ok:true,receipt:receipt(op)};
  }
  function list({cursor,limit=50}={}) {
    let before=null;
    if(cursor){try{before=JSON.parse(Buffer.from(cursor,'base64url').toString());if(!Array.isArray(before)||before.length!==2||typeof before[0]!=='string'||typeof before[1]!=='string')throw Error();}catch{throw fail(400,'invalid_cursor');}}
    const where=before?'WHERE (c.created_at<? OR (c.created_at=? AND c.id<?))':'';
    const query=db.prepare(`SELECT c.id,c.name,c.phone,c.created_at,c.expires_at,c.revoked_at,(SELECT MAX(sequence) FROM messages WHERE conversation_id=c.id) AS last_sequence,(SELECT role FROM messages WHERE conversation_id=c.id ORDER BY sequence DESC LIMIT 1) AS last_role FROM conversations c ${where} ORDER BY c.created_at DESC,c.id DESC LIMIT ?`);
    const rows=before?query.all(before[0],before[0],before[1],limit):query.all(limit);
    return {ok:true,conversations:rows.map(x=>({id:x.id,name:x.name,phone:x.phone,createdAt:x.created_at,expiresAt:x.expires_at,revoked:Boolean(x.revoked_at),lastSequence:x.last_sequence,lastRole:x.last_role})),nextCursor:rows.length===limit?Buffer.from(JSON.stringify([rows.at(-1).created_at,rows.at(-1).id])).toString('base64url'):null};
  }
  function updateQuote(id,quote) {
    if(!record(id))throw fail(404,'conversation_unavailable');
    db.prepare('UPDATE quote_details SET address=?,size_of_home=?,stories=?,gutter_length=? WHERE conversation_id=?').run(quote.address,quote.size_of_home,quote.stories,quote.gutter_length,id);
    return {ok:true,quoteDetails:quote};
  }
  function addPhoto(id,input,{token}={}) {
    return tx(()=>{
      guest(id,token);
      const saved=retryFeature(id,input,'customer','photo',input.hash);
      if(saved){const row=db.prepare('SELECT id,filename,mime,size,created_at FROM photos WHERE id=? AND conversation_id=?').get(saved.entity_id,id);return {ok:true,photo:photoInfo(row),receipt:JSON.parse(saved.receipt_json),duplicate:true};}
      if(db.prepare('SELECT COUNT(*) AS n FROM photos WHERE conversation_id=?').get(id).n>=PHOTO_MAX_COUNT)throw fail(409,'photo_limit');
      const photoId=randomUUID(),at=stamp();
      db.prepare('INSERT INTO photos(id,conversation_id,filename,mime,size,bytes,created_at) VALUES(?,?,?,?,?,?,?)').run(photoId,id,input.filename,input.mime,input.bytes.length,input.bytes,at);
      const value=saveFeature(id,input.operationId,'customer','photo',input.hash,photoId,{operationId:input.operationId,photoId},at);
      return {ok:true,photo:{id:photoId,filename:input.filename,mime:input.mime,size:input.bytes.length,createdAt:at},receipt:value};
    });
  }
  function readPhoto(id,photoId,{token,owner=false}={}) {
    if(owner){if(!record(id))throw fail(404,'conversation_unavailable');}else guest(id,token);
    const row=db.prepare('SELECT * FROM photos WHERE id=? AND conversation_id=?').get(photoId,id);
    if(!row)throw fail(404,'photo_unavailable');return row;
  }
  function saveEstimate(id,input) {
    return tx(()=>{
      if(!record(id))throw fail(404,'conversation_unavailable');
      const hash=sha(JSON.stringify({scope:input.scope,amount:input.amount,notes:input.notes}));
      const saved=retryFeature(id,input,'owner','estimate-draft',hash);
      if(saved)return {ok:true,estimate:estimateInfo(db.prepare('SELECT * FROM estimates WHERE id=? AND conversation_id=?').get(saved.entity_id,id)),receipt:JSON.parse(saved.receipt_json),duplicate:true};
      const estimateId=randomUUID(),at=stamp(),number=db.prepare('SELECT COALESCE(MAX(number),0)+1 AS next FROM estimates').get().next;
      db.prepare('INSERT INTO estimates(id,number,conversation_id,scope,amount,notes,created_at) VALUES(?,?,?,?,?,?,?)').run(estimateId,number,id,input.scope,input.amount,input.notes,at);
      const value=saveFeature(id,input.operationId,'owner','estimate-draft',hash,estimateId,{operationId:input.operationId,estimateId},at);
      return {ok:true,estimate:estimateInfo(db.prepare('SELECT * FROM estimates WHERE id=?').get(estimateId)),receipt:value};
    });
  }
  function publishEstimate(id,estimateId,input) {
    return tx(()=>{
      const conversation=record(id);if(!conversation)throw fail(404,'conversation_unavailable');
      const hash=sha(JSON.stringify({estimateId})),saved=retryFeature(id,input,'owner','estimate-publish',hash);
      if(saved)return {ok:true,estimate:estimateInfo(db.prepare('SELECT * FROM estimates WHERE id=? AND conversation_id=?').get(estimateId,id)),receipt:JSON.parse(saved.receipt_json),duplicate:true};
      if(conversation.revoked_at||Date.parse(conversation.expires_at)<=now())throw fail(410,'access_expired');
      const row=db.prepare('SELECT * FROM estimates WHERE id=? AND conversation_id=?').get(estimateId,id);
      if(!row)throw fail(404,'estimate_unavailable');
      if(row.published_at)throw fail(409,'estimate_already_published');
      if(db.prepare('SELECT COUNT(*) AS n FROM messages WHERE conversation_id=?').get(id).n>=1000)throw fail(409,'message_limit');
      const at=stamp(),estimate=estimateInfo(row),body='Estimate '+estimate.number+'\nScope: '+row.scope+'\nAmount: $'+row.amount+' USD'+(row.notes?'\nNotes: '+row.notes:'');
      const message=append(id,'owner',body,input.operationId,0,at);
      db.prepare('UPDATE estimates SET published_at=?,message_id=? WHERE id=?').run(at,message.id,estimateId);
      const value=saveFeature(id,input.operationId,'owner','estimate-publish',hash,estimateId,{operationId:input.operationId,estimateId,messageId:message.id,sequence:message.sequence},at);
      return {ok:true,estimate:estimateInfo(db.prepare('SELECT * FROM estimates WHERE id=?').get(estimateId)),receipt:value};
    });
  }
  function revoke(id) {
    if(!record(id)) throw fail(404,'conversation_unavailable');
    db.prepare('UPDATE conversations SET revoked_at=COALESCE(revoked_at,?) WHERE id=?').run(stamp(),id);
    return {ok:true};
  }
  function rate(bucket,max) {
    const window=Math.floor(now()/60000)*60000;
    const row=db.prepare('INSERT INTO rate_limits(bucket,window_start,count) VALUES(?,?,1) ON CONFLICT(bucket) DO UPDATE SET count=CASE WHEN window_start=excluded.window_start THEN count+1 ELSE 1 END,window_start=excluded.window_start RETURNING count').get(bucket,window);
    if(row.count>max)throw fail(429,'rate_limited');
    if(Math.random()<0.01)db.prepare('DELETE FROM rate_limits WHERE window_start<?').run(window-120000);
  }
  return {db,guest,create,reply,view,operationReceipt,list,updateQuote,addPhoto,readPhoto,saveEstimate,publishEstimate,revoke,rate,close:()=>db.close()};
}

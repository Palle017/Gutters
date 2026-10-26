import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {randomBytes,randomUUID} from 'node:crypto';
import {Worker} from 'node:worker_threads';
import {createApp} from '../src/app.mjs';
import {QUESTIONS,validateCreate} from '../src/protocol.mjs';

const customerOrigin='https://palle017.github.io',ownerOrigin='https://gutters.example.invalid';
const token=()=>randomBytes(32).toString('base64url');
function input(overrides={}) {
  const answers=[{field:'name',state:'provided',answer:'Synthetic Customer'},{field:'phone',state:'provided',answer:'239-555-0100'},...QUESTIONS.slice(2).map(x=>({field:x.field,state:'later'}))];
  const intake=Object.fromEntries(answers.filter(x=>x.state==='provided').map(x=>[x.field,x.answer]));
  return {schemaVersion:2,conversationId:randomUUID(),operationId:randomUUID(),accessToken:token(),intake,answers,...overrides};
}
function setup(t,{clock,dbPath}={}) {
  const dir=mkdtempSync(path.join(tmpdir(),'gutters-test-')),ownerToken=token();
  const options={dbPath:dbPath||path.join(dir,'gutters.sqlite3'),ownerToken,publicOrigin:ownerOrigin,allowedOrigins:[customerOrigin],now:()=>clock?.value??Date.now(),clientKey:r=>r.headers.get('x-test-ip')||'synthetic'};
  let app=createApp(options);
  const call=async(pathname,{method='GET',body,access,owner=false,origin=owner?ownerOrigin:customerOrigin,headers={}}={})=>{
    const request=new Request(ownerOrigin+pathname,{method,headers:{...(origin?{Origin:origin}:{}),...(access||owner?{Authorization:'Bearer '+(access||ownerToken)}:{}),...(body!==undefined?{'Content-Type':'application/json'}:{}),...headers},...(body!==undefined?{body:JSON.stringify(body)}:{})});
    const response=await app.fetch(request);const data=response.status===204?null:response.headers.get('Content-Type')?.includes('application/json')?await response.json():await response.text();return {response,data,status:response.status};
  };
  t.after(()=>{app.close();rmSync(dir,{recursive:true,force:true});});
  return {call,options,get app(){return app;},reopen(){app.close();app=createApp(options);},ownerToken};
}
test('minimum request saves one contact and four transcript rows; optional quote fields remain null',async t=>{
  const x=setup(t),request=input(),out=await x.call('/conversations',{method:'POST',body:request});
  assert.equal(out.status,201);assert.equal(out.data.ok,true);assert.equal(out.data.messages.length,4);assert.equal(out.data.receipt.sequence,4);
  assert.deepEqual(out.data.conversation.repair,{...request.intake,fieldStates:Object.fromEntries(QUESTIONS.map(q=>[q.field,['name','phone'].includes(q.field)?'provided':'later']))});
  const row=x.app.store.db.prepare('SELECT * FROM quote_details').get();assert.deepEqual({...row},{conversation_id:request.conversationId,address:null,size_of_home:null,stories:null,gutter_length:null});
  assert.equal(x.app.store.db.prepare('SELECT token_hash FROM conversations').get().token_hash.includes(request.accessToken),false);
  assert.equal(JSON.stringify(out.data).includes('token_hash'),false);assert.equal(JSON.stringify(out.data).includes(request.accessToken),false);
});
test('all four quote fields retain raw text and stories, without guessed units or calculations',async t=>{
  const x=setup(t),request=input();
  for(const [field,answer] of [['details','Synthetic screen project'],['address','123 Example Lane'],['homeSize','owner will measure'],['stories','2'],['gutterLength','John will determine at quote']]){request.answers.find(x=>x.field===field).state='provided';request.answers.find(x=>x.field===field).answer=answer;request.intake[field]=answer;}
  assert.equal((await x.call('/conversations',{method:'POST',body:request})).status,201);
  const owner=await x.call('/owner/api/conversations/'+request.conversationId,{owner:true});assert.equal(owner.status,200);
  assert.deepEqual(owner.data.quoteDetails,{address:'123 Example Lane',size_of_home:'owner will measure',stories:2,gutter_length:'John will determine at quote'});
  const columns=x.app.store.db.prepare('PRAGMA table_info(quote_details)').all().map(x=>x.name);assert.deepEqual(columns,['conversation_id','address','size_of_home','stories','gutter_length']);
  const allColumns=x.app.store.db.prepare('PRAGMA table_info(conversations)').all().map(x=>x.name);for(const key of ['stage','source','price','material','rate','sms_consent'])assert.equal(allColumns.includes(key),false);
});
test('unchanged lost acknowledgment retries survive database close/reopen; changed request conflicts',async t=>{
  const x=setup(t),request=input(),first=await x.call('/conversations',{method:'POST',body:request});
  x.reopen();const replay=await x.call('/conversations',{method:'POST',body:request});assert.equal(replay.status,201);assert.deepEqual(replay.data.receipt,first.data.receipt);assert.equal(replay.data.duplicate,true);
  const operation=await x.call('/conversations/'+request.conversationId+'/operations/'+request.operationId,{access:request.accessToken});assert.deepEqual(operation.data.receipt,first.data.receipt);
  const changed=structuredClone(request);changed.intake.name='Different';changed.answers[0].answer='Different';assert.equal((await x.call('/conversations',{method:'POST',body:changed})).status,409);
  assert.equal(x.app.store.db.prepare('SELECT COUNT(*) n FROM conversations').get().n,1);assert.equal(x.app.store.db.prepare('SELECT COUNT(*) n FROM messages').get().n,4);
});
test('atomic rollback on message insert failure leaves no contact, quote or receipt',async t=>{
  const x=setup(t),request=input();x.app.store.db.exec("CREATE TRIGGER synthetic_fail BEFORE INSERT ON messages BEGIN SELECT RAISE(ABORT,'synthetic failure'); END;");
  const out=await x.call('/conversations',{method:'POST',body:request});assert.equal(out.status,500);assert.deepEqual(out.data,{ok:false,error:'storage_unavailable'});
  for(const table of ['conversations','quote_details','messages','operations'])assert.equal(x.app.store.db.prepare('SELECT COUNT(*) n FROM '+table).get().n,0);
  x.app.store.db.exec('DROP TRIGGER synthetic_fail');assert.equal((await x.call('/conversations',{method:'POST',body:request})).status,201);
});
test('customer A cannot read, append, or reconcile B, and supplied role/actor fields are rejected',async t=>{
  const x=setup(t),a=input(),b=input();await x.call('/conversations',{method:'POST',body:a});await x.call('/conversations',{method:'POST',body:b});
  for(const suffix of ['', '/operations/'+b.operationId])assert.equal((await x.call('/conversations/'+b.conversationId+suffix,{access:a.accessToken})).status,404);
  assert.equal((await x.call('/conversations/'+b.conversationId+'/messages',{method:'POST',access:a.accessToken,body:{operationId:randomUUID(),body:'forged'}})).status,404);
  assert.equal((await x.call('/conversations/'+a.conversationId+'/messages',{method:'POST',access:a.accessToken,body:{operationId:randomUUID(),body:'forged',role:'owner'}})).status,400);
  assert.equal((await x.call('/owner/api/conversations/'+b.conversationId,{access:a.accessToken,origin:ownerOrigin})).status,401);
});
test('customer and owner replies persist, replay idempotently and reject changed operation content/actor',async t=>{
  const x=setup(t),request=input();await x.call('/conversations',{method:'POST',body:request});
  const message={operationId:randomUUID(),body:'<img src=x onerror=alert(1)> Synthetic customer note'},first=await x.call('/conversations/'+request.conversationId+'/messages',{method:'POST',body:message,access:request.accessToken});assert.equal(first.status,201);
  const replay=await x.call('/conversations/'+request.conversationId+'/messages',{method:'POST',body:message,access:request.accessToken});assert.deepEqual(replay.data.receipt,first.data.receipt);
  assert.equal((await x.call('/conversations/'+request.conversationId+'/messages',{method:'POST',body:{...message,body:'Changed'},access:request.accessToken})).status,409);
  assert.equal((await x.call('/owner/api/conversations/'+request.conversationId+'/messages',{method:'POST',body:message,owner:true})).status,409);
  const ownerReply={operationId:randomUUID(),body:'Synthetic John reply'},saved=await x.call('/owner/api/conversations/'+request.conversationId+'/messages',{method:'POST',body:ownerReply,owner:true});assert.equal(saved.status,201);
  x.reopen();const read=await x.call('/conversations/'+request.conversationId,{access:request.accessToken});assert.equal(read.data.messages.length,6);assert.equal(read.data.messages[4].body,message.body);assert.equal(read.data.messages[5].role,'owner');assert.equal(read.data.messages[5].body,ownerReply.body);
  const receipt=await x.call('/owner/api/conversations/'+request.conversationId+'/operations/'+ownerReply.operationId,{owner:true});assert.deepEqual(receipt.data.receipt,saved.data.receipt);
  assert.equal((await x.call('/conversations/'+request.conversationId+'/operations/'+ownerReply.operationId,{access:request.accessToken})).status,404);
});
test('90-day expiry and owner revocation reject reads, writes, and receipt replay while retaining saved messages',async t=>{
  const clock={value:Date.parse('2026-10-25T12:00:00Z')},x=setup(t,{clock}),request=input();await x.call('/conversations',{method:'POST',body:request});
  clock.value+=90*86400000;
  assert.equal((await x.call('/conversations/'+request.conversationId,{access:request.accessToken})).status,410);
  assert.equal((await x.call('/conversations',{method:'POST',body:request})).status,410);
  assert.equal((await x.call('/conversations/'+request.conversationId+'/operations/'+request.operationId,{access:request.accessToken})).status,410);
  const expiredOwner=await x.call('/owner/api/conversations/'+request.conversationId,{owner:true});assert.equal(expiredOwner.status,200);assert.equal(expiredOwner.data.guestAccess.active,false);assert.equal(expiredOwner.data.guestAccess.revoked,false);
  const b=input();await x.call('/conversations',{method:'POST',body:b});assert.equal((await x.call('/owner/api/conversations/'+b.conversationId+'/revoke',{method:'POST',body:{},owner:true})).status,200);
  assert.equal((await x.call('/conversations/'+b.conversationId,{access:b.accessToken})).status,410);assert.equal(x.app.store.db.prepare('SELECT COUNT(*) n FROM messages').get().n,8);const revokedOwner=await x.call('/owner/api/conversations/'+b.conversationId,{owner:true});assert.equal(revokedOwner.data.guestAccess.revoked,true);assert.equal(revokedOwner.data.guestAccess.active,false);
});
test('strict public origins, preflight, private owner authorization and CSRF checks',async t=>{
  const x=setup(t),request=input();
  for(const origin of ['https://palle017.github.io.evil.invalid','https://evil.invalid',null])assert.equal((await x.call('/conversations',{method:'POST',body:request,origin})).status,403);
  const options=await x.call('/conversations',{method:'OPTIONS'});assert.equal(options.status,204);assert.equal(options.response.headers.get('Access-Control-Allow-Origin'),customerOrigin);assert.equal(options.response.headers.has('Access-Control-Allow-Credentials'),false);
  await x.call('/conversations',{method:'POST',body:request});assert.equal((await x.call('/owner/api/conversations',{origin:ownerOrigin})).status,401);
  for(const origin of [customerOrigin,'https://evil.invalid',null])assert.equal((await x.call('/owner/api/conversations/'+request.conversationId+'/messages',{method:'POST',body:{operationId:randomUUID(),body:'forged'},owner:true,origin})).status,403);
  const forged=await x.call('/owner/api/conversations',{origin:ownerOrigin,headers:{'oai-authenticated-user-id':'forged','oai-authenticated-user-email':'owner@example.invalid'}});assert.equal(forged.status,401);
});
test('unknown and later remain typed states without invented transcript messages',async t=>{
  const x=setup(t),request=input();request.answers.find(x=>x.field==='address').state='unknown';
  const out=await x.call('/conversations',{method:'POST',body:request});assert.equal(out.status,201);assert.equal(out.data.messages.length,4);assert.equal(out.data.conversation.repair.fieldStates.address,'unknown');assert.equal(Object.hasOwn(out.data.conversation.repair,'address'),false);
  const forged=structuredClone(request);forged.conversationId=randomUUID();forged.operationId=randomUUID();forged.answers.find(x=>x.field==='address').answer='invented';assert.equal((await x.call('/conversations',{method:'POST',body:forged})).status,400);
});
test('oversized, malformed, extra business properties and invalid stories fail without saving',async t=>{
  const x=setup(t);
  const a=input();a.intake.price=200;assert.equal((await x.call('/conversations',{method:'POST',body:a})).status,400);
  const b=input();b.intake.stories='3';b.answers.find(x=>x.field==='stories').state='provided';b.answers.find(x=>x.field==='stories').answer='3';assert.equal((await x.call('/conversations',{method:'POST',body:b})).status,400);
  const c=input();c.intake.details='x'.repeat(25000);assert.equal((await x.call('/conversations',{method:'POST',body:c})).status,413);
  const d=input();d.answers[0].answer='bad\u0001';d.intake.name='bad\u0001';assert.equal((await x.call('/conversations',{method:'POST',body:d})).status,400);
  assert.equal(x.app.store.db.prepare('SELECT COUNT(*) n FROM conversations').get().n,0);
});
test('rate limits bound anonymous creation and bad owner keys without exposing customer content',async t=>{
  const x=setup(t);for(let i=0;i<12;i++)assert.equal((await x.call('/conversations',{method:'POST',body:input()})).status,201);
  const limited=await x.call('/conversations',{method:'POST',body:input()});assert.equal(limited.status,429);assert.equal(limited.response.headers.get('Retry-After'),'60');
  for(let i=0;i<30;i++)assert.equal((await x.call('/owner/api/conversations',{origin:ownerOrigin})).status,401);
  assert.equal((await x.call('/owner/api/conversations',{origin:ownerOrigin})).status,429);assert.equal((await x.call('/owner/api/conversations',{owner:true})).status,200);
});
test('quote owner edits affect only the four fields, leaving initial snapshot and messages unchanged',async t=>{
  const x=setup(t),request=input();await x.call('/conversations',{method:'POST',body:request});
  const quote={address:'Synthetic project',size_of_home:'John measured: pending unit',stories:1,gutter_length:'TBD after quote'};
  assert.equal((await x.call('/owner/api/conversations/'+request.conversationId+'/quote-details',{method:'POST',body:quote,owner:true})).status,200);
  x.reopen();
  const view=await x.call('/owner/api/conversations/'+request.conversationId,{owner:true});assert.deepEqual(view.data.quoteDetails,quote);assert.equal(view.data.conversation.repair.fieldStates.address,'later');assert.equal(view.data.messages.length,4);
  assert.equal((await x.call('/owner/api/conversations/'+request.conversationId+'/quote-details',{method:'POST',body:{...quote,price:100},owner:true})).status,400);
});
test('message pagination returns a contiguous cursor and owner list handles equal timestamps',async t=>{
  const clock={value:Date.parse('2026-10-25T12:00:00Z')},x=setup(t,{clock}),request=input();
  const data=validateCreate(request);x.app.store.create(data);
  for(let i=0;i<110;i++)x.app.store.reply(request.conversationId,{operationId:randomUUID(),body:'Synthetic note '+i},{owner:true});
  const page=await x.call('/conversations/'+request.conversationId,{access:request.accessToken});assert.equal(page.data.messages.length,100);assert.equal(page.data.cursor,100);
  const next=await x.call('/conversations/'+request.conversationId+'?after='+page.data.cursor,{access:request.accessToken});assert.equal(next.data.messages.length,14);assert.equal(next.data.cursor,114);assert.equal(next.data.messages[0].sequence,101);
  for(let i=0;i<51;i++)x.app.store.create(validateCreate(input()));
  const first=await x.call('/owner/api/conversations',{owner:true});assert.equal(first.data.conversations.length,50);assert.ok(first.data.nextCursor);
  const second=await x.call('/owner/api/conversations?cursor='+encodeURIComponent(first.data.nextCursor),{owner:true});assert.equal(second.data.conversations.length,2);assert.equal(new Set([...first.data.conversations,...second.data.conversations].map(x=>x.id)).size,52);
});
test('owner page renders plain text and keeps access key out of URLs, storage and HTML data',async t=>{
  const x=setup(t),out=await x.call('/owner',{origin:null});assert.equal(out.status,200);assert.equal(typeof out.data,'string');
  assert.match(out.data,/textContent/);assert.doesNotMatch(out.data,/innerHTML|localStorage|document\.cookie/);assert.equal(out.data.includes(x.ownerToken),false);assert.match(out.data,/Authorization:'Bearer '\+token/);assert.match(out.response.headers.get('Content-Security-Policy'),/frame-ancestors 'none'/);
});
test('real SQLite concurrent connections and processes deduplicate the same initial operation',async t=>{
  const x=setup(t),request=input(),workers=[];
  for(let i=0;i<4;i++)workers.push(new Promise((resolve,reject)=>{const worker=new Worker(new URL('./race-worker.mjs',import.meta.url),{workerData:{filename:x.options.dbPath,input:request}});worker.once('message',resolve);worker.once('error',reject);worker.once('exit',code=>{if(code)reject(Error('worker exit '+code));});}));
  const results=await Promise.all(workers);for(const r of results)assert.equal(r.ok,true);assert.equal(new Set(results.map(x=>x.receipt.messageId)).size,1);
  assert.equal(x.app.store.db.prepare('SELECT COUNT(*) n FROM conversations').get().n,1);assert.equal(x.app.store.db.prepare('SELECT COUNT(*) n FROM messages').get().n,4);
});

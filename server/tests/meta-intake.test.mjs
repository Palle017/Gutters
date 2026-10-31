import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync,writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {createHmac,randomBytes} from 'node:crypto';
import {spawn} from 'node:child_process';
import {once} from 'node:events';
import {fileURLToPath} from 'node:url';
import {createApp} from '../src/app.mjs';
import {loadAvailability,nextEstimateSlots,parseAvailability} from '../src/meta-availability.mjs';
import {createMetaSender} from '../src/meta-send.mjs';
import {polishReply} from '../src/meta-llm.mjs';

const secret='synthetic-app-secret';
const verify='synthetic-verify-token';
const ownerOrigin='https://gutters.example.invalid';
const schedule={
  timezone:'America/New_York',
  weekdays:['tue','wed','thu'],
  hours:{start:'09:00',end:'12:00'},
  leadTimeHours:24,
  slotMinutes:60,
};
const fixedNow=Date.parse('2026-10-26T15:00:00.000Z');

function metaConfig(overrides={}){
  return {
    enabled:true,verifyToken:verify,appSecret:secret,pageAccessToken:'',sendMode:'dry-run',graphVersion:'v21.0',
    availabilityPath:null,llm:{enabled:false,baseUrl:'',apiKey:'',model:''},
    fetchImpl(){throw Error('Meta network must stay unused');},
    ...overrides,
  };
}
function setup(t,{meta,clock,availability}={}){
  const dir=mkdtempSync(path.join(tmpdir(),'gutters-meta-'));
  const ownerToken=randomBytes(32).toString('base64url');
  let availabilityPath=null;
  if(availability){
    availabilityPath=path.join(dir,'estimate-availability.json');
    writeFileSync(availabilityPath,JSON.stringify(availability));
  }
  const app=createApp({
    dbPath:path.join(dir,'gutters.sqlite3'),ownerToken,publicOrigin:ownerOrigin,allowedOrigins:['https://palle017.github.io'],
    now:()=>clock?.value??fixedNow,clientKey:request=>request.headers.get('x-test-ip')||'synthetic',
    meta:metaConfig({availabilityPath,...meta}),
  });
  t.after(()=>{app.close();rmSync(dir,{recursive:true,force:true});});
  return {app,ownerToken,dir};
}
function sign(raw,key=secret){return 'sha256='+createHmac('sha256',key).update(raw).digest('hex');}
async function webhook(app,payload,{raw,signature,method='POST',search='',headers={}}={}){
  const body=raw??(payload===undefined?undefined:JSON.stringify(payload));
  const response=await app.fetch(new Request(ownerOrigin+'/meta/webhook'+search,{
    method,
    headers:{
      ...(body!==undefined?{'Content-Type':'application/json','X-Hub-Signature-256':signature===undefined?sign(body):signature}:{}),
      'x-test-ip':'203.0.113.50',...headers,
    },
    ...(body!==undefined?{body}:{}),
  }));
  const text=await response.text();
  let data=text;
  try{data=JSON.parse(text);}catch{/* challenge is plain text */}
  return {status:response.status,data,text,type:response.headers.get('Content-Type')};
}
function event({channel='instagram',sender='ig-synthetic-1',recipient='17890000000000001',mid,text,echo=false,object}={}){
  const resolved=object||(channel==='instagram'?'instagram':'page');
  return {object:resolved,entry:[{id:recipient,time:1,messaging:[{sender:{id:sender},recipient:{id:recipient},timestamp:1,message:{mid,text,...(echo?{is_echo:true}:{})}}]}]};
}
async function owner(app,token,pathname='/owner/api/conversations'){
  const response=await app.fetch(new Request(ownerOrigin+pathname,{headers:{Authorization:'Bearer '+token,Origin:ownerOrigin}}));
  return {status:response.status,data:await response.json()};
}
function replies(app){return app.store.db.prepare('SELECT body,delivery FROM meta_outbound ORDER BY created_at,sequence,id').all();}
async function say(app,mid,text,extra){
  return webhook(app,event({mid,text,...extra}));
}

test('hub challenge echoes only when the verify token matches',async t=>{
  const {app}=setup(t);
  const ok=await webhook(app,undefined,{method:'GET',search:'?hub.mode=subscribe&hub.verify_token='+verify+'&hub.challenge=184923'});
  assert.equal(ok.status,200);assert.equal(ok.text,'184923');assert.match(ok.type,/text\/plain/);
  const bad=await webhook(app,undefined,{method:'GET',search:'?hub.mode=subscribe&hub.verify_token=wrong-token&hub.challenge=184923'});
  assert.equal(bad.status,403);assert.equal(bad.data.error,'verify_failed');
  const mode=await webhook(app,undefined,{method:'GET',search:'?hub.mode=unsubscribe&hub.verify_token='+verify+'&hub.challenge=184923'});
  assert.equal(mode.status,403);
  const markup=await webhook(app,undefined,{method:'GET',search:'?hub.mode=subscribe&hub.verify_token='+verify+'&hub.challenge=%3Cscript%3E'});
  assert.equal(markup.status,403);
});

test('a bad signature is rejected and stores nothing',async t=>{
  const {app}=setup(t);
  const payload=event({mid:'m-bad',text:'Need gutters'});
  const raw=JSON.stringify(payload);
  const out=await webhook(app,undefined,{raw,signature:sign(raw,'other-secret')});
  assert.equal(out.status,403);assert.equal(out.data.error,'invalid_signature');
  const spaced='{ "object" : "instagram", "entry" : [] }';
  const mismatched=await webhook(app,undefined,{raw:spaced,signature:sign(JSON.stringify(JSON.parse(spaced)))});
  assert.equal(mismatched.status,403);
  const exact=await webhook(app,undefined,{raw:spaced,signature:sign(spaced)});
  assert.equal(exact.status,200);
  assert.equal(app.store.db.prepare('SELECT COUNT(*) n FROM conversations').get().n,0);
  assert.equal(app.store.db.prepare('SELECT COUNT(*) n FROM meta_messages').get().n,0);
});

test('meta intake is 404 until META_INTAKE_ENABLED is on',async t=>{
  const {app}=setup(t,{meta:{enabled:false}});
  const raw=JSON.stringify(event({mid:'m-off',text:'Need gutters'}));
  const post=await webhook(app,undefined,{raw,signature:sign(raw)});
  const get=await webhook(app,undefined,{method:'GET',search:'?hub.mode=subscribe&hub.verify_token='+verify+'&hub.challenge=184923'});
  assert.equal(post.status,404);assert.equal(get.status,404);
  assert.equal(app.store.db.prepare('SELECT COUNT(*) n FROM conversations').get().n,0);
});

test('the same message mid is processed once',async t=>{
  const {app}=setup(t);
  const payload=event({mid:'m-once',text:'Need new gutters along the back of the house'});
  assert.equal((await webhook(app,payload)).status,200);
  assert.equal((await webhook(app,payload)).status,200);
  assert.equal(replies(app).length,1);
  assert.equal(app.store.db.prepare('SELECT COUNT(*) n FROM meta_messages').get().n,1);
  assert.match(replies(app)[0].body,/What name should John use/);
});

test('instagram happy path creates an owner-inbox lead and never sends a price',async t=>{
  const {app,ownerToken}=setup(t,{availability:schedule});
  const turns=[
    ['m1','Need new gutters along the back of the house'],
    ['m2','Synthetic Customer'],
    ['m3','239-555-0148'],
    ['m4','100 Example Lane, Fort Myers, FL'],
    ['m5','2'],
  ];
  for(const [mid,text] of turns)assert.equal((await say(app,mid,text)).status,200);
  const sent=replies(app).map(row=>row.body);
  assert.match(sent[0],/What name should John use/);
  assert.match(sent[1],/239-355-3686/);
  assert.match(sent[2],/service address/);
  const slots=nextEstimateSlots(schedule,fixedNow,3);
  assert.equal(slots.length,3);
  for(const slot of slots)assert.ok(sent[3].includes(slot.label),slot.label);
  assert.match(sent[3],/John will confirm/);
  assert.match(sent[4],/John will review this and confirm the estimate/);
  assert.equal(sent.some(body=>/\$\d|\bwarranty\b/i.test(body)),false);
  assert.equal(app.store.db.prepare('SELECT COUNT(*) n FROM owner_notifications').get().n,0);
  const list=await owner(app,ownerToken);
  assert.equal(list.status,200);assert.equal(list.data.conversations.length,1);
  assert.equal(list.data.conversations[0].name,'Synthetic Customer');
  assert.equal(list.data.conversations[0].phone,'239-555-0148');
  assert.equal(list.data.conversations[0].channel,'instagram');
  const view=await owner(app,ownerToken,'/owner/api/conversations/'+list.data.conversations[0].id);
  assert.deepEqual(view.data.quoteDetails,{address:'100 Example Lane, Fort Myers, FL',size_of_home:null,stories:null,gutter_length:null});
  const transcript=view.data.messages.map(message=>message.body).join('\n');
  assert.match(transcript,/Source: instagram/);
  assert.match(transcript,/Job: gutters/);
  assert.ok(transcript.includes(slots[1].label));
  assert.equal(view.data.notifications.enabled,false);
  assert.equal(app.store.db.prepare("SELECT channel FROM meta_leads").get().channel,'instagram');
  const columns=app.store.db.prepare('PRAGMA table_info(conversations)').all().map(column=>column.name);
  assert.equal(columns.includes('source'),false);
  assert.equal((await say(app,'m5','2')).status,200);
  assert.equal(app.store.db.prepare('SELECT COUNT(*) n FROM conversations').get().n,1);
});

test('messenger completion is stored as meta_messenger',async t=>{
  const {app,ownerToken}=setup(t);
  const turns=['custom screen door for the patio','Synthetic Customer','(239) 555-0177','unknown','Thursday afternoon'];
  for(let index=0;index<turns.length;index++){
    const out=await say(app,'page-'+index,turns[index],{channel:'messenger',sender:'psid-synthetic-9',recipient:'100200300'});
    assert.equal(out.status,200);
  }
  const list=await owner(app,ownerToken);
  assert.equal(list.data.conversations[0].channel,'meta_messenger');
  const view=await owner(app,ownerToken,'/owner/api/conversations/'+list.data.conversations[0].id);
  const transcript=view.data.messages.map(message=>message.body).join('\n');
  assert.match(transcript,/Source: meta_messenger/);
  assert.match(transcript,/custom screen doors/);
  assert.equal(view.data.quoteDetails.address,null);
  assert.match(transcript,/Thursday afternoon/);
});

test('stop pauses intake and restart begins a new request without rewriting the first',async t=>{
  const {app,ownerToken}=setup(t);
  const script=[
    ['s1','Need gutters on the porch'],
    ['s2','STOP'],
    ['s3','Synthetic Customer'],
    ['s4','restart'],
    ['s5','screens on the lanai'],
    ['s6','Synthetic Customer'],
    ['s7','239-555-0101'],
    ['s8','200 Example Road, Cape Coral, FL'],
    ['s9','Wednesday morning'],
  ];
  for(const [mid,text] of script)assert.equal((await say(app,mid,text)).status,200);
  const sent=replies(app).map(row=>row.body);
  assert.match(sent[1],/stop messages here/);
  assert.match(sent[2],/Send restart/);
  assert.match(sent[3],/gutters, screens, custom screen doors, or other/);
  const list=await owner(app,ownerToken);
  assert.equal(list.data.conversations.length,1);
  const view=await owner(app,ownerToken,'/owner/api/conversations/'+list.data.conversations[0].id);
  assert.match(view.data.messages.map(message=>message.body).join('\n'),/Job: screens/);
  assert.equal(view.data.quoteDetails.address,'200 Example Road, Cape Coral, FL');
});

test('an invalid phone does not create a lead and a later valid phone does',async t=>{
  const {app}=setup(t);
  for(const [mid,text] of [['p1','gutters'],['p2','back porch only'],['p3','Synthetic Customer'],['p4','call me maybe'],['p5','12345']])assert.equal((await say(app,mid,text)).status,200);
  assert.equal(app.store.db.prepare('SELECT COUNT(*) n FROM conversations').get().n,0);
  assert.match(replies(app).at(-1).body,/10 to 15 digits/);
  for(const [mid,text] of [['p6','239-555-0199'],['p7','55 Synthetic Street'],['p8','next Tuesday afternoon']])assert.equal((await say(app,mid,text)).status,200);
  const row=app.store.db.prepare('SELECT phone FROM conversations').get();
  assert.equal(row.phone,'239-555-0199');
  assert.equal(app.store.db.prepare('SELECT COUNT(*) n FROM conversations').get().n,1);
});

test('availability comes only from the owner file and falls back when it is absent',()=>{
  const october=nextEstimateSlots(schedule,fixedNow,3);
  assert.deepEqual(october.map(slot=>slot.start),[
    '2026-10-27T15:00:00.000Z',
    '2026-10-28T13:00:00.000Z',
    '2026-10-28T14:00:00.000Z',
  ]);
  assert.deepEqual(october.map(slot=>slot.label),[
    'Tue, Oct 27, 11:00 AM–12:00 PM ET',
    'Wed, Oct 28, 9:00 AM–10:00 AM ET',
    'Wed, Oct 28, 10:00 AM–11:00 AM ET',
  ]);
  const november=nextEstimateSlots(schedule,Date.parse('2026-11-02T16:00:00.000Z'),3);
  assert.deepEqual(november.map(slot=>slot.start),[
    '2026-11-03T16:00:00.000Z',
    '2026-11-04T14:00:00.000Z',
    '2026-11-04T15:00:00.000Z',
  ]);
  assert.equal(nextEstimateSlots(null,fixedNow),null);
  assert.equal(parseAvailability({...schedule,timezone:'UTC'}),null);
  assert.equal(parseAvailability({...schedule,weekdays:[]}),null);
  const dir=mkdtempSync(path.join(tmpdir(),'gutters-hours-'));
  try{
    assert.equal(loadAvailability(path.join(dir,'missing.json')),null);
    writeFileSync(path.join(dir,'broken.json'),'{');
    assert.equal(loadAvailability(path.join(dir,'broken.json')),null);
    writeFileSync(path.join(dir,'estimate-availability.json'),JSON.stringify(schedule));
    assert.equal(loadAvailability(path.join(dir,'estimate-availability.json')).slotMinutes,60);
  }finally{rmSync(dir,{recursive:true,force:true});}
});

test('without a schedule the bot asks for a preferred time instead of inventing openings',async t=>{
  const {app,ownerToken}=setup(t);
  for(const [mid,text] of [['n1','other'],['n2','boat canopy tarp is torn'],['n3','Synthetic Customer'],['n4','239-555-0160'],['n5','unknown']])assert.equal((await say(app,mid,text)).status,200);
  const ask=replies(app).at(-1).body;
  assert.match(ask,/What day and time do you prefer/);
  assert.doesNotMatch(ask,/^1\. /m);
  assert.equal((await say(app,'n6','Tuesday after 10')).status,200);
  const view=await owner(app,ownerToken,'/owner/api/conversations/'+(await owner(app,ownerToken)).data.conversations[0].id);
  assert.match(view.data.messages.map(message=>message.body).join('\n'),/Tuesday after 10/);
  assert.equal(view.data.quoteDetails.address,null);
  assert.match(view.data.messages.map(message=>message.body).join('\n'),/Job: other/);
});

test('dry-run does not call Graph and live mode posts with the page token kept out of the URL',async()=>{
  let calls=0;
  const dry=createMetaSender({mode:'dry-run',token:'page-token',fetchImpl(){calls++;return {ok:true};}});
  assert.deepEqual(await dry.deliver({channel:'instagram',recipientId:'ig',pageId:'1789',text:'Hello'}),{delivery:'dry-run'});
  assert.equal(calls,0);
  const seen=[];
  const live=createMetaSender({mode:'live',token:'page-token',graphVersion:'v21.0',fetchImpl:async(url,options)=>{seen.push({url,options});return {ok:true};}});
  assert.equal((await live.deliver({channel:'meta_messenger',recipientId:'psid',text:'Hello'})).delivery,'live');
  assert.equal(seen[0].url,'https://graph.facebook.com/v21.0/me/messages');
  assert.equal(seen[0].options.headers.Authorization,'Bearer page-token');
  assert.equal(seen[0].url.includes('page-token'),false);
  const instagram=createMetaSender({mode:'live',token:'page-token',fetchImpl:async(url,options)=>{seen.push({url,options});return {ok:false};}});
  assert.equal((await instagram.deliver({channel:'instagram',recipientId:'ig',pageId:'1789',text:'Hello'})).delivery,'failed');
  assert.equal(seen[1].url,'https://graph.facebook.com/v21.0/1789/messages');
  assert.equal(JSON.parse(seen[1].options.body).messaging_type,undefined);
});

test('the optional LLM hook stays off and returns the deterministic draft',async()=>{
  let calls=0;
  const draft='John will confirm the estimate.';
  assert.equal(await polishReply(draft,{enabled:false,baseUrl:'https://llm.example.invalid/v1',apiKey:'sk',model:'test'},()=>{calls++;}),draft);
  assert.equal(calls,0);
});

test('webhook bodies stay within the existing JSON cap and echoes are ignored',async t=>{
  const {app}=setup(t);
  const huge=await webhook(app,undefined,{raw:JSON.stringify({object:'instagram',entry:[],pad:'x'.repeat(24000)})});
  assert.equal(huge.status,413);
  const echo=await webhook(app,event({mid:'m-echo',text:'Need gutters',echo:true}));
  assert.equal(echo.status,200);
  assert.equal(replies(app).length,0);
  assert.equal(app.store.db.prepare('SELECT COUNT(*) n FROM conversations').get().n,0);
});

test('simulator completes a synthetic conversation and prints the lead',async()=>{
  const script=fileURLToPath(new URL('../../tools/meta-intake-sim.mjs',import.meta.url));
  const child=spawn(process.execPath,[script],{stdio:['ignore','pipe','pipe']});
  let output='';child.stdout.on('data',chunk=>output+=chunk);child.stderr.on('data',chunk=>output+=chunk);
  const [code]=await once(child,'exit');
  assert.equal(code,0,output);
  assert.match(output,/Bot:/);
  assert.match(output,/Synthetic Customer/);
  assert.match(output,/Source: instagram/);
  assert.match(output,/239-355-3686/);
  assert.doesNotMatch(output,/\$\d/);
});

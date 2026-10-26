import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {openStore} from '../src/store.mjs';
import {validateCreate,validateEmail,sha} from '../src/protocol.mjs';
import {notificationConfig,dispatchNotification} from '../src/notifications.mjs';
import {createApp} from '../src/app.mjs';

const origin='https://gutters.example.invalid';
const config={from:'alerts@example.invalid',to:'owner@example.invalid',apiKey:'re_synthetic_server_key'};
function input(email){const answers=[{field:'name',state:'provided',answer:'Synthetic inquiry'},{field:'phone',state:'provided',answer:'2395550100'},{field:'details',state:'provided',answer:'Synthetic gutter repair'}];if(email!==undefined)answers.push({field:'email',state:'provided',answer:email});return {schemaVersion:2,conversationId:randomUUID(),operationId:randomUUID(),accessToken:'T'.repeat(43),intake:Object.fromEntries(answers.map(x=>[x.field,x.answer])),answers};}
function setup(t,{enabled=true}={}){const dir=mkdtempSync(path.join(tmpdir(),'gutters-email-')),clock={value:Date.UTC(2026,9,26,12)},file=path.join(dir,'gutters.sqlite3');let store=openStore(file,{now:()=>clock.value,notifications:enabled?config:null,publicOrigin:origin});t.after(()=>{store.close();rmSync(dir,{recursive:true,force:true});});return {clock,get store(){return store;},reopen(){store.close();store=openStore(file,{now:()=>clock.value,notifications:enabled?config:null,publicOrigin:origin});}};}
const accepted=()=>new Response(JSON.stringify({id:randomUUID()}),{status:200});

test('optional email is validated without changing legacy v2 hashes or the four quote fields',t=>{
  const x=setup(t),raw=input(),validated=validateCreate(raw);
  const fields=['name','phone','details','address','homeSize','stories','gutterLength'];
  const answers=fields.map(field=>raw.answers.find(x=>x.field===field)||{field,state:'later'});
  assert.equal(validated.hash,sha(JSON.stringify({schemaVersion:2,intake:raw.intake,answers})));
  x.store.create(validated);x.reopen();assert.equal(x.store.create(validateCreate(raw)).duplicate,true);
  assert.deepEqual(x.store.db.prepare('PRAGMA table_info(quote_details)').all().map(x=>x.name),['conversation_id','address','size_of_home','stories','gutter_length']);
  const email=input('customer+project@Example.invalid');x.store.create(validateCreate(email));
  assert.equal(x.store.view(email.conversationId,{owner:true}).conversation.repair.email,email.intake.email);
  for(const bad of ['a@b','a@b.invalid\r\nBcc: victim@example.invalid','a@example.invalid?subject=x','a..b@example.invalid','.a@example.invalid','a.@example.invalid','a@-example.invalid','a'.repeat(65)+'@example.invalid'])assert.throws(()=>validateEmail(bad));
  assert.equal(validateEmail('a+b@EXAMPLE.invalid'),'a+b@example.invalid');
});

test('atomic inquiry/reply notifications deduplicate exact retries and keep owner actions silent',t=>{
  const x=setup(t),raw=input('customer@example.invalid'),data=validateCreate(raw);
  x.store.create(data);x.store.create(data);
  const reply={operationId:randomUUID(),body:'Synthetic follow-up'};
  x.store.reply(raw.conversationId,reply,{token:raw.accessToken});x.store.reply(raw.conversationId,reply,{token:raw.accessToken});
  x.store.reply(raw.conversationId,{operationId:randomUUID(),body:'Owner answer'},{owner:true});
  const rows=x.store.db.prepare('SELECT * FROM owner_notifications').all();assert.equal(rows.length,2);
  assert.deepEqual(rows.map(x=>x.kind),['new_request','customer_reply']);
  for(const row of rows){const payload=JSON.parse(row.payload_json);assert.equal(payload.reply_to,'customer@example.invalid');assert.deepEqual(payload.to,[config.to]);assert.equal(payload.from,config.from);assert.ok(payload.text.includes(origin+'/owner'));assert.equal(payload.text.includes(raw.accessToken),false);assert.equal(payload.text.includes('#key='),false);}
  x.store.db.exec("CREATE TRIGGER reject_notice BEFORE INSERT ON owner_notifications BEGIN SELECT RAISE(ABORT,'synthetic failure'); END;");
  const rejected=input('other@example.invalid');assert.throws(()=>x.store.create(validateCreate(rejected)));
  assert.equal(x.store.db.prepare('SELECT COUNT(*) n FROM conversations').get().n,1);
  const before=x.store.view(raw.conversationId,{owner:true}).messages.length;
  assert.throws(()=>x.store.reply(raw.conversationId,{operationId:randomUUID(),body:'Must roll back'},{token:raw.accessToken}));
  assert.equal(x.store.view(raw.conversationId,{owner:true}).messages.length,before);
});

test('disabled notifications save requests without backfilling or calling any sender',async t=>{
  const x=setup(t,{enabled:false}),raw=input();x.store.create(validateCreate(raw));
  assert.equal(x.store.db.prepare('SELECT COUNT(*) n FROM owner_notifications').get().n,0);
  assert.equal(await dispatchNotification(x.store,null,{fetchImpl:()=>{throw Error('Must not call');}}),false);
  assert.equal(x.store.view(raw.conversationId,{owner:true}).notifications.enabled,false);
  assert.equal(notificationConfig({}),null);assert.equal(notificationConfig({GUTTERS_EMAIL_ENABLED:'false'}),null);
  assert.throws(()=>notificationConfig({GUTTERS_EMAIL_ENABLED:'yes'}));
  assert.throws(()=>notificationConfig({GUTTERS_EMAIL_ENABLED:'true',GUTTERS_EMAIL_FROM:config.from,GUTTERS_EMAIL_TO:config.to}));
});

test('lost provider acknowledgement retries the identical payload and key after reopening',async t=>{
  const x=setup(t),raw=input('customer@example.invalid');x.store.create(validateCreate(raw));
  const calls=[];const fake=async(url,options)=>{calls.push({url,...options});if(calls.length===1)throw Error('Synthetic lost acknowledgement');return accepted();};
  await dispatchNotification(x.store,config,{fetchImpl:fake});
  assert.equal(x.store.db.prepare('SELECT status FROM owner_notifications').get().status,'pending');
  x.reopen();x.clock.value+=30001;await dispatchNotification(x.store,config,{fetchImpl:fake});
  assert.equal(calls.length,2);assert.equal(calls[0].body,calls[1].body);assert.equal(calls[0].headers['Idempotency-Key'],calls[1].headers['Idempotency-Key']);assert.equal(calls[0].redirect,'error');
  assert.equal(x.store.db.prepare('SELECT status FROM owner_notifications').get().status,'accepted');
  assert.equal(await dispatchNotification(x.store,config,{fetchImpl:fake}),false);
});

test('leased work survives crashes and is held when the safe idempotency window expires',async t=>{
  const x=setup(t),raw=input();x.store.create(validateCreate(raw));const first=x.store.claimNotification();
  assert.equal(x.store.claimNotification(),null);x.reopen();assert.equal(x.store.claimNotification(),null);
  x.clock.value+=60001;const recovered=x.store.claimNotification();assert.equal(recovered.id,first.id);assert.equal(recovered.payload_json,first.payload_json);
  x.store.finishNotification(first,{status:'accepted',providerId:randomUUID()});assert.equal(x.store.db.prepare('SELECT status FROM owner_notifications').get().status,'processing','Stale worker cannot overwrite a newer claim.');
  x.clock.value+=23*3600000;let called=false;assert.equal(await dispatchNotification(x.store,config,{fetchImpl:()=>{called=true;return accepted();}}),false);assert.equal(called,false);
  assert.equal(x.store.db.prepare('SELECT status FROM owner_notifications').get().status,'uncertain');
});

test('sender changes, hard rejection and repeated unknown results need attention instead of unlimited delivery',async t=>{
  const x=setup(t);x.store.create(validateCreate(input()));let calls=0;
  await dispatchNotification(x.store,{...config,to:'another@example.invalid'},{fetchImpl:()=>{calls++;return accepted();}});assert.equal(calls,0);
  assert.equal(x.store.db.prepare('SELECT last_error FROM owner_notifications').get().last_error,'sender_configuration_changed');
  x.store.create(validateCreate(input()));await dispatchNotification(x.store,config,{fetchImpl:async()=>new Response('{}',{status:403})});
  assert.equal(x.store.db.prepare("SELECT COUNT(*) n FROM owner_notifications WHERE status='failed'").get().n,2);
  x.store.create(validateCreate(input()));
  for(let i=0;i<6;i++){await dispatchNotification(x.store,config,{fetchImpl:async()=>new Response('{"error":"do not store this private response"}',{status:500})});x.clock.value+=1000000;}
  const row=x.store.db.prepare("SELECT * FROM owner_notifications WHERE status='uncertain'").get();assert.equal(row.attempts,6);assert.equal(row.last_error,'delivery_unconfirmed');assert.equal(JSON.stringify(row).includes('do not store'),false);
});

test('a fixed daily attempt ceiling bounds sender traffic and old unsent inquiries expire',t=>{
  const x=setup(t);for(let i=0;i<51;i++)x.store.create(validateCreate(input()));
  for(let i=0;i<50;i++){const row=x.store.claimNotification();assert.ok(row);x.store.finishNotification(row,{status:'accepted',providerId:randomUUID()});}
  assert.equal(x.store.claimNotification(),null);assert.equal(x.store.db.prepare('SELECT COUNT(*) n FROM owner_notification_attempts').get().n,50);
  x.clock.value+=86400001;assert.equal(x.store.claimNotification(),null);assert.equal(x.store.db.prepare("SELECT COUNT(*) n FROM owner_notifications WHERE last_error='stale_inquiry'").get().n,1);
});

test('only authorized owner readback exposes alert state; customer data never contains sender configuration',async t=>{
  const app=createApp({dbPath:':memory:',ownerToken:'O'.repeat(43),publicOrigin:origin,allowedOrigins:['https://wisdomscreen.pro'],notifications:config});t.after(()=>app.close());
  const raw=input('customer@example.invalid');app.store.create(validateCreate(raw));
  const customer=await app.fetch(new Request(origin+'/conversations/'+raw.conversationId,{headers:{Origin:'https://wisdomscreen.pro',Authorization:'Bearer '+raw.accessToken}}));
  const data=await customer.json();assert.equal(Object.hasOwn(data,'notifications'),false);assert.equal(JSON.stringify(data).includes(config.apiKey),false);
  const owner=await app.fetch(new Request(origin+'/owner/api/conversations/'+raw.conversationId,{headers:{Authorization:'Bearer '+'O'.repeat(43)}}));
  const view=await owner.json();assert.equal(view.notifications.events[0].status,'pending');assert.equal(JSON.stringify(view).includes(config.apiKey),false);assert.equal(JSON.stringify(view).includes('payload_json'),false);
});

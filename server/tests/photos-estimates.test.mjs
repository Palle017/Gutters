import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync,writeFileSync,mkdirSync} from 'node:fs';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {randomBytes,randomUUID} from 'node:crypto';
import {Script} from 'node:vm';
import {createApp} from '../src/app.mjs';
import {QUESTIONS,PHOTO_MAX_BYTES} from '../src/protocol.mjs';
import {ownerHTML} from '../src/owner-ui.mjs';

const origin='https://gutters.example.invalid',external='https://palle017.github.io',key=()=>randomBytes(32).toString('base64url');
const png=Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+nv1kAAAAASUVORK5CYII=','base64');
function requestInput(){const answers=QUESTIONS.map(({field})=>['name','phone'].includes(field)?{field,state:'provided',answer:field==='name'?'Synthetic Customer':'239-555-0100'}:{field,state:'later'});return {schemaVersion:2,conversationId:randomUUID(),operationId:randomUUID(),accessToken:key(),answers,intake:{name:'Synthetic Customer',phone:'239-555-0100'}};}
function setup(t,{staticSite=false}={}){
  const dir=mkdtempSync(path.join(tmpdir(),'gutters-features-')),ownerToken=key(),siteRoot=staticSite?path.join(dir,'site'):null;
  if(siteRoot){mkdirSync(siteRoot);writeFileSync(path.join(siteRoot,'index.html'),'<!doctype html><h1>Synthetic site</h1>');writeFileSync(path.join(siteRoot,'script.js'),'console.log("synthetic")');writeFileSync(path.join(siteRoot,'.env'),'PRIVATE');writeFileSync(path.join(dir,'outside.txt'),'PRIVATE');}
  const options={dbPath:path.join(dir,'gutters.sqlite3'),ownerToken,publicOrigin:origin,allowedOrigins:[external],siteRoot};let app=createApp(options);
  const call=async(url,{method='GET',body,access,owner=false,originHeader=origin,form,raw,headers={}}={})=>{
    const req=new Request(origin+url,{method,headers:{...(originHeader?{Origin:originHeader}:{}),...(access||owner?{Authorization:'Bearer '+(access||ownerToken)}:{}),...(body?{'Content-Type':'application/json'}:{}),...headers},...(body?{body:JSON.stringify(body)}:form?{body:form}:raw!==undefined?{body:raw}:{})});
    const response=await app.fetch(req),type=response.headers.get('Content-Type')||'',data=type.includes('application/json')?await response.json():type.startsWith('image/')?Buffer.from(await response.arrayBuffer()):await response.text();return {response,status:response.status,data};
  };
  const upload=(id,access,{operationId=randomUUID(),bytes=png,name='project.png',mime='image/png',...rest}={})=>{const form=new FormData();form.set('operationId',operationId);form.set('file',new File([bytes],name,{type:mime}));return call('/conversations/'+id+'/photos',{method:'POST',form,access,...rest});};
  t.after(()=>{app.close();rmSync(dir,{recursive:true,force:true});});
  return {call,upload,ownerToken,options,get app(){return app;},reopen(){app.close();app=createApp(options);}};
}
async function create(x){const input=requestInput();assert.equal((await x.call('/conversations',{method:'POST',body:input})).status,201);return input;}

test('photo BLOB and stable receipt survive reopen; filename/content retry conflicts',async t=>{
  const x=setup(t),input=await create(x),operationId=randomUUID(),first=await x.upload(input.conversationId,input.accessToken,{operationId});
  assert.equal(first.status,201);assert.equal(first.data.photo.mime,'image/png');assert.equal(first.data.photo.size,png.length);assert.ok(first.data.receipt.photoId);
  x.reopen();const replay=await x.upload(input.conversationId,input.accessToken,{operationId});assert.equal(replay.data.duplicate,true);assert.deepEqual(replay.data.receipt,first.data.receipt);
  assert.equal((await x.upload(input.conversationId,input.accessToken,{operationId,name:'changed.png'})).status,409);
  const read=await x.call('/conversations/'+input.conversationId+'/photos/'+first.data.photo.id,{access:input.accessToken});assert.equal(read.status,200);assert.deepEqual(read.data,png);assert.equal(read.response.headers.get('Cache-Control'),'no-store');assert.equal(read.response.headers.get('X-Content-Type-Options'),'nosniff');
  const stored=x.app.store.db.prepare('SELECT bytes FROM photos').get();assert.deepEqual(Buffer.from(stored.bytes),png);
  const view=await x.call('/conversations/'+input.conversationId,{access:input.accessToken});assert.equal(view.data.photos.length,1);assert.equal('bytes' in view.data.photos[0],false);assert.equal('token' in view.data.photos[0],false);
  const receipt=await x.call('/conversations/'+input.conversationId+'/operations/'+operationId,{access:input.accessToken});assert.deepEqual(receipt.data.receipt,first.data.receipt);
});

test('customer photos require the matching capability; owner retrieval remains authorized',async t=>{
  const x=setup(t),a=await create(x),b=await create(x),photo=await x.upload(a.conversationId,a.accessToken);
  const route='/conversations/'+a.conversationId+'/photos/'+photo.data.photo.id;
  assert.equal((await x.call(route)).status,404);assert.equal((await x.call(route,{access:b.accessToken})).status,404);
  assert.equal((await x.call('/conversations/'+b.conversationId+'/photos/'+photo.data.photo.id,{access:b.accessToken})).status,404);
  assert.equal((await x.upload(a.conversationId,b.accessToken)).status,404);
  assert.equal((await x.call('/owner/api'+route,{access:a.accessToken})).status,401);
  assert.deepEqual((await x.call('/owner/api'+route,{owner:true})).data,png);
  assert.equal((await x.call(route,{access:a.accessToken,originHeader:external})).response.headers.get('Access-Control-Allow-Origin'),external);
  assert.equal((await x.call(route,{access:a.accessToken,originHeader:null})).status,200);
});

test('SVG, executable, truncated images and MIME/extension mismatches never enter SQLite',async t=>{
  const x=setup(t),input=await create(x);
  for(const value of [
    {bytes:Buffer.from('<svg onload="alert(1)"></svg>'),name:'project.svg',mime:'image/svg+xml'},
    {bytes:Buffer.from('MZ executable'),name:'project.png'},
    {bytes:png.subarray(0,30)},
    {mime:'image/jpeg'},
    {name:'project.jpg'},
    {name:'project.png.exe'},
  ])assert.equal((await x.upload(input.conversationId,input.accessToken,value)).status,415);
  assert.equal(x.app.store.db.prepare('SELECT COUNT(*) n FROM photos').get().n,0);
});

test('size and six-photo limits reject new writes while exact retries still work at capacity',async t=>{
  const x=setup(t),input=await create(x),operationId=randomUUID();
  assert.equal((await x.upload(input.conversationId,input.accessToken,{bytes:Buffer.alloc(PHOTO_MAX_BYTES+1)})).status,413);
  for(let index=0;index<6;index++)assert.equal((await x.upload(input.conversationId,input.accessToken,{operationId:index===0?operationId:randomUUID(),name:'project.png'})).status,201);
  const replay=await x.upload(input.conversationId,input.accessToken,{operationId});assert.equal(replay.status,201);assert.equal(replay.data.duplicate,true);
  assert.equal((await x.upload(input.conversationId,input.accessToken)).data.error,'photo_limit');assert.equal(x.app.store.db.prepare('SELECT COUNT(*) n FROM photos').get().n,6);
});

test('photo metadata and BLOB rollback together when receipt persistence fails',async t=>{
  const x=setup(t),input=await create(x);x.app.store.db.exec("CREATE TRIGGER synthetic_photo_fail BEFORE INSERT ON feature_operations BEGIN SELECT RAISE(ABORT,'synthetic receipt failure'); END;");
  assert.equal((await x.upload(input.conversationId,input.accessToken)).status,500);assert.equal(x.app.store.db.prepare('SELECT COUNT(*) n FROM photos').get().n,0);
});

test('manual draft is durable, owner-only and canonical USD; publication exposes one exact estimate/message',async t=>{
  const x=setup(t),input=await create(x),draft={operationId:randomUUID(),scope:'Synthetic gutter repair — customer supplied scope',amount:'1250.5',notes:'Synthetic site measurement required'},base='/owner/api/conversations/'+input.conversationId+'/estimates';
  const saved=await x.call(base,{method:'POST',body:draft,owner:true});assert.equal(saved.status,201);assert.equal(saved.data.estimate.amount,'1250.50');assert.equal(saved.data.estimate.status,'draft');assert.match(saved.data.estimate.number,/^ESG-\d{6}$/);
  x.reopen();const duplicate=await x.call(base,{method:'POST',body:draft,owner:true});assert.deepEqual(duplicate.data.receipt,saved.data.receipt);assert.equal(duplicate.data.duplicate,true);
  let guest=await x.call('/conversations/'+input.conversationId,{access:input.accessToken});assert.equal(guest.data.estimate,null);assert.equal(Object.hasOwn(guest.data,'estimates'),false);assert.equal(guest.data.messages.length,4);
  const publication={operationId:randomUUID()},sent=await x.call(base+'/'+saved.data.estimate.id+'/publish',{method:'POST',owner:true,body:publication});assert.equal(sent.status,200);assert.equal(sent.data.estimate.status,'published');assert.ok(sent.data.estimate.publishedAt);assert.ok(sent.data.receipt.messageId);
  x.reopen();const replay=await x.call(base+'/'+saved.data.estimate.id+'/publish',{method:'POST',owner:true,body:publication});assert.deepEqual(replay.data.receipt,sent.data.receipt);assert.equal(replay.data.duplicate,true);
  guest=await x.call('/conversations/'+input.conversationId,{access:input.accessToken});assert.deepEqual(guest.data.estimate,sent.data.estimate);assert.equal(guest.data.messages.length,5);assert.equal(guest.data.messages.at(-1).role,'owner');assert.match(guest.data.messages.at(-1).body,/Amount: \$1250\.50 USD/);
  assert.equal((await x.call(base+'/'+saved.data.estimate.id+'/publish',{method:'POST',owner:true,body:{operationId:randomUUID()}})).data.error,'estimate_already_published');
  assert.equal(x.app.store.db.prepare('SELECT COUNT(*) n FROM messages').get().n,5);
});

test('draft and publish operation conflicts, authorization and cross-conversation isolation are enforced',async t=>{
  const x=setup(t),a=await create(x),b=await create(x),draft={operationId:randomUUID(),scope:'Synthetic screen repair',amount:'100.00',notes:''},base='/owner/api/conversations/'+a.conversationId+'/estimates';
  assert.equal((await x.call(base,{method:'POST',body:draft,access:a.accessToken})).status,401);
  assert.equal((await x.call(base,{method:'POST',body:draft,owner:true,originHeader:external})).status,403);
  const saved=await x.call(base,{method:'POST',body:draft,owner:true});
  assert.equal((await x.call(base,{method:'POST',body:{...draft,amount:'101.00'},owner:true})).status,409);
  assert.equal((await x.call('/owner/api/conversations/'+b.conversationId+'/estimates/'+saved.data.estimate.id+'/publish',{method:'POST',body:{operationId:randomUUID()},owner:true})).status,404);
  assert.equal((await x.call('/conversations/'+a.conversationId+'/operations/'+draft.operationId,{access:a.accessToken})).status,404);
  assert.equal((await x.call('/conversations/'+a.conversationId+'/messages',{method:'POST',access:a.accessToken,body:{operationId:draft.operationId,body:'Reuse operation'}})).status,409);
  assert.equal((await x.call('/owner/api/conversations/'+a.conversationId+'/operations/'+draft.operationId,{owner:true})).data.receipt.estimateId,saved.data.estimate.id);
});

test('unpublished revision never replaces latest customer-visible published estimate',async t=>{
  const x=setup(t),input=await create(x),base='/owner/api/conversations/'+input.conversationId+'/estimates';
  const first=await x.call(base,{method:'POST',owner:true,body:{operationId:randomUUID(),scope:'Initial scope',amount:'100.00'}});
  await x.call(base+'/'+first.data.estimate.id+'/publish',{method:'POST',owner:true,body:{operationId:randomUUID()}});
  await x.call(base,{method:'POST',owner:true,body:{operationId:randomUUID(),scope:'Private revised scope',amount:'200.00'}});
  const guest=await x.call('/conversations/'+input.conversationId,{access:input.accessToken});assert.equal(guest.data.estimate.scope,'Initial scope');assert.equal(JSON.stringify(guest.data).includes('Private revised scope'),false);
  const owner=await x.call('/owner/api/conversations/'+input.conversationId,{owner:true});assert.equal(owner.data.estimates.length,2);assert.equal(owner.data.estimates[0].status,'draft');
});

test('publishing rolls back both customer message and draft status if durable receipt fails',async t=>{
  const x=setup(t),input=await create(x),base='/owner/api/conversations/'+input.conversationId+'/estimates',draft=await x.call(base,{method:'POST',owner:true,body:{operationId:randomUUID(),scope:'Synthetic scope',amount:'0.00'}});
  x.app.store.db.exec("CREATE TRIGGER synthetic_publish_fail BEFORE INSERT ON feature_operations WHEN NEW.kind='estimate-publish' BEGIN SELECT RAISE(ABORT,'synthetic failure'); END;");
  assert.equal((await x.call(base+'/'+draft.data.estimate.id+'/publish',{method:'POST',owner:true,body:{operationId:randomUUID()}})).status,500);
  assert.equal(x.app.store.db.prepare('SELECT published_at FROM estimates').get().published_at,null);assert.equal(x.app.store.db.prepare('SELECT COUNT(*) n FROM messages').get().n,4);
});

test('revocation denies new photos and estimate sends while retaining private owner access',async t=>{
  const x=setup(t),input=await create(x),photo=await x.upload(input.conversationId,input.accessToken),base='/owner/api/conversations/'+input.conversationId;
  const draft=await x.call(base+'/estimates',{method:'POST',owner:true,body:{operationId:randomUUID(),scope:'Synthetic scope',amount:'100'}});
  await x.call(base+'/revoke',{method:'POST',owner:true,body:{}});
  assert.equal((await x.upload(input.conversationId,input.accessToken)).status,410);
  assert.equal((await x.call('/conversations/'+input.conversationId+'/photos/'+photo.data.photo.id,{access:input.accessToken})).status,410);
  assert.equal((await x.call(base+'/photos/'+photo.data.photo.id,{owner:true})).status,200);
  assert.equal((await x.call(base+'/estimates/'+draft.data.estimate.id+'/publish',{method:'POST',owner:true,body:{operationId:randomUUID()}})).status,410);
});

test('same-origin reads work without Origin while cross-origin reads and missing-Origin writes fail',async t=>{
  const x=setup(t),input=await create(x);
  assert.equal((await x.call('/conversations/'+input.conversationId,{access:input.accessToken,originHeader:null})).status,200);
  assert.equal((await x.call('/conversations/'+input.conversationId,{access:input.accessToken,originHeader:'https://wrong.example.invalid'})).status,403);
  assert.equal((await x.call('/conversations/'+input.conversationId+'/messages',{access:input.accessToken,originHeader:null,method:'POST',body:{operationId:randomUUID(),body:'Synthetic'}})).status,403);
});

test('optional same-origin site serves only allowlisted public files; owner and APIs remain routed',async t=>{
  const x=setup(t,{staticSite:true});
  const homepage=await x.call('/',{originHeader:null});assert.equal(homepage.status,200);assert.match(homepage.data,/<h1>Synthetic site/);assert.match(homepage.response.headers.get('Content-Security-Policy'),/connect-src 'self'/);
  assert.equal((await x.call('/script.js')).status,200);assert.equal((await x.call('/script.js',{method:'HEAD'})).data,'');
  for(const route of ['/.env','/server/src/server.mjs','/%2e%2e/outside.txt','/%2eenv','/gutters.sqlite3'])assert.equal((await x.call(route)).status,404);
  assert.match((await x.call('/owner')).data,/Preview estimate/);assert.equal((await x.call('/owner/api/conversations',{owner:true})).status,200);
});

test('owner estimate page script compiles and keeps customer values in text-only rendering',()=>{
  const script=ownerHTML.match(/<script type="module">([\s\S]*?)<\/script>/)?.[1];assert.ok(script);assert.doesNotThrow(()=>new Script(script));
  assert.doesNotMatch(script,/innerHTML|document\.write|eval\(|localStorage|document\.cookie/);
  assert.match(script,/previewSignature/);assert.match(script,/estimateSignature\(loadedEstimate\)===previewSignature/);assert.match(script,/confirmed\.status!=='published'/);
});

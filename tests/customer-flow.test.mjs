import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {webcrypto} from 'node:crypto';
import {JSDOM} from 'jsdom';

const site = new URL('../site/', import.meta.url);
const id = '031fb16a-df6b-4fa7-abfe-7a337a75bf82';
const key = 'A'.repeat(43);
const response = data => new Response(JSON.stringify(data), {status: 200, headers: {'Content-Type': 'application/json'}});
async function waitFor(check) {
  const end = Date.now() + 1500;
  while (!check()) { if (Date.now() > end) throw Error('Timed out waiting for customer UI.'); await new Promise(resolve => setTimeout(resolve, 10)); }
}
async function load(page, script, fetch, fragment = '', setup) {
  const dom = new JSDOM(await readFile(new URL(page, site), 'utf8'), {url: 'http://127.0.0.1:18965/' + page + fragment, runScripts: 'outside-only'});
  Object.defineProperty(dom.window, 'crypto', {value: webcrypto});
  dom.window.fetch = (...args) => args[0] === '/healthz' ? Promise.resolve(response({ok: true, service: 'gutters-messaging'})) : fetch(dom.window, ...args); // availability probe: see tests/service-availability.test.mjs
  if (setup) await setup(dom.window);
  const common = (await readFile(new URL('js/request-api.js', site), 'utf8')).replace(/^export /gm, '');
  const entry = (await readFile(new URL('js/' + script, site), 'utf8')).replace(/^import .*?;\s*/m, '');
  dom.window.eval(common + '\n' + entry);
  return dom;
}

test('uncertain intake retry reuses the exact operation, capability and answers before showing confirmed success', async () => {
  const attempts = [];
  let failFirst = true;
  const dom = await load('estimate.html', 'estimate.js', (window, path, options) => {
    if (path === '/conversations') {
      const body = JSON.parse(options.body); attempts.push(body);
      const retained = JSON.parse(window.sessionStorage.getItem('everything-gutters.request.v2'));
      assert.deepEqual(retained.payload, body, 'retry payload was saved before transmission');
      if (failFirst) { failFirst = false; return Promise.reject(new window.TypeError('lost connection')); }
      return Promise.resolve(response({ok: true, conversation: {id: body.conversationId}, receipt: {operationId: body.operationId, sequence: 4}}));
    }
    return Promise.resolve(response({ok: true, conversation: {id: attempts[0].conversationId}, messages: [], photos: [], cursor: 0}));
  });
  try {
    const {document} = dom.window;
    document.querySelector('#name').value = 'Synthetic Customer'; document.querySelector('#phone').value = '(239) 555-0123'; document.querySelector('#details').value = 'Gutter repair';
    const form = document.querySelector('#estimate-form');
    form.dispatchEvent(new dom.window.Event('submit', {cancelable: true}));
    await waitFor(() => attempts.length === 1 && !document.querySelector('#submit-request').disabled);
    assert.equal(document.querySelector('#request-success').hidden, true);
    assert.equal(document.querySelector('#request-fields').disabled, true, 'submitted answers stay locked during an uncertain retry');
    form.dispatchEvent(new dom.window.Event('submit', {cancelable: true}));
    await waitFor(() => !document.querySelector('#request-success').hidden);
    assert.equal(attempts.length, 2);
    assert.deepEqual(attempts[1], attempts[0]);
    assert.match(document.querySelector('#request-status').textContent, /Saved and confirmed/);
    const link = new URL(document.querySelector('#open-request').href);
    assert.equal(link.search, ''); assert.ok(link.hash.includes('key='));
  } finally { dom.window.close(); }
});

test('a completed request can start another project while its private access and receipt remain available', async () => {
  const creates = [];
  const dom = await load('estimate.html', 'estimate.js', (window, path, options) => {
    if (path === '/conversations') {
      const body = JSON.parse(options.body); creates.push(body);
      return Promise.resolve(response({ok:true, conversation:{id:body.conversationId}, receipt:{operationId:body.operationId, sequence:4}}));
    }
    return Promise.resolve(response({ok:true, conversation:{id:path.split('/')[2]}, messages:[], photos:[], cursor:0}));
  });
  try {
    const {document} = dom.window;
    const form = document.querySelector('#estimate-form');
    document.querySelector('#name').value = 'First project'; document.querySelector('#phone').value = '2395550123';
    form.dispatchEvent(new dom.window.Event('submit',{cancelable:true}));
    await waitFor(() => !document.querySelector('#request-success').hidden);
    const firstLink = document.querySelector('#open-request').href;
    document.querySelector('#start-another-request').click();
    assert.equal(document.querySelector('#request-entry').hidden,false);
    assert.equal(document.querySelector('#request-fields').disabled,false);
    assert.equal(document.querySelector('#name').value,'');
    assert.equal(dom.window.sessionStorage.getItem('everything-gutters.request.v2'),null);
    const previous = JSON.parse(dom.window.sessionStorage.getItem('everything-gutters.completed-requests.v2'));
    assert.equal(previous.length,1); assert.equal(previous[0].receipt.operationId,creates[0].operationId);
    assert.equal(previous[0].payload.accessToken,creates[0].accessToken);
    assert.equal(document.querySelector('#previous-request-list a').href,firstLink);
    document.querySelector('#name').value = 'Second project'; document.querySelector('#phone').value = '2395550123';
    form.dispatchEvent(new dom.window.Event('submit',{cancelable:true}));
    await waitFor(() => creates.length===2 && !document.querySelector('#request-success').hidden);
    assert.notEqual(creates[0].conversationId,creates[1].conversationId);
    assert.notEqual(creates[0].operationId,creates[1].operationId);
    assert.notEqual(creates[0].accessToken,creates[1].accessToken);
    assert.notEqual(document.querySelector('#open-request').href,firstLink);
  } finally { dom.window.close(); }
});

test('bad photo names, extensions and content are rejected before creating a request', async () => {
  let calls=0;
  const dom = await load('estimate.html','estimate.js',()=>{calls++;throw Error('No upload should begin while choosing rejected photos.');});
  try {
    const {document} = dom.window;
    const cases=[['x'.repeat(151)+'.jpg','image/jpeg',new Uint8Array([255,216,255,0,0,0,0,0,0,0,255,217])],['wrong.png','image/png',new Uint8Array([1,2,3,4])],['mismatch.png','image/jpeg',new Uint8Array([255,216,255,0,0,0,0,0,0,0,255,217])]];
    const input=document.querySelector('#photos');
    for(const [name,type,bytes] of cases){
      const file=new dom.window.File([bytes],name,{type}); Object.defineProperty(file,'arrayBuffer',{value:async()=>bytes.buffer});
      Object.defineProperty(input,'files',{configurable:true,value:[file]});
      input.dispatchEvent(new dom.window.Event('change'));
      await waitFor(()=>!document.querySelector('#photo-error').hidden&&!document.querySelector('#submit-request').disabled);
      assert.equal(document.querySelector('#photo-list').children.length,0);
      assert.equal(calls,0);assert.equal(dom.window.sessionStorage.getItem('everything-gutters.request.v2'),null);
    }
  } finally {dom.window.close();}
});

test('rejected photo removal preserves uncertainty, then verifies absence and lets the next valid photo finish', async () => {
  const rejectedId='201fb16a-df6b-4fa7-abfe-7a337a75bf82', nextId='301fb16a-df6b-4fa7-abfe-7a337a75bf82', rejectedOp='401fb16a-df6b-4fa7-abfe-7a337a75bf82',nextOp='501fb16a-df6b-4fa7-abfe-7a337a75bf82';
  let uncertain=true, uploads=0;
  const bytes=new Uint8Array([255,216,255,0,0,0,0,0,0,0,255,217]);
  const hash=Buffer.from(await webcrypto.subtle.digest('SHA-256',bytes)).toString('hex');
  const initial={version:2,created:true,complete:false,payload:{schemaVersion:2,conversationId:id,accessToken:key,operationId:id,intake:{name:'Synthetic Customer',phone:'2395550123'},answers:[]},photos:[{id:rejectedId,operationId:rejectedOp,name:'rejected.jpg',status:'rejected',rejection:'Please use a supported photo.'},{id:nextId,operationId:nextOp,name:'valid.jpg',size:bytes.length,type:'image/jpeg',hash,status:'pending'}]};
  const dom=await load('estimate.html','estimate.js',(window,path,options)=>{
    if(path.endsWith('/operations/'+rejectedOp))return Promise.resolve(new Response(JSON.stringify({ok:false,error:uncertain?'storage_unavailable':'operation_unavailable'}),{status:uncertain?500:404,headers:{'Content-Type':'application/json'}}));
    if(options.method==='POST'){
      assert.ok(path.endsWith('/photos'));uploads++;
      assert.equal(options.body.get('operationId'),nextOp);
      return Promise.resolve(response({ok:true,photo:{id:nextId},receipt:{operationId:nextOp,photoId:nextId}}));
    }
    return Promise.resolve(response({ok:true,conversation:{id},messages:[],photos:[{id:nextId}],cursor:0}));
  },'',window=>{
    window.sessionStorage.setItem('everything-gutters.request.v2',JSON.stringify(initial));
    const file=new window.File([bytes],'valid.jpg',{type:'image/jpeg'});Object.defineProperty(file,'arrayBuffer',{value:async()=>bytes.buffer});
    const records=new Map([[nextId,{id:nextId,operationId:nextOp,hash,file}]]);
    const db={transaction(){const tx={};tx.objectStore=()=>({get(item){const request={};queueMicrotask(()=>{request.result=records.get(item);request.onsuccess?.();});return request;},delete(item){records.delete(item);queueMicrotask(()=>tx.oncomplete?.());}});return tx;}};
    window.indexedDB={open(){const request={};queueMicrotask(()=>{request.result=db;request.onsuccess?.();});return request;}};
  });
  try {
    const {document}=dom.window;
    document.querySelector('#photo-list button').click();
    await waitFor(()=>document.querySelector('#request-status').textContent.includes('kept for a safe retry'));
    assert.equal(uploads,0);
    assert.equal(JSON.parse(dom.window.sessionStorage.getItem('everything-gutters.request.v2')).photos[0].status,'rejected');
    uncertain=false;document.querySelector('#photo-list button').click();
    await waitFor(()=>!document.querySelector('#request-success').hidden);
    const saved=JSON.parse(dom.window.sessionStorage.getItem('everything-gutters.request.v2'));
    assert.equal(uploads,1);assert.equal(saved.photos[0].status,'removed');assert.equal(saved.photos[0].operationId,rejectedOp);assert.equal(saved.photos[1].status,'saved');assert.equal(saved.complete,true);
    assert.match(document.querySelector('#success-details').textContent,/1 photo/);
  } finally {dom.window.close();}
});

test('private page clears fragment, hides draft estimates, and retries a reply with the same operation', async () => {
  const replies = [];
  const messages = [];
  let firstReply = true;
  const dom = await load('customer.html', 'customer.js', (window, path, options) => {
    assert.equal(options.headers.Authorization, 'Bearer ' + key);
    assert.ok(!path.includes(key), 'capability never appears in an API path or query');
    if (options.method === 'POST') {
      const body = JSON.parse(options.body); replies.push(body);
      if (firstReply) { firstReply = false; return Promise.reject(new window.TypeError('lost connection')); }
      messages.push({id, operationId: body.operationId, sequence: 1, role: 'customer', body: body.body, createdAt: '2026-10-26T12:00:00Z'});
      return Promise.resolve(response({ok: true, receipt: {operationId: body.operationId, messageId: id, sequence: 1}}));
    }
    return Promise.resolve(response({ok: true, conversation: {id, repair: {name: 'Synthetic Customer', phone: '2395550123'}}, messages, photos: [], cursor: messages.length, estimate: {status: 'draft', amount: '12.34', scope: 'Not yet published'}}));
  }, '#id=' + id + '&key=' + key);
  try {
    const {document} = dom.window;
    await waitFor(() => !document.querySelector('#customer-content').hidden);
    assert.equal(dom.window.location.hash, '');
    assert.equal(JSON.parse(dom.window.sessionStorage.getItem('everything-gutters.customer.' + id)).key, key);
    assert.equal(document.querySelector('#published-estimate').hidden, true);
    document.querySelector('#message-body').value = 'Can you check the gutter corner?';
    const form = document.querySelector('#message-form');
    form.dispatchEvent(new dom.window.Event('submit', {cancelable: true}));
    await waitFor(() => replies.length === 1 && !document.querySelector('#send-message').disabled);
    assert.equal(document.querySelector('#message-body').readOnly, true);
    form.dispatchEvent(new dom.window.Event('submit', {cancelable: true}));
    await waitFor(() => replies.length === 2 && !document.querySelector('#send-message').disabled);
    assert.deepEqual(replies[0], replies[1]);
    assert.equal(document.querySelector('#message-body').value, '');
    assert.equal(document.querySelectorAll('.message-customer').length, 1);
    assert.equal(dom.window.sessionStorage.getItem('everything-gutters.pending-message.' + id), null);
  } finally { dom.window.close(); }
});

test('published estimate shows the exact supplied amount and renders owner text as text', async () => {
  const dom = await load('customer.html', 'customer.js', () => Promise.resolve(response({ok: true, conversation: {id, repair: {}}, messages: [], photos: [], cursor: 0, estimate: {id, number: 'ESG-1001', status: 'published', currency: 'USD', amount: '1234.50', scope: '<img src=x onerror=alert(1)> Repair gutter corner', notes: 'Discuss the discharge route.', publishedAt: '2026-10-26T12:00:00Z'}})), '#id=' + id + '&key=' + key);
  try {
    const {document} = dom.window;
    await waitFor(() => !document.querySelector('#published-estimate').hidden);
    assert.equal(document.querySelector('#estimate-amount').textContent, '$1,234.50');
    assert.equal(document.querySelector('#estimate-scope').querySelector('img'), null);
    assert.match(document.querySelector('#estimate-scope').textContent, /^<img src=x/);
    assert.equal(document.querySelector('#estimate-number').textContent, 'Estimate ESG-1001');
  } finally { dom.window.close(); }
});

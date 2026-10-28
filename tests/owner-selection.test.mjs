import test from 'node:test';
import assert from 'node:assert/strict';
import {webcrypto} from 'node:crypto';
import {JSDOM} from 'jsdom';
import {ownerHTML} from '../server/src/owner-ui.mjs';

const a='11111111-1111-4111-8111-111111111111',b='22222222-2222-4222-8222-222222222222',photo='33333333-3333-4333-8333-333333333333';
const pendingKey='gutters-owner-pending-v1';
const at='2026-10-26T12:00:00.000Z';
const quotes={
  [a]:{address:'SYNTHETIC A ADDRESS',size_of_home:'SYNTHETIC A SIZE',stories:1,gutter_length:'SYNTHETIC A LENGTH'},
  [b]:{address:'SYNTHETIC B ADDRESS',size_of_home:'SYNTHETIC B SIZE',stories:2,gutter_length:'SYNTHETIC B LENGTH'},
};
const json=(data,status=200)=>new Response(JSON.stringify(data),{status,headers:{'Content-Type':'application/json'}});
function view(id,photos=[]){return {ok:true,conversation:{id,repair:{name:id===a?'SYNTHETIC A':'SYNTHETIC B',phone:id===a?'2395550101':'2395550102',email:id===a?'a@example.invalid':'b@example.invalid'},expiresAt:'2027-01-01T00:00:00.000Z'},messages:[],cursor:0,quoteDetails:quotes[id],guestAccess:{active:true},photos,estimates:[]};}
function deferred(){let resolve;const promise=new Promise(done=>{resolve=done;});return {promise,resolve};}
async function wait(check){for(let i=0;i<200;i++){if(check())return;await new Promise(done=>setTimeout(done,10));}throw Error('Synthetic owner state did not settle.');}
function setup(t,respond,{pending}={}){
  const dom=new JSDOM(ownerHTML,{url:'https://owner.example.invalid/owner',runScripts:'outside-only'}),doc=dom.window.document,calls=[],created=[],revoked=[];
  Object.defineProperty(dom.window,'crypto',{value:webcrypto});Object.defineProperty(dom.window,'AbortController',{value:AbortController});
  if(pending)dom.window.sessionStorage.setItem(pendingKey,JSON.stringify(pending));
  dom.window.URL.createObjectURL=blob=>{const value='blob:synthetic-'+created.length;created.push({value,blob});return value;};
  dom.window.URL.revokeObjectURL=value=>revoked.push(value);
  dom.window.fetch=async(path,options={})=>{
    calls.push({path,method:options.method||'GET',body:options.body?JSON.parse(options.body):undefined,signal:options.signal});
    const result=await respond(path,options);
    if(result!==undefined)return result;
    if(path==='/owner/api/conversations')return json({ok:true,conversations:[a,b].map(id=>({id,name:id===a?'SYNTHETIC A':'SYNTHETIC B',createdAt:at,lastRole:'customer'})),nextCursor:null});
    if(path==='/owner/api/conversations/'+a+'?after=0')return json(view(a));
    if(path==='/owner/api/conversations/'+b+'?after=0')return json(view(b));
    if(options.method==='POST')return json({ok:true});
    throw Error('Unexpected synthetic request '+path);
  };
  dom.window.eval(ownerHTML.match(/<script type="module">([\s\S]*?)<\/script>/)[1]);
  t.after(()=>dom.window.close());
  const submit=id=>doc.getElementById(id).dispatchEvent(new dom.window.Event('submit',{cancelable:true}));
  const settled=()=>!doc.getElementById('refresh').disabled;
  const login=async()=>{doc.getElementById('owner-key').value='S'.repeat(43);submit('login-form');await wait(()=>!doc.getElementById('inbox').hidden&&settled());};
  const select=async id=>{doc.querySelector('[data-id="'+id+'"]').click();await wait(()=>doc.getElementById('customer').textContent===(id===a?'SYNTHETIC A':'SYNTHETIC B')&&settled());};
  return {dom,doc,calls,created,revoked,submit,settled,login,select};
}

test('a busy photo on B never retains A fields; explicit photo retry only repeats the read',async t=>{
  let photos=0;
  const x=setup(t,(path)=>{
    if(path==='/owner/api/conversations/'+b+'?after=0')return json(view(b,[{id:photo,filename:'synthetic.png'}]));
    if(path==='/owner/api/conversations/'+b+'/photos/'+photo)return ++photos===1?json({ok:false,error:'service_busy'},503):new Response(new Uint8Array([1,2,3]),{headers:{'Content-Type':'image/png'}});
  });
  await x.login();await x.select(a);await x.select(b);
  await wait(()=>!x.doc.getElementById('retry-photos').hidden);
  assert.match(x.doc.getElementById('photo-status').textContent,/busy/);
  assert.equal(x.doc.getElementById('address').value,quotes[b].address);
  assert.equal(x.doc.getElementById('customer-email').textContent,'b@example.invalid');
  assert.equal(x.doc.querySelector('#quote-form button').disabled,false);
  x.submit('quote-form');await wait(()=>x.calls.some(call=>call.method==='POST')&&x.settled());
  const write=x.calls.find(call=>call.method==='POST');
  assert.equal(write.path,'/owner/api/conversations/'+b+'/quote-details');assert.deepEqual(write.body,quotes[b]);
  x.doc.getElementById('retry-photos').click();await wait(()=>x.doc.querySelector('#photos img'));
  assert.equal(photos,2);assert.equal(x.calls.filter(call=>call.method==='POST').length,1);
  assert.equal(x.doc.getElementById('retry-photos').hidden,true);
});

test('a failed core selection clears A, blocks every write, and refresh can load B',async t=>{
  const load=deferred();let failed=false;
  const x=setup(t,path=>{if(path==='/owner/api/conversations/'+b+'?after=0'&&!failed)return load.promise;});
  await x.login();await x.select(a);
  x.doc.getElementById('estimate-scope').value='Old A draft';x.doc.getElementById('estimate-amount').value='12.34';
  x.doc.querySelector('[data-id="'+b+'"]').click();
  assert.equal(x.doc.getElementById('customer').textContent,'');assert.equal(x.doc.getElementById('address').value,'');assert.equal(x.doc.getElementById('estimate-scope').value,'');
  assert.equal(x.doc.getElementById('phone').hasAttribute('href'),false);
  failed=true;load.resolve(json({ok:false,error:'service_busy'},503));
  await wait(()=>x.settled()&&/service is busy/.test(x.doc.getElementById('status').textContent));
  for(const id of ['quote-form','reply-form','estimate-form']){x.submit(id);await new Promise(done=>setTimeout(done,0));}
  x.doc.getElementById('revoke').dispatchEvent(new x.dom.window.MouseEvent('click'));await new Promise(done=>setTimeout(done,0));
  assert.equal(x.calls.filter(call=>call.method==='POST').length,0);
  assert.equal(x.doc.querySelector('#quote-form button').disabled,true);
  x.doc.getElementById('refresh').click();await wait(()=>x.doc.getElementById('customer').textContent==='SYNTHETIC B'&&x.settled());
  assert.equal(x.doc.getElementById('address').value,quotes[b].address);
});

test('late A photos cannot enter B or a locked inbox and aborted reads expose no stale data',async t=>{
  const image=deferred();
  const x=setup(t,path=>{
    if(path==='/owner/api/conversations/'+a+'?after=0')return json(view(a,[{id:photo,filename:'synthetic.png'}]));
    if(path==='/owner/api/conversations/'+a+'/photos/'+photo)return image.promise;
  });
  await x.login();await x.select(a);
  const photoCall=x.calls.find(call=>call.path.includes('/photos/'));
  await x.select(b);assert.equal(photoCall.signal.aborted,true);
  image.resolve(new Response(new Uint8Array([1]),{headers:{'Content-Type':'image/png'}}));await new Promise(done=>setTimeout(done,20));
  assert.equal(x.created.length,0);assert.equal(x.doc.getElementById('customer').textContent,'SYNTHETIC B');
  x.doc.getElementById('lock').click();
  assert.equal(x.doc.getElementById('customer').textContent,'');assert.equal(x.doc.getElementById('address').value,'');
  assert.equal(x.doc.getElementById('inbox').hidden,true);
});

test('locking during a core read ignores its late response and permits a fresh login',async t=>{
  const load=deferred();
  const x=setup(t,path=>{if(path==='/owner/api/conversations/'+b+'?after=0')return load.promise;});
  await x.login();await x.select(a);x.doc.querySelector('[data-id="'+b+'"]').click();
  assert.equal(x.doc.getElementById('lock').disabled,false);x.doc.getElementById('lock').click();
  await x.login();load.resolve(json(view(b)));await new Promise(done=>setTimeout(done,20));
  assert.equal(x.doc.getElementById('selected').hidden,true);assert.equal(x.doc.getElementById('customer').textContent,'');
  await x.select(a);assert.equal(x.doc.getElementById('address').value,quotes[a].address);
});

test('locking an uncertain reply preserves its exact operation and reconciles before another write',async t=>{
  const write=deferred();let accepted=false,original;
  const x=setup(t,(path,options)=>{
    if(path.includes('/operations/'))return accepted?json({ok:true,receipt:{operationId:original.operationId}}):json({ok:false,error:'operation_unavailable'},404);
    if(path.endsWith('/messages')&&options.method==='POST'){original=JSON.parse(options.body);return write.promise;}
  });
  await x.login();await x.select(a);x.doc.getElementById('reply').value='Synthetic frozen reply';x.submit('reply-form');
  await wait(()=>original);const retained=x.dom.window.sessionStorage.getItem(pendingKey);
  x.doc.getElementById('lock').click();accepted=true;write.resolve(json({ok:true,receipt:{operationId:original.operationId}}));await new Promise(done=>setTimeout(done,20));
  assert.equal(x.dom.window.sessionStorage.getItem(pendingKey),retained);
  assert.equal(x.doc.getElementById('inbox').hidden,true);
  await x.login();assert.equal(x.doc.getElementById('reply').value,original.body);x.doc.getElementById('retry').click();
  await wait(()=>!x.dom.window.sessionStorage.getItem(pendingKey)&&x.settled());
  assert.equal(x.calls.filter(call=>call.path.endsWith('/messages')&&call.method==='POST').length,1);
});

test('a write 503 while photos load keeps the frozen reply for the same explicit retry',async t=>{
  const image=deferred();let attempts=0,accepted=0,original;
  const x=setup(t,(path,options)=>{
    if(path==='/owner/api/conversations/'+a+'?after=0')return json(view(a,[{id:photo,filename:'synthetic.png'}]));
    if(path==='/owner/api/conversations/'+a+'/photos/'+photo)return image.promise;
    if(path.includes('/operations/'))return accepted?json({ok:true,receipt:{operationId:original.operationId}}):json({ok:false,error:'operation_unavailable'},404);
    if(path.endsWith('/messages')&&options.method==='POST'){
      const body=JSON.parse(options.body);if(!original)original=body;else assert.deepEqual(body,original);
      if(++attempts===1)return json({ok:false,error:'service_busy'},503);
      accepted++;return json({ok:true,receipt:{operationId:body.operationId}});
    }
  });
  await x.login();await x.select(a);assert.match(x.doc.getElementById('photo-status').textContent,/Loading/);
  x.doc.getElementById('reply').value='Synthetic frozen busy reply';x.submit('reply-form');
  await wait(()=>attempts===1&&x.settled());
  const retained=x.dom.window.sessionStorage.getItem(pendingKey);
  assert.deepEqual(JSON.parse(retained),{id:a,operationId:original.operationId,body:original.body});
  assert.match(x.doc.getElementById('status').textContent,/busy.*Wait.*same pending action.*original details/s);
  assert.equal(x.doc.getElementById('reply').disabled,true);
  x.doc.getElementById('reply').value='A later edit must not replace the frozen reply';
  x.doc.getElementById('retry').click();await wait(()=>!x.dom.window.sessionStorage.getItem(pendingKey)&&x.settled());
  assert.equal(attempts,2);assert.equal(accepted,1);
  const writes=x.calls.filter(call=>call.path.endsWith('/messages')&&call.method==='POST');
  assert.deepEqual(writes[0].body,writes[1].body);
  assert.equal(writes[1].body.body,'Synthetic frozen busy reply');
  x.doc.getElementById('retry').dispatchEvent(new x.dom.window.MouseEvent('click'));await new Promise(done=>setTimeout(done,10));
  assert.equal(attempts,2);
  x.doc.getElementById('lock').click();image.resolve(json({ok:false,error:'service_busy'},503));
});

test('failed pending-request selection during login locks and clears private UI while retaining the pending action',async t=>{
  const pending={id:a,operationId:'44444444-4444-4444-8444-444444444444',body:'Synthetic retained login reply'};
  let unavailable=true;
  const x=setup(t,path=>{
    if(path==='/owner/api/conversations/'+a+'?after=0'&&unavailable)return json({ok:false,error:'service_busy'},503);
  },{pending});
  x.doc.getElementById('owner-key').value='S'.repeat(43);x.submit('login-form');
  await wait(()=>/could not finish opening/.test(x.doc.getElementById('status').textContent));
  assert.equal(x.doc.getElementById('inbox').hidden,true);assert.equal(x.doc.getElementById('login').hidden,false);
  assert.equal(x.doc.getElementById('lock').disabled,true);assert.equal(x.doc.getElementById('owner-key').value,'');
  assert.equal(x.doc.getElementById('list').childElementCount,0);assert.equal(x.doc.getElementById('customer').textContent,'');
  assert.equal(x.doc.getElementById('address').value,'');assert.equal(x.doc.getElementById('reply').value,'');
  assert.deepEqual(JSON.parse(x.dom.window.sessionStorage.getItem(pendingKey)),pending);
  unavailable=false;await x.login();assert.equal(x.doc.getElementById('customer').textContent,'SYNTHETIC A');
  assert.equal(x.doc.getElementById('reply').value,pending.body);
  assert.equal(x.calls.filter(call=>call.method==='POST').length,0);
});

test('successful selection focuses the loaded request; failed selection does not announce an empty heading',async t=>{
  let unavailable=true,focused=0;
  const x=setup(t,path=>path==='/owner/api/conversations/'+b+'?after=0'&&unavailable?json({ok:false,error:'service_busy'},503):undefined);
  x.doc.getElementById('customer').addEventListener('focus',()=>focused++);
  await x.login();await x.select(a);
  assert.equal(x.doc.activeElement,x.doc.getElementById('customer'));
  assert.equal(focused,1);
  assert.equal(x.doc.getElementById('created').textContent,'Received '+new Date(at).toLocaleString());
  const button=x.doc.querySelector('[data-id="'+b+'"]');button.focus();button.click();
  await wait(()=>x.settled()&&/service is busy/.test(x.doc.getElementById('status').textContent));
  assert.equal(focused,1);
  unavailable=false;x.doc.getElementById('refresh').click();
  await wait(()=>x.doc.getElementById('customer').textContent==='SYNTHETIC B'&&x.settled());
  assert.equal(x.doc.activeElement,x.doc.getElementById('customer'));
  assert.equal(focused,2);
  assert.equal(x.doc.querySelector('.back-to-requests').getAttribute('href'),'#requests-heading');
});

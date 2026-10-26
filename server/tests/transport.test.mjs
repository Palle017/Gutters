import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import net from 'node:net';
import {randomBytes,randomUUID} from 'node:crypto';
import {once} from 'node:events';
import {setTimeout as delay} from 'node:timers/promises';
import {createApp} from '../src/app.mjs';
import {createHTTPServer} from '../src/server.mjs';
import {validateCreate,PHOTO_MAX_BYTES} from '../src/protocol.mjs';

const publicOrigin='https://gutters.example.invalid',customerOrigin='https://customer.example.invalid';
const token=()=>randomBytes(32).toString('base64url');
function input(){return {schemaVersion:2,conversationId:randomUUID(),operationId:randomUUID(),accessToken:token(),intake:{name:'Synthetic transport test',phone:'239-555-0100'},answers:[{field:'name',state:'provided',answer:'Synthetic transport test'},{field:'phone',state:'provided',answer:'239-555-0100'}]};}
async function setup(t,options={}) {
  const ownerToken=token(),app=createApp({dbPath:':memory:',ownerToken,publicOrigin,allowedOrigins:[customerOrigin],clientKey:r=>r.headers.get('x-gutters-client-key'),now:()=>Date.UTC(2026,9,26,12)});
  const server=createHTTPServer(app,{publicOrigin,allowedOrigins:[customerOrigin],...options});
  server.listen(0,'127.0.0.1');await once(server,'listening');
  const port=server.address().port;
  t.after(async()=>{server.closeAllConnections();await new Promise(resolve=>server.close(resolve));app.close();});
  const customer=input();app.store.create(validateCreate(customer));
  const start=(pathname,{method='GET',headers={}}={})=>{
    let responseSeen=false;
    const req=http.request({host:'127.0.0.1',port,path:pathname,method,agent:false,headers:{Origin:customerOrigin,...headers}});
    const result=new Promise((resolve,reject)=>{
      req.on('response',res=>{
        responseSeen=true;const chunks=[];
        res.on('data',chunk=>chunks.push(chunk));res.on('error',reject);
        res.on('end',()=>{const bytes=Buffer.concat(chunks);resolve({status:res.statusCode,headers:res.headers,bytes,data:bytes.length&&res.headers['content-type']?.includes('application/json')?JSON.parse(bytes):null});});
      });
      req.on('error',error=>{if(!responseSeen)reject(error);});
    });
    // Aborts are asserted by callers but must not become transient unhandled rejections.
    result.catch(()=>{});
    return {req,result};
  };
  const call=async(pathname,{body,...options}={})=>{const x=start(pathname,options);x.req.end(body);return x.result;};
  const create=()=>call('/conversations',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(input())});
  const photoPath='/conversations/'+customer.conversationId+'/photos';
  return {app,server,port,customer,ownerToken,start,call,create,photoPath};
}
function multipart(size=PHOTO_MAX_BYTES) {
  const operationId=randomUUID(),boundary='synthetic-'+randomUUID();
  const bytes=Buffer.alloc(size,0);Buffer.from('89504e470d0a1a0a','hex').copy(bytes);bytes.write('IHDR',12);bytes.writeUInt32BE(1,16);bytes.writeUInt32BE(1,20);bytes.write('IEND',bytes.length-8);
  const body=Buffer.concat([Buffer.from('--'+boundary+'\r\nContent-Disposition: form-data; name="operationId"\r\n\r\n'+operationId+'\r\n--'+boundary+'\r\nContent-Disposition: form-data; name="file"; filename="synthetic.png"\r\nContent-Type: image/png\r\n\r\n'),bytes,Buffer.from('\r\n--'+boundary+'--\r\n')]);
  return {operationId,body,headers:{'Content-Type':'multipart/form-data; boundary='+boundary,'Content-Length':body.length}};
}
async function until(check) {for(let i=0;i<100;i++){if(await check())return;await delay(10);}assert.fail('Condition did not settle.');}

test('two real 5 MiB uploads exclude eight additional bodies while health/preflight/inbox remain available',async t=>{
  const x=await setup(t),uploads=[multipart(),multipart()];
  const holds=uploads.map(photo=>x.start(x.photoPath,{method:'POST',headers:{...photo.headers,Authorization:'Bearer '+x.customer.accessToken}}));
  for(const [i,hold] of holds.entries())hold.req.write(uploads[i].body.subarray(0,uploads[i].body.length-64));
  await delay(80);
  const rejected=await Promise.all(Array.from({length:8},()=>{const attempt=x.start(x.photoPath,{method:'POST',headers:{...uploads[0].headers,Authorization:'Bearer '+x.customer.accessToken}});attempt.req.write(uploads[0].body.subarray(0,256));return attempt.result;}));
  for(const out of rejected){assert.equal(out.status,503);assert.equal(out.data.error,'service_busy');assert.equal(out.headers['retry-after'],'5');assert.equal(out.headers['cache-control'],'no-store');assert.equal(out.headers['access-control-allow-origin'],customerOrigin);}
  assert.equal((await x.call('/healthz')).status,200);
  assert.equal((await x.call('/conversations',{method:'OPTIONS'})).status,204);
  assert.equal((await x.call('/owner/api/conversations',{headers:{Origin:publicOrigin,Authorization:'Bearer '+x.ownerToken}})).status,200);
  for(const [i,hold] of holds.entries())hold.req.end(uploads[i].body.subarray(-64));
  const completed=await Promise.all(holds.map(x=>x.result));for(const out of completed)assert.equal(out.status,201);
  const retried=await x.call(x.photoPath,{method:'POST',headers:{...uploads[0].headers,Authorization:'Bearer '+x.customer.accessToken},body:uploads[0].body});
  assert.equal(retried.status,201);assert.equal(retried.data.duplicate,true);
  assert.equal(x.app.store.db.prepare('SELECT COUNT(*) n FROM photos').get().n,2);
  assert.equal((await x.create()).status,201);
});

test('body slots release after malformed/oversized rejection and a disconnected partial upload',async t=>{
  const x=await setup(t,{maxBufferedRequests:1});
  const hold=x.start('/conversations',{method:'POST',headers:{'Content-Type':'application/json'}});hold.req.write('{');
  await delay(30);assert.equal((await x.create()).status,503);hold.req.destroy();
  await until(async()=>{const out=await x.create();return out.status===201;});
  for(const body of ['{','x'.repeat(25000)]){
    const out=await x.call('/conversations',{method:'POST',headers:{'Content-Type':'application/json'},body});
    assert.equal(out.status,body==='{'?400:413);assert.equal((await x.create()).status,201);
  }
  const streamed=x.start('/conversations',{method:'POST',headers:{'Content-Type':'application/json'}});streamed.req.write('x'.repeat(25000));
  assert.equal((await streamed.result).status,413);assert.equal((await x.create()).status,201);
  const denied=x.start(x.photoPath,{method:'POST',headers:{'Content-Type':'multipart/form-data; boundary=synthetic','Content-Length':'5000000',Authorization:'Bearer '+token()}});denied.req.write('partial');
  assert.equal((await denied.result).status,404);assert.equal((await x.create()).status,201);
});

test('absolute JSON deadline rejects trickled bytes, frees its slot, and photo upload receives its longer deadline',async t=>{
  const x=await setup(t,{requestDeadline:180,photoDeadline:700,maxBufferedRequests:1});
  const hold=x.start('/conversations',{method:'POST',headers:{'Content-Type':'application/json'}});hold.req.write('{');
  const started=Date.now(),trickle=setInterval(()=>{if(!hold.req.destroyed)hold.req.write(' ');},25);
  t.after(()=>clearInterval(trickle));
  const timeout=await hold.result;clearInterval(trickle);
  assert.equal(timeout.status,408);assert.equal(timeout.data.error,'request_timeout');assert.equal(timeout.headers['access-control-allow-origin'],customerOrigin);
  assert.ok(Date.now()-started<600,'Trickling must not reset the deadline.');
  assert.equal((await x.create()).status,201);
  const photo=multipart(256),upload=x.start(x.photoPath,{method:'POST',headers:{...photo.headers,Authorization:'Bearer '+x.customer.accessToken}});
  upload.req.write(photo.body.subarray(0,32));await delay(300);upload.req.end(photo.body.subarray(32));
  assert.equal((await upload.result).status,201);
  const slow=x.start(x.photoPath,{method:'POST',headers:{...multipart(256).headers,Authorization:'Bearer '+x.customer.accessToken}});slow.req.write('partial');
  assert.equal((await slow.result).status,408);assert.equal((await x.create()).status,201);
});

test('a stalled private photo response holds the shared cap until its deadline closes the connection',async t=>{
  const x=await setup(t,{maxBufferedRequests:1,photoDeadline:650,requestDeadline:180});
  const photo=multipart(),saved=await x.call(x.photoPath,{method:'POST',headers:{...photo.headers,Authorization:'Bearer '+x.customer.accessToken},body:photo.body});
  assert.equal(saved.status,201);
  const photoId=x.app.store.db.prepare('SELECT id FROM photos').get().id;
  // Windows loopback can queue an entire 5 MiB response even when the client
  // pauses. Delay the real socket's write completion to model backpressure
  // deterministically, without changing the HTTP handler or SQLite photo read.
  const completions=[];
  x.server.on('request',(req,res)=>{if(req.method==='GET'&&req.url.includes('/photos/')){
    const write=res.socket.write.bind(res.socket);
    res.socket.write=(chunk,encoding,callback)=>{
      if(typeof encoding==='function'){callback=encoding;encoding=undefined;}
      return write(chunk,encoding,typeof callback==='function'?()=>completions.push(callback):undefined);
    };
  }});
  t.after(()=>{for(const complete of completions)complete();});
  const socket=net.connect({host:'127.0.0.1',port:x.port,readableHighWaterMark:1024});socket.on('error',()=>{});t.after(()=>socket.destroy());
  await once(socket,'connect');socket.pause();
  socket.write('GET '+x.photoPath+'/'+photoId+' HTTP/1.1\r\nHost: gutters.example.invalid\r\nOrigin: '+customerOrigin+'\r\nAuthorization: Bearer '+x.customer.accessToken+'\r\n\r\n');
  await delay(60);
  assert.equal((await x.create()).status,503);
  assert.equal((await x.call('/healthz')).status,200);
  const crossOrigin=await x.call('/conversations',{method:'POST',headers:{Origin:'https://evil.invalid','Content-Type':'application/json'},body:'{}'});
  assert.equal(crossOrigin.status,503);assert.equal(crossOrigin.headers['access-control-allow-origin'],undefined);
  // The receiver never reads; the absolute response deadline destroys the socket.
  await delay(700);assert.equal((await x.create()).status,201);
});

test('normalized API paths require verified proxy identity while health and owner page stay probeable',async t=>{
  const x=await setup(t,{trustProxy:'tailscale'});
  for(const pathname of ['/healthz','/owner'])assert.equal((await x.call(pathname)).status,200);
  for(const pathname of ['/conversations',publicOrigin+'/conversations','/owner/../conversations','/%2e/conversations']){
    const out=await x.call(pathname,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(input())});assert.equal(out.status,400);assert.equal(out.data.error,'invalid_client_address');
  }
  const foreign=await x.call('https://evil.invalid/conversations',{method:'POST',headers:{'Content-Type':'application/json','X-Forwarded-For':'198.51.100.6'},body:JSON.stringify(input())});
  assert.equal(foreign.status,400);assert.equal(foreign.data.error,'invalid_request');
  const allowed=await x.call(publicOrigin+'/conversations',{method:'POST',headers:{'Content-Type':'application/json','X-Forwarded-For':'198.51.100.6'},body:JSON.stringify(input())});assert.equal(allowed.status,201);
});

test('connection ceiling rejects excess sockets and recovers when one closes',async t=>{
  const x=await setup(t,{maxConnections:2});
  const connect=()=>{const socket=net.connect({host:'127.0.0.1',port:x.port});socket.on('error',()=>{});t.after(()=>socket.destroy());return socket;};
  const a=connect(),b=connect();await Promise.all([once(a,'connect'),once(b,'connect')]);
  const rejected=connect();await once(rejected,'close');
  a.destroy();await until(()=>new Promise(resolve=>x.server.getConnections((error,count)=>resolve(!error&&count===1))));
  assert.equal((await x.call('/healthz')).status,200);
});

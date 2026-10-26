import http from 'node:http';
import path from 'node:path';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {createApp} from './app.mjs';
import {clientIdentity} from './client-ip.mjs';

// Pausing/cancelling a rejected body must not destroy its socket before the
// rejection response can be delivered. The response then closes that socket.
function requestBody(req) {
  let cleanup,abort;
  const stream=new ReadableStream({
    start(controller) {
      let active=true;
      const data=chunk=>{req.pause();controller.enqueue(chunk);};
      const end=()=>{cleanup();controller.close();};
      const error=()=>{cleanup();controller.error(Error('Request body disconnected.'));};
      cleanup=()=>{active=false;req.off('data',data);req.off('end',end);req.off('error',error);req.off('aborted',error);};
      abort=()=>{if(active){cleanup();controller.error(Error('Request body stopped.'));}req.resume();};
      req.on('data',data);req.once('end',end);req.once('error',error);req.once('aborted',error);
      req.pause();
    },
    pull(){req.resume();},
    cancel(){cleanup();req.pause();},
  });
  return {stream,abort:()=>abort()};
}

export function createHTTPServer(app,{
  publicOrigin,allowedOrigins=[],trustProxy='false',maxBufferedRequests=2,
  requestDeadline=15000,photoDeadline=75000,headersTimeout=10000,maxConnections=64,
}={}) {
  const configuredOrigin=new URL(publicOrigin).origin;
  if(configuredOrigin!==publicOrigin)throw Error('Use a canonical public origin.');
  for(const value of [maxBufferedRequests,requestDeadline,photoDeadline,headersTimeout,maxConnections])if(!Number.isSafeInteger(value)||value<1)throw Error('Invalid HTTP resource limit.');
  const origins=new Set([publicOrigin,...allowedOrigins]);
  let bufferedRequests=0;
  const server=http.createServer({connectionsCheckingInterval:1000},async(req,res)=>{
    // The reader also observes errors, but early rejections may have no reader.
    req.on('error',()=>{});
    let admitted=false,appDone=false,responseDone=false,timer,body;
    const release=()=>{
      if(!appDone||!responseDone)return;
      clearTimeout(timer);
      if(admitted){admitted=false;bufferedRequests--;}
    };
    const finished=()=>{responseDone=true;release();};
    res.once('finish',finished);
    res.once('close',()=>{body?.abort();finished();});
    const closeAfterResponse=()=>{
      res.shouldKeepAlive=false;
      res.setHeader('Connection','close');
      // Node closes the connection after its response flush; destroying the
      // incoming request here would reset an in-flight upload before it sees 503.
    };
    const reject=(status,error,extra={})=>{
      if(res.destroyed)return;
      body?.abort();
      req.resume();
      if(res.headersSent){res.destroy();return;}
      closeAfterResponse();
      const supplied=req.headers.origin;
      res.writeHead(status,{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store','X-Content-Type-Options':'nosniff',
        ...(origins.has(supplied)?{'Access-Control-Allow-Origin':supplied,'Vary':'Origin'}:{}),...extra});
      res.end(JSON.stringify({ok:false,error}));
    };
    try {
      let url;
      try{url=new URL(req.url,publicOrigin);}catch{reject(400,'invalid_request');return;}
      if(url.origin!==configuredOrigin||url.username||url.password){reject(400,'invalid_request');return;}
      const pathname=url.pathname;
      const isAPI=pathname==='/conversations'||pathname.startsWith('/conversations/')||pathname.startsWith('/owner/api/');
      const photoUpload=req.method==='POST'&&/^\/conversations\/[a-f0-9-]{36}\/photos$/.test(pathname);
      const photoDownload=req.method==='GET'&&/^\/(?:owner\/api\/)?conversations\/[a-f0-9-]{36}\/photos\/[a-f0-9-]{36}$/.test(pathname);
      const hasBody=Boolean(req.headers['transfer-encoding'])||Number(req.headers['content-length']||0)>0;
      if(hasBody||photoDownload){
        if(bufferedRequests>=maxBufferedRequests){reject(503,'service_busy',{'Retry-After':'5'});return;}
        bufferedRequests++;admitted=true;
      }
      // This timer is absolute: trickling bytes cannot extend it. Photo reads
      // hold the same slot while a slow peer retains the response buffer.
      timer=setTimeout(()=>reject(408,'request_timeout'),photoUpload||photoDownload?photoDeadline:requestDeadline);
      timer.unref();
      const headers=new Headers();
      for(const [key,value] of Object.entries(req.headers))if(value!==undefined&&!['x-gutters-client-key','oai-authenticated-user-id','oai-authenticated-user-email'].includes(key))headers.set(key,Array.isArray(value)?value.join(','):value);
      try{headers.set('x-gutters-client-key',isAPI?clientIdentity(req,trustProxy):req.socket.remoteAddress||'unknown');}
      catch{reject(400,'invalid_client_address');return;}
      if(!['GET','HEAD'].includes(req.method))body=requestBody(req);
      const request=new Request(url,{method:req.method,headers,...(body?{body:body.stream,duplex:'half'}:{})});
      const response=await app.fetch(request);
      if(res.destroyed||res.writableEnded)return;
      const payload=Buffer.from(await response.arrayBuffer());
      if(res.destroyed||res.writableEnded)return;
      // An early auth/size/validation rejection must not leave an unread body
      // holding a connection or permit a subsequent request on that connection.
      if(!req.complete){body?.abort();closeAfterResponse();}
      res.writeHead(response.status,Object.fromEntries(response.headers));res.end(payload);
    } catch {reject(500,'request_unavailable');}
    finally {appDone=true;release();}
  });
  // Node's parser bounds incomplete headers; route-specific absolute deadlines
  // above are stricter for JSON than the native maximum request timeout.
  server.requestTimeout=Math.max(requestDeadline,photoDeadline,headersTimeout);
  server.headersTimeout=headersTimeout;server.keepAliveTimeout=5000;
  server.maxConnections=maxConnections;
  return server;
}

function start() {
  const host=process.env.GUTTERS_BIND_HOST||'127.0.0.1';
  if(!['127.0.0.1','::1'].includes(host))throw Error('The messaging listener must stay on loopback behind its dedicated reverse proxy.');
  const port=Number(process.env.GUTTERS_PORT||18965);
  if(!Number.isInteger(port)||port<1024||port>65535)throw Error('Invalid GUTTERS_PORT.');
  const publicOrigin=process.env.GUTTERS_PUBLIC_ORIGIN||'http://127.0.0.1:'+port;
  const allowedOrigins=(process.env.GUTTERS_ALLOWED_ORIGINS||'https://palle017.github.io').split(',').map(x=>x.trim()).filter(Boolean);
  const app=createApp({
    dbPath:path.resolve(process.env.GUTTERS_DB_PATH||'data/gutters.sqlite3'),ownerToken:process.env.GUTTERS_OWNER_TOKEN,
    publicOrigin,allowedOrigins,clientKey:request=>request.headers.get('x-gutters-client-key')||'unknown',
    siteRoot:process.env.GUTTERS_SERVE_SITE==='true'?fileURLToPath(new URL('../../site/',import.meta.url)):null,
  });
  const server=createHTTPServer(app,{publicOrigin,allowedOrigins,trustProxy:process.env.GUTTERS_TRUST_PROXY||'false'});
  server.listen(port,host,()=>process.stdout.write(JSON.stringify({service:'gutters-messaging',listening:host+':'+port,storage:'sqlite'})+'\n'));
  let closing=false;
  function stop(){if(closing)return;closing=true;server.close(()=>{app.close();process.exit(0);});setTimeout(()=>process.exit(1),10000).unref();}
  process.on('SIGTERM',stop);process.on('SIGINT',stop);
}
if(process.argv[1]&&pathToFileURL(path.resolve(process.argv[1])).href===import.meta.url)start();

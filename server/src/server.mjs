import http from 'node:http';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {createApp} from './app.mjs';

const host=process.env.GUTTERS_BIND_HOST||'127.0.0.1';
if(!['127.0.0.1','::1'].includes(host))throw Error('The messaging listener must stay on loopback behind its dedicated reverse proxy.');
const port=Number(process.env.GUTTERS_PORT||18965);
if(!Number.isInteger(port)||port<1024||port>65535)throw Error('Invalid GUTTERS_PORT.');
const app=createApp({
  dbPath:path.resolve(process.env.GUTTERS_DB_PATH||'data/gutters.sqlite3'),
  ownerToken:process.env.GUTTERS_OWNER_TOKEN,
  publicOrigin:process.env.GUTTERS_PUBLIC_ORIGIN||'http://127.0.0.1:'+port,
  allowedOrigins:(process.env.GUTTERS_ALLOWED_ORIGINS||'https://palle017.github.io').split(',').map(x=>x.trim()).filter(Boolean),
  clientKey:request=>request.headers.get('x-gutters-client-key')||'unknown',
  siteRoot:process.env.GUTTERS_SERVE_SITE==='true'?fileURLToPath(new URL('../../site/',import.meta.url)):null,
});
const server=http.createServer(async(req,res)=>{
  try {
    const headers=new Headers();
    for(const [key,value] of Object.entries(req.headers))if(value!==undefined&&!['x-gutters-client-key','oai-authenticated-user-id','oai-authenticated-user-email'].includes(key))headers.set(key,Array.isArray(value)?value.join(','):value);
    // A dedicated proxy overwrites X-Real-IP; forwarded browser headers are otherwise ignored.
    const proxyIP=process.env.GUTTERS_TRUST_PROXY==='true'?req.headers['x-real-ip']:null;
    headers.set('x-gutters-client-key',typeof proxyIP==='string'&&/^[a-fA-F0-9:.]{3,64}$/.test(proxyIP)?proxyIP:req.socket.remoteAddress||'unknown');
    const origin=process.env.GUTTERS_PUBLIC_ORIGIN||'http://127.0.0.1:'+port;
    const request=new Request(new URL(req.url,origin),{method:req.method,headers,...(!['GET','HEAD'].includes(req.method)?{body:req,duplex:'half'}:{})});
    const response=await app.fetch(request);res.writeHead(response.status,Object.fromEntries(response.headers));res.end(Buffer.from(await response.arrayBuffer()));
  } catch {res.writeHead(500,{'Content-Type':'application/json','Cache-Control':'no-store'});res.end('{"ok":false,"error":"request_unavailable"}');}
});
// The browser allows a bounded 5 MiB photo upload 60 seconds, including slow phone connections.
server.requestTimeout=75000;server.headersTimeout=10000;server.keepAliveTimeout=5000;
server.listen(port,host,()=>process.stdout.write(JSON.stringify({service:'gutters-messaging',listening:host+':'+port,storage:'sqlite'})+'\n'));
let closing=false;
function stop(){if(closing)return;closing=true;server.close(()=>{app.close();process.exit(0);});setTimeout(()=>process.exit(1),10000).unref();}
process.on('SIGTERM',stop);process.on('SIGINT',stop);

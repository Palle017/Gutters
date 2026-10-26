import {openStore} from './store.mjs';
import {ownerHTML} from './owner-ui.mjs';
import {UUID,sha,equal,fail,bearer,validateCreate,validateMessage,validateQuote,exactKeys} from './protocol.mjs';

const SECURITY={'Cache-Control':'no-store','X-Content-Type-Options':'nosniff','Referrer-Policy':'no-referrer','X-Robots-Tag':'noindex, nofollow, noarchive'};
const CSP="default-src 'none'; style-src 'unsafe-inline'; script-src 'unsafe-inline'; connect-src 'self'; img-src 'none'; base-uri 'none'; frame-ancestors 'none'; form-action 'self'";
export function createApp({dbPath,ownerToken,publicOrigin,allowedOrigins=[],now=Date.now,clientKey=()=> 'unknown',bodyLimit=24000}={}) {
  if(!dbPath) throw Error('GUTTERS_DB_PATH is required.');
  if(typeof ownerToken!=='string'||!/^[A-Za-z0-9_-]{43}$/.test(ownerToken)) throw Error('GUTTERS_OWNER_TOKEN must be a random 32-byte base64url key.');
  function origin(value){const url=new URL(value);if(url.origin!==value||url.username||url.password||url.protocol!=='https:'&&!(url.protocol==='http:'&&['127.0.0.1','localhost','[::1]'].includes(url.hostname)))throw Error('Use a canonical HTTPS origin or explicit loopback preview.');return value;}
  publicOrigin=origin(publicOrigin);
  const origins=new Set(allowedOrigins.map(origin));
  const store=openStore(dbPath,{now});
  const result=(request,status,body,extra={})=>{
    const cors=origins.has(request.headers.get('Origin'))?{'Access-Control-Allow-Origin':request.headers.get('Origin'),'Vary':'Origin'}:{};
    return new Response(status===204?null:JSON.stringify(body),{status,headers:{...SECURITY,...cors,'Content-Type':'application/json; charset=utf-8',...extra}});
  };
  const requireOrigin=request=>{if(!origins.has(request.headers.get('Origin')))throw fail(403,'origin_not_allowed');};
  const requireOwner=request=>{
    if(!equal(bearer(request),ownerToken))throw fail(401,'owner_auth_required');
    const supplied=request.headers.get('Origin');
    if(request.method!=='GET'&&request.method!=='HEAD'&&supplied!==publicOrigin)throw fail(403,'owner_origin_required');
    if(supplied&&supplied!==publicOrigin)throw fail(403,'owner_origin_required');
  };
  const body=async request=>{
    if(!/^application\/json(?:;|$)/i.test(request.headers.get('Content-Type')||''))throw fail(415,'json_required');
    const declared=Number(request.headers.get('Content-Length')||0);if(declared>bodyLimit)throw fail(413,'request_too_large');
    const reader=request.body?.getReader();if(!reader)throw fail(400,'invalid_json');
    const chunks=[];let size=0;
    try{for(;;){const part=await reader.read();if(part.done)break;size+=part.value.length;if(size>bodyLimit){await reader.cancel();throw fail(413,'request_too_large');}chunks.push(part.value);}}finally{reader.releaseLock();}
    try{return JSON.parse(Buffer.concat(chunks,size).toString('utf8'));}catch{throw fail(400,'invalid_json');}
  };
  async function fetch(request) {
    try {
      const url=new URL(request.url),path=url.pathname;
      if(path==='/healthz'&&request.method==='GET')return result(request,200,{ok:true,storage:'sqlite',service:'gutters-messaging'});
      if((path==='/owner'||path==='/owner/')&&request.method==='GET')return new Response(ownerHTML,{headers:{...SECURITY,'Content-Type':'text/html; charset=utf-8','Content-Security-Policy':CSP}});
      if(path==='/')return result(request,200,{ok:true,service:'gutters-messaging'});
      if(path.startsWith('/owner/api/')) {
        if(!equal(bearer(request),ownerToken)) store.rate('owner-auth:'+sha(clientKey(request)),30);
        requireOwner(request);
        store.rate('owner-read:'+sha(clientKey(request)),240);
        if(path==='/owner/api/conversations'&&request.method==='GET')return result(request,200,store.list({cursor:url.searchParams.get('cursor')||undefined}));
        const match=path.match(/^\/owner\/api\/conversations\/([a-f0-9-]{36})(?:\/(messages|operations|quote-details|revoke)(?:\/([a-f0-9-]{36}))?)?$/);
        if(!match||!UUID.test(match[1])||match[3]&&!UUID.test(match[3]))throw fail(404,'route_unavailable');
        const [,id,action,operationId]=match;
        if(!action&&request.method==='GET')return result(request,200,store.view(id,{after:after(url),owner:true}));
        if(action==='operations'&&operationId&&request.method==='GET')return result(request,200,store.operationReceipt(id,operationId,{owner:true}));
        if(action==='messages'&&!operationId&&request.method==='POST')return result(request,201,store.reply(id,validateMessage(await body(request)),{owner:true}));
        if(action==='quote-details'&&request.method==='POST')return result(request,200,store.updateQuote(id,validateQuote(await body(request))));
        if(action==='revoke'&&request.method==='POST'){const value=await body(request);exactKeys(value,[]);return result(request,200,store.revoke(id));}
        throw fail(405,'method_not_allowed');
      }
      if(path==='/conversations'||path.startsWith('/conversations/')) {
        requireOrigin(request);
        if(request.method==='OPTIONS')return result(request,204,null,{'Access-Control-Allow-Methods':'GET, POST, OPTIONS','Access-Control-Allow-Headers':'Authorization, Content-Type','Access-Control-Max-Age':'600'});
        const key=sha(clientKey(request));
        store.rate('request:'+key,240);
        if(path==='/conversations'&&request.method==='POST') {
          store.rate('create:'+key,12);store.rate('create-global',120);
          return result(request,201,store.create(validateCreate(await body(request))));
        }
        const match=path.match(/^\/conversations\/([a-f0-9-]{36})(?:\/(messages|operations)(?:\/([a-f0-9-]{36}))?)?$/);
        if(!match||!UUID.test(match[1])||match[3]&&!UUID.test(match[3]))throw fail(404,'route_unavailable');
        const [,id,action,operationId]=match,token=bearer(request);
        store.guest(id,token);
        if(!action&&request.method==='GET')return result(request,200,store.view(id,{after:after(url)}));
        if(action==='operations'&&operationId&&request.method==='GET')return result(request,200,store.operationReceipt(id,operationId,{token}));
        if(action==='messages'&&!operationId&&request.method==='POST'){store.rate('reply:'+id,60);return result(request,201,store.reply(id,validateMessage(await body(request)),{token}));}
        throw fail(405,'method_not_allowed');
      }
      throw fail(404,'route_unavailable');
    } catch(error) {
      const status=error.status||500,code=error.status?error.code:'storage_unavailable';
      return result(request,status,{ok:false,error:code},status===429?{'Retry-After':'60'}:{});
    }
  }
  return {fetch,store,close:()=>store.close()};
}
function after(url) {
  const value=url.searchParams.get('after')||'0';
  if(!/^\d{1,7}$/.test(value)||!Number.isSafeInteger(Number(value)))throw fail(400,'invalid_cursor');
  return Number(value);
}

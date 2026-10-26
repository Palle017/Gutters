import path from 'node:path';
import {readFile,realpath,stat} from 'node:fs/promises';

const TYPES={'.html':'text/html; charset=utf-8','.css':'text/css; charset=utf-8','.js':'text/javascript; charset=utf-8','.mjs':'text/javascript; charset=utf-8','.svg':'image/svg+xml','.png':'image/png','.jpg':'image/jpeg','.jpeg':'image/jpeg','.webp':'image/webp','.ico':'image/x-icon','.woff2':'font/woff2','.txt':'text/plain; charset=utf-8','.xml':'application/xml; charset=utf-8'};
const CSP="default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' blob: data:; connect-src 'self'; font-src 'self'; base-uri 'self'; frame-ancestors 'none'; form-action 'self'; object-src 'none'";
export async function staticResponse(root,url,method='GET'){
  let pathname;try{pathname=decodeURIComponent(url.pathname);}catch{return null;}
  if(pathname.includes('\\')||pathname.includes('\0')||pathname.split('/').some(x=>x.startsWith('.')))return null;
  const relative=pathname==='/'?'index.html':pathname.replace(/^\/+/,''),extension=path.extname(relative).toLowerCase();
  if(!TYPES[extension])return null;
  try{
    const base=await realpath(root),target=await realpath(path.resolve(base,relative));
    if(!target.startsWith(base+path.sep)||!(await stat(target)).isFile())return null;
    const content=await readFile(target);
    return new Response(method==='HEAD'?null:content,{headers:{'Content-Type':TYPES[extension],'Content-Length':String(content.length),'Cache-Control':'no-store','X-Content-Type-Options':'nosniff','Referrer-Policy':'no-referrer','Content-Security-Policy':CSP}});
  }catch{return null;}
}

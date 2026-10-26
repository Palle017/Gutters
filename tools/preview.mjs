import http from 'node:http';
import {readFile} from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';

const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'../site');
const argument=process.argv.find(value=>value.startsWith('--port='));
const port=argument?Number(argument.split('=')[1]):18964;
const types={'.html':'text/html; charset=utf-8','.css':'text/css; charset=utf-8','.js':'text/javascript; charset=utf-8','.svg':'image/svg+xml','.png':'image/png','.jpg':'image/jpeg','.webp':'image/webp','.txt':'text/plain; charset=utf-8'};
const server=http.createServer(async(req,res)=>{
  try {
    const url=new URL(req.url,'http://127.0.0.1');
    if(!['GET','HEAD'].includes(req.method)) {res.writeHead(405).end();return;}
    let route=decodeURIComponent(url.pathname);
    if(route.startsWith('/Gutters/'))route=route.slice('/Gutters'.length);
    if(route.endsWith('/'))route+='index.html';
    if(!path.posix.extname(route))route+='.html';
    const file=path.resolve(root,'.'+route);
    if(!file.startsWith(root+path.sep))throw Error('path');
    const data=await readFile(file);
    res.writeHead(200,{'Content-Type':types[path.extname(file)]||'application/octet-stream','Cache-Control':'no-store','X-Content-Type-Options':'nosniff'});
    res.end(req.method==='HEAD'?undefined:data);
  }catch{res.writeHead(404,{'Content-Type':'text/plain'}).end('Not found');}
});
server.listen(port,'127.0.0.1',()=>console.log(`Gutters preview http://127.0.0.1:${port}/Gutters/`));

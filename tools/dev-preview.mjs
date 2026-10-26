import {mkdir,readFile,writeFile} from 'node:fs/promises';
import {randomBytes} from 'node:crypto';
import {spawn} from 'node:child_process';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const state=path.join(root,'.preview-data');
await mkdir(state,{recursive:true,mode:0o700});
const keyFile=path.join(state,'owner-access.json');
let config;
try{config=JSON.parse(await readFile(keyFile,'utf8'));}catch(error){if(error.code!=='ENOENT')throw error;config={ownerToken:randomBytes(32).toString('base64url')};await writeFile(keyFile,JSON.stringify(config)+'\n',{mode:0o600,flag:'wx'});}
if(!/^[A-Za-z0-9_-]{43}$/.test(config.ownerToken))throw Error('Invalid preview owner key.');
const port=Number(process.env.GUTTERS_PREVIEW_PORT||18966);
const origin='http://127.0.0.1:'+port;
const child=spawn(process.execPath,['server/src/server.mjs'],{cwd:root,stdio:'inherit',windowsHide:true,env:{...process.env,GUTTERS_PORT:String(port),GUTTERS_BIND_HOST:'127.0.0.1',GUTTERS_PUBLIC_ORIGIN:origin,GUTTERS_ALLOWED_ORIGINS:origin,GUTTERS_DB_PATH:path.join(state,'gutters-preview.sqlite3'),GUTTERS_OWNER_TOKEN:config.ownerToken,GUTTERS_SERVE_SITE:'true'}});
console.log('Local website: '+origin+'/');
console.log('Owner review: '+origin+'/owner');
console.log('Owner access key is saved locally in .preview-data/owner-access.json (never included in the site build).');
process.on('SIGINT',()=>child.kill('SIGINT'));process.on('SIGTERM',()=>child.kill('SIGTERM'));child.on('exit',code=>process.exit(code||0));

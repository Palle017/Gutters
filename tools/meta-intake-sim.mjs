#!/usr/bin/env node
// Local Meta intake simulator. It signs webhook payloads, posts them to the
// Gutters app in this process, and prints bot replies plus the saved lead.
// It uses a temporary SQLite file and the dry-run sender. No Graph call is made.
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {createHmac,randomBytes} from 'node:crypto';
import {createApp} from '../server/src/app.mjs';

const secret='simulator-app-secret';
const origin='http://127.0.0.1:18965';
const args=process.argv.slice(2);
let availabilityPath=null;
for(let index=0;index<args.length;index++)if(args[index]==='--availability')availabilityPath=args[++index]||null;
const directory=mkdtempSync(path.join(tmpdir(),'gutters-meta-sim-'));
const app=createApp({
  dbPath:path.join(directory,'gutters.sqlite3'),
  ownerToken:randomBytes(32).toString('base64url'),
  publicOrigin:origin,
  allowedOrigins:[origin],
  meta:{enabled:true,verifyToken:'simulator-verify-token',appSecret:secret,pageAccessToken:'',sendMode:'dry-run',graphVersion:'v21.0',availabilityPath,llm:{enabled:false}},
});
const sign=raw=>'sha256='+createHmac('sha256',secret).update(raw).digest('hex');
const turns=[
  'Need new gutters along the back of the house',
  'Synthetic Customer',
  '239-555-0148',
  '100 Example Lane, Fort Myers, FL',
  availabilityPath?'1':'Tuesday after 10',
];
let seen=0;
try{
  for(let index=0;index<turns.length;index++){
    const text=turns[index];
    const payload=JSON.stringify({object:'instagram',entry:[{id:'17890000000000001',time:1,messaging:[{sender:{id:'ig-sim'},recipient:{id:'17890000000000001'},timestamp:1,message:{mid:'sim-'+index,text}}]}]});
    const response=await app.fetch(new Request(origin+'/meta/webhook',{method:'POST',headers:{'Content-Type':'application/json','X-Hub-Signature-256':sign(payload)},body:payload}));
    if(response.status!==200)throw Error('Webhook returned '+response.status);
    const rows=app.store.db.prepare('SELECT sequence,body FROM meta_outbound ORDER BY sequence').all();
    console.log('Customer: '+text);
    for(const row of rows.slice(seen))console.log('Bot: '+row.body);
    seen=rows.length;
  }
  const lead=app.store.list().conversations[0];
  if(!lead)throw Error('No lead was saved.');
  const view=app.store.view(lead.id,{owner:true});
  console.log('Lead: '+JSON.stringify({id:lead.id,name:lead.name,phone:lead.phone,channel:lead.channel,quoteDetails:view.quoteDetails,details:view.messages.filter(message=>message.role==='customer').map(message=>message.body)},null,2));
}catch(error){
  console.error(error.message);
  process.exitCode=1;
}finally{
  app.close();
  rmSync(directory,{recursive:true,force:true});
}

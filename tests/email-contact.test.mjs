import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {randomUUID,webcrypto} from 'node:crypto';
import {JSDOM} from 'jsdom';
import {createApp} from '../server/src/app.mjs';
import {validateCreate} from '../server/src/protocol.mjs';
import {ownerHTML} from '../server/src/owner-ui.mjs';

async function waitFor(check){for(let i=0;i<100;i++){if(check())return;await new Promise(resolve=>setTimeout(resolve,10));}throw Error('UI state did not settle.');}
const origin='https://gutters.example.invalid';
test('customer email is optional, validated before transmission, and retained in the original retry payload',async()=>{
  const html=await readFile(new URL('../site/estimate.html',import.meta.url),'utf8');
  const common=(await readFile(new URL('../site/js/request-api.js',import.meta.url),'utf8')).replace(/^export /gm,'');
  const entry=(await readFile(new URL('../site/js/estimate.js',import.meta.url),'utf8')).replace(/^import .*?;\s*/m,'');
  const dom=new JSDOM(html,{url:origin+'/estimate.html',runScripts:'outside-only'});Object.defineProperty(dom.window,'crypto',{value:webcrypto});
  const calls=[];dom.window.fetch=async(path,options={})=>{if(path==='/healthz')return new Response(JSON.stringify({ok:true,service:'gutters-messaging',storage:'sqlite',capabilities:{replyEmail:true}}));if(path==='/conversations'){calls.push(JSON.parse(options.body));throw new dom.window.TypeError('Synthetic lost acknowledgement');}throw Error('Unexpected read');};
  dom.window.eval(common+'\n'+entry);
  try{
    const doc=dom.window.document,form=doc.querySelector('form'),email=doc.querySelector('#email');
    await waitFor(()=>!email.disabled);
    assert.equal(email.required,false);assert.equal(email.type,'email');assert.equal(email.autocomplete,'email');
    doc.querySelector('#name').value='Synthetic reply contact';doc.querySelector('#phone').value='2395550100';email.value='not-an-email';
    form.dispatchEvent(new dom.window.Event('submit',{cancelable:true}));assert.equal(email.checkValidity(),false);
    assert.equal(calls.length,0);
    email.value='customer+project@example.invalid';form.dispatchEvent(new dom.window.Event('submit',{cancelable:true}));await waitFor(()=>calls.length===1&&!doc.querySelector('#submit-request').disabled);
    form.dispatchEvent(new dom.window.Event('submit',{cancelable:true}));await waitFor(()=>calls.length===2);
    assert.deepEqual(calls[0],calls[1]);assert.equal(calls[0].intake.email,email.value);assert.equal(calls[0].answers.at(-1).field,'email');assert.equal(validateCreate(calls[0]).intake.email,email.value);
  }finally{dom.window.close();}
});

test('owner can open the supplied reply email and sees honest disabled alert status',async()=>{
  const token='O'.repeat(43),app=createApp({dbPath:':memory:',ownerToken:token,publicOrigin:origin});
  const raw={schemaVersion:2,conversationId:randomUUID(),operationId:randomUUID(),accessToken:'T'.repeat(43),intake:{name:'Synthetic email contact',phone:'2395550100',email:'customer+project@example.invalid'},answers:[{field:'name',state:'provided',answer:'Synthetic email contact'},{field:'phone',state:'provided',answer:'2395550100'},{field:'email',state:'provided',answer:'customer+project@example.invalid'}]};
  app.store.create(validateCreate(raw));
  const dom=new JSDOM(ownerHTML,{url:origin+'/owner',runScripts:'outside-only'});Object.defineProperty(dom.window,'crypto',{value:webcrypto});Object.defineProperty(dom.window,'AbortController',{value:AbortController});
  dom.window.fetch=(url,options={})=>app.fetch(new Request(origin+url,{...options,headers:{...options.headers,Origin:origin}}));
  dom.window.eval(ownerHTML.match(/<script type="module">([\s\S]*?)<\/script>/)[1]);
  try{
    const doc=dom.window.document;doc.querySelector('#owner-key').value=token;doc.querySelector('#login-form').dispatchEvent(new dom.window.Event('submit',{cancelable:true}));
    await waitFor(()=>!doc.querySelector('#inbox').hidden&&!doc.querySelector('#refresh').disabled);doc.querySelector('#list button').click();
    await waitFor(()=>!doc.querySelector('#customer-email').hidden);
    assert.equal(doc.querySelector('#customer-email').textContent,raw.intake.email);assert.equal(decodeURIComponent(doc.querySelector('#customer-email').getAttribute('href')),'mailto:'+raw.intake.email);
    assert.match(doc.querySelector('#email-note').textContent,/separate from this website/);assert.match(doc.querySelector('#notification-status').textContent,/alerts are off/);
  }finally{dom.window.close();app.close();}
});

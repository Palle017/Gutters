import test from 'node:test';
import assert from 'node:assert/strict';
import {webcrypto} from 'node:crypto';
import {JSDOM} from 'jsdom';
import {createApp} from '../server/src/app.mjs';
import {ownerHTML} from '../server/src/owner-ui.mjs';
import {dashboardHTML,dashboardScript,googleMetrics} from '../server/src/owner-dashboard.mjs';

const origin='https://gutters.example.invalid',key='O'.repeat(43);
async function wait(check){for(let i=0;i<200;i++){if(check())return;await new Promise(done=>setTimeout(done,5));}throw Error('Dashboard state did not settle.');}
function app(t){const value=createApp({dbPath:':memory:',ownerToken:key,publicOrigin:origin,now:()=>Date.parse('2026-10-30T12:00:00Z')});t.after(()=>value.close());return value;}
function standalone(t,api){
  const dom=new JSDOM(dashboardHTML,{url:origin+'/owner',runScripts:'outside-only'});t.after(()=>dom.window.close());
  const factory=dom.window.eval(dashboardScript+';createOwnerDashboard');
  let active=true;const panel=factory({api,active:()=>active});
  return {dom,doc:dom.window.document,panel,lock(){active=false;panel.clear();},unlock(){active=true;}};
}

test('authenticated inbox loads local counts, keeps all Google metrics null, and clears on lock',async t=>{
  const server=app(t),dom=new JSDOM(ownerHTML,{url:origin+'/owner',runScripts:'outside-only'}),calls=[];
  t.after(()=>dom.window.close());
  Object.defineProperty(dom.window,'crypto',{value:webcrypto});Object.defineProperty(dom.window,'AbortController',{value:AbortController});
  dom.window.fetch=(path,options={})=>{calls.push({path,options});return server.fetch(new Request(origin+path,options));};
  dom.window.eval(ownerHTML.match(/<script type="module">([\s\S]*?)<\/script>/)[1]);
  const doc=dom.window.document;
  assert.equal(doc.getElementById('owner-dashboard').hidden,true);
  assert.equal(calls.length,0,'no anonymous counts request');
  doc.getElementById('owner-key').value=key;doc.getElementById('login-form').dispatchEvent(new dom.window.Event('submit',{cancelable:true}));
  await wait(()=>doc.getElementById('od-status').textContent.startsWith('Saved activity as of'));
  assert.equal(doc.getElementById('owner-dashboard').hidden,false);
  assert.deepEqual([...doc.querySelectorAll('#od-counts .od-value')].map(node=>node.textContent),['0','0','0','0','0']);
  assert.equal(doc.querySelectorAll('#od-days tr').length,7);
  doc.querySelector('[data-od-days="30"]').click();assert.equal(doc.querySelectorAll('#od-days tr').length,30);
  assert.deepEqual(googleMetrics,{searchConsole:null,ga4:null,businessProfile:null});
  assert.ok([...doc.querySelectorAll('.od-google .od-card')].every(card=>card.textContent.includes('Not connected yet')&&card.querySelector('.od-value').textContent==='—'));
  assert.equal(calls.find(call=>call.path==='/owner/api/metrics').options.headers.Authorization,'Bearer '+key);
  assert.ok(calls.every(call=>call.path.startsWith('/owner/api/')),'no Google or other-business requests');
  assert.equal(doc.getElementById('refresh').disabled,false);assert.equal(doc.getElementById('lock').disabled,false);
  doc.getElementById('lock').click();
  assert.equal(doc.getElementById('owner-dashboard').hidden,true);
  assert.ok([...doc.querySelectorAll('#od-counts .od-value')].every(node=>node.textContent==='—'));
});

test('failed or malformed counts never become zero and can be retried independently',async t=>{
  const server=app(t);let result='fail';
  const x=standalone(t,async()=>{if(result==='fail')throw Error('SYNTHETIC secret must stay hidden');return result==='bad'?{ok:true,windows:{}}:server.store.metrics();});
  for(const bad of ['fail','bad']){
    result=bad;await x.panel.refresh();
    assert.match(x.doc.getElementById('od-status').textContent,/Counts unavailable/);
    assert.doesNotMatch(x.doc.body.textContent,/SYNTHETIC secret/);
    assert.ok([...x.doc.querySelectorAll('#od-counts .od-value')].every(node=>node.textContent==='—'));
  }
  result='valid';await x.panel.refresh();assert.equal(x.doc.querySelector('#od-counts .od-value').textContent,'0');
});

test('a late counts response after locking cannot restore private dashboard data',async t=>{
  const server=app(t);let resolve;
  const x=standalone(t,()=>new Promise(done=>{resolve=done;}));
  const pending=x.panel.refresh();x.lock();resolve(server.store.metrics());await pending;
  assert.equal(x.doc.getElementById('owner-dashboard').hidden,true);
  assert.equal(x.doc.querySelector('#od-counts .od-value').textContent,'—');
  assert.equal(x.doc.querySelectorAll('#od-days tr').length,0);
});

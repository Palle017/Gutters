import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {createApp} from '../src/app.mjs';
import {QUESTIONS,validateCreate,validateMessage,validateEstimate} from '../src/protocol.mjs';
import {metricNames} from '../src/owner-metrics.mjs';

const origin='https://gutters.example.invalid', customerOrigin='https://marketing.example.invalid';
const ownerToken='O'.repeat(43), guestToken='T'.repeat(43);
const zero=()=>Object.fromEntries(metricNames.map(name=>[name,0]));
function setup(t){
  const clock={value:Date.parse('2026-10-30T12:00:00.000Z')};
  const app=createApp({dbPath:':memory:',ownerToken,publicOrigin:origin,allowedOrigins:[customerOrigin],now:()=>clock.value});
  t.after(()=>app.close());
  const call=(headers={Authorization:'Bearer '+ownerToken},method='GET')=>app.fetch(new Request(origin+'/owner/api/metrics',{method,headers}));
  return {app,clock,call};
}
function create(app){
  const intake={name:'SYNTHETIC PRIVATE NAME',phone:'2395550101',email:'private@example.invalid',address:'SYNTHETIC PRIVATE ADDRESS',details:'SYNTHETIC PRIVATE CONCERN'};
  const value=validateCreate({schemaVersion:2,conversationId:randomUUID(),operationId:randomUUID(),accessToken:guestToken,intake,answers:QUESTIONS.map(({field})=>intake[field]?{field,state:'provided',answer:intake[field]}:{field,state:'later'})});
  app.store.create(value);return value;
}
const at=(x,date)=>x.clock.value=Date.parse(date);
const reply=(app,id,body='SYNTHETIC PRIVATE REPLY')=>app.store.reply(id,validateMessage({operationId:randomUUID(),body}),{owner:true});

test('metrics use exactly the owner-read bearer and Origin policy, and reject other methods',async t=>{
  const x=setup(t);
  for(const headers of [{},{Authorization:'Bearer '+guestToken},{Origin:origin}])assert.equal((await x.call(headers)).status,401);
  for(const wrong of [customerOrigin,'https://untrusted.example.invalid','null']){
    const response=await x.call({Authorization:'Bearer '+ownerToken,Origin:wrong});
    assert.equal(response.status,403);assert.equal((await response.json()).error,'owner_origin_required');
  }
  // Browser same-origin GETs normally omit Origin; existing owner reads allow this.
  for(const headers of [{Authorization:'Bearer '+ownerToken},{Authorization:'Bearer '+ownerToken,Origin:origin}]){
    const response=await x.call(headers);assert.equal(response.status,200);
    assert.equal(response.headers.get('Cache-Control'),'no-store');
    assert.match(response.headers.get('X-Robots-Tag'),/noindex/);
  }
  assert.equal((await x.call({Authorization:'Bearer '+ownerToken,Origin:origin},'POST')).status,405);
  assert.equal((await x.call({Authorization:'Bearer '+ownerToken},'OPTIONS')).status,403);
});

test('empty database gives measured zeros for 7/30 UTC days with no schema changes',async t=>{
  const x=setup(t),before=x.app.store.db.prepare("SELECT sql FROM sqlite_schema ORDER BY name").all();
  const out=await (await x.call()).json();
  assert.deepEqual(Object.keys(out).sort(),['asOf','ok','timeZone','todayPartial','windows']);
  assert.equal(out.timeZone,'UTC');assert.equal(out.todayPartial,true);
  for(const days of [7,30]){
    const window=out.windows['last'+days+'Days'];assert.equal(window.perDay.length,days);
    assert.equal(window.endInclusive,out.asOf);assert.deepEqual(window.totals,zero());
    assert.ok(window.perDay.every(row=>JSON.stringify(row.counts)===JSON.stringify(zero())));
  }
  assert.equal(out.windows.last7Days.startInclusive,'2026-10-24T00:00:00.000Z');
  assert.equal(out.windows.last30Days.startInclusive,'2026-10-01T00:00:00.000Z');
  assert.deepEqual(x.app.store.db.prepare("SELECT sql FROM sqlite_schema ORDER BY name").all(),before);
  assert.equal(x.app.store.db.prepare('SELECT COUNT(*) n FROM owner_notifications').get().n,0);
});

test('event windows include exact boundaries, exclude older/future events and deduplicate replies/retries',async t=>{
  const x=setup(t);
  at(x,'2026-09-30T23:59:59.999Z');create(x.app);
  at(x,'2026-10-01T00:00:00.000Z');const old=create(x.app);
  at(x,'2026-10-23T23:59:59.999Z');create(x.app);
  at(x,'2026-10-24T00:00:00.000Z');const current=create(x.app);x.app.store.create(current);
  const op=validateMessage({operationId:randomUUID(),body:'SYNTHETIC PRIVATE REPLY'});
  x.app.store.reply(old.conversationId,op,{owner:true});x.app.store.reply(old.conversationId,op,{owner:true});reply(x.app,old.conversationId);
  at(x,'2026-10-25T02:00:00.000Z');reply(x.app,old.conversationId);reply(x.app,current.conversationId);
  const draft=validateEstimate({operationId:randomUUID(),scope:'SYNTHETIC PRIVATE SCOPE',amount:'1.00',notes:'SYNTHETIC PRIVATE NOTES'});
  const estimate=x.app.store.saveEstimate(current.conversationId,draft);x.app.store.saveEstimate(current.conversationId,draft);
  const unpublished=x.app.store.saveEstimate(old.conversationId,validateEstimate({...draft,operationId:randomUUID()}));
  at(x,'2026-10-30T12:00:00.000Z');const publish={operationId:randomUUID()};
  x.app.store.publishEstimate(current.conversationId,estimate.estimate.id,publish);x.app.store.publishEstimate(current.conversationId,estimate.estimate.id,publish);
  // A publication also inserts an owner message; it must not inflate direct replied requests.
  const onlyPublished=create(x.app),third=x.app.store.saveEstimate(onlyPublished.conversationId,validateEstimate({...draft,operationId:randomUUID()}));
  x.app.store.publishEstimate(onlyPublished.conversationId,third.estimate.id,{operationId:randomUUID()});
  // Seed a synthetic photo with distinctive metadata; aggregation must read none of it.
  x.app.store.db.prepare('INSERT INTO photos VALUES(?,?,?,?,?,?,?)').run(randomUUID(),current.conversationId,'SYNTHETIC PRIVATE FILENAME.jpg','image/jpeg',1,Buffer.from([1]),'2026-10-24T00:00:00.000Z');
  at(x,'2026-10-30T12:00:00.001Z');create(x.app);
  at(x,'2026-10-30T12:00:00.000Z');
  const out=await (await x.call()).json();
  assert.deepEqual(out.windows.last7Days.totals,{newRequests:2,requestsRepliedTo:2,estimatesDrafted:3,estimatesPublished:2,photosReceived:1});
  assert.equal(out.windows.last30Days.totals.newRequests,4);
  assert.equal(out.windows.last7Days.perDay[0].counts.newRequests,1);
  assert.equal(out.windows.last7Days.perDay.at(-1).counts.estimatesPublished,2);
  assert.equal(out.windows.last7Days.perDay.reduce((sum,row)=>sum+row.counts.requestsRepliedTo,0),3);
  assert.equal(x.app.store.db.prepare('SELECT published_at FROM estimates WHERE id=?').get(unpublished.estimate.id).published_at,null);
  const serialized=JSON.stringify(out);
  for(const secret of ['SYNTHETIC','2395550101','private@example.invalid',guestToken,ownerToken,old.conversationId,current.conversationId,estimate.estimate.id])assert.equal(serialized.includes(secret),false,secret);
  for(const window of Object.values(out.windows)){
    assert.deepEqual(Object.keys(window).sort(),['endInclusive','perDay','startInclusive','totals']);
    assert.deepEqual(Object.keys(window.totals).sort(),[...metricNames].sort());
    assert.ok(window.perDay.every(row=>Object.keys(row).sort().join(',')==='counts,date'));
  }
  assert.deepEqual(await (await x.call()).json(),out,'re-reading never accumulates totals');
  assert.equal(x.app.store.db.prepare('SELECT COUNT(*) n FROM owner_notifications').get().n,0);
});

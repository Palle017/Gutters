import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile, readdir} from 'node:fs/promises';
import {spawnSync} from 'node:child_process';
import {collectSEO,validateConfig} from '../tools/seo/collect.mjs';

const root = new URL('../',import.meta.url);
const example = JSON.parse(await readFile(new URL('config/seo.example.json',root),'utf8'));
const configured = () => ({...structuredClone(example),enabled:true,startDate:'2026-10-01',endDate:'2026-10-02',searchConsole:{property:'sc-domain:wisdomscreen.pro',mappingConfirmed:true},ga4:{propertyId:'123',mappingConfirmed:true},businessProfile:{locationId:'456',mappingConfirmed:true}});
const env = {GUTTERS_GSC_ACCESS_TOKEN:'synthetic-gsc',GUTTERS_GA4_ACCESS_TOKEN:'synthetic-ga4',GUTTERS_GBP_ACCESS_TOKEN:'synthetic-gbp'};
const now = () => new Date('2026-10-28T12:00:00Z');
const series = name => ({dailyMetric:name,timeSeries:{datedValues:[{date:{year:2026,month:10,day:1},value:'3'},{date:{year:2026,month:10,day:2}}]}});
const payloads = () => [
  {rows:[{clicks:0,impressions:10,ctr:0,position:5}],privateQuery:'MUST NOT SAVE'},
  {metricHeaders:[{name:'activeUsers'},{name:'screenPageViews'},{name:'sessions'}],rows:[{metricValues:[{value:'2'},{value:'4'},{value:'3'}]}],metadata:{timeZone:'America/New_York',subjectToThresholding:true}},
  {multiDailyMetricTimeSeries:[{dailyMetricTimeSeries:[series('WEBSITE_CLICKS'),series('CALL_CLICKS')]}]}
];
const responses = values => async () => ({ok:true,json:async () => values.shift()});

test('disabled example and missing or unconfirmed inputs never contact a provider', async () => {
  const fetcher = () => {throw Error('must never fetch');};
  const disabled = await collectSEO(example,{env,fetcher,now});
  assert.ok(Object.values(disabled.sources).every(source => source.state === 'disabled' && source.metrics === null));
  const config = configured();
  config.searchConsole.mappingConfirmed = false;
  config.ga4.propertyId = null;
  const report = await collectSEO(config,{env:{},fetcher,now});
  assert.ok(Object.values(report.sources).every(source => source.state === 'missing_inputs'));
  assert.ok(report.sources.searchConsole.missing.includes('mappingConfirmed'));
});

test('configuration rejects another business, unsafe identifiers, unknown fields and invalid windows', () => {
  for (const change of [c=>c.website='https://another.invalid/',c=>c.searchConsole.property='sc-domain:another.invalid',c=>c.ga4.propertyId='../123',c=>c.businessProfile.locationId='ChIJ-not-a-location-id',c=>c.startDate='2026-02-30',c=>c.endDate='2026-09-30',c=>c.endDate='2027-01-01',c=>c.accessToken='DO NOT STORE',c=>c.ga4.secret='DO NOT STORE']) {
    const config = configured(); change(config); assert.throws(() => validateConfig(config));
  }
});

test('provider requests stay scoped to the verified Gutters site and save only known aggregates', async () => {
  const values=payloads(), requests=[];
  const report=await collectSEO(configured(),{env,now,fetcher:async (url,options) => {requests.push({url,options});return {ok:true,json:async()=>values.shift()};}});
  assert.deepEqual(report.sources.searchConsole.metrics,{clicks:0,impressions:10,ctr:0,averagePosition:5});
  assert.deepEqual(report.sources.ga4.metrics,{sessions:3,activeUsers:2,screenPageViews:4});
  assert.deepEqual(report.sources.businessProfile.metrics,{WEBSITE_CLICKS:3,CALL_CLICKS:3});
  assert.equal(report.sources.ga4.timeZone,'America/New_York');
  assert.equal(report.sources.ga4.thresholded,true);
  const gsc=JSON.parse(requests[0].options.body), ga=JSON.parse(requests[1].options.body);
  assert.equal(gsc.dimensions,undefined);
  assert.equal(gsc.dimensionFilterGroups[0].filters[0].expression,'^https://wisdomscreen[.]pro/');
  assert.equal(gsc.dataState,'final');
  assert.equal(ga.dimensions,undefined);
  assert.equal(ga.dimensionFilter.filter.stringFilter.value,'wisdomscreen.pro');
  assert.match(requests[2].url,/dailyMetrics=CALL_CLICKS/);
  for (const request of requests) {assert.equal(request.options.redirect,'error');assert.ok(request.options.signal instanceof AbortSignal);assert.ok(!request.url.includes('synthetic-'));}
  assert.doesNotMatch(JSON.stringify(report),/synthetic-|MUST NOT SAVE|privateQuery/);
});

test('repeating a collection produces the same snapshot totals without accumulation', async () => {
  const first=await collectSEO(configured(),{env,now,fetcher:responses(payloads())});
  const second=await collectSEO(configured(),{env,now,fetcher:responses(payloads())});
  assert.deepEqual(first,second);
});

test('empty rows are no_data while missing and invalid numbers stay null', async () => {
  const values=payloads(); values[0]={rows:[]}; values[1].rows[0].metricValues=[{value:' '},{value:'9007199254740993'},{value:'0'}];
  const report=await collectSEO(configured(),{env,now,fetcher:responses(values)});
  assert.equal(report.sources.searchConsole.state,'no_data');
  assert.equal(report.sources.searchConsole.metrics,null);
  assert.deepEqual(report.sources.ga4.metrics,{sessions:0,activeUsers:null,screenPageViews:null});
  assert.equal(report.sources.ga4.state,'partial');
});

test('GBP omitted zero value differs from missing dates and duplicate dates are rejected', async () => {
  const values=payloads(); values[2].multiDailyMetricTimeSeries[0].dailyMetricTimeSeries[0].timeSeries.datedValues.pop();
  const report=await collectSEO(configured(),{env,now,fetcher:responses(values)});
  assert.equal(report.sources.businessProfile.state,'partial');
  assert.equal(report.sources.businessProfile.metrics.WEBSITE_CLICKS,null);
  assert.deepEqual(report.sources.businessProfile.coverage.WEBSITE_CLICKS,{observedDays:1,requestedDays:2});
  const duplicates=payloads(); const dated=duplicates[2].multiDailyMetricTimeSeries[0].dailyMetricTimeSeries[0].timeSeries.datedValues; dated.push(dated[0]);
  const failed=await collectSEO(configured(),{env,now,fetcher:responses(duplicates)});
  assert.equal(failed.sources.businessProfile.reason,'invalid_response');
});

test('provider failures preserve other sources and never save error bodies or thrown secrets', async () => {
  let calls=0,bodyRead=false; const values=payloads();
  const report=await collectSEO(configured(),{env,now,fetcher:async () => {
    calls++; if(calls===1) return {ok:false,status:403,json:async()=>{bodyRead=true;return {secret:'private'};}};
    if(calls===2) throw Error('SECRET token from network');
    return {ok:true,json:async()=>values[2]};
  }});
  assert.equal(bodyRead,false);
  assert.equal(report.sources.searchConsole.reason,'access_rejected');
  assert.equal(report.sources.ga4.state,'failed');
  assert.equal(report.sources.businessProfile.state,'available');
  assert.doesNotMatch(JSON.stringify(report),/SECRET|private|synthetic-/);
});

test('failed body reads and unexpected extra aggregate rows fail closed', async () => {
  const report=await collectSEO(configured(),{env,now,fetcher:async () => ({ok:true,json:async()=>{throw Error('body stalled or invalid');}})});
  assert.ok(Object.values(report.sources).every(source=>source.state==='failed' && source.metrics===null));
  const values=payloads();values[0].rows.push(values[0].rows[0]);
  const duplicate=await collectSEO(configured(),{env,now,fetcher:responses(values)});
  assert.equal(duplicate.sources.searchConsole.reason,'invalid_response');
});

test('CLI writes disabled status only to ignored private storage without changing public source', async () => {
  const before=await readdir(new URL('site/',root));
  const run=spawnSync(process.execPath,['tools/seo-collect.mjs','config/seo.example.json'],{cwd:root,encoding:'utf8'});
  assert.equal(run.status,0,run.stderr);
  assert.match(run.stdout,/searchConsole: disabled/);
  const files=await readdir(new URL('private/seo/',root));
  const stored=JSON.parse(await readFile(new URL('private/seo/'+files.sort().at(-1),root),'utf8'));
  assert.equal(stored.requestedWindow,null);
  assert.deepEqual(await readdir(new URL('site/',root)),before);
  assert.match(await readFile(new URL('.gitignore',root),'utf8'),/^private\/$/m);
});

// Aggregate reads only. Never import customer records, queries, URLs or raw API responses.
const WEBSITE = 'https://wisdomscreen.pro/';
const GA_METRICS = ['sessions', 'activeUsers', 'screenPageViews'];
const GBP_METRICS = ['WEBSITE_CLICKS', 'CALL_CLICKS'];
const blank = (state, reason) => ({state, reason, metrics:null});
function date(value) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value) || new Date(value+'T00:00:00Z').toISOString().slice(0,10) !== value) throw Error('Invalid reporting date.');
  return value;
}
function number(value, integer = false) {
  if (value === null || value === undefined || typeof value === 'string' && !/^\d+(?:\.\d+)?$/.test(value) || typeof value === 'boolean' || !['number','string'].includes(typeof value)) return null;
  const result = Number(value);
  return Number.isFinite(result) && result >= 0 && (!integer || Number.isSafeInteger(result)) ? result : null;
}
function object(value, keys) {
  if (!value || typeof value !== 'object' || Array.isArray(value) || Object.keys(value).some(key => !keys.includes(key))) throw Error('Invalid SEO configuration.');
}
export function validateConfig(config) {
  object(config, ['enabled','website','startDate','endDate','searchConsole','ga4','businessProfile']);
  if (typeof config.enabled !== 'boolean' || config.website !== WEBSITE) throw Error('Only the Gutters website is supported.');
  for (const [source, id] of [['searchConsole','property'],['ga4','propertyId'],['businessProfile','locationId']]) {
    object(config[source], [id,'mappingConfirmed']);
    if (typeof config[source].mappingConfirmed !== 'boolean') throw Error('Explicit property mapping confirmation is required.');
    const value = config[source][id];
    if (value !== null && (typeof value !== 'string' || (source === 'searchConsole' ? ![WEBSITE,'sc-domain:wisdomscreen.pro'].includes(value) : !/^[1-9]\d*$/.test(value)))) throw Error('Invalid Gutters property identifier.');
  }
  if (config.enabled) {
    date(config.startDate); date(config.endDate);
    const days = (Date.parse(config.endDate)-Date.parse(config.startDate))/86400000;
    if (days < 0 || days > 30) throw Error('Choose a reporting window of 1 to 31 days.');
  }
  return config;
}

async function readJSON(fetcher, url, token, body) {
  const response = await fetcher(url, {
    method:body ? 'POST' : 'GET',
    headers:{Authorization:'Bearer '+token, ...(body ? {'Content-Type':'application/json'} : {})},
    ...(body ? {body:JSON.stringify(body)} : {}),
    signal:AbortSignal.timeout(20000), redirect:'error'
  });
  // Provider text is deliberately excluded from diagnostics and saved reports.
  if (!response.ok) throw Error([401,403].includes(response.status) ? 'access_rejected' : response.status === 429 ? 'rate_limited' : 'provider_error');
  return response.json(); // The same abort signal bounds the body read too.
}
function aggregate(metrics) {
  return {state:Object.values(metrics).every(value => value !== null) ? 'available' : 'partial', metrics};
}
function gsc(data) {
  if (data.rows === undefined || Array.isArray(data.rows) && !data.rows.length) return blank('no_data','No aggregate row returned; this is not a measured zero.');
  if (!Array.isArray(data.rows) || data.rows.length !== 1) throw Error('invalid_response');
  const row = data.rows[0];
  const metrics = {clicks:number(row.clicks,true), impressions:number(row.impressions,true), ctr:number(row.ctr), averagePosition:number(row.position)};
  if (metrics.ctr > 1) metrics.ctr = null;
  return {...aggregate(metrics), timeZone:'America/Los_Angeles', searchType:'web', dataState:'final', coverage:'Provider aggregate; not evidence that every date has data.'};
}
function ga4(data) {
  if (data.rows === undefined || Array.isArray(data.rows) && !data.rows.length) return blank('no_data','No aggregate row returned; this is not a measured zero.');
  if (!Array.isArray(data.rows) || data.rows.length !== 1 || !Array.isArray(data.metricHeaders)) throw Error('invalid_response');
  const metrics = Object.fromEntries(GA_METRICS.map(name => {
    const indexes = data.metricHeaders.flatMap((header,index) => header.name === name ? [index] : []);
    return [name,indexes.length === 1 ? number(data.rows[0].metricValues?.[indexes[0]]?.value,true) : null];
  }));
  return {...aggregate(metrics), timeZone:typeof data.metadata?.timeZone === 'string' ? data.metadata.timeZone : null,
    thresholded:typeof data.metadata?.subjectToThresholding === 'boolean' ? data.metadata.subjectToThresholding : null,
    sampled:Array.isArray(data.metadata?.samplingMetadatas) ? data.metadata.samplingMetadatas.length > 0 : null,
    hostFilter:'wisdomscreen.pro', coverage:'Host-filtered property aggregate; active users and sessions are not unique people or leads.'};
}
function gbp(data, start, end) {
  const series = data.multiDailyMetricTimeSeries?.flatMap(group => group.dailyMetricTimeSeries || []);
  if (!Array.isArray(series) || !series.length) return blank('no_data','No daily metric series returned.');
  const days = [];
  for (let time=Date.parse(start);time<=Date.parse(end);time+=86400000) days.push(new Date(time).toISOString().slice(0,10));
  const metrics = {}, coverage = {};
  for (const name of GBP_METRICS) {
    const matches = series.filter(row => row.dailyMetric === name);
    if (matches.length > 1 || matches.some(row => row.dailySubEntityType && Object.keys(row.dailySubEntityType).length)) throw Error('invalid_response');
    const values = new Map();
    for (const item of matches[0]?.timeSeries?.datedValues || []) {
      const key = date(String(item.date?.year).padStart(4,'0')+'-'+String(item.date?.month).padStart(2,'0')+'-'+String(item.date?.day).padStart(2,'0'));
      if (!days.includes(key) || values.has(key)) throw Error('invalid_response');
      // GBP explicitly omits value for a measured zero on a PRESENT date.
      // A missing date/series still has unknown coverage and never becomes zero.
      values.set(key,Object.hasOwn(item,'value') ? number(item.value,true) : 0);
    }
    const observedDays = days.filter(day => values.has(day) && values.get(day) !== null).length;
    const sum = [...values.values()].reduce((total,value) => total+(value ?? 0),0);
    metrics[name] = observedDays === days.length && Number.isSafeInteger(sum) ? sum : null;
    coverage[name] = {observedDays, requestedDays:days.length};
  }
  return {...aggregate(metrics), coverage, timeZone:null, note:'Provider calendar dates. Call clicks are not answered calls, leads or jobs. Missing dates/values are not zero.'};
}

export async function collectSEO(config, {env = process.env, fetcher = fetch, now = () => new Date()} = {}) {
  validateConfig(config);
  const sources = Object.fromEntries(['searchConsole','ga4','businessProfile'].map(name => [name,blank('disabled','Collection is opt-in.')]));
  const report = {schemaVersion:1, website:WEBSITE, collectedAt:now().toISOString(), requestedWindow:config.enabled ? {startDate:config.startDate,endDate:config.endDate} : null, sources,
    limitations:['Source metrics have different definitions and time zones; never sum them into leads or jobs.','Recent data can change; this snapshot is not a freshness or complete-history guarantee.','No tracking tag, OAuth grant, schedule, customer-data import or public reporting is activated.']};
  if (!config.enabled) return report;
  const {startDate, endDate} = config;
  async function source(name, idKey, tokenKey, run) {
    const value = config[name][idKey];
    if (!value || !config[name].mappingConfirmed || !env[tokenKey]) {
      sources[name] = {...blank('missing_inputs','Verified property mapping and an existing access token are required.'), missing:[...(!value ? [idKey] : []),...(!config[name].mappingConfirmed ? ['mappingConfirmed'] : []),...(!env[tokenKey] ? [tokenKey] : [])]}; return;
    }
    try { sources[name] = {...await run(value,env[tokenKey]), property:value}; }
    catch (error) { sources[name] = blank('failed',['access_rejected','rate_limited','provider_error','invalid_response'].includes(error.message) ? error.message : 'request_or_response_failed'); }
  }
  await source('searchConsole','property','GUTTERS_GSC_ACCESS_TOKEN',async (property,token) => gsc(await readJSON(fetcher,'https://www.googleapis.com/webmasters/v3/sites/'+encodeURIComponent(property)+'/searchAnalytics/query',token,{startDate,endDate,type:'web',dataState:'final',dimensionFilterGroups:[{filters:[{dimension:'page',operator:'includingRegex',expression:'^https://wisdomscreen[.]pro/'}]}]})));
  await source('ga4','propertyId','GUTTERS_GA4_ACCESS_TOKEN',async (id,token) => ga4(await readJSON(fetcher,'https://analyticsdata.googleapis.com/v1beta/properties/'+id+':runReport',token,{dateRanges:[{startDate,endDate}], metrics:GA_METRICS.map(name => ({name})), dimensionFilter:{filter:{fieldName:'hostName',stringFilter:{matchType:'EXACT',value:'wisdomscreen.pro',caseSensitive:false}}}})));
  await source('businessProfile','locationId','GUTTERS_GBP_ACCESS_TOKEN',async (id,token) => {
    const url = new URL('https://businessprofileperformance.googleapis.com/v1/locations/'+id+':fetchMultiDailyMetricsTimeSeries');
    for (const metric of GBP_METRICS) url.searchParams.append('dailyMetrics',metric);
    for (const [name,value] of [['start_date',startDate],['end_date',endDate]]) for (const [index,part] of ['year','month','day'].entries()) url.searchParams.set('dailyRange.'+name+'.'+part,String(Number(value.split('-')[index])));
    return gbp(await readJSON(fetcher,url.href,token),startDate,endDate);
  });
  return report;
}

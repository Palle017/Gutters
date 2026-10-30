// Kept separate from the inbox styles and workflow so PR18 can merge independently.
export const googleMetrics = Object.freeze({searchConsole:null,ga4:null,businessProfile:null});
export const dashboardStyles = `
#owner-dashboard{margin-bottom:28px;min-width:0;color:inherit}
#owner-dashboard h2{margin:0;font-size:24px}
#owner-dashboard .od-heading{display:flex;align-items:center;justify-content:space-between;gap:16px;flex-wrap:wrap}
#owner-dashboard .od-periods{display:flex;gap:8px;flex-wrap:wrap}
#owner-dashboard button{min-height:44px;font-size:16px}
#owner-dashboard button[aria-pressed=true]{outline:2px solid currentColor;outline-offset:2px}
#owner-dashboard .od-grid{display:grid;grid-template-columns:repeat(5,minmax(0,1fr));gap:12px;margin:20px 0}
#owner-dashboard .od-card{border:1px solid #8a8f9580;border-radius:8px;padding:16px;min-width:0}
#owner-dashboard .od-label{font-size:15px;line-height:1.4;margin:0;overflow-wrap:anywhere}
#owner-dashboard .od-value{display:block;font-size:30px;font-weight:700;line-height:1.2;margin:12px 0}
#owner-dashboard .od-note{font-size:14px;line-height:1.55;max-width:90ch}
#owner-dashboard .od-google{grid-template-columns:repeat(3,minmax(0,1fr))}
#owner-dashboard summary{min-height:44px;padding:10px 0}
#owner-dashboard .od-daily{max-width:100%;overflow-x:auto;margin-top:12px}
#owner-dashboard table{border-collapse:collapse;width:100%;min-width:580px;font-size:14px}
#owner-dashboard th,#owner-dashboard td{text-align:right;padding:10px;border-bottom:1px solid #8a8f9580}
#owner-dashboard th:first-child,#owner-dashboard td:first-child{text-align:left;white-space:nowrap}
#owner-dashboard caption{text-align:left;padding:8px 0;font-weight:600}
@media(max-width:900px){#owner-dashboard .od-grid{grid-template-columns:repeat(3,minmax(0,1fr))}}
@media(max-width:500px){#owner-dashboard .od-grid{grid-template-columns:repeat(2,minmax(0,1fr))}#owner-dashboard .od-google{grid-template-columns:minmax(0,1fr)}}
`;
export const dashboardHTML = `
<section id="owner-dashboard" class="panel" aria-labelledby="od-heading" hidden>
  <div class="od-heading"><h2 id="od-heading">Leads at a glance</h2><div class="od-periods" role="group" aria-label="Reporting window"><button type="button" class="secondary" data-od-days="7" aria-pressed="true">7 days</button><button type="button" class="secondary" data-od-days="30" aria-pressed="false">30 days</button></div></div>
  <p id="od-status" class="od-note" role="status" aria-live="polite">Counts unavailable until the inbox is opened.</p>
  <div class="od-grid" id="od-counts"></div>
  <p class="od-note">Saved website activity only, in UTC. Today is partial. Replied requests are distinct within each window; daily replied counts may add up to more than the window total.</p>
  <details><summary>Daily counts</summary><div class="od-daily" tabindex="0" role="region" aria-label="Daily counts, scroll horizontally on small screens"><table><caption>Daily saved activity · UTC</caption><thead><tr><th scope="col">Date</th><th scope="col">New</th><th scope="col">Replied</th><th scope="col">Drafted</th><th scope="col">Published</th><th scope="col">Photos</th></tr></thead><tbody id="od-days"></tbody></table></div></details>
  <h3>Google performance</h3><div class="od-grid od-google">
    <article class="od-card"><h4 class="od-label">Search Console</h4><span class="od-value" aria-label="Unavailable">—</span><p class="od-note">Not connected yet</p></article>
    <article class="od-card"><h4 class="od-label">GA4</h4><span class="od-value" aria-label="Unavailable">—</span><p class="od-note">Not connected yet</p></article>
    <article class="od-card"><h4 class="od-label">Business Profile</h4><span class="od-value" aria-label="Unavailable">—</span><p class="od-note">Not connected yet</p></article>
  </div>
</section>`;

export const dashboardScript = `
function createOwnerDashboard({api,active}) {
  const names={newRequests:'New requests',requestsRepliedTo:'Requests replied to',estimatesDrafted:'Estimates drafted',estimatesPublished:'Estimates published',photosReceived:'Photos received'};
  const root=document.getElementById('owner-dashboard'),status=document.getElementById('od-status'),counts=document.getElementById('od-counts'),daily=document.getElementById('od-days');
  let data=null,days=7,generation=0;
  function node(tag,text,cls){const value=document.createElement(tag);if(text!==undefined)value.textContent=text;if(cls)value.className=cls;return value;}
  function render(){
    counts.replaceChildren();daily.replaceChildren();
    for(const [key,label] of Object.entries(names)){
      const card=node('article',undefined,'od-card'),value=node('span',data?String(data.windows['last'+days+'Days'].totals[key]):'—','od-value');
      if(!data)value.setAttribute('aria-label','Unavailable');card.append(node('h3',label,'od-label'),value);counts.append(card);
    }
    if(data){for(const row of data.windows['last'+days+'Days'].perDay){const tr=node('tr'),date=node('th',row.date);date.scope='row';tr.append(date);for(const key of Object.keys(names))tr.append(node('td',String(row.counts[key])));daily.append(tr);}}
    for(const button of root.querySelectorAll('[data-od-days]'))button.setAttribute('aria-pressed',String(Number(button.dataset.odDays)===days));
  }
  function valid(value){
    const validCounts=counts=>counts&&Object.keys(names).every(key=>Number.isSafeInteger(counts[key])&&counts[key]>=0);
    return value?.ok===true&&value.timeZone==='UTC'&&typeof value.asOf==='string'&&Number.isFinite(Date.parse(value.asOf))&&[7,30].every(n=>{
      const window=value.windows?.['last'+n+'Days'];return validCounts(window?.totals)&&Array.isArray(window?.perDay)&&window.perDay.length===n&&window.perDay.every(row=>typeof row.date==='string'&&/^\\d{4}-\\d{2}-\\d{2}$/.test(row.date)&&validCounts(row.counts));
    });
  }
  for(const button of root.querySelectorAll('[data-od-days]'))button.addEventListener('click',()=>{days=Number(button.dataset.odDays);render();});
  function clear(){generation++;data=null;root.hidden=true;status.textContent='Counts unavailable until the inbox is opened.';render();}
  async function refresh(){
    const version=++generation;data=null;root.hidden=false;status.textContent='Loading saved activity…';render();
    try{
      const result=await api('/metrics');
      if(version!==generation||!active())return;
      if(!valid(result))throw Error('Invalid counts.');
      data=result;status.textContent='Saved activity as of '+new Date(result.asOf).toLocaleString(undefined,{timeZone:'UTC',timeZoneName:'short'})+' · Today is partial.';render();
    }catch{if(version===generation&&active()){data=null;status.textContent='Counts unavailable. Use Refresh messages to retry. Saved requests remain available.';render();}}
  }
  clear();return {refresh,clear};
}
`;

export const ownerHTML = `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex,nofollow,noarchive"><meta name="referrer" content="no-referrer"><title>Gutters · Website messages</title>
<style>
:root {
  color-scheme: dark;
  --canvas: #0e1013;
  --surface: #181b20;
  --raised: #22272e;
  --ink: #f4f3ee;
  --muted: #b7bdc5;
  --line: #414955;
  --accent: #e5bd75;
  font: 16px/1.55 system-ui, sans-serif;
  color: var(--ink);
  background: var(--canvas);
}
* { box-sizing: border-box; }
body { margin: 0; }
header { padding: 26px max(20px, calc((100vw - 1180px)/2)); border-bottom: 1px solid var(--line); }
h1 { margin: 0; font-size: clamp(23px, 3vw, 30px); line-height: 1.2; letter-spacing: -.025em; }
main { max-width: 1220px; margin: auto; padding: 24px 20px 48px; }
h2 { margin: 0 0 16px; font-size: 23px; line-height: 1.3; }
h3 { margin: 26px 0 14px; font-size: 19px; }
p { max-width: 75ch; }
.muted, .message.guide { color: var(--muted); }
a { color: #efcf97; text-underline-offset: 4px; overflow-wrap: anywhere; }
button, input, textarea, select { font: inherit; }
button { min-height: 48px; padding: 11px 18px; border: 1px solid var(--accent); border-radius: 8px; background: var(--accent); color: var(--canvas); font-weight: 650; cursor: pointer; overflow-wrap: anywhere; }
button.secondary { color: var(--ink); background: transparent; border-color: var(--line); }
button:hover:not(:disabled) { filter: brightness(1.1); }
button:disabled { opacity: .5; cursor: not-allowed; }
label { display: block; font-weight: 600; margin: 20px 0 8px; }
input, textarea, select { width: 100%; min-width: 0; min-height: 48px; padding: 12px; border: 1px solid var(--line); border-radius: 8px; background: var(--canvas); color: var(--ink); }
input::placeholder, textarea::placeholder { color: var(--muted); opacity: 1; }
input[type=password] { max-width: 540px; }
textarea { resize: vertical; }
#layout { display: grid; grid-template-columns: 290px minmax(0, 1fr); gap: 28px; align-items: start; }
#layout > * { min-width: 0; }
#list { display: grid; gap: 0; align-content: start; }
#list button { width: 100%; min-width: 0; text-align: left; background: transparent; color: var(--ink); padding: 16px 14px; border: 0; border-bottom: 1px solid var(--line); border-left: 3px solid transparent; border-radius: 0; font-weight: 400; }
#list button strong { display: block; font-size: 17px; }
#list button div, #list button small { font-size: 14px; color: var(--muted); }
#list button[aria-current=true] { border-left-color: var(--accent); background: var(--raised); }
.panel { background: var(--surface); border: 1px solid var(--line); border-radius: 12px; padding: 26px; }
#customer { font-size: 28px; overflow-wrap: anywhere; }
#phone, #customer-email { display: inline-flex; min-height: 44px; align-items: center; }
.message { border-left: 2px solid var(--line); padding: 12px 16px; margin: 18px 0; white-space: pre-wrap; overflow-wrap: anywhere; }
.message.owner { border-color: var(--accent); background: var(--raised); }
.message.guide { font-size: 15px; }
.message strong { display: block; white-space: normal; font-size: 14px; margin-bottom: 8px; }
.quote-grid { display: grid; grid-template-columns: minmax(0,1fr) minmax(0,1fr); gap: 0 18px; }
#status { min-height: 26px; overflow-wrap: anywhere; }
.actions { display: flex; gap: 12px; flex-wrap: wrap; margin: 20px 0; }
.actions > * { max-width: 100%; }
details { margin-top: 28px; border-top: 1px solid var(--line); }
summary { cursor: pointer; font-weight: 600; min-height: 48px; padding: 14px 0; }
.warning { color: #f6e5bf; background: #332b1d; border: 1px solid #776440; padding: 16px; border-radius: 8px; }
.photos { display: grid; grid-template-columns: repeat(3,minmax(0,1fr)); gap: 14px; }
.photos a { min-width: 0; overflow: hidden; font-size: 14px; }
.photos img { display: block; width: 100%; aspect-ratio: 4/3; object-fit: cover; border-radius: 8px; background: var(--raised); }
.photos span { display: block; margin-top: 8px; }
.estimate-section { border-top: 1px solid var(--line); margin-top: 32px; padding-top: 6px; }
.estimate-preview { padding: 22px; border: 1px solid var(--line); border-top: 3px solid var(--accent); background: var(--canvas); border-radius: 8px; margin: 24px 0; }
.estimate-preview p { white-space: pre-wrap; overflow-wrap: anywhere; }
.estimate-preview h4 { margin-bottom: 8px; }
.estimate-total { font-size: 32px; font-weight: 700; color: var(--accent); }
.back-to-requests { display: none; }
:focus-visible { outline: 3px solid #8ed2ff; outline-offset: 4px; }
[hidden] { display: none !important; }
@media (max-width: 760px) {
  header { padding: 24px 20px; }
  main { padding: 16px 16px 36px; }
  #layout, .quote-grid { grid-template-columns: minmax(0,1fr); }
  #layout { gap: 28px; }
  .panel { padding: 20px; }
  .photos { grid-template-columns: repeat(2,minmax(0,1fr)); }
  .actions > button { flex: 1 1 140px; }
  .back-to-requests { display: inline-flex; min-height: 44px; align-items: center; margin-bottom: 12px; }
  #customer, #requests-heading { scroll-margin-top: 20px; }
}
@media (max-width: 360px) {
  main { padding-inline: 12px; }
  .panel { padding: 16px; }
}
</style></head><body><header><h1>Gutters · Requests &amp; estimates</h1></header><main>
<p id="status" role="status" aria-live="polite"></p>
<section id="login" class="panel"><h2>Open the private inbox</h2><p>Enter the owner access key. It stays in this page's memory and is cleared when this page closes or reloads.</p><form id="login-form"><label for="owner-key">Owner access key</label><input id="owner-key" type="password" autocomplete="off" required><div class="actions"><button>Open inbox</button></div></form></section>
<section id="inbox" hidden><div class="actions"><button id="refresh" class="secondary">Refresh messages</button><button id="lock" class="secondary">Lock inbox</button></div><p class="muted">Website messages are saved here. Open a request for its email alert status. No text alerts or calendar are connected.</p><div id="layout"><aside aria-labelledby="requests-heading"><h2 id="requests-heading" tabindex="-1">Requests</h2><div id="list"></div><div class="actions"><button id="more" hidden class="secondary">Load older requests</button></div></aside>
<article class="panel"><div id="empty">Choose a request to read it and reply.</div><div id="selected" hidden><a class="back-to-requests" href="#requests-heading">Back to requests</a><h2 id="customer" tabindex="-1"></h2><a id="phone"></a><p><a id="customer-email" hidden></a></p><p id="email-note" class="muted" hidden>Email replies go directly to the customer and are separate from this website conversation.</p><p id="notification-status" class="muted" role="status"></p><p id="created" class="muted"></p><section aria-labelledby="photos-heading"><h3 id="photos-heading">Customer photos</h3><div id="photos" class="photos"></div><p id="photo-status" role="status"></p><button type="button" id="retry-photos" class="secondary" hidden>Retry loading photos</button></section><div id="messages" aria-label="Saved conversation"></div><button id="more-messages" hidden class="secondary">Load more messages</button><p id="access-status" class="muted"></p><form id="reply-form"><label for="reply">Reply to this customer</label><textarea id="reply" rows="4" maxlength="4000" required></textarea><div class="actions"><button id="send">Save reply</button><button type="button" id="retry" class="secondary" hidden>Check and retry pending reply</button></div><p class="muted">Replies appear through the customer's private website return link. Saving a reply does not send an SMS or email.</p></form>
<details><summary>Quote details</summary><p class="muted">Use John's measurements and units. Blank fields stay blank; no length or price formula has been defined.</p><form id="quote-form"><div class="quote-grid"><div><label for="address">Customer address</label><input id="address" maxlength="300"></div><div><label for="size_of_home">Size of home</label><input id="size_of_home" maxlength="100"></div><div><label for="stories">Single or double story</label><select id="stories"><option value="">Not provided</option><option value="1">Single story</option><option value="2">Double story</option></select></div><div><label for="gutter_length">Gutter length</label><input id="gutter_length" maxlength="100"></div></div><div class="actions"><button>Save quote details</button></div></form></details>
<section class="estimate-section" aria-labelledby="estimate-heading"><h3 id="estimate-heading">Write the estimate</h3><p class="muted">Review the photos, customer request, and quote details above. Enter your own scope and price. Drafts stay private until you preview and send.</p><p id="estimate-saved" role="status"></p><form id="estimate-form"><label for="estimate-scope">Work included</label><textarea id="estimate-scope" rows="5" maxlength="4000" required></textarea><label for="estimate-amount">Estimate amount · USD</label><input id="estimate-amount" inputmode="decimal" placeholder="1250.00" pattern="(?:0|[1-9][0-9]{0,7})(?:[.][0-9]{1,2})?" required><label for="estimate-notes">Notes or conditions (optional)</label><textarea id="estimate-notes" rows="3" maxlength="2000"></textarea><div class="actions"><button type="button" id="estimate-preview-button" class="secondary">Preview estimate</button><button id="estimate-save">Save private draft</button><button type="button" id="estimate-retry" class="secondary" hidden>Retry pending estimate action</button></div></form><section id="estimate-preview" class="estimate-preview" hidden aria-labelledby="estimate-preview-heading"><p class="muted">CUSTOMER ESTIMATE PREVIEW</p><h3 id="estimate-preview-heading">Everything Screen and Gutters</h3><p id="estimate-number"></p><h4>Work included</h4><p id="preview-scope"></p><h4>Amount</h4><p id="preview-amount" class="estimate-total"></p><h4>Notes and conditions</h4><p id="preview-notes"></p><p>John Wisdom · (239) 355-3686</p></section><div class="actions"><button type="button" id="estimate-send" disabled>Send estimate to customer</button></div><p class="muted">Send publishes the saved estimate on this customer's private website page. No email or SMS is sent.</p></section>
<details><summary>Private return access</summary><p>Revoke only if this customer's private link should stop working. Saved messages are retained.</p><button id="revoke" class="secondary">Revoke this return link</button></details></div></article></div></section>
<script type="module">
const $=id=>document.getElementById(id);let token='',current=null,cursor=0,nextCursor=null,pending=null,busy=false,generation=0,storageReady=true;
const PENDING_KEY='gutters-owner-pending-v1',ESTIMATE_PENDING_KEY='gutters-owner-estimate-pending-v1',UUID=/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/;
let pendingEstimate=null,loadedEstimate=null,previewSignature='',guestActive=false,photoConversation=null,loadedSelection=null,photoRows=[],photoLoading=false,sessionVersion=0;let sessionAbort=new AbortController(),photoAbort=new AbortController();const photoURLs=new Map();
try{const encoded=sessionStorage.getItem(PENDING_KEY);if(encoded){const value=JSON.parse(encoded);if(!value||!UUID.test(value.id)||!UUID.test(value.operationId)||typeof value.body!=='string'||!value.body.trim()||value.body.length>4000)throw Error();pending=value;}const probe=PENDING_KEY+'-probe';sessionStorage.setItem(probe,'1');sessionStorage.removeItem(probe);}catch{storageReady=false;}
try{const encoded=sessionStorage.getItem(ESTIMATE_PENDING_KEY);if(encoded){const value=JSON.parse(encoded);if(!value||!UUID.test(value.id)||!UUID.test(value.operationId)||!['draft','publish'].includes(value.kind)||value.kind==='publish'&&!UUID.test(value.estimateId)||value.kind==='draft'&&(!value.input||typeof value.input.scope!=='string'||typeof value.input.amount!=='string'))throw Error();pendingEstimate=value;}}catch{storageReady=false;}
const saved=new Map();
function say(value){$('status').textContent=value;}
function el(tag,text,cls){const node=document.createElement(tag);if(text!==undefined)node.textContent=text;if(cls)node.className=cls;return node;}
function estimateInput(){return {scope:$('estimate-scope').value.trim(),amount:$('estimate-amount').value.trim(),notes:$('estimate-notes').value.trim()};}
function estimateSignature(value){return JSON.stringify({scope:value.scope,amount:value.amount,notes:value.notes||''});}
function selectionReady(){return Boolean(token&&current&&loadedSelection===current);}
function viewActive(id,version){return Boolean(token&&current===id&&generation===version);}
function selectedScope(){if(!selectionReady())throw Error('Load this request before making changes. Use Refresh messages to retry.');return {id:current,version:generation};}
function estimateReady(){return selectionReady()&&loadedEstimate?.status==='draft'&&previewSignature===estimateSignature(estimateInput())&&estimateSignature(loadedEstimate)===previewSignature&&guestActive&&!pendingEstimate&&!pending&&storageReady;}
function controls(){
  for(const node of document.querySelectorAll('button,input,textarea,select'))node.disabled=busy;
  if(!selectionReady())for(const node of $('selected').querySelectorAll('button,input,textarea,select'))node.disabled=true;
  if(pending||pendingEstimate||!storageReady){$('reply').disabled=true;$('send').disabled=true;}
  if(pendingEstimate||pending||!storageReady)for(const node of $('estimate-form').querySelectorAll('input,textarea,button'))node.disabled=true;
  $('retry').hidden=!pending;$('retry').disabled=busy||!selectionReady();
  $('estimate-retry').hidden=!pendingEstimate;$('estimate-retry').disabled=busy||!selectionReady();
  $('estimate-send').disabled=busy||!estimateReady();$('retry-photos').disabled=busy||photoLoading||!selectionReady();
  $('lock').disabled=!token;
}
function rememberPending(value){if(!storageReady)throw Error('This tab cannot safely preserve a pending reply. Use another tab before sending.');try{const encoded=JSON.stringify(value);sessionStorage.setItem(PENDING_KEY,encoded);if(sessionStorage.getItem(PENDING_KEY)!==encoded)throw Error();pending=value;}catch{storageReady=false;throw Error('This tab cannot safely preserve a pending reply. No new send was attempted.');}}
async function api(path,{method='GET',body}={}){
  if(!token)throw Error('The inbox is locked.');
  const key=token,epoch=sessionVersion;
  const response=await fetch('/owner/api'+path,{method,headers:{Authorization:'Bearer '+key,...(body?{'Content-Type':'application/json'}:{})},credentials:'omit',cache:'no-store',referrerPolicy:'no-referrer',signal:sessionAbort.signal,...(body?{body:JSON.stringify(body)}:{})});
  let data;try{data=await response.json();}catch{throw Error('The saved result could not be confirmed.');}
  if(epoch!==sessionVersion||token!==key)throw Error('The inbox is locked.');
  if(!response.ok||data?.ok!==true){const error=Error(response.status===401?'The owner access key was not accepted.':response.status===503?(pending||pendingEstimate?'The service is busy. Wait a few seconds, then retry the same pending action. Its original details are kept.':'The service is busy. Wait a few seconds, then refresh or retry.'):response.status===429?'Please wait a minute and try again.':response.status===409?'That pending operation conflicts with an earlier saved operation.':'The request could not be completed.');error.status=response.status;throw error;}
  return data;
}
function clearPhotos(){photoAbort.abort();photoAbort=new AbortController();photoLoading=false;photoRows=[];for(const value of photoURLs.values())URL.revokeObjectURL(value);photoURLs.clear();photoConversation=null;$('photos').replaceChildren();$('photo-status').textContent='';$('retry-photos').hidden=true;}
function clearSelection(){
  loadedSelection=null;guestActive=false;clearPhotos();loadedEstimate=null;previewSignature='';
  for(const id of ['customer','phone','customer-email','created','messages','access-status','notification-status','estimate-saved','estimate-number','preview-scope','preview-amount','preview-notes'])$(id).textContent='';
  $('phone').removeAttribute('href');$('customer-email').removeAttribute('href');$('customer-email').hidden=true;$('email-note').hidden=true;
  for(const id of ['address','size_of_home','stories','gutter_length','reply','estimate-scope','estimate-amount','estimate-notes'])$(id).value='';
  $('estimate-preview').hidden=true;$('more-messages').hidden=true;
}
function lockInbox(){
  sessionVersion++;sessionAbort.abort();token='';current=null;generation++;busy=false;clearSelection();saved.clear();$('list').replaceChildren();
  $('inbox').hidden=true;$('login').hidden=false;$('selected').hidden=true;$('empty').hidden=false;controls();
  say(pending||pendingEstimate?'Inbox locked. The pending action remains in this tab for recovery after sign-in.':'Inbox locked.');
}
async function showPhotos(rows){
  if(!selectionReady())return;
  const id=current,version=generation;
  if(photoConversation!==id){clearPhotos();photoConversation=id;}
  photoRows=rows;photoAbort.abort();const controller=new AbortController();photoAbort=controller;
  const active=()=>viewActive(id,version)&&photoAbort===controller;
  photoLoading=true;$('retry-photos').hidden=true;$('photo-status').textContent=rows.length?'Loading customer photos…':'';$('photos').replaceChildren();controls();
  try{
    if(!rows.length){$('photos').append(el('p','No project photos uploaded yet.','muted'));return;}
    for(const photo of rows){
      let src=photoURLs.get(photo.id);
      if(!src){
        // Bound this display-only read; retry is explicit and core request details stay usable.
        const timer=setTimeout(()=>controller.abort(),15000);
        try{
          const response=await fetch('/owner/api/conversations/'+id+'/photos/'+photo.id,{headers:{Authorization:'Bearer '+token},credentials:'omit',cache:'no-store',referrerPolicy:'no-referrer',signal:controller.signal});
          if(!response.ok)throw Error(response.status===503?'Photos are busy. Wait a few seconds, then retry loading photos.':'A customer photo could not be loaded. Retry loading photos.');
          const blob=await response.blob();if(!active())return;src=URL.createObjectURL(blob);photoURLs.set(photo.id,src);
        }finally{clearTimeout(timer);}
      }
      if(!active())return;
      const link=el('a');link.href=src;link.target='_blank';link.rel='noopener noreferrer';link.setAttribute('aria-label','Open customer photo '+photo.filename);
      const image=el('img');image.src=src;image.alt=photo.filename;image.loading='lazy';link.append(image,el('span',photo.filename));$('photos').append(link);
    }
    if(active())$('photo-status').textContent='';
  }catch(error){if(active()){$('photo-status').textContent=error.name==='AbortError'?'A customer photo took too long to load. Retry loading photos.':error.message;$('retry-photos').hidden=false;}}
  finally{if(active()){photoLoading=false;controls();}}
}
function loadEstimate(value){loadedEstimate=value;previewSignature='';$('estimate-preview').hidden=true;for(const key of ['scope','amount','notes'])$('estimate-'+key).value=value?.[key]||'';$('estimate-saved').textContent=value?(value.status==='published'?'Sent '+value.number+'. Start a new draft to send a revision.':'Saved private draft '+value.number+'. Preview it before sending.'):'No estimate has been saved for this request.';}
function previewEstimate(){selectedScope();if(!$('estimate-form').reportValidity())return;const value=estimateInput();previewSignature=estimateSignature(value);$('estimate-preview').hidden=false;$('estimate-number').textContent=loadedEstimate&&estimateSignature(loadedEstimate)===previewSignature?loadedEstimate.number+' · '+loadedEstimate.status:'Unsaved estimate preview';$('preview-scope').textContent=value.scope;$('preview-amount').textContent='$'+Number(value.amount).toLocaleString('en-US',{minimumFractionDigits:2,maximumFractionDigits:2})+' USD';$('preview-notes').textContent=value.notes||'No additional notes.';controls();}
function rememberEstimate(value){if(!storageReady)throw Error('This tab cannot preserve an uncertain estimate action. No send was attempted.');const encoded=JSON.stringify(value);try{sessionStorage.setItem(ESTIMATE_PENDING_KEY,encoded);if(sessionStorage.getItem(ESTIMATE_PENDING_KEY)!==encoded)throw Error();pendingEstimate=value;}catch{storageReady=false;throw Error('Could not preserve the pending estimate. No new send was attempted.');}}
async function sendEstimatePending(){
  const scope=selectedScope();if(!pendingEstimate||pendingEstimate.id!==scope.id)return;
  const saved={...pendingEstimate},base='/conversations/'+saved.id+'/estimates';
  const out=await api(saved.kind==='draft'?base:base+'/'+saved.estimateId+'/publish',{method:'POST',body:saved.kind==='draft'?{operationId:saved.operationId,...saved.input}:{operationId:saved.operationId}});
  if(out.receipt?.operationId!==saved.operationId||!out.estimate?.id)throw Error('The saved estimate result could not be confirmed.');
  // Keep this exact operation through readback: a committed write can outlive a lost response.
  if(!viewActive(scope.id,scope.version))return;
  const read=await api('/conversations/'+saved.id);
  if(!viewActive(scope.id,scope.version))return;
  const confirmed=read.estimates?.find(value=>value.id===out.estimate.id);
  if(!confirmed||estimateSignature(confirmed)!==estimateSignature(out.estimate)||saved.kind==='publish'&&confirmed.status!=='published')throw Error('The estimate was saved, but its readback could not be confirmed. Retry the pending estimate action.');
  loadEstimate(confirmed);await readMessages();if(!viewActive(scope.id,scope.version))return;
  try{sessionStorage.removeItem(ESTIMATE_PENDING_KEY);}catch{}
  pendingEstimate=null;
  say(saved.kind==='draft'?'Private estimate draft saved and read back. Preview it, then choose Send estimate to customer.':'Estimate sent to the customer’s private website page and read back. No SMS or email was sent.');
}
async function work(fn){if(busy)return;const epoch=sessionVersion;busy=true;controls();try{await fn();}catch(error){if(epoch===sessionVersion)say(error.message);}finally{if(epoch===sessionVersion){busy=false;controls();}}}
async function list(append=false){const out=await api('/conversations'+(append&&nextCursor?'?cursor='+encodeURIComponent(nextCursor):''));if(!append){saved.clear();$('list').replaceChildren();}for(const item of out.conversations){saved.set(item.id,item);const button=el('button');button.dataset.id=item.id;button.append(el('strong',item.name),el('div',new Date(item.createdAt).toLocaleString()),el('small',item.lastRole==='customer'?'Customer message most recent':'Saved conversation'));button.setAttribute('aria-current',String(current===item.id));button.addEventListener('click',()=>work(()=>select(item.id)));$('list').append(button);}nextCursor=out.nextCursor;$('more').hidden=!nextCursor;if(!saved.size)$('list').append(el('p','No website requests yet.'));}
function renderMessages(rows,replace=false){if(replace)$('messages').replaceChildren();for(const row of rows){const block=el('div',undefined,'message '+row.role);block.append(el('strong',({customer:'Customer',owner:'John',guide:'Website question'})[row.role]+' · '+new Date(row.createdAt).toLocaleString()),el('span',row.body));$('messages').append(block);}}
async function readMessages(replace=false){
  const id=current,version=generation;if(!id)return;
  const out=await api('/conversations/'+id+'?after='+(replace?0:cursor));if(!viewActive(id,version))return;
  if(out.conversation?.id!==id)throw Error('The loaded request did not match the selection. Refresh messages to retry.');
  if(replace||loadedSelection!==id){
    $('customer').textContent=out.conversation.repair.name||'Customer';const phone=out.conversation.repair.phone||'';$('phone').textContent=phone;$('phone').href='tel:'+phone.replace(/[^+0-9]/g,'');
    const email=out.conversation.repair.email||'';$('customer-email').textContent=email;$('customer-email').hidden=!email;$('email-note').hidden=!email;if(email)$('customer-email').href='mailto:'+encodeURIComponent(email).replace('%40','@');else $('customer-email').removeAttribute('href');
    const received=saved.get(id)?.createdAt;
    $('created').textContent=received?'Received '+new Date(received).toLocaleString():'Website request';for(const key of ['address','size_of_home','stories','gutter_length'])$(key).value=out.quoteDetails?.[key]??'';
    loadEstimate(out.estimates?.[0]||out.estimate||null);if(pendingEstimate?.kind==='draft')for(const key of ['scope','amount','notes'])$('estimate-'+key).value=pendingEstimate.input[key]||'';
    loadedSelection=id;for(const button of $('list').querySelectorAll('button'))button.setAttribute('aria-current',String(button.dataset.id===id));
  }
  renderMessages(out.messages,replace);cursor=out.cursor;$('more-messages').hidden=out.messages.length<100;guestActive=Boolean(out.guestAccess?.active);
  $('access-status').textContent=out.guestAccess?.revoked?'The customer return link is revoked. Use the callback number for follow-up.':out.guestAccess?.active?'Private return access expires '+new Date(out.conversation.expiresAt).toLocaleDateString()+'.':'The customer return link has expired. Use the callback number for follow-up.';
  const alerts=out.notifications;$('notification-status').textContent=(!alerts?.enabled?'Email alerts are off. Use the customer callback or email link. ':'')+(alerts?.events||[]).map(item=>({pending:'Email alert queued.',processing:'Email alert being submitted.',accepted:'Email alert submitted to the sender.',failed:'Email alert needs attention. Contact this customer directly.',uncertain:'Email alert delivery is unconfirmed. Check your inbox before resending.'})[item.status]).join(' ')||'No email alert is queued for this request.';
  controls();void showPhotos(out.photos||[]);return out;
}
async function select(id){
  if(pending&&pending.id!==id||pendingEstimate&&pendingEstimate.id!==id){say('Resolve the pending action before opening another request.');return;}
  current=id;generation++;cursor=0;clearSelection();$('empty').hidden=true;$('selected').hidden=false;$('reply').value=pending?.body||'';controls();
  const version=generation,out=await readMessages(true);if(!out||!viewActive(id,version))return;
  $('customer').focus();
  if(window.matchMedia?.('(max-width: 760px)').matches)$('selected').scrollIntoView({block:'start'});
  say('Saved conversation loaded.');
}
async function sendPending(){
  const scope=selectedScope();if(!pending||pending.id!==scope.id)return;const send={...pending};
  try{const out=await api('/conversations/'+send.id+'/operations/'+send.operationId);if(out.receipt?.operationId!==send.operationId)throw Error('The saved reply could not be confirmed.');}
  catch(error){if(error.status!==404)throw error;if(!viewActive(scope.id,scope.version))return;const out=await api('/conversations/'+send.id+'/messages',{method:'POST',body:{operationId:send.operationId,body:send.body}});if(out.receipt?.operationId!==send.operationId)throw Error('The saved reply could not be confirmed.');}
  if(!viewActive(scope.id,scope.version))return;try{sessionStorage.removeItem(PENDING_KEY);}catch{}pending=null;$('reply').value='';await readMessages();if(!viewActive(scope.id,scope.version))return;await list();if(viewActive(scope.id,scope.version))say('Reply saved to this conversation. No SMS or email was sent.');
}
$('login-form').addEventListener('submit',event=>{event.preventDefault();work(async()=>{const epoch=sessionVersion;token=$('owner-key').value;sessionAbort=new AbortController();$('owner-key').value='';try{await list();$('login').hidden=true;$('inbox').hidden=false;if(pending||pendingEstimate){await select(pending?.id||pendingEstimate.id);if(selectionReady())say('An action was pending before this page reloaded. Use its retry button to confirm the original operation.');}else say(storageReady?'Private inbox open.':'This tab cannot preserve pending actions. You can read messages, but sending is disabled.');}catch(error){if(epoch===sessionVersion){lockInbox();say('The inbox could not finish opening. Sign in again to retry. '+error.message);}throw error;}});});
$('lock').addEventListener('click',lockInbox);
$('refresh').addEventListener('click',()=>work(async()=>{await list();if(current){if(selectionReady())await readMessages();else await select(current);}if(token)say('Saved messages refreshed.');}));$('more').addEventListener('click',()=>work(()=>list(true)));$('more-messages').addEventListener('click',()=>work(()=>readMessages()));
$('retry-photos').addEventListener('click',()=>{if(selectionReady()&&!photoLoading)void showPhotos(photoRows);});
$('reply-form').addEventListener('submit',event=>{event.preventDefault();work(async()=>{const scope=selectedScope();if(pending)return;const body=$('reply').value.trim();if(!body)return;rememberPending({id:scope.id,operationId:crypto.randomUUID(),body});controls();await sendPending();});});$('retry').addEventListener('click',()=>work(sendPending));
$('quote-form').addEventListener('submit',event=>{event.preventDefault();work(async()=>{const scope=selectedScope();const body=Object.fromEntries(['address','size_of_home','gutter_length'].map(key=>[key,$(key).value.trim()||null]));body.stories=$('stories').value?Number($('stories').value):null;await api('/conversations/'+scope.id+'/quote-details',{method:'POST',body});if(viewActive(scope.id,scope.version))say('Quote details saved. No length or price was calculated.');});});
$('estimate-preview-button').addEventListener('click',()=>{try{previewEstimate();}catch(error){say(error.message);}});
$('estimate-form').addEventListener('input',()=>{previewSignature='';$('estimate-preview').hidden=true;controls();});
$('estimate-form').addEventListener('submit',event=>{event.preventDefault();work(async()=>{const scope=selectedScope();if(pending||pendingEstimate||!$('estimate-form').reportValidity())return;rememberEstimate({kind:'draft',id:scope.id,operationId:crypto.randomUUID(),input:estimateInput()});await sendEstimatePending();});});
$('estimate-send').addEventListener('click',()=>work(async()=>{const scope=selectedScope();if(!estimateReady())throw Error('Save your draft and preview the saved version before sending.');rememberEstimate({kind:'publish',id:scope.id,estimateId:loadedEstimate.id,operationId:crypto.randomUUID()});await sendEstimatePending();}));
$('estimate-retry').addEventListener('click',()=>work(sendEstimatePending));
$('revoke').addEventListener('click',()=>work(async()=>{const scope=selectedScope();await api('/conversations/'+scope.id+'/revoke',{method:'POST',body:{}});if(viewActive(scope.id,scope.version)){$('access-status').textContent='This private return link has been revoked. Saved messages are retained.';guestActive=false;controls();say('Customer return access revoked.');}}));
window.addEventListener('pagehide',lockInbox);
controls();
</script></main></body></html>`;

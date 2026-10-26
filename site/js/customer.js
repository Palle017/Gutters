import {validAccess, readSession, saveSession, removeSession, rememberAccess, newId, api, requireReceipt, readConversation, serviceAvailable, copyPrivateLink} from './request-api.js';

const status = document.querySelector('#customer-status');
const content = document.querySelector('#customer-content');
const refreshButton = document.querySelector('#refresh-request');
const copyButton = document.querySelector('#copy-private-link');
const messageForm = document.querySelector('#message-form');
const messageBody = document.querySelector('#message-body');
const sendButton = document.querySelector('#send-message');
const messageStatus = document.querySelector('#message-status');
let access;
let refreshing = false;
let sending = false;
let savedView;
const imageURLs = new Set();
const fragment = new URLSearchParams(location.hash.slice(1));
const supplied = {id: fragment.get('id'), key: fragment.get('key')};
let accessError;
if (location.hash) {
  history.replaceState(null, '', location.pathname + location.search);
  try { if (!validAccess(supplied)) throw new Error('That private link is incomplete. Use the complete link saved after submitting your request.'); rememberAccess(supplied); access = supplied; }
  catch (error) { accessError = error.message; }
} else {
  const active = readSession('everything-gutters.active-customer');
  if (active?.id) access = readSession('everything-gutters.customer.' + active.id);
  if (!validAccess(access)) access = null;
}
const messageStorageKey = access ? 'everything-gutters.pending-message.' + access.id : null;
let pendingMessage = messageStorageKey ? readSession(messageStorageKey) : null;

function setStatus(text, error = false) { status.textContent = text; status.classList.toggle('request-error', error); }
function formatDate(value) { const date = new Date(value); return Number.isNaN(date.valueOf()) ? '' : date.toLocaleString(undefined, {dateStyle: 'medium', timeStyle: 'short'}); }
function renderSummary(view) {
  const repair = view.conversation.repair || {};
  const list = document.querySelector('#project-summary'); list.replaceChildren();
  const names = {name: 'Name', phone: 'Callback number', details: 'Your project', address: 'Project address', homeSize: 'Home size', stories: 'Stories', gutterLength: 'Gutter length'};
  for (const [field, label] of Object.entries(names)) {
    const term = document.createElement('dt'); term.textContent = label;
    const detail = document.createElement('dd'); detail.textContent = repair[field] ? field === 'stories' ? repair[field] === '1' ? 'One story' : 'Two stories' : repair[field] : 'Not supplied';
    list.append(term, detail);
  }
}
function renderEstimate(view) {
  const estimate = view.estimate || view.conversation?.estimate;
  const published = estimate?.status === 'published';
  document.querySelector('#estimate-waiting').hidden = published;
  document.querySelector('#published-estimate').hidden = !published;
  if (!published) return;
  document.querySelector('#estimate-number').textContent = estimate.number ? 'Estimate ' + estimate.number : 'Prepared by John';
  let preparedFor = document.querySelector('#estimate-prepared-for');
  if (!preparedFor) { preparedFor = document.createElement('p'); preparedFor.id = 'estimate-prepared-for'; preparedFor.className = 'request-helper'; document.querySelector('#estimate-date').before(preparedFor); }
  preparedFor.textContent = 'Prepared for ' + (view.conversation?.repair?.name || 'this customer') + (view.conversation?.repair?.address ? ' · ' + view.conversation.repair.address : '') + ' · Request ' + access.id.slice(0, 8).toUpperCase();
  document.querySelector('#estimate-date').textContent = 'Shared ' + formatDate(estimate.publishedAt);
  const amount = String(estimate.amount);
  document.querySelector('#estimate-amount').textContent = /^\d+\.\d{2}$/.test(amount) && estimate.currency === 'USD' ? '$' + amount.replace(/\B(?=(\d{3})+(?!\d))/g, ',') : amount + (estimate.currency ? ' ' + estimate.currency : '');
  document.querySelector('#estimate-scope').textContent = estimate.scope || '';
  document.querySelector('#estimate-notes').textContent = estimate.notes || '';
  document.querySelector('#estimate-notes-group').hidden = !estimate.notes;
}
function renderMessages(view) {
  const list = document.querySelector('#message-list'); list.replaceChildren();
  for (const message of view.messages || []) {
    const li = document.createElement('li'); li.className = 'message message-' + (['owner', 'customer', 'guide'].includes(message.role) ? message.role : 'guide');
    const meta = document.createElement('div'); meta.className = 'message-meta';
    const author = document.createElement('strong'); author.textContent = message.role === 'owner' ? 'John' : message.role === 'customer' ? 'You' : 'Project details';
    const time = document.createElement('time'); time.dateTime = message.createdAt; time.textContent = formatDate(message.createdAt);
    const body = document.createElement('p'); body.textContent = message.body;
    meta.append(author, time); li.append(meta, body); list.append(li);
  }
  if (pendingMessage && (view.messages || []).some(message => message.operationId === pendingMessage.operationId && message.role === 'customer' && message.body === pendingMessage.body)) {
    removeSession(messageStorageKey); pendingMessage = null; messageBody.value = ''; messageBody.readOnly = false; sendButton.textContent = 'Send message →'; messageStatus.textContent = 'Your message is saved and appears in the conversation above.';
  }
}
async function renderPhotos(view) {
  const list = document.querySelector('#customer-photos');
  for (const url of imageURLs) URL.revokeObjectURL(url);
  imageURLs.clear(); list.replaceChildren();
  const photos = view.photos || view.conversation?.photos || [];
  document.querySelector('#customer-photo-status').textContent = photos.length ? photos.length + (photos.length === 1 ? ' photo saved with your request.' : ' photos saved with your request.') : 'No photos have been uploaded with this request.';
  let failures = 0;
  for (const photo of photos) {
    const li = document.createElement('li');
    const button = document.createElement('button'); button.type = 'button'; button.className = 'customer-photo-button'; button.setAttribute('aria-label', 'Open photo ' + photo.filename);
    const caption = document.createElement('span'); caption.textContent = photo.filename;
    button.append(caption); button.disabled = true; li.append(button); list.append(li);
    try {
      const blob = await api('/conversations/' + access.id + '/photos/' + photo.id, {token: access.key, binary: true});
      const url = URL.createObjectURL(blob); imageURLs.add(url);
      const image = document.createElement('img'); image.src = url; image.alt = photo.filename; image.loading = 'lazy'; button.prepend(image); button.disabled = false;
      button.addEventListener('click', () => { const full = document.querySelector('#full-photo'); full.src = url; full.alt = photo.filename; document.querySelector('#full-photo-name').textContent = photo.filename; document.querySelector('#photo-dialog').showModal(); });
    } catch { failures++; caption.textContent = photo.filename + ' · Image could not load'; }
  }
  if (failures) document.querySelector('#customer-photo-status').textContent += ' Some images did not load. Check for updates to retry.';
}
async function refresh({quiet = false} = {}) {
  if (!access || refreshing) return;
  refreshing = true; refreshButton.disabled = true;
  sendButton.disabled = true;
  if (!quiet) setStatus('Checking your saved request…');
  try {
    const view = await readConversation(access);
    if (view.conversation?.id !== access.id) throw new Error('The private request could not be confirmed.');
    savedView = view;
    content.hidden = false;
    document.querySelector('#request-reference').textContent = 'Request ' + access.id.slice(0, 8).toUpperCase() + ' · Private conversation';
    renderSummary(view); renderEstimate(view); renderMessages(view);
    await renderPhotos(view);
    setStatus('Last checked ' + new Date().toLocaleTimeString(undefined, {hour: 'numeric', minute: '2-digit'}) + '. Use “Check for updates” to see John’s latest messages and estimate.');
    return view;
  } catch (error) { setStatus(error.message, true); throw error; }
  finally { refreshing = false; refreshButton.disabled = false; sendButton.disabled = sending; }
}
refreshButton.addEventListener('click', () => { if (!sending) refresh().catch(() => {}); });
copyButton.addEventListener('click', () => { if (access) copyPrivateLink(access, document.querySelector('#customer-private-link'), status); });
document.querySelector('#print-estimate').addEventListener('click', () => window.print());
document.querySelector('#close-photo').addEventListener('click', () => document.querySelector('#photo-dialog').close());
document.querySelector('#photo-dialog').addEventListener('click', event => { if (event.target === event.currentTarget) event.currentTarget.close(); });
messageForm.addEventListener('submit', async event => {
  event.preventDefault();
  if (!access || sending || refreshing) return;
  const body = messageBody.value.trim();
  if (!pendingMessage && (!body || !messageForm.reportValidity())) return;
  sending = true; sendButton.disabled = true;
  try {
    if (!pendingMessage) { const operation = {operationId: newId(), body}; saveSession(messageStorageKey, operation); pendingMessage = operation; }
    messageBody.readOnly = true;
    messageStatus.classList.remove('request-error'); messageStatus.textContent = 'Sending your message…';
    const result = await api('/conversations/' + access.id + '/messages', {method: 'POST', token: access.key, body: pendingMessage});
    requireReceipt(result, pendingMessage.operationId);
    const view = await refresh({quiet: true});
    if (!view || pendingMessage) throw new Error('A receipt was returned, but the message readback is still pending. Retry to check the same message.');
    messageStatus.textContent = 'Your message is saved and appears in the conversation above.';
  } catch (error) { messageStatus.classList.add('request-error'); messageStatus.textContent = error.message; sendButton.textContent = 'Retry the same message →'; }
  finally { sending = false; sendButton.disabled = false; }
});
if (pendingMessage) {
  messageBody.value = pendingMessage.body; messageBody.readOnly = true; sendButton.textContent = 'Retry the same message →'; messageStatus.textContent = 'Your earlier message is kept here until the service confirms it. Retry to continue without sending a duplicate.';
}
if (!access) {
  content.hidden = true; document.querySelector('#no-access').hidden = false; refreshButton.disabled = true; copyButton.disabled = true; setStatus(accessError || 'A private request link is needed to open this page.', true);
} else serviceAvailable().then(available => {
  if (available) return refresh().catch(() => {});
  content.hidden = true; refreshButton.disabled = true; sendButton.disabled = true;
  document.querySelector('#request-reference').textContent = 'Private request unavailable';
  document.querySelector('#service-notice').hidden = false;
  setStatus('The online request service is not available right now. Please call, text or email John.', true);
});
window.addEventListener('pagehide', () => { for (const url of imageURLs) URL.revokeObjectURL(url); });

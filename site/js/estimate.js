import {REQUEST_KEY, FIELDS, MAX_PHOTOS, newId, newKey, validAccess, readSession, saveSession, rememberAccess, privateLink, api, requireReceipt, readConversation, serviceAvailable, replyEmailAvailable, fileHash, validateSelectedPhoto, keepPhoto, getPhoto, releasePhoto, copyPrivateLink} from './request-api.js';

const form = document.querySelector('#estimate-form');
const fieldset = document.querySelector('#request-fields');
const photoInput = document.querySelector('#photos');
const cameraInput = document.querySelector('#camera-photo');
const photoList = document.querySelector('#photo-list');
const photoError = document.querySelector('#photo-error');
const submit = document.querySelector('#submit-request');
const status = document.querySelector('#request-status');
let selected = [];
let pending = readSession(REQUEST_KEY);
let busy = false;
let selecting = false;
let serviceDown = false;
const HISTORY_KEY = 'everything-gutters.completed-requests.v2';
if (!pending?.payload || pending.payload.schemaVersion !== 2 || !Array.isArray(pending.photos)) pending = null;

function showStatus(text, error = false) {
  status.textContent = text;
  status.classList.toggle('request-error', error);
}
function accessForRequest() { return {id: pending.payload.conversationId, key: pending.payload.accessToken}; }
function savePending() { saveSession(REQUEST_KEY, pending); }
function activePhotos() { return pending.photos.filter(photo => photo.status !== 'removed'); }
function renderPreviousRequests() {
  const history = readSession(HISTORY_KEY);
  const list = document.querySelector('#previous-request-list'); list.replaceChildren();
  for (const saved of Array.isArray(history) ? history : []) {
    const access = {id: saved?.payload?.conversationId, key: saved?.payload?.accessToken};
    if (!saved.complete || !validAccess(access)) continue;
    const item = document.createElement('li'); const link = document.createElement('a');
    link.href = privateLink(access); link.textContent = 'Open saved request ' + access.id.slice(0,8).toUpperCase() + (saved.payload.intake?.details ? ' · ' + saved.payload.intake.details.slice(0,80) : '');
    item.append(link); list.append(item);
  }
  document.querySelector('#previous-requests').hidden = !list.children.length;
}
function lockSubmitted() {
  fieldset.disabled = true;
  photoInput.disabled = true;
  if (cameraInput) cameraInput.disabled = true;
  for (const button of photoList.querySelectorAll('button')) button.disabled = true;
}
function photoMessage(text) {
  photoError.textContent = text;
  photoError.hidden = !text;
}
function displayPhotos() {
  photoList.replaceChildren();
  const items = pending ? activePhotos() : selected;
  for (const item of items) {
    const li = document.createElement('li');
    li.className = 'request-photo-item';
    const file = selected.find(photo => photo.id === item.id);
    if (file?.url) {
      const image = document.createElement('img'); image.src = file.url; image.alt = 'Selected project photo: ' + item.name; li.append(image);
    } else {
      const icon = document.createElement('span'); icon.className = 'queued-photo-icon'; icon.textContent = item.status === 'saved' ? '✓' : 'PHOTO'; icon.setAttribute('aria-hidden', 'true'); li.append(icon);
    }
    const details = document.createElement('div');
    const name = document.createElement('strong'); name.textContent = item.name;
    const info = document.createElement('span'); info.textContent = pending ? item.status === 'saved' ? 'Saved with your request' : item.status === 'rejected' ? item.rejection || 'This photo was rejected.' : 'Waiting to upload' : (item.size / 1024 / 1024).toFixed(1) + ' MB';
    details.append(name, info); li.append(details);
    if (!pending) {
      const remove = document.createElement('button'); remove.type = 'button'; remove.textContent = 'Remove'; remove.setAttribute('aria-label', 'Remove ' + item.name);
      remove.addEventListener('click', () => { if (busy) return; URL.revokeObjectURL(item.url); selected = selected.filter(photo => photo.id !== item.id); displayPhotos(); photoMessage(''); });
      li.append(remove);
    } else if (item.status === 'rejected' && pending.created && !pending.complete) {
      const remove = document.createElement('button'); remove.type = 'button'; remove.textContent = 'Remove rejected photo and continue';
      remove.addEventListener('click', () => removeRejectedPhoto(item)); li.append(remove);
    }
    photoList.append(li);
  }
}
async function choosePhotos(event) {
  if (pending || busy || selecting) return;
  selecting = true; submit.disabled = true;
  photoMessage('');
  const files = [...event.target.files];
  const errors = [];
  for (const file of files) {
    if (selected.length >= MAX_PHOTOS) { errors.push('You can add up to six photos.'); break; }
    try { await validateSelectedPhoto(file); } catch (error) { errors.push(file.name + ': ' + error.message); continue; }
    if (selected.some(photo => photo.name === file.name && photo.size === file.size && photo.file.lastModified === file.lastModified)) continue;
    selected.push({id: newId(), file, name: file.name, size: file.size, type: file.type, url: URL.createObjectURL(file)});
  }
  event.target.value = '';
  displayPhotos();
  photoMessage(errors.join(' '));
  selecting = false; submit.disabled = false;
}
photoInput.addEventListener('change', choosePhotos);
cameraInput?.addEventListener('change', choosePhotos);

function buildPayload() {
  const values = Object.fromEntries(FIELDS.map(field => [field, form.elements[field].value.trim()]));
  if (!values.name) throw new Error('Please enter the name John should use for your request.');
  if (Object.values(values).some(value => /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(value))) throw new Error('One of your entries contains an unsupported character. Please retype that detail and try again.');
  if (values.email && (!/^[A-Za-z0-9.!#$%&'*+/=?^_`{|}~-]+@[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?(?:\.[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?)+$/.test(values.email) || values.email.length > 254 || values.email.split('@')[0].length > 64 || values.email.startsWith('.') || values.email.includes('..') || values.email.includes('.@'))) throw new Error('Please enter a valid reply email, or leave email blank.');
  const digits = values.phone.replace(/\D/g, '');
  if (!/^\+?[\d\s().-]+$/.test(values.phone) || digits.length < 10 || digits.length > 15) throw new Error('Please enter a callback number with 10 to 15 digits.');
  const answers = FIELDS.filter(field => field !== 'email' || values.email).map(field => values[field] ? {field, state: 'provided', answer: values[field]} : {field, state: 'unknown'});
  return {schemaVersion: 2, conversationId: newId(), operationId: newId(), accessToken: newKey(), intake: Object.fromEntries(Object.entries(values).filter(([, value]) => value)), answers};
}
async function preparePending() {
  const payload = buildPayload();
  const photos = [];
  for (const photo of selected) {
    await validateSelectedPhoto(photo.file);
    const metadata = {id: photo.id, operationId: newId(), name: photo.name, size: photo.size, type: photo.type, hash: await fileHash(photo.file), status: 'pending'};
    await keepPhoto({id: photo.id, file: photo.file, operationId: metadata.operationId, hash: metadata.hash});
    photos.push(metadata);
  }
  const prepared = {version: 2, payload, photos, created: false, complete: false};
  saveSession(REQUEST_KEY, prepared);
  pending = prepared;
  rememberAccess(accessForRequest());
  lockSubmitted();
}
function showSuccess() {
  const access = accessForRequest();
  document.querySelector('#request-entry').hidden = true;
  document.querySelector('#request-success').hidden = false;
  const count = activePhotos().length;
  document.querySelector('#success-details').textContent = 'Your project details' + (count ? ' and ' + count + (count === 1 ? ' photo are' : ' photos are') : ' are') + ' saved with your private request.';
  document.querySelector('#open-request').href = privateLink(access);
  document.querySelector('#copy-request-link').onclick = () => copyPrivateLink(access, document.querySelector('#private-request-link'), status);
  showStatus('Saved and confirmed. John will prepare the scope and price after reviewing your project.');
}
document.querySelector('#start-another-request').addEventListener('click', () => {
  if (!pending?.complete || busy || selecting) return;
  try {
    const history = readSession(HISTORY_KEY);
    const retained = (Array.isArray(history) ? history : []).filter(item => item?.payload?.conversationId !== pending.payload.conversationId);
    saveSession(HISTORY_KEY, [...retained, pending]);
    rememberAccess(accessForRequest());
    try { sessionStorage.removeItem(REQUEST_KEY); } catch { throw new Error('The browser could not open a new request safely. Your completed request is still available.'); }
    for (const photo of selected) URL.revokeObjectURL(photo.url);
    selected = []; pending = null; form.reset(); fieldset.disabled = false; photoInput.disabled = false; if (cameraInput) cameraInput.disabled = false;
    submit.disabled = false; submit.textContent = 'Send request to John →';
    document.querySelector('#request-success').hidden = true; document.querySelector('#request-entry').hidden = serviceDown;
    document.querySelector('#private-request-link').hidden = true; document.querySelector('#request-recovery')?.remove();
    displayPhotos(); photoMessage(''); renderPreviousRequests();
    showStatus('Ready for another project. Your earlier request and private link are listed below.');
    form.elements.name.focus();
  } catch (error) { showStatus(error.message, true); }
});
async function removeRejectedPhoto(photo) {
  if (busy || !pending?.created || pending.complete || photo.status !== 'rejected') return;
  busy = true; submit.disabled = true;
  try {
    const access = accessForRequest();
    try {
      const confirmed = await api('/conversations/' + access.id + '/operations/' + photo.operationId, {token: access.key});
      const receipt = requireReceipt(confirmed, photo.operationId);
      if (!receipt.photoId) throw new Error('This photo’s saved state could not be confirmed. Retry the same upload.');
      photo.status = 'saved'; photo.photoId = receipt.photoId; delete photo.rejection; savePending();
      showStatus('That photo was already saved. It has been kept with your request.');
    } catch (error) {
      if (error.status !== 404 || error.code !== 'operation_unavailable') throw error;
      photo.status = 'removed'; savePending();
      releasePhoto(photo.id).catch(() => {});
      showStatus('The rejected photo was not saved and has been removed from this upload queue. Continuing your existing request…');
    }
    displayPhotos();
  } catch (error) { showStatus('The photo’s saved state could not be checked, so it has been kept for a safe retry. ' + error.message, true); return; }
  finally { busy = false; submit.disabled = false; }
  form.requestSubmit();
}
form.addEventListener('submit', async event => {
  event.preventDefault();
  if (busy || selecting) return;
  if (!pending && !form.reportValidity()) return;
  busy = true; submit.disabled = true;
  lockSubmitted();
  try {
    if (!pending) { showStatus('Keeping your request and selected photos ready for a safe send…'); await preparePending(); }
    const access = accessForRequest();
    if (!pending.created) {
      showStatus('Sending your project details to John…');
      const created = await api('/conversations', {method: 'POST', body: pending.payload});
      requireReceipt(created, pending.payload.operationId);
      if (created.conversation?.id !== access.id) throw new Error('The request receipt did not match. Retry to confirm the same request.');
      pending.created = true; pending.receipt = created.receipt; savePending();
    }
    let position = 0;
    for (const photo of activePhotos()) {
      position++;
      if (photo.status === 'saved') continue;
      if (photo.status === 'rejected') throw new Error('Remove the rejected photo using the action beside it to continue with your other photos.');
      showStatus('Project details saved. Uploading photo ' + position + ' of ' + activePhotos().length + '…');
      const kept = await getPhoto(photo.id);
      if (!kept?.file || kept.operationId !== photo.operationId || await fileHash(kept.file) !== photo.hash) throw new Error('Your request details are saved, but this browser could not reopen ' + photo.name + '. Keep your private link and contact John about the remaining photo.');
      const body = new FormData(); body.set('operationId', photo.operationId); body.set('file', kept.file, photo.name);
      let uploaded;
      try { uploaded = await api('/conversations/' + access.id + '/photos', {method: 'POST', token: access.key, body}); }
      catch (error) { if ([400,413,415].includes(error.status)) { photo.status = 'rejected'; photo.rejection = error.message; savePending(); displayPhotos(); } throw error; }
      const receipt = requireReceipt(uploaded, photo.operationId);
      if (!uploaded.photo?.id || receipt.photoId !== uploaded.photo.id) throw new Error('The photo save was not confirmed. Retry to check the same upload.');
      photo.status = 'saved'; photo.photoId = uploaded.photo.id; savePending();
      displayPhotos();
    }
    showStatus('Checking your saved request…');
    const saved = await readConversation(access);
    if (saved.conversation?.id !== access.id || activePhotos().some(photo => !(saved.photos || saved.conversation?.photos || []).some(actual => actual.id === photo.photoId))) throw new Error('The final readback did not include every saved item. Retry to check your existing request.');
    pending.complete = true; pending.completedAt = new Date().toISOString(); savePending();
    for (const photo of pending.photos) releasePhoto(photo.id).catch(() => {});
    showSuccess();
    document.querySelector('#request-success').focus();
  } catch (error) {
    showStatus((pending?.created ? 'Your project details are saved. ' : '') + error.message, true);
    if (pending?.created) {
      const access = accessForRequest();
      let recovery = document.querySelector('#request-recovery');
      if (!recovery) { recovery = document.createElement('p'); recovery.id = 'request-recovery'; status.after(recovery); }
      const link = document.createElement('a'); link.href = privateLink(access); link.textContent = 'Open your existing private request'; recovery.replaceChildren(link);
    }
    submit.textContent = pending?.created ? 'Retry remaining photos / confirm save →' : pending ? 'Retry the same request →' : 'Send request to John →';
  } finally {
    busy = false; submit.disabled = false;
    if (pending && !pending.complete) displayPhotos();
    if (!pending) { fieldset.disabled = false; photoInput.disabled = false; if (cameraInput) cameraInput.disabled = false; for (const button of photoList.querySelectorAll('button')) button.disabled = false; }
  }
});

if (pending) {
  for (const field of FIELDS) form.elements[field].value = pending.payload.intake[field] || '';
  lockSubmitted(); displayPhotos();
  if (pending.complete) showSuccess();
  else {
    submit.textContent = pending.created ? 'Resume photos / confirm saved request →' : 'Retry the same request →';
    showStatus('Your earlier send is kept in this tab. Retry safely to continue the same request without creating another one.');
  }
}
renderPreviousRequests();
serviceAvailable().then(available => {
  if (available) {
    document.querySelector('#email-field').hidden = !replyEmailAvailable();
    form.elements.email.disabled = !replyEmailAvailable();
    return;
  }
  serviceDown = true;
  document.querySelector('#request-entry').hidden = true;
  lockSubmitted(); submit.disabled = true;
  document.querySelector('#service-notice').hidden = false;
});

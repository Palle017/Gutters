const UUID = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/;
const KEY = /^[A-Za-z0-9_-]{43}$/;
export const REQUEST_KEY = 'everything-gutters.request.v2';
export const FIELDS = ['name', 'phone', 'details', 'address', 'homeSize', 'stories', 'gutterLength'];
export const MAX_PHOTOS = 6;
export const MAX_PHOTO_BYTES = 5 * 1024 * 1024;
export const PHOTO_TYPES = ['image/jpeg', 'image/png', 'image/webp'];

export function newId() { return crypto.randomUUID(); }
export function newKey() {
  const bytes = crypto.getRandomValues(new Uint8Array(32));
  return btoa(String.fromCharCode(...bytes)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}
export function validAccess(value) { return value && UUID.test(value.id) && KEY.test(value.key); }
export function readSession(key) {
  try { return JSON.parse(sessionStorage.getItem(key) || 'null'); } catch { return null; }
}
export function saveSession(key, value) {
  try { sessionStorage.setItem(key, JSON.stringify(value)); }
  catch { throw new Error('This browser could not save your retry details. Allow storage for this site, or call John at (239) 355-3686. Nothing new was sent.'); }
}
export function removeSession(key) { try { sessionStorage.removeItem(key); } catch { /* Keep successful receipt usable even with unavailable storage. */ } }
export function rememberAccess(access) {
  if (!validAccess(access)) throw new Error('The private request link is incomplete.');
  saveSession('everything-gutters.customer.' + access.id, access);
  saveSession('everything-gutters.active-customer', {id: access.id});
}
export function privateLink(access) {
  const url = new URL('customer.html', location.href);
  url.hash = new URLSearchParams({id: access.id, key: access.key}).toString();
  return url.href;
}

const ERROR_TEXT = {
  origin_not_allowed: 'This preview is not connected to the request service yet. Please call or text John at (239) 355-3686.',
  conversation_unavailable: 'That private request could not be opened. Check that you copied the complete private link.',
  access_expired: 'This private link has expired or was closed. Please call or text John to continue.',
  invalid_phone: 'Please enter a phone number with 10 to 15 digits.',
  rate_limited: 'There have been several requests. Wait a minute, then retry. Your existing retry details are kept.',
  operation_conflict: 'The service could not match this retry to the original request. Please keep this page open and contact John.',
  photo_limit: 'This request already has the maximum of six photos.',
  photo_too_large: 'Each photo must be 5 MB or smaller.',
  invalid_photo: 'Please use a JPEG, PNG, or WebP photo.',
  unsupported_photo: 'Please use a JPEG, PNG, or WebP photo.',
  invalid_filename: 'Please use a photo filename up to 150 characters, with a matching .jpg, .jpeg, .png, or .webp extension.',
  empty_photo: 'This photo is empty. Choose the original image file and try again.',
  storage_unavailable: 'The service could not confirm a save. Please retry; the same request will be used.',
  route_unavailable: 'The online request service is not available at this address yet. Please call or text John at (239) 355-3686.'
};

export async function api(path, {method = 'GET', token, body, binary = false} = {}) {
  if (location.protocol === 'file:') throw new Error('Online requests need the website’s connected preview. Please call or text John at (239) 355-3686 from this file preview.');
  const headers = {};
  if (token) headers.Authorization = 'Bearer ' + token;
  if (body && !(body instanceof FormData)) headers['Content-Type'] = 'application/json';
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), body instanceof FormData ? 60000 : 25000);
  try {
    const response = await fetch(path, {method, headers, body: body instanceof FormData ? body : body ? JSON.stringify(body) : undefined, credentials: 'omit', cache: 'no-store', referrerPolicy: 'no-referrer', signal: controller.signal});
    if (binary && response.ok) return response.blob();
    let data;
    try { data = await response.json(); } catch { throw new Error('The service did not confirm a save. Retry to check the same request, or call John at (239) 355-3686.'); }
    if (!response.ok || data.ok !== true) {
      const error = new Error(ERROR_TEXT[data.error] || (response.status === 413 ? 'Each photo must be 5 MB or smaller.' : 'The service could not complete this step. Please retry; your request details are kept.'));
      error.code = data.error;
      error.status = response.status;
      throw error;
    }
    return data;
  } catch (error) {
    if (error.name === 'AbortError' || error instanceof TypeError) throw new Error('The connection ended before a save could be confirmed. Retry safely using the same request.');
    throw error;
  } finally { clearTimeout(timer); }
}

export function requireReceipt(data, operationId) {
  if (data?.ok !== true || data.receipt?.operationId !== operationId) throw new Error('A matching save receipt was not returned. Retry to check the same request.');
  return data.receipt;
}
export async function readConversation(access) {
  const first = await api('/conversations/' + access.id, {token: access.key});
  const all = [...(first.messages || [])];
  let cursor = first.cursor || 0;
  let lastCount = (first.messages || []).length;
  for (let page = 0; lastCount === 100 && page < 10; page++) {
    const next = await api('/conversations/' + access.id + '?after=' + cursor, {token: access.key});
    if (!next.cursor || next.cursor <= cursor) break;
    all.push(...(next.messages || []));
    cursor = next.cursor;
    lastCount = (next.messages || []).length;
  }
  return {...first, messages: all, cursor};
}
export async function fileHash(file) {
  const bytes = await crypto.subtle.digest('SHA-256', await file.arrayBuffer());
  return Array.from(new Uint8Array(bytes), byte => byte.toString(16).padStart(2, '0')).join('');
}
export async function validateSelectedPhoto(file) {
  if (!file || !PHOTO_TYPES.includes(file.type)) throw new Error('Use a JPEG, PNG, or WebP photo.');
  if (!file.size || file.size > MAX_PHOTO_BYTES) throw new Error('Choose a photo between 1 byte and 5 MB.');
  if (!file.name || file.name.length > 150 || /[\\/\u0000-\u001f\u007f]/.test(file.name)) throw new Error('Use a photo filename up to 150 characters without slashes or control characters.');
  const bytes = new Uint8Array(await file.arrayBuffer());
  const ascii = (start, end) => String.fromCharCode(...bytes.subarray(start, end));
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let detected;
  if (bytes.length >= 45 && [137,80,78,71,13,10,26,10].every((value, index) => bytes[index] === value) && ascii(12,16) === 'IHDR' && view.getUint32(16) > 0 && view.getUint32(20) > 0 && ascii(bytes.length - 8, bytes.length - 4) === 'IEND') detected = 'image/png';
  if (bytes.length >= 12 && bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255 && bytes.at(-2) === 255 && bytes.at(-1) === 217) detected = 'image/jpeg';
  if (bytes.length >= 20 && ascii(0,4) === 'RIFF' && view.getUint32(4,true) + 8 === bytes.length && ascii(8,12) === 'WEBP' && ['VP8 ','VP8L','VP8X'].includes(ascii(12,16))) detected = 'image/webp';
  const extension = {'image/png': /\.png$/i, 'image/jpeg': /\.jpe?g$/i, 'image/webp': /\.webp$/i};
  if (!detected || file.type !== detected || !extension[detected].test(file.name)) throw new Error('The photo contents, filename extension, and image type must match. Export it as a JPEG, PNG, or WebP photo and select it again.');
}

let database;
function photoDatabase() {
  if (!database) database = new Promise((resolve, reject) => {
    if (typeof indexedDB === 'undefined') { reject(new Error('Your browser could not keep these photos for a safe retry. Allow site storage, or send your request without photos and contact John.')); return; }
    const request = indexedDB.open('everything-gutters-photo-retries', 1);
    request.onupgradeneeded = () => request.result.createObjectStore('photos', {keyPath: 'id'});
    request.onerror = () => reject(new Error('Your browser could not keep these photos for a safe retry. Allow site storage, or send your request without photos and contact John.'));
    request.onsuccess = () => resolve(request.result);
    request.onblocked = () => reject(new Error('Please close another copy of this request page and retry.'));
  });
  return database;
}
export async function keepPhoto(record) {
  const db = await photoDatabase();
  return new Promise((resolve, reject) => {
    const transaction = db.transaction('photos', 'readwrite');
    transaction.objectStore('photos').put(record);
    transaction.oncomplete = () => resolve();
    transaction.onerror = transaction.onabort = () => reject(new Error('The selected photo could not be kept for a safe retry. Please try again or call John.'));
  });
}
export async function getPhoto(id) {
  const db = await photoDatabase();
  return new Promise((resolve, reject) => {
    const request = db.transaction('photos').objectStore('photos').get(id);
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(new Error('A queued photo could not be reopened. Keep the original photo and call John if retry does not work.'));
  });
}
export async function releasePhoto(id) {
  const db = await photoDatabase();
  return new Promise((resolve, reject) => {
    const transaction = db.transaction('photos', 'readwrite');
    transaction.objectStore('photos').delete(id);
    transaction.oncomplete = () => resolve();
    transaction.onerror = () => reject(new Error('Photo cleanup did not finish.'));
  });
}
export async function copyPrivateLink(access, input, status) {
  const link = privateLink(access);
  if (input) { input.value = link; input.hidden = false; }
  try { await navigator.clipboard.writeText(link); status.textContent = 'Private link copied. Keep it somewhere safe; anyone with it can open your request.'; }
  catch { if (input) { input.focus(); input.select(); } status.textContent = 'Select and copy the private link below. Anyone with it can open your request.'; }
}

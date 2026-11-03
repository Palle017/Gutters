import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {webcrypto} from 'node:crypto';
import {JSDOM} from 'jsdom';

const site = new URL('../site/', import.meta.url);
const jpeg = new Uint8Array([255, 216, 255, 0, 0, 0, 0, 0, 0, 0, 255, 217]);
const photoId = '601fb16a-df6b-4fa7-abfe-7a337a75bf82';
const json = data => new Response(JSON.stringify(data), {status: 200, headers: {'Content-Type': 'application/json'}});
async function waitFor(check) {
  const end = Date.now() + 1500;
  while (!check()) { if (Date.now() > end) throw Error('Timed out waiting for the estimate form.'); await new Promise(resolve => setTimeout(resolve, 10)); }
}
function mockPhotoStore(window) {
  const records = new Map();
  const db = {transaction() {
    const tx = {};
    tx.objectStore = () => ({
      put(record) { records.set(record.id, record); queueMicrotask(() => tx.oncomplete?.()); },
      get(id) { const request = {}; queueMicrotask(() => { request.result = records.get(id); request.onsuccess?.(); }); return request; },
      delete(id) { records.delete(id); queueMicrotask(() => tx.oncomplete?.()); }
    });
    return tx;
  }};
  window.indexedDB = {open() { const request = {}; queueMicrotask(() => { request.result = db; request.onsuccess?.(); }); return request; }};
}
async function load(fetch, setup) {
  const dom = new JSDOM(await readFile(new URL('estimate.html', site), 'utf8'), {url: 'http://127.0.0.1:18965/estimate.html', runScripts: 'outside-only'});
  Object.defineProperty(dom.window, 'crypto', {value: webcrypto});
  dom.window.URL.createObjectURL = () => 'blob:synthetic-photo';
  dom.window.URL.revokeObjectURL = () => {};
  dom.window.fetch = (path, options = {}) => path === '/healthz'
    ? Promise.resolve(json({ok: true, storage: 'sqlite', service: 'gutters-messaging'}))
    : fetch(dom.window, path, options);
  if (setup) setup(dom.window);
  const common = (await readFile(new URL('js/request-api.js', site), 'utf8')).replace(/^export /gm, '');
  const entry = (await readFile(new URL('js/estimate.js', site), 'utf8')).replace(/^import .*?;\s*/m, '');
  dom.window.eval(common + '\n' + entry);
  return dom;
}
async function choosePhoto(dom) {
  const input = dom.window.document.querySelector('#photos');
  const file = new dom.window.File([jpeg], 'project.jpg', {type: 'image/jpeg'});
  Object.defineProperty(file, 'arrayBuffer', {value: async () => jpeg.buffer});
  Object.defineProperty(input, 'files', {configurable: true, value: [file]});
  input.dispatchEvent(new dom.window.Event('change'));
  await waitFor(() => dom.window.document.querySelector('#photo-list').children.length === 1 && !dom.window.document.querySelector('#submit-request').disabled);
}

test('the fastest way asks for one photo and a phone number, with optional name and address', async () => {
  const html = await readFile(new URL('estimate.html', site), 'utf8');
  const document = new JSDOM(html).window.document;
  assert.match(document.querySelector('h1').textContent, /One photo/);
  assert.match(document.querySelector('#form-heading').textContent, /Fastest way/);
  assert.equal(document.querySelector('#phone').required, true);
  assert.match(document.querySelector('#phone').autocomplete, /tel/);
  assert.equal(document.querySelector('#name').required, false);
  assert.match(document.querySelector('#name').autocomplete, /name/);
  assert.equal(document.querySelector('#address').required, false);
  assert.match(document.querySelector('#address').autocomplete, /street-address/);
  assert.deepEqual([...document.querySelectorAll('input[name="jobType"]')].map(input => input.value), ['Gutters', 'Gutter guards', 'Screens', 'Repair', 'Other']);
  assert.equal(document.querySelector('#success-heading').textContent, 'Got it, John will reach out.');
  assert.doesNotMatch(document.querySelector('#request-success').textContent, /minute|hour|today|tomorrow|same day/i);
  assert.equal(document.querySelector('#photo-text-fallback a')?.getAttribute('href'), 'sms:+12393553686');
  assert.match(document.querySelector('#photo-text-fallback').textContent, /239-355-3686/);
  assert.match(document.querySelector('header').textContent, /Request estimate/);
  assert.match(document.querySelector('footer').textContent, /Jwisdom030@gmail.com/);
  assert.doesNotMatch(html, /foundation/i);
});

test('phone and a job type can be saved without a name', async () => {
  const creates = [];
  const dom = await load((window, path, options) => {
    if (path === '/conversations') {
      const body = JSON.parse(options.body);
      creates.push(body);
      return Promise.resolve(json({ok: true, conversation: {id: body.conversationId}, receipt: {operationId: body.operationId, sequence: 2}}));
    }
    return Promise.resolve(json({ok: true, conversation: {id: creates[0].conversationId}, messages: [], photos: [], cursor: 0}));
  });
  try {
    const {document} = dom.window;
    document.querySelector('#phone').value = '(239) 555-0199';
    document.querySelector('input[name="jobType"][value="Screens"]').checked = true;
    document.querySelector('#estimate-form').dispatchEvent(new dom.window.Event('submit', {cancelable: true}));
    await waitFor(() => !document.querySelector('#request-success').hidden);
    assert.equal(creates.length, 1);
    assert.equal(Object.hasOwn(creates[0].intake, 'name'), false);
    assert.equal(creates[0].intake.phone, '(239) 555-0199');
    assert.equal(creates[0].intake.details, 'Job type: Screens');
    assert.equal(creates[0].answers.find(answer => answer.field === 'name').state, 'unknown');
    assert.equal(Object.hasOwn(creates[0], 'jobType'), false);
    assert.equal(document.querySelector('#success-heading').textContent, 'Got it, John will reach out.');
    assert.equal(document.querySelector('#request-status').textContent, 'Got it, John will reach out.');
    assert.equal(document.querySelector('#photo-text-fallback').hidden, true);
  } finally { dom.window.close(); }
});

test('an empty phone number does not send a request', async () => {
  let created = 0;
  const dom = await load(() => { created++; return Promise.resolve(json({ok: false})); });
  try {
    const {document} = dom.window;
    document.querySelector('input[name="jobType"][value="Gutters"]').checked = true;
    document.querySelector('#estimate-form').dispatchEvent(new dom.window.Event('submit', {cancelable: true}));
    await new Promise(resolve => setTimeout(resolve, 30));
    assert.equal(created, 0);
    assert.equal(document.querySelector('#request-success').hidden, true);
    assert.equal(document.querySelector('#phone').validity.valueMissing, true);
  } finally { dom.window.close(); }
});

test('a photo route that cannot accept the file keeps it on the device and gives the text number', async () => {
  const creates = [];
  let photoPosts = 0;
  const dom = await load((window, path, options) => {
    if (path === '/conversations' && options.method === 'POST') {
      const body = JSON.parse(options.body);
      creates.push(body);
      return Promise.resolve(json({ok: true, conversation: {id: body.conversationId}, receipt: {operationId: body.operationId, sequence: 2}}));
    }
    if (String(path).endsWith('/photos') && options.method === 'POST') {
      photoPosts++;
      return Promise.resolve(new Response(JSON.stringify({ok: false, error: 'route_unavailable'}), {status: 404, headers: {'Content-Type': 'application/json'}}));
    }
    return Promise.resolve(json({ok: true, conversation: {id: creates[0].conversationId}, messages: [], photos: [], cursor: 0}));
  }, mockPhotoStore);
  try {
    const {document} = dom.window;
    await choosePhoto(dom);
    document.querySelector('#phone').value = '2395550100';
    document.querySelector('input[name="jobType"][value="Repair"]').checked = true;
    document.querySelector('#estimate-form').dispatchEvent(new dom.window.Event('submit', {cancelable: true}));
    await waitFor(() => !document.querySelector('#request-success').hidden);
    assert.equal(photoPosts, 1);
    assert.equal(creates[0].intake.details, 'Job type: Repair');
    assert.equal(Object.hasOwn(creates[0].intake, 'name'), false);
    assert.equal(document.querySelector('#photo-text-fallback').hidden, false);
    assert.match(document.querySelector('#photo-text-fallback').textContent, /239-355-3686/);
    assert.match(document.querySelector('#success-details').textContent, /project details are saved/);
    assert.doesNotMatch(document.querySelector('#success-details').textContent, /photo/);
    const saved = JSON.parse(dom.window.sessionStorage.getItem('everything-gutters.request.v2'));
    assert.equal(saved.photos[0].status, 'client-only');
    assert.equal(saved.complete, true);
  } finally { dom.window.close(); }
});

test('a photo and phone number upload when the existing photo route accepts the file', async () => {
  const creates = [];
  const dom = await load((window, path, options) => {
    if (path === '/conversations' && options.method === 'POST') {
      const body = JSON.parse(options.body);
      creates.push(body);
      return Promise.resolve(json({ok: true, conversation: {id: body.conversationId}, receipt: {operationId: body.operationId, sequence: 2}}));
    }
    if (String(path).endsWith('/photos') && options.method === 'POST') {
      return Promise.resolve(json({ok: true, photo: {id: photoId}, receipt: {operationId: options.body.get('operationId'), photoId}}));
    }
    return Promise.resolve(json({ok: true, conversation: {id: creates[0].conversationId}, messages: [], photos: [{id: photoId}], cursor: 0}));
  }, mockPhotoStore);
  try {
    const {document} = dom.window;
    await choosePhoto(dom);
    document.querySelector('#phone').value = '2395550104';
    document.querySelector('#name').value = 'Synthetic Customer';
    document.querySelector('#address').value = '10 Example Lane, Cape Coral';
    document.querySelector('#estimate-form').dispatchEvent(new dom.window.Event('submit', {cancelable: true}));
    await waitFor(() => !document.querySelector('#request-success').hidden);
    assert.equal(creates[0].intake.name, 'Synthetic Customer');
    assert.equal(creates[0].intake.address, '10 Example Lane, Cape Coral');
    assert.match(document.querySelector('#success-details').textContent, /1 photo/);
    assert.equal(document.querySelector('#photo-text-fallback').hidden, true);
    assert.equal(JSON.parse(dom.window.sessionStorage.getItem('everything-gutters.request.v2')).photos[0].status, 'saved');
  } finally { dom.window.close(); }
});

for (const code of ['contact_required', 'invalid_answer_state']) {
  test('an older service rejecting a missing name with ' + code + ' does not claim the request was saved', async () => {
    const dom = await load((window, path) => path === '/conversations'
      ? Promise.resolve(new Response(JSON.stringify({ok: false, error: code}), {status: 400, headers: {'Content-Type': 'application/json'}}))
      : Promise.reject(new Error('unexpected ' + path)));
    try {
      const {document} = dom.window;
      document.querySelector('#phone').value = '2395550108';
      document.querySelector('#estimate-form').dispatchEvent(new dom.window.Event('submit', {cancelable: true}));
      await waitFor(() => document.querySelector('#request-status').textContent.includes('355-3686'));
      assert.equal(document.querySelector('#request-success').hidden, true);
      assert.equal(document.querySelector('#request-fields').disabled, false);
      assert.equal(dom.window.sessionStorage.getItem('everything-gutters.request.v2'), null);
      assert.match(document.querySelector('#request-status').textContent, /Add your name/);
    } finally { dom.window.close(); }
  });
}

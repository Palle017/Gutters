import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {webcrypto} from 'node:crypto';
import {JSDOM} from 'jsdom';

const site = new URL('../site/', import.meta.url);
const id = '031fb16a-df6b-4fa7-abfe-7a337a75bf82';
const key = 'A'.repeat(43);
const json = (data, status = 200) => new Response(JSON.stringify(data), {status, headers: {'Content-Type': 'application/json'}});
async function waitFor(check) {
  const end = Date.now() + 1500;
  while (!check()) { if (Date.now() > end) throw Error('Timed out waiting for the availability check.'); await new Promise(resolve => setTimeout(resolve, 10)); }
}
async function load(page, script, fetch, {url = 'http://127.0.0.1:18965/', fragment = '', quickTimeout = false, setup} = {}) {
  const dom = new JSDOM(await readFile(new URL(page, site), 'utf8'), {url: url + page + fragment, runScripts: 'outside-only'});
  Object.defineProperty(dom.window, 'crypto', {value: webcrypto});
  const calls = [];
  dom.window.fetch = (path, options = {}) => { calls.push({path, method: options.method || 'GET'}); return fetch(dom.window, path, options); };
  if (quickTimeout) { const original = dom.window.setTimeout.bind(dom.window); dom.window.setTimeout = (callback, delay, ...rest) => original(callback, delay === 4000 ? 5 : delay, ...rest); }
  if (setup) setup(dom.window);
  const common = (await readFile(new URL('js/request-api.js', site), 'utf8')).replace(/^export /gm, '');
  const entry = (await readFile(new URL('js/' + script, site), 'utf8')).replace(/^import .*?;\s*/m, '');
  dom.window.eval(common + '\n' + entry);
  return {dom, calls};
}
const customerView = (window, path) => json({ok: true, conversation: {id, repair: {name: 'Synthetic Customer'}}, messages: [], photos: [], cursor: 0});
const unavailableCases = {
  'a non-OK response': () => json({ok: false}, 503),
  'a missing route (HTML 404)': () => new Response('<!doctype html><h1>404</h1>', {status: 404, headers: {'Content-Type': 'text/html'}}),
  'an OK response that is not JSON': () => new Response('<!doctype html><h1>Parked domain</h1>', {status: 200, headers: {'Content-Type': 'text/html'}}),
  'JSON that does not report ok:true': () => json({service: 'gutters-messaging'}),
  'a network error': (window) => Promise.reject(new window.TypeError('Failed to fetch'))
};
function assertNotice(document) {
  const notice = document.querySelector('#service-notice');
  assert.equal(notice.hidden, false);
  assert.ok(notice.closest('[role="status"]'), 'notice sits in a status live region');
  assert.equal(notice.querySelector('a[href="tel:+12393553686"]')?.textContent.includes('(239) 355-3686'), true);
  assert.ok(notice.querySelector('a[href="sms:+12393553686"]'));
  assert.ok(notice.querySelector('a[href="mailto:Jwisdom030@gmail.com"]'));
}

test('both request pages carry a hidden, accessible fallback notice and keep the skip link first', async () => {
  for (const page of ['estimate.html', 'customer.html']) {
    const document = new JSDOM(await readFile(new URL(page, site), 'utf8')).window.document;
    const notice = document.querySelector('#service-notice');
    assert.equal(notice.hidden, true, page + ' shows no notice until the probe fails');
    assert.ok(notice.closest('[role="status"]'));
    assert.equal(document.querySelector('body > a.skip-link:first-child')?.getAttribute('href'), '#main');
    assert.ok(document.querySelector('main#main'));
    assert.ok(notice.querySelector('a[href="tel:+12393553686"]') && notice.querySelector('a[href="sms:+12393553686"]') && notice.querySelector('a[href="mailto:Jwisdom030@gmail.com"]'));
  }
});

test('estimate page: available service leaves the form untouched and sends the existing create request', async () => {
  const creates = [];
  const {dom, calls} = await load('estimate.html', 'estimate.js', (window, path, options) => {
    if (path === '/healthz') return Promise.resolve(json({ok: true, storage: 'sqlite', service: 'gutters-messaging'}));
    if (path === '/conversations') { const body = JSON.parse(options.body); creates.push(body); return Promise.resolve(json({ok: true, conversation: {id: body.conversationId}, receipt: {operationId: body.operationId, sequence: 4}})); }
    return Promise.resolve(json({ok: true, conversation: {id: creates[0].conversationId}, messages: [], photos: [], cursor: 0}));
  });
  try {
    const {document} = dom.window;
    await waitFor(() => calls.some(call => call.path === '/healthz'));
    assert.deepEqual(calls[0], {path: '/healthz', method: 'GET'});
    await new Promise(resolve => setTimeout(resolve, 30));
    assert.equal(document.querySelector('#request-entry').hidden, false);
    assert.equal(document.querySelector('#request-fields').disabled, false);
    assert.equal(document.querySelector('#submit-request').disabled, false);
    assert.equal(document.querySelector('#service-notice').hidden, true);
    document.querySelector('#name').value = 'Synthetic Customer'; document.querySelector('#phone').value = '(239) 555-0123';
    document.querySelector('#estimate-form').dispatchEvent(new dom.window.Event('submit', {cancelable: true}));
    await waitFor(() => !document.querySelector('#request-success').hidden);
    assert.equal(creates.length, 1);
  } finally { dom.window.close(); }
});

for (const [name, respond] of Object.entries(unavailableCases)) {
  test('estimate page: ' + name + ' hides the form and shows call/text/email', async () => {
    const {dom, calls} = await load('estimate.html', 'estimate.js', (window, path) => path === '/healthz' ? Promise.resolve(respond(window)) : Promise.reject(new Error('unexpected request ' + path)));
    try {
      const {document} = dom.window;
      await waitFor(() => !document.querySelector('#service-notice').hidden);
      assertNotice(document);
      assert.equal(document.querySelector('#request-entry').hidden, true);
      assert.equal(document.querySelector('#request-fields').disabled, true);
      assert.equal(document.querySelector('#submit-request').disabled, true);
      assert.deepEqual(calls.map(call => call.path), ['/healthz'], 'no request-flow calls are made');
    } finally { dom.window.close(); }
  });
}

test('estimate page: a probe that never answers times out as unavailable', async () => {
  const {dom} = await load('estimate.html', 'estimate.js', (window, path, options) => new Promise((resolve, reject) => options.signal.addEventListener('abort', () => reject(new window.TypeError('aborted')))), {quickTimeout: true});
  try {
    await waitFor(() => !dom.window.document.querySelector('#service-notice').hidden);
    assertNotice(dom.window.document);
    assert.equal(dom.window.document.querySelector('#request-entry').hidden, true);
  } finally { dom.window.close(); }
});

test('estimate page: a file: preview is never treated as available and makes no network call', async () => {
  const {dom, calls} = await load('estimate.html', 'estimate.js', () => Promise.resolve(json({ok: true})), {url: 'file:///preview/site/'});
  try {
    await waitFor(() => !dom.window.document.querySelector('#service-notice').hidden);
    assertNotice(dom.window.document);
    assert.equal(dom.window.document.querySelector('#request-entry').hidden, true);
    assert.equal(calls.length, 0);
  } finally { dom.window.close(); }
});

test('customer page: available service loads the saved request as before', async () => {
  const {dom, calls} = await load('customer.html', 'customer.js', (window, path) => path === '/healthz' ? Promise.resolve(json({ok: true})) : Promise.resolve(customerView(window, path)), {fragment: '#id=' + id + '&key=' + key});
  try {
    const {document} = dom.window;
    await waitFor(() => !document.querySelector('#customer-content').hidden);
    assert.equal(document.querySelector('#service-notice').hidden, true);
    assert.equal(document.querySelector('#refresh-request').disabled, false);
    assert.deepEqual(calls.map(call => call.path).slice(0, 2), ['/healthz', '/conversations/' + id]);
  } finally { dom.window.close(); }
});

for (const [name, respond] of Object.entries(unavailableCases)) {
  test('customer page: ' + name + ' shows call/text/email instead of retry errors', async () => {
    const {dom, calls} = await load('customer.html', 'customer.js', (window, path) => path === '/healthz' ? Promise.resolve(respond(window)) : Promise.reject(new Error('unexpected request ' + path)), {fragment: '#id=' + id + '&key=' + key});
    try {
      const {document} = dom.window;
      await waitFor(() => !document.querySelector('#service-notice').hidden);
      assertNotice(document);
      assert.equal(document.querySelector('#customer-content').hidden, true);
      assert.equal(document.querySelector('#refresh-request').disabled, true);
      assert.equal(document.querySelector('#send-message').disabled, true);
      assert.match(document.querySelector('#customer-status').textContent, /not available/);
      assert.deepEqual(calls.map(call => call.path), ['/healthz']);
    } finally { dom.window.close(); }
  });
}

test('customer page: a file: preview is never treated as available', async () => {
  const {dom, calls} = await load('customer.html', 'customer.js', () => Promise.resolve(json({ok: true})), {url: 'file:///preview/site/', fragment: '#id=' + id + '&key=' + key, setup: window => { const store = new Map(); window.history.replaceState = () => {}; Object.defineProperty(window, 'sessionStorage', {value: {getItem: name => store.get(name) ?? null, setItem: (name, value) => store.set(name, String(value)), removeItem: name => store.delete(name)}}); }});
  try {
    await waitFor(() => !dom.window.document.querySelector('#service-notice').hidden);
    assertNotice(dom.window.document);
    assert.equal(calls.length, 0);
  } finally { dom.window.close(); }
});

test('customer page without a private link still shows its existing no-access guidance', async () => {
  const {dom, calls} = await load('customer.html', 'customer.js', () => Promise.reject(new Error('no request expected')));
  try {
    assert.equal(dom.window.document.querySelector('#no-access').hidden, false);
    assert.equal(dom.window.document.querySelector('#service-notice').hidden, true);
    assert.equal(calls.length, 0);
  } finally { dom.window.close(); }
});

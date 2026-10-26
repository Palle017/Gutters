import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile, mkdtemp, rm} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {webcrypto} from 'node:crypto';
import {JSDOM} from 'jsdom';
import {createApp} from '../server/src/app.mjs';

const website = 'https://wisdomscreen.pro';
const service = 'https://serv2-linux.tail68bd87.ts.net:8443';
const source = (await readFile(new URL('../site/js/request-api.js', import.meta.url), 'utf8')).replace(/^export /gm, '');

test('Pages customer helpers reach the separate service with exact-origin CORS and keep private links on the website', async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'gutters-public-route-'));
  const app = createApp({dbPath: path.join(directory, 'test.sqlite3'), ownerToken: 'O'.repeat(43), publicOrigin: service, allowedOrigins: [website]});
  const dom = new JSDOM('', {url: website + '/estimate.html', runScripts: 'outside-only'});
  Object.defineProperty(dom.window, 'crypto', {value: webcrypto});
  dom.window.fetch = async (url, options) => {
    assert.equal(new URL(url).origin, service);
    assert.equal(options.credentials, 'omit');
    assert.equal(options.redirect, 'error', 'authenticated requests cannot follow a redirect to another origin');
    assert.equal(options.referrerPolicy, 'no-referrer');
    if (options.method !== 'GET' || options.headers?.Authorization) {
      const preflight = await app.fetch(new Request(url, {method: 'OPTIONS', headers: {Origin: website, 'Access-Control-Request-Method': options.method, 'Access-Control-Request-Headers': 'Authorization, Content-Type'}}));
      assert.equal(preflight.status, 204);
      assert.equal(preflight.headers.get('Access-Control-Allow-Origin'), website);
      assert.match(preflight.headers.get('Access-Control-Allow-Headers'), /Authorization/);
    }
    const response = await app.fetch(new Request(url, {...options, signal: undefined, headers: {...options.headers, Origin: website}}));
    assert.equal(response.headers.get('Access-Control-Allow-Origin'), website);
    return response;
  };
  dom.window.eval(source);
  try {
    assert.equal(await dom.window.serviceAvailable(), true);
    const id = webcrypto.randomUUID(), operationId = webcrypto.randomUUID(), token = 'T'.repeat(43);
    const payload = {schemaVersion: 2, conversationId: id, operationId, accessToken: token,
      intake: {name: 'Synthetic public route', phone: '2395550100'},
      answers: ['name', 'phone', 'details', 'address', 'homeSize', 'stories', 'gutterLength'].map(field => ({field, state: ['name', 'phone'].includes(field) ? 'provided' : 'later', ...(['name', 'phone'].includes(field) ? {answer: field === 'name' ? 'Synthetic public route' : '2395550100'} : {})}))};
    const created = await dom.window.api('/conversations', {method: 'POST', body: payload});
    assert.equal(created.receipt.operationId, operationId);
    const readback = await dom.window.api('/conversations/' + id, {token});
    assert.equal(readback.conversation.id, id);
    const link = new URL(dom.window.privateLink({id, key: token}));
    assert.equal(link.origin, website);
    assert.equal(link.pathname, '/customer.html');
    assert.equal(link.search, '');
    assert.match(link.hash, /key=/);
    const denied = await app.fetch(new Request(service + '/conversations/' + id, {headers: {Origin: 'https://unrelated.example', Authorization: 'Bearer ' + token}}));
    assert.equal(denied.status, 403);
    assert.equal(denied.headers.has('Access-Control-Allow-Origin'), false);
    for (const unsafe of ['https://unrelated.example/conversations', '//unrelated.example/conversations', '/conversations/../owner', '/conversations/x#key=secret']) {
      assert.throws(() => dom.window.serviceURL(unsafe));
    }
  } finally {dom.window.close(); app.close(); await rm(directory, {recursive: true, force: true});}
});

test('local previews retain their same-origin service instead of contacting production', () => {
  const dom = new JSDOM('', {url: 'http://127.0.0.1:18965/estimate.html', runScripts: 'outside-only'});
  dom.window.eval(source);
  try {assert.equal(dom.window.serviceURL('/healthz'), '/healthz'); assert.equal(dom.window.serviceURL('/conversations'), '/conversations');}
  finally {dom.window.close();}
});

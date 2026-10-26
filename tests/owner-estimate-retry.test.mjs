import test from 'node:test';
import assert from 'node:assert/strict';
import {randomBytes, randomUUID, webcrypto} from 'node:crypto';
import {JSDOM} from 'jsdom';
import {createApp} from '../server/src/app.mjs';
import {ownerHTML} from '../server/src/owner-ui.mjs';
import {QUESTIONS} from '../server/src/protocol.mjs';

const origin = 'https://requests.example.invalid';
const pendingKey = 'gutters-owner-estimate-pending-v1';
async function waitFor(check) {
  const deadline = Date.now() + 2000;
  while (!check()) {
    if (Date.now() > deadline) throw Error('Timed out waiting for the owner inbox.');
    await new Promise(resolve => setTimeout(resolve, 10));
  }
}

for (const kind of ['draft', 'publish']) {
  test('owner ' + kind + ' survives an accepted write, failed readback, reload and exact retry', async t => {
    const ownerToken = randomBytes(32).toString('base64url');
    const app = createApp({dbPath: ':memory:', ownerToken, publicOrigin: origin});
    const id = randomUUID();
    const accessToken = randomBytes(32).toString('base64url');
    const intake = {name: 'Synthetic retry acceptance', phone: '2395550100'};
    const payload = {schemaVersion: 2, conversationId: id, operationId: randomUUID(), accessToken, intake,
      answers: QUESTIONS.map(({field}) => intake[field] ? {field, state: 'provided', answer: intake[field]} : {field, state: 'later'})};
    const created = await app.fetch(new Request(origin + '/conversations', {method: 'POST',
      headers: {Origin: origin, 'Content-Type': 'application/json'}, body: JSON.stringify(payload)}));
    assert.equal(created.status, 201);
    let failReadback = false;
    let injectedFailure = false;
    const attempts = [];
    const windows = [];
    t.after(() => { for (const dom of windows) dom.window.close(); app.close(); });

    function load(retained = null) {
      const dom = new JSDOM(ownerHTML, {url: origin + '/owner', runScripts: 'outside-only'});
      windows.push(dom);
      Object.defineProperty(dom.window, 'crypto', {value: webcrypto});
      if (retained) dom.window.sessionStorage.setItem(pendingKey, retained);
      dom.window.fetch = async (path, options = {}) => {
        if (failReadback && path === '/owner/api/conversations/' + id && (!options.method || options.method === 'GET')) {
          failReadback = false;
          injectedFailure = true;
          throw new dom.window.TypeError('Synthetic connection lost after accepted estimate write');
        }
        const response = await app.fetch(new Request(origin + path, {...options,
          headers: {...options.headers, Origin: origin}}));
        const action = path.endsWith('/publish') ? 'publish' : path.endsWith('/estimates') ? 'draft' : null;
        if (options.method === 'POST' && action === kind) {
          const body = JSON.parse(options.body);
          attempts.push({path, body, status: response.status});
          assert.deepEqual(JSON.parse(dom.window.sessionStorage.getItem(pendingKey)).operationId, body.operationId,
            'the original operation is retained before transmission');
          if (attempts.length === 1) failReadback = true;
        }
        return response;
      };
      const script = ownerHTML.match(/<script type="module">([\s\S]*?)<\/script>/)[1];
      dom.window.eval(script);
      return dom;
    }
    async function login(dom) {
      const doc = dom.window.document;
      doc.querySelector('#owner-key').value = ownerToken;
      doc.querySelector('#login-form').dispatchEvent(new dom.window.Event('submit', {cancelable: true}));
      await waitFor(() => !doc.querySelector('#inbox').hidden && !doc.querySelector('#refresh').disabled);
    }

    const initial = load();
    await login(initial);
    const doc = initial.window.document;
    doc.querySelector('#list button').click();
    await waitFor(() => doc.querySelector('#customer').textContent === intake.name && !doc.querySelector('#refresh').disabled);
    doc.querySelector('#estimate-scope').value = 'Synthetic scope — no customer work';
    doc.querySelector('#estimate-amount').value = '123.45';
    doc.querySelector('#estimate-notes').value = 'Synthetic acceptance only';
    doc.querySelector('#estimate-form').dispatchEvent(new initial.window.Event('submit', {cancelable: true}));
    if (kind === 'publish') {
      await waitFor(() => /Private estimate draft saved and read back/.test(doc.querySelector('#status').textContent));
      doc.querySelector('#estimate-preview-button').click();
      assert.equal(doc.querySelector('#estimate-send').disabled, false);
      doc.querySelector('#estimate-send').click();
    }
    await waitFor(() => injectedFailure && !doc.querySelector('#refresh').disabled);
    assert.equal(attempts[0].status, kind === 'publish' ? 200 : 201, 'the write actually committed');
    const retained = initial.window.sessionStorage.getItem(pendingKey);
    assert.ok(retained, 'accepted estimate operations remain pending until readback is confirmed');
    assert.equal(doc.querySelector('#estimate-send').disabled, true, 'a second send cannot replace the original pending operation');
    assert.equal(doc.querySelector('#estimate-retry').hidden, false);
    initial.window.close();

    const reloaded = load(retained);
    await login(reloaded);
    const reloadedDoc = reloaded.window.document;
    assert.equal(reloadedDoc.querySelector('#estimate-retry').hidden, false);
    reloadedDoc.querySelector('#estimate-retry').click();
    await waitFor(() => !reloaded.window.sessionStorage.getItem(pendingKey) && !reloadedDoc.querySelector('#refresh').disabled);
    assert.equal(attempts.length, 2);
    assert.deepEqual(attempts[1], attempts[0], 'reload retries exactly the same path, payload and operation ID');
    assert.equal(app.store.db.prepare('SELECT COUNT(*) AS n FROM estimates').get().n, 1);
    assert.equal(app.store.db.prepare('SELECT COUNT(*) AS n FROM feature_operations').get().n, kind === 'publish' ? 2 : 1);
    const guest = app.store.view(id);
    assert.equal(guest.messages.filter(message => message.role === 'owner').length, kind === 'publish' ? 1 : 0);
    assert.equal(guest.estimate?.status ?? null, kind === 'publish' ? 'published' : null);
    assert.match(reloadedDoc.querySelector('#status').textContent, kind === 'publish' ? /Estimate sent.*read back/ : /Private estimate draft saved and read back/);
  });
}

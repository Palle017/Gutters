import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {JSDOM} from 'jsdom';

test('guided estimate advances through a gutter project and reveals the calculated summary before submission', async () => {
  const html = await readFile(new URL('../site/estimate.html', import.meta.url), 'utf8');
  const catalog = JSON.parse(await readFile(new URL('../site/pricing-catalog.json', import.meta.url), 'utf8'));
  const dom = new JSDOM(html, {url: 'http://127.0.0.1:18966/estimate.html'});
  const previous = {
    document: globalThis.document,
    window: globalThis.window,
    location: globalThis.location,
    sessionStorage: globalThis.sessionStorage,
    fetch: globalThis.fetch
  };
  let resolveCatalog;
  globalThis.document = dom.window.document;
  globalThis.window = dom.window;
  globalThis.location = dom.window.location;
  globalThis.sessionStorage = dom.window.sessionStorage;
  globalThis.fetch = () => new Promise(resolve => { resolveCatalog = resolve; });

  try {
    await import('../site/js/estimate-assistant.js?guided-test=1');
    assert.equal(dom.window.document.querySelector('#request-fields').hidden, false, 'the fast request form stays available while the catalog loads');
    resolveCatalog({ok: true, json: async () => catalog});
    await new Promise(resolve => setTimeout(resolve, 0));
    const doc = dom.window.document;
    const click = selector => doc.querySelector(selector).click();
    const choose = (name, value) => {
      const input = doc.querySelector(`input[name="${name}"][value="${value}"]`);
      assert.ok(input, `expected choice ${name}=${value}`);
      input.checked = true;
      click('#assistant-next');
    };

    assert.equal(doc.querySelector('#estimate-assistant').hidden, false);
    assert.equal(doc.querySelector('#request-fields').hidden, false, 'photo and phone stay available during optional questions');
    doc.querySelector('#assistant-answer').value = 'gutters';
    click('#assistant-next');
    choose('assistant-answer', 'mixed');
    doc.querySelector('#assistant-answer').value = '60';
    click('#assistant-next');
    doc.querySelector('#assistant-answer').value = '60';
    click('#assistant-next');
    doc.querySelector('#assistant-answer').value = '1.5';
    click('#assistant-next');
    assert.match(doc.querySelector('#assistant-error').textContent, /whole-number quantity/);
    doc.querySelector('#assistant-answer').value = '2';
    click('#assistant-next');
    doc.querySelector('#assistant-answer').value = '0';
    click('#assistant-next');
    choose('assistant-answer', 'no');
    doc.querySelector('#assistant-answer').value = 'Next month';
    click('#assistant-next');
    click('#assistant-unknown');
    click('#assistant-unknown');

    assert.equal(doc.querySelector('#assistant-result').hidden, false);
    assert.match(doc.querySelector('#assistant-total').textContent, /\$1,400\.00/);
    assert.match(doc.querySelector('#assistant-summary').value, /Customer-provided project details \(not site-verified\)/);
    assert.equal(doc.querySelector('#stories').value, '', 'mixed-story footage does not become a false two-story value');
    assert.match(doc.querySelector('#gutterLength').value, /60 single-story feet; 60 two-story feet/);
    assert.equal(doc.querySelector('#request-fields').hidden, false);
    assert.equal(sessionStorage.length, 0, 'the preview does not persist or submit the request');
  } finally {
    dom.window.close();
    for (const [key, value] of Object.entries(previous)) {
      if (value === undefined) delete globalThis[key];
      else globalThis[key] = value;
    }
  }
});

test('a missing catalog reveals the original manual estimate request form', async () => {
  const html = await readFile(new URL('../site/estimate.html', import.meta.url), 'utf8');
  const dom = new JSDOM(html, {url: 'http://127.0.0.1:18966/estimate.html'});
  const previous = {
    document: globalThis.document,
    window: globalThis.window,
    location: globalThis.location,
    sessionStorage: globalThis.sessionStorage,
    fetch: globalThis.fetch
  };
  globalThis.document = dom.window.document;
  globalThis.window = dom.window;
  globalThis.location = dom.window.location;
  globalThis.sessionStorage = dom.window.sessionStorage;
  globalThis.fetch = async () => { throw new Error('offline'); };

  try {
    await import('../site/js/estimate-assistant.js?fallback-test=2');
    await new Promise(resolve => setTimeout(resolve, 0));
    const doc = dom.window.document;
    assert.equal(doc.querySelector('#estimate-assistant').hidden, true);
    assert.equal(doc.querySelector('#request-fields').hidden, false);
    assert.match(doc.querySelector('#assistant-fallback').textContent, /manual estimate using the form below/);
  } finally {
    dom.window.close();
    for (const [key, value] of Object.entries(previous)) {
      if (value === undefined) delete globalThis[key];
      else globalThis[key] = value;
    }
  }
});

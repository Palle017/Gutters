import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile, readdir} from 'node:fs/promises';
import {webcrypto} from 'node:crypto';
import {JSDOM} from 'jsdom';

const site = new URL('../site/', import.meta.url);
const parentScript = await readFile(new URL('js/telemetry.js', site), 'utf8');
const frameScript = await readFile(new URL('js/telemetry-frame.js', site), 'utf8');
const config = {enabled: true, measurementId: 'G-SYNTHETIC1'};
function parent(url = 'https://wisdomscreen.pro/estimate.html?email=private@example.test#key=private-secret', settings = config, setup) {
  const dom = new JSDOM('<!doctype html><title>Private name</title><body><a href="tel:+12395550123">Private phone</a><a href="mailto:private@example.test?body=private-message">Private email</a><a href="sms:+12395550123">Private SMS</a><input value="private-message"><a href="customer.html#key=private-secret">Private request</a></body>', {url, runScripts: 'outside-only', referrer: 'https://example.test/?key=private-secret'});
  Object.defineProperty(dom.window, 'crypto', {value: webcrypto});
  dom.window.GUTTERS_TELEMETRY_CONFIG = settings;
  setup?.(dom.window);
  dom.window.eval(parentScript);
  return dom;
}
function ready(dom) {
  const frame = dom.window.document.querySelector('iframe');
  const sent = [];
  frame.contentWindow.postMessage = (body, origin) => sent.push({body, origin});
  dom.window.dispatchEvent(new dom.window.MessageEvent('message', {source: frame.contentWindow, origin: 'null', data: {type: 'gutters.measurement.ready.v1'}}));
  return {frame, sent};
}
test('disabled config, previews, private pages, unknown paths, DNT, GPC and unavailable storage never load analytics', () => {
  for (const [url, settings, setup] of [
    ['https://wisdomscreen.pro/', {enabled: false, measurementId: ''}],
    ['https://wisdomscreen.pro/', {enabled: true, measurementId: ''}],
    ['http://localhost:8797/', config],
    ['https://wisdomscreen.pro/customer.html#key=private-secret', config],
    ['https://wisdomscreen.pro/owner', config],
    ['https://wisdomscreen.pro/unknown-private-value.html', config],
    ['https://wisdomscreen.pro/', config, window => Object.defineProperty(window.navigator, 'doNotTrack', {value: '1'})],
    ['https://wisdomscreen.pro/', config, window => Object.defineProperty(window.navigator, 'globalPrivacyControl', {value: true})],
    ['https://wisdomscreen.pro/', config, window => Object.defineProperty(window, 'sessionStorage', {get() { throw Error('blocked'); }})]
  ]) {
    const dom = parent(url, settings, setup);
    assert.equal(dom.window.document.querySelector('iframe, script'), null, url);
    assert.equal(dom.window.GuttersTelemetry, undefined);
    dom.window.close();
  }
});
test('sandbox handshake sends only canonical page and fixed contact channels, never URLs or customer values', () => {
  const dom = parent();
  try {
    const frame = dom.window.document.querySelector('iframe');
    assert.equal(frame.getAttribute('sandbox'), 'allow-scripts');
    assert.equal(frame.referrerPolicy, 'no-referrer');
    assert.equal(frame.src, 'https://wisdomscreen.pro/telemetry-frame.html');
    const sent = [];
    frame.contentWindow.postMessage = body => sent.push(body);
    dom.window.document.querySelector('a').dispatchEvent(new dom.window.MouseEvent('click', {bubbles: true, cancelable: true}));
    dom.window.dispatchEvent(new dom.window.MessageEvent('message', {source: dom.window, origin: 'null', data: {type: 'gutters.measurement.ready.v1'}}));
    dom.window.dispatchEvent(new dom.window.MessageEvent('message', {source: frame.contentWindow, origin: 'https://untrusted.test', data: {type: 'gutters.measurement.ready.v1'}}));
    assert.equal(sent.length, 0);
    const result = ready(dom);
    dom.window.document.querySelector('a[href^="mailto:"]').dispatchEvent(new dom.window.MouseEvent('click', {bubbles: true, cancelable: true}));
    dom.window.document.querySelector('a[href^="sms:"]').dispatchEvent(new dom.window.MouseEvent('click', {bubbles: true, cancelable: true}));
    dom.window.GuttersTelemetry.requestSaved({name: 'private-name', key: 'private-secret'});
    assert.deepEqual(result.sent.map(item => item.body.event).filter(Boolean), ['page_view', 'contact_click', 'contact_click', 'contact_click', 'quote_request_saved']);
    assert.deepEqual(result.sent.filter(item => item.body.contact_channel).map(item => item.body.contact_channel), ['phone', 'email', 'sms']);
    assert.equal(result.sent[0].body.path, '/estimate.html');
    assert.match(result.sent[0].body.clientId, /^\d+\.\d+$/);
    assert.doesNotMatch(JSON.stringify(result.sent), /private|@|tel:|mailto:|sms:|key=|customer\.html/);
    const before = result.sent.length;
    dom.window.dispatchEvent(new dom.window.MessageEvent('message', {source: frame.contentWindow, origin: 'null', data: {type: 'gutters.measurement.ready.v1'}}));
    assert.equal(result.sent.length, before, 'frame cannot double-initialize the page view');
  } finally { dom.window.close(); }
});
test('frame rejects untrusted, private and extra-field messages and fixes every GA event context', () => {
  const dom = new JSDOM('<!doctype html><head><title>Private title</title></head>', {url: 'https://wisdomscreen.pro/telemetry-frame.html', runScripts: 'outside-only'});
  const fakeParent = {postMessage() {}};
  Object.defineProperty(dom.window, 'parent', {value: fakeParent});
  dom.window.GUTTERS_TELEMETRY_CONFIG = config;
  dom.window.eval(frameScript);
  const message = (data, origin = 'https://wisdomscreen.pro', source = fakeParent) => dom.window.dispatchEvent(new dom.window.MessageEvent('message', {source, origin, data}));
  const init = {type: 'gutters.measurement.init.v1', path: '/estimate.html', clientId: '123.456'};
  try {
    message({...init, path: '/customer.html#key=private-secret'});
    message({...init, key: 'private-secret'});
    message(init, 'https://untrusted.test');
    message(init, 'https://wisdomscreen.pro', dom.window);
    assert.equal(dom.window.dataLayer, undefined);
    message(init);
    assert.equal(dom.window.document.querySelector('script').src, 'https://www.googletagmanager.com/gtag/js?id=G-SYNTHETIC1');
    const before = dom.window.dataLayer.length;
    message({type: 'gutters.measurement.v1', event: 'quote_request_saved', operationId: 'private-secret'});
    message({type: 'gutters.measurement.v1', event: 'contact_click', contact_channel: 'private@example.test'});
    message({type: 'gutters.measurement.v1', event: 'form_submit'});
    assert.equal(dom.window.dataLayer.length, before);
    for (const event of ['page_view', 'quote_request_saved']) message({type: 'gutters.measurement.v1', event});
    message({type: 'gutters.measurement.v1', event: 'contact_click', contact_channel: 'phone'});
    const commands = Array.from(dom.window.dataLayer, args => Array.from(args));
    const options = commands.find(command => command[0] === 'config')[2];
    assert.equal(options.send_page_view, false);
    assert.equal(options.allow_google_signals, false);
    assert.equal(options.allow_ad_personalization_signals, false);
    for (const command of commands.filter(command => command[0] !== 'js')) {
      assert.equal(command[2].page_location, 'https://wisdomscreen.pro/estimate.html');
      assert.equal(command[2].page_referrer, '');
      assert.equal(command[2].page_title, 'Everything Screen and Gutters');
    }
    assert.doesNotMatch(JSON.stringify(commands), /private|@|key=|customer\.html/);
  } finally { dom.window.close(); }
});
test('all public pages load only local telemetry bootstraps; customer and owner code never load them', async () => {
  const defaults = await readFile(new URL('js/telemetry-config.js', site), 'utf8');
  assert.match(defaults, /enabled: false/);
  assert.match(defaults, /measurementId: ''/);
  for (const name of (await readdir(site)).filter(name => name.endsWith('.html'))) {
    const dom = new JSDOM(await readFile(new URL(name, site), 'utf8'));
    if (name === 'customer.html') assert.equal(dom.window.document.querySelector('script[src*="telemetry"]'), null);
    else if (name !== 'telemetry-frame.html') {
      assert.equal(dom.window.document.querySelectorAll('script[src="js/telemetry.js"]').length, 1, name);
      assert.equal(dom.window.document.querySelectorAll('script[src="js/telemetry-config.js"]').length, 1, name);
    }
    assert.equal(dom.window.document.querySelector('script[src^="https://"]'), null, name);
    dom.window.close();
  }
});

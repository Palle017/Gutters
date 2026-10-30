// A new, headless browser context. All requests are fulfilled locally or aborted;
// no real Google, customer, account, service or messaging traffic is permitted.
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {chromium} from 'playwright';

const root = new URL('../site/', import.meta.url);
const browser = await chromium.launch({headless: true, ...(process.env.GUTTERS_CHROME_PATH ? {executablePath: process.env.GUTTERS_CHROME_PATH} : {channel: 'chrome'})});
const context = await browser.newContext({serviceWorkers: 'block'});
const unexpected = [];
const creates = [];
let currentId;
const json = body => ({status: 200, contentType: 'application/json', body: JSON.stringify(body), headers: {'Access-Control-Allow-Origin': 'https://wisdomscreen.pro', 'Access-Control-Allow-Headers': 'Authorization, Content-Type', 'Access-Control-Allow-Methods': 'GET, POST, OPTIONS'}});
try {
  await context.route('**/*', async route => {
    const request = route.request();
    const url = new URL(request.url());
    if (url.hostname === 'www.googletagmanager.com' && url.pathname === '/gtag/js') {
      return route.fulfill({status: 200, contentType: 'application/javascript', body: 'window.__syntheticGoogleTag = true;'});
    }
    if (url.origin === 'https://serv2-linux.tail68bd87.ts.net:8443') {
      if (request.method() === 'OPTIONS') return route.fulfill(json({}));
      if (url.pathname === '/healthz') return route.fulfill(json({ok: true, service: 'gutters-messaging', storage: 'sqlite'}));
      if (url.pathname === '/conversations' && request.method() === 'POST') {
        const body = request.postDataJSON(); creates.push(body); currentId = body.conversationId;
        if (creates.length === 1) return route.abort('failed'); // Uncertain request is not a conversion.
        return route.fulfill(json({ok: true, conversation: {id: currentId}, receipt: {operationId: body.operationId, sequence: 1}}));
      }
      if (url.pathname === '/conversations/' + currentId && request.method() === 'GET') return route.fulfill(json({ok: true, conversation: {id: currentId}, messages: [], photos: [], cursor: 0}));
    }
    if (url.origin === 'https://wisdomscreen.pro') {
      if (url.pathname === '/js/telemetry-config.js') return route.fulfill({status: 200, contentType: 'application/javascript', body: "window.GUTTERS_TELEMETRY_CONFIG = {enabled:true, measurementId:'G-SYNTHETIC1'};"});
      const relative = url.pathname === '/' ? 'index.html' : url.pathname.slice(1);
      if (!relative.includes('..')) {
        try {
          const body = await readFile(new URL(relative, root));
          const extension = relative.split('.').pop();
          const types = {html: 'text/html', js: 'application/javascript', css: 'text/css', png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg'};
          return route.fulfill({status: 200, contentType: types[extension] || 'application/octet-stream', body});
        } catch { /* Unrecognized requests are stopped below. */ }
      }
    }
    unexpected.push(url.origin + url.pathname);
    return route.abort('blockedbyclient');
  });
  const page = await context.newPage();
  await page.goto('https://wisdomscreen.pro/estimate.html?email=synthetic-private@example.test#key=synthetic-private-key');
  await page.waitForFunction(() => window.GuttersTelemetry);
  const frame = page.frame({url: 'https://wisdomscreen.pro/telemetry-frame.html'});
  assert.ok(frame, 'sandbox frame loaded its local bootstrap');
  await frame.waitForFunction(() => window.__syntheticGoogleTag && window.dataLayer?.some(args => args[0] === 'event' && args[1] === 'page_view'));
  assert.deepEqual(await frame.evaluate(() => {
    let parentDOM = false, parentStorage = false, ownCookie = false;
    try { void parent.document.body; parentDOM = true; } catch {}
    try { void parent.sessionStorage; parentStorage = true; } catch {}
    try { void document.cookie; ownCookie = true; } catch {}
    return {parentDOM, parentStorage, ownCookie, referrer: document.referrer};
  }), {parentDOM: false, parentStorage: false, ownCookie: false, referrer: ''});

  await page.locator('#name').fill('Synthetic Private Name');
  await page.locator('#phone').fill('2395550123');
  await page.locator('#details').fill('synthetic-private-message');
  await page.locator('#submit-request').click();
  await page.waitForFunction(() => !document.querySelector('#submit-request').disabled);
  assert.equal(await frame.evaluate(() => window.dataLayer.filter(args => args[1] === 'quote_request_saved').length), 0);
  await page.locator('#submit-request').click();
  await page.locator('#request-success').waitFor({state: 'visible'});
  await frame.waitForFunction(() => window.dataLayer.filter(args => args[1] === 'quote_request_saved').length === 1);
  assert.equal(creates.length, 2);
  assert.deepEqual(creates[0], creates[1], 'retry uses the exact saved operation and body');
  await page.evaluate(() => {
    const link = document.querySelector('a[href^="tel:"]');
    link.addEventListener('click', event => event.preventDefault()); link.click();
  });
  await frame.waitForFunction(() => window.dataLayer.some(args => args[1] === 'contact_click'));
  const commands = await frame.evaluate(() => window.dataLayer.map(args => Array.from(args)));
  for (const command of commands.filter(command => command[0] === 'event' || command[0] === 'config')) {
    assert.equal(command[2].page_location, 'https://wisdomscreen.pro/estimate.html');
    assert.equal(command[2].page_referrer, '');
    assert.equal(command[2].page_title, 'Everything Screen and Gutters');
  }
  assert.doesNotMatch(JSON.stringify(commands), /synthetic-private|Private Name|2395550123|key=|customer\.html|operationId|conversationId|accessToken/);
  await page.reload();
  const reloaded = page.frame({url: 'https://wisdomscreen.pro/telemetry-frame.html'});
  await reloaded.waitForFunction(() => window.dataLayer?.some(args => args[1] === 'page_view'));
  assert.equal(await reloaded.evaluate(() => window.dataLayer.filter(args => args[1] === 'quote_request_saved').length), 0, 'reload does not recount a completed request');
  await page.goto('https://wisdomscreen.pro/customer.html#id=031fb16a-df6b-4fa7-abfe-7a337a75bf82&key=' + 'A'.repeat(43));
  assert.equal(page.frames().length, 1, 'private customer page never creates an analytics frame');
  assert.deepEqual(unexpected, [], 'all browser traffic was synthetic and explicitly handled');
  console.log('PASS: real headless Chrome sandbox/CSP handshake; parent DOM/storage/cookies blocked; sanitized page/contact events; uncertain send zero; matched receipt plus readback one saved event; exact retry; reload/private-page exclusion. Google SDK and API were intercepted; no provider receipt claimed.');
} finally { await context.close(); await browser.close(); }

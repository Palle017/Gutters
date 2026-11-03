import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile, readdir} from 'node:fs/promises';
import {JSDOM} from 'jsdom';

const site = new URL('../site/', import.meta.url);
const message = 'Hi John, I need a quote for ___ at ___';

function smsBody(href) {
  const query = href.slice(href.indexOf('?') + 1).replace(/^&/, '');
  return new URLSearchParams(query).get('body');
}

test('every visitor page has a mobile call/text bar and a quiet header control', async () => {
  const names = (await readdir(site)).filter(name => name.endsWith('.html') && name !== 'telemetry-frame.html');
  assert.ok(names.includes('index.html') && names.includes('screens.html') && names.includes('estimate.html'));
  for (const name of names) {
    const doc = new JSDOM(await readFile(new URL(name, site), 'utf8')).window.document;
    const bar = doc.querySelectorAll('nav.reach-bar');
    assert.equal(bar.length, 1, name);
    assert.equal(bar[0].getAttribute('aria-label'), 'Call or text John');
    const [call, text] = bar[0].querySelectorAll('a');
    assert.equal(call.getAttribute('href'), 'tel:+12393553686', name);
    assert.equal(call.textContent.trim(), 'Call John', name);
    assert.equal(call.getAttribute('aria-label'), 'Call John at (239) 355-3686', name);
    assert.equal(text.textContent.trim(), 'Text John', name);
    assert.equal(text.getAttribute('aria-label'), 'Text John at (239) 355-3686', name);
    assert.equal(smsBody(text.getAttribute('href')), message, name);
    assert.equal(text.getAttribute('href').startsWith('sms:+12393553686?'), true, name);

    const header = doc.querySelector('header.header .header-reach');
    assert.ok(header, name);
    const [headerCall, headerText] = header.querySelectorAll('a');
    assert.equal(headerCall.getAttribute('href'), 'tel:+12393553686', name);
    assert.equal(headerCall.textContent.trim(), 'Call', name);
    assert.equal(headerCall.getAttribute('aria-label'), 'Call John at (239) 355-3686', name);
    assert.equal(headerText.textContent.trim(), 'Text', name);
    assert.equal(headerText.getAttribute('aria-label'), 'Text John at (239) 355-3686', name);
    assert.equal(smsBody(headerText.getAttribute('href')), message, name);
    assert.equal(doc.querySelector('header.header a.nav-call, header.header a[href="estimate.html"]') !== null, true, name);
  }
  const frame = await readFile(new URL('telemetry-frame.html', site), 'utf8');
  assert.equal(frame.includes('reach-bar'), false);
});

test('the home hero call and text links stay address-only', async () => {
  const home = new JSDOM(await readFile(new URL('index.html', site), 'utf8')).window.document;
  assert.deepEqual([...home.querySelectorAll('.hero .hero-ctas a')].map(link => link.getAttribute('href')), ['tel:+12393553686', 'sms:+12393553686']);
});

function rule(css, selector) {
  const start = css.indexOf(selector + '{');
  assert.notEqual(start, -1, selector);
  return css.slice(start, css.indexOf('}', start));
}
function media(css, query, marker) {
  let from = 0;
  while (from < css.length) {
    const start = css.indexOf('@media(' + query + '){', from);
    assert.notEqual(start, -1, query + ' ' + marker);
    let depth = 0;
    for (let i = css.indexOf('{', start); i < css.length; i++) {
      if (css[i] === '{') depth++;
      else if (css[i] === '}' && --depth === 0) {
        const block = css.slice(start, i + 1);
        if (block.includes(marker)) return block;
        from = i + 1;
        break;
      }
    }
  }
  throw new Error('unclosed ' + query);
}
test('small-screen bar stays tappable and leaves room for the estimate control', async () => {
  const css = await readFile(new URL('css/americana.css', site), 'utf8');
  const bar = rule(css, '.americana .reach-bar');
  assert.match(bar, /position:fixed/);
  assert.match(bar, /bottom:0/);
  assert.match(bar, /z-index:30/);
  const barLink = rule(css, '.americana .reach-bar a');
  assert.match(barLink, /min-height:44px/);
  assert.match(barLink, /min-width:44px/);
  const headerLink = rule(css, '.americana .header-reach a');
  assert.match(headerLink, /min-height:44px/);
  assert.match(headerLink, /min-width:44px/);
  const narrow = media(css, 'max-width:900px', '.reach-bar{');
  assert.match(rule(narrow, '.americana .reach-bar'), /display:flex/);
  assert.match(rule(narrow, 'body.americana'), /padding-bottom:/);
  assert.match(rule(narrow, '.americana .header nav.is-open'), /padding-bottom:/);
  const wide = media(css, 'min-width:901px', '.header-reach{');
  assert.match(rule(wide, '.americana .header-reach'), /display:flex/);
  assert.match(rule(wide, '.americana .reach-bar'), /display:none/);
  assert.match(rule(css, '.americana .reach-bar a:first-child'), /background:var\(--red\).*color:#fff8ed/);
  assert.match(rule(css, '.americana .reach-bar a:last-child'), /background:var\(--cream\).*color:var\(--navy\)/);
});

test('new call and text links use the existing contact click counter', async () => {
  const telemetry = await readFile(new URL('js/telemetry.js', site), 'utf8');
  assert.match(telemetry, /href\.startsWith\('tel:'\) \? 'phone'/);
  assert.match(telemetry, /href\.startsWith\('sms:'\) \? 'sms'/);
  assert.match(telemetry, /send\('contact_click', channel\)/);
  assert.doesNotMatch(telemetry, /reach-bar|header-reach/);
});

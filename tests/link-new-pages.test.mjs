import test from 'node:test';
import assert from 'node:assert/strict';
import {readdir, readFile} from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {JSDOM} from 'jsdom';

const site = path.join(path.dirname(fileURLToPath(import.meta.url)), '../site');
const pages = [
  ['screen-types.html', 'Screen types'],
  ['window-screens.html', 'Window screens'],
  ['aluminum-cage-painting.html', 'Cage painting'],
  ['review.html', 'Reviews'],
  ['service-area.html', 'Service area'],
  ['why-john.html', 'Why John']
];
const hidden = ['gutter-guy.html', 'review-card.html'];

async function load(name) {
  return new JSDOM(await readFile(path.join(site, name), 'utf8')).window.document;
}

test('every shared nav and footer lists the new pages and hides the easter egg and review card', async () => {
  const files = (await readdir(site)).filter(name => name.endsWith('.html'));
  let navCount = 0;
  let footerCount = 0;
  for (const name of files) {
    const doc = await load(name);
    const nav = doc.querySelector('#nav');
    if (!nav) continue;
    navCount += 1;
    assert.ok(doc.querySelector('.menu-toggle[aria-controls="nav"]'), `${name} keeps the mobile menu toggle`);
    for (const [href, label] of pages) {
      const link = nav.querySelector(`a[href="${href}"]`);
      assert.ok(link, `${name} nav is missing ${href}`);
      assert.equal(link.textContent.trim(), label);
    }
    for (const href of hidden) {
      assert.equal(nav.querySelector(`a[href="${href}"]`), null, `${name} nav should not link ${href}`);
    }
    if (name === 'index.html') {
      assert.equal(doc.querySelector('#nav a[href="index.html"]').getAttribute('aria-current'), 'page');
    } else if (pages.some(([href]) => href === name)) {
      const current = nav.querySelector(`a[href="${name}"]`);
      assert.equal(current.getAttribute('aria-current'), 'page');
    }
    const footer = doc.querySelector('footer.site-foot nav[aria-label="Footer"]');
    if (!footer) continue;
    footerCount += 1;
    for (const [href] of pages) {
      assert.ok(footer.querySelector(`a[href="${href}"]`), `${name} footer is missing ${href}`);
    }
    for (const href of hidden) {
      assert.equal(footer.querySelector(`a[href="${href}"]`), null, `${name} footer nav should not link ${href}`);
    }
  }
  assert.ok(navCount >= 20, `expected shared navs, found ${navCount}`);
  assert.ok(footerCount >= 18, `expected footer navs, found ${footerCount}`);
});

test('homepage services, story and reviews point to the new pages', async () => {
  const home = await load('index.html');
  const services = home.querySelector('#services');
  assert.ok(services.querySelector('a[href="screen-types.html"]'));
  assert.ok(services.querySelector('a[href="window-screens.html"]'));
  assert.ok(services.querySelector('a[href="aluminum-cage-painting.html"]'));
  assert.match(services.querySelector('a[href="aluminum-cage-painting.html"]').textContent, /Pool cage painting/i);
  const story = home.querySelector('.story');
  assert.ok(story.querySelector('a[href="why-john.html"]'));
  assert.ok(story.querySelector('a[href="service-area.html"]'));
  const reviews = home.querySelector('#reviews');
  assert.ok(reviews.querySelector('a[href="review.html"]'));
  assert.equal(home.querySelector('#nav a[href="gutter-guy.html"]'), null);
  assert.equal(home.querySelector('#nav a[href="review-card.html"]'), null);
});

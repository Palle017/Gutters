import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile, readdir} from 'node:fs/promises';
import {JSDOM} from 'jsdom';

const site = new URL('../site/', import.meta.url);
test('sitemap covers every indexable canonical page and excludes private return access', async () => {
  const xml = new JSDOM(await readFile(new URL('sitemap.xml', site), 'utf8'), {contentType:'text/xml'}).window.document;
  const urls = [...xml.querySelectorAll('loc')].map(node => node.textContent);
  const expected = [];
  for (const page of (await readdir(site)).filter(name => name.endsWith('.html'))) {
    const doc = new JSDOM(await readFile(new URL(page, site), 'utf8')).window.document;
    if (doc.querySelector('meta[name="robots"]')?.content.includes('noindex')) continue;
    const canonical = doc.querySelector('link[rel="canonical"]')?.href;
    assert.ok(canonical?.startsWith('https://wisdomscreen.pro/'), page+' canonical');
    expected.push(canonical);
  }
  assert.deepEqual(urls.sort(), expected.sort());
  assert.equal(new Set(urls).size, urls.length);
  assert.ok(!urls.some(url => /customer|owner|conversations/.test(url)));
  const privatePage = new JSDOM(await readFile(new URL('customer.html', site), 'utf8')).window.document;
  assert.equal(privatePage.querySelector('meta[name="robots"]').content, 'noindex,nofollow,noarchive');
});

test('homepage search metadata identifies the actual services and verified business only', async () => {
  const doc = new JSDOM(await readFile(new URL('index.html', site), 'utf8')).window.document;
  assert.match(doc.title, /Gutters.*Screen.*Southwest Florida/);
  const nodes = doc.querySelectorAll('script[type="application/ld+json"]');
  assert.equal(nodes.length, 1);
  const business = JSON.parse(nodes[0].textContent);
  assert.equal(business['@context'], 'https://schema.org');
  assert.equal(business['@type'], 'Organization');
  assert.equal(business.name, 'Everything Screen and Gutters');
  assert.equal(business.url, doc.querySelector('link[rel="canonical"]').href);
  assert.equal(business.telephone, '+1-239-355-3686');
  assert.ok(doc.querySelector('a[href="tel:'+business.telephone.replaceAll('-','')+'"]'));
  assert.equal(business.areaServed.name, 'Southwest Florida');
  assert.equal(business.sameAs.length, 1);
  assert.ok(doc.querySelector('a[href="'+business.sameAs[0]+'"]'));
  for (const unverified of ['address','geo','openingHours','openingHoursSpecification','priceRange','aggregateRating','review']) {
    assert.equal(business[unverified], undefined, unverified+' must not be invented');
  }
});

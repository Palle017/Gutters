import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {JSDOM} from 'jsdom';
const site=new URL('../site/',import.meta.url);
test('service area page lists the core towns and is linked from contact',async()=>{
  const doc=new JSDOM(await readFile(new URL('service-area.html',site),'utf8')).window.document;
  const towns=[...doc.querySelectorAll('.service-grid h3')].map(node=>node.textContent);
  assert.deepEqual(towns,['Fort Myers','North Fort Myers','Cape Coral','Lehigh Acres','Bonita Springs','Estero']);
  assert.equal(doc.querySelectorAll('h1').length,1);
  JSON.parse(doc.querySelector('script[type="application/ld+json"]').textContent);
  assert.doesNotMatch(doc.querySelector('main').textContent,/\$\d|warrant|guarantee|minutes away/i);
  const contact=new JSDOM(await readFile(new URL('contact.html',site),'utf8')).window.document;
  assert.ok(contact.querySelector('a[href="service-area.html"]'));
});

import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {JSDOM} from 'jsdom';
const site=new URL('../site/',import.meta.url);
test('window screens page keeps John’s wording and is linked from services',async()=>{
  const doc=new JSDOM(await readFile(new URL('window-screens.html',site),'utf8')).window.document;
  const copy=doc.querySelector('main').textContent;
  assert.equal(doc.querySelectorAll('h1').length,1);
  assert.match(copy,/mosquitoes and bugs/);
  assert.match(copy,/410 stainless steel screws/);
  assert.doesNotMatch(copy,/\$\d|warrant|guarantee/i);
  assert.ok(doc.querySelector('a[href="sms:+12393553686"]'));
  const services=new JSDOM(await readFile(new URL('services.html',site),'utf8')).window.document;
  assert.ok(services.querySelector('a[href="window-screens.html"]'));
});

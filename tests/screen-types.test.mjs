import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {JSDOM} from 'jsdom';
const site=new URL('../site/',import.meta.url);
test('screen types page presents Ultra Screen as John’s recommendation and is linked from screens',async()=>{
  const doc=new JSDOM(await readFile(new URL('screen-types.html',site),'utf8')).window.document;
  const copy=doc.querySelector('main').textContent;
  assert.equal(doc.querySelectorAll('h1').length,1);
  assert.match(copy,/Ultra Screen/);
  assert.match(copy,/helps fight microbial growth/);
  assert.match(copy,/John regards it as industry leading in strength and quality/);
  assert.doesNotMatch(copy,/\$\d|warrant|guarantee/i);
  assert.ok(doc.querySelector('a[href="tel:+12393553686"]'));
  const screens=new JSDOM(await readFile(new URL('screens.html',site),'utf8')).window.document;
  assert.ok(screens.querySelector('a[href="screen-types.html"]'));
});

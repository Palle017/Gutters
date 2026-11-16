import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {JSDOM} from 'jsdom';
const site=new URL('../site/',import.meta.url);
test('cage painting page keeps John’s Tough Trim wording and is linked from rescreening',async()=>{
  const doc=new JSDOM(await readFile(new URL('aluminum-cage-painting.html',site),'utf8')).window.document;
  const copy=doc.querySelector('main').textContent;
  assert.equal(doc.querySelectorAll('h1').length,1);
  for(const value of ['Tough Trim','any color you would like','410 stainless steel screws'])assert.ok(copy.includes(value),value);
  assert.doesNotMatch(copy,/\$\d|warrant|guarantee/i);
  const rescreen=new JSDOM(await readFile(new URL('rescreening-restoration.html',site),'utf8')).window.document;
  assert.ok(rescreen.querySelector('a[href="aluminum-cage-painting.html"]'));
});

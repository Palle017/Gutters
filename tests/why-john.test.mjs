import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {JSDOM} from 'jsdom';
const site=new URL('../site/',import.meta.url);
test('why-john imports listing facts but holds unconfirmed offers back',async()=>{
  const source=await readFile(new URL('why-john.html',site),'utf8');
  const doc=new JSDOM(source).window.document;
  const copy=doc.querySelector('main').textContent;
  assert.equal(doc.querySelectorAll('h1').length,1);
  assert.match(copy,/Everything Screen and Aluminum/);
  assert.match(copy,/Pool Cages, Railing & Gutters/);
  assert.doesNotMatch(source,/guarantee|fall.?out|door kit|veteran|senior|discount|credit card|warrant|Wise Way|8:00|everythingscreenandaluminum\.com|\$\d/i);
  const about=new JSDOM(await readFile(new URL('about.html',site),'utf8')).window.document;
  assert.ok(about.querySelector('a[href="why-john.html"]'));
});

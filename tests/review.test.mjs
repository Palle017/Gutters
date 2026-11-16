import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {JSDOM} from 'jsdom';
const site=new URL('../site/',import.meta.url);
const review='https://search.google.com/local/writereview?placeid=ChIJkcycTzTof4cRg-qEp9DmP-M';
test('review page and printable card use the Google review link with an inline QR and no runtime QR service',async()=>{
  for(const page of ['review.html','review-card.html']){
    const source=await readFile(new URL(page,site),'utf8');
    const doc=new JSDOM(source).window.document;
    assert.equal(doc.querySelectorAll('h1').length,1);
    assert.ok(doc.querySelector('svg.review-qr path[d]'),page+' inline QR');
    assert.doesNotMatch(source,/api\.qrserver|chart\.googleapis|quickchart|qr-code-generator/i);
  }
  const doc=new JSDOM(await readFile(new URL('review.html',site),'utf8')).window.document;
  assert.ok(doc.querySelector(`a[href="${review}"]`));
  const card=new JSDOM(await readFile(new URL('review-card.html',site),'utf8')).window.document;
  assert.match(card.querySelector('meta[name="robots"]').content,/noindex/);
  const home=new JSDOM(await readFile(new URL('index.html',site),'utf8')).window.document;
  assert.ok(home.querySelector('a[href="review.html"]'));
});

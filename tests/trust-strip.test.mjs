import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {JSDOM} from 'jsdom';
const site=new URL('../site/',import.meta.url);
test('trust strip repeats only existing homepage facts on the main service pages',async()=>{
  const home=(await readFile(new URL('index.html',site),'utf8'));
  for(const fact of ['21+ years in the industry','licensed and insured','FAMILY OWNED','FREE ESTIMATES','AMERICAN-MADE MATERIALS','4.9','32 Google reviews'])assert.ok(home.includes(fact),'homepage states '+fact);
  for(const page of ['gutters.html','screens.html','rescreening-restoration.html','services.html']){
    const doc=new JSDOM(await readFile(new URL(page,site),'utf8')).window.document;
    const strip=doc.querySelector('main .trust-strip');
    assert.ok(strip,page);
    const text=strip.textContent.replace(/\s+/g,' ');
    for(const fact of ['21+ years','Licensed','insured','Family owned','Free','estimates','American-made','4.9','32 Google reviews'])assert.ok(text.includes(fact),page+' '+fact);
    assert.doesNotMatch(text,/\$|warrant|guarantee|discount/i);
  }
});

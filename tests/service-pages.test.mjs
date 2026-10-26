import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile,readdir,stat} from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {JSDOM} from 'jsdom';

const site=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'../site');
const servicePages=['rescreening-restoration.html','seamless-super-gutters.html','gutter-repairs-cleaning-leaf-guards.html','underground-drainage.html','boat-canopy-awning-tarps.html'];

test('every added service page is reachable, readable, and offers direct call/text without an inbox form',async()=>{
  const listing=new JSDOM(await readFile(path.join(site,'services.html'),'utf8')).window.document;
  const files=await readdir(site);
  const titles=new Set();
  for(const page of servicePages.filter(page=>files.includes(page))){
    const source=await readFile(path.join(site,page),'utf8');
    const doc=new JSDOM(source).window.document;
    assert.ok(listing.querySelector('a[href="'+page+'"]'),'services links '+page);
    assert.equal(doc.querySelectorAll('h1').length,1);
    assert.ok(doc.querySelector('meta[name="description"]').content.length>100);
    assert.equal(titles.has(doc.title),false,'unique service title');titles.add(doc.title);
    assert.ok(doc.querySelector('a[href="tel:+12393553686"]'));
    assert.ok(doc.querySelector('a[href="sms:+12393553686"]'));
    assert.equal(doc.querySelector('form,input,textarea,select'),null,'call/text service page');
    assert.match(doc.body.textContent,/Southwest Florida/);
    assert.match(doc.body.textContent,/21\+ years in the industry/);
    assert.match(doc.body.textContent,/licensed and insured/);
    assert.match(doc.body.textContent,/all estimates are free/i);
    assert.doesNotMatch(source,/fixingfortmyers\.com|everythingscreenandaluminum\.com|239.397.2048|\$30,?000|40[- ]?(?:ft|foot)|Lorem ipsum|Add project photo|placeholder/i);
  }
});

test('all public relative page, resource and fragment links resolve under a GitHub Pages subpath',async()=>{
  for(const page of (await readdir(site)).filter(name=>name.endsWith('.html'))){
    const doc=new JSDOM(await readFile(path.join(site,page),'utf8')).window.document;
    for(const element of doc.querySelectorAll('a[href],script[src],link[rel="stylesheet"]')){
      const value=element.getAttribute('href')||element.getAttribute('src');
      if(!value||/^(?:https?:|mailto:|tel:|sms:)/.test(value))continue;
      assert.equal(value.startsWith('/'),false,page+' root-relative '+value);
      const url=new URL(value,'https://example.invalid/Gutters/'+page);
      assert.ok(url.pathname.startsWith('/Gutters/'));
      const target=path.join(site,url.pathname.slice('/Gutters/'.length));
      assert.ok((await stat(target)).isFile(),page+' missing '+value);
      if(url.hash){
        const targetDoc=target===path.join(site,page)?doc:new JSDOM(await readFile(target,'utf8')).window.document;
        assert.ok(targetDoc.getElementById(decodeURIComponent(url.hash.slice(1))),page+' missing fragment '+value);
      }
    }
  }
});

test('rescreening copy preserves small jobs, exact screen types, and a qualified schedule',async()=>{
  const source=await readFile(path.join(site,'rescreening-restoration.html'),'utf8');
  for(const value of ['pool enclosures','patios','window screens','door screens','sliding door screens','rusted screws','no minimum job size','Most rescreens are completed in a day'])assert.ok(source.includes(value),value);
  assert.doesNotMatch(source,/every rescreen.*one day|guaranteed.*day|minimum.*\$/i);
});

test('underground drainage copy keeps the owner-supplied no-grading boundary',async()=>{
  const doc=new JSDOM(await readFile(path.join(site,'underground-drainage.html'),'utf8')).window.document;
  assert.match(doc.querySelector('main').textContent,/We do not offer grading/);
  assert.doesNotMatch(doc.querySelector('main').textContent,/French drains|sump pumps|foundation repair|guaranteed dry|40[- ]?(?:ft|foot)/i);
});

test('tarp draft stays within replacement/installation wording without adding adjacent services',async()=>{
  const doc=new JSDOM(await readFile(path.join(site,'boat-canopy-awning-tarps.html'),'utf8')).window.document;
  const copy=doc.querySelector('main').textContent;
  assert.match(copy,/Boat canopy tarp replacement and installation/);
  assert.match(copy,/Awning tarp replacement and installation/);
  assert.doesNotMatch(copy,/boat lift|framework|canvas fabrication|custom fabrication|wording.*confirm|internal|draft/i);
});

import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile,readdir,stat} from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {JSDOM} from 'jsdom';

const site=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'../site');
const servicePages=['rescreening-restoration.html','seamless-super-gutters.html','gutter-repairs-cleaning-leaf-guards.html','underground-drainage.html','boat-canopy-awning-tarps.html'];

test('primary contact buttons and text links have readable normal-text contrast',async()=>{
  const css=await readFile(path.join(site,'css/styles.css'),'utf8');
  const color=name=>css.match(new RegExp('--'+name+':\\s*(#[0-9a-fA-F]{6})'))[1];
  const luminance=hex=>{
    const rgb=[1,3,5].map(start=>parseInt(hex.slice(start,start+2),16)/255).map(value=>value<=.04045?value/12.92:((value+.055)/1.055)**2.4);
    return rgb[0]*.2126+rgb[1]*.7152+rgb[2]*.0722;
  };
  const contrast=(first,second)=>{
    const values=[luminance(first),luminance(second)].sort((a,b)=>b-a);
    return (values[0]+.05)/(values[1]+.05);
  };
  assert.ok(contrast(color('accent'),color('white'))>=4.5,'white contact-button text');
  assert.ok(contrast(color('accent-hover'),color('white'))>=4.5,'hover contact-button text');
  assert.ok(contrast(color('accent'),color('cream'))>=4.5,'text links on the page background');
});

test('every added service page is reachable, readable, and offers direct call/text without an inbox form',async()=>{
  const listing=new JSDOM(await readFile(path.join(site,'services.html'),'utf8')).window.document;
  const files=await readdir(site);
  const titles=new Set();
  for(const page of servicePages.filter(page=>files.includes(page))){
    const source=await readFile(path.join(site,page),'utf8');
    const doc=new JSDOM(source).window.document;
    assert.ok(listing.querySelector('a[href="'+page+'"]'),'services links '+page);
    assert.equal(doc.querySelectorAll('h1').length,1);
    assert.equal(doc.querySelector('main#main').getAttribute('tabindex'),'-1','skip link has a focusable main target');
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
  const home=new JSDOM(await readFile(path.join(site,'index.html'),'utf8')).window.document;
  assert.ok(home.querySelector('a[href="rescreening-restoration.html"]'),'homepage directly reaches rescreening page');
});

test('underground drainage copy keeps the owner-supplied no-grading boundary',async()=>{
  const doc=new JSDOM(await readFile(path.join(site,'underground-drainage.html'),'utf8')).window.document;
  assert.match(doc.querySelector('main').textContent,/We do not offer grading/);
  assert.doesNotMatch(doc.querySelector('main').textContent,/French drains|sump pumps|foundation repair|guaranteed dry|40[- ]?(?:ft|foot)/i);
});

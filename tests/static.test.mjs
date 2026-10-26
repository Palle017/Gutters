import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile,readdir,stat} from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {JSDOM} from 'jsdom';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const site=path.join(root,'site');
test('public pages identify John and have working portable call/navigation links',async()=>{
  for(const page of ['index.html','services.html','about.html','contact.html']){
    const html=await readFile(path.join(site,page),'utf8');
    assert.match(html,/Everything Screen and Gutters/);
    assert.doesNotMatch(html,/everythingscreenandaluminum\.com|fixingfortmyers\.com|239.397.2048/);
    const doc=new JSDOM(html).window.document;
    assert.ok(doc.querySelector('a[href="tel:+12393553686"]'));
    assert.equal(doc.querySelectorAll('h1').length,1);
    for(const node of doc.querySelectorAll('a[href],script[src],link[rel="stylesheet"]')){
      const value=node.getAttribute('href')||node.getAttribute('src');
      if(!value||/^(?:https?:|mailto:|tel:|sms:|#)/.test(value))continue;
      assert.ok(!value.startsWith('/'),'relative link '+value);
      assert.ok((await stat(path.resolve(site,value.split(/[?#]/)[0]))).isFile(),value);
    }
  }
});
test('Pages publication requires explicit manual workflow and static-only artifact',async()=>{
  const yaml=await readFile(path.join(root,'.github/workflows/pages.yml'),'utf8');
  assert.match(yaml,/workflow_dispatch:/);
  assert.doesNotMatch(yaml,/^\s+push:/m);
  assert.match(yaml,/path: dist/);
  const builder=await readFile(path.join(root,'tools/build.mjs'),'utf8');
  assert.match(builder,/path\.join\(root, 'site'\)/);
  assert.match(builder,/Not a public asset/);
});

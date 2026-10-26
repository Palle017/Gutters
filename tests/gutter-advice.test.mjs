import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {JSDOM} from 'jsdom';
import {advice,sources,shared} from '../content/gutter-advice.mjs';
import {renderAdvicePage} from '../tools/render-advice.mjs';

test('published educational cards stay in sync with the reusable content and source record',async()=>{
  const html=await readFile(new URL('../site/gutter-advice.html',import.meta.url),'utf8');
  assert.equal(html,await renderAdvicePage(),'run node tools/render-advice.mjs after editing content');
  const doc=new JSDOM(html).window.document;
  const cards=[...doc.querySelectorAll('.advice-cards details')];
  assert.equal(cards.length,advice.length);
  assert.equal(new Set(advice.map(item=>item.id)).size,advice.length);
  for(const item of advice){
    const card=doc.getElementById(item.id);
    assert.equal(card.querySelector('summary').textContent,item.title);
    for(const key of ['observation','mayHelp','limits','nextStep']) assert.ok(card.textContent.includes(item[key]));
    assert.ok(item.provenance);
    for(const id of item.sourceIds) assert.ok(sources[id]);
  }
  assert.match(advice.find(item=>item.id==='between-homes').provenance,/Recorded interview topic/);
  assert.ok(advice.filter(item=>item.id!=='between-homes').every(item=>item.provenance.startsWith('Proposed')));
  assert.ok(doc.body.textContent.includes(shared.safety));
  assert.equal(doc.querySelector('form,input,textarea,select'),null,'reading must not collect personal information');
  assert.deepEqual([...doc.querySelectorAll('script')].map(node=>node.getAttribute('src')),['js/main.js']);
  assert.ok(doc.querySelector('a[href="tel:+12393553686"]'));
  assert.ok(doc.querySelector('a[href="sms:+12393553686"]'));
  assert.equal(doc.querySelectorAll('h1').length,1);
  assert.match(doc.querySelector('main').textContent,/does not offer grading/);
  assert.doesNotMatch(doc.querySelector('main').textContent,/\$|licensed|insured|warranty|guaranteed|reviewed by John/i);
});

test('home and gutter service page expose the guide without changing primary contact actions',async()=>{
  for(const page of ['index.html','gutters.html']){
    const doc=new JSDOM(await readFile(new URL('../site/'+page,import.meta.url),'utf8')).window.document;
    assert.equal(doc.querySelectorAll('a[href="gutter-advice.html"]').length,1);
    assert.ok(doc.querySelector('a[href="tel:+12393553686"]'));
  }
});

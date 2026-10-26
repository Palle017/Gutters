import {readFile, writeFile} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import path from 'node:path';
import {advice, sources, shared} from '../content/gutter-advice.mjs';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const escape=value=>String(value).replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;').replaceAll('"','&quot;');
export async function renderAdvicePage() {
  const source=await readFile(path.join(root,'site/gutters.html'),'utf8');
  const header=source.slice(source.indexOf('<body'),source.indexOf('<main')).replace(' aria-current="page"','');
  const footer=source.slice(source.indexOf('<footer'));
  const cards=advice.map(item=>{
    const readings=item.sourceIds.filter(id=>id!=='interview').map(id=>'<a href="'+escape(sources[id].href)+'">'+escape(sources[id].label)+'</a>').join('');
    return '<details id="'+escape(item.id)+'"><summary>'+escape(item.title)+'</summary><div class="advice-copy">'+
      [['Observe safely',item.observation],['When gutter work may help',item.mayHelp],['What this does not establish',item.limits],['A useful next step',item.nextStep]]
      .map(([title,text])=>'<h3>'+title+'</h3><p>'+escape(text)+'</p>').join('')+
      (readings?'<p class="advice-sources">Further reading</p><div class="advice-readings">'+readings+'</div>':'')+'</div></details>';
  }).join('\n');
  return '<!doctype html>\n<html lang="en">\n<head>\n<meta charset="utf-8">\n<meta name="viewport" content="width=device-width,initial-scale=1">\n'+
    '<meta name="description" content="Compare safe homeowner observations about wet ground, gutter overflow and downspout runoff. Learn when gutter work may help and when another assessment is needed.">\n'+
    '<meta name="theme-color" content="#172631">\n<title>Gutters or another water problem? | Everything Screen and Gutters</title>\n'+
    '<link rel="stylesheet" href="css/styles.css">\n<link rel="stylesheet" href="css/americana.css">\n<link rel="stylesheet" href="css/gutter-advice.css">\n'+
    '<link rel="canonical" href="https://wisdomscreen.pro/gutter-advice.html">\n<script src="js/main.js" defer></script>\n</head>\n'+header+
    '<main id="main" tabindex="-1">\n<section class="page-heading"><p class="eyebrow">FREE HOMEOWNER EDUCATION</p><h1>Start with what<br>you can observe.</h1>'+
    '<p>Gutters can help manage roof runoff. They do not solve every water problem. Explore useful observations and when another assessment may be needed.</p></section>\n'+
    '<section class="advice-content paper" aria-labelledby="advice-heading"><h2 id="advice-heading">What are you noticing?</h2>'+
    '<p class="advice-intro">Open any topic and compare as many as you like. This is general education, not a diagnosis or a recommendation to buy.</p>'+
    '<p class="advice-safety">'+escape(shared.safety)+'</p><p>'+escape(shared.uncertainty)+'</p>\n'+
    '<div class="advice-cards">'+cards+'</div>\n'+
    '<aside class="advice-contact"><h2>Want to discuss the roof-water part?</h2><p>'+escape(shared.contact)+'</p>'+
    '<p>Tell John what you noticed and your city. Your name, callback number and a short project description are enough to start. Address, photos and measurements can come later if useful.</p>'+
    '<div class="advice-actions"><a href="tel:+12393553686">Call John: (239) 355-3686</a><a href="sms:+12393553686">Text John</a></div>'+
    '<p>John offers gutters, repairs, cleanouts and underground drainage. He does not offer grading. An assessment comes before deciding the appropriate work.</p></aside></section>\n</main>\n'+footer;
}
if(process.argv[1] && path.resolve(process.argv[1])===fileURLToPath(import.meta.url)){
  await writeFile(path.join(root,'site/gutter-advice.html'),await renderAdvicePage(),'utf8');
  console.log('Rendered homeowner advice from shared content; no public service or pricing changes.');
}

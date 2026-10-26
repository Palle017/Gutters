// Optional local browser check; no dependency is added to the application.
// PLAYWRIGHT_MODULE must point to an installed Playwright package entry.
import {mkdir,writeFile} from 'node:fs/promises';
import path from 'node:path';
import {pathToFileURL} from 'node:url';
import assert from 'node:assert/strict';
const {chromium}=await import(pathToFileURL(process.env.PLAYWRIGHT_MODULE).href);
const base=process.env.ADVICE_PREVIEW_URL||'http://127.0.0.1:18974/Gutters/';
const out=process.env.ADVICE_EVIDENCE_DIR||path.resolve('advice-browser-proof');
await mkdir(out,{recursive:true});
const browser=await chromium.launch({executablePath:process.env.CHROME_EXECUTABLE||'C:/Program Files/Google/Chrome/Application/chrome.exe',headless:true});
const results=[];
try {
 for(const config of [{name:'desktop',width:1280,height:900,javaScriptEnabled:true},{name:'mobile',width:390,height:844,javaScriptEnabled:true},{name:'no-js',width:390,height:844,javaScriptEnabled:false}]){
  const context=await browser.newContext({viewport:{width:config.width,height:config.height},javaScriptEnabled:config.javaScriptEnabled});
  const page=await context.newPage(),errors=[],external=[],failures=[];
  page.on('pageerror',error=>errors.push(error.message));
  page.on('request',req=>{if(new URL(req.url()).origin!==new URL(base).origin)external.push(req.url());});
  page.on('response',res=>{if(res.status()>=400) failures.push([res.status(),res.url()]);});
  await page.goto(base,{waitUntil:'networkidle'});
  await page.getByRole('link',{name:'Read the homeowner guide',exact:true}).click();
  await page.waitForURL('**/gutter-advice.html');
  assert.equal(await page.locator('.advice-cards details').count(),5);
  assert.equal(await page.locator('form,input,textarea').count(),0);
  const first=page.locator('summary').first();
  await first.click();
  assert.equal(await page.locator('details').first().getAttribute('open'),'');
  assert.ok(await page.getByText('Wet ground alone does not establish roof runoff as the cause.',{exact:false}).isVisible());
  await first.focus(); await page.keyboard.press('Enter');
  assert.equal(await page.locator('details').first().getAttribute('open'),null);
  await page.keyboard.press('Space');
  assert.equal(await page.locator('details').first().getAttribute('open'),'');
  for(const summary of await page.locator('summary').all()){
    const details=summary.locator('..');
    if(await details.getAttribute('open')===null) await summary.click();
  }
  assert.ok(await page.getByText('Arrange an inspection by a qualified professional appropriate to the building concern.',{exact:false}).isVisible());
  assert.equal(await page.locator('aside a[href="tel:+12393553686"]').count(),1);
  assert.equal(await page.locator('aside a[href="sms:+12393553686"]').count(),1);
  assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth),true);
  await page.screenshot({path:path.join(out,config.name+'.png'),fullPage:true});
  assert.deepEqual(errors,[]); assert.deepEqual(external,[]); assert.deepEqual(failures,[]);
  const accessibility=await page.locator('main').ariaSnapshot();
  await writeFile(path.join(out,config.name+'-accessibility.txt'),accessibility);
  results.push({name:config.name,url:page.url(),passed:true,checks:['home-to-guide link','5 readable native disclosures','mouse and Enter/Space toggle','building concern route','no personal-data form','call/text targets','no horizontal overflow','no page errors','no external requests','no failed responses'],viewport:{width:config.width,height:config.height},javaScriptEnabled:config.javaScriptEnabled});
  await context.close();
 }
 await writeFile(path.join(out,'results.json'),JSON.stringify({recordedAt:new Date().toISOString(),base,results},null,2));
 console.log(JSON.stringify(results,null,2));
}finally{await browser.close();}

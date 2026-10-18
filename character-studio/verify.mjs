import puppeteer from 'puppeteer-core';
import assert from 'node:assert/strict';
import fs from 'node:fs';
const browser=await puppeteer.launch({executablePath:process.env.CHROME_PATH||'C:/Program Files/Google/Chrome/Application/chrome.exe',headless:true,args:['--no-sandbox']});
try {
 const page=await browser.newPage(),errors=[];page.on('pageerror',e=>errors.push(e.message));
 await page.setViewport({width:1440,height:1000});await page.goto('http://127.0.0.1:4178/character-studio/',{waitUntil:'networkidle0'});await page.waitForFunction(()=>window.characterStudio);
 for(const name of ['Amber','Anna','Leona','Machi','Noise','余采馨','吳冠賢','李明庭','廖秦葦','鄭筱舢','黎子瑄']) {
  await page.evaluate(n=>window.characterStudio.select(n),name);await page.locator('[data-motion=run]').click();await page.evaluate(()=>new Promise(r=>requestAnimationFrame(r)));
  const stats=await page.evaluate(()=>{let skins=0,bones=0;window.characterStudio.model.traverse(o=>{if(o.isSkinnedMesh)skins++;if(o.isBone)bones++;});return {skins,bones};});assert.ok(stats.skins>20);assert.equal(stats.bones,15);
 }
 await page.evaluate(()=>window.characterStudio.select('Amber'));await page.locator('[data-motion=idle]').click();await page.locator('[data-view="0"]').click();await page.screenshot({path:'character-studio/preview.png'});
 await page.locator('[data-filter=staff]').click();assert.equal(await page.evaluate(()=>document.querySelectorAll('.character').length),6);await page.locator('[data-filter=all]').click();
 await page.locator('#skeleton').click();await page.locator('#skeleton').click();await page.click('#references button');assert.equal(await page.evaluate(()=>document.querySelectorAll('dialog[open]').length),1);await page.locator('#close-dialog').click();
 const client=await page.createCDPSession();const downloadPath=fs.realpathSync('character-studio');await client.send('Browser.setDownloadBehavior',{behavior:'allow',downloadPath});await page.locator('#export').click();await page.waitForFunction(()=>!document.querySelector('#export').disabled);assert.match(await page.evaluate(()=>document.querySelector('#status').innerText),/已匯出/);
 await page.waitForFunction(()=>!document.querySelector('#export').disabled);await new Promise(r=>setTimeout(r,1000));const glb=fs.readFileSync('character-studio/EMC_Amber_prototype.glb');assert.equal(glb.toString('utf8',0,4),'glTF');const json=JSON.parse(glb.toString('utf8',20,20+glb.readUInt32LE(12)));assert.equal(json.animations.length,3);assert.ok(json.skins.length>0);console.log('GLB validated:',glb.length,'bytes;',json.animations.map(a=>a.name).join(', '));
 await page.setViewport({width:390,height:844});assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);await page.screenshot({path:'character-studio/preview-mobile.png',fullPage:true});assert.deepEqual(errors,[]);console.log('PASS: 11 models, 15 bones each, filters, motions, reference dialog, GLB skins/animations, mobile layout, no JS errors.');
} finally {await browser.close();}



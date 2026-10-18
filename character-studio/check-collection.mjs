import puppeteer from 'puppeteer-core';
import fs from 'node:fs';
const browser=await puppeteer.launch({executablePath:process.env.CHROME_PATH||'C:/Program Files/Google/Chrome/Application/chrome.exe',headless:true,args:['--no-sandbox']});
try{
 const page=await browser.newPage();await page.setViewport({width:1280,height:1050});await page.goto('http://127.0.0.1:4178/character-studio/',{waitUntil:'networkidle0'});await page.waitForFunction(()=>window.characterStudio);
 const pictures=[];
 for(const name of ['Amber','Anna','Leona','Machi','Noise','余采馨','吳冠賢','李明庭','廖秦葦','鄭筱舢','黎子瑄']){
  await page.evaluate(n=>window.characterStudio.select(n),name);await page.click('[data-view="0"]');await new Promise(r=>setTimeout(r,120));
  const screenshot=await (await page.$('#canvas')).screenshot();pictures.push({name,image:screenshot.toString('base64')});
  // Exercise animation before taking a rear view for each character.
  await page.click('[data-motion=run]');await new Promise(r=>setTimeout(r,100));await page.click('[data-view="3.141593"]');await page.click('[data-motion=idle]');
 }
 const sheet=await browser.newPage();await sheet.setViewport({width:1280,height:1480});await sheet.setContent(`<body style="margin:0;background:#eff0e8;font:16px sans-serif;display:grid;grid-template-columns:repeat(4,1fr);gap:8px">${pictures.map(p=>`<figure style="margin:0;background:#f8f7f0;text-align:center"><img style="width:100%;height:430px;object-fit:cover" src="data:image/png;base64,${p.image}"><figcaption>${p.name} · v2</figcaption></figure>`).join('')}</body>`);await sheet.screenshot({path:'character-studio/collection-v2.png',fullPage:true});console.log('Rendered 11 character contact sheet');
}finally{await browser.close();}

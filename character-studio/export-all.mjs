import puppeteer from 'puppeteer-core';
import fs from 'node:fs';
const b=await puppeteer.launch({executablePath:'C:/Program Files/Google/Chrome/Application/chrome.exe',headless:true,args:['--no-sandbox']});
try{const p=await b.newPage();await p.goto('http://127.0.0.1:4178/character-studio/',{waitUntil:'networkidle0'});const c=await p.createCDPSession();await c.send('Browser.setDownloadBehavior',{behavior:'allow',downloadPath:fs.realpathSync('character-studio/models')});for(const n of ['Amber','Anna','Leona','Machi','Noise','余采馨','吳冠賢','李明庭','廖秦葦','鄭筱舢','黎子瑄']){await p.evaluate(n=>window.characterStudio.select(n),n);await p.evaluate(()=>window.characterStudio.exportModel());await new Promise(r=>setTimeout(r,1200));}await new Promise(r=>setTimeout(r,5000));console.log('Exported',fs.readdirSync('character-studio/models').length,'GLBs');}finally{await b.close();}



// 以 3D 模型烘焙 16 方向 × (待機 + 8 格走路) 的像素 sprite 圖集到 sprites/。
// 先在專案根目錄啟動靜態伺服器（預設 4190），再執行：node pixel-plaza/bake.mjs
import puppeteer from 'puppeteer-core';
import fs from 'node:fs';
const port = process.env.PORT || 4190;
const names = ['Amber','Anna','Leona','Machi','Noise','余采馨','吳冠賢','廖秦葦','李明庭','鄭筱舢','黎子瑄'];
fs.mkdirSync('pixel-plaza/sprites', {recursive:true});
const b = await puppeteer.launch({executablePath:'C:/Program Files/Google/Chrome/Application/chrome.exe', headless:true, args:['--no-sandbox','--use-gl=angle','--use-angle=swiftshader','--enable-unsafe-swiftshader']});
try {
  const p = await b.newPage(); p.on('pageerror', e => console.log('pageerror', e.message));
  await p.goto(`http://127.0.0.1:${port}/pixel-plaza/bake.html`); await p.waitForFunction('window.ready', {timeout:20000});
  for (const n of names) {
    const url = await p.evaluate(n => window.bake(n), n);
    fs.writeFileSync(`pixel-plaza/sprites/${n}.png`, Buffer.from(url.split(',')[1], 'base64')); console.log('baked', n);
  }
} finally { await b.close(); }

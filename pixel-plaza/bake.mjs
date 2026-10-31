// 由三視圖＋ai-views 內 Codex 生成的中間角度，合成 12 面向像素圖集到 sprites/。可帶角色名稱只重烘部分。
// 先在專案根目錄啟動靜態伺服器（預設 4190），再執行：node pixel-plaza/bake.mjs
import puppeteer from 'puppeteer-core';
import fs from 'node:fs';
const port = process.env.PORT || 4190;
const only = process.argv.slice(2);
const people = [['designer','Amber'],['designer','Anna'],['designer','Leona'],['designer','Machi'],['designer','Noise'],['staff','余采馨'],['staff','吳冠賢'],['staff','廖秦葦'],['staff','李明庭'],['staff','鄭筱舢'],['staff','黎子瑄']].filter(([, n]) => !only.length || only.includes(n));
const hd = !!process.env.HD, dir = hd ? 'pixel-plaza/sprites-hd' : 'pixel-plaza/sprites';
fs.mkdirSync(dir, {recursive:true});
const b = await puppeteer.launch({executablePath:'C:/Program Files/Google/Chrome/Application/chrome.exe', headless:true, args:['--no-sandbox']});
try {
  const p = await b.newPage(); p.on('pageerror', e => console.log('pageerror', e.message));
  await p.goto(`http://127.0.0.1:${port}/pixel-plaza/bake.html${hd ? '?hd=1' : ''}`); await p.waitForFunction('window.ready', {timeout:20000});
  for (const [pre, n] of people) {
    const url = await p.evaluate((a, n) => window.bake(a, n), pre, n);
    fs.writeFileSync(`${dir}/${n}.png`, Buffer.from(url.split(',')[1], 'base64')); console.log('baked', n);
  }
} finally { await b.close(); }

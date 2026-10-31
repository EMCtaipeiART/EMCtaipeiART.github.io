// 開發工具：把現有素材裁成給 Codex 當「風格參考」的小張 PNG（不改動任何原素材）。
import puppeteer from 'puppeteer-core';
import fs from 'node:fs';
import path from 'node:path';
const out = path.resolve('design/minigames-art/refs');
fs.mkdirSync(out, { recursive: true });
const chrome = ['C:/Program Files/Google/Chrome/Application/chrome.exe', 'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe'].find(p => fs.existsSync(p));
const browser = await puppeteer.launch({ executablePath: chrome, headless: true, args: ['--no-sandbox', '--allow-file-access-from-files'] });
const page = await browser.newPage();
await page.goto('http://localhost:8787/', { waitUntil: 'domcontentloaded' });
const crops = [
  // [輸出檔, 來源, sx, sy, sw, sh]
  ['ref-office-desks.png', 'design/office-map/office-map-source.png', 700, 800, 1000, 700],
  ['ref-office-rooms.png', 'design/office-map/office-map-source.png', 40, 2230, 900, 1000],
  ['ref-office-toilet-elevator.png', 'design/office-map/office-map-source.png', 220, 200, 1000, 620],
  ['ref-characters.png', 'dist/assets/sprites-packed.webp', 0, 0, 420, 946],
  ['ref-icons.png', 'dist/assets/icons-v3.png', 0, 0, 768, 768]
];
for (const [name, src, sx, sy, sw, sh] of crops) {
  const file = path.resolve(src);
  const b64 = fs.readFileSync(file).toString('base64');
  const mime = src.endsWith('.webp') ? 'image/webp' : 'image/png';
  const data = await page.evaluate(async (b64, mime, sx, sy, sw, sh) => {
    const img = new Image(); img.src = `data:${mime};base64,${b64}`; await img.decode();
    const c = document.createElement('canvas'); c.width = sw; c.height = sh;
    const g = c.getContext('2d'); g.imageSmoothingEnabled = false; g.drawImage(img, sx, sy, sw, sh, 0, 0, sw, sh);
    return c.toDataURL('image/png');
  }, b64, mime, sx, sy, sw, sh);
  fs.writeFileSync(path.join(out, name), Buffer.from(data.split(',')[1], 'base64'));
  console.log(name, fs.statSync(path.join(out, name)).size);
}
await browser.close();

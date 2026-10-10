/**
 * 瀏覽器煙霧測試：用真的 Chrome 開首頁，模擬登入，逐一打開主要頁面，
 * 任何一頁出現程式錯誤（頁面例外、console error）或畫面是空的就判定失敗。
 * 後端 API 一律用假資料回應，不會碰到正式資料庫；案件資料讀本機的 backend/data/db.json。
 *
 * 執行：npm run smoke（需要本機有 Chrome；可用 CHROME_PATH 指定）
 */
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import puppeteer from 'puppeteer-core';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'application/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.json': 'application/json; charset=utf-8', '.svg': 'image/svg+xml', '.webp': 'image/webp', '.png': 'image/png', '.jpg': 'image/jpeg' };

function findChrome() {
  const list = [process.env.CHROME_PATH, 'C:/Program Files/Google/Chrome/Application/chrome.exe', 'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe', '/usr/bin/google-chrome', '/usr/bin/google-chrome-stable', '/usr/bin/chromium', '/usr/bin/chromium-browser', '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'];
  const found = list.find(p => p && fs.existsSync(p));
  if (!found) throw new Error('找不到 Chrome，請設定環境變數 CHROME_PATH');
  return found;
}

const server = http.createServer((req, res) => {
  const rel = decodeURIComponent(new URL(req.url, 'http://x').pathname).replace(/^\/+/, '') || 'index.html';
  const file = path.join(root, rel);
  if (!file.startsWith(root) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) { res.writeHead(404); res.end('not found'); return; }
  res.writeHead(200, { 'Content-Type': MIME[path.extname(file)] || 'application/octet-stream' });
  fs.createReadStream(file).pipe(res);
});
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
const base = `http://127.0.0.1:${server.address().port}`;

const apiReply = (body) => {
  let action = '';
  try { action = JSON.parse(body || '{}').action || ''; } catch { /* ignore */ }
  const ok = (extra = {}) => ({ ok: true, action, ...extra });
  switch (action) {
    case 'getAssignments': return ok({ items: [
      { id: 'a1', designer: 'Machi', client: 'DJI', team: 'Odin/Allen', monthly: '社群 ｜ 4-6 篇起/月', note: '', sort: 10 },
      { id: 'a2', designer: 'Anna', client: 'Epson', team: '', monthly: '', note: '', sort: 20 }
    ] });
    case 'getNotebook': return ok({ items: [{ id: 'n1', category: '測試', section: '', title: '測試卡片', fields: [{ label: '帳號', value: 'x', secret: false }, { label: '密碼', value: 'p', secret: true }], sort: 10, updatedAt: 0, updatedBy: '' }], categoryOrder: [] });
    case 'designCalendar': return ok({ events: [], leaves: [], holidays: [] });
    case 'getDutyOverrides': return ok({ overrides: {} });
    case 'publicRevision': return ok({ revision: 1 });
    default: return ok();
  }
};

const browser = await puppeteer.launch({ executablePath: findChrome(), headless: true, args: ['--no-sandbox', '--disable-gpu'] });
const failures = [];
const page = await browser.newPage();
await page.setViewport({ width: 1280, height: 900 });
let current = '開啟首頁';
page.on('pageerror', err => failures.push(`[${current}] 頁面例外：${err.message}`));
page.on('console', msg => {
  if (msg.type() !== 'error') return;
  const text = msg.text();
  if (/Failed to load resource|net::ERR|favicon|WebSocket connection/i.test(text)) return;
  failures.push(`[${current}] console.error：${text.slice(0, 200)}`);
});
await page.setRequestInterception(true);
page.on('request', req => {
  const url = req.url();
  if (url.startsWith(base)) { req.continue(); return; }
  if (/machi-design-api\.machi-chen\.workers\.dev/.test(url)) {
    if (req.method() === 'OPTIONS') { req.respond({ status: 204, headers: { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': '*' } }); return; }
    req.respond({ status: 200, contentType: 'application/json', headers: { 'Access-Control-Allow-Origin': '*' }, body: JSON.stringify(apiReply(req.postData())) });
    return;
  }
  req.respond({ status: 200, contentType: /\.css|fonts\.googleapis/.test(url) ? 'text/css' : 'text/plain', headers: { 'Access-Control-Allow-Origin': '*' }, body: '' });
});
await page.evaluateOnNewDocument(() => {
  try {
    localStorage.setItem('designRequestEditorToken', 'smoke-token');
    localStorage.setItem('designRequestEditorUser', 'Machi');
    localStorage.setItem('designRequestEditorDisplayName', 'Machi');
    localStorage.setItem('designRequestEditorAccount', 'machi.chen@emctaipei.com');
    localStorage.removeItem('designRequestEditorLoggedOut');
    sessionStorage.removeItem('designRequestEditorLoggedOut');
  } catch { /* ignore */ }
});

const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
async function unlock() {
  await page.evaluate(() => {
    window.MachiAccess = { state: { loaded: true, role: '管理者' }, can: () => true, refresh() {}, ready: Promise.resolve() };
    document.getElementById('machiAccessDenied')?.remove();
  });
}

const checks = [
  { name: '首頁', selector: null, expect: '最新' },
  { name: '專案', selector: '[data-nav="projects"]', expect: '' },
  { name: '行事曆', selector: '[data-ext="calendar"]', expect: '行事曆' },
  { name: '專案分配', selector: '[data-ext="assign"]', expect: '專案分配' },
  { name: '記事本', selector: '[data-ext="notes"]', expect: '記事本' },
  { name: '作品牆', selector: '[data-ext="wall"]', expect: '作品牆' },
  { name: '回到首頁', selector: '[data-nav="board"]', expect: '' }
];

try {
  await page.goto(`${base}/index.html`, { waitUntil: 'domcontentloaded' });
  await unlock();
  await sleep(2500);
  await unlock();
  for (const check of checks) {
    current = check.name;
    if (check.selector) {
      const clicked = await page.evaluate(sel => { const el = document.querySelector(sel); if (!el) return false; el.click(); return true; }, check.selector);
      if (!clicked) { failures.push(`[${check.name}] 找不到入口按鈕 ${check.selector}`); continue; }
      await sleep(1800);
    }
    const info = await page.evaluate(() => ({ stage: (document.getElementById('stage') || {}).innerText || '', len: (document.getElementById('stage') || {}).innerHTML?.length || 0, team: document.getElementById('team')?.children.length || 0 }));
    if (check.name === '首頁' && info.team < 1) failures.push('[首頁] 設計師頭像沒有顯示');
    if (check.expect && check.name !== '首頁' && !info.stage.includes(check.expect)) failures.push(`[${check.name}] 畫面沒有出現「${check.expect}」`);
    if (info.len < 200 && check.name !== '首頁') failures.push(`[${check.name}] 畫面是空的`);
  }
} catch (error) {
  failures.push(`[${current}] 測試執行失敗：${error.message}`);
}

await browser.close();
server.close();
if (failures.length) {
  console.error(`煙霧測試失敗（${failures.length}）：\n- ${failures.join('\n- ')}`);
  process.exit(1);
}
console.log(`煙霧測試通過：${checks.map(c => c.name).join('、')}`);

/**
 * 量資料庫後台（json_database_admin.html）的啟動速度。
 *
 * 做法：起一個本機靜態伺服器載入頁面，用 puppeteer 攔截所有對 Worker 的請求並用「模擬延遲」回應
 * （預設延遲取自 2026-11-19 在正式站實測：驗證 0.9s、refreshDatabase 2.8s、/tables 0.8s、讀資料表 0.8s），
 * 再量「表格第一次畫出來」與「所有請求結束」的時間。只讀、不碰真實後端與資料。
 *
 * 用法（在 repo 根目錄，需要 node_modules 的 puppeteer-core 與 Chrome）：
 *   node tools/admin-startup-bench.mjs                        # 量目前這份
 *   node tools/admin-startup-bench.mjs --root=C:/other-copy   # 量另一份（例如 origin/main 的乾淨 worktree，做前後比較）
 *   node tools/admin-startup-bench.mjs --stale                # 模擬「後端快照比 GitHub 舊」：refreshDatabase 回報新版號，驗證會自動重畫
 *   node tools/admin-startup-bench.mjs --verify=900 --refresh=2800 --tables=800 --table=800   # 自訂各步驟延遲（毫秒）
 * Chrome 路徑可用環境變數 CHROME_PATH 指定。
 */
import { createRequire } from 'node:module';
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const args = Object.fromEntries(process.argv.slice(2).map(a => { const m = a.match(/^--([^=]+)(?:=(.*))?$/); return m ? [m[1], m[2] ?? true] : [a, true]; }));
const ROOT = path.resolve(String(args.root || path.join(here, '..')));
const delay = { verify: Number(args.verify) || 900, refresh: Number(args.refresh) || 2800, tables: Number(args.tables) || 800, table: Number(args.table) || 800 };
const stale = Boolean(args.stale);
const require = createRequire(path.join(path.resolve(here, '..'), 'package.json'));
const puppeteer = require('puppeteer-core');
const chrome = process.env.CHROME_PATH || (process.platform === 'darwin' ? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome' : 'C:/Program Files/Google/Chrome/Application/chrome.exe');

const DB = JSON.parse(fs.readFileSync(path.join(ROOT, 'backend/data/db.json'), 'utf8'));
const types = { '.html': 'text/html;charset=utf-8', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.webp': 'image/webp', '.png': 'image/png', '.svg': 'image/svg+xml' };
const server = http.createServer((req, res) => {
  const p = path.join(ROOT, decodeURIComponent(new URL(req.url, 'http://x').pathname));
  const f = fs.existsSync(p) && fs.statSync(p).isDirectory() ? path.join(p, 'index.html') : p;
  if (!fs.existsSync(f)) { res.writeHead(404); res.end(); return; }
  res.writeHead(200, { 'content-type': types[path.extname(f)] || 'application/octet-stream' });
  fs.createReadStream(f).pipe(res);
}).listen(0);
const port = server.address().port;

const browser = await puppeteer.launch({ executablePath: chrome, headless: true });
const page = await (await browser.createBrowserContext()).newPage();
await page.setViewport({ width: 1360, height: 900 });
await page.setRequestInterception(true);
const log = [];
let t0 = 0;
const revision = Number(DB.revision) || 1;
let refreshed = false;
page.on('request', req => {
  const url = req.url();
  if (!url.includes('workers.dev')) return req.continue();
  if (req.method() === 'OPTIONS') return req.respond({ status: 204, headers: { 'access-control-allow-origin': '*', 'access-control-allow-headers': '*', 'access-control-allow-methods': '*' } });
  let body = {}; try { body = JSON.parse(req.postData() || '{}'); } catch { /* GET */ }
  let out = { ok: true }, ms = 0, label = req.method() + ' ' + (body.action || url.replace(/^.*\/api/, ''));
  if (body.action === 'verifyToken') { ms = delay.verify; out = { ok: true, account: 'machi.chen@emctaipei.com', access: { role: '管理者', status: '啟用', pages: ['request', 'dashboard', 'archive', 'database_admin', 'media_admin', 'avatar_upload'], capabilities: ['database.manage'], explicit: true } }; }
  else if (body.action === 'refreshDatabase') { ms = delay.refresh; out = { ok: true, action: 'refreshDatabase', revision: stale ? revision + 1 : revision, refreshed: true }; }
  else if (req.method() === 'GET' && url.endsWith('/api/tables')) { ms = delay.tables; out = { ok: true, revision: 0, tables: Object.fromEntries(Object.entries(DB.tables).map(([k, t]) => [k, { headers: t.headers || [], primaryKey: t.primaryKey || '', rowCount: (t.rows || []).length }])) }; }
  else if (req.method() === 'GET' && url.includes('/api/table/')) { ms = delay.table; out = { ok: true, rows: [], total: 0, headers: [], offset: 0, limit: 50 }; }
  const started = Date.now() - t0;
  setTimeout(() => {
    if (body.action === 'refreshDatabase') refreshed = true;
    if (req.method() === 'GET' && url.endsWith('/api/tables')) out.revision = (stale && refreshed) ? revision + 1 : revision; // 後端快照要等 refreshDatabase 做完才變新
    log.push(`${String(started).padStart(5)}ms → ${String(Date.now() - t0).padStart(5)}ms  ${label}`);
    req.respond({ status: 200, headers: { 'access-control-allow-origin': '*', 'content-type': 'application/json' }, body: JSON.stringify(out) });
  }, ms);
});
await page.evaluateOnNewDocument(() => {
  const set = { designRequestEditorToken: 't', designRequestEditorUser: 'Machi', designRequestEditorDisplayName: 'Machi', designRequestEditorAccount: 'machi.chen@emctaipei.com', designRequestApiUrl: 'https://machi-design-api.machi-chen.workers.dev/api' };
  for (const [k, v] of Object.entries(set)) { localStorage.setItem(k, v); sessionStorage.setItem(k, v); }
  (function watch() { // 側邊選單出現資料表分頁＝第一次畫出來
    if (document.querySelector('#tabs [data-table]')) { window.__paint = performance.now(); return; }
    requestAnimationFrame(watch);
  })();
});
t0 = Date.now();
await page.goto(`http://localhost:${port}/json_database_admin.html`, { waitUntil: 'domcontentloaded' });
await page.waitForFunction(() => window.__paint, { timeout: 60000 });
const paint = await page.evaluate(() => Math.round(window.__paint));
await new Promise(r => setTimeout(r, delay.refresh + delay.tables + delay.table + 1500)); // 等所有請求結束
const tabs = await page.evaluate(() => document.querySelectorAll('#tabs [data-table]').length);
console.log(`根目錄：${ROOT}`);
console.log(`模擬延遲（ms）：驗證 ${delay.verify}／refreshDatabase ${delay.refresh}／/tables ${delay.tables}／讀資料表 ${delay.table}${stale ? '／模擬後端快照較舊' : ''}`);
console.log(log.join('\n'));
console.log(`\n★ 側邊選單與表格第一次畫出來：${paint} ms（頁面開始載入後）`);
console.log(`  最後一個請求結束：${log.length ? log[log.length - 1].split('→')[1].trim().split('ms')[0] : '?'} ms；資料表分頁數：${tabs}`);
await browser.close();
server.close();

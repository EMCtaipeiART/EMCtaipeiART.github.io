// 把整理好的飲料菜單寫進線上 D1（建立／更新飲料團）。不需要管理密碼，但需要已登入 wrangler。
// 用法：node tools/drink-push.mjs <團購代號> "<團購名稱>" menus/xxx.json [開團連結]
// 已存在的團購只換菜單（設定、訂單、聊天、評論都保留）；新團購會建立並設定名稱。
import fs from 'node:fs';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { buildDrinkCatalog } from '../src/drink.js';

const [cid, name, file, link] = process.argv.slice(2);
if (!/^[a-z0-9-]{1,20}$/.test(cid || '') || !name || !file) { console.log('用法：node tools/drink-push.mjs <代號> "<名稱>" <menu.json> [連結]'); process.exit(1); }
const ROOT = fileURLToPath(new URL('../', import.meta.url));
const q = (sql) => JSON.parse(execFileSync('npx', ['wrangler', 'd1', 'execute', 'emc-lens-shop', process.env.LOCAL ? '--local' : '--remote', '--json', '--command', sql], { cwd: ROOT, encoding: 'utf8' }))[0].results;
const esc = (s) => String(s).replace(/'/g, "''");
const kv = (k, v) => `INSERT INTO kv(k,v) VALUES('${esc(k)}','${esc(JSON.stringify(v))}') ON CONFLICT(k) DO UPDATE SET v=excluded.v;`;

const menu = JSON.parse(fs.readFileSync(file, 'utf8')); if (link) menu.link = link;
const built = buildDrinkCatalog(menu);
const camps = JSON.parse((q("SELECT v FROM kv WHERE k='campaigns'")[0] || { v: '[]' }).v);
const isNew = !camps.some((c) => c.id === cid);
const key = (k) => (cid === 'lens' ? k : cid + ':' + k);
let sql = '';
if (isNew) {
  camps.push({ id: cid, status: 'open', createdAt: new Date(Date.now() + 8 * 3600e3).toISOString().slice(0, 19).replace('T', ' ') });
  sql += kv('campaigns', camps) + '\n';
  sql += kv(key('settings'), { shopName: name, deadline: '', closed: false, bankName: '', bankAccount: '', accountName: '', notes: '', siteUrl: '', goal: '' }) + '\n';
}
const fkey = (cid === 'lens' ? '' : cid + '/') + 'catalog.json';
const buf = Buffer.from(JSON.stringify(built.catalog), 'utf8');
sql += `DELETE FROM files WHERE k='${fkey}';\n`;
for (let o = 0, c = 0; o < buf.length || c === 0; o += 40000, c++)
  sql += `INSERT INTO files(k,i,mime,data) VALUES('${fkey}',${c},'application/json',X'${buf.subarray(o, o + 40000).toString('hex')}');\n`;
sql += kv(key('pimgs'), built.pimgs) + '\n';
const out = fileURLToPath(new URL('./drink-push.sql', import.meta.url));
fs.writeFileSync(out, sql);
execFileSync('npx', ['wrangler', 'd1', 'execute', 'emc-lens-shop', process.env.LOCAL ? '--local' : '--remote', '--file', out], { cwd: ROOT, stdio: 'inherit' });
fs.unlinkSync(out);
console.log(`${isNew ? '已建立' : '已更新'}飲料團 ${cid}（${name}）：${built.catalog.items.length} 項，圖片 ${Object.keys(built.pimgs).length} 張`);

#!/usr/bin/env node
// 作品牆階段 0：唯讀盤點。只讀 NAS 與資料庫，不上傳、不寫入任何正式資料。
// 用法：node scripts/works_inventory.mjs --year 26 [--out <dir>]
// 產出：<out>/inventory-<yy>.json（案件→候選檔案對照）與終端機摘要。
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const args = process.argv.slice(2);
const opt = (name, fallback) => { const i = args.indexOf(`--${name}`); return i >= 0 ? args[i + 1] : fallback; };
const year = opt('year', '26');
const outDir = opt('out', path.join(here, '..', 'notes'));
const mountRoot = opt('mount', '/Volumes/設計部');
const roots = ['專案企劃部/執行中', '專案企劃部/已結案'];
const IMG = new Set(['.jpg', '.jpeg', '.png']);
const SKIP_DIRS = /^(links?|素材|參考用?|reference|font|logos?|照片|影片)$/i;

const db = JSON.parse(await fs.readFile(path.join(here, '..', 'data', 'database_archive.json'), 'utf8'));
const cases = db.rows.filter((r) => r['案件編號'].startsWith(year));

const norm = (s) => String(s || '').toLowerCase().replace(/[\s_\-()（）【】\[\]]/g, '');
const parseDate = (s) => { const m = String(s || '').match(/(\d{4})\/(\d{1,2})\/(\d{1,2})/); return m ? Date.UTC(+m[1], +m[2] - 1, +m[3]) : null; };
const fileDate = (name) => { const m = name.match(/^(\d{2})(\d{2})(\d{2})/); return m && +m[2] >= 1 && +m[2] <= 12 && +m[3] >= 1 && +m[3] <= 31 ? Date.UTC(2000 + +m[1], +m[2] - 1, +m[3]) : null; };

// 客戶別 → NAS 客戶資料夾
const clientDirs = new Map();
for (const r of roots) {
  let names = [];
  try { names = await fs.readdir(path.join(mountRoot, r)); } catch { continue; }
  for (const n of names) if (!n.startsWith('.')) clientDirs.set(n, path.join(mountRoot, r, n));
}
const findClientDir = (client) => {
  const c = norm(client);
  if (!c) return null;
  for (const [n, p] of clientDirs) if (norm(n) === c) return p;
  for (const [n, p] of clientDirs) if (norm(n).includes(c) || c.includes(norm(n))) return p;
  return null;
};

async function walk(dir, depth, found) {
  if (depth > 6) return;
  let ents;
  try { ents = await fs.readdir(dir, { withFileTypes: true }); } catch { return; }
  for (const e of ents) {
    if (e.name.startsWith('.')) continue;
    const full = path.join(dir, e.name);
    if (e.isDirectory()) { if (!SKIP_DIRS.test(e.name)) await walk(full, depth + 1, found); }
    else if (IMG.has(path.extname(e.name).toLowerCase())) {
      const d = fileDate(e.name);
      if (d !== null && new Date(d).getUTCFullYear() === 2000 + +year) {
        const st = await fs.stat(full).catch(() => null);
        found.push({ path: full, name: e.name, date: d, size: st?.size || 0 });
      }
    }
  }
}

const filesByClient = new Map();
const clients = [...new Set(cases.map((c) => c['客戶別']))];
const t0 = Date.now();
for (const client of clients) {
  const dir = findClientDir(client);
  if (!dir) { filesByClient.set(client, null); continue; }
  const found = [];
  await walk(dir, 0, found);
  filesByClient.set(client, { dir, files: found });
}

const DAY = 86400000;
const result = [];
const stats = { cases: cases.length, noClientDir: 0, matched: 0, unmatched: 0, files: 0, bytes: 0 };
const used = new Set();
for (const c of cases) {
  const info = filesByClient.get(c['客戶別']);
  const row = { caseId: c['案件編號'], client: c['客戶別'], project: c['專案名稱'], type: c['設計種類'], start: c['開始日期'], end: c['結束日期'], clientDir: info?.dir || null, files: [], confidence: 'none' };
  if (!info) { stats.noClientDir++; result.push(row); continue; }
  const s = parseDate(c['開始日期']), e = parseDate(c['結束日期']) ?? s;
  const proj = norm(c['專案名稱']);
  const nameHit = (n) => { const base = norm(n.replace(/^\d{6}/, '').replace(/\.[^.]+$/, '')); return proj.length >= 3 && base.length >= 3 && (proj.includes(base) || base.includes(proj)); };
  // 日期落在 開始-0 ~ 結束+2 天，且檔名吻合者為「高」；僅日期吻合為「低」
  const hits = info.files.filter((f) => s !== null && f.date >= s - DAY && f.date <= e + 2 * DAY);
  const strong = hits.filter((f) => nameHit(f.name));
  const pick = strong.length ? strong : hits;
  row.files = pick.map((f) => ({ path: f.path, size: f.size }));
  row.confidence = strong.length ? 'high' : hits.length ? 'low' : 'none';
  if (row.files.length) { stats.matched++; stats.files += row.files.length; stats.bytes += row.files.reduce((a, f) => a + f.size, 0); row.files.forEach((f) => used.add(f.path)); }
  else stats.unmatched++;
  result.push(row);
}
const conf = result.reduce((m, r) => (m[r.confidence] = (m[r.confidence] || 0) + 1, m), {});
const totalFiles = [...filesByClient.values()].reduce((a, v) => a + (v?.files.length || 0), 0);
const orphan = totalFiles - used.size;

await fs.mkdir(outDir, { recursive: true });
const outFile = path.join(outDir, `works-inventory-${year}.json`);
await fs.writeFile(outFile, JSON.stringify({ generatedAt: new Date().toISOString(), stats: { ...stats, confidence: conf, nasFilesInYear: totalFiles, orphanFiles: orphan }, cases: result }, null, 1));
console.log(JSON.stringify({ ...stats, confidence: conf, nasFilesInYear: totalFiles, orphanFiles: orphan, mbMatched: +(stats.bytes / 1048576).toFixed(1), seconds: (Date.now() - t0) / 1000, out: outFile }, null, 2));

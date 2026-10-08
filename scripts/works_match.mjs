#!/usr/bin/env node
// 作品牆階段 0：用「NAS 目錄快取」離線配對 案件 ↔ 作品圖。完全不碰 NAS、不上傳。
// 用法：node scripts/works_match.mjs --year 26 [--trust-pending-alias] [--out <dir>]
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const args = process.argv.slice(2);
const opt = (n, f) => { const i = args.indexOf(`--${n}`); return i >= 0 ? args[i + 1] : f; };
const year = opt('year', '26');
const outDir = opt('out', path.join(here, '..', 'notes'));
const trustPending = args.includes('--trust-pending-alias');

const idx = JSON.parse(await fs.readFile(path.join(here, 'nas_design_image_watcher.state', 'works-nas-index.json'), 'utf8'));
const db = JSON.parse(await fs.readFile(path.join(here, '..', 'data', 'database_archive.json'), 'utf8'));
const aliasFile = JSON.parse(await fs.readFile(path.join(here, 'works_client_alias.json'), 'utf8'));
const alias = { ...aliasFile['確定'], ...(trustPending ? aliasFile['待確認'] : {}) };
const rules = aliasFile['規則'] || {};
const cases = db.rows.filter((r) => r['案件編號'].startsWith(year));

const norm = (s) => String(s || '').toLowerCase().replace(/[\s_\-()（）【】\[\]．.,，、]/g, '');
const parseDate = (s) => { const m = String(s || '').match(/(\d{4})\/(\d{1,2})\/(\d{1,2})/); return m ? Date.UTC(+m[1], +m[2] - 1, +m[3]) : null; };
const fileDate = (n) => { const m = n.match(/^(\d{2})(\d{2})(\d{2})/); return m && +m[2] >= 1 && +m[2] <= 12 && +m[3] >= 1 && +m[3] <= 31 ? { yy: m[1], t: Date.UTC(2000 + +m[1], +m[2] - 1, +m[3]) } : null; };
const bigrams = (s) => { const g = new Set(); for (let i = 0; i < s.length - 1; i++) g.add(s.slice(i, i + 2)); return g; };
const sim = (a, b) => { const A = bigrams(a), B = bigrams(b); if (!A.size || !B.size) return 0; let k = 0; for (const x of A) if (B.has(x)) k++; return k / Math.min(A.size, B.size); };
// 去掉日期、副檔名、版本/尺寸尾巴，讓同一件作品的各種輸出合併成一筆
const stemOf = (n) => n.replace(/\.[^.]+$/, '').replace(/^\d{6}[_\-\s]?/, '').replace(/([_\-\s]?(v\d+|ver\d+|final|a\d|\d{3,4}x\d{3,4}|\d+x\d+|修|改|copy|副本)\d*)+$/i, '');

// 客戶資料夾 → 該年度的「作品」
const byFolder = new Map();
for (const f of idx.files) {
  const d = fileDate(f.n);
  if (!d || d.yy !== year) continue;
  const rule = rules[f.c];
  if (rule?.pathIncludes && !f.p.includes(rule.pathIncludes)) continue;
  if (!byFolder.has(f.c)) byFolder.set(f.c, new Map());
  const key = `${d.t}|${norm(stemOf(f.n))}`;
  const m = byFolder.get(f.c);
  if (!m.has(key)) m.set(key, { key, client: f.c, date: d.t, stem: norm(stemOf(f.n)), files: [] });
  m.get(key).files.push({ p: f.p, z: f.z });
}
const DAY = 86400000;
const pairs = [];
const noFolder = [];
const caseFolders = new Map();
for (const c of cases) {
  const names = alias[c['客戶別']] ?? (idx.clients[c['客戶別']] ? [c['客戶別']] : null) ?? Object.keys(idx.clients).filter((k) => norm(k) === norm(c['客戶別']) || (norm(c['客戶別']).length >= 2 && (norm(k).includes(norm(c['客戶別'])) || norm(c['客戶別']).includes(norm(k)))));
  if (!names || !names.length) { noFolder.push(c); continue; }
  caseFolders.set(c['案件編號'], names);
  const s = parseDate(c['開始日期']);
  if (s === null) continue;
  const e = parseDate(c['結束日期']) ?? s;
  const proj = norm(c['專案名稱']);
  const kw = norm(c['設計圖檔名關鍵字']);
  for (const n of names) {
    for (const w of byFolder.get(n)?.values() ?? []) {
      if (w.date < s - DAY || w.date > e + 2 * DAY) continue;
      const raw = Math.max(sim(proj, w.stem), kw && w.stem.includes(kw) ? 1 : 0);
      const score = rules[n]?.trustDateOnly ? Math.max(raw, 0.5) : raw;
      pairs.push({ caseId: c['案件編號'], w, score, raw });
    }
  }
}
// 一件作品只配給一個案件：分數高者優先；一個案件可有多件作品
pairs.sort((a, b) => b.score - a.score || b.raw - a.raw);
const taken = new Map();
for (const p of pairs) if (!taken.has(p.w.key + p.w.client)) taken.set(p.w.key + p.w.client, p);
const perCase = new Map();
for (const p of taken.values()) {
  const L = perCase.get(p.caseId) || [];
  L.push(p); perCase.set(p.caseId, L);
}
const grade = (score) => (score >= 0.5 ? 'high' : score >= 0.25 ? 'medium' : 'low');
const out = [];
const stat = { cases: cases.length, noFolder: noFolder.length, high: 0, medium: 0, low: 0, none: 0, works: 0, files: 0, bytes: 0 };
for (const c of cases) {
  const L = perCase.get(c['案件編號']) || [];
  let conf = 'none';
  if (L.length) { const best = Math.max(...L.map((x) => x.score)); conf = grade(best); }
  else if (!caseFolders.has(c['案件編號'])) conf = 'noFolder';
  stat[conf] = (stat[conf] || 0) + 1;
  const keep = L.filter((x) => grade(x.score) !== 'low' || conf === 'low');
  stat.works += keep.length;
  for (const x of keep) for (const f of x.w.files) { stat.files++; stat.bytes += f.z; }
  out.push({ caseId: c['案件編號'], client: c['客戶別'], project: c['專案名稱'], start: c['開始日期'], end: c['結束日期'], confidence: conf, works: keep.map((x) => ({ score: +x.score.toFixed(2), stem: x.w.stem, files: x.w.files })) });
}
const totalWorks = [...byFolder.values()].reduce((a, m) => a + m.size, 0);
const claimed = taken.size;
const unclaimedHigh = totalWorks - claimed;
await fs.mkdir(outDir, { recursive: true });
const outFile = path.join(outDir, `works-match-${year}.json`);
await fs.writeFile(outFile, JSON.stringify({ generatedAt: new Date().toISOString(), trustPending, stat, cases: out }, null, 1));
const missing = {};
for (const c of noFolder) missing[c['客戶別']] = (missing[c['客戶別']] || 0) + 1;
console.log(JSON.stringify({ ...stat, mbSelected: +(stat.bytes / 1048576).toFixed(0), nasWorksInYear: totalWorks, worksAssignedToSomeCase: claimed, worksNoCase: unclaimedHigh, noFolderClients: missing, out: outFile }, null, 2));

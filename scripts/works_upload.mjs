#!/usr/bin/env node
// 作品牆歷史作品備份：NAS → 1600px JPEG → Apps Script(uploadWorkWallImages) → Drive，並產生作品索引。
// 預設 dry-run（只列出將上傳什麼）。真的上傳要加 --execute。可中斷續跑（manifest 以 dedupeKey 紀錄）。
//
// 用法：
//   node scripts/works_upload.mjs --year 26 [--decisions notes/works-review-decisions-26.json]
//        [--limit-cases 20] [--max-per-work 1] [--execute]
// 納入規則：配對「高信心」整批納入；中／低信心只納入 decisions 裡被勾選的作品。
import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import os from 'node:os';
import { fileURLToPath } from 'node:url';
import { loadConfig, loadSecrets, resolveMountRoot, compressToJpeg, postAppsScriptJsonWithRetry } from './nas_design_image_lib.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const args = process.argv.slice(2);
const opt = (n, f) => { const i = args.indexOf(`--${n}`); return i >= 0 ? args[i + 1] : f; };
const year = opt('year', '26');
const execute = args.includes('--execute');
const limitCases = Number(opt('limit-cases', '0')) || Infinity;
const maxPerWork = Number(opt('max-per-work', '1'));
const decisionsFile = opt('decisions', '');
const root = path.join(here, '..');
const stateDir = path.join(here, 'nas_design_image_watcher.state');
const manifestFile = path.join(stateDir, `works-upload-manifest-${year}.json`);

const config = await loadConfig(path.join(here, 'nas_design_image_watcher.config.json'));
const secrets = await loadSecrets(path.resolve(here, config.secretsFile));
const mountRoot = (await resolveMountRoot(config)) || config.mountRoot;
const match = JSON.parse(await fs.readFile(path.join(root, 'notes', `works-match-${year}.json`), 'utf8'));
const decided = new Set();
if (decisionsFile) for (const a of JSON.parse(await fs.readFile(decisionsFile, 'utf8')).accepted) decided.add(`${a.caseId}|${a.stem}`);
const dbRows = new Map(JSON.parse(await fs.readFile(path.join(root, 'data', 'database_archive.json'), 'utf8')).rows.map((r) => [r['案件編號'], r]));
let manifest = {};
try { manifest = JSON.parse(await fs.readFile(manifestFile, 'utf8')); } catch { /* 第一次執行 */ }

// 選出要備份的作品
const todo = [];
for (const c of match.cases) {
  const works = c.works.filter((w) => c.confidence === 'high' ? w.score >= 0.5 || c.works.length === 1 : decided.has(`${c.caseId}|${w.stem}`));
  if (works.length) todo.push({ ...c, works });
}
const batch = todo.slice(0, limitCases);
const IMG = /\.(jpe?g|png)$/i;
const pickFiles = (w) => w.files.filter((f) => IMG.test(f.p)).sort((a, b) => b.z - a.z).slice(0, maxPerWork);
let nFiles = 0;
for (const c of batch) for (const w of c.works) nFiles += pickFiles(w).length;
console.log(`${execute ? '【執行】' : '【dry-run】'} 納入 ${todo.length} 案，本次處理 ${batch.length} 案、約 ${nFiles} 張（每件作品最多 ${maxPerWork} 張）`);
if (!execute) {
  for (const c of batch.slice(0, 8)) console.log(`  ${c.caseId} ${c.client} ${c.project}: ${c.works.map((w) => pickFiles(w).map((f) => path.basename(f.p)).join(',')).join(' | ')}`);
  console.log('（dry-run 結束；加 --execute 才會上傳）');
  process.exit(0);
}
if (!config.appsScriptUploadUrl || !secrets.serviceKey) throw new Error('缺少 appsScriptUploadUrl 或 serviceKey');
const tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'works-'));
await fs.mkdir(stateDir, { recursive: true });
const saveManifest = () => fs.writeFile(manifestFile, JSON.stringify(manifest));
let done = 0, failed = 0;
for (const c of batch) {
  const row = dbRows.get(c.caseId);
  const yearFull = `20${c.caseId.slice(0, 2)}`;
  const pending = [];
  for (const w of c.works) for (const f of pickFiles(w)) {
    const key = crypto.createHash('sha256').update(`workwall|${c.caseId}|${f.p}|${f.z}`).digest('hex');
    if (manifest[key]) continue;
    const dest = path.join(tmp, `${key}.jpg`);
    const r = compressToJpeg(path.join(mountRoot, f.p), dest, config);
    if (!r.ok) { console.warn(`壓縮失敗略過：${f.p}`); failed++; continue; }
    pending.push({ key, stem: w.stem, name: path.basename(f.p), dest });
  }
  for (let i = 0; i < pending.length; i += 20) {
    const part = pending.slice(i, i + 20);
    const images = [];
    for (const p of part) images.push({ fileName: p.name.replace(/\.[^.]+$/, '') + '.jpg', mimeType: 'image/jpeg', base64: (await fs.readFile(p.dest)).toString('base64'), dedupeKey: p.key });
    try {
      const data = await postAppsScriptJsonWithRetry(config.appsScriptUploadUrl, JSON.stringify({ action: 'uploadWorkWallImages', serviceKey: secrets.serviceKey, caseId: c.caseId, client: row['客戶別'], year: yearFull, images }));
      if (!data.success) throw new Error(data.message || '上傳失敗');
      data.images.forEach((img, k) => { manifest[part[k].key] = { caseId: c.caseId, stem: part[k].stem, name: part[k].name, fileId: img.fileId }; });
      done += part.length;
      await saveManifest();
    } catch (e) { console.warn(`案件 ${c.caseId} 上傳失敗：${e.message}`); failed += part.length; }
    await Promise.all(part.map((p) => fs.rm(p.dest, { force: true })));
  }
}
await fs.rm(tmp, { recursive: true, force: true });

// 作品索引：data/works/20YY.json（前端作品牆讀這份；縮圖＝網址結尾 =w400）
const byCase = {};
for (const v of Object.values(manifest)) (byCase[v.caseId] ||= []).push({ id: v.fileId, name: v.name });
const items = Object.entries(byCase).map(([id, imgs]) => { const r = dbRows.get(id); return { caseId: id, client: r['客戶別'], project: r['專案名稱'], type: r['設計種類'], designer: r['設計負責人'], start: r['開始日期'], imgs }; }).sort((a, b) => a.caseId.localeCompare(b.caseId));
await fs.mkdir(path.join(root, 'data', 'works'), { recursive: true });
await fs.writeFile(path.join(root, 'data', 'works', `20${year}.json`), JSON.stringify({ year: 2000 + +year, generatedAt: new Date().toISOString(), imageUrl: 'https://lh3.googleusercontent.com/d/{id}=w{size}', items }));
console.log(`完成：上傳 ${done} 張、失敗/略過 ${failed}、索引 ${items.length} 案 → data/works/20${year}.json`);

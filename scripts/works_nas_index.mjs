#!/usr/bin/env node
// 作品牆階段 0：把 NAS 專案資料夾裡的圖檔清單快取成本機 JSON（唯讀，不複製、不上傳）。
// 用法：node scripts/works_nas_index.mjs [--mount /Volumes/設計部] [--concurrency 8]
// 產出：scripts/nas_design_image_watcher.state/works-nas-index.json（已在 .gitignore）
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const args = process.argv.slice(2);
const opt = (name, fallback) => { const i = args.indexOf(`--${name}`); return i >= 0 ? args[i + 1] : fallback; };
const mountRoot = opt('mount', '/Volumes/設計部');
const concurrency = Number(opt('concurrency', '8'));
const outFile = opt('out', path.join(here, 'nas_design_image_watcher.state', 'works-nas-index.json'));
const roots = ['專案企劃部/執行中', '專案企劃部/已結案'];
const IMG = new Set(['.jpg', '.jpeg', '.png']);
const SKIP_DIRS = /^(links?|font|logos?)$/i;
const MAX_DEPTH = 8;

const files = [];
const clients = {};
let dirs = 0;
let errors = 0;
const queue = [];
let active = 0;

function push(dir, depth, client, rootLabel) { queue.push({ dir, depth, client, rootLabel }); }

async function work(job) {
  let ents;
  try { ents = await fs.readdir(job.dir, { withFileTypes: true }); } catch { errors++; return; }
  dirs++;
  for (const e of ents) {
    if (e.name.startsWith('.')) continue;
    const full = path.join(job.dir, e.name);
    if (e.isDirectory()) {
      if (job.depth < MAX_DEPTH && !SKIP_DIRS.test(e.name)) push(full, job.depth + 1, job.client, job.rootLabel);
    } else if (IMG.has(path.extname(e.name).toLowerCase())) {
      const st = await fs.stat(full).catch(() => null);
      files.push({ c: job.client, s: job.rootLabel, p: path.relative(mountRoot, full), n: e.name, z: st?.size || 0, m: st ? Math.round(st.mtimeMs) : 0 });
      clients[job.client].files++;
    }
  }
}

const t0 = Date.now();
for (const r of roots) {
  const label = r.split('/').pop();
  let names = [];
  try { names = await fs.readdir(path.join(mountRoot, r), { withFileTypes: true }); } catch { console.error(`讀不到 ${r}（NAS 沒掛載？）`); continue; }
  for (const n of names) {
    if (!n.isDirectory() || n.name.startsWith('.')) continue;
    clients[n.name] = clients[n.name] || { status: label, files: 0 };
    push(path.join(mountRoot, r, n.name), 0, n.name, label);
  }
}
if (!queue.length) { console.error('沒有任何客戶資料夾，停止。'); process.exit(1); }

await new Promise((resolve) => {
  const tick = () => {
    while (active < concurrency && queue.length) {
      const job = queue.shift();
      active++;
      work(job).finally(() => { active--; tick(); });
    }
    if (!active && !queue.length) resolve();
  };
  setInterval(() => process.stderr.write(`\r已走訪 ${dirs} 個資料夾、${files.length} 張圖…`), 3000).unref();
  tick();
});

await fs.mkdir(path.dirname(outFile), { recursive: true });
await fs.writeFile(outFile, JSON.stringify({ generatedAt: new Date().toISOString(), mountRoot, dirs, errors, clients, files }));
console.log(`\n完成：${Object.keys(clients).length} 個客戶資料夾、${dirs} 個目錄、${files.length} 張圖、讀取錯誤 ${errors}、${((Date.now() - t0) / 1000).toFixed(0)} 秒\n輸出：${outFile}`);

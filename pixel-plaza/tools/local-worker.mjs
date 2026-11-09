// 本機算圖工作者：常駐在 Machi 的 iMac。每 20 秒向角色工坊（emc-ai-stage-classifier）打心跳並領單，
//   grid：8 個角度（4×2 合圖）→ 用 Codex 內建畫圖，去背後上傳；  walk：走路／跑步影格 → 呼叫 walk-make（WALK_OUT_DIR 模式）後上傳。
// 沒開機時角色工坊偵測不到心跳，會自動退回 API 算圖（grid）／讓走路影格排隊等開機。
// 金鑰存在 ~/.emc-local-worker/key（600 權限，不進 Git）；與 Worker 的 LOCAL_WORKER_KEY 秘密相同。
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn, spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const BASE = process.env.STUDIO_BASE || 'https://emc-ai-stage-classifier.machi-chen.workers.dev';
const KEY = fs.readFileSync(path.join(os.homedir(), '.emc-local-worker', 'key'), 'utf8').trim();
const WORK = process.env.WALK_JOBS || path.join(os.tmpdir(), 'local-worker-jobs');
const CODEX_TIMEOUT = 25 * 60 * 1000;
const log = (...a) => console.log(new Date().toISOString(), ...a);

async function api(p, opts = {}) {
  const r = await fetch(BASE + p, { ...opts, headers: { 'x-worker-key': KEY, ...(opts.headers || {}) }, signal: AbortSignal.timeout(60000) });
  return r;
}
const json = (p, body) => api(p, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
const progress = (t, step, pct, note = '') => json('/api/local-worker/progress', { kind: t.kind, id: t.id, step, pct, note }).catch(() => {});
const fail = (t, error) => json('/api/local-worker/progress', { kind: t.kind, id: t.id, failed: true, error }).catch(() => {});

/** Codex 在背景跑時，每 15 秒依預估時間推進一次進度，讓前端的進度軸會動。 */
function ramp(t, step, from, to, estSec) {
  const t0 = Date.now();
  const timer = setInterval(() => {
    const f = Math.min(0.97, (Date.now() - t0) / 1000 / estSec);
    progress(t, step, from + (to - from) * f);
  }, 15000);
  return () => clearInterval(timer);
}
function runCodex(args, input, cwd) {
  return new Promise((resolve) => {
    const p = spawn('codex', args, { cwd, shell: true });
    let out = ''; p.stdout.on('data', (d) => { out += d; }); p.stderr.on('data', (d) => { out += d; });
    const to = setTimeout(() => p.kill('SIGKILL'), CODEX_TIMEOUT);
    p.on('close', (code) => { clearTimeout(to); resolve({ code, out }); });
    p.stdin.end(input);
  });
}

async function doGrid(t, prompt) {
  const dir = path.join(WORK, `grid-${t.id}-${Date.now()}`); fs.mkdirSync(dir, { recursive: true });
  await progress(t, '下載三視圖素材', 5);
  for (const [kind, file] of [['sheet', 'sheet.png'], ['reference', 'reference.png']]) {
    const r = await api(`/api/local-worker/asset?kind=${kind}&job=${t.id}`);
    if (!r.ok) throw new Error(`下載 ${kind} 失敗 ${r.status}`);
    fs.writeFileSync(path.join(dir, file), Buffer.from(await r.arrayBuffer()));
  }
  const OUT = path.join(dir, 'grid_raw.png');
  const full = [
    'Use your image generation tool. The attached images are: sheet.png = a CHARACTER SHEET (front / right side / back of ONE chibi game character) and reference.png = a STYLE REFERENCE strip of another character (copy only its style and proportions, NOT the character).',
    prompt,
    `Output: ONE image, exactly 1536x1024 landscape, saved as ${OUT} (copy/move the generated image there).`,
    'Background: a flat pure magenta #FF00FF background everywhere around and between the figures (no gradients, no shadows, no ground, no text, no grid lines). Exactly 8 full figures with clear gaps between them, none touching the image edge.',
  ].join('\n\n');
  await progress(t, '8 個角度生成中（Codex）', 10);
  const stop = ramp(t, '8 個角度生成中（Codex）', 10, 80, 240);
  const cx = await runCodex(['exec', '-i', path.join(dir, 'sheet.png'), '-i', path.join(dir, 'reference.png'), '--skip-git-repo-check', '-s', 'workspace-write', '-C', dir, '-'], full, dir);
  stop();
  fs.writeFileSync(path.join(dir, 'codex.log'), cx.out);
  if (!fs.existsSync(OUT)) throw new Error('Codex 沒有產出圖片');
  await progress(t, '去背與檢查', 85);
  const GRID = path.join(dir, 'grid.png');
  const py = spawnSync('python3', [path.join(HERE, 'chroma.py'), OUT, GRID], { encoding: 'utf8' });
  if (py.status !== 0) throw new Error('合圖檢查沒過：' + (py.stdout || py.stderr || '').trim().slice(0, 120));
  await progress(t, '上傳成品', 95);
  const form = new FormData(); form.set('kind', 'grid'); form.set('id', t.id); form.set('grid', new Blob([fs.readFileSync(GRID)], { type: 'image/png' }), 'grid.png');
  const up = await api('/api/local-worker/result', { method: 'POST', body: form });
  if (!up.ok) throw new Error('上傳失敗 ' + up.status);
}

async function doWalk(t) {
  const dir = path.join(WORK, `walkout-${t.id}-${Date.now()}`); fs.mkdirSync(dir, { recursive: true });
  await progress(t, '下載站姿圖集', 5);
  const est = 420;
  const stop = ramp(t, '走路／跑步影格生成中（Codex）', 10, 80, est);
  await progress(t, '走路／跑步影格生成中（Codex）', 10);
  const res = await new Promise((resolve) => {
    const p = spawn(process.execPath, [path.join(HERE, 'walk-make.mjs'), t.name, String(t.version)], { env: { ...process.env, WALK_OUT_DIR: dir, WALK_JOBS: WORK } });
    let out = ''; p.stdout.on('data', (d) => { out += d; }); p.stderr.on('data', (d) => { out += d; });
    p.on('close', (code) => resolve({ code, out }));
  });
  stop();
  if (res.code !== 0) throw new Error(`走路影格製作失敗（代碼 ${res.code}）：${res.out.trim().split('\n').pop()?.slice(0, 100)}`);
  await progress(t, '上傳成品', 95);
  const form = new FormData(); form.set('kind', 'walk'); form.set('id', t.id);
  form.set('hd', new Blob([fs.readFileSync(path.join(dir, 'walk-hd.png'))], { type: 'image/png' }), 'walk-hd.png');
  form.set('lo', new Blob([fs.readFileSync(path.join(dir, 'walk.png'))], { type: 'image/png' }), 'walk.png');
  const up = await api('/api/local-worker/result', { method: 'POST', body: form });
  if (!up.ok) throw new Error('上傳失敗 ' + up.status);
}

async function loop() {
  log('local-worker started', BASE);
  for (;;) {
    try {
      const r = await json('/api/local-worker/claim', {});
      if (!r.ok) throw new Error('claim ' + r.status);
      const { task, prompt } = await r.json();
      if (task) {
        log('task', task.kind, task.id, task.name || '');
        try { await (task.kind === 'grid' ? doGrid(task, prompt) : doWalk(task)); log('done', task.kind, task.id); }
        catch (e) { log('failed', task.kind, task.id, String(e.message || e)); await fail(task, String(e.message || e)); }
        continue;   // 做完馬上看有沒有下一張
      }
    } catch (e) { log('poll error', String(e.message || e)); }
    await new Promise((r) => setTimeout(r, 20000));
  }
}
loop();

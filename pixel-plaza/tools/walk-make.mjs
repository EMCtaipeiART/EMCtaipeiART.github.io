// 用法：node walk-make.mjs <人物名> <雲端版本>
// 流程：下載雲端站姿圖集 → Codex 畫 7x2 走路表 → 瀏覽器去背/對位成 12 視角 → 寫入 sprites-walk*/ 並更新 walk-manifest.json
// 失敗（Codex 沒出圖、格子空白、比例異常）會以非 0 結束，不改任何檔案。
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { PLAZA, API, MANIFEST, readManifest } from './walk-lib.mjs';

const [name, version] = process.argv.slice(2);
if (!name || !version) { console.error('usage: node walk-make.mjs <name> <version>'); process.exit(2); }
const require = createRequire('C:/emc-site/package.json');
const puppeteer = require('puppeteer-core');
const job = `D:/codex-sui/jobs/job-${Date.now()}`;
fs.mkdirSync(`${job}/out`, { recursive: true });
const REF = `${job}/ref_stand_12angles.png`, SHEET = `${job}/out/walk_7x2.png`;

// 1) 下載站姿圖集（自家角色工坊的公開圖）
const res = await fetch(`${API}/${encodeURIComponent(name)}/atlas-hd.png?v=${version}`, { signal: AbortSignal.timeout(60000) });
if (!res.ok) { console.error('download failed', res.status); process.exit(3); }
fs.writeFileSync(REF, Buffer.from(await res.arrayBuffer()));
const hdr = fs.readFileSync(REF);
const W0 = hdr.readUInt32BE(16), H0 = hdr.readUInt32BE(20);
if (W0 !== 240 * 12 || H0 !== 240) { console.error(`unexpected stand atlas size ${W0}x${H0}`); process.exit(3); }

// 2) Codex 畫走路表（沿用先前驗證過的提示詞）
const prompt = [
  'Use your image generation tool to draw a walking-pose sprite sheet for the chibi game character shown in the attached reference image (ref_stand_12angles.png, a row of 12 standing views, every 30 degrees, view 0 = front, view 3 = facing the viewer\'s right side, view 6 = back, view 9 = facing the viewer\'s left side).',
  '',
  `Output: ONE image saved as ${SHEET} (copy/move the generated image there).`,
  'Layout: 7 columns x 2 rows of equal square cells. Columns = the first 7 reference views in order (front 0, 30, 60, 90 = right side, 120, 150, back 180). Row 1 = walking pose A (the viewer-left foot steps forward, opposite arm swings forward). Row 2 = walking pose B (the other foot forward, mirrored swing).',
  'Rules: keep the character design, outfit, colors, outline style, head size and proportions IDENTICAL to the reference; only the legs, feet and arm swing change. Same character scale and the same ground line (feet baseline) in every cell, character centered, nothing cropped. Flat pure magenta background (#FF00FF) in every cell, no shadows, no text, no grid lines, no labels.',
  '',
].join('\n');
const cx = spawnSync('codex', ['exec', '-i', REF, '--skip-git-repo-check', '-s', 'workspace-write', '-C', job, '-'], { input: prompt, shell: true, encoding: 'utf8', timeout: 25 * 60 * 1000 });
fs.writeFileSync(`${job}/codex.log`, (cx.stdout || '') + (cx.stderr || ''));
if (!fs.existsSync(SHEET)) { console.error('codex produced no sheet; see ' + job + '/codex.log'); process.exit(4); }

// 3) 去洋紅背景、依站姿高度/腳底/中心對位成 240x240，補鏡像成 12 視角
const browser = await puppeteer.launch({ executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe', headless: 'new', args: ['--no-sandbox'] });
const page = await browser.newPage();
const b64 = f => 'data:image/png;base64,' + fs.readFileSync(f).toString('base64');
const out = await page.evaluate(async (w64, s64) => {
  const load = async s => { const i = new Image(); i.src = s; await i.decode(); return i; };
  const W = await load(w64), S = await load(s64), CW = 240;
  const full = document.createElement('canvas'); full.width = W.width; full.height = W.height;
  const fx = full.getContext('2d', { willReadFrequently: true }); fx.drawImage(W, 0, 0);
  const im = fx.getImageData(0, 0, W.width, W.height), d = im.data;
  for (let i = 0; i < d.length; i += 4) {
    const r = d[i], g = d[i + 1], bl = d[i + 2];
    const dist = Math.abs(r - 255) + g + Math.abs(bl - 255);
    const a = Math.max(0, Math.min(1, (dist - 90) / 150));
    if (a < 0.03) { d[i + 3] = 0; continue; }
    if (a < 1) { d[i] = Math.max(0, Math.min(255, (r - (1 - a) * 255) / a)); d[i + 1] = Math.max(0, Math.min(255, g / a)); d[i + 2] = Math.max(0, Math.min(255, (bl - (1 - a) * 255) / a)); }
    d[i + 3] = Math.round(a * 255);
  }
  fx.putImageData(im, 0, 0);
  const bboxOf = (ctx, x0, y0, w, h) => {
    const dd = ctx.getImageData(x0, y0, w, h).data; let a = w, c = 0, e = h, f = 0, n = 0;
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) if (dd[(y * w + x) * 4 + 3] > 40) { n++; if (x < a) a = x; if (x > c) c = x; if (y < e) e = y; if (y > f) f = y; }
    return { minX: a, maxX: c, minY: e, maxY: f, n };
  };
  const sc = document.createElement('canvas'); sc.width = S.width; sc.height = S.height;
  const sx = sc.getContext('2d', { willReadFrequently: true }); sx.drawImage(S, 0, 0);
  const cw = W.width / 7, ch = W.height / 2, cells = [[], []], problems = [];
  for (let row = 0; row < 2; row++) for (let i = 0; i < 7; i++) {
    const sb = bboxOf(sx, i * CW, 0, CW, CW), wb = bboxOf(fx, Math.round(i * cw), Math.round(row * ch), Math.round(cw), Math.round(ch));
    if (wb.n < 400 || wb.maxY <= wb.minY || sb.maxY <= sb.minY) { problems.push(`cell ${row},${i} empty`); continue; }
    const k = (sb.maxY - sb.minY) / (wb.maxY - wb.minY);
    if (k < 0.35 || k > 2.5) problems.push(`cell ${row},${i} scale ${k.toFixed(2)}`);
    const c = document.createElement('canvas'); c.width = c.height = CW;
    const cx2 = c.getContext('2d'); cx2.imageSmoothingQuality = 'high';
    const dw = Math.round(cw) * k, dh = Math.round(ch) * k, dx = (sb.minX + sb.maxX) / 2 - ((wb.minX + wb.maxX) / 2) * k, dy = sb.maxY - wb.maxY * k;
    cx2.drawImage(full, Math.round(i * cw), Math.round(row * ch), Math.round(cw), Math.round(ch), dx, dy, dw, dh);
    cells[row][i] = c;
  }
  if (problems.length) return { problems };
  const o = document.createElement('canvas'); o.width = CW * 12; o.height = CW * 2;
  const ox = o.getContext('2d');
  for (let row = 0; row < 2; row++) for (let i = 0; i < 12; i++) {
    if (i <= 6) ox.drawImage(cells[row][i], i * CW, row * CW);
    else { const src = cells[1 - row][12 - i]; ox.save(); ox.translate(i * CW + CW, row * CW); ox.scale(-1, 1); ox.drawImage(src, 0, 0); ox.restore(); }
  }
  const sm = document.createElement('canvas'); sm.width = 720; sm.height = 120;
  const smx = sm.getContext('2d'); smx.imageSmoothingQuality = 'high'; smx.drawImage(o, 0, 0, 720, 120);
  return { problems, hd: o.toDataURL('image/png').split(',')[1], hdw: o.toDataURL('image/webp', 0.85).split(',')[1], lo: sm.toDataURL('image/png').split(',')[1] };
}, b64(SHEET), b64(REF));
await browser.close();
if (out.problems.length) { console.error('sanity failed: ' + out.problems.join('; ')); process.exit(5); }

// 4) 寫入成品與 manifest；預覽圖留在工作資料夾給人/Claude 目視檢查
fs.writeFileSync(`${job}/preview.png`, Buffer.from(out.hd, 'base64'));
fs.writeFileSync(path.join(PLAZA, 'sprites-walk-hd', name + '.png'), Buffer.from(out.hd, 'base64'));
fs.writeFileSync(path.join(PLAZA, 'sprites-walk-hd', name + '.webp'), Buffer.from(out.hdw, 'base64'));
fs.writeFileSync(path.join(PLAZA, 'sprites-walk', name + '.png'), Buffer.from(out.lo, 'base64'));
const m = readManifest();
m[name] = Number(version) || version;
fs.writeFileSync(MANIFEST, JSON.stringify(m) + '\n');
console.log(JSON.stringify({ ok: true, name, version, preview: `${job}/preview.png` }));

// 開發工具：把 Codex 畫的素材圖（洋紅底、格狀排列）後處理成遊戲可用的素材。
//   node tools/process-art.mjs <原圖.png> <規格.json> <輸出資料夾>
// 步驟：去洋紅底（含邊緣雜色）→ 每格依 down 倍數縮小（區塊眾數，保持銳利）→ 吸附到有限色盤 → 去掉孤立雜點
//       → 裁成各自的小圖 → 緊密排成一張圖集（PNG＋JSON）→ 產生審稿用的預覽圖（放大、淺色與深色底、標名稱）。
// 這支工具不改任何原素材；輸出只放在你指定的資料夾，通過審稿後才會複製進 dist/minigames/assets/。
import puppeteer from 'puppeteer-core';
import fs from 'node:fs';
import path from 'node:path';

const [rawPath, specPath, outDir] = process.argv.slice(2);
if (!rawPath || !specPath || !outDir) throw new Error('用法：node tools/process-art.mjs <原圖.png> <規格.json> <輸出資料夾>');
const spec = JSON.parse(fs.readFileSync(specPath, 'utf8'));
fs.mkdirSync(outDir, { recursive: true });
const chrome = ['C:/Program Files/Google/Chrome/Application/chrome.exe', 'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe'].find(p => fs.existsSync(p));
const browser = await puppeteer.launch({ executablePath: chrome, headless: true, args: ['--no-sandbox'] });
const page = await browser.newPage();
await page.setContent('<canvas id=c></canvas>');
const b64 = fs.readFileSync(rawPath).toString('base64');

const result = await page.evaluate(async (b64, spec) => {
  const img = new Image(); img.src = 'data:image/png;base64,' + b64; await img.decode();
  const W = img.naturalWidth, H = img.naturalHeight;
  const src = document.createElement('canvas'); src.width = W; src.height = H;
  const sg = src.getContext('2d', { willReadFrequently: true }); sg.drawImage(img, 0, 0);
  const px = sg.getImageData(0, 0, W, H).data;
  const key = spec.key || { tol: 110, greenGap: 70 };
  const isBg = i => { const r = px[i], g = px[i + 1], b = px[i + 2]; return Math.hypot(r - 255, g, b - 255) < key.tol || g < Math.min(r, b) - key.greenGap; };
  const { cols, rows, cell, down } = spec, out = Math.floor(cell / down);
  if (spec.mode === 'soft') {
    // 保持原解析度：只去洋紅底（邊緣依距離做半透明並還原被洋紅染到的顏色），不縮小、不吸附色盤
    const sprites = [];
    for (let n = 0; n < spec.names.length; n++) {
      const name = spec.names[n]; if (!name || name === 'empty') continue;
      const cx = (n % cols) * cell, cy = Math.floor(n / cols) * cell, cv = document.createElement('canvas'); cv.width = cell; cv.height = cell;
      const cg = cv.getContext('2d'), id = cg.createImageData(cell, cell);
      let x0 = 1e9, y0 = 1e9, x1 = -1, y1 = -1;
      for (let y = 0; y < cell; y++) for (let x = 0; x < cell; x++) {
        const i = ((cy + y) * W + cx + x) * 4, o = (y * cell + x) * 4, r = px[i], g = px[i + 1], b = px[i + 2];
        const d = Math.hypot(r - 255, g, b - 255), gap = Math.min(r, b) - g;
        let a = Math.max(0, Math.min(1, (Math.min(d, 255 - 0 + 0) - (key.tol - 40)) / 80));
        if (gap > key.greenGap) a = Math.min(a, Math.max(0, 1 - (gap - key.greenGap) / 60));
        if (a < 0.08) continue;
        // 還原：c = a*fg + (1-a)*magenta
        const fr = Math.max(0, Math.min(255, (r - (1 - a) * 255) / a)), fg2 = Math.max(0, Math.min(255, g / a)), fb = Math.max(0, Math.min(255, (b - (1 - a) * 255) / a));
        id.data[o] = fr; id.data[o + 1] = fg2; id.data[o + 2] = fb; id.data[o + 3] = Math.round(a * 255);
        x0 = Math.min(x0, x); y0 = Math.min(y0, y); x1 = Math.max(x1, x); y1 = Math.max(y1, y);
      }
      cg.putImageData(id, 0, 0);
      sprites.push({ name, cv, x0, y0, w: x1 - x0 + 1, h: y1 - y0 + 1 });
    }
    const atlasW = spec.atlasW || 1024, gap = 2; let x = 0, y = 0, rowH = 0;
    for (const s of sprites) { if (x + s.w > atlasW) { x = 0; y += rowH + gap; rowH = 0; } s.x = x; s.y = y; x += s.w + gap; rowH = Math.max(rowH, s.h); }
    const aw = atlasW, ah = y + rowH, atlas = document.createElement('canvas'); atlas.width = aw; atlas.height = ah; const ag = atlas.getContext('2d');
    for (const s of sprites) ag.drawImage(s.cv, s.x0, s.y0, s.w, s.h, s.x, s.y, s.w, s.h);
    const sc = spec.previewScale || 1, pad = 10, lab = 16, cw = Math.max(...sprites.map(s => s.w)) * sc + pad * 2, chh = Math.max(...sprites.map(s => s.h)) * sc + pad * 2 + lab;
    const pc = 6, pr = Math.ceil(sprites.length / pc), prev = document.createElement('canvas'); prev.width = pc * cw; prev.height = pr * chh; const pg = prev.getContext('2d');
    sprites.forEach((s, i) => { const ox = (i % pc) * cw, oy = Math.floor(i / pc) * chh; pg.fillStyle = i % 2 ? '#2b3447' : '#ffffff'; pg.fillRect(ox + 2, oy + 2, cw - 4, chh - 4); pg.drawImage(atlas, s.x, s.y, s.w, s.h, ox + pad, oy + pad, s.w * sc, s.h * sc); pg.fillStyle = i % 2 ? '#fff' : '#182e54'; pg.font = '12px sans-serif'; pg.fillText(s.name + ' ' + s.w + '×' + s.h, ox + pad, oy + chh - 6); });
    return { atlas: atlas.toDataURL('image/png'), preview: prev.toDataURL('image/png'), meta: sprites.map(({ name, x, y, w, h }) => ({ name, x, y, w, h })), aw, ah, colors: -1 };
  }
  const sprites = [];
  for (let n = 0; n < spec.names.length; n++) {
    const name = spec.names[n]; if (!name || name === 'empty') continue;
    const cx = (n % cols) * cell, cy = Math.floor(n / cols) * cell;
    // 縮小：每個 down×down 區塊取眾數顏色（先量化到 5 bit 再統計），多數是背景就透明
    const grid = new Array(out * out).fill(null);
    for (let oy = 0; oy < out; oy++) for (let ox = 0; ox < out; ox++) {
      const votes = new Map(); let bg = 0, total = 0;
      for (let dy = 0; dy < down; dy++) for (let dx = 0; dx < down; dx++) {
        const i = ((cy + oy * down + dy) * W + (cx + ox * down + dx)) * 4; total++;
        if (isBg(i)) { bg++; continue; }
        const k = ((px[i] >> 3) << 10) | ((px[i + 1] >> 3) << 5) | (px[i + 2] >> 3);
        const v = votes.get(k) || { n: 0, r: 0, g: 0, b: 0 }; v.n++; v.r += px[i]; v.g += px[i + 1]; v.b += px[i + 2]; votes.set(k, v);
      }
      if (bg * 2 >= total || !votes.size) continue;
      let best = null; for (const v of votes.values()) if (!best || v.n > best.n) best = v;
      grid[oy * out + ox] = [Math.round(best.r / best.n), Math.round(best.g / best.n), Math.round(best.b / best.n)];
    }
    sprites.push({ name, grid, out });
  }
  // 吸附色盤：統計全圖顏色，頻率高的當色盤，其餘（距離 < snap）併到最近的色盤色
  const hist = new Map(); const kk = c => c.join(',');
  for (const s of sprites) for (const c of s.grid) if (c) hist.set(kk(c), (hist.get(kk(c)) || 0) + 1);
  const ranked = [...hist.entries()].sort((a, b) => b[1] - a[1]).map(([k]) => k.split(',').map(Number));
  const palette = [];
  for (const c of ranked) if (palette.length < (spec.maxColors || 48) && !palette.some(p => Math.hypot(p[0] - c[0], p[1] - c[1], p[2] - c[2]) < (spec.snap || 34))) palette.push(c);
  const near = c => { let bi = 0, bd = 1e9; palette.forEach((p, i) => { const d = Math.hypot(p[0] - c[0], p[1] - c[1], p[2] - c[2]); if (d < bd) { bd = d; bi = i; } }); return palette[bi]; };
  for (const s of sprites) { s.grid = s.grid.map(c => (c ? near(c) : null)); }
  // 去孤立雜點（四周都是透明的單一像素）
  for (const s of sprites) { const o = s.out; for (let y = 0; y < o; y++) for (let x = 0; x < o; x++) { if (!s.grid[y * o + x]) continue; let nb = 0; for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) { const xx = x + dx, yy = y + dy; if (xx >= 0 && yy >= 0 && xx < o && yy < o && s.grid[yy * o + xx]) nb++; } if (!nb) s.grid[y * o + x] = null; } }
  // 裁切
  for (const s of sprites) {
    let x0 = 1e9, y0 = 1e9, x1 = -1, y1 = -1; const o = s.out;
    for (let y = 0; y < o; y++) for (let x = 0; x < o; x++) if (s.grid[y * o + x]) { x0 = Math.min(x0, x); y0 = Math.min(y0, y); x1 = Math.max(x1, x); y1 = Math.max(y1, y); }
    s.w = x1 - x0 + 1; s.h = y1 - y0 + 1; s.px = [];
    for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) s.px.push(s.grid[y * o + x]);
    delete s.grid;
  }
  // 圖集：依高度排成數列，寬度上限 atlasW
  const atlasW = spec.atlasW || 256, gap = 1; let x = 0, y = 0, rowH = 0;
  for (const s of sprites) { if (x + s.w > atlasW) { x = 0; y += rowH + gap; rowH = 0; } s.x = x; s.y = y; x += s.w + gap; rowH = Math.max(rowH, s.h); }
  const aw = atlasW, ah = y + rowH;
  const atlas = document.createElement('canvas'); atlas.width = aw; atlas.height = ah; const ag = atlas.getContext('2d');
  const id = ag.createImageData(aw, ah);
  for (const s of sprites) s.px.forEach((c, i) => { if (!c) return; const sx = s.x + (i % s.w), sy = s.y + Math.floor(i / s.w), o = (sy * aw + sx) * 4; id.data[o] = c[0]; id.data[o + 1] = c[1]; id.data[o + 2] = c[2]; id.data[o + 3] = 255; });
  ag.putImageData(id, 0, 0);
  // 審稿預覽：每張放大 scale 倍，左半淺色底、右半深色底，標名稱
  const scale = spec.previewScale || 4, pad = 10, lab = 16;
  const cellW = Math.max(...sprites.map(s => s.w)) * scale + pad * 2, cellH = Math.max(...sprites.map(s => s.h)) * scale + pad * 2 + lab;
  const pc = Math.ceil(Math.sqrt(sprites.length * (cellH / cellW)) * 1.6), pr = Math.ceil(sprites.length / pc);
  const prev = document.createElement('canvas'); prev.width = pc * cellW; prev.height = pr * cellH; const pg = prev.getContext('2d');
  pg.fillStyle = '#f2f4f8'; pg.fillRect(0, 0, prev.width, prev.height);
  sprites.forEach((s, i) => {
    const ox = (i % pc) * cellW, oy = Math.floor(i / pc) * cellH;
    pg.fillStyle = i % 2 ? '#2b3447' : '#ffffff'; pg.fillRect(ox + 2, oy + 2, cellW - 4, cellH - 4);
    pg.imageSmoothingEnabled = false; pg.drawImage(atlas, s.x, s.y, s.w, s.h, ox + pad, oy + pad, s.w * scale, s.h * scale);
    pg.fillStyle = i % 2 ? '#fff' : '#182e54'; pg.font = '12px sans-serif'; pg.fillText(s.name + ' ' + s.w + '×' + s.h, ox + pad, oy + cellH - 6);
  });
  return { atlas: atlas.toDataURL('image/png'), preview: prev.toDataURL('image/png'), meta: sprites.map(({ name, x, y, w, h }) => ({ name, x, y, w, h })), aw, ah, colors: palette.length };
}, b64, spec);

const base = path.basename(rawPath).replace(/\.png$/, '');
fs.writeFileSync(path.join(outDir, base + '.atlas.png'), Buffer.from(result.atlas.split(',')[1], 'base64'));
fs.writeFileSync(path.join(outDir, base + '.preview.png'), Buffer.from(result.preview.split(',')[1], 'base64'));
const sprites = Object.fromEntries(result.meta.map(m => [m.name, { x: m.x, y: m.y, w: m.w, h: m.h }]));
fs.writeFileSync(path.join(outDir, base + '.json'), JSON.stringify({ image: base + '.atlas.png', width: result.aw, height: result.ah, scaleNote: '每個像素＝原圖 ' + spec.down + '×' + spec.down + ' 區塊', sprites }, null, 1));
console.log(base, '圖集', result.aw + '×' + result.ah, '色數', result.colors, '素材', result.meta.length);
await browser.close();

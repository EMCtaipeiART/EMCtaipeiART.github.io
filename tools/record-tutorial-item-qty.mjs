// 把 tutorial/item-qty.html 錄成影片 tutorial/item-qty.webm（不需要 ffmpeg）。
// 做法：逐格步進教學頁的時間軸並截圖，再在 Chrome 裡用 MediaRecorder 依 15 fps 即時重播成 WebM。
// 用法：node tools/record-tutorial-item-qty.mjs   （需要 puppeteer-core 與本機 Chrome）
import puppeteer from 'puppeteer-core';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const CHROME = process.env.CHROME_PATH || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const FPS = 15, STEP = 1000 / FPS;
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'tut-'));
const voiceRun = spawnSync('node', [path.join(root, 'tools', 'tutorial-item-qty-voice.mjs'), tmp], { encoding: 'utf8' });
if (voiceRun.status !== 0) throw new Error('旁白產生失敗：' + voiceRun.stderr);
const voice = JSON.parse(fs.readFileSync(path.join(root, 'tutorial', 'item-qty-voice.json'), 'utf8'));
const types = { '.css': 'text/css', '.html': 'text/html;charset=utf-8', '.jpg': 'image/jpeg', '.js': 'text/javascript', '.wav': 'audio/wav' };
const srv = http.createServer((q, r) => {
  const u = decodeURIComponent(q.url.split('?')[0]);
  const f = u.startsWith('/frames/') ? path.join(tmp, u.slice(8)) : path.join(root, u);
  fs.readFile(f, (e, d) => { if (e) { r.writeHead(404); r.end(); return; } r.writeHead(200, { 'Content-Type': types[path.extname(f)] || 'application/octet-stream' }); r.end(d); });
}).listen(0);
const port = srv.address().port;
const br = await puppeteer.launch({ executablePath: CHROME, headless: 'new', args: ['--autoplay-policy=no-user-gesture-required'] });
try {
  const pg = await br.newPage();
  await pg.setViewport({ width: 1280, height: 720 });
  await pg.goto(`http://localhost:${port}/tutorial/item-qty.html?manual&record`);
  const end = await pg.evaluate(() => window.__end);
  let n = 0;
  for (let t = 0; t <= end + 1500; t += STEP) {
    await pg.evaluate(ms => window.__tick(ms), STEP);
    await pg.screenshot({ path: path.join(tmp, `f${String(n).padStart(5, '0')}.jpg`), type: 'jpeg', quality: 82 });
    n++;
  }
  console.log('frames', n);
  const rp = await br.newPage();
  await rp.goto(`http://localhost:${port}/tutorial/item-qty.html?manual&record`);
  await rp.setViewport({ width: 1280, height: 720 });
  const b64 = await rp.evaluate(async (count, fps, base, narration) => {
    document.body.innerHTML = '<canvas id="c" width="1280" height="720"></canvas>';
    const cv = document.getElementById('c'), cx = cv.getContext('2d');
    const total = count / fps + 1;
    // ---- 聲音：旁白＋背景音樂，先用 OfflineAudioContext 混成一段，再跟畫面同時播放 ----
    const SR = 44100, off = new OfflineAudioContext(2, Math.ceil(SR * total), SR);
    const master = off.createGain(); master.gain.value = 1; master.connect(off.destination);
    // 旁白
    const vg = off.createGain(); vg.gain.value = 1.0; vg.connect(master);
    const dec = new AudioContext();
    for (let i = 0; i < narration.length; i++) {
      const ab = await (await fetch(`${base}/frames/v${i}.wav`)).arrayBuffer();
      const buf = await dec.decodeAudioData(ab);
      const src = off.createBufferSource(); src.buffer = buf; src.connect(vg); src.start(narration[i].start / 1000 + 0.05);
    }
    // 背景音樂：C–Am–F–G 慢速和弦＋五聲音階的輕柔音，音量很小；開頭淡入、結尾淡出
    const mg = off.createGain(); mg.connect(master);
    mg.gain.setValueAtTime(0.0001, 0); mg.gain.linearRampToValueAtTime(0.06, 3); mg.gain.setValueAtTime(0.06, total - 4); mg.gain.linearRampToValueAtTime(0.0001, total - 0.2);
    const hz = n => 440 * Math.pow(2, (n - 69) / 12);
    const chords = [[48, 55, 64, 67], [45, 52, 60, 64], [41, 48, 57, 60], [43, 50, 59, 62]];
    const beat = 60 / 76, bar = beat * 4;
    const tone = (n, t0, dur, type, vol) => {
      const o = off.createOscillator(), g = off.createGain();
      o.type = type; o.frequency.value = hz(n);
      g.gain.setValueAtTime(0.0001, t0); g.gain.linearRampToValueAtTime(vol, t0 + Math.min(0.4, dur / 3)); g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
      o.connect(g); g.connect(mg); o.start(t0); o.stop(t0 + dur + 0.05);
    };
    const penta = [72, 74, 76, 79, 81, 84];
    for (let b = 0, t = 0; t < total; b++, t += bar) {
      const ch = chords[b % 4];
      ch.forEach((n, k) => tone(n, t + k * 0.03, bar * 1.05, k < 2 ? 'sine' : 'triangle', k < 2 ? 0.5 : 0.22));
      for (let k = 0; k < 8; k++) {
        if ((b * 8 + k) % 3 === 2) continue;
        const n = penta[(b * 5 + k * 3) % penta.length];
        tone(n, t + k * (bar / 8), beat * 1.4, 'sine', 0.2);
      }
    }
    const mixed = await off.startRendering();
    // ---- 畫面＋聲音一起錄 ----
    const actx = new AudioContext(), dest = actx.createMediaStreamDestination();
    const ms = new MediaStream([...cv.captureStream(fps).getVideoTracks(), ...dest.stream.getAudioTracks()]);
    const rec = new MediaRecorder(ms, { mimeType: 'video/webm;codecs=vp9,opus', videoBitsPerSecond: 2500000, audioBitsPerSecond: 128000 });
    const chunks = []; rec.ondataavailable = e => chunks.push(e.data);
    const done = new Promise(res => rec.onstop = res);
    const load = i => new Promise((res, rej) => { const im = new Image(); im.onload = () => res(im); im.onerror = rej; im.src = `${base}/frames/f${String(i).padStart(5, '0')}.jpg`; });
    let next = load(0);
    const first = await next; cx.drawImage(first, 0, 0);
    rec.start(500);
    const bs = actx.createBufferSource(); bs.buffer = mixed; bs.connect(dest); bs.start();
    const t0 = performance.now();
    for (let i = 0; i < count; i++) {
      const im = await next; if (i + 1 < count) next = load(i + 1);
      cx.drawImage(im, 0, 0);
      const wait = t0 + (i + 1) * (1000 / fps) - performance.now();
      if (wait > 0) await new Promise(r => setTimeout(r, wait));
    }
    await new Promise(r => setTimeout(r, 400));
    rec.stop(); await done;
    const blob = new Blob(chunks, { type: 'video/webm' });
    const buf = new Uint8Array(await blob.arrayBuffer());
    let s = ''; const CH = 0x8000;
    for (let i = 0; i < buf.length; i += CH) s += String.fromCharCode.apply(null, buf.subarray(i, i + CH));
    return btoa(s);
  }, n, FPS, `http://localhost:${port}`, voice.narration);
  fs.writeFileSync(path.join(root, 'tutorial', 'item-qty.webm'), Buffer.from(b64, 'base64'));
  console.log('wrote tutorial/item-qty.webm', (Buffer.from(b64, 'base64').length / 1e6).toFixed(1) + ' MB');
} finally {
  await br.close(); srv.close(); fs.rmSync(tmp, { recursive: true, force: true });
}

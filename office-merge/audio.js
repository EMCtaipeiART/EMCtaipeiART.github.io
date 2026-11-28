// 背景音樂播放 art/bgm.mp3（Higgsfield 生成）；音效用 Web Audio 即時合成。
const KEY = 'officeMergeSound';
export const prefs = { music: true, sfx: true, musicVol: 70, sfxVol: 70 };
try { Object.assign(prefs, JSON.parse(localStorage.getItem(KEY))); } catch (e) {}

let ctx, musicBus, sfxBus, track = null, loading = null, source = null;
const hz = m => 440 * 2 ** ((m - 69) / 12);

function init() {
  if (ctx) return true;
  const AC = window.AudioContext || window.webkitAudioContext;
  if (!AC) return false;
  ctx = new AC();
  musicBus = ctx.createGain(); musicBus.connect(ctx.destination);
  sfxBus = ctx.createGain(); sfxBus.connect(ctx.destination);
  applyVolume();
  return true;
}

// 70（預設）＝原本調好的大小，往上最多約 1.4 倍
const BASE = { music: .38, sfx: .5 };
const level = name => { const v = Number(prefs[name + 'Vol']); return BASE[name] * (Number.isFinite(v) ? Math.min(100, Math.max(0, v)) : 70) / 70; };
function applyVolume() {
  if (!ctx) return;
  musicBus.gain.value = level('music'); sfxBus.gain.value = level('sfx');
}
function savePrefs() { try { localStorage.setItem(KEY, JSON.stringify(prefs)); } catch (e) {} }
export function setVolume(name, value) {
  prefs[name + 'Vol'] = value;
  savePrefs(); applyVolume(); unlock();
}

function tone(bus, midi, at, len, vol, type = 'triangle', slide = 0) {
  const o = ctx.createOscillator(), g = ctx.createGain();
  o.type = type; o.frequency.setValueAtTime(hz(midi), at);
  if (slide) o.frequency.exponentialRampToValueAtTime(hz(midi + slide), at + len);
  g.gain.setValueAtTime(.0001, at);
  g.gain.exponentialRampToValueAtTime(vol, at + .012);
  g.gain.exponentialRampToValueAtTime(.0001, at + len);
  o.connect(g).connect(bus); o.start(at); o.stop(at + len + .02);
}
/* ---------- 背景音樂 ---------- */
// 曲子結尾是淡出的：裁掉淡出段，長度對齊整數小節，再把接下來的一段和開頭交叉淡接，循環才聽不出接縫
const BAR = 4 * 60 / 105, FADE = 1.2;
function makeLoop(buf) {
  const sr = buf.sampleRate, d = buf.getChannelData(0), win = sr >> 1;
  const loud = [];
  for (let a = 0; a + win <= d.length; a += win) {
    let sum = 0;
    for (let k = a; k < a + win; k++) sum += d[k] * d[k];
    loud.push(Math.sqrt(sum / win));
  }
  const floor = [...loud].sort((a, b) => a - b)[loud.length >> 1] * .7;
  let last = loud.length - 1;
  while (last > 0 && loud[last] < floor) last--;
  const end = (last + 1) * win / sr;                                  // 淡出開始前
  const len = Math.floor(Math.floor((end - FADE) / BAR) * BAR * sr);  // 循環長度
  const fade = Math.floor(FADE * sr);
  if (len <= fade) return buf;
  const out = ctx.createBuffer(buf.numberOfChannels, len, sr);
  for (let c = 0; c < buf.numberOfChannels; c++) {
    const src = buf.getChannelData(c), dst = out.getChannelData(c);
    dst.set(src.subarray(0, len));
    for (let k = 0; k < fade; k++) {
      const t = k / fade * Math.PI / 2;
      dst[k] = src[k] * Math.sin(t) + src[len + k] * Math.cos(t);
    }
  }
  return out;
}
function load() {
  loading ||= fetch('art/bgm.mp3')
    .then(r => { if (!r.ok) throw new Error(r.status); return r.arrayBuffer(); })
    .then(data => new Promise((ok, bad) => ctx.decodeAudioData(data, ok, bad)))
    .then(buf => { track = makeLoop(buf); syncMusic(); })
    .catch(() => { loading = null; });   // 下次點畫面再試
}
function syncMusic() {
  if (!ctx) return;
  const on = prefs.music;
  if (on && !track) { load(); return; }
  if (on && !source) {
    source = ctx.createBufferSource();
    source.buffer = track; source.loop = true;
    source.connect(musicBus); source.start();
  }
  if (!on && source) { source.stop(); source = null; }
}

// 瀏覽器要使用者先碰過畫面才能出聲
export function unlock() {
  if (!prefs.music && !prefs.sfx) return;
  if (!init()) return;
  if (ctx.state === 'suspended' && !document.hidden) ctx.resume();
  syncMusic();
}
export function setPref(name, on) {
  prefs[name] = on;
  savePrefs();
  if (on) unlock(); else syncMusic();
}
document.addEventListener('visibilitychange', () => {
  if (!ctx) return;
  if (document.hidden) ctx.suspend(); else ctx.resume().then(syncMusic);
});
export const isPlaying = () => !!source && ctx.state === 'running';
export const loopSeconds = () => track?.duration || 0;

/* ---------- 音效 ---------- */
const run = (notes, gap, len, vol, type) => notes.forEach((n, i) => tone(sfxBus, n, ctx.currentTime + i * gap, len, vol, type));
const SOUNDS = {
  pop: () => tone(sfxBus, 62, ctx.currentTime, .14, .5, 'sine', 17),
  merge: (lv = 1) => run([67 + lv * 2, 74 + lv * 2, 79 + lv * 2], .055, .22, .35),
  coin: () => run([83, 88], .08, .28, .22, 'square'),
  no: () => run([55, 50], .11, .18, .35, 'sine'),
  level: () => run([72, 76, 79, 84, 88], .09, .4, .35),
  clear: () => { run([67, 72, 76, 79], .12, .3, .3, 'square'); [72, 76, 79, 84].forEach(n => tone(sfxBus, n, ctx.currentTime + .52, .9, .3)); },
};
export function play(name, arg) {
  if (!prefs.sfx || !ctx || ctx.state !== 'running') return;
  SOUNDS[name]?.(arg);
}

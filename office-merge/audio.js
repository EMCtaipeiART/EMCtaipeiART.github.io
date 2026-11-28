// 背景音樂輪播 art/bgm*.mp3（使用者用 Suno 生成）；音效用 Web Audio 即時合成。
const KEY = 'officeMergeSound';
// pick：0＝輪播，n＝只放第 n 首；last：上次放到哪一首，下次開遊戲從下一首開始
export const prefs = { music: true, sfx: true, musicVol: 70, sfxVol: 70, pick: 0, last: -1 };
try { Object.assign(prefs, JSON.parse(localStorage.getItem(KEY))); } catch (e) {}

let ctx, musicBus, sfxBus;
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
// 要加曲子：檔案放進 art/，在這裡加一行（音量先調到約 -15.5 LUFS）
export const TRACKS = ['art/bgm1.mp3', 'art/bgm2.mp3'];
const FADE_IN = 1.5, FADE_OUT = 3;
// 全程只用同一個 <audio>：手機只放行使用者點過後播起來的那一個，換歌換 src 就好
let el = null, fader = null, index = -1, tail = false, onTrack = () => {};
const picked = () => Number.isInteger(prefs.pick) && prefs.pick >= 1 && prefs.pick <= TRACKS.length ? prefs.pick - 1 : -1;
function fade(from, to, sec) {
  const t = ctx.currentTime;
  fader.gain.cancelScheduledValues(t);
  fader.gain.setValueAtTime(from, t);
  fader.gain.linearRampToValueAtTime(to, t + sec);
}
function start(i) {
  index = i; tail = false; prefs.last = i; savePrefs();
  el.src = TRACKS[i];
  fade(0, 1, FADE_IN);
  el.play().catch(() => {});   // 被瀏覽器擋下就等下次點畫面
  onTrack();
}
const following = () => picked() >= 0 ? picked() : (index + 1) % TRACKS.length;
function player() {
  if (el) return;
  el = new Audio(); el.preload = 'auto';
  fader = ctx.createGain();
  ctx.createMediaElementSource(el).connect(fader).connect(musicBus);
  el.addEventListener('ended', () => start(following()));
  el.addEventListener('timeupdate', () => {
    const left = el.duration - el.currentTime;
    if (!tail && left > 0 && left < FADE_OUT) { tail = true; fade(fader.gain.value, 0, left); }
  });
}
function syncMusic() {
  if (!ctx) return;
  if (!prefs.music || document.hidden) { el?.pause(); return; }
  player();
  // 第一次播：接著上次的下一首（沒播過就從第 1 首）
  if (index < 0 || el.error) start(picked() >= 0 ? picked() : Number.isInteger(prefs.last) && prefs.last >= 0 ? (prefs.last + 1) % TRACKS.length : 0);
  else if (el.paused) el.play().catch(() => {});
}
// 聲音面板用：選曲（0＝輪播）、跳下一首、目前第幾首
export function setTrack(n) {
  prefs.pick = n; savePrefs(); unlock();
  if (el && prefs.music && picked() >= 0 && picked() !== index) start(picked());
  onTrack();
}
export function skip() {
  prefs.pick = 0; savePrefs(); unlock();
  if (el && prefs.music) start(following());
}
export const trackNo = () => index + 1;
export const watchTrack = fn => { onTrack = fn; };

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
  if (document.hidden) { el?.pause(); ctx.suspend(); } else ctx.resume().then(syncMusic);
});
export const isPlaying = () => !!el && !el.paused && ctx.state === 'running';

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

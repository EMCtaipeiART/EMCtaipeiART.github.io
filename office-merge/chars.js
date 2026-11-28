// 人物頭像：和元宇宙用同一份「最新角色」——角色工坊發佈過的用雲端圖集，沒有的用 pixel-plaza/sprites-hd。
// 圖集是橫排 12 個角度（每格正方形），這裡裁第 0 格（正面）的頭肩。
import { PEOPLE } from './logic.js';

export const GHOST = '透明人';   // 沒有登入的人
const CHAR_API = 'https://emc-ai-stage-classifier.machi-chen.workers.dev/api/public/characters';
const CACHE = 'plazaCloudChars';  // 和元宇宙共用的人物清單快取
const BLANK = 'data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7';
const faces = {}, busts = {}, listeners = new Set();

export const face = name => faces[name] || BLANK;
export const bust = name => busts[name] || BLANK;   // 劇情對話用的半身
export const onFaces = fn => listeners.add(fn);

async function cloudList() {
  let j = null;
  try {
    const stop = new AbortController(), timer = setTimeout(() => stop.abort(), 5000);
    const r = await fetch(CHAR_API, { signal: stop.signal });
    clearTimeout(timer);
    if (r.ok) j = await r.json();
  } catch (e) {}
  if (!j?.characters) { try { j = JSON.parse(localStorage.getItem(CACHE) || 'null'); } catch (e) {} }
  return j?.characters || {};
}

const image = src => new Promise((ok, bad) => {
  const img = new Image();
  img.crossOrigin = 'anonymous';
  img.onload = () => ok(img); img.onerror = bad; img.src = src;
});

function crop(atlas) {
  const h = atlas.height, c = document.createElement('canvas');
  c.width = c.height = 160;
  const g = c.getContext('2d');
  g.imageSmoothingQuality = 'high';
  g.drawImage(atlas, h * 40 / 240, 0, h * 160 / 240, h * 160 / 240, 0, 0, 160, 160);
  return c.toDataURL();
}

// 同一格裁半身（頭到腰）
function half(atlas) {
  const k = atlas.height / 240, c = document.createElement('canvas');
  c.width = Math.round(192 * k); c.height = Math.round(180 * k);
  c.getContext('2d').drawImage(atlas, 24 * k, 4 * k, 192 * k, 180 * k, 0, 0, c.width, c.height);
  return c.toDataURL();
}

async function load(name, cloud) {
  const local = `../pixel-plaza/sprites-hd/${encodeURIComponent(name)}.webp`;
  const sources = cloud[name] ? [`${CHAR_API}/${encodeURIComponent(name)}/atlas-hd.png?v=${cloud[name]}`, local] : [local];
  for (const src of sources) {
    try { const atlas = await image(src); faces[name] = crop(atlas); busts[name] = half(atlas); return; } catch (e) {}
  }
}

export const ready = cloudList().then(cloud => Promise.all([...PEOPLE, GHOST].map(n => load(n, cloud))))
  .then(() => listeners.forEach(fn => fn()));

// 身分與雲端闖關榜。後端是設計需求系統的 Worker（action: officeMergeRank）。
import { PEOPLE, stageInfo } from './logic.js';

const local = /(^|\.)(localhost|127\.0\.0\.1)$/.test(location.hostname);
const query = new URLSearchParams(location.search);
// 本機開發不打正式後端（避免測試資料上榜）；要測連線時用 ?api=<本機假後端>
export const API = local ? (query.get('api') || '') : 'https://machi-design-api.machi-chen.workers.dev/api';

const match = name => PEOPLE.find(p => p.toLowerCase() === String(name || '').toLowerCase()) || '';

// 身分：元宇宙／小幫手帶進來的 ?me=，否則沿用網站登入（24 小時內有效）。不能自己挑，避免誤用別人的名字上榜。
function identify() {
  const fromUrl = match(query.get('me'));
  if (fromUrl) return fromUrl;
  try {
    const h = JSON.parse(localStorage.getItem('pixelViewerHandoff') || 'null');
    if (h && Date.now() - Number(h.at) < 86400000 && match(h.name)) return match(h.name);
    // 直接開網址（手機、書籤）：沿用網站目前的登入
    const get = k => localStorage.getItem(k) || sessionStorage.getItem(k) || '';
    if (localStorage.getItem('designRequestEditorLoggedOut') !== '1' && get('designRequestEditorToken'))
      return match(get('designRequestEditorDisplayName')) || match(get('designRequestEditorUser'));
  } catch (e) {}
  return '';
}
export const me = identify();

// 網站登入憑證：領能量、用平台幣兌換時後端靠它認人
function token() {
  try {
    const get = k => localStorage.getItem(k) || sessionStorage.getItem(k) || '';
    if (localStorage.getItem('designRequestEditorLoggedOut') === '1') return '';
    const site = get('designRequestEditorToken');
    if (site) return site;
    const h = JSON.parse(localStorage.getItem('pixelViewerHandoff') || 'null');
    return h && Date.now() - Number(h.at) < 86400000 ? String(h.token || '') : '';
  } catch (e) { return ''; }
}
export const canUseEnergy = () => Boolean(API && me && token());

async function post(payload, keepalive = false) {
  const stop = new AbortController(), timer = setTimeout(() => stop.abort(), 15000);
  try {
    const r = await fetch(API, { method: 'POST', headers: { 'Content-Type': 'text/plain;charset=UTF-8' }, body: JSON.stringify(payload), cache: 'no-store', signal: stop.signal, keepalive });
    const d = await r.json();
    if (!d.ok) throw Object.assign(new Error(d.error || '後端回覆失敗'), { refused: true });
    return d;
  } finally { clearTimeout(timer); }
}

// 能量：後端依登入憑證認人，和目前遊戲的人物不同就不碰（避免加到別人的存檔）
export async function energy(op, extra = {}) {
  const d = await post({ action: 'officeMergeEnergy', op, token: token(), ...extra });
  if (d.name !== me) throw new Error(`目前登入的是 ${d.name}，和遊戲人物 ${me} 不同`);
  return d;
}

// 雲端存檔。keepalive：關掉分頁的瞬間送出的存檔也能送達
export async function saveData(op, extra = {}) {
  const d = await post({ action: 'officeMergeSave', op, token: token(), ...extra }, op === 'save');
  if (d.name !== me) throw Object.assign(new Error(`登入的是 ${d.name}，請重新登入`), { refused: true });
  return d;
}

let ranks = {};
export let status = API ? 'loading' : 'off';   // loading | ok | error | off
const listeners = new Set();
export const onRanks = fn => listeners.add(fn);
export const getRanks = () => ranks;

async function call(payload) {
  try {
    ranks = (await post({ action: 'officeMergeRank', ...payload })).ranks || {};
    status = 'ok';
  } catch (e) {
    status = 'error';
  }
  listeners.forEach(fn => fn());
}

// 有身分就上傳自己的進度（後端只往上記），順便拿回全部排名
export function sync(state) {
  if (!API) return;
  const at = stageInfo(state);
  return call(me && state.done > 0 ? { op: 'save', name: me, done: state.done, xp: state.xp, level: at.no, progress: at.have } : { op: 'list' });
}

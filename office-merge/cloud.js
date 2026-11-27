// 身分與雲端闖關榜。後端是設計需求系統的 Worker（action: officeMergeRank）。
import { PEOPLE } from './logic.js';

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
    if (h && Date.now() - Number(h.at) < 86400000) return match(h.name);
  } catch (e) {}
  return '';
}
export const me = identify();

let ranks = {};
export let status = API ? 'loading' : 'off';   // loading | ok | error | off
const listeners = new Set();
export const onRanks = fn => listeners.add(fn);
export const getRanks = () => ranks;

async function call(payload) {
  const stop = new AbortController(), timer = setTimeout(() => stop.abort(), 10000);
  try {
    const r = await fetch(API, { method: 'POST', headers: { 'Content-Type': 'text/plain;charset=UTF-8' }, body: JSON.stringify({ action: 'officeMergeRank', ...payload }), cache: 'no-store', signal: stop.signal });
    const d = await r.json();
    if (!d.ok) throw new Error(d.error || '後端回覆失敗');
    ranks = d.ranks || {};
    status = 'ok';
  } catch (e) {
    status = 'error';
  } finally {
    clearTimeout(timer);
    listeners.forEach(fn => fn());
  }
}

// 有身分就上傳自己的進度（後端只往上記），順便拿回全部排名
export function sync(state) {
  if (!API) return;
  return call(me && state.done > 0 ? { op: 'save', name: me, done: state.done, xp: state.xp } : { op: 'list' });
}

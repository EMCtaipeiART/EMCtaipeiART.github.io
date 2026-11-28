// 畫面與操作。規則在 logic.js。
import * as G from './logic.js';
import { art } from './art.js';
import * as audio from './audio.js';
import { celebrate, afterParty, scene } from './effects.js';
import { talk } from './talk.js';
import { startTutorial, tutorialEvent, stopTutorial, tutorialOn } from './tutorial.js';
import { openHome, refreshHome, setSaveState } from './home.js';
import { createCloudSave } from './savesync.js';
import * as cloud from './cloud.js';
import { face, onFaces } from './chars.js';
const { me, sync } = cloud;

// 存檔依身分分開，同一台電腦換人登入不會拿到別人的進度
const BASE_KEY = 'officeMergeSave';
const KEY = me ? `${BASE_KEY}:${me}` : BASE_KEY;
try {
  // 還沒登入前玩的進度，交給第一個登入的人
  if (me && !localStorage.getItem(KEY) && localStorage.getItem(BASE_KEY)) { localStorage.setItem(KEY, localStorage.getItem(BASE_KEY)); localStorage.removeItem(BASE_KEY); }
} catch (e) {}
const $ = id => document.getElementById(id);
const img = o => o.gen ? art(o.line) : `items/${o.line}${o.lv}.png`;
const coin = () => `<img src="${art('coin')}" alt="金幣">`;

let state = load();
let sel = null;        // { a, i }
let drag = null;
let fx = {};           // 本次重畫要播動畫的格子

function load() {
  try { const s = G.upgradeSave(JSON.parse(localStorage.getItem(KEY))); if (G.isValidSave(s)) return s; } catch (e) {}
  return G.newGame();
}
// player＝玩家做了動作（要上雲端）；回能量、開啟遊戲這類只寫本機
function save(player = true) {
  if (player) state.savedAt = Date.now();
  try { localStorage.setItem(KEY, JSON.stringify(state)); } catch (e) {}
  if (player) { cloudSave.changed(); queueDex(); }
}

// 新拿到的物件同步到元宇宙圖鑑
let dexTimer;
function queueDex() {
  clearTimeout(dexTimer);
  dexTimer = setTimeout(async () => {
    const added = await cloud.syncDex(state.seen);
    if (added && !$('home').open) toast(`元宇宙圖鑑新增 ${added} 款！`);
  }, 600);
}

/* ---------- 雲端存檔：玩到哪記到哪，換裝置接著玩 ---------- */
const SYNC_KEY = `officeMergeSync:${me}`;
const SAVE_TEXT = {
  off: me ? '進度只存在這台裝置：請回網站登入' : '訪客：進度只存在這台裝置',
  loading: '正在讀取雲端進度…', saving: '進度上傳中…', saved: '進度已存到雲端',
  offline: '連不上雲端，進度先存在這台裝置，會自動重傳', old: '遊戲有新版本：請重新整理頁面', login: '登入已過期：請回網站重新登入，進度先存在這台裝置',
};
// 本機預覽沒接假後端時 API 是空的
let lastSaveStatus = '';
const cloudSave = createCloudSave({
  enabled: cloud.canUseEnergy(),
  request: cloud.saveData,
  readMeta: () => { try { return JSON.parse(localStorage.getItem(SYNC_KEY) || 'null'); } catch (e) { return null; } },
  writeMeta: m => { try { localStorage.setItem(SYNC_KEY, JSON.stringify(m)); } catch (e) {} },
  getState: () => state,
  adopt,
  onStatus: s => {
    if (s !== lastSaveStatus && (s === 'offline' || s === 'login' || s === 'old') && !$('home').open) toast(SAVE_TEXT[s]);
    lastSaveStatus = s;
    setSaveState(SAVE_TEXT[s], !ready && s === 'loading');
  },
});
let ready = false;   // 第一次讀檔完成前不能開始玩，免得剛玩的幾步被雲端蓋掉

// 換成雲端那份進度
function adopt(data) {
  const next = G.upgradeSave(data);
  if (!G.isValidSave(next)) return false;
  const changedBoard = JSON.stringify(next.cells) !== JSON.stringify(state.cells) || next.done !== state.done;
  if (drag) { drag.ghost?.remove(); drag = null; }
  [...flights.keys()].forEach(land);
  state = next; sel = null;
  G.refill(state);
  try { localStorage.setItem(KEY, JSON.stringify(state)); } catch (e) {}
  render();
  refreshHome(state);
  if (changedBoard && ready) toast('已接續雲端上較新的進度');
  return true;
}

const at = p => (p.a === 'slot' ? state.slots : state.cells)[p.i];

function pieceHTML(o, anim) {
  const cls = ['item', o.gen ? 'gen' : '', !o.gen && o.lv === G.MAX_LV ? 'max' : '', anim || ''].filter(Boolean).join(' ');
  const wait = o.gen ? G.genStatus(o).wait : 0;
  // 星星＝圖鑑等級（和圖鑑頁同一個數字）。機台等級只寫在下方說明欄
  const badge = o.gen ? `<i class="lv"><img src="${art('star')}" alt=""><b>${G.rankOf(state, o.line)}</b></i>${wait ? `<u class="cd">${clock(wait)}</u>` : ''}` : '';
  return `<div class="${cls}${wait ? ' cooling' : ''}"><img src="${img(o)}" alt="${G.nameOf(o)}">${badge}</div>`;
}

const same = (a, b) => a && !a.box && !a.gen && a.line === b.line && a.lv === b.lv;

function render() {
  if (sel && !at(sel)) sel = null;
  const isSel = (a, i) => sel && sel.a === a && sel.i === i ? ' sel' : '';
  const needs = state.orders.flatMap(o => o.need);
  $('board').innerHTML = state.cells.map((c, i) => {
    const wanted = needs.some(r => same(c, r)) ? ' wanted' : '';
    const cls = `cell${i % 2 ? ' alt' : ''}${c && c.box ? ' boxed' : ''}${wanted}${isSel('cell', i)}`;
    const inner = !c ? '' : c.box ? `<img${fx[i] === 'open' ? ' class="pop-in"' : ''} src="${art('box')}" alt="紙箱">` : pieceHTML(c, fx[i]);
    return `<div class="${cls}" data-a="cell" data-i="${i}">${inner}</div>`;
  }).join('');
  $('slots').innerHTML = state.slots.map((o, i) => `<div class="slot${isSel('slot', i)}" data-a="slot" data-i="${i}">${o ? pieceHTML(o) : ''}</div>`).join('');
  const stage = G.stageInfo(state);
  $('orders').innerHTML = state.orders.map(o => {
    const ready = !!G.findNeed(state, o);
    const wants = o.need.map(r => {
      const has = [...state.cells, ...state.slots].some(c => same(c, r));
      return `<button type="button" class="${has ? 'has' : ''}" data-line="${r.line}" data-lv="${r.lv}" title="看看 ${G.nameOf(r)} 的圖鑑階段"><img src="${img(r)}" alt="${G.nameOf(r)}"></button>`;
    }).join('');
    const story = o.story !== undefined, blocked = ready && G.needsSpace(state, o);
    const wait = story ? stage.goal - stage.have : 0;   // 劇情任務：一般訂單還差幾張
    const person = `<img class="face" src="${face(o.who)}" alt=""><div class="who">${o.who}</div>`;
    return `<article class="order${o.rush ? ' rush' : ''}${story ? ' story' : ''}${ready && wait <= 0 ? ' ready' : ''}${wait > 0 ? ' locked' : ''}">
      ${o.rush ? '<em>急件×2</em>' : ''}${story ? `<em>過關任務</em><button type="button" class="teller" data-story aria-label="看這一章的劇情">${person}</button>` : person}<div class="need">${wants}</div>
      <button type="button" class="deliver" data-order="${o.id}" ${ready && wait <= 0 ? '' : 'disabled'}>${wait > 0 ? `🔒 再 ${wait} 張` : `${blocked ? '需空位 ' : ready ? '交付 ' : ''}${coin()}${o.reward}`}</button></article>`;
  }).join('');
  $('coins').textContent = state.coins;
  $('stageNo').textContent = `第 ${stage.no} 關`;
  $('stageName').textContent = stage.ready ? '交過關任務！' : stage.name;
  $('stageCount').textContent = `${stage.have} / ${stage.goal}`;
  $('stageBar').style.width = stage.have / stage.goal * 100 + '%';
  const lv = G.levelInfo(state.xp);
  $('level').textContent = lv.level;
  $('xp').style.width = lv.have / lv.need * 100 + '%';
  renderEnergy();
  const gift = state.gifts[0];
  $('bGift').hidden = !gift;
  $('slotLabel').hidden = !!gift;
  if (gift) $('bGift').innerHTML = `<img src="${img(gift)}" alt="">領獎勵 ×${state.gifts.length}`;
  $('bDex').classList.toggle('new', state.lines.some(k => G.shardCost(state, k) && (state.shards[k] || 0) >= G.shardCost(state, k)));
  syncFlights();
  renderInfo();
  fx = {};
}

function genTip(o) {
  const { cap, left, wait } = G.genStatus(o);
  const merge = o.lv < G.GEN_MAX ? '兩台同級可合成' : '機台已最高級';
  return `機台 ${o.lv} 級・${wait ? `冷卻 ${clock(wait)}` : `還可點 ${left} / ${cap} 次・${merge}`}`;
}

// 每秒更新冷卻倒數；有產生器冷卻好了就重畫
const wasCooling = new WeakSet();
function renderCooling() {
  let ready = false, busy = false;
  for (const o of [...state.cells, ...state.slots]) {
    if (!o?.gen) continue;
    if (G.genStatus(o).wait) { wasCooling.add(o); busy = true; } else if (wasCooling.delete(o)) ready = true;
  }
  if (drag) return;
  if (ready) { render(); audio.play('merge', 1); return; }
  if (!busy) return;
  document.querySelectorAll('[data-a]').forEach(el => {
    const o = at({ a: el.dataset.a, i: +el.dataset.i }), label = el.querySelector('.cd');
    if (o?.gen && label) label.textContent = clock(G.genStatus(o).wait);
  });
  // 只換文字，不重畫按鈕（每秒重畫會讓點擊失效）
  const tip = $('info').querySelector('.tip');
  if (sel && at(sel)?.gen && tip) tip.textContent = genTip(at(sel));
  const left = $('coolLeft');
  if (!left || !$('panel').open) return;
  const target = coolTarget();
  if (target) left.textContent = clock(G.genStatus(target).wait); else $('panel').close();
}

function renderInfo() {
  const o = sel && at(sel);
  if (!o) { $('info').innerHTML = '<div class="txt">點產生器拿物品，把兩個一樣的拖在一起合成。</div>'; return; }
  // 物品：一顆按鈕告訴你是哪個產生器（哪條圖鑑）生出來的
  const tip = o.gen ? `<span class="tip">${genTip(o)}</span>` : `<button type="button" class="from" id="bFrom" title="看這條圖鑑"><img src="${art(o.line)}" alt=""><span>${G.LINES[o.line].gen}</span>›</button>`;
  $('info').innerHTML = `${o.gen ? `<img src="${img(o)}" alt="">` : ''}<div class="txt"><b>${o.gen ? `${G.LINES[o.line].gen} 圖鑑Lv.${G.rankOf(state, o.line)}` : G.nameOf(o)}</b>${tip}</div>` +
    (o.gen ? G.genStatus(o).wait ? '<button type="button" class="unfreeze" id="bCool">解除<br>冷卻</button>' : '' : `<button type="button" class="sell" id="bSell">出售<span>${coin()}${G.value(o.lv)}</span></button>`);
}

let toastTimer;
function toast(text) {
  $('toast').textContent = text; $('toast').hidden = false;
  clearTimeout(toastTimer); toastTimer = setTimeout(() => { $('toast').hidden = true; }, 1800);
}

/* ---------- 能量 ---------- */
const clock = ms => { const s = Math.ceil(ms / 1000); return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`; };
function renderEnergy() {
  const wait = G.nextEnergyIn(state);
  $('energy').textContent = state.energy;
  $('energyTime').textContent = wait ? clock(wait) : state.energy > G.ENERGY_MAX ? '超量' : '已滿';
  $('bEnergy').classList.toggle('low', state.energy === 0);
}
function tick() {
  const before = state.energy;
  G.refill(state);
  if (state.energy !== before) save(false);
  renderEnergy();
  renderCooling();
}
setInterval(tick, 1000);
addEventListener('visibilitychange', () => { if (!document.hidden) tick(); });

/* 雲端能量：撿道具與兌換的點數先記在後端，領下來才加進存檔 */
const store = (k, v) => { try { if (v === undefined) return localStorage.getItem(k) || ''; if (v) localStorage.setItem(k, v); else localStorage.removeItem(k); } catch (e) {} return ''; };
const CLAIM_KEY = `officeMergeClaim:${me}`, BUY_KEY = `officeMergeBuy:${me}`;
let claiming = null;
function claimEnergy() {
  if (!cloud.canUseEnergy()) return Promise.resolve(0);
  return claiming ||= (async () => {
    // 編號先存起來：回應遺失時用同一個編號重領，不會漏也不會重複
    const id = store(CLAIM_KEY) || crypto.randomUUID();
    store(CLAIM_KEY, id);
    const d = await cloud.energy('claim', { claimId: id });
    const got = G.addBonus(state, id, d.claimed);
    if (got) { save(); render(); audio.play('coin'); toast(`領到能量 +${got}`); }
    // 確定這筆已經進到雲端存檔才丟掉編號；否則下次用同一個編號再領一次（重複的不會加兩次）
    const stored = await cloudSave.flush();
    if (!d.claimed || (stored && state.claims?.includes(id))) store(CLAIM_KEY, '');
    return got;
  })().catch(() => 0).finally(() => { claiming = null; });
}
setInterval(() => { if (!document.hidden) claimEnergy(); }, 60000);
// 離開畫面立刻上傳；回來先看別台裝置有沒有玩過
addEventListener('visibilitychange', () => {
  if (document.hidden) cloudSave.flush(); else cloudSave.load().then(claimEnergy);
});
addEventListener('pagehide', () => { cloudSave.flush(); cloud.syncDex(state.seen, true); });
addEventListener('online', () => cloudSave.load());

async function exchangeBox() {
  const box = $('exchange');
  if (!box) return;
  if (!cloud.canUseEnergy()) { box.textContent = '登入網站後，可以用平台幣兌換能量。'; return; }
  box.textContent = '平台幣讀取中…';
  let info;
  try { info = await cloud.energy('status'); } catch (e) { box.textContent = `暫時無法兌換：${e.message}`; return; }
  if (!info.wallet) { box.textContent = '這個帳號沒有平台幣。'; return; }
  const pending = store(BUY_KEY), enough = info.balance >= info.price || pending;
  box.innerHTML = `<div>目前平台幣 <b>${info.balance}</b> 點</div><button type="button" class="buy" ${enough ? '' : 'disabled'}>用 ${info.price} 平台幣換 ${info.amount} 能量</button>${enough ? '' : '<div>平台幣不足</div>'}`;
  const button = box.querySelector('button');
  let armed = false;
  button.addEventListener('click', async () => {
    if (!armed) { armed = true; button.textContent = `再按一次確認扣 ${info.price} 平台幣`; button.classList.add('armed'); return; }
    button.disabled = true; button.textContent = '兌換中…';
    // 同一次兌換沿用同一個編號：網路中斷後再按不會重複扣款
    const requestId = store(BUY_KEY) || crypto.randomUUID();
    store(BUY_KEY, requestId);
    try {
      await cloud.energy('buy', { requestId });
      store(BUY_KEY, '');
      await claimEnergy();
      if ($('panel').open) energyPanel();
    } catch (e) {
      if (e.refused) store(BUY_KEY, '');
      toast(e.refused ? e.message : '連線中斷，請再按一次（不會重複扣款）');
      exchangeBox();
    }
  });
}

function energyPanel() {
  tick();
  const wait = G.nextEnergyIn(state);
  openPanel('能量', `<div class="big-num">${state.energy} / ${G.ENERGY_MAX}</div>
    <div id="coinShop"></div>
    <div id="exchange"></div>
    點一次產生器花 1 點，每分鐘回 1 點（關掉遊戲也會回）。<br>
    ${wait ? `下一點：${clock(wait)}　回滿約 ${G.ENERGY_MAX - state.energy} 分鐘` : '能量已滿！'}<br>
    升級送 ${G.LEVEL_REWARD.energy} 點、過關也會送能量（可超過上限）。能量用完時，合成、交付和販售都還能做。<br>
    在元宇宙撿地上的道具 +1、清掉四五樓的大便 +2 點能量；金幣和平台幣也能換能量。`);
  coinBox();
  exchangeBox();
}

function coinBox() {
  const box = $('coinShop'), left = G.shopLeft(state), enough = state.coins >= G.COIN_PRICE && left > 0;
  box.className = 'shop';
  box.innerHTML = `<div>目前金幣 <b>${state.coins}</b></div><button type="button" class="buy" ${enough ? '' : 'disabled'}>用 ${G.COIN_PRICE} 金幣換 ${G.COIN_ENERGY} 能量</button><div>${left <= 0 ? '今天的次數用完了，明天再來' : `今天還可換 ${left} / ${G.COIN_DAILY} 次${enough ? '' : '・金幣不足'}`}</div>`;
  const button = box.querySelector('button');
  let armed = false;
  button.addEventListener('click', () => {
    if (!armed) { armed = true; button.textContent = `再按一次確認扣 ${G.COIN_PRICE} 金幣`; button.classList.add('armed'); return; }
    if (!G.buyEnergy(state)) return;
    save(); render(); audio.play('coin'); toast(`能量 +${G.COIN_ENERGY}`); energyPanel();
  });
}

/* ---------- 解除冷卻：金幣或平台幣 ---------- */
const COOL_KEY = `officeMergeCool:${me}`;
let cooling = null;      // { pos, line }：面板正在處理哪一台
function coolTarget() {
  if (!cooling) return null;
  const o = at(cooling.pos);
  return o?.gen && o.line === cooling.line && G.genStatus(o).wait ? o : null;
}
function cooled() {
  sel = { ...cooling.pos };
  save(); render(); cloudSave.flush(); audio.play('coin'); $('panel').close();
  toast(`${G.LINES[cooling.line].gen}冷卻解除！`);
}
function coolPanel(pos) {
  cooling = { pos: { a: pos.a, i: pos.i }, line: at(pos).line };
  const o = coolTarget();
  if (!o) return;
  openPanel('解除冷卻', `<p class="hint">${G.nameOf(o)}還要 <b id="coolLeft">${clock(G.genStatus(o).wait)}</b>。解除後馬上可以再點 ${G.genStatus(o).cap} 次。</p><div id="coolCoin" class="shop"></div><div id="coolPay" class="shop"></div>`);
  const box = $('coolCoin'), enough = state.coins >= G.COOL_PRICE;
  box.innerHTML = `<div>目前金幣 <b>${state.coins}</b></div><button type="button" class="buy" ${enough ? '' : 'disabled'}>用 ${G.COOL_PRICE} 金幣解除</button>${enough ? '' : '<div>金幣不足</div>'}`;
  const button = box.querySelector('button');
  let armed = false;
  button.addEventListener('click', () => {
    if (!armed) { armed = true; button.textContent = `再按一次確認扣 ${G.COOL_PRICE} 金幣`; button.classList.add('armed'); return; }
    if (G.buyCooldown(state, cooling.pos)) cooled();
  });
  coolWallet($('coolPay'));
}
async function coolWallet(box) {
  if (!cloud.canUseEnergy()) { box.textContent = '登入網站後，也可以用平台幣解除。'; return; }
  box.textContent = '平台幣讀取中…';
  let info;
  try { info = await cloud.energy('status'); } catch (e) { box.textContent = `暫時無法用平台幣：${e.message}`; return; }
  if (!box.isConnected) return;
  if (!info.wallet || !info.coolPrice) { box.textContent = info.wallet ? '平台幣解除暫時無法使用，請稍後再試。' : '這個帳號沒有平台幣。'; return; }
  // 付過款但還沒用掉（斷線、或剛好冷卻完）：沿用同一個編號，不會再扣一次
  const pending = store(COOL_KEY), enough = info.balance >= info.coolPrice || pending;
  const label = pending ? '解除冷卻（上次的兌換，不重複扣款）' : `用 ${info.coolPrice} 平台幣解除`;
  box.innerHTML = `<div>目前平台幣 <b>${info.balance}</b> 點</div><button type="button" class="buy" ${enough ? '' : 'disabled'}>${label}</button>${enough ? '' : '<div>平台幣不足</div>'}`;
  const button = box.querySelector('button');
  let armed = Boolean(pending);
  button.addEventListener('click', async () => {
    if (!armed) { armed = true; button.textContent = `再按一次確認扣 ${info.coolPrice} 平台幣`; button.classList.add('armed'); return; }
    if (!coolTarget()) return;
    button.disabled = true; button.textContent = '處理中…';
    const requestId = store(COOL_KEY) || crypto.randomUUID();
    store(COOL_KEY, requestId);
    try {
      await cloud.energy('buy', { requestId, item: 'cool' });
      if (coolTarget() && G.skipCooldown(state, cooling.pos)) { store(COOL_KEY, ''); cooled(); }
      else toast('這台已經冷卻好了，這次兌換留到下次使用');
    } catch (e) {
      if (e.refused) store(COOL_KEY, '');
      toast(e.refused ? e.message : '連線中斷，請再按一次（不會重複扣款）');
      if (box.isConnected) coolWallet(box);
    }
  });
}

/* ---------- 物品從產生器蹦出來 ---------- */
const flights = new Map();   // 目的格 → { item, el }
const calm = matchMedia('(prefers-reduced-motion: reduce)');
const cellEl = i => $('board').children[i];

function land(i) {
  const f = flights.get(i);
  if (!f) return;
  flights.delete(i); f.el.remove();
  cellEl(i)?.firstElementChild?.classList.remove('flying');
}

// 重畫後：飛行中的目的格先藏起來；東西已經被移走就收掉動畫
function syncFlights() {
  for (const [i, f] of flights) {
    if (state.cells[i] !== f.item) land(i);
    else cellEl(i).firstElementChild.classList.add('flying');
  }
}

function sparks(x, y, size) {
  for (let k = 0; k < 7; k++) {
    const s = document.createElement('img');
    s.src = art('star'); s.className = 'spark'; s.alt = '';
    s.style.left = x + 'px'; s.style.top = y + 'px';
    document.body.append(s);
    const a = Math.PI * 2 * k / 7 + Math.random() * .5, d = size * (.6 + Math.random() * .4);
    s.animate([
      { transform: 'translate(-50%,-50%) scale(.3)', opacity: 1 },
      { transform: `translate(calc(-50% + ${Math.cos(a) * d}px), calc(-50% + ${Math.sin(a) * d}px)) rotate(160deg) scale(1)`, opacity: 0 },
    ], { duration: 420, easing: 'cubic-bezier(.2,.7,.4,1)', fill: 'forwards' }).onfinish = () => s.remove();
  }
}

function popOut(from, to) {
  if (calm.matches) return;
  const gen = cellEl(from), a = gen.getBoundingClientRect(), b = cellEl(to).getBoundingClientRect();
  // 產生器先壓扁再彈起
  gen.firstElementChild.animate([
    { transform: 'scale(1)' }, { transform: 'scale(1.22,.76)', offset: .25 },
    { transform: 'scale(.86,1.18)', offset: .55 }, { transform: 'scale(1.06,.96)', offset: .78 }, { transform: 'scale(1)' },
  ], { duration: 340, easing: 'ease-out' });
  sparks(a.left + a.width / 2, a.top + a.height * .35, a.width);

  const el = document.createElement('img');
  el.src = img(state.cells[to]); el.className = 'flyer'; el.alt = '';
  Object.assign(el.style, { left: b.left + 'px', top: b.top + 'px', width: b.width + 'px', height: b.height + 'px' });
  document.body.append(el);
  land(to);
  flights.set(to, { item: state.cells[to], el });
  cellEl(to).firstElementChild.classList.add('flying');
  const dx = a.left - b.left, dy = a.top - b.top;
  const high = Math.min(dy, 0) - a.height * 1.15;
  const anim = el.animate([
    { transform: `translate(${dx}px,${dy}px) scale(.2) rotate(-40deg)`, easing: 'cubic-bezier(.2,.7,.5,1)' },
    { transform: `translate(${dx * .55}px,${high}px) scale(1.35) rotate(12deg)`, offset: .45, easing: 'cubic-bezier(.5,0,.9,.6)' },
    { transform: 'translate(0px,0px) scale(1.08) rotate(0deg)', offset: .78 },
    { transform: 'translate(0px,5px) scale(1.3,.78)', offset: .89 },
    { transform: 'translate(0px,0px) scale(1.08)' },
  ], { duration: 580, fill: 'forwards' });
  anim.onfinish = () => { if (flights.get(to)?.el === el) land(to); };
}
addEventListener('resize', () => [...flights.keys()].forEach(land));

/* ---------- 拖曳與點擊 ---------- */
const spot = el => { const s = el && el.closest('[data-a]'); return s ? { a: s.dataset.a, i: +s.dataset.i, el: s } : null; };

function onDown(e) {
  if (drag || e.button > 0) return;
  const p = spot(e.target);
  if (!p) return;
  const o = at(p);
  if (!o || o.box) { if (o) toast('在紙箱旁邊合成就能打開'); return; }
  e.preventDefault();
  drag = { from: p, id: e.pointerId, x: e.clientX, y: e.clientY, moved: false, ghost: null, over: null };
}

function onMove(e) {
  if (!drag || e.pointerId !== drag.id) return;
  if (!drag.moved) {
    if (Math.hypot(e.clientX - drag.x, e.clientY - drag.y) < 8) return;
    drag.moved = true;
    const o = at(drag.from);
    drag.ghost = document.createElement('div');
    drag.ghost.id = 'ghost';
    drag.ghost.innerHTML = pieceHTML(o);
    document.body.append(drag.ghost);
    drag.from.el.firstElementChild.classList.add('drag-src');
    document.querySelectorAll('.cell[data-a]').forEach(el => {
      const i = +el.dataset.i;
      if (!(drag.from.a === 'cell' && drag.from.i === i) && G.canMerge(o, state.cells[i])) el.classList.add('can');
    });
  }
  const half = drag.ghost.offsetWidth / 2;
  drag.ghost.style.transform = `translate(${e.clientX - half}px,${e.clientY - half}px) scale(1.12)`;
  const over = spot(document.elementFromPoint(e.clientX, e.clientY));
  drag.over?.classList.remove('over');
  drag.over = over?.el;
  drag.over?.classList.add('over');
}

function onUp(e) {
  if (!drag || e.pointerId !== drag.id) return;
  const d = drag; drag = null;
  d.ghost?.remove();
  if (e.type === 'pointercancel') { render(); return; }
  if (!d.moved) { tap(d.from); return; }
  const to = spot(document.elementFromPoint(e.clientX, e.clientY));
  if (to) {
    const res = G.move(state, d.from, to);
    if (res) {
      sel = { a: to.a, i: to.i };
      if (res.type === 'merge') {
        audio.play('merge', res.item.lv);
        fx[to.i] = 'pop';
        res.opened.forEach(j => { fx[j] = state.cells[j] ? 'pop-in' : 'open'; });
        if (!res.item.gen && res.item.lv === G.MAX_LV) toast(`合出最高級：${G.nameOf(res.item)}！`);
        navigator.vibrate?.(15);
      }
      save();
      if (res.type === 'merge') {
        tutorialEvent('merge');
        if (res.item.gen) {
          const { line, lv } = res.item, now = G.genPerk(lv), was = G.genPerk(lv - 1);
          celebrate({ kind: 'level', medal: lv, title: '機台升級！', text: `${G.LINES[line].gen}升到機台 ${lv} 級`,
            extra: `<small>冷卻前可點 ${was.cap} → <b>${now.cap}</b> 次<br>掉出高階物品的機率 ${was.high}% → <b>${now.high}%</b></small>`, button: '太好了' });
        }
      }
    }
  }
  render();
}

function tap(p) {
  const o = at(p);
  sel = { a: p.a, i: p.i };
  let born = null;
  if (o.gen && p.a === 'cell') {
    const res = G.spawn(state, p.i);
    if (res.cooling) { audio.play('no'); toast(`${G.LINES[o.line].gen}冷卻中，${clock(res.cooling)} 後可以再點`); }
    else if (res.tired) { audio.play('no'); toast(`能量用完了！${clock(G.nextEnergyIn(state))} 後回 1 點`); energyPanel(); }
    else if (res.full) { audio.play('no'); toast('棋盤滿了！合成或賣掉一些物品'); }
    else { born = res.at; audio.play('pop'); save(); }
  }
  render();
  if (born !== null) { popOut(p.i, born); navigator.vibrate?.(8); tutorialEvent('spawn'); }
}

for (const id of ['board', 'slots']) $(id).addEventListener('pointerdown', onDown);
addEventListener('pointermove', onMove);
addEventListener('pointerup', onUp);
addEventListener('pointercancel', onUp);

$('info').addEventListener('click', e => {
  if (sel && e.target.closest('#bCool')) { coolPanel(sel); return; }
  if (sel && e.target.closest('#bFrom')) { const item = at(sel); chainPanel(item.line, item.lv, true); return; }
  if (!e.target.closest('#bSell') || !sel) return;
  const o = at(sel);
  if (o.lv >= 4 && !confirm(`確定賣掉「${G.nameOf(o)}」？`)) return;
  const got = G.sell(state, sel);
  sel = null; save(); render(); audio.play('coin'); toast(`+${got} 金幣`);
});

$('orders').addEventListener('click', e => {
  const go = e.target.closest('[data-order]');
  if (go) {
    const res = G.deliver(state, +go.dataset.order);
    if (res?.blocked) { audio.play('no'); toast(res.blocked === 'space' ? '棋盤要空出一格放新的產生器' : `再完成 ${res.left} 張一般訂單才能交`); return; }
    if (res) {
      sel = null; save(); render(); audio.play('coin'); sync(state);
      const c = res.cleared;
      if (!res.cleared?.chapter) toast(`${res.order.who}：謝啦！+${res.order.reward} 金幣・+${res.xp} 經驗`);
      if (c?.chapter) scene(() => talk([c.chapter.end], `第 ${c.no} 關・${c.chapter.title}`));
      if (c) celebrate({ kind: 'clear', medal: c.no, title: '過關！',
        text: c.chapter ? `第 ${c.no} 關「${c.chapter.title}」完成` : '加班挑戰完成一輪',
        extra: `${c.chapter ? `<small class="gain">${gainText(c.chapter)}</small>` : ''}${prize(c, c.coins)}${loot(c)}${c.kept ? `<small>棋盤放不下的獎勵先寄放著（${c.kept} 個），左下角可以領</small>` : ''}<small>下一關：第 ${c.next.no} 關「${c.next.name}」</small>`, button: '前往下一關' });
      for (const up of res.levelUps) celebrate({ kind: 'level', medal: up.level, title: '升級！', text: `你升到 Lv.${up.level} 了`, extra: prize(up), button: '太好了' });
      // 獎勵播完，接著講下一章
      if (c?.chapter && G.chapter(state)) { scene(playIntro); afterParty(storyPanel); }
    }
    return;
  }
  if (e.target.closest('[data-story]')) { replayChapter(state.chapter).then(storyPanel); return; }
  const n = e.target.closest('[data-line]');
  if (n) chainPanel(n.dataset.line, +n.dataset.lv);
});

// 完成章節得到什麼（要在升級前後都說得對：用章節本身推算）
function gainText(c) {
  if (!c.unlock) return c.rank ? `圖鑑碎片加碼：${G.LINES[c.rank].gen}` : '過關獎勵';
  return `解鎖新物品線「${G.LINES[c.unlock].gen}」`;
}

// 過關禮：材料和圖鑑碎片
const loot = r => `<div class="loot">${r.gen ? `<figure class="shard"><img src="${art(r.gen)}" alt=""><figcaption>${G.LINES[r.gen].gen}產生器 ×1</figcaption></figure>` : ''}${r.materials.map(m => `<figure><img src="${img(m)}" alt="${G.nameOf(m)}"><figcaption>${G.nameOf(m)}</figcaption></figure>`).join('')}${Object.entries(r.shards).map(([line, n]) => `<figure class="shard"><span><img src="${art(line)}" alt=""></span><figcaption>${G.LINES[line].gen}碎片 ×${n}</figcaption></figure>`).join('')}</div>`;
const prize = (r, coins) => `<div class="prize">${coins ? `<span>${coin()}+${coins}</span>` : ''}<span title="經驗值"><i class="xp">XP</i>+${r.xp}</span><span title="能量"><i class="zap"></i>+${r.energy}</span></div>`;

// 任務物品提示：整條合成路線，標出要的是第幾階、手上有幾個
// fromBoard：從下方說明欄點進來（看來源），不是看任務要什麼
function chainPanel(line, lv, fromBoard = false) {
  const L = G.LINES[line], have = Array(G.MAX_LV + 1).fill(0);
  for (const c of [...state.cells, ...state.slots]) if (c && !c.box && !c.gen && c.line === line) have[c.lv]++;
  const steps = L.items.map((name, i) => {
    const n = i + 1, known = n === lv || have[n] || state.seen[line + n];
    return `<figure class="${[known ? '' : 'unk', n === lv ? 'target' : '', n > lv ? 'beyond' : ''].join(' ')}">
      ${n === lv ? `<em>${fromBoard ? '目前這個' : '任務要這個'}</em>` : ''}${have[n] ? `<i>×${have[n]}</i>` : ''}
      <img src="items/${line}${n}.png" alt=""><b>第 ${n} 階</b>${known ? name : '？？？'}</figure>`;
  }).join('');
  // 手上的低階物品折算成 1 級，算出還差多少
  const owned = have.reduce((s, count, n) => n && n <= lv ? s + count * G.value(n) : s, 0);
  const lack = Math.max(0, G.value(lv) - owned);
  const rank = G.rankOf(state, line);
  const foot = fromBoard ? (lv < G.MAX_LV ? `再合一個相同的，升到第 ${lv + 1} 階` : '已是最高階')
    : have[lv] ? '已經有了，回到訂單按「交付」就能交件（兩樣物品都要湊齊）。' : lack ? `還差約 <b>${lack}</b> 個第 1 階的量` : '材料夠了，合起來就好！';
  openPanel(`${L.items[lv - 1]}・第 ${lv} 階`, `<div class="source"><img src="${art(line)}" alt=""><div>來自「<b>${L.gen}</b>」圖鑑 Lv.${rank}<br>點${L.gen}取得第 1 階，兩個相同的合成下一階。</div></div>
    <div class="dex chain">${steps}</div>
    <div class="lack">${foot}</div>`);
}

/* ---------- 圖鑑與說明 ---------- */
function openPanel(title, html) { $('panelTitle').textContent = title; $('panelBody').innerHTML = html; $('panel').showModal(); }
$('panelClose').addEventListener('click', () => $('panel').close());

const stars = n => '★'.repeat(n) + '☆'.repeat(G.RANK_MAX - n);
const unlockChapter = line => G.CHAPTERS.findIndex(c => c.unlock === line) + 1;
function dexPanel() {
  const keys = Object.keys(G.LINES);
  openPanel(`圖鑑 ${Object.keys(state.seen).length} / ${keys.length * G.MAX_LV}`, `<p class="hint">過關會拿到圖鑑碎片，集滿就能按「升級」。每升一級：該線訂單金幣 +${G.RANK_BONUS.reward * 100}%、產生器多掉一階的機率 +${Math.round(G.RANK_BONUS.lucky * 100)}%。</p>` + keys.map(k => {
    const line = G.LINES[k], open = state.lines.includes(k), rank = G.rankOf(state, k);
    const cost = G.shardCost(state, k), have = state.shards[k] || 0;
    const upgrade = !open || !cost ? '' : `<div class="upgrade"><div class="bar"><s style="width:${Math.min(100, have / cost * 100)}%"></s><span>碎片 ${have} / ${cost}</span></div><button type="button" class="buy" data-upgrade="${k}" ${have >= cost ? '' : 'disabled'}>升級</button></div>`;
    return `<h3 class="dex-head${open ? '' : ' locked'}"><img src="${art(k)}" alt="">${line.gen}<span>${open ? `<em>${stars(rank)}</em> 圖鑑 Lv.${rank}` : `🔒 第 ${unlockChapter(k)} 關過關解鎖`}</span></h3>${upgrade}<div class="dex">${line.items.map((name, n) => {
      const ok = state.seen[k + (n + 1)];
      return `<figure class="${ok ? '' : 'unk'}"><img src="items/${k}${n + 1}.png" alt="">${n + 1}. ${ok ? name : '？？？'}</figure>`;
    }).join('')}</div>`;
  }).join(''));
  $('panelBody').querySelectorAll('[data-upgrade]').forEach(button => button.addEventListener('click', () => {
    const line = button.dataset.upgrade;
    if (!G.upgradeRank(state, line)) return;
    const top = $('panel').scrollTop;
    save(); render(); $('panel').close(); dexPanel(); $('panel').scrollTop = top;
    celebrate({ kind: 'level', medal: G.rankOf(state, line), title: '圖鑑升級！', text: `${G.LINES[line].gen}圖鑑升到 Lv.${G.rankOf(state, line)}`,
      extra: `<small>該線訂單金幣 +${Math.round(G.RANK_BONUS.reward * 100 * (G.rankOf(state, line) - 1))}%、掉高一階機率 +${Math.round(G.RANK_BONUS.lucky * 100 * (G.rankOf(state, line) - 1))}%</small>`, button: '太好了' });
  }));
}
$('bDex').addEventListener('click', dexPanel);

/* ---------- 劇情模式 ---------- */
const chapterTitle = n => `第 ${n + 1} 關・${G.CHAPTERS[n].title}`;
const replayChapter = n => G.CHAPTERS[n] ? talk(G.CHAPTERS[n].say, chapterTitle(n)) : Promise.resolve();
// 這一章的開場對話還沒看過就播
async function playIntro() {
  const n = state.chapter;
  if (!G.chapter(state) || state.heard === n) return;
  await replayChapter(n);
  state.heard = n; save();
}
function storyPanel() {
  const c = G.chapter(state);
  const past = state.chapter ? `<details><summary>回顧劇情（${state.chapter} 關）</summary><div class="replays">${G.CHAPTERS.slice(0, state.chapter).map((p, i) => `<button type="button" data-replay="${i}">▶ ${chapterTitle(i)}</button>`).reverse().join('')}</div></details>` : '';
  const bindReplays = () => $('panelBody').querySelectorAll('[data-replay]').forEach(b => b.addEventListener('click', () => { const n = Number(b.dataset.replay), p = G.CHAPTERS[n]; talk([...p.say, p.end], chapterTitle(n)); }));
  if (!c) { openPanel('劇情', `<p class="hint">全部 ${G.CHAPTERS.length} 關完成！現在是無限的加班挑戰。</p>${past}`); bindReplays(); return; }
  const items = c.need.map(r => {
    const has = [...state.cells, ...state.slots].some(o => same(o, r));
    return `<button type="button" class="${has ? 'has' : ''}" data-line="${r.line}" data-lv="${r.lv}"><img src="${img(r)}" alt="">${G.nameOf(r)}<small>${G.LINES[r.line].gen} ${r.lv} 階</small></button>`;
  }).join('');
  const reward = G.chapterReward(state.chapter);
  const stage = G.stageInfo(state);
  openPanel(`第 ${c.no} / ${G.CHAPTERS.length} 關・${c.title}`, `<button type="button" class="replay" id="bReplay"><img src="${face(c.say[0][0])}" alt="">▶ 再看一次對話</button>
    <div class="goal"><b>${gainText(c)}</b><div class="goal-items">${items}</div>${prize(reward, reward.coins)}${loot(G.chapterLoot(state.chapter))}
    <small>${stage.ready ? '湊齊後，在上方的「過關任務」卡按交付' : `先完成一般訂單 ${stage.have} / ${stage.goal} 張，再交過關任務`}</small><button type="button" class="finish" id="bGo">開始任務</button></div>${past}`);
  $('panelBody').querySelectorAll('[data-line]').forEach(b => b.addEventListener('click', () => chainPanel(b.dataset.line, +b.dataset.lv)));
  $('bGo').addEventListener('click', () => $('panel').close());
  $('bReplay').addEventListener('click', () => replayChapter(state.chapter));
  bindReplays();
}

/* ---------- 新手教學 ---------- */
const cellsWhere = test => state.cells.map((o, i) => o && !o.box && test(o, i) ? $('board').children[i] : null).filter(Boolean);
// 可以點的文具櫃（沒冷卻、有能量、有空格）
const readyGen = () => state.energy > 0 && state.cells.some(o => !o) ? cellsWhere(o => o.gen && !G.genStatus(o).wait).slice(0, 1) : [];
// 最靠近的一組可合成物品
function mergePair() {
  let best = null;
  state.cells.forEach((a, i) => state.cells.forEach((b, j) => {
    if (j <= i || !a || a.box || a.gen || !G.canMerge(a, b)) return;
    const d = Math.abs(i % G.COLS - j % G.COLS) + Math.abs(Math.floor(i / G.COLS) - Math.floor(j / G.COLS));
    if (!best || d < best.d) best = { d, i, j };
  }));
  return best ? [$('board').children[best.i], $('board').children[best.j]] : [];
}
const one = selector => () => [document.querySelector(selector)];
const TUTORIAL = [
  { text: '歡迎加入！點一下發亮的產生器，拿出一個物品（花 1 點能量）。', target: readyGen, wait: 'spawn' },
  { text: '把兩個一樣的物品拖在一起，就會合成高一級。試試看！', target: mergePair, wait: 'merge' },
  { text: '紙箱裡藏著東西。在紙箱旁邊合成，紙箱就會打開。', target: () => cellsWhere(() => false).concat([...document.querySelectorAll('.cell.boxed')].slice(0, 7)) },
  { text: '上面是同事的訂單。湊齊物品後按「交付」拿金幣和經驗；點物品圖示可以看怎麼合出來。', target: one('#orders') },
  { text: '紫色卡片是「過關任務」。先完成指定張數的一般訂單，再交出它就能過關。', target: one('.order.story') },
  { text: '這裡是本關進度。左邊「主選單」可以看同仁闖關榜。', target: one('.stagebar') },
  { text: '能量每分鐘回 1 點，用完了可以點這裡用金幣或平台幣兌換。', target: one('#bEnergy') },
  { text: '產生器連點到上限會冷卻 30 分鐘。點選它可以花金幣或平台幣解除。', target: () => cellsWhere(o => o.gen) },
  { text: '左邊是暫存格；中間顯示點選物品的說明，用不到的可以出售。', target: () => [document.querySelector('.drawer'), $('info')] },
  { text: '圖鑑收集你合出的物品，過關拿到碎片就能升級。祝你翻身成功！', target: one('#bDex') },
];
function beginTutorial() {
  sel = null; render();
  startTutorial(TUTORIAL, () => { state.tut = true; save(); });
}
// 進入棋盤：先看本章開場對話，新手接著上教學
let entering = false;
async function enterBoard() {
  if (entering || tutorialOn()) return;
  entering = true;
  await playIntro();
  entering = false;
  if (!state.tut && !$('home').open) beginTutorial();
}
$('home').addEventListener('close', () => scene(enterBoard));

$('bHelp').addEventListener('click', () => {
  openPanel('怎麼玩', `<h3>目標</h3>幫同事準備他們要的東西，賺金幣。
    每一關先完成指定張數的一般訂單，再交紫色「過關任務」卡。<br>點訂單上的物品圖示，可以看它的合成階段。
    <h3>劇情與圖鑑</h3>共 ${G.CHAPTERS.length} 關，一關一段劇情；點過關任務卡上的同事頭像看對話。部分關卡過關後解鎖新物品線。遊戲裡第一次拿到的物件，元宇宙圖鑑沒有的會一起解鎖。每次過關還會拿到材料和圖鑑碎片，碎片集滿到「圖鑑」按升級。
    <h3>冷卻</h3>每台產生器連點到上限（機台 1 級 ${G.GEN_CAP[0]} 次、2 級 ${G.GEN_CAP[1]} 次、3 級 ${G.GEN_CAP[2]} 次）要冷卻 ${G.GEN_COOL_MS[0] / 60000} 分鐘。
    <h3>產生器升級</h3>兩台同款同級拖在一起升一級（最高 ${G.GEN_MAX} 級）：可點次數更多、更常掉高階物品，次數和冷卻也會重算。部分關卡過關會再送一台。點選冷卻中的產生器，按「解除冷卻」可花 ${G.COOL_PRICE} 金幣或平台幣立刻解除。
    <h3>產生器的標記</h3>右下星星＝圖鑑等級（集碎片升級）。機台等級點選產生器看下方說明，兩台同級可合成升級。
    <h3>能量</h3>上限 100 點，點一次產生器花 1 點，每分鐘回 1 點。
    <h3>操作</h3>點產生器拿物品。<br>把兩個一樣的拖在一起，合成高一級。<br>在紙箱旁邊合成，紙箱就會打開。<br>紙箱裡藏著第二台產生器，合成後更容易掉高級物品。<br>訂單湊齊後按「交付」。用不到的可以點選後賣掉，或放到左下暫存格。
    <h3>存檔</h3>登入後每一步都會存到雲端，換手機或電腦登入同一帳號就能接著玩。<br>目前：${SAVE_TEXT[cloudSave.status]}
    <div class="row"><button type="button" class="buy" id="bTutorial">重看新手教學</button><button type="button" class="danger" id="bReset">重新開始</button></div>`);
  $('bTutorial').addEventListener('click', () => { $('panel').close(); beginTutorial(); });
  $('bReset').addEventListener('click', () => {
    if (!confirm('確定重新開始？目前進度會清掉。')) return;
    stopTutorial(); state = G.newGame(); sel = null; save(); render(); $('panel').close(); enterBoard();
  });
});

$('bEnergy').addEventListener('click', () => { energyPanel(); claimEnergy(); });
$('bMenu').addEventListener('click', () => openHome(state));
onFaces(render);

function soundPanel() {
  const row = (key, label) => {
    const on = audio.prefs[key], vol = audio.prefs[key + 'Vol'];
    return `<div class="sound${on ? '' : ' muted'}">
      <button type="button" class="switch${on ? ' on' : ''}" data-sound="${key}" aria-pressed="${on}">${label}<span>${on ? '開' : '關'}</span></button>
      <label>音量<input type="range" min="0" max="100" step="5" value="${vol}" data-vol="${key}" aria-label="${label}音量" ${on ? '' : 'disabled'}><output>${vol}</output></label></div>`;
  };
  const songs = `<div class="tracks"><div>${[0, ...audio.TRACKS.map((_, i) => i + 1)].map(n => `<button type="button" data-track="${n}" aria-pressed="${(audio.prefs.pick || 0) === n}" ${audio.prefs.music ? '' : 'disabled'}>${n ? `第 ${n} 首` : '輪播'}</button>`).join('')}<button type="button" class="skip" data-skip ${audio.prefs.music ? '' : 'disabled'}>下一首 ›</button></div><small id="nowPlaying"></small></div>`;
  openPanel('聲音', row('music', '背景音樂') + songs + row('sfx', '音效'));
  const showTrack = () => {
    const label = $('nowPlaying');
    if (!label) return;
    label.textContent = audio.prefs.music && audio.trackNo() ? `正在播放：第 ${audio.trackNo()} 首` : '';
    $('panelBody').querySelectorAll('[data-track]').forEach(b => b.setAttribute('aria-pressed', String((audio.prefs.pick || 0) === Number(b.dataset.track))));
  };
  audio.watchTrack(showTrack); showTrack();
  $('panelBody').querySelectorAll('[data-track]').forEach(b => b.addEventListener('click', () => audio.setTrack(Number(b.dataset.track))));
  $('panelBody').querySelector('[data-skip]').addEventListener('click', () => audio.skip());
  $('panelBody').querySelectorAll('[data-sound]').forEach(button => button.addEventListener('click', () => {
    audio.setPref(button.dataset.sound, !audio.prefs[button.dataset.sound]);
    $('panel').close(); syncSoundIcon(); soundPanel();
  }));
  $('panelBody').querySelectorAll('[data-vol]').forEach(slider => {
    slider.addEventListener('input', () => {
      audio.setVolume(slider.dataset.vol, Number(slider.value));
      slider.nextElementSibling.textContent = slider.value;
    });
    // 放開音效拉桿時放一聲，聽得到調到多大
    if (slider.dataset.vol === 'sfx') slider.addEventListener('change', () => audio.play('merge', 2));
  });
}
const syncSoundIcon = () => $('bSound').classList.toggle('off', !audio.prefs.music && !audio.prefs.sfx);
$('bSound').addEventListener('click', soundPanel);
for (const type of ['pointerdown', 'pointerup', 'keydown']) addEventListener(type, audio.unlock, { capture: true });
syncSoundIcon();

$('bGift').addEventListener('click', () => {
  const got = G.claimGift(state);
  if (!got) { audio.play('no'); toast('棋盤沒有空格，先合成或賣掉一些物品'); return; }
  fx[got.at] = 'pop-in'; sel = null; save(); render(); audio.play('pop');
});

$('banner').addEventListener('click', () => openHome(state));
$('banner').addEventListener('keydown', e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); openHome(state); } });

$('coinIcon').src = art('coin');
G.refill(state);
save(false);
render();
openHome(state);
setSaveState(SAVE_TEXT[cloudSave.status], cloudSave.status === 'loading');
cloudSave.load().finally(() => {
  ready = true;
  queueDex();
  setSaveState(SAVE_TEXT[cloudSave.status], false);
  claimEnergy();
});

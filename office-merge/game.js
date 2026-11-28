// 畫面與操作。規則在 logic.js。
import * as G from './logic.js';
import { art } from './art.js';
import * as audio from './audio.js';
import { celebrate } from './effects.js';
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
  if (player) cloudSave.changed();
}

/* ---------- 雲端存檔：玩到哪記到哪，換裝置接著玩 ---------- */
const SYNC_KEY = `officeMergeSync:${me}`;
const SAVE_TEXT = {
  off: me ? '進度只存在這台裝置：請回網站登入' : '訪客：進度只存在這台裝置',
  loading: '正在讀取雲端進度…', saving: '進度上傳中…', saved: '進度已存到雲端',
  offline: '連不上雲端，進度先存在這台裝置，會自動重傳', login: '登入已過期：請回網站重新登入，進度先存在這台裝置',
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
    if (s !== lastSaveStatus && (s === 'offline' || s === 'login') && !$('home').open) toast(SAVE_TEXT[s]);
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
  const badge = o.gen ? `<i class="lv"><img src="${art('star')}" alt=""><b>${o.lv}</b></i>` : '';
  return `<div class="${cls}"><img src="${img(o)}" alt="${G.nameOf(o)}">${badge}</div>`;
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
  $('orders').innerHTML = state.orders.map(o => {
    const ready = !!G.findNeed(state, o);
    const wants = o.need.map(r => {
      const has = [...state.cells, ...state.slots].some(c => same(c, r));
      return `<button type="button" class="${has ? 'has' : ''}" data-line="${r.line}" data-lv="${r.lv}" title="看看 ${G.nameOf(r)} 的圖鑑階段"><img src="${img(r)}" alt="${G.nameOf(r)}"></button>`;
    }).join('');
    return `<article class="order${o.rush ? ' rush' : ''}${ready ? ' ready' : ''}">
      ${o.rush ? '<em>急件×2</em>' : ''}<img class="face" src="${face(o.who)}" alt=""><div class="who">${o.who}</div><div class="need">${wants}</div>
      <button type="button" class="deliver" data-order="${o.id}" ${ready ? '' : 'disabled'}>${ready ? '交付 ' : ''}${coin()}${o.reward}</button></article>`;
  }).join('');
  $('coins').textContent = state.coins;
  const stage = G.stageInfo(state.done);
  $('stageNo').textContent = `第 ${stage.no} 關`;
  $('stageName').textContent = stage.name;
  $('stageCount').textContent = `${stage.have} / ${stage.goal}`;
  $('stageBar').style.width = stage.have / stage.goal * 100 + '%';
  const lv = G.levelInfo(state.xp);
  $('level').textContent = lv.level;
  $('xp').style.width = lv.have / lv.need * 100 + '%';
  renderEnergy();
  syncFlights();
  renderInfo();
  fx = {};
}

function renderInfo() {
  const o = sel && at(sel);
  if (!o) { $('info').innerHTML = '<div class="txt">點產生器拿物品，把兩個一樣的拖在一起合成。</div>'; return; }
  let tip;
  if (o.gen) tip = o.lv < G.GEN_MAX ? '點一下產出物品；兩台同級可合成升級' : '點一下產出物品（已最高級）';
  else tip = o.lv < G.MAX_LV ? `下一級：${state.seen[o.line + (o.lv + 1)] ? G.LINES[o.line].items[o.lv] : '？？？'}` : '已是最高級';
  $('info').innerHTML = `<img src="${img(o)}" alt=""><div class="txt"><b>${G.nameOf(o)}</b>${tip}</div>` +
    (o.gen ? '' : `<button type="button" class="sell" id="bSell">出售<span>${coin()}${G.value(o.lv)}</span></button>`);
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
addEventListener('pagehide', () => cloudSave.flush());
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
    點一次產生器花 1 點，每分鐘回 1 點（關掉遊戲也會回）。<br>
    ${wait ? `下一點：${clock(wait)}　回滿約 ${G.ENERGY_MAX - state.energy} 分鐘` : '能量已滿！'}<br>
    升級送 ${G.LEVEL_REWARD.energy} 點、過關也會送能量（可超過上限）。能量用完時，合成、交付和販售都還能做。<br>
    在元宇宙撿地上的道具，一個回饋 1 點能量。
    <div id="exchange"></div>`);
  exchangeBox();
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
    if (res.tired) { audio.play('no'); toast(`能量用完了！${clock(G.nextEnergyIn(state))} 後回 1 點`); }
    else if (res.full) { audio.play('no'); toast('棋盤滿了！合成或賣掉一些物品'); }
    else { born = res.at; audio.play('pop'); save(); }
  }
  render();
  if (born !== null) { popOut(p.i, born); navigator.vibrate?.(8); }
}

for (const id of ['board', 'slots']) $(id).addEventListener('pointerdown', onDown);
addEventListener('pointermove', onMove);
addEventListener('pointerup', onUp);
addEventListener('pointercancel', onUp);

$('info').addEventListener('click', e => {
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
    if (res) {
      sel = null; save(); render(); audio.play('coin'); sync(state);
      toast(`${res.order.who}：謝啦！+${res.order.reward} 金幣・+${res.xp} 經驗`);
      const c = res.cleared;
      if (c) celebrate({ kind: 'clear', medal: c.no, title: '過關！', text: `第 ${c.no} 關「${c.name}」完成`,
        extra: `${prize(c, c.coins)}<small>下一關：${c.next.name}（${c.next.goal} 張訂單）</small>`, button: '前往下一關' });
      for (const up of res.levelUps) celebrate({ kind: 'level', medal: up.level, title: '升級！', text: `你升到 Lv.${up.level} 了`, extra: prize(up), button: '太好了' });
    }
    return;
  }
  const n = e.target.closest('[data-line]');
  if (n) chainPanel(n.dataset.line, +n.dataset.lv);
});

const prize = (r, coins) => `<div class="prize">${coins ? `<span>${coin()}+${coins}</span>` : ''}<span title="經驗值"><i class="xp">XP</i>+${r.xp}</span><span title="能量"><i class="zap"></i>+${r.energy}</span></div>`;

// 任務物品提示：整條合成路線，標出要的是第幾階、手上有幾個
function chainPanel(line, lv) {
  const L = G.LINES[line], have = Array(G.MAX_LV + 1).fill(0);
  for (const c of [...state.cells, ...state.slots]) if (c && !c.box && !c.gen && c.line === line) have[c.lv]++;
  const steps = L.items.map((name, i) => {
    const n = i + 1, known = n === lv || have[n] || state.seen[line + n];
    return `<figure class="${[known ? '' : 'unk', n === lv ? 'target' : '', n > lv ? 'beyond' : ''].join(' ')}">
      ${n === lv ? '<em>任務要這個</em>' : ''}${have[n] ? `<i>×${have[n]}</i>` : ''}
      <img src="items/${line}${n}.png" alt=""><b>第 ${n} 階</b>${known ? name : '？？？'}</figure>`;
  }).join('');
  // 手上的低階物品折算成 1 級，算出還差多少
  const owned = have.reduce((s, count, n) => n && n <= lv ? s + count * G.value(n) : s, 0);
  const lack = Math.max(0, G.value(lv) - owned);
  openPanel(`${L.items[lv - 1]}・第 ${lv} 階`, `<div class="source"><img src="${art(line)}" alt=""><div>點 <b>${L.gen}</b> 取得第 1 階，兩個相同的合成下一階。</div></div>
    <div class="dex chain">${steps}</div>
    <div class="lack">${have[lv] ? '已經有了，回到訂單按「交付」就能交件（兩樣物品都要湊齊）。' : lack ? `還差約 <b>${lack}</b> 個第 1 階的量` : '材料夠了，合起來就好！'}</div>`);
}

/* ---------- 圖鑑與說明 ---------- */
function openPanel(title, html) { $('panelTitle').textContent = title; $('panelBody').innerHTML = html; $('panel').showModal(); }
$('panelClose').addEventListener('click', () => $('panel').close());

$('bDex').addEventListener('click', () => {
  openPanel(`圖鑑 ${Object.keys(state.seen).length} / ${Object.keys(G.LINES).length * G.MAX_LV}`, Object.entries(G.LINES).map(([k, line]) =>
    `<h3>${line.gen}</h3><div class="dex">${line.items.map((name, n) => {
      const ok = state.seen[k + (n + 1)];
      return `<figure class="${ok ? '' : 'unk'}"><img src="items/${k}${n + 1}.png" alt="">${n + 1}. ${ok ? name : '？？？'}</figure>`;
    }).join('')}</div>`).join(''));
});

$('bHelp').addEventListener('click', () => {
  openPanel('怎麼玩', `<h3>目標</h3>幫同事準備他們要的東西，賺金幣。
    完成指定張數的訂單就過關。<br>點訂單上的物品圖示，可以看它的合成階段。
    <h3>能量</h3>上限 100 點，點一次產生器花 1 點，每分鐘回 1 點。
    <h3>操作</h3>點產生器（文具櫃、茶水間）拿物品。<br>把兩個一樣的拖在一起，合成高一級。<br>在紙箱旁邊合成，紙箱就會打開。<br>紙箱裡藏著第二台產生器，合成後更容易掉高級物品。<br>訂單湊齊後按「交付」。用不到的可以點選後賣掉，或放到左下暫存格。
    <h3>存檔</h3>登入後每一步都會存到雲端，換手機或電腦登入同一帳號就能接著玩。<br>目前：${SAVE_TEXT[cloudSave.status]}
    <div class="row"><button type="button" class="danger" id="bReset">重新開始</button></div>`);
  $('bReset').addEventListener('click', () => {
    if (!confirm('確定重新開始？目前進度會清掉。')) return;
    state = G.newGame(); sel = null; save(); render(); $('panel').close();
  });
});

$('bEnergy').addEventListener('click', () => { energyPanel(); claimEnergy(); });
$('bMenu').addEventListener('click', () => openHome(state));
onFaces(render);

function soundPanel() {
  const row = (key, label) => `<button type="button" class="switch${audio.prefs[key] ? ' on' : ''}" data-sound="${key}" aria-pressed="${audio.prefs[key]}">${label}<span>${audio.prefs[key] ? '開' : '關'}</span></button>`;
  openPanel('聲音', row('music', '背景音樂') + row('sfx', '音效'));
  $('panelBody').querySelectorAll('[data-sound]').forEach(b => b.addEventListener('click', () => {
    audio.setPref(b.dataset.sound, !audio.prefs[b.dataset.sound]);
    $('panel').close(); syncSoundIcon(); soundPanel();
  }));
}
const syncSoundIcon = () => $('bSound').classList.toggle('off', !audio.prefs.music && !audio.prefs.sfx);
$('bSound').addEventListener('click', soundPanel);
for (const type of ['pointerdown', 'pointerup', 'keydown']) addEventListener(type, audio.unlock, { capture: true });
syncSoundIcon();

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
  setSaveState(SAVE_TEXT[cloudSave.status], false);
  claimEnergy();
});

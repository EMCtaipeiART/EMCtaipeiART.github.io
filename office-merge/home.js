// 首頁：蜿蜒闖關地圖。一關一站，沿著彎曲的小路由下往上走，越後面站與站隔得越遠；同仁站在自己目前那一關。
import * as G from './logic.js';
import { me, getRanks, onRanks, sync } from './cloud.js';
import * as cloud from './cloud.js';
import { face, onFaces, GHOST } from './chars.js';

const $ = id => document.getElementById(id);
const TOP = G.CHAPTERS.length + 1;   // 最上層：加班挑戰
// 本機網址加 ?demo 可以看有人分布在各樓層的版面，畫面上會標明是示範資料
const demo = /(^|\.)(localhost|127\.0\.0\.1)$/.test(location.hostname) && new URLSearchParams(location.search).has('demo');
const others = () => demo ? Object.fromEntries(G.PEOPLE.slice(0, 10).map((n, i) => [n, { done: 200 - i * 17, xp: 0, level: [51, 44, 33, 27, 20, 15, 12, 8, 4, 1][i], progress: i % 2 }])) : getRanks();
// 排行紀錄（或自己的存檔）換成樓層資訊
const stageOf = p => G.stageInfo({ chapter: Math.min((p.level || 1) - 1, G.CHAPTERS.length), progress: p.progress || 0, overtime: 0 });
const ahead = (a, b) => ((a.level || 1) - (b.level || 1)) || ((a.progress || 0) - (b.progress || 0)) || (a.xp - b.xp);

export function ranking(state) {
  const all = {};
  for (const [name, p] of Object.entries(others())) if (G.PEOPLE.includes(name)) all[name] = p;
  // 自己的樓層：取雲端最佳紀錄與這台裝置較前面的那個
  const mine = { level: G.stageInfo(state).no, progress: G.stageInfo(state).have, done: state.done, xp: state.xp };
  if (me && !(all[me] && ahead(all[me], mine) > 0)) all[me] = mine;
  const ranked = Object.entries(all)
    .map(([name, p]) => ({ name, ...p, level: p.level || 1, stage: stageOf(p) }))
    .sort((a, b) => ahead(b, a));
  ranked.forEach((p, i) => {
    const prev = ranked[i - 1];
    p.rank = prev && !ahead(prev, p) ? prev.rank : i + 1;
  });
  return { ranked, waiting: G.PEOPLE.filter(n => !all[n]) };
}

// 上榜的人用自己的角色；沒登入（還沒上榜、訪客）一律是透明人
const person = p => {
  const mine = me ? p.name === me : p.guest;
  const look = p.rank ? p.name : GHOST;
  return `<figure class="climber${mine ? ' me' : ''}${p.rank && p.rank <= 3 ? ` top${p.rank}` : ''}${look === GHOST ? ' ghost' : ''}">
  ${p.rank ? `<i>${p.rank}</i>` : ''}<img src="${face(look)}" alt=""><figcaption>${p.name}${p.stage ? `<small>${p.stage.have}/${p.stage.goal}</small>` : ''}</figcaption></figure>`;
};

// 版面：高度單位 px，左右用百分比。蛇行幅度不固定，看起來比較自然
const xOf = n => Math.round(50 + 26 * Math.sin(n * 1.15) + 5 * Math.sin(n * .47));
// 第 n 關和下一站（往下）之間的距離：越後面越遠
const gapOf = n => Math.round(78 + n * .8);
const CROWD = 150, NODE_UP = 40;   // 有人站的那一關上方至少留的高度；最底站離地圖底部
const DECOR = Object.keys(G.LINES).flatMap(k => [3, 5, 7, 4, 6].map(n => k + n));
// 小路：每兩站中間多放一個往旁邊盪的轉折點（距離越長盪得越開），再用平滑曲線串起來。
// 回傳每一段的 SVG 指令，rows[i] 的起點是第 i*2 段。
function curve(rows) {
  const pts = rows.flatMap((a, i) => {
    const b = rows[i + 1];
    if (!b) return [a];
    const sway = (a.n % 2 ? 1 : -1) * Math.min(20, Math.max(0, b.y - a.y - 80) * .2);
    return [a, { x: Math.max(8, Math.min(92, (a.x + b.x) / 2 + sway)), y: (a.y + b.y) / 2 }];
  });
  const c = v => Math.round(v * 10) / 10;
  return pts.slice(1).map((q, i) => {
    const p = pts[i], o = pts[i - 1] || p, r = pts[i + 2] || q;
    return `C${c(p.x + (q.x - o.x) / 6)} ${c(p.y + (q.y - o.y) / 6)} ${c(q.x - (r.x - p.x) / 6)} ${c(q.y - (r.y - p.y) / 6)} ${q.x} ${q.y}`;
  });
}

function tower(state) {
  const { ranked, waiting } = ranking(state);
  // 訪客以透明人站在自己的那一關，不佔名次
  const guest = me ? [] : [{ name: '訪客（你）', guest: true, level: G.stageInfo(state).no, stage: G.stageInfo(state) }];
  // 自己站的位置以排行紀錄與這台裝置較前面的為準
  const mineNo = Math.min(ranked.find(p => p.name === me)?.level || G.stageInfo(state).no, TOP);
  const rows = [];
  let y = 0;
  for (let n = TOP; n >= 1; n--) {
    const here = [...ranked, ...guest].filter(p => Math.min(p.level, TOP) === n);
    const above = n === TOP ? 60 : gapOf(n);   // 和上一站的距離
    const need = here.length ? CROWD + Math.floor((here.length - 1) / 4) * 84 : 0;
    y += Math.max(above, need);
    rows.push({ n, here, x: xOf(n), y });
  }
  // 小路：由上往下連；走過的段落另外上色
  const segs = curve(rows);
  const path = from => `M${rows[from].x} ${rows[from].y}${segs.slice(from * 2).join('')}`;
  const mineAt = rows.findIndex(r => r.n === mineNo);
  const height = y + NODE_UP;
  const stops = rows.map((r, i) => {
    const mine = r.here.some(p => me ? p.name === me : p.guest);
    const status = r.n < mineNo ? 'done' : r.n === mineNo ? 'now' : 'locked';
    const title = r.n === TOP ? '加班挑戰' : G.CHAPTERS[r.n - 1].title;
    const crowd = r.here.length ? `<div class="crowd" style="left:clamp(132px,${r.x}%,calc(100% - 132px));bottom:${height - r.y + 24}px">${r.here.map(person).join('')}</div>` : '';
    // 站與站之間的路邊擺設：放在路的另一側
    const below = rows[i + 1];
    const decor = below && r.n % 3 === 0 ? `<img class="decor" loading="lazy" alt="" src="items/${DECOR[(r.n / 3) % DECOR.length]}.png" style="left:${(r.x + below.x) / 2 > 50 ? 12 + r.n % 7 : 82 - r.n % 7}%;top:${Math.round((r.y + below.y) / 2)}px">` : '';
    return `${decor}<button type="button" class="stop ${status}${r.n % 10 === 0 ? ' big' : ''}${r.n === TOP ? ' roof' : ''}${mine ? ' mine' : ''}" data-level="${r.n}" style="left:${r.x}%;top:${r.y}px" aria-label="第 ${r.n} 關 ${title}">${r.n === TOP ? '★' : r.n}</button>
      <span class="stop-name ${status}${r.x > 50 ? ' left' : ''}" style="left:${r.x}%;top:${r.y}px">${status === 'locked' ? '🔒 ' : status === 'done' ? '✓ ' : ''}${title}</span>${crowd}`;
  }).join('');
  // 背景由下往上換色：草地 → 晴空 → 黃昏 → 夜空
  const at = n => Math.round(rows[TOP - n].y);
  const sky = `linear-gradient(180deg,#4b3f8f 0,#8a6fd1 ${at(125)}px,#ffb08a ${at(95)}px,#ffe3a6 ${at(70)}px,#9fdcff ${at(40)}px,#cdf0ff ${at(20)}px,#d9f6bf ${at(8)}px,#c4ec9c 100%)`;
  return `<div class="map" style="height:${height}px;--sky:${sky}"><svg viewBox="0 0 100 ${height}" preserveAspectRatio="none" aria-hidden="true">
      <path class="edge" d="${path(0)}"/><path class="road" d="${path(0)}"/><path class="walked" d="${mineNo > 1 ? path(mineAt) : ''}"/><path class="dash" d="${path(0)}"/></svg>${stops}</div>
    <section class="lobby"><header><b>大廳</b>尚未上榜</header><div class="row">${waiting.map(name => person({ name })).join('')}</div></section>`;
}

// 點站點：下方說明這一關
function describe(n) {
  if (n >= TOP) return `加班挑戰：${G.CHAPTERS.length} 關全部完成後開放`;
  const c = G.CHAPTERS[n - 1];
  return `第 ${n} 關・${c.title}｜一般訂單 ${G.levelGoal(n - 1)} 張，任務：${c.need.map(code => G.LINES[code[0]].items[Number(code.slice(1)) - 1]).join('＋')}`;
}

let shown = null;   // 目前畫面對應的遊戲狀態

function note(mine) {
  if (demo) return '示範資料（不是真實排名）';
  if (cloud.status === 'error') return '排行榜暫時連不上，遊戲照常可以玩';
  if (cloud.status === 'off') return '本機預覽：未連接雲端排行榜';
  if (!me) return '從元宇宙或網站登入後進入，成績才會上榜';
  if (cloud.status === 'loading') return '排行榜讀取中…';
  return mine ? `目前第 ${mine.rank} 名・第 ${mine.stage.no} 關` : '';
}
function draw(scroll) {
  const keep = $('tower').scrollTop;
  $('tower').innerHTML = tower(shown);
  const mine = ranking(shown).ranked.find(p => p.name === me);
  $('myRank').textContent = note(mine);
  $('whoami').innerHTML = `<img src="${face(me || GHOST)}" alt="">${me ? `我是 ${me}` : '訪客'}`;
  if (!scroll) { $('tower').scrollTop = keep; return; }
  const target = $('tower').querySelector('.stop.mine') || $('tower').querySelector('.lobby');
  $('tower').scrollTop = target.offsetTop - $('tower').clientHeight * .55;
}

// 雲端進度讀回來後換掉畫面上的資料
export function refreshHome(state) {
  shown = state;
  if ($('home').open) draw(true);
  sync(state);
}
export function setSaveState(text, busy) {
  $('saveState').textContent = text;
  $('bStart').disabled = busy;
  $('bStart').textContent = busy ? '讀取進度中…' : '開始遊戲';
  if (!busy && $('home').open) $('bStart').focus();
}

export function openHome(state) {
  shown = state;
  const dlg = $('home');
  if (!dlg.open) dlg.showModal();
  draw(true);
  sync(state);
  $('bStart').focus();
}
let first = true;
onRanks(() => { if (shown && $('home').open) { draw(first); first = false; } });
$('home').addEventListener('cancel', e => e.preventDefault());
$('tower').addEventListener('click', e => {
  const stop = e.target.closest('[data-level]');
  if (stop) $('myRank').textContent = describe(Number(stop.dataset.level));
});
$('bStart').addEventListener('click', () => $('home').close());

onFaces(() => { if (shown && $('home').open) draw(false); });

// 離開遊戲：從元宇宙開啟（內嵌）就回辦公室，直接開網址就回網站首頁
$('bLeave').addEventListener('click', () => {
  if (new URLSearchParams(location.search).has('embed') && parent !== window) parent.postMessage({ type: 'expeditionExit' }, location.origin);
  else location.href = '../index.html';
});

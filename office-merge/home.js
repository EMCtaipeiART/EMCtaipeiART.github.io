// 首頁：辦公室迷宮塔。一關一層樓，由下往上爬；同仁站在自己目前的樓層。
import * as G from './logic.js';
import { me, getRanks, onRanks, sync } from './cloud.js';
import * as cloud from './cloud.js';

const $ = id => document.getElementById(id);
const face = name => `people/p${G.PEOPLE.indexOf(name) + 1}.png`;
const TOP = G.STAGES.length + 1;   // 最上層：加班挑戰
const DECOR = ['s2', 't3', 's4', 't4', 's5', 't5', 's6', 't6', 's7'];

// 本機網址加 ?demo 可以看有人分布在各樓層的版面，畫面上會標明是示範資料
const demo = /(^|\.)(localhost|127\.0\.0\.1)$/.test(location.hostname) && new URLSearchParams(location.search).has('demo');
const others = () => demo ? Object.fromEntries(G.PEOPLE.slice(0, 10).map((n, i) => [n, { done: [58, 41, 33, 27, 20, 15, 13, 8, 4, 1][i], xp: 0 }])) : getRanks();

export function ranking(state) {
  const all = {};
  for (const [name, p] of Object.entries(others())) if (G.PEOPLE.includes(name)) all[name] = { done: p.done, xp: p.xp };
  // 自己的樓層：取雲端最佳紀錄與這台裝置較前面的那個
  if (me && !(all[me] && (all[me].done > state.done || (all[me].done === state.done && all[me].xp > state.xp)))) all[me] = { done: state.done, xp: state.xp };
  const ranked = Object.entries(all)
    .map(([name, p]) => ({ name, ...p, stage: G.stageInfo(p.done) }))
    .sort((a, b) => b.done - a.done || b.xp - a.xp);
  ranked.forEach((p, i) => {
    const prev = ranked[i - 1];
    p.rank = prev && prev.done === p.done && prev.xp === p.xp ? prev.rank : i + 1;
  });
  return { ranked, waiting: G.PEOPLE.filter(n => !all[n]) };
}

const person = p => `<figure class="climber${p.name === me ? ' me' : ''}${p.rank <= 3 ? ` top${p.rank}` : ''}">
  ${p.rank ? `<i>${p.rank}</i>` : ''}<img src="${face(p.name)}" alt=""><figcaption>${p.name}${p.stage ? `<small>${p.stage.have}/${p.stage.goal}</small>` : ''}</figcaption></figure>`;

// 迷宮的走道與隔間牆；奇數層往右走、偶數層往左走，樓梯就接成一條往上的路
function maze(floor) {
  const route = 'M12 100V74H30V56H50V78H70V52H88V0';
  const walls = 'M0 30H22V44M36 0V36H46M60 20H78V34M60 20V40M0 62H4M20 100V88H42V94M40 70V62M60 100V66M78 100V90H96M96 66H100M4 12H14';
  return `<svg viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden="true"${floor % 2 ? '' : ' class="flip"'}>
    <path class="wall" d="${walls}"/><path class="road" d="${floor === 0 ? 'M50 78H70V52H88V0' : route}"/><path class="dash" d="${floor === 0 ? 'M50 78H70V52H88V0' : route}"/></svg>`;
}

function tower(state) {
  const { ranked, waiting } = ranking(state);
  const floors = [];
  for (let n = TOP; n >= 1; n--) {
    const here = ranked.filter(p => Math.min(p.stage.no, TOP) === n);
    const stage = n === TOP ? G.stageInfo(G.STAGES.reduce((s, x) => s + x.goal, 0)) : G.STAGES[n - 1];
    floors.push(`<section class="floor${n === TOP ? ' roof' : ''}${here.some(p => p.name === me) ? ' mine' : ''}">${maze(n)}
      <header><b>${n === TOP ? '★' : `${n}F`}</b>${n === TOP ? stage.name : `第 ${n} 關・${stage.name}`}</header>
      <img class="decor" src="items/${DECOR[n - 1]}.png" alt="">
      <div class="crowd">${here.map(person).join('')}</div></section>`);
  }
  floors.push(`<section class="floor lobby">${maze(0)}<header><b>大廳</b>尚未上榜</header>
    <div class="crowd">${waiting.map(name => person({ name })).join('')}</div></section>`);
  return floors.join('');
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
  $('whoami').textContent = me ? `我是 ${me}` : '訪客';
  if (!scroll) { $('tower').scrollTop = keep; return; }
  const target = $('tower').querySelector('.floor.mine') || $('tower').lastElementChild;
  $('tower').scrollTop = target.offsetTop + target.offsetHeight / 2 - $('tower').clientHeight / 2;
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
$('bStart').addEventListener('click', () => $('home').close());

// 從元宇宙開啟時（內嵌）：右上角可以離開，回到辦公室
if (new URLSearchParams(location.search).has('embed') && parent !== window) {
  $('bLeave').hidden = false;
  $('bLeave').addEventListener('click', () => parent.postMessage({ type: 'expeditionExit' }, location.origin));
}

// 首頁：辦公室迷宮塔。一關一層樓，由下往上爬；同仁站在自己目前的樓層。
import * as G from './logic.js';
import { me, getRanks, onRanks, sync } from './cloud.js';
import * as cloud from './cloud.js';
import { face, onFaces, GHOST } from './chars.js';

const $ = id => document.getElementById(id);
const TOP = G.CHAPTERS.length + 1;   // 最上層：加班挑戰
const DECOR = Object.keys(G.LINES).flatMap(k => [2, 3, 4, 5, 6].map(n => k + n));
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

// 迷宮的走道與隔間牆；奇數層往右走、偶數層往左走，樓梯就接成一條往上的路
function maze(floor) {
  const route = 'M12 100V74H30V56H50V78H70V52H88V0';
  const walls = 'M0 30H22V44M36 0V36H46M60 20H78V34M60 20V40M0 62H4M20 100V88H42V94M40 70V62M60 100V66M78 100V90H96M96 66H100M4 12H14';
  return `<svg viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden="true"${floor % 2 ? '' : ' class="flip"'}>
    <path class="wall" d="${walls}"/><path class="road" d="${floor === 0 ? 'M50 78H70V52H88V0' : route}"/><path class="dash" d="${floor === 0 ? 'M50 78H70V52H88V0' : route}"/></svg>`;
}

function tower(state) {
  const { ranked, waiting } = ranking(state);
  // 訪客以透明人站在自己的樓層，不佔名次
  const guest = me ? [] : [{ name: '訪客（你）', guest: true, level: G.stageInfo(state).no, stage: G.stageInfo(state) }];
  const floors = [];
  for (let n = TOP; n >= 1; n--) {
    const here = [...ranked, ...guest].filter(p => Math.min(p.level, TOP) === n);
    floors.push(`<section class="floor${here.length ? '' : ' empty'}${n === TOP ? ' roof' : ''}${here.some(p => me ? p.name === me : p.guest) ? ' mine' : ''}">${maze(n)}
      <header><b>${n === TOP ? '★' : `${n}F`}</b>${n === TOP ? '加班挑戰' : `第 ${n} 關・${G.CHAPTERS[n - 1].title}`}</header>
      <img class="decor" loading="lazy" src="items/${DECOR[(n - 1) % DECOR.length]}.png" alt="">
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
  $('whoami').innerHTML = `<img src="${face(me || GHOST)}" alt="">${me ? `我是 ${me}` : '訪客'}`;
  if (!scroll) { $('tower').scrollTop = keep; return; }
  const target = $('tower').querySelector('.floor.mine') || $('tower').lastElementChild;
  $('tower').scrollTop = target.offsetTop + target.offsetHeight / 2 - $('tower').clientHeight / 2;
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
$('bStart').addEventListener('click', () => $('home').close());

onFaces(() => { if (shown && $('home').open) draw(false); });

// 離開遊戲：從元宇宙開啟（內嵌）就回辦公室，直接開網址就回網站首頁
$('bLeave').addEventListener('click', () => {
  if (new URLSearchParams(location.search).has('embed') && parent !== window) parent.postMessage({ type: 'expeditionExit' }, location.origin);
  else location.href = '../index.html';
});

// 辦公室翻身記｜遊戲規則（不碰畫面，方便測試）。數值要調整都在這個檔案最上面。
import { CHAPTERS } from './story.js';
export { CHAPTERS };
export const COLS = 7, ROWS = 9, SIZE = COLS * ROWS, SLOTS = 2, MAX_LV = 7, GEN_MAX = 3;
export const ENERGY_MAX = 100, ENERGY_MS = 60000;   // 能量上限；每幾毫秒回 1 點
export const COIN_PRICE = 1000, COIN_ENERGY = 100;   // 金幣換能量
export const SAVE_VERSION = 4;                      // 存檔格式版本；舊版遊戲讀不懂新版，雲端會擋住它覆蓋
export const RANK_MAX = 5;                          // 每條物品線的圖鑑等級上限（靠劇情提升）
export const RANK_BONUS = { reward: .15, lucky: .07 };   // 每升一級：該線訂單金幣 +20%、產生器多掉一階的機率 +10%
export const START_LINES = ['s', 't'];
export const chapterReward = n => ({ coins: 200 + n * 60, energy: 30 + n, xp: 30 + n * 5 });   // 過第 n+1 關（n 從 0 起算）
// 獎勵、撿道具、兌換來的能量可以超過上限、沒有天花板（超過時不會自然回復，用掉才會繼續回）
export const LEVEL_REWARD = { energy: 30, xp: 10 };                        // 每升一級
export const orderXp = need => need.reduce((s, r) => s + r.lv * 5, 0);     // 交付訂單的經驗值
const levelCost = level => 40 + (level - 1) * 20;                          // 從 level 升下一級要多少經驗

/* ---------- 關卡＝劇情章節（story.js）。每關先做幾張一般訂單，再交劇情任務過關 ---------- */
// 一般訂單張數：前面 2 張，每 8 關多 1 張，最多 6 張
export const levelGoal = n => Math.min(6, 2 + Math.floor(n / 8));
// 一般訂單要求的物品等級：[從第幾關起（0 起算）, 最低, 最高]
const RANGES = [[40, 4, 6], [30, 4, 5], [20, 3, 5], [12, 3, 4], [5, 2, 4], [0, 2, 3]];
// 全部過完後的「加班挑戰」：每幾張訂單算一輪、每輪獎勵
export const EXTRA_GOAL = 10;
export const extraReward = round => ({ coins: 500 + round * 50, energy: 50, xp: 80 });

export const LINES = {
  s: { gen: '文具櫃', items: ['迴紋針盒', '原子筆', '便利貼', '筆記本', '訂書機', '計算機', '豪華辦公禮盒'] },
  t: { gen: '茶水間', items: ['零食糖', '茶包', '熱咖啡', '珍珠奶茶', '甜甜圈', '草莓蛋糕', '豪華便當'] },
  i: { gen: 'IT 倉庫', items: ['充電線', '隨身碟', '滑鼠', '鍵盤', '耳機', '平板', '空拍機'] },
  m: { gen: '會議室', items: ['白板筆', '板擦', '簡報翻頁筆', '遙控器', '無線麥克風', '投影布捲', '手持相機'] },
  d: { gen: '設計桌', items: ['橡皮擦', '螢光筆', '手寫筆', '麥克筆組', '色票', '色票本', '地板樣品'] },
  w: { gen: '福利櫃', items: ['發票', '悠遊卡', '加班餐券', '優良員工貼紙', '置物櫃鑰匙', '員工證', '尾牙抽獎券'] },
};
// 產生器各等級掉出 1、2、3 級物品的機率
const DROPS = [[1], [.75, .25], [.55, .35, .1]];
// 訂單角色＝多元宇宙辦公室的人物（圖在 chars.js 載入）
export const PEOPLE = ['Amber', 'Anna', 'Leona', 'Machi', 'Noise', '余采馨', '吳冠賢', '廖秦葦', '李明庭', '鄭筱舢', '黎子瑄', '王藍庭'];

export const value = lv => 2 ** (lv - 1);
export const nameOf = o => o.gen ? `${LINES[o.line].gen} Lv.${o.lv}` : LINES[o.line].items[o.lv - 1];
export function levelInfo(xp) {
  let level = 1, have = xp;
  while (have >= levelCost(level)) { have -= levelCost(level); level++; }
  return { level, have, need: levelCost(level) };
}
// 舊存檔沒有經驗值：換算成原本顯示的等級
const xpForLevel = level => Array.from({ length: level - 1 }, (_, i) => levelCost(i + 1)).reduce((a, b) => a + b, 0);

// 目前第幾關、一般訂單做了幾張（存檔或排行紀錄都能算）
export function stageInfo(state) {
  const n = state.chapter || 0;
  if (n < CHAPTERS.length) {
    const goal = levelGoal(n), have = Math.min(goal, state.progress || 0);
    const [, lo, hi] = RANGES.find(r => n >= r[0]);
    return { no: n + 1, name: CHAPTERS[n].title, goal, have, ready: have >= goal, range: [lo, hi], extra: false };
  }
  const extra = state.overtime || 0;
  return { no: CHAPTERS.length + 1 + Math.floor(extra / EXTRA_GOAL), name: '加班挑戰', goal: EXTRA_GOAL, have: extra % EXTRA_GOAL, ready: false, range: [4, 6], extra: true };
}
const pick = (a, rnd) => a[Math.floor(rnd() * a.length)];
export const neighbors = i => {
  const x = i % COLS, y = Math.floor(i / COLS), out = [];
  if (x > 0) out.push(i - 1);
  if (x < COLS - 1) out.push(i + 1);
  if (y > 0) out.push(i - COLS);
  if (y < ROWS - 1) out.push(i + COLS);
  return out;
};

export function newGame(rnd = Math.random, now = Date.now()) {
  const at = (x, y) => y * COLS + x;
  const cells = Array.from({ length: SIZE }, (_, i) => {
    const x = i % COLS, y = Math.floor(i / COLS);
    if (x >= 1 && x <= 5 && y >= 2 && y <= 5) return null;
    const line = pick(START_LINES, rnd);
    return { box: true, hold: rnd() < .45 ? { line, lv: rnd() < .75 ? 1 : 2 } : null };
  });
  cells[at(1, 2)] = { gen: true, line: 's', lv: 1 };
  cells[at(5, 2)] = { gen: true, line: 't', lv: 1 };
  // 藏在紙箱裡的第二台產生器，打開後可合成升級
  cells[at(1, 6)] = { box: true, hold: { gen: true, line: 's', lv: 1 } };
  cells[at(5, 6)] = { box: true, hold: { gen: true, line: 't', lv: 1 } };
  for (const [x, y, line] of [[2, 4, 's'], [3, 4, 's'], [3, 3, 't'], [4, 4, 't']]) cells[at(x, y)] = { line, lv: 1 };
  const state = { v: 1, ver: SAVE_VERSION, lines: [...START_LINES], rank: {}, chapter: 0, progress: 0, overtime: 0, cells, slots: Array(SLOTS).fill(null), coins: 0, done: 0, xp: 0, made: 0, seen: {}, orders: [], energy: ENERGY_MAX, energyAt: now };
  for (const c of cells) if (c && !c.box) see(state, c);
  fillOrders(state, rnd);
  return state;
}

function see(state, o) { if (!o.gen) state.seen[o.line + o.lv] = true; }

// 依經過的時間回能量。energyAt＝上次結算到的時間點
export function refill(state, now = Date.now()) {
  if (state.energy >= ENERGY_MAX || now < state.energyAt) { state.energyAt = now; return; }
  const got = Math.floor((now - state.energyAt) / ENERGY_MS);
  if (got <= 0) return;
  state.energy = Math.min(ENERGY_MAX, state.energy + got);
  state.energyAt = state.energy >= ENERGY_MAX ? now : state.energyAt + got * ENERGY_MS;
}
// 距離下一點還有幾毫秒（滿了回 0）
export const nextEnergyIn = (state, now = Date.now()) => state.energy >= ENERGY_MAX ? 0 : Math.max(0, state.energyAt + ENERGY_MS - now);

export const rankOf = (state, line) => state.rank?.[line] || 1;

// 目前關卡決定難度；每第 5 張是急件大單
export function makeOrder(state, rnd = Math.random) {
  state.made++;
  const n = state.done, rush = state.made % 5 === 0;
  const [lo, hi] = stageInfo(state).range;
  const taken = state.orders.map(o => o.who);
  const who = pick(PEOPLE.filter(name => !taken.includes(name)), rnd);
  const count = rush || n < 2 ? 1 : rnd() < .5 ? 2 : 1;
  const need = Array.from({ length: count }, () => ({
    line: pick(state.lines, rnd),
    lv: rush ? Math.min(MAX_LV, hi + 1) : lo + Math.floor(rnd() * (hi - lo + 1)),
  }));
  const reward = Math.round(need.reduce((s, r) => s + value(r.lv) * 5 * (1 + RANK_BONUS.reward * (rankOf(state, r.line) - 1)), 0)) * (rush ? 2 : 1);
  return { id: state.made, who, need, reward, rush };
}

// 劇情還沒走完時，第一張訂單固定是目前章節的任務
function storyOrder(state) {
  const c = chapter(state);
  state.made++;
  return { id: state.made, who: c.say[0][0], need: c.need, reward: chapterReward(state.chapter).coins, rush: false, story: state.chapter };
}
// 補滿三張訂單，並讓第一張和目前章節一致
function fillOrders(state, rnd) {
  const first = state.orders[0];
  if (chapter(state)) {
    if (first?.story !== state.chapter) state.orders.splice(0, first ? 1 : 0, storyOrder(state));
  } else if (first && first.story !== undefined) state.orders.splice(0, 1, makeOrder(state, rnd));
  while (state.orders.length < 3) state.orders.push(makeOrder(state, rnd));
}

// 舊存檔補上新欄位；訂單角色（會計、老闆…）換成現在的人物，棋盤進度保留
export function upgradeSave(s, rnd = Math.random, now = Date.now()) {
  if (!s) return s;
  if (!Number.isFinite(s.energy) || !Number.isFinite(s.energyAt)) { s.energy = ENERGY_MAX; s.energyAt = now; }
  s.ver = SAVE_VERSION;
  if (!Array.isArray(s.lines)) s.lines = [...START_LINES];
  s.rank ||= {};
  if (!Number.isInteger(s.chapter)) s.chapter = 0;
  if (!Number.isInteger(s.progress)) s.progress = 0;
  if (!Number.isInteger(s.overtime)) s.overtime = 0;
  if (!Number.isFinite(s.xp)) s.xp = xpForLevel(1 + Math.floor((s.done || 0) / 3));
  if (Array.isArray(s.orders)) {
    if (s.orders.some(o => !PEOPLE.includes(o?.who))) s.orders = [];
    fillOrders(s, rnd);
  }
  return s;
}

const area = (state, a) => a === 'slot' ? state.slots : state.cells;
export const canMerge = (a, b) => !!a && !!b && !a.box && !b.box && !!a.gen === !!b.gen &&
  a.line === b.line && a.lv === b.lv && a.lv < (a.gen ? GEN_MAX : MAX_LV);

// from / to：{ a: 'cell' | 'slot', i }
export function move(state, from, to) {
  if (from.a === to.a && from.i === to.i) return null;
  const src = area(state, from.a), dst = area(state, to.a);
  const a = src[from.i], b = dst[to.i];
  if (!a || a.box || (b && b.box)) return null;
  if (to.a === 'cell' && canMerge(a, b)) {
    const next = { ...b, lv: b.lv + 1 };
    dst[to.i] = next; src[from.i] = null; see(state, next);
    const opened = [];
    for (const j of neighbors(to.i)) {
      const c = state.cells[j];
      if (c && c.box) { state.cells[j] = c.hold; if (c.hold) see(state, c.hold); opened.push(j); }
    }
    return { type: 'merge', item: next, opened };
  }
  src[from.i] = b; dst[to.i] = a;
  return { type: 'move' };
}

// 點產生器：花 1 點能量，把物品放到最近的空格
export function spawn(state, i, rnd = Math.random, now = Date.now()) {
  const g = state.cells[i];
  if (!g || !g.gen) return null;
  refill(state, now);
  if (state.energy <= 0) return { tired: true };
  const x = i % COLS, y = Math.floor(i / COLS);
  const dist = j => Math.abs(j % COLS - x) + Math.abs(Math.floor(j / COLS) - y);
  const empty = state.cells.map((c, j) => c ? -1 : j).filter(j => j >= 0).sort((p, q) => dist(p) - dist(q));
  if (!empty.length) return { full: true };
  const odds = DROPS[g.lv - 1];
  let r = rnd(), lv = 1;
  for (let k = 0; k < odds.length; k++) { if (r < odds[k]) { lv = k + 1; break; } r -= odds[k]; }
  const rank = rankOf(state, g.line);
  if (rank > 1 && rnd() < RANK_BONUS.lucky * (rank - 1)) lv = Math.min(MAX_LV, lv + 1);
  const item = { line: g.line, lv };
  state.cells[empty[0]] = item; see(state, item);
  state.energy--;
  return { at: empty[0], item };
}

// 領到雲端發的能量（撿道具、平台幣兌換）。同一個領取編號只加一次
export function addBonus(state, id, amount, now = Date.now()) {
  state.claims ||= [];
  if (!Number.isInteger(amount) || amount <= 0 || state.claims.includes(id)) return 0;
  refill(state, now);
  state.energy += amount;
  state.claims = [...state.claims, id].slice(-20);
  return amount;
}

// 金幣換能量
export function buyEnergy(state, now = Date.now()) {
  if (state.coins < COIN_PRICE) return false;
  refill(state, now);
  state.coins -= COIN_PRICE; state.energy += COIN_ENERGY;
  return true;
}

export function sell(state, from) {
  const src = area(state, from.a), o = src[from.i];
  if (!o || o.box || o.gen) return 0;
  src[from.i] = null;
  state.coins += value(o.lv);
  return value(o.lv);
}

/* ---------- 劇情 ---------- */
// 目前章節；全部完成回傳 null
export function chapter(state) {
  const c = CHAPTERS[state.chapter];
  return c ? { ...c, no: state.chapter + 1, need: c.need.map(code => ({ line: code[0], lv: Number(code.slice(1)) })) } : null;
}
// 解鎖新物品線的任務要有地方放產生器（交出去的棋盤物品空出來的格子也算）
export function needsSpace(state, order) {
  if (order.story === undefined || !CHAPTERS[order.story]?.unlock) return false;
  const used = findNeed(state, order);
  return !!used && !state.cells.some(o => !o) && !used.some(u => u.a === 'cell');
}

// 交付訂單。一般訂單推進本關進度；劇情任務要進度滿了才能交，交了就過關。
// 回傳 { order, xp, levelUps, cleared（過了哪一關：章節、獎勵、下一關；或 null） }；不能交回傳 { blocked: 'locked' | 'space' }
export function deliver(state, id, rnd = Math.random, now = Date.now()) {
  const k = state.orders.findIndex(o => o.id === id);
  if (k < 0) return null;
  const order = state.orders[k], used = findNeed(state, order);
  if (!used) return null;
  const isStory = order.story !== undefined, before = stageInfo(state);
  if (isStory && !before.ready) return { blocked: 'locked', left: before.goal - before.have };
  if (needsSpace(state, order)) return { blocked: 'space' };
  for (const u of used) area(state, u.a)[u.i] = null;
  const level = levelInfo(state.xp).level;
  const total = isStory ? { ...chapterReward(order.story) } : { coins: order.reward, xp: orderXp(order.need), energy: 0 };
  const xp = total.xp;
  state.done++;
  refill(state, now);
  let cleared = null;
  if (isStory) {
    const c = chapter(state), reward = chapterReward(order.story);
    let placed = null;
    if (c.unlock) {
      state.lines = [...state.lines, c.unlock];
      placed = state.cells.findIndex(o => !o);
      state.cells[placed] = { gen: true, line: c.unlock, lv: 1 };
    } else if (c.rank) state.rank = { ...state.rank, [c.rank]: Math.min(RANK_MAX, rankOf(state, c.rank) + 1) };
    state.chapter++; state.progress = 0;
    cleared = { no: before.no, name: before.name, chapter: c, placed, ...reward, next: stageInfo(state) };
  } else if (!before.extra) state.progress = Math.min(before.goal, state.progress + 1);
  else {
    state.overtime++;
    if (state.overtime % EXTRA_GOAL === 0) {
      const bonus = extraReward(state.overtime / EXTRA_GOAL);
      for (const key of Object.keys(total)) total[key] += bonus[key];
      cleared = { no: before.no, name: before.name, chapter: null, ...bonus, next: stageInfo(state) };
    }
  }
  const levelUps = grant(state, total, level);
  state.orders.splice(k, 1);
  if (isStory && chapter(state)) state.orders.splice(k, 0, storyOrder(state));
  else state.orders.splice(k, 0, makeOrder(state, rnd));
  return { order, xp, cleared, levelUps };
}

// 發獎勵（金幣、經驗、能量），回傳這次升到的各級
function grant(state, { coins = 0, xp = 0, energy = 0 }, level) {
  state.coins += coins; state.xp += xp; state.energy += energy;
  const ups = [];
  while (level < levelInfo(state.xp).level) {
    level++; state.xp += LEVEL_REWARD.xp; state.energy += LEVEL_REWARD.energy;
    ups.push({ level, ...LEVEL_REWARD });
  }
  return ups;
}

// 回傳交付訂單要拿走的位置；不夠就回傳 null
export function findNeed(state, order) {
  const used = [];
  for (const want of order.need) {
    let found = null;
    for (const a of ['cell', 'slot']) {
      const i = area(state, a).findIndex((o, i) => o && !o.box && !o.gen && o.line === want.line && o.lv === want.lv && !used.some(u => u.a === a && u.i === i));
      if (i >= 0) { found = { a, i }; break; }
    }
    if (!found) return null;
    used.push(found);
  }
  return used;
}

export function isValidSave(s) {
  const item = o => !!o && !!LINES[o.line] && Number.isInteger(o.lv) && o.lv >= 1 && o.lv <= (o.gen ? GEN_MAX : MAX_LV);
  const cell = c => c === null || (c && c.box ? c.hold === null || item(c.hold) : item(c));
  return !!s && s.v === 1 && Array.isArray(s.cells) && s.cells.length === SIZE && s.cells.every(cell) &&
    Array.isArray(s.slots) && s.slots.length === SLOTS && s.slots.every(o => o === null || item(o)) &&
    Number.isFinite(s.coins) && Number.isFinite(s.done) && Number.isFinite(s.made) && !!s.seen &&
    Array.isArray(s.lines) && s.lines.every(k => !!LINES[k]) && !!s.rank && Number.isInteger(s.chapter) && s.chapter >= 0 && s.chapter <= CHAPTERS.length && Number.isInteger(s.progress) && Number.isInteger(s.overtime) &&
    Number.isInteger(s.energy) && s.energy >= 0 && Number.isFinite(s.energyAt) && Number.isFinite(s.xp) &&
    Array.isArray(s.orders) && s.orders.length === 3 &&
    s.orders.every(o => o && PEOPLE.includes(o.who) && Array.isArray(o.need) && o.need.every(item) && Number.isFinite(o.reward));
}

// 辦公室翻身記｜遊戲規則（不碰畫面，方便測試）。數值要調整都在這個檔案最上面。
export const COLS = 7, ROWS = 9, SIZE = COLS * ROWS, SLOTS = 2, MAX_LV = 7, GEN_MAX = 3;
export const ENERGY_MAX = 100, ENERGY_MS = 60000;   // 能量上限；每幾毫秒回 1 點
// 獎勵、撿道具、兌換來的能量可以超過上限、沒有天花板（超過時不會自然回復，用掉才會繼續回）
export const LEVEL_REWARD = { energy: 30, xp: 10 };                        // 每升一級
export const clearReward = no => ({ coins: no * 50, energy: 20 + no * 5, xp: 15 + no * 5 });   // 過第 no 關
export const orderXp = need => need.reduce((s, r) => s + r.lv * 5, 0);     // 交付訂單的經驗值
const levelCost = level => 40 + (level - 1) * 20;                          // 從 level 升下一級要多少經驗

// 關卡：goal＝要完成幾張訂單；range＝訂單要求的物品等級
export const STAGES = [
  { name: '櫃台大掃除', goal: 3, range: [2, 3] },
  { name: '工作區整理', goal: 4, range: [2, 3] },
  { name: '茶水間開張', goal: 5, range: [2, 4] },
  { name: '會議室改造', goal: 6, range: [3, 4] },
  { name: '創意工作室', goal: 7, range: [3, 5] },
  { name: '員工休息區', goal: 8, range: [4, 5] },
  { name: '主管辦公室', goal: 8, range: [4, 6] },
  { name: '頂樓花園', goal: 10, range: [5, 6] },
];
// 全部過完後是無限的「加班挑戰」
const EXTRA = { name: '加班挑戰', goal: 10, range: [4, 6] };

export const LINES = {
  s: { gen: '文具櫃', items: ['迴紋針盒', '原子筆', '便利貼', '筆記本', '訂書機', '計算機', '豪華辦公禮盒'] },
  t: { gen: '茶水間', items: ['零食糖', '茶包', '熱咖啡', '珍珠奶茶', '甜甜圈', '草莓蛋糕', '豪華便當'] },
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

// 依完成訂單總數算出目前第幾關、進度多少
export function stageInfo(done) {
  let left = done;
  for (let i = 0; i < STAGES.length; i++) {
    if (left < STAGES[i].goal) return { ...STAGES[i], no: i + 1, have: left };
    left -= STAGES[i].goal;
  }
  return { ...EXTRA, no: STAGES.length + 1 + Math.floor(left / EXTRA.goal), have: left % EXTRA.goal };
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
    const line = pick(['s', 't'], rnd);
    return { box: true, hold: rnd() < .45 ? { line, lv: rnd() < .75 ? 1 : 2 } : null };
  });
  cells[at(1, 2)] = { gen: true, line: 's', lv: 1 };
  cells[at(5, 2)] = { gen: true, line: 't', lv: 1 };
  // 藏在紙箱裡的第二台產生器，打開後可合成升級
  cells[at(1, 6)] = { box: true, hold: { gen: true, line: 's', lv: 1 } };
  cells[at(5, 6)] = { box: true, hold: { gen: true, line: 't', lv: 1 } };
  for (const [x, y, line] of [[2, 4, 's'], [3, 4, 's'], [3, 3, 't'], [4, 4, 't']]) cells[at(x, y)] = { line, lv: 1 };
  const state = { v: 1, cells, slots: Array(SLOTS).fill(null), coins: 0, done: 0, xp: 0, made: 0, seen: {}, orders: [], energy: ENERGY_MAX, energyAt: now };
  for (const c of cells) if (c && !c.box) see(state, c);
  while (state.orders.length < 3) state.orders.push(makeOrder(state, rnd));
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

// 目前關卡決定難度；每第 5 張是急件大單
export function makeOrder(state, rnd = Math.random) {
  state.made++;
  const n = state.done, rush = state.made % 5 === 0;
  const [lo, hi] = stageInfo(n).range;
  const taken = state.orders.map(o => o.who);
  const who = pick(PEOPLE.filter(name => !taken.includes(name)), rnd);
  const count = rush || n < 2 ? 1 : rnd() < .5 ? 2 : 1;
  const need = Array.from({ length: count }, () => ({
    line: pick(Object.keys(LINES), rnd),
    lv: rush ? Math.min(MAX_LV, hi + 1) : lo + Math.floor(rnd() * (hi - lo + 1)),
  }));
  const reward = need.reduce((s, r) => s + value(r.lv) * 5, 0) * (rush ? 2 : 1);
  return { id: state.made, who, need, reward, rush };
}

// 舊存檔補上新欄位；訂單角色（會計、老闆…）換成現在的人物，棋盤進度保留
export function upgradeSave(s, rnd = Math.random, now = Date.now()) {
  if (!s) return s;
  if (!Number.isFinite(s.energy) || !Number.isFinite(s.energyAt)) { s.energy = ENERGY_MAX; s.energyAt = now; }
  if (!Number.isFinite(s.xp)) s.xp = xpForLevel(1 + Math.floor((s.done || 0) / 3));
  if (Array.isArray(s.orders) && s.orders.some(o => !PEOPLE.includes(o?.who))) {
    s.orders = [];
    while (s.orders.length < 3) s.orders.push(makeOrder(s, rnd));
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

export function sell(state, from) {
  const src = area(state, from.a), o = src[from.i];
  if (!o || o.box || o.gen) return 0;
  src[from.i] = null;
  state.coins += value(o.lv);
  return value(o.lv);
}

// 回傳交付訂單要拿走的位置；不夠就回傳 null
export function findNeed(state, order) {
  const used = [];
  for (const r of order.need) {
    let found = null;
    for (const a of ['cell', 'slot']) {
      const i = area(state, a).findIndex((o, i) => o && !o.box && !o.gen && o.line === r.line && o.lv === r.lv && !used.some(u => u.a === a && u.i === i));
      if (i >= 0) { found = { a, i }; break; }
    }
    if (!found) return null;
    used.push(found);
  }
  return used;
}

// 交付訂單。回傳 { order, xp, cleared（剛過的關卡或 null）, levelUps（這次升到的各級） }
export function deliver(state, id, rnd = Math.random, now = Date.now()) {
  const k = state.orders.findIndex(o => o.id === id);
  if (k < 0) return null;
  const order = state.orders[k], used = findNeed(state, order);
  if (!used) return null;
  for (const u of used) area(state, u.a)[u.i] = null;
  const before = stageInfo(state.done);
  let level = levelInfo(state.xp).level;
  const xp = orderXp(order.need);
  state.coins += order.reward; state.xp += xp; state.done++;
  refill(state, now);
  const give = energy => { state.energy += energy; };
  let cleared = null;
  if (stageInfo(state.done).no !== before.no) {
    const reward = clearReward(before.no);
    state.coins += reward.coins; state.xp += reward.xp; give(reward.energy);
    cleared = { no: before.no, name: before.name, ...reward, next: stageInfo(state.done) };
  }
  const levelUps = [];
  while (level < levelInfo(state.xp).level) {
    level++; state.xp += LEVEL_REWARD.xp; give(LEVEL_REWARD.energy);
    levelUps.push({ level, ...LEVEL_REWARD });
  }
  state.orders.splice(k, 1);
  state.orders.splice(k, 0, makeOrder(state, rnd));
  return { order, xp, cleared, levelUps };
}

export function isValidSave(s) {
  const item = o => !!o && !!LINES[o.line] && Number.isInteger(o.lv) && o.lv >= 1 && o.lv <= (o.gen ? GEN_MAX : MAX_LV);
  const cell = c => c === null || (c && c.box ? c.hold === null || item(c.hold) : item(c));
  return !!s && s.v === 1 && Array.isArray(s.cells) && s.cells.length === SIZE && s.cells.every(cell) &&
    Array.isArray(s.slots) && s.slots.length === SLOTS && s.slots.every(o => o === null || item(o)) &&
    Number.isFinite(s.coins) && Number.isFinite(s.done) && Number.isFinite(s.made) && !!s.seen &&
    Number.isInteger(s.energy) && s.energy >= 0 && Number.isFinite(s.energyAt) && Number.isFinite(s.xp) &&
    Array.isArray(s.orders) && s.orders.length === 3 &&
    s.orders.every(o => o && PEOPLE.includes(o.who) && Array.isArray(o.need) && o.need.every(item) && Number.isFinite(o.reward));
}

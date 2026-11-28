// 規則測試：node office-merge/test.mjs（改 logic.js 後必跑，約一分鐘）
// 檢查能量、關卡、舊存檔升級，再讓機器人玩家打通全部關卡，確認不會卡死。
import * as G from './logic.js';
import assert from 'node:assert';
import { createCloudSave } from './savesync.js';

const gen = s => s.cells.findIndex(c => c?.gen);
{
  const s = G.newGame(Math.random, 0), i = gen(s);
  assert.equal(s.energy, 100);
  G.spawn(s, i, Math.random, 1000); assert.equal(s.energy, 99);
  G.refill(s, 60999); assert.equal(s.energy, 99);
  G.refill(s, 61000); assert.equal(s.energy, 100);
  s.energy = 0; s.energyAt = 0;
  assert(G.spawn(s, i, Math.random, 59999).tired);
  G.refill(s, 150000); assert.equal(s.energy, 2); assert.equal(G.nextEnergyIn(s, 150000), 30000);
  G.refill(s, 1e9); assert.equal(s.energy, 100);
  s.energy = 130; G.refill(s, 2e9); assert.equal(s.energy, 130);   // 超量不回也不扣
  G.spawn(s, i, Math.random, 2e9); assert.equal(s.energy, 129); assert(G.isValidSave(s));
  s.energy = 5; s.energyAt = 5e9; G.refill(s, 1000); assert.equal(s.energy, 5); assert.equal(s.energyAt, 1000);   // 時鐘倒退
  s.cells = s.cells.map(c => c?.gen ? c : { line: 's', lv: 1 }); assert(G.spawn(s, i, Math.random, 1000).full); assert.equal(s.energy, 5);
  const old = JSON.parse(JSON.stringify(s)); delete old.energy; delete old.energyAt; delete old.xp; old.done = 10;
  assert(G.isValidSave(G.upgradeSave(old))); assert.equal(old.energy, 100); assert.equal(G.levelInfo(old.xp).level, 4);
}
{ // 雲端能量：同一個領取編號只加一次，沒有上限
  const s = G.newGame(Math.random, 0);
  assert.equal(G.addBonus(s, 'a', 100, 0), 100); assert.equal(s.energy, 200);
  assert.equal(G.addBonus(s, 'a', 100, 0), 0); assert.equal(s.energy, 200);
  for (let i = 0; i < 20; i++) G.addBonus(s, 'b' + i, 500, 0);
  assert.equal(s.energy, 10200); assert(G.isValidSave(s)); G.refill(s, 1e9); assert.equal(s.energy, 10200);
}
{ // 關卡＝章節
  assert.equal(G.CHAPTERS.length, 150);
  const goals = G.CHAPTERS.map((_, n) => G.levelGoal(n));
  assert.deepEqual([goals[0], goals[50], goals[149]], [8, 9, 10]);
  for (const line of Object.values(G.LINES)) assert.equal(line.items.length, G.MAX_LV);
  // 全部過完拿到的碎片，夠把每條線升滿
  const total = {};
  G.CHAPTERS.forEach((_, n) => { for (const [k, v] of Object.entries(G.chapterLoot(n).shards)) total[k] = (total[k] || 0) + v; });
  const need = G.SHARD_COST.reduce((a, b) => a + b, 0);
  for (const line of Object.keys(G.LINES)) assert(total[line] >= need, `${line} 碎片 ${total[line]} < ${need}`);
  const at = G.stageInfo({ chapter: 11, progress: 1 });
  assert.deepEqual([at.no, at.have, at.goal, at.ready], [12, 1, 8, false]);
  const over = G.stageInfo({ chapter: G.CHAPTERS.length, overtime: 23 });
  assert.deepEqual([over.no, over.have, over.extra], [G.CHAPTERS.length + 3, 3, true]);
}

{ // 雲端存檔：兩台裝置輪流玩
  const server = { rev: 0, state: null, down: false };
  const request = async (op, { baseRev, state } = {}) => {
    await null;
    if (server.down) throw new Error('network');
    if (op === 'load') return { rev: server.rev, state: structuredClone(server.state) };
    if (baseRev !== server.rev) return { conflict: true, rev: server.rev, state: structuredClone(server.state) };
    server.rev++; server.state = structuredClone(state); return { rev: server.rev };
  };
  const device = () => {
    const d = { state: { done: 0, xp: 0, savedAt: 0, mark: 'new' }, meta: null };
    d.sync = createCloudSave({ enabled: true, request, delay: 1e9, retry: 1e9, readMeta: () => d.meta, writeMeta: m => { d.meta = m; }, getState: () => d.state, adopt: s => { d.state = structuredClone(s); return true; } });
    d.play = (mark, at, done = d.state.done) => { d.state = { ...d.state, mark, done, savedAt: at }; d.sync.changed(); };
    return d;
  };
  const pc = device(); pc.state = { done: 5, xp: 50, savedAt: 1, mark: 'old-local' };
  await pc.sync.load(); assert.equal(server.state.mark, 'old-local');                 // 原本只在本機的進度傳上去
  const phone = device(); await phone.sync.load(); assert.equal(phone.state.mark, 'old-local');   // 新裝置接著玩
  phone.play('phone-1', 10); await phone.sync.flush(); assert.equal(server.state.mark, 'phone-1');
  await pc.sync.load(); assert.equal(pc.state.mark, 'phone-1');                       // 回到電腦接續手機
  phone.play('phone-2', 20); await phone.sync.flush();
  pc.play('pc-stale', 30); await pc.sync.flush();                                     // 舊畫面不能蓋掉手機剛玩的
  assert.equal(server.state.mark, 'phone-2'); assert.equal(pc.state.mark, 'phone-2');
  server.down = true; pc.play('pc-offline', 40); assert.equal(await pc.sync.flush(), false); assert.equal(pc.sync.status, 'offline');
  server.down = false; await pc.sync.flush(); assert.equal(server.state.mark, 'pc-offline');       // 斷線時玩的，連上後補傳
  server.down = true; phone.play('phone-old', 35); await phone.sync.flush(); server.down = false;
  await phone.sync.load(); assert.equal(phone.state.mark, 'pc-offline'); assert.equal(server.state.mark, 'pc-offline');   // 較早的離線進度讓位
  const slow = pc.sync.load(); pc.play('during-load', 99); await slow; await pc.sync.flush();
  assert.equal(server.state.mark, 'during-load');                                     // 版本沒變時，讀檔途中的操作照常上傳
  console.log('通過：雲端存檔跨裝置情境');
}

{ // 元宇宙圖鑑對照：每個物件都有，編號在範圍內、不重複指到同一格
  const keys = Object.entries(G.LINES).flatMap(([k, l]) => l.items.map((_, i) => k + (i + 1)));
  const { DEX, dexIds } = await import('./dexmap.js');
  assert.deepEqual(Object.keys(DEX).sort(), [...keys].sort());
  for (const area of ['d', 'n']) { const all = keys.flatMap(k => DEX[k][area] || []); assert(all.every(n => n >= 0 && n < 50)); assert.equal(new Set(all).size, all.length); }
  assert.deepEqual(dexIds(['s5', 'w3', 'zz']), { d: [10, 0], n: [8] });
}
{ // 加送產生器：每條線湊滿 4 台；過關時發、舊存檔補發、不重複發
  for (const k of Object.keys(G.LINES)) {
    const base = G.START_LINES.includes(k) ? 2 : 1;
    assert.equal(base + G.BONUS_GENS.filter(g => g[1] === k).length, 4, k);
    assert(G.BONUS_GENS.every(([no]) => no <= G.CHAPTERS.length));
  }
  for (let lv = 2; lv <= G.GEN_MAX; lv++) assert(G.GEN_CAP[lv - 1] >= 2 * G.GEN_CAP[lv - 2]);
  const s = G.newGame(Math.random, 0); s.chapter = 21; delete s.spare;
  const u = G.upgradeSave(s);
  assert.deepEqual(u.gifts.map(g => g.line), ['i', 'm', 'd', 'w']); assert(G.isValidSave(u));
  assert.equal(G.upgradeSave(u).gifts.length, 4);
  const at = G.claimGift(u).at; assert.deepEqual(u.cells[at], { gen: true, line: 'i', lv: 1 });
  assert.equal(G.chapterLoot(7).gen, 'i'); assert.equal(G.chapterLoot(0).gen, '');
}
{ // 解除冷卻
  const s = G.newGame(Math.random, 0), i = s.cells.findIndex(c => c?.gen), at = { a: 'cell', i };
  s.coins = 600;
  assert.equal(G.buyCooldown(s, at, 0), false); assert.equal(s.coins, 600);   // 沒在冷卻不收錢
  s.cells[i].used = G.GEN_CAP[0]; s.cells[i].readyAt = 60000;
  assert(G.buyCooldown(s, at, 0)); assert.equal(s.coins, 600 - G.COOL_PRICE); assert.equal(G.genStatus(s.cells[i], 0).left, G.GEN_CAP[0]);
  s.cells[i].readyAt = 60000; assert.equal(G.buyCooldown(s, at, 0), false); assert.equal(s.coins, 100);   // 金幣不夠
}
{ // 產生器冷卻
  const s = G.newGame(Math.random, 0), i = s.cells.findIndex(c => c?.gen);
  s.energy = 100;
  const clear = () => { s.cells = s.cells.map(c => c && !c.gen && !c.box ? null : c); };
  for (let n = 0; n < G.GEN_CAP[0]; n++) { clear(); assert(G.spawn(s, i, Math.random, 0).item); }
  clear(); const hit = G.spawn(s, i, Math.random, 1000); assert.equal(hit.cooling, G.GEN_COOL_MS[0] - 1000); assert.equal(s.energy, 100 - G.GEN_CAP[0]);
  assert.equal(G.spawn(s, i, Math.random, -9e9).cooling, G.GEN_COOL_MS[0]);   // 時鐘倒退
  s.cells[i].readyAt = G.GEN_COOL_MS[0];
  assert(G.spawn(s, i, Math.random, G.GEN_COOL_MS[0]).item); assert.equal(G.genStatus(s.cells[i], G.GEN_COOL_MS[0]).left, G.GEN_CAP[0] - 1);
  s.cells[20] = { gen: true, line: 's', lv: 1, used: 20, readyAt: 9e12 }; s.cells[21] = { gen: true, line: 's', lv: 1, used: 5 };
  G.move(s, { a: 'cell', i: 20 }, { a: 'cell', i: 21 }); assert.deepEqual(s.cells[21], { gen: true, line: 's', lv: 2 });
  assert(G.isValidSave(s));
}
{ // 金幣換能量
  const s = G.newGame(Math.random, 0);
  s.coins = 999; assert.equal(G.buyEnergy(s, 0), false); assert.equal(s.energy, 100);
  s.coins = 5500; for (let n = 0; n < G.COIN_DAILY; n++) assert(G.buyEnergy(s, 0));
  assert.equal(G.buyEnergy(s, 0), false); assert.deepEqual([s.coins, s.energy, G.shopLeft(s, 0)], [2500, 400, 0]);
  assert.equal(G.shopLeft(s, 86400000), G.COIN_DAILY); assert(G.buyEnergy(s, 86400000));
}
{ // 劇情：解鎖物品線、提升圖鑑等級
  for (const c of G.CHAPTERS) { for (const code of c.need) assert(G.LINES[code[0]].items[Number(code.slice(1)) - 1], code); for (const [who] of [...c.say, c.end]) assert(G.PEOPLE.includes(who), who); }
  // 要交的物品一定來自當時已解鎖的線，升級的線也要已解鎖
  const open = [...G.START_LINES];
  for (const c of G.CHAPTERS) { for (const code of c.need) assert(open.includes(code[0]), c.title); if (c.rank) assert(open.includes(c.rank)); if (c.unlock) open.push(c.unlock); }
  assert.equal(open.length, Object.keys(G.LINES).length);
  const s = G.newGame(Math.random, 0);
  const story = () => s.orders[0], empty = () => s.cells.findIndex(o => !o);
  const give = () => { for (const r of story().need) s.cells[empty()] = { ...r }; };
  assert.equal(story().story, 0); assert.equal(s.orders.filter(o => o.story !== undefined).length, 1);
  assert.equal(G.deliver(s, story().id, Math.random, 0), null);
  give();
  assert.deepEqual(G.deliver(s, story().id, Math.random, 0), { blocked: 'locked', left: 8 });
  s.progress = 8;
  const r = G.deliver(s, story().id, Math.random, 0);
  assert(r.cleared.no === 1 && r.cleared.next.no === 2 && s.lines.includes('i') && s.chapter === 1 && s.progress === 0 && s.done === 1 && s.cells[r.cleared.placed].line === 'i' && s.energy >= 120);
  assert.equal(story().story, 1);
  // 棋盤滿、物品都在暫存格：放不下新產生器就不能交
  const full = JSON.parse(JSON.stringify(s)); full.progress = 99;
  full.cells = full.cells.map(c => c && !c.box ? c : { line: 's', lv: 7 }); full.slots = full.orders[0].need.map(n => ({ ...n }));
  assert.equal(G.deliver(full, full.orders[0].id, Math.random, 0).blocked, 'space'); assert.equal(full.chapter, 1);
  s.chapter = 4; G.upgradeSave(s); assert.equal(story().story, 4);
  const normal = () => G.makeOrder({ ...s, orders: [], lines: ['s'], made: 0 }, () => 0).reward, base = G.makeOrder({ ...s, orders: [], lines: ['s'], rank: {}, made: 0 }, () => 0).reward;
  s.progress = 99; give();
  const had = s.shards.s || 0, won = G.deliver(s, story().id, Math.random, 0).cleared;
  assert(won.shards.s >= G.SHARDS_BONUS && s.shards.s === had + won.shards.s && won.materials.length === 2 && G.rankOf(s, 's') === 1);
  assert.equal(G.upgradeRank({ ...s, shards: { s: 19 } }, 's'), false);
  s.shards = { s: 25 }; assert(G.upgradeRank(s, 's')); assert.equal(G.rankOf(s, 's'), 2); assert.equal(s.shards.s, 5); assert(normal() > base);
  // 棋盤滿時材料寄放，有空格才領得到
  s.gifts = [{ line: 's', lv: 3 }]; const spot = s.cells.findIndex(c => !c), keep = s.cells.slice();
  s.cells = s.cells.map(c => c || { line: 't', lv: 1 }); assert.equal(G.claimGift(s), null); assert.equal(s.gifts.length, 1);
  s.cells = keep; assert.equal(G.claimGift(s).at, spot); assert.equal(s.gifts.length, 0);
  s.chapter = G.CHAPTERS.length - 1; s.progress = 99; G.upgradeSave(s); give(); assert(G.deliver(s, story().id, Math.random, 0));
  assert(!G.chapter(s) && s.orders.length === 3 && s.orders.every(o => o.story === undefined));
  assert(G.isValidSave(s));
  // 舊版存檔（兩條線、沒有劇情欄位）照樣能讀
  const old = JSON.parse(JSON.stringify(G.newGame(Math.random, 0))); delete old.lines; delete old.rank; delete old.chapter; delete old.ver;
  delete old.progress; delete old.overtime; delete old.shards; delete old.gifts;
  assert(G.isValidSave(G.upgradeSave(old))); assert.deepEqual([old.lines, old.chapter, old.progress, old.ver], [['s', 't'], 0, 0, G.SAVE_VERSION]);
}
{ // 舊版頁面讀不懂新版雲端存檔時，不能把它蓋掉
  let pushed = 0;
  const sync = createCloudSave({ enabled: true, delay: 1e9, retry: 1e9, request: async op => { if (op === 'save') pushed++; return { rev: 3, state: { ver: 9, done: 1, xp: 1, savedAt: 9 } }; }, readMeta: () => null, writeMeta: () => {}, getState: () => ({ ver: 2, done: 0, xp: 0, savedAt: 0 }), adopt: () => false });
  await sync.load(); assert.equal(pushed, 0); assert.equal(sync.status, 'old');
}

const RUNS = 2;
let now = 0, taps = 0, top = 0;
for (let run = 0; run < RUNS; run++) {
  const s = G.newGame(Math.random, now);
  let steps = 0, cleared = 0, ups = 0;
  while ((G.chapter(s) || s.overtime < G.EXTRA_GOAL + 2) && steps++ < 3000000) {
    for (const line of s.lines) G.upgradeRank(s, line);
    if (s.cells.filter(c => !c).length > 6) G.claimGift(s);
    const wanted = s.orders.flatMap(o => o.need);
    const o = s.orders.find(o => G.findNeed(s, o) && !G.needsSpace(s, o) && (o.story === undefined || G.stageInfo(s).ready));
    if (o) {
      const r = G.deliver(s, o.id, Math.random, now); assert(r.order && r.xp > 0);
      if (r.cleared) cleared++;
      assert(!r.blocked);
      ups += r.levelUps.length; continue;
    }
    let merged = false;
    for (let i = 0; i < G.SIZE && !merged; i++) for (let j = 0; j < G.SIZE; j++) {
      const a = s.cells[i], b = s.cells[j];
      if (i !== j && G.canMerge(a, b) && (a.gen || s.cells.filter(c => c && !c.box && !c.gen && c.line === a.line && c.lv === a.lv).length - 2 >= wanted.filter(r => r.line === a.line && r.lv === a.lv).length || (steps % 7 === 0 && Math.random() < .3))) {
        assert.equal(G.move(s, { a: 'cell', i }, { a: 'cell', i: j }).type, 'merge'); merged = true; break;
      }
    }
    if (merged) continue;
    const gens = s.cells.map((c, i) => c?.gen ? i : -1).filter(i => i >= 0);
    const need = wanted[Math.floor(Math.random() * wanted.length)].line;
    const g = gens.find(i => s.cells[i].line === need && !G.genStatus(s.cells[i], now + 60000).wait) ?? gens.find(i => s.cells[i].line === need);
    const res = G.spawn(s, g, Math.random, now += 60000);
    assert(!res.tired);
    if (res.cooling) { now += res.cooling; continue; }
    if (res.full) {
      const loose = s.cells.map((c, i) => c && !c.box && !c.gen ? i : -1).filter(i => i >= 0);
      const spare = loose.filter(i => !wanted.some(r => r.line === s.cells[i].line && r.lv === s.cells[i].lv));
      const pool = spare.length ? spare : loose;
      const junk = pool.sort((a, b) => s.cells[a].lv - s.cells[b].lv)[Math.floor(Math.random() * Math.ceil(pool.length / 2))];
      assert(junk !== undefined, '棋盤上沒有東西可以清');
      G.sell(s, { a: 'cell', i: junk });
    } else taps++;
    assert(G.isValidSave(JSON.parse(JSON.stringify(s))));
  }
  assert(!G.chapter(s) && s.overtime >= G.EXTRA_GOAL, `run ${run} stalled：第 ${s.chapter + 1} 關`);
  assert.equal(cleared, G.CHAPTERS.length + Math.floor(s.overtime / G.EXTRA_GOAL)); assert.equal(ups, G.levelInfo(s.xp).level - 1);
  top += G.levelInfo(s.xp).level;
}
console.log(`通過：${RUNS} 場打完全部 ${G.CHAPTERS.length} 關，平均點 ${Math.round(taps / RUNS)} 次產生器、結束 Lv.${(top / RUNS).toFixed(1)}`);

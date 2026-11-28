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
assert.deepEqual([0, 2, 3, 7, 10].map(n => { const s = G.stageInfo(n); return [s.no, s.have]; }), [[1, 0], [1, 2], [2, 0], [3, 0], [3, 3]]);
const total = G.STAGES.reduce((n, s) => n + s.goal, 0), stages = G.STAGES.length;
assert.equal(G.stageInfo(total).no, stages + 1);

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

const RUNS = 100;
let now = 0, taps = 0, top = 0;
for (let run = 0; run < RUNS; run++) {
  const s = G.newGame(Math.random, now);
  let steps = 0, cleared = 0, ups = 0;
  while (s.done < total + 3 && steps++ < 60000) {
    const o = s.orders.find(o => G.findNeed(s, o));
    if (o) {
      const r = G.deliver(s, o.id, Math.random, now); assert(r.order && r.xp > 0);
      if (r.cleared) cleared++;
      ups += r.levelUps.length; continue;
    }
    let merged = false;
    for (let i = 0; i < G.SIZE && !merged; i++) for (let j = 0; j < G.SIZE; j++) {
      const a = s.cells[i], b = s.cells[j];
      if (i !== j && G.canMerge(a, b) && (a.gen || s.cells.filter(c => c && !c.box && !c.gen && c.line === a.line && c.lv === a.lv).length - 2 >= s.orders.flatMap(o => o.need).filter(r => r.line === a.line && r.lv === a.lv).length || (steps % 7 === 0 && Math.random() < .3))) {
        assert.equal(G.move(s, { a: 'cell', i }, { a: 'cell', i: j }).type, 'merge'); merged = true; break;
      }
    }
    if (merged) continue;
    const gens = s.cells.map((c, i) => c?.gen ? i : -1).filter(i => i >= 0);
    const all = s.orders.flatMap(o => o.need), need = all[Math.floor(Math.random() * all.length)].line;
    const res = G.spawn(s, gens.find(i => s.cells[i].line === need), Math.random, now += 60000);
    assert(!res.tired);
    if (res.full) {
      const junk = s.cells.map((c, i) => c && !c.box && !c.gen ? i : -1).filter(i => i >= 0).sort(() => Math.random() - .5)[0];
      G.sell(s, { a: 'cell', i: junk });
    } else taps++;
    assert(G.isValidSave(JSON.parse(JSON.stringify(s))));
  }
  assert(s.done >= total + 3, `run ${run} stalled at ${s.done}`);
  assert.equal(cleared, stages); assert.equal(ups, G.levelInfo(s.xp).level - 1);
  top += G.levelInfo(s.xp).level;
}
console.log(`通過：${RUNS} 場打完全部 ${stages} 關；平均點 ${Math.round(taps / RUNS)} 次產生器、結束 Lv.${(top / RUNS).toFixed(1)}`);

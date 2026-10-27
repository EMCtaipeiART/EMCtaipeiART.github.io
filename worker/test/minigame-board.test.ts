import { env, runInDurableObject, SELF } from 'cloudflare:test';
import { beforeEach, describe, expect, it } from 'vitest';
import { createRng, hashString } from '../../EMC-ART-Pixel-Office/dist/minigames/core/rng.js';
import { createDeck, pointsForCorrect } from '../../EMC-ART-Pixel-Office/dist/minigames/games/deadline-challenges.js';
import { createBall, stepBall, pointsFor, binXAt, makeWindSchedule, windAt } from '../../EMC-ART-Pixel-Office/dist/minigames/games/hoops-sim.js';

const T = { now: Date.UTC(2026, 9, 26, 4, 0, 0) };   // 台北 2026-10-26 12:00
const DAY = '2026-10-26';
const stub = () => (env.MINIGAME_BOARD as any).getByName('primary');
const inst = <R>(fn: (i: any) => R | Promise<R>) => (runInDurableObject as any)(stub(), (i: any) => fn(i)) as Promise<R>;
const hex32 = () => [...crypto.getRandomValues(new Uint8Array(16))].map(b => b.toString(16).padStart(2, '0')).join('');
let ipN = 0;
const freshIp = () => '10.0.' + (ipN >> 8) + '.' + (ipN++ & 255);

beforeEach(async () => {
  T.now = Date.UTC(2026, 9, 26, 4, 0, 0);
  await inst(i => { i.clock = () => T.now; });
});

async function newRun(game: string, device = '', nick = '測試', ip = freshIp()) {
  const r = await stub().startRun({ game, device, nick, ip });
  return r.body as any;
}
const submit = async (run: any, log: unknown, extra: Record<string, unknown> = {}) => (await stub().submit({ runId: run.runId, device: run.device, log, ...extra })) as { status: number; body: any };
const play = (secs: number) => { T.now += secs * 1000; };

// ───────── 合法紀錄產生器（用遊戲本身的程式碼解題）─────────
function deadlineLog(day: string, n: number, opts: { wrongAt?: number[]; start?: number; step?: number } = {}) {
  const deck = createDeck(createRng(hashString('deadline:deck@' + day)));
  const answers: any[] = [];
  let score = 0, combo = 0, t = opts.start ?? 1.2;
  for (let k = 0; k < n; k++) {
    const it = deck.get(k), regions = it.type.regions(it.puzzle, { x: 12, y: 124, w: 700, h: 420 });
    const wrong = opts.wrongAt?.includes(k);
    const pick = regions.find((r: any) => it.type.isCorrect(it.puzzle, r.id) !== !!wrong);
    t += (opts.step ?? 1.0) + (k % 4) * 0.13 + (k % 7) * 0.05;
    answers.push({ i: k, a: pick.id, t: +t.toFixed(3) });
    if (wrong) { combo = 0; score = Math.max(0, score - 20); } else { combo++; score += pointsForCorrect(combo); }
  }
  return { log: { answers }, expected: score };
}
function findSwish(k: number, day: string) {
  const sched = makeWindSchedule(createRng(hashString('hoops:wind@' + day)), 60);
  for (let a = 30; a <= 75; a++) for (let sp = 600; sp <= 1190; sp += 5) {
    const r = a * Math.PI / 180, vx = Math.cos(r) * sp, vy = -Math.sin(r) * sp, b = createBall(vx, vy);
    let ev: any = null, tick = k;
    while (!ev && tick < 3600) { tick++; const t = tick / 60; ev = stepBall(b, 1 / 60, { binX: binXAt(t), wind: windAt(sched, t) }); }
    if (ev && ev.type === 'score' && !b.touched) return { k, vx, vy, end: tick };
  }
  throw new Error('no swish found');
}
function hoopsLog(day: string) {
  const first = findSwish(100, day), shots = [{ k: 100, vx: first.vx, vy: first.vy }];
  let score = pointsFor({ swish: true, combo: 1 });
  for (let n = 1; n < 6; n++) { shots.push({ k: 100 + n * 150, vx: first.vx, vy: first.vy }); score += pointsFor({ swish: true, combo: n + 1 }); }
  return { log: { shots }, expected: score };
}

describe('票與提交', () => {
  it('合法的截稿倒數：伺服器重算分數、上榜、名次與榜單', async () => {
    const run = await newRun('deadline');
    expect(run.ok).toBe(true); expect(run.day).toBe(DAY); expect(run.runId).toMatch(/^[0-9a-f]{32}$/);
    const { log, expected } = deadlineLog(DAY, 20);
    play(100);
    const r = await submit(run, log, { score: 999999 });      // 客戶端宣稱的分數完全無效
    expect(r.status).toBe(200); expect(r.body.score).toBe(expected); expect(expected).toBeGreaterThan(1000);
    expect(r.body.rank).toBe(1);
    expect(r.body.board[0]).toMatchObject({ rank: 1, score: expected }); expect(r.body.board[0].name).toBe('測試#' + run.device.slice(0, 4));
  });

  it('同一張票重送：冪等，不會重複計分；同時兩個請求只記一筆', async () => {
    const run = await newRun('deadline');
    const { log, expected } = deadlineLog(DAY, 10);
    play(100);
    const [a, b] = await Promise.all([submit(run, log), submit(run, log)]);
    expect([a.status, b.status]).toEqual([200, 200]);
    expect(a.body.score).toBe(expected); expect(b.body.score).toBe(expected);
    expect([a.body.replay, b.body.replay].filter(Boolean)).toHaveLength(1);
    const n = await inst(i => i.sql().exec('SELECT COUNT(*) AS n FROM scores WHERE run_id = ?', run.runId).one().n);
    expect(n).toBe(1);
    const again = await submit(run, { answers: [] });          // 重放時換一份紀錄也沒用：回傳第一次的結果
    expect(again.body.replay).toBe(true); expect(again.body.score).toBe(expected);
  });

  it('錯誤的票：不存在、別人的裝置、過期、太早提交', async () => {
    const run = await newRun('deadline'), { log } = deadlineLog(DAY, 5);
    expect((await stub().submit({ runId: hex32(), device: run.device, log })).status).toBe(404);
    expect((await stub().submit({ runId: run.runId, device: hex32(), log })).status).toBe(403);
    expect((await stub().submit({ runId: 'x', device: run.device, log })).status).toBe(400);
    // 太早：宣稱玩了 90 秒，真實只過了 5 秒
    play(5);
    const early = await submit(run, log);
    expect(early.status).toBe(422); expect(early.body.error).toBe('too-fast-real-time');
    play(100);
    expect((await submit(run, log)).status).toBe(409);        // 票已作廢，不能拿同一張再試
    const old = await newRun('deadline', run.device);
    play(3600);
    const late = await submit(old, log);
    expect(late.status).toBe(410);
  });

  it('偽造的截稿倒數紀錄全部被擋', async () => {
    const good = deadlineLog(DAY, 12).log.answers;
    const cases: Record<string, any> = {
      'bad-log': { answers: 'x' },
      'bad-answer': { answers: good.map((a: any, k: number) => (k === 3 ? { ...a, i: 9 } : a)) },       // 題號亂跳
      'bad-choice': { answers: good.map((a: any, k: number) => (k === 2 ? { ...a, a: 9999 } : a)) },    // 不存在的選項
      'too-fast': { answers: good.map((a: any, k: number) => (k === 4 ? { ...a, t: good[3].t + 0.05 } : a)) },
      'bad-time': { answers: good.map((a: any, k: number) => (k === 11 ? { ...a, t: 500 } : a)) },
      'too-many': { answers: Array.from({ length: 400 }, (_, k) => ({ i: k, a: 0, t: k })) },
      'robotic': { answers: deadlineLog(DAY, 25, { step: 1.0 }).log.answers.map((a: any, k: number) => ({ ...a, t: 1 + k * 1.0 })) }
    };
    for (const [error, log] of Object.entries(cases)) {
      const run = await newRun('deadline'); play(100);
      const r = await submit(run, log);
      expect(r.status, error).toBe(422); expect(r.body.error, error).toBe(error);
    }
  });

  it('拿別天的答案去交：只會拿到很低的分數', async () => {
    const run = await newRun('deadline'), other = deadlineLog('2026-10-25', 15), mine = deadlineLog(DAY, 15);
    play(100);
    const r = await submit(run, other.log);
    // 別天的題組：選項多半不存在（直接擋下），就算碰巧都存在，分數也遠低於正確作答
    expect(r.status === 422 || r.body.score < mine.expected / 2).toBe(true);
  });

  it('廢紙投籃：逐球重放，分數與連擊由伺服器決定', async () => {
    const { log, expected } = hoopsLog(DAY);
    const run = await newRun('hoops'); play(70);
    const r = await submit(run, log);
    expect(r.status).toBe(200); expect(r.body.score).toBe(expected);
    expect(r.body.detail.makes).toBe(6);
  });

  it('偽造的投籃紀錄全部被擋或被重算', async () => {
    const { log } = hoopsLog(DAY), s0 = (log.shots as any[])[0];
    const mk = async (shots: any) => { const run = await newRun('hoops'); play(70); return submit(run, { shots }); };
    expect((await mk([{ k: 100, vx: 5000, vy: -5000 }])).body.error).toBe('too-strong');            // 超過最大力道
    expect((await mk([{ k: 100, vx: NaN, vy: 1 }])).status).toBe(422);
    expect((await mk([{ k: 1.5, vx: 1, vy: 1 }])).body.error).toBe('bad-shot');
    expect((await mk([{ k: 9999, vx: 1, vy: 1 }])).body.error).toBe('bad-shot-time');
    expect((await mk([s0, { ...s0, k: 110 }])).body.error).toBe('bad-shot-time');                    // 前一球還在飛就出下一球
    expect((await mk(Array.from({ length: 100 }, (_, k) => ({ k: k + 1, vx: 1, vy: 1 })))).body.error).toBe('too-many');
    const weak = await mk([{ k: 100, vx: 50, vy: -50 }]);                                            // 合法但太弱：落地，0 分
    expect(weak.status).toBe(200); expect(weak.body.score).toBe(0);
    const tweaked = await mk([{ ...s0, vx: s0.vx * 0.8 }]);                                           // 改小力道：不再是空心
    expect(tweaked.body.score).toBeLessThan(150);
  });

  it('辦公室尋寶（簡易驗證）：公式、提示、找齊加成、時間下限', async () => {
    const mk = async (log: any, secs = 130) => { const run = await newRun('treasure'); expect(run.verification).toBe('basic'); play(secs); return submit(run, log); };
    expect((await mk({ finds: [{ t: 10 }, { t: 25 }, { t: 40 }], hint: false })).body.score).toBe(300);
    expect((await mk({ finds: [{ t: 10 }, { t: 25 }], hint: true })).body.score).toBe(150);
    expect((await mk({ finds: [{ t: 10 }, { t: 20 }, { t: 30 }, { t: 40 }, { t: 50 }], hint: false })).body.score).toBe(500 + 70 * 2);
    expect((await mk({ finds: [{ t: 1 }] })).body.error).toBe('too-fast');                           // 第一個不可能這麼快
    expect((await mk({ finds: [{ t: 10 }, { t: 10.5 }] })).body.error).toBe('too-fast');
    expect((await mk({ finds: Array.from({ length: 6 }, (_, k) => ({ t: 10 + k * 5 })) })).body.error).toBe('bad-log');
    // 宣稱 50 秒找齊，真實只過了 10 秒
    expect((await mk({ finds: [{ t: 10 }, { t: 20 }, { t: 30 }, { t: 40 }, { t: 50 }] }, 10)).body.error).toBe('too-fast-real-time');
  });

  it('亂格式的紀錄不會讓伺服器出錯', async () => {
    const junk: unknown[] = [null, 1, 'x', [], {}, { answers: null }, { answers: [null, 1, 'x'] }, { shots: [null] }, { finds: [{}] }, { answers: [{ i: 0, a: 'x', t: 'y' }] }, { shots: [{ k: 'a' }] }];
    for (const game of ['deadline', 'hoops', 'treasure']) for (const log of junk) {
      const run = await newRun(game); play(100);
      const r = await submit(run, log);
      expect(r.status === 200 || r.status === 422, game + ' ' + JSON.stringify(log)).toBe(true);
    }
  });
});

describe('身分、限流與榜單', () => {
  it('裝置碼由伺服器發；沒見過的裝置碼不採用；暱稱會被清理', async () => {
    const a = await newRun('deadline', hex32(), '<b>很長很長很長很長很長很長名字</b>');
    expect(a.device).toMatch(/^[0-9a-f]{32}$/);
    expect(a.nick.length).toBeLessThanOrEqual(12); expect(a.nick).not.toMatch(/[<>]/);
    const b = await newRun('deadline', a.device, '');
    expect(b.device).toBe(a.device); expect(b.nick).toBe(a.nick);   // 沒給暱稱就沿用
    const c = await newRun('deadline', a.device, '小華');
    expect(c.nick).toBe('小華');
  });

  it('限流：同時未完成的票、每裝置每小時、每 IP 每小時', async () => {
    const ip = freshIp();
    const first = await newRun('hoops', '', 'x', ip);
    await newRun('hoops', first.device, 'x', ip); await newRun('hoops', first.device, 'x', ip);
    expect((await stub().startRun({ game: 'hoops', device: first.device, nick: 'x', ip })).status).toBe(429);   // 第 4 張
    play(1000);                                                                                           // 前三張過期
    expect((await stub().startRun({ game: 'hoops', device: first.device, nick: 'x', ip })).status).toBe(200);
    await inst(i => { for (let n = 0; n < 40; n++) i.sql().exec('INSERT INTO runs (run_id, game, day, device, ip_hash, issued_at, expires_at, used) VALUES (?, ?, ?, ?, ?, ?, ?, 1)', hex32(), 'hoops', DAY, first.device, 'other', T.now, T.now); });
    expect((await stub().startRun({ game: 'hoops', device: first.device, nick: 'x', ip: freshIp() })).status).toBe(429);
    const ip2 = freshIp(), h = await newRun('hoops', '', 'y', ip2);
    const hash = await inst(i => i.sql().exec('SELECT ip_hash FROM runs WHERE run_id = ?', h.runId).one().ip_hash);
    await inst(i => { for (let n = 0; n < 120; n++) i.sql().exec('INSERT INTO runs (run_id, game, day, device, ip_hash, issued_at, expires_at, used) VALUES (?, ?, ?, ?, ?, ?, ?, 1)', hex32(), 'hoops', DAY, hex32(), hash, T.now, T.now); });
    expect((await stub().startRun({ game: 'hoops', device: '', nick: 'z', ip: ip2 })).status).toBe(429);
    expect((await stub().startRun({ game: 'nope', device: '', nick: 'z', ip: ip2 })).status).toBe(400);
  });

  it('榜單：每人每天只算最高分、排序、今日與近 7 天、跨日仍算開票那天', async () => {
    T.now = Date.UTC(2026, 10, 15, 4, 0, 0);                 // 用獨立的日子，不和其他測試的成績混在一起
    const DAY2 = '2026-11-15';
    const dev = (await newRun('treasure')).device;
    const post = async (finds: number, at = 130) => { const r = await newRun('treasure', dev, '甲'); play(at); return submit(r, { finds: Array.from({ length: finds }, (_, k) => ({ t: 10 + k * 8 })) }); };
    await post(2); const best = await post(4); await post(1);
    expect(best.body.score).toBe(400); expect(best.body.isDayBest).toBe(true);
    const other = await newRun('treasure', '', '乙'); play(130); await submit(other, { finds: [{ t: 10 }, { t: 20 }, { t: 30 }] });
    T.now += 31_000;                                                                             // 快取 30 秒
    const board = (await stub().board({ game: 'treasure', range: 'today' })).body;
    expect(board.entries.map((e: any) => e.score)).toEqual([400, 300]);
    expect(board.entries[0].name.startsWith('甲#')).toBe(true);
    // 跨日：23:59 開票、00:01 提交，仍屬於開票那天
    T.now = Date.UTC(2026, 10, 15, 15, 58, 30);
    const edge = await newRun('treasure', '', '丙');
    T.now = Date.UTC(2026, 10, 15, 16, 1, 0);
    const done = await submit(edge, { finds: [{ t: 10 }] });
    expect(done.body.day).toBe(DAY2);
    T.now += 40_000;
    expect((await stub().board({ game: 'treasure', range: 'today' })).body.entries).toHaveLength(0);    // 現在是 10/27，今日榜是空的
    expect((await stub().board({ game: 'treasure', range: 'week' })).body.entries.length).toBeGreaterThanOrEqual(3);
  });

  it('清理：超過 90 天的成績被刪，近期的保留', async () => {
    await inst(i => {
      const s = i.sql();
      s.exec('INSERT INTO devices (id, nick, created_at, last_seen) VALUES (?, ?, ?, ?)', 'd'.repeat(32), '舊', 0, T.now);
      s.exec("INSERT INTO scores (run_id, game, day, device, score, at) VALUES ('r1', 'hoops', '2026-01-01', ?, 5, 0)", 'd'.repeat(32));
      s.exec("INSERT INTO scores (run_id, game, day, device, score, at) VALUES ('r2', 'hoops', '2026-10-20', ?, 7, 0)", 'd'.repeat(32));
      i.purge(T.now);
    });
    const rows = await inst(i => i.sql().exec("SELECT run_id FROM scores WHERE run_id IN ('r1','r2')").toArray().map((r: any) => r.run_id));
    expect(rows).toEqual(['r2']);
  });
});

describe('HTTP 路由', () => {
  const ORIGIN = 'http://localhost:8787';
  const post = (path: string, body: unknown, headers: Record<string, string> = {}) =>
    SELF.fetch('https://example.com' + path, { method: 'POST', headers: { 'Content-Type': 'application/json', Origin: ORIGIN, ...headers }, body: typeof body === 'string' ? body : JSON.stringify(body) });

  it('開票、查榜、CORS、預檢', async () => {
    const res = await post('/minigames/run', { game: 'hoops', nick: 'web' });
    expect(res.status).toBe(200); expect(res.headers.get('Access-Control-Allow-Origin')).toBe(ORIGIN);
    const j: any = await res.json(); expect(j.ok).toBe(true); expect(j.runId).toBeTruthy();
    const board = await SELF.fetch('https://example.com/minigames/board?game=hoops&range=today', { headers: { Origin: ORIGIN } });
    expect(board.status).toBe(200); expect(((await board.json()) as any).ok).toBe(true);
    const pre = await SELF.fetch('https://example.com/minigames/run', { method: 'OPTIONS', headers: { Origin: ORIGIN, 'Access-Control-Request-Method': 'POST' } });
    expect(pre.status).toBe(204);
  });

  it('擋掉不在白名單的網站、壞 JSON、過大內容、未知路徑與方法', async () => {
    expect((await post('/minigames/run', { game: 'hoops' }, { Origin: 'https://evil.example' })).status).toBe(403);
    expect((await post('/minigames/run', '{not json')).status).toBe(400);
    expect((await post('/minigames/run', '[1,2]')).status).toBe(400);
    expect((await post('/minigames/submit', { runId: 'a'.repeat(32), device: 'b'.repeat(32), log: 'x'.repeat(20000) })).status).toBe(413);
    expect((await post('/minigames/nope', {})).status).toBe(404);
    expect((await SELF.fetch('https://example.com/minigames/run', { headers: { Origin: ORIGIN } })).status).toBe(405);
    expect((await SELF.fetch('https://example.com/minigames/board?game=zzz', { headers: { Origin: ORIGIN } })).status).toBe(400);
  });

  it('端到端：HTTP 開票 → 提交 → 榜上有名', async () => {
    const run: any = await (await post('/minigames/run', { game: 'deadline', nick: '網頁' })).json();
    const { log, expected } = deadlineLog(run.day, 14);
    play(100);
    const sub: any = await (await post('/minigames/submit', { runId: run.runId, device: run.device, log })).json();
    expect(sub.ok).toBe(true); expect(sub.score).toBe(expected);
    expect(sub.board.some((e: any) => e.name === '網頁#' + run.device.slice(0, 4))).toBe(true);
  });
});

describe('茶水間冰箱', () => {
  it('每天自動進貨、拿零食會扣庫存並記排行，空了拿不到', async () => {
    T.now = Date.UTC(2026, 9, 27, 4, 0, 0);   // 台北 12:00（上班時間）
    const s0 = (await stub().fridge()).body;
    expect(s0.stocker).toBe('自動進貨');
    expect(s0.stock.chips).toBeGreaterThanOrEqual(3);
    const r = (await stub().fridgeAct({ action: 'take', slot: 'chips', nick: 'Anna' })).body;
    expect(r.ok).toBe(true);
    expect(r.caught).toBe(false);
    expect(r.stock.chips).toBe(s0.stock.chips - 1);
    expect(r.kings[0]).toEqual({ nick: 'Anna', n: 1 });
    for (let k = 0; k < s0.stock.chips - 1; k++) await stub().fridgeAct({ action: 'take', slot: 'chips', nick: 'Bob' });
    const empty = await stub().fridgeAct({ action: 'take', slot: 'chips', nick: 'Bob' });
    expect(empty.status).toBe(409);
  });
  it('下班時間偷吃會被抓包；補貨會記名字、每人每天有上限', async () => {
    T.now = Date.UTC(2026, 9, 27, 15, 0, 0);  // 台北 23:00
    expect((await stub().fridgeAct({ action: 'take', slot: 'cookie', nick: 'Cat' })).body.caught).toBe(true);
    const st = (await stub().fridgeAct({ action: 'stock', slot: 'cookie', nick: 'Dan' })).body;
    expect(st.stocker).toBe('Dan');
    expect(st.heroes[0].nick).toBe('Dan');
    for (let k = 0; k < 4; k++) await stub().fridgeAct({ action: 'stock', slot: 'cookie', nick: 'Dan' });
    expect((await stub().fridgeAct({ action: 'stock', slot: 'cookie', nick: 'Dan' })).status).toBe(429);
    expect((await stub().fridgeAct({ action: 'take', slot: 'nope', nick: 'Dan' })).status).toBe(400);
  });
});

describe('冰箱紙箱', () => {
  it('桌上有 3 箱不同零食，拖進冰箱補貨 +3、箱子被拿走、記補貨人', async () => {
    T.now = Date.UTC(2026, 9, 28, 4, 0, 0);
    const s0 = (await stub().fridge()).body;
    expect(s0.boxes).toHaveLength(3);
    expect(new Set(s0.boxes).size).toBe(3);
    const slot = s0.boxes[0];
    const r = (await stub().fridgeAct({ action: 'box', slot, nick: 'Eve' })).body;
    expect(r.boxes).toHaveLength(2);
    expect(r.stocker).toBe('Eve');
    expect(r.stock[slot]).toBe(Math.min(8, s0.stock[slot] + 3));
    expect((await stub().fridgeAct({ action: 'box', slot, nick: 'Eve' })).status).toBe(409);
    T.now += 4 * 3600_000;
    expect(((await stub().fridge()).body.boxes).length).toBe(3);
  });
});

describe('四樓冰箱與動作同步', () => {
  it('四樓庫存與五樓分開；動作事件讓別人看得到', async () => {
    T.now = Date.UTC(2026, 9, 29, 4, 0, 0);
    const f5 = (await stub().fridge({ floor: 5 })).body, f4 = (await stub().fridge({ floor: 4 })).body;
    expect(f4.floor).toBe(4);
    expect(f4.boxes).toHaveLength(3);
    const first = (await stub().fridge({ floor: 4, since: null })).body;
    expect(first.events).toEqual([]);
    await stub().fridgeAct({ action: 'open', nick: 'Anna', floor: 4 });
    await stub().fridgeAct({ action: 'take', slot: 'boba', nick: 'Anna', floor: 4 });
    const after = (await stub().fridge({ floor: 4, since: first.evMax })).body;
    expect(after.events.map((e: any) => e.kind)).toEqual(['open', 'take']);
    expect(after.events[1]).toMatchObject({ nick: 'Anna', slot: 'boba' });
    expect(after.stock.boba).toBe(f4.stock.boba - 1);
    expect((await stub().fridge({ floor: 5 })).body.stock.boba).toBe(f5.stock.boba);
    expect((await stub().fridge({ floor: 5, since: 0 })).body.events).toEqual([]);
  });
});

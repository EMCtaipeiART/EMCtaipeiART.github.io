import { env, runInDurableObject } from 'cloudflare:test';
import { beforeEach, describe, expect, it } from 'vitest';
import { createRng, hashString } from '../../deadline/rng.js';
import { createDeck, pointsForCorrect } from '../../deadline/engine.js';

const T = { now: Date.UTC(2026, 10, 13, 4, 0, 0) };
const DAY = '2026-11-13';
const stub = () => (env.MINIGAME_BOARD as any).getByName('dl2');
const inst = <R>(fn: (i: any) => R | Promise<R>) => (runInDurableObject as any)(stub(), (i: any) => fn(i)) as Promise<R>;
const BOX = { x: 12, y: 124, w: 700, h: 420 };

beforeEach(async () => { T.now = Date.UTC(2026, 10, 13, 4, 0, 0); await inst(i => { i.clock = () => T.now; }); });

function solve(n: number, wrongAt: number[] = []) {
  const deck = createDeck(createRng(hashString('deadline2:deck@' + DAY)));
  const answers: any[] = []; let t = 1, combo = 0, score = 0;
  for (let k = 0; k < n; k++) {
    const it = deck.get(k), regs = it.type.regions(it.puzzle, BOX);
    const right = regs.find((r: any) => it.type.isCorrect(it.puzzle, r.id)).id;
    const pick = wrongAt.includes(k) ? regs.find((r: any) => r.id !== right).id : right;
    t += 1.3 + (k % 3) * 0.17;
    answers.push({ i: k, a: pick, t: +t.toFixed(3) });
    if (pick === right) { combo++; score += pointsForCorrect(combo, it.level); } else { combo = 0; score = Math.max(0, score - 20); }
  }
  return { answers, score };
}

describe('截稿倒數 2 伺服器驗證', () => {
  it('合法紀錄：分數由伺服器重算（含高關卡加成）並上榜', async () => {
    const run = (await stub().startRun({ game: 'deadline2', nick: '測試', ip: '9.9.9.1' })).body as any;
    expect(run.ok).toBe(true); expect(run.day).toBe(DAY);
    const { answers, score } = solve(30, [3, 12]);
    T.now += 95_000;
    const res = (await stub().submit({ runId: run.runId, device: run.device, log: { answers } })).body as any;
    expect(res.ok).toBe(true); expect(res.score).toBe(score);
    expect((await stub().board({ game: 'deadline2', range: 'today' })).body.entries[0].score).toBe(score);
  });
  it('亂填答案或走舊題庫的紀錄會被拒絕', async () => {
    const run = (await stub().startRun({ game: 'deadline2', nick: '測試', ip: '9.9.9.2' })).body as any;
    T.now += 95_000;
    const bad = solve(5).answers.map(a => ({ ...a, a: 99 }));
    const res = await stub().submit({ runId: run.runId, device: run.device, log: { answers: bad } });
    expect(res.status).toBe(422);
  });
});

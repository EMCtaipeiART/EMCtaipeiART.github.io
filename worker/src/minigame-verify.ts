// 小遊戲成績的伺服器端驗證器。客戶端只送「作答／出手紀錄」，分數一律由這裡重算，不信任客戶端宣稱的分數。
// 規則與前端是同一份程式碼（單一來源）：題組、物理、計分都直接引用遊戲模組。
import { createRng, hashString } from '../../EMC-ART-Pixel-Office/dist/minigames/core/rng.js';
import { createDeck, pointsForCorrect, WRONG_PENALTY } from '../../EMC-ART-Pixel-Office/dist/minigames/games/deadline-challenges.js';
import { createBall, stepBall, pointsFor, binXAt, makeWindSchedule, windAt, MAX_PULL, POWER_K } from '../../EMC-ART-Pixel-Office/dist/minigames/games/hoops-sim.js';

export type GameId = 'deadline' | 'hoops' | 'treasure';
export interface GameSpec { duration: number; level: 'full' | 'basic' }
/** 倒數 3 秒不算遊戲時間；伺服器以此推算「最少要花多少真實時間」。 */
export const COUNTDOWN_SECS = 3;
export const GAMES: Record<GameId, GameSpec> = {
  deadline: { duration: 90, level: 'full' },
  hoops: { duration: 60, level: 'full' },
  treasure: { duration: 120, level: 'basic' }
};
export type Verdict = { ok: true; score: number; endT: number; detail: Record<string, number> } | { ok: false; error: string };

const bad = (error: string): Verdict => ({ ok: false, error });
const isNum = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);
const BOX = { x: 12, y: 124, w: 700, h: 420 };

// ───────── 截稿倒數（完整重算）─────────
export const DEADLINE_MIN_GAP = 0.12;   // 兩次作答最短間隔（秒）
export const DEADLINE_MIN_FIRST = 0.3;  // 第一題最短反應時間
function verifyDeadline(day: string, log: any): Verdict {
  const answers = log?.answers;
  if (!Array.isArray(answers)) return bad('bad-log');
  if (answers.length > 300) return bad('too-many');
  const deck = createDeck(createRng(hashString('deadline:deck@' + day)));
  let score = 0, combo = 0, correct = 0, prev = 0;
  const gaps: number[] = [];
  for (let k = 0; k < answers.length; k++) {
    const a = answers[k];
    if (!a || a.i !== k || !Number.isInteger(a.a) || !isNum(a.t)) return bad('bad-answer');
    if (a.t > GAMES.deadline.duration + 0.5 || a.t < 0) return bad('bad-time');
    if (a.t - prev < (k === 0 ? DEADLINE_MIN_FIRST : DEADLINE_MIN_GAP)) return bad('too-fast');
    if (k > 0) gaps.push(a.t - prev);
    prev = a.t;
    const item = deck.get(k);
    if (!item.type.regions(item.puzzle, BOX).some((r: { id: number }) => r.id === a.a)) return bad('bad-choice');
    if (item.type.isCorrect(item.puzzle, a.a)) { combo++; correct++; score += pointsForCorrect(combo); }
    else { combo = 0; score = Math.max(0, score - WRONG_PENALTY); }
  }
  // 機器人式的等間隔作答：十五題以上、間隔幾乎完全一樣
  if (gaps.length >= 15 && Math.max(...gaps) - Math.min(...gaps) < 0.02) return bad('robotic');
  return { ok: true, score, endT: GAMES.deadline.duration, detail: { answers: answers.length, correct } };
}

// ───────── 廢紙投籃（逐球重放物理）─────────
export const HOOPS_TICKS = GAMES.hoops.duration * 60;
function verifyHoops(day: string, log: any): Verdict {
  const shots = log?.shots;
  if (!Array.isArray(shots)) return bad('bad-log');
  if (shots.length > 80) return bad('too-many');
  const schedule = makeWindSchedule(createRng(hashString('hoops:wind@' + day)), GAMES.hoops.duration);
  const maxSpeed = MAX_PULL * POWER_K + 0.01;
  let score = 0, combo = 0, nextOk = 1, makes = 0, counted = 0;
  for (const s of shots) {
    if (!s || !Number.isInteger(s.k) || !isNum(s.vx) || !isNum(s.vy)) return bad('bad-shot');
    if (s.k < nextOk || s.k > HOOPS_TICKS) return bad('bad-shot-time');
    if (Math.hypot(s.vx, s.vy) > maxSpeed) return bad('too-strong');
    const ball = createBall(s.vx, s.vy);
    let ev: { type: string } | null = null, tick = s.k;
    while (!ev && tick < HOOPS_TICKS + 1) {
      tick++;
      const t = tick / 60;
      ev = stepBall(ball, 1 / 60, { binX: binXAt(t), wind: windAt(schedule, t) });
    }
    if (!ev || tick > HOOPS_TICKS) break;            // 時間到時還在飛的球不算
    counted++;
    if (ev.type === 'score') { combo++; makes++; score += pointsFor({ swish: !ball.touched, combo }); nextOk = tick + 18; }
    else { combo = 0; nextOk = tick + 21; }          // 結算後遊戲要等 0.35／0.4 秒才發下一球（扣 3 幀誤差）
  }
  return { ok: true, score, endT: GAMES.hoops.duration, detail: { shots: shots.length, counted, makes } };
}

// ───────── 辦公室尋寶（簡易驗證：位置依螢幕而異，伺服器無法重現）─────────
export const TREASURE_MIN_FIRST = 4, TREASURE_MIN_GAP = 2;
function verifyTreasure(_day: string, log: any): Verdict {
  const finds = log?.finds;
  if (!Array.isArray(finds) || finds.length > 5) return bad('bad-log');
  const d = GAMES.treasure.duration;
  let prev = 0;
  for (let k = 0; k < finds.length; k++) {
    const t = finds[k]?.t;
    if (!isNum(t) || t < 0 || t > d + 0.5) return bad('bad-time');
    if (t - prev < (k === 0 ? TREASURE_MIN_FIRST : TREASURE_MIN_GAP)) return bad('too-fast');
    prev = t;
  }
  const hint = log.hint === true;
  const found = finds.length;
  const endT = found === 5 ? prev : d;                // 找齊就提早結束
  const bonus = found === 5 ? Math.floor(Math.max(d - prev, 0)) * 2 : 0;
  return { ok: true, score: Math.max(0, found * 100 + bonus - (hint ? 50 : 0)), endT, detail: { found, hint: hint ? 1 : 0 } };
}

export function verifyRun(game: GameId, day: string, log: unknown): Verdict {
  if (game === 'deadline') return verifyDeadline(day, log);
  if (game === 'hoops') return verifyHoops(day, log);
  if (game === 'treasure') return verifyTreasure(day, log);
  return bad('unknown-game');
}

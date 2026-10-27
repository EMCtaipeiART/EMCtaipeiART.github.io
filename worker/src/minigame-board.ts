import { DurableObject } from 'cloudflare:workers';
import { dayKey } from '../../EMC-ART-Pixel-Office/dist/minigames/core/rng.js';
import { COUNTDOWN_SECS, GAMES, verifyRun, type GameId } from './minigame-verify';

/**
 * 小遊戲正式排行榜（單一實例，SQLite 儲存）。
 * 「一局一張票」：開局由伺服器發 runId、決定日期（客戶端時鐘無效）；提交時伺服器重算分數、
 * 票只能用一次（單執行緒＋交易，同時兩個請求只會成功一個）、真實經過時間必須夠長。
 * 身分是匿名裝置碼＋暱稱（榜上顯示「暱稱#後四碼」），不連結任何人事或工作狀態資料。
 * 回傳 { status, body }，由 index.ts 轉成帶 CORS 的 Response。
 */
export const LIMITS = { openRuns: 3, perDeviceHour: 40, perIpHour: 120, retentionDays: 90, runRetentionDays: 7, boardSize: 20, grace: 45 };
const HEX32 = /^[0-9a-f]{32}$/;
const HOUR = 3600_000, DAY = 86_400_000;
export const FRIDGE_SLOTS = ['boba', 'bento', 'onigiri', 'sandwich', 'yogurt', 'pudding', 'drink', 'energy', 'egg', 'chips', 'cookie', 'candy', 'noodle', 'coffee', 'cake', 'donut', 'choco'] as const;
const FRIDGE_MAX = 8, FRIDGE_TAKE_LIMIT = 30, FRIDGE_STOCK_LIMIT = 5;
type Reply = { status: number; body: Record<string, unknown> };
const reply = (status: number, body: Record<string, unknown>): Reply => ({ status, body });
const hex = (n: number) => [...crypto.getRandomValues(new Uint8Array(n))].map(b => b.toString(16).padStart(2, '0')).join('');
export const cleanNick = (v: unknown) => String(v ?? '').replace(/[\u0000-\u001f\u007f<>]/g, '').trim().slice(0, 12);

export class MinigameBoard extends DurableObject<Env> {
  /** 測試可覆寫的時鐘 */
  clock: () => number = () => Date.now();

  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
    ctx.blockConcurrencyWhile(async () => {
      const sql = ctx.storage.sql;
      sql.exec(`CREATE TABLE IF NOT EXISTS devices (id TEXT PRIMARY KEY, nick TEXT NOT NULL, created_at INTEGER NOT NULL, last_seen INTEGER NOT NULL)`);
      sql.exec(`CREATE TABLE IF NOT EXISTS runs (run_id TEXT PRIMARY KEY, game TEXT NOT NULL, day TEXT NOT NULL, device TEXT NOT NULL, ip_hash TEXT NOT NULL,
        issued_at INTEGER NOT NULL, expires_at INTEGER NOT NULL, used INTEGER NOT NULL DEFAULT 0, status TEXT NOT NULL DEFAULT 'open', score INTEGER)`);
      sql.exec(`CREATE TABLE IF NOT EXISTS scores (id INTEGER PRIMARY KEY AUTOINCREMENT, run_id TEXT NOT NULL UNIQUE, game TEXT NOT NULL, day TEXT NOT NULL,
        device TEXT NOT NULL, score INTEGER NOT NULL, at INTEGER NOT NULL)`);
      sql.exec(`CREATE TABLE IF NOT EXISTS salts (day TEXT PRIMARY KEY, v TEXT NOT NULL)`);
      sql.exec(`CREATE TABLE IF NOT EXISTS fridge_stock (slot TEXT PRIMARY KEY, qty INTEGER NOT NULL)`);
      sql.exec(`CREATE TABLE IF NOT EXISTS fridge_meta (k TEXT PRIMARY KEY, v TEXT NOT NULL)`);
      sql.exec(`CREATE TABLE IF NOT EXISTS fridge_events (id INTEGER PRIMARY KEY AUTOINCREMENT, floor INTEGER NOT NULL, nick TEXT NOT NULL, kind TEXT NOT NULL, slot TEXT NOT NULL DEFAULT '', flag TEXT NOT NULL DEFAULT '', at INTEGER NOT NULL)`);
      sql.exec(`CREATE TABLE IF NOT EXISTS fridge_stats (day TEXT NOT NULL, nick TEXT NOT NULL, took INTEGER NOT NULL DEFAULT 0, stocked INTEGER NOT NULL DEFAULT 0, PRIMARY KEY (day, nick))`);
      sql.exec(`CREATE INDEX IF NOT EXISTS idx_scores_board ON scores(game, day, score DESC)`);
      sql.exec(`CREATE INDEX IF NOT EXISTS idx_runs_device ON runs(device, issued_at)`);
      sql.exec(`CREATE INDEX IF NOT EXISTS idx_runs_ip ON runs(ip_hash, issued_at)`);
      if ((await ctx.storage.getAlarm()) === null) await ctx.storage.setAlarm(Date.now() + DAY);
    });
  }

  private sql() { return this.ctx.storage.sql; }
  private one<T = Record<string, any>>(q: string, ...b: any[]): T | undefined { return this.sql().exec(q, ...b).toArray()[0] as T | undefined; }
  private all<T = Record<string, any>>(q: string, ...b: any[]): T[] { return this.sql().exec(q, ...b).toArray() as T[]; }

  private async ipHash(ip: string, day: string): Promise<string> {
    let salt = this.one<{ v: string }>('SELECT v FROM salts WHERE day = ?', day)?.v;
    if (!salt) { salt = hex(16); this.sql().exec('INSERT OR IGNORE INTO salts (day, v) VALUES (?, ?)', day, salt); salt = this.one<{ v: string }>('SELECT v FROM salts WHERE day = ?', day)!.v; }
    const d = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(salt + '|' + ip));
    return [...new Uint8Array(d)].slice(0, 12).map(b => b.toString(16).padStart(2, '0')).join('');
  }

  // ───────── 開局：發票 ─────────
  async startRun(req: { game?: unknown; device?: unknown; nick?: unknown; ip?: unknown }): Promise<Reply> {
    const game = String(req.game ?? '') as GameId;
    if (!(game in GAMES)) return reply(400, { ok: false, error: 'bad-game' });
    const now = this.clock(), day = dayKey(new Date(now));
    const ip = await this.ipHash(String(req.ip ?? 'unknown'), day);
    let device = typeof req.device === 'string' && HEX32.test(req.device) ? req.device : '';
    const nick = cleanNick(req.nick);
    if (device && !this.one('SELECT 1 FROM devices WHERE id = ?', device)) device = '';   // 沒見過的裝置碼不採用，由伺服器重發
    // 以下到 INSERT 為止都是同步的：檢查與寫入之間不會被別的請求插隊
    if (!device) device = hex(16);
    if (!this.one('SELECT 1 FROM devices WHERE id = ?', device)) this.sql().exec('INSERT INTO devices (id, nick, created_at, last_seen) VALUES (?, ?, ?, ?)', device, nick || '玩家', now, now);
    else this.sql().exec('UPDATE devices SET last_seen = ?, nick = CASE WHEN ? != \'\' THEN ? ELSE nick END WHERE id = ?', now, nick, nick, device);
    const perDevice = this.one<{ n: number }>('SELECT COUNT(*) AS n FROM runs WHERE device = ? AND issued_at > ?', device, now - HOUR)!.n;
    const open = this.one<{ n: number }>('SELECT COUNT(*) AS n FROM runs WHERE device = ? AND used = 0 AND expires_at > ?', device, now)!.n;
    const perIp = this.one<{ n: number }>('SELECT COUNT(*) AS n FROM runs WHERE ip_hash = ? AND issued_at > ?', ip, now - HOUR)!.n;
    if (perDevice >= LIMITS.perDeviceHour || open >= LIMITS.openRuns || perIp >= LIMITS.perIpHour) return reply(429, { ok: false, error: 'rate-limited' });
    const runId = hex(16), spec = GAMES[game];
    const expires = now + (spec.duration + COUNTDOWN_SECS + LIMITS.grace) * 1000;
    this.sql().exec('INSERT INTO runs (run_id, game, day, device, ip_hash, issued_at, expires_at) VALUES (?, ?, ?, ?, ?, ?, ?)', runId, game, day, device, ip, now, expires);
    const nickNow = this.one<{ nick: string }>('SELECT nick FROM devices WHERE id = ?', device)!.nick;
    return reply(200, { ok: true, runId, game, day, duration: spec.duration, expiresAt: expires, device, nick: nickNow, tag: device.slice(0, 4), verification: spec.level });
  }

  // ───────── 提交：驗證、重算、記分 ─────────
  submit(req: { runId?: unknown; device?: unknown; log?: unknown }): Reply {
    const runId = String(req.runId ?? ''), device = String(req.device ?? '');
    if (!HEX32.test(runId) || !HEX32.test(device)) return reply(400, { ok: false, error: 'bad-request' });
    const now = this.clock();
    return this.ctx.storage.transactionSync(() => {
      const run = this.one<{ game: GameId; day: string; device: string; issued_at: number; expires_at: number; used: number; status: string; score: number | null }>(
        'SELECT game, day, device, issued_at, expires_at, used, status, score FROM runs WHERE run_id = ?', runId);
      if (!run) return reply(404, { ok: false, error: 'no-run' });
      if (run.device !== device) return reply(403, { ok: false, error: 'wrong-device' });
      if (run.used) {   // 冪等：同一張票重送，回第一次的結果，不會再記一次
        if (run.status === 'ok') return reply(200, { ok: true, replay: true, score: run.score, ...this.standing(run.game, run.day, device, run.score!) });
        return reply(409, { ok: false, error: 'already-used', status: run.status });
      }
      const reject = (status: number, error: string) => { this.sql().exec('UPDATE runs SET used = 1, status = ? WHERE run_id = ?', 'rejected:' + error, runId); return reply(status, { ok: false, error }); };
      if (now > run.expires_at) return reject(410, 'expired');
      const verdict = verifyRun(run.game, run.day, req.log);
      if (!verdict.ok) return reject(422, verdict.error);
      // 真實時間下限：宣稱玩了多久，就必須真的過了那麼久（容許 2 秒誤差）
      const elapsed = (now - run.issued_at) / 1000;
      if (elapsed < COUNTDOWN_SECS + verdict.endT - 2) return reject(422, 'too-fast-real-time');
      this.sql().exec('INSERT INTO scores (run_id, game, day, device, score, at) VALUES (?, ?, ?, ?, ?, ?)', runId, run.game, run.day, device, verdict.score, now);
      this.sql().exec('UPDATE runs SET used = 1, status = \'ok\', score = ? WHERE run_id = ?', verdict.score, runId);
      return reply(200, { ok: true, score: verdict.score, detail: verdict.detail, ...this.standing(run.game, run.day, device, verdict.score) });
    });
  }

  private standing(game: GameId, day: string, device: string, score: number) {
    const better = this.one<{ n: number }>('SELECT COUNT(*) AS n FROM (SELECT device, MAX(score) AS m FROM scores WHERE game = ? AND day = ? GROUP BY device) WHERE m > ?', game, day, score)!.n;
    const mine = this.one<{ m: number }>('SELECT MAX(score) AS m FROM scores WHERE game = ? AND day = ? AND device = ?', game, day, device)?.m ?? score;
    return { rank: better + 1, dayBest: mine, isDayBest: score >= mine, day, board: this.boardRows(game, day, day) };
  }

  // ───────── 榜單 ─────────
  private boardRows(game: GameId, from: string, to: string) {
    return this.all<{ device: string; nick: string; score: number }>(
      `SELECT s.device AS device, d.nick AS nick, MAX(s.score) AS score FROM scores s JOIN devices d ON d.id = s.device
       WHERE s.game = ? AND s.day >= ? AND s.day <= ? GROUP BY s.device ORDER BY score DESC, MIN(s.at) ASC LIMIT ?`, game, from, to, LIMITS.boardSize
    ).map((r, i) => ({ rank: i + 1, name: r.nick + '#' + r.device.slice(0, 4), score: r.score }));
  }
  private cache = new Map<string, { at: number; body: Record<string, unknown> }>();
  board(req: { game?: unknown; range?: unknown }): Reply {
    const game = String(req.game ?? '') as GameId;
    if (!(game in GAMES)) return reply(400, { ok: false, error: 'bad-game' });
    const range = req.range === 'week' ? 'week' : 'today';
    const now = this.clock(), key = game + '|' + range + '|' + dayKey(new Date(now));
    const hit = this.cache.get(key);
    if (hit && now - hit.at < 30_000) return reply(200, hit.body);
    const to = dayKey(new Date(now)), from = range === 'week' ? dayKey(new Date(now - 6 * DAY)) : to;
    const body = { ok: true, game, range, from, to, verification: GAMES[game].level, entries: this.boardRows(game, from, to) };
    this.cache.set(key, { at: now, body });
    if (this.cache.size > 40) this.cache.clear();
    return reply(200, body);
  }

  // ───────── 清理 ─────────
  purge(now = this.clock()) {
    const cutoffDay = dayKey(new Date(now - LIMITS.retentionDays * DAY));
    this.sql().exec('DELETE FROM scores WHERE day < ?', cutoffDay);
    this.sql().exec('DELETE FROM runs WHERE issued_at < ?', now - LIMITS.runRetentionDays * DAY);
    this.sql().exec('DELETE FROM salts WHERE day < ?', dayKey(new Date(now - 2 * DAY)));
    this.sql().exec('DELETE FROM devices WHERE last_seen < ? AND id NOT IN (SELECT device FROM scores)', now - LIMITS.retentionDays * DAY);
    this.cache.clear();
  }
  // ───────── 茶水間冰箱：零食庫存、偷吃、補貨（五樓、四樓各一台，庫存分開；動作事件讓所有人同步看到）─────────
  /** 四樓的資料表鍵加「4:」前綴，五樓維持原樣 */
  private fk(floor: number, k: string) { return floor === 4 ? '4:' + k : k; }
  private meta(floor: number, k: string) { return this.one<{ v: string }>('SELECT v FROM fridge_meta WHERE k = ?', this.fk(floor, k))?.v ?? ''; }
  private setMeta(floor: number, k: string, v: string) { this.sql().exec('INSERT OR REPLACE INTO fridge_meta (k, v) VALUES (?, ?)', this.fk(floor, k), v); }

  /** 每天第一次被問到時自動進貨（台北日期）；庫存只補不到底線的格子，限量金布丁只在某些日子出現 */
  private fridgeDay(floor: number): string {
    const now = this.clock(), day = dayKey(new Date(now));
    if (this.meta(floor, 'day') !== day) {
      const h = [...day + floor].reduce((a, c) => (Math.imul(a, 31) + c.charCodeAt(0)) >>> 0, 7);
      FRIDGE_SLOTS.forEach((slot, i) => {
        const base = 2 + ((h >>> ((i * 3) % 29)) % 4), key = this.fk(floor, slot);
        const cur = this.one<{ qty: number }>('SELECT qty FROM fridge_stock WHERE slot = ?', key)?.qty ?? 0;
        this.sql().exec('INSERT OR REPLACE INTO fridge_stock (slot, qty) VALUES (?, ?)', key, Math.max(cur, base));
      });
      this.sql().exec('INSERT OR REPLACE INTO fridge_stock (slot, qty) VALUES (?, ?)', this.fk(floor, 'rare'), h % 3 === 0 ? 1 : 0);
      this.setMeta(floor, 'day', day);
      this.setMeta(floor, 'stocker', '自動進貨');
      this.setMeta(floor, 'stockAt', String(now));
    }
    // 桌上的紙箱：每 4 小時換一批（每批 3 箱、3 種不同零食），先搶先贏
    const hour = new Date(now + 8 * 3600_000).getUTCHours(), batch = day + '-' + Math.floor(hour / 4);
    if (this.meta(floor, 'batch') !== batch) {
      const pool = [...FRIDGE_SLOTS], boxes: string[] = [];
      while (boxes.length < 3) boxes.push(pool.splice(crypto.getRandomValues(new Uint8Array(1))[0] % pool.length, 1)[0]);
      this.setMeta(floor, 'batch', batch);
      this.setMeta(floor, 'boxes', JSON.stringify(boxes));
    }
    return day;
  }

  private fridgeView(day: string, floor: number, since = -1): Record<string, unknown> {
    const stock: Record<string, number> = {};
    for (const r of this.all<{ slot: string; qty: number }>('SELECT slot, qty FROM fridge_stock')) {
      if (floor === 4 ? r.slot.startsWith('4:') : !r.slot.includes(':')) stock[floor === 4 ? r.slot.slice(2) : r.slot] = r.qty;
    }
    const days = [0, 1, 2, 3, 4, 5, 6].map(n => dayKey(new Date(this.clock() - n * DAY)));
    const top = (col: 'took' | 'stocked') => this.all<{ nick: string; n: number }>(
      `SELECT nick, SUM(${col}) AS n FROM fridge_stats WHERE day IN (${days.map(() => '?').join(',')}) GROUP BY nick HAVING n > 0 ORDER BY n DESC, nick LIMIT 3`, ...days);
    const evMax = this.one<{ m: number | null }>('SELECT MAX(id) AS m FROM fridge_events WHERE floor = ?', floor)?.m ?? 0;
    const events = since < 0 ? [] : this.all('SELECT id, nick, kind, slot, flag FROM fridge_events WHERE floor = ? AND id > ? AND at > ? ORDER BY id LIMIT 20', floor, since, this.clock() - 20_000);
    return { ok: true, day, floor, stock, stocker: this.meta(floor, 'stocker'), stockAt: Number(this.meta(floor, 'stockAt')) || 0, kings: top('took'), heroes: top('stocked'), boxes: JSON.parse(this.meta(floor, 'boxes') || '[]'), evMax, events };
  }
  private logEvent(floor: number, nick: string, kind: string, slot = '', flag = '') {
    this.sql().exec('INSERT INTO fridge_events (floor, nick, kind, slot, flag, at) VALUES (?, ?, ?, ?, ?, ?)', floor, nick, kind, slot, flag, this.clock());
    this.sql().exec('DELETE FROM fridge_events WHERE at < ?', this.clock() - 120_000);
  }

  async fridge(req: { floor?: unknown; since?: unknown } = {}): Promise<Reply> {
    const floor = Number(req.floor) === 4 ? 4 : 5, since = req.since === null || req.since === undefined || req.since === '' ? -1 : Math.max(0, Number(req.since) || 0);
    return reply(200, this.fridgeView(this.fridgeDay(floor), floor, since));
  }

  async fridgeAct(req: { action?: unknown; slot?: unknown; nick?: unknown; floor?: unknown }): Promise<Reply> {
    const floor = Number(req.floor) === 4 ? 4 : 5, day = this.fridgeDay(floor), nick = cleanNick(req.nick) || '匿名', action = String(req.action ?? '');
    const view = () => this.fridgeView(day, floor);
    const bump = (col: 'took' | 'stocked', by = 1) => this.sql().exec(
      `INSERT INTO fridge_stats (day, nick, ${col}) VALUES (?, ?, ?) ON CONFLICT(day, nick) DO UPDATE SET ${col} = ${col} + ?`, day, nick, by, by);
    const used = this.one<{ took: number; stocked: number }>('SELECT took, stocked FROM fridge_stats WHERE day = ? AND nick = ?', day, nick);
    const slot = String(req.slot ?? '');
    if (action === 'open') {
      const last = this.one<{ at: number }>("SELECT at FROM fridge_events WHERE floor = ? AND nick = ? AND kind = 'open' ORDER BY id DESC LIMIT 1", floor, nick)?.at ?? 0;
      if (this.clock() - last > 3000) this.logEvent(floor, nick, 'open');
      return reply(200, view());
    }
    if (action === 'take') {
      if (!(FRIDGE_SLOTS as readonly string[]).includes(slot) && slot !== 'rare') return reply(400, { ok: false, error: 'bad-slot' });
      if ((used?.took ?? 0) >= FRIDGE_TAKE_LIMIT) return reply(429, { ok: false, error: 'full-stomach', ...view() });
      const key = this.fk(floor, slot), qty = this.one<{ qty: number }>('SELECT qty FROM fridge_stock WHERE slot = ?', key)?.qty ?? 0;
      if (qty <= 0) return reply(409, { ok: false, error: 'empty', ...view() });
      this.sql().exec('UPDATE fridge_stock SET qty = qty - 1 WHERE slot = ?', key);
      bump('took');
      const surprise = slot === 'rare' ? 'rare' : slot === 'yogurt' && crypto.getRandomValues(new Uint8Array(1))[0] < 32 ? 'expired' : null;
      const t = new Date(this.clock() + 8 * 3600_000), hour = t.getUTCHours(), weekend = [0, 6].includes(t.getUTCDay());
      const caught = weekend || hour < 9 || hour >= 19;
      this.logEvent(floor, nick, 'take', slot, caught ? 'caught' : surprise ?? '');
      return reply(200, { ...view(), took: slot, surprise, caught });
    }
    if (action === 'box') {
      const boxes: string[] = JSON.parse(this.meta(floor, 'boxes') || '[]'), at = boxes.indexOf(slot);
      if (at < 0) return reply(409, { ok: false, error: 'no-box', ...view() });
      if ((used?.stocked ?? 0) >= FRIDGE_STOCK_LIMIT) return reply(429, { ok: false, error: 'enough', ...view() });
      boxes.splice(at, 1);
      this.setMeta(floor, 'boxes', JSON.stringify(boxes));
      this.sql().exec('UPDATE fridge_stock SET qty = MIN(?, qty + 3) WHERE slot = ?', FRIDGE_MAX, this.fk(floor, slot));
      bump('stocked');
      this.setMeta(floor, 'stocker', nick);
      this.setMeta(floor, 'stockAt', String(this.clock()));
      this.logEvent(floor, nick, 'box', slot);
      return reply(200, { ...view(), stocked: slot });
    }
    if (action === 'stock') {
      if ((used?.stocked ?? 0) >= FRIDGE_STOCK_LIMIT) return reply(429, { ok: false, error: 'enough', ...view() });
      if (!(FRIDGE_SLOTS as readonly string[]).includes(slot)) return reply(400, { ok: false, error: 'bad-slot' });
      this.sql().exec('UPDATE fridge_stock SET qty = MIN(?, qty + 2) WHERE slot = ?', FRIDGE_MAX, this.fk(floor, slot));
      bump('stocked');
      this.setMeta(floor, 'stocker', nick);
      this.setMeta(floor, 'stockAt', String(this.clock()));
      return reply(200, { ...view(), stocked: slot });
    }
    return reply(400, { ok: false, error: 'bad-action' });
  }

  async alarm() { this.purge(); await this.ctx.storage.setAlarm(this.clock() + DAY); }
}

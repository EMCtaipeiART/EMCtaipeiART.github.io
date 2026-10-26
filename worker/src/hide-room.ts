import { DurableObject } from 'cloudflare:workers';
// 規則與單機版是同一份程式碼（單一來源）：伺服器跑的就是 Phase 5 驗證過的 hideseek-sim。
import { RULES, createGame, stepGame, canSee, scoreFor, seekerOf } from '../../EMC-ART-Pixel-Office/dist/minigames/games/hideseek-sim.js';
import { createRng } from '../../EMC-ART-Pixel-Office/dist/minigames/core/rng.js';

/**
 * 辦公室躲貓貓的連線房間（一個邀請碼 = 一個房間）。伺服器權威：
 * 客戶端只能送「想往哪走、按了抓」，位置、抓捕、勝負全由這裡算；
 * 給尋找者的快照只包含他「看得到」的躲藏者（躲藏階段完全看不到），不靠客戶端自律。
 * 只存在記憶體，不寫任何資料，也不碰案件資料庫或同事狀態表。
 * 關閉碼：4400 請求錯誤、4404 找不到房間、4409 房間已存在／已滿／已開始、4413 訊息太大、
 *        4429 太頻繁、4408 閒置太久、4000 被同一憑證的新連線取代。
 */
const TICK = 1 / 30;            // 規則推進步長
const SNAP_EVERY = 2;           // 每 2 個 tick 廣播一次快照（15Hz）
const GRACE_MS = 20_000;        // 斷線寬限
const EMPTY_MS = 60_000;        // 沒有任何連線多久後清掉房間
const IDLE_MS = 10 * 60_000;    // 沒有任何訊息多久後關房
const MAX_MSG = 512;
const MAX_QUEUE = 6;
const MAX_NAME = 12;
const CODE_RE = /^[A-Z0-9]{6}$/;

interface Input { seq: number; dx: number; dy: number; catch: boolean }
interface Member {
  id: string; token: string; name: string; ws: WebSocket | null; lostAt: number | null;
  queue: Input[]; held: Input; recv: number; ack: number; sim: string; tokens: number; tokenAt: number; strikes: number;
}
interface Room {
  code: string; max: number; state: 'lobby' | 'playing'; host: string; members: Member[]; nextId: number;
  game: any; tick: number; lastActivity: number; emptySince: number | null; ticker: ReturnType<typeof setInterval> | null;
  sweeper: ReturnType<typeof setInterval> | null; lastAt: number; acc: number; events: any[];
}

const hex = (n: number) => [...crypto.getRandomValues(new Uint8Array(n))].map(b => b.toString(16).padStart(2, '0')).join('');
const clean = (v: unknown) => String(v ?? '').replace(/[\u0000-\u001f\u007f<>]/g, '').trim().slice(0, MAX_NAME);
const round1 = (n: number) => Math.round(n * 10) / 10;

export class HideSeekRoom extends DurableObject<Env> {
  private room: Room | null = null;
  private byWs = new Map<WebSocket, Member>();

  async fetch(request: Request): Promise<Response> {
    if (request.headers.get('Upgrade')?.toLowerCase() !== 'websocket') return new Response('Expected WebSocket', { status: 426 });
    const url = new URL(request.url);
    const code = (url.searchParams.get('room') || '').toUpperCase();
    const mode = url.searchParams.get('mode') === 'create' ? 'create' : 'join';
    const token = url.searchParams.get('token') || '';
    const pair = new WebSocketPair();
    const [client, server] = [pair[0], pair[1]];
    server.accept();
    const reject = (c: number, reason: string) => { try { server.close(c, reason); } catch { /* 已關閉 */ } };
    if (!CODE_RE.test(code)) { reject(4400, 'bad-code'); return new Response(null, { status: 101, webSocket: client }); }
    const name = clean(url.searchParams.get('name'));

    if (mode === 'create') {
      if (this.room) { reject(4409, 'taken'); return new Response(null, { status: 101, webSocket: client }); }
      const max = Math.max(RULES.minPlayers, Math.min(RULES.maxPlayers, Number(url.searchParams.get('max')) || 4));
      this.createRoom(code, max);
    } else if (!this.room) { reject(4404, 'no-room'); return new Response(null, { status: 101, webSocket: client }); }

    const room = this.room!;
    let m = token ? room.members.find(x => x.token === token) : undefined;
    if (m) {// 重新連線：認回同一個座位
      if (m.ws && m.ws !== server) { this.byWs.delete(m.ws); try { m.ws.close(4000, 'replaced'); } catch { /* 已關閉 */ } }
      m.ws = server; m.lostAt = null;
    } else {
      if (room.state !== 'lobby' || room.members.length >= room.max) { reject(4409, room.state !== 'lobby' ? 'started' : 'full'); return new Response(null, { status: 101, webSocket: client }); }
      m = this.addMember(room, server, name);
    }
    room.emptySince = null; room.lastActivity = Date.now();
    this.byWs.set(server, m);
    server.addEventListener('message', e => this.onMessage(server, e.data));
    server.addEventListener('close', () => this.onClose(server));
    server.addEventListener('error', () => this.onClose(server));
    this.send(server, this.welcome(room, m));
    if (room.state === 'playing') this.sendGameStart(room, m);
    this.broadcastLobby(room);
    return new Response(null, { status: 101, webSocket: client });
  }

  // ───────── 房間生命週期 ─────────
  private createRoom(code: string, max: number) {
    this.room = {
      code, max, state: 'lobby', host: '', members: [], nextId: 0, game: null, tick: 0, lastActivity: Date.now(), emptySince: null,
      ticker: null, sweeper: setInterval(() => this.sweep(), 1000), lastAt: 0, acc: 0, events: []
    };
  }
  private resetRoom() {
    const r = this.room; if (!r) return;
    if (r.ticker) clearInterval(r.ticker);
    if (r.sweeper) clearInterval(r.sweeper);
    for (const m of r.members) if (m.ws) { try { m.ws.close(4408, 'closed'); } catch { /* 已關閉 */ } }
    this.byWs.clear(); this.room = null;
  }
  private addMember(room: Room, ws: WebSocket, name: string): Member {
    const id = 'm' + room.nextId++;
    let n = name || '玩家' + (room.members.length + 1);
    while (room.members.some(x => x.name === n)) n = (n.slice(0, MAX_NAME - 1) + room.nextId % 10);
    const m: Member = { id, token: hex(16), name: n, ws, lostAt: null, queue: [], held: { seq: 0, dx: 0, dy: 0, catch: false }, recv: 0, ack: 0, sim: '', tokens: 60, tokenAt: Date.now(), strikes: 0 };
    room.members.push(m);
    if (!room.host) room.host = id;
    return m;
  }
  private connected(room: Room) { return room.members.filter(m => m.ws && m.lostAt === null); }

  /** 每秒：寬限逾時處理、房主轉移、空房與閒置清理。 */
  private sweep() {
    const r = this.room; if (!r) return;
    const now = Date.now();
    for (const m of [...r.members]) {
      if (m.lostAt === null || now - m.lostAt <= GRACE_MS) continue;
      if (r.state === 'lobby') { r.members = r.members.filter(x => x !== m); }
      else if (!m.sim) continue;
      else {
        const p = r.game.players.find((x: any) => x.id === m.sim);
        if (p.role === 'seeker') { this.voidGame(r, 'seeker-left'); return; }
        if (p.state === 'alive') { p.state = 'caught'; p.caughtAt = r.game.t; p.left = true; r.events.push({ t: 'caught', id: m.id, left: true }); }
        m.lostAt = now + 1e12;// 只處理一次
      }
    }
    if (!r.members.some(m => m.id === r.host && m.lostAt === null)) {
      const next = this.connected(r)[0]; if (next) r.host = next.id;
    }
    if (this.connected(r).length === 0) { if (r.emptySince === null) r.emptySince = now; else if (now - r.emptySince > EMPTY_MS) { this.resetRoom(); return; } }
    if (now - r.lastActivity > IDLE_MS) this.resetRoom();
    else if (r.state === 'lobby') this.broadcastLobby(r);
  }

  // ───────── 訊息 ─────────
  private onMessage(ws: WebSocket, data: unknown) {
    const room = this.room, m = this.byWs.get(ws); if (!room || !m) return;
    if (typeof data !== 'string') return;
    if (data.length > MAX_MSG) { try { ws.close(4413, 'too-large'); } catch { /* 已關閉 */ } return; }
    const now = Date.now();
    m.tokens = Math.min(90, m.tokens + (now - m.tokenAt) * 0.06); m.tokenAt = now;// 每秒補 60 則
    if (m.tokens < 1) { if (++m.strikes > 200) { try { ws.close(4429, 'rate'); } catch { /* 已關閉 */ } } return; }
    m.tokens -= 1;
    let msg: any; try { msg = JSON.parse(data); } catch { if (++m.strikes > 20) { try { ws.close(4400, 'bad-json'); } catch { /* 已關閉 */ } } return; }
    if (!msg || typeof msg !== 'object') return;
    room.lastActivity = now;
    switch (msg.t) {
      case 'ping': this.send(ws, { t: 'pong' }); break;
      case 'in': this.onInput(room, m, msg); break;
      case 'start': if (room.state === 'lobby' && m.id === room.host) this.startGame(room); break;
      case 'leave': try { ws.close(1000, 'leave'); } catch { /* 已關閉 */ } break;
    }
  }
  private onInput(room: Room, m: Member, msg: any) {
    if (room.state !== 'playing') return;
    const num = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? Math.max(-1, Math.min(1, v)) : 0);
    const seq = Number.isInteger(msg.seq) && msg.seq > m.recv ? msg.seq : null;
    if (seq === null) return;// 序號必須遞增，重送的舊封包直接丟棄
    m.queue.push({ seq, dx: num(msg.dx), dy: num(msg.dy), catch: msg.catch === true });
    if (m.queue.length > MAX_QUEUE) m.queue.shift();// 灌太多只會丟舊的：速度仍然每 tick 只走一步
    m.recv = seq;
  }
  private onClose(ws: WebSocket) {
    const room = this.room, m = this.byWs.get(ws); this.byWs.delete(ws);
    if (!room || !m || m.ws !== ws) return;
    m.ws = null; m.lostAt = Date.now(); m.queue.length = 0;
    if (room.state === 'lobby') this.broadcastLobby(room);
  }

  // ───────── 遊戲 ─────────
  private startGame(room: Room) {
    const members = this.connected(room);
    if (members.length < RULES.minPlayers) return;
    room.members = members;// 斷線的人不進這一局
    const rng = createRng(crypto.getRandomValues(new Uint32Array(1))[0]);
    const g = createGame({ rng, count: members.length, seekerIndex: undefined });
    members.forEach((m, i) => { m.sim = 'p' + i; m.queue = []; m.held = { seq: 0, dx: 0, dy: 0, catch: false }; m.recv = 0; m.ack = 0; g.players[i].name = m.name; });
    room.game = g; room.state = 'playing'; room.tick = 0; room.events = []; room.acc = 0; room.lastAt = Date.now();
    for (const m of members) this.sendGameStart(room, m);
    this.broadcastLobby(room);
    room.ticker = setInterval(() => this.runTicks(room), 1000 / 30);
  }
  private voidGame(room: Room, reason: string) {
    if (room.ticker) clearInterval(room.ticker);
    room.ticker = null; room.state = 'lobby'; room.game = null;
    for (const m of room.members) { m.sim = ''; this.send(m.ws, { t: 'void', reason }); }
    this.broadcastLobby(room);
  }
  private runTicks(room: Room) {
    const g = room.game; if (!g || room.state !== 'playing') return;
    const now = Date.now();
    room.acc += Math.min((now - room.lastAt) / 1000, TICK * 5); room.lastAt = now;
    let steps = 0;
    while (room.acc >= TICK) { room.acc -= TICK; steps++; }
    this.advance(room, steps);
  }
  /** 精確推進 n 個固定步長（時鐘只決定 n；規則本身與時鐘無關，所以可以逐步重現與測試）。 */
  private advance(room: Room, n: number) {
    const g = room.game; if (!g || room.state !== 'playing') return;
    for (let k = 0; k < n && !g.over; k++) {
      const inputs: Record<string, { dx: number; dy: number; catch: boolean }> = {};
      for (const m of room.members) {
        // 每個 tick 只消耗一則輸入（速度由伺服器決定）；沒有新輸入就沿用上一則的方向，抓捕鍵只算一次
        const next = m.queue.shift();
        const inp = next ?? m.held;
        m.held = { seq: inp.seq, dx: inp.dx, dy: inp.dy, catch: false };
        if (next) m.ack = next.seq;
        inputs[m.sim] = m.lostAt === null ? { dx: inp.dx, dy: inp.dy, catch: inp.catch } : { dx: 0, dy: 0, catch: false };
      }
      stepGame(g, inputs, TICK);
      room.tick++;
      for (const e of g.events) {
        if (e.type === 'caught') room.events.push({ t: 'caught', id: this.idOf(room, e.id) });
        else if (e.type === 'phase') room.events.push({ t: 'phase', phase: e.phase });
        else if (e.type === 'miss') room.events.push({ t: 'miss' });
      }
      if (room.tick % SNAP_EVERY === 0) this.broadcastSnap(room);
    }
    if (g.over) this.finish(room);
  }
  private idOf(room: Room, sim: string) { return room.members.find(m => m.sim === sim)?.id ?? sim; }
  private finish(room: Room) {
    const g = room.game;
    if (room.ticker) clearInterval(room.ticker);
    room.ticker = null;
    this.broadcastSnap(room);
    const scores: Record<string, number> = {}, roles: Record<string, string> = {};
    for (const m of room.members) { scores[m.id] = scoreFor(g, m.sim); roles[m.id] = g.players.find((p: any) => p.id === m.sim).role; }
    const over = { t: 'over', winner: g.winner, scores, roles, time: round1(g.t) };
    room.state = 'lobby'; room.game = null;
    for (const m of room.members) { m.sim = ''; this.send(m.ws, over); }
    this.broadcastLobby(room);
  }

  // ───────── 送出 ─────────
  private send(ws: WebSocket | null, obj: unknown) { if (!ws) return; try { ws.send(JSON.stringify(obj)); } catch { /* 對方已失效 */ } }
  private welcome(room: Room, m: Member) { return { t: 'welcome', you: m.id, token: m.token, room: room.code, max: room.max, host: room.host, state: room.state, players: this.roster(room) }; }
  private roster(room: Room) { return room.members.map(x => ({ id: x.id, name: x.name, online: x.lostAt === null && !!x.ws })); }
  private broadcastLobby(room: Room) {
    const msg = { t: 'lobby', host: room.host, max: room.max, state: room.state, players: this.roster(room) };
    for (const m of room.members) this.send(m.ws, msg);
  }
  private sendGameStart(room: Room, m: Member) {
    const g = room.game; if (!g) return;
    const me = g.players.find((p: any) => p.id === m.sim);
    this.send(m.ws, {
      t: 'game', you: m.id, role: me.role, hideSecs: g.hideSecs, totalSecs: g.totalSecs,
      seeker: me.role === 'hider' ? this.idOf(room, g.seekerId) : m.id,
      players: room.members.map(x => ({ id: x.id, name: x.name, color: g.players.find((p: any) => p.id === x.sim).color }))
    });
  }
  /** 快照：每個人拿到的內容不同——尋找者只看得到「視線內」的躲藏者。 */
  private broadcastSnap(room: Room) {
    const g = room.game; if (!g) return;
    const sk = seekerOf(g);
    const caught = room.members.filter(m => g.players.find((p: any) => p.id === m.sim).state !== 'alive').map(m => m.id);
    const alive = g.players.filter((p: any) => p.role === 'hider' && p.state === 'alive').length;
    for (const m of room.members) {
      if (!m.ws) continue;
      const me = g.players.find((p: any) => p.id === m.sim);
      const seekerBlind = me.role === 'seeker' && me.state === 'alive';
      const list = g.players.filter((p: any) => {
        if (p === me) return true;
        if (!seekerBlind) return true;
        return g.phase === 'seek' && p.role === 'hider' && p.state === 'alive' && canSee(sk, p);
      });
      const events = room.events.filter(e => e.t !== 'miss' || me.role === 'seeker');
      this.send(m.ws, {
        t: 'snap', k: room.tick, time: round1(g.t), phase: g.phase, ack: m.ack, left: alive, c: caught, ev: events,
        p: list.map((p: any) => [this.idOf(room, p.id), round1(p.x), round1(p.y), p.dir, (p.state === 'alive' ? 0 : 1) | (p.role === 'seeker' ? 4 : 0) | (p === me && p.inCover ? 2 : 0)])
      });
    }
    room.events = [];
  }
}

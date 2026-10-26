import { env, runInDurableObject, SELF } from 'cloudflare:test';
import { describe, expect, it } from 'vitest';
import { RULES, MAP, canSee, movePlayer, zoneCenter } from '../../EMC-ART-Pixel-Office/dist/minigames/games/hideseek-sim.js';

const wait = (ms = 30) => new Promise(r => setTimeout(r, ms));
async function until(cond: () => boolean, ms = 4000) {
  const end = Date.now() + ms;
  while (!cond() && Date.now() < end) await wait(10);
  return cond();
}
let counter = 0;
const newCode = () => ('T' + String(Date.now() % 1e9) + String(counter++)).slice(-6).toUpperCase().padStart(6, 'A').replace(/[^A-Z0-9]/g, 'X');

class Client {
  ws!: WebSocket; inbox: any[] = []; closed: number | null = null; id = ''; token = ''; role = ''; seeker = '';
  static async open(code: string, mode: 'create' | 'join', name = 'x', extra = '') {
    const c = new Client();
    const res = await SELF.fetch(`https://example.com/hideseek?room=${code}&mode=${mode}&name=${encodeURIComponent(name)}${extra}`, { headers: { Upgrade: 'websocket' } });
    c.ws = res.webSocket!; c.ws.accept();
    c.ws.addEventListener('message', e => {
      let m: any; try { m = JSON.parse(String(e.data)); } catch { return; }
      c.inbox.push(m);
      if (m.t === 'welcome') { c.id = m.you; c.token = m.token; }
      if (m.t === 'game') { c.role = m.role; c.seeker = m.seeker; }
    });
    c.ws.addEventListener('close', e => { c.closed = e.code; });
    return c;
  }
  send(o: unknown) { this.ws.send(JSON.stringify(o)); }
  find(t: string) { return this.inbox.filter(m => m.t === t); }
  last(t: string) { const a = this.find(t); return a[a.length - 1]; }
  async got(t: string) { return until(() => this.find(t).length > 0); }
  seq = 0;
  input(dx: number, dy: number, c = false) { this.send({ t: 'in', seq: ++this.seq, dx, dy, catch: c }); }
}

async function roomWith(n: number, code = newCode()) {
  const host = await Client.open(code, 'create', 'host', `&max=${Math.max(n, 2)}`);
  await host.got('welcome');
  const guests: Client[] = [];
  for (let i = 1; i < n; i++) { const g = await Client.open(code, 'join', 'g' + i); await g.got('welcome'); guests.push(g); }
  return { code, host, all: [host, ...guests] };
}
const inst = <T>(code: string, fn: (i: any) => T | Promise<T>) => (runInDurableObject as any)((env.HIDESEEK_ROOM as any).getByName(code), (i: any) => fn(i)) as Promise<T>;

async function startGame(n: number) {
  const r = await roomWith(n);
  r.host.send({ t: 'start' });
  for (const c of r.all) expect(await c.got('game')).toBe(true);
  return r;
}
const seekerOf = (all: Client[]) => all.find(c => c.role === 'seeker')!;
const hidersOf = (all: Client[]) => all.filter(c => c.role === 'hider');

describe('HideSeekRoom 連線房間', () => {
  it('建立、加入、房滿、不存在、重複建立、壞邀請碼', async () => {
    const code = newCode();
    const host = await Client.open(code, 'create', '小明', '&max=2');
    await host.got('welcome');
    expect(host.last('welcome').players).toHaveLength(1);
    const a = await Client.open(code, 'join', '小華'); await a.got('welcome');
    const full = await Client.open(code, 'join', '第三人'); await until(() => full.closed !== null);
    expect(full.closed).toBe(4409);
    const dup = await Client.open(code, 'create', '搶房'); await until(() => dup.closed !== null);
    expect(dup.closed).toBe(4409);
    const none = await Client.open(newCode(), 'join'); await until(() => none.closed !== null);
    expect(none.closed).toBe(4404);
    const res = await SELF.fetch('https://example.com/hideseek?room=bad', { headers: { Upgrade: 'websocket' } });
    expect(res.status).toBe(400);
    await until(() => host.last('lobby')?.players.length === 2);
    expect(host.last('lobby').players.map((p: any) => p.name)).toEqual(['小明', '小華']);
  });

  it('名字會被清理（控制字元、過長、重複）', async () => {
    const code = newCode();
    const a = await Client.open(code, 'create', '<b>很長很長很長很長很長很長的名字</b>', '&max=3'); await a.got('welcome');
    const b = await Client.open(code, 'join', '<b>很長很長很長很長很長很長的名字</b>'); await b.got('welcome');
    await until(() => b.last('lobby')?.players.length === 2);
    const names = b.last('lobby').players.map((p: any) => p.name);
    expect(names.every((n: string) => n.length <= 12 && !/[<>]/.test(n))).toBe(true);
    expect(new Set(names).size).toBe(2);
  });

  it('只有房主能開始，至少 2 人', async () => {
    const code = newCode();
    const host = await Client.open(code, 'create', 'h', '&max=3'); await host.got('welcome');
    host.send({ t: 'start' }); await wait(150);
    expect(host.find('game')).toHaveLength(0);
    const g = await Client.open(code, 'join', 'g'); await g.got('welcome');
    g.send({ t: 'start' }); await wait(150);
    expect(host.find('game')).toHaveLength(0);
    host.send({ t: 'start' });
    expect(await host.got('game')).toBe(true);
    expect(await g.got('game')).toBe(true);
    const late = await Client.open(code, 'join', 'late'); await until(() => late.closed !== null);
    expect(late.closed).toBe(4409);// 已開始
  });

  it('隨機一位尋找者，其他是躲藏者；躲藏階段尋找者不能動也看不到任何人', async () => {
    const { code, all } = await startGame(4);
    expect(all.filter(c => c.role === 'seeker')).toHaveLength(1);
    expect(hidersOf(all)).toHaveLength(3);
    const sk = seekerOf(all);
    await until(() => sk.find('snap').length >= 3);
    for (const s of sk.find('snap')) { expect(s.phase).toBe('hide'); expect(s.p.map((p: any) => p[0])).toEqual([sk.id]); }
    const before = sk.last('snap').p[0].slice(1, 3);
    for (let i = 0; i < 10; i++) sk.input(1, 0);
    await wait(400);
    expect(sk.last('snap').p[0].slice(1, 3)).toEqual(before);
    const h = hidersOf(all)[0]; await until(() => h.find('snap').length >= 2);
    expect(h.last('snap').p).toHaveLength(4);// 躲藏者看得到所有人
    void code;
  });

  it('伺服器決定速度：灌大量輸入也不會跑得比規則快', async () => {
    const { all } = await startGame(2);
    const h = hidersOf(all)[0];
    await until(() => h.find('snap').length >= 2);
    const start = h.last('snap').p.find((p: any) => p[0] === h.id);
    const t0 = Date.now();
    for (let i = 0; i < 400; i++) h.input(1, 0);// 一口氣灌 400 則
    await wait(600);
    const now = h.last('snap').p.find((p: any) => p[0] === h.id);
    const dt = (Date.now() - t0) / 1000;
    expect(now[1] - start[1]).toBeLessThanOrEqual(RULES.hiderSpeed * dt + 20);
  });

  it('伺服器結果和本機預測逐步一致（規則一致性）', async () => {
    const { code, all } = await startGame(2);
    const h = hidersOf(all)[0];
    const dirs = [[1, 0], [1, 0], [1, 1], [0, 1], [0, 1], [-1, 0.5], [-1, 0], [0, -1], [1, -1], [0.3, 0.3]];
    const r = await inst(code, (i: any) => {
      clearInterval(i.room.ticker); i.room.ticker = null;// 停掉即時計時，改成手動推進固定步數
      const m = i.room.members.find((x: any) => x.id === h.id), p = i.room.game.players.find((x: any) => x.id === m.sim);
      const local = { x: p.x, y: p.y, role: 'hider', dir: 1 } as any;
      m.queue = []; m.recv = 0;
      for (let n = 0; n < 60; n++) {
        const [dx, dy] = dirs[n % dirs.length];
        m.queue.push({ seq: n + 1, dx, dy, catch: false });
        movePlayer({ map: MAP }, local, dx, dy, 1 / 30);
        if (m.queue.length >= 5) i.advance(i.room, 5);
      }
      return { server: [p.x, p.y], local: [local.x, local.y], ack: m.ack };
    });
    expect(r.ack).toBe(60);
    expect(Math.abs(r.server[0] - r.local[0])).toBeLessThan(1e-9);
    expect(Math.abs(r.server[1] - r.local[1])).toBeLessThan(1e-9);
  });

  it('尋找者快照只含看得到的躲藏者（遮蔽、視線、距離都由伺服器判斷）', async () => {
    const { code, all } = await startGame(3);
    const sk = seekerOf(all), [h1, h2] = hidersOf(all);
    // 進入尋找階段，尋找者站在左下空地；h1 躲在遠處遮蔽區、h2 在隔板另一側
    await inst(code, i => {
      const g = i.room.game, byId = (id: string) => g.players.find((p: any) => p.id === id);
      const skp = g.players.find((p: any) => p.role === 'seeker');
      g.t = g.hideSecs + 0.1; skp.x = 200; skp.y = 300;
      const [a, b] = g.players.filter((p: any) => p.role === 'hider');
      const z = MAP.zones.find(z => z.id === 'z-desks')!; const zc = zoneCenter(z);
      a.x = zc.x; a.y = zc.y;     // 遠處、在遮蔽區
      b.x = 360; b.y = 270;       // 隔板（高家具）另一側附近
      void byId;
    });
    await wait(300);
    let snap = sk.last('snap');
    expect(snap.phase).toBe('seek');
    expect(snap.p.map((p: any) => p[0]).sort()).toEqual([sk.id]);
    // 把 h1 帶到尋找者面前（開放空地、沒有遮蔽區）→ 看得到
    await inst(code, i => { const g = i.room.game; const hs = g.players.filter((p: any) => p.role === 'hider'); hs[0].x = 260; hs[0].y = 300; });
    await wait(300);
    snap = sk.last('snap');
    const ids = snap.p.map((p: any) => p[0]);
    expect(ids).toContain(sk.id);
    expect(ids.length).toBe(2);
    // 確認每一個被送出的躲藏者，在伺服器端真的 canSee
    const truth = await inst(code, i => { const g = i.room.game; const s = g.players.find((p: any) => p.role === 'seeker'); return g.players.filter((p: any) => p.role === 'hider').map((p: any) => canSee(s, p)); });
    expect(truth.filter(Boolean).length).toBe(1);
    void h1; void h2;
  });

  it('抓捕：要在範圍內；被抓者收到通報並進入觀戰；全被抓則尋找者贏並回到大廳', async () => {
    const { code, host, all } = await startGame(3);
    const sk = seekerOf(all), hs = hidersOf(all);
    await inst(code, i => { const g = i.room.game; g.t = g.hideSecs + 0.1; const s = g.players.find((p: any) => p.role === 'seeker'); s.x = 200; s.y = 300; const h = g.players.filter((p: any) => p.role === 'hider'); h[0].x = 200 + RULES.catchRange + 30; h[0].y = 300; h[1].x = 205; h[1].y = 300; });
    sk.input(0, 0, true);// 抓最近的（h[1]），h[0] 太遠
    await until(() => sk.last('snap')?.c.length === 1);
    expect(sk.last('snap').c).toHaveLength(1);
    const caughtId = sk.last('snap').c[0];
    const victim = hs.find(h => h.id === caughtId)!;
    await until(() => victim.last('snap')?.c.includes(caughtId));
    // 被抓者再怎麼送移動，位置不會變
    const p0 = victim.last('snap').p.find((p: any) => p[0] === caughtId).slice(1, 3);
    for (let i = 0; i < 6; i++) victim.input(1, 0);
    await wait(300);
    expect(victim.last('snap').p.find((p: any) => p[0] === caughtId).slice(1, 3)).toEqual(p0);
    // 抓第二個
    await inst(code, i => { const g = i.room.game; const s = g.players.find((p: any) => p.role === 'seeker'); s.cooldown = 0; const h = g.players.find((p: any) => p.role === 'hider' && p.state === 'alive'); h.x = s.x + 10; h.y = s.y; });
    sk.input(0, 0, true);
    expect(await until(() => sk.find('over').length > 0)).toBe(true);
    expect(sk.last('over').winner).toBe('seeker');
    expect(sk.last('over').scores[sk.id]).toBeGreaterThan(0);
    await until(() => host.last('lobby')?.state === 'lobby');
    expect(await inst(code, i => i.room.state)).toBe('lobby');
    host.send({ t: 'start' });// 同一個房間可以再來一局
    expect(await until(() => host.find('game').length >= 2)).toBe(true);
  });

  it('時間到：還有人沒被抓＝躲藏者贏', async () => {
    const { code, all } = await startGame(2);
    await inst(code, i => { const g = i.room.game; g.t = g.totalSecs - 0.05; });
    const c = all[0];
    expect(await until(() => c.find('over').length > 0)).toBe(true);
    expect(c.last('over').winner).toBe('hiders');
  });

  it('斷線重連：用憑證認回座位並收到遊戲狀態', async () => {
    const { code, all } = await startGame(3);
    const h = hidersOf(all)[0], token = h.token, id = h.id;
    h.ws.close(1000); await until(() => h.closed !== null); await wait(100);
    const back = await Client.open(code, 'join', 'other-name', `&token=${token}`);
    expect(await back.got('welcome')).toBe(true);
    expect(back.id).toBe(id);
    expect(await back.got('game')).toBe(true);
    expect(back.role).toBe('hider');
    expect(await until(() => back.find('snap').length > 0)).toBe(true);
  });

  it('寬限逾時：躲藏者離開視為出局；尋找者離開整局作廢', async () => {
    const a = await startGame(3);
    const h = hidersOf(a.all)[0];
    h.ws.close(1000); await until(() => h.closed !== null); await wait(100);
    await inst(a.code, i => { const m = i.room.members.find((x: any) => x.id === (i.room.members.find((y: any) => y.lostAt !== null)).id); m.lostAt = Date.now() - 21_000; i.sweep(); });
    await until(() => seekerOf(a.all).last('snap')?.c.includes(h.id));
    expect(seekerOf(a.all).last('snap').c).toContain(h.id);

    const b = await startGame(3);
    const sk = seekerOf(b.all);
    sk.ws.close(1000); await until(() => sk.closed !== null); await wait(100);
    await inst(b.code, i => { const m = i.room.members.find((x: any) => x.lostAt !== null); m.lostAt = Date.now() - 21_000; i.sweep(); });
    const other = b.all.find(c => c !== sk)!;
    expect(await until(() => other.find('void').length > 0)).toBe(true);
    expect(other.last('void').reason).toBe('seeker-left');
    expect(await inst(b.code, i => i.room.state)).toBe('lobby');
  });

  it('房主離開後轉移房主；空房間逾時清掉，邀請碼可以重新使用', async () => {
    const { code, host, all } = await roomWith(3);
    host.ws.close(1000); await until(() => host.closed !== null); await wait(100);
    await inst(code, i => { const m = i.room.members.find((x: any) => x.lostAt !== null); m.lostAt = Date.now() - 21_000; i.sweep(); });
    const g = all[1]; await until(() => g.last('lobby')?.host === g.id);
    expect(g.last('lobby').host).toBe(g.id);
    for (const c of all.slice(1)) { c.ws.close(1000); }
    await wait(150);
    await inst(code, i => { i.room.emptySince = Date.now() - 61_000; i.sweep(); });
    expect(await inst(code, i => i.room)).toBeNull();
    const again = await Client.open(code, 'create', 'new', '&max=2');
    expect(await again.got('welcome')).toBe(true);
  });

  it('亂格式訊息不會弄壞房間；過大的訊息會被關閉；灌訊息會被限流', async () => {
    const { all } = await startGame(3);
    const bad = hidersOf(all)[0], good = hidersOf(all)[1];
    bad.ws.send('not json'); bad.ws.send('{"t":"in","seq":"x","dx":"NaN","dy":null}'); bad.ws.send('[]'); bad.ws.send('{"t":"in","seq":1,"dx":1e9,"dy":-1e9}');
    bad.ws.send(new Uint8Array([1, 2, 3]));
    await wait(200);
    expect(bad.closed).toBeNull();
    const n = good.find('snap').length; await wait(300);
    expect(good.find('snap').length).toBeGreaterThan(n);// 其他人不受影響
    const big = seekerOf(all); big.ws.send('x'.repeat(2000));
    expect(await until(() => big.closed !== null)).toBe(true);
    expect(big.closed).toBe(4413);
    for (let i = 0; i < 700; i++) good.ws.send('{"t":"ping"}');
    expect(await until(() => good.closed !== null)).toBe(true);
    expect(good.closed).toBe(4429);
  });
});

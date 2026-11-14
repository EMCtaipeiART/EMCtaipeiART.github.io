import { SELF } from 'cloudflare:test';
import { describe, expect, it } from 'vitest';

async function open(room: string, role: 'host' | 'guest') {
  const res = await SELF.fetch(`https://example.com/duel?room=${room}&role=${role}`, { headers: { Upgrade: 'websocket' } });
  const ws = res.webSocket!;
  ws.accept();
  const inbox: string[] = [];
  let closed: number | null = null;
  ws.addEventListener('message', e => inbox.push(String(e.data)));
  ws.addEventListener('close', e => { closed = e.code; });
  return { ws, inbox, closed: () => closed };
}
const wait = (ms = 50) => new Promise(r => setTimeout(r, ms));
// 整套測試一起跑（機器忙）時，固定等 50ms 不夠訊息送到：改成輪詢到條件成立（最多 3 秒），不成立才讓 expect 報錯
async function until(cond: () => boolean, ms = 3000) {
  const end = Date.now() + ms;
  while (!cond() && Date.now() < end) await wait(10);
}
const has = (inbox: string[], t: string, i?: number) => inbox.some(s => { const m = JSON.parse(s); return m.t === t && (i === undefined || m.i === i); });

describe('DuelRoom relay (up to 4 players)', () => {
  it('rejects a missing room, relays with sender ids, fills at 4 players', async () => {
    const guestEarly = await open('AAAAAA', 'guest');
    await until(() => guestEarly.closed() !== null);
    expect(guestEarly.closed()).toBe(4404);

    const host = await open('BBBBBB', 'host');
    await until(() => host.inbox.length > 0);
    expect(host.inbox).toContain(JSON.stringify({ t: 'hosted' }));
    const g1 = await open('BBBBBB', 'guest');
    await until(() => g1.inbox.length > 0 && host.inbox.length > 1);
    expect(has(host.inbox, 'ready', 1)).toBe(true);
    expect(JSON.parse(g1.inbox[0])).toEqual({ t: 'ready', i: 1, ids: [0] });

    const g2 = await open('BBBBBB', 'guest');
    await until(() => g2.inbox.length > 0 && has(g1.inbox, 'join', 2));
    expect(JSON.parse(g2.inbox[0])).toEqual({ t: 'ready', i: 2, ids: [0, 1] });
    expect(has(host.inbox, 'ready', 2)).toBe(true);
    expect(has(g1.inbox, 'join', 2)).toBe(true);
    const g3 = await open('BBBBBB', 'guest');
    await until(() => g3.inbox.length > 0);
    expect(JSON.parse(g3.inbox[0]).i).toBe(3);

    // 第五人：已滿
    const g4 = await open('BBBBBB', 'guest');
    await until(() => g4.closed() !== null);
    expect(g4.closed()).toBe(4409);

    // 廣播帶寄件者 i；帶 to 的只送給那一位
    g1.ws.send(JSON.stringify({ t: 'hello', n: 'g1' }));
    await until(() => has(host.inbox, 'hello', 1) && has(g2.inbox, 'hello', 1) && has(g3.inbox, 'hello', 1));
    expect(has(host.inbox, 'hello', 1) && has(g2.inbox, 'hello', 1) && has(g3.inbox, 'hello', 1)).toBe(true);
    expect(has(g1.inbox, 'hello')).toBe(false);
    host.ws.send(JSON.stringify({ t: 'h', to: 2, d: 5 }));
    await until(() => has(g2.inbox, 'h', 0));
    expect(has(g2.inbox, 'h', 0)).toBe(true);
    await wait(80);
    expect(has(g1.inbox, 'h')).toBe(false);
    expect(has(g3.inbox, 'h')).toBe(false);

    g2.ws.close(1000);
    await until(() => has(host.inbox, 'gone', 2) && has(g1.inbox, 'gone', 2));
    expect(has(host.inbox, 'gone', 2)).toBe(true);
    expect(has(g3.inbox, 'gone', 2)).toBe(true);
  });

  it('locks the room once the host starts', async () => {
    const host = await open('CCCCCC', 'host');
    await until(() => host.inbox.length > 0);
    const g1 = await open('CCCCCC', 'guest');
    await until(() => g1.inbox.length > 0);
    host.ws.send(JSON.stringify({ t: 'st', ids: [0, 1] }));
    await until(() => has(g1.inbox, 'st', 0));
    const late = await open('CCCCCC', 'guest');
    await until(() => late.closed() !== null);
    expect(late.closed()).toBe(4409);
  });

  it('rejects a bad room code', async () => {
    const res = await SELF.fetch('https://example.com/duel?room=bad&role=host', { headers: { Upgrade: 'websocket' } });
    expect(res.status).toBe(400);
  });
});

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

describe('DuelRoom relay', () => {
  it('relays between host and guest, rejects missing room and third player', async () => {
    const guestEarly = await open('AAAAAA', 'guest');
    await wait();
    expect(guestEarly.closed()).toBe(4404);

    const host = await open('BBBBBB', 'host');
    await wait();
    expect(host.inbox).toContain(JSON.stringify({ t: 'hosted' }));
    const guest = await open('BBBBBB', 'guest');
    await wait();
    expect(host.inbox).toContain(JSON.stringify({ t: 'ready' }));
    expect(guest.inbox).toContain(JSON.stringify({ t: 'ready' }));

    guest.ws.send(JSON.stringify({ t: 'hello', name: 'g' }));
    host.ws.send(JSON.stringify({ t: 'hello', name: 'h' }));
    await wait();
    expect(host.inbox).toContain(JSON.stringify({ t: 'hello', name: 'g' }));
    expect(guest.inbox).toContain(JSON.stringify({ t: 'hello', name: 'h' }));

    const third = await open('BBBBBB', 'guest');
    await wait();
    expect(third.closed()).toBe(4409);

    guest.ws.close(1000);
    await wait();
    expect(host.inbox).toContain(JSON.stringify({ t: 'gone' }));
  });

  it('rejects a bad room code', async () => {
    const res = await SELF.fetch('https://example.com/duel?room=bad&role=host', { headers: { Upgrade: 'websocket' } });
    expect(res.status).toBe(400);
  });
});

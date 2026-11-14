import { DurableObject } from 'cloudflare:workers';

/**
 * 辦公室對決連線對戰的中繼房間（一個房間碼 = 一個房間，最多 4 人：房主 id 0、訪客 id 1～3）。
 * 不用 WebRTC 直連（公司網路／NAT 常連不上），所有人都連到這裡，由房間把訊息轉給其他人。
 * 轉發時會在每則訊息加上寄件者 `i`；訊息帶 `to`（數字）時只送給那一位。
 * 房主送出 `{t:'st'}`（開始對戰）後房間鎖住，不再收新訪客。
 * 只存在於記憶體（WebSocket hibernation），除了「已開打」旗標外不寫任何資料。
 * 關閉碼：4404 找不到房間（房主不在）、4409 房間已滿／已開打／房間碼被使用、4413 訊息太大。
 */
const MAX_GUESTS = 3;

export class DuelRoom extends DurableObject<Env> {
  private idOf(ws: WebSocket): number {
    const t = this.ctx.getTags(ws).find(x => x.startsWith('id:'));
    return t ? Number(t.slice(3)) : -1;
  }

  private send(ws: WebSocket | undefined, msg: string): void {
    if (ws) { try { ws.send(msg); } catch { /* 對方已失效 */ } }
  }

  async fetch(request: Request): Promise<Response> {
    if (request.headers.get('Upgrade')?.toLowerCase() !== 'websocket') return new Response('Expected WebSocket', { status: 426 });
    const role = new URL(request.url).searchParams.get('role') === 'host' ? 'host' : 'guest';
    const pair = new WebSocketPair();
    const [client, server] = [pair[0], pair[1]];
    const sockets = this.ctx.getWebSockets();
    const host = sockets.find(s => this.ctx.getTags(s).includes('host'));
    if (role === 'host') {
      if (host) { this.ctx.acceptWebSocket(server, ['reject']); server.close(4409, 'taken'); }
      else {
        await this.ctx.storage.delete('started');
        this.ctx.acceptWebSocket(server, ['host', 'id:0']);
        this.send(server, JSON.stringify({ t: 'hosted' }));
      }
    } else if (!host) {
      this.ctx.acceptWebSocket(server, ['reject']); server.close(4404, 'no-room');
    } else {
      const used = sockets.filter(s => this.ctx.getTags(s).includes('guest')).map(s => this.idOf(s));
      let id = 0;
      for (let k = 1; k <= MAX_GUESTS; k++) if (!used.includes(k)) { id = k; break; }
      if (!id || (await this.ctx.storage.get('started'))) { this.ctx.acceptWebSocket(server, ['reject']); server.close(4409, id ? 'started' : 'full'); }
      else {
        this.ctx.acceptWebSocket(server, ['guest', 'id:' + id]);
        this.send(server, JSON.stringify({ t: 'ready', i: id, ids: [0, ...used.filter(x => x > 0)] }));
        this.send(host, JSON.stringify({ t: 'ready', i: id }));
        for (const s of sockets) if (s !== host && this.ctx.getTags(s).includes('guest')) this.send(s, JSON.stringify({ t: 'join', i: id }));
      }
    }
    return new Response(null, { status: 101, webSocket: client });
  }

  async webSocketMessage(ws: WebSocket, message: string | ArrayBuffer): Promise<void> {
    if (typeof message !== 'string') return;
    if (message.length > 4096) { try { ws.close(4413, 'too-large'); } catch { /* 已關閉 */ } return; }
    const id = this.idOf(ws);
    if (id < 0) return;
    let m: Record<string, unknown>;
    try { m = JSON.parse(message); } catch { return; }
    if (!m || typeof m !== 'object') return;
    if (m.t === 'st' && id === 0) await this.ctx.storage.put('started', true);
    m.i = id;
    const out = JSON.stringify(m);
    const to = typeof m.to === 'number' ? m.to : -1;
    for (const s of this.ctx.getWebSockets()) {
      if (s === ws) continue;
      const sid = this.idOf(s);
      if (sid < 0 || (to >= 0 && sid !== to)) continue;
      this.send(s, out);
    }
  }

  private left(ws: WebSocket): void {
    const id = this.idOf(ws);
    if (id < 0) return;
    const msg = JSON.stringify({ t: 'gone', i: id });
    for (const s of this.ctx.getWebSockets()) if (s !== ws && this.idOf(s) >= 0) this.send(s, msg);
  }

  webSocketClose(ws: WebSocket, code: number): void {
    this.left(ws);
    try { ws.close(code >= 1000 && code < 5000 && code !== 1005 && code !== 1006 ? code : 1000); } catch { /* 已關閉 */ }
  }

  webSocketError(ws: WebSocket): void {
    this.left(ws);
    try { ws.close(1011); } catch { /* 已關閉 */ }
  }
}

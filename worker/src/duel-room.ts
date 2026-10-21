import { DurableObject } from 'cloudflare:workers';

/**
 * 出氣擂台一對一對戰的中繼房間（一個戰場序號 = 一個房間）。
 * 不用 WebRTC 直連（公司網路／NAT 常連不上），雙方都連到這裡，由房間把訊息轉給另一邊。
 * 只存在於記憶體（WebSocket hibernation），不寫任何資料。
 * 關閉碼：4404 找不到戰場（房主不在）、4409 戰場已滿或序號已被使用、4413 訊息太大。
 */
export class DuelRoom extends DurableObject<Env> {
  async fetch(request: Request): Promise<Response> {
    if (request.headers.get('Upgrade')?.toLowerCase() !== 'websocket') return new Response('Expected WebSocket', { status: 426 });
    const role = new URL(request.url).searchParams.get('role') === 'host' ? 'host' : 'guest';
    const pair = new WebSocketPair();
    const [client, server] = [pair[0], pair[1]];
    const sockets = this.ctx.getWebSockets();
    const host = sockets.find(s => this.ctx.getTags(s).includes('host'));
    const guest = sockets.find(s => this.ctx.getTags(s).includes('guest'));
    this.ctx.acceptWebSocket(server, [role]);
    if (role === 'host' && host) server.close(4409, 'taken');
    else if (role === 'guest' && !host) server.close(4404, 'no-room');
    else if (role === 'guest' && guest) server.close(4409, 'full');
    else if (role === 'guest' && host) {
      const ready = JSON.stringify({ t: 'ready' });
      try { server.send(ready); } catch { /* 剛連上就斷了 */ }
      try { host.send(ready); } catch { /* 房主已斷線 */ }
    } else {
      try { server.send(JSON.stringify({ t: 'hosted' })); } catch { /* 剛連上就斷了 */ }
    }
    return new Response(null, { status: 101, webSocket: client });
  }

  private other(ws: WebSocket): WebSocket | undefined {
    const mine = this.ctx.getTags(ws);
    const want = mine.includes('host') ? 'guest' : 'host';
    return this.ctx.getWebSockets().find(s => s !== ws && this.ctx.getTags(s).includes(want));
  }

  webSocketMessage(ws: WebSocket, message: string | ArrayBuffer): void {
    if (typeof message !== 'string') return;
    if (message.length > 4096) { try { ws.close(4413, 'too-large'); } catch { /* 已關閉 */ } return; }
    const peer = this.other(ws);
    if (peer) { try { peer.send(message); } catch { /* 對方已失效 */ } }
  }

  webSocketClose(ws: WebSocket, code: number): void {
    const peer = this.other(ws);
    try { ws.close(code >= 1000 && code < 5000 && code !== 1005 && code !== 1006 ? code : 1000); } catch { /* 已關閉 */ }
    if (peer) { try { peer.send(JSON.stringify({ t: 'gone' })); } catch { /* 對方已失效 */ } }
  }

  webSocketError(ws: WebSocket): void {
    const peer = this.other(ws);
    try { ws.close(1011); } catch { /* 已關閉 */ }
    if (peer) { try { peer.send(JSON.stringify({ t: 'gone' })); } catch { /* 對方已失效 */ } }
  }
}

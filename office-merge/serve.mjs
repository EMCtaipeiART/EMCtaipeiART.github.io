// 本機預覽：node office-merge/serve.mjs → http://127.0.0.1:4190/office-merge/
// 服務整個 repo（人物圖要讀 pixel-plaza/），並附一個假後端，測排行榜與能量不會動到線上資料：
//   http://127.0.0.1:4190/office-merge/?me=Machi&api=/mockapi
// 要測雲端存檔與兌換能量，先在主控台設定假的登入：
//   localStorage.setItem('pixelViewerHandoff', JSON.stringify({ name: 'Machi', token: 'test', at: Date.now() }))
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const types = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.png': 'image/png', '.jpg': 'image/jpeg', '.webp': 'image/webp', '.svg': 'image/svg+xml', '.mp3': 'audio/mpeg', '.m4a': 'audio/mp4', '.json': 'application/json' };

/* 假後端（重開就清空） */
const ranks = { Anna: { done: 60, xp: 1700, level: 14, progress: 1 }, 余采馨: { done: 8, xp: 200, level: 4, progress: 0 } };
const wallet = { pending: 3, balance: 40, claims: {}, bought: new Set() };
const cloudSave = { rev: 0, state: null };
function mock(p) {
  if (p.action === 'officeMergeSave') {
    if (p.op === 'load') return { ok: true, name: 'Machi', ...cloudSave };
    if (p.baseRev !== cloudSave.rev) return { ok: true, name: 'Machi', conflict: true, ...cloudSave };
    cloudSave.rev++; cloudSave.state = p.state;
    return { ok: true, name: 'Machi', rev: cloudSave.rev };
  }
  if (p.action === 'officeMergeRank') {
    if (p.op === 'save') ranks[p.name] = { done: p.done, xp: p.xp, level: p.level, progress: p.progress };
    return { ok: true, ranks };
  }
  if (p.action === 'officeMergeEnergy') {
    let claimed = 0;
    if (p.op === 'claim') { if (!(p.claimId in wallet.claims)) { wallet.claims[p.claimId] = wallet.pending; wallet.pending = 0; } claimed = wallet.claims[p.claimId]; }
    if (p.op === 'buy' && p.item === 'cool') {
      if (!wallet.bought.has(p.requestId)) { if (wallet.balance < 5) return { ok: false, error: '平台幣不足' }; wallet.bought.add(p.requestId); wallet.balance -= 5; }
    } else if (p.op === 'buy' && !wallet.bought.has(p.requestId)) {
      if (wallet.balance < 15) return { ok: false, error: '平台幣不足' };
      wallet.bought.add(p.requestId); wallet.balance -= 15; wallet.pending += 100;
    }
    return { ok: true, name: 'Machi', claimed, pending: wallet.pending, wallet: true, balance: wallet.balance, price: 15, amount: 100, coolPrice: 5 };
  }
  return { ok: false, error: 'Unknown action' };
}

http.createServer((req, res) => {
  try {
    const url = new URL(req.url, 'http://localhost');
    if (url.pathname === '/mockapi') {
      let body = '';
      req.on('data', c => { body += c; });
      req.on('end', () => {
        let reply;
        try { reply = mock(JSON.parse(body || '{}')); } catch { reply = { ok: false, error: '格式錯誤' }; }
        res.writeHead(200, { 'Content-Type': 'application/json' }).end(JSON.stringify(reply));
      });
      return;
    }
    if (url.pathname === '/') { res.writeHead(302, { Location: '/office-merge/' }).end(); return; }
    let file = path.resolve(root, '.' + decodeURIComponent(url.pathname));
    if (file !== root && !file.startsWith(root + path.sep)) { res.writeHead(403).end(); return; }
    if (fs.statSync(file).isDirectory()) file = path.join(file, 'index.html');
    res.writeHead(200, { 'Content-Type': types[path.extname(file)] || 'application/octet-stream', 'Cache-Control': 'no-store' });
    fs.createReadStream(file).on('error', () => res.end()).pipe(res);
  } catch { res.writeHead(404).end('Not found'); }
}).listen(4190, '127.0.0.1', () => console.log('http://127.0.0.1:4190/office-merge/'));

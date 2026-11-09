import { buildCatalog } from './catalog.js';
import { fillForms } from './xlsx.js';
import { orderMail, SYSTEM_NOTE } from './mail.js';
import { D1Files } from './store.js';

const json = (o, status = 200, h = {}) => new Response(JSON.stringify(o), { status, headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store', ...h } });
const err = (msg, status = 400) => json({ error: msg }, status);
const now = () => new Date().toISOString();
const rid = (n = 16) => { const b = crypto.getRandomValues(new Uint8Array(n)); return [...b].map((x) => x.toString(16).padStart(2, '0')).join(''); };
const DEFAULTS = { shopName: '隱形眼鏡團購', deadline: '', closed: false, bankName: '', bankAccount: '', accountName: '', notes: '', siteUrl: '' };
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

let chatReady = false;
async function ensureChat(env) {
  if (chatReady) return;
  await env.DB.batch([
    env.DB.prepare('CREATE TABLE IF NOT EXISTS chat (id INTEGER PRIMARY KEY AUTOINCREMENT, campaign TEXT NOT NULL, name TEXT NOT NULL, text TEXT NOT NULL DEFAULT \'\', img TEXT NOT NULL DEFAULT \'\', at TEXT NOT NULL)'),
    env.DB.prepare('CREATE INDEX IF NOT EXISTS chat_c ON chat(campaign,id)'),
    env.DB.prepare('CREATE TABLE IF NOT EXISTS chat_presence (campaign TEXT NOT NULL, sid TEXT NOT NULL, name TEXT, seen INTEGER NOT NULL, PRIMARY KEY (campaign,sid))'),
  ]);
  for (const c of ['sid TEXT', 'up INTEGER NOT NULL DEFAULT 0', 'del INTEGER NOT NULL DEFAULT 0', 'ed INTEGER NOT NULL DEFAULT 0']) { try { await env.DB.prepare('ALTER TABLE chat ADD COLUMN ' + c).run(); } catch { /* 已存在 */ } }
  chatReady = true;
}
async function getKV(env, k, d = null) { const r = await env.DB.prepare('SELECT v FROM kv WHERE k=?').bind(k).first(); return r ? JSON.parse(r.v) : d; }
async function setKV(env, k, v) { await env.DB.prepare('INSERT INTO kv(k,v) VALUES(?,?) ON CONFLICT(k) DO UPDATE SET v=excluded.v').bind(k, JSON.stringify(v)).run(); }
// 多團購：預設團購 'lens' 沿用舊資料的 key（不需搬遷），其他團購的 key 加上 <id>: / <id>/ 前綴
const DEFAULT_CID = 'lens';
const kk = (cid, k) => (cid === DEFAULT_CID ? k : cid + ':' + k);
const fk = (cid, k) => (cid === DEFAULT_CID ? k : cid + '/' + k);
const getSettings = async (env, cid = DEFAULT_CID) => ({ ...DEFAULTS, ...(await getKV(env, kk(cid, 'settings'), {})) });
async function getCatalog(env, cid = DEFAULT_CID) { const o = await env.FILES.get(fk(cid, 'catalog.json')); return o ? JSON.parse(await o.text()) : null; }
async function getCamps(env) { const c = await getKV(env, 'campaigns', null); return c && c.length ? c : [{ id: DEFAULT_CID, status: 'open', createdAt: '' }]; }
const isEnded = (camps, cid) => (camps.find((c) => c.id === cid) || {}).status === 'ended';
const CID_RE = /^[a-z0-9-]{1,20}$/;

// 截止時間以台北時間解讀（YYYY-MM-DDTHH:mm）
const deadlineMs = (s) => (s.deadline ? Date.parse(s.deadline + (s.deadline.length <= 16 ? ':00+08:00' : '')) : NaN);
const isClosed = (s) => s.closed || (!isNaN(deadlineMs(s)) && Date.now() > deadlineMs(s));

// ── 管理者簽章 ──
async function hmac(env, data) {
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode((env.SESSION_SECRET || env.ADMIN_PASSWORD || '') + '|lens'), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const sig = new Uint8Array(await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(data)));
  return btoa(String.fromCharCode(...sig)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}
async function isAdmin(req, env) {
  if (!env.ADMIN_PASSWORD) return false;
  const t = (req.headers.get('authorization') || '').replace(/^Bearer /, '');
  const [exp, sig] = t.split('.'); if (!exp || !sig || +exp < Date.now()) return false;
  return (await hmac(env, exp)) === sig;
}

// ── 訂單驗證 ──
function cleanLines(raw, catalog) {
  if (!Array.isArray(raw) || !raw.length) throw new Error('購物車是空的');
  if (raw.length > 60) throw new Error('品項過多（上限 60 筆）');
  const byNo = new Map(catalog.items.map((i) => [i.no, i]));
  const t = (v, n = 20) => String(v ?? '').trim().slice(0, n);
  return raw.map((l, idx) => {
    const it = byNo.get(Number(l.no));
    if (!it) throw new Error(`第 ${idx + 1} 筆：找不到商品編號 ${l.no}`);
    const qty = Number(l.qty);
    if (!Number.isInteger(qty) || qty < 1 || qty > 99) throw new Error(`第 ${idx + 1} 筆（${it.name}）：數量需為 1–99`);
    const sph = t(l.sph), cyl = t(l.cyl), axis = t(l.axis);
    if (it.power && !sph) throw new Error(`第 ${idx + 1} 筆（${it.name}）：請填寫度數（0 度請填 0）`);
    if (it.toric && (cyl || axis) && !(cyl && axis)) throw new Error(`第 ${idx + 1} 筆（${it.name}）：散光度數與角度需一併填寫`);
    return { no: it.no, brand: it.brand, name: it.name, price: it.price, qty, sph, cyl, axis, gift: t(l.gift, 40) };
  });
}
const totalOf = (lines) => lines.reduce((s, l) => s + l.price * l.qty, 0);
const pubOrder = (o) => ({ campaign: o.campaign || DEFAULT_CID, id: o.id, name: o.name, email: o.email, items: JSON.parse(o.items), total: o.total, note: o.note, status: o.status, createdAt: o.created_at, updatedAt: o.updated_at, pay: o.pay_at ? { last5: o.pay_last5 || '', at: o.pay_at, hasImg: !!o.pay_img } : null });

function parseFrom(f) { const m = /^(.*?)\s*<([^>]+)>\s*$/.exec(f || ''); return m ? { name: m[1].trim().replace(/^"|"$/g, ''), email: m[2] } : { name: '', email: (f || '').trim() }; }
async function sendMail(env, to, subject, html, text) {
  try {
    if (env.BREVO_API_KEY) {
      const from = parseFrom(env.MAIL_FROM);
      const r = await fetch('https://api.brevo.com/v3/smtp/email', {
        method: 'POST', headers: { 'api-key': env.BREVO_API_KEY, 'content-type': 'application/json', accept: 'application/json' },
        body: JSON.stringify({ sender: from.name ? from : { email: from.email }, replyTo: { email: env.REPLY_TO || from.email }, to: [{ email: to }], subject, htmlContent: html, textContent: text }),
      });
      if (!r.ok) { console.log('brevo error', r.status, await r.text()); return 'failed'; }
      return 'sent';
    }
    if (env.RESEND_API_KEY) {
      const r = await fetch('https://api.resend.com/emails', {
        method: 'POST', headers: { authorization: 'Bearer ' + env.RESEND_API_KEY, 'content-type': 'application/json' },
        body: JSON.stringify({ from: env.MAIL_FROM, to: [to], subject, html, text }),
      });
      if (!r.ok) { console.log('mail error', r.status, await r.text()); return 'failed'; }
      return 'sent';
    }
    console.log('[mail skipped: no mail key]', to, subject); return 'skipped';
  } catch (e) { console.log('mail exception', String(e)); return 'failed'; }
}
async function mailOrder(env, req, order, kind) {
  const s = await getSettings(env, order.campaign || DEFAULT_CID);
  const base = s.siteUrl || env.SITE_URL || new URL(req.url).origin;
  const m = orderMail({ order: pubOrder(order), settings: s, link: `${base}/order/${order.token}`, kind });
  return sendMail(env, order.email, m.subject, m.html, m.text);
}

async function handle(req, env) {
  env = { ...env, FILES: new D1Files(env.DB) };
  const url = new URL(req.url); const path = url.pathname; const method = req.method;
  const cid = url.searchParams.get('c') || DEFAULT_CID;
  if (!CID_RE.test(cid)) return err('團購代號不正確');
  const camps = await getCamps(env);
  if (!camps.some((c) => c.id === cid)) return err('找不到這個團購', 404);
  const closedNow = (s, c = cid) => isClosed(s) || isEnded(camps, c);

  if (path === '/api/campaigns' && method === 'GET') {
    const list = await Promise.all(camps.map(async (c) => { const s = await getSettings(env, c.id); const cat = await getCatalog(env, c.id);
      return { id: c.id, name: s.shopName, deadline: s.deadline, ended: isEnded(camps, c.id), closed: closedNow(s, c.id), ready: !!cat }; }));
    return json({ campaigns: list }, 200, { 'cache-control': 'public, max-age=15' });
  }

  if (path === '/api/catalog' && method === 'GET') {
    const [cat, s, pimgs] = await Promise.all([getCatalog(env, cid), getSettings(env, cid), getKV(env, kk(cid, 'pimgs'), {})]);
    return json({ catalog: cat, pimgs, settings: { shopName: s.shopName, deadline: s.deadline, closed: closedNow(s), bankName: s.bankName, bankAccount: s.bankAccount, accountName: s.accountName, notes: s.notes } },
      200, { 'cache-control': 'public, max-age=30' });
  }
  if (path.startsWith('/api/img/') && method === 'GET') {
    const o = await env.FILES.get('img/' + decodeURIComponent(path.slice(9)).replace(/[^\w.\-]/g, ''));
    if (!o) return new Response('not found', { status: 404 });
    return new Response(o.body, { headers: { 'content-type': o.httpMetadata?.contentType || 'image/jpeg', 'cache-control': 'public, max-age=86400' } });
  }

  // 公開訂單列表（不含 Email 與修改連結）
  if (path === '/api/orders-public' && method === 'GET') {
    const rs = await env.DB.prepare("SELECT * FROM orders WHERE status='active' AND campaign=? ORDER BY created_at DESC").bind(cid).all();
    const orders = rs.results.map((o) => { const p = pubOrder(o); return { id: p.id, name: p.name, items: p.items.map((l) => ({ no: l.no, brand: l.brand, name: l.name, price: l.price, qty: l.qty, sph: l.sph, cyl: l.cyl, axis: l.axis, gift: l.gift })), total: p.total, updatedAt: p.updatedAt, paid: !!p.pay }; });
    return json({ orders, count: orders.length, sum: orders.reduce((x, o) => x + o.total, 0) });
  }
  // 即時聊天室（表 chat、chat_presence；第一次使用時自動建立，不動既有資料）
  if (path.startsWith('/api/chat')) {
    await ensureChat(env);
    const nowMs = Date.now();
    const online = async () => (await env.DB.prepare('SELECT COUNT(*) c FROM chat_presence WHERE campaign=? AND seen>?').bind(cid, nowMs - 45000).first()).c;
    const touch = (sid, name) => sid ? env.DB.prepare('INSERT INTO chat_presence(campaign,sid,name,seen) VALUES(?,?,?,?) ON CONFLICT(campaign,sid) DO UPDATE SET name=excluded.name,seen=excluded.seen').bind(cid, String(sid).slice(0, 40), String(name || '').slice(0, 20), nowMs).run() : null;
    if (path === '/api/chat' && method === 'GET') {
      const u = url.searchParams.get('u'), sid = url.searchParams.get('sid') || '';
      const cols = 'id,name n,text t,img,at,ed,del,up,(sid=?) m';
      const rs = u == null
        ? await env.DB.prepare('SELECT ' + cols + ' FROM (SELECT * FROM chat WHERE campaign=? AND del=0 ORDER BY id DESC LIMIT 150) ORDER BY id').bind(sid, cid).all()
        : await env.DB.prepare('SELECT ' + cols + ' FROM chat WHERE campaign=? AND up>? ORDER BY id LIMIT 300').bind(sid, cid, parseInt(u, 10) || 0).all();
      return json({ msgs: rs.results.map((r) => ({ ...r, m: !!r.m })), online: await online(), now: nowMs }, 200, { 'cache-control': 'no-store' });
    }
    if (path === '/api/chat/ping' && method === 'POST') {
      const b = await req.json().catch(() => ({})); await touch(b.sid, b.name);
      if (Math.random() < 0.02) await env.DB.prepare('DELETE FROM chat_presence WHERE seen<?').bind(nowMs - 864e5).run();
      return json({ online: await online() }, 200, { 'cache-control': 'no-store' });
    }
    if (path === '/api/chat/image' && method === 'POST') {
      const ct = req.headers.get('content-type') || ''; const bytes = new Uint8Array(await req.arrayBuffer());
      if (!/^image\/(jpeg|png|webp|gif)$/.test(ct) || !bytes.length || bytes.length > 900000) return err('圖片格式或大小不正確（上限 900KB）');
      const key = 'chat_' + rid(10); await env.FILES.put('img/' + key, bytes, { httpMetadata: { contentType: ct } });
      return json({ img: '/api/img/' + key });
    }
    if (path === '/api/chat' && method === 'POST') {
      const b = await req.json().catch(() => null); if (!b) return err('資料格式錯誤');
      const name = String(b.name || '').trim().slice(0, 20), text = String(b.text || '').trim().slice(0, 500);
      const img = /^\/api\/img\/chat_[\w]+$/.test(b.img || '') ? b.img : '';
      if (!name) return err('請先設定暱稱'); if (!text && !img) return err('請輸入內容');
      const r = await env.DB.prepare('INSERT INTO chat(campaign,name,text,img,at,sid,up) VALUES(?,?,?,?,?,?,?)').bind(cid, name, text, img, now(), String(b.sid || '').slice(0, 40), nowMs).run();
      await touch(b.sid, name); return json({ ok: true, id: r.meta.last_row_id });
    }
    if ((path === '/api/chat/delete' || path === '/api/chat/edit') && method === 'POST') {
      const b = await req.json().catch(() => ({})); const id = parseInt(url.searchParams.get('id') || '0', 10);
      const row = await env.DB.prepare('SELECT sid FROM chat WHERE campaign=? AND id=? AND del=0').bind(cid, id).first(); if (!row) return err('找不到這則訊息', 404);
      const own = row.sid && row.sid === String(b.sid || '');
      if (!own && !(await isAdmin(req, env))) return err('只能修改自己的訊息', 403);
      if (path.endsWith('delete')) await env.DB.prepare('UPDATE chat SET del=1,text=\'\',img=\'\',up=? WHERE id=?').bind(nowMs, id).run();
      else { const text = String(b.text || '').trim().slice(0, 500); if (!text) return err('請輸入內容'); await env.DB.prepare('UPDATE chat SET text=?,ed=1,up=? WHERE id=? AND img=\'\'').bind(text, nowMs, id).run(); }
      return json({ ok: true });
    }
    return err('找不到', 404);
  }
  // 商品評論（kv：<團購>:reviews = { 編號: [{n,s,t,at}] }）
  if (path === '/api/reviews' && method === 'GET') return json(await getKV(env, kk(cid, 'reviews'), {}));
  if (path === '/api/reviews' && method === 'POST') {
    const b = await req.json().catch(() => null); if (!b) return err('資料格式錯誤');
    const no = String(parseInt(b.no, 10) || ''); const name = String(b.name || '').trim().slice(0, 20);
    const stars = Math.round(Number(b.stars)); const text = String(b.text || '').trim().slice(0, 120);
    if (!no || !name) return err('請填寫姓名'); if (!(stars >= 1 && stars <= 5)) return err('請選擇星級');
    const cat = await getCatalog(env, cid); if (!cat || !cat.items.some((i) => String(i.no) === no)) return err('找不到商品', 404);
    const all = await getKV(env, kk(cid, 'reviews'), {});
    const list = (all[no] || []).filter((r) => r.n !== name);
    list.push({ n: name, s: stars, t: text, at: now() });
    all[no] = list.slice(-60); await setKV(env, kk(cid, 'reviews'), all);
    return json(all);
  }
  // 同事：建立訂單
  if (path === '/api/orders' && method === 'POST') {
    const b = await req.json().catch(() => null); if (!b) return err('資料格式錯誤');
    const s = await getSettings(env, cid); if (closedNow(s)) return err('已截止，無法再下單', 403);
    const name = String(b.name || '').trim().slice(0, 30), email = String(b.email || '').trim().toLowerCase().slice(0, 120);
    if (!name) return err('請填寫姓名'); if (!EMAIL_RE.test(email)) return err('Email 格式不正確');
    const cat = await getCatalog(env, cid); if (!cat) return err('目前尚未開放下單', 503);
    let lines; try { lines = cleanLines(b.items, cat); } catch (e) { return err(e.message); }
    const o = { id: rid(4).toUpperCase(), token: rid(16), name, email, items: JSON.stringify(lines), total: totalOf(lines), note: String(b.note || '').slice(0, 200), status: 'active', created_at: now(), updated_at: now(), campaign: cid };
    await env.DB.prepare('INSERT INTO orders(id,token,name,email,items,total,note,status,created_at,updated_at,campaign) VALUES(?,?,?,?,?,?,?,?,?,?,?)')
      .bind(o.id, o.token, o.name, o.email, o.items, o.total, o.note, o.status, o.created_at, o.updated_at, o.campaign).run();
    const mail = await mailOrder(env, req, o, 'new');
    return json({ order: pubOrder(o), token: o.token, mail });
  }
  let m;
  if ((m = path.match(/^\/api\/orders\/([0-9a-f]{32})\/payment$/)) && method === 'POST') {
    const o = await env.DB.prepare('SELECT * FROM orders WHERE token=?').bind(m[1]).first();
    if (!o) return err('找不到訂單', 404);
    if (o.status !== 'active') return err('此訂單已取消', 403);
    const ct = req.headers.get('content-type') || '';
    let last5 = o.pay_last5, img = o.pay_img;
    if (ct.includes('json')) {
      const b = await req.json().catch(() => ({})); const v = String(b.last5 || '').trim();
      if (v && !/^\d{5}$/.test(v)) return err('後五碼需為 5 位數字');
      if (v) last5 = v;
    } else {
      const bytes = new Uint8Array(await req.arrayBuffer());
      if (!/^image\/(jpeg|png|webp)$/.test(ct) || !bytes.length || bytes.length > 1.5e6) return err('截圖格式或大小不正確（上限 1.5MB）');
      const key = 'p_' + o.id + '_' + Date.now().toString(36);
      await new D1Files(env.DB).put('pay/' + key, bytes, { httpMetadata: { contentType: ct } });
      img = key;
    }
    if (!last5 && !img) return err('請填寫匯款帳號後五碼，或上傳匯款截圖');
    await env.DB.prepare('UPDATE orders SET pay_last5=?, pay_img=?, pay_at=COALESCE(pay_at, ?), updated_at=updated_at WHERE id=?').bind(last5 || null, img || null, now(), o.id).run();
    const n = await env.DB.prepare('SELECT * FROM orders WHERE id=?').bind(o.id).first();
    return json({ order: pubOrder(n) });
  }
  if ((m = path.match(/^\/api\/orders\/([0-9a-f]{32})$/))) {
    const o = await env.DB.prepare('SELECT * FROM orders WHERE token=?').bind(m[1]).first();
    if (!o) return err('找不到訂單', 404);
    const oc = o.campaign || DEFAULT_CID; const s = await getSettings(env, oc);
    if (method === 'GET') return json({ order: pubOrder(o), closed: closedNow(s, oc) });
    if (closedNow(s, oc)) return err('已截止，無法再修改', 403);
    if (method === 'PUT') {
      const b = await req.json().catch(() => null); if (!b) return err('資料格式錯誤');
      const cat = await getCatalog(env, oc); let lines; try { lines = cleanLines(b.items, cat); } catch (e) { return err(e.message); }
      const name = String(b.name || o.name).trim().slice(0, 30);
      await env.DB.prepare("UPDATE orders SET name=?,items=?,total=?,note=?,status='active',updated_at=? WHERE id=?")
        .bind(name, JSON.stringify(lines), totalOf(lines), String(b.note ?? o.note).slice(0, 200), now(), o.id).run();
      const n = await env.DB.prepare('SELECT * FROM orders WHERE id=?').bind(o.id).first();
      return json({ order: pubOrder(n), mail: await mailOrder(env, req, n, 'update') });
    }
    if (method === 'DELETE') {
      await env.DB.prepare("UPDATE orders SET status='cancelled',updated_at=? WHERE id=?").bind(now(), o.id).run();
      const n = await env.DB.prepare('SELECT * FROM orders WHERE id=?').bind(o.id).first();
      return json({ order: pubOrder(n), mail: await mailOrder(env, req, n, 'cancel') });
    }
  }
  // 忘了連結：寄出該信箱所有訂單的修改連結（一律回覆成功，避免被用來探測信箱）
  if (path === '/api/recover' && method === 'POST') {
    const b = await req.json().catch(() => ({})); const email = String(b.email || '').trim().toLowerCase();
    if (EMAIL_RE.test(email)) {
      const rs = await env.DB.prepare("SELECT * FROM orders WHERE email=? AND status='active' ORDER BY created_at").bind(email).all();
      if (rs.results.length) {
        const s = await getSettings(env); const base = s.siteUrl || env.SITE_URL || url.origin; s.shopName = 'EMC 團購';
        const links = rs.results.map((o) => `${base}/order/${o.token}`);
        await sendMail(env, email, `【${s.shopName}】您的訂單修改連結`,
          `<p>您好，以下是您的訂單連結（可查看／修改，直到截止）：</p><ul>${rs.results.map((o, i) => `<li>訂單 ${o.id}（NT$ ${o.total.toLocaleString('en-US')}）：<a href="${links[i]}">${links[i]}</a></li>`).join('')}</ul><p style="color:#999;font-size:12px">${SYSTEM_NOTE}</p>`,
          rs.results.map((o, i) => `訂單 ${o.id}：${links[i]}`).join('\n') + '\n\n' + SYSTEM_NOTE);
      }
    }
    return json({ ok: true });
  }

  // ── 管理者 ──
  if (path === '/api/admin/login' && method === 'POST') {
    const b = await req.json().catch(() => ({}));
    if (!env.ADMIN_PASSWORD) return err('伺服器尚未設定 ADMIN_PASSWORD', 503);
    if (String(b.password || '') !== env.ADMIN_PASSWORD) { await new Promise((r) => setTimeout(r, 600)); return err('密碼不正確', 401); }
    const exp = String(Date.now() + 12 * 3600e3);
    return json({ token: exp + '.' + (await hmac(env, exp)) });
  }
  if (path.startsWith('/api/admin/')) {
    if (!(await isAdmin(req, env))) return err('請先登入管理者', 401);
    if (path === '/api/admin/settings') {
      if (method === 'GET') return json(await getSettings(env, cid));
      if (method === 'PUT') {
        const b = await req.json(); const cur = await getSettings(env, cid); const next = { ...cur };
        for (const k of Object.keys(DEFAULTS)) if (k in b) next[k] = k === 'closed' ? !!b[k] : String(b[k] ?? '').slice(0, 2000);
        await setKV(env, kk(cid, 'settings'), next); return json(next);
      }
    }
    if (path === '/api/admin/campaigns' && method === 'POST') {
      const b = await req.json().catch(() => ({})); const id = String(b.id || '').trim().toLowerCase(); const name = String(b.name || '').trim().slice(0, 60);
      if (!CID_RE.test(id) || id.startsWith('lim') || ['order', 'g', 'api', 'admin', 'campaigns'].includes(id)) return err('代號只能用英文小寫、數字、-（1–20 字），且不可用保留字');
      if (!name) return err('請填寫團購名稱');
      if (camps.some((c) => c.id === id)) return err('這個代號已存在');
      await setKV(env, 'campaigns', [...camps, { id, status: 'open', createdAt: now() }]);
      await setKV(env, kk(id, 'settings'), { ...DEFAULTS, shopName: name });
      return json({ ok: true, id });
    }
    if ((m = path.match(/^\/api\/admin\/campaigns\/([a-z0-9-]{1,20})$/)) && method === 'PUT') {
      const b = await req.json().catch(() => ({})); const st = b.status === 'ended' ? 'ended' : 'open';
      if (!camps.some((c) => c.id === m[1])) return err('找不到這個團購', 404);
      await setKV(env, 'campaigns', camps.map((c) => (c.id === m[1] ? { ...c, status: st, endedAt: st === 'ended' ? now() : undefined } : c)));
      return json({ ok: true });
    }
    if (path === '/api/admin/product-image' && method === 'POST') {
      const nos = (url.searchParams.get('nos') || '').split(',').map(Number).filter(Boolean).slice(0, 500);
      if (!nos.length) return err('沒有指定商品');
      const pimgs = await getKV(env, kk(cid, 'pimgs'), {});
      if (url.searchParams.get('clear')) { for (const n of nos) delete pimgs[n]; await setKV(env, kk(cid, 'pimgs'), pimgs); return json({ ok: true }); }
      const ct = req.headers.get('content-type') || '';
      let src;
      if (ct.includes('json')) {
        const u = String((await req.json()).url || '').trim();
        if (!/^https:\/\/[^\s]+$/i.test(u)) return err('圖片網址需為 https:// 開頭');
        src = u;
      } else {
        const bytes = new Uint8Array(await req.arrayBuffer());
        if (!/^image\/(jpeg|png|webp|gif)$/.test(ct) || bytes.length > 1.5e6 || !bytes.length) return err('圖片格式或大小不正確（上限 1.5MB）');
        const key = 'p' + nos[0] + '_' + Date.now().toString(36);
        await env.FILES.put('img/' + key, bytes, { httpMetadata: { contentType: ct } });
        src = '/api/img/' + key;
      }
      for (const n of nos) pimgs[n] = src;
      await setKV(env, kk(cid, 'pimgs'), pimgs); return json({ ok: true, src });
    }
    if ((m = path.match(/^\/api\/admin\/payimg\/(p_[0-9A-F]+_[a-z0-9]+)$/)) && method === 'GET') {
      const o = await new D1Files(env.DB).get('pay/' + m[1]); if (!o) return err('找不到圖片', 404);
      return new Response(o.body, { headers: { 'content-type': o.httpMetadata?.contentType || 'image/jpeg', 'cache-control': 'private, max-age=300' } });
    }
    if ((m = path.match(/^\/api\/admin\/orders\/([0-9A-F]{8})\/payment$/)) && method === 'DELETE') {
      await env.DB.prepare('UPDATE orders SET pay_last5=NULL, pay_img=NULL, pay_at=NULL WHERE id=?').bind(m[1]).run(); return json({ ok: true });
    }
    if (path === '/api/admin/upload' && method === 'POST') {
      const bytes = new Uint8Array(await req.arrayBuffer());
      if (bytes.length < 1000 || bytes[0] !== 0x50 || bytes[1] !== 0x4b) return err('這不是 .xlsx 檔案');
      let built; try { built = buildCatalog(bytes); } catch (e) { return err('讀取失敗：' + e.message); }
      const ip = cid === DEFAULT_CID ? '' : cid + '_';
      if (ip) { for (const im of built.images) im.key = ip + im.key; for (const c of built.catalog.limited.cards) if (c.img) c.img = ip + c.img; }
      const old = await env.FILES.list({ prefix: 'img/' + ip + 'lim' });
      if (old.objects.length) await env.FILES.delete(old.objects.map((o) => o.key));
      for (const im of built.images) await env.FILES.put('img/' + im.key, im.data, { httpMetadata: { contentType: im.mime } });
      await env.FILES.put(fk(cid, 'template.xlsx'), bytes);
      await env.FILES.put(fk(cid, 'catalog.json'), JSON.stringify(built.catalog), { httpMetadata: { contentType: 'application/json' } });
      return json({ ok: true, items: built.catalog.items.length, exclusive: built.catalog.exclusive.length, limited: built.catalog.limited.cards.length, specRows: built.catalog.specs?.grid.length || 0, bytes: bytes.length });
    }
    if (path === '/api/admin/orders' && method === 'GET') {
      const rs = await env.DB.prepare('SELECT * FROM orders WHERE campaign=? ORDER BY created_at DESC').bind(cid).all();
      const orders = rs.results.map((o) => ({ ...pubOrder(o), payImg: o.pay_img || null }));
      const tally = {};
      for (const o of orders) if (o.status === 'active') for (const l of o.items) { const t = (tally[l.no] ||= { no: l.no, brand: l.brand, name: l.name, price: l.price, qty: 0 }); t.qty += l.qty; }
      const active = orders.filter((o) => o.status === 'active');
      return json({ orders, tally: Object.values(tally).sort((a, b) => a.no - b.no), sum: active.reduce((s, o) => s + o.total, 0), count: active.length });
    }
    if ((m = path.match(/^\/api\/admin\/orders\/([0-9A-F]{8})$/)) && method === 'DELETE') {
      await env.DB.prepare('DELETE FROM orders WHERE id=?').bind(m[1]).run(); return json({ ok: true });
    }
    if (path === '/api/admin/export' && method === 'GET') {
      const t = await env.FILES.get(fk(cid, 'template.xlsx')); if (!t) return err('尚未上傳 Excel', 404);
      const rs = await env.DB.prepare("SELECT * FROM orders WHERE status='active' AND campaign=? ORDER BY created_at").bind(cid).all();
      const rows = [];
      for (const o of rs.results) {
        pubOrder(o).items.forEach((l, i) => rows.push({ name: o.name, no: l.no, sph: l.sph, cyl: l.cyl, axis: l.axis, qty: l.qty, gift: l.gift, personTotal: i === 0 ? o.total : null }));
      }
      const out = fillForms(new Uint8Array(await t.arrayBuffer()), rows);
      const d = new Date(Date.now() + 8 * 3600e3).toISOString().slice(0, 10).replace(/-/g, '');
      return new Response(out.bytes, { headers: {
        'content-type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        'content-disposition': `attachment; filename="group-order-${d}.xlsx"; filename*=UTF-8''${encodeURIComponent('團購訂單彙整_' + d + '.xlsx')}`,
        'x-overflow-rows': String(out.overflow), 'cache-control': 'no-store' } });
    }
  }
  return err('not found', 404);
}

export default {
  async fetch(req, env) {
    try { return await handle(req, env); } catch (e) { console.log('error', e && e.stack || String(e)); return err('伺服器錯誤：' + (e.message || e), 500); }
  },
};

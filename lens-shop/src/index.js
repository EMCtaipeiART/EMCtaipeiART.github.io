import { buildCatalog } from './catalog.js';
import { buildDrinkCatalog, buildManualItems, pickDrink } from './drink.js';
import { ensureAccounts, signUser, getUser as getUserRaw, verifyGoogle } from './auth.js';
import { parseNidin } from './nidin.js';
import { checkLink, parseUberJoin, fetchGroups } from './ubereats.js';
import { fillForms } from './xlsx.js';
import { orderMail, SYSTEM_NOTE, lineLink } from './mail.js';
import { D1Files } from './store.js';

const json = (o, status = 200, h = {}) => new Response(JSON.stringify(o), { status, headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store', ...h } });
const err = (msg, status = 400) => json({ error: msg }, status);
const now = () => new Date().toISOString();
const rid = (n = 16) => { const b = crypto.getRandomValues(new Uint8Array(n)); return [...b].map((x) => x.toString(16).padStart(2, '0')).join(''); };
const DEFAULTS = { shopName: '隱形眼鏡團購', deadline: '', closed: false, bankName: '', bankAccount: '', accountName: '', linePay: '', notes: '', siteUrl: '', goal: '', drinkLink: '' };
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

// ── 邊緣快取（Cache API）：公開唯讀資料短時間快取，寫入時清除 ──
const EDGE = 'https://shop.emc-art.com/__edge/';
async function edgeGet(k, ttl, compute, ctx) {
  const key = new Request(EDGE + k);
  try { const hit = await caches.default.match(key); if (hit) return await hit.json(); } catch {}
  const v = await compute();
  try { const put = caches.default.put(key, new Response(JSON.stringify(v), { headers: { 'content-type': 'application/json', 'cache-control': 'public, max-age=' + ttl } })); ctx && ctx.waitUntil ? ctx.waitUntil(put) : await put; } catch {}
  return v;
}
async function edgePurge(cid) { try { await Promise.all([caches.default.delete(new Request(EDGE + 'campaigns')), caches.default.delete(new Request(EDGE + 'catalog/' + cid))]); } catch {} }

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

const getUser = (req, env) => getUserRaw(hmac, env, req);

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
    if (!catalog.drink && it.power && !sph) throw new Error(`第 ${idx + 1} 筆（${it.name}）：請填寫度數（0 度請填 0）`);
    if (it.toric && (cyl || axis) && !(cyl && axis)) throw new Error(`第 ${idx + 1} 筆（${it.name}）：散光度數與角度需一併填寫`);
    if (catalog.drink) { const d = pickDrink(it, l, idx); return { no: it.no, brand: it.brand, name: it.name, price: it.price + d.extra, qty, sph: '', cyl: '', axis: '', gift: t(l.gift, 40), sel: d.sel, opts: d.opts }; }
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

// ── 餐飲團結單：寄訂單明細信給開團者（含可存成 PDF 的明細頁連結）──
const sumToken = async (env, cid) => (await hmac(env, 'sum:' + cid)).slice(0, 24);
async function summaryData(env, cid) {
  const cat = await getCatalog(env, cid); const s = await getSettings(env, cid);
  const rs = await env.DB.prepare("SELECT name,items,total,note FROM orders WHERE status='active' AND campaign=? ORDER BY created_at").bind(cid).all();
  const orders = rs.results.map((o) => ({ name: o.name, note: o.note || '', total: o.total, items: JSON.parse(o.items).map((l) => ({ name: l.name, opts: l.opts || '', qty: l.qty, price: l.price, gift: l.gift || '' })) }));
  const tally = new Map(); let cups = 0;
  for (const o of orders) for (const l of o.items) { const k = l.name + '|' + l.opts; const t = tally.get(k) || { name: l.name, opts: l.opts, qty: 0 }; t.qty += l.qty; cups += l.qty; tally.set(k, t); }
  return { shopName: s.shopName, store: (cat && cat.store) || '', platform: (cat && cat.platform) || '', link: (cat && cat.link) || s.drinkLink || '', orders, tally: [...tally.values()], cups, sum: orders.reduce((n, o) => n + o.total, 0) };
}
async function mailDrinkSummary(env, req, cid, camps, opt = {}) {
  const cat = await getCatalog(env, cid); if (!cat || !cat.drink) return 'skip';
  const c = camps.find((x) => x.id === cid) || {}; const to = c.owner || env.REPLY_TO; if (!to) return 'skip';
  const d = await summaryData(env, cid); if (!d.orders.length) return 'skip';
  const base = (await getSettings(env, cid)).siteUrl || env.SITE_URL || new URL(req.url).origin;
  const url = `${base}/g/${cid}/summary?t=${await sumToken(env, cid)}`;
  const h = (x) => String(x ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  const plat = d.platform === 'ubereats' ? 'Uber Eats 揪團' : d.platform === 'nidin' ? '你訂開團' : '揪團';
  const rows = d.orders.map((o) => `<tr><td style="padding:6px 8px;border-bottom:1px solid #e5efe8;vertical-align:top"><b>${h(o.name)}</b></td><td style="padding:6px 8px;border-bottom:1px solid #e5efe8">${o.items.map((l) => `${h(l.name)}${l.opts ? '（' + h(l.opts) + '）' : ''} ×${l.qty}`).join('<br>')}</td><td style="padding:6px 8px;border-bottom:1px solid #e5efe8;text-align:right;white-space:nowrap">NT$ ${o.total}</td></tr>`).join('');
  const html = `<div style="font-family:-apple-system,'Noto Sans TC',sans-serif;max-width:640px;margin:auto;color:#222"><h2 style="color:${opt.mode === 'failed' ? '#c0392b' : '#159E31'}">${h(d.shopName)} ${opt.mode === 'done' ? '已結單，已自動填入揪團單' : opt.mode === 'failed' ? '已結單，自動填單失敗' : '已結單，可以下單了'}</h2>${opt.mode === 'done' ? `<p style="background:#eaf6ee;padding:10px 12px;border-radius:8px">系統已把下列訂單自動加入${plat}並核對金額，請到揪團單確認後結帳。${opt.note ? '<br><span style="color:#555;font-size:13px">' + h(opt.note) + '</span>' : ''}</p>` : opt.mode === 'failed' ? `<p style="background:#fdecea;padding:10px 12px;border-radius:8px"><b>自動填單沒有完成，請依下列明細手動加入。</b>${opt.note ? '<br><span style="color:#555;font-size:13px">' + h(opt.note) + '</span>' : ''}</p>` : ''}<p>共 ${d.orders.length} 人、${d.cups} ${d.platform === '' ? '份' : '杯'}，合計 NT$ ${d.sum}。${opt.mode === 'done' ? '明細如下：' : '請到' + plat + '依下列明細加入品項後送出：'}</p>${d.link ? `<p><a href="${h(d.link)}" style="background:#159E31;color:#fff;padding:10px 18px;border-radius:8px;text-decoration:none;display:inline-block">前往${plat}</a></p>` : ''}<table style="border-collapse:collapse;width:100%;font-size:14px"><tr style="background:#f2f8f4"><th style="text-align:left;padding:6px 8px">姓名</th><th style="text-align:left;padding:6px 8px">品項</th><th style="text-align:right;padding:6px 8px">金額</th></tr>${rows}</table><p style="margin-top:18px"><a href="${url}">開啟明細頁，可列印或另存成 PDF</a></p><p style="color:#888;font-size:12px">${h(SYSTEM_NOTE)}</p></div>`;
  const text = `${d.shopName} 已結單（${d.orders.length} 人、${d.cups} ${d.platform === '' ? '份' : '杯'}、NT$ ${d.sum}）\n` + d.orders.map((o) => `${o.name}：` + o.items.map((l) => `${l.name}${l.opts ? '（' + l.opts + '）' : ''}×${l.qty}`).join('、')).join('\n') + `\n\n明細頁（可存成 PDF）：${url}\n${SYSTEM_NOTE}`;
  return sendMail(env, to, `【${d.shopName}】${opt.mode === 'done' ? '已結單，已自動填入揪團單' : opt.mode === 'failed' ? '已結單，自動填單失敗請手動下單' : '已結單，訂單明細'}（${d.cups} ${d.platform === '' ? '份' : '杯'}）`, html, text);
}

// ── 結單後自動填單：先等填完再寄信（本機監看程式有回報心跳才啟用；否則立刻寄）──
const fillKey = (cid) => kk(cid, 'fill');
const localAlive = async (env, cid) => { const w = await getKV(env, 'fillWatch', null); return !!(w && Date.now() - w.at < 300000 && (w.cids || []).includes(cid)); };
async function closeNotify(env, req, cid, camps) {
  const cat = await getCatalog(env, cid); const plat = cat && cat.drink && ['ubereats', 'nidin'].includes(cat.platform);
  if (!plat) return mailDrinkSummary(env, req, cid, camps);
  const rs = await env.DB.prepare("SELECT id FROM orders WHERE status='active' AND campaign=?").bind(cid).all();
  if (!rs.results.length) return 'skip';
  const had = new Set(await getKV(env, kk(cid, 'filledIds'), [])); const ids = rs.results.map((r) => r.id).filter((i) => !had.has(i));
  if (!ids.length) return mailDrinkSummary(env, req, cid, camps, { mode: 'done', note: '沒有需要新填入的訂單（先前已填入）' });
  // 主要：GitHub 雲端代填；本機監看程式只當備援（雲端失敗或太久沒開始才接手）
  if (env.GH_DISPATCH_TOKEN) {
    try {
      const r = await fetch('https://api.github.com/repos/EMCtaipeiART/lens-shop-filler/actions/workflows/fill.yml/dispatches', { method: 'POST', headers: { authorization: 'Bearer ' + env.GH_DISPATCH_TOKEN, accept: 'application/vnd.github+json', 'user-agent': 'lens-shop', 'content-type': 'application/json' }, body: JSON.stringify({ ref: 'main', inputs: { cid, orders: ids.join(','), dry: 'false' } }) });
      if (r.status === 204) { await setKV(env, fillKey(cid), { status: 'pending', at: Date.now(), mailed: false, via: 'cloud', ids }); return 'waiting'; }
      console.log('dispatch failed', r.status);
    } catch (e) { console.log('dispatch exception', String(e)); }
  }
  if (await localAlive(env, cid)) { await setKV(env, fillKey(cid), { status: 'pending', at: Date.now(), mailed: false, via: 'local', ids }); return 'waiting'; }
  return mailDrinkSummary(env, req, cid, camps);
}
const sameKey = (a, b) => { a = String(a || ''); b = String(b || ''); if (!a || a.length !== b.length) return false; let r = 0; for (let i = 0; i < a.length; i++) r |= a.charCodeAt(i) ^ b.charCodeAt(i); return r === 0; };

async function mailOrder(env, req, order, kind) {
  const s = await getSettings(env, order.campaign || DEFAULT_CID);
  const base = s.siteUrl || env.SITE_URL || new URL(req.url).origin;
  const m = orderMail({ order: pubOrder(order), settings: s, link: `${base}/order/${order.token}`, kind });
  return sendMail(env, order.email, m.subject, m.html, m.text);
}

async function handle(req, env, ctx) {
  env = { ...env, FILES: new D1Files(env.DB) };
  const url = new URL(req.url); const path = url.pathname; const method = req.method;
  const cid = url.searchParams.get('c') || DEFAULT_CID;
  if (!CID_RE.test(cid)) return err('團購代號不正確');
  const camps = await getCamps(env);
  if (!camps.some((c) => c.id === cid)) return err('找不到這個團購', 404);
  const closedNow = (s, c = cid) => isClosed(s) || isEnded(camps, c);

  if (path === '/api/summary' && method === 'GET') {
    if (url.searchParams.get('t') !== (await sumToken(env, cid))) return err('連結無效', 403);
    return json(await summaryData(env, cid), 200, { 'cache-control': 'no-store' });
  }
  // ── 本機填單監看程式回報（需 x-fill-key）──
  if (path === '/api/fill/ping' && method === 'POST') {
    if (!sameKey(req.headers.get('x-fill-key'), env.FILL_KEY)) return err('未授權', 401);
    const b = await req.json().catch(() => ({})); const cids = (Array.isArray(b.cids) ? b.cids : []).filter((x) => CID_RE.test(String(x))).slice(0, 50);
    await setKV(env, 'fillWatch', { at: Date.now(), cids });
    const pending = []; for (const c of cids) { const f = await getKV(env, fillKey(c), null); if (f && (f.status === 'pending' || f.status === 'filling')) pending.push({ cid: c, status: f.status, via: f.via || 'local', age: Math.round((Date.now() - f.at) / 1000), ids: f.ids || [] }); }
    return json({ ok: true, pending });
  }
  if (path === '/api/fill/filled' && method === 'POST') { // 把已在別處填過的訂單編號記入（避免重複填）
    if (!sameKey(req.headers.get('x-fill-key'), env.FILL_KEY)) return err('未授權', 401);
    const b = await req.json().catch(() => ({})); const add = (Array.isArray(b.ids) ? b.ids : []).filter((x) => /^[0-9A-F]{8}$/.test(String(x)));
    await setKV(env, kk(cid, 'filledIds'), [...new Set([...(await getKV(env, kk(cid, 'filledIds'), [])), ...add])]); return json({ ok: true, count: add.length });
  }
  if (path === '/api/fill/status' && method === 'POST') {
    if (!sameKey(req.headers.get('x-fill-key'), env.FILL_KEY)) return err('未授權', 401);
    const b = await req.json().catch(() => ({})); const f = await getKV(env, fillKey(cid), null);
    if (!f || !['pending', 'filling'].includes(f.status) || !['filling', 'done', 'failed'].includes(b.status)) return json({ ok: true, ignored: true });
    const note = String(b.note || '').slice(0, 600); const src = b.takeover ? 'local' : (b.src || f.via || 'local');
    if (b.takeover) { await setKV(env, fillKey(cid), { ...f, status: 'filling', via: 'local', at: Date.now() }); return json({ ok: true, status: 'filling' }); }
    // 雲端失敗但本機備援在線：不寄失敗信，交給本機接手
    if (b.status === 'failed' && src === 'cloud' && (await localAlive(env, cid))) { await setKV(env, fillKey(cid), { ...f, status: 'pending', via: 'local', at: Date.now(), note }); return json({ ok: true, status: 'pending', handoff: 'local' }); }
    const nf = { ...f, status: b.status, note, at: Date.now(), via: f.via };
    if ((b.status === 'done' || b.status === 'failed') && !f.mailed) { nf.mailed = true; nf.mail = await mailDrinkSummary(env, req, cid, camps, { mode: b.status, note }); }
    if (b.status === 'done') await setKV(env, kk(cid, 'filledIds'), [...new Set([...(await getKV(env, kk(cid, 'filledIds'), [])), ...(f.ids || [])])]);
    await setKV(env, fillKey(cid), nf); return json({ ok: true, status: nf.status, mail: nf.mail });
  }
  // ── 同事帳號（Google 登入）──
  if (path.startsWith('/api/auth/')) {
    await ensureAccounts(env);
    const cfg = await getKV(env, 'auth', { clientId: '', defaultCreate: true });
    if (path === '/api/auth/config' && method === 'GET') return json({ clientId: cfg.clientId || '' }, 200, { 'cache-control': 'no-store' });
    if (path === '/api/auth/google' && method === 'POST') {
      const b = await req.json().catch(() => ({})); let g;
      try { g = await verifyGoogle(b.credential, cfg.clientId); } catch (e) { return err(e.message, 401); }
      const row = await env.DB.prepare('SELECT * FROM accounts WHERE email=?').bind(g.email).first();
      if (!row) await env.DB.prepare('INSERT INTO accounts(email,name,can_create,created_at,last_login) VALUES(?,?,?,?,?)').bind(g.email, g.name, cfg.defaultCreate === false ? 0 : 1, now(), now()).run();
      else await env.DB.prepare('UPDATE accounts SET last_login=? WHERE email=?').bind(now(), g.email).run();
      const u = row || { email: g.email, name: g.name, can_create: cfg.defaultCreate === false ? 0 : 1 };
      return json({ token: await signUser(hmac, env, g.email), user: { email: u.email, name: u.name, canCreate: true } });
    }
    const me = await getUser(req, env);
    if (!me) return err('請先登入', 401);
    if (path === '/api/auth/me' && method === 'GET') return json({ user: { email: me.email, name: me.name, canCreate: true } }, 200, { 'cache-control': 'no-store' });
    if (path === '/api/auth/me' && method === 'PUT') {
      const b = await req.json().catch(() => ({})); const name = String(b.name || '').trim().slice(0, 30); if (!name) return err('請填寫姓名');
      await env.DB.prepare('UPDATE accounts SET name=? WHERE email=?').bind(name, me.email).run(); return json({ user: { email: me.email, name, canCreate: true } });
    }
    if (path === '/api/auth/orders' && method === 'GET') {
      const rs = await env.DB.prepare("SELECT * FROM orders WHERE email=? ORDER BY created_at DESC LIMIT 200").bind(me.email).all();
      const orders = rs.results.map((o) => { const p = pubOrder(o); const c = camps.find((x) => x.id === o.campaign); return { id: o.id, token: o.token, campaign: o.campaign, campaignName: c ? c.name : o.campaign, ended: c ? c.status === 'ended' : true, total: o.total, status: o.status, createdAt: o.created_at, paid: !!p.pay, items: p.items.map((l) => ({ name: l.name, qty: l.qty, opts: l.opts })) }; });
      return json({ orders }, 200, { 'cache-control': 'no-store' });
    }
    return err('找不到', 404);
  }

  if (path === '/api/campaigns' && method === 'GET') {
    const usr = await getUser(req, env);
    const base = await edgeGet('campaigns', 10, async () => {
      const list = await Promise.all(camps.map(async (c) => {
        const [s, cat, rs, pimgs] = await Promise.all([getSettings(env, c.id), getCatalog(env, c.id), env.DB.prepare("SELECT name,total,created_at FROM orders WHERE campaign=? AND status='active' ORDER BY created_at").bind(c.id).all(), getKV(env, kk(c.id, 'pimgs'), {})]);
        const goal = Math.max(0, parseInt(String(s.goal || '0').replace(/[^\d]/g, ''), 10) || 0);
        let sum = 0, reachedAt = '';
        for (const o of rs.results) { sum += o.total; if (goal && !reachedAt && sum >= goal) reachedAt = o.created_at; }
        const names = [...new Set(rs.results.map((o) => o.name).reverse())];
        const covers = [...new Set(Object.values(pimgs))].filter((u) => typeof u === 'string').slice(0, 4);
        return { id: c.id, name: s.shopName, deadline: s.deadline, ended: isEnded(camps, c.id), closed: closedNow(s, c.id), ready: !!cat,
          goal, sum, count: rs.results.length, names: names.slice(0, 8), nameCount: names.length, reachedAt,
          startAt: c.createdAt || (rs.results[0] && rs.results[0].created_at) || '', endedAt: c.endedAt || '', covers,
          drink: !!(cat && cat.drink), custom: !!(cat && cat.drink && !cat.platform), store: cat && cat.drink ? cat.store : '', link: cat && cat.drink ? cat.link : '', owned: !!c.owner, _o: c.owner || '' };
      }));
      return list;
    }, ctx);
    const list = base.map(({ _o, ...x }) => ({ ...x, mine: !!(usr && _o && _o === usr.email) }));
    return json({ campaigns: list }, 200, { 'cache-control': 'no-store' });
  }

  if (path === '/api/catalog' && method === 'GET') {
    const out = await edgeGet('catalog/' + cid, 30, async () => {
      const [cat, s, pimgs] = await Promise.all([getCatalog(env, cid), getSettings(env, cid), getKV(env, kk(cid, 'pimgs'), {})]);
      if (cat && cat.drink && /^https:\/\//.test(s.drinkLink || '')) { const h = new URL(s.drinkLink).hostname; cat.link = s.drinkLink; cat.platform = /uber/.test(h) ? 'ubereats' : /nidin/.test(h) ? 'nidin' : cat.platform; }
      return { catalog: cat, pimgs, settings: { shopName: s.shopName, deadline: s.deadline, closed: closedNow(s), bankName: s.bankName, bankAccount: s.bankAccount, accountName: s.accountName, linePay: lineLink(s.linePay), notes: s.notes, goal: s.goal, drinkLink: s.drinkLink } };
    }, ctx);
    return json(out, 200, { 'cache-control': 'no-store' });
  }
  if (path.startsWith('/api/img/') && method === 'GET') {
    const o = await env.FILES.get('img/' + decodeURIComponent(path.slice(9)).replace(/[^\w.\-]/g, ''));
    if (!o) return new Response('not found', { status: 404 });
    return new Response(o.body, { headers: { 'content-type': o.httpMetadata?.contentType || 'image/jpeg', 'cache-control': 'public, max-age=86400' } });
  }

  // 公開訂單列表（不含 Email 與修改連結）
  if (path === '/api/orders-public' && method === 'GET') {
    const rs = await env.DB.prepare("SELECT * FROM orders WHERE status='active' AND campaign=? ORDER BY created_at DESC").bind(cid).all();
    const orders = rs.results.map((o) => { const p = pubOrder(o); return { id: p.id, name: p.name, items: p.items.map((l) => ({ no: l.no, brand: l.brand, name: l.name, price: l.price, qty: l.qty, sph: l.sph, cyl: l.cyl, axis: l.axis, gift: l.gift, opts: l.opts })), total: p.total, updatedAt: p.updatedAt, paid: !!p.pay }; });
    return json({ orders, count: orders.length, sum: orders.reduce((x, o) => x + o.total, 0) });
  }
  // 即時聊天室（表 chat、chat_presence；第一次使用時自動建立，不動既有資料）
  if (path.startsWith('/api/chat')) {
    await ensureChat(env);
    const nowMs = Date.now();
    const online = async () => (await env.DB.prepare('SELECT COUNT(*) c FROM chat_presence WHERE campaign=? AND seen>?').bind(cid, nowMs - 45000).first()).c;
    const touch = (sid, name) => sid ? env.DB.prepare('INSERT INTO chat_presence(campaign,sid,name,seen) VALUES(?,?,?,?) ON CONFLICT(campaign,sid) DO UPDATE SET name=excluded.name,seen=excluded.seen').bind(cid, String(sid).slice(0, 40), String(name || '').slice(0, 20), nowMs).run() : null;
    const usr = await getUser(req, env); const mySid = usr ? 'u:' + usr.email : '';
    if (path === '/api/chat' && method === 'GET') {
      const u = url.searchParams.get('u'), sid = mySid || url.searchParams.get('sid') || '';
      const cols = 'id,name n,text t,img,at,ed,del,up,(sid=?) m';
      const rs = u == null
        ? await env.DB.prepare('SELECT ' + cols + ' FROM (SELECT * FROM chat WHERE campaign=? AND del=0 ORDER BY id DESC LIMIT 150) ORDER BY id').bind(sid, cid).all()
        : await env.DB.prepare('SELECT ' + cols + ' FROM chat WHERE campaign=? AND up>? ORDER BY id LIMIT 300').bind(sid, cid, parseInt(u, 10) || 0).all();
      return json({ msgs: rs.results.map((r) => ({ ...r, m: !!r.m })), online: await online(), now: nowMs }, 200, { 'cache-control': 'no-store' });
    }
    if (path === '/api/chat/ping' && method === 'POST') {
      const b = await req.json().catch(() => ({})); await touch(mySid || b.sid, usr ? usr.name : b.name);
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
      const name = String(usr ? usr.name : b.name || '').trim().slice(0, 20), text = String(b.text || '').trim().slice(0, 500);
      const img = /^\/api\/img\/chat_[\w]+$/.test(b.img || '') ? b.img : '';
      if (!name) return err('請先設定暱稱'); if (!text && !img) return err('請輸入內容');
      const r = await env.DB.prepare('INSERT INTO chat(campaign,name,text,img,at,sid,up) VALUES(?,?,?,?,?,?,?)').bind(cid, name, text, img, now(), mySid || String(b.sid || '').slice(0, 40), nowMs).run();
      await touch(mySid || b.sid, name); return json({ ok: true, id: r.meta.last_row_id });
    }
    if ((path === '/api/chat/delete' || path === '/api/chat/edit') && method === 'POST') {
      const b = await req.json().catch(() => ({})); const id = parseInt(url.searchParams.get('id') || '0', 10);
      const row = await env.DB.prepare('SELECT sid FROM chat WHERE campaign=? AND id=? AND del=0').bind(cid, id).first(); if (!row) return err('找不到這則訊息', 404);
      const own = row.sid && (row.sid === mySid || (!mySid.startsWith('u:') || true) && row.sid === String(b.sid || ''));
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
    const usr = await getUser(req, env);
    const name = String(b.name || (usr && usr.name) || '').trim().slice(0, 30), email = String(b.email || (usr && usr.email) || '').trim().toLowerCase().slice(0, 120);
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
    const adm = await isAdmin(req, env); const usr = adm ? null : await getUser(req, env);
    if (!adm && !usr) return err('請先登入管理者，或使用有開團權限的帳號登入', 401);
    const own = (id) => adm || (usr && (camps.find((c) => c.id === id) || {}).owner === usr.email);
    if (!adm) {
      const cp = path.match(/^\/api\/admin\/campaigns\/([a-z0-9-]{1,20})$/); const od = path.match(/^\/api\/admin\/orders\/([0-9A-F]{8})(?:\/payment|\/unavailable)?$/);
      let ok;
      if (path === '/api/admin/accounts' || path.startsWith('/api/admin/accounts/') || path === '/api/admin/auth') ok = false;
      else if ((path === '/api/admin/campaigns' && method === 'POST') || path === '/api/admin/drink-parse') ok = true;
      else if (cp) ok = own(cp[1]);
      else if (od) ok = own(((await env.DB.prepare('SELECT campaign FROM orders WHERE id=?').bind(od[1]).first()) || {}).campaign);
      else ok = own(cid);
      if (!ok) return err('這個團購不是您開的，沒有權限', 403);
    }
    if (path === '/api/admin/auth' && method === 'GET') { await ensureAccounts(env); const a = await getKV(env, 'auth', { clientId: '', defaultCreate: true }); return json({ clientId: a.clientId || '', defaultCreate: a.defaultCreate !== false }); }
    if (path === '/api/admin/auth' && method === 'PUT') { const b = await req.json().catch(() => ({})); const old = await getKV(env, 'auth', { clientId: '' }); const a = { clientId: b.clientId === '__keep__' ? old.clientId || '' : String(b.clientId || '').trim().slice(0, 200), defaultCreate: !!b.defaultCreate }; await setKV(env, 'auth', a); return json(a); }
    if (path === '/api/admin/accounts' && method === 'GET') { await ensureAccounts(env); const rs = await env.DB.prepare('SELECT email,name,can_create,created_at,last_login FROM accounts ORDER BY created_at').all(); return json({ accounts: rs.results.map((a) => ({ ...a, can_create: !!a.can_create })) }); }
    if ((m = path.match(/^\/api\/admin\/accounts\/(.+)$/)) && method === 'PUT') {
      const b = await req.json().catch(() => ({})); const email = decodeURIComponent(m[1]).toLowerCase();
      await env.DB.prepare('UPDATE accounts SET can_create=? WHERE email=?').bind(b.canCreate ? 1 : 0, email).run(); return json({ ok: true });
    }
    if (path === '/api/admin/fill' && method === 'GET') return json((await getKV(env, fillKey(cid), null)) || { status: 'none' });
    if (path === '/api/admin/fill/mail' && method === 'POST') {
      const f = (await getKV(env, fillKey(cid), null)) || {}; const mail = await mailDrinkSummary(env, req, cid, camps);
      await setKV(env, fillKey(cid), { ...f, status: 'manual', mailed: true, mail, at: Date.now() }); return json({ ok: true, mail });
    }
    if (path === '/api/admin/settings') {
      if (method === 'GET') return json(await getSettings(env, cid));
      if (method === 'PUT') {
        const b = await req.json(); const cur = await getSettings(env, cid); const next = { ...cur };
        for (const k of Object.keys(DEFAULTS)) if (k in b) next[k] = k === 'closed' ? !!b[k] : String(b[k] ?? '').slice(0, 2000);
        await setKV(env, kk(cid, 'settings'), next);
        if (next.closed && !cur.closed) next.mail = await closeNotify(env, req, cid, camps);
        if (!next.closed && cur.closed) await setKV(env, fillKey(cid), null);
        // 結單＝團購狀態自動改為已結束；重新開單則恢復進行中
        if (next.closed !== !!cur.closed) await setKV(env, 'campaigns', camps.map((c) => (c.id === cid ? { ...c, status: next.closed ? 'ended' : 'open', endedAt: next.closed ? now() : undefined } : c)));
        return json(next);
      }
    }
    if (path === '/api/admin/campaigns' && method === 'POST') {
      const b = await req.json().catch(() => ({})); const id = String(b.id || '').trim().toLowerCase(); const name = String(b.name || '').trim().slice(0, 60);
      if (!CID_RE.test(id) || id.startsWith('lim') || ['order', 'g', 'api', 'admin', 'campaigns'].includes(id)) return err('代號只能用英文小寫、數字、-（1–20 字），且不可用保留字');
      if (!name) return err('請填寫團購名稱');
      if (camps.some((c) => c.id === id)) return err('這個代號已存在');
      let built = null;
      if (b.menu) { try { built = buildDrinkCatalog(b.menu); } catch (e) { return err('菜單格式不正確：' + e.message); } }
      else if (b.manual) built = { catalog: { drink: true, store: name, platform: '', link: '', items: [], exclusive: [], limited: { title: '', cards: [], note: [] }, specs: null, builtAt: now() }, pimgs: {} };
      await setKV(env, 'campaigns', [...camps, { id, status: 'open', createdAt: now(), ...(usr ? { owner: usr.email } : {}) }]);
      const init = {}; for (const k of ['goal', 'deadline', 'bankName', 'bankAccount', 'accountName', 'linePay', 'notes']) if (b.settings && b.settings[k] != null) init[k] = String(b.settings[k]).slice(0, 2000);
      await setKV(env, kk(id, 'settings'), { ...DEFAULTS, ...init, shopName: name, drinkLink: /^https:\/\//.test(b.link || '') ? String(b.link).slice(0, 500) : '' });
      if (built) { await env.FILES.put(fk(id, 'catalog.json'), JSON.stringify(built.catalog), { httpMetadata: { contentType: 'application/json' } }); await setKV(env, kk(id, 'pimgs'), built.pimgs); }
      return json({ ok: true, id });
    }
    if ((m = path.match(/^\/api\/admin\/campaigns\/([a-z0-9-]{1,20})$/)) && method === 'PUT') {
      const b = await req.json().catch(() => ({})); const st = b.status === 'ended' ? 'ended' : 'open';
      if (!camps.some((c) => c.id === m[1])) return err('找不到這個團購', 404);
      const was = (camps.find((c) => c.id === m[1]) || {}).status;
      await setKV(env, 'campaigns', camps.map((c) => (c.id === m[1] ? { ...c, status: st, endedAt: st === 'ended' ? now() : undefined } : c)));
      if (st === 'open') { const cs0 = await getSettings(env, m[1]); if (cs0.closed) { await setKV(env, kk(m[1], 'settings'), { ...cs0, closed: false }); await setKV(env, fillKey(m[1]), null); } }
      const mail = st === 'ended' && was !== 'ended' ? await closeNotify(env, req, m[1], camps) : 'skip';
      return json({ ok: true, mail });
    }
    if ((m = path.match(/^\/api\/admin\/campaigns\/([a-z0-9-]{1,20})$/)) && method === 'DELETE') { // 永久刪除團購（含訂單、聊天室、設定與檔案）
      const id = m[1]; if (id === DEFAULT_CID) return err('預設團購不能刪除');
      if (!camps.some((c) => c.id === id)) return err('找不到這個團購', 404);
      await env.DB.batch([
        env.DB.prepare('DELETE FROM orders WHERE campaign=?').bind(id),
        env.DB.prepare('DELETE FROM kv WHERE k IN (?,?,?,?)').bind(kk(id, 'settings'), kk(id, 'pimgs'), kk(id, 'fill'), kk(id, 'filledIds')),
        env.DB.prepare('DELETE FROM files WHERE substr(k,1,?)=? OR substr(k,1,?)=?').bind(id.length + 1, id + '/', id.length + 8, 'img/' + id + '_lim'),
      ]);
      for (const t of ['chat', 'chat_presence']) { try { await env.DB.prepare('DELETE FROM ' + t + ' WHERE campaign=?').bind(id).run(); } catch {} }
      await setKV(env, 'campaigns', camps.filter((c) => c.id !== id));
      return json({ ok: true });
    }
    if (path === '/api/admin/manual-items' && method === 'POST') { // 自訂團：開團者手動維護商品（品名、價格、選項；圖片另用 product-image）
      const cat = await getCatalog(env, cid); if (!cat || !cat.drink || cat.platform) return err('只有自訂團可以手動編輯商品');
      const b = await req.json().catch(() => ({})); let r; try { r = buildManualItems(cat.items, b.items); } catch (e) { return err(e.message); }
      const keep = new Set(r.nos); const pimgs = await getKV(env, kk(cid, 'pimgs'), {}); for (const n of Object.keys(pimgs)) if (!keep.has(+n)) delete pimgs[n];
      await env.FILES.put(fk(cid, 'catalog.json'), JSON.stringify({ ...cat, items: r.items }), { httpMetadata: { contentType: 'application/json' } }); await setKV(env, kk(cid, 'pimgs'), pimgs);
      return json({ ok: true, nos: r.nos, count: r.items.length });
    }
    if (path === '/api/admin/drink-images' && method === 'POST') { // 重新抓取商品圖片（依品名對應，不動訂單與目錄）
      const cat = await getCatalog(env, cid); if (!cat || !cat.drink) return err('這不是餐飲團');
      let items; try { const c = checkLink(cat.link); items = c.platform === 'nidin' ? (await parseNidin(c.url)).items : (await parseUberJoin(c.url)).items; } catch (e) { return err(e.message); }
      const byName = new Map(items.map((i) => [i.name, i.img])); const pimgs = {}; let n = 0;
      cat.items.forEach((x, i) => { const u = byName.get(x.name); if (u && /^https:\/\/[^\s]+$/i.test(u)) { pimgs[i + 1] = u; n++; } });
      await setKV(env, kk(cid, 'pimgs'), pimgs); return json({ ok: true, count: n, total: cat.items.length });
    }
    if (path === '/api/admin/drink-parse' && method === 'POST') {
      const b = await req.json().catch(() => ({})); let c;
      try { c = checkLink(b.link); } catch (e) { return err(e.message); }
      if (c.platform === 'nidin') { let r; try { r = await parseNidin(c.url); } catch (e) { return err(e.message); } return json({ platform: 'nidin', link: c.url, store: r.store, open: r.open, menu: { store: r.store, platform: 'nidin', link: c.url, items: r.items } }); }
      let r; try { r = await parseUberJoin(c.url); } catch (e) { return err(e.message); }
      if (Array.isArray(b.ids)) { const its = r.items.filter((i) => b.ids.includes(i.id)).slice(0, 30); return json({ groups: await fetchGroups(r.storeUuid, its) }); }
      return json({ platform: 'ubereats', link: c.url, store: r.store, count: r.items.length, items: r.items.map(({ id, name, price, cat, img }) => ({ id, name, price, cat, img })) });
    }
    if (path === '/api/admin/drink-menu' && method === 'POST') {
      const b = await req.json().catch(() => null); if (!b) return err('資料格式錯誤');
      let built; try { built = buildDrinkCatalog(b.menu || b); } catch (e) { return err('菜單格式不正確：' + e.message); }
      if (b.link !== undefined) built.catalog.link = /^https:\/\/[^\s]+$/i.test(b.link) ? b.link : '';
      await env.FILES.put(fk(cid, 'catalog.json'), JSON.stringify(built.catalog), { httpMetadata: { contentType: 'application/json' } });
      await setKV(env, kk(cid, 'pimgs'), built.pimgs);
      return json({ ok: true, items: built.catalog.items.length, images: Object.keys(built.pimgs).length });
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
    if ((m = path.match(/^\/api\/admin\/orders\/([0-9A-F]{8})\/unavailable$/)) && method === 'POST') {
      const b = await req.json().catch(() => ({}));
      const o = await env.DB.prepare('SELECT * FROM orders WHERE id=?').bind(m[1]).first(); if (!o) return err('找不到訂單', 404);
      const its = JSON.parse(o.items); const idx = (Array.isArray(b.items) ? b.items : []).map(Number).filter((n) => Number.isInteger(n) && n >= 0 && n < its.length);
      const reason = String(b.reason || '').trim().slice(0, 300); if (!idx.length) return err('請選擇無法下單的品項'); if (!reason) return err('請填寫原因');
      const c = camps.find((x) => x.id === (o.campaign || DEFAULT_CID)) || {}; const s2 = await getSettings(env, o.campaign || DEFAULT_CID);
      const hh = (x) => String(x ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
      const list = idx.map((i) => `${its[i].name}${its[i].opts ? '（' + its[i].opts + '）' : ''} ×${its[i].qty}`);
      const base = s2.siteUrl || env.SITE_URL || new URL(req.url).origin;
      const subject = `【${s2.shopName}】您訂的品項無法下單`;
      const html = `<div style="font-family:-apple-system,'Noto Sans TC',sans-serif;max-width:600px;margin:auto;color:#222"><h2 style="color:#c0392b">有品項無法下單</h2><p>${hh(o.name)} 您好，您在「${hh(s2.shopName)}」訂的以下品項<b>無法下單</b>：</p><ul>${list.map((x) => `<li>${hh(x)}</li>`).join('')}</ul><p><b>原因：</b>${hh(reason)}</p><p>其餘品項不受影響。如需更換品項，請聯絡團購負責人，或到訂單頁修改（若仍在開放期間）：<a href="${base}/order/${o.token}">查看我的訂單</a></p><p style="color:#888;font-size:12px">${hh(SYSTEM_NOTE)}</p></div>`;
      const text = `${o.name} 您好，您在「${s2.shopName}」訂的以下品項無法下單：
${list.join('\n')}
原因：${reason}
其餘品項不受影響，如需更換請聯絡團購負責人。
訂單：${base}/order/${o.token}
${SYSTEM_NOTE}`;
      const r1 = await sendMail(env, o.email, subject, html, text);
      const org = c.owner || env.REPLY_TO; let r2 = 'skip';
      if (org && org !== o.email) r2 = await sendMail(env, org, `${subject}（${o.name}）`, html, text);
      return json({ ok: true, mail: r1, organizer: r2 });
    }
    if (path === '/api/admin/orders' && method === 'GET') {
      const rs = await env.DB.prepare('SELECT * FROM orders WHERE campaign=? ORDER BY created_at DESC').bind(cid).all();
      const orders = rs.results.map((o) => ({ ...pubOrder(o), payImg: o.pay_img || null }));
      const tally = {};
      for (const o of orders) if (o.status === 'active') for (const l of o.items) { const t = (tally[l.no + '|' + (l.opts || '')] ||= { no: l.no, brand: l.brand, name: l.name, price: l.price, opts: l.opts || '', qty: 0 }); t.qty += l.qty; }
      const active = orders.filter((o) => o.status === 'active');
      return json({ orders, tally: Object.values(tally).sort((a, b) => a.no - b.no || String(a.opts).localeCompare(String(b.opts))), sum: active.reduce((s, o) => s + o.total, 0), count: active.length });
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
  async fetch(req, env, ctx) {
    try {
      if (req.method === 'GET') { // 快取命中就不必先查資料庫
        const u = new URL(req.url);
        try {
          if (u.pathname === '/api/campaigns' && !req.headers.get('x-user')) { const hit = await caches.default.match(new Request(EDGE + 'campaigns')); if (hit) return json({ campaigns: (await hit.json()).map(({ _o, ...x }) => ({ ...x, mine: false })) }, 200, { 'cache-control': 'no-store' }); }
          else if (u.pathname === '/api/catalog' && /^[a-z0-9-]{1,20}$/.test(u.searchParams.get('c') || 'lens')) { const hit = await caches.default.match(new Request(EDGE + 'catalog/' + (u.searchParams.get('c') || 'lens'))); if (hit) return json(await hit.json(), 200, { 'cache-control': 'no-store' }); }
        } catch {}
      }
      const res = await handle(req, env, ctx);
      if (req.method !== 'GET' && req.method !== 'HEAD' && res.status < 400 && new URL(req.url).pathname.startsWith('/api/')) { const cid = new URL(req.url).searchParams.get('c') || 'lens'; ctx.waitUntil(edgePurge(/^[a-z0-9-]{1,20}$/.test(cid) ? cid : 'lens')); }
      return res;
    } catch (e) { console.log('error', e && e.stack || String(e)); return err('伺服器錯誤：' + (e.message || e), 500); }
  },
};

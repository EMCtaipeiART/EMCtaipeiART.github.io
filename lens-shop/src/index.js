import { buildCatalog } from './catalog.js';
import { fillForms } from './xlsx.js';
import { orderMail } from './mail.js';
import { D1Files } from './store.js';

const json = (o, status = 200, h = {}) => new Response(JSON.stringify(o), { status, headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store', ...h } });
const err = (msg, status = 400) => json({ error: msg }, status);
const now = () => new Date().toISOString();
const rid = (n = 16) => { const b = crypto.getRandomValues(new Uint8Array(n)); return [...b].map((x) => x.toString(16).padStart(2, '0')).join(''); };
const DEFAULTS = { shopName: '隱形眼鏡團購', deadline: '', closed: false, bankName: '', bankAccount: '', accountName: '', notes: '', siteUrl: '' };
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

async function getKV(env, k, d = null) { const r = await env.DB.prepare('SELECT v FROM kv WHERE k=?').bind(k).first(); return r ? JSON.parse(r.v) : d; }
async function setKV(env, k, v) { await env.DB.prepare('INSERT INTO kv(k,v) VALUES(?,?) ON CONFLICT(k) DO UPDATE SET v=excluded.v').bind(k, JSON.stringify(v)).run(); }
const getSettings = async (env) => ({ ...DEFAULTS, ...(await getKV(env, 'settings', {})) });
async function getCatalog(env) { const o = await env.FILES.get('catalog.json'); return o ? JSON.parse(await o.text()) : null; }

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
const pubOrder = (o) => ({ id: o.id, name: o.name, email: o.email, items: JSON.parse(o.items), total: o.total, note: o.note, status: o.status, createdAt: o.created_at, updatedAt: o.updated_at });

async function sendMail(env, to, subject, html, text) {
  if (!env.RESEND_API_KEY) { console.log('[mail skipped: no RESEND_API_KEY]', to, subject); return 'skipped'; }
  try {
    const r = await fetch('https://api.resend.com/emails', {
      method: 'POST', headers: { authorization: 'Bearer ' + env.RESEND_API_KEY, 'content-type': 'application/json' },
      body: JSON.stringify({ from: env.MAIL_FROM, to: [to], subject, html, text }),
    });
    if (!r.ok) { console.log('mail error', r.status, await r.text()); return 'failed'; }
    return 'sent';
  } catch (e) { console.log('mail exception', String(e)); return 'failed'; }
}
async function mailOrder(env, req, order, kind) {
  const s = await getSettings(env);
  const base = s.siteUrl || env.SITE_URL || new URL(req.url).origin;
  const m = orderMail({ order: pubOrder(order), settings: s, link: `${base}/#/order/${order.token}`, kind });
  return sendMail(env, order.email, m.subject, m.html, m.text);
}

async function handle(req, env) {
  env = { ...env, FILES: new D1Files(env.DB) };
  const url = new URL(req.url); const path = url.pathname; const method = req.method;

  if (path === '/api/catalog' && method === 'GET') {
    const [cat, s, pimgs] = await Promise.all([getCatalog(env), getSettings(env), getKV(env, 'pimgs', {})]);
    return json({ catalog: cat, pimgs, settings: { shopName: s.shopName, deadline: s.deadline, closed: isClosed(s), bankName: s.bankName, bankAccount: s.bankAccount, accountName: s.accountName, notes: s.notes } },
      200, { 'cache-control': 'public, max-age=30' });
  }
  if (path.startsWith('/api/img/') && method === 'GET') {
    const o = await env.FILES.get('img/' + decodeURIComponent(path.slice(9)).replace(/[^\w.\-]/g, ''));
    if (!o) return new Response('not found', { status: 404 });
    return new Response(o.body, { headers: { 'content-type': o.httpMetadata?.contentType || 'image/jpeg', 'cache-control': 'public, max-age=86400' } });
  }

  // 公開訂單列表（不含 Email 與修改連結）
  if (path === '/api/orders-public' && method === 'GET') {
    const rs = await env.DB.prepare("SELECT * FROM orders WHERE status='active' ORDER BY created_at DESC").all();
    const orders = rs.results.map((o) => { const p = pubOrder(o); return { id: p.id, name: p.name, items: p.items.map((l) => ({ no: l.no, brand: l.brand, name: l.name, price: l.price, qty: l.qty, sph: l.sph, cyl: l.cyl, axis: l.axis, gift: l.gift })), total: p.total, updatedAt: p.updatedAt }; });
    return json({ orders, count: orders.length, sum: orders.reduce((x, o) => x + o.total, 0) });
  }
  // 同事：建立訂單
  if (path === '/api/orders' && method === 'POST') {
    const b = await req.json().catch(() => null); if (!b) return err('資料格式錯誤');
    const s = await getSettings(env); if (isClosed(s)) return err('已截止，無法再下單', 403);
    const name = String(b.name || '').trim().slice(0, 30), email = String(b.email || '').trim().toLowerCase().slice(0, 120);
    if (!name) return err('請填寫姓名'); if (!EMAIL_RE.test(email)) return err('Email 格式不正確');
    const cat = await getCatalog(env); if (!cat) return err('目前尚未開放下單', 503);
    let lines; try { lines = cleanLines(b.items, cat); } catch (e) { return err(e.message); }
    const o = { id: rid(4).toUpperCase(), token: rid(16), name, email, items: JSON.stringify(lines), total: totalOf(lines), note: String(b.note || '').slice(0, 200), status: 'active', created_at: now(), updated_at: now() };
    await env.DB.prepare('INSERT INTO orders(id,token,name,email,items,total,note,status,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?)')
      .bind(o.id, o.token, o.name, o.email, o.items, o.total, o.note, o.status, o.created_at, o.updated_at).run();
    const mail = await mailOrder(env, req, o, 'new');
    return json({ order: pubOrder(o), token: o.token, mail });
  }
  let m;
  if ((m = path.match(/^\/api\/orders\/([0-9a-f]{32})$/))) {
    const o = await env.DB.prepare('SELECT * FROM orders WHERE token=?').bind(m[1]).first();
    if (!o) return err('找不到訂單', 404);
    const s = await getSettings(env);
    if (method === 'GET') return json({ order: pubOrder(o), closed: isClosed(s) });
    if (isClosed(s)) return err('已截止，無法再修改', 403);
    if (method === 'PUT') {
      const b = await req.json().catch(() => null); if (!b) return err('資料格式錯誤');
      const cat = await getCatalog(env); let lines; try { lines = cleanLines(b.items, cat); } catch (e) { return err(e.message); }
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
        const s = await getSettings(env); const base = s.siteUrl || env.SITE_URL || url.origin;
        const links = rs.results.map((o) => `${base}/#/order/${o.token}`);
        await sendMail(env, email, `【${s.shopName}】您的訂單修改連結`,
          `<p>您好，以下是您的訂單連結（可查看／修改，直到截止）：</p><ul>${rs.results.map((o, i) => `<li>訂單 ${o.id}（NT$ ${o.total.toLocaleString('en-US')}）：<a href="${links[i]}">${links[i]}</a></li>`).join('')}</ul>`,
          rs.results.map((o, i) => `訂單 ${o.id}：${links[i]}`).join('\n'));
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
      if (method === 'GET') return json(await getSettings(env));
      if (method === 'PUT') {
        const b = await req.json(); const cur = await getSettings(env); const next = { ...cur };
        for (const k of Object.keys(DEFAULTS)) if (k in b) next[k] = k === 'closed' ? !!b[k] : String(b[k] ?? '').slice(0, 2000);
        await setKV(env, 'settings', next); return json(next);
      }
    }
    if (path === '/api/admin/product-image' && method === 'POST') {
      const nos = (url.searchParams.get('nos') || '').split(',').map(Number).filter(Boolean).slice(0, 500);
      if (!nos.length) return err('沒有指定商品');
      const pimgs = await getKV(env, 'pimgs', {});
      if (url.searchParams.get('clear')) { for (const n of nos) delete pimgs[n]; await setKV(env, 'pimgs', pimgs); return json({ ok: true }); }
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
      await setKV(env, 'pimgs', pimgs); return json({ ok: true, src });
    }
    if (path === '/api/admin/upload' && method === 'POST') {
      const bytes = new Uint8Array(await req.arrayBuffer());
      if (bytes.length < 1000 || bytes[0] !== 0x50 || bytes[1] !== 0x4b) return err('這不是 .xlsx 檔案');
      let built; try { built = buildCatalog(bytes); } catch (e) { return err('讀取失敗：' + e.message); }
      const old = await env.FILES.list({ prefix: 'img/lim' });
      if (old.objects.length) await env.FILES.delete(old.objects.map((o) => o.key));
      for (const im of built.images) await env.FILES.put('img/' + im.key, im.data, { httpMetadata: { contentType: im.mime } });
      await env.FILES.put('template.xlsx', bytes);
      await env.FILES.put('catalog.json', JSON.stringify(built.catalog), { httpMetadata: { contentType: 'application/json' } });
      return json({ ok: true, items: built.catalog.items.length, exclusive: built.catalog.exclusive.length, limited: built.catalog.limited.cards.length, specRows: built.catalog.specs?.grid.length || 0, bytes: bytes.length });
    }
    if (path === '/api/admin/orders' && method === 'GET') {
      const rs = await env.DB.prepare('SELECT * FROM orders ORDER BY created_at DESC').all();
      const orders = rs.results.map(pubOrder);
      const tally = {};
      for (const o of orders) if (o.status === 'active') for (const l of o.items) { const t = (tally[l.no] ||= { no: l.no, brand: l.brand, name: l.name, price: l.price, qty: 0 }); t.qty += l.qty; }
      const active = orders.filter((o) => o.status === 'active');
      return json({ orders, tally: Object.values(tally).sort((a, b) => a.no - b.no), sum: active.reduce((s, o) => s + o.total, 0), count: active.length });
    }
    if ((m = path.match(/^\/api\/admin\/orders\/([0-9A-F]{8})$/)) && method === 'DELETE') {
      await env.DB.prepare('DELETE FROM orders WHERE id=?').bind(m[1]).run(); return json({ ok: true });
    }
    if (path === '/api/admin/export' && method === 'GET') {
      const t = await env.FILES.get('template.xlsx'); if (!t) return err('尚未上傳 Excel', 404);
      const rs = await env.DB.prepare("SELECT * FROM orders WHERE status='active' ORDER BY created_at").all();
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

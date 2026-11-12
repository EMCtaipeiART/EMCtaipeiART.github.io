// Google 帳號登入（同事身分）：前端取得 Google ID token → 這裡驗證 → 發本站的登入 token（HMAC 簽章，30 天）
let ready = false;
export async function ensureAccounts(env) {
  if (ready) return;
  await env.DB.prepare('CREATE TABLE IF NOT EXISTS accounts (email TEXT PRIMARY KEY, name TEXT NOT NULL DEFAULT \'\', can_create INTEGER NOT NULL DEFAULT 0, created_at TEXT NOT NULL, last_login TEXT)').run();
  ready = true;
}
const b64u = (s) => btoa(unescape(encodeURIComponent(s))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
const unb64u = (s) => decodeURIComponent(escape(atob(s.replace(/-/g, '+').replace(/_/g, '/'))));

export async function signUser(hmac, env, email) {
  const exp = String(Date.now() + 30 * 864e5); const p = 'u.' + exp + '.' + b64u(email);
  return p + '.' + (await hmac(env, p));
}
// 回傳帳號資料列（含 can_create），無效回傳 null
export async function getUser(hmac, env, req) {
  const t = req.headers.get('x-user') || ''; const a = t.split('.');
  if (a.length !== 4 || a[0] !== 'u' || +a[1] < Date.now()) return null;
  if ((await hmac(env, a.slice(0, 3).join('.'))) !== a[3]) return null;
  let email; try { email = unb64u(a[2]); } catch { return null; }
  await ensureAccounts(env);
  return (await env.DB.prepare('SELECT * FROM accounts WHERE email=?').bind(email).first()) || null;
}
// 驗證 Google ID token（用 Google 的 tokeninfo 端點，檢查 aud 與 email_verified）
export async function verifyGoogle(credential, clientId) {
  if (!clientId) throw new Error('尚未設定 Google 登入（管理者需先填用戶端 ID）');
  const r = await fetch('https://oauth2.googleapis.com/tokeninfo?id_token=' + encodeURIComponent(String(credential || '')));
  const j = await r.json().catch(() => ({}));
  if (!r.ok || j.aud !== clientId) throw new Error('Google 登入驗證失敗，請重試');
  if (String(j.email_verified) !== 'true' || !j.email) throw new Error('這個 Google 帳號的 Email 尚未驗證');
  return { email: String(j.email).toLowerCase(), name: String(j.name || j.email.split('@')[0]).slice(0, 30) };
}

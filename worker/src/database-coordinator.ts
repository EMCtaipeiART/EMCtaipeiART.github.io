import { DurableObject } from 'cloudflare:workers';
import { TABLE_SCHEMAS } from '../../backend/schema.mjs';
import {
  VERSION, ACCESS_CAPABILITIES, ACCESS_PAGES, ISSUE_STATUSES, PROJECT_GROUPS, SUPPLEMENT_SLOTS,
  SHORTCUT_ADMIN_ACCOUNT, SHORTCUT_TESTER_ACCOUNT,
  accessProfile, activeReel, canonicalAccount, findReelIndex, generateShortCode,
  hasCapability, isHttpUrl, issueRow, monthFromDate, nextCaseId, normalizeSnapshot,
  nowTaipei, parseComments, publicReel, recalculateDatabaseWeights, reelFileId, requireCapability,
  rowYear, settingsResponse, settingsRow, splitNames, syncSupplementLinks, tableNames,
  text, toApiRow, toSheetRow, unique, updateSettingsRow, weightRules
} from './model';
import { commitGitHubDatabase, loadGitHubDatabase } from './github-store';
import type {
  ApiPayload, ApiResult, DatabaseSnapshot, RequestContext, Row, SessionRecord, StoredSnapshot
} from './types';

const STATE_KEY = 'primary';
const MAX_LOGIN_ATTEMPTS = 12;
const LOGIN_WINDOW_MS = 10 * 60 * 1000;
const LOCAL_PASSWORD_ITERATIONS = 210_000;
const LOCAL_PASSWORD_PREFIX = 'pbkdf2-sha256';
const ADMIN_TABLE_ORDER = ['database', '加權計分標準', '短連結', '補充資料連結', '修改統計表', '設定', '角色權限範本', '帳號權限', 'reels', 'bug_report'];

type MutatorResult = { result: ApiResult; changed?: boolean; changedTables?: string[] };

function cloneDatabase(database: DatabaseSnapshot): DatabaseSnapshot {
  return structuredClone(database);
}

function asRow(value: unknown): Row {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Row : {};
}

function asRows(value: unknown): Row[] {
  return Array.isArray(value) ? value.filter(item => item && typeof item === 'object' && !Array.isArray(item)) as Row[] : [];
}

function normalizedTableRow(headers: string[], value: unknown): Row {
  const source = asRow(value);
  return Object.fromEntries(headers.map(header => [header, text(source[header])])) as Row;
}

function rowsDiffer(headers: string[], left: Row, right: Row): boolean {
  return headers.some(header => text(left[header]) !== text(right[header]));
}

function normalizedAccessList(value: unknown, allowed: string[]): string[] {
  let values: unknown[] = [];
  if (Array.isArray(value)) values = value;
  else {
    const raw = text(value);
    if (raw) {
      try {
        const parsed = JSON.parse(raw);
        values = Array.isArray(parsed) ? parsed : [];
      } catch { values = raw.split(/[\n,，、|｜]/); }
    }
  }
  return unique(values.map(text).filter(item => allowed.includes(item)));
}

function sessionToken(payload: ApiPayload): string {
  return text(payload.editorToken || payload.token);
}
/** 台北時區的當日 MMDD，作為管理者捷徑密碼；每天自動失效。 */
function taipeiMonthDay(now = new Date()): string {
  const parts = Object.fromEntries(new Intl.DateTimeFormat('en-US', { timeZone: 'Asia/Taipei', month: '2-digit', day: '2-digit' })
    .formatToParts(now).map(part => [part.type, part.value]));
  return `${parts.month}${parts.day}`;
}
/**
 * 測試捷徑登入：密碼 test → 測試使用者、當日 MMDD → 管理員。
 * 這是刻意保留的弱密碼入口，僅對應這兩個帳號，其餘帳號一律走 ADMIN_LOGIN_ACCOUNTS + ADMIN_LOGIN_PASSWORD。
 */
function shortcutLoginAccount(password: string, now = new Date()): string {
  const value = text(password);
  if (!value) return '';
  if (value === 'test') return SHORTCUT_TESTER_ACCOUNT;
  if (value === taipeiMonthDay(now)) return SHORTCUT_ADMIN_ACCOUNT;
  return '';
}

function commitMessage(action: string, session: SessionRecord | null): string {
  const actor = text(session?.user || session?.account || 'anonymous');
  return `data: ${action} via Cloudflare Worker (${actor})`;
}

async function sha256Base64Url(value: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value));
  const bytes = new Uint8Array(digest);
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
}

function randomToken(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(32));
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return `${crypto.randomUUID()}.${btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '')}`;
}

async function secureEqual(actual: string, expected: string): Promise<boolean> {
  const [left, right] = await Promise.all([
    crypto.subtle.digest('SHA-256', new TextEncoder().encode(actual)),
    crypto.subtle.digest('SHA-256', new TextEncoder().encode(expected))
  ]);
  const subtle = crypto.subtle as SubtleCrypto & {
    timingSafeEqual(a: ArrayBuffer | ArrayBufferView, b: ArrayBuffer | ArrayBufferView): boolean;
  };
  return subtle.timingSafeEqual(left, right);
}

function bytesToBase64Url(bytes: Uint8Array): string {
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
}

function base64UrlToBytes(value: string): Uint8Array<ArrayBuffer> {
  const padded = value.replace(/-/g, '+').replace(/_/g, '/').padEnd(Math.ceil(value.length / 4) * 4, '=');
  const binary = atob(padded);
  return Uint8Array.from(binary, character => character.charCodeAt(0));
}

async function deriveLocalPassword(password: string, salt: Uint8Array<ArrayBuffer>, iterations = LOCAL_PASSWORD_ITERATIONS): Promise<Uint8Array<ArrayBuffer>> {
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(password), 'PBKDF2', false, ['deriveBits']);
  const bits = await crypto.subtle.deriveBits({ name: 'PBKDF2', hash: 'SHA-256', salt, iterations }, key, 256);
  return new Uint8Array(bits);
}

async function hashLocalPassword(password: string): Promise<string> {
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const derived = await deriveLocalPassword(password, salt);
  return `${LOCAL_PASSWORD_PREFIX}$${LOCAL_PASSWORD_ITERATIONS}$${bytesToBase64Url(salt)}$${bytesToBase64Url(derived)}`;
}

async function verifyLocalPassword(password: string, encoded: unknown): Promise<boolean> {
  const [prefix, iterationText, saltText, expectedText, ...extra] = text(encoded).split('$');
  const iterations = Number(iterationText);
  if (prefix !== LOCAL_PASSWORD_PREFIX || extra.length || !Number.isInteger(iterations) || iterations < 100_000 || iterations > 1_000_000 || !saltText || !expectedText) return false;
  try {
    const expected = base64UrlToBytes(expectedText);
    const actual = await deriveLocalPassword(password, base64UrlToBytes(saltText), iterations);
    if (actual.byteLength !== expected.byteLength) return false;
    const subtle = crypto.subtle as SubtleCrypto & {
      timingSafeEqual(a: ArrayBuffer | ArrayBufferView, b: ArrayBuffer | ArrayBufferView): boolean;
    };
    return subtle.timingSafeEqual(actual, expected);
  } catch { return false; }
}

function isReservedShortcutPassword(password: string): boolean {
  return password === 'test' || /^\d{4}$/.test(password);
}

function parseCommentList(value: unknown): Row[] {
  return parseComments(value).map(item => ({ ...item }));
}

function parseCaseDesignImages_(row: Row): { fileName: string; url: string }[] {
  try {
    const parsed = JSON.parse(text(row['圖片連結']) || '[]');
    if (!Array.isArray(parsed)) return [];
    return parsed
      .map(item => (item && typeof item === 'object' && !Array.isArray(item))
        ? { fileName: text((item as Row).fileName), url: text((item as Row).url) }
        : { fileName: '', url: text(item) })
      .filter(item => isHttpUrl(item.url));
  } catch { return []; }
}

export class DatabaseCoordinator extends DurableObject<Env> {
  private writeTail: Promise<void> = Promise.resolve();

  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
    ctx.blockConcurrencyWhile(async () => {
      this.ctx.storage.sql.exec(`
        CREATE TABLE IF NOT EXISTS _sql_schema_migrations (
          version INTEGER PRIMARY KEY,
          applied_at TEXT NOT NULL
        );
      `);
      const applied = new Set(this.ctx.storage.sql.exec<{ version: number }>(
        'SELECT version FROM _sql_schema_migrations'
      ).toArray().map(row => Number(row.version)));
      if (!applied.has(1)) {
        this.ctx.storage.transactionSync(() => {
          this.ctx.storage.sql.exec(`
            CREATE TABLE IF NOT EXISTS database_state (
              id TEXT PRIMARY KEY,
              json TEXT NOT NULL,
              github_sha TEXT NOT NULL,
              updated_at TEXT NOT NULL
            );
            CREATE TABLE IF NOT EXISTS sessions (
              token_hash TEXT PRIMARY KEY,
              payload TEXT NOT NULL,
              expires_at INTEGER NOT NULL
            );
            CREATE INDEX IF NOT EXISTS sessions_expiry_idx ON sessions(expires_at);
            CREATE TABLE IF NOT EXISTS login_attempts (
              identity_hash TEXT PRIMARY KEY,
              attempts INTEGER NOT NULL,
              window_started_at INTEGER NOT NULL
            );
          `);
          this.ctx.storage.sql.exec(
            'INSERT INTO _sql_schema_migrations(version, applied_at) VALUES (?, ?)',
            1, new Date().toISOString()
          );
        });
      }
    });
  }

  private async serialized<T>(work: () => Promise<T>): Promise<T> {
    const previous = this.writeTail;
    let release!: () => void;
    this.writeTail = new Promise<void>(resolve => { release = resolve; });
    await previous;
    try { return await work(); } finally { release(); }
  }

  private storedSnapshot(): StoredSnapshot | null {
    const rows = this.ctx.storage.sql.exec<{ json: string; github_sha: string }>(
      'SELECT json, github_sha FROM database_state WHERE id = ?', STATE_KEY
    ).toArray();
    if (!rows.length) return null;
    return { database: normalizeSnapshot(JSON.parse(rows[0].json)), sha: rows[0].github_sha };
  }

  private persistSnapshot(stored: StoredSnapshot): void {
    const database = normalizeSnapshot(stored.database);
    this.ctx.storage.sql.exec(
      `INSERT INTO database_state(id, json, github_sha, updated_at)
       VALUES (?, ?, ?, ?)
       ON CONFLICT(id) DO UPDATE SET json=excluded.json, github_sha=excluded.github_sha, updated_at=excluded.updated_at`,
      STATE_KEY, JSON.stringify(database), stored.sha, new Date().toISOString()
    );
  }

  private async snapshot(force = false): Promise<StoredSnapshot> {
    if (!force) {
      const stored = this.storedSnapshot();
      if (stored) return stored;
    }
    return this.serialized(async () => {
      if (!force) {
        const stored = this.storedSnapshot();
        if (stored) return stored;
      }
      const latest = await loadGitHubDatabase(this.env);
      this.persistSnapshot(latest);
      return latest;
    });
  }

  private async sessionFor(payload: ApiPayload): Promise<SessionRecord | null> {
    const token = sessionToken(payload);
    if (!token) return null;
    const tokenHash = await sha256Base64Url(token);
    const rows = this.ctx.storage.sql.exec<{ payload: string; expires_at: number }>(
      'SELECT payload, expires_at FROM sessions WHERE token_hash = ?', tokenHash
    ).toArray();
    if (!rows.length) return null;
    if (Number(rows[0].expires_at) <= Date.now()) {
      this.ctx.storage.sql.exec('DELETE FROM sessions WHERE token_hash = ?', tokenHash);
      return null;
    }
    try { return JSON.parse(rows[0].payload) as SessionRecord; } catch {
      this.ctx.storage.sql.exec('DELETE FROM sessions WHERE token_hash = ?', tokenHash);
      return null;
    }
  }

  private async createSession(session: Omit<SessionRecord, 'expiresAt'>): Promise<{ token: string; session: SessionRecord; expiresIn: number }> {
    const ttl = Math.min(30 * 24 * 60 * 60, Math.max(15 * 60, Number(this.env.SESSION_TTL_SECONDS) || 30 * 24 * 60 * 60));
    const token = randomToken();
    const tokenHash = await sha256Base64Url(token);
    const record: SessionRecord = { ...session, expiresAt: Date.now() + ttl * 1000 };
    this.ctx.storage.sql.exec(
      'INSERT INTO sessions(token_hash, payload, expires_at) VALUES (?, ?, ?)',
      tokenHash, JSON.stringify(record), record.expiresAt
    );
    this.ctx.storage.sql.exec('DELETE FROM sessions WHERE expires_at <= ?', Date.now());
    return { token, session: record, expiresIn: ttl };
  }

  private async deleteSession(payload: ApiPayload): Promise<void> {
    const token = sessionToken(payload);
    if (!token) return;
    this.ctx.storage.sql.exec('DELETE FROM sessions WHERE token_hash = ?', await sha256Base64Url(token));
  }

  private async assertLoginRate(context: RequestContext): Promise<void> {
    const identityHash = await sha256Base64Url(`${context.ip}|${context.userAgent.slice(0, 120)}`);
    const rows = this.ctx.storage.sql.exec<{ attempts: number; window_started_at: number }>(
      'SELECT attempts, window_started_at FROM login_attempts WHERE identity_hash = ?', identityHash
    ).toArray();
    const now = Date.now();
    if (!rows.length || now - Number(rows[0].window_started_at) >= LOGIN_WINDOW_MS) {
      this.ctx.storage.sql.exec(
        `INSERT INTO login_attempts(identity_hash, attempts, window_started_at) VALUES (?, 1, ?)
         ON CONFLICT(identity_hash) DO UPDATE SET attempts=1, window_started_at=excluded.window_started_at`,
        identityHash, now
      );
      return;
    }
    const attempts = Number(rows[0].attempts) + 1;
    this.ctx.storage.sql.exec('UPDATE login_attempts SET attempts=? WHERE identity_hash=?', attempts, identityHash);
    if (attempts > MAX_LOGIN_ATTEMPTS) throw new Error('登入嘗試次數過多，請稍後再試');
  }

  private async mutate(
    action: string,
    session: SessionRecord | null,
    mutator: (draft: DatabaseSnapshot) => MutatorResult | Promise<MutatorResult>
  ): Promise<ApiResult> {
    return this.serialized(async () => {
      let stored = this.storedSnapshot();
      if (!stored) {
        stored = await loadGitHubDatabase(this.env);
        this.persistSnapshot(stored);
      }
      for (let attempt = 0; attempt < 2; attempt += 1) {
        const draft = cloneDatabase(stored.database);
        const outcome = await mutator(draft);
        if (outcome.changed === false) return { ...outcome.result, jsonRevision: draft.revision, revision: draft.revision, unchanged: true };
        draft.revision = Math.max(0, Number(draft.revision) || 0) + 1;
        draft.updatedAt = new Date().toISOString();
        draft.internal.sessions = {};
        try {
          const committed = await commitGitHubDatabase(this.env, draft, stored.sha, commitMessage(action, session));
          this.persistSnapshot({ database: committed.database, sha: committed.sha });
          return {
            ...outcome.result,
            storage: 'cloudflare-worker-github-json',
            jsonRevision: draft.revision,
            revision: draft.revision,
            githubCommitSha: committed.commitSha,
            changedTables: outcome.changedTables || []
          };
        } catch (error) {
          if (Number((error as { status?: number }).status) !== 409 || attempt > 0) throw error;
          stored = await loadGitHubDatabase(this.env);
          this.persistSnapshot(stored);
        }
      }
      throw new Error('JSON 寫入發生版本衝突，請重新整理後再試');
    });
  }

  private requireSession(session: SessionRecord | null): SessionRecord {
    if (!session) throw new Error('請先登入後再執行此操作');
    return session;
  }

  private requireAccess(database: DatabaseSnapshot, session: SessionRecord | null, capability: string): SessionRecord {
    return requireCapability(database, session, capability) as SessionRecord;
  }

  private requireAnyAccess(database: DatabaseSnapshot, session: SessionRecord | null, capabilities: string[]): SessionRecord {
    const current = this.requireSession(session);
    if (capabilities.some(capability => hasCapability(database, current, capability))) return current;
    throw new Error(`此帳號沒有「${capabilities.join('／')}」權限`);
  }

  private async googleLogin(payload: ApiPayload, context: RequestContext): Promise<ApiResult> {
    await this.assertLoginRate(context);
    const credential = text(payload.credential || payload.idToken);
    if (!credential) return { ok: false, action: 'googleLogin', error: '缺少 Google credential' };
    const response = await fetch(`https://oauth2.googleapis.com/tokeninfo?id_token=${encodeURIComponent(credential)}`, {
      headers: { Accept: 'application/json' }
    });
    if (!response.ok) return { ok: false, action: 'googleLogin', error: 'Google token 驗證失敗', reason: 'TOKENINFO_FAILED' };
    const profile = await response.json() as Row;
    if (text(profile.aud) !== this.env.GOOGLE_OAUTH_CLIENT_ID) return { ok: false, action: 'googleLogin', error: 'Google OAuth client_id 不符合', reason: 'CLIENT_ID_MISMATCH' };
    if (!['true', '1'].includes(text(profile.email_verified).toLowerCase())) return { ok: false, action: 'googleLogin', error: 'Google 信箱尚未通過驗證', reason: 'EMAIL_NOT_VERIFIED' };
    if (Number(profile.exp) * 1000 <= Date.now()) return { ok: false, action: 'googleLogin', error: 'Google 登入憑證已過期', reason: 'TOKEN_EXPIRED' };
    const account = canonicalAccount(profile.email);
    if (!account.endsWith('@emctaipei.com')) return { ok: false, action: 'googleLogin', error: '請使用 @emctaipei.com 公司信箱登入', reason: 'DOMAIN_NOT_ALLOWED' };
    const { database } = await this.snapshot();
    const row = settingsRow(database, account);
    if (!row) return { ok: false, action: 'googleLogin', error: '此帳號尚未加入 JSON 資料庫「設定」，請聯絡管理者新增人員', reason: 'JSON_USER_NOT_REGISTERED' };
    const user = text(row['名字'] || profile.name || account.split('@')[0]);
    const issued = await this.createSession({ user, account, provider: 'google' });
    return {
      ok: true, action: 'googleLogin', provider: 'google', user, account, email: account,
      token: issued.token, expiresIn: issued.expiresIn, settings: settingsResponse(row),
      access: accessProfile(database, issued.session),
      loginDebug: { account, user, aud: text(profile.aud), expiresIn: issued.expiresIn, workerVersion: VERSION }
    };
  }

  private async passwordLogin(payload: ApiPayload, context: RequestContext): Promise<ApiResult> {
    await this.assertLoginRate(context);
    const password = text(payload.password);
    if (!password) return { ok: false, action: 'login', error: '帳號或密碼不正確' };
    const shortcut = shortcutLoginAccount(password);
    const requestedAccount = canonicalAccount(payload.account || payload.user);
    const { database } = await this.snapshot();
    let account = shortcut;
    if (!account) {
      const allowed = this.env.ADMIN_LOGIN_ACCOUNTS.split(',').map(canonicalAccount).includes(requestedAccount);
      if (allowed && await secureEqual(password, this.env.ADMIN_LOGIN_PASSWORD)) account = requestedAccount;
    }
    if (!account) {
      const passwordRows = database.tables['帳號權限'].rows.filter(row => text(row['登入方式']) === '密碼' && text(row['密碼雜湊']));
      for (const permissionRow of passwordRows) {
        if (!await verifyLocalPassword(password, permissionRow['密碼雜湊'])) continue;
        if (text(permissionRow['狀態']) === '停用') return { ok: false, action: 'login', error: '帳號已停用', reason: 'ACCOUNT_DISABLED' };
        account = canonicalAccount(permissionRow['帳號']);
        break;
      }
    }
    if (!account) return { ok: false, action: 'login', error: '帳號或密碼不正確' };
    const row = settingsRow(database, account);
    if (!row) return { ok: false, action: 'login', error: '帳號或密碼不正確' };
    const user = text(row['名字'] || account.split('@')[0]);
    const issued = await this.createSession({ user, account, provider: 'password' });
    return { ok: true, action: 'login', provider: 'password', user, account, email: account.includes('@') ? account : '', token: issued.token, expiresIn: issued.expiresIn, settings: settingsResponse(row), access: accessProfile(database, issued.session) };
  }

  private async erpLogin(payload: ApiPayload, context: RequestContext): Promise<ApiResult> {
    await this.assertLoginRate(context);
    const code = text(payload.code);
    const codeVerifier = text(payload.codeVerifier || payload.code_verifier);
    const redirectUri = text(payload.redirectUri || payload.redirect_uri || this.env.ERP_REDIRECT_URI);
    if (!code) return { ok: false, action: 'erpLogin', error: '缺少 ERP 授權碼', reason: 'ERP_CODE_MISSING' };
    if (!codeVerifier) return { ok: false, action: 'erpLogin', error: '缺少 ERP PKCE verifier', reason: 'ERP_VERIFIER_MISSING' };
    if (redirectUri !== this.env.ERP_REDIRECT_URI) return { ok: false, action: 'erpLogin', error: 'ERP redirect_uri 與後端設定不一致', reason: 'ERP_REDIRECT_URI_MISMATCH' };
    const tokenResponse = await fetch(`${this.env.ERP_BASE_URL.replace(/\/+$/, '')}/api/oauth/token`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded', Accept: 'application/json' },
      body: new URLSearchParams({
        grant_type: 'authorization_code', code, redirect_uri: this.env.ERP_REDIRECT_URI,
        client_id: this.env.ERP_CLIENT_ID, client_secret: this.env.ERP_CLIENT_SECRET, code_verifier: codeVerifier
      })
    });
    const tokenData = await tokenResponse.json().catch(() => ({})) as Row;
    if (!tokenResponse.ok || !text(tokenData.access_token)) return { ok: false, action: 'erpLogin', error: text(tokenData.error_description || tokenData.error) || `ERP token 換取失敗：${tokenResponse.status}`, reason: text(tokenData.error) || 'ERP_TOKEN_FAILED', status: tokenResponse.status };
    const profileResponse = await fetch(`${this.env.ERP_BASE_URL.replace(/\/+$/, '')}/api/oauth/userinfo`, {
      headers: { Authorization: `Bearer ${text(tokenData.access_token)}`, Accept: 'application/json' }
    });
    const profile = await profileResponse.json().catch(() => ({})) as Row;
    if (!profileResponse.ok || profile.is_active === false) return { ok: false, action: 'erpLogin', error: text(profile.error_description || profile.error) || 'ERP 帳號已停用或無效', reason: 'ERP_ACCOUNT_INACTIVE' };
    const account = canonicalAccount(profile.email);
    if (!account.endsWith('@emctaipei.com')) return { ok: false, action: 'erpLogin', error: '請使用 @emctaipei.com 公司帳號登入', reason: 'DOMAIN_NOT_ALLOWED' };
    let stored = await this.snapshot();
    let row = settingsRow(stored.database, account);
    if (!row) {
      const created = await this.mutate('erp-login-register', null, draft => {
        const newRow = Object.fromEntries(TABLE_SCHEMAS['設定'].headers.map((header: string) => [header, ''])) as Row;
        newRow['帳號'] = account;
        newRow['名字'] = text(profile.name || profile.name_en) || account.split('@')[0];
        newRow['顯示名'] = newRow['名字'];
        newRow['部門'] = text(profile.department);
        draft.tables['設定'].rows.push(newRow);
        return { result: { ok: true, action: 'erp-login-register' }, changedTables: ['設定'] };
      });
      stored = await this.snapshot();
      row = settingsRow(stored.database, account);
      if (!created.ok || !row) throw new Error('ERP 帳號建立失敗');
    }
    const user = text(row['名字'] || profile.name || profile.name_en || account.split('@')[0]);
    const issued = await this.createSession({
      user, account, provider: 'erp', department: text(profile.department), role: text(profile.role), erpEmployeeId: text(profile.employee_id)
    });
    return {
      ok: true, action: 'erpLogin', provider: 'erp', user, account, email: account,
      token: issued.token, expiresIn: issued.expiresIn, settings: settingsResponse(row), access: accessProfile(stored.database, issued.session),
      erpProfile: {
        employee_id: text(profile.employee_id), name: text(profile.name), name_en: text(profile.name_en), email: account,
        role: text(profile.role), department: text(profile.department), rank: text(profile.rank), title: text(profile.title),
        is_active: profile.is_active !== false, is_pm: Boolean(profile.is_pm)
      }
    };
  }

  async handle(actionValue: string, payload: ApiPayload = {}, context: RequestContext): Promise<ApiResult> {
    const action = text(actionValue || payload.action || 'list');
    try {
      if (action === 'googleLogin') return await this.googleLogin(payload, context);
      if (action === 'login') return await this.passwordLogin(payload, context);
      if (action === 'erpLogin') return await this.erpLogin(payload, context);
      if (action === 'erpLoginConfig') return { ok: true, action, baseUrl: this.env.ERP_BASE_URL, clientId: this.env.ERP_CLIENT_ID, redirectUri: this.env.ERP_REDIRECT_URI, scope: 'openid profile' };

      const stored = await this.snapshot(action === 'refreshDatabase');
      const database = stored.database;
      const session = await this.sessionFor(payload);
      const baseUrl = text(payload.supplementBaseUrl) || context.baseUrl;

      if (action === 'ping') return { ok: true, action, version: VERSION, storage: 'cloudflare-worker-github-json', revision: database.revision, message: 'connected' };
      if (action === 'diagnose') return { ok: true, action, version: VERSION, storage: 'cloudflare-worker-github-json', revision: database.revision, tables: Object.fromEntries(tableNames().map(name => [name, database.tables[name].rows.length])) };
      if (action === 'urlFetchAuthCheck') return { ok: true, action, status: 200, message: 'Cloudflare Worker fetch 可執行', version: VERSION };
      if (action === 'writeAccessCheck') return { ok: true, action, checkedAt: new Date().toISOString(), nonMutating: true, permissions: { createRequest: true, updateRequest: true, updateStatusDetails: Boolean(session), reason: 'Cloudflare Worker 已連線；狀態與細節依登入權限判斷' }, checks: { databaseWritable: Boolean(this.env.GITHUB_TOKEN) } };
      if (action === 'refreshDatabase') { this.requireAccess(database, session, 'database.manage'); return { ok: true, action, revision: database.revision, refreshed: true }; }
      if (action === 'verifyToken') {
        if (!session) return { ok: false, action, error: 'TOKEN_EXPIRED' };
        const access = accessProfile(database, session);
        if (access.status === '停用') return { ok: false, action, error: '帳號已停用', reason: 'ACCOUNT_DISABLED' };
        return { ok: true, action, user: session.user, account: session.account, email: session.account, expiresIn: Math.max(0, Math.floor((session.expiresAt - Date.now()) / 1000)), settings: settingsResponse(settingsRow(database, session.account || session.user) || {}), access };
      }
      if (action === 'getAccessProfile') { this.requireSession(session); return { ok: true, action, access: accessProfile(database, session) }; }
      if (action === 'logout') { await this.deleteSession(payload); return { ok: true, action }; }

      if (action === 'list' || action === 'recent') {
        const year = text(payload.year);
        let indexed = database.tables.database.rows.map((row, index) => ({ row, index })).filter(item => !year || rowYear(item.row) === year);
        if (action === 'recent') indexed = indexed.sort((a, b) => text(b.row['案件編號']).localeCompare(text(a.row['案件編號']))).slice(0, Math.min(200, Math.max(1, Number(payload.limit) || 30)));
        return { ok: true, action, rows: indexed.map(item => toApiRow(item.row, item.index)), revision: database.revision };
      }
      if (action === 'bundle' || action === 'statsData') {
        const year = text(payload.year);
        const rows = database.tables.database.rows.filter(row => !year || rowYear(row) === year);
        return { ok: true, action: 'bundle', version: VERSION, rows: rows.map((row, index) => toApiRow(row, index)), databaseRows: rows, weights: database.tables['加權計分標準'].rows, stages: [], revision: database.revision };
      }
      if (action === 'createRequestStatus') return { ok: true, action, pending: !database.internal.idempotency[text(payload.requestId)], result: database.internal.idempotency[text(payload.requestId)] || null };
      if (action === 'resolveSupplementLink') {
        const id = text(payload.id || payload.caseId), slot = text(payload.slot).toLowerCase();
        if (!/^\d{8}$/.test(id) || !SUPPLEMENT_SLOTS[slot]) throw new Error('補充資料連結格式錯誤');
        const record = database.tables['補充資料連結'].rows.find(row => text(row['案件編號']) === id);
        const url = text(record?.[SUPPLEMENT_SLOTS[slot].column]);
        if (!isHttpUrl(url)) throw new Error('找不到可用的補充資料連結');
        return { ok: true, action, id, slot, url };
      }
      if (action === 'resolveShortLink') {
        const code = text(payload.code);
        const record = database.tables['短連結'].rows.find(row => text(row['短碼']) === code);
        if (!record || !isHttpUrl(record['原始網址'])) throw new Error('找不到這個短連結');
        return { ok: true, action, code, url: record['原始網址'] };
      }

      if (action === 'getUserSettings') {
        const current = this.requireSession(session);
        const account = canonicalAccount(payload.account || current.account);
        if (account !== canonicalAccount(current.account) && !hasCapability(database, current, 'database.manage')) throw new Error('不可讀取其他帳號的個人設定');
        return { ok: true, action, account, settings: settingsResponse(settingsRow(database, account || current.user) || {}) };
      }
      if (action === 'listDesignerProfiles') {
        const profiles = database.tables['設定'].rows.filter(row => text(row['名字'])).map(row => ({
          name: text(row['名字']), account: canonicalAccount(row['帳號']), avatar: text(row['頭像連結']),
          poster: text(row['頭像大圖連結'] || row['頭像連結']), musicUrl: text(row['分享音樂']),
          musicStartAt: Math.max(0, Number(row['音樂起始秒數']) || 0), skills: splitNames(row['技能']),
          quote: text(row['對話框']), rotation: Number(row['新專案輪值']) || 99,
          designType: /影音|影像|影片/i.test(text(row['組別'])) ? '影音' : (/平面/.test(text(row['組別'])) ? '平面' : '')
        }));
        return { ok: true, action, profiles };
      }
      if (action === 'listReels') {
        const stories = database.tables.reels.rows.map((row, index) => ({ row, index })).filter(item => activeReel(item.row)).map(item => publicReel(item.row, item.index));
        return { ok: true, action, stories, reels: stories };
      }
      if (action === 'listIssueReports') return { ok: true, action, reports: database.tables.bug_report.rows.map(issueRow).reverse() };
      if (action === 'listModificationRecords') {
        const ids = Array.isArray(payload.ids) && payload.ids.length ? new Set(payload.ids.map(text)) : null;
        const rows = database.tables['修改統計表'].rows.map<Row>((row, index) => ({ rowNumber: index + 2, ...row })).filter(row => !ids || ids.has(text(row['案件編號'])));
        return { ok: true, action, rows };
      }

      if (action === 'adminTables') {
        this.requireAccess(database, session, 'database.manage');
        const tables = Object.fromEntries(ADMIN_TABLE_ORDER.filter(name => database.tables[name]).map(name => [name, {
          headers: database.tables[name].headers, primaryKey: database.tables[name].primaryKey || '', rowCount: database.tables[name].rows.length
        }]));
        return { ok: true, action, revision: database.revision, updatedAt: database.updatedAt, source: 'cloudflare-worker-github-json', tables };
      }
      if (action === 'adminTableRows') {
        this.requireAccess(database, session, 'database.manage');
        return this.adminTableRows(database, payload);
      }

      return await this.handleWriteAction(action, payload, context, database, session, baseUrl);
    } catch (error) {
      console.error(JSON.stringify({ event: 'api-error', action, message: error instanceof Error ? error.message : String(error) }));
      return { ok: false, action, error: error instanceof Error ? error.message : String(error) };
    }
  }

  private adminTableRows(database: DatabaseSnapshot, payload: ApiPayload): ApiResult {
    const tableName = text(payload.table);
    const table = database.tables[tableName];
    if (!table) throw new Error(`未知資料表：${tableName}`);
    const offset = Math.max(0, Number(payload.offset) || 0);
    const limit = Math.min(100000, Math.max(1, Number(payload.limit) || 100));
    const query = text(payload.q).toLocaleLowerCase();
    const sort = text(payload.sort);
    const order = text(payload.order).toLowerCase() === 'desc' ? -1 : 1;
    let rows = table.rows.map<Row>((row, index) => ({ _rowNumber: index + 2, ...row }));
    if (query) rows = rows.filter(row => Object.values(row).some(value => text(value).toLocaleLowerCase().includes(query)));
    if (sort) rows.sort((left, right) => text(left[sort]).localeCompare(text(right[sort]), 'zh-Hant', { numeric: true }) * order);
    return { ok: true, action: 'adminTableRows', table: tableName, revision: database.revision, offset, limit, total: rows.length, rows: rows.slice(offset, offset + limit) };
  }

  private async handleWriteAction(
    action: string,
    payload: ApiPayload,
    context: RequestContext,
    database: DatabaseSnapshot,
    session: SessionRecord | null,
    baseUrl: string
  ): Promise<ApiResult> {
    if (action === 'createShortLink') {
      if (session) this.requireAccess(database, session, 'short_link.create');
      const url = text(payload.url);
      if (!isHttpUrl(url) || url.length > 2048) throw new Error('請輸入有效的 http 或 https 網址');
      return this.mutate(action, session, draft => {
        const code = generateShortCode(new Set(draft.tables['短連結'].rows.map(row => text(row['短碼']))));
        draft.tables['短連結'].rows.push({ '短碼': code, '原始網址': url, '建立時間': nowTaipei() });
        return { result: { ok: true, action, code, url }, changedTables: ['短連結'] };
      });
    }
    if (action === 'saveUserSettings') {
      const current = this.requireAccess(database, session, 'profile.edit');
      const account = canonicalAccount(payload.account || current.account);
      if (account !== canonicalAccount(current.account) && !hasCapability(database, current, 'database.manage')) throw new Error('不可修改其他帳號的個人設定');
      return this.mutate(action, current, draft => {
        const row = settingsRow(draft, account || current.user);
        if (!row) throw new Error('找不到個人設定資料');
        updateSettingsRow(row, asRow(payload.settings));
        return { result: { ok: true, action, account, settings: settingsResponse(row) }, changedTables: ['設定'] };
      });
    }
    if (action === 'saveDesignerProfiles') {
      const current = this.requireAnyAccess(database, session, ['designer.settings', 'media.manage']);
      return this.mutate(action, current, draft => {
        for (const profile of asRows(payload.profiles)) {
          const row = draft.tables['設定'].rows.find(item => text(item['名字']) === text(profile.name));
          if (!row) continue;
          if ('avatar' in profile) row['頭像連結'] = text(profile.avatar);
          if ('poster' in profile) row['頭像大圖連結'] = text(profile.poster);
          if ('musicUrl' in profile) row['分享音樂'] = text(profile.musicUrl);
          if ('musicStartAt' in profile) row['音樂起始秒數'] = String(Math.max(0, Number(profile.musicStartAt) || 0));
          if ('skills' in profile) row['技能'] = (Array.isArray(profile.skills) ? profile.skills.map(text) : splitNames(profile.skills)).join(' , ');
          if ('quote' in profile) row['對話框'] = text(profile.quote);
        }
        return { result: { ok: true, action }, changedTables: ['設定'] };
      });
    }
    if (action === 'toggleReelReaction') {
      const current = this.requireAccess(database, session, 'reel.interact');
      return this.mutate(action, current, draft => {
        const index = findReelIndex(draft.tables.reels.rows, payload);
        if (index < 0) throw new Error('找不到限時動態');
        const row = draft.tables.reels.rows[index];
        const reaction = text(payload.reaction || payload.type).toLowerCase();
        const userName = text(current.user || current.account.split('@')[0]);
        const likes = splitNames(row['按讚']), dislikes = splitNames(row['倒讚']);
        const target = reaction === 'dislike' ? dislikes : likes, other = reaction === 'dislike' ? likes : dislikes;
        const targetIndex = target.indexOf(userName);
        if (targetIndex >= 0) target.splice(targetIndex, 1); else target.push(userName);
        const otherIndex = other.indexOf(userName); if (otherIndex >= 0) other.splice(otherIndex, 1);
        row['按讚'] = unique(likes).join(' , '); row['倒讚'] = unique(dislikes).join(' , ');
        return { result: { ok: true, action, story: publicReel(row, index) }, changedTables: ['reels'] };
      });
    }
    if (action === 'addReelComment') {
      const current = this.requireAccess(database, session, 'reel.interact');
      const commentText = text(payload.comment || payload.text);
      if (!commentText || commentText.length > 300) throw new Error('留言必須為 1–300 字');
      return this.mutate(action, current, draft => {
        const index = findReelIndex(draft.tables.reels.rows, payload);
        if (index < 0) throw new Error('找不到限時動態');
        const row = draft.tables.reels.rows[index];
        const userRow = settingsRow(draft, current.account || current.user);
        const comments = parseCommentList(row['留言']);
        comments.push({ id: crypto.randomUUID(), name: current.user, account: current.account, avatar: text(userRow?.['頭像連結']), text: commentText, createdAt: new Date().toISOString() });
        row['留言'] = JSON.stringify(comments);
        return { result: { ok: true, action, story: publicReel(row, index) }, changedTables: ['reels'] };
      });
    }
    if (action === 'upsertDesignerStories') {
      const current = this.requireAccess(database, session, 'media.manage');
      const name = text(payload.name || payload.designer);
      if (![...PROJECT_GROUPS['平面'].designers, ...PROJECT_GROUPS['影音'].designers].includes(name)) throw new Error('找不到設計師');
      const fileIds = Array.isArray(payload.fileIds) ? payload.fileIds.map(text) : [];
      const imageUrls = Array.isArray(payload.imageUrls) ? payload.imageUrls.map(text) : [];
      const expiresAtMs = Math.max(0, Number(payload.expiresAt) || 0);
      if (!imageUrls.length || imageUrls.some(url => !isHttpUrl(url))) throw new Error('沒有可同步的限時動態');
      return this.mutate(action, current, draft => {
        const rows = draft.tables.reels.rows;
        const synced = imageUrls.map((url, index) => {
          const fileId = fileIds[index] || reelFileId(url);
          let row = rows.find(item => (fileId && reelFileId(item['限時動態連結']) === fileId) || text(item['限時動態連結']) === url);
          if (!row) { row = {}; rows.push(row); }
          Object.assign(row, {
            '名字': name,
            '限時動態連結': url,
            '保留期限': expiresAtMs ? '24小時' : '永久',
            '到期時間': expiresAtMs ? new Date(expiresAtMs).toISOString() : '',
            '按讚': row['按讚'] || '',
            '倒讚': row['倒讚'] || '',
            '留言': row['留言'] || '[]'
          });
          return publicReel(row, rows.indexOf(row));
        });
        return { result: { ok: true, action, designer: name, count: synced.length, reels: synced }, changedTables: ['reels'] };
      });
    }
    if (action === 'deleteDesignerStories') {
      const current = this.requireAccess(database, session, 'media.manage');
      const name = text(payload.name || payload.designer);
      const ids = new Set((Array.isArray(payload.fileIds) ? payload.fileIds : []).map(text).filter(Boolean));
      if (!name || !ids.size) throw new Error('缺少設計師或限時動態檔案');
      return this.mutate(action, current, draft => {
        const before = draft.tables.reels.rows.length;
        draft.tables.reels.rows = draft.tables.reels.rows.filter(row => !(text(row['名字']) === name && ids.has(reelFileId(row['限時動態連結']))));
        return { result: { ok: true, action, designer: name, deleted: before - draft.tables.reels.rows.length }, changedTables: ['reels'] };
      });
    }
    if (action === 'deleteDesignerMediaFiles') {
      const current = this.requireAccess(database, session, 'media.manage');
      const name = text(payload.name || payload.designer);
      const ids = new Set((Array.isArray(payload.fileIds) ? payload.fileIds : []).map(text).filter(Boolean));
      if (!name || !ids.size) throw new Error('缺少設計師或圖片檔案');
      return this.mutate(action, current, draft => {
        const profile = draft.tables['設定'].rows.find(row => text(row['名字']) === name);
        if (!profile) throw new Error('找不到設計師設定');
        const cleared: string[] = [];
        const mediaFields: Array<[string, string]> = [
          ['avatar', '頭像連結'],
          ['poster', '頭像大圖連結']
        ];
        for (const [kind, header] of mediaFields) {
          const value = text(profile[header]);
          if (value && [...ids].some(id => value.includes(id))) {
            profile[header] = '';
            cleared.push(kind);
          }
        }
        const before = draft.tables.reels.rows.length;
        draft.tables.reels.rows = draft.tables.reels.rows.filter(row => !(
          text(row['名字']) === name && ids.has(reelFileId(row['限時動態連結']))
        ));
        const deletedStories = before - draft.tables.reels.rows.length;
        const changedTables = [
          ...(cleared.length ? ['設定'] : []),
          ...(deletedStories ? ['reels'] : [])
        ];
        return {
          result: { ok: true, action, designer: name, fileIds: [...ids], cleared, deletedStories },
          changed: changedTables.length > 0,
          changedTables
        };
      });
    }
    if (action === 'reportIssue') {
      if (session) this.requireAccess(database, session, 'issue.report');
      const report = asRow(payload.report || payload.row || payload.data || payload);
      const content = text(report.content || report['內容']), suggestion = text(report.suggestion || report['修改建議']);
      if (!content || content.length > 300 || suggestion.length > 300) throw new Error('問題內容必填，內容與修改建議不得超過 300 字');
      return this.mutate(action, session, draft => {
        const time = nowTaipei();
        const row = Object.fromEntries(TABLE_SCHEMAS.bug_report.headers.map((header: string) => [header, ''])) as Row;
        Object.assign(row, { '姓名': text(session?.user || report.name || report['姓名'] || report.reporter || '未登入'), '時間': time, '內容': content, '修改建議': suggestion, '狀態': '回報中', '狀態更改時間': time, '回報中': time });
        draft.tables.bug_report.rows.push(row);
        return { result: { ok: true, action, rowNumber: draft.tables.bug_report.rows.length + 1, row: issueRow(row, draft.tables.bug_report.rows.length - 1) }, changedTables: ['bug_report'] };
      });
    }
    if (action === 'updateIssueReportStatus') {
      const current = this.requireAccess(database, session, 'issue.manage');
      const rowNumber = Number(payload.rowNumber || payload.id), status = text(payload.status);
      if (!Number.isInteger(rowNumber) || rowNumber < 2 || !ISSUE_STATUSES.includes(status)) throw new Error('回報狀態或列號不正確');
      return this.mutate(action, current, draft => {
        const row = draft.tables.bug_report.rows[rowNumber - 2];
        if (!row) throw new Error('找不到要更新的回報');
        const time = nowTaipei(); row['狀態'] = status; row['狀態更改時間'] = time; row[status] = time;
        return { result: { ok: true, action, rowNumber, row: issueRow(row, rowNumber - 2) }, changedTables: ['bug_report'] };
      });
    }
    if (action === 'addModificationRecord') {
      const record = asRow(payload.record || payload.row || payload.data || payload);
      if (session) this.requireAccess(database, session, 'modification.create');
      const caseId = text(record.caseId || record.id || record['案件編號']);
      const modifyDate = text(record.modifyDate || record['修改日期']);
      const content = text(record.content || record['修改內容']);
      const modifier = text(session?.user || record.modifier || record.owner || record['修改人'] || record['專案負責人']);
      const targetImages = unique((Array.isArray(record.targetImages) ? record.targetImages : []).map(text).filter(Boolean));
      if (!caseId || !modifyDate || !content || !modifier) throw new Error('案件編號、修改日期、修改內容與修改人皆為必填');
      return this.mutate(action, session, draft => {
        const rows = draft.tables['修改統計表'].rows;
        const count = rows.filter(row => text(row['案件編號']) === caseId).reduce((max, row) => Math.max(max, Number(row['修改次數']) || 0), 0) + 1;
        const row = { '案件編號': caseId, '修改次數': String(count), '建立日期': nowTaipei(), '修改日期': modifyDate, '修改內容': content, '修改人': modifier, '確認修正日': '', '待修改圖片': targetImages.length ? JSON.stringify(targetImages) : '' };
        rows.push(row);
        return { result: { ok: true, action, rowNumber: rows.length + 1, record: row, count }, changedTables: ['修改統計表'] };
      });
    }
    if (action === 'updateModificationConfirm') {
      const current = this.requireAccess(database, session, 'modification.confirm');
      const record = asRow(payload.record || payload.row || payload.data || payload);
      const caseId = text(record.caseId || record.id || record['案件編號']), count = Number(record.count || record['修改次數']);
      return this.mutate(action, current, draft => {
        const index = draft.tables['修改統計表'].rows.findIndex(row => text(row['案件編號']) === caseId && Number(row['修改次數']) === count);
        if (index < 0) throw new Error('找不到指定的修改紀錄');
        const row = draft.tables['修改統計表'].rows[index];
        row['確認修正日'] = ('confirmedDate' in record || '確認修正日' in record) && !text(record.confirmedDate || record['確認修正日']) ? '' : nowTaipei();
        return { result: { ok: true, action, rowNumber: index + 2, record: row }, changedTables: ['修改統計表'] };
      });
    }
    if (action === 'addCaseDesignImages') {
      const apiKey = text(payload.serviceKey || payload.apiKey);
      const serviceAuthorized = Boolean(apiKey && this.env.NAS_WATCHER_API_KEY) && await secureEqual(apiKey, this.env.NAS_WATCHER_API_KEY);
      if (!serviceAuthorized) {
        if (!session) throw new Error('缺少服務金鑰或登入權限，無法寫入設計圖紀錄');
        this.requireAccess(database, session, 'media.manage');
      }
      const caseId = text(payload.caseId || payload.id || payload['案件編號']);
      const roundNumber = Math.trunc(Number(payload.round ?? payload['修改次數']));
      const images = (Array.isArray(payload.images) ? payload.images : [])
        .map(item => (item && typeof item === 'object' && !Array.isArray(item))
          ? { fileName: text((item as Row).fileName), url: text((item as Row).url) }
          : { fileName: '', url: text(item) })
        .filter(item => isHttpUrl(item.url));
      const source = text(payload.source) || (serviceAuthorized ? 'nas-watcher' : 'manual');
      if (!caseId) throw new Error('缺少案件編號');
      if (!Number.isFinite(roundNumber) || roundNumber < 0) throw new Error('缺少修改輪次（0=初稿）');
      if (!images.length) throw new Error('沒有可寫入的圖片網址');
      return this.mutate(action, session, draft => {
        if (!draft.tables.database.rows.some(row => text(row['案件編號']) === caseId)) throw new Error('找不到案件');
        const rows = draft.tables['修改統計表'].rows;
        let row = rows.find(item => text(item['案件編號']) === caseId && Number(item['修改次數']) === roundNumber);
        const now = nowTaipei();
        if (!row) {
          row = {
            '案件編號': caseId,
            '修改次數': String(roundNumber),
            '建立日期': now,
            '修改日期': roundNumber === 0 ? now : '',
            '修改內容': roundNumber === 0 ? (serviceAuthorized ? '初稿完成（NAS 自動建立）' : '初稿完成') : '',
            '修改人': serviceAuthorized ? 'NAS 自動同步' : text(session?.user || '系統'),
            // 第 0 輪（初稿）本身就代表「已完成」，不是一筆待處理的修改請求，
            // 直接標記確認修正日，避免被現有的「待確認修改」通知邏輯誤判成
            // 一筆還沒處理的修改需求。真正的修改請求（第 1 輪以後）維持空白，
            // 走原本「設計師確認修正完成」才寫入的流程。
            '確認修正日': roundNumber === 0 ? now : ''
          };
          rows.push(row);
        }
        const existing = parseCaseDesignImages_(row);
        const seenUrls = new Set<string>();
        const merged: { fileName: string; url: string }[] = [];
        for (const item of [...existing, ...images]) {
          if (seenUrls.has(item.url)) continue;
          seenUrls.add(item.url);
          merged.push(item);
        }
        row['圖片連結'] = JSON.stringify(merged);
        row['圖片來源'] = source;
        row['圖片更新時間'] = now;
        return { result: { ok: true, action, caseId, round: roundNumber, images: merged, record: row }, changedTables: ['修改統計表'] };
      });
    }
    if (action === 'removeCaseDesignImage') {
      const current = this.requireAccess(database, session, 'media.manage');
      const caseId = text(payload.caseId || payload.id || payload['案件編號']);
      const roundNumber = Math.trunc(Number(payload.round ?? payload['修改次數']));
      const url = text(payload.url);
      if (!caseId) throw new Error('缺少案件編號');
      if (!Number.isFinite(roundNumber) || roundNumber < 0) throw new Error('缺少修改輪次（0=初稿）');
      if (!url) throw new Error('缺少要刪除的圖片網址');
      return this.mutate(action, current, draft => {
        const row = draft.tables['修改統計表'].rows.find(item => text(item['案件編號']) === caseId && Number(item['修改次數']) === roundNumber);
        if (!row) throw new Error('找不到指定的修改紀錄');
        const existing = parseCaseDesignImages_(row);
        const filtered = existing.filter(item => item.url !== url);
        if (filtered.length === existing.length) throw new Error('找不到該張圖片');
        row['圖片連結'] = JSON.stringify(filtered);
        row['圖片更新時間'] = nowTaipei();
        return { result: { ok: true, action, caseId, round: roundNumber, images: filtered, record: row }, changedTables: ['修改統計表'] };
      });
    }
    if (action === 'createFlatProject') return this.createProject(payload, database, session);
    if (['append', 'create', 'add', 'submit', 'save'].includes(action)) return this.addRequests(action, payload, database, session, baseUrl, false);
    if (['batchAdd', 'batchAppend', 'addRows'].includes(action)) return this.addRequests(action, payload, database, session, baseUrl, true);
    if (action === 'update' || action === 'batchUpdate') return this.updateRequests(action, payload, database, session, baseUrl);
    if (action === 'delete') {
      const current = this.requireAccess(database, session, payload.accessContext === 'archive' ? 'archive.edit' : 'request.delete');
      const id = text(payload.id || payload.caseId);
      return this.mutate(action, current, draft => {
        const index = draft.tables.database.rows.findIndex(row => text(row['案件編號']) === id);
        if (index < 0) throw new Error('找不到案件');
        const [row] = draft.tables.database.rows.splice(index, 1);
        return { result: { ok: true, action, id, row: toApiRow(row) }, changedTables: ['database'] };
      });
    }
    if (action === 'adminAccountSave') return this.adminAccountSave(payload, database, session);
    if (['adminTableUpdate', 'adminTableDelete', 'adminTableInsert'].includes(action)) return this.adminMutation(action, payload, database, session);
    if (action === 'detailOptions' || action === 'options') return { ok: true, action, types: [], stages: [], details: {} };
    if (['uploadDesignerImage', 'uploadUserAvatar', 'deleteDesignerMedia', 'listDesignerMedia'].includes(action)) return { ok: false, action, error: '圖片檔案仍由獨立上傳服務處理，請從系統圖片視窗操作' };
    return { ok: false, action, error: 'Unknown action' };
  }

  private async addRequests(action: string, payload: ApiPayload, database: DatabaseSnapshot, session: SessionRecord | null, baseUrl: string, batch: boolean): Promise<ApiResult> {
    if (session) this.requireAccess(database, session, 'request.create');
    const sources = batch ? asRows(payload.rows || payload.data) : [asRow(payload.row || payload.data || payload)];
    if (!sources.length) throw new Error('沒有可新增的資料');
    const requestId = text(payload.requestId);
    return this.mutate(action, session, draft => {
      if (requestId && draft.internal.idempotency[requestId]) return { result: { ...draft.internal.idempotency[requestId], ok: true, deduplicated: true }, changed: false };
      const created: Row[] = [], rowNumbers: number[] = [];
      for (const source of sources) {
        const row = toSheetRow(source, {}, weightRules(draft));
        row['案件編號'] ||= nextCaseId(draft.tables.database.rows);
        row['填單時間'] ||= nowTaipei().slice(0, 10).replace(/\//g, '-');
        row['月份'] ||= monthFromDate(row['開始日期']);
        syncSupplementLinks(draft, row, baseUrl);
        draft.tables.database.rows.push(row);
        rowNumbers.push(draft.tables.database.rows.length + 1);
        created.push(toApiRow(row, draft.tables.database.rows.length - 1));
      }
      const result: ApiResult = batch
        ? { ok: true, action: 'batchAdd', count: created.length, rowNumbers, rows: created }
        : { ok: true, action: 'append', rowNumber: rowNumbers[0], row: created[0] };
      if (requestId) draft.internal.idempotency[requestId] = { ...result };
      return { result, changedTables: ['database', '補充資料連結'] };
    });
  }

  private async updateRequests(action: string, payload: ApiPayload, database: DatabaseSnapshot, session: SessionRecord | null, baseUrl: string): Promise<ApiResult> {
    const changes = asRow(payload.row || payload.changes || payload);
    const writeHeaders = [...(Array.isArray(payload.writeHeaders) ? payload.writeHeaders.map(text) : []), ...(Array.isArray(payload.forceHeaders) ? payload.forceHeaders.map(text) : [])];
    const touchesProtected = writeHeaders.some(header => ['案件狀態', '狀態', '項目細節'].includes(header)) || ['status', 'details'].some(key => changes[key] !== undefined);
    if (touchesProtected && !session && text(changes.status || changes['狀態'] || changes['案件狀態']) !== '已取消') throw new Error('請先登入後再修改狀態或項目細節');
    const changedKeys = Object.keys(changes).filter(key => key !== 'id');
    const onlyDesignImageFolderLink = !touchesProtected && changedKeys.length > 0 && changedKeys.every(key => key === 'designImageFolderUrl')
      && writeHeaders.every(header => header === '設計圖資料夾連結');
    if (session) {
      this.requireAccess(database, session, payload.accessContext === 'archive' ? 'archive.edit'
        : touchesProtected ? 'request.status' : onlyDesignImageFolderLink ? 'media.manage' : 'request.edit');
    }
    const items = action === 'batchUpdate' ? asRows(payload.rows) : [{ id: payload.id || payload.caseId || changes.id, row: changes }];
    return this.mutate(action, session, draft => {
      const updated: Row[] = [];
      for (const item of items) {
        const id = text(item.id || item.caseId || asRow(item.row).id || changes.id);
        const index = draft.tables.database.rows.findIndex(row => text(row['案件編號']) === id);
        if (index < 0) throw new Error(`找不到案件：${id}`);
        const patch = { ...(action === 'batchUpdate' ? changes : {}), ...asRow(item.row || item.changes) };
        const row = toSheetRow(patch, draft.tables.database.rows[index], weightRules(draft));
        row['案件編號'] = id;
        syncSupplementLinks(draft, row, baseUrl);
        draft.tables.database.rows[index] = row;
        updated.push(toApiRow(row, index));
      }
      const result: ApiResult = action === 'batchUpdate'
        ? { ok: true, action, count: updated.length, rows: updated, updated: writeHeaders }
        : { ok: true, action, id: updated[0].id, row: updated[0], updated: writeHeaders };
      return { result, changedTables: ['database', '補充資料連結'] };
    });
  }

  private async createProject(payload: ApiPayload, database: DatabaseSnapshot, session: SessionRecord | null): Promise<ApiResult> {
    const current = this.requireAccess(database, session, 'project.create');
    const source = asRow(payload.row || payload.data);
    const expected = text(source.expectedDesigner || source['預計設計師']);
    const groupEntry = Object.entries(PROJECT_GROUPS).find(([, config]) => config.designers.includes(expected));
    if (!groupEntry) throw new Error('預計設計師必須為平面組或影音組輪值名單');
    const [projectKind, config] = groupEntry;
    const replacement = text(source.replacement || source['替換(選填)']);
    const designer = replacement && replacement !== expected ? replacement : expected;
    if (!config.designers.includes(designer)) throw new Error('替換設計師不在同一輪值組別');
    if (designer !== expected && !text(source.reason || source['調整原因(選填)'])) throw new Error('有替換設計師時，請填寫調整原因');
    return this.mutate('createFlatProject', current, draft => {
      const projectRow: Row = {
        '客戶別': text(source.client || source['客戶別']), '專案名稱': text(source.project || source['專案名稱']),
        '專案負責人': text(source.owner || source['專案負責人']), '專案類型': text(source.projectType || source['專案類型']),
        '數量': text(source.qty || source['數量']), '開始時間': text(source.start || source['開始時間']),
        '結束時間': text(source.end || source['結束時間']), '預計設計師': expected,
        '替換(選填)': designer !== expected ? designer : '', '調整原因(選填)': designer !== expected ? text(source.reason || source['調整原因(選填)']) : ''
      };
      for (const header of ['客戶別', '專案名稱', '專案負責人', '專案類型', '數量', '開始時間', '結束時間', '預計設計師']) if (!text(projectRow[header])) throw new Error(`請填寫「${header}」`);
      const projectTable = draft.tables[`${projectKind}新開專案`];
      if (!projectTable) throw new Error(`JSON 資料庫缺少「${projectKind}新開專案」資料表`);
      projectTable.rows.push(projectRow);
      const row = toSheetRow({
        client: source.client, project: source.project, owner: source.owner, type: config.type,
        stage: projectKind === '影音' && text(source.projectType).includes('拍攝') ? '拍攝' : '後製',
        qty: source.qty, start: source.start, end: source.end, designer, status: '未開始'
      }, {}, weightRules(draft));
      for (const header of ['客戶別', '專案名稱', '專案負責人', '數量', '開始日期', '結束日期']) if (!text(row[header])) throw new Error(`請填寫「${header}」`);
      row['案件編號'] = nextCaseId(draft.tables.database.rows);
      row['填單時間'] = nowTaipei().slice(0, 10).replace(/\//g, '-');
      row['月份'] = monthFromDate(row['開始日期']);
      draft.tables.database.rows.push(row);
      const settingsRows = draft.tables['設定'].rows;
      const ranked = config.designers.map((name, index) => ({ name, settings: settingsRows.find(item => text(item['名字']) === name), rotation: Number(settingsRows.find(item => text(item['名字']) === name)?.['新專案輪值']) || index + 1 })).sort((a, b) => a.rotation - b.rotation || config.designers.indexOf(a.name) - config.designers.indexOf(b.name));
      const consumedIndex = ranked.findIndex(item => item.name === designer);
      const reordered = [...ranked.slice(0, consumedIndex), ...ranked.slice(consumedIndex + 1), ranked[consumedIndex]];
      reordered.forEach((item, index) => { if (item.settings) item.settings['新專案輪值'] = String(index + 1); });
      return {
        result: { ok: true, action: 'createFlatProject', projectKind, rowNumber: projectTable.rows.length + 1, row: projectRow, databaseRowNumber: draft.tables.database.rows.length + 1, databaseRow: toApiRow(row, draft.tables.database.rows.length - 1), user: current.user },
        changedTables: [`${projectKind}新開專案`, 'database', '設定']
      };
    });
  }

  private async adminAccountSave(payload: ApiPayload, database: DatabaseSnapshot, session: SessionRecord | null): Promise<ApiResult> {
    const current = this.requireAccess(database, session, 'database.manage');
    const requestedSettings = asRow(payload.settingsRow || payload.settings);
    const requestedPermission = asRow(payload.permissionRow || payload.permission);
    const expectedSettings = asRow(payload.expectedSettingsRow);
    const expectedPermission = asRow(payload.expectedPermissionRow);
    const loginMethod = text(requestedPermission['登入方式']) || '公司信箱';
    if (!['公司信箱', '密碼'].includes(loginMethod)) throw new Error('登入方式格式不正確');
    const requestedAccount = text(payload.account || requestedSettings['帳號'] || requestedPermission['帳號']);
    const account = canonicalAccount(requestedAccount || (loginMethod === '密碼' ? `local:${crypto.randomUUID()}` : ''));
    if (loginMethod === '公司信箱' && (!account || !account.endsWith('@emctaipei.com'))) throw new Error('帳號必須使用 @emctaipei.com 公司信箱');
    if (loginMethod === '密碼' && !account) throw new Error('無法建立密碼登入帳號');
    const loginPassword = text(payload.loginPassword);
    if (loginPassword && (loginPassword.length < 4 || loginPassword.length > 128)) throw new Error('登入密碼長度必須是 4–128 個字');
    if (loginPassword && isReservedShortcutPassword(loginPassword)) throw new Error('這組密碼與內建測試密碼保留格式重複，請改用其他密碼');
    if (loginPassword && await secureEqual(loginPassword, this.env.ADMIN_LOGIN_PASSWORD)) throw new Error('這組密碼與系統管理者密碼重複，請改用其他密碼');

    return this.mutate('adminAccountSave', current, async draft => {
      const settingsTable = draft.tables['設定'];
      const permissionTable = draft.tables['帳號權限'];
      let settingsIndex = settingsTable.rows.findIndex(row => canonicalAccount(row['帳號']) === account);
      let permissionIndex = permissionTable.rows.findIndex(row => canonicalAccount(row['帳號']) === account);

      if (Object.keys(expectedSettings).length) {
        if (settingsIndex < 0 || rowsDiffer(settingsTable.headers, expectedSettings, settingsTable.rows[settingsIndex])) throw new Error('個人設定已被其他人更新，請重新讀取後再操作');
      } else if (payload.expectSettingsMissing === true && settingsIndex >= 0) throw new Error('這個帳號已經存在，請重新讀取後再操作');
      if (Object.keys(expectedPermission).length) {
        if (permissionIndex < 0 || rowsDiffer(permissionTable.headers, expectedPermission, permissionTable.rows[permissionIndex])) throw new Error('帳號權限已被其他人更新，請重新讀取後再操作');
      } else if (payload.expectPermissionMissing === true && permissionIndex >= 0) throw new Error('帳號權限已被其他人建立，請重新讀取後再操作');

      const settings = normalizedTableRow(settingsTable.headers, requestedSettings);
      settings['帳號'] = account;
      if (!text(settings['名字'])) throw new Error('請填寫帳號姓名');
      if (text(settings['名字']).length > 60 || text(settings['顯示名']).length > 60) throw new Error('姓名與顯示名不得超過 60 個字');
      settings['顯示名'] ||= settings['名字'];
      for (const header of ['頭像連結', '頭像大圖連結', '分享音樂']) {
        if (text(settings[header]) && !isHttpUrl(settings[header])) throw new Error(`「${header}」必須是 http 或 https 網址`);
      }
      if (text(settings['音樂起始秒數'])) settings['音樂起始秒數'] = String(Math.max(0, Math.floor(Number(settings['音樂起始秒數']) || 0)));
      if (text(settings['新專案輪值'])) {
        const rotation = Number(settings['新專案輪值']);
        if (!Number.isInteger(rotation) || rotation < 1 || rotation > 99) throw new Error('新專案輪值必須是 1–99 的整數');
        settings['新專案輪值'] = String(rotation);
      }
      settings['技能'] = splitNames(settings['技能']).join(' , ');
      if (text(settings['對話框']).length > 120) throw new Error('對話框不得超過 120 個字');
      if (text(settings['深淺模式']) && !['淺色', '深色'].includes(text(settings['深淺模式']))) throw new Error('深淺模式格式不正確');

      const permission = normalizedTableRow(permissionTable.headers, requestedPermission);
      permission['帳號'] = account;
      permission['登入方式'] = loginMethod;
      if (loginMethod === '密碼') {
        const existingHash = permissionIndex >= 0 ? text(permissionTable.rows[permissionIndex]['密碼雜湊']) : '';
        if (!loginPassword && !existingHash) throw new Error('請輸入密碼登入帳號的登入密碼');
        if (loginPassword) {
          for (let index = 0; index < permissionTable.rows.length; index += 1) {
            if (index === permissionIndex) continue;
            const other = permissionTable.rows[index];
            if (text(other['登入方式']) !== '密碼' || !text(other['密碼雜湊'])) continue;
            if (await verifyLocalPassword(loginPassword, other['密碼雜湊'])) throw new Error('這組登入密碼已由其他帳號使用，請改用不同密碼');
          }
        }
        permission['密碼雜湊'] = loginPassword ? await hashLocalPassword(loginPassword) : existingHash;
      } else permission['密碼雜湊'] = '';
      const roles = ['管理者', '設計師', '一般使用者', '唯讀', '自訂'];
      if (!roles.includes(text(permission['角色範本']))) throw new Error('角色範本格式不正確');
      if (!['啟用', '停用'].includes(text(permission['狀態']))) throw new Error('帳號狀態格式不正確');
      const manager = permission['角色範本'] === '管理者';
      permission['頁面權限'] = JSON.stringify(manager ? ACCESS_PAGES : normalizedAccessList(permission['頁面權限'], ACCESS_PAGES));
      permission['功能權限'] = JSON.stringify(manager ? ACCESS_CAPABILITIES : normalizedAccessList(permission['功能權限'], ACCESS_CAPABILITIES));
      permission['更新時間'] ||= nowTaipei();
      permission['更新者'] ||= current.user || current.account;

      const settingsChanged = settingsIndex < 0 || rowsDiffer(settingsTable.headers, settingsTable.rows[settingsIndex], settings);
      const permissionChanged = permissionIndex < 0 || rowsDiffer(permissionTable.headers, permissionTable.rows[permissionIndex], permission);
      if (settingsIndex < 0) { settingsTable.rows.push(settings); settingsIndex = settingsTable.rows.length - 1; }
      else if (settingsChanged) settingsTable.rows[settingsIndex] = settings;
      if (permissionIndex < 0) { permissionTable.rows.push(permission); permissionIndex = permissionTable.rows.length - 1; }
      else if (permissionChanged) permissionTable.rows[permissionIndex] = permission;

      return {
        result: {
          ok: true,
          action: 'adminAccountSave',
          account,
          settingsRow: { _rowNumber: settingsIndex + 2, ...settings },
          permissionRow: { _rowNumber: permissionIndex + 2, ...permission }
        },
        changed: settingsChanged || permissionChanged,
        changedTables: [settingsChanged ? '設定' : '', permissionChanged ? '帳號權限' : ''].filter(Boolean)
      };
    });
  }

  private async adminMutation(action: string, payload: ApiPayload, database: DatabaseSnapshot, session: SessionRecord | null): Promise<ApiResult> {
    const current = this.requireAccess(database, session, 'database.manage');
    const tableName = text(payload.table);
    const table = database.tables[tableName];
    if (!table || !ADMIN_TABLE_ORDER.includes(tableName)) throw new Error(`未知資料表：${tableName}`);
    if (action === 'adminTableInsert' && tableName === 'database') throw new Error('請使用「填寫設計需求」表單新增案件');
    const incoming = asRow(payload.row);
    const expected = asRow(payload.expectedRow);
    return this.mutate(action, current, draft => {
      const target = draft.tables[tableName];
      const primaryKey = target.primaryKey;
      let index = -1;
      if (action !== 'adminTableInsert') {
        if (primaryKey) {
          const key = text(expected[primaryKey] || incoming[primaryKey] || payload.key);
          index = target.rows.findIndex(row => text(row[primaryKey]) === key);
        } else index = Number(payload.rowNumber || expected._rowNumber || payload.key) - 2;
        if (!Number.isInteger(index) || index < 0 || index >= target.rows.length) throw new Error(`找不到要${action === 'adminTableDelete' ? '刪除' : '編輯'}的資料`);
        if (Object.keys(expected).length) {
          const currentRow = target.rows[index];
          const changed = target.headers.some(header => text(expected[header]) !== text(currentRow[header]));
          if (changed) throw new Error('資料已被其他人更新，請重新讀取後再操作');
        }
      }
      if (action === 'adminTableDelete') {
        const [deleted] = target.rows.splice(index, 1);
        if (tableName === '加權計分標準') recalculateDatabaseWeights(draft);
        return { result: { ok: true, action, table: tableName, rowNumber: index + 2, deleted: { _rowNumber: index + 2, ...deleted } }, changedTables: tableName === '加權計分標準' ? [tableName, 'database'] : [tableName] };
      }
      const normalized = Object.fromEntries(target.headers.map(header => [header, text(incoming[header])])) as Row;
      if (primaryKey && !text(normalized[primaryKey])) throw new Error(`「${primaryKey}」不得空白`);
      if (primaryKey) {
        const duplicate = target.rows.findIndex((row, rowIndex) => rowIndex !== index && text(row[primaryKey]) === text(normalized[primaryKey]));
        if (duplicate >= 0) throw new Error(`「${primaryKey}」不可重複`);
      }
      if (action === 'adminTableInsert') {
        target.rows.push(normalized);
        index = target.rows.length - 1;
      } else {
        const unchanged = target.headers.every(header => text(target.rows[index][header]) === text(normalized[header]));
        if (unchanged) return { result: { ok: true, action, table: tableName, rowNumber: index + 2, row: { _rowNumber: index + 2, ...normalized } }, changed: false };
        target.rows[index] = normalized;
      }
      if (tableName === '加權計分標準') recalculateDatabaseWeights(draft);
      return { result: { ok: true, action, table: tableName, rowNumber: index + 2, row: { _rowNumber: index + 2, ...normalized } }, changedTables: tableName === '加權計分標準' ? [tableName, 'database'] : [tableName] };
    });
  }
}

import { env } from 'cloudflare:workers';
import { reset, runInDurableObject, SELF } from 'cloudflare:test';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DEFAULT_CUSTOMER_NAMES, emptyDatabase } from '../../backend/schema.mjs';
import type { DatabaseCoordinator } from '../src/database-coordinator';
import { hasRowCapability, matchesCustomerEditRule, normalizeDepartmentName, normalizeSettingsDepartments } from '../src/model';
import type { DatabaseSnapshot, SessionRecord } from '../src/types';

const ORIGIN = 'https://emctaipeiart.github.io';

function toBase64Url(value: string): string {
  const bytes = new TextEncoder().encode(value);
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
}

function decodeBase64UrlText(value: string): string {
  const padded = value.replace(/-/g, '+').replace(/_/g, '/').padEnd(Math.ceil(value.length / 4) * 4, '=');
  const binary = atob(padded);
  const bytes = Uint8Array.from(binary, char => char.charCodeAt(0));
  return new TextDecoder('utf-8').decode(bytes);
}

function testDatabase(): DatabaseSnapshot {
  const database = emptyDatabase() as DatabaseSnapshot;
  database.revision = 7;
  database.source = { type: 'test' };
  database.tables['設定'].rows.push({
    '部門': '管理者',
    '組別': '管理者',
    '名字': 'Machi',
    '顯示名': 'Machi',
    '帳號': 'machi.chen@emctaipei.com'
  });
  // 刻意留空的部門／組別，跟正式資料一致：管理者權限必須由 SHORTCUT_ADMIN_ACCOUNT 授權，不能靠這兩個欄位。
  database.tables['設定'].rows.push({
    '部門': '',
    '組別': '',
    '名字': '管理員',
    '顯示名': '管理員',
    '帳號': 'admin@emctaipei.com'
  });
  database.tables['設定'].rows.push({
    '部門': '測試組',
    '組別': '測試專員',
    '名字': '測試使用者',
    '顯示名': '測試使用者',
    '帳號': 'test.user@emctaipei.com'
  });
  database.tables.database.rows.push({
    '案件編號': '26080001',
    '月份': '8月',
    '客戶別': '測試客戶',
    '專案名稱': 'Worker 測試案件',
    '狀態': '未開始'
  });
  return database;
}

async function seedDatabase(): Promise<void> {
  const stub = env.DATABASE_COORDINATOR.getByName('primary') as DurableObjectStub<DatabaseCoordinator>;
  await runInDurableObject(stub, async (_instance, state) => {
    const database = testDatabase();
    state.storage.sql.exec(
      `INSERT INTO database_state(id, json, github_sha, updated_at)
       VALUES (?, ?, ?, ?)`,
      'primary', JSON.stringify(database), 'test-file-sha', new Date().toISOString()
    );
  });
}

async function seedCalendarToken(scopes = 'https://www.googleapis.com/auth/calendar.freebusy'): Promise<void> {
  const stub = env.DATABASE_COORDINATOR.getByName('primary') as DurableObjectStub<DatabaseCoordinator>;
  await runInDurableObject(stub, async (_instance, state) => {
    state.storage.sql.exec(
      `INSERT INTO gmail_tokens(account, refresh_token, access_token, access_token_expires_at, gmail_address, scopes, connected_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      'machi.chen@emctaipei.com', 'refresh', 'access-token', Date.now() + 3_600_000,
      'machi.chen@emctaipei.com', scopes, new Date().toISOString(), new Date().toISOString()
    );
  });
}

/** 讓 freeBusy 回傳指定的忙碌時段。keys 是信箱，值是 [開始, 結束] 的毫秒。 */
function mockFreeBusy(busyByEmail: Record<string, [number, number][] | { errors: unknown[] }>) {
  return vi.spyOn(globalThis, 'fetch').mockImplementation(async (input: RequestInfo | URL) => {
    const url = String(input instanceof Request ? input.url : input);
    if (url.includes('oauth2.googleapis.com/token')) {
      return new Response(JSON.stringify({ access_token: 'fresh', expires_in: 3600 }), { status: 200 });
    }
    if (url.includes('calendar/v3/freeBusy')) {
      const calendars: Record<string, unknown> = {};
      for (const [email, value] of Object.entries(busyByEmail)) {
        calendars[email] = Array.isArray(value)
          ? { busy: value.map(([start, end]) => ({ start: new Date(start).toISOString(), end: new Date(end).toISOString() })) }
          : value;
      }
      return new Response(JSON.stringify({ calendars }), { status: 200 });
    }
    throw new Error(`unexpected fetch: ${url}`);
  });
}

/** 同時模擬 freeBusy 與 Events:list。事件詳細資料讀不到時，正式程式應只針對該人退回 freeBusy。 */
function mockCalendarApi(
  busyByEmail: Record<string, [number, number][] | { errors: unknown[] }>,
  eventsByEmail: Record<string, Record<string, unknown>[] | { status: number; message?: string }>
) {
  return vi.spyOn(globalThis, 'fetch').mockImplementation(async (input: RequestInfo | URL) => {
    const url = String(input instanceof Request ? input.url : input);
    if (url.includes('oauth2.googleapis.com/token')) {
      return new Response(JSON.stringify({ access_token: 'fresh', expires_in: 3600 }), { status: 200 });
    }
    if (url.includes('calendar/v3/freeBusy')) {
      const calendars: Record<string, unknown> = {};
      for (const [email, value] of Object.entries(busyByEmail)) {
        calendars[email] = Array.isArray(value)
          ? { busy: value.map(([start, end]) => ({ start: new Date(start).toISOString(), end: new Date(end).toISOString() })) }
          : value;
      }
      return new Response(JSON.stringify({ calendars }), { status: 200 });
    }
    const match = /\/calendar\/v3\/calendars\/([^/]+)\/events/.exec(url);
    if (match) {
      const email = decodeURIComponent(match[1]);
      const value = eventsByEmail[email] || [];
      if (!Array.isArray(value)) {
        return new Response(JSON.stringify({ error: { message: value.message || 'calendar details unavailable' } }), { status: value.status });
      }
      return new Response(JSON.stringify({ items: value }), { status: 200 });
    }
    throw new Error(`unexpected fetch: ${url}`);
  });
}

async function runCalendarSync(nowMs: number): Promise<Record<string, unknown>> {
  const stub = env.DATABASE_COORDINATOR.getByName('primary') as DurableObjectStub<DatabaseCoordinator>;
  return await runInDurableObject(stub, async instance => await instance.runPixelOfficeCalendarSync(nowMs)) as Record<string, unknown>;
}

async function statusOfPerson(name: string): Promise<{ status?: unknown; statusSource?: unknown }> {
  const people = (await api({ action: 'pixelOfficeState' })).people as Record<string, unknown>[];
  return (people.find(person => person.name === name) || {}) as { status?: unknown; statusSource?: unknown };
}

async function seedAccountPermission(account: string, role: string, capabilities: string[]): Promise<void> {
  const stub = env.DATABASE_COORDINATOR.getByName('primary') as DurableObjectStub<DatabaseCoordinator>;
  await runInDurableObject(stub, async (_instance, state) => {
    const stored = state.storage.sql.exec<{ json: string }>('SELECT json FROM database_state WHERE id = ?', 'primary').one();
    const database = JSON.parse(stored.json) as DatabaseSnapshot;
    database.tables['帳號權限'].rows.push({
      '帳號': account, '角色範本': role, '狀態': '啟用',
      '頁面權限': JSON.stringify(['request']), '功能權限': JSON.stringify(capabilities)
    });
    state.storage.sql.exec('UPDATE database_state SET json = ? WHERE id = ?', JSON.stringify(database), 'primary');
  });
}

async function seedCustomerOwner(customerName: string, account: string): Promise<void> {
  const stub = env.DATABASE_COORDINATOR.getByName('primary') as DurableObjectStub<DatabaseCoordinator>;
  await runInDurableObject(stub, async (_instance, state) => {
    const stored = state.storage.sql.exec<{ json: string }>('SELECT json FROM database_state WHERE id = ?', 'primary').one();
    const database = JSON.parse(stored.json) as DatabaseSnapshot;
    let row = database.tables['客戶別'].rows.find(item => item['客戶別'] === customerName);
    if (!row) {
      row = { '客戶別': customerName, '專案負責人': '[]', '設計負責人': '[]', '部門組別': '[]', '更新時間': '', '更新者': '' };
      database.tables['客戶別'].rows.push(row);
    }
    const owners = JSON.parse(String(row['專案負責人'] || '[]')) as string[];
    if (!owners.includes(account)) owners.push(account);
    row['專案負責人'] = JSON.stringify(owners);
    state.storage.sql.exec('UPDATE database_state SET json = ? WHERE id = ?', JSON.stringify(database), 'primary');
  });
}

/** 補一筆新的案件到測試資料庫——testDatabase() 預設只有 26080001 一筆，bindExistingThread 需要「一個
 * 存在、但還沒有 Gmail信件串ID」的案件才能測試手動貼 Message-ID 這條路徑（26080001 在同一支測試裡
 * 前面已經被綁定過，不能重複使用）。 */
async function seedCase(caseId: string, extra: Record<string, unknown> = {}): Promise<void> {
  const stub = env.DATABASE_COORDINATOR.getByName('primary') as DurableObjectStub<DatabaseCoordinator>;
  await runInDurableObject(stub, async (_instance, state) => {
    const stored = state.storage.sql.exec<{ json: string }>('SELECT json FROM database_state WHERE id = ?', 'primary').one();
    const database = JSON.parse(stored.json) as DatabaseSnapshot;
    if (!database.tables.database.rows.some(row => row['案件編號'] === caseId)) {
      database.tables.database.rows.push({ '案件編號': caseId, '月份': '8月', '客戶別': '測試客戶', '專案名稱': `測試案件 ${caseId}`, '狀態': '未開始', ...extra });
      state.storage.sql.exec('UPDATE database_state SET json = ? WHERE id = ?', JSON.stringify(database), 'primary');
    }
  });
}

async function sha256Base64UrlForTest(value: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value));
  const bytes = new Uint8Array(digest);
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
}

/** 直接在 sessions 表插入一筆有效 session，模擬「這個帳號已經登入」——不需要這個帳號在「設定」／「帳號權限」
 * 表裡有任何資料，因為 Gmail 信件串查看/回覆的權限依據現在是信件內容本身（見 accountIsGmailThreadParticipant），
 * 不是角色權限，用這個 helper 可以直接測試任意 email 帳號、不用另外走一次完整的登入流程。 */
async function seedSession(account: string, user = account): Promise<string> {
  const token = `test-session-${crypto.randomUUID()}`;
  const tokenHash = await sha256Base64UrlForTest(token);
  const expiresAt = Date.now() + 60 * 60 * 1000;
  const stub = env.DATABASE_COORDINATOR.getByName('primary') as DurableObjectStub<DatabaseCoordinator>;
  await runInDurableObject(stub, async (_instance, state) => {
    const payload = JSON.stringify({ user, account, provider: 'password', expiresAt });
    state.storage.sql.exec('INSERT INTO sessions(token_hash, payload, expires_at) VALUES (?, ?, ?)', tokenHash, payload, expiresAt);
  });
  return token;
}

/** 直接在 DO 的 gmail_tokens 表插入一筆已連接的 Gmail 帳號，讓 getValidGmailAccessToken() 不用重跑一次
 * 完整的 OAuth connect 流程就能拿到可用的 access token——排程寄信/回信的測試大多要模擬「這個帳號已經連過
 * Gmail」這個前提，用這個 helper 一次到位，跟既有測試（見 gmail_tokens 直接 INSERT 的既有案例）同一套做法。 */
async function seedGmailTokens(account: string, accessToken: string, gmailAddress = `${account.split('@')[0]}@gmail.example`, scopes = 'https://www.googleapis.com/auth/gmail.send https://www.googleapis.com/auth/gmail.compose'): Promise<void> {
  const stub = env.DATABASE_COORDINATOR.getByName('primary') as DurableObjectStub<DatabaseCoordinator>;
  await runInDurableObject(stub, async (_instance, state) => {
    state.storage.sql.exec(
      `INSERT INTO gmail_tokens(account, refresh_token, access_token, access_token_expires_at, gmail_address, scopes, connected_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      account, `refresh-${account}`, accessToken, Date.now() + 3600 * 1000, gmailAddress, scopes, new Date().toISOString(), new Date().toISOString()
    );
  });
}

async function api(payload: Record<string, unknown>, token = ''): Promise<Record<string, unknown>> {
  const response = await SELF.fetch('https://worker.test/api', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Origin: ORIGIN,
      ...(token ? { Authorization: `Bearer ${token}` } : {})
    },
    body: JSON.stringify(payload)
  });
  expect(response.headers.get('Access-Control-Allow-Origin')).toBe(ORIGIN);
  return response.json() as Promise<Record<string, unknown>>;
}

async function login(): Promise<string> {
  const result = await api({
    action: 'login',
    account: 'machi.chen@emctaipei.com',
    password: 'test-admin-password'
  });
  expect(result.ok).toBe(true);
  expect(result.provider).toBe('password');
  return String(result.token);
}

beforeEach(async () => {
  await reset();
  await seedDatabase();
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('Machi Design API Worker', () => {
  it('accepts Gmail editor payloads larger than the old 2 MiB ceiling', async () => {
    const result = await api({ action: 'ping', padding: 'x'.repeat(2 * 1024 * 1024 + 1024) });
    expect(result).toMatchObject({ ok: true, action: 'ping' });
  });

  it('returns the latest enabled system announcement without requiring login', async () => {
    const result = await api({ action: 'getSystemAnnouncement' });
    expect(result.ok).toBe(true);
    expect(result.action).toBe('getSystemAnnouncement');
    expect(result.announcement).toMatchObject({ version: 'v4.7' });
    const content = String((result.announcement as Record<string, unknown>)?.content || '');
    expect(content).toContain('Gmail');
    expect(content).not.toMatch(/[📢🎉✉📝💬🖼👥⚙🔔🚀]/u);
  });

  it('records one read receipt per signed-in account for each announcement', async () => {
    const token = await login();
    const githubPut = vi.spyOn(globalThis, 'fetch').mockImplementation(async (_input, init) => {
      expect(init?.method).toBe('PUT');
      return Response.json({ content: { sha: 'announcement-read-file-sha' }, commit: { sha: 'announcement-read-commit-sha' } });
    });
    const first = await api({ action: 'markSystemAnnouncementRead', version: 'v4.7', account: 'spoofed@emctaipei.com' }, token);
    const repeated = await api({ action: 'markSystemAnnouncementRead', version: 'v4.7' }, token);
    expect(first).toMatchObject({ ok: true, action: 'markSystemAnnouncementRead', version: 'v4.7', readCount: 1 });
    expect(repeated).toMatchObject({ ok: true, readCount: 1, unchanged: true });
    const rows = await api({ action: 'adminTableRows', table: '系統公告欄' }, token);
    const records = JSON.parse(String((rows.rows as Array<Record<string, unknown>>)[0]['已讀紀錄'])) as Array<Record<string, unknown>>;
    expect(records).toEqual([expect.objectContaining({ account: 'machi.chen@emctaipei.com', name: 'Machi' })]);
    expect(githubPut).toHaveBeenCalledTimes(1);
  });

  it('resolves customer edit permissions from current department and group membership', () => {
    const database = testDatabase();
    const customer = { '客戶別': '動態權限客戶', '專案負責人': JSON.stringify(['department:測試組']), '設計負責人': '[]', '部門組別': '[]' };
    database.tables['客戶別'].rows.push(customer);
    const row = { '客戶別': '動態權限客戶' };
    const session: SessionRecord = {
      user: '測試使用者', account: 'test.user@emctaipei.com', provider: 'password', expiresAt: Date.now() + 60_000
    };

    expect(hasRowCapability(database, session, 'request.edit', row)).toBe(true);

    customer['專案負責人'] = JSON.stringify(['group:設計測試組']);
    database.tables['設定'].rows.find(item => item['帳號'] === session.account)!['組別'] = '設計測試組';
    expect(hasRowCapability(database, session, 'request.delete', row)).toBe(true);

    // 「設計部」是設計組的上層規則：即使帳號部門是測試員，只要目前組別是平面／影音仍會動態納入。
    customer['專案負責人'] = JSON.stringify(['department:設計部']);
    const settings = database.tables['設定'].rows.find(item => item['帳號'] === session.account)!;
    settings['部門'] = '測試員';
    settings['組別'] = '平面';
    expect(hasRowCapability(database, session, 'request.mail', row)).toBe(true);

    settings['組別'] = '非設計組';
    expect(hasRowCapability(database, session, 'request.mail', row)).toBe(false);
  });

  it('enforces exact-origin CORS and answers health checks', async () => {
    const denied = await SELF.fetch('https://worker.test/api?action=ping', {
      headers: { Origin: 'https://evil.example' }
    });
    expect(denied.status).toBe(403);
    expect(await denied.json()).toMatchObject({ ok: false, error: '不允許的網站來源' });

    const allowed = await SELF.fetch('https://worker.test/api?action=ping', {
      headers: { Origin: ORIGIN }
    });
    expect(allowed.status).toBe(200);
    expect(allowed.headers.get('Access-Control-Allow-Origin')).toBe(ORIGIN);
    expect(await allowed.json()).toMatchObject({ ok: true, storage: 'cloudflare-worker-github-json', revision: 7 });
  });

  it('creates a hashed session and returns the live manager access profile', async () => {
    const token = await login();
    const verified = await api({ action: 'verifyToken' }, token);
    expect(verified).toMatchObject({
      ok: true,
      account: 'machi.chen@emctaipei.com',
      user: 'Machi',
      access: { role: '管理者', status: '啟用' }
    });

    const stub = env.DATABASE_COORDINATOR.getByName('primary') as DurableObjectStub<DatabaseCoordinator>;
    const stored = await runInDurableObject(stub, async (_instance, state) => ({
      plainTokenRows: state.storage.sql.exec<{ count: number }>(
        'SELECT COUNT(*) AS count FROM sessions WHERE token_hash = ?', token
      ).one().count,
      sessionRows: state.storage.sql.exec<{ count: number }>('SELECT COUNT(*) AS count FROM sessions').one().count,
      migrations: state.storage.sql.exec<{ version: number }>('SELECT version FROM _sql_schema_migrations').toArray()
    }));
    expect(stored.plainTokenRows).toBe(0);
    expect(stored.sessionRows).toBe(1);
    expect(stored.migrations).toEqual([{ version: 1 }, { version: 2 }, { version: 3 }, { version: 4 }, { version: 5 }, { version: 6 }, { version: 7 }, { version: 8 }, { version: 9 }, { version: 10 }]);
  });

  it('issues real sessions for the tester and admin shortcut passwords', async () => {
    const tester = await api({ action: 'login', password: 'test' });
    expect(tester).toMatchObject({
      ok: true, provider: 'password', account: 'test.user@emctaipei.com', user: '測試使用者',
      access: { role: '一般使用者', status: '啟用' }
    });
    expect(String(tester.token)).not.toBe('');

    const parts = Object.fromEntries(new Intl.DateTimeFormat('en-US', { timeZone: 'Asia/Taipei', month: '2-digit', day: '2-digit' })
      .formatToParts(new Date()).map(part => [part.type, part.value]));
    const admin = await api({ action: 'login', password: `${parts.month}${parts.day}` });
    expect(admin).toMatchObject({
      ok: true, provider: 'password', account: 'admin@emctaipei.com', user: '管理員',
      access: { role: '管理者', status: '啟用' }
    });

    // 捷徑密碼不能拿來冒充其他帳號，也不能讓任意密碼通過
    const spoofed = await api({ action: 'login', account: 'machi.chen@emctaipei.com', password: 'test' });
    expect(spoofed).toMatchObject({ ok: true, account: 'test.user@emctaipei.com' });
    const rejected = await api({ action: 'login', account: 'machi.chen@emctaipei.com', password: 'not-the-password' });
    expect(rejected).toMatchObject({ ok: false, error: '帳號或密碼不正確' });
  });

  it('blocks anonymous admin reads and serves authorized table data', async () => {
    expect(await api({ action: 'adminTables' })).toMatchObject({ ok: false });
    const token = await login();
    const metadata = await api({ action: 'adminTables' }, token);
    expect(metadata).toMatchObject({
      ok: true,
      revision: 7,
      tables: { database: { primaryKey: '案件編號', rowCount: 1 } }
    });
    const rows = await api({ action: 'adminTableRows', table: 'database', sort: '案件編號', order: 'desc' }, token);
    expect(rows).toMatchObject({ ok: true, total: 1 });
    expect((rows.rows as Array<Record<string, unknown>>)[0]['案件編號']).toBe('26080001');
  });

  it('commits an authorized admin mutation to GitHub and persists the new SHA', async () => {
    const token = await login();
    let requestBody: Record<string, unknown> | null = null;
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (_input, init) => {
      expect(init?.method).toBe('PUT');
      expect(new Headers(init?.headers).get('Authorization')).toBe('Bearer test-github-token');
      requestBody = JSON.parse(String(init?.body));
      return Response.json({ content: { sha: 'next-file-sha' }, commit: { sha: 'next-commit-sha' } });
    });

    const inserted = await api({
      action: 'adminTableInsert',
      table: '短連結',
      row: { '短碼': 'Abc234', '原始網址': 'https://example.com', '建立時間': '2026/08/11 12:00:00' }
    }, token);
    expect(inserted).toMatchObject({
      ok: true,
      revision: 8,
      githubCommitSha: 'next-commit-sha',
      changedTables: ['短連結']
    });
    expect(requestBody).toMatchObject({ sha: 'test-file-sha', branch: 'main' });

    const stub = env.DATABASE_COORDINATOR.getByName('primary') as DurableObjectStub<DatabaseCoordinator>;
    const stored = await runInDurableObject(stub, async (_instance, state) => state.storage.sql.exec<{
      github_sha: string;
      json: string;
    }>('SELECT github_sha, json FROM database_state WHERE id = ?', 'primary').one());
    expect(stored.github_sha).toBe('next-file-sha');
    const database = JSON.parse(stored.json) as DatabaseSnapshot;
    expect(database.revision).toBe(8);
    expect(database.tables['短連結'].rows).toContainEqual(expect.objectContaining({ '短碼': 'Abc234' }));
  });

  it('keeps supplement URLs long and pauses creation of new short links', async () => {
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (_input, init) => {
      expect(init?.method).toBe('PUT');
      return Response.json({ content: { sha: 'supplement-file-sha' }, commit: { sha: 'supplement-commit-sha' } });
    });
    const longUrl = 'https://example.com/brief/with/a/long/path?source=form';
    const created = await api({
      action: 'add', requestId: 'long-supplement-url',
      row: { client: '測試客戶', project: '長網址案件', briefUrl: longUrl, briefNote: '設計簡報' }
    });
    expect(created.ok).toBe(true);
    expect((created.row as Record<string, unknown>).briefUrl).toBe(longUrl);
    const createdId = String((created.row as Record<string, unknown>).id);
    const migrated = await api({
      action: 'update', id: createdId,
      row: { briefUrl: `https://emctaipeiart.github.io/a/${createdId}` },
      writeHeaders: ['設計簡報連結']
    });
    expect((migrated.row as Record<string, unknown>).briefUrl).toBe(longUrl);

    const stub = env.DATABASE_COORDINATOR.getByName('primary') as DurableObjectStub<DatabaseCoordinator>;
    const database = await runInDurableObject(stub, async (_instance, state) => {
      const stored = state.storage.sql.exec<{ json: string }>('SELECT json FROM database_state WHERE id = ?', 'primary').one();
      return JSON.parse(stored.json) as DatabaseSnapshot;
    });
    expect(database.tables['補充資料連結'].rows).toContainEqual(expect.objectContaining({ A: longUrl }));

    const paused = await api({ action: 'createShortLink', url: longUrl });
    expect(paused).toMatchObject({ ok: false, error: expect.stringContaining('短網址建立功能目前暫停') });
    expect(database.tables['短連結'].rows).toHaveLength(0);
  });

  it('saves numbered mail templates and their default through personal settings', async () => {
    const token = await login();
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (_input, init) => {
      expect(init?.method).toBe('PUT');
      return Response.json({ content: { sha: 'personal-settings-file-sha' }, commit: { sha: 'personal-settings-commit-sha' } });
    });
    const saved = await api({
      action: 'saveUserSettings',
      settings: {
        displayName: 'Machi Template QA',
        replyTemplates: { '範本 1': '第一筆內容', '範本 2': '第二筆內容' },
        replyTemplateDefault: '範本 2'
      }
    }, token);
    expect(saved).toMatchObject({
      ok: true,
      action: 'saveUserSettings',
      account: 'machi.chen@emctaipei.com',
      settings: {
        displayName: 'Machi Template QA',
        replyTemplates: { '範本 1': '第一筆內容', '範本 2': '第二筆內容' },
        replyTemplateDefault: '範本 2'
      }
    });

    const current = await api({ action: 'getUserSettings' }, token);
    expect(current.settings).toMatchObject({
      replyTemplates: { '範本 1': '第一筆內容', '範本 2': '第二筆內容' },
      replyTemplateDefault: '範本 2'
    });
  });

  it('saves named signature presets and their default through personal settings, independently of reply templates', async () => {
    const token = await login();
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (_input, init) => {
      expect(init?.method).toBe('PUT');
      return Response.json({ content: { sha: 'signature-settings-file-sha' }, commit: { sha: 'signature-settings-commit-sha' } });
    });
    const saved = await api({
      action: 'saveUserSettings',
      settings: {
        signaturePresets: { '正常': 'Machi Chen<br>EMC 設計組', '休假': '目前休假中，緊急事項請洽 02-1234-5678' },
        signaturePresetDefault: '休假'
      }
    }, token);
    expect(saved).toMatchObject({
      ok: true,
      action: 'saveUserSettings',
      settings: {
        signaturePresets: { '正常': 'Machi Chen<br>EMC 設計組', '休假': '目前休假中，緊急事項請洽 02-1234-5678' },
        signaturePresetDefault: '休假'
      }
    });

    const current = await api({ action: 'getUserSettings' }, token);
    expect(current.settings).toMatchObject({
      signaturePresets: { '正常': 'Machi Chen<br>EMC 設計組', '休假': '目前休假中，緊急事項請洽 02-1234-5678' },
      signaturePresetDefault: '休假'
    });
    // 指定一個不存在於清單裡的預設值要被忽略、退回清單第一筆，跟既有回信範本同一套防呆規則。
    const invalidDefault = await api({ action: 'saveUserSettings', settings: { signaturePresetDefault: '不存在的名稱' } }, token);
    expect((invalidDefault.settings as Record<string, unknown>).signaturePresetDefault).toBe('正常');
  });

  it('accepts formatted signature content up to 20000 characters (raised from the reply-template limit to fit HTML markup), and silently drops entries beyond it', async () => {
    const token = await login();
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (_input, init) => {
      expect(init?.method).toBe('PUT');
      return Response.json({ content: { sha: 'signature-length-file-sha' }, commit: { sha: 'signature-length-commit-sha' } });
    });
    const withinLimit = 'x'.repeat(20000);
    const overLimit = 'y'.repeat(20001);
    const saved = await api({
      action: 'saveUserSettings',
      settings: { signaturePresets: { '正常': withinLimit, '太長': overLimit }, signaturePresetDefault: '正常' }
    }, token);
    const savedPresets = (saved.settings as Record<string, unknown>).signaturePresets as Record<string, string>;
    expect(savedPresets['正常']).toBe(withinLimit);
    expect(savedPresets['太長']).toBeUndefined();
  });

  it('saves account settings and permissions in one GitHub commit', async () => {
    const token = await login();
    const githubPut = vi.spyOn(globalThis, 'fetch').mockImplementation(async (_input, init) => {
      expect(init?.method).toBe('PUT');
      return Response.json({ content: { sha: 'account-file-sha' }, commit: { sha: 'account-commit-sha' } });
    });
    const account = 'designer.qa@emctaipei.com';
    const saved = await api({
      action: 'adminAccountSave',
      account,
      expectSettingsMissing: true,
      expectPermissionMissing: true,
      settingsRow: {
        '帳號': account,
        '部門': '設計部',
        '組別': '影音',
        '名字': 'Designer QA',
        '顯示名': 'QA Designer',
        '頭像連結': 'https://example.com/avatar.png',
        '頭像大圖連結': 'https://example.com/poster.png',
        '分享音樂': 'https://example.com/music',
        '音樂起始秒數': '8',
        '技能': '影片, 動畫',
        '對話框': '品質確認',
        '新專案輪值': '2',
        '篩選月份': '8月 , 9月',
        '深淺模式': '深色'
      },
      permissionRow: {
        '帳號': account,
        '角色範本': '設計師',
        '狀態': '啟用',
        '頁面權限': JSON.stringify(['request', 'dashboard']),
        '功能權限': JSON.stringify(['request.create', 'profile.edit'])
      }
    }, token);
    expect(saved).toMatchObject({
      ok: true,
      account,
      revision: 8,
      githubCommitSha: 'account-commit-sha',
      changedTables: ['設定', '帳號權限'],
      settingsRow: { '帳號': account, '技能': '影片 , 動畫' },
      permissionRow: { '帳號': account, '角色範本': '設計師' }
    });
    const hiddenProfiles = await api({ action: 'listDesignerProfiles' });
    expect((hiddenProfiles.profiles as Array<Record<string, unknown>>).some(profile => profile.account === account)).toBe(false);
    const designerSaved = await api({
      action: 'adminDesignerSave', account, expectedSettingsRow: saved.settingsRow,
      profile: {
        group: '影音', rotation: 9, avatar: 'https://example.com/avatar.png', poster: 'https://example.com/poster.png',
        musicUrl: 'https://example.com/music', musicStartAt: 5, quote: '影音設計 QA',
        skillMappings: [{ name: '短影音', type: '影音', stage: '後製' }],
        replyTemplates: { '範本 1': '影音剪輯回信內容' }, replyTemplateDefault: '範本 1'
      }
    }, token);
    expect(designerSaved).toMatchObject({
      ok: true, action: 'adminDesignerSave', changedTables: ['設定'],
      settingsRow: { '帳號': account, '設計師顯示': 'v', '技能': '短影音', '回信範本設定': JSON.stringify({ '範本 1': '影音剪輯回信內容' }), '預設回信範本': '範本 1' }
    });
    const activeProfiles = await api({ action: 'listDesignerProfiles' });
    expect((activeProfiles.profiles as Array<Record<string, unknown>>).find(profile => profile.account === account)).toMatchObject({
      name: 'Designer QA', designType: '影音', skillMappings: [{ name: '短影音', type: '影音', stage: '後製' }],
      replyTemplates: { '範本 1': '影音剪輯回信內容' }, replyTemplateDefault: '範本 1'
    });
    expect(githubPut).toHaveBeenCalledTimes(2);

    const stub = env.DATABASE_COORDINATOR.getByName('primary') as DurableObjectStub<DatabaseCoordinator>;
    const database = await runInDurableObject(stub, async (_instance, state) => {
      const stored = state.storage.sql.exec<{ json: string }>('SELECT json FROM database_state WHERE id = ?', 'primary').one();
      return JSON.parse(stored.json) as DatabaseSnapshot;
    });
    expect(database.tables['設定'].rows).toContainEqual(expect.objectContaining({ '帳號': account, '對話框': '影音設計 QA', '設計師顯示': 'v' }));
    expect(database.tables['帳號權限'].rows).toContainEqual(expect.objectContaining({ '帳號': account, '角色範本': '設計師' }));
  });

  it('bulk imports accounts from a parsed roster, skips invalid/duplicate rows, and commits once', async () => {
    const token = await login();
    const githubPut = vi.spyOn(globalThis, 'fetch').mockImplementation(async (_input, init) => {
      expect(init?.method).toBe('PUT');
      return Response.json({ content: { sha: 'bulk-import-file-sha' }, commit: { sha: 'bulk-import-commit-sha' } });
    });
    const imported = await api({
      action: 'adminAccountBulkImport',
      role: '一般使用者',
      employees: [
        { name: '蔡啓泓', department: '凱曜專案部', group: 'Poppy組', account: 'eric.tsai@emctaipei.com' },
        { name: '徐千涵', department: '凱曜管理部', group: '人資行政組', account: 'tina.hsu@emctaipei.com' },
        { name: '外部廠商', account: 'vendor@gmail.com' },
        { name: '', account: 'noname@emctaipei.com' },
        { name: '重複', account: 'Eric.Tsai@emctaipei.com' }
      ]
    }, token);
    expect(imported).toMatchObject({
      ok: true,
      created: ['eric.tsai@emctaipei.com', 'tina.hsu@emctaipei.com'],
      changedTables: ['設定', '帳號權限']
    });
    expect(imported.skipped as Array<Record<string, unknown>>).toHaveLength(3);
    expect(githubPut).toHaveBeenCalledTimes(1);

    const stub = env.DATABASE_COORDINATOR.getByName('primary') as DurableObjectStub<DatabaseCoordinator>;
    const database = await runInDurableObject(stub, async (_instance, state) => {
      const stored = state.storage.sql.exec<{ json: string }>('SELECT json FROM database_state WHERE id = ?', 'primary').one();
      return JSON.parse(stored.json) as DatabaseSnapshot;
    });
    expect(database.tables['設定'].rows).toContainEqual(expect.objectContaining({
      '帳號': 'eric.tsai@emctaipei.com', '名字': '蔡啓泓', '顯示名': '蔡啓泓', '部門': '專案部', '組別': 'Poppy組'
    }));
    // 「凱曜」是公司名稱，匯入時去掉前綴：凱曜管理部＝管理部。
    expect(database.tables['設定'].rows).toContainEqual(expect.objectContaining({ '帳號': 'tina.hsu@emctaipei.com', '部門': '管理部' }));
    expect(database.tables['帳號權限'].rows).toContainEqual(expect.objectContaining({
      '帳號': 'eric.tsai@emctaipei.com', '角色範本': '一般使用者', '狀態': '啟用', '登入方式': '公司信箱'
    }));

    // 重新匯入同一個帳號：視為已存在，略過，不會產生新的 GitHub commit。
    const reimported = await api({
      action: 'adminAccountBulkImport',
      employees: [{ name: '蔡啓泓', account: 'eric.tsai@emctaipei.com' }]
    }, token);
    expect(reimported).toMatchObject({ ok: true, created: [] });
    expect(githubPut).toHaveBeenCalledTimes(1);
  });

  it('creates a password-only account without email and logs in with its assigned role', async () => {
    const token = await login();
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (_input, init) => {
      expect(init?.method).toBe('PUT');
      return Response.json({ content: { sha: 'local-account-file-sha' }, commit: { sha: 'local-account-commit-sha' } });
    });
    const account = 'local:5f248437-c19c-4efa-9b03-18dce289b882';
    const password = 'qa-designer-2026';
    const saved = await api({
      action: 'adminAccountSave',
      account,
      loginPassword: password,
      expectSettingsMissing: true,
      expectPermissionMissing: true,
      settingsRow: {
        '帳號': account,
        '部門': '測試部',
        '組別': '自訂測試組',
        '名字': '權限測試員',
        '顯示名': '權限測試員'
      },
      permissionRow: {
        '帳號': account,
        '登入方式': '密碼',
        '角色範本': '唯讀',
        '狀態': '啟用',
        '頁面權限': JSON.stringify(['request']),
        '功能權限': JSON.stringify([])
      }
    }, token);
    expect(saved).toMatchObject({
      ok: true,
      account,
      permissionRow: { '登入方式': '密碼', '角色範本': '唯讀' }
    });
    expect(saved.permissionRow).toMatchObject({ _credentialConfigured: true });
    expect((saved.permissionRow as Record<string, unknown>)['密碼雜湊']).toBeUndefined();
    const stub = env.DATABASE_COORDINATOR.getByName('primary') as DurableObjectStub<DatabaseCoordinator>;
    const savedHash = await runInDurableObject(stub, async (_instance, state) => state.storage.sql.exec<{ password_hash: string }>(
      'SELECT password_hash FROM local_password_accounts WHERE account = ?', account
    ).one().password_hash);
    expect(savedHash).toMatch(/^pbkdf2-sha256\$100000\$/);
    expect(savedHash).not.toContain(password);

    const updated = await api({
      action: 'adminAccountSave',
      account,
      settingsRow: {
        ...(saved.settingsRow as Record<string, unknown>),
        '部門': '',
        '組別': '已修改測試組'
      },
      permissionRow: saved.permissionRow,
      expectedSettingsRow: saved.settingsRow,
      expectedPermissionRow: saved.permissionRow
    }, token);
    expect(updated).toMatchObject({
      ok: true,
      settingsRow: { '部門': '', '組別': '已修改測試組' },
      permissionRow: { '登入方式': '密碼', _credentialConfigured: true }
    });

    const signedIn = await api({ action: 'login', password });
    expect(signedIn).toMatchObject({
      ok: true,
      provider: 'password',
      account,
      email: '',
      user: '權限測試員',
      settings: { department: '', group: '已修改測試組' },
      access: { role: '唯讀', status: '啟用' }
    });
    expect(String(signedIn.token)).not.toBe('');

    const deleted = await api({
      action: 'adminAccountDelete',
      account,
      expectedSettingsRow: updated.settingsRow,
      expectedPermissionRow: updated.permissionRow
    }, token);
    expect(deleted).toMatchObject({ ok: true, action: 'adminAccountDelete', account });
    const afterDelete = await runInDurableObject(stub, async (_instance, state) => {
      const stored = state.storage.sql.exec<{ json: string }>('SELECT json FROM database_state WHERE id = ?', 'primary').one();
      return {
        database: JSON.parse(stored.json) as DatabaseSnapshot,
        credentials: state.storage.sql.exec<{ count: number }>('SELECT COUNT(*) AS count FROM local_password_accounts WHERE account = ?', account).one().count
      };
    });
    expect(afterDelete.database.tables['設定'].rows.some(row => row['帳號'] === account)).toBe(false);
    expect(afterDelete.database.tables['帳號權限'].rows.some(row => row['帳號'] === account)).toBe(false);
    expect(afterDelete.credentials).toBe(0);
    expect(await api({ action: 'login', password })).toMatchObject({ ok: false, error: '帳號或密碼不正確' });
  });

  it('adds, renames and deletes department/group options while synchronizing account values', async () => {
    const token = await login();
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (_input, init) => {
      expect(init?.method).toBe('PUT');
      return Response.json({ content: { sha: `organization-file-${crypto.randomUUID()}` }, commit: { sha: 'organization-commit' } });
    });
    const renamed = await api({ action: 'adminOrganizationOptionSave', kind: '部門', oldName: '測試組', name: '測試部門' }, token);
    expect(renamed).toMatchObject({ ok: true, kind: '部門', oldName: '測試組', name: '測試部門', affectedAccounts: 1 });
    const removed = await api({ action: 'adminOrganizationOptionDelete', kind: '部門', name: '測試部門' }, token);
    expect(removed).toMatchObject({ ok: true, kind: '部門', name: '測試部門', affectedAccounts: 1 });
    const stub = env.DATABASE_COORDINATOR.getByName('primary') as DurableObjectStub<DatabaseCoordinator>;
    const database = await runInDurableObject(stub, async (_instance, state) => {
      const stored = state.storage.sql.exec<{ json: string }>('SELECT json FROM database_state WHERE id = ?', 'primary').one();
      return JSON.parse(stored.json) as DatabaseSnapshot;
    });
    expect(database.tables['設定'].rows.find(row => row['帳號'] === 'test.user@emctaipei.com')?.['部門']).toBe('');
    expect(database.tables['組織選項'].rows.some(row => row['種類'] === '部門' && row['名稱'] === '測試部門')).toBe(false);
  });

  it('lets an account with only media.manage (no request.edit) save the design image source folder link, but still blocks other field edits', async () => {
    // 對應 26080059 案件過稿中無法填入 NAS 路徑的回報：production 的「設計師」角色範本目前沒有 request.edit，
    // 只靠 media.manage 授權「設定來源資料夾」這個動作，其餘一般欄位編輯仍然要 request.edit。
    await seedAccountPermission('test.user@emctaipei.com', '自訂', ['request.create', 'request.status', 'media.manage']);
    const tester = await api({ action: 'login', password: 'test' });
    const token = String(tester.token);
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (_input, init) => {
      expect(init?.method).toBe('PUT');
      return Response.json({ content: { sha: 'link-file-sha' }, commit: { sha: 'link-commit-sha' } });
    });

    const linkUpdate = await api({
      action: 'update',
      id: '26080001',
      row: { id: '26080001', designImageFolderUrl: '專案企劃部/執行中/客戶/案件資料夾' }
    }, token);
    expect(linkUpdate).toMatchObject({ ok: true, id: '26080001' });
    expect((linkUpdate.row as Record<string, unknown>).designImageFolderUrl).toBe('專案企劃部/執行中/客戶/案件資料夾');

    // 同一組操作也要能一起帶「設計圖檔名關鍵字」（NAS 資料夾選擇器同一個畫面收集，用來從
    // 共用月份資料夾裡篩出只屬於這個案件的檔案），一起送出時一樣只需要 media.manage。
    const linkAndKeywordUpdate = await api({
      action: 'update',
      id: '26080001',
      row: { id: '26080001', designImageFolderUrl: '專案企劃部/執行中/客戶/案件資料夾', designImageFolderKeyword: 'DJI_360II' }
    }, token);
    expect(linkAndKeywordUpdate).toMatchObject({ ok: true, id: '26080001' });
    expect((linkAndKeywordUpdate.row as Record<string, unknown>).designImageFolderKeyword).toBe('DJI_360II');

    // 單獨改關鍵字（重新設定既有資料夾的關鍵字，不動路徑）也只需要 media.manage。
    const keywordOnlyUpdate = await api({
      action: 'update',
      id: '26080001',
      row: { id: '26080001', designImageFolderKeyword: 'Epson_V4000' }
    }, token);
    expect(keywordOnlyUpdate).toMatchObject({ ok: true, id: '26080001' });

    // 多資料夾複選（2026-09 新增的「設計圖資料夾清單」JSON 陣列）跟舊的兩個單一欄位一起
    // 送出——同樣的操作（NAS 資料夾選擇器一次性寫回），一樣只需要 media.manage。
    const foldersJson = JSON.stringify([
      { path: '專案企劃部/執行中/客戶/案件資料夾A', keyword: 'DJI_360II' },
      { path: '專案企劃部/執行中/客戶/案件資料夾B', keyword: '' }
    ]);
    const multiFolderUpdate = await api({
      action: 'update',
      id: '26080001',
      row: {
        id: '26080001',
        designImageFolderUrl: '專案企劃部/執行中/客戶/案件資料夾A',
        designImageFolderKeyword: 'DJI_360II',
        designImageFolders: foldersJson
      }
    }, token);
    expect(multiFolderUpdate).toMatchObject({ ok: true, id: '26080001' });
    expect((multiFolderUpdate.row as Record<string, unknown>).designImageFolders).toBe(foldersJson);

    const editAttempt = await api({
      action: 'update',
      id: '26080001',
      row: { id: '26080001', client: '應該被擋下' }
    }, token);
    expect(editAttempt).toMatchObject({ ok: false, error: '此帳號沒有「request.edit」權限' });

    // 混著改其他一般欄位時，即使同一次也帶了資料夾連結，仍然要退回需要 request.edit，
    // 不能靠夾帶這兩個欄位繞過一般欄位編輯的權限限制。
    const mixedAttempt = await api({
      action: 'update',
      id: '26080001',
      row: { id: '26080001', designImageFolderUrl: '專案企劃部/執行中/客戶/案件資料夾', client: '不應該被放行' }
    }, token);
    expect(mixedAttempt).toMatchObject({ ok: false, error: '此帳號沒有「request.edit」權限' });

    // 混著改一般欄位時，即使同一次也帶了「設計圖資料夾清單」，同樣不能靠它繞過一般欄位編輯的限制。
    const mixedFoldersAttempt = await api({
      action: 'update',
      id: '26080001',
      row: { id: '26080001', designImageFolders: foldersJson, client: '不應該被放行' }
    }, token);
    expect(mixedFoldersAttempt).toMatchObject({ ok: false, error: '此帳號沒有「request.edit」權限' });
  });

  it('lets a media.manage account add and remove case design images from the modification log, blocking accounts without the capability', async () => {
    const tester = await api({ action: 'login', password: 'test' });
    const token = String(tester.token);
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (_input, init) => {
      expect(init?.method).toBe('PUT');
      return Response.json({ content: { sha: 'images-file-sha' }, commit: { sha: 'images-commit-sha' } });
    });

    const blocked = await api({
      action: 'removeCaseDesignImage',
      caseId: '26080001',
      round: 0,
      url: 'https://example.com/a.jpg'
    }, token);
    expect(blocked).toMatchObject({ ok: false, error: '此帳號沒有「media.manage」權限' });

    // 比照 26080059 案件過稿中的權限現況：正式資料庫的「設計師」角色範本沒有 request.edit，
    // 這裡只給 media.manage，驗證「瀏覽器選檔案上傳」與「修改紀錄彈窗刪除圖片」都只靠這個權限就能動作。
    await seedAccountPermission('test.user@emctaipei.com', '自訂', ['request.create', 'request.status', 'media.manage']);

    const added = await api({
      action: 'addCaseDesignImages',
      caseId: '26080001',
      round: 0,
      images: [
        { fileName: 'a.jpg', url: 'https://example.com/a.jpg' },
        { fileName: 'b.jpg', url: 'https://example.com/b.jpg' }
      ]
    }, token);
    expect(added).toMatchObject({ ok: true, caseId: '26080001', round: 0 });
    expect(added.images).toEqual([
      { fileName: 'a.jpg', url: 'https://example.com/a.jpg' },
      { fileName: 'b.jpg', url: 'https://example.com/b.jpg' }
    ]);

    const removed = await api({
      action: 'removeCaseDesignImage',
      caseId: '26080001',
      round: 0,
      url: 'https://example.com/a.jpg'
    }, token);
    expect(removed).toMatchObject({ ok: true, caseId: '26080001', round: 0 });
    expect(removed.images).toEqual([{ fileName: 'b.jpg', url: 'https://example.com/b.jpg' }]);

    const removeAgain = await api({
      action: 'removeCaseDesignImage',
      caseId: '26080001',
      round: 0,
      url: 'https://example.com/a.jpg'
    }, token);
    expect(removeAgain).toMatchObject({ ok: false, error: '找不到該張圖片' });
  });

  it('keeps a NAS file name immutable inside one revision while allowing the same file in the next revision', async () => {
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (_input, init) => {
      expect(init?.method).toBe('PUT');
      return Response.json({ content: { sha: 'nas-image-file-sha' }, commit: { sha: 'nas-image-commit-sha' } });
    });

    const draft = await api({
      action: 'addCaseDesignImages',
      serviceKey: 'test-nas-watcher-key',
      source: 'nas-watcher',
      caseId: '26080001',
      round: 0,
      images: [{ fileName: 'draft.png', url: 'https://example.com/draft-v1.jpg' }]
    });
    expect(draft.images).toEqual([{ fileName: 'draft.png', url: 'https://example.com/draft-v1.jpg' }]);

    const repeatedDraft = await api({
      action: 'addCaseDesignImages',
      serviceKey: 'test-nas-watcher-key',
      source: 'nas-watcher',
      caseId: '26080001',
      round: 0,
      images: [{ fileName: 'DRAFT.PNG', url: 'https://example.com/draft-v2.jpg' }]
    });
    expect(repeatedDraft.images).toEqual([{ fileName: 'draft.png', url: 'https://example.com/draft-v1.jpg' }]);
    expect(repeatedDraft.ignoredImages).toBe(1);

    const firstRevision = await api({
      action: 'addCaseDesignImages',
      serviceKey: 'test-nas-watcher-key',
      source: 'nas-watcher',
      caseId: '26080001',
      round: 1,
      images: [{ fileName: 'draft.png', url: 'https://example.com/revision-v1.jpg' }]
    });
    expect(firstRevision.images).toEqual([{ fileName: 'draft.png', url: 'https://example.com/revision-v1.jpg' }]);
    expect(firstRevision.ignoredImages).toBe(0);
  });

  it('lets a media.manage-only account save designer profiles for poster management', async () => {
    await seedAccountPermission('test.user@emctaipei.com', '自訂', ['media.manage']);
    const tester = await api({ action: 'login', password: 'test' });
    const token = String(tester.token);
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (_input, init) => {
      expect(init?.method).toBe('PUT');
      return Response.json({ content: { sha: 'designer-file-sha' }, commit: { sha: 'designer-commit-sha' } });
    });

    const saved = await api({
      action: 'saveDesignerProfiles',
      editorToken: token,
      profiles: [{
        name: 'Machi',
        poster: 'https://example.com/new-poster.jpg',
        replyTemplates: { '範本 1': '影音剪輯回信內容', '範本 2': '字幕字卡回信內容' }, replyTemplateDefault: '範本 2'
      }]
    }, token);
    expect(saved).toMatchObject({ ok: true, action: 'saveDesignerProfiles' });

    const stub = env.DATABASE_COORDINATOR.getByName('primary') as DurableObjectStub<DatabaseCoordinator>;
    const database = await runInDurableObject(stub, async (_instance, state) => {
      const stored = state.storage.sql.exec<{ json: string }>('SELECT json FROM database_state WHERE id = ?', 'primary').one();
      return JSON.parse(stored.json) as DatabaseSnapshot;
    });
    expect(database.tables['設定'].rows).toContainEqual(expect.objectContaining({
      '名字': 'Machi',
      '頭像大圖連結': 'https://example.com/new-poster.jpg',
      '回信範本設定': JSON.stringify({ '範本 1': '影音剪輯回信內容', '範本 2': '字幕字卡回信內容' }),
      '預設回信範本': '範本 2'
    }));
  });

  it('removes deleted Drive media references from settings and reels in one JSON commit', async () => {
    await seedAccountPermission('test.user@emctaipei.com', '自訂', ['media.manage']);
    const tester = await api({ action: 'login', password: 'test' });
    const token = String(tester.token);
    const avatarId = 'drive-avatar-file';
    const posterId = 'drive-poster-file';
    const storyId = 'drive-story-file';
    const stub = env.DATABASE_COORDINATOR.getByName('primary') as DurableObjectStub<DatabaseCoordinator>;
    await runInDurableObject(stub, async (_instance, state) => {
      const stored = state.storage.sql.exec<{ json: string }>('SELECT json FROM database_state WHERE id = ?', 'primary').one();
      const database = JSON.parse(stored.json) as DatabaseSnapshot;
      const profile = database.tables['設定'].rows.find(row => row['名字'] === 'Machi')!;
      profile['頭像連結'] = `https://drive.google.com/thumbnail?id=${avatarId}&sz=w1000`;
      profile['頭像大圖連結'] = `https://drive.google.com/thumbnail?id=${posterId}&sz=w1000`;
      database.tables.reels.rows.push({
        '名字': 'Machi',
        '限時動態連結': `https://lh3.googleusercontent.com/d/${storyId}=w1600`,
        '保留期限': '永久',
        '留言': '[]'
      });
      state.storage.sql.exec('UPDATE database_state SET json = ? WHERE id = ?', JSON.stringify(database), 'primary');
    });
    const githubPut = vi.spyOn(globalThis, 'fetch').mockImplementation(async (_input, init) => {
      expect(init?.method).toBe('PUT');
      return Response.json({ content: { sha: 'media-file-sha' }, commit: { sha: 'media-commit-sha' } });
    });

    const deleted = await api({
      action: 'deleteDesignerMediaFiles',
      designer: 'Machi',
      fileIds: [avatarId, posterId, storyId]
    }, token);
    expect(deleted).toMatchObject({
      ok: true,
      action: 'deleteDesignerMediaFiles',
      cleared: ['avatar', 'poster'],
      deletedStories: 1,
      changedTables: ['設定', 'reels'],
      githubCommitSha: 'media-commit-sha'
    });
    expect(githubPut).toHaveBeenCalledTimes(1);

    const database = await runInDurableObject(stub, async (_instance, state) => {
      const stored = state.storage.sql.exec<{ json: string }>('SELECT json FROM database_state WHERE id = ?', 'primary').one();
      return JSON.parse(stored.json) as DatabaseSnapshot;
    });
    const profile = database.tables['設定'].rows.find(row => row['名字'] === 'Machi')!;
    expect(profile['頭像連結']).toBe('');
    expect(profile['頭像大圖連結']).toBe('');
    // 圖片刪除後，reels 資料列改成下架（保留留言／按讚紀錄），不是整列消失。
    const storyRow = database.tables.reels.rows.find(row => String(row['限時動態連結']).includes(storyId));
    expect(storyRow).toBeTruthy();
    expect(storyRow?.['狀態']).toBe('下架');
    const listed = await api({ action: 'listReels' }, token);
    expect((listed.reels as Array<{ id: string }>).some(reel => reel.id === storyId)).toBe(false);
  });

  it('hides (not deletes) reel rows when a story is unset, preserving comments/likes, and republishing clears the hidden status', async () => {
    await seedAccountPermission('test.user@emctaipei.com', '自訂', ['media.manage', 'reel.interact']);
    const tester = await api({ action: 'login', password: 'test' });
    const token = String(tester.token);
    const storyId = 'drive-hide-story-file';
    const stub = env.DATABASE_COORDINATOR.getByName('primary') as DurableObjectStub<DatabaseCoordinator>;
    await runInDurableObject(stub, async (_instance, state) => {
      const stored = state.storage.sql.exec<{ json: string }>('SELECT json FROM database_state WHERE id = ?', 'primary').one();
      const database = JSON.parse(stored.json) as DatabaseSnapshot;
      // upsertDesignerStories 要求「設定」表裡存在一筆平面／影音組別的同名設計師。
      database.tables['設定'].rows.find(row => row['名字'] === 'Machi')!['組別'] = '平面';
      database.tables.reels.rows.push({
        '名字': 'Machi',
        '限時動態連結': `https://lh3.googleusercontent.com/d/${storyId}=w1600`,
        '保留期限': '永久',
        '按讚': '陳柏政',
        '倒讚': '',
        '留言': JSON.stringify([{ id: 'c1', name: '陳柏政', text: '好看', createdAt: new Date().toISOString() }])
      });
      state.storage.sql.exec('UPDATE database_state SET json = ? WHERE id = ?', JSON.stringify(database), 'primary');
    });
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (_input, init) => {
      expect(init?.method).toBe('PUT');
      return Response.json({ content: { sha: 'hide-file-sha' }, commit: { sha: 'hide-commit-sha' } });
    });

    // 上架時可見。
    expect((await api({ action: 'listReels' }, token)).reels).toContainEqual(expect.objectContaining({ id: storyId }));

    // 取消限時動態設定＝下架，不是刪除。
    const unset = await api({ action: 'deleteDesignerStories', designer: 'Machi', fileIds: [storyId] }, token);
    expect(unset).toMatchObject({ ok: true, action: 'deleteDesignerStories', deleted: 1 });
    const afterHide = await runInDurableObject(stub, async (_instance, state) => {
      const stored = state.storage.sql.exec<{ json: string }>('SELECT json FROM database_state WHERE id = ?', 'primary').one();
      return JSON.parse(stored.json) as DatabaseSnapshot;
    });
    const hiddenRow = afterHide.tables.reels.rows.find(row => String(row['限時動態連結']).includes(storyId))!;
    expect(hiddenRow['狀態']).toBe('下架');
    expect(hiddenRow['按讚']).toBe('陳柏政');
    expect(JSON.parse(String(hiddenRow['留言']))).toHaveLength(1);
    expect((await api({ action: 'listReels' }, token)).reels).not.toContainEqual(expect.objectContaining({ id: storyId }));

    // 重新設定成限時動態＝重新上架，留言／按讚紀錄依然保留。
    const republished = await api({
      action: 'upsertDesignerStories',
      designer: 'Machi',
      fileIds: [storyId],
      imageUrls: [`https://lh3.googleusercontent.com/d/${storyId}=w1600`],
      expiresAt: 0
    }, token);
    expect(republished).toMatchObject({ ok: true, action: 'upsertDesignerStories' });
    const afterRestore = await runInDurableObject(stub, async (_instance, state) => {
      const stored = state.storage.sql.exec<{ json: string }>('SELECT json FROM database_state WHERE id = ?', 'primary').one();
      return JSON.parse(stored.json) as DatabaseSnapshot;
    });
    const restoredRow = afterRestore.tables.reels.rows.find(row => String(row['限時動態連結']).includes(storyId))!;
    expect(restoredRow['狀態']).toBe('');
    expect(restoredRow['按讚']).toBe('陳柏政');
    expect(JSON.parse(String(restoredRow['留言']))).toHaveLength(1);
    expect((await api({ action: 'listReels' }, token)).reels).toContainEqual(expect.objectContaining({ id: storyId }));
  });

  it('lets an admin toggle a reel row hidden/visible via adminTableUpdate, preserving comments/likes', async () => {
    const token = await login();
    const storyId = 'drive-admin-toggle-story';
    const stub = env.DATABASE_COORDINATOR.getByName('primary') as DurableObjectStub<DatabaseCoordinator>;
    await runInDurableObject(stub, async (_instance, state) => {
      const stored = state.storage.sql.exec<{ json: string }>('SELECT json FROM database_state WHERE id = ?', 'primary').one();
      const database = JSON.parse(stored.json) as DatabaseSnapshot;
      database.tables.reels.rows.push({
        '名字': 'Machi',
        '限時動態連結': `https://lh3.googleusercontent.com/d/${storyId}=w1600`,
        '保留期限': '永久',
        '按讚': '陳柏政',
        '倒讚': '',
        '留言': JSON.stringify([{ id: 'c1', name: '陳柏政', text: '好看', createdAt: new Date().toISOString() }]),
        '狀態': ''
      });
      state.storage.sql.exec('UPDATE database_state SET json = ? WHERE id = ?', JSON.stringify(database), 'primary');
    });
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (_input, init) => {
      expect(init?.method).toBe('PUT');
      return Response.json({ content: { sha: 'admin-toggle-sha' }, commit: { sha: 'admin-toggle-commit-sha' } });
    });

    const rows = (await api({ action: 'adminTableRows', table: 'reels', limit: 1000 }, token)).rows as Array<Record<string, unknown>>;
    const row = rows.find(item => String(item['限時動態連結']).includes(storyId))!;
    expect(row).toBeTruthy();

    const hidden = await api({
      action: 'adminTableUpdate',
      table: 'reels',
      rowNumber: row._rowNumber,
      expectedRow: row,
      row: { ...row, '狀態': '下架' }
    }, token);
    expect(hidden).toMatchObject({ ok: true, action: 'adminTableUpdate', table: 'reels' });
    expect((await api({ action: 'listReels' }, token)).reels).not.toContainEqual(expect.objectContaining({ id: storyId }));

    const rowsAfterHide = (await api({ action: 'adminTableRows', table: 'reels', limit: 1000 }, token)).rows as Array<Record<string, unknown>>;
    const hiddenRow = rowsAfterHide.find(item => String(item['限時動態連結']).includes(storyId))!;
    expect(hiddenRow['狀態']).toBe('下架');
    expect(hiddenRow['按讚']).toBe('陳柏政');
    expect(JSON.parse(String(hiddenRow['留言']))).toHaveLength(1);

    const restored = await api({
      action: 'adminTableUpdate',
      table: 'reels',
      rowNumber: hiddenRow._rowNumber,
      expectedRow: hiddenRow,
      row: { ...hiddenRow, '狀態': '', '到期時間': '' }
    }, token);
    expect(restored).toMatchObject({ ok: true, action: 'adminTableUpdate', table: 'reels' });
    expect((await api({ action: 'listReels' }, token)).reels).toContainEqual(expect.objectContaining({ id: storyId }));
  });

  it('records unique viewer names for markReelViewed, is idempotent per person, and skips a GitHub commit on repeat views', async () => {
    const storyId = 'drive-view-tracking-story';
    const stub = env.DATABASE_COORDINATOR.getByName('primary') as DurableObjectStub<DatabaseCoordinator>;
    await runInDurableObject(stub, async (_instance, state) => {
      const stored = state.storage.sql.exec<{ json: string }>('SELECT json FROM database_state WHERE id = ?', 'primary').one();
      const database = JSON.parse(stored.json) as DatabaseSnapshot;
      database.tables.reels.rows.push({
        '名字': 'Machi',
        '限時動態連結': `https://lh3.googleusercontent.com/d/${storyId}=w1600`,
        '保留期限': '永久', '按讚': '', '倒讚': '', '留言': '[]', '狀態': ''
      });
      state.storage.sql.exec('UPDATE database_state SET json = ? WHERE id = ?', JSON.stringify(database), 'primary');
    });
    const githubPut = vi.spyOn(globalThis, 'fetch').mockImplementation(async (_input, init) => {
      expect(init?.method).toBe('PUT');
      return Response.json({ content: { sha: 'view-file-sha' }, commit: { sha: 'view-commit-sha' } });
    });
    await seedAccountPermission('viewer1@emctaipei.com', '自訂', ['reel.interact']);
    await seedAccountPermission('viewer2@emctaipei.com', '自訂', ['reel.interact']);
    const viewer1Token = await seedSession('viewer1@emctaipei.com', '陳柏政');
    const viewer2Token = await seedSession('viewer2@emctaipei.com', '許芷芸');

    const firstView = await api({ action: 'markReelViewed', reelId: storyId }, viewer1Token);
    expect(firstView).toMatchObject({ ok: true, action: 'markReelViewed' });
    expect((firstView.story as { viewers: string[] }).viewers).toEqual(['陳柏政']);
    expect((firstView.story as { viewerCount: number }).viewerCount).toBe(1);
    expect(githubPut).toHaveBeenCalledTimes(1);

    // 同一個人重複瀏覽同一則限動：不應該再多寫一次 GitHub commit（unchanged 短路）。
    const repeatView = await api({ action: 'markReelViewed', reelId: storyId }, viewer1Token);
    expect(repeatView).toMatchObject({ ok: true, unchanged: true });
    expect((repeatView.story as { viewers: string[] }).viewers).toEqual(['陳柏政']);
    expect(githubPut).toHaveBeenCalledTimes(1);

    // 另一個人第一次瀏覽：名字會累加，且真的觸發一次新的 commit。
    const secondViewer = await api({ action: 'markReelViewed', reelId: storyId }, viewer2Token);
    expect((secondViewer.story as { viewers: string[] }).viewers).toEqual(['陳柏政', '許芷芸']);
    expect((secondViewer.story as { viewerCount: number }).viewerCount).toBe(2);
    expect(githubPut).toHaveBeenCalledTimes(2);

    const listed = (await api({ action: 'listReels' }, viewer1Token)).reels as Array<{ id: string; viewerCount: number; viewers: string[] }>;
    const story = listed.find(item => item.id === storyId)!;
    expect(story.viewerCount).toBe(2);
    expect(story.viewers).toEqual(['陳柏政', '許芷芸']);

    const database = await runInDurableObject(stub, async (_instance, state) => {
      const stored = state.storage.sql.exec<{ json: string }>('SELECT json FROM database_state WHERE id = ?', 'primary').one();
      return JSON.parse(stored.json) as DatabaseSnapshot;
    });
    const row = database.tables.reels.rows.find(item => String(item['限時動態連結']).includes(storyId))!;
    expect(row['已讀']).toBe('陳柏政 , 許芷芸');

    const denied = await api({ action: 'markReelViewed', reelId: storyId });
    expect(denied.ok).toBe(false);
  });

  it('derives 繳交時間 from the initial-draft record and never from status changes', async () => {
    const token = await login();
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (_input, init) => {
      expect(init?.method).toBe('PUT');
      return Response.json({ content: { sha: 'status-file-sha' }, commit: { sha: 'status-commit-sha' } });
    });

    const stub = env.DATABASE_COORDINATOR.getByName('primary') as DurableObjectStub<DatabaseCoordinator>;
    const submittedAtFor = async (): Promise<string> => {
      const database = await runInDurableObject(stub, async (_instance, state) => {
        const stored = state.storage.sql.exec<{ json: string }>('SELECT json FROM database_state WHERE id = ?', 'primary').one();
        return JSON.parse(stored.json) as DatabaseSnapshot;
      });
      return String(database.tables.database.rows.find(row => row['案件編號'] === '26080001')?.['繳交時間']);
    };

    const toReview = await api({ action: 'update', id: '26080001', row: { id: '26080001', status: '過稿中' } }, token);
    expect(toReview).toMatchObject({ ok: true, id: '26080001' });
    expect(await submittedAtFor()).toBe('');

    const initialDraft = await api({
      action: 'addCaseDesignImages',
      caseId: '26080001',
      round: 0,
      images: [{ fileName: 'initial.jpg', url: 'https://example.com/initial.jpg' }]
    }, token);
    const draftCreatedAt = String((initialDraft.record as Record<string, unknown>)['建立日期']);
    expect(draftCreatedAt).toMatch(/^\d{4}\/\d{2}\/\d{2} \d{2}:\d{2}:\d{2}$/);
    expect(await submittedAtFor()).toBe(draftCreatedAt);

    await api({ action: 'update', id: '26080001', row: { id: '26080001', status: '執行中' } }, token);
    await api({ action: 'update', id: '26080001', row: { id: '26080001', status: '過稿中' } }, token);
    expect(await submittedAtFor()).toBe(draftCreatedAt);
  });

  it('renaming a weight stage carries existing cases along so scores survive, while 下架 keeps scoring and delete does not', async () => {
    const token = await login();
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (_input, init) => {
      expect(init?.method).toBe('PUT');
      return Response.json({ content: { sha: 'weight-file-sha' }, commit: { sha: 'weight-commit-sha' } });
    });

    const stub = env.DATABASE_COORDINATOR.getByName('primary') as DurableObjectStub<DatabaseCoordinator>;
    const snapshot = async () => runInDurableObject(stub, async (_instance, state) => {
      const stored = state.storage.sql.exec<{ json: string }>('SELECT json FROM database_state WHERE id = ?', 'primary').one();
      return JSON.parse(stored.json) as DatabaseSnapshot;
    });
    // Give the seeded case a scoreable 平面/後製 combination.
    await runInDurableObject(stub, async (_instance, state) => {
      const stored = state.storage.sql.exec<{ json: string }>('SELECT json FROM database_state WHERE id = ?', 'primary').one();
      const database = JSON.parse(stored.json) as DatabaseSnapshot;
      const row = database.tables.database.rows.find(item => String(item['案件編號']) === '26080001')!;
      row['設計種類'] = '平面'; row['階段'] = '後製'; row['數量'] = '10'; row['項目細節'] = '影音包框, 修圖';
      state.storage.sql.exec('UPDATE database_state SET json = ? WHERE id = ?', JSON.stringify(database), 'primary');
    });

    const caseRow = async () => (await snapshot()).tables.database.rows.find(row => String(row['案件編號']) === '26080001')!;
    const ruleRow = async (stage: string, detail: string) => (await snapshot()).tables['加權計分標準'].rows
      .find(row => row['設計種類'] === '平面' && row['階段'] === stage && row['項目細節'] === detail);

    const renamed = await api({ action: 'adminWeightScopeSave', type: '平面', stage: '後製', newStage: '後期' }, token);
    expect(renamed).toMatchObject({ ok: true, renamedCases: 1, changedTables: ['加權計分標準', 'database'] });
    expect((await caseRow())['階段']).toBe('後期');
    expect((await caseRow())['加權']).toBe('25');

    const detailRenamed = await api({ action: 'adminWeightScopeSave', type: '平面', stage: '後期', detail: '影音包框', newDetail: '包框影片' }, token);
    expect(detailRenamed).toMatchObject({ ok: true, renamedCases: 1 });
    // Only the matching entry of the multi-value field changes; the rest keep their order and separator.
    expect((await caseRow())['項目細節']).toBe('包框影片, 修圖');
    expect((await caseRow())['加權']).toBe('25');

    const hidden = await api({ action: 'adminWeightScopeSave', type: '平面', stage: '後期', detail: '包框影片', status: '下架' }, token);
    expect(hidden).toMatchObject({ ok: true });
    expect((await ruleRow('後期', '包框影片'))?.['狀態']).toBe('下架');
    expect((await caseRow())['加權']).toBe('25');

    const removed = await api({ action: 'adminWeightScopeDelete', type: '平面', stage: '後期', detail: '包框影片' }, token);
    expect(removed).toMatchObject({ ok: true, removedRules: 1, affectedCases: 1 });
    expect((await caseRow())['加權']).toBe('5');

    const badStatus = await api({ action: 'adminWeightScopeSave', type: '平面', stage: '後期', status: '停用' }, token);
    expect(badStatus).toMatchObject({ ok: false });
  });

  it('deleting a case clears its modification records and supplement links so a reused case id starts clean', async () => {
    const token = await login();
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (_input, init) => {
      expect(init?.method).toBe('PUT');
      return Response.json({ content: { sha: 'cascade-file-sha' }, commit: { sha: 'cascade-commit-sha' } });
    });

    await api({ action: 'addModificationRecord', record: { caseId: '26080001', modifyDate: '2026-09-10', content: '一修內容' } }, token);
    await api({ action: 'addModificationRecord', record: { caseId: '26080001', modifyDate: '2026-09-10', content: '二修內容' } }, token);
    await api({ action: 'update', id: '26080001', row: { briefUrl: 'https://example.com/brief-old' }, writeHeaders: ['設計簡報連結'] }, token);

    const stub = env.DATABASE_COORDINATOR.getByName('primary') as DurableObjectStub<DatabaseCoordinator>;
    const snapshot = async () => runInDurableObject(stub, async (_instance, state) => {
      const stored = state.storage.sql.exec<{ json: string }>('SELECT json FROM database_state WHERE id = ?', 'primary').one();
      return JSON.parse(stored.json) as DatabaseSnapshot;
    });
    const countFor = (database: DatabaseSnapshot, table: string) =>
      database.tables[table].rows.filter(row => String(row['案件編號']) === '26080001').length;

    const before = await snapshot();
    expect(countFor(before, '修改統計表')).toBe(2);
    expect(countFor(before, '補充資料連結')).toBe(1);

    const deleted = await api({ action: 'delete', id: '26080001' }, token);
    expect(deleted).toMatchObject({ ok: true, id: '26080001', removedModificationRows: 2, removedSupplementRows: 1 });
    expect(deleted.changedTables).toEqual(['database', '修改統計表', '補充資料連結']);

    // Case ids are "highest number this month + 1", so the next case reuses the deleted id -- leaving
    // these rows behind is what made a brand new case open with the previous case's rounds and images.
    const after = await snapshot();
    expect(countFor(after, '修改統計表')).toBe(0);
    expect(countFor(after, '補充資料連結')).toBe(0);
    expect(after.tables.database.rows.some(row => String(row['案件編號']) === '26080001')).toBe(false);
  });

  it('listCustomers returns the live 客戶別 rows (so a just-saved 預設信箱 applies before GitHub Pages catches up) without a login', async () => {
    await seedCustomerOwner('即時客戶', 'pm@emctaipei.com');
    const listed = await api({ action: 'listCustomers' });
    expect(listed.ok).toBe(true);
    expect((listed.rows as Array<Record<string, unknown>>).some(row => row['客戶別'] === '即時客戶')).toBe(true);
  });

  it('keeps text hyperlinks of a modification request (修改內容連結), dropping unsafe or unrelated links', async () => {
    const token = await login();
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (_input, init) => {
      expect(init?.method).toBe('PUT');
      return Response.json({ content: { sha: 'links-file-sha' }, commit: { sha: 'links-commit-sha' } });
    });
    const saved = await api({
      action: 'addModificationRecord',
      record: {
        caseId: '26080001', modifyDate: '2026-09-17', content: '需要調整封面，詳細請看：調整需求。',
        links: [
          { text: '調整需求', url: 'https://docs.google.com/document/d/abc' },
          { text: '調整需求', url: 'https://docs.google.com/document/d/abc' },
          { text: '惡意', url: 'javascript:alert(1)' },
          { text: '不在內文', url: 'https://example.com/other' }
        ]
      }
    }, token);
    expect(saved).toMatchObject({ ok: true, count: 1 });
    expect(JSON.parse(String((saved.record as Record<string, unknown>)['修改內容連結']))).toEqual([
      { text: '調整需求', url: 'https://docs.google.com/document/d/abc' }
    ]);
    const plain = await api({ action: 'addModificationRecord', record: { caseId: '26080001', modifyDate: '2026-09-17', content: '沒有連結' } }, token);
    expect((plain.record as Record<string, unknown>)['修改內容連結']).toBe('');
  });

  it('creates a missing 初稿 (round 0) on demand and deletes a whole modification round without renumbering the rest', async () => {
    const token = await login();
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (_input, init) => {
      expect(init?.method).toBe('PUT');
      return Response.json({ content: { sha: 'draft-file-sha' }, commit: { sha: 'draft-commit-sha' } });
    });

    // Unchanged default: the first record is 一修, so a case that never went through NAS auto-backup
    // (which is what normally creates 初稿) could not get a 初稿 at all before this.
    const firstModification = await api({
      action: 'addModificationRecord',
      record: { caseId: '26080001', modifyDate: '2026-09-10', content: '一修內容' }
    }, token);
    expect(firstModification).toMatchObject({ ok: true, count: 1 });

    // draft:true creates round 0 and marks it confirmed immediately -- a 初稿 is complete by
    // definition and must not be counted as an outstanding modification request.
    const draftRecord = await api({
      action: 'addModificationRecord',
      record: { caseId: '26080001', modifyDate: '2026-09-08', content: '初稿完成', draft: true }
    }, token);
    expect(draftRecord).toMatchObject({ ok: true, count: 0, changedTables: ['修改統計表', 'database'] });
    expect((draftRecord.record as Record<string, unknown>)['修改次數']).toBe('0');
    expect((draftRecord.record as Record<string, unknown>)['確認修正日']).toBeTruthy();

    const duplicate = await api({
      action: 'addModificationRecord',
      record: { caseId: '26080001', modifyDate: '2026-09-08', content: '又一個初稿', draft: true }
    }, token);
    expect(duplicate).toMatchObject({ ok: false });
    expect(String(duplicate.error)).toMatch(/已經有初稿/);

    const stub = env.DATABASE_COORDINATOR.getByName('primary') as DurableObjectStub<DatabaseCoordinator>;
    const roundsOf = async () => {
      const database = await runInDurableObject(stub, async (_instance, state) => {
        const stored = state.storage.sql.exec<{ json: string }>('SELECT json FROM database_state WHERE id = ?', 'primary').one();
        return JSON.parse(stored.json) as DatabaseSnapshot;
      });
      return database.tables['修改統計表'].rows
        .filter(row => String(row['案件編號']) === '26080001')
        .map(row => Number(row['修改次數']) || 0)
        .sort((a, b) => a - b);
    };
    expect(await roundsOf()).toEqual([0, 1]);

    const deleted = await api({ action: 'deleteModificationRecord', caseId: '26080001', count: 1 }, token);
    expect(deleted).toMatchObject({ ok: true, count: 1, changedTables: ['修改統計表', 'database'] });
    // Round 0 keeps its own number: renumbering would rewrite the other records' identities and
    // desync the NAS watcher's per-file assignedRound bookkeeping.
    expect(await roundsOf()).toEqual([0]);

    const missing = await api({ action: 'deleteModificationRecord', caseId: '26080001', count: 9 }, token);
    expect(missing).toMatchObject({ ok: false });
    expect(String(missing.error)).toMatch(/找不到指定的修改紀錄/);
  });

  it('moves a case to 修改中 when a new modification request comes in, but not for a 初稿 and never revives a cancelled case', async () => {
    const token = await login();
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (_input, init) => {
      expect(init?.method).toBe('PUT');
      return Response.json({ content: { sha: `status-file-${crypto.randomUUID()}` }, commit: { sha: 'status-commit-sha' } });
    });
    const stub = env.DATABASE_COORDINATOR.getByName('primary') as DurableObjectStub<DatabaseCoordinator>;
    const statusOf = () => runInDurableObject(stub, async (_instance, state) => {
      const stored = state.storage.sql.exec<{ json: string }>('SELECT json FROM database_state WHERE id = ?', 'primary').one();
      return (JSON.parse(stored.json) as DatabaseSnapshot).tables.database.rows.find(row => row['案件編號'] === '26080001')?.['狀態'];
    });
    const setStatus = (status: string) => runInDurableObject(stub, async (_instance, state) => {
      const stored = state.storage.sql.exec<{ json: string }>('SELECT json FROM database_state WHERE id = ?', 'primary').one();
      const database = JSON.parse(stored.json) as DatabaseSnapshot;
      database.tables.database.rows.find(row => row['案件編號'] === '26080001')!['狀態'] = status;
      state.storage.sql.exec('UPDATE database_state SET json = ? WHERE id = ?', JSON.stringify(database), 'primary');
    });

    // 初稿不是修改需求，狀態不動。
    await setStatus('過稿中');
    const draftRecord = await api({ action: 'addModificationRecord', record: { caseId: '26080001', modifyDate: '2026-09-15', content: '初稿完成', draft: true } }, token);
    expect(draftRecord).toMatchObject({ ok: true, count: 0 });
    expect(await statusOf()).toBe('過稿中');

    // 一修進來：過稿中 → 修改中，並回傳給前台同步畫面用的欄位。
    const first = await api({ action: 'addModificationRecord', record: { caseId: '26080001', modifyDate: '2026-09-15', content: '一修內容' } }, token);
    expect(first).toMatchObject({ ok: true, count: 1, status: '修改中', previousStatus: '過稿中', statusChanged: true });
    expect(await statusOf()).toBe('修改中');

    // 已經是修改中：不重複改，statusChanged 為 false。
    const second = await api({ action: 'addModificationRecord', record: { caseId: '26080001', modifyDate: '2026-09-15', content: '二修內容' } }, token);
    expect(second).toMatchObject({ ok: true, count: 2, status: '修改中', statusChanged: false });

    // 已取消的案件不會因為一筆修改紀錄被救回來。
    await setStatus('已取消');
    const cancelled = await api({ action: 'addModificationRecord', record: { caseId: '26080001', modifyDate: '2026-09-15', content: '三修內容' } }, token);
    expect(cancelled).toMatchObject({ ok: true, count: 3, status: '已取消', statusChanged: false });
    expect(await statusOf()).toBe('已取消');
  });

  it('does not add a second 修改紀錄 round when the same modification request is written twice within minutes (one mail both scheduled and sent now)', async () => {
    const token = await login();
    let commits = 0;
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (_input, init) => {
      expect(init?.method).toBe('PUT');
      commits += 1;
      return Response.json({ content: { sha: `dup-file-${crypto.randomUUID()}` }, commit: { sha: 'dup-commit-sha' } });
    });
    const stub = env.DATABASE_COORDINATOR.getByName('primary') as DurableObjectStub<DatabaseCoordinator>;
    const roundsOf = () => runInDurableObject(stub, async (_instance, state) => {
      const stored = state.storage.sql.exec<{ json: string }>('SELECT json FROM database_state WHERE id = ?', 'primary').one();
      return (JSON.parse(stored.json) as DatabaseSnapshot).tables['修改統計表'].rows
        .filter(row => row['案件編號'] === '26080001').map(row => `${row['修改次數']}:${row['修改內容']}`);
    });
    const add = (content: string) => api({ action: 'addModificationRecord', record: { caseId: '26080001', modifyDate: '2026-09-21', content } }, token);
    vi.useFakeTimers({ toFake: ['Date'] });
    try {
      // 15:15:16 排程建立時記錄一次。
      vi.setSystemTime(new Date('2026-09-21T07:15:16Z'));
      const first = await add('客戶有想要微調');
      expect(first).toMatchObject({ ok: true });
      expect(first.deduplicated).toBeUndefined();
      const baseCount = Number(first.count);
      const commitsAfterFirst = commits;

      // 15:15:19（三秒後，案件 26090053 實際發生的情況）又寫一次同樣內容：不新增一輪、不寫入 GitHub、回傳既有那一輪。
      vi.setSystemTime(new Date('2026-09-21T07:15:19Z'));
      const duplicate = await add('客戶有想要微調');
      expect(duplicate).toMatchObject({ ok: true, deduplicated: true, count: baseCount, statusChanged: false });
      expect(commits).toBe(commitsAfterFirst);
      expect(await roundsOf()).toEqual([`${baseCount}:客戶有想要微調`]);

      // 內容不同就是新的一輪。
      vi.setSystemTime(new Date('2026-09-21T07:16:00Z'));
      expect(await add('另一個修改')).toMatchObject({ ok: true, count: baseCount + 1 });
      expect(await roundsOf()).toHaveLength(2);

      // 超過 10 分鐘才又送同樣內容，視為使用者刻意再要求一次，新增一輪。
      vi.setSystemTime(new Date('2026-09-21T07:30:00Z'));
      expect(await add('另一個修改')).toMatchObject({ ok: true, count: baseCount + 2 });

      // 設計師已經確認過最新一輪之後，同樣內容也是新的一輪（不是重複寫入）。
      const confirmed = await api({ action: 'updateModificationConfirm', record: { caseId: '26080001', count: baseCount + 2 } }, token);
      expect(confirmed).toMatchObject({ ok: true });
      vi.setSystemTime(new Date('2026-09-21T07:31:00Z'));
      expect(await add('另一個修改')).toMatchObject({ ok: true, count: baseCount + 3 });
      expect(await roundsOf()).toHaveLength(4);
    } finally {
      vi.useRealTimers();
    }
  });

  it('recalculates the database row 修改次數 whenever a modification round is added, but only reduces it on an explicit admin delete', async () => {
    const token = await login();
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (_input, init) => {
      expect(init?.method).toBe('PUT');
      return Response.json({ content: { sha: 'mod-file-sha' }, commit: { sha: 'mod-commit-sha' } });
    });

    const first = await api({
      action: 'addModificationRecord',
      record: { caseId: '26080001', modifyDate: '2026-08-13', content: '一修內容' }
    }, token);
    expect(first).toMatchObject({ ok: true, count: 1, changedTables: ['修改統計表', 'database'] });

    const second = await api({
      action: 'addModificationRecord',
      record: { caseId: '26080001', modifyDate: '2026-08-14', content: '二修內容' }
    }, token);
    expect(second).toMatchObject({ ok: true, count: 2 });

    const stub = env.DATABASE_COORDINATOR.getByName('primary') as DurableObjectStub<DatabaseCoordinator>;
    const afterAdd = await runInDurableObject(stub, async (_instance, state) => {
      const stored = state.storage.sql.exec<{ json: string }>('SELECT json FROM database_state WHERE id = ?', 'primary').one();
      return JSON.parse(stored.json) as DatabaseSnapshot;
    });
    expect(afterAdd.tables.database.rows.find(row => row['案件編號'] === '26080001')?.['修改次數']).toBe('2');

    const deleted = await api({
      action: 'adminTableDelete',
      table: '修改統計表',
      rowNumber: 3
    }, token);
    expect(deleted).toMatchObject({ ok: true, changedTables: ['修改統計表', 'database'] });

    const afterDelete = await runInDurableObject(stub, async (_instance, state) => {
      const stored = state.storage.sql.exec<{ json: string }>('SELECT json FROM database_state WHERE id = ?', 'primary').one();
      return JSON.parse(stored.json) as DatabaseSnapshot;
    });
    expect(afterDelete.tables.database.rows.find(row => row['案件編號'] === '26080001')?.['修改次數']).toBe('1');
  });

  it('drops the deprecated 時間標記 header while keeping 修改次數 in adminTables, and filters adminTableRows by structured field match', async () => {
    const token = await login();
    const tables = await api({ action: 'adminTables' }, token);
    const databaseHeaders = ((tables.tables as Record<string, { headers: string[] }>).database).headers;
    expect(databaseHeaders).not.toContain('時間標記');
    expect(databaseHeaders).toContain('修改次數');
    expect(databaseHeaders.indexOf('修改次數')).toBe(databaseHeaders.indexOf('狀態') - 1);

    const stub = env.DATABASE_COORDINATOR.getByName('primary') as DurableObjectStub<DatabaseCoordinator>;
    await runInDurableObject(stub, async (_instance, state) => {
      const stored = state.storage.sql.exec<{ json: string }>('SELECT json FROM database_state WHERE id = ?', 'primary').one();
      const database = JSON.parse(stored.json) as DatabaseSnapshot;
      database.tables.database.rows.push({ '案件編號': '26080002', '客戶別': '測試客戶', '狀態': '過稿中' });
      state.storage.sql.exec('UPDATE database_state SET json = ? WHERE id = ?', JSON.stringify(database), 'primary');
    });

    const filtered = await api({ action: 'adminTableRows', table: 'database', filters: { '狀態': '過稿中' } }, token);
    expect((filtered.rows as Record<string, unknown>[]).map(row => row['案件編號'])).toEqual(['26080002']);
    expect(filtered.total).toBe(1);

    const unfiltered = await api({ action: 'adminTableRows', table: 'database' }, token);
    expect(unfiltered.total).toBe(2);
  });

  it('keeps each designer\'s signature presets with their profile, so 設計師設定 can edit them too', async () => {
    const token = await login();
    vi.spyOn(globalThis, 'fetch').mockImplementation(async () => Response.json({ content: { sha: 'designer-sig-sha' }, commit: { sha: 'designer-sig-commit' } }));
    // 測試資料裡的 Machi 組別是「管理者」，不算設計師列；先設成平面，listDesignerProfiles 才會列出來。
    const stub = env.DATABASE_COORDINATOR.getByName('primary') as DurableObjectStub<DatabaseCoordinator>;
    await runInDurableObject(stub, async (_instance, state) => {
      const stored = state.storage.sql.exec<{ json: string }>('SELECT json FROM database_state WHERE id = ?', 'primary').one();
      const database = JSON.parse(stored.json) as DatabaseSnapshot;
      database.tables['設定'].rows.find(row => row['名字'] === 'Machi')!['組別'] = '平面';
      state.storage.sql.exec('UPDATE database_state SET json = ? WHERE id = ?', JSON.stringify(database), 'primary');
    });

    const saved = await api({
      action: 'saveDesignerProfiles',
      profiles: [{
        name: 'Machi',
        signaturePresets: { '正常': 'Machi Chen<br>EMC', '休假': '休假中，請聯絡 Anna', '': '空名稱要被濾掉' },
        signaturePresetDefault: '休假'
      }]
    }, token);
    expect(saved).toMatchObject({ ok: true, action: 'saveDesignerProfiles' });

    const profiles = await api({ action: 'listDesignerProfiles' }, token);
    const machi = (profiles.profiles as Record<string, unknown>[]).find(profile => profile.name === 'Machi');
    expect(machi?.signaturePresets).toEqual({ '正常': 'Machi Chen<br>EMC', '休假': '休假中，請聯絡 Anna' });
    expect(machi?.signaturePresetDefault).toBe('休假');

    // 預設值指到不存在的名稱時，會退回第一組，不會留下壞掉的預設。
    await api({ action: 'saveDesignerProfiles', profiles: [{ name: 'Machi', signaturePresets: { '正常': 'Machi Chen' }, signaturePresetDefault: '休假' }] }, token);
    const after = await api({ action: 'listDesignerProfiles' }, token);
    const updated = (after.profiles as Record<string, unknown>[]).find(profile => profile.name === 'Machi');
    expect(updated?.signaturePresets).toEqual({ '正常': 'Machi Chen' });
    expect(updated?.signaturePresetDefault).toBe('正常');

    // 沒有帶 signaturePresets 的更新不可以把既有簽名檔洗掉。
    await api({ action: 'saveDesignerProfiles', profiles: [{ name: 'Machi', quote: '今天也把需求整理得清清楚楚' }] }, token);
    const untouched = await api({ action: 'listDesignerProfiles' }, token);
    const kept = (untouched.profiles as Record<string, unknown>[]).find(profile => profile.name === 'Machi');
    expect(kept?.signaturePresets).toEqual({ '正常': 'Machi Chen' });
  });

  it('moves selected design images from one modification round to another without touching Drive', async () => {
    const token = await login();
    vi.spyOn(globalThis, 'fetch').mockImplementation(async () => Response.json({ content: { sha: 'move-file-sha' }, commit: { sha: 'move-commit-sha' } }));
    const draft = [
      { fileName: 'a.jpg', url: 'https://lh3.googleusercontent.com/d/a' },
      { fileName: 'b.jpg', url: 'https://lh3.googleusercontent.com/d/b' },
      { fileName: 'c.jpg', url: 'https://lh3.googleusercontent.com/d/c' }
    ];
    await api({ action: 'addCaseDesignImages', serviceKey: 'test-nas-watcher-key', caseId: '26080001', round: 0, images: draft });
    await api({ action: 'addCaseDesignImages', serviceKey: 'test-nas-watcher-key', caseId: '26080001', round: 1, images: [{ fileName: 'd.jpg', url: 'https://lh3.googleusercontent.com/d/d' }] });

    const moved = await api({
      action: 'moveCaseDesignImages',
      caseId: '26080001',
      toRound: 1,
      images: [
        { round: 0, url: 'https://lh3.googleusercontent.com/d/b' },
        { round: 0, url: 'https://lh3.googleusercontent.com/d/c' },
        { round: 1, url: 'https://lh3.googleusercontent.com/d/d' },
        { round: 0, url: 'https://lh3.googleusercontent.com/d/missing' }
      ]
    }, token);
    // 已經在目標輪次的、以及找不到的，都只是略過，不影響其他張。
    expect(moved).toMatchObject({ ok: true, action: 'moveCaseDesignImages', caseId: '26080001', toRound: 1, moved: 2, skipped: 2 });

    const records = await api({ action: 'listModificationRecords', ids: ['26080001'] }, token);
    const rows = records.rows as Record<string, unknown>[];
    const imagesOf = (round: number) => JSON.parse(String(rows.find(row => Number(row['修改次數']) === round)?.['圖片連結'] || '[]')) as { fileName: string; url: string }[];
    expect(imagesOf(0).map(image => image.fileName)).toEqual(['a.jpg']); // 搬走的圖要從初稿移除
    expect(imagesOf(1).map(image => image.fileName)).toEqual(['d.jpg', 'b.jpg', 'c.jpg']); // 檔名與網址原樣搬到一修
    expect(String(rows.find(row => Number(row['修改次數']) === 1)?.['圖片來源'])).toBe('manual-move');

    // 目標輪次不存在時要明確擋下來，不可以自動生出一輪。
    const missingRound = await api({ action: 'moveCaseDesignImages', caseId: '26080001', toRound: 5, images: [{ round: 0, url: 'https://lh3.googleusercontent.com/d/a' }] }, token);
    expect(missingRound).toMatchObject({ ok: false });
    expect(String(missingRound.error)).toContain('請先建立那一輪');

    // 沒有 media.manage 權限不能搬。
    const tester = await api({ action: 'login', password: 'test' });
    const denied = await api({ action: 'moveCaseDesignImages', caseId: '26080001', toRound: 1, images: [{ round: 0, url: 'https://lh3.googleusercontent.com/d/a' }] }, String(tester.token));
    expect(denied).toMatchObject({ ok: false });
    expect(String(denied.error)).toContain('media.manage');
  });

  it('treats the designer-reply photo backup as done when Apps Script already recorded the images, even if Google fails to return the result page', async () => {
    const token = await login();
    const tinyPng = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';
    const stub = env.DATABASE_COORDINATOR.getByName('primary') as DurableObjectStub<DatabaseCoordinator>;
    const state = await runInDurableObject(stub, async (_instance, doState) => doState);
    // 模擬 Apps Script 執行完成時已經回頭寫入修改紀錄（addCaseDesignImages），然後才回 302。
    const recordUploaded = (fileName: string) => {
      const stored = state.storage.sql.exec<{ json: string }>('SELECT json FROM database_state WHERE id = ?', 'primary').one();
      const database = JSON.parse(stored.json) as DatabaseSnapshot;
      database.tables['修改統計表'].rows.push({ '案件編號': '26080001', '修改次數': '1', '修改內容': '一修', '圖片連結': JSON.stringify([{ fileName, url: 'https://lh3.googleusercontent.com/d/uploaded' }]), '圖片來源': 'mail-inline-upload' });
      state.storage.sql.exec('UPDATE database_state SET json = ? WHERE id = ?', JSON.stringify(database), 'primary');
    };
    const requested: string[] = [];
    vi.spyOn(globalThis, 'fetch').mockImplementation(async input => {
      const url = String(input);
      requested.push(url);
      if (url.startsWith('https://script.google.com/')) {
        recordUploaded('reply-photo.png');
        return new Response(null, { status: 302, headers: { location: 'https://script.googleusercontent.com/macros/echo?user_content_key=x' } });
      }
      return new Response('<html>找不到網頁</html>', { status: 404 });
    });
    const result = await api({ action: 'backupReplyInlineImages', caseId: '26080001', round: 1, images: [{ fileName: 'reply-photo.png', mimeType: 'image/png', base64: tinyPng }] }, token);
    expect(result).toMatchObject({ ok: true, count: 1, confirmedByDatabase: true });
    expect(requested.some(url => url.includes('googleusercontent.com/macros/echo'))).toBe(false);

    // 沒有寫入、結果頁又是錯誤頁：回報可以理解的錯誤，而不是「回應格式錯誤」。
    requested.length = 0;
    vi.spyOn(globalThis, 'fetch').mockImplementation(async input => {
      const url = String(input);
      requested.push(url);
      if (url.startsWith('https://script.google.com/')) return new Response(null, { status: 302, headers: { location: 'https://script.googleusercontent.com/macros/echo?user_content_key=y' } });
      return new Response('<html>找不到網頁</html>', { status: 404 });
    });
    const failed = await api({ action: 'backupReplyInlineImages', caseId: '26080001', round: 1, images: [{ fileName: 'never-saved.png', mimeType: 'image/png', base64: tinyPng }] }, token);
    expect(failed).toMatchObject({ ok: false });
    expect(String(failed.error)).toContain('暫時沒有回應');
    expect(requested.some(url => url.includes('user_content_key=y'))).toBe(true);
  });

  it('backs up photos uploaded inside a designer reply into the reply round of 修改紀錄 via the Apps Script case design uploader', async () => {
    const token = await login();
    const tinyPng = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';
    let sent: Record<string, unknown> | null = null;
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
      expect(String(input)).toBe('https://script.google.com/macros/s/AKfycbzgK-0G-MQ1xk3veoI19aFWgkRA6jvsMvFa2TPC8jax9sDf5GUCXUT9h-iqwu0VZDjZ/exec');
      sent = JSON.parse(String(init?.body));
      return Response.json({ success: true, count: 2, imageUrls: ['https://lh3.googleusercontent.com/d/a', 'https://lh3.googleusercontent.com/d/b'], jsonRevision: 9 });
    });

    const result = await api({
      action: 'backupReplyInlineImages',
      caseId: '26080001',
      round: 1,
      images: [
        { fileName: 'fix-1.png', mimeType: 'image/png', base64: `data:image/png;base64,${tinyPng}` },
        { fileName: 'fix-2.png', mimeType: 'image/png', base64: tinyPng },
        { fileName: 'notes.pdf', mimeType: 'application/pdf', base64: 'JVBERi0x' }
      ]
    }, token);

    expect(result).toMatchObject({ ok: true, action: 'backupReplyInlineImages', caseId: '26080001', round: 1, count: 2 });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const body = sent as unknown as Record<string, unknown>;
    // 走 Apps Script 既有的 NAS 上傳入口與服務金鑰，來源標成信件照片備份（不套用 NAS 檔名鎖）。
    expect(body).toMatchObject({ action: 'uploadCaseDesignImages', serviceKey: 'test-nas-watcher-key', caseId: '26080001', round: 1, source: 'mail-inline-upload' });
    const images = body.images as Record<string, string>[];
    // 非圖片的附件不備份；data URL 前綴會被拿掉。
    expect(images.map(image => image.fileName)).toEqual(['fix-1.png', 'fix-2.png']);
    expect(images.every(image => image.base64 === tinyPng)).toBe(true);
    // 同內容的照片得到同一把防重鍵，Apps Script 會找到同一個 Drive 檔案、修改紀錄不會重複。
    expect(images[0].dedupeKey).toMatch(/^[a-f0-9]{64}$/);
    expect(images[1].dedupeKey).toBe(images[0].dedupeKey);

    // 沒有圖片就不呼叫 Apps Script。
    const empty = await api({ action: 'backupReplyInlineImages', caseId: '26080001', round: 1, images: [] }, token);
    expect(empty).toMatchObject({ ok: true, count: 0 });
    expect(fetchMock).toHaveBeenCalledTimes(1);

    // 沒登入不能備份。
    const denied = await api({ action: 'backupReplyInlineImages', caseId: '26080001', round: 1, images: [{ fileName: 'a.png', mimeType: 'image/png', base64: tinyPng }] });
    expect(denied).toMatchObject({ ok: false });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('labels a round created by a mail photo backup as such instead of as a NAS auto-sync', async () => {
    vi.spyOn(globalThis, 'fetch').mockImplementation(async () => Response.json({ content: { sha: 'mail-photo-file-sha' }, commit: { sha: 'mail-photo-commit-sha' } }));
    const result = await api({
      action: 'addCaseDesignImages',
      serviceKey: 'test-nas-watcher-key',
      caseId: '26080001',
      round: 0,
      images: [{ fileName: 'fix.jpg', url: 'https://lh3.googleusercontent.com/d/mail-photo' }],
      source: 'mail-inline-upload'
    });
    expect(result).toMatchObject({ ok: true, round: 0 });
    expect((result.record as Record<string, unknown>)['修改內容']).toBe('初稿完成（信件照片備份）');
    expect((result.record as Record<string, unknown>)['修改人']).toBe('信件照片備份');
    expect((result.record as Record<string, unknown>)['圖片來源']).toBe('mail-inline-upload');
  });

  it('backs up the database table to the spreadsheet by matching column names only, and rejects when the secret is missing', async () => {
    const token = await login();
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
      expect(String(input)).toBe('https://script.google.com/macros/s/AKfycbzgK-0G-MQ1xk3veoI19aFWgkRA6jvsMvFa2TPC8jax9sDf5GUCXUT9h-iqwu0VZDjZ/exec');
      const body = JSON.parse(String(init?.body));
      expect(body.action).toBe('backupDatabaseTableToSheet');
      expect(body.serviceKey).toBe('test-database-backup-key');
      expect(body.primaryKey).toBe('案件編號');
      expect(body.headers).toContain('修改次數');
      expect(body.headers).not.toContain('時間標記');
      expect(body.rows.find((row: Record<string, unknown>) => row['案件編號'] === '26080001')).toBeTruthy();
      return Response.json({ success: true, matchedColumns: 20, updated: 1, appended: 0, sheetName: 'database', updatedAt: '2026-08-13T09:00:00.000Z' });
    });

    const result = await api({ action: 'backupDatabaseToSheet' }, token);
    expect(result).toMatchObject({ ok: true, matchedColumns: 20, updated: 1, appended: 0, sheetName: 'database' });
    expect(fetchMock).toHaveBeenCalledTimes(1);

    const denied = await api({ action: 'backupDatabaseToSheet' });
    expect(denied).toMatchObject({ ok: false });
  });

  it('gates the Gmail feature behind request.mail, connects an account, sends one case mail, blocks a second send, and refreshes an expired access token before reading the thread', async () => {
    const tester = await api({ action: 'login', password: 'test' });
    const token = String(tester.token);

    const blocked = await api({ action: 'gmailOauthConnect', code: 'auth-code', redirectUri: ORIGIN }, token);
    expect(blocked).toMatchObject({ ok: false, error: '此帳號沒有「request.mail」權限' });

    await seedAccountPermission('test.user@emctaipei.com', '自訂', ['request.mail']);

    vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
      const url = String(input);
      if (url === 'https://oauth2.googleapis.com/token') {
        const body = new URLSearchParams(String(init?.body));
        expect(body.get('client_id')).toBe('910684492076-ehgnu9u5sbgir0lm6pscdlaj0vgcsrpu.apps.googleusercontent.com');
        expect(body.get('client_secret')).toBe('test-gmail-oauth-secret');
        if (body.get('grant_type') === 'authorization_code') {
          expect(body.get('code')).toBe('auth-code');
          return Response.json({ access_token: 'gmail-access-1', refresh_token: 'gmail-refresh-1', expires_in: 3600 });
        }
        throw new Error(`unexpected token grant_type: ${body.get('grant_type')}`);
      }
      if (url === 'https://www.googleapis.com/oauth2/v2/userinfo') {
        return Response.json({ email: 'designer.mailbox@gmail.com' });
      }
      throw new Error(`unexpected fetch during connect: ${url}`);
    });
    const connected = await api({ action: 'gmailOauthConnect', code: 'auth-code', redirectUri: ORIGIN }, token);
    expect(connected).toMatchObject({ ok: true, gmailAddress: 'designer.mailbox@gmail.com' });

    const status = await api({ action: 'gmailStatus' }, token);
    expect(status).toMatchObject({ ok: true, connected: true, gmailAddress: 'designer.mailbox@gmail.com' });

    let githubPutCount = 0;
    let capturedRaw = '';
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
      const url = String(input);
      if (url === 'https://gmail.googleapis.com/gmail/v1/users/me/messages/send') {
        expect(new Headers(init?.headers).get('Authorization')).toBe('Bearer gmail-access-1');
        const body = JSON.parse(String(init?.body));
        expect(typeof body.raw).toBe('string');
        capturedRaw = body.raw;
        return Response.json({ id: 'gmail-msg-1', threadId: 'gmail-thread-1' });
      }
      if (url.startsWith('https://api.github.com/')) {
        githubPutCount += 1;
        return Response.json({ content: { sha: `sha-${githubPutCount}` }, commit: { sha: `commit-${githubPutCount}` } });
      }
      throw new Error(`unexpected fetch during send: ${url}`);
    });
    const sentBodyHtml = 'Hi，這是測試信件內容<br><br>參考連結：<a href="https://example.com/brief">簡報連結</a><br><img src="cid:machi-test@inline">';
    const sentSignatureHtml = '<strong>Machi</strong> 敬上';
    const sent = await api({
      action: 'sendCaseMail', caseId: '26080001',
      to: '設計師 <designer@emctaipei.com>', cc: '客戶窗口 <client@example.com>',
      subject: '【26080001】測試客戶_Worker 測試案件', bodyHtml: sentBodyHtml, signatureHtml: sentSignatureHtml,
      inlineImages: [{ contentId: 'machi-test@inline', fileName: '測試.png', mimeType: 'image/png', base64: 'iVBORw0KGgo=' }]
    }, token);
    expect(sent).toMatchObject({ ok: true, threadId: 'gmail-thread-1', gmailMessageId: 'gmail-msg-1' });
    // 含照片時外層是 multipart/related，裡面保留 multipart/alternative 與 CID 內嵌圖片。
    const decodedMime = decodeBase64UrlText(capturedRaw);
    expect(decodedMime).toContain('Content-Type: multipart/related');
    expect(decodedMime).toContain('Content-Type: multipart/alternative');
    expect(decodedMime).toContain('Content-ID: <machi-test@inline>');
    expect(decodedMime).toContain('Content-Disposition: inline; filename="inline-1.png"');
    const extractPart = (contentType: string) => {
      const match = decodedMime.match(new RegExp(`Content-Type: ${contentType}[\\s\\S]*?\\r\\n\\r\\n([\\s\\S]*?)(?=\\r\\n--|$)`, 'i'));
      return decodeBase64UrlText((match?.[1] || '').replace(/\r?\n/g, ''));
    };
    const plainPartBody = extractPart('text/plain');
    expect(plainPartBody).toContain('簡報連結');
    expect(plainPartBody).not.toContain('<a href');
    expect(plainPartBody).toContain('\n\nMachi 敬上');
    expect(plainPartBody).not.toContain('-- \n');
    const htmlPartBody = extractPart('text/html');
    expect(htmlPartBody).toContain(sentBodyHtml);
    expect(htmlPartBody).toContain(`<div>${sentSignatureHtml}</div>`);
    expect(htmlPartBody).not.toContain('class="gmail_signature"');
    expect(htmlPartBody).not.toContain('data-smartmail="gmail_signature"');
    // 收件人／副本的中文顯示名必須依 RFC 2047 編碼，標頭段落本身只能是 ASCII——否則部分郵件用戶端（含 Gmail 本身）在收件匣清單會把顯示名顯示成亂碼。
    const headerSection = decodedMime.slice(0, decodedMime.indexOf('\r\n\r\n'));
    expect(headerSection).toContain('To: =?UTF-8?B?');
    expect(headerSection).toContain('<designer@emctaipei.com>');
    expect(headerSection).toContain('Cc: =?UTF-8?B?');
    expect(headerSection).toContain('<client@example.com>');
    expect(/^[\x00-\x7f]*$/.test(headerSection)).toBe(true);

    const listed = await api({ action: 'list' }, token);
    const caseRow = (listed.rows as Array<Record<string, unknown>>).find(row => row.id === '26080001');
    expect(caseRow).toMatchObject({ gmailThreadId: 'gmail-thread-1', gmailThreadOwnerAccount: 'test.user@emctaipei.com' });

    const secondSend = await api({
      action: 'sendCaseMail', caseId: '26080001', to: 'designer@emctaipei.com', subject: '再寄一次', bodyText: '不應該成功'
    }, token);
    expect(secondSend).toMatchObject({ ok: false, reason: 'THREAD_EXISTS' });

    // 2026-08-19 起查看/回覆信件串需要同時通過兩層檢查：①客戶別「權限設定」白名單（或一般角色 request.mail），
    // ②這個帳號的 email 有沒有出現在信件串本身的收件人/寄件人/副本裡（accountIsGmailThreadParticipant）——這裡
    // 專門驗證第②層：admin@emctaipei.com（每日 shortcut 密碼登入的管理者帳號，一律不受客戶別白名單限制）故意
    // 拿來測試「客戶別權限沒問題、但不是這封信的相關人」這種情境，應該被擋下；designer@emctaipei.com 確實出現
    // 在下面 mock 訊息的 From/To 裡，用 seedSession 直接模擬「這個帳號已經登入」，不需要它在「設定」／「帳號
    // 權限」表裡有任何資料——但因為它預設的「一般使用者」角色範本沒有 request.mail，這裡額外把它加進客戶別
    // 白名單（跟發信的第①層要求一致），讓測試能精準只驗證第②層的討論串相關人判斷。
    const todayMonthDay = new Intl.DateTimeFormat('en-US', { timeZone: 'Asia/Taipei', month: '2-digit', day: '2-digit' })
      .formatToParts(new Date()).reduce((acc, part) => (part.type === 'month' || part.type === 'day' ? acc + part.value : acc), '');
    const adminLogin = await api({ action: 'login', password: todayMonthDay });
    expect(adminLogin.ok).toBe(true);
    const adminToken = String(adminLogin.token);
    // test.user 自己是這條信件串的寄件帳號，稍後（threadAfterRefresh）還要再用它讀一次信，一併加進白名單
    // 才不會因為客戶別白名單一旦非空就不再看一般角色權限（取代不是疊加）而被自己的白名單意外擋下。
    await seedCustomerOwner('測試客戶', 'designer@emctaipei.com');
    await seedCustomerOwner('測試客戶', 'test.user@emctaipei.com');
    const designerToken = await seedSession('designer@emctaipei.com');
    await seedGmailTokens('designer@emctaipei.com', 'gmail-access-designer', 'designer@emctaipei.com');

    const plainTextBody = 'Hi，這是設計師的回覆內容';
    const originalMessageBody = 'A. 設計簡報：P26~P30';
    const originalMessageUrl = 'https://example.com/design-brief#p26';
    const plainTextBodyBase64Url = toBase64Url(`${plainTextBody}\n\n設計師簽名檔\n\nOn Mon, 17 Aug 2026 at 10:00, test.user@emctaipei.com wrote:\n> ${originalMessageBody}`);
    // 第二封信刻意用 multipart/mixed 夾帶一張圖片附件（有 attachmentId），驗證瀏覽信件串時內嵌圖片會被抓回來顯示。
    const mockThreadMessages = [
      {
        id: 'gmail-msg-1', snippet: '',
        payload: {
          mimeType: 'text/html', body: { data: toBase64Url(`<p>A. 設計簡報：<a href="${originalMessageUrl}">P26~P30</a></p><div class="gmail_signature"><a href="https://example.com/signature">簽名連結</a></div><div class="gmail_quote"><a href="https://example.com/quoted">引用連結</a></div>`) },
          headers: [
            { name: 'From', value: 'test.user@emctaipei.com' }, { name: 'To', value: 'designer@emctaipei.com' },
            { name: 'Date', value: 'Mon, 17 Aug 2026 10:00:00 +0800' }
          ]
        }
      },
      {
        id: 'gmail-msg-2', snippet: plainTextBody,
        payload: {
          mimeType: 'multipart/mixed',
          headers: [
            { name: 'From', value: 'designer@emctaipei.com' }, { name: 'To', value: 'test.user@emctaipei.com' },
            { name: 'Cc', value: 'client@example.com' },
            // 刻意用 UTC 標示（+0000），驗證顯示時真的有轉換成台北時區，不是原封不動把標頭字串丟給使用者看——
            // 這個時間換算成台北時間是 11:00（+8 小時），如果沒有正確轉換，顯示出來會誤判成 03:00。
            { name: 'Date', value: 'Mon, 17 Aug 2026 03:00:00 +0000' }, { name: 'Message-Id', value: '<msg2@mail.gmail.com>' },
            { name: 'References', value: '<msg1@mail.gmail.com>' }, { name: 'Subject', value: 'Re: 測試主旨' }
          ],
          parts: [
            { mimeType: 'text/plain', body: { data: plainTextBodyBase64Url } },
            { mimeType: 'image/png', filename: 'reply-photo.png', body: { attachmentId: 'gmail-att-1', size: 12 } }
          ]
        }
      }
    ];

    // 讀信件串：admin（不是相關人）應該直接被擋下，只呼叫了 thread 端點，完全不會走到抓圖片附件那一步
    // （權限檢查在抓圖片之前）。
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
      const url = String(input);
      if (url === `https://gmail.googleapis.com/gmail/v1/users/me/threads/gmail-thread-1?format=full`) {
        expect(new Headers(init?.headers).get('Authorization')).toBe('Bearer gmail-access-1');
        return Response.json({ id: 'gmail-thread-1', messages: mockThreadMessages });
      }
      throw new Error(`unexpected fetch while a non-participant reads: ${url}`);
    });
    const rejectedRead = await api({ action: 'getCaseMailThread', caseId: '26080001' }, adminToken);
    expect(rejectedRead).toMatchObject({ ok: false, reason: 'GMAIL_THREAD_NOT_PARTICIPANT' });

    // designer（確實是相關人）讀信件串應該成功，只回傳純文字內容，且第二封信的圖片附件要被抓回來轉成 data: URI。
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
      const url = String(input);
      if (url === `https://gmail.googleapis.com/gmail/v1/users/me/threads/gmail-thread-1?format=full`) {
        expect(new Headers(init?.headers).get('Authorization')).toBe('Bearer gmail-access-1');
        return Response.json({ id: 'gmail-thread-1', messages: mockThreadMessages });
      }
      if (url === 'https://gmail.googleapis.com/gmail/v1/users/me/messages/gmail-msg-2/attachments/gmail-att-1') {
        expect(new Headers(init?.headers).get('Authorization')).toBe('Bearer gmail-access-1');
        return Response.json({ attachmentId: 'gmail-att-1', size: 12, data: toBase64Url('fake-image-bytes') });
      }
      throw new Error(`unexpected fetch during thread read: ${url}`);
    });
    const thread = await api({ action: 'getCaseMailThread', caseId: '26080001', signatureHtml: '<b>設計師簽名檔</b>' }, designerToken);
    expect(thread.ok).toBe(true);
    // 2026-08-20：getCaseMailThread 現在也會算出「回覆全部」風格的建議收件人／副本一併回傳，給前端信件編輯器
    // 預先帶入、使用者可以再修改——跟下面 replyCaseMail 沒有帶 to/cc 時會用的 fallback 是同一套計算方式
    // （computeReplySuggestion），這裡先確認回傳值本身正確：目前回信者是 designer，最後一封信也是 designer
    // 寄給 test.user，因此應回給 test.user；副本扣掉自己與回覆對象後只剩 client@example.com。
    expect(thread.replyFrom).toBe('designer@emctaipei.com');
    expect(thread.suggestedTo).toBe('test.user@emctaipei.com');
    expect(thread.suggestedCc).toBe('client@example.com');
    const messages = thread.messages as Array<Record<string, unknown>>;
    expect(messages).toHaveLength(2);
    expect(messages[0]).toMatchObject({
      bodyText: originalMessageBody,
      links: [{ text: 'P26~P30', url: originalMessageUrl }]
    });
    expect(messages[1]).toMatchObject({
      from: 'designer@emctaipei.com', to: 'test.user@emctaipei.com', cc: 'client@example.com',
      bodyText: plainTextBody, date: '2026/08/17 11:00'
    });
    const secondMessageImages = messages[1].images as Array<{ dataUrl: string }>;
    expect(secondMessageImages).toHaveLength(1);
    expect(secondMessageImages[0].dataUrl.startsWith('data:image/png;base64,')).toBe(true);

    // 回覆：admin（不是相關人）應該被擋下；designer（相關人）應該成功——歷史用原寄件者 token 讀取，
    // 但送出必須使用 designer 自己的 token。原 threadId 屬於 test.user 的信箱，不能傳給 designer 的 Gmail API。
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
      const url = String(input);
      if (url === 'https://gmail.googleapis.com/gmail/v1/users/me/threads/gmail-thread-1?format=full') {
        expect(new Headers(init?.headers).get('Authorization')).toBe('Bearer gmail-access-1');
        return Response.json({ id: 'gmail-thread-1', messages: mockThreadMessages });
      }
      // 跨帳號回信（designer≠owner）現在會先用寄件帳號自己的 token 查一次 rfc822msgid，找不到對應的
      // threadId（這裡刻意模擬設計師自己的信箱裡沒有這封信的副本）就照舊不帶 threadId 建立新訊息，
      // 驗證這條「查不到就安全退回舊行為」的路徑不會擋住整封回信送出。
      if (url.startsWith('https://gmail.googleapis.com/gmail/v1/users/me/messages?')) {
        expect(new Headers(init?.headers).get('Authorization')).toBe('Bearer gmail-access-designer');
        expect(url).toContain(encodeURIComponent('rfc822msgid:msg2@mail.gmail.com'));
        return Response.json({ messages: [] });
      }
      if (url === 'https://gmail.googleapis.com/gmail/v1/users/me/messages/send') {
        expect(new Headers(init?.headers).get('Authorization')).toBe('Bearer gmail-access-designer');
        const body = JSON.parse(String(init?.body));
        expect(body.threadId).toBeUndefined();
        // 最後一封信是 designer 自己寄給 test.user，所以新回覆要給 test.user，不可變成設計師寄給自己。
        const decodedRaw = decodeBase64UrlText(String(body.raw));
        expect(decodedRaw).toContain('To: test.user@emctaipei.com');
        // 副本比照「回覆全部」：上一封信（msg2）的收件人 test.user@emctaipei.com 與副本 client@example.com
        // 都要留住，扣掉這次的回覆對象（designer@emctaipei.com）本身與寄件帳號自己（test.user@emctaipei.com）——
        // 精確只比對標頭段落的 Cc 那一行，不是整段 raw text，避免跟引用內文裡出現的同一組 email 混在一起判斷。
        const headerSection = decodedRaw.slice(0, decodedRaw.indexOf('\r\n\r\n'));
        const ccHeaderLine = headerSection.split(/\r\n(?!\s)/).find(line => line.startsWith('Cc:'));
        expect(ccHeaderLine).toBe('Cc: client@example.com');
        expect(decodedRaw).toContain('In-Reply-To: <msg2@mail.gmail.com>');
        expect(decodedRaw).toContain('References: <msg1@mail.gmail.com> <msg2@mail.gmail.com>');
        const extractReplyPart = (contentType: string) => {
          const match = decodedRaw.match(new RegExp(`Content-Type: ${contentType}[\\s\\S]*?\\r\\n\\r\\n([\\s\\S]*?)(?=\\r\\n--|$)`, 'i'));
          return decodeBase64UrlText((match?.[1] || '').replace(/\r?\n/g, ''));
        };
        const replyPlainText = extractReplyPart('text/plain');
        expect(replyPlainText).toContain('收到，謝謝回報');
        expect(replyPlainText).toContain('test.user@emctaipei.com 寫道：');
        expect(replyPlainText).toContain(`> ${originalMessageBody}`);
        expect(replyPlainText).toContain('designer@emctaipei.com 寫道：');
        expect(replyPlainText).toContain(`> ${plainTextBody}`);
        expect(replyPlainText.split(originalMessageBody)).toHaveLength(2);
        expect(replyPlainText.split(plainTextBody)).toHaveLength(2);
        const replyHtml = extractReplyPart('text/html');
        expect(replyHtml).toContain('收到，謝謝回報');
        expect(replyHtml).toContain('class="gmail_quote"');
        expect(replyHtml).toContain(originalMessageBody);
        // 引用區塊沿用 Gmail 自己的標記，Gmail 才會剛好從這裡開始收合，不會把簽名檔一起吃進去。
        expect(replyHtml).toContain('class="gmail_attr"');
        expect(replyHtml).toContain(`<blockquote class="gmail_quote" style="margin:0px 0px 0px 0.8ex;border-left:1px solid rgb(204,204,204);padding-left:1ex">${plainTextBody}`);
        return Response.json({ id: 'gmail-msg-3', threadId: 'gmail-thread-1' });
      }
      throw new Error(`unexpected fetch during reply: ${url}`);
    });
    const rejectedReply = await api({ action: 'replyCaseMail', caseId: '26080001', bodyText: '不應該成功' }, adminToken);
    expect(rejectedReply).toMatchObject({ ok: false, reason: 'GMAIL_THREAD_NOT_PARTICIPANT' });
    const replied = await api({
      action: 'replyCaseMail', caseId: '26080001', bodyText: '收到，謝謝回報', signatureHtml: '<b>設計師簽名檔</b>'
    }, designerToken);
    expect(replied).toMatchObject({ ok: true, gmailMessageId: 'gmail-msg-3' });

    // 2026-08-20：信件編輯器新增可編輯的收件人／副本欄位——前端這次如果帶了 to/cc，要直接採用，不能被
    // computeReplySuggestion 算出的「回覆全部」預設值蓋掉；cc 傳空字串代表使用者在編輯器裡手動清空副本，
    // 同樣要真的生效（不是被當成「沒帶」而 fallback 回自動算出的 client@example.com）。
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
      const url = String(input);
      if (url === 'https://gmail.googleapis.com/gmail/v1/users/me/threads/gmail-thread-1?format=full') {
        expect(new Headers(init?.headers).get('Authorization')).toBe('Bearer gmail-access-1');
        return Response.json({ id: 'gmail-thread-1', messages: mockThreadMessages });
      }
      if (url.startsWith('https://gmail.googleapis.com/gmail/v1/users/me/messages?')) {
        return Response.json({ messages: [] });
      }
      if (url === 'https://gmail.googleapis.com/gmail/v1/users/me/messages/send') {
        expect(new Headers(init?.headers).get('Authorization')).toBe('Bearer gmail-access-designer');
        const body = JSON.parse(String(init?.body));
        expect(body.threadId).toBeUndefined();
        const decodedRaw = decodeBase64UrlText(String(body.raw));
        const headerSection = decodedRaw.slice(0, decodedRaw.indexOf('\r\n\r\n'));
        expect(headerSection.split(/\r\n(?!\s)/).find(line => line.startsWith('To:'))).toBe('To: custom-recipient@example.com');
        // 沒有任何 Cc 標頭——不是自動算出來的 client@example.com，也不是空字串的 Cc 標頭，而是整行都不存在。
        expect(headerSection.split(/\r\n(?!\s)/).some(line => line.startsWith('Cc:'))).toBe(false);
        return Response.json({ id: 'gmail-msg-4', threadId: 'gmail-thread-1' });
      }
      throw new Error(`unexpected fetch during reply with manual to/cc: ${url}`);
    });
    const repliedWithOverride = await api({
      action: 'replyCaseMail', caseId: '26080001', bodyText: '手動改過收件人的回覆',
      to: 'custom-recipient@example.com', cc: ''
    }, designerToken);
    expect(repliedWithOverride).toMatchObject({ ok: true, gmailMessageId: 'gmail-msg-4' });

    // 2026-09-18：信件串最後一封是草稿（排程寄信建立的 Gmail 草稿、或使用者自己沒寄出的回覆）時，草稿
    // 常常沒有 Message-Id，以前回信會直接失敗，或 In-Reply-To 指向沒寄出的信而接不進原信件串。讀信與回信
    // 都要略過草稿／垃圾桶／垃圾郵件，回覆最後一封真的寄出去的信（msg2）。
    const draftMessage = {
      id: 'gmail-draft-1', labelIds: ['DRAFT'], snippet: '還沒寄出的草稿',
      payload: {
        mimeType: 'text/plain', body: { data: toBase64Url('還沒寄出的草稿內容') },
        headers: [{ name: 'From', value: 'test.user@emctaipei.com' }, { name: 'To', value: 'someone-else@example.com' }, { name: 'Subject', value: 'Re: 測試主旨' }]
      }
    };
    const trashedMessage = { ...draftMessage, id: 'gmail-trash-1', labelIds: ['TRASH'] };
    const threadWithDraft = [...mockThreadMessages, draftMessage, trashedMessage];
    let draftAwareRaw = '';
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
      const url = String(input);
      if (url === 'https://gmail.googleapis.com/gmail/v1/users/me/threads/gmail-thread-1?format=full') {
        return Response.json({ id: 'gmail-thread-1', messages: threadWithDraft });
      }
      if (url.startsWith('https://gmail.googleapis.com/gmail/v1/users/me/messages?')) return Response.json({ messages: [] });
      if (url === 'https://gmail.googleapis.com/gmail/v1/users/me/messages/send') {
        draftAwareRaw = decodeBase64UrlText(String(JSON.parse(String(init?.body)).raw));
        return Response.json({ id: 'gmail-msg-5', threadId: 'gmail-thread-1' });
      }
      if (url.includes('/attachments/')) return Response.json({ data: toBase64Url('img') });
      throw new Error(`unexpected fetch with a draft in the thread: ${url}`);
    });
    const draftAwareReply = await api({ action: 'replyCaseMail', caseId: '26080001', bodyText: '略過草稿的回覆', to: 'test.user@emctaipei.com' }, designerToken);
    expect(draftAwareReply).toMatchObject({ ok: true, gmailMessageId: 'gmail-msg-5' });
    expect(draftAwareRaw).toContain('In-Reply-To: <msg2@mail.gmail.com>');
    expect(draftAwareRaw).not.toContain('還沒寄出的草稿內容');
    const draftAwareThread = await api({ action: 'getCaseMailThread', caseId: '26080001' }, designerToken);
    expect((draftAwareThread.messages as unknown[]).length).toBe(2);

    // 「串信」綁定的信件串就在綁定者自己的信箱裡；本人可能是密件副本或透過群組信箱收到，標頭沒有自己，
    // 也要能讀、能回。
    const bccOnlyThread = [{
      id: 'gmail-msg-bcc', snippet: '', payload: {
        mimeType: 'text/plain', body: { data: toBase64Url('客戶寄給群組信箱') },
        headers: [
          { name: 'From', value: 'client@example.com' }, { name: 'To', value: 'group@emctaipei.com' },
          { name: 'Message-Id', value: '<bcc@mail.gmail.com>' }, { name: 'Subject', value: '客戶需求' }
        ]
      }
    }];
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (input) => {
      const url = String(input);
      if (url === 'https://gmail.googleapis.com/gmail/v1/users/me/threads/gmail-thread-1?format=full') return Response.json({ id: 'gmail-thread-1', messages: bccOnlyThread });
      throw new Error(`unexpected fetch for the owner-only thread: ${url}`);
    });
    const ownerRead = await api({ action: 'getCaseMailThread', caseId: '26080001' }, token);
    expect(ownerRead.ok).toBe(true);
    const outsiderRead = await api({ action: 'getCaseMailThread', caseId: '26080001' }, designerToken);
    expect(outsiderRead).toMatchObject({ ok: false, reason: 'GMAIL_THREAD_NOT_PARTICIPANT' });

    // 手動把 access token 改成已過期，驗證下一次呼叫會先用 refresh_token 換一組新的再讀信。
    const stub = env.DATABASE_COORDINATOR.getByName('primary') as DurableObjectStub<DatabaseCoordinator>;
    await runInDurableObject(stub, async (_instance, state) => {
      state.storage.sql.exec('UPDATE gmail_tokens SET access_token_expires_at = ? WHERE account = ?', 1, 'test.user@emctaipei.com');
    });
    let refreshedAccessTokenUsed = false;
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
      const url = String(input);
      if (url === 'https://oauth2.googleapis.com/token') {
        const body = new URLSearchParams(String(init?.body));
        expect(body.get('grant_type')).toBe('refresh_token');
        expect(body.get('refresh_token')).toBe('gmail-refresh-1');
        return Response.json({ access_token: 'gmail-access-2', expires_in: 3600 });
      }
      if (url === `https://gmail.googleapis.com/gmail/v1/users/me/threads/gmail-thread-1?format=full`) {
        expect(new Headers(init?.headers).get('Authorization')).toBe('Bearer gmail-access-2');
        refreshedAccessTokenUsed = true;
        // 至少要有一封信讓 test.user（寄件帳號本人）通過「是不是這封信的相關人」檢查，真實的 Gmail 信件串
        // 本來就不可能是空的（至少有當初寄出的那一封）；這裡不需要圖片附件，用簡化過、沒有圖片的單封信即可。
        return Response.json({
          id: 'gmail-thread-1',
          messages: [{
            id: 'gmail-msg-1', snippet: '', payload: {
              mimeType: 'text/plain', body: { data: toBase64Url('') },
              headers: [{ name: 'From', value: 'test.user@emctaipei.com' }, { name: 'To', value: 'designer@emctaipei.com' }]
            }
          }]
        });
      }
      throw new Error(`unexpected fetch during token refresh: ${url}`);
    });
    const threadAfterRefresh = await api({ action: 'getCaseMailThread', caseId: '26080001' }, token);
    expect(threadAfterRefresh.ok).toBe(true);
    expect(refreshedAccessTokenUsed).toBe(true);

    // 中斷連線：Google 撤銷呼叫失敗也不擋斷線，DO 端的紀錄一樣會被清掉。
    vi.spyOn(globalThis, 'fetch').mockImplementation(async () => { throw new Error('network down'); });
    const disconnected = await api({ action: 'gmailDisconnect' }, token);
    expect(disconnected).toMatchObject({ ok: true });
    const statusAfterDisconnect = await api({ action: 'gmailStatus' }, token);
    expect(statusAfterDisconnect).toMatchObject({ ok: true, connected: false });
  });

  it('sendCaseMail can attach arbitrary non-image files (not just inline images) via multipart/mixed, safely encodes a non-ASCII filename with RFC 2231 star-encoding plus an ASCII fallback, strips CR/LF/quote header-injection attempts from the filename, keeps the existing multipart/related+alternative body nested as the first mixed part when both an inline image and an attachment are present, and rejects an over-limit attachment', async () => {
    const token = await login();
    await seedGmailTokens('machi.chen@emctaipei.com', 'gmail-access-admin');

    let capturedRaw = '';
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
      const url = String(input);
      if (url === 'https://gmail.googleapis.com/gmail/v1/users/me/messages/send') {
        const body = JSON.parse(String(init?.body));
        capturedRaw = body.raw;
        return Response.json({ id: 'gmail-msg-attach-1', threadId: 'gmail-thread-attach-1' });
      }
      if (url.startsWith('https://api.github.com/')) {
        return Response.json({ content: { sha: 'sha-attach' }, commit: { sha: 'commit-attach' } });
      }
      throw new Error(`unexpected fetch during attachment send: ${url}`);
    });

    // 先驗證超過單檔上限（15 MB）會被擋下、完全不會呼叫 Gmail API——用一段解碼後約 16 MB 的 base64
    // 內容（base64 膨脹約 4/3 倍，約 21.3 MB 文字，仍遠低於 index.ts 的 28 MB 整體請求上限，確保這裡
    // 真正測到的是 resolveGmailAttachments 自己的檔案大小檢查，不是被更前面那道籠統的請求過大擋下）。
    const oversizedBase64 = 'A'.repeat(Math.ceil((16 * 1024 * 1024 * 4) / 3));
    const oversizedAttempt = await api({
      action: 'sendCaseMail', caseId: '26080001', to: 'designer@emctaipei.com', subject: '附件太大',
      bodyText: 'x', attachments: [{ fileName: 'huge.zip', mimeType: 'application/zip', base64: oversizedBase64 }]
    }, token);
    expect(oversizedAttempt).toMatchObject({ ok: false, error: expect.stringContaining('超過 15 MB') });

    // 正式送出：同時帶一張內嵌圖片（cid 參照）與兩個附件——其中一個是含中文字元的檔名，另一個檔名
    // 刻意夾帶 CR/LF 與雙引號，模擬惡意或不小心壞掉的檔名，驗證標頭注入防護。
    const sent = await api({
      action: 'sendCaseMail', caseId: '26080001', to: 'designer@emctaipei.com', subject: '含附件的測試信',
      bodyHtml: '本文內容 <img src="cid:machi-inline@test">',
      inlineImages: [{ contentId: 'machi-inline@test', fileName: 'inline.png', mimeType: 'image/png', base64: 'aGVsbG8=' }],
      attachments: [
        { fileName: '報價單_第二版.pdf', mimeType: 'application/pdf', base64: 'JVBERi0xLjQK' },
        { fileName: 'evil"\r\nX-Injected: yes\r\n.txt', mimeType: 'text/plain', base64: 'aGVsbG8gd29ybGQ=' }
      ]
    }, token);
    expect(sent).toMatchObject({ ok: true, threadId: 'gmail-thread-attach-1', gmailMessageId: 'gmail-msg-attach-1' });

    const decodedMime = decodeBase64UrlText(capturedRaw);
    const headerSection = decodedMime.slice(0, decodedMime.indexOf('\r\n\r\n'));
    // 最外層一定是 multipart/mixed（因為有附件），且整個標頭段落只能是 ASCII。
    expect(headerSection).toContain('Content-Type: multipart/mixed');
    expect(/^[\x00-\x7f]*$/.test(headerSection)).toBe(true);
    // 有附件也有內嵌圖片時，multipart/related（連同裡面的 multipart/alternative）要完整保留、成為
    // mixed 底下的第一個 part——不是被附件流程取代掉。
    expect(decodedMime).toContain('Content-Type: multipart/related');
    expect(decodedMime).toContain('Content-Type: multipart/alternative');
    expect(decodedMime).toContain('Content-ID: <machi-inline@test>');
    expect(decodedMime).toContain('Content-Disposition: inline; filename="inline-1.png"');
    // 附件本身用 Content-Disposition: attachment（不是 inline），且不帶 Content-ID（不需要被本文的
    // cid: 參照）。
    const attachmentSection = decodedMime.slice(decodedMime.indexOf('application/pdf') - 200);
    expect(attachmentSection).toContain('Content-Disposition: attachment');
    expect(decodedMime).not.toMatch(/Content-ID:[^\r\n]*報價單/);
    // 中文檔名：純 ASCII 保底版本（非 ASCII 字元逐一替換成底線，保留檔案原本的長度/副檔名輪廓，
    // 不是隨便換成一個通用的「attachment」字面字串）+ RFC 2231 star 參數版本都要同時存在。
    expect(decodedMime).toContain('filename="_______.pdf"; filename*=UTF-8\'\'');
    expect(decodedMime).toContain(encodeURIComponent('報價單_第二版.pdf'));
    // 標頭注入防護：惡意檔名裡的 CR/LF 與雙引號必須被拿掉，不會在 MIME 內容裡出現一行真正獨立的
    // `X-Injected: yes` 標頭（如果防護失敗，這行會被誤判成一個新的、獨立的標頭欄位）。
    expect(decodedMime).not.toMatch(/\r\nX-Injected: yes\r\n/);
    expect(decodedMime).not.toContain('"\r\nX-Injected');

    const listed = await api({ action: 'list' }, token);
    const caseRow = (listed.rows as Array<Record<string, unknown>>).find(row => row.id === '26080001');
    expect(caseRow).toMatchObject({ gmailThreadId: 'gmail-thread-attach-1' });
  });

  it('searchGmailThreads requires request.mail, dedupes by threadId keeping the newest message as the representative, and reports zero results as an empty (not failed) list', async () => {
    const denied = await api({ action: 'login', password: 'test' });
    const deniedToken = String(denied.token);
    const blocked = await api({ action: 'searchGmailThreads', caseId: '26080001' }, deniedToken);
    expect(blocked).toMatchObject({ ok: false, error: '此帳號沒有「request.mail」權限' });

    await seedAccountPermission('test.user@emctaipei.com', '自訂', ['request.mail']);
    await seedGmailTokens('test.user@emctaipei.com', 'gmail-access-search');

    let listQuery = '';
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
      const url = String(input);
      if (url.startsWith('https://gmail.googleapis.com/gmail/v1/users/me/messages?')) {
        expect(new Headers(init?.headers).get('Authorization')).toBe('Bearer gmail-access-search');
        listQuery = url;
        return Response.json({ messages: [{ id: 'm1' }, { id: 'm2' }, { id: 'm3' }] });
      }
      if (url === 'https://gmail.googleapis.com/gmail/v1/users/me/messages/m1?format=metadata&metadataHeaders=From&metadataHeaders=Subject&metadataHeaders=Date') {
        return Response.json({
          threadId: 'thread-a', snippet: '第一封（同一條討論串較舊的一封）', internalDate: '1000',
          payload: { headers: [{ name: 'From', value: 'PM <pm@example.com>' }, { name: 'Subject', value: '案件 26080001 討論' }] }
        });
      }
      if (url === 'https://gmail.googleapis.com/gmail/v1/users/me/messages/m2?format=metadata&metadataHeaders=From&metadataHeaders=Subject&metadataHeaders=Date') {
        return Response.json({
          threadId: 'thread-a', snippet: '第二封（同一條討論串較新的一封，應該當作代表）', internalDate: '2000',
          payload: { headers: [{ name: 'From', value: 'Designer <designer@example.com>' }, { name: 'Subject', value: 'Re: 案件 26080001 討論' }] }
        });
      }
      if (url === 'https://gmail.googleapis.com/gmail/v1/users/me/messages/m3?format=metadata&metadataHeaders=From&metadataHeaders=Subject&metadataHeaders=Date') {
        return Response.json({
          threadId: 'thread-b', snippet: '另一條完全不相干的討論串', internalDate: '1500',
          payload: { headers: [{ name: 'From', value: 'Other <other@example.com>' }, { name: 'Subject', value: '別的案件' }] }
        });
      }
      throw new Error(`unexpected fetch during search: ${url}`);
    });
    const found = await api({ action: 'searchGmailThreads', caseId: '26080001' }, deniedToken);
    expect(found.ok).toBe(true);
    expect(listQuery).toContain(encodeURIComponent('26080001'));
    const threads = found.threads as Array<Record<string, unknown>>;
    // thread-a 出現了兩封符合搜尋的信，應該被合併成一張卡片，且採用時間較新（m2）的寄件人/主旨/摘要當代表；
    // thread-b 是獨立的一張卡片；結果依最新時間排序，thread-a（internalDate 2000）排在 thread-b（1500）前面。
    expect(threads).toHaveLength(2);
    expect(threads[0]).toMatchObject({
      threadId: 'thread-a', from: 'Designer <designer@example.com>', subject: 'Re: 案件 26080001 討論',
      snippet: '第二封（同一條討論串較新的一封，應該當作代表）', messageCount: 2
    });
    expect(threads[1]).toMatchObject({ threadId: 'thread-b', messageCount: 1 });

    vi.spyOn(globalThis, 'fetch').mockImplementation(async input => {
      const url = String(input);
      if (url.startsWith('https://gmail.googleapis.com/gmail/v1/users/me/messages?')) return Response.json({ messages: [] });
      throw new Error(`unexpected fetch for empty search: ${url}`);
    });
    const empty = await api({ action: 'searchGmailThreads', caseId: '26080001', query: '完全找不到的關鍵字' }, deniedToken);
    expect(empty).toMatchObject({ ok: true, threads: [] });
  });

  it('bindExistingThread writes Gmail信件串ID／Gmail寄件帳號 from a chosen threadId, rejects when the case already has a thread, and resolves a manually pasted Message-ID via findOwnMailboxThreadId when no threadId is supplied', async () => {
    const tester = await api({ action: 'login', password: 'test' });
    const token = String(tester.token);
    await seedAccountPermission('test.user@emctaipei.com', '自訂', ['request.mail']);
    await seedGmailTokens('test.user@emctaipei.com', 'gmail-access-bind');

    vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
      const url = String(input);
      if (url === 'https://gmail.googleapis.com/gmail/v1/users/me/threads/thread-a?format=minimal') {
        expect(new Headers(init?.headers).get('Authorization')).toBe('Bearer gmail-access-bind');
        return Response.json({ id: 'thread-a' });
      }
      if (url.startsWith('https://api.github.com/')) return Response.json({ content: { sha: `bind-file-${crypto.randomUUID()}` }, commit: { sha: 'bind-commit-sha' } });
      throw new Error(`unexpected fetch during bind: ${url}`);
    });
    const bound = await api({ action: 'bindExistingThread', caseId: '26080001', threadId: 'thread-a' }, token);
    expect(bound).toMatchObject({ ok: true, threadId: 'thread-a' });
    const listed = await api({ action: 'list' }, token);
    const caseRow = (listed.rows as Array<Record<string, unknown>>).find(row => row.id === '26080001');
    expect(caseRow).toMatchObject({ gmailThreadId: 'thread-a', gmailThreadOwnerAccount: 'test.user@emctaipei.com' });

    const alreadyBound = await api({ action: 'bindExistingThread', caseId: '26080001', threadId: 'thread-b' }, token);
    expect(alreadyBound).toMatchObject({ ok: false, reason: 'THREAD_EXISTS' });

    // 另一個案件（26080001 已經被上面綁定過，不能重複測）、沒有選卡片改成手動貼 Message-ID——反查失敗
    // （信箱裡真的找不到）跟反查成功（找到、驗證通過）兩種情境都要驗證，且反查與驗證都要用「目前登入
    // 帳號自己」的 token，不是隨便一個帳號。
    await seedCase('26080002');
    const missingLookup = await api({
      action: 'bindExistingThread', caseId: '26080002', messageId: '<not-found@mail.gmail.com>'
    }, token);
    expect(missingLookup).toMatchObject({ ok: false });
    expect(String(missingLookup.error)).toContain('找不到');

    vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
      const url = String(input);
      if (url.startsWith('https://gmail.googleapis.com/gmail/v1/users/me/messages?')) {
        expect(new Headers(init?.headers).get('Authorization')).toBe('Bearer gmail-access-bind');
        expect(url).toContain(encodeURIComponent('rfc822msgid:manual@mail.gmail.com'));
        return Response.json({ messages: [{ threadId: 'thread-manual' }] });
      }
      if (url === 'https://gmail.googleapis.com/gmail/v1/users/me/threads/thread-manual?format=minimal') {
        expect(new Headers(init?.headers).get('Authorization')).toBe('Bearer gmail-access-bind');
        return Response.json({ id: 'thread-manual' });
      }
      if (url.startsWith('https://api.github.com/')) return Response.json({ content: { sha: `bind-manual-file-${crypto.randomUUID()}` }, commit: { sha: 'bind-manual-commit-sha' } });
      throw new Error(`unexpected fetch during manual bind: ${url}`);
    });
    const manuallyBound = await api({
      action: 'bindExistingThread', caseId: '26080002', messageId: '<manual@mail.gmail.com>'
    }, token);
    expect(manuallyBound).toMatchObject({ ok: true, threadId: 'thread-manual' });

    const deniedWithoutSession = await api({ action: 'bindExistingThread', caseId: '26080001', threadId: 'thread-c' });
    expect(deniedWithoutSession).toMatchObject({ ok: false, error: '請先登入後再執行此操作' });
  });

  it('replies to a "串接"-bound thread whose subject has no English Re: prefix by retrying with the original subject before giving up threadId, and reports threaded:false only as a last resort', async () => {
    await seedAccountPermission('test.user@emctaipei.com', '自訂', ['request.mail']);
    await seedGmailTokens('test.user@emctaipei.com', 'gmail-access-bound');
    const token = await seedSession('test.user@emctaipei.com', '測試使用者');
    await seedCase('26080010', { 'Gmail信件串ID': 'outside-thread-1', 'Gmail寄件帳號': 'test.user@emctaipei.com' });
    // 這條信件串的最後一封信主旨沒有英文 "Re:" 前綴（例如 Outlook 往來、或已經是 "回覆：" 這種中文前綴）——
    // 模擬「串接」到一條完全在系統之外建立的既有討論串。
    const threadMessages = [{
      id: 'outside-msg-1', labelIds: ['INBOX'], snippet: '',
      payload: {
        mimeType: 'text/plain', body: { data: toBase64Url('原始內容') },
        headers: [
          { name: 'From', value: 'client@example.com' }, { name: 'To', value: 'test.user@emctaipei.com' },
          { name: 'Message-Id', value: '<outside-1@mail.example.com>' }, { name: 'Subject', value: '回覆：舊系統討論串' }
        ]
      }
    }];
    const sentRaws: string[] = [];
    let sendAttempts = 0;
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
      const url = String(input);
      if (url === 'https://gmail.googleapis.com/gmail/v1/users/me/threads/outside-thread-1?format=full') {
        return Response.json({ id: 'outside-thread-1', messages: threadMessages });
      }
      if (url === 'https://gmail.googleapis.com/gmail/v1/users/me/messages/send') {
        sendAttempts += 1;
        const body = JSON.parse(String(init?.body));
        const decoded = decodeBase64UrlText(String(body.raw));
        sentRaws.push(decoded);
        // 第一次嘗試（推算出來的 "Re: 回覆：舊系統討論串"）刻意讓 Gmail 拒絕，模擬主旨跟討論串對不上；
        // 第二次嘗試（原封不動的 "回覆：舊系統討論串"）才成功。
        if (decoded.includes('Subject:') && sendAttempts === 1) {
          return Response.json({ error: { message: 'Precondition check failed.' } }, { status: 400 });
        }
        expect(body.threadId).toBe('outside-thread-1');
        return Response.json({ id: 'outside-msg-2', threadId: 'outside-thread-1' });
      }
      throw new Error(`unexpected fetch while replying to a bound external thread: ${url}`);
    });
    const replied = await api({ action: 'replyCaseMail', caseId: '26080010', bodyText: '回覆內容', to: 'client@example.com' }, token);
    expect(replied).toMatchObject({ ok: true, gmailMessageId: 'outside-msg-2', threaded: true });
    expect(sendAttempts).toBe(2);
    const decodeMimeSubject = (raw: string) => {
      const match = raw.match(/Subject: =\?UTF-8\?B\?([^?]+)\?=/);
      return match ? decodeBase64UrlText(match[1]) : '';
    };
    // 第一次嘗試用推算出來的主旨（加上 Re:）；第二次改用信件串原封不動的主旨，理論上一定通過 Gmail 自己的驗證。
    expect(decodeMimeSubject(sentRaws[0])).toBe('Re: 回覆：舊系統討論串');
    expect(decodeMimeSubject(sentRaws[1])).toBe('回覆：舊系統討論串');

    // 兩種主旨都被拒絕：最後才真的放棄 threadId，回報 threaded:false，不再悄悄假裝一切正常。
    await seedCase('26080011', { 'Gmail信件串ID': 'outside-thread-2', 'Gmail寄件帳號': 'test.user@emctaipei.com' });
    const stubbornThread = [{ ...threadMessages[0], payload: { ...threadMessages[0].payload, headers: threadMessages[0].payload.headers.map(h => h.name === 'Message-Id' ? { name: 'Message-Id', value: '<outside-2@mail.example.com>' } : h) } }];
    let stubbornAttempts = 0;
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
      const url = String(input);
      if (url === 'https://gmail.googleapis.com/gmail/v1/users/me/threads/outside-thread-2?format=full') {
        return Response.json({ id: 'outside-thread-2', messages: stubbornThread });
      }
      if (url === 'https://gmail.googleapis.com/gmail/v1/users/me/messages/send') {
        stubbornAttempts += 1;
        const body = JSON.parse(String(init?.body));
        if (body.threadId) return Response.json({ error: { message: 'Precondition check failed.' } }, { status: 400 });
        return Response.json({ id: 'outside-msg-3', threadId: 'brand-new-thread' });
      }
      throw new Error(`unexpected fetch while both subject variants are rejected: ${url}`);
    });
    const gaveUp = await api({ action: 'replyCaseMail', caseId: '26080011', bodyText: '回覆內容', to: 'client@example.com' }, token);
    expect(gaveUp).toMatchObject({ ok: true, gmailMessageId: 'outside-msg-3', threaded: false });
    expect(stubbornAttempts).toBe(3);
  });

  it('2026-08-26: getCaseMailThread 用「所有已知簽名檔」逐一比對，不是只認目前的預設一組——一封用非預設命名簽名檔寄出的歷史信件，只有把該簽名檔一起放進 signatureCandidates 才會被正確截掉；同時回傳結構化的 bodyHtml（保留原始格式，不是壓平的純文字）與 images[].contentId（供前端把內嵌圖片安插回本文原本的位置）', async () => {
    await seedAccountPermission('test.user@emctaipei.com', '自訂', ['request.mail']);
    await seedGmailTokens('test.user@emctaipei.com', 'gmail-access-1');
    const stub = env.DATABASE_COORDINATOR.getByName('primary') as DurableObjectStub<DatabaseCoordinator>;
    await runInDurableObject(stub, async (_instance, state) => {
      const stored = state.storage.sql.exec<{ json: string }>('SELECT json FROM database_state WHERE id = ?', 'primary').one();
      const database = JSON.parse(stored.json) as DatabaseSnapshot;
      const row = database.tables.database.rows.find(item => item['案件編號'] === '26080001')!;
      row['Gmail信件串ID'] = 'multi-signature-thread';
      row['Gmail寄件帳號'] = 'test.user@emctaipei.com';
      state.storage.sql.exec('UPDATE database_state SET json = ? WHERE id = ?', JSON.stringify(database), 'primary');
    });
    const token = await seedSession('test.user@emctaipei.com', '測試使用者');

    // 這封信寄出當下用的是「休假」這組命名簽名檔（不是目前的預設「正常」），比照這個系統自己寄信時的既有
    // 寫法（見 sendCaseMail 測試：signatureHtml 原封不動包成 <div>...</div> 接在本文最後、沒有 gmail_signature
    // class 標記），所以只能靠「跟已知簽名檔的原始字串完全相符」這個路徑辨識，不會被 class 標記那條路徑攔到。
    const bodyOpeningHtml = '<p>休假期間自動回覆：<b>目前無法即時處理</b>，請見諒。</p>';
    const vacationSignatureHtml = '<div style="color:#999">休假中，緊急事項請洽 <a href="mailto:anna@emctaipei.com">Anna</a></div>';
    const inlineImageHtml = '<img src="cid:vacation-note@inline">';
    const messageHtml = `${bodyOpeningHtml}${inlineImageHtml}<div>${vacationSignatureHtml}</div>`;
    const mockMessage = {
      id: 'multi-sig-msg-1', snippet: '休假期間自動回覆',
      payload: {
        mimeType: 'multipart/related',
        headers: [
          { name: 'From', value: 'test.user@emctaipei.com' }, { name: 'To', value: 'client@example.com' },
          { name: 'Date', value: 'Tue, 25 Aug 2026 09:00:00 +0800' }
        ],
        parts: [
          { mimeType: 'text/html', body: { data: toBase64Url(messageHtml) } },
          {
            mimeType: 'image/png', body: { attachmentId: 'vacation-att-1', size: 8 },
            headers: [{ name: 'Content-ID', value: '<vacation-note@inline>' }]
          }
        ]
      }
    };
    const currentDefaultSignatureHtml = '<b>正常簽名檔（目前預設，跟這封信實際用的不是同一組）</b>';
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
      const url = String(input);
      if (url === 'https://gmail.googleapis.com/gmail/v1/users/me/threads/multi-signature-thread?format=full') {
        expect(new Headers(init?.headers).get('Authorization')).toBe('Bearer gmail-access-1');
        return Response.json({ id: 'multi-signature-thread', messages: [mockMessage] });
      }
      if (url === 'https://gmail.googleapis.com/gmail/v1/users/me/messages/multi-sig-msg-1/attachments/vacation-att-1') {
        return Response.json({ attachmentId: 'vacation-att-1', size: 8, data: toBase64Url('fake-vacation-note-bytes') });
      }
      throw new Error(`unexpected fetch during multi-signature thread read: ${url}`);
    });

    // 先只送「目前的預設簽名檔」——重現使用者回報的問題：對不上這封信實際用的那組，簽名檔完全沒被截掉，
    // 整段（含格式）原封不動出現在 bodyHtml／bodyText 裡。
    const withOnlyDefaultCandidate = await api({
      action: 'getCaseMailThread', caseId: '26080001', signatureCandidates: [currentDefaultSignatureHtml]
    }, token);
    expect(withOnlyDefaultCandidate.ok).toBe(true);
    const messageWithOnlyDefault = (withOnlyDefaultCandidate.messages as Array<Record<string, unknown>>)[0];
    expect(String(messageWithOnlyDefault.bodyHtml)).toContain('休假中，緊急事項請洽');
    expect(String(messageWithOnlyDefault.bodyText)).toContain('休假中，緊急事項請洽');

    // 把這封信實際用的那組（休假簽名檔）也加進候選清單——現在應該正確截掉，不管它在陣列裡排第幾個。
    const withBothCandidates = await api({
      action: 'getCaseMailThread', caseId: '26080001',
      signatureCandidates: [currentDefaultSignatureHtml, vacationSignatureHtml]
    }, token);
    expect(withBothCandidates.ok).toBe(true);
    const message = (withBothCandidates.messages as Array<Record<string, unknown>>)[0];
    expect(String(message.bodyHtml)).not.toContain('休假中，緊急事項請洽');
    expect(String(message.bodyText)).not.toContain('休假中，緊急事項請洽');

    // bodyHtml 保留原始格式標籤（不是被壓平成純文字）——前端會用自己的 DOMParser 白名單過濾器渲染，
    // Worker 端這裡完全不做淨化，原始標籤要原封不動保留才能讓前端正確重建格式。截斷點是用
    // html.lastIndexOf(已知簽名檔字串) 找到的，簽名檔外層包的 <div> 標籤本身不算在「已知簽名檔」字串裡，
    // 所以截斷後會留下一個沒有內容、緊接著被前端 DOMParser 自動補完關閉的空 <div>——這是既有的既定行為
    // （不是這次改動引入的），不影響顯示結果（前端渲染出來就是一個沒有任何內容的空標籤）。
    expect(String(message.bodyHtml)).toContain(`${bodyOpeningHtml}${inlineImageHtml}`);
    expect(String(message.bodyHtml)).toContain('<b>目前無法即時處理</b>');
    expect(String(message.bodyHtml).length).toBeLessThan(messageHtml.length);

    // 內嵌圖片要帶回對應的 contentId（已經去掉標頭原始格式的頭尾尖括號），前端才能把它安插回本文裡
    // <img src="cid:vacation-note@inline"> 原本引用的位置，而不是變成跟本文脫節、只能另外看的縮圖。
    const images = message.images as Array<{ dataUrl: string; contentId: string }>;
    expect(images).toHaveLength(1);
    expect(images[0].contentId).toBe('vacation-note@inline');
    expect(images[0].dataUrl.startsWith('data:image/png;base64,')).toBe(true);
  });

  it('2026-08-20: computeReplySuggestion 組出的建議副本要保留聯絡人顯示名，不能被裁成只剩一長串信箱——回信編輯器的「副本」聯絡人晶片才有名字可以顯示', async () => {
    const stub = env.DATABASE_COORDINATOR.getByName('primary') as DurableObjectStub<DatabaseCoordinator>;
    await runInDurableObject(stub, async (_instance, state) => {
      const stored = state.storage.sql.exec<{ json: string }>('SELECT json FROM database_state WHERE id = ?', 'primary').one();
      const database = JSON.parse(stored.json) as DatabaseSnapshot;
      database.tables.database.rows.push({
        '案件編號': '26080005', '客戶別': '測試客戶', '專案名稱': '副本顯示名測試案件', '狀態': '過稿中',
        'Gmail信件串ID': 'gmail-thread-named-cc', 'Gmail寄件帳號': 'test.user@emctaipei.com'
      });
      state.storage.sql.exec('UPDATE database_state SET json = ? WHERE id = ?', JSON.stringify(database), 'primary');
    });
    await seedAccountPermission('test.user@emctaipei.com', '自訂', ['request.mail']);
    await seedGmailTokens('test.user@emctaipei.com', 'gmail-access-named-cc');
    const token = await seedSession('test.user@emctaipei.com');

    // 最後一封信是客戶寄來的（不是寄件帳號自己寄出的），所以建議收件人應該直接是這封信的寄件人（含顯示名，
    // 因為 to 這個欄位本身沒有經過任何裁切顯示名的處理）；副本裡「傅思凱」有顯示名、「another@example.com」
    // 沒有顯示名——修正前的舊邏輯（extractEmailAddressesFromHeader）會把兩者都裁成只剩信箱，這裡要驗證
    // 「傅思凱」這個名字有被保留下來，不是巧合通過。
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
      const url = String(input);
      if (url === 'https://gmail.googleapis.com/gmail/v1/users/me/threads/gmail-thread-named-cc?format=full') {
        expect(new Headers(init?.headers).get('Authorization')).toBe('Bearer gmail-access-named-cc');
        return Response.json({
          id: 'gmail-thread-named-cc',
          messages: [{
            id: 'gmail-msg-named-cc', snippet: '',
            payload: {
              mimeType: 'text/plain', body: { data: toBase64Url('麻煩再確認一下這次的修改內容') },
              headers: [
                { name: 'From', value: '"客戶窗口" <client@example.com>' },
                { name: 'To', value: 'test.user@emctaipei.com' },
                { name: 'Cc', value: '"傅思凱" <sikai.fu@emctaipei.com>, another@example.com' }
              ]
            }
          }]
        });
      }
      throw new Error(`unexpected fetch: ${url}`);
    });
    const thread = await api({ action: 'getCaseMailThread', caseId: '26080005' }, token);
    expect(thread.ok).toBe(true);
    expect(thread.suggestedTo).toBe('"客戶窗口" <client@example.com>');
    expect(thread.suggestedCc).toBe('傅思凱 <sikai.fu@emctaipei.com>, another@example.com');
  });

  it('2026-08-21: computeReplySuggestion 排除自己後如果收件人變成空字串，要退回上一封的寄件人，不能讓建議收件人整個空白——最常見於同一個帳號兼任 PM 與設計師（例如「設計師回覆信」）：第一封信是自己填單寄給自己（設計負責人），回信時排除自己後完全沒有剩下任何人', async () => {
    const stub = env.DATABASE_COORDINATOR.getByName('primary') as DurableObjectStub<DatabaseCoordinator>;
    await runInDurableObject(stub, async (_instance, state) => {
      const stored = state.storage.sql.exec<{ json: string }>('SELECT json FROM database_state WHERE id = ?', 'primary').one();
      const database = JSON.parse(stored.json) as DatabaseSnapshot;
      database.tables.database.rows.push({
        '案件編號': '26080006', '客戶別': '測試客戶', '專案名稱': '自己回自己測試案件', '狀態': '過稿中',
        'Gmail信件串ID': 'gmail-thread-self-reply', 'Gmail寄件帳號': 'machi@emctaipei.com'
      });
      state.storage.sql.exec('UPDATE database_state SET json = ? WHERE id = ?', JSON.stringify(database), 'primary');
    });
    await seedAccountPermission('machi@emctaipei.com', '自訂', ['request.mail']);
    await seedGmailTokens('machi@emctaipei.com', 'gmail-access-machi', 'machi.real@gmail.example');
    const token = await seedSession('machi@emctaipei.com');

    // 唯一一封信：Machi 用自己的帳號填單寄出第一封信，收件人是這個案件的「設計負責人」——但設計負責人
    // 剛好也是 Machi 自己（同一個人兼兩個角色），所以 To 欄位就是 Machi 自己的信箱，From 則是他實際連接
    // 的 Gmail 地址（跟系統帳號別名是兩個不同字串，比照既有 Google Workspace 別名情境的測試慣例）。
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
      const url = String(input);
      if (url === 'https://gmail.googleapis.com/gmail/v1/users/me/threads/gmail-thread-self-reply?format=full') {
        expect(new Headers(init?.headers).get('Authorization')).toBe('Bearer gmail-access-machi');
        return Response.json({
          id: 'gmail-thread-self-reply',
          messages: [{
            id: 'gmail-msg-self-reply', snippet: '',
            payload: {
              mimeType: 'text/plain', body: { data: toBase64Url('請協助這次的設計需求') },
              headers: [
                { name: 'From', value: 'machi.real@gmail.example' },
                { name: 'To', value: 'machi@emctaipei.com' },
                { name: 'Cc', value: '"傅思凱" <eric.fu@emctaipei.com>' }
              ]
            }
          }]
        });
      }
      throw new Error(`unexpected fetch: ${url}`);
    });
    const thread = await api({ action: 'getCaseMailThread', caseId: '26080006' }, token);
    expect(thread.ok).toBe(true);
    // 排除自己（machi@emctaipei.com／machi.real@gmail.example）後，To 欄位完全沒有剩下任何人——正確退回
    // 用上一封信的寄件人（就是 Machi 自己）當建議收件人，不能讓欄位整個留空。
    expect(thread.suggestedTo).toBe('machi.real@gmail.example');
    // 副本不受這個退回機制影響，仍然正確排除自己、保留其他真正的第三方（傅思凱）。
    expect(thread.suggestedCc).toBe('傅思凱 <eric.fu@emctaipei.com>');
  });

  it('2026-08-19: getCaseMailThread／replyCaseMail 也納入客戶別「權限設定」白名單——即使是討論串本身的實際收件人，不在白名單裡一樣被擋；加進白名單後才會走到既有的討論串相關人檢查並成功', async () => {
    await seedAccountPermission('test.user@emctaipei.com', '自訂', ['request.mail']);
    // 白名單只有別人，不含 test.user——即使他之後確實是討論串的收件人也一樣被擋。
    await seedCustomerOwner('測試客戶', 'someone.else@emctaipei.com');

    // 直接在 DO 裡準備好一個「已經寄出過信、test.user 確實是收件人」的假狀態，不用重跑一次完整的連接
    // Gmail／寄信流程——這裡只是要驗證「即使是討論串相關人，不在客戶別白名單也一樣被擋」。
    const stub = env.DATABASE_COORDINATOR.getByName('primary') as DurableObjectStub<DatabaseCoordinator>;
    await runInDurableObject(stub, async (_instance, state) => {
      const stored = state.storage.sql.exec<{ json: string }>('SELECT json FROM database_state WHERE id = ?', 'primary').one();
      const database = JSON.parse(stored.json) as DatabaseSnapshot;
      const row = database.tables.database.rows.find(item => item['案件編號'] === '26080001')!;
      row['客戶別'] = '測試客戶';
      row['Gmail信件串ID'] = 'gmail-thread-locked';
      row['Gmail寄件帳號'] = 'test.user@emctaipei.com';
      state.storage.sql.exec('UPDATE database_state SET json = ? WHERE id = ?', JSON.stringify(database), 'primary');
      state.storage.sql.exec(
        `INSERT INTO gmail_tokens(account, refresh_token, access_token, access_token_expires_at, gmail_address, connected_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
        'test.user@emctaipei.com', 'refresh-locked', 'gmail-access-locked', Date.now() + 3600 * 1000,
        'test.user@gmail.example', new Date().toISOString(), new Date().toISOString()
      );
    });

    const tester = await api({ action: 'login', password: 'test' });
    const token = String(tester.token);

    vi.spyOn(globalThis, 'fetch').mockImplementation(async input => {
      const url = String(input);
      if (url === 'https://gmail.googleapis.com/gmail/v1/users/me/threads/gmail-thread-locked?format=full') {
        return Response.json({
          id: 'gmail-thread-locked',
          messages: [{
            id: 'gmail-msg-locked', snippet: '',
            payload: {
              mimeType: 'text/plain', body: { data: toBase64Url('hi') },
              headers: [{ name: 'From', value: 'client@example.com' }, { name: 'To', value: 'test.user@emctaipei.com' }]
            }
          }]
        });
      }
      throw new Error(`unexpected fetch while whitelist blocks a real participant: ${url}`);
    });

    // test.user 確實是這封信的收件人（討論串相關人），但客戶別白名單只有別人——要被客戶別權限擋下
    // （reason 是 REQUEST_MAIL_DENIED），不是被「不是討論串相關人」擋下（那是完全不同的另一種原因）。
    const blockedRead = await api({ action: 'getCaseMailThread', caseId: '26080001' }, token);
    expect(blockedRead).toMatchObject({ ok: false, reason: 'REQUEST_MAIL_DENIED' });
    const blockedReply = await api({ action: 'replyCaseMail', caseId: '26080001', bodyText: '不該成功' }, token);
    expect(blockedReply).toMatchObject({ ok: false, reason: 'REQUEST_MAIL_DENIED' });

    // 白名單放行後，才會真的走到既有的討論串相關人檢查並成功讀信。
    await seedCustomerOwner('測試客戶', 'test.user@emctaipei.com');
    const allowedRead = await api({ action: 'getCaseMailThread', caseId: '26080001' }, token);
    expect(allowedRead.ok).toBe(true);
  });

  it('reads the Gmail signature for the connected send-as address, and reports a clear reason when the token lacks gmail.settings.basic', async () => {
    await seedAccountPermission('test.user@emctaipei.com', '自訂', ['request.mail']);
    const tester = await api({ action: 'login', password: 'test' });
    const token = String(tester.token);

    vi.spyOn(globalThis, 'fetch').mockImplementation(async (input) => {
      const url = String(input);
      if (url === 'https://oauth2.googleapis.com/token') return Response.json({ access_token: 'gmail-access-1', refresh_token: 'gmail-refresh-1', expires_in: 3600 });
      if (url === 'https://www.googleapis.com/oauth2/v2/userinfo') return Response.json({ email: 'designer.mailbox@gmail.com' });
      throw new Error(`unexpected fetch during connect: ${url}`);
    });
    await api({ action: 'gmailOauthConnect', code: 'auth-code', redirectUri: ORIGIN }, token);

    vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
      const url = String(input);
      if (url === 'https://gmail.googleapis.com/gmail/v1/users/me/settings/sendAs') {
        expect(new Headers(init?.headers).get('Authorization')).toBe('Bearer gmail-access-1');
        return Response.json({
          sendAs: [
            { sendAsEmail: 'someone.else@gmail.com', displayName: '其他別名', isPrimary: false, signature: '不該被選到的簽名' },
            { sendAsEmail: 'designer.mailbox@gmail.com', displayName: 'Machi', isPrimary: true, signature: '<b>Machi</b><br>EMC 設計組' },
            { sendAsEmail: 'no-signature@gmail.com', isPrimary: false, signature: '' }
          ]
        });
      }
      throw new Error(`unexpected fetch during signature read: ${url}`);
    });
    const signature = await api({ action: 'getGmailSignature' }, token);
    expect(signature).toMatchObject({ ok: true, signature: '<b>Machi</b><br>EMC 設計組' });
    // signatures 應該把有實際內容的傳送郵件地址各自攤開回傳（供前端「選擇不同預設簽名檔」的選單使用），
    // 不是只回傳自動帶入那一筆——這是這次新增、跟舊行為疊加、不取代舊欄位的部分；完全沒有填簽名檔內容
    // 的別名（no-signature@gmail.com）正確被濾掉，不會出現一個選了也沒有東西可插入的空選項。
    expect(signature.signatures).toEqual([
      { email: 'someone.else@gmail.com', displayName: '其他別名', isPrimary: false, signature: '不該被選到的簽名' },
      { email: 'designer.mailbox@gmail.com', displayName: 'Machi', isPrimary: true, signature: '<b>Machi</b><br>EMC 設計組' }
    ]);

    vi.spyOn(globalThis, 'fetch').mockImplementation(async (input) => {
      const url = String(input);
      if (url === 'https://gmail.googleapis.com/gmail/v1/users/me/settings/sendAs') return new Response('insufficient scope', { status: 403 });
      throw new Error(`unexpected fetch during insufficient-scope read: ${url}`);
    });
    const insufficientScope = await api({ action: 'getGmailSignature' }, token);
    expect(insufficientScope).toMatchObject({ ok: false, reason: 'INSUFFICIENT_SCOPE' });
  });

  it('starts with the 28 default customers, preserves existing assignments plus extra admin-added customers, and does not resurrect a deleted default customer on the next normalize', async () => {
    await seedCustomerOwner('Epson', 'test.user@emctaipei.com');
    const token = await login();
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (_input, init) => {
      expect(init?.method).toBe('PUT');
      return Response.json({ content: { sha: 'customer-extra-file-sha' }, commit: { sha: 'customer-extra-commit-sha' } });
    });
    // 後台通用的 adminTableInsert 新增一個不在預設清單裡的客戶別，確認既有的預設客戶別不會被洗掉。
    const inserted = await api({
      action: 'adminTableInsert', table: '客戶別',
      row: { '客戶別': '後台自訂客戶', '專案負責人': '[]', '設計負責人': '[]', '部門組別': '[]', '更新時間': '', '更新者': 'Machi' }
    }, token);
    expect(inserted.ok).toBe(true);

    const stub = env.DATABASE_COORDINATOR.getByName('primary') as DurableObjectStub<DatabaseCoordinator>;
    const readSnapshot = async () => runInDurableObject(stub, async (_instance, state) => {
      const stored = state.storage.sql.exec<{ json: string }>('SELECT json FROM database_state WHERE id = ?', 'primary').one();
      return JSON.parse(stored.json) as DatabaseSnapshot;
    });
    const database = await readSnapshot();
    const customerRows = database.tables['客戶別'].rows;
    expect(customerRows).toHaveLength(DEFAULT_CUSTOMER_NAMES.length + 1);
    expect(customerRows.map(row => row['客戶別'])).toEqual(expect.arrayContaining([...DEFAULT_CUSTOMER_NAMES, '後台自訂客戶']));
    expect(JSON.parse(String(customerRows.find(row => row['客戶別'] === 'Epson')?.['專案負責人']))).toEqual(['test.user@emctaipei.com']);

    // 迴歸測試：2026-08-19 實際發生過的真人回報 bug——刪除任何一個「預設」客戶別（不是後台自訂新增的）都會在
    // 下一次讀取（例如下一個 API 請求重新載入快照，`snapshot()` 每次都會呼叫 `storedSnapshot()`→`normalizeSnapshot()`
    // 重新從 SQL 儲存讀出並套用 normalizeDatabaseShape）時被舊版合併邏輯無聲加回來，等於功能上永遠刪不掉。
    // 這裡明確刪除一個預設客戶別（'統一'），並透過兩種完全獨立的後續請求確認它真的消失、不會被重新種回去。
    const deleted = await api({ action: 'adminTableDelete', table: '客戶別', key: '統一' }, token);
    expect(deleted).toMatchObject({ ok: true, table: '客戶別' });
    const afterDeleteDirect = await readSnapshot();
    expect(afterDeleteDirect.tables['客戶別'].rows.some(row => row['客戶別'] === '統一')).toBe(false);
    expect(afterDeleteDirect.tables['客戶別'].rows).toHaveLength(DEFAULT_CUSTOMER_NAMES.length);

    const tablesAfterDelete = await api({ action: 'adminTables' }, token);
    const customerMeta = (tablesAfterDelete.tables as Record<string, { rowCount: number }>)?.['客戶別'];
    expect(customerMeta?.rowCount).toBe(DEFAULT_CUSTOMER_NAMES.length);
    const rowsAfterDelete = await api({ action: 'adminTableRows', table: '客戶別', offset: 0, limit: 100 }, token);
    const rowsList = (rowsAfterDelete.rows as Array<Record<string, unknown>>) || [];
    expect(rowsList.some(row => row['客戶別'] === '統一')).toBe(false);
    expect(rowsList).toHaveLength(DEFAULT_CUSTOMER_NAMES.length);
  });

  it('lets any request.create account add a bare customer via addCustomer, rejects duplicates, and also allows anonymous submitters (matching the case-submission form)', async () => {
    const tester = await api({ action: 'login', password: 'test' });
    const token = String(tester.token);
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (_input, init) => {
      expect(init?.method).toBe('PUT');
      return Response.json({ content: { sha: `add-customer-file-${crypto.randomUUID()}` }, commit: { sha: 'add-customer-commit-sha' } });
    });
    const created = await api({ action: 'addCustomer', name: '新測試客戶' }, token);
    expect(created).toMatchObject({ ok: true, action: 'addCustomer', customer: { '客戶別': '新測試客戶' } });
    // 新客戶別要自帶「預設信箱」：填完案件跳出的信件編輯器會用它當副本名單（設計部平面四位＋負責人）。
    expect(JSON.parse(String((created.customer as Record<string, unknown>)['預設信箱']))).toEqual([
      'machi.chen@emctaipei.com', 'anna.hsu@emctaipei.com', 'amber.tian@emctaipei.com', 'leona.chen@emctaipei.com', 'eric.fu@emctaipei.com'
    ]);

    const duplicate = await api({ action: 'addCustomer', name: '新測試客戶' }, token);
    expect(duplicate).toMatchObject({ ok: false, error: '這個客戶別已經存在' });

    const empty = await api({ action: 'addCustomer', name: '   ' }, token);
    expect(empty).toMatchObject({ ok: false, error: '請輸入客戶別名稱' });

    // 比照案件填單本身不強制登入的既有慣例：沒有 session 也能新增客戶別（不需要 request.create 檢查）。
    const anonymous = await api({ action: 'addCustomer', name: '匿名新增客戶' });
    expect(anonymous).toMatchObject({ ok: true, customer: { '客戶別': '匿名新增客戶', '更新者': '匿名填單' } });

    const stub = env.DATABASE_COORDINATOR.getByName('primary') as DurableObjectStub<DatabaseCoordinator>;
    const database = await runInDurableObject(stub, async (_instance, state) => {
      const stored = state.storage.sql.exec<{ json: string }>('SELECT json FROM database_state WHERE id = ?', 'primary').one();
      return JSON.parse(stored.json) as DatabaseSnapshot;
    });
    expect(database.tables['客戶別'].rows.filter(row => row['客戶別'] === '新測試客戶')).toHaveLength(1);
    expect(database.tables['客戶別'].rows.some(row => row['客戶別'] === '匿名新增客戶')).toBe(true);
  });

  it('2026-08-19: 客戶別「權限設定」名單制——只要客戶別設定過名單，名單內帳號可對該客戶別「所有」案件發信／編輯／刪除（不再要求案件本身的專案負責人文字＝自己），沒設定過名單的客戶別退回一般角色權限', async () => {
    // 完全沒有 request.edit／request.delete／request.mail，只靠客戶別的「權限設定」名單額外放行。
    await seedAccountPermission('test.user@emctaipei.com', '自訂', ['request.create']);
    await seedCustomerOwner('測試客戶', 'test.user@emctaipei.com');

    const stub = env.DATABASE_COORDINATOR.getByName('primary') as DurableObjectStub<DatabaseCoordinator>;
    await runInDurableObject(stub, async (_instance, state) => {
      const stored = state.storage.sql.exec<{ json: string }>('SELECT json FROM database_state WHERE id = ?', 'primary').one();
      const database = JSON.parse(stored.json) as DatabaseSnapshot;
      // 26080001（既有種子案件）的專案負責人比對「設定」表的顯示名，不是帳號本身。
      database.tables.database.rows.find(row => row['案件編號'] === '26080001')!['專案負責人'] = '測試使用者';
      database.tables.database.rows.push(
        { '案件編號': '26080002', '客戶別': '測試客戶', '專案負責人': '別人', '專案名稱': '同客戶別、案件本身寫別人', '狀態': '未開始' },
        { '案件編號': '26080003', '客戶別': '測試客戶', '專案負責人': '測試使用者', '專案名稱': '刪除測試案件', '狀態': '未開始' },
        { '案件編號': '26080004', '客戶別': '沒有設定權限名單的客戶', '專案負責人': '測試使用者', '專案名稱': '不同客戶別，即使案件本身寫自己也一樣', '狀態': '未開始' }
      );
      state.storage.sql.exec('UPDATE database_state SET json = ? WHERE id = ?', JSON.stringify(database), 'primary');
    });

    const tester = await api({ action: 'login', password: 'test' });
    const token = String(tester.token);
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (_input, init) => {
      expect(init?.method).toBe('PUT');
      return Response.json({ content: { sha: `owner-file-${crypto.randomUUID()}` }, commit: { sha: 'owner-commit-sha' } });
    });

    // 編輯自己負責的案件：成功。
    const ownUpdate = await api({ action: 'update', id: '26080001', row: { id: '26080001', project: '自己負責的更新' } }, token);
    expect(ownUpdate).toMatchObject({ ok: true, id: '26080001' });

    // 編輯同一客戶別、但案件本身「專案負責人」文字是別人的案件：2026-08-19 起也放行——
    // 客戶別「權限設定」現在是整個客戶別的白名單，不再要求案件本身的專案負責人文字要等於自己。
    const sameCustomerUpdate = await api({ action: 'update', id: '26080002', row: { id: '26080002', project: '同客戶別現在也能改' } }, token);
    expect(sameCustomerUpdate).toMatchObject({ ok: true, id: '26080002' });

    // 不同客戶別（該客戶別完全沒有設定「權限設定」名單）：退回一般角色權限判斷——test.user 只有
    // request.create，所以還是被擋，即使案件本身的專案負責人文字剛好是自己。
    const otherCustomerUpdate = await api({ action: 'update', id: '26080004', row: { id: '26080004', project: '不該被改' } }, token);
    expect(otherCustomerUpdate).toMatchObject({ ok: false, error: '此帳號沒有「request.edit」權限' });

    // batchUpdate 不套用這個放寬，即使是自己負責的客戶別也一樣要求 request.edit。
    const batchAttempt = await api({ action: 'batchUpdate', rows: [{ id: '26080001', row: { project: '批次不應該成功' } }] }, token);
    expect(batchAttempt).toMatchObject({ ok: false, error: '此帳號沒有「request.edit」權限' });

    // 發信：2026-08-19 起跟編輯／刪除統一走同一套客戶別白名單——同客戶別「測試客戶」的案件，不管案件
    // 本身「專案負責人」文字寫的是誰，只要帳號在客戶別白名單裡就能發信；26080004 是完全沒設定過白名單
    // 的不同客戶別，退回一般角色權限判斷，test.user 沒有 request.mail，一樣被擋。
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
      const url = String(input);
      if (url === 'https://gmail.googleapis.com/gmail/v1/users/me/messages/send') return Response.json({ id: 'msg-1', threadId: 'thread-1' });
      if (url.startsWith('https://api.github.com/')) return Response.json({ content: { sha: `mail-file-${crypto.randomUUID()}` }, commit: { sha: 'mail-commit-sha' } });
      throw new Error(`unexpected fetch during owner-mail test: ${url}`);
    });
    // 尚未連接 Gmail，所以直接呼叫 sendCaseMail 會在權限檢查之後卡在「尚未連接 Gmail」，
    // 這裡只驗證權限層是否放行／擋下（用是否還是「此帳號沒有「request.mail」權限」這個特定錯誤字串來判斷）。
    const ownMailAttempt = await api({ action: 'sendCaseMail', caseId: '26080001', to: 'x@example.com', subject: 'test', bodyText: 'x' }, token);
    expect(ownMailAttempt.error).not.toBe('此帳號沒有「request.mail」權限');
    const sameCustomerMailAttempt = await api({ action: 'sendCaseMail', caseId: '26080002', to: 'x@example.com', subject: 'test', bodyText: 'x' }, token);
    expect(sameCustomerMailAttempt.error).not.toBe('此帳號沒有「request.mail」權限');
    const otherCustomerMailAttempt = await api({ action: 'sendCaseMail', caseId: '26080004', to: 'x@example.com', subject: 'test', bodyText: 'x' }, token);
    expect(otherCustomerMailAttempt).toMatchObject({ ok: false, error: '此帳號沒有「request.mail」權限' });

    // 刪除：同客戶別、案件本身專案負責人文字是別人的也放行（跟編輯一致）；不同客戶別仍被擋。
    const sameCustomerDelete = await api({ action: 'delete', id: '26080002' }, token);
    expect(sameCustomerDelete).toMatchObject({ ok: true, id: '26080002' });
    const ownDelete = await api({ action: 'delete', id: '26080003' }, token);
    expect(ownDelete).toMatchObject({ ok: true, id: '26080003' });
    const otherCustomerDelete = await api({ action: 'delete', id: '26080004' }, token);
    expect(otherCustomerDelete).toMatchObject({ ok: false, error: '此帳號沒有「request.delete」權限' });

    // archive.edit 分支不受這個放寬影響：即使是自己負責的客戶別，帶 accessContext:'archive' 一樣要求 archive.edit。
    const archiveDelete = await api({ action: 'delete', id: '26080001', accessContext: 'archive' }, token);
    expect(archiveDelete).toMatchObject({ ok: false, error: '此帳號沒有「archive.edit」權限' });
  });

  it('2026-08-19: 客戶別「權限設定」名單制是取代、不是疊加——即使帳號一般角色權限本來就有 request.edit/request.delete/request.mail，只要不在該客戶別的名單裡一樣被擋', async () => {
    await seedAccountPermission('test.user@emctaipei.com', '自訂', ['request.create', 'request.edit', 'request.delete', 'request.mail']);
    // 名單只有別人，不包含 test.user——即使案件本身的專案負責人文字寫的剛好是自己也一樣被擋。
    await seedCustomerOwner('測試客戶', 'someone.else@emctaipei.com');

    const stub = env.DATABASE_COORDINATOR.getByName('primary') as DurableObjectStub<DatabaseCoordinator>;
    await runInDurableObject(stub, async (_instance, state) => {
      const stored = state.storage.sql.exec<{ json: string }>('SELECT json FROM database_state WHERE id = ?', 'primary').one();
      const database = JSON.parse(stored.json) as DatabaseSnapshot;
      database.tables.database.rows.find(row => row['案件編號'] === '26080001')!['專案負責人'] = '測試使用者';
      state.storage.sql.exec('UPDATE database_state SET json = ? WHERE id = ?', JSON.stringify(database), 'primary');
    });

    const tester = await api({ action: 'login', password: 'test' });
    const token = String(tester.token);
    const blockedUpdate = await api({ action: 'update', id: '26080001', row: { id: '26080001', project: '不該被改' } }, token);
    expect(blockedUpdate).toMatchObject({ ok: false, error: '此帳號沒有「request.edit」權限' });
    const blockedMail = await api({ action: 'sendCaseMail', caseId: '26080001', to: 'x@example.com', subject: 'test', bodyText: 'x' }, token);
    expect(blockedMail).toMatchObject({ ok: false, error: '此帳號沒有「request.mail」權限' });
    const blockedDelete = await api({ action: 'delete', id: '26080001' }, token);
    expect(blockedDelete).toMatchObject({ ok: false, error: '此帳號沒有「request.delete」權限' });
  });

  it('lets the manager account edit, delete and mail any case regardless of customer assignment, even when the customer has a 權限設定 whitelist that excludes them', async () => {
    // 26080001 的客戶別（測試客戶）刻意設定一份完全不含管理者的白名單，確認管理者仍然不受限。
    await seedCustomerOwner('測試客戶', 'someone.else@emctaipei.com');
    const token = await login();
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
      const url = String(input);
      if (url === 'https://gmail.googleapis.com/gmail/v1/users/me/messages/send') return Response.json({ id: 'manager-msg-1', threadId: 'manager-thread-1' });
      expect(init?.method).toBe('PUT');
      return Response.json({ content: { sha: `manager-file-${crypto.randomUUID()}` }, commit: { sha: 'manager-commit-sha' } });
    });
    const managerUpdate = await api({ action: 'update', id: '26080001', row: { id: '26080001', project: '管理者不受限' } }, token);
    expect(managerUpdate).toMatchObject({ ok: true, id: '26080001' });
    // 管理者尚未連接 Gmail，寄信會在權限檢查之後卡在「尚未連接 Gmail」——這裡只驗證權限層沒有擋下
    // （不是卡在「此帳號沒有「request.mail」權限」這個特定錯誤），證明管理者對客戶別白名單一樣不受限。
    const managerMail = await api({ action: 'sendCaseMail', caseId: '26080001', to: 'x@example.com', subject: 'test', bodyText: 'x' }, token);
    expect(managerMail.error).not.toBe('此帳號沒有「request.mail」權限');
    const managerDelete = await api({ action: 'delete', id: '26080001' }, token);
    expect(managerDelete).toMatchObject({ ok: true, id: '26080001' });
  });

  it('does not commit to GitHub when saveUserSettings would leave the settings row exactly as it was', async () => {
    const token = await login();
    let commits = 0;
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
      if (String(input) === 'https://api.github.com/repos/EMCtaipeiART/EMCtaipeiART.github.io/contents/backend/data/db.json') {
        expect(init?.method).toBe('PUT');
        commits += 1;
        return Response.json({ content: { sha: `settings-file-${crypto.randomUUID()}` }, commit: { sha: 'settings-commit-sha' } });
      }
      throw new Error(`unexpected fetch: ${String(input)}`);
    });

    // 第一次是真的改了深淺模式，要提交。
    const first = await api({ action: 'saveUserSettings', settings: { theme: 'dark', '深淺模式': '深色' } }, token);
    expect(first).toMatchObject({ ok: true, action: 'saveUserSettings' });
    expect(commits).toBe(1);

    // 第二次送出一模一樣的設定：畫面照常拿到成功結果，但不可以再提交一次（每次提交都會觸發網站重新部署）。
    const second = await api({ action: 'saveUserSettings', settings: { theme: 'dark', '深淺模式': '深色' } }, token);
    expect(second).toMatchObject({ ok: true, action: 'saveUserSettings', unchanged: true });
    expect(commits).toBe(1);

    // 再改回淺色又是真的變動，照常提交。
    await api({ action: 'saveUserSettings', settings: { theme: 'light', '深淺模式': '淺色' } }, token);
    expect(commits).toBe(2);
  });

  describe('new 客戶別 defaults', () => {
    /** 在「設定」表補一位人員，讓 newCustomerDefaults() 讀得到他的部門／組別。 */
    async function seedStaff(account: string, department: string, group: string, name = account): Promise<void> {
      const stub = env.DATABASE_COORDINATOR.getByName('primary') as DurableObjectStub<DatabaseCoordinator>;
      await runInDurableObject(stub, async (_instance, state) => {
        const stored = state.storage.sql.exec<{ json: string }>('SELECT json FROM database_state WHERE id = ?', 'primary').one();
        const database = JSON.parse(stored.json) as DatabaseSnapshot;
        // 同一個帳號在「設定」表只會有一列（settingsRow 取第一筆），既有的要覆寫而不是再 push 一列。
        const existing = database.tables['設定'].rows.find(row => String(row['帳號'] || '').toLowerCase() === account.toLowerCase());
        if (existing) Object.assign(existing, { '部門': department, '組別': group, '名字': name, '顯示名': name });
        else database.tables['設定'].rows.push({ '部門': department, '組別': group, '名字': name, '顯示名': name, '帳號': account });
        state.storage.sql.exec('UPDATE database_state SET json = ? WHERE id = ?', JSON.stringify(database), 'primary');
      });
    }
    async function customerRow(name: string): Promise<Record<string, unknown> | undefined> {
      const stub = env.DATABASE_COORDINATOR.getByName('primary') as DurableObjectStub<DatabaseCoordinator>;
      return runInDurableObject(stub, async (_instance, state) => {
        const stored = state.storage.sql.exec<{ json: string }>('SELECT json FROM database_state WHERE id = ?', 'primary').one();
        const database = JSON.parse(stored.json) as DatabaseSnapshot;
        return database.tables['客戶別'].rows.find(row => row['客戶別'] === name);
      });
    }
    function mockGitHubCommit(): void {
      vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
        if (String(input) === 'https://api.github.com/repos/EMCtaipeiART/EMCtaipeiART.github.io/contents/backend/data/db.json') {
          expect(init?.method).toBe('PUT');
          return Response.json({ content: { sha: `customer-file-${crypto.randomUUID()}` }, commit: { sha: 'customer-commit-sha' } });
        }
        throw new Error(`unexpected fetch: ${String(input)}`);
      });
    }

    it('gives a customer created from the request form the three standing departments plus the creator\'s own project group', async () => {
      await seedAccountPermission('pm@emctaipei.com', '自訂', ['request.create']);
      await seedStaff('pm@emctaipei.com', '專案部', 'Celine組', '專案同仁');
      const token = await seedSession('pm@emctaipei.com', '專案同仁');
      mockGitHubCommit();

      const created = await api({ action: 'addCustomer', name: '新客戶A' }, token);
      expect(created.ok).toBe(true);
      const row = await customerRow('新客戶A');
      // 「部門／組別」＝前台看得到這個客戶別案件的範圍；「專案負責人」＝編輯／刪除／發信白名單。
      expect(JSON.parse(String(row?.['部門組別']))).toEqual(['測試員', '設計部', '企劃部', 'Celine組']);
      expect(JSON.parse(String(row?.['專案負責人']))).toEqual([
        'department:測試員', 'department:設計部', 'department:企劃部', 'group:Celine組'
      ]);
      // 「喜愛設定」是每個客戶別各自不同的偏好，沒有共通預設，維持空白。
      expect(row?.['設計負責人']).toBe('[]');
    });

    it('adds no group for a creator outside a project department, and keeps the creator reachable when none of the standing departments covers them', async () => {
      await seedAccountPermission('design@emctaipei.com', '自訂', ['request.create']);
      await seedStaff('design@emctaipei.com', '設計部', '平面', '設計同仁');
      const designerToken = await seedSession('design@emctaipei.com', '設計同仁');
      mockGitHubCommit();
      await api({ action: 'addCustomer', name: '設計建立的客戶' }, designerToken);
      const designerRow = await customerRow('設計建立的客戶');
      // 設計部本來就在預設三個部門裡，不需要再多加這個人的帳號。
      expect(JSON.parse(String(designerRow?.['部門組別']))).toEqual(['測試員', '設計部', '企劃部']);
      expect(JSON.parse(String(designerRow?.['專案負責人']))).toEqual(['department:測試員', 'department:設計部', 'department:企劃部']);

      await seedAccountPermission('hr@emctaipei.com', '自訂', ['request.create']);
      await seedStaff('hr@emctaipei.com', '管理部', '人資行政組', '管理同仁');
      const hrToken = await seedSession('hr@emctaipei.com', '管理同仁');
      await api({ action: 'addCustomer', name: '管理部建立的客戶' }, hrToken);
      const hrRow = await customerRow('管理部建立的客戶');
      // 管理部不在預設名單裡，也不是專案部（沒有「整組」可加）。如果就這樣送出，建立者會在建立的當下
      // 就失去自己剛建立的客戶別的編輯與發信權限，所以把他本人加進去。
      expect(JSON.parse(String(hrRow?.['部門組別']))).toEqual(['測試員', '設計部', '企劃部', 'hr@emctaipei.com']);
      expect(JSON.parse(String(hrRow?.['專案負責人']))).toEqual([
        'department:測試員', 'department:設計部', 'department:企劃部', 'hr@emctaipei.com'
      ]);
    });

    it('applies the same defaults to the admin "+ 新增客戶別" insert, but never overwrites lists the admin filled in', async () => {
      // 刻意不用管理者帳號：管理者對每一筆案件本來就一律放行，用一般的 database.manage 帳號才看得出
      // 「建立者所屬專案組」這條規則有沒有真的被套用。
      await seedAccountPermission('admin.pm@emctaipei.com', '自訂', ['database.manage']);
      await seedStaff('admin.pm@emctaipei.com', '專案部', 'Odin組', '後台專案同仁');
      const token = await seedSession('admin.pm@emctaipei.com', '後台專案同仁');
      mockGitHubCommit();

      await api({
        action: 'adminTableInsert', table: '客戶別',
        row: { '客戶別': '後台新客戶', '排序': '', '專案負責人': '[]', '設計負責人': '[]', '部門組別': '[]', '更新時間': '', '更新者': '管理者' }
      }, token);
      const row = await customerRow('後台新客戶');
      expect(JSON.parse(String(row?.['部門組別']))).toEqual(['測試員', '設計部', '企劃部', 'Odin組']);
      expect(JSON.parse(String(row?.['專案負責人']))).toEqual([
        'department:測試員', 'department:設計部', 'department:企劃部', 'group:Odin組'
      ]);

      // 新增時就明確指定名單的話，一律以指定的為準，不可被預設值蓋掉。
      await api({
        action: 'adminTableInsert', table: '客戶別',
        row: { '客戶別': '指定名單的客戶', '排序': '', '專案負責人': JSON.stringify(['department:監測部']), '設計負責人': '[]', '部門組別': JSON.stringify(['監測部']), '更新時間': '', '更新者': '管理者' }
      }, token);
      const explicit = await customerRow('指定名單的客戶');
      expect(JSON.parse(String(explicit?.['部門組別']))).toEqual(['監測部']);
      expect(JSON.parse(String(explicit?.['專案負責人']))).toEqual(['department:監測部']);
    });

    it('actually grants the creating project group edit/mail rights on that customer\'s cases, and keeps an unrelated group out', async () => {
      await seedAccountPermission('pm@emctaipei.com', '自訂', ['request.create', 'request.edit', 'request.mail']);
      await seedStaff('pm@emctaipei.com', '專案部', 'Celine組', '專案同仁');
      await seedAccountPermission('other@emctaipei.com', '自訂', ['request.edit', 'request.mail']);
      await seedStaff('other@emctaipei.com', '專案部', 'Joyce組', '別組同仁');
      const token = await seedSession('pm@emctaipei.com', '專案同仁');
      mockGitHubCommit();
      await api({ action: 'addCustomer', name: '權限驗證客戶' }, token);

      const stub = env.DATABASE_COORDINATOR.getByName('primary') as DurableObjectStub<DatabaseCoordinator>;
      const { database, sameGroup, otherGroup } = await runInDurableObject(stub, async (_instance, state) => {
        const stored = state.storage.sql.exec<{ json: string }>('SELECT json FROM database_state WHERE id = ?', 'primary').one();
        return {
          database: JSON.parse(stored.json) as DatabaseSnapshot,
          sameGroup: { user: '專案同仁', account: 'pm@emctaipei.com', provider: 'password', expiresAt: Date.now() + 1000 } as SessionRecord,
          otherGroup: { user: '別組同仁', account: 'other@emctaipei.com', provider: 'password', expiresAt: Date.now() + 1000 } as SessionRecord
        };
      });
      const caseRow = { '案件編號': '26090100', '客戶別': '權限驗證客戶' };
      expect(hasRowCapability(database, sameGroup, 'request.mail', caseRow)).toBe(true);
      expect(hasRowCapability(database, sameGroup, 'request.edit', caseRow)).toBe(true);
      // 白名單一旦有值就取代一般角色權限（見 hasRowCapability），別組即使角色有 request.edit 也進不來。
      expect(hasRowCapability(database, otherGroup, 'request.edit', caseRow)).toBe(false);
    });

    describe('saveCustomerSettings（個人設定 › 客戶設定）', () => {
      async function seedPlanners(): Promise<string> {
        await seedStaff('livia.chu@emctaipei.com', '企劃部', '', '朱祖翎');
        await seedStaff('allen.li@emctaipei.com', '企劃部', '', '李明庭');
        await seedStaff('anna.hsu@emctaipei.com', '設計部', '平面', 'Anna');
        await seedStaff('amber.tian@emctaipei.com', '設計部', '平面', 'Amber');
        await seedAccountPermission('livia.chu@emctaipei.com', '自訂', ['request.create']);
        await seedCustomerOwner('丹士特', 'department:設計部');
        await seedCustomerOwner('丹士特', 'group:Celine組');
        await seedCustomerOwner('丹士特', 'livia.chu@emctaipei.com');
        return seedSession('livia.chu@emctaipei.com', '朱祖翎');
      }

      it('lets a customer owner grant another planner, set default CC and favourite designers, while keeping department:/group: rules and the caller', async () => {
        const token = await seedPlanners();
        mockGitHubCommit();
        const saved = await api({
          action: 'saveCustomerSettings', customer: '丹士特',
          // 故意沒勾自己：後端仍要把自己留在名單，不然設定完就再也打不開這個畫面。
          owners: ['allen.li@emctaipei.com', 'nobody@emctaipei.com'],
          mails: ['Amber <amber.tian@emctaipei.com>', 'eric.fu@emctaipei.com'],
          designers: ['Amber', 'Anna']
        }, token);
        expect(saved).toMatchObject({ ok: true, action: 'saveCustomerSettings' });
        const row = await customerRow('丹士特');
        expect(JSON.parse(String(row?.['專案負責人']))).toEqual([
          'department:設計部', 'group:Celine組', 'allen.li@emctaipei.com', 'livia.chu@emctaipei.com'
        ]);
        // 被授權的人也要看得到這個客戶別的案件；不存在的帳號不會被寫進去。
        expect(JSON.parse(String(row?.['部門組別']))).toEqual(['allen.li@emctaipei.com', 'livia.chu@emctaipei.com']);
        expect(JSON.parse(String(row?.['預設信箱']))).toEqual(['Amber <amber.tian@emctaipei.com>', 'eric.fu@emctaipei.com']);
        expect(JSON.parse(String(row?.['設計負責人']))).toEqual(['Amber', 'Anna']);
        expect(row?.['更新者']).toBe('朱祖翎');

        const allenToken = await seedSession('allen.li@emctaipei.com', '李明庭');
        const byAllen = await api({ action: 'saveCustomerSettings', customer: '丹士特', designers: ['Anna'] }, allenToken);
        expect(byAllen).toMatchObject({ ok: true });
        // 只帶 designers 時，其他名單原封不動。
        const after = await customerRow('丹士特');
        expect(JSON.parse(String(after?.['設計負責人']))).toEqual(['Anna']);
        expect(JSON.parse(String(after?.['預設信箱']))).toEqual(['Amber <amber.tian@emctaipei.com>', 'eric.fu@emctaipei.com']);
      });

      it('lets the owner toggle department/group rules (前台「全選」) while keeping hidden test rules and existing visibility', async () => {
        const token = await seedPlanners();
        await seedCustomerOwner('丹士特', 'department:測試員');
        await seedStaff('pm@emctaipei.com', '專案部', 'Ann組', '專案同仁');
        mockGitHubCommit();
        const before = await customerRow('丹士特');
        const unitsBefore = JSON.parse(String(before?.['部門組別'] || '[]')) as string[];
        const saved = await api({
          action: 'saveCustomerSettings', customer: '丹士特',
          // 取消 group:Celine組、加上 department:企劃部 與 group:Ann組；前台沒送出隱藏的 department:測試員。
          rules: ['department:設計部', 'department:企劃部', 'group:Ann組']
        }, token);
        expect(saved).toMatchObject({ ok: true });
        const row = await customerRow('丹士特');
        expect(JSON.parse(String(row?.['專案負責人']))).toEqual([
          'department:測試員', 'department:設計部', 'department:企劃部', 'group:Ann組', 'livia.chu@emctaipei.com'
        ]);
        // 新加入的規則補進可見範圍；取消的規則不動可見範圍。
        const units = JSON.parse(String(row?.['部門組別'])) as string[];
        expect(units).toEqual(expect.arrayContaining([...unitsBefore.filter(unit => !unit.includes('@')), '企劃部', 'Ann組', 'livia.chu@emctaipei.com']));

        expect(await api({ action: 'saveCustomerSettings', customer: '丹士特', rules: ['group:不存在組'] }, token))
          .toMatchObject({ ok: false, error: '權限規則「group:不存在組」不是有效的部門或組別' });
        expect(await api({ action: 'saveCustomerSettings', customer: '丹士特', rules: ['everyone'] }, token))
          .toMatchObject({ ok: false });
      });

      it('rejects accounts without customer rights, unknown designers and malformed emails', async () => {
        const token = await seedPlanners();
        mockGitHubCommit();
        await seedStaff('outsider@emctaipei.com', '管理部', '人資行政組', '外人');
        const outsider = await seedSession('outsider@emctaipei.com', '外人');
        expect(await api({ action: 'saveCustomerSettings', customer: '丹士特', designers: ['Anna'] }, outsider))
          .toMatchObject({ ok: false, error: '你沒有客戶別「丹士特」的權限，無法調整設定' });
        expect(await api({ action: 'saveCustomerSettings', customer: '丹士特', designers: ['Karl2'] }, token))
          .toMatchObject({ ok: false });
        expect(await api({ action: 'saveCustomerSettings', customer: '丹士特', mails: ['不是信箱'] }, token))
          .toMatchObject({ ok: false });
        expect(await api({ action: 'saveCustomerSettings', customer: '丹士特', designers: ['Anna'] }))
          .toMatchObject({ ok: false });
      });
    });
  });

  it('refuses to create a 客戶別 as anonymous when the request carries a login token the Worker no longer recognises, but still allows a genuinely anonymous request', async () => {
    // 專案部 Ann 組的 Jerry：畫面上是登入狀態，手上的登入憑證卻已經失效。以前後端默默當成匿名建立，
    // 客戶別只拿到三個預設部門，他自己那一組沒有權限，填完單才發現不能寄信。
    const expired = await api({ action: 'addCustomer', name: '失效憑證建立的客戶' }, 'token-that-is-no-longer-valid');
    expect(expired).toMatchObject({ ok: false, reason: 'TOKEN_EXPIRED' });
    expect(String(expired.error)).toContain('登入狀態已失效');
    const stub = env.DATABASE_COORDINATOR.getByName('primary') as DurableObjectStub<DatabaseCoordinator>;
    const created = await runInDurableObject(stub, async (_instance, state) => {
      const stored = state.storage.sql.exec<{ json: string }>('SELECT json FROM database_state WHERE id = ?', 'primary').one();
      return (JSON.parse(stored.json) as DatabaseSnapshot).tables['客戶別'].rows.some(row => row['客戶別'] === '失效憑證建立的客戶');
    });
    expect(created).toBe(false);

    // 完全沒帶憑證的匿名填單維持原本「填單不強制登入」的慣例，照樣可以新增。
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
      if (String(input) === 'https://api.github.com/repos/EMCtaipeiART/EMCtaipeiART.github.io/contents/backend/data/db.json') {
        expect(init?.method).toBe('PUT');
        return Response.json({ content: { sha: `anonymous-customer-${crypto.randomUUID()}` }, commit: { sha: 'anonymous-customer-commit' } });
      }
      throw new Error(`unexpected fetch: ${String(input)}`);
    });
    const anonymous = await api({ action: 'addCustomer', name: '匿名填單建立的客戶' });
    expect(anonymous).toMatchObject({ ok: true, action: 'addCustomer' });
    expect((anonymous.customer as Record<string, unknown>)['更新者']).toBe('匿名填單');
  });

  describe('scheduled mail (指定排程時間)', () => {
    async function schedulerStub(): Promise<DurableObjectStub<DatabaseCoordinator>> {
      return env.DATABASE_COORDINATOR.getByName('primary') as DurableObjectStub<DatabaseCoordinator>;
    }
    /** 直接把某筆排程的 scheduled_at 往前改，模擬「已經到了排定寄送的時間」——測試不用真的等待。 */
    async function forceScheduledAtDue(id: string, offsetMs = -1000): Promise<void> {
      const stub = await schedulerStub();
      await runInDurableObject(stub, async (_instance, state) => {
        state.storage.sql.exec('UPDATE scheduled_mail SET scheduled_at = ? WHERE id = ?', Date.now() + offsetMs, id);
      });
    }
    async function scheduledMailRow(id: string): Promise<{ status: string; error_message: string | null } | undefined> {
      const stub = await schedulerStub();
      return runInDurableObject(stub, async (_instance, state) =>
        state.storage.sql.exec<{ status: string; error_message: string | null }>('SELECT status, error_message FROM scheduled_mail WHERE id = ?', id).toArray()[0]
      );
    }
    async function scheduledMailDraftId(id: string): Promise<string> {
      const stub = await schedulerStub();
      const row = await runInDurableObject(stub, async (_instance, state) =>
        state.storage.sql.exec<{ draft_id: string | null }>('SELECT draft_id FROM scheduled_mail WHERE id = ?', id).toArray()[0]
      );
      return row?.draft_id || '';
    }

    /** 「指定排程時間」寄信現在會順手在使用者的 Gmail 信箱建立一份草稿（讓使用者能在寄出前直接改內容），
     * 取消排程則會把那份草稿刪掉。多數測試的重點不在草稿本身，統一在這裡把 drafts 的 create/update/delete
     * 擋下來回假資料；drafts.send（POST .../drafts/send）刻意不放進預設值，需要驗證「寄的是草稿內容」的
     * 測試必須自己明確 mock，避免不小心把「有沒有走草稿路徑」測糊掉。 */
    beforeEach(() => {
      vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
        const url = String(input);
        const method = String(init?.method || 'GET').toUpperCase();
        if (url === 'https://gmail.googleapis.com/gmail/v1/users/me/drafts' && method === 'POST') {
          return Response.json({ id: `draft-${crypto.randomUUID()}` });
        }
        if (url.startsWith('https://gmail.googleapis.com/gmail/v1/users/me/drafts/') && (method === 'PUT' || method === 'DELETE')) {
          return Response.json({ id: url.split('/').pop() });
        }
        throw new Error(`unexpected fetch (scheduled mail default stub): ${method} ${url}`);
      });
    });

    it('rejects an invalid scheduledAt (too soon / missing) and rejects when the case already has a thread', async () => {
      await seedAccountPermission('test.user@emctaipei.com', '自訂', ['request.mail']);
      await seedGmailTokens('test.user@emctaipei.com', 'gmail-access-1');
      const token = await seedSession('test.user@emctaipei.com', '測試使用者');

      const missing = await api({ action: 'scheduleCaseMail', caseId: '26080001', to: 'client@example.com', subject: 'x', bodyText: 'x' }, token);
      expect(missing).toMatchObject({ ok: false, error: '請指定合法的排程寄送時間（1 分鐘後到 1 年內）' });

      const tooSoon = await api({
        action: 'scheduleCaseMail', caseId: '26080001', to: 'client@example.com', subject: 'x', bodyText: 'x',
        scheduledAt: new Date(Date.now() + 5000).toISOString()
      }, token);
      expect(tooSoon).toMatchObject({ ok: false, error: '請指定合法的排程寄送時間（1 分鐘後到 1 年內）' });

      const firstSchedule = await api({
        action: 'scheduleCaseMail', caseId: '26080001', to: 'client@example.com', subject: 'x', bodyText: 'x',
        scheduledAt: new Date(Date.now() + 5 * 60 * 1000).toISOString()
      }, token);
      expect(firstSchedule.ok).toBe(true);
      const duplicateSchedule = await api({
        action: 'scheduleCaseMail', caseId: '26080001', to: 'client@example.com', subject: 'x', bodyText: 'x',
        scheduledAt: new Date(Date.now() + 6 * 60 * 1000).toISOString()
      }, token);
      expect(duplicateSchedule).toMatchObject({ ok: false, reason: 'SCHEDULE_EXISTS', scheduledId: firstSchedule.scheduledId });

      const stub = await schedulerStub();
      await runInDurableObject(stub, async (_instance, state) => {
        const stored = state.storage.sql.exec<{ json: string }>('SELECT json FROM database_state WHERE id = ?', 'primary').one();
        const database = JSON.parse(stored.json) as DatabaseSnapshot;
        database.tables.database.rows.find(row => row['案件編號'] === '26080001')!['Gmail信件串ID'] = 'already-sent-thread';
        state.storage.sql.exec('UPDATE database_state SET json = ? WHERE id = ?', JSON.stringify(database), 'primary');
      });
      const threadExists = await api({
        action: 'scheduleCaseMail', caseId: '26080001', to: 'client@example.com', subject: 'x', bodyText: 'x',
        scheduledAt: new Date(Date.now() + 5 * 60 * 1000).toISOString()
      }, token);
      expect(threadExists).toMatchObject({ ok: false, reason: 'THREAD_EXISTS' });
    });

    it('schedules a first-send mail, and runScheduledDispatch actually sends it once it is due, writing the thread id back to the case row', async () => {
      await seedAccountPermission('test.user@emctaipei.com', '自訂', ['request.mail']);
      await seedGmailTokens('test.user@emctaipei.com', 'gmail-access-1');
      const token = await seedSession('test.user@emctaipei.com', '測試使用者');

      const scheduled = await api({
        action: 'scheduleCaseMail', caseId: '26080001', to: 'client@example.com', subject: '排程寄信測試', bodyText: '排程內容',
        scheduledAt: new Date(Date.now() + 5 * 60 * 1000).toISOString()
      }, token);
      expect(scheduled.ok).toBe(true);
      const scheduledId = String(scheduled.scheduledId);
      expect(scheduledId).toBeTruthy();

      // 還沒到排定時間——這次呼叫不應該寄出任何東西。
      const notYet = await (await schedulerStub()).runScheduledDispatch();
      expect(notYet).toEqual({ processed: 0, sent: 0, failed: 0 });

      // 排程建立當下已經在使用者信箱裡放了一份草稿（預設 stub），到期時寄的就是那份草稿。
      expect(await scheduledMailDraftId(scheduledId)).toBeTruthy();
      await forceScheduledAtDue(scheduledId);
      let sendCalls = 0;
      vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
        const url = String(input);
        if (url === 'https://gmail.googleapis.com/gmail/v1/users/me/drafts/send') {
          sendCalls += 1;
          const body = JSON.parse(String(init?.body));
          // drafts.send 只帶草稿編號，內容以 Gmail 端「當下」的草稿為準——這正是使用者可以在等待期間
          // 直接進 Gmail 修改內容的原因；內文/簽名檔的組信正確性已有 sendCaseMail 既有測試涵蓋。
          expect(String(body.id)).toBeTruthy();
          expect(body.raw).toBeUndefined();
          return Response.json({ id: 'scheduled-msg-1', threadId: 'scheduled-thread-1' });
        }
        if (url === 'https://gmail.googleapis.com/gmail/v1/users/me/messages/send') {
          throw new Error('有草稿時不該退回用排程當下存下來的內容直接寄出');
        }
        // 送出成功後，dispatchScheduledMailItem 會跟立即寄信（sendCaseMail）一樣呼叫 mutate() 把
        // Gmail信件串ID／Gmail寄件帳號寫回 database 表，這一步會真的呼叫 GitHub Contents API 提交。
        if (url === 'https://api.github.com/repos/EMCtaipeiART/EMCtaipeiART.github.io/contents/backend/data/db.json') {
          expect(init?.method).toBe('PUT');
          return Response.json({ content: { sha: `scheduled-file-${crypto.randomUUID()}` }, commit: { sha: 'scheduled-commit-sha' } });
        }
        throw new Error(`unexpected fetch during scheduled send dispatch: ${url}`);
      });
      const result = await (await schedulerStub()).runScheduledDispatch();
      expect(result).toEqual({ processed: 1, sent: 1, failed: 0 });
      expect(sendCalls).toBe(1);

      const row = await scheduledMailRow(scheduledId);
      expect(row?.status).toBe('sent');

      // 案件本身要跟立即寄信一樣，正確寫回 Gmail信件串ID／Gmail寄件帳號。
      const list = await api({ action: 'list' }, token);
      const caseRow = (list.rows as Array<Record<string, unknown>>).find(item => item.id === '26080001');
      expect(caseRow?.gmailThreadId).toBe('scheduled-thread-1');
      expect(caseRow?.gmailThreadOwnerAccount).toBe('test.user@emctaipei.com');

      // 前端用這個輕量查詢追蹤排程首信；必須直接從 Durable Object 帶回信件串狀態，
      // 不用等 GitHub Pages 將靜態 db.json 重新部署後才把按鈕從「發信」切成「回信」。
      const scheduledList = await api({ action: 'listScheduledMail', caseId: '26080001' }, token);
      expect(scheduledList).toMatchObject({
        ok: true,
        gmailThreadId: 'scheduled-thread-1',
        gmailThreadOwnerAccount: 'test.user@emctaipei.com'
      });
    });

    it('dispatches only one legacy duplicate first-send schedule and cancels the other item claimed in the same cron batch', async () => {
      await seedAccountPermission('test.user@emctaipei.com', '自訂', ['request.mail']);
      await seedGmailTokens('test.user@emctaipei.com', 'gmail-access-1');
      const token = await seedSession('test.user@emctaipei.com', '測試使用者');
      const scheduled = await api({
        action: 'scheduleCaseMail', caseId: '26080001', to: 'client@example.com', subject: '舊重複排程', bodyText: '只能寄一封',
        scheduledAt: new Date(Date.now() + 5 * 60 * 1000).toISOString()
      }, token);
      const firstId = String(scheduled.scheduledId);
      const duplicateId = `legacy-duplicate-${crypto.randomUUID()}`;
      const stub = await schedulerStub();
      await runInDurableObject(stub, async (_instance, state) => {
        state.storage.sql.exec(
          `INSERT INTO scheduled_mail(
             id, case_id, kind, owner_account, requested_by, to_address, cc_address, subject,
             body_html, signature_html, inline_images, scheduled_at, status, error_message, created_at, updated_at
           )
           SELECT ?, case_id, kind, owner_account, requested_by, to_address, cc_address, subject,
             body_html, signature_html, inline_images, ?, 'pending', NULL, created_at, updated_at
           FROM scheduled_mail WHERE id = ?`,
          duplicateId, Date.now() - 1000, firstId
        );
        state.storage.sql.exec('UPDATE scheduled_mail SET scheduled_at = ? WHERE id = ?', Date.now() - 2000, firstId);
      });

      let sendCalls = 0;
      vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
        const url = String(input);
        // 先到期的那筆是這次新建的（有草稿），走 drafts.send；舊版複製出來的那筆沒有 draft_id，
        // 兩條路徑都算一次寄出，確認整批只會真的寄出一封。
        if (url === 'https://gmail.googleapis.com/gmail/v1/users/me/drafts/send'
          || url === 'https://gmail.googleapis.com/gmail/v1/users/me/messages/send') {
          sendCalls += 1;
          return Response.json({ id: 'single-message', threadId: 'single-thread' });
        }
        if (url.startsWith('https://gmail.googleapis.com/gmail/v1/users/me/drafts/') && String(init?.method).toUpperCase() === 'DELETE') {
          return Response.json({});
        }
        if (url === 'https://api.github.com/repos/EMCtaipeiART/EMCtaipeiART.github.io/contents/backend/data/db.json') {
          expect(init?.method).toBe('PUT');
          return Response.json({ content: { sha: 'single-file-sha' }, commit: { sha: 'single-commit-sha' } });
        }
        throw new Error(`unexpected fetch during legacy duplicate dispatch: ${url}`);
      });
      const result = await stub.runScheduledDispatch();
      expect(result).toEqual({ processed: 2, sent: 1, failed: 0 });
      expect(sendCalls).toBe(1);
      expect((await scheduledMailRow(firstId))?.status).toBe('sent');
      expect((await scheduledMailRow(duplicateId))?.status).toBe('canceled');
    });

    it('schedules a reply, and re-fetches the thread at dispatch time so a message that arrived after scheduling is still the one replied to', async () => {
      await seedAccountPermission('test.user@emctaipei.com', '自訂', ['request.mail']);
      await seedGmailTokens('test.user@emctaipei.com', 'gmail-access-1');
      const stub = await schedulerStub();
      await runInDurableObject(stub, async (_instance, state) => {
        const stored = state.storage.sql.exec<{ json: string }>('SELECT json FROM database_state WHERE id = ?', 'primary').one();
        const database = JSON.parse(stored.json) as DatabaseSnapshot;
        const row = database.tables.database.rows.find(item => item['案件編號'] === '26080001')!;
        row['Gmail信件串ID'] = 'reply-thread-1';
        row['Gmail寄件帳號'] = 'test.user@emctaipei.com';
        state.storage.sql.exec('UPDATE database_state SET json = ? WHERE id = ?', JSON.stringify(database), 'primary');
      });
      const token = await seedSession('test.user@emctaipei.com', '測試使用者');

      const messagesAtScheduleTime = [{
        id: 'thread-msg-1', snippet: '', payload: {
          mimeType: 'text/plain', body: { data: toBase64Url('第一封') },
          headers: [
            { name: 'From', value: 'client@example.com' }, { name: 'To', value: 'test.user@emctaipei.com' },
            { name: 'Message-Id', value: '<msg1@mail.gmail.com>' }, { name: 'Subject', value: '測試主旨' }
          ]
        }
      }];
      vi.spyOn(globalThis, 'fetch').mockImplementation(async input => {
        const url = String(input);
        if (url === 'https://gmail.googleapis.com/gmail/v1/users/me/threads/reply-thread-1?format=full') {
          return Response.json({ id: 'reply-thread-1', messages: messagesAtScheduleTime });
        }
        throw new Error(`unexpected fetch while scheduling reply: ${url}`);
      });
      const scheduled = await api({
        action: 'scheduleCaseReply', caseId: '26080001', bodyText: '排程回覆內容',
        scheduledAt: new Date(Date.now() + 5 * 60 * 1000).toISOString()
      }, token);
      expect(scheduled.ok).toBe(true);
      const scheduledId = String(scheduled.scheduledId);
      await forceScheduledAtDue(scheduledId);

      // 排程等待期間，這條討論串多了一封新信（client 又追加寄了一封）——真正寄出時應該接在這封「當時最新」的
      // 信件後面，不是沿用排程建立當下（第一封信）算出的舊 In-Reply-To/References。
      const messagesAtDispatchTime = [
        ...messagesAtScheduleTime,
        {
          id: 'thread-msg-2', snippet: '', payload: {
            mimeType: 'text/plain', body: { data: toBase64Url('第二封，排程等待期間才寄到') },
            headers: [
              { name: 'From', value: 'client@example.com' }, { name: 'To', value: 'test.user@emctaipei.com' },
              { name: 'Message-Id', value: '<msg2@mail.gmail.com>' }, { name: 'References', value: '<msg1@mail.gmail.com>' },
              { name: 'Subject', value: 'Re: 測試主旨' }
            ]
          }
        }
      ];
      vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
        const url = String(input);
        if (url === 'https://gmail.googleapis.com/gmail/v1/users/me/threads/reply-thread-1?format=full') {
          return Response.json({ id: 'reply-thread-1', messages: messagesAtDispatchTime });
        }
        if (url === 'https://gmail.googleapis.com/gmail/v1/users/me/messages/send') {
          const body = JSON.parse(String(init?.body));
          expect(body.threadId).toBe('reply-thread-1');
          // 這裡的重點是「真正寄出時有沒有正確接在排程等待期間才出現的最新一封信後面」，內文本身是巢狀
          // base64 編碼、不會直接出現在外層解碼結果，組信正確性已經有既有測試涵蓋，這裡不重複驗證。
          const decoded = decodeBase64UrlText(String(body.raw));
          expect(decoded).toContain('In-Reply-To: <msg2@mail.gmail.com>');
          expect(decoded).toContain('References: <msg1@mail.gmail.com> <msg2@mail.gmail.com>');
          return Response.json({ id: 'scheduled-reply-msg-1', threadId: 'reply-thread-1' });
        }
        throw new Error(`unexpected fetch during scheduled reply dispatch: ${url}`);
      });
      const result = await (await schedulerStub()).runScheduledDispatch();
      expect(result).toEqual({ processed: 1, sent: 1, failed: 0 });
      const row = await scheduledMailRow(scheduledId);
      expect(row?.status).toBe('sent');
    });

    it('sends a scheduled reply from the account that scheduled it, not from the account that created the original thread', async () => {
      await seedAccountPermission('test.user@emctaipei.com', '自訂', ['request.mail']);
      await seedAccountPermission('designer@emctaipei.com', '自訂', ['request.mail']);
      await seedGmailTokens('test.user@emctaipei.com', 'gmail-access-owner', 'test.user@emctaipei.com');
      await seedGmailTokens('designer@emctaipei.com', 'gmail-access-designer', 'designer@emctaipei.com');
      const stub = await schedulerStub();
      await runInDurableObject(stub, async (_instance, state) => {
        const stored = state.storage.sql.exec<{ json: string }>('SELECT json FROM database_state WHERE id = ?', 'primary').one();
        const database = JSON.parse(stored.json) as DatabaseSnapshot;
        const row = database.tables.database.rows.find(item => item['案件編號'] === '26080001')!;
        row['Gmail信件串ID'] = 'cross-account-reply-thread';
        row['Gmail寄件帳號'] = 'test.user@emctaipei.com';
        state.storage.sql.exec('UPDATE database_state SET json = ? WHERE id = ?', JSON.stringify(database), 'primary');
      });
      const designerToken = await seedSession('designer@emctaipei.com', '設計師');
      const threadMessages = [{
        id: 'original-message', snippet: '', payload: {
          mimeType: 'text/plain', body: { data: toBase64Url('原始案件信') },
          headers: [
            { name: 'From', value: 'test.user@emctaipei.com' }, { name: 'To', value: 'designer@emctaipei.com' },
            { name: 'Message-Id', value: '<original@mail.gmail.com>' }, { name: 'Subject', value: '案件主旨' }
          ]
        }
      }];

      vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
        const url = String(input);
        if (url === 'https://gmail.googleapis.com/gmail/v1/users/me/threads/cross-account-reply-thread?format=full') {
          expect(new Headers(init?.headers).get('Authorization')).toBe('Bearer gmail-access-owner');
          return Response.json({ id: 'cross-account-reply-thread', messages: threadMessages });
        }
        throw new Error(`unexpected fetch while scheduling cross-account reply: ${url}`);
      });
      const scheduled = await api({
        action: 'scheduleCaseReply', caseId: '26080001', bodyText: '設計師排程回覆',
        scheduledAt: new Date(Date.now() + 5 * 60 * 1000).toISOString()
      }, designerToken);
      expect(scheduled.ok).toBe(true);
      const scheduledId = String(scheduled.scheduledId);
      await forceScheduledAtDue(scheduledId);

      // 2026-08-21：跨帳號（threadOwner≠寄件帳號）寄送前，現在會先用寄件帳號自己的 token 查一次
      // rfc822msgid，找到的話要改用「寄件帳號自己視角」下的 threadId（不是 owner 那個），確保寄件人自己
      // 在 Gmail 裡也看得到正確歸進同一條討論串的回覆，而不是一封孤立、跟原討論串脫節的「Re:」信。
      vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
        const url = String(input);
        if (url === 'https://gmail.googleapis.com/gmail/v1/users/me/threads/cross-account-reply-thread?format=full') {
          expect(new Headers(init?.headers).get('Authorization')).toBe('Bearer gmail-access-owner');
          return Response.json({ id: 'cross-account-reply-thread', messages: threadMessages });
        }
        if (url.startsWith('https://gmail.googleapis.com/gmail/v1/users/me/messages?')) {
          expect(new Headers(init?.headers).get('Authorization')).toBe('Bearer gmail-access-designer');
          expect(url).toContain(encodeURIComponent('rfc822msgid:original@mail.gmail.com'));
          return Response.json({ messages: [{ id: 'designer-copy-of-original', threadId: 'designer-own-mailbox-thread' }] });
        }
        if (url === 'https://gmail.googleapis.com/gmail/v1/users/me/messages/send') {
          expect(new Headers(init?.headers).get('Authorization')).toBe('Bearer gmail-access-designer');
          const body = JSON.parse(String(init?.body));
          expect(body.threadId).toBe('designer-own-mailbox-thread');
          const decoded = decodeBase64UrlText(String(body.raw));
          expect(decoded).toContain('To: test.user@emctaipei.com');
          expect(decoded).toContain('In-Reply-To: <original@mail.gmail.com>');
          return Response.json({ id: 'designer-scheduled-reply', threadId: 'designer-own-mailbox-thread' });
        }
        throw new Error(`unexpected fetch during cross-account reply dispatch: ${url}`);
      });
      const result = await (await schedulerStub()).runScheduledDispatch();
      expect(result).toEqual({ processed: 1, sent: 1, failed: 0 });
      expect((await scheduledMailRow(scheduledId))?.status).toBe('sent');
    });

    it('falls back to sending without a threadId if the looked-up own-mailbox thread turns out to be stale/mismatched and Gmail rejects the send', async () => {
      await seedAccountPermission('test.user@emctaipei.com', '自訂', ['request.mail']);
      await seedAccountPermission('designer@emctaipei.com', '自訂', ['request.mail']);
      await seedGmailTokens('test.user@emctaipei.com', 'gmail-access-owner-2', 'test.user@emctaipei.com');
      await seedGmailTokens('designer@emctaipei.com', 'gmail-access-designer-2', 'designer@emctaipei.com');
      const stub = await schedulerStub();
      await runInDurableObject(stub, async (_instance, state) => {
        const stored = state.storage.sql.exec<{ json: string }>('SELECT json FROM database_state WHERE id = ?', 'primary').one();
        const database = JSON.parse(stored.json) as DatabaseSnapshot;
        const row = database.tables.database.rows.find(item => item['案件編號'] === '26080001')!;
        row['Gmail信件串ID'] = 'fallback-reply-thread';
        row['Gmail寄件帳號'] = 'test.user@emctaipei.com';
        state.storage.sql.exec('UPDATE database_state SET json = ? WHERE id = ?', JSON.stringify(database), 'primary');
      });
      const designerToken = await seedSession('designer@emctaipei.com', '設計師');
      const threadMessages = [{
        id: 'original-message-2', snippet: '', payload: {
          mimeType: 'text/plain', body: { data: toBase64Url('原始案件信') },
          headers: [
            { name: 'From', value: 'test.user@emctaipei.com' }, { name: 'To', value: 'designer@emctaipei.com' },
            { name: 'Message-Id', value: '<original2@mail.gmail.com>' }, { name: 'Subject', value: '案件主旨' }
          ]
        }
      }];
      vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
        const url = String(input);
        if (url === 'https://gmail.googleapis.com/gmail/v1/users/me/threads/fallback-reply-thread?format=full') {
          return Response.json({ id: 'fallback-reply-thread', messages: threadMessages });
        }
        throw new Error(`unexpected fetch while scheduling fallback reply: ${url}`);
      });
      const scheduled = await api({
        action: 'scheduleCaseReply', caseId: '26080001', bodyText: '設計師排程回覆（測試 threadId 不準的退回路徑）',
        scheduledAt: new Date(Date.now() + 5 * 60 * 1000).toISOString()
      }, designerToken);
      expect(scheduled.ok).toBe(true);
      const scheduledId = String(scheduled.scheduledId);
      await forceScheduledAtDue(scheduledId);

      let sendAttempts = 0;
      vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
        const url = String(input);
        if (url === 'https://gmail.googleapis.com/gmail/v1/users/me/threads/fallback-reply-thread?format=full') {
          return Response.json({ id: 'fallback-reply-thread', messages: threadMessages });
        }
        if (url.startsWith('https://gmail.googleapis.com/gmail/v1/users/me/messages?')) {
          // 查到一個 threadId，但這個 threadId 其實已經不準了（例如剛好過期/被搬移）——驗證重點是
          // 「即使查到東西，只要真正送出時被 Gmail 拒絕，也要能自動退回不帶 threadId 重試，而不是讓
          // 整封回信寄送失敗」。
          return Response.json({ messages: [{ id: 'stale-copy', threadId: 'stale-mismatched-thread' }] });
        }
        if (url === 'https://gmail.googleapis.com/gmail/v1/users/me/messages/send') {
          sendAttempts += 1;
          const body = JSON.parse(String(init?.body));
          // 兩種主旨版本（推算出來的 "Re: 案件主旨"、信件串原封不動的 "案件主旨"）都用這個查到的
          // （其實已經不準的）threadId 送出，一律拒絕；第三次徹底放棄 threadId 才成功。
          if (body.threadId) {
            expect(body.threadId).toBe('stale-mismatched-thread');
            return new Response(JSON.stringify({ error: { message: 'Precondition check failed.' } }), { status: 400 });
          }
          return Response.json({ id: 'designer-scheduled-reply-fallback', threadId: 'brand-new-thread' });
        }
        throw new Error(`unexpected fetch during fallback reply dispatch: ${url}`);
      });
      const result = await (await schedulerStub()).runScheduledDispatch();
      expect(result).toEqual({ processed: 1, sent: 1, failed: 0 });
      expect(sendAttempts).toBe(3);
      const row = await scheduledMailRow(scheduledId);
      expect(row?.status).toBe('sent');
      // 完全放棄 threadId 之後的信在寄件人視角是一封孤立的新信，不再假裝一切正常：把原因記進這筆排程，
      // 供之後查詢／除錯（目前排程清單只顯示待寄送與失敗項目，這則提醒暫時不會出現在畫面上）。
      expect(row?.error_message).toContain('可能沒有正確歸進原本的 Gmail 信件串');
    });

    it('lists pending scheduled mail for a case and lets a pending item be canceled (but not twice, and not once already dispatched)', async () => {
      await seedAccountPermission('test.user@emctaipei.com', '自訂', ['request.mail']);
      await seedGmailTokens('test.user@emctaipei.com', 'gmail-access-1');
      const token = await seedSession('test.user@emctaipei.com', '測試使用者');

      const scheduled = await api({
        action: 'scheduleCaseMail', caseId: '26080001', to: 'client@example.com', subject: 'x', bodyText: 'x',
        scheduledAt: new Date(Date.now() + 5 * 60 * 1000).toISOString()
      }, token);
      const scheduledId = String(scheduled.scheduledId);

      const listed = await api({ action: 'listScheduledMail', caseId: '26080001' }, token);
      expect(listed.ok).toBe(true);
      expect(listed.items).toMatchObject([{ id: scheduledId, kind: 'send', to: 'client@example.com', status: 'pending' }]);

      const canceled = await api({ action: 'cancelScheduledMail', id: scheduledId }, token);
      expect(canceled).toMatchObject({ ok: true, id: scheduledId });
      const listedAfterCancel = await api({ action: 'listScheduledMail', caseId: '26080001' }, token);
      // 已取消的排程不會出現在「待寄送」清單裡（前端只顯示 pending/failed，這裡直接驗證後端回傳的原始狀態）。
      expect((listedAfterCancel.items as Array<{ status: string }>)[0].status).toBe('canceled');

      const cancelAgain = await api({ action: 'cancelScheduledMail', id: scheduledId }, token);
      expect(cancelAgain).toMatchObject({ ok: false, error: '這筆排程已經處理過，無法取消' });

      // 已取消的排程即使到了排定時間，也不應該被 runScheduledDispatch 寄出。
      await forceScheduledAtDue(scheduledId);
      vi.spyOn(globalThis, 'fetch').mockImplementation(async input => {
        throw new Error(`不該有任何 Gmail 呼叫，已取消的排程不該被寄出: ${String(input)}`);
      });
      const dispatch = await (await schedulerStub()).runScheduledDispatch();
      expect(dispatch).toEqual({ processed: 0, sent: 0, failed: 0 });
    });

    it('reads and updates the original pending schedule without creating a second item, then blocks edits after dispatch claims it', async () => {
      await seedAccountPermission('test.user@emctaipei.com', '自訂', ['request.mail']);
      await seedGmailTokens('test.user@emctaipei.com', 'gmail-access-1');
      const token = await seedSession('test.user@emctaipei.com', '測試使用者');
      const firstTime = new Date(Date.now() + 6 * 60 * 1000).toISOString();
      const scheduled = await api({
        action: 'scheduleCaseMail', caseId: '26080001', to: 'old@example.com', cc: 'copy@example.com',
        subject: '修改前主旨', bodyHtml: '修改前內容<img src="cid:edit-image@test">',
        signatureHtml: '<table><tbody><tr><td>修改前簽名</td></tr></tbody></table>',
        inlineImages: [{ contentId: 'edit-image@test', mimeType: 'image/png', base64: 'aGVsbG8=' }],
        scheduledAt: firstTime
      }, token);
      const scheduledId = String(scheduled.scheduledId);

      const draft = await api({ action: 'getScheduledMail', id: scheduledId }, token);
      expect(draft).toMatchObject({
        ok: true,
        item: {
          id: scheduledId, caseId: '26080001', kind: 'send', ownerAccount: 'test.user@emctaipei.com',
          to: 'old@example.com', cc: 'copy@example.com', subject: '修改前主旨',
          bodyHtml: '修改前內容<img src="cid:edit-image@test">',
          signatureHtml: '<table><tbody><tr><td>修改前簽名</td></tr></tbody></table>',
          inlineImages: [{ contentId: 'edit-image@test', mimeType: 'image/png', base64: 'aGVsbG8=' }]
        }
      });

      const nextTime = new Date(Date.now() + 12 * 60 * 1000).toISOString();
      const updated = await api({
        action: 'updateScheduledMail', id: scheduledId, to: 'new@example.com', cc: '', subject: '修改後主旨',
        bodyHtml: '修改後內容', inlineImages: [], signatureHtml: '<table><tbody><tr><td>修改後簽名</td></tr></tbody></table>', scheduledAt: nextTime
      }, token);
      expect(updated).toMatchObject({ ok: true, id: scheduledId });
      const listed = await api({ action: 'listScheduledMail', caseId: '26080001' }, token);
      expect((listed.items as Array<Record<string, unknown>>).filter(item => item.status === 'pending')).toMatchObject([
        { id: scheduledId, to: 'new@example.com', cc: '', subject: '修改後主旨' }
      ]);
      const editedDraft = await api({ action: 'getScheduledMail', id: scheduledId }, token);
      expect(editedDraft).toMatchObject({
        item: {
          id: scheduledId,
          bodyHtml: '修改後內容',
          signatureHtml: '<table><tbody><tr><td>修改後簽名</td></tr></tbody></table>',
          inlineImages: []
        }
      });

      const stub = await schedulerStub();
      await runInDurableObject(stub, async (_instance, state) => {
        state.storage.sql.exec('UPDATE scheduled_mail SET status = ? WHERE id = ?', 'sending', scheduledId);
      });
      const tooLate = await api({
        action: 'updateScheduledMail', id: scheduledId, to: 'late@example.com', subject: '來不及修改',
        bodyHtml: '不應寫入', scheduledAt: new Date(Date.now() + 20 * 60 * 1000).toISOString()
      }, token);
      expect(tooLate).toMatchObject({ ok: false, reason: 'SCHEDULE_NOT_PENDING' });
      expect(await api({ action: 'getScheduledMail', id: scheduledId }, token)).toMatchObject({ ok: false, reason: 'SCHEDULE_NOT_PENDING' });
    });

    it('cancels a due first-send schedule instead of showing a false failure when the case was already sent through another path', async () => {
      await seedAccountPermission('test.user@emctaipei.com', '自訂', ['request.mail']);
      await seedGmailTokens('test.user@emctaipei.com', 'gmail-access-1');
      const token = await seedSession('test.user@emctaipei.com', '測試使用者');

      const scheduled = await api({
        action: 'scheduleCaseMail', caseId: '26080001', to: 'client@example.com', subject: 'x', bodyText: 'x',
        scheduledAt: new Date(Date.now() + 5 * 60 * 1000).toISOString()
      }, token);
      const scheduledId = String(scheduled.scheduledId);
      await forceScheduledAtDue(scheduledId);

      // 模擬「排程等待期間，這個案件已經被用其他方式（例如使用者直接按了『寄出』）建立過信件串」。
      const stub = await schedulerStub();
      await runInDurableObject(stub, async (_instance, state) => {
        const stored = state.storage.sql.exec<{ json: string }>('SELECT json FROM database_state WHERE id = ?', 'primary').one();
        const database = JSON.parse(stored.json) as DatabaseSnapshot;
        database.tables.database.rows.find(row => row['案件編號'] === '26080001')!['Gmail信件串ID'] = 'already-sent-by-someone-else';
        state.storage.sql.exec('UPDATE database_state SET json = ? WHERE id = ?', JSON.stringify(database), 'primary');
      });

      let draftDeletes = 0;
      vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
        const url = String(input);
        // 這封信不會再寄出，Gmail 草稿匣裡那份殘留草稿要一併刪掉，不留下使用者以為「還會自動寄」的草稿。
        if (url.startsWith('https://gmail.googleapis.com/gmail/v1/users/me/drafts/') && String(init?.method).toUpperCase() === 'DELETE') {
          draftDeletes += 1;
          return Response.json({});
        }
        throw new Error(`不該呼叫 Gmail 送信——案件已經有信件串了: ${url}`);
      });
      const result = await (await schedulerStub()).runScheduledDispatch();
      expect(result).toEqual({ processed: 1, sent: 0, failed: 0 });
      expect(draftDeletes).toBe(1);
      expect(await scheduledMailRow(scheduledId)).toMatchObject({ status: 'canceled' });
      expect((await scheduledMailRow(scheduledId))?.error_message).toContain('已經有 Gmail 信件串');

      // 舊版已經留下的同類 failed 紀錄，下次讀取清單時也要自動轉成 canceled，才不會繼續顯示紅色誤報。
      await runInDurableObject(stub, async (_instance, state) => {
        state.storage.sql.exec(
          'UPDATE scheduled_mail SET status = ?, error_message = ? WHERE id = ?',
          'failed', '此案件已經有 Gmail 信件串（可能已用其他方式寄出），排程未重複寄送', scheduledId
        );
      });
      const listed = await api({ action: 'listScheduledMail', caseId: '26080001' }, token);
      expect((listed.items as Array<{ id: string; status: string }>).find(item => item.id === scheduledId)?.status).toBe('canceled');
      expect(await scheduledMailRow(scheduledId)).toMatchObject({ status: 'canceled', error_message: null });
    });

    it('never dispatches an item that is already "sending" (the claim step this relies on is the same guarantee that prevents the class of duplicate-send bug fixed for the NAS uploader)', async () => {
      await seedAccountPermission('test.user@emctaipei.com', '自訂', ['request.mail']);
      await seedGmailTokens('test.user@emctaipei.com', 'gmail-access-1');
      const token = await seedSession('test.user@emctaipei.com', '測試使用者');

      const scheduled = await api({
        action: 'scheduleCaseMail', caseId: '26080001', to: 'client@example.com', subject: 'x', bodyText: 'x',
        scheduledAt: new Date(Date.now() + 5 * 60 * 1000).toISOString()
      }, token);
      const scheduledId = String(scheduled.scheduledId);
      await forceScheduledAtDue(scheduledId);

      // runScheduledDispatch() 只挑 status='pending' 的到期項目（見該方法裡 claim 的 SQL：先 SELECT
      // WHERE status='pending'，再同步 UPDATE 成 'sending'，中間完全沒有 await）——這裡直接把這筆排程
      // 標成「已經在 sending 中」，模擬「另一輪 Cron 呼叫剛好已經搶到並開始處理這筆」的狀態，驗證這一輪
      // 呼叫會正確跳過它、不會重複呼叫 Gmail 送出第二次。比起真的併發呼叫兩次 runScheduledDispatch()
      // （在這個測試環境會讓 Workers 執行環境本身崩潰，不是穩定可重現的驗證方式），這樣直接驗證 claim
      // 機制實際依賴的 SQL 條件（WHERE status='pending'）本身是正確的，是更直接、更穩定的驗證方式；
      // 「sending 狀態卡住超過 10 分鐘會被收回 pending 重新排隊」則由下一個測試涵蓋，兩者合起來完整涵蓋
      // claim 機制「不重複寄送」與「不會永遠卡住」這兩個保證。
      const stub = await schedulerStub();
      await runInDurableObject(stub, async (_instance, state) => {
        state.storage.sql.exec('UPDATE scheduled_mail SET status = ?, updated_at = ? WHERE id = ?', 'sending', new Date().toISOString(), scheduledId);
      });

      vi.spyOn(globalThis, 'fetch').mockImplementation(async input => {
        throw new Error(`不該呼叫 Gmail 送信——這筆排程已經被標成 sending，不該被重複挑到: ${String(input)}`);
      });
      const result = await stub.runScheduledDispatch();
      expect(result).toEqual({ processed: 0, sent: 0, failed: 0 });
      const row = await scheduledMailRow(scheduledId);
      expect(row?.status).toBe('sending');
    });

    it('still schedules the mail when the Gmail account has not granted the draft scope, reports why, and falls back to sending the stored content at dispatch time', async () => {
      await seedAccountPermission('test.user@emctaipei.com', '自訂', ['request.mail']);
      await seedGmailTokens('test.user@emctaipei.com', 'gmail-access-1');
      const token = await seedSession('test.user@emctaipei.com', '測試使用者');

      // 既有帳號在重新授權之前，refresh token 沒有 gmail.compose，drafts.create 會回 403。
      vi.spyOn(globalThis, 'fetch').mockImplementation(async input => {
        const url = String(input);
        if (url === 'https://gmail.googleapis.com/gmail/v1/users/me/drafts') {
          return Response.json({ error: { message: 'Request had insufficient authentication scopes.' } }, { status: 403 });
        }
        throw new Error(`unexpected fetch while scheduling without draft scope: ${url}`);
      });
      const scheduled = await api({
        action: 'scheduleCaseMail', caseId: '26080001', to: 'client@example.com', subject: '沒有草稿權限', bodyText: '照樣要寄得出去',
        scheduledAt: new Date(Date.now() + 5 * 60 * 1000).toISOString()
      }, token);
      // 草稿建不起來不能讓排程本身失敗——信仍然會照排定時間寄出，只是不能在 Gmail 端改。
      expect(scheduled.ok).toBe(true);
      expect(String(scheduled.draftError)).toContain('重新連接 Gmail');
      const scheduledId = String(scheduled.scheduledId);
      expect(await scheduledMailDraftId(scheduledId)).toBe('');

      await forceScheduledAtDue(scheduledId);
      let sendCalls = 0;
      vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
        const url = String(input);
        if (url === 'https://gmail.googleapis.com/gmail/v1/users/me/messages/send') {
          sendCalls += 1;
          expect(decodeBase64UrlText(String(JSON.parse(String(init?.body)).raw))).toContain('To: client@example.com');
          return Response.json({ id: 'fallback-msg-1', threadId: 'fallback-thread-1' });
        }
        if (url === 'https://api.github.com/repos/EMCtaipeiART/EMCtaipeiART.github.io/contents/backend/data/db.json') {
          return Response.json({ content: { sha: `fallback-file-${crypto.randomUUID()}` }, commit: { sha: 'fallback-commit-sha' } });
        }
        throw new Error(`unexpected fetch during fallback dispatch: ${url}`);
      });
      expect(await (await schedulerStub()).runScheduledDispatch()).toEqual({ processed: 1, sent: 1, failed: 0 });
      expect(sendCalls).toBe(1);
    });

    it('treats a draft the user deleted in Gmail as a cancellation of that schedule, and says so on the schedule row', async () => {
      await seedAccountPermission('test.user@emctaipei.com', '自訂', ['request.mail']);
      await seedGmailTokens('test.user@emctaipei.com', 'gmail-access-1');
      const token = await seedSession('test.user@emctaipei.com', '測試使用者');

      const scheduled = await api({
        action: 'scheduleCaseMail', caseId: '26080001', to: 'client@example.com', subject: '草稿被刪掉', bodyText: '不要寄了',
        scheduledAt: new Date(Date.now() + 5 * 60 * 1000).toISOString()
      }, token);
      const scheduledId = String(scheduled.scheduledId);
      expect(await scheduledMailDraftId(scheduledId)).toBeTruthy();
      await forceScheduledAtDue(scheduledId);

      vi.spyOn(globalThis, 'fetch').mockImplementation(async input => {
        const url = String(input);
        // 使用者在等待期間自己把草稿刪掉了：drafts.send 回 404。依使用者指定的規則，刪掉草稿就是
        // 「這封不要寄了」，不可以退回用排程當下存下來的內容硬寄出去。
        if (url === 'https://gmail.googleapis.com/gmail/v1/users/me/drafts/send') {
          return Response.json({ error: { message: 'Requested entity was not found.' } }, { status: 404 });
        }
        throw new Error(`草稿被刪掉就不該再寄出任何東西: ${url}`);
      });
      expect(await (await schedulerStub()).runScheduledDispatch()).toEqual({ processed: 1, sent: 0, failed: 0 });
      // 信沒寄出去卻在畫面上什麼都看不到等於默默消失，所以原因要記在這筆排程上讓前端顯示得出來。
      expect(await scheduledMailRow(scheduledId)).toMatchObject({ status: 'canceled' });
      expect((await scheduledMailRow(scheduledId))?.error_message).toContain('草稿已在 Gmail 中被刪除');
      const listed = await api({ action: 'listScheduledMail', caseId: '26080001' }, token);
      expect((listed.items as Array<{ id: string; status: string; errorMessage: string }>)
        .find(item => item.id === scheduledId)).toMatchObject({ status: 'canceled' });
    });

    it('still sends the stored content when drafts.send fails for a reason other than the draft being gone', async () => {
      await seedAccountPermission('test.user@emctaipei.com', '自訂', ['request.mail']);
      await seedGmailTokens('test.user@emctaipei.com', 'gmail-access-1');
      const token = await seedSession('test.user@emctaipei.com', '測試使用者');

      const scheduled = await api({
        action: 'scheduleCaseMail', caseId: '26080001', to: 'client@example.com', subject: 'Gmail 暫時出錯', bodyText: '照樣要寄得出去',
        scheduledAt: new Date(Date.now() + 5 * 60 * 1000).toISOString()
      }, token);
      const scheduledId = String(scheduled.scheduledId);
      await forceScheduledAtDue(scheduledId);

      let sendCalls = 0;
      vi.spyOn(globalThis, 'fetch').mockImplementation(async input => {
        const url = String(input);
        // 暫時性錯誤不是使用者的意思表示，不能當成取消——這封信還是要寄出去。
        if (url === 'https://gmail.googleapis.com/gmail/v1/users/me/drafts/send') {
          return Response.json({ error: { message: 'Backend Error' } }, { status: 500 });
        }
        if (url === 'https://gmail.googleapis.com/gmail/v1/users/me/messages/send') {
          sendCalls += 1;
          return Response.json({ id: 'fallback-msg', threadId: 'fallback-thread' });
        }
        if (url === 'https://api.github.com/repos/EMCtaipeiART/EMCtaipeiART.github.io/contents/backend/data/db.json') {
          return Response.json({ content: { sha: `fallback-file-${crypto.randomUUID()}` }, commit: { sha: 'fallback-commit' } });
        }
        throw new Error(`unexpected fetch during transient-failure dispatch: ${url}`);
      });
      expect(await (await schedulerStub()).runScheduledDispatch()).toEqual({ processed: 1, sent: 1, failed: 0 });
      expect(sendCalls).toBe(1);
      expect((await scheduledMailRow(scheduledId))?.status).toBe('sent');
    });

    it('keeps the Gmail draft in step with an edited schedule and deletes it when the schedule is canceled', async () => {
      await seedAccountPermission('test.user@emctaipei.com', '自訂', ['request.mail']);
      await seedGmailTokens('test.user@emctaipei.com', 'gmail-access-1');
      const token = await seedSession('test.user@emctaipei.com', '測試使用者');

      const draftUpdates: string[] = [];
      const draftDeletes: string[] = [];
      vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
        const url = String(input);
        const method = String(init?.method || 'GET').toUpperCase();
        if (url === 'https://gmail.googleapis.com/gmail/v1/users/me/drafts' && method === 'POST') return Response.json({ id: 'draft-abc' });
        if (url === 'https://gmail.googleapis.com/gmail/v1/users/me/drafts/draft-abc' && method === 'PUT') {
          draftUpdates.push(decodeBase64UrlText(String(JSON.parse(String(init?.body)).message.raw)));
          return Response.json({ id: 'draft-abc' });
        }
        if (url === 'https://gmail.googleapis.com/gmail/v1/users/me/drafts/draft-abc' && method === 'DELETE') {
          draftDeletes.push('draft-abc');
          return Response.json({});
        }
        throw new Error(`unexpected fetch: ${method} ${url}`);
      });

      const scheduled = await api({
        action: 'scheduleCaseMail', caseId: '26080001', to: 'old@example.com', subject: '修改前主旨', bodyText: '修改前內容',
        scheduledAt: new Date(Date.now() + 6 * 60 * 1000).toISOString()
      }, token);
      const scheduledId = String(scheduled.scheduledId);
      expect(scheduled).toMatchObject({ ok: true, draftId: 'draft-abc', draftError: '' });

      const updated = await api({
        action: 'updateScheduledMail', id: scheduledId, to: 'new@example.com', cc: '', subject: '修改後主旨',
        bodyHtml: '修改後內容', inlineImages: [], signatureHtml: '', scheduledAt: new Date(Date.now() + 12 * 60 * 1000).toISOString()
      }, token);
      expect(updated).toMatchObject({ ok: true, draftError: '' });
      // 改過的收件人／主旨要同步進 Gmail 草稿，否則使用者在 Gmail 看到的跟時間到寄出的會是兩個版本。
      expect(draftUpdates).toHaveLength(1);
      expect(draftUpdates[0]).toContain('To: new@example.com');

      expect(await api({ action: 'cancelScheduledMail', id: scheduledId }, token)).toMatchObject({ ok: true });
      expect(draftDeletes).toEqual(['draft-abc']);
    });

    it('schedules one merged mail covering several cases, refuses a second schedule that overlaps any of them, and binds one thread to every case at dispatch', async () => {
      await seedAccountPermission('test.user@emctaipei.com', '自訂', ['request.mail']);
      await seedGmailTokens('test.user@emctaipei.com', 'gmail-access-1');
      const token = await seedSession('test.user@emctaipei.com', '測試使用者');
      const stub = await schedulerStub();
      // 批次新增拆成三筆案件的情境（使用者把其中兩筆合併成同一封信寄出）。
      await runInDurableObject(stub, async (_instance, state) => {
        const stored = state.storage.sql.exec<{ json: string }>('SELECT json FROM database_state WHERE id = ?', 'primary').one();
        const database = JSON.parse(stored.json) as DatabaseSnapshot;
        database.tables.database.rows.push({ '案件編號': '26080002', '月份': '8月', '客戶別': '測試客戶', '專案名稱': '合併案件二', '狀態': '未開始' });
        state.storage.sql.exec('UPDATE database_state SET json = ? WHERE id = ?', JSON.stringify(database), 'primary');
      });

      const scheduled = await api({
        action: 'scheduleCaseMail', caseId: '26080001', caseIds: ['26080001', '26080002'],
        to: 'client@example.com', subject: '【26080001、26080002】合併信件', bodyText: '合併內容',
        scheduledAt: new Date(Date.now() + 5 * 60 * 1000).toISOString()
      }, token);
      expect(scheduled).toMatchObject({ ok: true, caseIds: ['26080001', '26080002'] });
      const scheduledId = String(scheduled.scheduledId);

      // 合併信件只有一列排程，但兩筆案件各自的排程清單裡都要看得到它——前端「全部寄出」就是靠這個
      // 查詢判斷「這封已排程、不要再立即寄一次」。
      for (const caseId of ['26080001', '26080002']) {
        const listed = await api({ action: 'listScheduledMail', caseId }, token);
        expect((listed.items as Array<{ id: string; status: string }>).map(item => item.id)).toContain(scheduledId);
      }

      // 其中任何一筆案件都不能再排第二封首次寄信。
      const overlap = await api({
        action: 'scheduleCaseMail', caseId: '26080002', to: 'client@example.com', subject: '重複', bodyText: 'x',
        scheduledAt: new Date(Date.now() + 8 * 60 * 1000).toISOString()
      }, token);
      expect(overlap).toMatchObject({ ok: false, reason: 'SCHEDULE_EXISTS', scheduledId });

      await forceScheduledAtDue(scheduledId);
      vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
        const url = String(input);
        if (url === 'https://gmail.googleapis.com/gmail/v1/users/me/drafts/send') return Response.json({ id: 'merged-msg', threadId: 'merged-thread' });
        if (url === 'https://api.github.com/repos/EMCtaipeiART/EMCtaipeiART.github.io/contents/backend/data/db.json') {
          expect(init?.method).toBe('PUT');
          return Response.json({ content: { sha: `merged-file-${crypto.randomUUID()}` }, commit: { sha: 'merged-commit-sha' } });
        }
        throw new Error(`unexpected fetch during merged dispatch: ${url}`);
      });
      expect(await stub.runScheduledDispatch()).toEqual({ processed: 1, sent: 1, failed: 0 });

      // 同一條信件串要綁到合併的每一筆案件上，之後兩筆案件才都能正常「回信」。
      const list = await api({ action: 'list' }, token);
      const rows = list.rows as Array<Record<string, unknown>>;
      for (const caseId of ['26080001', '26080002']) {
        expect(rows.find(item => item.id === caseId)?.gmailThreadId).toBe('merged-thread');
      }
    });

    it('tells the front end up front whether the connected Gmail grant can create drafts, so the missing scope is visible before anything is scheduled', async () => {
      await seedAccountPermission('test.user@emctaipei.com', '自訂', ['request.mail']);
      // 舊帳號：只有 gmail.send，沒有 gmail.compose——正是「排程了卻沒有草稿」的原因。
      await seedGmailTokens('test.user@emctaipei.com', 'gmail-access-1', 'test.user@gmail.example', 'https://www.googleapis.com/auth/gmail.send');
      const token = await seedSession('test.user@emctaipei.com', '測試使用者');
      expect(await api({ action: 'gmailStatus' }, token)).toMatchObject({ ok: true, connected: true, canCreateDraft: false });

      // 重新授權拿到 gmail.compose 之後，同一個帳號就會回報成可以建立草稿。
      const stub = await schedulerStub();
      await runInDurableObject(stub, async (_instance, state) => {
        state.storage.sql.exec(
          'UPDATE gmail_tokens SET scopes = ? WHERE account = ?',
          'https://www.googleapis.com/auth/gmail.send https://www.googleapis.com/auth/gmail.compose', 'test.user@emctaipei.com'
        );
      });
      expect(await api({ action: 'gmailStatus' }, token)).toMatchObject({ connected: true, canCreateDraft: true });

      // 這個欄位是後來才加的，既有資料是 NULL；那些帳號本來就是在加上 gmail.compose 之前授權的，
      // 必須算成「不能建立草稿」，否則前端不會提示他們重新連接。
      await runInDurableObject(stub, async (_instance, state) => {
        state.storage.sql.exec('UPDATE gmail_tokens SET scopes = NULL WHERE account = ?', 'test.user@emctaipei.com');
      });
      expect(await api({ action: 'gmailStatus' }, token)).toMatchObject({ connected: true, canCreateDraft: false });
    });

    it('reclaims a schedule stuck in "sending" for more than 10 minutes and retries it on the next dispatch pass', async () => {
      await seedAccountPermission('test.user@emctaipei.com', '自訂', ['request.mail']);
      await seedGmailTokens('test.user@emctaipei.com', 'gmail-access-1');
      const token = await seedSession('test.user@emctaipei.com', '測試使用者');

      const scheduled = await api({
        action: 'scheduleCaseMail', caseId: '26080001', to: 'client@example.com', subject: 'x', bodyText: 'x',
        scheduledAt: new Date(Date.now() + 5 * 60 * 1000).toISOString()
      }, token);
      const scheduledId = String(scheduled.scheduledId);
      await forceScheduledAtDue(scheduledId);

      // 模擬「上一輪執行到一半，Worker 被平台中止」留下的卡住狀態：status='sending'、但 updated_at 已經是
      // 11 分鐘前，超過 10 分鐘的異常判定門檻。
      const stub = await schedulerStub();
      await runInDurableObject(stub, async (_instance, state) => {
        const staleUpdatedAt = new Date(Date.now() - 11 * 60 * 1000).toISOString();
        state.storage.sql.exec('UPDATE scheduled_mail SET status = ?, updated_at = ? WHERE id = ?', 'sending', staleUpdatedAt, scheduledId);
      });

      vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
        const url = String(input);
        if (url === 'https://gmail.googleapis.com/gmail/v1/users/me/drafts/send') return Response.json({ id: 'recovered-msg-1', threadId: 'recovered-thread-1' });
        if (url === 'https://api.github.com/repos/EMCtaipeiART/EMCtaipeiART.github.io/contents/backend/data/db.json') {
          expect(init?.method).toBe('PUT');
          return Response.json({ content: { sha: `recovered-file-${crypto.randomUUID()}` }, commit: { sha: 'recovered-commit-sha' } });
        }
        throw new Error(`unexpected fetch: ${url}`);
      });
      const result = await (await schedulerStub()).runScheduledDispatch();
      expect(result).toEqual({ processed: 1, sent: 1, failed: 0 });
      const row = await scheduledMailRow(scheduledId);
      expect(row?.status).toBe('sent');
    });
  });
});

describe('凱曜 department prefix', () => {
  it('treats 凱曜專案部 as 專案部 for names, customer rules and stored settings', () => {
    expect(normalizeDepartmentName('凱曜專案部')).toBe('專案部');
    expect(normalizeDepartmentName(' 凱曜管理部 ')).toBe('管理部');
    expect(normalizeDepartmentName('凱曜')).toBe('凱曜');
    expect(normalizeDepartmentName('設計部')).toBe('設計部');

    const database = testDatabase();
    database.tables['設定'].rows.push({ '部門': '凱曜專案部', '組別': 'Odin組', '名字': '楊詠涵', '顯示名': '楊詠涵', '帳號': 'sally.yang@emctaipei.com' });
    const session = { user: '楊詠涵', account: 'sally.yang@emctaipei.com' } as SessionRecord;
    expect(matchesCustomerEditRule(database, session, 'department:專案部')).toBe(true);
    expect(matchesCustomerEditRule(database, session, 'group:Odin組')).toBe(true);
    expect(matchesCustomerEditRule(database, session, 'department:管理部')).toBe(false);

    expect(normalizeSettingsDepartments(database)).toBe(true);
    expect(database.tables['設定'].rows).toContainEqual(expect.objectContaining({ '帳號': 'sally.yang@emctaipei.com', '部門': '專案部' }));
    expect(normalizeSettingsDepartments(database)).toBe(false);
  });
});

describe('Pixel Office shared state', () => {
  it('keeps one set of level titles per team, shared by everyone and carried on the polling response', async () => {
    const initial = await api({ action: 'pixelOfficeLevelTitles' });
    expect(initial).toMatchObject({
      ok: true,
      steps: [1, 10, 20, 30, 40, 50],
      videoMembers: ['Noise'],
      titles: {
        graphic: ['設計新秀', '資深設計師', '設計菁英', '設計大師', '傳奇設計師', '設計神話'],
        video: ['影音新秀', '資深剪輯師', '影音菁英', '影音大師', '傳奇導演', '影像神話']
      }
    });

    // 稱號跟著狀態一起回，前端不必為了它多打一次 API。
    const state = await api({ action: 'pixelOfficeState' });
    expect((state.levels as Record<string, unknown>).titles).toEqual(initial.titles);

    // 只送一組不會把另一組洗回預設值；空字串補回預設值；過長的截斷。
    const saved = await api({
      action: 'pixelOfficeLevelTitlesUpdate',
      titles: { graphic: ['小美工', '', '  切版王  ', '排版之神', '傳奇設計師', '一二三四五六七八九十十一十二十三'] }
    });
    expect((saved.titles as Record<string, string[]>).graphic)
      .toEqual(['小美工', '資深設計師', '切版王', '排版之神', '傳奇設計師', '一二三四五六七八九十十一']);
    expect((saved.titles as Record<string, string[]>).video[0]).toBe('影音新秀');

    // 改了稱號也要讓別人的畫面更新：版本號要跟著跳，不能等到有人換狀態才生效。
    const after = await api({ action: 'pixelOfficeState', since: state.version });
    expect(after.unchanged).toBeUndefined();
    expect((after.levels as Record<string, unknown>).titles).toEqual(saved.titles);

    await expect(api({ action: 'pixelOfficeLevelTitlesUpdate', titles: ['壞掉的格式'] })).resolves.toMatchObject({ ok: false });
  });

  it('shares mood, message, status, position and photos between visitors without a login, and never commits to GitHub', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch');
    const empty = await api({ action: 'pixelOfficeState' });
    expect(empty).toMatchObject({ ok: true, people: [] });

    const updated = await api({ action: 'pixelOfficeUpdate', name: 'Machi', patch: { mood: 'happy', message: '大家午安', status: 'present', x: 900.4, y: 700, dir: 'left' } });
    expect(updated).toMatchObject({ ok: true, person: { name: 'Machi', mood: 'happy', message: '大家午安', x: 900, y: 700, dir: 'left', photoVersion: 0 } });

    const state = await api({ action: 'pixelOfficeState' });
    expect(state.people).toEqual([expect.objectContaining({ name: 'Machi', mood: 'happy', message: '大家午安' })]);
    // 沒有變動時只回 unchanged，輪詢幾乎不花流量。
    const unchanged = await api({ action: 'pixelOfficeState', since: state.version });
    expect(unchanged).toMatchObject({ ok: true, unchanged: true });
    expect(unchanged.people).toBeUndefined();

    // 只改一個欄位，其他欄位保留。
    await api({ action: 'pixelOfficeUpdate', name: 'Machi', patch: { message: '' } });
    const partial = await api({ action: 'pixelOfficeState', since: state.version });
    expect(partial.people).toEqual([expect.objectContaining({ name: 'Machi', mood: 'happy', message: '' })]);
    expect(Number(partial.version)).toBeGreaterThan(Number(state.version));

    // 照片另外取：狀態只帶版本號。
    const photo = 'data:image/jpeg;base64,/9j/4AAQSkZJRgABAQ==';
    const withPhoto = await api({ action: 'pixelOfficeUpdate', name: 'Anna', patch: { photo } });
    expect(Number((withPhoto.person as Record<string, unknown>).photoVersion)).toBeGreaterThan(0);
    const listed = await api({ action: 'pixelOfficeState' });
    const anna = (listed.people as Record<string, unknown>[]).find(person => person.name === 'Anna');
    expect(anna).toMatchObject({ photoVersion: expect.any(Number) });
    expect(JSON.stringify(listed)).not.toContain('base64');
    expect(await api({ action: 'pixelOfficePhoto', name: 'Anna' })).toMatchObject({ ok: true, photo });
    await api({ action: 'pixelOfficeUpdate', name: 'Anna', patch: { photo: '' } });
    expect(await api({ action: 'pixelOfficePhoto', name: 'Anna' })).toMatchObject({ photo: '', photoVersion: 0 });

    // 驗證：不存在的人、太長的對話、不合法的心情與照片都擋下。
    expect(await api({ action: 'pixelOfficeUpdate', name: 'Karl', patch: { mood: 'happy' } })).toMatchObject({ ok: false });
    expect(await api({ action: 'pixelOfficeUpdate', name: 'Noise', patch: { message: 'x'.repeat(61) } })).toMatchObject({ ok: false });
    expect(await api({ action: 'pixelOfficeUpdate', name: 'Noise', patch: { mood: 'evil' } })).toMatchObject({ ok: false });
    expect(await api({ action: 'pixelOfficeUpdate', name: 'Noise', patch: { photo: 'javascript:alert(1)' } })).toMatchObject({ ok: false });
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('turns a designer computer heartbeat into 在座／加班／下班 automatically, without ever committing to GitHub', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch');
    const key = 'test-nas-watcher-key';
    // 2026-09-21 是星期一。Date 用台北時間換算：UTC 03:00 = 台北 11:00；UTC 11:30 = 台北 19:30。
    const at = (iso: string) => vi.setSystemTime(new Date(iso));
    const heartbeat = (name: string, serviceKey: string | undefined = key) => api({ action: 'pixelOfficeHeartbeat', name, serviceKey });
    const statusOf = async (name: string) => ((await api({ action: 'pixelOfficeState' })).people as Record<string, unknown>[]).find(person => person.name === name)?.status;
    vi.useFakeTimers({ toFake: ['Date'] });
    try {
      // 金鑰不對、沒帶、名字不存在都擋下。
      at('2026-09-21T03:00:00Z');
      expect(await heartbeat('Noise', 'wrong-key')).toMatchObject({ ok: false });
      expect(await heartbeat('Noise', '')).toMatchObject({ ok: false });
      expect(await heartbeat('Karl')).toMatchObject({ ok: false });
      expect(await statusOf('Noise')).toBeUndefined();

      // 白天開機：在座。
      expect(await heartbeat('Noise')).toMatchObject({ ok: true, status: 'present', changed: true });
      expect(await statusOf('Noise')).toBe('present');

      // 狀態沒變的心跳不能驚動其他人的畫面：版本號不變，since 輪詢仍是 unchanged。
      const before = await api({ action: 'pixelOfficeState' });
      at('2026-09-21T03:01:00Z');
      expect(await heartbeat('Noise')).toMatchObject({ ok: true, status: 'present', changed: false });
      expect(await api({ action: 'pixelOfficeState', since: before.version })).toMatchObject({ ok: true, unchanged: true });

      // 電腦一直開著、過了晚上七點：自動切成加班（台北 19:30）。
      at('2026-09-21T11:30:00Z');
      for (let minute = 0; minute < 5; minute += 1) { at(`2026-09-21T11:${String(26 + minute).padStart(2, '0')}:00Z`); await heartbeat('Noise'); }
      at('2026-09-21T11:30:00Z');
      expect(await heartbeat('Noise')).toMatchObject({ status: 'overtime' });
      expect(await statusOf('Noise')).toBe('overtime');

      // 關機：最後一次心跳之後超過 5 分鐘沒消息，讀狀態時自動變下班（4 分鐘內不算）。
      at('2026-09-21T11:34:00Z');
      expect(await statusOf('Noise')).toBe('overtime');
      at('2026-09-21T11:36:00Z');
      expect(await statusOf('Noise')).toBe('offwork');

      // 隔天早上開機（台北 09:00）：自動回到在座。
      at('2026-09-22T01:00:00Z');
      expect(await heartbeat('Noise')).toMatchObject({ status: 'present', changed: true });

      // 使用者手動點「下班」：電腦還開著的期間，心跳不會把它蓋回在座。
      for (const minute of ['02', '04', '06', '08', '10']) { at(`2026-09-22T01:${minute}:00Z`); await heartbeat('Noise'); }
      await api({ action: 'pixelOfficeUpdate', name: 'Noise', patch: { status: 'offwork' } });
      at('2026-09-22T01:11:00Z');
      expect(await heartbeat('Noise')).toMatchObject({ status: 'offwork', changed: false });
      // 電腦關機再開機之後就重新由電腦決定。
      at('2026-09-22T02:00:00Z');
      expect(await heartbeat('Noise')).toMatchObject({ status: 'present', changed: true });

      // 出國／公出：電腦關機時不會被改成下班；下次開機才回到在座。
      await api({ action: 'pixelOfficeUpdate', name: 'Noise', patch: { status: 'abroad' } });
      at('2026-09-22T05:00:00Z');
      expect(await statusOf('Noise')).toBe('abroad');
      expect(await heartbeat('Noise')).toMatchObject({ status: 'present' });

      // 廁所：電腦關機超過門檻就是回家了，改成下班；使用者在電腦離線之後才手動指定的狀態則尊重。
      await api({ action: 'pixelOfficeUpdate', name: 'Noise', patch: { status: 'toilet' } });
      at('2026-09-22T05:10:00Z');
      expect(await statusOf('Noise')).toBe('offwork');
      await api({ action: 'pixelOfficeUpdate', name: 'Noise', patch: { status: 'present' } });
      at('2026-09-22T05:12:00Z');
      expect(await statusOf('Noise')).toBe('present');

      // 'auto' 不是狀態而是出口：把手動標記清掉、交還給電腦判斷。沒有它的話手動點過就只能等
      // 跨時段或關機重開（2026-09-22 誤把 Leona 設成手動的下班，就是靠這個救回來的）。
      at('2026-09-22T03:00:00Z');
      await heartbeat('Noise');
      await api({ action: 'pixelOfficeUpdate', name: 'Noise', patch: { status: 'offwork' } });
      expect(await statusOf('Noise')).toBe('offwork');
      const held = await api({ action: 'pixelOfficeState' });
      expect((held.people as Record<string, unknown>[]).find(p => p.name === 'Noise')).toMatchObject({ statusSource: 'manual' });
      await api({ action: 'pixelOfficeUpdate', name: 'Noise', patch: { status: 'auto' } });
      const freed = (await api({ action: 'pixelOfficeState' })).people as Record<string, unknown>[];
      // 台北 11:00 的上班時間，交還之後應該回到在座，而且不再帶手動標記。
      expect(freed.find(p => p.name === 'Noise')).toMatchObject({ status: 'present', statusSource: 'auto' });
      expect(freed.find(p => p.name === 'Noise')).not.toHaveProperty('statusBaseline');

      // 從來沒有心跳的人（沒安裝爬蟲）完全不會被自動改狀態。
      await api({ action: 'pixelOfficeUpdate', name: 'Leona', patch: { status: 'present' } });
      at('2026-09-23T05:00:00Z');
      expect(await statusOf('Leona')).toBe('present');

      // 加班可以由使用者手動指定，也能被驗證接受。
      expect(await api({ action: 'pixelOfficeUpdate', name: 'Leona', patch: { status: 'overtime' } })).toMatchObject({ ok: true });
      expect(await api({ action: 'pixelOfficeUpdate', name: 'Leona', patch: { status: 'sleeping' } })).toMatchObject({ ok: false });
      expect(fetchSpy).not.toHaveBeenCalled();
    } finally {
      vi.useRealTimers();
    }
  });

  it('turns Google Calendar meetings into 會議 and hands the status back when the meeting ends', async () => {
    const key = 'test-nas-watcher-key';
    const at = (iso: string) => vi.setSystemTime(new Date(iso));
    vi.useFakeTimers({ toFake: ['Date'] });
    try {
      // 2026-09-21（一）台北 14:00 = UTC 06:00，上班時間。
      const now = Date.parse('2026-09-21T06:00:00Z');
      at('2026-09-21T06:00:00Z');
      await seedCalendarToken();
      // 先讓五個人都有資料（心跳），狀態是在座。
      for (const name of ['Machi', 'Anna', 'Amber', 'Leona', 'Noise']) {
        await api({ action: 'pixelOfficeHeartbeat', name, serviceKey: key, idleSeconds: 3 });
      }

      // Machi 正在開一小時的會、Anna 整天請假（超過四小時的忙碌不算會議）、Amber 沒事、
      // Leona 的行事曆看不到（沒有權限）、Noise 的忙碌時段還沒開始。
      let fetchSpy = mockFreeBusy({
        'machi.chen@emctaipei.com': [[now - 20 * 60_000, now + 40 * 60_000]],
        'anna.hsu@emctaipei.com': [[now - 6 * 60 * 60_000, now + 6 * 60 * 60_000]],
        'amber.tian@emctaipei.com': [],
        'leona.chen@emctaipei.com': { errors: [{ domain: 'global', reason: 'notFound' }] },
        'noise.zhong@emctaipei.com': []
      });
      expect(await runCalendarSync(now)).toMatchObject({ ok: true, meeting: ['Machi'], unreadable: ['Leona'] });
      expect(await statusOfPerson('Machi')).toMatchObject({ status: 'meeting', statusSource: 'calendar' });
      expect(await statusOfPerson('Anna')).toMatchObject({ status: 'present' });
      expect(await statusOfPerson('Amber')).toMatchObject({ status: 'present' });
      expect(await statusOfPerson('Leona')).toMatchObject({ status: 'present' });
      fetchSpy.mockRestore();

      // 開會中敲一下鍵盤還不算回座位：要連續在電腦前 3 分鐘才收回，不然畫面會一直閃。
      at('2026-09-21T06:10:00Z');
      expect(await api({ action: 'pixelOfficeHeartbeat', name: 'Machi', serviceKey: key, idleSeconds: 3 }))
        .toMatchObject({ status: 'meeting', changed: false });

      // 開會中離開座位也不會被改成廁所，而且「連續在電腦前」的計時要被打斷重來。
      at('2026-09-21T06:11:00Z');
      expect(await api({ action: 'pixelOfficeHeartbeat', name: 'Machi', serviceKey: key, idleSeconds: 30 * 60 }))
        .toMatchObject({ status: 'meeting' });
      at('2026-09-21T06:14:00Z');
      expect(await api({ action: 'pixelOfficeHeartbeat', name: 'Machi', serviceKey: key, idleSeconds: 3 }))
        .toMatchObject({ status: 'meeting', changed: false });

      // 散會了但行事曆上的事件還沒結束：人連續在電腦前 3 分鐘，就把會議收回成在座
      // （2026-09-23 使用者要求「人還在電腦前就把狀態改回位置上」）。
      for (const minute of ['15', '16']) {
        at(`2026-09-21T06:${minute}:00Z`);
        await api({ action: 'pixelOfficeHeartbeat', name: 'Machi', serviceKey: key, idleSeconds: 3 });
      }
      at('2026-09-21T06:17:00Z');
      expect(await api({ action: 'pixelOfficeHeartbeat', name: 'Machi', serviceKey: key, idleSeconds: 3 }))
        .toMatchObject({ status: 'present', changed: true });
      expect(await statusOfPerson('Machi')).toMatchObject({ status: 'present', statusSource: 'auto' });

      // 而且行事曆下一分鐘不會再把他設回會議——兩邊來回設的話畫面就會一分鐘閃一次。
      const during = Date.parse('2026-09-21T06:18:00Z');
      at('2026-09-21T06:18:00Z');
      fetchSpy = mockFreeBusy({
        'machi.chen@emctaipei.com': [[during - 20 * 60_000, during + 20 * 60_000]],
        'anna.hsu@emctaipei.com': [], 'amber.tian@emctaipei.com': [],
        'leona.chen@emctaipei.com': [], 'noise.zhong@emctaipei.com': []
      });
      expect(await runCalendarSync(during)).toMatchObject({ detected: { Machi: 'meeting' }, meeting: [], atDesk: ['Machi'] });
      expect(await statusOfPerson('Machi')).toMatchObject({ status: 'present', statusSource: 'auto' });
      fetchSpy.mockRestore();

      // 換一個情境測「散會後交還」：人離開座位去會議室開會，事件結束才由行事曆收回。
      at('2026-09-21T06:20:00Z');
      await api({ action: 'pixelOfficeHeartbeat', name: 'Machi', serviceKey: key, idleSeconds: 30 * 60 });
      const inMeeting = Date.parse('2026-09-21T06:21:00Z');
      at('2026-09-21T06:21:00Z');
      fetchSpy = mockFreeBusy({
        'machi.chen@emctaipei.com': [[inMeeting - 20 * 60_000, inMeeting + 20 * 60_000]],
        'anna.hsu@emctaipei.com': [], 'amber.tian@emctaipei.com': [],
        'leona.chen@emctaipei.com': [], 'noise.zhong@emctaipei.com': []
      });
      expect(await runCalendarSync(inMeeting)).toMatchObject({ meeting: ['Machi'] });
      fetchSpy.mockRestore();
      for (const minute of ['25', '30', '35', '40', '44']) {
        at(`2026-09-21T06:${minute}:00Z`);
        await api({ action: 'pixelOfficeHeartbeat', name: 'Machi', serviceKey: key, idleSeconds: 30 * 60 });
      }
      const after = Date.parse('2026-09-21T06:45:00Z');
      at('2026-09-21T06:45:00Z');
      fetchSpy = mockFreeBusy({
        'machi.chen@emctaipei.com': [], 'anna.hsu@emctaipei.com': [], 'amber.tian@emctaipei.com': [],
        'leona.chen@emctaipei.com': [], 'noise.zhong@emctaipei.com': []
      });
      expect(await runCalendarSync(after)).toMatchObject({ ok: true, released: ['Machi'] });
      expect(await statusOfPerson('Machi')).toMatchObject({ status: 'present', statusSource: 'auto' });
      fetchSpy.mockRestore();

      // 手動點的公出、出國是電腦看不出來的，行事曆不覆蓋（使用者的選擇優先）。
      await api({ action: 'pixelOfficeUpdate', name: 'Amber', patch: { status: 'out' } });
      fetchSpy = mockFreeBusy({
        'machi.chen@emctaipei.com': [], 'anna.hsu@emctaipei.com': [],
        'amber.tian@emctaipei.com': [[after - 10 * 60_000, after + 10 * 60_000]],
        'leona.chen@emctaipei.com': [], 'noise.zhong@emctaipei.com': []
      });
      expect(await runCalendarSync(after)).toMatchObject({ meeting: [], manualHeld: ['Amber'] });
      expect(await statusOfPerson('Amber')).toMatchObject({ status: 'out', statusSource: 'manual' });
      fetchSpy.mockRestore();

      // 但手動點的「在座」這種電腦自己也判斷得出來的狀態，行事曆可以蓋掉——不然手動點過一次之後
      // 行事曆就永遠卡住（2026-09-22 使用者回報「行事曆有會議但狀態沒更新」）。
      await api({ action: 'pixelOfficeUpdate', name: 'Amber', patch: { status: 'present' } });
      fetchSpy = mockFreeBusy({
        'machi.chen@emctaipei.com': [], 'anna.hsu@emctaipei.com': [],
        'amber.tian@emctaipei.com': [[after - 10 * 60_000, after + 10 * 60_000]],
        'leona.chen@emctaipei.com': [], 'noise.zhong@emctaipei.com': []
      });
      expect(await runCalendarSync(after)).toMatchObject({ detected: { Amber: 'meeting' }, meeting: ['Amber'], manualHeld: [] });
      expect(await statusOfPerson('Amber')).toMatchObject({ status: 'meeting', statusSource: 'calendar' });
      fetchSpy.mockRestore();
      // 散會後照樣交還給電腦判斷。
      fetchSpy = mockFreeBusy({
        'machi.chen@emctaipei.com': [], 'anna.hsu@emctaipei.com': [], 'amber.tian@emctaipei.com': [],
        'leona.chen@emctaipei.com': [], 'noise.zhong@emctaipei.com': []
      });
      expect(await runCalendarSync(after)).toMatchObject({ released: ['Amber'] });
      expect(await statusOfPerson('Amber')).toMatchObject({ statusSource: 'auto' });
      fetchSpy.mockRestore();
      await api({ action: 'pixelOfficeUpdate', name: 'Amber', patch: { status: 'out' } });
      fetchSpy = mockFreeBusy({
        'machi.chen@emctaipei.com': [], 'anna.hsu@emctaipei.com': [],
        'amber.tian@emctaipei.com': [[after - 10 * 60_000, after + 10 * 60_000]],
        'leona.chen@emctaipei.com': [], 'noise.zhong@emctaipei.com': []
      });
      expect(await statusOfPerson('Amber')).toMatchObject({ status: 'out', statusSource: 'manual' });
      // 手動點的會議，行事曆散會時也不會幫忙收回——要自己取消。
      await api({ action: 'pixelOfficeUpdate', name: 'Amber', patch: { status: 'meeting' } });
      fetchSpy.mockRestore();
      fetchSpy = mockFreeBusy({
        'machi.chen@emctaipei.com': [], 'anna.hsu@emctaipei.com': [], 'amber.tian@emctaipei.com': [],
        'leona.chen@emctaipei.com': [], 'noise.zhong@emctaipei.com': []
      });
      expect(await runCalendarSync(after)).toMatchObject({ released: [] });
      expect(await statusOfPerson('Amber')).toMatchObject({ status: 'meeting', statusSource: 'manual' });
      fetchSpy.mockRestore();

      // 假日與上班時段以外完全不查（不浪費 API 配額，也不會在週末把人改成會議）。
      const neverCalled = vi.spyOn(globalThis, 'fetch').mockImplementation(async () => { throw new Error('不該查行事曆'); });
      expect(await runCalendarSync(Date.parse('2026-09-26T06:00:00Z'))).toMatchObject({ skipped: 'holiday' });
      expect(await runCalendarSync(Date.parse('2026-09-21T16:00:00Z'))).toMatchObject({ skipped: 'off-hours' });
      expect(neverCalled).not.toHaveBeenCalled();
      neverCalled.mockRestore();
    } finally {
      vi.useRealTimers();
    }
  });

  it('puts 公出／用餐 back to 在座 once the person has been at the computer for a while', async () => {
    const key = 'test-nas-watcher-key';
    vi.useFakeTimers({ toFake: ['Date'] });
    try {
      const at = (iso: string) => vi.setSystemTime(new Date(Date.parse(iso)));
      // 平日下午（台北 15:00），電腦開著、人在座位上。
      at('2026-09-21T07:00:00Z');
      await api({ action: 'pixelOfficeHeartbeat', name: 'Leona', serviceKey: key, idleSeconds: 3 });

      // 自己點了公出。電腦判斷不出來，所以只要人不在電腦前就一直維持。
      await api({ action: 'pixelOfficeUpdate', name: 'Leona', patch: { status: 'out' } });
      at('2026-09-21T07:01:00Z');
      expect(await api({ action: 'pixelOfficeHeartbeat', name: 'Leona', serviceKey: key, idleSeconds: 30 * 60 }))
        .toMatchObject({ status: 'out' });

      // 回來了：頭兩分鐘還不算數（敲一下鍵盤就跳回去的話畫面會一直閃）。
      at('2026-09-21T07:02:00Z');
      expect(await api({ action: 'pixelOfficeHeartbeat', name: 'Leona', serviceKey: key, idleSeconds: 3 }))
        .toMatchObject({ status: 'out', changed: false });
      at('2026-09-21T07:04:00Z');
      expect(await api({ action: 'pixelOfficeHeartbeat', name: 'Leona', serviceKey: key, idleSeconds: 3 }))
        .toMatchObject({ status: 'out', changed: false });
      // 連續滿 3 分鐘：收回成在座（2026-09-23 使用者要求）。
      at('2026-09-21T07:05:00Z');
      expect(await api({ action: 'pixelOfficeHeartbeat', name: 'Leona', serviceKey: key, idleSeconds: 3 }))
        .toMatchObject({ status: 'present', changed: true });
      expect(await statusOfPerson('Leona')).toMatchObject({ status: 'present', statusSource: 'auto' });

      // 中間離開一次，計時要重來，不能把離開前後的時間加在一起。
      await api({ action: 'pixelOfficeUpdate', name: 'Leona', patch: { status: 'out' } });
      at('2026-09-21T07:06:00Z');
      await api({ action: 'pixelOfficeHeartbeat', name: 'Leona', serviceKey: key, idleSeconds: 3 });
      at('2026-09-21T07:08:00Z');
      await api({ action: 'pixelOfficeHeartbeat', name: 'Leona', serviceKey: key, idleSeconds: 30 * 60 });
      at('2026-09-21T07:10:00Z');
      expect(await api({ action: 'pixelOfficeHeartbeat', name: 'Leona', serviceKey: key, idleSeconds: 3 }))
        .toMatchObject({ status: 'out', changed: false });

      // 手動點的「用餐」也一樣收得回來（中午沒去吃、一直在電腦前）。
      at('2026-09-21T04:00:00Z');
      await api({ action: 'pixelOfficeHeartbeat', name: 'Amber', serviceKey: key, idleSeconds: 3 });
      await api({ action: 'pixelOfficeUpdate', name: 'Amber', patch: { status: 'lunch' } });
      for (const minute of ['01', '02', '03']) {
        at(`2026-09-21T04:${minute}:00Z`);
        await api({ action: 'pixelOfficeHeartbeat', name: 'Amber', serviceKey: key, idleSeconds: 3 });
      }
      at('2026-09-21T04:04:00Z');
      expect(await api({ action: 'pixelOfficeHeartbeat', name: 'Amber', serviceKey: key, idleSeconds: 3 }))
        .toMatchObject({ status: 'present' });

      // 出國與休假不收：那兩個期間開電腦處理一點事很正常，不該被改成在座。
      for (const [name, status] of [['Noise', 'abroad'], ['Anna', 'leave']] as const) {
        at('2026-09-21T07:20:00Z');
        await api({ action: 'pixelOfficeHeartbeat', name, serviceKey: key, idleSeconds: 3 });
        await api({ action: 'pixelOfficeUpdate', name, patch: { status } });
        for (const minute of ['21', '22', '23', '24', '25']) {
          at(`2026-09-21T07:${minute}:00Z`);
          await api({ action: 'pixelOfficeHeartbeat', name, serviceKey: key, idleSeconds: 3 });
        }
        expect(await statusOfPerson(name)).toMatchObject({ status, statusSource: 'manual' });
      }

      // 舊版爬蟲沒回報 idleSeconds：電腦開著不等於人在，不能拿來收回公出。
      at('2026-09-21T08:00:00Z');
      await api({ action: 'pixelOfficeHeartbeat', name: 'Leona', serviceKey: key, idleSeconds: 3 });
      await api({ action: 'pixelOfficeUpdate', name: 'Leona', patch: { status: 'out' } });
      for (const minute of ['01', '02', '03', '04', '05']) {
        at(`2026-09-21T08:${minute}:00Z`);
        await api({ action: 'pixelOfficeHeartbeat', name: 'Leona', serviceKey: key });
      }
      expect(await statusOfPerson('Leona')).toMatchObject({ status: 'out', statusSource: 'manual' });
    } finally {
      vi.useRealTimers();
    }
  });

  it('uses event details to distinguish 休假 from 會議 and falls back per calendar when details are private', async () => {
    const key = 'test-nas-watcher-key';
    vi.useFakeTimers({ toFake: ['Date'] });
    try {
      const now = Date.parse('2026-09-21T06:00:00Z');
      vi.setSystemTime(new Date(now));
      await seedCalendarToken('https://www.googleapis.com/auth/calendar.freebusy https://www.googleapis.com/auth/calendar.events.readonly');
      for (const name of ['Machi', 'Anna', 'Amber', 'Leona', 'Noise']) {
        await api({ action: 'pixelOfficeHeartbeat', name, serviceKey: key, idleSeconds: 3 });
      }
      const shortBusy: [number, number][] = [[now - 20 * 60_000, now + 40 * 60_000]];
      const allDayBusy: [number, number][] = [[Date.parse('2026-09-20T16:00:00Z'), Date.parse('2026-09-21T16:00:00Z')]];
      const timed = (eventType: string, summary: string) => ({
        status: 'confirmed', eventType, summary,
        start: { dateTime: new Date(now - 20 * 60_000).toISOString() },
        end: { dateTime: new Date(now + 40 * 60_000).toISOString() }
      });
      let fetchSpy = mockCalendarApi({
        'machi.chen@emctaipei.com': shortBusy,
        'anna.hsu@emctaipei.com': allDayBusy,
        'amber.tian@emctaipei.com': allDayBusy,
        'leona.chen@emctaipei.com': shortBusy,
        'noise.zhong@emctaipei.com': shortBusy
      }, {
        'machi.chen@emctaipei.com': [timed('default', '設計週會')],
        'anna.hsu@emctaipei.com': [{
          status: 'confirmed', eventType: 'outOfOffice', summary: 'Out of office',
          start: { date: '2026-09-21' }, end: { date: '2026-09-22' }
        }],
        'amber.tian@emctaipei.com': [{
          status: 'confirmed', eventType: 'default', summary: '特休', transparency: 'transparent',
          organizer: { email: 'amber.tian@emctaipei.com' },
          start: { date: '2026-09-21' }, end: { date: '2026-09-22' }
        }],
        // 事件內容沒分享，但 freeBusy 看得到：仍能保守判成會議。
        'leona.chen@emctaipei.com': { status: 403 },
        // 專注時間即使顯示 busy，也不是會議。
        'noise.zhong@emctaipei.com': [timed('focusTime', '專心工作')]
      });
      expect(await runCalendarSync(now)).toMatchObject({
        ok: true, meeting: ['Machi', 'Leona'], leave: ['Anna', 'Amber'], detailUnreadable: ['Leona']
      });
      expect(await statusOfPerson('Machi')).toMatchObject({ status: 'meeting', statusSource: 'calendar' });
      expect(await statusOfPerson('Anna')).toMatchObject({ status: 'leave', statusSource: 'calendar' });
      expect(await statusOfPerson('Amber')).toMatchObject({ status: 'leave', statusSource: 'calendar' });
      expect(await statusOfPerson('Leona')).toMatchObject({ status: 'meeting', statusSource: 'calendar' });
      expect(await statusOfPerson('Noise')).toMatchObject({ status: 'present' });
      fetchSpy.mockRestore();

      // 電腦仍有心跳也不覆蓋行事曆休假。
      expect(await api({ action: 'pixelOfficeHeartbeat', name: 'Anna', serviceKey: key, idleSeconds: 3 }))
        .toMatchObject({ status: 'leave', changed: false });

      // 真實團隊行事曆會把「Leona休假」分享給每個人，而且事件本身設為空閒。共享事件只應
      // 讓建立者／被標題點名的 Leona 休假，不能讓五個人的看板一起變成休假。
      const sharedLeonaLeave = {
        status: 'confirmed', eventType: 'default', summary: 'Leona休假', transparency: 'transparent',
        organizer: { email: 'leona.chen@emctaipei.com' },
        start: { date: '2026-09-21' }, end: { date: '2026-09-22' }
      };
      fetchSpy = mockCalendarApi({
        'machi.chen@emctaipei.com': [], 'anna.hsu@emctaipei.com': [], 'amber.tian@emctaipei.com': [],
        'leona.chen@emctaipei.com': [], 'noise.zhong@emctaipei.com': []
      }, {
        'machi.chen@emctaipei.com': [sharedLeonaLeave], 'anna.hsu@emctaipei.com': [sharedLeonaLeave],
        'amber.tian@emctaipei.com': [sharedLeonaLeave], 'leona.chen@emctaipei.com': [sharedLeonaLeave],
        'noise.zhong@emctaipei.com': [sharedLeonaLeave]
      });
      expect(await runCalendarSync(now + 60_000)).toMatchObject({
        leave: ['Leona'], released: expect.arrayContaining(['Machi', 'Anna', 'Amber'])
      });
      expect(await statusOfPerson('Machi')).toMatchObject({ status: 'present', statusSource: 'auto' });
      expect(await statusOfPerson('Anna')).toMatchObject({ status: 'present', statusSource: 'auto' });
      expect(await statusOfPerson('Amber')).toMatchObject({ status: 'present', statusSource: 'auto' });
      expect(await statusOfPerson('Leona')).toMatchObject({ status: 'leave', statusSource: 'calendar' });
      expect(await statusOfPerson('Noise')).toMatchObject({ status: 'present', statusSource: 'auto' });
      fetchSpy.mockRestore();

      // 所有事件結束後才交還自動狀態。
      fetchSpy = mockCalendarApi({
        'machi.chen@emctaipei.com': [], 'anna.hsu@emctaipei.com': [], 'amber.tian@emctaipei.com': [],
        'leona.chen@emctaipei.com': [], 'noise.zhong@emctaipei.com': []
      }, {
        'machi.chen@emctaipei.com': [], 'anna.hsu@emctaipei.com': [], 'amber.tian@emctaipei.com': [],
        'leona.chen@emctaipei.com': { status: 403 }, 'noise.zhong@emctaipei.com': []
      });
      expect(await runCalendarSync(now + 120_000)).toMatchObject({ released: ['Leona'] });
      expect(await statusOfPerson('Anna')).toMatchObject({ status: 'present', statusSource: 'auto' });
      fetchSpy.mockRestore();
    } finally {
      vi.useRealTimers();
    }
  });

  it('never changes anyone when the calendar cannot be read', async () => {
    const key = 'test-nas-watcher-key';
    vi.useFakeTimers({ toFake: ['Date'] });
    try {
      const now = Date.parse('2026-09-21T06:00:00Z');
      vi.setSystemTime(new Date(now));
      await api({ action: 'pixelOfficeHeartbeat', name: 'Machi', serviceKey: key, idleSeconds: 3 });

      // 還沒重新授權（沒有帶行事曆權限的 token）：這一輪什麼都不做。
      expect(await runCalendarSync(now)).toMatchObject({ ok: false, reason: 'no-token' });
      expect(await statusOfPerson('Machi')).toMatchObject({ status: 'present' });

      // 授權了但 Google 回錯（例如專案還沒啟用 Calendar API）：一樣什麼都不做。
      await seedCalendarToken();
      const failing = vi.spyOn(globalThis, 'fetch').mockImplementation(async (input: RequestInfo | URL) => {
        const url = String(input instanceof Request ? input.url : input);
        if (url.includes('oauth2.googleapis.com/token')) return new Response(JSON.stringify({ access_token: 'x', expires_in: 3600 }), { status: 200 });
        return new Response(JSON.stringify({ error: { message: 'Google Calendar API has not been used in project' } }), { status: 403 });
      });
      expect(await runCalendarSync(now)).toMatchObject({ ok: false, reason: 'freebusy-failed', status: 403 });
      expect(await statusOfPerson('Machi')).toMatchObject({ status: 'present' });
      failing.mockRestore();
    } finally {
      vi.useRealTimers();
    }
  });

  it('shows 用餐 at lunch time when the computer is idle, and 下班 on weekends and public holidays', async () => {
    const key = 'test-nas-watcher-key';
    const at = (iso: string) => vi.setSystemTime(new Date(iso));
    const heartbeat = (idleSeconds?: number) => api({ action: 'pixelOfficeHeartbeat', name: 'Amber', serviceKey: key, ...(idleSeconds === undefined ? {} : { idleSeconds }) });
    vi.useFakeTimers({ toFake: ['Date'] });
    try {
      // 2026-09-21 是星期一。台北 = UTC+8。
      // 中午 12:30 還在打字（閒置 30 秒）：照樣在座。
      at('2026-09-21T04:30:00Z');
      expect(await heartbeat(30)).toMatchObject({ status: 'present' });

      // 中午 12:31 已經離開座位五分鐘：用餐。
      at('2026-09-21T04:31:00Z');
      expect(await heartbeat(5 * 60)).toMatchObject({ status: 'lunch' });

      // 回到座位：自動回到在座，不用手動點。
      at('2026-09-21T04:32:00Z');
      expect(await heartbeat(10)).toMatchObject({ status: 'present' });

      // 兩點之後閒置著就不是用餐而是離開座位（廁所）。
      at('2026-09-21T06:05:00Z');
      expect(await heartbeat(30 * 60)).toMatchObject({ status: 'toilet' });

      // 一般上班時間離開座位滿五分鐘：廁所；回來打字就自動回到在座。
      at('2026-09-21T07:00:00Z');
      expect(await heartbeat(4 * 60)).toMatchObject({ status: 'present' });
      at('2026-09-21T07:05:00Z');
      expect(await heartbeat(5 * 60)).toMatchObject({ status: 'toilet' });
      at('2026-09-21T07:06:00Z');
      expect(await heartbeat(3)).toMatchObject({ status: 'present' });

      // 加班時段離開座位也是廁所——閒置著就不算還在工作。
      at('2026-09-21T11:30:00Z');
      expect(await heartbeat(3)).toMatchObject({ status: 'overtime' });
      at('2026-09-21T11:31:00Z');
      expect(await heartbeat(10 * 60)).toMatchObject({ status: 'toilet' });
      at('2026-09-21T11:32:00Z');
      expect(await heartbeat(3)).toMatchObject({ status: 'overtime' });

      // 爬蟲沒回報閒置秒數（舊版本或查不到）時，中午也只會是在座，不會誤判成用餐。
      at('2026-09-21T04:40:00Z');
      expect(await heartbeat()).toMatchObject({ status: 'present' });

      // 午休時間電腦關機（超過門檻沒心跳）就是下班，不是用餐。
      at('2026-09-21T04:50:00Z');
      const people = (await api({ action: 'pixelOfficeState' })).people as Record<string, unknown>[];
      expect(people.find(person => person.name === 'Amber')?.status).toBe('offwork');

      // 星期六：電腦開著也是下班。
      at('2026-09-26T02:00:00Z');
      expect(await heartbeat(5)).toMatchObject({ status: 'offwork' });

      // 國定假日（9/28 教師節，星期一）：電腦開著也是下班。
      at('2026-09-28T02:00:00Z');
      expect(await heartbeat(5)).toMatchObject({ status: 'offwork' });

      // 假日的晚上也不會變成加班。
      at('2026-09-28T12:00:00Z');
      expect(await heartbeat(5)).toMatchObject({ status: 'offwork' });

      // 收假後的星期二早上：自動回到在座。
      at('2026-09-29T01:00:00Z');
      expect(await heartbeat(5)).toMatchObject({ status: 'present' });

      // 手動指定只在同一個時段內有效。晚上手動點在座（規則說是加班）：當晚電腦開著都維持在座。
      at('2026-09-29T11:30:00Z');
      await heartbeat(5);
      await api({ action: 'pixelOfficeUpdate', name: 'Amber', patch: { status: 'present' } });
      at('2026-09-29T11:31:00Z');
      expect(await heartbeat(5)).toMatchObject({ status: 'present', changed: false });

      // 隔天白天時段換了：手動失效，交還給自動。
      at('2026-09-30T01:00:00Z');
      expect(await heartbeat(5)).toMatchObject({ status: 'present' });
      at('2026-09-30T01:01:00Z');
      await api({ action: 'pixelOfficeUpdate', name: 'Amber', patch: { status: 'overtime' } });
      at('2026-09-30T01:02:00Z');
      expect(await heartbeat(5)).toMatchObject({ status: 'overtime', changed: false });
      at('2026-09-30T11:30:00Z');
      for (const minute of ['26', '27', '28', '29']) { at(`2026-09-30T11:${minute}:00Z`); await heartbeat(5); }
      at('2026-09-30T11:31:00Z');
      expect(await heartbeat(5)).toMatchObject({ status: 'overtime' });

      // 會議：電腦看不出來有沒有在開會，所以手動點了就維持——離開座位滿五分鐘也不會被改成廁所。
      at('2026-09-30T02:00:00Z');
      await heartbeat(5);
      await api({ action: 'pixelOfficeUpdate', name: 'Amber', patch: { status: 'meeting' } });
      at('2026-09-30T02:01:00Z');
      expect(await heartbeat(30 * 60)).toMatchObject({ status: 'meeting', changed: false });
      // 帶著筆電去會議室（電腦關機）也不會被改成下班。
      at('2026-09-30T02:30:00Z');
      const inMeeting = (await api({ action: 'pixelOfficeState' })).people as Record<string, unknown>[];
      expect(inMeeting.find(person => person.name === 'Amber')?.status).toBe('meeting');
      // 回到座位開機：重新由電腦決定。
      expect(await heartbeat(5)).toMatchObject({ status: 'present', changed: true });

      // 出國／公出這類「不是靠電腦判斷」的手動狀態不受時段影響：電腦一直開著、跨過凌晨六點
      //（加班時段結束）也不會被交還給自動。
      at('2026-09-30T21:55:00Z');
      await heartbeat(5);
      await api({ action: 'pixelOfficeUpdate', name: 'Amber', patch: { status: 'abroad' } });
      at('2026-09-30T21:58:00Z');
      expect(await heartbeat(5)).toMatchObject({ status: 'abroad', changed: false });
      at('2026-09-30T22:01:00Z');
      expect(await heartbeat(5)).toMatchObject({ status: 'abroad', changed: false });
    } finally {
      vi.useRealTimers();
    }
  });
});

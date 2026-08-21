import { env } from 'cloudflare:workers';
import { reset, runInDurableObject, SELF } from 'cloudflare:test';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DEFAULT_CUSTOMER_NAMES, emptyDatabase } from '../../backend/schema.mjs';
import type { DatabaseCoordinator } from '../src/database-coordinator';
import { hasRowCapability } from '../src/model';
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
async function seedGmailTokens(account: string, accessToken: string, gmailAddress = `${account.split('@')[0]}@gmail.example`): Promise<void> {
  const stub = env.DATABASE_COORDINATOR.getByName('primary') as DurableObjectStub<DatabaseCoordinator>;
  await runInDurableObject(stub, async (_instance, state) => {
    state.storage.sql.exec(
      `INSERT INTO gmail_tokens(account, refresh_token, access_token, access_token_expires_at, gmail_address, connected_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      account, `refresh-${account}`, accessToken, Date.now() + 3600 * 1000, gmailAddress, new Date().toISOString(), new Date().toISOString()
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
    expect(stored.migrations).toEqual([{ version: 1 }, { version: 2 }, { version: 3 }, { version: 4 }]);
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
    expect(database.tables.reels.rows.some(row => String(row['限時動態連結']).includes(storyId))).toBe(false);
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
        expect(replyHtml).toContain(`<blockquote style="margin:0 0 0 .8ex;border-left:1px solid #ccc;padding-left:1ex">${plainTextBody}`);
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
            { sendAsEmail: 'someone.else@gmail.com', isPrimary: false, signature: '不該被選到的簽名' },
            { sendAsEmail: 'designer.mailbox@gmail.com', isPrimary: true, signature: '<b>Machi</b><br>EMC 設計組' }
          ]
        });
      }
      throw new Error(`unexpected fetch during signature read: ${url}`);
    });
    const signature = await api({ action: 'getGmailSignature' }, token);
    expect(signature).toMatchObject({ ok: true, signature: '<b>Machi</b><br>EMC 設計組' });

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

      await forceScheduledAtDue(scheduledId);
      let sendCalls = 0;
      vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
        const url = String(input);
        if (url === 'https://gmail.googleapis.com/gmail/v1/users/me/messages/send') {
          sendCalls += 1;
          const body = JSON.parse(String(init?.body));
          expect(body.threadId).toBeUndefined();
          // 內文是巢狀 base64 編碼在 MIME part 裡，不會直接出現在外層 raw 解碼結果，這裡只驗證最外層一定
          // 看得到的收件人標頭；內文/簽名檔的組信正確性已經有 sendCaseMail 既有測試涵蓋，這裡的重點是
          // 「排程真的會在到期時觸發寄送」，不重複驗證 MIME 組裝細節。
          const decoded = decodeBase64UrlText(String(body.raw));
          expect(decoded).toContain('To: client@example.com');
          return Response.json({ id: 'scheduled-msg-1', threadId: 'scheduled-thread-1' });
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
        if (url === 'https://gmail.googleapis.com/gmail/v1/users/me/messages/send') {
          sendCalls += 1;
          return Response.json({ id: 'single-message', threadId: 'single-thread' });
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
          if (sendAttempts === 1) {
            expect(body.threadId).toBe('stale-mismatched-thread');
            return new Response(JSON.stringify({ error: { message: 'Precondition check failed.' } }), { status: 400 });
          }
          expect(body.threadId).toBeUndefined();
          return Response.json({ id: 'designer-scheduled-reply-fallback', threadId: 'brand-new-thread' });
        }
        throw new Error(`unexpected fetch during fallback reply dispatch: ${url}`);
      });
      const result = await (await schedulerStub()).runScheduledDispatch();
      expect(result).toEqual({ processed: 1, sent: 1, failed: 0 });
      expect(sendAttempts).toBe(2);
      expect((await scheduledMailRow(scheduledId))?.status).toBe('sent');
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

      vi.spyOn(globalThis, 'fetch').mockImplementation(async input => {
        throw new Error(`不該呼叫 Gmail 送信——案件已經有信件串了: ${String(input)}`);
      });
      const result = await (await schedulerStub()).runScheduledDispatch();
      expect(result).toEqual({ processed: 1, sent: 0, failed: 0 });
      expect(await scheduledMailRow(scheduledId)).toMatchObject({ status: 'canceled', error_message: null });

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
        if (url === 'https://gmail.googleapis.com/gmail/v1/users/me/messages/send') return Response.json({ id: 'recovered-msg-1', threadId: 'recovered-thread-1' });
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

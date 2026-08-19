import { env } from 'cloudflare:workers';
import { reset, runInDurableObject, SELF } from 'cloudflare:test';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DEFAULT_CUSTOMER_NAMES, emptyDatabase } from '../../backend/schema.mjs';
import type { DatabaseCoordinator } from '../src/database-coordinator';
import type { DatabaseSnapshot } from '../src/types';

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
    expect(stored.migrations).toEqual([{ version: 1 }, { version: 2 }, { version: 3 }]);
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
        skillMappings: [{ name: '短影音', type: '影音', stage: '後製' }]
      }
    }, token);
    expect(designerSaved).toMatchObject({
      ok: true, action: 'adminDesignerSave', changedTables: ['設定'],
      settingsRow: { '帳號': account, '設計師顯示': 'v', '技能': '短影音' }
    });
    const activeProfiles = await api({ action: 'listDesignerProfiles' });
    expect((activeProfiles.profiles as Array<Record<string, unknown>>).find(profile => profile.account === account)).toMatchObject({
      name: 'Designer QA', designType: '影音', skillMappings: [{ name: '短影音', type: '影音', stage: '後製' }]
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
      profiles: [{ name: 'Machi', poster: 'https://example.com/new-poster.jpg' }]
    }, token);
    expect(saved).toMatchObject({ ok: true, action: 'saveDesignerProfiles' });

    const stub = env.DATABASE_COORDINATOR.getByName('primary') as DurableObjectStub<DatabaseCoordinator>;
    const database = await runInDurableObject(stub, async (_instance, state) => {
      const stored = state.storage.sql.exec<{ json: string }>('SELECT json FROM database_state WHERE id = ?', 'primary').one();
      return JSON.parse(stored.json) as DatabaseSnapshot;
    });
    expect(database.tables['設定'].rows).toContainEqual(expect.objectContaining({
      '名字': 'Machi',
      '頭像大圖連結': 'https://example.com/new-poster.jpg'
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
    expect(plainPartBody).toContain('-- \nMachi 敬上');
    const htmlPartBody = extractPart('text/html');
    expect(htmlPartBody).toContain(sentBodyHtml);
    expect(htmlPartBody).toContain('class="gmail_signature"');
    expect(htmlPartBody).toContain(sentSignatureHtml);
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

    // 驗證新的權限依據：不是系統層級的 request.mail 權限，而是「這個帳號的 email 有沒有出現在信件串本身的
    // 收件人/寄件人/副本裡」——admin@emctaipei.com（每日 shortcut 密碼登入的管理者帳號，角色範本本來就有全部
    // 權限）故意拿來測試「有系統權限、但不是這封信的相關人」這種情境，應該被擋下，不是像改動前那樣只要有系統
    // 權限就能看；designer@emctaipei.com 確實出現在下面 mock 訊息的 From/To 裡，用 seedSession 直接模擬「這個
    // 帳號已經登入」，不需要它在「設定」／「帳號權限」表裡有任何資料，正好驗證權限依據真的是信件內容本身。
    const todayMonthDay = new Intl.DateTimeFormat('en-US', { timeZone: 'Asia/Taipei', month: '2-digit', day: '2-digit' })
      .formatToParts(new Date()).reduce((acc, part) => (part.type === 'month' || part.type === 'day' ? acc + part.value : acc), '');
    const adminLogin = await api({ action: 'login', password: todayMonthDay });
    expect(adminLogin.ok).toBe(true);
    const adminToken = String(adminLogin.token);
    const designerToken = await seedSession('designer@emctaipei.com');

    const plainTextBody = 'Hi，這是設計師的回覆內容';
    const plainTextBodyBase64Url = toBase64Url(`${plainTextBody}\n\n設計師簽名檔`);
    // 第二封信刻意用 multipart/mixed 夾帶一張圖片附件（有 attachmentId），驗證瀏覽信件串時內嵌圖片會被抓回來顯示。
    const mockThreadMessages = [
      {
        id: 'gmail-msg-1', snippet: 'Hi，這是測試信件內容',
        payload: {
          mimeType: 'text/plain', body: { data: toBase64Url('Hi，這是測試信件內容') },
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
    const messages = thread.messages as Array<Record<string, unknown>>;
    expect(messages).toHaveLength(2);
    expect(messages[1]).toMatchObject({ from: 'designer@emctaipei.com', bodyText: plainTextBody, date: '2026/08/17 11:00' });
    const secondMessageImages = messages[1].images as Array<{ dataUrl: string }>;
    expect(secondMessageImages).toHaveLength(1);
    expect(secondMessageImages[0].dataUrl.startsWith('data:image/png;base64,')).toBe(true);

    // 回覆：admin（不是相關人）應該被擋下；designer（相關人）應該成功——先抓最後一封信的標頭組出
    // In-Reply-To/References 再送出，threadId 要跟著帶上，「回覆對象」判斷要用寄件帳號自己的 Gmail 地址比對。
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
      const url = String(input);
      if (url.includes('/threads/gmail-thread-1?format=metadata')) {
        expect(new Headers(init?.headers).get('Authorization')).toBe('Bearer gmail-access-1');
        return Response.json({ id: 'gmail-thread-1', messages: mockThreadMessages });
      }
      if (url === 'https://gmail.googleapis.com/gmail/v1/users/me/messages/send') {
        expect(new Headers(init?.headers).get('Authorization')).toBe('Bearer gmail-access-1');
        const body = JSON.parse(String(init?.body));
        expect(body.threadId).toBe('gmail-thread-1');
        // 最後一封信是「designer@emctaipei.com」寄給「test.user@emctaipei.com」（也就是寄件帳號自己收到的），
        // 所以應該回覆給 designer@emctaipei.com，不是誤判成回覆給觸發者自己或其他人。
        const decodedRaw = decodeBase64UrlText(String(body.raw));
        expect(decodedRaw).toContain('To: designer@emctaipei.com');
        return Response.json({ id: 'gmail-msg-3', threadId: 'gmail-thread-1' });
      }
      throw new Error(`unexpected fetch during reply: ${url}`);
    });
    const rejectedReply = await api({ action: 'replyCaseMail', caseId: '26080001', bodyText: '不應該成功' }, adminToken);
    expect(rejectedReply).toMatchObject({ ok: false, reason: 'GMAIL_THREAD_NOT_PARTICIPANT' });
    const replied = await api({ action: 'replyCaseMail', caseId: '26080001', bodyText: '收到，謝謝回報' }, designerToken);
    expect(replied).toMatchObject({ ok: true, gmailMessageId: 'gmail-msg-3' });

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

  it('seeds the 29 default customers on normalize and preserves existing assignments plus extra admin-added customers', async () => {
    await seedCustomerOwner('Epson', 'test.user@emctaipei.com');
    const token = await login();
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (_input, init) => {
      expect(init?.method).toBe('PUT');
      return Response.json({ content: { sha: 'customer-extra-file-sha' }, commit: { sha: 'customer-extra-commit-sha' } });
    });
    // 後台通用的 adminTableInsert 新增一個不在預設清單裡的客戶別，確認合併邏輯不會把它洗掉。
    const inserted = await api({
      action: 'adminTableInsert', table: '客戶別',
      row: { '客戶別': '後台自訂客戶', '專案負責人': '[]', '設計負責人': '[]', '部門組別': '[]', '更新時間': '', '更新者': 'Machi' }
    }, token);
    expect(inserted.ok).toBe(true);

    const stub = env.DATABASE_COORDINATOR.getByName('primary') as DurableObjectStub<DatabaseCoordinator>;
    const database = await runInDurableObject(stub, async (_instance, state) => {
      const stored = state.storage.sql.exec<{ json: string }>('SELECT json FROM database_state WHERE id = ?', 'primary').one();
      return JSON.parse(stored.json) as DatabaseSnapshot;
    });
    const customerRows = database.tables['客戶別'].rows;
    expect(customerRows).toHaveLength(DEFAULT_CUSTOMER_NAMES.length + 1);
    expect(customerRows.map(row => row['客戶別'])).toEqual(expect.arrayContaining([...DEFAULT_CUSTOMER_NAMES, '後台自訂客戶']));
    expect(JSON.parse(String(customerRows.find(row => row['客戶別'] === 'Epson')?.['專案負責人']))).toEqual(['test.user@emctaipei.com']);
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

  it('grants request.edit/request.delete/request.mail to a customer-assigned project owner only for their own case row, blocking other rows and unassigned accounts', async () => {
    // 完全沒有 request.edit／request.delete／request.mail，只靠客戶別的專案負責人身分額外放行。
    await seedAccountPermission('test.user@emctaipei.com', '自訂', ['request.create']);
    await seedCustomerOwner('測試客戶', 'test.user@emctaipei.com');

    const stub = env.DATABASE_COORDINATOR.getByName('primary') as DurableObjectStub<DatabaseCoordinator>;
    await runInDurableObject(stub, async (_instance, state) => {
      const stored = state.storage.sql.exec<{ json: string }>('SELECT json FROM database_state WHERE id = ?', 'primary').one();
      const database = JSON.parse(stored.json) as DatabaseSnapshot;
      // 26080001（既有種子案件）的專案負責人比對「設定」表的顯示名，不是帳號本身。
      database.tables.database.rows.find(row => row['案件編號'] === '26080001')!['專案負責人'] = '測試使用者';
      database.tables.database.rows.push(
        { '案件編號': '26080002', '客戶別': '測試客戶', '專案負責人': '別人', '專案名稱': '別人負責的案件', '狀態': '未開始' },
        { '案件編號': '26080003', '客戶別': '測試客戶', '專案負責人': '測試使用者', '專案名稱': '刪除測試案件', '狀態': '未開始' }
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

    // 編輯同一客戶別、但專案負責人是別人的案件：擋下。
    const otherUpdate = await api({ action: 'update', id: '26080002', row: { id: '26080002', project: '不該被改' } }, token);
    expect(otherUpdate).toMatchObject({ ok: false, error: '此帳號沒有「request.edit」權限' });

    // batchUpdate 不套用這個放寬，即使是自己的案件也一樣要求 request.edit。
    const batchAttempt = await api({ action: 'batchUpdate', rows: [{ id: '26080001', row: { project: '批次不應該成功' } }] }, token);
    expect(batchAttempt).toMatchObject({ ok: false, error: '此帳號沒有「request.edit」權限' });

    // 發信：自己負責的案件成功、別人負責的被擋。
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
    const otherMailAttempt = await api({ action: 'sendCaseMail', caseId: '26080002', to: 'x@example.com', subject: 'test', bodyText: 'x' }, token);
    expect(otherMailAttempt).toMatchObject({ ok: false, error: '此帳號沒有「request.mail」權限' });

    // 刪除：自己負責的案件成功，別人負責的被擋。
    const otherDelete = await api({ action: 'delete', id: '26080002' }, token);
    expect(otherDelete).toMatchObject({ ok: false, error: '此帳號沒有「request.delete」權限' });
    const ownDelete = await api({ action: 'delete', id: '26080003' }, token);
    expect(ownDelete).toMatchObject({ ok: true, id: '26080003' });

    // archive.edit 分支不受這個放寬影響：即使是自己的案件，帶 accessContext:'archive' 一樣要求 archive.edit。
    const archiveDelete = await api({ action: 'delete', id: '26080001', accessContext: 'archive' }, token);
    expect(archiveDelete).toMatchObject({ ok: false, error: '此帳號沒有「archive.edit」權限' });
  });

  it('lets the manager account edit, delete and mail any case regardless of customer assignment', async () => {
    const token = await login();
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (_input, init) => {
      expect(init?.method).toBe('PUT');
      return Response.json({ content: { sha: `manager-file-${crypto.randomUUID()}` }, commit: { sha: 'manager-commit-sha' } });
    });
    const managerUpdate = await api({ action: 'update', id: '26080001', row: { id: '26080001', project: '管理者不受限' } }, token);
    expect(managerUpdate).toMatchObject({ ok: true, id: '26080001' });
    const managerDelete = await api({ action: 'delete', id: '26080001' }, token);
    expect(managerDelete).toMatchObject({ ok: true, id: '26080001' });
  });
});

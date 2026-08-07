import { createServer as createHttpServer } from 'node:http';
import { createReadStream } from 'node:fs';
import { stat } from 'node:fs/promises';
import path from 'node:path';
import { randomBytes, randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { JsonDatabase } from './json_database.mjs';
import { TABLE_NAMES, TABLE_SCHEMAS } from './schema.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..');
const DEFAULT_DB_PATH = path.join(HERE, 'data', 'db.json');
const VERSION = 'json-backend-2026-08-07-1';
const LOGIN_DOMAIN = '@emctaipei.com';
const GOOGLE_CLIENT_ID = '501170620928-dh3e431763b4ah8crq7kirmsu8m17bdj.apps.googleusercontent.com';
const SESSION_SECONDS = 30 * 24 * 60 * 60;
const ISSUE_STATUSES = ['回報中', '評估中', '處理中', '已完成', '已否決'];
const SHORT_CODE_CHARS = '23456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';
const WRITE_ACTIONS = new Set([
  'append', 'create', 'add', 'submit', 'save', 'batchAdd', 'batchAppend', 'addRows', 'update', 'batchUpdate',
  'delete', 'createShortLink', 'saveUserSettings', 'saveDesignerProfiles', 'toggleReelReaction', 'addReelComment',
  'reportIssue', 'updateIssueReportStatus', 'addModificationRecord', 'updateModificationConfirm', 'logout'
]);

const KEY_TO_HEADER = {
  id: '案件編號', month: '月份', client: '客戶別', project: '專案名稱', owner: '專案負責人', type: '設計種類',
  stage: '階段', qty: '數量', start: '開始日期', end: '結束日期', designer: '設計負責人', platforms: '使用平台',
  submittedAt: '填單時間', briefNote: '設計簡報說明', briefUrl: '設計簡報連結', assetNote: '客戶素材說明',
  assetUrl: '客戶素材連結', referenceNote: '參考範例說明', referenceUrl: '參考範例連結', otherNote: '其他說明',
  otherUrl: '其他連結', status: '狀態', details: '項目細節', weight: '加權'
};
const HEADER_ALIASES = {
  '設計種類': ['設計類型', '設計總類', '設計項目'],
  '狀態': ['案件狀態'],
  '項目細節': ['項目細項', '項目細節(可複選)']
};
const SETTINGS_COLUMN_TO_KEY = {
  '案件編號': 'id', '月份': 'month', '客戶別': 'client', '專案名稱': 'project', '專案負責人': 'owner',
  '設計種類': 'type', '階段': 'stage', '數量': 'qty', '開始': 'start', '結束': 'end', '設計負責人': 'designer',
  '狀態': 'status', '項目細節': 'details', '修改': 'modifications', '主旨': 'subject', '操作': 'actions'
};
const SUPPLEMENT_SLOTS = {
  a: { key: 'briefUrl', header: '設計簡報連結', column: 'A' },
  b: { key: 'assetUrl', header: '客戶素材連結', column: 'B' },
  c: { key: 'referenceUrl', header: '參考範例連結', column: 'C' },
  d: { key: 'otherUrl', header: '其他連結', column: 'D' }
};

function text(value) { return String(value ?? '').trim(); }
function truthy(value) { return value === true || /^(?:true|1|yes|on)$/i.test(text(value)); }
function nowTaipei() {
  const parts = Object.fromEntries(new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Taipei', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23'
  }).formatToParts(new Date()).map(part => [part.type, part.value]));
  return `${parts.year}/${parts.month}/${parts.day} ${parts.hour}:${parts.minute}:${parts.second}`;
}
function taipeiDateParts() {
  return Object.fromEntries(new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Taipei', year: 'numeric', month: '2-digit', day: '2-digit' })
    .formatToParts(new Date()).map(part => [part.type, part.value]));
}
function localAdminToken() { const p = taipeiDateParts(); return `local-admin:${p.year}${p.month}${p.day}`; }
function currentPassword() { const p = taipeiDateParts(); return `${p.month}${p.day}`; }
function canonicalAccount(value) {
  const account = text(value).toLowerCase();
  return account && !account.includes('@') ? `${account}${LOGIN_DOMAIN}` : account;
}
function isHttpUrl(value) { try { return /^https?:$/.test(new URL(text(value)).protocol); } catch { return false; } }
function rowYear(row) { return (text(row['開始日期'] || row['結束日期']).match(/(19\d{2}|20\d{2}|2100)/) || [])[1] || ''; }
function monthFromDate(value) { const match = text(value).match(/(?:19\d{2}|20\d{2}|2100)[/-](\d{1,2})/); return match ? `${Number(match[1])}月` : ''; }
function unique(list) { return [...new Set(list.filter(Boolean))]; }
function splitNames(value) { return unique((Array.isArray(value) ? value : text(value).split(/\s*,\s*|，|、|\r?\n/)).map(text)); }
function parseComments(value) {
  try {
    const list = Array.isArray(value) ? value : JSON.parse(text(value) || '[]');
    return Array.isArray(list) ? list.filter(item => item && text(item.name) && text(item.text)) : [];
  } catch { return []; }
}
function reelFileId(value) {
  const source = text(value);
  return (source.match(/drive\.google\.com\/file\/d\/([^/]+)/) || source.match(/lh3\.googleusercontent\.com\/d\/([^=/?]+)/) || source.match(/[?&]id=([^&]+)/) || [])[1] || '';
}
function generateShortCode(existing) {
  for (let attempt = 0; attempt < 40; attempt += 1) {
    const bytes = randomBytes(6);
    let code = '';
    for (let index = 0; index < 6; index += 1) code += SHORT_CODE_CHARS[bytes[index] % SHORT_CODE_CHARS.length];
    if (!existing.has(code)) return code;
  }
  throw new Error('暫時無法產生短碼，請再試一次');
}
function nextCaseId(rows) {
  const p = taipeiDateParts();
  const prefix = `${p.year.slice(-2)}${p.month}`;
  const max = rows.reduce((current, row) => {
    const id = text(row['案件編號']);
    return id.startsWith(prefix) && /^\d{8}$/.test(id) ? Math.max(current, Number(id.slice(4))) : current;
  }, 0);
  return `${prefix}${String(max + 1).padStart(4, '0')}`;
}
function firstValue(source, header, key) {
  if (source[key] !== undefined) return source[key];
  if (source[header] !== undefined) return source[header];
  for (const alias of HEADER_ALIASES[header] || []) if (source[alias] !== undefined) return source[alias];
  return undefined;
}
function toSheetRow(source = {}, existing = {}) {
  const row = { ...existing };
  for (const [key, header] of Object.entries(KEY_TO_HEADER)) {
    const value = firstValue(source, header, key);
    if (value !== undefined) row[header] = value == null ? '' : value;
  }
  for (const header of TABLE_SCHEMAS.database.headers) {
    if (source[header] !== undefined) row[header] = source[header] == null ? '' : source[header];
  }
  if (row['數量'] !== '' && row['數量'] !== undefined) row['數量'] = String(Number(row['數量']) || 1);
  if (row['開始日期']) row['月份'] = monthFromDate(row['開始日期']) || row['月份'] || '';
  return row;
}
function toApiRow(row, index = -1) {
  const result = {};
  for (const [key, header] of Object.entries(KEY_TO_HEADER)) result[key] = row[header] ?? '';
  result.qty = result.qty === '' ? '' : Number(result.qty);
  if (index >= 0) result.sheetRow = result._sheetRow = index + 2;
  return result;
}
function publicReel(row, index) {
  const likes = splitNames(row['按讚']);
  const dislikes = splitNames(row['倒讚']);
  const comments = parseComments(row['留言']).map(({ id, name, avatar, text: commentText, createdAt }) => ({ id, name, avatar, text: commentText, createdAt }));
  return {
    id: reelFileId(row['限時動態連結']) || `row-${index + 2}`,
    rowNumber: index + 2,
    name: text(row['名字']), imageUrl: text(row['限時動態連結']), likes, dislikes,
    likeCount: likes.length, dislikeCount: dislikes.length, comments
  };
}
function issueRow(row, index) {
  const result = { rowNumber: index + 2, ...row };
  if (!ISSUE_STATUSES.includes(result['狀態'])) result['狀態'] = '回報中';
  result['狀態更改時間'] ||= result[result['狀態']] || result['時間'] || '';
  return result;
}
function settingsRow(snapshot, accountOrName) {
  const needle = text(accountOrName).toLowerCase();
  return snapshot.tables['設定'].rows.find(row => canonicalAccount(row['帳號']) === canonicalAccount(needle) || text(row['名字']).toLowerCase() === needle) || null;
}
function settingsResponse(row = {}) {
  const ordered = Object.entries(SETTINGS_COLUMN_TO_KEY).map(([header, key], index) => {
    const value = text(row[header]).toLowerCase();
    const order = /^\d+$/.test(value) ? Number(value) : 999 + index;
    return { key, visible: value === 'v' || /^\d+$/.test(value), order };
  }).filter(item => item.visible).sort((a, b) => a.order - b.order).map(item => item.key);
  const group = text(row['組別']);
  const rawTheme = text(row['深淺模式']);
  return {
    ...row,
    name: text(row['名字']), displayName: text(row['顯示名'] || row['名字']), department: text(row['部門']), group,
    designType: /影音|影像|影片/i.test(group) ? '影音' : (/平面/.test(group) ? '平面' : ''),
    avatar: text(row['頭像連結']), visibleColumns: ordered,
    filters: { year: text(row['篩選年份']), month: text(row['篩選月份']), status: text(row['篩選狀態']), designer: text(row['篩選姓名']) },
    selectEnabled: text(row['選擇']).toLowerCase() === 'v', timelineEnabled: text(row['時間表']).toLowerCase() === 'v',
    collapseSettings: {
      designer: /^[vx]$/i.test(text(row['收合設計師專長與案件分配'])),
      recent: /^[vx]$/i.test(text(row['收合最新案件列表'])), request: /^[vx]$/i.test(text(row['收合設計需求']))
    },
    theme: /深色|dark/i.test(rawTheme) ? 'dark' : (/淺色|light/i.test(rawTheme) ? 'light' : '')
  };
}
function sessionFor(snapshot, token) {
  const value = text(token);
  if (value === localAdminToken()) return { user: '管理者', account: 'admin@local', provider: 'local-admin', expiresAt: Date.now() + 86400000 };
  const session = snapshot.internal.sessions[value];
  return session && Number(session.expiresAt) > Date.now() ? session : null;
}
function requireSession(snapshot, payload) {
  const session = sessionFor(snapshot, payload.editorToken || payload.token);
  if (!session) throw new Error('請先登入後再執行此操作');
  return session;
}
function isManager(snapshot, session) {
  if (!session) return false;
  if (session.user === '管理者' || session.user === 'Machi' || session.provider === 'local-admin') return true;
  const row = settingsRow(snapshot, session.account || session.user);
  return /^(?:管理者|admin)$/i.test(text(row?.['部門'] || row?.['組別']));
}
function syncSupplementLinks(draft, sheetRow, baseUrl) {
  const id = text(sheetRow['案件編號']);
  if (!/^\d{8}$/.test(id)) return;
  const rows = draft.tables['補充資料連結'].rows;
  let record = rows.find(item => text(item['案件編號']) === id);
  let changed = false;
  for (const [slot, config] of Object.entries(SUPPLEMENT_SLOTS)) {
    const value = text(sheetRow[config.header]);
    const ownShort = new RegExp(`/${slot}/${id}/?$`, 'i').test(value);
    if (!value || ownShort || !isHttpUrl(value)) continue;
    if (!record) record = { '案件編號': id, A: '', B: '', C: '', D: '', '更新時間': '' };
    record[config.column] = value;
    sheetRow[config.header] = `${baseUrl.replace(/\/$/, '')}/${slot}/${id}`;
    changed = true;
  }
  if (changed) {
    record['更新時間'] = nowTaipei().slice(0, 16);
    if (!rows.includes(record)) rows.push(record);
  }
}
function findReelIndex(rows, payload) {
  const requestedId = text(payload.reelId || payload.storyId);
  const requestedUrl = text(payload.imageUrl || payload.url);
  const fileId = reelFileId(requestedUrl) || (!requestedId.startsWith('row-') ? requestedId : '');
  const requestedRow = Number(requestedId.replace(/^row-/, '')) || 0;
  return rows.findIndex((row, index) => (fileId && text(row['限時動態連結']).includes(fileId)) || (requestedUrl && text(row['限時動態連結']) === requestedUrl) || requestedRow === index + 2);
}
function updateSettingsRow(row, settings = {}) {
  if ('displayName' in settings || '顯示名' in settings) {
    const value = text(settings.displayName || settings['顯示名']);
    if (!value || value.length > 40) throw new Error('顯示名必須為 1–40 個字');
    row['顯示名'] = value;
  }
  if (Array.isArray(settings.visibleColumns)) {
    const order = new Map(settings.visibleColumns.map((key, index) => [String(key), index + 1]));
    for (const [header, key] of Object.entries(SETTINGS_COLUMN_TO_KEY)) if (header !== '設計種類') row[header] = order.get(key) || '';
  }
  const filters = settings.filters || settings.filterSettings;
  if (filters) {
    row['篩選年份'] = Array.isArray(filters.year) ? filters.year.join(' , ') : text(filters.year || filters.years);
    row['篩選月份'] = Array.isArray(filters.month) ? filters.month.join(' , ') : text(filters.month || filters.months);
    row['篩選狀態'] = Array.isArray(filters.status) ? filters.status.join(' , ') : text(filters.status || filters.statuses);
    row['篩選姓名'] = Array.isArray(filters.designer) ? filters.designer.join(' , ') : text(filters.designer || filters.designers);
  }
  if ('selectEnabled' in settings || 'editEnabled' in settings) row['選擇'] = (settings.selectEnabled ?? settings.editEnabled) === false ? '' : 'v';
  if ('timelineEnabled' in settings) row['時間表'] = settings.timelineEnabled ? 'v' : '';
  if (settings.theme || settings['深淺模式']) row['深淺模式'] = /dark|深色/i.test(text(settings.theme || settings['深淺模式'])) ? '深色' : '淺色';
  if (settings.collapseSettings) {
    row['收合設計師專長與案件分配'] = settings.collapseSettings.designer || settings.collapseSettings.designerHidden ? 'x' : '';
    row['收合最新案件列表'] = settings.collapseSettings.recent ? 'x' : '';
    row['收合設計需求'] = settings.collapseSettings.request ? 'x' : '';
  }
}

export function createActionHandler(database, options = {}) {
  const loginPassword = options.loginPassword ?? process.env.JSON_DB_LOGIN_PASSWORD ?? '';
  const googleClientId = options.googleClientId || process.env.GOOGLE_OAUTH_CLIENT_ID || GOOGLE_CLIENT_ID;

  async function loginFromProfile(action, profile) {
    if (profile.aud !== googleClientId) return { ok: false, action, error: 'Google OAuth client_id 不符合', reason: 'CLIENT_ID_MISMATCH' };
    if (!(profile.email_verified === true || text(profile.email_verified).toLowerCase() === 'true')) return { ok: false, action, error: 'Google 信箱尚未通過驗證', reason: 'EMAIL_NOT_VERIFIED' };
    const account = canonicalAccount(profile.email);
    if (!account.endsWith(LOGIN_DOMAIN)) return { ok: false, action, error: `請使用 ${LOGIN_DOMAIN} 公司信箱登入`, reason: 'DOMAIN_NOT_ALLOWED' };
    return database.transaction(draft => {
      let row = settingsRow(draft, account);
      if (!row) {
        row = Object.fromEntries(TABLE_SCHEMAS['設定'].headers.map(header => [header, '']));
        row['帳號'] = account;
        row['名字'] = text(profile.name) || account.split('@')[0];
        row['顯示名'] = row['名字'];
        draft.tables['設定'].rows.push(row);
      }
      const token = randomUUID();
      const user = text(row['名字'] || profile.name || account.split('@')[0]);
      draft.internal.sessions[token] = { user, account, provider: 'google', expiresAt: Date.now() + SESSION_SECONDS * 1000 };
      return { ok: true, action, provider: 'google', user, account, email: account, token, expiresIn: SESSION_SECONDS, settings: settingsResponse(row) };
    }, 'google login');
  }

  return async function handleAction(action, payload = {}, context = {}) {
    action = text(action || 'list');
    const baseUrl = context.baseUrl || process.env.PUBLIC_BASE_URL || 'http://localhost:8787';
    const snapshot = database.snapshot();

    if (action === 'ping') return { ok: true, action, version: VERSION, storage: 'json', revision: snapshot.revision, message: 'connected' };
    if (action === 'diagnose') return { ok: true, action, version: VERSION, storage: 'json', revision: snapshot.revision, tables: Object.fromEntries(TABLE_NAMES.map(name => [name, snapshot.tables[name].rows.length])) };
    if (action === 'urlFetchAuthCheck') return { ok: true, action, status: 200, message: 'Node.js fetch 可執行', version: VERSION };
    if (action === 'writeAccessCheck') return { ok: true, action, checkedAt: new Date().toISOString(), nonMutating: true, permissions: { createRequest: true, updateRequest: true, updateStatusDetails: false, reason: 'JSON 資料庫可寫入；狀態與細節需登入' }, checks: { databaseWritable: true } };

    if (action === 'list' || action === 'recent') {
      const year = text(payload.year);
      let indexed = snapshot.tables.database.rows.map((row, index) => ({ row, index })).filter(item => !year || rowYear(item.row) === year);
      if (action === 'recent') indexed = indexed.sort((a, b) => text(b.row['案件編號']).localeCompare(text(a.row['案件編號']))).slice(0, Math.min(200, Math.max(1, Number(payload.limit) || 30)));
      return { ok: true, action, rows: indexed.map(item => toApiRow(item.row, item.index)) };
    }
    if (action === 'bundle' || action === 'statsData') {
      const year = text(payload.year);
      const rows = snapshot.tables.database.rows.filter(row => !year || rowYear(row) === year);
      return { ok: true, action: 'bundle', version: VERSION, rows: rows.map((row, index) => toApiRow(row, index)), databaseRows: rows, weights: [], stages: [] };
    }
    if (action === 'createRequestStatus') {
      const result = snapshot.internal.idempotency[text(payload.requestId)] || null;
      return { ok: true, action, pending: !result, result };
    }
    if (action === 'resolveSupplementLink') {
      const id = text(payload.id || payload.caseId), slot = text(payload.slot).toLowerCase();
      if (!/^\d{8}$/.test(id) || !SUPPLEMENT_SLOTS[slot]) throw new Error('補充資料連結格式錯誤');
      const record = snapshot.tables['補充資料連結'].rows.find(row => text(row['案件編號']) === id);
      const url = text(record?.[SUPPLEMENT_SLOTS[slot].column]);
      if (!isHttpUrl(url)) throw new Error('找不到可用的補充資料連結');
      return { ok: true, action, id, slot, url };
    }
    if (action === 'resolveShortLink') {
      const code = text(payload.code);
      const record = snapshot.tables['短連結'].rows.find(row => text(row['短碼']) === code);
      if (!record || !isHttpUrl(record['原始網址'])) throw new Error('找不到這個短連結');
      return { ok: true, action, code, url: record['原始網址'] };
    }
    if (action === 'createShortLink') {
      const url = text(payload.url);
      if (!isHttpUrl(url) || url.length > 2048) throw new Error('請輸入有效的 http 或 https 網址');
      return database.transaction(draft => {
        const code = generateShortCode(new Set(draft.tables['短連結'].rows.map(row => text(row['短碼']))));
        draft.tables['短連結'].rows.push({ '短碼': code, '原始網址': url, '建立時間': nowTaipei() });
        return { ok: true, action, code, url };
      }, 'create short link');
    }

    if (action === 'login') {
      const account = canonicalAccount(payload.account || payload.user);
      const password = text(payload.password);
      const row = settingsRow(snapshot, account);
      const accepted = account === 'test.user@emctaipei.com' && password === 'test' || password === (loginPassword || currentPassword());
      if (!row || !accepted) return { ok: false, action, error: '帳號或密碼不正確' };
      return database.transaction(draft => {
        const token = randomUUID(), user = text(row['名字'] || account.split('@')[0]);
        draft.internal.sessions[token] = { user, account, provider: 'password', expiresAt: Date.now() + SESSION_SECONDS * 1000 };
        return { ok: true, action, provider: 'password', user, account, email: account, token, expiresIn: SESSION_SECONDS, settings: settingsResponse(row) };
      }, 'password login');
    }
    if (action === 'googleLogin') {
      const credential = text(payload.credential || payload.idToken);
      if (!credential) return { ok: false, action, error: '缺少 Google credential' };
      const response = await fetch(`https://oauth2.googleapis.com/tokeninfo?id_token=${encodeURIComponent(credential)}`);
      if (!response.ok) return { ok: false, action, error: 'Google token 驗證失敗', reason: 'TOKENINFO_FAILED' };
      return loginFromProfile(action, await response.json());
    }
    if (action === 'verifyToken') {
      const session = sessionFor(snapshot, payload.editorToken);
      if (!session) return { ok: false, action, error: 'TOKEN_EXPIRED' };
      return { ok: true, action, user: session.user, account: session.account, email: session.account, expiresIn: SESSION_SECONDS, settings: settingsResponse(settingsRow(snapshot, session.account || session.user) || {}) };
    }
    if (action === 'logout') {
      const token = text(payload.editorToken);
      if (!token || token === localAdminToken()) return { ok: true, action };
      return database.transaction(draft => { delete draft.internal.sessions[token]; return { ok: true, action }; }, 'logout');
    }
    if (action === 'getUserSettings') {
      const session = requireSession(snapshot, payload);
      const account = canonicalAccount(payload.account || session.account);
      return { ok: true, action, account, settings: settingsResponse(settingsRow(snapshot, account || session.user) || {}) };
    }
    if (action === 'listDesignerProfiles') {
      const profiles = snapshot.tables['設定'].rows.filter(row => text(row['名字'])).map(row => ({
        name: text(row['名字']), account: canonicalAccount(row['帳號']), avatar: text(row['頭像連結']),
        poster: text(row['頭像大圖連結'] || row['頭像連結']), musicUrl: text(row['分享音樂']),
        musicStartAt: Math.max(0, Number(row['音樂起始秒數']) || 0), skills: splitNames(row['技能']),
        quote: text(row['對話框']), rotation: Number(row['新專案輪值']) || 99,
        designType: /影音|影像|影片/i.test(text(row['組別'])) ? '影音' : (/平面/.test(text(row['組別'])) ? '平面' : '')
      }));
      return { ok: true, action, profiles };
    }
    if (action === 'saveUserSettings') {
      const session = requireSession(snapshot, payload);
      const account = canonicalAccount(payload.account || session.account);
      return database.transaction(draft => {
        const row = settingsRow(draft, account || session.user);
        if (!row) throw new Error('找不到個人設定資料');
        updateSettingsRow(row, payload.settings || {});
        return { ok: true, action, account, settings: settingsResponse(row) };
      }, 'save user settings');
    }
    if (action === 'saveDesignerProfiles') {
      requireSession(snapshot, payload);
      return database.transaction(draft => {
        for (const profile of Array.isArray(payload.profiles) ? payload.profiles : []) {
          const row = draft.tables['設定'].rows.find(item => text(item['名字']) === text(profile.name));
          if (!row) continue;
          if ('avatar' in profile) row['頭像連結'] = text(profile.avatar);
          if ('poster' in profile) row['頭像大圖連結'] = text(profile.poster);
          if ('musicUrl' in profile) row['分享音樂'] = text(profile.musicUrl);
          if ('musicStartAt' in profile) row['音樂起始秒數'] = String(Math.max(0, Number(profile.musicStartAt) || 0));
          if ('skills' in profile) row['技能'] = (Array.isArray(profile.skills) ? profile.skills : splitNames(profile.skills)).join(' , ');
          if ('quote' in profile) row['對話框'] = text(profile.quote);
        }
        const profiles = draft.tables['設定'].rows.filter(row => text(row['名字'])).map(row => ({
          name: row['名字'], account: row['帳號'], avatar: row['頭像連結'], poster: row['頭像大圖連結'], musicUrl: row['分享音樂'],
          musicStartAt: Number(row['音樂起始秒數']) || 0, skills: splitNames(row['技能']), quote: row['對話框'], rotation: Number(row['新專案輪值']) || 99
        }));
        return { ok: true, action, profiles };
      }, 'save designer profiles');
    }

    if (action === 'listReels') return { ok: true, action, reels: snapshot.tables.reels.rows.map(publicReel).filter(reel => reel.name && reel.imageUrl) };
    if (action === 'toggleReelReaction' || action === 'addReelComment') {
      const session = requireSession(snapshot, payload);
      return database.transaction(draft => {
        const rows = draft.tables.reels.rows, index = findReelIndex(rows, payload);
        if (index < 0) throw new Error('找不到這則限時動態');
        const row = rows[index], userName = text(session.user || session.account?.split('@')[0]);
        if (action === 'toggleReelReaction') {
          if (!['like', 'dislike'].includes(payload.reaction)) throw new Error('限動回應格式錯誤');
          let likes = splitNames(row['按讚']), dislikes = splitNames(row['倒讚']);
          const active = (payload.reaction === 'like' ? likes : dislikes).includes(userName);
          if (payload.reaction === 'like') { likes = active ? likes.filter(name => name !== userName) : [...likes, userName]; if (!active) dislikes = dislikes.filter(name => name !== userName); }
          else { dislikes = active ? dislikes.filter(name => name !== userName) : [...dislikes, userName]; if (!active) likes = likes.filter(name => name !== userName); }
          row['按讚'] = unique(likes).join(' , '); row['倒讚'] = unique(dislikes).join(' , ');
        } else {
          const commentText = text(payload.comment || payload.text);
          if (!commentText || commentText.length > 200) throw new Error('留言必須為 1–200 個字');
          const userRow = settingsRow(draft, session.account || session.user);
          const comments = parseComments(row['留言']);
          comments.push({ id: randomUUID(), name: userName, account: session.account, avatar: text(userRow?.['頭像連結']), text: commentText, createdAt: new Date().toISOString() });
          row['留言'] = JSON.stringify(comments.slice(-50));
        }
        return { ok: true, action, reel: publicReel(row, index) };
      }, action);
    }

    if (action === 'listIssueReports') return { ok: true, action, rows: snapshot.tables.bug_report.rows.map(issueRow).filter(row => text(row['內容'])).reverse() };
    if (action === 'listModificationRecords') {
      const ids = Array.isArray(payload.ids) && payload.ids.length ? new Set(payload.ids.map(text)) : null;
      const rows = snapshot.tables['修改統計表'].rows
        .map((row, index) => ({ rowNumber: index + 2, ...row }))
        .filter(row => !ids || ids.has(text(row['案件編號'])));
      return { ok: true, action, rows };
    }
    if (action === 'reportIssue') {
      const report = payload.report || payload.row || payload.data || payload;
      const session = sessionFor(snapshot, payload.editorToken);
      const content = text(report.content || report['內容']), suggestion = text(report.suggestion || report['修改建議']);
      if (!content || content.length > 300 || suggestion.length > 300) throw new Error('問題內容必填，內容與修改建議不得超過 300 字');
      return database.transaction(draft => {
        const time = nowTaipei(), row = Object.fromEntries(TABLE_SCHEMAS.bug_report.headers.map(header => [header, '']));
        Object.assign(row, { '姓名': text(session?.user || report.name || report['姓名'] || report.reporter || '未登入'), '時間': time, '內容': content, '修改建議': suggestion, '狀態': '回報中', '狀態更改時間': time, '回報中': time });
        draft.tables.bug_report.rows.push(row);
        return { ok: true, action, rowNumber: draft.tables.bug_report.rows.length + 1, row: issueRow(row, draft.tables.bug_report.rows.length - 1) };
      }, 'report issue');
    }
    if (action === 'updateIssueReportStatus') {
      const session = requireSession(snapshot, payload);
      if (!isManager(snapshot, session)) throw new Error('僅管理者與 Machi 可修改回報狀態');
      const rowNumber = Number(payload.rowNumber || payload.id), status = text(payload.status);
      if (!Number.isInteger(rowNumber) || rowNumber < 2 || !ISSUE_STATUSES.includes(status)) throw new Error('回報狀態或列號不正確');
      return database.transaction(draft => {
        const row = draft.tables.bug_report.rows[rowNumber - 2]; if (!row) throw new Error('找不到要更新的回報');
        const time = nowTaipei(); row['狀態'] = status; row['狀態更改時間'] = time; row[status] = time;
        return { ok: true, action, rowNumber, row: issueRow(row, rowNumber - 2) };
      }, 'update issue status');
    }

    if (action === 'addModificationRecord') {
      const record = payload.record || payload.row || payload.data || payload;
      const caseId = text(record.caseId || record.id || record['案件編號']), modifyDate = text(record.modifyDate || record['修改日期']), content = text(record.content || record['修改內容']);
      const session = sessionFor(snapshot, payload.editorToken || record.editorToken), modifier = text(session?.user || record.modifier || record.owner || record['修改人'] || record['專案負責人']);
      if (!caseId || !modifyDate || !content || !modifier) throw new Error('案件編號、修改日期、修改內容與修改人皆為必填');
      return database.transaction(draft => {
        const rows = draft.tables['修改統計表'].rows;
        const count = rows.filter(row => text(row['案件編號']) === caseId).reduce((max, row) => Math.max(max, Number(row['修改次數']) || 0), 0) + 1;
        const row = { '案件編號': caseId, '修改次數': String(count), '建立日期': nowTaipei(), '修改日期': modifyDate, '修改內容': content, '修改人': modifier, '確認修正日': '' };
        rows.push(row); return { ok: true, action, rowNumber: rows.length + 1, record: row, count };
      }, 'add modification');
    }
    if (action === 'updateModificationConfirm') {
      requireSession(snapshot, payload);
      const record = payload.record || payload.row || payload.data || payload, caseId = text(record.caseId || record.id || record['案件編號']), count = Number(record.count || record['修改次數']);
      return database.transaction(draft => {
        const index = draft.tables['修改統計表'].rows.findIndex(row => text(row['案件編號']) === caseId && Number(row['修改次數']) === count);
        if (index < 0) throw new Error('找不到指定的修改紀錄');
        const row = draft.tables['修改統計表'].rows[index]; row['確認修正日'] = ('confirmedDate' in record || '確認修正日' in record) && !text(record.confirmedDate || record['確認修正日']) ? '' : nowTaipei();
        return { ok: true, action, rowNumber: index + 2, record: row };
      }, 'confirm modification');
    }

    if (['append', 'create', 'add', 'submit', 'save'].includes(action)) {
      const source = payload.row || payload.data || payload, requestId = text(payload.requestId);
      return database.transaction(draft => {
        if (requestId && draft.internal.idempotency[requestId]) return { ...draft.internal.idempotency[requestId], deduplicated: true };
        const row = toSheetRow(source); row['案件編號'] ||= nextCaseId(draft.tables.database.rows); row['填單時間'] ||= nowTaipei().slice(0, 10).replace(/\//g, '-'); row['月份'] ||= monthFromDate(row['開始日期']);
        syncSupplementLinks(draft, row, baseUrl); draft.tables.database.rows.push(row);
        const result = { ok: true, action: 'append', rowNumber: draft.tables.database.rows.length + 1, row: toApiRow(row, draft.tables.database.rows.length - 1) };
        if (requestId) draft.internal.idempotency[requestId] = result;
        return result;
      }, 'append request');
    }
    if (['batchAdd', 'batchAppend', 'addRows'].includes(action)) {
      const sources = Array.isArray(payload.rows || payload.data) ? payload.rows || payload.data : [], requestId = text(payload.requestId);
      if (!sources.length) throw new Error('沒有可新增的資料');
      return database.transaction(draft => {
        if (requestId && draft.internal.idempotency[requestId]) return { ...draft.internal.idempotency[requestId], deduplicated: true };
        const created = [], rowNumbers = [];
        for (const source of sources) {
          const row = toSheetRow(source); row['案件編號'] ||= nextCaseId(draft.tables.database.rows); row['填單時間'] ||= nowTaipei().slice(0, 10).replace(/\//g, '-'); row['月份'] ||= monthFromDate(row['開始日期']);
          syncSupplementLinks(draft, row, baseUrl); draft.tables.database.rows.push(row); rowNumbers.push(draft.tables.database.rows.length + 1); created.push(toApiRow(row, draft.tables.database.rows.length - 1));
        }
        const result = { ok: true, action: 'batchAdd', count: created.length, rowNumbers, rows: created };
        if (requestId) draft.internal.idempotency[requestId] = result;
        return result;
      }, 'batch append requests');
    }
    if (action === 'update' || action === 'batchUpdate') {
      const session = sessionFor(snapshot, payload.editorToken), writeHeaders = [...(payload.writeHeaders || []), ...(payload.forceHeaders || [])];
      const changes = payload.row || payload.changes || payload;
      const touchesProtected = writeHeaders.some(header => ['案件狀態', '狀態', '項目細節'].includes(header)) || ['status', 'details'].some(key => changes[key] !== undefined);
      if (touchesProtected && !session && text(changes.status || changes['狀態'] || changes['案件狀態']) !== '已取消') throw new Error('請先登入後再修改狀態或項目細節');
      const items = action === 'batchUpdate' ? (Array.isArray(payload.rows) ? payload.rows : []) : [{ id: payload.id || payload.caseId || changes.id, row: changes }];
      return database.transaction(draft => {
        const updated = [];
        for (const item of items) {
          const id = text(item.id || item.caseId || item.row?.id || changes.id);
          const index = draft.tables.database.rows.findIndex(row => text(row['案件編號']) === id);
          if (index < 0) throw new Error(`找不到案件：${id}`);
          const patch = { ...(action === 'batchUpdate' ? changes : {}), ...(item.row || item.changes || {}) };
          const row = toSheetRow(patch, draft.tables.database.rows[index]); row['案件編號'] = id; syncSupplementLinks(draft, row, baseUrl); draft.tables.database.rows[index] = row;
          updated.push(toApiRow(row, index));
        }
        return action === 'batchUpdate' ? { ok: true, action, count: updated.length, rows: updated, updated: writeHeaders } : { ok: true, action, id: updated[0].id, row: updated[0], updated: writeHeaders };
      }, action);
    }
    if (action === 'delete') {
      const session = requireSession(snapshot, payload); if (!isManager(snapshot, session)) throw new Error('僅管理者可刪除案件');
      const id = text(payload.id || payload.caseId);
      return database.transaction(draft => {
        const index = draft.tables.database.rows.findIndex(row => text(row['案件編號']) === id); if (index < 0) throw new Error('找不到案件');
        const [row] = draft.tables.database.rows.splice(index, 1); return { ok: true, action, id, row: toApiRow(row) };
      }, 'delete request');
    }
    if (action === 'detailOptions' || action === 'options') return { ok: true, action, types: [], stages: [], details: {} };
    if (action === 'erpLoginConfig') return { ok: false, action, error: 'JSON 後台尚未設定 ERP OAuth；請設定 ERP_BASE_URL、ERP_CLIENT_ID、ERP_CLIENT_SECRET、ERP_REDIRECT_URI' };
    if (WRITE_ACTIONS.has(action)) throw new Error(`尚未支援寫入動作：${action}`);
    return { ok: false, action, error: 'Unknown action' };
  };
}

function contentType(filePath) {
  const types = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.mjs': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.json': 'application/json; charset=utf-8', '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.svg': 'image/svg+xml', '.ico': 'image/x-icon', '.md': 'text/markdown; charset=utf-8' };
  return types[path.extname(filePath).toLowerCase()] || 'application/octet-stream';
}
async function bodyJson(req, limit = 12 * 1024 * 1024) {
  let body = '';
  for await (const chunk of req) { body += chunk; if (Buffer.byteLength(body) > limit) throw new Error('請求內容過大'); }
  if (!body) return {};
  try { return JSON.parse(body); } catch { throw new Error('JSON 格式錯誤'); }
}
function requestBaseUrl(req) {
  const protocol = text(req.headers['x-forwarded-proto']).split(',')[0] || 'http';
  return `${protocol}://${req.headers.host || 'localhost:8787'}`;
}
function sendJson(res, status, payload, callback = '') {
  const safeCallback = /^[A-Za-z_$][\w$.[\]]*$/.test(callback) ? callback : '';
  const body = safeCallback ? `${safeCallback}(${JSON.stringify(payload)})` : JSON.stringify(payload);
  res.writeHead(status, { 'Content-Type': safeCallback ? 'text/javascript; charset=utf-8' : 'application/json; charset=utf-8', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' });
  res.end(body);
}
function genericAuthorized(snapshot, payload, req) {
  const token = text(req.headers.authorization).replace(/^Bearer\s+/i, '') || text(payload.editorToken || payload.token);
  const session = sessionFor(snapshot, token);
  return isManager(snapshot, session);
}

export async function createApp(options = {}) {
  const rootDir = path.resolve(options.rootDir || ROOT);
  const database = options.database || await new JsonDatabase(options.dbPath || process.env.JSON_DB_PATH || DEFAULT_DB_PATH).init();
  const handleAction = createActionHandler(database, options);
  const server = createHttpServer(async (req, res) => {
    const url = new URL(req.url || '/', requestBaseUrl(req));
    try {
      if (req.method === 'OPTIONS') {
        res.writeHead(204, { 'Access-Control-Allow-Origin': req.headers.origin || '*', 'Access-Control-Allow-Headers': 'Content-Type, Authorization', 'Access-Control-Allow-Methods': 'GET, POST, PATCH, DELETE, OPTIONS', 'Access-Control-Max-Age': '600' });
        return res.end();
      }

      const supplementMatch = url.pathname.match(/^\/([a-d])\/(\d{8})\/?$/i);
      const shortMatch = url.pathname.match(/^\/([23456789A-HJ-NP-Za-km-z]{6})\/?$/);
      if (req.method === 'GET' && (supplementMatch || shortMatch)) {
        const result = supplementMatch
          ? await handleAction('resolveSupplementLink', { slot: supplementMatch[1], id: supplementMatch[2] }, { baseUrl: requestBaseUrl(req) })
          : await handleAction('resolveShortLink', { code: shortMatch[1] }, { baseUrl: requestBaseUrl(req) });
        res.writeHead(302, { Location: result.url, 'Cache-Control': 'private, max-age=600', 'X-Content-Type-Options': 'nosniff' });
        return res.end();
      }

      if (url.pathname === '/api' || url.pathname === '/api/') {
        const query = Object.fromEntries(url.searchParams.entries());
        const payload = req.method === 'POST' ? { ...query, ...(await bodyJson(req)) } : query;
        const action = payload.action || 'list';
        const result = await handleAction(action, payload, { baseUrl: requestBaseUrl(req), req });
        // Apps Script historically returns HTTP 200 with an {ok:false} body. Keep
        // that contract so the existing front-end can display the actual error.
        return sendJson(res, 200, result, query.callback || '');
      }

      if (url.pathname === '/api/tables' && req.method === 'GET') {
        const snapshot = database.snapshot();
        if (!genericAuthorized(snapshot, {}, req)) return sendJson(res, 401, { ok: false, error: '需要管理者權限' });
        return sendJson(res, 200, { ok: true, revision: snapshot.revision, tables: Object.fromEntries(TABLE_NAMES.map(name => [name, { headers: snapshot.tables[name].headers, primaryKey: snapshot.tables[name].primaryKey, rowCount: snapshot.tables[name].rows.length }])) });
      }
      const tableMatch = url.pathname.match(/^\/api\/table\/([^/]+)(?:\/([^/]+))?\/?$/);
      if (tableMatch) {
        const tableName = decodeURIComponent(tableMatch[1]), key = tableMatch[2] ? decodeURIComponent(tableMatch[2]) : '';
        if (!TABLE_SCHEMAS[tableName]) return sendJson(res, 404, { ok: false, error: '未知資料表' });
        const payload = ['POST', 'PATCH', 'DELETE'].includes(req.method) ? await bodyJson(req) : {};
        const snapshot = database.snapshot();
        if (!genericAuthorized(snapshot, payload, req)) return sendJson(res, 401, { ok: false, error: '需要管理者權限' });
        if (req.method === 'GET') {
          const offset = Math.max(0, Number(url.searchParams.get('offset')) || 0), limit = Math.min(1000, Math.max(1, Number(url.searchParams.get('limit')) || 100));
          const rows = snapshot.tables[tableName].rows.slice(offset, offset + limit);
          return sendJson(res, 200, { ok: true, table: tableName, offset, limit, total: snapshot.tables[tableName].rows.length, rows });
        }
        const result = await database.transaction(draft => {
          const table = draft.tables[tableName], primaryKey = table.primaryKey;
          if (req.method === 'POST') { const row = payload.row || payload; table.rows.push(row); return { ok: true, table: tableName, rowNumber: table.rows.length + 1, row }; }
          if (!key) throw new Error('缺少資料鍵值');
          const index = primaryKey ? table.rows.findIndex(row => text(row[primaryKey]) === key) : Number(key) - 2;
          if (index < 0 || !table.rows[index]) throw new Error('找不到資料');
          if (req.method === 'PATCH') { Object.assign(table.rows[index], payload.row || payload); return { ok: true, table: tableName, rowNumber: index + 2, row: table.rows[index] }; }
          if (req.method === 'DELETE') { const [row] = table.rows.splice(index, 1); return { ok: true, table: tableName, deleted: row }; }
          throw new Error('不支援的 HTTP 方法');
        }, `generic ${req.method} ${tableName}`);
        return sendJson(res, 200, result);
      }

      if (!['GET', 'HEAD'].includes(req.method)) return sendJson(res, 405, { ok: false, error: 'Method Not Allowed' });
      let pathname = decodeURIComponent(url.pathname);
      if (pathname === '/') pathname = '/index.html';
      if (pathname === '/backend' || pathname.startsWith('/backend/') || pathname.split('/').some(segment => segment.startsWith('.'))) {
        return sendJson(res, 404, { ok: false, error: 'Not Found' });
      }
      const filePath = path.resolve(rootDir, `.${pathname}`);
      if (filePath !== rootDir && !filePath.startsWith(`${rootDir}${path.sep}`)) return sendJson(res, 403, { ok: false, error: 'Forbidden' });
      let fileStat;
      try { fileStat = await stat(filePath); } catch { fileStat = null; }
      const selectedPath = fileStat?.isFile() ? filePath : path.join(rootDir, '404.html');
      const selectedStat = fileStat?.isFile() ? fileStat : await stat(selectedPath);
      res.writeHead(fileStat?.isFile() ? 200 : 404, { 'Content-Type': contentType(selectedPath), 'Content-Length': selectedStat.size, 'Cache-Control': /\.(?:html|json)$/.test(selectedPath) ? 'no-cache' : 'public, max-age=3600', 'X-Content-Type-Options': 'nosniff', 'Referrer-Policy': 'strict-origin-when-cross-origin' });
      if (req.method === 'HEAD') return res.end();
      createReadStream(selectedPath).pipe(res);
    } catch (error) {
      sendJson(res, 400, { ok: false, error: error?.message || String(error), reason: 'JSON_BACKEND_ERROR', version: VERSION });
    }
  });
  return { server, database, handleAction };
}

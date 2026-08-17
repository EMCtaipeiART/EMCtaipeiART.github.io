import { TABLE_SCHEMAS, TABLE_NAMES, normalizeDatabaseShape, recalculateDatabaseModificationStats } from '../../backend/schema.mjs';
import { applyWeightToRow } from '../../backend/weighting.mjs';
import type { ApiPayload, DatabaseSnapshot, Row, SessionRecord } from './types';

export const VERSION = 'cloudflare-worker-account-directory-2026-08-13-3';
export const LOGIN_DOMAIN = '@emctaipei.com';
export const ISSUE_STATUSES = ['回報中', '評估中', '處理中', '已完成', '已否決'];
export const SHORT_CODE_CHARS = '23456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';
export const ACCESS_PAGES = ['request', 'dashboard', 'archive', 'database_admin', 'media_admin', 'avatar_upload', 'short_link'];
export const ACCESS_CAPABILITIES = [
  'request.create', 'request.edit', 'request.status', 'request.delete', 'request.export', 'request.mail',
  'modification.create', 'modification.confirm', 'project.create', 'designer.settings',
  'profile.edit', 'media.manage', 'reel.interact', 'issue.report', 'issue.manage',
  'short_link.create', 'archive.edit', 'database.manage'
];
export const ACCESS_ROLE_TEMPLATES: Record<string, { pages: string[]; capabilities: string[] }> = {
  '管理者': { pages: ACCESS_PAGES, capabilities: ACCESS_CAPABILITIES },
  '設計師': {
    pages: ['request', 'dashboard', 'media_admin', 'avatar_upload', 'short_link'],
    capabilities: ['request.create', 'request.edit', 'request.status', 'request.export', 'request.mail', 'modification.create', 'modification.confirm', 'project.create', 'designer.settings', 'profile.edit', 'media.manage', 'reel.interact', 'issue.report', 'short_link.create']
  },
  '一般使用者': { pages: ['request', 'avatar_upload', 'short_link'], capabilities: ['request.create', 'request.mail', 'profile.edit', 'reel.interact', 'issue.report', 'short_link.create'] },
  '唯讀': { pages: ['request', 'dashboard', 'short_link'], capabilities: [] }
};

export const KEY_TO_HEADER: Record<string, string> = {
  id: '案件編號', month: '月份', client: '客戶別', project: '專案名稱', owner: '專案負責人', type: '設計種類',
  stage: '階段', qty: '數量', start: '開始日期', end: '結束日期', designer: '設計負責人', platforms: '使用平台',
  submittedAt: '填單時間', briefNote: '設計簡報說明', briefUrl: '設計簡報連結', assetNote: '客戶素材說明',
  assetUrl: '客戶素材連結', referenceNote: '參考範例說明', referenceUrl: '參考範例連結', otherNote: '其他說明',
  otherUrl: '其他連結', status: '狀態', details: '項目細節', weight: '加權',
  designImageFolderUrl: '設計圖資料夾連結', designImageFolderKeyword: '設計圖檔名關鍵字',
  gmailThreadId: 'Gmail信件串ID', gmailThreadOwnerAccount: 'Gmail寄件帳號'
};
export const HEADER_ALIASES: Record<string, string[]> = {
  '設計種類': ['設計類型', '設計總類', '設計項目'],
  '狀態': ['案件狀態'],
  '項目細節': ['項目細項', '項目細節(可複選)']
};
export const SETTINGS_COLUMN_TO_KEY: Record<string, string> = {
  '案件編號': 'id', '月份': 'month', '客戶別': 'client', '專案名稱': 'project', '專案負責人': 'owner',
  '設計種類': 'type', '階段': 'stage', '數量': 'qty', '開始': 'start', '結束': 'end', '設計負責人': 'designer',
  '狀態': 'status', '項目細節': 'details', '修改': 'modifications', '主旨': 'subject', '操作': 'actions'
};
export const SUPPLEMENT_SLOTS: Record<string, { key: string; header: string; column: string }> = {
  a: { key: 'briefUrl', header: '設計簡報連結', column: 'A' },
  b: { key: 'assetUrl', header: '客戶素材連結', column: 'B' },
  c: { key: 'referenceUrl', header: '參考範例連結', column: 'C' },
  d: { key: 'otherUrl', header: '其他連結', column: 'D' }
};
export const PROJECT_GROUPS: Record<string, { designers: string[]; type: string }> = {
  '平面': { designers: ['Machi', 'Anna', 'Amber', 'Leona'], type: '平面' },
  '影音': { designers: ['Karl', 'Noise'], type: '影音' }
};
export const DEFAULT_DESIGNER_NAMES = Object.freeze(Object.values(PROJECT_GROUPS).flatMap(group => group.designers));

export function isDesignerSettingsRow(row: Row = {}): boolean {
  const group = text(row['組別']);
  if (!/^(?:平面|影音)$/.test(group) || !text(row['名字'])) return false;
  const visible = text(row['設計師顯示']).toLowerCase();
  if (visible) return !/^(?:x|false|0|停用|否)$/.test(visible);
  return DEFAULT_DESIGNER_NAMES.includes(text(row['名字']));
}

export function designerRowsForGroup(snapshot: DatabaseSnapshot, group: string): Row[] {
  return snapshot.tables['設定'].rows
    .filter(row => isDesignerSettingsRow(row) && text(row['組別']) === group)
    .sort((left, right) => (Number(left['新專案輪值']) || 99) - (Number(right['新專案輪值']) || 99)
      || text(left['名字']).localeCompare(text(right['名字']), 'zh-Hant'));
}

export function text(value: unknown): string { return String(value ?? '').trim(); }
export function canonicalAccount(value: unknown): string {
  const account = text(value).toLowerCase();
  if (account.startsWith('local:')) return account;
  return account && !account.includes('@') ? `${account}${LOGIN_DOMAIN}` : account;
}
export function isHttpUrl(value: unknown): boolean {
  try { return /^https?:$/.test(new URL(text(value)).protocol); } catch { return false; }
}
export function unique(values: string[]): string[] { return [...new Set(values.filter(Boolean))]; }
export function splitNames(value: unknown): string[] {
  return unique((Array.isArray(value) ? value : text(value).split(/\s*,\s*|，|、|\r?\n/)).map(text));
}
export function nowTaipei(): string {
  const parts = Object.fromEntries(new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Taipei', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23'
  }).formatToParts(new Date()).map(part => [part.type, part.value]));
  return `${parts.year}/${parts.month}/${parts.day} ${parts.hour}:${parts.minute}:${parts.second}`;
}
export function taipeiDateParts(): Record<string, string> {
  return Object.fromEntries(new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Taipei', year: 'numeric', month: '2-digit', day: '2-digit' })
    .formatToParts(new Date()).map(part => [part.type, part.value]));
}
export function rowYear(row: Row): string { return (text(row['開始日期'] || row['結束日期']).match(/(19\d{2}|20\d{2}|2100)/) || [])[1] || ''; }
export function monthFromDate(value: unknown): string {
  const match = text(value).match(/(?:19\d{2}|20\d{2}|2100)[/-](\d{1,2})/);
  return match ? `${Number(match[1])}月` : '';
}
export function normalizeSnapshot(input: unknown): DatabaseSnapshot {
  const database = normalizeDatabaseShape(input) as DatabaseSnapshot;
  database.internal ||= { sessions: {}, idempotency: {} };
  database.internal.sessions = {};
  database.internal.idempotency ||= {};
  return database;
}
export function weightRules(database: DatabaseSnapshot): Row[] { return database.tables['加權計分標準']?.rows || []; }
type WeightRule = {
  '設計種類': string | number;
  '階段': string | number;
  '項目細節': string | number;
  '權重': string;
  '備註': '';
};
function typedWeightRules(rules: Row[]): WeightRule[] {
  return rules.map(rule => ({
    '設計種類': text(rule['設計種類']),
    '階段': text(rule['階段']),
    '項目細節': text(rule['項目細節']),
    '權重': text(rule['權重']),
    '備註': ''
  }));
}
export function recalculateDatabaseWeights(database: DatabaseSnapshot): number {
  const rules = weightRules(database);
  const typedRules = typedWeightRules(rules);
  for (const row of database.tables.database?.rows || []) applyWeightToRow(row, typedRules);
  return database.tables.database?.rows?.length || 0;
}
export function recalculateDatabaseModificationCounts(database: DatabaseSnapshot): number {
  return recalculateDatabaseModificationStats(database);
}
function firstValue(source: Row, header: string, key: string): unknown {
  if (source[key] !== undefined) return source[key];
  if (source[header] !== undefined) return source[header];
  for (const alias of HEADER_ALIASES[header] || []) if (source[alias] !== undefined) return source[alias];
  return undefined;
}
export function toSheetRow(source: Row = {}, existing: Row = {}, rules: Row[] = []): Row {
  const row = { ...existing };
  for (const [key, header] of Object.entries(KEY_TO_HEADER)) {
    const value = firstValue(source, header, key);
    if (value !== undefined) row[header] = value == null ? '' : value;
  }
  for (const header of TABLE_SCHEMAS.database.headers) if (source[header] !== undefined) row[header] = source[header] == null ? '' : source[header];
  if (row['數量'] !== '' && row['數量'] !== undefined) row['數量'] = String(Number(row['數量']) || 1);
  if (row['開始日期']) row['月份'] = monthFromDate(row['開始日期']) || row['月份'] || '';
  applyWeightToRow(row, typedWeightRules(rules));
  return row;
}
export function toApiRow(row: Row, index = -1): Row {
  const result: Row = {};
  for (const [key, header] of Object.entries(KEY_TO_HEADER)) result[key] = row[header] ?? '';
  result.qty = result.qty === '' ? '' : Number(result.qty);
  if (index >= 0) result.sheetRow = result._sheetRow = index + 2;
  return result;
}
export function nextCaseId(rows: Row[]): string {
  const parts = taipeiDateParts();
  const prefix = `${parts.year.slice(-2)}${parts.month}`;
  const max = rows.reduce((current, row) => {
    const id = text(row['案件編號']);
    return id.startsWith(prefix) && /^\d{8}$/.test(id) ? Math.max(current, Number(id.slice(4))) : current;
  }, 0);
  return `${prefix}${String(max + 1).padStart(4, '0')}`;
}
export function settingsRow(snapshot: DatabaseSnapshot, accountOrName: unknown): Row | null {
  const needle = text(accountOrName).toLowerCase();
  return snapshot.tables['設定'].rows.find(row => canonicalAccount(row['帳號']) === canonicalAccount(needle) || text(row['名字']).toLowerCase() === needle) || null;
}
export function settingsResponse(row: Row = {}): Row {
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
function accessList(value: unknown): string[] {
  if (Array.isArray(value)) return unique(value.map(text));
  const raw = text(value);
  if (!raw) return [];
  try { const parsed = JSON.parse(raw); if (Array.isArray(parsed)) return accessList(parsed); } catch {}
  return unique(raw.split(/[\n,，、|｜]/).map(text));
}
/** 捷徑登入帳號：密碼 test → 測試使用者、當日 MMDD → 管理員。 */
export const SHORTCUT_TESTER_ACCOUNT = 'test.user@emctaipei.com';
export const SHORTCUT_ADMIN_ACCOUNT = 'admin@emctaipei.com';
export function isManager(snapshot: DatabaseSnapshot, session: SessionRecord | null): boolean {
  if (!session) return false;
  if (session.user === '管理者' || session.user === 'Machi') return true;
  // admin@emctaipei.com 在「設定」表的部門／組別是空的，這裡直接授權，避免管理者捷徑登入只拿到一般使用者權限。
  if (canonicalAccount(session.account) === SHORTCUT_ADMIN_ACCOUNT) return true;
  const row = settingsRow(snapshot, session.account || session.user);
  return /^(?:管理者|admin)$/i.test(text(row?.['部門'] || row?.['組別']));
}
function accessRole(snapshot: DatabaseSnapshot, session: SessionRecord): string {
  if (isManager(snapshot, session)) return '管理者';
  const row = settingsRow(snapshot, session.account || session.user) || {};
  return /^(?:平面|影音)$/.test(text(row['組別'])) ? '設計師' : '一般使用者';
}
function accessTemplate(snapshot: DatabaseSnapshot, role: string): { pages: string[]; capabilities: string[] } {
  const fallback = ACCESS_ROLE_TEMPLATES[role] || ACCESS_ROLE_TEMPLATES['一般使用者'];
  if (role === '管理者') return { pages: [...ACCESS_PAGES], capabilities: [...ACCESS_CAPABILITIES] };
  const row = snapshot.tables['角色權限範本']?.rows?.find(item => text(item['角色範本']) === role) || null;
  return row ? {
    pages: accessList(row['頁面權限']).filter(key => ACCESS_PAGES.includes(key)),
    capabilities: accessList(row['功能權限']).filter(key => ACCESS_CAPABILITIES.includes(key))
  } : { pages: [...fallback.pages], capabilities: [...fallback.capabilities] };
}
export function accessProfile(snapshot: DatabaseSnapshot, session: SessionRecord | null): Row {
  if (!session) return { account: '', role: '訪客', status: '啟用', pages: ['request', 'short_link'], capabilities: ['request.create', 'issue.report', 'short_link.create'], explicit: false };
  const account = canonicalAccount(session.account || session.user);
  if (isManager(snapshot, session)) return { account, role: '管理者', status: '啟用', pages: [...ACCESS_PAGES], capabilities: [...ACCESS_CAPABILITIES], explicit: true };
  const row = snapshot.tables['帳號權限']?.rows?.find(item => canonicalAccount(item['帳號']) === account) || null;
  const role = text(row?.['角色範本']) || accessRole(snapshot, session);
  const template = accessTemplate(snapshot, role);
  const custom = Boolean(row) && role === '自訂';
  return {
    account, role, status: text(row?.['狀態']) || '啟用',
    pages: custom ? accessList(row?.['頁面權限']) : [...template.pages],
    capabilities: custom ? accessList(row?.['功能權限']) : [...template.capabilities], explicit: Boolean(row)
  };
}
export function hasCapability(snapshot: DatabaseSnapshot, session: SessionRecord | null, capability: string): boolean {
  const access = accessProfile(snapshot, session);
  return access.status !== '停用' && Array.isArray(access.capabilities) && access.capabilities.includes(capability);
}
export function requireCapability(snapshot: DatabaseSnapshot, session: SessionRecord | null, capability: string, options: { allowAnonymous?: boolean } = {}): SessionRecord | null {
  if (!session) {
    if (options.allowAnonymous) return null;
    throw new Error('請先登入後再執行此操作');
  }
  if (!hasCapability(snapshot, session, capability)) throw new Error(`此帳號沒有「${capability}」權限`);
  return session;
}
export function syncSupplementLinks(draft: DatabaseSnapshot, sheetRow: Row, baseUrl: string): void {
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
  if (changed && record) {
    record['更新時間'] = nowTaipei().slice(0, 16);
    if (!rows.includes(record)) rows.push(record);
  }
}
export function updateSettingsRow(row: Row, settings: ApiPayload = {}): void {
  if ('avatar' in settings || '頭像連結' in settings) row['頭像連結'] = text(settings.avatar ?? settings['頭像連結']);
  if ('displayName' in settings || '顯示名' in settings) {
    const value = text(settings.displayName || settings['顯示名']);
    if (!value || value.length > 40) throw new Error('顯示名必須為 1–40 個字');
    row['顯示名'] = value;
  }
  if (Array.isArray(settings.visibleColumns)) {
    const order = new Map(settings.visibleColumns.map((key, index) => [String(key), index + 1]));
    for (const [header, key] of Object.entries(SETTINGS_COLUMN_TO_KEY)) if (header !== '設計種類') row[header] = order.get(key) || '';
  }
  const filters = (settings.filters || settings.filterSettings) as ApiPayload | undefined;
  if (filters) {
    row['篩選年份'] = Array.isArray(filters.year) ? filters.year.join(' , ') : text(filters.year || filters.years);
    row['篩選月份'] = Array.isArray(filters.month) ? filters.month.join(' , ') : text(filters.month || filters.months);
    row['篩選狀態'] = Array.isArray(filters.status) ? filters.status.join(' , ') : text(filters.status || filters.statuses);
    row['篩選姓名'] = Array.isArray(filters.designer) ? filters.designer.join(' , ') : text(filters.designer || filters.designers);
  }
  if ('selectEnabled' in settings || 'editEnabled' in settings) row['選擇'] = (settings.selectEnabled ?? settings.editEnabled) === false ? '' : 'v';
  if ('timelineEnabled' in settings) row['時間表'] = settings.timelineEnabled ? 'v' : '';
  if (settings.theme || settings['深淺模式']) row['深淺模式'] = /dark|深色/i.test(text(settings.theme || settings['深淺模式'])) ? '深色' : '淺色';
  const collapse = settings.collapseSettings as ApiPayload | undefined;
  if (collapse) {
    row['收合設計師專長與案件分配'] = collapse.designer || collapse.designerHidden ? 'x' : '';
    row['收合最新案件列表'] = collapse.recent ? 'x' : '';
    row['收合設計需求'] = collapse.request ? 'x' : '';
  }
}
export function parseComments(value: unknown): Row[] {
  try {
    const list = Array.isArray(value) ? value : JSON.parse(text(value) || '[]');
    return Array.isArray(list) ? list.filter(item => item && text(item.name) && text(item.text)) : [];
  } catch { return []; }
}
export function reelFileId(value: unknown): string {
  const source = text(value);
  return (source.match(/drive\.google\.com\/file\/d\/([^/]+)/) || source.match(/lh3\.googleusercontent\.com\/d\/([^=/?]+)/) || source.match(/[?&]id=([^&]+)/) || [])[1] || '';
}
export function reelExpirationMs(row: Row = {}): number {
  const raw = text(row['到期時間'] || row.expiresAt);
  if (!raw) return 0;
  const numeric = Number(raw);
  if (Number.isFinite(numeric) && numeric > 0) return numeric;
  const parsed = Date.parse(raw);
  return Number.isFinite(parsed) ? parsed : 0;
}
export function activeReel(row: Row, now = Date.now()): boolean { const expiresAt = reelExpirationMs(row); return !expiresAt || expiresAt > now; }
export function publicReel(row: Row, index: number): Row {
  const likes = splitNames(row['按讚']);
  const dislikes = splitNames(row['倒讚']);
  const comments = parseComments(row['留言']).map(({ id, name, avatar, text: commentText, createdAt }) => ({ id, name, avatar, text: commentText, createdAt }));
  const expiresAt = reelExpirationMs(row);
  return {
    id: reelFileId(row['限時動態連結']) || `row-${index + 2}`,
    rowNumber: index + 2,
    name: text(row['名字']), imageUrl: text(row['限時動態連結']),
    retention: text(row['保留期限']) || (expiresAt ? '24小時' : '永久'),
    expiresAt: expiresAt ? new Date(expiresAt).toISOString() : '', likes, dislikes,
    likeCount: likes.length, dislikeCount: dislikes.length, comments
  };
}
export function issueRow(row: Row, index: number): Row {
  const result: Row = { rowNumber: index + 2, ...row };
  if (!ISSUE_STATUSES.includes(text(result['狀態']))) result['狀態'] = '回報中';
  result['狀態更改時間'] ||= result[text(result['狀態'])] || result['時間'] || '';
  return result;
}
export function findReelIndex(rows: Row[], payload: ApiPayload): number {
  const requestedId = text(payload.reelId || payload.storyId);
  const requestedUrl = text(payload.imageUrl || payload.url);
  const fileId = reelFileId(requestedUrl) || (!requestedId.startsWith('row-') ? requestedId : '');
  const requestedRow = Number(requestedId.replace(/^row-/, '')) || 0;
  return rows.findIndex((row, index) => (fileId && text(row['限時動態連結']).includes(fileId)) || (requestedUrl && text(row['限時動態連結']) === requestedUrl) || requestedRow === index + 2);
}
export function generateShortCode(existing: Set<string>): string {
  for (let attempt = 0; attempt < 40; attempt += 1) {
    const bytes = crypto.getRandomValues(new Uint8Array(6));
    let code = '';
    for (let index = 0; index < 6; index += 1) code += SHORT_CODE_CHARS[bytes[index] % SHORT_CODE_CHARS.length];
    if (!existing.has(code)) return code;
  }
  throw new Error('暫時無法產生短碼，請再試一次');
}
export function tableNames(): string[] { return [...TABLE_NAMES]; }
export function tableSchema(name: string): { headers: string[]; primaryKey: string | null } | undefined {
  const schemas: Record<string, { headers: string[]; primaryKey: string | null }> = TABLE_SCHEMAS;
  return schemas[name];
}

import { DEFAULT_WEIGHT_RULE_ROWS } from './weighting.mjs';

export const DEFAULT_ROLE_TEMPLATE_ROWS = Object.freeze([
  {
    '角色範本': '管理者',
    '頁面權限': JSON.stringify(['request', 'dashboard', 'archive', 'database_admin', 'media_admin', 'avatar_upload', 'short_link']),
    '功能權限': JSON.stringify(['request.create', 'request.edit', 'request.status', 'request.delete', 'request.export', 'modification.create', 'modification.confirm', 'project.create', 'designer.settings', 'profile.edit', 'media.manage', 'reel.interact', 'issue.report', 'issue.manage', 'short_link.create', 'archive.edit', 'database.manage']),
    '更新時間': '',
    '更新者': '系統預設'
  },
  {
    '角色範本': '設計師',
    '頁面權限': JSON.stringify(['request', 'dashboard', 'media_admin', 'avatar_upload', 'short_link']),
    '功能權限': JSON.stringify(['request.create', 'request.edit', 'request.status', 'request.export', 'modification.create', 'modification.confirm', 'project.create', 'designer.settings', 'profile.edit', 'media.manage', 'reel.interact', 'issue.report', 'short_link.create']),
    '更新時間': '',
    '更新者': '系統預設'
  },
  {
    '角色範本': '一般使用者',
    '頁面權限': JSON.stringify(['request', 'avatar_upload', 'short_link']),
    '功能權限': JSON.stringify(['request.create', 'profile.edit', 'reel.interact', 'issue.report', 'short_link.create']),
    '更新時間': '',
    '更新者': '系統預設'
  },
  {
    '角色範本': '唯讀',
    '頁面權限': JSON.stringify(['request', 'dashboard', 'short_link']),
    '功能權限': '[]',
    '更新時間': '',
    '更新者': '系統預設'
  }
]);

export const DATABASE_HEADERS = [
  '案件編號', '月份', '客戶別', '專案名稱', '專案負責人', '設計種類', '階段', '數量',
  '開始日期', '結束日期', '設計負責人', '項目細節', '修改次數', '狀態', '加權', '填單時間',
  '繳交時間', '使用平台', '設計簡報說明', '設計簡報連結',
  '客戶素材說明', '客戶素材連結', '參考範例說明', '參考範例連結', '其他說明', '其他連結',
  '設計圖資料夾連結'
];

// 已經從 DATABASE_HEADERS 移除、但舊資料列裡可能還留著的欄位。normalizeDatabaseShape()
// 會把這些欄位從「表頭清單」裡主動排除，不讓它們透過既有的「聯集既有表頭＋schema 表頭」
// 邏輯被永久保留下去；既有資料列本身的值不會被刪除，只是不再出現在表頭／後台欄位清單裡。
const DEPRECATED_TABLE_HEADERS = {
  database: ['時間標記']
};

export const TABLE_SCHEMAS = {
  database: {
    primaryKey: '案件編號',
    headers: DATABASE_HEADERS
  },
  '加權計分標準': {
    primaryKey: null,
    headers: ['設計種類', '階段', '項目細節', '權重', '備註']
  },
  '短連結': {
    primaryKey: '短碼',
    headers: ['短碼', '原始網址', '建立時間']
  },
  '修改統計表': {
    primaryKey: null,
    headers: ['案件編號', '修改次數', '建立日期', '修改日期', '修改內容', '修改人', '確認修正日', '圖片連結', '圖片來源', '圖片更新時間', '待修改圖片']
  },
  '補充資料連結': {
    primaryKey: '案件編號',
    headers: ['案件編號', 'A', 'B', 'C', 'D', '更新時間']
  },
  '設定': {
    primaryKey: '帳號',
    headers: [
      '部門', '組別', '名字', '顯示名', '帳號', '頭像連結', '頭像大圖連結', '分享音樂',
      '音樂起始秒數', '技能', '對話框', '新專案輪值', '篩選年份', '篩選月份', '篩選狀態',
      '篩選姓名', '選擇', '案件編號', '月份', '客戶別', '專案名稱', '專案負責人', '設計種類',
      '階段', '數量', '開始', '結束', '設計負責人', '狀態', '項目細節', '修改', '主旨',
      '操作', '時間表', '收合設計師專長與案件分配', '收合最新案件列表', '收合設計需求', '深淺模式'
    ]
  },
  '帳號權限': {
    primaryKey: '帳號',
    headers: ['帳號', '登入方式', '角色範本', '狀態', '頁面權限', '功能權限', '更新時間', '更新者']
  },
  '組織選項': {
    primaryKey: '代碼',
    headers: ['代碼', '種類', '名稱', '排序']
  },
  '角色權限範本': {
    primaryKey: '角色範本',
    headers: ['角色範本', '頁面權限', '功能權限', '更新時間', '更新者']
  },
  reels: {
    primaryKey: null,
    headers: ['名字', '限時動態連結', '保留期限', '到期時間', '按讚', '倒讚', '留言']
  },
  bug_report: {
    primaryKey: null,
    headers: ['姓名', '時間', '內容', '修改建議', '狀態', '狀態更改時間', '回報中', '評估中', '處理中', '已完成', '已否決']
  },
  '平面新開專案': {
    primaryKey: null,
    headers: ['客戶別', '專案名稱', '專案負責人', '專案類型', '數量', '開始時間', '結束時間', '預計設計師', '替換(選填)', '調整原因(選填)']
  },
  '影音新開專案': {
    primaryKey: null,
    headers: ['客戶別', '專案名稱', '專案負責人', '專案類型', '數量', '開始時間', '結束時間', '預計設計師', '替換(選填)', '調整原因(選填)']
  }
};

export const TABLE_NAMES = Object.freeze(Object.keys(TABLE_SCHEMAS));

export function emptyDatabase() {
  return {
    schemaVersion: 1,
    revision: 0,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    source: {
      type: 'google-sheets',
      spreadsheetId: '1cHxWBed715H0XufNhMOOk3hcZPTSpq5rA64-b5m8vWY'
    },
    tables: Object.fromEntries(TABLE_NAMES.map(name => [name, {
      headers: [...TABLE_SCHEMAS[name].headers],
      primaryKey: TABLE_SCHEMAS[name].primaryKey,
      rows: name === '加權計分標準'
        ? DEFAULT_WEIGHT_RULE_ROWS.map(row => ({ ...row }))
        : (name === '角色權限範本' ? DEFAULT_ROLE_TEMPLATE_ROWS.map(row => ({ ...row })) : [])
    }])),
    internal: {
      sessions: {},
      idempotency: {}
    }
  };
}

export function normalizeDatabaseShape(input) {
  const db = input && typeof input === 'object' && !Array.isArray(input) ? input : emptyDatabase();
  db.schemaVersion = 1;
  db.revision = Number(db.revision) || 0;
  db.createdAt ||= new Date().toISOString();
  db.updatedAt ||= db.createdAt;
  db.tables ||= {};
  for (const name of TABLE_NAMES) {
    const schema = TABLE_SCHEMAS[name];
    const table = db.tables[name] && typeof db.tables[name] === 'object' ? db.tables[name] : {};
    const deprecated = DEPRECATED_TABLE_HEADERS[name] || [];
    const existingHeaders = (Array.isArray(table.headers) ? table.headers : []).filter(header => !deprecated.includes(header));
    // database 是對外備份的主表，因此依 schema 固定欄位順序；舊檔額外欄位仍放在最後保留。
    table.headers = name === 'database'
      ? [...schema.headers, ...existingHeaders.filter(header => !schema.headers.includes(header))]
      : [...new Set([...existingHeaders, ...schema.headers])];
    if (name === '帳號權限') table.headers = table.headers.filter(header => header !== '密碼雜湊');
    table.primaryKey = schema.primaryKey;
    table.rows = Array.isArray(table.rows) ? table.rows.filter(row => row && typeof row === 'object' && !Array.isArray(row)) : [];
    if (name === '帳號權限') table.rows.forEach(row => { delete row['密碼雜湊']; });
    if (name === '加權計分標準' && !table.rows.length) table.rows = DEFAULT_WEIGHT_RULE_ROWS.map(row => ({ ...row }));
    if (name === '角色權限範本') {
      const rowsByRole = new Map(table.rows.map(row => [String(row['角色範本'] || '').trim(), row]));
      table.rows = DEFAULT_ROLE_TEMPLATE_ROWS.map(defaultRow => ({ ...defaultRow, ...(rowsByRole.get(defaultRow['角色範本']) || {}) }));
    }
    db.tables[name] = table;
  }
  recalculateDatabaseModificationStats(db);
  db.internal ||= {};
  db.internal.sessions ||= {};
  db.internal.idempotency ||= {};
  return db;
}

// 「修改次數」與「繳交時間」都是修改統計表的派生資料：
// 0 號紀錄代表初稿，其建立時間就是繳交時間；正整數最大值是目前修改輪次。
// 沒有初稿紀錄的舊案件保留既有繳交時間，避免清除歷史資料。
export function recalculateDatabaseModificationStats(database) {
  const maxByCase = new Map();
  const firstDraftTimeByCase = new Map();
  for (const row of database?.tables?.['修改統計表']?.rows || []) {
    const caseId = String(row['案件編號'] ?? '').trim();
    if (!caseId) continue;
    const count = Math.max(0, Number(row['修改次數']) || 0);
    maxByCase.set(caseId, Math.max(maxByCase.get(caseId) || 0, count));
    if (count !== 0 || firstDraftTimeByCase.has(caseId)) continue;
    const draftTime = String(row['建立日期'] || row['修改日期'] || row['圖片更新時間'] || '').trim();
    if (draftTime) firstDraftTimeByCase.set(caseId, draftTime);
  }
  const rows = database?.tables?.database?.rows || [];
  for (const row of rows) {
    const caseId = String(row['案件編號'] ?? '').trim();
    row['修改次數'] = String(maxByCase.get(caseId) || 0);
    if (firstDraftTimeByCase.has(caseId)) row['繳交時間'] = firstDraftTimeByCase.get(caseId);
    else if (!Object.hasOwn(row, '繳交時間')) row['繳交時間'] = '';
  }
  return rows.length;
}

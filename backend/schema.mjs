import { DEFAULT_WEIGHT_RULE_ROWS } from './weighting.mjs';

export const DATABASE_HEADERS = [
  '案件編號', '月份', '客戶別', '專案名稱', '專案負責人', '設計種類', '階段', '數量',
  '開始日期', '結束日期', '設計負責人', '項目細節', '狀態', '加權', '填單時間',
  '時間標記', '繳交時間', '使用平台', '設計簡報說明', '設計簡報連結',
  '客戶素材說明', '客戶素材連結', '參考範例說明', '參考範例連結', '其他說明', '其他連結'
];

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
    headers: ['案件編號', '修改次數', '建立日期', '修改日期', '修改內容', '修改人', '確認修正日']
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
    headers: ['帳號', '角色範本', '狀態', '頁面權限', '功能權限', '更新時間', '更新者']
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
      rows: name === '加權計分標準' ? DEFAULT_WEIGHT_RULE_ROWS.map(row => ({ ...row })) : []
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
    table.headers = [...new Set([...(Array.isArray(table.headers) ? table.headers : []), ...schema.headers])];
    table.primaryKey = schema.primaryKey;
    table.rows = Array.isArray(table.rows) ? table.rows.filter(row => row && typeof row === 'object' && !Array.isArray(row)) : [];
    if (name === '加權計分標準' && !table.rows.length) table.rows = DEFAULT_WEIGHT_RULE_ROWS.map(row => ({ ...row }));
    db.tables[name] = table;
  }
  db.internal ||= {};
  db.internal.sessions ||= {};
  db.internal.idempotency ||= {};
  return db;
}

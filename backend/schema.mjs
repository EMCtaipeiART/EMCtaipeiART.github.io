import { DEFAULT_WEIGHT_RULE_ROWS } from './weighting.mjs';

// 目前營運中的客戶別，作為「客戶別」表的預設種子資料；normalizeDatabaseShape() 會在既有
// 資料缺少這些名稱時自動補上（保留既有已指派的專案負責人／設計負責人／部門組別不被覆蓋），
// 之後透過前台「新增客戶別」或後台新增的客戶不受這份清單限制，會另外附加在後面。
export const DEFAULT_CUSTOMER_NAMES = Object.freeze([
  '丹士特', '王品', '欣格家居', '金士頓', '保誠人壽', '保麗淨', '席伊麗', '高露潔', '添可', '富美家',
  '統一', '新安東京', '嘉儀家品', '滿意寶寶', '酷澎', '墾丁國家公園管理處', '癌症希望基金會', '聯華食品',
  '蘇菲', '櫻花', 'ANKER', 'BAT', 'BAT英美菸草', 'DJI', 'EMC', 'Epson', 'eufy', 'soundcore'
]);
export const DEFAULT_CUSTOMER_ROWS = Object.freeze(DEFAULT_CUSTOMER_NAMES.map(name => Object.freeze({
  '客戶別': name, '排序': '', '專案負責人': '[]', '設計負責人': '[]', '部門組別': '[]', '更新時間': '', '更新者': '系統預設'
})));

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

export const DEFAULT_SYSTEM_ANNOUNCEMENT_CONTENT = `# 📢 EMC 設計需求系統更新公告｜v4.7

EMC 設計需求系統近期完成多項功能升級 🎉
這次不只是畫面調整，而是從 **案件管理、寄信回信、設計圖上傳、權限管理到後台設定** 都做了完整優化。

以下用最簡單的方式告訴大家：**現在多了什麼、使用上有什麼不同。**

## ✉️ 01｜寄信、回信變得更完整

現在案件可以直接在系統內處理 Gmail 信件，不用一直在網站與 Gmail 之間切換。

**你現在可以：**

- 直接從案件「發信」
- 查看完整信件往來
- 直接「回信」
- 編輯信件文字、粗體、對齊、文字顏色
- 插入連結與圖片
- 自己調整「收件人」與「副本」
- 寄件人會清楚顯示，避免搞錯寄信帳號

回信時也會先自動幫你帶入建議的收件人與副本，需要時再自行增加或刪除即可。

---

## 📝 02｜新增「修改需求信／設計師回覆信」

現在按下「回信」後，不再只有一種回覆方式。

可以依工作情境選擇：

**① 填寫修改需求信**
PM 要告知設計師修改內容時使用。

**② 設計師回覆信**
設計師完成圖片後，可以直接把最新設計圖帶進回覆內容。

**③ 一般回信**
一般信件往來照原本方式直接回覆。

設計師第一次完成圖片並送出回覆後，案件也能自動進入 **「過稿中」**，少一次手動改狀態的動作。

---

## 💬 03｜設計師可以設定自己的回信範本

不同設計項目可以設定不同的常用回覆文字。

例如：

**電商 Banner**
→「Hi XXX，附件為本次設計初稿，再請協助確認，謝謝！」

**社群貼文**
→ 使用另一組適合社群案件的文字。

系統會依照案件的：

**設計類型 → 階段 → 項目細節**

自動找到適合的範本。

之後常用內容不用每次重新打一遍。

---

## 🖼️ 04｜設計圖與 NAS 流程大幅簡化

設計師處理「過稿中」案件時，現在可以直接選擇 NAS 裡的案件資料夾。

之後系統會協助：

- 找到案件最新設計圖
- 自動上傳圖片
- 自動放進正確的修改輪次
- 案件資料可以直接看到各版本縮圖
- 修改紀錄可以新增或移除圖片
- 同一輪後來再補圖片，也能繼續抓取

不需要每一次修改都重新手動找圖、上傳、整理版本。

系統也增加了防重複機制，降低背景監控和手動備份同時執行時重複上傳的情況。

---

## 👥 05｜客戶別、負責人與權限變得更聰明

「客戶別」現在不只是案件裡的一段文字，而是正式的管理設定。

每個客戶可以設定：

- 專案負責人
- 設計負責人
- 部門／組別
- 哪些人可以操作這個客戶的案件

登入後，系統會依照你的身份自動帶入適合的資料。

例如專案負責人登入後：

- 專案負責人自動帶入本人
- 部分欄位不必重複填寫
- 只顯示自己負責的相關案件
- 依權限決定是否可編輯、刪除、發信或回信

案件畫面會更乾淨，也比較不容易誤改到其他人的案件。

---

## ⚙️ 06｜資料庫後台重新整理

管理後台現在不再只是單純的大表格。

不同資料改成適合自己的管理方式，包括：

- **帳號設定**：統一管理個人資料與權限
- **權限設定**：依角色設定可使用的功能
- **客戶別**：管理負責人、部門與案件權限
- **設計列表**：管理設計師資料與回信範本
- **修改列表**：用案件方式查看修改歷程
- **加權設定**：直接維護設計項目與分數
- **問題回報**：以流程狀態查看處理進度
- **REELS**：整合至設計師帳號管理

管理資料時不用再到不同地方找設定。

---

## 🔔 07｜日常使用體驗持續升級

近期也陸續加入許多日常會用到的小功能：

- 新案件與修改需求通知
- 右上角即時通知提示
- 個人頭像設定
- 設計師 REELS／限時動態
- 深色模式優化
- 案件欄位自行顯示與排序
- 專案負責人案件快速查看
- 六碼短網址工具
- 補充資料連結優化
- 手機版操作改善
- 案件列表與時間軸同步更新

很多原本需要重新整理、切換頁面或人工確認的動作，現在都會自動完成。

---

# 🚀 系統版本

**目前版本：v4.7**

本次版本的重點可以用一句話總結：

> **從「案件紀錄工具」，進一步升級成可以串起案件、設計圖、信件與人員權限的工作平台。**

如果使用過程中發現異常，請使用系統內的「問題回報」功能回報，我們會持續更新與優化。`;

export const DEFAULT_SYSTEM_ANNOUNCEMENT_ROWS = Object.freeze([Object.freeze({
  '公告版本': 'v4.7',
  '公告標題': 'EMC 設計需求系統更新公告｜v4.7',
  '公告內容': DEFAULT_SYSTEM_ANNOUNCEMENT_CONTENT,
  '是否啟用': '啟用',
  '發布時間': '2026-08-20',
  '更新時間': '2026-08-20',
  '更新者': '系統預設'
})]);

export function latestSystemAnnouncement(database) {
  const rows = database?.tables?.['系統公告欄']?.rows || [];
  const enabled = rows.map((row, index) => ({ row, index })).filter(({ row }) => {
    const status = String(row?.['是否啟用'] ?? '').trim().toLowerCase();
    return /^(?:啟用|發布|公開|v|true|1|yes)$/.test(status)
      && String(row?.['公告版本'] ?? '').trim()
      && String(row?.['公告內容'] ?? '').trim();
  });
  const versionParts = value => String(value ?? '').match(/\d+/g)?.map(Number) || [];
  enabled.sort((left, right) => {
    const a = versionParts(left.row['公告版本']), b = versionParts(right.row['公告版本']);
    for (let index = 0; index < Math.max(a.length, b.length); index += 1) {
      const difference = (a[index] || 0) - (b[index] || 0);
      if (difference) return difference;
    }
    return String(left.row['發布時間'] || '').localeCompare(String(right.row['發布時間'] || ''), 'zh-Hant') || left.index - right.index;
  });
  return enabled.at(-1)?.row || null;
}

export function publicSystemAnnouncement(database) {
  const row = latestSystemAnnouncement(database);
  return row ? {
    version: String(row['公告版本'] || '').trim(),
    title: String(row['公告標題'] || '').trim(),
    content: String(row['公告內容'] || '').trim(),
    publishedAt: String(row['發布時間'] || '').trim(),
    updatedAt: String(row['更新時間'] || '').trim()
  } : null;
}

export const DATABASE_HEADERS = [
  '案件編號', '月份', '客戶別', '專案名稱', '專案負責人', '設計種類', '階段', '數量',
  '開始日期', '結束日期', '設計負責人', '項目細節', '修改次數', '狀態', '加權', '填單時間',
  '繳交時間', '使用平台', '設計簡報說明', '設計簡報連結',
  '客戶素材說明', '客戶素材連結', '參考範例說明', '參考範例連結', '其他說明', '其他連結',
  '設計圖資料夾連結', '設計圖檔名關鍵字', 'Gmail信件串ID', 'Gmail寄件帳號'
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
  '系統公告欄': {
    primaryKey: '公告版本',
    headers: ['公告版本', '公告標題', '公告內容', '是否啟用', '發布時間', '更新時間', '更新者']
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
      '音樂起始秒數', '技能', '技能表單設定', '對話框', '回信範本設定', '新專案輪值', '設計師顯示', '篩選年份', '篩選月份', '篩選狀態',
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
  '客戶別': {
    primaryKey: '客戶別',
    headers: ['客戶別', '排序', '專案負責人', '設計負責人', '部門組別', '更新時間', '更新者']
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
        : (name === '角色權限範本' ? DEFAULT_ROLE_TEMPLATE_ROWS.map(row => ({ ...row }))
          : (name === '客戶別' ? DEFAULT_CUSTOMER_ROWS.map(row => ({ ...row }))
            : (name === '系統公告欄' ? DEFAULT_SYSTEM_ANNOUNCEMENT_ROWS.map(row => ({ ...row })) : [])))
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
    if (name === '系統公告欄' && !table.rows.length) table.rows = DEFAULT_SYSTEM_ANNOUNCEMENT_ROWS.map(row => ({ ...row }));
    if (name === '角色權限範本') {
      const rowsByRole = new Map(table.rows.map(row => [String(row['角色範本'] || '').trim(), row]));
      table.rows = DEFAULT_ROLE_TEMPLATE_ROWS.map(defaultRow => ({ ...defaultRow, ...(rowsByRole.get(defaultRow['角色範本']) || {}) }));
    }
    // 客戶別只在資料表完全空白時（第一次啟用）才灌入預設清單；一旦已經有任何一列資料，就不再強制補回
    // 缺少的預設名稱——跟「角色權限範本」那種「一定要固定存在四種角色」不同，客戶別本來就是可以被使用者
    // 透過後台「刪除客戶別」刪除的資料，如果每次讀取都重新合併預設清單，删除其中任何一個預設客戶別都會在
    // 下一次讀取時被無聲地加回來，等於功能上永遠刪不掉（這是 2026-08-19 實際發生過的真人回報 bug）。
    if (name === '客戶別' && !table.rows.length) table.rows = DEFAULT_CUSTOMER_ROWS.map(row => ({ ...row }));
    db.tables[name] = table;
  }
  recalculateDatabaseModificationStats(db);
  db.internal ||= {};
  db.internal.sessions ||= {};
  db.internal.idempotency ||= {};
  return db;
}

/**
 * 保留完整資料值與兩格縮排的外層結構，但讓每筆資料列／冪等回應各自維持單行。
 * 這能顯著減少重複縮排空白，同時讓 GitHub diff 仍可逐筆檢視；JSON.parse 後與輸入完全相同。
 */
export function stringifyDatabaseForStorage(input) {
  const sourceJson = JSON.stringify(input);
  let markerPrefix = '__MACHI_COMPACT_JSON_VALUE_';
  while (sourceJson.includes(markerPrefix)) markerPrefix += '_';

  const compact = structuredClone(input);
  const rawValues = [];
  const marker = value => {
    const index = rawValues.push(JSON.stringify(value) ?? 'null') - 1;
    return `${markerPrefix}${index}__`;
  };

  for (const table of Object.values(compact?.tables || {})) {
    if (Array.isArray(table?.rows)) table.rows = table.rows.map(marker);
  }
  if (compact?.internal?.idempotency && typeof compact.internal.idempotency === 'object') {
    for (const key of Object.keys(compact.internal.idempotency)) {
      compact.internal.idempotency[key] = marker(compact.internal.idempotency[key]);
    }
  }

  const markerPattern = new RegExp(`"${markerPrefix}(\\d+)__"`, 'g');
  return `${JSON.stringify(compact, null, 2).replace(markerPattern, (_match, index) => rawValues[Number(index)])}\n`;
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

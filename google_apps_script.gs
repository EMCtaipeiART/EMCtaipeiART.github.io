const SHEET_NAME = 'database';
const SPREADSHEET_ID = '1cHxWBed715H0XufNhMOOk3hcZPTSpq5rA64-b5m8vWY';
const TARGET_SHEET_ID = 1244538986;
const SETTINGS_SHEET_ID = 988186149;
const REELS_SHEET_ID = 1503122183;
const FLAT_PROJECT_SHEET_ID = 835100013;
const VIDEO_PROJECT_SHEET_ID = 1837218794;
const MODIFICATION_STATS_SHEET_ID = 1240020248;
const ISSUE_REPORT_SHEET_ID = 1284883392;
const WEIGHTS_SHEET_ID = 581038169;
const STAGES_SHEET_ID = 462593697;
const DESIGNER_IMAGE_FOLDER_ID = '1rBJQ3uvDeFruf7Th2yF2xQWr0c0F2-nH';
const USER_AVATAR_ROOT_FOLDER_ID = '1KHtmAVbSh7kht0ge3b9lDZpmCClwkiJk';
const USER_AVATAR_HEADER = '頭像連結';
const USER_AVATAR_MAX_BYTES = 8 * 1024 * 1024;
const DESIGNER_IMAGE_FOLDER_IDS = {
  Machi: '1Atv0iIepcQ6JaCS0F_yFsUQurj1ibla5',
  Anna: '1Ea7QIkkEvyRN_5mhTM3LPipQ_X6GKIpA',
  Karl: '11cgZTXz6nYX21QTFmUcheisEaGYo2Mtb',
  Noise: '1FZ4KUlHM7XGvWKGsVidyoudTmiP9ltDn',
  Amber: '14JtIBWEjX8Q1dRdE18bjDE93CM-VKg45',
  Leona: '1sSWQrwCe5naQYTUUl5F65WehMk-NDpm0'
};
const DESIGNER_IMAGE_UPLOAD_SCOPES = [
  'https://www.googleapis.com/auth/drive',
  'https://www.googleapis.com/auth/spreadsheets'
];
const HEADER_SCAN_COLUMNS = 40;
const CACHE_SECONDS = 180;
const DETAIL_SHEET_NAMES = ['階段', '項目細節', 'detail', 'details'];
const SCRIPT_VERSION = 'role-template-defaults-2026-08-11';
const DATABASE_ARCHIVE_GITHUB_TOKEN_PROPERTY = 'DATABASE_ARCHIVE_GITHUB_TOKEN';
const DATABASE_ARCHIVE_GITHUB_REPOSITORY = 'EMCtaipeiART/EMCtaipeiART.github.io';
const DATABASE_ARCHIVE_GITHUB_EVENT_TYPE = 'database_changed';
const GITHUB_JSON_DATABASE_PATH = 'backend/data/db.json';
const GITHUB_JSON_DATABASE_BRANCH = 'main';
const GITHUB_JSON_BACKUP_QUEUE_PROPERTY = 'GITHUB_JSON_BACKUP_QUEUE_V1';
const GITHUB_JSON_BACKUP_TRIGGER = 'retryGithubJsonDatabaseBackups';
const CREATE_REQUEST_CACHE_SECONDS = 21600;
const SUPPLEMENT_LINK_SHEET_NAME = '補充資料連結';
const SUPPLEMENT_LINK_HEADERS = ['案件編號', 'A', 'B', 'C', 'D', '更新時間'];
const SUPPLEMENT_SHORT_LINK_BASE_URL = 'https://emctaipeiart.github.io';
const SUPPLEMENT_LINK_CACHE_SECONDS = 21600;
const SHORT_LINK_SHEET_NAME = '短連結';
const SHORT_LINK_HEADERS = ['短碼', '原始網址', '建立時間'];
const SHORT_LINK_CODE_LENGTH = 6;
const SHORT_LINK_CODE_CHARS = '23456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';
const SHORT_LINK_CACHE_SECONDS = 21600;
const SUPPLEMENT_LINK_SLOTS = {
  a: { key: 'briefUrl', header: '設計簡報連結' },
  b: { key: 'assetUrl', header: '客戶素材連結' },
  c: { key: 'referenceUrl', header: '參考範例連結' },
  d: { key: 'otherUrl', header: '其他連結' }
};
const EDITOR_ACCOUNTS = {
  Machi: true,
  Anna: true,
  Karl: true,
  Noise: true,
  Amber: true,
  Leona: true
};
const LOGIN_DOMAIN = '@emctaipei.com';
const TEST_USER_ACCOUNT = 'test.user@emctaipei.com';
const TEST_USER_PASSWORD = 'test';
const ADMIN_LOGIN_PASSWORD_TIMEZONE = 'Asia/Taipei';
const EDITOR_SESSION_SECONDS = 21600;
const EDITOR_SESSION_PERSIST_SECONDS = 30 * 24 * 60 * 60;
const EDITOR_SESSION_RENEW_WINDOW_SECONDS = 15 * 24 * 60 * 60;
const EDITOR_SESSION_PROPERTY_PREFIX = 'EDITOR_SESSION_';
const GOOGLE_OAUTH_CLIENT_ID = '501170620928-dh3e431763b4ah8crq7kirmsu8m17bdj.apps.googleusercontent.com';
const ERP_OAUTH_BASE_URL_DEFAULT = 'https://manage.emctaipei.com';
const ERP_OAUTH_SCOPE = 'openid profile';
const ERP_OAUTH_PROPERTY_KEYS = {
  baseUrl: 'ERP_BASE_URL',
  clientId: 'ERP_CLIENT_ID',
  clientSecret: 'ERP_CLIENT_SECRET',
  redirectUri: 'ERP_REDIRECT_URI'
};
const ADMIN_TABLE_CONFIG = {
  database: { sheetName: SHEET_NAME, primaryKey: '案件編號' },
  '加權計分標準': { sheetId: WEIGHTS_SHEET_ID, primaryKey: '' },
  '短連結': { sheetName: SHORT_LINK_SHEET_NAME, primaryKey: '短碼' },
  '修改統計表': { sheetId: MODIFICATION_STATS_SHEET_ID, primaryKey: '' },
  '補充資料連結': { sheetName: SUPPLEMENT_LINK_SHEET_NAME, primaryKey: '案件編號' },
  '設定': { sheetId: SETTINGS_SHEET_ID, primaryKey: '帳號' },
  '帳號權限': { primaryKey: '帳號' },
  '角色權限範本': { primaryKey: '角色範本' },
  reels: { sheetId: REELS_SHEET_ID, primaryKey: '' },
  bug_report: { sheetId: ISSUE_REPORT_SHEET_ID, primaryKey: '' }
};

const HEADERS = [
  '案件編號',
  '月份',
  '客戶別',
  '專案名稱',
  '專案負責人',
  '設計類型',
  '階段',
  '數量',
  '開始日期',
  '結束日期',
  '設計負責人',
  '使用平台',
  '填單時間',
  '設計簡報說明',
  '設計簡報連結',
  '客戶素材說明',
  '客戶素材連結',
  '參考範例說明',
  '參考範例連結',
  '其他說明',
  '其他連結',
  '案件狀態',
  '項目細節',
  '加權'
];

const FORMULA_MANAGED_HEADERS = [
  '案件編號',
  '月份',
  '填單時間'
];

const CALCULATED_MANAGED_HEADERS = [
  '加權'
];

const FORM_WRITE_HEADERS = [
  '客戶別',
  '專案名稱',
  '專案負責人',
  '設計類型',
  '階段',
  '數量',
  '開始日期',
  '結束日期',
  '設計負責人',
  '使用平台',
  '設計簡報說明',
  '設計簡報連結',
  '客戶素材說明',
  '客戶素材連結',
  '參考範例說明',
  '參考範例連結',
  '其他說明',
  '其他連結',
  '案件狀態'
];

const LIST_INLINE_WRITE_HEADERS = [
  '案件狀態',
  '項目細節',
  '加權'
];

const USER_SETTING_NAME_HEADER = '名字';
const USER_SETTING_NAME_ALIASES = ['設計師名字', '姓名'];
const USER_DISPLAY_NAME_HEADER = '顯示名';
const USER_DEPARTMENT_HEADER = '部門';
const USER_GROUP_HEADER = '組別';
const USER_DIRECTORY_PROPERTY = 'USER_DIRECTORY_V1';
const USER_NEW_PROJECT_ROTATION_HEADER = '新專案輪值';
const FLAT_ROTATION_DESIGNERS = ['Machi', 'Anna', 'Amber', 'Leona'];
const VIDEO_ROTATION_DESIGNERS = ['Karl', 'Noise'];
const FLAT_PROJECT_SHEET_NAME = '平面新開專案';
const VIDEO_PROJECT_SHEET_NAME = '影音新開專案';
const NEW_PROJECT_HEADERS = [
  '客戶別',
  '專案名稱',
  '專案負責人',
  '專案類型',
  '數量',
  '開始時間',
  '結束時間',
  '預計設計師',
  '替換(選填)',
  '調整原因(選填)'
];
const MODIFICATION_STATS_SHEET_NAME = '修改統計表';
const MODIFICATION_STATS_HEADERS = [
  '案件編號',
  '修改次數',
  '建立日期',
  '修改日期',
  '修改內容',
  '修改人',
  '確認修正日'
];
const ISSUE_REPORT_HEADERS = [
  '姓名',
  '時間',
  '內容',
  '修改建議',
  '狀態',
  '狀態更改時間',
  '回報中',
  '評估中',
  '處理中',
  '已完成',
  '已否決'
];
const ISSUE_REPORT_STATUSES = ['回報中', '評估中', '處理中', '已完成', '已否決'];
const USER_AUTH_HEADERS = [
  '帳號'
];
const USER_SETTING_COLUMN_HEADERS = [
  '案件編號',
  '月份',
  '客戶別',
  '專案名稱',
  '專案負責人',
  '設計類型',
  '階段',
  '數量',
  '開始',
  '結束',
  '設計負責人',
  '狀態',
  '項目細節',
  '修改',
  '主旨',
  '操作'
];
// 「設計類型」不再屬於設定分頁的個人欄位寫入項目。
// 若舊表已有該欄仍可讀取相容，但不會建立、清空或改寫。
const USER_SETTING_NON_WRITABLE_COLUMN_HEADERS = ['設計類型'];
const USER_DISPLAY_SETTING_HEADERS = [
  '選擇',
  '時間表',
  '收合設計師專長與案件分配',
  '收合最新案件列表',
  '收合設計需求',
  '深淺模式'
];
const USER_FILTER_SETTING_HEADERS = [
  '篩選年份',
  '篩選月份',
  '篩選狀態',
  '篩選姓名'
];
const REELS_HEADERS = ['名字', '限時動態連結', '保留期限', '到期時間', '按讚', '倒讚', '留言'];
const REEL_COMMENT_LIMIT = 50;
const REEL_COMMENT_MAX_LENGTH = 200;

const USER_SETTING_HEADER_TO_KEY = {
  '案件編號': 'id',
  '月份': 'month',
  '客戶別': 'client',
  '專案名稱': 'project',
  '專案負責人': 'owner',
  '設計類型': 'type',
  '階段': 'stage',
  '數量': 'qty',
  '開始': 'start',
  '結束': 'end',
  '設計負責人': 'designer',
  '狀態': 'status',
  '項目細節': 'details',
  '修改': 'modifications',
  '主旨': 'subject',
  '操作': 'actions'
};

const KEY_TO_HEADER = {
  id: '案件編號',
  month: '月份',
  client: '客戶別',
  project: '專案名稱',
  owner: '專案負責人',
  type: '設計類型',
  stage: '階段',
  qty: '數量',
  start: '開始日期',
  end: '結束日期',
  designer: '設計負責人',
  platforms: '使用平台',
  submittedAt: '填單時間',
  briefNote: '設計簡報說明',
  briefUrl: '設計簡報連結',
  assetNote: '客戶素材說明',
  assetUrl: '客戶素材連結',
  referenceNote: '參考範例說明',
  referenceUrl: '參考範例連結',
  otherNote: '其他說明',
  otherUrl: '其他連結',
  status: '案件狀態',
  details: '項目細節',
  weight: '加權'
};

const HEADER_ALIASES = {
  '設計類型': ['設計種類', '設計總類', '設計項目'],
  '使用平台': ['平台'],
  '填單時間': ['填表時間', '建立時間'],
  '案件狀態': ['狀態'],
  '項目細節': ['項目細節(可複選)', '項目細項']
};
const SETTINGS_HEADER_ALIASES = {
  '名字': USER_SETTING_NAME_ALIASES,
  '部門': [],
  '組別': ['設計類型', '設計種類'],
  '選擇': ['編輯']
};

function doGet(e) {
  e = e || { parameter: {} };
  try {
    const payload = parsePayload_(e);
    const action = (e.parameter && e.parameter.action) || payload.action || 'list';
    if (action === 'googleLoginRedirect') {
      return googleLoginRedirectResponse_(payload, e.parameter || {});
    }
    if (action === 'erpLoginRedirect') {
      return erpLoginRedirectResponse_(payload, e.parameter || {});
    }
    if (action === 'loginRedirect') {
      return loginRedirectResponse_(payload, e.parameter || {});
    }
    return jsonResponse(handleAction_(action, payload, e.parameter || {}), e.parameter && e.parameter.callback);
  } catch (error) {
    return jsonResponse(appsScriptErrorResponse_(error), e.parameter && e.parameter.callback);
  }
}

function doPost(e) {
  e = e || { parameter: {}, postData: { contents: '{}' } };
  try {
    const payload = parsePayload_(e);
    const action = payload.action || (e.parameter && e.parameter.action);
    if (action === 'googleLoginRedirect') {
      return googleLoginRedirectResponse_(payload, e.parameter || {});
    }
    if (action === 'erpLoginRedirect') {
      return erpLoginRedirectResponse_(payload, e.parameter || {});
    }
    if (action === 'loginRedirect') {
      return loginRedirectResponse_(payload, e.parameter || {});
    }
    const response = handleAction_(action, payload, e.parameter || {});
    return e.parameter && e.parameter.frameCallback
      ? frameResponse_(response, e.parameter.frameCallback)
      : jsonResponse(response);
  } catch (error) {
    const response = appsScriptErrorResponse_(error);
    return e.parameter && e.parameter.frameCallback
      ? frameResponse_(response, e.parameter.frameCallback)
      : jsonResponse(response);
  }
}

function appsScriptErrorResponse_(error) {
  return {
    ok: false,
    error: error && error.message ? error.message : String(error),
    reason: 'APPS_SCRIPT_ERROR',
    rawError: String(error && (error.stack || error.message) || error),
    scriptVersion: SCRIPT_VERSION
  };
}

function parsePayload_(e) {
  const payload = {};
  if (e && e.parameter) {
    Object.keys(e.parameter).forEach(key => {
      payload[key] = e.parameter[key];
    });
  }
  if (e && e.postData && e.postData.contents) {
    try {
      Object.assign(payload, JSON.parse(e.postData.contents));
    } catch (error) {}
  }
  if (payload.payload) {
    try {
      Object.assign(payload, JSON.parse(payload.payload));
    } catch (error) {}
  }
  return payload;
}

function handleAction_(action, payload, params) {
  if (action === 'ping') {
    return {
      ok: true,
      action: 'ping',
      version: SCRIPT_VERSION,
      spreadsheetId: SPREADSHEET_ID,
      sheetName: SHEET_NAME,
      message: 'connected'
    };
  }

  enforceActionAccess_(action, payload);

  if (action === 'list') {
    const source = readGithubJsonDatabase_();
    const table = githubJsonTable_(source.database, 'database');
    const year = String(payload.year || (params && params.year) || '').replace(/[^0-9]/g, '');
    const rows = table.rows.map((row, index) => githubJsonCaseApiRow_(table, row, index))
      .filter(row => !year || String(row.start || row.end || '').indexOf(year) >= 0);
    return { ok: true, action: 'list', source: 'github-json-primary', revision: source.database.revision, rows };
  }

  if (action === 'recent') {
    const source = readGithubJsonDatabase_();
    const table = githubJsonTable_(source.database, 'database');
    const limit = Math.min(600, Math.max(1, Number(payload.limit || (params && params.limit)) || 120));
    return {
      ok: true,
      action: 'recent',
      source: 'github-json-primary',
      revision: source.database.revision,
      rows: table.rows.map((row, index) => githubJsonCaseApiRow_(table, row, index))
        .sort((left, right) => (Number(right.id) || 0) - (Number(left.id) || 0))
        .slice(0, limit)
    };
  }

  if (action === 'createRequestStatus') {
    const result = cachedCreateResult_(payload.requestId || (params && params.requestId));
    return {
      ok: true,
      action: 'createRequestStatus',
      pending: !result,
      result: result || null
    };
  }

  if (action === 'resolveSupplementLink') {
    return resolveSupplementLink_(payload);
  }

  if (action === 'createShortLink') {
    return attachGithubJsonTableSync_(createShortLink_(payload), '短連結', action);
  }

  if (action === 'resolveShortLink') {
    return resolveShortLink_(payload);
  }

  if (action === 'diagnose') {
    return diagnose_();
  }

  if (action === 'urlFetchAuthCheck') {
    return checkUrlFetchAuthorization_();
  }

  if (action === 'writeAccessCheck') {
    return checkWriteAccess_(payload);
  }

  if (action === 'adminTables') {
    return adminTables_(payload);
  }

  if (action === 'adminTableRows') {
    return adminTableRows_(payload);
  }

  if (action === 'adminTableUpdate') {
    return adminTableUpdate_(payload);
  }

  if (action === 'adminTableDelete') {
    return adminTableDelete_(payload);
  }

  if (action === 'adminTableInsert') {
    return adminTableInsert_(payload);
  }

  if (action === 'login') {
    return authenticateEditor_(payload);
  }

  if (action === 'googleLogin') {
    return authenticateGoogleEditor_(payload);
  }

  if (action === 'erpLoginConfig') {
    return erpLoginConfig_();
  }

  if (action === 'erpLogin') {
    return authenticateErpEditor_(payload);
  }

  if (action === 'googleEmailLogin') {
    return {
      ok: false,
      action: 'googleEmailLogin',
      error: 'GOOGLE_EMAIL_LOGIN_DISABLED',
      reason: 'googleEmailLogin 已停用，請改用 googleLogin 並傳 Google credential / idToken。',
      expectedClientId: GOOGLE_OAUTH_CLIENT_ID
    };
  }

  if (action === 'verifyToken') {
    return verifyEditorToken_(payload);
  }

  if (action === 'getAccessProfile') {
    const token = String(payload && payload.editorToken || '').trim();
    if (!token || (!isLocalAdminToken_(token) && !readEditorSession_(token, true))) return { ok: false, action: 'getAccessProfile', error: 'TOKEN_EXPIRED' };
    return { ok: true, action: 'getAccessProfile', access: accountAccessProfile_(token) };
  }

  if (action === 'logout') {
    return logoutEditorToken_(payload);
  }

  if (action === 'getUserSettings') {
    const account = assertEditorTokenForUser_(payload);
    return { ok: true, action: 'getUserSettings', account, settings: readEditorSettings_(account) };
  }

  if (action === 'saveUserSettings') {
    const account = assertEditorTokenForUser_(payload);
    return attachGithubJsonTableSync_({ ok: true, action: 'saveUserSettings', account, settings: saveEditorSettings_(account, payload.settings || {}) }, '設定', action);
  }

  if (action === 'saveDesignerProfiles') {
    assertEditorTokenForUser_(payload);
    return attachGithubJsonTableSync_({ ok: true, action: 'saveDesignerProfiles', profiles: saveDesignerProfiles_(payload.profiles || []) }, '設定', action);
  }

  if (action === 'listReels') {
    return { ok: true, action: 'listReels', reels: readReels_() };
  }

  if (action === 'toggleReelReaction') {
    const reel = toggleReelReaction_(payload);
    return attachGithubJsonTableSync_({ ok: true, action: 'toggleReelReaction', reel: reel }, 'reels', action);
  }

  if (action === 'addReelComment') {
    const reel = addReelComment_(payload);
    return attachGithubJsonTableSync_({ ok: true, action: 'addReelComment', reel: reel }, 'reels', action);
  }

  if (action === 'testDesignerImageUploadAuth') {
    assertEditorTokenForUser_(payload);
    return Object.assign({ ok: true, action: 'testDesignerImageUploadAuth' }, testDesignerImageUploadAuth_());
  }

  if (action === 'uploadDesignerImage') {
    assertEditorTokenForUser_(payload);
    const result = uploadDesignerImage_(payload);
    return {
      ok: true,
      action: 'uploadDesignerImage',
      url: result.url,
      fileId: result.fileId,
      name: result.name,
      kind: result.kind,
      folderId: result.folderId,
      folderName: result.folderName,
      isPublic: result.isPublic,
      sharingWarning: result.sharingWarning
    };
  }

  if (action === 'uploadUserAvatar') {
    const account = assertEditorTokenForUser_(payload);
    const result = uploadUserAvatar_(payload, account);
    return attachGithubJsonTableSync_({
      ok: true,
      action: 'uploadUserAvatar',
      account,
      url: result.url,
      fileId: result.fileId,
      folderId: result.folderId,
      isPublic: result.isPublic,
      sharingWarning: result.sharingWarning,
      settings: readEditorSettings_(account)
    }, '設定', action);
  }

  if (action === 'reportIssue') {
    const result = appendIssueReport_(payload.report || payload.row || payload.data || payload, payload);
    return attachGithubJsonTableSync_({ ok: true, action: 'reportIssue', rowNumber: result.rowNumber, row: result.row }, 'bug_report', action);
  }

  if (action === 'listIssueReports') {
    return { ok: true, action: 'listIssueReports', rows: readIssueReports_() };
  }

  if (action === 'updateIssueReportStatus') {
    const result = updateIssueReportStatus_(payload);
    return attachGithubJsonTableSync_({ ok: true, action: 'updateIssueReportStatus', rowNumber: result.rowNumber, row: result.row }, 'bug_report', action);
  }

  if (action === 'createFlatProject') {
    const result = createFlatProject_(payload.row || payload.data || {});
    return {
      ok: true,
      action: 'createFlatProject',
      rowNumber: result.rowNumber,
      projectKind: result.projectKind,
      row: result.row,
      databaseRowNumber: result.databaseRowNumber,
      databaseRow: result.databaseRow,
      rotations: result.rotations
    };
  }

  if (action === 'addModificationRecord') {
    const result = addModificationRecord_(payload.record || payload.row || payload.data || payload);
    return attachGithubJsonTableSync_({
      ok: true,
      action: 'addModificationRecord',
      rowNumber: result.rowNumber,
      record: result.record,
      count: result.count
    }, '修改統計表', action);
  }

  if (action === 'updateModificationConfirm') {
    const result = updateModificationConfirm_(Object.assign({}, payload.record || payload.row || payload.data || payload, {
      editorToken: payload.editorToken
    }));
    return attachGithubJsonTableSync_({
      ok: true,
      action: 'updateModificationConfirm',
      rowNumber: result.rowNumber,
      record: result.record
    }, '修改統計表', action);
  }

  if (action === 'bundle' || action === 'statsData') {
    return readBundle_(payload.year || (params && params.year));
  }

  if (action === 'update') {
    assertTarget_(payload);
    const rowPayload = updatePayloadRow_(payload);
    const forceHeaders = normalizeUpdateForceHeaders_(payload.forceHeaders || []);
    const options = {
      forceHeaders,
      sheetRow: payload.sheetRow || rowPayload.sheetRow || payload.rowNumber || rowPayload.rowNumber,
      match: payload.match || payload.rowMatch || payload.snapshot || {}
    };
    if (Object.prototype.hasOwnProperty.call(payload, 'writeHeaders')) {
      options.writeHeaders = normalizeUpdateWriteHeaders_(payload.writeHeaders || []);
    } else if (forceHeaders.length) {
      options.writeHeaders = forceHeaders;
    } else {
      options.writeHeaders = writeHeadersFromRow_(rowPayload);
    }
    assertEditorPermission_(payload, rowPayload, options.writeHeaders || []);
    const id = payload.id || payload.caseId || rowPayload.id || rowPayload['案件編號'];
    return githubJsonDatabaseWriteAction_('update', Object.assign({}, payload, { id, row: rowPayload, writeHeaders: options.writeHeaders || [] }));
  }

  if (action === 'batchUpdate') {
    assertTarget_(payload);
    const commonRow = updatePayloadRow_(payload);
    const forceHeaders = normalizeUpdateForceHeaders_(payload.forceHeaders || []);
    const writeHeaders = Object.prototype.hasOwnProperty.call(payload, 'writeHeaders')
      ? normalizeUpdateWriteHeaders_(payload.writeHeaders || [])
      : (forceHeaders.length ? forceHeaders : writeHeadersFromRow_(commonRow));
    assertEditorPermission_(payload, commonRow, writeHeaders);
    return githubJsonDatabaseWriteAction_('batchUpdate', Object.assign({}, payload, { row: commonRow, writeHeaders }));
  }

  if (action === 'append' || action === 'create' || action === 'add' || action === 'submit' || action === 'save') {
    const result = githubJsonDatabaseWriteAction_('add', payload);
    cacheCreateResult_(payload.requestId, result);
    return result;
  }

  if (action === 'batchAdd' || action === 'batchAppend' || action === 'addRows') {
    const result = githubJsonDatabaseWriteAction_('batchAdd', payload);
    cacheCreateResult_(payload.requestId, result);
    return result;
  }

  if (action === 'delete') {
    return githubJsonDatabaseWriteAction_('delete', payload);
  }

  if (action === 'detailOptions' || action === 'options') {
    return detailOptions_();
  }

  return { ok: false, error: 'Unknown action' };
}

function authenticateEditor_(payload) {
  const account = normalizeLoginAccount_(payload.account || payload.user || '');
  const password = String(payload.password || '').trim();
  if (!account) return { ok: false, action: 'login', error: '請輸入公司信箱' };
  if (!password) return { ok: false, action: 'login', error: '請輸入密碼' };
  const sheet = getSettingsSheet_();
  const headerMap = buildSettingsHeaderMap_(sheet);
  const rowNumber = findEditorLoginRow_(sheet, headerMap, account);
  if (!rowNumber) return { ok: false, action: 'login', error: '找不到此公司信箱，請確認表單「帳號」欄位' };
  const todayPassword = currentAdminLoginPassword_();
  const isTestUserLogin = account === TEST_USER_ACCOUNT && password === TEST_USER_PASSWORD;
  if (!isTestUserLogin && password !== todayPassword) return { ok: false, action: 'login', error: '帳號或密碼不正確' };
  const values = sheet.getRange(rowNumber, 1, 1, Math.max(...Object.values(headerMap))).getDisplayValues()[0];
  const user = userNameFromSettingsRow_(values, headerMap, account, { email: account });
  if (!user) return { ok: false, action: 'login', error: '此帳號尚未設定名稱' };
  const token = Utilities.getUuid();
  saveEditorSession_(token, { user, account, provider: 'password' });
  return {
    ok: true,
    action: 'login',
    provider: 'password',
    user,
    account,
    email: account,
    token,
    expiresIn: EDITOR_SESSION_PERSIST_SECONDS,
    loginDebug: {
      provider: 'password',
      passwordMode: isTestUserLogin ? 'test-user' : 'date-MMDD',
      account,
      user,
      expiresIn: EDITOR_SESSION_PERSIST_SECONDS,
      scriptVersion: SCRIPT_VERSION
    },
    settings: readEditorSettingsFromRow_(sheet, headerMap, rowNumber)
  };
}

function currentAdminLoginPassword_() {
  return Utilities.formatDate(new Date(), ADMIN_LOGIN_PASSWORD_TIMEZONE, 'MMdd');
}

function currentLocalAdminToken_() {
  return `local-admin:${Utilities.formatDate(new Date(), ADMIN_LOGIN_PASSWORD_TIMEZONE, 'yyyyMMdd')}`;
}

function isLocalAdminToken_(token) {
  return String(token || '').trim() === currentLocalAdminToken_();
}

function checkUrlFetchAuthorization_() {
  try {
    const response = UrlFetchApp.fetch('https://oauth2.googleapis.com/tokeninfo', {
      muteHttpExceptions: true
    });
    return {
      ok: true,
      action: 'urlFetchAuthCheck',
      status: response.getResponseCode(),
      message: 'UrlFetchApp.fetch 可執行',
      scriptVersion: SCRIPT_VERSION
    };
  } catch (error) {
    return {
      ok: false,
      action: 'urlFetchAuthCheck',
      error: error && error.message ? error.message : String(error),
      reason: 'URLFETCH_AUTH_FAILED',
      rawError: String(error && (error.stack || error.message) || error),
      scriptVersion: SCRIPT_VERSION
    };
  }
}

function notifyDatabaseArchiveChanged_(details) {
  try {
    const token = String(
      PropertiesService.getScriptProperties().getProperty(DATABASE_ARCHIVE_GITHUB_TOKEN_PROPERTY) || ''
    ).trim();
    if (!token) {
      console.warn('Database archive dispatch skipped: missing ' + DATABASE_ARCHIVE_GITHUB_TOKEN_PROPERTY);
      return { ok: false, skipped: true, reason: 'TOKEN_NOT_CONFIGURED' };
    }

    const payload = {
      event_type: DATABASE_ARCHIVE_GITHUB_EVENT_TYPE,
      client_payload: {
        source: 'google-apps-script',
        action: String(details && details.action || 'database-write'),
        case_ids: (details && details.caseIds || []).map(String).filter(Boolean).slice(0, 20),
        changed_at: new Date().toISOString(),
        script_version: SCRIPT_VERSION
      }
    };
    const response = UrlFetchApp.fetch(
      'https://api.github.com/repos/' + DATABASE_ARCHIVE_GITHUB_REPOSITORY + '/dispatches',
      {
        method: 'post',
        contentType: 'application/json',
        headers: {
          Accept: 'application/vnd.github+json',
          Authorization: 'Bearer ' + token,
          'X-GitHub-Api-Version': '2026-03-10'
        },
        payload: JSON.stringify(payload),
        muteHttpExceptions: true
      }
    );
    const status = response.getResponseCode();
    if (status !== 204) {
      console.warn('Database archive dispatch failed: GitHub HTTP ' + status);
      return { ok: false, status };
    }
    return { ok: true, status };
  } catch (error) {
    console.warn('Database archive dispatch failed: ' + String(error && error.message || error));
    return { ok: false, error: String(error && error.message || error) };
  }
}

function databaseArchiveOnEdit(e) {
  const range = e && e.range;
  if (!range) return;
  const sheet = range.getSheet();
  if (
    sheet.getParent().getId() !== SPREADSHEET_ID ||
    sheet.getSheetId() !== TARGET_SHEET_ID ||
    range.getRow() <= 1
  ) return;
  notifyDatabaseArchiveChanged_({ action: 'sheet-edit' });
}

function installDatabaseArchiveEditTrigger() {
  const spreadsheet = SpreadsheetApp.openById(SPREADSHEET_ID);
  ScriptApp.getProjectTriggers()
    .filter(trigger => trigger.getHandlerFunction() === 'databaseArchiveOnEdit')
    .forEach(trigger => ScriptApp.deleteTrigger(trigger));
  const trigger = ScriptApp.newTrigger('databaseArchiveOnEdit')
    .forSpreadsheet(spreadsheet)
    .onEdit()
    .create();
  return { ok: true, triggerId: trigger.getUniqueId(), handler: trigger.getHandlerFunction() };
}

function testDatabaseArchiveDispatch() {
  return notifyDatabaseArchiveChanged_({ action: 'deployment-test' });
}

function authorizeGoogleLoginTokeninfoOnce() {
  const response = checkUrlFetchAuthorization_();
  Logger.log(JSON.stringify(response));
  return response;
}

function authenticateGoogleEditor_(payload) {
  const credential = String(payload.credential || payload.idToken || '').trim();
  if (!credential) return { ok: false, action: 'googleLogin', error: '缺少 Google 登入憑證' };
  const decodedProfile = decodeGoogleCredential_(credential) || {};
  const verifiedProfile = verifyGoogleIdToken_(credential, decodedProfile);
  if (!verifiedProfile.ok) return googleAuthErrorResponse_('googleLogin', verifiedProfile);
  return authenticateGoogleProfile_(Object.assign({}, decodedProfile, verifiedProfile.profile), 'googleLogin');
}

function erpOAuthConfig_(includeSecret) {
  const props = PropertiesService.getScriptProperties();
  const baseUrl = String(props.getProperty(ERP_OAUTH_PROPERTY_KEYS.baseUrl) || ERP_OAUTH_BASE_URL_DEFAULT).replace(/\/+$/, '');
  const clientId = String(props.getProperty(ERP_OAUTH_PROPERTY_KEYS.clientId) || '').trim();
  const clientSecret = includeSecret ? String(props.getProperty(ERP_OAUTH_PROPERTY_KEYS.clientSecret) || '').trim() : '';
  const redirectUri = String(props.getProperty(ERP_OAUTH_PROPERTY_KEYS.redirectUri) || '').trim();
  return { baseUrl, clientId, clientSecret, redirectUri };
}

function erpLoginConfig_() {
  const config = erpOAuthConfig_(false);
  return {
    ok: Boolean(config.clientId && config.redirectUri),
    action: 'erpLoginConfig',
    baseUrl: config.baseUrl,
    clientId: config.clientId,
    redirectUri: config.redirectUri,
    scope: ERP_OAUTH_SCOPE,
    missing: [
      config.clientId ? '' : ERP_OAUTH_PROPERTY_KEYS.clientId,
      config.redirectUri ? '' : ERP_OAUTH_PROPERTY_KEYS.redirectUri
    ].filter(Boolean),
    scriptVersion: SCRIPT_VERSION
  };
}

function authenticateErpEditor_(payload) {
  const code = String(payload.code || '').trim();
  const codeVerifier = String(payload.codeVerifier || payload.code_verifier || '').trim();
  const redirectUriFromPayload = String(payload.redirectUri || payload.redirect_uri || '').trim();
  if (!code) return { ok: false, action: 'erpLogin', error: '缺少 ERP 授權碼' };
  if (!codeVerifier) return { ok: false, action: 'erpLogin', error: '缺少 ERP PKCE verifier' };

  const config = erpOAuthConfig_(true);
  const missing = [];
  if (!config.clientId) missing.push(ERP_OAUTH_PROPERTY_KEYS.clientId);
  if (!config.clientSecret) missing.push(ERP_OAUTH_PROPERTY_KEYS.clientSecret);
  if (!config.redirectUri) missing.push(ERP_OAUTH_PROPERTY_KEYS.redirectUri);
  if (missing.length) {
    return { ok: false, action: 'erpLogin', error: 'ERP OAuth 尚未完成後端設定', reason: 'ERP_CONFIG_MISSING', missing };
  }
  if (redirectUriFromPayload && redirectUriFromPayload !== config.redirectUri) {
    return { ok: false, action: 'erpLogin', error: 'ERP redirect_uri 與後端設定不一致', reason: 'ERP_REDIRECT_URI_MISMATCH', expectedRedirectUri: config.redirectUri, receivedRedirectUri: redirectUriFromPayload };
  }

  const token = exchangeErpAuthorizationCode_(config, code, codeVerifier);
  if (!token.ok) return token;
  const identity = fetchErpUserInfo_(config, token.accessToken);
  if (!identity.ok) return identity;
  return authenticateErpProfile_(identity.profile, 'erpLogin');
}

function exchangeErpAuthorizationCode_(config, code, codeVerifier) {
  const response = UrlFetchApp.fetch(config.baseUrl + '/api/oauth/token', {
    method: 'post',
    contentType: 'application/x-www-form-urlencoded',
    muteHttpExceptions: true,
    payload: {
      grant_type: 'authorization_code',
      code,
      redirect_uri: config.redirectUri,
      client_id: config.clientId,
      client_secret: config.clientSecret,
      code_verifier: codeVerifier
    }
  });
  const status = response.getResponseCode();
  const text = response.getContentText();
  let data = {};
  try {
    data = JSON.parse(text || '{}');
  } catch (error) {
    return { ok: false, action: 'erpLogin', error: 'ERP token 回傳格式錯誤', reason: 'ERP_TOKEN_JSON_ERROR', status, raw: String(text || '').slice(0, 300) };
  }
  if (status < 200 || status >= 300 || !data.access_token) {
    return { ok: false, action: 'erpLogin', error: data.error_description || data.error || `ERP token 換取失敗：${status}`, reason: data.error || 'ERP_TOKEN_FAILED', status };
  }
  return { ok: true, accessToken: String(data.access_token), expiresIn: Number(data.expires_in) || 0 };
}

function fetchErpUserInfo_(config, accessToken) {
  const response = UrlFetchApp.fetch(config.baseUrl + '/api/oauth/userinfo', {
    method: 'get',
    headers: { Authorization: 'Bearer ' + accessToken },
    muteHttpExceptions: true
  });
  const status = response.getResponseCode();
  const text = response.getContentText();
  let profile = {};
  try {
    profile = JSON.parse(text || '{}');
  } catch (error) {
    return { ok: false, action: 'erpLogin', error: 'ERP userinfo 回傳格式錯誤', reason: 'ERP_USERINFO_JSON_ERROR', status, raw: String(text || '').slice(0, 300) };
  }
  if (status < 200 || status >= 300) {
    return { ok: false, action: 'erpLogin', error: profile.error_description || profile.error || `ERP userinfo 讀取失敗：${status}`, reason: profile.error || 'ERP_USERINFO_FAILED', status };
  }
  return { ok: true, profile };
}

function authenticateErpProfile_(profile, action) {
  if (!profile || profile.is_active === false) return { ok: false, action, error: 'ERP 帳號已停用或無效', reason: 'ERP_ACCOUNT_INACTIVE' };
  const account = normalizeLoginAccount_(profile.email || '');
  if (!account) return { ok: false, action, error: 'ERP 身份未回傳 email', reason: 'ERP_EMAIL_MISSING', erpProfile: profile };
  if (!account.endsWith(LOGIN_DOMAIN)) return { ok: false, action, error: `請使用 ${LOGIN_DOMAIN} 公司帳號登入`, reason: 'DOMAIN_NOT_ALLOWED', receivedEmail: account };
  const sheet = getSettingsSheet_();
  const headerMap = buildSettingsHeaderMap_(sheet);
  const rowNumber = findOrCreateGoogleEditorRow_(sheet, headerMap, account, {
    email: account,
    name: profile.name || profile.name_en || '',
    given_name: '',
    family_name: '',
    email_verified: true
  });
  const values = sheet.getRange(rowNumber, 1, 1, Math.max(...Object.values(headerMap))).getDisplayValues()[0];
  const user = userNameFromSettingsRow_(values, headerMap, account, {
    email: account,
    name: profile.name || profile.name_en || account,
    email_verified: true
  });
  if (!user) return { ok: false, action, error: '此 ERP 帳號尚未設定名稱' };
  upsertPrivateUserDirectoryRecord_({
    name: user,
    email: account,
    department: profile.department || ''
  });
  const token = Utilities.getUuid();
  saveEditorSession_(token, { user, account, provider: 'erp', erpEmployeeId: profile.employee_id || '' });
  return {
    ok: true,
    action,
    provider: 'erp',
    user,
    account,
    email: account,
    token,
    expiresIn: EDITOR_SESSION_PERSIST_SECONDS,
    loginDebug: {
      provider: 'erp',
      account,
      user,
      employeeId: profile.employee_id || '',
      department: profile.department || '',
      role: profile.role || '',
      isPm: Boolean(profile.is_pm),
      expiresIn: EDITOR_SESSION_PERSIST_SECONDS,
      scriptVersion: SCRIPT_VERSION
    },
    erpProfile: {
      employee_id: profile.employee_id || '',
      name: profile.name || '',
      name_en: profile.name_en || '',
      email: account,
      role: profile.role || '',
      department: profile.department || '',
      rank: profile.rank || '',
      title: profile.title || '',
      is_pm: Boolean(profile.is_pm)
    },
    settings: readEditorSettingsFromRow_(sheet, headerMap, rowNumber)
  };
}

function erpLoginRedirectResponse_(payload, params) {
  const returnUri = sanitizeFrontReturnUri_(payload.returnUri || params.returnUri || '');
  const loginPayload = {
    action: 'erpLogin',
    code: payload.code || '',
    codeVerifier: payload.codeVerifier || payload.code_verifier || '',
    redirectUri: payload.redirectUri || payload.redirect_uri || ''
  };
  let result;
  try {
    result = authenticateErpEditor_(loginPayload);
  } catch (error) {
    result = appsScriptErrorResponse_(error);
    result.action = 'erpLogin';
  }
  return redirectLoginResultResponse_(returnUri, 'erp_login_result', result, 'ERP 登入返回中...');
}

function googleLoginRedirectResponse_(payload, params) {
  const returnUri = sanitizeFrontReturnUri_(payload.returnUri || params.returnUri || '');
  let result;
  try {
    result = authenticateGoogleEditor_({
      action: 'googleLogin',
      credential: payload.credential || payload.idToken || payload.id_token || ''
    });
  } catch (error) {
    result = appsScriptErrorResponse_(error);
    result.action = 'googleLogin';
  }
  return redirectLoginResultResponse_(returnUri, 'google_login_result', result, 'Google 登入返回中...');
}

function loginRedirectResponse_(payload, params) {
  const returnUri = sanitizeFrontReturnUri_(payload.returnUri || params.returnUri || '');
  let result;
  try {
    result = authenticateEditor_({
      action: 'login',
      account: payload.account || payload.user || '',
      password: payload.password || ''
    });
  } catch (error) {
    result = appsScriptErrorResponse_(error);
    result.action = 'login';
  }
  return redirectLoginResultResponse_(returnUri, 'admin_login_result', result, '管理者登入返回中...');
}

function redirectLoginResultResponse_(returnUri, hashKey, result, message) {
  const encoded = Utilities.base64EncodeWebSafe(JSON.stringify(result), Utilities.Charset.UTF_8);
  const target = returnUri + '#' + hashKey + '=' + encodeURIComponent(encoded);
  const safeMessage = escapeHtml_(message);
  const safeTarget = escapeHtml_(target);
  return HtmlService.createHtmlOutput(
    '<!doctype html><meta charset="utf-8">' +
    '<base target="_top">' +
    '<title>' + safeMessage + '</title>' +
    '<div style="min-height:100vh;display:grid;place-items:center;background:#f6f8f7;font-family:-apple-system,BlinkMacSystemFont,Segoe UI,sans-serif;color:#24332f">' +
    '<div style="width:min(420px,calc(100vw - 40px));padding:24px;border:1px solid #dbe4df;border-radius:16px;background:#fff;box-shadow:0 16px 40px rgba(16,24,40,.12);text-align:center">' +
    '<h1 style="margin:0 0 10px;font-size:20px">' + safeMessage + '</h1>' +
    '<p style="margin:0 0 18px;font-size:13px;color:#64716b;line-height:1.7">驗證已完成，請點下方按鈕返回設計需求系統。</p>' +
    '<a id="returnLink" href="' + safeTarget + '" target="_top" rel="noreferrer" style="display:inline-flex;align-items:center;justify-content:center;min-height:42px;padding:0 22px;border-radius:10px;background:#14966d;color:#fff;text-decoration:none;font-weight:800">返回系統</a>' +
    '</div></div>' +
    '<noscript><p style="font-size:12px;color:#64716b">請使用下方按鈕返回系統。</p></noscript>'
  ).setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL);
}

function sanitizeFrontReturnUri_(value) {
  const text = String(value || '').trim();
  const allowed = 'https://emctaipeiart.github.io';
  if (text === allowed || text === allowed + '/') return text.replace(/\/+$/, '');
  return allowed;
}

function escapeHtml_(value) {
  return String(value || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function findOptionalSettingsHeaderColumn_(sheet, headers) {
  const lastColumn = Math.max(sheet.getLastColumn(), 1);
  const values = sheet.getRange(1, 1, 1, lastColumn).getDisplayValues()[0].map(value => String(value || '').trim());
  const accepted = headers.map(value => String(value || '').trim().toLowerCase());
  const index = values.findIndex(value => accepted.indexOf(value.toLowerCase()) >= 0);
  return index >= 0 ? index + 1 : 0;
}

function authenticateGoogleEmailEditor_(payload) {
  return {
    ok: false,
    action: 'googleEmailLogin',
    error: 'GOOGLE_EMAIL_LOGIN_DISABLED',
    reason: 'googleEmailLogin 已停用，不能只靠前端傳 email 登入。',
    expectedClientId: GOOGLE_OAUTH_CLIENT_ID,
    receivedEmail: normalizeLoginAccount_(payload && payload.email)
  };
}

function decodeGoogleCredential_(credential) {
  const parts = String(credential || '').split('.');
  if (parts.length < 2) return null;
  try {
    const payload = parts[1].replace(/-/g, '+').replace(/_/g, '/');
    const padded = payload + '==='.slice((payload.length + 3) % 4);
    return JSON.parse(Utilities.newBlob(Utilities.base64Decode(padded)).getDataAsString());
  } catch (err) {
    return null;
  }
}

function verifyGoogleIdToken_(credential, decodedProfile) {
  let tokenInfo = {};
  try {
    const response = UrlFetchApp.fetch('https://oauth2.googleapis.com/tokeninfo?id_token=' + encodeURIComponent(credential), {
      muteHttpExceptions: true
    });
    const status = response.getResponseCode();
    const text = response.getContentText();
    try {
      tokenInfo = JSON.parse(text || '{}');
    } catch (error) {
      return {
        ok: false,
        reason: 'TOKENINFO_JSON_ERROR',
        message: 'Google tokeninfo 回傳格式錯誤',
        raw: String(text || '').slice(0, 300),
        profile: decodedProfile || {}
      };
    }
    if (status < 200 || status >= 300 || tokenInfo.error) {
      return {
        ok: false,
        reason: 'TOKENINFO_REJECTED',
        message: tokenInfo.error_description || tokenInfo.error || `Google tokeninfo 驗證失敗：${status}`,
        profile: Object.assign({}, decodedProfile || {}, tokenInfo)
      };
    }
  } catch (error) {
    if (isUrlFetchAuthorizationError_(error)) {
      return verifyGoogleIdTokenByDecodedPayload_(decodedProfile, error);
    }
    return {
      ok: false,
      reason: 'TOKENINFO_FETCH_FAILED',
      message: '無法向 Google tokeninfo 驗證登入憑證：' + (error.message || error),
      profile: decodedProfile || {}
    };
  }

  const profile = Object.assign({}, decodedProfile || {}, tokenInfo);
  const account = normalizeLoginAccount_(profile.email || '');
  const emailVerified = String(profile.email_verified).toLowerCase() === 'true' || profile.email_verified === true;
  if (profile.aud !== GOOGLE_OAUTH_CLIENT_ID) {
    return { ok: false, reason: 'CLIENT_ID_MISMATCH', message: 'Google OAuth client_id 不符合', profile };
  }
  if (!emailVerified) {
    return { ok: false, reason: 'EMAIL_NOT_VERIFIED', message: 'Google 信箱尚未通過驗證', profile };
  }
  if (!account) {
    return { ok: false, reason: 'EMAIL_MISSING', message: 'Google 帳號沒有 email', profile };
  }
  if (!account.endsWith(LOGIN_DOMAIN)) {
    return { ok: false, reason: 'DOMAIN_NOT_ALLOWED', message: `請使用 ${LOGIN_DOMAIN} 公司信箱登入`, profile };
  }
  return { ok: true, profile };
}

function isUrlFetchAuthorizationError_(error) {
  const message = String(error && (error.message || error) || '');
  return /UrlFetchApp\.fetch|script\.external_request|沒有呼叫|權限/i.test(message);
}

function verifyGoogleIdTokenByDecodedPayload_(decodedProfile, sourceError) {
  const profile = decodedProfile || {};
  const nowSeconds = Math.floor(Date.now() / 1000);
  const expiresAt = Number(profile.exp || 0);
  if (!profile.aud) {
    return {
      ok: false,
      reason: 'TOKENINFO_FETCH_FAILED',
      message: 'Apps Script 尚未授權 UrlFetchApp.fetch，且 Google token 缺少 aud，無法登入。',
      profile
    };
  }
  if (expiresAt && expiresAt < nowSeconds) {
    return {
      ok: false,
      reason: 'TOKEN_EXPIRED',
      message: 'Google 登入憑證已過期，請重新登入。',
      profile
    };
  }
  return {
    ok: true,
    profile: Object.assign({}, profile, {
      tokeninfoFallback: true,
      tokeninfoFallbackReason: 'URLFETCH_AUTH_FAILED',
      tokeninfoFallbackError: sourceError && sourceError.message ? sourceError.message : String(sourceError || '')
    })
  };
}

function googleAuthErrorResponse_(action, result) {
  const profile = (result && result.profile) || {};
  return {
    ok: false,
    action,
    error: result.message || result.reason || 'Google 登入驗證失敗',
    reason: result.reason || 'GOOGLE_AUTH_FAILED',
    expectedClientId: GOOGLE_OAUTH_CLIENT_ID,
    receivedAud: profile.aud || '',
    receivedEmail: normalizeLoginAccount_(profile.email || ''),
    emailVerified: profile.email_verified === true || String(profile.email_verified).toLowerCase() === 'true',
    scriptVersion: SCRIPT_VERSION
  };
}

function authenticateGoogleProfile_(profile, action) {
  if (profile.aud !== GOOGLE_OAUTH_CLIENT_ID) return googleAuthErrorResponse_(action, { reason: 'CLIENT_ID_MISMATCH', message: 'Google OAuth client_id 不符合', profile });
  if (!(profile.email_verified === true || String(profile.email_verified).toLowerCase() === 'true')) return googleAuthErrorResponse_(action, { reason: 'EMAIL_NOT_VERIFIED', message: 'Google 信箱尚未通過驗證', profile });
  const account = normalizeLoginAccount_(profile.email || '');
  if (!account) return googleAuthErrorResponse_(action, { reason: 'EMAIL_MISSING', message: 'Google 帳號沒有 email', profile });
  if (!account.endsWith(LOGIN_DOMAIN)) return googleAuthErrorResponse_(action, { reason: 'DOMAIN_NOT_ALLOWED', message: `請使用 ${LOGIN_DOMAIN} 公司信箱登入`, profile });
  const sheet = getSettingsSheet_();
  const headerMap = buildSettingsHeaderMap_(sheet);
  const rowNumber = findOrCreateGoogleEditorRow_(sheet, headerMap, account, profile);
  const values = sheet.getRange(rowNumber, 1, 1, Math.max(...Object.values(headerMap))).getDisplayValues()[0];
  const user = userNameFromSettingsRow_(values, headerMap, account, profile);
  if (!user) return { ok: false, action, error: '此帳號尚未設定名稱' };
  const token = Utilities.getUuid();
  saveEditorSession_(token, { user, account, provider: 'google' });
  return {
    ok: true,
    action,
    user,
    account,
    email: account,
    token,
    expiresIn: EDITOR_SESSION_PERSIST_SECONDS,
    loginDebug: {
      account,
      user,
      aud: profile.aud || '',
      expiresIn: EDITOR_SESSION_PERSIST_SECONDS,
      scriptVersion: SCRIPT_VERSION,
      tokeninfoFallback: Boolean(profile.tokeninfoFallback),
      tokeninfoFallbackReason: profile.tokeninfoFallbackReason || ''
    },
    settings: readEditorSettingsFromRow_(sheet, headerMap, rowNumber)
  };
}

function editorSessionPropertyKey_(token) {
  return EDITOR_SESSION_PROPERTY_PREFIX + String(token || '').trim();
}

function saveEditorSession_(token, session, expiresAt) {
  token = String(token || '').trim();
  if (!token) return null;
  const saved = Object.assign({}, session || {}, {
    expiresAt: Number(expiresAt) || Date.now() + EDITOR_SESSION_PERSIST_SECONDS * 1000
  });
  const raw = JSON.stringify(saved);
  CacheService.getScriptCache().put(`editor:${token}`, raw, EDITOR_SESSION_SECONDS);
  PropertiesService.getScriptProperties().setProperty(editorSessionPropertyKey_(token), raw);
  return saved;
}

function removeEditorSession_(token) {
  token = String(token || '').trim();
  if (!token) return;
  CacheService.getScriptCache().remove(`editor:${token}`);
  PropertiesService.getScriptProperties().deleteProperty(editorSessionPropertyKey_(token));
}

function readEditorSession_(token, renew) {
  token = String(token || '').trim();
  if (!token) return null;
  const cache = CacheService.getScriptCache();
  const properties = PropertiesService.getScriptProperties();
  let raw = cache.get(`editor:${token}`);
  if (!raw) raw = properties.getProperty(editorSessionPropertyKey_(token));
  if (!raw) return null;
  let session;
  try {
    session = JSON.parse(raw);
  } catch (error) {
    session = { user: raw, account: normalizeLoginAccount_(raw), expiresAt: Date.now() + EDITOR_SESSION_PERSIST_SECONDS * 1000 };
  }
  const expiresAt = Number(session.expiresAt) || 0;
  if (expiresAt && expiresAt <= Date.now()) {
    removeEditorSession_(token);
    return null;
  }
  if (renew && (!expiresAt || expiresAt - Date.now() <= EDITOR_SESSION_RENEW_WINDOW_SECONDS * 1000)) {
    return saveEditorSession_(token, session);
  }
  cache.put(`editor:${token}`, JSON.stringify(session), EDITOR_SESSION_SECONDS);
  return session;
}

function verifyEditorToken_(payload) {
  const token = String(payload && payload.editorToken || '').trim();
  if (!token) return { ok: false, action: 'verifyToken', error: 'TOKEN_EXPIRED' };
  const session = readEditorSession_(token, true);
  if (!session) return { ok: false, action: 'verifyToken', error: 'TOKEN_EXPIRED' };
  const account = normalizeLoginAccount_(session.account || '');
  const user = String(session.user || '').trim();
  if (!user && !account) return { ok: false, action: 'verifyToken', error: 'TOKEN_EXPIRED' };
  return {
    ok: true,
    action: 'verifyToken',
    user,
    account,
    email: account,
    expiresIn: EDITOR_SESSION_PERSIST_SECONDS,
    settings: readEditorSettings_(account || user),
    access: accountAccessProfile_(token)
  };
}

function logoutEditorToken_(payload) {
  const token = String(payload && payload.editorToken || '').trim();
  if (token) removeEditorSession_(token);
  return { ok: true, action: 'logout' };
}

function userNameFromSettingsRow_(values, headerMap, account, profile) {
  const nameFromSheet = String(values[headerMap[USER_SETTING_NAME_HEADER] - 1] || '').trim();
  if (nameFromSheet) return nameFromSheet;
  const directoryName = privateUserDirectoryRecord_(account).name;
  if (directoryName) return directoryName;
  const profileName = googleProfileDisplayName_(profile);
  if (profileName) return profileName;
  return String(account || '').split('@')[0].trim();
}

function googleProfileDisplayName_(profile) {
  if (!profile) return '';
  const familyName = String(profile.family_name || profile.familyName || '').trim();
  const givenName = String(profile.given_name || profile.givenName || '').trim();
  const compactName = `${familyName}${givenName}`.trim();
  if (compactName) return compactName;
  return String(profile.name || profile.displayName || '').trim();
}

function normalizeLoginAccount_(value) {
  const text = String(value || '').trim().toLowerCase();
  if (!text) return '';
  return text.indexOf('@') >= 0 ? text : `${text}${LOGIN_DOMAIN}`;
}

function normalizePrivateUserDirectoryRecord_(record) {
  record = record || {};
  const email = normalizeLoginAccount_(record.email || record.account || '');
  return {
    name: String(record.name || record['名字'] || '').trim(),
    email,
    department: String(record.department || record['部門'] || '').trim(),
    group: String(record.group || record['組別'] || '').trim()
  };
}

function readPrivateUserDirectory_() {
  const raw = PropertiesService.getScriptProperties().getProperty(USER_DIRECTORY_PROPERTY);
  let savedRecords = [];
  try {
    const parsed = raw ? JSON.parse(raw) : [];
    savedRecords = Array.isArray(parsed) ? parsed : [];
  } catch (error) {
    throw new Error('私有使用者名錄格式錯誤');
  }
  const byEmail = {};
  savedRecords.concat(USER_DIRECTORY)
    .map(normalizePrivateUserDirectoryRecord_)
    .filter(record => record.email)
    .forEach(record => { byEmail[record.email] = record; });
  return Object.keys(byEmail).sort().map(email => byEmail[email]);
}

function privateUserDirectoryRecord_(account) {
  const normalizedAccount = normalizeLoginAccount_(account);
  if (!normalizedAccount) return { name: '', email: '', department: '', group: '' };
  return readPrivateUserDirectory_().find(record => record.email === normalizedAccount) || {
    name: '',
    email: normalizedAccount,
    department: '',
    group: ''
  };
}

function savePrivateUserDirectory_(records) {
  const byEmail = {};
  (records || [])
    .map(normalizePrivateUserDirectoryRecord_)
    .filter(record => record.email)
    .forEach(record => { byEmail[record.email] = record; });
  const normalized = Object.keys(byEmail).sort().map(email => byEmail[email]);
  PropertiesService.getScriptProperties().setProperty(
    USER_DIRECTORY_PROPERTY,
    JSON.stringify(normalized)
  );
  return normalized;
}

function upsertPrivateUserDirectoryRecord_(record) {
  const normalized = normalizePrivateUserDirectoryRecord_(record);
  if (!normalized.email) return null;
  const records = readPrivateUserDirectory_();
  const index = records.findIndex(item => item.email === normalized.email);
  if (index >= 0) {
    records[index] = {
      name: normalized.name || records[index].name,
      email: normalized.email,
      department: normalized.department || records[index].department,
      group: normalized.group || records[index].group
    };
  } else {
    records.push(normalized);
  }
  return savePrivateUserDirectory_(records)
    .find(item => item.email === normalized.email) || normalized;
}

/**
 * 在 Apps Script 編輯器手動執行，匯入名字、Email、部門與組別到私有 Script Properties。
 */
function syncPrivateUserDirectoryFromSettingsOnce() {
  const sheet = getSettingsSheet_();
  const headerMap = buildSettingsHeaderMap_(sheet);
  const lastRow = sheet.getLastRow();
  if (lastRow < 2) return { success: true, count: 0 };
  const width = Math.max(...Object.values(headerMap));
  const values = sheet.getRange(2, 1, lastRow - 1, width).getDisplayValues();
  const imported = values.map(row => normalizePrivateUserDirectoryRecord_({
    name: row[headerMap[USER_SETTING_NAME_HEADER] - 1],
    email: row[headerMap['帳號'] - 1],
    department: row[headerMap[USER_DEPARTMENT_HEADER] - 1],
    group: row[headerMap[USER_GROUP_HEADER] - 1]
  })).filter(record => record.email);
  const saved = savePrivateUserDirectory_(readPrivateUserDirectory_().concat(imported));
  return { success: true, count: saved.length, property: USER_DIRECTORY_PROPERTY };
}

function editorUserFromToken_(token) {
  token = String(token || '').trim();
  if (!token) return '';
  if (isLocalAdminToken_(token)) return '管理者';
  const session = readEditorSession_(token, false);
  return session ? String(session.user || '').trim() : '';
}

function editorAccountFromToken_(token) {
  token = String(token || '').trim();
  if (!token) return '';
  if (isLocalAdminToken_(token)) return 'local-admin';
  const session = readEditorSession_(token, false);
  return session ? normalizeLoginAccount_(session.account || '') : '';
}

function editorDisplayNameFromToken_(token) {
  token = String(token || '').trim();
  if (!token) return '';
  if (isLocalAdminToken_(token)) return '管理者';
  const session = readEditorSession_(token, false);
  if (!session) return '';
  const account = normalizeLoginAccount_(session.account || '');
  const settings = readEditorSettings_(account || session.user || '');
  return String(settings.displayName || settings[USER_DISPLAY_NAME_HEADER] || session.user || '').trim();
}

function findOrCreateGoogleEditorRow_(sheet, headerMap, account, profile) {
  const rowNumber = findEditorLoginRow_(sheet, headerMap, account);
  const targetRow = rowNumber || Math.max(sheet.getLastRow() + 1, 2);
  sheet.getRange(targetRow, headerMap['帳號']).setValue(account);
  const directoryRecord = privateUserDirectoryRecord_(account);
  const nameCell = sheet.getRange(targetRow, headerMap[USER_SETTING_NAME_HEADER]);
  const existingName = String(nameCell.getDisplayValue() || '').trim();
  const canonicalName = existingName || directoryRecord.name || googleProfileDisplayName_(profile) || String(account || '').split('@')[0].trim();
  if (!existingName) nameCell.setValue(canonicalName);
  const displayNameCell = sheet.getRange(targetRow, headerMap[USER_DISPLAY_NAME_HEADER]);
  if (!String(displayNameCell.getDisplayValue() || '').trim()) {
    displayNameCell.setValue(canonicalName);
  }
  const departmentCell = sheet.getRange(targetRow, headerMap[USER_DEPARTMENT_HEADER]);
  if (!String(departmentCell.getDisplayValue() || '').trim()) {
    const department = directoryRecord.department || String(profile && profile.department || '').trim();
    if (department) departmentCell.setValue(department);
  }
  const groupCell = sheet.getRange(targetRow, headerMap[USER_GROUP_HEADER]);
  if (!String(groupCell.getDisplayValue() || '').trim() && directoryRecord.group) {
    groupCell.setValue(directoryRecord.group);
  }
  SpreadsheetApp.flush();
  return targetRow;
}

function assertEditorTokenForUser_(payload) {
  const requestedAccount = normalizeLoginAccount_(payload && (payload.account || payload.email || ''));
  const tokenAccount = editorAccountFromToken_(payload && payload.editorToken);
  const tokenUser = editorUserFromToken_(payload && payload.editorToken);
  if (tokenAccount && (!requestedAccount || tokenAccount === requestedAccount)) return tokenAccount;
  if (!tokenAccount && tokenUser) return tokenUser;
  throw new Error('請先登入後再儲存個人設定');
}

function assertEditorPermission_(payload, row, writeHeaders) {
  const headers = normalizeWriteHeaders_(writeHeaders || []);
  const touchesStatus = headers.indexOf('案件狀態') >= 0;
  const touchesDetails = headers.indexOf('項目細節') >= 0;
  const statusValue = String((row && (row.status || row['案件狀態'])) || '').trim();
  const onlyPublicCancel = touchesStatus && !touchesDetails && statusValue === '已取消';
  if ((!touchesStatus && !touchesDetails) || onlyPublicCancel) return;
  if (editorUserFromToken_(payload.editorToken)) return;
  throw new Error('請先登入後再修改狀態或項目細節');
}

function updatePayloadRow_(payload) {
  const row = Object.assign({}, payload.row || {}, payload.changes || {});
  if (Object.prototype.hasOwnProperty.call(payload, 'status')) row.status = payload.status;
  if (Object.prototype.hasOwnProperty.call(payload, 'details')) row.details = payload.details;
  if (Object.prototype.hasOwnProperty.call(payload, 'caseId') && !row.id) row.id = payload.caseId;
  if (Object.prototype.hasOwnProperty.call(payload, 'id') && !row.id) row.id = payload.id;
  return row;
}

function writeHeadersFromRow_(row) {
  const headers = [];
  if (row && (Object.prototype.hasOwnProperty.call(row, 'status') || Object.prototype.hasOwnProperty.call(row, '案件狀態'))) {
    headers.push('案件狀態');
  }
  if (row && (Object.prototype.hasOwnProperty.call(row, 'details') || Object.prototype.hasOwnProperty.call(row, '項目細節') || Object.prototype.hasOwnProperty.call(row, '項目細項'))) {
    headers.push('項目細節');
  }
  return headers;
}

function normalizeUpdateWriteHeaders_(headers) {
  const normalized = normalizeWriteHeaders_(headers);
  if (!normalized.length) return [];
  return normalized.filter(header => header !== '填單時間' && (
    FORM_WRITE_HEADERS.indexOf(header) >= 0 ||
    FORMULA_MANAGED_HEADERS.indexOf(header) >= 0 ||
    LIST_INLINE_WRITE_HEADERS.indexOf(header) >= 0
  ));
}

function normalizeUpdateForceHeaders_(headers) {
  return normalizeUpdateWriteHeaders_(headers);
}

function assertTarget_(payload) {
  if (!payload || !payload.targetSpreadsheetId) return;
  const sheetId = String(payload.targetSheetId || '');
  if (
    String(payload.targetSpreadsheetId) !== SPREADSHEET_ID ||
    String(payload.targetSheetName || '') !== SHEET_NAME ||
    sheetId !== String(TARGET_SHEET_ID)
  ) {
    throw new Error(`寫入目標不符，已拒絕寫入。目標必須是 ${SPREADSHEET_ID} / ${SHEET_NAME} / ${TARGET_SHEET_ID}`);
  }
}

function checkWriteAccess_(payload) {
  assertTarget_(payload);
  const lock = LockService.getScriptLock();
  let lockAvailable = false;
  try {
    lockAvailable = lock.tryLock(1000);
    const { sheet, headerRow, headerMap } = getSheetInfo_();
    const missingHeaders = FORM_WRITE_HEADERS.filter(header => !headerMap[header]);
    const writeColumns = FORM_WRITE_HEADERS.map(header => headerMap[header]).filter(Boolean);
    const rowNumber = firstBlankFormRow_(sheet, headerRow, headerMap);
    const startColumn = writeColumns.length ? Math.min(...writeColumns) : 1;
    const endColumn = writeColumns.length ? Math.max(...writeColumns) : 1;
    const rangeEditable = !missingHeaders.length && sheet.getRange(rowNumber, startColumn, 1, endColumn - startColumn + 1).canEdit();
    const canCreate = Boolean(lockAvailable && rangeEditable && !missingHeaders.length);
    return {
      ok: true,
      action: 'writeAccessCheck',
      checkedAt: Utilities.formatDate(new Date(), ADMIN_LOGIN_PASSWORD_TIMEZONE, "yyyy-MM-dd'T'HH:mm:ssXXX"),
      nonMutating: true,
      target: { spreadsheetId: SPREADSHEET_ID, sheetName: sheet.getName(), sheetId: sheet.getSheetId(), rowNumber },
      permissions: {
        createRequest: canCreate,
        updateRequest: canCreate,
        updateStatusDetails: false,
        reason: canCreate ? '一般使用者可新增或修改需求；案件狀態與項目細節為唯讀' : (missingHeaders.length ? `缺少寫入欄位：${missingHeaders.join('、')}` : (lockAvailable ? '目標範圍無法編輯' : '寫入鎖目前忙碌'))
      },
      checks: { lockAvailable, rangeEditable, missingHeaders }
    };
  } finally {
    if (lockAvailable) lock.releaseLock();
  }
}

function getSettingsSheet_() {
  const spreadsheet = SpreadsheetApp.openById(SPREADSHEET_ID);
  const idMatchedSheet = spreadsheet.getSheets().find(candidate => candidate.getSheetId() === SETTINGS_SHEET_ID);
  if (idMatchedSheet) return idMatchedSheet;
  const namedSheet = spreadsheet.getSheetByName('設定');
  if (namedSheet) return namedSheet;
  throw new Error('找不到設計師設定分頁');
}

function buildSettingsHeaderMap_(sheet) {
  const lastColumn = Math.max(sheet.getLastColumn(), USER_SETTING_COLUMN_HEADERS.length + USER_DISPLAY_SETTING_HEADERS.length + USER_AUTH_HEADERS.length + 2);
  const headers = sheet.getRange(1, 1, 1, lastColumn).getValues()[0].map(value => String(value || '').trim());
  const headerMap = {};

  let nameIndex = findSettingsHeaderIndex_(headers, USER_SETTING_NAME_HEADER);
  if (nameIndex < 0) {
    nameIndex = 0;
    sheet.getRange(1, nameIndex + 1).setValue(USER_SETTING_NAME_HEADER);
    headers[nameIndex] = USER_SETTING_NAME_HEADER;
  } else if (headers[nameIndex] !== USER_SETTING_NAME_HEADER) {
    sheet.getRange(1, nameIndex + 1).setValue(USER_SETTING_NAME_HEADER);
    headers[nameIndex] = USER_SETTING_NAME_HEADER;
  }
  headerMap[USER_SETTING_NAME_HEADER] = nameIndex + 1;

  let displayNameIndex = headers.indexOf(USER_DISPLAY_NAME_HEADER);
  if (displayNameIndex < 0) {
    displayNameIndex = headers.findIndex((value, candidateIndex) => candidateIndex > nameIndex && value === '');
    if (displayNameIndex < 0) displayNameIndex = headers.length;
    sheet.getRange(1, displayNameIndex + 1).setValue(USER_DISPLAY_NAME_HEADER);
    headers[displayNameIndex] = USER_DISPLAY_NAME_HEADER;
  }
  headerMap[USER_DISPLAY_NAME_HEADER] = displayNameIndex + 1;

  let departmentIndex = headers.indexOf(USER_DEPARTMENT_HEADER);
  if (departmentIndex < 0) {
    const legacyDepartmentIndex = headers.indexOf(USER_GROUP_HEADER);
    const legacyDesignTypeIndex = headers.indexOf('設計類型');
    if (legacyDepartmentIndex >= 0 && legacyDesignTypeIndex >= 0) {
      departmentIndex = legacyDepartmentIndex;
    } else {
      departmentIndex = headers.findIndex((value, candidateIndex) => candidateIndex > nameIndex && value === '');
      if (departmentIndex < 0) departmentIndex = headers.length;
    }
    sheet.getRange(1, departmentIndex + 1).setValue(USER_DEPARTMENT_HEADER);
    headers[departmentIndex] = USER_DEPARTMENT_HEADER;
  }
  headerMap[USER_DEPARTMENT_HEADER] = departmentIndex + 1;

  let groupIndex = findSettingsHeaderIndex_(headers, USER_GROUP_HEADER);
  if (groupIndex < 0) {
    groupIndex = headers.findIndex((value, candidateIndex) => candidateIndex > nameIndex && value === '');
    if (groupIndex < 0) groupIndex = headers.length;
    sheet.getRange(1, groupIndex + 1).setValue(USER_GROUP_HEADER);
    headers[groupIndex] = USER_GROUP_HEADER;
  } else if (headers[groupIndex] !== USER_GROUP_HEADER) {
    sheet.getRange(1, groupIndex + 1).setValue(USER_GROUP_HEADER);
    headers[groupIndex] = USER_GROUP_HEADER;
  }
  headerMap[USER_GROUP_HEADER] = groupIndex + 1;

  USER_AUTH_HEADERS.forEach(header => {
    let index = headers.indexOf(header);
    if (index < 0) {
      index = headers.findIndex(value => value === '');
      if (index < 0) index = headers.length;
      sheet.getRange(1, index + 1).setValue(header);
      headers[index] = header;
    }
    headerMap[header] = index + 1;
  });

  let avatarIndex = headers.indexOf(USER_AVATAR_HEADER);
  if (avatarIndex < 0) {
    avatarIndex = headers.findIndex(value => value === '');
    if (avatarIndex < 0) avatarIndex = headers.length;
    sheet.getRange(1, avatarIndex + 1).setValue(USER_AVATAR_HEADER);
    headers[avatarIndex] = USER_AVATAR_HEADER;
  }
  headerMap[USER_AVATAR_HEADER] = avatarIndex + 1;

  let rotationIndex = headers.indexOf(USER_NEW_PROJECT_ROTATION_HEADER);
  if (rotationIndex < 0) {
    rotationIndex = headers.findIndex(value => value === '');
    if (rotationIndex < 0) rotationIndex = headers.length;
    sheet.getRange(1, rotationIndex + 1).setValue(USER_NEW_PROJECT_ROTATION_HEADER);
    headers[rotationIndex] = USER_NEW_PROJECT_ROTATION_HEADER;
  }
  headerMap[USER_NEW_PROJECT_ROTATION_HEADER] = rotationIndex + 1;

  let settingsStart = findSettingsHeaderIndex_(headers, USER_SETTING_COLUMN_HEADERS[0]);
  if (settingsStart < 0) settingsStart = Math.max(headers.length, 6);
  USER_FILTER_SETTING_HEADERS.forEach((header, offset) => {
    const existingIndex = findSettingsHeaderIndex_(headers, header);
    if (existingIndex >= 0) {
      headerMap[header] = existingIndex + 1;
      return;
    }
    let index = headers.findIndex((value, candidateIndex) => candidateIndex < settingsStart && value === '');
    if (index < 0) index = headers.length;
    sheet.getRange(1, index + 1).setValue(header);
    headers[index] = header;
    headerMap[header] = index + 1;
  });
  USER_SETTING_COLUMN_HEADERS.forEach((header, offset) => {
    let index = findSettingsHeaderIndexFrom_(headers, header, settingsStart);
    if (index < 0 && USER_SETTING_NON_WRITABLE_COLUMN_HEADERS.indexOf(header) >= 0) {
      headerMap[header] = 0;
      return;
    }
    if (index < 0) {
      const preferredIndex = settingsStart + offset;
      index = headers[preferredIndex] ? headers.findIndex(value => value === '') : preferredIndex;
      if (index < 0) index = headers.length;
    }
    if (!headers[index] || (headers[index] !== header && (SETTINGS_HEADER_ALIASES[header] || []).indexOf(headers[index]) < 0)) {
      sheet.getRange(1, index + 1).setValue(header);
      headers[index] = header;
    }
    headerMap[header] = index + 1;
  });
  const displayStart = settingsStart + USER_SETTING_COLUMN_HEADERS.length;
  USER_DISPLAY_SETTING_HEADERS.forEach((header, offset) => {
    const existingIndex = findSettingsHeaderIndex_(headers, header);
    if (existingIndex >= 0) {
      if (headers[existingIndex] !== header) {
        sheet.getRange(1, existingIndex + 1).setValue(header);
        headers[existingIndex] = header;
      }
      headerMap[header] = existingIndex + 1;
      return;
    }
    let index = displayStart + offset;
    if (headers[index] && headers[index] !== header) {
      index = headers.findIndex((value, candidateIndex) => candidateIndex >= displayStart && value === '');
      if (index < 0) index = headers.length;
    }
    if (headers[index] !== header) {
      sheet.getRange(1, index + 1).setValue(header);
      headers[index] = header;
    }
    headerMap[header] = index + 1;
  });
  return headerMap;
}

function findSettingsHeaderIndex_(headers, header) {
  const exactIndex = headers.findIndex(value => String(value || '').trim() === header);
  if (exactIndex >= 0) return exactIndex;
  const accepted = [header].concat(SETTINGS_HEADER_ALIASES[header] || []);
  return headers.findIndex(value => accepted.indexOf(String(value || '').trim()) >= 0);
}

function findSettingsHeaderIndexFrom_(headers, header, startIndex) {
  const accepted = [header].concat(SETTINGS_HEADER_ALIASES[header] || []);
  for (let index = Math.max(0, startIndex || 0); index < headers.length; index += 1) {
    if (accepted.indexOf(String(headers[index] || '').trim()) >= 0) return index;
  }
  return -1;
}

function findEditorLoginRow_(sheet, headerMap, account) {
  account = normalizeLoginAccount_(account);
  const accountColumn = headerMap['帳號'];
  const lastRow = Math.max(sheet.getLastRow(), 1);
  if (!account || lastRow <= 1) return 0;
  const values = sheet.getRange(2, accountColumn, lastRow - 1, 1).getDisplayValues().flat();
  const rowIndex = values.findIndex(value => normalizeLoginAccount_(value || '') === account);
  return rowIndex >= 0 ? rowIndex + 2 : 0;
}

function findEditorSettingsRow_(sheet, headerMap, user, createIfMissing) {
  const account = normalizeLoginAccount_(String(user || '').includes('@') ? user : '');
  if (account) {
    const accountRow = findEditorLoginRow_(sheet, headerMap, account);
    if (accountRow) return accountRow;
    if (!createIfMissing) return 0;
    const rowNumber = Math.max(sheet.getLastRow() + 1, 2);
    sheet.getRange(rowNumber, headerMap['帳號']).setValue(account);
    return rowNumber;
  }
  const nameColumn = headerMap[USER_SETTING_NAME_HEADER];
  const lastRow = Math.max(sheet.getLastRow(), 1);
  if (lastRow > 1) {
    const names = sheet.getRange(2, nameColumn, lastRow - 1, 1).getDisplayValues().flat().map(value => String(value || '').trim());
    const index = names.findIndex(name => name === user);
    if (index >= 0) return index + 2;
  }
  if (!createIfMissing) return 0;
  const rowNumber = lastRow + 1;
  sheet.getRange(rowNumber, nameColumn).setValue(user);
  return rowNumber;
}

function readEditorSettings_(user) {
  user = String(user || '').trim();
  if (!user) return {};
  const sheet = getSettingsSheet_();
  const headerMap = buildSettingsHeaderMap_(sheet);
  const rowNumber = findEditorSettingsRow_(sheet, headerMap, user, false);
  if (!rowNumber) return {};
  return readEditorSettingsFromRow_(sheet, headerMap, rowNumber);
}

function readEditorSettingsFromRow_(sheet, headerMap, rowNumber) {
  const values = sheet.getRange(rowNumber, 1, 1, Math.max(...Object.values(headerMap))).getDisplayValues()[0];
  const account = normalizeLoginAccount_(values[headerMap['帳號'] - 1] || '');
  const directoryRecord = privateUserDirectoryRecord_(account);
  const name = String(values[headerMap[USER_SETTING_NAME_HEADER] - 1] || directoryRecord.name || '').trim();
  const displayName = String(values[headerMap[USER_DISPLAY_NAME_HEADER] - 1] || name).trim();
  const columnValues = USER_SETTING_COLUMN_HEADERS.map(header => String(values[headerMap[header] - 1] || '').trim().toLowerCase());
  const hasColumnSettings = columnValues.some(value => value === 'v' || value === 'x' || /^\d+$/.test(value));
  const orderedColumnSettings = USER_SETTING_COLUMN_HEADERS
    .map((header, index) => {
      const value = String(values[headerMap[header] - 1] || '').trim().toLowerCase();
      const numericOrder = /^\d+$/.test(value) ? Number(value) : 0;
      return {
        header,
        key: USER_SETTING_HEADER_TO_KEY[header],
        index,
        value,
        visible: value === 'v' || numericOrder > 0,
        order: numericOrder || 999 + index
      };
    })
    .filter(item => item.key && item.visible)
    .sort((a, b) => a.order - b.order || a.index - b.index);
  const visibleColumns = orderedColumnSettings.map(item => item.key);
  const selectValue = String(values[headerMap['選擇'] - 1] || '').trim().toLowerCase();
  const timelineValue = String(values[headerMap['時間表'] - 1] || '').trim().toLowerCase();
  const rawTheme = String(values[headerMap['深淺模式'] - 1] || '').trim();
  const theme = /^(dark|深色|深色模式)$/i.test(rawTheme)
    ? 'dark'
    : (/^(light|淺色|淺色模式)$/i.test(rawTheme) ? 'light' : '');
  const collapseValues = {
    designer: String(values[headerMap['收合設計師專長與案件分配'] - 1] || '').trim().toLowerCase(),
    recent: String(values[headerMap['收合最新案件列表'] - 1] || '').trim().toLowerCase(),
    request: String(values[headerMap['收合設計需求'] - 1] || '').trim().toLowerCase()
  };
  const hasCollapseSettings = Object.values(collapseValues).some(value => value === 'v' || value === 'x');
  const hasDisplaySettings = [selectValue, timelineValue].some(value => value === 'v' || value === 'x') || hasCollapseSettings;
  const rawDepartment = String(
    values[headerMap[USER_DEPARTMENT_HEADER] - 1] || directoryRecord.department || ''
  ).trim();
  const rawGroup = String(
    values[headerMap[USER_GROUP_HEADER] - 1] || directoryRecord.group || ''
  ).trim();
  const designType = normalizeDesignType_(rawGroup);
  const result = {
    name,
    displayName,
    '名字': name,
    '顯示名': displayName,
    department: rawDepartment,
    group: rawGroup,
    designType,
    '部門': rawDepartment,
    '組別': rawGroup,
    '設計類型': designType,
    avatar: String(values[headerMap[USER_AVATAR_HEADER] - 1] || '').trim(),
    '頭像連結': String(values[headerMap[USER_AVATAR_HEADER] - 1] || '').trim(),
    '篩選年份': String(values[headerMap['篩選年份'] - 1] || '').trim(),
    '篩選月份': String(values[headerMap['篩選月份'] - 1] || '').trim(),
    '篩選狀態': String(values[headerMap['篩選狀態'] - 1] || '').trim(),
    '篩選姓名': String(values[headerMap['篩選姓名'] - 1] || '').trim(),
    theme,
    '深淺模式': theme === 'dark' ? '深色' : (theme === 'light' ? '淺色' : '')
  };
  if (hasColumnSettings || hasDisplaySettings) {
    result.visibleColumns = visibleColumns;
    result.visibleColumnFlags = Object.fromEntries(USER_SETTING_COLUMN_HEADERS.map(header => [
      USER_SETTING_HEADER_TO_KEY[header],
      (() => {
        const value = String(values[headerMap[header] - 1] || '').trim().toLowerCase();
        return value === 'v' || /^\d+$/.test(value);
      })()
    ]));
  }
  if (hasDisplaySettings || hasColumnSettings) {
    result.editEnabled = selectValue === 'v';
    result.selectEnabled = selectValue === 'v';
    result['選擇'] = selectValue === 'v' ? 'v' : '';
    result.timelineEnabled = timelineValue === 'v';
    result.collapseSettings = {
      designer: collapseValues.designer === 'x' || collapseValues.designer === 'v',
      designerHidden: collapseValues.designer === 'x' || collapseValues.designer === 'v',
      recent: collapseValues.recent === 'x' || collapseValues.recent === 'v',
      request: collapseValues.request === 'x' || collapseValues.request === 'v'
    };
    result['收合設計師專長與案件分配'] = collapseValues.designer === 'x' || collapseValues.designer === 'v' ? 'x' : '';
    result['收合最新案件列表'] = collapseValues.recent === 'x' || collapseValues.recent === 'v' ? 'x' : '';
    result['收合設計需求'] = collapseValues.request === 'x' || collapseValues.request === 'v' ? 'x' : '';
  }
  return {
    ...result
  };
}

function normalizeDesignType_(value) {
  const text = String(value || '').trim();
  if (/平面/.test(text)) return '平面';
  if (/影音|影像|影片|video/i.test(text)) return '影音';
  return '';
}

function saveEditorSettings_(user, settings) {
  user = String(user || '').trim();
  if (!user) throw new Error('缺少設計師帳號');
  const sheet = getSettingsSheet_();
  const headerMap = buildSettingsHeaderMap_(sheet);
  const rowNumber = findEditorSettingsRow_(sheet, headerMap, user, true);
  if (Object.prototype.hasOwnProperty.call(settings, 'displayName') || Object.prototype.hasOwnProperty.call(settings, USER_DISPLAY_NAME_HEADER)) {
    const displayName = String(settings.displayName || settings[USER_DISPLAY_NAME_HEADER] || '').trim();
    if (!displayName) throw new Error('顯示名不得為空白');
    if (displayName.length > 40) throw new Error('顯示名不得超過 40 個字');
    sheet.getRange(rowNumber, headerMap[USER_DISPLAY_NAME_HEADER]).setValue(displayName);
  }
  if (Array.isArray(settings.visibleColumns)) {
    const visibleColumns = settings.visibleColumns.map(String);
    const visibleOrder = new Map();
    visibleColumns.forEach((key, index) => {
      if (!visibleOrder.has(key)) visibleOrder.set(key, index + 1);
    });
    USER_SETTING_COLUMN_HEADERS
      .filter(header => USER_SETTING_NON_WRITABLE_COLUMN_HEADERS.indexOf(header) < 0)
      .forEach(header => {
      const key = USER_SETTING_HEADER_TO_KEY[header];
      sheet.getRange(rowNumber, headerMap[header]).setValue(visibleOrder.has(key) ? visibleOrder.get(key) : '');
      });
  }
  if (settings.filters || settings.filterSettings || USER_FILTER_SETTING_HEADERS.some(header => Object.prototype.hasOwnProperty.call(settings, header))) {
    const filterSettings = settings.filters || settings.filterSettings || {};
    sheet.getRange(rowNumber, headerMap['篩選年份']).setValue(formatFilterSetting_(filterSettings.year || filterSettings.years || settings['篩選年份'], 'year'));
    sheet.getRange(rowNumber, headerMap['篩選月份']).setValue(formatFilterSetting_(filterSettings.month || filterSettings.months || settings['篩選月份'], 'month'));
    sheet.getRange(rowNumber, headerMap['篩選狀態']).setValue(formatFilterSetting_(filterSettings.status || filterSettings.statuses || settings['篩選狀態'], 'status'));
    sheet.getRange(rowNumber, headerMap['篩選姓名']).setValue(formatFilterSetting_(filterSettings.designer || filterSettings.designers || settings['篩選姓名'], 'designer'));
  }
  if (settings.selectEnabled !== undefined || settings.editEnabled !== undefined) {
    const selectEnabled = settings.selectEnabled !== undefined ? settings.selectEnabled : settings.editEnabled;
    sheet.getRange(rowNumber, headerMap['選擇']).setValue(selectEnabled === false ? '' : 'v');
  }
  if (settings.timelineEnabled !== undefined) {
    sheet.getRange(rowNumber, headerMap['時間表']).setValue(settings.timelineEnabled === false ? '' : 'v');
  }
  const rawTheme = String(settings.theme || settings['深淺模式'] || '').trim();
  const theme = /^(dark|深色|深色模式)$/i.test(rawTheme)
    ? '深色'
    : (/^(light|淺色|淺色模式)$/i.test(rawTheme) ? '淺色' : '');
  if (theme) sheet.getRange(rowNumber, headerMap['深淺模式']).setValue(theme);
  if (settings.collapseSettings) {
    const collapseSettings = settings.collapseSettings;
    const designerPanelClosed = Boolean(collapseSettings.designerHidden || collapseSettings.designer);
    sheet.getRange(rowNumber, headerMap['收合設計師專長與案件分配']).setValue(designerPanelClosed ? 'x' : '');
    sheet.getRange(rowNumber, headerMap['收合最新案件列表']).setValue(collapseSettings.recent ? 'x' : '');
    sheet.getRange(rowNumber, headerMap['收合設計需求']).setValue(collapseSettings.request ? 'x' : '');
  }
  SpreadsheetApp.flush();
  return readEditorSettings_(user);
}

function formatFilterSetting_(value, type) {
  const list = Array.isArray(value) ? value : String(value || '').split(/\s*,\s*|，|、|\n/);
  const normalized = list
    .map(item => String(item || '').trim())
    .filter(Boolean)
    .map(item => {
      if (type === 'year') {
        const year = item.match(/(19\d{2}|20\d{2}|2100)/);
        return year ? `${year[1]}年` : item;
      }
      if (type === 'month') {
        const month = item.match(/\d{1,2}/);
        return month ? `${Number(month[0])}月` : item;
      }
      if (type === 'status') {
        return item === '未開始' ? '未執行' : item;
      }
      return item;
    });
  return [...new Set(normalized)].join(' , ');
}

function getReelsContext_() {
  const spreadsheet = SpreadsheetApp.openById(SPREADSHEET_ID);
  const sheet = spreadsheet.getSheets().find(candidate => candidate.getSheetId() === REELS_SHEET_ID)
    || spreadsheet.getSheetByName('reels');
  if (!sheet) throw new Error('找不到 reels 分頁');
  const lastColumn = Math.max(sheet.getLastColumn(), REELS_HEADERS.length);
  const headers = sheet.getRange(1, 1, 1, lastColumn).getDisplayValues()[0]
    .map(value => String(value || '').trim());
  const headerMap = {};
  REELS_HEADERS.forEach(header => {
    let index = headers.indexOf(header);
    if (index < 0) {
      index = headers.findIndex(value => value === '');
      if (index < 0) index = headers.length;
      sheet.getRange(1, index + 1).setValue(header);
      headers[index] = header;
    }
    headerMap[header] = index + 1;
  });
  return { spreadsheet, sheet, headers, headerMap };
}

function parseReelNames_(value) {
  return [...new Set(String(value || '')
    .split(/\s*,\s*|，|、|\r?\n/)
    .map(name => name.trim())
    .filter(Boolean))];
}

function parseReelComments_(value) {
  const text = String(value || '').trim();
  if (!text) return [];
  try {
    const comments = JSON.parse(text);
    if (!Array.isArray(comments)) return [];
    return comments.map(comment => ({
      id: String(comment && comment.id || ''),
      name: String(comment && comment.name || '').trim(),
      account: normalizeLoginAccount_(comment && comment.account || ''),
      avatar: String(comment && comment.avatar || '').trim(),
      text: String(comment && comment.text || '').trim(),
      createdAt: String(comment && comment.createdAt || '')
    })).filter(comment => comment.name && comment.text);
  } catch (error) {
    return [];
  }
}

function reelFileId_(value) {
  const text = String(value || '');
  const match = text.match(/drive\.google\.com\/file\/d\/([^/]+)/)
    || text.match(/lh3\.googleusercontent\.com\/d\/([^=/?]+)/)
    || text.match(/[?&]id=([^&]+)/);
  return match ? match[1] : '';
}

function directDriveImageUrl_(value, width) {
  const fileId = reelFileId_(value);
  return fileId
    ? `https://lh3.googleusercontent.com/d/${fileId}=w${Number(width) || 1600}`
    : String(value || '').trim();
}

function publicReelRecord_(row, rowNumber, headerMap) {
  const name = String(row[headerMap['名字'] - 1] || '').trim();
  const imageUrl = String(row[headerMap['限時動態連結'] - 1] || '').trim();
  const expiresAtRaw = headerMap['到期時間'] ? String(row[headerMap['到期時間'] - 1] || '').trim() : '';
  const expiresAtMs = expiresAtRaw ? Date.parse(expiresAtRaw) : NaN;
  const expired = Number.isFinite(expiresAtMs) && expiresAtMs <= Date.now();
  const likes = parseReelNames_(row[headerMap['按讚'] - 1]);
  const dislikes = parseReelNames_(row[headerMap['倒讚'] - 1]);
  const comments = parseReelComments_(row[headerMap['留言'] - 1]);
  return {
    id: reelFileId_(imageUrl) || `row-${rowNumber}`,
    rowNumber,
    name,
    imageUrl,
    expiresAt: expiresAtRaw,
    expired,
    likes,
    dislikes,
    likeCount: likes.length,
    dislikeCount: dislikes.length,
    comments: comments.map(comment => ({
      id: comment.id,
      name: comment.name,
      avatar: comment.avatar,
      text: comment.text,
      createdAt: comment.createdAt
    }))
  };
}

function readReels_() {
  const context = getReelsContext_();
  const lastRow = context.sheet.getLastRow();
  if (lastRow < 2) return [];
  const width = Math.max(...Object.values(context.headerMap));
  const range = context.sheet.getRange(2, 1, lastRow - 1, width);
  const rows = range.getDisplayValues();
  const linkIndex = context.headerMap['限時動態連結'] - 1;
  let repaired = false;
  rows.forEach(row => {
    const current = String(row[linkIndex] || '').trim();
    const direct = directDriveImageUrl_(current, 1600);
    if (direct && direct !== current) {
      row[linkIndex] = direct;
      repaired = true;
    }
  });
  if (repaired) {
    context.sheet.getRange(2, context.headerMap['限時動態連結'], rows.length, 1)
      .setValues(rows.map(row => [row[linkIndex]]));
    SpreadsheetApp.flush();
  }
  return rows
    .map((row, index) => publicReelRecord_(row, index + 2, context.headerMap))
    .filter(reel => reel.name && reel.imageUrl && !reel.expired);
}

function findReelRow_(context, payload) {
  const requestedId = String(payload && (payload.reelId || payload.storyId) || '').trim();
  const requestedUrl = String(payload && (payload.imageUrl || payload.url) || '').trim();
  const requestedFileId = reelFileId_(requestedUrl) || (/^row-/.test(requestedId) ? '' : requestedId);
  const requestedRow = Number(String(requestedId).replace(/^row-/, '')) || 0;
  const lastRow = context.sheet.getLastRow();
  if (lastRow < 2) throw new Error('找不到這則限時動態');
  const linkColumn = context.headerMap['限時動態連結'];
  const links = context.sheet.getRange(2, linkColumn, lastRow - 1, 1).getDisplayValues().flat();
  const index = links.findIndex((value, offset) => {
    const text = String(value || '');
    if (requestedFileId && text.includes(requestedFileId)) return true;
    if (requestedUrl && text === requestedUrl) return true;
    return requestedRow === offset + 2;
  });
  if (index < 0) throw new Error('找不到這則限時動態');
  return index + 2;
}

function reelSessionUser_(payload) {
  const token = payload && payload.editorToken;
  const name = String(editorDisplayNameFromToken_(token) || '').trim();
  const account = editorAccountFromToken_(token);
  if (!name && !account) throw new Error('請先登入後再回應限時動態');
  return {
    name: name || String(account).split('@')[0],
    account: account || normalizeLoginAccount_(name)
  };
}

function reelUserAvatar_(account, name) {
  const sheet = getSettingsSheet_();
  const lastColumn = Math.max(sheet.getLastColumn(), 1);
  const headers = sheet.getRange(1, 1, 1, lastColumn).getDisplayValues()[0]
    .map(value => String(value || '').trim());
  const accountColumn = headers.indexOf('帳號') + 1;
  const nameColumn = headers.indexOf(USER_SETTING_NAME_HEADER) + 1;
  const avatarColumn = headers.indexOf('頭像連結') + 1;
  const lastRow = sheet.getLastRow();
  if (!avatarColumn || lastRow < 2) return '';
  const values = sheet.getRange(2, 1, lastRow - 1, lastColumn).getDisplayValues();
  const normalizedAccount = normalizeLoginAccount_(account);
  const row = values.find(valuesRow => {
    if (accountColumn && normalizedAccount) {
      if (normalizeLoginAccount_(valuesRow[accountColumn - 1]) === normalizedAccount) return true;
    }
    return nameColumn && String(valuesRow[nameColumn - 1] || '').trim() === name;
  });
  return row ? String(row[avatarColumn - 1] || '').trim() : '';
}

function toggleReelReaction_(payload) {
  const user = reelSessionUser_(payload);
  const reaction = String(payload && payload.reaction || '').trim();
  if (reaction !== 'like' && reaction !== 'dislike') throw new Error('限動回應格式錯誤');
  const lock = LockService.getScriptLock();
  lock.waitLock(30000);
  try {
    const context = getReelsContext_();
    const rowNumber = findReelRow_(context, payload);
    const width = Math.max(...Object.values(context.headerMap));
    const row = context.sheet.getRange(rowNumber, 1, 1, width).getDisplayValues()[0];
    let likes = parseReelNames_(row[context.headerMap['按讚'] - 1]);
    let dislikes = parseReelNames_(row[context.headerMap['倒讚'] - 1]);
    const target = reaction === 'like' ? likes : dislikes;
    const active = target.indexOf(user.name) >= 0;
    if (reaction === 'like') {
      likes = active ? likes.filter(name => name !== user.name) : [...likes, user.name];
      if (!active) dislikes = dislikes.filter(name => name !== user.name);
    } else {
      dislikes = active ? dislikes.filter(name => name !== user.name) : [...dislikes, user.name];
      if (!active) likes = likes.filter(name => name !== user.name);
    }
    context.sheet.getRange(rowNumber, context.headerMap['按讚']).setValue(likes.join(' , '));
    context.sheet.getRange(rowNumber, context.headerMap['倒讚']).setValue(dislikes.join(' , '));
    SpreadsheetApp.flush();
    const updated = context.sheet.getRange(rowNumber, 1, 1, width).getDisplayValues()[0];
    return publicReelRecord_(updated, rowNumber, context.headerMap);
  } finally {
    lock.releaseLock();
  }
}

function addReelComment_(payload) {
  const user = reelSessionUser_(payload);
  const text = String(payload && (payload.comment || payload.text) || '').trim();
  if (!text) throw new Error('請輸入留言');
  if (text.length > REEL_COMMENT_MAX_LENGTH) {
    throw new Error(`留言請控制在 ${REEL_COMMENT_MAX_LENGTH} 字內`);
  }
  const lock = LockService.getScriptLock();
  lock.waitLock(30000);
  try {
    const context = getReelsContext_();
    const rowNumber = findReelRow_(context, payload);
    const width = Math.max(...Object.values(context.headerMap));
    const row = context.sheet.getRange(rowNumber, 1, 1, width).getDisplayValues()[0];
    const comments = parseReelComments_(row[context.headerMap['留言'] - 1]);
    comments.push({
      id: Utilities.getUuid(),
      name: user.name,
      account: user.account,
      avatar: reelUserAvatar_(user.account, user.name),
      text,
      createdAt: new Date().toISOString()
    });
    const retained = comments.slice(-REEL_COMMENT_LIMIT);
    context.sheet.getRange(rowNumber, context.headerMap['留言'])
      .setValue(JSON.stringify(retained));
    SpreadsheetApp.flush();
    const updated = context.sheet.getRange(rowNumber, 1, 1, width).getDisplayValues()[0];
    return publicReelRecord_(updated, rowNumber, context.headerMap);
  } finally {
    lock.releaseLock();
  }
}

function buildDesignerProfileHeaderMap_(sheet) {
  const requiredHeaders = [USER_SETTING_NAME_HEADER, '頭像連結', '頭像大圖連結', '分享音樂', '音樂起始秒數', '技能', '對話框'];
  const lastColumn = Math.max(sheet.getLastColumn(), requiredHeaders.length);
  const headers = sheet.getRange(1, 1, 1, lastColumn).getValues()[0].map(value => String(value || '').trim());
  const headerMap = {};
  requiredHeaders.forEach(header => {
    let index = findSettingsHeaderIndex_(headers, header);
    if (index < 0) {
      index = headers.findIndex(value => value === '');
      if (index < 0) index = headers.length;
      sheet.getRange(1, index + 1).setValue(header);
      headers[index] = header;
    } else if (header === USER_SETTING_NAME_HEADER && headers[index] !== USER_SETTING_NAME_HEADER) {
      sheet.getRange(1, index + 1).setValue(USER_SETTING_NAME_HEADER);
      headers[index] = USER_SETTING_NAME_HEADER;
    }
    headerMap[header] = index + 1;
  });
  return headerMap;
}

function readDesignerProfileRow_(sheet, headerMap, rowNumber) {
  const values = sheet.getRange(rowNumber, 1, 1, Math.max(...Object.values(headerMap))).getDisplayValues()[0];
  const name = values[headerMap[USER_SETTING_NAME_HEADER] - 1] || '';
  return {
    designType: designerDesignTypeFromName_(name),
    name,
    avatar: values[headerMap['頭像連結'] - 1] || '',
    poster: values[headerMap['頭像大圖連結'] - 1] || '',
    musicUrl: values[headerMap['分享音樂'] - 1] || '',
    musicStartAt: Math.max(0, Number(values[headerMap['音樂起始秒數'] - 1]) || 0),
    skills: values[headerMap['技能'] - 1] || '',
    quote: values[headerMap['對話框'] - 1] || ''
  };
}

function designerDesignTypeFromName_(name) {
  if (FLAT_ROTATION_DESIGNERS.indexOf(name) >= 0) return '平面';
  if (VIDEO_ROTATION_DESIGNERS.indexOf(name) >= 0) return '影音';
  return '';
}

function saveDesignerProfiles_(profiles) {
  if (!Array.isArray(profiles)) throw new Error('設計師設定格式錯誤');
  const sheet = getSettingsSheet_();
  const headerMap = buildDesignerProfileHeaderMap_(sheet);
  const nameColumn = headerMap[USER_SETTING_NAME_HEADER];
  const lastRow = Math.max(sheet.getLastRow(), 1);
  const names = lastRow > 1
    ? sheet.getRange(2, nameColumn, lastRow - 1, 1).getDisplayValues().flat().map(value => String(value || '').trim())
    : [];
  const saved = [];
  profiles.forEach(profile => {
    const name = String((profile && profile.name) || '').trim();
    if (!name || !Object.prototype.hasOwnProperty.call(EDITOR_ACCOUNTS, name)) return;
    const index = names.findIndex(candidate => candidate === name);
    const rowNumber = index >= 0 ? index + 2 : sheet.getLastRow() + 1;
    if (index < 0) {
      sheet.getRange(rowNumber, nameColumn).setValue(name);
      names.push(name);
    }
    const skills = Array.isArray(profile.skills)
      ? profile.skills.map(String).filter(Boolean).join(' , ')
      : String(profile.skills || '');
    const quote = String(profile.quote || '').trim();
    const musicUrl = String(profile.musicUrl || profile.appleMusicUrl || profile['分享音樂'] || '').trim();
    const musicStartAt = Math.max(0, Number(profile.musicStartAt || profile.startAt || profile['音樂起始秒數']) || 0);
    const existingProfile = readDesignerProfileRow_(sheet, headerMap, rowNumber);
    const avatar = String(profile.avatar || profile['頭像連結'] || existingProfile.avatar || '').trim();
    const poster = String(profile.poster || profile['頭像大圖連結'] || existingProfile.poster || avatar).trim();
    sheet.getRange(rowNumber, headerMap['頭像連結']).setValue(avatar);
    sheet.getRange(rowNumber, headerMap['頭像大圖連結']).setValue(poster);
    sheet.getRange(rowNumber, headerMap['分享音樂']).setValue(musicUrl);
    sheet.getRange(rowNumber, headerMap['音樂起始秒數']).setValue(musicStartAt);
    sheet.getRange(rowNumber, headerMap['技能']).setValue(skills);
    sheet.getRange(rowNumber, headerMap['對話框']).setValue(quote);
    saved.push(readDesignerProfileRow_(sheet, headerMap, rowNumber));
  });
  SpreadsheetApp.flush();
  CacheService.getScriptCache().remove('sheetValues:' + SETTINGS_SHEET_ID);
  return saved;
}

function uploadDesignerImage_(payload) {
  const name = String(payload.name || payload.designer || '').trim();
  const kind = String(payload.kind || '').trim() === 'poster' ? 'poster' : 'avatar';
  const dataUrl = String(payload.dataUrl || payload.data || '').trim();
  const mimeType = String(payload.mimeType || '').trim() || 'image/png';
  const originalName = String(payload.fileName || '').trim() || `${name}-${kind}.png`;
  if (!name || !Object.prototype.hasOwnProperty.call(EDITOR_ACCOUNTS, name)) throw new Error('缺少設計師名稱');
  if (!dataUrl) throw new Error('缺少照片資料');
  const match = dataUrl.match(/^data:([^;]+);base64,(.+)$/);
  const base64 = match ? match[2] : dataUrl;
  if (!base64) throw new Error('照片資料格式錯誤');
  const bytes = Utilities.base64Decode(base64);
  const safeName = originalName.replace(/[\\/:*?"<>|#%{}~&]/g, '_');
  const stamp = Utilities.formatDate(new Date(), Session.getScriptTimeZone(), 'yyyyMMdd_HHmmss');
  const fileName = `${name}_${kind}_${stamp}_${safeName}`;
  const blob = Utilities.newBlob(bytes, match ? match[1] : mimeType, fileName);
  const folderId = resolveDesignerImageFolderId_(name, payload.folderId || payload.imageFolder);
  let folder;
  try {
    folder = DriveApp.getFolderById(folderId);
  } catch (error) {
    throw new Error(`${name} 的 Google Drive 資料夾無法存取，請確認資料夾網址、Apps Script 授權及執行帳號權限。原始錯誤：` + (error.message || error));
  }
  const file = folder.createFile(blob);
  let isPublic = true;
  let sharingWarning = '';
  try {
    file.setSharing(DriveApp.Access.ANYONE_WITH_LINK, DriveApp.Permission.VIEW);
  } catch (error) {
    isPublic = false;
    sharingWarning = '照片已上傳，但網域政策不允許設為公開連結；僅有資料夾權限的帳號可查看。';
    console.warn(sharingWarning, error);
  }
  const fileId = file.getId();
  const thumbnailUrl = `https://drive.google.com/thumbnail?id=${fileId}&sz=w1000`;
  return {
    name,
    kind,
    fileId,
    folderId,
    folderName: folder.getName(),
    isPublic,
    sharingWarning,
    url: thumbnailUrl,
    fileUrl: thumbnailUrl,
    webViewLink: file.getUrl(),
    downloadUrl: `https://drive.google.com/uc?export=view&id=${fileId}`
  };
}

function uploadUserAvatar_(payload, account) {
  const dataUrl = String(payload.dataUrl || payload.data || '').trim();
  const mimeType = String(payload.mimeType || '').trim() || 'image/png';
  const allowedMimeTypes = ['image/jpeg', 'image/png', 'image/webp', 'image/gif'];
  if (!allowedMimeTypes.includes(mimeType)) throw new Error('頭像僅支援 JPG、PNG、WebP 或 GIF');
  const match = dataUrl.match(/^data:([^;]+);base64,(.+)$/);
  if (!match || !match[2]) throw new Error('頭像資料格式錯誤');
  const bytes = Utilities.base64Decode(match[2]);
  if (bytes.length > USER_AVATAR_MAX_BYTES) throw new Error('頭像檔案不可超過 8 MB');

  const folder = getOrCreateUserAvatarFolder_(account);
  const originalName = String(payload.fileName || '').trim() || 'avatar';
  const safeName = originalName.replace(/[\\/:*?"<>|#%{}~&]/g, '_');
  const stamp = Utilities.formatDate(new Date(), Session.getScriptTimeZone(), 'yyyyMMdd_HHmmss');
  const blob = Utilities.newBlob(bytes, match[1] || mimeType, `${account.split('@')[0]}_avatar_${stamp}_${safeName}`);
  const file = folder.createFile(blob);
  let isPublic = true;
  let sharingWarning = '';
  try {
    file.setSharing(DriveApp.Access.ANYONE_WITH_LINK, DriveApp.Permission.VIEW);
  } catch (error) {
    isPublic = false;
    sharingWarning = '頭像已上傳，但網域政策不允許設為公開連結。';
  }
  const fileId = file.getId();
  const url = directDriveImageUrl_(`https://drive.google.com/file/d/${fileId}/view`, 1000);
  const sheet = getSettingsSheet_();
  const headerMap = buildSettingsHeaderMap_(sheet);
  const rowNumber = findEditorSettingsRow_(sheet, headerMap, account, true);
  sheet.getRange(rowNumber, headerMap[USER_AVATAR_HEADER]).setValue(url);
  SpreadsheetApp.flush();
  CacheService.getScriptCache().remove('sheetValues:' + SETTINGS_SHEET_ID);
  return {
    account,
    fileId,
    folderId: folder.getId(),
    url,
    isPublic,
    sharingWarning
  };
}

function getOrCreateUserAvatarFolder_(account) {
  const folderName = String(account || '').split('@')[0].replace(/[^a-zA-Z0-9._-]/g, '_') || 'user';
  const root = DriveApp.getFolderById(USER_AVATAR_ROOT_FOLDER_ID);
  const existing = root.getFoldersByName(folderName);
  return existing.hasNext() ? existing.next() : root.createFolder(folderName);
}

function normalizeDriveFolderId_(value) {
  const text = String(value || '').trim();
  if (!text) return '';
  const match = text.match(/\/folders\/([a-zA-Z0-9_-]+)/);
  return match ? match[1] : text.replace(/[?#].*$/, '').trim();
}

function resolveDesignerImageFolderId_(name, requestedFolder) {
  const requested = normalizeDriveFolderId_(requestedFolder);
  if (requested) return requested;
  return DESIGNER_IMAGE_FOLDER_IDS[name] || DESIGNER_IMAGE_FOLDER_ID;
}

function authorizeDesignerImageUploadOnce() {
  ScriptApp.requireScopes(ScriptApp.AuthMode.FULL, DESIGNER_IMAGE_UPLOAD_SCOPES);
  return testDesignerImageUploadAuth_();
}

function testDesignerImageUploadAuth_() {
  if (typeof ScriptApp !== 'undefined' && ScriptApp.requireScopes) {
    ScriptApp.requireScopes(ScriptApp.AuthMode.FULL, DESIGNER_IMAGE_UPLOAD_SCOPES);
  }
  let folder;
  try {
    folder = DriveApp.getFolderById(DESIGNER_IMAGE_FOLDER_ID);
  } catch (error) {
    throw new Error('Apps Script 尚未完成 Google Drive 授權。請在 Apps Script 編輯器執行 authorizeDesignerImageUploadOnce，允許 Drive 權限後重新部署。原始錯誤：' + (error.message || error));
  }
  const blob = Utilities.newBlob('designer image upload auth ok', 'text/plain', `designer-upload-auth-${Date.now()}.txt`);
  const file = folder.createFile(blob);
  try {
    file.setSharing(DriveApp.Access.ANYONE_WITH_LINK, DriveApp.Permission.VIEW);
    file.setTrashed(true);
  } catch (error) {
    throw new Error('Drive 可建立檔案，但無法設定公開或移除測試檔。請確認 Apps Script 有完整 Drive 權限。原始錯誤：' + (error.message || error));
  }
  return {
    folderId: DESIGNER_IMAGE_FOLDER_ID,
    folderName: folder.getName(),
    testFileId: file.getId()
  };
}

function getIssueReportSheet_() {
  const spreadsheet = SpreadsheetApp.openById(SPREADSHEET_ID);
  const idMatchedSheet = spreadsheet.getSheets().find(candidate => candidate.getSheetId() === ISSUE_REPORT_SHEET_ID);
  if (idMatchedSheet) return idMatchedSheet;
  const bugReportSheet = spreadsheet.getSheetByName('bug_report');
  if (bugReportSheet) return bugReportSheet;
  const namedSheet = spreadsheet.getSheetByName('問題回報');
  if (namedSheet) return namedSheet;
  throw new Error('找不到 bug_report 工作表');
}

function buildIssueReportHeaderMap_(sheet) {
  const lastColumn = Math.max(sheet.getLastColumn(), ISSUE_REPORT_HEADERS.length);
  const headers = sheet.getRange(1, 1, 1, lastColumn).getValues()[0].map(value => String(value || '').trim());
  const headerMap = {};
  ISSUE_REPORT_HEADERS.forEach(header => {
    let index = headers.indexOf(header);
    if (index < 0) {
      index = headers.findIndex(value => value === '');
      if (index < 0) index = headers.length;
      sheet.getRange(1, index + 1).setValue(header);
      headers[index] = header;
    }
    headerMap[header] = index + 1;
  });
  return headerMap;
}

function issueReportTimestamp_() {
  return Utilities.formatDate(new Date(), ADMIN_LOGIN_PASSWORD_TIMEZONE, 'yyyy/MM/dd HH:mm:ss');
}

function issueReportRowObject_(values, headerMap, rowNumber) {
  const row = { rowNumber };
  ISSUE_REPORT_HEADERS.forEach(header => {
    row[header] = String(values[headerMap[header] - 1] || '').trim();
  });
  row['狀態'] = ISSUE_REPORT_STATUSES.indexOf(row['狀態']) >= 0 ? row['狀態'] : '回報中';
  row['狀態更改時間'] = row['狀態更改時間'] || row[row['狀態']] || row['時間'];
  return row;
}

function readIssueReports_() {
  const sheet = getIssueReportSheet_();
  const headerMap = buildIssueReportHeaderMap_(sheet);
  const lastRow = sheet.getLastRow();
  if (lastRow < 2) return [];
  const lastColumn = Math.max(sheet.getLastColumn(), ...Object.values(headerMap));
  return sheet.getRange(2, 1, lastRow - 1, lastColumn).getDisplayValues()
    .map((values, index) => issueReportRowObject_(values, headerMap, index + 2))
    .filter(row => row['內容'])
    .reverse();
}

function appendIssueReport_(payload, requestPayload) {
  const authenticatedName = editorDisplayNameFromToken_(requestPayload && requestPayload.editorToken);
  const name = String(authenticatedName || payload.name || payload['姓名'] || payload.reporter || '未登入').trim() || '未登入';
  const content = String(payload.content || payload['內容'] || '').trim();
  const suggestion = String(payload.suggestion || payload['修改建議'] || '').trim();
  if (!content) throw new Error('請填寫問題內容');
  if (content.length > 300 || suggestion.length > 300) throw new Error('內容與修改建議不得超過 300 字');
  const lock = LockService.getScriptLock();
  lock.waitLock(10000);
  try {
    const sheet = getIssueReportSheet_();
    const headerMap = buildIssueReportHeaderMap_(sheet);
    const time = issueReportTimestamp_();
    const rowNumber = sheet.getLastRow() + 1;
    const values = {
      '姓名': name,
      '時間': time,
      '內容': content,
      '修改建議': suggestion,
      '狀態': '回報中',
      '狀態更改時間': time,
      '回報中': time
    };
    ISSUE_REPORT_HEADERS.forEach(header => sheet.getRange(rowNumber, headerMap[header]).setValue(values[header] || ''));
    SpreadsheetApp.flush();
    return { rowNumber, row: Object.assign({ rowNumber }, values) };
  } finally {
    lock.releaseLock();
  }
}

function isIssueReportManagerToken_(token) {
  const user = editorUserFromToken_(token);
  if (user === '管理者' || user === 'Machi') return true;
  const account = editorAccountFromToken_(token);
  if (!account && !user) return false;
  const settings = readEditorSettings_(account || user);
  return /^(?:管理者|admin)$/i.test(String(
    settings.department || settings['部門'] || settings.group || ''
  ).trim());
}

const ACCOUNT_ACCESS_JSON_URL = 'https://raw.githubusercontent.com/EMCtaipeiART/EMCtaipeiART.github.io/main/backend/data/db.json';
const ACCOUNT_ACCESS_CACHE_KEY = 'machi-account-access-v2';
const ACCOUNT_ACCESS_PAGES = ['request', 'dashboard', 'archive', 'database_admin', 'media_admin', 'avatar_upload', 'short_link'];
const ACCOUNT_ACCESS_CAPABILITIES = ['request.create', 'request.edit', 'request.status', 'request.delete', 'request.export', 'modification.create', 'modification.confirm', 'project.create', 'designer.settings', 'profile.edit', 'media.manage', 'reel.interact', 'issue.report', 'issue.manage', 'short_link.create', 'archive.edit', 'database.manage'];
const ACCOUNT_ACCESS_TEMPLATES = {
  '管理者': { pages: ACCOUNT_ACCESS_PAGES, capabilities: ACCOUNT_ACCESS_CAPABILITIES },
  '設計師': { pages: ['request', 'dashboard', 'media_admin', 'avatar_upload', 'short_link'], capabilities: ['request.create', 'request.edit', 'request.status', 'request.export', 'modification.create', 'modification.confirm', 'project.create', 'designer.settings', 'profile.edit', 'media.manage', 'reel.interact', 'issue.report', 'short_link.create'] },
  '一般使用者': { pages: ['request', 'avatar_upload', 'short_link'], capabilities: ['request.create', 'profile.edit', 'reel.interact', 'issue.report', 'short_link.create'] },
  '唯讀': { pages: ['request', 'dashboard', 'short_link'], capabilities: [] }
};

function accountAccessList_(value) {
  if (Array.isArray(value)) return [...new Set(value.map(item => String(item || '').trim()).filter(Boolean))];
  const raw = String(value || '').trim();
  if (!raw) return [];
  try { const parsed = JSON.parse(raw); if (Array.isArray(parsed)) return accountAccessList_(parsed); } catch (error) {}
  return [...new Set(raw.split(/[\n,，、|｜]/).map(item => String(item || '').trim()).filter(Boolean))];
}

function readAccountAccessData_() {
  const cache = CacheService.getScriptCache(), cached = cache.get(ACCOUNT_ACCESS_CACHE_KEY);
  if (cached) { try { return JSON.parse(cached); } catch (error) {} }
  const response = UrlFetchApp.fetch(ACCOUNT_ACCESS_JSON_URL + '?v=' + Date.now(), { method: 'get', muteHttpExceptions: true, followRedirects: true, headers: { Accept: 'application/json' } });
  if (response.getResponseCode() < 200 || response.getResponseCode() >= 300) throw new Error('帳號權限 JSON 讀取失敗：HTTP ' + response.getResponseCode());
  const database = JSON.parse(response.getContentText()), data = { settings: database?.tables?.['設定']?.rows || [], permissions: database?.tables?.['帳號權限']?.rows || [], templates: database?.tables?.['角色權限範本']?.rows || [] };
  cache.put(ACCOUNT_ACCESS_CACHE_KEY, JSON.stringify(data), 60);
  return data;
}

function accountAccessProfile_(token) {
  token = String(token || '').trim();
  if (isLocalAdminToken_(token)) return { account: 'local-admin', role: '管理者', status: '啟用', pages: ACCOUNT_ACCESS_PAGES.slice(), capabilities: ACCOUNT_ACCESS_CAPABILITIES.slice(), explicit: true };
  const session = readEditorSession_(token, false);
  if (!session) return { account: '', role: '訪客', status: '啟用', pages: ['request', 'short_link'], capabilities: ['request.create', 'issue.report', 'short_link.create'], explicit: false };
  const account = normalizeLoginAccount_(session.account || ''), user = String(session.user || '').trim(), data = readAccountAccessData_();
  const settings = data.settings.find(row => normalizeLoginAccount_(row['帳號'] || '') === account || String(row['名字'] || '').trim() === user) || {};
  const manager = user === '管理者' || user === 'Machi' || /^(?:管理者|admin)$/i.test(String(settings['部門'] || settings['組別'] || '').trim());
  if (manager) return { account, role: '管理者', status: '啟用', pages: ACCOUNT_ACCESS_PAGES.slice(), capabilities: ACCOUNT_ACCESS_CAPABILITIES.slice(), explicit: true };
  const row = data.permissions.find(item => normalizeLoginAccount_(item['帳號'] || '') === account) || null;
  const defaultRole = /^(?:平面|影音)$/.test(String(settings['組別'] || '').trim()) ? '設計師' : '一般使用者';
  const role = String(row?.['角色範本'] || defaultRole).trim(), fallback = ACCOUNT_ACCESS_TEMPLATES[role] || ACCOUNT_ACCESS_TEMPLATES['一般使用者'];
  const savedTemplate = (data.templates || []).find(item => String(item['角色範本'] || '').trim() === role) || null;
  const template = role === '管理者'
    ? { pages: ACCOUNT_ACCESS_PAGES.slice(), capabilities: ACCOUNT_ACCESS_CAPABILITIES.slice() }
    : (savedTemplate ? { pages: accountAccessList_(savedTemplate['頁面權限']), capabilities: accountAccessList_(savedTemplate['功能權限']) } : fallback);
  const custom = Boolean(row) && role === '自訂';
  return { account, role, status: String(row?.['狀態'] || '啟用').trim(), pages: custom ? accountAccessList_(row['頁面權限']) : template.pages.slice(), capabilities: custom ? accountAccessList_(row['功能權限']) : template.capabilities.slice(), explicit: Boolean(row) };
}

function assertAccountCapability_(payload, capability, allowAnonymous) {
  const token = String(payload && (payload.editorToken || payload.token) || '').trim(), access = accountAccessProfile_(token);
  if (!access.account && allowAnonymous) return access;
  if (!access.account) throw new Error('請先登入後再執行此操作');
  if (access.status === '停用' || access.capabilities.indexOf(capability) < 0) throw new Error('此帳號沒有「' + capability + '」權限');
  return access;
}

function assertDatabaseAdmin_(payload) {
  const token = String(payload && (payload.editorToken || payload.token) || '').trim();
  assertAccountCapability_(payload, 'database.manage', false);
  return token;
}

function enforceActionAccess_(action, payload) {
  const direct = {
    saveUserSettings: 'profile.edit', uploadUserAvatar: 'profile.edit',
    saveDesignerProfiles: 'designer.settings', testDesignerImageUploadAuth: 'media.manage', uploadDesignerImage: 'media.manage', deleteDesignerMedia: 'media.manage', upsertDesignerStories: 'media.manage', deleteDesignerStories: 'media.manage',
    toggleReelReaction: 'reel.interact', addReelComment: 'reel.interact', updateIssueReportStatus: 'issue.manage',
    updateModificationConfirm: 'modification.confirm', createFlatProject: 'project.create', delete: payload && payload.accessContext === 'archive' ? 'archive.edit' : 'request.delete'
  };
  if (direct[action]) return assertAccountCapability_(payload, direct[action], false);
  if (action === 'reportIssue') return assertAccountCapability_(payload, 'issue.report', true);
  if (action === 'createShortLink') return assertAccountCapability_(payload, 'short_link.create', true);
  if (action === 'addModificationRecord') return assertAccountCapability_(payload, 'modification.create', true);
  if (['append', 'create', 'add', 'submit', 'save', 'batchAdd', 'batchAppend', 'addRows'].indexOf(action) >= 0) {
    if (String(payload && payload.editorToken || '').trim()) return assertAccountCapability_(payload, 'request.create', false);
    return null;
  }
  if (action === 'update' || action === 'batchUpdate') {
    if (!String(payload && payload.editorToken || '').trim()) return null;
    const row = payload && (payload.row || payload.changes) || {}, headers = [].concat(payload && payload.writeHeaders || [], payload && payload.forceHeaders || []);
    const protectedWrite = headers.some(header => ['案件狀態', '狀態', '項目細節'].indexOf(header) >= 0) || Object.prototype.hasOwnProperty.call(row, 'status') || Object.prototype.hasOwnProperty.call(row, 'details');
    return assertAccountCapability_(payload, payload && payload.accessContext === 'archive' ? 'archive.edit' : (protectedWrite ? 'request.status' : 'request.edit'), false);
  }
  return null;
}

function githubJsonDatabaseToken_() {
  const token = String(PropertiesService.getScriptProperties().getProperty(DATABASE_ARCHIVE_GITHUB_TOKEN_PROPERTY) || '').trim();
  if (!token) throw new Error('GitHub JSON 寫入權杖尚未設定');
  return token;
}

function githubJsonDatabaseApiUrl_() {
  return 'https://api.github.com/repos/' + DATABASE_ARCHIVE_GITHUB_REPOSITORY + '/contents/' + GITHUB_JSON_DATABASE_PATH;
}

function githubJsonDatabaseHeaders_() {
  return {
    Accept: 'application/vnd.github+json',
    Authorization: 'Bearer ' + githubJsonDatabaseToken_(),
    'X-GitHub-Api-Version': '2022-11-28',
    'User-Agent': 'machi-design-request-apps-script'
  };
}

function readGithubJsonDatabase_() {
  const response = UrlFetchApp.fetch(
    githubJsonDatabaseApiUrl_() + '?ref=' + encodeURIComponent(GITHUB_JSON_DATABASE_BRANCH) + '&ts=' + Date.now(),
    { method: 'get', headers: githubJsonDatabaseHeaders_(), muteHttpExceptions: true }
  );
  const status = response.getResponseCode();
  const body = response.getContentText();
  if (status !== 200) throw new Error('GitHub JSON 讀取失敗：HTTP ' + status + ' ' + body.slice(0, 300));
  const file = JSON.parse(body);
  const source = Utilities.newBlob(Utilities.base64Decode(String(file.content || '').replace(/\s/g, ''))).getDataAsString('UTF-8');
  const database = JSON.parse(source);
  if (!database || !database.tables || typeof database.tables !== 'object') throw new Error('GitHub JSON 資料庫格式錯誤');
  return { database, sha: String(file.sha || '') };
}

function writeGithubJsonDatabase_(database, sha, action) {
  const content = JSON.stringify(database, null, 2) + '\n';
  const payload = {
    message: 'data: ' + String(action || 'update JSON database').slice(0, 64),
    content: Utilities.base64Encode(content, Utilities.Charset.UTF_8),
    sha: sha,
    branch: GITHUB_JSON_DATABASE_BRANCH
  };
  const response = UrlFetchApp.fetch(githubJsonDatabaseApiUrl_(), {
    method: 'put',
    contentType: 'application/json',
    headers: githubJsonDatabaseHeaders_(),
    payload: JSON.stringify(payload),
    muteHttpExceptions: true
  });
  const status = response.getResponseCode();
  const body = response.getContentText();
  if (status !== 200 && status !== 201) {
    const error = new Error('GitHub JSON 寫入失敗：HTTP ' + status + ' ' + body.slice(0, 300));
    error.githubStatus = status;
    throw error;
  }
  const result = JSON.parse(body);
  return { status, commitSha: String(result.commit && result.commit.sha || ''), contentSha: String(result.content && result.content.sha || '') };
}

function githubJsonTable_(database, tableName) {
  const table = database && database.tables && database.tables[tableName];
  if (!table || !Array.isArray(table.headers) || !Array.isArray(table.rows)) throw new Error('找不到 GitHub JSON 資料表：' + tableName);
  return table;
}

function githubJsonCaseHeader_(table, key) {
  const canonical = KEY_TO_HEADER[key];
  if (!canonical) return '';
  const candidates = [canonical].concat(HEADER_ALIASES[canonical] || []);
  return candidates.find(header => table.headers.indexOf(header) >= 0) || canonical;
}

function githubJsonInputValue_(input, key) {
  const canonical = KEY_TO_HEADER[key];
  const candidates = [key, canonical].concat(HEADER_ALIASES[canonical] || []);
  for (let index = 0; index < candidates.length; index += 1) {
    if (Object.prototype.hasOwnProperty.call(input || {}, candidates[index])) return { found: true, value: input[candidates[index]] };
  }
  return { found: false, value: '' };
}

function githubJsonCaseRow_(table, input, existing) {
  const row = Object.assign({}, existing || {});
  Object.keys(KEY_TO_HEADER).forEach(key => {
    const value = githubJsonInputValue_(input || {}, key);
    if (value.found) row[githubJsonCaseHeader_(table, key)] = value.value == null ? '' : String(value.value);
  });
  return row;
}

function githubJsonCaseApiRow_(table, row, index) {
  const result = {};
  Object.keys(KEY_TO_HEADER).forEach(key => {
    result[key] = row[githubJsonCaseHeader_(table, key)] == null ? '' : row[githubJsonCaseHeader_(table, key)];
  });
  result.qty = result.qty === '' ? '' : Number(result.qty);
  if (Number.isInteger(index) && index >= 0) {
    result.sheetRow = index + 2;
    result._sheetRow = index + 2;
  }
  return result;
}

function githubJsonTaipeiTimestamp_() {
  return Utilities.formatDate(new Date(), ADMIN_LOGIN_PASSWORD_TIMEZONE, 'yyyy/MM/dd HH:mm');
}

function githubJsonNextCaseId_(rows, table) {
  const prefix = Utilities.formatDate(new Date(), ADMIN_LOGIN_PASSWORD_TIMEZONE, 'yyMM');
  const idHeader = githubJsonCaseHeader_(table, 'id');
  const max = rows.reduce((value, row) => {
    const id = String(row[idHeader] || '');
    return id.indexOf(prefix) === 0 && /^\d{8}$/.test(id) ? Math.max(value, Number(id.slice(4))) : value;
  }, 0);
  return prefix + String(max + 1).padStart(4, '0');
}

function githubJsonSyncSupplementLinks_(database, table, row, changedTables) {
  const id = String(row[githubJsonCaseHeader_(table, 'id')] || '').trim();
  if (!/^\d{8}$/.test(id)) return;
  const supplement = githubJsonTable_(database, '補充資料連結');
  const idHeader = supplement.headers.indexOf('案件編號') >= 0 ? '案件編號' : supplement.headers[0];
  let record = supplement.rows.find(item => String(item[idHeader] || '').trim() === id);
  let changed = false;
  Object.keys(SUPPLEMENT_LINK_SLOTS).forEach(slot => {
    const config = SUPPLEMENT_LINK_SLOTS[slot];
    const mainHeader = githubJsonCaseHeader_(table, config.key);
    const value = String(row[mainHeader] || '').trim();
    const ownShort = new RegExp('/' + slot + '/' + id + '/?$','i').test(value);
    if (!value || ownShort || !/^https?:\/\//i.test(value)) return;
    if (!record) record = { '案件編號': id, A: '', B: '', C: '', D: '', '更新時間': '' };
    record[slot.toUpperCase()] = value;
    row[mainHeader] = supplementShortUrl_(slot, id);
    changed = true;
  });
  if (changed) {
    record['更新時間'] = githubJsonTaipeiTimestamp_();
    if (supplement.rows.indexOf(record) < 0) supplement.rows.push(record);
    if (changedTables.indexOf('補充資料連結') < 0) changedTables.push('補充資料連結');
  }
}

function githubJsonDatabaseAction_(database, action, payload) {
  const table = githubJsonTable_(database, 'database');
  const rows = table.rows;
  const changedTables = ['database'];
  const normalizedAction = ['append','create','submit','save'].indexOf(action) >= 0 ? 'add' : action;
  if (normalizedAction === 'add') {
    const requestId = String(payload.requestId || '').trim();
    const cached = requestId && database.internal && database.internal.idempotency && database.internal.idempotency[requestId];
    if (cached) return { changed: false, changedTables: [], result: Object.assign({}, cached, { deduplicated: true }) };
    const row = githubJsonCaseRow_(table, payload.row || payload.data || payload, {});
    row[githubJsonCaseHeader_(table, 'id')] = githubJsonNextCaseId_(rows, table);
    row[githubJsonCaseHeader_(table, 'month')] = monthFromDate_(row[githubJsonCaseHeader_(table, 'start')]);
    row[githubJsonCaseHeader_(table, 'submittedAt')] = githubJsonTaipeiTimestamp_();
    if (!row[githubJsonCaseHeader_(table, 'status')]) row[githubJsonCaseHeader_(table, 'status')] = '未開始';
    if (!row[githubJsonCaseHeader_(table, 'weight')]) row[githubJsonCaseHeader_(table, 'weight')] = String(Number(row[githubJsonCaseHeader_(table, 'qty')]) || 1);
    githubJsonSyncSupplementLinks_(database, table, row, changedTables);
    rows.push(row);
    const result = { ok: true, action: 'append', rowNumber: rows.length + 1, row: githubJsonCaseApiRow_(table, row, rows.length - 1) };
    database.internal = database.internal || {};
    database.internal.idempotency = database.internal.idempotency || {};
    if (requestId) {
      database.internal.idempotency[requestId] = result;
      const ids = Object.keys(database.internal.idempotency);
      ids.slice(0, Math.max(0, ids.length - 200)).forEach(id => delete database.internal.idempotency[id]);
    }
    return { changed: true, changedTables, result };
  }
  if (normalizedAction === 'batchAdd' || normalizedAction === 'batchAppend' || normalizedAction === 'addRows') {
    const items = Array.isArray(payload.rows || payload.data) ? (payload.rows || payload.data) : [];
    if (!items.length) throw new Error('沒有可新增的批次資料');
    const output = items.map(item => {
      const row = githubJsonCaseRow_(table, item, {});
      row[githubJsonCaseHeader_(table, 'id')] = githubJsonNextCaseId_(rows, table);
      row[githubJsonCaseHeader_(table, 'month')] = monthFromDate_(row[githubJsonCaseHeader_(table, 'start')]);
      row[githubJsonCaseHeader_(table, 'submittedAt')] = githubJsonTaipeiTimestamp_();
      if (!row[githubJsonCaseHeader_(table, 'status')]) row[githubJsonCaseHeader_(table, 'status')] = '未開始';
      if (!row[githubJsonCaseHeader_(table, 'weight')]) row[githubJsonCaseHeader_(table, 'weight')] = String(Number(row[githubJsonCaseHeader_(table, 'qty')]) || 1);
      githubJsonSyncSupplementLinks_(database, table, row, changedTables);
      rows.push(row);
      return githubJsonCaseApiRow_(table, row, rows.length - 1);
    });
    return { changed: true, changedTables, result: { ok: true, action: 'batchAdd', count: output.length, rowNumbers: output.map(row => row.sheetRow), rows: output } };
  }
  if (normalizedAction === 'update' || normalizedAction === 'batchUpdate') {
    const common = payload.row || payload.changes || {};
    const items = normalizedAction === 'batchUpdate' ? (Array.isArray(payload.rows) ? payload.rows : []) : [{ id: payload.id || payload.caseId || common.id, row: common }];
    if (!items.length) throw new Error('沒有可更新的批次資料');
    let changed = false;
    const output = items.map(item => {
      const patch = Object.assign({}, common, item.row || {}, item.changes || {});
      const id = String(item.id || item.caseId || patch.id || patch['案件編號'] || '').trim();
      const index = rows.findIndex(row => String(row[githubJsonCaseHeader_(table, 'id')] || '').trim() === id);
      if (index < 0) throw new Error('找不到案件：' + id);
      const updated = githubJsonCaseRow_(table, patch, rows[index]);
      updated[githubJsonCaseHeader_(table, 'id')] = id;
      if (githubJsonInputValue_(patch, 'start').found) updated[githubJsonCaseHeader_(table, 'month')] = monthFromDate_(updated[githubJsonCaseHeader_(table, 'start')]);
      if (githubJsonInputValue_(patch, 'qty').found && !githubJsonInputValue_(patch, 'weight').found) updated[githubJsonCaseHeader_(table, 'weight')] = String(Number(updated[githubJsonCaseHeader_(table, 'qty')]) || 1);
      githubJsonSyncSupplementLinks_(database, table, updated, changedTables);
      const rowChanged = table.headers.some(header => String(updated[header] || '') !== String(rows[index][header] || ''));
      if (rowChanged) {
        rows[index] = updated;
        changed = true;
      }
      return githubJsonCaseApiRow_(table, updated, index);
    });
    return { changed, changedTables: changed ? changedTables : [], result: normalizedAction === 'batchUpdate'
      ? { ok: true, action: 'batchUpdate', count: output.length, rows: output, updated: payload.writeHeaders || [] }
      : { ok: true, action: 'update', id: output[0].id, row: output[0], updated: payload.writeHeaders || [] } };
  }
  if (normalizedAction === 'delete') {
    assertAccountCapability_(payload, payload && payload.accessContext === 'archive' ? 'archive.edit' : 'request.delete', false);
    const id = String(payload.id || payload.caseId || '').trim();
    const index = rows.findIndex(row => String(row[githubJsonCaseHeader_(table, 'id')] || '').trim() === id);
    if (index < 0) throw new Error('找不到案件：' + id);
    const deleted = rows.splice(index, 1)[0];
    return { changed: true, changedTables, result: { ok: true, action: 'delete', id, row: githubJsonCaseApiRow_(table, deleted) } };
  }
  throw new Error('不支援的 GitHub JSON 動作：' + action);
}

function mirrorGithubJsonTableToSheet_(database, tableName) {
  const target = adminTableSheet_(tableName);
  const table = githubJsonTable_(database, tableName);
  const headers = table.headers.map(value => String(value || '').trim()).filter(Boolean);
  if (!headers.length) throw new Error('GitHub JSON 資料表沒有欄位：' + tableName);
  const sheet = target.sheet;
  const values = table.rows.map(row => headers.map(header => row[header] == null ? '' : row[header]));
  const requiredRows = Math.max(2, values.length + 1);
  const requiredColumns = Math.max(1, headers.length);
  if (sheet.getMaxRows() < requiredRows) sheet.insertRowsAfter(sheet.getMaxRows(), requiredRows - sheet.getMaxRows());
  if (sheet.getMaxColumns() < requiredColumns) sheet.insertColumnsAfter(sheet.getMaxColumns(), requiredColumns - sheet.getMaxColumns());
  const clearRows = Math.max(sheet.getLastRow(), values.length + 1);
  const clearColumns = Math.max(sheet.getLastColumn(), headers.length);
  sheet.getRange(1, 1, clearRows, clearColumns).clearContent();
  sheet.getRange(1, 1, 1, headers.length).setValues([headers]);
  if (values.length) sheet.getRange(2, 1, values.length, headers.length).setValues(values);
  sheet.setFrozenRows(1);
}

function queueGithubJsonBackupRetry_(tableNames, revision, error) {
  const properties = PropertiesService.getScriptProperties();
  let queue = [];
  try { queue = JSON.parse(properties.getProperty(GITHUB_JSON_BACKUP_QUEUE_PROPERTY) || '[]'); } catch (ignored) {}
  queue.push({ tables: tableNames, revision, queuedAt: new Date().toISOString(), error: String(error && error.message || error) });
  properties.setProperty(GITHUB_JSON_BACKUP_QUEUE_PROPERTY, JSON.stringify(queue.slice(-20)));
  const exists = ScriptApp.getProjectTriggers().some(trigger => trigger.getHandlerFunction() === GITHUB_JSON_BACKUP_TRIGGER);
  if (!exists) ScriptApp.newTrigger(GITHUB_JSON_BACKUP_TRIGGER).timeBased().after(60 * 1000).create();
  return { ok: false, pending: true, queued: true, tables: [...new Set(tableNames || [])] };
}

function mirrorGithubJsonTables_(database, tableNames) {
  const tables = [...new Set(tableNames || [])];
  try {
    tables.forEach(tableName => mirrorGithubJsonTableToSheet_(database, tableName));
    SpreadsheetApp.flush();
    return { ok: true, tables };
  } catch (error) {
    queueGithubJsonBackupRetry_(tables, database.revision, error);
    return { ok: false, pending: true, tables, error: String(error && error.message || error) };
  }
}

function retryGithubJsonDatabaseBackups() {
  const properties = PropertiesService.getScriptProperties();
  let queue = [];
  try { queue = JSON.parse(properties.getProperty(GITHUB_JSON_BACKUP_QUEUE_PROPERTY) || '[]'); } catch (ignored) {}
  const tables = [...new Set(queue.flatMap(item => item.tables || []))];
  if (!tables.length) return { ok: true, skipped: true };
  const source = readGithubJsonDatabase_();
  tables.forEach(tableName => mirrorGithubJsonTableToSheet_(source.database, tableName));
  SpreadsheetApp.flush();
  properties.deleteProperty(GITHUB_JSON_BACKUP_QUEUE_PROPERTY);
  ScriptApp.getProjectTriggers()
    .filter(trigger => trigger.getHandlerFunction() === GITHUB_JSON_BACKUP_TRIGGER)
    .forEach(trigger => ScriptApp.deleteTrigger(trigger));
  return { ok: true, tables, revision: source.database.revision };
}

// allowSheetBackup 為 true 的情況：(1) 「填單」產生的案件寫入
// （githubJsonDatabaseWriteAction_，也就是 add/batchAdd/update/batchUpdate/delete）；
// (2) 資料庫後台（八張表管理介面）對 database 表的 adminTableUpdate_/adminTableDelete_
// （2026-08-11 起比照填單行為，回寫 gid=1244538986 那個「案件資料」分頁）。
// 其餘 7 張表（加權計分標準、短連結、補充資料連結、修改統計表、設定、reels、
// bug_report）以及 database 表的 adminTableInsert_（新案件一律走填單表單，見下方
// user_directory.gs 的說明）一律不回寫試算表，JSON 才是唯一資料來源，避免後台編輯
// （尤其是加權計分標準）意外把整張分頁覆寫回試算表。
function mutateGithubJsonDatabase_(action, payload, mutator, options) {
  const allowSheetBackup = Boolean(options && options.allowSheetBackup);
  const lock = LockService.getScriptLock();
  lock.waitLock(30000);
  try {
    let lastError = null;
    for (let attempt = 0; attempt < 3; attempt += 1) {
      const source = readGithubJsonDatabase_();
      const outcome = mutator(source.database, action, payload);
      if (outcome.changed === false) return Object.assign({}, outcome.result, { jsonRevision: source.database.revision, backup: { ok: true, unchanged: true } });
      source.database.revision = (Number(source.database.revision) || 0) + 1;
      source.database.updatedAt = new Date().toISOString();
      source.database.source = Object.assign({}, source.database.source || {}, {
        type: 'github-json-primary',
        repository: DATABASE_ARCHIVE_GITHUB_REPOSITORY,
        path: GITHUB_JSON_DATABASE_PATH,
        branch: GITHUB_JSON_DATABASE_BRANCH
      });
      try {
        const written = writeGithubJsonDatabase_(source.database, source.sha, action);
        if ((outcome.changedTables || []).some(name => name === '帳號權限' || name === '角色權限範本')) CacheService.getScriptCache().remove(ACCOUNT_ACCESS_CACHE_KEY);
        const backup = payload && payload._skipSheetBackup
          ? { ok: true, skipped: true, source: 'sheet-snapshot', tables: [...new Set(outcome.changedTables || [])] }
          : allowSheetBackup
            ? queueGithubJsonBackupRetry_(outcome.changedTables || [], source.database.revision, 'JSON 寫入完成，試算表備份改由背景執行')
            : { ok: true, skipped: true, source: 'json-only', tables: [...new Set(outcome.changedTables || [])] };
        return Object.assign({}, outcome.result, { jsonRevision: source.database.revision, githubCommitSha: written.commitSha, backup });
      } catch (error) {
        lastError = error;
        if (error.githubStatus !== 409 && error.githubStatus !== 422) throw error;
      }
    }
    throw lastError || new Error('GitHub JSON 同時寫入衝突，請再試一次');
  } finally {
    lock.releaseLock();
  }
}

function githubJsonDatabaseWriteAction_(action, payload) {
  return mutateGithubJsonDatabase_(action, payload, githubJsonDatabaseAction_, { allowSheetBackup: true });
}

function readAdminTableSnapshot_(tableName) {
  const target = adminTableSheet_(tableName);
  const headers = adminTableHeaders_(target.sheet);
  const lastRow = target.sheet.getLastRow();
  const values = lastRow > 1
    ? target.sheet.getRange(2, 1, lastRow - 1, headers.length).getDisplayValues()
    : [];
  const rows = values
    .filter(valuesRow => valuesRow.some(value => String(value || '').trim()))
    .map(valuesRow => Object.fromEntries(headers.map((header, index) => [header, valuesRow[index] == null ? '' : String(valuesRow[index])] )));
  return {
    name: target.name,
    headers,
    primaryKey: target.config.primaryKey || null,
    rows
  };
}

function syncGithubJsonTableFromSheet_(tableName, action) {
  const snapshot = readAdminTableSnapshot_(tableName);
  const payload = { table: snapshot.name, _skipSheetBackup: true };
  return mutateGithubJsonDatabase_('sync ' + snapshot.name + ' after ' + String(action || 'write'), payload, database => {
    const current = githubJsonTable_(database, snapshot.name);
    const changed = JSON.stringify(current.headers || []) !== JSON.stringify(snapshot.headers)
      || String(current.primaryKey || '') !== String(snapshot.primaryKey || '')
      || JSON.stringify(current.rows || []) !== JSON.stringify(snapshot.rows);
    if (changed) {
      database.tables[snapshot.name] = {
        headers: snapshot.headers,
        primaryKey: snapshot.primaryKey,
        rows: snapshot.rows
      };
    }
    return {
      changed,
      changedTables: changed ? [snapshot.name] : [],
      result: {
        ok: true,
        action: 'syncGithubJsonTable',
        table: snapshot.name,
        rowCount: snapshot.rows.length,
        unchanged: !changed
      }
    };
  });
}

function attachGithubJsonTableSync_(result, tableName, action) {
  const sync = syncGithubJsonTableFromSheet_(tableName, action);
  return Object.assign({}, result, {
    jsonRevision: sync.jsonRevision,
    githubCommitSha: sync.githubCommitSha || '',
    databaseSync: {
      ok: true,
      table: tableName,
      rowCount: sync.rowCount,
      unchanged: Boolean(sync.unchanged),
      revision: sync.jsonRevision,
      commitSha: sync.githubCommitSha || ''
    }
  });
}

function syncSecondaryGithubJsonTablesNow() {
  const tables = ['短連結', '修改統計表', '設定', 'reels', 'bug_report'];
  return {
    ok: true,
    action: 'syncSecondaryGithubJsonTablesNow',
    results: tables.map(tableName => syncGithubJsonTableFromSheet_(tableName, 'manual reconciliation'))
  };
}

function adminTableConfig_(tableName) {
  const name = String(tableName || '').trim();
  const config = ADMIN_TABLE_CONFIG[name];
  if (!config) throw new Error('找不到資料表');
  return { name, config };
}

function adminTableSheet_(tableName) {
  const target = adminTableConfig_(tableName);
  const spreadsheet = SpreadsheetApp.openById(SPREADSHEET_ID);
  const sheet = target.config.sheetId
    ? spreadsheet.getSheets().find(item => item.getSheetId() === Number(target.config.sheetId))
    : spreadsheet.getSheetByName(target.config.sheetName);
  if (!sheet) throw new Error(`找不到資料表：${target.name}`);
  return { name: target.name, config: target.config, sheet };
}

function adminTableHeaders_(sheet) {
  const lastColumn = Math.max(1, sheet.getLastColumn());
  const values = sheet.getRange(1, 1, 1, lastColumn).getDisplayValues()[0].map(value => String(value || '').trim());
  while (values.length && !values[values.length - 1]) values.pop();
  if (!values.length) throw new Error(`資料表「${sheet.getName()}」沒有標題列`);
  return values;
}

function adminTableRowObject_(headers, values, rowNumber) {
  const row = { _rowNumber: rowNumber };
  headers.forEach((header, index) => { if (header) row[header] = values[index] == null ? '' : String(values[index]); });
  return row;
}

function assertAdminTableRowUnchanged_(target, headers, rowNumber, expectedRow) {
  if (!expectedRow || typeof expectedRow !== 'object') return;
  const currentValues = target.sheet.getRange(rowNumber, 1, 1, headers.length).getDisplayValues()[0];
  const currentRow = adminTableRowObject_(headers, currentValues, rowNumber);
  const compareHeaders = target.config.primaryKey && headers.indexOf(target.config.primaryKey) >= 0
    ? [target.config.primaryKey]
    : headers;
  const unchanged = compareHeaders.every(header => String(currentRow[header] || '') === String(expectedRow[header] || ''));
  if (!unchanged) throw new Error('這筆資料已被其他操作變更，請重新讀取後再試一次');
}

function adminTables_(payload) {
  assertDatabaseAdmin_(payload);
  const source = readGithubJsonDatabase_();
  const tables = {};
  Object.keys(ADMIN_TABLE_CONFIG).forEach(name => {
    const table = githubJsonTable_(source.database, name);
    tables[name] = {
      headers: table.headers,
      primaryKey: table.primaryKey || ADMIN_TABLE_CONFIG[name].primaryKey || null,
      rowCount: table.rows.length
    };
  });
  return { ok: true, action: 'adminTables', revision: source.database.revision, updatedAt: source.database.updatedAt, source: 'github-json-primary', tables };
}

function adminTableRows_(payload) {
  assertDatabaseAdmin_(payload);
  const tableName = String(payload && payload.table || '').trim();
  adminTableConfig_(tableName);
  const source = readGithubJsonDatabase_();
  const table = githubJsonTable_(source.database, tableName);
  const headers = table.headers;
  const query = String(payload && payload.q || '').trim().toLocaleLowerCase();
  const sortKey = String(payload && payload.sort || '').trim();
  const descending = String(payload && payload.order || '').toLowerCase() === 'desc';
  const offset = Math.max(0, Number(payload && payload.offset) || 0);
  const limit = Math.min(500, Math.max(1, Number(payload && payload.limit) || 50));
  let rows = table.rows.map((row, index) => Object.assign({ _rowNumber: index + 2 }, row));
  if (query) rows = rows.filter(row => headers.some(header => String(row[header] || '').toLocaleLowerCase().includes(query)));
  if (sortKey && headers.indexOf(sortKey) >= 0) rows.sort((left, right) => {
    const result = String(left[sortKey] || '').localeCompare(String(right[sortKey] || ''), 'zh-Hant', { numeric: true, sensitivity: 'base' });
    return descending ? -result : result;
  });
  const total = rows.length;
  return { ok: true, action: 'adminTableRows', table: tableName, revision: source.database.revision, offset, limit, total, rows: rows.slice(offset, offset + limit) };
}

function adminTableUpdate_(payload) {
  assertDatabaseAdmin_(payload);
  const tableName = String(payload && payload.table || '').trim();
  const config = adminTableConfig_(tableName).config;
  return mutateGithubJsonDatabase_('admin update ' + tableName, payload, database => {
    const table = githubJsonTable_(database, tableName);
    const rowNumber = Number(payload && payload.rowNumber);
    const index = rowNumber - 2;
    if (!Number.isInteger(rowNumber) || rowNumber < 2 || !table.rows[index]) throw new Error('找不到要編輯的資料');
    const expected = payload && payload.expectedRow;
    const compareHeaders = config.primaryKey ? [config.primaryKey] : table.headers;
    if (expected && !compareHeaders.every(header => String(table.rows[index][header] || '') === String(expected[header] || ''))) throw new Error('這筆資料已被其他操作變更，請重新讀取後再試一次');
    const patch = payload && payload.row && typeof payload.row === 'object' ? payload.row : {};
    const updated = Object.assign({}, table.rows[index]);
    table.headers.forEach(header => { if (Object.prototype.hasOwnProperty.call(patch, header)) updated[header] = patch[header] == null ? '' : String(patch[header]); });
    if (config.primaryKey) {
      const keyValue = String(updated[config.primaryKey] || '').trim();
      if (!keyValue) throw new Error('「' + config.primaryKey + '」不可空白');
      if (table.rows.some((row, itemIndex) => itemIndex !== index && String(row[config.primaryKey] || '').trim() === keyValue)) throw new Error('「' + config.primaryKey + '」已經存在');
    }
    const changed = table.headers.some(header => String(updated[header] || '') !== String(table.rows[index][header] || ''));
    if (!changed) {
      return {
        changed: false,
        changedTables: [],
        result: { ok: true, action: 'adminTableUpdate', table: tableName, rowNumber, row: Object.assign({ _rowNumber: rowNumber }, updated), unchanged: true }
      };
    }
    table.rows[index] = updated;
    const changedTables = [tableName];
    if (tableName === '加權計分標準' && recalculateDatabaseWeights_(database)) changedTables.push('database');
    return { changed: true, changedTables, result: { ok: true, action: 'adminTableUpdate', table: tableName, rowNumber, row: Object.assign({ _rowNumber: rowNumber }, updated) } };
  }, { allowSheetBackup: tableName === 'database' });
}

// adminTableInsert_ lives in user_directory.gs (loaded after this file in the
// Apps Script project) so there is exactly one definition; see that file for
// the generic-table + 設定-specific-validation implementation.

function adminTableDelete_(payload) {
  assertDatabaseAdmin_(payload);
  const tableName = String(payload && payload.table || '').trim();
  const config = adminTableConfig_(tableName).config;
  return mutateGithubJsonDatabase_('admin delete ' + tableName, payload, database => {
    const table = githubJsonTable_(database, tableName);
    const rowNumber = Number(payload && payload.rowNumber);
    const index = rowNumber - 2;
    if (!Number.isInteger(rowNumber) || rowNumber < 2 || !table.rows[index]) throw new Error('找不到要刪除的資料');
    const expected = payload && payload.expectedRow;
    const compareHeaders = config.primaryKey ? [config.primaryKey] : table.headers;
    if (expected && !compareHeaders.every(header => String(table.rows[index][header] || '') === String(expected[header] || ''))) throw new Error('這筆資料已被其他操作變更，請重新讀取後再試一次');
    const deleted = table.rows.splice(index, 1)[0];
    const changedTables = [tableName];
    if (tableName === '加權計分標準' && recalculateDatabaseWeights_(database)) changedTables.push('database');
    return { changed: true, changedTables, result: { ok: true, action: 'adminTableDelete', table: tableName, rowNumber, deleted: Object.assign({ _rowNumber: rowNumber }, deleted) } };
  }, { allowSheetBackup: tableName === 'database' });
}

function updateIssueReportStatus_(payload) {
  if (!isIssueReportManagerToken_(payload && payload.editorToken)) throw new Error('僅管理者與 Machi 可修改回報狀態');
  const rowNumber = Number(payload && (payload.rowNumber || payload.id));
  const status = String(payload && payload.status || '').trim();
  if (!Number.isInteger(rowNumber) || rowNumber < 2) throw new Error('找不到要更新的回報');
  if (ISSUE_REPORT_STATUSES.indexOf(status) < 0) throw new Error('回報狀態不正確');
  const lock = LockService.getScriptLock();
  lock.waitLock(10000);
  try {
    const sheet = getIssueReportSheet_();
    if (rowNumber > sheet.getLastRow()) throw new Error('找不到要更新的回報');
    const headerMap = buildIssueReportHeaderMap_(sheet);
    const time = issueReportTimestamp_();
    sheet.getRange(rowNumber, headerMap['狀態']).setValue(status);
    sheet.getRange(rowNumber, headerMap['狀態更改時間']).setValue(time);
    sheet.getRange(rowNumber, headerMap[status]).setValue(time);
    SpreadsheetApp.flush();
    const lastColumn = Math.max(sheet.getLastColumn(), ...Object.values(headerMap));
    const values = sheet.getRange(rowNumber, 1, 1, lastColumn).getDisplayValues()[0];
    return { rowNumber, row: issueReportRowObject_(values, headerMap, rowNumber) };
  } finally {
    lock.releaseLock();
  }
}

function newProjectConfigForDesigner_(designer) {
  designer = String(designer || '').trim();
  if (FLAT_ROTATION_DESIGNERS.indexOf(designer) >= 0) {
    return {
      kind: '平面',
      sheetId: FLAT_PROJECT_SHEET_ID,
      sheetName: FLAT_PROJECT_SHEET_NAME,
      rotationDesigners: FLAT_ROTATION_DESIGNERS,
      databaseType: '平面'
    };
  }
  if (VIDEO_ROTATION_DESIGNERS.indexOf(designer) >= 0) {
    return {
      kind: '影音',
      sheetId: VIDEO_PROJECT_SHEET_ID,
      sheetName: VIDEO_PROJECT_SHEET_NAME,
      rotationDesigners: VIDEO_ROTATION_DESIGNERS,
      databaseType: '影音'
    };
  }
  return null;
}

function getNewProjectSheet_(config) {
  const spreadsheet = SpreadsheetApp.openById(SPREADSHEET_ID);
  const idMatchedSheet = spreadsheet.getSheets().find(candidate => candidate.getSheetId() === config.sheetId);
  if (idMatchedSheet) return idMatchedSheet;
  const namedSheet = spreadsheet.getSheetByName(config.sheetName);
  if (namedSheet) return namedSheet;
  throw new Error(`找不到「${config.sheetName}」分頁`);
}

function buildNewProjectHeaderMap_(sheet) {
  const lastColumn = Math.max(sheet.getLastColumn(), NEW_PROJECT_HEADERS.length);
  const headers = sheet.getRange(1, 1, 1, lastColumn).getValues()[0].map(value => String(value || '').trim());
  const headerMap = {};
  NEW_PROJECT_HEADERS.forEach((header, offset) => {
    let index = headers.indexOf(header);
    if (index < 0) {
      index = offset;
      sheet.getRange(1, index + 1).setValue(header);
      headers[index] = header;
    }
    headerMap[header] = index + 1;
  });
  return headerMap;
}

function normalizeProjectDesigner_(value, config) {
  const text = String(value || '').trim();
  return (config.rotationDesigners || []).find(name => name.toLowerCase() === text.toLowerCase()) || '';
}

function normalizeProjectDate_(value) {
  const text = String(value || '').trim();
  const match = text.match(/(19\d{2}|20\d{2}|2100)[/-](\d{1,2})[/-](\d{1,2})/);
  if (!match) return text;
  return `${match[1]}/${String(Number(match[2])).padStart(2, '0')}/${String(Number(match[3])).padStart(2, '0')}`;
}

function nextFlatProjectRow_(sheet, headerMap) {
  const clientColumn = headerMap['客戶別'];
  const lastRow = Math.max(sheet.getLastRow(), 1);
  if (lastRow <= 1) return 2;
  const values = sheet.getRange(2, clientColumn, lastRow - 1, 1).getDisplayValues().flat();
  for (let index = values.length - 1; index >= 0; index -= 1) {
    if (String(values[index] || '').trim()) return index + 3;
  }
  return 2;
}

function newProjectDatabasePayload_(valuesByHeader, config) {
  const actualDesigner = valuesByHeader['替換(選填)'] || valuesByHeader['預計設計師'];
  const projectType = String(valuesByHeader['專案類型'] || '').trim();
  const stage = config.databaseType === '影音' && projectType === '平面拍攝' ? '拍攝' : '提案';
  return {
    client: valuesByHeader['客戶別'],
    project: valuesByHeader['專案名稱'],
    owner: valuesByHeader['專案負責人'],
    type: config.databaseType,
    stage,
    qty: valuesByHeader['數量'],
    start: valuesByHeader['開始時間'],
    end: valuesByHeader['結束時間'],
    designer: actualDesigner,
    status: '未開始'
  };
}

function createFlatProject_(row) {
  row = row || {};
  const rawExpectedDesigner = String(row.expectedDesigner || row['預計設計師'] || '').trim();
  const config = newProjectConfigForDesigner_(rawExpectedDesigner);
  if (!config) throw new Error('預計設計師必須為平面組或影音組輪值名單');
  const expectedDesigner = normalizeProjectDesigner_(rawExpectedDesigner, config);
  const replacementDesigner = normalizeProjectDesigner_(row.replacement || row['替換(選填)'], config);
  const effectiveReplacement = replacementDesigner && replacementDesigner !== expectedDesigner ? replacementDesigner : '';
  const reason = String(row.reason || row['調整原因(選填)'] || '').trim();
  const valuesByHeader = {
    '客戶別': String(row.client || row['客戶別'] || '').trim(),
    '專案名稱': String(row.project || row['專案名稱'] || '').trim(),
    '專案負責人': String(row.owner || row['專案負責人'] || '').trim(),
    '專案類型': String(row.projectType || row['專案類型'] || '').trim(),
    '數量': String(row.qty || row['數量'] || '').trim(),
    '開始時間': normalizeProjectDate_(row.start || row['開始時間']),
    '結束時間': normalizeProjectDate_(row.end || row['結束時間']),
    '預計設計師': expectedDesigner,
    '替換(選填)': effectiveReplacement,
    '調整原因(選填)': effectiveReplacement ? reason : ''
  };

  NEW_PROJECT_HEADERS.forEach(header => {
    if (header !== '替換(選填)' && header !== '調整原因(選填)' && !valuesByHeader[header]) {
      throw new Error(`請填寫「${header}」`);
    }
  });
  if (!expectedDesigner) throw new Error(`預計設計師必須為${config.kind}組：${config.rotationDesigners.join('、')}`);
  if (replacementDesigner && replacementDesigner === expectedDesigner) valuesByHeader['替換(選填)'] = '';
  if (valuesByHeader['替換(選填)'] && !reason) throw new Error('有替換設計師時，請填寫調整原因');

  const sheet = getNewProjectSheet_(config);
  const headerMap = buildNewProjectHeaderMap_(sheet);
  const rowNumber = nextFlatProjectRow_(sheet, headerMap);
  const startColumn = Math.min(...NEW_PROJECT_HEADERS.map(header => headerMap[header]));
  const endColumn = Math.max(...NEW_PROJECT_HEADERS.map(header => headerMap[header]));
  const width = endColumn - startColumn + 1;
  const writeValues = new Array(width).fill('');
  NEW_PROJECT_HEADERS.forEach(header => {
    writeValues[headerMap[header] - startColumn] = valuesByHeader[header];
  });
  sheet.getRange(rowNumber, startColumn, 1, width).setValues([writeValues]);

  const consumedDesigner = valuesByHeader['替換(選填)'] || expectedDesigner;
  const databaseResult = appendRow_(newProjectDatabasePayload_(valuesByHeader, config), {
    writeHeaders: FORM_WRITE_HEADERS,
    forceHeaders: FORM_WRITE_HEADERS
  });
  const rotations = updateNewProjectRotation_(consumedDesigner, config);
  SpreadsheetApp.flush();
  CacheService.getScriptCache().remove('sheetValues:' + SETTINGS_SHEET_ID);
  CacheService.getScriptCache().remove('sheetValues:' + config.sheetId);
  return {
    rowNumber,
    projectKind: config.kind,
    row: valuesByHeader,
    databaseRowNumber: databaseResult.rowNumber,
    databaseRow: databaseResult.row,
    rotations
  };
}

function updateNewProjectRotation_(consumedDesigner, config) {
  consumedDesigner = normalizeProjectDesigner_(consumedDesigner, config);
  if (!consumedDesigner) throw new Error('找不到本次要更新輪值的設計師');
  const sheet = getSettingsSheet_();
  const headerMap = buildSettingsHeaderMap_(sheet);
  const rotationColumn = headerMap[USER_NEW_PROJECT_ROTATION_HEADER];
  const rotationDesigners = config.rotationDesigners || [];
  const rows = rotationDesigners.map((name, index) => {
    const rowNumber = findEditorSettingsRow_(sheet, headerMap, name, true);
    const value = Number(sheet.getRange(rowNumber, rotationColumn).getDisplayValue()) || index + 1;
    return { name, rowNumber, rotation: value };
  }).sort((a, b) => a.rotation - b.rotation || rotationDesigners.indexOf(a.name) - rotationDesigners.indexOf(b.name));
  const rankByName = {};
  rows.forEach((item, index) => {
    rankByName[item.name] = index + 1;
  });
  const consumedRank = rankByName[consumedDesigner] || rotationDesigners.indexOf(consumedDesigner) + 1;
  const nextRanks = {};
  rows.forEach(item => {
    if (item.name === consumedDesigner) {
      nextRanks[item.name] = rotationDesigners.length;
    } else if ((rankByName[item.name] || item.rotation) > consumedRank) {
      nextRanks[item.name] = (rankByName[item.name] || item.rotation) - 1;
    } else {
      nextRanks[item.name] = rankByName[item.name] || item.rotation;
    }
  });
  rotationDesigners.forEach(name => {
    const rowNumber = findEditorSettingsRow_(sheet, headerMap, name, true);
    sheet.getRange(rowNumber, rotationColumn).setValue(nextRanks[name] || rotationDesigners.indexOf(name) + 1);
  });
  return rotationDesigners.map(name => ({ name, rotation: nextRanks[name] || rotationDesigners.indexOf(name) + 1 }));
}

function getSheet_() {
  const spreadsheet = SpreadsheetApp.openById(SPREADSHEET_ID);
  const idMatchedSheet = spreadsheet.getSheets().find(candidate => candidate.getSheetId() === TARGET_SHEET_ID);
  if (idMatchedSheet && findHeaderRow_(idMatchedSheet, true)) return idMatchedSheet;

  if (SHEET_NAME) {
    const namedSheet = spreadsheet.getSheetByName(SHEET_NAME);
    if (namedSheet && findHeaderRow_(namedSheet, true)) return namedSheet;
  }

  throw new Error(`找不到指定資料分頁「${SHEET_NAME}」（gid ${TARGET_SHEET_ID}），請確認試算表 ID 與分頁名稱正確`);
}

function getSheetInfo_() {
  const sheet = getSheet_();
  const headerRow = findHeaderRow_(sheet);
  const headerMap = buildHeaderMap_(sheet, headerRow);
  return { sheet, headerRow, headerMap };
}

function findHeaderRow_(sheet, quiet) {
  const lastRow = Math.max(sheet.getLastRow(), 1);
  const lastColumn = Math.min(Math.max(sheet.getLastColumn(), HEADERS.length), HEADER_SCAN_COLUMNS);
  const scanRows = Math.min(lastRow, 30);
  const values = sheet.getRange(1, 1, scanRows, lastColumn).getValues();

  for (let rowIndex = 0; rowIndex < values.length; rowIndex += 1) {
    const row = values[rowIndex].map(String);
    if (row.includes('案件編號') && row.includes('客戶別') && row.includes('專案名稱')) {
      return rowIndex + 1;
    }
  }

  if (quiet) return null;
  throw new Error('找不到表頭列，請確認表單中有「案件編號、客戶別、專案名稱」欄位');
}

function buildHeaderMap_(sheet, headerRow) {
  const lastColumn = Math.min(Math.max(sheet.getLastColumn(), HEADERS.length), HEADER_SCAN_COLUMNS);
  const headers = sheet.getRange(headerRow, 1, 1, lastColumn).getValues()[0];
  const headerMap = {};

  HEADERS.forEach(header => {
    const acceptedHeaders = [header].concat(HEADER_ALIASES[header] || []);
    let index = headers.findIndex(value => acceptedHeaders.indexOf(String(value).trim()) >= 0);
    if (index < 0) {
      index = headers.findIndex(value => value === '');
      if (index < 0) index = headers.length;
      sheet.getRange(headerRow, index + 1).setValue(header);
      headers[index] = header;
    }
    headerMap[header] = index + 1;
  });

  return headerMap;
}

function readRows_(year, noCache) {
  const cacheKey = rowsCacheKey_(year);
  const cached = noCache ? null : getCachedRows_(cacheKey);
  if (cached) return cached;

  const { sheet, headerRow, headerMap } = getSheetInfo_();
  const lastRow = lastCaseRow_(sheet, headerRow, headerMap);
  if (lastRow <= headerRow) return [];
  const readColumnCount = Math.max(...Object.values(headerMap));

  const rows = sheet
    .getRange(headerRow + 1, 1, lastRow - headerRow, readColumnCount)
    .getValues()
    .map((values, index) => ({ values, rowNumber: headerRow + 1 + index }))
    .filter(item => item.values.some(value => value !== ''))
    .filter(item => isCaseId_(item.values[headerMap['案件編號'] - 1]))
    .map(item => valuesToObject_(item.values, headerMap, item.rowNumber))
    .filter(row => !year || rowYear_(row) === String(year));

  if (!noCache) putCachedRows_(cacheKey, rows);
  return rows;
}

function readRecentRows_(limit, noCache) {
  const normalizedLimit = Math.min(Math.max(Number(limit) || 30, 1), 120);
  const cacheKey = recentRowsCacheKey_(normalizedLimit);
  const cached = noCache ? null : getCachedRows_(cacheKey);
  if (cached) return cached;

  const { sheet, headerRow, headerMap } = getSheetInfo_();
  const lastRow = lastCaseRowFromBottom_(sheet, headerRow, headerMap, Math.max(normalizedLimit * 4, 160));
  if (lastRow <= headerRow) return [];
  const rowCount = Math.min(normalizedLimit, lastRow - headerRow);
  const startRow = Math.max(headerRow + 1, lastRow - rowCount + 1);
  const readColumnCount = Math.max(...Object.values(headerMap));
  const rows = sheet
    .getRange(startRow, 1, lastRow - startRow + 1, readColumnCount)
    .getDisplayValues()
    .map((values, index) => ({ values, rowNumber: startRow + index }))
    .filter(item => item.values.some(value => String(value || '').trim() !== ''))
    .filter(item => isCaseId_(item.values[headerMap['案件編號'] - 1]))
    .map(item => valuesToObject_(item.values, headerMap, item.rowNumber));
  if (!noCache) putCachedRows_(cacheKey, rows);
  return rows;
}

function readRawRows_(year) {
  const cacheKey = rawRowsCacheKey_(year);
  const cached = getCachedRows_(cacheKey);
  if (cached) return cached;

  const { sheet, headerRow, headerMap } = getSheetInfo_();
  const lastRow = lastCaseRow_(sheet, headerRow, headerMap);
  if (lastRow <= headerRow) return [];
  const lastColumn = Math.min(Math.max(sheet.getLastColumn(), HEADERS.length), HEADER_SCAN_COLUMNS);
  const values = sheet.getRange(headerRow, 1, lastRow - headerRow + 1, lastColumn).getDisplayValues();
  const headers = values.shift().map(value => String(value || '').trim());
  const rows = values
    .map((row, index) => ({ row, rowNumber: headerRow + 1 + index }))
    .filter(item => item.row.some(value => String(value).trim() !== ''))
    .map(item => {
      const row = Object.fromEntries(headers.map((header, index) => [header, item.row[index] || '']));
      row.sheetRow = item.rowNumber;
      row._sheetRow = item.rowNumber;
      return row;
    })
    .filter(row => isCaseId_(row['案件編號']))
    .filter(row => !year || rawRowYear_(row) === String(year));

  putCachedRows_(cacheKey, rows);
  return rows;
}

function readSheetValuesById_(sheetId) {
  const cacheKey = 'sheetValues:' + sheetId;
  const cached = getCachedRows_(cacheKey);
  if (cached) return cached;

  const sheet = SpreadsheetApp.openById(SPREADSHEET_ID)
    .getSheets()
    .find(candidate => candidate.getSheetId() === sheetId);
  const values = sheet ? sheet.getDataRange().getDisplayValues() : [];
  putCachedRows_(cacheKey, values);
  return values;
}

function getModificationStatsSheet_() {
  const spreadsheet = SpreadsheetApp.openById(SPREADSHEET_ID);
  const idMatchedSheet = spreadsheet.getSheets().find(candidate => candidate.getSheetId() === MODIFICATION_STATS_SHEET_ID);
  if (idMatchedSheet) return idMatchedSheet;
  const namedSheet = spreadsheet.getSheetByName(MODIFICATION_STATS_SHEET_NAME);
  if (namedSheet) return namedSheet;
  throw new Error(`找不到「${MODIFICATION_STATS_SHEET_NAME}」分頁`);
}

function buildModificationStatsHeaderMap_(sheet) {
  const lastColumn = Math.max(sheet.getLastColumn(), MODIFICATION_STATS_HEADERS.length);
  const headers = sheet.getRange(1, 1, 1, lastColumn).getValues()[0].map(value => String(value || '').trim());
  const headerMap = {};
  MODIFICATION_STATS_HEADERS.forEach((header, offset) => {
    let index = headers.indexOf(header);
    if (index < 0) {
      index = offset;
      sheet.getRange(1, index + 1).setValue(header);
      headers[index] = header;
    }
    headerMap[header] = index + 1;
  });
  return headerMap;
}

function modificationStatsValues_() {
  const sheet = getModificationStatsSheet_();
  const headerMap = buildModificationStatsHeaderMap_(sheet);
  const lastRow = Math.max(sheet.getLastRow(), 1);
  if (lastRow <= 1) return { sheet, headerMap, rows: [] };
  const width = Math.max(...Object.values(headerMap));
  const values = sheet.getRange(2, 1, lastRow - 1, width).getDisplayValues();
  const rows = values
    .map((row, index) => ({ row, rowNumber: index + 2 }))
    .filter(item => String(item.row[headerMap['案件編號'] - 1] || '').trim());
  return { sheet, headerMap, rows };
}

function modificationCountForCase_(caseId) {
  const stats = modificationStatsValues_();
  return stats.rows
    .filter(item => String(item.row[stats.headerMap['案件編號'] - 1] || '').trim() === String(caseId || '').trim())
    .reduce((max, item) => Math.max(max, modificationCountValue_(item.row[stats.headerMap['修改次數'] - 1])), 0);
}

function modificationCountValue_(value) {
  const text = String(value || '').trim();
  const number = Number(text);
  if (number) return number;
  const labels = { 一: 1, 二: 2, 三: 3, 四: 4, 五: 5, 六: 6, 七: 7, 八: 8, 九: 9, 十: 10 };
  const match = text.match(/[一二三四五六七八九十]|\d+/);
  if (!match) return 0;
  return labels[match[0]] || Number(match[0]) || 0;
}

function addModificationRecord_(payload) {
  const caseId = String(payload.caseId || payload.id || payload['案件編號'] || '').trim();
  const modifyDate = normalizeProjectDate_(payload.modifyDate || payload['修改日期']);
  const content = String(payload.content || payload['修改內容'] || '').trim();
  const tokenUser = editorDisplayNameFromToken_(payload.editorToken);
  const modifier = String(tokenUser || payload.modifier || payload.owner || payload['修改人'] || payload['專案負責人'] || '').trim();
  if (!caseId) throw new Error('缺少案件編號');
  if (!modifyDate) throw new Error('請填寫修改日期');
  if (!content) throw new Error('請填寫修改內容');
  if (!modifier) throw new Error('缺少修改人');

  const stats = modificationStatsValues_();
  const count = modificationCountForCase_(caseId) + 1;
  const rowNumber = Math.max(stats.sheet.getLastRow() + 1, 2);
  const today = Utilities.formatDate(new Date(), ADMIN_LOGIN_PASSWORD_TIMEZONE, 'yyyy/MM/dd HH:mm:ss');
  const record = {
    '案件編號': caseId,
    '修改次數': count,
    '建立日期': today,
    '修改日期': modifyDate,
    '修改內容': content,
    '修改人': modifier
  };
  const startColumn = Math.min(...MODIFICATION_STATS_HEADERS.map(header => stats.headerMap[header]));
  const endColumn = Math.max(...MODIFICATION_STATS_HEADERS.map(header => stats.headerMap[header]));
  const values = new Array(endColumn - startColumn + 1).fill('');
  MODIFICATION_STATS_HEADERS.forEach(header => {
    values[stats.headerMap[header] - startColumn] = record[header];
  });
  stats.sheet.getRange(rowNumber, startColumn, 1, values.length).setValues([values]);
  SpreadsheetApp.flush();
  CacheService.getScriptCache().remove('sheetValues:' + MODIFICATION_STATS_SHEET_ID);
  return { rowNumber, record, count };
}

function updateModificationConfirm_(payload) {
  const caseId = String(payload.caseId || payload.id || payload['案件編號'] || '').trim();
  const count = Number(payload.count || payload['修改次數'] || 0) || 0;
  const tokenUser = editorUserFromToken_(payload.editorToken);
  if (!tokenUser) throw new Error('請先登入後再確認修正');
  if (!caseId) throw new Error('缺少案件編號');
  if (!count) throw new Error('缺少修改次數');

  const stats = modificationStatsValues_();
  const target = stats.rows.find(item =>
    String(item.row[stats.headerMap['案件編號'] - 1] || '').trim() === caseId &&
    modificationCountValue_(item.row[stats.headerMap['修改次數'] - 1]) === count
  );
  if (!target) throw new Error('找不到指定的修改紀錄');

  const hasConfirmedDate = Object.prototype.hasOwnProperty.call(payload, 'confirmedDate') ||
    Object.prototype.hasOwnProperty.call(payload, '確認修正日');
  const requestedConfirmedDate = payload.confirmedDate || payload['確認修正日'];
  const confirmedDate = hasConfirmedDate && !String(requestedConfirmedDate || '').trim()
    ? ''
    : Utilities.formatDate(new Date(), ADMIN_LOGIN_PASSWORD_TIMEZONE, 'yyyy/MM/dd HH:mm:ss');
  const confirmedCell = stats.sheet.getRange(target.rowNumber, stats.headerMap['確認修正日']);
  confirmedCell.setValue(confirmedDate);
  SpreadsheetApp.flush();
  const writtenDate = String(confirmedCell.getDisplayValue() || '').trim();
  if (confirmedDate && !writtenDate) throw new Error('確認修正日寫入後讀回為空，請確認欄位沒有被保護或公式覆蓋');
  CacheService.getScriptCache().remove('sheetValues:' + MODIFICATION_STATS_SHEET_ID);

  const record = {
    '案件編號': caseId,
    '修改次數': count,
    '建立日期': target.row[stats.headerMap['建立日期'] - 1] || '',
    '修改日期': target.row[stats.headerMap['修改日期'] - 1] || '',
    '修改內容': target.row[stats.headerMap['修改內容'] - 1] || '',
    '修改人': target.row[stats.headerMap['修改人'] - 1] || '',
    '確認修正日': writtenDate
  };
  return { rowNumber: target.rowNumber, record };
}

function readBundle_(year) {
  return {
    ok: true,
    action: 'bundle',
    version: SCRIPT_VERSION,
    spreadsheetId: SPREADSHEET_ID,
    sheetName: SHEET_NAME,
    targetSheetId: TARGET_SHEET_ID,
    rows: readRows_(year),
    databaseRows: readRawRows_(year),
    weights: readSheetValuesById_(WEIGHTS_SHEET_ID),
    stages: readSheetValuesById_(STAGES_SHEET_ID)
  };
}

function updateRow_(id, row, options) {
  const { sheet, headerRow, headerMap } = getSheetInfo_();
  const rowNumber = resolveUpdateRowNumber_(sheet, id, row, headerRow, headerMap, options || {});
  if (!rowNumber) throw new Error('Row not found: ' + id);

  const normalized = normalizeRow_(row);
  normalized.id = String(id);
  const existing = rowObjectAt_(sheet, rowNumber, headerMap);
  fillMissingCalculatedInputs_(normalized, row, existing);
  const effectiveOptions = withManagedCalculatedUpdate_(normalized, withManagedMonthUpdate_(normalized, options || {}), existing);
  syncSupplementShortLinks_([normalized], effectiveOptions.writeHeaders || effectiveOptions.forceHeaders || []);
  writeObjectToRow_(sheet, rowNumber, headerMap, normalized, effectiveOptions);
  clearRowsCache_();
  notifyDatabaseArchiveChanged_({ action: 'update', caseIds: [normalized.id] });
  return rowResponse_(normalized, rowNumber);
}

function updateRows_(payload) {
  const { sheet, headerRow, headerMap } = getSheetInfo_();
  const commonRow = updatePayloadRow_(payload);
  const forceHeaders = normalizeUpdateForceHeaders_(payload.forceHeaders || []);
  const writeHeaders = Object.prototype.hasOwnProperty.call(payload, 'writeHeaders')
    ? normalizeUpdateWriteHeaders_(payload.writeHeaders || [])
    : (forceHeaders.length ? forceHeaders : writeHeadersFromRow_(commonRow));
  assertEditorPermission_(payload, commonRow, writeHeaders);

  const items = Array.isArray(payload.rows) ? payload.rows : [];
  if (!items.length) throw new Error('沒有可更新的批次資料');

  const optionsBase = { forceHeaders, writeHeaders };
  const weights = updateTouchesCalculated_(writeHeaders, forceHeaders) ? weightMap_() : null;
  const rows = items.map(item => {
    const rowPayload = normalizeRow_(Object.assign(
      {},
      commonRow,
      item.row || {},
      item.changes || {},
      { id: item.id || item.caseId || item.row && item.row.id || commonRow.id }
    ));
    const id = item.id || item.caseId || rowPayload.id;
    if (!id) throw new Error('批次資料缺少案件編號');
    const options = Object.assign({}, optionsBase, {
      sheetRow: item.sheetRow || item.rowNumber || item._sheetRow,
      match: item.match || item.snapshot || {}
    });
    const rowNumber = resolveUpdateRowNumber_(sheet, id, rowPayload, headerRow, headerMap, options);
    if (!rowNumber) throw new Error('Row not found: ' + id);
    rowPayload.id = String(id);
    const existing = rowObjectAt_(sheet, rowNumber, headerMap);
    fillMissingCalculatedInputs_(rowPayload, Object.assign({}, commonRow, item.row || {}, item.changes || {}), existing);
    const effectiveOptions = withManagedCalculatedUpdate_(rowPayload, options, existing, weights);
    syncSupplementShortLinks_([rowPayload], effectiveOptions.writeHeaders || effectiveOptions.forceHeaders || []);
    writeObjectToRow_(sheet, rowNumber, headerMap, rowPayload, effectiveOptions);
    return rowResponse_(rowPayload, rowNumber);
  });

  SpreadsheetApp.flush();
  clearRowsCache_();
  notifyDatabaseArchiveChanged_({
    action: 'batch-update',
    caseIds: rows.map(row => row.id)
  });
  return { rows, updated: writeHeaders };
}

function supplementShortUrl_(slot, caseId) {
  return SUPPLEMENT_SHORT_LINK_BASE_URL + '/' + slot + '/' + String(caseId || '').trim();
}

function supplementLinkSheet_() {
  const spreadsheet = SpreadsheetApp.openById(SPREADSHEET_ID);
  let sheet = spreadsheet.getSheetByName(SUPPLEMENT_LINK_SHEET_NAME);
  if (!sheet) sheet = spreadsheet.insertSheet(SUPPLEMENT_LINK_SHEET_NAME);
  const currentHeaders = sheet.getRange(1, 1, 1, SUPPLEMENT_LINK_HEADERS.length).getDisplayValues()[0];
  const headersMatch = SUPPLEMENT_LINK_HEADERS.every((header, index) => currentHeaders[index] === header);
  if (!headersMatch) sheet.getRange(1, 1, 1, SUPPLEMENT_LINK_HEADERS.length).setValues([SUPPLEMENT_LINK_HEADERS]);
  sheet.setFrozenRows(1);
  return sheet;
}

function syncSupplementShortLinks_(rows, writeHeaders) {
  const list = Array.isArray(rows) ? rows : [];
  if (!list.length) return;
  const allowedHeaders = new Set(writeHeaders || []);
  const activeSlots = Object.keys(SUPPLEMENT_LINK_SLOTS).filter(slot => {
    return !allowedHeaders.size || allowedHeaders.has(SUPPLEMENT_LINK_SLOTS[slot].header);
  });
  if (!activeSlots.length) return;
  const hasLinkToSync = list.some(row => activeSlots.some(slot => {
    const value = String(row && row[SUPPLEMENT_LINK_SLOTS[slot].key] || '').trim();
    return value && value !== supplementShortUrl_(slot, row && row.id);
  }));
  if (!hasLinkToSync) return;

  const sheet = SpreadsheetApp.openById(SPREADSHEET_ID).getSheetByName(SUPPLEMENT_LINK_SHEET_NAME);
  if (!sheet) throw new Error('短網址對照表尚未建立');
  const lastRow = sheet.getLastRow();
  const existingValues = lastRow > 1
    ? sheet.getRange(2, 1, lastRow - 1, SUPPLEMENT_LINK_HEADERS.length).getDisplayValues()
    : [];
  const records = new Map();
  existingValues.forEach((values, index) => {
    const id = String(values[0] || '').trim();
    if (id) records.set(id, { rowNumber: index + 2, values: values.slice() });
  });

  list.forEach(row => {
    const caseId = String(row && row.id || '').trim();
    if (!/^\d{8}$/.test(caseId)) return;
    const existing = records.get(caseId);
    const record = existing ? existing.values.slice() : [caseId, '', '', '', '', ''];
    let changed = false;

    activeSlots.forEach(slot => {
      const config = SUPPLEMENT_LINK_SLOTS[slot];
      const columnIndex = slot.charCodeAt(0) - 96;
      const value = String(row[config.key] || '').trim();
      const shortUrl = supplementShortUrl_(slot, caseId);
      if (value === shortUrl) return;
      if (!value) {
        if (record[columnIndex]) {
          record[columnIndex] = '';
          changed = true;
        }
        row[config.key] = '';
        return;
      }
      if (!/^https?:\/\//i.test(value)) return;
      record[columnIndex] = value;
      row[config.key] = shortUrl;
      changed = true;
    });

    if (!changed) return;
    record[0] = caseId;
    record[5] = Utilities.formatDate(new Date(), ADMIN_LOGIN_PASSWORD_TIMEZONE, 'yyyy/MM/dd HH:mm');
    const rowNumber = existing ? existing.rowNumber : Math.max(sheet.getLastRow() + 1, 2);
    sheet.getRange(rowNumber, 1, 1, SUPPLEMENT_LINK_HEADERS.length).setValues([record]);
    records.set(caseId, { rowNumber, values: record });
    activeSlots.forEach(slot => CacheService.getScriptCache().remove('supplementLink:' + slot + ':' + caseId));
  });
}

function resolveSupplementLink_(payload) {
  const caseId = String(payload && (payload.id || payload.caseId) || '').trim();
  const slot = String(payload && payload.slot || '').trim().toLowerCase();
  if (!/^\d{8}$/.test(caseId)) throw new Error('案件編號格式錯誤');
  if (!SUPPLEMENT_LINK_SLOTS[slot]) throw new Error('補充資料類型錯誤');
  const cacheKey = 'supplementLink:' + slot + ':' + caseId;
  const cached = CacheService.getScriptCache().get(cacheKey);
  if (cached) return { ok: true, action: 'resolveSupplementLink', id: caseId, slot, url: cached };

  const sheet = supplementLinkSheet_();
  const match = sheet.getRange(2, 1, Math.max(sheet.getLastRow() - 1, 1), 1)
    .createTextFinder(caseId)
    .matchEntireCell(true)
    .findNext();
  if (!match) throw new Error('找不到短網址對應案件');
  const columnIndex = slot.charCodeAt(0) - 95;
  const url = String(sheet.getRange(match.getRow(), columnIndex).getDisplayValue() || '').trim();
  if (!/^https?:\/\//i.test(url)) throw new Error('此補充資料沒有可用連結');
  CacheService.getScriptCache().put(cacheKey, url, SUPPLEMENT_LINK_CACHE_SECONDS);
  return { ok: true, action: 'resolveSupplementLink', id: caseId, slot, url };
}

function shortLinkSheet_() {
  const spreadsheet = SpreadsheetApp.openById(SPREADSHEET_ID);
  let sheet = spreadsheet.getSheetByName(SHORT_LINK_SHEET_NAME);
  if (!sheet) sheet = spreadsheet.insertSheet(SHORT_LINK_SHEET_NAME);
  const currentHeaders = sheet.getRange(1, 1, 1, SHORT_LINK_HEADERS.length).getDisplayValues()[0];
  const headersMatch = SHORT_LINK_HEADERS.every((header, index) => currentHeaders[index] === header);
  if (!headersMatch) sheet.getRange(1, 1, 1, SHORT_LINK_HEADERS.length).setValues([SHORT_LINK_HEADERS]);
  sheet.setFrozenRows(1);
  return sheet;
}

function validShortLinkUrl_(value) {
  const url = String(value || '').trim();
  if (!/^https?:\/\/[^\s]+$/i.test(url)) throw new Error('請輸入有效的 http 或 https 網址');
  if (url.length > 2048) throw new Error('網址長度不可超過 2048 個字元');
  return url;
}

function randomShortLinkCode_() {
  let code = '';
  for (let index = 0; index < SHORT_LINK_CODE_LENGTH; index += 1) {
    code += SHORT_LINK_CODE_CHARS.charAt(Math.floor(Math.random() * SHORT_LINK_CODE_CHARS.length));
  }
  return code;
}

function createShortLink_(payload) {
  const url = validShortLinkUrl_(payload && payload.url);
  const lock = LockService.getScriptLock();
  lock.waitLock(20000);
  try {
    const sheet = shortLinkSheet_();
    const lastRow = sheet.getLastRow();
    const existingCodes = new Set(lastRow > 1
      ? sheet.getRange(2, 1, lastRow - 1, 1).getDisplayValues().map(row => String(row[0] || '').trim())
      : []);
    let code = '';
    for (let attempt = 0; attempt < 20 && !code; attempt += 1) {
      const candidate = randomShortLinkCode_();
      if (!existingCodes.has(candidate)) code = candidate;
    }
    if (!code) throw new Error('暫時無法產生短碼，請再試一次');
    sheet.appendRow([
      code,
      url,
      Utilities.formatDate(new Date(), ADMIN_LOGIN_PASSWORD_TIMEZONE, 'yyyy/MM/dd HH:mm:ss')
    ]);
    CacheService.getScriptCache().put('shortLink:' + code, url, SHORT_LINK_CACHE_SECONDS);
    return { ok: true, action: 'createShortLink', code, url };
  } finally {
    lock.releaseLock();
  }
}

function resolveShortLink_(payload) {
  const code = String(payload && payload.code || '').trim();
  if (!new RegExp('^[' + SHORT_LINK_CODE_CHARS + ']{' + SHORT_LINK_CODE_LENGTH + '}$').test(code)) {
    throw new Error('短碼格式錯誤');
  }
  const cacheKey = 'shortLink:' + code;
  const cached = CacheService.getScriptCache().get(cacheKey);
  if (cached) return { ok: true, action: 'resolveShortLink', code, url: cached };

  const sheet = shortLinkSheet_();
  const match = sheet.getRange(2, 1, Math.max(sheet.getLastRow() - 1, 1), 1)
    .createTextFinder(code)
    .matchEntireCell(true)
    .findNext();
  if (!match) throw new Error('找不到這個短連結');
  const url = validShortLinkUrl_(sheet.getRange(match.getRow(), 2).getDisplayValue());
  CacheService.getScriptCache().put(cacheKey, url, SHORT_LINK_CACHE_SECONDS);
  return { ok: true, action: 'resolveShortLink', code, url };
}

function appendRow_(row, options) {
  const lock = LockService.getScriptLock();
  lock.waitLock(20000);
  try {
    const cachedResult = cachedCreateResult_(options && options.requestId);
    if (cachedResult) return Object.assign({}, cachedResult, { deduplicated: true });

    const { sheet, headerRow, headerMap } = getSheetInfo_();
    const caseState = caseIdState_(sheet, headerRow, headerMap);
    const normalized = normalizeRow_(row || {});
    applyManagedCreateFields_(sheet, headerRow, headerMap, [normalized], caseState);
    syncSupplementShortLinks_([normalized], options && (options.writeHeaders || options.forceHeaders));
    applyManagedCalculatedFields_(normalized, null, weightMap_());
    const rowNumber = caseState.lastCaseRow + 1;

    writeNewObjectToRow_(sheet, rowNumber, headerMap, normalized, withManagedAppendHeaders_(options));
    clearRowsCache_();
    const result = {
      rowNumber,
      row: rowResponse_(normalized, rowNumber)
    };
    cacheCreateResult_(options && options.requestId, result);
    notifyDatabaseArchiveChanged_({ action: 'append', caseIds: [normalized.id] });
    return result;
  } finally {
    lock.releaseLock();
  }
}

function appendRows_(rows, options) {
  const lock = LockService.getScriptLock();
  lock.waitLock(20000);
  try {
  const cachedResult = cachedCreateResult_(options && options.requestId);
  if (cachedResult) return Object.assign({}, cachedResult, { deduplicated: true });

  const { sheet, headerRow, headerMap } = getSheetInfo_();
  const items = Array.isArray(rows) ? rows : [];
  if (!items.length) throw new Error('沒有可新增的批次資料');

  const normalizedRows = items.map(row => normalizeRow_(row || {}));
  const weights = weightMap_();
  const caseState = caseIdState_(sheet, headerRow, headerMap);
  applyManagedCreateFields_(sheet, headerRow, headerMap, normalizedRows, caseState);
  syncSupplementShortLinks_(normalizedRows, options && (options.writeHeaders || options.forceHeaders));
  normalizedRows.forEach(row => applyManagedCalculatedFields_(row, null, weights));
  const appendOptions = withManagedAppendHeaders_(options);
  const writeHeaders = normalizeAppendWriteHeaders_(appendOptions.writeHeaders);
  const forceHeaders = normalizeAppendWriteHeaders_(appendOptions.forceHeaders || writeHeaders);
  const writeColumns = writeHeaders
    .map(header => headerMap[header])
    .filter(Boolean)
    .sort((a, b) => a - b);
  if (!writeColumns.length) throw new Error('找不到可寫入的欄位');

  const startColumn = Math.min(...writeColumns);
  const endColumn = Math.max(...writeColumns);
  const width = endColumn - startColumn + 1;
  const rowCount = normalizedRows.length;
  let rowNumber = caseState.lastCaseRow + 1;
  if (!isBlankFormRange_(sheet, rowNumber, rowCount, headerMap)) {
    rowNumber = lastCaseRow_(sheet, headerRow, headerMap) + 1;
  }

  const values = normalizedRows.map(row => {
    const line = Array.from({ length: width }, () => '');
    writeHeaders.forEach(header => {
      const columnIndex = headerMap[header] - startColumn;
      if (columnIndex >= 0 && columnIndex < width) {
        line[columnIndex] = cellValue_(row[headerToKey_(header)]);
      }
    });
    return line;
  });

  sheet.getRange(rowNumber, startColumn, rowCount, width).setValues(values);
  clearRowsCache_();

  const result = {
    rowNumbers: Array.from({ length: rowCount }, (_, index) => rowNumber + index),
    rows: normalizedRows.map((row, index) => rowResponse_(row, rowNumber + index))
  };
  cacheCreateResult_(options && options.requestId, result);
  notifyDatabaseArchiveChanged_({
    action: 'batch-append',
    caseIds: normalizedRows.map(row => row.id)
  });
  return result;
  } finally {
    lock.releaseLock();
  }
}

function firstBlankFormRow_(sheet, headerRow, headerMap) {
  return lastCaseRow_(sheet, headerRow, headerMap) + 1;
}

function isBlankFormRange_(sheet, startRow, rowCount, headerMap) {
  if (!startRow || rowCount < 1) return false;
  const columns = FORM_WRITE_HEADERS
    .map(header => headerMap[header])
    .filter(Boolean);
  if (!columns.length) return true;

  const firstColumn = Math.min(...columns);
  const lastColumn = Math.max(...columns);
  const width = lastColumn - firstColumn + 1;
  const lastRow = Math.max(sheet.getLastRow(), startRow + rowCount - 1);
  const rowSpan = Math.max(0, lastRow - startRow + 1);
  if (!rowSpan) return true;

  const values = sheet.getRange(startRow, firstColumn, rowSpan, width).getValues();
  for (let index = 0; index < Math.min(rowCount, values.length); index += 1) {
    const row = values[index];
    const hasFormData = columns.some(column => String(row[column - firstColumn] || '').trim() !== '');
    if (hasFormData) return false;
  }
  return true;
}

function todayCaseIdPrefix_() {
  return Utilities.formatDate(new Date(), Session.getScriptTimeZone(), 'yyMM');
}

function nextCaseId_(sheet, headerRow, headerMap, offset) {
  return nextCaseIds_(sheet, headerRow, headerMap, 1, offset)[0];
}

function nextCaseIds_(sheet, headerRow, headerMap, count, offset) {
  return nextCaseIdsFromState_(caseIdState_(sheet, headerRow, headerMap), count, offset);
}

function caseIdState_(sheet, headerRow, headerMap) {
  const lastSheetRow = sheet.getLastRow();
  const idColumn = headerMap['案件編號'];
  const ids = lastSheetRow > headerRow
    ? sheet.getRange(headerRow + 1, idColumn, lastSheetRow - headerRow, 1).getValues().flat().map(String)
    : [];
  let lastCaseRow = headerRow;
  for (let index = ids.length - 1; index >= 0; index -= 1) {
    if (isCaseId_(ids[index])) {
      lastCaseRow = headerRow + 1 + index;
      break;
    }
  }
  return { ids, lastCaseRow };
}

function nextCaseIdsFromState_(state, count, offset) {
  const prefix = todayCaseIdPrefix_();
  const ids = state && state.ids || [];
  const maxSeq = ids
    .filter(id => id.indexOf(prefix) === 0 && /^\d{8}$/.test(id))
    .reduce((max, id) => Math.max(max, Number(id.slice(4)) || 0), 0);
  const start = maxSeq + 1 + (Number(offset) || 0);
  return Array.from({ length: Math.max(Number(count) || 0, 0) }, (_, index) => prefix + String(start + index).padStart(4, '0'));
}

function applyManagedCreateFields_(sheet, headerRow, headerMap, rows, caseState) {
  const list = rows || [];
  const ids = caseState
    ? nextCaseIdsFromState_(caseState, list.length, 0)
    : nextCaseIds_(sheet, headerRow, headerMap, list.length, 0);
  const submittedAt = Utilities.formatDate(new Date(), ADMIN_LOGIN_PASSWORD_TIMEZONE, 'yyyy/MM/dd HH:mm');
  list.forEach((row, index) => {
    row.id = ids[index];
    row.month = monthFromDate_(row.start);
    row.submittedAt = submittedAt;
  });
}

function rowsCacheKey_(year) {
  return 'designRows:' + (year ? String(year) : 'all');
}

function rawRowsCacheKey_(year) {
  return 'designRawRows:' + (year ? String(year) : 'all');
}

function recentRowsCacheKey_(limit) {
  return 'designRecentRows:' + (Number(limit) || 30);
}

function getCachedRows_(cacheKey) {
  try {
    const cached = CacheService.getScriptCache().get(cacheKey);
    return cached ? JSON.parse(cached) : null;
  } catch (error) {
    return null;
  }
}

function putCachedRows_(cacheKey, rows) {
  try {
    CacheService.getScriptCache().put(cacheKey, JSON.stringify(rows), CACHE_SECONDS);
  } catch (error) {
    // 快取容量不足時略過，讓讀取維持原本流程。
  }
}

function clearRowsCache_() {
  try {
    const cache = CacheService.getScriptCache();
    const currentYear = Utilities.formatDate(new Date(), Session.getScriptTimeZone(), 'yyyy');
    cache.remove(rowsCacheKey_());
    cache.remove(rawRowsCacheKey_());
    [30, 40, 120, 260, 320, 600].forEach(limit => cache.remove(recentRowsCacheKey_(limit)));
    for (let year = Number(currentYear) - 1; year <= Number(currentYear) + 1; year += 1) {
      cache.remove(rowsCacheKey_(year));
      cache.remove(rawRowsCacheKey_(year));
    }
  } catch (error) {
    // 清除快取失敗不阻擋表單寫入。
  }
}

function findRowNumber_(sheet, id, headerRow, headerMap) {
  const lastRow = lastCaseRow_(sheet, headerRow, headerMap);
  if (lastRow <= headerRow) return null;
  const idColumn = headerMap['案件編號'];
  const finder = sheet
    .getRange(headerRow + 1, idColumn, lastRow - headerRow, 1)
    .createTextFinder(String(id || '').trim())
    .matchEntireCell(true);
  const cell = finder.findNext();
  return cell ? cell.getRow() : null;
}

function resolveUpdateRowNumber_(sheet, id, row, headerRow, headerMap, options) {
  const requestedRow = Number(options && options.sheetRow);
  const idColumn = headerMap['案件編號'];
  if (requestedRow > headerRow && requestedRow <= sheet.getLastRow()) {
    const currentId = String(sheet.getRange(requestedRow, idColumn).getDisplayValue() || '').trim();
    if (currentId === String(id || '').trim()) return requestedRow;
  }
  const byId = findRowNumber_(sheet, id, headerRow, headerMap);
  return requestedRow > headerRow ? requestedRow : byId;
}

function rowLooksLikeMatch_(sheet, rowNumber, headerMap, match, strict) {
  if (!rowNumber || rowNumber > sheet.getLastRow()) return false;
  const requiredKeys = ['client', 'project'];
  const optionalKeys = ['start', 'end', 'designer', 'owner'];
  const expected = normalizeRow_(match || {});
  const hasExpected = requiredKeys.concat(optionalKeys).some(key => String(expected[key] || '').trim() !== '');
  if (!hasExpected) return false;

  const readColumnCount = Math.max(...Object.values(headerMap));
  const actual = valuesToObject_(sheet.getRange(rowNumber, 1, 1, readColumnCount).getDisplayValues()[0], headerMap, rowNumber);
  const equal = key => comparableValue_(actual[key]) === comparableValue_(expected[key]);

  if (strict) {
    return requiredKeys.every(key => !expected[key] || equal(key)) &&
      optionalKeys.filter(key => expected[key]).every(equal);
  }

  const requiredScore = requiredKeys.filter(key => expected[key] && equal(key)).length;
  const optionalScore = optionalKeys.filter(key => expected[key] && equal(key)).length;
  return requiredScore >= 1 && (requiredScore + optionalScore) >= 2;
}

function lastCaseRow_(sheet, headerRow, headerMap) {
  const lastRow = sheet.getLastRow();
  if (lastRow <= headerRow) return headerRow;
  const idColumn = headerMap['案件編號'];
  const ids = sheet.getRange(headerRow + 1, idColumn, lastRow - headerRow, 1).getValues().flat();
  for (let index = ids.length - 1; index >= 0; index -= 1) {
    if (isCaseId_(ids[index])) return headerRow + 1 + index;
  }
  return headerRow;
}

function lastCaseRowFromBottom_(sheet, headerRow, headerMap, maxScanRows) {
  const lastRow = sheet.getLastRow();
  if (lastRow <= headerRow) return headerRow;
  const idColumn = headerMap['案件編號'];
  const chunkSize = Math.max(60, Math.min(Number(maxScanRows) || 180, 500));
  let endRow = lastRow;
  while (endRow > headerRow) {
    const startRow = Math.max(headerRow + 1, endRow - chunkSize + 1);
    const ids = sheet.getRange(startRow, idColumn, endRow - startRow + 1, 1).getDisplayValues().flat();
    for (let index = ids.length - 1; index >= 0; index -= 1) {
      if (isCaseId_(ids[index])) return startRow + index;
    }
    endRow = startRow - 1;
    if (lastRow - endRow > Math.max(chunkSize * 3, 900)) break;
  }
  return lastCaseRow_(sheet, headerRow, headerMap);
}

function lastDataRowByAtoK_(sheet, headerRow) {
  const lastScanRow = Math.max(sheet.getLastRow(), headerRow);
  if (lastScanRow <= headerRow) return headerRow;

  const rows = sheet.getRange(headerRow + 1, 1, lastScanRow - headerRow, 11).getValues();

  for (let index = rows.length - 2; index >= 0; index -= 1) {
    if (rowHasAtoKValue_(rows[index]) && rowIsAtoKBlank_(rows[index + 1])) {
      return headerRow + 1 + index;
    }
  }

  for (let index = rows.length - 1; index >= 0; index -= 1) {
    if (rowHasAtoKValue_(rows[index])) {
      return headerRow + 1 + index;
    }
  }

  return headerRow;
}

function diagnose_() {
  const { sheet, headerRow, headerMap } = getSheetInfo_();
  const lastDataRow = lastDataRowByAtoK_(sheet, headerRow);
  const spreadsheet = sheet.getParent();
  const settingsSheet = getSettingsSheet_();
  const settingsHeaderMap = buildSettingsHeaderMap_(settingsSheet);
  const rotationColumn = settingsHeaderMap[USER_NEW_PROJECT_ROTATION_HEADER];
  const projectTargets = [newProjectConfigForDesigner_('Machi'), newProjectConfigForDesigner_('Karl')].map(config => {
    const projectSheet = getNewProjectSheet_(config);
    const projectHeaderMap = buildNewProjectHeaderMap_(projectSheet);
    return {
      kind: config.kind,
      sheetName: projectSheet.getName(),
      sheetId: projectSheet.getSheetId(),
      headers: NEW_PROJECT_HEADERS.map(header => ({ header, column: projectHeaderMap[header] })),
      nextRow: nextFlatProjectRow_(projectSheet, projectHeaderMap)
    };
  });
  const projectRotations = [newProjectConfigForDesigner_('Machi'), newProjectConfigForDesigner_('Karl')].map(config => ({
    kind: config.kind,
    designers: config.rotationDesigners.map(name => {
      const rowNumber = findEditorSettingsRow_(settingsSheet, settingsHeaderMap, name, false);
      return {
        name,
        rowNumber,
        rotation: rowNumber ? settingsSheet.getRange(rowNumber, rotationColumn).getDisplayValue() : ''
      };
    })
  }));

  return {
    ok: true,
    mode: 'list-append-and-sparse-update',
    version: SCRIPT_VERSION,
    targetSpreadsheetId: SPREADSHEET_ID,
    targetSheetName: SHEET_NAME,
    targetSheetId: TARGET_SHEET_ID,
    spreadsheetName: spreadsheet.getName(),
    sheetName: sheet.getName(),
    sheetId: sheet.getSheetId(),
    headerRow,
    caseCount: countCaseIds_(sheet),
    lastCaseRow: lastCaseRow_(sheet, headerRow, headerMap),
    nextAppendRowByCK: firstBlankFormRow_(sheet, headerRow, headerMap),
    lastDataRowByAtoK: lastDataRow,
    newProjectTargets: projectTargets,
    newProjectRotations: projectRotations,
    sheetCandidates: spreadsheet.getSheets().map(candidate => ({
      name: candidate.getName(),
      sheetId: candidate.getSheetId(),
      headerRow: findHeaderRow_(candidate, true),
      caseCount: countCaseIds_(candidate)
    })),
    note: '此版本供網頁讀取資料；新增寫入 C-K 第一個空白列，表單編輯只寫 C-K，案件列表可直接覆蓋 L 狀態與 M 項目細節。'
  };
}

function detailOptions_() {
  const spreadsheet = SpreadsheetApp.openById(SPREADSHEET_ID);
  const sheet = DETAIL_SHEET_NAMES
    .map(name => spreadsheet.getSheetByName(name))
    .find(Boolean);

  if (!sheet) {
    return {
      ok: true,
      action: 'detailOptions',
      rows: [],
      spreadsheetId: SPREADSHEET_ID,
      sheetName: ''
    };
  }

  return {
    ok: true,
    action: 'detailOptions',
    rows: sheet.getDataRange().getDisplayValues(),
    spreadsheetId: SPREADSHEET_ID,
    sheetName: sheet.getName()
  };
}

function rowHasAtoKValue_(row) {
  return row.some(value => String(value).trim() !== '');
}

function rowIsAtoKBlank_(row) {
  return row.every(value => String(value).trim() === '');
}

function countCaseIds_(sheet) {
  const lastRow = sheet.getLastRow();
  if (lastRow < 1) return 0;
  return sheet
    .getRange(1, 1, lastRow, 1)
    .getValues()
    .flat()
    .filter(isCaseId_)
    .length;
}

function valuesToObject_(values, headerMap, rowNumber) {
  const row = {};
  HEADERS.forEach((header, index) => {
    row[headerToKey_(header)] = formatValue_(values[headerMap[header] - 1]);
  });
  if (rowNumber) {
    row.sheetRow = rowNumber;
    row._sheetRow = rowNumber;
  }
  return row;
}

function rowResponse_(row, rowNumber) {
  const response = Object.assign({}, row || {});
  if (rowNumber) {
    response.sheetRow = rowNumber;
    response._sheetRow = rowNumber;
  }
  return response;
}

function rowObjectAt_(sheet, rowNumber, headerMap) {
  const width = Math.max(...Object.values(headerMap));
  const values = sheet.getRange(rowNumber, 1, 1, width).getDisplayValues()[0];
  return valuesToObject_(values, headerMap, rowNumber);
}

function rowYear_(row) {
  const date = new Date(row.start || row.end);
  if (Number.isNaN(date.getTime())) return '';
  const year = date.getFullYear();
  return year >= 1900 && year <= 2100 ? String(year) : '';
}

function rawRowYear_(row) {
  const date = new Date(row['開始日期'] || row['結束日期']);
  if (Number.isNaN(date.getTime())) return '';
  const year = date.getFullYear();
  return year >= 1900 && year <= 2100 ? String(year) : '';
}

function parseJson_(text, fallback) {
  try {
    return text ? JSON.parse(text) : fallback;
  } catch (error) {
    return fallback;
  }
}

function comparableValue_(value) {
  const text = String(value == null ? '' : value).trim();
  const dateMatch = text.match(/(19\d{2}|20\d{2}|2100)[/-](\d{1,2})[/-](\d{1,2})/);
  if (dateMatch) {
    return `${dateMatch[1]}-${String(dateMatch[2]).padStart(2, '0')}-${String(dateMatch[3]).padStart(2, '0')}`;
  }
  return text.replace(/\s+/g, ' ');
}

function writeObjectToRow_(sheet, rowNumber, headerMap, row, options) {
  const forceHeaders = normalizeWriteHeaders_((options && options.forceHeaders) || []);
  const hasWriteHeaders = options && Object.prototype.hasOwnProperty.call(options, 'writeHeaders') && Boolean((options.writeHeaders || []).length);
  const writeHeaders = normalizeWriteHeaders_(options && options.writeHeaders);
  const headersToWrite = hasWriteHeaders ? HEADERS.filter(header => writeHeaders.indexOf(header) >= 0) : HEADERS;
  headersToWrite.forEach(header => {
    const range = sheet.getRange(rowNumber, headerMap[header]);
    if (shouldPreserveCell_(range, header, forceHeaders)) return;
    range.setValue(cellValue_(row[headerToKey_(header)]));
  });
}

function writeNewObjectToRow_(sheet, rowNumber, headerMap, row, options) {
  const writeHeaders = normalizeWriteHeaders_(options && options.writeHeaders);
  const columns = HEADERS
    .filter(header => writeHeaders.indexOf(header) >= 0)
    .map(header => ({ header, column: headerMap[header] }))
    .filter(item => item.column)
    .sort((a, b) => a.column - b.column);
  if (!columns.length) throw new Error('找不到可寫入的欄位');

  const groups = [];
  columns.forEach(item => {
    const group = groups[groups.length - 1];
    if (!group || item.column !== group[group.length - 1].column + 1) groups.push([item]);
    else group.push(item);
  });
  groups.forEach(group => {
    const values = group.map(item => cellValue_(row[headerToKey_(item.header)]));
    sheet.getRange(rowNumber, group[0].column, 1, group.length).setValues([values]);
  });
}

function createRequestCacheKey_(requestId) {
  const normalized = String(requestId || '').trim();
  if (!normalized || normalized.length > 120 || !/^[A-Za-z0-9._:-]+$/.test(normalized)) return '';
  return 'createRequest:' + normalized;
}

function cachedCreateResult_(requestId) {
  const key = createRequestCacheKey_(requestId);
  if (!key) return null;
  try {
    return parseJson_(CacheService.getScriptCache().get(key), null);
  } catch (error) {
    return null;
  }
}

function cacheCreateResult_(requestId, result) {
  const key = createRequestCacheKey_(requestId);
  if (!key) return;
  try {
    CacheService.getScriptCache().put(key, JSON.stringify(result), CREATE_REQUEST_CACHE_SECONDS);
  } catch (error) {
    // 冪等請求快取寫入失敗不影響案件建立。
  }
}

function cellValue_(value) {
  return value == null ? '' : value;
}

function detailItems_(details) {
  return String(details || '')
    .split(/[,，]/)
    .map(item => item.trim())
    .filter(Boolean);
}

function normalizedWeightKey_(value) {
  return String(value || '').trim().replace(/\s+/g, ' ');
}

function isUrgentDetail_(value) {
  return normalizedWeightKey_(value) === '急件';
}

function numberValue_(value) {
  const text = String(value == null ? '' : value).replace(/,/g, '').trim();
  if (!text) return 0;
  const number = Number(text);
  return Number.isFinite(number) ? number : 0;
}

function weightMap_() {
  const values = readSheetValuesById_(WEIGHTS_SHEET_ID);
  const map = {};
  values.forEach(row => {
    const item = normalizedWeightKey_(row[2]);
    if (!item) return;
    const score = numberValue_(row[3]);
    map[item] = score;
  });
  return map;
}

// database 的加權分數以 JSON 的「加權計分標準」為主。管理者透過後台編輯
// 權重規則後，這裡會在同一次交易內重算所有 database 案件的「加權」，
// 不依賴上面 weightMap_()（試算表，僅供舊的 Sheet-primary 路徑相容使用，
// 目前的動作路由器不會呼叫到它）。
function weightMapFromJsonRows_(rows) {
  const map = {};
  (rows || []).forEach(row => {
    const item = normalizedWeightKey_(row['項目細節']);
    if (!item) return;
    map[item] = numberValue_(row['權重']);
  });
  return map;
}
function recalculateDatabaseWeights_(database) {
  const table = database && database.tables && database.tables.database;
  if (!table || !Array.isArray(table.rows)) return 0;
  const weightsTable = database.tables['加權計分標準'];
  const weights = weightMapFromJsonRows_(weightsTable && weightsTable.rows);
  table.rows.forEach(row => {
    if (!detailItems_(row['項目細節']).length) return;
    row['加權'] = String(calculateWeight_(row['項目細節'], row['數量'], weights));
  });
  return table.rows.length;
}

function calculateWeight_(details, qty, weights) {
  const items = detailItems_(details);
  if (!items.length) return '';
  const map = weights || weightMap_();
  const urgentMultiplier = items.some(isUrgentDetail_) ? (map[normalizedWeightKey_('急件')] || 1) : 1;
  const sum = items
    .filter(item => !isUrgentDetail_(item))
    .reduce((total, item) => total + (map[normalizedWeightKey_(item)] || 0), 0);
  return sum * (numberValue_(qty) || 0) * urgentMultiplier;
}

function applyManagedCalculatedFields_(row, existing, weights) {
  const merged = Object.assign({}, existing || {}, row || {});
  row.weight = calculateWeight_(merged.details, merged.qty, weights);
  return row;
}

function hasAnyKey_(source, keys) {
  source = source || {};
  return keys.some(key => Object.prototype.hasOwnProperty.call(source, key));
}

function fillMissingCalculatedInputs_(row, source, existing) {
  if (!existing) return row;
  if (!hasAnyKey_(source, ['qty', '數量'])) row.qty = existing.qty;
  if (!hasAnyKey_(source, ['details', '項目細節', '項目細項'])) row.details = existing.details;
  return row;
}

function normalizeWriteHeaders_(headers) {
  if (!headers || !headers.length) return [];
  return headers
    .map(canonicalHeader_)
    .filter(header => HEADERS.indexOf(header) >= 0);
}

function normalizeFormWriteHeaders_(headers) {
  const normalized = normalizeWriteHeaders_(headers)
    .filter(header => FORM_WRITE_HEADERS.indexOf(header) >= 0);
  return normalized.length ? normalized : FORM_WRITE_HEADERS;
}

function normalizeAppendWriteHeaders_(headers) {
  const allowedHeaders = FORMULA_MANAGED_HEADERS.concat(FORM_WRITE_HEADERS, CALCULATED_MANAGED_HEADERS);
  const normalized = normalizeWriteHeaders_(headers)
    .filter(header => allowedHeaders.indexOf(header) >= 0);
  return normalized.length ? normalized : allowedHeaders;
}

function withManagedAppendHeaders_(options) {
  const base = options || {};
  const managedHeaders = FORMULA_MANAGED_HEADERS.concat(CALCULATED_MANAGED_HEADERS);
  const writeHeaders = normalizeAppendWriteHeaders_((base.writeHeaders || FORM_WRITE_HEADERS).concat(managedHeaders));
  const forceHeaders = normalizeAppendWriteHeaders_((base.forceHeaders || writeHeaders).concat(managedHeaders));
  return Object.assign({}, base, { writeHeaders, forceHeaders });
}

function withManagedMonthUpdate_(row, options) {
  const base = options || {};
  const writeHeaders = normalizeUpdateWriteHeaders_(base.writeHeaders || []);
  const forceHeaders = normalizeUpdateForceHeaders_(base.forceHeaders || []);
  if (writeHeaders.indexOf('開始日期') < 0 || !row.start) return base;
  row.month = monthFromDate_(row.start);
  return Object.assign({}, base, {
    writeHeaders: writeHeaders.indexOf('月份') >= 0 ? writeHeaders : writeHeaders.concat('月份'),
    forceHeaders: forceHeaders.indexOf('月份') >= 0 ? forceHeaders : forceHeaders.concat('月份')
  });
}

function withManagedCalculatedUpdate_(row, options, existing, weights) {
  const base = options || {};
  const writeHeaders = normalizeUpdateWriteHeaders_(base.writeHeaders || []);
  const forceHeaders = normalizeUpdateForceHeaders_(base.forceHeaders || []);
  if (!updateTouchesCalculated_(writeHeaders, forceHeaders)) return base;
  applyManagedCalculatedFields_(row, existing, weights);
  return Object.assign({}, base, {
    writeHeaders: writeHeaders.indexOf('加權') >= 0 ? writeHeaders : writeHeaders.concat('加權'),
    forceHeaders: forceHeaders.indexOf('加權') >= 0 ? forceHeaders : forceHeaders.concat('加權')
  });
}

function updateTouchesCalculated_(writeHeaders, forceHeaders) {
  const headers = normalizeWriteHeaders_([].concat(writeHeaders || [], forceHeaders || []));
  return headers.indexOf('項目細節') >= 0 || headers.indexOf('數量') >= 0;
}

function canonicalHeader_(header) {
  const text = String(header || '').trim();
  if (HEADERS.indexOf(text) >= 0) return text;
  const canonical = HEADERS.find(candidate => (HEADER_ALIASES[candidate] || []).indexOf(text) >= 0);
  return canonical || text;
}

function shouldPreserveCell_(range, header, forceHeaders) {
  if ((forceHeaders || []).indexOf(header) >= 0) return false;
  return FORMULA_MANAGED_HEADERS.indexOf(header) >= 0 || (header !== '項目細節' && Boolean(range.getFormula()));
}

function isCaseId_(value) {
  return /^\d{8}$/.test(String(value).trim());
}

function normalizeRow_(row) {
  const normalized = {};
  Object.keys(KEY_TO_HEADER).forEach(key => {
    const header = KEY_TO_HEADER[key];
    const aliasValue = (HEADER_ALIASES[header] || []).map(alias => row[alias]).find(value => value !== undefined && value !== '');
    normalized[key] = formatValue_(row[key] ?? row[header] ?? aliasValue ?? '');
  });
  normalized.qty = Number(normalized.qty || 1);
  return normalized;
}

function headerToKey_(header) {
  return Object.keys(KEY_TO_HEADER).find(key => KEY_TO_HEADER[key] === header);
}

function formatValue_(value) {
  if (value instanceof Date) {
    return Utilities.formatDate(value, Session.getScriptTimeZone(), 'yyyy-MM-dd');
  }
  return value == null ? '' : value;
}

function truthy_(value) {
  const text = String(value || '').trim().toLowerCase();
  return value === true || text === 'true' || text === '1' || text === 'yes' || text === 'on';
}

function monthFromDate_(dateText) {
  const text = String(dateText || '').trim();
  const match = text.match(/(19\d{2}|20\d{2}|2100)[/-](\d{1,2})[/-](\d{1,2})/);
  const date = match ? new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3])) : new Date(text);
  if (Number.isNaN(date.getTime())) return '';
  return `${date.getMonth() + 1}月`;
}

function jsonResponse(payload, callback) {
  if (callback) {
    return ContentService
      .createTextOutput(`${callback}(${JSON.stringify(payload)})`)
      .setMimeType(ContentService.MimeType.JAVASCRIPT);
  }

  return ContentService
    .createTextOutput(JSON.stringify(payload))
    .setMimeType(ContentService.MimeType.JSON);
}

function frameResponse_(payload, callbackId) {
  const message = {
    type: 'design-request-sheet-response',
    callbackId: String(callbackId || ''),
    payload
  };
  return HtmlService.createHtmlOutput(
    '<!doctype html><meta charset="utf-8"><script>' +
    'try{parent.postMessage(' + JSON.stringify(message) + ',"*");}catch(error){}' +
    'try{window.top.postMessage(' + JSON.stringify(message) + ',"*");}catch(error){}' +
    '</script>'
  ).setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL);
}

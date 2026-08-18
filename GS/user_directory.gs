/**
 * JSON 使用者名錄。
 *
 * Apps Script 登入端只從 GitHub JSON「設定」讀取姓名、部門、組別與帳號，
 * 不再依賴試算表或這個檔案內的硬編碼名單。
 */
const USER_DIRECTORY_JSON_URL =
  'https://raw.githubusercontent.com/EMCtaipeiART/EMCtaipeiART.github.io/main/backend/data/db.json';
const USER_DIRECTORY_JSON_CACHE_KEY = 'json-user-directory-v2';
const USER_DIRECTORY_JSON_CACHE_SECONDS = 60;

function readJsonUserDirectory_() {
  const cache = CacheService.getScriptCache();
  const cached = cache.get(USER_DIRECTORY_JSON_CACHE_KEY);
  if (cached) {
    try { return JSON.parse(cached); } catch (error) {}
  }
  const response = UrlFetchApp.fetch(USER_DIRECTORY_JSON_URL + '?v=' + Date.now(), {
    method: 'get',
    muteHttpExceptions: true,
    followRedirects: true,
    headers: { Accept: 'application/json' }
  });
  if (response.getResponseCode() < 200 || response.getResponseCode() >= 300) {
    throw new Error('JSON 使用者名錄讀取失敗：HTTP ' + response.getResponseCode());
  }
  const database = JSON.parse(response.getContentText());
  const rows = database && database.tables && database.tables['設定'] && database.tables['設定'].rows;
  if (!Array.isArray(rows)) throw new Error('JSON 使用者名錄格式錯誤');
  const records = rows.map(function(row) {
    return {
      name: String(row['名字'] || row['顯示名'] || '').trim(),
      department: String(row['部門'] || '').trim(),
      group: String(row['組別'] || '').trim(),
      account: String(row['帳號'] || '').trim().toLowerCase()
    };
  }).filter(function(record) { return record.account; });
  cache.put(USER_DIRECTORY_JSON_CACHE_KEY, JSON.stringify(records), USER_DIRECTORY_JSON_CACHE_SECONDS);
  return records;
}

const USER_DIRECTORY = readJsonUserDirectory_();

/**
 * 資料庫後台新增資料列；直接提交至 GitHub JSON，不寫試算表。
 * database 有自己專屬的「填寫設計需求」新增流程，不走這裡。
 * 設定表額外要求帳號／名字／部門，並在成功後清除使用者名錄快取；
 * 其餘表（加權計分標準、短連結、補充資料連結、修改統計表、reels、bug_report）
 * 只依主鍵做基本檢查。
 */
function adminTableInsert_(payload) {
  assertDatabaseAdmin_(payload);
  const tableName = String(payload && payload.table || '').trim();
  if (tableName === 'database') throw new Error('請使用「填寫設計需求」表單新增案件');
  const config = adminTableConfig_(tableName).config;
  return mutateGithubJsonDatabase_('admin insert ' + tableName, payload, function(database) {
    const table = githubJsonTable_(database, tableName);
    const patch = payload && payload.row && typeof payload.row === 'object' ? payload.row : {};
    const row = {};
    table.headers.forEach(function(header) {
      row[header] = Object.prototype.hasOwnProperty.call(patch, header) && patch[header] != null
        ? String(patch[header]).trim()
        : '';
    });
    if (tableName === '設定') {
      const account = String(row[config.primaryKey] || '').trim().toLowerCase();
      if (!account) throw new Error('「帳號」不可空白');
      if (table.rows.some(function(item) { return String(item[config.primaryKey] || '').trim().toLowerCase() === account; })) {
        throw new Error('「帳號」已經存在');
      }
      row[config.primaryKey] = account;
      if (!String(row['名字'] || '').trim()) throw new Error('「名字」不可空白');
      if (!String(row['部門'] || '').trim()) throw new Error('「部門」不可空白');
      if (!String(row['顯示名'] || '').trim()) row['顯示名'] = row['名字'];
    } else if (config.primaryKey) {
      const keyValue = String(row[config.primaryKey] || '').trim();
      if (!keyValue) throw new Error('「' + config.primaryKey + '」不可空白');
      if (table.rows.some(function(item) { return String(item[config.primaryKey] || '').trim() === keyValue; })) {
        throw new Error('「' + config.primaryKey + '」已經存在');
      }
    }
    table.rows.push(row);
    if (tableName === '設定') CacheService.getScriptCache().remove(USER_DIRECTORY_JSON_CACHE_KEY);
    const changedTables = [tableName];
    if (tableName === '加權計分標準' && recalculateDatabaseWeights_(database)) changedTables.push('database');
    return {
      changed: true,
      changedTables: changedTables,
      result: { ok: true, action: 'adminTableInsert', table: tableName, rowNumber: table.rows.length + 1, row: row }
    };
  });
}

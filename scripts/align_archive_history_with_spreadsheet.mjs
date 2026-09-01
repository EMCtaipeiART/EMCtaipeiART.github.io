import { readFile, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseCsv } from '../backend/import_google_sheets.mjs';

// 一次性資料校正腳本：把 data/database_archive.json 裡 2024-2025 年缺漏的
// 「案件編號」，依雲端試算表「database_archive」分頁（gid=646199020，公司內部
// 一直保留的舊案件流水帳，跟現在即時系統在用的「database」分頁 gid=1244538986
// 是兩個不同分頁）補齊，並把 2025 年以前的「加權」補上等於「數量」的值——
// 這是 2025 年以前這個系統唯一使用過的加權計算方式，2025 年（含）以後留給
// 之後另外處理，這次刻意不動。
//
// 對齊依據：比對過 data/database_archive.json 開頭那一段（非 26 開頭案件編號
// 的歷史列）跟這個試算表分頁，兩邊在案件數量、順序完全一致（同一批 12 個欄位
// 逐列比對，80000+ 次比對裡只有 246 次差異，且全部都是「我方是空白、試算表
// 有值」這種良性缺漏，沒有任何一筆是兩邊都有值但內容衝突），確認可以用「同一
// 個位置＝同一筆歷史紀錄」直接對齊；已經有案件編號的 2436 筆也逐一驗證過跟
// 試算表同一位置的案件編號完全相同，這次只是把原本沒對到的欄位補齊，不會覆蓋
// 掉任何已經正確的既有資料。2026 年之後（案件編號 26 開頭）的即時同步紀錄
// 完全不在這次校正範圍內，不會被這支腳本觸碰。

const SCRIPT_DIR = dirname(fileURLToPath(import.meta.url));
const ARCHIVE_PATH = resolve(SCRIPT_DIR, '../data/database_archive.json');
const SPREADSHEET_ID = '1cHxWBed715H0XufNhMOOk3hcZPTSpq5rA64-b5m8vWY';
const HISTORY_SHEET_GID = '646199020';
const HISTORY_SHEET_URL = `https://docs.google.com/spreadsheets/d/${SPREADSHEET_ID}/export?format=csv&gid=${HISTORY_SHEET_GID}`;
const WEIGHT_CUTOFF_YEAR = 2025;
const KEY_FIELDS = ['客戶別', '專案名稱', '設計種類', '開始日期', '結束日期', '設計負責人'];

const hash = value => createHash('sha256').update(JSON.stringify(value)).digest('hex');
const text = value => String(value ?? '').trim();
const normalize = value => text(value).normalize('NFKC');
const startYear = row => {
  const match = /^(\d{4})\//.exec(text(row['開始日期']));
  return match ? Number(match[1]) : null;
};

async function fetchHistorySheetRows() {
  const response = await fetch(HISTORY_SHEET_URL, { redirect: 'follow', headers: { 'User-Agent': 'Machi-Archive-Alignment/1.0' } });
  if (!response.ok) throw new Error(`歷史資料試算表下載失敗：HTTP ${response.status}`);
  const matrix = parseCsv(await response.text());
  const headers = (matrix.shift() || []).map(text);
  return matrix
    .filter(values => values.some(value => text(value)))
    .map(values => Object.fromEntries(headers.map((header, index) => [header, values[index] ?? '']).filter(([header]) => header)));
}

const archive = JSON.parse(await readFile(ARCHIVE_PATH, 'utf8'));
if (!Array.isArray(archive.rows)) throw new Error('data/database_archive.json 缺少 rows 陣列');

const sourceRows = await fetchHistorySheetRows();
if (!sourceRows.length) throw new Error('試算表「database_archive」分頁沒有讀到任何資料列');

// 這份歷史流水帳只到 2026 年即時系統上線前為止；2026 年（含）之後的案件是由
// scripts/generate_database_archive_snapshot.mjs 從 backend/data/db.json 自動
// 同步進來、接在歷史列後面，不屬於這支腳本要校正的範圍。用「案件編號開頭是不
// 是 26」分別找出雙方歷史列的長度，兩邊必須一致，才能安全地逐列對齊。
const archiveHistoryCount = (() => {
  const index = archive.rows.findIndex(row => text(row['案件編號']).startsWith('26'));
  return index === -1 ? archive.rows.length : index;
})();
const sourceHistoryCount = (() => {
  const index = sourceRows.findIndex(row => text(row['案件編號']).startsWith('26'));
  return index === -1 ? sourceRows.length : index;
})();
if (archiveHistoryCount !== sourceHistoryCount) {
  throw new Error(`歷史列數量對不上（archive: ${archiveHistoryCount}，試算表: ${sourceHistoryCount}），可能是兩邊已經不同步，請先人工確認再執行。`);
}

let filledCaseIds = 0, filledWeights = 0;
const conflicts = [];

for (let index = 0; index < archiveHistoryCount; index += 1) {
  const archiveRow = archive.rows[index];
  const sourceRow = sourceRows[index];
  for (const field of KEY_FIELDS) {
    const archiveValue = normalize(archiveRow[field]);
    const sourceValue = normalize(sourceRow[field]);
    if (archiveValue && sourceValue && archiveValue !== sourceValue) {
      conflicts.push({ index, field, archiveValue, sourceValue, archiveCaseId: text(archiveRow['案件編號']), sourceCaseId: text(sourceRow['案件編號']) });
    }
  }
}
if (conflicts.length) {
  console.error(JSON.stringify({ ok: false, reason: 'archive 與試算表在同一個位置的內容互相衝突，已停止寫入', conflicts: conflicts.slice(0, 20), conflictCount: conflicts.length }, null, 2));
  process.exit(1);
}

for (let index = 0; index < archiveHistoryCount; index += 1) {
  const archiveRow = archive.rows[index];
  const sourceRow = sourceRows[index];
  const sourceCaseId = text(sourceRow['案件編號']);
  if (sourceCaseId && text(archiveRow['案件編號']) !== sourceCaseId) {
    archiveRow['案件編號'] = sourceCaseId;
    filledCaseIds += 1;
  }
  const year = startYear(archiveRow);
  if (year !== null && year < WEIGHT_CUTOFF_YEAR) {
    const quantity = text(archiveRow['數量']);
    if (text(archiveRow['加權']) !== quantity) {
      archiveRow['加權'] = quantity;
      filledWeights += 1;
    }
  }
}

if (!filledCaseIds && !filledWeights) {
  console.log(JSON.stringify({ ok: true, filledCaseIds, filledWeights, written: false }, null, 2));
  process.exit(0);
}

archive.rowCount = archive.rows.length;
archive.rowsSha256 = hash(archive.rows);
await writeFile(ARCHIVE_PATH, `${JSON.stringify(archive)}\n`, 'utf8');
console.log(JSON.stringify({ ok: true, historyRowCount: archiveHistoryCount, filledCaseIds, filledWeights, written: true }, null, 2));

import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { applyWeightToRow } from '../backend/weighting.mjs';

const SCRIPT_DIR = dirname(fileURLToPath(import.meta.url));
const OUTPUT_PATH = process.env.ARCHIVE_OUTPUT_PATH ? resolve(process.env.ARCHIVE_OUTPUT_PATH) : resolve(SCRIPT_DIR, '../data/database_archive.json');
const PRIMARY_DATABASE_PATH = process.env.PRIMARY_DATABASE_PATH ? resolve(process.env.PRIMARY_DATABASE_PATH) : resolve(SCRIPT_DIR, '../backend/data/db.json');
const ARCHIVE_BASE_PATH = process.env.ARCHIVE_BASE_PATH ? resolve(process.env.ARCHIVE_BASE_PATH) : OUTPUT_PATH;

const clone = value => JSON.parse(JSON.stringify(value));
const hash = value => createHash('sha256').update(JSON.stringify(value)).digest('hex');
const text = value => String(value ?? '').trim();

function caseId(row = {}) {
  return text(row['案件編號'] ?? row.id);
}

function comparableRow(row = {}) {
  return {
    id: caseId(row), month: text(row['月份']), client: text(row['客戶別']),
    project: text(row['專案名稱']), owner: text(row['專案負責人']),
    type: text(row['設計種類'] ?? row['設計類型'] ?? row['設計總類']),
    stage: text(row['階段']), qty: text(row['數量']), start: text(row['開始日期']),
    end: text(row['結束日期']), designer: text(row['設計負責人']),
    details: text(row['項目細節']), status: text(row['狀態'] ?? row['案件狀態']),
    weight: text(row['加權'])
  };
}

async function readJson(path, fallback) {
  try { return JSON.parse(await readFile(path, 'utf8')); }
  catch (error) { if (error?.code === 'ENOENT') return fallback; throw error; }
}

function indexRowsByOccurrence(rows) {
  const occurrences = new Map(), indexes = new Map();
  rows.forEach((row, index) => {
    const id = caseId(row);
    if (!id) return;
    const occurrence = occurrences.get(id) || 0;
    occurrences.set(id, occurrence + 1);
    indexes.set(`${id}#${occurrence + 1}`, index);
  });
  return indexes;
}

function rowKeysByOccurrence(rows) {
  const occurrences = new Map(), keys = [];
  rows.forEach(row => {
    const id = caseId(row);
    if (!id) return;
    const occurrence = (occurrences.get(id) || 0) + 1;
    occurrences.set(id, occurrence);
    keys.push(`${id}#${occurrence}`);
  });
  return keys;
}

function removeDeletedCurrentRows(previousRows, previousCurrentKeys, currentKeySet, explicitRemovedIds = new Set()) {
  if (!previousCurrentKeys.size && !explicitRemovedIds.size) return { rows: clone(previousRows), removedCaseIds: [] };
  const occurrences = new Map(), rows = [], removedCaseIds = [];
  previousRows.forEach(row => {
    const id = caseId(row);
    if (!id) { rows.push(clone(row)); return; }
    const occurrence = (occurrences.get(id) || 0) + 1;
    occurrences.set(id, occurrence);
    const key = `${id}#${occurrence}`;
    if (explicitRemovedIds.has(id) || (previousCurrentKeys.has(key) && !currentKeySet.has(key))) {
      removedCaseIds.push(occurrence === 1 ? id : key);
      return;
    }
    rows.push(clone(row));
  });
  return { rows, removedCaseIds };
}

const database = await readJson(PRIMARY_DATABASE_PATH, null);
const databaseTable = database?.tables?.database;
if (!databaseTable || !Array.isArray(databaseTable.rows)) throw new Error('backend/data/db.json is missing tables.database.rows');
const settingsRows = Array.isArray(database?.tables?.['設定']?.rows) ? database.tables['設定'].rows : [];
const modificationRows = Array.isArray(database?.tables?.['修改統計表']?.rows) ? database.tables['修改統計表'].rows : [];
const previousSnapshot = await readJson(ARCHIVE_BASE_PATH, { rows: [], columns: [] });
const previousRows = Array.isArray(previousSnapshot) ? previousSnapshot : (Array.isArray(previousSnapshot.rows) ? previousSnapshot.rows : []);
const currentDatabaseRowKeys = rowKeysByOccurrence(databaseTable.rows);
const previousCurrentKeys = new Set(Array.isArray(previousSnapshot?.currentDatabaseRowKeys) ? previousSnapshot.currentDatabaseRowKeys : []);
const explicitRemovedIds = new Set(String(process.env.ARCHIVE_DELETE_CASE_IDS || '').split(',').map(text).filter(Boolean));
const deletionSync = removeDeletedCurrentRows(previousRows, previousCurrentKeys, new Set(currentDatabaseRowKeys), explicitRemovedIds);
const rows = deletionSync.rows, archiveIndex = indexRowsByOccurrence(rows), databaseOccurrences = new Map();
const addedCaseIds = [], updatedCaseIds = [], unchangedCaseIds = [];
const weightRules = database?.tables?.['加權計分標準']?.rows || [];
let recalculatedArchiveRows = 0;

for (const [sourceIndex, sourceRow] of databaseTable.rows.entries()) {
  const currentRow = clone(sourceRow);
  const weightBefore = text(currentRow['加權']);
  applyWeightToRow(currentRow, weightRules.length ? weightRules : undefined);
  if (weightBefore !== text(currentRow['加權'])) recalculatedArchiveRows += 1;
  const id = caseId(currentRow), occurrence = id ? (databaseOccurrences.get(id) || 0) : 0;
  if (id) databaseOccurrences.set(id, occurrence + 1);
  const identity = id ? `${id}#${occurrence + 1}` : `__row__#${sourceIndex + 1}`;
  const label = id ? `${id}${occurrence ? `#${occurrence + 1}` : ''}` : `row:${sourceIndex + 1}`;
  const index = archiveIndex.get(identity);
  if (index === undefined) {
    rows.push(currentRow);
    archiveIndex.set(identity, rows.length - 1);
    addedCaseIds.push(label);
    continue;
  }
  const archiveRow = rows[index], mergedRow = { ...archiveRow, ...currentRow };
  const changed = JSON.stringify(archiveRow) !== JSON.stringify(mergedRow);
  rows[index] = mergedRow;
  (changed ? updatedCaseIds : unchangedCaseIds).push(label);
}

const removedCaseIds = deletionSync.removedCaseIds;
// 儀表板用的資料。修改紀錄除了現行資料庫裡的，還要保留「已搬進歷史、不在現行資料庫」的案件的紀錄：
// 這些案件的修改紀錄搬走之後主資料庫就沒有了，只留在上一份歷史資料庫裡，所以從上一份沿用。
// 只沿用「歷史資料庫還留著那筆案件」的紀錄——案件被刪掉的話（deletionSync 已經從 rows 拿掉），它的紀錄也跟著消失。
const currentCaseIds = new Set(databaseTable.rows.map(caseId).filter(Boolean));
const currentModificationCaseIds = new Set(modificationRows.map(caseId).filter(Boolean));
const archivedCaseIds = new Set(rows.map(caseId).filter(Boolean));
const previousModifications = Array.isArray(previousSnapshot?.dashboardData?.modifications) ? previousSnapshot.dashboardData.modifications : [];
const preservedModifications = previousModifications.filter(row => {
  const id = caseId(row);
  return id && archivedCaseIds.has(id) && !currentCaseIds.has(id) && !currentModificationCaseIds.has(id);
});
const dashboardData = {
  settings: settingsRows.map(row => ({
    '名字': text(row['名字']),
    '顯示名': text(row['顯示名']),
    '頭像連結': text(row['頭像連結'])
  })),
  modifications: [...clone(modificationRows), ...clone(preservedModifications)]
};
const columns = [...new Set([...(Array.isArray(previousSnapshot?.columns) ? previousSnapshot.columns : []), ...(Array.isArray(databaseTable.headers) ? databaseTable.headers : []), ...rows.flatMap(row => Object.keys(row))].filter(Boolean))];
const rowsSha256 = hash(rows), sourceRowsSha256 = hash(databaseTable.rows), dashboardDataSha256 = hash(dashboardData);
// 只看案件資料本身有沒有變。主資料庫的版本號每寫一次就加一（個人設定、修改紀錄、客戶別都會加），以前把
// 版本號不同也算成「有變」，於是每一筆寫入都重新產生一次歷史資料庫、多一次提交與網站重新部署。
const sourceChanged = previousSnapshot?.sources?.primaryDatabase?.rowsSha256 !== sourceRowsSha256;
const rowsChanged = previousSnapshot?.rowsSha256 !== rowsSha256;
const columnsChanged = JSON.stringify(previousSnapshot?.columns || []) !== JSON.stringify(columns);
const dashboardDataChanged = previousSnapshot?.dashboardDataSha256 !== dashboardDataSha256;
// 首頁頭像框的等級：只要每位設計師的累積分數，不必為了它下載整份 4 MB 的歷史快照。
// 算法跟前台、像素辦公室相同（2023 年起、已完成案件的加權，沒加權用數量，再沒有算 1）。
const levelYear = row => {
  for (const key of ['開始日期', '結束日期', '填單時間', '時間標記']) { const match = String(row[key] || '').match(/(20\d{2})/); if (match) return Number(match[1]); }
  const match = String(row['案件編號'] || '').match(/^(\d{2})/); return match ? 2000 + Number(match[1]) : 0;
};
const levelNumber = value => { const text = String(value ?? '').trim().replace(/,/g, ''); if (!text) return null; const number = Number(text); return Number.isFinite(number) ? number : null; };
const levelScores = {};
for (const row of rows) {
  const name = String(row['設計負責人'] || '').trim().toLowerCase();
  if (!name || String(row['狀態'] || '').trim() !== '已完成' || levelYear(row) < 2023) continue;
  const weight = levelNumber(row['加權']), quantity = levelNumber(row['數量']);
  levelScores[name] = (levelScores[name] || 0) + (weight !== null ? weight : quantity !== null ? quantity : 1);
}
const levelsJson = `${JSON.stringify({ version: 1, scores: Object.fromEntries(Object.entries(levelScores).sort(([a], [b]) => a.localeCompare(b)).map(([k, v]) => [k, Math.round(v * 1000) / 1000])) })}\n`;
const levelsPath = resolve(dirname(OUTPUT_PATH), 'designer_levels.json');
let previousLevels = ''; try { previousLevels = await readFile(levelsPath, 'utf8'); } catch { /* 第一次產生 */ }
if (previousLevels !== levelsJson) await writeFile(levelsPath, levelsJson, 'utf8');

if (process.env.FORCE_SNAPSHOT !== '1' && !sourceChanged && !rowsChanged && !columnsChanged && !dashboardDataChanged) {
  console.log(`database_archive JSON unchanged: ${rows.length} rows`);
  process.exit(0);
}

const snapshot = {
  schemaVersion: 5,
  generatedAt: new Date().toISOString(),
  linkedDatabaseRevision: database.revision,
  linkedDatabaseUpdatedAt: database.updatedAt,
  sources: {
    primaryDatabase: { path: 'backend/data/db.json', revision: database.revision, updatedAt: database.updatedAt, rowCount: databaseTable.rows.length, rowsSha256: sourceRowsSha256 },
    archiveBase: { path: 'data/database_archive.json', previousRowCount: previousRows.length, mode: 'preserve-history-and-sync-primary-database-deletions' }
  },
  currentDatabaseRowKeys,
  mergeSummary: { added: addedCaseIds.length, updated: updatedCaseIds.length, removed: removedCaseIds.length, unchanged: unchangedCaseIds.length, preservedHistorical: Math.max(0, rows.length - databaseTable.rows.length), recalculatedArchiveRows, addedCaseIds, updatedCaseIds, removedCaseIds },
  updateSummary: { added: addedCaseIds.length, updated: updatedCaseIds.length, removed: removedCaseIds.length, unchanged: unchangedCaseIds.length, addedCaseIds, updatedCaseIds, removedCaseIds },
  rowCount: rows.length,
  rowsSha256,
  dashboardDataSha256,
  dashboardData,
  columns,
  rows
};

await mkdir(dirname(OUTPUT_PATH), { recursive: true });
await writeFile(OUTPUT_PATH, `${JSON.stringify(snapshot)}\n`, 'utf8');

console.log(JSON.stringify({ ok: true, source: 'backend/data/db.json', databaseRevision: database.revision, databaseRows: databaseTable.rows.length, archiveRows: rows.length, added: addedCaseIds.length, updated: updatedCaseIds.length, removed: removedCaseIds.length, recalculatedArchiveRows }, null, 2));

import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { applyWeightToRow } from '../backend/weighting.mjs';

const SCRIPT_DIR = dirname(fileURLToPath(import.meta.url));
const OUTPUT_PATH = resolve(SCRIPT_DIR, '../data/database_archive.json');
const PRIMARY_DATABASE_PATH = resolve(SCRIPT_DIR, '../backend/data/db.json');

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

const database = await readJson(PRIMARY_DATABASE_PATH, null);
const databaseTable = database?.tables?.database;
if (!databaseTable || !Array.isArray(databaseTable.rows)) throw new Error('backend/data/db.json is missing tables.database.rows');
const settingsRows = Array.isArray(database?.tables?.['設定']?.rows) ? database.tables['設定'].rows : [];
const modificationRows = Array.isArray(database?.tables?.['修改統計表']?.rows) ? database.tables['修改統計表'].rows : [];
const dashboardData = {
  settings: settingsRows.map(row => ({
    '名字': text(row['名字']),
    '顯示名': text(row['顯示名']),
    '頭像連結': text(row['頭像連結'])
  })),
  modifications: clone(modificationRows)
};

const previousSnapshot = await readJson(OUTPUT_PATH, { rows: [], columns: [] });
const previousRows = Array.isArray(previousSnapshot) ? previousSnapshot : (Array.isArray(previousSnapshot.rows) ? previousSnapshot.rows : []);
const archiveIndex = indexRowsByOccurrence(previousRows), databaseOccurrences = new Map(), activeIdentities = new Set();
const rows = [];
const addedCaseIds = [], updatedCaseIds = [], unchangedCaseIds = [];
const weightRules = database?.tables?.['加權計分標準']?.rows || [];

for (const [sourceIndex, sourceRow] of databaseTable.rows.entries()) {
  const currentRow = clone(sourceRow);
  applyWeightToRow(currentRow, weightRules.length ? weightRules : undefined);
  const id = caseId(currentRow), occurrence = id ? (databaseOccurrences.get(id) || 0) : 0;
  if (id) databaseOccurrences.set(id, occurrence + 1);
  const identity = id ? `${id}#${occurrence + 1}` : `__row__#${sourceIndex + 1}`;
  const label = id ? `${id}${occurrence ? `#${occurrence + 1}` : ''}` : `row:${sourceIndex + 1}`;
  activeIdentities.add(identity);
  const index = archiveIndex.get(identity);
  if (index === undefined) {
    rows.push(currentRow);
    addedCaseIds.push(label);
    continue;
  }
  const archiveRow = previousRows[index];
  const changed = JSON.stringify(archiveRow) !== JSON.stringify(currentRow);
  rows.push(currentRow);
  (changed ? updatedCaseIds : unchangedCaseIds).push(label);
}

const removedCaseIds = [];
const previousOccurrences = new Map();
previousRows.forEach((row, index) => {
  const id = caseId(row), occurrence = id ? (previousOccurrences.get(id) || 0) : 0;
  if (id) previousOccurrences.set(id, occurrence + 1);
  const identity = id ? `${id}#${occurrence + 1}` : `__row__#${index + 1}`;
  if (!activeIdentities.has(identity)) removedCaseIds.push(id ? `${id}${occurrence ? `#${occurrence + 1}` : ''}` : `row:${index + 1}`);
});

let recalculatedArchiveRows = 0;
for (const row of rows) {
  const before = text(row['加權']);
  applyWeightToRow(row, weightRules.length ? weightRules : undefined);
  if (before !== text(row['加權'])) recalculatedArchiveRows += 1;
}

const columns = [...new Set([...(Array.isArray(databaseTable.headers) ? databaseTable.headers : []), ...rows.flatMap(row => Object.keys(row))].filter(Boolean))];
const rowsSha256 = hash(rows), sourceRowsSha256 = hash(databaseTable.rows), dashboardDataSha256 = hash(dashboardData);
const sourceChanged = previousSnapshot?.sources?.primaryDatabase?.revision !== database.revision || previousSnapshot?.sources?.primaryDatabase?.rowsSha256 !== sourceRowsSha256;
const rowsChanged = previousSnapshot?.rowsSha256 !== rowsSha256;
const columnsChanged = JSON.stringify(previousSnapshot?.columns || []) !== JSON.stringify(columns);
const dashboardDataChanged = previousSnapshot?.dashboardDataSha256 !== dashboardDataSha256;
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
    archiveBase: { path: 'data/database_archive.json', previousRowCount: previousRows.length, mode: 'mirror-primary-database' }
  },
  mergeSummary: { added: addedCaseIds.length, updated: updatedCaseIds.length, removed: removedCaseIds.length, unchanged: unchangedCaseIds.length, preservedHistorical: 0, recalculatedArchiveRows, addedCaseIds, updatedCaseIds, removedCaseIds },
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

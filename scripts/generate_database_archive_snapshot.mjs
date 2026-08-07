import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const SPREADSHEET_ID = '1cHxWBed715H0XufNhMOOk3hcZPTSpq5rA64-b5m8vWY';
const API_URL = 'https://script.google.com/macros/s/AKfycbxNi2pdh70uzRyTF7Fo6OZ8MTROwHSZpqITwwHBs6UHLPhtSeZEHxkga5N_fPT4_qW15A/exec';
const SHEETS = {
  databaseArchive: { sheetName: 'database_archive', gid: '646199020' },
  database: { sheetName: 'database', gid: '1244538986' }
};
const SCRIPT_DIR = dirname(fileURLToPath(import.meta.url));
const OUTPUT_PATH = resolve(SCRIPT_DIR, '../data/database_archive.json');

function parseCsv(text) {
  const records = [];
  let record = [];
  let value = '';
  let quoted = false;

  for (let index = 0; index < text.length; index += 1) {
    const char = text[index];
    const next = text[index + 1];
    if (char === '"' && quoted && next === '"') {
      value += '"';
      index += 1;
    } else if (char === '"') {
      quoted = !quoted;
    } else if (char === ',' && !quoted) {
      record.push(value);
      value = '';
    } else if ((char === '\n' || char === '\r') && !quoted) {
      if (char === '\r' && next === '\n') index += 1;
      record.push(value);
      if (record.some(cell => String(cell).trim() !== '')) records.push(record);
      record = [];
      value = '';
    } else {
      value += char;
    }
  }

  record.push(value);
  if (record.some(cell => String(cell).trim() !== '')) records.push(record);
  return records;
}

async function readSheet(source) {
  const url = `https://docs.google.com/spreadsheets/d/${SPREADSHEET_ID}/gviz/tq?tqx=out:csv&gid=${source.gid}&ts=${Date.now()}`;
  const response = await fetch(url, { redirect: 'follow' });
  if (!response.ok) throw new Error(`${source.sheetName} 讀取失敗：HTTP ${response.status}`);
  const csv = await response.text();
  if (!csv || /<!doctype html/i.test(csv)) throw new Error(`${source.sheetName} 回傳內容不是 CSV`);
  const records = parseCsv(csv);
  const headers = (records.shift() || []).map(header => String(header).trim());
  const rows = records.map(record => Object.fromEntries(
    headers.flatMap((header, index) => header ? [[header, String(record[index] ?? '').trim()]] : [])
  ));
  return {
    ...source,
    csv,
    headers: headers.filter(Boolean),
    rows,
    rowCount: rows.length,
    csvSha256: createHash('sha256').update(csv).digest('hex')
  };
}

function apiRowToSheetRow(row = {}) {
  const clean = value => String(value ?? '').trim();
  const slashDate = value => /^\d{4}-\d{2}-\d{2}$/.test(clean(value)) ? clean(value).replaceAll('-', '/') : clean(value);
  return {
    '案件編號': clean(row.id),
    '月份': clean(row.month),
    '客戶別': clean(row.client),
    '專案名稱': clean(row.project),
    '專案負責人': clean(row.owner),
    '設計種類': clean(row.type),
    '階段': clean(row.stage),
    '數量': clean(row.qty),
    '開始日期': slashDate(row.start),
    '結束日期': slashDate(row.end),
    '設計負責人': clean(row.designer),
    '項目細節': clean(row.details),
    '狀態': clean(row.status),
    '加權': clean(row.weight),
    '填單時間': clean(row.submittedAt),
    '使用平台': clean(row.platforms),
    '設計簡報說明': clean(row.briefNote),
    '設計簡報連結': clean(row.briefUrl),
    '客戶素材說明': clean(row.assetNote),
    '客戶素材連結': clean(row.assetUrl),
    '參考範例說明': clean(row.referenceNote),
    '參考範例連結': clean(row.referenceUrl),
    '其他說明': clean(row.otherNote),
    '其他連結': clean(row.otherUrl)
  };
}

async function readDatabaseApi(source) {
  const params = new URLSearchParams({
    action: 'list',
    noCache: 'true',
    targetSpreadsheetId: SPREADSHEET_ID,
    targetSheetName: source.sheetName,
    targetSheetId: source.gid,
    ts: String(Date.now())
  });
  const response = await fetch(`${API_URL}?${params}`, { redirect: 'follow' });
  if (!response.ok) throw new Error(`${source.sheetName} 即時 API 讀取失敗：HTTP ${response.status}`);
  const data = await response.json();
  if (!data.ok || !Array.isArray(data.rows)) throw new Error(data.error || `${source.sheetName} 即時 API 未回傳 rows`);
  const rows = data.rows.map(apiRowToSheetRow);
  const serialized = JSON.stringify(rows);
  return {
    ...source,
    headers: [...new Set(rows.flatMap(row => Object.keys(row)))],
    rows,
    rowCount: rows.length,
    csvSha256: createHash('sha256').update(serialized).digest('hex'),
    transport: 'apps-script-no-cache'
  };
}

function caseId(row) {
  return String(row?.['案件編號'] || '').trim();
}

function comparableRow(row) {
  return {
    id: caseId(row),
    month: row['月份'] || '',
    client: row['客戶別'] || '',
    project: row['專案名稱'] || '',
    owner: row['專案負責人'] || '',
    type: row['設計種類'] || row['設計類型'] || row['設計總類'] || '',
    stage: row['階段'] || '',
    qty: row['數量'] || '',
    start: row['開始日期'] || '',
    end: row['結束日期'] || '',
    designer: row['設計負責人'] || '',
    details: row['項目細節'] || '',
    status: row['狀態'] || row['案件狀態'] || '',
    weight: row['加權'] || ''
  };
}

const [archiveData, databaseData] = await Promise.all([
  readSheet(SHEETS.databaseArchive),
  readDatabaseApi(SHEETS.database)
]);
const rows = archiveData.rows.map(row => ({ ...row }));
const archiveIndexesById = new Map();
rows.forEach((row, index) => {
  const id = caseId(row);
  if (!id) return;
  if (!archiveIndexesById.has(id)) archiveIndexesById.set(id, []);
  archiveIndexesById.get(id).push(index);
});
const databaseOccurrencesById = new Map();
const addedCaseIds = [];
const updatedCaseIds = [];
const unchangedCaseIds = [];

databaseData.rows.forEach(currentRow => {
  const id = caseId(currentRow);
  const occurrence = id ? (databaseOccurrencesById.get(id) || 0) : 0;
  if (id) databaseOccurrencesById.set(id, occurrence + 1);
  const archiveIndex = id ? archiveIndexesById.get(id)?.[occurrence] : undefined;
  const occurrenceLabel = id ? `${id}${occurrence ? `#${occurrence + 1}` : ''}` : `row:${rows.length + 1}`;
  if (archiveIndex === undefined) {
    rows.push({ ...currentRow });
    if (id) {
      if (!archiveIndexesById.has(id)) archiveIndexesById.set(id, []);
      archiveIndexesById.get(id).push(rows.length - 1);
    }
    addedCaseIds.push(occurrenceLabel);
    return;
  }
  const archiveRow = rows[archiveIndex];
  const changed = JSON.stringify(comparableRow(archiveRow)) !== JSON.stringify(comparableRow(currentRow));
  const mergedRow = { ...archiveRow, ...currentRow };
  if (String(archiveRow['填單時間'] || '').length > String(currentRow['填單時間'] || '').length) mergedRow['填單時間'] = archiveRow['填單時間'];
  rows[archiveIndex] = mergedRow;
  (changed ? updatedCaseIds : unchangedCaseIds).push(occurrenceLabel);
});
const columns = [...new Set([...archiveData.headers, ...databaseData.headers])];
let previousRows = [];
try {
  const previousSnapshot = JSON.parse(await readFile(OUTPUT_PATH, 'utf8'));
  previousRows = Array.isArray(previousSnapshot) ? previousSnapshot : previousSnapshot.rows || [];
} catch (error) {
  if (error?.code !== 'ENOENT') console.warn(`舊快照無法比對：${error.message}`);
}
function rowsByOccurrence(list) {
  const occurrences = new Map();
  const indexed = new Map();
  list.forEach(row => {
    const id = caseId(row);
    if (!id) return;
    const occurrence = occurrences.get(id) || 0;
    occurrences.set(id, occurrence + 1);
    indexed.set(`${id}#${occurrence + 1}`, { row, label: `${id}${occurrence ? `#${occurrence + 1}` : ''}` });
  });
  return indexed;
}
const previousById = rowsByOccurrence(previousRows);
const currentById = rowsByOccurrence(rows);
const snapshotAddedCaseIds = [];
const snapshotUpdatedCaseIds = [];
const snapshotUnchangedCaseIds = [];
currentById.forEach((current, identity) => {
  const previous = previousById.get(identity);
  if (!previous) snapshotAddedCaseIds.push(current.label);
  else if (JSON.stringify(comparableRow(previous.row)) !== JSON.stringify(comparableRow(current.row))) snapshotUpdatedCaseIds.push(current.label);
  else snapshotUnchangedCaseIds.push(current.label);
});
const snapshotRemovedCaseIds = [...previousById.entries()].filter(([identity]) => !currentById.has(identity)).map(([, value]) => value.label);
const snapshot = {
  schemaVersion: 2,
  generatedAt: new Date().toISOString(),
  sources: {
    databaseArchive: {
      spreadsheetId: SPREADSHEET_ID,
      sheetName: archiveData.sheetName,
      gid: archiveData.gid,
      rowCount: archiveData.rowCount,
      csvSha256: archiveData.csvSha256
    },
    database: {
      spreadsheetId: SPREADSHEET_ID,
      sheetName: databaseData.sheetName,
      gid: databaseData.gid,
      rowCount: databaseData.rowCount,
      csvSha256: databaseData.csvSha256,
      transport: databaseData.transport || 'gviz-csv'
    }
  },
  mergeSummary: {
    added: addedCaseIds.length,
    updated: updatedCaseIds.length,
    unchanged: unchangedCaseIds.length,
    addedCaseIds,
    updatedCaseIds
  },
  updateSummary: {
    added: snapshotAddedCaseIds.length,
    updated: snapshotUpdatedCaseIds.length,
    removed: snapshotRemovedCaseIds.length,
    unchanged: snapshotUnchangedCaseIds.length,
    addedCaseIds: snapshotAddedCaseIds,
    updatedCaseIds: snapshotUpdatedCaseIds,
    removedCaseIds: snapshotRemovedCaseIds
  },
  rowCount: rows.length,
  columns,
  rows
};

await mkdir(dirname(OUTPUT_PATH), { recursive: true });
await writeFile(OUTPUT_PATH, `${JSON.stringify(snapshot)}\n`, 'utf8');
console.log(
  `database_archive JSON 快照已更新：${rows.length} 筆` +
  `（相較上次快照：新增 ${snapshotAddedCaseIds.length}、更新 ${snapshotUpdatedCaseIds.length}、移除 ${snapshotRemovedCaseIds.length}） -> ${OUTPUT_PATH}`
);

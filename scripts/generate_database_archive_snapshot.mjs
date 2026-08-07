import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const SPREADSHEET_ID = '1cHxWBed715H0XufNhMOOk3hcZPTSpq5rA64-b5m8vWY';
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
  const url = `https://docs.google.com/spreadsheets/d/${SPREADSHEET_ID}/gviz/tq?tqx=out:csv&gid=${source.gid}`;
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
  readSheet(SHEETS.database)
]);
const rows = archiveData.rows.map(row => ({ ...row }));
const archiveIndexesById = new Map();
rows.forEach((row, index) => {
  const id = caseId(row);
  if (id) archiveIndexesById.set(id, index);
});
const addedCaseIds = [];
const updatedCaseIds = [];
const unchangedCaseIds = [];

databaseData.rows.forEach(currentRow => {
  const id = caseId(currentRow);
  const archiveIndex = id ? archiveIndexesById.get(id) : undefined;
  if (archiveIndex === undefined) {
    rows.push({ ...currentRow });
    if (id) archiveIndexesById.set(id, rows.length - 1);
    addedCaseIds.push(id || `row:${rows.length}`);
    return;
  }
  const archiveRow = rows[archiveIndex];
  const changed = JSON.stringify(comparableRow(archiveRow)) !== JSON.stringify(comparableRow(currentRow));
  rows[archiveIndex] = { ...archiveRow, ...currentRow };
  (changed ? updatedCaseIds : unchangedCaseIds).push(id);
});
const columns = [...new Set([...archiveData.headers, ...databaseData.headers])];
let previousRows = [];
try {
  const previousSnapshot = JSON.parse(await readFile(OUTPUT_PATH, 'utf8'));
  previousRows = Array.isArray(previousSnapshot) ? previousSnapshot : previousSnapshot.rows || [];
} catch (error) {
  if (error?.code !== 'ENOENT') console.warn(`舊快照無法比對：${error.message}`);
}
const previousById = new Map();
previousRows.forEach(row => {
  const id = caseId(row);
  if (id) previousById.set(id, row);
});
const currentById = new Map();
rows.forEach(row => {
  const id = caseId(row);
  if (id) currentById.set(id, row);
});
const snapshotAddedCaseIds = [];
const snapshotUpdatedCaseIds = [];
const snapshotUnchangedCaseIds = [];
currentById.forEach((row, id) => {
  const previous = previousById.get(id);
  if (!previous) snapshotAddedCaseIds.push(id);
  else if (JSON.stringify(comparableRow(previous)) !== JSON.stringify(comparableRow(row))) snapshotUpdatedCaseIds.push(id);
  else snapshotUnchangedCaseIds.push(id);
});
const snapshotRemovedCaseIds = [...previousById.keys()].filter(id => !currentById.has(id));
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
      csvSha256: databaseData.csvSha256
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

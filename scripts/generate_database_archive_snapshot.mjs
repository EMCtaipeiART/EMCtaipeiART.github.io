import { createHash } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const SPREADSHEET_ID = '1cHxWBed715H0XufNhMOOk3hcZPTSpq5rA64-b5m8vWY';
const SHEET_NAME = 'database_archive';
const SHEET_GID = '646199020';
const SOURCE_URL = `https://docs.google.com/spreadsheets/d/${SPREADSHEET_ID}/gviz/tq?tqx=out:csv&gid=${SHEET_GID}`;
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

const response = await fetch(SOURCE_URL, { redirect: 'follow' });
if (!response.ok) throw new Error(`database_archive 讀取失敗：HTTP ${response.status}`);

const csv = await response.text();
if (!csv || /<!doctype html/i.test(csv)) throw new Error('database_archive 回傳內容不是 CSV');

const records = parseCsv(csv);
const sourceHeaders = (records.shift() || []).map(header => String(header).trim());
const columns = sourceHeaders.filter(Boolean);
const rows = records.map(record => Object.fromEntries(
  sourceHeaders.flatMap((header, index) => header ? [[header, String(record[index] ?? '').trim()]] : [])
));
const snapshot = {
  schemaVersion: 1,
  generatedAt: new Date().toISOString(),
  source: {
    spreadsheetId: SPREADSHEET_ID,
    sheetName: SHEET_NAME,
    gid: SHEET_GID,
    csvSha256: createHash('sha256').update(csv).digest('hex')
  },
  rowCount: rows.length,
  columns,
  rows
};

await mkdir(dirname(OUTPUT_PATH), { recursive: true });
await writeFile(OUTPUT_PATH, `${JSON.stringify(snapshot)}\n`, 'utf8');
console.log(`database_archive JSON 快照已更新：${rows.length} 筆 -> ${OUTPUT_PATH}`);

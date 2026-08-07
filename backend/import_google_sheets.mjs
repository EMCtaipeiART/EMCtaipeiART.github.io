import { mkdir, readFile, rename, writeFile, copyFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { emptyDatabase, TABLE_SCHEMAS } from './schema.mjs';

const SPREADSHEET_ID = '1cHxWBed715H0XufNhMOOk3hcZPTSpq5rA64-b5m8vWY';
const HERE = path.dirname(fileURLToPath(import.meta.url));
const DEFAULT_OUTPUT = path.join(HERE, 'data', 'db.json');
const SOURCES = {
  database: `https://docs.google.com/spreadsheets/d/${SPREADSHEET_ID}/export?format=csv&gid=1244538986`,
  '短連結': `https://docs.google.com/spreadsheets/d/${SPREADSHEET_ID}/gviz/tq?tqx=out:csv&sheet=${encodeURIComponent('短連結')}`,
  '修改統計表': `https://docs.google.com/spreadsheets/d/${SPREADSHEET_ID}/export?format=csv&gid=1240020248`,
  '補充資料連結': `https://docs.google.com/spreadsheets/d/${SPREADSHEET_ID}/gviz/tq?tqx=out:csv&sheet=${encodeURIComponent('補充資料連結')}`,
  '設定': `https://docs.google.com/spreadsheets/d/${SPREADSHEET_ID}/export?format=csv&gid=988186149`,
  reels: `https://docs.google.com/spreadsheets/d/${SPREADSHEET_ID}/export?format=csv&gid=1503122183`,
  bug_report: `https://docs.google.com/spreadsheets/d/${SPREADSHEET_ID}/gviz/tq?tqx=out:csv&sheet=bug_report`
};

export function parseCsv(text) {
  const rows = [];
  let row = [];
  let field = '';
  let quoted = false;
  for (let index = 0; index < text.length; index += 1) {
    const char = text[index];
    if (quoted) {
      if (char === '"' && text[index + 1] === '"') {
        field += '"';
        index += 1;
      } else if (char === '"') {
        quoted = false;
      } else {
        field += char;
      }
    } else if (char === '"') {
      quoted = true;
    } else if (char === ',') {
      row.push(field);
      field = '';
    } else if (char === '\n') {
      row.push(field.replace(/\r$/, ''));
      rows.push(row);
      row = [];
      field = '';
    } else {
      field += char;
    }
  }
  if (field || row.length) {
    row.push(field.replace(/\r$/, ''));
    rows.push(row);
  }
  return rows;
}

function rowsToObjects(matrix, expectedHeaders) {
  const sourceHeaders = (matrix.shift() || []).map(value => String(value || '').trim());
  const headers = [...new Set([...sourceHeaders.filter(Boolean), ...expectedHeaders])];
  const rows = matrix
    .filter(values => values.some(value => String(value || '').trim()))
    .map(values => Object.fromEntries(sourceHeaders.map((header, index) => [header, values[index] ?? '']).filter(([header]) => header)));
  return { headers, rows };
}

export async function importGoogleSheets(outputPath = DEFAULT_OUTPUT) {
  const db = emptyDatabase();
  const importedAt = new Date().toISOString();
  const results = await Promise.all(Object.entries(SOURCES).map(async ([name, url]) => {
    const response = await fetch(url, { redirect: 'follow', headers: { 'User-Agent': 'Machi-JSON-Backend-Importer/1.0' } });
    if (!response.ok) throw new Error(`${name} 下載失敗：HTTP ${response.status}`);
    const data = rowsToObjects(parseCsv(await response.text()), TABLE_SCHEMAS[name].headers);
    return [name, url, data];
  }));

  db.createdAt = importedAt;
  db.updatedAt = importedAt;
  db.source = { type: 'google-sheets', spreadsheetId: SPREADSHEET_ID, importedAt, tables: {} };
  for (const [name, url, data] of results) {
    db.tables[name] = { headers: data.headers, primaryKey: TABLE_SCHEMAS[name].primaryKey, rows: data.rows };
    db.source.tables[name] = { url, rowCount: data.rows.length };
  }

  await mkdir(path.dirname(outputPath), { recursive: true });
  try {
    await readFile(outputPath);
    const backup = `${outputPath}.${new Date().toISOString().replace(/[:.]/g, '-')}.bak`;
    await copyFile(outputPath, backup);
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
  }
  const temp = `${outputPath}.${process.pid}.tmp`;
  await writeFile(temp, `${JSON.stringify(db, null, 2)}\n`, { mode: 0o600 });
  await rename(temp, outputPath);
  return Object.fromEntries(results.map(([name, , data]) => [name, data.rows.length]));
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const outputArg = process.argv.find(arg => arg.startsWith('--output='));
  const output = outputArg ? path.resolve(outputArg.slice('--output='.length)) : DEFAULT_OUTPUT;
  const counts = await importGoogleSheets(output);
  console.log(JSON.stringify({ ok: true, output, counts }, null, 2));
}

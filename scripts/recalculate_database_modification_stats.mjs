import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { normalizeDatabaseShape, stringifyDatabaseForStorage } from '../backend/schema.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const databasePath = path.resolve(HERE, '../backend/data/db.json');
const database = JSON.parse(await readFile(databasePath, 'utf8'));
const mainTable = database?.tables?.database;
if (!mainTable || !Array.isArray(mainTable.rows)) throw new Error('找不到 database rows');

const beforeHeaders = JSON.stringify(mainTable.headers || []);
const beforeRows = new Map(mainTable.rows.map(row => [String(row['案件編號'] || ''), {
  count: String(row['修改次數'] ?? ''),
  submittedAt: String(row['繳交時間'] ?? '')
}]));

normalizeDatabaseShape(database);

let countChanged = 0;
let submittedAtChanged = 0;
for (const row of mainTable.rows) {
  const before = beforeRows.get(String(row['案件編號'] || '')) || { count: '', submittedAt: '' };
  if (before.count !== String(row['修改次數'] ?? '')) countChanged += 1;
  if (before.submittedAt !== String(row['繳交時間'] ?? '')) submittedAtChanged += 1;
}
const headersChanged = beforeHeaders !== JSON.stringify(mainTable.headers || []);
const changed = countChanged || submittedAtChanged || headersChanged;
if (!changed) {
  console.log(JSON.stringify({ ok: true, rowCount: mainTable.rows.length, countChanged, submittedAtChanged, headersChanged, revision: database.revision, written: false }, null, 2));
  process.exit(0);
}

database.revision = Number(database.revision || 0) + 1;
database.updatedAt = new Date().toISOString();
database.lastWrite = { reason: 'derive modification count and submission time from modification records', at: database.updatedAt };
await writeFile(databasePath, stringifyDatabaseForStorage(database), 'utf8');
console.log(JSON.stringify({ ok: true, rowCount: mainTable.rows.length, countChanged, submittedAtChanged, headersChanged, revision: database.revision, written: true }, null, 2));

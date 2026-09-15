import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const databasePath = path.join(root, 'backend', 'data', 'db.json');
const outputPath = path.join(root, 'data', 'short_link_index.json');
const database = JSON.parse(await readFile(databasePath, 'utf8'));

const rows = tableName => Array.isArray(database.tables?.[tableName]?.rows)
  ? database.tables[tableName].rows
  : [];
const cleanUrl = value => /^https?:\/\//i.test(String(value || '').trim())
  ? String(value).trim()
  : '';

const shortLinks = {};
for (const row of rows('短連結')) {
  const code = String(row['短碼'] || '').trim();
  const url = cleanUrl(row['原始網址']);
  if (code && url) shortLinks[code] = url;
}

const supplements = {};
for (const row of rows('補充資料連結')) {
  const id = String(row['案件編號'] || '').trim();
  if (!id) continue;
  const links = {};
  for (const slot of ['A', 'B', 'C', 'D']) {
    const url = cleanUrl(row[slot]);
    if (url) links[slot.toLowerCase()] = url;
  }
  if (Object.keys(links).length) supplements[id] = links;
}

const index = {
  version: 1,
  databaseRevision: Number(database.revision || 0),
  generatedAt: String(database.updatedAt || database.lastWrite?.at || ''),
  shortLinks,
  supplements
};

// 短網址與補充連結都沒變時保留原檔不動。databaseRevision／generatedAt 跟著主資料庫每次寫入都會變，
// 以前每次都重寫，這個檔案永遠「有差異」，自動化流程就每一筆寫入都多一次提交。
let previousIndex = null;
try { previousIndex = JSON.parse(await readFile(outputPath, 'utf8')); } catch { previousIndex = null; }
if (previousIndex
  && JSON.stringify(previousIndex.shortLinks || {}) === JSON.stringify(shortLinks)
  && JSON.stringify(previousIndex.supplements || {}) === JSON.stringify(supplements)) {
  console.log(`${path.relative(root, outputPath)} unchanged: ${Object.keys(shortLinks).length} short links, ${Object.keys(supplements).length} supplement cases.`);
  process.exit(0);
}

await writeFile(outputPath, `${JSON.stringify(index)}\n`, 'utf8');
console.log(`Generated ${path.relative(root, outputPath)}: ${Object.keys(shortLinks).length} short links, ${Object.keys(supplements).length} supplement cases.`);


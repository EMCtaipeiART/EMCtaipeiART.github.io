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
  generatedAt: new Date().toISOString(),
  shortLinks,
  supplements
};

await writeFile(outputPath, `${JSON.stringify(index)}\n`, 'utf8');
console.log(`Generated ${path.relative(root, outputPath)}: ${Object.keys(shortLinks).length} short links, ${Object.keys(supplements).length} supplement cases.`);


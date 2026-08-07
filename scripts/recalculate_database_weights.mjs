import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { applyWeightToRow } from '../backend/weighting.mjs';

const HERE=path.dirname(fileURLToPath(import.meta.url));
const databasePath=path.resolve(HERE,'../backend/data/db.json');
const database=JSON.parse(await readFile(databasePath,'utf8'));
const rows=database?.tables?.database?.rows;
if(!Array.isArray(rows))throw new Error('找不到 database rows');

let changed=0;
for(const row of rows){
  const before=String(row['加權'] ?? '');
  applyWeightToRow(row);
  if(before!==String(row['加權'] ?? ''))changed++;
}
database.revision=Number(database.revision||0)+1;
database.updatedAt=new Date().toISOString();
database.lastWrite={reason:'recalculate weights from item-detail score table',at:database.updatedAt};
await writeFile(databasePath,`${JSON.stringify(database,null,2)}\n`,'utf8');
console.log(JSON.stringify({ok:true,rowCount:rows.length,changed,revision:database.revision},null,2));

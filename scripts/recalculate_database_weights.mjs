import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { stringifyDatabaseForStorage } from '../backend/schema.mjs';
import { applyWeightToRow, DEFAULT_WEIGHT_RULE_ROWS } from '../backend/weighting.mjs';

const HERE=path.dirname(fileURLToPath(import.meta.url));
const databasePath=path.resolve(HERE,'../backend/data/db.json');
const database=JSON.parse(await readFile(databasePath,'utf8'));
const rulesAdded=!database.tables['加權計分標準'];
database.tables['加權計分標準'] ||= {
  headers:['設計種類','階段','項目細節','權重','備註'],
  primaryKey:null,
  rows:DEFAULT_WEIGHT_RULE_ROWS.map(row=>({...row}))
};
const rows=database?.tables?.database?.rows;
const rules=database?.tables?.['加權計分標準']?.rows;
if(!Array.isArray(rows))throw new Error('找不到 database rows');

let changed=0;
for(const row of rows){
  const before=String(row['加權'] ?? '');
  applyWeightToRow(row,rules);
  if(before!==String(row['加權'] ?? ''))changed++;
}
if(!changed&&!rulesAdded){console.log(JSON.stringify({ok:true,rowCount:rows.length,changed,revision:database.revision,written:false},null,2));process.exit(0)}
database.revision=Number(database.revision||0)+1;
database.updatedAt=new Date().toISOString();
database.lastWrite={reason:'recalculate weights from item-detail score table',at:database.updatedAt};
await writeFile(databasePath,stringifyDatabaseForStorage(database),'utf8');
console.log(JSON.stringify({ok:true,rowCount:rows.length,changed,revision:database.revision,written:true},null,2));

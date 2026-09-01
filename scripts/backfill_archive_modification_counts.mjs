import { readFile, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

// 一次性資料校正腳本：把「歷史資料庫」（data/database_archive.json）裡沒有
// 「修改次數」欄位、或欄位值已經不再被即時同步機制更新的案件，比照正式即時
// 資料庫本身用的同一套邏輯（backend/schema.mjs 的
// recalculateDatabaseModificationStats）從「修改統計表」重新算一次：這個案件
// 在「修改統計表」裡目前最大的「修改次數」值，完全沒有任何紀錄就是 0（代表
// 從沒被追蹤過任何一輪修改）。
//
// 範圍：只補「目前不在正式即時資料庫（backend/data/db.json 的 database 表）
// 裡」的歷史列。currently-live 的案件本來就會在每次自動同步（GitHub Actions
// 每小時觸發／Worker 寫入觸發）時，直接沿用正式資料庫已經算好的「修改次數」
// （見 generate_database_archive_snapshot.mjs 的 merge 邏輯），這次完全不去
// 動它們，避免跟「歷史資料庫裡目前存在的正式案件，必須跟正式資料庫逐欄位
// 完全一致」這條既有規則衝突。
//
// 這次執行時查證過：8673 筆歷史資料庫裡，只有目前仍在正式資料庫裡的 755 筆
// 有「修改次數」這個欄位（且都正確），其餘 7918 筆（6678 筆 2025 年以前的純
// 歷史紀錄＋1240 筆 2026 年案件曾經在正式資料庫存在過、但已經不在目前的正式
// 資料庫裡）完全沒有這個欄位——這 1240 筆裡，其中 1 筆（26010146）「修改統計
// 表」裡其實還留著真實的修改輪次紀錄（目前最大修改次數 1），只是因為案件已
// 經不在正式資料庫裡，沒有任何自動化流程會再幫它重算，這支腳本會把它一併
// 正確補上；其餘沒有修改紀錄的案件，這次統一補上代表「沒有追蹤到任何修改」
// 的 0。

const SCRIPT_DIR = dirname(fileURLToPath(import.meta.url));
const DATABASE_PATH = resolve(SCRIPT_DIR, '../backend/data/db.json');
const ARCHIVE_PATH = resolve(SCRIPT_DIR, '../data/database_archive.json');

const hash = value => createHash('sha256').update(JSON.stringify(value)).digest('hex');
const text = value => String(value ?? '').trim();

const database = JSON.parse(await readFile(DATABASE_PATH, 'utf8'));
const archive = JSON.parse(await readFile(ARCHIVE_PATH, 'utf8'));
if (!Array.isArray(archive.rows)) throw new Error('data/database_archive.json 缺少 rows 陣列');

const maxByCase = new Map();
for (const row of database?.tables?.['修改統計表']?.rows || []) {
  const caseId = text(row['案件編號']);
  if (!caseId) continue;
  const count = Math.max(0, Number(row['修改次數']) || 0);
  maxByCase.set(caseId, Math.max(maxByCase.get(caseId) || 0, count));
}

const liveIds = new Set((database?.tables?.database?.rows || []).map(row => text(row['案件編號'])).filter(Boolean));

let filled = 0;
for (const row of archive.rows) {
  const caseId = text(row['案件編號']);
  if (caseId && liveIds.has(caseId)) continue; // 交給既有的即時同步機制維護，這裡完全不動
  const computed = String(maxByCase.get(caseId) || 0);
  if (text(row['修改次數']) !== computed) {
    row['修改次數'] = computed;
    filled += 1;
  }
}

if (!filled) {
  console.log(JSON.stringify({ ok: true, filled, written: false }, null, 2));
  process.exit(0);
}

archive.rowCount = archive.rows.length;
archive.rowsSha256 = hash(archive.rows);
await writeFile(ARCHIVE_PATH, `${JSON.stringify(archive)}\n`, 'utf8');
console.log(JSON.stringify({ ok: true, filled, written: true }, null, 2));

// 每月月初把「超過 3 個月」的已結案案件搬進歷史資料庫，讓現行資料庫（backend/data/db.json，每位使用者進站都要下載）只留最近 3 個月。
// 例：10 月留 8、9、10 月，6、7 月（和更早的）已完成／已取消的案件搬走。
//
// 「搬」的意思：
//   - 歷史資料庫（data/database_archive.json）本來就有每一筆案件；這裡把那些列從 currentDatabaseRowKeys 拿掉，
//     之後歷史資料庫的自動同步就會當成「歷史」永久保留，不會跟著主資料庫的刪除一起被刪。
//   - 主資料庫移除那些案件的案件列、修改統計表、補充資料連結（修改紀錄由 generate_database_archive_snapshot.mjs 保留在歷史資料庫）。
// 只搬整個案件的每一列都已結案（已完成／已取消）的；還在進行、暫停中的案件不論多舊都留著。
// 信件串本文不在資料庫裡（只有信件串編號，內容在 Gmail），不受影響。
//
// 用法：node scripts/archive_old_cases.mjs        （實際搬移）
//       DRY_RUN=1 node scripts/archive_old_cases.mjs （只列出會搬什麼）
//       NOW=2026-11-01T01:00:00Z KEEP_MONTHS=3 …    （測試用）
import { readFile, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { stringifyDatabaseForStorage } from '../backend/schema.mjs';

const text = value => String(value ?? '').trim();
export const CLOSED_STATUSES = ['已完成', '已取消'];

/** 台北時間的 YYMM（整數）。 */
export function taipeiYearMonth(now) {
  const parts = Object.fromEntries(new Intl.DateTimeFormat('en-GB', { timeZone: 'Asia/Taipei', year: 'numeric', month: '2-digit' }).formatToParts(now).map(part => [part.type, part.value]));
  return { year: Number(parts.year), month: Number(parts.month) };
}

/** 要保留的最早一個月（YYMM 整數）：這個月往前算 keepMonths 個月（含這個月）。 */
export function oldestKeptYymm(now, keepMonths = 3) {
  const { year, month } = taipeiYearMonth(now);
  const index = year * 12 + (month - 1) - (keepMonths - 1);
  const y = Math.floor(index / 12), m = (index % 12) + 1;
  return (y % 100) * 100 + m;
}

/** 純函式：回傳要搬走的案件編號。 */
export function caseIdsToArchive(rows, now, keepMonths = 3) {
  const cutoff = oldestKeptYymm(now, keepMonths);
  const byId = new Map();
  for (const row of rows) {
    const id = text(row['案件編號']);
    if (!byId.has(id)) byId.set(id, []);
    byId.get(id).push(row);
  }
  return new Set([...byId].filter(([id, list]) => /^\d{8}$/.test(id) && Number(id.slice(0, 4)) < cutoff && list.every(row => CLOSED_STATUSES.includes(text(row['狀態'] ?? row['案件狀態']))))
    .map(([id]) => id));
}

/** 就地修改 db 與 archive，回傳摘要。 */
export function archiveOldCases(db, archive, now, keepMonths = 3) {
  const rows = db.tables.database.rows;
  const moveIds = caseIdsToArchive(rows, now, keepMonths);
  const summary = { cutoff: oldestKeptYymm(now, keepMonths), cases: moveIds.size, rows: 0, modificationRows: 0, supplementRows: 0, addedToArchive: 0 };
  if (!moveIds.size) return summary;
  const archiveIndex = new Map(), occurrences = new Map();
  archive.rows.forEach((row, index) => {
    const id = text(row['案件編號']);
    const occurrence = (occurrences.get(id) || 0) + 1;
    occurrences.set(id, occurrence);
    archiveIndex.set(`${id}#${occurrence}`, index);
  });
  const keys = new Set(), dbOccurrences = new Map();
  for (const row of rows) {
    const id = text(row['案件編號']);
    const occurrence = (dbOccurrences.get(id) || 0) + 1;
    dbOccurrences.set(id, occurrence);
    if (!moveIds.has(id)) continue;
    const key = `${id}#${occurrence}`;
    keys.add(key);
    const index = archiveIndex.get(key);
    // 歷史資料庫裡一定要先有這一列（內容以主資料庫為準），沒有就補上，搬走後才不會遺失。
    if (index === undefined) { archive.rows.push(JSON.parse(JSON.stringify(row))); archiveIndex.set(key, archive.rows.length - 1); summary.addedToArchive += 1; }
    else archive.rows[index] = { ...archive.rows[index], ...row };
  }
  archive.currentDatabaseRowKeys = (archive.currentDatabaseRowKeys || []).filter(key => !keys.has(key));
  const keep = list => list.filter(row => !moveIds.has(text(row['案件編號'])));
  const before = { rows: rows.length, modification: db.tables['修改統計表']?.rows.length || 0, supplement: db.tables['補充資料連結']?.rows.length || 0 };
  db.tables.database.rows = keep(rows);
  if (db.tables['修改統計表']) db.tables['修改統計表'].rows = keep(db.tables['修改統計表'].rows);
  if (db.tables['補充資料連結']) db.tables['補充資料連結'].rows = keep(db.tables['補充資料連結'].rows);
  summary.rows = before.rows - db.tables.database.rows.length;
  summary.modificationRows = before.modification - (db.tables['修改統計表']?.rows.length || 0);
  summary.supplementRows = before.supplement - (db.tables['補充資料連結']?.rows.length || 0);
  db.revision = Number(db.revision) + 1;
  db.updatedAt = now.toISOString();
  db.lastWrite = { reason: `move cases older than ${keepMonths} months to the history database`, at: db.updatedAt };
  return summary;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const scriptDir = dirname(fileURLToPath(import.meta.url));
  const dbPath = process.env.PRIMARY_DATABASE_PATH ? resolve(process.env.PRIMARY_DATABASE_PATH) : resolve(scriptDir, '../backend/data/db.json');
  const archivePath = process.env.ARCHIVE_BASE_PATH ? resolve(process.env.ARCHIVE_BASE_PATH) : resolve(scriptDir, '../data/database_archive.json');
  const now = process.env.NOW ? new Date(process.env.NOW) : new Date();
  const keepMonths = Number(process.env.KEEP_MONTHS) || 3;
  const db = JSON.parse(await readFile(dbPath, 'utf8')), archive = JSON.parse(await readFile(archivePath, 'utf8'));
  const summary = archiveOldCases(db, archive, now, keepMonths);
  console.log(JSON.stringify({ ok: true, dryRun: process.env.DRY_RUN === '1', ...summary }));
  if (summary.cases && process.env.DRY_RUN !== '1') {
    await writeFile(archivePath, `${JSON.stringify(archive)}\n`, 'utf8');
    await writeFile(dbPath, stringifyDatabaseForStorage(db), 'utf8');
  }
}

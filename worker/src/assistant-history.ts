/**
 * 小黃讀取「歷史資料庫」：目前的案件資料庫只留近約 3 個月，更早的案件由自動流程歸檔到 data/database_archive.json（2023 年起、約 9 千筆）。
 * 這裡從 GitHub 讀那份檔案、只留查詢需要的欄位、快取在 Worker 記憶體 1 小時（約 5 MB 原始檔，不存進 storage）。
 * 讀不到時回傳 ok:false，小黃退回只用目前資料庫，並如實說明歷史資料暫時讀不到。只讀、不寫。
 */
import type { Row } from './types';

export const HISTORY_TTL_MS = 60 * 60 * 1000;
export const HISTORY_RETRY_MS = 5 * 60 * 1000;
const KEEP = ['案件編號', '客戶別', '專案名稱', '專案負責人', '設計負責人', '狀態', '階段', '設計種類', '開始日期', '結束日期', '填單時間', '繳交時間', '數量', '加權', '項目細節'];

let cache: { at: number; rows: Row[] } | null = null;
let failedAt = 0;
export function resetHistoryCache(): void { cache = null; failedAt = 0; }

export interface HistorySource { owner: string; repo: string; branch: string }

const slim = (row: Row): Row => {
  const out: Row = {};
  for (const key of KEEP) { const v = row?.[key]; if (v !== undefined && v !== null && v !== '') out[key] = v; }
  return out;
};

export async function loadHistoryRows(source: HistorySource, nowMs: number, fetchImpl: typeof fetch = fetch): Promise<{ rows: Row[]; ok: boolean }> {
  if (cache && nowMs - cache.at < HISTORY_TTL_MS) return { rows: cache.rows, ok: true };
  if (!cache && failedAt && nowMs - failedAt < HISTORY_RETRY_MS) return { rows: [], ok: false };
  try {
    const url = `https://raw.githubusercontent.com/${encodeURIComponent(source.owner)}/${encodeURIComponent(source.repo)}/${encodeURIComponent(source.branch)}/data/database_archive.json`;
    const response = await fetchImpl(url, { headers: { 'user-agent': 'emc-assistant' }, signal: AbortSignal.timeout(20000) });
    if (!response.ok) throw new Error('HTTP ' + response.status);
    const json = await response.json() as { rows?: Row[] };
    const rows = (Array.isArray(json.rows) ? json.rows : []).map(slim).filter(r => r['案件編號']);
    if (!rows.length) throw new Error('empty archive');
    cache = { at: nowMs, rows }; failedAt = 0;
    return { rows, ok: true };
  } catch {
    failedAt = nowMs;
    return cache ? { rows: cache.rows, ok: true } : { rows: [], ok: false }; // 有舊快取就沿用
  }
}

/** 目前資料庫的案件優先（較新），只存在於歷史的案件標上 __history。 */
export function mergeCaseRows(current: Row[], history: Row[]): Row[] {
  const byId = new Map<string, Row>();
  for (const row of history) byId.set(String(row['案件編號']), { ...row, __history: true });
  for (const row of current) { const id = String(row['案件編號'] ?? ''); if (id) byId.set(id, row); }
  return [...byId.values()];
}

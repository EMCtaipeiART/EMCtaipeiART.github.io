import { text } from './model';
import type { DatabaseSnapshot, Row } from './types';

/**
 * 操作紀錄（稽核）：記「誰、什麼時候、做了什麼」，不放進公開給前端每 8 秒輪詢的 db.json，
 * 另存成 backend/data/audit-log.json。先排在 Durable Object 的佇列裡，由每分鐘的 Cron 批次寫入 GitHub，
 * 避免每個操作都多一次 commit。
 */
export type AuditKind = '狀態變更' | '欄位修改' | '案件新增' | '案件刪除' | '權限變更' | '登入' | '登入失敗' | '寄信' | '寄信失敗';

export interface AuditEntry {
  t: string;
  kind: AuditKind;
  actor: string;
  caseId?: string;
  target?: string;
  field?: string;
  from?: string;
  to?: string;
  note?: string;
}

export const AUDIT_FILE = 'audit-log.json';
export const AUDIT_MAX_ROWS = 20000;
const VALUE_MAX = 200;
const MAX_ENTRIES_PER_WRITE = 200;
// 派生值或太大、沒有稽核價值的欄位
const SKIP_CASE_FIELDS = new Set(['修改次數', '加權', '設計圖資料夾清單', 'Gmail信件串ID']);

const clip = (value: unknown): string => {
  const s = text(value);
  return s.length > VALUE_MAX ? `${s.slice(0, VALUE_MAX)}…` : s;
};

export function auditActor(session: { user?: string; account?: string } | null | undefined, fallback = 'system'): string {
  return text(session?.user || session?.account) || fallback;
}

/** 收件人只留信箱網域與人數，不把完整信箱寫進（公開的）紀錄 */
export function maskRecipients(value: unknown): string {
  const list = text(value).match(/[^\s<>,;，；"']+@[^\s<>,;，；"']+/g) || [];
  if (!list.length) return '';
  const domains = [...new Set(list.map(item => (item.split('@')[1] || '').toLowerCase()).filter(Boolean))];
  return `${list.length} 位（${domains.join('、') || '—'}）`;
}

function keyed(rows: Row[], key: string): Map<string, Row> {
  const map = new Map<string, Row>();
  rows.forEach((row, index) => {
    const id = text(row[key]);
    map.set(id ? (map.has(id) ? `${id}#${index}` : id) : `#${index}`, row);
  });
  return map;
}

/** 比對寫入前後的資料庫，產生「案件」與「帳號權限」的異動紀錄 */
export function diffAudit(before: DatabaseSnapshot, after: DatabaseSnapshot, actor: string, action: string): AuditEntry[] {
  const out: AuditEntry[] = [];
  const t = new Date().toISOString();
  const push = (entry: Omit<AuditEntry, 't' | 'actor'>) => { if (out.length < MAX_ENTRIES_PER_WRITE) out.push({ t, actor, ...entry }); };

  const cb = before.tables['database']?.rows || [], ca = after.tables['database']?.rows || [];
  if (cb !== ca) {
    const old = keyed(cb, '案件編號'), now = keyed(ca, '案件編號');
    for (const [id, row] of now) {
      const prev = old.get(id);
      const caseId = text(row['案件編號']);
      if (!prev) { push({ kind: '案件新增', caseId, note: clip(`${text(row['客戶別'])}_${text(row['專案名稱'])}｜${action}`) }); continue; }
      for (const field of Object.keys(row)) {
        if (SKIP_CASE_FIELDS.has(field)) continue;
        const a = text(prev[field]), b = text(row[field]);
        if (a === b) continue;
        push({ kind: field === '狀態' ? '狀態變更' : '欄位修改', caseId, field, from: clip(a), to: clip(b), note: action });
      }
    }
    for (const [id, row] of old) if (!now.has(id)) push({ kind: '案件刪除', caseId: text(row['案件編號']), note: clip(`${text(row['客戶別'])}_${text(row['專案名稱'])}｜${action}`) });
  }

  const pb = before.tables['帳號權限']?.rows || [], pa = after.tables['帳號權限']?.rows || [];
  if (pb !== pa) {
    const old = keyed(pb, '帳號'), now = keyed(pa, '帳號');
    for (const [id, row] of now) {
      const prev = old.get(id);
      const account = text(row['帳號']);
      if (!prev) { push({ kind: '權限變更', field: '新增帳號', target: account, to: clip(`${text(row['角色範本'])}／${text(row['狀態'])}`), note: action }); continue; }
      for (const field of Object.keys(row)) {
        if (field.includes('密碼') || field === '更新時間' || field === '更新者') continue;
        const a = text(prev[field]), b = text(row[field]);
        if (a !== b) push({ kind: '權限變更', target: account, field, from: clip(a), to: clip(b), note: action });
      }
    }
    for (const [id, row] of old) if (!now.has(id)) push({ kind: '權限變更', field: '移除帳號', target: text(row['帳號']), note: action });
  }
  return out;
}

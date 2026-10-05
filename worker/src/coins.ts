// 平台幣（2026-10-05）：設計師完成案件的積分 1 點回饋 1 點平台幣；每次用 AI 服裝生成器扣 200 點；設計師之間可以互轉。
// 帳本放在 Durable Object 的 SQL 裡，只新增、不修改、不刪除；每一筆都帶上一筆的雜湊（hash chain），
// 事後有人改動任何一筆，後台的「驗證帳本」就會抓到。金額一律以「十分之一點」的整數存（積分有 0.5、1.5 這種小數）。

export const COIN_START_DATE = '2026/10/01';       // 這天（含）以後結束的已完成案件才計算
export const COIN_TENTHS = 10;                      // 1 點 = 10 個內部單位
export const COIN_SPEND_PER_GENERATION = 200 * COIN_TENTHS;
export const COIN_MAX_TRANSFER = 100_000 * COIN_TENTHS;

export type CoinKind = 'earn' | 'spend' | 'refund' | 'transfer_out' | 'transfer_in' | 'adjust';
export const COIN_KIND_LABEL: Record<CoinKind, string> = {
  earn: '完成案件回饋', spend: '服裝生成', refund: '生成失敗退回', transfer_out: '轉出', transfer_in: '轉入', adjust: '管理員調整'
};

export type CoinEntry = {
  seq: number; id: string; at: number; kind: CoinKind; holder: string; amount: number;
  counterparty: string; ref: string; memo: string; actor: string; prev_hash: string; hash: string;
};

/** 使用者輸入的點數（可以有一位小數）→ 內部整數；不合法就丟錯。 */
export function coinsToTenths(value: unknown, label = '點數'): number {
  const number = Number(value);
  if (!Number.isFinite(number) || number <= 0) throw new Error(`${label}必須大於 0`);
  const tenths = Math.round(number * COIN_TENTHS);
  if (Math.abs(number * COIN_TENTHS - tenths) > 1e-6) throw new Error(`${label}最多一位小數`);
  if (tenths > COIN_MAX_TRANSFER) throw new Error(`${label}超過單筆上限`);
  return tenths;
}
export const tenthsToCoins = (value: number): number => Math.round(value) / COIN_TENTHS;

export async function coinHash(prev: string, entry: Omit<CoinEntry, 'seq' | 'prev_hash' | 'hash'>): Promise<string> {
  const data = [prev, entry.id, entry.at, entry.kind, entry.holder, entry.amount, entry.counterparty, entry.ref, entry.memo, entry.actor].join('|');
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(data));
  return Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, '0')).join('');
}

/** 從頭驗證整條帳本：每一筆的 prev_hash 要等於上一筆的 hash，且 hash 要等於重算的結果。 */
export async function verifyCoinChain(entries: CoinEntry[]): Promise<{ ok: boolean; checked: number; brokenAtSeq: number | null; reason: string }> {
  let prev = '';
  for (const entry of entries) {
    if (entry.prev_hash !== prev) return { ok: false, checked: entries.length, brokenAtSeq: entry.seq, reason: '與前一筆的串接不符（中間有紀錄被刪除或插入）' };
    const expected = await coinHash(prev, entry);
    if (entry.hash !== expected) return { ok: false, checked: entries.length, brokenAtSeq: entry.seq, reason: '這一筆的內容與簽章不符（紀錄被改動過）' };
    prev = entry.hash;
  }
  return { ok: true, checked: entries.length, brokenAtSeq: null, reason: '' };
}

/** 常數時間比較，避免從回應時間猜出服務金鑰。 */
export function safeEqual(a: string, b: string): boolean {
  if (!a || !b) return false;
  const left = new TextEncoder().encode(a), right = new TextEncoder().encode(b);
  let diff = left.length ^ right.length;
  const length = Math.max(left.length, right.length);
  for (let i = 0; i < length; i += 1) diff |= (left[i] || 0) ^ (right[i] || 0);
  return diff === 0;
}

/** 案件的結束日期（2026/10/06、2026-10-06）是否落在起算日當天或之後。 */
export function endedOnOrAfterStart(value: unknown, start = COIN_START_DATE): boolean {
  const match = String(value ?? '').match(/(\d{4})\D(\d{1,2})\D(\d{1,2})/);
  if (!match) return false;
  const key = `${match[1]}/${match[2].padStart(2, '0')}/${match[3].padStart(2, '0')}`;
  return key >= start;
}

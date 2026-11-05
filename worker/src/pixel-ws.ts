/** 3D 辦公室的即時位置：前台透過 WebSocket 直接送位置，後端只做身分確認、檢查格式、轉發（不寫資料庫）。純邏輯，方便測試。 */

export const PIXEL_MOVE_MIN_GAP_MS = 40;   // 同一條連線兩則位置至少間隔這麼久，太密的丟掉

export interface PixelMove { fx: number; fy: number; d: string }

/** 登入帳號是否就是這位同仁：帳號名稱或信箱前綴（不分大小寫）要等於角色名字。不符就不給走即時通道（前台會退回 HTTP，不影響使用）。 */
export function sessionMatchesName(session: { user?: unknown; account?: unknown } | null | undefined, name: string): boolean {
  if (!session || !name) return false;
  const low = (v: unknown) => String(v ?? '').trim().toLowerCase();
  const n = low(name), user = low(session.user), account = low(session.account).split('@')[0];
  return Boolean(n) && (user === n || account === n);
}

/** 驗證前台送來的位置訊息；格式不對回傳 null。 */
export function parseMove(raw: unknown): PixelMove | null {
  const m = raw && typeof raw === 'object' ? raw as Record<string, unknown> : null;
  if (!m || m.t !== 'p') return null;
  const fx = Number(m.fx), fy = Number(m.fy), d = String(m.d ?? '');
  if (!Number.isFinite(fx) || !Number.isFinite(fy) || Math.abs(fx) > 20000 || Math.abs(fy) > 20000) return null;
  return { fx: Math.round(fx), fy: Math.round(fy), d: ['up', 'down', 'left', 'right'].includes(d) ? d : '' };
}

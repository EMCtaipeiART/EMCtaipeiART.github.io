/**
 * Femas HR（公司人資系統）匯出的全部門 iCal：每筆假單是「姓名-假別」。用來補足 Google 行事曆看不到的請假
 * （2026-10-05 Noise 請假但他的 Google 行事曆沒有活動，系統就判成下班）。
 *
 * 公開的 GitHub 倉庫裡不能放真實姓名或 iCal 連結（連結本身就是存取權杖），所以網址與「人資姓名 → 設計師」的
 * 對應都放在 Worker 的 secret（FEMAS_ICAL_URL／FEMAS_NAME_MAP），這支檔案只有解析邏輯。
 */
export interface FemasLeave { who: string; start: number; end: number }

const TAIPEI_OFFSET_MS = 8 * 60 * 60 * 1000;

/** iCal 日期（YYYYMMDD 或 YYYYMMDDTHHMMSS[Z]）轉毫秒；沒有 Z 的一律當台北時間。 */
function parseIcalTime(value: string, dateOnly: boolean): number {
  const match = /^(\d{4})(\d{2})(\d{2})(?:T(\d{2})(\d{2})(\d{2})?)?(Z)?$/.exec(value.trim());
  if (!match) return NaN;
  const [, y, mo, d, h = '0', mi = '0', s = '0', z] = match;
  const utc = Date.UTC(Number(y), Number(mo) - 1, Number(d), Number(h), Number(mi), Number(s));
  // 有 Z ＝ UTC；整天事件與沒有時區的時間都是台北時間。
  return z ? utc : utc - TAIPEI_OFFSET_MS;
}

function property(block: string, name: string): { params: string; value: string } | null {
  const match = new RegExp(`^${name}((?:;[^:\\r\\n]*)*):(.*)$`, 'm').exec(block);
  return match ? { params: match[1] || '', value: (match[2] || '').trim() } : null;
}

/** 只回傳「對應表裡有的人」的請假區段；公出不算請假，被取消的假單不算。 */
export function parseFemasIcal(ics: string, nameMap: Record<string, string>): FemasLeave[] {
  const unfolded = String(ics || '').replace(/\r\n/g, '\n').replace(/\n[ \t]/g, '');
  const leaves: FemasLeave[] = [];
  for (const match of unfolded.matchAll(/BEGIN:VEVENT([\s\S]*?)END:VEVENT/g)) {
    const block = match[1] || '';
    const status = property(block, 'STATUS')?.value.toUpperCase() || '';
    if (status === 'CANCELLED') continue;
    const summary = property(block, 'SUMMARY')?.value || '';
    const cleaned = summary.replace(/^[(（]\s*待批示\s*[)）]\s*/, '').trim();
    const sep = cleaned.search(/[-－]/);
    if (sep <= 0) continue;
    const name = cleaned.slice(0, sep).trim();
    const kind = cleaned.slice(sep + 1).trim();
    const who = nameMap[name];
    if (!who || /公出/.test(kind)) continue;
    const startProp = property(block, 'DTSTART'), endProp = property(block, 'DTEND');
    if (!startProp) continue;
    const startDateOnly = /VALUE=DATE(?!-)/.test(startProp.params);
    const start = parseIcalTime(startProp.value, startDateOnly);
    let end = endProp ? parseIcalTime(endProp.value, /VALUE=DATE(?!-)/.test(endProp.params)) : NaN;
    // 整天事件（只有日期）的 DTEND 依規格不含當天；沒有 DTEND 就當一整天。
    if (!Number.isFinite(end)) end = start + (startDateOnly ? 24 * 60 * 60 * 1000 : 60 * 60 * 1000);
    if (!Number.isFinite(start) || end <= start) continue;
    leaves.push({ who, start, end });
  }
  return leaves;
}

export function femasOnLeave(leaves: FemasLeave[], nowMs: number): Set<string> {
  return new Set(leaves.filter(item => item.start <= nowMs && nowMs < item.end).map(item => item.who));
}

export function parseFemasNameMap(raw: unknown): Record<string, string> {
  try {
    const parsed = JSON.parse(String(raw || '{}')) as unknown;
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return {};
    const out: Record<string, string> = {};
    for (const [key, value] of Object.entries(parsed as Record<string, unknown>)) {
      if (typeof value === 'string' && key.trim() && value.trim()) out[key.trim()] = value.trim();
    }
    return out;
  } catch {
    return {};
  }
}

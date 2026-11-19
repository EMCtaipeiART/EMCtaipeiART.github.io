/**
 * 小黃讀取行事曆：①值日生輪值與雙週會日期 ②設計部五位設計師的行事曆（會議、請假、出差；Google 行事曆＋人資假單）。
 * 行事曆內容是公開的（使用者確認），所以不做設計部限定的權限檢查，任何登入者問都可以回答。
 * 資料來自 Durable Object 內既有的 designCalendar 邏輯（由 coordinator 以 deps 傳入），這裡只負責整理成適合模型閱讀的格式。
 * 只讀；活動標題照行事曆顯示（私人活動 Google 本來就只顯示「忙碌」）。
 */
import { dutyMeetings } from './duty';
import type { Row } from './types';
const taipeiDay = (ms: number): string => { const t = new Date(ms + 8 * 3600000); return `${t.getUTCFullYear()}-${String(t.getUTCMonth() + 1).padStart(2, '0')}-${String(t.getUTCDate()).padStart(2, '0')}`; };

export interface CalendarDeps {
  /** 取得區間內設計師行事曆事件（from/to 為 YYYY-MM-DD，台北時間，最多 70 天） */
  calendar?: (from: string, to: string) => Promise<{ events: Row[]; unreadable: string[] }>;
  /** 某月實際的值日生（含手動替換） */
  dutyWho?: (year: number, month0: number) => Promise<string>;
  /** 有行事曆的設計師名字 */
  calendarOwners?: string[];
}

const DAY_MS = 86400000;
export const CALENDAR_MAX_DAYS = 31;
const EVENT_LIMIT = 40;

const ymd = (value: unknown): string | null => {
  const m = String(value ?? '').trim().match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/);
  return m ? `${m[1]}-${m[2].padStart(2, '0')}-${m[3].padStart(2, '0')}` : null;
};
const addDays = (day: string, n: number): string => taipeiDay(Date.parse(day + 'T00:00:00Z') - 8 * 3600000 + n * DAY_MS + 8 * 3600000);
const hhmm = (ms: number): string => {
  const t = new Date(ms + 8 * 3600000);
  return `${String(t.getUTCMonth() + 1).padStart(2, '0')}/${String(t.getUTCDate()).padStart(2, '0')} ${String(t.getUTCHours()).padStart(2, '0')}:${String(t.getUTCMinutes()).padStart(2, '0')}`;
};
const mdOnly = (ms: number): string => hhmm(ms).slice(0, 5);

/** getDuty：值日生輪值（預設從本月起 3 個月）與每月兩場雙週會日期。 */
export async function getDutyTool(args: Row, deps: CalendarDeps, nowMs: number): Promise<Row> {
  if (!deps.dutyWho) return { found: 0, hint: '目前讀不到值日生資料' };
  const base = new Date(nowMs + 8 * 3600000);
  let year = Math.floor(Number(args.year)) || base.getUTCFullYear();
  let month0 = Number(args.month) >= 1 && Number(args.month) <= 12 ? Math.floor(Number(args.month)) - 1 : (Number(args.year) ? 0 : base.getUTCMonth());
  const count = Math.min(12, Math.max(1, Math.floor(Number(args.months)) || (args.month ? 1 : 3)));
  const months: Row[] = [];
  for (let i = 0; i < count; i += 1) {
    months.push({
      月份: `${year}-${String(month0 + 1).padStart(2, '0')}`,
      值日生: await deps.dutyWho(year, month0),
      雙週會: dutyMeetings(year, month0).map(m => ({ 日期: m.date, 標題: m.title, 時間: '14:00–15:00', 會議室: '會議室 H' }))
    });
    month0 += 1; if (month0 > 11) { month0 = 0; year += 1; }
  }
  return { found: months.length, 說明: '值日生每月一位，照 Leona→Anna→Machi→Noise→Amber 輪替，可能有手動替換（已反映在這裡）。', months };
}

/** getCalendar：設計師行事曆。預設今天起 7 天；who 可填設計師名字或 me。 */
export async function getCalendarTool(args: Row, deps: CalendarDeps, nowMs: number, me: string[]): Promise<Row> {
  if (!deps.calendar) return { found: 0, hint: '目前讀不到行事曆' };
  const today = taipeiDay(nowMs);
  let from = ymd(args.from) || today;
  let to = ymd(args.to) || addDays(from, Math.min(CALENDAR_MAX_DAYS, Math.max(1, Math.floor(Number(args.days)) || 7)) - 1);
  if (to < from) [from, to] = [to, from];
  const span = (Date.parse(to + 'T00:00:00Z') - Date.parse(from + 'T00:00:00Z')) / DAY_MS + 1;
  if (span > CALENDAR_MAX_DAYS) to = addDays(from, CALENDAR_MAX_DAYS - 1);

  const owners = deps.calendarOwners || [];
  let who = String(args.who ?? '').trim();
  if (who.toLowerCase() === 'me' || who === '我') {
    const mine = owners.find(o => me.some(n => n.toLowerCase() === o.toLowerCase()));
    if (!mine) return { found: 0, hint: '你不在設計部五位設計師的行事曆名單內，我只能查設計師的行事曆；可以改問某位設計師，或問值日生。', 有行事曆的人: owners };
    who = mine;
  } else if (who) {
    const hit = owners.find(o => o.toLowerCase() === who.toLowerCase());
    if (!hit) return { found: 0, hint: `行事曆名單裡沒有「${who}」，只有：${owners.join('、')}`, 有行事曆的人: owners };
    who = hit;
  }
  const kind = String(args.kind ?? '');

  const { events, unreadable } = await deps.calendar(from, to);
  const picked = events
    .filter(e => !who || String(e.who) === who)
    .filter(e => kind === 'leave' ? e.kind === 'leave' : kind === 'meeting' ? e.kind !== 'leave' : true);
  const list = picked.slice(0, EVENT_LIMIT).map(e => ({
    誰: String(e.who ?? ''), 標題: String(e.title ?? ''), 類型: e.kind === 'leave' ? '請假／出差' : '會議／行程',
    開始: e.allDay ? mdOnly(Number(e.start)) + '（全天）' : hhmm(Number(e.start)),
    結束: e.allDay ? mdOnly(Number(e.end) - 1) : hhmm(Number(e.end)),
    會議室: e.room ? String(e.room) : undefined
  }));
  return {
    found: picked.length, 範圍: `${from} ～ ${to}`, 查詢對象: who || '設計部五位設計師', events: list,
    說明: picked.length > EVENT_LIMIT ? `共 ${picked.length} 筆，只列前 ${EVENT_LIMIT} 筆；可以縮小日期範圍或指定某位設計師。` : undefined,
    部分讀不到: unreadable.length ? `這幾位的 Google 行事曆暫時讀不到：${unreadable.join('、')}（只剩人資假單可用）` : undefined,
    hint: picked.length ? undefined : '這段期間沒有符合的行程'
  };
}

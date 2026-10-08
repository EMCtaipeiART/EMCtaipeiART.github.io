/**
 * 值日生輪值與雙週會自動預約。
 * 值日生每月一位（Leona → Anna → Machi → Noise → Amber 循環，2026 年 10 月是 Leona）。
 * 每月 1 號起，後端用「值日生自己的 Google 連線」在他的行事曆建立兩場會議（第 2、第 4 個星期三 14:00–15:00），
 * 邀請會議室 H（meetingroomh.emc@gmail.com）與 ERIC、MACHI、ANNA、NOISE、AMBER、LEONA 六人。
 */
export const DUTY_ORDER = ['Leona', 'Anna', 'Machi', 'Noise', 'Amber'] as const;
const DUTY_BASE = 2026 * 12 + 9;
export const DUTY_ROOM_EMAIL = 'meetingroomh.emc@gmail.com';
export const DUTY_ROOM_NAME = '會議室 H';
/** 必須 TAG 的六位（順序照需求）；ERIC 是 傅思凱（設定表以帳號辨識），其餘依「設定」表的名字找帳號 */
export const DUTY_ATTENDEES = ['ERIC', 'MACHI', 'ANNA', 'NOISE', 'AMBER', 'LEONA'] as const;
export const DUTY_ERIC_EMAIL = 'eric.fu@emctaipei.com';

export const dutyOf = (year: number, month0: number): (typeof DUTY_ORDER)[number] =>
  DUTY_ORDER[(((year * 12 + month0 - DUTY_BASE) % 5) + 5) % 5];

const pad = (n: number): string => String(n).padStart(2, '0');

/** 第 n 個星期三（回傳 YYYY-MM-DD） */
export function nthWednesday(year: number, month0: number, n: number): string {
  const firstDow = new Date(Date.UTC(year, month0, 1)).getUTCDay();
  const day = 1 + ((3 - firstDow + 7) % 7) + (n - 1) * 7;
  return `${year}-${pad(month0 + 1)}-${pad(day)}`;
}

export interface DutyMeeting { part: '上' | '下'; date: string; title: string }

export function dutyMeetings(year: number, month0: number): DutyMeeting[] {
  const m = month0 + 1;
  return [
    { part: '上', date: nthWednesday(year, month0, 2), title: `【設計部雙週會】${m}月上_案例分享` },
    { part: '下', date: nthWednesday(year, month0, 4), title: `【設計部雙週會】${m}月下_案例分享` }
  ];
}

/** Google Calendar events.insert 的內容（台北時間 14:00–15:00，台灣沒有日光節約，固定 +08:00） */
export function dutyEventBody(meeting: DutyMeeting, who: string, attendeeEmails: string[]): Record<string, unknown> {
  return {
    summary: meeting.title,
    location: DUTY_ROOM_NAME,
    description: `由設計需求系統依值日生輪值自動建立（${meeting.date.slice(5, 7).replace(/^0/, '')} 月值日生：${who}）。已邀請${DUTY_ROOM_NAME}與設計部成員。`,
    start: { dateTime: `${meeting.date}T14:00:00+08:00`, timeZone: 'Asia/Taipei' },
    end: { dateTime: `${meeting.date}T15:00:00+08:00`, timeZone: 'Asia/Taipei' },
    attendees: [
      ...attendeeEmails.map(email => ({ email })),
      { email: DUTY_ROOM_EMAIL, displayName: DUTY_ROOM_NAME, resource: true }
    ],
    reminders: { useDefault: true }
  };
}

export function dutyMonthKey(year: number, month0: number): string { return `${year}-${pad(month0 + 1)}`; }

/** 手動替換記錄：月份 → 換成誰、誰換的、什麼時候 */
export interface DutyOverride { who: string; by: string; at: number }
export type DutyOverrides = Record<string, DutyOverride>;
export const isDutyName = (name: string): boolean => (DUTY_ORDER as readonly string[]).includes(name);

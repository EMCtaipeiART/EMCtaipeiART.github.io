import { describe, expect, it } from 'vitest';
import { emptyDatabase } from '../../backend/schema.mjs';
import { ASSISTANT_SYSTEM_PROMPT, assistantChat, type AssistantStore } from '../src/assistant';
import { getCalendarTool, getDutyTool, type CalendarDeps } from '../src/assistant-calendar';
import type { DatabaseSnapshot, Row, SessionRecord } from '../src/types';

function memoryStore(): AssistantStore {
  const data = new Map<string, unknown>();
  return {
    async get<T>(key: string) { return data.get(key) as T | undefined; },
    async put(key: string, value: unknown) { data.set(key, JSON.parse(JSON.stringify(value))); },
    async delete(keys: string | string[]) { for (const k of Array.isArray(keys) ? keys : [keys]) data.delete(k); },
    async list<T>(options?: { prefix?: string }) { return new Map([...data].filter(([k]) => k.startsWith(options?.prefix || '')) as [string, T][]); }
  };
}

const NOW = Date.parse('2026-11-18T04:00:00Z'); // 台灣 2026-11-18（週三）12:00
const tw = (iso: string) => Date.parse(iso + '+08:00');
const events: Row[] = [
  { who: 'Anna', title: '客戶提案會議', start: tw('2026-11-18T14:00:00'), end: tw('2026-11-18T15:30:00'), allDay: false, kind: 'event', room: 'A' },
  { who: 'Anna', title: '特休', start: tw('2026-11-20T00:00:00'), end: tw('2026-11-21T00:00:00'), allDay: true, kind: 'leave' },
  { who: 'Machi', title: '設計部雙週會', start: tw('2026-11-25T14:00:00'), end: tw('2026-11-25T15:00:00'), allDay: false, kind: 'event', room: 'H' },
  { who: 'Noise', title: '忙碌', start: tw('2026-11-19T10:00:00'), end: tw('2026-11-19T11:00:00'), allDay: false, kind: 'event' }
];
const asked: Array<[string, string]> = [];
const deps = (over: Partial<CalendarDeps> = {}): CalendarDeps => ({
  calendar: async (from, to) => { asked.push([from, to]); return { events: events.filter(e => Number(e.end) > tw(from + 'T00:00:00') && Number(e.start) < tw(to + 'T00:00:00') + 86400000), unreadable: [] }; },
  dutyWho: async (year, month0) => (year === 2026 && month0 === 11 ? 'Machi' : ['Leona', 'Anna', 'Machi', 'Noise', 'Amber'][(((year * 12 + month0 - (2026 * 12 + 9)) % 5) + 5) % 5]),
  calendarOwners: ['Machi', 'Anna', 'Amber', 'Leona', 'Noise'],
  ...over
});

describe('小黃讀行事曆：值日生', () => {
  it('lists three months by default with the manual override applied and the two biweekly meetings per month', async () => {
    const out = await getDutyTool({}, deps(), NOW) as { months: Array<{ 月份: string; 值日生: string; 雙週會: Array<{ 日期: string; 標題: string }> }> };
    expect(out.months.map(m => m.月份)).toEqual(['2026-11', '2026-12', '2027-01']);
    expect(out.months[0].值日生).toBe('Anna'); // 照輪值表：10 月 Leona，11 月 Anna
  });

  it('answers a specific month, rolls over the year and applies overrides', async () => {
    const dec = await getDutyTool({ year: 2026, month: 12, months: 1 }, deps(), NOW) as { months: Array<{ 值日生: string; 雙週會: Array<{ 日期: string }> }> };
    expect(dec.months).toHaveLength(1);
    expect(dec.months[0].值日生).toBe('Machi'); // 測試用的替換
    expect(dec.months[0].雙週會.map(m => m.日期)).toEqual(['2026-12-09', '2026-12-23']);
    const roll = await getDutyTool({ year: 2026, month: 12, months: 2 }, deps(), NOW) as { months: Array<{ 月份: string }> };
    expect(roll.months.map(m => m.月份)).toEqual(['2026-12', '2027-01']);
    expect(await getDutyTool({}, { calendarOwners: [] }, NOW)).toMatchObject({ found: 0 });
  });
});

describe('小黃讀行事曆：設計師行事曆', () => {
  it('defaults to today + 7 days in Taipei time and formats events', async () => {
    asked.length = 0;
    const out = await getCalendarTool({}, deps(), NOW, ['Anna']) as { found: number; 範圍: string; events: Array<{ 誰: string; 開始: string; 結束: string; 類型: string; 會議室?: string }> };
    expect(asked[0]).toEqual(['2026-11-18', '2026-11-24']);
    expect(out.範圍).toBe('2026-11-18 ～ 2026-11-24');
    expect(out.events[0]).toMatchObject({ 誰: 'Anna', 開始: '11/18 14:00', 結束: '11/18 15:30', 類型: '會議／行程', 會議室: 'A' });
    const leave = out.events.find(e => e.類型 === '請假／出差');
    expect(leave).toMatchObject({ 誰: 'Anna', 開始: '11/20（全天）', 結束: '11/20' });
  });

  it('filters by person, by kind and resolves me; anyone can ask about anyone (public calendar)', async () => {
    const annaLeave = await getCalendarTool({ who: 'anna', kind: 'leave', days: 14 }, deps(), NOW, ['Pm']) as { found: number; events: Array<{ 誰: string }>; 查詢對象: string };
    expect(annaLeave).toMatchObject({ found: 1, 查詢對象: 'Anna' });
    const me = await getCalendarTool({ who: 'me', days: 14 }, deps(), NOW, ['Machi']) as { events: Array<{ 誰: string }> };
    expect(me.events.map(e => e.誰)).toEqual(['Machi']);
    const meetings = await getCalendarTool({ kind: 'meeting', days: 14 }, deps(), NOW, []) as { found: number };
    expect(meetings.found).toBe(3);
  });

  it('says clearly when the asker has no calendar, the person is unknown, or nothing matches', async () => {
    const noMine = await getCalendarTool({ who: 'me' }, deps(), NOW, ['Pm專案部']) as { found: number; hint: string };
    expect(noMine.found).toBe(0);
    expect(noMine.hint).toContain('不在設計部');
    const unknown = await getCalendarTool({ who: '路人甲' }, deps(), NOW, []) as { hint: string };
    expect(unknown.hint).toContain('沒有「路人甲」');
    const none = await getCalendarTool({ from: '2026-12-30', days: 2 }, deps(), NOW, []) as { found: number; hint: string };
    expect(none).toMatchObject({ found: 0, hint: '這段期間沒有符合的行程' });
  });

  it('caps the range at 31 days, swaps reversed dates and reports calendars that could not be read', async () => {
    asked.length = 0;
    await getCalendarTool({ from: '2026-11-01', to: '2027-03-01' }, deps(), NOW, []);
    expect(asked[0]).toEqual(['2026-11-01', '2026-12-01']);
    asked.length = 0;
    await getCalendarTool({ from: '2026-11-10', to: '2026-11-05' }, deps(), NOW, []);
    expect(asked[0]).toEqual(['2026-11-05', '2026-11-10']);
    const partial = await getCalendarTool({}, deps({ calendar: async () => ({ events: [], unreadable: ['Leona'] }) }), NOW, []) as { 部分讀不到: string };
    expect(partial.部分讀不到).toContain('Leona');
    expect(await getCalendarTool({}, { calendarOwners: [] }, NOW, [])).toMatchObject({ found: 0 });
  });

  it('is wired into the chat loop and the prompt', async () => {
    let round = 0;
    const database = emptyDatabase() as DatabaseSnapshot;
    const session: SessionRecord = { user: 'Pm', account: 'pm@emctaipei.com', provider: 'password', expiresAt: 0 };
    const fetchImpl = (async (_u: unknown, init: RequestInit) => {
      round += 1;
      const body = JSON.parse(String(init.body));
      if (round === 1) return Response.json({ content: [{ type: 'tool_use', id: 'c', name: 'getCalendar', input: { who: 'Anna', kind: 'leave', days: 14 } }], stop_reason: 'tool_use', usage: { input_tokens: 5, output_tokens: 1 } });
      expect(JSON.stringify(body.messages.at(-1).content[0])).toContain('11/20（全天）');
      return Response.json({ content: [{ type: 'text', text: 'Anna 11/20 特休' }], stop_reason: 'end_turn', usage: { input_tokens: 5, output_tokens: 3 } });
    }) as typeof fetch;
    const out = await assistantChat({ message: 'Anna 這週有請假嗎' }, database, session, memoryStore(), { apiKey: 'k', now: () => NOW, fetchImpl, ...deps() });
    expect(out.reply).toBe('Anna 11/20 特休');
    expect(ASSISTANT_SYSTEM_PROMPT).toContain('getCalendar');
    expect(ASSISTANT_SYSTEM_PROMPT).toContain('getDuty');
    expect(ASSISTANT_SYSTEM_PROMPT).toContain('行事曆資料是公開的');
  });
});

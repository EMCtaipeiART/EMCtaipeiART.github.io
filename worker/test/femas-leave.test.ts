import { describe, expect, it } from 'vitest';
import { femasOnLeave, parseFemasIcal, parseFemasNameMap } from '../src/femas-leave';

const ics = (events: string[]) => `BEGIN:VCALENDAR\r\nVERSION:2.0\r\n${events.map(e => `BEGIN:VEVENT\r\n${e}\r\nEND:VEVENT`).join('\r\n')}\r\nEND:VCALENDAR`;
const map = { 王小明: 'Noise', 李小華: 'Leona' };
const at = (iso: string) => Date.parse(iso);

describe('Femas HR iCal leave parsing', () => {
  it('treats timed events as Taipei time and finds who is on leave now', () => {
    const leaves = parseFemasIcal(ics(['DTSTART:20261005T090000\r\nDTEND:20261006T180000\r\nSUMMARY:王小明-事假']), map);
    expect(leaves).toHaveLength(1);
    expect([...femasOnLeave(leaves, at('2026-10-05T10:00:00+08:00'))]).toEqual(['Noise']);
    expect([...femasOnLeave(leaves, at('2026-10-06T17:59:00+08:00'))]).toEqual(['Noise']);
    expect(femasOnLeave(leaves, at('2026-10-06T18:00:00+08:00')).size).toBe(0);
    expect(femasOnLeave(leaves, at('2026-10-05T08:59:00+08:00')).size).toBe(0);
  });

  it('counts pending-approval leave, ignores 公出, cancelled events and people who are not mapped', () => {
    const leaves = parseFemasIcal(ics([
      'DTSTART:20261005T090000\r\nDTEND:20261005T180000\r\nSUMMARY:(待批示)李小華-特別休假',
      'DTSTART:20261005T090000\r\nDTEND:20261005T180000\r\nSUMMARY:王小明-公出',
      'DTSTART:20261005T090000\r\nDTEND:20261005T180000\r\nSTATUS:CANCELLED\r\nSUMMARY:王小明-事假',
      'DTSTART:20261005T090000\r\nDTEND:20261005T180000\r\nSUMMARY:路人甲-事假'
    ]), map);
    expect(leaves.map(l => l.who)).toEqual(['Leona']);
  });

  it('handles all-day events (exclusive DTEND), unfolded lines and hourly 補休', () => {
    const leaves = parseFemasIcal(ics([
      'DTSTART;VALUE=DATE:20261012\r\nDTEND;VALUE=DATE:20261014\r\nSUMMARY:王小明-特別\r\n 休假',
      'DTSTART:20261005T100000\r\nDTEND:20261005T110000\r\nSUMMARY:李小華-加班補休'
    ]), map);
    expect(femasOnLeave(leaves, at('2026-10-13T12:00:00+08:00')).has('Noise')).toBe(true);
    expect(femasOnLeave(leaves, at('2026-10-14T00:00:00+08:00')).has('Noise')).toBe(false);
    expect(femasOnLeave(leaves, at('2026-10-05T10:30:00+08:00')).has('Leona')).toBe(true);
    expect(femasOnLeave(leaves, at('2026-10-05T11:00:00+08:00')).has('Leona')).toBe(false);
  });

  it('parses the name map secret defensively', () => {
    expect(parseFemasNameMap('{"王小明":"Noise"}')).toEqual({ 王小明: 'Noise' });
    expect(parseFemasNameMap('not json')).toEqual({});
    expect(parseFemasNameMap('[1]')).toEqual({});
  });
});

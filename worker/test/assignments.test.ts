import { describe, expect, it } from 'vitest';
import { parseAssignments } from '../src/assignments';

describe('assignments parser', () => {
  it('reads designer blocks with team, client, monthly and note', () => {
    const rows = [
      ['', '', '', '**說明'],
      ['Machi', '專案所屬', '客戶', 'FB', '每月維運', '備註'],
      ['', 'Odin/Allen', 'DJI', '', '社群 ｜ 4-6 篇', ''],
      ['Anna', '專案所屬', '客戶', 'FB', '每月維運', '備註'],
      ['', 'Celine', 'BTL', '', '3篇', '停擺'],
      ['', '', '', '', '', '']
    ];
    expect(parseAssignments(rows)).toEqual([
      { designer: 'Machi', team: 'Odin/Allen', client: 'DJI', monthly: '社群 ｜ 4-6 篇', note: '' },
      { designer: 'Anna', team: 'Celine', client: 'BTL', monthly: '3篇', note: '停擺' }
    ]);
  });
});

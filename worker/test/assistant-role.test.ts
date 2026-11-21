import { describe, expect, it } from 'vitest';
import { roleLine, roleOf, ROLE_TIPS } from '../src/assistant-role';
import type { DatabaseSnapshot, SessionRecord } from '../src/types';

const db = (rows: Array<Record<string, string>>) => ({ tables: { 設定: { headers: ['帳號', '部門', '組別'], rows } } }) as unknown as DatabaseSnapshot;
const sess = (user: string, account: string, department = '') => ({ user, account, department }) as unknown as SessionRecord;

describe('小黃依角色調整', () => {
  it('依部門判斷角色並產生提示', () => {
    const d = db([
      { 帳號: 'd@emctaipei.com', 部門: '設計部', 組別: '平面' },
      { 帳號: 'p@emctaipei.com', 部門: '企劃部', 組別: '' },
      { 帳號: 'j@emctaipei.com', 部門: '凱曜專案部', 組別: '' }
    ]);
    expect(roleOf(d, sess('小設', 'd@emctaipei.com')).key).toBe('design');
    expect(roleOf(d, sess('小企', 'p@emctaipei.com')).key).toBe('planning');
    expect(roleOf(d, sess('小專', 'j@emctaipei.com')).key).toBe('project');
    expect(roleOf(d, sess('Machi', 'x@emctaipei.com')).key).toBe('manager');
    expect(roleLine(roleOf(d, sess('小企', 'p@emctaipei.com')))).toContain('企劃部');
    expect(ROLE_TIPS.design.length).toBeGreaterThan(0);
  });
});

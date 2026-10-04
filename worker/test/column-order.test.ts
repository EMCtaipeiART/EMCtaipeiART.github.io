import { describe, expect, it } from 'vitest';
import { settingsResponse, updateSettingsRow } from '../src/model';

describe('專案欄位順序 setting', () => {
  it('stores only known statuses, de-duplicated, and returns them', () => {
    const row: Record<string, unknown> = { 名字: 'Anna' };
    updateSettingsRow(row, { columnOrder: ['修改中', '未開始', '亂寫', '修改中', '已完成'] });
    expect(row['專案欄位順序']).toBe('修改中 , 未開始 , 已完成');
    expect(settingsResponse(row).columnOrder).toBe('修改中 , 未開始 , 已完成');
  });

  it('is untouched when the key is absent', () => {
    const row: Record<string, unknown> = { 名字: 'Anna', 專案欄位順序: '執行中' };
    updateSettingsRow(row, { filters: { month: ['2026-10'] } });
    expect(row['專案欄位順序']).toBe('執行中');
  });
});

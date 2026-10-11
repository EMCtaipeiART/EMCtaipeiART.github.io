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

describe('首頁背景 setting', () => {
  it('keeps a valid three-color value and clears anything else', () => {
    const row: Record<string, unknown> = { 名字: 'Anna' };
    updateSettingsRow(row, { heroBg: '#2BBF4C|#0f8f61|#0a5a3d' });
    expect(row['首頁背景']).toBe('#2bbf4c|#0f8f61|#0a5a3d');
    expect(settingsResponse(row).heroBg).toBe('#2bbf4c|#0f8f61|#0a5a3d');
    updateSettingsRow(row, { heroBg: 'red|blue' });
    expect(row['首頁背景']).toBe('');
  });
});

describe('首頁背景 setting strictness', () => {
  it('rejects values with extra text around the three colors', () => {
    const row: Record<string, unknown> = { 名字: 'Anna' };
    updateSettingsRow(row, { heroBg: '#112233 evil|#445566|#778899' });
    expect(row['首頁背景']).toBe('');
    updateSettingsRow(row, { heroBg: '#112233|#445566|#778899x' });
    expect(row['首頁背景']).toBe('');
  });
});

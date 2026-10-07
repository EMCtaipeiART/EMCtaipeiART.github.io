import { describe, expect, it } from 'vitest';
import { normalizeNicknameMapValue, settingsResponse, updateSettingsRow } from '../src/model';

describe('稱呼對照 setting', () => {
  it('stores trimmed {name,nickname} pairs, dropping blanks, no-ops and duplicate names', () => {
    const row: Record<string, unknown> = { 名字: 'Anna' };
    updateSettingsRow(row, { nicknameMap: [
      { name: ' Lorraine  Luo ', nickname: 'Lorraine' },
      { name: 'lorraine luo', nickname: 'Lo' },
      { name: 'Andrew Koo', nickname: 'Andrew Koo' },
      { name: '', nickname: 'x' },
      { name: '吳冠賢', nickname: '' },
      { name: '廖秦葦', nickname: '小葦' }
    ] });
    expect(JSON.parse(String(row['稱呼對照']))).toEqual([
      { name: 'Lorraine Luo', nickname: 'Lorraine' },
      { name: '廖秦葦', nickname: '小葦' }
    ]);
    expect(settingsResponse(row).nicknameMap).toEqual([
      { name: 'Lorraine Luo', nickname: 'Lorraine' },
      { name: '廖秦葦', nickname: '小葦' }
    ]);
  });

  it('is untouched when the key is absent, can be cleared, and tolerates garbage', () => {
    const row: Record<string, unknown> = { 名字: 'Anna', 稱呼對照: '[{"name":"A B","nickname":"AB"}]' };
    updateSettingsRow(row, { filters: { month: ['2026-10'] } });
    expect(row['稱呼對照']).toBe('[{"name":"A B","nickname":"AB"}]');
    updateSettingsRow(row, { nicknameMap: [] });
    expect(row['稱呼對照']).toBe('[]');
    expect(normalizeNicknameMapValue('not json')).toEqual([]);
    expect(normalizeNicknameMapValue(undefined)).toEqual([]);
  });

  it('caps entries at 200 and each field at 40 characters', () => {
    const many = Array.from({ length: 250 }, (_, i) => ({ name: `Person ${i}`, nickname: `P${i}` }));
    expect(normalizeNicknameMapValue(many)).toHaveLength(200);
    expect(normalizeNicknameMapValue([{ name: 'x'.repeat(41), nickname: 'y' }])).toEqual([]);
  });
});

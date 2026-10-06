import { describe, expect, it } from 'vitest';
import { normalizeCaseStatuses } from '../src/model';
import type { DatabaseSnapshot } from '../src/types';

const snap = (statuses: string[]): DatabaseSnapshot => ({
  revision: 1,
  updatedAt: '',
  tables: { database: { headers: [], primaryKey: null, rows: statuses.map((s, i) => ({ '案件編號': String(i + 1), '狀態': s })) } },
  internal: { sessions: {}, idempotency: {} }
} as unknown as DatabaseSnapshot);

describe('「已取消」併入「暫停中」', () => {
  it('rewrites every 已取消 case to 暫停中 and leaves other statuses alone', () => {
    const db = snap(['已取消', '執行中', '已取消', '暫停中', '已完成']);
    expect(normalizeCaseStatuses(db)).toBe(2);
    expect(db.tables.database.rows.map(r => r['狀態'])).toEqual(['暫停中', '執行中', '暫停中', '暫停中', '已完成']);
    expect(normalizeCaseStatuses(db)).toBe(0);
  });
});

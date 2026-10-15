import { describe, expect, it } from 'vitest';
import { isQuietHours } from '../src/database-coordinator';

// 夜間減量時段：台北時間 20:00 ～ 隔天 08:00（Durable Objects 免費額度 08:00 重置）。
const taipei = (iso: string) => Date.parse(`${iso}+08:00`);

describe('isQuietHours', () => {
  it('is quiet from 20:00 until 07:59 Taipei time', () => {
    for (const t of ['2026-10-15T20:00:00', '2026-10-15T23:59:59', '2026-10-16T00:00:00', '2026-10-16T07:59:59']) expect(isQuietHours(taipei(t))).toBe(true);
  });
  it('is normal from 08:00 until 19:59 Taipei time', () => {
    for (const t of ['2026-10-16T08:00:00', '2026-10-16T12:00:00', '2026-10-16T19:59:59']) expect(isQuietHours(taipei(t))).toBe(false);
  });
});

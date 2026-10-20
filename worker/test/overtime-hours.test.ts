import { describe, expect, it } from 'vitest';
import { PIXEL_HOURS_DEFAULT, pixelOfficeWorkStatus, setPixelHours } from '../src/database-coordinator';

// 台北時間某個平日（2026-10-20 週二）的整點 → UTC 毫秒
const at = (hour: number) => Date.parse(`2026-10-20T${String(hour).padStart(2, '0')}:30:00+08:00`);

describe('加班（遮罩）固定 19:00～隔天 06:00', () => {
  it('上班開始設成 8 點也不影響：06:00～19:00 在座，19:00 之後與 06:00 以前才是加班', () => {
    setPixelHours({ ...PIXEL_HOURS_DEFAULT, dayStart: 8, overtimeStart: 19, workEnd: 19 });
    expect(pixelOfficeWorkStatus(at(5))).toBe('overtime');
    expect(pixelOfficeWorkStatus(at(6))).toBe('present');
    expect(pixelOfficeWorkStatus(at(7))).toBe('present');
    expect(pixelOfficeWorkStatus(at(18))).toBe('present');
    expect(pixelOfficeWorkStatus(at(19))).toBe('overtime');
    expect(pixelOfficeWorkStatus(at(23))).toBe('overtime');
    setPixelHours(null);
  });
});

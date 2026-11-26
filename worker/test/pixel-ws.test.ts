import { describe, expect, it } from 'vitest';
import { parseMove, sessionMatchesName, parseDance } from '../src/pixel-ws';

describe('pixel ws', () => {
  it('matches account to character name', () => {
    expect(sessionMatchesName({ user: 'Anna' }, 'anna')).toBe(true);
    expect(sessionMatchesName({ account: 'anna@gmail.com' }, 'Anna')).toBe(true);
    expect(sessionMatchesName({ user: 'Leona' }, 'Anna')).toBe(false);
    expect(sessionMatchesName(null, 'Anna')).toBe(false);
  });
  it('validates move messages', () => {
    expect(parseMove({ t: 'p', fx: 100.4, fy: 200, d: 'left' })).toEqual({ fx: 100, fy: 200, d: 'left' });
    expect(parseMove({ t: 'p', fx: 'x', fy: 1 })).toBeNull();
    expect(parseMove({ t: 'p', fx: 99999, fy: 1 })).toBeNull();
    expect(parseMove({ t: 'q', fx: 1, fy: 1 })).toBeNull();
    expect(parseMove({ t: 'p', fx: 1, fy: 1, d: 'zz' })?.d).toBe('');
  });
});

describe('跳舞訊息', () => {
  it('只接受開始／停止，拍子收斂到合理範圍', () => {
    expect(parseDance({ t: 'dance', on: true, beat: 3.456 })).toEqual({ on: true, beat: 3.46 });
    expect(parseDance({ t: 'dance', on: false })).toEqual({ on: false, beat: 0 });
    expect(parseDance({ t: 'dance', on: true, beat: -1 })).toEqual({ on: true, beat: 0 });
    expect(parseDance({ t: 'dance', on: 'yes' })).toBeNull();
    expect(parseDance({ t: 'p', on: true })).toBeNull();
  });
});

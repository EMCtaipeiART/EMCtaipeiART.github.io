import { describe, expect, it } from 'vitest';
import { parseMove, sessionMatchesName } from '../src/pixel-ws';

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

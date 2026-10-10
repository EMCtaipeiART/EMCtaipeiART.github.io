import { describe, expect, it } from 'vitest';
import { importBoxKey, isSealed, openText, sealText } from '../src/secure-box';

const KEY = btoa(String.fromCharCode(...Array.from({ length: 32 }, (_, i) => i + 1)));

describe('secure box', () => {
  it('round-trips text and never stores it readable', async () => {
    const key = (await importBoxKey(KEY))!;
    const sealed = await sealText(key, '[{"label":"密碼","value":"s3cret","secret":true}]');
    expect(isSealed(sealed)).toBe(true);
    expect(sealed).not.toContain('s3cret');
    expect(await openText(key, sealed)).toContain('s3cret');
  });

  it('uses a fresh IV each time and rejects the wrong key', async () => {
    const key = (await importBoxKey(KEY))!;
    expect(await sealText(key, 'x')).not.toBe(await sealText(key, 'x'));
    const other = (await importBoxKey(btoa(String.fromCharCode(...Array.from({ length: 32 }, () => 7)))))!;
    await expect(openText(other, await sealText(key, 'x'))).rejects.toThrow();
  });

  it('returns null without a key and refuses a wrong-sized key', async () => {
    expect(await importBoxKey('')).toBeNull();
    await expect(importBoxKey(btoa('short'))).rejects.toThrow();
  });
});

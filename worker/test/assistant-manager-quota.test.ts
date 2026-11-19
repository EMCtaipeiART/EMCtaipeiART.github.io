import { describe, expect, it } from 'vitest';
import { emptyDatabase } from '../../backend/schema.mjs';
import { ASSISTANT_DAILY_TOKENS, LOW_BATTERY_LINE, assistantChat, assistantToday, taipeiDay, usageKey, type AssistantStore } from '../src/assistant';
import type { DatabaseSnapshot, SessionRecord } from '../src/types';

function memoryStore(): AssistantStore & { data: Map<string, unknown> } {
  const data = new Map<string, unknown>();
  return {
    data,
    async get<T>(key: string) { return data.get(key) as T | undefined; },
    async put(key: string, value: unknown) { data.set(key, JSON.parse(JSON.stringify(value))); },
    async delete(keys: string | string[]) { for (const k of Array.isArray(keys) ? keys : [keys]) data.delete(k); },
    async list<T>(options?: { prefix?: string }) { return new Map([...data].filter(([k]) => k.startsWith(options?.prefix || '')) as [string, T][]); }
  };
}

const NOW = Date.parse('2026-11-18T04:00:00Z');
const db = (): DatabaseSnapshot => {
  const d = emptyDatabase() as DatabaseSnapshot;
  d.tables['設定'].rows.push({ 部門: '管理者', 組別: '管理者', 名字: 'Boss', 顯示名: 'Boss', 帳號: 'boss@emctaipei.com' });
  d.tables['設定'].rows.push({ 部門: '設計部', 組別: '平面', 名字: 'Anna', 顯示名: 'Anna', 帳號: 'anna@emctaipei.com' });
  return d;
};
const boss: SessionRecord = { user: 'Boss', account: 'boss@emctaipei.com', provider: 'password', expiresAt: 0 };
const anna: SessionRecord = { user: 'Anna', account: 'anna@emctaipei.com', provider: 'password', expiresAt: 0 };
const reply = (tokens: number) => Response.json({ content: [{ type: 'text', text: '好' }], stop_reason: 'end_turn', usage: { input_tokens: tokens, output_tokens: 0 } });

describe('managers have no daily token limit', () => {
  it('still answers a manager who is far past the limit, never says tired and never shows the low-battery warning, but keeps recording usage', async () => {
    const store = memoryStore();
    const key = usageKey(taipeiDay(NOW), 'boss@emctaipei.com');
    await store.put(key, ASSISTANT_DAILY_TOKENS * 5);
    let called = 0;
    const fetchImpl = (async () => { called += 1; return reply(1000); }) as typeof fetch;
    const out = await assistantChat({ message: '嗨' }, db(), boss, store, { apiKey: 'k', now: () => NOW, fetchImpl });
    expect(called).toBe(1);
    expect(out.reply).toBe('好');
    expect(out.quota).toEqual({ usedRatio: 0, tired: false });
    expect(await store.get<number>(key)).toBe(ASSISTANT_DAILY_TOKENS * 5 + 1000);
    const today = await assistantToday(db(), boss, store, null, [], NOW) as unknown as { quota: { tired: boolean } };
    expect(today.quota.tired).toBe(false);
  });

  it('crossing 80% never adds the low-battery line for a manager, but ordinary accounts keep both the warning and the limit', async () => {
    const store = memoryStore();
    await store.put(usageKey(taipeiDay(NOW), 'boss@emctaipei.com'), ASSISTANT_DAILY_TOKENS * 0.79);
    const fetchImpl = (async () => reply(1000)) as typeof fetch;
    const boosted = await assistantChat({ message: 'a' }, db(), boss, store, { apiKey: 'k', now: () => NOW, fetchImpl });
    expect(String(boosted.reply)).not.toContain(LOW_BATTERY_LINE);

    await store.put(usageKey(taipeiDay(NOW), 'anna@emctaipei.com'), ASSISTANT_DAILY_TOKENS * 0.79);
    const ordinary = await assistantChat({ message: 'a' }, db(), anna, store, { apiKey: 'k', now: () => NOW, fetchImpl });
    expect(String(ordinary.reply)).toContain(LOW_BATTERY_LINE);
    await store.put(usageKey(taipeiDay(NOW), 'anna@emctaipei.com'), ASSISTANT_DAILY_TOKENS);
    let called = false;
    const blocked = await assistantChat({ message: 'b' }, db(), anna, store, { apiKey: 'k', now: () => NOW, fetchImpl: (async () => { called = true; return reply(1); }) as typeof fetch });
    expect(called).toBe(false);
    expect(blocked.quota).toMatchObject({ tired: true });
  });
});

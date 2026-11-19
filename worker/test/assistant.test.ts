import { describe, expect, it } from 'vitest';
import { emptyDatabase } from '../../backend/schema.mjs';
import {
  ASSISTANT_DAILY_TOKENS, LOW_BATTERY_LINE, NOT_READY_LINE, TIRED_LINES, assistantChat, cleanupAssistantStorage,
  ASSISTANT_SYSTEM_PROMPT, assistantUsageReport, findCase, getCaseCounts, logKey, recordFeedback, taipeiDay, usageKey, type AssistantLogEntry, type AssistantStore
} from '../src/assistant';
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

const NOW = Date.parse('2026-11-18T04:00:00Z'); // 台灣 2026-11-18 12:00（週三）
const db = (): DatabaseSnapshot => {
  const d = emptyDatabase() as DatabaseSnapshot;
  d.tables['設定'].rows.push({ 部門: '設計部', 組別: '平面', 名字: 'Anna', 顯示名: 'Anna', 帳號: 'anna@emctaipei.com' });
  d.tables['設定'].rows.push({ 部門: '專案部', 組別: 'A組', 名字: 'Pm', 顯示名: 'Pm', 帳號: 'pm@emctaipei.com' });
  d.tables['客戶別'].rows.push({ 客戶別: '祕密客戶', 部門組別: '["設計部"]' });
  d.tables['客戶別'].rows.push({ 客戶別: '公開客戶', 部門組別: '["設計部","專案部"]' });
  d.tables.database.rows.push(
    { 案件編號: '26110001', 客戶別: '祕密客戶', 專案名稱: '機密海報', 狀態: '執行中', 設計負責人: 'Anna', 專案負責人: 'boss', 填單時間: '2026/11/18 09:00', 結束日期: '2026/11/20' },
    { 案件編號: '26110002', 客戶別: '公開客戶', 專案名稱: '公開海報', 狀態: '過稿中', 設計負責人: 'Anna', 專案負責人: 'pm@emctaipei.com', 填單時間: '2026/11/03', 結束日期: '2026/11/10' },
    { 案件編號: '26100001', 客戶別: '公開客戶', 專案名稱: '十月舊案', 狀態: '已完成', 設計負責人: 'Anna', 填單時間: '2026/10/05', 結束日期: '2026/10/09' }
  );
  return d;
};
const anna: SessionRecord = { user: 'Anna', account: 'anna@emctaipei.com', provider: 'password', expiresAt: 0 };
const pm: SessionRecord = { user: 'Pm', account: 'pm@emctaipei.com', provider: 'password', expiresAt: 0, department: '專案部' };

const reply = (text: string, tokens = 100) =>
  Response.json({ content: [{ type: 'text', text }], stop_reason: 'end_turn', usage: { input_tokens: tokens, output_tokens: 0 } });

describe('assistant tools', () => {
  it('counts cases by Taipei month and compares with the previous one', () => {
    const r = getCaseCounts(db(), { period: 'month' }, NOW) as { new: number; done: number; active: number; previous: { new: number; done: number } };
    expect(r).toMatchObject({ new: 2, active: 2, done: 0, previous: { new: 1, done: 1 } });
  });

  it('findCase hides customers the account cannot see', () => {
    const forPm = findCase(db(), pm, { keyword: '海報' }, NOW) as { found: number; cases: Array<{ 專案名稱: string }> };
    expect(forPm.cases.map(c => c.專案名稱)).toEqual(['公開海報']);
    expect((findCase(db(), anna, { keyword: '海報' }, NOW) as { found: number }).found).toBe(2);
    expect((findCase(db(), pm, { keyword: '不存在' }, NOW) as { found: number }).found).toBe(0);
  });
});

describe('assistantChat', () => {
  it('returns skipped without calling the API when there is no key', async () => {
    let called = false;
    const out = await assistantChat({ message: '嗨' }, db(), anna, memoryStore(), { now: () => NOW, fetchImpl: (async () => { called = true; return reply('x'); }) as typeof fetch });
    expect(out).toMatchObject({ ok: true, skipped: true, reply: NOT_READY_LINE });
    expect(called).toBe(false);
  });

  it('does not call the API once the daily quota is used up and answers with a tired line', async () => {
    const store = memoryStore();
    await store.put(usageKey(taipeiDay(NOW), 'anna@emctaipei.com'), ASSISTANT_DAILY_TOKENS);
    let called = false;
    const out = await assistantChat({ message: '嗨' }, db(), anna, store, { apiKey: 'k', now: () => NOW, fetchImpl: (async () => { called = true; return reply('x'); }) as typeof fetch });
    expect(called).toBe(false);
    expect(TIRED_LINES).toContain(out.reply);
    expect(out.quota).toMatchObject({ tired: true });
    expect((store.data.get(logKey(taipeiDay(NOW))) as AssistantLogEntry[])[0]).toMatchObject({ tired: true, question: '嗨' });
  });

  it('warns about low battery only once when crossing 80%', async () => {
    const store = memoryStore();
    await store.put(usageKey(taipeiDay(NOW), 'anna@emctaipei.com'), ASSISTANT_DAILY_TOKENS * 0.79);
    const deps = { apiKey: 'k', now: () => NOW, fetchImpl: (async () => reply('好', 1000)) as typeof fetch };
    expect(String((await assistantChat({ message: 'a' }, db(), anna, store, deps)).reply)).toContain(LOW_BATTERY_LINE);
    expect(String((await assistantChat({ message: 'b' }, db(), anna, store, deps)).reply)).not.toContain(LOW_BATTERY_LINE);
  });

  it('runs a tool loop, logs every question and lets feedback update the entry', async () => {
    const store = memoryStore();
    let round = 0;
    const fetchImpl = (async (_u: unknown, init: RequestInit) => {
      round += 1;
      const body = JSON.parse(String(init.body));
      if (round === 1) return Response.json({ content: [{ type: 'tool_use', id: 't1', name: 'findCase', input: { keyword: '海報' } }], stop_reason: 'tool_use', usage: { input_tokens: 50, output_tokens: 5 } });
      const toolResult = JSON.stringify(body.messages.at(-1).content[0]);
      expect(toolResult).toContain('公開海報');
      expect(toolResult).not.toContain('機密海報');
      return reply('找到 1 件');
    }) as typeof fetch;
    const out = await assistantChat({ message: '海報進度', history: [] }, db(), pm, store, { apiKey: 'k', now: () => NOW, fetchImpl });
    expect(out.reply).toBe('找到 1 件');
    const log = store.data.get(logKey(taipeiDay(NOW))) as AssistantLogEntry[];
    expect(log).toHaveLength(1);
    expect(log[0]).toMatchObject({ account: 'pm@emctaipei.com', tools: ['findCase'], found: true, tokens: 155, helpful: null });
    expect(await recordFeedback(store, pm, { logId: out.logId, helpful: true }, NOW)).toBe(true);
    expect((store.data.get(logKey(taipeiDay(NOW))) as AssistantLogEntry[])[0].helpful).toBe(true);
    expect(await recordFeedback(store, anna, { logId: out.logId, helpful: false }, NOW)).toBe(false);
  });

  it('gives up after 3 tool rounds', async () => {
    const fetchImpl = (async () => Response.json({ content: [{ type: 'tool_use', id: 't', name: 'getMyToday', input: {} }], stop_reason: 'tool_use', usage: { input_tokens: 1, output_tokens: 1 } })) as typeof fetch;
    const out = await assistantChat({ message: 'x' }, db(), anna, memoryStore(), { apiKey: 'k', now: () => NOW, fetchImpl });
    expect(out.reply).toBe('這題有點難，換個問法試試？');
  });
});

describe('cleanup', () => {
  it('removes logs older than 180 days once per day', async () => {
    const store = memoryStore();
    await store.put('assistantLog:2026-01-01', []);
    await store.put('assistantLog:2026-11-17', []);
    await store.put('assistantUsage:2026-01-01:a', 1);
    expect(await cleanupAssistantStorage(store, NOW)).toBe(2);
    expect([...store.data.keys()].sort()).toEqual(['assistantLog:2026-11-17', 'assistantLogCleanupDate']);
    expect(await cleanupAssistantStorage(store, NOW)).toBe(0);
  });
});

describe('usage report', () => {
  it('sums questions and tokens per day and per account without exposing question text', async () => {
    const store = memoryStore();
    const deps = { apiKey: 'k', now: () => NOW, fetchImpl: (async () => reply('好', 400)) as typeof fetch };
    await assistantChat({ message: '祕密問題' }, db(), anna, store, deps);
    await assistantChat({ message: 'b' }, db(), anna, store, deps);
    await assistantChat({ message: 'c' }, db(), pm, store, deps);
    const report = await assistantUsageReport(store, 2, NOW) as unknown as { days: Array<{ day: string; questions: number; tokens: number; accounts: Array<{ account: string; questions: number; tokens: number }> }> };
    expect(report.days[0]).toMatchObject({ day: '2026-11-18', questions: 3, tokens: 1200 });
    expect(report.days[0].accounts[0]).toMatchObject({ account: 'anna@emctaipei.com', questions: 2, tokens: 800 });
    expect(report.days[1]).toMatchObject({ questions: 0, tokens: 0 });
    expect(JSON.stringify(report)).not.toContain('祕密問題');
  });
});

describe('system prompt', () => {
  it('knows the main system features such as 多元宇宙', () => {
    expect(ASSISTANT_SYSTEM_PROMPT).toContain('小黃');
    expect(ASSISTANT_SYSTEM_PROMPT).toContain('多元宇宙');
    expect(ASSISTANT_SYSTEM_PROMPT).toContain('角色人物');
  });
});

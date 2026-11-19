import { describe, expect, it } from 'vitest';
import { emptyDatabase } from '../../backend/schema.mjs';
import {
  ASSISTANT_DAILY_TOKENS, LOW_BATTERY_LINE, NOT_READY_LINE, TIRED_LINES, assistantChat, cleanupAssistantStorage,
  ASSISTANT_SYSTEM_PROMPT, assistantUsageReport, findCase, getCaseCounts, logKey, recordFeedback, taipeiDay, usageKey, type AssistantLogEntry, type AssistantStore
} from '../src/assistant';
import { FEATURE_TIPS, KNOWLEDGE_TOPICS, lookupKnowledge } from '../src/assistant-knowledge';
import { getNewsTicker, keepItem, parseRss } from '../src/assistant-news';
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
  });
});

describe('system knowledge', () => {
  it('finds the right topic by keyword and lists the catalogue in the prompt', () => {
    expect(lookupKnowledge('多元宇宙是什麼').topics[0].id).toBe('metaverse');
    expect(lookupKnowledge('怎麼摸貓').topics.map(t => t.id)).toContain('pets');
    expect(lookupKnowledge('平台幣').topics.map(t => t.id)).toContain('studio');
    expect(lookupKnowledge('完全不相干的詞').topics).toHaveLength(0);
    for (const t of KNOWLEDGE_TOPICS) expect(ASSISTANT_SYSTEM_PROMPT).toContain(t.title);
    expect(ASSISTANT_SYSTEM_PROMPT).toContain('getSystemHelp');
    expect(FEATURE_TIPS.length).toBeGreaterThan(5);
  });

  it('answers getSystemHelp through the tool loop and sends the prompt as a cacheable system block', async () => {
    let round = 0;
    const seenSystem: unknown[] = [];
    const fetchImpl = (async (_u: unknown, init: RequestInit) => {
      round += 1;
      const body = JSON.parse(String(init.body));
      seenSystem.push(body.system);
      if (round === 1) return Response.json({ content: [{ type: 'tool_use', id: 'h1', name: 'getSystemHelp', input: { query: '多元宇宙' } }], stop_reason: 'tool_use', usage: { input_tokens: 10, output_tokens: 2 } });
      expect(JSON.stringify(body.messages.at(-1).content[0])).toContain('像素辦公室');
      return reply('是 3D 辦公室');
    }) as typeof fetch;
    const out = await assistantChat({ message: '多元宇宙是什麼' }, db(), anna, memoryStore(), { apiKey: 'k', now: () => NOW, fetchImpl });
    expect(out.reply).toBe('是 3D 辦公室');
    expect(seenSystem[0]).toEqual([{ type: 'text', text: ASSISTANT_SYSTEM_PROMPT, cache_control: { type: 'ephemeral' } }]);
  });
});

describe('news ticker', () => {
  const rss = (items: Array<[string, string, string]>) => '<rss><channel>' + items.map(([t, l, s]) => '<item><title>' + t + '</title><link>' + l + '</link><source url="x">' + s + '</source></item>').join('') + '</channel></rss>';
  it('parses titles, strips the source suffix and drops unsafe or off-topic items', () => {
    const items = parseRss(rss([
      ['海報設計趨勢 - 設計誌', 'https://news.example/a', '設計誌'],
      ['某候選人選舉造勢 - 新聞台', 'https://news.example/b', '新聞台'],
      ['新創獲補助 - 財經報', 'https://news.example/c', '財經報'],
      ['壞連結設計 - X', 'javascript:alert(1)', 'X']
    ]), 'design');
    expect(items).toEqual([{ title: '海報設計趨勢', source: '設計誌', link: 'https://news.example/a', topic: 'design' }]);
    expect(keepItem({ title: '台積電新製程', source: '', link: 'https://x', topic: 'news' })).toBe(true);
  });

  it('caches for 3 hours and keeps old items when the fetch fails', async () => {
    const store = memoryStore();
    let calls = 0;
    const ok = (async () => { calls += 1; return new Response(rss([['品牌設計新作 - 誌', 'https://news.example/d', '誌']])); }) as unknown as typeof fetch;
    const first = await getNewsTicker(store, NOW, ok);
    expect(first.length).toBeGreaterThan(0);
    const callsAfterFirst = calls;
    await getNewsTicker(store, NOW + 60 * 60 * 1000, ok);
    expect(calls).toBe(callsAfterFirst);
    const failing = (async () => { throw new Error('offline'); }) as unknown as typeof fetch;
    expect(await getNewsTicker(store, NOW + 4 * 60 * 60 * 1000, failing)).toEqual(first);
  });
});

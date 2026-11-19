import { beforeEach, describe, expect, it } from 'vitest';
import { emptyDatabase } from '../../backend/schema.mjs';
import { assistantChat, findCase, getCaseCounts, type AssistantStore } from '../src/assistant';
import { loadHistoryRows, mergeCaseRows, resetHistoryCache } from '../src/assistant-history';
import type { DatabaseSnapshot, SessionRecord } from '../src/types';

function memoryStore(): AssistantStore {
  const data = new Map<string, unknown>();
  return {
    async get<T>(key: string) { return data.get(key) as T | undefined; },
    async put(key: string, value: unknown) { data.set(key, JSON.parse(JSON.stringify(value))); },
    async delete(keys: string | string[]) { for (const k of Array.isArray(keys) ? keys : [keys]) data.delete(k); },
    async list<T>(options?: { prefix?: string }) { return new Map([...data].filter(([k]) => k.startsWith(options?.prefix || '')) as [string, T][]); }
  };
}

const NOW = Date.parse('2026-11-18T04:00:00Z'); // 台灣 2026-11-18
const source = { owner: 'o', repo: 'r', branch: 'main' };
const archive = {
  rows: [
    { 案件編號: '25030001', 客戶別: '公開客戶', 專案名稱: '三月海報', 狀態: '已完成', 設計負責人: 'Anna', 填單時間: '2025/03/02 10:00:00', 結束日期: '2025/03/08', 多餘欄位: 'x'.repeat(50) },
    { 案件編號: '25030002', 客戶別: '公開客戶', 專案名稱: '三月影片', 狀態: '已完成', 設計負責人: 'Noise', 填單時間: '2025/03/20', 結束日期: '2025/03/28' },
    { 案件編號: '25060001', 客戶別: '祕密客戶', 專案名稱: '機密六月案', 狀態: '已完成', 設計負責人: 'Anna', 填單時間: '2025/06/05', 結束日期: '2025/06/10' },
    { 案件編號: '24120001', 客戶別: '公開客戶', 專案名稱: '去年底案', 狀態: '已完成', 設計負責人: 'Anna', 填單時間: '2024/12/10', 結束日期: '2024/12/20' },
    { 案件編號: '26110002', 客戶別: '公開客戶', 專案名稱: '舊版同案', 狀態: '執行中', 設計負責人: 'Anna', 填單時間: '2026/11/03' }
  ]
};
const db = (): DatabaseSnapshot => {
  const d = emptyDatabase() as DatabaseSnapshot;
  d.tables['設定'].rows.push({ 部門: '專案部', 組別: 'A組', 名字: 'Pm', 顯示名: 'Pm', 帳號: 'pm@emctaipei.com' });
  d.tables['客戶別'].rows.push({ 客戶別: '祕密客戶', 部門組別: '["設計部"]' }, { 客戶別: '公開客戶', 部門組別: '["設計部","專案部"]' });
  d.tables.database.rows.push({ 案件編號: '26110002', 客戶別: '公開客戶', 專案名稱: '新版同案', 狀態: '過稿中', 設計負責人: 'Anna', 填單時間: '2026/11/03', 結束日期: '2026/11/10' });
  return d;
};
const pm: SessionRecord = { user: 'Pm', account: 'pm@emctaipei.com', provider: 'password', expiresAt: 0, department: '專案部' };
const okFetch = (async (input: unknown) => {
  expect(String(input)).toBe('https://raw.githubusercontent.com/o/r/main/data/database_archive.json');
  return Response.json(archive);
}) as typeof fetch;

beforeEach(() => resetHistoryCache());

describe('歷史資料庫', () => {
  it('loads and slims the archive, caches it for an hour and keeps the old copy when refreshing fails', async () => {
    let calls = 0;
    const counting = (async (input: unknown) => { calls += 1; return okFetch(input as string); }) as typeof fetch;
    const first = await loadHistoryRows(source, NOW, counting);
    expect(first.ok).toBe(true);
    expect(first.rows).toHaveLength(5);
    expect(first.rows[0]).not.toHaveProperty('多餘欄位');
    await loadHistoryRows(source, NOW + 30 * 60 * 1000, counting);
    expect(calls).toBe(1);
    const failing = (async () => { throw new Error('offline'); }) as unknown as typeof fetch;
    const stale = await loadHistoryRows(source, NOW + 2 * 3600 * 1000, failing);
    expect(stale).toMatchObject({ ok: true });
    expect(stale.rows).toHaveLength(5);
  });

  it('reports ok:false (and does not hammer GitHub) when there is no archive and the fetch fails', async () => {
    let calls = 0;
    const failing = (async () => { calls += 1; throw new Error('offline'); }) as unknown as typeof fetch;
    expect((await loadHistoryRows(source, NOW, failing)).ok).toBe(false);
    expect((await loadHistoryRows(source, NOW + 60 * 1000, failing)).ok).toBe(false);
    expect(calls).toBe(1);
  });

  it('merges archive with the current database, letting the current copy win and tagging history-only cases', async () => {
    const hist = (await loadHistoryRows(source, NOW, okFetch)).rows;
    const merged = mergeCaseRows(db().tables.database.rows, hist);
    expect(merged).toHaveLength(5);
    const same = merged.find(r => r['案件編號'] === '26110002');
    expect(same?.專案名稱).toBe('新版同案');
    expect(same?.__history).toBeUndefined();
    expect(merged.find(r => r['案件編號'] === '25030001')?.__history).toBe(true);
  });

  it('counts any year or month from history, with the previous period, a month breakdown and no "active" number', async () => {
    const hist = (await loadHistoryRows(source, NOW, okFetch)).rows;
    const rows = mergeCaseRows(db().tables.database.rows, hist);
    const year = getCaseCounts(db(), { year: 2025 }, NOW, rows) as { period: string; new: number; done: number; active: number | null; previous: { new: number } };
    expect(year).toMatchObject({ period: '2025年', new: 3, done: 3, active: null, previous: { new: 1 } });
    const march = getCaseCounts(db(), { year: 2025, month: 3 }, NOW, rows) as { period: string; new: number; previous: { new: number } };
    expect(march).toMatchObject({ period: '2025年3月', new: 2, previous: { new: 0 } });
    const months = (getCaseCounts(db(), { year: 2025, groupBy: 'month' }, NOW, rows) as { months: Array<{ 月: number; new: number }> }).months;
    expect(months).toHaveLength(12);
    expect(months[2].new).toBe(2);
    expect(months[5].new).toBe(1);
    const byDesigner = (getCaseCounts(db(), { year: 2025, groupBy: 'designer' }, NOW, rows) as { groups: Array<{ name: string; new: number }> }).groups;
    expect(byDesigner[0]).toMatchObject({ name: 'Anna', new: 2 });
  });

  it('findCase searches history too, labels the source and still hides customers the account cannot see', async () => {
    const hist = (await loadHistoryRows(source, NOW, okFetch)).rows;
    const rows = mergeCaseRows(db().tables.database.rows, hist);
    const hit = findCase(db(), pm, { keyword: '三月' }, NOW, rows) as { found: number; cases: Array<{ 來源: string }> };
    expect(hit.found).toBe(2);
    expect(hit.cases[0].來源).toBe('歷史資料庫');
    const secret = findCase(db(), pm, { keyword: '機密六月' }, NOW, rows) as { found: number };
    expect(secret.found).toBe(0);
  });

  it('answers through the tool loop with the history range label, and says so when history is unreadable', async () => {
    const seen: string[] = [];
    let round = 0;
    const fetchImpl = (async (input: unknown, init?: RequestInit) => {
      const url = String(input);
      if (url.includes("raw.githubusercontent.com")) return okFetch(url);
      round += 1;
      const body = JSON.parse(String(init?.body));
      if (round === 1) return Response.json({ content: [{ type: 'tool_use', id: 'c1', name: 'getCaseCounts', input: { year: 2025 } }], stop_reason: 'tool_use', usage: { input_tokens: 5, output_tokens: 1 } });
      seen.push(JSON.stringify(body.messages.at(-1).content[0]));
      return Response.json({ content: [{ type: 'text', text: '2025 年新進 3 案' }], stop_reason: 'end_turn', usage: { input_tokens: 5, output_tokens: 3 } });
    }) as typeof fetch;
    const out = await assistantChat({ message: '去年接了幾案' }, db(), pm, memoryStore(), { apiKey: 'k', now: () => NOW, fetchImpl, github: source });
    expect(out.reply).toBe('2025 年新進 3 案');
    expect(seen[0]).toContain('歷史資料庫（2023 年起）');
    expect(seen[0]).toContain('\\"new\\":3');

    resetHistoryCache();
    round = 0; seen.length = 0;
    const brokenHistory = (async (input: unknown, init?: RequestInit) => {
      if (String(input).includes('raw.githubusercontent.com')) throw new Error('offline');
      return fetchImpl(input as string, init);
    }) as typeof fetch;
    await assistantChat({ message: '去年接了幾案' }, db(), pm, memoryStore(), { apiKey: 'k', now: () => NOW, fetchImpl: brokenHistory, github: source });
    expect(seen[0]).toContain('歷史資料庫暫時讀不到');
  });
});

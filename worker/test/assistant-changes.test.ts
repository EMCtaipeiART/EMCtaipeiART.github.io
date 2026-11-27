import { describe, expect, it } from 'vitest';
import { emptyDatabase } from '../../backend/schema.mjs';
import { ASSISTANT_SYSTEM_PROMPT, assistantChat, type AssistantStore } from '../src/assistant';
import { getChangeLog, parseChangeLog, parseCommits } from '../src/assistant-changes';
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
const anna: SessionRecord = { user: 'Anna', account: 'anna@emctaipei.com', provider: 'password', expiresAt: 0 };
const LOG = ['# 修改紀錄', '', '## 2026-11-01 【同仁】舊改動', '- 舊內容', '', '## 2026-11-18 【同仁】新功能 A', '- 做了 A', '- 因為 B', '', '## 2026-11-19 【同仁】修正 C', '- 修好 C', ''].join('\n');
const COMMITS = [
  { commit: { message: 'data: audit log +2', committer: { date: '2026-11-19T01:00:00Z' } } },
  { commit: { message: 'feat: 【同仁】專案頁新增匯出\n\nCo-Authored-By: x', committer: { date: '2026-11-19T17:30:00Z' } } },
  { commit: { message: 'fix: 【同仁】修正某頁', committer: { date: '2026-11-18T02:00:00Z' } } }
];
const source = { owner: 'o', repo: 'r', branch: 'main', token: 'secret-token' };

describe('github changes', () => {
  it('parses the newest log sections first and keeps only human commits with Taipei dates', () => {
    const sections = parseChangeLog(LOG, 2);
    expect(sections.map(x => x.title)).toEqual(['2026-11-19 修正 C', '2026-11-18 新功能 A']);
    expect(sections[1].body).toContain('做了 A');
    expect(parseCommits(COMMITS)).toEqual([
      { date: '2026-11-20', subject: 'feat: 專案頁新增匯出' },
      { date: '2026-11-18', subject: 'fix: 修正某頁' }
    ]);
  });

  it('skips marked commits that were later withheld from staff', () => {
    const item = (sha: string, message: string) => ({ sha, commit: { message, committer: { date: '2026-11-28T01:00:00Z' } } });
    const hidden = ['7baf4724a', '862ad38db', '8bc379fa1'].map(sha => item(sha + '0000', '【同仁】元宇宙：聖誕'));
    expect(parseCommits([...hidden, item('abc1234', '【同仁】專案頁新增匯出')]).map(c => c.subject)).toEqual(['專案頁新增匯出']);
  });

  it('sends the token only to the GitHub API, caches 30 minutes and keeps old data when fetching fails', async () => {
    const store = memoryStore();
    const seen: Array<{ url: string; auth: string | null }> = [];
    const ok = (async (input: unknown, init?: RequestInit) => {
      const url = String(input);
      seen.push({ url, auth: new Headers(init?.headers).get('authorization') });
      return url.includes('raw.githubusercontent.com') ? new Response(LOG) : Response.json(COMMITS);
    }) as typeof fetch;
    const first = await getChangeLog(store, NOW, source, ok);
    expect(first.sections[0].title).toBe('2026-11-19 修正 C');
    expect(seen.find(x => x.url.includes('raw.githubusercontent.com'))?.auth).toBeNull();
    expect(seen.find(x => x.url.includes('api.github.com'))?.auth).toBe('Bearer secret-token');
    const calls = seen.length;
    await getChangeLog(store, NOW + 10 * 60 * 1000, source, ok);
    expect(seen.length).toBe(calls);
    const failing = (async () => { throw new Error('offline'); }) as unknown as typeof fetch;
    expect(await getChangeLog(store, NOW + 40 * 60 * 1000, source, failing)).toEqual(first);
  });

  it('answers getRecentChanges through the tool loop', async () => {
    let round = 0;
    const fetchImpl = (async (input: unknown, init?: RequestInit) => {
      const url = String(input);
      if (url.includes('raw.githubusercontent.com')) return new Response(LOG);
      if (url.includes('api.github.com')) return Response.json(COMMITS);
      round += 1;
      const body = JSON.parse(String(init?.body));
      if (round === 1) return Response.json({ content: [{ type: 'tool_use', id: 'c1', name: 'getRecentChanges', input: {} }], stop_reason: 'tool_use', usage: { input_tokens: 5, output_tokens: 1 } });
      expect(JSON.stringify(body.messages.at(-1).content[0])).toContain('修正 C');
      return Response.json({ content: [{ type: 'text', text: '最近修了 C' }], stop_reason: 'end_turn', usage: { input_tokens: 5, output_tokens: 3 } });
    }) as typeof fetch;
    const database = emptyDatabase() as DatabaseSnapshot;
    const out = await assistantChat({ message: '最近改了什麼' }, database, anna, memoryStore(), { apiKey: 'k', now: () => NOW, fetchImpl, github: source });
    expect(out.reply).toBe('最近修了 C');
    expect(ASSISTANT_SYSTEM_PROMPT).toContain('getRecentChanges');
  });
});

import { describe, expect, it } from 'vitest';
import { emptyDatabase } from '../../backend/schema.mjs';
import { ASSISTANT_SYSTEM_PROMPT, assistantChat, assistantUsageReport, gapKey, listGaps, reportGap, updateGap, type AssistantLogEntry, type AssistantStore } from '../src/assistant';
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
const pm: SessionRecord = { user: 'Pm', account: 'pm@emctaipei.com', provider: 'password', expiresAt: 0, department: '專案部' };

describe('unanswered questions are reported to the admin', () => {
  it('normalises punctuation so the same question merges and counts askers', async () => {
    expect(gapKey('怎麼 申請，換座位？')).toBe(gapKey('怎麼申請換座位'));
    const store = memoryStore();
    await reportGap(store, anna, '設計部', '怎麼申請換座位？', '缺座位申請流程', NOW);
    await reportGap(store, pm, '專案部', '怎麼申請換座位', '缺座位申請流程', NOW + 1000);
    const { gaps, open } = await listGaps(store) as unknown as { open: number; gaps: Array<{ count: number; askers: string[]; note: string }> };
    expect(open).toBe(1);
    expect(gaps[0].count).toBe(2);
    expect(gaps[0].askers).toEqual(['anna@emctaipei.com', 'pm@emctaipei.com']);
    expect(gaps[0].note).toBe('缺座位申請流程');
  });

  it('records through the reportUnanswered tool with the real user question and tells the model not to point at a person', async () => {
    const store = memoryStore();
    let round = 0;
    const fetchImpl = (async (_u: unknown, init: RequestInit) => {
      round += 1;
      const body = JSON.parse(String(init.body));
      if (round === 1) return Response.json({ content: [{ type: 'tool_use', id: 'g1', name: 'reportUnanswered', input: { note: '沒有請假流程說明' } }], stop_reason: 'tool_use', usage: { input_tokens: 10, output_tokens: 2 } });
      expect(JSON.stringify(body.messages.at(-1).content[0])).toContain('已記錄並回報給管理者');
      return Response.json({ content: [{ type: 'text', text: '這題我還不會，已經記下來回報給管理者，之後會補上。' }], stop_reason: 'end_turn', usage: { input_tokens: 5, output_tokens: 5 } });
    }) as typeof fetch;
    const database = emptyDatabase() as DatabaseSnapshot;
    const out = await assistantChat({ message: '怎麼請特休？' }, database, anna, store, { apiKey: 'k', now: () => NOW, fetchImpl });
    expect(String(out.reply)).toContain('回報給管理者');
    const { gaps } = await listGaps(store, 'open') as unknown as { gaps: Array<{ question: string; note: string; user: string }> };
    expect(gaps[0]).toMatchObject({ question: '怎麼請特休？', note: '沒有請假流程說明', user: 'Anna' });
    const log = [...store.data.entries()].find(([k]) => k.startsWith('assistantLog:'))?.[1] as AssistantLogEntry[];
    expect(log[0]).toMatchObject({ gap: true, found: false });
    expect(ASSISTANT_SYSTEM_PROMPT).toContain('reportUnanswered');
    expect(ASSISTANT_SYSTEM_PROMPT).toContain('絕對不要叫使用者去問 Machi');
  });

  it('lets the admin close and reopen a gap, and the usage report shows how many are still open', async () => {
    const store = memoryStore();
    const gap = await reportGap(store, anna, '設計部', '問題一', '', NOW);
    await reportGap(store, anna, '設計部', '問題二', '', NOW);
    expect(((await assistantUsageReport(store, 1, NOW)) as unknown as { openGaps: number }).openGaps).toBe(2);
    const closed = await updateGap(store, { id: gap.id, status: 'done', adminNote: '已補進知識庫' }, NOW) as unknown as { gap: { status: string; adminNote: string; doneAt?: string } };
    expect(closed.gap).toMatchObject({ status: 'done', adminNote: '已補進知識庫' });
    expect(closed.gap.doneAt).toBeTruthy();
    expect(((await assistantUsageReport(store, 1, NOW)) as unknown as { openGaps: number }).openGaps).toBe(1);
    const reopened = await updateGap(store, { id: gap.id, status: 'open', adminNote: '' }, NOW) as unknown as { gap: { status: string; doneAt?: string } };
    expect(reopened.gap.status).toBe('open');
    expect(reopened.gap.doneAt).toBeUndefined();
    await expect(updateGap(store, { id: 'nope', status: 'done' }, NOW)).rejects.toThrow('找不到');
  });
});

import { reportUnansweredTool as __ruTool } from '../src/assistant';
describe('答不上來的問題同時寫進問題回報', () => {
  it('第一次出現才開單，同一題再被問只累計次數；開單失敗不影響回答', async () => {
    const store = memoryStore();
    const issues: string[][] = [];
    const file = async (reporter: string, content: string, suggestion: string) => { issues.push([reporter, content, suggestion]); };
    const entry = (q: string) => ({ question: q, department: '設計部', found: true, gap: false } as unknown as AssistantLogEntry);
    await __ruTool({ note: '缺座位申請流程' }, store, anna, entry('怎麼申請換座位？'), NOW, file);
    await __ruTool({ note: '' }, store, pm, entry('怎麼申請換座位'), NOW + 1000, file);
    expect(issues).toHaveLength(1);
    expect(issues[0][0]).toBe('Anna');
    expect(issues[0][1]).toContain('怎麼申請換座位');
    expect(issues[0][1].length).toBeLessThanOrEqual(300);
    const res = await __ruTool({}, store, anna, entry('另一題'), NOW + 2000, async () => { throw new Error('boom'); });
    expect(res.recorded).toBe(true);
  });
});

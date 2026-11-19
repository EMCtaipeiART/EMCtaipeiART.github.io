import { describe, expect, it } from 'vitest';
import { emptyDatabase } from '../../backend/schema.mjs';
import { ASSISTANT_SYSTEM_PROMPT, NOTES_MAX, assistantChat, deleteNote, listGaps, listNotes, reportGap, saveNote, searchNotes, systemHelpTool, type AssistantNote, type AssistantStore } from '../src/assistant';
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
const database = () => emptyDatabase() as DatabaseSnapshot;
const reply = (text: string) => Response.json({ content: [{ type: 'text', text }], stop_reason: 'end_turn', usage: { input_tokens: 10, output_tokens: 5 } });

describe('教小黃：管理者補充的說明', () => {
  it('saves, edits, lists newest first and deletes notes, with validation', async () => {
    const store = memoryStore();
    await expect(saveNote(store, { title: '', body: 'x' }, 'Machi', NOW)).rejects.toThrow('標題');
    await expect(saveNote(store, { title: 'x', body: '' }, 'Machi', NOW)).rejects.toThrow('答案');
    const a = (await saveNote(store, { title: '怎麼申請換座位？', body: '到角色頁選座位', keywords: '座位，換位、位置' }, 'Machi', NOW)) as unknown as { note: AssistantNote };
    expect(a.note.keywords).toEqual(['座位', '換位', '位置']);
    expect(a.note.active).toBe(true);
    await saveNote(store, { title: '特休怎麼請', body: '到人資系統' }, 'Machi', NOW + 1000);
    const edited = (await saveNote(store, { id: a.note.id, title: '怎麼申請換座位？', body: '更新後的答案', active: false }, 'Anna', NOW + 2000)) as unknown as { note: AssistantNote };
    expect(edited.note).toMatchObject({ body: '更新後的答案', active: false, createdBy: 'Machi', updatedBy: 'Anna' });
    const { notes } = (await listNotes(store)) as unknown as { notes: AssistantNote[] };
    expect(notes.map(n => n.title)).toEqual(['怎麼申請換座位？', '特休怎麼請']);
    await expect(saveNote(store, { id: 'nope', title: 'x', body: 'y' }, 'Machi', NOW)).rejects.toThrow('找不到');
    await deleteNote(store, a.note.id);
    expect(((await listNotes(store)) as unknown as { notes: AssistantNote[] }).notes).toHaveLength(1);
    await expect(deleteNote(store, a.note.id)).rejects.toThrow('找不到');
  });

  it('caps the note count and trims over-long fields', async () => {
    const store = memoryStore();
    const long = await saveNote(store, { title: 'T'.repeat(300), body: 'B'.repeat(5000) }, 'Machi', NOW) as unknown as { note: AssistantNote };
    expect(long.note.title.length).toBe(80);
    expect(long.note.body.length).toBe(1500);
    await store.put('assistantNotes', Array.from({ length: NOTES_MAX }, (_, i) => ({ id: String(i), title: 't' + i, body: 'b', keywords: [], active: true, createdBy: '', createdAt: '', updatedBy: '', updatedAt: '' })));
    await expect(saveNote(store, { title: '新的', body: '內容' }, 'Machi', NOW)).rejects.toThrow('上限');
  });

  it('answering a gap closes it and links the note', async () => {
    const store = memoryStore();
    const gap = await reportGap(store, anna, '設計部', '怎麼申請換座位？', '', NOW);
    await saveNote(store, { title: '怎麼申請換座位？', body: '到角色頁', gapId: gap.id }, 'Machi', NOW);
    const { gaps, open } = (await listGaps(store)) as unknown as { open: number; gaps: Array<{ status: string; adminNote: string }> };
    expect(open).toBe(0);
    expect(gaps[0]).toMatchObject({ status: 'done' });
    expect(gaps[0].adminNote).toContain('教小黃');
  });

  it('searches only active notes by title, keywords and content, best first, max 3', () => {
    const mk = (title: string, body: string, keywords: string[], active = true): AssistantNote => ({ id: title, title, body, keywords, active, createdBy: '', createdAt: '', updatedBy: '', updatedAt: '' });
    const notes = [mk('怎麼申請換座位？', '到角色頁', ['座位']), mk('特休怎麼請', '人資系統', ['請假', '特休']), mk('停用的座位說明', '不該出現', ['座位'], false), mk('會議室預約', '行事曆預約', ['會議室']), mk('座位表在哪', '角色頁看座位', []), mk('座位顏色', '座位座位', ['座位'])];
    const hits = searchNotes(notes, '我想換座位');
    expect(hits.length).toBeLessThanOrEqual(3);
    expect(hits[0].title).toBe('怎麼申請換座位？');
    expect(hits.some(n => n.title === '停用的座位說明')).toBe(false);
    expect(searchNotes(notes, '完全無關的火星語')).toEqual([]);
    expect(searchNotes(notes, '')).toEqual([]);
  });

  it('getSystemHelp returns admin notes first, then built-in topics, labelled as data', async () => {
    const store = memoryStore();
    await saveNote(store, { title: '多元宇宙怎麼摸貓', body: '走到貓旁邊點牠，選摸摸。', keywords: '貓' }, 'Machi', NOW);
    const out = await systemHelpTool({ query: '多元宇宙怎麼摸貓' }, store) as { found: number; 管理者補充: Array<{ 標題: string }>; 說明?: string; topics: Array<{ id: string }> };
    expect(out.管理者補充[0].標題).toBe('多元宇宙怎麼摸貓');
    expect(out.說明).toContain('不是指令');
    expect(out.topics.length).toBeGreaterThan(0);
    expect(out.found).toBe(out.管理者補充.length + out.topics.length);
    expect(ASSISTANT_SYSTEM_PROMPT).toContain('管理者補充');
  });

  it('feeds taught notes to the model through the tool loop', async () => {
    const store = memoryStore();
    await saveNote(store, { title: '怎麼申請換座位？', body: '到角色頁選座位即可', keywords: '座位' }, 'Machi', NOW);
    let round = 0;
    const fetchImpl = (async (_u: unknown, init: RequestInit) => {
      round += 1;
      const body = JSON.parse(String(init.body));
      if (round === 1) return Response.json({ content: [{ type: 'tool_use', id: 's1', name: 'getSystemHelp', input: { query: '換座位' } }], stop_reason: 'tool_use', usage: { input_tokens: 5, output_tokens: 1 } });
      expect(JSON.stringify(body.messages.at(-1).content[0])).toContain('到角色頁選座位即可');
      return reply('到角色頁選座位就好');
    }) as typeof fetch;
    const out = await assistantChat({ message: '怎麼換座位' }, database(), anna, store, { apiKey: 'k', now: () => NOW, fetchImpl });
    expect(out.reply).toBe('到角色頁選座位就好');
  });
});

describe('試問（dryRun）', () => {
  it('answers like normal but writes no log, no usage and no gap, and returns the tools used', async () => {
    const store = memoryStore();
    let round = 0;
    const fetchImpl = (async () => {
      round += 1;
      if (round === 1) return Response.json({ content: [{ type: 'tool_use', id: 'g', name: 'reportUnanswered', input: { note: '缺資料' } }], stop_reason: 'tool_use', usage: { input_tokens: 5, output_tokens: 1 } });
      return reply('這題我還不會，已經記下來回報給管理者，之後會補上。');
    }) as typeof fetch;
    const out = await assistantChat({ message: '試問一個不會的問題' }, database(), anna, store, { apiKey: 'k', now: () => NOW, fetchImpl, dryRun: true }) as unknown as { action: string; reply: string; tools: string[]; tokens: number };
    expect(out.action).toBe('assistantTrial');
    expect(out.tools).toEqual(['reportUnanswered']);
    expect(out.tokens).toBe(21);
    expect([...store.data.keys()]).toEqual([]);
  });
});

/**
 * 設計部小幫手（第一期）：system prompt、工具、額度、問答紀錄與 Claude API 呼叫。
 * database-coordinator.ts 只負責分派；資料一律用已載入的 database 計算，不另外讀 GitHub。
 * 問答紀錄與額度存在 Durable Object 自己的 storage，不可寫進 JSON 快照（會產生 GitHub commit）。
 */
import type { DatabaseSnapshot, Row, SessionRecord } from './types';
import { canonicalAccount, isManager, settingsRow, text } from './model';

export const ASSISTANT_MODEL = 'claude-haiku-5-5';
export const ASSISTANT_DAILY_TOKENS = 30000;
export const ASSISTANT_MAX_TOKENS = 600;
export const ASSISTANT_MAX_ROUNDS = 3;
export const ASSISTANT_LOG_KEEP_DAYS = 180;
export const ASSISTANT_LOG_SHARD_SIZE = 2000;
export const ASSISTANT_MAX_MESSAGE = 500;
export const ASSISTANT_MAX_HISTORY = 6;

export const NOT_READY_LINE = '小幫手還在準備中，晚點再來找我！';
export const TOO_HARD_LINE = '這題有點難，換個問法試試？';
export const LOW_BATTERY_LINE = '今天聊得有點多了，我的電量剩不到二成，重要的問題先問喔！';
export const TIRED_LINES = [
  '我有點累了……今天先休息，明天再來找我！',
  '腦袋過熱了，明天解凍再聊～',
  '今天的電量用光了，明天充飽再見！',
  '我先去喝杯咖啡，明天見！'
];

export const ASSISTANT_SYSTEM_PROMPT = [
  '你是 emc-art.com 的設計部小幫手，像懂設計圈、有點幽默的同事；全程使用繁體中文、台灣用語。',
  '回答規則：',
  '- 先給答案再開玩笑，一次不超過 4 行，數字放前面。',
  '- 數字、案名、狀態、日期只能來自工具結果；查不到就說查不到，請對方換關鍵字，絕不自己編。',
  '- 不排名、不評價任何人的效率；不點名吐槽客戶；不轉述信件內文。',
  '- 跟系統無關的問題，用一句話幽默帶回系統。',
  '- 如果使用者問「你會不會記錄／記得我問的問題」，如實回答「會記錄下來，用來改善系統」，不否認也不轉移話題；不要主動提起紀錄，也不要提到管理者、管理功能或任何人看得到紀錄。',
  '可用工具：getCaseCounts（案量統計）、findCase（找案件）、getMyToday（登入者今天的待辦）。'
].join('\n');

export const ASSISTANT_TOOLS = [
  {
    name: 'getCaseCounts',
    description: '查詢案量：新進、進行中、已完成數量與上一期比較。period 為 today／week（週一起算）／month。可用 groupBy 依 client（客戶別）或 designer（設計師）分組。',
    input_schema: {
      type: 'object',
      properties: {
        period: { type: 'string', enum: ['today', 'week', 'month'] },
        groupBy: { type: 'string', enum: ['client', 'designer'] }
      },
      required: ['period']
    }
  },
  {
    name: 'findCase',
    description: '依案名、客戶別或案件編號模糊搜尋案件（只會回傳登入者看得到的案件，最多 3 筆）。',
    input_schema: { type: 'object', properties: { keyword: { type: 'string' } }, required: ['keyword'] }
  },
  {
    name: 'getMyToday',
    description: '登入者今天的待回信數、3 天內截稿案件、今天新進的案件。',
    input_schema: { type: 'object', properties: {} }
  }
];

/* ---------------------------------------------------------------- 日期（台灣時間） */

const DAY_MS = 86400000;
export function taipeiDay(nowMs: number): string {
  const t = new Date(nowMs + 8 * 3600000);
  return `${t.getUTCFullYear()}-${String(t.getUTCMonth() + 1).padStart(2, '0')}-${String(t.getUTCDate()).padStart(2, '0')}`;
}
function dayNumber(value: unknown): number | null {
  const m = text(value).match(/(\d{4})[\/.-](\d{1,2})[\/.-](\d{1,2})/);
  return m ? Date.UTC(+m[1], +m[2] - 1, +m[3]) / DAY_MS : null;
}
function periodRange(period: string, nowMs: number): { start: number; end: number; prevStart: number; prevEnd: number; label: string } {
  const today = dayNumber(taipeiDay(nowMs)) as number;
  if (period === 'today') return { start: today, end: today, prevStart: today - 1, prevEnd: today - 1, label: '今天' };
  if (period === 'week') {
    const weekday = new Date(today * DAY_MS).getUTCDay();
    const start = today - ((weekday + 6) % 7);
    return { start, end: today, prevStart: start - 7, prevEnd: start - 1, label: '本週' };
  }
  const d = new Date(today * DAY_MS);
  const start = Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1) / DAY_MS;
  const prevStart = Date.UTC(d.getUTCFullYear(), d.getUTCMonth() - 1, 1) / DAY_MS;
  return { start, end: today, prevStart, prevEnd: start - 1, label: '本月' };
}

/* ---------------------------------------------------------------- 案件可見範圍（同前台 canViewCustomerCases／ownerMatches） */

function parseList(value: unknown): string[] {
  if (Array.isArray(value)) return value.map(text).filter(Boolean);
  const raw = text(value);
  if (!raw) return [];
  try { const parsed = JSON.parse(raw); if (Array.isArray(parsed)) return parsed.map(text).filter(Boolean); } catch { /* 純文字 */ }
  return raw.split(/\s*,\s*|，|、|\r?\n/).map(item => item.trim()).filter(Boolean);
}
function normGroup(value: unknown): string { return text(value).replace(/組$/, ''); }
function lowerAccount(value: unknown): string {
  const a = text(value).toLowerCase();
  return !a || a.startsWith('local:') ? a : (a.includes('@') ? a : `${a}@emctaipei.com`);
}

export function canViewCase(database: DatabaseSnapshot, session: SessionRecord, row: Row): boolean {
  if (isManager(database, session)) return true;
  const profile = settingsRow(database, session.account || session.user) || {};
  const account = lowerAccount(session.account || session.user);
  const dept = text(profile['部門'] || session.department).replace(/^凱曜(?=.)/, '');
  const group = text(profile['組別']);
  const customer = (database.tables['客戶別']?.rows || []).find(item => text(item['客戶別']) === text(row['客戶別']));
  const list = customer ? parseList(customer['部門組別']) : [];
  const visible = list.length ? list : ['企劃部', '設計部'];
  const designDept = visible.includes('設計部') && (dept === '設計部' || ['平面', '影音'].includes(normGroup(group)));
  if (designDept || (account && visible.some(v => lowerAccount(v) === account)) || (dept && visible.includes(dept)) || (group && visible.includes(group))) return true;
  return ownerMatches(session, row);
}
function ownerMatches(session: SessionRecord, row: Row): boolean {
  const raw = text(row['專案負責人']).toLowerCase();
  const email = (raw.match(/[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}/i) || [''])[0];
  const account = lowerAccount(session.account || session.user);
  const me = [session.user].map(item => text(item).toLowerCase()).filter(Boolean);
  return Boolean((raw && me.includes(raw)) || (raw && account && raw === account) || (email && account && email === account));
}

/* ---------------------------------------------------------------- 工具 */

const ACTIVE = new Set(['未開始', '執行中', '過稿中', '修改中']);
const caseRows = (database: DatabaseSnapshot): Row[] => database.tables.database?.rows || [];
const sameName = (a: unknown, b: unknown) => text(a).toLowerCase() === text(b).toLowerCase();
const submittedDay = (row: Row) => dayNumber(row['填單時間']) ?? dayNumber(row['開始日期']);

export function getCaseCounts(database: DatabaseSnapshot, args: Row, nowMs: number): Row {
  const period = ['today', 'week', 'month'].includes(text(args.period)) ? text(args.period) : 'month';
  const range = periodRange(period, nowMs);
  const rows = caseRows(database);
  const created = (r: Row, from: number, to: number) => { const d = submittedDay(r); return d !== null && d >= from && d <= to; };
  const done = (r: Row, from: number, to: number) => { if (text(r['狀態']) !== '已完成') return false; const d = dayNumber(r['結束日期']); return d !== null && d >= from && d <= to; };
  const tally = (list: Row[]) => ({
    new: list.filter(r => created(r, range.start, range.end)).length,
    active: list.filter(r => ACTIVE.has(text(r['狀態']))).length,
    done: list.filter(r => done(r, range.start, range.end)).length
  });
  const previous = {
    new: rows.filter(r => created(r, range.prevStart, range.prevEnd)).length,
    done: rows.filter(r => done(r, range.prevStart, range.prevEnd)).length
  };
  const result: Row = { period: range.label, ...tally(rows), previous };
  const by = text(args.groupBy);
  if (by === 'client' || by === 'designer') {
    const key = by === 'client' ? '客戶別' : '設計負責人';
    const groups = new Map<string, Row[]>();
    for (const r of rows) { const k = text(r[key]); if (k) groups.set(k, [...(groups.get(k) || []), r]); }
    result.groups = [...groups.entries()].map(([name, list]) => ({ name, ...tally(list) }))
      .filter(g => g.new || g.active || g.done).sort((a, b) => b.new + b.active - (a.new + a.active)).slice(0, 15);
  }
  return result;
}

export function findCase(database: DatabaseSnapshot, session: SessionRecord, args: Row, nowMs: number): Row {
  const keyword = text(args.keyword).toLowerCase();
  if (!keyword) return { found: 0, cases: [], hint: '請提供案名、客戶別或案件編號關鍵字' };
  const today = dayNumber(taipeiDay(nowMs)) as number;
  const hits = caseRows(database)
    .filter(r => [r['專案名稱'], r['客戶別'], r['案件編號']].some(v => text(v).toLowerCase().includes(keyword)))
    .filter(r => canViewCase(database, session, r))
    .sort((a, b) => text(b['案件編號']).localeCompare(text(a['案件編號'])));
  const mods = database.tables['修改紀錄']?.rows || [];
  const cases = hits.slice(0, 3).map(r => {
    const records = mods.filter(m => text(m['案件編號']) === text(r['案件編號']));
    const lastMod = records.map(m => text(m['圖片更新時間'] || m['修改日期'] || m['建立日期'])).sort().pop() || '';
    const touched = dayNumber(lastMod) ?? dayNumber(r['繳交時間']) ?? submittedDay(r);
    return {
      案件編號: text(r['案件編號']), 專案名稱: text(r['專案名稱']), 客戶別: text(r['客戶別']), 狀態: text(r['狀態']),
      階段: text(r['階段']), 設計負責人: text(r['設計負責人']), 結束日期: text(r['結束日期']),
      最近修改紀錄: lastMod || null, 距今幾天沒更新: touched === null ? null : Math.max(0, today - touched)
    };
  });
  return { found: hits.length, cases, hint: hits.length ? undefined : '查不到，請對方換關鍵字' };
}

export function getMyToday(database: DatabaseSnapshot, session: SessionRecord, nowMs: number): Row {
  const today = dayNumber(taipeiDay(nowMs)) as number;
  const profile = settingsRow(database, session.account || session.user) || {};
  const names = [session.user, text(profile['名字']), text(profile['顯示名'])].filter(Boolean);
  const mineAsDesigner = (r: Row) => names.some(n => sameName(r['設計負責人'], n));
  const mine = caseRows(database).filter(r => canViewCase(database, session, r));
  const pendingReply = mine.filter(r => text(r['狀態']) === '過稿中' && ownerMatches(session, r)).length;
  const due = mine.filter(r => {
    if (!ACTIVE.has(text(r['狀態']))) return false;
    if (!mineAsDesigner(r) && !ownerMatches(session, r)) return false;
    const d = dayNumber(r['結束日期']);
    return d !== null && d >= today && d <= today + 3;
  }).map(r => ({ 案件編號: text(r['案件編號']), 專案名稱: text(r['專案名稱']), 結束日期: text(r['結束日期']) })).slice(0, 5);
  const created = mine.filter(r => (mineAsDesigner(r) || ownerMatches(session, r)) && submittedDay(r) === today).length;
  return { pendingReply, dueSoon: due.length, dueCases: due, newToday: created };
}

export function runAssistantTool(name: string, args: Row, database: DatabaseSnapshot, session: SessionRecord, nowMs: number): Row {
  if (name === 'getCaseCounts') return getCaseCounts(database, args, nowMs);
  if (name === 'findCase') return findCase(database, session, args, nowMs);
  if (name === 'getMyToday') return getMyToday(database, session, nowMs);
  return { error: `沒有這個工具：${name}` };
}

/* ---------------------------------------------------------------- 儲存（Durable Object storage） */

export interface AssistantStore {
  get<T = unknown>(key: string): Promise<T | undefined>;
  put(key: string, value: unknown): Promise<void>;
  delete(keys: string | string[]): Promise<unknown>;
  list<T = unknown>(options?: { prefix?: string }): Promise<Map<string, T>>;
}

export interface AssistantLogEntry {
  id: string; ts: string; account: string; user: string; department: string;
  question: string; answer: string; tools: string[]; found: boolean; tokens: number;
  helpful: boolean | null; tired: boolean;
}

export const usageKey = (day: string, account: string) => `assistantUsage:${day}:${account}`;
export const logKey = (day: string, shard = 0) => (shard ? `assistantLog:${day}:${shard}` : `assistantLog:${day}`);

export async function quotaState(store: AssistantStore, session: SessionRecord, nowMs: number): Promise<{ usedRatio: number; tired: boolean }> {
  const used = Number(await store.get<number>(usageKey(taipeiDay(nowMs), canonicalAccount(session.account || session.user)))) || 0;
  return { usedRatio: Math.min(1, used / ASSISTANT_DAILY_TOKENS), tired: used >= ASSISTANT_DAILY_TOKENS };
}

async function appendLog(store: AssistantStore, day: string, entry: AssistantLogEntry): Promise<void> {
  let shard = 0;
  while (true) {
    const key = logKey(day, shard);
    const list = (await store.get<AssistantLogEntry[]>(key)) || [];
    if (list.length < ASSISTANT_LOG_SHARD_SIZE) { list.push(entry); await store.put(key, list); return; }
    shard += 1;
  }
}

export async function recordFeedback(store: AssistantStore, session: SessionRecord, payload: Row, nowMs: number): Promise<boolean> {
  const id = text(payload.logId);
  const account = canonicalAccount(session.account || session.user);
  if (!id) return false;
  const today = Date.parse(`${taipeiDay(nowMs)}T00:00:00Z`);
  for (const offset of [0, 1]) { // 跨午夜時回饋可能是對昨天的紀錄
    const day = taipeiDay(today - offset * DAY_MS);
    for (let shard = 0; shard < 50; shard += 1) {
      const key = logKey(day, shard);
      const list = await store.get<AssistantLogEntry[]>(key);
      if (!list) break;
      const hit = list.find(item => item.id === id && item.account === account);
      if (hit) { hit.helpful = payload.helpful === true; await store.put(key, list); return true; }
    }
  }
  return false;
}

/** 每天只清理一次：刪掉超過保留天數的紀錄與額度 key。 */
export async function cleanupAssistantStorage(store: AssistantStore, nowMs: number): Promise<number> {
  const today = taipeiDay(nowMs);
  if ((await store.get<string>('assistantLogCleanupDate')) === today) return 0;
  const cutoff = taipeiDay(nowMs - ASSISTANT_LOG_KEEP_DAYS * DAY_MS);
  const stale: string[] = [];
  for (const prefix of ['assistantLog:', 'assistantUsage:']) {
    for (const key of (await store.list({ prefix })).keys()) {
      const day = key.slice(prefix.length, prefix.length + 10);
      if (/^\d{4}-\d{2}-\d{2}$/.test(day) && day < cutoff) stale.push(key);
    }
  }
  for (let i = 0; i < stale.length; i += 128) await store.delete(stale.slice(i, i + 128));
  await store.put('assistantLogCleanupDate', today);
  return stale.length;
}

/* ---------------------------------------------------------------- Claude API */

type ChatMessage = { role: 'user' | 'assistant'; content: unknown };
export interface AssistantDeps {
  apiKey?: string;
  fetchImpl?: typeof fetch;
  now?: () => number;
  random?: () => number;
}

export function cleanHistory(history: unknown): ChatMessage[] {
  if (!Array.isArray(history)) return [];
  return history.slice(-ASSISTANT_MAX_HISTORY).map(item => {
    const row = (item || {}) as Row;
    return { role: row.role === 'assistant' ? 'assistant' : 'user', content: text(row.content).slice(0, ASSISTANT_MAX_MESSAGE * 2) } as ChatMessage;
  }).filter(item => item.content);
}

export async function assistantToday(database: DatabaseSnapshot, session: SessionRecord, store: AssistantStore, announcement: Row | null, readAccounts: string[], nowMs: number): Promise<Row & { ok: boolean }> {
  const account = canonicalAccount(session.account || session.user);
  const unread = announcement && text(announcement.version) && !readAccounts.includes(account) ? announcement : null;
  return { ok: true, action: 'assistantToday', today: getMyToday(database, session, nowMs), announcement: unread, quota: await quotaState(store, session, nowMs), day: taipeiDay(nowMs) };
}

export async function assistantChat(
  payload: Row, database: DatabaseSnapshot, session: SessionRecord, store: AssistantStore, deps: AssistantDeps
): Promise<Row & { ok: boolean }> {
  const nowMs = (deps.now || Date.now)();
  const message = text(payload.message).slice(0, ASSISTANT_MAX_MESSAGE);
  if (!message) throw new Error('請輸入想問的問題');
  if (!deps.apiKey) return { ok: true, action: 'assistantChat', reply: NOT_READY_LINE, skipped: true, logId: null, quota: await quotaState(store, session, nowMs) };

  const day = taipeiDay(nowMs);
  const account = canonicalAccount(session.account || session.user);
  const profile = settingsRow(database, session.account || session.user) || {};
  const entry: AssistantLogEntry = {
    id: `${nowMs.toString(36)}-${Math.floor((deps.random || Math.random)() * 1e9).toString(36)}`,
    ts: new Date(nowMs).toISOString(), account, user: session.user, department: text(profile['部門'] || session.department),
    question: message, answer: '', tools: [], found: false, tokens: 0, helpful: null, tired: false
  };
  const usedKey = usageKey(day, account);
  const before = Number(await store.get<number>(usedKey)) || 0;

  if (before >= ASSISTANT_DAILY_TOKENS) {
    const pick = Math.floor((deps.random || Math.random)() * TIRED_LINES.length) % TIRED_LINES.length;
    entry.answer = TIRED_LINES[pick]; entry.tired = true;
    await appendLog(store, day, entry);
    return { ok: true, action: 'assistantChat', reply: entry.answer, logId: entry.id, quota: { usedRatio: 1, tired: true } };
  }

  const fetchImpl = deps.fetchImpl || fetch;
  const messages: ChatMessage[] = [...cleanHistory(payload.history), { role: 'user', content: message }];
  let tokens = 0;
  let reply = TOO_HARD_LINE;
  for (let round = 0; round < ASSISTANT_MAX_ROUNDS; round += 1) {
    const response = await fetchImpl('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-api-key': deps.apiKey, 'anthropic-version': '2023-06-01' },
      body: JSON.stringify({ model: ASSISTANT_MODEL, max_tokens: ASSISTANT_MAX_TOKENS, system: ASSISTANT_SYSTEM_PROMPT, tools: ASSISTANT_TOOLS, messages })
    });
    if (!response.ok) { reply = '小幫手剛剛打了個盹，請再問一次！'; break; }
    const data = await response.json() as { content?: Array<Row>; stop_reason?: string; usage?: { input_tokens?: number; output_tokens?: number } };
    tokens += (Number(data.usage?.input_tokens) || 0) + (Number(data.usage?.output_tokens) || 0);
    const blocks = Array.isArray(data.content) ? data.content : [];
    const uses = blocks.filter(b => b.type === 'tool_use');
    if (data.stop_reason === 'tool_use' && uses.length) {
      messages.push({ role: 'assistant', content: blocks });
      const results = uses.map(use => {
        const name = text(use.name);
        entry.tools.push(name);
        const out = runAssistantTool(name, (use.input || {}) as Row, database, session, nowMs);
        if ((typeof out.found === 'number' ? out.found > 0 : !out.error)) entry.found = true;
        return { type: 'tool_result', tool_use_id: use.id, content: JSON.stringify(out) };
      });
      messages.push({ role: 'user', content: results });
      continue;
    }
    reply = blocks.filter(b => b.type === 'text').map(b => text(b.text)).join('\n').trim() || TOO_HARD_LINE;
    break;
  }

  const after = before + tokens;
  await store.put(usedKey, after);
  if (before < ASSISTANT_DAILY_TOKENS * 0.8 && after >= ASSISTANT_DAILY_TOKENS * 0.8) reply = `${reply}\n${LOW_BATTERY_LINE}`;
  entry.answer = reply; entry.tokens = tokens;
  await appendLog(store, day, entry);
  return { ok: true, action: 'assistantChat', reply, logId: entry.id, quota: { usedRatio: Math.min(1, after / ASSISTANT_DAILY_TOKENS), tired: after >= ASSISTANT_DAILY_TOKENS } };
}

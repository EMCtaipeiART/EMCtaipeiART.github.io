/**
 * 小黃自動讀取 GitHub 上的系統更動：不必等管理者發公告。
 * 來源①：repo 根目錄的 MAINTENANCE_LOG.md（每次修改都會在檔尾記一段「日期＋標題＋做了什麼」，newest last）。
 * 來源②：main 分支最近的 commit 標題（略過自動產生的 data: 備份／稽核 commit）。
 * 結果快取 30 分鐘在 DO storage（key assistantChanges）；抓不到沿用舊資料並 10 分鐘後重試。
 * 兩者都是公開 repo 的內容；這裡只讀、不寫。
 */
import type { AssistantStore } from './assistant';
import { ASSISTANT_CHARACTERS, RETIRED_NAMES } from './assistant-character';

export interface ChangeSection { title: string; body: string }
export interface ChangeCommit { date: string; subject: string }
export interface ChangeLog { sections: ChangeSection[]; commits: ChangeCommit[] }
export interface GithubSource { owner: string; repo: string; branch: string; token?: string }

export const CHANGES_TTL_MS = 30 * 60 * 1000;
export const CHANGES_KEY = 'assistantChanges:v4';
/** 白名單：只有標題帶這個記號的修改紀錄，才會當成「系統更新」告訴同仁；沒標記的一律不說（寧可漏說、不可洩漏內部細節）。 */
export const STAFF_MARK = '【同仁】';
/** 記號必須在標題的「開頭」（日期或 feat: 之類前綴之後）；標題中間提到這幾個字不算，避免討論這個規則的紀錄自己被放行。 */
const hasStaffMark = (head: string): boolean => /^(?:[\w-]+:\s*|[0-9-]+\s+)?【同仁】/.test(head.trim());
const SECTION_KEEP = 8;
const BODY_MAX = 600;
const COMMIT_KEEP = 12;

/** 後台、管理者專屬、部署與內部維護相關的更動，以及小黃自己的運作機制（泡泡、新聞、額度、電池…，屬管理者層面的設定）：小黃不需要向同仁呈現或說明，一律過濾掉。 */
const ADMIN_ONLY_BASE = /後台|admin|password|密碼|source to repo|onkeydown|管理者|管理員|教小黃|試問|用量|待補|稽核|備份|還原|金鑰|部署|Worker|DO storage|schema|測試|重構|知識庫|維護手冊|走訪|wrangler|ANTHROPIC|CLAUDE\.md|ASSISTANT\.md|小幫手|機器人|泡泡|氣泡|彈出|額度|電池|充電|新聞|\bNEW\b|新上架|角色名字|寫死|常數|提示詞|prompt|tokens?|快取|集中設定|lens-shop|lens-group-buy|團購|到貨|通知到貨/i;
const escapeRe = (v: string) => v.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
/** 小幫手角色的名字會換，所以名字不寫死在正規表示式裡，從 assistant-character.ts 取。 */
export const ADMIN_ONLY = new RegExp(ADMIN_ONLY_BASE.source + '|' + [...ASSISTANT_CHARACTERS.map(x => x.name), ...RETIRED_NAMES].map(escapeRe).join('|'), 'i');
export const isAdminOnly = (value: string): boolean => ADMIN_ONLY.test(value);

/** 取檔尾最新的 N 段「## 標題」；回傳新到舊。 */
export function parseChangeLog(markdown: string, keep = SECTION_KEEP): ChangeSection[] {
  const parts = markdown.replace(/\r\n/g, '\n').split(/^## /m).slice(1);
  return parts.filter(part => { const head = part.split('\n')[0] || ''; return hasStaffMark(head) && !isAdminOnly(head.replace(STAFF_MARK, '')); }).slice(-keep).reverse().map(part => {
    const [title, ...rest] = part.split('\n');
    return { title: title.replace(STAFF_MARK, '').replace(/\s+/g, ' ').trim().slice(0, 120), body: rest.join('\n').trim().slice(0, BODY_MAX) };
  }).filter(section => section.title);
}

const taipeiDate = (iso: string): string => {
  const t = new Date(Date.parse(iso) + 8 * 3600000);
  return Number.isNaN(t.getTime()) ? '' : `${t.getUTCFullYear()}-${String(t.getUTCMonth() + 1).padStart(2, '0')}-${String(t.getUTCDate()).padStart(2, '0')}`;
};

export function parseCommits(json: unknown): ChangeCommit[] {
  if (!Array.isArray(json)) return [];
  const out: ChangeCommit[] = [];
  for (const item of json as Array<{ commit?: { message?: string; committer?: { date?: string } } }>) {
    const subject = String(item?.commit?.message || '').split('\n')[0].trim();
    if (!hasStaffMark(subject) || isAdminOnly(subject.replace(STAFF_MARK, ''))) continue; /* commit 標題多半是工程用語，一樣只收帶同仁記號的 */
    out.push({ date: taipeiDate(String(item?.commit?.committer?.date || '')), subject: subject.replace(STAFF_MARK, '').trim().slice(0, 140) });
    if (out.length >= COMMIT_KEEP) break;
  }
  return out;
}

export async function getChangeLog(store: AssistantStore, nowMs: number, source: GithubSource, fetchImpl: typeof fetch = fetch): Promise<ChangeLog> {
  const cached = await store.get<{ fetchedAt: number; log: ChangeLog }>(CHANGES_KEY);
  if (cached && nowMs - cached.fetchedAt < CHANGES_TTL_MS) return cached.log;
  const owner = encodeURIComponent(source.owner), repo = encodeURIComponent(source.repo), branch = encodeURIComponent(source.branch);
  const headers: Record<string, string> = { 'user-agent': 'emc-assistant', accept: 'application/vnd.github+json' };
  if (source.token) headers.authorization = `Bearer ${source.token}`;
  const log: ChangeLog = { sections: [], commits: [] };
  try {
    const raw = await fetchImpl(`https://raw.githubusercontent.com/${owner}/${repo}/${branch}/MAINTENANCE_LOG.md`, { headers: { 'user-agent': 'emc-assistant' }, signal: AbortSignal.timeout(8000) });
    if (raw.ok) log.sections = parseChangeLog(await raw.text());
  } catch { /* 抓不到就略過這個來源 */ }
  try {
    const res = await fetchImpl(`https://api.github.com/repos/${owner}/${repo}/commits?sha=${branch}&per_page=40`, { headers, signal: AbortSignal.timeout(8000) });
    if (res.ok) log.commits = parseCommits(await res.json());
  } catch { /* 同上 */ }
  if (!log.sections.length && !log.commits.length) {
    await store.put(CHANGES_KEY, { fetchedAt: nowMs - CHANGES_TTL_MS + 10 * 60 * 1000, log: cached?.log || log });
    return cached?.log || log;
  }
  await store.put(CHANGES_KEY, { fetchedAt: nowMs, log });
  return log;
}

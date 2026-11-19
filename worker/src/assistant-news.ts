/**
 * 小黃滑鼠提示用的「新聞話題」：每 3 小時從 Google News RSS 抓一次標題（設計相關＋科技新聞，刻意不抓政治類頭條），
 * 存在 Durable Object storage。不呼叫 Claude、不花 token；抓不到就沿用舊的或回空陣列，前端退回功能小提示。
 * 只存標題、來源與連結，不存文章內容。
 */
import type { AssistantStore } from './assistant';

export interface NewsItem { title: string; source: string; link: string; topic: 'design' | 'news' }

export const NEWS_TTL_MS = 3 * 60 * 60 * 1000;
export const NEWS_KEY = 'assistantNews';
const PER_TOPIC = 6;

export const NEWS_FEEDS: Array<{ topic: NewsItem['topic']; url: string }> = [
  { topic: 'design', url: 'https://news.google.com/rss/search?q=%22%E5%B9%B3%E9%9D%A2%E8%A8%AD%E8%A8%88%22%20OR%20%22%E5%93%81%E7%89%8C%E8%A8%AD%E8%A8%88%22%20OR%20%22%E8%A6%96%E8%A6%BA%E8%A8%AD%E8%A8%88%22%20OR%20%22%E5%8C%85%E8%A3%9D%E8%A8%AD%E8%A8%88%22%20OR%20%22%E8%A8%AD%E8%A8%88%E8%B6%A8%E5%8B%A2%22%20OR%20%22%E6%B5%B7%E5%A0%B1%E8%A8%AD%E8%A8%88%22%20when%3A7d&hl=zh-TW&gl=TW&ceid=TW:zh-Hant' },
  { topic: 'news', url: 'https://news.google.com/rss/headlines/section/topic/TECHNOLOGY?hl=zh-TW&gl=TW&ceid=TW:zh-Hant' }
];

const decode = (value: string): string => value
  .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1')
  .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;|&apos;/g, "'").replace(/&amp;/g, '&')
  .replace(/<[^>]+>/g, '').trim();

/** 同仁看的提示：不放政治、命案、災難、色情等字眼的標題；設計新聞還要真的跟設計有關。 */
const UNSAFE = /死|殺|屍|命案|墜樓|自殺|性侵|猥褻|車禍|火警|地震|空襲|戰爭|開戰|選舉|罷免|總統|立委|政黨|國民黨|民進黨|共軍|川普|習近平|普丁|詐騙|毒|槍/;
const DESIGN_WORDS = /設計|海報|品牌|包裝|視覺|插畫|美術|排版|字體|LOGO|UI|UX|色彩|展覽|策展/i;
export function keepItem(item: NewsItem): boolean {
  if (UNSAFE.test(item.title)) return false;
  return item.topic !== 'design' || DESIGN_WORDS.test(item.title);
}

export function parseRss(xml: string, topic: NewsItem['topic']): NewsItem[] {
  const items: NewsItem[] = [];
  for (const match of xml.matchAll(/<item>([\s\S]*?)<\/item>/g)) {
    const block = match[1];
    const rawTitle = decode((block.match(/<title>([\s\S]*?)<\/title>/) || [])[1] || '');
    const link = decode((block.match(/<link>([\s\S]*?)<\/link>/) || [])[1] || '');
    const source = decode((block.match(/<source[^>]*>([\s\S]*?)<\/source>/) || [])[1] || '');
    if (!rawTitle || !/^https?:\/\//.test(link)) continue;
    const title = source && rawTitle.endsWith(` - ${source}`) ? rawTitle.slice(0, -(source.length + 3)) : rawTitle;
    const item: NewsItem = { title: title.slice(0, 80), source: source.slice(0, 30), link, topic };
    if (!keepItem(item)) continue;
    items.push(item);
    if (items.length >= PER_TOPIC) break;
  }
  return items;
}

export async function getNewsTicker(store: AssistantStore, nowMs: number, fetchImpl: typeof fetch = fetch): Promise<NewsItem[]> {
  const cached = await store.get<{ fetchedAt: number; items: NewsItem[] }>(NEWS_KEY);
  if (cached && nowMs - cached.fetchedAt < NEWS_TTL_MS) return cached.items;
  const fresh: NewsItem[] = [];
  for (const feed of NEWS_FEEDS) {
    try {
      const response = await fetchImpl(feed.url, { headers: { 'user-agent': 'Mozilla/5.0 (emc-art assistant)' }, signal: AbortSignal.timeout(6000) });
      if (response.ok) fresh.push(...parseRss(await response.text(), feed.topic));
    } catch { /* 這個來源抓不到就略過 */ }
  }
  if (!fresh.length) {
    // 抓不到：先沿用舊資料，10 分鐘後再試，避免每次都卡在逾時
    await store.put(NEWS_KEY, { fetchedAt: nowMs - NEWS_TTL_MS + 10 * 60 * 1000, items: cached?.items || [] });
    return cached?.items || [];
  }
  await store.put(NEWS_KEY, { fetchedAt: nowMs, items: fresh });
  return fresh;
}

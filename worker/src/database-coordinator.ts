import { DurableObject } from 'cloudflare:workers';
import { publicSystemAnnouncement, systemAnnouncementReadRecords, TABLE_SCHEMAS } from '../../backend/schema.mjs';
import {
  VERSION, ACCESS_CAPABILITIES, ACCESS_PAGES, ISSUE_STATUSES, SUPPLEMENT_SLOTS,
  SHORTCUT_ADMIN_ACCOUNT, SHORTCUT_TESTER_ACCOUNT,
  accessProfile, activeReel, canonicalAccount, findReelIndex,
  hasCapability, hasRowCapability, isHttpUrl, issueRow, monthFromDate, nextCaseId, normalizeSnapshot,
  nowTaipei, parseComments, publicReel, recalculateDatabaseModificationCounts, recalculateDatabaseWeights, reelFileId, requireCapability,
  designerRowsForGroup, isDesignerSettingsRow,
  rowYear, settingsResponse, settingsRow, splitNames, syncSupplementLinks, tableNames,
  text, toApiRow, toSheetRow, unique, updateSettingsRow, weightRules
} from './model';
import { commitGitHubDatabase, loadGitHubDatabase } from './github-store';
import type {
  ApiPayload, ApiResult, DatabaseSnapshot, RequestContext, Row, SessionRecord, StoredSnapshot
} from './types';

const STATE_KEY = 'primary';
const MAX_LOGIN_ATTEMPTS = 12;
const LOGIN_WINDOW_MS = 10 * 60 * 1000;
// Cloudflare Workers caps Web Crypto PBKDF2 at 100,000 iterations.
const LOCAL_PASSWORD_ITERATIONS = 100_000;
const LOCAL_PASSWORD_PREFIX = 'pbkdf2-sha256';
const ADMIN_TABLE_ORDER = ['database', '系統公告欄', '加權計分標準', '短連結', '補充資料連結', '修改統計表', '設定', '角色權限範本', '客戶別', '帳號權限', '組織選項', 'reels', 'bug_report'];

type MutatorResult = { result: ApiResult; changed?: boolean; changedTables?: string[] };
type GmailTokenRow = { account: string; refresh_token: string; access_token: string | null; access_token_expires_at: number | null; gmail_address: string | null };
type ScheduledMailRow = {
  id: string; case_id: string; kind: 'send' | 'reply'; owner_account: string; requested_by: string;
  to_address: string; cc_address: string; subject: string; body_html: string; signature_html: string;
  inline_images: string; scheduled_at: number; status: 'pending' | 'sending' | 'sent' | 'failed' | 'canceled';
  error_message: string | null; created_at: string; updated_at: string;
};

function cloneDatabase(database: DatabaseSnapshot): DatabaseSnapshot {
  return structuredClone(database);
}

function asRow(value: unknown): Row {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Row : {};
}

function asRows(value: unknown): Row[] {
  return Array.isArray(value) ? value.filter(item => item && typeof item === 'object' && !Array.isArray(item)) as Row[] : [];
}

function normalizedTableRow(headers: string[], value: unknown): Row {
  const source = asRow(value);
  return Object.fromEntries(headers.map(header => [header, text(source[header])])) as Row;
}

function rowsDiffer(headers: string[], left: Row, right: Row): boolean {
  return headers.some(header => text(left[header]) !== text(right[header]));
}

function normalizedAccessList(value: unknown, allowed: string[]): string[] {
  let values: unknown[] = [];
  if (Array.isArray(value)) values = value;
  else {
    const raw = text(value);
    if (raw) {
      try {
        const parsed = JSON.parse(raw);
        values = Array.isArray(parsed) ? parsed : [];
      } catch { values = raw.split(/[\n,，、|｜]/); }
    }
  }
  return unique(values.map(text).filter(item => allowed.includes(item)));
}

function normalizedSkillMappings(value: unknown): Array<{ name: string; type: string; stage: string }> {
  const rows = Array.isArray(value) ? value : (() => { try { const parsed = JSON.parse(text(value)); return Array.isArray(parsed) ? parsed : []; } catch { return []; } })();
  const seen = new Set<string>();
  return rows.map(asRow).map(row => ({
    name: text(row.name || row['技能']), type: text(row.type || row['設計種類']) || '平面', stage: text(row.stage || row['階段']) || '後製'
  })).filter(row => row.name && !seen.has(row.name) && (seen.add(row.name), true)).slice(0, 30);
}

function normalizedReplyTemplates(value: unknown): Record<string, string> {
  let source = value;
  if (typeof source === 'string') { try { source = JSON.parse(source); } catch { source = {}; } }
  const entries: Array<[string, string]> = Array.isArray(source)
    ? source.map(item => {
      const row = asRow(item);
      return [text(row.detail || row['項目細節']), text(row.content || row.text || row['回信內容'])];
    })
    : (source && typeof source === 'object'
      ? Object.entries(source as Record<string, unknown>).map(([detail, content]) => [text(detail), text(content)])
      : []);
  return Object.fromEntries(entries.filter(([detail, content]) => detail && content && detail.length <= 80 && content.length <= 10000).slice(0, 80));
}

function sessionToken(payload: ApiPayload): string {
  return text(payload.editorToken || payload.token);
}
/** 台北時區的當日 MMDD，作為管理者捷徑密碼；每天自動失效。 */
function taipeiMonthDay(now = new Date()): string {
  const parts = Object.fromEntries(new Intl.DateTimeFormat('en-US', { timeZone: 'Asia/Taipei', month: '2-digit', day: '2-digit' })
    .formatToParts(now).map(part => [part.type, part.value]));
  return `${parts.month}${parts.day}`;
}
/**
 * 測試捷徑登入：密碼 test → 測試使用者、當日 MMDD → 管理員。
 * 這是刻意保留的弱密碼入口，僅對應這兩個帳號，其餘帳號一律走 ADMIN_LOGIN_ACCOUNTS + ADMIN_LOGIN_PASSWORD。
 */
function shortcutLoginAccount(password: string, now = new Date()): string {
  const value = text(password);
  if (!value) return '';
  if (value === 'test') return SHORTCUT_TESTER_ACCOUNT;
  if (value === taipeiMonthDay(now)) return SHORTCUT_ADMIN_ACCOUNT;
  return '';
}

function commitMessage(action: string, session: SessionRecord | null): string {
  const actor = text(session?.user || session?.account || 'anonymous');
  return `data: ${action} via Cloudflare Worker (${actor})`;
}

async function sha256Base64Url(value: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value));
  const bytes = new Uint8Array(digest);
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
}

function randomToken(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(32));
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return `${crypto.randomUUID()}.${btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '')}`;
}

async function secureEqual(actual: string, expected: string): Promise<boolean> {
  const [left, right] = await Promise.all([
    crypto.subtle.digest('SHA-256', new TextEncoder().encode(actual)),
    crypto.subtle.digest('SHA-256', new TextEncoder().encode(expected))
  ]);
  const subtle = crypto.subtle as SubtleCrypto & {
    timingSafeEqual(a: ArrayBuffer | ArrayBufferView, b: ArrayBuffer | ArrayBufferView): boolean;
  };
  return subtle.timingSafeEqual(left, right);
}

function bytesToBase64Url(bytes: Uint8Array): string {
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
}

function base64UrlToBytes(value: string): Uint8Array<ArrayBuffer> {
  const padded = value.replace(/-/g, '+').replace(/_/g, '/').padEnd(Math.ceil(value.length / 4) * 4, '=');
  const binary = atob(padded);
  return Uint8Array.from(binary, character => character.charCodeAt(0));
}

async function deriveLocalPassword(password: string, salt: Uint8Array<ArrayBuffer>, iterations = LOCAL_PASSWORD_ITERATIONS): Promise<Uint8Array<ArrayBuffer>> {
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(password), 'PBKDF2', false, ['deriveBits']);
  const bits = await crypto.subtle.deriveBits({ name: 'PBKDF2', hash: 'SHA-256', salt, iterations }, key, 256);
  return new Uint8Array(bits);
}

async function hashLocalPassword(password: string): Promise<string> {
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const derived = await deriveLocalPassword(password, salt);
  return `${LOCAL_PASSWORD_PREFIX}$${LOCAL_PASSWORD_ITERATIONS}$${bytesToBase64Url(salt)}$${bytesToBase64Url(derived)}`;
}

async function verifyLocalPassword(password: string, encoded: unknown): Promise<boolean> {
  const [prefix, iterationText, saltText, expectedText, ...extra] = text(encoded).split('$');
  const iterations = Number(iterationText);
  if (prefix !== LOCAL_PASSWORD_PREFIX || extra.length || !Number.isInteger(iterations) || iterations < 100_000 || iterations > 1_000_000 || !saltText || !expectedText) return false;
  try {
    const expected = base64UrlToBytes(expectedText);
    const actual = await deriveLocalPassword(password, base64UrlToBytes(saltText), iterations);
    if (actual.byteLength !== expected.byteLength) return false;
    const subtle = crypto.subtle as SubtleCrypto & {
      timingSafeEqual(a: ArrayBuffer | ArrayBufferView, b: ArrayBuffer | ArrayBufferView): boolean;
    };
    return subtle.timingSafeEqual(actual, expected);
  } catch { return false; }
}

function isReservedShortcutPassword(password: string): boolean {
  return password === 'test' || /^\d{4}$/.test(password);
}

function parseCommentList(value: unknown): Row[] {
  return parseComments(value).map(item => ({ ...item }));
}

function parseCaseDesignImages_(row: Row): { fileName: string; url: string }[] {
  try {
    const parsed = JSON.parse(text(row['圖片連結']) || '[]');
    if (!Array.isArray(parsed)) return [];
    return parsed
      .map(item => (item && typeof item === 'object' && !Array.isArray(item))
        ? { fileName: text((item as Row).fileName), url: text((item as Row).url) }
        : { fileName: '', url: text(item) })
      .filter(item => isHttpUrl(item.url));
  } catch { return []; }
}

function utf8ToBase64Url(value: string): string {
  return bytesToBase64Url(new TextEncoder().encode(value));
}

/** RFC 2047 encoded-word，避免中文主旨在信件標頭裡變成亂碼。 */
function encodeMimeHeaderText(value: string): string {
  return `=?UTF-8?B?${btoa(String.fromCharCode(...new TextEncoder().encode(value)))}?=`;
}

/** 把單一個「顯示名 <email>」或純 email 字串，依 RFC 2047 把顯示名編碼——沒有這一步，中文顯示名會以未宣告編碼的原始 UTF-8 位元組寫進標頭，部分郵件用戶端（含 Gmail 本身）會顯示成亂碼。 */
function encodeMimeAddress(raw: string): string {
  const trimmed = raw.trim();
  const match = trimmed.match(/^"?([^"<]*?)"?\s*<([^<>]+)>$/);
  if (!match) return trimmed;
  const name = match[1].trim();
  const email = match[2].trim();
  if (!name) return `<${email}>`;
  if (/^[\x20-\x7e]*$/.test(name)) return /[",]/.test(name) ? `"${name.replace(/"/g, '\\"')}" <${email}>` : `${name} <${email}>`;
  return `${encodeMimeHeaderText(name)} <${email}>`;
}

function mimeAddressList(value: string): string {
  return value.split(',').map(part => part.trim()).filter(Boolean).map(encodeMimeAddress).join(', ');
}

/** 把 HTML 內容轉成陽春的純文字版本，當 multipart/alternative 的 text/plain 備援分支——Workers 執行環境沒有 DOM，用正規表達式手動處理，不追求完美還原格式，只求可讀。 */
function htmlToPlainText(html: string): string {
  return html
    .replace(/<(script|style)[^>]*>[\s\S]*?<\/\1>/gi, '')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/(p|div|li|tr)>/gi, '\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'")
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

function base64Encode(value: string): string {
  return btoa(String.fromCharCode(...new TextEncoder().encode(value))).replace(/(.{76})/g, '$1\n');
}

function wrapMimeBase64(value: string): string {
  return value.replace(/\s+/g, '').replace(/(.{76})/g, '$1\r\n').replace(/\r\n$/, '');
}

function escapeHtml(value: string): string {
  return value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

/** payload 沒有帶 bodyHtml（例如舊呼叫端還在傳純文字）時的備援：把純文字逃脫後轉成等效的 HTML 段落。 */
function resolveBodyHtml(payload: ApiPayload): string {
  const bodyHtml = text(payload.bodyHtml);
  if (bodyHtml) return bodyHtml;
  return escapeHtml(text(payload.bodyText)).replace(/\n/g, '<br>');
}

type GmailInlineImage = { contentId: string; fileName: string; mimeType: string; base64: string; bytes: number };
const GMAIL_INLINE_IMAGE_TYPES = new Set(['image/jpeg', 'image/png', 'image/webp', 'image/gif']);
const GMAIL_INLINE_IMAGE_MAX_COUNT = 10;
const GMAIL_INLINE_IMAGE_MAX_BYTES = 8 * 1024 * 1024;
const GMAIL_INLINE_IMAGE_MAX_TOTAL_BYTES = 18 * 1024 * 1024;
/** 瀏覽信件串時，每封信最多回抓幾張內嵌圖片的縮圖、整條信件串最多回抓幾張——只是控制 Worker 對 Gmail API
 * 額外呼叫次數與回應大小的上限，不是安全性邊界；超過上限的圖片不會顯示縮圖，但文字內容仍然完整顯示。 */
const GMAIL_THREAD_IMAGE_LIMIT_PER_MESSAGE = 6;
const GMAIL_THREAD_IMAGE_LIMIT_TOTAL = 24;

function resolveGmailInlineImages(payload: ApiPayload): GmailInlineImage[] {
  const values = Array.isArray(payload.inlineImages) ? payload.inlineImages : [];
  if (values.length > GMAIL_INLINE_IMAGE_MAX_COUNT) throw new Error(`每封信最多可放 ${GMAIL_INLINE_IMAGE_MAX_COUNT} 張照片`);
  let totalBytes = 0;
  return values.map((value, index) => {
    const row = asRow(value);
    const mimeType = text(row.mimeType).toLowerCase();
    const rawBase64 = text(row.base64).replace(/^data:[^;,]+;base64,/i, '').replace(/\s+/g, '');
    const contentId = text(row.contentId);
    if (!GMAIL_INLINE_IMAGE_TYPES.has(mimeType)) throw new Error('信件照片僅支援 JPG、PNG、WebP 或 GIF');
    if (!/^[A-Za-z0-9._@-]{1,160}$/.test(contentId)) throw new Error('信件照片識別碼格式錯誤');
    if (!rawBase64 || !/^[A-Za-z0-9+/]*={0,2}$/.test(rawBase64)) throw new Error('信件照片內容格式錯誤');
    const padding = rawBase64.endsWith('==') ? 2 : rawBase64.endsWith('=') ? 1 : 0;
    const bytes = Math.max(0, Math.floor(rawBase64.length * 3 / 4) - padding);
    if (bytes > GMAIL_INLINE_IMAGE_MAX_BYTES) throw new Error('單張信件照片不可超過 8 MB');
    totalBytes += bytes;
    if (totalBytes > GMAIL_INLINE_IMAGE_MAX_TOTAL_BYTES) throw new Error('信件內嵌照片總量不可超過 18 MB');
    const extension = mimeType === 'image/jpeg' ? 'jpg' : mimeType.slice('image/'.length);
    return { contentId, fileName: `inline-${index + 1}.${extension}`, mimeType, base64: rawBase64, bytes };
  });
}

function gmailBodyWithSignature(bodyHtml: string, signatureHtml = ''): string {
  if (!signatureHtml.trim()) return bodyHtml;
  return `${bodyHtml}<br><br><div>${signatureHtml}</div>`;
}

function gmailPlainBodyWithSignature(bodyHtml: string, signatureHtml = ''): string {
  const bodyText = htmlToPlainText(bodyHtml);
  const signatureText = htmlToPlainText(signatureHtml);
  return signatureText ? `${bodyText}\n\n${signatureText}`.trim() : bodyText;
}

/** 組出寄送用的 RFC822 MIME 信件：一般信件為 multipart/alternative，含照片時改用 multipart/related 包住內嵌 CID 圖片。 */
function buildGmailRawMessage(options: { to: string; cc?: string; subject: string; bodyHtml: string; signatureHtml?: string; quotedHtml?: string; quotedText?: string; inlineImages?: GmailInlineImage[]; threadHeaders?: { inReplyTo: string; references: string; subject: string } }): string {
  const headers: string[] = [];
  headers.push(`To: ${mimeAddressList(options.to)}`);
  if (options.cc && mimeAddressList(options.cc)) headers.push(`Cc: ${mimeAddressList(options.cc)}`);
  const subjectText = options.threadHeaders ? options.threadHeaders.subject : options.subject;
  headers.push(`Subject: ${encodeMimeHeaderText(subjectText)}`);
  if (options.threadHeaders) {
    headers.push(`In-Reply-To: ${options.threadHeaders.inReplyTo}`);
    headers.push(`References: ${options.threadHeaders.references}`);
  }
  headers.push('MIME-Version: 1.0');
  const boundary = `machi_alt_${crypto.randomUUID().replace(/-/g, '')}`;
  const relatedBoundary = `machi_related_${crypto.randomUUID().replace(/-/g, '')}`;
  const images = options.inlineImages || [];
  headers.push(`Content-Type: ${images.length ? 'multipart/related' : 'multipart/alternative'}; boundary="${images.length ? relatedBoundary : boundary}"`);
  const fullHtml = `${gmailBodyWithSignature(options.bodyHtml, options.signatureHtml)}${options.quotedHtml ? `<br><br>${options.quotedHtml}` : ''}`;
  const fullPlainText = `${gmailPlainBodyWithSignature(options.bodyHtml, options.signatureHtml)}${options.quotedText ? `\n\n${options.quotedText}` : ''}`;
  const plainPart = [
    `--${boundary}`,
    'Content-Type: text/plain; charset="UTF-8"',
    'Content-Transfer-Encoding: base64',
    '',
    base64Encode(fullPlainText)
  ].join('\r\n');
  const htmlPart = [
    `--${boundary}`,
    'Content-Type: text/html; charset="UTF-8"',
    'Content-Transfer-Encoding: base64',
    '',
    base64Encode(fullHtml)
  ].join('\r\n');
  const alternativeBody = `${plainPart}\r\n${htmlPart}\r\n--${boundary}--`;
  const relatedParts = images.map(image => [
    `--${relatedBoundary}`,
    `Content-Type: ${image.mimeType}; name="${image.fileName}"`,
    'Content-Transfer-Encoding: base64',
    `Content-ID: <${image.contentId}>`,
    `Content-Disposition: inline; filename="${image.fileName}"`,
    '',
    wrapMimeBase64(image.base64)
  ].join('\r\n')).join('\r\n');
  const body = images.length
    ? `--${relatedBoundary}\r\nContent-Type: multipart/alternative; boundary="${boundary}"\r\n\r\n${alternativeBody}\r\n${relatedParts}\r\n--${relatedBoundary}--`
    : alternativeBody;
  const mime = `${headers.join('\r\n')}\r\n\r\n${body}`;
  return utf8ToBase64Url(mime);
}

type GmailMessagePart = {
  mimeType?: string;
  headers?: Array<{ name?: string; value?: string }>;
  body?: { data?: string; attachmentId?: string; size?: number };
  parts?: GmailMessagePart[];
};

/** 遞迴走訪 Gmail 訊息的 MIME parts，優先取 text/plain。 */
function extractPlainTextFromGmailPayload(payload: GmailMessagePart | undefined): string {
  if (!payload) return '';
  if (payload.mimeType === 'text/plain' && payload.body?.data) {
    try { return new TextDecoder('utf-8').decode(base64UrlToBytes(payload.body.data)); } catch { return ''; }
  }
  for (const part of payload.parts || []) {
    const found = extractPlainTextFromGmailPayload(part);
    if (found) return found;
  }
  return '';
}

/** 只在 Worker 內部解碼原始 HTML，用於轉純文字及擷取結構化連結；原始 HTML 不會回傳前端。 */
function extractHtmlFromGmailPayload(payload: GmailMessagePart | undefined): string {
  if (!payload) return '';
  if (payload.mimeType === 'text/html' && payload.body?.data) {
    try { return new TextDecoder('utf-8').decode(base64UrlToBytes(payload.body.data)); } catch { return ''; }
  }
  for (const part of payload.parts || []) {
    const found = extractHtmlFromGmailPayload(part);
    if (found) return found;
  }
  return '';
}

/** 少數 HTML-only 信件沒有 text/plain；在 Worker 端轉成純文字，仍不把外部寄件人的原始 HTML 傳給前端。 */
function extractHtmlAsPlainTextFromGmailPayload(payload: GmailMessagePart | undefined): string {
  return htmlToPlainText(extractHtmlFromGmailPayload(payload));
}

/** 遞迴走訪 MIME parts，找出所有「圖片＋有 attachmentId」的 part（不管是不是嚴格的 inline 附件，
 * 只要是圖片一律當縮圖抓回來顯示——比起去解析 HTML 本文裡的 cid: 參照再一一比對，這樣抓得到的
 * 圖片集合更完整也更不容易遺漏，反正只是拿來當唯讀縮圖顯示，不是要精確還原原始排版）。 */
function collectGmailImageParts(payload: GmailMessagePart | undefined, out: GmailMessagePart[] = []): GmailMessagePart[] {
  if (!payload) return out;
  if (text(payload.mimeType).toLowerCase().startsWith('image/') && payload.body?.attachmentId) out.push(payload);
  for (const part of payload.parts || []) collectGmailImageParts(part, out);
  return out;
}

/** Gmail 附件 API 回傳的 data 是 base64url，data: URI 需要標準 base64——兩者差別只在 62/63 這兩個字元跟結尾補
 * 齊，直接字元替換＋補 padding 即可，不需要真的解碼成 bytes 再重新編碼一次。 */
function gmailAttachmentDataUrl(mimeType: string, base64UrlData: string): string {
  const standard = base64UrlData.replace(/-/g, '+').replace(/_/g, '/');
  const padded = standard + '='.repeat((4 - (standard.length % 4)) % 4);
  return `data:${mimeType || 'image/png'};base64,${padded}`;
}

/** 從單一標頭值（可能是逗號分隔的多個「顯示名 <email>」或純 email）擷取出所有 email，一律轉小寫方便比對。 */
function extractEmailAddressesFromHeader(value: string): string[] {
  return (value.match(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi) || []).map(email => email.toLowerCase());
}

/** 跟 extractEmailAddressesFromHeader 類似，但保留每個地址原本的顯示名（沒有顯示名才只剩 email）——
 * 給需要把建議收件人／副本顯示給使用者看（而不是只拿來做 email 比對）的地方用，例如
 * computeReplySuggestion 組出的副本清單，這樣信件編輯器的聯絡人晶片才能顯示姓名而不是一長串信箱。 */
function extractAddressEntriesFromHeader(value: string): { email: string; full: string }[] {
  return value.split(',').map(part => part.trim()).filter(Boolean).map(part => {
    const match = part.match(/^"?([^"<]*?)"?\s*<([^<>]+)>$/);
    const email = (match ? match[2] : part).trim().toLowerCase();
    const name = match ? match[1].trim() : '';
    return { email, full: name ? `${name} <${email}>` : email };
  }).filter(entry => /^[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}$/i.test(entry.email));
}

/** 彙整整條信件串裡（不分哪一封信）出現過的所有收件人／寄件人／副本 email，用來判斷「這個系統帳號算不算
 * 這封信的相關人」——這是查看/回覆信件串真正的權限依據，取代原本「只有當初按下寄出的那個帳號」的嚴格比對。 */
function gmailThreadParticipantEmails(messages: unknown[]): Set<string> {
  const emails = new Set<string>();
  for (const message of messages) {
    const headers = (asRow(asRow(message).payload).headers) as Array<{ name?: string; value?: string }> | undefined;
    for (const name of ['From', 'To', 'Cc']) extractEmailAddressesFromHeader(gmailHeaderValue(headers, name)).forEach(email => emails.add(email));
  }
  return emails;
}

/** 目前登入帳號本身的 email 是否出現在這條信件串的收件人/寄件人/副本裡——只有「信件內容本身相關的人」
 * 才看得到內容、也才能回信，不是只要有系統層級的發信權限就行，其他帳號完全看不到這個案件的通信內容。 */
function accountIsGmailThreadParticipant(account: unknown, messages: unknown[]): boolean {
  const email = canonicalAccount(account);
  if (!email || !email.includes('@')) return false;
  return gmailThreadParticipantEmails(messages).has(email);
}

/** 信件串只顯示來回內容：移除標準簽名分隔線以及常見行動裝置簽名。 */
function stripSignatureFromPlainText(value: string, knownSignatureText = ''): string {
  let body = value.replace(/\r\n?/g, '\n');
  const separator = body.search(/(?:^|\n)--[ \t]*(?:\n|$)/);
  if (separator >= 0) body = body.slice(0, separator);
  const known = knownSignatureText.replace(/\r\n?/g, '\n').trim();
  if (known && body.trimEnd().endsWith(known)) body = body.trimEnd().slice(0, -known.length);
  body = body.replace(/\n*(?:Sent from my (?:iPhone|iPad|Android)|Get Outlook for (?:iOS|Android)|從我的 iPhone 傳送|由我的 iPhone 送出)[\s\S]*$/i, '');
  return body.trim();
}

/** 每封信只保留該次新增的內容，移除 Gmail／Outlook 已內嵌的舊引用，避免重建完整 thread 時重複堆疊。 */
function stripQuotedHistoryFromPlainText(value: string): string {
  const lines = value.replace(/\r\n?/g, '\n').split('\n');
  let quoteStart = -1;
  for (let index = 0; index < lines.length; index += 1) {
    const trimmed = lines[index].trim();
    if (/^>/.test(trimmed) || /^-{2,}\s*(?:Original Message|原始郵件)\s*-{2,}$/i.test(trimmed)) {
      quoteStart = index;
      break;
    }
    if (/(?:wrote:|寫道[:：])$/i.test(trimmed)) {
      quoteStart = index;
      for (let previous = index - 1; previous >= Math.max(0, index - 3); previous -= 1) {
        if (!lines[previous].trim()) break;
        quoteStart = previous;
        if (/^On\s/i.test(lines[previous].trim())) break;
      }
      break;
    }
    if (/^(?:From|寄件者|寄件人):\s*/i.test(trimmed)) {
      if (lines.slice(index, index + 6).some(nextLine => /^(?:Subject|主旨):\s*/i.test(nextLine.trim()))) {
        quoteStart = index;
        break;
      }
    }
  }
  return (quoteStart >= 0 ? lines.slice(0, quoteStart) : lines).join('\n').trim();
}

/** 原始 HTML 也只保留該封新增內容，簽名與引用串後方的標記一律截掉。 */
function gmailMessageVisibleHtml(message: Row, knownSignatureHtml = ''): string {
  const payload = message.payload as GmailMessagePart | undefined;
  const html = extractHtmlFromGmailPayload(payload);
  if (!html) return '';
  let visibleEnd = html.length;
  const hiddenMarker = html.match(/<(?:div|blockquote)\b[^>]*class\s*=\s*["'][^"']*\bgmail_(?:signature|quote)\b[^"']*["'][^>]*>|<blockquote\b[^>]*type\s*=\s*["']?cite["']?[^>]*>/i);
  if (hiddenMarker?.index !== undefined) visibleEnd = Math.min(visibleEnd, hiddenMarker.index);
  const knownSignature = knownSignatureHtml.trim();
  const knownSignatureIndex = knownSignature ? html.lastIndexOf(knownSignature) : -1;
  if (knownSignatureIndex >= 0) visibleEnd = Math.min(visibleEnd, knownSignatureIndex);
  return html.slice(0, visibleEnd);
}

function gmailMessagePlainBody(message: Row, knownSignatureText = '', knownSignatureHtml = ''): string {
  const payload = message.payload as GmailMessagePart | undefined;
  const visibleHtml = gmailMessageVisibleHtml(message, knownSignatureHtml);
  const rawBody = extractPlainTextFromGmailPayload(payload) || htmlToPlainText(visibleHtml) || extractHtmlAsPlainTextFromGmailPayload(payload) || text(message.snippet);
  return stripSignatureFromPlainText(stripQuotedHistoryFromPlainText(rawBody), knownSignatureText);
}

type GmailMessageLink = { text: string; url: string };

/** 從已移除簽名與引用串的 HTML 擷取安全的 http(s) 連結，前端只收到文字＋網址，不收到原始 HTML。 */
function gmailMessageLinks(message: Row, knownSignatureHtml = ''): GmailMessageLink[] {
  const html = gmailMessageVisibleHtml(message, knownSignatureHtml);
  const links: GmailMessageLink[] = [];
  const anchorPattern = /<a\b[^>]*\bhref\s*=\s*(?:"([^"]*)"|'([^']*)')[^>]*>([\s\S]*?)<\/a>/gi;
  let match: RegExpExecArray | null;
  while ((match = anchorPattern.exec(html)) && links.length < 40) {
    const url = (match[1] || match[2] || '').replace(/&amp;/gi, '&').replace(/&quot;/gi, '"').replace(/&#39;/gi, "'").trim();
    const label = htmlToPlainText(match[3]).trim();
    if (!label || url.length > 2048) continue;
    try {
      const parsed = new URL(url);
      if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') continue;
      links.push({ text: label.slice(0, 500), url: parsed.toString() });
    } catch { /* 無效或非絕對網址不提供給前端 */ }
  }
  return links;
}

/** 逐封重建完整 Gmail thread，無條件附上先前每一封的新增內容，同時避免已嵌套引用造成重複。 */
function gmailThreadQuote(messages: unknown[], knownSignatureText = '', knownSignatureHtml = ''): { html: string; plainText: string } {
  const items = messages.map(asRow).map(message => {
    const payload = message.payload as GmailMessagePart | undefined;
    const from = gmailHeaderValue(payload?.headers, 'From');
    const date = formatGmailDateForDisplay(gmailHeaderValue(payload?.headers, 'Date'));
    const body = gmailMessagePlainBody(message, knownSignatureText, knownSignatureHtml);
    if (!body) return null;
    const heading = [date, from].filter(Boolean).join('，');
    const intro = heading ? `${heading} 寫道：` : '先前信件：';
    return {
      html: `<div style="margin-bottom:12px"><div>${escapeHtml(intro)}</div><blockquote style="margin:0 0 0 .8ex;border-left:1px solid #ccc;padding-left:1ex">${escapeHtml(body).replace(/\n/g, '<br>')}</blockquote></div>`,
      plainText: `${intro}\n${body.split('\n').map(line => `> ${line}`).join('\n')}`
    };
  }).filter((item): item is { html: string; plainText: string } => Boolean(item));
  if (!items.length) return { html: '', plainText: '' };
  return {
    html: `<div class="gmail_quote">${items.map(item => item.html).join('')}</div>`,
    plainText: items.map(item => item.plainText).join('\n\n')
  };
}

function gmailHeaderValue(headers: Array<{ name?: string; value?: string }> | undefined, name: string): string {
  const match = (headers || []).find(header => text(header.name).toLowerCase() === name.toLowerCase());
  return text(match?.value);
}

/** 讀取整條 Gmail 信件串（format=full）——排程寄送在真正寄出的那一刻（而不是排程建立當下）重新讀一次，
 * 拿到最新的標頭組正確的 In-Reply-To/References，跟使用者立即回信時的行為完全一致。找不到/讀取失敗直接
 * 丟例外，讓呼叫端統一處理（排程寄送失敗、立即查看信件串等情境各自需要不同的錯誤呈現方式）。 */
async function fetchGmailThreadMessages(accessToken: string, threadId: string): Promise<Row[]> {
  const response = await fetch(`https://gmail.googleapis.com/gmail/v1/users/me/threads/${encodeURIComponent(threadId)}?format=full`, {
    headers: { Authorization: `Bearer ${accessToken}` }
  });
  const data = await response.json().catch(() => ({})) as Row;
  const messages = Array.isArray(data.messages) ? data.messages : [];
  if (!response.ok || !messages.length) throw new Error(text((data.error as Row)?.message) || '找不到原始信件串，無法回覆');
  return messages;
}

/** 依整條信件串最後一封信的標頭，組出回覆用的 raw MIME 訊息（In-Reply-To/References/Re: 主旨＋標準引用區）——
 * 排程寄送（dispatchScheduledMailItem）跟立即回信（replyCaseMail）共用同一套組信邏輯，確保排程真正寄出時的
 * 信件格式跟使用者當下按「送出回覆」完全一致。 */
function buildGmailReplyRaw(threadMessages: unknown[], options: { to: string; cc: string; bodyHtml: string; signatureHtml: string; inlineImages: GmailInlineImage[] }): string {
  const lastMessage = asRow(threadMessages[threadMessages.length - 1]);
  const headers = (asRow(lastMessage.payload).headers) as Array<{ name?: string; value?: string }> | undefined;
  const lastMessageId = gmailHeaderValue(headers, 'Message-Id');
  const lastReferences = gmailHeaderValue(headers, 'References');
  const lastSubject = gmailHeaderValue(headers, 'Subject');
  if (!lastMessageId) throw new Error('無法取得原始信件標頭，無法回覆');
  const quote = gmailThreadQuote(threadMessages, htmlToPlainText(options.signatureHtml), options.signatureHtml);
  return buildGmailRawMessage({
    to: options.to, cc: options.cc, subject: lastSubject, bodyHtml: options.bodyHtml, signatureHtml: options.signatureHtml,
    quotedHtml: quote.html, quotedText: quote.plainText, inlineImages: options.inlineImages,
    threadHeaders: { inReplyTo: lastMessageId, references: [lastReferences, lastMessageId].filter(Boolean).join(' '), subject: /^re:/i.test(lastSubject) ? lastSubject : `Re: ${lastSubject}` }
  });
}

/** 呼叫 Gmail API 實際送出一封已經組好的 raw MIME 訊息；threadId 有帶就會接進同一條既有信件串，沒帶就是
 * 建立一條新的。回傳的 threadId 在「新建」情境下一定要有值（沒有代表 Gmail 端沒有正確建立信件串）。 */
async function postGmailMessage(accessToken: string, raw: string, threadId?: string): Promise<{ threadId: string; messageId: string }> {
  const sendResponse = await fetch('https://gmail.googleapis.com/gmail/v1/users/me/messages/send', {
    method: 'POST', headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(threadId ? { raw, threadId } : { raw })
  });
  const sendData = await sendResponse.json().catch(() => ({})) as Row;
  if (!sendResponse.ok || (!threadId && !text(sendData.threadId))) {
    throw new Error(text((sendData.error as Row)?.message) || `Gmail 寄送失敗：${sendResponse.status}`);
  }
  return { threadId: text(sendData.threadId) || threadId || '', messageId: text(sendData.id) };
}

// 排程時間至少要在 60 秒之後（給每分鐘一次的 Cron Trigger 留緩衝，太接近「現在」的排程使用者體感上就等於
// 立即寄出，不如直接用「寄出」/「送出回覆」），最遠不能超過一年後（避免打字打錯年份，例如少打一位數字，
// 意外把信排到幾十年後才寄出；原生 <input type="datetime-local"> 本身沒有這層防呆，靠後端這裡把關）。
const SCHEDULED_MAIL_MIN_LEAD_MS = 60_000;
const SCHEDULED_MAIL_MAX_LEAD_MS = 365 * 24 * 60 * 60 * 1000;

/** 把前端送來的 scheduledAt（預期是帶明確時區偏移的 ISO 字串，例如 "2026-08-21T09:00:00+08:00"）換算成
 * epoch 毫秒；格式不合法、或不在合理的時間範圍內都回傳 null，交由呼叫端擋下。 */
function parseScheduledAt(value: unknown): number | null {
  const raw = text(value);
  if (!raw) return null;
  const ms = Date.parse(raw);
  if (!Number.isFinite(ms)) return null;
  if (ms < Date.now() + SCHEDULED_MAIL_MIN_LEAD_MS) return null;
  if (ms > Date.now() + SCHEDULED_MAIL_MAX_LEAD_MS) return null;
  return ms;
}

/** Gmail 訊息標頭裡的 Date 是 RFC 2822 格式，時區依寄件當下的伺服器/用戶端設定而定（常常是 UTC 或跟台灣
 * 差 8 小時的其他時區）——直接把原始字串顯示給使用者看，會被誤判成台灣當地時間，實際上差了好幾小時。
 * 這裡一律轉成台北時區重新格式化，不管原始標頭是哪個時區都能正確顯示。解析失敗（格式異常）就原樣顯示，
 * 不讓一筆解析失敗的日期擋住整封信的內容。 */
function formatGmailDateForDisplay(rawDate: string): string {
  const parsed = new Date(rawDate);
  if (!rawDate || Number.isNaN(parsed.getTime())) return rawDate;
  const parts = Object.fromEntries(new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Taipei', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23'
  }).formatToParts(parsed).map(part => [part.type, part.value])) as Record<string, string>;
  return `${parts.year}/${parts.month}/${parts.day} ${parts.hour}:${parts.minute}`;
}

export class DatabaseCoordinator extends DurableObject<Env> {
  private writeTail: Promise<void> = Promise.resolve();

  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
    ctx.blockConcurrencyWhile(async () => {
      this.ctx.storage.sql.exec(`
        CREATE TABLE IF NOT EXISTS _sql_schema_migrations (
          version INTEGER PRIMARY KEY,
          applied_at TEXT NOT NULL
        );
      `);
      const applied = new Set(this.ctx.storage.sql.exec<{ version: number }>(
        'SELECT version FROM _sql_schema_migrations'
      ).toArray().map(row => Number(row.version)));
      if (!applied.has(1)) {
        this.ctx.storage.transactionSync(() => {
          this.ctx.storage.sql.exec(`
            CREATE TABLE IF NOT EXISTS database_state (
              id TEXT PRIMARY KEY,
              json TEXT NOT NULL,
              github_sha TEXT NOT NULL,
              updated_at TEXT NOT NULL
            );
            CREATE TABLE IF NOT EXISTS sessions (
              token_hash TEXT PRIMARY KEY,
              payload TEXT NOT NULL,
              expires_at INTEGER NOT NULL
            );
            CREATE INDEX IF NOT EXISTS sessions_expiry_idx ON sessions(expires_at);
            CREATE TABLE IF NOT EXISTS login_attempts (
              identity_hash TEXT PRIMARY KEY,
              attempts INTEGER NOT NULL,
              window_started_at INTEGER NOT NULL
            );
          `);
          this.ctx.storage.sql.exec(
            'INSERT INTO _sql_schema_migrations(version, applied_at) VALUES (?, ?)',
            1, new Date().toISOString()
          );
        });
      }
      if (!applied.has(2)) {
        this.ctx.storage.transactionSync(() => {
          this.ctx.storage.sql.exec(`
            CREATE TABLE IF NOT EXISTS local_password_accounts (
              account TEXT PRIMARY KEY,
              password_hash TEXT NOT NULL,
              updated_at TEXT NOT NULL
            );
          `);
          const snapshots = this.ctx.storage.sql.exec<{ json: string }>(
            'SELECT json FROM database_state WHERE id = ?', STATE_KEY
          ).toArray();
          if (snapshots.length) {
            try {
              const legacy = JSON.parse(snapshots[0].json) as DatabaseSnapshot;
              for (const row of legacy.tables?.['帳號權限']?.rows || []) {
                const account = canonicalAccount(row['帳號']);
                const passwordHash = text(row['密碼雜湊']);
                if (!account || !passwordHash) continue;
                this.ctx.storage.sql.exec(
                  'INSERT OR REPLACE INTO local_password_accounts(account, password_hash, updated_at) VALUES (?, ?, ?)',
                  account, passwordHash, new Date().toISOString()
                );
              }
            } catch { /* a malformed cached snapshot will be replaced by the next GitHub refresh */ }
          }
          this.ctx.storage.sql.exec(
            'INSERT INTO _sql_schema_migrations(version, applied_at) VALUES (?, ?)',
            2, new Date().toISOString()
          );
        });
      }
      if (!applied.has(3)) {
        this.ctx.storage.transactionSync(() => {
          this.ctx.storage.sql.exec(`
            CREATE TABLE IF NOT EXISTS gmail_tokens (
              account TEXT PRIMARY KEY,
              refresh_token TEXT NOT NULL,
              access_token TEXT,
              access_token_expires_at INTEGER,
              gmail_address TEXT,
              connected_at TEXT NOT NULL,
              updated_at TEXT NOT NULL
            );
          `);
          this.ctx.storage.sql.exec(
            'INSERT INTO _sql_schema_migrations(version, applied_at) VALUES (?, ?)',
            3, new Date().toISOString()
          );
        });
      }
      if (!applied.has(4)) {
        this.ctx.storage.transactionSync(() => {
          // 「指定排程時間」寄信/回信——刻意不進 database.tables（不會被 mutate() 提交進公開的 GitHub JSON），
          // 理由跟 gmail_tokens 一樣：這裡可能存著整封信的內文、簽名檔、最多 18MB 的內嵌照片 base64，
          // 完全不該進公開 repo 的 db.json，只留在這個 Durable Object 自己的 SQLite 儲存裡即可。
          this.ctx.storage.sql.exec(`
            CREATE TABLE IF NOT EXISTS scheduled_mail (
              id TEXT PRIMARY KEY,
              case_id TEXT NOT NULL,
              kind TEXT NOT NULL,
              owner_account TEXT NOT NULL,
              requested_by TEXT NOT NULL,
              to_address TEXT NOT NULL,
              cc_address TEXT NOT NULL,
              subject TEXT NOT NULL,
              body_html TEXT NOT NULL,
              signature_html TEXT NOT NULL,
              inline_images TEXT NOT NULL,
              scheduled_at INTEGER NOT NULL,
              status TEXT NOT NULL,
              error_message TEXT,
              created_at TEXT NOT NULL,
              updated_at TEXT NOT NULL
            );
            CREATE INDEX IF NOT EXISTS scheduled_mail_dispatch_idx ON scheduled_mail(status, scheduled_at);
            CREATE INDEX IF NOT EXISTS scheduled_mail_case_idx ON scheduled_mail(case_id);
          `);
          this.ctx.storage.sql.exec(
            'INSERT INTO _sql_schema_migrations(version, applied_at) VALUES (?, ?)',
            4, new Date().toISOString()
          );
        });
      }
    });
  }

  private async serialized<T>(work: () => Promise<T>): Promise<T> {
    const previous = this.writeTail;
    let release!: () => void;
    this.writeTail = new Promise<void>(resolve => { release = resolve; });
    await previous;
    try { return await work(); } finally { release(); }
  }

  private storedSnapshot(): StoredSnapshot | null {
    const rows = this.ctx.storage.sql.exec<{ json: string; github_sha: string }>(
      'SELECT json, github_sha FROM database_state WHERE id = ?', STATE_KEY
    ).toArray();
    if (!rows.length) return null;
    return { database: normalizeSnapshot(JSON.parse(rows[0].json)), sha: rows[0].github_sha };
  }

  private persistSnapshot(stored: StoredSnapshot): void {
    const database = normalizeSnapshot(stored.database);
    this.ctx.storage.sql.exec(
      `INSERT INTO database_state(id, json, github_sha, updated_at)
       VALUES (?, ?, ?, ?)
       ON CONFLICT(id) DO UPDATE SET json=excluded.json, github_sha=excluded.github_sha, updated_at=excluded.updated_at`,
      STATE_KEY, JSON.stringify(database), stored.sha, new Date().toISOString()
    );
  }

  private async snapshot(force = false): Promise<StoredSnapshot> {
    if (!force) {
      const stored = this.storedSnapshot();
      if (stored) return stored;
    }
    return this.serialized(async () => {
      if (!force) {
        const stored = this.storedSnapshot();
        if (stored) return stored;
      }
      const latest = await loadGitHubDatabase(this.env);
      this.persistSnapshot(latest);
      return latest;
    });
  }

  private async sessionFor(payload: ApiPayload): Promise<SessionRecord | null> {
    const token = sessionToken(payload);
    if (!token) return null;
    const tokenHash = await sha256Base64Url(token);
    const rows = this.ctx.storage.sql.exec<{ payload: string; expires_at: number }>(
      'SELECT payload, expires_at FROM sessions WHERE token_hash = ?', tokenHash
    ).toArray();
    if (!rows.length) return null;
    if (Number(rows[0].expires_at) <= Date.now()) {
      this.ctx.storage.sql.exec('DELETE FROM sessions WHERE token_hash = ?', tokenHash);
      return null;
    }
    try { return JSON.parse(rows[0].payload) as SessionRecord; } catch {
      this.ctx.storage.sql.exec('DELETE FROM sessions WHERE token_hash = ?', tokenHash);
      return null;
    }
  }

  private async createSession(session: Omit<SessionRecord, 'expiresAt'>): Promise<{ token: string; session: SessionRecord; expiresIn: number }> {
    const ttl = Math.min(30 * 24 * 60 * 60, Math.max(15 * 60, Number(this.env.SESSION_TTL_SECONDS) || 30 * 24 * 60 * 60));
    const token = randomToken();
    const tokenHash = await sha256Base64Url(token);
    const record: SessionRecord = { ...session, expiresAt: Date.now() + ttl * 1000 };
    this.ctx.storage.sql.exec(
      'INSERT INTO sessions(token_hash, payload, expires_at) VALUES (?, ?, ?)',
      tokenHash, JSON.stringify(record), record.expiresAt
    );
    this.ctx.storage.sql.exec('DELETE FROM sessions WHERE expires_at <= ?', Date.now());
    return { token, session: record, expiresIn: ttl };
  }

  private async deleteSession(payload: ApiPayload): Promise<void> {
    const token = sessionToken(payload);
    if (!token) return;
    this.ctx.storage.sql.exec('DELETE FROM sessions WHERE token_hash = ?', await sha256Base64Url(token));
  }

  private localPasswordHash(account: unknown): string {
    const rows = this.ctx.storage.sql.exec<{ password_hash: string }>(
      'SELECT password_hash FROM local_password_accounts WHERE account = ?', canonicalAccount(account)
    ).toArray();
    return rows.length ? text(rows[0].password_hash) : '';
  }

  private setLocalPasswordHash(account: unknown, passwordHash: string): void {
    this.ctx.storage.sql.exec(
      `INSERT INTO local_password_accounts(account, password_hash, updated_at)
       VALUES (?, ?, ?)
       ON CONFLICT(account) DO UPDATE SET password_hash=excluded.password_hash, updated_at=excluded.updated_at`,
      canonicalAccount(account), passwordHash, new Date().toISOString()
    );
  }

  private getGmailTokens(accountValue: unknown): GmailTokenRow | null {
    const account = canonicalAccount(accountValue);
    const rows = this.ctx.storage.sql.exec<GmailTokenRow>(
      'SELECT account, refresh_token, access_token, access_token_expires_at, gmail_address FROM gmail_tokens WHERE account = ?', account
    ).toArray();
    return rows.length ? rows[0] : null;
  }

  private setGmailTokens(accountValue: unknown, tokens: { refreshToken?: string; accessToken?: string; accessTokenExpiresAt?: number; gmailAddress?: string }): void {
    const account = canonicalAccount(accountValue);
    const existing = this.getGmailTokens(account);
    const refreshToken = text(tokens.refreshToken) || text(existing?.refresh_token);
    if (!refreshToken) throw new Error('缺少 Gmail refresh token，無法儲存連線');
    this.ctx.storage.sql.exec(
      `INSERT INTO gmail_tokens(account, refresh_token, access_token, access_token_expires_at, gmail_address, connected_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(account) DO UPDATE SET refresh_token=excluded.refresh_token, access_token=excluded.access_token,
         access_token_expires_at=excluded.access_token_expires_at, gmail_address=excluded.gmail_address, updated_at=excluded.updated_at`,
      account, refreshToken, text(tokens.accessToken), Number(tokens.accessTokenExpiresAt) || null,
      text(tokens.gmailAddress) || text(existing?.gmail_address), new Date().toISOString(), new Date().toISOString()
    );
  }

  private deleteGmailTokens(accountValue: unknown): void {
    this.ctx.storage.sql.exec('DELETE FROM gmail_tokens WHERE account = ?', canonicalAccount(accountValue));
  }

  /** 取得目前帳號可用的 Gmail access token；過期就用 refresh_token 換新的，換不到就清掉連線並丟出錯誤。 */
  private async getValidGmailAccessToken(accountValue: unknown): Promise<string> {
    const account = canonicalAccount(accountValue);
    const stored = this.getGmailTokens(account);
    if (!stored) throw new Error('尚未連接 Gmail，請先在「發信」選單裡連接 Gmail 帳號');
    const expiresAt = Number(stored.access_token_expires_at) || 0;
    if (stored.access_token && expiresAt - 60_000 > Date.now()) return stored.access_token;
    const response = await fetch('https://oauth2.googleapis.com/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded', Accept: 'application/json' },
      body: new URLSearchParams({
        grant_type: 'refresh_token', refresh_token: stored.refresh_token,
        client_id: this.env.GMAIL_OAUTH_CLIENT_ID, client_secret: this.env.GMAIL_OAUTH_CLIENT_SECRET
      })
    });
    const data = await response.json().catch(() => ({})) as Row;
    if (!response.ok || !text(data.access_token)) {
      this.deleteGmailTokens(account);
      throw new Error('Gmail 連結已失效，請重新連接');
    }
    const accessToken = text(data.access_token);
    const expiresIn = Number(data.expires_in) || 3600;
    this.setGmailTokens(account, { accessToken, accessTokenExpiresAt: Date.now() + expiresIn * 1000 });
    return accessToken;
  }

  private deleteAccountPrivateState(accountValue: unknown): void {
    const account = canonicalAccount(accountValue);
    this.ctx.storage.sql.exec('DELETE FROM local_password_accounts WHERE account = ?', account);
    this.deleteGmailTokens(account);
    const sessions = this.ctx.storage.sql.exec<{ token_hash: string; payload: string }>('SELECT token_hash, payload FROM sessions').toArray();
    for (const row of sessions) {
      try {
        if (canonicalAccount((JSON.parse(row.payload) as SessionRecord).account) === account) {
          this.ctx.storage.sql.exec('DELETE FROM sessions WHERE token_hash = ?', row.token_hash);
        }
      } catch { /* malformed sessions are removed by their normal expiry path */ }
    }
  }

  private async assertLoginRate(context: RequestContext): Promise<void> {
    const identityHash = await sha256Base64Url(`${context.ip}|${context.userAgent.slice(0, 120)}`);
    const rows = this.ctx.storage.sql.exec<{ attempts: number; window_started_at: number }>(
      'SELECT attempts, window_started_at FROM login_attempts WHERE identity_hash = ?', identityHash
    ).toArray();
    const now = Date.now();
    if (!rows.length || now - Number(rows[0].window_started_at) >= LOGIN_WINDOW_MS) {
      this.ctx.storage.sql.exec(
        `INSERT INTO login_attempts(identity_hash, attempts, window_started_at) VALUES (?, 1, ?)
         ON CONFLICT(identity_hash) DO UPDATE SET attempts=1, window_started_at=excluded.window_started_at`,
        identityHash, now
      );
      return;
    }
    const attempts = Number(rows[0].attempts) + 1;
    this.ctx.storage.sql.exec('UPDATE login_attempts SET attempts=? WHERE identity_hash=?', attempts, identityHash);
    if (attempts > MAX_LOGIN_ATTEMPTS) throw new Error('登入嘗試次數過多，請稍後再試');
  }

  private async mutate(
    action: string,
    session: SessionRecord | null,
    mutator: (draft: DatabaseSnapshot) => MutatorResult | Promise<MutatorResult>
  ): Promise<ApiResult> {
    return this.serialized(async () => {
      let stored = this.storedSnapshot();
      if (!stored) {
        stored = await loadGitHubDatabase(this.env);
        this.persistSnapshot(stored);
      }
      for (let attempt = 0; attempt < 2; attempt += 1) {
        const draft = cloneDatabase(stored.database);
        const outcome = await mutator(draft);
        if (outcome.changed === false) return { ...outcome.result, jsonRevision: draft.revision, revision: draft.revision, unchanged: true };
        // 這兩欄是修改統計表的派生值，任何寫入在送往 GitHub 前都再校正一次。
        recalculateDatabaseModificationCounts(draft);
        draft.revision = Math.max(0, Number(draft.revision) || 0) + 1;
        draft.updatedAt = new Date().toISOString();
        draft.internal.sessions = {};
        try {
          const committed = await commitGitHubDatabase(this.env, draft, stored.sha, commitMessage(action, session));
          this.persistSnapshot({ database: committed.database, sha: committed.sha });
          return {
            ...outcome.result,
            storage: 'cloudflare-worker-github-json',
            jsonRevision: draft.revision,
            revision: draft.revision,
            githubCommitSha: committed.commitSha,
            changedTables: outcome.changedTables || []
          };
        } catch (error) {
          if (Number((error as { status?: number }).status) !== 409 || attempt > 0) throw error;
          stored = await loadGitHubDatabase(this.env);
          this.persistSnapshot(stored);
        }
      }
      throw new Error('JSON 寫入發生版本衝突，請重新整理後再試');
    });
  }

  private requireSession(session: SessionRecord | null): SessionRecord {
    if (!session) throw new Error('請先登入後再執行此操作');
    return session;
  }

  private requireAccess(database: DatabaseSnapshot, session: SessionRecord | null, capability: string): SessionRecord {
    return requireCapability(database, session, capability) as SessionRecord;
  }

  private requireAnyAccess(database: DatabaseSnapshot, session: SessionRecord | null, capabilities: string[]): SessionRecord {
    const current = this.requireSession(session);
    if (capabilities.some(capability => hasCapability(database, current, capability))) return current;
    throw new Error(`此帳號沒有「${capabilities.join('／')}」權限`);
  }

  /** 疊加式的資料列層級授權：角色權限允許就直接放行，否則額外檢查客戶別的專案負責人是否等於這筆案件本人（見 model.ts 的 hasRowCapability）。 */
  private requireRowAccess(database: DatabaseSnapshot, session: SessionRecord | null, capability: string, row: Row | undefined): SessionRecord {
    const current = this.requireSession(session);
    if (hasRowCapability(database, current, capability, row || {})) return current;
    throw new Error(`此帳號沒有「${capability}」權限`);
  }

  private async googleLogin(payload: ApiPayload, context: RequestContext): Promise<ApiResult> {
    await this.assertLoginRate(context);
    const credential = text(payload.credential || payload.idToken);
    if (!credential) return { ok: false, action: 'googleLogin', error: '缺少 Google credential' };
    const response = await fetch(`https://oauth2.googleapis.com/tokeninfo?id_token=${encodeURIComponent(credential)}`, {
      headers: { Accept: 'application/json' }
    });
    if (!response.ok) return { ok: false, action: 'googleLogin', error: 'Google token 驗證失敗', reason: 'TOKENINFO_FAILED' };
    const profile = await response.json() as Row;
    if (text(profile.aud) !== this.env.GOOGLE_OAUTH_CLIENT_ID) return { ok: false, action: 'googleLogin', error: 'Google OAuth client_id 不符合', reason: 'CLIENT_ID_MISMATCH' };
    if (!['true', '1'].includes(text(profile.email_verified).toLowerCase())) return { ok: false, action: 'googleLogin', error: 'Google 信箱尚未通過驗證', reason: 'EMAIL_NOT_VERIFIED' };
    if (Number(profile.exp) * 1000 <= Date.now()) return { ok: false, action: 'googleLogin', error: 'Google 登入憑證已過期', reason: 'TOKEN_EXPIRED' };
    const account = canonicalAccount(profile.email);
    if (!account.endsWith('@emctaipei.com')) return { ok: false, action: 'googleLogin', error: '請使用 @emctaipei.com 公司信箱登入', reason: 'DOMAIN_NOT_ALLOWED' };
    const { database } = await this.snapshot();
    const row = settingsRow(database, account);
    if (!row) return { ok: false, action: 'googleLogin', error: '此帳號尚未加入 JSON 資料庫「設定」，請聯絡管理者新增人員', reason: 'JSON_USER_NOT_REGISTERED' };
    const user = text(row['名字'] || profile.name || account.split('@')[0]);
    const issued = await this.createSession({ user, account, provider: 'google' });
    return {
      ok: true, action: 'googleLogin', provider: 'google', user, account, email: account,
      token: issued.token, expiresIn: issued.expiresIn, settings: settingsResponse(row),
      access: accessProfile(database, issued.session),
      loginDebug: { account, user, aud: text(profile.aud), expiresIn: issued.expiresIn, workerVersion: VERSION }
    };
  }

  private async passwordLogin(payload: ApiPayload, context: RequestContext): Promise<ApiResult> {
    await this.assertLoginRate(context);
    const password = text(payload.password);
    if (!password) return { ok: false, action: 'login', error: '帳號或密碼不正確' };
    const shortcut = shortcutLoginAccount(password);
    const requestedAccount = canonicalAccount(payload.account || payload.user);
    const { database } = await this.snapshot();
    let account = shortcut;
    if (!account) {
      const allowed = this.env.ADMIN_LOGIN_ACCOUNTS.split(',').map(canonicalAccount).includes(requestedAccount);
      if (allowed && await secureEqual(password, this.env.ADMIN_LOGIN_PASSWORD)) account = requestedAccount;
    }
    if (!account) {
      const passwordRows = database.tables['帳號權限'].rows.filter(row => text(row['登入方式']) === '密碼' || canonicalAccount(row['帳號']).startsWith('local:'));
      for (const permissionRow of passwordRows) {
        const candidateAccount = canonicalAccount(permissionRow['帳號']);
        const passwordHash = this.localPasswordHash(candidateAccount) || text(permissionRow['密碼雜湊']);
        if (!passwordHash || !await verifyLocalPassword(password, passwordHash)) continue;
        if (text(permissionRow['狀態']) === '停用') return { ok: false, action: 'login', error: '帳號已停用', reason: 'ACCOUNT_DISABLED' };
        account = candidateAccount;
        break;
      }
    }
    if (!account) return { ok: false, action: 'login', error: '帳號或密碼不正確' };
    const row = settingsRow(database, account);
    if (!row) return { ok: false, action: 'login', error: '帳號或密碼不正確' };
    const user = text(row['名字'] || account.split('@')[0]);
    const issued = await this.createSession({ user, account, provider: 'password' });
    return { ok: true, action: 'login', provider: 'password', user, account, email: account.includes('@') ? account : '', token: issued.token, expiresIn: issued.expiresIn, settings: settingsResponse(row), access: accessProfile(database, issued.session) };
  }

  private async erpLogin(payload: ApiPayload, context: RequestContext): Promise<ApiResult> {
    await this.assertLoginRate(context);
    const code = text(payload.code);
    const codeVerifier = text(payload.codeVerifier || payload.code_verifier);
    const redirectUri = text(payload.redirectUri || payload.redirect_uri || this.env.ERP_REDIRECT_URI);
    if (!code) return { ok: false, action: 'erpLogin', error: '缺少 ERP 授權碼', reason: 'ERP_CODE_MISSING' };
    if (!codeVerifier) return { ok: false, action: 'erpLogin', error: '缺少 ERP PKCE verifier', reason: 'ERP_VERIFIER_MISSING' };
    if (redirectUri !== this.env.ERP_REDIRECT_URI) return { ok: false, action: 'erpLogin', error: 'ERP redirect_uri 與後端設定不一致', reason: 'ERP_REDIRECT_URI_MISMATCH' };
    const tokenResponse = await fetch(`${this.env.ERP_BASE_URL.replace(/\/+$/, '')}/api/oauth/token`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded', Accept: 'application/json' },
      body: new URLSearchParams({
        grant_type: 'authorization_code', code, redirect_uri: this.env.ERP_REDIRECT_URI,
        client_id: this.env.ERP_CLIENT_ID, client_secret: this.env.ERP_CLIENT_SECRET, code_verifier: codeVerifier
      })
    });
    const tokenData = await tokenResponse.json().catch(() => ({})) as Row;
    if (!tokenResponse.ok || !text(tokenData.access_token)) return { ok: false, action: 'erpLogin', error: text(tokenData.error_description || tokenData.error) || `ERP token 換取失敗：${tokenResponse.status}`, reason: text(tokenData.error) || 'ERP_TOKEN_FAILED', status: tokenResponse.status };
    const profileResponse = await fetch(`${this.env.ERP_BASE_URL.replace(/\/+$/, '')}/api/oauth/userinfo`, {
      headers: { Authorization: `Bearer ${text(tokenData.access_token)}`, Accept: 'application/json' }
    });
    const profile = await profileResponse.json().catch(() => ({})) as Row;
    if (!profileResponse.ok || profile.is_active === false) return { ok: false, action: 'erpLogin', error: text(profile.error_description || profile.error) || 'ERP 帳號已停用或無效', reason: 'ERP_ACCOUNT_INACTIVE' };
    const account = canonicalAccount(profile.email);
    if (!account.endsWith('@emctaipei.com')) return { ok: false, action: 'erpLogin', error: '請使用 @emctaipei.com 公司帳號登入', reason: 'DOMAIN_NOT_ALLOWED' };
    let stored = await this.snapshot();
    let row = settingsRow(stored.database, account);
    if (!row) {
      const created = await this.mutate('erp-login-register', null, draft => {
        const newRow = Object.fromEntries(TABLE_SCHEMAS['設定'].headers.map((header: string) => [header, ''])) as Row;
        newRow['帳號'] = account;
        newRow['名字'] = text(profile.name || profile.name_en) || account.split('@')[0];
        newRow['顯示名'] = newRow['名字'];
        newRow['部門'] = text(profile.department);
        draft.tables['設定'].rows.push(newRow);
        return { result: { ok: true, action: 'erp-login-register' }, changedTables: ['設定'] };
      });
      stored = await this.snapshot();
      row = settingsRow(stored.database, account);
      if (!created.ok || !row) throw new Error('ERP 帳號建立失敗');
    }
    const user = text(row['名字'] || profile.name || profile.name_en || account.split('@')[0]);
    const issued = await this.createSession({
      user, account, provider: 'erp', department: text(profile.department), role: text(profile.role), erpEmployeeId: text(profile.employee_id)
    });
    return {
      ok: true, action: 'erpLogin', provider: 'erp', user, account, email: account,
      token: issued.token, expiresIn: issued.expiresIn, settings: settingsResponse(row), access: accessProfile(stored.database, issued.session),
      erpProfile: {
        employee_id: text(profile.employee_id), name: text(profile.name), name_en: text(profile.name_en), email: account,
        role: text(profile.role), department: text(profile.department), rank: text(profile.rank), title: text(profile.title),
        is_active: profile.is_active !== false, is_pm: Boolean(profile.is_pm)
      }
    };
  }

  /** 已登入使用者額外連接 Gmail（授權碼交換，換 refresh_token 存進 gmail_tokens）。 */
  private async gmailOauthConnect(payload: ApiPayload, database: DatabaseSnapshot, session: SessionRecord | null): Promise<ApiResult> {
    const current = this.requireAccess(database, session, 'request.mail');
    const code = text(payload.code);
    const codeVerifier = text(payload.codeVerifier || payload.code_verifier);
    const redirectUri = text(payload.redirectUri || payload.redirect_uri || this.env.ERP_REDIRECT_URI);
    if (!code) return { ok: false, action: 'gmailOauthConnect', error: '缺少 Google 授權碼', reason: 'GMAIL_CODE_MISSING' };
    if (redirectUri !== this.env.ERP_REDIRECT_URI) return { ok: false, action: 'gmailOauthConnect', error: 'redirect_uri 與後端設定不一致', reason: 'GMAIL_REDIRECT_URI_MISMATCH' };
    const tokenResponse = await fetch('https://oauth2.googleapis.com/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded', Accept: 'application/json' },
      body: new URLSearchParams({
        grant_type: 'authorization_code', code, redirect_uri: redirectUri,
        client_id: this.env.GMAIL_OAUTH_CLIENT_ID, client_secret: this.env.GMAIL_OAUTH_CLIENT_SECRET,
        ...(codeVerifier ? { code_verifier: codeVerifier } : {})
      })
    });
    const tokenData = await tokenResponse.json().catch(() => ({})) as Row;
    if (!tokenResponse.ok || !text(tokenData.access_token)) {
      return { ok: false, action: 'gmailOauthConnect', error: text(tokenData.error_description || tokenData.error) || `Gmail 授權碼換取失敗：${tokenResponse.status}`, reason: text(tokenData.error) || 'GMAIL_TOKEN_FAILED' };
    }
    const profileResponse = await fetch('https://www.googleapis.com/oauth2/v2/userinfo', {
      headers: { Authorization: `Bearer ${text(tokenData.access_token)}`, Accept: 'application/json' }
    });
    const profile = await profileResponse.json().catch(() => ({})) as Row;
    const gmailAddress = text(profile.email);
    this.setGmailTokens(current.account, {
      refreshToken: text(tokenData.refresh_token), accessToken: text(tokenData.access_token),
      accessTokenExpiresAt: Date.now() + (Number(tokenData.expires_in) || 3600) * 1000, gmailAddress
    });
    return { ok: true, action: 'gmailOauthConnect', gmailAddress };
  }

  private gmailStatus(database: DatabaseSnapshot, session: SessionRecord | null): ApiResult {
    const current = this.requireAccess(database, session, 'request.mail');
    const stored = this.getGmailTokens(current.account);
    return { ok: true, action: 'gmailStatus', connected: Boolean(stored), gmailAddress: text(stored?.gmail_address) };
  }

  /** 讀取目前連接的 Gmail 帳號設定的簽名檔（需要 gmail.settings.basic 範圍；沒有這個範圍的舊連線會收到 403，回傳明確的 reason 讓前端可以提示重新連接而不是整個擋住）。 */
  private async getGmailSignature(database: DatabaseSnapshot, session: SessionRecord | null): Promise<ApiResult> {
    const current = this.requireAccess(database, session, 'request.mail');
    const stored = this.getGmailTokens(current.account);
    if (!stored) return { ok: false, action: 'getGmailSignature', error: '尚未連接 Gmail' };
    const accessToken = await this.getValidGmailAccessToken(current.account);
    const response = await fetch('https://gmail.googleapis.com/gmail/v1/users/me/settings/sendAs', {
      headers: { Authorization: `Bearer ${accessToken}` }
    });
    if (response.status === 403) return { ok: false, action: 'getGmailSignature', error: '需要重新連接 Gmail 才能讀取簽名檔', reason: 'INSUFFICIENT_SCOPE' };
    const data = await response.json().catch(() => ({})) as Row;
    if (!response.ok) return { ok: false, action: 'getGmailSignature', error: text((data.error as Row)?.message) || `讀取簽名檔失敗：${response.status}` };
    const sendAsList = Array.isArray(data.sendAs) ? data.sendAs.map(asRow) : [];
    const match = sendAsList.find(item => text(item.sendAsEmail).toLowerCase() === text(stored.gmail_address).toLowerCase())
      || sendAsList.find(item => item.isPrimary);
    return { ok: true, action: 'getGmailSignature', signature: text(match?.signature) };
  }

  private async gmailDisconnect(database: DatabaseSnapshot, session: SessionRecord | null): Promise<ApiResult> {
    const current = this.requireAccess(database, session, 'request.mail');
    const stored = this.getGmailTokens(current.account);
    if (stored?.refresh_token) {
      try {
        await fetch(`https://oauth2.googleapis.com/revoke?token=${encodeURIComponent(stored.refresh_token)}`, { method: 'POST' });
      } catch { /* Google 撤銷失敗不擋斷線本身，DO 端連線紀錄仍會被刪除 */ }
    }
    this.deleteGmailTokens(current.account);
    return { ok: true, action: 'gmailDisconnect' };
  }

  /** 回覆全部風格的建議收件人／副本——依信件串最後一封信的標頭＋這次實際回信帳號的 Gmail 地址算出來，
   * getCaseMailThread（唯讀，讓前端可以先攤開顯示、讓使用者能編輯）與 replyCaseMail（送出時的最終
   * fallback，前端沒有帶 to/cc 時才會用到）共用同一套邏輯，確保兩邊算出來的預設值一致。 */
  private computeReplySuggestion(threadMessages: unknown[], senderAccount: string): { to: string; cc: string } {
    const lastMessage = asRow(threadMessages[threadMessages.length - 1]);
    const headers = (asRow(lastMessage.payload).headers) as Array<{ name?: string; value?: string }> | undefined;
    const stored = this.getGmailTokens(senderAccount);
    const selfAddresses = new Set([canonicalAccount(senderAccount), text(stored?.gmail_address).toLowerCase()].filter(Boolean));
    const fromHeader = gmailHeaderValue(headers, 'From');
    const toHeader = gmailHeaderValue(headers, 'To');
    const ccHeader = gmailHeaderValue(headers, 'Cc');
    const fromSelf = extractEmailAddressesFromHeader(fromHeader).some(email => selfAddresses.has(email));
    const to = fromSelf
      ? extractAddressEntriesFromHeader(toHeader).filter(entry => !selfAddresses.has(entry.email)).map(entry => entry.full).join(', ')
      : fromHeader;
    // 副本比照一般信箱的「回覆全部」：把上一封信的收件人＋副本都留住（扣掉自己與這次要回覆的對象本身），
    // 確保討論串裡原本在場的人不會因為只是點了「回信」而被悄悄排除在外。「自己」同時要排除實際
    // 連接的 Gmail 信箱（例如 designer.mailbox@gmail.com）與系統帳號別名（例如
    // test.user@emctaipei.com）——這兩者在 Google Workspace 別名寄送的情境下常常是不同的兩個地址。
    // 這裡刻意用 extractAddressEntriesFromHeader（保留顯示名）而不是 extractEmailAddressesFromHeader
    // （只剩 email）組出最終要回傳的 cc 字串——後者只適合拿來做 email 是否存在的比對，如果拿它的結果直接
    // 組字串，前端信件編輯器的副本聯絡人晶片就只能顯示一長串信箱，不會顯示姓名。
    const excludedFromCc = new Set([...selfAddresses, ...extractEmailAddressesFromHeader(to)]);
    const seenCc = new Set<string>();
    const cc = [...extractAddressEntriesFromHeader(toHeader), ...extractAddressEntriesFromHeader(ccHeader)]
      .filter(entry => {
        if (excludedFromCc.has(entry.email) || seenCc.has(entry.email)) return false;
        seenCc.add(entry.email);
        return true;
      })
      .map(entry => entry.full)
      .join(', ');
    return { to, cc };
  }

  /** 透過 Gmail API 寄出案件信件（限第一次，該案件已經有信件串就拒絕，請改用回信）。 */
  private async sendCaseMail(payload: ApiPayload, database: DatabaseSnapshot, session: SessionRecord | null): Promise<ApiResult> {
    const caseId = text(payload.caseId || payload.id);
    const existingRow = database.tables.database.rows.find(item => text(item['案件編號']) === caseId);
    const current = this.requireRowAccess(database, session, 'request.mail', existingRow);
    const to = text(payload.to);
    const cc = text(Array.isArray(payload.cc) ? payload.cc.join(',') : payload.cc);
    const subject = text(payload.subject);
    const bodyHtml = resolveBodyHtml(payload);
    const signatureHtml = text(payload.signatureHtml);
    const inlineImages = resolveGmailInlineImages(payload);
    if (!caseId) return { ok: false, action: 'sendCaseMail', error: '缺少案件編號' };
    if (!to || !subject) return { ok: false, action: 'sendCaseMail', error: '缺少收件人或主旨' };
    const row = existingRow;
    if (!row) return { ok: false, action: 'sendCaseMail', error: '找不到案件資料' };
    if (text(row['Gmail信件串ID'])) return { ok: false, action: 'sendCaseMail', error: '此案件已經有 Gmail 信件串，請改用「回信」', reason: 'THREAD_EXISTS' };
    const accessToken = await this.getValidGmailAccessToken(current.account);
    const raw = buildGmailRawMessage({ to, cc, subject, bodyHtml, signatureHtml, inlineImages });
    const sendResponse = await fetch('https://gmail.googleapis.com/gmail/v1/users/me/messages/send', {
      method: 'POST', headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ raw })
    });
    const sendData = await sendResponse.json().catch(() => ({})) as Row;
    if (!sendResponse.ok || !text(sendData.threadId)) {
      return { ok: false, action: 'sendCaseMail', error: text((sendData.error as Row)?.message) || `Gmail 寄送失敗：${sendResponse.status}` };
    }
    const threadId = text(sendData.threadId);
    await this.mutate('sendCaseMail', current, draft => {
      const target = draft.tables.database.rows.find(item => text(item['案件編號']) === caseId);
      if (!target) throw new Error('找不到案件資料');
      target['Gmail信件串ID'] = threadId;
      target['Gmail寄件帳號'] = current.account;
      return { result: { ok: true, action: 'sendCaseMail' }, changedTables: ['database'] };
    });
    return { ok: true, action: 'sendCaseMail', threadId, gmailMessageId: text(sendData.id) };
  }

  /** 讀取案件已寄出的 Gmail 信件串——2026-08-19 起需要同時通過兩層檢查才能查看/回覆：①客戶別「權限
   * 設定」白名單（跟 sendCaseMail／request.edit／request.delete 共用同一套 hasRowCapability，見
   * model.ts），客戶別沒設定過名單時退回一般角色權限判斷；②這個帳號的 email 是否出現在信件串本身的
   * 收件人/寄件人/副本裡（見 accountIsGmailThreadParticipant）——只有這封信原本就會寄給/副本給的人，
   * 才算「整串信件內容相關的人」，能看到內容也能回覆。兩者缺一不可：光是有客戶別權限、但不是這條討論
   * 串的實際相關人，一樣看不到內容（避免看到不相關的客戶通信內容）；反過來光是討論串相關人、但沒有這
   * 個客戶別的操作權限，也一樣被擋（跟發信/編輯/刪除的授權範圍保持一致）。Gmail 信件串實際上只存在寄
   * 件當下那個帳號自己的信箱裡，所以不論是誰在查看，實際呼叫 Gmail API 一律用
   * getValidGmailAccessToken(owner) 拿「當初寄件帳號」存的 token，不是目前登入者自己的 token——伺服器
   * 端本來就保存著寄件帳號的 refresh token，能代表它去讀信。只回傳 text/plain 內容＋內嵌圖片，不回傳
   * 原始 HTML（避免注入風險）。 */
  private async getCaseMailThread(payload: ApiPayload, database: DatabaseSnapshot, session: SessionRecord | null): Promise<ApiResult> {
    const current = this.requireSession(session);
    const caseId = text(payload.caseId || payload.id);
    const row = database.tables.database.rows.find(item => text(item['案件編號']) === caseId);
    if (!row) return { ok: false, action: 'getCaseMailThread', error: '找不到案件資料' };
    if (!hasRowCapability(database, current, 'request.mail', row)) {
      return { ok: false, action: 'getCaseMailThread', error: '此帳號沒有「request.mail」權限', reason: 'REQUEST_MAIL_DENIED' };
    }
    const threadId = text(row['Gmail信件串ID']);
    const owner = canonicalAccount(row['Gmail寄件帳號']);
    if (!threadId) return { ok: false, action: 'getCaseMailThread', error: '此案件尚未透過 Gmail 寄出過信件' };
    const accessToken = await this.getValidGmailAccessToken(owner);
    const knownSignatureHtml = text(payload.signatureHtml);
    const knownSignatureText = htmlToPlainText(knownSignatureHtml);
    const response = await fetch(`https://gmail.googleapis.com/gmail/v1/users/me/threads/${encodeURIComponent(threadId)}?format=full`, {
      headers: { Authorization: `Bearer ${accessToken}` }
    });
    const data = await response.json().catch(() => ({})) as Row;
    if (!response.ok) return { ok: false, action: 'getCaseMailThread', error: text((data.error as Row)?.message) || `Gmail 讀取失敗：${response.status}` };
    const rawMessages = Array.isArray(data.messages) ? data.messages : [];
    if (!accountIsGmailThreadParticipant(current.account, rawMessages)) {
      return { ok: false, action: 'getCaseMailThread', error: '此信件串的收件人/副本裡沒有這個帳號，無法查看內容', reason: 'GMAIL_THREAD_NOT_PARTICIPANT' };
    }
    let remainingImageBudget = GMAIL_THREAD_IMAGE_LIMIT_TOTAL;
    const messages: Row[] = [];
    for (const message of rawMessages) {
      const messageRow = asRow(message);
      const payloadPart = messageRow.payload as GmailMessagePart | undefined;
      const bodyText = gmailMessagePlainBody(messageRow, knownSignatureText, knownSignatureHtml);
      const links = gmailMessageLinks(messageRow, knownSignatureHtml);
      const images: Array<{ dataUrl: string }> = [];
      if (remainingImageBudget > 0) {
        const imageParts = collectGmailImageParts(payloadPart).slice(0, Math.min(GMAIL_THREAD_IMAGE_LIMIT_PER_MESSAGE, remainingImageBudget));
        for (const part of imageParts) {
          const attachmentId = text(part.body?.attachmentId);
          if (!attachmentId) continue;
          try {
            const attResponse = await fetch(
              `https://gmail.googleapis.com/gmail/v1/users/me/messages/${encodeURIComponent(text(messageRow.id))}/attachments/${encodeURIComponent(attachmentId)}`,
              { headers: { Authorization: `Bearer ${accessToken}` } }
            );
            if (!attResponse.ok) continue;
            const attData = await attResponse.json().catch(() => ({})) as Row;
            const rawData = text(attData.data);
            if (!rawData) continue;
            images.push({ dataUrl: gmailAttachmentDataUrl(text(part.mimeType), rawData) });
            remainingImageBudget -= 1;
          } catch { /* 單張圖片抓取失敗不擋整封信的顯示，略過這一張即可 */ }
        }
      }
      messages.push({
        id: text(messageRow.id), from: gmailHeaderValue(payloadPart?.headers, 'From'), to: gmailHeaderValue(payloadPart?.headers, 'To'),
        cc: gmailHeaderValue(payloadPart?.headers, 'Cc'), date: formatGmailDateForDisplay(gmailHeaderValue(payloadPart?.headers, 'Date')),
        snippet: text(messageRow.snippet), bodyText, links, images
      });
    }
    // 給前端「回覆」編輯器預先帶入、可再修改的收件人／副本建議值——跟 replyCaseMail 送出時如果前端
    // 沒帶 to/cc 會用的 fallback 是同一套計算方式（computeReplySuggestion），確保兩邊看到的預設值一致。
    const suggestion = rawMessages.length ? this.computeReplySuggestion(rawMessages, current.account) : { to: '', cc: '' };
    const replyFrom = text(this.getGmailTokens(current.account)?.gmail_address) || current.account;
    return { ok: true, action: 'getCaseMailThread', threadId, messages, replyFrom, suggestedTo: suggestion.to, suggestedCc: suggestion.cc };
  }

  /** 在既有信件串裡回覆一封信——讀取歷史仍使用當初寄件帳號的 token，但實際送出必須使用目前登入
   * 帳號自己連接的 Gmail token，收件人才會看到真正的回信者。當前帳號不是原寄件帳號時，原 threadId 屬於別的
   * Gmail 信箱，不可送給 messages.send；改由 In-Reply-To／References／同主旨維持郵件用戶端的回覆關聯。
   * 先抓整條信件串每一封信的標頭（含 Cc，用來判斷誰是「相關人」）組出正確的 In-Reply-To/References，並把
   * 上一封信的內容放進標準引用區，讓收件端保有前文脈絡。 */
  private async replyCaseMail(payload: ApiPayload, database: DatabaseSnapshot, session: SessionRecord | null): Promise<ApiResult> {
    const current = this.requireSession(session);
    const caseId = text(payload.caseId || payload.id);
    const row = database.tables.database.rows.find(item => text(item['案件編號']) === caseId);
    if (!row) return { ok: false, action: 'replyCaseMail', error: '找不到案件資料' };
    if (!hasRowCapability(database, current, 'request.mail', row)) {
      return { ok: false, action: 'replyCaseMail', error: '此帳號沒有「request.mail」權限', reason: 'REQUEST_MAIL_DENIED' };
    }
    const bodyHtml = resolveBodyHtml(payload);
    const signatureHtml = text(payload.signatureHtml);
    const inlineImages = resolveGmailInlineImages(payload);
    if (!htmlToPlainText(bodyHtml) && !inlineImages.length) return { ok: false, action: 'replyCaseMail', error: '回覆內容不可為空' };
    const threadId = text(row['Gmail信件串ID']);
    const owner = canonicalAccount(row['Gmail寄件帳號']);
    if (!threadId) return { ok: false, action: 'replyCaseMail', error: '此案件尚未透過 Gmail 寄出過信件' };
    const threadAccessToken = await this.getValidGmailAccessToken(owner);
    const threadResponse = await fetch(
      `https://gmail.googleapis.com/gmail/v1/users/me/threads/${encodeURIComponent(threadId)}?format=full`,
      { headers: { Authorization: `Bearer ${threadAccessToken}` } }
    );
    const threadData = await threadResponse.json().catch(() => ({})) as Row;
    const threadMessages = Array.isArray(threadData.messages) ? threadData.messages : [];
    if (!threadResponse.ok || !threadMessages.length) return { ok: false, action: 'replyCaseMail', error: '找不到原始信件串，無法回覆' };
    if (!accountIsGmailThreadParticipant(current.account, threadMessages)) {
      return { ok: false, action: 'replyCaseMail', error: '此信件串的收件人/副本裡沒有這個帳號，無法回覆', reason: 'GMAIL_THREAD_NOT_PARTICIPANT' };
    }
    const lastMessage = asRow(threadMessages[threadMessages.length - 1]);
    const headers = (asRow(lastMessage.payload).headers) as Array<{ name?: string; value?: string }> | undefined;
    const lastMessageId = gmailHeaderValue(headers, 'Message-Id');
    const lastReferences = gmailHeaderValue(headers, 'References');
    const lastSubject = gmailHeaderValue(headers, 'Subject');
    if (!lastMessageId) return { ok: false, action: 'replyCaseMail', error: '無法取得原始信件標頭，無法回覆' };
    // 收件人／副本優先信任前端這次送來的值（信件編輯器裡使用者可以看到、也可以修改的欄位，2026-08-20
    // 起前端一律會帶）；沒帶（例如部署過渡期間還沒更新的舊分頁）才 fallback 用 computeReplySuggestion
    // 算出的「回覆全部」預設值，維持舊行為不中斷。
    const suggestion = this.computeReplySuggestion(threadMessages, current.account);
    const to = text(payload.to) || suggestion.to;
    if (!to) return { ok: false, action: 'replyCaseMail', error: '無法判斷回覆對象' };
    const cc = payload.cc !== undefined ? text(Array.isArray(payload.cc) ? payload.cc.join(',') : payload.cc) : suggestion.cc;
    const quote = gmailThreadQuote(threadMessages, htmlToPlainText(signatureHtml), signatureHtml);
    const raw = buildGmailRawMessage({
      to, cc, subject: lastSubject, bodyHtml, signatureHtml, quotedHtml: quote.html, quotedText: quote.plainText, inlineImages,
      threadHeaders: { inReplyTo: lastMessageId, references: [lastReferences, lastMessageId].filter(Boolean).join(' '), subject: /^re:/i.test(lastSubject) ? lastSubject : `Re: ${lastSubject}` }
    });
    const senderAccessToken = await this.getValidGmailAccessToken(current.account);
    const sendResponse = await fetch('https://gmail.googleapis.com/gmail/v1/users/me/messages/send', {
      method: 'POST', headers: { Authorization: `Bearer ${senderAccessToken}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(owner === canonicalAccount(current.account) ? { raw, threadId } : { raw })
    });
    const sendData = await sendResponse.json().catch(() => ({})) as Row;
    if (!sendResponse.ok) return { ok: false, action: 'replyCaseMail', error: text((sendData.error as Row)?.message) || `Gmail 回覆失敗：${sendResponse.status}` };
    return { ok: true, action: 'replyCaseMail', gmailMessageId: text(sendData.id) };
  }

  private insertScheduledMail(options: {
    caseId: string; kind: 'send' | 'reply'; ownerAccount: string; requestedBy: string;
    to: string; cc: string; subject: string; bodyHtml: string; signatureHtml: string;
    inlineImages: GmailInlineImage[]; scheduledAt: number;
  }): string {
    const id = randomToken();
    const now = new Date().toISOString();
    this.ctx.storage.sql.exec(
      `INSERT INTO scheduled_mail(id, case_id, kind, owner_account, requested_by, to_address, cc_address, subject, body_html, signature_html, inline_images, scheduled_at, status, error_message, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending', NULL, ?, ?)`,
      id, options.caseId, options.kind, canonicalAccount(options.ownerAccount), canonicalAccount(options.requestedBy),
      options.to, options.cc, options.subject, options.bodyHtml, options.signatureHtml, JSON.stringify(options.inlineImages),
      options.scheduledAt, now, now
    );
    return id;
  }

  /** 「指定排程時間」寄信（第一次建立信件串）——驗證跟 sendCaseMail 一致，多一道 scheduledAt 檢查；
   * 排程建立當下就先驗證一次 Gmail token 有效（getValidGmailAccessToken 會嘗試 refresh），避免排到很久
   * 以後才發現帳號根本沒連 Gmail、使用者卻毫無所知——真正寄出時仍然會再驗一次，refresh token 有可能
   * 在排程等待期間才失效。這裡只登記排程，不做任何實際寄送，真正寄出交給 runScheduledDispatch()。 */
  private async scheduleCaseMail(payload: ApiPayload, database: DatabaseSnapshot, session: SessionRecord | null): Promise<ApiResult> {
    const caseId = text(payload.caseId || payload.id);
    const existingRow = database.tables.database.rows.find(item => text(item['案件編號']) === caseId);
    const current = this.requireRowAccess(database, session, 'request.mail', existingRow);
    const to = text(payload.to);
    const cc = text(Array.isArray(payload.cc) ? payload.cc.join(',') : payload.cc);
    const subject = text(payload.subject);
    const bodyHtml = resolveBodyHtml(payload);
    const signatureHtml = text(payload.signatureHtml);
    const inlineImages = resolveGmailInlineImages(payload);
    if (!caseId) return { ok: false, action: 'scheduleCaseMail', error: '缺少案件編號' };
    if (!to || !subject) return { ok: false, action: 'scheduleCaseMail', error: '缺少收件人或主旨' };
    if (!existingRow) return { ok: false, action: 'scheduleCaseMail', error: '找不到案件資料' };
    if (text(existingRow['Gmail信件串ID'])) {
      return { ok: false, action: 'scheduleCaseMail', error: '此案件已經有 Gmail 信件串，請改用「回信」', reason: 'THREAD_EXISTS' };
    }
    const scheduledAt = parseScheduledAt(payload.scheduledAt);
    if (!scheduledAt) return { ok: false, action: 'scheduleCaseMail', error: '請指定合法的排程寄送時間（1 分鐘後到 1 年內）' };
    await this.getValidGmailAccessToken(current.account);
    // 同一案件的「首次寄信」只能有一筆待送排程。檢查放在最後一個 await 之後，與下面的 INSERT 之間
    // 沒有交出 Durable Object 執行權，兩個同時點下的請求也不會同時通過檢查而重複建立。
    const existingSchedules = this.ctx.storage.sql.exec<{ id: string; scheduled_at: number }>(
      `SELECT id, scheduled_at FROM scheduled_mail
       WHERE case_id = ? AND kind = 'send' AND status IN ('pending', 'sending')
       ORDER BY created_at ASC LIMIT 1`, caseId
    ).toArray();
    if (existingSchedules.length) {
      return {
        ok: false, action: 'scheduleCaseMail', reason: 'SCHEDULE_EXISTS',
        error: '此案件已有一封待寄出的排程信件，不會重複建立',
        scheduledId: existingSchedules[0].id, scheduledAt: existingSchedules[0].scheduled_at
      };
    }
    const scheduledId = this.insertScheduledMail({
      caseId, kind: 'send', ownerAccount: current.account, requestedBy: current.account,
      to, cc, subject, bodyHtml, signatureHtml, inlineImages, scheduledAt
    });
    return { ok: true, action: 'scheduleCaseMail', scheduledId, scheduledAt };
  }

  /** 「指定排程時間」回信——驗證跟 replyCaseMail 一致（含討論串相關人檢查），多一道 scheduledAt 檢查。
   * 收件人／副本邏輯跟 replyCaseMail 完全一致：前端有帶就用前端的，沒帶才 fallback 用 computeReplySuggestion
   * 算出的「回覆全部」預設值。這裡只登記排程，In-Reply-To/References 標頭要等真正寄出那一刻
   * （dispatchScheduledMailItem）才重新讀一次信件串現況去組，不是排程當下就算好固定死——如果排程等待期間
   * 這條討論串又有新信件加入，寄出時仍然會正確接在「當時最新的那一封」後面，行為跟立即回信一致。 */
  private async scheduleCaseReply(payload: ApiPayload, database: DatabaseSnapshot, session: SessionRecord | null): Promise<ApiResult> {
    const current = this.requireSession(session);
    const caseId = text(payload.caseId || payload.id);
    const row = database.tables.database.rows.find(item => text(item['案件編號']) === caseId);
    if (!row) return { ok: false, action: 'scheduleCaseReply', error: '找不到案件資料' };
    if (!hasRowCapability(database, current, 'request.mail', row)) {
      return { ok: false, action: 'scheduleCaseReply', error: '此帳號沒有「request.mail」權限', reason: 'REQUEST_MAIL_DENIED' };
    }
    const bodyHtml = resolveBodyHtml(payload);
    const signatureHtml = text(payload.signatureHtml);
    const inlineImages = resolveGmailInlineImages(payload);
    if (!htmlToPlainText(bodyHtml) && !inlineImages.length) return { ok: false, action: 'scheduleCaseReply', error: '回覆內容不可為空' };
    const threadId = text(row['Gmail信件串ID']);
    const owner = canonicalAccount(row['Gmail寄件帳號']);
    if (!threadId) return { ok: false, action: 'scheduleCaseReply', error: '此案件尚未透過 Gmail 寄出過信件' };
    const accessToken = await this.getValidGmailAccessToken(owner);
    const threadMessages = await fetchGmailThreadMessages(accessToken, threadId);
    if (!accountIsGmailThreadParticipant(current.account, threadMessages)) {
      return { ok: false, action: 'scheduleCaseReply', error: '此信件串的收件人/副本裡沒有這個帳號，無法回覆', reason: 'GMAIL_THREAD_NOT_PARTICIPANT' };
    }
    const suggestion = this.computeReplySuggestion(threadMessages, current.account);
    const to = text(payload.to) || suggestion.to;
    if (!to) return { ok: false, action: 'scheduleCaseReply', error: '無法判斷回覆對象' };
    const cc = payload.cc !== undefined ? text(Array.isArray(payload.cc) ? payload.cc.join(',') : payload.cc) : suggestion.cc;
    const scheduledAt = parseScheduledAt(payload.scheduledAt);
    if (!scheduledAt) return { ok: false, action: 'scheduleCaseReply', error: '請指定合法的排程寄送時間（1 分鐘後到 1 年內）' };
    await this.getValidGmailAccessToken(current.account);
    const scheduledId = this.insertScheduledMail({
      caseId, kind: 'reply', ownerAccount: current.account, requestedBy: current.account,
      to, cc, subject: '', bodyHtml, signatureHtml, inlineImages, scheduledAt
    });
    return { ok: true, action: 'scheduleCaseReply', scheduledId, scheduledAt };
  }

  /** 給信件編輯器顯示「已排程」清單用——只有跟 sendCaseMail/replyCaseMail 同一套 request.mail 權限的帳號
   * 才看得到，沒有另外限定「只能看自己排的」，因為這本來就是同一個案件、同一批人共用的信件操作範圍。 */
  private listScheduledMail(payload: ApiPayload, database: DatabaseSnapshot, session: SessionRecord | null): ApiResult {
    const current = this.requireSession(session);
    const caseId = text(payload.caseId || payload.id);
    if (!caseId) return { ok: false, action: 'listScheduledMail', error: '缺少案件編號' };
    const row = database.tables.database.rows.find(item => text(item['案件編號']) === caseId);
    if (!hasRowCapability(database, current, 'request.mail', row || {})) {
      return { ok: false, action: 'listScheduledMail', error: '此帳號沒有「request.mail」權限', reason: 'REQUEST_MAIL_DENIED' };
    }
    // 舊版在同一案件有多筆首次寄信排程時，第一筆成功後會把後續重複項目記成 failed。案件既然已經
    // 有 Gmail 信件串，這類項目實際上是「已成功寄出，重複排程未再寄」，在清單讀取時一次性改成 canceled，
    // 避免繼續以紅色「寄送失敗」誤導使用者；其他真正的 Gmail 失敗仍保留 failed 供查看。
    if (text(row?.['Gmail信件串ID'])) {
      this.ctx.storage.sql.exec(
        `UPDATE scheduled_mail SET status = 'canceled', error_message = NULL, updated_at = ?
         WHERE case_id = ? AND kind = 'send' AND status = 'failed'
           AND error_message LIKE '此案件已經有 Gmail 信件串%'`,
        new Date().toISOString(), caseId
      );
    }
    const items = this.ctx.storage.sql.exec<ScheduledMailRow>(
      `SELECT id, kind, to_address, cc_address, subject, scheduled_at, status, error_message, requested_by, created_at
       FROM scheduled_mail WHERE case_id = ? ORDER BY scheduled_at DESC LIMIT 30`, caseId
    ).toArray();
    return {
      ok: true, action: 'listScheduledMail',
      items: items.map(item => ({
        id: item.id, kind: item.kind, to: item.to_address, cc: item.cc_address, subject: item.subject,
        scheduledAt: item.scheduled_at, status: item.status, errorMessage: item.error_message || '',
        requestedBy: item.requested_by, createdAt: item.created_at
      }))
    };
  }

  /** 取消一筆還沒寄出的排程——只有還是 pending 狀態的才能取消（已經在寄送中／已寄出／已失敗／已取消都不能
   * 再改動），權限判斷比照該筆排程所屬案件的 request.mail（跟建立排程時同一套邏輯，不是只看「是不是本人排
   * 的」，因為信件操作本來就是同一批有權限的人共用，不是個人專屬）。 */
  private cancelScheduledMail(payload: ApiPayload, database: DatabaseSnapshot, session: SessionRecord | null): ApiResult {
    const current = this.requireSession(session);
    const id = text(payload.id || payload.scheduledId);
    if (!id) return { ok: false, action: 'cancelScheduledMail', error: '缺少排程編號' };
    const rows = this.ctx.storage.sql.exec<ScheduledMailRow>('SELECT * FROM scheduled_mail WHERE id = ?', id).toArray();
    const item = rows[0];
    if (!item) return { ok: false, action: 'cancelScheduledMail', error: '找不到這筆排程' };
    if (item.status !== 'pending') return { ok: false, action: 'cancelScheduledMail', error: '這筆排程已經處理過，無法取消' };
    const row = database.tables.database.rows.find(r => text(r['案件編號']) === item.case_id);
    if (!hasRowCapability(database, current, 'request.mail', row || {})) {
      return { ok: false, action: 'cancelScheduledMail', error: '此帳號沒有「request.mail」權限', reason: 'REQUEST_MAIL_DENIED' };
    }
    this.ctx.storage.sql.exec('UPDATE scheduled_mail SET status = ?, updated_at = ? WHERE id = ? AND status = ?', 'canceled', new Date().toISOString(), id, 'pending');
    return { ok: true, action: 'cancelScheduledMail', id };
  }

  /** 實際把一筆排定的信寄出去——由 runScheduledDispatch() 對每一筆到期的排程各自呼叫。kind='send' 在真正
   * 寄出前重新檢查一次案件是否「已經有」Gmail 信件串（排程等待期間，案件有可能被用其他方式先寄出過），
   * 避免重複建立第二條信件串；成功後跟 sendCaseMail 一樣把 Gmail信件串ID／Gmail寄件帳號寫回 database 表。
   * kind='reply' 一律在寄出前重新讀一次信件串現況（fetchGmailThreadMessages/buildGmailReplyRaw），不是沿用
   * 排程建立當下的舊標頭，確保接在正確的最新一封信後面。失敗直接讓例外往外拋，由呼叫端統一記錄失敗原因。 */
  private async dispatchScheduledMailItem(item: ScheduledMailRow): Promise<'sent' | 'canceled'> {
    const inlineImages = JSON.parse(item.inline_images || '[]') as GmailInlineImage[];
    const accessToken = await this.getValidGmailAccessToken(item.owner_account);
    if (item.kind === 'send') {
      const stored = await this.snapshot();
      const row = stored.database.tables.database.rows.find(r => text(r['案件編號']) === item.case_id);
      if (!row) throw new Error('找不到案件資料，排程未寄出');
      // 排程等待期間若已用其他方式建立信件串，代表「不需要再寄」，不是 Gmail 寄送失敗。
      if (text(row['Gmail信件串ID'])) return 'canceled';
      const raw = buildGmailRawMessage({ to: item.to_address, cc: item.cc_address, subject: item.subject, bodyHtml: item.body_html, signatureHtml: item.signature_html, inlineImages });
      const result = await postGmailMessage(accessToken, raw);
      await this.mutate('scheduleCaseMail', { user: item.requested_by, account: item.requested_by, provider: 'password', expiresAt: Date.now() }, draft => {
        const target = draft.tables.database.rows.find(r => text(r['案件編號']) === item.case_id);
        if (!target) throw new Error('找不到案件資料');
        target['Gmail信件串ID'] = result.threadId;
        target['Gmail寄件帳號'] = item.owner_account;
        return { result: { ok: true }, changedTables: ['database'] };
      });
      // 清掉舊版可能已建立的其他同案件首次寄信排程。包含 sending，因為同一輪 Cron 可能一次 claim 到多筆舊資料。
      this.ctx.storage.sql.exec(
        `UPDATE scheduled_mail SET status = 'canceled', error_message = NULL, updated_at = ?
         WHERE case_id = ? AND kind = 'send' AND id <> ? AND status IN ('pending', 'sending')`,
        new Date().toISOString(), item.case_id, item.id
      );
      return 'sent';
    }
    const stored = await this.snapshot();
    const row = stored.database.tables.database.rows.find(r => text(r['案件編號']) === item.case_id);
    if (!row) throw new Error('找不到案件資料，排程未寄出');
    const threadId = text(row['Gmail信件串ID']);
    if (!threadId) throw new Error('此案件已經沒有 Gmail 信件串，排程未寄出');
    const threadOwner = canonicalAccount(row['Gmail寄件帳號']);
    const threadAccessToken = threadOwner === canonicalAccount(item.owner_account)
      ? accessToken
      : await this.getValidGmailAccessToken(threadOwner);
    const threadMessages = await fetchGmailThreadMessages(threadAccessToken, threadId);
    const raw = buildGmailReplyRaw(threadMessages, { to: item.to_address, cc: item.cc_address, bodyHtml: item.body_html, signatureHtml: item.signature_html, inlineImages });
    await postGmailMessage(accessToken, raw, threadOwner === canonicalAccount(item.owner_account) ? threadId : undefined);
    return 'sent';
  }

  /** Cron Trigger（wrangler.jsonc 的 triggers.crons，每分鐘一次）觸發的入口——找出所有「到期的待寄送排程」
   * 逐一寄出。這是公開方法（不是 private），供 index.ts 的 scheduled() 直接用 stub.runScheduledDispatch()
   * 呼叫，不走一般帶 session 的 handle() action 路由（這是背景排程，沒有使用者 session 可言）。
   *
   * claim 這一步（SELECT 到期項目→同步呼叫 UPDATE 標成 'sending'）刻意寫成兩個 sql.exec 之間完全沒有
   * await，確保這兩行在 Durable Object 裡是同一個不可中斷的同步區塊執行完——Cloudflare 允許同一個 DO
   * 實例同時處理多個並行呼叫（在 await 的地方才會真的交錯執行），如果兩次 Cron 觸發剛好重疊（例如上一輪
   * 因為要寄的信很多、還沒寄完，下一分鐘又觸發一次），沒有這道 claim 會讓兩輪都读到同一批 'pending'
   * 項目、各自呼叫 Gmail API 寄出兩次——這正是這個系統最近才真正踩過、也修過的同一類重複寄送問題
   * （NAS 自動上傳的鎖只保護自己、不保護另一支同時讀寫同一份狀態的程式），這裡從一開始就把兩個入口
   * （claim 與 dispatch）分開、claim 用同步區塊完成，避免重演同一種錯誤。
   *
   * 'sending' 狀態如果卡住超過 10 分鐘沒有變成 'sent'/'failed'（例如那次 Worker 執行被平台中途中止），
   * 视為異常中斷，下一輪執行一開始會先把它們收回 'pending' 重新排隊，不會永遠卡住不寄。 */
  async runScheduledDispatch(): Promise<{ processed: number; sent: number; failed: number }> {
    const staleBefore = new Date(Date.now() - 10 * 60 * 1000).toISOString();
    this.ctx.storage.sql.exec(
      `UPDATE scheduled_mail SET status = 'pending' WHERE status = 'sending' AND updated_at < ?`, staleBefore
    );
    const due = this.ctx.storage.sql.exec<ScheduledMailRow>(
      `SELECT * FROM scheduled_mail WHERE status = 'pending' AND scheduled_at <= ? ORDER BY scheduled_at ASC LIMIT 20`, Date.now()
    ).toArray();
    if (due.length) {
      const claimedAt = new Date().toISOString();
      const placeholders = due.map(() => '?').join(',');
      this.ctx.storage.sql.exec(
        `UPDATE scheduled_mail SET status = 'sending', updated_at = ? WHERE id IN (${placeholders})`,
        claimedAt, ...due.map(item => item.id)
      );
    }
    let sent = 0, failed = 0;
    for (const item of due) {
      // 前一筆成功寄出後可能已把同一批 claim 到的舊重複排程改成 canceled；不可繼續用 due 的舊快照寄出。
      const live = this.ctx.storage.sql.exec<{ status: string }>('SELECT status FROM scheduled_mail WHERE id = ?', item.id).toArray()[0];
      if (live?.status !== 'sending') continue;
      try {
        const outcome = await this.dispatchScheduledMailItem(item);
        this.ctx.storage.sql.exec('UPDATE scheduled_mail SET status = ?, error_message = NULL, updated_at = ? WHERE id = ?', outcome, new Date().toISOString(), item.id);
        if (outcome === 'sent') sent += 1;
      } catch (error) {
        const message = (error instanceof Error ? error.message : String(error)).slice(0, 500);
        this.ctx.storage.sql.exec('UPDATE scheduled_mail SET status = ?, error_message = ?, updated_at = ? WHERE id = ?', 'failed', message, new Date().toISOString(), item.id);
        failed += 1;
      }
    }
    return { processed: due.length, sent, failed };
  }

  /**
   * 前台「填寫設計需求」表單「客戶別」下拉選單的「新增客戶別」——只需要 request.create（跟新增案件同一個
   * 廣泛授權），任何登入角色都能建立一筆只有名稱、專案負責人／設計負責人／部門組別皆空白的客戶別。
   * 後台管理者要指派名單，改走通用的 adminTableUpdate（database.manage 權限）。
   */
  private async addCustomer(payload: ApiPayload, database: DatabaseSnapshot, session: SessionRecord | null): Promise<ApiResult> {
    // 比照 addRequests（填單新增案件）：有 session 才檢查 request.create，未登入沿用「填單本來就不強制登入」的既有慣例。
    if (session) this.requireAccess(database, session, 'request.create');
    const name = text(payload.name || payload['客戶別']);
    if (!name) throw new Error('請輸入客戶別名稱');
    if (name.length > 40) throw new Error('客戶別名稱不得超過 40 個字');
    return this.mutate('addCustomer', session, draft => {
      const table = draft.tables['客戶別'];
      if (table.rows.some(row => text(row['客戶別']) === name)) throw new Error('這個客戶別已經存在');
      const row: Row = { '客戶別': name, '排序': '', '專案負責人': '[]', '設計負責人': '[]', '部門組別': '[]', '更新時間': nowTaipei(), '更新者': session?.account ? text(session.account) : '匿名填單' };
      table.rows.push(row);
      return { result: { ok: true, action: 'addCustomer', customer: row }, changedTables: ['客戶別'] };
    });
  }

  async handle(actionValue: string, payload: ApiPayload = {}, context: RequestContext): Promise<ApiResult> {
    const action = text(actionValue || payload.action || 'list');
    try {
      if (action === 'googleLogin') return await this.googleLogin(payload, context);
      if (action === 'login') return await this.passwordLogin(payload, context);
      if (action === 'erpLogin') return await this.erpLogin(payload, context);
      if (action === 'erpLoginConfig') return { ok: true, action, baseUrl: this.env.ERP_BASE_URL, clientId: this.env.ERP_CLIENT_ID, redirectUri: this.env.ERP_REDIRECT_URI, scope: 'openid profile' };

      const stored = await this.snapshot(action === 'refreshDatabase');
      const database = stored.database;
      const session = await this.sessionFor(payload);
      const baseUrl = text(payload.supplementBaseUrl) || context.baseUrl;

      if (action === 'ping') return { ok: true, action, version: VERSION, storage: 'cloudflare-worker-github-json', revision: database.revision, message: 'connected' };
      if (action === 'getSystemAnnouncement') return { ok: true, action, announcement: publicSystemAnnouncement(database), revision: database.revision };
      if (action === 'markSystemAnnouncementRead') {
        const current = this.requireSession(session);
        const version = text(payload.version || payload['公告版本']);
        if (!version) throw new Error('缺少公告版本');
        return this.mutate(action, current, draft => {
          const row = draft.tables['系統公告欄'].rows.find(item => text(item['公告版本']) === version);
          if (!row) throw new Error('找不到這個系統公告');
          const account = canonicalAccount(current.account || current.user);
          const records = systemAnnouncementReadRecords(row);
          const result = { ok: true, action, version, account, readCount: records.length, readRecords: records };
          if (records.some(record => record.account === account)) return { result, changed: false };
          const profile = settingsRow(draft, account || current.user);
          records.push({
            account,
            name: text(profile?.['顯示名'] || profile?.['名字'] || current.user || account),
            readAt: nowTaipei()
          });
          row['已讀紀錄'] = JSON.stringify(records);
          return {
            result: { ...result, readCount: records.length, readRecords: records },
            changedTables: ['系統公告欄']
          };
        });
      }
      if (action === 'diagnose') return { ok: true, action, version: VERSION, storage: 'cloudflare-worker-github-json', revision: database.revision, tables: Object.fromEntries(tableNames().map(name => [name, database.tables[name].rows.length])) };
      if (action === 'urlFetchAuthCheck') return { ok: true, action, status: 200, message: 'Cloudflare Worker fetch 可執行', version: VERSION };
      if (action === 'writeAccessCheck') return { ok: true, action, checkedAt: new Date().toISOString(), nonMutating: true, permissions: { createRequest: true, updateRequest: true, updateStatusDetails: Boolean(session), reason: 'Cloudflare Worker 已連線；狀態與細節依登入權限判斷' }, checks: { databaseWritable: Boolean(this.env.GITHUB_TOKEN) } };
      if (action === 'refreshDatabase') { this.requireAccess(database, session, 'database.manage'); return { ok: true, action, revision: database.revision, refreshed: true }; }
      if (action === 'verifyToken') {
        if (!session) return { ok: false, action, error: 'TOKEN_EXPIRED' };
        const access = accessProfile(database, session);
        if (access.status === '停用') return { ok: false, action, error: '帳號已停用', reason: 'ACCOUNT_DISABLED' };
        return { ok: true, action, user: session.user, account: session.account, email: session.account, expiresIn: Math.max(0, Math.floor((session.expiresAt - Date.now()) / 1000)), settings: settingsResponse(settingsRow(database, session.account || session.user) || {}), access };
      }
      if (action === 'getAccessProfile') { this.requireSession(session); return { ok: true, action, access: accessProfile(database, session) }; }
      if (action === 'logout') { await this.deleteSession(payload); return { ok: true, action }; }
      if (action === 'gmailStatus') return this.gmailStatus(database, session);
      if (action === 'getGmailSignature') return await this.getGmailSignature(database, session);
      if (action === 'gmailOauthConnect') return await this.gmailOauthConnect(payload, database, session);
      if (action === 'gmailDisconnect') return await this.gmailDisconnect(database, session);
      if (action === 'sendCaseMail') return await this.sendCaseMail(payload, database, session);
      if (action === 'getCaseMailThread') return await this.getCaseMailThread(payload, database, session);
      if (action === 'replyCaseMail') return await this.replyCaseMail(payload, database, session);
      if (action === 'scheduleCaseMail') return await this.scheduleCaseMail(payload, database, session);
      if (action === 'scheduleCaseReply') return await this.scheduleCaseReply(payload, database, session);
      if (action === 'listScheduledMail') return this.listScheduledMail(payload, database, session);
      if (action === 'cancelScheduledMail') return this.cancelScheduledMail(payload, database, session);
      if (action === 'addCustomer') return await this.addCustomer(payload, database, session);

      if (action === 'list' || action === 'recent') {
        const year = text(payload.year);
        let indexed = database.tables.database.rows.map((row, index) => ({ row, index })).filter(item => !year || rowYear(item.row) === year);
        if (action === 'recent') indexed = indexed.sort((a, b) => text(b.row['案件編號']).localeCompare(text(a.row['案件編號']))).slice(0, Math.min(200, Math.max(1, Number(payload.limit) || 30)));
        return { ok: true, action, rows: indexed.map(item => toApiRow(item.row, item.index)), revision: database.revision };
      }
      if (action === 'bundle' || action === 'statsData') {
        const year = text(payload.year);
        const rows = database.tables.database.rows.filter(row => !year || rowYear(row) === year);
        return { ok: true, action: 'bundle', version: VERSION, rows: rows.map((row, index) => toApiRow(row, index)), databaseRows: rows, weights: database.tables['加權計分標準'].rows, stages: [], revision: database.revision };
      }
      if (action === 'createRequestStatus') return { ok: true, action, pending: !database.internal.idempotency[text(payload.requestId)], result: database.internal.idempotency[text(payload.requestId)] || null };
      if (action === 'resolveSupplementLink') {
        const id = text(payload.id || payload.caseId), slot = text(payload.slot).toLowerCase();
        if (!/^\d{8}$/.test(id) || !SUPPLEMENT_SLOTS[slot]) throw new Error('補充資料連結格式錯誤');
        const record = database.tables['補充資料連結'].rows.find(row => text(row['案件編號']) === id);
        const url = text(record?.[SUPPLEMENT_SLOTS[slot].column]);
        if (!isHttpUrl(url)) throw new Error('找不到可用的補充資料連結');
        return { ok: true, action, id, slot, url };
      }
      if (action === 'resolveShortLink') {
        const code = text(payload.code);
        const record = database.tables['短連結'].rows.find(row => text(row['短碼']) === code);
        if (!record || !isHttpUrl(record['原始網址'])) throw new Error('找不到這個短連結');
        return { ok: true, action, code, url: record['原始網址'] };
      }

      if (action === 'getUserSettings') {
        const current = this.requireSession(session);
        const account = canonicalAccount(payload.account || current.account);
        if (account !== canonicalAccount(current.account) && !hasCapability(database, current, 'database.manage')) throw new Error('不可讀取其他帳號的個人設定');
        return { ok: true, action, account, settings: settingsResponse(settingsRow(database, account || current.user) || {}) };
      }
      if (action === 'listDesignerProfiles') {
        const profiles = database.tables['設定'].rows.filter(isDesignerSettingsRow).map(row => ({
          name: text(row['名字']), account: canonicalAccount(row['帳號']), avatar: text(row['頭像連結']),
          poster: text(row['頭像大圖連結'] || row['頭像連結']), musicUrl: text(row['分享音樂']),
          musicStartAt: Math.max(0, Number(row['音樂起始秒數']) || 0), skills: splitNames(row['技能']),
          quote: text(row['對話框']), replyTemplates: normalizedReplyTemplates(row['回信範本設定']), rotation: Number(row['新專案輪值']) || 99,
          skillMappings: normalizedSkillMappings(row['技能表單設定']), enabled: true,
          designType: /影音|影像|影片/i.test(text(row['組別'])) ? '影音' : (/平面/.test(text(row['組別'])) ? '平面' : '')
        }));
        return { ok: true, action, profiles };
      }
      if (action === 'listReels') {
        const stories = database.tables.reels.rows.map((row, index) => ({ row, index })).filter(item => activeReel(item.row)).map(item => publicReel(item.row, item.index));
        return { ok: true, action, stories, reels: stories };
      }
      if (action === 'listIssueReports') return { ok: true, action, reports: database.tables.bug_report.rows.map(issueRow).reverse() };
      if (action === 'listModificationRecords') {
        const ids = Array.isArray(payload.ids) && payload.ids.length ? new Set(payload.ids.map(text)) : null;
        const rows = database.tables['修改統計表'].rows.map<Row>((row, index) => ({ rowNumber: index + 2, ...row })).filter(row => !ids || ids.has(text(row['案件編號'])));
        return { ok: true, action, rows };
      }

      if (action === 'adminTables') {
        this.requireAccess(database, session, 'database.manage');
        const tables = Object.fromEntries(ADMIN_TABLE_ORDER.filter(name => database.tables[name]).map(name => [name, {
          headers: database.tables[name].headers, primaryKey: database.tables[name].primaryKey || '', rowCount: database.tables[name].rows.length
        }]));
        return { ok: true, action, revision: database.revision, updatedAt: database.updatedAt, source: 'cloudflare-worker-github-json', tables };
      }
      if (action === 'adminTableRows') {
        this.requireAccess(database, session, 'database.manage');
        return this.adminTableRows(database, payload);
      }
      if (action === 'backupDatabaseToSheet') {
        this.requireAccess(database, session, 'database.manage');
        return await this.backupDatabaseToSheet(database);
      }

      return await this.handleWriteAction(action, payload, context, database, session, baseUrl);
    } catch (error) {
      console.error(JSON.stringify({ event: 'api-error', action, message: error instanceof Error ? error.message : String(error) }));
      return { ok: false, action, error: error instanceof Error ? error.message : String(error) };
    }
  }

  private adminTableRows(database: DatabaseSnapshot, payload: ApiPayload): ApiResult {
    const tableName = text(payload.table);
    const table = database.tables[tableName];
    if (!table) throw new Error(`未知資料表：${tableName}`);
    const offset = Math.max(0, Number(payload.offset) || 0);
    const limit = Math.min(100000, Math.max(1, Number(payload.limit) || 100));
    const query = text(payload.q).toLocaleLowerCase();
    const sort = text(payload.sort);
    const order = text(payload.order).toLowerCase() === 'desc' ? -1 : 1;
    let filters: Row = {};
    if (payload.filters && typeof payload.filters === 'object' && !Array.isArray(payload.filters)) filters = payload.filters as Row;
    else if (text(payload.filters)) { try { const parsed = JSON.parse(text(payload.filters)); if (parsed && typeof parsed === 'object') filters = parsed; } catch { /* ignore malformed filters */ } }
    const activeFilters = Object.entries(filters).map(([header, value]) => [header, text(value)] as const).filter(([, value]) => value);
    let rows = table.rows.map<Row>((row, index) => {
      const result = { _rowNumber: index + 2, ...row } as Row;
      if (tableName === '帳號權限') {
        delete result['密碼雜湊'];
        result._credentialConfigured = Boolean(this.localPasswordHash(row['帳號']) || text(row['密碼雜湊']));
      }
      return result;
    });
    if (activeFilters.length) rows = rows.filter(row => activeFilters.every(([header, value]) => text(row[header]) === value));
    if (query) rows = rows.filter(row => Object.values(row).some(value => text(value).toLocaleLowerCase().includes(query)));
    if (sort) rows.sort((left, right) => text(left[sort]).localeCompare(text(right[sort]), 'zh-Hant', { numeric: true }) * order);
    return { ok: true, action: 'adminTableRows', table: tableName, revision: database.revision, offset, limit, total: rows.length, rows: rows.slice(offset, offset + limit) };
  }

  private async backupDatabaseToSheet(database: DatabaseSnapshot): Promise<ApiResult> {
    const table = database.tables.database;
    if (!table) throw new Error('找不到資料庫資料表');
    const headers = table.headers;
    const primaryKey = text(table.primaryKey) || '案件編號';
    const rows = table.rows.map(row => Object.fromEntries(headers.map(header => [header, row[header] ?? ''])));
    const scriptUrl = text(this.env.UPLOAD_APPS_SCRIPT_URL);
    const serviceKey = text(this.env.DATABASE_BACKUP_API_KEY);
    if (!scriptUrl || !serviceKey) throw new Error('尚未設定雲端試算表備份服務（UPLOAD_APPS_SCRIPT_URL／DATABASE_BACKUP_API_KEY）');
    let response: Response;
    try {
      response = await fetch(scriptUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'backupDatabaseTableToSheet', serviceKey, headers, primaryKey, rows })
      });
    } catch (error) {
      throw new Error('無法連線雲端試算表備份服務：' + String((error as { message?: string })?.message || error));
    }
    let result: { success?: boolean; message?: string; matchedColumns?: number; updated?: number; appended?: number; sheetName?: string; updatedAt?: string };
    try {
      result = await response.json();
    } catch {
      throw new Error('雲端試算表備份服務回應格式錯誤');
    }
    if (!response.ok || !result.success) throw new Error(result.message || `雲端試算表備份失敗（HTTP ${response.status}）`);
    return {
      ok: true, action: 'backupDatabaseToSheet', rows: rows.length,
      matchedColumns: result.matchedColumns ?? 0, updated: result.updated ?? 0, appended: result.appended ?? 0,
      sheetName: result.sheetName || 'database', updatedAt: result.updatedAt || new Date().toISOString(),
      revision: database.revision
    };
  }

  private async handleWriteAction(
    action: string,
    payload: ApiPayload,
    context: RequestContext,
    database: DatabaseSnapshot,
    session: SessionRecord | null,
    baseUrl: string
  ): Promise<ApiResult> {
    if (action === 'createShortLink') {
      throw new Error('短網址建立功能目前暫停；請直接使用原始長網址');
    }
    if (action === 'saveUserSettings') {
      const current = this.requireAccess(database, session, 'profile.edit');
      const account = canonicalAccount(payload.account || current.account);
      if (account !== canonicalAccount(current.account) && !hasCapability(database, current, 'database.manage')) throw new Error('不可修改其他帳號的個人設定');
      return this.mutate(action, current, draft => {
        const row = settingsRow(draft, account || current.user);
        if (!row) throw new Error('找不到個人設定資料');
        updateSettingsRow(row, asRow(payload.settings));
        return { result: { ok: true, action, account, settings: settingsResponse(row) }, changedTables: ['設定'] };
      });
    }
    if (action === 'saveDesignerProfiles') {
      const current = this.requireAnyAccess(database, session, ['designer.settings', 'media.manage']);
      return this.mutate(action, current, draft => {
        for (const profile of asRows(payload.profiles)) {
          const row = draft.tables['設定'].rows.find(item => text(item['名字']) === text(profile.name));
          if (!row) continue;
          if ('avatar' in profile) row['頭像連結'] = text(profile.avatar);
          if ('poster' in profile) row['頭像大圖連結'] = text(profile.poster);
          if ('musicUrl' in profile) row['分享音樂'] = text(profile.musicUrl);
          if ('musicStartAt' in profile) row['音樂起始秒數'] = String(Math.max(0, Number(profile.musicStartAt) || 0));
          if ('skills' in profile) row['技能'] = (Array.isArray(profile.skills) ? profile.skills.map(text) : splitNames(profile.skills)).join(' , ');
          if ('quote' in profile) row['對話框'] = text(profile.quote);
          if ('replyTemplates' in profile) row['回信範本設定'] = JSON.stringify(normalizedReplyTemplates(profile.replyTemplates));
        }
        return { result: { ok: true, action }, changedTables: ['設定'] };
      });
    }
    if (action === 'toggleReelReaction') {
      const current = this.requireAccess(database, session, 'reel.interact');
      return this.mutate(action, current, draft => {
        const index = findReelIndex(draft.tables.reels.rows, payload);
        if (index < 0) throw new Error('找不到限時動態');
        const row = draft.tables.reels.rows[index];
        const reaction = text(payload.reaction || payload.type).toLowerCase();
        const userName = text(current.user || current.account.split('@')[0]);
        const likes = splitNames(row['按讚']), dislikes = splitNames(row['倒讚']);
        const target = reaction === 'dislike' ? dislikes : likes, other = reaction === 'dislike' ? likes : dislikes;
        const targetIndex = target.indexOf(userName);
        if (targetIndex >= 0) target.splice(targetIndex, 1); else target.push(userName);
        const otherIndex = other.indexOf(userName); if (otherIndex >= 0) other.splice(otherIndex, 1);
        row['按讚'] = unique(likes).join(' , '); row['倒讚'] = unique(dislikes).join(' , ');
        return { result: { ok: true, action, story: publicReel(row, index) }, changedTables: ['reels'] };
      });
    }
    if (action === 'addReelComment') {
      const current = this.requireAccess(database, session, 'reel.interact');
      const commentText = text(payload.comment || payload.text);
      if (!commentText || commentText.length > 300) throw new Error('留言必須為 1–300 字');
      return this.mutate(action, current, draft => {
        const index = findReelIndex(draft.tables.reels.rows, payload);
        if (index < 0) throw new Error('找不到限時動態');
        const row = draft.tables.reels.rows[index];
        const userRow = settingsRow(draft, current.account || current.user);
        const comments = parseCommentList(row['留言']);
        comments.push({ id: crypto.randomUUID(), name: current.user, account: current.account, avatar: text(userRow?.['頭像連結']), text: commentText, createdAt: new Date().toISOString() });
        row['留言'] = JSON.stringify(comments);
        return { result: { ok: true, action, story: publicReel(row, index) }, changedTables: ['reels'] };
      });
    }
    if (action === 'upsertDesignerStories') {
      const current = this.requireAccess(database, session, 'media.manage');
      const name = text(payload.name || payload.designer);
      if (!database.tables['設定'].rows.some(row => isDesignerSettingsRow(row) && text(row['名字']) === name)) throw new Error('找不到設計師');
      const fileIds = Array.isArray(payload.fileIds) ? payload.fileIds.map(text) : [];
      const imageUrls = Array.isArray(payload.imageUrls) ? payload.imageUrls.map(text) : [];
      const expiresAtMs = Math.max(0, Number(payload.expiresAt) || 0);
      if (!imageUrls.length || imageUrls.some(url => !isHttpUrl(url))) throw new Error('沒有可同步的限時動態');
      return this.mutate(action, current, draft => {
        const rows = draft.tables.reels.rows;
        const synced = imageUrls.map((url, index) => {
          const fileId = fileIds[index] || reelFileId(url);
          let row = rows.find(item => (fileId && reelFileId(item['限時動態連結']) === fileId) || text(item['限時動態連結']) === url);
          if (!row) { row = {}; rows.push(row); }
          Object.assign(row, {
            '名字': name,
            '限時動態連結': url,
            '保留期限': expiresAtMs ? '24小時' : '永久',
            '到期時間': expiresAtMs ? new Date(expiresAtMs).toISOString() : '',
            '按讚': row['按讚'] || '',
            '倒讚': row['倒讚'] || '',
            '留言': row['留言'] || '[]'
          });
          return publicReel(row, rows.indexOf(row));
        });
        return { result: { ok: true, action, designer: name, count: synced.length, reels: synced }, changedTables: ['reels'] };
      });
    }
    if (action === 'deleteDesignerStories') {
      const current = this.requireAccess(database, session, 'media.manage');
      const name = text(payload.name || payload.designer);
      const ids = new Set((Array.isArray(payload.fileIds) ? payload.fileIds : []).map(text).filter(Boolean));
      if (!name || !ids.size) throw new Error('缺少設計師或限時動態檔案');
      return this.mutate(action, current, draft => {
        const before = draft.tables.reels.rows.length;
        draft.tables.reels.rows = draft.tables.reels.rows.filter(row => !(text(row['名字']) === name && ids.has(reelFileId(row['限時動態連結']))));
        return { result: { ok: true, action, designer: name, deleted: before - draft.tables.reels.rows.length }, changedTables: ['reels'] };
      });
    }
    if (action === 'deleteDesignerMediaFiles') {
      const current = this.requireAccess(database, session, 'media.manage');
      const name = text(payload.name || payload.designer);
      const ids = new Set((Array.isArray(payload.fileIds) ? payload.fileIds : []).map(text).filter(Boolean));
      if (!name || !ids.size) throw new Error('缺少設計師或圖片檔案');
      return this.mutate(action, current, draft => {
        const profile = draft.tables['設定'].rows.find(row => text(row['名字']) === name);
        if (!profile) throw new Error('找不到設計師設定');
        const cleared: string[] = [];
        const mediaFields: Array<[string, string]> = [
          ['avatar', '頭像連結'],
          ['poster', '頭像大圖連結']
        ];
        for (const [kind, header] of mediaFields) {
          const value = text(profile[header]);
          if (value && [...ids].some(id => value.includes(id))) {
            profile[header] = '';
            cleared.push(kind);
          }
        }
        const before = draft.tables.reels.rows.length;
        draft.tables.reels.rows = draft.tables.reels.rows.filter(row => !(
          text(row['名字']) === name && ids.has(reelFileId(row['限時動態連結']))
        ));
        const deletedStories = before - draft.tables.reels.rows.length;
        const changedTables = [
          ...(cleared.length ? ['設定'] : []),
          ...(deletedStories ? ['reels'] : [])
        ];
        return {
          result: { ok: true, action, designer: name, fileIds: [...ids], cleared, deletedStories },
          changed: changedTables.length > 0,
          changedTables
        };
      });
    }
    if (action === 'reportIssue') {
      if (session) this.requireAccess(database, session, 'issue.report');
      const report = asRow(payload.report || payload.row || payload.data || payload);
      const content = text(report.content || report['內容']), suggestion = text(report.suggestion || report['修改建議']);
      if (!content || content.length > 300 || suggestion.length > 300) throw new Error('問題內容必填，內容與修改建議不得超過 300 字');
      return this.mutate(action, session, draft => {
        const time = nowTaipei();
        const row = Object.fromEntries(TABLE_SCHEMAS.bug_report.headers.map((header: string) => [header, ''])) as Row;
        Object.assign(row, { '姓名': text(session?.user || report.name || report['姓名'] || report.reporter || '未登入'), '時間': time, '內容': content, '修改建議': suggestion, '狀態': '回報中', '狀態更改時間': time, '回報中': time });
        draft.tables.bug_report.rows.push(row);
        return { result: { ok: true, action, rowNumber: draft.tables.bug_report.rows.length + 1, row: issueRow(row, draft.tables.bug_report.rows.length - 1) }, changedTables: ['bug_report'] };
      });
    }
    if (action === 'updateIssueReportStatus') {
      const current = this.requireAccess(database, session, 'issue.manage');
      const rowNumber = Number(payload.rowNumber || payload.id), status = text(payload.status);
      if (!Number.isInteger(rowNumber) || rowNumber < 2 || !ISSUE_STATUSES.includes(status)) throw new Error('回報狀態或列號不正確');
      return this.mutate(action, current, draft => {
        const row = draft.tables.bug_report.rows[rowNumber - 2];
        if (!row) throw new Error('找不到要更新的回報');
        const time = nowTaipei(); row['狀態'] = status; row['狀態更改時間'] = time; row[status] = time;
        return { result: { ok: true, action, rowNumber, row: issueRow(row, rowNumber - 2) }, changedTables: ['bug_report'] };
      });
    }
    if (action === 'addModificationRecord') {
      const record = asRow(payload.record || payload.row || payload.data || payload);
      if (session) this.requireAccess(database, session, 'modification.create');
      const caseId = text(record.caseId || record.id || record['案件編號']);
      const modifyDate = text(record.modifyDate || record['修改日期']);
      const content = text(record.content || record['修改內容']);
      const modifier = text(session?.user || record.modifier || record.owner || record['修改人'] || record['專案負責人']);
      const targetImages = unique((Array.isArray(record.targetImages) ? record.targetImages : []).map(text).filter(Boolean));
      if (!caseId || !modifyDate || !content || !modifier) throw new Error('案件編號、修改日期、修改內容與修改人皆為必填');
      return this.mutate(action, session, draft => {
        const rows = draft.tables['修改統計表'].rows;
        const count = rows.filter(row => text(row['案件編號']) === caseId).reduce((max, row) => Math.max(max, Number(row['修改次數']) || 0), 0) + 1;
        const row = { '案件編號': caseId, '修改次數': String(count), '建立日期': nowTaipei(), '修改日期': modifyDate, '修改內容': content, '修改人': modifier, '確認修正日': '', '待修改圖片': targetImages.length ? JSON.stringify(targetImages) : '' };
        rows.push(row);
        recalculateDatabaseModificationCounts(draft);
        return { result: { ok: true, action, rowNumber: rows.length + 1, record: row, count }, changedTables: ['修改統計表', 'database'] };
      });
    }
    if (action === 'updateModificationConfirm') {
      const current = this.requireAccess(database, session, 'modification.confirm');
      const record = asRow(payload.record || payload.row || payload.data || payload);
      const caseId = text(record.caseId || record.id || record['案件編號']), count = Number(record.count || record['修改次數']);
      return this.mutate(action, current, draft => {
        const index = draft.tables['修改統計表'].rows.findIndex(row => text(row['案件編號']) === caseId && Number(row['修改次數']) === count);
        if (index < 0) throw new Error('找不到指定的修改紀錄');
        const row = draft.tables['修改統計表'].rows[index];
        row['確認修正日'] = ('confirmedDate' in record || '確認修正日' in record) && !text(record.confirmedDate || record['確認修正日']) ? '' : nowTaipei();
        return { result: { ok: true, action, rowNumber: index + 2, record: row }, changedTables: ['修改統計表'] };
      });
    }
    if (action === 'addCaseDesignImages') {
      const apiKey = text(payload.serviceKey || payload.apiKey);
      const serviceAuthorized = Boolean(apiKey && this.env.NAS_WATCHER_API_KEY) && await secureEqual(apiKey, this.env.NAS_WATCHER_API_KEY);
      if (!serviceAuthorized) {
        if (!session) throw new Error('缺少服務金鑰或登入權限，無法寫入設計圖紀錄');
        this.requireAccess(database, session, 'media.manage');
      }
      const caseId = text(payload.caseId || payload.id || payload['案件編號']);
      const roundNumber = Math.trunc(Number(payload.round ?? payload['修改次數']));
      const images = (Array.isArray(payload.images) ? payload.images : [])
        .map(item => (item && typeof item === 'object' && !Array.isArray(item))
          ? { fileName: text((item as Row).fileName), url: text((item as Row).url) }
          : { fileName: '', url: text(item) })
        .filter(item => isHttpUrl(item.url));
      const source = text(payload.source) || (serviceAuthorized ? 'nas-watcher' : 'manual');
      if (!caseId) throw new Error('缺少案件編號');
      if (!Number.isFinite(roundNumber) || roundNumber < 0) throw new Error('缺少修改輪次（0=初稿）');
      if (!images.length) throw new Error('沒有可寫入的圖片網址');
      return this.mutate(action, session, draft => {
        if (!draft.tables.database.rows.some(row => text(row['案件編號']) === caseId)) throw new Error('找不到案件');
        const rows = draft.tables['修改統計表'].rows;
        let row = rows.find(item => text(item['案件編號']) === caseId && Number(item['修改次數']) === roundNumber);
        const now = nowTaipei();
        let createdRound = false;
        if (!row) {
          row = {
            '案件編號': caseId,
            '修改次數': String(roundNumber),
            '建立日期': now,
            '修改日期': roundNumber === 0 ? now : '',
            '修改內容': roundNumber === 0 ? (serviceAuthorized ? '初稿完成（NAS 自動建立）' : '初稿完成') : '',
            '修改人': serviceAuthorized ? 'NAS 自動同步' : text(session?.user || '系統'),
            // 第 0 輪（初稿）本身就代表「已完成」，不是一筆待處理的修改請求，
            // 直接標記確認修正日，避免被現有的「待確認修改」通知邏輯誤判成
            // 一筆還沒處理的修改需求。真正的修改請求（第 1 輪以後）維持空白，
            // 走原本「設計師確認修正完成」才寫入的流程。
            '確認修正日': roundNumber === 0 ? now : ''
          };
          rows.push(row);
          createdRound = true;
        }
        const existing = parseCaseDesignImages_(row);
        const seenUrls = new Set<string>();
        const merged: { fileName: string; url: string }[] = [];
        for (const item of [...existing, ...images]) {
          if (seenUrls.has(item.url)) continue;
          seenUrls.add(item.url);
          merged.push(item);
        }
        row['圖片連結'] = JSON.stringify(merged);
        row['圖片來源'] = source;
        row['圖片更新時間'] = now;
        if (createdRound) recalculateDatabaseModificationCounts(draft);
        return { result: { ok: true, action, caseId, round: roundNumber, images: merged, record: row }, changedTables: createdRound ? ['修改統計表', 'database'] : ['修改統計表'] };
      });
    }
    if (action === 'removeCaseDesignImage') {
      const current = this.requireAccess(database, session, 'media.manage');
      const caseId = text(payload.caseId || payload.id || payload['案件編號']);
      const roundNumber = Math.trunc(Number(payload.round ?? payload['修改次數']));
      const url = text(payload.url);
      if (!caseId) throw new Error('缺少案件編號');
      if (!Number.isFinite(roundNumber) || roundNumber < 0) throw new Error('缺少修改輪次（0=初稿）');
      if (!url) throw new Error('缺少要刪除的圖片網址');
      return this.mutate(action, current, draft => {
        const row = draft.tables['修改統計表'].rows.find(item => text(item['案件編號']) === caseId && Number(item['修改次數']) === roundNumber);
        if (!row) throw new Error('找不到指定的修改紀錄');
        const existing = parseCaseDesignImages_(row);
        const filtered = existing.filter(item => item.url !== url);
        if (filtered.length === existing.length) throw new Error('找不到該張圖片');
        row['圖片連結'] = JSON.stringify(filtered);
        row['圖片更新時間'] = nowTaipei();
        return { result: { ok: true, action, caseId, round: roundNumber, images: filtered, record: row }, changedTables: ['修改統計表'] };
      });
    }
    if (action === 'createFlatProject') return this.createProject(payload, database, session);
    if (['append', 'create', 'add', 'submit', 'save'].includes(action)) return this.addRequests(action, payload, database, session, baseUrl, false);
    if (['batchAdd', 'batchAppend', 'addRows'].includes(action)) return this.addRequests(action, payload, database, session, baseUrl, true);
    if (action === 'update' || action === 'batchUpdate') return this.updateRequests(action, payload, database, session, baseUrl);
    if (action === 'delete') {
      const id = text(payload.id || payload.caseId);
      const existingRow = database.tables.database.rows.find(row => text(row['案件編號']) === id);
      const current = payload.accessContext === 'archive'
        ? this.requireAccess(database, session, 'archive.edit')
        : this.requireRowAccess(database, session, 'request.delete', existingRow);
      return this.mutate(action, current, draft => {
        const index = draft.tables.database.rows.findIndex(row => text(row['案件編號']) === id);
        if (index < 0) throw new Error('找不到案件');
        const [row] = draft.tables.database.rows.splice(index, 1);
        return { result: { ok: true, action, id, row: toApiRow(row) }, changedTables: ['database'] };
      });
    }
    if (action === 'adminAccountSave') return this.adminAccountSave(payload, database, session);
    if (action === 'adminAccountDelete') return this.adminAccountDelete(payload, database, session);
    if (action === 'adminDesignerSave') return this.adminDesignerSave(payload, database, session);
    if (action === 'adminDesignerRemove') return this.adminDesignerRemove(payload, database, session);
    if (action === 'adminOrganizationOptionSave') return this.adminOrganizationOptionSave(payload, database, session);
    if (action === 'adminOrganizationOptionDelete') return this.adminOrganizationOptionDelete(payload, database, session);
    if (['adminTableUpdate', 'adminTableDelete', 'adminTableInsert'].includes(action)) return this.adminMutation(action, payload, database, session);
    if (action === 'detailOptions' || action === 'options') return { ok: true, action, types: [], stages: [], details: {} };
    if (['uploadDesignerImage', 'uploadUserAvatar', 'deleteDesignerMedia', 'listDesignerMedia'].includes(action)) return { ok: false, action, error: '圖片檔案仍由獨立上傳服務處理，請從系統圖片視窗操作' };
    return { ok: false, action, error: 'Unknown action' };
  }

  private async addRequests(action: string, payload: ApiPayload, database: DatabaseSnapshot, session: SessionRecord | null, baseUrl: string, batch: boolean): Promise<ApiResult> {
    if (session) this.requireAccess(database, session, 'request.create');
    const sources = batch ? asRows(payload.rows || payload.data) : [asRow(payload.row || payload.data || payload)];
    if (!sources.length) throw new Error('沒有可新增的資料');
    const requestId = text(payload.requestId);
    return this.mutate(action, session, draft => {
      if (requestId && draft.internal.idempotency[requestId]) return { result: { ...draft.internal.idempotency[requestId], ok: true, deduplicated: true }, changed: false };
      const created: Row[] = [], rowNumbers: number[] = [];
      for (const source of sources) {
        const row = toSheetRow(source, {}, weightRules(draft));
        row['案件編號'] ||= nextCaseId(draft.tables.database.rows);
        row['填單時間'] ||= nowTaipei().slice(0, 10).replace(/\//g, '-');
        row['月份'] ||= monthFromDate(row['開始日期']);
        syncSupplementLinks(draft, row, baseUrl);
        draft.tables.database.rows.push(row);
        rowNumbers.push(draft.tables.database.rows.length + 1);
        created.push(toApiRow(row, draft.tables.database.rows.length - 1));
      }
      const result: ApiResult = batch
        ? { ok: true, action: 'batchAdd', count: created.length, rowNumbers, rows: created }
        : { ok: true, action: 'append', rowNumber: rowNumbers[0], row: created[0] };
      if (requestId) draft.internal.idempotency[requestId] = { ...result };
      return { result, changedTables: ['database', '補充資料連結'] };
    });
  }

  private async updateRequests(action: string, payload: ApiPayload, database: DatabaseSnapshot, session: SessionRecord | null, baseUrl: string): Promise<ApiResult> {
    const changes = asRow(payload.row || payload.changes || payload);
    const writeHeaders = [...(Array.isArray(payload.writeHeaders) ? payload.writeHeaders.map(text) : []), ...(Array.isArray(payload.forceHeaders) ? payload.forceHeaders.map(text) : [])];
    const touchesProtected = writeHeaders.some(header => ['案件狀態', '狀態', '項目細節'].includes(header)) || ['status', 'details'].some(key => changes[key] !== undefined);
    if (touchesProtected && !session && text(changes.status || changes['狀態'] || changes['案件狀態']) !== '已取消') throw new Error('請先登入後再修改狀態或項目細節');
    const changedKeys = Object.keys(changes).filter(key => key !== 'id');
    // 「設計圖資料夾連結」與「設計圖檔名關鍵字」是同一組操作（設計師在 NAS 資料夾選擇器
    // 裡一起填），一起寫入時一樣只需要 media.manage、不需要完整的 request.edit——理由跟
    // 只改資料夾連結時一致：這兩個欄位不影響案件的其他業務欄位，只是控制自動追蹤設計圖
    // 的來源與篩選條件。只要這次送出的欄位/表頭完全落在這兩者範圍內，就套用這個放寬。
    const DESIGN_IMAGE_FOLDER_KEYS = ['designImageFolderUrl', 'designImageFolderKeyword'];
    const DESIGN_IMAGE_FOLDER_HEADERS = ['設計圖資料夾連結', '設計圖檔名關鍵字'];
    const onlyDesignImageFolderLink = !touchesProtected && changedKeys.length > 0 && changedKeys.every(key => DESIGN_IMAGE_FOLDER_KEYS.includes(key))
      && writeHeaders.every(header => DESIGN_IMAGE_FOLDER_HEADERS.includes(header));
    if (session) {
      const capability = payload.accessContext === 'archive' ? 'archive.edit'
        : touchesProtected ? 'request.status' : onlyDesignImageFolderLink ? 'media.manage' : 'request.edit';
      // 單筆更新且落在預設的 request.edit 分支時，額外接受「客戶別專案負責人編輯自己案件」這條路徑
      // （見 requireRowAccess／model.ts 的 hasRowCapability）；batchUpdate 與其餘分支維持原本的角色權限判斷，不擴大範圍。
      if (action === 'update' && capability === 'request.edit') {
        const id = text(payload.id || payload.caseId || changes.id);
        const existingRow = database.tables.database.rows.find(row => text(row['案件編號']) === id);
        this.requireRowAccess(database, session, capability, existingRow);
      } else {
        this.requireAccess(database, session, capability);
      }
    }
    const items = action === 'batchUpdate' ? asRows(payload.rows) : [{ id: payload.id || payload.caseId || changes.id, row: changes }];
    return this.mutate(action, session, draft => {
      const updated: Row[] = [];
      for (const item of items) {
        const id = text(item.id || item.caseId || asRow(item.row).id || changes.id);
        const index = draft.tables.database.rows.findIndex(row => text(row['案件編號']) === id);
        if (index < 0) throw new Error(`找不到案件：${id}`);
        const previous = draft.tables.database.rows[index];
        const patch = { ...(action === 'batchUpdate' ? changes : {}), ...asRow(item.row || item.changes) };
        const row = toSheetRow(patch, previous, weightRules(draft));
        row['案件編號'] = id;
        syncSupplementLinks(draft, row, baseUrl);
        draft.tables.database.rows[index] = row;
        updated.push(toApiRow(row, index));
      }
      const result: ApiResult = action === 'batchUpdate'
        ? { ok: true, action, count: updated.length, rows: updated, updated: writeHeaders }
        : { ok: true, action, id: updated[0].id, row: updated[0], updated: writeHeaders };
      return { result, changedTables: ['database', '補充資料連結'] };
    });
  }

  private async createProject(payload: ApiPayload, database: DatabaseSnapshot, session: SessionRecord | null): Promise<ApiResult> {
    const current = this.requireAccess(database, session, 'project.create');
    const source = asRow(payload.row || payload.data);
    const expected = text(source.expectedDesigner || source['預計設計師']);
    const groupEntry = ['平面', '影音'].map(group => [group, { designers: designerRowsForGroup(database, group).map(row => text(row['名字'])), type: group }] as const).find(([, config]) => config.designers.includes(expected));
    if (!groupEntry) throw new Error('預計設計師必須為平面組或影音組輪值名單');
    const [projectKind, config] = groupEntry;
    const replacement = text(source.replacement || source['替換(選填)']);
    const designer = replacement && replacement !== expected ? replacement : expected;
    if (!config.designers.includes(designer)) throw new Error('替換設計師不在同一輪值組別');
    if (designer !== expected && !text(source.reason || source['調整原因(選填)'])) throw new Error('有替換設計師時，請填寫調整原因');
    return this.mutate('createFlatProject', current, draft => {
      const projectRow: Row = {
        '客戶別': text(source.client || source['客戶別']), '專案名稱': text(source.project || source['專案名稱']),
        '專案負責人': text(source.owner || source['專案負責人']), '專案類型': text(source.projectType || source['專案類型']),
        '數量': text(source.qty || source['數量']), '開始時間': text(source.start || source['開始時間']),
        '結束時間': text(source.end || source['結束時間']), '預計設計師': expected,
        '替換(選填)': designer !== expected ? designer : '', '調整原因(選填)': designer !== expected ? text(source.reason || source['調整原因(選填)']) : ''
      };
      for (const header of ['客戶別', '專案名稱', '專案負責人', '專案類型', '數量', '開始時間', '結束時間', '預計設計師']) if (!text(projectRow[header])) throw new Error(`請填寫「${header}」`);
      const projectTable = draft.tables[`${projectKind}新開專案`];
      if (!projectTable) throw new Error(`JSON 資料庫缺少「${projectKind}新開專案」資料表`);
      projectTable.rows.push(projectRow);
      const row = toSheetRow({
        client: source.client, project: source.project, owner: source.owner, type: config.type,
        stage: projectKind === '影音' && text(source.projectType).includes('拍攝') ? '拍攝' : '後製',
        qty: source.qty, start: source.start, end: source.end, designer, status: '未開始'
      }, {}, weightRules(draft));
      for (const header of ['客戶別', '專案名稱', '專案負責人', '數量', '開始日期', '結束日期']) if (!text(row[header])) throw new Error(`請填寫「${header}」`);
      row['案件編號'] = nextCaseId(draft.tables.database.rows);
      row['填單時間'] = nowTaipei().slice(0, 10).replace(/\//g, '-');
      row['月份'] = monthFromDate(row['開始日期']);
      draft.tables.database.rows.push(row);
      const settingsRows = draft.tables['設定'].rows;
      const ranked = config.designers.map((name, index) => ({ name, settings: settingsRows.find(item => text(item['名字']) === name), rotation: Number(settingsRows.find(item => text(item['名字']) === name)?.['新專案輪值']) || index + 1 })).sort((a, b) => a.rotation - b.rotation || config.designers.indexOf(a.name) - config.designers.indexOf(b.name));
      const consumedIndex = ranked.findIndex(item => item.name === designer);
      const reordered = [...ranked.slice(0, consumedIndex), ...ranked.slice(consumedIndex + 1), ranked[consumedIndex]];
      reordered.forEach((item, index) => { if (item.settings) item.settings['新專案輪值'] = String(index + 1); });
      return {
        result: { ok: true, action: 'createFlatProject', projectKind, rowNumber: projectTable.rows.length + 1, row: projectRow, databaseRowNumber: draft.tables.database.rows.length + 1, databaseRow: toApiRow(row, draft.tables.database.rows.length - 1), user: current.user },
        changedTables: [`${projectKind}新開專案`, 'database', '設定']
      };
    });
  }

  private async adminAccountSave(payload: ApiPayload, database: DatabaseSnapshot, session: SessionRecord | null): Promise<ApiResult> {
    const current = this.requireAccess(database, session, 'database.manage');
    const requestedSettings = asRow(payload.settingsRow || payload.settings);
    const requestedPermission = asRow(payload.permissionRow || payload.permission);
    const expectedSettings = asRow(payload.expectedSettingsRow);
    const expectedPermission = asRow(payload.expectedPermissionRow);
    const loginMethod = text(requestedPermission['登入方式']) || '公司信箱';
    if (!['公司信箱', '密碼'].includes(loginMethod)) throw new Error('登入方式格式不正確');
    const requestedAccount = text(payload.account || requestedSettings['帳號'] || requestedPermission['帳號']);
    const account = canonicalAccount(requestedAccount || (loginMethod === '密碼' ? `local:${crypto.randomUUID()}` : ''));
    if (loginMethod === '公司信箱' && (!account || !account.endsWith('@emctaipei.com'))) throw new Error('帳號必須使用 @emctaipei.com 公司信箱');
    if (loginMethod === '密碼' && !account) throw new Error('無法建立密碼登入帳號');
    const loginPassword = text(payload.loginPassword);
    if (loginPassword && (loginPassword.length < 4 || loginPassword.length > 128)) throw new Error('登入密碼長度必須是 4–128 個字');
    if (loginPassword && isReservedShortcutPassword(loginPassword)) throw new Error('這組密碼與內建測試密碼保留格式重複，請改用其他密碼');
    if (loginPassword && await secureEqual(loginPassword, this.env.ADMIN_LOGIN_PASSWORD)) throw new Error('這組密碼與系統管理者密碼重複，請改用其他密碼');

    const existingPrivateHash = this.localPasswordHash(account);
    let preparedHash = existingPrivateHash;
    if (loginMethod === '密碼') {
      const legacyPermission = database.tables['帳號權限'].rows.find(row => canonicalAccount(row['帳號']) === account);
      preparedHash ||= text(legacyPermission?.['密碼雜湊']);
      if (!loginPassword && !preparedHash) throw new Error('這個帳號尚未設定登入密碼，請輸入新密碼');
      if (loginPassword) {
        for (const other of database.tables['帳號權限'].rows) {
          const otherAccount = canonicalAccount(other['帳號']);
          if (!otherAccount || otherAccount === account) continue;
          const otherHash = this.localPasswordHash(otherAccount) || text(other['密碼雜湊']);
          if (otherHash && await verifyLocalPassword(loginPassword, otherHash)) throw new Error('這組登入密碼已由其他帳號使用，請改用不同密碼');
        }
        preparedHash = await hashLocalPassword(loginPassword);
      }
    }

    const result = await this.mutate('adminAccountSave', current, draft => {
      const settingsTable = draft.tables['設定'];
      const permissionTable = draft.tables['帳號權限'];
      let settingsIndex = settingsTable.rows.findIndex(row => canonicalAccount(row['帳號']) === account);
      let permissionIndex = permissionTable.rows.findIndex(row => canonicalAccount(row['帳號']) === account);

      if (Object.keys(expectedSettings).length) {
        if (settingsIndex < 0 || rowsDiffer(settingsTable.headers, expectedSettings, settingsTable.rows[settingsIndex])) throw new Error('個人設定已被其他人更新，請重新讀取後再操作');
      } else if (payload.expectSettingsMissing === true && settingsIndex >= 0) throw new Error('這個帳號已經存在，請重新讀取後再操作');
      if (Object.keys(expectedPermission).length) {
        if (permissionIndex < 0 || rowsDiffer(permissionTable.headers, expectedPermission, permissionTable.rows[permissionIndex])) throw new Error('帳號權限已被其他人更新，請重新讀取後再操作');
      } else if (payload.expectPermissionMissing === true && permissionIndex >= 0) throw new Error('帳號權限已被其他人建立，請重新讀取後再操作');

      const settings = normalizedTableRow(settingsTable.headers, requestedSettings);
      settings['帳號'] = account;
      if (!text(settings['名字'])) throw new Error('請填寫帳號姓名');
      if (text(settings['名字']).length > 60 || text(settings['顯示名']).length > 60) throw new Error('姓名與顯示名不得超過 60 個字');
      settings['顯示名'] ||= settings['名字'];
      for (const header of ['頭像連結', '頭像大圖連結', '分享音樂']) {
        if (text(settings[header]) && !isHttpUrl(settings[header])) throw new Error(`「${header}」必須是 http 或 https 網址`);
      }
      if (text(settings['音樂起始秒數'])) settings['音樂起始秒數'] = String(Math.max(0, Math.floor(Number(settings['音樂起始秒數']) || 0)));
      if (text(settings['新專案輪值'])) {
        const rotation = Number(settings['新專案輪值']);
        if (!Number.isInteger(rotation) || rotation < 1 || rotation > 99) throw new Error('新專案輪值必須是 1–99 的整數');
        settings['新專案輪值'] = String(rotation);
      }
      settings['技能'] = splitNames(settings['技能']).join(' , ');
      if (text(settings['對話框']).length > 120) throw new Error('對話框不得超過 120 個字');
      if (text(settings['深淺模式']) && !['淺色', '深色'].includes(text(settings['深淺模式']))) throw new Error('深淺模式格式不正確');

      const permission = normalizedTableRow(permissionTable.headers, requestedPermission);
      permission['帳號'] = account;
      permission['登入方式'] = loginMethod;
      const roles = ['管理者', '設計師', '一般使用者', '唯讀', '自訂'];
      if (!roles.includes(text(permission['角色範本']))) throw new Error('角色範本格式不正確');
      if (!['啟用', '停用'].includes(text(permission['狀態']))) throw new Error('帳號狀態格式不正確');
      const manager = permission['角色範本'] === '管理者';
      permission['頁面權限'] = JSON.stringify(manager ? ACCESS_PAGES : normalizedAccessList(permission['頁面權限'], ACCESS_PAGES));
      permission['功能權限'] = JSON.stringify(manager ? ACCESS_CAPABILITIES : normalizedAccessList(permission['功能權限'], ACCESS_CAPABILITIES));
      permission['更新時間'] ||= nowTaipei();
      permission['更新者'] ||= current.user || current.account;

      const settingsChanged = settingsIndex < 0 || rowsDiffer(settingsTable.headers, settingsTable.rows[settingsIndex], settings);
      const permissionChanged = permissionIndex < 0 || rowsDiffer(permissionTable.headers, permissionTable.rows[permissionIndex], permission);
      if (settingsIndex < 0) { settingsTable.rows.push(settings); settingsIndex = settingsTable.rows.length - 1; }
      else if (settingsChanged) settingsTable.rows[settingsIndex] = settings;
      if (permissionIndex < 0) { permissionTable.rows.push(permission); permissionIndex = permissionTable.rows.length - 1; }
      else if (permissionChanged) permissionTable.rows[permissionIndex] = permission;

      return {
        result: {
          ok: true,
          action: 'adminAccountSave',
          account,
          settingsRow: { _rowNumber: settingsIndex + 2, ...settings },
          permissionRow: { _rowNumber: permissionIndex + 2, ...permission, _credentialConfigured: loginMethod === '密碼' }
        },
        changed: settingsChanged || permissionChanged,
        changedTables: [settingsChanged ? '設定' : '', permissionChanged ? '帳號權限' : ''].filter(Boolean)
      };
    });
    if (loginMethod === '密碼' && preparedHash) this.setLocalPasswordHash(account, preparedHash);
    else if (loginMethod !== '密碼') this.ctx.storage.sql.exec('DELETE FROM local_password_accounts WHERE account = ?', account);
    return result;
  }

  private async adminAccountDelete(payload: ApiPayload, database: DatabaseSnapshot, session: SessionRecord | null): Promise<ApiResult> {
    const current = this.requireAccess(database, session, 'database.manage');
    const account = canonicalAccount(payload.account);
    if (!account) throw new Error('缺少要刪除的帳號');
    if (account === canonicalAccount(current.account)) throw new Error('不可刪除目前登入中的管理帳號');
    if (account === SHORTCUT_ADMIN_ACCOUNT) throw new Error('系統管理者帳號不可刪除');
    const permission = database.tables['帳號權限'].rows.find(row => canonicalAccount(row['帳號']) === account);
    if (text(permission?.['角色範本']) === '管理者') throw new Error('管理者帳號不可直接刪除，請先調整角色');
    const expectedSettings = asRow(payload.expectedSettingsRow);
    const expectedPermission = asRow(payload.expectedPermissionRow);
    const result = await this.mutate('adminAccountDelete', current, draft => {
      const settingsTable = draft.tables['設定'];
      const permissionTable = draft.tables['帳號權限'];
      const settingsIndex = settingsTable.rows.findIndex(row => canonicalAccount(row['帳號']) === account);
      const permissionIndex = permissionTable.rows.findIndex(row => canonicalAccount(row['帳號']) === account);
      if (settingsIndex < 0 && permissionIndex < 0) throw new Error('找不到要刪除的帳號');
      if (Object.keys(expectedSettings).length && (settingsIndex < 0 || rowsDiffer(settingsTable.headers, expectedSettings, settingsTable.rows[settingsIndex]))) throw new Error('個人設定已被其他人更新，請重新讀取後再操作');
      if (Object.keys(expectedPermission).length && (permissionIndex < 0 || rowsDiffer(permissionTable.headers, expectedPermission, permissionTable.rows[permissionIndex]))) throw new Error('帳號權限已被其他人更新，請重新讀取後再操作');
      const names = new Set<string>();
      if (settingsIndex >= 0) names.add(text(settingsTable.rows[settingsIndex]['名字']));
      if (settingsIndex >= 0) settingsTable.rows.splice(settingsIndex, 1);
      if (permissionIndex >= 0) permissionTable.rows.splice(permissionIndex, 1);
      const reelsBefore = draft.tables.reels.rows.length;
      draft.tables.reels.rows = draft.tables.reels.rows.filter(row => !names.has(text(row['名字'])));
      const deletedReels = reelsBefore - draft.tables.reels.rows.length;
      return {
        result: { ok: true, action: 'adminAccountDelete', account, deletedReels },
        changedTables: ['設定', '帳號權限', ...(deletedReels ? ['reels'] : [])]
      };
    });
    this.deleteAccountPrivateState(account);
    return result;
  }

  private async adminDesignerSave(payload: ApiPayload, database: DatabaseSnapshot, session: SessionRecord | null): Promise<ApiResult> {
    const current = this.requireAccess(database, session, 'database.manage');
    const account = canonicalAccount(payload.account);
    const profile = asRow(payload.profile || payload.settings);
    const expected = asRow(payload.expectedSettingsRow);
    const group = text(profile.group || profile.designType || profile['組別']);
    if (!account) throw new Error('請選擇設計師帳號');
    if (!['平面', '影音'].includes(group)) throw new Error('設計師組別必須是平面或影音');
    const mappings = normalizedSkillMappings(profile.skillMappings || profile['技能表單設定']);
    if (!mappings.length) mappings.push({ name: '平面', type: '平面', stage: '後製' });
    if (mappings.some(item => item.name.length > 40 || item.type.length > 40 || item.stage.length > 40)) throw new Error('技能、設計種類與階段不得超過 40 個字');
    for (const [key, label] of [['avatar', '頭像連結'], ['poster', '頭像大圖連結'], ['musicUrl', '分享音樂']] as const) {
      if (text(profile[key]) && !isHttpUrl(profile[key])) throw new Error(`「${label}」必須是 http 或 https 網址`);
    }
    if (text(profile.quote).length > 120) throw new Error('對話框不得超過 120 個字');
    return this.mutate('adminDesignerSave', current, draft => {
      const table = draft.tables['設定'];
      const row = table.rows.find(item => canonicalAccount(item['帳號']) === account);
      if (!row) throw new Error('找不到此帳號；請先在帳號設定建立帳號');
      if (Object.keys(expected).length && rowsDiffer(table.headers, expected, row)) throw new Error('設計師資料已被其他人更新，請重新讀取後再操作');
      row['組別'] = group;
      row['設計師顯示'] = 'v';
      row['頭像連結'] = text(profile.avatar);
      row['頭像大圖連結'] = text(profile.poster);
      row['分享音樂'] = text(profile.musicUrl);
      row['音樂起始秒數'] = String(Math.max(0, Math.floor(Number(profile.musicStartAt) || 0)));
      row['技能'] = mappings.map(item => item.name).join(' , ');
      row['技能表單設定'] = JSON.stringify(mappings);
      row['對話框'] = text(profile.quote);
      if ('replyTemplates' in profile) row['回信範本設定'] = JSON.stringify(normalizedReplyTemplates(profile.replyTemplates));
      row['新專案輪值'] = String(Math.max(1, Math.floor(Number(profile.rotation) || 99)));
      designerRowsForGroup(draft, group).forEach((item, index) => { item['新專案輪值'] = String(index + 1); });
      return {
        result: { ok: true, action: 'adminDesignerSave', account, settingsRow: { ...row }, changedTables: ['設定'] },
        changedTables: ['設定']
      };
    });
  }

  private async adminDesignerRemove(payload: ApiPayload, database: DatabaseSnapshot, session: SessionRecord | null): Promise<ApiResult> {
    const current = this.requireAccess(database, session, 'database.manage');
    const account = canonicalAccount(payload.account);
    const expected = asRow(payload.expectedSettingsRow);
    if (!account) throw new Error('缺少要移除的設計師帳號');
    return this.mutate('adminDesignerRemove', current, draft => {
      const table = draft.tables['設定'];
      const row = table.rows.find(item => canonicalAccount(item['帳號']) === account);
      if (!row || !isDesignerSettingsRow(row)) throw new Error('找不到啟用中的設計師');
      if (Object.keys(expected).length && rowsDiffer(table.headers, expected, row)) throw new Error('設計師資料已被其他人更新，請重新讀取後再操作');
      const group = text(row['組別']);
      row['設計師顯示'] = 'x';
      row['新專案輪值'] = '';
      designerRowsForGroup(draft, group).forEach((item, index) => { item['新專案輪值'] = String(index + 1); });
      return {
        result: { ok: true, action: 'adminDesignerRemove', account, name: text(row['名字']), changedTables: ['設定'] },
        changedTables: ['設定']
      };
    });
  }

  private organizationKind(value: unknown): '部門' | '組別' {
    const kind = text(value);
    if (kind !== '部門' && kind !== '組別') throw new Error('組織選項種類格式不正確');
    return kind;
  }

  private async adminOrganizationOptionSave(payload: ApiPayload, database: DatabaseSnapshot, session: SessionRecord | null): Promise<ApiResult> {
    const current = this.requireAccess(database, session, 'database.manage');
    const kind = this.organizationKind(payload.kind || payload['種類']);
    const oldName = text(payload.oldName);
    const name = text(payload.name || payload['名稱']);
    if (!name) throw new Error(`請輸入${kind}名稱`);
    if (name.length > 40) throw new Error(`${kind}名稱不得超過 40 個字`);
    return this.mutate('adminOrganizationOptionSave', current, draft => {
      const options = draft.tables['組織選項'];
      const duplicate = options.rows.find(row => text(row['種類']) === kind && text(row['名稱']) === name && text(row['名稱']) !== oldName);
      if (duplicate) throw new Error(`這個${kind}名稱已經存在`);
      let option = options.rows.find(row => text(row['種類']) === kind && text(row['名稱']) === oldName);
      if (!option) {
        option = Object.fromEntries(options.headers.map(header => [header, ''])) as Row;
        option['代碼'] = `${kind}:${crypto.randomUUID()}`;
        option['種類'] = kind;
        option['排序'] = String(options.rows.filter(row => text(row['種類']) === kind).length + 1);
        options.rows.push(option);
      }
      option['名稱'] = name;
      let affectedAccounts = 0;
      if (oldName && oldName !== name) {
        for (const row of draft.tables['設定'].rows) {
          if (text(row[kind]) === oldName) { row[kind] = name; affectedAccounts += 1; }
        }
      }
      return { result: { ok: true, action: 'adminOrganizationOptionSave', kind, oldName, name, affectedAccounts, option }, changedTables: ['組織選項', ...(affectedAccounts ? ['設定'] : [])] };
    });
  }

  private async adminOrganizationOptionDelete(payload: ApiPayload, database: DatabaseSnapshot, session: SessionRecord | null): Promise<ApiResult> {
    const current = this.requireAccess(database, session, 'database.manage');
    const kind = this.organizationKind(payload.kind || payload['種類']);
    const name = text(payload.name || payload['名稱']);
    if (!name) throw new Error(`缺少要刪除的${kind}名稱`);
    return this.mutate('adminOrganizationOptionDelete', current, draft => {
      const options = draft.tables['組織選項'];
      const before = options.rows.length;
      options.rows = options.rows.filter(row => !(text(row['種類']) === kind && text(row['名稱']) === name));
      let affectedAccounts = 0;
      for (const row of draft.tables['設定'].rows) {
        if (text(row[kind]) === name) { row[kind] = ''; affectedAccounts += 1; }
      }
      if (before === options.rows.length && !affectedAccounts) throw new Error(`找不到這個${kind}名稱`);
      return { result: { ok: true, action: 'adminOrganizationOptionDelete', kind, name, affectedAccounts }, changedTables: ['組織選項', ...(affectedAccounts ? ['設定'] : [])] };
    });
  }

  private async adminMutation(action: string, payload: ApiPayload, database: DatabaseSnapshot, session: SessionRecord | null): Promise<ApiResult> {
    const current = this.requireAccess(database, session, 'database.manage');
    const tableName = text(payload.table);
    const table = database.tables[tableName];
    if (!table || !ADMIN_TABLE_ORDER.includes(tableName)) throw new Error(`未知資料表：${tableName}`);
    if (action === 'adminTableInsert' && tableName === 'database') throw new Error('請使用「填寫設計需求」表單新增案件');
    const incoming = asRow(payload.row);
    const expected = asRow(payload.expectedRow);
    return this.mutate(action, current, draft => {
      const target = draft.tables[tableName];
      const primaryKey = target.primaryKey;
      let index = -1;
      if (action !== 'adminTableInsert') {
        if (primaryKey) {
          const key = text(expected[primaryKey] || incoming[primaryKey] || payload.key);
          index = target.rows.findIndex(row => text(row[primaryKey]) === key);
        } else index = Number(payload.rowNumber || expected._rowNumber || payload.key) - 2;
        if (!Number.isInteger(index) || index < 0 || index >= target.rows.length) throw new Error(`找不到要${action === 'adminTableDelete' ? '刪除' : '編輯'}的資料`);
        if (Object.keys(expected).length) {
          const currentRow = target.rows[index];
          const changed = target.headers.some(header => text(expected[header]) !== text(currentRow[header]));
          if (changed) throw new Error('資料已被其他人更新，請重新讀取後再操作');
        }
      }
      if (action === 'adminTableDelete') {
        const [deleted] = target.rows.splice(index, 1);
        if (tableName === '加權計分標準') recalculateDatabaseWeights(draft);
        if (tableName === '修改統計表') recalculateDatabaseModificationCounts(draft);
        const syncsDatabase = tableName === '加權計分標準' || tableName === '修改統計表';
        return { result: { ok: true, action, table: tableName, rowNumber: index + 2, deleted: { _rowNumber: index + 2, ...deleted } }, changedTables: syncsDatabase ? [tableName, 'database'] : [tableName] };
      }
      const normalized = Object.fromEntries(target.headers.map(header => [header, text(incoming[header])])) as Row;
      if (primaryKey && !text(normalized[primaryKey])) throw new Error(`「${primaryKey}」不得空白`);
      if (primaryKey) {
        const duplicate = target.rows.findIndex((row, rowIndex) => rowIndex !== index && text(row[primaryKey]) === text(normalized[primaryKey]));
        if (duplicate >= 0) throw new Error(`「${primaryKey}」不可重複`);
      }
      if (action === 'adminTableInsert') {
        target.rows.push(normalized);
        index = target.rows.length - 1;
      } else {
        const unchanged = target.headers.every(header => text(target.rows[index][header]) === text(normalized[header]));
        if (unchanged) return { result: { ok: true, action, table: tableName, rowNumber: index + 2, row: { _rowNumber: index + 2, ...normalized } }, changed: false };
        target.rows[index] = normalized;
      }
      if (tableName === '加權計分標準') recalculateDatabaseWeights(draft);
      if (tableName === '修改統計表') recalculateDatabaseModificationCounts(draft);
      const syncsDatabase = tableName === '加權計分標準' || tableName === '修改統計表';
      return { result: { ok: true, action, table: tableName, rowNumber: index + 2, row: { _rowNumber: index + 2, ...normalized } }, changedTables: syncsDatabase ? [tableName, 'database'] : [tableName] };
    });
  }
}

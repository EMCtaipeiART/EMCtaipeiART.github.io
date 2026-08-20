import type { ApiPayload, ApiResult, RequestContext } from './types';
import { DatabaseCoordinator } from './database-coordinator';
import { text } from './model';

export { DatabaseCoordinator };

const MAX_REQUEST_BYTES = 2 * 1024 * 1024;

function allowedOrigins(env: Env): Set<string> {
  return new Set(env.ALLOWED_ORIGINS.split(',').map(value => value.trim()).filter(Boolean));
}

function corsHeaders(request: Request, env: Env): Headers {
  const headers = new Headers({
    'Cache-Control': 'no-store',
    'Content-Type': 'application/json; charset=utf-8',
    'Referrer-Policy': 'no-referrer',
    'X-Content-Type-Options': 'nosniff',
    'X-Frame-Options': 'DENY'
  });
  const origin = text(request.headers.get('Origin'));
  if (origin && allowedOrigins(env).has(origin)) headers.set('Access-Control-Allow-Origin', origin);
  headers.set('Vary', 'Origin');
  return headers;
}

function jsonResponse(request: Request, env: Env, body: ApiResult | Record<string, unknown>, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: corsHeaders(request, env) });
}

async function readBody(request: Request): Promise<ApiPayload> {
  const declared = Number(request.headers.get('Content-Length')) || 0;
  if (declared > MAX_REQUEST_BYTES) throw new Error('請求內容過大');
  if (!request.body) return {};
  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > MAX_REQUEST_BYTES) {
      await reader.cancel();
      throw new Error('請求內容過大');
    }
    chunks.push(value);
  }
  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
  const raw = new TextDecoder().decode(bytes).trim();
  if (!raw) return {};
  try {
    const value = JSON.parse(raw);
    if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('invalid');
    return value as ApiPayload;
  } catch { throw new Error('JSON 格式錯誤'); }
}

function contextFor(request: Request): RequestContext {
  const url = new URL(request.url);
  return {
    baseUrl: `${url.protocol}//${url.host}`,
    origin: text(request.headers.get('Origin')),
    ip: text(request.headers.get('CF-Connecting-IP')) || 'unknown',
    userAgent: text(request.headers.get('User-Agent'))
  };
}

function tokenFrom(request: Request): string {
  return text(request.headers.get('Authorization')).replace(/^Bearer\s+/i, '');
}

function queryPayload(url: URL): ApiPayload {
  return Object.fromEntries(url.searchParams.entries());
}

async function dispatchAction(request: Request, env: Env, action: string, payload: ApiPayload): Promise<ApiResult> {
  const token = tokenFrom(request);
  if (token && !payload.editorToken && !payload.token) payload.editorToken = token;
  const stub = env.DATABASE_COORDINATOR.getByName('primary', { locationHint: 'apac' }) as DurableObjectStub<DatabaseCoordinator>;
  return stub.handle(action, payload, contextFor(request));
}

async function handleApi(request: Request, env: Env): Promise<Response> {
  const url = new URL(request.url);
  const path = url.pathname.replace(/\/+$/, '') || '/';
  const query = queryPayload(url);
  const body = request.method === 'POST' || request.method === 'PATCH' || request.method === 'DELETE' ? await readBody(request) : {};
  const payload = { ...query, ...body };

  if (path === '/api' || path === '/') {
    const action = text(payload.action || 'ping');
    return jsonResponse(request, env, await dispatchAction(request, env, action, payload));
  }

  if (path === '/api/tables') {
    if (request.method !== 'GET') return jsonResponse(request, env, { ok: false, error: 'Method Not Allowed' }, 405);
    return jsonResponse(request, env, await dispatchAction(request, env, 'adminTables', payload));
  }

  const tableMatch = path.match(/^\/api\/table\/([^/]+)(?:\/([^/]+))?$/);
  if (tableMatch) {
    const table = decodeURIComponent(tableMatch[1]);
    const key = tableMatch[2] ? decodeURIComponent(tableMatch[2]) : '';
    if (request.method === 'GET') return jsonResponse(request, env, await dispatchAction(request, env, 'adminTableRows', { ...payload, table }));
    if (request.method === 'POST') return jsonResponse(request, env, await dispatchAction(request, env, 'adminTableInsert', { ...payload, table, row: payload.row || payload }));
    if (request.method === 'PATCH') return jsonResponse(request, env, await dispatchAction(request, env, 'adminTableUpdate', { ...payload, table, key, row: payload.row || payload }));
    if (request.method === 'DELETE') return jsonResponse(request, env, await dispatchAction(request, env, 'adminTableDelete', { ...payload, table, key }));
  }

  const supplementMatch = path.match(/^\/([a-d])\/(\d{8})$/i);
  const shortMatch = path.match(/^\/([23456789A-HJ-NP-Za-km-z]{6})$/);
  if (request.method === 'GET' && (supplementMatch || shortMatch)) {
    const result = supplementMatch
      ? await dispatchAction(request, env, 'resolveSupplementLink', { slot: supplementMatch[1], id: supplementMatch[2] })
      : await dispatchAction(request, env, 'resolveShortLink', { code: shortMatch?.[1] || '' });
    if (!result.ok || !text(result.url)) return jsonResponse(request, env, result, 404);
    return Response.redirect(text(result.url), 302);
  }

  return jsonResponse(request, env, { ok: false, error: 'Not Found' }, 404);
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const origin = text(request.headers.get('Origin'));
    if (origin && !allowedOrigins(env).has(origin)) return jsonResponse(request, env, { ok: false, error: '不允許的網站來源' }, 403);
    if (request.method === 'OPTIONS') {
      const headers = corsHeaders(request, env);
      headers.set('Access-Control-Allow-Headers', 'Authorization, Content-Type');
      headers.set('Access-Control-Allow-Methods', 'GET, POST, PATCH, DELETE, OPTIONS');
      headers.set('Access-Control-Max-Age', '600');
      headers.delete('Content-Type');
      return new Response(null, { status: 204, headers });
    }
    if (!['GET', 'POST', 'PATCH', 'DELETE'].includes(request.method)) return jsonResponse(request, env, { ok: false, error: 'Method Not Allowed' }, 405);
    try { return await handleApi(request, env); }
    catch (error) {
      console.error(JSON.stringify({ event: 'request-error', message: error instanceof Error ? error.message : String(error) }));
      return jsonResponse(request, env, { ok: false, error: error instanceof Error ? error.message : String(error) }, 200);
    }
  },
  // Cron Trigger（wrangler.jsonc 的 triggers.crons，每分鐘一次）——寄信/回信「指定排程時間」功能的實際
  // 寄出入口，不經過一般的 fetch()/handleApi() 那條路（背景排程沒有使用者 session、也不是一次 HTTP 請求），
  // 直接呼叫 DatabaseCoordinator 這個具名 Durable Object 上公開的 runScheduledDispatch()。
  async scheduled(_controller: ScheduledController, env: Env): Promise<void> {
    const stub = env.DATABASE_COORDINATOR.getByName('primary', { locationHint: 'apac' }) as DurableObjectStub<DatabaseCoordinator>;
    try {
      const result = await stub.runScheduledDispatch();
      console.log(JSON.stringify({ event: 'scheduled-mail-dispatch', ...result }));
    } catch (error) {
      console.error(JSON.stringify({ event: 'scheduled-mail-dispatch-error', message: error instanceof Error ? error.message : String(error) }));
    }
  }
} satisfies ExportedHandler<Env>;

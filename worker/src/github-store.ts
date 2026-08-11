import { normalizeSnapshot, text } from './model';
import type { DatabaseSnapshot, GitHubCommitResult, StoredSnapshot } from './types';

const GITHUB_API_VERSION = '2022-11-28';

function databaseApiUrl(env: Env): string {
  const owner = encodeURIComponent(env.GITHUB_OWNER);
  const repo = encodeURIComponent(env.GITHUB_REPO);
  const path = env.GITHUB_DATABASE_PATH.split('/').map(encodeURIComponent).join('/');
  return `https://api.github.com/repos/${owner}/${repo}/contents/${path}`;
}

function githubHeaders(env: Env): Headers {
  const headers = new Headers({
    Accept: 'application/vnd.github+json',
    'X-GitHub-Api-Version': GITHUB_API_VERSION,
    'User-Agent': 'machi-design-api-worker'
  });
  if (text(env.GITHUB_TOKEN)) headers.set('Authorization', `Bearer ${env.GITHUB_TOKEN}`);
  return headers;
}

function bytesToBase64(bytes: Uint8Array): string {
  let binary = '';
  const chunkSize = 0x8000;
  for (let offset = 0; offset < bytes.length; offset += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(offset, offset + chunkSize));
  }
  return btoa(binary);
}

function base64ToUtf8(value: string): string {
  const binary = atob(value.replace(/\s+/g, ''));
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);
  return new TextDecoder().decode(bytes);
}

function encodedDatabase(database: DatabaseSnapshot): string {
  const json = `${JSON.stringify(database, null, 2)}\n`;
  return bytesToBase64(new TextEncoder().encode(json));
}

async function githubError(response: Response, label: string): Promise<Error> {
  const data = await response.json().catch(() => ({})) as Record<string, unknown>;
  const message = text(data.message) || `HTTP ${response.status}`;
  const error = new Error(`${label}失敗：${message}`);
  Object.assign(error, { status: response.status, github: data });
  return error;
}

export async function loadGitHubDatabase(env: Env): Promise<StoredSnapshot> {
  const url = new URL(databaseApiUrl(env));
  url.searchParams.set('ref', env.GITHUB_BRANCH);
  const response = await fetch(url, {
    method: 'GET',
    headers: githubHeaders(env),
    redirect: 'follow'
  });
  if (!response.ok) throw await githubError(response, '讀取 GitHub JSON');
  const data = await response.json() as Record<string, unknown>;
  if (text(data.type) !== 'file' || !text(data.sha) || !text(data.content)) throw new Error('GitHub JSON 回傳格式不正確');
  let parsed: unknown;
  try { parsed = JSON.parse(base64ToUtf8(text(data.content))); } catch { throw new Error('GitHub JSON 內容無法解析'); }
  return { database: normalizeSnapshot(parsed), sha: text(data.sha) };
}

export async function commitGitHubDatabase(
  env: Env,
  database: DatabaseSnapshot,
  sha: string,
  message: string
): Promise<GitHubCommitResult> {
  if (!text(env.GITHUB_TOKEN)) throw new Error('Cloudflare Worker 尚未設定 GITHUB_TOKEN Secret');
  const response = await fetch(databaseApiUrl(env), {
    method: 'PUT',
    headers: new Headers({ ...Object.fromEntries(githubHeaders(env)), 'Content-Type': 'application/json' }),
    body: JSON.stringify({
      message: text(message) || 'data: update via Cloudflare Worker',
      content: encodedDatabase(database),
      sha,
      branch: env.GITHUB_BRANCH,
      committer: { name: 'Machi Design API', email: 'machi.chen@emctaipei.com' }
    })
  });
  if (!response.ok) throw await githubError(response, '寫入 GitHub JSON');
  const data = await response.json() as Record<string, unknown>;
  const content = data.content as Record<string, unknown> | undefined;
  const commit = data.commit as Record<string, unknown> | undefined;
  const nextSha = text(content?.sha);
  if (!nextSha) throw new Error('GitHub 寫入成功但未回傳檔案 SHA');
  return { database, sha: nextSha, commitSha: text(commit?.sha) };
}

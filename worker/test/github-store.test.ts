import { afterEach, describe, expect, it, vi } from 'vitest';
import { emptyDatabase } from '../../backend/schema.mjs';
import { loadGitHubDatabase } from '../src/github-store';

const testEnv = {
  GITHUB_OWNER: 'example-owner',
  GITHUB_REPO: 'example-repo',
  GITHUB_DATABASE_PATH: 'backend/data/db.json',
  GITHUB_BRANCH: 'main',
  GITHUB_TOKEN: 'test-token'
} as unknown as Env;

function databaseJson(): string {
  const database = emptyDatabase();
  database.revision = 42;
  return JSON.stringify(database);
}

function toBase64(value: string): string {
  const bytes = new TextEncoder().encode(value);
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe('GitHub database storage', () => {
  it('decodes normal GitHub Contents API responses', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue(Response.json({
      type: 'file',
      sha: 'small-file-sha',
      encoding: 'base64',
      content: toBase64(databaseJson())
    }));

    const stored = await loadGitHubDatabase(testEnv);

    expect(stored.sha).toBe('small-file-sha');
    expect(stored.database.revision).toBe(42);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('uses the raw media response when a file is larger than the inline-content limit', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(Response.json({
        type: 'file',
        sha: 'large-file-sha',
        encoding: 'none',
        content: ''
      }))
      .mockResolvedValueOnce(new Response(databaseJson(), { status: 200 }));

    const stored = await loadGitHubDatabase(testEnv);

    expect(stored.sha).toBe('large-file-sha');
    expect(stored.database.revision).toBe(42);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    const [, rawRequest] = fetchMock.mock.calls;
    expect(String(rawRequest[0])).toContain('/contents/backend/data/db.json?ref=main');
    expect(new Headers(rawRequest[1]?.headers).get('Accept')).toBe('application/vnd.github.raw+json');
    expect(new Headers(rawRequest[1]?.headers).get('Authorization')).toBe('Bearer test-token');
  });
});

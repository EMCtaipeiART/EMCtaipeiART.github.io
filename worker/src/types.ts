export type JsonPrimitive = string | number | boolean | null;
export type JsonValue = JsonPrimitive | JsonValue[] | { [key: string]: JsonValue };
export type Row = Record<string, unknown>;

export interface DatabaseTable {
  headers: string[];
  primaryKey: string | null;
  rows: Row[];
}

export interface DatabaseSnapshot {
  schemaVersion?: number;
  revision: number;
  createdAt?: string;
  updatedAt: string;
  source?: Row;
  tables: Record<string, DatabaseTable>;
  internal: {
    sessions: Record<string, unknown>;
    idempotency: Record<string, Row>;
    [key: string]: unknown;
  };
  [key: string]: unknown;
}

export interface SessionRecord {
  user: string;
  account: string;
  provider: 'google' | 'erp' | 'password';
  expiresAt: number;
  department?: string;
  role?: string;
  erpEmployeeId?: string;
}

export interface RequestContext {
  baseUrl: string;
  origin: string;
  ip: string;
  userAgent: string;
}

export type ApiPayload = Record<string, unknown>;
export type ApiResult = Record<string, unknown> & { ok: boolean };

export interface StoredSnapshot {
  database: DatabaseSnapshot;
  sha: string;
}

export interface GitHubCommitResult {
  database: DatabaseSnapshot;
  sha: string;
  commitSha: string;
}

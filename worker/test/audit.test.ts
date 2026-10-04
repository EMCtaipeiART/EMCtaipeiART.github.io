import { describe, expect, it } from 'vitest';
import { diffAudit, maskRecipients } from '../src/audit';
import type { DatabaseSnapshot } from '../src/types';

const snap = (cases: Record<string, unknown>[], perms: Record<string, unknown>[] = []): DatabaseSnapshot => ({
  revision: 1,
  updatedAt: '',
  tables: {
    database: { headers: [], primaryKey: null, rows: cases },
    '帳號權限': { headers: [], primaryKey: null, rows: perms }
  },
  internal: { sessions: {}, idempotency: {} }
});

describe('audit diff', () => {
  it('records status changes and other field edits separately, skipping derived fields', () => {
    const before = snap([{ 案件編號: '2610001', 狀態: '未開始', 設計負責人: 'Anna', 修改次數: '0' }]);
    const after = snap([{ 案件編號: '2610001', 狀態: '執行中', 設計負責人: 'Leona', 修改次數: '1' }]);
    const out = diffAudit(before, after, 'Machi', 'update');
    expect(out.map(e => [e.kind, e.field, e.from, e.to])).toEqual([
      ['狀態變更', '狀態', '未開始', '執行中'],
      ['欄位修改', '設計負責人', 'Anna', 'Leona']
    ]);
    expect(out.every(e => e.actor === 'Machi' && e.caseId === '2610001')).toBe(true);
  });

  it('records new and removed cases and nothing when unchanged', () => {
    const a = snap([{ 案件編號: '1', 狀態: '未開始' }]);
    expect(diffAudit(a, snap([{ 案件編號: '1', 狀態: '未開始' }]), 'x', 'noop')).toEqual([]);
    const added = diffAudit(a, snap([{ 案件編號: '1', 狀態: '未開始' }, { 案件編號: '2', 客戶別: 'C', 專案名稱: 'P' }]), 'x', 'add');
    expect(added.map(e => [e.kind, e.caseId])).toEqual([['案件新增', '2']]);
    const removed = diffAudit(a, snap([]), 'x', 'del');
    expect(removed.map(e => [e.kind, e.caseId])).toEqual([['案件刪除', '1']]);
  });

  it('records permission changes but never password fields', () => {
    const before = snap([], [{ 帳號: 'a@x.com', 角色範本: '設計師', 狀態: '啟用', 密碼雜湊: 'old' }]);
    const after = snap([], [{ 帳號: 'a@x.com', 角色範本: '管理者', 狀態: '啟用', 密碼雜湊: 'new' }]);
    const out = diffAudit(before, after, 'Machi', 'adminTableUpdate');
    expect(out).toHaveLength(1);
    expect(out[0]).toMatchObject({ kind: '權限變更', target: 'a@x.com', field: '角色範本', from: '設計師', to: '管理者' });
    expect(JSON.stringify(out)).not.toContain('密碼');
  });

  it('masks recipients down to count and domain', () => {
    expect(maskRecipients('Bob <bob@client.com>, amy@client.com; z@other.org')).toBe('3 位（client.com、other.org）');
    expect(maskRecipients('')).toBe('');
  });
});

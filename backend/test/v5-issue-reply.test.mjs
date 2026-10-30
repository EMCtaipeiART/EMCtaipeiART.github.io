import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
const site = readFileSync(new URL('../../site.js', import.meta.url), 'utf8');
const worker = readFileSync(new URL('../../worker/src/database-coordinator.ts', import.meta.url), 'utf8');
const schema = readFileSync(new URL('../schema.mjs', import.meta.url), 'utf8');

test('問題回報：管理者回覆欄位、儲存動作與列表顯示', () => {
  assert.match(schema, /'已否決', '管理者回覆', '回覆時間'/);
  assert.match(worker, /action === 'replyIssueReport'[\s\S]*?requireAccess\(database, session, 'issue\.manage'\)/);
  assert.match(site, /api\('replyIssueReport'/);
  assert.match(site, /data-issue-reply-text/);
});

test('問題回報：管理者有新的回報中會跳提示（首次只記錄不轟炸）', () => {
  assert.match(site, /function checkIssueNotify/);
  assert.match(site, /isIssueManager\(\)/);
  assert.match(site, /checkNtToast\(\)\{\s*checkIssueNotify\(\)/);
});

import assert from 'node:assert/strict';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import {
  addPreviewsToJob,
  createPreviewJob,
  normalizePreviewJobId,
  readPreviewJob,
  uploadPendingRound
} from '../../scripts/nas_design_image_lib.mjs';

const emptyDb = { tables: { '修改統計表': { rows: [] } } };

async function runUpload({ onEligible, previewPath }) {
  const originalFetch = globalThis.fetch;
  const events = [];
  globalThis.fetch = async (_url, options) => {
    events.push('upload');
    return new Response(JSON.stringify({ success: true, count: JSON.parse(options.body).images.length, jsonRevision: 1 }));
  };
  try {
    const relPath = 'a.png';
    const result = await uploadPendingRound({
      config: { appsScriptUploadUrl: 'https://example.test/upload' },
      secrets: { serviceKey: 'k' },
      dbData: emptyDb,
      caseId: '26100001',
      designer: 'Machi',
      client: '客戶',
      start: '2026/10/01',
      pendingPreviews: [{ relPath, previewPath, mtimeMs: 1, size: 1 }],
      stateFiles: { [relPath]: { assignedRound: null, uploadAttempt: null } },
      onEligible: onEligible ? items => { events.push('eligible'); return onEligible(items); } : undefined
    });
    return { result, events };
  } finally {
    globalThis.fetch = originalFetch;
  }
}

test('the previews that are about to be uploaded are handed over before the slow Drive upload starts', async () => {
  const seen = [];
  const { result, events } = await runUpload({ previewPath: fileURLToPath(import.meta.url), onEligible: items => { seen.push(...items.map(item => item.relPath)); } });
  assert.deepEqual(seen, ['a.png']);
  assert.equal(events[0], 'eligible', '預覽要在上傳之前就交出去，使用者才不必等 Drive');
  assert.ok(events.includes('upload'));
  assert.equal(result.uploadedCount, 1);
});

test('a failing preview callback never blocks or breaks the backup itself', async () => {
  const { result, events } = await runUpload({ previewPath: fileURLToPath(import.meta.url), onEligible: () => { throw new Error('boom'); } });
  assert.equal(result.uploadedCount, 1);
  assert.equal(events[0], 'eligible');
  assert.ok(events.includes('upload'), '回呼失敗後仍照常上傳');
});

test('nothing is handed over when there is nothing to upload', async () => {
  let called = false;
  const result = await uploadPendingRound({
    config: {}, secrets: {}, dbData: emptyDb, caseId: '26100001', designer: 'M', client: 'C', start: '2026/10/01',
    pendingPreviews: [], stateFiles: {}, onEligible: () => { called = true; }
  });
  assert.equal(result.uploadedCount, 0);
  assert.equal(called, false);
});

test('preview jobs hand out only new items per poll, skip oversized or unreadable files, and validate ids', async () => {
  assert.equal(normalizePreviewJobId('abc'), '', '太短的 id 不接受');
  assert.equal(normalizePreviewJobId('../../etc/passwd'), '');
  assert.equal(normalizePreviewJobId('job-12345678'), 'job-12345678');

  const dir = await mkdtemp(path.join(os.tmpdir(), 'preview-job-'));
  try {
    const small = path.join(dir, 'small.jpg');
    const big = path.join(dir, 'big.jpg');
    await writeFile(small, Buffer.from('hello'));
    await writeFile(big, Buffer.alloc(4 * 1024 * 1024));
    const job = createPreviewJob('job-aaaaaaaa');
    assert.deepEqual(readPreviewJob('job-aaaaaaaa', 0), { items: [], next: 0, finished: false });
    await addPreviewsToJob(job, [
      { relPath: 'sub/small.png', previewPath: small },
      { relPath: 'big.png', previewPath: big },
      { relPath: 'missing.png', previewPath: path.join(dir, 'nope.jpg') }
    ], 'ANKER/社群');
    const first = readPreviewJob('job-aaaaaaaa', 0);
    assert.equal(first.items.length, 1, '超過 3 MB 與讀不到的略過');
    assert.equal(first.items[0].fileName, 'small.png', '檔名取原始檔名，跟資料庫裡的 fileName 一致');
    assert.equal(first.items[0].folder, 'ANKER/社群');
    assert.equal(Buffer.from(first.items[0].base64, 'base64').toString(), 'hello');
    assert.deepEqual(readPreviewJob('job-aaaaaaaa', first.next).items, [], '已經領過的不重複給');
    job.finished = true;
    assert.equal(readPreviewJob('job-aaaaaaaa', first.next).finished, true);
    assert.equal(readPreviewJob('job-unknown1', 0), null);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('the page, picker page and picker server are wired so NAS previews reach the mail editor before the Drive backup finishes', async () => {
  const { readFile } = await import('node:fs/promises');
  const html = await readFile(new URL('../../index.html', import.meta.url), 'utf8');
  const picker = await readFile(new URL('../../scripts/nas_folder_picker_server.mjs', import.meta.url), 'utf8');

  // 選擇器頁面：確認時帶 previewJobId、輪詢預覽、轉交給主頁，備份結束後停止並再收一次。
  assert.match(picker, /body: JSON\.stringify\(\{ caseId, token, folders: foldersToSubmit, previewJobId \}\)/);
  assert.match(picker, /\/api\/confirm-previews\?jobId=/);
  assert.match(picker, /type: 'machi-nas-folder-previews', caseId, nonce, items: data\.items/);
  assert.match(picker, /previewPollingStopped = true;\n    await pollPreviewsOnce\(\);/, '備份結束後要再收一次，最後一批才不會漏');
  // 伺服器：預覽端點要驗 token，確認請求結束時一定標記完成。
  assert.match(picker, /url\.pathname === '\/api\/confirm-previews'\) \{\n      if \(requestToken\(url\) !== pickerToken\)/);
  assert.match(picker, /\} finally \{\n        if \(previewJob\) previewJob\.finished = true;/);
  assert.match(picker, /onEligible: onPreviews/);

  // 主頁：只在「設計師回覆信＋要同步圖片＋同一案件」時處理預覽；NAS 預覽圖不再備份第二次。
  assert.match(html, /data\.type==='machi-nas-folder-previews'/);
  assert.match(html, /nasFolderPickerAfterReply&&!nasFolderPickerSkipReplyImages&&String\(data\.caseId\|\|''\)===String\(activeNasFolderPickerCaseId\|\|''\)/);
  assert.match(html, /nasBacked:true/);
  assert.equal((html.match(/inlineImagesNeedingBackup\(editor,editorPayload\.inlineImages\)/g) || []).length, 2, '寄出、排程兩條路徑都要排除 NAS 預覽圖');
  // 預覽上限：單封 12 MB，超過的改由備份完成後以雲端網址補上。
  assert.match(html, /DESIGNER_REPLY_EARLY_PREVIEW_MAX_TOTAL_BYTES=12\*1024\*1024/);
  // 內嵌圖片張數上限前後端一致（NAS 一輪常常超過 10 張）。
  const worker = await readFile(new URL('../../worker/src/database-coordinator.ts', import.meta.url), 'utf8');
  assert.match(html, /gmailInlineImageMaxCount=30,/);
  assert.match(worker, /const GMAIL_INLINE_IMAGE_MAX_COUNT = 30;/);
});

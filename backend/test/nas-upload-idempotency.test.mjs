import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';
import {
  changedFileRoundState,
  createCaseDesignUploadDedupeKey,
  uploadPendingRound,
  uploadRound
} from '../../scripts/nas_design_image_lib.mjs';

test('a changed source file keeps its completed round and waits for the next revision', () => {
  assert.deepEqual(changedFileRoundState({ assignedRound: 0, uploadAttempt: null }), {
    assignedRound: 0,
    pendingAfterRound: 0,
    uploadAttempt: null
  });
  assert.deepEqual(changedFileRoundState({ assignedRound: 2, pendingAfterRound: 2 }), {
    assignedRound: 2,
    pendingAfterRound: 2,
    uploadAttempt: null
  });
  assert.deepEqual(changedFileRoundState(null), {
    assignedRound: null,
    pendingAfterRound: null,
    uploadAttempt: null
  });
});

test('NAS upload dedupe key stays stable for the same source version', () => {
  const source = {
    caseId: '26080119',
    round: 0,
    relPath: '260821_八月CPAS廣告素材_lito_PChome.png',
    mtimeMs: 1787287078384.8877,
    size: 1359316
  };
  const first = createCaseDesignUploadDedupeKey(source);
  const retry = createCaseDesignUploadDedupeKey({ ...source });
  assert.match(first, /^[a-f0-9]{64}$/);
  assert.equal(retry, first);
  assert.notEqual(createCaseDesignUploadDedupeKey({ ...source, round: 1 }), first);
  assert.notEqual(createCaseDesignUploadDedupeKey({ ...source, mtimeMs: source.mtimeMs + 1 }), first);
});

test('NAS upload request forwards the stable dedupe key to Apps Script', async () => {
  const originalFetch = globalThis.fetch;
  let requestPayload;
  globalThis.fetch = async (_url, options) => {
    requestPayload = JSON.parse(options.body);
    return new Response(JSON.stringify({ success: true, count: 1, jsonRevision: 99 }));
  };
  try {
    const item = {
      relPath: '260821_八月CPAS廣告素材_lito_PChome.png',
      previewPath: fileURLToPath(import.meta.url),
      mtimeMs: 1787287078384.8877,
      size: 1359316
    };
    await uploadRound({
      config: { appsScriptUploadUrl: 'https://example.test/upload' },
      secrets: { serviceKey: 'test-key' },
      caseId: '26080119',
      round: 0,
      designer: 'Machi',
      client: 'DJI',
      year: '2026',
      month: '08',
      pendingPreviews: [item]
    });
    assert.equal(requestPayload.images[0].dedupeKey, createCaseDesignUploadDedupeKey({
      caseId: '26080119',
      round: 0,
      relPath: item.relPath,
      mtimeMs: item.mtimeMs,
      size: item.size
    }));
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('ambiguous NAS upload is reconciled from the published database before retrying', async () => {
  const relPath = '260821_八月CPAS廣告素材_lito_PChome.png';
  const stateFiles = {
    [relPath]: {
      assignedRound: null,
      uploadAttempt: { round: 0, atMs: Date.now() - 60_000, baselineCount: 0 }
    }
  };
  const dbData = {
    tables: {
      '修改統計表': {
        rows: [{
          '案件編號': '26080119',
          '修改次數': '0',
          '圖片連結': JSON.stringify([{ fileName: relPath, url: 'https://example.test/first-upload' }])
        }]
      }
    }
  };
  let persistCount = 0;
  const result = await uploadPendingRound({
    config: {},
    secrets: {},
    dbData,
    caseId: '26080119',
    designer: 'Machi',
    client: 'DJI',
    start: '2026/08/21',
    pendingPreviews: [{ relPath, previewPath: '/unused' }],
    stateFiles,
    persistState: async () => { persistCount += 1; }
  });
  assert.equal(result.uploadedCount, 0);
  assert.equal(result.reconciledCount, 1);
  assert.equal(stateFiles[relPath].assignedRound, 0);
  assert.equal(stateFiles[relPath].uploadAttempt, null);
  assert.equal(persistCount, 1);
});

test('ambiguous NAS upload waits for publication instead of retrying one minute later', async () => {
  const relPath = '260821_八月CPAS廣告素材_lito_PChome.png';
  const attempt = { round: 0, atMs: Date.now() - 60_000, baselineCount: 0 };
  const stateFiles = { [relPath]: { assignedRound: null, uploadAttempt: attempt } };
  const result = await uploadPendingRound({
    config: {},
    secrets: {},
    dbData: { tables: { '修改統計表': { rows: [] } } },
    caseId: '26080119',
    designer: 'Machi',
    client: 'DJI',
    start: '2026/08/21',
    pendingPreviews: [{ relPath, previewPath: '/unused' }],
    stateFiles
  });
  assert.equal(result.uploadedCount, 0);
  assert.equal(result.deferredCount, 1);
  assert.equal(stateFiles[relPath].assignedRound, null);
  assert.deepEqual(stateFiles[relPath].uploadAttempt, attempt);
});

test('a completed draft stays sealed and uploads its latest changed version only after the next revision exists', async () => {
  const originalFetch = globalThis.fetch;
  const relPath = 'draft.png';
  const stateFiles = {
    [relPath]: {
      assignedRound: 0,
      pendingAfterRound: 0,
      uploadAttempt: null
    }
  };
  const roundState = { sealedRound: 0, files: stateFiles };
  const draftDb = {
    tables: {
      '修改統計表': {
        rows: [{
          '案件編號': '26090001',
          '修改次數': '0',
          '圖片連結': JSON.stringify([{ fileName: relPath, url: 'https://example.test/draft-v1' }])
        }]
      }
    }
  };
  const pendingPreviews = [{
    relPath,
    previewPath: fileURLToPath(import.meta.url),
    mtimeMs: 2,
    size: 2,
    pendingAfterRound: 0
  }];
  let requestPayload = null;
  globalThis.fetch = async (_url, options) => {
    requestPayload = JSON.parse(options.body);
    return new Response(JSON.stringify({ success: true, count: 1, jsonRevision: 101 }));
  };
  try {
    const sealed = await uploadPendingRound({
      config: { appsScriptUploadUrl: 'https://example.test/upload' },
      secrets: { serviceKey: 'test-key' },
      dbData: draftDb,
      caseId: '26090001',
      designer: 'Machi',
      client: '測試客戶',
      start: '2026/09/01',
      pendingPreviews,
      stateFiles,
      roundState
    });
    assert.equal(sealed.uploadedCount, 0);
    assert.equal(sealed.waitingForNextRoundCount, 1);
    assert.equal(requestPayload, null);
    assert.equal(stateFiles[relPath].assignedRound, 0);
    assert.equal(stateFiles[relPath].pendingAfterRound, 0);

    const revisionDb = structuredClone(draftDb);
    revisionDb.tables['修改統計表'].rows.push({
      '案件編號': '26090001',
      '修改次數': '1',
      '圖片連結': '[]'
    });
    const revision = await uploadPendingRound({
      config: { appsScriptUploadUrl: 'https://example.test/upload' },
      secrets: { serviceKey: 'test-key' },
      dbData: revisionDb,
      caseId: '26090001',
      designer: 'Machi',
      client: '測試客戶',
      start: '2026/09/01',
      pendingPreviews,
      stateFiles,
      roundState
    });
    assert.equal(revision.uploadedCount, 1);
    assert.equal(requestPayload.round, 1);
    assert.equal(stateFiles[relPath].assignedRound, 1);
    assert.equal(stateFiles[relPath].pendingAfterRound, null);
    assert.equal(roundState.sealedRound, 1);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('a new file discovered after a round was sealed also waits for the next revision', async () => {
  const relPath = 'late-addition.png';
  const stateFiles = {
    'draft.png': { assignedRound: 0, pendingAfterRound: null },
    [relPath]: { assignedRound: null, pendingAfterRound: null, uploadAttempt: null }
  };
  const roundState = { sealedRound: 0, files: stateFiles };
  const result = await uploadPendingRound({
    config: {},
    secrets: {},
    dbData: { tables: { '修改統計表': { rows: [{ '案件編號': '26090001', '修改次數': '0' }] } } },
    caseId: '26090001',
    designer: 'Machi',
    client: '測試客戶',
    start: '2026/09/01',
    pendingPreviews: [{ relPath, previewPath: '/unused' }],
    stateFiles,
    roundState
  });
  assert.equal(result.uploadedCount, 0);
  assert.equal(result.waitingForNextRoundCount, 1);
  assert.equal(stateFiles[relPath].pendingAfterRound, 0);
});

test('Apps Script reuses the same Drive file for a retried dedupe key', async () => {
  const source = await readFile(new URL('../../upload/Code.gs', import.meta.url), 'utf8');
  let nextFileId = 1;
  let createCount = 0;
  let lockWaitCount = 0;
  let lockReleaseCount = 0;
  const filesByName = new Map();
  const folder = {
    getFilesByName(name) {
      const file = filesByName.get(name);
      let consumed = false;
      return {
        hasNext: () => Boolean(file) && !consumed,
        next: () => {
          consumed = true;
          return file;
        }
      };
    },
    createFile(blob) {
      createCount += 1;
      const id = `drive-file-${nextFileId++}`;
      const file = {
        getId: () => id,
        setSharing: () => {}
      };
      filesByName.set(blob.name, file);
      return file;
    }
  };
  const context = vm.createContext({
    console,
    DriveApp: { Access: { ANYONE_WITH_LINK: 'link' }, Permission: { VIEW: 'view' } },
    LockService: {
      getScriptLock: () => ({
        waitLock: () => { lockWaitCount += 1; },
        releaseLock: () => { lockReleaseCount += 1; }
      })
    },
    Utilities: {
      base64Decode: value => [...Buffer.from(value, 'base64')],
      newBlob: (bytes, mimeType, name) => ({ bytes, mimeType, name }),
      formatDate: () => '20260821-123847'
    },
    Session: { getScriptTimeZone: () => 'Asia/Taipei' },
    Math,
    Date,
    JSON,
    String,
    Number,
    Array,
    Object,
    RegExp,
    Set,
    Map
  });
  vm.runInContext(source, context);

  const image = {
    fileName: '260821_八月CPAS廣告素材_lito_PChome.png',
    mimeType: 'image/jpeg',
    base64: Buffer.from('preview-image').toString('base64'),
    dedupeKey: 'a'.repeat(64)
  };
  const first = context.uploadImagesToFolder_([image], folder, 1024 * 1024);
  const retry = context.uploadImagesToFolder_([image], folder, 1024 * 1024);

  assert.equal(createCount, 1);
  assert.equal(first[0].url, retry[0].url);
  assert.equal(lockWaitCount, 2);
  assert.equal(lockReleaseCount, 2);

  const changed = context.uploadImagesToFolder_([{ ...image, dedupeKey: 'b'.repeat(64) }], folder, 1024 * 1024);
  assert.equal(createCount, 2);
  assert.notEqual(changed[0].url, first[0].url);
});

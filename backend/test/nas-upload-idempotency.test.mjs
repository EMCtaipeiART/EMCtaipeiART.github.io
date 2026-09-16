import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';
import {
  changedFileRoundState,
  designImageBaseName,
  recordedRoundsByBaseName,
  discoverProjects,
  createCaseDesignUploadDedupeKey,
  recordedRoundImageBaseNames,
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

test('a reused case id does not inherit the previous case\'s sealed draft, so the real first draft still uploads', async () => {
  // 26090074：同一個編號先被一筆測試案件用過、上傳過初稿後刪除，本機同步紀錄留下「初稿已封存」。
  // 新案件的 4 張初稿因此全被標成「等下一輪」，資料庫裡這個案件卻一張圖都沒有。
  const originalFetch = globalThis.fetch;
  const names = ['a_1000x300.png', 'a_1200x1200.png', 'a_A4.jpg', 'b_BN.png'];
  const stateFiles = Object.fromEntries(names.map(name => [name, { assignedRound: null, pendingAfterRound: 0, uploadAttempt: null }]));
  const roundState = { sealedRound: 0, files: stateFiles };
  let requestPayload = null;
  globalThis.fetch = async (_url, options) => {
    requestPayload = JSON.parse(options.body);
    return new Response(JSON.stringify({ success: true, count: requestPayload.images.length, jsonRevision: 7 }));
  };
  try {
    const result = await uploadPendingRound({
      config: { appsScriptUploadUrl: 'https://example.test/upload' },
      secrets: { serviceKey: 'test-key' },
      dbData: { tables: { '修改統計表': { rows: [] } } },
      caseId: '26090074',
      designer: 'Machi',
      client: 'DJI',
      start: '2026/09/09',
      pendingPreviews: names.map(relPath => ({ relPath, previewPath: fileURLToPath(import.meta.url), mtimeMs: 1, size: 1, pendingAfterRound: 0 })),
      stateFiles,
      roundState
    });
    assert.equal(result.uploadedCount, names.length);
    assert.equal(result.waitingForNextRoundCount, 0);
    assert.equal(result.staleSealClearedCount, names.length);
    assert.equal(requestPayload.round, 0, '沒有任何修改紀錄的案件，第一批圖一定是初稿');
    for (const name of names) {
      assert.equal(stateFiles[name].assignedRound, 0);
      assert.equal(stateFiles[name].pendingAfterRound, null);
    }
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('a round whose images reached the database stays sealed even after its uploaded files left the local state', async () => {
  // 改了關鍵字或資料夾之後，已上傳過的檔案會從同步紀錄裡消失，只剩封存標記。資料庫有這一輪的圖，
  // 封存就必須照樣成立，否則新檔案會被追加進已經交付的初稿。
  const originalFetch = globalThis.fetch;
  const relPath = 'renamed-later.png';
  const stateFiles = { [relPath]: { assignedRound: null, pendingAfterRound: null, uploadAttempt: null } };
  const roundState = { sealedRound: 0, files: stateFiles };
  globalThis.fetch = async () => { throw new Error('已封存的一輪不該再上傳任何東西'); };
  try {
    const result = await uploadPendingRound({
      config: { appsScriptUploadUrl: 'https://example.test/upload' },
      secrets: { serviceKey: 'test-key' },
      dbData: { tables: { '修改統計表': { rows: [{
        '案件編號': '26090001', '修改次數': '0',
        '圖片連結': JSON.stringify([{ fileName: 'original.png', url: 'https://example.test/original' }])
      }] } } },
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
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('the NAS watcher keeps tracking a case while it is 修改中, not only while it is 過稿中', () => {
  // 有新修改需求時案件會自動改成修改中；設計師在這段期間放進 NAS 的修改圖一樣要被自動追蹤。
  const row = (id, status) => ({ '案件編號': id, '狀態': status, '設計圖資料夾連結': `專案企劃部/執行中/${id}`, '設計負責人': 'Machi', '客戶別': 'DJI', '開始日期': '2026/09/15' });
  const dbData = { tables: { database: { rows: [
    row('26090001', '過稿中'),
    row('26090002', '修改中'),
    row('26090003', '執行中'),
    row('26090004', '已完成'),
    row('26090005', '未開始')
  ] } } };
  assert.deepEqual(discoverProjects(dbData).map(project => project.caseId), ['26090001', '26090002']);
});

test('a design already uploaded by hand is not backed up again by the NAS watcher, even when the extension differs', async () => {
  const originalFetch = globalThis.fetch;
  // 2026-09-15 的實際狀況：設計師等不到 NAS 自動備份，先用「電腦上傳圖片」補了 .jpg（上傳頁一律轉檔），
  // 監控程式稍後掃到同一批來源檔的 .png 原檔，又上傳一次，同一張圖在修改紀錄裡出現兩份。
  const manualName = '260915_Epson_台北紡織展_01.jpg';
  const sourceRelPath = '260915_Epson_台北紡織展_01.png';
  const newRelPath = '260915_Epson_台北紡織展_02_01.png';
  const dbData = {
    tables: {
      '修改統計表': {
        rows: [{
          '案件編號': '26090107',
          '修改次數': '0',
          '圖片來源': 'manual-upload',
          '圖片連結': JSON.stringify([{ fileName: manualName, url: 'https://example.test/manual-jpg' }])
        }]
      }
    }
  };
  assert.deepEqual([...recordedRoundImageBaseNames(dbData, '26090107', 0)], ['260915_epson_台北紡織展_01']);
  assert.equal(designImageBaseName('A.MP4'), 'a');

  const stateFiles = {
    [sourceRelPath]: { assignedRound: null, pendingAfterRound: null, uploadAttempt: null },
    [newRelPath]: { assignedRound: null, pendingAfterRound: null, uploadAttempt: null }
  };
  const roundState = { sealedRound: null, files: stateFiles };
  const pendingPreviews = [sourceRelPath, newRelPath].map(relPath => ({
    relPath,
    previewPath: fileURLToPath(import.meta.url),
    mtimeMs: 5,
    size: 5
  }));
  let requestPayload = null;
  globalThis.fetch = async (_url, options) => {
    requestPayload = JSON.parse(options.body);
    return new Response(JSON.stringify({ success: true, count: requestPayload.images.length, jsonRevision: 7 }));
  };
  try {
    const result = await uploadPendingRound({
      config: { appsScriptUploadUrl: 'https://example.test/upload' },
      secrets: { serviceKey: 'test-key' },
      dbData,
      caseId: '26090107',
      designer: 'Machi',
      client: 'Epson',
      start: '2026/09/15',
      pendingPreviews,
      stateFiles,
      roundState
    });
    // 已經手動上傳過的那一張不再送出，另一張沒重複的照常上傳。
    assert.equal(result.skippedAlreadyRecordedCount, 1);
    assert.equal(result.uploadedCount, 1);
    assert.deepEqual(requestPayload.images.map(image => image.fileName), [newRelPath]);
    // 跳過的檔案要標記成已歸這一輪，下次掃描不會再被當成待上傳、每分鐘重試一次。
    assert.equal(stateFiles[sourceRelPath].assignedRound, 0);
    assert.equal(stateFiles[sourceRelPath].pendingAfterRound, null);
    assert.equal(stateFiles[newRelPath].assignedRound, 0);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('when every pending file was already uploaded by hand, the watcher reports it instead of uploading', async () => {
  const originalFetch = globalThis.fetch;
  const relPath = '260914_DJI_新店裕隆城授權體驗店.png';
  const dbData = {
    tables: {
      '修改統計表': {
        rows: [{
          '案件編號': '26090081',
          '修改次數': '2',
          '圖片連結': JSON.stringify([{ fileName: '260914_DJI_新店裕隆城授權體驗店.jpg', url: 'https://example.test/manual' }])
        }]
      }
    }
  };
  const stateFiles = { [relPath]: { assignedRound: null, pendingAfterRound: null, uploadAttempt: null } };
  const roundState = { sealedRound: null, files: stateFiles };
  let called = false;
  globalThis.fetch = async () => { called = true; return new Response(JSON.stringify({ success: true, count: 1 })); };
  try {
    const result = await uploadPendingRound({
      config: { appsScriptUploadUrl: 'https://example.test/upload' },
      secrets: { serviceKey: 'test-key' },
      dbData,
      caseId: '26090081',
      designer: 'Machi',
      client: 'DJI',
      start: '2026/09/14',
      pendingPreviews: [{ relPath, previewPath: fileURLToPath(import.meta.url), mtimeMs: 1, size: 1 }],
      stateFiles,
      roundState
    });
    assert.equal(called, false, '完全不會呼叫上傳');
    assert.equal(result.uploadedCount, 0);
    assert.equal(result.skippedAlreadyRecordedCount, 1);
    assert.match(result.message, /這一輪已經有同名圖片/);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('a newly installed machine adopts rounds already backed up elsewhere instead of re-uploading them into the current round', async () => {
  const originalFetch = globalThis.fetch;
  // 多台設計師電腦都會掃同一批案件。新安裝的那台本機同步紀錄是空的，資料夾裡的舊圖不可以被當成新檔
  // 重新上傳到「目前這一輪」——初稿的圖會因此又出現在三修裡。
  const draftRel = 'design_01.png';   // 別台電腦在初稿就備份過
  const reviseRel = 'design_02.png';  // 別台電腦在一修備份過
  const freshRel = 'design_03.png';   // 真的還沒有人備份過
  const dbData = {
    tables: {
      '修改統計表': {
        rows: [
          { '案件編號': '26090200', '修改次數': '0', '圖片連結': JSON.stringify([{ fileName: 'design_01.jpg', url: 'https://x/a' }]) },
          { '案件編號': '26090200', '修改次數': '1', '圖片連結': JSON.stringify([{ fileName: 'design_02.png', url: 'https://x/b' }]) },
          { '案件編號': '26090200', '修改次數': '2', '圖片連結': '[]' }
        ]
      }
    }
  };
  assert.deepEqual([...recordedRoundsByBaseName(dbData, '26090200').entries()], [['design_01', 0], ['design_02', 1]]);

  const stateFiles = Object.fromEntries([draftRel, reviseRel, freshRel]
    .map(relPath => [relPath, { assignedRound: null, pendingAfterRound: null, uploadAttempt: null }]));
  const roundState = { sealedRound: null, files: stateFiles };
  let requestPayload = null;
  globalThis.fetch = async (_url, options) => {
    requestPayload = JSON.parse(options.body);
    return new Response(JSON.stringify({ success: true, count: requestPayload.images.length }));
  };
  try {
    const result = await uploadPendingRound({
      config: { appsScriptUploadUrl: 'https://example.test/upload' },
      secrets: { serviceKey: 'test-key' },
      dbData,
      caseId: '26090200',
      designer: 'Machi',
      client: '測試客戶',
      start: '2026/09/16',
      pendingPreviews: [draftRel, reviseRel, freshRel].map(relPath => ({
        relPath, previewPath: fileURLToPath(import.meta.url), mtimeMs: 9, size: 9
      })),
      stateFiles,
      roundState
    });
    assert.equal(result.adoptedFromDatabaseCount, 2, '兩張別台已備份過的圖不再上傳');
    assert.equal(result.uploadedCount, 1);
    assert.deepEqual(requestPayload.images.map(image => image.fileName), [freshRel], '只有真的沒備份過的那張會上傳');
    assert.equal(requestPayload.round, 2);
    // 沿用資料庫既有的輪次，不是現在這一輪，之後那個檔案再改動才會正確地等下一輪。
    assert.equal(stateFiles[draftRel].assignedRound, 0);
    assert.equal(stateFiles[reviseRel].assignedRound, 1);
    assert.equal(stateFiles[freshRel].assignedRound, 2);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('a file that this machine already tracks is not silently adopted from the database', async () => {
  const originalFetch = globalThis.fetch;
  const relPath = 'design_01.png';
  const dbData = {
    tables: {
      '修改統計表': {
        rows: [
          { '案件編號': '26090201', '修改次數': '0', '圖片連結': JSON.stringify([{ fileName: 'design_01.png', url: 'https://x/a' }]) },
          { '案件編號': '26090201', '修改次數': '1', '圖片連結': '[]' }
        ]
      }
    }
  };
  // 這台電腦自己傳過初稿，設計師改了檔案，狀態是「等下一輪」——這是既有流程，必須照常在一修上傳新版。
  const stateFiles = { [relPath]: { assignedRound: 0, pendingAfterRound: 0, uploadAttempt: null } };
  const roundState = { sealedRound: 0, files: stateFiles };
  let requestPayload = null;
  globalThis.fetch = async (_url, options) => {
    requestPayload = JSON.parse(options.body);
    return new Response(JSON.stringify({ success: true, count: 1 }));
  };
  try {
    const result = await uploadPendingRound({
      config: { appsScriptUploadUrl: 'https://example.test/upload' },
      secrets: { serviceKey: 'test-key' },
      dbData,
      caseId: '26090201',
      designer: 'Machi',
      client: '測試客戶',
      start: '2026/09/16',
      pendingPreviews: [{ relPath, previewPath: fileURLToPath(import.meta.url), mtimeMs: 3, size: 3 }],
      stateFiles,
      roundState
    });
    assert.equal(result.adoptedFromDatabaseCount, 0);
    assert.equal(result.uploadedCount, 1);
    assert.equal(requestPayload.round, 1, '新版要上傳到一修');
    assert.equal(stateFiles[relPath].assignedRound, 1);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('the run lock and the state lock are separate, so an immediate backup can slip in while a scan is running', async () => {
  const { mkdtemp, rm } = await import('node:fs/promises');
  const { tmpdir } = await import('node:os');
  const path = (await import('node:path')).default;
  const { acquireLock, acquireLockWithWait, releaseLock } = await import('../../scripts/nas_design_image_lib.mjs');
  const dir = await mkdtemp(path.join(tmpdir(), 'nas-locks-'));
  try {
    const stateFile = path.join(dir, 'sync-state.json');
    const runLock = `${stateFile}.run.lock`;
    const stateLock = `${stateFile}.lock`;
    // 排程拿著「執行鎖」跑整輪，這時候「立即備份」照樣拿得到狀態鎖。
    assert.equal(await acquireLock(runLock), true);
    assert.equal(await acquireLockWithWait(stateLock, { timeoutMs: 1000, pollIntervalMs: 50 }), true);
    // 狀態鎖同一時間只能有一個人拿著。
    assert.equal(await acquireLockWithWait(stateLock, { timeoutMs: 300, pollIntervalMs: 50 }), false);
    await releaseLock(stateLock);
    assert.equal(await acquireLockWithWait(stateLock, { timeoutMs: 300, pollIntervalMs: 50 }), true);
    // 另一個排程執行個體仍然會被執行鎖擋下來，不會疊加。
    assert.equal(await acquireLock(runLock), false);
    await releaseLock(runLock);
    await releaseLock(stateLock);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('an oversized log file is emptied in place instead of growing forever', async () => {
  const { mkdtemp, rm, writeFile, stat, open } = await import('node:fs/promises');
  const { tmpdir } = await import('node:os');
  const path = (await import('node:path')).default;
  const { shouldTruncateLog, truncateHugeLog, MAX_LOG_BYTES } = await import('../../scripts/nas_design_image_lib.mjs');
  assert.equal(MAX_LOG_BYTES, 20 * 1024 * 1024);
  assert.equal(shouldTruncateLog(MAX_LOG_BYTES + 1), true);
  assert.equal(shouldTruncateLog(MAX_LOG_BYTES), false);
  assert.equal(shouldTruncateLog('not a number'), false);

  const dir = await mkdtemp(path.join(tmpdir(), 'nas-log-'));
  try {
    const logPath = path.join(dir, 'watcher.log');
    await writeFile(logPath, 'x'.repeat(2048));
    const handle = await open(logPath, 'r+');
    try {
      assert.equal(truncateHugeLog({ fd: handle.fd, maxBytes: 5000 }), false, '沒超過上限就不動它');
      assert.equal((await stat(logPath)).size, 2048);
      assert.equal(truncateHugeLog({ fd: handle.fd, maxBytes: 1000 }), true);
      assert.equal((await stat(logPath)).size, 0, '超過上限就就地清空');
    } finally {
      await handle.close();
    }
    // 記錄檔整理失敗（例如輸出是終端機、不是檔案）不可以影響備份。
    assert.equal(truncateHugeLog({ fd: 999999, maxBytes: 1 }), false);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('the watcher holds the state lock per folder, re-reads state each time, and caches the database between folders', async () => {
  const source = await readFile(new URL('../../scripts/nas_design_image_watcher.mjs', import.meta.url), 'utf8');
  // 執行鎖與狀態鎖必須是不同檔案，否則「立即備份」又會被整輪掃描擋住。
  assert.match(source, /const runLockFile = `\$\{stateFile\}\.run\.lock`;/);
  assert.match(source, /if \(!\(await lib\.acquireLock\(runLockFile\)\)\)/);
  assert.match(source, /const stateLockFile = `\$\{stateFile\}\.lock`;/);
  // 狀態鎖在資料夾迴圈內取得與釋放，而不是整輪持有。
  const folderLoopStart = source.indexOf('for (let folderIndex = 0;');
  const acquireAt = source.indexOf('lib.acquireLockWithWait(stateLockFile', folderLoopStart);
  const reloadAt = source.indexOf('const state = await lib.loadState(stateFile);', folderLoopStart);
  const releaseAt = source.indexOf('await lib.releaseLock(stateLockFile);', folderLoopStart);
  assert.ok(folderLoopStart > 0 && acquireAt > folderLoopStart, '狀態鎖要在資料夾迴圈裡才取得');
  assert.ok(reloadAt > acquireAt, '拿到鎖之後要重讀狀態，才不會蓋掉立即備份剛寫入的結果');
  assert.ok(releaseAt > reloadAt, '同一個資料夾處理完就要釋放狀態鎖');
  assert.doesNotMatch(source.slice(0, folderLoopStart), /await lib\.loadState\(stateFile\)/, '整輪共用的狀態讀取要移除');
  // 上傳前的資料庫查詢改用短期快取，不再每個資料夾各下載一次。
  assert.match(source, /const latestDbData = await latestDatabase\(\);/);
  assert.match(source, /Date\.now\(\) - cachedDbAt < DB_CACHE_MS/);
  assert.match(source, /lib\.truncateHugeLog\(\)/);
});

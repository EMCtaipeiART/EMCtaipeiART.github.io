import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';
import {
  createCaseDesignUploadDedupeKey,
  uploadRound
} from '../../scripts/nas_design_image_lib.mjs';

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

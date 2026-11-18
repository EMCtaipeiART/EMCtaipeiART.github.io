import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { folderAcceptsFile, listCandidateFiles } from '../../scripts/nas_design_image_lib.mjs';

const taipei = date => {
  const pad = n => String(n).padStart(2, '0');
  const t = new Date(date.getTime() + 8 * 3600e3);
  return `${t.getUTCFullYear()}/${pad(t.getUTCMonth() + 1)}/${pad(t.getUTCDate())} ${pad(t.getUTCHours())}:${pad(t.getUTCMinutes())}:${pad(t.getUTCSeconds())}`;
};

test('回信前的檔案清單：沒備份過／備份後有更新的建議勾選，已備份且沒改過的舊檔不勾，關鍵字不符的不列出', async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'cand-'));
  try {
    const backedUpAt = Date.now() - 3600e3;
    for (const name of ['a_old.png', 'a_new.png', 'a_changed.png', 'b_other.png']) await fs.writeFile(path.join(dir, name), 'x');
    const oldTime = (backedUpAt - 7200e3) / 1000;
    await fs.utimes(path.join(dir, 'a_old.png'), oldTime, oldTime);
    const now = Date.now() / 1000;
    await fs.utimes(path.join(dir, 'a_changed.png'), now, now);
    const dbData = { tables: { '修改統計表': { rows: [{
      '案件編號': 'X1', '修改次數': '0',
      '圖片連結': JSON.stringify([{ fileName: 'a_old.png', url: 'u1' }, { fileName: 'a_changed.png', url: 'u2' }]),
      '圖片更新時間': taipei(new Date(backedUpAt))
    }] } } };
    const files = await listCandidateFiles({ config: { imageExtensions: ['.png'], videoExtensions: ['.mp4'] }, folderPath: dir, keyword: 'a_', dbData, caseId: 'X1' });
    const by = Object.fromEntries(files.map(f => [f.name, f]));
    assert.deepEqual(Object.keys(by).sort(), ['a_changed.png', 'a_new.png', 'a_old.png']);
    assert.equal(by['a_new.png'].suggest, true);
    assert.equal(by['a_changed.png'].suggest, true);
    assert.equal(by['a_old.png'].suggest, false);
    assert.match(by['a_old.png'].reason, /已備份在第 0 輪/);
  } finally {
    await fs.rm(dir, { recursive: true, force: true });
  }
});

test('勾選的檔名（only）限制立即備份只收這幾個檔案', () => {
  assert.equal(folderAcceptsFile('a_new.png', { only: ['a_new.png'] }), true);
  assert.equal(folderAcceptsFile('a_old.png', { only: ['a_new.png'] }), false);
  assert.equal(folderAcceptsFile('a_old.png', { keyword: 'a_' }), true);
});

import assert from 'node:assert/strict';
import test from 'node:test';
import { folderAcceptsFile, resolveCaseFolders } from '../../scripts/nas_design_image_lib.mjs';

test('跨案件搬移後的 NAS 追蹤：skip 排除、pin 收下、pinOnly 只收 pin', () => {
  const [src] = resolveCaseFolders({ '設計圖資料夾清單': JSON.stringify([{ path: 'a', keyword: 'KW', skip: ['B1.png'] }]) });
  assert.deepEqual(src.skip, ['b1']);
  assert.equal(folderAcceptsFile('b1.jpg', src), false);
  assert.equal(folderAcceptsFile('KW_x.jpg', src), true);
  const [tgt] = resolveCaseFolders({ '設計圖資料夾清單': JSON.stringify([{ path: 'a', keyword: '', pinOnly: true, pin: ['b1'] }]) });
  assert.equal(folderAcceptsFile('B1.png', tgt), true);
  assert.equal(folderAcceptsFile('KW_x.jpg', tgt), false);
  const [plain] = resolveCaseFolders({ '設計圖資料夾連結': 'p', '設計圖檔名關鍵字': 'k' });
  assert.equal(folderAcceptsFile('k1.jpg', plain), true);
  assert.equal(folderAcceptsFile('z.jpg', plain), false);
});

test('設計師手動回覆（選擇器立即備份）會用 refresh 重抓 NAS 上較新的同名檔，並以 nas-refresh 取代這一輪原圖', async () => {
  const { readFile } = await import('node:fs/promises');
  const lib = await readFile(new URL('../../scripts/nas_design_image_lib.mjs', import.meta.url), 'utf8');
  const picker = await readFile(new URL('../../scripts/nas_folder_picker_server.mjs', import.meta.url), 'utf8');
  assert.match(picker, /refresh: (true|false)/);
  assert.match(lib, /refresh = false/);
  assert.match(lib, /'nas-refresh'/);
  assert.match(lib, /refreshNames\.has/);
});

test('回覆時重抓：備份後又改過的同名圖（本機紀錄 pendingAfterRound）一律取代，不只靠整輪共用的備份時間', async () => {
  const { readFile } = await import('node:fs/promises');
  const lib = await readFile(new URL('../../scripts/nas_design_image_lib.mjs', import.meta.url), 'utf8');
  assert.match(lib, /trackedRound\(entry\.pendingAfterRound\) !== null \|\| isNewerThanRecorded\(item\)/);
});

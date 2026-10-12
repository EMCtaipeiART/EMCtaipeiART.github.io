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

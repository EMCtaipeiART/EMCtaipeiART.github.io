import test from 'node:test';
import assert from 'node:assert/strict';
import { resolveCustomerNasFolder, parseCustomerNasFolders } from '../../scripts/nas_design_image_lib.mjs';

const db = { tables: { '客戶別': { rows: [
  { '客戶別': '欣格家居', 'NAS資料夾': JSON.stringify([
    { keyword: '迪朗奇', path: '專案企劃部/執行中/欣格/迪朗奇' },
    { keyword: '紐粹樂', path: '專案企劃部/執行中/欣格/紐粹樂' },
    { keyword: '', path: '專案企劃部/執行中/欣格' }
  ]) },
  { '客戶別': 'DJI', 'NAS資料夾': '' }
] } } };

test('客戶別 NAS 資料夾依專案名稱分流子品牌', () => {
  assert.equal(resolveCustomerNasFolder(db, '欣格家居', '迪朗奇 9 月檔期'), '專案企劃部/執行中/欣格/迪朗奇');
  assert.equal(resolveCustomerNasFolder(db, ' 欣格家居 ', '紐粹樂新品'), '專案企劃部/執行中/欣格/紐粹樂');
  assert.equal(resolveCustomerNasFolder(db, '欣格家居', '品牌形象'), '專案企劃部/執行中/欣格', '沒有關鍵字符合 → 預設資料夾');
  assert.equal(resolveCustomerNasFolder(db, 'DJI', 'x'), '');
  assert.equal(resolveCustomerNasFolder(db, '不存在', 'x'), '');
  assert.equal(resolveCustomerNasFolder(null, '欣格家居', 'x'), '');
  assert.deepEqual(parseCustomerNasFolders('壞掉的 JSON'), []);
});

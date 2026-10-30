import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { resolveClientFolderName } from '../../scripts/nas_design_image_lib.mjs';

const folders = ['Kingston', 'Nutribullet', '歐恩ON', 'B.A.T英美菸草', 'A7 Mall 早晚商城', 'Sealy', '新光銀行', '新安東京海上產險', 'ANKER', 'DJI'];

test('客戶別 → NAS 資料夾：先查對照，沒有對照再用名稱比對，明確標示沒有固定資料夾的不亂猜', () => {
  const aliases = { 金士頓: 'Kingston', 'Optimum Nutrition TW（ON）': '歐恩ON', EMC: '', 測試: '' };
  assert.deepEqual(resolveClientFolderName(folders, '金士頓', aliases), { folder: 'Kingston', source: 'alias' });
  assert.deepEqual(resolveClientFolderName(folders, ' 金士頓 ', aliases), { folder: 'Kingston', source: 'alias' }, '前後空白不影響');
  assert.deepEqual(resolveClientFolderName(folders, 'Optimum Nutrition TW（ON）', aliases), { folder: '歐恩ON', source: 'alias' });
  assert.deepEqual(resolveClientFolderName(folders, 'anker', aliases), { folder: 'ANKER', source: 'name' }, '沒有對照時維持原本的名稱比對（忽略大小寫）');
  assert.deepEqual(resolveClientFolderName(folders, 'EMC', aliases), { folder: '', source: 'none-by-alias' }, '空字串＝沒有固定資料夾');
  assert.deepEqual(resolveClientFolderName(folders, '測試', aliases), { folder: '', source: 'none-by-alias' });
  assert.deepEqual(resolveClientFolderName(folders, '不存在的客戶', aliases), { folder: '', source: '' });
  // 對照指到不存在的資料夾時，退回名稱比對，不會直接失敗。
  assert.deepEqual(resolveClientFolderName(folders, 'DJI', { DJI: '不存在' }), { folder: 'DJI', source: 'name' });
  assert.deepEqual(resolveClientFolderName(folders, 'DJI'), { folder: 'DJI', source: 'name' }, '沒傳對照表也能用');
});

test('設定檔範本帶著這份對照，選擇器的兩個入口（預設路徑、依檔名找）都會傳入', async () => {
  const config = JSON.parse(await readFile(new URL('../../scripts/nas_design_image_watcher.config.json', import.meta.url), 'utf8'));
  assert.deepEqual(config.clientFolderAliases, {
    金士頓: 'Kingston', 欣格家居: 'Nutribullet', 'Optimum Nutrition TW（ON）': '歐恩ON', BAT英美菸草: 'B.A.T英美菸草',
    林口A7讚商場: 'A7 Mall 早晚商城', 席伊麗: 'Sealy', 新光人壽: '新光銀行', 新安東京: '新安東京海上產險', EMC: '', 測試: ''
  });
  const picker = await readFile(new URL('../../scripts/nas_folder_picker_server.mjs', import.meta.url), 'utf8');
  // 兩個入口都先走 guessBrowsePath（客戶別後台設定的 NAS 資料夾優先），沒設定才退回客戶別對照。
  assert.equal((picker.match(/await guessBrowsePath\(mountRoot, config, /g) || []).length, 2);
  assert.match(picker, /resolveDefaultBrowsePath\(mountRoot, config\.defaultBrowseRoot, meta\?\.client \|\| '', config\.clientFolderAliases\)/);
  assert.match(picker, /lib\.resolveClientFolderName\(siblings, trimmedClient, aliases\)/);
});

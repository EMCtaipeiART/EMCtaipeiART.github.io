import assert from 'node:assert/strict';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { locateFolderByFiles, suggestKeywordFromNames } from '../../scripts/nas_design_image_lib.mjs';

async function tree() {
  const root = await mkdtemp(path.join(os.tmpdir(), 'locate-'));
  const put = async (rel, content = 'x') => { await mkdir(path.dirname(path.join(root, rel)), { recursive: true }); await writeFile(path.join(root, rel), content); };
  await put('執行中/ANKER/社群/2026/9月/260908_ANKER_YT結尾頁/260908_ANKER_YT結尾頁_v1.png', 'aaaa');
  await put('執行中/ANKER/社群/2026/9月/260908_ANKER_YT結尾頁/260908_ANKER_YT結尾頁_v2.png', 'bbbbbb');
  await put('執行中/ANKER/社群/2026/9月/260908_ANKER_YT結尾頁/other.png');
  await put('執行中/ANKER/社群/2026/9月/別的案子/260908_ANKER_YT結尾頁_v1.png', 'zz'); // 同名但不同檔
  await put('執行中/ANKER/Links/260908_ANKER_YT結尾頁_v1.png', 'aaaa'); // 被忽略的資料夾
  await put('執行中/DJI/廣告/x.png');
  return root;
}

test('locateFolderByFiles finds the folder that holds the chosen files, ranking by matches and then same-size files, and skips ignored folders', async () => {
  const root = await tree();
  try {
    const files = [{ name: '260908_ANKER_YT結尾頁_v1.PNG', size: 4 }, { name: '260908_ANKER_YT結尾頁_v2.png', size: 6 }];
    const hits = await locateFolderByFiles(root, '執行中/ANKER', files, { ignore: ['Links'] });
    assert.equal(hits[0].relPath, '執行中/ANKER/社群/2026/9月/260908_ANKER_YT結尾頁');
    assert.equal(hits[0].count, 2);
    assert.equal(hits[0].sizeMatches, 2);
    assert.equal(hits[1].relPath, '執行中/ANKER/社群/2026/9月/別的案子', '只有同名但大小不同的資料夾排在後面');
    assert.equal(hits[1].sizeMatches, 0);
    assert.ok(!hits.some(hit => hit.relPath.includes('Links')), '被忽略的資料夾不列入');
    assert.deepEqual(await locateFolderByFiles(root, '執行中/DJI', files), [], '找不到就回空陣列');
    assert.deepEqual(await locateFolderByFiles(root, '執行中/ANKER', []), []);
    assert.deepEqual(await locateFolderByFiles(root, '不存在', files), [], '資料夾不存在也不丟錯');
    const shallow = await locateFolderByFiles(root, '執行中/ANKER', files, { maxDepth: 1, ignore: ['Links'] });
    assert.deepEqual(shallow, [], '深度上限有效');
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('suggestKeywordFromNames strips version suffixes so later versions still match, and refuses short guesses', () => {
  assert.equal(suggestKeywordFromNames(['260908_ANKER_YT結尾頁_v1.png', '260908_ANKER_YT結尾頁_v2.png']), '260908_ANKER_YT結尾頁');
  assert.equal(suggestKeywordFromNames(['260908_ANKER_YT結尾頁_v3.png']), '260908_ANKER_YT結尾頁', '單一檔案也去掉版本號');
  assert.equal(suggestKeywordFromNames(['260908_ANKER_社群_03.jpg', '260908_ANKER_社群_04.jpg']), '260908_ANKER_社群');
  assert.equal(suggestKeywordFromNames(['a1.png', 'a2.png']), '', '太短不猜');
  assert.equal(suggestKeywordFromNames(['2026.png']), '');
  assert.equal(suggestKeywordFromNames([]), '');
});

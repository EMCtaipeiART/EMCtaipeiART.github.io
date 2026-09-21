import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const appJs = path.join(path.dirname(fileURLToPath(import.meta.url)), '../../EMC-ART-Pixel-Office/dist/app.js');

// 五位角色正面／側面圖的實測值（人物繪製高度 142、寬度 98，原點在頭頂）：
// 黑色眼珠的下緣逐張都不同，眼珠中心正面在 ±12、側面在 +16，眼珠寬約 10，臉頰外緣約 ±22。
const PUPIL_BOTTOM = { Leona: 47, Amber: 47, Noise: 50, Anna: 47, Machi: 45 };
const PUPIL_CENTRE_FRONT = 12;
const PUPIL_CENTRE_SIDE = 16;
const PUPIL_WIDTH = 10;
const FACE_HALF_WIDTH = 22;
// overtime-filter.png 的內容實測：黑眼圈只畫到 y151，鬼火從 y160 才開始。
const EYE_BAG_SOURCE_BOTTOM = 151;
const FLAME_SOURCE_TOP = 160;

async function overtimeFilterSource() {
  const source = await readFile(appJs, 'utf8');
  const start = source.indexOf('function drawOvertimeFilter(');
  assert.notEqual(start, -1, 'app.js 應該有 drawOvertimeFilter');
  return source.slice(start, source.indexOf('\nfunction ', start + 1));
}

/** 黑眼圈的來源矩形與位置：[來源 x, 來源 y, 寬, 高, 對齊的眼珠中心, 畫出來的寬度]。 */
function eyeBags(source) {
  const line = source.match(/const bags=frame===1\?(\[\[.+?\]\]):(\[\[.+?\]\]),/);
  assert.ok(line, '找不到黑眼圈的來源與位置設定');
  return { side: JSON.parse(line[1]), front: JSON.parse(line[2]) };
}

async function pupilBottoms() {
  const source = await readFile(appJs, 'utf8');
  const names = source.match(/const names=\[(.+?)\]/);
  const bottoms = source.match(/const EYE_PUPIL_BOTTOM=\[(.+?)\]/);
  assert.ok(names && bottoms, '找不到角色名單或眼珠下緣');
  return Object.fromEntries(JSON.parse(`[${names[1].replace(/'/g, '"')}]`)
    .map((name, i) => [name, JSON.parse(`[${bottoms[1]}]`)[i]]));
}

test('黑眼圈貼在每位角色自己的黑色眼珠下方', async () => {
  assert.deepEqual(await pupilBottoms(), PUPIL_BOTTOM);
});

test('黑眼圈左右對稱，且對齊眼珠中心', async () => {
  const source = await overtimeFilterSource();
  const { front, side } = eyeBags(source);
  const [left, right] = front;
  assert.equal(left[4], -PUPIL_CENTRE_FRONT, '左邊要對齊左眼珠');
  assert.equal(right[4], PUPIL_CENTRE_FRONT, '右邊要對齊右眼珠');
  assert.equal(left[4], -right[4], '兩邊要左右對稱');
  assert.equal(left[5], right[5], '兩邊要一樣寬，看起來才對稱');
  assert.equal(side[0][4], PUPIL_CENTRE_SIDE, '側面要對齊朝右那隻眼珠');
});

test('黑眼圈比眼珠略寬但不會外擴到頭髮或耳朵', async () => {
  const source = await overtimeFilterSource();
  const { front, side } = eyeBags(source);
  for (const [, , , , centre, width] of [...front, ...side]) {
    assert.ok(width > PUPIL_WIDTH, `黑眼圈寬 ${width} 應該比眼珠 ${PUPIL_WIDTH} 寬一點`);
    const outer = Math.abs(centre) + width / 2;
    assert.ok(outer <= FACE_HALF_WIDTH, `黑眼圈外緣 ${outer} 超出臉頰 ${FACE_HALF_WIDTH}`);
  }
});

test('黑眼圈的高度跟著各自的眼珠下緣走', async () => {
  const source = await overtimeFilterSource();
  assert.match(source, /bagY=feetY-\(142-EYE_PUPIL_BOTTOM\[index\]\)\*scale/,
    '黑眼圈的上緣要用該角色的眼珠下緣，不能共用一個固定值');
});

test('鬼火的來源不含黑眼圈下緣，才不會在頭頂兩側留下殘影', async () => {
  const source = await overtimeFilterSource();
  const flame = source.match(/flameTop=(\d+),flameHeight=(\d+)/);
  assert.ok(flame, '找不到鬼火的來源範圍');
  const [, flameTop, flameHeight] = flame.map(Number);
  assert.ok(flameTop > EYE_BAG_SOURCE_BOTTOM, `鬼火來源從 ${flameTop} 起，會把黑眼圈下緣一起畫出來`);
  assert.ok(flameTop <= FLAME_SOURCE_TOP, `鬼火來源從 ${flameTop} 起，會切掉火苗頂端`);
  assert.ok(flameTop + flameHeight >= 256, '鬼火來源高度不足，底部會被切掉');
});

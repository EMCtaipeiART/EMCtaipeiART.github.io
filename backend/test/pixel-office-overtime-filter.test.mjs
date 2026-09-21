import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const appJs = path.join(path.dirname(fileURLToPath(import.meta.url)), '../../EMC-ART-Pixel-Office/dist/app.js');

// 五位角色正面／側面圖的實測值（人物繪製高度 142、寬度 98，原點在頭頂）：
// 眼睛下緣落在 46~48，單眼寬約 10，正面眼睛中心在 ±11、側面在 +11，臉頰外緣約 ±22。
const EYE_BOTTOM_MIN = 46;
const EYE_BOTTOM_MAX = 48;
const EYE_WIDTH = 10;
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

function eyeBags(source) {
  const line = source.match(/const bags=frame===1\?(\[\[.+?\]\]):(\[\[.+?\]\]),/);
  assert.ok(line, '找不到黑眼圈的來源與位置設定');
  return { side: JSON.parse(line[1]), front: JSON.parse(line[2]) };
}

function bagGeometry(source) {
  const top = source.match(/bagY=feetY-\(142-(\d+(?:\.\d+)?)\)\*scale/);
  const width = source.match(/const dw=(\d+(?:\.\d+)?)\*faceScale/);
  assert.ok(top && width, '找不到黑眼圈的繪製高度與寬度');
  return { top: Number(top[1]), width: Number(width[1]) };
}

test('黑眼圈貼在眼皮底下，不會蓋住眼球', async () => {
  const source = await overtimeFilterSource();
  const { top } = bagGeometry(source);
  // 上緣不能高過最早收尾的那雙眼睛太多，否則會壓在眼球上；也不能低到離開眼皮。
  assert.ok(top >= EYE_BOTTOM_MIN, `黑眼圈上緣 ${top} 壓在眼球上（最淺的眼睛下緣是 ${EYE_BOTTOM_MIN}）`);
  assert.ok(top <= EYE_BOTTOM_MAX, `黑眼圈上緣 ${top} 離眼皮太遠（最深的眼睛下緣是 ${EYE_BOTTOM_MAX}）`);
});

test('黑眼圈比眼睛略寬但不會外擴到頭髮或耳朵', async () => {
  const source = await overtimeFilterSource();
  const { width } = bagGeometry(source);
  const { front, side } = eyeBags(source);
  assert.ok(width > EYE_WIDTH, `黑眼圈寬 ${width} 應該比單眼 ${EYE_WIDTH} 寬一點`);
  for (const [, , , , centre] of [...front, ...side]) {
    const outer = Math.abs(centre) + width / 2;
    assert.ok(outer <= FACE_HALF_WIDTH, `黑眼圈外緣 ${outer} 超出臉頰 ${FACE_HALF_WIDTH}`);
  }
});

test('黑眼圈對齊每隻眼睛的中心', async () => {
  const source = await overtimeFilterSource();
  const { front, side } = eyeBags(source);
  assert.deepEqual(front.map(bag => bag[4]), [-11.5, 11], '正面兩團要各自對齊左右眼');
  assert.deepEqual(side.map(bag => bag[4]), [11], '側面只有一團，對齊朝右的那隻眼');
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

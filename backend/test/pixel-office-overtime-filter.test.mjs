import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const appJs = path.join(path.dirname(fileURLToPath(import.meta.url)), '../../archive/EMC-ART-Pixel-Office-2D/dist/app.js');

// 2026-10-17：貼圖黑眼圈＋鬼火（會因為每個人眼睛、頭大小不同而錯位）改成程式繪製的
// 舞台聚光＋整身冷色調＋三簇藍紫鬼火，位置只看腳底與身高比例，完全不碰臉。
// 整段特效程式：從快取宣告到 drawOvertimeTint 結束。
async function fxSource() {
  const source = await readFile(appJs, 'utf8');
  const start = source.indexOf('const overtimeFxCache=');
  const tint = source.indexOf('function drawOvertimeTint(');
  const tintEnd = source.indexOf('\n}', tint);
  assert.ok(start !== -1 && tint !== -1 && tintEnd !== -1, '找不到加班特效程式');
  return source.slice(start, tintEnd + 2);
}

test('舊的貼圖黑眼圈與鬼火已移除，也不再載入濾鏡圖', async () => {
  const source = await readFile(appJs, 'utf8');
  assert.doesNotMatch(source, /drawOvertimeFilter|ensureOvertimeSheet|overtimeSheet|EYE_PUPIL_BOTTOM/);
});

test('特效位置只用腳底與身高比例，不碰臉部幾何（眼睛位置、頭寬）', async () => {
  const fx = await fxSource();
  assert.doesNotMatch(fx, /geom\.|eyeY|faceW|wardrobeFrame\(index,'down'\)\.geom/);
});

test('效能：漸層只在建立快取時畫，每幀只 drawImage', async () => {
  const source = await readFile(appJs, 'utf8');
  const draw = source.slice(source.indexOf('function drawOvertimeFx('), source.indexOf('/** 整身冷色調'));
  assert.doesNotMatch(draw, /createRadialGradient|createLinearGradient|fillRect|ellipse/, '每幀不能再建漸層或逐點填色');
  assert.match(draw, /drawImage/);
  const fx = await fxSource();
  assert.match(fx, /overtimeFxCache\.get\(key\)/);
  assert.match(fx, /Math\.round\(H\/8\)\*8/, '要依身高 8px 一級快取');
});

test('不用 ctx.filter（iOS Safari 不支援），整身冷色調改用快取遮罩', async () => {
  const fx = await fxSource();
  assert.doesNotMatch(fx, /\.filter\s*=/);
  assert.match(fx, /frame\.overtimeTone/);
  assert.match(fx, /source-in/);
});

test('亮底（白色）與暗底用不同參數，且聚光有藍紫邊線才看得到', async () => {
  const fx = await fxSource();
  assert.match(fx, /light\?'rgba\(40,35,90,\.22\)':'rgba\(40,35,90,\.55\)'/);
  assert.match(fx, /strokeStyle='rgba\(120,110,255,\.55\)'/);
  assert.match(fx, /function overtimeFxLight\(/);
});

test('人物與頭像小框都用同一組特效：背景層在人物之前、前景鬼火在人物之後', async () => {
  const source = await readFile(appJs, 'utf8');
  const person = source.slice(source.indexOf('function drawPerson('), source.indexOf('function drawPunishBadge('));
  assert.ok(person.indexOf("'back'") !== -1 && person.indexOf("'front'") > person.indexOf("'back'"));
  assert.ok(person.indexOf("'back'") < person.indexOf('drawHeadphones(i,p,t,bob,nod,true)'), '聚光要在人物之前畫');
  const portrait = source.slice(source.indexOf('function portrait('), source.indexOf('function select('));
  assert.match(portrait, /drawOvertimeFx\(context,x,y,144,t,light,'back',true\)/);
  assert.match(portrait, /drawOvertimeFx\(context,x,y,144,t,light,'front',true\)/);
});

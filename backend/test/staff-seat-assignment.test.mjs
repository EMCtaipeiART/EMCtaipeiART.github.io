import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const source = await readFile(new URL('../../worker/src/database-coordinator.ts', import.meta.url), 'utf8');

test('right-side staff seats are pinned: 廖秦葦 1, 李明庭 2, empty 3, 吳冠賢 4 (migration 19)', () => {
  assert.match(source, /\[\['廖秦葦', 0\], \['李明庭', 1\], \['吳冠賢', 3\]\]/);
  assert.match(source, /\[4, 5, 2\]\.filter/);
  assert.match(source, /applied\.has\(19\)/);
});

test('final seating (migration 21): 3 鄭筱舢, 5 余采馨, 6 黎子瑄 reserved', () => {
  assert.match(source, /\['鄭筱舢', 2, ''\]/);
  assert.match(source, /\['余采馨', 4, 'cindy\.yu@emctaipei\.com'\]/);
  assert.match(source, /\['黎子瑄', 5, 'hsuan\.li@emctaipei\.com'\]/);
  assert.match(source, /applied\.has\(21\)/);
});

test('three desk groups per side: 18 staff seats, extra groups shifted up by 604 (view 497), canvas keeps 900px of headroom', async () => {
  assert.match(source, /PIXEL_OFFICE_STAFF_SEATS = 18/);
  assert.match(source, /PIXEL_OFFICE_MIN_Y = -1900/);
  assert.match(source, /Math\.floor\(seat \/ 6\) \* 604/);
  const app = await readFile(new URL('../../EMC-ART-Pixel-Office/dist/app.js', import.meta.url), 'utf8');
  assert.match(app, /GP=604[^,]*,GPV=497/);
  assert.match(app, /const staffStationIndex=seat=>/);
  // 四樓（?floor=4）的場景不收上排，viewY 直接回傳原座標；三樓維持原本的收攏算法。
  assert.match(app, /const viewY5=y=>\{if\(y>=90\)return viewY0\(y\);/);
});

test('layout 2026-10-19: seats 6 and 9 move 110 left (between the groups), left region widened (LX 300), office extras sheet', async () => {
  assert.match(source, /seat === 6 \|\| seat === 9 \? x - 55 : x/);
  assert.match(source, /applied\.has\(24\)/);
  const app = await readFile(new URL('../../EMC-ART-Pixel-Office/dist/app.js', import.meta.url), 'utf8');
  assert.match(app, /\?0:320\/\*/);
  assert.match(app, /stations\[18\]\.x-=55;stations\[21\]\.x-=55;/);
  assert.match(app, /office-extras-v2\.webp\?v=1/);
  assert.match(app, /white_desk_row:\[0,0,832,357\]/);
});

test('work hours come from the back-office setting (state.hours); overtime mask is overtimeStart..06:00', async () => {
  const app = await readFile(new URL('../../EMC-ART-Pixel-Office/dist/app.js', import.meta.url), 'utf8');
  assert.match(app, /let officeHours=\{dayStart:9,workEnd:19,overtimeStart:19\};/);
  assert.match(app, /clock\.hour>=officeHours\.overtimeStart\|\|clock\.hour<6/);
  assert.match(app, /c\.hour>=officeHours\.dayStart&&c\.hour<officeHours\.workEnd/);
  assert.match(source, /hours: \{ dayStart: pixelHours\.dayStart, workEnd: pixelHours\.workEnd, overtimeStart: pixelHours\.overtimeStart, force: pixelForceNow\(Date\.now\(\)\) \}/);
});

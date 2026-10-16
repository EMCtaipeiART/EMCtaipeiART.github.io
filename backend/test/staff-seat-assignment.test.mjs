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

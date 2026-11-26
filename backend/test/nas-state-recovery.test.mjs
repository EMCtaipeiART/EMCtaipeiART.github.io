import assert from 'node:assert/strict';
import { mkdtemp, readdir, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { loadState, saveState } from '../../scripts/nas_design_image_lib.mjs';

test('同步狀態檔壞掉時改用備份，沒有備份就從空白開始，不會讓備份一直失敗', async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'nas-state-'));
  try {
    const file = path.join(dir, 'sync-state.json');
    assert.deepEqual(await loadState(file), {});
    await saveState(file, { a: 1 });
    await writeFile(file, '');
    assert.deepEqual(await loadState(file), { a: 1 });
    assert.ok((await readdir(dir)).some(n => n.includes('.corrupt-')));
    await rm(`${file}.bak`);
    await writeFile(file, '{"a":');
    assert.deepEqual(await loadState(file), {});
    assert.ok(!(await readdir(dir)).some(n => n.includes('.tmp-')));
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

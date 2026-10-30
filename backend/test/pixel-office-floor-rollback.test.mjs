import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const source = fs.readFileSync(new URL('../../EMC-ART-Pixel-Office/dist/app.js', import.meta.url), 'utf8');

test('搭電梯離開四樓後，四樓頁面不再送位置更新（避免晚到的 floor:4 把人又標回四樓而回朔）', () => {
  const fn = source.slice(source.indexOf('function pushChange('), source.indexOf('function queuePosition('));
  assert.match(fn, /FLOOR4&&window\.__f4left&&patch&&!\('floor' in patch\)/);
  // 離開時送的那一筆是 floor:5，且不經過 pushChange，所以不會被擋掉
  const leave = source.slice(source.indexOf('function leaveFloor4('), source.indexOf('window.addEventListener(\'message\'', source.indexOf('function leaveFloor4(')));
  assert.match(leave, /syncCall\(\{action:'pixelOfficeUpdate'.*floor:5/s);
  assert.doesNotMatch(leave, /pushChange/);
});

test('五樓清掉「在四樓」標記時，自己已經走動過就不把人拉回電梯口', () => {
  const i = source.indexOf('回到五樓：清掉自己的「在四樓」標記');
  const block = source.slice(i - 700, i);
  assert.match(block, /moved=Date\.now\(\)-\(localMoveAt\.get\(oi\)\|\|0\)<20000/);
  assert.match(block, /if\(!moved\)\{q\.x=TX0\+75;/);
});

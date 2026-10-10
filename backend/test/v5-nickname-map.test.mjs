import { readSite } from './site-source.mjs';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

test('v5 稱呼對照: a per-user full name → nickname map in 個人設定 feeds {收件人名} in every reply path', async () => {
  const html = await readSite();
  const schema = await readFile(new URL('../schema.mjs', import.meta.url), 'utf8');
  assert.match(schema, /'深淺模式', '專案欄位順序', '稱呼對照'/, '設定表要有「稱呼對照」欄位');
  // 設定頁：區塊、新增／刪除、儲存、重複與空白檢查。
  assert.match(html, /data-set-sec="nicknames"/);
  assert.match(html, /data-set-save="nicknames"/);
  assert.match(html, /同一個全名只能設定一個稱呼/);
  assert.match(html, /每一筆對照都要同時填「全名」和「稱呼」/);
  assert.match(html, /settings=\{nicknameMap:rows\.map/);
  assert.match(html, /st2\.nicknames=normNicknames\(set\.nicknameMap\?\?set\['稱呼對照'\]\)/, '登入後從帳號設定讀回');
  // 套用：範本預設帶入（設計師回覆信、一般回信、修改需求信都走 greetingName）與手動「插入範本」。
  assert.equal((html.match(/greetingName\(/g) || []).length >= 4, true);
  assert.match(html, /nm=greetingName\(\(entryLabel\(first\)/);
  // 真的跑 greetingName：不分大小寫與空白、忽略信箱、沒對到維持原名、空值預設。
  const grab = re => html.match(re)?.[0];
  const src = [grab(/const nickKey=[^\n]*\n/), grab(/function greetingName\(n\)\{[\s\S]*?\n    \}\n/)].join('\n');
  const make = nicknames => new Function('st2', `${src}; return greetingName;`)({ nicknames });
  const greet = make([{ name: 'Lorraine Luo', nickname: 'Lorraine' }]);
  assert.equal(greet('Lorraine Luo'), 'Lorraine');
  assert.equal(greet('  LORRAINE   luo '), 'Lorraine');
  assert.equal(greet('Lorraine Luo <lorraine@example.com>'), 'Lorraine');
  assert.equal(greet('Andrew Koo'), 'Andrew Koo');
  assert.equal(greet(''), '設計負責人');
  assert.equal(make([])('Lorraine Luo'), 'Lorraine Luo', '沒設定對照時行為完全不變');
});

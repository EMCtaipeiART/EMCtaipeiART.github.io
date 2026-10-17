import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const source = await readFile(new URL('../../site.js', import.meta.url), 'utf8');
const grab = name => {
  const match = source.match(new RegExp(`    function ${name}\\([^\\n]*\\{[\\s\\S]*?\\n    \\}`));
  assert.ok(match, `找不到 ${name}`);
  return match[0];
};
const helpers = ['esc', 'norm', 'initial', 'headImg'].map(name => {
  const line = source.split('\n').find(line => line.startsWith(`    const ${name}=`) || line.startsWith(`    function ${name}(`));
  assert.ok(line, `找不到 ${name}`);
  return line;
}).join('\n');
const { people, card } = new Function(`
  const DESIGNERS=['Anna','Machi','Leona'],SHORT_HEADS=new Set(['Machi']);
  const pixImg=()=>'',personAvatar=()=>'';
  const state={dragOn:false},schedule=()=>({late:false,percent:50}),statusOf=r=>({cls:'st-review',label:r['狀態']}),idKey=r=>r['案件編號'];
  const typeClass=()=>'',shortRange=()=>'',barStyle=()=>'',revisionCount=()=>0,hasPendingMod=()=>false;const modBtnHtml=()=>'';
  ${helpers}
  ${grab('faceHtml')}
  ${grab('cardPeopleHtml')}
  ${grab('cardHtml')}
  return {people:cardPeopleHtml,card:cardHtml};
`)();
const render = (owner, designer) => people({ '專案負責人': owner, '設計負責人': designer });
const count = html => (html.match(/class="card-person"/g) || []).length;

test('卡牌：兩位負責人各有角色、姓名、完整 title，沿用原頭像', () => {
  const html = render('王小明', 'Anna');
  assert.equal(count(html), 2);
  assert.match(html, /card-person-role">專案<\/span><span class="card-person-name" title="王小明">王小明/);
  assert.match(html, /card-person-role">設計<\/span><span class="card-person-name" title="Anna">Anna/);
  assert.match(html, /class="face" title="專案負責人：王小明"/);
  assert.match(html, /class="face is-designer" title="設計負責人：Anna"/);
  assert.match(html, /src="assets\/v5\/heads\/Anna.webp" alt=""/);
});

test('卡牌：空值與分隔符不產生空標籤或問號頭像', () => {
  assert.equal(render(undefined, null), '');
  assert.equal(render('  ', '，、, '), '');
  for (const html of [render('王小明', ''), render('', 'Anna')]) {
    assert.equal(count(html), 1);
    assert.doesNotMatch(html, /未填|>\?</);
  }
});

test('卡牌：同一人兼任只顯示一次，忽略姓名前後空白與大小寫', () => {
  const html = render(' Machi ', 'Machi, machi');
  assert.equal(count(html), 1);
  assert.match(html, /card-person-role">專案＋設計<\/span>/);
  assert.match(html, /card-person-name" title="Machi">Machi<\/span>/);
  assert.match(html, /class="face is-designer"/);
});

test('卡牌：多人逗號／全形逗號／頓號保留全名、去重，兼任者不重複出現', () => {
  const html = render('Machi', ' Anna, Machi、Leona，Anna ');
  assert.equal(count(html), 2);
  assert.match(html, /card-person-name" title="Machi">Machi<\/span>/);
  assert.match(html, /card-person-name" title="Anna、Leona">Anna、Leona<\/span>/);
  assert.doesNotMatch(html, /title="Anna、Machi/);
});

test('卡牌：長名字不在資料層截斷，文字與 title 安全跳脫', () => {
  const name = '很長的專案負責人名字'.repeat(8) + '<img src=x>"&\'';
  const html = render(name, 'Anna、Leona、Machi');
  assert.match(html, /&lt;img src=x&gt;&quot;&amp;&#39;/);
  assert.doesNotMatch(html, /<img src=x>/);
  assert.ok(html.includes('很長的專案負責人名字'.repeat(8)));
  assert.match(html, /title="Anna、Leona、Machi"/);
});

test('首頁與專案欄 cardHtml 都顯示負責人，保留右側數量及修改紀錄', () => {
  const row = { '案件編號': 'preview-01', '專案名稱': '測試案件', '專案負責人': '王小明', '設計負責人': 'Anna', '狀態': '過稿中', '數量': '12' };
  for (const inColumn of [false, true]) {
    const html = card(row, inColumn);
    assert.equal(count(html), 2);
    assert.match(html, /class="faces card-people"/);
    assert.match(html, /class="card-qty">數量 12<\/span>/);
    assert.match(html, /data-rev-open="preview-01"/);
    assert.match(html, />初稿<\/button>/);
  }
});

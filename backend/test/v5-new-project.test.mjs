import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const site = await readFile(new URL('../../site.js', import.meta.url), 'utf8');
const worker = await readFile(new URL('../../worker/src/database-coordinator.ts', import.meta.url), 'utf8');
const schema = await readFile(new URL('../../backend/schema.mjs', import.meta.url), 'utf8');
const grab = name => {
  const match = site.match(new RegExp(`    function ${name}\\([^\\n]*\\{[\\s\\S]*?\\n    \\}`));
  assert.ok(match, `找不到 ${name}`);
  return match[0];
};
const DAY = 86400000;
const holidays = new Set(['2026-10-09', '2026-10-10']);
const tags = new Function(`
  const DAY=${DAY},TL_HOLIDAYS=new Map([...${JSON.stringify([...holidays])}].map(d=>[d,'假']));
  const ymd=ms=>{const d=new Date(ms);return d.getUTCFullYear()+'/'+String(d.getUTCMonth()+1).padStart(2,'0')+'/'+String(d.getUTCDate()).padStart(2,'0')};
  const parseDay=v=>{const m=String(v||'').match(/(\\d{4})[\\/\\-.](\\d{1,2})[\\/\\-.](\\d{1,2})/);return m?Date.UTC(+m[1],+m[2]-1,+m[3]):NaN};
  const rangeDays=(s,e)=>{if(Number.isNaN(s)||Number.isNaN(e))return 0;let n=0;for(let ms=s;ms<=e;ms+=DAY){const wd=new Date(ms).getUTCDay();if(wd!==0&&wd!==6&&!TL_HOLIDAYS.has(ymd(ms).replace(/\\//g,'-')))n++}return n};
  ${grab('projTagsHtml')}
  return projTagsHtml;
`)();

test('專案名稱前的小標籤：新專案✨、急件🔥（上班天數少於 3 天）', () => {
  const base = { '狀態': '執行中', '開始日期': '2026/11/02', '結束日期': '2026/11/10' };
  assert.equal(tags(base), '');
  assert.match(tags({ ...base, '新專案': 'v' }), /新專案✨/);
  assert.match(tags({ ...base, '結束日期': '2026/11/03' }), /急件🔥/);   // 週一到週二：2 個上班天
  assert.doesNotMatch(tags({ ...base, '結束日期': '2026/11/04' }), /急件/); // 3 個上班天不算急件
  assert.match(tags({ ...base, '開始日期': '2026/11/06', '結束日期': '2026/11/09' }), /急件🔥/); // 週五到週一：跨週末只算 2 個上班天
  assert.doesNotMatch(tags({ ...base, '狀態': '已完成', '結束日期': '2026/11/03' }), /急件/);
  const both = tags({ ...base, '結束日期': '2026/11/03', '新專案': 'v' });
  assert.ok(both.indexOf('新專案') < both.indexOf('急件'));
  assert.equal(tags({ '狀態': '執行中' }), '');
});

test('新專案：填單頁有開關，輪替／替代設計師跟著這一列的 newProj，送出時帶 newProject', () => {
  assert.match(site, /if\(!r\.newProj\)\{r\.rot='';r\.sub='';r\.subReason='';continue\}/);
  assert.match(site, /const payloadRow=r=>\(\{newProject:Boolean\(r\.newProj\),client:r\.client,/);
  assert.match(site, /data-f="newProj"/);
  assert.match(site, /data-np-reason=/);
  assert.match(site, /csState\.pickedAsNew=true;\$\('prompt'\)\.requestSubmit\(\)/);
  assert.match(site, /state\.startAsNew=Boolean\(csState\.pickedAsNew\)/);
  assert.match(site, /<h3 class="card-title">\$\{projTagsHtml\(row\)\}/);
});

test('後端：新專案案件寫入「新專案」欄，輪替把實際接案的人排到最後', () => {
  assert.match(worker, /const isNewProject = Boolean\(text\(source\.expectedDesigner\)\);/);
  assert.match(worker, /if \(isNewProject\) row\['新專案'\] = 'v';/);
  assert.match(worker, /const reordered = \[\.\.\.ranked\.slice\(0, consumed\), \.\.\.ranked\.slice\(consumed \+ 1\), ranked\[consumed\]\];/);
  assert.match(schema, /'客戶確認時間', '新專案'/);
});

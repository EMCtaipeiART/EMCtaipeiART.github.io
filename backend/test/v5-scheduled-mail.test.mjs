import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

test('v5 case board and mail page can find, edit and cancel pending scheduled mail', async () => {
  const html = await readFile(new URL('../../index.html', import.meta.url), 'utf8');
  // 資料來源：跨案件的待寄出排程清單，列表在案件旁標出「已排程」。
  assert.match(html, /api\('listPendingScheduledMail'\)/);
  assert.ok(html.includes('lt-act-sched') && html.includes('data-row-act=') && html.includes('已排程'));
  assert.match(html, /else if\(a==='sched'\)openSchedPage\(id\)/);
  // 已排程清單頁：編輯／取消。
  assert.match(html, /else if\(view==='sched'\)renderSchedPage\(\)/);
  assert.match(html, /api\('cancelScheduledMail',\{id:sid\}\)/);
  assert.match(html, /api\('getScheduledMail',\{id:sid\}\)/);
  // 編輯＝更新原本那筆排程（不是另建一筆），而且編輯中不能改成立即寄出或另外排程。
  assert.match(html, /api\('updateScheduledMail',\{id:d\.editSchedId,\.\.\.base,subject:d\.reply\?'':d\.subject,scheduledAt:toIso\(d\.scheduledAt\)\}\)/);
  const sendCurrent = html.match(/async function sendCurrent\(\)\{[\s\S]*?\n    \}\n/)?.[0];
  assert.ok(sendCurrent, 'could not locate sendCurrent');
  assert.ok(sendCurrent.indexOf('updateScheduledMail') < sendCurrent.indexOf("api('scheduleCaseReply'"), '編輯分支要先於建立排程');
  assert.match(html, /d\.editSchedId\?'儲存排程修改'/);
  assert.match(html, /d\.editSchedId\?'':'<button type="button" class="btn" data-mail="schedule-clear">/);
  // 排程成功後的提示要說明去哪裡找回（之前被 finishMail 的提示蓋掉，根本沒人看到）。
  assert.match(html, /要修改或取消，請到案件列表該案件旁的「已排程」按鈕/);
  assert.match(html, /else\{finishMail\(\);if\(d\.scheduledDone\)toast\(schedMsg\)\}/);
});

test('v5 new-request form offers 送出並排程寄信, which opens the mail page with the schedule time already expanded; the mail action bar stays visible', async () => {
  const html = await readFile(new URL('../../index.html', import.meta.url), 'utf8');
  assert.match(html, /id="submitScheduleBtn" data-act="submit-schedule"/);
  assert.match(html, /if\(act==='submit-schedule'\)\{submitForm\(\{schedule:true\}\);return\}/);
  assert.match(html, /startMail\(drafts,\{schedule:Boolean\(opts\.schedule\)\}\)/);
  assert.match(html, /function startMail\(drafts,\{schedule=false\}=\{\}\)\{\s*state\.mail=\{drafts:drafts\.map\(d=>\(\{scheduleOpen:schedule,/);
  assert.match(html, /\.page \.mail-actions\{position:sticky;bottom:0/);
  assert.match(html, /<div class="form-actions mail-actions">/);
});

test('v5 schedule picker offers one-click presets, date plus hour/minute selects and a live summary, and refuses past times', async () => {
  const html = await readFile(new URL('../../index.html', import.meta.url), 'utf8');
  assert.match(html, /function schedulePickerHtml\(d\)/);
  assert.match(html, /data-sch-chip=/);
  assert.match(html, /id="mSchDate"/);
  assert.match(html, /<input type="hidden" id="mSchedule"/, '既有的 saveMailDraft 仍從 #mSchedule 讀值');
  assert.match(html, /'今天 17:00'/);
  assert.match(html, /'下週一 09:00'/);
  assert.match(html, /schedSummary\(d\.scheduledAt\)\.cls==='warn'\)\{toast\(/, '送出前擋下過去或太近的時間');
  // 純函式：摘要文字與過去時間判斷（用真的函式跑，星期與相對日期要對）。
  const grab = name => html.match(new RegExp(`const ${name}=[^\\n]*\\n`))?.[0] || html.match(new RegExp(`function ${name}\\([\\s\\S]*?\\n    \\}\\n`))?.[0];
  const src = ['SCH_WEEK', 'taipeiNowLocal', 'schFake', 'schedSummary'].map(grab).join('\n');
  const summary = new Function(`${src}; return schedSummary;`)();
  assert.equal(summary('').cls, 'empty');
  assert.equal(summary('2020-01-01T09:00').cls, 'warn');
  const future = summary('2099-01-05T14:30');
  assert.equal(future.cls, '');
  assert.match(future.text, /2099\/01\/05（週一）14:30 寄出/);
});

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

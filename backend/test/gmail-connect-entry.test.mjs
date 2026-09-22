import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const indexHtml = () => readFile(path.join(path.dirname(fileURLToPath(import.meta.url)), '../../index.html'), 'utf8');

// Gmail 授權原本只能從案件列表某一列的「發信」選單進去。那顆按鈕要案件符合條件才會出現，
// 所以手上沒有可發信案件的人就完全沒有入口（使用者回報「只有串接沒有操作」）。
// 帳號選單這個入口跟案件狀態無關，任何有發信權限的人都能自己重新授權。
test('帳號選單有固定的 Gmail 授權入口', async () => {
  const html = await indexHtml();
  const dropdown = html.slice(html.indexOf('<div class="account-dropdown"'), html.indexOf('</div>', html.indexOf('<div class="account-dropdown"')));
  assert.match(dropdown, /<button type="button" id="accountGmailConnect" role="menuitem">連接 Gmail／更新授權<\/button>/,
    '帳號選單要有這個入口');
  assert.match(html, /show\('#accountGmailConnect',loggedIn&&!isLocalPreviewToken\(\)&&accessAllowed\('request\.mail',true\)\)/,
    '登入且有發信權限才顯示');
  assert.match(html, /\$\('#accountGmailConnect'\)\?\.addEventListener\('click',\(\)=>\{closeAccountMenu\(\); startGmailConnectPopup\(\)\}\)/,
    '點了要開授權視窗');
});

test('授權流程仍然要有發信權限，而且範圍含行事曆', async () => {
  const html = await indexHtml();
  // 這個入口只是換個地方進去，權限檢查沒有被繞過。
  assert.match(html, /async function startGmailConnectPopup\(\)\{\s*if\(!requireAccess\('request\.mail'/);
  // 重新授權的重點就是要把行事曆範圍帶上去，否則 freeBusy 會一直回 403。
  assert.match(html, /scope:'email[^']*https:\/\/www\.googleapis\.com\/auth\/calendar\.freebusy'/);
});

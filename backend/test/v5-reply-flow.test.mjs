import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

test('v5 designer reply source chooser: only same-path / NAS / the original computer uploader (no second "computer images" path, no NAS re-tracking row)', async () => {
  const site = await readFile(new URL('../../site.js', import.meta.url), 'utf8');
  // 使用者決定：電腦上傳還要再補一次 NAS 路徑只是更複雜，拿掉「電腦圖片／拖曳進信件」這個來源與信件上方的追蹤列。
  assert.doesNotMatch(site, /data-dr-src="local"/);
  assert.doesNotMatch(site, /電腦圖片／拖曳進信件/);
  assert.doesNotMatch(site, /drPickLocal|drAddLocalImages|drLocalInput|drAutoTrack|data-mail="dr-track"|data-mail="dr-pick"/);
  assert.doesNotMatch(site, /trackOnly/);
  assert.match(site, /data-dr-src="same"/);
  assert.match(site, /data-dr-src="nas"/);
  assert.match(site, /data-dr-src="upload"><span>選擇電腦檔案上傳<\/span>/);
  // 保留：來源選單預設焦點在第一個選項、記住「不同步圖片」勾選。
  assert.match(site, /localStorage\.getItem\('drSkipPref'\)==='1'/);
  assert.match(site, /document\.querySelector\('#drBody \[data-dr-src\]'\)/);
  // 保留：拖曳／貼上到信件的圖片自動縮小（最長邊 1600px、GIF 例外）。
  assert.match(site, /async function shrinkMailImage\(file\)/);
  assert.match(site, /Math\.min\(1,1600\/Math\.max\(w,h\)\)/);
  assert.match(site, /file\.type==='image\/gif'\)return null/);
  assert.match(site, /file\.size>40\*1024\*1024/);
  // 設計師回覆信的圖片佔位文字回到原樣（備份期間才有「上傳中」）。
  assert.match(site, /function drPlaceholders\(dr\)\{return `<div id="v5DrImages"><span class="dr-up">/);
  assert.match(site, /fileFolders:\{\},pending:true\}/);
});

test('picker keeps the track-only mode and the file-name locate endpoint (server side, available but not wired into the page)', async () => {
  const picker = await readFile(new URL('../../scripts/nas_folder_picker_server.mjs', import.meta.url), 'utf8');
  assert.match(picker, /requestedMode === 'track' \? 'track'/);
  const track = picker.match(/if\(mode === 'track'\)\{\n      if\(!foldersToSubmit[\s\S]*?return;\n    \}/)?.[0];
  assert.ok(track, 'could not locate the track branch');
  assert.match(track, /trackOnly: true/);
  assert.doesNotMatch(track, /fetch\(/);
  assert.match(picker, /url\.pathname === '\/api\/locate'\) \{\n      if \(requestToken\(url\) !== pickerToken\)/);
});

test('v5 designer reply: with preview images in the mail the send button is no longer blocked by the Drive backup, and the post-send bookkeeping waits for it', async () => {
  const site = await readFile(new URL('../../site.js', import.meta.url), 'utf8');
  assert.match(site, /const drBlock=Boolean\(d\.dr&&d\.dr\.pending&&!\(d\.dr\.early&&d\.dr\.early\.size\)\)/);
  assert.match(site, /\$\{\(!g\?\.connected\|\|m\.sending\|\|d\.sent\|\|drBlock\)\?' disabled':''\}/);
  assert.match(site, /drLive\.get\(`\$\{id\}\|\$\{round\}`\)/);
  assert.match(site, /for\(let i=0;i<360&&d\.dr\.pending;i\+\+\)await new Promise\(r=>setTimeout\(r,500\)\)/);
  const finish = site.indexOf('async function drFinish');
  assert.ok(site.indexOf('dr.pending=false;drLive.delete', finish) > finish);
});

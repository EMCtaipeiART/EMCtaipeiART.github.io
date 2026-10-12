import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

test('v5 designer reply source chooser: same-path / NAS / 電腦上傳 (NAS-outage fallback); no auto-opened NAS window, and a manual 補上 NAS 路徑 entry is always available', async () => {
  const site = await readFile(new URL('../../site.js', import.meta.url), 'utf8');
  // 沒有第二條「電腦圖片／拖曳進信件」來源，也不會在電腦上傳後自動跳出 NAS 視窗。
  assert.doesNotMatch(site, /data-dr-src="local"/);
  assert.doesNotMatch(site, /電腦圖片／拖曳進信件/);
  assert.doesNotMatch(site, /drPickLocal|drAddLocalImages|drLocalInput|drAutoTrack|data-mail="dr-pick"/);
  assert.match(site, /data-dr-src="same"/);
  assert.match(site, /data-dr-src="nas"/);
  // 舊的電腦檔案上傳改名「電腦上傳」，說明它是 NAS 中斷時的備援、不記錄 NAS 路徑、可事後補。
  assert.match(site, /data-dr-src="upload"><span>電腦上傳<\/span><small>NAS 連線中斷、選擇器沒開時的備援/);
  assert.doesNotMatch(site, /選擇電腦檔案上傳/);
  // 隨時補上 NAS 路徑的窗口：案件詳情頁＋設計師回覆信編輯器，都走選擇器的 track 模式（只記錄、不備份）。
  assert.match(site, /function nasTrackOpen\(id,round\)/);
  assert.match(site, /nasOpen\(\{id,round:round\|\|0,mode:'track',afterReply:false\}\)/);
  assert.match(site, /data-act=\\"nas-track\\"|data-act=\"nas-track\"|data-act="nas-track"/);
  assert.match(site, /if\(act==='nas-track'\)\{nasTrackOpen\(/);
  assert.match(site, /data-mail=\\"dr-track\\"|data-mail="dr-track"/);
  assert.match(site, /if\(mail==='dr-track'\)\{const d=state\.mail\.drafts\[state\.mail\.index\];saveMailDraft\(\);nasTrackOpen\(/);
  assert.match(site, /if\(data\.trackOnly\)\{\s*if\(!ok\.some\(f=>String\(f\.path\|\|''\)\.trim\(\)\)\)\{toast\('請先點進要追蹤的資料夾',true\);return\}\s*saveCaseNas\(id,ok\);/);
  // 保留：來源選單預設焦點、記住「不同步圖片」、拖曳／貼上圖片自動縮小。
  assert.match(site, /localStorage\.getItem\('drSkipPref'\)==='1'/);
  assert.match(site, /async function shrinkMailImage\(file\)/);
  assert.match(site, /Math\.min\(1,1600\/Math\.max\(w,h\)\)/);
  assert.match(site, /function drPlaceholders\(dr\)\{return `<div id="v5DrImages"><span class="dr-up">/);
});

test('picker track-only mode records the path without any backup (used by the 補上 NAS 路徑 entries), and keeps the file-name locate endpoint', async () => {
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

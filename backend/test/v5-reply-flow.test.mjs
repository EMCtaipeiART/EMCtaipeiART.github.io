import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

test('v5 designer reply: computer images / drag-and-drop go straight into the mail, shrunk, and are backed up to 修改紀錄 on send', async () => {
  const site = await readFile(new URL('../../site.js', import.meta.url), 'utf8');
  // 來源選單：新增「電腦圖片／拖曳進信件」，舊的 Apps Script 上傳頁改名保留（影片要用）；預設焦點在第一個選項；記住「不同步圖片」勾選。
  assert.match(site, /data-dr-src="local"><span>電腦圖片／拖曳進信件<\/span>/);
  assert.match(site, /電腦上傳（含影片，較慢）/);
  assert.match(site, /localStorage\.getItem\('drSkipPref'\)==='1'/);
  assert.match(site, /document\.querySelector\('#drBody \[data-dr-src\]'\)/);
  // 本機模式沒有「圖片上傳中」佔位文字（不然會被寄出），也不擋寄出。
  assert.match(site, /if\(dr\.local\)return `<div id="v5DrImages"><br><\/div>/);
  assert.match(site, /pending:!opts\.local,local:Boolean\(opts\.local\)/);
  // 放進信件的圖先縮到 1600px（GIF 例外），上限放寬到 40 MB 來源。
  assert.match(site, /async function shrinkMailImage\(file\)/);
  assert.match(site, /Math\.min\(1,1600\/Math\.max\(w,h\)\)/);
  assert.match(site, /file\.type==='image\/gif'\)return null/);
  assert.match(site, /file\.size>40\*1024\*1024/);
});

test('v5 designer reply: NAS path can be recorded for tracking without any backup, from any image source', async () => {
  const site = await readFile(new URL('../../site.js', import.meta.url), 'utf8');
  const picker = await readFile(new URL('../../scripts/nas_folder_picker_server.mjs', import.meta.url), 'utf8');
  assert.match(site, /data-mail="dr-track"/);
  assert.match(site, /mode:'track',afterReply:false,names:d\.dr&&d\.dr\.localFiles,auto:true/);
  assert.match(site, /if\(data\.trackOnly&&!ok\.some\(f=>String\(f\.path\|\|''\)\.trim\(\)\)\)\{toast\('請先點進要追蹤的資料夾',true\);return\}/);
  assert.match(picker, /requestedMode === 'track' \? 'track'/);
  // track 模式：不呼叫 /api/confirm、不備份，只把路徑與關鍵字丟回主頁。
  const track = picker.match(/if\(mode === 'track'\)\{\n      if\(!foldersToSubmit[\s\S]*?return;\n    \}/)?.[0];
  assert.ok(track, 'could not locate the track branch');
  assert.match(track, /trackOnly: true/);
  assert.doesNotMatch(track, /fetch\(/);
  assert.ok(picker.indexOf("if(mode === 'track'){\n      if(!foldersToSubmit") < picker.indexOf("fetch('/api/confirm'"), 'track 分支必須在呼叫 /api/confirm 之前');
});

test('v5 designer reply: with preview images in the mail the send button is no longer blocked by the Drive backup, and the post-send bookkeeping waits for it', async () => {
  const site = await readFile(new URL('../../site.js', import.meta.url), 'utf8');
  assert.match(site, /const drBlock=Boolean\(d\.dr&&d\.dr\.pending&&!\(d\.dr\.early&&d\.dr\.early\.size\)\)/);
  assert.match(site, /\$\{\(!g\?\.connected\|\|m\.sending\|\|d\.sent\|\|drBlock\)\?' disabled':''\}/);
  // 寄出後備份尚未完成：等 drFinish（透過 drLive 登記，就算信件已寄出也找得到）才做輪次確認。
  assert.match(site, /drLive\.get\(`\$\{id\}\|\$\{round\}`\)/);
  assert.match(site, /for\(let i=0;i<360&&d\.dr\.pending;i\+\+\)await new Promise\(r=>setTimeout\(r,500\)\)/);
  const finish = site.indexOf('async function drFinish');
  assert.ok(site.indexOf('dr.pending=false;drLive.delete', finish) > finish);
});

test('v5 local image source: the file dialog is bound to a persistent input (not the re-rendered mail page), images are written into the draft, and NAS tracking is located from the file names', async () => {
  const site = await readFile(new URL('../../site.js', import.meta.url), 'utf8');
  const picker = await readFile(new URL('../../scripts/nas_folder_picker_server.mjs', import.meta.url), 'utf8');
  // 事故原因：自動在信件頁的 input 上開選檔視窗，信件頁隨後重畫、input 被換掉，選好的圖就掉了。
  assert.match(site, /const drLocalInput=\(\(\)=>\{const i=document\.createElement\('input'\);i\.type='file'[\s\S]*?document\.body\.appendChild\(i\)/);
  assert.match(site, /function drPickLocal\(ctx\)\{state\.drLocal=ctx;drLocalInput\.value='';drLocalInput\.click\(\)\}/);
  assert.doesNotMatch(site, /setTimeout\(\(\)=>\{drPlaceCaret\(\);try\{\$\('mImgInput'\)/, '不可再自動在信件頁的 input 上開選檔視窗');
  assert.match(site, /else if\(src==='local'\)drPickLocal\(\{mode:'start',id,round,folders:/);
  assert.match(site, /await startReply\(ctx\.id,'designer',\{round:ctx\.round,skip:false,folders:ctx\.folders,local:true\}\);d=await drWaitDraft\(ctx\.id,ctx\.round\)/);
  // 圖片寫進草稿本身，且信件串讀完重畫前先存編輯內容。
  assert.match(site, /async function drAddLocalImages\(d,files\)/);
  assert.match(site, /if\(state\.view==='mail'&&state\.mail\)\{saveMailDraft\(\);renderMail\(\)\}/);
  // NAS 追蹤只在使用者按「指定 NAS 路徑」時才開視窗（會依檔名自動找）。
  assert.doesNotMatch(site, /drAutoTrack/, '電腦上傳完不可再自動跳出 NAS 視窗（使用者明確要求拿掉）');
  assert.doesNotMatch(site, /quiet:true/);
  assert.match(site, /names:d\.dr&&d\.dr\.localFiles,auto:true/);
  assert.match(site, /for\(const k of \['mode','path','keyword','folders','names','auto'\]\)/);
  // 選擇器：/api/locate（驗 token）＋頁面在 track 模式帶 names 時自動找資料夾、預填關鍵字、全數命中才自動記錄。
  assert.match(picker, /url\.pathname === '\/api\/locate'\) \{\n      if \(requestToken\(url\) !== pickerToken\)/);
  assert.match(picker, /lib\.locateFolderByFiles\(mountRoot, guess\.relPath, files/);
  assert.match(picker, /autoRecord = params\.get\('auto'\) === '1' && best\.count === data\.total && Boolean\(data\.keyword\)/);
  assert.match(picker, /await loadDir\(initialPath\);\n    if\(autoRecord\) await doConfirm\(\);/);
});

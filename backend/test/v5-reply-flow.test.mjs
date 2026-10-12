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
  assert.match(site, /else if\(src==='local'\)startReply\(id,'designer',\{round,skip:false,folders:\(reuse\|\|\[\]\)\.map\(i=>i\.path\),local:true\}\)/);
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
  assert.match(site, /nasOpen\(\{id:d\.id,round:d\.dr\?d\.dr\.round:0,mode:'track',afterReply:false\}\)/);
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

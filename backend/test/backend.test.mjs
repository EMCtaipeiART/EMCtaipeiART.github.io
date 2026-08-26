import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { JsonDatabase } from '../json_database.mjs';
import { emptyDatabase, normalizeDatabaseShape, publicSystemAnnouncement, stringifyDatabaseForStorage, systemAnnouncementReadRecords } from '../schema.mjs';
import { calculateWeight } from '../weighting.mjs';
import { createApp } from '../app.mjs';
import { parseCsv } from '../import_google_sheets.mjs';
import { mergeUserDirectory, USER_DIRECTORY } from '../../scripts/migrate_user_directory_to_settings.mjs';

async function fixture(appOptions = {}) {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'machi-json-backend-'));
  const dbPath = path.join(dir, 'db.json');
  const database = await new JsonDatabase(dbPath, { backupDir: path.join(dir, 'backups'), maxBackups: 5 }).init();
  await database.transaction(draft => {
    draft.tables['設定'].rows.push({
      '部門': '設計部', '組別': '平面', '名字': 'Machi', '顯示名': 'Machi',
      '帳號': 'machi.chen@emctaipei.com', '頭像連結': 'https://example.com/avatar.jpg', '深淺模式': '淺色'
    });
    draft.tables.reels.rows.push({
      '名字': 'Machi', '限時動態連結': 'https://lh3.googleusercontent.com/d/reel-file=w1600', '按讚': '', '倒讚': '', '留言': '[]'
    });
  }, 'test fixture');
  const { server } = await createApp({ database, rootDir: dir, loginPassword: 'secret', ...appOptions });
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
  const address = server.address();
  const baseUrl = `http://127.0.0.1:${address.port}`;
  return {
    dir, dbPath, database, server, baseUrl,
    async close() {
      await new Promise(resolve => server.close(resolve));
      await rm(dir, { recursive: true, force: true });
    }
  };
}

async function api(baseUrl, action, payload = {}) {
  const response = await fetch(`${baseUrl}/api`, {
    method: 'POST', headers: { 'Content-Type': 'text/plain;charset=UTF-8' }, body: JSON.stringify({ action, ...payload })
  });
  assert.equal(response.status, 200);
  return response.json();
}

async function request(baseUrl, pathname, { method = 'GET', token = '', body } = {}) {
  const response = await fetch(`${baseUrl}${pathname}`, {
    method,
    headers: { ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}), ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    ...(body !== undefined ? { body: JSON.stringify(body) } : {})
  });
  const data = await response.json();
  return { response, data };
}

test('CSV parser preserves commas, quotes and embedded newlines', () => {
  const rows = parseCsv('a,b,c\n1,"two,2","line 1\nline 2"\n3,"say ""hi""",4\n');
  assert.deepEqual(rows, [
    ['a', 'b', 'c'],
    ['1', 'two,2', 'line 1\nline 2'],
    ['3', 'say "hi"', '4']
  ]);
});

test('database storage compacts formatting without changing any JSON value', () => {
  const database = emptyDatabase();
  database.tables.database.rows.push({
    '案件編號': '26080001',
    '專案名稱': '保留「引號」、換行\n與空欄位',
    '客戶別': '',
    '數量': null
  });
  database.internal.idempotency['request-test'] = {
    ok: true,
    action: 'append',
    row: { id: '26080001', client: '' }
  };

  const pretty = `${JSON.stringify(database, null, 2)}\n`;
  const compact = stringifyDatabaseForStorage(database);

  assert.deepEqual(JSON.parse(compact), database);
  assert.ok(Buffer.byteLength(compact) < Buffer.byteLength(pretty));
  assert.match(compact, /    \{"案件編號":"26080001"/);
  assert.match(compact, /    "request-test": \{"ok":true/);
});

test('404 short redirects use the small static JSON index before Apps Script fallback', async () => {
  const root = path.resolve(import.meta.dirname, '..', '..');
  const page = await readFile(path.join(root, '404.html'), 'utf8');
  const index = JSON.parse(await readFile(path.join(root, 'data', 'short_link_index.json'), 'utf8'));
  assert.match(page, /loadResolverIndex/);
  assert.match(page, /index\.shortLinks\[code\]/);
  assert.match(page, /index\.supplements\[id\]\[slot\]/);
  assert.equal(index.shortLinks['2Vnj7J'], 'https://www.youtube.com/watch?v=qrCrAJyjvmQ&ab_channel=LIONS%7CTheHomeofCreativity');
  assert.equal(index.supplements['26080033'].a, 'https://docs.google.com/presentation/d/13Tzjb_21pPMIjUbQDfU4pGxgXMfP5giOdxvllRe3qHI/edit?usp=sharing');
});

test('item details calculate weights from the scoring table only after selection', () => {
  assert.equal(calculateWeight({ type: '平面', stage: '後製', qty: 4, details: '' }), null);
  assert.equal(calculateWeight({ type: '平面', stage: '後製', qty: 2, details: '素材重置' }), 1);
  assert.equal(calculateWeight({ type: '平面', stage: '後製', qty: 4, details: '廣告素材, 急件' }), 12);
  assert.equal(calculateWeight({ type: '平面', stage: '後製', qty: 8, details: '急件' }), 0);
  assert.equal(calculateWeight({ type: '平面', stage: '後製', qty: 1, details: '2D 動畫' }), 2);
  assert.equal(calculateWeight({ type: '影音', stage: '後製', qty: 1, details: '2D 動畫' }), 1);
  assert.equal(calculateWeight({ type: '影音', stage: '後製', qty: 1, details: '影音剪輯, 人聲配樂, 字幕字卡' }), 3);
});

test('database modification stats are derived from the modification table', () => {
  const database = emptyDatabase();
  database.tables.database.rows.push(
    { '案件編號': '26080001', '狀態': '過稿中', '修改次數': '', '繳交時間': '' },
    { '案件編號': '26080002', '修改次數': '', '繳交時間': '2026/07/01' }
  );
  database.tables['修改統計表'].rows.push(
    { '案件編號': '26080001', '修改次數': '0', '建立日期': '2026/08/13 09:15:20' },
    { '案件編號': '26080001', '修改次數': '1', '建立日期': '2026/08/13 10:00:00' },
    { '案件編號': '26080001', '修改次數': '2', '建立日期': '2026/08/13 11:00:00' },
    { '案件編號': '26080002', '修改次數': '1', '建立日期': '2026/08/13 12:00:00' }
  );

  normalizeDatabaseShape(database);

  const first = database.tables.database.rows[0];
  const legacy = database.tables.database.rows[1];
  assert.equal(first['修改次數'], '2');
  assert.equal(first['繳交時間'], '2026/08/13 09:15:20');
  assert.equal(legacy['修改次數'], '1');
  assert.equal(legacy['繳交時間'], '2026/07/01');
  assert.equal(database.tables.database.headers.indexOf('修改次數'), database.tables.database.headers.indexOf('狀態') - 1);
});

test('system announcement defaults to v4.7 and only exposes the latest enabled version', () => {
  const database = emptyDatabase();
  assert.ok(database.tables['系統公告欄'].headers.includes('已讀紀錄'));
  assert.equal(publicSystemAnnouncement(database).version, 'v4.7');
  assert.match(publicSystemAnnouncement(database).content, /Gmail/);
  assert.doesNotMatch(publicSystemAnnouncement(database).content, /[📢🎉✉📝💬🖼👥⚙🔔🚀]/u);
  database.tables['系統公告欄'].rows[0]['公告內容'] = '# 📢 舊版系統預設公告';
  normalizeDatabaseShape(database);
  assert.doesNotMatch(publicSystemAnnouncement(database).content, /[📢🎉✉📝💬🖼👥⚙🔔🚀]/u);
  database.tables['系統公告欄'].rows.push({ '公告版本': 'v4.8', '公告標題': '下一版', '公告內容': '新公告', '是否啟用': '停用' });
  assert.equal(publicSystemAnnouncement(database).version, 'v4.7');
  database.tables['系統公告欄'].rows.at(-1)['是否啟用'] = '啟用';
  assert.equal(publicSystemAnnouncement(database).version, 'v4.8');
  database.tables['系統公告欄'].rows[0]['已讀紀錄'] = JSON.stringify([{ account: 'USER@EMCTAIPEI.COM', name: '使用者', readAt: '2026/08/20 10:00:00' }]);
  normalizeDatabaseShape(database);
  assert.deepEqual(systemAnnouncementReadRecords(database.tables['系統公告欄'].rows[0]), [{ account: 'user@emctaipei.com', name: '使用者', readAt: '2026/08/20 10:00:00' }]);
});

test('system announcement keeps only the header megaphone and centers its circular close button', async () => {
  const html = await readFile(new URL('../../index.html', import.meta.url), 'utf8');
  assert.match(html, /system-announcement-icon[^>]*>📢<\/span>/);
  assert.match(html, /\.system-announcement-icon\{[^}]*background:transparent/);
  assert.match(html, /\.system-announcement-close\{[^}]*display:grid!important;place-items:center!important;[^}]*border-radius:50%!important/);
});

test('front end initializes weight rules before normalizing cached database rows', async () => {
  const html = await readFile(new URL('../../index.html', import.meta.url), 'utf8');
  assert.ok(
    html.indexOf('let activeWeightRules=[];') < html.indexOf("let rows = (sanitizedCachedRows?.length"),
    'activeWeightRules must be initialized before normalizeRow reads cached rows'
  );
});

test('new-case copy modal replaces the final action with a red Gmail account link', async () => {
  const html = await readFile(new URL('../../index.html', import.meta.url), 'utf8');
  assert.match(html, /nextBtn\.textContent=isLast\?'gmail帳號連結':'下一封'/);
  assert.match(html, /nextBtn\.classList\.toggle\('gmail-btn-danger',isLast\)/);
  assert.match(html, /\.gmail-btn-primary\.gmail-btn-danger\{background:var\(--red\)!important/);
  assert.match(html, /if\(queue\.index>=queue\.drafts\.length-1\)\{startGmailConnectPopup\(\);return\}/);
});

test('Gmail thread collapses older messages and expands only the latest message by default', async () => {
  const html = await readFile(new URL('../../index.html', import.meta.url), 'utf8');
  assert.match(html, /function gmailThreadMessageHtml\(message,isLatest=false\)/);
  assert.match(html, /<details class="gmail-thread-msg" name="gmail-thread-message"\$\{isLatest\?' open':''\}>/);
  assert.match(html, /items\.map\(\(message,index\)=>gmailThreadMessageHtml\(message,index===items\.length-1\)\)/);
  assert.match(html, /gmail-thread-msg-toggle::after\{content:'展開'\}/);
  assert.match(html, /gmail-thread-msg\[open\] \.gmail-thread-msg-toggle::after\{content:'收合'\}/);
});

test('Gmail thread displays names only and keeps email addresses in name tooltips', async () => {
  const html = await readFile(new URL('../../index.html', import.meta.url), 'utf8');
  const start = html.indexOf('function gmailAddressPeople(');
  const end = html.indexOf('function gmailThreadMessageHtml(', start);
  assert.ok(start > 0 && end > start);
  const source = html.slice(start, end);
  const escapeHtml = value => String(value).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  const renderNames = new Function('esc', `${source};return gmailAddressNamesHtml;`)(escapeHtml);
  const rendered = renderNames('"David Chen" <david@example.com>, Allen <allen@example.com>');
  assert.equal(rendered.replace(/<[^>]+>/g, ''), 'David Chen、Allen');
  assert.match(rendered, /title="david@example\.com"/);
  assert.match(rendered, /aria-label="David Chen，Email：david@example\.com"/);
  assert.doesNotMatch(rendered.replace(/<[^>]+>/g, ''), /@example\.com/);
  assert.equal(renderNames('david.lee@example.com').replace(/<[^>]+>/g, ''), 'David Lee');
  const messageRenderer = html.match(/function gmailThreadMessageHtml\(message,isLatest=false\)\{[^\n]*\}/)?.[0] || '';
  assert.match(messageRenderer, /gmailAddressNamesHtml\(message\.from\)/);
  assert.match(messageRenderer, /gmailAddressNamesHtml\(message\.to\)/);
  assert.match(messageRenderer, /gmailAddressNamesHtml\(message\.cc\)/);
});

test('Gmail reply composer displays the current account as sender instead of the original thread owner', async () => {
  const html = await readFile(new URL('../../index.html', import.meta.url), 'utf8');
  const start = html.indexOf('async function openGmailThreadModal(id');
  const end = html.indexOf('function closeGmailThreadModal()', start);
  assert.ok(start > 0 && end > start);
  const source = html.slice(start, end);
  assert.match(source, /initialReplyFrom=gmailConnectionState\.gmailAddress\|\|currentEditorAccount/);
  assert.match(source, /replyFrom=String\(data\.replyFrom\|\|gmailConnectionState\.gmailAddress\|\|currentEditorAccount/);
  assert.match(source, /recipientName=gmailRecipientGreetingName\('gmailThreadTo'\)\|\|'收件人'/);
  assert.match(source, /setGmailEditorPlainText\(replyEditor,`Hi \$\{recipientName\},\\n\\n\$\{generalReplyTemplate\}`\)/);
  assert.match(source, /replyEditor\.innerHTML===initialGeneralReplyHtml/);
  assert.doesNotMatch(source, /fromValue\.textContent=row\.gmailThreadOwnerAccount/);
});

test('designer reply can reuse the saved NAS path and only attaches the selected modification round', async () => {
  const html = await readFile(new URL('../../index.html', import.meta.url), 'utf8');
  const pickerServer = await readFile(new URL('../../scripts/nas_folder_picker_server.mjs', import.meta.url), 'utf8');
  assert.match(html, /data-source="same-nas"><span>同上次路徑<\/span>/);
  assert.match(html, /function reuseLastNasFolder\(id,round,\{afterReply=false\}=\{\}\)/);
  assert.match(html, /mode:'reuse',path:row\.designImageFolderUrl,keyword:row\.designImageFolderKeyword\|\|''/);
  assert.match(pickerServer, /requestedMode === 'reuse'/);
  assert.match(pickerServer, /if\(mode === 'reuse'\)\{/);
  assert.match(pickerServer, /await doConfirm\(\)/);

  const imageSelectorSource = html.match(/function designerReplyImagesForRound\(id,round\)\{[\s\S]*?\n\}/)?.[0] || '';
  const selectImages = new Function('modificationRecordsFor', `${imageSelectorSource};return designerReplyImagesForRound;`)(() => [
    { count: 0, images: [{ fileName: 'draft.jpg', url: 'https://example.test/draft' }] },
    { count: 1, images: [{ fileName: 'revision.jpg', url: 'https://example.test/revision' }] }
  ]);
  assert.deepEqual(selectImages('26080119', 1), [{ fileName: 'revision.jpg', url: 'https://example.test/revision' }]);
  assert.equal(selectImages('26080119', 1).some(image => image.fileName === 'draft.jpg'), false);

  const designerReplyStart = html.indexOf("async function openDesignerReplyMailModal(id");
  const designerReplyEnd = html.indexOf('function applyDesignerReplyImages(', designerReplyStart);
  const designerReplySource = html.slice(designerReplyStart, designerReplyEnd);
  assert.match(designerReplySource, /gmailRecipientGreetingName\('gmailThreadTo'\)/);
  assert.doesNotMatch(designerReplySource, /lastMessage\?\.from|senderName/);
});

test('Gmail editors wait for pasted images before immediate or scheduled send', async () => {
  const html = await readFile(new URL('../../index.html', import.meta.url), 'utf8');
  assert.match(html, /const gmailInlineImageTasksByEditor=new Map\(\)/);
  assert.match(html, /function queueGmailInlineImages\(editorId,fileList\)/);
  assert.match(html, /async function waitForGmailInlineImages\(editorId\)/);
  assert.match(html, /event\.clipboardData\?\.items\|\|\[\]/);
  assert.match(html, /filter\(item=>item\.kind==='file'\)\.map\(item=>item\.getAsFile\(\)\)\.filter\(file=>file&&file\.type\.startsWith\('image\/'\)\)/);
  for (const functionName of ['sendGmailComposeModal', 'scheduleComposeMail', 'scheduleThreadReply', 'sendGmailThreadReply']) {
    const start = html.indexOf(`async function ${functionName}(`);
    const nextFunction = html.indexOf('\nfunction ', start + 1);
    const nextAsyncFunction = html.indexOf('\nasync function ', start + 1);
    const ends = [nextFunction, nextAsyncFunction].filter(index => index > start);
    const end = ends.length ? Math.min(...ends) : html.length;
    const source = html.slice(start, end);
    assert.ok(start > 0, `${functionName} should exist`);
    assert.match(source, /await waitForGmailInlineImages\(editor\.id\)/, `${functionName} should await pasted images`);
  }
});

test('Gmail editors show the connected account signature by default without appending it twice', async () => {
  const html = await readFile(new URL('../../index.html', import.meta.url), 'utf8');
  assert.match(html, /gmailSignatureLoadPromise/);
  assert.match(html, /function resetGmailSignatureCache\(\)/);
  assert.match(html, /if\(gmailSignatureLoadPromise\)return gmailSignatureLoadPromise/);
  assert.match(html, /if\(generation!==gmailSignatureLoadGeneration\)return appendDefaultGmailSignature\(editor\)/);
  assert.match(html, /async function appendDefaultGmailSignature\(editor\)/);
  assert.match(html, /無法顯示個人簽名檔/);
  assert.match(html, /目前連接的 Gmail 帳號沒有設定個人簽名檔/);
  assert.match(html, /editor\.querySelector\('\[data-gmail-inserted-signature\]'\)/);
  assert.match(html, /editor\.append\(document\.createElement\('br'\),document\.createElement\('br'\),signature\)/);
  assert.match(html, /function gmailPreparedBodySignature\(bodyHtml,automaticSignatureHtml=''\)/);
  assert.match(html, /signatureHtml:signatureInserted\?'':automaticSignatureHtml/);
  assert.match(html, /scheduledBodyHtml:prepared\.scheduledBodyHtml/);
  assert.match(html, /insertedSignatureHtml:prepared\.insertedSignatureHtml/);
  assert.match(html, /\.gmail-inserted-signature\{all:revert;display:block;max-width:100%;overflow-x:auto;overflow-y:hidden\}/);
  assert.match(html, /\.gmail-inserted-signature \*\{all:revert\}/);
  assert.match(html, /\.gmail-inserted-signature td::before,\.gmail-inserted-signature th::before\{content:none!important;display:none!important\}/);
  assert.match(html, /function gmailEditorTextWithoutInsertedSignature\(editor\)/);
  assert.match(html, /stripGreetingPrefix\(gmailEditorTextWithoutInsertedSignature\(editor\)\)/);
  assert.equal((html.match(/if\(!gmailEditorTextWithoutInsertedSignature\(editor\)\.trim\(\)&&!editorPayload\.inlineImages\.length\)/g) || []).length, 2);
  assert.match(html, /const signature=editor\.querySelector\('\[data-gmail-inserted-signature\]'\)/);
  assert.match(html, /if\(signature\)\{range\.setStartBefore\(signature\);range\.collapse\(true\)\}/);
  assert.match(html, /\.gmail-rich-editor\{min-height:260px;max-height:520px\}/);
  assert.match(html, /#gmailThreadReplyEditor\.gmail-rich-editor\{min-height:180px;max-height:380px\}/);
  for (const functionName of ['renderPostSubmitGmailDraft', 'openGmailComposeModal', 'openGmailThreadModal', 'openModificationRequestReplyModal', 'openDesignerReplyMailModal']) {
    const start = html.indexOf(`${functionName === 'renderPostSubmitGmailDraft' ? '' : 'async '}function ${functionName}(`);
    const nextFunction = html.indexOf('\nfunction ', start + 1);
    const nextAsyncFunction = html.indexOf('\nasync function ', start + 1);
    const ends = [nextFunction, nextAsyncFunction].filter(index => index > start);
    const end = ends.length ? Math.min(...ends) : html.length;
    const source = html.slice(start, end);
    assert.ok(start > 0, `${functionName} should exist`);
    assert.match(source, /appendDefaultGmailSignature\(editor|appendDefaultGmailSignature\(replyEditor/, `${functionName} should show the signature in the editor`);
  }
  for (const functionName of ['sendGmailComposeModal', 'sendGmailThreadReply']) {
    const start = html.indexOf(`async function ${functionName}(`);
    const nextFunction = html.indexOf('\nfunction ', start + 1);
    const nextAsyncFunction = html.indexOf('\nasync function ', start + 1);
    const ends = [nextFunction, nextAsyncFunction].filter(index => index > start);
    const end = ends.length ? Math.min(...ends) : html.length;
    const source = html.slice(start, end);
    assert.match(source, /editorPayload\.signatureInserted\?'':automaticSignatureHtml/, `${functionName} should suppress automatic signature when the default signature is already in the body`);
  }
  for (const functionName of ['scheduleComposeMail', 'scheduleThreadReply']) {
    const start = html.indexOf(`async function ${functionName}(`);
    const nextFunction = html.indexOf('\nfunction ', start + 1);
    const nextAsyncFunction = html.indexOf('\nasync function ', start + 1);
    const ends = [nextFunction, nextAsyncFunction].filter(index => index > start);
    const end = ends.length ? Math.min(...ends) : html.length;
    const source = html.slice(start, end);
    assert.match(source, /editorPayload\.signatureInserted\?editorPayload\.insertedSignatureHtml:automaticSignatureHtml/, `${functionName} should store the signature separately from the scheduled body`);
    assert.match(source, /bodyHtml:editorPayload\.scheduledBodyHtml|bodyHtml=editorPayload\.scheduledBodyHtml/, `${functionName} should send the signature-free scheduled body`);
  }
  const batchStart = html.indexOf('async function handlePostSubmitGmailSend()');
  const batchEnd = html.indexOf('\nfunction closePostSubmitCopyModal()', batchStart);
  assert.match(html.slice(batchStart, batchEnd), /gmailPreparedBodySignature\(bodyHtml,signatureHtml\)/);
});

test('a manual "insert signature" button lets users pick between the Gmail account\'s multiple send-as signatures, in both the compose and reply/thread editors', async () => {
  const html = await readFile(new URL('../../index.html', import.meta.url), 'utf8');
  // 按鈕本身要在發信（gmailComposeEditor）與回信（gmailThreadReplyEditor，涵蓋一般回信／填寫修改需求信／
  // 設計師回覆信三種模式，三者共用同一個編輯器）兩個工具列都要有。
  assert.match(html, /class="gmail-rich-signature-btn" data-rich-signature-for="gmailThreadReplyEditor" title="插入簽名檔"/);
  assert.match(html, /class="gmail-rich-signature-btn" data-rich-signature-for="gmailComposeEditor" title="插入簽名檔"/);
  assert.match(html, /document\.querySelectorAll\('\[data-rich-signature-for\]'\)\.forEach\(button=>button\.addEventListener\('click',event=>openGmailSignaturePicker\(event,button\.dataset\.richSignatureFor\)\)\)/);
  // 選單資料來源：ensureGmailSignatureLoaded() 現在除了既有的單一 signature（自動帶入用），
  // 也要把 Worker 回傳的 signatures 陣列（Gmail 帳號設定的所有傳送郵件地址各自的簽名檔）存起來，
  // 供選單使用，而且要是同一次 API 呼叫，不能另外多打一次。
  assert.match(html, /gmailSignatureOptions=options/);
  assert.match(html, /options=Array\.isArray\(data\.signatures\)\?data\.signatures:\[\]/);
  const requestStart = html.indexOf('const request=(async()=>{');
  const requestEnd = html.indexOf('return signatureHtml', requestStart);
  assert.ok(requestStart > 0 && requestEnd > requestStart);
  assert.equal((html.slice(requestStart, requestEnd).match(/sheetApi\('getGmailSignature'/g) || []).length, 1, 'loading the signature list must reuse the same getGmailSignature request as the automatic default, not a second call');
  const pickerStart = html.indexOf('async function openGmailSignaturePicker(event,editorId)');
  const pickerEnd = html.indexOf('\nfunction ', pickerStart + 1);
  assert.ok(pickerStart > 0);
  const pickerSource = html.slice(pickerStart, pickerEnd);
  assert.match(pickerSource, /await ensureGmailSignatureLoaded\(\)/);
  assert.match(pickerSource, /insertChosenGmailSignature\(editor,option\.html\)/);
  // 選單要合併兩種來源：使用者在個人設定自建的命名簽名檔（例如「休假」）與 Gmail 帳號本身的簽名檔，
  // 不能只顯示其中一種——這正是回應「休假會設定不同簽名檔，可以將 Gmail 設定好的簽名檔也加入進來」。
  assert.match(pickerSource, /combinedSignatureOptions\(\)/);
  assert.match(pickerSource, /groupHtml\('自訂簽名檔',custom,0\)/);
  assert.match(pickerSource, /groupHtml\('Gmail 帳號簽名檔',gmail,custom\.length\)/);
  // 選一個新的簽名檔要能取代掉編輯器裡原本那份（不管是自動帶入還是先前手動選過的），不是插入變成兩份。
  const insertStart = html.indexOf('function insertChosenGmailSignature(editor,signatureHtml)');
  const insertEnd = html.indexOf('\nfunction ', insertStart + 1);
  assert.ok(insertStart > 0);
  const insertSource = html.slice(insertStart, insertEnd);
  assert.match(insertSource, /editor\.querySelector\('\[data-gmail-inserted-signature\]'\)/);
  assert.match(insertSource, /removeGmailSignatureNodeAndSpacing\(existing\)/);
  assert.match(insertSource, /appendGmailSignatureHtml\(editor,signatureHtml\)/);
});

test('custom named signature presets (e.g. "休假" vs "正常") sit in personal settings, merge into the picker alongside the Gmail account signature, and win as the auto-inserted default', async () => {
  const html = await readFile(new URL('../../index.html', import.meta.url), 'utf8');
  // 個人設定要有獨立的「簽名檔設定」區塊：命名輸入框、設為預設的單選鈕、內容 contenteditable 富文字區塊、
  // 刪除鈕、新增按鈕。內容欄位不再是 textarea（純文字），改成支援貼上/編輯格式的 contenteditable div。
  assert.match(html, /id="personalSignaturePresetList"/);
  assert.match(html, /id="personalSignaturePresetAdd"/);
  assert.match(html, /data-signature-preset-name/);
  assert.match(html, /data-signature-preset-default/);
  assert.match(html, /class="signature-preset-content" data-signature-preset-content contenteditable="true"/);
  assert.doesNotMatch(html, /<textarea data-signature-preset-content/, '簽名檔內容欄位不該再是純文字 textarea，否則貼上格式化內容會被壓成純文字');
  assert.match(html, /data-remove-signature-preset/);
  // 每一列的內容欄位上方要有工具列：粗體／對齊／文字大小／文字顏色，讓使用者不用依賴外部工具先排好版
  // 再貼過來，這裡本身就能調整格式——直接對應「沒有可以編輯文字大小顏色功能」這個回報。
  const rowHtmlStart = html.indexOf("function signaturePresetRowHtml(name='',content='',index=0,{defaultKey=''}={}){");
  const rowHtmlEnd = html.indexOf('\nfunction syncSignaturePresetRows', rowHtmlStart);
  assert.ok(rowHtmlStart > 0 && rowHtmlEnd > rowHtmlStart);
  const rowHtmlSource = html.slice(rowHtmlStart, rowHtmlEnd);
  assert.match(rowHtmlSource, /class="gmail-rich-toolbar signature-preset-toolbar"/);
  assert.match(rowHtmlSource, /data-rich-cmd="bold"/);
  assert.match(rowHtmlSource, /data-rich-cmd="justifyLeft"/);
  assert.match(rowHtmlSource, /data-rich-cmd="justifyCenter"/);
  assert.match(rowHtmlSource, /data-rich-cmd="justifyRight"/);
  assert.match(rowHtmlSource, /class="gmail-rich-size-btn" data-rich-size title="文字大小"/);
  assert.match(rowHtmlSource, /class="gmail-rich-color-btn" title="文字顏色"/);
  assert.match(rowHtmlSource, /\$\{resolveSignaturePresetHtml\(content\)\}/, '初始內容要用 resolveSignaturePresetHtml 轉換，不能直接把 content 塞進 innerHTML（未逃脫過的舊版純文字資料會被當成標籤解析）');

  // bindSignaturePresetEditor 要用事件委派掛在 list 容器上（不是頁面載入當下的一次性 querySelectorAll），
  // 因為簽名檔列是動態新增/刪除的；粗體/對齊靠 document.execCommand()，文字大小/顏色是彈出選單、要在
  // mousedown 階段先存下選取範圍供稍後還原，兩者都跟既有 Gmail 撰寫/回信編輯器工具列共用同一套機制。
  const bindStart = html.indexOf('function bindSignaturePresetEditor(list){');
  const bindEnd = html.indexOf('\n/** 送出前驗證', bindStart);
  assert.ok(bindStart > 0 && bindEnd > bindStart);
  const bindSource = html.slice(bindStart, bindEnd);
  assert.match(bindSource, /list\.addEventListener\('mousedown'/);
  assert.match(bindSource, /list\.addEventListener\('click'/);
  assert.match(bindSource, /document\.execCommand\(cmdButton\.dataset\.richCmd\)/);
  assert.match(bindSource, /openGmailSizePalette\(sizeButton\)/);
  assert.match(bindSource, /openGmailColorPalette\(colorButton\)/);
  assert.match(bindSource, /savedRichSelectionRange=captureCurrentRichSelection\(\)/);

  // normalizeSignaturePresetSettings 是純函式：去除空白名稱/內容、限制筆數與長度、預設值一定要落在既有名稱內。
  const normalizeStart = html.indexOf('function normalizeSignaturePresetSettings(value,defaultValue');
  const normalizeEnd = html.indexOf('\nfunction ', normalizeStart + 1);
  assert.ok(normalizeStart > 0);
  const normalize = new Function(`${html.slice(normalizeStart, normalizeEnd)};return normalizeSignaturePresetSettings;`)();
  assert.deepEqual(normalize({ '正常': 'Machi Chen<br>EMC 設計組', '休假': '目前休假中', '': '空名稱應該被濾掉' }, '休假'), {
    presets: { '正常': 'Machi Chen<br>EMC 設計組', '休假': '目前休假中' }, defaultName: '休假'
  });
  assert.equal(normalize({ 'A': '內容' }, '不存在的名稱').defaultName, 'A');

  // resolveSignaturePresetHtml 要能分辨兩種年代的資料：①舊版（純文字年代）存的內容完全沒有標籤，只有
  // 字面上的換行字元，要先轉成 <br> 分行的安全 HTML（沿用既有的 signaturePlainTextToHtml，逃脫特殊字元）；
  // ②新版（contenteditable 年代）存的內容本身就是真正的 HTML（例如貼上排版好的簽名檔會帶顏色/字級的
  // inline style），必須原封不動使用，絕對不能再逃脫一次，否則格式化內容會變成一整串看得到標籤符號的
  // 純文字——這正是這次要修正的「貼過來變成純文字檔案，格式都跑版」的根因與驗證重點。
  const escStart = html.indexOf('function esc(s){');
  const escEnd = html.indexOf('\n', escStart);
  const plainTextStart = html.indexOf('function signaturePlainTextToHtml(text){');
  const plainTextEnd = html.indexOf('\n', plainTextStart);
  const looksLikeStart = html.indexOf('function looksLikeSignatureHtml(value){');
  const looksLikeEnd = html.indexOf('\n', looksLikeStart);
  const resolveStart = html.indexOf('function resolveSignaturePresetHtml(content){');
  const resolveEnd = html.indexOf('\n', resolveStart);
  assert.ok(escStart > 0 && plainTextStart > 0 && looksLikeStart > 0 && resolveStart > 0);
  const resolveHtml = new Function(
    `${html.slice(escStart, escEnd)};${html.slice(plainTextStart, plainTextEnd)};${html.slice(looksLikeStart, looksLikeEnd)};${html.slice(resolveStart, resolveEnd)};return resolveSignaturePresetHtml;`
  )();
  assert.equal(resolveHtml('第一行 & 特殊符號\n第二行'), '第一行 &amp; 特殊符號<br>第二行', 'plain text without real tags must go through the legacy plain-text-to-HTML upgrade path');
  const formattedSignature = '<div style="text-align:center"><b style="font-size:20px;color:#cc0000">Machi Chen</b><br><span style="color:#666">EMC 設計組</span></div>';
  assert.equal(resolveHtml(formattedSignature), formattedSignature, 'already-HTML content from the rich editor must pass through untouched, not be re-escaped into visible tag text');

  // combinedSignatureOptions() 要同時列出自訂簽名檔與 Gmail 帳號簽名檔，不能只顯示其中一種——
  // 這正是使用者要求「休假會設定不同簽名檔，可以將 Gmail 設定好的簽名檔也加入進來」的核心行為。
  const combinedStart = html.indexOf('function combinedSignatureOptions(){');
  const combinedEnd = html.indexOf('\nasync function appendDefaultGmailSignature', combinedStart);
  assert.ok(combinedStart > 0 && combinedEnd > combinedStart);
  const combinedHarness = new Function(
    'currentAccountSignaturePresets', 'currentAccountSignaturePresetDefault', 'gmailSignatureOptions',
    `${html.slice(escStart, escEnd)};${html.slice(plainTextStart, plainTextEnd)};${html.slice(looksLikeStart, looksLikeEnd)};${html.slice(resolveStart, resolveEnd)};function currentUserSignaturePresetSettings(){return {presets:currentAccountSignaturePresets||{},defaultName:currentAccountSignaturePresetDefault||''}};${html.slice(combinedStart, combinedEnd)};return combinedSignatureOptions();`
  );
  const combined = combinedHarness(
    { '正常': 'Machi Chen', '休假': formattedSignature }, '休假',
    [{ email: 'machi@emctaipei.com', displayName: 'Machi Chen (Gmail)', isPrimary: true, signature: 'Gmail 內建簽名' }]
  );
  assert.equal(combined.custom.length, 2);
  assert.deepEqual(combined.custom.find(item => item.label === '休假'), { source: 'custom', label: '休假', sublabel: '', isDefault: true, html: formattedSignature });
  assert.equal(combined.gmail.length, 1);
  assert.equal(combined.gmail[0].label, 'Machi Chen (Gmail)');
  assert.equal(combined.gmail[0].html, 'Gmail 內建簽名');
  // 有自訂簽名檔時，Gmail 帳號本身的「預設」標記不該搶著顯示，避免使用者誤以為 Gmail 那份才是真正會自動帶入的。
  assert.equal(combined.gmail[0].isDefault, false);

  // appendDefaultGmailSignature 要優先使用自訂的預設簽名檔（不必等待 Gmail API），
  // 只有完全沒有設定過任何自訂簽名檔時才 fallback 用 Gmail 帳號本身的簽名檔（既有行為）。
  const appendStart = html.indexOf('async function appendDefaultGmailSignature(editor){');
  const appendEnd = html.indexOf('\nfunction insertChosenGmailSignature', appendStart);
  assert.ok(appendStart > 0 && appendEnd > appendStart);
  const appendSource = html.slice(appendStart, appendEnd);
  assert.match(appendSource, /const presetHtml=defaultSignaturePresetHtml\(\);/);
  assert.match(appendSource, /if\(presetHtml\)\{/);
  assert.match(appendSource, /await ensureGmailSignatureLoaded\(\)/, 'must still fall back to the Gmail-account signature when no custom preset is configured');

  // collectSignaturePresetEditor 的空白/超長驗證要有可視化回饋——內容欄位是 contenteditable，沒有
  // setCustomValidity()/reportValidity() 這兩個表單專屬 API，必須改用紅框 class + 提示訊息取代。
  const collectStart = html.indexOf('function collectSignaturePresetEditor(list){');
  const collectEnd = html.indexOf('\n}\n', collectStart);
  assert.ok(collectStart > 0 && collectEnd > collectStart);
  const collectSource = html.slice(collectStart, collectEnd);
  assert.match(collectSource, /markSignaturePresetContentInvalid\(contentEl,true\)/);
  assert.match(collectSource, /content\.length>SIGNATURE_PRESET_CONTENT_MAX_LENGTH/);
  assert.match(collectSource, /setSync\(`「\$\{name\}」內容過長/);
});

test('signature preset content is excluded from the global table/th/td styling, and visually aligns with the mail-template box above it', async () => {
  const html = await readFile(new URL('../../index.html', import.meta.url), 'utf8');
  // 全站有一條把 table/th/td 強制統一成單一字級/顏色/字重的規則（原本是給一般資料表格用的），這條規則
  // 2026-08-18 那次已經因為同一種理由排除過 .gmail-rich-editor（見信件內容編輯區的簽名檔顯示）——這次
  // 簽名檔設定的內容欄位（.signature-preset-content）也要比照排除，貼上的簽名檔如果本身是 <table> 排版
  // （常見的名片式雙欄簽名檔），格子裡各自設計的字級/顏色/粗細才不會被這條規則整批壓成同一種樣式。
  assert.match(html, /table:not\(\.gmail-rich-editor table\):not\(\.signature-preset-content table\)/);
  assert.match(html, /th:not\(\.gmail-rich-editor th\):not\(\.signature-preset-content th\)/);
  assert.match(html, /td:not\(\.gmail-rich-editor td\):not\(\.signature-preset-content td\)/);

  // 全站的 <textarea> 另外有一條獨立規則把圓角統一成 24px（比一般表單元件的 10px 更圓潤），信件範本
  // 區塊的內容欄位就是 <textarea>，會吃到這條規則；簽名檔內容欄位改成 contenteditable 的 <div> 之後
  // 不會自動繼承這條規則（只認 textarea 這個標籤），需要明確補上同樣的圓角＋內距，兩個堆疊在一起的方塊
  // 視覺上才會對齊，不會一個是大圓角、一個是小圓角。
  const textareaRuleStart = html.indexOf('    textarea,\n');
  const textareaRuleEnd = html.indexOf('\n    }', textareaRuleStart);
  assert.ok(textareaRuleStart > 0 && textareaRuleEnd > textareaRuleStart, 'expected the shared 24px textarea/panel border-radius rule to still exist');
  assert.match(html.slice(textareaRuleStart, textareaRuleEnd + 6), /border-radius:24px!important;/);
  const contentRuleStart = html.indexOf('.signature-preset-content{');
  const contentRuleEnd = html.indexOf('}', contentRuleStart);
  assert.ok(contentRuleStart > 0);
  const contentRule = html.slice(contentRuleStart, contentRuleEnd + 1);
  assert.match(contentRule, /border-radius:24px!important/);
  assert.match(contentRule, /padding:7px 10px/, '內距要跟全站 input/select/textarea 的基礎內距一致，才能跟上方的信件範本 textarea 真正對齊');
});

test('scheduled-mail results cannot leak from a previously opened case into the current mail modal', async () => {
  const html = await readFile(new URL('../../index.html', import.meta.url), 'utf8');
  const start = html.indexOf('async function refreshScheduledMailList(caseId,kind)');
  const end = html.indexOf('async function cancelScheduledMailItem(', start);
  assert.ok(start > 0 && end > start);
  const source = html.slice(start, end);
  assert.match(source, /container\.dataset\.caseId=String\(caseId\)/);
  assert.match(source, /modal\?\.dataset\.caseId\|\|''\)===String\(caseId\)/);
  assert.match(source, /if\(!stillCurrent\(\)\)return/);
});

test('pending scheduled mail can be loaded back into the editor and updates the original schedule', async () => {
  const html = await readFile(new URL('../../index.html', import.meta.url), 'utf8');
  assert.match(html, /class="gmail-scheduled-item-edit"[^>]*>編輯<\/button>/);
  assert.match(html, /id="gmailComposeScheduledEditBanner"/);
  assert.match(html, /id="gmailThreadScheduledEditBanner"/);
  const editStart = html.indexOf('async function editScheduledMailItem(');
  const editEnd = html.indexOf('function renderScheduledMailList(', editStart);
  assert.ok(editStart > 0 && editEnd > editStart);
  const editSource = html.slice(editStart, editEnd);
  assert.match(editSource, /sheetApi\('getScheduledMail'/);
  assert.match(editSource, /restoreScheduledGmailInlineImages\(ui\.editor,item\.inlineImages\|\|\[\]\)/);
  assert.match(editSource, /gmailLegacyScheduledDraftParts\(bodyHtml,knownSignatureHtml\)/);
  assert.match(editSource, /appendGmailSignatureHtml\(ui\.editor,signatureHtml\)/);
  assert.match(editSource, /ui\.scheduleButton\.textContent='儲存排程修改'/);
  assert.match(editSource, /ui\.sendButton\.disabled=true/);

  const updateStart = html.indexOf('async function updateScheduledMailFromEditor(');
  const updateEnd = html.indexOf('async function scheduleComposeMail(', updateStart);
  assert.ok(updateStart > 0 && updateEnd > updateStart);
  const updateSource = html.slice(updateStart, updateEnd);
  assert.match(updateSource, /sheetApi\('updateScheduledMail'/);
  assert.match(updateSource, /id:state\.id/);
  assert.match(updateSource, /signatureHtml=editorPayload\.signatureInserted\?editorPayload\.insertedSignatureHtml:''/);
  assert.match(updateSource, /bodyHtml:editorPayload\.scheduledBodyHtml/);
  assert.doesNotMatch(updateSource, /scheduleCaseMail|scheduleCaseReply/);
  assert.match(html, /if\(scheduledMailEditState\?\.kind===kind\)await updateScheduledMailFromEditor\(kind,scheduledAt\)/);
});

test('Gmail thread restores safe labeled hyperlinks in the plain-text preview', async () => {
  const html = await readFile(new URL('../../index.html', import.meta.url), 'utf8');
  const start = html.indexOf('function safeHttpPreviewUrl(');
  const end = html.indexOf('function gmailThreadMessageImagesHtml(', start);
  assert.ok(start > 0 && end > start);
  const source = html.slice(start, end);
  const escapeHtml = value => String(value).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  const linkify = new Function('esc', `${source};return linkifyPlainText;`)(escapeHtml);
  const rendered = linkify('A. 設計簡報：P26~P30', [{ text: 'P26~P30', url: 'https://example.com/design-brief#p26' }]);
  assert.match(rendered, /<a href="https:\/\/example\.com\/design-brief#p26" target="_blank" rel="noopener noreferrer">P26~P30<\/a>/);
  assert.doesNotMatch(linkify('危險連結', [{ text: '危險連結', url: 'javascript:alert(1)' }]), /<a\b/);
});

test('customer admin keeps scroll position, front end follows saved order, and organization rules stay dynamic', async () => {
  const adminHtml = await readFile(new URL('../../json_database_admin.html', import.meta.url), 'utf8');
  const selectStart = adminHtml.indexOf('function selectCustomer(');
  const selectEnd = adminHtml.indexOf('async function saveCustomer(', selectStart);
  const selectSource = adminHtml.slice(selectStart, selectEnd);
  assert.match(selectSource, /currentEditor\.replaceWith\(nextEditor\)/);
  assert.doesNotMatch(selectSource, /renderTable\(/);
  assert.match(adminHtml, /CUSTOMER_DEFAULT_OWNER_RULES=\['department:企劃部','department:設計部'\]/);
  assert.match(adminHtml, /value:`department:\$\{name\}`/);
  assert.match(adminHtml, /value:`group:\$\{name\}`/);

  const customerEntriesStart = adminHtml.indexOf('function customerPersonGroupInfo(');
  const customerEntriesEnd = adminHtml.indexOf('/** 尚未設定權限時預選', customerEntriesStart);
  const customerEntriesSource = adminHtml.slice(customerEntriesStart, customerEntriesEnd);
  const customerEntries = new Function('permissionModelsCache', 'MachiAccess', 'organizationOptions', 'ACCOUNT_DESIGNER_OPTIONS', `${customerEntriesSource};return {customerDepartmentEntries,customerDesignerEntries};`)(
    [{ '帳號': 'person@example.com', '狀態': '啟用', '顯示名': '個別測試員', '名字': '個別測試員', '部門': '專案部', '組別': '平面' }],
    { canonicalAccount: value => String(value || '').trim().toLowerCase() },
    kind => kind === '部門' ? ['專案部'] : ['平面'],
    []
  );
  const departmentEntries = customerEntries.customerDepartmentEntries();
  assert.deepEqual(departmentEntries.find(entry => entry.value === 'person@example.com'), {
    value: 'person@example.com', label: '個別測試員', secondary: 'person@example.com',
    search: '個別測試員 person@example.com 專案部 平面', group: '個別人員', subgroup: '平面', department: '專案部'
  });
  assert.deepEqual([...new Set(customerEntries.customerDesignerEntries().map(entry => entry.group))], ['設計部']);

  const html = await readFile(new URL('../../index.html', import.meta.url), 'utf8');
  const sortStart = html.indexOf('const CUSTOMER_DIRECTORY_COLLATOR=');
  const sortEnd = html.indexOf('function syncCustomerDirectoryFromDatabase(', sortStart);
  const sortSource = html.slice(sortStart, sortEnd);
  const sortRows = new Function(`${sortSource};return sortedCustomerDirectoryRows;`)();
  assert.deepEqual(sortRows([
    { '客戶別': '第二個', '排序': '2' },
    { '客戶別': '第一個', '排序': '1' },
    { '客戶別': '未排序', '排序': '' }
  ]).map(row => row['客戶別']), ['第一個', '第二個', '未排序']);

  const ruleStart = html.indexOf('function customerEditRuleMatches(');
  const ruleEnd = html.indexOf('function isCustomerEditRestrictedCase(', ruleStart);
  const ruleSource = html.slice(ruleStart, ruleEnd);
  const canonical = value => String(value || '').trim().toLowerCase();
  const normalizeGroup = value => /平面/.test(String(value || '')) ? '平面' : (/影音|影像|影片|video/i.test(String(value || '')) ? '影音' : '');
  const matches = new Function('canonicalAccountClient', 'normalizeDesignGroup', `${ruleSource};return customerEditRuleMatches;`)(canonical, normalizeGroup);
  assert.equal(matches('department:設計部', 'tester@example.com', '測試員', '平面'), true);
  assert.equal(matches('group:設計測試組', 'tester@example.com', '測試員', '設計測試組'), true);
  assert.equal(matches('department:設計部', 'tester@example.com', '測試員', '非設計組'), false);

  const visibilityStart = html.indexOf('function canViewCustomerCases(');
  const visibilityEnd = html.indexOf('/** 權限設定可混用個別 Email', visibilityStart);
  const visibilitySource = html.slice(visibilityStart, visibilityEnd);
  const canViewAsIndividual = new Function('isAdministrator', 'isLoggedIn', 'customerVisibleDepartments', 'canonicalAccountClient', 'currentEditorAccount', 'currentEditor', 'currentEditorDepartment', 'currentEditorRawGroup', 'normalizeDesignGroup', `${visibilitySource};return canViewCustomerCases;`)(
    () => false, () => true, () => ['PERSON@example.com'], canonical,
    'person@example.com', '', '未指定部門', '未指定組別', normalizeGroup
  );
  assert.equal(canViewAsIndividual('個別顯示客戶'), true);
});

test('front end does not roll back newly written rows when a stale JSON refresh arrives', async () => {
  const html = await readFile(new URL('../../index.html', import.meta.url), 'utf8');
  assert.match(html, /incomingRevision<cachedRevision/);
  assert.match(html, /localWriteConfirmedGraceMs\s*=\s*2\*60\*1000/);
  assert.match(html, /confirmedAt:0/);
  assert.match(html, /previous\?\.changes.*\.\.\.changes/);
  assert.match(html, /now-entry\.confirmedAt>=localWriteConfirmedGraceMs/);
  assert.match(html, /key==='gmailThreadId'\|\|key==='gmailThreadOwnerAccount'/);
  assert.match(html, /if\(row\.gmailThreadId\)\{\s*merged\.gmailThreadId=row\.gmailThreadId/);
  assert.match(html, /function refreshWatchedScheduledThreads\(\)/);
  assert.match(html, /watchScheduledCaseThread\(id,scheduledAt\)/);
  assert.match(html, /authoritativeCaseIds/);
  assert.match(html, /function reconcileCurrentDatabaseRows\(/);
  assert.match(html, /cachedRows\.filter\(row=>!isCaseId_\(row\.id\)\|\|authoritativeIds\.has\(String\(row\.id\)\)\)/);
  assert.match(html, /function refreshWhenPageReturns\(\)/);
  assert.match(html, /loadSheet\(\{full:true,background:true,forceFresh:true\}\)/);
  assert.match(html, /const githubJsonDatabaseUrl = 'backend\/data\/db\.json'/);
  assert.doesNotMatch(html, /raw\.githubusercontent\.com\/EMCtaipeiART\/EMCtaipeiART\.github\.io\/main\/backend\/data\/db\.json/);
  assert.match(html, /function initDatabaseRefreshListener\(\)/);
  assert.match(html, /receiveDatabaseRefresh\(JSON\.parse\(event\.newValue\)\)/);
  assert.match(html, /window\.databaseRefreshChannel\.onmessage=event=>receiveDatabaseRefresh\(event\.data\)/);
  assert.match(html, /const supplementLinkFields = Object\.freeze/);
  assert.match(html, /function supplementLongUrl\(row,key\)/);
  assert.match(html, /function mailSupplementHtml\(note,url\)/);
  assert.match(html, /editor\.innerHTML=draft\.bodyHtml/);
  assert.doesNotMatch(html, /function supplementShortUrl\(row,key\)/);
  assert.doesNotMatch(html, /supplementBaseUrl:supplementShortBaseUrl/);
  assert.match(html, /function accountSettingsMailContacts\(\)/);
  assert.match(html, /const gmailRecipientGroupOrder=Object\.freeze\(\['企劃部','設計部','負責人','各組'\]\)/);
  assert.match(html, /const gmailExcludedContactDepartments=Object\.freeze\(\['測試員','監測部','管理部'\]\)/);
  assert.match(html, /if\(department==='設計部'\)return \{name,full:`\$\{name\} <\$\{email\}>`,group:'設計部',subgroup:''\}/);
  assert.match(html, /<details class="gmail-recipient-group"/);
  assert.match(html, /<details class="gmail-recipient-subgroup"/);
  assert.match(html, /if\(query&&visible\)groupEl\.open=true/);
  assert.match(html, /data-recipient-chips-for="gmailComposeTo"/);
  assert.match(html, /function gmailRecipientHeaderValue\(fieldId\)/);
  assert.match(html, /window\.addEventListener\('focus',\(\)=>\{refreshCurrentAccountAvatar\(\);refreshWhenPageReturns\(\)\}\)/);
  assert.match(html, /document\.addEventListener\('visibilitychange'.*refreshWhenPageReturns\(\)/);
  assert.match(html, /const current=queuedSheetLoad\.options, requireFull=current\.full\|\|incoming\.full/);
  assert.match(html, /filter\(row=>row\.pendingCreate\|\|isEditableRow\(row\)\)/);
  assert.match(html, /r\.pendingCreate\?'<span class="status updating-cell">建立中<\/span>'/);
  assert.match(html, /id:'建立中…'.*pendingCreate:true,pendingCreateKey/);
  const inlineUpdate = html.match(/function updateCaseRow\([\s\S]*?\nfunction openStatusEditor/)?.[0] || '';
  assert.match(inlineUpdate, /已立即更新畫面，背景寫入 JSON 資料庫中/);
  assert.match(inlineUpdate, /void enqueueInlineWrite/);
  assert.doesNotMatch(inlineUpdate, /markUpdatingCell|await refreshAfterInlineWrite/);
});

test('mail contact picker merges designers, orders groups and excludes internal departments', async () => {
  const html = await readFile(new URL('../../index.html', import.meta.url), 'utf8');
  const start = html.indexOf("const gmailExcludedContactDepartments=");
  const end = html.indexOf('function openRecipientPicker(', start);
  assert.ok(start > 0 && end > start);
  const source = html.slice(start, end);
  const settings = [
    { '部門': '企劃部', '組別': '', '顯示名': 'Planner', '帳號': 'planner@example.com' },
    { '部門': '設計部', '組別': '平面', '顯示名': 'Flat', '帳號': 'flat@example.com' },
    { '部門': '設計部', '組別': '影音', '顯示名': 'Video', '帳號': 'video@example.com' },
    { '部門': '負責人', '組別': '', '顯示名': 'Owner', '帳號': 'owner@example.com' },
    { '部門': '專案部', '組別': 'Celine組', '顯示名': 'Member', '帳號': 'member@example.com' },
    { '部門': '測試員', '組別': '', '顯示名': 'Tester', '帳號': 'tester@example.com' },
    { '部門': '監測部', '組別': '', '顯示名': 'Monitor', '帳號': 'monitor@example.com' },
    { '部門': '管理部', '組別': '人資行政組', '顯示名': 'Admin', '帳號': 'admin@example.com' }
  ];
  const extractEmail = value => String(value || '').match(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i)?.[0] || '';
  const run = new Function('githubJsonDatabaseCache', 'extractEmail', 'designerOptions', 'designerRecipientNames', 'designerRecipientByName', 'requiredMailCcRecipients', 'ownerContactMap', 'esc', `${source};const contacts=knownMailContacts(),groups=[];contacts.forEach(contact=>{let group=groups.find(item=>item.name===contact.group);if(!group){group={name:contact.group,items:[]};groups.push(group)}group.items.push(contact)});return {contacts,groups,markup:groups.map(group=>gmailRecipientGroupHtml(group,new Set())).join('')};`);
  const result = run(
    { tables: { '設定': { rows: settings }, '帳號權限': { rows: [] } } }, extractEmail,
    ['Flat','Video'], {}, name => `${name} <${name.toLowerCase()}@example.com>`,
    ['Owner <owner@example.com>'], new Map([['Owner','owner@example.com']]), value => String(value)
  );
  assert.deepEqual(result.groups.map(group => group.name), ['企劃部','設計部','負責人','各組']);
  assert.deepEqual(result.contacts.filter(contact => contact.group === '設計部').map(contact => contact.name), ['Flat','Video']);
  assert.equal(result.contacts.some(contact => ['Tester','Monitor','Admin'].includes(contact.name)), false);
  assert.match(result.markup, /<details class="gmail-recipient-group" data-recipient-group="企劃部">/);
  assert.match(result.markup, /<details class="gmail-recipient-subgroup"><summary class="gmail-recipient-subgroup-label"><span>Celine組<\/span>/);
  assert.doesNotMatch(result.markup, /<details[^>]+\sopen(?:\s|>)/);
});

test('designer roster uses JSON group and rotation for priority new-project buttons', async () => {
  const html = await readFile(new URL('../../index.html', import.meta.url), 'utf8');
  const designers = [
    { name: 'Leona', group: '平面', rotation: 1 },
    { name: 'Anna', group: '平面', rotation: 2 },
    { name: 'Amber', group: '平面', rotation: 3 },
    { name: 'Machi', group: '平面', rotation: 4 },
    { name: 'Noise', group: '影音', rotation: 1 },
    { name: 'Karl', group: '影音', rotation: 2 }
  ];
  const firstByGroup = Object.fromEntries(['平面', '影音'].map(group => [
    group,
    designers.filter(designer => designer.group === group).sort((a, b) => a.rotation - b.rotation)[0]?.name
  ]));

  assert.deepEqual(firstByGroup, { 平面: 'Leona', 影音: 'Noise' });
  assert.match(html, /row\['組別'\]\|\|row\['設計類型'\]/);
  assert.match(html, /githubJsonTableRows\('設定',\{fresh:true\}\)/);
  assert.match(html, /groupOrder=\{平面:0,影音:1\}/);
  assert.match(html, />新專案找我<\/button>/);
  assert.match(html, /let designerOptions = \['Machi','Anna','Karl','Noise','Amber','Leona'\]/);
  assert.match(html, /function syncDesignerOptionLists\(list=designers\)/);
  assert.match(html, /profile\.skillTargets\?\.\[skill\]/);
  assert.match(html, /type:String\(configured\?\.type\|\|'平面'\),stage:String\(configured\?\.stage\|\|'後製'\)/);
  assert.match(html, /button\.disabled=!allowed\|\|missingDesigner/);
  assert.doesNotMatch(html, /button\.disabled=button\.disabled\|\|!allowed/);
});

test('designer music uses one timeline, JSON-only settings, and seeks Spotify after play', async () => {
  const html = await readFile(new URL('../../index.html', import.meta.url), 'utf8');
  const settingsFetch = html.match(/async function fetchDesignerProfiles\(\)[\s\S]*?\nasync function loadDesignerRoster/)?.[0] || '';
  const settingsSaveStart = html.indexOf('async function saveDesignerSettings(event)');
  const settingsSaveEnd = html.indexOf('\nfunction ', settingsSaveStart);
  const settingsSave = html.slice(settingsSaveStart, settingsSaveEnd);

  assert.match(html, /type="hidden" name="music-start-/);
  assert.doesNotMatch(html, /type="number" name="music-start-/);
  assert.match(html, /function playSpotifyFromConfiguredStart[\s\S]*?controller\.play\(\); setTimeout\(\(\)=>applySpotifyStart/);
  assert.match(html, /if\(playing&&!spotifyStartApplied\.has\(shell\)\)applySpotifyStart/);
  assert.doesNotMatch(settingsFetch, /gvizJsonp\(designerGvizUrl\)/);
  assert.match(settingsSave, /jsonOnly:true/);
  assert.doesNotMatch(settingsSave, /backup/);
});

test('mail templates are numbered, support a default, appear in personal settings, and can be inserted in editors', async () => {
  const html = await readFile(new URL('../../index.html', import.meta.url), 'utf8');
  const appsScript = await readFile(new URL('../../GS/google_apps_script.gs', import.meta.url), 'utf8');
  const normalizeStart = html.indexOf('function normalizeReplyTemplateSettings(');
  const normalizeEnd = html.indexOf('\nfunction normalizeDesignerReplyTemplates', normalizeStart);
  const normalizeFunction = html.slice(normalizeStart, normalizeEnd);
  assert.match(html, /5\. 回信範本設定/);
  assert.match(html, /使用範本 1、範本 2…管理常用內容/);
  assert.match(html, /id="personalMailTemplateList"/);
  assert.match(html, /id="personalSettingsAvatarPreview"/);
  assert.match(html, /data-reply-template-default/);
  assert.match(html, /data-rich-template-for="gmailThreadReplyEditor"/);
  assert.match(html, /data-rich-template-for="gmailComposeEditor"/);
  assert.match(html, /data-rich-template-for="gmailThreadReplyEditor"[^>]*aria-label="插入信件範本"/);
  assert.match(html, /data-rich-template-for="gmailComposeEditor"[^>]*aria-label="插入信件範本"/);
  assert.doesNotMatch(html, /class="gmail-rich-template-btn"[^>]*>[\s\S]*?<span>範本<\/span>/);
  assert.match(html, /function openReplyTemplatePicker\(/);
  assert.doesNotMatch(html, /data-reply-template-type|data-reply-template-stage|data-reply-template-detail/);
  assert.ok(normalizeFunction);
  assert.doesNotMatch(appsScript, /normalizeDesignerReplyTemplates_|回信範本設定/);
  const normalize = new Function(`${normalizeFunction};return normalizeReplyTemplateSettings;`)();
  assert.deepEqual(normalize({ '社群貼文': '舊內容一', '廣告素材': '舊內容二' }, '廣告素材'), {
    templates: { '範本 1': '舊內容一', '範本 2': '舊內容二' }, defaultName: '範本 2'
  });
});

test('front-end destructive actions require confirmation before deletion', async () => {
  const html = await readFile(new URL('../../index.html', import.meta.url), 'utf8');
  const functionSource = (start, end) => {
    const from = html.indexOf(start);
    const to = html.indexOf(end, from);
    assert.ok(from >= 0 && to > from, `missing source range: ${start}`);
    return html.slice(from, to);
  };
  assert.match(functionSource('function bindMailTemplateEditor(', 'function collectMailTemplateEditor('), /if\(!row\|\|!confirm\(/);
  assert.match(functionSource('async function cancelScheduledMailItem(', 'function monthFromDate('), /if\(!confirm\(/);
  assert.match(functionSource('async function removeSelectedCaseDesignImages(', 'function refreshOpenRevisionModal('), /if\(!confirm\(/);
  assert.match(functionSource('async function removeCaseDesignImage(', 'function detailOptionsForRow('), /if\(!confirm\(/);
  assert.match(functionSource('function deleteRow(', 'function cancelRow('), /if\(!confirm\(/);
});

test('archive snapshot and dashboard use JSON database sources only', async () => {
  // The archive is append-preserving: current database rows are upserted without deleting historical rows.
  const generator = await readFile(new URL('../../scripts/generate_database_archive_snapshot.mjs', import.meta.url), 'utf8');
  const dashboard = await readFile(new URL('../../design_dashboard.html', import.meta.url), 'utf8');
  const archiveAdmin = await readFile(new URL('../../database_archive_admin.html', import.meta.url), 'utf8');
  const indexHtml = await readFile(new URL('../../index.html', import.meta.url), 'utf8');
  const database = JSON.parse(await readFile(new URL('../data/db.json', import.meta.url), 'utf8'));
  const archive = JSON.parse(await readFile(new URL('../../data/database_archive.json', import.meta.url), 'utf8'));
  assert.match(generator, /backend\/data\/db\.json/);
  assert.match(generator, /mode: 'preserve-history-and-sync-primary-database-deletions'/);
  assert.match(generator, /function removeDeletedCurrentRows\(/);
  assert.match(generator, /previousSnapshot\?\.currentDatabaseRowKeys/);
  assert.doesNotMatch(generator, /docs\.google\.com|script\.google\.com/);
  assert.equal(archive.rowCount, archive.rows.length);
  assert.ok(archive.rows.length >= database.tables.database.rows.length);
  assert.equal(archive.sources.archiveBase.mode, 'preserve-history-and-sync-primary-database-deletions');
  assert.ok(Array.isArray(archive.currentDatabaseRowKeys));
  const archiveById = new Map();
  for (const row of archive.rows) {
    const id = String(row['案件編號'] || '').trim();
    if (!archiveById.has(id)) archiveById.set(id, []);
    archiveById.get(id).push(row);
  }
  const occurrences = new Map();
  for (const sourceRow of database.tables.database.rows) {
    const id = String(sourceRow['案件編號'] || '').trim(), occurrence = occurrences.get(id) || 0;
    occurrences.set(id, occurrence + 1);
    const archivedRow = archiveById.get(id)?.[occurrence];
    assert.ok(archivedRow, `archive is missing database row ${id}#${occurrence + 1}`);
    for (const [key, value] of Object.entries(sourceRow)) assert.equal(archivedRow[key], value, `${id}.${key} is stale`);
  }
  assert.match(dashboard, /const ARCHIVE_JSON_URL='data\/database_archive\.json'/);
  assert.match(dashboard, /Promise\.all\(\[fetch\(`\$\{ARCHIVE_JSON_URL\}\?v=\$\{stamp\}`/);
  assert.match(dashboard, /fetch\(`\$\{PRIMARY_DATABASE_URL\}\?v=\$\{stamp\}`/);
  assert.match(dashboard, /database\?\.dashboardData\?\.settings/);
  assert.match(dashboard, /database\?\.dashboardData\?\.modifications/);
  assert.doesNotMatch(dashboard, /docs\.google\.com\/spreadsheets|fetchGvizJSONP|SHEET_JSONP_URL/);
  assert.match(dashboard, /urgentMultiplier=details\.includes\('急件'\)/);
  assert.match(dashboard, /qty\(r\)\*regularScore\*urgentMultiplier/);
  assert.doesNotMatch(dashboard, /qty\(r\)\*regularScore\+urgentScore/);
  assert.doesNotMatch(dashboard, /raw\.githubusercontent\.com\/EMCtaipeiART\/EMCtaipeiART\.github\.io\/main\/backend\/data\/db\.json/);
  assert.doesNotMatch(dashboard, /renderHeatmap\(y,m\);renderRank\(\);renderAnalysis\(y,m,des\)/);
  assert.match(archiveAdmin, /<h1>歷史資料庫管理<\/h1>/);
  assert.match(archiveAdmin, /function alignHistoryWithPrimary\(history,primary\)/);
  assert.match(archiveAdmin, /Promise\.all\(\[fetch\(`\$\{SNAPSHOT_URL\}/);
  assert.match(archiveAdmin, /fetch\(`\$\{PRIMARY_DATABASE_URL\}/);
  assert.match(archiveAdmin, /machi-database-refresh-v1/);
  assert.match(indexHtml, /const HISTORY_DATABASE_JSON_URL='data\/database_archive\.json'/);
  assert.match(indexHtml, /mergeRowsById\(archiveRows,rows\)/);
  assert.doesNotMatch(indexHtml, /function fetchArchiveDatabaseObjects\([^)]*\)\{return gvizToObjects/);
  assert.match(dashboard, /歷史 JSON 資料庫，已與目前 database 對齊/);
});

test('dashboard follows the active designer directory and exposes quarterly performance', async () => {
  const dashboard = await readFile(new URL('../../design_dashboard.html', import.meta.url), 'utf8');
  assert.match(dashboard, /function configureDesignerDirectory\(rows=\[\]\)/);
  assert.match(dashboard, /row\['設計師顯示'\]/);
  assert.match(dashboard, /configureDesignerDirectory\(currentSettings\)/);
  assert.match(dashboard, /const designerOptions=\[\.\.\.designerDirectory\]\.sort/);
  assert.match(dashboard, /localeCompare\(String\(right\.displayName\|\|right\.name\),'en'/);
  assert.match(dashboard, /designerOptions\.map\(row=>`<option value=/);
  assert.match(dashboard, /data-page="quarterly"/);
  assert.match(dashboard, /id="page-quarterly"/);
  assert.match(dashboard, /id="analysisGraphicQuarterChart"/);
  assert.match(dashboard, /id="analysisVideoQuarterChart"/);
  assert.match(dashboard, /renderDesignerQuarterPerformance\(y,designer,'平面'/);
  assert.match(dashboard, /renderDesignerQuarterPerformance\(y,designer,'影音'/);
  assert.match(dashboard, /const selectedQuarter=Math\.ceil\(m\/3\)/);
  assert.match(dashboard, /function renderDesignerQuarterPerformancePanels\(/);
  assert.match(dashboard, /renderDesignerQuarterPerformancePanels\(year,designer,analysisQuarter\)/);
  assert.match(dashboard, /quarter=>Math\.round\(rows\.filter/);
  assert.match(dashboard, /if\(index!==selectedIndex&&index!==chart\.\$performanceHoverIndex\)return/);
  assert.match(dashboard, /\.sort\(\(left,right\)=>right\.score-left\.score/);
  assert.match(dashboard, /\.slice\(0,4\)/);
  assert.match(dashboard, />No\.\$\{index\+1\}<\/span>/);
  assert.match(dashboard, /<span class="quarter-performance-value">\$\{item\.score\} 分<\/span>/);
  assert.match(dashboard, /quarterIndex===hoverIndex\?colors\[designerIndex\]:greyColors/);
  assert.match(dashboard, /onHover\(event,elements,instance\)/);
  assert.match(dashboard, /function quarterClickMonth\(year,quarter\)/);
  assert.match(dashboard, /Math\.min\(quarterEndMonth,REPORT_TODAY\.getMonth\(\)\+1\)/);
  assert.match(dashboard, /const targetMonth=quarterClickMonth\(y,elements\[0\]\.index\+1\)/);
  assert.match(dashboard, /\$\('monthFilter'\)\.value=String\(targetMonth\)/);
  assert.match(dashboard, /quarter-performance-item rank-\$\{index\+1\}/);
  assert.match(dashboard, /\.quarter-performance-item\.rank-1/);
  assert.match(dashboard, /\.quarter-performance-item\.rank-4/);
  assert.match(dashboard, /\.quarter-performance-item \.quarter-performance-value\{color:#101828\}/);
  assert.doesNotMatch(dashboard, /客戶工作量 TOP10|TOP10 客戶/);
  assert.doesNotMatch(dashboard, /filter\(\(\[name\]\)=>name!=='未分類'\)\.slice\(0,10\)/);
  assert.doesNotMatch(dashboard, /case-section-kicker|ITEM DETAIL|MONTHLY PROJECTS|MONTHLY CHANGE|YEARLY WEIGHT|CLIENT SHARE/);
  assert.match(dashboard, /function caseSvgDonutSegment\(/);
  assert.match(dashboard, /segment=caseSvgDonutSegment\(cx,cy,outerRadius,innerRadius,startAngle,endAngle,row\.color\)/);
  assert.match(dashboard, /percentLabels\+=`<text[^`]+fill="#fff">\$\{\(ratio\*100\)\.toFixed\(1\)\}%<\/text>`/);
  assert.doesNotMatch(dashboard, /percentLabels\+=`<text[^`]+stroke="#000"/);
});

test('front-end action API reads and atomically writes all requested JSON tables', async t => {
  const app = await fixture();
  t.after(() => app.close());

  const created = await api(app.baseUrl, 'add', {
    requestId: 'test-create-1',
    row: {
      client: '測試客戶', project: 'JSON 後台串接', owner: 'Machi', type: '平面', stage: '後製', qty: 2,
      start: '2026-08-07', end: '2026-08-08', designer: 'Machi', status: '未開始', details: '社群貼文',
      briefUrl: 'https://example.com/brief'
    }
  });
  assert.equal(created.ok, true);
  assert.match(created.row.id, /^\d{8}$/);
  assert.equal(created.row.weight, '2');
  assert.equal(created.row.briefUrl, 'https://example.com/brief');

  const duplicate = await api(app.baseUrl, 'add', { requestId: 'test-create-1', row: { project: '不應重複' } });
  assert.equal(duplicate.deduplicated, true);
  assert.equal(duplicate.row.id, created.row.id);

  const supplement = app.database.table('補充資料連結').rows[0];
  assert.equal(supplement['案件編號'], created.row.id);
  assert.equal(supplement.A, 'https://example.com/brief');

  const list = await api(app.baseUrl, 'list', { year: '2026' });
  assert.equal(list.rows.length, 1);
  assert.equal(list.rows[0].project, 'JSON 後台串接');

  const shortResponse = await fetch(`${app.baseUrl}/api`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ action: 'createShortLink', url: 'https://example.com/long/path' })
  });
  assert.equal(shortResponse.status, 400);
  const short = await shortResponse.json();
  assert.equal(short.ok, false);
  assert.match(short.error, /短網址建立功能目前暫停/);

  const issue = await api(app.baseUrl, 'reportIssue', { report: { name: '訪客', content: '測試問題', suggestion: '測試建議' } });
  assert.equal(issue.row['狀態'], '回報中');
  const modification = await api(app.baseUrl, 'addModificationRecord', {
    record: { caseId: created.row.id, modifyDate: '2026/08/08', content: '修改文案', modifier: 'Machi' }
  });
  assert.equal(modification.count, 1);
  const modificationList = await api(app.baseUrl, 'listModificationRecords', { ids: [created.row.id] });
  assert.equal(modificationList.rows.length, 1);
  assert.equal(modificationList.rows[0]['修改內容'], '修改文案');

  const profiles = await api(app.baseUrl, 'listDesignerProfiles');
  assert.equal(profiles.profiles[0].name, 'Machi');

  const persisted = JSON.parse(await readFile(app.dbPath, 'utf8'));
  assert.equal(persisted.tables.database.rows.length, 1);
  assert.equal(persisted.tables['短連結'].rows.length, 0);
  assert.equal(persisted.tables['修改統計表'].rows.length, 1);
  assert.equal(persisted.tables['補充資料連結'].rows.length, 1);
  assert.equal(persisted.tables['設定'].rows.length, 1);
  assert.equal(persisted.tables.reels.rows.length, 1);
  assert.equal(persisted.tables.bug_report.rows.length, 1);
});

test('JSON database admin renders actions first and updates JSON optimistically', async () => {
  const html = await readFile(new URL('../../json_database_admin.html', import.meta.url), 'utf8');
  const front = await readFile(new URL('../../index.html', import.meta.url), 'utf8');
  assert.match(html, /const TABLE_LABELS=\{database:'資料庫','帳號權限':'帳號設定','加權計分標準':'加權設定','角色權限範本':'權限設定',bug_report:'問題回報','修改統計表':'修改列表'\};/);
  assert.match(html, /function tableLabel\(name\)\{return TABLE_LABELS\[name\]\|\|name\}/);
  // reels 不另列側邊頁；設計師公開資料與 REELS 統一由「設計列表」管理。
  assert.doesNotMatch(html, /const TABLE_ORDER=\[[^\]]*'reels'/);
  assert.match(html, /const TABLE_ORDER=\['database','系統公告欄','設計列表'/);
  assert.match(html, /data-account-reel-edit=/);
  assert.match(html, /data-account-reel-delete=/);
  assert.match(html, /function databaseTableHtml\(table,data\)\{/);
  assert.match(html, /async function refreshWorkerDatabase\(\).*action:'refreshDatabase'/);
  assert.match(html, /async function start\(\).*await refreshWorkerDatabase\(\);await loadMetadata\(\)/);
  assert.match(html, /class="database-link"[^>]+aria-label="開啟連結">前往連結<\/a>/);
  assert.match(html, /function isDatabaseDesignPathHeader\(header\).*設計圖資料/);
  assert.match(html, /isDatabaseDesignPathHeader\(header\).*databaseDesignPathCellHtml\(row\[header\]\)/);
  assert.match(html, /database-details[^}]+width:150px/);
  assert.match(html, /database-supplement-note[^}]+width:132px/);
  assert.match(html, /database-link-column[^}]+width:92px/);
  assert.match(html, /database-design-path[^}]+width:360px[^}]+white-space:normal[^}]+overflow-wrap:anywhere/);
  assert.match(html, /\.database-link\{[^}]*color:var\(--ink\)/);
  assert.match(html, /\.action-col\{position:sticky!important;left:0/);
  assert.match(html, /const DATABASE_FILE_URL=new URL\('backend\/data\/db\.json',location\.href\)\.href/);
  assert.doesNotMatch(html, /DATABASE_CONTENTS_API|api\.github\.com\/repos\/EMCtaipeiART/);
  assert.match(html, /function spreadsheetBackupOptions\(name=tableName\)/);
  assert.match(html, /backupToSpreadsheet=name==='database'/);
  assert.match(html, /skipSpreadsheetBackup:!backupToSpreadsheet/);
  assert.match(html, /已先更新畫面，JSON 背景寫入中/);
  assert.match(html, /已先從畫面移除，JSON 背景刪除中/);
  assert.match(html, /const TABLE_ORDER=\['database','系統公告欄','設計列表','加權計分標準','短連結','修改統計表'/);
  assert.match(html, /function systemAnnouncementAdminHtml\(rows\)/);
  assert.match(html, /data-announcement-toggle/);
  assert.match(html, /function systemAnnouncementReadHtml\(row\)/);
  assert.match(html, /查看已讀帳號/);
  assert.match(front, /id="systemAnnouncementDismiss">\u4e0d再出現/);
  assert.match(front, /machiSystemAnnouncementDismissedVersionV1/);
  assert.match(front, /markSystemAnnouncementRead/);
  assert.match(html, /function shortLinkTableHtml\(data\)/);
  // 補充資料連結不再有獨立頁籤，也不再併入「修改列表」的案件群組顯示。
  assert.doesNotMatch(html, /const TABLE_ORDER=\[[^\]]*'補充資料連結'/);
  assert.doesNotMatch(html, /function supplementCardsHtml\(rows\)/);
  assert.match(html, /function modificationHistoryHtml\(rows\)/);
  assert.doesNotMatch(html, /function supplementLinksHtml\(caseId,row\)/);
  assert.doesNotMatch(html, /data-supplement-edit=/);
  assert.doesNotMatch(html, /data-supplement-delete=/);
  assert.doesNotMatch(html, /data-supplement-add=/);
  assert.doesNotMatch(html, /async function ensureSupplementLinkRows\(\)/);
  assert.doesNotMatch(html, /supplementLinkRowsCache/);
  assert.doesNotMatch(html, /function combinedLinkRows\(\)|_sourceTable/);
  assert.match(html, /function weightEditorHtml\(row\)/);
  assert.match(html, /<option value="other".*>其他<\/option>/);
  assert.match(html, /function weightGroupsHtml\(rows\)/);
  assert.match(html, /tableName==='修改統計表'.*sortKey='建立日期'.*sortOrder='desc'/);
  assert.match(html, /latest\.get\(String\(right\['案件編號'\]\)\)/);
  assert.match(html, /const NO_INSERT_TABLES=\['database'\]/);
  assert.match(html, /function updateAddButton\(\)\{const hidden=tableName==='角色權限範本'/);
  assert.match(html, /function permissionAdminHtml\(rows\)/);
  assert.match(html, /data-permission-save/);
  assert.match(html, /action:'adminAccountSave'/);
  assert.match(html, /action:'adminAccountDelete'/);
  assert.match(html, /action:'adminDesignerSave'/);
  assert.match(html, /action:'adminDesignerRemove'/);
  assert.match(html, /function designerAdminHtml\(rows\)/);
  assert.match(html, /技能與表單預設/);
  assert.match(html, /基本與輪值設定/);
  assert.match(html, /前台媒體設定/);
  assert.match(html, /<h3>回信範本設定<\/h3>/);
  assert.match(html, /designer-admin-management-grid/);
  assert.match(html, /data-designer-reply-label/);
  assert.match(html, /data-designer-reply-default/);
  assert.match(html, /data-designer-reply-content/);
  assert.match(html, /replyTemplates\[name\]=content/);
  assert.match(html, /designer-skill-columns/);
  assert.match(html, /grid-template-columns:repeat\(3,minmax\(0,1fr\)\)/);
  // 技能列改成單排（名稱｜設計種類｜預設階段｜小型刪除鈕），新增技能按鈕搬到區塊標題列右側。
  assert.match(html, /designer-skill-editor-head\{display:flex;align-items:flex-start;justify-content:space-between/);
  assert.doesNotMatch(html, /designer-skill-editor-head \.btn\{align-self:center/);
  assert.match(html, /designer-skill-row\{display:flex;flex-wrap:wrap/);
  assert.match(html, /designer-skill-row button\{flex:0 0 34px;width:34px;height:34px/);
  assert.doesNotMatch(html, /designer-skill-row button\{grid-column:1\/-1;width:100%/);
  assert.match(html, /class="btn danger delete"/);
  assert.match(html, /function designerRotationBoardHtml\(rows\)/);
  assert.match(html, /新專案輪值順序/);
  assert.match(html, /data-account-rotation-item=.*draggable="true"|draggable="true" data-account-rotation-item=/);
  assert.match(html, /data-designer-rotation-move/);
  assert.match(html, /target\.parentElement!==accountRotationDragged\.parentElement/);
  assert.doesNotMatch(html, /<summary>設計師公開資料<\/summary>/);
  assert.match(html, /data-account-delete/);
  assert.match(html, /function organizationManagerHtml\(\)/);
  assert.match(html, /adminOrganizationOptionSave/);
  assert.match(html, /adminOrganizationOptionDelete/);
  assert.match(html, /data-password-configured/);
  assert.match(html, /此帳號尚未建立可用的登入密碼/);
  // 公開頭像、音樂與技能已移至設計列表；帳號設定不再覆寫這些欄位。
  assert.match(html, /designerAdminField\('頭像大圖連結'/);
  assert.match(html, /\['部門','組別','名字','顯示名','帳號','頭像連結','深淺模式'\]/);
  assert.match(html, /data:image\/svg\+xml;charset=UTF-8,\$\{encodeURIComponent\(svg\)\}/);
  assert.doesNotMatch(html, /xmlns='http:\/\/www\.w3\.org\/2000\/svg'/);
  assert.match(html, /accountChoice\('篩選月份'/);
  assert.match(html, /function accountColumnChoices\(model\)/);
  assert.match(html, /data-account-column-move="-1"/);
  assert.match(html, /data-account-column-grid/);
  assert.match(html, /function selectPermissionAccount\(account\)/);
  assert.match(html, /data-account-group=/);
  assert.match(html, /class="account-section-fold"/);
  assert.match(html, /所有帳號皆可設定個人頭像/);
  assert.match(html, /function accountReelsCardsHtml\(model\)/);
  assert.match(html, /REELS 小卡/);
  assert.match(html, /一次儲存個人設定與帳號權限/);
  assert.doesNotMatch(html.match(/const TABLE_ORDER=\[[^;]+/)?.[0] || '', /'設定'/);
  assert.match(html, /function roleTemplateAdminHtml\(rows\)/);
  assert.match(html, /data-template-save/);
  assert.match(html, /同角色且未使用自訂權限的帳號會同步套用/);
  assert.match(html, /function enqueueAccessWrite\(task\)/);
  assert.match(html, /個人設定與權限已先套用；JSON 正在背景原子寫入/);
  assert.match(html, /permissionWritesPending\.has\(account\)/);
  assert.match(html, /if\(data\?\.tables\)MachiAccess\.applyRoleTemplates\(data\)/);
  const accessControl = await readFile(new URL('../../assets/access-control.js', import.meta.url), 'utf8');
  assert.match(accessControl, /if \(refreshPromise\) return refreshPromise/);
  assert.match(accessControl, /if \(refreshPromise === operation\) refreshPromise = null/);
  assert.match(front, /accountJsonDatabaseAdmin.*accessAllowed\('page\.database_admin',false\).*accessAllowed\('database\.manage',false\)/s);
  assert.doesNotMatch(front, /accountJsonDatabaseAdmin'\)\?\.addEventListener\('click',\(\)=>\{if\(!isAdministrator\(\)/);
  assert.match(html, /button\.textContent=pending\?'套用新資料':'重新讀取'/);
  assert.match(html, /目前畫面與閱讀位置已保留/);
  assert.match(html, /loadDatabaseFile\(\{fresh:true,commitSha,store:false\}\)/);
  assert.match(html, /backgroundPollTick\(\).*refreshFromBackend\(\{quiet:true\}\)/);
  const backgroundRefresh = html.match(/async function refreshFromBackend\(message=\{\}\)[\s\S]*?\n    window\.addEventListener\('storage'/)?.[0] || '';
  assert.doesNotMatch(backgroundRefresh, /loadMetadata\(/);
  assert.match(backgroundRefresh, /stageDatabaseSnapshot\(data,message\)/);
  assert.match(html, /appsScriptRequest\(original\?'adminTableUpdate':'adminTableInsert'/);
  assert.match(html, /\+ 新增帳號/);
  assert.match(html, /\+ 新增項目/);
  const save = html.match(/async function saveEditor\([\s\S]*?\n    async function deleteRow/)?.[0] || '';
  assert.doesNotMatch(save, /loadMetadata\(\{fresh:/);
});

test('Apps Script user directory is sourced from JSON settings and can insert settings rows', async () => {
  const source = await readFile(new URL('../../GS/user_directory.gs', import.meta.url), 'utf8')
    .catch(() => readFile(new URL('../../user_directory.gs', import.meta.url), 'utf8'));
  assert.match(source, /database\.tables\['設定'\]\.rows/);
  assert.match(source, /const USER_DIRECTORY = readJsonUserDirectory_\(\)/);
  assert.match(source, /function adminTableInsert_\(payload\)/);
  assert.doesNotMatch(source, /SpreadsheetApp|getSettingsSheet_/);

  const database = { revision: 1, tables: { '設定': { headers: ['部門','組別','名字','顯示名','帳號'], rows: [] } } };
  const summary = mergeUserDirectory(database);
  assert.equal(USER_DIRECTORY.length, 62);
  assert.equal(summary.added, 62);
  assert.equal(database.tables['設定'].rows.find(row => row['帳號'] === 'machi.chen@emctaipei.com')['部門'], '設計部');
  assert.equal(database.tables['設定'].rows.find(row => row['帳號'] === 'riley.pan@emctaipei.com')['組別'], 'Celine組');
});

test('Apps Script admin mutations resolve stale row numbers by stable primary key', async () => {
  const source = await readFile(new URL('../../GS/google_apps_script.gs', import.meta.url), 'utf8')
    .catch(() => readFile(new URL('../../google_apps_script.gs', import.meta.url), 'utf8'));
  const helperSource = source.match(/function adminTablePrimaryKeyValue_[\s\S]*?(?=\nfunction adminTableUpdate_)/)?.[0] || '';
  assert.ok(helperSource);
  const { adminTableMutationTarget_ } = new Function(`${helperSource}; return { adminTableMutationTarget_ };`)();
  const table = { rows: [
    { '帳號': 'first@emctaipei.com' },
    { '帳號': 'allen.li@emctaipei.com' },
    { '帳號': 'third@emctaipei.com' }
  ] };
  const config = { primaryKey: '帳號' };
  const stalePayload = { rowNumber: 2, expectedRow: { '帳號': 'ALLEN.LI@EMCTAIPEI.COM' } };
  assert.deepEqual(adminTableMutationTarget_(table, config, stalePayload, '刪除'), {
    index: 1,
    rowNumber: 3,
    expected: stalePayload.expectedRow
  });
  assert.throws(() => adminTableMutationTarget_(table, config, { rowNumber: 2, expectedRow: { '帳號': 'missing@emctaipei.com' } }, '編輯'), /找不到要編輯的資料/);
  assert.match(source, /const target = adminTableMutationTarget_\(table, config, payload, '編輯'\)/);
  assert.match(source, /const target = adminTableMutationTarget_\(table, config, payload, '刪除'\)/);
});

test('password session protects settings, reels and manager-only issue status writes', async t => {
  const app = await fixture();
  t.after(() => app.close());

  const rejected = await api(app.baseUrl, 'login', { account: 'machi.chen', password: 'wrong' });
  assert.equal(rejected.ok, false);
  assert.equal(rejected.error, '帳號或密碼不正確');

  const login = await api(app.baseUrl, 'login', { account: 'machi.chen', password: 'secret' });
  assert.equal(login.ok, true);
  assert.ok(login.token);

  const verified = await api(app.baseUrl, 'verifyToken', { editorToken: login.token });
  assert.equal(verified.user, 'Machi');

  const bearerVerified = await request(app.baseUrl, '/api', {
    method: 'POST', token: login.token, body: { action: 'verifyToken' }
  });
  assert.equal(bearerVerified.response.status, 200);
  assert.equal(bearerVerified.data.ok, true);
  assert.equal(bearerVerified.data.account, 'machi.chen@emctaipei.com');

  const saved = await api(app.baseUrl, 'saveUserSettings', {
    editorToken: login.token,
    settings: {
      displayName: 'Machi JSON', avatar: 'https://example.com/new-avatar.jpg', theme: 'dark', collapseSettings: { recent: true },
      replyTemplates: { '範本 1': '第一筆內容', '範本 2': '第二筆內容' }, replyTemplateDefault: '範本 2'
    }
  });
  assert.equal(saved.settings.displayName, 'Machi JSON');
  assert.equal(saved.settings.avatar, 'https://example.com/new-avatar.jpg');
  assert.equal(saved.settings.theme, 'dark');
  assert.deepEqual(saved.settings.replyTemplates, { '範本 1': '第一筆內容', '範本 2': '第二筆內容' });
  assert.equal(saved.settings.replyTemplateDefault, '範本 2');

  const reaction = await api(app.baseUrl, 'toggleReelReaction', {
    editorToken: login.token, reelId: 'reel-file', reaction: 'like'
  });
  assert.deepEqual(reaction.reel.likes, ['Machi']);

  const comment = await api(app.baseUrl, 'addReelComment', {
    editorToken: login.token, reelId: 'reel-file', comment: 'JSON 留言成功'
  });
  assert.equal(comment.reel.comments.at(-1).text, 'JSON 留言成功');

  const issue = await api(app.baseUrl, 'reportIssue', { report: { content: '狀態測試' } });
  const updated = await api(app.baseUrl, 'updateIssueReportStatus', {
    editorToken: login.token, rowNumber: issue.rowNumber, status: '處理中'
  });
  assert.equal(updated.row['狀態'], '處理中');
  assert.ok(updated.row['處理中']);

  const logout = await api(app.baseUrl, 'logout', { editorToken: login.token });
  assert.equal(logout.ok, true);
  const expired = await api(app.baseUrl, 'verifyToken', { editorToken: login.token });
  assert.equal(expired.ok, false);
});

test('account access rows control capabilities and can delegate database administration', async t => {
  const app = await fixture();
  t.after(() => app.close());
  await app.database.transaction(draft => {
    draft.tables['設定'].rows.push(
      { '部門': '業務部', '組別': 'A組', '名字': '權限測試', '顯示名': '權限測試', '帳號': 'acl.user@emctaipei.com' },
      { '部門': '業務部', '組別': 'B組', '名字': '範本測試', '顯示名': '範本測試', '帳號': 'template.user@emctaipei.com' }
    );
    draft.tables['帳號權限'].rows.push({
      '帳號': 'acl.user@emctaipei.com', '角色範本': '自訂', '狀態': '啟用',
      '頁面權限': JSON.stringify(['request', 'database_admin']),
      '功能權限': JSON.stringify(['database.manage'])
    });
  }, 'seed account access');

  const login = await api(app.baseUrl, 'login', { account: 'acl.user', password: 'secret' });
  const verified = await api(app.baseUrl, 'verifyToken', { editorToken: login.token });
  assert.equal(verified.access.explicit, true);
  assert.deepEqual(verified.access.pages, ['request', 'database_admin']);
  assert.deepEqual(verified.access.capabilities, ['database.manage']);

  const denied = await request(app.baseUrl, '/api', { method: 'POST', body: { action: 'saveUserSettings', editorToken: login.token, settings: { displayName: '不應寫入' } } });
  assert.equal(denied.response.status, 400);
  assert.match(denied.data.error, /profile\.edit/);

  const delegated = await request(app.baseUrl, '/api/tables', { token: login.token });
  assert.equal(delegated.response.status, 200);

  const updatedTemplate = await request(app.baseUrl, `/api/table/${encodeURIComponent('角色權限範本')}/${encodeURIComponent('一般使用者')}`, {
    method: 'PATCH', token: login.token, body: { row: {
      '頁面權限': JSON.stringify(['request', 'database_admin']),
      '功能權限': JSON.stringify(['request.create', 'database.manage'])
    } }
  });
  assert.equal(updatedTemplate.response.status, 200);
  const templateLogin = await api(app.baseUrl, 'login', { account: 'template.user', password: 'secret' });
  const templateVerified = await api(app.baseUrl, 'verifyToken', { editorToken: templateLogin.token });
  assert.equal(templateVerified.access.role, '一般使用者');
  assert.deepEqual(templateVerified.access.pages, ['request', 'database_admin']);
  assert.deepEqual(templateVerified.access.capabilities, ['request.create', 'database.manage']);
});

test('new project writes database and group JSON table while rotating only the actual assignee', async t => {
  const app = await fixture();
  t.after(() => app.close());
  await app.database.transaction(draft => {
    const machi = draft.tables['設定'].rows.find(row => row['名字'] === 'Machi');
    Object.assign(machi, { '組別': '平面', '新專案輪值': '4' });
    draft.tables['設定'].rows.push(
      { '名字': 'Leona', '帳號': 'leona.chen@emctaipei.com', '組別': '平面', '新專案輪值': '1' },
      { '名字': 'Anna', '帳號': 'anna.hsu@emctaipei.com', '組別': '平面', '新專案輪值': '2' },
      { '名字': 'Amber', '帳號': 'amber.tian@emctaipei.com', '組別': '平面', '新專案輪值': '3' },
      { '名字': 'Karl', '帳號': 'karl.lee@emctaipei.com', '組別': '影音', '新專案輪值': '1' },
      { '名字': 'Noise', '帳號': 'noise.zhong@emctaipei.com', '組別': '影音', '新專案輪值': '2' }
    );
  }, 'seed project rotations');
  const login = await api(app.baseUrl, 'login', { account: 'machi.chen', password: 'secret' });

  const flat = await api(app.baseUrl, 'createFlatProject', {
    editorToken: login.token,
    row: {
      client: '輪值測試客戶', project: '平面替換測試', owner: 'Machi', projectType: '平面設計', qty: 1,
      start: '2026-08-08', end: '2026-08-09', expectedDesigner: 'Leona', replacement: 'Amber', reason: '指定專案延續'
    }
  });
  assert.equal(flat.databaseRow.designer, 'Amber');
  assert.deepEqual(Object.fromEntries(flat.rotations.map(item => [item.name, item.rotation])), { Machi: 3, Anna: 2, Amber: 4, Leona: 1 });
  assert.equal(app.database.table('平面新開專案').rows.length, 1);
  assert.equal(app.database.table('平面新開專案').rows[0]['預計設計師'], 'Leona');
  assert.equal(app.database.table('平面新開專案').rows[0]['替換(選填)'], 'Amber');

  const video = await api(app.baseUrl, 'createFlatProject', {
    editorToken: login.token,
    row: {
      client: '輪值測試客戶', project: '影音輪值測試', owner: 'Machi', projectType: '社群影音', qty: 1,
      start: '2026-08-08', end: '2026-08-09', expectedDesigner: 'Karl'
    }
  });
  assert.equal(video.databaseRow.designer, 'Karl');
  assert.deepEqual(Object.fromEntries(video.rotations.map(item => [item.name, item.rotation])), { Karl: 2, Noise: 1 });
  assert.equal(app.database.table('影音新開專案').rows.length, 1);
  assert.equal(app.database.table('database').rows.length, 2);
});

test('concurrent creates are serialized and generate unique case IDs', async t => {
  const app = await fixture();
  t.after(() => app.close());
  const results = await Promise.all(Array.from({ length: 12 }, (_, index) => api(app.baseUrl, 'add', {
    requestId: `concurrent-${index}`,
    row: { project: `案件 ${index}`, start: '2026-08-07', qty: 1 }
  })));
  const ids = results.map(result => result.row.id);
  assert.equal(new Set(ids).size, 12);
  assert.equal(app.database.table('database').rows.length, 12);
});

test('admin API manages JSON tables and editable weighting rules', async t => {
  const app = await fixture();
  t.after(() => app.close());

  const unauthorized = await request(app.baseUrl, '/api/tables');
  assert.equal(unauthorized.response.status, 401);

  const login = await api(app.baseUrl, 'adminLogin', { password: 'secret' });
  assert.equal(login.ok, true);
  const metadata = await request(app.baseUrl, '/api/tables', { token: login.token });
  assert.equal(metadata.response.status, 200);
  assert.deepEqual(Object.keys(metadata.data.tables), ['database', '加權計分標準', '短連結', '系統公告欄', '修改統計表', '補充資料連結', '設定', '帳號權限', '組織選項', '客戶別', '角色權限範本', 'reels', 'bug_report', '平面新開專案', '影音新開專案']);
  const announcement = await api(app.baseUrl, 'getSystemAnnouncement');
  assert.equal(announcement.announcement.version, 'v4.7');
  const userLogin = await api(app.baseUrl, 'login', { account: 'machi.chen', password: 'secret' });
  const firstRead = await api(app.baseUrl, 'markSystemAnnouncementRead', { editorToken: userLogin.token, version: 'v4.7', account: 'spoofed@emctaipei.com' });
  const repeatedRead = await api(app.baseUrl, 'markSystemAnnouncementRead', { editorToken: userLogin.token, version: 'v4.7' });
  assert.equal(firstRead.readCount, 1);
  assert.equal(repeatedRead.readCount, 1);
  assert.deepEqual(systemAnnouncementReadRecords(app.database.table('系統公告欄').rows[0]).map(record => record.account), ['machi.chen@emctaipei.com']);

  const weightRule = await request(app.baseUrl, `/api/table/${encodeURIComponent('加權計分標準')}/2`, { method: 'PATCH', token: login.token, body: { row: { '權重': '9' } } });
  assert.equal(weightRule.data.row['項目細節'], '社群貼文');
  assert.equal(weightRule.data.row['權重'], '9');

  const fixtures = {
    database: { '案件編號': '26990001', '專案名稱': 'JSON 管理驗收', '設計種類': '平面', '階段': '提案', '數量': '2', '項目細節': '社群貼文' },
    '短連結': { '短碼': 'Adm001', '原始網址': 'https://example.com/admin' },
    '修改統計表': { '案件編號': '26990001', '修改次數': '1', '修改內容': '後台新增' },
    '補充資料連結': { '案件編號': '26990001', A: 'https://example.com/a' },
    '設定': { '帳號': 'admin.test@emctaipei.com', '名字': 'Admin Test' },
    reels: { '名字': 'Machi', '限時動態連結': 'https://example.com/reel-admin.jpg' },
    bug_report: { '姓名': 'Admin', '內容': '七表後台測試' }
  };
  for (const [table, row] of Object.entries(fixtures)) {
    const created = await request(app.baseUrl, `/api/table/${encodeURIComponent(table)}`, { method: 'POST', token: login.token, body: { row } });
    assert.equal(created.response.status, 200, table);
    assert.equal(created.data.ok, true, table);
    if (table === 'database') assert.equal(created.data.row['加權'], '18');
  }
  const revisedRule = await request(app.baseUrl, `/api/table/${encodeURIComponent('加權計分標準')}/2`, { method: 'PATCH', token: login.token, body: { row: { '權重': '4' } } });
  assert.equal(revisedRule.data.recalculatedRows, 1);
  const searched = await request(app.baseUrl, `/api/table/database?q=${encodeURIComponent('JSON 管理')}&sort=${encodeURIComponent('案件編號')}&order=desc`, { token: login.token });
  assert.equal(searched.data.total, 1);
  assert.equal(searched.data.rows[0]['案件編號'], '26990001');
  assert.equal(searched.data.rows[0]['加權'], '8');
  const patched = await request(app.baseUrl, '/api/table/database/26990001', { method: 'PATCH', token: login.token, body: { row: { '專案名稱': '七表管理已更新' } } });
  assert.equal(patched.data.row['專案名稱'], '七表管理已更新');
  const deleted = await request(app.baseUrl, '/api/table/database/26990001', { method: 'DELETE', token: login.token, body: {} });
  assert.equal(deleted.data.deleted['案件編號'], '26990001');
});

test('admin account save atomically creates personal settings and access', async t => {
  const app = await fixture();
  t.after(() => app.close());
  const login = await api(app.baseUrl, 'adminLogin', { password: 'secret' });
  const account = 'new.designer@emctaipei.com';
  const saved = await api(app.baseUrl, 'adminAccountSave', {
    editorToken: login.token,
    account,
    expectSettingsMissing: true,
    expectPermissionMissing: true,
    settingsRow: {
      '帳號': account, '部門': '設計部', '組別': '平面', '名字': 'New Designer', '顯示名': '新設計師',
      '頭像連結': 'https://example.com/new-avatar.jpg', '頭像大圖連結': 'https://example.com/new-poster.jpg',
      '分享音樂': 'https://example.com/music', '音樂起始秒數': '12', '技能': '平面, 動畫', '對話框': '測試對話框',
      '新專案輪值': '3', '篩選月份': '8月 , 9月', '篩選狀態': '未開始 , 執行中', '深淺模式': '深色'
    },
    permissionRow: {
      '帳號': account, '角色範本': '設計師', '狀態': '啟用',
      '頁面權限': JSON.stringify(['request', 'dashboard']),
      '功能權限': JSON.stringify(['request.create', 'profile.edit'])
    }
  });
  assert.deepEqual(saved.changedTables, ['設定', '帳號權限']);
  assert.equal(saved.settingsRow['技能'], '平面 , 動畫');
  assert.equal(saved.permissionRow['角色範本'], '設計師');
  assert.equal(app.database.table('設定').rows.filter(row => row['帳號'] === account).length, 1);
  assert.equal(app.database.table('帳號權限').rows.filter(row => row['帳號'] === account).length, 1);

  const hiddenProfiles = await api(app.baseUrl, 'listDesignerProfiles');
  assert.equal(hiddenProfiles.profiles.some(profile => profile.account === account), false);
  const designerSaved = await api(app.baseUrl, 'adminDesignerSave', {
    editorToken: login.token,
    account,
    expectedSettingsRow: saved.settingsRow,
    profile: {
      group: '影音', rotation: 99, avatar: 'https://example.com/new-avatar.jpg', poster: 'https://example.com/new-poster.jpg',
      musicUrl: 'https://example.com/music', musicStartAt: 8, quote: '新的動態設計師',
      skillMappings: [{ name: '短影音', type: '影音', stage: '後製' }, { name: '動態貼文', type: '平面', stage: '後製' }],
      replyTemplates: { '影音剪輯': '已完成影音剪輯，再請確認。', '字幕字卡': '字幕字卡版本如附件。' }
    }
  });
  assert.equal(designerSaved.settingsRow['設計師顯示'], 'v');
  assert.equal(designerSaved.settingsRow['技能'], '短影音 , 動態貼文');
  assert.deepEqual(JSON.parse(designerSaved.settingsRow['技能表單設定']), [
    { name: '短影音', type: '影音', stage: '後製' },
    { name: '動態貼文', type: '平面', stage: '後製' }
  ]);
  assert.deepEqual(JSON.parse(designerSaved.settingsRow['回信範本設定']), {
    '影音剪輯': '已完成影音剪輯，再請確認。',
    '字幕字卡': '字幕字卡版本如附件。'
  });
  const activeProfiles = await api(app.baseUrl, 'listDesignerProfiles');
  assert.deepEqual(activeProfiles.profiles.find(profile => profile.account === account)?.skillMappings, [
    { name: '短影音', type: '影音', stage: '後製' },
    { name: '動態貼文', type: '平面', stage: '後製' }
  ]);
  assert.deepEqual(activeProfiles.profiles.find(profile => profile.account === account)?.replyTemplates, {
    '影音剪輯': '已完成影音剪輯，再請確認。',
    '字幕字卡': '字幕字卡版本如附件。'
  });
  const designerRemoved = await api(app.baseUrl, 'adminDesignerRemove', {
    editorToken: login.token, account, expectedSettingsRow: designerSaved.settingsRow
  });
  assert.equal(designerRemoved.ok, true);
  const removedProfiles = await api(app.baseUrl, 'listDesignerProfiles');
  assert.equal(removedProfiles.profiles.some(profile => profile.account === account), false);

  const rejected = await request(app.baseUrl, '/api', { method: 'POST', body: {
    action: 'adminAccountSave', editorToken: login.token, account: 'broken.account@emctaipei.com',
    expectSettingsMissing: true, expectPermissionMissing: true,
    settingsRow: { '帳號': 'broken.account@emctaipei.com', '名字': 'Broken Account' },
    permissionRow: { '帳號': 'broken.account@emctaipei.com', '角色範本': '不存在', '狀態': '啟用' }
  } });
  assert.equal(rejected.response.status, 400);
  assert.equal(rejected.data.ok, false);
  assert.equal(app.database.table('設定').rows.some(row => row['帳號'] === 'broken.account@emctaipei.com'), false);
  assert.equal(app.database.table('帳號權限').rows.some(row => row['帳號'] === 'broken.account@emctaipei.com'), false);
});

test('ERP OAuth exchanges PKCE code, reads identity and creates a JSON session', async t => {
  const calls = [];
  const fetchImpl = async (url, init = {}) => {
    calls.push({ url: String(url), init });
    if (String(url).endsWith('/api/oauth/token')) return new Response(JSON.stringify({ access_token: 'erp-access', token_type: 'Bearer', expires_in: 3600 }), { status: 200 });
    if (String(url).endsWith('/api/oauth/userinfo')) return new Response(JSON.stringify({
      employee_id: 'E-1024', name: '王小明', name_en: 'Ming Wang', email: 'ming@emctaipei.com',
      role: 'staff', department: '專案部', rank: 'Senior', title: '資深專案經理', is_active: true, is_pm: true
    }), { status: 200 });
    throw new Error(`unexpected URL: ${url}`);
  };
  const app = await fixture({
    fetchImpl,
    erpBaseUrl: 'https://erp.example.test',
    erpClientId: 'oauth_test',
    erpClientSecret: 'secret-on-server',
    erpRedirectUri: 'https://design.example.test/'
  });
  t.after(() => app.close());

  const config = await api(app.baseUrl, 'erpLoginConfig');
  assert.equal(config.ok, true);
  assert.equal(config.clientId, 'oauth_test');
  assert.equal('clientSecret' in config, false);

  const login = await api(app.baseUrl, 'erpLogin', { code: 'authorization-code', codeVerifier: 'pkce-verifier', redirectUri: 'https://design.example.test/' });
  assert.equal(login.ok, true);
  assert.equal(login.provider, 'erp');
  assert.equal(login.account, 'ming@emctaipei.com');
  assert.equal(login.erpProfile.employee_id, 'E-1024');
  assert.equal(login.settings.department, '專案部');
  assert.match(String(calls[0].init.body), /client_secret=secret-on-server/);
  assert.match(String(calls[0].init.body), /code_verifier=pkce-verifier/);
  assert.equal(calls[1].init.headers.Authorization, 'Bearer erp-access');

  const verified = await api(app.baseUrl, 'verifyToken', { editorToken: login.token });
  assert.equal(verified.user, '王小明');
  assert.equal(app.database.table('設定').rows.some(row => row['帳號'] === 'ming@emctaipei.com'), true);
});

test('JSON media upload updates settings and reels and serves stored images', async t => {
  const app = await fixture();
  t.after(() => app.close());
  const login = await api(app.baseUrl, 'login', { account: 'machi.chen', password: 'secret' });
  const pngDataUrl = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=';

  const avatar = await api(app.baseUrl, 'uploadDesignerImage', { editorToken: login.token, designer: 'Machi', kind: 'avatar', mimeType: 'image/png', dataUrl: pngDataUrl });
  assert.equal(avatar.ok, true);
  assert.match(avatar.url, /\/media\/uploads\/Machi-avatar-/);
  const imageResponse = await fetch(avatar.url);
  assert.equal(imageResponse.status, 200);
  assert.equal(imageResponse.headers.get('content-type'), 'image/png');

  const story = await api(app.baseUrl, 'uploadDesignerImage', { editorToken: login.token, designer: 'Machi', kind: 'story', durationMinutes: 1440, mimeType: 'image/png', dataUrl: pngDataUrl });
  assert.equal(app.database.table('reels').rows.some(row => row['限時動態連結'] === story.url), true);
  assert.equal(app.database.table('reels').rows.find(row => row['限時動態連結'] === story.url)['保留期限'], '24小時');
  const media = await api(app.baseUrl, 'listDesignerMedia', { editorToken: login.token, designer: 'Machi' });
  assert.equal(media.profile.avatar, avatar.url);
  assert.equal(media.reels.some(reel => reel.imageUrl === story.url), true);

  const removed = await api(app.baseUrl, 'deleteDesignerMedia', { editorToken: login.token, designer: 'Machi', kind: 'story', url: story.url });
  assert.equal(removed.ok, true);
  assert.equal(app.database.table('reels').rows.some(row => row['限時動態連結'] === story.url), false);

  const userAvatar = await api(app.baseUrl, 'uploadUserAvatar', { editorToken: login.token, account: 'machi.chen@emctaipei.com', mimeType: 'image/png', dataUrl: pngDataUrl });
  assert.equal(userAvatar.settings.avatar, userAvatar.url);
});

test('designer story sync stores 24-hour and permanent expiration in JSON', async t => {
  const app = await fixture();
  t.after(() => app.close());
  const login = await api(app.baseUrl, 'login', { account: 'machi.chen', password: 'secret' });
  const expiresAt = Date.now() + 24 * 60 * 60 * 1000;
  const synced = await api(app.baseUrl, 'upsertDesignerStories', { editorToken: login.token, designer: 'Machi', fileIds: ['story-24'], imageUrls: ['https://drive.google.com/thumbnail?id=story-24&sz=w1000'], expiresAt });
  assert.equal(synced.count, 1);
  assert.equal(app.database.table('reels').rows.find(row => row['限時動態連結'].includes('story-24'))['保留期限'], '24小時');
  await api(app.baseUrl, 'upsertDesignerStories', { editorToken: login.token, designer: 'Machi', fileIds: ['story-forever'], imageUrls: ['https://drive.google.com/thumbnail?id=story-forever&sz=w1000'], expiresAt: 0 });
  const listed = await api(app.baseUrl, 'listReels');
  assert.equal(listed.reels.find(reel => reel.id === 'story-forever').retention, '永久');
  const deleted = await api(app.baseUrl, 'deleteDesignerStories', { editorToken: login.token, designer: 'Machi', fileIds: ['story-forever'] });
  assert.equal(deleted.deleted, 1);
});

test('designer media buttons persist replacements and deleted references in JSON', async t => {
  const app = await fixture();
  t.after(() => app.close());
  const login = await api(app.baseUrl, 'login', { account: 'machi.chen', password: 'secret' });
  const avatarId = 'drive-avatar-file';
  const posterId = 'drive-poster-file';
  const storyId = 'drive-story-file';

  const replaced = await api(app.baseUrl, 'saveDesignerProfiles', {
    editorToken: login.token,
    profiles: [{
      name: 'Machi',
      avatar: `https://drive.google.com/thumbnail?id=${avatarId}&sz=w1000`,
      poster: `https://drive.google.com/thumbnail?id=${posterId}&sz=w1000`,
      replyTemplates: { '社群貼文': '這是社群貼文的回信範本', '廣告素材': '這是廣告素材的回信範本' }
    }]
  });
  assert.equal(replaced.ok, true);
  const savedProfile = app.database.table('設定').rows.find(row => row['名字'] === 'Machi');
  assert.deepEqual(JSON.parse(savedProfile['回信範本設定']), {
    '社群貼文': '這是社群貼文的回信範本',
    '廣告素材': '這是廣告素材的回信範本'
  });
  const profiles = await api(app.baseUrl, 'listDesignerProfiles');
  assert.equal(profiles.profiles.find(profile => profile.name === 'Machi').replyTemplates['社群貼文'], '這是社群貼文的回信範本');
  await api(app.baseUrl, 'upsertDesignerStories', {
    editorToken: login.token,
    designer: 'Machi',
    fileIds: [storyId],
    imageUrls: [`https://lh3.googleusercontent.com/d/${storyId}=w1600`],
    expiresAt: 0
  });

  const deleted = await api(app.baseUrl, 'deleteDesignerMediaFiles', {
    editorToken: login.token,
    designer: 'Machi',
    fileIds: [avatarId, posterId, storyId]
  });
  assert.equal(deleted.ok, true);
  assert.deepEqual(deleted.cleared, ['avatar', 'poster']);
  assert.equal(deleted.deletedStories, 1);
  const profile = app.database.table('設定').rows.find(row => row['名字'] === 'Machi');
  assert.equal(profile['頭像連結'], '');
  assert.equal(profile['頭像大圖連結'], '');
  assert.equal(app.database.table('reels').rows.some(row => String(row['限時動態連結']).includes(storyId)), false);
});

test('member avatar upload keeps the returned JSON avatar without an immediate stale refresh', async () => {
  const html = await readFile(new URL('../../index.html', import.meta.url), 'utf8');
  assert.match(html, /lastAccountAvatarRefreshAt=Date\.now\(\);renderAccountAvatar\(\)/);
  assert.match(html, /closeUploadModal\(\{refreshUserAvatar:false\}\)/);
});

test('designer settings are reachable from media management accounts as well as designer settings accounts', async () => {
  const html = await readFile(new URL('../../index.html', import.meta.url), 'utf8');
  assert.match(html, /function canAccessDesignerSettings\(\)\{return accessAllowed\('designer\.settings',hasDesignerAccountRole\(\)\)\|\|accessAllowed\('media\.manage',hasDesignerAccountRole\(\)\)\}/);
  assert.match(html, /if\(!canAccessDesignerSettings\(\)\)\{setSync\('此帳號沒有設計師設定或圖片管理權限',true\);return\}/);
  assert.match(html, /show\('#accountDesignerSettings',loggedIn&&canAccessDesignerSettings\(\)\)/);
});

test('upload page forwards editorToken when replacing a designer poster from recent uploads', async () => {
  const html = await readFile(new URL('../../upload/upload.html', import.meta.url), 'utf8');
  const code = await readFile(new URL('../../upload/Code.gs', import.meta.url), 'utf8');
  assert.match(html, /runner\.replaceDesignerImage\(\{\s*designer:\s*authorizedDesigner,\s*fileId:\s*files\[0\]\.id,\s*kind:\s*kind,\s*editorToken:\s*editorToken\s*\}\);/s);
  assert.match(html, /runner\.replaceDesignerImage\(\{\s*designer:\s*authorizedDesigner,\s*fileId:\s*lastUploadedFile\.id,\s*kind:\s*kind,\s*editorToken:\s*editorToken\s*\}\);/s);
  assert.match(html, /runner\.deleteDesignerImages\(deletePayload\)/);
  assert.match(html, /machi-designer-media-updated/);
  assert.match(code, /verifyMediaManager_\(payload\.editorToken\);[\s\S]*callMainAppJsonAction_\('deleteDesignerMediaFiles'/);
  assert.match(code, /callMainAppJsonAction_\('saveDesignerProfiles',[\s\S]*profiles:\s*\[profile\]/);
});

test('the recent case list\'s two split tables can grow past their nominal even-fill height so a taller wrapped row does not hide the last row with no way to scroll to it', async () => {
  const html = await readFile(new URL('../../index.html', import.meta.url), 'utf8');
  // #modifyRecent 是 display:grid，兩個直欄（.modify-fixed／.modify-scroll）本身有 overflow:hidden／auto，
  // 這會讓它們對 grid 列高度的「最小內容尺寸」貢獻歸零（CSS Grid／Flexbox 規格對 overflow 非 visible 的
  // 項目的既定行為），如果同時維持預設的 align-items:stretch，兩欄就會被鎖死在 grid 列本身算出來的高度，
  // 內容（每一列列高由 JS 依文字換行等實際內容強制設定）真正需要的空間超過這個高度時就會被無聲裁掉、
  // 而且外層 #modifyRecent 的 scrollHeight 永遠等於 clientHeight（因為量測依據的正是這兩個被鎖死的直欄），
  // 完全沒有捲軸可以捲到看不到的最後一列。修法：改成 min-height:100%（只當下限，不當上限）＋
  // align-self:start（跳出預設的 stretch，讓兩欄改成純粹依內容高度決定自己的高度），兩者缺一不可——
  // 只改 min-height 不夠（已用瀏覽器測試驗證過，見這次修改紀錄），一定要兩個屬性一起才會生效。
  const fixedStart = html.indexOf('#modifyRecent .modify-fixed{');
  const fixedEnd = html.indexOf('}', fixedStart);
  const fixedRule = html.slice(fixedStart, fixedEnd + 1);
  assert.match(fixedRule, /min-height:100%!important/);
  assert.match(fixedRule, /align-self:start!important/);
  assert.doesNotMatch(fixedRule, /(?<!min-)height:100%!important/, '.modify-fixed 不能再用 height:100% 當硬性上限，否則內容過高時仍會被裁掉');
  const scrollStart = html.indexOf('#modifyRecent .modify-scroll{');
  const scrollEnd = html.indexOf('}', scrollStart);
  const scrollRule = html.slice(scrollStart, scrollEnd + 1);
  assert.match(scrollRule, /min-height:100%!important/);
  assert.match(scrollRule, /align-self:start!important/);
  assert.doesNotMatch(scrollRule, /(?<!min-)height:100%!important/, '.modify-scroll 不能再用 height:100% 當硬性上限，否則內容過高時仍會被裁掉');
});

test('the issue report modal lists reports before the content/suggestion fields, and its textareas render at 10px corners instead of the global 24px textarea rule', async () => {
  const html = await readFile(new URL('../../index.html', import.meta.url), 'utf8');
  const formStart = html.indexOf('<form class="issue-report-card" id="issueReportForm">');
  const formEnd = html.indexOf('</form>', formStart);
  assert.ok(formStart > 0 && formEnd > formStart);
  const formSource = html.slice(formStart, formEnd);
  // 列表要排在最前面（緊接標題列之後），內容／修改建議欄位往下排到分隔線之後，跟原本「先填欄位、
  // 列表在最下面」的順序相反——用四個標記字串在原始碼裡出現的先後順序驗證真正的排列，而不是只看
  // 個別字串存不存在。
  const listHeadIndex = formSource.indexOf('issue-report-list-head');
  const listIndex = formSource.indexOf('id="issueReportList"');
  const dividerIndex = formSource.indexOf('issue-report-divider');
  const contentFieldIndex = formSource.indexOf('name="content"');
  const suggestionFieldIndex = formSource.indexOf('name="suggestion"');
  assert.ok([listHeadIndex, listIndex, dividerIndex, contentFieldIndex, suggestionFieldIndex].every(i => i > 0));
  assert.ok(listHeadIndex < listIndex, '回報列表標題要在列表本身之前');
  assert.ok(listIndex < dividerIndex, '列表要排在分隔線之前，也就是排在內容／修改建議欄位之前');
  assert.ok(dividerIndex < contentFieldIndex, '分隔線要在內容欄位之前，內容欄位才會排在列表下方');
  assert.ok(contentFieldIndex < suggestionFieldIndex, '內容欄位要在修改建議欄位之前，維持原本兩者之間的相對順序');

  // 全站有一條把所有 <textarea> 統一成 24px 大圓角的規則（.gmail-rich-editor／.mail-template-row textarea／
  // 這次同一份工作也修過的 .signature-preset-content 都踩過同一個坑），問題回報的內容／修改建議欄位
  // 原本雖然局部宣告了 12px，但因為那條全站規則有 !important、局部宣告沒有，實際渲染出來是 24px、
  // 不是看起來寫的 12px——這次改成 10px 且補上 !important，確保真的贏過全站規則、渲染出來確實是 10px。
  assert.match(html, /\.issue-report-card textarea\{min-height:106px;border-radius:10px!important;/);
  assert.doesNotMatch(html, /\.issue-report-card textarea\{min-height:106px;border-radius:12px/);
});

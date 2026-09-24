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

test('Gmail thread messages all collapse by default (no auto-expanded message) and only expand on click', async () => {
  const html = await readFile(new URL('../../index.html', import.meta.url), 'utf8');
  // 這次改成「不管是不是最新一封，開啟信件串一律先收合」——見 AGENT.md 2026-08-26 這則紀錄；
  // 舊版的 isLatest 參數（只自動展開最新一封）整個拿掉，這裡明確驗證整個檔案完全沒有殘留。
  assert.doesNotMatch(html, /isLatest/);
  assert.match(html, /function gmailThreadMessageHtml\(message\)\{/);
  assert.match(html, /<details class="gmail-thread-msg" name="gmail-thread-message">/);
  assert.match(html, /function renderGmailThreadMessages\(list,messages\)\{const items=Array\.isArray\(messages\)\?messages:\[\];list\.innerHTML=items\.length\?items\.map\(message=>gmailThreadMessageHtml\(message\)\)\.join\(''\)/);
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
  const rendererStart = html.indexOf('function gmailThreadMessageHtml(message){');
  const rendererEnd = html.indexOf('function renderGmailThreadMessages(', rendererStart);
  assert.ok(rendererStart > 0 && rendererEnd > rendererStart);
  const messageRenderer = html.slice(rendererStart, rendererEnd);
  assert.match(messageRenderer, /gmailAddressNamesHtml\(message\.from\)/);
  assert.match(messageRenderer, /gmailAddressNamesHtml\(message\.to\)/);
  assert.match(messageRenderer, /gmailAddressNamesHtml\(message\.cc\)/);
});

test('Gmail thread messages render sanitized rich HTML (real formatting, not flattened plain text) with a strict tag/attribute allowlist', async () => {
  const html = await readFile(new URL('../../index.html', import.meta.url), 'utf8');
  // 危險標籤整段（含子節點）捨棄——script/iframe/svg/form 等常見注入向量都要在清單裡。
  assert.match(html, /GMAIL_THREAD_HTML_DROP_TAGS=new Set\(\[[^\]]*'script'[^\]]*'iframe'[^\]]*'svg'[^\]]*'form'[^\]]*\]\)/);
  // 保留清單只留下真正需要呈現格式的標籤（表格、連結、圖片、粗斜體等），且圖片/連結另外有各自的屬性白名單處理。
  assert.match(html, /GMAIL_THREAD_HTML_KEEP_TAGS=new Set\(\[[^\]]*'a'[^\]]*'table'[^\]]*'img'[^\]]*\]\)/);
  // 圖片一律只認 cid: 參照、比對 Worker 已經安全抓回來的 data: URI，不接受任意外部 src（防止已讀追蹤像素）。
  assert.match(html, /const cidMatch=src\.match\(\/\^cid:\(\.\+\)\$\/i\)/);
  assert.match(html, /if\(!resolved\)return;/);
  // 連結只允許 http(s)/mailto，且強制在新分頁開啟、不外洩 referrer。
  assert.match(html, /return \/\^\(https\?:\|mailto:\)\/i\.test\(url\)\?url:'';/);
  assert.match(html, /targetEl\.setAttribute\('target','_blank'\);targetEl\.setAttribute\('rel','noopener noreferrer'\)/);
  // style 屬性同時要通過屬性名稱白名單與危險樣式黑名單（javascript:／url\(／position:fixed 等 clickjacking 手法）。
  assert.match(html, /GMAIL_THREAD_HTML_STYLE_DANGEROUS=\/url\\\(\|expression\\\(\|javascript:\|@import\\b\|-moz-binding\|behavior\\s\*:\|position\\s\*:\\s\*\(fixed\|absolute\|sticky\)\/i/);
  // 解析用 DOMParser 產生獨立、還沒接上真實文件的樹（解析本身不會執行任何內容），絕不對原始字串呼叫 innerHTML。
  assert.match(html, /doc=new DOMParser\(\)\.parseFromString\(html,'text\/html'\)/);
  assert.doesNotMatch(html, /container\.innerHTML=rawHtml/);
  assert.doesNotMatch(html, /\.innerHTML=message\.bodyHtml/);
  // 內文優先用淨化過的 HTML（is-rich），解析失敗或沒有 HTML 版本才退回既有的純文字＋連結轉換。
  assert.match(html, /const rawHtml=String\(message\.bodyHtml\|\|''\)\.trim\(\)/);
  assert.match(html, /bodyContentHtml=sanitized\.html;isRich=true/);
  assert.match(html, /class="gmail-thread-msg-body\$\{isRich\?' is-rich':''\}"/);
  // 已經被淨化結果引用、內嵌進本文的圖片，要從縮圖清單濾掉，不會同一張圖在內文與縮圖各出現一次。
  assert.match(html, /const remainingImages=images\.filter\(img=>\{const cid=String\(img\?\.contentId\|\|''\)\.trim\(\)\.toLowerCase\(\); return !cid\|\|!usedContentIds\.has\(cid\)\}\)/);
  // is-rich 內容改用真正的 HTML 排版（保留表格/顏色/字級），不再是 white-space:pre-wrap 硬摺成純文字樣子；
  // 沿用既有 .gmail-inserted-signature 的 all:revert 清除做法，但保留容器本身的基礎文字色/字級，只重置子節點。
  assert.match(html, /\.gmail-thread-msg-body\.is-rich\{white-space:normal;overflow-x:auto\}/);
  assert.match(html, /\.gmail-thread-msg-body\.is-rich \*\{all:revert\}/);
  assert.match(html, /\.gmail-thread-msg-body\.is-rich table\{max-width:100%\}/);
  assert.match(html, /\.gmail-thread-msg-body\.is-rich img\{max-width:100%\}/);
  // 全站通用的 table/th/td{...!important} 規則一樣要排除信件內文，否則簽名檔/一般表格格式的信件內容會被壓平。
  assert.match(html, /table:not\(\.gmail-rich-editor table\):not\(\.signature-preset-content table\):not\(\.gmail-thread-msg-body table\)\{/);
  assert.match(html, /th:not\(\.gmail-rich-editor th\):not\(\.signature-preset-content th\):not\(\.gmail-thread-msg-body th\)\{/);
  assert.match(html, /td:not\(\.gmail-rich-editor td\):not\(\.signature-preset-content td\):not\(\.gmail-thread-msg-body td\)\{/);
});

test('Gmail thread signature stripping checks every saved signature (Gmail account signature plus all custom presets), not only the current default', async () => {
  const html = await readFile(new URL('../../index.html', import.meta.url), 'utf8');
  const start = html.indexOf('async function allKnownGmailSignatureHtmlList()');
  const end = html.indexOf('\n}', start);
  assert.ok(start > 0 && end > start);
  const source = html.slice(start, end);
  assert.match(source, /const gmailSignature=await ensureGmailSignatureLoaded\(\)/);
  assert.match(source, /const presetHtmlList=Object\.values\(currentAccountSignaturePresets\|\|\{\}\)\.map\(resolveSignaturePresetHtml\)/);
  assert.match(source, /return \[gmailSignature,\.\.\.presetHtmlList\]/);
  // 開啟信件串（讀信）與送出回覆後重新整理信件串，兩處都要把完整候選清單送給 Worker，
  // 不能只送「現在的預設簽名檔」單一一組——否則歷史信件用過的舊/其他命名簽名檔會比對失敗，格式跑版。
  const openCalls = [...html.matchAll(/const signatureCandidates=await allKnownGmailSignatureHtmlList\(\);\s*\n\s*const data=await sheetApi\('getCaseMailThread',\{caseId:id,signatureCandidates,editorToken:currentEditorToken\}\)/g)];
  assert.equal(openCalls.length, 2, 'expected exactly two getCaseMailThread call sites to send signatureCandidates');
});

test('gmailThreadTrustedImageSrc() allows https googleusercontent.com images (the app\'s own host plus Gmail\'s signature image proxy), rejecting other domains, domain-confusion tricks, and non-https', async () => {
  const html = await readFile(new URL('../../index.html', import.meta.url), 'utf8');
  const start = html.indexOf('const GMAIL_THREAD_TRUSTED_IMAGE_HOSTS=');
  const end = html.indexOf('function sanitizeGmailThreadAttributes(', start);
  assert.ok(start > 0 && end > start);
  const source = html.slice(start, end);
  const check = new Function(`${source};return gmailThreadTrustedImageSrc;`)();
  assert.equal(check('https://lh3.googleusercontent.com/d/fakeid=w1600'), true);
  // 公司簽名檔的 logo 與社群 icon 都放在 Gmail 的圖片代理（ci3…），不放行的話簽名檔左半邊會整個空掉。
  assert.equal(check('https://ci3.googleusercontent.com/mail-sig/AIorK4yzEmyEe1QBXYQ'), true);
  assert.equal(check('https://ci5.googleusercontent.com/proxy/abc'), true);
  assert.equal(check('https://evil.example/pixel.gif'), false);
  // 網域混淆：只接受 googleusercontent.com 本身的子網域，字尾像但不同網域的一律擋掉。
  assert.equal(check('https://lh3.googleusercontent.com.evil.example/x.png'), false);
  assert.equal(check('https://evilgoogleusercontent.com/x.png'), false);
  assert.equal(check('https://googleusercontent.com.attacker.net/x.png'), false);
  assert.equal(check('https://evil.example/?host=lh3.googleusercontent.com'), false);
  assert.equal(check('http://lh3.googleusercontent.com/d/x=w100'), false, 'must require https, not http');
  assert.equal(check(''), false);
  assert.equal(check('not a url'), false);
});

test('Gmail thread sanitizer allows images from the app\'s own trusted Drive host (for designer-reply auto-attached design images) in addition to cid: attachments, while every other external <img src> is still dropped', async () => {
  const html = await readFile(new URL('../../index.html', import.meta.url), 'utf8');
  // 圖片來源判斷要先試 cid:，查不到再退回信任網域，不能反過來（否則寄件人可以用 cid: 開頭但內容其實
  // 指向信任網域外的字串繞過 cidMap 檢查）；也要求 !cidMatch 才走信任網域這條路，避免「看起來像 cid: 但
  // 其實 cidMap 沒有對應資料」時又被誤判成信任網域網址（cid: 開頭的字串本來就不會通過 URL 的網域檢查，
  // 這裡主要是確保程式邏輯本身沒有寫反）。
  assert.match(html, /let resolved=cidMatch\?cidMap\.get\(cidMatch\[1\]\.trim\(\)\.toLowerCase\(\)\):null;/);
  assert.match(html, /if\(resolved\)\{usedContentIds\.add\(cidMatch\[1\]\.trim\(\)\.toLowerCase\(\)\)\}/);
  assert.match(html, /else if\(!cidMatch&&gmailThreadTrustedImageSrc\(src\)\)\{resolved=src\}/);
});

test('openDesignerReplyMailModal() restores the idempotency guard its own doc-comment describes but the code previously lacked: calling it again for the same already-open case+round is a no-op (does not wipe user-typed content or create a duplicate #gmailDesignerReplyImages), while a genuine round change still rebuilds', async () => {
  const html = await readFile(new URL('../../index.html', import.meta.url), 'utf8');
  const start = html.indexOf('async function openDesignerReplyMailModal(id');
  const end = html.indexOf('/** 「設計師回覆信」自動帶入的設計圖縮圖', start);
  assert.ok(start > 0 && end > start);
  const source = html.slice(start, end);
  assert.match(source, /const already=\$\('#gmailThreadModal'\);/);
  // 已開啟時提早返回；「信件編輯不同步圖片」上線後，返回前會先套用這次的勾選設定，但仍然不重建編輯器。
  assert.match(source, /if\(already&&!already\.hidden&&already\.dataset\.replyMode==='designer'&&String\(already\.dataset\.designerReplyCaseId\|\|''\)===String\(id\)&&String\(already\.dataset\.designerReplyRound\|\|''\)===String\(targetRoundBeforeOpen\)\)\{setDesignerReplySkipImages\(already,skipImages\);return\}/);
  // 這個提前 return 一定要在 await openGmailThreadModal(...)（會重新整個重讀信件串、重置一堆狀態）
  // 之前，跳過的意義才成立——不能等到跑完一輪網路請求才發現不需要重建。
  const guardIndex = source.indexOf('if(already&&!already.hidden');
  const awaitOpenThreadIndex = source.indexOf('await openGmailThreadModal(id,{lockUntilCaller:true});');
  assert.ok(guardIndex > 0 && awaitOpenThreadIndex > guardIndex, 'idempotency guard must run before re-opening the thread modal');
});

test('the "images-updated" handler no longer leaves the case-design-reply hand-off as a silent unhandled promise rejection: opening the reply editor and applying the just-uploaded images now has its own .catch() with an actionable message', async () => {
  const html = await readFile(new URL('../../index.html', import.meta.url), 'utf8');
  const start = html.indexOf("if(data.type==='machi-case-design-images-updated'){");
  const end = html.indexOf("if(data.type==='machi-nas-folder-backup-started'){", start);
  assert.ok(start > 0 && end > start);
  const source = html.slice(start, end);
  assert.match(source, /openDesignerReplyMailModal\(id,\{round:replyRound,skipImages:skipReplyImages\}\)\s*\n\s*\.then\(\(\)=>applyDesignerReplyImages\(id,designerReplyImagesForRound\(id,replyRound\),\{round:replyRound\}\)\)\s*\n\s*\.catch\(err=>setSync\(`圖片已上傳成功，但自動開啟回信編輯器失敗，請改點「回信」查看：\$\{err\.message\}`,true\)\);/);
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
  // 範本可能是格式化內容，改由 setGmailEditorTemplateContent 判斷要當 HTML 還是純文字帶入。
  assert.match(source, /setGmailEditorTemplateContent\(replyEditor,`Hi \$\{recipientName\},\\n\\n`,generalReplyTemplate\)/);
  assert.match(source, /replyEditor\.innerHTML===initialGeneralReplyHtml/);
  assert.doesNotMatch(source, /fromValue\.textContent=row\.gmailThreadOwnerAccount/);
});

test('designer reply can reuse the saved NAS path and only attaches the selected modification round', async () => {
  const html = await readFile(new URL('../../index.html', import.meta.url), 'utf8');
  const pickerServer = await readFile(new URL('../../scripts/nas_folder_picker_server.mjs', import.meta.url), 'utf8');
  assert.match(html, /data-source="same-nas"><span>同上次路徑<\/span>/);
  assert.match(html, /function reuseLastNasFolder\(id,round,\{afterReply=false,skipReplyImages=false\}=\{\}\)/);
  // 2026-09-22 起沿用的是案件「全部」的資料夾（folders），第一組仍保留給還沒更新的舊版選擇器相容。
  assert.match(html, /mode:'reuse',path:reuseFolders\[0\]\.path,keyword:reuseFolders\[0\]\.keyword\|\|'',folders:JSON\.stringify\(reuseFolders\)/);
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

test('front end keeps the earliest image for duplicate file names within the same revision round', async () => {
  const html = await readFile(new URL('../../index.html', import.meta.url), 'utf8');
  const source = html.match(/function normalizeRecordImageEntry\(item\)\{[^\n]+\}\nfunction parseRecordImages\(value\)\{[^\n]+\}/)?.[0] || '';
  assert.ok(source, 'could not locate modification image parser');
  const parse = new Function(`${source};return parseRecordImages;`)();
  assert.deepEqual(parse([
    { fileName: 'draft.png', url: 'https://example.test/original' },
    { fileName: 'DRAFT.PNG', url: 'https://example.test/duplicate-newer' },
    { fileName: 'other.png', url: 'https://example.test/other' }
  ]), [
    { fileName: 'draft.png', url: 'https://example.test/original' },
    { fileName: 'other.png', url: 'https://example.test/other' }
  ]);
});

test('selecting multiple NAS folders for a designer reply attaches every folder\'s images and every folder\'s path, not just the first one', async () => {
  const html = await readFile(new URL('../../index.html', import.meta.url), 'utf8');
  const pickerServer = await readFile(new URL('../../scripts/nas_folder_picker_server.mjs', import.meta.url), 'utf8');
  // openDesignerReplyMailModal / resolveDesignerReplyImages both take a `folders` array now, not a
  // single `folderPath` string -- the old signature silently dropped every folder past the first.
  assert.match(html, /async function openDesignerReplyMailModal\(id,\{folders=\[\],round=null,skipImages=null\}=\{\}\)\{/);
  assert.match(html, /async function resolveDesignerReplyImages\(id,\{folders=\[\],fileFolders=null,round=null,skipImages=null\}=\{\}\)\{/);
  assert.doesNotMatch(html, /folderPath=''/);
  // The "machi-nas-folder-selected" handler must pass every successfully-confirmed folder's path
  // through, not just successFolders[0].
  assert.match(html, /resolveDesignerReplyImages\(id,\{folders:successFolders\.map\(item=>item\.path\|\|''\)\.filter\(Boolean\),fileFolders:nasFileFolders,round:replyRound,skipImages:skipReplyImages\}\)/);
  // The EARLY "machi-nas-folder-backup-started" hand-off is what actually determines the rendered
  // text in the normal flow: openDesignerReplyMailModal's own idempotency guard means the later
  // "machi-nas-folder-selected" message will NOT rebuild the template if the modal is already open
  // for the same case+round, so if this early message only carried the first folder, every folder
  // past the first would never appear in the sent email regardless of what the later message says.
  assert.match(html, /const startedFolderPaths=\(Array\.isArray\(data\.paths\)&&data\.paths\.length\?data\.paths:\[data\.path\]\)\.map\(p=>String\(p\|\|''\)\.trim\(\)\)\.filter\(Boolean\);/);
  assert.match(html, /openDesignerReplyMailModal\(activeNasFolderPickerCaseId,\{folders:startedFolderPaths,round:activeNasFolderPickerRound,skipImages:nasFolderPickerSkipReplyImages\}\)/);
  // The picker server's backup-started message has to actually carry every requested folder's path
  // (not just foldersToSubmit[0]) for the above to have anything to read.
  assert.match(pickerServer, /type: 'machi-nas-folder-backup-started', caseId, nonce, path: foldersToSubmit\[0\]\.path, paths: foldersToSubmit\.map\(item => item\.path\)/);

  // The NAS-path block lives in its own container so it can be redrawn once the backup reports which
  // folders were actually confirmed -- the modal is opened when the backup STARTS (before the server
  // has validated anything), and an already-open modal for the same case+round is deliberately not
  // rebuilt, so without a redraw the editor could keep showing a stale, shorter folder list.
  assert.match(html, /nasPathsContainer\.id='gmailDesignerReplyNasPaths';/);
  assert.match(html, /if\(designerReplyFolderList\(folders\)\.length\)renderDesignerReplyNasPaths\(folders\);/);

  // Exercise the real rendering function (extracted verbatim from index.html) against a fake DOM.
  const listSource = html.match(/function designerReplyFolderList\(folders\)\{[\s\S]*?\n\}\n/)?.[0];
  const renderSource = html.match(/function renderDesignerReplyNasPaths\(folders\)\{[\s\S]*?\n\}\n/)?.[0];
  const stateSource = html.match(/const designerReplyNasRenderedHtml=new WeakMap\(\);/)?.[0];
  assert.ok(listSource && renderSource && stateSource, 'could not locate the NAS-path rendering block and state');
  assert.doesNotMatch(html, /nasPathsContainer\.contentEditable='false'/);

  const renderFolderPaths = folders => {
    const children = [];
    const container = {
      children, dataset: {},
      get innerHTML() { return children.map(node => node.tag === '#text' ? node.textContent : `<${node.tag}>${node.textContent}</${node.tag}>`).join(''); },
      set textContent(value) { children.length = 0; if(value)children.push({tag:'#text',textContent:value}); },
      appendChild: node => children.push(node)
    };
    const fakeDocument = {
      getElementById: id => (id === 'gmailDesignerReplyNasPaths' ? container : null),
      createElement: tag => ({ tag, textContent: '' }),
      createTextNode: text => ({ tag: '#text', textContent: text })
    };
    const fn = new Function('document', `${stateSource}\n${listSource}\n${renderSource}\nreturn renderDesignerReplyNasPaths;`)(fakeDocument);
    fn(folders);
    return { children, container, render: fn };
  };

  const multi = renderFolderPaths(['NAS/資料夾A', 'NAS/資料夾B']);
  assert.deepEqual(multi.children.filter(node => node.tag === 'b').map(node => node.textContent), ['NAS/資料夾A', 'NAS/資料夾B']);
  assert.equal(multi.children.find(node => node.tag === '#text').textContent, ' NAS路徑（共 2 個資料夾）');
  // The folder list is recorded on the container so the video-path block can tell whether the source
  // folder is unambiguous without re-deriving it.
  assert.deepEqual(JSON.parse(multi.container.dataset.nasFolders), ['NAS/資料夾A', 'NAS/資料夾B']);

  const single = renderFolderPaths(['NAS/單一資料夾']);
  assert.deepEqual(single.children.filter(node => node.tag === 'b').map(node => node.textContent), ['NAS/單一資料夾']);
  assert.equal(single.children.find(node => node.tag === '#text').textContent, ' NAS路徑'); // unchanged wording for the single-folder case

  // The same folder picked twice is one folder, not two identical "sources" in the email.
  const duplicated = renderFolderPaths(['NAS/資料夾A', 'NAS/資料夾A']);
  assert.deepEqual(duplicated.children.filter(node => node.tag === 'b').map(node => node.textContent), ['NAS/資料夾A']);
  assert.equal(duplicated.children.find(node => node.tag === '#text').textContent, ' NAS路徑');

  assert.equal(renderFolderPaths([]).children.length, 0);
  const refreshed = renderFolderPaths(['NAS/原始']);
  refreshed.render(['NAS/確認A', 'NAS/確認B']);
  assert.deepEqual(refreshed.children.filter(node => node.tag === 'b').map(node => node.textContent), ['NAS/確認A', 'NAS/確認B']);
  for(const editedText of ['NAS/使用者修改', '']){
    const edited = renderFolderPaths(['NAS/原始']);
    edited.container.textContent = editedText;
    edited.render(['NAS/備份完成']);
    assert.equal(edited.container.innerHTML, editedText, 'backup completion must preserve edited or deleted text');
    assert.deepEqual(JSON.parse(edited.container.dataset.nasFolders), ['NAS/備份完成']);
  }

  // The picker page must not add the same path to the multi-select list twice either.
  assert.match(pickerServer, /const existing = selectedFolders\.find\(item => item\.path === relPath\);/);
});

test('concurrent designer-reply opens for the same case+round are de-duplicated before any await, so a slow first initialization cannot land after the images and re-stick the editor on "圖片上傳中..."', async () => {
  const html = await readFile(new URL('../../index.html', import.meta.url), 'utf8');

  // The bug: the old re-entrancy guard relied on modal.dataset.replyMode==='designer', which is only
  // set AFTER `await openGmailThreadModal(...)` (a network read of the whole Gmail thread). The NAS
  // "backup started" and "backup finished" messages are independent, so whenever the backup finished
  // faster than the thread read, the second message slipped through the guard and ran a second full
  // initialization. Whichever initialization finished last re-inserted the "圖片上傳中..." placeholder
  // and re-disabled the send button -- after applyDesignerReplyImages() had already placed the images.
  // The registration must therefore happen synchronously, before any await.
  const wrapper = html.match(/let designerReplyModalOpening=null;\nasync function openDesignerReplyMailModal\(id,\{folders=\[\],round=null,skipImages=null\}=\{\}\)\{[\s\S]*?\n\}\n/)?.[0];
  assert.ok(wrapper, 'could not locate the openDesignerReplyMailModal de-duplication wrapper');

  const makeOpener = (builder, currentRound = 0) => new Function('rows', 'currentModificationRound', 'buildDesignerReplyMailModal', `
    ${wrapper}
    return openDesignerReplyMailModal;
  `)([{ id: 'C1' }, { id: 'C2' }], () => currentRound, builder);

  // Two concurrent opens for the same case+round must share one initialization.
  let builds = 0;
  let release;
  const gate = new Promise(resolve => { release = resolve; });
  let opener = makeOpener(() => { builds += 1; return gate; });
  const first = opener('C1', { folders: ['A/B'], round: 0 });
  const second = opener('C1', { folders: ['A/B'], round: 0 });
  assert.equal(builds, 1, 'the second concurrent open must reuse the in-flight initialization');
  release();
  await Promise.all([first, second]);

  // Once settled the registry is cleared, so a genuinely new open still initializes.
  await opener('C1', { folders: ['A/B'], round: 0 });
  assert.equal(builds, 2, 'a later open (after the first settled) must initialize again');

  // A different round is a different target and must not be swallowed by the de-duplication.
  builds = 0;
  let release2;
  const gate2 = new Promise(resolve => { release2 = resolve; });
  opener = makeOpener(() => { builds += 1; return gate2; });
  const roundZero = opener('C1', { folders: ['A/B'], round: 0 });
  const roundOne = opener('C1', { folders: ['A/B'], round: 1 });
  assert.equal(builds, 2, 'a different round must run its own initialization');
  release2();
  await Promise.all([roundZero, roundOne]);

  // A failed initialization must not leave the registry poisoned for later attempts.
  builds = 0;
  opener = makeOpener(() => { builds += 1; return Promise.reject(new Error('boom')); });
  await assert.rejects(opener('C1', { folders: ['A/B'], round: 0 }), /boom/);
  await assert.rejects(opener('C1', { folders: ['A/B'], round: 0 }), /boom/);
  assert.equal(builds, 2, 'a rejected initialization must clear the in-flight registry');

  // resolveDesignerReplyImages must wait for an in-flight initialization before deciding whether the
  // modal is "already open" -- otherwise it re-opens and races the initialization it should have joined.
  assert.match(html, /if\(designerReplyModalOpening\)await designerReplyModalOpening\.promise\.catch\(\(\)=>\{\}\);/);

  // The machi-nas-folder-selected call site had no .catch(): any rejection there was an entirely silent
  // unhandled rejection, leaving the editor stuck with no message explaining why.
  assert.match(html, /resolveDesignerReplyImages\(id,\{folders:successFolders\.map\(item=>item\.path\|\|''\)\.filter\(Boolean\),fileFolders:nasFileFolders,round:replyRound,skipImages:skipReplyImages\}\)\s*\n\s*\.catch\(err=>setSync\(/);
});

test('designer reply lists every backed-up video\'s full NAS path (folder + filename + extension), attributing each video to the folder it actually came from even when several folders were picked', async () => {
  const html = await readFile(new URL('../../index.html', import.meta.url), 'utf8');
  const lib = await readFile(new URL('../../scripts/nas_design_image_lib.mjs', import.meta.url), 'utf8');
  const pickerServer = await readFile(new URL('../../scripts/nas_folder_picker_server.mjs', import.meta.url), 'utf8');

  // A video is delivered to the email as a single auto-captured screenshot, so the recipient needs the
  // real file path to actually watch it. With several source folders the filename alone cannot say which
  // folder it came from, so the picker reports, per folder, exactly which files it uploaded.
  assert.match(lib, /const uploadedFiles = \[\];/);
  assert.match(lib, /for \(const item of chunk\) uploadedFiles\.push\(path\.basename\(item\.relPath\)\);/);
  assert.match(lib, /return \{ round, uploadedCount, uploadedFiles,/);
  assert.match(pickerServer, /uploadedFiles: upload\.uploadedFiles \|\| \[\]/);
  assert.match(html, /for\(const fileName of \(Array\.isArray\(folder\.backup\?\.uploadedFiles\)\?folder\.backup\.uploadedFiles:\[\]\)\)\{/);

  const extSource = html.match(/const DESIGNER_REPLY_VIDEO_EXTENSIONS=\[[^\]]*\];\nfunction isDesignerReplyVideoFileName\(fileName\)\{[^\n]*\}\n/)?.[0];
  const videoStateSource = html.match(/const designerReplyVideoRenderedHtml=new WeakMap\(\);/)?.[0];
  const funcSource = html.match(/function applyDesignerReplyVideoPaths\(images\)\{[\s\S]*?\n\}\n/)?.[0];
  assert.ok(extSource && videoStateSource && funcSource, 'could not locate applyDesignerReplyVideoPaths');

  const run = (images, folderPaths, fileFolders) => {
    const children = [];
    const container = {
      children, textContent: '', removed: false,
      dataset: fileFolders === undefined ? {} : { nasFileFolders: JSON.stringify(fileFolders) },
      appendChild: node => children.push(node),
      remove: () => { container.removed = true; }
    };
    const nasContainer = { dataset: folderPaths === undefined ? {} : { nasFolders: JSON.stringify(folderPaths) } };
    const fakeDocument = {
      getElementById: id => (id === 'gmailDesignerReplyVideoPaths' ? container
        : id === 'gmailDesignerReplyNasPaths' ? nasContainer : null),
      createElement: tag => ({ tag, textContent: '' }),
      createTextNode: text => ({ tag: '#text', textContent: text })
    };
    const fn = new Function('document', 'WeakMap', `${extSource}\n${videoStateSource}\n${funcSource}\nreturn applyDesignerReplyVideoPaths;`)(fakeDocument, WeakMap);
    fn(images);
    return container;
  };
  const boldOf = container => container.children.filter(node => node.tag === 'b').map(node => node.textContent);
  const labelOf = container => container.children.find(node => node.tag === '#text')?.textContent;

  // The reported bug: several folders picked, so each video must be paired with ITS OWN folder.
  const multi = run(
    [{ fileName: '260908_A_包框影片_02.mp4' }, { fileName: '260908_B_包框影片_05.MOV' }, { fileName: 'photo.jpg' }],
    ['專案企劃部/執行中/DJI/廣告素材/2026/9月', '專案企劃部/執行中/添可/廣告素材/2026/9月/第二波'],
    { '260908_A_包框影片_02.mp4': '專案企劃部/執行中/DJI/廣告素材/2026/9月',
      '260908_B_包框影片_05.MOV': '專案企劃部/執行中/添可/廣告素材/2026/9月/第二波' }
  );
  assert.equal(multi.removed, false);
  assert.deepEqual(boldOf(multi), [
    '專案企劃部/執行中/DJI/廣告素材/2026/9月/260908_A_包框影片_02.mp4',
    '專案企劃部/執行中/添可/廣告素材/2026/9月/第二波/260908_B_包框影片_05.MOV'
  ]);
  assert.equal(labelOf(multi), ' 影片路徑（共 2 支）');

  // One folder and no attribution map (e.g. reused path / computer upload): the sole folder is used.
  const single = run([{ fileName: 'clip.mp4' }], ['A/B']);
  assert.deepEqual(boldOf(single), ['A/B/clip.mp4']);
  assert.equal(labelOf(single), ' 影片路徑'); // no "共 N 支" wording for a single video

  // Several folders but this video is not in the map -> cannot attribute it, so skip rather than guess.
  const unattributable = run([{ fileName: 'mystery.mp4' }], ['A/B', 'C/D'], { 'other.mp4': 'A/B' });
  assert.equal(unattributable.removed, true);

  // A partially attributable batch still lists the ones it can place.
  const partial = run([{ fileName: 'known.mp4' }, { fileName: 'mystery.mp4' }], ['A/B', 'C/D'], { 'known.mp4': 'C/D' });
  assert.deepEqual(boldOf(partial), ['C/D/known.mp4']);
  assert.equal(labelOf(partial), ' 影片路徑');

  // No videos in this round -> placeholder removed, no empty block left in the email.
  assert.equal(run([{ fileName: 'photo.jpg' }], ['A/B']).removed, true);
  // No folder recorded at all -> nothing to build a path from.
  assert.equal(run([{ fileName: 'clip.mp4' }], []).removed, true);
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

test('Gmail compose/reply editors support attaching arbitrary non-inline files (not just images): a paperclip toolbar button + unrestricted-type hidden file input exist in both editors, added files render as removable chips outside the contenteditable body, gmailEditorMailPayload() exposes them as {fileName,mimeType,base64} (matching what the Worker\'s resolveGmailAttachments() expects), every outgoing send/schedule/update action forwards attachments, client-side limits mirror the Worker\'s 15MB/15MB/10-file limits, every editor-reset call site also clears stale attachments (so a previous case\'s attachments cannot leak into the next one), a reloaded scheduled draft restores its saved attachments, sending waits for in-flight attachment reads to finish before serializing the payload, and the batch post-submit queue (which cannot attribute attachments to the right draft) blocks the feature the same way it already blocks inline images', async () => {
  const html = await readFile(new URL('../../index.html', import.meta.url), 'utf8');

  // 兩個編輯區（撰寫、回信）的工具列都要有附加檔案按鈕＋不限型別的隱藏 file input＋附件小卡片容器。
  for (const editorId of ['gmailComposeEditor', 'gmailThreadReplyEditor']) {
    assert.match(html, new RegExp(`class="gmail-rich-attachment-btn" data-rich-attachment-for="${editorId}" title="附加檔案" aria-label="附加檔案"`));
    const inputPattern = new RegExp(`<input type="file" class="gmail-rich-attachment-input" data-rich-attachment-input-for="${editorId}" multiple hidden>`);
    assert.match(html, inputPattern);
    assert.doesNotMatch(html, new RegExp(`data-rich-attachment-input-for="${editorId}"[^>]*accept=`), `${editorId}'s attachment input must not restrict file type the way the image input does`);
    assert.match(html, new RegExp(`class="gmail-attachment-list" data-attachment-list-for="${editorId}" hidden`));
  }
  // 隱藏 input 額外補上跟既有 .gmail-rich-image-input 同一種防禦性 CSS 覆寫（這個檔案已經反覆記錄過
  // 「只靠 hidden 屬性不夠保險」的教訓），不是只靠 hidden 屬性。
  assert.match(html, /\.gmail-rich-attachment-input\{display:none!important\}/);

  // 核心 store／render／add／remove／restore／queue 函式都存在，且限制數字跟 Worker 端
  // GMAIL_ATTACHMENT_MAX_BYTES／GMAIL_ATTACHMENT_MAX_TOTAL_BYTES／GMAIL_ATTACHMENT_MAX_COUNT 完全一致
  // （15 MB／15 MB／10 個）——前端這層只是體驗優化，真正的邊界仍然在 Worker，但數字不一致會讓使用者
  // 選了「前端覺得OK」卻被 Worker 拒絕的檔案，白白多一次往返。
  assert.match(html, /const gmailAttachmentMaxCount=10,gmailAttachmentMaxBytes=15\*1024\*1024,gmailAttachmentMaxTotalBytes=15\*1024\*1024;/);
  assert.match(html, /function gmailAttachmentStore\(editorId\)\{/);
  assert.match(html, /function clearGmailAttachments\(editorId\)\{/);
  assert.match(html, /function renderGmailAttachmentChips\(editorId\)\{/);
  assert.match(html, /function removeGmailAttachment\(editorId,attachmentId\)\{/);
  assert.match(html, /async function addGmailAttachments\(editorId,fileList\)\{/);
  assert.match(html, /function restoreScheduledGmailAttachments\(editorId,items\)\{/);
  assert.match(html, /function queueGmailAttachments\(editorId,fileList\)\{/);
  assert.match(html, /async function waitForGmailAttachments\(editorId\)\{/);

  const addFnStart = html.indexOf('async function addGmailAttachments(editorId,fileList){');
  const addFnEnd = html.indexOf('\n}', addFnStart);
  const addFnSource = html.slice(addFnStart, addFnEnd);
  assert.match(addFnSource, /if\(postSubmitQueue\)\{setSync\('批次確認寄信流程暫不支援附加檔案/, 'batch post-submit queue must block attachments the same way it blocks inline images, since attachments are keyed by editor id and cannot be attributed to a specific draft');
  assert.match(addFnSource, /if\(store\.size>=gmailAttachmentMaxCount\)/);
  assert.match(addFnSource, /if\(file\.size>gmailAttachmentMaxBytes\)/);
  assert.match(addFnSource, /if\(totalBytes\+file\.size>gmailAttachmentMaxTotalBytes\)/);

  // gmailEditorMailPayload() 只送出 Worker resolveGmailAttachments() 實際需要的三個欄位，不會把內部
  // 用來畫小卡片的 id/bytes 也送出去。
  assert.match(html, /const attachments=\[\.\.\.gmailAttachmentStore\(editor\.id\)\.values\(\)\]\.map\(item=>\(\{fileName:item\.fileName,mimeType:item\.mimeType,base64:item\.base64\}\)\);/);
  assert.match(html, /return \{\s*bodyHtml:prepared\.bodyHtml,\s*scheduledBodyHtml:prepared\.scheduledBodyHtml,\s*insertedSignatureHtml:prepared\.insertedSignatureHtml,\s*inlineImages,\s*attachments,\s*signatureInserted:prepared\.signatureInserted\s*\};/);

  // 六個寄信/排程/更新排程的 action 呼叫都要帶上附件（含批次確認寄信流程刻意固定傳空陣列，跟
  // inlineImages:[] 同一個理由——那個模式完全不支援插入照片或附加檔案）。
  // The batch queue still sends no inline images and no attachments; it now also carries caseIds so a
  // merged mail can bind its thread to every case it covers.
  assert.match(html, /sheetApi\('sendCaseMail',\{caseId:ids\[0\],caseIds:ids,to,cc,subject:subjectText,bodyHtml:prepared\.bodyHtml,signatureHtml:prepared\.signatureHtml,inlineImages:\[\],attachments:\[\],editorToken:currentEditorToken\}\)/);
  assert.match(html, /sheetApi\('sendCaseMail',\{caseId:id,to,cc,subject,bodyHtml,signatureHtml,inlineImages,attachments,editorToken:currentEditorToken\}\)/);
  assert.match(html, /sheetApi\('updateScheduledMail',\{id:state\.id,to,cc,subject,bodyHtml:editorPayload\.scheduledBodyHtml,signatureHtml,inlineImages:editorPayload\.inlineImages,attachments:editorPayload\.attachments,scheduledAt,editorToken:currentEditorToken\}\)/);
  // 排程首信跟 sendCaseMail 一樣改帶整批 caseIds，合併信件才能排程（單筆案件時陣列裡就只有一個編號）。
  assert.match(html, /sheetApi\('scheduleCaseMail',\{caseId:ids\[0\]\|\|id,caseIds:ids,to,cc,subject,bodyHtml,signatureHtml,inlineImages,attachments,scheduledAt,editorToken:currentEditorToken\}\)/);
  assert.match(html, /sheetApi\('scheduleCaseReply',\{caseId:id,to,cc,bodyHtml:editorPayload\.scheduledBodyHtml,signatureHtml,inlineImages:editorPayload\.inlineImages,attachments:editorPayload\.attachments,scheduledAt,editorToken:currentEditorToken\}\)/);
  assert.match(html, /sheetApi\('replyCaseMail',\{caseId:id,to,cc,bodyHtml:editorPayload\.bodyHtml,signatureHtml,inlineImages:editorPayload\.inlineImages,attachments:editorPayload\.attachments,editorToken:currentEditorToken\}\)/);

  // clearGmailInlineImages(...) 與 clearGmailAttachments(...) 各自都應該剛好出現 7 次：1 個函式宣告
  // （`function clearGmailInlineImages(editorId){` 本身的參數列表也會被下面這個「函式呼叫」正規表達式
  // 命中，兩邊都一樣）＋各自的「還原時內部自清」那一次（restoreScheduledGmailInlineImages／
  // restoreScheduledGmailAttachments 開頭都會先清空自己）＋5 個「重置編輯區」呼叫點。這裡改用「兩者
  // 出現次數是否相等」驗證同步增減，而不是鎖住每一處呼叫的確切上下文字串（容易因為周圍程式碼調整
  // 而誤判失敗）。
  const clearInlineCallSites = [...html.matchAll(/clearGmailInlineImages\((\w+(?:\.id)?)\)/g)];
  const clearAttachmentCallSites = [...html.matchAll(/clearGmailAttachments\((\w+(?:\.id)?)\)/g)];
  assert.equal(clearInlineCallSites.length, 7, 'expected 1 declaration + 1 internal restore-clear + 5 editor-reset call sites for clearGmailInlineImages');
  assert.equal(clearAttachmentCallSites.length, 7, 'expected 1 declaration + 1 internal restore-clear + 5 editor-reset call sites for clearGmailAttachments');

  // 排程草稿載入回編輯器時，附件要跟著內嵌圖片一起還原。
  assert.match(html, /restoreScheduledGmailInlineImages\(ui\.editor,item\.inlineImages\|\|\[\]\);\s*\n\s*restoreScheduledGmailAttachments\(ui\.editor\.id,item\.attachments\|\|\[\]\);/);

  // 五個會真正送出信件/建立排程的地方，等待內嵌圖片處理完成之後，緊接著也要等待附件處理完成——
  // 用「兩者呼叫次數相等」而非逐一鎖定上下文，理由同上。
  const waitInlineCallSites = [...html.matchAll(/await waitForGmailInlineImages\(([\w.]+)\);/g)];
  const waitAttachmentCallSites = [...html.matchAll(/await waitForGmailAttachments\(([\w.]+)\);/g)];
  assert.equal(waitInlineCallSites.length, 5);
  assert.equal(waitAttachmentCallSites.length, 5);
  assert.deepEqual(waitInlineCallSites.map(m => m[1]), waitAttachmentCallSites.map(m => m[1]), 'each waitForGmailInlineImages call site must be immediately paired with the matching waitForGmailAttachments call using the same editor reference');

  // 附加檔案按鈕跟插入照片按鈕一樣，在批次確認寄信流程中要被隱藏／恢復顯示。
  assert.match(html, /const imageBtn=document\.querySelector\('\.gmail-rich-image-btn\[data-rich-image-for="gmailComposeEditor"\]'\); if\(imageBtn\)imageBtn\.hidden=false;\s*\n\s*const attachmentBtn=document\.querySelector\('\.gmail-rich-attachment-btn\[data-rich-attachment-for="gmailComposeEditor"\]'\); if\(attachmentBtn\)attachmentBtn\.hidden=false;/);
  assert.match(html, /const imageBtn=document\.querySelector\('\.gmail-rich-image-btn\[data-rich-image-for="gmailComposeEditor"\]'\); if\(imageBtn\)imageBtn\.hidden=true;\s*\n\s*const attachmentBtn=document\.querySelector\('\.gmail-rich-attachment-btn\[data-rich-attachment-for="gmailComposeEditor"\]'\); if\(attachmentBtn\)attachmentBtn\.hidden=true;/);

  // 事件委派：工具列按鈕點擊觸發隱藏 input、input change 觸發佇列處理、小卡片上的移除按鈕用事件
  // 委派處理（不是每個小卡片各自綁一次，附件清單會隨新增/移除整段重繪 innerHTML，逐一綁定的監聽器
  // 會在下一次重繪時全部失效）。
  assert.match(html, /document\.querySelectorAll\('\.gmail-rich-attachment-btn'\)\.forEach\(button=>button\.addEventListener\('click',\(\)=>document\.querySelector\(`\[data-rich-attachment-input-for="\$\{button\.dataset\.richAttachmentFor\}"\]`\)\?\.click\(\)\)\);/);
  assert.match(html, /document\.querySelectorAll\('\.gmail-rich-attachment-input'\)\.forEach\(input=>input\.addEventListener\('change',\(\)=>\{queueGmailAttachments\(input\.dataset\.richAttachmentInputFor,input\.files\);input\.value=''\}\)\);/);
  assert.match(html, /document\.querySelectorAll\('\.gmail-attachment-list'\)\.forEach\(list=>list\.addEventListener\('click',event=>\{/);
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
  // openDesignerReplyMailModal is only the de-duplicating entry point now (see the concurrency test
  // above); buildDesignerReplyMailModal is where that flow's editor content -- including the
  // signature -- is actually assembled.
  for (const functionName of ['renderPostSubmitGmailDraft', 'openGmailComposeModal', 'openGmailThreadModal', 'openModificationRequestReplyModal', 'buildDesignerReplyMailModal']) {
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
  // 函式簽名多了 scope（設計師設定一次列多位設計師，radio 名稱要分開）。
  const rowHtmlStart = html.indexOf("function signaturePresetRowHtml(name='',content='',index=0,{defaultKey='',scope='personal'}={}){");
  const rowHtmlEnd = html.indexOf('\nfunction syncSignaturePresetRows', rowHtmlStart);
  assert.ok(rowHtmlStart > 0 && rowHtmlEnd > rowHtmlStart);
  const rowHtmlSource = html.slice(rowHtmlStart, rowHtmlEnd);
  // 工具列改由與信件範本共用的 richSettingsToolbarHtml() 產生，按鈕本身改在那支函式裡驗證
  //（見「signature and mail template editors in personal settings get the same rich toolbar」）。
  assert.match(rowHtmlSource, /\$\{richSettingsToolbarHtml\('signature-preset-toolbar'\)\}/);
  const sharedToolbar = html.match(/function richSettingsToolbarHtml\(extraClass='',\{recipientName=false,details=false\}=\{\}\)\{[\s\S]*?\n\}/)?.[0] || '';
  for (const cmd of ['bold', 'justifyLeft', 'justifyCenter', 'justifyRight']) {
    assert.ok(sharedToolbar.includes(`data-rich-cmd="${cmd}"`), `共用工具列缺少 ${cmd}`);
  }
  assert.match(sharedToolbar, /class="gmail-rich-size-btn" data-rich-size title="文字大小"/);
  assert.match(sharedToolbar, /class="gmail-rich-color-btn" title="文字與背景顏色"/);
  assert.match(rowHtmlSource, /\$\{resolveSignaturePresetHtml\(content\)\}/, '初始內容要用 resolveSignaturePresetHtml 轉換，不能直接把 content 塞進 innerHTML（未逃脫過的舊版純文字資料會被當成標籤解析）');

  // bindSignaturePresetEditor 要用事件委派掛在 list 容器上（不是頁面載入當下的一次性 querySelectorAll），
  // 因為簽名檔列是動態新增/刪除的；粗體/對齊靠 document.execCommand()，文字大小/顏色是彈出選單、要在
  // mousedown 階段先存下選取範圍供稍後還原，兩者都跟既有 Gmail 撰寫/回信編輯器工具列共用同一套機制。
  const bindStart = html.indexOf('function bindSignaturePresetEditor(list){');
  const bindEnd = html.indexOf('\n/** 送出前驗證', bindStart);
  assert.ok(bindStart > 0 && bindEnd > bindStart);
  const bindSource = html.slice(bindStart, bindEnd);
  // 工具列互動改成與信件範本共用 bindRichSettingsEditor()；簽名檔這支只保留自己的列操作。
  assert.match(bindSource, /bindRichSettingsEditor\(list,'\[data-signature-preset-content\]'\);/);
  assert.match(bindSource, /list\.addEventListener\('click'/);
  const sharedBind = html.match(/function bindRichSettingsEditor\(list,contentSelector\)\{[\s\S]*?\n\}/)?.[0] || '';
  assert.match(sharedBind, /list\.addEventListener\('mousedown'/);
  assert.match(sharedBind, /document\.execCommand\(cmdButton\.dataset\.richCmd\)/);
  assert.match(sharedBind, /openGmailSizePalette\(sizeButton\)/);
  assert.match(sharedBind, /openGmailColorPalette\(colorButton\)/);
  assert.match(sharedBind, /savedRichSelectionRange=captureCurrentRichSelection\(\)/);

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
  const departmentSource = html.split('\n').find(row => row.startsWith('function normalizeDepartmentName('));
  assert.ok(departmentSource, 'could not locate normalizeDepartmentName');
  const matches = new Function('canonicalAccountClient', 'normalizeDesignGroup', `${departmentSource}\n${ruleSource};return customerEditRuleMatches;`)(canonical, normalizeGroup);
  assert.equal(matches('department:設計部', 'tester@example.com', '測試員', '平面'), true);
  // 「凱曜」是公司名稱：凱曜專案部＝專案部。
  assert.equal(matches('department:專案部', 'pm@example.com', '凱曜專案部', 'Odin組'), true);
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
  // 排程建立後要把案件加進信件串輪詢；合併信件一次涵蓋多筆案件，所以是逐一註冊。
  assert.match(html, /ids\.forEach\(caseId=>watchScheduledCaseThread\(caseId,scheduledAt\)\)/);
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
  const departmentSource = html.split('\n').find(row => row.startsWith('function normalizeDepartmentName('));
  assert.ok(departmentSource, 'could not locate normalizeDepartmentName');
  const source = `${departmentSource}\n${html.slice(start, end)}`;
  const settings = [
    { '部門': '企劃部', '組別': '', '顯示名': 'Planner', '帳號': 'planner@example.com' },
    { '部門': '設計部', '組別': '平面', '顯示名': 'Flat', '帳號': 'flat@example.com' },
    { '部門': '設計部', '組別': '影音', '顯示名': 'Video', '帳號': 'video@example.com' },
    { '部門': '負責人', '組別': '', '顯示名': 'Owner', '帳號': 'owner@example.com' },
    { '部門': '專案部', '組別': 'Celine組', '顯示名': 'Member', '帳號': 'member@example.com' },
    { '部門': '測試員', '組別': '', '顯示名': 'Tester', '帳號': 'tester@example.com' },
    { '部門': '監測部', '組別': '', '顯示名': 'Monitor', '帳號': 'monitor@example.com' },
    { '部門': '管理部', '組別': '人資行政組', '顯示名': 'Admin', '帳號': 'admin@example.com' },
    { '部門': '凱曜管理部', '組別': '財務出納組', '顯示名': 'Finance', '帳號': 'finance@example.com' }
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
  assert.equal(result.contacts.some(contact => ['Tester','Monitor','Admin','Finance'].includes(contact.name)), false);
  assert.match(result.markup, /<details class="gmail-recipient-group" data-recipient-group="企劃部">/);
  assert.match(result.markup, /<details class="gmail-recipient-subgroup"><summary class="gmail-recipient-subgroup-label"><span>Celine組<\/span>/);
  assert.doesNotMatch(result.markup, /<details[^>]+\sopen(?:\s|>)/);
});

test('designer JSON group and rotation still drive the separate new-project buttons after the roster is replaced', async () => {
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
  assert.doesNotMatch(html, />新專案找我<\/button>/, '舊頭像卡上的新專案按鈕已下架');
  assert.match(html, /data-new-project-group="平面"/);
  assert.match(html, /data-new-project-group="影音"/);
  assert.match(html, /let designerOptions = \['Machi','Anna','Karl','Noise','Amber','Leona'\]/);
  assert.match(html, /function syncDesignerOptionLists\(list=designers\)/);
  assert.match(html, /profile\.skillTargets\?\.\[skill\]/);
  assert.match(html, /stage=stages\.includes\(configuredStage\)\?configuredStage:preferredDesignStage\(type,stages\)/);
  assert.match(html, /stage=String\(item\?\.stage\|\|item\?\.\['階段'\]\|\|''\)\.trim\(\)\|\|defaultDesignStage\(type\)/);
  assert.match(html, /\.pill-stage-再製\{background:#f1e8ff!important;color:#6b21a8!important;border-color:#d8b4fe!important\}/);
  assert.match(html, /html\[data-theme="dark"\] \.pill-stage-再製\{[\s\S]*?background:#3b2156!important;[\s\S]*?color:#e9d5ff!important;[\s\S]*?border-color:#7e4fa8!important/);
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
  // 案件刪除與修改紀錄的垃圾桶改用站內警示視窗（showAppConfirm），刪除前一樣必須先確認。
  assert.match(functionSource('async function removeSelectedCaseDesignImages(', 'function refreshOpenRevisionModal('), /if\(!\(await showAppConfirm\(/);
  assert.match(functionSource('async function removeCaseDesignImage(', 'function detailOptionsForRow('), /if\(!\(await showAppConfirm\(/);
  assert.match(functionSource('async function deleteRow(', 'function cancelRow('), /if\(!\(await showAppConfirm\(/);
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
  assert.match(dashboard, /syncDetailScoreRules\(primary\)/);
  assert.match(dashboard, /const persisted=storedWeight\(r\);if\(persisted!==null\)return persisted/);
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
  assert.match(archiveAdmin, /<th data-sort="修改次數"><button class="sort-button" type="button">修改<\/button><\/th>/);
  assert.match(archiveAdmin, /<td>\$\{esc\(row\['加權'\]\)\}<\/td><td>\$\{esc\(row\['修改次數'\]\)\}<\/td><td>\$\{esc\(row\['開始日期'\]\)\}<\/td>/);
  assert.match(archiveAdmin, /colspan="13">沒有符合條件的資料/);
  assert.match(archiveAdmin, /\['案件編號','加權','修改次數','開始日期','結束日期'\]\.includes\(key\)/);
  assert.match(archiveAdmin, /if\(key==='加權'\|\|key==='修改次數'\)\{const value=String\(row\[key\]\?\?''\)\.trim\(\);return value===''\?'':Number\(value\.replace\(\/,\/g,''\)\)\}/);
  assert.match(indexHtml, /const HISTORY_DATABASE_JSON_URL='data\/database_archive\.json'/);
  assert.match(indexHtml, /mergeRowsById\(archiveRows,rows\)/);
  assert.match(indexHtml, /stages:\{'平面':\['提案','再製','新製','印刷'\]/);
  assert.match(indexHtml, /normalizedType==='平面'\?'新製':normalizedType==='影音'\?'後製'/);
  assert.match(indexHtml, /stage=String\(item\?\.stage\|\|item\?\.\['階段'\]\|\|''\)\.trim\(\)\|\|defaultDesignStage\(type\)/);
  assert.doesNotMatch(indexHtml, /function fetchArchiveDatabaseObjects\([^)]*\)\{return gvizToObjects/);
  assert.match(dashboard, /歷史 JSON 資料庫，已與目前 database 對齊/);

  const rulesStart = dashboard.indexOf('const FALLBACK_DETAIL_SCORE_ROWS=');
  const rulesEnd = dashboard.indexOf('const FALLBACK=[', rulesStart);
  const scoreStart = dashboard.indexOf('function scoredDetails(');
  const scoreEnd = dashboard.indexOf('function dailyScore(', scoreStart);
  assert.ok(rulesStart >= 0 && rulesEnd > rulesStart && scoreStart >= 0 && scoreEnd > scoreStart);
  const scoring = new Function(`${dashboard.slice(rulesStart, rulesEnd)}\n${dashboard.slice(scoreStart, scoreEnd)}\nreturn {syncDetailScoreRules,score};`)();
  assert.equal(scoring.syncDetailScoreRules({ tables: { '加權計分標準': { rows: [
    { '設計種類': '平面', '階段': '新製', '項目細節': '修圖', '權重': '0.5' },
    { '設計種類': '平面', '階段': '新製', '項目細節': '急件', '權重': '3', '狀態': '下架' }
  ] } } }), true);
  assert.equal(scoring.score({ '設計種類': '平面', '階段': '新製', '項目細節': '修圖', '數量': '2', '加權': '' }), 1);
  assert.equal(scoring.score({ '設計種類': '平面', '階段': '後製', '項目細節': '修圖', '數量': '99', '加權': '17.5' }), 17.5);
  assert.equal(scoring.score({ '設計種類': '平面', '階段': '後製', '項目細節': '修圖', '數量': '99', '加權': '0' }), 0);
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
  // 左側選單改成分四組（案件資料／人員與權限／系統設定／問題回報）排列，TABLE_ORDER 由 TABLE_GROUPS 展開；
  // reels 不另列側邊頁，設計師公開資料與 REELS 統一由「設計列表」管理，不在任何一組裡。
  assert.doesNotMatch(html.match(/const TABLE_GROUPS=\[[\s\S]*?\];\s*const TABLE_ORDER=/)?.[0] || '', /'reels'/);
  assert.match(html, /const TABLE_GROUPS=\[\s*\{label:'案件資料',tables:\['database','修改統計表'\]\},\s*\{label:'人員與權限',tables:\['設計列表','帳號權限','角色權限範本','客戶別'\]\},\s*\{label:'系統設定',tables:\['加權計分標準','系統公告欄','短連結'\]\},\s*\{label:'問題回報',tables:\['bug_report'\]\}\s*\];/);
  assert.match(html, /const TABLE_ORDER=TABLE_GROUPS\.flatMap\(group=>group\.tables\);/);
  assert.match(html, /function renderTabs\(\)\{\$\('tabs'\)\.innerHTML=TABLE_GROUPS\.map\(group=>\{/);
  assert.match(html, /class="side-group-label"/);
  assert.match(html, /data-account-reel-edit=/);
  // 「刪除」改成「下架／重新上架」的雙態切換，資料列本身（含留言／按讚紀錄）不再被整列刪除。
  assert.doesNotMatch(html, /data-account-reel-delete=/);
  assert.match(html, /data-account-reel-toggle=/);
  assert.match(html, /async function toggleAccountReelVisibility\(row,button\)\{/);
  assert.match(html, /appsScriptRequest\('adminTableUpdate',\{table:'reels'/);
  assert.match(html, /function accountReelActive\(row\)\{/);
  assert.match(html, /account-reel-hidden-badge/);
  // REELS 卡片新增「已讀」數字，滑鼠移過去看得到實際名字（title 提示），不佔用卡片空間。
  assert.match(html, /已讀 <span class="account-reel-viewers" title="\$\{esc\(viewerTitle\)\}">\$\{viewerNames\.length\}<\/span>/);
  assert.match(html, /viewerNames=accountReactionNames\(row\['已讀'\]\)/);
  assert.match(html, /viewerTitle=viewerNames\.length\?viewerNames\.join\('、'\):'尚無已讀紀錄'/);
  assert.match(html, /function accountReactionNames\(value\)\{/);
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
  assert.match(html, /function systemAnnouncementAdminHtml\(rows\)/);
  assert.match(html, /data-announcement-toggle/);
  assert.match(html, /function systemAnnouncementReadHtml\(row\)/);
  assert.match(html, /查看已讀帳號/);
  assert.match(front, /id="systemAnnouncementDismiss">\u4e0d再出現/);
  assert.match(front, /machiSystemAnnouncementDismissedVersionV1/);
  assert.match(front, /markSystemAnnouncementRead/);
  assert.match(html, /function shortLinkTableHtml\(data\)/);
  // 補充資料連結不再有獨立頁籤，也不再併入「修改列表」的案件群組顯示。
  assert.doesNotMatch(html.match(/const TABLE_GROUPS=\[[\s\S]*?\];\s*const TABLE_ORDER=/)?.[0] || '', /'補充資料連結'/);
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
  assert.doesNotMatch(html.match(/const TABLE_GROUPS=\[[\s\S]*?\];/)?.[0] || '', /'設定'/);
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
  assert.deepEqual(reaction.story.likes, ['Machi']);

  const comment = await api(app.baseUrl, 'addReelComment', {
    editorToken: login.token, reelId: 'reel-file', comment: 'JSON 留言成功'
  });
  assert.equal(comment.story.comments.at(-1).text, 'JSON 留言成功');

  const firstView = await api(app.baseUrl, 'markReelViewed', { editorToken: login.token, reelId: 'reel-file' });
  assert.deepEqual(firstView.story.viewers, ['Machi']);
  assert.equal(firstView.story.viewerCount, 1);
  // 同一個人重複瀏覽同一則限動：名字不會重複出現。
  const repeatView = await api(app.baseUrl, 'markReelViewed', { editorToken: login.token, reelId: 'reel-file' });
  assert.deepEqual(repeatView.story.viewers, ['Machi']);
  assert.equal(app.database.table('reels').rows.find(row => row['限時動態連結'].includes('reel-file'))['已讀'], 'Machi');

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

  const weightRule = await request(app.baseUrl, `/api/table/${encodeURIComponent('加權計分標準')}/2`, { method: 'PATCH', token: login.token, body: { row: { '權重': '0.5' } } });
  assert.equal(weightRule.data.row['項目細節'], '社群貼文');
  assert.equal(weightRule.data.row['權重'], '0.5');

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
    if (table === 'database') assert.equal(created.data.row['加權'], '1');
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

test('修改紀錄 modal exposes 新增初稿 only when the 初稿 is missing, offers a per-round delete, and its header buttons can actually be hidden', async () => {
  const html = await readFile(new URL('../../index.html', import.meta.url), 'utf8');

  // Both header buttons carry the .revision-modal-add class, whose display:inline-flex!important beat
  // the browser's [hidden]{display:none} -- so `add.hidden = ...` silently did nothing and the button
  // stayed on screen. That affected the pre-existing 新增 button too, not just the new one.
  assert.match(html, /\.revision-modal-add\[hidden\]\{display:none!important\}/);
  assert.match(html, /id="revisionModalAddDraft"[^>]*hidden/);
  assert.match(html, /\$\('#revisionModalAddDraft'\)\?\.addEventListener\('click',event=>\{const id=\$\('#revisionModal'\)\?\.dataset\.caseId; if\(id\)openModificationEditor\(event,id,\{draft:true\}\)\}\);/);

  // 新增初稿 is only offered when the case has no round-0 record yet; deleting a round is gated on
  // media.manage, the same capability that already guards removing individual design images.
  // 2026-09-16 起「新增初稿」只開放設計師看到，避免專案同仁誤建空的初稿紀錄。
  assert.match(html, /if\(addDraft\)addDraft\.hidden=!canCaseEditRow\(row\)\|\|!isDesignerLogin\(\)\|\|records\.some\(record=>\(Number\(record\.count\)\|\|0\)===0\);/);
  assert.match(html, /const deleteButton=accessAllowed\('media\.manage',hasDesignerAccountRole\(\)\)\?/);
  assert.match(html, /onclick="deleteModificationRecord\(event,'\$\{jsArg\(row\.id\)\}',\$\{Number\(record\.count\)\|\|0\}\)"/);

  // The draft form must not ask for 待修改圖片 (there is no previous round to pick from) and must send
  // draft:true, otherwise the backend would just create the next modification round instead.
  const draftBranch = html.match(/if\(draft\)\{[\s\S]*?\n    return;\n  \}/)?.[0];
  assert.ok(draftBranch, 'could not locate the draft branch of openModificationEditor');
  assert.match(draftBranch, /新增初稿/);
  assert.doesNotMatch(draftBranch, /targetImages/);
  assert.match(html, /await sheetApi\('addModificationRecord',\{record,draft:true,editorToken:currentEditorToken,_requireResponse:true\}\);/);

  // Deleting a round is destructive and irreversible, so it must confirm first and say what happens.
  const deleteFn = html.match(/async function deleteModificationRecord\(event,id,count\)\{[\s\S]*?\n\}/)?.[0];
  assert.ok(deleteFn, 'could not locate deleteModificationRecord');
  assert.match(deleteFn, /requireAccess\('media\.manage'/);
  assert.match(deleteFn, /if\(!\(await showAppConfirm\(/);
  assert.match(deleteFn, /其他輪次的編號不會跟著往前遞補/);
  assert.match(deleteFn, /sheetApi\('deleteModificationRecord'/);

  // A write action has to be registered for the refresh broadcast, or other tabs keep stale rounds.
  assert.match(html, /deleteModificationRecord:\['修改統計表'\]/);
});

test('batch-created cases can be merged into one mail: ids joined in the subject, shared text printed once, quantities summed, and the thread bound to every case', async () => {
  const html = await readFile(new URL('../../index.html', import.meta.url), 'utf8');
  const worker = await readFile(new URL('../../worker/src/database-coordinator.ts', import.meta.url), 'utf8');

  // Single and merged mails must share one body template, or the two will drift apart.
  assert.match(html, /function mailBodyFields\(row\)\{/);
  assert.match(html, /function mailBodyLines\(fields,\{html=false\}=\{\}\)\{/);
  assert.match(html, /function mergedMailDraft\(entries\)\{/);

  // One send covers several cases, so the Worker binds the resulting thread to all of them and
  // refuses the whole batch if any case is missing, unauthorised, or already has a thread.
  assert.match(worker, /const caseIds = \[\.\.\.new Set\(\(Array\.isArray\(payload\.caseIds\) \? payload\.caseIds : \[payload\.caseId \|\| payload\.id\]\)/);
  assert.match(worker, /for \(const item of targetRows\) this\.requireRowAccess\(database, session, 'request\.mail', item\.row\);/);
  assert.match(worker, /for \(const id of caseIds\) \{/);

  // Merging is only offered in the batch post-submit flow.
  assert.match(html, /id="gmailComposeMergePanel"/);
  assert.match(html, /function postSubmitQueueItems\(queue\)\{/);
  // Scheduling used to be disabled for a merged mail because the scheduler keyed off a single case id.
  // The scheduler now takes the same caseIds list as sendCaseMail, so every queued mail can be scheduled.
  assert.doesNotMatch(html, /scheduleBtn\.disabled=!ready\|\|item\.merged/);

  // Execute the real merge logic against the same helpers the page uses.
  const pick = name => html.match(new RegExp(`function ${name}\\([^)]*\\)\\{[\\s\\S]*?\\n\\}`))?.[0];
  const sources = ['mailBodyFields', 'mailBodyLines', 'mergedMailSubject', 'customerDefaultCcRecipients', 'mailCcRecipients', 'mergedMailDraft'].map(pick);
  assert.ok(sources.every(Boolean), 'could not locate the mail body helpers');
  const build = new Function(`
    const esc = value => String(value ?? '').replace(/&/g,'&amp;').replace(/</g,'&lt;');
    const supplementLongUrl = (row, key) => row[key] || '';
    const mailSupplementText = (note, url) => [note, url].filter(Boolean).join(' | ');
    const mailSupplementHtml = (note, url) => [note, url].filter(Boolean).join(' | ');
    const mailDimensionSpecs = () => '';
    const platformText = value => value || '';
    const slashDate = value => String(value || '').replace(/-/g, '/');
    const designerRecipient = () => 'Machi <machi.chen@emctaipei.com>';
    const designerCcRecipients = () => ['Anna <anna.hsu@emctaipei.com>'];
    const requiredMailCcRecipients = ['傅思凱 <eric.fu@emctaipei.com>'];
    const extractEmail = value => String(value || '').match(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i)?.[0] || '';
    const uniqueMailRecipients = list => {
      const seen = new Set();
      return list.filter(item => { const key = (extractEmail(item) || item).toLowerCase(); if (!item || seen.has(key)) return false; seen.add(key); return true; });
    };
    const parseNameListValue = value => { try { const parsed = JSON.parse(value || '[]'); return Array.isArray(parsed) ? parsed : []; } catch { return []; } };
    const customerDirectoryRowFor = () => null; // 這支測試不設客戶別預設信箱，走預設名單（平面四位＋負責人）
    const CUSTOMER_DEFAULT_CC_EMAILS = ['machi.chen@emctaipei.com', 'anna.hsu@emctaipei.com', 'amber.tian@emctaipei.com', 'leona.chen@emctaipei.com', 'eric.fu@emctaipei.com'];
    const designerRecipientByName = name => (name ? name + ' <' + String(name).toLowerCase() + '@emctaipei.com>' : '');
    ${sources.join('\n')}
    return { mergedMailDraft };
  `)();

  const base = { client: 'DJI', project: '九月新品社群貼文', designer: 'Machi', platforms: 'FB', end: '2026-09-20', briefNote: '簡報說明' };
  const merged = build.mergedMailDraft([
    { id: '26090079', row: { ...base, qty: '10' } },
    { id: '26090080', row: { ...base, qty: '5', platforms: 'LINE' } }
  ]);
  assert.equal(merged.subject, '【26090079、26090080】DJI_九月新品社群貼文');
  // 副本沿用原本規則（同組設計師＋負責人），且一定不包含收件人本人。
  assert.deepEqual(merged.cc, ['anna.hsu@emctaipei.com', 'amber.tian@emctaipei.com', 'leona.chen@emctaipei.com', 'eric.fu@emctaipei.com']);
  const lines = merged.bodyText.split('\n');
  // Quantities are summed into one number rather than listed per case.
  assert.ok(lines.includes('　　　2. 數量：15'), merged.bodyText);
  // A field that differs is attributed to its case instead of being duplicated wholesale.
  assert.ok(lines.includes('　　　5. 使用平台：'));
  assert.ok(lines.includes('　　　　・26090079：FB'));
  assert.ok(lines.includes('　　　　・26090080：LINE'));
  // Shared text appears exactly once -- that is the whole point of merging.
  assert.equal(lines.filter(line => line === ' ・ 需求描述：九月新品社群貼文').length, 1);
  assert.equal(lines.filter(line => line === '　　　6. 交件日期：2026/09/20').length, 1);
  assert.equal(lines.filter(line => line.startsWith('Hi ')).length, 1);
});

test('a new 客戶別 is created with its 部門／組別 and 權限設定 already filled in, from one shared rule both creation paths go through', async () => {
  const admin = await readFile(new URL('../../json_database_admin.html', import.meta.url), 'utf8');
  const html = await readFile(new URL('../../index.html', import.meta.url), 'utf8');
  const model = await readFile(new URL('../../worker/src/model.ts', import.meta.url), 'utf8');
  const worker = await readFile(new URL('../../worker/src/database-coordinator.ts', import.meta.url), 'utf8');

  // 前台下拉的「+ 新增客戶別」與後台的「+ 新增客戶別」走的是兩條不同的 action，預設值只能有一份定義，
  // 否則兩邊遲早會長出不一樣的名單。
  assert.match(model, /export const NEW_CUSTOMER_DEFAULT_DEPARTMENTS = \['測試員', '設計部', '企劃部'\];/);
  const defaults = model.match(/export function newCustomerDefaults\([\s\S]*?\n\}/)?.[0];
  assert.ok(defaults, 'could not locate newCustomerDefaults');
  // 專案同仁：整組加進來。「凱曜」是公司名稱，凱曜專案部先去掉前綴再比對。
  assert.match(model, /function isProjectDepartment\(department: string\): boolean \{\s*\n\s*return normalizeDepartmentName\(department\) === '專案部';/);
  assert.match(model, /return text\(value\)\.replace\(\/\^凱曜\(\?=\.\)\/, ''\)\.trim\(\);/);
  assert.match(defaults, /if \(isProjectDepartment\(department\) && group\) groups\.push\(group\);/);
  // 建立者不屬於任何預設單位時要把他自己加進去，否則他會在建立當下就失去自己這個客戶別的編輯／發信權限。
  assert.match(defaults, /if \(!coveredByDefaults\) accounts\.push\(account\);/);
  assert.match(defaults, /const coveredByDefaults = isManager\(database, session\)/);
  // 「部門組別」存純名稱、「專案負責人」存 department:／group: 動態規則，兩者格式不同不可混用。
  assert.match(defaults, /visibleUnits: unique\(\[\.\.\.departments, \.\.\.groups, \.\.\.accounts\]\)/);
  assert.match(defaults, /\.\.\.departments\.map\(name => `department:\$\{name\}`\)/);
  assert.match(defaults, /\.\.\.groups\.map\(name => `group:\$\{name\}`\)/);

  // 兩條建立路徑都要套用同一份預設。
  const addCustomer = worker.match(/private async addCustomer\([\s\S]*?\n  \}/)?.[0];
  assert.ok(addCustomer, 'could not locate addCustomer');
  assert.match(addCustomer, /const defaults = newCustomerDefaults\(database, session\);/);
  assert.match(addCustomer, /'專案負責人': JSON\.stringify\(defaults\.ownerRules\)/);
  assert.match(addCustomer, /'部門組別': JSON\.stringify\(defaults\.visibleUnits\)/);
  // 「喜愛設定」是每個客戶別各自不同的偏好，沒有共通預設。
  assert.match(addCustomer, /'設計負責人': '\[\]'/);
  assert.match(worker, /if \(tableName === '客戶別'\) \{\s*\n\s*const defaults = newCustomerDefaults\(draft, current\);/);
  // 後台新增時如果已經指定名單，不可被預設值蓋掉。
  assert.match(worker, /if \(!accessList\(normalized\['部門組別'\]\)\.length\) normalized\['部門組別'\]/);
  assert.match(worker, /if \(!accessList\(normalized\['專案負責人'\]\)\.length\) normalized\['專案負責人'\]/);

  // 後台送出的是空名單，預設交給後端補——不可以在後台這份 HTML 裡另外寫一份，那就是第二個真相來源。
  const adminAdd = admin.match(/async function addCustomerFromAdmin\(\)\{[\s\S]*?\n    \}/)?.[0];
  assert.ok(adminAdd, 'could not locate addCustomerFromAdmin');
  assert.match(adminAdd, /'專案負責人':'\[\]','設計負責人':'\[\]','部門組別':'\[\]'/);
  assert.doesNotMatch(adminAdd, /測試員/);

  // 舊客戶別（名單本來就空白）的顯示範圍退路維持原樣，這次只改「新增當下」寫入什麼，不動既有資料。
  assert.match(admin, /const CUSTOMER_DEFAULT_VISIBLE_DEPARTMENTS=\['企劃部','設計部'\];/);
  assert.match(html, /return list\.length\?list:\['企劃部','設計部'\];/);
});

test('deleting the Gmail draft cancels that schedule instead of sending the stored copy, and the case still shows why the mail never went out', async () => {
  const html = await readFile(new URL('../../index.html', import.meta.url), 'utf8');
  const worker = await readFile(new URL('../../worker/src/database-coordinator.ts', import.meta.url), 'utf8');

  // 使用者指定的規則：刪掉草稿＝取消這封排程。所以「草稿不存在」必須跟「Gmail 暫時出錯」分開處理，
  // 前者取消、後者仍然要退回用排程當下存下來的內容寄出去（一次偶發失敗不該讓該寄的信沒寄出）。
  assert.match(worker, /class GmailDraftMissingError extends Error \{\}/);
  const sendDraft = worker.match(/async function sendGmailDraft\([\s\S]*?\n\}/)?.[0];
  assert.ok(sendDraft, 'could not locate sendGmailDraft');
  assert.match(sendDraft, /response\.status === 404/);
  assert.match(sendDraft, /throw new GmailDraftMissingError\(message\);/);
  const dispatch = worker.match(/private async dispatchScheduledMailItem\([\s\S]*?\n  \}/)?.[0];
  assert.ok(dispatch, 'could not locate dispatchScheduledMailItem');
  assert.match(dispatch, /if \(error instanceof GmailDraftMissingError\) \{\s*\n\s*return \{ outcome: 'canceled', note: '草稿已在 Gmail 中被刪除/);
  assert.match(dispatch, /result = await postGmailMessage\(accessToken, raw\);/);
  // 取消的原因要寫進那筆排程，資料本身才說得清楚為什麼沒寄。
  assert.match(worker, /UPDATE scheduled_mail SET status = \?, error_message = \?, updated_at = \? WHERE id = \?', outcome, note \|\| null/);

  // 前端：使用者自己按「取消排程」的那幾筆照舊不佔位置，但「系統判定不寄」的要看得見，否則信沒寄出
  // 而畫面上什麼都沒有，等於默默消失。
  const refresh = html.match(/async function refreshScheduledMailList\(caseId,kind\)\{[\s\S]*?\n\}/)?.[0];
  assert.ok(refresh, 'could not locate refreshScheduledMailList');
  assert.match(refresh, /\(item\.status==='canceled'&&item\.errorMessage\)/);

  // Run the real row renderer and badge summariser.
  const rowHtml = html.match(/function scheduledMailItemHtml\(item,kind,caseId\)\{[\s\S]*?\n\}/)?.[0];
  const summary = html.match(/function scheduleStatusSummary\(items\)\{[\s\S]*?\n\}/)?.[0];
  assert.ok(rowHtml && summary, 'could not locate the scheduled list helpers');
  const helpers = new Function(`
    const esc = value => String(value ?? '');
    const jsArg = value => String(value ?? '');
    const scheduleDisplayLabel = value => String(value);
    ${rowHtml}
    ${summary}
    return { scheduledMailItemHtml, scheduleStatusSummary };
  `)();

  const canceledRow = helpers.scheduledMailItemHtml(
    { id: 's1', status: 'canceled', scheduledAt: '2026/09/12 09:00', to: 'client@example.com', errorMessage: '草稿已在 Gmail 中被刪除，這封排程視同取消，未寄出' },
    'compose', '26090001'
  );
  assert.match(canceledRow, /is-canceled/);
  assert.match(canceledRow, /未寄出：草稿已在 Gmail 中被刪除/);
  // 已取消的那筆不該再提供「編輯」或「取消排程」，那兩個動作對它已經沒有意義。
  assert.doesNotMatch(canceledRow, /editScheduledMailItem|cancelScheduledMailItem/);

  const pendingRow = helpers.scheduledMailItemHtml({ id: 's2', status: 'pending', scheduledAt: '2026/09/12 09:00', to: 'client@example.com' }, 'compose', '26090001');
  assert.match(pendingRow, /cancelScheduledMailItem/);
  assert.doesNotMatch(pendingRow, /is-canceled/);

  // 按鈕旁的徽章也要提醒，使用者才不用自己去捲下方清單才發現信沒寄。
  assert.deepEqual(
    helpers.scheduleStatusSummary([{ status: 'canceled', errorMessage: '草稿已在 Gmail 中被刪除' }]),
    { text: '1 筆排程未寄出，請見下方清單', isError: true }
  );
  // 還有待寄出的排程時，優先顯示那個（使用者最想確認的是「下一封什麼時候寄」）。
  assert.deepEqual(
    helpers.scheduleStatusSummary([{ status: 'pending', scheduledAt: '2026/09/12 09:00' }, { status: 'canceled', errorMessage: 'x' }]),
    { text: '已排程於 2026/09/12 09:00 寄出', isError: false }
  );
  assert.equal(helpers.scheduleStatusSummary([]), null);

  // 排程成功的提示要把這條規則講清楚，使用者才不會以為刪草稿只是「不想在 Gmail 看到它」。
  const schedule = html.match(/async function scheduleComposeMail\(scheduledAt\)\{[\s\S]*?\n\}/)[0];
  assert.match(schedule, /刪掉草稿就等於取消這封排程/);
});

test('scheduling a mail ends the compose flow and can never be followed by an immediate second send, and a grant without the draft scope says so before anything is scheduled', async () => {
  const html = await readFile(new URL('../../index.html', import.meta.url), 'utf8');
  const worker = await readFile(new URL('../../worker/src/database-coordinator.ts', import.meta.url), 'utf8');

  // 「排程完信件卻直接寄出」有兩個成因，兩個都要堵住。
  // 1. 單筆案件的「寄出」完全沒有檢查這封信是不是已經排程過（批次佇列的「全部寄出」一直都有）。
  const send = html.match(/async function sendGmailComposeModal\(\)\{[\s\S]*?\n\}/)?.[0];
  assert.ok(send, 'could not locate sendGmailComposeModal');
  assert.match(send, /if\(await hasPendingScheduledMail\(id\)\)\{/);
  // 檢查必須在真正呼叫 sendCaseMail 之前。
  assert.ok(send.indexOf('hasPendingScheduledMail') < send.indexOf("sheetApi('sendCaseMail'"), '排程檢查必須在寄出之前');

  // 2. 排程成功後畫面仍停在一顆亮著的「寄出」按鈕上，使用者按下去就是立刻再寄一封。
  const schedule = html.match(/async function scheduleComposeMail\(scheduledAt\)\{[\s\S]*?\n\}/)?.[0];
  assert.ok(schedule, 'could not locate scheduleComposeMail');
  assert.match(schedule, /finishComposeAfterSchedule\(/);

  // Run the real post-schedule handler: a queue jumps to the next unscheduled mail, and closes once
  // every mail in it has been dealt with.
  const finish = html.match(/function finishComposeAfterSchedule\(ids\)\{[\s\S]*?\n\}/)?.[0];
  assert.ok(finish, 'could not locate finishComposeAfterSchedule');
  const runFinish = (queue, ids) => {
    const calls = { closed: 0, rendered: 0 };
    new Function('postSubmitQueue', 'ids', 'calls', `
      const closeGmailComposeModal = () => { calls.closed += 1; };
      const renderPostSubmitQueue = () => { calls.rendered += 1; };
      ${html.match(/function postSubmitQueueItems\(queue\)\{[\s\S]*?\n\}/)[0]}
      ${html.match(/function postSubmitItemDrafts\(queue,item\)\{[^\n]*\n/)[0]}
      ${finish}
      finishComposeAfterSchedule(ids);
    `)(queue, ids, calls);
    return calls;
  };
  const queue = { mode: 'gmail', index: 0, merged: [0, 1], drafts: [{ id: 'a' }, { id: 'b' }, { id: 'c' }] };
  const afterFirst = runFinish(queue, ['a', 'b']);
  assert.deepEqual(afterFirst, { closed: 0, rendered: 1 });
  assert.equal(queue.index, 1, '合併的那封排程完，應該跳到剩下那封未排程的信');
  const afterLast = runFinish(queue, ['c']);
  assert.deepEqual(afterLast, { closed: 1, rendered: 0 }, '全部都排程完就關閉視窗，不留下亮著的「寄出」');
  // A single case outside the batch flow just closes.
  assert.deepEqual(runFinish(null, ['a']), { closed: 1, rendered: 0 });

  // The missing draft scope is now reported by gmailStatus and shown as a standing notice with a
  // reconnect button, instead of only surfacing as a toast after the user has already scheduled.
  assert.match(worker, /function gmailScopesAllowDraft\(scopes: unknown\): boolean/);
  assert.match(worker, /canCreateDraft: Boolean\(stored\) && gmailScopesAllowDraft\(stored\?\.scopes\)/);
  assert.match(html, /id="gmailComposeDraftScopeNotice"/);
  assert.match(html, /id="gmailComposeDraftScopeReconnect"/);
  assert.match(html, /\$\('#gmailComposeDraftScopeReconnect'\)\?\.addEventListener\('click',\(\)=>startGmailConnectPopup\(\)\);/);
  const notice = html.match(/function renderGmailDraftScopeNotice\(\)\{[\s\S]*?\n\}/)?.[0];
  assert.ok(notice, 'could not locate renderGmailDraftScopeNotice');
  const runNotice = state => {
    const element = { hidden: null };
    new Function('gmailConnectionState', 'element', `
      const $ = () => element;
      ${notice}
      renderGmailDraftScopeNotice();
    `)(state, element);
    return element.hidden;
  };
  assert.equal(runNotice({ connected: true, canCreateDraft: false }), false, '授權缺草稿權限時必須顯示提示');
  assert.equal(runNotice({ connected: true, canCreateDraft: true }), true);
  assert.equal(runNotice({ connected: false, canCreateDraft: false }), true, '還沒連接 Gmail 不該用草稿提示打擾');
  // Both entry points into the compose window paint the notice.
  assert.equal((html.match(/renderGmailDraftScopeNotice\(\);/g) || []).length, 3);
});

test('an account that already connected Gmail can run the authorisation flow again, which is the only way to grant a scope added after it first connected', async () => {
  const html = await readFile(new URL('../../index.html', import.meta.url), 'utf8');

  // The 信件 menu used to offer 連接 only while disconnected: once connected the sole account action was
  // 取消連接. That left an already-connected user with no way to re-run Google's consent screen, so a
  // scope added later (gmail.compose, for the scheduled-mail draft) could never be granted without
  // first disconnecting. Every connected branch now offers a reconnect entry as well.
  const menu = html.match(/async function openMailComposerMenu\(event,id\)\{[\s\S]*?\n\}/)?.[0];
  assert.ok(menu, 'could not locate openMailComposerMenu');
  assert.equal((menu.match(/startGmailConnectPopup\(\)/g) || []).length, 2, '連接與重新連接各一個入口');

  // Run the real menu builder for all three states and check what the user is actually offered.
  const harness = new Function('status', 'row', `
    const fieldPopover = { innerHTML: '', dataset: {}, hidden: true };
    const rows = [row];
    const requireAccess = () => true;
    const isEditableRow = () => true;
    const positionFieldPopover = () => {};
    const setSync = () => {};
    const jsArg = value => String(value);
    const esc = value => String(value);
    const mailComposerMenuHtml = (id, gmailOption) => gmailOption;
    const ensureGmailStatusLoaded = async () => status;
    const event = { preventDefault() {}, stopPropagation() {}, currentTarget: {} };
    ${html.match(/async function openMailComposerMenu\(event,id\)\{[\s\S]*?\n\}/)[0]}
    return openMailComposerMenu(event, row.id).then(() => fieldPopover.innerHTML);
  `);

  const composeMenu = await harness({ connected: true, gmailAddress: 'machi@emctaipei.com' }, { id: '26090001', gmailThreadId: '' });
  assert.match(composeMenu, /透過 Gmail 撰寫並寄出/);
  assert.match(composeMenu, /重新連接 Gmail（更新授權）/);
  assert.match(composeMenu, /取消連接 Gmail/);

  const threadMenu = await harness({ connected: true, gmailAddress: 'machi@emctaipei.com' }, { id: '26090001', gmailThreadId: 'thread-1' });
  assert.match(threadMenu, /查看信件串／回信/);
  assert.match(threadMenu, /重新連接 Gmail（更新授權）/);

  // Nothing changes for an account that has never connected: one plain 連接 button, no reconnect noise.
  const freshMenu = await harness({ connected: false, gmailAddress: '' }, { id: '26090001', gmailThreadId: '' });
  assert.match(freshMenu, /連接 Gmail 帳號/);
  assert.doesNotMatch(freshMenu, /重新連接/);
  assert.doesNotMatch(freshMenu, /取消連接/);

  // Re-authorising an already-connected account must not report itself as a first-time connection.
  const applyResult = html.match(/async function applyGmailOauthPopupResult\(result=\{\}\)\{[\s\S]*?\n\}/)?.[0];
  assert.ok(applyResult, 'could not locate applyGmailOauthPopupResult');
  assert.match(applyResult, /const wasConnected=gmailConnectionState\.connected;/);
  assert.match(applyResult, /wasConnected\?'已更新 Gmail 授權':'已連接 Gmail'/);
});

test('a scheduled first-send mail is mirrored into the Gmail drafts folder, and batch/merged mails can be scheduled the same way a single case can', async () => {
  const html = await readFile(new URL('../../index.html', import.meta.url), 'utf8');
  const worker = await readFile(new URL('../../worker/src/database-coordinator.ts', import.meta.url), 'utf8');

  // Gmail's drafts.* endpoints are not covered by gmail.send, so the connect flow has to ask for
  // gmail.compose as well. Without this the draft can never be created for anyone.
  const authUrl = html.match(/function gmailOauthAuthorizationUrl\([^)]*\)\{[\s\S]*?\n\}/)?.[0];
  assert.ok(authUrl, 'could not locate gmailOauthAuthorizationUrl');
  assert.match(authUrl, /https:\/\/www\.googleapis\.com\/auth\/gmail\.compose/);

  // Schedule time: create the draft. Dispatch time: send that draft, so anything the user edited in
  // Gmail while waiting is what actually goes out.
  assert.match(worker, /async function createGmailDraft\(accessToken: string, raw: string\): Promise<string>/);
  assert.match(worker, /async function sendGmailDraft\(accessToken: string, draftId: string\)/);
  assert.match(worker, /result = await sendGmailDraft\(accessToken, draftId\);/);
  // A Gmail hiccup must never stop the mail from going out at the appointed time. (A draft the user
  // deleted is a separate, deliberate case -- see the deleted-draft test.)
  assert.match(worker, /result = await postGmailMessage\(accessToken, raw\);/);
  // Editing the schedule updates the draft; canceling it removes the draft from the mailbox.
  assert.match(worker, /draftError = \(await this\.syncScheduledMailDraft\(id, item\.owner_account, text\(item\.draft_id\), raw\)\)\.draftError;/);
  assert.match(worker, /await this\.discardScheduledMailDraft\(item\);/);
  // The schedule itself must survive a failed draft (older Gmail grants have no gmail.compose scope).
  const scheduleFn = worker.match(/private async scheduleCaseMail\([\s\S]*?\n  \}/)?.[0];
  assert.ok(scheduleFn, 'could not locate scheduleCaseMail');
  assert.match(scheduleFn, /draftId: draft\.draftId, draftError: draft\.draftError/);

  // Scheduling a merged mail: the Worker takes the whole id list, and one schedule blocks a second
  // one on any of the cases it covers.
  assert.match(scheduleFn, /const caseIds = \[\.\.\.new Set\(\(Array\.isArray\(payload\.caseIds\) \? payload\.caseIds : \[payload\.caseId \|\| payload\.id\]\)/);
  assert.match(scheduleFn, /const clash = pendingSends\.find\(item => scheduledMailCaseIds\(item\)\.some\(id => caseIds\.includes\(id\)\)\);/);
  // A merged schedule is one row, so every case it covers has to find it through case_ids too.
  assert.match(worker, /FROM scheduled_mail WHERE case_id = \? OR case_ids LIKE \? ORDER BY scheduled_at DESC LIMIT 30/);

  // Front end: the queued mail hands the scheduler the same id list the send path uses.
  const render = html.match(/function renderPostSubmitGmailDraft\(\)\{[\s\S]*?\n\}/)?.[0];
  assert.ok(render, 'could not locate renderPostSubmitGmailDraft');
  assert.match(render, /if\(scheduleBtn\)scheduleBtn\.disabled=!ready;/);
  assert.match(render, /modal\.dataset\.caseIds=JSON\.stringify\(ids\);/);
  const schedule = html.match(/async function scheduleComposeMail\(scheduledAt\)\{[\s\S]*?\n\}/)?.[0];
  assert.ok(schedule, 'could not locate scheduleComposeMail');
  assert.match(schedule, /caseId:ids\[0\]\|\|id,caseIds:ids/);
  assert.match(schedule, /ids\.forEach\(caseId=>watchScheduledCaseThread\(caseId,scheduledAt\)\)/);

  // Run the real id resolver: merged mails carry the whole list, single cases carry exactly one, and
  // a leftover caseIds from a previous merged mail must not leak into the next single-case mail.
  const resolver = html.match(/function gmailComposeCaseIds\(modal\)\{[\s\S]*?\n\}/)?.[0];
  assert.ok(resolver, 'could not locate gmailComposeCaseIds');
  const gmailComposeCaseIds = new Function(`${resolver}; return gmailComposeCaseIds;`)();
  assert.deepEqual(gmailComposeCaseIds({ dataset: { caseId: '26090079', caseIds: '["26090079","26090080"]' } }), ['26090079', '26090080']);
  assert.deepEqual(gmailComposeCaseIds({ dataset: { caseId: '26090081' } }), ['26090081']);
  assert.deepEqual(gmailComposeCaseIds({ dataset: { caseId: '26090081', caseIds: 'not json' } }), ['26090081']);
  assert.deepEqual(gmailComposeCaseIds({ dataset: {} }), []);
  // Opening a single case explicitly clears the merged list left over from the queue flow.
  const openCompose = html.match(/async function openGmailComposeModal\([\s\S]*?\n\}/)?.[0];
  assert.ok(openCompose, 'could not locate openGmailComposeModal');
  assert.match(openCompose, /delete modal\.dataset\.caseIds;/);

  // Run the real renderer against a fake DOM: the merged mail in the queue must leave the schedule
  // button enabled (it used to be disabled) and hand the whole id list to the scheduler.
  const render2 = html.match(/function renderPostSubmitGmailDraft\(\)\{[\s\S]*?\n\}/)[0];
  const queueItems = html.match(/function postSubmitQueueItems\(queue\)\{[\s\S]*?\n\}/)[0];
  const itemDrafts = html.match(/function postSubmitItemDrafts\(queue,item\)\{[^\n]*\n/)[0];
  const itemDefaults = html.match(/function postSubmitItemDefaults\(queue,item\)\{[\s\S]*?\n\}/)[0];
  function fakeElement(id) {
    return {
      id, hidden: false, disabled: false, value: '', textContent: '', innerHTML: '', placeholder: '',
      dataset: {}, classList: { toggle() {}, contains: () => false },
      setAttribute() {}, querySelector: () => null
    };
  }
  const scheduledFor = [];
  const elements = new Map();
  const harness = new Function('postSubmitQueue', 'elements', 'fakeElement', 'scheduledFor', `
    const $ = selector => {
      const id = selector.replace('#', '');
      if (!elements.has(id)) elements.set(id, fakeElement(id));
      return elements.get(id);
    };
    const modal = $('gmailComposeModal');
    const document = { querySelector: () => null };
    const gmailConnectionState = { gmailAddress: 'machi@emctaipei.com' };
    const gmailRecipientExpandedFields = new Set();
    const setGmailRecipientEntries = () => {};
    const clearGmailInlineImages = () => {};
    const clearGmailAttachments = () => {};
    const appendDefaultGmailSignature = () => {};
    const setGmailEditorLoading = () => {};
    const renderPostSubmitMergePanel = () => {};
    const renderGmailDraftScopeNotice = () => {};
    const updateGmailScheduleStatusBadge = () => {};
    const refreshScheduledMailList = caseId => scheduledFor.push(caseId);
    const mailDraft = row => ({ to: 'client@example.com', cc: [], subject: '單筆：' + row.id, bodyHtml: '' });
    const mergedMailDraft = entries => ({ to: 'client@example.com', cc: [], subject: '【' + entries.map(e => e.id).join('、') + '】合併', bodyHtml: '' });
    ${itemDrafts}
    ${itemDefaults}
    ${queueItems}
    ${render2}
    renderPostSubmitGmailDraft();
    return { modal };
  `);
  const mergedQueue = {
    mode: 'gmail', index: 0, merged: [0, 1],
    drafts: [{ id: '26090079', row: {} }, { id: '26090080', row: {} }, { id: '26090081', row: {} }]
  };
  const { modal } = harness(mergedQueue, elements, fakeElement, scheduledFor);
  assert.equal(elements.get('gmailComposeSchedule').disabled, false, '合併信件必須也能按下「指定排程時間」');
  assert.equal(modal.dataset.caseId, '26090079');
  assert.deepEqual(JSON.parse(modal.dataset.caseIds), ['26090079', '26090080']);
  assert.deepEqual(scheduledFor, ['26090079']);

  // A case whose id is still being generated cannot be scheduled, and must not leave a stale id list behind.
  const pendingQueue = { mode: 'gmail', index: 0, merged: [], drafts: [{ id: '', row: {} }] };
  const { modal: pendingModal } = harness(pendingQueue, elements, fakeElement, []);
  assert.equal(elements.get('gmailComposeSchedule').disabled, true);
  assert.equal(pendingModal.dataset.caseIds, undefined);
});

test('designer skill defaults take their 設計種類/階段 options from the live weighting table, hiding 下架 stages and keeping a removed value visible instead of silently switching it', async () => {
  const admin = await readFile(new URL('../../json_database_admin.html', import.meta.url), 'utf8');

  // The two dropdowns used to read hardcoded lists that drifted out of sync with 加權設定: a newly added
  // stage never appeared, and stages that had been renamed, 下架 or deleted were still offered.
  const skillRow = admin.match(/function designerSkillRowHtml\(mapping=\{[\s\S]*?\n    \}/)?.[0];
  assert.ok(skillRow, 'could not locate designerSkillRowHtml');
  assert.doesNotMatch(skillRow, /DESIGN_STAGE_OPTIONS|DATABASE_TYPE_OPTIONS/);
  assert.match(skillRow, /designerSkillOptionSource\(\)/);
  assert.match(skillRow, /designerSkillStageOptions\(type\)/);

  // Options come from 加權計分標準, and 下架 rules are excluded (they stay valid for scoring, they just
  // must not be offered as a new choice).
  const source = admin.match(/function designerSkillOptionSource\(\)\{[\s\S]*?\n    \}/)?.[0];
  assert.ok(source, 'could not locate designerSkillOptionSource');
  assert.match(source, /if\(String\(row\['狀態'\]\|\|''\)\.trim\(\)==='下架'\)continue;/);
  assert.match(source, /weightRuleRowsCache/);
  assert.match(admin, /async function ensureWeightRuleRows\(\)\{/);
  assert.match(admin, /if\(requestedTable==='設計列表'\)await ensureWeightRuleRows\(\);/);

  // A saved value that no longer exists must stay selected and be labelled, otherwise opening the card
  // and pressing save would quietly move that designer onto a different stage.
  const optionTags = admin.match(/function designerSkillOptionTags\(values,current\)\{[\s\S]*?\n    \}/)?.[0];
  assert.ok(optionTags, 'could not locate designerSkillOptionTags');
  assert.match(optionTags, /（已移除）/);
  assert.match(optionTags, /item===value\?'selected':''/);

  // Each design type has its own stage list, so changing the type must repopulate the stage select.
  assert.match(admin, /const skillType=event\.target\.closest\('\[data-designer-skill-type\]'\);/);
  assert.match(admin, /stageSelect\.innerHTML=designerSkillOptionTags\(options,keep\);/);

  // Execute the real option builder against a weighting table shaped like production.
  const sourceFn = new Function('weightRuleRowsCache', 'DATABASE_TYPE_OPTIONS', 'DESIGN_STAGE_OPTIONS', `
    ${source}
    ${admin.match(/function designerSkillStageOptions\(type\)\{[\s\S]*?\n    \}/)[0]}
    return { designerSkillOptionSource, designerSkillStageOptions };
  `);
  const rules = [
    { '設計種類': '平面', '階段': '提案', '項目細節': '社群貼文', '狀態': '' },
    { '設計種類': '平面', '階段': '新製', '項目細節': '廣告素材', '狀態': '' },
    { '設計種類': '平面', '階段': '新製', '項目細節': '修圖', '狀態': '下架' },
    { '設計種類': '平面', '階段': '拍攝', '項目細節': '監製', '狀態': '下架' },
    { '設計種類': '影音', '階段': '後製', '項目細節': '影音剪輯', '狀態': '' }
  ];
  const built = sourceFn(rules, ['平面', '影音', '採購'], ['提案', '前製', '拍攝', '後製']);
  assert.deepEqual(built.designerSkillOptionSource().types, ['平面', '影音']); // 採購 has no rules left
  assert.deepEqual(built.designerSkillStageOptions('平面'), ['提案', '新製']); // 拍攝 fully 下架 -> gone
  assert.deepEqual(built.designerSkillStageOptions('影音'), ['後製']);

  // With no rules loaded yet the old constants are the fallback, so the dropdowns are never empty.
  const empty = sourceFn([], ['平面', '影音'], ['提案', '後製']);
  assert.deepEqual(empty.designerSkillOptionSource().types, ['平面', '影音']);
  assert.deepEqual(empty.designerSkillStageOptions('平面'), ['提案', '後製']);
});

test('database admin writes are optimistic and queued: the inline weight save works in Worker mode at all, and no edit waits on a full table reload', async () => {
  const admin = await readFile(new URL('../../json_database_admin.html', import.meta.url), 'utf8');

  // saveInlineWeight used to resolve the row through directDatabase/directRowIndex, which only exist in
  // Apps Script mode. Production runs against the Cloudflare Worker, where directDatabase stays null, so
  // directRowIndex always returned -1 and the "套用" button bailed out with 找不到加權規則 without ever
  // issuing a request -- the score simply could not be changed.
  const inlineWeight = admin.match(/async function saveInlineWeight\(row,container\)\{[\s\S]*?\n    \}/)?.[0];
  assert.ok(inlineWeight, 'could not locate saveInlineWeight');
  // Compare against the code only -- the comment above the function deliberately names the old bug.
  const inlineWeightCode = inlineWeight.split('\n').filter(line => !line.trim().startsWith('//')).join('\n');
  assert.doesNotMatch(inlineWeightCode, /directRowIndex\(|directDatabase/);
  assert.match(inlineWeight, /action:'adminTableUpdate'/);
  // The screen updates first and the request is queued, so the next row can be edited immediately.
  assert.match(inlineWeight, /enqueueAdminWrite\(/);
  // A failed write has to put the old score back rather than leaving a value that was never saved.
  assert.match(inlineWeight, /row\['權重'\]=previousWeight;/);
  // Common fractional/zero scores are first-class choices instead of being hidden behind the vague
  // "其他" path; the custom field remains available for other decimal values.
  assert.match(admin, /presets=\['0','0\.5',\.\.\.Array\.from\(\{length:10\}/);
  assert.match(admin, /data-weight-other inputmode="decimal"/);

  // The shared queue keeps writes in order without blocking the UI between them.
  assert.match(admin, /function enqueueAdminWrite\(task\)\{/);
  assert.match(admin, /adminWriteTail=queued\.catch\(\(\)=>\{\}\);/);

  // Every write used to be followed by `await loadMetadata()`, which refetches /tables AND reloads the
  // whole current table -- three round trips per edit. Those blocking chains must be gone.
  assert.doesNotMatch(admin, /closeEditor\(\);await loadMetadata\(\)/);
  assert.doesNotMatch(admin, /\{method:'DELETE',body:'\{\}'\}\);await loadMetadata\(\)/);

  // The weight scope actions must not refetch the entire database table before the user can continue;
  // the case counts they need are refreshed in the background instead.
  const scopeRunner = admin.match(/async function runWeightScopeAction\(action,payload,successMessage\)\{[\s\S]*?\n    \}/)?.[0];
  assert.ok(scopeRunner, 'could not locate runWeightScopeAction');
  assert.doesNotMatch(scopeRunner, /await ensureCaseInfoRows\(\)/);
  assert.doesNotMatch(scopeRunner, /await loadMetadata\(\)/);
  assert.match(scopeRunner, /void ensureCaseInfoRows\(\)\.catch/);

  // A visible hint that something is still being written, since saves no longer block the screen.
  assert.match(admin, /id="writeBusy"/);
  assert.match(admin, /function updateWriteBusyHint\(\)\{/);

  // Local repaint replaces the refetch, so it needs the last rendered payload.
  assert.match(admin, /function repaintCurrentTable\(\)\{if\(lastRenderedTableData\)renderTable\(lastRenderedTableData\)\}/);
  assert.match(admin, /function renderTable\(data\)\{\n      lastRenderedTableData=data;/);
});

test('weight settings can rename a stage or detail without disturbing any score, hide one without disturbing any score, and only lose points on an actual delete', async t => {
  const app = await fixture();
  t.after(() => app.close());
  const login = await api(app.baseUrl, 'adminLogin', { password: 'secret' });
  const makeCase = async details => (await api(app.baseUrl, 'create', {
    row: { client: 'C', project: 'P', owner: 'PM', designer: 'Machi', type: '平面', stage: '後製', qty: 10, details },
    editorToken: login.token
  })).row.id;
  const caseRow = id => app.database.table('database').rows.find(row => row['案件編號'] === id);
  const rule = (stage, detail) => app.database.table('加權計分標準').rows
    .find(row => row['設計種類'] === '平面' && row['階段'] === stage && row['項目細節'] === detail);

  const single = await makeCase('社群貼文');          // 1 分 × 10
  const multi = await makeCase('影音包框, 修圖');       // (2 + 0.5) × 10
  assert.equal(caseRow(single)['加權'], '10');
  assert.equal(caseRow(multi)['加權'], '25');

  // Renaming a stage must carry the existing cases with it, otherwise every one of them stops matching
  // the rule (scores are an exact 設計種類+階段+項目細節 string match) and silently drops to 0.
  const stageRename = await api(app.baseUrl, 'adminWeightScopeSave', {
    type: '平面', stage: '後製', newStage: '後期', editorToken: login.token
  });
  assert.equal(stageRename.renamedCases, 2);
  assert.equal(caseRow(single)['階段'], '後期');
  assert.equal(caseRow(single)['加權'], '10');
  assert.equal(caseRow(multi)['加權'], '25');

  // Same for a detail rename -- and only the matching entry of the multi-value field may change.
  const detailRename = await api(app.baseUrl, 'adminWeightScopeSave', {
    type: '平面', stage: '後期', detail: '影音包框', newDetail: '包框影片', editorToken: login.token
  });
  assert.equal(detailRename.renamedCases, 1);
  assert.equal(caseRow(multi)['項目細節'], '包框影片, 修圖');
  assert.equal(caseRow(multi)['加權'], '25');

  // 下架 is the safe retirement: the rule stays in place for scoring, only the picker stops offering it.
  const hidden = await api(app.baseUrl, 'adminWeightScopeSave', {
    type: '平面', stage: '後期', detail: '包框影片', status: '下架', editorToken: login.token
  });
  assert.equal(hidden.ok, true);
  assert.equal(rule('後期', '包框影片')['狀態'], '下架');
  assert.equal(caseRow(multi)['加權'], '25');

  // Deleting really does cost the points, and the response reports how many cases were affected.
  const removed = await api(app.baseUrl, 'adminWeightScopeDelete', {
    type: '平面', stage: '後期', detail: '包框影片', editorToken: login.token
  });
  assert.equal(removed.removedRules, 1);
  assert.equal(removed.affectedCases, 1);
  assert.equal(caseRow(multi)['加權'], '5');   // 修圖 0.5 × 10 remains
  assert.equal(caseRow(single)['加權'], '10'); // untouched

  // Guard rails.
  const clash = await request(app.baseUrl, '/api', { method: 'POST', body: {
    action: 'adminWeightScopeSave', type: '平面', stage: '後期', newStage: '印刷', editorToken: login.token
  } });
  assert.equal(clash.response.status, 400);
  assert.match(clash.data.error, /已經有「印刷」這個階段/);

  const badStatus = await request(app.baseUrl, '/api', { method: 'POST', body: {
    action: 'adminWeightScopeSave', type: '平面', stage: '後期', status: '停用', editorToken: login.token
  } });
  assert.equal(badStatus.response.status, 400);

  const missing = await request(app.baseUrl, '/api', { method: 'POST', body: {
    action: 'adminWeightScopeDelete', type: '平面', stage: '不存在的階段', editorToken: login.token
  } });
  assert.equal(missing.response.status, 400);
});

test('weight settings admin exposes stage/detail maintenance inline and drops the vague top-right add button, and a 下架 option never reaches the request form', async () => {
  const admin = await readFile(new URL('../../json_database_admin.html', import.meta.url), 'utf8');
  const index = await readFile(new URL('../../index.html', import.meta.url), 'utf8');
  const schema = await readFile(new URL('../../backend/schema.mjs', import.meta.url), 'utf8');

  // 狀態 column backs the 下架 concept.
  assert.match(schema, /headers: \['設計種類', '階段', '項目細節', '權重', '備註', '狀態'\]/);

  // The picker must skip retired options, while scoring keeps them -- that is the whole point of 下架.
  assert.match(index, /if\(String\(row\['狀態'\]\|\|''\)\.trim\(\)==='下架'\)return;/);
  const syncFn = index.match(/function syncWeightRulesFromDatabase\(database\)\{[\s\S]*?\n/)?.[0];
  assert.ok(syncFn, 'could not locate syncWeightRulesFromDatabase');
  assert.doesNotMatch(syncFn, /下架/, 'scoring rules must not filter out 下架 rows');

  // Inline maintenance buttons at every level the user asked for.
  for (const hook of ['data-weight-stage-add', 'data-weight-detail-add', 'data-weight-stage-rename',
    'data-weight-stage-toggle', 'data-weight-stage-delete', 'data-weight-detail-rename', 'data-weight-detail-toggle']) {
    assert.ok(admin.includes(hook), `${hook} should exist in the weight settings markup`);
  }
  // The vague "+ 新增項目" header button is gone for this table.
  assert.match(admin, /function updateAddButton\(\)\{const hidden=tableName==='角色權限範本'\|\|tableName==='客戶別'\|\|tableName==='加權計分標準'\|\|/);

  // Buttons live inside <summary>, which would otherwise collapse the group on every click.
  assert.match(admin, /if\(weightScopeButton\)\{\n\s*event\.preventDefault\(\);/);

  // Destructive paths have to state the blast radius and point at 下架 instead.
  const deleteStage = admin.match(/async function deleteWeightStage\(target\)\{[\s\S]*?\n    \}/)?.[0];
  assert.ok(deleteStage, 'could not locate deleteWeightStage');
  assert.match(deleteStage, /weightScopeCaseCount/);
  assert.match(deleteStage, /建議改用「下架」/);
  // Renaming has to promise the score stays put, because that is what renameCases actually guarantees.
  const renameStage = admin.match(/async function renameWeightStage\(target\)\{[\s\S]*?\n    \}/)?.[0];
  assert.match(renameStage, /加權分數維持不變/);
});

test('deleting a case also removes its modification records and supplement links, so the next case that reuses the id does not inherit them', async t => {
  const app = await fixture();
  t.after(() => app.close());
  const login = await api(app.baseUrl, 'adminLogin', { password: 'secret' });
  const created = await api(app.baseUrl, 'create', {
    row: { client: '測試客戶', project: '刪除連動測試', owner: 'PM', designer: 'Machi', type: '平面', stage: '後製', qty: 1 },
    editorToken: login.token
  });
  const caseId = created.row.id;

  await api(app.baseUrl, 'addModificationRecord', {
    record: { caseId, modifyDate: '2026/09/10', content: '一修內容', modifier: 'Machi' }, editorToken: login.token
  });
  await api(app.baseUrl, 'addModificationRecord', {
    record: { caseId, modifyDate: '2026/09/10', content: '二修內容', modifier: 'Machi' }, editorToken: login.token
  });
  await api(app.baseUrl, 'update', {
    id: caseId, row: { briefUrl: 'https://example.com/brief-old' }, writeHeaders: ['設計簡報連結'], editorToken: login.token
  });

  const rowsFor = table => app.database.table(table).rows.filter(row => String(row['案件編號']) === String(caseId));
  assert.equal(rowsFor('修改統計表').length, 2);
  assert.equal(rowsFor('補充資料連結').length, 1);

  const deleted = await api(app.baseUrl, 'delete', { id: caseId, editorToken: login.token });
  assert.equal(deleted.ok, true);
  assert.equal(deleted.removedModificationRows, 2);
  assert.equal(deleted.removedSupplementRows, 1);
  assert.equal(rowsFor('修改統計表').length, 0);
  assert.equal(rowsFor('補充資料連結').length, 0);

  // 案件編號是「當月現有資料列最大號碼 + 1」，所以刪掉當月最新案件之後，下一筆新案件會拿到
  // 完全相同的編號 -- 這正是舊行為底下孤兒資料會被新案件直接繼承的原因。
  const recreated = await api(app.baseUrl, 'create', {
    row: { client: '另一個客戶', project: '重用編號的新案件', owner: 'PM', designer: 'Machi', type: '平面', stage: '後製', qty: 1 },
    editorToken: login.token
  });
  assert.equal(recreated.row.id, caseId, 'the next case is expected to reuse the deleted id');
  const inherited = await api(app.baseUrl, 'listModificationRecords', { ids: [recreated.row.id] });
  assert.equal(inherited.rows.length, 0);

  // Deleting a case that has no dependent rows still works and reports zero.
  const second = await api(app.baseUrl, 'create', {
    row: { client: 'C', project: '沒有附屬資料', owner: 'PM', designer: 'Machi', type: '平面', stage: '後製', qty: 1 },
    editorToken: login.token
  });
  const plain = await api(app.baseUrl, 'delete', { id: second.row.id, editorToken: login.token });
  assert.equal(plain.ok, true);
  assert.equal(plain.removedModificationRows, 0);
  assert.equal(plain.removedSupplementRows, 0);
});

test('the front end warns that deleting a case takes its modification records with it, and drops the local caches for that id', async () => {
  const html = await readFile(new URL('../../index.html', import.meta.url), 'utf8');
  const deleteFn = html.match(/function deleteRow\(id\)\{[\s\S]*?\n\}/)?.[0];
  assert.ok(deleteFn, 'could not locate deleteRow');
  // Deleting now destroys the modification history too, so the confirm has to say so.
  assert.match(deleteFn, /這個案件的 \$\{recordCount\} 筆修改紀錄/);
  assert.match(deleteFn, /此動作無法復原/);
  // Without clearing these, a re-created case reusing the same id would show the old rounds from cache
  // until the next full refresh.
  assert.match(deleteFn, /modificationRecords\.delete\(String\(id\)\); modificationCounts\.delete\(String\(id\)\);/);
});

test('designers can add a missing 初稿 (round 0) record and delete a whole modification round from the 修改紀錄 modal', async t => {
  const app = await fixture();
  t.after(() => app.close());
  const login = await api(app.baseUrl, 'adminLogin', { password: 'secret' });
  const created = await api(app.baseUrl, 'create', {
    row: { client: '測試客戶', project: '初稿測試', owner: 'PM', designer: 'Machi', type: '平面', stage: '後製', qty: 1 },
    editorToken: login.token
  });
  const caseId = created.row.id;

  // Without an explicit draft flag the existing behaviour is unchanged: the first record is 一修,
  // never 初稿 -- which is exactly why a case that never went through NAS auto-backup could not get one.
  const firstModification = await api(app.baseUrl, 'addModificationRecord', {
    record: { caseId, modifyDate: '2026/09/10', content: '一修內容', modifier: 'Machi' }, editorToken: login.token
  });
  assert.equal(firstModification.count, 1);

  // draft:true creates round 0 instead, and marks it confirmed straight away (a 初稿 is complete by
  // definition, so it must not show up as an outstanding modification request).
  const draftRecord = await api(app.baseUrl, 'addModificationRecord', {
    record: { caseId, modifyDate: '2026/09/08', content: '初稿完成', modifier: 'Machi', draft: true }, editorToken: login.token
  });
  assert.equal(draftRecord.count, 0);
  assert.equal(draftRecord.record['修改次數'], '0');
  assert.ok(draftRecord.record['確認修正日']);

  // Only one 初稿 per case.
  const duplicate = await request(app.baseUrl, '/api', { method: 'POST', body: {
    action: 'addModificationRecord',
    record: { caseId, modifyDate: '2026/09/08', content: '又一個初稿', modifier: 'Machi', draft: true },
    editorToken: login.token
  } });
  assert.equal(duplicate.response.status, 400);
  assert.match(duplicate.data.error, /已經有初稿/);

  // Adding a normal modification after the draft still continues from the highest round.
  const secondModification = await api(app.baseUrl, 'addModificationRecord', {
    record: { caseId, modifyDate: '2026/09/10', content: '二修內容', modifier: 'Machi' }, editorToken: login.token
  });
  assert.equal(secondModification.count, 2);

  const roundsOf = () => app.database.table('修改統計表').rows
    .filter(row => String(row['案件編號']) === String(caseId))
    .map(row => Number(row['修改次數']) || 0).sort((a, b) => a - b);
  assert.deepEqual(roundsOf(), [0, 1, 2]);

  // Deleting a whole round removes exactly that record...
  const deleted = await api(app.baseUrl, 'deleteModificationRecord', { caseId, count: 1, editorToken: login.token });
  assert.equal(deleted.ok, true);
  assert.equal(deleted.count, 1);
  // ...and deliberately does NOT renumber the remaining rounds: renumbering would rewrite other
  // records' identities and desync the NAS watcher's per-file assignedRound state.
  assert.deepEqual(roundsOf(), [0, 2]);

  // Deleting something that is not there is an error rather than a silent no-op.
  const missing = await request(app.baseUrl, '/api', { method: 'POST', body: {
    action: 'deleteModificationRecord', caseId, count: 7, editorToken: login.token
  } });
  assert.equal(missing.response.status, 400);
  assert.match(missing.data.error, /找不到指定的修改紀錄/);

  // The 初稿 itself can be deleted too (it is just round 0).
  await api(app.baseUrl, 'deleteModificationRecord', { caseId, count: 0, editorToken: login.token });
  assert.deepEqual(roundsOf(), [2]);
});

test('admin account bulk import creates accounts from a parsed roster and skips bad or duplicate rows', async t => {
  const app = await fixture();
  t.after(() => app.close());
  const login = await api(app.baseUrl, 'adminLogin', { password: 'secret' });

  const imported = await api(app.baseUrl, 'adminAccountBulkImport', {
    editorToken: login.token,
    role: '一般使用者',
    employees: [
      { name: '蔡啓泓', department: '凱曜專案部', group: 'Poppy組', account: 'eric.tsai@emctaipei.com' },
      { name: '徐千涵', department: '凱曜管理部', group: '人資行政組', account: 'tina.hsu@emctaipei.com' },
      { name: '外部廠商', department: '', group: '', account: 'vendor@gmail.com' },
      { name: '', department: '凱曜專案部', group: 'Odin組', account: 'noname@emctaipei.com' },
      { name: '蔡啓泓重複', department: '凱曜專案部', group: 'Poppy組', account: 'Eric.Tsai@emctaipei.com' }
    ]
  });
  assert.deepEqual(imported.created, ['eric.tsai@emctaipei.com', 'tina.hsu@emctaipei.com']);
  assert.equal(imported.skipped.length, 3);
  assert.match(imported.skipped.find(item => item.account === 'vendor@gmail.com').reason, /@emctaipei\.com/);
  assert.equal(imported.skipped.find(item => item.account === 'noname@emctaipei.com').reason, '缺少姓名');
  assert.equal(imported.skipped.find(item => item.account === 'eric.tsai@emctaipei.com').reason, '帳號已存在，略過');

  const ericSettings = app.database.table('設定').rows.find(row => row['帳號'] === 'eric.tsai@emctaipei.com');
  assert.equal(ericSettings['名字'], '蔡啓泓');
  assert.equal(ericSettings['顯示名'], '蔡啓泓');
  assert.equal(ericSettings['部門'], '凱曜專案部');
  assert.equal(ericSettings['組別'], 'Poppy組');
  const ericPermission = app.database.table('帳號權限').rows.find(row => row['帳號'] === 'eric.tsai@emctaipei.com');
  assert.equal(ericPermission['角色範本'], '一般使用者');
  assert.equal(ericPermission['狀態'], '啟用');
  assert.equal(ericPermission['登入方式'], '公司信箱');
  assert.deepEqual(JSON.parse(ericPermission['頁面權限']).sort(), ['avatar_upload', 'request', 'short_link'].sort());

  // 同一批名單再匯入一次：全部視為已存在略過，不會建立重複帳號。
  const reimported = await api(app.baseUrl, 'adminAccountBulkImport', {
    editorToken: login.token,
    employees: [{ name: '蔡啓泓', department: '凱曜專案部', group: 'Poppy組', account: 'eric.tsai@emctaipei.com' }]
  });
  assert.deepEqual(reimported.created, []);
  assert.equal(app.database.table('設定').rows.filter(row => row['帳號'] === 'eric.tsai@emctaipei.com').length, 1);

  const designerImport = await api(app.baseUrl, 'adminAccountBulkImport', {
    editorToken: login.token,
    role: '設計師',
    employees: [{ name: '新設計師', department: '設計部', group: '平面', account: 'new.hire@emctaipei.com' }]
  });
  assert.deepEqual(designerImport.created, ['new.hire@emctaipei.com']);
  const designerPermission = app.database.table('帳號權限').rows.find(row => row['帳號'] === 'new.hire@emctaipei.com');
  assert.equal(designerPermission['角色範本'], '設計師');
  assert.ok(JSON.parse(designerPermission['功能權限']).includes('designer.settings'));

  const badRole = await request(app.baseUrl, '/api', { method: 'POST', body: {
    action: 'adminAccountBulkImport', editorToken: login.token, role: '不存在',
    employees: [{ name: '測試', account: 'bad.role@emctaipei.com' }]
  } });
  assert.equal(badRole.response.status, 400);
  assert.equal(app.database.table('設定').rows.some(row => row['帳號'] === 'bad.role@emctaipei.com'), false);
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
  // 改成下架而非整列刪除：資料列與留言／按讚紀錄仍保留在後台，只是不再出現在前台限動清單。
  const hiddenStoryRow = app.database.table('reels').rows.find(row => row['限時動態連結'] === story.url);
  assert.ok(hiddenStoryRow, 'hidden reel row should still exist');
  assert.equal(hiddenStoryRow['狀態'], '下架');
  const reelsAfterHide = await api(app.baseUrl, 'listReels', { editorToken: login.token });
  assert.equal(reelsAfterHide.reels.some(reel => reel.imageUrl === story.url), false);

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

test('designer reel reactions and comments consume the shared story response contract', async () => {
  const html = await readFile(new URL('../../index.html', import.meta.url), 'utf8');
  const reactionHandler = html.match(/async function toggleDesignerReelReaction\(button\)\{[\s\S]*?\nasync function submitDesignerReelComment/)?.[0] || '';
  const commentHandler = html.match(/async function submitDesignerReelComment\(form\)\{[\s\S]*?\nlet spotifyIframeApi/)?.[0] || '';

  assert.match(reactionHandler, /applyUpdatedActiveReel\(data\.story\)/);
  assert.doesNotMatch(reactionHandler, /applyUpdatedActiveReel\(data\.reel\)/);
  assert.match(commentHandler, /applyUpdatedActiveReel\(data\.story\)/);
  assert.doesNotMatch(commentHandler, /applyUpdatedActiveReel\(data\.reel\)/);
});

test('project detail and modification-history thumbnails support reliable viewport-bounded hover previews', async () => {
  const html = await readFile(new URL('../../index.html', import.meta.url), 'utf8');
  const thumbnailMarkup = html.match(/function caseDetailDesignImagesHtml\(row\)\{[^\n]+\}/)?.[0] || '';
  const revisionThumbnailMarkup = html.match(/function revisionImagesHtml\(row,record\)\{[^\n]+\}/)?.[0] || '';

  assert.match(thumbnailMarkup, /data-design-image-hover-preview/);
  assert.match(thumbnailMarkup, /design-image-expand-icon/);
  assert.match(thumbnailMarkup, /target="_blank" rel="noopener"/);
  assert.match(revisionThumbnailMarkup, /data-design-image-hover-preview/);
  assert.match(revisionThumbnailMarkup, /data-preview-label/);
  assert.match(revisionThumbnailMarkup, /design-image-expand-icon/);
  assert.match(revisionThumbnailMarkup, /target="_blank" rel="noopener"/);
  assert.match(html, /function showDesignImageHoverPreview\(anchor,x,y\)/);
  assert.match(html, /function hideDesignImageHoverPreview\(anchor=null\)/);
  assert.match(html, /function isDesignImageHoverPointer\(event\)/);
  assert.match(html, /pointerType\|\|'mouse'/);
  assert.doesNotMatch(html, /matchMedia\?\.\('\(hover:hover\) and \(pointer:fine\)'\)/);
  assert.match(html, /\.design-image-hover-preview\{position:fixed;z-index:10000!important/);
  assert.match(html, /Math\.min\(left,window\.innerWidth-width-margin\)/);
  assert.match(html, /Math\.min\(top,window\.innerHeight-height-margin\)/);
  assert.match(html, /document\.addEventListener\('pointerover'/);
  assert.match(html, /document\.addEventListener\('pointermove'/);
  assert.match(html, /document\.addEventListener\('pointerout'/);
  assert.match(html, /document\.addEventListener\('focusin'/);
  assert.match(html, /document\.addEventListener\('scroll',\(\)=>hideDesignImageHoverPreview\(\),true\)/);
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
  // 改成下架而非整列刪除：資料列本身仍保留，只是不會出現在前台限動清單。
  const hiddenStoryRow = app.database.table('reels').rows.find(row => String(row['限時動態連結']).includes(storyId));
  assert.ok(hiddenStoryRow, 'hidden reel row should still exist');
  assert.equal(hiddenStoryRow['狀態'], '下架');
  const reelsAfterDelete = await api(app.baseUrl, 'listReels', { editorToken: login.token });
  assert.equal(reelsAfterDelete.reels.some(reel => reel.imageUrl.includes(storyId)), false);
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

test('case design uploader accepts files whose MIME type the browser could not infer, always explains an empty selection, and can never hang forever on a video frame grab', async () => {
  const html = await readFile(new URL('../../upload/upload.html', import.meta.url), 'utf8');

  // 1) Selecting files did nothing when the browser reported an empty file.type (common for files on
  // mounted network/NAS volumes): both media checks read only .type, so every file was silently
  // dropped as "unsupported" and the user was left staring at an empty picker. Fall back to the
  // extension, the same way the NAS watcher already decides what is an image or a video.
  assert.match(html, /const CASE_DESIGN_VIDEO_EXTENSIONS = \['\.mp4', '\.mov', '\.m4v', '\.webm'\];/);
  assert.match(html, /const CASE_DESIGN_IMAGE_EXTENSIONS = \['\.jpg', '\.jpeg', '\.png', '\.webp', '\.gif'\];/);
  assert.match(html, /function caseDesignFileExtension\(file\) \{/);
  assert.match(html, /return !type && CASE_DESIGN_VIDEO_EXTENSIONS\.includes\(caseDesignFileExtension\(file\)\);/);
  assert.match(html, /return !type && CASE_DESIGN_IMAGE_EXTENSIONS\.includes\(caseDesignFileExtension\(file\)\);/);

  // 2) A selection that adds nothing must say why instead of leaving a blank panel with no next step.
  assert.match(html, /\} else if \(files\.length && !caseDesignFiles\.length\) \{/);
  assert.match(html, /選取的檔案都不是可上傳的圖片或影片/);
  assert.match(html, /這個資料夾裡沒有找到可上傳的圖片或影片/);

  // 3) extractVideoFrame waited on events that may never arrive, so one video could wedge the whole
  // batch at "上傳中 0/N" with no way out. Every stall path now has to terminate.
  const frameFn = html.match(/function extractVideoFrame\(file\) \{[\s\S]*?\n    \}\n/)?.[0];
  assert.ok(frameFn, 'could not locate extractVideoFrame');
  // A hard watchdog so the loop always moves on to the next file.
  assert.match(frameFn, /timeoutTimer = setTimeout\(function \(\) \{/);
  assert.match(frameFn, /讀取影片畫面逾時/);
  // Seeking to where the video already is emits no 'seeked' event -- capture straight away instead.
  assert.match(frameFn, /if \(!\(seekTime > 0\.01\) \|\| Math\.abs\(Number\(video\.currentTime\) - seekTime\) < 0\.01\) \{/);
  // Unseekable containers never emit 'seeked' either: fall back to the frame already decoded.
  assert.match(frameFn, /seekTimer = setTimeout\(capture, 4000\);/);
  // duration can be 0 / NaN / Infinity on stream-ish MP4s; those must not produce a NaN seek target.
  assert.match(frameFn, /Number\.isFinite\(duration\) && duration > 0 \? Math\.min\(1, duration \* 0\.1\) : 0/);
  // Frames only decode once real data is loaded, not just metadata.
  assert.match(frameFn, /video\.preload = 'auto';/);
  // Timers must be cleared on every exit path or a settled promise still leaves work pending.
  assert.match(frameFn, /const clearTimers = function \(\) \{/);
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

test('mailAction() branches into 串接／回信／發信 depending on gmailThreadId and whether the login is a designer, each respecting canSendMailRow permission', async () => {
  const html = await readFile(new URL('../../index.html', import.meta.url), 'utf8');
  // 用配對括號/大括號深度計數精確擷取每個函式本體（不是用「找下一個 \n}」這種粗略字串比對——
  // jsArg 這類單行函式沒有獨立成行的 \n}，用字串比對會一路吃到後面幾十個函式之後才找到的 \n}，
  // mailAction 這種函式簽章裡帶解構預設值 {icon=false} 的情況，第一個 { 也不是真正的函式本體開頭，
  // 兩者都會讓擷取範圍算錯，這裡改成先跳過完整的參數列（配對括號），再從函式本體真正的 { 開始配對）。
  function extractFunction(name) {
    const marker = `function ${name}(`;
    const start = html.indexOf(marker);
    assert.ok(start > 0, `找不到函式 ${name}`);
    let i = start + marker.length - 1;
    let parenDepth = 0;
    for (; i < html.length; i++) {
      if (html[i] === '(') parenDepth++;
      else if (html[i] === ')') { parenDepth--; if (parenDepth === 0) { i++; break } }
    }
    while (html[i] !== '{') i++;
    let depth = 0;
    for (; i < html.length; i++) {
      if (html[i] === '{') depth++;
      else if (html[i] === '}') { depth--; if (depth === 0) { i++; break } }
    }
    return html.slice(start, i);
  }
  // 只挑出 mailAction 真正需要的函式本體，刻意不整段區間擷取——因為 accessAllowed／hasDesignerAccountRole／
  // rowYear 這三個在 index.html 裡剛好也定義在 jsArg 到 mailAction 這段區間內，如果整段擷取，函式宣告會
  // 直接蓋掉同名的 mock 參數（function 宣告優先權高於同名參數），導致這幾個 mock 完全沒有作用。
  const source = ['jsArg', 'historyLock', 'mailIcon', 'gmailReplyIcon', 'linkThreadIcon', 'isEditableRow', 'canSendMailRow', 'isDesignerLogin', 'mailAction']
    .map(extractFunction).join('\n');
  const run = new Function(
    'accessAllowed', 'isCustomerEditRestrictedCase', 'isCustomerEditPermitted', 'hasDesignerAccountRole', 'currentYear', 'rowYear',
    `${source};return mailAction;`
  );
  const editableRow = { id: '26080099', pendingCreate: false };
  const currentYearFn = () => 2026;
  const rowYearFn = () => 2026;
  // accessAllowed(key,fallback) 的真實語意是「有讀到伺服器權限設定就用設定值，沒有就用呼叫端傳入的
  // fallback」——這裡用一個依 key 覆寫、其餘一律照抄呼叫端 fallback 的假函式模擬，不能簡化成回傳固定
  // 布林值，否則 isDesignerLogin() 呼叫 accessAllowed('request.status',hasDesignerAccountRole()) 跟
  // canSendMailRow() 呼叫 accessAllowed('request.mail',true) 這兩個不同 key 就會被同一個固定值污染。
  const mockAccess = overrides => (key, fallback = true) => (key in overrides ? overrides[key] : fallback);

  // 沒有 gmailThreadId、登入是設計師、有發信權限 → 「串接」，onclick 呼叫 openBindExistingThreadModal。
  const designerCanSend = run(mockAccess({ 'request.mail': true }), () => false, () => false, () => true, currentYearFn, rowYearFn);
  const linkButton = designerCanSend(editableRow);
  assert.match(linkButton, /gmail-link-btn/);
  assert.match(linkButton, /openBindExistingThreadModal\(event,'26080099'\)/);
  assert.match(linkButton, /<span>串接<\/span>/);
  assert.doesNotMatch(linkButton, /disabled/);

  // 沒有 gmailThreadId、登入是設計師、沒有發信權限 → 灰階「串接」，不帶 onclick 的可執行呼叫（disabled）。
  const designerCannotSend = run(mockAccess({ 'request.mail': false }), () => false, () => false, () => true, currentYearFn, rowYearFn);
  const disabledLinkButton = designerCannotSend(editableRow);
  assert.match(disabledLinkButton, /gmail-link-btn/);
  assert.match(disabledLinkButton, /disabled aria-disabled="true" title="沒有發信權限"/);
  assert.match(disabledLinkButton, /<span>串接<\/span>/);

  // 沒有 gmailThreadId、非設計師、有發信權限 → 維持既有的「發信」，onclick 呼叫 openMailComposerMenu。
  const nonDesignerCanSend = run(mockAccess({ 'request.mail': true }), () => false, () => false, () => false, currentYearFn, rowYearFn);
  const mailButton = nonDesignerCanSend(editableRow);
  assert.match(mailButton, /openMailComposerMenu\(event,'26080099'\)/);
  assert.match(mailButton, /<span>發信<\/span>/);
  assert.doesNotMatch(mailButton, /gmail-link-btn|gmail-reply-btn/);

  // 有 gmailThreadId → 一律「回信」，不管是不是設計師，走 openReplyMethodChooser，不會變成「串接」。
  const boundRow = { ...editableRow, gmailThreadId: 'thread-123' };
  const designerReply = run(mockAccess({ 'request.mail': true }), () => false, () => false, () => true, currentYearFn, rowYearFn);
  const replyButton = designerReply(boundRow);
  assert.match(replyButton, /gmail-reply-btn/);
  assert.match(replyButton, /openReplyMethodChooser\(event,'26080099'\)/);
  assert.match(replyButton, /<span>回信<\/span>/);
  assert.doesNotMatch(replyButton, /串接/);

  // 有 gmailThreadId 但沒有回信權限 → 灰階「回信」。
  const noReplyPermission = run(mockAccess({ 'request.mail': false }), () => false, () => false, () => true, currentYearFn, rowYearFn);
  const disabledReplyButton = noReplyPermission(boundRow);
  assert.match(disabledReplyButton, /disabled aria-disabled="true" title="沒有回信權限"/);

  // 案件不可編輯（歷史資料）時，不管身份或權限一律顯示歷史資料鎖，不會出現任何一種寄信按鈕。
  const historyRow = { id: '26080099', pendingCreate: false };
  const historicalYear = () => 2020;
  const historyResult = run(mockAccess({ 'request.mail': true }), () => false, () => false, () => true, currentYearFn, historicalYear)(historyRow);
  assert.match(historyResult, /history-lock/);
  assert.doesNotMatch(historyResult, /串接|發信|回信/);
});

test('links written into a 修改紀錄 entry are clickable in the modal, while everything else stays escaped text', async () => {
  const html = await readFile(new URL('../../index.html', import.meta.url), 'utf8');
  // 修改需求常直接貼 Google 簡報或雲端連結，原本整段用 esc() 當純文字輸出，網址點不開。
  // renderRevisionModal 已經不是單行（加入了保留選取的處理），整支函式一起抓。
  const render = html.match(/function renderRevisionModal\(id\)\{[\s\S]*?updateRevisionSelectionBar\(\);\}/)?.[0];
  assert.ok(render, 'could not locate renderRevisionModal');
  assert.match(render, /<div class="revision-modal-content">\$\{linkifyPlainText\(record\.content\|\|/);
  assert.doesNotMatch(render, /<div class="revision-modal-content">\$\{esc\(/);
  assert.match(html, /\.revision-modal-content a\{color:var\(--green\);text-decoration:underline/);
  assert.match(html, /html\[data-theme="dark"\] \.revision-modal-content a\{color:#8ab4f8!important\}/);

  // Run the real linkifier on the exact text from the reported case.
  const pick = name => html.match(new RegExp(`function ${name}\\([^)]*\\)\\{[\\s\\S]*?\\n\\}`))?.[0] || html.match(new RegExp(`function ${name}\\([^)]*\\)\\{[^\\n]*`))?.[0];
  const linkify = new Function(`
    const esc = value => String(value ?? '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
    ${pick('safeHttpPreviewUrl')}
    ${pick('linkifyPlainText')}
    return linkifyPlainText;
  `)();
  const url = 'https://docs.google.com/presentation/d/1eEOYjXBnSAgysJy43UY8vjMa1ZKm5JZB1adADHK1miM/edit?slide=id.g3fa6d495c36_6_0#slide=id.g3fa6d495c36_6_0';
  const out = linkify(`感謝大神支援！！這邊有幾張，客戶希望調整一下資訊， 再麻煩您：\n${url}`);
  assert.match(out, /^感謝大神支援！！這邊有幾張，客戶希望調整一下資訊， 再麻煩您：\n<a href="/);
  assert.ok(out.includes(`target="_blank" rel="noopener noreferrer">${url}</a>`), out);
  // 句尾標點不能被吃進網址裡——中文的全形標點常常直接黏在網址後面、中間沒有空白。
  assert.ok(linkify('請看 https://example.com/a。').includes('href="https://example.com/a" target="_blank" rel="noopener noreferrer">https://example.com/a</a>。'));
  assert.ok(linkify('連結https://example.com/b，謝謝').includes('>https://example.com/b</a>，謝謝'));
  assert.ok(linkify('（https://example.com/c）').includes('>https://example.com/c</a>）'));
  assert.ok(linkify('See https://example.com/d.').includes('>https://example.com/d</a>.'));
  // 只擋標點不擋一般中文字：路徑本身含中文的網址要完整保留。
  assert.ok(linkify('https://example.com/設計圖/初稿 完成').includes('>https://example.com/設計圖/初稿</a> 完成'));
  // 不是 http(s) 的東西不會變成連結，HTML 也照樣被逃脫。
  assert.equal(linkify('javascript:alert(1) <b>x</b>'), 'javascript:alert(1) &lt;b&gt;x&lt;/b&gt;');
  assert.equal(linkify('初稿完成'), '初稿完成');
});

test('a computer upload started from the designer reply flow opens the mail editor right away and shows live upload progress where the images will go', async () => {
  const html = await readFile(new URL('../../index.html', import.meta.url), 'utf8');

  // 以前按下「上傳全部」後上傳視窗只會縮到背景，角落剩一個小徽章，設計師以為沒上傳成功又重來一次。
  const handler = html.match(/if\(data\.type==='machi-case-design-upload-progress'\)\{[\s\S]*?\n    return;\n  \}/)?.[0];
  assert.ok(handler, 'could not locate the upload progress handler');
  assert.match(handler, /if\(!wasInFlight\)\{\s*\n\s*backgroundizeCaseDesignUpload\(\);/);
  assert.match(handler, /if\(caseDesignUploadAfterReply&&caseDesignUploadCaseId\)\{[\s\S]*?openDesignerReplyMailModal\(id,\{round,skipImages:caseDesignUploadSkipReplyImages\}\)/);
  // 編輯器開好之後要補上最新進度，因為進度訊息可能比編輯器建立完成更早抵達。
  assert.match(handler, /\.then\(\(\)=>\{const latest=caseDesignUploadLatestProgress; if\(latest\)updateDesignerReplyUploadProgress\(id,round,latest\.done,latest\.total\)\}\)/);
  assert.match(handler, /else if\(caseDesignUploadAfterReply&&caseDesignUploadCaseId\)\{\s*\n\s*updateDesignerReplyUploadProgress\(/);
  // 上傳仍在 iframe 裡跑，進度處理絕對不能關掉上傳視窗。
  assert.doesNotMatch(handler, /closeUploadModal\(/);

  // 進度訊息沒有案件編號，開啟上傳視窗時要先記住，關閉時清掉。
  assert.match(html, /caseDesignUploadCaseId=String\(row\.id\); caseDesignUploadLatestProgress=null; openUploadModal\(/);
  assert.match(html, /caseDesignUploadRound=0; caseDesignUploadCaseId=''; caseDesignUploadLatestProgress=null;/);

  // Run the real placeholder updater against a fake DOM.
  const source = html.match(/function updateDesignerReplyUploadProgress\(id,round,done,total\)\{[\s\S]*?\n\}/)?.[0];
  assert.ok(source, 'could not locate updateDesignerReplyUploadProgress');
  const run = ({ modal, placeholder }, args) => new Function('modal', 'placeholder', 'args', `
    const $ = selector => selector === '#gmailThreadModal' ? modal : null;
    const document = { querySelector: selector => selector === '#gmailDesignerReplyImages .gmail-designer-reply-uploading' ? placeholder : null };
    ${source}
    return updateDesignerReplyUploadProgress(...args);
  `)(modal, placeholder, args);
  const designerModal = () => ({ hidden: false, dataset: { replyMode: 'designer', designerReplyCaseId: '26090074', designerReplyRound: '0' } });

  const placeholder = { textContent: '　圖片上傳中...' };
  assert.equal(run({ modal: designerModal(), placeholder }, ['26090074', 0, 2, 5]), true);
  assert.equal(placeholder.textContent, '　圖片上傳中 2/5，完成後會自動放進信件...');
  // 不是這筆案件、不是這一輪、不是設計師回覆信、或編輯器已關閉，都不能動別人的信件內容。
  for (const modal of [
    { ...designerModal(), dataset: { ...designerModal().dataset, designerReplyCaseId: '26090075' } },
    { ...designerModal(), dataset: { ...designerModal().dataset, designerReplyRound: '1' } },
    { ...designerModal(), dataset: { ...designerModal().dataset, replyMode: 'general' } },
    { ...designerModal(), hidden: true }
  ]) {
    const untouched = { textContent: '原本的內容' };
    assert.equal(run({ modal, placeholder: untouched }, ['26090074', 0, 1, 3]), false);
    assert.equal(untouched.textContent, '原本的內容');
  }
  // 圖片已經套用完、佔位區塊不在了，就不再寫任何東西。
  assert.equal(run({ modal: designerModal(), placeholder: null }, ['26090074', 0, 5, 5]), false);
  // 超出總數的已完成數不會顯示成「6/5」。
  const clamp = { textContent: '' };
  run({ modal: designerModal(), placeholder: clamp }, ['26090074', 0, 6, 5]);
  assert.equal(clamp.textContent, '　圖片上傳中 5/5，完成後會自動放進信件...');
});

test('adding a 客戶別 with an expired login sends the user back to log in instead of silently creating it without their project group', async () => {
  const html = await readFile(new URL('../../index.html', import.meta.url), 'utf8');
  const worker = await readFile(new URL('../../worker/src/database-coordinator.ts', import.meta.url), 'utf8');

  // 後端：有帶憑證卻查不到登入就擋下，不再默默當成匿名建立。
  const addCustomer = worker.match(/private async addCustomer\([\s\S]*?\n  \}/)?.[0];
  assert.ok(addCustomer, 'could not locate addCustomer');
  assert.match(addCustomer, /if \(!session && sessionToken\(payload\)\) \{\s*\n\s*return \{ ok: false, action: 'addCustomer', error: '登入狀態已失效，請重新登入後再新增客戶別', reason: 'TOKEN_EXPIRED' \};/);
  // 擋下必須發生在建立資料之前。
  assert.ok(addCustomer.indexOf("reason: 'TOKEN_EXPIRED'") < addCustomer.indexOf("this.mutate('addCustomer'"));

  // 前台：錯誤訊息要被既有的「登入已失效」判斷認得，並清掉失效登入、打開登入視窗。
  const isExpired = new Function(`${html.match(/function isExpiredEditorSessionError\(error\)\{[^\n]*/)[0]}; return isExpiredEditorSessionError;`)();
  assert.equal(isExpired(new Error('登入狀態已失效，請重新登入後再新增客戶別')), true);
  const handler = html.match(/async function handleClientSelectChange\(el\)\{[\s\S]*?\n\}/)?.[0];
  assert.ok(handler, 'could not locate handleClientSelectChange');
  assert.match(handler, /if\(isExpiredEditorSessionError\(err\)\)\{\s*\n\s*clearLoginAuthState\(\);applyAccountSettingsIfNeeded\(\);updateLoginUi\(\);render\(\);\s*\n\s*showLoginModal\('登入狀態已失效，請重新登入後再新增客戶別'\);/);
  // 其他錯誤照舊顯示原本的失敗訊息，不會把人登出。
  assert.match(handler, /setSync\(`新增客戶別失敗：\$\{err\.message\}`,true\);/);
});

test('the designer reply can back up NAS or uploaded images without putting them into the mail, while still keeping the paths and unlocking send', async () => {
  const html = await readFile(new URL('../../index.html', import.meta.url), 'utf8');

  // 選單：只有設計師回覆信流程才出現勾選框，三個上傳選項都讀取它的狀態。
  const chooser = html.match(/function openCaseDesignImageSourceChooser\(id,round,anchorEl,\{afterReply=false\}=\{\}\)\{[^\n]*/)?.[0];
  assert.ok(chooser, 'could not locate openCaseDesignImageSourceChooser');
  assert.match(chooser, /const skipImagesOption=afterReply\?`<label class="designer-reply-skip-images"><input type="checkbox" data-skip-reply-images><span><b>信件編輯不同步圖片<\/b>/);
  assert.equal((chooser.match(/const skipReplyImages=skipReplyImagesChecked\(\); closeFieldPopover\(\);/g) || []).length, 3, '三個選項都要在關閉選單前讀取勾選狀態');
  assert.match(chooser, /reuseLastNasFolder\(id,round,\{afterReply,skipReplyImages\}\)/);
  assert.match(chooser, /openNasFolderPicker\(id,round,\{afterReply,skipReplyImages\}\)/);
  assert.match(chooser, /openCaseDesignImageUploadModal\(id,round,\{afterReply,skipReplyImages\}\)/);

  // 設定要一路帶到編輯器：NAS 備份開始／完成、電腦上傳開始／完成。
  assert.match(html, /openDesignerReplyMailModal\(activeNasFolderPickerCaseId,\{folders:startedFolderPaths,round:activeNasFolderPickerRound,skipImages:nasFolderPickerSkipReplyImages\}\)/);
  assert.match(html, /fileFolders:nasFileFolders,round:replyRound,skipImages:skipReplyImages\}\)/);
  assert.match(html, /openDesignerReplyMailModal\(id,\{round,skipImages:caseDesignUploadSkipReplyImages\}\)/);
  assert.match(html, /openDesignerReplyMailModal\(id,\{round:replyRound,skipImages:skipReplyImages\}\)/);
  // 關閉上傳視窗、NAS 選擇器結束時都要清掉，才不會影響下一次。
  assert.match(html, /caseDesignUploadAfterReply=false; caseDesignUploadSkipReplyImages=false;/);
  assert.ok(!/nasFolderPickerAfterReply=false;(?!nasFolderPickerSkipReplyImages=false;)/.test(html.replace('let nasFolderPickerAfterReply=false;', '')), '每個重設 afterReply 的地方都要一併重設不同步圖片');

  // 補開編輯器（skipImages 為 null）不可以把使用者勾選的設定蓋回去。
  const setter = html.match(/function setDesignerReplySkipImages\(modal,skipImages\)\{[\s\S]*?\n\}/)?.[0];
  assert.ok(setter, 'could not locate setDesignerReplySkipImages');
  const runSetter = (modal, value) => new Function('modal', 'value', `
    const document = { querySelector: () => null };
    ${setter}
    setDesignerReplySkipImages(modal, value);
  `)(modal, value);
  const kept = { dataset: { designerReplySkipImages: '1' } };
  runSetter(kept, null);
  assert.equal(kept.dataset.designerReplySkipImages, '1');
  runSetter(kept, false);
  assert.equal(kept.dataset.designerReplySkipImages, '');

  // Run the real applyDesignerReplyImages: with skip on, no thumbnails go in, but video paths and send unlock still happen.
  const apply = html.match(/function applyDesignerReplyImages\(id,images,\{round=null\}=\{\}\)\{[\s\S]*?\n\}/)?.[0];
  assert.ok(apply, 'could not locate applyDesignerReplyImages');
  const runApply = skip => {
    const calls = { thumbs: 0, videoPaths: null, removed: false };
    const container = { textContent: 'x', remove() { calls.removed = true; } };
    const modal = { dataset: { replyMode: 'designer', designerReplyCaseId: '26090074', designerReplyRound: '0', designerReplySkipImages: skip ? '1' : '', designerReplyPending: '1' } };
    const send = { disabled: true, textContent: '圖片上傳中...' };
    const schedule = { disabled: true };
    new Function('modal', 'container', 'send', 'schedule', 'calls', `
      const $ = selector => ({ '#gmailThreadModal': modal, '#gmailThreadReplySend': send, '#gmailThreadSchedule': schedule })[selector] || null;
      const document = { getElementById: id => id === 'gmailDesignerReplyImages' ? container : null };
      const appendDesignerReplyImageThumb = () => { calls.thumbs += 1; };
      const applyDesignerReplyVideoPaths = images => { calls.videoPaths = images; };
      ${apply}
      applyDesignerReplyImages('26090074', [{ fileName: 'a.png' }, { fileName: 'b.mp4' }], { round: 0 });
    `)(modal, container, send, schedule, calls);
    return { calls, modal, send, schedule };
  };
  const synced = runApply(false);
  assert.equal(synced.calls.thumbs, 2);
  assert.equal(synced.calls.removed, false);
  const skipped = runApply(true);
  assert.equal(skipped.calls.thumbs, 0, '勾選不同步時不可以放任何縮圖進信件');
  assert.equal(skipped.calls.removed, true, '圖片區塊整個拿掉，信件裡不留空白佔位');
  assert.equal(skipped.calls.videoPaths.length, 2, '影片完整路徑是路徑資訊，照樣放進信件');
  assert.equal(skipped.send.disabled, false);
  assert.equal(skipped.send.textContent, '送出回覆');
  assert.equal(skipped.schedule.disabled, false);
  assert.equal(skipped.modal.dataset.designerReplyPending, '');

  // 電腦上傳的進度文字要說清楚這次不會放進信件。
  const progress = html.match(/function updateDesignerReplyUploadProgress\(id,round,done,total\)\{[\s\S]*?\n\}/)[0];
  const placeholder = { textContent: '' };
  new Function('placeholder', `
    const modal = { hidden: false, dataset: { replyMode: 'designer', designerReplyCaseId: '26090074', designerReplyRound: '0', designerReplySkipImages: '1' } };
    const $ = () => modal;
    const document = { querySelector: () => placeholder };
    ${progress}
    updateDesignerReplyUploadProgress('26090074', 0, 3, 12);
  `)(placeholder);
  assert.equal(placeholder.textContent, '　圖片備份中 3/12，這次不會放進信件...');
});

test('修改中 is a first-class case status: its own colour in every theme, a KPI box that filters the list, and offered wherever a status can be chosen', async () => {
  const html = await readFile(new URL('../../index.html', import.meta.url), 'utf8');
  const admin = await readFile(new URL('../../json_database_admin.html', import.meta.url), 'utf8');
  const style = html.slice(0, html.lastIndexOf('</style>'));
  const count = (text, needle) => text.split(needle).length - 1;

  // 每一條過稿中的樣式（矩形框、列表標籤、狀態選單、時間軸、淺色／深色／各層主題覆寫）都要有修改中的對應規則，
  // 否則某個主題下修改中會掉回預設樣式。
  assert.equal(count(style, 'status-修改中'), count(style, 'status-過稿中'));
  assert.equal(count(style, '.修改中'), count(style, '.過稿中'));
  assert.ok(count(style, 'status-修改中') > 10);

  // 單獨屬於修改中的規則，顏色一個都不能沿用過稿中的天藍色，才分得出兩個狀態。
  const rulesFor = status => [...style.matchAll(/([^{}]*)\{([^{}]*)\}/g)]
    .filter(([, selector]) => { const parts = selector.slice(selector.lastIndexOf('*/') + 1).split(','); return parts.every(part => part.includes(status)); })
    .flatMap(([, , declaration]) => declaration.toLowerCase().match(/#[0-9a-f]{6}\b|#[0-9a-f]{3}\b/g) || []);
  // 白、灰、黑這類沒有色相的中性色（例如白底、淺灰邊框）兩個狀態共用是正常的，只比對真正帶有色彩的顏色。
  const isNeutral = colour => {
    const hex = colour.slice(1).length === 3 ? colour.slice(1).split('').map(c => c + c).join('') : colour.slice(1);
    const [r, g, b] = [0, 2, 4].map(i => parseInt(hex.slice(i, i + 2), 16));
    return Math.max(r, g, b) - Math.min(r, g, b) <= 12;
  };
  const reviewColours = new Set(rulesFor('過稿中').filter(colour => !isNeutral(colour)));
  const revisingColours = rulesFor('修改中').filter(colour => !isNeutral(colour));
  assert.ok(reviewColours.size > 10 && revisingColours.length > 10);
  assert.deepEqual(revisingColours.filter(colour => reviewColours.has(colour)), []);

  // 狀態清單、排序、時間軸配色判斷、批次修改下拉、資料庫後台篩選都要認得修改中。
  assert.match(html, /const statusOptions = \['未開始','執行中','過稿中','修改中','已完成','已取消','暫停中'\];/);
  assert.match(html, /const statusOrder = \{'未開始':0,'執行中':1,'過稿中':2,'修改中':3,'已完成':4,'已取消':5,'暫停中':6\};/);
  assert.match(html, /function statusClass\(s\)\{return \['未開始','執行中','過稿中','修改中','已完成','已取消','暫停中'\]\.includes\(s\)\?s:'未開始'\}/);
  assert.match(html, /<option>過稿中<\/option><option>修改中<\/option><option>已完成<\/option>/);
  assert.match(admin, /const ACCOUNT_STATUS_OPTIONS=\['未開始','執行中','過稿中','修改中','已完成','已取消','暫停中'\];/);

  // 上方矩形框：六格，修改中排在過稿中之後，點選走通用的 data-status 篩選。
  assert.match(html, /<b id="review">0<\/b><span>過稿中<\/span><\/div><div class="kpi status-修改中" data-status="修改中" role="button" tabindex="0"><b id="revising">0<\/b><span>修改中<\/span><\/div>/);
  assert.match(html, /\.kpis\{grid-template-columns:repeat\(6,minmax\(0,1fr\)\);gap:10px\}/);
  // 案件列表上方的矩形框另外有一條帶 !important 的欄數規則，實際生效的是它，不能還停在 5 欄。
  assert.match(html, /#casesSection \.case-kpis\{\s*\n\s*display:grid!important;\s*\n\s*grid-template-columns:repeat\(6,minmax\(0,1fr\)\)!important;/);
  assert.match(html, /@media\(max-width:640px\)\{\s*\n\s*#casesSection \.case-kpis\{grid-template-columns:repeat\(3,minmax\(0,1fr\)\)!important\}/);
  assert.doesNotMatch(html, /case-kpis\{[^}]*repeat\(5,/);
  assert.match(html, /document\.querySelectorAll\('\.kpi\[data-status\]'\)\.forEach\(card=>\{\s*\n\s*card\.addEventListener\('click',\(\)=>applyStatusFilter\(card\.dataset\.status\)\);/);

  // Run the real renderStats against a fake list.
  const renderStats = html.match(/function renderStats\(\)\{[^\n]*\}/)?.[0];
  assert.ok(renderStats, 'could not locate renderStats');
  const cells = {};
  new Function('cells', `
    const dataReady = true;
    const filtered = () => [
      { status: '未開始' }, { status: '過稿中' }, { status: '修改中' }, { status: '修改中' }, { status: '已完成' }, { status: '已取消' }
    ];
    const $ = selector => (cells[selector] ||= { textContent: '' });
    ${renderStats}
    renderStats();
  `)(cells);
  assert.equal(cells['#revising'].textContent, 2);
  assert.equal(cells['#review'].textContent, 1);
  assert.equal(cells['#total'].textContent, 5, '總案件照舊不含已取消');
});

test('a new modification request automatically moves the case to 修改中, and the page updates the status straight away', async t => {
  const app = await fixture();
  t.after(() => app.close());
  const login = await api(app.baseUrl, 'adminLogin', { password: 'secret' });
  const created = await api(app.baseUrl, 'create', {
    row: { client: '測試客戶', project: '修改中測試', owner: 'PM', designer: 'Machi', type: '平面', stage: '後製', qty: 1 },
    editorToken: login.token
  });
  const caseId = created.row.id;
  const statusOf = () => app.database.table('database').rows.find(row => String(row['案件編號']) === String(caseId))?.['狀態'];
  const before = statusOf();

  // 初稿不是修改需求，狀態不動。
  const draftRecord = await api(app.baseUrl, 'addModificationRecord', {
    record: { caseId, modifyDate: '2026/09/15', content: '初稿完成', modifier: 'Machi', draft: true }, editorToken: login.token
  });
  assert.equal(draftRecord.count, 0);
  assert.equal(statusOf(), before);

  // 一修進來就改成修改中，並回傳前台同步用的欄位。
  const first = await api(app.baseUrl, 'addModificationRecord', {
    record: { caseId, modifyDate: '2026/09/15', content: '一修內容', modifier: 'Machi' }, editorToken: login.token
  });
  assert.equal(first.status, '修改中');
  assert.equal(first.statusChanged, true);
  assert.equal(statusOf(), '修改中');

  const second = await api(app.baseUrl, 'addModificationRecord', {
    record: { caseId, modifyDate: '2026/09/15', content: '二修內容', modifier: 'Machi' }, editorToken: login.token
  });
  assert.equal(second.statusChanged, false, '已經是修改中就不重複改');

  // 前台：兩個新增修改需求的入口寫入成功後都要同步狀態。
  const html = await readFile(new URL('../../index.html', import.meta.url), 'utf8');
  const submit = html.match(/async function submitModificationRecord\(event\)\{[^\n]*/)?.[0];
  assert.ok(submit, 'could not locate submitModificationRecord');
  assert.match(submit, /modifier:finalModifier\}:item\)\); applyModificationStatusChange\(id,data\);/);
  const fromReply = html.match(/async function recordModificationFromReply\([\s\S]*?\n\}/)?.[0];
  assert.ok(fromReply, 'could not locate recordModificationFromReply');
  assert.match(fromReply, /applyModificationStatusChange\(id,data\);\s*\n\s*render\(\);/);
  // 初稿入口不需要同步狀態。
  const draftCall = html.match(/await sheetApi\('addModificationRecord',\{record,draft:true[^\n]*\n[^\n]*/)?.[0];
  assert.ok(draftCall && !draftCall.includes('applyModificationStatusChange'));

  // Run the real applyModificationStatusChange against a fake case list.
  const helper = html.match(/function applyModificationStatusChange\(id,data\)\{[^\n]*/)?.[0];
  assert.ok(helper, 'could not locate applyModificationStatusChange');
  const run = (list, data) => new Function('list', 'data', `
    let rows = list;
    const written = [];
    let saved = 0;
    const normalizeRow = row => ({ ...row });
    const rememberLocalWrite = (id, changes) => written.push([id, changes]);
    const save = () => { saved += 1; };
    ${helper}
    const changed = applyModificationStatusChange('26090101', data);
    return { changed, rows, written, saved };
  `)(list, data);
  const list = [{ id: '26090101', status: '過稿中' }, { id: '26090102', status: '過稿中' }];
  const applied = run(list, { statusChanged: true, status: '修改中' });
  assert.equal(applied.changed, true);
  assert.deepEqual(applied.rows.map(row => row.status), ['修改中', '過稿中'], '只改這一筆案件');
  assert.deepEqual(applied.written, [['26090101', { status: '修改中' }]]);
  assert.equal(applied.saved, 1);
  const untouched = run(list, { statusChanged: false, status: '修改中' });
  assert.equal(untouched.changed, false);
  assert.deepEqual(untouched.rows.map(row => row.status), ['過稿中', '過稿中']);
  assert.equal(untouched.written.length, 0);
});

test('page load downloads the database once, UI preference saves are batched and skipped when unchanged, and the history workflow no longer commits on every revision bump', async () => {
  const html = await readFile(new URL('../../index.html', import.meta.url), 'utf8');

  // 1) 同時要資料庫的呼叫端共用同一次下載。
  const fetchDb = html.match(/let githubJsonDatabaseInflight=null;[\s\S]*?async function fetchGithubJsonDatabase\(\{fresh=false\}=\{\}\)\{[\s\S]*?\n\}/)?.[0];
  const downloadDb = html.match(/async function downloadGithubJsonDatabase\(\)\{[\s\S]*?\n\}/)?.[0];
  assert.ok(fetchDb && downloadDb, 'could not locate the database loader');
  const loader = new Function(`
    let calls = 0;
    const githubJsonDatabaseUrl = 'backend/data/db.json';
    const appBuildVersion = 'test';
    let githubJsonDatabaseCache = null;
    let githubJsonDatabaseLoadedAt = 0;
    const syncWeightRulesFromDatabase = () => {};
    const syncDesignListsFromDatabase = () => {};
    const syncCustomerDirectoryFromDatabase = () => {};
    const fetch = async () => { calls += 1; await new Promise(resolve => setTimeout(resolve, 5)); return { ok: true, json: async () => ({ revision: calls, tables: { database: { rows: [] } } }) }; };
    ${fetchDb}
    ${downloadDb}
    return { fetchGithubJsonDatabase, calls: () => calls };
  `)();
  const [menu, profiles, cases] = await Promise.all([
    loader.fetchGithubJsonDatabase({}),
    loader.fetchGithubJsonDatabase({ fresh: true }),
    loader.fetchGithubJsonDatabase({ fresh: true })
  ]);
  assert.equal(loader.calls(), 1, '開頁時三個呼叫端只下載一次');
  assert.equal(menu, profiles);
  assert.equal(profiles, cases);
  await loader.fetchGithubJsonDatabase({ fresh: true });
  assert.equal(loader.calls(), 1, '剛下載完（3 秒內）要求強制更新，直接沿用，不再重抓 1.4MB');
  const realNow = Date.now;
  try {
    Date.now = () => realNow() + 4000;
    await loader.fetchGithubJsonDatabase({ fresh: true });
  } finally {
    Date.now = realNow;
  }
  assert.equal(loader.calls(), 2, '超過 3 秒再要求強制更新，照樣會重新下載');
  await loader.fetchGithubJsonDatabase({});
  assert.equal(loader.calls(), 2, '十秒內一般讀取沿用剛下載的資料');

  // 2) 畫面偏好：停止操作一段時間才送一次、內容沒變不送、頁面隱藏時補送。
  const saveFn = html.match(/function saveRemoteSettingsForAccount\(message='個人設定已儲存'\)\{[\s\S]*?\n\}/)?.[0];
  const flushFn = html.match(/function flushRemoteSettingsSave\(\)\{[^\n]*/)?.[0];
  assert.ok(saveFn && flushFn, 'could not locate the settings save helpers');
  assert.match(html, /const REMOTE_SETTINGS_IDLE_MS = 15000;/);
  assert.match(html, /document\.addEventListener\('visibilitychange',\(\)=>\{if\(document\.visibilityState==='hidden'\)flushRemoteSettingsSave\(\)\}\);/);
  assert.match(html, /window\.addEventListener\('pagehide',flushRemoteSettingsSave\);/);
  const settings = new Function(`
    const timers = [];
    const sent = [];
    let payload = { theme: 'dark', filters: { designer: ['Anna'] } };
    const isLoggedIn = () => true, isLocalPreviewToken = () => false;
    const currentEditorToken = 'token', apiUrl = 'https://worker.test', currentEditorAccount = 'anna@emctaipei.com', currentEditor = 'Anna';
    const remoteSettingsPayload = () => JSON.parse(JSON.stringify(payload));
    const sheetApi = async (action, body) => { sent.push(body.settings); return { action }; };
    const setSync = () => {};
    const setTimeout = (fn, ms) => { timers.push({ fn, ms, cleared: false }); return timers.length - 1; };
    const clearTimeout = id => { if (timers[id]) timers[id].cleared = true; };
    let remoteSettingsSaveTimer = null, remoteSettingsSaveSequence = 0, remoteSettingsSaveQueue = Promise.resolve();
    const REMOTE_SETTINGS_IDLE_MS = 15000;
    const remoteSettingsLastSynced = new Map();
    let remoteSettingsPendingRun = null;
    ${saveFn}
    ${flushFn}
    return {
      save: () => saveRemoteSettingsForAccount(),
      flush: () => flushRemoteSettingsSave(),
      fireLatestTimer: () => { const live = timers.filter(timer => !timer.cleared); live.at(-1)?.fn(); },
      setPayload: next => { payload = next; },
      settle: () => remoteSettingsSaveQueue,
      timers, sent
    };
  `)();
  // 連點四位設計師：每次都會重新排程，只有最後一次的計時器還活著，而且等 15 秒。
  for (const designer of ['Anna', 'Leona', 'Amber', 'Machi']) { settings.setPayload({ theme: 'dark', filters: { designer: [designer] } }); settings.save(); }
  assert.equal(settings.timers.filter(timer => !timer.cleared).length, 1);
  assert.equal(settings.timers.at(-1).ms, 15000);
  settings.fireLatestTimer();
  await settings.settle();
  assert.equal(settings.sent.length, 1, '四次點擊只送出一次');
  assert.deepEqual(settings.sent[0].filters.designer, ['Machi']);
  // 內容跟上次成功送出的一樣：不送。
  settings.save(); settings.fireLatestTimer(); await settings.settle();
  assert.equal(settings.sent.length, 1);
  // 真的改了、還沒等到 15 秒就切走頁面：立刻補送。
  settings.setPayload({ theme: 'light', filters: { designer: ['Machi'] } });
  settings.save(); settings.flush(); await settings.settle();
  assert.equal(settings.sent.length, 2);
  assert.equal(settings.sent[1].theme, 'light');

  // 3) 歷史資料庫只在案件資料真的變了才重寫，不再因為主資料庫版本號加一就重寫。
  const archiveGenerator = await readFile(new URL('../../scripts/generate_database_archive_snapshot.mjs', import.meta.url), 'utf8');
  assert.match(archiveGenerator, /const sourceChanged = previousSnapshot\?\.sources\?\.primaryDatabase\?\.rowsSha256 !== sourceRowsSha256;/);
  assert.doesNotMatch(archiveGenerator, /primaryDatabase\?\.revision !== database\.revision/);

  // Run the real short link index generator in a scratch copy of the repo layout.
  const { mkdtemp, mkdir, writeFile, copyFile, rm } = await import('node:fs/promises');
  const { tmpdir } = await import('node:os');
  const { execFile } = await import('node:child_process');
  const run = (script) => new Promise((resolve, reject) => execFile(process.execPath, [script], (error, stdout, stderr) => error ? reject(new Error(stderr || error.message)) : resolve(stdout)));
  const workdir = await mkdtemp(path.join(tmpdir(), 'short-link-index-'));
  try {
    await mkdir(path.join(workdir, 'scripts'), { recursive: true });
    await mkdir(path.join(workdir, 'backend', 'data'), { recursive: true });
    await mkdir(path.join(workdir, 'data'), { recursive: true });
    const script = path.join(workdir, 'scripts', 'generate_short_link_index.mjs');
    await copyFile(new URL('../../scripts/generate_short_link_index.mjs', import.meta.url), script);
    const writeDb = (revision, url) => writeFile(path.join(workdir, 'backend', 'data', 'db.json'), JSON.stringify({
      revision, updatedAt: `2026-09-15T00:00:0${revision}.000Z`,
      tables: { '短連結': { rows: [{ '短碼': 'abc123', '原始網址': url }] }, '補充資料連結': { rows: [] } }
    }));
    const indexPath = path.join(workdir, 'data', 'short_link_index.json');
    await writeDb(1, 'https://example.com/a');
    await run(script);
    const firstIndex = await readFile(indexPath, 'utf8');
    await writeDb(2, 'https://example.com/a');
    await run(script);
    assert.equal(await readFile(indexPath, 'utf8'), firstIndex, '只有主資料庫版本號改變時，短網址索引要保持原檔不動');
    await writeDb(3, 'https://example.com/b');
    await run(script);
    const updated = JSON.parse(await readFile(indexPath, 'utf8'));
    assert.equal(updated.shortLinks.abc123, 'https://example.com/b', '短網址真的改變時照常更新');
    assert.equal(updated.databaseRevision, 3);
  } finally {
    await rm(workdir, { recursive: true, force: true });
  }
});

test('designer workload helper still counts 未開始 + 執行中 + 修改中 cases after the avatar light is retired', async () => {
  const html = await readFile(new URL('../../index.html', import.meta.url), 'utf8');
  const block = html.match(/const DESIGNER_ACTIVE_STATUSES=[\s\S]*?function computedDesignerStatus\([^\n]*/)?.[0];
  assert.ok(block, 'could not locate the designer busy helpers');
  const make = rows => new Function('rows', `${block}\nreturn { designerActiveCount, computedDesignerStatus };`)(rows);
  const caseRows = (designer, statuses) => statuses.map(status => ({ designer, status }));

  const rows = [
    ...caseRows('Anna', ['未開始', '執行中', '修改中', '修改中']),
    ...caseRows('Anna', ['過稿中', '已完成', '已取消', '暫停中']),
    ...caseRows('Leona', ['未開始', '執行中', '執行中', '修改中', '修改中']),
    ...caseRows('Noise', ['未開始', '未開始', '執行中', '執行中', '修改中', '修改中']),
    ...caseRows('Amber', ['修改中'])
  ];
  const { designerActiveCount, computedDesignerStatus } = make(rows);
  assert.equal(designerActiveCount('Anna'), 4, '修改中要算進去，過稿中、已完成、已取消、暫停中不算');
  assert.equal(computedDesignerStatus('Anna'), '普通', '四筆不算忙碌');
  assert.equal(designerActiveCount('Leona'), 5);
  assert.equal(computedDesignerStatus('Leona'), '普通', '五筆還不算忙碌');
  assert.equal(designerActiveCount('Noise'), 6);
  assert.equal(computedDesignerStatus('Noise'), '忙碌', '合計六筆才顯示忙碌');
  assert.equal(designerActiveCount('Amber'), 1);
  assert.equal(computedDesignerStatus('Karl'), '普通');
  assert.doesNotMatch(html, /title="\$\{esc\(status\)\}：目前未開始＋執行中＋修改中共 \$\{count\} 筆"/,
    '頭像忙碌燈已隨頭像卡下架');
});

test('reply method chooser offers 直接讀信, which opens the thread read-only with the first message expanded', async () => {
  const html = await readFile(new URL('../../index.html', import.meta.url), 'utf8');
  const chooser = html.match(/async function openReplyMethodChooser\(event,id\)\{[\s\S]*?\n\}/)?.[0];
  assert.ok(chooser, 'could not locate openReplyMethodChooser');
  // 已連接與未連接 Gmail 兩種選單最下方都有「直接讀信」，點了用唯讀模式開信件串。
  assert.equal((chooser.match(/data-reply-method="read"><span>直接讀信<\/span><small>只閱讀這條信件串，預設展開首封信<\/small><\/button><\/div>/g) || []).length, 2);
  assert.match(chooser, /data-reply-method="general"><span>一般回信<\/span>[\s\S]*?<\/button><button type="button" class="option" data-reply-method="read">/);
  assert.equal((chooser.match(/\[data-reply-method="read"\]'\)\?\.addEventListener\('click',clickEvent=>\{clickEvent\.stopPropagation\(\); closeFieldPopover\(\); openGmailThreadModal\(id,\{readOnly:true\}\)\}\);/g) || []).length, 2);

  const opener = html.match(/async function openGmailThreadModal\(id,\{lockUntilCaller=false,readOnly=false\}=\{\}\)\{[\s\S]*?\n\}/)?.[0];
  assert.ok(opener, 'could not locate openGmailThreadModal');

  // 用假的 DOM 實際跑一次唯讀模式與一般回信模式。
  const run = async readOnly => {
    const el = (extra = {}) => ({ hidden: false, disabled: false, textContent: '', innerHTML: '', dataset: {}, ...extra });
    const details = [{ open: false }, { open: false }, { open: false }];
    const list = el({ scrollTop: 120, querySelector: selector => selector === '.gmail-thread-msg' ? details[0] : null });
    const nodes = {
      '#gmailThreadModal': el(), '#gmailThreadModalList': list, '#gmailThreadReplyEditor': el({ id: 'gmailThreadReplyEditor' }),
      '#gmailThreadModalTitle': el(), '#gmailThreadModalFrom': el(), '#gmailThreadFromValue': el(),
      '#gmailThreadComposeSection': el(), '#gmailThreadReplySend': el(), '#gmailThreadReplyCancel': el(), '#gmailThreadSchedule': el(),
      '#gmailThreadScheduledList': el()
    };
    const calls = { signature: 0, scheduled: 0, recipients: 0, unlock: 0 };
    const fn = new Function('ctx', `
      const { nodes, calls, details } = ctx;
      const $ = selector => nodes[selector];
      const rows = [{ id: '26090001', gmailThreadId: 'thread-1' }];
      const setSync = () => {}, closeFieldPopover = () => {}, clearScheduledMailEditState = () => {}, resetGmailModalInlineStatus = () => {};
      const gmailRecipientExpandedFields = new Set();
      const gmailConnectionState = { gmailAddress: 'pm@emctaipei.com' }, currentEditorAccount = 'pm@emctaipei.com', currentEditorToken = 't';
      const defaultReplyTemplateContent = () => '', setGmailEditorPlainText = (editor, text) => { editor.innerHTML = text; };
      const setGmailEditorTemplateContent = (editor, greeting, template) => { editor.innerHTML = String(greeting || '') + String(template || ''); };
      const clearGmailInlineImages = () => {}, clearGmailAttachments = () => {};
      const setGmailRecipientEntries = () => { calls.recipients += 1; }, splitMailAddresses = value => [value];
      const updateGmailScheduleStatusBadge = () => {}, gmailRecipientGreetingName = () => 'Anna';
      const setGmailEditorLoading = (editor, loading) => { if (!loading) calls.unlock += 1; };
      const allKnownGmailSignatureHtmlList = async () => [];
      const sheetApi = async () => ({ messages: [{ date: '1' }, { date: '2' }, { date: '3' }], suggestedTo: 'anna@emctaipei.com' });
      let gmailThreadMessagesCache = [];
      const renderGmailThreadMessages = () => {};
      const refreshScheduledMailList = () => { calls.scheduled += 1; };
      const appendDefaultGmailSignature = async () => { calls.signature += 1; };
      ${opener}
      return openGmailThreadModal('26090001', { readOnly: ${readOnly} });
    `);
    await fn({ nodes, calls, details });
    return { nodes, calls, details, list };
  };

  const read = await run(true);
  assert.equal(read.nodes['#gmailThreadModal'].dataset.replyMode, 'read');
  assert.equal(read.nodes['#gmailThreadModal'].hidden, false);
  assert.equal(read.nodes['#gmailThreadComposeSection'].hidden, true, '唯讀模式不顯示回覆編輯區');
  assert.equal(read.nodes['#gmailThreadReplySend'].hidden, true);
  assert.equal(read.nodes['#gmailThreadSchedule'].hidden, true);
  assert.equal(read.nodes['#gmailThreadReplyCancel'].textContent, '關閉');
  assert.deepEqual(read.details.map(item => item.open), [true, false, false], '預設只展開首封信');
  assert.equal(read.list.scrollTop, 0);
  assert.equal(read.calls.signature, 0, '唯讀模式不插入簽名檔');
  assert.equal(read.calls.scheduled, 0);
  assert.equal(read.calls.unlock, 1, '唯讀模式跑完仍會解除載入鎖定');

  const reply = await run(false);
  assert.equal(reply.nodes['#gmailThreadModal'].dataset.replyMode, 'general');
  assert.equal(reply.nodes['#gmailThreadComposeSection'].hidden, false, '一般回信照舊顯示回覆區');
  assert.equal(reply.nodes['#gmailThreadReplySend'].hidden, false);
  assert.deepEqual(reply.details.map(item => item.open), [false, false, false], '一般回信維持全部收合');
  assert.equal(reply.calls.signature, 1);
  assert.equal(reply.calls.scheduled, 1);
});

test('mobile case detail actions distribute every visible button at equal width', async () => {
  const html = await readFile(new URL('../../index.html', import.meta.url), 'utf8');
  assert.match(
    html,
    /#caseDetailModal \.case-detail-actions \.row-actions\{display:contents!important\}/,
    '手機版需展開編輯／刪除包裝層，讓四顆按鈕各自成為等寬 flex item'
  );
  assert.match(
    html,
    /#caseDetailModal \.case-detail-actions \.row-actions button\{width:auto!important\}/,
    '內層按鈕不可保留 100% 寬度來干擾等分'
  );
  // 只看字串出現過還不夠：後面若又有規則把包裝層設回 flex 或按鈕設回 100%，會蓋掉前面的設定
  // （實際發生過：390px 寬時四顆按鈕量出來是 114／45／45／114px）。依出現順序取最後一條才是實際生效的。
  // 只比對真的有設定 display／width 的規則（例如單純調整 gap 的規則不影響等分）。
  const wrapperDisplayRules = [...html.matchAll(/#caseDetailModal \.case-detail-actions \.row-actions\{([^}]*)\}/g)].map(match => match[1]).filter(body => /(^|;)\s*display\s*:/.test(body));
  assert.ok(wrapperDisplayRules.length, 'could not locate the case detail row-actions display rules');
  assert.equal(wrapperDisplayRules.at(-1), 'display:contents!important', '最後生效的包裝層 display 必須是 contents');
  const buttonWidthRules = [...html.matchAll(/#caseDetailModal \.case-detail-actions \.row-actions button\{([^}]*)\}/g)].map(match => match[1]).filter(body => /(^|;)\s*width\s*:/.test(body));
  assert.equal(buttonWidthRules.at(-1), 'width:auto!important', '最後生效的內層按鈕寬度必須是 auto');
  assert.doesNotMatch(html, /#caseDetailModal \.case-detail-actions \.row-actions\{display:flex/);
});

test('designer reply backs up photos added with the editor upload button into the reply round of 修改紀錄 on send and on schedule', async () => {
  const html = await readFile(new URL('../../index.html', import.meta.url), 'utf8');
  const backupFn = html.match(/async function backupDesignerReplyInlineImages\(id,round,inlineImages\)\{[\s\S]*?\n\}/)?.[0];
  assert.ok(backupFn, 'could not locate backupDesignerReplyInlineImages');

  const make = (sheetApi) => {
    const calls = { refresh: 0 };
    const fn = new Function('ctx', `
      const { sheetApi, calls } = ctx;
      const currentEditorToken = 'token';
      const fetchModificationCounts = async () => { calls.refresh += 1; };
      const render = () => {}, refreshOpenRevisionModal = () => {}, refreshOpenCaseDetail = () => {};
      const modificationLabel = round => (round === 0 ? '初稿' : ['','一修','二修','三修'][round] || round + '修');
      ${backupFn}
      return backupDesignerReplyInlineImages;
    `)({ sheetApi, calls });
    return { fn, calls };
  };

  const requests = [];
  const ok = make(async (action, payload) => { requests.push({ action, payload }); return { ok: true, count: 2 }; });
  const notice = await ok.fn('26090107', '1', [
    { contentId: 'a', fileName: 'fix-1.jpg', mimeType: 'image/jpeg', base64: 'AAAA' },
    { contentId: 'b', fileName: 'fix-2.png', mimeType: 'image/png', base64: 'BBBB' },
    { contentId: 'c', fileName: 'broken', mimeType: 'image/png', base64: '' }
  ]);
  assert.equal(requests.length, 1);
  assert.equal(requests[0].action, 'backupReplyInlineImages');
  assert.deepEqual(requests[0].payload.images, [
    { fileName: 'fix-1.jpg', mimeType: 'image/jpeg', base64: 'AAAA' },
    { fileName: 'fix-2.png', mimeType: 'image/png', base64: 'BBBB' }
  ], '只送圖片本身需要的欄位，空內容略過');
  assert.equal(requests[0].payload.caseId, '26090107');
  assert.equal(requests[0].payload.round, 1);
  assert.equal(ok.calls.refresh, 1, '備份後重新讀取修改紀錄');
  assert.equal(notice, '；信件中的 2 張照片已備份至一修修改紀錄');

  assert.equal(await ok.fn('26090107', '1', []), '', '沒有用上傳照片就不呼叫');
  assert.equal(await ok.fn('26090107', '', [{ fileName: 'x.jpg', mimeType: 'image/jpeg', base64: 'AAAA' }]), '', '不知道輪次時不猜');
  assert.equal(requests.length, 1);

  const failing = make(async () => { throw new Error('服務金鑰不正確'); });
  assert.equal(await failing.fn('26090107', 0, [{ fileName: 'x.jpg', mimeType: 'image/jpeg', base64: 'AAAA' }]), '；但信件照片備份至修改紀錄失敗：服務金鑰不正確', '備份失敗只提醒，不丟出錯誤影響已寄出的信');

  // 寄出與排程兩條路徑的「設計師回覆信」分支都要呼叫，並把結果接在成功訊息後面。
  const send = html.match(/async function sendGmailThreadReply\(\)\{[\s\S]*?\n\}/)?.[0];
  assert.match(send, /const designerReplyRound=replyMode==='designer'\?modal\?\.dataset\.designerReplyRound:'';\n    const replyData=await sheetApi\('replyCaseMail'/, '寄出前先記下輪次，寄出後彈窗會清空');
  assert.match(send, /if\(replyMode==='designer'&&row\)\{await confirmLatestModificationRound\(id,row\); await applyReplyStatusUpdate\(id,row\); inlineImageBackupNotice=await backupDesignerReplyInlineImages\(id,designerReplyRound,editorPayload\.inlineImages\)\}/);
  assert.match(send, /\$\{inlineImageBackupNotice\}\$\{threadNotice\}\$\{detailsNotice\}/, '立即送出的成功訊息要接上信件串警告（threadWarningNotice）');
  const schedule = html.match(/async function scheduleThreadReply\(scheduledAt\)\{[\s\S]*?\n\}/)?.[0];
  assert.match(schedule, /inlineImageBackupNotice=await backupDesignerReplyInlineImages\(id,modal\?\.dataset\.designerReplyRound,editorPayload\.inlineImages\)/);
  assert.match(schedule, /\$\{inlineImageBackupNotice\}\$\{detailsNotice\}/);
  // 一般回信、修改需求信不備份。
  assert.equal((send.match(/backupDesignerReplyInlineImages/g) || []).length, 1);
});

test('case delete and 修改紀錄 trash buttons ask through the in-page warning dialog before deleting', async () => {
  const html = await readFile(new URL('../../index.html', import.meta.url), 'utf8');

  // 視窗標記與樣式存在，疊在其他彈窗之上。
  assert.match(html, /<div class="app-confirm-backdrop" id="appConfirmDialog" hidden>/);
  assert.match(html, /<button type="button" class="app-confirm-cancel" id="appConfirmCancel">取消<\/button><button type="button" class="app-confirm-ok" id="appConfirmOk">確定刪除<\/button>/);
  // z-index 由另一支測試（警示視窗必須疊在所有彈窗之上）負責鎖定實際數值，這裡只確認樣式存在。
  assert.match(html, /\.app-confirm-backdrop\{position:fixed;inset:0;z-index:\d+!important;/);
  // 深色主題的全站 button 規則權重較高，刪除鍵必須用同等權重維持紅色（實際發生過被蓋成綠色）。
  assert.match(html, /html\[data-theme="dark"\] \.app-confirm-ok\{background:#dc2626!important;color:#fff!important;border-color:#dc2626!important\}/);

  // 四個刪除入口都要先等站內警示視窗，且不再使用瀏覽器內建 confirm()。
  const pick = pattern => html.match(pattern)?.[0];
  const deleteRowFn = pick(/async function deleteRow\(id\)\{[^\n]*/);
  const deleteRecordFn = pick(/async function deleteModificationRecord\(event,id,count\)\{[\s\S]*?\n\}/);
  const removeImageFn = pick(/async function removeCaseDesignImage\(event,id,count,url\)\{[^\n]*/);
  const removeSelectedFn = pick(/async function removeSelectedCaseDesignImages\(event\)\{[^\n]*/);
  for (const [name, fn] of Object.entries({ deleteRowFn, deleteRecordFn, removeImageFn, removeSelectedFn })) {
    assert.ok(fn, `could not locate ${name}`);
    assert.match(fn, /if\(!\(await showAppConfirm\(\{/, `${name} 刪除前要先跳出站內警示視窗`);
    assert.doesNotMatch(fn, /(^|[^.\w])confirm\(/, `${name} 不可再使用瀏覽器內建 confirm()`);
  }
  // await 之後 event.currentTarget 會變成 null，按鈕必須在等待前先取得。
  assert.ok(removeImageFn.indexOf('const button=event.currentTarget;') < removeImageFn.indexOf('await showAppConfirm('));

  // 實際執行警示視窗：確定 → true、取消 → false，關閉後視窗隱藏、焦點還原；同時開兩個時舊的視為取消。
  const showFn = pick(/let appConfirmResolve=null;\nfunction showAppConfirm\([\s\S]*?\n\}\nfunction settleAppConfirm\(value\)\{[^\n]*/);
  assert.ok(showFn, 'could not locate showAppConfirm');
  const makeEl = () => ({ hidden: true, textContent: '', focused: 0, focus() { this.focused += 1; }, classList: { toggle() {} } });
  const nodes = { '#appConfirmDialog': makeEl(), '#appConfirmTitle': makeEl(), '#appConfirmMessage': makeEl(), '#appConfirmOk': makeEl(), '#appConfirmCancel': makeEl() };
  const opener = makeEl();
  const api = new Function('nodes', 'opener', `
    const $ = selector => nodes[selector];
    const document = { activeElement: opener };
    const window = { confirm: () => { throw new Error('native confirm must not be used'); } };
    ${showFn}
    return { showAppConfirm, settleAppConfirm };
  `)(nodes, opener);

  const first = api.showAppConfirm({ title: '刪除案件 26090107', message: '確定刪除案件 26090107？\n\n此動作無法復原。' });
  assert.equal(nodes['#appConfirmDialog'].hidden, false, '視窗要顯示出來');
  assert.equal(nodes['#appConfirmTitle'].textContent, '刪除案件 26090107');
  assert.equal(nodes['#appConfirmOk'].textContent, '確定刪除');
  assert.equal(nodes['#appConfirmCancel'].focused, 1, '預設焦點在取消，誤按 Enter 不會刪除');
  api.settleAppConfirm(true);
  assert.equal(await first, true);
  assert.equal(nodes['#appConfirmDialog'].hidden, true);
  assert.equal(opener.focused, 1, '關閉後焦點回到原本的按鈕');

  const cancelled = api.showAppConfirm({ title: '移除設計圖', confirmText: '確定移除' });
  assert.equal(nodes['#appConfirmOk'].textContent, '確定移除');
  api.settleAppConfirm(false);
  assert.equal(await cancelled, false);

  const stale = api.showAppConfirm({ title: 'A' });
  const fresh = api.showAppConfirm({ title: 'B' });
  assert.equal(await stale, false, '開新視窗時舊的視為取消，不會被誤判成確定');
  api.settleAppConfirm(true);
  assert.equal(await fresh, true);
});

test('the NAS folder picker opens on the designer own machine first and falls back to the manager Mac when it does not answer', async () => {
  const html = await readFile(new URL('../../index.html', import.meta.url), 'utf8');
  const block = html.match(/const NAS_PICKER_MANAGER_HOST=[\s\S]*?\nfunction openNasFolderPickerPopupWindow\(url\)\{[\s\S]*?\n\}/)?.[0];
  assert.ok(block, 'could not locate the picker host helpers');

  const build = (storedHost = null, storedAt = Date.now()) => {
    const state = { opened: [], sync: [], timers: [], store: storedHost ? { machiNasFolderPickerHost: JSON.stringify({ host: storedHost, at: storedAt }) } : {} };
    const api = new Function('state', `
      const screen = { width: 1600, height: 1000 };
      const localStorage = {
        getItem: key => (key in state.store ? state.store[key] : null),
        setItem: (key, value) => { state.store[key] = value; }
      };
      const setSync = (message, isError) => { state.sync.push({ message, isError }); };
      const setTimeout = (fn, ms) => { state.timers.push({ fn, ms, cleared: false }); return state.timers.length; };
      const clearTimeout = id => { if (state.timers[id - 1]) state.timers[id - 1].cleared = true; };
      const window = { open: (url, name) => { state.opened.push({ url, name }); return state.win; } };
      ${block}
      return { openNasFolderPickerPopupWindow, markNasFolderPickerReady, nasFolderPickerHostOrder, nasFolderPickerUrlForHost, hosts: nasFolderPickerHosts };
    `)(state);
    state.win = { closed: false };
    return { state, api };
  };
  const fireLatest = state => { const live = state.timers.filter(timer => !timer.cleared); live.at(-1)?.fn(); };

  // 只換位址，案件編號與 token 等查詢字串照原樣帶過去。
  const { api: urlApi } = build();
  const swapped = urlApi.nasFolderPickerUrlForHost(new URL('http://localhost:8877/picker?caseId=26090107&token=abc'), 'http://iMac.local:8877');
  assert.equal(swapped.toString(), 'http://imac.local:8877/picker?caseId=26090107&token=abc');

  // ① 自己這台有跑選擇器：回報就緒後不會再換機，位址被記住。
  const first = build();
  const url = new URL('http://localhost:8877/picker?caseId=26090107&token=abc');
  first.api.openNasFolderPickerPopupWindow(url);
  assert.equal(first.state.opened.length, 1);
  assert.match(first.state.opened[0].url, /^http:\/\/localhost:8877\/picker\?/, '先開自己這台');
  assert.equal(first.state.opened[0].name, 'machiNasFolderPicker');
  first.api.markNasFolderPickerReady('http://localhost:8877');
  fireLatest(first.state);
  assert.equal(first.state.opened.length, 1, '有回報就不再換機');
  assert.equal(JSON.parse(first.state.store.machiNasFolderPickerHost).host, 'http://localhost:8877');

  // ② 自己這台沒裝（沒有回報）：逾時後自動改開管理者那台，沿用同一個視窗名稱＝同一個彈出視窗。
  const second = build();
  second.api.openNasFolderPickerPopupWindow(url);
  fireLatest(second.state);
  assert.equal(second.state.opened.length, 2);
  assert.match(second.state.opened[1].url, /^http:\/\/imac\.local:8877\/picker\?/, '改開管理者那台');
  assert.equal(second.state.opened[1].name, 'machiNasFolderPicker', '同一個視窗名稱才不會多開一個視窗');
  assert.deepEqual(second.state.sync, [], '還在嘗試時不要先報錯');
  // ③ 兩台都沒回應：提示改用電腦檔案上傳。
  fireLatest(second.state);
  assert.equal(second.state.opened.length, 2);
  assert.equal(second.state.sync.length, 1);
  assert.match(second.state.sync[0].message, /連不到 NAS 資料夾選擇器/);
  assert.equal(second.state.sync[0].isError, true);

  // ④ 記住的位址優先；超過一天就重新從自己這台探測（後來才安裝的人會自動改用自己的電腦）。
  const remembered = build('http://iMac.local:8877');
  assert.deepEqual(remembered.api.nasFolderPickerHostOrder(), ['http://iMac.local:8877', 'http://localhost:8877']);
  remembered.api.openNasFolderPickerPopupWindow(url);
  assert.match(remembered.state.opened[0].url, /^http:\/\/imac\.local:8877\//);
  const expired = build('http://iMac.local:8877', Date.now() - 25 * 60 * 60 * 1000);
  assert.deepEqual(expired.api.nasFolderPickerHostOrder(), ['http://localhost:8877', 'http://iMac.local:8877']);

  // 前台收到就緒訊息時要呼叫 markNasFolderPickerReady。
  assert.match(html, /if\(data\.type==='machi-nas-folder-picker-ready'\)\{markNasFolderPickerReady\(data\.host\|\|event\.origin\);return\}/);
  // 選擇器頁面一開啟就要回報。
  const picker = await readFile(new URL('../../scripts/nas_folder_picker_server.mjs', import.meta.url), 'utf8');
  assert.match(picker, /type: 'machi-nas-folder-picker-ready', caseId, nonce, host: location\.origin/);
});

test('first paint no longer preloads retired designer avatars, while reversible poster assets stay compressed', async () => {
  const { readdir, stat } = await import('node:fs/promises');
  const html = await readFile(new URL('../../index.html', import.meta.url), 'utf8');
  const preloaded = [...html.matchAll(/<link rel="preload" as="image" href="(assets\/designers\/[^"]+)"/g)].map(match => match[1]);
  // 2026-09-21：首頁已改成像素辦公室，舊頭像卡不再畫出，因此不該還在 head 預載這些圖。
  assert.deepEqual(preloaded, [], '已下架的設計師頭像不應再跟首頁搶頻寬');

  // 這些圖在首頁一開啟就會下載、跟 HTML 搶頻寬，畫面上只顯示 112px。
  // 2026-09-16 曾經每張 512px、合計 1089 KB，首次載入因此非常慢，壓成 256px 後合計 158 KB。
  let totalBytes = 0;
  for (const relPath of preloaded) {
    const { size } = await stat(new URL(`../../${relPath}`, import.meta.url));
    totalBytes += size;
    assert.ok(size <= 60 * 1024, `${relPath} 為 ${Math.round(size / 1024)} KB，超過 60 KB 上限`);
  }
  assert.ok(totalBytes <= 300 * 1024, `預載頭像合計 ${Math.round(totalBytes / 1024)} KB，超過 300 KB 上限`);

  // 設計師大圖（點開海報才載入，不在首次載入路徑上）也維持壓縮後的大小。
  const posterDir = new URL('../../images/', import.meta.url);
  for (const name of await readdir(posterDir)) {
    if (!/\.(jpe?g|png)$/i.test(name)) continue;
    const { size } = await stat(new URL(name, posterDir));
    assert.ok(size <= 600 * 1024, `images/${name} 為 ${Math.round(size / 1024)} KB，超過 600 KB 上限`);
  }
});

test('revision modal keeps image selection across background re-renders and can move selected images to another round', async () => {
  const html = await readFile(new URL('../../index.html', import.meta.url), 'utf8');

  // ① 背景同步每次載入資料都會重繪這個彈窗；舊寫法無條件清空選取，使用者勾好圖片後按「刪除已選取」完全沒反應。
  const render = html.match(/function renderRevisionModal\(id\)\{[\s\S]*?updateRevisionSelectionBar\(\);\}/)?.[0];
  assert.ok(render, 'could not locate renderRevisionModal');
  assert.match(render, /if\(String\(modal\.dataset\.caseId\|\|''\)!==String\(row\.id\)\)revisionImageSelection\.clear\(\);/, '只有換案件才清空選取');
  assert.doesNotMatch(render, /if\(add\)add\.hidden=!canCaseEditRow\(row\); revisionImageSelection\.clear\(\);/, '不可再無條件清空');
  assert.match(render, /\[\.\.\.revisionImageSelection\]\.forEach\(key=>\{if\(!availableKeys\.has\(key\)\)revisionImageSelection\.delete\(key\)\}\);/, '已經不存在的圖片要從選取裡剔除');
  assert.ok(render.trimEnd().endsWith('updateRevisionSelectionBar();}'), '重繪後要還原工具列狀態（按鈕不能停在停用）');
  // 重繪出來的勾選框要把已選取的打勾回去。
  assert.match(html, /data-selection-key="\$\{esc\(revisionImageKey\(record\.count,img\.url\)\)\}"\$\{revisionImageSelection\.has\(revisionImageKey\(record\.count,img\.url\)\)\?' checked':''\}/);
  // 工具列多一顆「移動到…」，跟刪除鍵一樣依選取數啟用。
  assert.match(html, /id="revisionSelectionMove" \$\{count\?'':'disabled'\} onclick="openRevisionMoveTargetPicker\(event\)"/);
  assert.match(html, /if\(moveBtn\)moveBtn\.disabled=!count;/);

  // ② 實際執行搬移流程：送出的內容、略過已在目標輪次的圖片、成功後清空選取並重新整理畫面。
  const block = html.match(/function revisionSelectionItems\(\)\{[\s\S]*?\nasync function moveSelectedCaseDesignImages\(id,toRound\)\{[\s\S]*?\n\}/)?.[0];
  assert.ok(block, 'could not locate the move helpers');
  const run = async ({ confirm = true, fail = false } = {}) => {
    const calls = [];
    const nodes = { '#revisionSelectionMove': { disabled: false } };
    const api = new Function('ctx', `
      const { calls, nodes } = ctx;
      const $ = selector => nodes[selector];
      let revisionImageSelection = new Set(['0::https://x/a', '0::https://x/b', '1::https://x/c']);
      const modificationLabel = round => (round === 0 ? '初稿' : ['', '一修', '二修'][round] || round + '修');
      const showAppConfirm = async opts => { calls.push({ step: 'confirm', title: opts.title }); return ${confirm}; };
      const sheetApi = async (action, payload) => {
        calls.push({ step: 'api', action, toRound: payload.toRound, images: payload.images });
        if (${fail}) throw new Error('沒有權限');
        return { ok: true, moved: payload.images.length, skipped: 0 };
      };
      const setSync = (message, isError) => calls.push({ step: 'sync', message, isError });
      const fetchModificationCounts = async () => {};
      const render = () => {}, refreshOpenRevisionModal = () => {}, refreshOpenCaseDetail = () => {};
      const currentEditorToken = 'tok';
      ${block}
      return { moveSelectedCaseDesignImages, selectionSize: () => revisionImageSelection.size, items: revisionSelectionItems };
    `)({ calls, nodes });
    return { api, calls, nodes };
  };

  const ok = await run();
  assert.deepEqual(ok.api.items(), [
    { round: 0, url: 'https://x/a' },
    { round: 0, url: 'https://x/b' },
    { round: 1, url: 'https://x/c' }
  ], '選取的 key 要正確拆回輪次與網址');
  await ok.api.moveSelectedCaseDesignImages('26090107', 1);
  const request = ok.calls.find(call => call.step === 'api');
  assert.equal(request.action, 'moveCaseDesignImages');
  assert.equal(request.toRound, 1);
  assert.deepEqual(request.images, [{ round: 0, url: 'https://x/a' }, { round: 0, url: 'https://x/b' }], '已經在目標輪次的那張不送出');
  assert.equal(ok.api.selectionSize(), 0, '成功後清空選取');
  assert.match(ok.calls.at(-1).message, /已把 2 張設計圖移到一修/);

  const cancelled = await run({ confirm: false });
  await cancelled.api.moveSelectedCaseDesignImages('26090107', 1);
  assert.equal(cancelled.calls.some(call => call.step === 'api'), false, '按取消就不送出');
  assert.equal(cancelled.api.selectionSize(), 3, '取消後選取保留');

  const failed = await run({ fail: true });
  await failed.api.moveSelectedCaseDesignImages('26090107', 1);
  assert.match(failed.calls.at(-1).message, /移動圖片失敗：沒有權限/);
  assert.equal(failed.calls.at(-1).isError, true);
  assert.equal(failed.nodes['#revisionSelectionMove'].disabled, false, '失敗後按鈕要恢復可按');
});

test('the delete warning sits above every modal, and open modals stop the page behind them from scrolling', async () => {
  const html = await readFile(new URL('../../index.html', import.meta.url), 'utf8');

  // ① 警示視窗要蓋過所有彈窗：.login-modal 5000、#revisionModal 6500、圖片放大預覽 10000。
  const dialogZ = Number(html.match(/\.app-confirm-backdrop\{position:fixed;inset:0;z-index:(\d+)!important;/)?.[1]);
  assert.ok(Number.isFinite(dialogZ), 'could not read the warning dialog z-index');
  const stacked = [...html.matchAll(/z-index:(\d+)!important/g)].map(match => Number(match[1]));
  const highestOther = Math.max(...stacked.filter(value => value !== dialogZ));
  assert.ok(dialogZ > highestOther, `警示視窗 z-index ${dialogZ} 必須高於其他所有彈窗（目前最高 ${highestOther}）`);

  // ② 案件資料／修改紀錄／信件編輯彈窗開著時鎖住背景捲動。
  // 只鎖 body 沒用：本站的 html 有 overflow-x:hidden，body 的 overflow 不會傳遞到視窗（實測背景照樣捲動）。
  assert.match(html, /html\.modal-scroll-locked,body\.modal-scroll-locked\{overflow:hidden!important\}/);
  assert.match(html, /\.case-detail-card,\.revision-modal-card,\.gmail-modal-card\{overscroll-behavior:contain\}/, '彈窗捲到底時不可以把捲動傳給背景');
  const block = html.match(/const SCROLL_LOCK_MODAL_IDS=[\s\S]*?syncModalScrollLock\(\);/)?.[0];
  assert.ok(block, 'could not locate the scroll lock helpers');
  assert.match(block, /attributeFilter:\['hidden'\]/, '彈窗是用 hidden 屬性開關，要監看它才不會漏掉任何開關方式');
  assert.match(block, /document\.documentElement\.classList\.toggle\('modal-scroll-locked',anyOpen\);/, 'html 也要一起加上鎖定 class');

  // 用假 DOM 實際執行：任何一個彈窗開著就鎖，全部關掉才解鎖。
  const modals = { caseDetailModal: { hidden: true }, revisionModal: { hidden: true }, gmailThreadModal: { hidden: true }, gmailComposeModal: { hidden: true }, uploadModal: { hidden: true }, personalSettingsModal: { hidden: true }, designerSettingsModal: { hidden: true }, aiStageModal: { hidden: true } };
  const classes = new Set();
  const api = new Function('ctx', `
    const { modals, classes } = ctx;
    const document = {
      getElementById: id => modals[id] || null,
      documentElement: { classList: { toggle: (name, on) => { if (on) classes.add('html:' + name); else classes.delete('html:' + name); } } },
      body: { classList: { toggle: (name, on) => { if (on) classes.add(name); else classes.delete(name); } } }
    };
    class MutationObserver { constructor(fn) { this.fn = fn; } observe() {} }
    const ensureOpenFontsUsedIn = () => {};
    ${block}
    return { syncModalScrollLock, ids: SCROLL_LOCK_MODAL_IDS };
  `)({ modals, classes });

  assert.deepEqual(api.ids, ['caseDetailModal', 'revisionModal', 'gmailThreadModal', 'gmailComposeModal', 'uploadModal', 'personalSettingsModal', 'designerSettingsModal', 'officeEditorModal', 'aiStageModal']);
  assert.equal(classes.has('modal-scroll-locked'), false, '一開始沒有彈窗就不鎖');
  modals.revisionModal.hidden = false;
  api.syncModalScrollLock();
  assert.equal(classes.has('modal-scroll-locked'), true);
  assert.equal(classes.has('html:modal-scroll-locked'), true, 'html 也要一起鎖，否則鎖不住');
  modals.caseDetailModal.hidden = false;
  modals.revisionModal.hidden = true;
  api.syncModalScrollLock();
  assert.equal(classes.has('modal-scroll-locked'), true, '還有另一個彈窗開著就維持鎖定');
  modals.caseDetailModal.hidden = true;
  api.syncModalScrollLock();
  assert.equal(classes.has('modal-scroll-locked'), false, '全部關掉才解鎖');
  assert.equal(classes.has('html:modal-scroll-locked'), false);
});

test('modification request mail closes the editor, a manual backup upload confirms that round, and 新增初稿 leads straight into picking an image source', async () => {
  const html = await readFile(new URL('../../index.html', import.meta.url), 'utf8');

  // ① 填寫修改需求信跟設計師回覆信一樣是一次性任務，寄出後要自動收合編輯器。
  assert.match(html, /if\(replyMode==='designer'\|\|replyMode==='modification'\)closeGmailThreadModal\(\);/);

  // ② 手動上傳補備份完成後，自動把那一輪標記成設計完成確認。
  assert.match(html, /if\(count\)void autoConfirmModificationRound\(id,replyRound\);/, '上傳完成的處理要呼叫自動確認');
  const block = html.match(/async function autoConfirmModificationRound\(id,round\)\{[\s\S]*?\n\}/)?.[0];
  assert.ok(block, 'could not locate autoConfirmModificationRound');
  const run = async ({ round = 1, records = [{ count: 1, confirmedDate: '' }], allowed = true, fail = false } = {}) => {
    const calls = [];
    const api = new Function('ctx', `
      const { calls, records } = ctx;
      const accessAllowed = () => ${allowed};
      const modificationRecordsFor = () => records;
      const slashDate = value => value;
      const todayInputValue = () => '2026/09/16';
      const modificationLabel = value => (value === 0 ? '初稿' : ['', '一修', '二修'][value] || value + '修');
      const sheetApi = async (action, payload) => {
        calls.push({ action, count: payload.record.count, confirmedDate: payload.record.confirmedDate });
        if (${fail}) throw new Error('沒有確認權限');
        return { record: { '確認修正日': '2026/09/16' } };
      };
      const setSync = (message, isError) => calls.push({ sync: message, isError });
      const render = () => {}, refreshOpenRevisionModal = () => {}, refreshOpenCaseDetail = () => {};
      const currentEditorToken = 'tok';
      ${block}
      return autoConfirmModificationRound;
    `)({ calls, records });
    const result = await api('26090107', round);
    return { result, calls, records };
  };

  const confirmed = await run();
  assert.equal(confirmed.result, true);
  assert.deepEqual(confirmed.calls[0], { action: 'updateModificationConfirm', count: 1, confirmedDate: '2026/09/16' });
  assert.equal(confirmed.records[0].confirmedDate, '2026/09/16', '本機資料同步更新，畫面立刻看得到確認日');

  assert.equal((await run({ round: 0 })).result, false, '初稿在後端建立時就已經確認過，不重複寫入');
  assert.equal((await run({ records: [{ count: 1, confirmedDate: '2026/09/15' }] })).result, false, '已經確認過就不再寫入');
  assert.equal((await run({ allowed: false })).result, false, '沒有確認權限就安靜略過');
  assert.equal((await run({ records: [] })).result, false, '找不到那一輪就不動作');
  const failed = await run({ fail: true });
  assert.equal(failed.result, false);
  assert.match(failed.calls.at(-1).sync, /自動標記一修設計完成確認失敗：沒有確認權限/, '失敗只提醒，不影響上傳結果');

  // ③ 新增初稿成功後直接接上「設計圖上傳方式」，不用自己再去找加號。
  const draftSubmit = html.match(/async function submitDraftModificationRecord\(event\)\{[\s\S]*?\n\}/)?.[0];
  assert.ok(draftSubmit, 'could not locate submitDraftModificationRecord');
  assert.match(draftSubmit, /setSync\(`已新增 \$\{id\} 初稿紀錄`\);\n    \/\/[^\n]*\n[^\n]*\n    openCaseDesignImageSourceChooser\(id,0,\$\('#revisionModalAdd'\)\);/);
  assert.ok(draftSubmit.indexOf('openCaseDesignImageSourceChooser') > draftSubmit.indexOf("sheetApi('addModificationRecord'"), '要等紀錄寫入成功後才跳出來源選擇');
  // 函式裡還有一個 try/catch（重讀修改紀錄），取最後一段才是寫入失敗的分支。
  const catchBranch = draftSubmit.slice(draftSubmit.lastIndexOf('}catch(err){'));
  assert.doesNotMatch(catchBranch, /openCaseDesignImageSourceChooser/, '寫入失敗時不跳出來源選擇');
  assert.match(catchBranch, /初稿紀錄新增失敗/);
});

test('mail editor toolbar offers undo/redo, font size, italic, underline, background colour and ⌘K linking', async () => {
  const html = await readFile(new URL('../../index.html', import.meta.url), 'utf8');

  // 兩個編輯器（回信、撰寫）的工具列都要有同一組按鈕。
  for (const editorId of ['gmailThreadReplyEditor', 'gmailComposeEditor']) {
    const colourAt = html.indexOf(`data-rich-color-for="${editorId}"`);
    assert.ok(colourAt > 0, `could not locate the toolbar for ${editorId}`);
    const toolbar = html.slice(html.lastIndexOf('<div class="gmail-rich-toolbar">', colourAt), colourAt);
    for (const [cmd, label] of [['undo', '復原'], ['redo', '重做'], ['bold', '粗體'], ['italic', '斜體'], ['underline', '底線']]) {
      assert.match(toolbar, new RegExp(`data-rich-cmd="${cmd}"`), `${editorId} 的工具列缺少${label}`);
    }
    assert.match(toolbar, new RegExp(`class="gmail-rich-size-btn" data-rich-size-for="${editorId}"`), `${editorId} 的工具列缺少字體大小`);
  }

  // 字體大小沿用既有的共用面板，不可以再多做一份實作。
  assert.match(html, /document\.querySelectorAll\('\.gmail-rich-toolbar \.gmail-rich-size-btn'\)\.forEach\(button=>\{/);
  assert.match(html, /openGmailSizePalette\(button\)/);
  assert.doesNotMatch(html, /ensureGmailSizeMenu/, '不要另外做第二套字體大小選單');

  // 顏色面板分成背景顏色與文字顏色兩組，背景色用 hiliteColor（舊瀏覽器退回 backColor）。
  const palette = html.match(/function ensureGmailColorPalette\(\)\{[\s\S]*?\n\}/)?.[0];
  assert.ok(palette, 'could not locate ensureGmailColorPalette');
  assert.match(palette, /<p class="gmail-color-group-title">背景顏色<\/p>/);
  assert.match(palette, /<p class="gmail-color-group-title">文字顏色<\/p>/);
  assert.match(palette, /data-gmail-color-kind="\$\{kind\}"/);
  assert.match(palette, /applyGmailSelectionColor\(kind,color\);/);
  const applyColor = html.match(/function applyGmailSelectionColor\(kind,color\)\{[\s\S]*?\n\}/)?.[0];
  assert.ok(applyColor, 'could not locate the shared color command handler');
  assert.match(applyColor, /if\(!document\.execCommand\('hiliteColor',false,color\)\)document\.execCommand\('backColor',false,color\)/);
  assert.match(applyColor, /else document\.execCommand\('foreColor',false,color\);/);
  // 只有文字色會更新按鈕上的色塊，背景色不該改掉它。
  assert.match(palette, /if\(kind==='text'\)\{[\s\S]*?gmailColorTargetButton\.dataset\.selectedColor=color;/);

  // ⌘K／Ctrl+K 在編輯器裡選取文字後可以直接加連結。
  const shortcut = html.match(/document\.querySelectorAll\('\.gmail-rich-editor'\)\.forEach\(editor=>editor\.addEventListener\('keydown',event=>\{[\s\S]*?\}\)\);/)?.[0];
  assert.ok(shortcut, 'could not locate the ⌘K shortcut binding');
  assert.match(shortcut, /event\.metaKey\|\|event\.ctrlKey/);
  assert.match(shortcut, /if\(key==='k'\)\{/);
  // 粗體／斜體／底線也明確處理，不只依賴瀏覽器原生行為。
  assert.match(shortcut, /if\(\['b','i','u'\]\.includes\(key\)\)\{event\.preventDefault\(\);document\.execCommand\(\{b:'bold',i:'italic',u:'underline'\}\[key\]\)\}/);
  assert.match(shortcut, /event\.preventDefault\(\);/);
  assert.match(shortcut, /savedRichSelectionRange=captureCurrentRichSelection\(\);/, '要先記住選取範圍，否則連結會插到錯的位置');
  assert.match(shortcut, /insertRichLink\(editor\.id\);/);
});

test('signature and mail template editors in personal settings get the same rich toolbar as the mail editor', async () => {
  const html = await readFile(new URL('../../index.html', import.meta.url), 'utf8');
  const toolbar = html.match(/function richSettingsToolbarHtml\(extraClass='',\{recipientName=false,details=false\}=\{\}\)\{[\s\S]*?\n\}/)?.[0];
  assert.ok(toolbar, 'could not locate richSettingsToolbarHtml');
  for (const cmd of ['undo', 'redo', 'bold', 'italic', 'underline', 'justifyLeft', 'justifyCenter', 'justifyRight']) {
    assert.ok(toolbar.includes(`data-rich-cmd="${cmd}"`), `共用工具列缺少 ${cmd}`);
  }
  assert.match(toolbar, /class="gmail-rich-size-btn" data-rich-size/, '缺少文字大小');
  assert.match(toolbar, /class="gmail-rich-color-btn"/, '缺少文字與背景顏色');
  assert.match(toolbar, /class="gmail-rich-link-btn" data-rich-link/, '缺少超連結');

  // 兩處都用同一個產生器，功能才不會各走各的。
  // 信件範本多帶 recipientName（插入收件人名）選項。
  assert.equal((html.match(/\$\{richSettingsToolbarHtml\('signature-preset-toolbar'(?:,\{recipientName:true,details:true\})?\)\}/g) || []).length, 2, '簽名檔與信件範本都要套用');

  // 信件範本從純文字 textarea 改成格式化編輯區，存的是 HTML。
  assert.doesNotMatch(html, /<textarea data-reply-template-content/, '信件範本不該再是純文字欄位');
  assert.match(html, /<div class="signature-preset-content" data-reply-template-content contenteditable="true"/);
  const collect = html.match(/function collectMailTemplateEditor\(list,\{requireContent=true\}=\{\}\)\{[\s\S]*?\n\}/)?.[0];
  assert.ok(collect, 'could not locate collectMailTemplateEditor');
  assert.match(collect, /templates\[name\]=String\(editor\?\.innerHTML\|\|''\)\.trim\(\);/);
  assert.match(collect, /signaturePresetContentEmpty\(editor\)/, '空白判斷要看實際文字，contenteditable 清空後會留下 <br>');

  // 共用的互動：工具列按鈕、彈出選單、超連結與 ⌘K／⌘B／⌘I／⌘U。
  const bind = html.match(/function bindRichSettingsEditor\(list,contentSelector\)\{[\s\S]*?\n\}/)?.[0];
  assert.ok(bind, 'could not locate bindRichSettingsEditor');
  assert.match(bind, /savedRichSelectionRange=captureCurrentRichSelection\(\)/, '按工具列會讓編輯區失焦，要先存下選取範圍');
  assert.match(bind, /insertRichLinkIntoEditor\(editorOf\(linkButton\)\)/);
  assert.match(bind, /if\(key==='k'\)\{event\.preventDefault\(\);savedRichSelectionRange=captureCurrentRichSelection\(\);insertRichLinkIntoEditor\(editor\);return\}/);
  assert.match(bind, /if\(\['b','i','u'\]\.includes\(key\)\)\{event\.preventDefault\(\);document\.execCommand\(\{b:'bold',i:'italic',u:'underline'\}\[key\]\)\}/);
  assert.match(html, /function bindSignaturePresetEditor\(list\)\{[\s\S]*?bindRichSettingsEditor\(list,'\[data-signature-preset-content\]'\);/);
  assert.match(html, /bindRichSettingsEditor\(list,'\[data-reply-template-content\]'\);/);

  // 插入範本要保留格式；舊的純文字範本仍照原本逐行插入，預覽摘要一律轉純文字。
  const insert = html.match(/function insertTemplateIntoRichEditor\(editorId,content\)\{[\s\S]*?\n\}/)?.[0];
  assert.ok(insert, 'could not locate insertTemplateIntoRichEditor');
  assert.match(insert, /if\(!looksLikeSignatureHtml\(value\)\)\{insertPlainTextIntoRichEditor\(editorId,value\);return\}/, '舊的純文字範本要維持原本行為');
  assert.match(insert, /holder\.innerHTML=value;/);
  assert.match(html, /closeFieldPopover\(\);insertTemplateIntoRichEditor\(editorId,entry\[1\]\);/);
  assert.match(html, /esc\(richContentPlainText\(content\)\.replace\(\/\\s\+\/g,' '\)\.slice\(0,70\)\)/, '預覽摘要不可以直接秀 HTML 標籤');
});

test('modals people type into never close from a stray click on the backdrop', async () => {
  const html = await readFile(new URL('../../index.html', import.meta.url), 'utf8');

  // 信件撰寫／回信：不可以再綁「點遮罩關閉」，信寫到一半誤點框外就整封消失。
  assert.doesNotMatch(html, /bindModalOverlayDismiss\(\$\('#gmailThreadModal'\)/);
  assert.doesNotMatch(html, /bindModalOverlayDismiss\(\$\('#gmailComposeModal'\)/);
  // 個人設定、設計師設定同理（原本是自己的 click 判斷，不是走 bindModalOverlayDismiss）。
  assert.doesNotMatch(html, /event\.target\.id==='personalSettingsModal'\)hidePersonalSettings\(\)/);
  assert.doesNotMatch(html, /event\.target\.id==='designerSettingsModal'\)hideDesignerSettings\(\)/);

  // 但關閉的正常途徑要留著：關閉鈕、取消鈕，個人設定還有 Esc。
  assert.match(html, /\$\('#personalSettingsClose'\)\?\.addEventListener\('click',hidePersonalSettings\);/);
  assert.match(html, /\$\('#personalSettingsCancel'\)\?\.addEventListener\('click',hidePersonalSettings\);/);
  assert.match(html, /\$\('#designerSettingsCancel'\)\?\.addEventListener\('click',hideDesignerSettings\);/);
  assert.match(html, /\$\('#designerSettingsClose'\)\?\.addEventListener\('click',hideDesignerSettings\);/);
  assert.match(html, /\$\('#gmailThreadReplyCancel'\)\?\.addEventListener\('click',\(\)=>\{closeFieldPopover\(\);closeGmailThreadModal\(\)\}\);/);
  assert.match(html, /\$\('#gmailComposeCancel'\)\?\.addEventListener\('click',\(\)=>\{closeFieldPopover\(\);closeGmailComposeModal\(\)\}\);/);
  assert.match(html, /if\(event\.key==='Escape'&&!\$\('#personalSettingsModal'\)\?\.hidden\)/);

  // 兩個設定視窗開著時也要鎖住背景捲動。
  assert.match(html, /const SCROLL_LOCK_MODAL_IDS=\[[^\]]*'personalSettingsModal','designerSettingsModal'[,\]]/);

  // 其他彈窗維持原本的「點外面關閉」（例如案件資料、修改紀錄、複製信件內容）。
  assert.match(html, /bindModalOverlayDismiss\(\$\('#mailCopyModal'\),closePostSubmitCopyModal\);/);
  assert.match(html, /\$\('#caseDetailModal'\)\?\.addEventListener\('click',event=>\{if\(event\.target\.id==='caseDetailModal'\)closeCaseDetail\(\)\}\);/);
});

test('designer settings gain their own signature presets, past story thumbnails with tooltips, and replace the personal settings entry for designers', async () => {
  const html = await readFile(new URL('../../index.html', import.meta.url), 'utf8');

  // ① 每位設計師各有一組簽名檔設定，沿用個人設定那套編輯器。
  const block = html.match(/function designerSignaturePresetsHtml\(profile\)\{[\s\S]*?\n\}/)?.[0];
  assert.ok(block, 'could not locate designerSignaturePresetsHtml');
  assert.match(block, /6\. 簽名檔設定/);
  assert.match(block, /data-signature-preset-list data-signature-scope="\$\{esc\(scope\)\}"/);
  assert.match(block, /signaturePresetRowHtml\(name,content,index,\{defaultKey:normalized\.defaultName,scope\}\)/);
  assert.match(html, /\$\{designerReplyTemplatesHtml\(d\)\}\$\{designerSignaturePresetsHtml\(d\)\}/, '簽名檔區塊要排在回信範本之後');
  assert.match(html, /bindDesignerReplySettings\(\);bindDesignerSignatureSettings\(\)\}/);
  assert.match(html, /function validateDesignerSignatureInputs\(\)/);
  assert.match(html, /!validateDesignerReplyTemplateInputs\(\)\|\|!validateDesignerSignatureInputs\(\)\)return;/, '儲存前要驗證簽名檔');
  assert.match(html, /signaturePresets,signaturePresetDefault,/, '送出的設定要帶簽名檔');

  // 多位設計師同時顯示時，「設為預設」不能互相干擾——radio 名稱要帶作用域。
  const rowHtml = html.match(/function signaturePresetRowHtml\(name='',content='',index=0,\{defaultKey='',scope='personal'\}=\{\}\)\{[\s\S]*?\n/)?.[0];
  assert.ok(rowHtml, 'signaturePresetRowHtml 需要 scope 參數');
  assert.match(html, /const radioName=`signature-preset-default-\$\{String\(scope\)\.replace\(/);

  // ② 設計師看得到設計師設定，就不再顯示個人設定入口（其他角色不受影響）；管理者例外，要用個人設定裡的客戶設定。
  assert.match(html, /show\('#accountPersonalSettings',loggedIn&&!isLocalPreviewToken\(\)&&accessAllowed\('profile\.edit',true\)&&\(isAdministrator\(\)\|\|!canAccessDesignerSettings\(\)\)\);/);

  // ③ 管理照片欄位列出過往貼過的縮圖，滑鼠停留顯示互動狀況與最新留言。
  assert.match(html, /data-manage-designer-photo="\$\{esc\(name\)\}">管理圖片與 Reels<\/button>\$\{designerReelThumbsHtml\(name\)\}/);
  const thumbs = html.match(/function designerReelThumbsHtml\(name\)\{[\s\S]*?\n\}/)?.[0];
  assert.ok(thumbs, 'could not locate designerReelThumbsHtml');
  assert.match(thumbs, /storiesForDesigner\(name\)/);
  assert.match(thumbs, /目前還沒有貼過的內容/);
  assert.match(thumbs, /data-design-image-hover-preview/, '沿用既有的放大預覽');

  // 提示文字實際跑一次。
  const tooltip = html.match(/function designerReelTooltip\(reel\)\{[\s\S]*?\n\}/)?.[0];
  assert.ok(tooltip, 'could not locate designerReelTooltip');
  const makeTooltip = new Function(`${tooltip};return designerReelTooltip;`)();
  assert.equal(
    makeTooltip({ likeCount: 2, dislikeCount: 1, viewerCount: 5, comments: [{ name: '李明庭', text: '這版可以  出' }] }),
    '按讚 2・倒讚 1・已讀 5・留言 1\n最新留言｜李明庭：這版可以 出'
  );
  assert.equal(makeTooltip({}), '按讚 0・倒讚 0・已讀 0・留言 0', '沒有互動時只顯示統計');
});

test('each customer carries its own default CC list for the mail composer, falling back to the default list when unset', async () => {
  const html = await readFile(new URL('../../index.html', import.meta.url), 'utf8');
  const { TABLE_SCHEMAS, DEFAULT_CUSTOMER_CC_EMAILS } = await import('../../backend/schema.mjs');
  const CUSTOMER_DEFAULTS = DEFAULT_CUSTOMER_CC_EMAILS;

  // 欄位要進資料表結構，既有客戶別才會被補上這一欄。
  assert.ok(TABLE_SCHEMAS['客戶別'].headers.includes('預設信箱'));
  assert.deepEqual(DEFAULT_CUSTOMER_CC_EMAILS, [
    'machi.chen@emctaipei.com', 'anna.hsu@emctaipei.com', 'amber.tian@emctaipei.com', 'leona.chen@emctaipei.com', 'eric.fu@emctaipei.com'
  ]);

  const pick = name => html.match(new RegExp(`function ${name}\\([^)]*\\)\\{[\\s\\S]*?\\n\\}`))?.[0];
  const sources = ['customerDefaultCcRecipients', 'mailCcRecipients'].map(pick);
  assert.ok(sources.every(Boolean), 'could not locate the cc helpers');
  const build = customerRows => new Function('customerRows', `
    const extractEmail = value => String(value || '').match(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\\.[A-Z]{2,}/i)?.[0] || '';
    const parseNameListValue = value => { try { const parsed = JSON.parse(value || '[]'); return Array.isArray(parsed) ? parsed : []; } catch { return []; } };
    const customerDirectoryRowFor = name => customerRows[name] || null;
    const designerRecipientByName = name => (name ? name + ' <' + String(name).toLowerCase() + '@emctaipei.com>' : '');
    const designerRecipient = row => 'Machi <machi.chen@emctaipei.com>';
    const CUSTOMER_DEFAULT_CC_EMAILS = ['machi.chen@emctaipei.com', 'anna.hsu@emctaipei.com', 'amber.tian@emctaipei.com', 'leona.chen@emctaipei.com', 'eric.fu@emctaipei.com'];
    const requiredMailCcRecipients = ['傅思凱 <eric.fu@emctaipei.com>'];
    const uniqueMailRecipients = list => {
      const seen = new Set();
      return list.filter(item => { const key = (extractEmail(item) || item).toLowerCase(); if (!item || seen.has(key)) return false; seen.add(key); return true; });
    };
    ${sources.join('\n')}
    return { customerDefaultCcRecipients, mailCcRecipients };
  `)(customerRows);

  // ① 有設定就用客戶自己的名單，收件人（設計負責人 Machi）自動略過。
  const configured = build({ Epson: { '預設信箱': JSON.stringify(['machi.chen@emctaipei.com', 'anna.hsu@emctaipei.com', 'eric.fu@emctaipei.com']) } });
  assert.deepEqual(configured.mailCcRecipients({ client: 'Epson', designer: 'Machi' }), ['anna.hsu@emctaipei.com', 'eric.fu@emctaipei.com']);

  // ② 從沒設定過（欄位空白或客戶別不存在）就用預設名單，跟資料庫後台顯示的預設勾選一致（2026-09-18）。
  const fallback = build({ Epson: { '預設信箱': '' } });
  assert.deepEqual(fallback.mailCcRecipients({ client: 'Epson', designer: 'Machi' }), [
    'anna.hsu@emctaipei.com', 'amber.tian@emctaipei.com', 'leona.chen@emctaipei.com', 'eric.fu@emctaipei.com'
  ]);
  // 這個測試環境的收件人固定是 Machi，所以預設名單扣掉 Machi。
  assert.deepEqual(build({}).mailCcRecipients({ client: '沒有這個客戶', designer: 'Machi' }), CUSTOMER_DEFAULTS.filter(email => email !== 'machi.chen@emctaipei.com'));
  // 明確存成空清單＝這個客戶別不要預設副本。
  assert.deepEqual(build({ Epson: { '預設信箱': '[]' } }).mailCcRecipients({ client: 'Epson', designer: 'Machi' }), []);
  assert.match(html, /const CUSTOMER_DEFAULT_CC_EMAILS=Object\.freeze\(\['machi\.chen@emctaipei\.com','anna\.hsu@emctaipei\.com','amber\.tian@emctaipei\.com','leona\.chen@emctaipei\.com','eric\.fu@emctaipei\.com'\]\);/);
  assert.doesNotMatch(html, /function designerCcRecipients\(/, '舊的同組設計師規則已移除');

  // ③ 欄位允許填名字，會轉成寄信用的收件人；重複的只留一筆。
  const byName = build({ Epson: { '預設信箱': JSON.stringify(['Leona', 'leona.chen@emctaipei.com', 'eric.fu@emctaipei.com']) } });
  assert.deepEqual(byName.mailCcRecipients({ client: 'Epson', designer: 'Machi' }), ['Leona <leona@emctaipei.com>', 'leona.chen@emctaipei.com', 'eric.fu@emctaipei.com']);

  // 後台編輯器：沒設定過先帶入預設名單，儲存時寫回欄位。
  const admin = await readFile(new URL('../../json_database_admin.html', import.meta.url), 'utf8');
  assert.match(admin, /const CUSTOMER_DEFAULT_CC_EMAILS=\['machi\.chen@emctaipei\.com','anna\.hsu@emctaipei\.com','amber\.tian@emctaipei\.com','leona\.chen@emctaipei\.com','eric\.fu@emctaipei\.com'\];/);
  assert.match(admin, /const mailSelected=new Set\(mailsUsingDefault\?CUSTOMER_DEFAULT_CC_EMAILS:savedMails\);/);
  assert.match(admin, /customerPeoplePickerHtml\('mail',mailEntries,mailSelected\)/);
  assert.match(admin, /const mails=\[\.\.\.editor\.querySelectorAll\('\[data-customer-mail\]:checked'\)\]/);
  assert.match(admin, /'預設信箱':JSON\.stringify\(mails\)/);
  // 名單裡有查不到的信箱（離職或還沒建帳號）也要補成選項，否則儲存時會被靜默丟掉。
  assert.match(admin, /mailSelected\.forEach\(value=>\{if\(!mailEntries\.some\(entry=>entry\.value===value\)\)mailEntries\.push\(/);
});

test('the header version no longer flips: nothing hardcoded in the HTML, last seen version applied immediately', async () => {
  const html = await readFile(new URL('../../index.html', import.meta.url), 'utf8');

  // 寫死的版本號一定會過期，載入公告後就會當著使用者的面跳掉，所以標題與標頭都不帶版本。
  assert.match(html, /<title>設計需求系統<\/title>/);
  assert.match(html, /<div class="title-row"><h1>設計需求系統<\/h1>/);
  assert.doesNotMatch(html, /<title>設計需求系統 v/);
  assert.doesNotMatch(html, /<h1>設計需求系統 v/);

  const block = html.match(/const systemVersionCacheKey='machiSystemAnnouncementVersion';[\s\S]*?\napplyCachedSystemVersion\(\);/)?.[0];
  assert.ok(block, 'could not locate the version helpers');

  const run = (stored = null) => {
    const state = { title: '設計需求系統', heading: { textContent: '設計需求系統' }, store: stored === null ? {} : { machiSystemAnnouncementVersion: stored } };
    const api = new Function('state', `
      const document = {
        set title(value) { state.title = value; },
        get title() { return state.title; },
        querySelector: selector => (selector === 'header .title-row h1' ? state.heading : null)
      };
      const localStorage = {
        getItem: key => (key in state.store ? state.store[key] : null),
        setItem: (key, value) => { state.store[key] = value; }
      };
      ${block}
      return { applySystemAnnouncementVersion };
    `)(state);
    return { state, api };
  };

  // 第一次造訪：沒有快取，開頁只顯示「設計需求系統」，不會先秀一個錯的版本。
  const first = run();
  assert.equal(first.state.title, '設計需求系統');
  assert.equal(first.state.heading.textContent, '設計需求系統');
  first.api.applySystemAnnouncementVersion('v4.72');
  assert.equal(first.state.title, '設計需求系統 v4.72');
  assert.equal(first.state.heading.textContent, '設計需求系統 v4.72');
  assert.equal(first.state.store.machiSystemAnnouncementVersion, 'v4.72', '看到的版本要記起來');

  // 第二次造訪：開頁立刻套用上次看到的版本，公告回來時值一樣，畫面不會跳動。
  const second = run('v4.72');
  assert.equal(second.state.title, '設計需求系統 v4.72');
  second.api.applySystemAnnouncementVersion('v4.72');
  assert.equal(second.state.title, '設計需求系統 v4.72');

  // 公告真的改版時才會更新，空值不覆蓋。
  const bumped = run('v4.72');
  bumped.api.applySystemAnnouncementVersion('');
  assert.equal(bumped.state.title, '設計需求系統 v4.72');
  bumped.api.applySystemAnnouncementVersion('v4.80');
  assert.equal(bumped.state.title, '設計需求系統 v4.80');
  assert.equal(bumped.state.store.machiSystemAnnouncementVersion, 'v4.80');
});

test('reply templates saved as formatted text are inserted as formatting, not as literal <br> characters', async () => {
  const html = await readFile(new URL('../../index.html', import.meta.url), 'utf8');
  const block = html.match(/function setGmailEditorTemplateContent\(editor,greeting,template\)\{[\s\S]*?\n\}/)?.[0];
  assert.ok(block, 'could not locate setGmailEditorTemplateContent');

  const run = (greeting, template) => {
    const calls = [];
    const editor = { innerHTML: '', replaceChildren() { this.innerHTML = ''; } };
    new Function('editor', 'calls', `
      const esc = value => String(value ?? '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
      const looksLikeSignatureHtml = value => /<[a-z][\\s\\S]*>/i.test(String(value || ''));
      const setGmailEditorPlainText = (target, value) => { calls.push({ plain: value }); target.innerHTML = 'PLAIN:' + value; };
      const REPLY_TEMPLATE_RECIPIENT_TOKEN = '{收件人名}';
      const applyTemplateTokens = value => String(value || '');
      ${block}
      setGmailEditorTemplateContent(editor, ${JSON.stringify(greeting)}, ${JSON.stringify(template)});
    `)(editor, calls);
    return { editor, calls };
  };

  // 格式化範本：直接當 HTML 寫入，換行就是換行，不會出現看得到的 <br>。
  const rich = run('Hi 吳冠賢,\n\n', '附上社群貼文，<br>再煩請查收，謝謝。');
  assert.equal(rich.editor.innerHTML, 'Hi 吳冠賢,<br><br>附上社群貼文，<br>再煩請查收，謝謝。');
  assert.equal(rich.calls.length, 0, '格式化範本不可以走純文字路徑');
  assert.doesNotMatch(rich.editor.innerHTML, /&lt;br&gt;/);

  // 招呼語本身要逃脫，避免收件人名稱裡的角括號被當成標籤。
  const escaped = run('Hi <b>壞人</b>,\n\n', '<p>內容</p>');
  assert.match(escaped.editor.innerHTML, /^Hi &lt;b&gt;壞人&lt;\/b&gt;,<br><br><p>內容<\/p>$/);

  // 舊的純文字範本維持原本的逐行插入。
  const plain = run('Hi 吳冠賢,\n\n', '附上社群貼文，\n再煩請查收，謝謝。');
  assert.equal(plain.calls.length, 1);
  assert.equal(plain.calls[0].plain, 'Hi 吳冠賢,\n\n附上社群貼文，\n再煩請查收，謝謝。');

  // 三個帶入點都要改用這支，不能再直接塞純文字。
  assert.match(html, /setGmailEditorTemplateContent\(replyEditor,'',generalReplyTemplate\)/);
  assert.match(html, /setGmailEditorTemplateContent\(replyEditor,`Hi \$\{recipientName\},\\n\\n`,generalReplyTemplate\)/);
  assert.match(html, /setGmailEditorTemplateContent\(editor,`Hi \$\{recipientName\},\\n\\n`,configuredTemplate\)/);
});

test('personal settings 客戶設定 lists only customers the account can manage and saves just the customers that changed', async () => {
  const html = await readFile(new URL('../../index.html', import.meta.url), 'utf8');
  // 區塊放在個人設定裡，開啟時渲染、儲存時一併送出、切換客戶別會先暫存勾選。
  assert.match(html, /<section class="personal-mail-templates personal-customer-settings" id="personalCustomerSettings" hidden>/);
  assert.match(html, /renderPersonalCustomerSettings\(\);setPersonalSettingsStatus\(\);modal\.hidden=false;/);
  // 2026-09-18 起每個區塊各自儲存，客戶設定有自己的「儲存」。
  assert.match(html, /const saved=await savePersonalCustomerSettings\(\);/);
  assert.match(html, /data-personal-save="customers"/);
  assert.match(html, /\$\('#personalCustomerSelect'\)\?\.addEventListener\('change',event=>switchPersonalCustomer\(event\.target\.value\)\);/);

  const pick = name => html.match(new RegExp(`(?:async )?function ${name}\\([^)]*\\)\\{[\\s\\S]*?\\n\\}`))?.[0];
  const line = prefix => html.split('\n').find(row => row.startsWith(prefix));
  const sources = [
    line('const isCustomerGroupRule='), line('const sameCustomerSet='),
    ...['personalCustomerNames', 'customerMailEntryEmail', 'personalCustomerStoredValues', 'personalCustomerValues', 'savePersonalCustomerSettings'].map(pick)
  ];
  assert.ok(sources.every(Boolean), 'could not locate the customer settings helpers');
  const build = (rows, { admin = false } = {}) => new Function('rows', 'admin', `
    const calls = [];
    let customerDirectoryRows = rows;
    const currentEditorAccount = 'livia.chu@emctaipei.com', currentEditor = '', currentEditorDepartment = '企劃部', currentEditorRawGroup = '', currentEditorToken = 'tok';
    const designerOptions = ['Machi', 'Anna', 'Amber', 'Leona'];
    const PERSONAL_CUSTOMER_DEFAULT_CC_EMAILS = ['machi.chen@emctaipei.com', 'eric.fu@emctaipei.com'];
    const personalCustomerDrafts = new Map();
    const isAdministrator = () => admin;
    const personalCustomerSelf = () => 'livia.chu@emctaipei.com';
    const capturePersonalCustomerDraft = () => {};
    const extractEmail = value => String(value || '').match(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\\.[A-Z]{2,}/i)?.[0] || '';
    const designerRecipientByName = name => name === 'Leona' ? 'Leona <leona.chen@emctaipei.com>' : '';
    const canonicalAccountClient = value => String(value || '').trim().toLowerCase();
    const parseNameListValue = value => { try { const parsed = JSON.parse(value || '[]'); return Array.isArray(parsed) ? parsed : []; } catch { return []; } };
    const customerDirectoryRowFor = name => customerDirectoryRows.find(row => row['客戶別'] === name) || null;
    const sortedCustomerDirectoryRows = list => list;
    const customerEditRuleMatches = (rule, account, department) => rule === 'department:' + department || rule === account;
    const sheetApi = async (action, payload) => { calls.push({ action, payload }); return { ok: true, customer: { ...customerDirectoryRowFor(payload.customer), '設計負責人': JSON.stringify(payload.designers || []) } }; };
    ${sources.join('\n')}
    return { calls, drafts: personalCustomerDrafts, personalCustomerNames, personalCustomerStoredValues, savePersonalCustomerSettings };
  `)(rows, admin);

  const rows = [
    { '客戶別': '丹士特', '專案負責人': JSON.stringify(['department:設計部', 'group:Celine組', 'livia.chu@emctaipei.com']), '設計負責人': JSON.stringify(['Karl', 'Anna']), '預設信箱': '' },
    { '客戶別': 'Epson', '專案負責人': JSON.stringify(['allen.li@emctaipei.com']), '設計負責人': '[]', '預設信箱': JSON.stringify(['Leona', 'eric.fu@emctaipei.com']) },
    { '客戶別': 'EMC', '專案負責人': JSON.stringify(['department:企劃部']), '設計負責人': '[]', '預設信箱': '' }
  ];
  const ui = build(rows);
  // 只列出權限名單涵蓋自己的客戶別（個別帳號或所屬部門），管理者看得到全部。
  assert.deepEqual(ui.personalCustomerNames(), ['丹士特', 'EMC']);
  assert.deepEqual(build(rows, { admin: true }).personalCustomerNames(), ['丹士特', 'Epson', 'EMC']);

  // 部門／組別規則與個別帳號分開；預設信箱沒設定過時比照後台帶預設名單；離職設計師（Karl）不列入。
  assert.deepEqual(ui.personalCustomerStoredValues('丹士特'), {
    rules: ['department:設計部', 'group:Celine組'],
    owners: ['livia.chu@emctaipei.com'],
    mails: ['machi.chen@emctaipei.com', 'eric.fu@emctaipei.com'],
    designers: ['Anna']
  });

  // 沒有變動的客戶別不送出；有變動的只送變動的欄位。
  ui.drafts.set('EMC', { ...ui.personalCustomerStoredValues('EMC'), owners: ['livia.chu@emctaipei.com'], mails: ['Machi <machi.chen@emctaipei.com>', 'eric.fu@emctaipei.com'] });
  ui.drafts.set('丹士特', {
    ...ui.personalCustomerStoredValues('丹士特'),
    owners: ['livia.chu@emctaipei.com', 'allen.li@emctaipei.com'],
    mails: ['Machi <machi.chen@emctaipei.com>', 'eric.fu@emctaipei.com'],
    designers: ['Anna', 'Amber']
  });
  assert.equal(await ui.savePersonalCustomerSettings(), 1);
  assert.deepEqual(ui.calls, [{
    action: 'saveCustomerSettings',
    payload: { customer: '丹士特', editorToken: 'tok', owners: ['livia.chu@emctaipei.com', 'allen.li@emctaipei.com'], designers: ['Anna', 'Amber'] }
  }]);
  assert.equal(ui.drafts.size, 0, '儲存後清掉暫存');
});

test('personal 客戶設定 permission tree mirrors the admin department:/group: rules and hides test units', async () => {
  const html = await readFile(new URL('../../index.html', import.meta.url), 'utf8');
  const pick = name => html.match(new RegExp(`function ${name}\\([^)]*\\)\\{[\\s\\S]*?\\n\\}`))?.[0];
  const line = prefix => html.split('\n').find(row => row.startsWith(prefix));
  const sources = [
    line('function normalizeDepartmentName('),
    line('const PERSONAL_CUSTOMER_HIDDEN_UNIT='), line('const isHiddenCustomerRule='), line('const PERSONAL_CUSTOMER_FLAT_DEPARTMENTS='),
    pick('normalizeDesignGroup'), pick('personalCustomerOwnerTree')
  ];
  assert.ok(sources.every(Boolean), 'could not locate the permission tree helpers');
  const settings = [
    { '帳號': 'livia.chu@emctaipei.com', '部門': '企劃部', '組別': '', '顯示名': '朱祖翎' },
    { '帳號': 'machi.chen@emctaipei.com', '部門': '設計部', '組別': '管理者', '顯示名': 'Machi' },
    { '帳號': 'video@emctaipei.com', '部門': '其他部', '組別': '影音', '顯示名': 'Video' },
    { '帳號': 'pm1@emctaipei.com', '部門': '專案部', '組別': 'Odin組', '顯示名': 'PM1' },
    { '帳號': 'pm2@emctaipei.com', '部門': '凱曜專案部', '組別': 'Odin組', '顯示名': 'PM2' },
    { '帳號': 'tester@emctaipei.com', '部門': '測試員', '組別': '影音', '顯示名': 'Tester' },
    { '帳號': 'gone@emctaipei.com', '部門': '企劃部', '組別': '', '顯示名': '離職' }
  ];
  const tree = new Function('settings', `
    const githubJsonDatabaseCache = { tables: { '設定': { rows: settings }, '帳號權限': { rows: [{ '帳號': 'gone@emctaipei.com', '狀態': '停用' }] } } };
    const canonicalAccountClient = value => String(value || '').trim().toLowerCase();
    ${sources.join('\n')}
    return personalCustomerOwnerTree;
  `)(settings)(['department:測試員', 'department:企劃部', 'group:Ann組']);
  const shape = node => ({ label: node.label, rule: node.rule, members: node.members.map(m => m.account), children: node.children.map(shape) });
  // 企劃部、設計部固定排最前面；其餘依中文排序（各環境的排序結果不同，這裡不比順序）。
  assert.deepEqual(tree.slice(0, 2).map(node => node.label), ['企劃部', '設計部']);
  const byLabel = (a, b) => (a.label < b.label ? -1 : a.label > b.label ? 1 : 0);
  assert.deepEqual(tree.map(shape).sort(byLabel), [
    { label: '企劃部', rule: 'department:企劃部', members: ['livia.chu@emctaipei.com'], children: [] },
    // 平面／影音組別的人一律算設計部（同後端 matchesCustomerEditRule）。
    { label: '設計部', rule: 'department:設計部', members: ['machi.chen@emctaipei.com', 'video@emctaipei.com'], children: [] },
    // 名單裡有、但目前沒有成員的規則也要列出，否則存檔會被拿掉；測試員不顯示。
    { label: 'Ann組', rule: 'group:Ann組', members: [], children: [] },
    // 「凱曜」是公司名稱：凱曜專案部併入專案部，同一個 Odin組 只出現一次。
    { label: '專案部', rule: 'department:專案部', members: [], children: [{ label: 'Odin組', rule: 'group:Odin組', members: ['pm1@emctaipei.com', 'pm2@emctaipei.com'], children: [] }] }
  ].sort(byLabel));

  // 「全選」對應規則、切換時同名規則一起同步、隱藏的測試規則存檔時保留，以及「各組」字樣不再出現。
  assert.match(html, /ownerBlock\.querySelectorAll\('\[data-personal-customer-rule\]'\)\.forEach\(other=>\{if\(other\.dataset\.personalCustomerRule===input\.dataset\.personalCustomerRule\)/);
  assert.match(html, /\.\.\.stored\.rules\.filter\(isHiddenCustomerRule\),/);
  assert.match(html, /if\(!sameCustomerSet\(draft\.rules,stored\.rules\)\)payload\.rules=draft\.rules;/);
  assert.match(html, /const label=contact\.subgroup\|\|contact\.group\|\|'其他';/);
});

test('信件編輯器、簽名檔與信件範本的工具列都有開源字型選單，且每個字型都帶備用字型', async () => {
  const html = await readFile(new URL('../../index.html', import.meta.url), 'utf8');
  for (const editor of ['gmailThreadReplyEditor', 'gmailComposeEditor']) {
    assert.match(html, new RegExp(`<button type="button" class="gmail-rich-font-btn" data-rich-font-for="${editor}" title="字型"`));
  }
  assert.match(html, /\+'<button type="button" class="gmail-rich-font-btn" data-rich-font title="字型"/, '設定頁共用工具列');
  assert.match(html, /const fontButton=event\.target\.closest\('\[data-rich-font\]'\);/);
  // 字型樣式表約 1.3MB，不可放在 <head> 擋住進站；改成用到才載入。
  assert.doesNotMatch(html.slice(0, html.indexOf('</head>')), /fonts\.googleapis\.com/);
  assert.match(html, /function openGmailFontPalette\(button\)\{\n  ensureAllOpenFonts\(\);/);
  assert.match(html, /if\(anyOpen\)scheduleOpenFontScan\(\);/);

  const source = html.match(/const gmailOpenFonts=Object\.freeze\(\[[\s\S]*?\]\);/)?.[0];
  assert.ok(source, 'gmailOpenFonts 清單');
  const fonts = new Function(`const GMAIL_DEFAULT_FONT_MARKER='machi-default-font';${source};return gmailOpenFonts;`)();
  for (const font of fonts.slice(1)) assert.ok(font.family && font.css, `${font.label} 要有 family／css 才能按需載入`);
  assert.equal(fonts[0].label, '預設');
  assert.deepEqual(fonts.map(font => font.label), ['預設', '思源黑體', '思源宋體', '霞鶩文楷', '芫荽', '粉圓', '昭源黑體', 'Open Sans', 'Source Code Pro']);
  // 收件人沒裝開源字型時要能退回系統字型，最後一定是通用字族。
  for (const font of fonts.slice(1)) assert.match(font.value, /,(sans-serif|serif|monospace)$/, font.label);
  // 「預設」只清掉字型，不動其他格式。
  assert.match(html, /font\.removeAttribute\('face'\);\n    if\(!font\.attributes\.length\)font\.replaceWith\(\.\.\.font\.childNodes\);/);
});

test('頭像與海報工具保留可回復，但進站不再預載或畫出這些前台內容', async () => {
  const html = await readFile(new URL('../../index.html', import.meta.url), 'utf8');
  const pick = name => html.match(new RegExp(`function ${name}\\([^)]*\\)\\{[\\s\\S]*?\\n\\}`))?.[0] || html.split('\n').find(line => line.startsWith(`function ${name}(`));
  const api = new Function(`${pick('imageUrl')}\n${pick('avatarImageUrl')}\nreturn { avatarImageUrl };`)();
  assert.equal(api.avatarImageUrl('https://lh3.googleusercontent.com/d/abc123=w1000'), 'https://lh3.googleusercontent.com/d/abc123=w256-rw');
  assert.equal(api.avatarImageUrl('https://drive.google.com/file/d/abc123/view'), 'https://lh3.googleusercontent.com/d/abc123=w256-rw');
  assert.equal(api.avatarImageUrl('https://ci3.googleusercontent.com/mail-sig/AIorK4zH'), 'https://ci3.googleusercontent.com/mail-sig/AIorK4zH=w256-rw');
  assert.equal(api.avatarImageUrl('https://ci3.googleusercontent.com/mail-sig/AIorK4zH=s512'), 'https://ci3.googleusercontent.com/mail-sig/AIorK4zH=w256-rw');
  assert.equal(api.avatarImageUrl('assets/designers/Anna-avatar.jpg'), 'assets/designers/Anna-avatar.jpg');
  assert.equal(api.avatarImageUrl(''), '');

  const head = html.slice(0, html.indexOf('</head>'));
  assert.doesNotMatch(head, /assets\/designers\/[^"']+-avatar\.jpg/);
  const renderStart = html.indexOf('function renderDesigners(){');
  const renderEnd = html.indexOf('let activeDesignerStoryPlayback=null;', renderStart);
  const renderSource = html.slice(renderStart, renderEnd);
  assert.match(renderSource, /class="office-embed"/);
  assert.doesNotMatch(renderSource, /poster-image|designer-avatar-image|avatar-frame/);
  assert.match(html, /function openDesignerPoster\(shell\)/, '原工具保留方便日後回復');
});

test('系統公告：最新的在最上面，v4.8 比 v4.72 新（版本號小數點後當小數比）', async () => {
  const { latestSystemAnnouncement, compareSystemAnnouncements, compareAnnouncementVersions } = await import('../../backend/schema.mjs');
  assert.ok(compareAnnouncementVersions('v4.8', 'v4.72') > 0);
  assert.ok(compareAnnouncementVersions('v4.72', 'v4.71') > 0);
  assert.ok(compareAnnouncementVersions('v5.0', 'v4.9') > 0);
  assert.equal(compareAnnouncementVersions('v4.7', 'v4.70'), 0);
  const rows = [
    { '公告版本': 'v4.7', '發布時間': '2026-08-20', '是否啟用': '啟用', '公告內容': 'a' },
    { '公告版本': 'v4.71', '發布時間': '2026-09-03', '是否啟用': '啟用', '公告內容': 'b' },
    { '公告版本': 'v4.72', '發布時間': '2026-09-10', '是否啟用': '啟用', '公告內容': 'c' },
    { '公告版本': 'v4.8', '發布時間': '2026-09-17', '是否啟用': '啟用', '公告內容': 'd' }
  ];
  assert.deepEqual([...rows].sort((a, b) => compareSystemAnnouncements(b, a)).map(row => row['公告版本']), ['v4.8', 'v4.72', 'v4.71', 'v4.7']);
  assert.equal(latestSystemAnnouncement({ tables: { '系統公告欄': { rows } } })['公告版本'], 'v4.8');
  // 日期格式不一致（斜線、未補零、含時間）也要能正確比較。
  assert.ok(compareSystemAnnouncements({ '發布時間': '2026/9/17 08:00' }, { '發布時間': '2026-09-10' }) > 0);

  // 前台與資料庫後台使用同一套規則。
  const index = await readFile(new URL('../../index.html', import.meta.url), 'utf8');
  const admin = await readFile(new URL('../../json_database_admin.html', import.meta.url), 'utf8');
  assert.match(index, /rows\.sort\(compareSystemAnnouncements\);/);
  assert.match(admin, /const sorted=\[\.\.\.rows\]\.sort\(\(left,right\)=>compareSystemAnnouncements\(right,left\)\);/);
  for (const html of [index, admin]) {
    const helpers = ['announcementDateKey', 'compareAnnouncementVersions', 'compareSystemAnnouncements']
      .map(name => html.split('\n').map(line => line.trim()).find(line => line.startsWith(`function ${name}(`)));
    assert.ok(helpers.every(Boolean));
    const compare = new Function(`${helpers.join('\n')}\nreturn compareSystemAnnouncements;`)();
    assert.deepEqual([...rows].sort((a, b) => compare(b, a)).map(row => row['公告版本']), ['v4.8', 'v4.72', 'v4.71', 'v4.7']);
  }
});

test('手機案件列表一次只沿一個方向捲動，按住拖曳只給滑鼠用', async () => {
  const html = await readFile(new URL('../../index.html', import.meta.url), 'utf8');
  assert.match(html, /if\(event\.pointerType!=='mouse'\|\|event\.button!==0\|\|event\.isPrimary===false/, '觸控不觸發拖曳捲動');
  assert.match(html, /@media \(hover:none\) and \(pointer:coarse\)\{\n      #casesSection \.case-table-wrap\{touch-action:pan-y\}/);
  assert.match(html, /initCaseTableDragScroll\(\); initCaseTableTouchAxisLock\(\);/);
  assert.match(html, /if\(axis!=='x'\)return;\n    if\(event\.cancelable\)event\.preventDefault\(\);/, '橫向時擋掉瀏覽器捲動，直向完全交給瀏覽器');
  // 登入後顯示時間軸時，左右捲動的是外層 .case-split；每次觸碰都要找出實際能左右捲的那一層。
  assert.match(html, /const horizontalScroller=\(\)=>\[wrap,wrap\.closest\('\.case-split'\)\]\.find\(el=>el&&el\.scrollWidth>el\.clientWidth\+1\)\|\|null;/);
  assert.match(html, /scroller\.scrollLeft=startLeft-dx;/);
  assert.doesNotMatch(html.match(/function initCaseTableTouchAxisLock\(\)\{[\s\S]*?\n\}/)[0], /wrap\.scrollLeft/);
  const decide = new Function(`${html.match(/function caseTableAxisLockDecision\(dx,dy\)\{[\s\S]*?\n\}/)[0]}\nreturn caseTableAxisLockDecision;`)();
  assert.equal(decide(-30, 4), 'x');
  assert.equal(decide(5, -30), 'y');
  assert.equal(decide(10, 10), 'y', '剛好斜 45 度交給瀏覽器上下捲動');
  assert.equal(decide(0, 0), '');
});

test('修改需求信寫入修改紀錄時保留文字超連結，並排除「--」之後的簽名檔（案件 26090053）', async () => {
  const html = await readFile(new URL('../../index.html', import.meta.url), 'utf8');
  const { TABLE_SCHEMAS } = await import('../../backend/schema.mjs');
  assert.ok(TABLE_SCHEMAS['修改統計表'].headers.includes('修改內容連結'));
  const pick = name => html.match(new RegExp(`function ${name}\\([^)]*\\)\\{[\\s\\S]*?\\n\\}`))?.[0];
  const api = new Function(`
    const safeHttpPreviewUrl = value => /^https?:\\/\\//i.test(String(value || '')) ? String(value) : '';
    ${pick('stripMailSignatureBlock')}
    ${pick('parseModificationLinks')}
    return { stripMailSignatureBlock, parseModificationLinks };
  `)();
  const recorded = '客戶選擇教師節B款影片，詳細請看：調整需求。再麻煩協助調整了，謝謝！\n\n--\n​Best regards,\nLivia\n--\n\nLivia Chu';
  assert.equal(api.stripMailSignatureBlock(recorded), '客戶選擇教師節B款影片，詳細請看：調整需求。再麻煩協助調整了，謝謝！');
  assert.equal(api.stripMailSignatureBlock('只有內容'), '只有內容');
  assert.equal(api.stripMailSignatureBlock('--\n整封都是簽名'), '--\n整封都是簽名', '前面沒有內容就不截斷');
  assert.equal(api.stripMailSignatureBlock('A--B 不是分隔線'), 'A--B 不是分隔線');
  assert.deepEqual(api.parseModificationLinks('[{"text":"調整需求","url":"https://docs.google.com/x"},{"text":"x","url":"javascript:1"}]'), [{ text: '調整需求', url: 'https://docs.google.com/x' }]);
  assert.deepEqual(api.parseModificationLinks('壞掉的 JSON'), []);

  assert.match(html, /const modification=replyMode==='modification'\?modificationContentFromEditor\(editor\):\{content:'',links:\[\]\},modificationContent=modification\.content;/);
  assert.equal(html.match(/recordModificationFromReply\(id,row,modificationContent,modification\.links\)/g)?.length, 2, '立即寄出與排程寄出都要帶連結');
  assert.match(html, /links:parseModificationLinks\(record\['修改內容連結'\]\?\?record\.links\)/);
  assert.match(html, /\$\{linkifyPlainText\(record\.content\|\|\(record\.count<=0\?'初稿完成':'未填寫修改內容'\),record\.links\)\}/);
});

test('階段選單的 Ai判斷 只在有新製／再製時出現，選到後還原原本階段並開啟視窗', async () => {
  const html = await readFile(new URL('../../index.html', import.meta.url), 'utf8');
  const pick = name => html.match(new RegExp(`function ${name}\\([^)]*\\)\\{[\\s\\S]*?\\n\\}`))?.[0];
  const oneLine = prefix => html.split('\n').find(row => row.startsWith(prefix));
  const sources = [oneLine('const AI_STAGE_OPTION='), pick('addAiStageOption'), oneLine('function rememberStageValue('), pick('handleAiStageSelect')];
  assert.ok(sources.every(Boolean), 'could not locate the Ai判斷 helpers');
  const makeSelect = values => {
    const select = { dataset: {}, options: values.map(value => ({ value })), value: values[0] };
    select.append = option => select.options.push(option);
    return select;
  };
  const opened = [];
  const run = select => new Function('formEl', 'document', 'openAiStageModal', `${sources.join('\n')}\nreturn {addAiStageOption, rememberStageValue, handleAiStageSelect, AI_STAGE_OPTION};`)(
    { elements: { stage: select } }, { createElement: () => ({ value: '', textContent: '' }) }, () => opened.push(true)
  );

  const video = makeSelect(['提案', '拍攝', '後製']);
  run(video).addAiStageOption(video, ['提案', '拍攝', '後製']);
  assert.equal(video.options.some(option => option.value === '__ai_stage__'), false);

  const flat = makeSelect(['提案', '再製', '新製', '印刷']);
  const api = run(flat);
  api.addAiStageOption(flat, ['提案', '再製', '新製', '印刷']);
  assert.equal(flat.options.at(-1).value, api.AI_STAGE_OPTION);
  assert.equal(flat.options.at(-1).textContent, 'AI判斷(beta)');

  flat.value = '再製';
  assert.equal(api.handleAiStageSelect(), false, '一般階段照常處理');
  flat.value = api.AI_STAGE_OPTION;
  assert.equal(api.handleAiStageSelect(), true);
  assert.equal(flat.value, '再製', '選到 Ai判斷 後還原成原本的階段，不會送出觸發用的值');
  assert.equal(opened.length, 1);

  // 前台只帶 token 標頭，不送 cookie；未登入者用團隊密碼換 token。
  assert.match(html, /headers\.set\('X-EMC-Editor-Token',editorToken\)/);
  assert.match(html, /headers\.set\('X-EMC-Access',accessToken\)/);
  // 結果要顯示實際引擎：Gemini 為主（免費），OpenAI 為備援並附上退回原因。
  assert.match(html, /isGemini\?'Gemini（免費額度）':'OpenAI 備援（付費）'/);
  assert.match(html, /Gemini 無法使用，已改用 OpenAI：\$\{esc\(fallbackReason\)\}/);
  // 等待結果時輪播 submitQuotes 語錄，關窗或離開等待畫面就停止。
  assert.match(html, /AI 分析中，約需 20–60 秒…<\/div><div class="ai-stage-quote" data-ai-stage-quote aria-live="polite">\$\{esc\(randomSubmitQuote\(\)\)\}<\/div>/);
  assert.match(html, /function closeAiStageModal\(\)\{stopAiStageQuoteRotation\(\);/);
  // 開窗時鎖背景捲動、不綁點框外關閉。
  assert.match(html, /const SCROLL_LOCK_MODAL_IDS=\[[^\]]*'aiStageModal'\]/);
  assert.doesNotMatch(html, /target===modal\|\|target\.closest\('\[data-ai-stage-close\]'\)/);
  assert.match(html, /formEl\.elements\.stage\.addEventListener\('change',\(\)=>\{if\(handleAiStageSelect\(\)\)return; populateDetailsOptions\(''\)\}\);/);
});

test('信件編輯器快捷鍵在注音輸入法下也能用，超連結按鈕會保留選取範圍', async () => {
  const html = await readFile(new URL('../../index.html', import.meta.url), 'utf8');
  const source = html.match(/function richShortcutKey\(event\)\{[\s\S]*?\n\}/)?.[0];
  assert.ok(source);
  const key = new Function(`${source}\nreturn richShortcutKey;`)();
  assert.equal(key({ key: 'ㄎ', code: 'KeyK' }), 'k', '注音開著時 ⌘K 的 key 是「ㄎ」');
  assert.equal(key({ key: 'ㄖ', code: 'KeyB' }), 'b');
  assert.equal(key({ key: 'K', code: '' }), 'k');
  // 信件編輯器與設定頁編輯器都改用 richShortcutKey，不再只看 event.key。
  assert.equal(html.match(/const key=richShortcutKey\(event\);/g)?.length, 2);
  assert.doesNotMatch(html, /const key=event\.key\.toLowerCase\(\);/);
  // 按鈕：mousedown 先記住選取範圍；prompt 之後把原本的範圍放回去再建立連結（Safari 會清掉選取）。
  assert.match(html, /button\.addEventListener\('mousedown',event=>\{event\.preventDefault\(\);savedRichSelectionRange=captureCurrentRichSelection\(\)\}\);\n  button\.addEventListener\('click',\(\)=>insertRichLink\(button\.dataset\.richLinkFor\)\);/);
  assert.match(html, /if\(hasSelection\)\{restore\(\);document\.execCommand\('createLink',false,url\);return\}/);
});

test('新增案件信開啟後向 Worker 取即時客戶資料更新副本，但不覆蓋使用者手動改過的副本', async () => {
  const html = await readFile(new URL('../../index.html', import.meta.url), 'utf8');
  assert.match(html, /openPostSubmitQueueModal\(\);\n  refreshPostSubmitCcFromWorker\(queue\);\n\}/);
  assert.match(html, /sheetApi\('listCustomers',\{\}\)/);
  assert.match(html, /refreshCustomerDirectoryFromWorker\(\)\.then\(updated=>\{if\(updated&&!modal\.hidden&&modal\.dataset\.caseId===String\(id\)\)replaceDefaultCcIfUntouched\('gmailComposeCc',draft\.cc,mailDraft\(row\)\.cc\)\}\);/);
  const helper = html.match(/const ccEmailKey=[^\n]*\n/)[0] + html.match(/function replaceDefaultCcIfUntouched\(fieldId,previousCc,nextCc\)\{[\s\S]*?\n\}/)[0];
  const run = (current, previous, next) => new Function('current', `
    let field = [...current];
    const extractEmail = value => String(value || '').match(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\\.[A-Z]{2,}/i)?.[0] || '';
    const gmailRecipientEntries = () => field.map(full => ({ full }));
    const setGmailRecipientEntries = (_id, list) => { field = [...list]; };
    ${helper}
    replaceDefaultCcIfUntouched('gmailComposeCc', ${JSON.stringify(previous)}, ${JSON.stringify(next)});
    return field;
  `)(current);
  // 使用者沒動過（順序不同也算相同）→ 換成即時名單。
  assert.deepEqual(run(['b@x.com', 'a@x.com'], ['a@x.com', 'b@x.com'], ['A <a@x.com>', 'c@x.com']), ['A <a@x.com>', 'c@x.com']);
  // 使用者改過 → 保留。
  assert.deepEqual(run(['manual@x.com'], ['a@x.com'], ['c@x.com']), ['manual@x.com']);
});

test('收件人／副本的膠囊可以拖曳互換，副本可一鍵設為客戶別預設信箱', async () => {
  const html = await readFile(new URL('../../index.html', import.meta.url), 'utf8');
  assert.match(html, /draggable="true" data-recipient-chip="\$\{esc\(entry\.email\)\}" data-recipient-chip-field="\$\{esc\(fieldId\)\}"/);
  assert.match(html, /initGmailRecipientDragAndDrop\(\);/);
  const move = html.match(/function moveGmailRecipient\(fromField,toField,email,beforeEmail=''\)\{[\s\S]*?\n\}/)?.[0];
  assert.ok(move);
  const run = (state, from, to, email, before = '') => new Function('state', `
    const gmailRecipientEntries = id => state[id] || [];
    const setGmailRecipientEntries = (id, list) => { state[id] = list; };
    ${move}
    moveGmailRecipient(${JSON.stringify(from)}, ${JSON.stringify(to)}, ${JSON.stringify(email)}, ${JSON.stringify(before)});
    return Object.fromEntries(Object.entries(state).map(([key, list]) => [key, list.map(entry => entry.email)]));
  `)(state);
  const e = email => ({ email, full: email });
  // 副本 → 收件人
  assert.deepEqual(run({ to: [e('a')], cc: [e('b'), e('c')] }, 'cc', 'to', 'c'), { to: ['a', 'c'], cc: ['b'] });
  // 收件人 → 副本，插在指定的人前面
  assert.deepEqual(run({ to: [e('a')], cc: [e('b'), e('c')] }, 'to', 'cc', 'a', 'c'), { to: [], cc: ['b', 'a', 'c'] });
  // 同一欄調整順序
  assert.deepEqual(run({ cc: [e('b'), e('c'), e('d')] }, 'cc', 'cc', 'd', 'b'), { cc: ['d', 'b', 'c'] });
  // 對方欄位已經有這個人：只從原欄位拿掉，不重複
  assert.deepEqual(run({ to: [e('a')], cc: [e('a'), e('b')] }, 'cc', 'to', 'a'), { to: ['a'], cc: ['b'] });

  // 「設為預設」按鈕：寫入客戶設定的預設信箱，收件人若原本就在預設名單裡要保留。
  assert.match(html, /id="gmailComposeCcSaveDefault"[^>]*>設為預設<\/button>/);
  assert.match(html, /sheetApi\('saveCustomerSettings',\{customer:client,mails,editorToken:currentEditorToken\}\)/);
  assert.match(html, /const mails=\[\.\.\.cc,\.\.\.keptRecipients\];/);
  assert.match(html, /這封合併信件包含多個客戶別/);
  assert.match(html, /confirmText:'設為預設',cancelText:'取消',tone:'positive'/);
});

test('信件內文圖片比照 Gmail：一般 <img>、倒退鍵可刪、可拖曳到任意位置、點圖片調整大小，寄出大小與編輯器一致', async () => {
  const html = await readFile(new URL('../../index.html', import.meta.url), 'utf8');
  // 圖片上的小圖示（刪除鈕、拖曳把手、換行鈕、縮放把手）與不可編輯的外框全部移除。
  for (const legacy of ['gmail-inline-image-wrap', 'bindGmailInlineImageControls', 'gmail-inline-image-handle', 'gmail-inline-image-resize', 'gmail-inline-image-linebreak', 'gmail-inline-image-remove']) {
    assert.ok(!html.includes(legacy), `${legacy} 應該已移除`);
  }
  // 設計師回覆信的圖片區塊也要可編輯，倒退鍵才刪得掉。
  assert.doesNotMatch(html, /imagesRow\.id='gmailDesignerReplyImages';\n  imagesRow\.contentEditable='false';/);

  const pick = name => html.match(new RegExp(`function ${name}\\([^)]*\\)\\{[\\s\\S]*?\\n\\}`))?.[0];
  const sizes = html.match(/const GMAIL_IMAGE_SIZES=Object\.freeze\(\[[\s\S]*?\]\);/)?.[0];
  const api = new Function(`${sizes}\n${pick('setGmailEditorImageWidth')}\n${pick('gmailImageCurrentSizeKey')}\nreturn { setGmailEditorImageWidth, gmailImageCurrentSizeKey, GMAIL_IMAGE_SIZES };`)();
  const fakeImage = naturalWidth => {
    const attrs = {};
    return { naturalWidth, style: {}, dataset: {}, setAttribute: (k, v) => { attrs[k] = v; }, removeAttribute: k => { delete attrs[k]; }, attrs };
  };
  assert.deepEqual(api.GMAIL_IMAGE_SIZES.map(size => size.label), ['小', '中', '大', '最適大小', '原始大小']);
  const image = fakeImage(1200);
  api.setGmailEditorImageWidth(image, 320);
  assert.deepEqual(image.style, { width: '320px', maxWidth: '100%', height: 'auto' }, '尺寸直接寫在 <img>，寄出時原樣送出');
  assert.equal(image.attrs.width, '320');
  assert.equal(api.gmailImageCurrentSizeKey(image), 'medium');
  api.setGmailEditorImageWidth(image, 'fit');
  assert.equal(image.style.width, '100%');
  assert.equal(image.attrs.width, undefined);
  assert.equal(api.gmailImageCurrentSizeKey(image), 'fit');
  api.setGmailEditorImageWidth(image, 'original');
  assert.equal(image.style.width, '1200px');
  assert.equal(api.gmailImageCurrentSizeKey(image), 'original');

  // 寄出：只換 cid: 與清掉編輯器專用屬性，不再有外框尺寸轉換。
  const payload = pick('gmailEditorMailPayload');
  assert.match(payload, /image\.src=`cid:\$\{item\.contentId\}`;/);
  assert.match(payload, /if\(image\.style\.width\)\{image\.style\.maxWidth='100%';image\.style\.height='auto'\}/);
  // 點圖片會選取整張（倒退鍵可刪）並顯示尺寸選單；拖曳自己搬，不讓瀏覽器複製出第二張。
  assert.match(html, /const range=document\.createRange\(\);range\.selectNode\(image\);/);
  assert.match(pick('bindGmailInlineImageEditor'), /event\.preventDefault\(\);\n    hideGmailInlineImageDropCaret\(\);\n    const image=gmailInlineImageDragged\.image;/);
});

test('插入 NAS 路徑時，路徑上方多一行一般文字「NAS路徑」', async () => {
  const html = await readFile(new URL('../../index.html', import.meta.url), 'utf8');
  assert.match(html, /fragment\.append\(document\.createTextNode\('NAS路徑'\),document\.createElement\('br'\),bold\);/);
  assert.match(html, /const \{fragment,bold\}=nasPathInsertFragment\(path\);/);
  assert.match(html, /if\(nasPathNeedsLeadingBreak\(useRange\)\)fragment\.prepend\(document\.createElement\('br'\)\);/);
  // 沒有資料夾選擇器時的手動輸入也走同一支。
  assert.match(html, /insertNasPathIntoEditor\(editorId,path,rangeInEditor\?range:null\);/);
});

test('設計師回覆信的預設內文依項目細節：社群貼文／廣告素材…，優先用設計師自己提到該細節的範本', async () => {
  const html = await readFile(new URL('../../index.html', import.meta.url), 'utf8');
  const pick = name => html.match(new RegExp(`function ${name}\\([^)]*\\)\\{[\\s\\S]*?\\n\\}`))?.[0] || html.split('\n').find(line => line.startsWith(`function ${name}(`));
  const sources = ['splitWeightDetails', 'normalizeReplyTemplateSettings', 'defaultReplyTemplateContent', 'designerReplyDetailItems', 'designerReplyTemplateForCase'].map(pick);
  assert.ok(sources.every(Boolean), 'could not locate the reply template helpers');
  const build = profiles => new Function('profiles', `
    const designerProfile = name => profiles[name] || {};
    const REPLY_TEMPLATE_DETAILS_TOKEN = '{項目細節}';
    ${sources.join('\n')}
    return designerReplyTemplateForCase;
  `)(profiles);
  const machi = { replyTemplates: { '範本 1': '附上廣告素材，<br>再煩請查收，謝謝。', '範本 2': '附上社群貼文，<br>再煩請查收，謝謝。' }, replyTemplateDefault: '範本 2' };
  const template = build({ Machi: machi, Noise: {} });
  assert.equal(template({ designer: 'Machi', details: '廣告素材' }), '附上廣告素材，<br>再煩請查收，謝謝。', '廣告素材案件用廣告素材範本，不再固定用預設的社群貼文');
  assert.equal(template({ designer: 'Machi', details: '社群貼文, 急件' }), '附上社群貼文，<br>再煩請查收，謝謝。');
  assert.equal(template({ designer: 'Machi', details: '素材重置' }), '附上素材重置，\n再煩請查收，謝謝。', '範本沒提到的細節依此類推產生');
  assert.equal(template({ designer: 'Noise', details: '字幕字卡, 2D 動畫' }), '附上字幕字卡、2D 動畫，\n再煩請查收，謝謝。');
  assert.equal(template({ designer: 'Machi', details: '' }), '附上社群貼文，<br>再煩請查收，謝謝。', '沒有細節就用預設範本');
  assert.equal(template({ designer: 'Machi', details: '急件' }), '附上社群貼文，<br>再煩請查收，謝謝。');
});

test('個人設定每個區塊各自儲存；信件範本可插入 {收件人名}，套用時換成收件人名字', async () => {
  const html = await readFile(new URL('../../index.html', import.meta.url), 'utf8');
  for (const key of ['profile', 'templates', 'signatures', 'customers']) assert.match(html, new RegExp(`data-personal-save="${key}"`));
  assert.match(html, /id="personalSettingsCancel">關閉<\/button><\/div>/, '底部不再有「一起儲存」');
  const section = html.match(/async function savePersonalSettingsSection\(section\)\{[\s\S]*?\n\}/)?.[0];
  assert.ok(section);
  assert.match(section, /settings=\{displayName\};/);
  assert.match(section, /settings=\{replyTemplates:templateSettings\.templates,replyTemplateDefault:templateSettings\.defaultName\};/);
  assert.match(section, /settings=\{signaturePresets:signaturePresetSettings\.presets,signaturePresetDefault:signaturePresetSettings\.defaultName\};/);

  // 只有信件範本的工具列有「插入收件人名」，簽名檔沒有。
  assert.match(html, /\$\{richSettingsToolbarHtml\('signature-preset-toolbar',\{recipientName:true,details:true\}\)\}<div class="signature-preset-content" data-reply-template-content/);
  assert.match(html, /\$\{richSettingsToolbarHtml\('signature-preset-toolbar'\)\}/);
  const apply = html.match(/function applyTemplateRecipientName\(template,editorId\)\{[\s\S]*?\n\}/)?.[0];
  const run = (template, name) => new Function(`
    const REPLY_TEMPLATE_RECIPIENT_TOKEN = '{收件人名}';
    const templateRecipientFieldId = () => 'to';
    const gmailRecipientGreetingName = () => ${JSON.stringify(name)};
    const looksLikeSignatureHtml = value => /<[a-z][\\s\\S]*>/i.test(String(value || ''));
    const esc = value => String(value ?? '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
    ${apply}
    return applyTemplateRecipientName(${JSON.stringify(template)}, 'gmailThreadReplyEditor');
  `)();
  assert.equal(run('Hello {收件人名}，<br>貼文如下', '木少'), 'Hello 木少，<br>貼文如下');
  assert.equal(run('Hi {收件人名}，附上 {收件人名} 要的檔案', 'Livia'), 'Hi Livia，附上 Livia 要的檔案');
  assert.equal(run('Hello {收件人名}<br>', '<b>'), 'Hello &lt;b&gt;<br>', 'HTML 範本裡的名字要逃脫');
  assert.equal(run('沒有代號', 'X'), '沒有代號');
  // 範本自己放了 {收件人名}，就不再自動加「Hi ○○,」。
  assert.match(html, /if\(String\(template\|\|''\)\.includes\(REPLY_TEMPLATE_RECIPIENT_TOKEN\)\)greeting='';/);
});

test('同一封回信不能又排程又立即寄出，修改需求信也不會重複寫入修改紀錄（案件 26090052／26090053）', async () => {
  const html = await readFile(new URL('../../index.html', import.meta.url), 'utf8');

  // 1) 執行中鎖：真的執行 begin／end 兩個函式。
  const begin = html.match(/function beginGmailThreadReplyAction\(\)\{[\s\S]*?\n\}/)?.[0];
  const end = html.match(/function endGmailThreadReplyAction\(\)\{[\s\S]*?\n\}/)?.[0];
  assert.ok(begin && end, 'could not locate the reply action lock helpers');
  const harness = new Function('initial', `
    const buttons = { '#gmailThreadReplySend': { disabled: initial.send }, '#gmailThreadSchedule': { disabled: initial.schedule } };
    const $ = selector => buttons[selector] || null;
    const messages = [];
    const setSync = (message, isError) => messages.push([message, isError]);
    let gmailThreadReplyBusy = false, gmailThreadReplyButtonRestore = null;
    ${begin}
    ${end}
    return { buttons, messages, begin: beginGmailThreadReplyAction, end: endGmailThreadReplyAction, busy: () => gmailThreadReplyBusy };
  `);
  const lock = harness({ send: false, schedule: false });
  assert.equal(lock.begin(), true, '第一個動作拿得到鎖');
  assert.equal(lock.buttons['#gmailThreadReplySend'].disabled, true, '處理中「送出」要停用');
  assert.equal(lock.buttons['#gmailThreadSchedule'].disabled, true, '處理中「排程」也要停用');
  assert.equal(lock.begin(), false, '處理中不能再開始另一個寄送／排程');
  assert.match(lock.messages.at(-1)[0], /避免同一封信重複寄出/);
  lock.end();
  assert.equal(lock.busy(), false);
  assert.deepEqual([lock.buttons['#gmailThreadReplySend'].disabled, lock.buttons['#gmailThreadSchedule'].disabled], [false, false], '結束後還原成原本的狀態');
  assert.equal(lock.begin(), true, '釋放後可以再開始（例如排程失敗後重試）');
  // 原本就停用的按鈕（圖片上傳中、排程編輯模式）結束後不能被誤開。
  const preDisabled = harness({ send: true, schedule: false });
  preDisabled.begin(); preDisabled.end();
  assert.deepEqual([preDisabled.buttons['#gmailThreadReplySend'].disabled, preDisabled.buttons['#gmailThreadSchedule'].disabled], [true, false]);

  // 2) 立即送出與排程兩條路徑都要拿鎖、並在 finally 釋放；排程成功後要比照立即送出清空並收回視窗。
  const send = html.match(/async function sendGmailThreadReply\(\)\{[\s\S]*?\n\}/)?.[0];
  const schedule = html.match(/async function scheduleThreadReply\(scheduledAt\)\{[\s\S]*?\n\}/)?.[0];
  for (const [name, source] of Object.entries({ send, schedule })) {
    assert.ok(source, `could not locate ${name}`);
    assert.ok(source.indexOf('if(!beginGmailThreadReplyAction())return;') > 0, `${name} 要先拿鎖`);
    assert.ok(source.indexOf('if(!beginGmailThreadReplyAction())return;') < source.indexOf('try{'), `${name} 拿鎖要在 try 之前`);
    assert.match(source, /finally\{\n\s+endGmailThreadReplyAction\(\);/, `${name} 要在 finally 釋放鎖`);
  }
  const clearAt = schedule.indexOf("editor.innerHTML='';");
  assert.ok(clearAt > schedule.indexOf("await sheetApi('scheduleCaseReply'"), '排程建立成功之後才清空編輯器');
  assert.ok(clearAt < schedule.indexOf('setSync(`已排程於'));
  assert.match(schedule, /if\(replyMode==='designer'\|\|replyMode==='modification'\)closeGmailThreadModal\(\);/, '修改需求信與設計師回覆信排程後直接收回視窗');
  assert.match(schedule, /modal\.dataset\.replyMode='general'/);

  // 3) Worker 回報 deduplicated（同一份修改需求重複寫入）時，本機不能多加一筆紀錄。
  const fromReply = html.match(/async function recordModificationFromReply\([\s\S]*?\n\}/)?.[0];
  assert.ok(fromReply);
  const run = deduplicated => new Function('deduplicated', `
    const records = new Map([['26090053', [{ caseId: '26090053', count: 2 }]]]);
    const counts = new Map([['26090053', 2]]);
    const modificationRecords = records, modificationCounts = counts;
    const modificationRecordsFor = id => records.get(String(id)) || [];
    const modificationCount = id => counts.get(String(id)) || 0;
    const currentLoginOwnerName = () => 'PM', ownerDisplay = () => 'PM', todayInputValue = () => '2026-09-21', currentEditorToken = 't';
    const parseModificationLinks = () => [];
    const sheetApi = async () => ({ ok: true, count: 2, deduplicated, record: { '修改人': 'PM' } });
    const applyModificationStatusChange = () => {}, render = () => {}, refreshOpenRevisionModal = () => {}, refreshOpenCaseDetail = () => {}, setSync = () => {};
    ${fromReply}
    return recordModificationFromReply('26090053', { owner: 'PM' }, '客戶有想要微調').then(() => ({ rounds: records.get('26090053').length, count: counts.get('26090053') }));
  `)(deduplicated);
  assert.deepEqual(await run(true), { rounds: 1, count: 2 }, '重複寫入：不新增本機紀錄');
  assert.deepEqual(await run(undefined), { rounds: 2, count: 2 }, '一般新增照舊加入本機紀錄');
});

test('回信的 NAS 區塊：影片路徑要可編輯（不然整段選取連正文都刪不掉），「同上次路徑」要沿用案件全部資料夾與各自的關鍵字', async () => {
  const html = await readFile(new URL('../../index.html', import.meta.url), 'utf8');
  const pickerServer = await readFile(new URL('../../scripts/nas_folder_picker_server.mjs', import.meta.url), 'utf8');

  // ── 1. 影片路徑區塊不可以是 contenteditable=false ──
  // Chromium 對「選取範圍碰到唯讀區塊」的刪除會整個放棄：不只刪不掉那個區塊，連同一次選取裡的正文
  // 也刪不動（全選後按刪除完全沒反應）。圖片區塊與 NAS 路徑區塊已經因為同樣理由改成可編輯。
  assert.doesNotMatch(html, /videoPathsContainer\.contentEditable='false'/);
  assert.match(html, /videoPathsContainer\.id='gmailDesignerReplyVideoPaths';/);

  // 改成可編輯之後，自動填入不可以蓋掉使用者已經改過／刪掉的內容——實際執行這支函式驗證。
  const extSource = html.match(/const DESIGNER_REPLY_VIDEO_EXTENSIONS=\[[^\]]*\];\nfunction isDesignerReplyVideoFileName\(fileName\)\{[^\n]*\}\n/)?.[0];
  const stateSource = html.match(/const designerReplyVideoRenderedHtml=new WeakMap\(\);/)?.[0];
  const funcSource = html.match(/function applyDesignerReplyVideoPaths\(images\)\{[\s\S]*?\n\}\n/)?.[0];
  assert.ok(extSource && stateSource && funcSource, 'could not locate applyDesignerReplyVideoPaths and its state');

  const makeRunner = () => {
    // 這個假容器會真的維護 innerHTML，才能驗證「使用者改過就不覆蓋」的判斷。
    const container = {
      innerHTML: '', textContent: '', removed: false, dataset: { nasFileFolders: JSON.stringify({ 'a.mp4': 'A/B' }) },
      appendChild(node) { container.innerHTML += node.tag === '#text' ? node.textContent : `<${node.tag}>${node.textContent || ''}</${node.tag}>`; },
      remove() { container.removed = true; }
    };
    Object.defineProperty(container, 'textContent', {
      get: () => container.innerHTML.replace(/<[^>]*>/g, ''),
      set: value => { container.innerHTML = value; }
    });
    const nasContainer = { dataset: { nasFolders: JSON.stringify(['A/B']) } };
    const fakeDocument = {
      getElementById: id => (id === 'gmailDesignerReplyVideoPaths' ? container : id === 'gmailDesignerReplyNasPaths' ? nasContainer : null),
      createElement: tag => ({ tag, textContent: '' }),
      createTextNode: text => ({ tag: '#text', textContent: text })
    };
    const fn = new Function('document', 'WeakMap', `${extSource}\n${stateSource}\n${funcSource}\nreturn applyDesignerReplyVideoPaths;`)(fakeDocument, WeakMap);
    return { container, fn };
  };

  // 第一次自動填入（空白、沒動過）→ 正常寫入。
  const first = makeRunner();
  first.fn([{ fileName: 'a.mp4' }]);
  assert.match(first.container.innerHTML, /A\/B\/a\.mp4/);
  // 沒動過 → 第二次自動填入照樣更新（備份完成後拿到更完整的清單）。
  first.container.dataset.nasFileFolders = JSON.stringify({ 'a.mp4': 'A/B', 'b.mp4': 'A/B' });
  first.fn([{ fileName: 'a.mp4' }, { fileName: 'b.mp4' }]);
  assert.match(first.container.innerHTML, /A\/B\/b\.mp4/);
  // 使用者改過 → 之後的自動填入完全不動它。
  const edited = makeRunner();
  edited.fn([{ fileName: 'a.mp4' }]);
  edited.container.innerHTML = '<b>我自己改過的說明</b>';
  edited.fn([{ fileName: 'a.mp4' }]);
  assert.equal(edited.container.innerHTML, '<b>我自己改過的說明</b>', '自動填入不可以蓋掉使用者的修改');
  // 使用者刪光 → 不可以又把內容救回來。
  const cleared = makeRunner();
  cleared.fn([{ fileName: 'a.mp4' }]);
  cleared.container.innerHTML = '';
  cleared.fn([{ fileName: 'a.mp4' }]);
  assert.equal(cleared.container.innerHTML, '', '使用者刪掉之後不可以被自動填入救回來');

  // ── 2.「同上次路徑」沿用案件全部資料夾 ──
  const listSource = html.match(/function caseNasFolderList\(row\)\{[\s\S]*?\n\}/)?.[0];
  assert.ok(listSource, 'could not locate caseNasFolderList');
  const caseNasFolderList = new Function(`${listSource}\nreturn caseNasFolderList;`)();
  assert.deepEqual(caseNasFolderList({ designImageFolders: [{ path: 'A/1', keyword: 'K1' }, { path: 'A/2', keyword: 'K2' }] }),
    [{ path: 'A/1', keyword: 'K1' }, { path: 'A/2', keyword: 'K2' }], '新版清單優先，兩組都要帶');
  assert.deepEqual(caseNasFolderList({ designImageFolderUrl: 'Old/Path', designImageFolderKeyword: 'OK' }),
    [{ path: 'Old/Path', keyword: 'OK' }], '只有舊欄位時包成一筆（既有單一資料夾案件不受影響）');
  assert.deepEqual(caseNasFolderList({}), []);
  assert.deepEqual(caseNasFolderList({ designImageFolders: [{ path: '', keyword: 'X' }], designImageFolderUrl: 'Fallback' }),
    [{ path: 'Fallback', keyword: '' }], '清單裡沒有合法路徑時退回舊欄位');

  // URL 要把完整清單帶過去（舊版選擇器看不懂 folders，仍靠 path/keyword 沿用第一組，不會壞掉）。
  const urlSource = html.match(/function nasFolderPickerPopupUrl\(\{[\s\S]*?\n?return url\}/)?.[0];
  assert.ok(urlSource, 'could not locate nasFolderPickerPopupUrl');
  assert.match(urlSource, /folders=''/);
  assert.match(urlSource, /if\(folders\)url\.searchParams\.set\('folders',folders\)/);
  const reuseLine = html.split('\n').find(line => line.includes('function reuseLastNasFolder'));
  assert.ok(reuseLine, 'could not locate reuseLastNasFolder');
  assert.match(reuseLine, /return url\}|nasFolderPickerPopupUrl\(/, 'reuseLastNasFolder 應維持單行寫法，方便逐行斷言');
  assert.match(reuseLine, /const reuseFolders=caseNasFolderList\(row\)/);
  assert.match(reuseLine, /folders:JSON\.stringify\(reuseFolders\)/, '沿用時要把完整清單帶給選擇器');
  assert.match(reuseLine, /path:reuseFolders\[0\]\.path,keyword:reuseFolders\[0\]\.keyword\|\|''/, '仍保留第一組給舊版選擇器相容');
  assert.doesNotMatch(reuseLine, /path:row\.designImageFolderUrl/, '不可以再只帶舊的單一欄位');

  // 選擇器頁面 reuse 模式要解析 folders 並整份送出。
  assert.match(pickerServer, /JSON\.parse\(params\.get\('folders'\) \|\| '\[\]'\)/);
  assert.match(pickerServer, /if\(reuseFolders\.length > 1\)\{\n\s+selectedFolders = reuseFolders\.map/);
  assert.match(pickerServer, /const singlePath = \(params\.get\('path'\) \|\| ''\)\.trim\(\);/, '沒帶 folders 的舊版主頁面仍走原本單一路徑');
});

test('信件範本可插入 {項目細節}：套用時換成案件的項目細節（不含急件），設為預設就直接帶進回信內文', async () => {
  const html = await readFile(new URL('../../index.html', import.meta.url), 'utf8');

  // ── 快速按鈕：只有信件範本的工具列有，簽名檔沒有 ──
  const toolbar = html.match(/function richSettingsToolbarHtml\(extraClass='',\{recipientName=false,details=false\}=\{\}\)\{[\s\S]*?\n\}/)?.[0];
  assert.ok(toolbar, 'could not locate richSettingsToolbarHtml');
  assert.match(toolbar, /data-rich-details/);
  assert.match(toolbar, /插入項目細節/);
  assert.match(toolbar, /\+\(details\?/, '這顆按鈕要由 details 選項控制，不是所有工具列都有');
  assert.match(html, /\$\{richSettingsToolbarHtml\('signature-preset-toolbar',\{recipientName:true,details:true\}\)\}<div class="signature-preset-content" data-reply-template-content/);
  assert.match(html, /\$\{richSettingsToolbarHtml\('signature-preset-toolbar'\)\}/, '簽名檔那一列不帶任何代號按鈕');

  // 兩顆代號按鈕共用同一段插入邏輯，各自插自己的代號。
  const bind = html.match(/function bindRichSettingsEditor\(list,contentSelector\)\{[\s\S]*?\n\}\n/)?.[0] || html;
  assert.match(bind, /const tokenButton=event\.target\.closest\('\[data-rich-recipient-name\]'\)\|\|event\.target\.closest\('\[data-rich-details\]'\);/);
  assert.match(bind, /tokenButton\.hasAttribute\('data-rich-details'\)\?REPLY_TEMPLATE_DETAILS_TOKEN:REPLY_TEMPLATE_RECIPIENT_TOKEN/);

  // ── 代號解析：真的執行 applyTemplateDetails ──
  const pick = name => html.match(new RegExp(`function ${name}\\([^)]*\\)\\{[\\s\\S]*?\\n\\}`))?.[0]
    || html.split('\n').find(line => line.startsWith(`function ${name}(`));
  const applySource = pick('applyTemplateDetails');
  const itemsSource = pick('designerReplyDetailItems');
  const splitSource = pick('splitWeightDetails');
  assert.ok(applySource && itemsSource && splitSource, 'could not locate applyTemplateDetails and its helpers');
  const resolve = (template, details) => new Function('details', `
    const esc = value => String(value ?? '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
    const looksLikeSignatureHtml = value => /<[a-z][\\s\\S]*>/i.test(String(value || ''));
    const REPLY_TEMPLATE_DETAILS_TOKEN = '{項目細節}';
    const currentGmailEditorCaseRow = () => ({ details });
    ${splitSource}
    ${itemsSource}
    ${applySource}
    return applyTemplateDetails(${JSON.stringify(template)}, 'gmailThreadReplyEditor');
  `)(details);
  assert.equal(resolve('附上{項目細節}，再煩請查收。', '社群貼文'), '附上社群貼文，再煩請查收。');
  assert.equal(resolve('附上{項目細節}，再煩請查收。', '社群貼文, 急件'), '附上社群貼文，再煩請查收。', '「急件」是急迫程度不是細節，一律略過');
  assert.equal(resolve('附上{項目細節}，再煩請查收。', '廣告素材、2D 動畫'), '附上廣告素材、2D 動畫，再煩請查收。', '多個細節用「、」串起來');
  assert.equal(resolve('附上{項目細節}，再煩請查收。', '急件'), '附上，再煩請查收。');
  assert.equal(resolve('附上{項目細節}，再煩請查收。', ''), '附上，再煩請查收。', '沒填細節換成空字串，不可以把代號原樣寄出去');
  assert.equal(resolve('附上{項目細節}，<br>查收', '<b>x</b>'), '附上&lt;b&gt;x&lt;/b&gt;，<br>查收', 'HTML 範本裡的細節要逃脫');
  assert.equal(resolve('完全沒有代號', '社群貼文'), '完全沒有代號');
  assert.equal(resolve('{項目細節}與{項目細節}', '社群貼文'), '社群貼文與社群貼文', '同一個代號出現多次都要換');

  // ── 兩條套用路徑都要換代號（自動帶入預設範本、手動插入範本）──
  assert.match(html, /function applyTemplateTokens\(template,editorId\)\{return applyTemplateDetails\(applyTemplateRecipientName\(template,editorId\),editorId\)\}/);
  const setContent = html.match(/function setGmailEditorTemplateContent\(editor,greeting,template\)\{[\s\S]*?\n\}/)?.[0];
  assert.match(setContent, /const body=applyTemplateTokens\(template,editor\.id\);/, '自動帶入預設範本時就要換好，使用者不必再手動插入');
  const insert = html.match(/function insertTemplateIntoRichEditor\(editorId,content\)\{[\s\S]*?\n\}/)?.[0];
  assert.match(insert, /const value=applyTemplateTokens\(content,editorId\);/);

  // ── 設為「預設」且含代號的範本，回信時直接勝出 ──
  const sources = ['splitWeightDetails', 'normalizeReplyTemplateSettings', 'defaultReplyTemplateContent', 'designerReplyDetailItems', 'designerReplyTemplateForCase'].map(pick);
  assert.ok(sources.every(Boolean), 'could not locate the reply template helpers');
  const chooseTemplate = profiles => new Function('profiles', `
    const designerProfile = name => profiles[name] || {};
    const REPLY_TEMPLATE_DETAILS_TOKEN = '{項目細節}';
    ${sources.join('\n')}
    return designerReplyTemplateForCase;
  `)(profiles);
  const withToken = chooseTemplate({ Machi: {
    replyTemplates: { '範本 1': '附上廣告素材，<br>再煩請查收，謝謝。', '範本 2': '嗨，這次附上{項目細節}，<br>再麻煩確認，謝謝！' },
    replyTemplateDefault: '範本 2'
  } });
  const tokenTemplate = '嗨，這次附上{項目細節}，<br>再麻煩確認，謝謝！';
  assert.equal(withToken({ designer: 'Machi', details: '社群貼文' }), tokenTemplate, '含代號的預設範本本來就會自己帶入細節，不要再退回自動產生的內容');
  assert.equal(withToken({ designer: 'Machi', details: '廣告素材' }), tokenTemplate, '預設範本排最前面，含代號時一律勝出');
  assert.equal(withToken({ designer: 'Machi', details: '' }), tokenTemplate, '沒填細節也照樣用預設範本（代號會被換成空字串）');

  // 沒有人用代號時，維持原本「挑提到該細節的範本，都沒有就自動產生」的行為。
  const withoutToken = chooseTemplate({ Machi: {
    replyTemplates: { '範本 1': '附上廣告素材，<br>再煩請查收，謝謝。', '範本 2': '附上社群貼文，<br>再煩請查收，謝謝。' },
    replyTemplateDefault: '範本 2'
  } });
  assert.equal(withoutToken({ designer: 'Machi', details: '廣告素材' }), '附上廣告素材，<br>再煩請查收，謝謝。');
  assert.equal(withoutToken({ designer: 'Machi', details: '素材重置' }), '附上素材重置，\n再煩請查收，謝謝。');
});

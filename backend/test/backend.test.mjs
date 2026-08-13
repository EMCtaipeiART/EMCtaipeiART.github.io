import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { JsonDatabase } from '../json_database.mjs';
import { emptyDatabase, normalizeDatabaseShape } from '../schema.mjs';
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

test('front end initializes weight rules before normalizing cached database rows', async () => {
  const html = await readFile(new URL('../../index.html', import.meta.url), 'utf8');
  assert.ok(
    html.indexOf('let activeWeightRules=[];') < html.indexOf("let rows = (sanitizedCachedRows?.length"),
    'activeWeightRules must be initialized before normalizeRow reads cached rows'
  );
});

test('front end does not roll back newly written rows when a stale JSON refresh arrives', async () => {
  const html = await readFile(new URL('../../index.html', import.meta.url), 'utf8');
  assert.match(html, /incomingRevision<cachedRevision/);
  assert.match(html, /localWriteConfirmedGraceMs\s*=\s*2\*60\*1000/);
  assert.match(html, /confirmedAt:0/);
  assert.match(html, /previous\?\.changes.*\.\.\.changes/);
  assert.match(html, /now-entry\.confirmedAt>=localWriteConfirmedGraceMs/);
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
  assert.match(html, /const supplementShortBaseUrl = 'https:\/\/emctaipeiart\.github\.io'/);
  assert.match(html, /function supplementShortUrl\(row,key\)/);
  assert.match(html, /supplementShortUrl\(row,'briefUrl'\)/);
  assert.match(html, /\.\.\.supplementWriteMetadata\(createRow\)/);
  assert.match(html, /supplementBaseUrl:supplementShortBaseUrl/);
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

test('front-end action API reads and atomically writes all requested JSON tables', async t => {
  const app = await fixture();
  t.after(() => app.close());

  const created = await api(app.baseUrl, 'add', {
    requestId: 'test-create-1',
    supplementBaseUrl: 'https://emctaipeiart.github.io',
    row: {
      client: '測試客戶', project: 'JSON 後台串接', owner: 'Machi', type: '平面', stage: '後製', qty: 2,
      start: '2026-08-07', end: '2026-08-08', designer: 'Machi', status: '未開始', details: '社群貼文',
      briefUrl: 'https://example.com/brief'
    }
  });
  assert.equal(created.ok, true);
  assert.match(created.row.id, /^\d{8}$/);
  assert.equal(created.row.weight, '2');
  assert.equal(created.row.briefUrl, `https://emctaipeiart.github.io/a/${created.row.id}`);

  const duplicate = await api(app.baseUrl, 'add', { requestId: 'test-create-1', row: { project: '不應重複' } });
  assert.equal(duplicate.deduplicated, true);
  assert.equal(duplicate.row.id, created.row.id);

  const supplement = app.database.table('補充資料連結').rows[0];
  assert.equal(supplement['案件編號'], created.row.id);
  assert.equal(supplement.A, 'https://example.com/brief');

  const list = await api(app.baseUrl, 'list', { year: '2026' });
  assert.equal(list.rows.length, 1);
  assert.equal(list.rows[0].project, 'JSON 後台串接');

  const short = await api(app.baseUrl, 'createShortLink', { url: 'https://example.com/long/path' });
  assert.match(short.code, /^[23456789A-HJ-NP-Za-km-z]{6}$/);
  const resolved = await api(app.baseUrl, 'resolveShortLink', { code: short.code });
  assert.equal(resolved.url, 'https://example.com/long/path');

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
  assert.equal(persisted.tables['短連結'].rows.length, 1);
  assert.equal(persisted.tables['修改統計表'].rows.length, 1);
  assert.equal(persisted.tables['補充資料連結'].rows.length, 1);
  assert.equal(persisted.tables['設定'].rows.length, 1);
  assert.equal(persisted.tables.reels.rows.length, 1);
  assert.equal(persisted.tables.bug_report.rows.length, 1);
});

test('JSON database admin renders actions first and updates JSON optimistically', async () => {
  const html = await readFile(new URL('../../json_database_admin.html', import.meta.url), 'utf8');
  const front = await readFile(new URL('../../index.html', import.meta.url), 'utf8');
  assert.match(html, /const TABLE_LABELS=\{database:'資料庫','帳號權限':'帳號設定','加權計分標準':'加權設定','角色權限範本':'權限設定',bug_report:'問題回報'\};/);
  assert.match(html, /function tableLabel\(name\)\{return TABLE_LABELS\[name\]\|\|name\}/);
  // reels 不再列進側邊選單，改由「帳號設定」的 REELS 小卡直接編輯／刪除
  assert.doesNotMatch(html, /const TABLE_ORDER=\[[^\]]*'reels'/);
  assert.match(html, /data-account-reel-edit=/);
  assert.match(html, /data-account-reel-delete=/);
  assert.match(html, /function databaseTableHtml\(table,data\)\{/);
  assert.match(html, /async function refreshWorkerDatabase\(\).*action:'refreshDatabase'/);
  assert.match(html, /async function start\(\).*await refreshWorkerDatabase\(\);await loadMetadata\(\)/);
  assert.match(html, /class="database-link"[^>]+aria-label="開啟連結">\.\.\.<\/a>/);
  assert.match(html, /database-details[^}]+width:150px/);
  assert.match(html, /database-supplement-note[^}]+width:132px/);
  assert.match(html, /database-link-column[^}]+width:66px/);
  assert.match(html, /\.database-link\{[^}]*color:var\(--ink\)/);
  assert.match(html, /\.action-col\{position:sticky!important;left:0/);
  assert.match(html, /const DATABASE_FILE_URL=new URL\('backend\/data\/db\.json',location\.href\)\.href/);
  assert.doesNotMatch(html, /DATABASE_CONTENTS_API|api\.github\.com\/repos\/EMCtaipeiART/);
  assert.match(html, /function spreadsheetBackupOptions\(name=tableName\)/);
  assert.match(html, /backupToSpreadsheet=name==='database'/);
  assert.match(html, /skipSpreadsheetBackup:!backupToSpreadsheet/);
  assert.match(html, /已先更新畫面，JSON 背景寫入中/);
  assert.match(html, /已先從畫面移除，JSON 背景刪除中/);
  assert.match(html, /const TABLE_ORDER=\['database','加權計分標準','短連結','補充資料連結','修改統計表'/);
  assert.match(html, /function shortLinkTableHtml\(data\)/);
  assert.match(html, /function supplementCardsHtml\(rows\)/);
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
  assert.match(html, /data-account-delete/);
  assert.match(html, /function organizationManagerHtml\(\)/);
  assert.match(html, /adminOrganizationOptionSave/);
  assert.match(html, /adminOrganizationOptionDelete/);
  assert.match(html, /data-password-configured/);
  assert.match(html, /此帳號尚未建立可用的登入密碼/);
  // 頭像大圖／分享音樂改用 accountLinkField：單行輸入框＋截斷顯示的連結，完整網址留在 href/title
  assert.match(html, /accountLinkField\('頭像大圖連結'/);
  assert.match(html, /function accountLinkField\(label,header,value\)\{/);
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
    settings: { displayName: 'Machi JSON', avatar: 'https://example.com/new-avatar.jpg', theme: 'dark', collapseSettings: { recent: true } }
  });
  assert.equal(saved.settings.displayName, 'Machi JSON');
  assert.equal(saved.settings.avatar, 'https://example.com/new-avatar.jpg');
  assert.equal(saved.settings.theme, 'dark');

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
  assert.deepEqual(Object.keys(metadata.data.tables), ['database', '加權計分標準', '短連結', '修改統計表', '補充資料連結', '設定', '帳號權限', '組織選項', '角色權限範本', 'reels', 'bug_report', '平面新開專案', '影音新開專案']);

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
      poster: `https://drive.google.com/thumbnail?id=${posterId}&sz=w1000`
    }]
  });
  assert.equal(replaced.ok, true);
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

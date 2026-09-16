import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import {
  WATCHER_LABEL,
  PICKER_LABEL,
  WATCHER_INTERVAL_SECONDS,
  buildLaunchdPlist,
  buildWatcherConfig,
  crontabHasWatcher,
  normalizeSecrets,
  resolveNodePath,
  secretsSearchPaths
} from '../../scripts/nas_watcher_installer.mjs';

test('the installer finds node wherever designers actually have it', () => {
  const present = new Set(['/opt/homebrew/bin/node']);
  const exists = candidate => present.has(candidate);
  assert.equal(resolveNodePath(['/usr/local/bin/node', '/opt/homebrew/bin/node'], exists), '/opt/homebrew/bin/node');
  assert.equal(resolveNodePath(['/usr/local/bin/node'], exists), '', '找不到就回傳空字串，讓安裝程式引導對方安裝 Node');
  assert.equal(resolveNodePath(['', null, '/opt/homebrew/bin/node'], exists), '/opt/homebrew/bin/node');
});

test('the upload key is read from the shared NAS folder, and a key file without serviceKey is rejected', () => {
  const paths = secretsSearchPaths('/Volumes/設計部');
  assert.deepEqual(paths, [
    '/Volumes/設計部/設計管理/NAS自動備份安裝/secrets.json',
    '/Volumes/設計部/設計管理/NAS自動備份安裝/nas_design_image_watcher.secrets.json'
  ]);
  assert.deepEqual(normalizeSecrets({ serviceKey: ' abc ', pickerToken: ' tok ' }), { serviceKey: 'abc', pickerToken: 'tok' });
  assert.deepEqual(normalizeSecrets({ serviceKey: 'abc' }), { serviceKey: 'abc', pickerToken: '' });
  assert.throws(() => normalizeSecrets({ pickerToken: 'tok' }), /serviceKey/);
});

test('each machine keeps its own mount path, state and previews, and shares everything else with the repo settings', () => {
  const template = {
    smbUrl: 'smb://EMCNAS_Prod.local/設計部',
    expectedVolumeName: '設計部',
    mountRoot: '/Volumes/設計部',
    dbJsonUrl: 'https://emctaipeiart.github.io/backend/data/db.json',
    appsScriptUploadUrl: 'https://script.google.com/macros/s/AAA/exec',
    maxDimension: 1600,
    stateFile: './nas_design_image_watcher.state/sync-state.json',
    previewDir: './nas_design_image_watcher.state/previews',
    secretsFile: './nas_design_image_watcher.secrets.json'
  };
  const config = buildWatcherConfig(template, { mountRoot: '/Volumes/設計部-1' });
  assert.equal(config.mountRoot, '/Volumes/設計部-1', '重複掛載產生的 -1 路徑要照實寫入');
  assert.equal(config.stateFile, './state/sync-state.json');
  assert.equal(config.previewDir, './state/previews');
  assert.equal(config.secretsFile, './secrets.json');
  assert.equal(config.dbJsonUrl, template.dbJsonUrl, '共用欄位沿用倉庫設定');
  assert.equal(config.appsScriptUploadUrl, template.appsScriptUploadUrl);
  assert.equal(config.maxDimension, 1600);
});

test('the watcher runs on a timer and the folder picker stays alive', () => {
  const watcher = buildLaunchdPlist({
    label: WATCHER_LABEL,
    nodePath: '/usr/local/bin/node',
    scriptPath: '/Users/designer/app/scripts/nas_design_image_watcher.mjs',
    workingDirectory: '/Users/designer/app',
    logPath: '/Users/designer/Library/Logs/machi-nas-watcher.log',
    startIntervalSeconds: WATCHER_INTERVAL_SECONDS
  });
  assert.match(watcher, /<key>Label<\/key>\n  <string>com\.emctaipei\.nas-watcher<\/string>/);
  assert.match(watcher, /<key>StartInterval<\/key>\n  <integer>60<\/integer>/);
  assert.match(watcher, /<key>RunAtLoad<\/key>\n  <true\/>/, '開機後要自己啟動');
  assert.doesNotMatch(watcher, /KeepAlive/, '掃描程式是跑完就結束，不能設成常駐重啟');

  const picker = buildLaunchdPlist({
    label: PICKER_LABEL,
    nodePath: '/usr/local/bin/node',
    scriptPath: '/Users/designer/app/scripts/nas_folder_picker_server.mjs',
    workingDirectory: '/Users/designer/app',
    logPath: '/Users/designer/Library/Logs/machi-nas-folder-picker.log',
    keepAlive: true
  });
  assert.match(picker, /<key>KeepAlive<\/key>\n  <true\/>/, '選擇器是伺服器，被關掉要自動拉回來');
  assert.doesNotMatch(picker, /StartInterval/);
});

test('an old crontab schedule on the same machine is detected so it can be removed', () => {
  assert.equal(crontabHasWatcher('* * * * * cd "/Users/x" && node scripts/nas_design_image_watcher.mjs >> log 2>&1'), true);
  assert.equal(crontabHasWatcher('0 9 * * * /usr/bin/say hello'), false);
  assert.equal(crontabHasWatcher(''), false);
});

test('the double-clickable installer downloads what it needs, guides Node installation and keeps the window open', async () => {
  const boot = await readFile(new URL('../../scripts/install_nas_watcher.command', import.meta.url), 'utf8');
  for (const name of ['nas_watcher_installer.mjs', 'nas_design_image_lib.mjs', 'nas_design_image_watcher.mjs', 'nas_folder_picker_server.mjs', 'nas_design_image_watcher.config.json']) {
    assert.ok(boot.includes(name), `安裝程式要下載 ${name}`);
  }
  assert.match(boot, /\/usr\/local\/bin\/node \/opt\/homebrew\/bin\/node/, '兩種常見的 Node 安裝位置都要找');
  assert.match(boot, /nodejs\.org/, '沒有 Node 時要帶對方去下載頁');
  assert.match(boot, /read -n 1 -s/, '視窗要停住，設計師才看得到結果');
  assert.match(boot, /--install-dir/);

  const uninstall = await readFile(new URL('../../scripts/uninstall_nas_watcher.command', import.meta.url), 'utf8');
  for (const label of ['com.emctaipei.nas-watcher', 'com.emctaipei.nas-folder-picker']) {
    assert.ok(uninstall.includes(label), `移除程式要停用 ${label}`);
  }
  assert.match(uninstall, /不會刪掉 NAS 或雲端上任何圖片/);
});

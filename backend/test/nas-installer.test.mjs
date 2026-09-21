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
  const installDir = '/Users/designer/Library/Application Support/MachiNasWatcher';
  const config = buildWatcherConfig(template, { mountRoot: '/Volumes/設計部-1', installDir });
  assert.equal(config.mountRoot, '/Volumes/設計部-1', '重複掛載產生的 -1 路徑要照實寫入');
  // 一律絕對路徑：設定檔在 scripts/ 底下，相對路徑很容易跟實際寫檔位置對不起來。
  assert.equal(config.stateFile, `${installDir}/state/sync-state.json`);
  assert.equal(config.previewDir, `${installDir}/state/previews`);
  assert.equal(config.secretsFile, `${installDir}/secrets.json`);
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

test('the installer writes the key where the generated config actually looks for it', async () => {
  const path = (await import('node:path')).default;
  const { buildWatcherConfig, staleSecretsPaths } = await import('../../scripts/nas_watcher_installer.mjs');
  const { resolvePath } = await import('../../scripts/nas_design_image_lib.mjs');
  const installDir = '/Users/designer/Library/Application Support/MachiNasWatcher';
  const scriptsDir = path.join(installDir, 'scripts');
  const config = buildWatcherConfig({ mountRoot: '/Volumes/設計部', expectedVolumeName: '設計部' }, { mountRoot: '/Volumes/設計部', installDir });

  // 設定檔放在 scripts/ 底下，相對路徑會以那一層為基準；2026-09-16 設計師電腦就是因此讀不到金鑰，
  // 選擇器自己另外產生一把 token（前台對不上）、監控程式也因為沒有 serviceKey 完全不上傳。
  assert.equal(resolvePath(scriptsDir, config.secretsFile), path.join(installDir, 'secrets.json'));
  assert.equal(resolvePath(scriptsDir, config.stateFile), path.join(installDir, 'state', 'sync-state.json'));
  assert.equal(resolvePath(scriptsDir, config.previewDir), path.join(installDir, 'state', 'previews'));
  for (const value of [config.secretsFile, config.stateFile, config.previewDir]) {
    assert.ok(path.isAbsolute(value), `${value} 應該是絕對路徑，避免相對基準不一致`);
  }

  const installer = await readFile(new URL('../../scripts/nas_watcher_installer.mjs', import.meta.url), 'utf8');
  assert.match(installer, /const secretsPath = path\.join\(installDir, 'secrets\.json'\);/, '金鑰要寫在設定檔指向的位置');
  assert.deepEqual(staleSecretsPaths(installDir), [
    path.join(installDir, 'scripts', 'secrets.json'),
    path.join(installDir, 'scripts', 'nas_design_image_watcher.secrets.json')
  ]);
  assert.match(installer, /if \(!existing\?\.serviceKey\) await fs\.rm\(stale, \{ force: true \}\);/, '舊版留下、只有 pickerToken 的檔案要清掉');
});

test('a missing NAS mount is reported in plain language and retried, instead of surfacing ENOENT', async () => {
  const { mkdtemp, rm } = await import('node:fs/promises');
  const { tmpdir } = await import('node:os');
  const path = (await import('node:path')).default;
  const { resolveMountRoot, requestMount } = await import('../../scripts/nas_design_image_lib.mjs');
  const dir = await mkdtemp(path.join(tmpdir(), 'nas-mount-'));
  try {
    assert.equal(await resolveMountRoot({ mountRoot: dir, expectedVolumeName: '設計部' }), dir, '設定的路徑存在就直接用');
    assert.equal(await resolveMountRoot({ mountRoot: path.join(dir, 'gone'), expectedVolumeName: '不存在的磁碟名稱' }), '', '都找不到時回空字串，讓呼叫端顯示提示');
    assert.equal(await resolveMountRoot({}), '');
  } finally {
    await rm(dir, { recursive: true, force: true });
  }

  // 沒掛載時請 Finder 連線，但不可以每次請求都觸發。
  const calls = [];
  const run = (command, args) => calls.push({ command, args });
  const now = Date.now() + 10 * 60 * 1000;
  assert.equal(requestMount({ smbUrl: 'smb://EMCNAS_Prod.local/設計部' }, { now, run }), true);
  assert.deepEqual(calls[0], { command: 'open', args: ['smb://EMCNAS_Prod.local/設計部'] });
  assert.equal(requestMount({ smbUrl: 'smb://EMCNAS_Prod.local/設計部' }, { now: now + 1000, run }), false, '一分鐘內不重複觸發');
  assert.equal(requestMount({ smbUrl: 'smb://EMCNAS_Prod.local/設計部' }, { now: now + 61000, run }), true);
  assert.equal(requestMount({}, { now: now + 200000, run }), false, '沒有 smbUrl 就不做事');

  const picker = await readFile(new URL('../../scripts/nas_folder_picker_server.mjs', import.meta.url), 'utf8');
  assert.match(picker, /const mountMissingMessage = `NAS 尚未掛載/);
  assert.equal((picker.match(/if \(!\(await ensureMountRoot\(\)\)\) \{/g) || []).length, 3, '瀏覽資料夾、預設路徑、確認備份三個入口都要先確認掛載');
  assert.match(picker, /const mountRootExists = Boolean\(await ensureMountRoot\(\)\);/);
  assert.match(picker, /TOKEN_ERROR_MESSAGE = '缺少或錯誤的 token。如果這是你自己電腦上的選擇器，請重跑/);
  assert.doesNotMatch(picker, /message: '缺少或錯誤的 token' \}/, 'token 錯誤一律用含排除方式的訊息');

  const watcher = await readFile(new URL('../../scripts/nas_design_image_watcher.mjs', import.meta.url), 'utf8');
  assert.match(watcher, /const mountRoot = await lib\.resolveMountRoot\(config\);/);
  assert.doesNotMatch(watcher, /lib\.requestMount\(config\)/, '排程每分鐘都是新行程，記憶體節流擋不住，不可以再直接呼叫 requestMount');
  assert.match(watcher, /lib\.connectNasAndWait\(config, \{ stateFile: mountAttemptFile \}\)/);
  assert.match(watcher, /這一輪先跳過/);
});

test('NAS 沒連上時排程不會每分鐘跳連線視窗：先探測、有間隔紀錄、連上才開始爬', async () => {
  const { mkdtemp, rm, readFile, access } = await import('node:fs/promises');
  const { tmpdir } = await import('node:os');
  const path = (await import('node:path')).default;
  const lib = await import('../../scripts/nas_design_image_lib.mjs');

  assert.equal(lib.nasHostFromSmbUrl('smb://EMCNAS_Prod.local/設計部'), 'EMCNAS_Prod.local');
  assert.equal(lib.nasHostFromSmbUrl('smb://machi.chen@10.0.0.5:445/share'), '10.0.0.5');
  assert.equal(lib.nasHostFromSmbUrl(''), '');
  assert.equal(lib.nasPortFromSmbUrl('smb://machi.chen@10.0.0.5:4445/share'), 4445);
  assert.equal(lib.nasPortFromSmbUrl('smb://EMCNAS_Prod.local/設計部'), 445);
  assert.deepEqual([0, 1, 2, 3, 4, 5, 9].map(lib.mountRetryDelayMs), [0, 5, 10, 20, 40, 60, 60].map(m => m * 60000));

  const dir = await mkdtemp(path.join(tmpdir(), 'nas-connect-'));
  const stateFile = path.join(dir, 'mount-attempt.json');
  const volume = path.join(dir, 'vol');
  const { mkdir } = await import('node:fs/promises');
  const config = { smbUrl: 'smb://EMCNAS_Prod.local/設計部', expectedVolumeName: '不存在的磁碟名稱', mountRoot: volume };
  const opens = [];
  const run = (command, args) => opens.push([command, ...args]);
  const sleep = async () => {};
  const t0 = 1_800_000_000_000;
  try {
    // 1. NAS 連不上（網路還沒好）：完全不開視窗、不留嘗試紀錄
    let result = await lib.connectNasAndWait(config, { stateFile, now: t0, probe: async () => false, run, sleep });
    assert.deepEqual(result, { mountRoot: '', reason: 'unreachable' });
    assert.equal(opens.length, 0);
    await assert.rejects(access(stateFile), '連不上時不記錄嘗試');

    // 2. 連得上但一直沒掛載：開一次視窗、等到逾時，記一次失敗
    result = await lib.connectNasAndWait(config, { stateFile, now: t0, probe: async () => true, run, sleep, waitMs: 6000, pollMs: 2000 });
    assert.deepEqual(result, { mountRoot: '', reason: 'timeout' });
    assert.deepEqual(opens, [['open', 'smb://EMCNAS_Prod.local/設計部']]);
    assert.equal(JSON.parse(await readFile(stateFile, 'utf8')).failures, 1);

    // 3. 每分鐘都會有一個「新行程」再來：間隔內（第一次失敗後 5 分鐘）不重複開視窗
    for (const minutes of [1, 2, 4]) {
      result = await lib.connectNasAndWait(config, { stateFile, now: t0 + minutes * 60000, probe: async () => true, run, sleep });
      assert.equal(result.reason, 'backoff', `${minutes} 分鐘後仍在間隔內`);
    }
    assert.equal(opens.length, 1, '間隔內只開過一次連線視窗');

    // 4. 間隔過後才再試，且失敗次數遞增、間隔拉長為 10 分鐘
    result = await lib.connectNasAndWait(config, { stateFile, now: t0 + 5 * 60000, probe: async () => true, run, sleep, waitMs: 0 });
    assert.equal(result.reason, 'timeout');
    assert.equal(opens.length, 2);
    assert.equal(JSON.parse(await readFile(stateFile, 'utf8')).failures, 2);
    result = await lib.connectNasAndWait(config, { stateFile, now: t0 + 14 * 60000, probe: async () => true, run, sleep });
    assert.equal(result.reason, 'backoff', '第二次失敗後要等 10 分鐘');

    // 5. 請 Finder 連線後在同一輪掛載成功：回傳掛載路徑（這一輪就能開始爬），並清掉失敗紀錄
    await mkdir(volume);
    const mountedLater = { ...config };
    let polls = 0;
    const sleepUntilMounted = async () => { polls += 1; };
    const okResult = await lib.connectNasAndWait(mountedLater, { stateFile, now: t0 + 20 * 60000, probe: async () => true, run, sleep: sleepUntilMounted });
    assert.deepEqual(okResult, { mountRoot: volume, reason: '' });
    await assert.rejects(access(stateFile), '成功後嘗試紀錄歸零');
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

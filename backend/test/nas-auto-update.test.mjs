import assert from 'node:assert/strict';
import http from 'node:http';
import test from 'node:test';
import path from 'node:path';
import { tmpdir } from 'node:os';
import { spawn, spawnSync } from 'node:child_process';
import { mkdtemp, mkdir, readFile, readdir, rm, writeFile, copyFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import * as update from '../../scripts/nas_watcher_update.mjs';
import * as publisher from '../../scripts/publish_nas_update.mjs';

const scriptsSrc = fileURLToPath(new URL('../../scripts/', import.meta.url));

/** 假的「GitHub raw」：files 是 { 檔名: 內容 }，可以隨時換內容模擬發布新版。 */
async function startFakeRaw(files) {
  const hits = [];
  const server = http.createServer((req, res) => {
    const name = decodeURIComponent(new URL(req.url, 'http://x').pathname.replace(/^\/scripts\//, ''));
    hits.push(name);
    if (!(name in files)) { res.writeHead(404); return res.end('nope'); }
    res.writeHead(200); res.end(files[name]);
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  return { files, hits, url: `http://127.0.0.1:${server.address().port}`, close: () => new Promise(resolve => server.close(resolve)) };
}

function release(files, version) {
  return JSON.stringify(update.buildManifest(files, { version }));
}

async function makeInstall(initialFiles, config = {}) {
  const installDir = await mkdtemp(path.join(tmpdir(), 'nas-update-'));
  const scriptsDir = path.join(installDir, 'scripts');
  await mkdir(scriptsDir, { recursive: true });
  await mkdir(path.join(installDir, 'state'), { recursive: true });
  for (const [name, content] of Object.entries(initialFiles)) await writeFile(path.join(scriptsDir, name), content);
  if (config !== null) await writeFile(path.join(scriptsDir, 'nas_design_image_watcher.config.json'), JSON.stringify(config));
  return { installDir, scriptsDir };
}

const V1 = {
  'nas_design_image_lib.mjs': 'export const v = 1;\n',
  'nas_design_image_watcher.mjs': 'console.log("WATCHER v1");\n',
  'nas_folder_picker_server.mjs': 'export const picker = 1;\n',
  'nas_watcher_installer.mjs': 'export const installer = 1;\n',
  'nas_design_image_watcher.config.json': JSON.stringify({ dbJsonUrl: 'https://x.test/db.json', maxDimension: 1600, mountRoot: '/Volumes/設計部', autoMountNas: true })
};
const V2 = { ...V1, 'nas_design_image_watcher.mjs': 'console.log("WATCHER v2");\n', 'nas_design_image_watcher.config.json': JSON.stringify({ dbJsonUrl: 'https://x.test/db2.json', maxDimension: 1200, mountRoot: '/Volumes/設計部', autoMountNas: true }) };

test('發布清單：只認名單內的檔案與 64 碼雜湊，設定檔範本合併時保留這台電腦自己的欄位', () => {
  const manifest = update.buildManifest({ 'nas_design_image_lib.mjs': 'a', 'nas_design_image_watcher.mjs': 'b' }, { version: '20260921-1000' });
  assert.equal(update.isValidManifest(manifest), true);
  assert.equal(update.isValidManifest({ ...manifest, version: '' }), false);
  assert.equal(update.isValidManifest({ version: 'x', files: {} }), false);
  assert.equal(update.isValidManifest({ version: 'x', files: { 'evil.sh': '0'.repeat(64) } }), false, '名單外的檔案一律拒絕，不能靠發布清單寫任意檔名');
  assert.equal(update.isValidManifest({ version: 'x', files: { 'nas_design_image_lib.mjs': 'abc' } }), false);
  assert.equal(update.isValidManifest({ version: 'x', files: { '../../etc/passwd': '0'.repeat(64) } }), false);

  const merged = update.mergeConfigTemplate(
    { dbJsonUrl: 'new-db', maxDimension: 1200, mountRoot: '/Volumes/設計部', stateFile: './x', autoMountNas: true },
    { dbJsonUrl: 'old-db', mountRoot: '/Volumes/設計部-1', stateFile: '/abs/state/sync-state.json', secretsFile: '/abs/secrets.json', previewDir: '/abs/previews', autoMountNas: false, autoUpdate: true }
  );
  assert.equal(merged.dbJsonUrl, 'new-db', '共用設定用新範本');
  assert.equal(merged.maxDimension, 1200);
  assert.equal(merged.mountRoot, '/Volumes/設計部-1');
  assert.equal(merged.stateFile, '/abs/state/sync-state.json');
  assert.equal(merged.autoMountNas, false, '這台電腦的手動連線模式不能被範本蓋回自動');
  assert.equal(merged.autoUpdate, true);
  assert.deepEqual(update.UPDATE_FILES.filter(name => update.BOOTSTRAP_FILES.includes(name)), [], '更新機制本身不在自動更新名單裡');
});

test('自動更新：新版本會下載、比對雜湊、備份舊版後替換，設定檔合併，之後沒有新版就不動', async () => {
  const raw = await startFakeRaw({ ...V2, 'nas_watcher_release.json': release(V2, 'r2') });
  const { installDir, scriptsDir } = await makeInstall(V1, JSON.parse(V1['nas_design_image_watcher.config.json']));
  await writeFile(path.join(scriptsDir, 'nas_watcher_release.json'), release(V1, 'r1'));
  const now = Date.now();
  let restarts = 0;
  try {
    const result = await update.checkAndApplyUpdate({ scriptsDir, baseUrl: raw.url, now, restartPicker: () => { restarts += 1; } });
    assert.equal(result.updated, true);
    assert.equal(result.from, 'r1');
    assert.equal(result.to, 'r2');
    assert.deepEqual(result.changedFiles.sort(), ['nas_design_image_watcher.config.json', 'nas_design_image_watcher.mjs']);
    assert.match(await readFile(path.join(scriptsDir, 'nas_design_image_watcher.mjs'), 'utf8'), /v2/);
    const config = JSON.parse(await readFile(path.join(scriptsDir, 'nas_design_image_watcher.config.json'), 'utf8'));
    assert.equal(config.dbJsonUrl, 'https://x.test/db2.json');
    assert.equal(config.maxDimension, 1200);
    assert.equal(JSON.parse(await readFile(path.join(scriptsDir, 'nas_watcher_release.json'), 'utf8')).version, 'r2');
    assert.match(await readFile(path.join(installDir, 'state', 'previous-release', 'nas_design_image_watcher.mjs'), 'utf8'), /v1/, '舊版有備份');
    assert.equal(restarts, 0, '選擇器檔案沒變就不重啟選擇器服務');

    // 10 分鐘內不會再連線；過了之後版本相同就什麼都不做。
    const hitsBefore = raw.hits.length;
    assert.equal((await update.checkAndApplyUpdate({ scriptsDir, baseUrl: raw.url, now: now + 60_000 })).reason, 'throttled');
    assert.equal(raw.hits.length, hitsBefore);
    assert.equal((await update.checkAndApplyUpdate({ scriptsDir, baseUrl: raw.url, now: now + 11 * 60_000 })).reason, 'current');

    // 選擇器檔案有變才重啟選擇器。
    raw.files['nas_folder_picker_server.mjs'] = 'export const picker = 2;\n';
    const V3 = { ...V2, 'nas_folder_picker_server.mjs': raw.files['nas_folder_picker_server.mjs'] };
    raw.files['nas_watcher_release.json'] = release(V3, 'r3');
    const third = await update.checkAndApplyUpdate({ scriptsDir, baseUrl: raw.url, now: now + 30 * 60_000, restartPicker: () => { restarts += 1; } });
    assert.deepEqual(third.changedFiles, ['nas_folder_picker_server.mjs']);
    assert.equal(restarts, 1);
  } finally {
    await raw.close();
    await rm(installDir, { recursive: true, force: true });
  }
});

test('自動更新：雜湊對不上（GitHub 快取還沒更新）、語法錯誤、網路失敗都完全不動現有檔案', async () => {
  const cases = {};
  const raw = await startFakeRaw({});
  const { installDir, scriptsDir } = await makeInstall(V1, JSON.parse(V1['nas_design_image_watcher.config.json']));
  await writeFile(path.join(scriptsDir, 'nas_watcher_release.json'), release(V1, 'r1'));
  const snapshot = async () => Object.fromEntries(await Promise.all((await readdir(scriptsDir)).sort().map(async name => [name, await readFile(path.join(scriptsDir, name), 'utf8')])));
  const before = await snapshot();
  const now = Date.now();
  try {
    // 網路失敗：發布清單抓不到 → 2 分鐘後就重試（不用等 10 分鐘）。
    cases.noManifest = await update.checkAndApplyUpdate({ scriptsDir, baseUrl: raw.url, now });
    assert.equal(cases.noManifest.reason, 'fetch-failed');
    assert.equal((await update.checkAndApplyUpdate({ scriptsDir, baseUrl: raw.url, now: now + 60_000 })).reason, 'throttled');

    // 雜湊對不上：清單說是 V2，但伺服器上的檔案還是舊內容。
    raw.files['nas_watcher_release.json'] = release(V2, 'r2');
    Object.assign(raw.files, V1);
    cases.mismatch = await update.checkAndApplyUpdate({ scriptsDir, baseUrl: raw.url, now: now + 3 * 60_000 });
    assert.equal(cases.mismatch.reason, 'hash-mismatch');
    assert.deepEqual(await snapshot(), before, '雜湊對不上時不能動任何檔案');

    // 語法錯誤：雜湊正確，但內容有語法錯誤 → 不套用，標記失敗，之後不再重複下載。
    const broken = { ...V2, 'nas_design_image_watcher.mjs': 'const = ;;; broken(\n' };
    Object.assign(raw.files, broken);
    raw.files['nas_watcher_release.json'] = release(broken, 'r-broken');
    cases.syntax = await update.checkAndApplyUpdate({ scriptsDir, baseUrl: raw.url, now: now + 6 * 60_000 });
    assert.equal(cases.syntax.reason, 'syntax-error');
    assert.equal(cases.syntax.file, 'nas_design_image_watcher.mjs');
    assert.deepEqual(await snapshot(), before);
    const hits = raw.hits.length;
    assert.equal((await update.checkAndApplyUpdate({ scriptsDir, baseUrl: raw.url, now: now + 20 * 60_000 })).reason, 'skipped-failed-version');
    assert.equal(raw.hits.length, hits + 1, '只再抓發布清單一次，不重複下載整包');

    // 發布了新的（修好的）版本就會恢復更新。
    Object.assign(raw.files, V2);
    raw.files['nas_watcher_release.json'] = release(V2, 'r-fixed');
    assert.equal((await update.checkAndApplyUpdate({ scriptsDir, baseUrl: raw.url, now: now + 40 * 60_000, restartPicker() {} })).reason, 'applied');
  } finally {
    await raw.close();
    await rm(installDir, { recursive: true, force: true });
  }
});

test('啟動器（真實行程）：有新版就先更新再執行新版爬蟲；沒開 autoUpdate 完全不連線；新版載入失敗自動還原上一版', async () => {
  const raw = await startFakeRaw({ ...V2, 'nas_watcher_release.json': release(V2, 'r2') });
  const config = { ...JSON.parse(V1['nas_design_image_watcher.config.json']), autoUpdate: true, updateBaseUrl: raw.url };
  const { installDir, scriptsDir } = await makeInstall(V1, config);
  await copyFile(path.join(scriptsSrc, 'nas_watcher_launcher.mjs'), path.join(scriptsDir, 'nas_watcher_launcher.mjs'));
  await copyFile(path.join(scriptsSrc, 'nas_watcher_update.mjs'), path.join(scriptsDir, 'nas_watcher_update.mjs'));
  await writeFile(path.join(scriptsDir, 'nas_watcher_release.json'), release(V1, 'r1'));
  // 必須用非同步 spawn：假的 GitHub 伺服器跑在這個測試行程裡，spawnSync 會卡住事件迴圈、伺服器就回不了話。
  const launch = () => new Promise(resolve => {
    const child = spawn(process.execPath, [path.join(scriptsDir, 'nas_watcher_launcher.mjs')], { cwd: installDir });
    let stdout = '', stderr = '';
    child.stdout.on('data', chunk => { stdout += chunk; });
    child.stderr.on('data', chunk => { stderr += chunk; });
    child.on('close', status => resolve({ status, stdout, stderr }));
  });
  try {
    // 沒開 autoUpdate（例如主機）：不連線、直接跑舊版。
    await writeFile(path.join(scriptsDir, 'nas_design_image_watcher.config.json'), JSON.stringify({ ...config, autoUpdate: false }));
    let run = await launch();
    assert.match(run.stdout, /WATCHER v1/);
    assert.equal(raw.hits.length, 0, '沒開自動更新就完全不連線');

    // 開了 autoUpdate：同一次執行先更新、再跑新版。
    await writeFile(path.join(scriptsDir, 'nas_design_image_watcher.config.json'), JSON.stringify(config));
    run = await launch();
    assert.match(run.stdout, /\[自動更新\] 已從 r1 更新到 r2/);
    assert.match(run.stdout, /WATCHER v2/);
    assert.equal(run.status, 0);
    // 更新後設定檔仍保留 autoUpdate 與更新網址（範本裡沒有這兩個欄位，靠合併保留）。
    const merged = JSON.parse(await readFile(path.join(scriptsDir, 'nas_design_image_watcher.config.json'), 'utf8'));
    assert.equal(merged.autoUpdate, true);
    assert.equal(merged.updateBaseUrl, raw.url, '這台電腦自訂的更新網址（範本沒有這個欄位）更新後要保留');

    // 發布一個「一載入就壞掉」的版本（語法正確但匯入不存在的檔案）→ 還原上一版，這個版本不再重試。
    await writeFile(path.join(scriptsDir, 'nas_design_image_watcher.config.json'), JSON.stringify({ ...JSON.parse(V2['nas_design_image_watcher.config.json']), autoUpdate: true, updateBaseUrl: raw.url }));
    const V3 = { ...V2, 'nas_design_image_watcher.mjs': 'import "./does-not-exist.mjs";\nconsole.log("WATCHER v3");\n' };
    Object.assign(raw.files, V3);
    raw.files['nas_watcher_release.json'] = release(V3, 'r3');
    await writeFile(path.join(installDir, 'state', 'update-check.json'), JSON.stringify({ nextCheckAt: 0 }));
    run = await launch();
    assert.notEqual(run.status, 0);
    assert.match(run.stderr, /新版 r3 載入失敗，已還原上一版/);
    assert.match(await readFile(path.join(scriptsDir, 'nas_design_image_watcher.mjs'), 'utf8'), /WATCHER v2/, '已還原成上一版');
    assert.equal(JSON.parse(await readFile(path.join(scriptsDir, 'nas_watcher_release.json'), 'utf8')).version, 'r2');

    // 下一輪：正常執行上一版，而且不會再去更新那個壞版本。
    await writeFile(path.join(installDir, 'state', 'update-check.json'), JSON.stringify({ ...JSON.parse(await readFile(path.join(installDir, 'state', 'update-check.json'), 'utf8')), nextCheckAt: 0 }));
    run = await launch();
    assert.match(run.stdout, /WATCHER v2/);
    assert.equal(run.status, 0);
    assert.doesNotMatch(run.stdout, /已從/);
  } finally {
    await raw.close();
    await rm(installDir, { recursive: true, force: true });
  }
});

test('發布版本號：台北時間 YYYYMMDD-HHmm，同一分鐘再發布加流水號', () => {
  assert.equal(publisher.taipeiStamp(new Date('2026-09-21T03:05:00Z')), '20260921-1105');
  assert.equal(publisher.taipeiStamp(new Date('2026-09-21T17:30:00Z')), '20260922-0130', '跨日用台北時間');
  const at = new Date('2026-09-21T03:05:30Z');
  assert.equal(publisher.nextVersion('', at), '20260921-1105');
  assert.equal(publisher.nextVersion('20260921-1000', at), '20260921-1105');
  assert.equal(publisher.nextVersion('20260921-1105', at), '20260921-1105-2');
  assert.equal(publisher.nextVersion('20260921-1105-2', at), '20260921-1105-3');
  assert.deepEqual(publisher.parseArgs(['--dry-run', '--skip-tests', '--branch', 'dev']), { dryRun: true, skipTests: true, repo: '', remote: 'origin', branch: 'dev' });
});

test('一鍵發布（真實 git）：沒 commit 的修改擋下、有變動才發布並 push、沒變動不發布、遠端有新提交會重新同步', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'nas-publish-'));
  const git = (cwd, ...args) => {
    const result = spawnSync('git', args, { cwd, encoding: 'utf8' });
    assert.equal(result.status, 0, `git ${args.join(' ')}\n${result.stderr}`);
    return result.stdout.trim();
  };
  const origin = path.join(root, 'origin.git');
  const work = path.join(root, 'work');
  const other = path.join(root, 'other');
  try {
    git(root, 'init', '--bare', '-b', 'main', origin);
    git(root, 'clone', origin, work);
    for (const dir of [work]) { git(dir, 'config', 'user.email', 't@test'); git(dir, 'config', 'user.name', 't'); }
    await mkdir(path.join(work, 'scripts'), { recursive: true });
    for (const name of [...update.UPDATE_FILES, ...update.BOOTSTRAP_FILES]) {
      await writeFile(path.join(work, 'scripts', name), name.endsWith('.json') ? '{"dbJsonUrl":"x"}\n' : `export const name = ${JSON.stringify(name)};\n`);
    }
    git(work, 'add', '.'); git(work, 'commit', '-m', 'init'); git(work, 'push', 'origin', 'main');
    const options = { repo: work, skipTests: true };

    // 已修改但沒 commit → 拒絕。
    await writeFile(path.join(work, 'scripts', 'nas_design_image_watcher.mjs'), 'export const changed = 1;\n');
    await assert.rejects(publisher.publish(options), /還有沒 commit 的修改/);
    git(work, 'add', '.'); git(work, 'commit', '-m', 'edit watcher');

    // 試跑：不寫檔、不 commit。
    const dry = await publisher.publish({ ...options, dryRun: true });
    assert.equal(dry.reason, 'dry-run');
    assert.deepEqual(dry.changed.sort(), [...update.UPDATE_FILES].sort(), '第一次發布：全部檔案都算新的');
    assert.equal(spawnSync('git', ['ls-files', 'scripts/nas_watcher_release.json'], { cwd: work, encoding: 'utf8' }).stdout.trim(), '');

    // 正式發布：清單進 git、已 push，且內容與檔案雜湊一致。
    const first = await publisher.publish(options);
    assert.equal(first.published, true);
    assert.equal(git(work, 'rev-parse', 'HEAD'), git(origin, 'rev-parse', 'main'), '已 push 到遠端');
    const manifest = JSON.parse(await readFile(path.join(work, 'scripts', 'nas_watcher_release.json'), 'utf8'));
    assert.equal(manifest.version, first.version);
    assert.equal(manifest.files['nas_design_image_watcher.mjs'], update.sha256(await readFile(path.join(work, 'scripts', 'nas_design_image_watcher.mjs'))));
    assert.equal(update.isValidManifest(manifest), true);
    assert.match(git(work, 'log', '-1', '--format=%s'), /^release: NAS 爬蟲更新 /);

    // 沒有變動 → 不發布。
    assert.deepEqual(await publisher.publish(options), { published: false, reason: 'no-change' });

    // 遠端在這段時間有別人（例如 Worker 自動 commit 資料）推了新提交：發布時要先同步再推，不能失敗。
    git(root, 'clone', origin, other);
    git(other, 'config', 'user.email', 'o@test'); git(other, 'config', 'user.name', 'o');
    await writeFile(path.join(other, 'data.json'), '{"n":1}\n');
    git(other, 'add', '.'); git(other, 'commit', '-m', 'data: auto'); git(other, 'push', 'origin', 'main');
    await writeFile(path.join(work, 'scripts', 'nas_design_image_lib.mjs'), 'export const lib = 2;\n');
    git(work, 'add', '.'); git(work, 'commit', '-m', 'edit lib');
    const second = await publisher.publish(options);
    assert.deepEqual(second.changed, ['nas_design_image_lib.mjs']);
    assert.equal(git(work, 'rev-parse', 'HEAD'), git(origin, 'rev-parse', 'main'));
    assert.equal(git(origin, 'ls-tree', '--name-only', 'main').includes('data.json'), true, '別人的提交還在');
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('安裝器與設定：launchd 執行啟動器、產生的設定開啟自動更新、安裝程式下載更新機制檔案', async () => {
  const installer = await import('../../scripts/nas_watcher_installer.mjs');
  const config = installer.buildWatcherConfig({ mountRoot: '/Volumes/設計部' }, { mountRoot: '/Volumes/設計部', installDir: '/Users/d/Library/Application Support/MachiNasWatcher' });
  assert.equal(config.autoUpdate, true);
  const source = await readFile(new URL('../../scripts/nas_watcher_installer.mjs', import.meta.url), 'utf8');
  assert.match(source, /scriptPath: path\.join\(scriptsDir, 'nas_watcher_launcher\.mjs'\)/, '排程執行啟動器，不是直接執行爬蟲');
  assert.match(source, /scriptPath: path\.join\(scriptsDir, 'nas_folder_picker_server\.mjs'\)/, '選擇器仍直接執行，更新後由更新程式重啟');
  const boot = await readFile(new URL('../../scripts/install_nas_watcher.command', import.meta.url), 'utf8');
  for (const name of [...update.BOOTSTRAP_FILES, 'nas_watcher_release.json', ...update.UPDATE_FILES]) assert.ok(boot.includes(name), `安裝程式要下載 ${name}`);
  const command = await readFile(new URL('../../scripts/publish_nas_update.command', import.meta.url), 'utf8');
  assert.match(command, /publish_nas_update\.mjs/);
  assert.match(command, /read -n 1 -s/, '視窗要停住，才看得到發布結果');
});

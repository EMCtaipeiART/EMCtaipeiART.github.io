#!/usr/bin/env node
/**
 * 「把這台 Mac 變成會自動備份 NAS 設計圖的電腦」一鍵安裝程式。
 *
 * 由 install_nas_watcher.command（放在 NAS 上，設計師點兩下就會跑）呼叫，做完這些事：
 *   1. 確認 NAS 已掛載，沒掛載就叫 Finder 開連線視窗並等待（帳號密碼仍要設計師自己輸入一次，
 *      這是 macOS 的限制，不會也不應該把密碼寫進腳本）。
 *   2. 從 NAS 上的安裝資料夾讀取上傳金鑰（serviceKey／pickerToken），寫進這台電腦自己的
 *      secrets 檔（權限 600）。
 *   3. 產生這台電腦專用的設定檔（mountRoot 自動偵測、狀態與預覽圖都放在安裝資料夾底下）。
 *   4. 安裝兩個 launchd 常駐工作：每分鐘掃描一次的監控程式，以及資料夾選擇器伺服器。
 *   5. 立刻跑一次掃描當作自我檢測，並印出結果與記錄檔位置。
 *
 * 重跑一次就是更新：會重新下載腳本、覆蓋設定、重新載入 launchd，不會重複安裝。
 * 本機同步狀態（sync-state.json）刻意保留，避免重跑後把已經備份過的圖重新判斷成新檔。
 */

import { promises as fs, existsSync, realpathSync } from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { spawn, spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

export const WATCHER_LABEL = 'com.emctaipei.nas-watcher';
export const PICKER_LABEL = 'com.emctaipei.nas-folder-picker';
export const WATCHER_INTERVAL_SECONDS = 60;
// NAS 上放安裝程式與金鑰的資料夾（相對於掛載根目錄）。
export const NAS_INSTALLER_DIR = ['設計管理', 'NAS自動備份安裝'];

/** node 可能裝在哪裡：官方安裝包、Homebrew（Intel／Apple Silicon）、或使用者自己的 PATH。 */
export function resolveNodePath(candidates, exists = existsSync) {
  for (const candidate of candidates) {
    if (candidate && exists(candidate)) return candidate;
  }
  return '';
}

export function secretsSearchPaths(mountRoot) {
  const base = path.join(mountRoot, ...NAS_INSTALLER_DIR);
  return [
    path.join(base, 'secrets.json'),
    path.join(base, 'nas_design_image_watcher.secrets.json')
  ];
}

/** NAS 上的金鑰檔可能是完整 secrets 格式，也可能只有 serviceKey；缺 serviceKey 就不能上傳，直接擋下。 */
export function normalizeSecrets(raw) {
  const serviceKey = String(raw?.serviceKey || raw?.nasWatcherApiKey || '').trim();
  const pickerToken = String(raw?.pickerToken || '').trim();
  if (!serviceKey) throw new Error('NAS 上的金鑰檔沒有 serviceKey，請聯絡管理者確認');
  return { serviceKey, pickerToken };
}

/**
 * 這台電腦專用的設定：沿用倉庫設定檔的共用欄位（資料庫網址、上傳網址、壓縮參數…），
 * 只換掉跟這台機器有關的幾項。狀態與預覽圖放在安裝資料夾底下，重灌或移除時一起帶走。
 */
export function buildWatcherConfig(template, { mountRoot, installDir }) {
  // 一律寫絕對路徑：設定檔放在 <安裝資料夾>/scripts 底下，相對路徑會以那一層為基準，
  // 很容易跟安裝程式實際寫檔的位置對不起來——2026-09-16 設計師電腦就是這樣讀不到金鑰，
  // 選擇器因此自己另外產生一把 token（前台對不上）、監控程式也因為沒有 serviceKey 而完全不上傳。
  return {
    ...template,
    mountRoot,
    stateFile: path.join(installDir, 'state', 'sync-state.json'),
    previewDir: path.join(installDir, 'state', 'previews'),
    secretsFile: path.join(installDir, 'secrets.json')
  };
}

/** 先前版本把金鑰寫錯位置，選擇器會在 scripts 底下自動產生一個只有 pickerToken 的檔案；留著會混淆，清掉。 */
export function staleSecretsPaths(installDir) {
  return [
    path.join(installDir, 'scripts', 'secrets.json'),
    path.join(installDir, 'scripts', 'nas_design_image_watcher.secrets.json')
  ];
}

export function buildLaunchdPlist({ label, nodePath, scriptPath, workingDirectory, logPath, startIntervalSeconds = 0, keepAlive = false }) {
  const schedule = keepAlive
    ? '  <key>KeepAlive</key>\n  <true/>'
    : `  <key>StartInterval</key>\n  <integer>${Math.max(1, Math.trunc(startIntervalSeconds))}</integer>`;
  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN"
  "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key>
  <string>${label}</string>
  <key>ProgramArguments</key>
  <array>
    <string>${nodePath}</string>
    <string>${scriptPath}</string>
  </array>
  <key>WorkingDirectory</key>
  <string>${workingDirectory}</string>
  <key>RunAtLoad</key>
  <true/>
${schedule}
  <key>StandardOutPath</key>
  <string>${logPath}</string>
  <key>StandardErrorPath</key>
  <string>${logPath}</string>
</dict>
</plist>
`;
}

/** 同一台電腦如果還留著舊的 crontab 排程（第一台 iMac 的裝法），會跟 launchd 重複跑，先提醒。 */
export function crontabHasWatcher(crontabText) {
  return /nas_design_image_watcher\.mjs/.test(String(crontabText || ''));
}

function log(message = '') { console.log(message); }

function parseArgs(argv) {
  // --dry-run：產生設定檔與 plist 內容、但不載入背景工作、也不跑掃描。給管理者在自己機器上
  // 驗證安裝流程用，不會動到這台電腦既有的排程。
  const args = { installDir: '', nodePath: process.execPath, dryRun: false };
  for (let i = 0; i < argv.length; i += 1) {
    if (argv[i] === '--install-dir') args.installDir = argv[i + 1] || '';
    if (argv[i] === '--node') args.nodePath = argv[i + 1] || process.execPath;
    if (argv[i] === '--dry-run') args.dryRun = true;
  }
  if (!args.installDir) args.installDir = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
  return args;
}

function sleep(ms) { return new Promise(resolve => setTimeout(resolve, ms)); }

async function directoryExists(target) {
  try { return (await fs.stat(target)).isDirectory(); } catch { return false; }
}

/** 掛載中的分享；macOS 重複掛載會加上「-1」後綴，所以同時找一下有編號的版本。 */
async function findMountedVolume(expectedName) {
  const direct = path.join('/Volumes', expectedName);
  if (await directoryExists(direct)) return direct;
  let entries = [];
  try { entries = await fs.readdir('/Volumes'); } catch { entries = []; }
  const suffixed = entries.filter(name => name.startsWith(`${expectedName}-`)).sort();
  for (const name of suffixed) {
    const candidate = path.join('/Volumes', name);
    if (await directoryExists(candidate)) return candidate;
  }
  return '';
}

async function ensureMounted(config) {
  const expectedName = String(config.expectedVolumeName || '設計部');
  const existing = await findMountedVolume(expectedName);
  if (existing) return existing;
  log(`NAS 還沒掛載，正在開啟連線視窗：${config.smbUrl}`);
  log('（如果跳出帳號密碼視窗，請輸入你的 NAS 帳號密碼，並勾選「記住這個密碼」）');
  spawnSync('open', [String(config.smbUrl || '')]);
  for (let waited = 0; waited < 120; waited += 2) {
    await sleep(2000);
    const mounted = await findMountedVolume(expectedName);
    if (mounted) return mounted;
  }
  throw new Error(`等了兩分鐘還是沒看到「${expectedName}」被掛載，請先在 Finder 連上 NAS 後再執行一次`);
}

async function readSecretsFromNas(mountRoot) {
  for (const candidate of secretsSearchPaths(mountRoot)) {
    try {
      const raw = JSON.parse(await fs.readFile(candidate, 'utf8'));
      return { secrets: normalizeSecrets(raw), source: candidate };
    } catch (error) {
      if (error?.code !== 'ENOENT') throw new Error(`讀取金鑰檔失敗（${candidate}）：${error.message}`);
    }
  }
  throw new Error(`NAS 上找不到金鑰檔，預期位置：${secretsSearchPaths(mountRoot).join('、')}`);
}

function launchctl(args) {
  return spawnSync('launchctl', args, { encoding: 'utf8' });
}

async function installAgent({ label, plist, homeDir, dryRun = false }) {
  const plistPath = path.join(homeDir, 'Library', 'LaunchAgents', `${label}.plist`);
  if (dryRun) return `${plistPath}（試跑，未實際寫入或載入）`;
  await fs.mkdir(path.dirname(plistPath), { recursive: true });
  await fs.writeFile(plistPath, plist, 'utf8');
  const target = `gui/${process.getuid()}`;
  launchctl(['bootout', `${target}/${label}`]);
  const result = launchctl(['bootstrap', target, plistPath]);
  if (result.status !== 0) {
    const legacy = launchctl(['load', '-w', plistPath]);
    if (legacy.status !== 0) throw new Error(`載入背景工作 ${label} 失敗：${(result.stderr || legacy.stderr || '').trim()}`);
  }
  return plistPath;
}

async function main() {
  const { installDir, nodePath, dryRun } = parseArgs(process.argv.slice(2));
  const scriptsDir = path.join(installDir, 'scripts');
  const homeDir = os.homedir();
  const logDir = path.join(homeDir, 'Library', 'Logs');

  log(dryRun ? '=== NAS 設計圖自動備份：安裝試跑（不會改動背景工作） ===' : '=== NAS 設計圖自動備份：安裝／更新 ===');
  log(`安裝位置：${installDir}`);
  log(`Node：${nodePath}`);
  log('');

  const template = JSON.parse(await fs.readFile(path.join(scriptsDir, 'nas_design_image_watcher.config.json'), 'utf8'));
  const mountRoot = await ensureMounted(template);
  log(`NAS 已掛載：${mountRoot}`);

  const { secrets, source } = await readSecretsFromNas(mountRoot);
  log(`已從 NAS 讀到上傳金鑰：${source}`);

  await fs.mkdir(path.join(installDir, 'state'), { recursive: true });
  await fs.mkdir(logDir, { recursive: true });
  const configPath = path.join(scriptsDir, 'nas_design_image_watcher.config.json');
  await fs.writeFile(configPath, `${JSON.stringify(buildWatcherConfig(template, { mountRoot, installDir }), null, 2)}\n`, 'utf8');
  const secretsPath = path.join(installDir, 'secrets.json');
  await fs.writeFile(secretsPath, `${JSON.stringify(secrets, null, 2)}\n`, 'utf8');
  await fs.chmod(secretsPath, 0o600);
  for (const stale of staleSecretsPaths(installDir)) {
    try {
      const existing = JSON.parse(await fs.readFile(stale, 'utf8'));
      if (!existing?.serviceKey) await fs.rm(stale, { force: true });
    } catch { /* 沒有這個檔案就不用清 */ }
  }
  log('設定檔與金鑰已寫入這台電腦（金鑰檔只有你自己讀得到）');

  const crontab = spawnSync('crontab', ['-l'], { encoding: 'utf8' }).stdout || '';
  if (crontabHasWatcher(crontab)) {
    log('');
    log('[提醒] 這台電腦的 crontab 還有舊的監控排程，會跟這次安裝的背景工作重複執行。');
    log('       請用 crontab -e 把那一行刪掉（只影響這台電腦）。');
  }

  const watcherLog = path.join(logDir, 'machi-nas-watcher.log');
  const pickerLog = path.join(logDir, 'machi-nas-folder-picker.log');
  await installAgent({
    label: WATCHER_LABEL,
    homeDir,
    dryRun,
    plist: buildLaunchdPlist({
      label: WATCHER_LABEL,
      nodePath,
      scriptPath: path.join(scriptsDir, 'nas_design_image_watcher.mjs'),
      workingDirectory: installDir,
      logPath: watcherLog,
      startIntervalSeconds: WATCHER_INTERVAL_SECONDS
    })
  });
  await installAgent({
    label: PICKER_LABEL,
    homeDir,
    dryRun,
    plist: buildLaunchdPlist({
      label: PICKER_LABEL,
      nodePath,
      scriptPath: path.join(scriptsDir, 'nas_folder_picker_server.mjs'),
      workingDirectory: installDir,
      logPath: pickerLog,
      keepAlive: true
    })
  });
  log(dryRun ? '（試跑）背景工作設定內容已產生，未載入' : '背景工作已安裝：每分鐘自動掃描一次，開機後會自己啟動');

  if (dryRun) {
    log('');
    log('✅ 試跑完成：掛載、金鑰、設定檔都正常，實際安裝時會再載入背景工作並跑一次掃描。');
    return;
  }

  log('');
  log('--- 立刻跑一次掃描確認可以運作 ---');
  const check = spawn(nodePath, [path.join(scriptsDir, 'nas_design_image_watcher.mjs')], { cwd: installDir, stdio: 'inherit' });
  const code = await new Promise(resolve => check.on('close', resolve));
  log('');
  if (code === 0) {
    log('✅ 安裝完成，這台電腦已經會自動備份 NAS 設計圖了。');
  } else {
    log('⚠️ 安裝完成，但剛剛那次掃描沒有正常結束，請把上面的訊息截圖給管理者。');
  }
  log(`記錄檔：${watcherLog}`);
  log('要停用時，執行 NAS 安裝資料夾裡的「移除NAS自動備份.command」。');
}

/** 被直接執行（不是被 import 進測試）時才跑安裝。macOS 的 /var 是 /private/var 的符號連結，
 * 兩邊都取實際路徑再比對，否則從暫存目錄執行時會誤判成「被 import」而什麼都不做。 */
function runningAsScript() {
  const entry = process.argv[1];
  if (!entry) return false;
  const real = target => { try { return realpathSync(target); } catch { return path.resolve(target); } };
  return real(fileURLToPath(import.meta.url)) === real(entry);
}

if (runningAsScript()) {
  main().catch(error => {
    console.error('');
    console.error(`❌ 安裝失敗：${error.message}`);
    process.exitCode = 1;
  });
}

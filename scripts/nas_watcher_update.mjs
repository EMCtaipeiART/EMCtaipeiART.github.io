/**
 * NAS 爬蟲的「自動更新」——設計師電腦不必每次改版都重新執行安裝器。
 *
 * 流程：管理者（Machi）雙擊 publish_nas_update.command → 跑測試、算出每個檔案的 sha256、寫進發布清單
 * scripts/nas_watcher_release.json、commit＋push。每台設計師電腦上的啟動器（nas_watcher_launcher.mjs，
 * launchd 每分鐘執行）每 10 分鐘讀一次 GitHub 上的發布清單；版本不同就照清單下載每個檔案、比對雜湊、
 * 驗證語法，全部沒問題才備份舊版並替換，選擇器服務有改就重啟。平常的 git push 不會影響設計師電腦，
 * 只有按了「發布」才會更新。
 *
 * 這支檔案與啟動器本身「不在」自動更新名單裡（見 BOOTSTRAP_FILES）：它們是更新機制自己，改壞了就沒有
 * 辦法靠更新救回來，所以刻意維持很小、很少改、由測試釘住；真的要改它們，才需要請各台電腦重新執行一次安裝器。
 */
import { promises as fs } from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { spawnSync } from 'node:child_process';

export const DEFAULT_UPDATE_BASE_URL = 'https://raw.githubusercontent.com/EMCtaipeiART/EMCtaipeiART.github.io/main';
export const RELEASE_MANIFEST_NAME = 'nas_watcher_release.json';
export const PICKER_LABEL = 'com.emctaipei.nas-folder-picker';
export const CONFIG_TEMPLATE_NAME = 'nas_design_image_watcher.config.json';
/** 自動更新的檔案（相對於 scripts/）。設定檔範本比較特殊：不是直接覆蓋，而是合併（見 mergeConfigTemplate）。 */
export const UPDATE_FILES = [
  'nas_design_image_lib.mjs',
  'nas_design_image_watcher.mjs',
  'nas_folder_picker_server.mjs',
  'nas_watcher_installer.mjs',
  CONFIG_TEMPLATE_NAME
];
/** 更新機制本身，不自動更新（見檔案開頭說明）。安裝器（.command）要下載這些。 */
export const BOOTSTRAP_FILES = ['nas_watcher_launcher.mjs', 'nas_watcher_update.mjs'];
export const CHECK_INTERVAL_MS = 10 * 60 * 1000;
// 檢查失敗（例如 GitHub 的快取還沒更新、雜湊對不上）時，不用等滿 10 分鐘，2 分鐘後就再試。
export const RETRY_INTERVAL_MS = 2 * 60 * 1000;
// 更新後不能被當成「每台電腦各自的設定」蓋掉的欄位：安裝時依這台電腦算出來的路徑與模式。
export const PER_MACHINE_CONFIG_KEYS = ['mountRoot', 'stateFile', 'previewDir', 'secretsFile', 'autoMountNas', 'autoUpdate', 'updateBaseUrl'];

export function sha256(buffer) {
  return crypto.createHash('sha256').update(buffer).digest('hex');
}

/** files：{ 檔名: Buffer|string } → 發布清單。 */
export function buildManifest(files, { version, publishedAt = new Date().toISOString() } = {}) {
  const entries = {};
  for (const name of Object.keys(files).sort()) entries[name] = sha256(files[name]);
  return { version: String(version || ''), publishedAt, files: entries };
}

export function isValidManifest(manifest) {
  if (!manifest || typeof manifest !== 'object' || !String(manifest.version || '').trim()) return false;
  const names = Object.keys(manifest.files || {});
  if (!names.length) return false;
  return names.every(name => UPDATE_FILES.includes(name) && /^[0-9a-f]{64}$/.test(String(manifest.files[name])));
}

/** 設定檔範本更新時保留這台電腦自己的欄位（掛載路徑、狀態檔位置、手動連線模式…），其餘用新範本。 */
export function mergeConfigTemplate(template, current) {
  const merged = { ...template };
  for (const key of PER_MACHINE_CONFIG_KEYS) {
    if (current && key in current) merged[key] = current[key];
  }
  return merged;
}

async function readJson(file, fallback = null) {
  try {
    return JSON.parse(await fs.readFile(file, 'utf8'));
  } catch {
    return fallback;
  }
}

async function writeJsonAtomic(file, value) {
  await fs.mkdir(path.dirname(file), { recursive: true });
  const temp = `${file}.tmp-${process.pid}`;
  await fs.writeFile(temp, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
  await fs.rename(temp, file);
}

function checkSyntax(file, nodePath) {
  const result = spawnSync(nodePath, ['--check', file], { encoding: 'utf8' });
  return result.status === 0 ? '' : String(result.stderr || result.stdout || '語法錯誤').trim().split('\n').slice(0, 3).join(' ');
}

function paths(scriptsDir) {
  const installDir = path.dirname(scriptsDir);
  const stateDir = path.join(installDir, 'state');
  return {
    stateDir,
    checkFile: path.join(stateDir, 'update-check.json'),
    stagingDir: path.join(stateDir, 'update-staging'),
    previousDir: path.join(stateDir, 'previous-release'),
    localManifest: path.join(scriptsDir, RELEASE_MANIFEST_NAME)
  };
}

function restartPickerService() {
  if (typeof process.getuid !== 'function') return;
  spawnSync('launchctl', ['kickstart', '-k', `gui/${process.getuid()}/${PICKER_LABEL}`], { encoding: 'utf8' });
}

/**
 * 檢查並套用更新。回傳 { updated, reason, from?, to?, changedFiles? }。
 * reason：throttled（還沒到檢查時間）、current（已經是最新）、skipped-failed-version（這個版本之前套用失敗過）、
 * fetch-failed／hash-mismatch／syntax-error（這次放棄，不動任何檔案，稍後重試）、applied。
 */
export async function checkAndApplyUpdate({
  scriptsDir,
  baseUrl = DEFAULT_UPDATE_BASE_URL,
  fetchImpl = globalThis.fetch,
  now = Date.now(),
  intervalMs = CHECK_INTERVAL_MS,
  force = false,
  nodePath = process.execPath,
  restartPicker = restartPickerService
} = {}) {
  const p = paths(scriptsDir);
  const state = (await readJson(p.checkFile, {})) || {};
  if (!force && Number(state.nextCheckAt) > now) return { updated: false, reason: 'throttled' };
  const saveState = async (patch, nextInMs) => writeJsonAtomic(p.checkFile, { ...state, ...patch, lastCheckAt: now, nextCheckAt: now + nextInMs });
  const cacheBuster = `cb=${now}`;
  const get = async name => {
    const response = await fetchImpl(`${baseUrl}/scripts/${name}?${cacheBuster}`, { signal: AbortSignal.timeout(15000), headers: { 'Cache-Control': 'no-cache' } });
    if (!response.ok) throw new Error(`${name}：HTTP ${response.status}`);
    return Buffer.from(await response.arrayBuffer());
  };

  let remote;
  try {
    remote = JSON.parse((await get(RELEASE_MANIFEST_NAME)).toString('utf8'));
  } catch (error) {
    await saveState({}, RETRY_INTERVAL_MS);
    return { updated: false, reason: 'fetch-failed', message: error.message };
  }
  if (!isValidManifest(remote)) {
    await saveState({}, CHECK_INTERVAL_MS);
    return { updated: false, reason: 'fetch-failed', message: '發布清單格式不正確' };
  }
  const local = await readJson(p.localManifest, {});
  if (String(local?.version || '') === remote.version) {
    await saveState({}, intervalMs);
    return { updated: false, reason: 'current', version: remote.version };
  }
  if (Array.isArray(state.failedVersions) && state.failedVersions.includes(remote.version)) {
    await saveState({}, intervalMs);
    return { updated: false, reason: 'skipped-failed-version', version: remote.version };
  }

  // 全部先下載到暫存資料夾，逐一比對雜湊、驗證語法；任何一步失敗都不動現有檔案。
  await fs.rm(p.stagingDir, { recursive: true, force: true });
  await fs.mkdir(p.stagingDir, { recursive: true });
  const staged = {};
  try {
    for (const name of Object.keys(remote.files)) {
      const buffer = await get(name);
      if (sha256(buffer) !== remote.files[name]) {
        await saveState({}, RETRY_INTERVAL_MS);
        return { updated: false, reason: 'hash-mismatch', file: name, message: `${name} 內容跟發布清單對不上（可能是 GitHub 快取還沒更新，稍後重試）` };
      }
      staged[name] = buffer;
      await fs.writeFile(path.join(p.stagingDir, name), buffer);
    }
  } catch (error) {
    await saveState({}, RETRY_INTERVAL_MS);
    return { updated: false, reason: 'fetch-failed', message: error.message };
  }
  for (const name of Object.keys(staged).filter(item => item.endsWith('.mjs'))) {
    const problem = checkSyntax(path.join(p.stagingDir, name), nodePath);
    if (problem) {
      await saveState({ failedVersions: [...(state.failedVersions || []), remote.version].slice(-10) }, intervalMs);
      await fs.rm(p.stagingDir, { recursive: true, force: true });
      return { updated: false, reason: 'syntax-error', file: name, message: `${name}：${problem}` };
    }
  }

  // 備份舊版（只保留最近一次，供新版載入失敗時還原），再逐一替換。
  await fs.rm(p.previousDir, { recursive: true, force: true });
  await fs.mkdir(p.previousDir, { recursive: true });
  const changedFiles = [];
  for (const name of Object.keys(staged)) {
    const target = path.join(scriptsDir, name);
    let currentBuffer = null;
    try { currentBuffer = await fs.readFile(target); } catch { currentBuffer = null; }
    if (currentBuffer) await fs.writeFile(path.join(p.previousDir, name), currentBuffer);
    let nextBuffer = staged[name];
    if (name === CONFIG_TEMPLATE_NAME) {
      const merged = mergeConfigTemplate(JSON.parse(staged[name].toString('utf8')), await readJson(target, {}));
      nextBuffer = Buffer.from(`${JSON.stringify(merged, null, 2)}\n`);
    }
    if (currentBuffer && sha256(currentBuffer) === sha256(nextBuffer)) continue;
    const temp = `${target}.update-${process.pid}`;
    await fs.writeFile(temp, nextBuffer);
    await fs.rename(temp, target);
    changedFiles.push(name);
  }
  if (local && Object.keys(local).length) await writeJsonAtomic(path.join(p.previousDir, RELEASE_MANIFEST_NAME), local);
  await writeJsonAtomic(p.localManifest, remote);
  await fs.rm(p.stagingDir, { recursive: true, force: true });
  await saveState({ lastAppliedVersion: remote.version }, intervalMs);
  if (changedFiles.includes('nas_folder_picker_server.mjs')) restartPicker();
  return { updated: true, reason: 'applied', from: String(local?.version || ''), to: remote.version, changedFiles };
}

/** 新版載入失敗時還原上一版，並把這個版本標記為失敗（之後不再自動重試，直到發布新的版本）。 */
export async function rollbackUpdate({ scriptsDir, failedVersion, restartPicker = restartPickerService }) {
  const p = paths(scriptsDir);
  let restored = 0;
  let entries = [];
  try { entries = await fs.readdir(p.previousDir); } catch { entries = []; }
  for (const name of entries) {
    const target = path.join(scriptsDir, name);
    const temp = `${target}.rollback-${process.pid}`;
    await fs.copyFile(path.join(p.previousDir, name), temp);
    await fs.rename(temp, target);
    restored += 1;
  }
  const state = (await readJson(p.checkFile, {})) || {};
  await writeJsonAtomic(p.checkFile, { ...state, failedVersions: [...(state.failedVersions || []), failedVersion].filter(Boolean).slice(-10) });
  if (restored) restartPicker();
  return { restored };
}

#!/usr/bin/env node
/**
 * NAS 設計圖檔監控程式：自動設定 + 執行
 *
 * 做的事：
 *   1. 檢查 NAS 分享是否已經掛載在 /Volumes 底下，沒有的話呼叫 Finder
 *      幫你開啟連線視窗（`open smb://...`），並等待掛載完成。
 *   2. 掛載完成後，自動把偵測到的路徑寫回設定檔的 mountRoot，不用手動
 *      改 JSON。
 *   3. 設定好之後直接執行掃描（nas_design_image_watcher.mjs）。
 *
 * 做不到的事（不是這支程式能力範圍，請注意）：
 *   - 沒辦法幫你輸入 SMB 帳號密碼。如果你的 Mac 之前沒連過這個分享、
 *     Keychain 裡也沒存密碼，Finder 還是會跳出視窗要你手動輸入一次。
 *     這是 macOS 網路磁碟機驗證機制本身的限制，這支程式不會、也不應該
 *     把密碼寫死在腳本裡幫你跳過驗證。
 *
 * 執行方式：
 *   node scripts/nas_design_image_watcher.setup.mjs
 *
 * 前提：只能在 macOS、且連得到公司內網的電腦上執行（用到 macOS 專屬的
 * `open` 指令去觸發 Finder 連線）。跟 nas_design_image_watcher.mjs 一樣
 * 不能透過 Cowork 對話視窗執行。
 */

import { promises as fs } from 'node:fs';
import path from 'node:path';
import { execSync, spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const CONFIG_PATH = path.join(__dirname, 'nas_design_image_watcher.config.json');
const MAX_WAIT_SECONDS = 60;
const POLL_INTERVAL_MS = 2000;

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function loadConfig() {
  const raw = await fs.readFile(CONFIG_PATH, 'utf8');
  return JSON.parse(raw);
}

async function saveConfig(config) {
  await fs.writeFile(CONFIG_PATH, `${JSON.stringify(config, null, 2)}\n`, 'utf8');
}

async function volumeExists(volumeName) {
  try {
    const stat = await fs.stat(path.join('/Volumes', volumeName));
    return stat.isDirectory();
  } catch {
    return false;
  }
}

async function findMountedVolume(expectedName) {
  if (await volumeExists(expectedName)) return path.join('/Volumes', expectedName);
  // macOS 重複掛載同一個分享時，有時會自動加上「-1」「-2」這種後綴，
  // 掃一次 /Volumes 找相近名稱，避免因為後綴誤判成「沒掛載」。
  try {
    const entries = await fs.readdir('/Volumes');
    const match = entries.find(
      (name) => name === expectedName || name.startsWith(`${expectedName}-`)
    );
    if (match) return path.join('/Volumes', match);
  } catch {
    // /Volumes 讀不到就當作沒找到，往下走一般的「未掛載」流程。
  }
  return null;
}

async function ensureMounted(config) {
  console.log('');
  console.log('[2/3] 檢查 NAS 掛載狀態...');

  const expectedName = config.expectedVolumeName;
  const smbUrl = config.smbUrl;
  if (!expectedName || !smbUrl) {
    throw new Error(
      '設定檔缺少 expectedVolumeName 或 smbUrl，無法自動掛載，請手動確認 mountRoot。'
    );
  }

  let mountPath = await findMountedVolume(expectedName);
  if (mountPath) {
    console.log(`  已掛載：${mountPath}`);
    return mountPath;
  }

  console.log(`  尚未掛載，呼叫 Finder 連線 ${smbUrl} ...`);
  console.log('  若跳出帳號密碼視窗，請輸入你的公司帳號密碼完成連線（這一步無法自動化）。');
  try {
    execSync(`open "${smbUrl}"`);
  } catch (error) {
    throw new Error(`無法呼叫 Finder 開啟連線視窗：${error.message}`);
  }

  const attempts = Math.ceil((MAX_WAIT_SECONDS * 1000) / POLL_INTERVAL_MS);
  for (let i = 0; i < attempts; i += 1) {
    await sleep(POLL_INTERVAL_MS);
    mountPath = await findMountedVolume(expectedName);
    if (mountPath) {
      console.log(`  掛載完成：${mountPath}`);
      return mountPath;
    }
  }

  throw new Error(
    `等了 ${MAX_WAIT_SECONDS} 秒還是沒偵測到 /Volumes/${expectedName}。` +
    '請確認 Finder 連線視窗是否還開著、帳密是否正確，或分享名稱是否不是這個名字' +
    '（可以自己執行 `ls /Volumes` 確認實際名稱）。'
  );
}

async function syncConfigMountRoot(config, mountPath) {
  console.log('');
  console.log('[3/3] 同步設定檔...');
  if (config.mountRoot === mountPath) {
    console.log('  mountRoot 已經是最新的，不用更新。');
    return;
  }
  console.log(`  mountRoot：${config.mountRoot} → ${mountPath}`);
  config.mountRoot = mountPath;
  await saveConfig(config);
}

async function main() {
  console.log('=== NAS 設計圖檔監控程式：自動設定 ===');
  console.log(`[1/3] Node.js 版本：${process.version}`);

  const config = await loadConfig();
  const mountPath = await ensureMounted(config);
  await syncConfigMountRoot(config, mountPath);

  console.log('');
  console.log('=== 設定完成，開始掃描 ===');
  console.log('');

  const result = spawnSync(
    process.execPath,
    [path.join(__dirname, 'nas_design_image_watcher.mjs'), '--config', CONFIG_PATH],
    { stdio: 'inherit' }
  );
  process.exitCode = result.status ?? 1;
}

main().catch((error) => {
  console.error('');
  console.error('自動設定失敗：', error.message);
  process.exitCode = 1;
});

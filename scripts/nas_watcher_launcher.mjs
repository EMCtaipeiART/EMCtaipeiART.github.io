#!/usr/bin/env node
/**
 * 設計師電腦上 NAS 爬蟲的啟動入口（launchd 每分鐘執行這支，不是直接執行 nas_design_image_watcher.mjs）。
 *
 * 每次執行：①（設定檔 autoUpdate 為 true 時）先檢查有沒有新版、有就更新（每 10 分鐘才真的連線檢查一次，
 * 見 nas_watcher_update.mjs）；②再載入並執行真正的爬蟲。新版如果一載入就壞掉（語法／匯入錯誤），
 * 立刻還原上一版，下一分鐘就恢復正常，不會讓整台電腦停擺。
 *
 * 這支檔案與 nas_watcher_update.mjs 是更新機制本身，不會被自動更新（改壞了沒辦法靠更新救回來），
 * 所以請保持精簡；要改它們必須請各台電腦重新執行一次安裝器。
 * 這台主機（用 cron 直接跑 git 工作目錄裡的爬蟲）不使用這支。
 */
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const scriptsDir = path.dirname(fileURLToPath(import.meta.url));

async function readJson(file) {
  try {
    return JSON.parse(await fs.readFile(file, 'utf8'));
  } catch {
    return {};
  }
}

let applied = null;
try {
  const configPath = path.join(scriptsDir, 'nas_design_image_watcher.config.json');
  const config = { ...(await readJson(configPath)), ...(await readJson(path.join(scriptsDir, 'nas_design_image_watcher.local.json'))) };
  if (config.autoUpdate === true) {
    const { checkAndApplyUpdate } = await import('./nas_watcher_update.mjs');
    const result = await checkAndApplyUpdate({ scriptsDir, ...(config.updateBaseUrl ? { baseUrl: String(config.updateBaseUrl) } : {}) });
    if (result.updated) {
      applied = result;
      console.log(`[自動更新] 已從 ${result.from || '（未知）'} 更新到 ${result.to}：${result.changedFiles.join('、') || '（內容沒變）'}`);
    } else if (['fetch-failed', 'hash-mismatch', 'syntax-error'].includes(result.reason)) {
      console.log(`[自動更新] 這次沒有更新（${result.reason}）：${result.message || ''}`);
    }
  }
} catch (error) {
  console.log(`[自動更新] 檢查失敗，略過，照舊版執行：${error?.message || error}`);
}

try {
  await import(pathToFileURL(path.join(scriptsDir, 'nas_design_image_watcher.mjs')).href);
} catch (error) {
  console.error(`[啟動失敗] 爬蟲載入失敗：${error?.stack || error}`);
  if (applied) {
    try {
      const { rollbackUpdate } = await import('./nas_watcher_update.mjs');
      const result = await rollbackUpdate({ scriptsDir, failedVersion: applied.to });
      console.error(`[自動更新] 新版 ${applied.to} 載入失敗，已還原上一版（${result.restored} 個檔案），下一輪起恢復正常，這個版本不會再自動重試。`);
    } catch (rollbackError) {
      console.error(`[自動更新] 還原也失敗了，請重新執行安裝器：${rollbackError?.message || rollbackError}`);
    }
  }
  process.exitCode = 1;
}

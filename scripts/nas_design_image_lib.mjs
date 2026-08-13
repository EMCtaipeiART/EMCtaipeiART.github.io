#!/usr/bin/env node
/**
 * NAS 設計圖檔共用邏輯
 *
 * 這支檔案本身不能單獨執行，是 nas_design_image_watcher.mjs（定時背景掃描）
 * 與 nas_folder_picker_server.mjs（資料夾選擇器，選好資料夾當下立即備份一次）
 * 共用的核心邏輯：讀設定/密鑰/狀態快取、掃描資料夾比對變動、影片截圖、圖片
 * 壓縮、讀案件資料庫算輪次、呼叫 Apps Script 上傳。兩支程式對同一個案件、
 * 同一份狀態快取（sync-state.json）做的事情必須完全一致，才不會出現「背景
 * 掃描判斷成新增，選擇器判斷成已處理」這種不一致，所以抽成同一份程式碼，
 * 不是各自維護一份。
 */

import { promises as fs } from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { execFileSync } from 'node:child_process';

export const DEFAULT_IMAGE_EXTENSIONS = ['.jpg', '.jpeg', '.png', '.webp'];
export const DEFAULT_VIDEO_EXTENSIONS = ['.mp4', '.mov', '.m4v'];
export const DEFAULT_MAX_DIMENSION = 1600;
export const DEFAULT_JPEG_QUALITY = 70;

export async function loadJsonFile(filePath, fallback = null) {
  try {
    const raw = await fs.readFile(filePath, 'utf8');
    return JSON.parse(raw);
  } catch (error) {
    if (error.code === 'ENOENT') return fallback;
    throw new Error(`讀取 ${filePath} 失敗：${error.message}`);
  }
}

export async function loadConfig(configPath) {
  const config = await loadJsonFile(configPath);
  if (!config) throw new Error(`讀不到設定檔：${configPath}`);
  if (!config.mountRoot) throw new Error('設定檔缺少 mountRoot');
  if (!config.dbJsonUrl) throw new Error('設定檔缺少 dbJsonUrl——案件清單現在完全依賴它動態產生，不能留空');
  return {
    imageExtensions: DEFAULT_IMAGE_EXTENSIONS,
    videoExtensions: DEFAULT_VIDEO_EXTENSIONS,
    maxDimension: DEFAULT_MAX_DIMENSION,
    jpegQuality: DEFAULT_JPEG_QUALITY,
    useHash: false,
    stateFile: './nas_design_image_watcher.state/sync-state.json',
    previewDir: './nas_design_image_watcher.state/previews',
    secretsFile: './nas_design_image_watcher.secrets.json',
    appsScriptUploadUrl: '',
    defaultBrowseRoot: '',
    ...config
  };
}

export async function loadSecrets(secretsFile) {
  const secrets = await loadJsonFile(secretsFile, {});
  return { serviceKey: '', ...secrets };
}

export function resolvePath(base, value) {
  return path.isAbsolute(value) ? value : path.join(base, value);
}

export async function loadState(stateFile) {
  const state = await loadJsonFile(stateFile, {});
  return state || {};
}

export async function saveState(stateFile, state) {
  await fs.mkdir(path.dirname(stateFile), { recursive: true });
  await fs.writeFile(stateFile, JSON.stringify(state, null, 2), 'utf8');
}

export async function hashFile(filePath) {
  const buffer = await fs.readFile(filePath);
  return crypto.createHash('md5').update(buffer).digest('hex');
}

export function classify(fileName, config) {
  const ext = path.extname(fileName).toLowerCase();
  if (config.imageExtensions.includes(ext)) return 'image';
  if (config.videoExtensions.includes(ext)) return 'video';
  return null;
}

export async function walkMedia(dir, config) {
  const results = [];
  let entries;
  try {
    entries = await fs.readdir(dir, { withFileTypes: true });
  } catch (error) {
    throw new Error(`無法讀取資料夾：${dir}（${error.code || error.message}）`);
  }
  for (const entry of entries) {
    if (entry.name.startsWith('.')) continue;
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      results.push(...(await walkMedia(fullPath, config)));
    } else if (entry.isFile()) {
      const kind = classify(entry.name, config);
      if (kind) results.push({ filePath: fullPath, kind });
    }
  }
  return results;
}

export function formatBytes(bytes) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

export function safePreviewName(relPath) {
  return relPath.replace(/[\\/]/g, '__').replace(/[^\w.\-一-龥぀-ゟ゠-ヿ]/g, '_');
}

/**
 * 設計師在網頁填的路徑，開頭可能已經包含分享名稱本身（例如貼
 * `/設計部/專案企劃部/...`），也可能是單純相對於 mountRoot 的路徑
 * （例如 `專案企劃部/...`）。這裡統一判斷、去除重複的開頭分享名稱，
 * 接回 mountRoot 底下，算出這支程式真正要掃描的絕對路徑。
 */
export function resolveCaseFolderPath(mountRoot, rawFolderPath) {
  const shareName = path.basename(mountRoot);
  const segments = String(rawFolderPath || '')
    .replace(/^smb:\/\/[^/]*\/?/i, '') // 萬一貼的是完整 smb:// 網址，先去掉主機名稱那段
    .split(/[\\/]+/)
    .filter(Boolean);
  if (segments.length && segments[0] === shareName) segments.shift();
  return path.join(mountRoot, ...segments);
}

/**
 * 執行 macOS 內建指令，抓不到指令、或指令執行失敗都不丟例外中斷整個掃描，
 * 而是回傳失敗結果，讓呼叫端決定要不要略過這個檔案並記錄警告。
 */
export function runTool(cmd, args) {
  try {
    const stdout = execFileSync(cmd, args, { stdio: ['ignore', 'pipe', 'pipe'], timeout: 30000 });
    return { ok: true, stdout: stdout.toString('utf8') };
  } catch (error) {
    return { ok: false, error: error.message || String(error) };
  }
}

/**
 * 用系統內建的 qlmanage（Quick Look 縮圖產生器）幫影片抓一張畫面。
 * qlmanage 會在 outDir 產生 `<原始檔名>.png`，抓不到就回傳 null。
 */
export async function generateVideoFramePng(videoPath, outDir) {
  await fs.mkdir(outDir, { recursive: true });
  const result = runTool('qlmanage', ['-t', '-s', '1600', '-o', outDir, videoPath]);
  if (!result.ok) return { ok: false, error: result.error };
  const expectedName = `${path.basename(videoPath)}.png`;
  const expectedPath = path.join(outDir, expectedName);
  try {
    await fs.access(expectedPath);
    return { ok: true, framePath: expectedPath };
  } catch {
    return { ok: false, error: 'qlmanage 沒有產生預期的縮圖檔（可能該影片格式沒有可用的 QuickLook 預覽外掛）' };
  }
}

/**
 * 用系統內建的 sips 把來源圖片（或影片截圖）統一轉成 JPEG、限制最大邊長、
 * 調整壓縮品質，產生一張給系統時間軸用的小型預覽圖。原始母檔完全不動。
 */
export function compressToJpeg(srcPath, destPath, { maxDimension, jpegQuality }) {
  const result = runTool('sips', [
    '-Z', String(maxDimension),
    '-s', 'format', 'jpeg',
    '-s', 'formatOptions', String(jpegQuality),
    srcPath,
    '--out', destPath
  ]);
  return result;
}

/**
 * 幫一個檔案（圖片或影片）產生壓縮後的預覽 JPEG。
 * 回傳 previewPath（成功）或 null（失敗，會記警告但不中斷掃描）。
 */
export async function buildPreview(media, previewDir, mountRoot, config, warnings) {
  const relName = safePreviewName(path.relative(mountRoot, media.filePath));
  const destPath = path.join(previewDir, `${relName}.preview.jpg`);
  await fs.mkdir(previewDir, { recursive: true });

  let sourceForCompress = media.filePath;
  let tempFrame = null;

  if (media.kind === 'video') {
    const frameResult = await generateVideoFramePng(media.filePath, path.join(previewDir, '.video-frames'));
    if (!frameResult.ok) {
      warnings.push(`影片截圖失敗，略過：${media.filePath}（${frameResult.error}）`);
      return null;
    }
    sourceForCompress = frameResult.framePath;
    tempFrame = frameResult.framePath;
  }

  const compressResult = compressToJpeg(sourceForCompress, destPath, config);
  if (tempFrame) {
    // 影片擷取出來的中繼 PNG 只是過渡檔，壓縮完就可以刪除，不用留著佔空間。
    await fs.rm(tempFrame, { force: true }).catch(() => {});
  }
  if (!compressResult.ok) {
    warnings.push(`圖片壓縮失敗，略過：${media.filePath}（${compressResult.error}）`);
    return null;
  }
  return destPath;
}

export async function scanProject(project, config, state, previewDir, warnings) {
  const folderPath = resolveCaseFolderPath(config.mountRoot, project.rawFolderPath);
  let stat;
  try {
    stat = await fs.stat(folderPath);
  } catch (error) {
    return {
      caseId: project.caseId,
      folderPath,
      error: `找不到資料夾，請確認 NAS 是否已掛載、路徑是否正確（${error.code || error.message}）`
    };
  }
  if (!stat.isDirectory()) {
    return { caseId: project.caseId, folderPath, error: '路徑存在，但不是資料夾' };
  }

  const mediaFiles = await walkMedia(folderPath, config);
  const previousState = state[project.caseId] || { files: {} };
  const previousFiles = previousState.files || {};
  const nextFiles = {};
  const newItems = [];
  const changedItems = [];
  let unchangedCount = 0;
  const useHash = config.useHash === true;
  const caseProjectPreviewDir = path.join(previewDir, project.caseId);

  for (const media of mediaFiles) {
    const relPath = path.relative(folderPath, media.filePath);
    const fileStat = await fs.stat(media.filePath);
    const previous = previousFiles[relPath];
    const entry = {
      kind: media.kind,
      mtimeMs: fileStat.mtimeMs,
      size: fileStat.size,
      assignedRound: previous ? previous.assignedRound : null,
      previewPath: previous ? previous.previewPath : null
    };

    let changed = !previous || previous.mtimeMs !== entry.mtimeMs || previous.size !== entry.size;
    if (changed && useHash) {
      entry.hash = await hashFile(media.filePath);
      if (previous && previous.hash === entry.hash) changed = false;
    } else if (previous && previous.hash) {
      entry.hash = previous.hash;
    }

    if (changed) {
      const previewPath = await buildPreview(media, caseProjectPreviewDir, config.mountRoot, config, warnings);
      entry.previewPath = previewPath;
      entry.assignedRound = null; // 內容變了，重新排進「待歸類」清單
      if (!previous) newItems.push({ relPath, ...entry });
      else changedItems.push({ relPath, ...entry });
    } else {
      unchangedCount += 1;
    }

    nextFiles[relPath] = entry;
  }

  const pendingPreviews = Object.entries(nextFiles)
    .filter(([, entry]) => entry.assignedRound === null && entry.previewPath)
    .map(([relPath, entry]) => ({ relPath, previewPath: entry.previewPath }));

  return {
    caseId: project.caseId,
    folderPath,
    totalFiles: mediaFiles.length,
    newItems,
    changedItems,
    unchangedCount,
    pendingPreviews,
    nextState: { files: nextFiles }
  };
}

export async function fetchDatabase(dbJsonUrl) {
  const response = await fetch(`${dbJsonUrl}${dbJsonUrl.includes('?') ? '&' : '?'}ts=${Date.now()}`, {
    headers: { 'Cache-Control': 'no-store' }
  });
  if (!response.ok) throw new Error(`讀取案件資料庫失敗：HTTP ${response.status}`);
  return response.json();
}

/**
 * 依即時資料動態算出這次要處理的案件清單：狀態＝過稿中，且設計師在網頁
 * 上填過「設計圖資料夾連結」（存的是 NAS 路徑，不是 Drive 連結）。
 */
export function discoverProjects(dbData) {
  const rows = dbData?.tables?.database?.rows || [];
  return rows
    .filter(row => String(row['狀態'] || '') === '過稿中' && String(row['設計圖資料夾連結'] || '').trim())
    .map(row => ({
      caseId: String(row['案件編號'] || ''),
      rawFolderPath: String(row['設計圖資料夾連結'] || '').trim(),
      designer: String(row['設計負責人'] || '').trim() || '未指定設計師',
      client: String(row['客戶別'] || '').trim() || '未分類客戶',
      start: String(row['開始日期'] || '').trim()
    }))
    .filter(project => project.caseId);
}

/**
 * 依案件編號查單一案件的基本資料——跟 discoverProjects 不同，這裡不篩
 * 「狀態＝過稿中」或「已填來源資料夾」，因為資料夾選擇器在使用者選好資料
 * 夾、還沒寫回 designImageFolderUrl 的那個當下就需要知道這個案件的設計師
 * ／客戶別／開始日期，才能立即備份與算目的地巢狀資料夾。
 */
export function findCaseMeta(dbData, caseId) {
  const rows = dbData?.tables?.database?.rows || [];
  const row = rows.find(item => String(item['案件編號'] || '') === String(caseId));
  if (!row) return null;
  return {
    caseId: String(caseId),
    designer: String(row['設計負責人'] || '').trim() || '未指定設計師',
    client: String(row['客戶別'] || '').trim(),
    start: String(row['開始日期'] || '').trim(),
    status: String(row['狀態'] || '').trim()
  };
}

export function computeRound(dbData, caseId) {
  const rows = dbData?.tables?.['修改統計表']?.rows || [];
  return rows
    .filter(row => String(row['案件編號'] || '') === caseId)
    .reduce((max, row) => Math.max(max, Number(row['修改次數']) || 0), 0);
}

/**
 * 讀這個案件這一輪的「待修改圖片」清單（PM 填修改需求時勾選的檔名）。
 * 沒有紀錄、或清單是空的，回傳 null（代表這輪不限制，抓所有變動）。
 */
export function computeTargetImages(dbData, caseId, round) {
  const rows = dbData?.tables?.['修改統計表']?.rows || [];
  const row = rows.find(item => String(item['案件編號'] || '') === caseId && (Number(item['修改次數']) || 0) === round);
  if (!row) return null;
  const raw = String(row['待修改圖片'] || '').trim();
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) && parsed.length ? parsed.map(String) : null;
  } catch {
    return null;
  }
}

export function computeYearMonth(startDateText) {
  const match = /^(\d{4})[-/](\d{1,2})/.exec(startDateText || '');
  const now = new Date();
  return {
    year: match ? match[1] : String(now.getFullYear()),
    month: match ? match[2].padStart(2, '0') : String(now.getMonth() + 1).padStart(2, '0')
  };
}

export async function uploadRound({ config, secrets, caseId, round, designer, client, year, month, pendingPreviews }) {
  const images = [];
  for (const item of pendingPreviews) {
    const buffer = await fs.readFile(item.previewPath);
    images.push({
      fileName: path.basename(item.relPath),
      mimeType: 'image/jpeg',
      base64: buffer.toString('base64')
    });
  }
  const response = await fetch(config.appsScriptUploadUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      action: 'uploadCaseDesignImages',
      serviceKey: secrets.serviceKey,
      caseId,
      round,
      designer,
      client,
      year,
      month,
      source: 'nas-watcher',
      images
    })
  });
  const text = await response.text();
  let data;
  try {
    data = JSON.parse(text);
  } catch {
    throw new Error(`上傳回應不是合法 JSON（HTTP ${response.status}）：${text.slice(0, 200)}`);
  }
  if (!data.success) throw new Error(data.message || `上傳失敗（HTTP ${response.status}）`);
  return data;
}

export function uploadEnabled(config, secrets) {
  return Boolean(config.appsScriptUploadUrl && secrets.serviceKey);
}

/**
 * 案件目前已知的「這一輪待歸類、已經產生預覽圖」的檔案，套用 PM 指定的
 * 「待修改圖片」清單（如果有）過濾後，實際打包上傳，並把上傳成功的檔案
 * 標記為已歸類到這一輪。回傳結果供呼叫端（watcher 的批次迴圈／picker
 * server 的立即備份）各自決定怎麼呈現。
 */
export async function uploadPendingRound({ config, secrets, dbData, caseId, designer, client, start, pendingPreviews, stateFiles }) {
  const round = computeRound(dbData, caseId);
  const targetImages = computeTargetImages(dbData, caseId, round);
  let targetedPreviews = pendingPreviews;
  let skippedByTarget = 0;
  if (targetImages) {
    const targetSet = new Set(targetImages);
    targetedPreviews = pendingPreviews.filter(item => targetSet.has(path.basename(item.relPath)));
    skippedByTarget = pendingPreviews.length - targetedPreviews.length;
  }
  if (!targetedPreviews.length) {
    return { round, uploadedCount: 0, skippedByTarget, message: '沒有偵測到可上傳的圖片/影片' };
  }
  const { year, month } = computeYearMonth(start);
  const uploadResult = await uploadRound({ config, secrets, caseId, round, designer, client, year, month, pendingPreviews: targetedPreviews });
  for (const item of targetedPreviews) {
    if (stateFiles[item.relPath]) stateFiles[item.relPath].assignedRound = round;
  }
  return { round, uploadedCount: uploadResult.count, skippedByTarget, jsonRevision: uploadResult.jsonRevision };
}

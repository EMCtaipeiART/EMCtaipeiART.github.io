#!/usr/bin/env node
/**
 * NAS 設計圖檔監控程式
 *
 * 用途：定期掃描公司內網 NAS 共用資料夾（SMB），依「案件」找出資料夾裡
 * 新增或有更新的圖片（*.jpg/*.png）與影片（*.mp4/*.mov/*.m4v，會自動擷取
 * 一張畫面當紀錄圖），統一壓縮成小尺寸 JPEG 預覽圖。
 *
 * 如果設定檔有填 appsScriptUploadUrl／dbJsonUrl，而且
 * nas_design_image_watcher.secrets.json 有填 serviceKey，還會做「輪次判斷
 * ＋自動上傳」：讀案件目前狀態，只有在狀態是「過稿中」、而且這一輪還沒
 * 抓取過的時候，把資料夾裡「還沒歸類到任何一輪」的預覽圖打包上傳，寫進
 * 後台資料庫的「修改統計表」（0=初稿，1=一修，2=二修…）。
 *
 * 如果沒有設定這三個參數，就只會產生本機預覽圖、列出掃描結果，不會嘗試
 * 上傳——方便先確認「掃描＋影片截圖＋壓縮」這幾步在你的環境上正常，再
 * 接上後面的上傳。
 *
 * 執行環境限制（重要）：
 *   只能在 macOS、且連得到公司內網 NAS 的機器上執行。影片截圖用系統內建
 *   的 `qlmanage`、圖片壓縮用系統內建的 `sips`，都是 macOS 專屬指令，
 *   不能在 Windows/Linux 上執行。也不能透過 Cowork 對話視窗執行，理由
 *   跟之前一樣：那邊的 shell 是雲端隔離環境，連不到你的內網。
 *
 * 執行：
 *   node scripts/nas_design_image_watcher.mjs
 *   node scripts/nas_design_image_watcher.mjs --config 其他設定檔路徑.json
 */

import { promises as fs } from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DEFAULT_IMAGE_EXTENSIONS = ['.jpg', '.jpeg', '.png'];
const DEFAULT_VIDEO_EXTENSIONS = ['.mp4', '.mov', '.m4v'];
const DEFAULT_MAX_DIMENSION = 1600;
const DEFAULT_JPEG_QUALITY = 70;

function parseArgs(argv) {
  const args = {
    config: path.join(__dirname, 'nas_design_image_watcher.config.json')
  };
  for (let i = 0; i < argv.length; i += 1) {
    if (argv[i] === '--config' && argv[i + 1]) {
      args.config = path.resolve(argv[i + 1]);
      i += 1;
    }
  }
  return args;
}

async function loadJsonFile(filePath, fallback = null) {
  try {
    const raw = await fs.readFile(filePath, 'utf8');
    return JSON.parse(raw);
  } catch (error) {
    if (error.code === 'ENOENT') return fallback;
    throw new Error(`讀取 ${filePath} 失敗：${error.message}`);
  }
}

async function loadConfig(configPath) {
  const config = await loadJsonFile(configPath);
  if (!config) throw new Error(`讀不到設定檔：${configPath}`);
  if (!config.mountRoot) throw new Error('設定檔缺少 mountRoot');
  if (!Array.isArray(config.projects) || !config.projects.length) {
    throw new Error('設定檔 projects 至少要有一筆案件資料夾設定');
  }
  return {
    imageExtensions: DEFAULT_IMAGE_EXTENSIONS,
    videoExtensions: DEFAULT_VIDEO_EXTENSIONS,
    maxDimension: DEFAULT_MAX_DIMENSION,
    jpegQuality: DEFAULT_JPEG_QUALITY,
    useHash: false,
    stateFile: './nas_design_image_watcher.state/sync-state.json',
    previewDir: './nas_design_image_watcher.state/previews',
    secretsFile: path.join(__dirname, 'nas_design_image_watcher.secrets.json'),
    dbJsonUrl: '',
    appsScriptUploadUrl: '',
    ...config
  };
}

async function loadSecrets(secretsFile) {
  const secrets = await loadJsonFile(secretsFile, {});
  return { serviceKey: '', ...secrets };
}

function resolvePath(base, value) {
  return path.isAbsolute(value) ? value : path.join(base, value);
}

async function loadState(stateFile) {
  const state = await loadJsonFile(stateFile, {});
  return state || {};
}

async function saveState(stateFile, state) {
  await fs.mkdir(path.dirname(stateFile), { recursive: true });
  await fs.writeFile(stateFile, JSON.stringify(state, null, 2), 'utf8');
}

async function hashFile(filePath) {
  const buffer = await fs.readFile(filePath);
  return crypto.createHash('md5').update(buffer).digest('hex');
}

function classify(fileName, config) {
  const ext = path.extname(fileName).toLowerCase();
  if (config.imageExtensions.includes(ext)) return 'image';
  if (config.videoExtensions.includes(ext)) return 'video';
  return null;
}

async function walkMedia(dir, config) {
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

function formatBytes(bytes) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

function safePreviewName(relPath) {
  return relPath.replace(/[\\/]/g, '__').replace(/[^\w.\-一-龥぀-ゟ゠-ヿ]/g, '_');
}

/**
 * 執行 macOS 內建指令，抓不到指令、或指令執行失敗都不丟例外中斷整個掃描，
 * 而是回傳失敗結果，讓呼叫端決定要不要略過這個檔案並記錄警告。
 */
function runTool(cmd, args) {
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
async function generateVideoFramePng(videoPath, outDir) {
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
function compressToJpeg(srcPath, destPath, { maxDimension, jpegQuality }) {
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
async function buildPreview(media, previewDir, config, warnings) {
  const relName = safePreviewName(path.relative(config.mountRoot, media.filePath));
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

async function scanProject(project, config, state, previewDir, warnings) {
  const folderPath = path.join(config.mountRoot, project.folderPath);
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
  const previousState = state[project.caseId] || { files: {}, lastCapturedRound: -1 };
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
      const previewPath = await buildPreview(media, caseProjectPreviewDir, config, warnings);
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
    nextState: { files: nextFiles, lastCapturedRound: previousState.lastCapturedRound ?? -1 }
  };
}

async function fetchCaseRound(dbJsonUrl, caseId) {
  const response = await fetch(`${dbJsonUrl}${dbJsonUrl.includes('?') ? '&' : '?'}ts=${Date.now()}`, {
    headers: { 'Cache-Control': 'no-store' }
  });
  if (!response.ok) throw new Error(`讀取案件資料庫失敗：HTTP ${response.status}`);
  const data = await response.json();
  const caseRow = (data?.tables?.database?.rows || []).find(row => String(row['案件編號'] || '') === caseId);
  if (!caseRow) return { found: false, status: '', round: null };
  const status = String(caseRow['狀態'] || '');
  if (status !== '過稿中') return { found: true, status, round: null };
  const modificationRows = (data?.tables?.['修改統計表']?.rows || []).filter(row => String(row['案件編號'] || '') === caseId);
  const round = modificationRows.reduce((max, row) => Math.max(max, Number(row['修改次數']) || 0), 0);
  return { found: true, status, round };
}

async function uploadRound({ config, secrets, caseId, round, pendingPreviews }) {
  const images = [];
  for (const item of pendingPreviews) {
    const buffer = await fs.readFile(item.previewPath);
    images.push({
      fileName: path.basename(item.previewPath),
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

function uploadEnabled(config, secrets) {
  return Boolean(config.appsScriptUploadUrl && config.dbJsonUrl && secrets.serviceKey);
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const config = await loadConfig(args.config);
  const configDir = path.dirname(args.config);
  const stateFile = resolvePath(configDir, config.stateFile);
  const previewDir = resolvePath(configDir, config.previewDir);
  const secrets = await loadSecrets(resolvePath(configDir, config.secretsFile));
  const state = await loadState(stateFile);
  const nextState = { ...state };
  const canUpload = uploadEnabled(config, secrets);

  console.log('=== NAS 設計圖檔監控 ===');
  console.log(`掛載根目錄：${config.mountRoot}`);
  console.log(canUpload ? '上傳模式：已啟用（會寫入後台資料庫）' : '上傳模式：未啟用（只掃描＋產生本機預覽圖，不會上傳）');
  console.log('');

  let totalNew = 0, totalChanged = 0, hadError = false;
  const warnings = [];

  for (const project of config.projects) {
    const result = await scanProject(project, config, state, previewDir, warnings);
    console.log(`--- ${result.caseId} ---`);
    console.log(`  資料夾：${result.folderPath}`);

    if (result.error) {
      console.log(`  [錯誤] ${result.error}`);
      hadError = true;
      console.log('');
      continue;
    }

    console.log(`  共 ${result.totalFiles} 個檔案，未變動 ${result.unchangedCount} 個`);
    if (result.newItems.length) {
      console.log(`  新增 ${result.newItems.length} 個：`);
      for (const item of result.newItems) {
        console.log(`    + [${item.kind}] ${item.relPath}（${formatBytes(item.size)}）${item.previewPath ? '→ 已產生預覽圖' : '→ 預覽圖產生失敗'}`);
      }
    }
    if (result.changedItems.length) {
      console.log(`  更新 ${result.changedItems.length} 個：`);
      for (const item of result.changedItems) {
        console.log(`    * [${item.kind}] ${item.relPath}（${formatBytes(item.size)}）${item.previewPath ? '→ 已產生預覽圖' : '→ 預覽圖產生失敗'}`);
      }
    }
    if (!result.newItems.length && !result.changedItems.length) {
      console.log('  沒有新增或變動的檔案');
    }

    totalNew += result.newItems.length;
    totalChanged += result.changedItems.length;
    nextState[result.caseId] = result.nextState;

    if (canUpload) {
      try {
        const roundInfo = await fetchCaseRound(config.dbJsonUrl, result.caseId);
        if (!roundInfo.found) {
          console.log('  [輪次判斷] 資料庫裡找不到這個案件編號，略過本輪上傳判斷');
        } else if (roundInfo.round === null) {
          console.log(`  [輪次判斷] 目前狀態為「${roundInfo.status || '（未知）'}」，還不是「過稿中」，先不上傳`);
        } else if (roundInfo.round === result.nextState.lastCapturedRound) {
          console.log(`  [輪次判斷] 第 ${roundInfo.round} 輪已經抓取過，略過`);
        } else if (!result.pendingPreviews.length) {
          console.log(`  [輪次判斷] 案件已進入第 ${roundInfo.round} 輪過稿中，但資料夾裡沒有偵測到任何新的圖片/影片可上傳`);
        } else {
          console.log(`  [上傳] 第 ${roundInfo.round} 輪，${result.pendingPreviews.length} 張預覽圖上傳中...`);
          const uploadResult = await uploadRound({ config, secrets, caseId: result.caseId, round: roundInfo.round, pendingPreviews: result.pendingPreviews });
          console.log(`  [上傳完成] 已寫入 ${uploadResult.count} 張圖片，案件修訂版 ${uploadResult.jsonRevision}`);
          const files = nextState[result.caseId].files;
          for (const item of result.pendingPreviews) {
            if (files[item.relPath]) files[item.relPath].assignedRound = roundInfo.round;
          }
          nextState[result.caseId].lastCapturedRound = roundInfo.round;
        }
      } catch (error) {
        warnings.push(`案件 ${result.caseId} 輪次判斷/上傳失敗：${error.message}`);
        console.log(`  [錯誤] 輪次判斷/上傳失敗：${error.message}`);
        hadError = true;
      }
    }

    console.log('');
  }

  console.log(`=== 掃描完成：新增 ${totalNew} 個、更新 ${totalChanged} 個 ===`);
  if (!canUpload) {
    console.log('尚未設定 appsScriptUploadUrl／dbJsonUrl／serviceKey 三者其中之一，只產生本機預覽圖，不會上傳。');
  }
  if (warnings.length) {
    console.log('');
    console.log(`警告（${warnings.length} 則）：`);
    warnings.forEach(warning => console.log(`  - ${warning}`));
  }

  await saveState(stateFile, nextState);
  if (hadError) process.exitCode = 1;
}

main().catch(error => {
  console.error('執行失敗：', error);
  process.exitCode = 1;
});

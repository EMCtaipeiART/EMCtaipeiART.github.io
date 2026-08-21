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
// 很多客戶的 NAS 資料夾是「一個月份資料夾裡混著多個案件的檔案」，同一層底下常見會
// 額外有一個純粹放共用參考素材（不是這次要交的設計圖）的子資料夾，設計師習慣叫它
// 「Links」。這份清單是 walkMedia() 掃描時一律跳過（不遞迴進去、裡面的圖片/影片
// 完全不會被當成候選）的資料夾名稱，比對時去頭尾空白＋忽略英文大小寫。可以在
// config 裡用 ignoreFolderNames 覆蓋或加長這份清單，不需要改程式碼。
export const DEFAULT_IGNORE_FOLDER_NAMES = ['Links'];
// 跟 upload/Code.gs 的 MAX_CASE_DESIGN_IMAGES_PER_REQUEST 保持一致——Apps Script
// 那端一次請求超過這個數量會直接整批拒絕（丟錯，不會部分成功）。這裡在送出前
// 先依這個上限切成多個請求，避免案件資料夾一次有超過上限的待上傳檔案時，
// 整個案件永遠卡住（每次排程都重新嘗試同一批、每次都整批失敗，見 uploadPendingRound()）。
export const MAX_IMAGES_PER_UPLOAD_REQUEST = 20;
// POST 已送出後若回應逾時，遠端可能其實已完成 Drive／資料庫寫入。下一輪先
// 等靜態資料庫發布並核對，不要一分鐘後立刻重送；超過這段時間仍查不到才重試。
export const AMBIGUOUS_UPLOAD_RETRY_GRACE_MS = 5 * 60 * 1000;

// 鎖檔案內容讀不到有效 PID（見下方 acquireLock 說明）時，用「檔案是幾時建立
// 的」判斷要不要視為過期──這個數字要遠大於單次掃描實際會花的時間（NAS／
// Drive 上傳都可能拖到幾分鐘），避免正常還在跑的執行被誤判成過期而被蓋過去。
export const STALE_LOCK_MS = 15 * 60 * 1000;

/**
 * 這把鎖保護的是「同一份 sync-state.json 同時只能有一個行程在讀取／判斷／
 * 寫回」，不是只保護 nas_design_image_watcher.mjs 自己的排程重疊執行。
 * 2026-08-19 第一次修這個問題時，鎖只加在 nas_design_image_watcher.mjs 的
 * main() 裡，只防得住「crontab／launchd 同時各自啟動一份這支排程程式」；
 * 但 nas_folder_picker_server.mjs（設計師在網頁上選好資料夾、按「選擇這個
 * 資料夾並備份」當下立即執行一次的 backupSelectedFolder()）完全是另一個獨
 * 立行程、常駐在背景（launchd 服務），會讀寫同一份 sync-state.json 卻完全
 * 沒有跟排程程式互相協調——如果設計師點擊「立即備份」的時間點，剛好落在
 * 每分鐘一次的排程正在掃描同一個案件的過程中，兩邊各自讀到「這批檔案還沒
 * 歸類到任何一輪」的舊狀態、各自呼叫 Apps Script 上傳，就會把同一批圖片
 * 傳兩次（各自產生一份獨立的 Drive 檔案，內容相同但網址不同）。案件
 * 26080103 在 2026-08-20 實際重現過這個現象（兩次 addCaseDesignImages 相
 * 隔約 72 秒，時間點正好對得上排程每分鐘一次的間隔），這是排程與選擇器
 * 「共用同一份狀態，卻各自上鎖」這個設計缺口第一次被真正踩到，不是
 * 2026-08-19 那次已經修過的同一個問題重演。修法是把鎖搬到這裡，讓兩支程式
 * 呼叫同一個 acquireLock(lockFile)，`lockFile` 只要是同一個 stateFile 算出
 * 來的路徑，兩邊天然就會搶同一把鎖，不需要另外設計跨行程通訊。
 *
 * 鎖的建立本身用 fs.writeFile(lockFile,pid,{flag:'wx'})（O_EXCL 獨佔建立，
 * 檔案已存在就直接丟 EEXIST）而不是「先讀檔案確認沒有鎖、再寫入」——這一步
 * 本身是原子的，兩個行程不會同時建立成功。但這裡曾經踩到一個更隱蔽的第二層
 * race：即使「建立鎖檔案」這個動作本身是原子的，「建立檔案」跟「把 PID 內容
 * 寫進檔案」終究還是兩個分開的系統呼叫，中間有一段極短暫的空檔——如果另一
 * 個行程剛好在這個空檔讀到「鎖檔案存在、但內容還是空字串」，若只靠「能不能
 * 從內容解析出一個活著的 PID」判斷是否過期，空字串會被 `Number('')` 解析成
 * `0`，`0>0` 為假，被誤判成「沒有有效 PID、是過期的鎖」而直接蓋過去執行——
 * 兩個行程因此一起衝過鎖，各自把同一批圖片上傳一次。這正是 2026-08-19 追查
 * 案件 26080079／26080045 重複上傳、在這台機器上實際用兩個並行行程重現到的
 * 根本原因（用真的兩個 `node` 行程搶同一把鎖測試，在套用下面的修正前，
 * 五次裡有四次都真的兩邊都跑完並各自上傳成功）。
 *
 * 修正方式：讀不到有效 PID 時，不再直接當成「過期、可以蓋過去」，而是改看
 * 鎖檔案的建立時間距離現在多久（`STALE_LOCK_MS`）——剛建立的極短時間內讀不
 * 到內容，保守判定成「別人正在建立中，鎖仍然有效」，這次跳過；真的超過合理
 * 時間都沒能讀到有效內容，才視為異常過期，清掉重建。讀得到有效 PID 時，維持
 * 原本用 `process.kill(pid,0)` 立即判斷活著與否的快速路徑，不用等到過期時間。
 */
export async function acquireLock(lockFile) {
  await fs.mkdir(path.dirname(lockFile), { recursive: true });
  try {
    await fs.writeFile(lockFile, String(process.pid), { flag: 'wx' });
    return true;
  } catch (error) {
    if (error.code !== 'EEXIST') throw error;
  }
  // 鎖檔案已經存在——先記下它的建立時間，供讀不到有效 PID 時的過期判斷使用。
  let stat;
  try {
    stat = await fs.stat(lockFile);
  } catch (error) {
    if (error.code === 'ENOENT') return acquireLock(lockFile); // 剛好被上一個行程釋放，重試一次。
    throw error;
  }
  let raw = '';
  try {
    raw = await fs.readFile(lockFile, 'utf8');
  } catch (error) {
    if (error.code !== 'ENOENT') throw error; // ENOENT 就維持 raw='' 走下面的空內容分支。
  }
  const pid = Number(raw.trim());
  if (Number.isInteger(pid) && pid > 0) {
    try {
      process.kill(pid, 0);
      return false; // 那個 PID 還活著，代表上一次還在跑，這次跳過。
    } catch {
      // PID 已經不存在，是過期的鎖（上次意外中斷留下的），可以蓋掉繼續。
    }
  } else if (Date.now() - stat.mtimeMs < STALE_LOCK_MS) {
    return false; // 讀不到有效 PID，但鎖檔案是最近才建立的，保守視為仍在使用中。
  }
  try {
    await fs.unlink(lockFile);
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
  }
  return acquireLock(lockFile); // 用同一套 O_EXCL 邏輯重新嘗試一次，不直接假設自己一定搶得到。
}

export async function releaseLock(lockFile) {
  try {
    await fs.unlink(lockFile);
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
  }
}

/**
 * 給「使用者正在等待結果」的互動式路徑用（nas_folder_picker_server.mjs 的
 * 立即備份）——跟排程程式那種「搶不到就直接跳過這次」不同，這裡值得稍微
 * 等一下，因為排程每分鐘只會佔用鎖幾秒到數十秒（單一案件的掃描＋上傳），
 * 使用者體感等待幾秒到幾十秒仍然合理，好過整次備份無聲失敗、要等下一輪
 * 排程才會補上。逾時仍然搶不到鎖時回傳 false，呼叫端要能優雅降級（沿用
 * 既有「備份失敗不擋路徑登記」的設計，不是拋例外中斷整個流程）。
 */
export async function acquireLockWithWait(lockFile, { timeoutMs = 45000, pollIntervalMs = 1500 } = {}) {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    if (await acquireLock(lockFile)) return true;
    if (Date.now() >= deadline) return false;
    await new Promise(resolve => setTimeout(resolve, pollIntervalMs));
  }
}

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
    ignoreFolderNames: DEFAULT_IGNORE_FOLDER_NAMES,
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

/**
 * 判斷資料夾名稱是不是應該整個跳過（例如「Links」這類共用參考素材資料夾，
 * 不是這個案件實際要交付的設計圖）。去頭尾空白＋忽略英文大小寫比對，
 * 沿用跟 resolveDefaultBrowsePath 猜客戶資料夾一樣的寬鬆比對慣例。
 */
export function isIgnoredFolderName(name, ignoreFolderNames) {
  const trimmed = String(name || '').trim().toLowerCase();
  if (!trimmed) return false;
  return (ignoreFolderNames || []).some(entry => String(entry || '').trim().toLowerCase() === trimmed);
}

/**
 * 只掃描 dir「這一層」的檔案，刻意不遞迴進任何子資料夾——案件指定的來源
 * 資料夾底下常常還有其他子資料夾（例如舊版本、參考素材、或單純是設計師
 * 習慣分類用的子目錄），如果遞迴進去，很容易把不屬於這次交付、甚至不屬於
 * 這個案件的檔案也一併抓進來（案件 26080078 的關鍵字比對問題排除之後，
 * 使用者又進一步反映希望連子資料夾的內容都完全不要考慮，只認資料夾本層）。
 * `isIgnoredFolderName()`／`ignoreFolderNames` 這兩個既有的「忽略特定子
 * 資料夾名稱」機制，在不遞迴的前提下已經沒有實際作用（本來就不會進去任何
 * 子資料夾），保留只是避免不必要的變動，沒有清除。
 */
export async function walkMedia(dir, config) {
  const results = [];
  let entries;
  try {
    entries = await fs.readdir(dir, { withFileTypes: true });
  } catch (error) {
    throw new Error(`無法讀取資料夾：${dir}（${error.code || error.message}）`);
  }
  for (const entry of entries) {
    if (entry.name.startsWith('.') || entry.isDirectory()) continue;
    if (!entry.isFile()) continue;
    const kind = classify(entry.name, config);
    if (kind) results.push({ filePath: path.join(dir, entry.name), kind });
  }
  return results;
}

/**
 * 判斷一個檔案是不是屬於這個案件——同一個月份/客戶資料夾常常混著好幾個
 * 案件的檔案（沒有各自獨立的子資料夾），只能靠檔名裡有沒有包含案件專屬
 * 的關鍵字（例如產品代號）來分辨。沒有設定關鍵字時（案件還沒補填、或
 * 真的是專屬資料夾不需要）回傳 true，不做任何篩選，維持原本「整個資料夾
 * 都算」的行為，向下相容舊案件。有設定關鍵字時，用不分大小寫的子字串比對
 * ——關鍵字通常是產品代號/專案名稱片段，不會剛好是正規表示式特殊字元，
 * 用簡單的 includes 比對，不做模糊比對（寧可比對不到、少抓，也不要比對
 * 錯、抓進其他案件的圖）。
 */
export function matchesKeyword(fileName, keyword) {
  const trimmedKeyword = String(keyword || '').trim();
  if (!trimmedKeyword) return true;
  return String(fileName || '').toLowerCase().includes(trimmedKeyword.toLowerCase());
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

  const allMediaFiles = await walkMedia(folderPath, config);
  // 有設定「檔名關鍵字」時，先把不屬於這個案件的檔案整批濾掉——它們完全不會被
  // 拿去跟上次掃描的狀態比對，不會被記錄進 state、也不會出現在 newItems/
  // changedItems/pendingPreviews 裡，就像它們根本不在這個資料夾一樣。這是刻意
  // 的設計：如果之後案件補填/修改了關鍵字，之前沒對到的檔案會被當成「全新」重新
  // 判斷一次（而不是因為曾經被略過而卡住），行為比較好預期。
  const mediaFiles = allMediaFiles.filter(media => matchesKeyword(path.basename(media.filePath), project.keyword));
  const skippedByKeywordCount = allMediaFiles.length - mediaFiles.length;
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
      previewPath: previous ? previous.previewPath : null,
      uploadAttempt: previous ? previous.uploadAttempt : null
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
      entry.uploadAttempt = null;
      if (!previous) newItems.push({ relPath, ...entry });
      else changedItems.push({ relPath, ...entry });
    } else {
      unchangedCount += 1;
    }

    nextFiles[relPath] = entry;
  }

  const pendingPreviews = Object.entries(nextFiles)
    .filter(([, entry]) => entry.assignedRound === null && entry.previewPath)
    .map(([relPath, entry]) => ({
      relPath,
      previewPath: entry.previewPath,
      mtimeMs: entry.mtimeMs,
      size: entry.size,
      uploadAttempt: entry.uploadAttempt
    }));

  return {
    caseId: project.caseId,
    folderPath,
    totalFiles: mediaFiles.length,
    skippedByKeywordCount,
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
      keyword: String(row['設計圖檔名關鍵字'] || '').trim(),
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
    status: String(row['狀態'] || '').trim(),
    keyword: String(row['設計圖檔名關鍵字'] || '').trim()
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

export function countRecordedCaseDesignImages(dbData, caseId, round, fileName) {
  const rows = dbData?.tables?.['修改統計表']?.rows || [];
  const row = rows.find(item => String(item['案件編號'] || '') === String(caseId)
    && (Number(item['修改次數']) || 0) === Number(round));
  if (!row) return 0;
  try {
    const images = JSON.parse(String(row['圖片連結'] || '[]'));
    return Array.isArray(images)
      ? images.filter(item => item && String(item.fileName || '') === String(fileName || '')).length
      : 0;
  } catch {
    return 0;
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

/**
 * 為單一案件、輪次與來源檔案版本產生穩定的防重鍵。
 *
 * 這個值不含預覽圖的暫存路徑，因為暫存資料夾可能搬家；以案件、輪次、NAS
 * 相對路徑、mtime 與檔案大小識別同一個來源版本。相同檔案因網路逾時重送時
 * 會得到完全相同的 key；同名檔案內容更新（mtime／size 至少一者改變）或進入
 * 下一修改輪次時則會得到新 key，仍可正常建立新版圖片。
 */
export function createCaseDesignUploadDedupeKey({ caseId, round, relPath, mtimeMs, size, fallbackDigest = '' }) {
  const normalizedMtime = Number.isFinite(Number(mtimeMs)) ? String(Number(mtimeMs)) : '';
  const normalizedSize = Number.isFinite(Number(size)) ? String(Number(size)) : '';
  return crypto.createHash('sha256').update([
    String(caseId || ''),
    String(Number(round) || 0),
    String(relPath || ''),
    normalizedMtime,
    normalizedSize,
    String(fallbackDigest || '')
  ].join('\0')).digest('hex');
}

export async function uploadRound({ config, secrets, caseId, round, designer, client, year, month, pendingPreviews }) {
  const images = [];
  for (const item of pendingPreviews) {
    const buffer = await fs.readFile(item.previewPath);
    // 舊 state 或外部呼叫端可能還沒有 mtimeMs／size；這時以實際預覽內容雜湊
    // 作為 fallback，仍保證同一份待重送檔案會得到穩定 key。
    const hasSourceVersion = Number.isFinite(Number(item.mtimeMs)) && Number.isFinite(Number(item.size));
    const fallbackDigest = hasSourceVersion ? '' : crypto.createHash('sha256').update(buffer).digest('hex');
    images.push({
      fileName: path.basename(item.relPath),
      mimeType: 'image/jpeg',
      base64: buffer.toString('base64'),
      dedupeKey: createCaseDesignUploadDedupeKey({
        caseId,
        round,
        relPath: item.relPath,
        mtimeMs: item.mtimeMs,
        size: item.size,
        fallbackDigest
      })
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
export async function uploadPendingRound({ config, secrets, dbData, caseId, designer, client, start, pendingPreviews, stateFiles, persistState }) {
  const round = computeRound(dbData, caseId);
  const targetImages = computeTargetImages(dbData, caseId, round);
  let reconciledCount = 0;
  let deferredCount = 0;
  const nowMs = Date.now();
  const eligiblePreviews = [];
  for (const item of pendingPreviews) {
    const entry = stateFiles[item.relPath];
    const attempt = entry && entry.uploadAttempt;
    if (!attempt || !Number.isFinite(Number(attempt.round)) || !Number.isFinite(Number(attempt.atMs))) {
      eligiblePreviews.push(item);
      continue;
    }
    const attemptedRound = Number(attempt.round);
    const currentCount = countRecordedCaseDesignImages(
      dbData,
      caseId,
      attemptedRound,
      path.basename(item.relPath)
    );
    const baselineCount = Math.max(0, Number(attempt.baselineCount) || 0);
    if (currentCount > baselineCount) {
      entry.assignedRound = attemptedRound;
      entry.uploadAttempt = null;
      reconciledCount += 1;
      continue;
    }
    if (nowMs - Number(attempt.atMs) < AMBIGUOUS_UPLOAD_RETRY_GRACE_MS) {
      deferredCount += 1;
      continue;
    }
    entry.uploadAttempt = null;
    eligiblePreviews.push(item);
  }

  let targetedPreviews = eligiblePreviews;
  let skippedByTarget = 0;
  let targetFallback = false;
  if (targetImages) {
    const targetSet = new Set(targetImages);
    const matched = eligiblePreviews.filter(item => targetSet.has(path.basename(item.relPath)));
    if (matched.length) {
      targetedPreviews = matched;
      skippedByTarget = eligiblePreviews.length - matched.length;
    } else if (eligiblePreviews.length) {
      // PM 指定的「待修改圖片」檔名，這次資料夾裡的新增/變動檔案一個都對不
      // 上——最常見的原因是設計師把修好的檔案存成新檔名（例如補上新的日期／
      // 版本號，跟原始檔名不同），不是真的沒有東西可以上傳。與其讓這一輪永
      // 遠卡在「偵測到檔案、卻每次都被過濾掉」（狀態快取會把這些檔案標記成
      // 「還沒歸類」，下次掃描只要檔案內容沒再變動就不會重新判斷成新增，等
      // 於永久卡住），改成退回「沒有指定清單」的行為，把這輪所有待歸類的新
      // 檔案都當作這次修改的回覆一併上傳；多傳的檔案之後可以在案件詳情／修
      // 改紀錄彈窗裡個別刪除，比整輪永遠卡住不上傳更安全。
      targetFallback = true;
      skippedByTarget = 0;
    }
  }
  if (!targetedPreviews.length) {
    if (reconciledCount && persistState) await persistState();
    const message = reconciledCount
      ? `已確認先前上傳成功 ${reconciledCount} 張，不再重送`
      : deferredCount
        ? `前次上傳結果仍在確認中，暫緩重送 ${deferredCount} 張`
        : '沒有偵測到可上傳的圖片/影片';
    return { round, uploadedCount: 0, reconciledCount, deferredCount, skippedByTarget, message };
  }
  const { year, month } = computeYearMonth(start);
  // 依 MAX_IMAGES_PER_UPLOAD_REQUEST 切成多個請求依序送出（不是一次全部塞進同一個
  // request）——Apps Script 端對單次請求的圖片數量有硬性上限，超過會整批拒絕；
  // 這裡改成一批一批送，每批成功就先把該批檔案標記成已歸類這一輪並繼續下一批，
  // 就算送到一半失敗，前面已經成功的批次也不會遺失或下次重傳，只有還沒送成功
  // 的部分會在下次排程時當作「還沒歸類」重新嘗試（届時待處理數量已經變少）。
  let uploadedCount = 0;
  let jsonRevision;
  for (let offset = 0; offset < targetedPreviews.length; offset += MAX_IMAGES_PER_UPLOAD_REQUEST) {
    const chunk = targetedPreviews.slice(offset, offset + MAX_IMAGES_PER_UPLOAD_REQUEST);
    const attemptAtMs = Date.now();
    for (const item of chunk) {
      const entry = stateFiles[item.relPath];
      if (!entry) continue;
      entry.uploadAttempt = {
        round,
        atMs: attemptAtMs,
        baselineCount: countRecordedCaseDesignImages(dbData, caseId, round, path.basename(item.relPath))
      };
    }
    // 必須在 POST 前先落地：即使 Node 行程在等待回應時被中止，下一輪也知道
    // 這批可能已在遠端生效，會先核對資料庫而不是立刻重送。
    if (persistState) await persistState();
    const uploadResult = await uploadRound({ config, secrets, caseId, round, designer, client, year, month, pendingPreviews: chunk });
    for (const item of chunk) {
      if (stateFiles[item.relPath]) {
        stateFiles[item.relPath].assignedRound = round;
        stateFiles[item.relPath].uploadAttempt = null;
      }
    }
    uploadedCount += uploadResult.count;
    jsonRevision = uploadResult.jsonRevision;
  }
  return { round, uploadedCount, reconciledCount, deferredCount, skippedByTarget, targetFallback, jsonRevision };
}

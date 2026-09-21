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

import { promises as fs, default as fsSync } from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import net from 'node:net';
import { execFileSync, spawnSync } from 'node:child_process';

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

function trackedRound(value) {
  if (value === null || value === undefined || value === '') return null;
  const round = Number(value);
  return Number.isFinite(round) && round >= 0 ? round : null;
}

export function changedFileRoundState(previous) {
  const assignedRound = trackedRound(previous?.assignedRound);
  const pendingAfterRound = trackedRound(previous?.pendingAfterRound);
  const attemptedRound = trackedRound(previous?.uploadAttempt?.round);
  const completedRounds = [assignedRound, pendingAfterRound, attemptedRound]
    .filter(round => round !== null);
  if (!completedRounds.length) {
    return { assignedRound: null, pendingAfterRound: null, uploadAttempt: null };
  }
  return {
    assignedRound,
    pendingAfterRound: Math.max(...completedRounds),
    uploadAttempt: previous?.uploadAttempt || null
  };
}

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

/**
 * 監控程式每分鐘執行一次、輸出全部附加在同一個記錄檔裡，跑了幾個月會長到幾百 MB
 * （2026-09-16 實際看到 331 MB、616 萬行）。超過上限就就地清空：用 ftruncate 而不是
 * 換檔名，這樣 crontab 的 `>>` 與 launchd 的 StandardOutPath 都會接著從頭寫，不會
 * 繼續寫進一個已經被改名、看不到的舊檔案。
 */
export const MAX_LOG_BYTES = 20 * 1024 * 1024;

export function shouldTruncateLog(sizeBytes, maxBytes = MAX_LOG_BYTES) {
  return Number.isFinite(Number(sizeBytes)) && Number(sizeBytes) > Number(maxBytes);
}

export function truncateHugeLog({ fd = 1, maxBytes = MAX_LOG_BYTES } = {}) {
  try {
    const stat = fsSync.fstatSync(fd);
    if (!stat.isFile() || !shouldTruncateLog(stat.size, maxBytes)) return false;
    fsSync.ftruncateSync(fd, 0);
    return true;
  } catch {
    return false; // 記錄檔整理失敗不該影響備份本身
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

/** 每台電腦自己的補充設定（例如 designerName「這台電腦是哪位設計師的」）放在設定檔旁邊的
 * nas_design_image_watcher.local.json，蓋過共用設定。不進 git（見 .gitignore），重新安裝／更新腳本也不會被覆蓋。 */
export function localConfigPath(configPath) {
  return path.join(path.dirname(configPath), 'nas_design_image_watcher.local.json');
}

export async function loadConfig(configPath) {
  const shared = await loadJsonFile(configPath);
  const local = shared ? (await loadJsonFile(localConfigPath(configPath), {})) : {};
  const config = shared ? { ...shared, ...(local && typeof local === 'object' ? local : {}) } : shared;
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

/**
 * 找出「現在真的可以讀取」的 NAS 掛載根目錄。
 *
 * 設定檔裡的 mountRoot 是安裝當下偵測到的路徑，但之後可能失效：NAS 沒連線、開機後還沒掛載、
 * 或 macOS 重複掛載時把磁碟掛成「設計部-1」。直接拿失效的路徑去讀，只會得到 ENOENT 這種
 * 看不懂的錯誤（2026-09-16 設計師電腦實際遇到）。這裡依序找：設定值 →「/Volumes/期望名稱」
 * → 有 -1、-2 後綴的同名磁碟；都找不到就回空字串，由呼叫端顯示「請先連上 NAS」。
 */
export async function resolveMountRoot(config) {
  const candidates = [];
  const configured = String(config?.mountRoot || '').trim();
  if (configured) candidates.push(configured);
  const expected = String(config?.expectedVolumeName || '').trim();
  if (expected) candidates.push(path.join('/Volumes', expected));
  for (const candidate of candidates) {
    if (await directoryExists_(candidate)) return candidate;
  }
  if (!expected) return '';
  let volumes = [];
  try {
    volumes = await fs.readdir('/Volumes');
  } catch {
    volumes = [];
  }
  for (const name of volumes.filter(item => item.startsWith(`${expected}-`)).sort()) {
    const candidate = path.join('/Volumes', name);
    if (await directoryExists_(candidate)) return candidate;
  }
  return '';
}

async function directoryExists_(target) {
  try {
    return (await fs.stat(target)).isDirectory();
  } catch {
    return false;
  }
}

/** 設定檔 autoMountNas 明確寫 false 的電腦（安裝器替設計師電腦產生的設定）一律不自動開連線視窗，
 * 由使用者自己在 Finder 連上 NAS，連上之後才會開始掃描；沒寫（例如主機）維持自動連線。 */
export function autoMountEnabled(config) {
  return config?.autoMountNas !== false;
}

/** 沒掛載時請 Finder 開啟連線（密碼存過 Keychain 就會自動連上）。最多每分鐘觸發一次，避免洗版。 */
let lastMountAttemptAt = 0;
export function requestMount(config, { now = Date.now(), minIntervalMs = 60000, run = null } = {}) {
  if (!autoMountEnabled(config)) return false;
  const smbUrl = String(config?.smbUrl || '').trim();
  if (!smbUrl || now - lastMountAttemptAt < minIntervalMs) return false;
  lastMountAttemptAt = now;
  try {
    (run || ((command, args) => spawnSync(command, args)))('open', [smbUrl]);
    return true;
  } catch {
    return false;
  }
}

/** 遊戲後端（Cloudflare Worker）的預設網址；設定檔可用 officeApiUrl 覆蓋。 */
export const DEFAULT_OFFICE_API_URL = 'https://machi-design-api.machi-chen.workers.dev/api';

/**
 * 回報「這台電腦開著」＋鍵鼠閒置了幾秒給像素辦公室遊戲：遊戲會據此把這位設計師顯示成在座
 * （晚上七點後是加班，中午 12～14 點閒置著是用餐），
 * 超過 5 分鐘沒收到就當作關機／睡眠，自動顯示下班。排程每分鐘都會跑一次，所以不論 NAS 有沒有連上、
 * 有沒有案件要掃描都要送（電腦開著本身就是重點），因此放在 watcher 一開始、任何提早結束的判斷之前。
 * 沒設定 designerName（沒有安裝到設計師電腦、或共用電腦）就完全不送；失敗（沒網路、後端暫時掛掉）
 * 靜默略過，不影響掃描——最多就是遊戲晚幾分鐘才更新。
 */
/**
 * 鍵盤滑鼠閒置了幾秒。遊戲用這個判斷午休：12～14 點電腦開著、但人已經離開座位去吃飯。
 * macOS 讀 IOHIDSystem 的 HIDIdleTime（奈秒），Windows 用 GetLastInputInfo（毫秒）。
 * 查不到（其他作業系統、指令不在、逾時）就回 null——後端收不到這個欄位就不會判成用餐，
 * 維持原本的在座，不會誤判。
 */
export function currentIdleSeconds({ platform = process.platform, execImpl = execFileSync } = {}) {
  try {
    if (platform === 'darwin') {
      const stdout = String(execImpl('/usr/sbin/ioreg', ['-c', 'IOHIDSystem'], { encoding: 'utf8', timeout: 3000, maxBuffer: 8 * 1024 * 1024, stdio: ['ignore', 'pipe', 'ignore'] }));
      // HIDIdleTime 在 IOHIDSystem 底下好幾層，不能用 -d 限制深度，否則整個欄位都不會印出來。
      const match = stdout.match(/"HIDIdleTime"\s*=\s*(\d+)/);
      if (!match) return null;
      return Math.floor(Number(match[1]) / 1e9);
    }
    if (platform === 'win32') {
      const script = '$s=\'[DllImport("user32.dll")]public static extern bool GetLastInputInfo(ref LASTINPUTINFO i);[StructLayout(LayoutKind.Sequential)]public struct LASTINPUTINFO{public uint cbSize;public uint dwTime;}\';'
        + '$t=Add-Type -MemberDefinition $s -Name W -Namespace I -PassThru;$i=New-Object I.W+LASTINPUTINFO;$i.cbSize=8;[void]$t::GetLastInputInfo([ref]$i);'
        + '[Environment]::TickCount - $i.dwTime';
      const stdout = String(execImpl('powershell', ['-NoProfile', '-NonInteractive', '-Command', script], { encoding: 'utf8', timeout: 5000, stdio: ['ignore', 'pipe', 'ignore'] }));
      const ms = Number(String(stdout).trim());
      if (!Number.isFinite(ms) || ms < 0) return null;
      return Math.floor(ms / 1000);
    }
  } catch { return null; }
  return null;
}

export async function sendPresenceHeartbeat(config, secrets, { fetchImpl = globalThis.fetch, timeoutMs = 4000, idleImpl = currentIdleSeconds } = {}) {
  const name = String(config?.designerName || '').trim();
  if (!name) return { sent: false, reason: 'no-designer-name' };
  const serviceKey = String(secrets?.serviceKey || '').trim();
  if (!serviceKey) return { sent: false, reason: 'no-service-key' };
  const url = String(config?.officeApiUrl || DEFAULT_OFFICE_API_URL).trim();
  const idleSeconds = idleImpl();
  try {
    const response = await fetchImpl(url, {
      method: 'POST',
      headers: { 'Content-Type': 'text/plain;charset=UTF-8' },
      body: JSON.stringify({ action: 'pixelOfficeHeartbeat', name, serviceKey, ...(idleSeconds === null ? {} : { idleSeconds }) }),
      signal: AbortSignal.timeout(timeoutMs)
    });
    const data = await response.json().catch(() => ({}));
    if (!data?.ok) return { sent: false, reason: 'rejected', message: String(data?.error || `HTTP ${response.status}`) };
    return { sent: true, status: data.status };
  } catch (error) {
    return { sent: false, reason: 'network', message: error?.message || String(error) };
  }
}

/**
 * 排程（cron）每分鐘都會重新啟動一個全新的 Node 行程，所以上面 requestMount() 記在記憶體變數裡的
 * 「一分鐘內不重複」對排程完全沒用——每一輪 lastMountAttemptAt 都是 0，開機後 NAS 還沒連上的那段時間，
 * Finder 就每分鐘跳出一次連線視窗。下面這組改成：
 *   1. 先探測 NAS 主機的 SMB 埠（445）——連不上代表網路／NAS 還沒就緒，靜默等待、完全不跳視窗；
 *   2. 連得上才請 Finder 連線，並在同一輪等它掛載成功，成功後才開始爬；
 *   3. 嘗試紀錄存檔（跨行程有效），失敗次數越多間隔越長（5、10、20、40、上限 60 分鐘），掛載成功就歸零。
 */
export function nasHostFromSmbUrl(smbUrl) {
  const match = String(smbUrl || '').trim().match(/^smb:\/\/(?:[^@/]*@)?([^/:]+)/i);
  if (!match) return '';
  try {
    return decodeURIComponent(match[1]);
  } catch {
    return match[1];
  }
}

/** smb://主機:埠號/分享 的埠號，沒寫就是 SMB 標準的 445。 */
export function nasPortFromSmbUrl(smbUrl) {
  const match = String(smbUrl || '').trim().match(/^smb:\/\/(?:[^@/]*@)?[^/:]+:(\d{1,5})(?:\/|$)/i);
  return match ? Number(match[1]) : 445;
}

export function probeNasPort(host, { port = 445, timeoutMs = 3000, connect = net.connect } = {}) {
  return new Promise(resolve => {
    if (!host) return resolve(false);
    let settled = false;
    const finish = ok => {
      if (settled) return;
      settled = true;
      try { socket.destroy(); } catch { /* ignore */ }
      resolve(ok);
    };
    let socket;
    try {
      socket = connect({ host, port });
    } catch {
      return resolve(false);
    }
    socket.setTimeout(timeoutMs);
    socket.once('connect', () => finish(true));
    socket.once('timeout', () => finish(false));
    socket.once('error', () => finish(false));
  });
}

/** 已經失敗 failures 次之後，下一次才可以再請 Finder 連線的最短間隔。 */
export function mountRetryDelayMs(failures) {
  const count = Math.max(0, Number(failures) || 0);
  if (!count) return 0;
  return Math.min(5 * 60000 * 2 ** (count - 1), 60 * 60000);
}

export async function readMountAttempt(file) {
  const data = (await loadJsonFile(file, {})) || {};
  return { lastAttemptAt: Number(data.lastAttemptAt) || 0, failures: Number(data.failures) || 0 };
}

export async function resetMountAttempts(file) {
  if (!file) return;
  await fs.rm(file, { force: true }).catch(() => {});
}

/**
 * 回傳 { mountRoot, reason }：mountRoot 有值代表已經掛載可以開始掃描；沒有值時 reason 是
 * 'manual'（這台電腦設定成手動連線，不會開視窗）、'no-smb-url'（設定檔沒有連線位址）、'unreachable'（NAS 還連不上，靜默等待）、'backoff'（還在
 * 上次嘗試後的等待間隔內）、'timeout'（請 Finder 連線了，但等不到掛載，多半是在等輸入密碼）。
 */
export async function connectNasAndWait(config, {
  stateFile,
  now = Date.now(),
  probe = (host, port) => probeNasPort(host, { port }),
  run = (command, args) => spawnSync(command, args),
  sleep = ms => new Promise(resolve => setTimeout(resolve, ms)),
  waitMs = 60000,
  pollMs = 2000
} = {}) {
  if (!autoMountEnabled(config)) return { mountRoot: '', reason: 'manual' };
  const smbUrl = String(config?.smbUrl || '').trim();
  if (!smbUrl) return { mountRoot: '', reason: 'no-smb-url' };
  if (!(await probe(nasHostFromSmbUrl(smbUrl), nasPortFromSmbUrl(smbUrl)))) return { mountRoot: '', reason: 'unreachable' };
  const previous = await readMountAttempt(stateFile);
  if (previous.failures && now - previous.lastAttemptAt < mountRetryDelayMs(previous.failures)) {
    return { mountRoot: '', reason: 'backoff' };
  }
  await fs.mkdir(path.dirname(stateFile), { recursive: true });
  await fs.writeFile(stateFile, JSON.stringify({ lastAttemptAt: now, failures: previous.failures + 1 }), 'utf8');
  try {
    run('open', [smbUrl]);
  } catch {
    return { mountRoot: '', reason: 'timeout' };
  }
  for (let waited = 0; waited <= waitMs; waited += pollMs) {
    const mountRoot = await resolveMountRoot(config);
    if (mountRoot) {
      await resetMountAttempts(stateFile);
      return { mountRoot, reason: '' };
    }
    if (waited + pollMs > waitMs) break;
    await sleep(pollMs);
  }
  return { mountRoot: '', reason: 'timeout' };
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
  const previousSealedRound = trackedRound(previousState.sealedRound);
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
      pendingAfterRound: previous ? trackedRound(previous.pendingAfterRound) : null,
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
      // 已經傳過的輪次是歷史快照，不可因設計師再次儲存同一來源檔就被追加新版。
      // 保留 assignedRound，另以 pendingAfterRound 記住「這個新版要等下一輪」；
      // 同一輪內再存幾次都只更新本機預覽，等一修／二修建立後才傳最新版本。
      // uploadAttempt.round 也納入封存基準：POST 回應逾時時遠端可能其實已成功，
      // 不能因來源檔剛好又變動就立刻把另一個版本重送到相同輪次。
      Object.assign(entry, changedFileRoundState(previous));
      if (!previous) newItems.push({ relPath, ...entry });
      else changedItems.push({ relPath, ...entry });
    } else {
      unchangedCount += 1;
    }

    nextFiles[relPath] = entry;
  }

  const pendingPreviews = Object.entries(nextFiles)
    .filter(([, entry]) => (entry.assignedRound === null || trackedRound(entry.pendingAfterRound) !== null) && entry.previewPath)
    .map(([relPath, entry]) => ({
      relPath,
      previewPath: entry.previewPath,
      mtimeMs: entry.mtimeMs,
      size: entry.size,
      pendingAfterRound: entry.pendingAfterRound,
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
    nextState: {
      files: nextFiles,
      ...(previousSealedRound === null ? {} : { sealedRound: previousSealedRound })
    }
  };
}

export async function fetchDatabase(dbJsonUrl, { fetchImpl = fetch } = {}) {
  const response = await fetchImpl(`${dbJsonUrl}${dbJsonUrl.includes('?') ? '&' : '?'}ts=${Date.now()}`, {
    headers: { 'Cache-Control': 'no-store' }
  });
  if (!response.ok) throw new Error(`讀取案件資料庫失敗：HTTP ${response.status}`);
  return response.json();
}

/** 正式站 Worker；設定檔沒寫 workerApiUrl 時用這個（其他設計師電腦的舊設定檔也適用）。 */
export const DEFAULT_WORKER_API_URL = 'https://machi-design-api.machi-chen.workers.dev/';

/**
 * 讀案件資料庫，並確保指定的案件在裡面。
 *
 * GitHub Pages 上的 db.json 要等 Pages 部署完（通常 1～3 分鐘）才看得到剛建立的案件。2026-09-17
 * 案件 26090136 在建立後一分鐘內就從「設計師回覆信」選了 NAS 資料夾，選擇器讀 Pages 查不到案件，
 * 只登記路徑、沒有備份，回覆信也就沒有圖片。查不到時改向 Worker 取即時的案件列補進去；Worker
 * 讀不到就維持原本結果（呼叫端會照舊回報查不到案件），不讓備援本身變成新的失敗點。
 */
export async function fetchDatabaseWithCase(config, caseId, { fetchImpl = fetch } = {}) {
  const id = String(caseId || '').trim();
  if (!/^\d{8}$/.test(id)) return fetchDatabase(config.dbJsonUrl, { fetchImpl });
  // 這個案件的修改紀錄也用 Worker 的即時版本：輪次判斷與「圖片是否已經寫入」都靠它，Pages 落後會判斷錯。
  // 兩邊同時抓，不必排隊等。
  const [pagesData, records] = await Promise.all([
    fetchDatabase(config.dbJsonUrl, { fetchImpl }),
    fetchWorkerModificationRecords(config, id, { fetchImpl })
  ]);
  const dbData = records ? {
    ...pagesData,
    tables: {
      ...(pagesData?.tables || {}),
      '修改統計表': {
        ...(pagesData?.tables?.['修改統計表'] || {}),
        rows: [...(pagesData?.tables?.['修改統計表']?.rows || []).filter(row => String(row?.['案件編號'] || '') !== id), ...records]
      }
    }
  } : pagesData;
  if (findCaseMeta(dbData, id)) return dbData;
  const base = String(config.workerApiUrl || DEFAULT_WORKER_API_URL);
  // bundle 依「開始日期」的年份篩選；先用案件編號的年份，找不到再抓全部。
  for (const year of [`20${id.slice(0, 2)}`, '']) {
    try {
      const url = new URL(base);
      url.searchParams.set('action', 'bundle');
      if (year) url.searchParams.set('year', year);
      url.searchParams.set('ts', String(Date.now()));
      const response = await fetchImpl(url.toString(), { headers: { 'Cache-Control': 'no-store' } });
      if (!response.ok) continue;
      const data = await response.json();
      const row = (Array.isArray(data?.databaseRows) ? data.databaseRows : []).find(item => String(item?.['案件編號'] || '') === id);
      if (!row) continue;
      const tables = dbData?.tables || {};
      const rows = tables.database?.rows || [];
      return { ...dbData, tables: { ...tables, database: { ...(tables.database || {}), rows: [...rows, row] } } };
    } catch {
      // 網路或 Worker 暫時有問題：試下一個條件，全部失敗就回傳原本的資料。
    }
  }
  return dbData;
}

function workerApiUrl(config) {
  return String(config?.workerApiUrl || DEFAULT_WORKER_API_URL);
}

/** 向 Worker 取某案件目前的修改紀錄（含圖片連結）；讀不到回傳 null，由呼叫端退回 Pages 版本。 */
export async function fetchWorkerModificationRecords(config, caseId, { fetchImpl = fetch } = {}) {
  try {
    const response = await fetchImpl(workerApiUrl(config), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
      body: JSON.stringify({ action: 'listModificationRecords', ids: [String(caseId)] })
    });
    if (!response.ok) return null;
    const data = await response.json();
    if (!data?.ok || !Array.isArray(data.rows)) return null;
    return data.rows
      .filter(row => String(row?.['案件編號'] || '') === String(caseId))
      .map(({ rowNumber, ...row }) => row);
  } catch {
    return null;
  }
}

/** 某案件某輪次裡，每個原始檔名已經記錄了幾張圖（用來確認 Google 回錯誤頁時上傳是否其實已完成）。 */
export async function workerRoundImageCounts(config, caseId, round, options = {}) {
  const records = await fetchWorkerModificationRecords(config, caseId, options);
  if (!records) return null;
  const counts = new Map();
  for (const row of records) {
    if (Number(row['修改次數']) !== Number(round)) continue;
    let images = [];
    try { images = JSON.parse(row['圖片連結'] || '[]'); } catch { images = []; }
    for (const image of Array.isArray(images) ? images : []) {
      const name = String(image?.fileName || '');
      if (name) counts.set(name, (counts.get(name) || 0) + 1);
    }
  }
  return counts;
}

/**
 * 一個案件可以對應多個 NAS 來源資料夾（同一個月份/客戶共用資料夾常常混著
 * 好幾個案件，各自要用不同關鍵字篩選）——「設計圖資料夾清單」欄位存 JSON
 * 陣列 [{path,keyword},...]。解析失敗、不是陣列、或是空陣列時，fallback
 * 成用單一「設計圖資料夾連結」／「設計圖檔名關鍵字」組一筆陣列（這兩個舊
 * 欄位繼續當作「目前使用中的第一組」保留字串型別）——這是向下相容既有
 * 單一資料夾案件的關鍵：任何要讀「這個案件有哪些來源資料夾」的地方都要
 * 透過這支函式，不要各自重新實作一次解析＋fallback 邏輯，否則容易漏掉
 * 相容判斷、讓舊案件的既有設定在某個呼叫點突然失效。
 */
export function resolveCaseFolders(row) {
  const raw = String(row?.['設計圖資料夾清單'] || '').trim();
  if (raw) {
    try {
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed)) {
        const cleaned = parsed
          .map(item => ({ path: String(item?.path || '').trim(), keyword: String(item?.keyword || '').trim() }))
          .filter(item => item.path);
        if (cleaned.length) return cleaned;
      }
    } catch {
      // JSON 壞掉就往下 fallback 到單一欄位，不讓整個案件因為這個欄位壞掉而完全抓不到資料夾。
    }
  }
  const legacyPath = String(row?.['設計圖資料夾連結'] || '').trim();
  if (!legacyPath) return [];
  return [{ path: legacyPath, keyword: String(row?.['設計圖檔名關鍵字'] || '').trim() }];
}

/**
 * 同一案件的多個資料夾各自的掃描狀態要彼此獨立，不能共用同一份
 * state[caseId].files，否則兩個不同資料夾剛好有同名檔案時會互相覆蓋彼此
 * 的追蹤狀態（見 scanProject／uploadPendingRound 的呼叫端）。第一個資料夾
 * （index 0）刻意沿用既有、單純的 state[caseId] 這個 key 不變——這是確保
 * 既有只有一個資料夾的案件（不論是新版「設計圖資料夾清單」只填一筆，還是
 * 舊資料完全沒有這個欄位、走 designImageFolderUrl／Keyword fallback）狀態
 * 快取的 key 跟改動前完全一致，不需要任何資料遷移，也不會讓既有追蹤中的
 * 檔案在下一次掃描時被誤判成「全新」而重新上傳一次的關鍵設計。只有第二個
 * 以後的資料夾才會用 `${caseId}::${index}` 這種複合 key，佔用全新、之前
 * 不可能存在的 key，不會跟任何既有資料衝突。
 */
/**
 * 挑出「可以清掉」的本機同步狀態：案件已完成／已取消（或案件本身已經從資料庫刪掉），而且最近
 * keepDays 天內沒有任何檔案變動。
 *
 * 案件結案後，這些狀態與預覽圖留著只是佔空間——2026-09-16 實際看到 sync-state.json 352 KB、
 * 184 個案件鍵（含七月的案件），預覽圖 949 張共 325 MB，而且從來沒有被清理過。清掉之後如果那個
 * 案件又回到修改中，掃描會重新建立狀態，並依資料庫已有的圖片沿用原本的輪次（見
 * recordedRoundsByBaseName），不會把舊圖重新上傳一次。
 */
export function prunableStateKeys(state, dbData, { now = Date.now(), keepDays = 14 } = {}) {
  const rows = dbData?.tables?.database?.rows || [];
  const statusById = new Map(rows.map(row => [String(row['案件編號'] || ''), String(row['狀態'] || '')]));
  const cutoff = now - Math.max(0, Number(keepDays) || 0) * 24 * 60 * 60 * 1000;
  const keys = [];
  for (const [key, entry] of Object.entries(state || {})) {
    const caseId = String(key).split('::')[0];
    const status = statusById.get(caseId);
    const finished = status === undefined || ['已完成', '已取消'].includes(status);
    if (!finished) continue;
    const files = Object.values(entry?.files || {});
    const newestMtime = files.reduce((max, file) => Math.max(max, Number(file?.mtimeMs) || 0), 0);
    if (newestMtime && newestMtime > cutoff) continue; // 最近還有動靜，先留著
    keys.push(key);
  }
  return keys;
}

/** 實際清除：刪掉那些案件的預覽圖資料夾（目錄名稱就是狀態鍵，見 scanProject）與同步狀態。 */
export async function pruneFinishedCaseState({ state, dbData, previewDir, now = Date.now(), keepDays = 14 }) {
  const prunedKeys = prunableStateKeys(state, dbData, { now, keepDays });
  let removedPreviews = 0;
  let freedBytes = 0;
  for (const key of prunedKeys) {
    const dir = path.join(previewDir, key);
    try {
      for (const name of await fs.readdir(dir)) {
        const stat = await fs.stat(path.join(dir, name)).catch(() => null);
        if (stat?.isFile()) {
          removedPreviews += 1;
          freedBytes += stat.size;
        }
      }
      await fs.rm(dir, { recursive: true, force: true });
    } catch { /* 沒有預覽資料夾就只清同步狀態 */ }
    delete state[key];
  }
  return { prunedKeys, removedPreviews, freedBytes };
}

export function folderStateKey(caseId, index) {
  return index === 0 ? String(caseId) : `${caseId}::${index}`;
}

/**
 * 依即時資料動態算出這次要處理的案件清單：狀態＝過稿中或修改中，且至少解析得出
 * 一個來源資料夾（見 resolveCaseFolders）。修改中是有新修改需求時自動改成的狀態，
 * 設計師這段期間放進 NAS 的修改圖一樣要自動追蹤，歸到新的那一輪。
 */
export function discoverProjects(dbData) {
  const rows = dbData?.tables?.database?.rows || [];
  return rows
    .filter(row => ['過稿中', '修改中'].includes(String(row['狀態'] || '')))
    .map(row => ({
      caseId: String(row['案件編號'] || ''),
      folders: resolveCaseFolders(row),
      designer: String(row['設計負責人'] || '').trim() || '未指定設計師',
      client: String(row['客戶別'] || '').trim() || '未分類客戶',
      start: String(row['開始日期'] || '').trim()
    }))
    .filter(project => project.caseId && project.folders.length);
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
  const folders = resolveCaseFolders(row);
  return {
    caseId: String(caseId),
    designer: String(row['設計負責人'] || '').trim() || '未指定設計師',
    client: String(row['客戶別'] || '').trim(),
    start: String(row['開始日期'] || '').trim(),
    status: String(row['狀態'] || '').trim(),
    folders,
    // 沿用既有欄位名稱給只需要「代表性關鍵字」的呼叫端用（例如選擇器畫面替目前正在瀏覽
    // 的第一個資料夾預先帶出提示值）——不代表這是這個案件唯一的一組關鍵字，完整清單要讀
    // folders。
    keyword: folders[0]?.keyword || ''
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

/**
 * 某一輪是不是「真的已經交付過」——封存標記（sealedRound／pendingAfterRound）只有在這件事成立時才算數。
 *
 * 本機同步紀錄是用案件編號當 key，但案件編號會被重複使用：刪掉當月最新的案件後，下一筆新案件會拿到
 * 同一個號碼（見 worker 的 nextCaseId）。刪除案件只會清資料庫，清不到這台 Mac 上的同步紀錄，於是新案件
 * 會繼承舊案件的「初稿已封存」，第一批設計圖全部被當成「封存後才出現的新版」延到下一輪——26090074 就是
 * 這樣整個初稿不見的。改關鍵字或資料夾讓已上傳的檔案離開同步紀錄時，也會留下同樣「有封存、沒檔案」的狀態。
 *
 * 判斷依據有兩個，任一成立就算交付過：
 * 1. 本機同步紀錄裡還有檔案被歸到這一輪（assignedRound）。這是剛上傳完、GitHub Pages 上的 db.json 還沒
 *    重新部署（通常落後 1-3 分鐘）那段期間唯一可靠的證據，少了它封存保護在那個空窗期會失效。
 * 2. 資料庫的「修改統計表」這個案件這一輪確實記錄了圖片。這涵蓋同步紀錄裡的檔案已經不在了的情況。
 */
function roundDelivered({ dbData, caseId, round, stateFiles }) {
  if (Object.values(stateFiles || {}).some(entry => trackedRound(entry?.assignedRound) === round)) return true;
  const rows = dbData?.tables?.['修改統計表']?.rows || [];
  const row = rows.find(item => String(item['案件編號'] || '') === String(caseId)
    && (Number(item['修改次數']) || 0) === Number(round));
  if (!row) return false;
  try {
    const images = JSON.parse(String(row['圖片連結'] || '[]'));
    return Array.isArray(images) && images.length > 0;
  } catch {
    return false;
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

/**
 * 這一輪在資料庫裡已經記錄過的圖片檔名（去掉副檔名、轉小寫）。
 *
 * 用途是擋掉「同一張設計稿被備份兩次」：設計師等不到 NAS 自動備份（GitHub Pages 有部署延遲，
 * 畫面上要過一兩分鐘才看得到圖），就先用「電腦上傳圖片」手動補一次；稍後監控程式照常掃到同一批
 * 來源檔，又上傳一次。兩邊檔名的副檔名往往不同（手動上傳一律轉成 .jpg，監控程式保留原始副檔名
 * 例如 .png／.mp4），所以只比對完整檔名的既有去重會漏掉——2026-09-15 案件 26090107 與 26090081
 * 就是這樣各自留下 .jpg 與 .png 兩份同一張圖。比對去副檔名的檔名才擋得住。
 */
export function recordedRoundImageBaseNames(dbData, caseId, round) {
  const rows = dbData?.tables?.['修改統計表']?.rows || [];
  const row = rows.find(item => String(item['案件編號'] || '') === String(caseId)
    && (Number(item['修改次數']) || 0) === Number(round));
  if (!row) return new Set();
  try {
    const images = JSON.parse(String(row['圖片連結'] || '[]'));
    if (!Array.isArray(images)) return new Set();
    return new Set(images
      .map(item => designImageBaseName(item?.fileName))
      .filter(Boolean));
  } catch {
    return new Set();
  }
}

/**
 * 這個案件「每一個去副檔名檔名」最後出現在哪一輪（不限這一輪）。
 *
 * 給「這台電腦第一次掃描」用：多台設計師電腦各自跑監控程式時，本機同步紀錄是空的，資料夾裡早就備份過的
 * 舊檔案會全部被當成新檔，一口氣上傳到「目前這一輪」——初稿的圖於是又出現在三修裡。有了這份對照表就能
 * 認出「這張在別台電腦已經備份過、屬於第 N 輪」，直接沿用那一輪、不再上傳。
 */
export function recordedRoundsByBaseName(dbData, caseId) {
  const rows = dbData?.tables?.['修改統計表']?.rows || [];
  const map = new Map();
  for (const row of rows) {
    if (String(row['案件編號'] || '') !== String(caseId)) continue;
    const round = Number(row['修改次數']) || 0;
    let images = [];
    try {
      const parsed = JSON.parse(String(row['圖片連結'] || '[]'));
      if (Array.isArray(parsed)) images = parsed;
    } catch {
      images = [];
    }
    for (const image of images) {
      const baseName = designImageBaseName(image?.fileName);
      if (!baseName) continue;
      map.set(baseName, Math.max(map.get(baseName) ?? -1, round));
    }
  }
  return map;
}

/** 這個檔案在這台電腦完全沒有上傳歷史（第一次掃到）。 */
export function fileHasNoLocalHistory(entry) {
  return trackedRound(entry?.assignedRound) === null
    && trackedRound(entry?.pendingAfterRound) === null
    && !entry?.uploadAttempt;
}

export function designImageBaseName(fileName) {
  return String(fileName || '').trim().replace(/\.[^./\\]+$/, '').toLocaleLowerCase();
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
  const body = JSON.stringify({
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
  });
  const fileNames = images.map(image => image.fileName);
  const baseline = await workerRoundImageCounts(config, caseId, round);
  const confirm = baseline ? async () => {
    const after = await workerRoundImageCounts(config, caseId, round);
    if (!after) return null;
    // 每個檔名的筆數都比送出前多，才算這次真的寫進去了。
    if (!fileNames.every(name => (after.get(name) || 0) > (baseline.get(name) || 0))) return null;
    return { success: true, caseId, round, count: fileNames.length, confirmedByWorker: true };
  } : null;
  const data = await postAppsScriptJsonWithRetry(config.appsScriptUploadUrl, body, { confirm });
  if (!data.success) throw new Error(data.message || '上傳失敗');
  return data;
}

export const APPS_SCRIPT_RETRY_DELAYS_MS = Object.freeze([3000, 8000]);

/**
 * Google 偶爾會對 Apps Script Web App 回傳自己的 HTML 錯誤頁（HTTP 404 或 200，不是我們程式的 JSON），
 * 同一個請求重送通常就會成功——2026-09-17 實測同樣內容連送數次，成功與錯誤頁交錯出現，案件
 * 26090136 的立即備份就是被這種錯誤頁擋下。每次拿到錯誤頁先用 confirm() 向 Worker 確認圖片是否其實已寫入，
 * 沒有才重試；只在「回應不是 JSON」時處理；我們程式自己回的錯誤
 * （例如金鑰不正確）不重試。重送是安全的：每張圖都帶穩定的 dedupeKey，Apps Script 會沿用已經
 * 存在的 Drive 檔案，Worker 也會略過已記錄過的圖片，不會重複備份。
 */
export async function postAppsScriptJsonWithRetry(url, body, { fetchImpl = fetch, delaysMs = APPS_SCRIPT_RETRY_DELAYS_MS, wait = ms => new Promise(resolve => setTimeout(resolve, ms)), confirm = null } = {}) {
  let lastError;
  for (let attempt = 0; attempt <= delaysMs.length; attempt += 1) {
    if (attempt) await wait(delaysMs[attempt - 1]);
    let response;
    try {
      // 不自動跟隨轉址：Apps Script 要等 doPost 執行完才會回 302，這時圖片早就寫進資料庫了；
      // 真正慢的是去 Google 取回結果頁（實測常要 30 秒，還常常失敗）。先用 confirm() 向 Worker
      // 確認，確認到了就不必等結果頁，確認不到才照舊去取結果（例如金鑰錯誤要拿到錯誤訊息）。
      response = await fetchImpl(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body, redirect: 'manual' });
      const location = response.headers?.get?.('location');
      if (response.status >= 300 && response.status < 400 && location) {
        if (confirm) {
          const confirmed = await confirm().catch(() => null);
          if (confirmed) return confirmed;
        }
        response = await fetchImpl(location);
      }
    } catch (error) {
      lastError = new Error(`上傳連線失敗：${error.message}`);
      continue;
    }
    const text = await response.text();
    try {
      return JSON.parse(text);
    } catch {
      lastError = new Error(`上傳回應不是合法 JSON（HTTP ${response.status}，已重試 ${attempt} 次）：${text.slice(0, 200)}`);
    }
    // Google 常常是「程式已經跑完、只是取回結果那一步失敗」；先確認資料是否已寫入，寫入了就不用再送。
    if (confirm) {
      const confirmed = await confirm().catch(() => null);
      if (confirmed) return confirmed;
    }
  }
  throw lastError;
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
export async function uploadPendingRound({ config, secrets, dbData, caseId, designer, client, start, pendingPreviews, stateFiles, roundState, persistState }) {
  const round = computeRound(dbData, caseId);
  const targetImages = computeTargetImages(dbData, caseId, round);
  let reconciledCount = 0;
  let deferredCount = 0;
  let waitingForNextRoundCount = 0;
  const nowMs = Date.now();
  const eligiblePreviews = [];
  // sealedRound 是資料夾層級的封存標記。舊版 state 還沒有這個欄位時，從任一
  // 檔案的 assignedRound 反推，免資料遷移也能立刻套用封存規則。
  const inferredSealedRound = Object.values(stateFiles || {}).reduce((max, entry) => {
    const assigned = trackedRound(entry?.assignedRound);
    return assigned === null ? max : Math.max(max, assigned);
  }, -1);
  const storedSealedRound = trackedRound(roundState?.sealedRound);
  const sealedRound = storedSealedRound !== null
    ? Math.max(storedSealedRound, inferredSealedRound)
    : inferredSealedRound;
  // 封存標記本身不夠，這一輪要真的交付過才擋（見 roundDelivered 的說明）。
  const currentRoundDelivered = roundDelivered({ dbData, caseId, round, stateFiles });
  let staleSealClearedCount = 0;
  for (const item of pendingPreviews) {
    const entry = stateFiles[item.relPath];
    const attempt = entry && entry.uploadAttempt;
    if (attempt && Number.isFinite(Number(attempt.round)) && Number.isFinite(Number(attempt.atMs))) {
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
        // 來源檔在不確定的 POST 之後又變動時，pendingAfterRound 仍保留，
        // 新內容會等下一輪；沒有新版待處理時才算整筆完成。
        if (trackedRound(entry.pendingAfterRound) === null) continue;
      } else if (nowMs - Number(attempt.atMs) < AMBIGUOUS_UPLOAD_RETRY_GRACE_MS) {
        deferredCount += 1;
        continue;
      } else {
        entry.uploadAttempt = null;
      }
    }

    let pendingAfterRound = trackedRound(entry?.pendingAfterRound);
    // 「等下一輪」只有在被等的那一輪真的交付過時才成立。沒交付過代表這是殘留標記（重複使用的案件
    // 編號、或檔案離開同步紀錄後留下的封存），清掉讓這個檔案照一般流程上傳，不然會永遠卡在下一輪。
    if (pendingAfterRound !== null && round <= pendingAfterRound
      && !roundDelivered({ dbData, caseId, round: pendingAfterRound, stateFiles })) {
      if (entry) entry.pendingAfterRound = null;
      pendingAfterRound = null;
      staleSealClearedCount += 1;
    }
    if (pendingAfterRound !== null && round <= pendingAfterRound) {
      waitingForNextRoundCount += 1;
      continue;
    }
    // 這輪已經成功上傳過一批後才出現的全新檔案，也不能回頭追加到已封存
    // 的初稿／一修；把它標成等待下一輪。一次掃描同時找到的多張新圖會在
    // 封存前一起進入 eligiblePreviews，所以正常的多圖初稿不受影響。
    if (pendingAfterRound === null && entry?.assignedRound === null && sealedRound >= round && currentRoundDelivered) {
      entry.pendingAfterRound = round;
      waitingForNextRoundCount += 1;
      continue;
    }
    eligiblePreviews.push(item);
  }

  // 這一輪資料庫已經有同一張圖（通常是設計師等不及、先用「電腦上傳圖片」手動補過）就不再上傳：
  // 直接把本機狀態標記成已歸這一輪，下次掃描不會再被當成待上傳，也不會每分鐘重試一次。
  const recordedBaseNames = recordedRoundImageBaseNames(dbData, caseId, round);
  // 另一台電腦（或更早的自己）已經備份過的圖，在這台電腦第一次掃描時不可以重新上傳到現在這一輪。
  const recordedRounds = recordedRoundsByBaseName(dbData, caseId);
  let skippedAlreadyRecordedCount = 0;
  let adoptedFromDatabaseCount = 0;
  const notRecordedPreviews = (recordedBaseNames.size || recordedRounds.size)
    ? eligiblePreviews.filter(item => {
        const baseName = designImageBaseName(path.basename(item.relPath));
        if (!baseName) return true;
        const entry = stateFiles[item.relPath];
        const recordedRound = recordedRounds.get(baseName);
        const alreadyThisRound = recordedBaseNames.has(baseName);
        // ①這一輪已經有同名圖（多半是先用電腦上傳補過）；②這台電腦第一次掃到、但資料庫別的輪次已經有
        // 這張（多半是別台電腦備份過的舊圖）。兩種都不上傳，只把本機狀態補成「已歸在那一輪」。
        const adoptRound = alreadyThisRound
          ? round
          : (recordedRound !== undefined && fileHasNoLocalHistory(entry) ? recordedRound : null);
        if (adoptRound === null) return true;
        if (entry) {
          entry.assignedRound = adoptRound;
          entry.pendingAfterRound = null;
          entry.uploadAttempt = null;
        }
        if (roundState) roundState.sealedRound = Math.max(Number(roundState.sealedRound) || 0, adoptRound);
        if (alreadyThisRound) skippedAlreadyRecordedCount += 1;
        else adoptedFromDatabaseCount += 1;
        return false;
      })
    : eligiblePreviews;

  let targetedPreviews = notRecordedPreviews;
  let skippedByTarget = 0;
  let targetFallback = false;
  if (targetImages) {
    const targetSet = new Set(targetImages);
    const matched = notRecordedPreviews.filter(item => targetSet.has(path.basename(item.relPath)));
    if (matched.length) {
      targetedPreviews = matched;
      skippedByTarget = notRecordedPreviews.length - matched.length;
    } else if (notRecordedPreviews.length) {
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
    if ((reconciledCount || waitingForNextRoundCount || staleSealClearedCount || skippedAlreadyRecordedCount || adoptedFromDatabaseCount) && persistState) await persistState();
    const message = skippedAlreadyRecordedCount
      ? `這一輪已經有同名圖片（手動上傳過），略過 ${skippedAlreadyRecordedCount} 張，不重複備份`
      : adoptedFromDatabaseCount
      ? `這 ${adoptedFromDatabaseCount} 張在資料庫已經有備份紀錄（其他電腦或先前已備份過），沿用原本的輪次，不重複上傳`
      : reconciledCount
      ? `已確認先前上傳成功 ${reconciledCount} 張，不再重送`
      : deferredCount
        ? `前次上傳結果仍在確認中，暫緩重送 ${deferredCount} 張`
        : waitingForNextRoundCount
          ? `本輪圖片已封存，${waitingForNextRoundCount} 張新版會等下一個修改輪次再上傳`
        : '沒有偵測到可上傳的圖片/影片';
    return { round, uploadedCount: 0, reconciledCount, deferredCount, waitingForNextRoundCount, staleSealClearedCount, skippedAlreadyRecordedCount, adoptedFromDatabaseCount, skippedByTarget, message };
  }
  const { year, month } = computeYearMonth(start);
  // 依 MAX_IMAGES_PER_UPLOAD_REQUEST 切成多個請求依序送出（不是一次全部塞進同一個
  // request）——Apps Script 端對單次請求的圖片數量有硬性上限，超過會整批拒絕；
  // 這裡改成一批一批送，每批成功就先把該批檔案標記成已歸類這一輪並繼續下一批，
  // 就算送到一半失敗，前面已經成功的批次也不會遺失或下次重傳，只有還沒送成功
  // 的部分會在下次排程時當作「還沒歸類」重新嘗試（届時待處理數量已經變少）。
  let uploadedCount = 0;
  let jsonRevision;
  // 這次實際送上去的檔名（basename）。呼叫端（picker server 的立即備份）會把它一路回傳到
  // 瀏覽器，讓「設計師回覆信」知道每一個檔案究竟來自哪一個 NAS 資料夾——多選資料夾時光靠
  // 檔名沒辦法反推來源資料夾，影片要附完整路徑（資料夾＋檔名＋副檔名）就一定要有這份對照。
  const uploadedFiles = [];
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
        stateFiles[item.relPath].pendingAfterRound = null;
        stateFiles[item.relPath].uploadAttempt = null;
      }
    }
    if (roundState) roundState.sealedRound = Math.max(Number(roundState.sealedRound) || 0, round);
    for (const item of chunk) uploadedFiles.push(path.basename(item.relPath));
    uploadedCount += uploadResult.count;
    jsonRevision = uploadResult.jsonRevision;
    // 每一批成功後立即保存 assignedRound／sealedRound；後續批次若失敗，已成功
    // 的歷史快照仍然封存，不會在下一次排程被重送或被同輪新版覆蓋。
    if (persistState) await persistState();
  }
  return { round, uploadedCount, uploadedFiles, reconciledCount, deferredCount, waitingForNextRoundCount, staleSealClearedCount, skippedAlreadyRecordedCount, adoptedFromDatabaseCount, skippedByTarget, targetFallback, jsonRevision };
}

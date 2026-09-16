#!/usr/bin/env node
/**
 * NAS 設計圖檔監控程式
 *
 * 用途：定期掃描公司內網 NAS 共用資料夾（SMB），依「案件」找出資料夾裡
 * 新增或有更新的圖片（*.jpg/*.png/*.webp）與影片（*.mp4/*.mov/*.m4v，會自動
 * 擷取一張畫面當紀錄圖），統一壓縮成小尺寸 JPEG 預覽圖。
 *
 * 案件清單完全動態產生：每次執行會先讀一次正式站的案件資料庫（dbJsonUrl），
 * 篩出「狀態＝過稿中或修改中」且「設計圖資料夾連結」欄位有值的案件，不需要在這支
 * 程式的設定檔手動維護一份案件對照表。這個欄位的值來自設計師在網頁上用
 * nas_folder_picker_server.mjs（資料夾選擇器伺服器，另一支獨立的程式，見
 * README「用滑鼠選 NAS 資料夾」一節）選的路徑，或資料庫後台手動填入。
 *
 * 這支程式跟 nas_folder_picker_server.mjs 共用同一份核心邏輯（掃描、壓縮、
 * 影片截圖、輪次判斷、上傳），寫在 nas_design_image_lib.mjs——picker server
 * 在使用者選好資料夾的當下會立即跑一次同樣的邏輯做「馬上備份」，這支程式
 * 則是定時跑一次，接手追蹤「馬上備份」之後陸續新增的檔案，兩者讀寫同一份
 * 狀態快取（sync-state.json），判斷「這個檔案有沒有處理過」的邏輯必須完全
 * 一致，所以共用同一份程式碼，不是各自維護一份。
 *
 * 如果設定檔有填 appsScriptUploadUrl，而且 nas_design_image_watcher.secrets.json
 * 有填 serviceKey，還會做「輪次判斷＋自動上傳」：這一輪還沒抓取過的時候，
 * 把資料夾裡「還沒歸類到任何一輪」的預覽圖打包上傳，寫進後台資料庫的
 * 「修改統計表」（0=初稿，1=一修，2=二修…），Apps Script 那端會依案件的
 * 設計師/客戶別/年度/月份/案件編號 自動建立巢狀資料夾存放。
 *
 * 如果沒有設定 appsScriptUploadUrl／serviceKey，就只會產生本機預覽圖、列
 * 出掃描結果，不會嘗試上傳——方便先確認「掃描＋影片截圖＋壓縮」這幾步在
 * 你的環境上正常，再接上後面的上傳。
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
 *
 * 建議排程執行（5-10 分鐘一次），見 README 的「排程執行」段落。
 */

import path from 'node:path';
import { fileURLToPath } from 'node:url';
import * as lib from './nas_design_image_lib.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// acquireLock()/releaseLock() 這把鎖搬到 nas_design_image_lib.mjs 了（見該檔案
// 開頭註解）——2026-08-20 發現案件 26080103 重複上傳的根因，是這把鎖原本只
// 存在於這支排程程式自己的 main() 裡，防不住 nas_folder_picker_server.mjs
// （常駐的資料夾選擇器伺服器，設計師按「立即備份」時）獨立讀寫同一份
// sync-state.json，兩邊各自判斷成「還沒歸類」而各自上傳了一次。改成兩支
// 程式都呼叫 lib.acquireLock(lockFile)（同一個 stateFile 算出來的同一個
// lockFile 路徑），才能真的互相排隊，不只是防同一支程式自己疊加執行。

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

// 每個資料夾最多等這麼久才放棄搶狀態鎖（通常只會等到前一個資料夾處理完，幾秒內）。
const STATE_LOCK_WAIT_MS = 20000;
// 上傳前重抓資料庫的快取時間。
const DB_CACHE_MS = 20000;

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const config = await lib.loadConfig(args.config);
  const configDir = path.dirname(args.config);
  const stateFile = lib.resolvePath(configDir, config.stateFile);
  // 記錄檔過大時先就地清空（見 lib.truncateHugeLog）。
  if (lib.truncateHugeLog()) console.log('（記錄檔已超過上限，先清空重新開始記錄）');
  // 兩把鎖分開：
  //   執行鎖（.run.lock）只防「上一輪還沒跑完就又被排程叫起來」，資料夾選擇器完全不碰它。
  //   狀態鎖（.lock）保護 sync-state.json，改成每個資料夾要用時才拿、用完立刻放——舊寫法是
  //   整輪掃描（57 個案件、約兩分鐘）從頭到尾佔著它，設計師在網頁上按「選擇資料夾並備份」
  //   等滿 45 秒也搶不到，只會看到「背景監控程式正在同步資料，這次先跳過立即備份」。
  const runLockFile = `${stateFile}.run.lock`;
  if (!(await lib.acquireLock(runLockFile))) {
    console.log('=== NAS 設計圖檔監控 ===');
    console.log('上一次執行還沒結束，這次先跳過，避免同時疊加多個執行個體。');
    return;
  }
  try {
    await runScan(args, config, configDir, stateFile);
  } finally {
    await lib.releaseLock(runLockFile);
  }
}

async function runScan(args, configInput, configDir, stateFile) {
  let config = configInput;
  const previewDir = lib.resolvePath(configDir, config.previewDir);
  const secrets = await lib.loadSecrets(lib.resolvePath(configDir, config.secretsFile));
  // NAS 沒掛載時（關機後還沒連、或被掛成「設計部-1」）沒必要整輪掃描，每個案件都會各自失敗一次。
  // 先確認一次可用的掛載路徑，順便請 Finder 連線，這一輪就跳過，下一分鐘再試。
  const mountRoot = await lib.resolveMountRoot(config);
  if (!mountRoot) {
    lib.requestMount(config);
    console.log('=== NAS 設計圖檔監控 ===');
    console.log(`找不到已掛載的「${config.expectedVolumeName || '設計部'}」，已嘗試請 Finder 連線，這一輪先跳過。`);
    return;
  }
  config = { ...config, mountRoot };
  // 這個物件在整個迴圈過程中會被直接修改、並且每處理完一個案件就立刻存檔一次
  // （見迴圈內的 lib.saveState 呼叫）——不像先前的寫法只在整批案件都跑完後
  // 才統一存檔一次。原因：如果案件清單裡排在後面的某個案件，掃描或上傳過程
  // 丟出沒有被下面 try/catch 接住的例外（例如 NAS 在掃描到一半時斷線），
  // 舊寫法會讓整個 runScan() 中斷、永遠不會執行到最後那行 saveState，這代表
  // 前面已經處理成功、已經真的上傳過的案件，牠們的 assignedRound 標記只存在
  // 於這次執行的記憶體裡、沒有真正寫回 sync-state.json。下次排程執行時，
  // 讀到的還是「這些檔案還沒歸類到任何一輪」的舊狀態，會把同一批圖片重新
  // 判斷成待上傳、再上傳一次——這正是案件 26080079（與同一天另一個案件
  // 26080045）在正式環境實際重現過的重複上傳成因之一。改成每個案件處理完
  // 就立刻落地存檔，即使後面的案件出錯，前面已經成功的案件也不會被拖累。
  const stateLockFile = `${stateFile}.lock`;
  const canUpload = lib.uploadEnabled(config, secrets);

  console.log('=== NAS 設計圖檔監控 ===');
  console.log(`掛載根目錄：${config.mountRoot}`);
  console.log(canUpload ? '上傳模式：已啟用（會寫入後台資料庫）' : '上傳模式：未啟用（只掃描＋產生本機預覽圖，不會上傳）');
  console.log('');

  const dbData = await lib.fetchDatabase(config.dbJsonUrl);
  const projects = lib.discoverProjects(dbData);
  // 上傳前要用「當下最新」的資料庫判斷輪次（掃描途中 PM 可能剛新增修改需求），但每個資料夾都
  // 重抓一次 db.json（57 個案件就是 57 次下載）是整輪變慢的主因之一。改成快取 20 秒：一輪只會
  // 下載幾次，仍然反映得到掃描期間新增的輪次。
  let cachedDb = dbData, cachedDbAt = Date.now();
  const latestDatabase = async () => {
    if (Date.now() - cachedDbAt < DB_CACHE_MS) return cachedDb;
    cachedDb = await lib.fetchDatabase(config.dbJsonUrl);
    cachedDbAt = Date.now();
    return cachedDb;
  };

  if (!projects.length) {
    console.log('目前沒有任何案件符合條件（狀態＝過稿中或修改中，且已透過網頁彈出視窗填寫來源資料夾路徑），本次沒有要掃描的案件。');
    return;
  }

  console.log(`本次動態發現 ${projects.length} 個案件需要掃描：${projects.map(p => p.caseId).join('、')}`);
  console.log('');

  let totalNew = 0, totalChanged = 0, hadError = false;
  const warnings = [];

  for (const project of projects) {
    console.log(`--- ${project.caseId} ---`);
    // 一個案件現在可能對應多個 NAS 資料夾（見 nas_design_image_lib.mjs 的
    // resolveCaseFolders／folderStateKey）——單一資料夾（既有、最常見的情況）
    // 維持跟改動前完全一樣的輸出格式，不多印「資料夾 N/M」這種對這種情況沒有
    // 意義的標籤；只有真的有 2 個以上資料夾時才加上編號，方便分辨是哪一個。
    const multiFolder = project.folders.length > 1;

    for (let folderIndex = 0; folderIndex < project.folders.length; folderIndex += 1) {
      const folder = project.folders[folderIndex];
      const label = multiFolder ? `[資料夾 ${folderIndex + 1}/${project.folders.length}] ` : '';
      const stateKey = lib.folderStateKey(project.caseId, folderIndex);
      const scanInput = { caseId: stateKey, rawFolderPath: folder.path, keyword: folder.keyword, designer: project.designer, client: project.client, start: project.start };

      // scanProject() 內部大部分已知的失敗情況（資料夾不存在、路徑不是資料夾）
      // 都是用回傳 { error } 處理，不會丟例外；但仍有少數情況（例如資料夾存在、
      // 一開始的 fs.stat 通過，但實際列出資料夾內容時 NAS 剛好斷線）會真的
      // 丟出例外。這裡額外包一層 try/catch，確保「這個資料夾掃描失敗」只會跳
      // 過這一個資料夾，不會讓整個迴圈中斷、連累同一案件其他資料夾、或後面還
      // 沒處理到、前面已經處理成功的其他案件（前面成功的都已經各自存檔過，
      // 不受影響）。
      // 只在真正要讀寫同步狀態的這段期間持有狀態鎖，處理完這個資料夾就立刻放開，讓網頁上的
      // 「立即備份」有機會插隊。搶不到就跳過這個資料夾，下一輪排程會再處理。
      if (!(await lib.acquireLockWithWait(stateLockFile, { timeoutMs: STATE_LOCK_WAIT_MS, pollIntervalMs: 1000 }))) {
        console.log(`  ${label}[略過] 同步狀態正被「立即備份」使用，這個資料夾這次先跳過，下一輪排程會再處理`);
        warnings.push(`案件 ${project.caseId} 資料夾「${folder.path}」因同步狀態被佔用而跳過`);
        continue;
      }
      // 每次重新拿到鎖都重讀一次狀態：剛才放開鎖的期間，立即備份可能已經寫入新的歸類結果，
      // 沿用記憶體裡的舊狀態存檔會把它蓋掉。
      const state = await lib.loadState(stateFile);
      try {
      let result;
      try {
        result = await lib.scanProject(scanInput, config, state, previewDir, warnings);
      } catch (error) {
        console.log(`  ${label}[錯誤] 掃描失敗：${error.message}`);
        warnings.push(`案件 ${project.caseId} 資料夾「${folder.path}」掃描失敗：${error.message}`);
        hadError = true;
        continue;
      }
      console.log(`  ${label}資料夾：${result.folderPath}`);

      if (result.error) {
        console.log(`    [錯誤] ${result.error}`);
        hadError = true;
        continue;
      }

      console.log(`    共 ${result.totalFiles} 個檔案，未變動 ${result.unchangedCount} 個${result.skippedByKeywordCount?`（另有 ${result.skippedByKeywordCount} 個檔名不含關鍵字，已略過不列入本案件）`:''}`);
      if (result.newItems.length) {
        console.log(`    新增 ${result.newItems.length} 個：`);
        for (const item of result.newItems) {
          console.log(`      + [${item.kind}] ${item.relPath}（${lib.formatBytes(item.size)}）${item.previewPath ? '→ 已產生預覽圖' : '→ 預覽圖產生失敗'}`);
        }
      }
      if (result.changedItems.length) {
        console.log(`    更新 ${result.changedItems.length} 個：`);
        for (const item of result.changedItems) {
          console.log(`      * [${item.kind}] ${item.relPath}（${lib.formatBytes(item.size)}）${item.previewPath ? '→ 已產生預覽圖' : '→ 預覽圖產生失敗'}`);
        }
      }
      if (!result.newItems.length && !result.changedItems.length) {
        console.log('    沒有新增或變動的檔案');
      }

      totalNew += result.newItems.length;
      totalChanged += result.changedItems.length;
      state[stateKey] = result.nextState;
      // 先把這次掃描結果（含新產生的預覽圖路徑、mtimeMs/size 基準值）存檔一次
      // ——就算接下來的上傳失敗，或後面其他資料夾/案件掃描出錯，這次掃描本身
      // 的結果也不會遺失，下次執行不會把同樣沒有變動的檔案又重新判斷成「新增」。
      await lib.saveState(stateFile, state);

      if (canUpload) {
        try {
          console.log(`    [輪次判斷] 檢查這輪是否有待上傳的圖片...`);
          // 這一輪要歸到哪個修改次數，必須用「即將上傳的當下」最新的資料庫狀態
          // 判斷，不能沿用整個掃描開始時抓的那份 dbData——如果 PM 在掃描這批案
          // 件的過程中新增了修改需求，沿用舊快照會讓這次抓到的圖片被錯誤歸到
          // 舊的（甚至已確認過的）那一輪，而不是剛建立的新一輪。
          const latestDbData = await latestDatabase();
          const upload = await lib.uploadPendingRound({
            config, secrets, dbData: latestDbData, caseId: project.caseId, // 一律用真正的案件編號，不是 stateKey——寫回資料庫、比對修改統計表都要用真實案件編號
            designer: project.designer, client: project.client, start: project.start,
            pendingPreviews: result.pendingPreviews,
            stateFiles: state[stateKey].files,
            roundState: state[stateKey],
            persistState: () => lib.saveState(stateFile, state)
          });
          if (upload.reconciledCount > 0) {
            console.log(`    [防重確認] 已在正式資料庫找到前次上傳的 ${upload.reconciledCount} 張圖片，本次不再重送`);
          }
          if (upload.deferredCount > 0) {
            console.log(`    [防重等待] 前次上傳結果尚未發布完成，暫緩重送 ${upload.deferredCount} 張`);
          }
          if (upload.waitingForNextRoundCount > 0) {
            console.log(`    [輪次封存] 本輪已完成，${upload.waitingForNextRoundCount} 張新版保留到下一個修改輪次`);
          }
          if (upload.skippedAlreadyRecordedCount > 0) {
            console.log(`    [避免重複] 這一輪資料庫已經有同名圖片（多半是先用電腦上傳補過），略過 ${upload.skippedAlreadyRecordedCount} 張不再備份`);
          }
          if (upload.skippedByTarget > 0) {
            console.log(`    [輪次判斷] 這輪只鎖定指定圖片，資料夾內其餘 ${upload.skippedByTarget} 個變動已略過`);
          }
          if (upload.targetFallback) {
            console.log('    [輪次判斷] PM 指定的待修改圖片檔名這次一個都對不上（可能是設計師存成新檔名），改成把這輪所有待歸類的新檔案都當回覆上傳');
          }
          if (!upload.uploadedCount) {
            console.log(`    [輪次判斷] ${upload.message || `案件已進入第 ${upload.round} 輪過稿中，但資料夾裡沒有偵測到任何符合條件的圖片/影片可上傳`}`);
          } else {
            console.log(`    [上傳完成] 第 ${upload.round} 輪，已寫入 ${upload.uploadedCount} 張圖片，案件修訂版 ${upload.jsonRevision}`);
          }
        } catch (error) {
          warnings.push(`案件 ${project.caseId} 資料夾「${folder.path}」輪次判斷/上傳失敗：${error.message}`);
          console.log(`    [錯誤] 輪次判斷/上傳失敗：${error.message}`);
          hadError = true;
        } finally {
          // uploadPendingRound() 每上傳成功一批（見 nas_design_image_lib.mjs 的
          // MAX_IMAGES_PER_UPLOAD_REQUEST 分批邏輯）就會直接在 state[stateKey].files
          // 上原地標記 assignedRound；不論這次上傳最後是完全成功、部分成功後
          // 才失敗、還是整批都失敗，只要有任何檔案被標記過，都要存檔——這是
          // 避免「明明已經真的上傳過、Drive 上真的多了一份檔案，本機狀態卻沒
          // 記到」這種不一致的關鍵一步。
          await lib.saveState(stateFile, state);
        }
      }
      } finally {
        await lib.releaseLock(stateLockFile);
      }
    }

    console.log('');
  }

  // 結案的案件留下的同步狀態與預覽圖不會自己消失（實測累積到 325 MB），每輪掃描完順手清一次。
  if (await lib.acquireLockWithWait(stateLockFile, { timeoutMs: STATE_LOCK_WAIT_MS, pollIntervalMs: 1000 })) {
    try {
      const state = await lib.loadState(stateFile);
      const pruned = await lib.pruneFinishedCaseState({
        state,
        dbData: await latestDatabase(),
        previewDir,
        keepDays: Number(config.pruneKeepDays) || 14
      });
      if (pruned.prunedKeys.length) {
        await lib.saveState(stateFile, state);
        console.log(`[定期清理] 已清掉 ${pruned.prunedKeys.length} 個結案案件的同步狀態與 ${pruned.removedPreviews} 張預覽圖，釋放 ${lib.formatBytes(pruned.freedBytes)}`);
      }
    } finally {
      await lib.releaseLock(stateLockFile);
    }
  }

  console.log(`=== 掃描完成：新增 ${totalNew} 個、更新 ${totalChanged} 個 ===`);
  if (!canUpload) {
    console.log('尚未設定 appsScriptUploadUrl／serviceKey，只產生本機預覽圖，不會上傳。');
  }
  if (warnings.length) {
    console.log('');
    console.log(`警告（${warnings.length} 則）：`);
    warnings.forEach(warning => console.log(`  - ${warning}`));
  }

  if (hadError) process.exitCode = 1;
}

main().catch(error => {
  console.error('執行失敗：', error);
  process.exitCode = 1;
});

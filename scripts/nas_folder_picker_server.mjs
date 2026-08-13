#!/usr/bin/env node
/**
 * NAS 資料夾選擇器伺服器
 *
 * 用途：常駐在一台連得到公司內網 NAS 的機器上（例如跑
 * nas_design_image_watcher.mjs 的同一台 Mac），提供一個網頁＋API，
 * 讓設計師在前台「過稿中」彈出視窗時可以用滑鼠瀏覽 NAS 資料夾樹狀結構、
 * 點選要追蹤的資料夾，取代手動輸入/貼上路徑。
 *
 * 選好資料夾、按下「選擇這個資料夾並備份」的當下，這支伺服器會立即用
 * nas_design_image_lib.mjs（跟 nas_design_image_watcher.mjs 共用的同一份
 * 掃描/壓縮/上傳邏輯）跑一次「馬上備份」：把資料夾裡目前已經存在的圖片/
 * 影片直接上傳一次，不用等背景監控程式下一輪輪詢（5-10 分鐘）才處理。
 * 之後案件維持過稿中期間，同一個資料夾如果又有新圖，就交給背景監控程式
 * 接手追蹤——兩支程式讀寫同一份狀態快取（sync-state.json），判斷「這個
 * 檔案處理過了沒」的邏輯完全一致，不會重複上傳同一批圖片。
 *
 * 另外還會依案件的「客戶別」猜一個預設瀏覽路徑（見 config.defaultBrowseRoot
 * ／resolveDefaultBrowsePath），開啟選擇器時直接跳到「執行中/<客戶別>」
 * 這一層，不用每次都從根目錄逐層點過去；猜不到或資料夾不存在時會 fallback
 * 到上一層，並保留完整的麵包屑，使用者仍然可以點回任何上層資料夾。
 *
 * 為什麼不是「網站直接呼叫這支 API」：
 *   正式站是 https://emctaipeiart.github.io，這支伺服器只在辦公室內網、
 *   沒有 HTTPS 憑證，瀏覽器的 Mixed Content 規則會直接擋掉「HTTPS 頁面
 *   用 fetch/XHR 呼叫 HTTP 網址」，內網 IP 也不例外，無法繞過。
 *   因此前台改成用 window.open() 開一個新分頁導到這支伺服器提供的網頁
 *   （屬於「導覽」，不受 Mixed Content 限制），使用者在這個新分頁裡選好
 *   資料夾後，用 postMessage 把選到的路徑丟回原本的分頁，由前台既有的
 *   updateCaseRow() 寫回案件資料庫，這支伺服器本身完全不需要知道任何
 *   案件資料庫的寫入邏輯或登入 token。
 *
 * 安全性說明：
 *   這支伺服器只做「列出 NAS 資料夾名稱」與「備份選定資料夾裡的圖片」這
 *   兩件事，不會把檔案內容回傳給瀏覽器。pickerToken 是一道輕量防護，擋掉
 *   同一個辦公室網路上隨手戳這支 API 的人；因為前台網頁本身是公開的
 *   GitHub Pages 網站，這個 token 會直接寫在 index.html 的原始碼裡，任何
 *   人都看得到——它擋不住看得到原始碼的人，真正的防線是「這支伺服器本來
 *   就連不到辦公室外」。不要把這個 token 當成真的機密。
 *
 * 執行環境限制：跟 nas_design_image_watcher.mjs 一樣，只能在連得到 NAS
 * 掛載點的機器上執行；「立即備份」用到的影片截圖／圖片壓縮一樣依賴 macOS
 * 內建的 qlmanage／sips，所以整支伺服器實質上也只能在 macOS 上執行「備份」
 * 這個功能（純瀏覽資料夾清單本身是跨平台的純 Node.js，不依賴這兩個指令）。
 *
 * 執行：
 *   node scripts/nas_folder_picker_server.mjs
 *   node scripts/nas_folder_picker_server.mjs --config 其他設定檔路徑.json
 *
 * 建議用 launchd 常駐執行（設計師隨時可能標記過稿中），見 README。
 */

import { promises as fs } from 'node:fs';
import path from 'node:path';
import http from 'node:http';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import * as lib from './nas_design_image_lib.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DEFAULT_PICKER_PORT = 8877;
const MAX_BODY_BYTES = 1024 * 1024; // 這支端點只收 { caseId, path }，1MB 綽綽有餘，避免被灌爆記憶體

function parseArgs(argv) {
  const args = { config: path.join(__dirname, 'nas_design_image_watcher.config.json') };
  for (let i = 0; i < argv.length; i += 1) {
    if (argv[i] === '--config' && argv[i + 1]) {
      args.config = path.resolve(argv[i + 1]);
      i += 1;
    }
  }
  return args;
}

async function loadOrCreatePickerToken(secretsPath) {
  const secrets = (await lib.loadJsonFile(secretsPath, {})) || {};
  if (secrets.pickerToken) return secrets.pickerToken;
  const token = crypto.randomBytes(24).toString('hex');
  const next = { ...secrets, pickerToken: token };
  await fs.writeFile(secretsPath, JSON.stringify(next, null, 2), 'utf8');
  console.log(`[初次執行] 已產生 pickerToken 並存進 ${secretsPath}：${token}`);
  console.log('請把這個值填進 index.html 的 nasFolderPickerToken 常數（見 README）。');
  return token;
}

/**
 * 把使用者瀏覽的相對路徑（例如 "專案企劃部/執行中/Epson"）安全地接到
 * mountRoot 底下，並確認算出來的絕對路徑真的還在 mountRoot 範圍內，
 * 擋掉 "../../etc" 這類跳出掛載點的路徑穿越攻擊。
 */
function resolveSafeDir(mountRoot, relPath) {
  const cleanedSegments = String(relPath || '')
    .split(/[\\/]+/)
    .filter(segment => segment && segment !== '.' && segment !== '..');
  const resolved = path.join(mountRoot, ...cleanedSegments);
  const normalizedRoot = path.resolve(mountRoot);
  const normalizedResolved = path.resolve(resolved);
  if (normalizedResolved !== normalizedRoot && !normalizedResolved.startsWith(normalizedRoot + path.sep)) {
    throw new Error('路徑超出允許的掛載範圍');
  }
  return { absPath: normalizedResolved, relPath: cleanedSegments.join('/') };
}

async function listSubfolders(absPath) {
  let entries;
  try {
    entries = await fs.readdir(absPath, { withFileTypes: true });
  } catch (error) {
    throw new Error(`無法讀取資料夾：${error.code || error.message}`);
  }
  return entries
    .filter(entry => entry.isDirectory() && !entry.name.startsWith('.'))
    .map(entry => entry.name)
    .sort((a, b) => a.localeCompare(b, 'zh-Hant'));
}

async function dirExists(absPath) {
  try {
    const stat = await fs.stat(absPath);
    return stat.isDirectory();
  } catch {
    return false;
  }
}

/**
 * 依案件的「客戶別」猜一個預設瀏覽路徑：從 config.defaultBrowseRoot（例如
 * "專案企劃部/執行中"）底下找同名（去頭尾空白、忽略英文大小寫）的子資料
 * 夾。三種結果：
 *   - matched=true：找到對應客戶資料夾，直接開到那一層
 *   - matched=false 但 baseOk=true：defaultBrowseRoot 存在，但沒有對到的
 *     客戶資料夾（案件沒填客戶別、或資料夾名稱兜不起來），開到 defaultBrowseRoot
 *   - baseOk=false：defaultBrowseRoot 本身不存在或沒設定，開到根目錄
 * 不管哪一種，回傳的都只是「初始瀏覽位置」，使用者仍然可以透過麵包屑點回
 * 任何上層資料夾，不會被鎖死在猜測結果裡。
 */
async function resolveDefaultBrowsePath(mountRoot, defaultBrowseRoot, client) {
  const trimmedRoot = String(defaultBrowseRoot || '').trim();
  if (!trimmedRoot) return { relPath: '', matched: false, baseOk: false, note: '' };

  let baseDir;
  try {
    baseDir = resolveSafeDir(mountRoot, trimmedRoot);
  } catch {
    return { relPath: '', matched: false, baseOk: false, note: '設定的預設瀏覽路徑不合法，已開啟根目錄' };
  }
  if (!(await dirExists(baseDir.absPath))) {
    return { relPath: '', matched: false, baseOk: false, note: `找不到預設瀏覽路徑「${baseDir.relPath}」，已開啟根目錄` };
  }

  const trimmedClient = String(client || '').trim();
  if (!trimmedClient) {
    return { relPath: baseDir.relPath, matched: false, baseOk: true, note: '此案件尚未填客戶別，已開啟到上一層資料夾' };
  }

  let siblings;
  try {
    siblings = await listSubfolders(baseDir.absPath);
  } catch {
    return { relPath: baseDir.relPath, matched: false, baseOk: true, note: '讀取預設瀏覽路徑失敗，已開啟到上一層資料夾' };
  }
  const exact = siblings.find(name => name === trimmedClient);
  const loose = exact || siblings.find(name => name.trim().toLowerCase() === trimmedClient.toLowerCase());
  if (loose) {
    const matchedRel = baseDir.relPath ? `${baseDir.relPath}/${loose}` : loose;
    return { relPath: matchedRel, matched: true, baseOk: true, note: `已自動開啟到「${loose}」資料夾` };
  }
  return { relPath: baseDir.relPath, matched: false, baseOk: true, note: `找不到「${trimmedClient}」對應的資料夾，已開啟到上一層` };
}

function sendJson(res, status, payload) {
  const body = JSON.stringify(payload);
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Content-Length': Buffer.byteLength(body) });
  res.end(body);
}

function readJsonBody(req) {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];
    req.on('data', chunk => {
      size += chunk.length;
      if (size > MAX_BODY_BYTES) {
        reject(new Error('請求內容過大'));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => {
      try {
        resolve(chunks.length ? JSON.parse(Buffer.concat(chunks).toString('utf8')) : {});
      } catch {
        reject(new Error('請求內容不是合法的 JSON'));
      }
    });
    req.on('error', reject);
  });
}

/**
 * 使用者選定資料夾後的「立即備份」：跟 nas_design_image_watcher.mjs 的
 * main() 迴圈裡對單一案件做的事情完全一樣（掃描→算輪次→上傳），只是這裡
 * 只處理這一個案件、立刻執行一次，不等排程輪詢。就算案件不存在於資料庫、
 * 或上傳失敗，也不丟例外中斷——路徑本身是否有效已經在呼叫端驗證過，「登
 * 記路徑」跟「這次順便備份成不成功」是兩件事，備份失敗不該讓路徑登記跟著
 * 失敗（背景監控程式下一輪還會再試）。
 */
async function backupSelectedFolder({ config, configDir, mountRoot, relPath, caseId }) {
  const dbData = await lib.fetchDatabase(config.dbJsonUrl);
  const meta = lib.findCaseMeta(dbData, caseId);
  if (!meta) {
    return { attempted: false, uploadedCount: 0, message: '資料庫查不到這個案件編號，僅登記路徑，未嘗試備份' };
  }

  const stateFile = lib.resolvePath(configDir, config.stateFile);
  const previewDir = lib.resolvePath(configDir, config.previewDir);
  const secrets = await lib.loadSecrets(lib.resolvePath(configDir, config.secretsFile));
  const state = await lib.loadState(stateFile);
  const warnings = [];
  const project = { caseId, rawFolderPath: relPath, designer: meta.designer, client: meta.client || '未分類客戶', start: meta.start };

  const scanResult = await lib.scanProject(project, config, state, previewDir, warnings);
  if (scanResult.error) {
    return { attempted: true, uploadedCount: 0, message: scanResult.error, warnings };
  }
  state[caseId] = scanResult.nextState;
  await lib.saveState(stateFile, state); // 掃描結果（有沒有變動、預覽圖）先落地，就算後面上傳失敗也不會遺失這次掃描

  if (!lib.uploadEnabled(config, secrets)) {
    return { attempted: true, uploadedCount: 0, message: '尚未設定自動上傳（appsScriptUploadUrl／serviceKey），僅登記路徑並產生本機預覽圖', warnings };
  }

  try {
    const upload = await lib.uploadPendingRound({
      config, secrets, dbData, caseId,
      designer: project.designer, client: project.client, start: project.start,
      pendingPreviews: scanResult.pendingPreviews,
      stateFiles: state[caseId].files
    });
    await lib.saveState(stateFile, state); // 上傳成功後把 assignedRound 補回去，避免背景監控程式重複上傳同一批
    if (!upload.uploadedCount) {
      return { attempted: true, uploadedCount: 0, message: '沒有偵測到可上傳的圖片/影片', warnings };
    }
    return { attempted: true, uploadedCount: upload.uploadedCount, round: upload.round, warnings };
  } catch (error) {
    warnings.push(`立即備份失敗：${error.message}`);
    return { attempted: true, uploadedCount: 0, message: `立即備份失敗：${error.message}`, warnings };
  }
}

function requestToken(url) {
  return url.searchParams.get('token') || '';
}

const PICKER_PAGE = `<!doctype html>
<html lang="zh-Hant">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>選擇 NAS 資料夾</title>
<style>
  :root{color-scheme:light}
  body{margin:0;font-family:-apple-system,BlinkMacSystemFont,"PingFang TC","Microsoft JhengHei",sans-serif;background:#f4f7f5;color:#17251d}
  header{padding:16px 20px;background:#0f6b3c;color:#fff}
  header h1{margin:0;font-size:16px}
  header p{margin:4px 0 0;font-size:12.5px;opacity:.85}
  main{padding:16px 20px;max-width:640px;margin:0 auto}
  .hint{margin:0 0 12px;font-size:12.5px;color:#0f6b3c;background:#e7f5ec;border-radius:8px;padding:8px 10px}
  .breadcrumb{display:flex;flex-wrap:wrap;gap:4px;font-size:13px;margin-bottom:12px;color:#43524b}
  .breadcrumb button{border:0;background:transparent;color:#0f6b3c;font-weight:700;cursor:pointer;padding:2px 4px;font-size:13px}
  .breadcrumb span{color:#9aa5a0}
  .folder-list{list-style:none;margin:0;padding:0;border:1px solid #dbe4de;border-radius:12px;overflow:hidden;background:#fff}
  .folder-list li+li{border-top:1px solid #eef2ef}
  .folder-list button{width:100%;text-align:left;border:0;background:none;padding:12px 14px;font-size:14px;cursor:pointer;display:flex;align-items:center;gap:8px;color:#17251d}
  .folder-list button:hover{background:#f0f9f4}
  .folder-list .empty{padding:16px;color:#8a948e;font-size:13px}
  .actions{display:flex;gap:10px;margin-top:16px}
  .actions button{flex:1;min-height:44px;border-radius:10px;border:1px solid #dbe4de;font-size:14px;font-weight:700;cursor:pointer}
  .btn-confirm{background:#0f6b3c;color:#fff;border-color:#0f6b3c}
  .btn-confirm[disabled]{opacity:.6;cursor:default}
  .btn-cancel{background:#fff;color:#43524b}
  .btn-cancel[disabled]{opacity:.6;cursor:default}
  .status{margin-top:10px;font-size:13px;color:#b91c1c;min-height:18px}
  .status.ok{color:#0f6b3c}
  .current{margin:0 0 12px;font-size:13px;color:#43524b;word-break:break-all}
  .current b{color:#17251d}
  .collapsed-view{padding:36px 20px;text-align:center;font-family:-apple-system,BlinkMacSystemFont,"PingFang TC","Microsoft JhengHei",sans-serif;color:#43524b}
  .collapsed-spinner{width:30px;height:30px;margin:0 auto 14px;border:3px solid #cfe4d7;border-top-color:#0f6b3c;border-radius:50%;animation:machiPickerSpin .9s linear infinite}
  @keyframes machiPickerSpin{to{transform:rotate(360deg)}}
  .error-prompt{padding:28px 20px;max-width:440px;margin:0 auto;font-family:-apple-system,BlinkMacSystemFont,"PingFang TC","Microsoft JhengHei",sans-serif;text-align:center}
  .error-prompt .icon{font-size:30px;margin-bottom:6px}
  .error-prompt h2{margin:0 0 8px;font-size:16px;color:#b91c1c}
  .error-prompt p{margin:0 0 16px;font-size:13px;color:#43524b;word-break:break-all;line-height:1.5}
  .error-prompt .prompt-actions{display:flex;gap:8px;justify-content:center;flex-wrap:wrap}
  .error-prompt .prompt-actions button{min-height:40px;padding:0 14px;border-radius:10px;font-size:13px;font-weight:700;cursor:pointer}
  .error-prompt .btn-retry{border:1px solid #dbe4de;background:#fff;color:#17251d}
  .error-prompt .btn-register-anyway{border:1px solid #0f6b3c;background:#0f6b3c;color:#fff}
  .error-prompt .btn-cancel-prompt{border:1px solid #dbe4de;background:#fff;color:#43524b}
  .error-prompt .path-caption{margin:14px 0 0;font-size:11.5px;color:#8a948e;word-break:break-all}
</style>
</head>
<body>
<header>
  <h1>選擇 NAS 資料夾</h1>
  <p id="caseLabel"></p>
</header>
<main>
  <p class="hint" id="defaultHint" hidden></p>
  <p class="current">目前瀏覽：<b id="currentPath">（根目錄）</b></p>
  <div class="breadcrumb" id="breadcrumb"></div>
  <ul class="folder-list" id="folderList"></ul>
  <div class="actions">
    <button type="button" class="btn-cancel" id="cancelBtn">取消</button>
    <button type="button" class="btn-confirm" id="confirmBtn">選擇這個資料夾並備份</button>
  </div>
  <p class="status" id="status"></p>
</main>
<script>
(function(){
  const params = new URLSearchParams(location.search);
  const caseId = params.get('caseId') || '';
  const token = params.get('token') || '';
  const nonce = params.get('nonce') || '';
  const origin = params.get('origin') || '';
  document.getElementById('caseLabel').textContent = caseId ? ('案件編號：' + caseId) : '';
  let relPath = '';

  function escapeHtml(text){
    return String(text).replace(/[&<>"']/g, ch => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[ch]));
  }

  function setStatus(text, ok){
    const status = document.getElementById('status');
    status.textContent = text || '';
    status.classList.toggle('ok', Boolean(ok));
  }

  async function loadDir(nextRelPath){
    setStatus('');
    try{
      const res = await fetch('/api/list?path=' + encodeURIComponent(nextRelPath) + '&token=' + encodeURIComponent(token));
      const data = await res.json();
      if(!res.ok || !data.success) throw new Error(data.message || ('HTTP ' + res.status));
      relPath = data.relPath || '';
      document.getElementById('currentPath').textContent = relPath || '（根目錄）';
      renderBreadcrumb(relPath);
      renderFolders(data.folders || []);
    }catch(error){
      setStatus('讀取資料夾失敗：' + error.message);
    }
  }

  function renderBreadcrumb(currentRelPath){
    const el = document.getElementById('breadcrumb');
    const segments = currentRelPath ? currentRelPath.split('/') : [];
    let html = '<button type="button" data-path="">根目錄</button>';
    let acc = '';
    segments.forEach(seg => {
      acc = acc ? (acc + '/' + seg) : seg;
      html += '<span>/</span><button type="button" data-path="' + escapeHtml(acc) + '">' + escapeHtml(seg) + '</button>';
    });
    el.innerHTML = html;
    el.querySelectorAll('button').forEach(btn => btn.addEventListener('click', () => loadDir(btn.dataset.path)));
  }

  function renderFolders(folders){
    const el = document.getElementById('folderList');
    if(!folders.length){
      el.innerHTML = '<li class="empty">這個資料夾底下沒有子資料夾</li>';
      return;
    }
    el.innerHTML = folders.map(name => '<li><button type="button" data-name="' + escapeHtml(name) + '">📁 ' + escapeHtml(name) + '</button></li>').join('');
    el.querySelectorAll('button').forEach(btn => btn.addEventListener('click', () => {
      const next = relPath ? (relPath + '/' + btn.dataset.name) : btn.dataset.name;
      loadDir(next);
    }));
  }

  function showCollapsed(message){
    document.body.innerHTML = '<main class="collapsed-view"><div class="collapsed-spinner" aria-hidden="true"></div><p>' + escapeHtml(message) + '</p></main>';
  }

  function showErrorPrompt(errorMessage){
    document.body.innerHTML = '<main class="error-prompt">'
      + '<div class="icon" aria-hidden="true">⚠️</div>'
      + '<h2>備份時發生問題</h2>'
      + '<p>' + escapeHtml(errorMessage) + '</p>'
      + '<div class="prompt-actions">'
      + '<button type="button" class="btn-retry" id="retryConfirmBtn">重試</button>'
      + '<button type="button" class="btn-register-anyway" id="registerAnywayBtn">仍然登記路徑</button>'
      + '<button type="button" class="btn-cancel-prompt" id="cancelPromptBtn">取消</button>'
      + '</div>'
      + '<p class="path-caption">資料夾：' + escapeHtml(relPath || '（根目錄）') + '</p>'
      + '</main>';
    document.getElementById('retryConfirmBtn').addEventListener('click', doConfirm);
    document.getElementById('registerAnywayBtn').addEventListener('click', () => {
      if(window.opener){
        window.opener.postMessage({ type: 'machi-nas-folder-selected', caseId, nonce, path: relPath }, origin || '*');
      }
      window.close();
    });
    document.getElementById('cancelPromptBtn').addEventListener('click', () => window.close());
  }

  async function doConfirm(){
    // 點選當下立刻收合成小巧的等待畫面，備份請求在背景繼續進行，不用讓使用者
    // 一直盯著資料夾瀏覽畫面等待；只有真的發生問題時才跳出明顯的提示框。
    showCollapsed('正在背景備份「' + (relPath || '（根目錄）') + '」...');
    let result = null;
    try{
      const res = await fetch('/api/confirm', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ caseId, token, path: relPath })
      });
      const data = await res.json();
      if(!res.ok || !data.success) throw new Error(data.message || ('HTTP ' + res.status));
      result = data;
    }catch(error){
      showErrorPrompt(error.message);
      return;
    }

    if(window.opener){
      window.opener.postMessage({ type: 'machi-nas-folder-selected', caseId, nonce, path: relPath }, origin || '*');
    }
    const backup = result.backup || {};
    const summary = backup.uploadedCount
      ? ('已立即備份 ' + backup.uploadedCount + ' 張圖片（第 ' + backup.round + ' 輪）')
      : ('資料夾已登記' + (backup.message ? '，' + backup.message : ''));
    showCollapsed(summary + '，即將關閉...');
    setTimeout(() => window.close(), 1400);
  }

  document.getElementById('cancelBtn').addEventListener('click', () => window.close());
  document.getElementById('confirmBtn').addEventListener('click', doConfirm);

  (async function init(){
    let initialPath = '';
    try{
      const res = await fetch('/api/default-path?caseId=' + encodeURIComponent(caseId) + '&token=' + encodeURIComponent(token));
      const data = await res.json();
      if(res.ok && data.success){
        initialPath = data.relPath || '';
        if(data.note){
          const hint = document.getElementById('defaultHint');
          hint.textContent = data.note;
          hint.hidden = false;
        }
      }
    }catch{ /* 猜預設路徑失敗就從根目錄開始，不影響手動瀏覽 */ }
    loadDir(initialPath);
  })();
})();
</script>
</body>
</html>`;

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const config = await lib.loadConfig(args.config);
  const configDir = path.dirname(args.config);
  const mountRoot = config.mountRoot;
  const secretsPath = lib.resolvePath(configDir, config.secretsFile);
  const pickerToken = await loadOrCreatePickerToken(secretsPath);
  const port = Number(config.pickerPort) || DEFAULT_PICKER_PORT;

  const server = http.createServer(async (req, res) => {
    const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
    console.log(`${new Date().toISOString()} ${req.method} ${url.pathname}`);

    if (url.pathname === '/picker' || url.pathname === '/') {
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      res.end(PICKER_PAGE);
      return;
    }

    if (url.pathname === '/api/list') {
      if (requestToken(url) !== pickerToken) {
        sendJson(res, 401, { success: false, message: '缺少或錯誤的 token' });
        return;
      }
      try {
        const { absPath, relPath } = resolveSafeDir(mountRoot, url.searchParams.get('path') || '');
        const folders = await listSubfolders(absPath);
        sendJson(res, 200, { success: true, relPath, folders });
      } catch (error) {
        sendJson(res, 400, { success: false, message: error.message });
      }
      return;
    }

    if (url.pathname === '/api/default-path') {
      if (requestToken(url) !== pickerToken) {
        sendJson(res, 401, { success: false, message: '缺少或錯誤的 token' });
        return;
      }
      try {
        const caseId = url.searchParams.get('caseId') || '';
        let client = '';
        if (caseId) {
          try {
            const dbData = await lib.fetchDatabase(config.dbJsonUrl);
            client = lib.findCaseMeta(dbData, caseId)?.client || '';
          } catch {
            // 讀不到案件資料庫也不影響瀏覽，只是猜不出預設路徑，從 defaultBrowseRoot 或根目錄開始
          }
        }
        const guess = await resolveDefaultBrowsePath(mountRoot, config.defaultBrowseRoot, client);
        sendJson(res, 200, { success: true, relPath: guess.relPath, matched: guess.matched, note: guess.note });
      } catch (error) {
        sendJson(res, 200, { success: true, relPath: '', matched: false, note: '' });
      }
      return;
    }

    if (url.pathname === '/api/confirm' && req.method === 'POST') {
      let body;
      try {
        body = await readJsonBody(req);
      } catch (error) {
        sendJson(res, 400, { success: false, message: error.message });
        return;
      }
      if (String(body.token || '') !== pickerToken) {
        sendJson(res, 401, { success: false, message: '缺少或錯誤的 token' });
        return;
      }
      const caseId = String(body.caseId || '').trim();
      if (!caseId) {
        sendJson(res, 400, { success: false, message: '缺少案件編號' });
        return;
      }
      let safe;
      try {
        safe = resolveSafeDir(mountRoot, String(body.path || ''));
      } catch (error) {
        sendJson(res, 400, { success: false, message: error.message });
        return;
      }
      if (!(await dirExists(safe.absPath))) {
        sendJson(res, 400, { success: false, message: '選擇的資料夾不存在，請重新整理後再選一次' });
        return;
      }
      try {
        const backup = await backupSelectedFolder({ config, configDir, mountRoot, relPath: safe.relPath, caseId });
        sendJson(res, 200, { success: true, path: safe.relPath, backup });
      } catch (error) {
        // 就算立即備份這段整個爆炸（例如讀資料庫失敗），路徑本身已經驗證過存在，
        // 前端仍然會拿到 success:true 讓路徑正常登記，只是 backup 標記為沒有嘗試成功。
        sendJson(res, 200, { success: true, path: safe.relPath, backup: { attempted: false, uploadedCount: 0, message: `立即備份時發生未預期錯誤：${error.message}` } });
      }
      return;
    }

    sendJson(res, 404, { success: false, message: '找不到這個路徑' });
  });

  server.listen(port, () => {
    console.log('=== NAS 資料夾選擇器伺服器 ===');
    console.log(`掛載根目錄：${mountRoot}`);
    console.log(`監聽埠號：${port}（辦公室內網其他機器可用這台的區網 IP + 這個埠號連線）`);
    console.log(`本機測試網址：http://localhost:${port}/picker?caseId=TEST&token=${pickerToken}`);
    console.log('按 Ctrl+C 結束。');
  });
}

main().catch(error => {
  console.error('啟動失敗：', error);
  process.exitCode = 1;
});

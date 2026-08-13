#!/usr/bin/env node
/**
 * NAS 資料夾選擇器伺服器
 *
 * 用途：常駐在一台連得到公司內網 NAS 的機器上（例如跑
 * nas_design_image_watcher.mjs 的同一台 Mac），提供一個網頁＋API，
 * 讓設計師在前台「過稿中」彈出視窗時可以用滑鼠瀏覽 NAS 資料夾樹狀結構、
 * 點選要追蹤的資料夾，取代手動輸入/貼上路徑。
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
 *   這支伺服器只做「列出 NAS 資料夾名稱」這件事，不會讀取或回傳檔案內容。
 *   pickerToken 是一道輕量防護，擋掉同一個辦公室網路上隨手戳這支 API 的
 *   人；因為前台網頁本身是公開的 GitHub Pages 網站，這個 token 會直接寫
 *   在 index.html 的原始碼裡，任何人都看得到——它擋不住看得到原始碼的
 *   人，真正的防線是「這支伺服器本來就連不到辦公室外」。不要把這個
 *   token 當成真的機密。
 *
 * 執行環境限制：跟 nas_design_image_watcher.mjs 一樣，只能在連得到 NAS
 * 掛載點的機器上執行（不需要 macOS 專屬指令，這支伺服器本身是純
 * Node.js，但 mountRoot 底下必須是已經掛載好的 NAS 分享）。
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

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DEFAULT_PICKER_PORT = 8877;

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
  return { pickerPort: DEFAULT_PICKER_PORT, secretsFile: './nas_design_image_watcher.secrets.json', ...config };
}

function resolvePath(base, value) {
  return path.isAbsolute(value) ? value : path.join(base, value);
}

async function loadOrCreatePickerToken(secretsPath) {
  const secrets = (await loadJsonFile(secretsPath, {})) || {};
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

function sendJson(res, status, payload) {
  const body = JSON.stringify(payload);
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Content-Length': Buffer.byteLength(body) });
  res.end(body);
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
  .btn-cancel{background:#fff;color:#43524b}
  .status{margin-top:10px;font-size:13px;color:#b91c1c;min-height:18px}
  .current{margin:0 0 12px;font-size:13px;color:#43524b;word-break:break-all}
  .current b{color:#17251d}
</style>
</head>
<body>
<header>
  <h1>選擇 NAS 資料夾</h1>
  <p id="caseLabel"></p>
</header>
<main>
  <p class="current">目前瀏覽：<b id="currentPath">（根目錄）</b></p>
  <div class="breadcrumb" id="breadcrumb"></div>
  <ul class="folder-list" id="folderList"></ul>
  <div class="actions">
    <button type="button" class="btn-cancel" id="cancelBtn">取消</button>
    <button type="button" class="btn-confirm" id="confirmBtn">選擇目前這個資料夾</button>
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

  async function loadDir(nextRelPath){
    const status = document.getElementById('status');
    status.textContent = '';
    try{
      const res = await fetch('/api/list?path=' + encodeURIComponent(nextRelPath) + '&token=' + encodeURIComponent(token));
      const data = await res.json();
      if(!res.ok || !data.success) throw new Error(data.message || ('HTTP ' + res.status));
      relPath = data.relPath || '';
      document.getElementById('currentPath').textContent = relPath || '（根目錄）';
      renderBreadcrumb(relPath);
      renderFolders(data.folders || []);
    }catch(error){
      status.textContent = '讀取資料夾失敗：' + error.message;
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

  document.getElementById('cancelBtn').addEventListener('click', () => window.close());
  document.getElementById('confirmBtn').addEventListener('click', () => {
    if(window.opener){
      window.opener.postMessage({ type: 'machi-nas-folder-selected', caseId, nonce, path: relPath }, origin || '*');
    }
    document.body.innerHTML = '<main style="padding:40px 20px;text-align:center;font-family:-apple-system,sans-serif"><h2>已選擇：' + escapeHtml(relPath || '（根目錄）') + '</h2><p>請回到原本的分頁，這個分頁即將自動關閉...</p></main>';
    setTimeout(() => window.close(), 900);
  });

  loadDir('');
})();
</script>
</body>
</html>`;

function requestToken(url) {
  return url.searchParams.get('token') || '';
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const config = await loadConfig(args.config);
  const configDir = path.dirname(args.config);
  const mountRoot = config.mountRoot;
  const secretsPath = resolvePath(configDir, config.secretsFile);
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

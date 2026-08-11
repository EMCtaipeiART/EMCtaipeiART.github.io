(function (global) {
  'use strict';

  const PAGE_CATALOG = Object.freeze([
    { key: 'request', label: '設計需求系統', path: 'index.html' },
    { key: 'dashboard', label: '設計儀表板', path: 'design_dashboard.html' },
    { key: 'archive', label: '歷史資料庫管理', path: 'database_archive_admin.html' },
    { key: 'database_admin', label: 'JSON 資料庫後台', path: 'json_database_admin.html' },
    { key: 'media_admin', label: '圖片與 Reels 管理', path: 'json_upload.html' },
    { key: 'avatar_upload', label: '頭像上傳工具', path: 'upload/upload.html' },
    { key: 'short_link', label: '短網址工具', path: '404.html' }
  ]);

  const CAPABILITY_CATALOG = Object.freeze([
    { group: '設計需求', key: 'request.create', label: '新增需求' },
    { group: '設計需求', key: 'request.edit', label: '編輯案件內容' },
    { group: '設計需求', key: 'request.status', label: '修改狀態與項目細節' },
    { group: '設計需求', key: 'request.delete', label: '刪除案件' },
    { group: '設計需求', key: 'request.export', label: '匯出 CSV' },
    { group: '修改紀錄', key: 'modification.create', label: '新增修改紀錄' },
    { group: '修改紀錄', key: 'modification.confirm', label: '確認修正日' },
    { group: '專案與設計師', key: 'project.create', label: '建立平面／影音新專案' },
    { group: '專案與設計師', key: 'designer.settings', label: '編輯設計師設定' },
    { group: '個人與媒體', key: 'profile.edit', label: '編輯個人設定與頭像' },
    { group: '個人與媒體', key: 'media.manage', label: '管理圖片與 Reels' },
    { group: '個人與媒體', key: 'reel.interact', label: 'Reels 按讚、倒讚與留言' },
    { group: '問題回報', key: 'issue.report', label: '新增問題回報' },
    { group: '問題回報', key: 'issue.manage', label: '更新問題狀態' },
    { group: '工具', key: 'short_link.create', label: '建立短網址' },
    { group: '系統管理', key: 'archive.edit', label: '編輯歷史資料庫' },
    { group: '系統管理', key: 'database.manage', label: '管理 JSON 資料庫與權限' }
  ]);

  const ALL_PAGES = PAGE_CATALOG.map(item => item.key);
  const ALL_CAPABILITIES = CAPABILITY_CATALOG.map(item => item.key);
  const DEFAULT_ROLE_TEMPLATES = Object.freeze({
    '管理者': { pages: ALL_PAGES, capabilities: ALL_CAPABILITIES },
    '設計師': {
      pages: ['request', 'dashboard', 'media_admin', 'avatar_upload', 'short_link'],
      capabilities: ['request.create', 'request.edit', 'request.status', 'request.export', 'modification.create', 'modification.confirm', 'project.create', 'designer.settings', 'profile.edit', 'media.manage', 'reel.interact', 'issue.report', 'short_link.create']
    },
    '一般使用者': {
      pages: ['request', 'avatar_upload', 'short_link'],
      capabilities: ['request.create', 'profile.edit', 'reel.interact', 'issue.report', 'short_link.create']
    },
    '唯讀': { pages: ['request', 'dashboard', 'short_link'], capabilities: [] }
  });
  let roleTemplates = Object.fromEntries(Object.entries(DEFAULT_ROLE_TEMPLATES).map(([role, template]) => [role, {
    pages: [...template.pages], capabilities: [...template.capabilities]
  }]));

  const STORAGE_KEYS = Object.freeze({
    account: 'designRequestEditorAccount', user: 'designRequestEditorUser', group: 'designRequestEditorGroup',
    department: 'designRequestEditorDepartment', token: 'designRequestEditorToken', loggedOut: 'designRequestEditorLoggedOut'
  });
  let state = { loaded: false, account: '', role: '', status: '啟用', pages: [], capabilities: [], explicit: false };
  let refreshPromise = null;

  function storageValue(key) {
    try {
      if (localStorage.getItem(STORAGE_KEYS.loggedOut) === '1' || sessionStorage.getItem(STORAGE_KEYS.loggedOut) === '1') return '';
      return localStorage.getItem(key) || sessionStorage.getItem(key) || '';
    } catch (error) { return ''; }
  }
  function canonicalAccount(value) {
    const account = String(value || '').trim().toLowerCase();
    if (!account || account === 'local-admin') return account;
    return account.includes('@') ? account : `${account}@emctaipei.com`;
  }
  function parseList(value) {
    if (Array.isArray(value)) return [...new Set(value.map(String).map(item => item.trim()).filter(Boolean))];
    const raw = String(value || '').trim();
    if (!raw) return [];
    try { const parsed = JSON.parse(raw); if (Array.isArray(parsed)) return parseList(parsed); } catch (error) {}
    return [...new Set(raw.split(/[\n,，、|｜]/).map(item => item.trim()).filter(Boolean))];
  }
  function roleFromIdentity(identity = {}) {
    const group = String(identity.group || '').trim(), department = String(identity.department || '').trim();
    if (identity.localAdmin || group === '管理者' || department === '管理者') return '管理者';
    if (/^(?:平面|影音)$/.test(group)) return '設計師';
    return '一般使用者';
  }
  function identityFromStorage(overrides = {}) {
    const query = new URLSearchParams(location.search), hash = new URLSearchParams(location.hash.replace(/^#/, ''));
    const token = overrides.token || storageValue(STORAGE_KEYS.token) || hash.get('token') || '', account = canonicalAccount(overrides.account || storageValue(STORAGE_KEYS.account) || query.get('account'));
    return {
      account, user: overrides.user || storageValue(STORAGE_KEYS.user) || query.get('designer') || '', group: overrides.group || storageValue(STORAGE_KEYS.group),
      department: overrides.department || storageValue(STORAGE_KEYS.department), token,
      localAdmin: String(token).startsWith('local-admin:') || account === 'local-admin'
    };
  }
  function applyRoleTemplates(database) {
    const rows = database?.tables?.['角色權限範本']?.rows || [];
    const saved = new Map(rows.map(row => [String(row?.['角色範本'] || '').trim(), row]));
    roleTemplates = Object.fromEntries(Object.entries(DEFAULT_ROLE_TEMPLATES).map(([role, fallback]) => {
      const row = saved.get(role);
      if (role === '管理者') return [role, { pages: [...ALL_PAGES], capabilities: [...ALL_CAPABILITIES] }];
      return [role, {
        pages: row ? parseList(row['頁面權限']).filter(key => ALL_PAGES.includes(key)) : [...fallback.pages],
        capabilities: row ? parseList(row['功能權限']).filter(key => ALL_CAPABILITIES.includes(key)) : [...fallback.capabilities]
      }];
    }));
    return roleTemplates;
  }
  function templateFor(role) { return roleTemplates[role] || roleTemplates['一般使用者']; }
  function rowProfile(row, identity) {
    const role = String(row?.['角色範本'] || roleFromIdentity(identity)).trim() || '一般使用者';
    const template = templateFor(role);
    const explicit = Boolean(row);
    const custom = explicit && role === '自訂';
    const pages = custom ? parseList(row['頁面權限']) : [...template.pages];
    const capabilities = custom ? parseList(row['功能權限']) : [...template.capabilities];
    if (identity.localAdmin || role === '管理者') return { loaded: true, account: identity.account, role: '管理者', status: '啟用', pages: [...ALL_PAGES], capabilities: [...ALL_CAPABILITIES], explicit };
    return { loaded: true, account: identity.account, role, status: String(row?.['狀態'] || '啟用').trim() || '啟用', pages, capabilities, explicit };
  }
  function currentPageKey() {
    const path = location.pathname.replace(/\/+$/, '').split('/').pop() || 'index.html';
    if (path === 'upload.html' && /\/upload\//.test(location.pathname)) return 'avatar_upload';
    if (path === 'json_upload.html' && new URLSearchParams(location.search).get('mode') === 'user') return 'avatar_upload';
    return PAGE_CATALOG.find(item => item.path === path)?.key || '';
  }
  function databaseUrl() {
    const current = new URL(location.href);
    const depth = /\/upload\//.test(current.pathname) ? '../' : '';
    return new URL(`${depth}backend/data/db.json`, current).href;
  }
  async function fetchDatabase() {
    if (global.fetchGithubJsonDatabase && typeof global.fetchGithubJsonDatabase === 'function') return global.fetchGithubJsonDatabase({ fresh: true });
    const response = await fetch(`${databaseUrl()}?access=${Date.now()}`, { cache: 'no-store', credentials: 'omit' });
    if (!response.ok) throw new Error(`權限資料讀取失敗：HTTP ${response.status}`);
    return response.json();
  }
  function profileFromDatabase(database, identity) {
    applyRoleTemplates(database);
    const rows = database?.tables?.['帳號權限']?.rows || [], settingsRows = database?.tables?.['設定']?.rows || [];
    const matchedSettings = settingsRows.find(item => canonicalAccount(item['帳號']) === canonicalAccount(identity.account) || String(item['名字'] || '').trim() === String(identity.user || '').trim()) || {};
    const account = canonicalAccount(identity.account || matchedSettings['帳號']);
    identity = { ...identity, account, group: identity.group || matchedSettings['組別'], department: identity.department || matchedSettings['部門'] };
    const row = rows.find(item => canonicalAccount(item['帳號']) === account) || null;
    return rowProfile(row, identity);
  }
  function can(key) {
    if (state.status === '停用') return false;
    if (!key) return true;
    if (key.startsWith('page.')) return state.pages.includes(key.slice(5));
    return state.capabilities.includes(key);
  }
  function apply(root = document) {
    root.querySelectorAll?.('[data-machi-permission]').forEach(element => {
      const allowed = can(element.dataset.machiPermission);
      if (element.dataset.permissionMode === 'disable') {
        element.disabled = !allowed;
        element.setAttribute('aria-disabled', allowed ? 'false' : 'true');
      } else element.hidden = !allowed;
    });
    document.dispatchEvent(new CustomEvent('machi:access-change', { detail: { ...state } }));
  }
  function removeDeniedOverlay() { document.getElementById('machiAccessDenied')?.remove(); }
  function guardPage() {
    removeDeniedOverlay();
    const page = currentPageKey();
    if (!state.account || !page || can(`page.${page}`)) return true;
    const label = PAGE_CATALOG.find(item => item.key === page)?.label || '此頁面';
    const overlay = document.createElement('section');
    overlay.id = 'machiAccessDenied';
    overlay.setAttribute('role', 'alert');
    overlay.innerHTML = `<div><span>存取受限</span><h1>無法開啟${label}</h1><p>帳號 ${escapeHtml(state.account)} 目前沒有這個頁面的查看權限。請聯絡管理者調整「帳號權限」設定。</p><a data-access-exit href="${page === 'request' ? '#' : (/\/upload\//.test(location.pathname) ? '../index.html' : 'index.html')}">${page === 'request' ? '登出後重新登入' : '返回設計需求系統'}</a></div>`;
    const style = document.createElement('style');
    style.id = 'machiAccessDeniedStyle';
    style.textContent = '#machiAccessDenied{position:fixed;inset:0;z-index:2147483647;display:grid;place-items:center;padding:24px;background:#f4f6f5;color:#1c2521;font-family:-apple-system,BlinkMacSystemFont,"Segoe UI","Noto Sans TC",sans-serif}#machiAccessDenied>div{width:min(520px,100%);padding:30px;border:1px solid #dfe6e2;border-radius:14px;background:#fff;box-shadow:0 18px 50px rgba(18,38,28,.12)}#machiAccessDenied span{color:#0f8f61;font-size:12px;font-weight:800}#machiAccessDenied h1{margin:8px 0 10px;font-size:23px}#machiAccessDenied p{margin:0 0 20px;color:#66736d;line-height:1.7}#machiAccessDenied a{display:inline-flex;padding:9px 14px;border-radius:8px;background:#0f8f61;color:#fff;text-decoration:none;font-weight:800}';
    if (!document.getElementById(style.id)) document.head.append(style);
    document.body.append(overlay);
    if (page === 'request') overlay.querySelector('[data-access-exit]')?.addEventListener('click', event => {
      event.preventDefault();
      try {
        Object.values(STORAGE_KEYS).forEach(key => { localStorage.removeItem(key); sessionStorage.removeItem(key); });
        localStorage.setItem(STORAGE_KEYS.loggedOut, '1'); sessionStorage.setItem(STORAGE_KEYS.loggedOut, '1');
      } catch (error) {}
      location.reload();
    });
    return false;
  }
  function escapeHtml(value) { return String(value || '').replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char])); }
  async function refresh(overrides = {}) {
    const identity = identityFromStorage(overrides);
    if (!identity.account && !identity.user && !identity.localAdmin && !identity.token) {
      state = { loaded: true, account: '', role: '訪客', status: '啟用', pages: ['request', 'short_link'], capabilities: ['request.create', 'issue.report', 'short_link.create'], explicit: false };
      apply(); removeDeniedOverlay(); return state;
    }
    refreshPromise = (async () => {
      try { state = profileFromDatabase(await fetchDatabase(), identity); }
      catch (error) { console.warn('[帳號權限] 讀取失敗，暫用角色預設值', error); state = rowProfile(null, identity); }
      apply(); guardPage(); return state;
    })();
    return refreshPromise;
  }
  function requirePermission(key, message = '此帳號沒有這個操作權限') {
    if (can(key)) return true;
    global.alert?.(message);
    return false;
  }

  global.MachiAccess = Object.freeze({
    pages: PAGE_CATALOG, capabilities: CAPABILITY_CATALOG,
    allPages: ALL_PAGES, allCapabilities: ALL_CAPABILITIES, parseList, canonicalAccount,
    roleFromIdentity, templateFor, applyRoleTemplates, refresh, apply, guardPage, can, require: requirePermission,
    get templates() { return Object.fromEntries(Object.entries(roleTemplates).map(([role, template]) => [role, { pages: [...template.pages], capabilities: [...template.capabilities] }])); },
    get state() { return { ...state, pages: [...state.pages], capabilities: [...state.capabilities] }; },
    get ready() { return refreshPromise || Promise.resolve(state); }
  });
  function refreshFromDatabaseMessage(value) {
    let message = value;
    if (typeof value === 'string') { try { message = JSON.parse(value); } catch (error) { return; } }
    const tables = Array.isArray(message?.tables) ? message.tables : [];
    if (tables.length && !tables.includes('帳號權限') && !tables.includes('角色權限範本') && !tables.includes('設定')) return;
    refresh().catch(error => console.warn('[帳號權限] 即時更新失敗', error));
  }
  global.addEventListener('storage', event => { if (event.key === 'machiDatabaseRefreshV1') refreshFromDatabaseMessage(event.newValue); });
  if ('BroadcastChannel' in global) {
    try {
      const channel = new BroadcastChannel('machi-database-refresh-v1');
      channel.addEventListener('message', event => refreshFromDatabaseMessage(event.data));
      global.addEventListener('pagehide', () => channel.close(), { once: true });
    } catch (error) {}
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', () => refresh(), { once: true });
  else refresh();
})(window);

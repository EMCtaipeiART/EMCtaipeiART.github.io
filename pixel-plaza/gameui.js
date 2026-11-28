/* 凱曜多元宇宙｜遊戲風選單與進場動畫（2026-11-15）
   不改動 index.html 內原有按鈕與邏輯：新的「選單」把原本的 角色／圖鑑／說明／切換人物／關閉 轉呼叫原按鈕，
   並把右下的音樂控制條收進選單的「設定」。嵌入模式（?embed=1）不啟用。 */
(function () {
  'use strict';
  if (document.documentElement.classList.contains('embed')) return;
  const $ = id => document.getElementById(id);
  const ic = d => '<svg viewBox="0 0 24 24" aria-hidden="true">' + d + '</svg>';
  const ICON = {
    menu: ic('<path d="M4 7h16M4 12h16M4 17h16"/>'),
    role: ic('<circle cx="12" cy="8" r="3.6"/><path d="M5 20c.6-4 3.4-6 7-6s6.4 2 7 6"/>'),
    dex: ic('<path d="M5 4.5h8a3 3 0 0 1 3 3V20H8a3 3 0 0 1-3-3z"/><path d="M16 7.5h3V20h-3"/><path d="M8.5 9h4"/>'),
    help: ic('<circle cx="12" cy="12" r="9"/><path d="M9.5 9.5a2.6 2.6 0 1 1 3.6 2.4c-.8.4-1.1.9-1.1 1.8"/><circle cx="12" cy="16.8" r=".6"/>'),
    people: ic('<circle cx="9" cy="8.5" r="3"/><circle cx="17" cy="9.5" r="2.4"/><path d="M3.5 19c.5-3.2 2.7-5 5.5-5s5 1.8 5.5 5"/><path d="M15.5 14.4c3 0 4.6 1.6 5 4.6"/>'),
    music: ic('<path d="M9 18V6l10-2v12"/><circle cx="7" cy="18" r="2.2"/><circle cx="17" cy="16" r="2.2"/>'),
    dance: ic('<circle cx="13" cy="4.8" r="2"/><path d="M5 5.5l5 4h5l4-3.5M12.5 9.5L11.5 14l-4 6M11.5 14l5 2 .5 5"/>'),
    games: ic('<path d="M7 7h10a4 4 0 0 1 4 4v3a3 3 0 0 1-5.2 2L14 15h-4l-1.8 1A3 3 0 0 1 3 14v-3a4 4 0 0 1 4-4z"/><path d="M8 9.5v3M6.5 11h3M15.5 10.2h.1M17.3 12h.1"/>'),
    exit: ic('<path d="M10 4H5v16h5"/><path d="M14 8l4 4-4 4M8.5 12H18"/>')
  };

  // ── 建立選單 ──
  const btn = document.createElement('button');
  btn.id = 'gMenuBtn'; btn.type = 'button'; btn.setAttribute('aria-haspopup', 'dialog'); btn.setAttribute('aria-expanded', 'false');
  btn.innerHTML = ICON.menu + '<span>選單</span><kbd>M</kbd>';
  const mask = document.createElement('div'); mask.id = 'gMask';
  const menu = document.createElement('nav'); menu.id = 'gMenu'; menu.setAttribute('aria-label', '主選單');
  const ROWS = [['bWheel', '角色', 'role', ''], ['bDance', '跳舞（F）', 'dance', ''], ['bDex', '圖鑑', 'dex', ''], ['bGames', '小遊戲', 'games', ''], ['bHelp', '說明', 'help', ''], ['bPeople', '切換人物', 'people', '']];
  menu.innerHTML = '<div class="gm-title">MENU</div><button class="gm-x" type="button" aria-label="關閉選單">✕</button>'
    + '<div class="gm-sec">快速功能</div>'
    + ROWS.map(r => '<button class="gm-row" type="button" data-src="' + r[0] + '">' + ICON[r[2]] + '<span>' + r[1] + '</span></button>').join('')
    + '<div class="gm-sec">設定</div><div class="gm-set" id="gmSet">' + ICON.music + '<span>音樂</span></div>'
    + '<button class="gm-row danger" type="button" data-src="bClose" style="margin-top:6px">' + ICON.exit + '<span>離開辦公室</span></button>'
    + '<div class="gm-foot">M 開關選單　·　Esc 關閉</div>';
  const wipe = document.createElement('div'); wipe.id = 'gWipe'; wipe.innerHTML = '<i class="t"></i><i class="b"></i><b>START</b>';
  document.body.append(mask, menu, btn, wipe);

  const rows = [...menu.querySelectorAll('.gm-row')];
  const syncRows = () => rows.forEach(r => { const src = $(r.dataset.src); r.hidden = !src || src.hidden || getComputedStyle(src).visibility === 'hidden'; });
  let open = false, lastFocus = null;
  function setOpen(v) {
    if (v === open) return; open = v; if (v) { syncRows(); lastFocus = document.activeElement; }
    menu.classList.toggle('on', v); mask.classList.toggle('on', v); btn.setAttribute('aria-expanded', String(v));
    if (v) setTimeout(() => { const f = rows.find(r => !r.hidden); if (f) f.focus({ preventScroll: true }); }, 60); else if (lastFocus && lastFocus.focus) { try { lastFocus.blur(); } catch (e) {} }
  }
  btn.onclick = e => { e.stopPropagation(); setOpen(!open); };
  // 圖鑑有新解鎖（原按鈕掛 has-new）：右上「選單」鈕和選單裡的「圖鑑」一起標 NEW
  const dexSrc = $('bDex');
  if (dexSrc) {
    const mark = () => { const on = dexSrc.classList.contains('has-new'); btn.classList.toggle('has-new', on); rows.find(r => r.dataset.src === 'bDex').classList.toggle('has-new', on); };
    new MutationObserver(mark).observe(dexSrc, { attributes: true, attributeFilter: ['class'] }); mark();
  }
  // 面板（圖鑑、說明、角色頁面…）開在選單上面；關掉面板後選單還開著，不會收合
  const PANELS = ['gamesPanel', 'dexPanel', 'helpPanel', 'drawer', 'cpage', 'fridgeP', 'catP', 'sv'];
  const panelOpen = () => PANELS.some(id => { const el = $(id); return el && !el.hidden; });
  mask.onclick = () => { if (!panelOpen()) setOpen(false); }; menu.querySelector('.gm-x').onclick = () => setOpen(false);
  // 選了遊戲就收起選單，回來時直接看到辦公室
  const games = $('gamesBody'); if (games) games.addEventListener('click', e => { if (e.target.closest('[data-game]')) setOpen(false); });
  rows.forEach(r => r.onclick = () => { const src = $(r.dataset.src); if (r.dataset.src === 'bDance') setOpen(false);   // 跳舞要看得到人物：收起選單
    if (src) setTimeout(() => src.click(), 60); });
  addEventListener('keydown', e => {
    const t = e.target, typing = t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT' || t.isContentEditable);
    if (e.key === 'Escape') { const p = ['gamesPanel', 'dexPanel', 'helpPanel', 'drawer'].map($).find(el => el && !el.hidden); if (p) { p.hidden = true; e.stopImmediatePropagation(); return; } }   // Esc 先關最上層的圖鑑／說明／選角面板
    if (e.key === 'Escape' && open && !panelOpen()) { e.stopImmediatePropagation(); setOpen(false); return; }   // 有面板開著時 Esc 先關面板
    if (!typing && !e.ctrlKey && !e.metaKey && !e.altKey && (e.key === 'm' || e.key === 'M') && !($('title') && !$('title').classList.contains('gone'))) { e.preventDefault(); setOpen(!open); }
  }, true);

  // ── 把音樂控制條收進選單的「設定」 ──
  let tries = 0; const mv = setInterval(() => {
    const w = $('bgmUI'); if (w) { const hint = w.querySelector('span'); if (hint) hint.style.display = 'none'; $('gmSet').appendChild(w); clearInterval(mv); } else if (++tries > 200) clearInterval(mv);
  }, 100);

  // ── 進場轉場：載入頁淡出時，綠色斜紋雙幕向上下拉開，再依序滑入 HUD ──
  const title = $('title'); let played = false;
  function play() {
    if (played) return; played = true; const root = document.documentElement;
    if (matchMedia('(prefers-reduced-motion:reduce)').matches) { root.classList.add('g-in'); return; }
    wipe.classList.add('on'); root.classList.add('g-in'); setTimeout(() => wipe.classList.remove('on'), 1500);
  }
  if (title) {
    if (title.classList.contains('gone') || getComputedStyle(title).display === 'none') document.documentElement.classList.add('g-in');
    else new MutationObserver(() => { if (title.classList.contains('gone')) play(); }).observe(title, { attributes: true, attributeFilter: ['class'] });
  } else document.documentElement.classList.add('g-in');
})();

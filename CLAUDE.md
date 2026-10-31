# CLAUDE.md — 給在任何一台電腦上接手這個專案的 Claude

> 這份是「對話裡才知道的事」的備份：使用者（Machi）和 Claude 在某一台電腦的對話不會跟著 Git 走，
> 所以決定、原因、慣例、地雷都寫在這裡。架構總覽看 `AGENT.md`，逐次修改看 `MAINTENANCE_LOG.md`。
> 開始工作前先讀完這份。**不要把密碼、token、API 金鑰寫進任何檔案。**

## 使用者與溝通
- 使用者用**繁體中文**，語氣口語、直接下指令（「請…」「改成…」）；回覆也用繁體中文，先講結果再講細節，不要長篇鋪陳。
- 使用者看畫面判斷，常用截圖回報；他說「看起來怪」就是視覺要調，不是要討論。
- 使用者要求 **commit 後直接 push，不用再問**（不 force push、不改寫歷史）。要下載檔案、動到金流／帳號／權限這類事照常先問。
- 修改後一定在 `MAINTENANCE_LOG.md` 檔尾加一段（日期＋標題＋做了什麼、為什麼）。

## 專案
- EMC 台北設計需求系統：靜態站（GitHub Pages，repo `EMCtaipeiART/EMCtaipeiART.github.io`，網址 https://emc-art.com）＋ Cloudflare Worker／Durable Object（`worker/`，API `https://machi-design-api.machi-chen.workers.dev/api`）。
- 前台：`index.html`（殼）＋ `site.js`（一個大 IIFE，`show(view)` 切頁）＋ `site.css`。改完前端要跑 `node tools/stamp.cjs`（更新 index.html 裡 site.js 的版本雜湊，只認 16 進位），並把 `index.html` 一起 commit。
- 元宇宙（像素辦公室）：`EMC-ART-Pixel-Office/dist/app.js`（canvas 遊戲）。改完要手動把 `dist/index.html` 的 `app.js?v=N` 加一，不然 Pages 快取（max-age 600）會讓人看到舊版。
- 出氣擂台：`vent-arena/`（Codex 的遊戲，我們加了 `scenes.js`、`dark.css`、`overrides.css`）。
- Worker 後端改了要 `cd worker && wrangler deploy`（部署不在 Git 裡；沒有 Cloudflare 登入就請使用者在本機部署）。

## 工作流程（避免互相蓋掉）
- **從 `origin/main` 開臨時 worktree 工作**：`git fetch origin && git worktree add --detach <路徑> origin/main`，`node_modules` 用 junction 指回主目錄（Windows：`mklink /J`），改完 `git push origin HEAD:main`，再移除 worktree。主目錄常停在 `codex/character-studio-backup`、還有 Codex 沒提交的檔案（`AGENT.md` 修改、`vent-arena/` 預覽圖、`character-studio/`），**不要動、不要 commit 它們**。
- `main` 會有自動的 `data: audit log`／`data: encrypted backup` commit，push 被拒就 `git pull --rebase` 再推。
- push 前會自動跑瀏覽器煙霧測試（要有 node_modules）。
- 測試：`npm test`（Windows 換行造成約 30～60 個無關失敗，比較「前後失敗清單」而不是看總數）；Worker：`cd worker && node node_modules/vitest/vitest.mjs run`、`node node_modules/typescript/bin/tsc --noEmit`。已知既有失敗：「頭像與服裝換成 2026-10-02 的新版比例」（與近期改動無關）。
- 驗證畫面用 headless Chrome（`puppeteer-core`，路徑 `C:/Program Files/Google/Chrome/Application/chrome.exe`），本機起靜態伺服器載 `EMC-ART-Pixel-Office/dist/?clean=1&cs=.6`；**攔掉 `pixelOfficeUpdate` 之類的寫入請求**，否則測試會改到線上資料（曾經不小心動到 Anna 的位置）。想模擬時間就在頁面載入前覆寫 `Date`。

## 地雷（踩過的）
- Bash heredoc／`sed` 會吃掉反斜線：寫含 regex 的程式碼用 `String.fromCharCode(92)` 組，或在 Node 腳本裡用 `split/join`、`includes` 判斷；`node --check` 驗語法。
- 檔案有 CRLF／LF 混用（git autocrlf）：用字串取代前先確認換行（`s.includes('\r\n')`），取代時用函式 `()=>` 避免 `$&` 之類特殊字元。
- PowerShell 不能 `&&`、`npx.ps1` 被擋：用 `npx.cmd`，或直接 `node node_modules/<pkg>/bin/...`。
- 不要印出 `CLOUDFLARE_*` 之類環境變數的值（曾經 token 被貼到錯的變數而洩漏，已請使用者換掉）。
- 像素辦公室的位置：後端存的 x 不含左側新桌子群的寬度（前端 `LX`，非首頁小框為 320），`pushChange` 會減掉 `LX`、`applyRemote` 會加回來。人物在會議室的位置只是畫面排的，**不能寫回後端**（曾造成散會後人留在會議室）。

## 元宇宙規則（使用者決定的，別擅自改）
- **上下班時間**：平日 09:00–19:00 為上班（企劃部／專案部同仁、他們的桌子群、沒人坐的空桌、左側新桌子群都一樣）；19:00 之後、09:00 之前、週末與國定假日為下班，設計師有電腦心跳就套加班濾鏡。時段可在「上下班設定」改（後端 `pixelHours`，預設 dayStart 9／lunch 12–14／workEnd 19／overtimeStart 19，加班固定到隔天 06:00）。前端從 `pixelOfficeState.hours` 讀。
- **全員上班／全員下班**：頁面上是一顆切換鈕；全員上班＝所有人「在座」（不是加班）、畫面當成平日中午，到台北當天 24:00 時間規則暫停，仍可個別手動切換；休假、出國不動。後端 `pixelAllWorkUntil`，hours 帶 `allWorkUntil`。
- **權限**：只有管理者與 Machi（`monitor`）能操控別人的人物；其他人只能操控自己。走路按鍵／拖動只有在「沒選任何人」時才自動選自己。
- **未登入人物**：沒人坐的辦公桌（不含會議室、廁所、無椅的大桌）平日上班時間坐一個半透明「未登入」人物（`vent-arena/assets/ghost_unknown_front/back.png`；上排用正面、下排與長桌用背面），名牌寫「未登入」；約四分之一會隨機起身走動（同時最多 3 位，每個瀏覽器各自隨機，不同步）。
- **會議室**：行事曆會議若受邀者有 `meetingrooma～d.emc@gmail.com`（信箱字母＝會議室 A～D），或地點／標題／說明寫「會議室 X」，設計師就依會議室入座（同一場會議用 iCalUID 共用，因為有些人看得到活動卻看不到受邀者名單）。入座時原本的桌子清空、灰階。「上下班設定」有開關。行事曆頁也會顯示會議室。
- **視覺**：像素遊戲風、**3 px 純黑外框**、短斜視角（看得到頂面與正面）。使用者不喜歡細線、不喜歡太平的側視圖。地板有 64 px 淡灰格線。廁所由上而下 馬桶＞馬桶＞洗手台、全部朝右（目前直接用使用者畫的圖 `assets/office-toilet-v10.webp`）；書櫃、窄書櫃、深紅工具箱用 `assets/office-props-v8`。素材需求說明在 `EMC-ART-Pixel-Office/ASSET_REQUESTS.md`（Codex 負責畫圖，替換同檔名即可）。
- 設計部人物頭像快照：管理者或 Machi 進元宇宙時，系統會把「快照與目前造型不一致」的人更新（首頁圓形頭像框靠這個）。

## 還沒結案的事
- Amber 的服裝「秋天1」頭部縮放是 0.7（在獨立 repo `EMCtaipeiART/emc-ai-stage-classifier` 的服裝生成器裡改，本機沒有這份程式）；Amber 的新頭像（對位基準是 Leona 的格子）已能使用。
- 元宇宙畫面底部偶爾出現白塊：本機與線上都無法重現，缺螢幕縮放比例等資訊。
- 像素辦公室的位置更新 API（`pixelOfficeUpdate`）不驗證身分，只擋了畫面上的操作；後端尚未補身分檢查。
- 行事曆同步需要 Google 授權能讀活動內容；會議室行事曆（meetingrooma～d）若分享給主帳號，會議室判斷會更準。
- 「推到 Claude cloud」：等使用者決定 Codex 未提交檔案的處理方式。

## 元宇宙已改為 3D 版（2026-10-31）
- 網站的「元宇宙」入口、設計師面板內嵌小視窗（`?embed=1`）、出氣擂台返回連結都已指向 `pixel-plaza/`（three.js 3D 版，UI 規範在 `pixel-plaza/UI-SPEC.md`）。
- 2D 版整包封存在 `archive/EMC-ART-Pixel-Office-2D/`（原路徑 `EMC-ART-Pixel-Office/` 已不存在），git tag `pixel-office-2d-final` 也保存了封存前的最後狀態。封存版仍有檔案供首頁隱藏的頭像橋接 iframe（`?avatars=1`）與相關測試使用，不要刪。
- 3D 版自己的素材放在 `pixel-plaza/assets/`、`pixel-plaza/snacks/`、`pixel-plaza/fridge/`，不依賴封存資料夾。

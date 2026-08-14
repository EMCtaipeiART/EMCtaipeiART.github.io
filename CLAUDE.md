# EMC 設計需求系統｜架構總覽與修改紀錄

這份文件是整個系統的「地圖」：說明各檔案的角色、資料實際怎麼流動、部署方式，以及**每一次修改的紀錄**。目的是讓任何人（包含之後接手的 AI 助理）不用重新逆向工程一次，就能知道改一個東西會牽動到哪裡。

- 逐日、逐次修改的更早期歷史（2026 年 8 月 10 日以前）記錄在 [`MAINTENANCE_LOG.md`](MAINTENANCE_LOG.md)。
- **從 2026-08-10 這次大改版開始，之後所有修改都記錄在本文件最下方的「修改紀錄」章節**，不再寫回 `MAINTENANCE_LOG.md`。

---

## 目錄

1. [系統是什麼](#1-系統是什麼)
2. [整體架構：Cloudflare Worker 為正式驗證與資料 API](#2-整體架構cloudflare-worker-為正式驗證與資料-api)
3. [資料層：十張 JSON 表](#3-資料層十張-json-表)
4. [寫入與備份規則（重要）](#4-寫入與備份規則重要)
5. [前台 index.html](#5-前台-indexhtml)
6. [後台 json_database_admin.html](#6-後台-json_database_adminhtml)
7. [其他頁面](#7-其他頁面)
8. [部署方式](#8-部署方式)
9. [已知技術債 / 之後可以做的事](#9-已知技術債--之後可以做的事)
10. [修改紀錄格式（之後每次修改都照這個寫）](#10-修改紀錄格式之後每次修改都照這個寫)
11. [修改紀錄](#11-修改紀錄)

---

## 1. 系統是什麼

EMC 設計部門的內部案件管理系統。設計需求單位（業務、專案負責人）在**前台**填寫設計需求，設計組在同一個頁面管理案件狀態、修改紀錄、限時動態、頭像等；管理者用**後台**直接編輯八張資料表。

- 正式網址：<https://emctaipeiart.github.io>
- GitHub repo：<https://github.com/EMCtaipeiART/EMCtaipeiART.github.io>（public）
- 本機資料夾（這份文件所在處）就是這個 repo 的工作目錄，已接上 `origin` remote。

## 2. 整體架構：Cloudflare Worker 為正式驗證與資料 API

2026-08-11 起，正式站的登入驗證、session、權限判斷與 JSON 寫入全部由 Cloudflare Worker 處理。Apps Script 主系統只保留為回復舊版時的程式碼，不再是正式驗證端點。

| | 檔案 | 部署方式 | 現在的角色 |
|---|---|---|---|
| **A. Cloudflare Worker（正式）** | `worker/**` | `cd worker && pnpm deploy` | 正式登入驗證、雜湊 session、權限、資料讀寫與管理 API。網址為 `https://machi-design-api.machi-chen.workers.dev/api`；單一 SQLite Durable Object `primary` 序列化同一份 JSON 的寫入。 |
| **B. 上傳用 Apps Script（正式）** | `upload/Code.gs`、`upload/upload.html` | 獨立 Google Apps Script 專案，手動部署 | 只處理 Google Drive 圖片位元組、頭像／海報與 Reels 圖片。登入 token 由 Worker 驗證，媒體 metadata 寫回 Worker。 |
| **C. 主系統 Apps Script（回復用）** | `GS/google_apps_script.gs`、`GS/user_directory.gs` | Google Apps Script 編輯器手動部署 | 2026-08-11 切換後不再負責正式登入與資料寫入；保留既有部署，供緊急回復前端 API 位址時使用。 |
| **D. Node.js JSON 後台（本機測試）** | `backend/app.mjs` 等 | `npm start` | 未部署成正式服務，用於本機整合測試與共用 schema／加權邏輯。 |

### 資料實際怎麼流動

```
使用者填單／管理者後台編輯
        │
        ▼
Cloudflare Worker（A）── 驗證 Google／ERP／管理者登入
        │                ├── session 與寫入鎖：SQLite Durable Object `primary`
        │                └── GitHub Contents API commit ──▶ backend/data/db.json
        │                                                      │
        │                                                      ▼
        │
        ├── 前台／後台所有驗證與 JSON 讀寫
        └── 上傳 Apps Script（B）只處理 Drive 圖片，再把 metadata 寫回 Worker

backend/data/db.json 更新後
        │
        ▼
                                                          GitHub Actions 偵測到 push
                                                                        │
                                                                        ▼
                                                    重新產生 data/database_archive.json
                                                    ＋ 重新部署 GitHub Pages
                                                                        │
                                                                        ▼
                                              emctaipeiart.github.io 上的 index.html／
                                              json_database_admin.html 直接 fetch
                                              backend/data/db.json（靜態檔）來讀資料
```

重點：GitHub 仍是正式發布的 JSON 來源；Worker 先在 Durable Object 內序列化寫入，再透過 GitHub Contents API 提交整份 `db.json`。靜態頁面可直接讀 JSON，需即時驗證或修改時呼叫 Worker。

Google 試算表本身（`1cHxWBed715H0XufNhMOOk3hcZPTSpq5rA64-b5m8vWY`）現在**不是資料的主要來源**，只在「新增案件」時被動接收一份備份，其餘七張表（設定、reels、加權計分標準…）完全不會寫回試算表。試算表上另外還有「階段」分頁等舊資料，那些已經跟即時系統無關，只是歷史殘留。

## 3. 資料層：十張 JSON 表

全部存在 `backend/data/db.json` 一個檔案裡的 `tables` 物件底下，`backend/schema.mjs` 定義了 canonical 欄位。

| 表名 | primaryKey | 用途 |
|---|---|---|
| `database` | 案件編號 | 所有設計案件，前台填單/案件列表的主資料 |
| `加權計分標準` | （無，用列序） | 設計種類→階段→項目細節 的加權分數規則；**同時也是前台選單「項目細節」選項的來源**（2026-08-11 起統一） |
| `短連結` | 短碼 | 一般短網址對照表 |
| `補充資料連結` | 案件編號 | 每個案件的補充資料 A–D 連結 |
| `修改統計表` | （無，用列序） | 案件修改歷程 |
| `設定` | 帳號 | 人員身分、喜愛設定與設計師公開資料（頭像、大圖、音樂、技能、對話框、輪值等）；後台不再獨立顯示此表，由可見頁籤「帳號設定」合併編輯 |
| `帳號權限` | 帳號 | 帳號狀態、角色範本、可查看頁面與可執行功能 |
| `角色權限範本` | 角色權限範本 | 管理者、設計師、一般使用者與唯讀的共用權限範本 |
| `reels` | （無，用列序） | 限時動態、按讚倒讚、留言 |
| `bug_report` | （無，用列序） | 問題回報，用 5 個狀態時間戳記錄流程 |

另外 `階段`、`平面新開專案`、`影音新開專案` 也存在 JSON 裡，但**目前的 `json_database_admin.html` 後台沒有把這三張表列進管理介面**（`TABLE_ORDER` 沒有包含），如果之後要管理它們，要在後台程式裡補上。

## 4. 寫入與備份規則（重要）

`google_apps_script.gs` 裡的 `mutateGithubJsonDatabase_(action, payload, mutator, options)` 是所有寫入的共用函式，決定「這次寫入要不要順便回寫 Google 試算表」：

- `githubJsonDatabaseWriteAction_`（也就是前台「填寫設計需求」表單觸發的 `add`/`batchAdd`/`update`/`batchUpdate`/`delete`）會傳 `{allowSheetBackup:true}`，觸發 60 秒後把 `database` 分頁整個覆寫回試算表。
- 資料庫後台（`json_database_admin.html`）呼叫的 `adminTableUpdate_`／`adminTableDelete_`，**只有在 `table==='database'` 時**也會傳 `{allowSheetBackup:true}`（2026-08-11 起，比照前台填單行為，回寫同一個 `database` 分頁／gid=1244538986）；其餘 7 張表（加權計分標準、短連結、補充資料連結、修改統計表、設定、reels、bug_report）**一律不回寫試算表**，JSON 是唯一資料來源。
- `adminTableInsert_` 對 `database` 表直接擋掉（丟出「請使用「填寫設計需求」表單新增案件」），所以後台新增案件不會、也不需要處理試算表回寫；其餘 7 張表的 `adminTableInsert_` 同樣一律不回寫試算表。
- 這個「後台只回寫 JSON、不回寫試算表」的基礎規則是 2026-08-11 上午修好的（詳見下方修改紀錄）——在那之前，後台編輯任何一張表其實都會偷偷把整個分頁覆寫回試算表，跟畫面上顯示的「不等待試算表備份」不一致。同一天下午再應使用者要求，把 `database` 表的後台編輯/刪除改回會回寫試算表（其餘 7 張表維持只寫 JSON）。

加權分數計算：`database` 表的「加權」欄位，由前台送出時用 `calculateRowWeight()`（讀 JSON 的 `加權計分標準`）算好後直接送出；後台編輯加權規則時，會在同一次交易內用 `recalculateDatabaseWeights_()` 把所有既有案件的分數重新算一次，確保舊案件也套用最新規則。

## 5. 前台 `index.html`

單一巨大檔案（一萬多行），內嵌兩段 `<script>`。關鍵機制：

- **登入**：Google OAuth 或 ERP OAuth（PKCE），登入後依「管理者／設計組／一般使用者」分權限。
- **API 位址解析**（`resolveDesignApiUrl`/`apiUrl`）：`?api=` 查詢參數 > `<meta name="design-api-url">` > localStorage 存的值 > 正式站／`file://` 預設 Cloudflare Worker；本機 HTTP 預設同源 `/api`。
- **資料讀取**：`fetchGithubJsonDatabase()` 直接 fetch `backend/data/db.json`（相對路徑的靜態檔），內建 10 秒快取；每次成功讀取都會呼叫 `syncWeightRulesFromDatabase()` 和 `syncDesignListsFromDatabase()`（2026-08-11 新增）同步加權規則與選單清單。
- **項目細節選單**（`designLists`）：2026-08-11 起改成從 `加權計分標準` JSON 表動態產生（`designListsFromWeightTable()`），不再打獨立的 Google 試算表「階段」分頁。「採購」類別沒有對應的加權規則，會 fallback 用寫死在 `baseDesignLists` 的預設值。
- **限時動態（reels）**：讀取走 `listReels` action，過期的限動不會顯示（伺服器端過濾），但資料列本身不會被刪除（2026-08-11 起）。
- **圖片上傳**：走上傳用 Apps Script（`designerUploadPageUrl`），不是 `json_upload.html`／Node 後台那條路。

## 6. 後台 `json_database_admin.html`

2026-08-10～08-11 整個重做過（見下方修改紀錄），現在是左側選單＋各表客製化呈現：

- `database`：一般表格，維持原本樣式。
- `加權計分標準`：依「設計種類→階段」分組的折疊清單，可以新增/編輯/刪除項目（不再只能改分數）。
- `短連結`：表格，短碼用徽章樣式。
- `補充資料連結`：卡片，依更新時間新到舊排序。
- `修改統計表`：依案件編號分組的時間軸。
- `帳號設定`：將底層 `設定` 與 `帳號權限` 合併為單一帳號編輯器，可新增帳號、維護身分與喜愛設定，並顯示角色／自訂權限；左側依組別收合，喜愛設定可收合且欄位順序可拖曳／上下移動。所有帳號可設定頭像；設計師另有大圖、音樂、技能、對話框、新專案輪值與 REELS 小卡。「設定」已從側邊頁籤移除。
- `角色權限範本`：維護四種共用角色的頁面與功能權限；非「自訂」帳號會自動繼承。
- `reels`：卡片＋留言泡泡，會顯示已過期但保留的限動。
- `bug_report`：依狀態分欄的看板（Kanban）。

登入方式：沿用前台由 Worker 簽發的 `designRequestEditorToken`，每次進站都向 Worker 驗證並讀取即時權限。正式前端已停用 `local-admin:YYYYMMDD` 靜態繞過。

## 7. 其他頁面

| 檔案 | 用途 |
|---|---|
| `design_dashboard.html` | 歷史案件統計儀表板，讀 `data/database_archive.json`（GitHub Actions 每小時自動產生的快照） |
| `database_archive_admin.html` | 封存 JSON 的管理頁，讀寫 `data/database_archive.json` |
| `json_upload.html` | 給 Node.js 後台用的圖片上傳頁，**正式站目前用不到**（正式站走上傳用 Apps Script） |
| `upload/upload.html` | 上傳用 Apps Script 的前端頁面，正式站實際在用的圖片上傳介面 |
| `404.html` | 短連結／補充資料連結導向頁 |

## 8. 部署方式

**Cloudflare Worker：**
- 程式在 `worker/`，Secret 只能用 `wrangler secret put` 或 Cloudflare 控制台設定，不可寫進 Git。
- 部署前執行 `pnpm test`、`pnpm check`、`pnpm deploy:dry`；正式部署用 `pnpm deploy`。

**會自動生效（git push 之後）：**
- 所有純前端檔案：`index.html`、`json_database_admin.html`、`design_dashboard.html`、`database_archive_admin.html`、`404.html`、CSS/圖片等。
- `backend/**`、`scripts/**`：GitHub Actions 會用它們跑測試、重新產生快照，但**不會部署成正式跑的 Node 服務**（目前沒有正式 Node 主機）。

**不會自動生效，需要手動部署：**
- `GS/google_apps_script.gs`、`GS/user_directory.gs` → 僅在回復舊架構時重新部署。
- `upload/Code.gs`、`upload/upload.html` → 另一個獨立的 Apps Script 專案，同樣要手動部署。

**推送到 GitHub 的方式**：這台電腦沒有裝 `gh` CLI、沒有存 SSH key，用的是使用者提供的 GitHub Personal Access Token，透過 `git push https://x-access-token:<token>@github.com/...` 完成，token 只存在單次 session 的暫時環境變數，不會寫進任何檔案。

**推送前務必**：`git fetch origin main` 確認遠端有沒有被自動化 commit 推進（幾乎每次都會有），需要的話 `git rebase origin/main`；遠端常會跟本機的 `backend/data/db.json`、`data/database_archive.json`、`data/short_link_index.json` 衝突，衝突時直接 `git checkout HEAD -- <file>` 採用遠端最新版本即可（本機這幾個資料檔本來就是快照，不該用本機舊版蓋過去）。

## 9. 已知技術債 / 之後可以做的事

- `google_apps_script.gs` 裡的 `weightMap_()`（讀 Google 試算表算加權）是**死代碼**：目前所有 action router 都不會呼叫到它（真正在跑的是 JSON-based 的 `githubJsonDatabaseAction_` 與 `recalculateDatabaseWeights_`）。保留著沒清掉，是這次修改刻意的保守選擇，避免動到不確定還有沒有其他地方依賴的舊函式。之後有空可以確認真的沒人用後整個刪掉。
- `json_database_admin.html` 沒有把 `階段`、`平面新開專案`、`影音新開專案` 三張表放進管理介面。
- 本機資料夾裡還有 7 個 `.codex_tmp_*` 開頭的資料夾，是之前 Codex session 留下的舊 git clone，跟現在的 git 設定無關，可以安全刪除，但目前還沒清。
- Node.js 後台（`backend/`）功能完整（含 ERP OAuth、圖片上傳、八表 CRUD），但正式站沒在用，只用來本機測試前端邏輯。如果之後真的要換成 Node 為主的架構，需要先解決常駐主機部署的問題。

## 10. 修改紀錄格式（之後每次修改都照這個寫）

```md
### YYYY-MM-DD HH:mm Asia/Taipei — 一句話標題

- 修改目的：
- 影響檔案：
- 影響功能：
- 風險區塊：
- 已檢查／驗證方式：
- 部署狀態：（純前端＝git push 後自動生效／需要手動部署 Apps Script，寫清楚是哪一個專案）
- commit：`<short-sha>`
```

---

## 11. 修改紀錄

### 2026-08-14 Asia/Taipei（最新）— 前台密碼登入欄位不再觸發瀏覽器「儲存密碼」提示

- 修改目的：使用者回報 `index.html` 登入後瀏覽器還是會跳出「要不要儲存這組密碼」的提示，要求不要再出現。追查後發現 [[2026-08-11 管理者密碼欄位脫離 form submit|2026-08-11 那次修正]] 只解決了「表單送出時密碼欄位是空的」這一半問題，但沒有解決根本原因：Chrome 對於 `type="password"` 的輸入框，**刻意不理會網頁自己設定的 `autocomplete="off"`**（這是 Chrome 從 2014 年（Chrome 34）就有的既定政策，防止網站濫用這個屬性擋掉使用者自己的密碼管理員，官方明確不會為此提供繞過方式）；而且 Chrome 判斷「要不要跳出儲存密碼」的依據，不是只看有沒有觸發傳統表單送出，**也會偵測「使用者在密碼欄位輸入過內容 → 接著頁面出現非同步登入成功的訊號（例如 XHR/fetch 呼叫回應成功）」這種現代 SPA 常見的登入模式**——`startAdminPasswordLogin()` 正好就是這個模式：讀取 `#loginPassword` 的值、清空欄位、呼叫 `verifyEditorLogin()`（一支 fetch）、成功後導向登入完成畫面。就算欄位在「表單送出」當下是空的，Chrome 早就已經記錄「這個分頁的這個密碼欄位剛剛被輸入過東西」，配上後面 fetch 成功的訊號，還是會跳出提示。也就是說，只要 `#loginPassword` 還是 `type="password"`，光靠 `autocomplete`／`data-lpignore`／`data-1p-ignore` 這些屬性從一開始就攔不住 Chrome 內建的密碼管理員（那幾個屬性對 LastPass／1Password 這類第三方密碼管理外掛才有效）。
- 影響檔案：`index.html`。
- 影響功能：
  1. **`#loginPassword` 從 `type="password"` 改成 `type="text"`，改用 CSS `-webkit-text-security:disc` 讓輸入內容照樣顯示成圓點遮罩**——這是業界常見用來做「PIN 碼輸入框」的既有技巧：視覺上看起來還是密碼欄位（打字會顯示黑點，不會把密碼用明碼顯示在畫面上，管理者密碼打字時不會被旁人看到），但底層 DOM 型別是 `text`，Chrome 判斷「要不要跳出儲存密碼」的偵測邏輯是綁定在 `type="password"` 這個屬性本身，改成 `text` 之後這整套偵測機制根本不會被觸發，從根源解決問題，而不是繼續在「Chrome 刻意忽略」的 `autocomplete` 屬性上打轉。`-webkit-text-security` 是 WebKit／Blink 專屬的 CSS 屬性（Chrome、Safari、Edge 都支援），Firefox 沒有對應屬性、會直接顯示明碼——這個系統的既有文件（`worker/README.md` 等）多次提到內部主要使用 Chrome／Safari，這個取捨可接受；如果之後真的有人用 Firefox 登入管理者密碼，最多是打字時看得到明碼，不影響功能本身。
  2. **順手清掉「設定新密碼」這組確認是死代碼的欄位**：`#loginNewPassword`（隱藏的 input）、`#loginNewPasswordWrap`（內含另一個 `type="password"` 的欄位）、`#loginRemember`（一個永遠勾選、從來沒有被讀取過的隱藏checkbox）、`#loginChangePassword`（觸發顯示上述欄位的按鈕，但這顆按鈕本身也是永遠 `hidden`、整個程式碼庫裡沒有任何地方會把它取消隱藏）——這四個元素在 [[2026-08-11 管理者密碼欄位脫離 form submit|上一次處理登入畫面時]] 就已經確認過是舊架構（本機 `local-admin:YYYYMMDD` 繞過機制年代）留下的死代碼，這次一併清除，理由有二：一是常規的「不留死代碼」原則；二是 `#loginNewPasswordWrap` 裡面也是一個 `type="password"` 欄位，就算平常被 `hidden`，Chrome 的密碼管理員在分析頁面時仍然可能把它納入「這是一個變更密碼表單」的判斷依據（这类隐藏欄位常是 Chrome 密碼管理員偵測「change password」表單樣式的訊號之一），拿掉之後可以順便排除這個額外的風險因子，不只是為了乾淨。連帶清掉 `showLoginModal()`／`hideLoginModal()` 裡讀寫這些已刪除欄位的程式碼（避免拿掉 HTML 後這兩個函式因為 `null.value=''` 之類的操作直接報錯損毀整個登入流程）、`showNewPasswordField()` 函式本體（唯一呼叫它的按鈕已經不存在）、以及對應的 CSS 規則（`#loginNewPasswordWrap[hidden]`、`#loginChangePassword`、`#loginModal .login-actions`——最後這條原本專門用來排列「修改密碼」按鈕，該按鈕拿掉後整個 `.login-actions` 容器在登入表單裡也一併移除，這條規則變成無效字串故一併刪除）。
- 風險區塊：
  - **這個修法只對 Chrome 內建的密碼管理員有效，改的是「Chrome 判斷這是不是密碼欄位」這個根本前提，不是額外加一層防禦**——理論上應該完全解決使用者回報的問題，但沒辦法涵蓋所有瀏覽器/所有密碼管理外掛可能各自獨立的偵測邏輯（例如某些第三方密碼管理外掛可能改用文字內容特徵、而非 `type` 屬性來判斷欄位性質，這種極端情況這次沒有處理，機率評估很低）。
  - **Firefox 使用者打管理者密碼時會看到明碼**（`-webkit-text-security` 在 Firefox 上完全沒有效果，等同沒有遮罩）——這是刻意的取捨，這個系統的管理者密碼登入本來就是給極少數內部管理者用的功能，不是一般使用者日常會用到的路徑，且既有文件已多次確認團隊主要用 Chrome／Safari，影響範圍評估很小；如果之後真的需要顧到 Firefox，可以再加一層 JS-based 的字元遮罩（即時把顯示值換成圓點、實際值另外存在別的變數），但這次沒有做到這麼複雜。
  - **拿掉 `#loginNewPasswordWrap` 等於徹底放棄了「管理者密碼登入面板可以改密碼」這個從未真正上線過的功能入口**——如果之後真的要做「讓管理者自己改密碼」這個功能，需要重新設計整套流程（目前的管理者密碼是 Worker 端固定或每日輪替的 `MMDD`，不是每個使用者各自獨立的密碼，改密碼這個概念在目前架構下語意本來就不完整），這不是這次的範圍，只是誠實記錄這個死代碼移除後，之後如果有人想找回這個入口，需要知道它從一開始其實就沒有真正接上任何後端邏輯。
- 已檢查／驗證方式：
  - `index.html` 抽出主要 `<script>` 區塊用 `node --check` 語法檢查通過。
  - `node --test backend/test/*.test.mjs` 26/26 全過（事先 `grep` 過 `backend/test/`／`worker/test/`，確認沒有任何既有測試字串鎖住這次刪除的欄位 ID 或函式名稱）。
  - 用本機 Node 靜態伺服器＋ Browser pane，透過 1280×800 的 iframe 做隔離測試：①確認 `#loginPassword` 的 `type` 正確變成 `text`，`getComputedStyle` 確認 `-webkit-text-security` 正確套用 `disc`；②確認 `#loginNewPassword`／`#loginNewPasswordWrap`／`#loginRemember`／`#loginChangePassword` 四個元素在 DOM 裡全部確認不存在；③呼叫 `showLoginModal()`／`hideLoginModal()` 確認都不會因為讀取已刪除的元素而報錯，且彈窗顯示/隱藏狀態正確切換；④完整模擬一次密碼登入流程（點「密碼登入」展開面板→輸入密碼→觸發 `startAdminPasswordLogin()`，攔截 `verifyEditorLogin`／`applyLoginRedirectResult` 等函式）：確認送出前密碼值正確、送出後密碼欄位正確清空、`verifyEditorLogin` 收到正確帳號與密碼、`applyLoginRedirectResult` 正確被觸發；⑤手動對 `#loginForm` 觸發 `submit` 事件，確認不會報錯（表單本來就一律 `preventDefault()`，這次的欄位刪除沒有影響這個既有行為）。
  - **未做的驗證**：這次的核心訴求（Chrome 是否真的不再跳出「儲存密碼」提示）**沒辦法在這個自動化環境裡驗證**——瀏覽器原生的密碼管理員 UI 是瀏覽器 chrome（介面本身，非頁面內容）層級的提示，不是頁面 DOM 的一部分，自動化測試工具讀不到、也無法觸發。這次的驗證完全建立在「`type="password"` 是 Chrome 判斷要不要跳出儲存密碼提示的已知、有文件記載的必要條件」這個公開技術事實上，加上程式邏輯正確性的隔離測試，但沒有實機在真正的 Chrome 視窗跑一次「輸入管理者密碼→登入成功→確認畫面右上角網址列真的沒有跳出儲存密碼的圖示/提示框」這個端對端流程。強烈建議使用者之後在正式站用 Chrome 實際測一次管理者密碼登入，確認提示真的消失；如果還有殘留，很可能是瀏覽器已經**先前**存過這組密碼（這次修改只能防止「未來」不再被詢問要不要儲存，沒辦法清除「過去」已經存進 Chrome 密碼管理員裡的舊紀錄），需要使用者自行到 `chrome://password-manager/passwords` 找到 `emctaipeiart.github.io` 對應的紀錄手動刪除。
- 部署狀態：純前端，git push 後自動生效，不需要部署 Worker 或 Apps Script。
- commit：（見下方 push 紀錄）

### 2026-08-14 Asia/Taipei（次新）— 資料庫後台「設計列表」技能編輯區排版整理：欄位排成一排、刪除鈕縮小、新增技能按鈕歸位、技能區塊改滿版

- 修改目的：使用者回報「設計列表」的技能編輯區排版錯亂——技能名稱／設計種類／預設階段三個欄位沒有排在同一排、刪除技能的按鈕過大（原本是撐滿整排寬度的 32px 高紅框按鈕）、「＋新增技能」按鈕位置很怪，要求整理成同一排、統一框線/選單大小與樣式、按鈕放在合理位置且不要過大；並明確指定「新專案輪值順序」（輪值面板）不需要調整。
- 影響檔案：`json_database_admin.html`、`backend/test/backend.test.mjs`。
- 影響功能：
  1. **真正的排版錯亂根因**：「技能與表單預設」這個區塊（`.designer-skill-editor`）跟「基本與輪值設定」「前台媒體設定」一樣，只佔卡片版面 3 欄式 grid（`.designer-admin-body{grid-template-columns:repeat(3,minmax(0,1fr))}`）裡的 1 欄，實際可用寬度只有約 280–380px——技能名稱＋設計種類＋預設階段＋刪除鈕四樣東西，就算把 CSS 改成單排 flex，這麼窄的欄位也塞不下，一定會被迫換行、擠壓變形。這是「該欄排版錯亂」的真正原因，不只是內部欄位排列方式的問題。修法：讓 `.designer-skill-editor`（技能區塊）比照既有的 REELS 區塊（`.designer-admin-section.account-reels-block`，原本就因為同樣理由已經是滿版），一起加進 `grid-column:1/-1` 這條規則，讓技能區塊跳出 3 欄限制、佔滿卡片整列寬度（約 936px，視卡片寬度而定），「基本與輪值設定」「前台媒體設定」兩個區塊維持原本的 2 欄並排不受影響。
  2. **技能列改成真正的單排**：`designerSkillRowHtml()` 拿掉每個欄位外層的 `<label><span>標籤文字</span>...</label>` 包裝，改成扁平的 `<input>`／`<select>`／`<select>`／`<button>` 四個元素直接排在 `.designer-skill-row` 裡，用 flexbox（`display:flex;flex-wrap:wrap`）＋各自的 `flex-basis`（名稱 2:1:160px、種類與階段各 1:1:110px、刪除鈕固定 34px）排成一排；技能名稱輸入框補上 `aria-label="技能名稱"`（原本用可見的 `<span>` 標籤，拿掉後改用無障礙屬性延續同樣的語意，不影響螢幕閱讀器使用者）。原本已經存在、卻被設成 `display:none` 的欄位標題列 `.designer-skill-columns`（技能名稱／設計種類／預設階段／操作）**這次改成顯示出來**（`display:flex`，用跟資料列相同的 `flex-basis` 比例對齊），讓使用者一眼就知道每一欄是什麼，不用每一列都重複顯示標籤文字（原本重複標籤正是排版擁擠的另一個原因）。
  3. **刪除技能按鈕縮小、位置合理化**：原本 `.designer-skill-row button{grid-column:1/-1;width:100%;height:32px}`——一個純粹的「×」符號卻撐滿整排寬度、樣子突兀；改成 `width:34px;height:34px`（跟輸入框高度相近的正方形小按鈕），用 `display:grid;place-items:center` 讓「×」置中，放在該列最右側（原本欄位排列的自然位置，不再需要另外佔一整排）。
  4. **「＋新增技能」按鈕搬到區塊標題列右側**：原本 `.designer-skill-editor-head{flex-direction:column;align-items:stretch}` 讓按鈕整個獨立飄在標題文字下方、置中顯示，跟頁面裡其他區塊「標題在左、操作在右」的既有版面語言（`.designer-admin-section-head`、`.content-head` 等）不一致；改成 `display:flex;align-items:flex-start;justify-content:space-between`（同一排、標題在左、按鈕靠右），跟其他區塊標題列同一種樣式語言。手機窄螢幕（480px 以下）維持原本既有的「按鈕改滿版、疊在標題下方」的響應式行為不變（`@media(max-width:480px)` 那條規則沒有動）。
  5. **清掉技能相關的響應式斷點重複規則**：720px 這個中間斷點原本針對 `.designer-skill-columns`／`.designer-skill-table`／`.designer-skill-row` 又重新宣告了一次跟基礎規則幾乎一樣（只是 grid 版）的樣式，這次拿掉——改用 flexbox 的 `flex-wrap` 之後，欄位在窄螢幕會自然換行，不需要另外用 media query 手動改成 2 欄 grid；只保留一條 720px 規則把欄位標題列（`.designer-skill-columns`）隱藏起來，因為换行後的資料列跟單排的標題文字對不齊，隱藏比對不齊更清楚。
  6. **明確沒有更動「新專案輪值順序」**：`designerRotationBoardHtml()`、`.designer-rotation-board`／`.designer-rotation-group`／`.account-rotation-item` 這一整組 class 完全沒有被這次改動觸碰，符合使用者「僅『新專案輪值順序』不需調整」的明確指示。
- 風險區塊：
  - 技能區塊改成滿版（`grid-column:1/-1`）之後，它在卡片裡的視覺順序變成：01 基本設定／02 媒體設定（兩者並排半版）→ 03 技能設定（滿版，換到新的一整排）→ REELS（滿版）——跟改動前「01/02/03 三欄並排，REELS 另外滿版換行」的視覺順序不同（03 現在會自己獨立一整排，因為前面 01/02 只占了 2/3 寬、03 這個滿版區塊會被 grid 自動推到下一整行開始）。這是配合「同一排要放得下四個欄位」這個核心需求必然的取捨，使用者沒有另外要求維持三欄並排的外觀。
  - 拿掉技能欄位的可見文字標籤、改成只在窄螢幕隱藏欄位標題列的設計，代表**視窗寬度剛好落在標題列被隱藏、但資料列本身還沒真正換行到看起來像卡片的中間地帶時**（720px 上下），使用者可能會有一小段時間看不到欄位標題、只能靠輸入框的 placeholder／select 目前選取的值本身來判斷每一欄是什麼——這是刻意的取捨（比起兩種排法在中間寬度打架、對不齊更混亂，選擇單純隱藏標題），多數使用者是在桌面環境（陳述的後台使用情境本來就是桌面優先）操作，這個中間地帶影響有限。
- 已檢查／驗證方式：
  - `json_database_admin.html` 主要 `<script>` 區塊用 `new Function()` 語法檢查通過。
  - `node --test backend/test/*.test.mjs` 26/26 全過——事先 `grep` 過 `backend/test/backend.test.mjs`，找到並更新了鎖住舊版 `.designer-skill-editor-head .btn{align-self:center` CSS 的既有斷言，改成鎖住新的 flex-row 版面與新的按鈕尺寸規則；`designer-skill-columns`／`grid-template-columns:repeat(3,minmax(0,1fr))` 這兩條既有斷言是比對通用字串／別處也會用到的規則，沒有受這次改動影響，維持原樣通過。
  - **用 1280×800 的 iframe（沿用先前 session 已經記錄過的「主分頁量不到真實視窗尺寸」既有限制與既有解法）做了完整的排版與互動隔離測試**：①用假資料（4 項技能）呼叫 `designerAdminCardHtml()`，第一次測量發現真正生效前技能列寬度只有 280px、欄位確實沒有排在同一排（`fieldsOnSameLine:false`）——**先重現了使用者回報的問題**，證實是欄寬不足，不是單純 CSS 排列方式的問題；套用「技能區塊改滿版」的修正後，重新測量欄寬變成 936px，技能名稱／設計種類／預設階段／刪除鈕四個元素的 `getBoundingClientRect().top` 完全一致（`fieldsOnSameLine:true`），確認真的排在同一排；②欄位標題列（技能名稱／設計種類／預設階段／操作）與資料列實際欄位的 `left` 座標逐一比對，確認對齊（`headerAlignsWithFields:true`）；③刪除鈕量到 34×34px（不再是撐滿整排的大按鈕）；④「＋新增技能」按鈕跟區塊標題確認在同一條水平線上、按鈕在標題右側（`addButtonOnRightOfTitle:true`／`addButtonSameLineAsTitle:true`）；⑤模擬點擊「＋新增技能」／刪除技能兩個既有事件委派邏輯，確認技能列數量正確增減（4→5→4）、新增的技能列同樣是 936px 單排排列、DOM 結構正確是 `INPUT`／`SELECT`／`SELECT`／`BUTTON` 四個扁平元素（不是舊版的 `LABEL` 包裝）；⑥載入正式站真實資料快照（`backend/data/db.json`）跑完整的 `designerAdminHtml()` 產生全部 6 位設計師、共 13 列真實技能資料，確認「新專案輪值順序」面板（`.designer-rotation-board`）正確render、6 個輪值項目正確顯示，第一位真實設計師的技能列同樣是 936px 單排、欄位同一排——用真實資料而不只是假資料再次確認修正有效。
  - **未做的驗證**：沒有肉眼截圖確認整體視覺效果（這個沙箱環境的截圖工具在這次測試中持續回傳空白畫面，這次改用 `getBoundingClientRect()`／`getComputedStyle()` 逐項數值比對取代，這個環境限制在稍早「修改統計表」那次改版已經記錄過同樣的狀況）；也沒有用真實管理者帳號登入正式站，實際點開「設計列表」某位設計師的卡片，肉眼確認技能區塊、刪除鈕、新增按鈕的實際觀感是否符合「不要過大」的主觀期待，也沒有實際測試中間寬度（約 700-900px 視窗）時欄位標題列隱藏後的實際使用體驗。建議之後有機會用真實帳號登入後台看一次實際畫面。
- 部署狀態：純前端，git push 後自動生效，不需要部署 Worker 或 Apps Script。
- commit：（見下方 push 紀錄）

### 2026-08-14 Asia/Taipei（次新）— 資料庫後台「修改統計表」改成專業案件時間軸版面，並合併「補充資料連結」頁面

- 修改目的：使用者回報「修改統計表」排版不直覺、不易閱讀，要求比照專業企業後台的資料呈現方式調整；同時認為「補充資料連結」（每個案件的 A–D 參考連結）感覺可以一起合併進來，並要求新樣式延續整體既有設計風格，不要另起一套。
- 影響檔案：`json_database_admin.html`、`backend/test/backend.test.mjs`。
- 影響功能：
  1. **「補充資料連結」不再是獨立頁籤，併入「修改統計表」依案件呈現**：`TABLE_ORDER`／`BOARD_VIEWS` 移除 `補充資料連結`，側邊選單只剩 8 個頁籤；底層資料表本身完全沒變（`metadata['補充資料連結']` 仍然存在，只是不再列在側邊選單），這是沿用先前「REELS 併入帳號設定」的同一套既有做法（`data-account-reel-edit`／`-delete` 那組模式），這次新增對應的 `data-supplement-edit`／`data-supplement-delete`／`data-supplement-add` 三個屬性與事件委派處理。
  2. **新的 `modificationHistoryHtml(rows)`（取代 `modificationGroupsHtml`）**：案件清單改成「有修改紀錄的案件」∪「有補充資料連結的案件」的聯集——正式資料裡有 18 個案件只填了補充資料、完全沒有修改紀錄（反之也可能發生），只取其中一邊會讓另一批案件從畫面上完全消失、後台反而少了入口，這次特別處理成不漏掉任何一邊。排序依「這個案件最新一次有動靜的時間」（修改紀錄的最新日期，或補充資料的更新時間，取兩者較新的）由新到舊，取代舊版單純看 `修改統計表` 本身列序的做法。
  3. **每個案件的群組改成兩段式**：上半段是補充資料連結（`supplementLinksHtml`）——已有資料的 A/B/C/D 顯示成小圓角徽章（沿用既有短網址 `supplementShortUrl` 邏輯），沒有的話顯示「+ 新增補充資料」；下半段是修改歷程改成真正的**垂直時間軸**（`modificationRoundHtml`）——每一輪一個圓形輪次徽章（初稿／一修／二修…，已確認的輪次徽章填滿綠色、未確認的是淺綠外框，一眼就能分辨進度）＋卡片內容（日期、修改內容、修改人、確認狀態徽章），並且**這次新增了圖片縮圖顯示**——`圖片連結` 欄位過去在這個後台完全沒有被渲染出來（只有前台看得到），現在跟前台的 `revisionImagesHtml` 一樣會解析 JSON 陣列並顯示縮圖、點縮圖開新分頁看原圖。群組標題列（`<summary>`）新增待確認輪次數量徽章（例如「3 輪待確認」），不用整個展開才能知道這個案件還有沒有沒處理完的修改。
  4. **`openEditor()` 新增 `prefill` 參數**：從案件群組點「+ 新增補充資料」時，會呼叫 `openEditor(null,'補充資料連結',{'案件編號':caseId})`——`row` 仍是 `null`（保持真正的「新增」語意，儲存時會走 INSERT 不是 UPDATE），只是把案件編號預先帶進表單，使用者不用自己再打一次；`editing`（用來判斷新增/編輯與後續寫入路徑）完全不受這個新參數影響。
  5. **`ensureSupplementLinkRows()`**：切到「修改統計表」頁籤時，額外抓一份完整的「補充資料連結」資料快取（非 Apps Script 模式下發一支獨立的 `/table/補充資料連結` 請求，走原本 REST 這邊本來就有的、已在跑的資料模式；APPS_SCRIPT 模式直接從記憶體裡的 `directDatabase` 取，不用多發請求）；`refreshCachedTableView()`（APPS_SCRIPT 模式下寫入後立即刷新畫面用）同步更新這份快取，確保新增/編輯/刪除補充資料連結後，即使還停留在「修改統計表」頁籤，畫面也會正確反映最新狀態。
  6. **視覺樣式延續既有設計語言**：新的 `.mod-*` 系列 class 全部沿用既有 design tokens（`--green`／`--green2`／`--line`／`--soft`／`--shadow`／`--muted`／`--ink`），案件卡片的圓角、陰影、字重直接比照既有 `.card`／`.group` 的數值，待確認／已確認的狀態配色沿用「帳號權限」頁籤既有的 `.permission-state`／`.permission-user.active` 那組琥珀／綠色語意，不是另外發明一套新配色。
  7. **清掉死代碼**：`supplementCardsHtml()`（舊的獨立卡片版面）整個移除；`.timeline`／`.timeline-item` 這組只被舊版 `modificationGroupsHtml` 用到的 CSS 規則，改成新的 `.mod-*` 系列規則（同一個「Grouped accordions」CSS 區塊原地替換，不是額外新增一塊）。
- 風險區塊：
  - **「聯集」邏輯依賴 `search` 搜尋框的查詢字串同時比對兩邊資料**——如果之後有人在別的地方也想重用 `modificationHistoryHtml()`（目前只有 `renderTable()` 這一個呼叫點），要注意這個函式內部直接讀了 `$('search').value`，不是單純的資料轉 HTML 的 pure function，沿用它時要留意這個耦合。
  - **搜尋比對修改紀錄／補充資料連結用的是兩套不同機制**：修改紀錄那邊的過濾在 REST 模式下是**伺服器端**做的（`queryPath()` 帶 `q` 參數，Worker 端過濾），只有「案件同時有補充資料、但完全沒有任何一筆修改紀錄欄位符合搜尋字串」時，才會退化成看得到補充資料、看不到（被伺服器濾掉的）修改紀錄——這是既有搜尋機制本身的既有限制（`databaseFileRows()` 的用戶端搜尋只在 APPS_SCRIPT 模式生效），不是這次新引入的問題，只是換了一個新場景可能踩到，實務上機率低（不太會同時搜尋一個純粹是連結片段、又剛好對應到一個有大量不相關修改紀錄的案件）。
  - **`+ 新增補充資料連結」目前沒有防止重複新增的機制**——如果同一個案件被連續快速點兩次「+ 新增」、或是使用者手動把兩個瀏覽分頁都停在同一個案件並各自新增一次，`補充資料連結` 表的 primaryKey 是「案件編號」，可能造成同一個案件出現兩筆補充資料連結紀錄（後面寫入的會依 REST 端點實際行為決定是覆蓋還是報錯）——這個風險在舊版「補充資料連結」獨立頁籤的「+新增資料」按鈕本來就存在（使用者一樣可以手動打同一個案件編號新增兩筆），這次沒有讓風險變得更大或更小，只是操作入口換了位置。
- 已檢查／驗證方式：
  - `json_database_admin.html` 主要 `<script>` 區塊用 `new Function()` 語法檢查通過。
  - `node --test backend/test/*.test.mjs` 26/26 全過——事先 `grep` 過 `backend/test/backend.test.mjs`／`worker/test/index.test.ts`，找到並更新了鎖住舊版 `TABLE_ORDER`（含 `補充資料連結`）與 `supplementCardsHtml` 函式存在與否的既有斷言，改成鎖住新的 `TABLE_ORDER`（不含補充資料連結）、`modificationHistoryHtml`／`supplementLinksHtml`／`ensureSupplementLinkRows` 等新函式與 `data-supplement-*` 屬性存在；`worker/test/index.test.ts` 裡對 `修改統計表`／`補充資料連結` 的斷言是資料層/Worker 邏輯測試，跟這次純前端頁面改動無關，確認不受影響。
  - 用本機 Node 靜態伺服器＋ Browser pane，直接載入真實正式站資料快照（`backend/data/db.json`，157 筆修改紀錄、27 筆補充資料連結）呼叫 `modificationHistoryHtml()` 做隔離測試（沒有真的登入、沒有打任何寫入 API）：①案件群組數正確等於 127（109 個有修改紀錄＋18 個只有補充資料，聯集邏輯正確不漏任何一邊）；②「+ 新增補充資料」按鈕數（100）精確等於沒有補充資料連結的案件數，「編輯」按鈕數（27）精確等於已有補充資料連結的案件數；③待確認／已確認的修改輪次圓形徽章數（27／130）精確等於資料庫裡實際「確認修正日」為空／非空的筆數，且用 `getComputedStyle` 確認兩種狀態視覺上真的有差異（待確認：淺綠底綠字；已確認：實心綠底白字），不是只有 class 名稱不同、樣式其實一樣；④點擊「編輯」／「+ 新增」／「刪除」三種補充資料連結操作，攔截 `openEditor`／`deleteRow` 確認呼叫參數正確（`forcedTable` 都是 `補充資料連結`，新增時 `row` 正確是 `null`＋`prefill` 正確帶對應案件編號，編輯／刪除時正確帶對應的既有資料列）；⑤搜尋框輸入案件編號、輸入補充資料連結網址片段、輸入完全比對不到的字串、清空搜尋框四種情境，過濾結果數量與「有沒有顯示『沒有符合條件的資料』」皆正確；⑥`renderTabs()` 確認側邊選單正確只剩 8 個頁籤、沒有獨立的「補充資料連結」項目，但 `metadata['補充資料連結']` 仍然存在（供 `openEditor`／`deleteRow` 的 `forcedTable` 正常運作）。
  - **未做的驗證**：這個環境的螢幕截圖工具在這次測試中對這個頁面持續回傳空白畫面（懷疑是這個沙箱環境的截圖合成時機問題，`document.elementFromPoint()` 已經確認當下畫面實際內容在該座標正確是 `.mod-round-card`，證明並非真的沒有渲染，只是截圖工具本身沒有正確擷取到），因此這次的視覺驗證完全依賴 `getComputedStyle` 逐項比對顏色／圓角／陰影/字重數值，沒有肉眼截圖比對過整體排版觀感；也沒有用真實管理者帳號登入正式站，實際點開「修改統計表」頁籤操作一輪完整的新增/編輯/刪除補充資料連結、確認寫入真的成功。建議之後有機會用真實帳號登入後台看一次實際畫面，確認案件多、修改輪次多的情境下時間軸的視覺density是否恰當。
- 部署狀態：純前端，git push 後自動生效，不需要部署 Worker 或 Apps Script。
- commit：（見下方 push 紀錄）

### 2026-08-14 Asia/Taipei（次新）— 修改紀錄彈窗上傳完圖片自動關閉；修正 NAS 監控程式「待修改圖片」檔名比對太嚴格導致改路徑／改檔名後永遠卡住不上傳

- 修改目的：使用者提出三件事：①在「修改紀錄」彈窗裡點「＋」新增圖片，上傳完成後上傳視窗會收合，但畫面停留在「修改紀錄」彈窗上，要求上傳完成後「修改紀錄」也一併關閉；②回報「如果更改 NAS 路徑，爬蟲就不會依照新的路徑爬圖片」；③提問：如果修改需求指定了某幾張圖片要修改，設計師把檔案改完存成新檔名（例如 `260810_DJI_360II_預熱倒數_電商BN_1000x300.png` 改成 `260814_DJI_360II_預熱倒數_電商BN_1000x300_v02.png`，補了新日期＋版本號），下次爬蟲/選擇器抓圖時，是否會認得這是同一系列圖片的最新版本、正確歸類到這次修改紀錄。追查後發現②跟③其實是同一個根因造成的：`nas_design_image_lib.mjs` 的 `computeTargetImages()`／`uploadPendingRound()` 對「待修改圖片」（PM 填修改需求時勾選的檔名）做的是**完全比對檔名**，如果設計師把修好的檔案存成新檔名（不管是因為換了 NAS 路徑、還是單純補上新日期/版本號），新檔案的檔名永遠對不上舊的目標清單，會被判定成「不符合條件」整批略過；更糟的是，狀態快取（`sync-state.json`）只在檔案真的被上傳後才會把它標記成「已歸類」，被過濾掉的檔案會**永遠停留在「已值測到、但未歸類」的狀態**——只要檔案內容不再變動，之後每一次掃描都會重複套用同一套目標檔名清單、重複被過濾掉，等於卡住不會再上傳，直到有人手動介入或這個案件進入下一輪修改（換一批新的待修改圖片清單）為止。這正好完全對應使用者回報的「改了路徑，爬蟲卻不理新路徑」的現象——爬蟲其實有掃描到新資料夾裡的新檔案，只是每次都被舊的檔名清單擋下來，從使用者角度看起來就像完全沒在動作。
- 影響檔案：`index.html`、`scripts/nas_design_image_lib.mjs`、`scripts/nas_design_image_watcher.mjs`。
- 影響功能：
  1. **修改紀錄彈窗新增圖片完成後自動關閉**：`handleUploadFrameMessage()` 處理 `machi-case-design-images-updated`（上傳完成訊息）的分支，原本固定呼叫 `refreshOpenRevisionModal(id)`（只更新內容、不關閉），改成先判斷「目前開著的 `#revisionModal` 是不是屬於這次上傳的同一個案件」——是的話呼叫 `closeRevisionModal()` 直接關閉；不是（例如剛好有另一個案件的修改紀錄彈窗開著，理論上不太會發生，但仍加了這層判斷避免誤關不相干的畫面）或本來就沒開著，維持原本的 `refreshOpenRevisionModal(id)` 行為不變。這個改動不影響「刪除圖片」（`removeCaseDesignImage`／`removeSelectedCaseDesignImages`）這兩個既有動作——那兩個是使用者主動在修改紀錄彈窗裡操作完還想繼續留在原地檢查結果，這次沒有跟著改成自動關閉，只有「新增圖片上傳完成」這個情境比照 `submitModificationRecord`／`confirmModificationRecord`（這兩個既有動作本來就會在完成後呼叫 `closeRevisionModal()`）的既有慣例補齊。
  2. **`uploadPendingRound()` 新增「目標檔名一個都對不上」的退回機制**：`computeTargetImages()` 本身沒有改動（一樣是讀『修改統計表』對應輪次的『待修改圖片』欄位）；改的是套用這份清單去比對這一輪待歸類檔案的邏輯——原本「一個都對不上」跟「部分對得上」是同一套處理（`targetedPreviews=matched`，對不上的話 `matched` 是空陣列，直接回傳 `uploadedCount:0`），現在拆成兩種情況：**部分或全部對得上**維持原行為不變（只上傳對得上的檔案，其餘照舊算進 `skippedByTarget`）；**一個都對不上、但這一輪確實有偵測到新增/變動的檔案**時，新增旗標 `targetFallback`，改成退回「當作沒有指定目標清單」的行為，把這一輪所有待歸類的新檔案都當作這次修改的回覆一併上傳——理由是每個案件的 NAS 資料夾本來就是專屬這個案件的（不是跨案件共用的資料夾），檔名對不上清單，最常見的原因就是設計師把檔案存成新檔名，而不是「這個資料夾裡出現了無關的檔案」；與其讓這一輪永遠卡住偵測到卻不上傳，寧可保守地把新檔案都當回覆上傳（多上傳的圖片可以在案件詳情／修改紀錄彈窗裡用既有的「移除圖片」功能個別刪除），也不要讓案件卡在「爬蟲看起來完全沒反應」的狀態。`nas_folder_picker_server.mjs` 的「選擇這個資料夾並備份」（`backupSelectedFolder()`）跟 `nas_design_image_watcher.mjs` 的定時排程都是呼叫同一支共用的 `uploadPendingRound()`，這次修正兩邊會同時生效，不用分別修改。
  3. **watcher 的主控台輸出新增退回情況的提示**：`nas_design_image_watcher.mjs` 在 `upload.targetFallback` 為真時，額外印一行「PM 指定的待修改圖片檔名這次一個都對不上（可能是設計師存成新檔名），改成把這輪所有待歸類的新檔案都當回覆上傳」，方便之後從 `~/Library/Logs/nas-watcher.log` 追查是不是踩到這個情況、確認退回上傳的判斷是不是合理。
  4. **直接回答使用者第三個問題**：目前（含這次修正後）系統**沒有**做「辨識同一系列圖片、忽略日期/版本號差異」這種語意層級的檔名比對——`computeTargetImages()` 拿到的「待修改圖片」清單，裡面存的就是 PM 當初在系統裡勾選圖片時，那些圖片**當下的完整檔名**（沿用案件詳情/修改紀錄裡既有圖片的 URL 對應檔名）。這次修正沒有讓爬蟲變聰明去「認得」`260814_..._v02.png` 是 `260810_...png` 的新版本，而是採取更保守的做法：**只要指定的舊檔名一個都比對不上，就不再嘗試比對，直接把這一輪資料夾裡所有新增/變動的檔案都當成這次修改的回覆上傳**。實務上的效果是：設計師把修好的圖存成新檔名放進同一個案件的 NAS 資料夾，下次爬蟲/選擇器掃描時，這個新檔案會被正確上傳、正確歸類進這一輪的修改紀錄裡——不是因為系統「認出」它是舊檔案的新版本，而是因為系統在確定舊檔名都對不上之後，選擇相信「這個專屬資料夾裡新出現的檔案，就是這次要交的東西」。如果同一輪修改資料夾裡除了設計師修好的檔案，還混雜了其他不相關的新檔案（例如設計師順手把其他草稿也丟進同一個資料夾），這次的退回機制會把那些也一併當成回覆上傳——這是刻意的取捨（寧可多傳、使用者事後手動刪除，也不要卡住不傳），如果之後這種「一輪資料夾裡混雜不相關檔案」的情況常發生造成困擾，需要再討論更精準的比對方式（例如比對檔名忽略常見的日期/版本號後綴樣式），這次沒有做這一層，因為命名慣例因人而異，貿然猜測樣式風險更高。
- 風險區塊：
  - **`targetFallback` 的退回邏輯只在「一個都對不上」時觸發，只要有任何一張對得上就不會啟動**——如果某一輪同時有「設計師改了新檔名的目標圖片」跟「設計師沒改名、維持舊檔名的另一張目標圖片」，會出現「舊檔名那張正確被辨識上傳，新檔名那張因為清單裡『至少有一個對上』而不會觸發退回、繼續被過濾掉」的情況，仍然可能卡住其中一張。這個邊界情況這次沒有處理（要處理需要逐檔案判斷退回與否，邏輯複雜度會提高不少，而且仍然是「有沒有猜對」的問題，不是「一定正確」），如果之後常遇到這種「部分改名、部分沒改名」的混合情境，需要再討論更細緻的做法。
  - **這次的退回機制是「保守地多傳」，不是「精準比對」**——多傳的檔案（例如同一資料夾裡真的有不相關的草稿檔）需要使用者事後在案件詳情或修改紀錄彈窗手動用既有的「移除圖片」功能清掉，這次沒有新增任何自動判斷「哪張才是真正要的」的邏輯。
  - **修改紀錄彈窗自動關閉的判斷只比對案件編號，不比對是不是同一次使用者互動**——如果使用者在修改紀錄彈窗開著的狀態下，用另一個瀏覽器分頁/裝置替同一個案件上傳圖片（理論上可能，但目前架構下同一時間通常只會有一個上傳流程在進行，這個情境機率很低），這個分頁的修改紀錄彈窗也會被跟著關閉——這是刻意接受的邊界情況，不是這次新引入的風險類型（其他既有的「同案件即完成關閉」邏輯，例如 `submitModificationRecord`／`confirmModificationRecord`，本來就是同樣的判斷方式）。
- 已檢查／驗證方式：
  - `node --check scripts/nas_design_image_lib.mjs`／`node --check scripts/nas_design_image_watcher.mjs` 語法檢查皆通過。
  - `index.html` 抽出主要 `<script>` 區塊用 `node --check` 語法檢查通過。
  - **`uploadPendingRound()` 的退回邏輯有寫隔離測試驗證**（暫時攔截 `global.fetch` 模擬 Apps Script 上傳成功、用真實暫存檔案當假預覽圖，測完即刪）：①待修改圖片清單裡的檔名跟資料夾裡的檔案完全對得上時，只上傳對得上的那張、其餘正確算進 `skippedByTarget`，`targetFallback` 正確是 `false`（確認沒改壞原有行為）；②用使用者提供的真實案例情境（舊檔名 `260810_DJI_360II_預熱倒數_電商BN_1000x300.png`、新檔名 `260814_DJI_360II_預熱倒數_電商BN_1000x300_v02.png`）驗證：資料夾裡只有新檔名的檔案時，正確判定 `targetFallback:true`、正確把這個新檔名檔案上傳、正確在狀態快取裡把它標記成已歸類這一輪（確認不會在下次掃描時又被重新判斷成待處理，不會卡在無限迴圈）；③完全沒有設定待修改圖片清單時（一般情況，多數輪次不會特別指定），行為維持原樣、`targetFallback` 正確是 `false`。
  - 用本機 Node 靜態伺服器＋ Browser pane 對 `index.html` 做隔離測試（stub `fetchModificationCounts`／`refreshOpenCaseDetail`／`render`／`setSync`）驗證修改紀錄彈窗自動關閉的三種情境：①修改紀錄彈窗開著、上傳完成訊息的案件編號跟它相同 → 正確關閉；②修改紀錄彈窗開著、但上傳完成訊息是另一個案件編號 → 正確維持開啟不受影響；③修改紀錄彈窗原本就是關閉狀態 → 收到上傳完成訊息後正確維持關閉、不報錯。
  - `node --test backend/test/*.test.mjs` 26/26 全過（沒有任何既有測試字串鎖住這次改到的三個檔案）。
  - **未做的驗證**：沒有用真實的過稿中案件、真實 NAS 資料夾、真的把檔案改成新檔名，跑一次完整的「設計師改路徑或改檔名 → 下次排程執行 → 圖片正確出現在修改紀錄」端對端流程——這次的診斷完全基於程式碼推理與隔離測試，沒有機會在使用者真實的 NAS 環境重現原始的卡住現象；也沒有實際點過一次「修改紀錄彈窗新增圖片」完整流程肉眼確認彈窗真的關閉。建議使用者之後找一個過稿中的測試案件，指定待修改圖片、把對應檔案改成新檔名丟進 NAS 資料夾，實際跑一次排程觀察 `~/Library/Logs/nas-watcher.log` 確認退回上傳的訊息有沒有正確出現、圖片有沒有正確進到修改紀錄。
- 部署狀態：`index.html` 純前端，git push 後自動生效；`scripts/nas_design_image_lib.mjs`／`scripts/nas_design_image_watcher.mjs` 是純本機工具，透過 `crontab` 每分鐘重新執行整支程式（不是常駐行程），**不需要重啟任何服務**，下一次排程觸發就會自動套用新版程式碼。
- commit：（見下方 push 紀錄）

### 2026-08-14 Asia/Taipei（次新）— 修正修改紀錄彈窗「＋新增圖片」上傳視窗被壓在後面點不到；NAS 選擇器改成直接隱藏在主頁面後面，不再縮到螢幕角落

- 修改目的：使用者回報兩個問題：①在「修改紀錄」彈窗裡點某一輪設計圖旁的「＋」新增圖片，跳出的上傳視窗被壓在「修改紀錄」彈窗後面，完全點不到裡面任何東西；②前一則修改把 NAS 資料夾選擇器的確認視窗改成「縮小移到螢幕角落（`resizeTo(1,1)`＋`moveTo` 到螢幕右下角）」，使用者不喜歡這個做法，要求改成「點選視窗後直接隱藏」，不需要縮在角落。
- 影響檔案：`index.html`、`scripts/nas_folder_picker_server.mjs`。
- 影響功能：
  1. **`#uploadModal` 疊在 `#revisionModal` 後面的 z-index 排序錯誤**：追查後發現原因跟 [[2026-08-13 案件詳情設計圖記錄樣式不生效|8/13 那次「設計圖記錄」寬度改了沒生效]] 是同一種坑——`#revisionModal` 的 z-index 在檔案裡有兩處宣告（[index.html:1747](index.html:1747) 的 `1260` 與後面 [index.html:3833](index.html:3833) 附近真正生效的 `6500`，同一種「後面那組樣式覆蓋前面」的已知技術債），但 `#uploadModal` 只在 [index.html:6065](index.html:6065) 有唯一一處宣告 `1250`，遠低於 `#revisionModal` 實際生效的 `6500`，所以從修改紀錄彈窗開出來的上傳視窗永遠會被壓在下面。**第一次修正時我犯了同樣的坑**：把新的 `#uploadModal{z-index:6600}` 加在 3833 行附近那個區塊裡，結果因為 6065 行原本的宣告在檔案裡排序更後面、又是同樣的 `!important` 特異度，最終生效的還是 6065 那條舊的 `1250`，改了等於沒改——瀏覽器實測 `getComputedStyle` 確認後才發現沒生效，於是改成直接把 6065 行本身的數值從 `1250` 改成 `6600`，這才是真正生效的修法。修完後 `#uploadModal` 的 z-index（6600）高於 `#revisionModal`（6500），從修改紀錄彈窗開的上傳視窗會正確蓋在最上面、可以正常點擊操作。
  2. **NAS 選擇器視窗改成「隱藏在主頁面後面」而不是「縮到螢幕角落」**：`nas_folder_picker_server.mjs` 的 `doConfirm()` 原本呼叫的 `shrinkWindowOutOfView()`（`window.resizeTo(1,1)`＋`window.moveTo(screen.availWidth,screen.availHeight)`）整個移除，改成新函式 `hideBehindOpener()`——點下「選擇這個資料夾並備份」的當下，改成呼叫 `window.opener.focus()` 把焦點還給原本開啟這個彈出視窗的主頁面分頁，讓瀏覽器自然把這個彈出視窗蓋到主頁面後面、整個看不見；**這個視窗完全沒有被改變大小或位置**（跟上一版不同，這次連 1x1 的縮小動作都沒有），也沒有真的關閉，`/api/confirm` 這支請求繼續在背景正常進行不受影響。原本用來在真的還原視窗時把大小/位置改回 520×640 的 `restoreWindowForPrompt()`，因為現在視窗根本沒被縮放過，簡化成只呼叫 `window.focus()`（把這個視窗重新叫到主頁面前面）。如果 `window.opener` 已經不存在（例如使用者手動關掉了主頁面分頁）就什麼都不做，視窗維持顯示原本畫面，不會出錯。
- 風險區塊：
  - **`window.opener.focus()` 是否真的能把彈出視窗完全蓋到後面，取決於作業系統/瀏覽器的視窗管理員行為**——多數桌面瀏覽器（Chrome／Safari／Edge）呼叫另一個視窗的 `focus()` 時，會把「被呼叫 focus 的那個視窗」拉到最上層，通常也會連帶讓目前這個視窗退到後面，但這不是 Web 標準保證的行為、也不是每個作業系統/視窗排列模式（例如 macOS 的全螢幕模式、分割視窗模式）都會有一致的效果。如果在使用者的實際環境下沒有把視窗完全蓋住，畫面上會停留在原本的「背景備份中，可以忽略這個視窗...」這行忙碌狀態文字＋兩顆停用的按鈕（這個備援畫面完全沒有變動），不會是空白或卡死的畫面，跟這次要解決的「不要縮到看得到的小方塊」這個核心訴求相比，影響有限。
  - **這次沒有改動 `/api/confirm` 這支後端 API 本身**，也沒有改動 `index.html` 那邊處理 `machi-nas-folder-backup-started`／`machi-nas-folder-selected` 訊息、顯示右下角小提示卡片的邏輯（上一則修改的成果）——這次純粹是把「彈出視窗怎麼從畫面上消失」這一段的做法從「縮小+移動」換成「讓焦點自然蓋過去」，視窗生命週期（何時關閉、何時因為錯誤重新顯示）跟訊息串接完全不變。
  - **`#uploadModal` 的 z-index 調升到 6600 之後，需要留意之後如果再新增其他更高層級的彈出元件（目前最高的是 `.field-popover.is-modal-popover` 的 7000），理論上不會互相影響**（上傳視窗跟這類欄位彈出選單不會同時開啟），但如果之後有人在別的情境下同時觸發兩者，才需要重新檢視疊放順序；這次沒有調整 7000 那條規則。
- 已檢查／驗證方式：
  - `node --check scripts/nas_folder_picker_server.mjs` 通過；抽出內嵌 `<script>` 內容另外用 `node --check` 語法檢查通過。
  - `index.html` 抽出主要 `<script>` 區塊（依目前實際行號切出）用 `node --check` 語法檢查通過。
  - 用本機 Node 靜態伺服器＋ Browser pane 驗證 z-index 修正：先用 `getComputedStyle` 直接量測，**第一次修正（加在 3833 行附近）量到 `uploadZ:1250`，證實真的沒生效**（重現「加了規則但沒用」的既有技術債）；改成直接修改 6065 行本身之後，重新量測 `revisionZ:6500`／`uploadZ:6600`，確認上傳視窗數值正確更高。接著用 1280×800 的 iframe（同一份 `index.html`）**實際打開 `#revisionModal` 與 `#uploadModal` 兩個彈窗**，用 `document.elementFromPoint()` 在上傳視窗中心點做真實的畫面命中測試，確認回傳的元素確實在 `#uploadModal` 內部（不是被 `#revisionModal` 擋住），證明使用者現在真的點得到上傳視窗裡的內容，不只是數值層面的驗證。
  - `node --test backend/test/*.test.mjs` 26/26 全過（沒有任何既有測試字串鎖住這次改到的兩個檔案）。
  - **實際部署**：已經直接在使用者的 Mac 上用 `launchctl kickstart -k` 重啟 `com.emctaipei.nas-folder-picker` 這個 launchd 服務套用新版程式碼，並用 `curl` 確認正在跑的 `/picker` 頁面內容已經是新版（含 `hideBehindOpener`，不再含上一版的 `shrinkWindowOutOfView`）——這次修改**不需要使用者自己手動重啟任何東西**。
  - **未做的驗證**：沒有用真實瀏覽器實際點過一次完整流程確認 `window.opener.focus()` 在使用者實際使用的瀏覽器上，真的會把彈出視窗完全蓋到主頁面後面（自動化測試環境無法驗證真實視窗管理員層級的視覺堆疊行為，只驗證了程式碼呼叫本身正確、且包在 `try/catch` 裡不會出錯）；也沒有實際登入正式站，從「修改紀錄」彈窗點「＋」新增圖片，肉眼確認上傳視窗現在真的疊在最上面可以正常操作到完成一次真實上傳。
- 部署狀態：`index.html` 純前端，git push 後自動生效；`scripts/nas_folder_picker_server.mjs` 是純本機工具，這次已經直接在使用者的 Mac 上重啟對應的 launchd 服務套用新版，不需要使用者額外操作。
- commit：（見下方 push 紀錄）

### 2026-08-13 Asia/Taipei — NAS 資料夾選擇器「選擇這個資料夾並備份」不再於彈出視窗內轉圈，改成主頁面右下角小提示卡片顯示進度

- 修改目的：使用者回報標記過稿中、選「選擇 NAS 資料夾」跳出的彈出視窗，按下「選擇這個資料夾並備份」之後畫面會在**那個彈出視窗裡**轉圈很久（掃描＋壓縮＋上傳到 Google Drive 需要一段時間），要求改成：按下按鈕後那個視窗直接收合、不要再顯示轉圈畫面，改成回到主頁面（`index.html`）右下角出現一張跟「設計圖上傳中」同一種樣式的小提示卡片顯示進度，備份完成後小卡片自動隱藏。
- 影響檔案：`scripts/nas_folder_picker_server.mjs`、`index.html`。
- 影響功能：
  1. **彈出視窗（`nas_folder_picker_server.mjs` 的 `/picker` 頁面）**：`doConfirm()` 點擊當下不再呼叫會把整個視窗畫面換成大轉圈的 `showCollapsed()`（這個函式與對應的 `.collapsed-view`／`.collapsed-spinner` CSS 已整個移除，改成一開始就用 `window.opener.postMessage({type:'machi-nas-folder-backup-started',caseId,nonce,path},origin)` 通知主頁面「備份開始了」，接著呼叫新函式 `shrinkWindowOutOfView()`（`window.resizeTo(1,1)`＋`window.moveTo(screen.availWidth,screen.availHeight)`）把視窗縮到看不到的地方——**視窗本身沒有真的關閉，只是縮小移到螢幕外**，因為 fetch 請求是綁在這個瀏覽器分頁的生命週期上，如果直接 `window.close()`，瀏覽器會連帶把還在進行中的 `/api/confirm` 請求（也就是真正在跑的掃描＋上傳）一起取消掉，備份就會做到一半中斷。原本的「選擇這個資料夾並備份」／「取消」兩顆按鈕在點擊當下會先停用並顯示一行忙碌狀態文字（`背景備份中，可以忽略或縮小這個視窗...`），當作 `resizeTo`／`moveTo` 在某些瀏覽器環境下可能被忽略時的備援畫面，不會讓使用者對著完全沒反應的畫面發呆。備份成功時，直接把備份摘要（`已立即備份 N 張圖片（第 X 輪）` 或 `資料夾已登記...`）一併塞進最終回傳給主頁面的 `machi-nas-folder-selected` 訊息（新增 `summary` 欄位），視窗本身不再顯示「即將關閉...」這類過場文字，直接 `window.close()`；備份請求本身失敗（token 不對、路徑不存在這類「請求層級」錯誤，跟先前「備份失敗不擋路徑登記」的既有分野一致，這次沒有改變）時，新函式 `restoreWindowForPrompt()` 會把視窗還原回原本的 520×640 大小＋置中位置並 `focus()`，讓使用者能看到需要互動的錯誤提示框（重試／仍然登記路徑／取消）——只有這個真的需要使用者決定的情境，視窗才會重新出現在螢幕上。
  2. **主頁面（`index.html`）新增右下角「NAS 資料夾備份中」小提示卡片**：新增 `#nasFolderBackupBadge`（沿用既有 `.case-design-upload-badge` 的圓角白底卡片樣式，跟原本「設計圖上傳中」是同一種視覺語言，只是這次沒有取消按鈕——備份是在另一個獨立視窗裡進行，主頁面沒有簡單乾淨的方式可以中途取消它），新增 `showNasFolderBackupBadge(text)`／`hideNasFolderBackupBadge()` 兩個輔助函式。`handleUploadFrameMessage()` 新增處理 `machi-nas-folder-backup-started` 訊息（比對 `nonce` 正確才處理，避免過期/偽造訊息誤觸發）：顯示小卡片、把模組層級旗標 `nasFolderPickerBackupInProgress` 設成 `true`；既有的 `machi-nas-folder-selected`（備份完成，不論成功或請求失敗但選擇仍然登記）訊息處理，新增呼叫 `hideNasFolderBackupBadge()` 隱藏小卡片，並把彈出視窗這次一併送回來的 `summary` 摘要文字帶進 `updateCaseRow(...)` 的第三個參數（畫面上原本「已設定 NAS 來源資料夾」的提示文字，現在如果備份有真的上傳到圖片，會改顯示更精確的「已立即備份 N 張圖片（第 X 輪）」）。
  3. **視窗被使用者意外關閉時的偵測邏輯，區分「備份中」與「還在選資料夾」兩種情境**：既有的 `watchNasFolderPickerWindow()`（每秒檢查一次彈出視窗是否還開著）新增讀取 `nasFolderPickerBackupInProgress` 這個旗標——如果視窗是在**已經按下確認、備份進行中**的階段被關閉（例如使用者手動找到那個縮到螢幕外的視窗、或用系統快捷鍵把它結束掉），會先隱藏右下角小卡片（`hideNasFolderBackupBadge()`）並顯示「NAS 資料夾備份視窗已意外關閉，備份可能未完成，請重新確認」；如果是在**還沒按下確認、使用者還在挑資料夾**的階段被關閉，維持原本「NAS 資料夾選擇視窗已關閉，尚未選擇資料夾」的既有文案不變。原本備份開始後會停用的「20 秒還沒選好就提醒」邏輯（`還在等待 NAS 資料夾選擇結果...`），這次也一併排除在備份進行中的階段，避免使用者正在等待背景備份完成時被一則不相干的「還在等待選擇結果」訊息打斷。
- 風險區塊：
  - **`shrinkWindowOutOfView()`／`restoreWindowForPrompt()` 都包在 `try/catch` 裡、失敗會安靜略過**——`window.resizeTo`／`window.moveTo` 在部分瀏覽器（尤其是分頁式瀏覽器，如果這個彈出視窗被瀏覽器判定成一般分頁而不是獨立視窗，或使用者裝了限制腳本控制視窗的擴充功能）可能完全不生效或被忽略；沒有生效時，使用者會看到彈出視窗停留在原本大小、顯示「背景備份中，可以忽略或縮小這個視窗...」這行文字＋兩顆停用的按鈕，這是刻意設計的備援畫面（不是空白或卡死的畫面），跟這次要解決的「不要一直轉圈很久」這個核心訴求相比，影響有限——使用者最多是看到一個靜止不動、文字說明清楚在幹嘛的視窗，而不是原本那個持續轉圈的畫面。
  - **視窗刻意不會真的關閉，只是縮小移到螢幕外**，如果使用者不知道這件事、自己手動去 Dock／視窗清單裡把它找出來關掉，會觸發上面第 3 點新增的「意外關閉」偵測與提示，但**這個偵測完全依賴主頁面那個分頁本身還開著、還在跑那個 1 秒一次的計時器**——如果使用者在按下確認之後、備份完成之前就直接整個關掉瀏覽器或這台電腦，主頁面收不到任何後續訊息，右下角小卡片會停留在「NAS 資料夾備份中」不會消失、也不會有任何錯誤提示（這不是這次新引入的風險，是這整套「用另一個視窗＋postMessage 橋接」架構原本就有的已知邊界，[[NAS 資料夾選擇器新增連線逾時／視窗關閉偵測|上一次補齊視窗關閉偵測時就已經記錄過同樣的限制]]）。
  - **這次沒有改動 `/api/confirm` 這支後端 API 本身**（`backupSelectedFolder()`、掃描/壓縮/上傳邏輯完全沒動），純粹是前端呈現層的改動——備份的實際行為（掃到哪些檔案、上傳到哪裡、輪次怎麼判斷）跟改動前完全一致，只是使用者在等待時看到的畫面不同。
- 已檢查／驗證方式：
  - `node --check scripts/nas_folder_picker_server.mjs` 通過；額外把檔案裡 `<script>...</script>` 內嵌的瀏覽器端程式碼抽出來單獨用 `node --check` 語法檢查，通過。
  - `index.html` 抽出主要 `<script>` 區塊（`sed` 依目前實際行號切出，不是憑印象猜行號）用 `node --check` 語法檢查通過。
  - 用本機 Node 靜態伺服器＋ Browser pane 對 `index.html` 做隔離測試（stub 掉 `updateCaseRow`／`setSync`，沒有真的打任何網路請求）：①模擬 `nonce` 不符的 `machi-nas-folder-backup-started` 訊息，確認正確被忽略、小卡片維持隱藏；②模擬 `nonce` 相符的訊息，確認小卡片正確顯示、文字正確、`nasFolderPickerBackupInProgress` 正確變成 `true`；③模擬最終的 `machi-nas-folder-selected` 訊息（帶 `summary` 摘要文字），確認小卡片正確隱藏、`updateCaseRow` 收到正確的 `id`／`changes`／`message`（`message` 正確是備份摘要文字，不是預設的「已設定 NAS 來源資料夾」）、`nonce` 正確被清空；④用假的 `win` 物件（只有 `closed` 屬性）搭配 `watchNasFolderPickerWindow()` 驗證兩種關閉情境——備份進行中被關閉，正確顯示「備份視窗已意外關閉，備份可能未完成」且小卡片正確隱藏；還沒開始備份就被關閉，正確維持顯示既有的「尚未選擇資料夾」文案；這一步**過程中先抓到一個真的會發生的 bug**：第一版寫法是在 `win.closed` 分支裡先呼叫 `clearNasFolderPickerWatch()`（這支函式本身會把 `nasFolderPickerBackupInProgress` 重設成 `false`）才去讀這個旗標判斷該顯示哪一則訊息，導致不管是不是備份中關閉，永遠都顯示「尚未選擇資料夾」這則錯的文案——已經在讀取旗標之前先用一個區域變數 `wasBackingUp` 存下當下的值，改完之後重新測試兩種情境都正確區分。
  - `node --test backend/test/*.test.mjs` 26/26 全過（沒有任何既有測試字串鎖住這次改到的檔案或函式）。
  - **實際部署**：這次工作環境對使用者的 Mac 有直接執行權限（跟 2026-08-13 稍早「填入真實 pickerToken」那則發現的環境能力一致），已經直接用 `launchctl kickstart -k` 重啟 `com.emctaipei.nas-folder-picker` 這個 launchd 服務套用新版程式碼，並用 `curl` 確認正在跑的 `/picker` 頁面內容已經是新版（含 `machi-nas-folder-backup-started`／`shrinkWindowOutOfView`，不再含舊版的 `collapsed-view`）——這次修改**不需要使用者自己手動重啟任何東西**。
  - **未做的驗證**：沒有用真實瀏覽器實際點過一次完整流程（開啟主頁面→標記過稿中→選 NAS 資料夾→在真實彈出視窗裡點「選擇這個資料夾並備份」→肉眼確認視窗真的從畫面上消失、右下角小卡片真的出現、備份完成後小卡片真的消失）；`window.resizeTo`／`window.moveTo` 在使用者實際使用的瀏覽器（Safari／Chrome）上的真實效果也還沒有肉眼確認過，只驗證了程式碼呼叫本身有包在 `try/catch` 裡不會因為被瀏覽器忽略而報錯。
- 部署狀態：`index.html` 純前端，git push 後自動生效；`scripts/nas_folder_picker_server.mjs` 是純本機工具，這次已經直接在使用者的 Mac 上重啟對應的 launchd 服務套用新版，不需要使用者額外操作。
- commit：（見下方 push 紀錄）

### 2026-08-13 Asia/Taipei（次新）— 資料庫後台「資料庫」表移除時間標記、過稿中自動蓋繳交時間戳、新增修改次數欄位、連結可點擊、新增結構化篩選器；備份至雲端試算表改成只覆寫同名欄位

- 修改目的：接續前一則「備份至雲端試算表」功能，使用者再提出五項：①「資料庫後台」的「資料庫」表移除「時間標記」欄（舊資料殘留、前台從未使用）；②案件狀態改成「過稿中」時，把當下時間寫進「繳交時間」欄；③新增「修改次數」欄，反映這個案件目前已經有幾輪修改紀錄；④「資料庫」表裡的連結類欄位（設計簡報連結／客戶素材連結／參考範例連結／其他連結等）目前只顯示截斷的純文字，要改成可以直接點擊；⑤「資料庫」表要新增結構化篩選器（不是純文字搜尋），且視覺樣式要跟現有後台一致、不能跑版。使用者同時明確要求：既然 JSON 端的欄位這次會跟試算表產生落差（拿掉時間標記、多了修改次數），「備份至雲端試算表」不該再像上一版那樣整批清空重寫，只能覆寫「JSON 欄位名稱」跟「試算表表頭」剛好同名的欄位，其餘試算表本來就有、JSON 沒有的欄位（例如舊的時間標記）不該被動到。
- 影響檔案：`backend/schema.mjs`、`worker/src/model.ts`、`worker/src/database-coordinator.ts`、`worker/test/index.test.ts`、`worker/vitest.config.ts`、`upload/Code.gs`、`json_database_admin.html`。
- 影響功能：
  1. **移除「時間標記」、新增「修改次數」**：`DATABASE_HEADERS`（`backend/schema.mjs`）拿掉 `時間標記`、在 `加權` 之後加入 `修改次數`。這份 schema 是聯集式合併（`normalizeDatabaseShape()` 原本會把「既有表頭」跟「schema 表頭」取聯集，代表已經拿掉的欄位只要曾經出現在既有資料裡就永遠不會消失）——這次新增 `DEPRECATED_TABLE_HEADERS`（目前只有 `{database:['時間標記']}`），在合併前先把清單裡的欄位從既有表頭中濾掉，讓「時間標記」真的會從 `database` 表的表頭清單消失；**刻意只套用在 `database` 表**，因為順手檢查全部 11 張表跟各自 schema 的落差時，發現 `平面新開專案`／`影音新開專案` 兩張表本來就有 schema 沒有記錄的額外欄位（空字串欄名、「設計師」「下一位」「實際」「排序」），如果改成全表統一用「精確等於 schema」取代聯集，會把這兩張表的額外欄位意外清空——這次沒有動它們，只精準針對 `時間標記` 這一個欄位、`database` 這一張表做排除。**只影響「表頭清單」，不影響既有資料列本身**——歷史案件裡已經寫進 `時間標記` 的 42 筆資料值不會被刪除，只是不會再出現在後台欄位清單／新的備份欄位比對範圍裡。
  2. **過稿中自動蓋「繳交時間」戳記**：`updateRequests()`（`database-coordinator.ts`，前台 `openStatusEditor()` 呼叫 `updateCaseRow` 觸發的 `update`／`batchUpdate` 動作都會走到這裡）在套用完欄位異動後，多一個判斷：新狀態是「過稿中」、且異動前的狀態不是「過稿中」，才把 `row['繳交時間']` 蓋成 `nowTaipei().slice(0,16)`（分鐘精度，格式 `YYYY/MM/DD HH:mm`）；同一案件之後的其他欄位編輯（沒有再次變更狀態）不會動到這個欄位，案件離開過稿中又重新進入過稿中時會再蓋一次新的時間戳（反映「最近一次進入過稿中的時間」，不是「第一次」）。
  3. **新增「修改次數」自動同步**：`model.ts` 新增 `recalculateDatabaseModificationCounts(database)`，邏輯是「這個案件在『修改統計表』裡目前最大的『修改次數』值」（跟既有 `addModificationRecord` 算下一輪次時用的邏輯一致：0＝只有初稿、N＝已經有 N 輪修改），寫回 `database` 表對應案件列的「修改次數」欄。三個會讓「修改統計表」筆數變動的地方都會呼叫它並把 `'database'` 加進 `changedTables`：`addModificationRecord`（設計師新增修改需求）、`addCaseDesignImages` 在第一次建立某一輪次紀錄時（NAS 監控程式／選擇器立即備份／手動上傳初稿都會走到這裡）、以及後台 `adminMutation` 對 `修改統計表` 表的新增／編輯／刪除（比照既有 `加權計分標準` 表變動時觸發 `recalculateDatabaseWeights` 的寫法）。
  4. **後台「資料庫」表連結欄位可點擊**：`databaseTableHtml()`（`json_database_admin.html`）欄位分三種處理——欄名含「網址」維持原本 `linkLinesHtml()`（多行 `標籤｜網址` 格式，沿用既有其他表在用的樣式）；欄名含「連結」（`設計簡報連結／客戶素材連結／參考範例連結／其他連結／設計圖資料夾連結`）且內容是 `http(s)://` 開頭的網址，新增 `databaseLinkCellHtml()` 包成 `target="_blank" rel="noopener"` 的可點擊連結，同時保留原本 `.clip` 單行截斷樣式（滑鼠移上去仍有 `title` 顯示完整網址）；其餘欄位維持原本純文字截斷顯示。非網址格式的文字（理論上不該出現在連結欄位，但防呆）不會被包成連結。
  5. **新增結構化篩選器**：「資料庫」表的內容工具列下方新增一排篩選列（`#databaseFilters`，只在 `tableName==='database'` 時顯示，切到其他表籤會自動重置並隱藏），三個下拉選單——狀態（沿用既有 `ACCOUNT_STATUS_OPTIONS`）、設計種類（新增 `DATABASE_TYPE_OPTIONS=['平面','影音','採購']`，跟前台 `baseDesignLists.types` 一致）、設計負責人（沿用既有 `ACCOUNT_DESIGNER_OPTIONS`）——都是「已有的欄位選項清單」重複使用，沒有另外定義一份新名單。樣式刻意重用既有的 `.content-actions` class（跟工具列同一顆版型），不是另外寫一組新 CSS，確保視覺上是同一種後台元件、不會不搭調或跑版。篩選條件送出時序列化成 `filters` 查詢參數（`{"狀態":"過稿中","設計負責人":"Machi"}` 這種 JSON 字串），後端 `adminTableRows()` 新增解析與 AND 邏輯的精確比對過濾（跟原本就有的自由文字 `q` 搜尋是疊加關係，不是取代）。「清除篩選」按鈕只在至少有一個篩選條件生效時才顯示。
  6. **「備份至雲端試算表」改成只覆寫同名欄位（不再整批清空重寫）**：`upload/Code.gs` 的 `backupDatabaseTableToSheet()` 整個重寫——原本的做法（清空整個資料範圍、重新寫入 JSON 端目前的表頭與資料）會把試算表上任何「JSON 沒有但試算表本來就有」的欄位一併清掉，這次移除欄位（時間標記）跟新增欄位（修改次數）之後，JSON 表頭已經跟試算表既有表頭產生落差，繼續用舊做法會把試算表上的「時間標記」欄整欄清空，不符合使用者這次的明確要求。新邏輯：先讀出試算表「database」分頁目前第一列的表頭，只有「JSON 端這次送來的欄位名稱」與「試算表既有表頭」剛好同名的欄位才會被寫入新值；用主鍵（`案件編號`，`Cloudflare Worker` 這次一併把 `table.primaryKey` 帶進請求 payload，不是寫死在 Apps Script 裡）比對既有列——對得到就地更新相符的欄位，對不到就在最後新增一列（新列只填相符欄位，其餘欄位留空，因為那些資料本來就不是這次備份的來源）；試算表上有、JSON 沒有的欄位（例如「時間標記」）完全不會被觸碰；JSON 有、試算表還沒手動加上的新欄位（例如「修改次數」，除非使用者自己手動在試算表加一欄同名表頭）也不會被硬塞進去。回傳格式從原本的 `rows`（總筆數）改成 `matchedColumns`／`updated`／`appended` 三個數字，`json_database_admin.html` 的成功訊息文字也跟著改成「已同步 N 個相符欄位：更新 X 筆、新增 Y 筆」。**這支函式本來就不會主動刪除試算表上的既有列**（即使該案件在 JSON 裡已經被刪除），這個保守行為這次沒有改變，維持「只增不刪」以避免使用者可能還需要的歷史紀錄被意外清掉。
- 風險區塊：
  - **`DEPRECATED_TABLE_HEADERS` 這個機制是這次新增的、專案裡第一次真正「主動移除欄位」的做法**——過去所有 schema 修改都只有新增欄位，這是第一次要讓既有的聯集式相容邏輯真的把一個欄位排除掉。已經先用程式核對過目前正式資料庫裡全部 11 張表跟各自 schema 的落差，確認只有 `平面新開專案`／`影音新開專案` 有額外欄位、且這次的排除清單刻意沒有動到它們；但這代表**之後如果要再移除其他表的欄位，必須比照這次先做同樣的落差核對，不能想當然爾直接加進排除清單**，否則有機會意外清掉某張表本來就依賴的額外欄位。
  - **`繳交時間` 自動蓋章目前沒有排除任何呼叫來源**——只要是透過 `update`／`batchUpdate` 這個動作把狀態改成「過稿中」（不論是前台 `openStatusEditor()` 這個主要途徑，或未來任何呼叫同一個 action 的新功能），都會觸發蓋章；資料庫後台 `adminMutation`（`json_database_admin.html` 通用表格編輯器直接改「資料庫」表的欄位）這條路徑**沒有**加上同樣的自動蓋章邏輯，是刻意的範圍收斂——使用者這次描述的是「狀態更改『過稿中』時」這個特定的操作動線（前台標記過稿中），不是「任何管道寫入過稿中都算」，後台通用編輯器本來就讓管理者完整控制所有欄位（含繳交時間本身），沒有理由替他加一層自動覆蓋。
  - **「修改次數」的計算依據是「修改統計表目前最大的修改次數值」，不是單純的列數統計**——如果之後有人透過後台通用編輯器手動刪除或竄改「修改統計表」裡某一輪的「修改次數」欄位值（跳號、留空等不正常情況），重算出來的「修改次數」可能不準確；這個風險本來就存在於既有的 `加權` 欄位重算邏輯（`recalculateDatabaseWeights`）身上，這次的實作只是比照同一套既有慣例，不是新引入的問題類型。
  - **`backupDatabaseTableToSheet()` 的欄位比對是精確字串相等（區分大小寫、不做任何模糊比對），且要求試算表「database」分頁本身不能是空的**（沒有任何表頭列會直接報錯，不會嘗試自動建立表頭）——如果試算表上的表頭欄名跟 JSON 端欄名有任何字元差異（例如多一個空格、全形/半形符號不同），該欄就會被判定成「對不到」而完全不參與這次同步，不會報錯、只是那個欄位不會更新，使用者需要自己核對表頭文字是否一致。
  - **這次同時修改了 Worker 傳給 Apps Script 的 payload 形狀**（新增 `primaryKey` 欄位）**與 Apps Script 端讀取 payload 的邏輯**（改成讀 `payload.primaryKey`、比對試算表既有表頭）——這兩邊必須同時部署到位才能正常運作：只部署 Worker、沒有部署新版 `upload/Code.gs`，Apps Script 那邊還在跑舊版的「整批清空重寫」邏輯，會繼續把試算表上的「時間標記」欄清空，沒有達成使用者這次要保留該欄的要求；只部署 Apps Script、沒有部署 Worker，則 Worker 送出的 payload 沒有 `headers` 反映新schema（不影響功能，因為 Apps Script 新邏輯本來就是用「有出現在雙方」判斷，只是新增的「修改次數」欄自然不會被同步，直到 Worker 也部署完成）。這次兩邊在同一次工作階段內一起完成程式修改與測試，避免版本不同步的空窗期。
- 已檢查／驗證方式：
  - `cd worker && npx tsc --noEmit` 無錯；`npx vitest run` **16/16 全過**（在既有 12 支測試之外新增 4 支，涵蓋這次全部風險最高的行為）：①過稿中轉換第一次正確蓋章（格式 `YYYY/MM/DD HH:mm`）、同一案件之後的一般欄位編輯不會改動已蓋的時間戳、離開過稿中又重新進入時會再蓋一次新的戳記；②`addModificationRecord` 新增修改紀錄後 `database` 表對應列的「修改次數」正確同步、後台 `adminTableDelete` 明確刪除該筆修改紀錄後「修改次數」正確跟著減少（同時驗證 `changedTables` 正確包含 `database`）；③`adminTables` 回傳的 `database` 表頭正確不含「時間標記」、正確含「修改次數」，`adminTableRows` 帶 `filters:{"狀態":"過稿中"}` 正確只回傳符合的案件、不帶篩選則回傳全部；④`backupDatabaseToSheet` 正確呼叫 Apps Script exec 網址、payload 正確帶 `primaryKey`／`headers`（含修改次數、不含時間標記）／`rows`，正確回傳 `matchedColumns`／`updated`／`appended`，且 secret 沒設定時明確擋下（這支測試也順手驗證了 `DATABASE_BACKUP_API_KEY`／`NAS_WATCHER_API_KEY` 需要補進 `worker/vitest.config.ts` 的測試用 binding 才能通過，已一併補上，只影響測試環境設定，不影響正式環境的真實 secret 管理方式）。
  - `upload/Code.gs` 複製成 `.js` 副檔名後 `node --check` 語法檢查通過。
  - `index.html`／`json_database_admin.html` 兩份檔案的 `<script>` 區塊都用 `new Function()` 語法檢查通過。
  - 用本機 Node 靜態伺服器＋ Browser pane 對 `json_database_admin.html` 做隔離測試：篩選列只在切到「資料庫」表籤時顯示、切到其他表籤正確隱藏；三個篩選下拉選單的選項清單正確對應既有的狀態／設計種類／設計負責人清單；選擇篩選條件後 `queryPath()` 正確組出帶 `filters` JSON 的查詢字串、「清除篩選」按鈕正確依有無生效條件顯示/隱藏、點擊後正確清空狀態；`databaseTableHtml()` 對含「連結」字樣的欄位、內容是合法網址時正確輸出 `target="_blank" rel="noopener"` 的可點擊連結（且維持 `.clip` 截斷樣式），非網址文字內容正確維持純文字不被誤包成連結；「備份至雲端試算表」按鈕點擊後的成功訊息正確顯示新的「已同步 N 個相符欄位：更新 X 筆、新增 Y 筆」格式文字。
  - `node --test backend/test/*.test.mjs` **25/25 全過**（確認 schema 變動、`normalizeDatabaseShape` 的表頭排除邏輯沒有被任何既有測試鎖住或破壞）。
  - `npx wrangler deploy --dry-run` 打包成功。
  - **正式端對端備份驗收已完成（2026-08-13 18:12 Asia/Taipei）**：以正式管理者 session 呼叫正式 Cloudflare Worker 的 `backupDatabaseToSheet`，完整走過 Worker → Apps Script 第 49 版 → 真實 Google 試算表 `database` 分頁；回傳 `ok:true`、JSON 來源 615 筆、25 個同名欄位、更新 614 筆、新增 1 筆、revision 905，證明兩端 service key 相符且新版「只覆寫同名欄位」路徑可實際完成。
  - **仍未做的驗證**：沒有用真實登入的設計師帳號在正式站標記一次過稿中，實機確認「繳交時間」欄真的被寫入且前台其他畫面沒有意外受影響（例如是否有任何既有畫面用到「繳交時間」這個欄位名稱，這次程式碼層面已核對過整個 repo 沒有其他消費者，理論上安全，但沒有實機跑過完整流程）。
- 部署狀態：
  - `backend/schema.mjs`、`json_database_admin.html`、`CLAUDE.md` 純前端／共用檔案，git push 後自動生效。
  - **`worker/` 這次已經在本機直接執行 `wrangler secret put DATABASE_BACKUP_API_KEY`（產生隨機值）＋ `wrangler deploy` 完成部署並實測 `ping` action 確認新版本已生效（`version: cloudflare-worker-account-directory-2026-08-13-3`）**——跟前一則紀錄不同，這次不是留給使用者手動做，是這個工作階段內直接在使用者本機用已登入的 `wrangler` CLI 完成的。
  - **`upload/Code.gs` 已由後續工作階段完成部署**：沿用公司 Chrome 的既有 Google 登入狀態，將 `DATABASE_BACKUP_API_KEY` 寫入 `upload` Apps Script 專案的指令碼屬性、把本機最新版 1,999 行 `upload/Code.gs` 完整同步並儲存，原正式 Web App 部署更新為 **第 49 版**（說明：`資料庫備份只更新同名欄位 2026-08-13`）。部署作業 ID、Web App `/exec` 網址、執行身分與「所有人」存取設定均維持不變。
  - 前端與共用程式已在吸收遠端最新資料 commit 後推送至 `main`，功能 commit：`5d97064`。
- commit：`5d97064`（功能與部署紀錄；本段最終驗收紀錄另以後續文件 commit 補上）

- 修改目的：使用者一次提出三項：①前台設計師登入後，帳號選單裡的「設計儀表板」連結會失效（點了沒反應）；②管理者帳號選單裡的「資料庫後台」與「歷史資料庫管理」目前點擊會直接在同一個分頁導航過去，要求改成開新分頁；③資料庫後台要新增一個功能，可以把目前「資料庫」表（`database`，也就是所有案件）的最新資料整批備份到雲端 Google 試算表。
- 影響檔案：`index.html`、`json_database_admin.html`、`worker/src/database-coordinator.ts`、`worker/wrangler.jsonc`、`worker/worker-configuration.d.ts`（`npx wrangler types` 自動重新產生）、`upload/Code.gs`。
- 影響功能：
  1. **設計儀表板連結失效（根因＋修正）**：`canOpenDesignDashboard()`（[index.html:8860](index.html:8860)）原本寫死 `designerOptions.includes(currentEditor)`——`designerOptions` 只有 `['Machi','Anna','Karl','Noise','Amber','Leona']` 這 6 個「正式派案用」的設計師姓名（用於填單選單、輪值、頭像資料夾對照等），跟「這個帳號算不算設計師、可不可以打開設計儀表板」是兩件不同的事，但這支函式誤用同一份清單來判斷後者。任何登入帳號的「名字」不在這 6 個之列（例如「設定」表裡本來就存在、供內部測試用的 `設計測試組` 帳號，組別是「影音」；或未來任何新加入、姓名尚未加進 `designerOptions` 的設計師），即使該帳號在 Worker 端已經正確拿到 `page.dashboard` 頁面權限（`帳號權限`／`角色權限範本` 都沒有問題），前台仍然會把「設計儀表板」選單項目整個隱藏、連結形同失效。修正：改用專案裡本來就有、依角色與設計組別判斷的 `hasDesignerAccountRole()`（[index.html:7502](index.html:7502)：`['設計師','管理者'].includes(currentAccessRole())||['平面','影音','管理者'].includes(currentDesignGroup())`），這支函式已經是 `isDesignerLogin()` 等既有邏輯在用的判斷依據，語意上就是「這個帳號算不算設計師／管理者」，比對照一份寫死的姓名清單更貼近真正要判斷的條件。
  2. **資料庫後台／歷史資料庫改分頁開啟**：`#accountArchiveManager`／`#accountJsonDatabaseAdmin` 兩個帳號選單項目的點擊事件（[index.html:10279-10280](index.html:10279)），把 `location.href=...` 改成 `window.open(...,'_blank','noopener')`，跟同一個選單裡「短網址工具」既有的開新分頁行為一致；權限判斷（`accessAllowed('page.archive'/'page.database_admin',false)`、`accessAllowed('archive.edit'/'database.manage',false)`、`isAdminUserPreview()`）完全沒有改動，只換了最後導航這一步。
  3. **資料庫後台新增「備份至雲端試算表」**：只在「資料庫」（`database`）這個頁籤顯示一顆新按鈕（`updateAddButton()` 新增 `$('backupToSheet').hidden=tableName!=='database'`，其餘 7 張表不會看到這顆按鈕，因為那些表本來就已經是「JSON 為唯一資料來源、不回寫試算表」的既定規則，見本文件[第 4 節](#4-寫入與備份規則重要)，這次新功能刻意只限定在 `database` 這張表，不打算讓其餘 7 張表也能被手動備份到試算表，避免又製造一條意外的回寫路徑）。點下按鈕會先跳原生 `confirm()` 二次確認（因為這是「整批覆寫」，會取代雲端試算表 `database` 分頁目前的內容，不是新增），確認後呼叫新的 Worker action `backupDatabaseToSheet`（`database.manage` 權限）。
     - **Worker**（`database-coordinator.ts` 新增 `backupDatabaseToSheet()` 私有方法）：直接讀取 Worker 自己保存的 `database` 表快照（headers＋rows，也就是「目前最新資料」的唯一可信來源，不接受前端傳入的資料，避免瀏覽器裡可能過期的畫面內容被誤當成「最新」寫回試算表），呼叫既有的、正式站已經部署在跑的上傳用 Apps Script（`upload/Code.gs`，這次重新把它的 exec 網址加回 `wrangler.jsonc` 的 `UPLOAD_APPS_SCRIPT_URL` 這個 var——這個網址跟前台 `designerUploadPageUrl` 完全相同、本來就是公開資訊，不是密鑰），帶新的服務金鑰 `DATABASE_BACKUP_API_KEY`（新增的 secret，跟既有的 `NAS_WATCHER_API_KEY` 刻意分開、互不共用，理由跟 `NAS_WATCHER_API_KEY` 當初的設計一致：其中一組外流不會連帶讓另一組服務也被冒用）。
     - **Apps Script**（`upload/Code.gs` 新增 `backupDatabaseTableToSheet()`＋`verifyDatabaseBackupServiceKey_()`，`doPost` 新增對應分支）：驗證服務金鑰後，把收到的 headers／rows 整批寫進 `DESIGNER_SPREADSHEET_ID`（也就是 CLAUDE.md 第 2 節提到的那份 Google 試算表）裡名為 `database` 的分頁（gid=1244538986，跟前台填單、資料庫後台編輯 `database` 表既有的回寫機制寫的是同一個分頁），寫法比照舊版 `google_apps_script.gs` 的 `mirrorGithubJsonTableToSheet_()`：先清空整個既有內容範圍，再整批寫入表頭與資料列，`setFrozenRows(1)` 凍結表頭列，全程用 `LockService` 加鎖避免跟其他寫入動作互相干擾。
  4. 這個新功能是**單向、手動觸發**的備份（Worker JSON → 試算表），跟第 4 節既有的「填單／後台編輯 `database` 表會自動回寫試算表」是两条独立的路径——既有的自動回寫是「有變動才觸發、只覆寫變動當下的那一整份 `database` 資料」，這次新增的是「使用者主動點擊、任何時候都能把目前的最新狀態整批重新同步一次」，用途是在自動回寫因為任何原因（例如試算表在自動回寫期間被手動改動、或懷疑兩邊不同步）漏掉或不一致時，可以手動強制拉齊，不影響、也不取代既有的自動回寫規則。
- 風險區塊：
  - **這次新增的 `DATABASE_BACKUP_API_KEY` 是全新的 secret，還沒有真正的值**——必須由使用者執行 `wrangler secret put DATABASE_BACKUP_API_KEY`（在 `worker/` 目錄下）設定一組隨機值，並在 Apps Script 編輯器「專案設定 → 指令碼屬性」新增同名、同值的屬性，兩邊都設定好、Worker 也重新部署之後，「備份至雲端試算表」這顆按鈕才會真的可以動作；在那之前點擊會收到清楚的錯誤訊息（Worker 端：`尚未設定雲端試算表備份服務`；Apps Script 端：`Apps Script 尚未設定 DATABASE_BACKUP_API_KEY 指令碼屬性`），不會靜默失敗或寫入垃圾資料。
  - **`backupDatabaseTableToSheet()` 是整批清空重寫，不是逐格比對更新**——如果雲端試算表那個 `database` 分頁上有人手動加了額外的欄位、註解、格式設定，這次備份會把那個分頁的內容範圍整個清空重寫，跟既有的 `mirrorGithubJsonTableToSheet_()`（第 4 節提到的「填單／後台編輯 database 表」既有回寫機制）行為一致，是刻意沿用既有慣例，不是這次新引入的風險，但仍值得提醒使用者：這個分頁應該被當成唯讀的「JSON 資料庫鏡像」看待，不要手動編輯。
  - Worker 呼叫 Apps Script 是**伺服器對伺服器的 fetch**（不是瀏覽器發出的請求），不受瀏覽器 CORS 限制；這個「Worker 主動呼叫 Apps Script」的方向在 2026-08-12 「過稿中改成互動式詢問來源資料夾連結」那次工作已經被驗證過技術上可行（後來會被撤回純粹是因為 Apps Script 連不到公司內網 NAS，跟 Worker↔Apps Script 的 HTTP 呼叫機制本身無關），這次是重新採用同一個已驗證過的模式。
  - 資料量評估：目前 `database` 表約 600 多筆案件、27 個欄位，整批 JSON payload 遠低於 Cloudflare Worker 與 Apps Script 兩端的請求大小限制；新增了 `MAX_DATABASE_BACKUP_ROWS=20000` 這個寬鬆上限單純防呆，不影響目前規模的正常使用。
- 已檢查／驗證方式：
  - `cd worker && npx wrangler types` 重新產生 `worker-configuration.d.ts`（新增 `UPLOAD_APPS_SCRIPT_URL`／`DATABASE_BACKUP_API_KEY` 兩個型別），`npx tsc --noEmit` 無錯，`npx vitest run` 12/12 全過，`npx wrangler deploy --dry-run` 打包成功並確認 `UPLOAD_APPS_SCRIPT_URL` 正確出現在環境變數清單。
  - `upload/Code.gs` 複製成 `.js` 副檔名後 `node --check` 語法檢查通過（Apps Script 專屬的 `DriveApp`／`SpreadsheetApp`／`PropertiesService`／`LockService` 等全域物件無法在本機真正執行，只能檢查語法與人工比對既有 `mirrorGithubJsonTableToSheet_()`／`uploadCaseDesignImages()` 的寫法）。
  - `index.html`／`json_database_admin.html` 兩份檔案的 `<script>` 區塊都用 `new Function()` 語法檢查通過。
  - 用本機 Node 靜態伺服器＋ Browser pane 對 `index.html` 做隔離測試：模擬一個「名字不在 `designerOptions` 清單裡、組別是影音」的登入帳號（模擬正式資料庫裡真實存在的 `設計測試組` 測試帳號情境），確認**修正前**的邏輯（`designerOptions.includes(currentEditor)||currentDesignGroup()==='管理者'||isLocalAdminToken()`）會回傳 `false`（重現使用者回報的失效現象），**修正後**的 `canOpenDesignDashboard()` 正確回傳 `true`；同時確認真正的 6 位正式設計師（如 `Machi`）與非設計師的一般帳號在修正後分別仍正確回傳 `true`／`false`，證明修正只填補了漏洞、沒有擴大或縮小既有的存取範圍。另外攔截 `window.open` 並模擬權限全部通過，觸發 `#accountArchiveManager`／`#accountJsonDatabaseAdmin` 的點擊事件，確認兩者都正確改用 `window.open(url,'_blank','noopener')`。
  - 用本機 Node 靜態伺服器＋ Browser pane 對 `json_database_admin.html` 做隔離測試：確認「備份至雲端試算表」按鈕只在 `tableName==='database'` 時顯示、切到其他表時正確隱藏；攔截 `appsScriptRequest` 驗證點擊後正確帶 `action:'backupDatabaseToSheet'` 呼叫、成功時正確顯示「已備份 N 筆資料...」提示並還原按鈕文字與可點擊狀態；使用者在確認對話框按「取消」時完全不會呼叫 API；模擬 API 失敗時正確顯示紅字錯誤訊息且按鈕恢復可再次點擊。
  - `node --test backend/test/*.test.mjs` 25/25 全過（確認這次改動沒有被任何既有測試字串鎖住，也沒有破壞既有行為）。
  - **未做的驗證**：`DATABASE_BACKUP_API_KEY` 這個新 secret 還沒有實際值，所以沒有、也不可能做到「真的把資料寫進 Google 試算表」的端對端測試，需要使用者設定好金鑰＋部署 Worker＋部署 Apps Script 之後自己在正式站點一次「備份至雲端試算表」確認結果；也沒有用真實的管理者帳號登入正式站確認「資料庫後台」「歷史資料庫管理」點擊後真的開新分頁（本機測試只驗證了 `window.open` 有沒有被正確呼叫、呼叫參數是否正確，沒有肉眼確認瀏覽器實際新分頁行為）。
- 部署狀態：`index.html`、`json_database_admin.html` 純前端，git push 後自動生效。**`worker/` 需要手動部署才會生效**：先執行 `wrangler secret put DATABASE_BACKUP_API_KEY` 設定新密鑰，再 `cd worker && pnpm test && pnpm check && pnpm deploy:dry` 確認過關後 `pnpm deploy`——在這之前，「備份至雲端試算表」按鈕點下去會得到「尚未設定雲端試算表備份服務」的錯誤，其餘既有功能不受影響。**`upload/Code.gs` 需要手動部署新版本**（Apps Script 編輯器「部署 → 管理部署 → 編輯 → 新版本」），且部署前要先在「專案設定 → 指令碼屬性」新增 `DATABASE_BACKUP_API_KEY`（值需跟 Worker 那邊 `wrangler secret put` 設定的完全一致）——兩邊金鑰對不上，備份會收到「服務金鑰不正確」的錯誤。設計儀表板連結修正、分頁開啟改動都是純前端，不需要任何後端部署。
- commit：（見下方 push 紀錄）

### 2026-08-13 Asia/Taipei（次新）— 修改紀錄初版日期改用案件起訖時間、縮圖勾選框改成懸停才出現

- 修改目的：使用者提出三項「修改紀錄」彈窗的微調：①初版（第 0 輪／初稿）目前顯示的日期是「這批圖片第一次被備份上傳的時間」（NAS 監控程式或選擇器立即備份寫入的 `建立日期`／`修改日期`），跟這個案件實際的執行區間常常對不上（例如案件 7 月就開始執行，但設計師到 8 月才第一次過稿備份，畫面上初版卻顯示 8 月），要求初版改成顯示案件本身的「開始日期－結束日期」；②縮圖左下角的勾選框想再往下移一點，讓它離底部邊緣有一點呼吸空間，不要整個貼齊邊角；③勾選框平常應該完全隱藏，滑鼠移到縮圖上才出現（跟右上角既有的刪除「✕」按鈕一樣是滑鼠移過去才需要看到的操作，不需要一直佔位置提醒使用者「這裡可以勾選」）。
- 影響檔案：`index.html`。
- 影響功能：
  1. `revisionDateRange(row,record)`（原本簽章是 `revisionDateRange(record)`，這次改成要吃 `row` 才能拿到案件的 `start`／`end`）新增判斷：`record.count<=0`（初版／第 0 輪）時改回傳 `${revisionShortDate(row.start)}-${revisionShortDate(row.end)}`（案件開始日期－結束日期），其餘輪次維持原本的 `${revisionShortDate(record.created)}-${revisionShortDate(record.date)}`（這批修改實際建立/送出的日期）不變。兩個呼叫點（`revisionRecordMeta(row,record)` 與案件列表右側「新修改需求」通知清單的 `modifyItems`）都已經在自己的作用域內有 `row` 可用，一併把呼叫改成 `revisionDateRange(row,record)`。
  2. `.revision-image-select` 的 `bottom` 從 `2px` 調整為 `5px`、`left` 從 `2px` 調整為 `3px`，離縮圖邊緣稍微留一點距離，視覺上不會整個貼在角落。
  3. `.revision-image-select` 新增 `opacity:0` 搭配 `.12s` 淡入淡出的 transition，平常完全看不到；新增 `.revision-image-item:hover .revision-image-select`／`.revision-image-select:checked`／`.revision-image-select:focus-visible` 三條規則把 `opacity` 設回 `1`——滑鼠移到縮圖上、這張圖片已經被勾選、或用鍵盤 Tab 移到這個勾選框上時都會顯示。**刻意讓「已勾選」的狀態不受 hover 影響、永遠顯示**：如果只有 hover 才顯示，使用者勾選完幾張圖片後把滑鼠移開，畫面上會完全看不出來剛剛勾了哪些、容易誤以為勾選被清空，所以已勾選的圖片即使滑鼠移開也維持看得到勾選框。
- 風險區塊：無新增風險。日期改動純粹是顯示層（`revisionDateRange` 只用於畫面呈現的文字組合），沒有動到任何寫入邏輯或後端資料結構，`record.created`／`record.date` 本身還是照樣存在資料庫裡，只是初版這筆紀錄的畫面顯示改用案件的 `開始日期`／`結束日期`。勾選框的 hover 顯示是純 CSS `opacity`（不是 `display:none`），複選框在隱藏狀態下依然存在於 DOM、依然可以被程式操作（`toggleAllRevisionImageSelection` 等既有邏輯完全不受影響），只是視覺上預設不顯示。
- 已檢查／驗證方式：`index.html` 主要 `<script>` 區塊語法檢查通過。用 1280×800 iframe＋`iframe.contentWindow.eval()` 灌入假資料（案件 `開始日期=2026-07-01`／`結束日期=2026-07-20`，第 0 輪的 `建立日期`／`修改日期` 刻意設成完全不同的 `2026-08-10` 用來製造反差）呼叫 `renderRevisionModal()`，確認畫面上「初稿」那一列正確顯示「07/01-07/20」（案件起訖），不是「08/10-08/10」（備份時間）；同一份假資料裡第 1 輪（一修）維持顯示自己的 `建立日期`／`修改日期`，證明只有第 0 輪的顯示邏輯改變，其餘輪次不受影響。勾選框：`getComputedStyle` 確認預設 `opacity:0`、`bottom:5px`、`left:3px`；直接走訪 `document.styleSheets` 確認 `.revision-image-item:hover .revision-image-select` 與 `.revision-image-select:checked` 兩條規則都存在；手動把一個 checkbox 設成 `checked=true` 後 `getComputedStyle` 確認 `opacity` 變成 `1`（驗證「已勾選維持顯示」這條規則生效）。`node --test backend/test/*.test.mjs` 25/25 全過。
- 部署狀態：純前端，git push 後自動生效。
- commit：（見下方 push 紀錄）

### 2026-08-13 Asia/Taipei（較早）— 修正「設計圖記錄」寬度太窄的問題：真正生效的是後面那組未加 media query 的樣式覆寫

- 修改目的：上一輪把「設計圖記錄」改成橫向捲動後，使用者回報「只露出兩張太短了，寬度可以拉到大概對齊上方『數量』欄位的位置」。追查後發現：上一輪加的 `grid-column:1/-1!important`（讓這個欄位跨滿「其他資訊」整列）寫在 `index.html` 大約 3044 行那組樣式裡，但**那組樣式其實已經不是實際生效的版本**——`#caseDetailModal` 這個彈窗在檔案後段（約 5570 行開始，`/* Case detail presentation: keep existing data bindings, replace only layout and color. */` 這行註解之後）還有**第二組完整的樣式覆寫，而且沒有包在任何 `@media` 裡、一律生效**，這組後來的樣式對 `.case-detail-row.is-wide` 又重新設回 `grid-column:auto!important`（約 5628 行），跟我上一輪加的規則選擇器特異度（specificity）打平，但因為在檔案裡排序更後面，瀏覽器最終套用的是這一組——導致我上一輪的「跨滿整列」設定實際上完全沒生效，欄位還是被限制在「其他資訊」2 欄版面裡的其中一欄，只有 143px 寬，跟使用者原本反映的「只露出兩張」完全吻合。
- 影響檔案：`index.html`。
- 影響功能：在後面那組真正生效的樣式區塊裡（約 5810 行，緊接在既有的 `[data-field-label="項目細節"]{grid-column:1/3}`／`[data-field-label="修改"]{grid-column:3/5}` 這兩條同類型欄位覆寫規則後面，照抄同一種寫法），新增 `#caseDetailModal .case-detail-section.is-other .case-detail-row[data-field-label="設計圖記錄"]{grid-column:1/-1!important;border-left:0!important}`——這次是直接沿用這組樣式裡「其他資訊」區塊既有的、真的會生效的欄位覆寫模式，不是自創一條新規則去跟既有規則比誰的特異度高。上一輪加在 3044 行附近的規則**沒有刪除**（留著也不會造成衝突，只是在目前的樣式結構下是死規則，不會被套用；`.case-detail-value{align-items:stretch;flex-direction:column}` 那條也是同樣情況——後面那組生效樣式裡 `.case-detail-value` 其實是 `display:block`，不是 flex，所以這條也用不到，但同樣留著無害）。修好之後，「設計圖記錄」的可視寬度會撐滿「其他資訊」整個區塊，右邊界跟「執行資訊」裡「數量」欄位的右邊界對齊（都是同一張卡片的整體寬度）。
- 風險區塊：這次意外發現這個檔案的 `#caseDetailModal` 樣式**存在兩組互相覆蓋的定義**（前面 2984-3200 行左右一組，後面 5570 行以後一組），後面那組沒有任何 `@media` 保護、一律生效，等於前面那組除了極少數沒被後面重複定義到的規則以外，大多是死代碼。這不是這次改動造成的（這次只是在追查寬度問題時意外發現），但代表**之後如果要再調整案件詳情彈窗的任何樣式，都必須先確認是在後面那組（約 5570 行起）加規則，不能只改前面那組**，否則會重演這次「改了但畫面沒反應」的狀況。這個「兩組樣式互相覆蓋」的技術債這次沒有清理（範圍太大、風險超出這次要處理的問題），先記錄下來提醒之後的修改者。
- 已檢查／驗證方式：`index.html` 主要 `<script>` 區塊語法檢查通過。沿用上一輪「1280×800 iframe＋`iframe.contentWindow.eval()`」的測試方式，重新量測：`.case-detail-design-images-row` 的 `clientWidth` 從修正前的 143px 變成 680px；`designRowRect.right`（1021px）現在精確對齊 `qtyFieldRect.right`（同樣 1021px，即「執行資訊」裡「數量」欄位的右邊界）；6 張、8 張圖片的輪次現在整排都放得下不用捲動（`scrollWidth===clientWidth`），10 張、15 張的輪次仍然正確橫向捲動（`scrollWidth>clientWidth`）；額外截圖確認畫面上一排可以看到 6 張縮圖、版面沒有跑版。`node --test backend/test/*.test.mjs` 25/25 全過。
- 部署狀態：純前端，git push 後自動生效。
- commit：（見下方 push 紀錄）

### 2026-08-13 Asia/Taipei（較早）— 案件詳情「設計圖記錄」改成每輪左右滾動一排，避免圖片過多撐爆彈窗

- 修改目的：使用者回報案件資料彈窗（案件詳情）新增的「設計圖記錄」區塊，原本用 `flex-wrap` 讓縮圖自動換行——如果某一輪備份圖片很多（例如 NAS 背景監控程式陸續抓了十幾張），縮圖會一直往下疊、把整個彈窗撐得很高，要求改成「由左至右一排」用左右滑動瀏覽，圖片再多也收在彈窗裡面、不要把版面撐壞。
- 影響檔案：`index.html`。
- 影響功能：`caseDetailDesignImagesHtml()` 每一輪的縮圖容器新增 `case-detail-design-images-row` 這個額外 class（跟既有的 `.revision-modal-images` 共用同一批縮圖樣式，只是疊加這個新 class 改變排列方式），並把所有輪次的分組整個包進外層的 `.case-detail-design-images-scroll` 容器裡。新增兩條 CSS：①`.case-detail-design-images-row{flex-wrap:nowrap!important;overflow-x:auto;overflow-y:hidden}`——把原本 `.revision-modal-images` 的 `flex-wrap:wrap` 改成單行不換行＋超出寬度時橫向捲動，每張縮圖本來就有 `flex:0 0 auto`（既有樣式，不會被壓縮變形），所以不管這一輪有幾張圖，都是同一排、用滑鼠/觸控左右滑動看完，不會往下擠壓其他輪次或撐高彈窗；②`.case-detail-design-images-scroll{max-height:220px;overflow-y:auto}`——如果案件修改輪次很多（例如過稿中反覆修改十幾輪，每輪都有圖），整個「設計圖記錄」區塊也設了高度上限，超過就整塊垂直捲動，而不是無限往下長，這樣不管輪次多或單輪圖片多，案件詳情彈窗本身的高度都維持穩定。這次沒有動到「修改紀錄」彈窗（`revisionImagesHtml`／`renderRevisionModal`）裡縮圖的排列方式——使用者這次只提到「案件資料彈窗」，修改紀錄彈窗維持原本 `flex-wrap` 換行的排法不變，兩處雖然共用底層縮圖樣式，這次是額外疊加 class 只影響案件詳情這一處，不會互相牽動。
- 風險區塊：捲動區塊目前沒有加自訂捲軸樣式指示器（只有 `scrollbar-width:thin` 這個 Firefox 專屬的細捲軸提示，Chrome/Safari 沒有對應效果），如果使用者不知道可以左右滑動、畫面上又剛好每排只看得到 1-2 張縮圖被截斷，可能不容易注意到還有更多圖片——這次沒有額外加「還有更多→」的視覺提示，之後如果使用者反映找不到怎麼看更多圖，可以考慮加上漸層遮罩或箭頭提示。
- 已檢查／驗證方式：`index.html` 主要 `<script>` 區塊語法檢查通過。因為這次要驗證的是實際版面尺寸（橫向/縱向是否真的可以捲動、寬高有沒有被正確限制），主分頁的 `window.innerWidth/innerHeight` 在這個測試環境量到的是 0（跟過去幾次踩過的同樣限制），改用**在頁面內建立 1280×800 的 iframe 載入同一份 `index.html`、並用 `iframe.contentWindow.eval()`（不是 `iframe.contentWindow.xxx=`，因為後者只會在 window 物件上新增屬性、不會覆寫頁面內用 `let` 宣告的模組層級變數，這是先前 session 已經踩過並記錄下來的坑）注入假資料**：模擬 4 輪修改紀錄、共 39 張圖片（6/8/10/15 張分散在四輪），開啟案件詳情後量測：外層 `.case-detail-design-images-scroll` 的 `scrollHeight(390px) > clientHeight(220px)`，確認整塊在圖片輪次多的情況下真的會被限制在 220px 並可垂直捲動；四排 `.case-detail-design-images-row` 全部 `scrollWidth > clientWidth`（每排實際可視寬度 143px，內容寬度依張數從 414px 到 1044px 不等），確認橫向真的會捲動而不是把彈窗撐寬或整排換行；額外截圖確認彈窗版面沒有跑版、縮圖裁切整齊。`node --test backend/test/*.test.mjs` 25/25 全過。
- 部署狀態：純前端，git push 後自動生效。
- commit：（見下方 push 紀錄）

### 2026-08-13 Asia/Taipei（較早）— 修改紀錄多選刪除微調：勾選框移到左下角、選取工具列預設隱藏

- 修改目的：使用者對上一輪的多選刪除功能提出兩個體驗微調：①每張縮圖左上角的勾選框跟圖片內容重疊，希望移到左下角比較不擋畫面；②原本只要案件有 2 張以上圖片，選取工具列就會常駐顯示「勾選圖片可批次刪除」的提示，使用者覺得平常沒有要刪圖時這條列一直佔位置，希望改成預設隱藏，點選了圖片（開始勾選）才出現。
- 影響檔案：`index.html`。
- 影響功能：`.revision-image-select` 的定位從 `top:2px;left:2px` 改成 `bottom:2px;left:2px`（跟右上角既有的單張刪除「✕」按鈕不再同一個角落，兩個控制項視覺上分開）。`revisionSelectionToolbarHtml()` 產生的工具列固定加上 `id="revisionSelectionBar"`，並依目前選取數量決定要不要帶 `hidden` 屬性（`renderRevisionModal()` 每次重繪都會先清空選取狀態，所以工具列一開始一定是隱藏的）；`updateRevisionSelectionBar()`（原本只更新文字與刪除鈕的 disabled 狀態）新增同步切換 `bar.hidden`，選取數量從 0 變成 1 以上時工具列才會出現，取消到剩 0 張時自動再隱藏。**這次也補上 `.revision-modal-selection-bar[hidden]{display:none!important}`**——工具列的基礎樣式本來就有 `display:flex`，跟瀏覽器內建的 `[hidden]{display:none}` 規則同屬「作者一般樣式」層級時，沒有這條 `!important` 覆寫的話 `hidden` 屬性會被 `display:flex` 蓋掉、視覺上還是看得到（這是 [CLAUDE.md](CLAUDE.md) 之前處理「設計圖上傳中」右下角提示卡片時就踩過的同一類坑，這次先補上不讓它重演）。
- 風險區塊：無新增風險，純樣式與顯示時機調整，沒有動到刪除邏輯本身（`removeSelectedCaseDesignImages`／`toggleRevisionImageSelection`／`toggleAllRevisionImageSelection` 都沒有修改）。
- 已檢查／驗證方式：`index.html` 主要 `<script>` 區塊語法檢查通過；本機靜態伺服器＋ Browser pane 直接驗證：工具列一開始 `hidden=true`、`getComputedStyle` 確認 `display:none`；勾選第一張圖片後 `hidden` 變 `false`、`display` 變 `flex`；取消勾選回到 0 張後again 隱藏；勾選框的 `getComputedStyle` 確認 `bottom:2px`（不是 `top`），單張刪除鈕仍在 `top:2px;right:2px`，兩者互不重疊。`node --test backend/test/*.test.mjs` 25/25 全過。
- 部署狀態：純前端，git push 後自動生效。
- commit：（見下方 push 紀錄）

### 2026-08-13 Asia/Taipei（較早）— 案件詳情顯示設計圖縮圖、修改紀錄多選刪除、NAS 選擇器確認後立即收合背景執行

- 修改目的：使用者接續前一輪「選 NAS 資料夾即備份」的工作，一次提出三個體驗需求：①設計師陸續備份的設計圖，目前只有點開「修改紀錄」彈窗才看得到，希望案件資料彈窗（案件詳情）的「其他資訊」區塊下方也能直接看到；②「修改紀錄」彈窗要刪圖片目前只能一張一張點，案件圖片一多很花時間，希望能多選批次刪除；③NAS 資料夾選擇器點下「選擇這個資料夾並備份」後，畫面會停在「正在備份中，請稍候」擋著使用者，希望改成點下去就立刻收合成一個小的等待畫面、備份在背景進行，只有真的發生問題時才跳出明顯的提示視窗。
- 影響檔案：`index.html`、`scripts/nas_folder_picker_server.mjs`。
- 影響功能：
  1. **案件詳情彈窗新增「設計圖記錄」**：新增 `caseDetailDesignImagesHtml(row)`，彙整 `modificationRecordsFor(row.id)` 裡每一輪（不分來源——NAS 背景監控程式、選擇器立即備份、手動上傳，只要是寫進同一個「修改統計表」圖片欄位的都算）有圖片的紀錄，依輪次新到舊排序、各自標好「初稿設計圖（N 張）」「一修設計圖（N 張）」等標籤，縮圖沿用既有的 `.revision-modal-images`／`.revision-image-item` 樣式（點縮圖開新分頁看原圖）。`caseDetailRows(row)` 只在有圖片時才把這個項目加進陣列（沒有圖片時完全不出現這一列，不會留空白列），`openCaseDetail()` 的「其他資訊」區塊 `pick()` 清單加上 `'設計圖記錄'`。這個項目是**唯讀預覽**，沒有新增/刪除按鈕——編輯還是要到「修改紀錄」彈窗做，避免案件詳情彈窗塞入太多操作入口；既有的 `refreshOpenCaseDetail()`（上傳、刪除圖片後都會呼叫）本來就會整個重新呼叫 `openCaseDetail()`，所以這個新區塊不用額外處理刷新，圖片異動後會自動反映。新增了一條 CSS 規則讓這個欄位在「其他資訊」的兩欄版面裡強制跨滿整列（`grid-column:1/-1`，因為這個區塊本身的版面設計本來就會把 `wide:true` 覆寫成 `auto`，只有這個新欄位需要真正跨欄）。
  2. **「修改紀錄」彈窗新增多選刪除**：每張縮圖左上角新增勾選框（`.revision-image-select`，只在有 `media.manage` 權限時顯示，跟原本右上角的單張刪除「✕」按鈕並存，兩種刪法都可以用）；彈窗清單最上方，只要**整個案件的圖片總數超過 1 張**才會出現一條選取工具列（少於 2 張沒有批次刪除的意義，不顯示，畫面更乾淔）：「全選」勾選框＋「已選取 N 張」文字＋「刪除已選取」按鈕（沒有勾選任何圖片時停用）。勾選狀態存在模組層級的 `revisionImageSelection`（`Set`，用 `${輪次}::${圖片網址}` 當 key，因為同一個案件不同輪次理論上可能有重複網址，用輪次＋網址組合才能唯一識別），`renderRevisionModal()` 每次重繪都會清空這個集合（避免殘留對應到已經不存在的圖片的勾選狀態）。點「刪除已選取」會先跳一次 `confirm()`（顯示這次要刪幾張，不是每張各跳一次），確認後**依序**（不是同時平行）呼叫既有的 Worker `removeCaseDesignImage` action——選擇依序執行而不是 `Promise.all` 平行送出，是因為這是同一個案件的同一份 JSON 陣列在陣列裡挪動元素，依序執行邏輯上更好推理、也不用擔心平行請求之間互相蓋過彼此的中間讀取結果；全部處理完之後才**一次**呼叫 `fetchModificationCounts()`／`render()`／`refreshOpenRevisionModal()`／`refreshOpenCaseDetail()` 刷新畫面（不是每刪一張就刷新一次），過程中 `setSync()` 會即時顯示「刪除圖片中...N/M」的進度；如果其中幾張刪除失敗，其餘的仍會繼續處理，最後用一則訊息彙總「已刪除 X 張，Y 張失敗」。**沒有新增或修改任何 Worker/後端程式碼**——多選刪除完全是前端把同一個既有的單張刪除 action 依序呼叫多次，`worker/src/database-coordinator.ts` 的 `removeCaseDesignImage` action（含 `media.manage` 權限檢查）完全沒有改動。
  3. **NAS 選擇器「選擇這個資料夾並備份」改成立即收合＋背景執行**：`nas_folder_picker_server.mjs` 的 `PICKER_PAGE` 前端腳本，原本點下確認按鈕後會停在同一個畫面、把按鈕停用、下方顯示一行「正在備份中，請稍候...」紅字區塊，使用者要一直等到 `fetch('/api/confirm')` 整個結束（包含真正的掃描、壓縮、上傳）才會看到結果。這次改成點下按鈕的**當下**（在等待任何網路回應之前）就用 `showCollapsed()` 把整個 `document.body` 換成一個小巧的置中畫面（旋轉圈圈＋一行文字「正在背景備份『資料夾路徑』...」），`/api/confirm` 這個 fetch 請求本身完全沒有改動時機或邏輯，只是使用者不用再盯著大大的資料夾瀏覽畫面等待；成功後（不論備份本身有沒有問題，只要 HTTP 請求本身成功，跟先前的「備份失敗不擋路徑登記」設計一致）一樣呼叫 `postMessage` 登記路徑，把收合畫面換成簡短的結果摘要再自動關閉分頁。**新增 `showErrorPrompt(message)`**：只有在 `/api/confirm` 這個請求本身失敗時（token 不對、案件編號沒帶、選定的資料夾已經不存在——這幾種情況伺服器端才會回傳 `success:false`；其餘像是「案件查不到」「Apps Script 上傳失敗」這些狀況伺服器端仍然回傳 `success:true`＋`backup.message`，不會觸發這個提示框，行為跟上一輪的「立即備份失敗不擋路徑登記」設計完全一致，這次沒有改變）才會顯示一個帶警示圖示、紅字標題「備份時發生問題」的明顯提示框，附三個操作：「重試」（重新呼叫一次 `doConfirm()`）、「仍然登記路徑」（略過這次備份結果，直接 `postMessage` 登記路徑並關閉，等於退回成「先前登記路徑、之後靠背景監控程式接手」的行為）、「取消」（單純關閉分頁，不登記路徑，維持選擇器伺服器端「沒選好就不寫入」的既有保證）。原本用來擋重複點擊的 `confirming` 旗標與 `setBusy()` 函式一併移除——因為點擊當下畫面就整個被換掉（原本的按鈕、狀態文字都不在 DOM 裡了），沒有殘留可以再被點兩次的按鈕，不需要額外的忙碌狀態旗標。
- 風險區塊：
  - **多選刪除完全依賴既有的單張刪除 action，沒有新增批次專用的 Worker action**——這代表刪除 10 張圖片會依序發出 10 次獨立的 HTTP 請求（不是一次批次請求），在圖片數量非常多（例如一次要刪 30-40 張）時會比理想中的單一批次 API 慢一些；這次沒有為了效能新增批次刪除的 Worker action，是因為現有的單張刪除邏輯已經有完整的權限檢查與測試覆蓋，重用它風險最低，而目前一輪修改的圖片數量通常是個位數到十幾張，序列請求的延遲差異在可接受範圍，如果之後圖片量變得非常大，可以評估要不要另外做一個真正的批次 Worker action。
  - **案件詳情彈窗新增的「設計圖記錄」目前沒有權限檢查**——只要案件本身看得到（案件詳情彈窗打得開），這個區塊就會顯示設計圖縮圖，不像「修改紀錄」彈窗裡的新增/刪除按鈕會另外檢查 `media.manage`。這是刻意的設計：這些圖片本來就屬於這個案件，案件詳情彈窗看得到的人本來就看得到這個案件的其他所有欄位（客戶別、專案名稱等），沒有理由單獨把設計圖擋起來；如果之後有更細緻的圖片可見性需求（例如某些角色可以看案件基本資料但不該看到設計圖），需要另外討論加一道獨立的權限判斷。
  - **NAS 選擇器的「重試」按鈕沒有次數限制**——使用者可以無限次點「重試」，每次都會重新打一次 `/api/confirm`（重新掃描、重新嘗試上傳）；如果背景的 Apps Script 或案件資料庫持續無法連線，使用者可能會重試好幾次都失敗。這不是新引入的風險（本來整個流程失敗了本來就只能整頁重新整理或關閉重來），只是這次讓「重試」變得更順手、更容易被連續按——如果之後想避免使用者不斷重試造成不必要的伺服器負擔，可以考慮加上重試次數上限或退避時間，這次沒有做這層保護。
  - **「仍然登記路徑」這個新按鈕，讓使用者可以在備份請求真的失敗（例如 token 錯誤、資料夾在瀏覽期間被刪除）的情況下，還是把路徑寫回案件資料庫**——如果請求失敗的原因是「資料夾其實已經不存在」，使用者還是可以選擇登記這個（目前已經不存在的）路徑，之後背景監控程式掃描時會遇到同一個「找不到資料夾」的錯誤而持續失敗，不會自動修復。這是刻意的取捨（給使用者一個「我知道路徑是對的，先不管這次備份失不失敗」的退路，跟這個案件最一開始「純登記路徑，不做立即備份」的舊行為一致），但如果使用者誤判、在資料夾真的消失的情況下按了這個按鈕，錯誤會延後到下一次背景掃描才會再次出現（掃描端的錯誤訊息已經很清楚寫「找不到資料夾，請確認 NAS 是否已掛載、路徑是否正確」，不會是無聲失敗）。
- 已檢查／驗證方式：
  - `index.html` 主要 `<script>` 區塊（現在約 352KB）用 `new Function()` 語法檢查通過。
  - **案件詳情設計圖縮圖**：本機靜態伺服器＋ Browser pane，stub `accessAllowed`／`rows`／`modificationRecords` 等全域狀態，直接呼叫 `caseDetailDesignImagesHtml()`／`caseDetailRows()` 驗證：兩輪各有圖片的假資料，正確產生兩個分組、標籤與張數正確（「初稿設計圖（2 張）」「一修設計圖（1 張）」）；`caseDetailRows()` 在圖片清單為空時，回傳的陣列裡確實**沒有**「設計圖記錄」這個項目（不會顯示空白列）。
  - **修改紀錄多選刪除**：同一個瀏覽器環境，stub `sheetApi`／`fetchModificationCounts`／`render`／`refreshOpenRevisionModal`／`refreshOpenCaseDetail`／`window.confirm`，用真實頁面的 `renderRevisionModal()` 產生的 DOM 逐一驗證：兩輪共 3 張圖片時工具列正確出現、只剩 1 張圖片時工具列正確消失；勾選單張／全選／取消全選，已選取張數文字與刪除按鈕的 enable/disable 狀態都正確即時更新（不用整個重繪彈窗）；點「刪除已選取」勾 2 張，確認呼叫了 2 次 `removeCaseDesignImage` action、參數（輪次、網址）正確、選取狀態清空、`refreshOpenRevisionModal`／`refreshOpenCaseDetail` 都有帶正確案件編號被呼叫、成功訊息文字正確；點確認對話框「取消」時完全不會呼叫任何刪除 API、選取狀態原封不動保留（讓使用者可以修改勾選後再試一次）；模擬其中一張刪除失敗，正確變成「已刪除 1 張，1 張失敗，請重新整理後再試一次」的錯誤提示（`isErr:true`），另一張仍正確刪除成功、不會因為一張失敗就整批中斷。
  - **NAS 選擇器立即收合＋背景執行**：這次沒有再用假指令模擬一個虛擬環境，而是**真的啟動** `nas_folder_picker_server.mjs`（沿用先前那輪測試建立的假 `mountRoot`／假 `dbJsonUrl`／假 Apps Script 上傳端點），用 Browser pane 載入真實的選擇器頁面，逐一驗證：①點下「選擇這個資料夾並備份」的**同一個事件循環內**（在 `await fetch` 真正送出網路請求、拿到回應之前）畫面就已經換成收合視圖（用同步檢查 `document.body.innerHTML` 確認，不是等非同步結果才檢查），證明「立即收合」不是等備份完成才收合；②備份成功（含真的上傳 1 張新圖）時，收合畫面正確顯示「已立即備份 N 張圖片」摘要並在 1.4 秒後呼叫 `window.close()`；③案件在系統裡查不到、Apps Script 回應上傳失敗這類「不算請求失敗」的情況，正確顯示「資料夾已登記，...失敗原因...」摘要並照樣關閉，**沒有**跳出錯誤提示框（跟先前「備份失敗不擋路徑登記」的設計一致，這次刻意驗證兩種情況不會混淆）；④選定的資料夾在瀏覽之後、確認之前被刪除（模擬競態情境）時，正確跳出帶警示圖示的錯誤提示框、**不會**呼叫 `postMessage`、**不會**呼叫 `window.close()`；⑤提示框的「仍然登記路徑」按鈕正確補呼叫 `postMessage`（帶正確路徑）並關閉；⑥用暫時攔截 `window.fetch`（讓第一次 `/api/confirm` 失敗、之後恢復正常）驗證「重試」按鈕正確重新呼叫整個確認流程並在第二次成功；⑦提示框的「取消」按鈕正確只關閉分頁、完全不呼叫 `postMessage`。
  - `node --test backend/test/*.test.mjs` 25/25 全過（這次改動沒有動到後端程式碼，純粹確認沒有意外牽動到共用的 schema 或測試字串）。
  - **未做的驗證**：真實瀏覽器（非自動化）點擊的實際視覺效果與收合動畫是否流暢；真的連上你的 NAS 與正式的 Apps Script 端點跑一次端對端流程；案件詳情彈窗在真實視窗尺寸/多語系內容下，縮圖區塊跨欄後的實際排版是否跟其他欄位協調（這次只用程式化的 `getComputedStyle`／DOM 結構檢查，沒有實機截圖比對）。
- 部署狀態：`index.html`、`CLAUDE.md` 純前端／文件，git push 後自動生效；`scripts/nas_folder_picker_server.mjs` 是純本機工具，不需要 git push，但跟先前每次修改一樣，**需要你重新啟動這支程式**（或用 `launchd`／`cron` 排程重啟）才會套用新版本的確認流程。
- commit：（見下方 push 紀錄）

### 2026-08-13 Asia/Taipei（更早）— 「選擇 NAS 資料夾」合併成「點選即備份＋登記」，並依客戶別自動猜起始資料夾

- 修改目的：使用者指出案件設計圖目前有兩種記錄方式——「選擇 NAS 資料夾」
  （只登記路徑，交給背景監控程式 `nas_design_image_watcher.mjs` 之後定時
  輪詢追蹤）跟「選擇電腦檔案上傳」（立即上傳，但完全不會記錄 NAS 路徑，
  之後這個案件就無法被背景程式接手追蹤）——兩者互不相通，用「電腦檔案上
  傳」開頭的案件之後永遠得手動補圖。討論後決定的方向不是幫「電腦檔案上
  傳」額外補一個選填的路徑欄位，而是把兩件事合併進「選擇 NAS 資料夾」這
  條路徑本身：選定資料夾當下，`nas_folder_picker_server.mjs`（資料夾選擇
  器伺服器，跟背景監控程式一樣跑在同一台連得到 NAS 的 Mac 上）立即用跟背
  景監控程式共用的同一套邏輯掃描並上傳一次資料夾裡目前已有的圖片/影片，
  再登記路徑——「電腦檔案上傳」維持不變，純粹作為選擇器伺服器沒開機/沒
  設定時的備援選項。使用者接著追加一個體驗要求：目前 NAS 路徑幾乎都是
  「/設計部/專案企劃部/執行中/<客戶別>」這個固定前綴，希望選擇器能依案件
  的「客戶別」自動猜、直接打開到那一層，不用每次都從根目錄逐層點過去，
  同時要保留麵包屑可以點回上層資料夾。
- 影響檔案：新增 `scripts/nas_design_image_lib.mjs`；改寫
  `scripts/nas_design_image_watcher.mjs`（改成 import 共用模組，行為不
  變）、`scripts/nas_folder_picker_server.mjs`（新增立即備份與預設路徑猜
  測）；`scripts/nas_design_image_watcher.config.json` 新增
  `defaultBrowseRoot` 欄位；`scripts/nas_design_image_watcher.README.md`
  補上新流程說明、設定欄位、已測試/未測試段落；`index.html` 只改了「選擇
  NAS 資料夾」選項的說明文字。
- 影響功能：
  1. **共用核心邏輯抽成 `nas_design_image_lib.mjs`**：把原本寫在
     `nas_design_image_watcher.mjs` 裡的 `scanProject`／影片截圖／圖片壓
     縮／`computeRound`／`computeTargetImages`／`uploadRound` 等函式整批
     搬過去，新增 `findCaseMeta(dbData,caseId)`（不篩狀態／不篩是否已填
     路徑，單純依案件編號查設計師/客戶別/開始日期，給資料夾選擇器在使用
     者選好資料夾、`designImageFolderUrl` 都還沒寫回資料庫的那個當下就能
     用）與 `uploadPendingRound(...)`（把「算輪次→套用待修改圖片清單過
     濾→上傳→標記 assignedRound」包成一個函式，`nas_design_image_watcher.mjs`
     的批次迴圈與資料夾選擇器的「立即備份」現在呼叫的是同一份程式碼）。
     這樣做的原因：兩支程式都會讀寫同一份 `sync-state.json`，「這個檔案
     算不算處理過」的判斷邏輯只要有一絲不一致，就可能造成同一批圖片被上
     傳兩次或漏傳，寫成同一份程式碼比各自維護一份、之後改一邊忘記改另一
     邊安全得多。`nas_design_image_watcher.mjs` 本身的執行邏輯與輸出格式
     沒有改變，只是內部函式來源換成 import。
  2. **`nas_folder_picker_server.mjs` 新增 `/api/confirm`（立即備份）**：
     使用者在資料夾選擇器頁面按「選擇這個資料夾並備份」（原本按鈕文字是
     「選擇目前這個資料夾」，這次改名反映新行為）時，前端先 `POST` 這個
     端點並顯示「正在備份...」，伺服器端驗證路徑合法後，呼叫
     `lib.scanProject`＋`lib.uploadPendingRound`（跟 `findCaseMeta` 查到的
     設計師/客戶別/開始日期）立即掃描並上傳這個資料夾目前的內容，回傳結
     果後前端才真正 `postMessage` 把路徑丟回原本分頁（沿用既有機制寫入
     `designImageFolderUrl`）並關閉分頁。刻意的設計：**立即備份失敗不會
     擋住路徑登記**——案件編號在資料庫查不到、Apps Script 上傳失敗、掃描
     過程出錯，這幾種情況 `/api/confirm` 都還是回傳 `success:true`（只要
     路徑本身合法存在），只是 `backup` 欄位帶著失敗原因，前端顯示「資料
     夾已登記，但備份失敗：...」而不是整個操作失敗——因為路徑登記本身跟
     這次備份成不成功是兩件事，登記成功之後背景監控程式下一輪還會再試。
     只有「路徑本身不存在」或「token 不對」這種請求層級的錯誤才會讓整個
     `/api/confirm` 回傳失敗，不讓前端誤登記一個查無此路徑的資料夾。
  3. **`nas_folder_picker_server.mjs` 新增 `/api/default-path`（依客戶別
     猜起始資料夾）**：選擇器頁面載入時先打這支端點，帶案件編號查資料
     庫，依新增的設定欄位 `defaultBrowseRoot`（相對於 `mountRoot`，例如
     `專案企劃部/執行中`）在那一層底下找跟案件「客戶別」同名的子資料夾
     （先精確比對，再嘗試去頭尾空白＋忽略英文大小寫比對一次），找到就直
     接把選擇器開到那一層並在畫面上方顯示綠色提示「已自動開啟到『Epson』
     資料夾」；沒對到（客戶別沒填、資料夾裡沒有對應名稱、案件編號查不
     到、`defaultBrowseRoot` 沒設定或路徑不存在）就 fallback 到
     `defaultBrowseRoot` 這一層或根目錄，並顯示相應的提示文字說明為什麼
     沒有自動跳更深。**不管猜對還是猜錯，麵包屑永遠顯示完整路徑，使用者
     隨時可以點回任何上層資料夾**——這是刻意的設計，避免自動跳轉變成使
     用者找不到其他資料夾的陷阱，符合使用者「保留前面資料夾位置路徑方便
     回頭查找」的要求。
  4. **`index.html`**：只改了 `openCaseDesignImageSourceChooser()` 裡兩個
     選項的說明文字，反映「選 NAS 資料夾＝立即備份＋之後自動追蹤」「選電
     腦檔案＝備援選項」的新分工；沒有改動任何 JS 邏輯（`openNasFolderPicker`
     的呼叫方式、`machi-nas-folder-selected` 訊息處理都不用改，因為「立即
     備份」完全發生在資料夾選擇器伺服器端，前台這邊收到的還是同一種
     `postMessage`）。
- 風險區塊：
  - **`/api/confirm` 跟背景監控程式的排程執行是兩支獨立行程，共用同一份
    `sync-state.json`，理論上存在極小的競態窗口**：如果使用者按「選擇這
    個資料夾並備份」的當下，背景監控程式剛好也在跑同一個案件的那一輪掃
    描，兩邊各自讀狀態、各自寫回，最壞結果是同一批圖片被上傳兩次（Drive
    多一份重複檔案，不會遺失資料或寫壞狀態檔）。目前沒有加檔案鎖處理——
    背景排程通常 5-10 分鐘一次，跟使用者手動點選重疊的機率很低，這次選
    擇先接受這個已知風險並記錄下來，而不是為了低機率情境增加檔案鎖的複
    雜度；已經在 README 新增「已知但刻意接受的風險」段落說明。
  - **「依客戶別猜起始資料夾」用的是完整字串相等比對（含一次去頭尾空白
    ＋忽略大小寫的寬鬆比對），不是模糊比對**：如果 NAS 資料夾名稱跟資料
    庫「客戶別」欄位有更複雜的落差（例如資料夾多了年份後綴、客戶別欄位
    用了不同的全形/半形符號），會判斷成「找不到對應資料夾」而 fallback
    到上一層——這是刻意保守的行為（寧可猜不到、退回讓使用者手動點選，也
    不要猜錯跳進不相干客戶的資料夾），只是沒有像「立即備份失敗」那樣做
    更寬鬆的模糊比對。沙箱測試只驗證過 ASCII 客戶名稱（如 `Epson`／
    `epson`）的精確與大小寫寬鬆比對，真實客戶別大多是中文，中文字串比對
    理論上不受大小寫轉換影響（用的是完整字串相等，不是英文專屬邏輯），
    但沒有用真實中文客戶別＋真實 NAS 資料夾名稱實測過。
  - `nas_folder_picker_server.mjs` 現在除了「列資料夾清單」，也會實際觸
    發 Apps Script 上傳（跟背景監控程式呼叫的是同一個 `appsScriptUploadUrl`
    端點）——代表這支伺服器現在的職責範圍比原本單純的「選資料夾」大了一
    圈，如果之後要稽核「誰有能力觸發圖片上傳到 Drive」，需要把這支伺服
    器也算進去，不能只看 Worker／Apps Script 兩端。
- 已檢查／驗證方式：
  - `node --check` 對 `nas_design_image_lib.mjs`／`nas_design_image_watcher.mjs`／
    `nas_folder_picker_server.mjs` 三個檔案，以及從 `PICKER_PAGE` 樣板字
    串抽出的內嵌 `<script>` 內容，語法檢查全數通過；`index.html` 抽出的
    主要 `<script>` 區塊（348KB 那一段）用 `new Function()` 語法檢查通
    過。
  - 用假的 `sips`／`qlmanage`（模擬執行成功，只做複製檔案）＋假掛載目錄
    （含中文資料夾層層巢狀結構，模擬 `專案企劃部/執行中/Epson/...`）＋假
    HTTP 伺服器同時模擬 `dbJsonUrl` 與 Apps Script 上傳端點，**真的啟動
    `nas_folder_picker_server.mjs`** 用 `curl` 逐一驗證：`/api/list` 的
    token 驗證（沒帶/帶錯回 401）與路徑穿越保護（`../../../etc` 正確被
    過濾、不會跳出假掛載範圍）；`/api/default-path` 四種情境全部正確
    ——客戶別對到資料夾（`matched:true`，回傳深層路徑）、客戶別存在但資
    料夾裡沒有對應名稱（fallback 到上一層＋提示文字）、案件沒填客戶別
    （fallback＋對應提示）、案件編號查不到（同樣安全 fallback，不會讓選
    擇器打不開），以及客戶別大小寫不同（`epson` 對 `Epson` 資料夾）也正
    確配對成功；`/api/confirm` 完整驗證：選定含 1 張圖片的資料夾，正確
    立即上傳並回傳 `backup.uploadedCount:1`；**對同一個案件/資料夾重複呼
    叫第二次，正確判斷「沒有新檔案可上傳」（`uploadedCount:0`），Apps
    Script 上傳端點的呼叫次數沒有增加**，證明沒有重複上傳；模擬 Apps
    Script 回傳上傳失敗時，`/api/confirm` 仍正確回應 `success:true`（路徑
    正常登記）且 `backup.message` 帶著失敗原因；案件編號在資料庫查不到
    時同樣正確回應 `success:true`、`backup.attempted:false`；選了一個不
    存在的資料夾路徑時正確回應 `success:false`（這種情況前端不會登記路
    徑）；token 錯誤時正確回應 401 等級的拒絕。
  - **兩支程式共用狀態檔的一致性有實測，不是只靠邏輯推導**：先用資料夾
    選擇器的 `/api/confirm` 對某案件的資料夾（含 1 張圖）立即備份一次，
    再模擬前台把 `designImageFolderUrl` 寫回資料庫（更新假 `dbJsonUrl`
    回應）、實際執行一次 `nas_design_image_watcher.mjs` 的批次流程，確認
    正確判斷「沒有偵測到可上傳的圖片」（不會把選擇器已經上傳過的那張圖
    再傳一次，Apps Script 呼叫次數維持 0）；接著在同一個資料夾放一張新
    圖，再跑一次批次流程，正確只上傳新增的那 1 張（`fileNames` 只有新檔
    名，不含第一次選擇器上傳過的檔案），證明兩支程式對「這個檔案處理過
    了沒」的判斷完全一致。
  - `node --test backend/test/*.test.mjs` 25/25 全過（沒有任何測試鎖住這
    次改動的字串或行為）。
  - **未做的驗證**：真正的 `qlmanage`／`sips` 執行效果（沙箱沒有
    macOS）；真實中文客戶別＋真實 NAS 資料夾名稱的比對結果；瀏覽器實機
    載入資料夾選擇器頁面、看到綠色提示文字、點「選擇這個資料夾並備份」
    等待期間畫面呈現是否符合預期（沙箱只用 `curl` 測 API，沒有用真實瀏
    覽器操作過新版頁面，前一版頁面的瀏覽器互動雖然之前測過，但這次改了
    確認按鈕的文字與流程，等待中禁用按鈕、成功/失敗訊息文字這幾塊都沒有
    用真實瀏覽器點過）；「立即備份」跟背景排程真的同時執行的競態情況
    （只能理論推導，沙箱沒辦法真的讓兩支程式搶同一份狀態檔驗證實際後
    果）；真的連上你的 NAS、真的把圖傳進 Google Drive 端對端測試。
- 部署狀態：`index.html`、`CLAUDE.md` 純前端／文件，git push 後自動生
  效；`scripts/nas_design_image_lib.mjs`／`nas_design_image_watcher.mjs`／
  `nas_folder_picker_server.mjs`／`nas_design_image_watcher.config.json`／
  `nas_design_image_watcher.README.md` 都是純本機工具，不需要 git push、
  不需要部署 Worker 或 Apps Script——但**這是本機檔案異動，你需要重新啟
  動（或用 `launchd`／`cron` 排程重啟）`nas_folder_picker_server.mjs` 才
  會套用新版本**（`/api/confirm`／`/api/default-path` 這兩個新端點在舊版
  程式裡不存在），`nas_design_image_watcher.mjs` 同理，下次排程觸發時會
  自動用到新版程式碼，不用手動介入；如果想讓「依客戶別自動開啟」這個功
  能生效，需要確認 `nas_design_image_watcher.config.json` 的
  `defaultBrowseRoot` 欄位符合你實際的 NAS 資料夾結構（目前預設填的是
  `專案企劃部/執行中`，如果實際結構不同要手動改）。

### 2026-08-13 Asia/Taipei（最新）— 右下角上傳進度提示平常完全隱藏

- 修改目的：使用者回報「設計圖上傳中」進度提示在沒有上傳時仍顯示於右下角；期望只在實際上傳進行中顯示。
- 影響檔案：`index.html`。
- 影響功能：新增 `.case-design-upload-badge[hidden]{display:none!important}`，確保元件的 `hidden` 屬性不會被基礎 `.case-design-upload-badge{display:flex}` 規則覆蓋。進度訊息開始時仍會由 `showCaseDesignUploadBadge()` 移除隱藏，完成時由 `closeUploadModal()` 呼叫 `hideCaseDesignUploadBadge()` 恢復隱藏。
- 風險區塊：只調整提示元件的隱藏顯示優先順序，不改動上傳、取消或進度訊息邏輯。
- 已檢查／驗證方式：`index.html` 內嵌 JavaScript 語法檢查；`node --test backend/test/*.test.mjs` 回歸測試；確認初始 HTML 保留 `hidden` 屬性且 CSS 具有專用的 `display:none!important` 規則。
- 部署狀態：純前端，git push 後自動生效。
- commit：（見本次 push 紀錄）

### 2026-08-13 Asia/Taipei（更晚）— 設計圖上傳按下「上傳全部」自動收合成右下角進度提示

- 修改目的：使用者回報案件設計圖上傳彈窗（`upload/upload.html?mode=case-design`）目前的行為是：按下 iframe 裡的「上傳全部」後，外層大彈窗仍然停留在前景，要使用者自己手動點 X／背景遮罩／Escape 才會收合成右下角的「設計圖上傳中」小卡片。使用者希望改成按下上傳按鈕當下就自動收合，只留右下角進度提示；上傳全部結束後這個提示也要跟著收合——後者其實既有程式碼已經做到（`closeUploadModal()` 本來就會呼叫 `hideCaseDesignUploadBadge()`），這次真正要修的只有「按下上傳按鈕當下要自動收合」這一段。
- 影響檔案：`index.html`。
- 影響功能：`handleUploadFrameMessage()` 處理 `machi-case-design-upload-progress` 訊息的分支（`upload/upload.html` 在 `uploadCaseDesignImagesFlow()` 一開始，也就是使用者按下「上傳全部」的當下，就會送出第一則 `{done:0,total:N}` 的進度訊息，這是既有機制，這次沒有動 `upload/upload.html`）——新增判斷「這是不是這次上傳第一次收到進度訊息（`wasInFlight` 從 false 變 true 的那一刻）」，是的話立刻呼叫既有的 `backgroundizeCaseDesignUpload()`（隱藏大彈窗、顯示右下角小卡片），不用再等使用者手動關閉。**刻意只在「第一次」觸發**，不是每一則進度訊息都觸發：如果使用者事後點小卡片重新展開大彈窗查看進度（既有的 `restoreCaseDesignUploadModal()` 功能，這次沒有改動），之後陸續傳來的進度訊息不會把畫面硬拉回收合狀態、打斷使用者正在看的畫面。
- 風險區塊：無新增風險——`backgroundizeCaseDesignUpload()`／`closeUploadModal()`／`restoreCaseDesignUploadModal()` 三個函式本身完全沒有修改，這次只是多了一個「符合條件時自動呼叫既有函式」的觸發點，沒有新增狀態或改變既有函式的行為。
- 已檢查／驗證方式：`index.html` 兩段 `<script>` 語法檢查通過；`node --test backend/test/*.test.mjs` 22/22 全過。用真實頁面＋console 直接呼叫 `handleUploadFrameMessage()` 模擬完整情境並逐一驗證：①大彈窗前景開著時收到第一則進度訊息（`done:0`）→ 彈窗立刻收合、右下角提示卡片立刻出現、文字正確顯示「設計圖上傳中 0/3」；②使用者手動點小卡片重新展開大彈窗後，再收到下一則進度訊息（`done:1`）→ 彈窗維持展開、不會被強制收合，只有文字更新（「設計圖上傳中 1/3：a.jpg」），不打斷使用者正在查看的畫面；③收到全部完成的訊息（`machi-case-design-images-updated`）→ 大彈窗與右下角提示卡片都正確收合／隱藏，`uploadModalActive`／`caseDesignUploadInFlight` 都正確重設。
- 部署狀態：純前端，git push 後自動生效。
- commit：（見下方 push 紀錄）

### 2026-08-13 Asia/Taipei（最新之後再更晚）— 填入真實 pickerToken／區網位址，並意外發現這次工作環境連得到使用者辦公室內網，完成真實 NAS 端對端驗證

- 修改目的：接續前兩則「NAS 資料夾選擇器」的工作，使用者依 README 指示在自己的 Mac 上執行 `node scripts/nas_folder_picker_server.mjs`，貼回實際印出的 `pickerToken` 與這台機器的區網 IP（`192.168.1.64`）。
- 影響檔案：`index.html`。
- 影響功能：`nasFolderPickerBaseUrl`／`nasFolderPickerToken`（[index.html:9450-9451](index.html:9450)）從空字串改填使用者提供的實際值（`http://192.168.1.64:8877/picker`＋對應 token），「選擇 NAS 資料夾」這個選項從此正式可用，不再顯示「尚未設定」的提示。
- **意外發現，值得記錄**：填完值之後例行用 `curl` 驗證網址格式是否正確時，發現這個工作環境的 Bash 工具其實**連得到 `192.168.1.64`**——也就是說跟前幾則修改紀錄裡假設的「這個對話環境是跟公司內網完全隔離的雲端沙箱」不同，這次的執行環境對使用者的辦公室內網有實際連線能力。因此这次難得地能對著**真實的 NAS 資料**做端對端驗證，而不是像過去每一次 NAS 相關修改一樣只能用假掛載目錄／假指令模擬：
  - `curl` 直接打真實伺服器的 `/api/list`，確認回傳的是真實的 NAS 資料夾結構（根目錄下的「公司計畫」「企業識別」「專案企劃部」等真實分類、`專案企劃部/執行中` 底下真實的近 70 個客戶資料夾如 Epson／ANKER／DJI／Soundcore 等），中文資料夾名稱的 URL 編碼／路徑解析完全正確。
  - 用錯誤 token 打 API 正確回 401，確認 token 驗證在真實部署上也有效（不是只在假資料測試環境裡有效）。
  - 用 Browser pane 直接開啟 `http://192.168.1.64:8877/picker?...`，確認頁面在真實網路環境下正確載入、正確顯示真實資料夾清單。
  - 這代表前一則「新增 NAS 資料夾選擇器」changelog 裡列的「未做的驗證」中，「真的連上你的 NAS」「真的在辦公室內網另一台機器用區網 IP 連到這支選擇器伺服器」這兩項現在已經被驗證過，可以從那份清單移除；但同一則列的其餘項目（`launchd` 常駐設定重開機穩定性、`sips` 對 WebP 的支援度、Safari 對「HTTPS 頁面開 HTTP 新分頁」的實際提示、真的從前台點擊「選擇 NAS 資料夾」走完整條使用者操作路徑）**仍然沒有驗證過**，這次只驗證了「選擇器伺服器本身在真實 NAS 上運作正常」，還沒有驗證「設計師從 `emctaipeiart.github.io` 正式站點擊按鈕之後，整條路徑（含 Mixed Content 導覽、`postMessage` 跨視窗通訊）在真實瀏覽器上是否順暢」。
- 風險區塊：`index.html` 現在的原始碼裡會出現真實的內網 IP（`192.168.1.64`）與 `pickerToken`——這兩者都會隨這次修改一起 push 到公開的 GitHub repo，屬於前一則已經說明過、可接受的設計取捨（`192.168.1.64` 是 RFC1918 私有位址，外部網際網路連不到；`pickerToken` 本來就不是設計成機密，見前則風險區塊說明）。**如果這台 Mac 之後改用 DHCP 動態配發的 IP 且該 IP 之後被路由器重新配給別的裝置，這個網址會失效**，需要重新取得新 IP 後回來更新這兩個常數——比較穩定的作法是在路由器上幫這台機器的 MAC 位址設定固定 IP（DHCP reservation），或改用 `<這台機器的電腦名稱>.local` 這種 Bonjour 主機名稱（比 IP 穩定，但依賴辦公室網路是否支援 mDNS），這點還沒有跟使用者確認要用哪一種，先用使用者提供的 IP 位址頂著。
- 已檢查／驗證方式：見上方「意外發現」段落；另外照慣例跑過 `index.html` 兩段 `<script>` 語法檢查與 `node --test backend/test/*.test.mjs`，22/22 全過。
- 部署狀態：純前端，git push 後自動生效。
- commit：`63ba379`

### 2026-08-13 Asia/Taipei（最新之後）— NAS 資料夾選擇器補上連線逾時／視窗關閉偵測

- 修改目的：使用者詢問「如果我的電腦沒有開機或是沒連上 NAS，會出現什麼狀況」，追查後發現緊接著上一則做的 `openNasFolderPicker()` 沒有任何逾時或失敗偵測——`window.open()` 只要沒被瀏覽器攔截就視為「成功」，之後完全不管新分頁到底連不連得上；如果選擇器伺服器所在的機器沒開機或沒啟動，新分頁會顯示瀏覽器原生的「無法連上這個網站」錯誤頁，但原本那個分頁只會顯示「請在新分頁選擇 NAS 資料夾...」這行字，**5 秒後自動消失、不會有任何錯誤提示**，使用者只能自己發現不對勁。已跟使用者說明這是「全公司共用單點故障」（這支選擇器綁在單一台機器上，那台機器離線會讓所有設計師都選不了 NAS 資料夾，但完全不影響「選擇電腦檔案上傳」這個備援選項），使用者確認要先補上這個缺口。
- 影響檔案：`index.html`。
- 影響功能：新增 `watchNasFolderPickerWindow(win,nonce)`，`openNasFolderPicker()` 成功呼叫 `window.open()` 後啟動這支每秒檢查一次的監看：①偵測到 `win.closed`（使用者自己關掉了新分頁，不管是因為連線失敗看到錯誤頁而關掉、還是選完但沒送出）就清空 `activeNasFolderPickerNonce`、顯示「NAS 資料夾選擇視窗已關閉，尚未選擇資料夾（如果剛剛那個分頁顯示連不上網站，可改用「選擇電腦檔案上傳」）」；②等滿 20 秒還沒收到選擇結果、視窗也還開著，顯示一次（只顯示一次，不會每秒洗版）提醒「還在等待 NAS 資料夾選擇結果...如果新分頁顯示連不上網站，代表電腦沒開機或選擇器沒啟動，請關閉分頁改用「選擇電腦檔案上傳」」；③一旦 `handleUploadFrameMessage()` 收到正確 nonce 的 `machi-nas-folder-selected` 訊息（代表使用者真的選完了），立刻呼叫新增的 `clearNasFolderPickerWatch()` 停止監看，不會在使用者已經選完之後還跳出「已關閉」或「還在等待」這類過期訊息。新增 `openNasFolderPicker()` 開新視窗前先呼叫 `clearNasFolderPickerWatch()`，避免使用者快速連點兩次時留下重複的監看計時器。
- 風險區塊：`win.closed` 是唯一能跨來源（新分頁是不同網域/協定）合法讀取的視窗狀態屬性，讀取它不會被瀏覽器安全機制擋下；但無法讀取 `win.location`／新分頁內容本身（會丟 `SecurityError`），所以沒辦法區分「使用者手動關閉」跟「連線失敗後使用者關閉錯誤頁」這兩種情境，訊息文字刻意寫成「如果顯示連不上網站」這種涵蓋兩種可能性的措辭，不會誤判成單一原因。20 秒的提醒不是「判定失敗」，只是善意提醒——真的在瀏覽多層資料夾找對案件資料夾，花超過 20 秒是很正常的，所以這則訊息不會清空 `activeNasFolderPickerNonce`、也不會關閉視窗，使用者可以完全不理會繼續選。
- 已檢查／驗證方式：`index.html` 兩段 `<script>` 語法檢查通過；`node --test backend/test/*.test.mjs` 22/22 全過。用真實頁面＋console 存根 `window.setInterval`／`window.clearInterval`（捕捉回呼函式後手動觸發模擬「經過幾秒」，不用真的等 20 秒）逐一驗證三種情境：①視窗立刻關閉（`{closed:true}`）→ 第一次 tick 就正確清空 nonce、停止監看、顯示「視窗已關閉」訊息；②視窗持續開著，模擬 19 次 tick（19 秒）不顯示任何訊息、第 20 次 tick 正確顯示提醒、第 21 次 tick 不重複顯示、監看仍在繼續（沒有被清除）；③模擬訊息已經被處理（`activeNasFolderPickerNonce` 被外部清空，代表 `handleUploadFrameMessage` 已經處理過），下一次 tick 正確偵測到 nonce 不符、安靜停止監看、不顯示任何訊息。另外用暫時把 `nasFolderPickerBaseUrl`／`nasFolderPickerToken` 改成測試值（測完立刻改回空字串、重新語法檢查與跑過 22 個既有測試確認沒有殘留）確認 `openNasFolderPicker()` 真的呼叫 `window.open()` 成功後會啟動 `activeNasFolderPickerWatchTimer`。
- 部署狀態：純前端，git push 後自動生效，不需要重新部署 Worker 或 Apps Script、也不影響 `nas_folder_picker_server.mjs`／`nas_design_image_watcher.mjs` 這兩支本機工具（它們完全沒有被這次改動觸碰）。
- commit：`63ba379`

### 2026-08-13 Asia/Taipei（最新）— 新增「NAS 資料夾選擇器」，過稿中可用滑鼠選 NAS 資料夾（跟選電腦檔案上傳並存）

- 修改目的：使用者認為上一則「選擇電腦檔案上傳」（見下方同日較早的紀錄）漏掉了「後續修改要持續追蹤最新圖片」這件事——設計師如果之後在 NAS 同一個資料夾陸續補圖，用「選電腦檔案」的話每次都要重新手動選檔案，系統不會自動發現新圖。使用者原本設想的是「網站直接呼叫 NAS 爬蟲主機的 API，顯示資料夾瀏覽器」，經討論釐清後，這其實是同一天更早（2026-08-13 稍早）被拆掉的「NAS 路徑＋本機背景監控程式」那條路線的加強版：`scripts/nas_design_image_watcher.mjs`（掃描→縮圖→上傳→寫回資料庫→前台出現「初稿」的完整流程）其實從 2026-08-12 就已經做好、也還留在專案裡，只是 2026-08-13 稍早把前端「填 NAS 路徑」的入口整個換成了瀏覽器選檔案，導致這支監控程式失去了設定路徑的管道；這次真正要做的只有「路徑怎麼填」這一段——把「手動輸入/貼上路徑」升級成「用滑鼠瀏覽 NAS 資料夾樹狀結構點選」，掃描/上傳/追蹤那一段完全不用重寫。跟使用者確認三個關鍵決定：①「NAS 爬蟲主機」只在辦公室內網開放，不架設對外通道（不用 Cloudflare Tunnel/ngrok 之類）；②NAS 主機定期輪詢資料庫決定要不要掃描（沿用 `nas_design_image_watcher.mjs` 現有機制，不用網站主動推播工作給 NAS 主機）；③持續追蹤的範圍是「案件維持過稿中期間」，離開過稿中就不再追蹤（這點其實 `discoverProjects()` 本來就是這樣寫的，不用改）；④標記過稿中時，「選 NAS 資料夾」與「選電腦檔案上傳」兩種方式並存，讓使用者自己選，不強迫二選一淘汰另一個。
- 關鍵技術限制（Mixed Content）：正式站是 `https://emctaipeiart.github.io`，NAS 資料夾選擇器伺服器只在辦公室內網、不會有 HTTPS 憑證，瀏覽器的 Mixed Content 規則會直接擋掉「HTTPS 頁面用 fetch/XHR 呼叫 HTTP 網址」，內網 IP 也不例外，無法繞過——這代表使用者原本畫的「網站（fetch）呼叫 NAS API」技術上做不到。改成前台用 `window.open()` 開一個新分頁導到這支伺服器自己提供的網頁（開新分頁屬於「導覽」，不受 Mixed Content 限制，跟 fetch/iframe 是不同機制），設計師在新分頁裡選好資料夾後，用 `postMessage` 把路徑丟回原本的分頁，由前台既有的 `updateCaseRow()` 寫回案件資料庫——這支伺服器完全不需要知道任何登入 token 或資料庫寫入邏輯，只負責「列出資料夾名稱」，跟現有「上傳設計圖」彈窗（iframe＋postMessage，2026-08-13 稍早那次做的）是同一套已經在用的模式，只是這次用開新分頁取代 iframe（iframe 內嵌 http 網址一樣會被 Mixed Content 擋掉，只有頂層導覽不受限）。
- 影響檔案：新增 `scripts/nas_folder_picker_server.mjs`；修改 `scripts/nas_design_image_watcher.mjs`（圖片副檔名加 `.webp`、更新檔頭註解）、`scripts/nas_design_image_watcher.config.json`（新增 `pickerPort` 欄位）、`scripts/nas_design_image_watcher.README.md`（新增「用滑鼠選 NAS 資料夾」章節、launchd 常駐範例、更新已測試/未測試段落）、`index.html`。
- 影響功能：
  1. **`scripts/nas_folder_picker_server.mjs`（新檔案）**：純 Node.js（不需要 macOS 專屬指令）常駐 HTTP 伺服器，跟 `nas_design_image_watcher.mjs` 共用同一份 `nas_design_image_watcher.config.json` 讀 `mountRoot`。提供 `GET /picker` 一個內嵌 CSS/JS 的資料夾瀏覽器網頁（麵包屑導覽、點資料夾逐層深入、「選擇目前這個資料夾」/「取消」按鈕）與 `GET /api/list?path=...&token=...` 一支只列出子資料夾名稱（不含檔案內容）的 API；`token` 驗證用 `nas_design_image_watcher.secrets.json` 裡的 `pickerToken`（第一次執行自動產生隨機值並存檔、印在畫面上）；`resolveSafeDir()` 會把路徑裡的 `.`／`..` 片段直接濾掉再接到 `mountRoot` 底下，確保算出來的絕對路徑一定還在掛載範圍內，擋掉路徑穿越。使用者在網頁上點「選擇目前這個資料夾」後，若有 `window.opener` 就用 `postMessage({type:'machi-nas-folder-selected',caseId,nonce,path},origin)` 把路徑丟回開啟它的分頁，然後自動關閉自己（`window.close()`）。
  2. **`index.html`**：新增 `openCaseDesignImageSourceChooser(id,round,anchorEl)`，用既有的 `fieldPopover` 元件（跟修改狀態、修改項目細節等既有彈出選單同一套機制）顯示「選擇 NAS 資料夾」／「選擇電腦檔案上傳」兩個選項；`openStatusEditor()` 標記過稿中時、案件詳情面板「上傳設計圖」按鈕，都從原本直接呼叫 `openCaseDesignImageUploadModal()`（跳瀏覽器選檔視窗）改成先呼叫這個選擇彈窗，選「選擇電腦檔案上傳」的行為完全不變（沿用 2026-08-13 稍早做好的整套背景上傳/壓縮/影片截圖邏輯）。新增 `openNasFolderPicker(id,round)`：用 `window.open()` 開新分頁導到 `nasFolderPickerBaseUrl`，網址帶 `caseId`／`token`（`nasFolderPickerToken`）／`nonce`（隨機值，跟既有 `closeNonce` 用途一樣是「確認這則 postMessage 真的對應這次操作」，不是機密）／`origin`（`location.origin`，給資料夾選擇器網頁當 `postMessage` 的目標 origin）四個查詢參數；`nasFolderPickerBaseUrl`／`nasFolderPickerToken` 兩個常數目前是空字串（見下方風險區塊），沒設定時點「選擇 NAS 資料夾」會顯示清楚的提示文字，不會報错或卡住，「選擇電腦檔案上傳」完全不受影響照樣能用。`handleUploadFrameMessage()`（原本只處理上傳 iframe 傳回的訊息，這次沿用同一個全域 `message` 監聽器）新增 `machi-nas-folder-selected` 分支：核對 `nonce` 相符才處理（防止過期/偽造訊息誤寫）、路徑是空字串時顯示「未選擇任何資料夾」不寫入，否則呼叫既有的 `updateCaseRow(id,{designImageFolderUrl:path},'已設定 NAS 來源資料夾')`——這個欄位跟寫入權限（`media.manage` 即可，不需要 `request.edit`）是 2026-08-12 就做好且沒有改動的既有機制（`worker/src/database-coordinator.ts` 的 `onlyDesignImageFolderLink` 判斷）。
  3. **`scripts/nas_design_image_watcher.mjs`**：`DEFAULT_IMAGE_EXTENSIONS` 加入 `.webp`（原本只有 `.jpg`/`.jpeg`/`.png`），對應使用者這次要求的「JPG/PNG/WebP」；掃描/輪次判斷/上傳這些核心邏輯完全沒改動，本來就已經符合「案件維持過稿中期間持續追蹤」的需求（`discoverProjects()` 每次執行都重新篩選狀態＝過稿中的案件，不是一次性快照）。
- 風險區塊：
  - **`index.html` 的 `nasFolderPickerBaseUrl`／`nasFolderPickerToken` 目前是空字串，需要使用者手動填入才會生效**——這兩個值取決於使用者實際把 `nas_folder_picker_server.mjs` 部署在哪台機器、那台機器在辦公室內網的位址是什麼，我沒辦法幫忙決定或填寫（連 SSH 進那台機器都做不到），README 已經寫清楚怎麼取得與填入這兩個值。填之前這個功能形同未啟用，但完全不影響「選擇電腦檔案上傳」這個既有選項，是安全的半成品狀態，不會讓過稿中這個核心操作被卡住。
  - **`pickerToken` 不是真正的機密**：因為 `index.html` 是公開的 GitHub Pages 網站，任何人打開瀏覽器開發者工具都看得到這個值寫死在原始碼裡——這是刻意的權衡取捨，已經在程式註解與 README 裡明確寫清楚，真正的防線是「這支伺服器本來就連不到辦公室外」，不是這個 token；如果之後有人真的在同一個辦公室網路上戳這支 API，最多只能看到 NAS 資料夾名稱清單，看不到任何檔案內容或案件資料庫本身。
  - **`window.open()` 開新分頁在部分瀏覽器情境下可能被彈出視窗攔截器擋下**（例如太久之後才呼叫、不是使用者直接點擊觸發的同一個事件循環內）——目前的呼叫路徑（點「選擇 NAS 資料夾」→ 立即呼叫 `window.open()`）是同步的使用者互動觸發，理論上不會被攔截，但已經加上 `window.open()` 回傳 `null`/`undefined` 時顯示「瀏覽器封鎖了新視窗」的提示訊息，不會靜默失敗。
  - **這次新增 `.webp` 到掃描副檔名清單，但完全沒有驗證過 macOS 系統內建的 `sips` 真的能不能正確讀取/壓縮 WebP 來源檔**——沙箱環境沒有 macOS，無法測試；理論上近幾年的 macOS（ImageIO 已支援 WebP 解碼）應該可以，但這只是推測，需要使用者實機測試一次含 WebP 圖片的資料夾。
  - `nas_folder_picker_server.mjs` 的 `/api/list` 只回傳資料夾名稱，不讀取任何檔案內容，暴露面很小；但它畢竟是一支會列出公司內部檔案系統結構（資料夾名稱，可能包含客戶名稱、專案名稱等）的伺服器，只靠「不在對外網路上」跟輕量 token 保護，如果之後這台機器意外被接上其他更開放的網路（例如筆電帶出辦公室又忘記關掉這支伺服器），會有資訊外洩風險——這點已經在程式註解裡提醒，但沒有做額外的網路介面綁定限制（目前是監聽 `0.0.0.0`，辦公室內網任何裝置都連得到，這是刻意的設計，因為「辦公室內其他人的電腦」本來就是預期的使用情境）。
- 已檢查／驗證方式：
  - `node --check` 對 `scripts/nas_folder_picker_server.mjs`／`scripts/nas_design_image_watcher.mjs` 語法檢查皆通過；`index.html` 兩段 `<script>` 用 `new Function()` 語法檢查通過；`node --test backend/test/*.test.mjs` 22/22 全過。
  - **`nas_folder_picker_server.mjs` 有實際啟動測試**（這是這次跟過去幾次 NAS 相關修改最大的不同——這支伺服器本身是純 Node.js，不需要 macOS 專屬指令，可以在這個沙箱環境真的跑起來）：用暫存目錄模擬 `mountRoot`（含中文資料夾名稱、多層巢狀結構），實際啟動伺服器後用 `curl` 逐一驗證：沒帶 token／帶錯 token 正確回 401、根目錄與巢狀路徑列表正確、`../../../etc` 路徑穿越嘗試正確被擋下（穿越片段被過濾掉，最終解析成 `mountRoot/etc`，資料夾不存在回 ENOENT，不會意外讀到 `mountRoot` 之外的真實系統路徑）、不存在的資料夾正確回錯誤訊息、`/picker` 頁面正確回傳 HTML。另外用 Browser pane 實際載入 `/picker` 頁面，逐層點擊資料夾深入（根目錄→專案企劃部→執行中）、確認麵包屑正確顯示與可點擊跳轉、點擊「選擇目前這個資料夾」後確認分頁真的被 `window.close()` 關閉（用 `tabs_context` 確認分頁從清單中消失）。
  - **`index.html` 新增的函式有用真實頁面＋console 存根做隔離測試**（`accessAllowed`／`window.open`／`updateCaseRow`／`openUploadModal`／`isDesignerLogin` 換成記錄呼叫參數的假函式，`nasFolderPickerBaseUrl`／`nasFolderPickerToken` 暫時改成測試值、測完再改回空字串並重新跑過語法檢查與 22 個既有測試確認沒有殘留），逐一驗證：①標記過稿中會叫出「NAS 資料夾／電腦檔案上傳」選擇彈窗、選「電腦檔案上傳」行為與改動前完全一致（`openUploadModal` 收到的網址參數不變）；②選「NAS 資料夾」在未設定時顯示「尚未設定」提示、不會呼叫 `window.open`；③設定測試值後選「NAS 資料夾」會用正確的 `caseId`/`token`/`nonce`/`origin` 四個查詢參數呼叫 `window.open()`；④模擬資料夾選擇器分頁傳回帶正確 nonce 的 `machi-nas-folder-selected` 訊息，確認 `updateCaseRow` 收到正確的 `{designImageFolderUrl:<選的路徑>}`，且 nonce 用過一次後被清空（防止重複套用同一則訊息）；⑤模擬帶錯誤 nonce 或空路徑的訊息，確認正確被忽略／顯示錯誤提示、不會誤寫入；⑥狀態改成過稿中以外的其他狀態（例如已完成）不會叫出這個選擇彈窗。
  - **未做的驗證**（跟過去所有 NAS 相關修改一樣的邊界，這個環境連不到公司內網也沒有 macOS）：真的連上你的 NAS、真的在辦公室內網另一台機器用區網 IP／`.local` 主機名稱連到這支選擇器伺服器、真實瀏覽器（尤其 Safari）對「從 HTTPS 頁面 `window.open()` 開 HTTP 新分頁」的實際行為與提示訊息、`launchd` 常駐設定真的重開機/長時間運作是否穩定、`sips` 對 WebP 來源檔的實際支援度。這些都需要使用者在自己的環境實測。
- 部署狀態：`index.html`、`CLAUDE.md` 純前端／文件，git push 後自動生效（`nasFolderPickerBaseUrl`／`nasFolderPickerToken` 這兩個常數目前是空字串，設定好資料夾選擇器伺服器並拿到區網位址與 token 後，還需要再手動編輯 `index.html` 填入這兩個值、重新 push 一次才會真的啟用「選擇 NAS 資料夾」——這點沒辦法透過設定檔或後台介面設定，是寫死在前端原始碼裡的兩個常數，之後如果想避免每次換機器都要改程式碼重新部署，可以考慮改成從資料庫後台的某張設定表讀取，目前先用最簡單的寫死方式）；`scripts/nas_folder_picker_server.mjs`／`scripts/nas_design_image_watcher.*` 都是純本機工具，不需要 git push 就能在你的 Mac 上執行，需要你手動啟動（或依 README 設定 `launchd` 常駐）；`worker/`、`upload/Code.gs` 這次完全沒有修改，不需要重新部署。
- commit：`63ba379`

### 2026-08-13 Asia/Taipei（更新）— 案件設計圖上傳改成選資料夾／多選檔案＋背景上傳＋自動壓縮／影片截圖；修改紀錄新增圖片按鈕縮小

- 修改目的：上一則「選擇電腦檔案上傳」使用者實際用起來覺得：①上傳要等很久會不耐煩；②想要更接近「選資料夾」而不是零散選檔案，比之前打 NAS 路徑更容易也更不會選錯專案；③大圖佔空間；④影片檔應該只抓一張截圖不要整支上傳。另外修改紀錄彈窗裡「新增圖片」那顆按鈕因為 CSS 漏加 `!important` 被全域按鈕樣式蓋掉，變成一個 64px 的綠色圓形大按鈕，使用者反映「過大、不精緻」。
- 技術限制與設計取捨：跟使用者確認過，瀏覽器選資料夾（`webkitdirectory`）沒辦法把使用者電腦上的絕對路徑交出來（瀏覽器安全限制），原本設想的「選資料夾→只寫路徑紀錄→背景追蹤器自己去抓」做不到；但選資料夾當下瀏覽器已經把裡面所有檔案內容讀進來了，不需要另外的追蹤器，直接在瀏覽器端做背景上傳＋用戶端壓縮／影片擷圖即可達到同樣效果，且完全不用碰 `worker/` 或 `upload/Code.gs`（`uploadCaseDesignImagesInteractive` 現有介面本來就支援「一張一張呼叫」，這次只是呼叫端行為改變）。
- 影響檔案：`upload/upload.html`（主要改動）、`index.html`。
- 影響功能：
  1. **選檔 UI**：`mode=case-design` 區塊原本單一個「選擇設計圖」拖放框，改成「選擇資料夾」／「選擇檔案（可多選）」兩個按鈕＋保留拖放。透過「選擇資料夾」進來的檔案只靜靜篩出圖片／影片（資料夾裡難免有 `.DS_Store`、設計來源檔等雜項，不逐一跳錯誤訊息）；透過「選擇檔案」／拖放明確選取的維持原本「型別或超過大小會顯示已略過」的提示行為。新增用戶端上限 `MAX_CASE_DESIGN_FILES_CLIENT=40`。
  2. **影片只上傳一張截圖**：新增 `extractVideoFrame(file)`，用離屏 `<video>`＋`<canvas>` 在時長 10%（最多 1 秒）處擷取一張畫面，影片原始檔完全不上傳；`MAX_VIDEO_SOURCE_SIZE_MB=500` 當用戶端防呆上限。支援常見影片格式（mp4/mov/webm/m4v，`accept` 屬性擴充成 `image/*,video/*`）。
  3. **圖片自動壓縮**：新增 `compressImageBlob(blob,{maxDimension,quality})`，用 `createImageBitmap`（不支援時退回 `<img>`）＋canvas 等比縮到最長邊 1600px、重新編碼成 JPEG 品質 70%——參數跟現有 `scripts/nas_design_image_watcher.mjs` 的壓縮設定一致。影片擷圖後的畫面也會送進同一支函式，統一規格。
  4. **序列上傳＋逐張回報進度**：原本「一次把全部檔案轉 base64、一次呼叫 `uploadCaseDesignImagesInteractive`」改成 `for` 迴圈逐一處理（影片先擷圖→都壓縮→轉 base64→呼叫一次帶單張 `images:[oneImage]` 的既有函式），每張處理完（不論成功失敗）都會 `postMessage` 一則 `machi-case-design-upload-progress`（`{done,total,currentFileName}`）給父視窗；單張失敗會記錄下來、繼續處理下一張，不會讓整批中斷；全部跑完後送出彙總的 `machi-case-design-images-updated`（新增 `failedCount` 欄位）。新增 `window.addEventListener('message',...)` 監聽父視窗傳來的 `machi-cancel-case-design-upload` 取消訊號（這是這個檔案第一次需要接收父視窗的訊息，之前都只有單向 iframe→父視窗）。
  5. **背景上傳（不擋畫面）**：`index.html` 這邊，`#uploadModalClose`（右上角 X）、背景遮罩點擊、Escape 鍵這三個既有關閉途徑，改成偵測到 `caseDesignUploadInFlight`（收到第一個 progress 訊息就設 true）時呼叫新函式 `backgroundizeCaseDesignUpload()`——只隱藏 `#uploadModal`（沿用既有 `hidden` 機制，沒改任何 CSS 結構）、移除 body 的捲動鎖，**不會**把 iframe 砍掉，讓上傳在背景繼續跑，使用者可以正常操作頁面其他地方。新增一個固定在右下角的浮動小卡片 `#caseDesignUploadBadge`（不是重用 `#uploadModal` 也不是重用既有的 `#syncStatus`，因為 `#syncStatus` 只是主案件列表工具列裡的一個 `<span>`，不是全畫面都看得到的 toast），只在背景上傳時顯示，顯示「設計圖上傳中 3/12：xxx.jpg」，點卡片本體恢復大彈窗（`restoreCaseDesignUploadModal()`），點卡片上的小「×」跳 `confirm()` 二次確認後透過 `postMessage` 通知 iframe 取消（迴圈跑完手上這張就提前結束，不會讓上傳到一半的檔案被硬中斷）。真正的收尾（`frame.src` 設回 `about:blank`、清空 nonce）只在收到最終完成訊息時才發生，不論當下是前景還是背景。為了讓 `closeUploadModal()` 在「已背景化（`modal.hidden=true`）」狀態下仍然能被完成訊息正確觸發收尾，新增獨立的 `uploadModalActive` 旗標取代原本用 `modal.hidden` 當作「是否有東西開著」的判斷依據（`modal.hidden` 現在同時可能代表「真的關閉」或「背景化中」兩種意思，不能再共用同一個判斷）。
  6. **「新增圖片」按鈕縮小精緻化**：`.revision-image-add` 這條 CSS 補上 `!important`（跟同一區塊其他按鈕如 `.revision-confirm-btn` 一致），尺寸從失控的 64px 圓形綠色大按鈕改成 26px 小巧的白底虛線圓圈，hover 時邊框與圖示變綠提示可點擊，視覺上跟旁邊的刪除小按鈕、縮圖尺寸更協調。
- 風險區塊：
  - 影片畫面擷取（`extractVideoFrame`）用真的 `MediaRecorder`＋`canvas.captureStream()` 產生一段測試影片實測過整條流程可以正確取得 JPEG 畫面，但這是在無頭 Chrome 環境測試的，正式站使用者的瀏覽器版本、影片編碼（尤其 `.mov`／H.265 等 Safari 常見格式）解碼支援度可能有落差，需要使用者實機測試含真實影片的批次上傳。
  - 背景上傳仍然需要瀏覽器分頁保持開啟才能繼續（關分頁或整頁重新整理會中斷，未上傳的檔案會遺失，已經上傳成功的不受影響）——這是瀏覽器背景執行的硬限制，已跟使用者說明並確認可接受。
  - `uploadModalActive` 這個新旗標取代了原本 `closeUploadModal()`／各關閉途徑依賴 `modal.hidden` 判斷「是否有上傳在進行」的邏輯——已經用實際情境（前景時點 X、背景時點 X 兩次、背景時收到完成訊息、前景時收到完成訊息）在瀏覽器裡逐一驗證行為正確，但這是這次改動裡耦合最多既有程式碼路徑的一段，之後如果要再改 `#uploadModal` 的開關邏輯要留意這個旗標。
- 已檢查／驗證方式：
  - `node --test backend/test/*.test.mjs` 22/22（沒有動到 schema／後端，`worker/`、`upload/Code.gs` 這次完全沒改）。
  - `index.html`／`upload/upload.html` 抽出 `<script>` 內容 `node --check` 語法檢查皆通過。
  - 用本機 Node 靜態伺服器＋ Browser pane：①型別過濾兩種嚴格程度（資料夾選取靜默略過 `.DS_Store`、明確選取顯示略過訊息）皆正確；②用真實 3000×2000 PNG 測試 `compressImageBlob()`，確認正確等比縮到 1600×1067、轉成 JPEG、檔案從 121KB 壓到 12KB；③用 `MediaRecorder`＋`canvas.captureStream()` 現場產生一段真實 webm 測試影片，`extractVideoFrame()` 確認能正確取出一張 320×240 的 JPEG 畫面；④模擬 3 個真實圖片檔（1 張故意讓伺服器端回傳失敗）跑完整序列上傳流程，確認：每個檔案各自呼叫一次 `uploadCaseDesignImagesInteractive`（`images` 陣列長度都是 1）、檔名正確轉成 `.jpg`、progress 訊息四則（初始 0/3 與三次完成）done 正確遞增、失敗的那張不會中斷後續、最終彙總訊息 `count`／`failedCount` 正確；⑤`index.html`：確認 progress 訊息在大彈窗前景時不會顯示浮動小卡片（避免前景+背景重複顯示）、背景時正確顯示並即時更新文字；確認 X／背景遮罩／Escape 在上傳進行中時呼叫 `backgroundizeCaseDesignUpload()` 而非 `closeUploadModal()`（iframe 不會被砍掉）；確認點小卡片會恢復大彈窗；確認不論收到完成訊息當下是前景還是背景，都會正確重設 `frame.src`／`uploadModalActive`／nonce／隱藏小卡片，並觸發 `fetchModificationCounts()`。取消按鈕的 `postMessage` 呼叫本身因為 iframe 是 `credentialless` 沙箱、`about:blank` 狀態下無法從父視窗攔截驗證（`SecurityError: cross-origin`），改用程式碼人工比對確認邏輯正確（`confirm()` 二次確認後才呼叫 `contentWindow.postMessage`）。
  - **未做的驗證**：無法在這個沙箱環境測試真正的 Google Drive 上傳（連不到 Google API），也沒有測過真實使用者裝置上的各種影片格式與瀏覽器版本組合，需要使用者實機測試至少一次含真實影片的批次上傳。
- 部署狀態：`index.html` 純前端，git push 後自動生效；**`upload/upload.html` 需要使用者自行手動部署**（Apps Script 編輯器「部署 → 管理部署 → 新版本」，這次跟上一則一樣沒有改動 `upload/Code.gs`，所以只需要更新 `upload.html` 這個檔案內容，不用重新走一次授權流程）。`worker/`、`upload/Code.gs` 這次完全沒有修改，不需要重新部署 Worker。
- commit：`10054ca`

### 2026-08-13 Asia/Taipei（較早）— 過稿中設計圖改成「選擇電腦檔案上傳」、修改紀錄可編輯圖片（新增/刪除）

- 修改目的：使用者認為過稿中要求填寫 NAS 資料夾路徑不夠直覺，希望改成直接在瀏覽器選電腦上的圖片檔案（可多選）上傳，系統自動算好目的地 Drive 資料夾（設計師/客戶別/年度/月份/案件編號），不用使用者自己管路徑；同時要求修改紀錄追蹤（修改紀錄彈窗）要能對每一輪設計圖新增/刪除，權限比照既有「設定來源資料夾」用的 `media.manage`；刪除只從系統紀錄移除連結，不刪 Drive 原始檔。跟使用者確認過這是**完全取代**填 NAS 路徑這個互動流程，不是並存的第二個選項。
- 影響檔案：`worker/src/database-coordinator.ts`、`worker/test/index.test.ts`、`upload/Code.gs`、`upload/upload.html`、`index.html`。
- 影響功能：
  - **Worker**：新增 `removeCaseDesignImage` action（`media.manage` 權限），從指定案件／輪次的「修改統計表」「圖片連結」JSON 陣列裡移除指定網址的那一筆，找不到該張圖片會回錯誤；把 `addCaseDesignImages` 裡解析「圖片連結」JSON 的邏輯抽成共用 helper `parseCaseDesignImages_(row)`，兩個 action 共用。順手修正 `addCaseDesignImages` 建立第 0 輪紀錄時，「修改內容」文字原本不管來源一律寫死「初稿完成（NAS 自動建立）」，改成只有服務金鑰（NAS 監控程式）呼叫時才這樣寫，登入使用者手動上傳時顯示單純的「初稿完成」，避免文案誤導。
  - **`upload/Code.gs`**：把 `uploadCaseDesignImages()`（NAS 監控程式用，服務金鑰驗證）裡「逐張解碼 base64、檢查大小、建檔、設分享」那段抽成共用 helper `uploadImagesToFolder_()`；新增 `uploadCaseDesignImagesInteractive(payload)`，跟前者共用同一段上傳邏輯與同一套「設計師/客戶別/年度/月份/案件編號」巢狀資料夾規則，差異只在身分驗證改用既有的 `verifyMediaManager_(editorToken)`（案件詳情面板「設定來源資料夾」按鈕本來就在用的同一支），呼叫 `callMainAppJsonAction_('addCaseDesignImages',{editorToken,...})`（不帶 serviceKey，讓 Worker 走 session 分支）。
  - **`upload/upload.html`**：新增 `mode=case-design` 區塊——這個頁面原本只有 `user`／`designer` 兩種模式共用同一批單檔上傳 DOM，這次**完全新增獨立區塊**（不動任何既有頭像/海報/限動上傳邏輯），有自己的 `<input type=file multiple>`、選好之後可個別移除的縮圖預覽列（未上傳前純瀏覽器端）、「上傳全部」/「清空重選」按鈕；送出時把每個檔案轉 base64，用 `google.script.run.uploadCaseDesignImagesInteractive(...)` 呼叀新函式，成功後用既有的 `notifyUploadHost()` 發送 `machi-case-design-images-updated` 訊息給父視窗、`window.close()`；失敗時顯示錯誤、按鈕恢復可重試。
  - **`index.html`**：案件標記「過稿中」（`openStatusEditor`）、案件詳情面板按鈕（原「設定來源資料夾」改名「上傳設計圖」）都改成呼叫新函式 `openCaseDesignImageUploadModal(id,round)`，直接跳出「選擇電腦檔案」上傳視窗（`upload/upload.html` 的 `mode=case-design`），不再跳「填 NAS 路徑」的表單；移除 `openDesignImageFolderPrompt`／`openDesignImageFolderPromptFromDetail` 兩個函式（完全被取代）。`handleUploadFrameMessage` 新增處理 `machi-case-design-images-updated` 訊息，收到後關閉上傳視窗、呼叫既有的 `fetchModificationCounts()` 整批重抓修改紀錄（不用自己在前端模擬 Worker 的合併/去重邏輯）再重繪畫面。修改紀錄彈窗（`revisionImagesHtml`）每張設計圖縮圖新增一顆小型刪除按鈕、每一輪紀錄新增一顆「新增圖片」按鈕，兩者都只在 `media.manage` 權限下顯示；新增 `removeCaseDesignImage(event,id,count,url)`，跳原生 `confirm()` 二次確認後呼叫 Worker 新 action。
  - **不變動**：`designImageFolderUrl` 欄位本身（schema、`normalizeRow`、Worker `model.ts` 的 `KEY_TO_HEADER` 映射）與本機 NAS 背景監控程式（`scripts/nas_design_image_watcher.mjs`）完全沒有修改，只是這次的兩個觸發點（過稿中彈窗、案件詳情面板按鈕）不再寫入這個欄位、不再引導使用者填路徑——維持給已經設定過的舊案件與該工具相容用，之後如果要徹底汰除，需要另外評估。
- 風險區塊：
  - `upload/upload.html`／`upload/Code.gs` 這兩個檔案是 Apps Script 專案，跟過去每一次修改一樣完全無法在本機真正執行測試（`google.script.run`／`DriveApp`／`PropertiesService` 等全域物件只存在於 Apps Script 執行環境），只能做語法檢查與人工比對；`uploadCaseDesignImagesInteractive` 的邏輯是直接複製既有 `uploadCaseDesignImages`（服務金鑰版）已經在跑的巢狀資料夾／分享設定／dedupe 規則，只換了驗證方式，風險相對低，但**沒有真的呼叫過 Google Drive API**。
  - `worker/src/database-coordinator.ts` 的 `removeCaseDesignImage` 只做「從 JSON 陣列移除連結」，刻意不呼叫 Drive API 刪檔（符合使用者要求），如果之後有人誤以為「刪除」等於「連 Drive 原始檔也刪掉」，需要另外溝通——這是刻意的產品決定，不是技術限制。
  - 前端 `revisionImagesHtml` 的刪除／新增按鈕只用 `accessAllowed('media.manage',...)` 做前端顯示層過濾，跟既有「設計師設定」彈窗（2026-08-13 稍早那則修改）同樣的模式——後端 `removeCaseDesignImage`／`addCaseDesignImages` 這兩個 action 本身已經有 `requireAccess(...,'media.manage')` 把關（不是只靠前端藏起來），所以繞過前端 UI 直接呼叫 API 一樣會被擋，這點跟「設計師設定」那次未收斂的後端風險不同，這次沒有留下同類技術債。
- 已檢查／驗證方式：
  - `node --test backend/test/*.test.mjs` 22/22（動手前已 grep 過 `backend/test/backend.test.mjs`／`worker/test/index.test.ts` 確認沒有測試鎖住即將移除的 `openDesignImageFolderPrompt`／NAS 路徑相關字串，這次沒有重演過去兩次「移除舊機制前沒查測試」的教訓）。
  - `cd worker && npx tsc --noEmit`（無錯）、`npx vitest run` 8/8（新增一支測試：先驗證沒有 `media.manage` 的登入帳號呼叫 `removeCaseDesignImage` 會被擋且錯誤訊息正確；再驗證有 `media.manage`（比照正式資料庫「設計師」角色範本現況，同樣沒有 `request.edit`）的帳號可以 `addCaseDesignImages` 寫入兩張圖、`removeCaseDesignImage` 刪其中一張成功、再刪同一張回「找不到該張圖片」）、`npx wrangler deploy --dry-run` 打包成功。
  - `upload/Code.gs` 複製成 `.js` 副檔名 `node --check` 語法檢查通過；`index.html`／`upload/upload.html` 抽出 `<script>` 內容 `node --check` 語法檢查通過。
  - 用本機 Node 靜態伺服器＋ Browser pane 載入真實正式站資料（`backend/data/db.json`，614 筆案件），全程 stub 掉 `sheetApi`／`accessAllowed`／`google.script.run`，沒有真的打任何網路請求：確認 `revisionImagesHtml` 在有／無 `media.manage` 權限、有／無圖片四種組合下正確顯示或隱藏刪除鈕／新增鈕；確認 `caseDesignImageUploadUrl` 組出的網址參數（`mode`／`caseId`／`round`／`designer`／`client`／`year`／`month`／`closeNonce`／`token`）全部正確；確認 `openCaseDesignImageUploadModal` 正確呼叫 `openUploadModal`；確認 `openStatusEditor` 已經不再參照 `designImageFolderUrl`；確認 `removeCaseDesignImage` 沒有權限時被 `requireAccess` 正確擋下並顯示錯誤訊息；確認案件詳情面板按鈕文字與 onclick 已改成新函式。另外用同一支本機伺服器單獨載入 `upload/upload.html?mode=case-design&...#token=...`：確認畫面正確切到新區塊（隱藏原本單檔上傳卡片與最近上傳清單）、標題／說明文字正確；用假 File 物件模擬選檔驗證型別／大小驗證正確篩掉不合格檔案、預覽格可個別移除；stub `google.script.run` 模擬成功／失敗兩種回應，確認成功時正確清空檔案清單、呼叫 `notifyUploadHost` 帶正確的 `type`／`caseId`／`round`／`count`、呼叫 `window.close()`，失敗時正確顯示錯誤訊息、按鈕恢復可重試、檔案清單保留（過程中發現並修正一個小狀態問題：一開始 `handleCaseDesignUploadSuccess` 沒有把 `caseDesignUploading` 重設為 `false`，正常情況下父視窗會在收到訊息後立刻把整個 iframe 導向 `about:blank` 摧毀這段 JS 狀態、不影響實際使用，但修好比較乾淨，一併清空已上傳完的檔案清單）。
  - **未做的驗證**：沒有實際透過 Apps Script 編輯器部署新版 `upload/Code.gs`／`upload/upload.html` 並跑一次真實的「瀏覽器選檔案→真的傳到 Google Drive」，這條端對端路徑在這個環境連不到 Google API，需要使用者手動部署後自己測一次。
- 部署狀態：`worker/` 已執行 `npx wrangler deploy` 完成部署（`removeCaseDesignImage`／`addCaseDesignImages` 的 session 分支已生效）；`index.html`、`CLAUDE.md` 已 push 到 GitHub，GitHub Pages 會自動重新部署。**`upload/Code.gs`＋`upload/upload.html` 這次由使用者自行手動部署**（同一個 Apps Script 專案，Apps Script 編輯器「部署 → 管理部署 → 編輯 → 新版本」）——這兩個檔案本身已經跟著這次 commit 一起進了 git（方便追蹤紀錄），但 git 裡的內容不會自動同步到 Apps Script 專案，沒部署前，過稿中跳出的上傳視窗會因為 `uploadCaseDesignImagesInteractive` 這支新函式不存在而上傳失敗。

  （附註：這次工作期間 `upload/Code.gs` 曾經被意外整個覆蓋成不相關的文字內容，靠使用者從 Apps Script 編輯器複製當時線上還保留的正確原始碼貼回來才救回；救回後逐一比對函式清單（53 個，跟預期的「51 個原有＋2 個這次新增」一致）、跑過語法檢查、確認沒有任何內容遺漏或誤植才繼續。）
- commit：`873ace9`

### 2026-08-13 Asia/Taipei（更晚）— 修正限時動態到期／取消後仍持續顯示、一般使用者上傳頭像後不會更換

- 修改目的：使用者回報兩個問題：①前台設計師頭像的限時動態，時間到期或設計師在上傳頁選擇「取消限動設定」之後，前台仍然持續顯示；②一般使用者（非設計師）在帳號選單「設定我的頭像」上傳完照片後，頭像沒有真的更換。
- 影響檔案：`index.html`、`upload/Code.gs`。
- 影響功能／根因：
  1. **限時動態持續顯示**：`renderDesigners()`（`index.html`）在「任一設計師的大海報正在展開中」時，為了不打斷正在播放的 10 秒限動輪播，會整個跳過重新繪製整個名單，只呼叫 `syncDesignerUnreadFrames()` 更新頭像外圈的「有限動」標記。這個標記本身其實會正確反映最新的 `designerReels`（已確認），但**正在播放中的那則限動本身沒有被檢查是否已經失效**——如果使用者正看著某位設計師的限動時，那則限動剛好到期或被設計師取消，畫面會維持繼續播放到 10 秒輪播自然跳下一張為止，而不是立刻停止。另外，`closeDesignerPoster()`（使用者關閉海報彈窗）原本完全不會觸發任何重新整理，如果限動資料是在「有任一位設計師的海報展開中」這段期間被背景輪詢更新的，整個設計師名單（頭像、大頭貼海報、技能、對話框等）會停留在展開前的舊狀態，要等到「沒有任何海報展開、且又剛好有新一輪資料變化」才會被動更新。修正：`renderDesigners()`在略過整體重繪的分支內，新增檢查目前正在播放的限動 `activeDesignerStoryPlayback` 是否還存在於最新的 `storiesForDesigner()` 清單裡，不存在就立刻呼叫 `stopDesignerStoryPlayback()`（退回顯示靜態大頭貼海報）；`closeDesignerPoster()` 新增 `{rerender=true}` 選項，關閉海報時預設會呼叫一次 `renderDesigners()`，把展開期間累積的任何資料變化補上。`openDesignerPoster()` 內部「切換到別的設計師時關掉其他人的海報」那段改傳 `{rerender:false}`，避免在切換海報的過程中把整個名單 DOM 重繪掉、扯斷正要開啟的目標海報的 DOM 參照。
  2. **一般使用者頭像上傳後沒換**：`upload/Code.gs` 的 `uploadImage()`（一般使用者上傳頭像最主要、實際會被執行到的路徑）與 `replaceUserAvatar()`（次要路徑，目前 UI 未實際觸發但保留供未來使用），過去只把新頭像網址寫進**舊版 Google 試算表**的「設定」分頁，完全沒有同步到 Cloudflare Worker 的 JSON 資料庫——而 2026-08-11 架構切換後，前台 `index.html` 讀取帳號設定（含頭像）一律經由 Worker 的 `getUserSettings`／`saveUserSettings` 讀寫 JSON，早就不再讀那份舊試算表。上傳當下前端會先用 postMessage 樂觀地把新頭像顯示出來，但只要任何時機觸發 `refreshCurrentAccountAvatar()`（例如切回分頁、下次登入、`keepEditorSessionAlive` 等）重新向 Worker 拉取設定，就會被打回上傳前的舊頭像——這正是使用者感覺「上傳完頭像沒有換」的原因。設計師的頭像／大海報／限時動態不受影響，是因為那幾條路徑（`setDesignerStories` 等）本來就有呼叫 `callMainAppJsonAction_()` 把資料同步進 Worker，只有一般使用者這條路徑當初漏掉了。修正：`uploadImage()` 寫入試算表後，新增呼叫 `callMainAppJsonAction_('saveUserSettings',{editorToken,account:target.account,settings:{avatar:userAvatarUrl}})`；`replaceUserAvatar()` 也比照補上同一段呼叫。Worker 端的 `saveUserSettings` action（`worker/src/database-coordinator.ts`）與底層 `updateSettingsRow()`（`worker/src/model.ts`）本來就支援 `settings.avatar` 寫入「設定」表的「頭像連結」欄位，這次沒有新增或修改 Worker 程式碼。
- 風險區塊：
  - 限動修正：`stopDesignerStoryPlayback()` 在 `shell` 仍連接在 DOM 上時會呼叫 `showDesignerFinalPoster()` 退回靜態海報，這個函式本來就是既有的「輪播結束」路徑會呼叫的同一支，行為一致、沒有新增風險；`renderDesigners()`this次新增的檢查只在 `activeDesignerStoryPlayback` 存在時執行，沒有播放中限動時完全不影響原本行為。
  - `closeDesignerPoster()` 預設關閉時觸發重繪，理論上如果同一時間有多個呼叫點依賴「關閉海報後 DOM 節點不會變」的假設可能受影響——已逐一檢查全部呼叫點（點擊同一頭像關閉、鍵盤 Enter/空白鍵關閉、點擊海報以外區域關閉、`openDesignerPoster()` 內部切換海報），確認除了 `openDesignerPoster()` 內部切換這個情境（已改傳 `rerender:false` 排除）之外，其餘呼叫點在呼叫 `closeDesignerPoster()` 之後都沒有再使用該次的 `shell` 參照，重繪造成的 DOM 節點替換不會影響後續程式碼。
  - 頭像修正：`callMainAppJsonAction_()` 呼叫失敗（例如 `editorToken` 過期）會讓整個 `uploadImage()`／`replaceUserAvatar()` 拋出例外，回傳 `success:false`——這是刻意的行為：既然「設定頭像」這個動作本身沒有真的成功寫進正式資料來源，就不該回報成功，讓使用者誤以為已經換好；圖片本身仍會留在 Google Drive（不會被這次修改額外刪除），只是不會被設成頭像。
- 已檢查／驗證方式：
  - `index.html`：兩段 `<script>` 語法檢查（`node -c`）通過；本機靜態伺服器＋ Browser pane 用假資料隔離測試 `renderDesigners()`／`closeDesignerPoster()`／`openDesignerPoster()`——確認海報展開中，正在播放的限動一旦從 `designerReels` 移除，會立即停止輪播並退回靜態海報（`story-playing` class 立刻消失、`activeDesignerStoryPlayback` 立刻變成 `null`，海報本身維持展開不會被意外關閉）；確認海報展開期間限動資料變動、直到使用者關閉海報前完全不重繪 DOM（`avatar-shell` 節點參照不變），關閉後立刻重繪，`has-story`／`data-story-count` 正確反映最新（已移除）狀態。
  - `upload/Code.gs`：`node --check`（複製為 `.js` 副檔名後）語法檢查通過；Apps Script 專屬的 `UrlFetchApp`／`PropertiesService`／`DriveApp` 等全域物件無法在本機執行，這次的修改純粹是「在既有寫入試算表的程式碼後面，比照 `setDesignerStories()` 已經在用的同一支 `callMainAppJsonAction_()` 呼叫方式，多呼叫一次已存在且有測試覆蓋的 Worker `saveUserSettings` action」，沒有新增任何本機無法驗證的 Apps Script 專屬邏輯；`saveUserSettings` 這個 Worker action 本身有既有測試覆蓋（`worker/test/index.test.ts`）。`node --test backend/test/*.test.mjs` 22/22 全過；`cd worker && npx tsc --noEmit` 無錯（這次沒有修改 `worker/` 底下任何檔案，執行只是確認既有型別沒有被間接破壞）。**未做的驗證**：沒有實際透過 Apps Script 編輯器部署新版 `upload/Code.gs` 並跑一次真實的使用者頭像上傳（無法在本機模擬 Google Drive／Apps Script 執行環境），也沒有用真實登入帳號在正式站重現「限動到期後仍顯示」再確認修好。
- 部署狀態：`index.html` 純前端，git push 後自動生效；**`upload/Code.gs` 需要手動部署**（在 Apps Script 編輯器「部署 → 管理部署 → 編輯 → 新版本」）才會生效——沒部署前，一般使用者上傳頭像仍會遇到一樣「上傳完沒換」的問題。
- commit：（見下方 push 紀錄）

### 2026-08-13 Asia/Taipei（稍晚）— 修正「設計師設定」顯示全部人的資料、以及過稿中無法填寫 NAS 路徑的權限誤擋

- 修改目的：使用者回報兩個問題：①前台「設計師設定」彈窗應該只顯示登入者本人的設定，其餘設計師不該顯示；②設計師把案件改成「過稿中」後跳出視窗要填 NAS 路徑，送出時卻被擋「權限不足」，問後台是不是沒有開放對應的權限設定。追查後兩者都是既有邏輯的 bug，不是後台權限沒開放：
  1. `renderDesignerSettingsForm()`（`index.html`）本來無條件把 `designerOptions`（寫死的 6 位設計師清單）全部列出來，沒有依登入者過濾，任何有 `designer.settings` 權限的設計師都能看到、也能修改其他 5 位設計師的技能／留言／頭像／音樂設定。
  2. NAS 路徑欄位（`designImageFolderUrl`／`設計圖資料夾連結`）在前台是靠 `media.manage` 權限把關（案件詳情面板的「設定來源資料夾」按鈕即是如此），但 `worker/src/database-coordinator.ts` 的 `updateRequests` 判斷寫入需要哪個權限時，只認「有沒有動到狀態／項目細節」——動到就要 `request.status`，其餘一律要 `request.edit`，完全沒有替 `designImageFolderUrl` 開特例。正式資料庫的「設計師」角色範本（`角色權限範本` 表）目前**沒有 `request.edit`**（只有 `request.status`／`media.manage` 等），所以設計師在前端能打開視窗、能打字，送出時卻被後端用 `request.edit` 擋下，收到「此帳號沒有『request.edit』權限」——這就是使用者看到的「權限不足」。
- 影響檔案：
  - `index.html`：新增 `visibleDesignerSettingsOptions()`——管理者（`isAdministrator()`）維持看得到全部 6 位設計師（保留前台團隊管理能力，跟後台 `json_database_admin.html`「帳號設定」可編輯任何帳號一致）；非管理者只回傳 `designerOptions.filter(name=>name===currentEditor)`，也就是只有自己那一筆。`renderDesignerSettingsForm()` 改用這份過濾後的清單渲染；沒有對到任何設計師名字時（理論上不會發生，防呆用）顯示提示文字而不是空白。`collectDesignerSettings()`（送出儲存時讀表單）**沒有改**——它本來就是對每個 `designerOptions` 逐一找 DOM 列，找不到列時 fallback 用現有資料（`current`），所以非管理者畫面上看不到的其他 5 位設計師，儲存時會原樣帶回去、不會被清空或覆蓋，只有畫面上看得到、改得到的自己那筆會被判定為「有變更」送出。
  - `worker/src/database-coordinator.ts`：`updateRequests()` 新增 `onlyDesignImageFolderLink` 判斷——這次寫入的欄位（`changes` 扣掉 `id`、以及 `writeHeaders`）只包含 `designImageFolderUrl`／`設計圖資料夾連結` 時，權限判斷改成 `media.manage`；只要同時動到其他任何欄位（例如同時想改客戶別、專案名稱），就退回原本的 `request.edit`，不會因此讓 `media.manage` 變成可以繞過一般欄位編輯限制的後門。
  - `worker/test/index.test.ts`：新增一支測試——帳號權限设成「自訂」且只有 `request.create`／`request.status`／`media.manage`（刻意不給 `request.edit`，比照正式資料庫「設計師」角色範本現況）；驗證只改 `designImageFolderUrl` 會成功寫入，但接著嘗試改 `client` 欄位會被擋下、錯誤訊息是 `此帳號沒有「request.edit」權限`，證明這個放寬只精準對應到來源資料夾這個欄位，沒有擴大範圍。
- 影響功能：
  - 一般設計師打開「設計師設定」，現在只會看到、也只能編輯自己的技能／留言對話框／頭像海報／分享音樂；管理者不受影響，行為跟改之前一樣可以看到並編輯全部 6 位。
  - 設計師把案件標記為「過稿中」跳出的 NAS 路徑視窗，現在只要該帳號有 `media.manage` 權限（正式資料庫的「設計師」角色範本本來就有）就能成功儲存，不再被要求額外的 `request.edit`。案件其他欄位（狀態、項目細節以外的一般編輯）維持原本需要 `request.edit` 才能改，這次沒有放寬。
- 風險區塊：
  - 「設計師設定」這次改動是**前端過濾**，不是新增後端權限檢查——`showDesignerSettings()` 原本的 `requireAccess('designer.settings',...)` 閘門沒有變，理論上如果有人繞過前端（直接呼叫 `saveDesignerSettings` 之類的函式並偽造 DOM），後端 `designer.settings` 這個 action 本身目前設計上就是允許任何有這個能力的帳號改任一位設計師的資料（`worker/src/database-coordinator.ts` 第 552 行 `requireAccess(database,session,'designer.settings')` 沒有限制只能改自己）——這次沒有動後端這一段，因為使用者只回報「畫面上顯示了不該顯示的人」，範圍限定在前端可見性；如果之後要徹底鎖死「即使繞過前端也不能改別人」，需要另外在後端 `saveDesignerProfiles` 這個 action 加上「非管理者只能寫自己那筆」的檢查，這次沒有一併做，留在已知技術債。
  - `onlyDesignImageFolderLink` 的判斷是看「這次送出的欄位是否『只有』`designImageFolderUrl`」——如果前端未來改成把來源資料夾路徑跟其他欄位包在同一次 `update` 呼叫裡一起送出，會自動退回需要 `request.edit`，不會誤放行；反過來說也不會不小心放寬到其他欄位，因為判斷條件是嚴格的「僅有這一個欄位」而不是「包含這個欄位」。
- 已檢查／驗證方式：`index.html` 兩段 `<script>` 語法檢查（`new Function`）通過；本機靜態伺服器＋ Browser pane 直接呼叫 `visibleDesignerSettingsOptions()`／`renderDesignerSettingsForm()` 驗證：模擬非管理者登入（`currentEditorGroup='影音'`）時只回傳／只渲染自己那一筆；模擬管理者登入（`currentEditorGroup='管理者'`）時回傳／渲染全部 6 位，符合預期。Worker：`npx tsc --noEmit` 無錯、`npx vitest run` 7/7（新增的測試在套用修正前會先重現使用者回報的「權限不足」現象，套用修正後轉綠燈，且驗證了「改其他欄位仍被擋」這個沒有被過度放寬的邊界）、`wrangler deploy --dry-run` 打包成功。`node --test backend/test/*.test.mjs` 22/22（確認沒有既有測試鎖住這次改到的函式或字串）。
- 部署狀態：`index.html` 純前端，git push 後自動生效；**`worker/` 需要手動部署才會生效**（`cd worker && pnpm deploy`）——沒部署前，設計師填寫 NAS 路徑仍會遇到一樣的「權限不足」錯誤。
- commit：（見下方 push 紀錄）

### 2026-08-13 Asia/Taipei — 修正 NAS 監控程式「同一輪已抓取過」誤判導致新圖片被卡住不上傳

- 修改目的：使用者手動執行監控程式，回報「沒看到新增至雲端，前台也沒顯示」，貼出的執行 log 顯示 8 張全新圖片都正確被偵測為「新增」且產生預覽圖，但最後印出「[輪次判斷] 第 0 輪已經抓取過，略過」——完全沒有呼叫上傳。追查發現 `scanProject`／主迴圈裡有一個 `lastCapturedRound` 欄位，記錄「這個案件上次成功上傳過的輪次」，只要這次算出的 `round` 跟它相等就整輪跳過，**完全不看這次到底有沒有新的待上傳檔案**。這在同一輪內第一次上傳成功、之後設計師又陸續加了更多圖進同一個 NAS 資料夾的情境下（很常見——過稿中狀態下最初可能只放了 1 張，後續才補齊全部圖），會讓所有後補的圖永遠卡住，不管重跑幾次監控程式都不會上傳，直到案件進到下一個修改輪次為止。這個判斷邏輯本來就是多餘的：每個檔案是否已經上傳過，`assignedRound`（每個檔案各自的欄位）早就有在追蹤，`lastCapturedRound` 這層額外的整輪短路判斷只是幫倒忙。
- 影響檔案：`scripts/nas_design_image_watcher.mjs`——移除 `lastCapturedRound` 這個狀態欄位與所有讀寫（`scanProject` 的 `previousState`/`nextState` 建構、主迴圈原本 `if (round === result.nextState.lastCapturedRound)` 的短路判斷整段刪掉）。判斷「這輪要不要上傳」現在完全只看 `targetedPreviews`（篩選過的待上傳清單，見上一則「指定圖片」功能）是否為空——有東西待上傳就上傳，不管這個輪次之前是否已經上傳過別的圖片。
- 影響功能：同一輪（不管是初稿還是任何一輪修改）現在可以分批上傳——設計師先放 1 張、監控程式抓走，之後再放更多張，下次輪詢一樣會抓到，不會被「這輪抓過了」卡住。既有的去重邏輯（同一個檔案內容沒變動，不會重複上傳）完全不受影響，因為那是靠每個檔案各自的 `assignedRound`/`mtimeMs`/`size` 比對，不是靠這次刪掉的整輪層級欄位。
- 已檢查／驗證方式：`node --check` 語法檢查通過；用假 `sips`＋本機假伺服器完整重現使用者回報的情境並確認修好——第一輪只放 1 張圖，執行後正確上傳；接著再放 2 張新圖進同一個資料夾（模擬「同一輪追加圖片」），重新執行前**會先重現使用者回報的 bug**（修正前的程式碼會印出「已經抓取過，略過」、完全不上傳這 2 張新圖），套用修正後同樣情境正確印出「新增 2 個」並成功呼叫上傳；再次重跑（沒有任何新變動）正確不重複上傳（總共發生 2 次上傳呼叫，內容分別是 `img1.png` 與 `img2.png`+`img3.png`，沒有第 3 次）。`node --test backend/test/*.test.mjs` 22/22。
- 部署狀態：純本機工具檔案，不需要 git push、不需要重新部署 Worker 或 Apps Script——但**這次是我直接在使用者的 Mac 上編輯這份本機檔案**，所以已經立即生效，下次使用者手動或排程執行監控程式就會用到修正後的版本；仍然會照專案慣例把這次改動一起 commit／push 到 repo，只是使用者不需要額外做什麼才能拿到這個修正。
- commit：（見下方 push 紀錄）

### 2026-08-12 Asia/Taipei（再更晚之後又一次）— 實測發現「來源用 Drive 連結」的前提不成立，改回 NAS 路徑＋復原本機監控程式（案件清單改動態產生）

- 修改目的：上一則把「過稿中自動抓圖」的來源改成「設計師貼 Google Drive 資料夾連結」，部署後使用者用真實案件 `26080059` 實測，回報「填入資料也給了連結，後續沒有在修改列表中看到第一筆圖片的產生」。追查發現兩個問題：①使用者貼的其實是 NAS 路徑（`smb://EMCNAS_Prod.../設計部/專案企劃部/.../案件資料夾`），不是 Drive 連結；②即使是 Drive 連結，直接對 Apps Script 網址 `curl` 測試也收到 Google 的 HTML 頁面而不是 JSON，代表 Web App 部署設定當時也還沒到位。使用者當場明確表示希望的方式其實是：「設計師直接貼上 NAS 路徑（例如 `/設計部/專案企劃部/執行中/Epson/FB發文圖檔/2026/8月/260811_Epson_V4000UV印刷機發表會`），爬蟲自動判定，之前測試也抓得到資料」——這代表上一則「Worker→Apps Script 直接抓 Drive 資料夾」的整條路線，**技術前提從一開始就不成立**：Apps Script 跑在 Google 雲端沙箱，完全連不到公司內網 NAS，這不是部署設定問題，是硬限制；只有跑在使用者自己 Mac 上、對內網有連線能力的程式才碰得到 NAS，也就是回到[[2026-08-12（更晚）被刪掉的本機監控程式|更早一次被整個刪掉的 scripts/nas_design_image_watcher.mjs]]。這是同一個功能（過稿中自動記錄設計圖）**第三次調整方向**：NAS 背景監控程式（手動維護案件對照表）→ 互動式詢問 Drive 連結（Worker 直接呼叫 Apps Script）→ 這次：互動式詢問 NAS 路徑＋復原本機監控程式，但案件對照表改成從即時資料動態產生，不用再手動維護設定檔。
- 影響檔案：
  - **拆除上一則做的東西**：`worker/src/database-coordinator.ts` 移除 `syncCaseDesignImages` action 整段；`upload/Code.gs` 移除 `syncCaseDesignImagesFromFolder`、`extractDriveFolderId_`、`doPost` 對應分支；`worker/wrangler.jsonc` 移除 `UPLOAD_APPS_SCRIPT_URL`（重新跑 `wrangler types` 更新 `worker-configuration.d.ts`）；`addCaseDesignImages` 裡上一則新增的 `sourceLabel`／`draftNote` 判斷邏輯改回原本寫死的 `'NAS 自動同步'`／`'初稿完成（NAS 自動建立）'`（source 只會是 `'nas-watcher'`，不需要分支）。
  - **`upload/Code.gs`**：`uploadCaseDesignImages` 函式簽章新增 `designer`／`client`／`year`／`month`（本機監控程式算好後隨每次上傳一起傳進來），改呼叫上一則寫的 `getOrCreateNestedFolder_(root,[designer,client,year,month,caseId])` 建立巢狀目的地資料夾（這個函式本身**保留沿用**，只是換了呼叫端），刪除舊的扁平版 `getOrCreateCaseDesignImageFolder_`。
  - **`scripts/nas_design_image_watcher.mjs`／`.config.json`／`.setup.mjs`**：從 `git show 78d7320:scripts/nas_design_image_watcher.mjs` 復原（掃描/壓縮/影片截圖/去重這些已經測過能動的核心邏輯完全沒動），改造的只有「案件從哪裡來」這段：拿掉設定檔 `projects` 陣列，`main()` 改成一開始先 `fetch(dbJsonUrl)` 一次，篩出「狀態＝過稿中 且 設計圖資料夾連結非空」的案件動態組出清單；新增 `resolveCaseFolderPath(mountRoot,rawFolderPath)` 判斷使用者填的路徑開頭是否已經包含分享名稱本身（例如 `/設計部/...`）、是的話去除重複再接到 `mountRoot`；`year`/`month` 從案件的開始日期算；輪次判斷合併進同一次 fetch，不再另外發請求；上傳 payload 多帶 `designer`/`client`/`year`/`month` 四欄。`setup.mjs`（NAS 掛載偵測/自動連線）不依賴 `projects`，原封不動復原。`config.json` 拿掉 `projects`，`dbJsonUrl` 改成必填。
  - **`.gitignore`**：加回 `scripts/nas_design_image_watcher.state/`／`scripts/nas_design_image_watcher.secrets.json` 兩行。
  - **`scripts/nas_design_image_watcher.README.md`**：整份重寫，拿掉「手動維護 projects 清單」的段落，新增案件清單動態產生的說明、排程執行段落（`crontab`／`launchd` 兩種範例，呼應使用者確認要「背景定時輪詢」）、更新開通自動上傳步驟（Drive 母資料夾已完成、`uploadCaseDesignImages` 簽章改了需要重新部署 Apps Script）與已測試/未測試段落。
  - **`index.html`**：`openDesignImageFolderPrompt` 改成單純呼叫既有的 `updateCaseRow(id,{designImageFolderUrl:path},...)` 存路徑（不再呼叫任何同步 API），標題/說明文字與 placeholder 改成 NAS 路徑格式；移除 `triggerDesignImageSync` 函式整個；`confirmModificationRecord` 裡呼叫它的那一行移除（現在抓不抓得到新一輪圖片完全交給背景監控程式自己判斷輪次，前端不用主動觸發任何東西）；`openStatusEditor` 過稿中分支只保留「沒有連結時跳出視窗」，移除「已有連結就直接同步」那段。
- 影響功能：設計師標記過稿中時，如果案件還沒設定過來源資料夾，會跳出視窗要求填寫 **NAS 路徑**（不是 Drive 連結）；填了或跳過，狀態都照樣立刻改成過稿中（這個行為跟上一則一樣沒變）。真正的抓圖動作完全交給使用者 Mac 上背景執行的監控程式，每次執行會自己讀最新的案件資料庫，找出所有「過稿中且已填路徑」的案件（不用像最早那版一樣手動在設定檔逐筆維護），依輪次判斷該不該上傳、上傳到哪個 Drive 巢狀資料夾。
- 風險區塊：
  - **這是三次調整中，第一次有機會用「已知會動」的核心邏輯**——`scanProject`/`buildPreview`/影片截圖/去重這些函式，在更早一次工作中就已經用假指令+假 HTTP 伺服器測過八種情境全部正確，這次只是換了「案件從哪裡來」這一小段，核心風險比前兩次都低。但**這次同樣沒有連過真正的 NAS**，`qlmanage`/`sips` 的真實執行效果、真的把圖傳上 Google Drive、真的在 Drive 裡看到巢狀資料夾結構，都還是只能靠使用者自己在 Mac 上跑過一次才能確認——這點在三次嘗試裡完全沒有變過，是這支工具本質上的驗證邊界（Cowork/Claude Code 這個對話環境連不到公司內網，也沒有 macOS 專屬指令）。
  - **`resolveCaseFolderPath` 的「去除重複分享名稱」判斷是新邏輯**，只用假資料測過兩種情況（路徑開頭含分享名稱、路徑是純相對路徑），使用者實際貼的路徑格式如果跟這兩種假設不同（例如中間夾雜大小寫不一致的分享名稱、或路徑用反斜線），可能解析錯誤——已經用 `path.basename(mountRoot)` 做**精確字串比對**（不是模糊比對），這代表如果分享名稱大小寫或全半形跟 `mountRoot` 設定不完全一致，會判斷成「不含分享名稱」而整段當相對路徑接上去，導致路徑多一層、資料夾找不到；發生時錯誤訊息會清楚寫「找不到資料夾」而不是靜默失敗，使用者可以直接比對訊息裡印出的完整路徑看出問題在哪。
  - **`uploadCaseDesignImages` 這次改了函式簽章（新增必填的 designer/client/year/month 概念，缺的話會 fallback 成「未指定設計師」/「未分類客戶」/系統當下年月，不會整個失敗）**，代表舊版部署的 Apps Script 完全不相容，**一定要重新部署**才能用；使用者上一輪已經回報過「Apps Script 網址收到 HTML 不是 JSON」，這次的 README 新增了明確的 `curl` 驗證指令，協助使用者自己確認部署設定是否正確，而不是又要等下一次實測才發現。
- 已檢查／驗證方式：
  - `upload/Code.gs`：`node --check` 語法檢查通過；確認移除 `syncCaseDesignImagesFromFolder`/`extractDriveFolderId_`/`getOrCreateCaseDesignImageFolder_` 後沒有任何殘留呼叫（`grep` 全檔案確認）。
  - `scripts/nas_design_image_watcher.mjs`：`node --check` 語法檢查通過；用假的 `sips`／`qlmanage`（放進暫存 bin 目錄、加進 `PATH`）＋本機 Node HTTP 伺服器模擬 `dbJsonUrl`（回傳含 4 種案件：過稿中+已填路徑×2、執行中未過稿、過稿中但未填路徑）與 Apps Script 上傳端點，完整測過：案件清單正確只動態抓出 2 筆該抓的案件（另外 2 筆正確被排除）、路徑開頭含分享名稱「設計部」與純相對路徑兩種寫法都正確解析到同一層掃描目錄、影片正確產生預覽圖、第 0 輪正確上傳且上傳 payload 正確帶上 designer/client/year/month（`{"caseId":"TESTCASE1","round":0,"designer":"Machi","client":"Epson","year":"2026","month":"08",...}` 這類）、同一輪重跑正確略過不重複上傳、`修改統計表` 出現第 1 輪紀錄後重跑正確只上傳新增的那 1 個檔案（不重傳第 0 輪已經傳過的 2 個）。全部用完即刪，沒有留下任何暫存檔案在正式目錄。
  - `worker/`：`npx tsc --noEmit` 無錯、`npx vitest run` 6/6（跟拆除前後數量一致，代表沒有測試依賴被刪掉的 action）。
  - `backend/`：`node --test backend/test/*.test.mjs` 22/22。
  - `index.html`：兩段 `<script>` 語法檢查通過；本機靜態伺服器＋ Browser pane 載入真實正式站資料（全程 stub 掉 `sheetApi`，沒有真的打任何網路請求／沒有寫入任何資料）逐一驗證：沒存過路徑時標記過稿中會立刻變更狀態＋跳出視窗且文案/placeholder 已改成 NAS 路徑格式、送出後正確呼叫既有的 `update` action（沒有呼叫任何已刪除的 sync action）、已存過路徑時標記過稿中只呼叫狀態更新、不再跳出視窗（因為現在完全交給背景監控程式處理，不需要前端主動同步）。
- 部署狀態：
  - `backend/schema.mjs`（沿用既有欄位，這次沒改）、`index.html`、`.gitignore`、`scripts/nas_design_image_watcher.*`、`CLAUDE.md` 純前端／本機工具檔案，git push 後自動生效／本機直接可用。
  - `worker/` 這次由我在使用者的 Mac 上直接執行 `wrangler deploy` 完成部署（不需要重設 `NAS_WATCHER_API_KEY`，沿用上一輪已經設定好的值）。
  - `upload/Code.gs` 仍然只能使用者手動部署——這次 `uploadCaseDesignImages` 簽章改了，**一定要重新部署**新版本才會生效；部署後請用 README 裡新增的 `curl` 指令自行驗證有沒有收到 JSON（不是 Google 登入/警告頁面）。
  - `scripts/nas_design_image_watcher.*` 純本機工具，需要使用者在自己 Mac 上執行或排程（README 新增了 `crontab`／`launchd` 兩種排程範例），我這裡連不到公司內網 NAS，沒辦法代為執行或驗證。
- commit：（見下方 push 紀錄）

### 2026-08-12 Asia/Taipei（再更晚之後）— 過稿中改成互動式詢問來源資料夾連結，取代前一則的 NAS 背景監控程式方向

- 修改目的：上一則「NAS 資料夾監控程式」是根據使用者當時在另一個對話（Codex/「project」）討論出的規劃寫的，本機已經 commit（`78d7320`）但尚未 push。這次使用者直接在本對話重新描述了實際想要的流程，經追問確認後發現跟已寫好的版本方向不同：不是背景程式每 5-10 分鐘輪詢、案件要先在設定檔手動維護「案件編號→NAS路徑」對照表，而是**設計師把案件狀態改成「過稿中」時，即時跳出視窗詢問該案件的設計圖來源 Google Drive 資料夾連結**，系統依此抓圖／截圖上傳「第一版」；之後每次設計師在修改紀錄按「確認」，系統用同一個來源連結自動抓一批新圖歸到新的一輪。跟使用者逐項確認三個關鍵決定：①來源資料夾連結是設計師手動貼上（系統不會自動猜工作資料夾在哪）；②目的地資料夾（依 設計師/客戶別/年度/月份/案件編號 分類存放）完全由系統自動算路徑、自動建立，不問；③案件狀態改成「過稿中」這個核心操作不能被擋——沒填來源連結就先跳過抓圖，狀態照樣改，之後可以再補。
- 影響檔案：
  - **移除**：`scripts/nas_design_image_watcher.mjs`／`.config.json`／`.README.md`／`.setup.mjs`（上一則新增、方向不符的本機監控程式，本機沒有正式跑過就作廢了）；`.gitignore` 移除對應兩行、`scripts/nas_design_image_watcher.state/`／`.secrets.json` 一併刪除（本來就沒進 git 的本機檔案）。
  - `backend/schema.mjs`：`DATABASE_HEADERS` 新增 `設計圖資料夾連結` 欄位，存每個案件的來源 Drive 資料夾連結（跟「補充資料連結」表的 A-D 是不同東西，這個直接放在 `database` 表本身，因為前端 `rows` 陣列本來就會整份載入 `database` 表，不用另外發一次請求才能判斷「這個案件是否已經設定過來源連結」）。
  - `worker/src/model.ts`：`KEY_TO_HEADER` 新增 `designImageFolderUrl:'設計圖資料夾連結'` 映射（`toApiRow`/`toSheetRow` 都是靠這個表泛用產生，不用另外改）。
  - `worker/src/database-coordinator.ts`：新增 `syncCaseDesignImages` action（設計師觸發、`media.manage` 權限即可）——找案件 row、沒帶連結就讀已存的、都沒有就丟錯；沒帶輪次就自動抓「修改統計表」目前最大修改次數；算出 designer/client/year/month；`fetch` 呼叫 Apps Script Web App 的新 action `syncCaseDesignImagesFromFolder`，把結果原樣回傳給前端。既有的 `addCaseDesignImages` action 保留不動（新流程一樣靠它把圖片網址寫進「修改統計表」），只把裡面寫死的「NAS 自動同步」／「初稿完成（NAS 自動建立）」文字改成依 `source` 判斷（新流程傳 `source:'drive-folder-link'` 時顯示「設計圖資料夾同步」，避免文案錯誤地寫著「NAS」）。
  - `worker/wrangler.jsonc`：`vars` 新增 `UPLOAD_APPS_SCRIPT_URL`（值＝`index.html` 裡本來就公開的 `designerUploadPageUrl` exec 網址，非敏感資料）；跑過 `npx wrangler types` 重新產生 `worker/worker-configuration.d.ts`（這次是在使用者自己的 Mac 上跑的，不像上一則卡在 Linux 沙箱只能手動補型別）。
  - `upload/Code.gs`：`doPost` 新增 `syncCaseDesignImagesFromFolder` 分支；新增同名函式——驗證既有的 `NAS_WATCHER_API_KEY` 服務金鑰、從連結解析來源資料夾 ID、用新的 `getOrCreateNestedFolder_()` 依 設計師/客戶別/年度/月份/案件編號 建立巢狀目的地資料夾、掃來源資料夾（圖片直接複製，影片用 `file.getThumbnail()` 當截圖，這個做法不需要本機任何影片處理工具，比上一則規劃的本機 `qlmanage` 簡單很多）、用複製後檔案的 `description` 欄位記來源檔案 ID 避免重複複製、全部處理完呼叫既有的 `callMainAppJsonAction_('addCaseDesignImages',...)` 寫回。順手把 `CASE_DESIGN_IMAGE_ROOT_FOLDER_ID` 與 `doPost` 附近的註解裡「NAS 監控程式」字樣改成通用說法。
  - `index.html`：`normalizeRow` 新增 `designImageFolderUrl` 欄位解析；`openStatusEditor` 選到「過稿中」且原本狀態不是過稿中時，狀態照舊立刻更新（不擋），接著依有沒有存過來源連結，分別呼叫新函式 `triggerDesignImageSync(id)`（直接同步）或 `openDesignImageFolderPrompt(id,anchorEl)`（跳小視窗問連結，取消或關閉視窗就什麼都不做）；`confirmModificationRecord` 的「確認」成功分支（不含「取消確認」那條路）額外用 `{silent:true}` 觸發一次同步，同步結果只在真的抓到新圖時才提示、沒抓到或出錯都安靜略過，不會蓋掉「已確認修正完成」的成功訊息；案件詳情面板新增「設定/重新設定 設計圖來源資料夾」入口（`media.manage` 權限可見），供一開始跳過或想換連結的人事後補設定。
  - `CLAUDE.md`：這則紀錄本身。
- 影響功能：設計師把案件標記過稿中，或針對已標記過稿中案件按下修改紀錄的「確認」，會觸發抓取來源 Drive 資料夾裡的新圖片／影片截圖，整理進系統自動建立的巢狀 Drive 資料夾，並記錄進「修改統計表」（沿用既有的圖片連結/來源/更新時間三欄與案件詳情彈窗縮圖顯示，都在上一則已經做過，這次沒有再改）。核心的案件狀態變更與「確認修正日」寫入完全不受這個新流程影響——就算 Apps Script 那端還沒部署好、同步整個失敗，狀態照樣改得動、確認照樣按得下去，只是抓不到圖。
- 風險區塊：
  - **這次改動全部在使用者自己的 Mac 上完成，`worker/` 的 `npx tsc --noEmit`／`npx vitest run`（6/6）／`npx wrangler deploy --dry-run` 都是真的執行過、不是像上一則那樣因為 Linux 沙箱只能人工比對**——這點跟上一則的最大差異，型別與既有測試這塊的可信度高很多。
  - **`upload/Code.gs` 這端完全沒有真正呼叫過 Google Drive API**，只能做到 `node --check` 語法檢查；`syncCaseDesignImagesFromFolder` 裡巢狀資料夾建立、影片縮圖 (`getThumbnail()`)、`description` 欄位去重這幾段邏輯純靠人工比對既有 `uploadCaseDesignImages`／`getOrCreateCaseDesignImageFolder_` 的寫法推導，尤其 `getThumbnail()` 拿不拿得到縮圖（Drive 需要一點時間才會產生影片縮圖，剛上傳的影片可能還沒有）完全沒有實測過，只在程式碼裡用「拿不到就跳過、記警告」防呆，不會讓整批同步失敗。
  - **Worker→Apps Script 這段 `fetch` 是全新的機制**（之前系統一直是 Apps Script 主動打 Worker，這是第一次反過來），`worker/src/database-coordinator.ts` 的 `syncCaseDesignImages` action 只能用 vitest 既有的 6 個測試跑過、**沒有新增專門測試這個 action 的案例**（既有測試沒有 mock `UPLOAD_APPS_SCRIPT_URL` 這個 fetch 目標，倉促加會需要重新設計 test harness，這次先靠人工比對程式碼與型別檢查，之後有空應該補一個 mock fetch 的測試案例）。
  - **前端互動邏輯有實測**：用本機靜態伺服器＋ Browser pane 直接載入 `index.html`（讀到的是使用者本機真實的 `backend/data/db.json`，用真實案件資料測試，但全程 stub 掉 `sheetApi`，沒有真的打任何網路請求、沒有寫入任何資料），逐一驗證：沒存過連結時彈出視窗、視窗送出網址後正確帶 `folderLink` 呼叫 `syncCaseDesignImages`、按「先跳過」正確不呼叫任何 API 也不影響已經改好的狀態、已存過連結時直接同步不跳視窗、`confirmModificationRecord` 成功後有另外觸發一次同步、同步找到 0 張或出錯時 silent 模式正確不覆蓋掉確認成功的訊息、案件詳情面板依有無連結正確顯示「設定來源資料夾」或「重新設定資料夾」。**沒有測到的**：真正登入後的權限判斷（`requireAccess`/`accessAllowed` 全程用 stub 回傳 true，沒有測過真的沒有 `media.manage` 權限時的行為，雖然邏輯上跟既有的 `openDesignerUploadPage` 完全同一套寫法，風險低）。
  - **`designImageFolderUrl` 這個新欄位目前完全沒有資料**——所有既有案件的「設計圖資料夾連結」都是空字串，代表**第一次**幫任何案件標記過稿中，一定會跳出詢問視窗（這是設計上刻意的行為，不是 bug）。
- 已檢查／驗證方式：見上方「影響檔案」與「風險區塊」逐項說明；額外執行 `node --test backend/test/*.test.mjs`，22/22 全過（新增的 `設計圖資料夾連結` 欄位沒有被任何既有測試鎖住，已先用 `grep` 確認過)。
- 部署狀態：
  - `backend/schema.mjs`、`index.html`、`.gitignore`、`CLAUDE.md` 純前端／共用檔案，git push 後自動生效（`backend/schema.mjs` 同時被 Worker 引用，但 Worker 執行的是**部署當下**打包進去的版本，要另外 `wrangler deploy` 才會生效）。
  - `worker/` 這次由我在使用者的 Mac 上直接執行 `wrangler secret put NAS_WATCHER_API_KEY`（產生隨機值，同一組值需要你貼進 Apps Script 指令碼屬性，見下）＋ `wrangler deploy` 完成部署，不像過去幾則卡在沒有 wrangler CLI 只能留給使用者手動做。
  - `upload/Code.gs` 仍然只能你手動部署（Apps Script 部署一定要在編輯器裡手動做，我沒有 Google 帳號權限可以自動化這件事）——部署新版 `upload/Code.gs` 前，還需要你：①去 Google Drive 建立「案件設計圖」母資料夾、把 ID 貼進 `CASE_DESIGN_IMAGE_ROOT_FOLDER_ID`；②把部署時我給你的 `NAS_WATCHER_API_KEY` 值貼進 Apps Script「專案設定→指令碼屬性」；③部署→管理部署→新版本，確認 Web App 存取權是「任何人」。這三步做完前，設計師跳出視窗貼上連結送出後會收到清楚的錯誤訊息（不是看起來成功但其實沒用）。
- commit：（見下方 push 紀錄）

### 2026-08-12 Asia/Taipei（再更晚）— 「過稿中」自動記錄設計圖：修改統計表加圖片欄位、Worker/Apps Script 新增服務端上傳 API、NAS 監控程式接上影片截圖＋壓縮＋輪次判斷＋上傳、案件修改紀錄彈窗顯示縮圖

- 修改目的：延續前面幾則 NAS 監控程式的紀錄，使用者說明完整流程規劃——PM 填單指定案件→發信→設計師執行並填狀態/項目細節→設計師完成後改狀態為「過稿中」。使用者要求在「過稿中」這個時間點自動記錄設計師完成的圖，顯示在案件上、並依「初稿/一修/二修…」分輪次追蹤；後續追加需求：(1) 影音案件要能擷取畫面當紀錄，(2) 大檔案/多圖要能自動轉小檔案存。討論後使用者選定：圖片來源走「自動從 NAS 資料夾抓」（而非設計師手動上傳），且需要支援每輪多張圖。
- 影響檔案：
  - `backend/schema.mjs`（`修改統計表` 新增 `圖片連結`／`圖片來源`／`圖片更新時間` 三個欄位；這份 schema 同時是 Worker `worker/src/model.ts` 的匯入來源，改一處兩邊都吃到）。
  - `worker/src/database-coordinator.ts`（新增 `addCaseDesignImages` action）、`worker/wrangler.jsonc`（`secrets.required` 加 `NAS_WATCHER_API_KEY`）、`worker/worker-configuration.d.ts`（手動補上 `NAS_WATCHER_API_KEY` 型別，因為這台機器跑不了 `wrangler types`）、`worker/README.md`（補上新 secret 的說明與設定指令）。
  - `upload/Code.gs`（新增 `doPost(e)`、`uploadCaseDesignImages()`、`verifyNasWatcherServiceKey_()`、`getOrCreateCaseDesignImageFolder_()`、新常數 `CASE_DESIGN_IMAGE_ROOT_FOLDER_ID`／`MAX_CASE_DESIGN_IMAGES_PER_REQUEST`；`callMainAppJsonAction_()` 放寬成同時接受 `editorToken` 或 `serviceKey`）。
  - `scripts/nas_design_image_watcher.mjs`（整支重寫：辨識圖片/影片副檔名、`qlmanage` 截影片畫面、`sips` 壓縮轉 JPEG、讀 `dbJsonUrl` 判斷案件輪次、呼叫 Apps Script 上傳）、`scripts/nas_design_image_watcher.config.json`（新增 `dbJsonUrl`／`appsScriptUploadUrl`／`secretsFile`／`maxDimension`／`jpegQuality`／`previewDir`）、新增 `scripts/nas_design_image_watcher.secrets.json`（放 `serviceKey`，已加進 `.gitignore`）、`scripts/nas_design_image_watcher.README.md`（改寫，新增「開通自動上傳需要做的四步」與設定欄位對照表）、`.gitignore`（新增忽略 `scripts/nas_design_image_watcher.secrets.json`）。
  - `index.html`（`normalizeModificationRecord` 解析 `圖片連結` 成 `images` 陣列；`modificationLabel(0)` 從顯示「修改」改成顯示「初稿」；`revisionControl()` 判斷條件從「`count<=0`」改成「有沒有任何修改紀錄」，讓只有第 0 輪（初稿、count 仍是 0）的案件也會顯示可點擊的圓標，不會被誤判成「沒有修改紀錄」而顯示新增按鈕；新增 `revisionImagesHtml()`／`parseRecordImages()`；`renderRevisionModal()` 每筆紀錄下方多顯示縮圖列；新增 `.revision-modal-images` 樣式與深色模式覆蓋）。
- 影響功能：
  - **輪次判斷邏輯**（寫在監控程式裡，不是後端）：監控程式每次掃描時額外讀一次案件資料庫（`dbJsonUrl`），只有案件目前「狀態」＝過稿中時才會觸發上傳；上傳輪次＝該案件目前「修改統計表」裡最大的「修改次數」（沒有任何修改紀錄時＝0＝初稿）。每個檔案在本機狀態快取裡有 `assignedRound`（已歸類到哪一輪，null＝待歸類），只有「待歸類」的檔案會被打包上傳，上傳成功後才標記成該輪，避免案件在過稿中狀態下重複執行監控程式時重複上傳同一批圖。這代表：設計師按下「過稿中」到圖片真的出現在系統裡，會有監控程式的輪詢間隔（README 建議 5-10 分鐘），不是即時的。
  - **第 0 輪（初稿）刻意標記為「已確認」**：Worker 的 `addCaseDesignImages` 建立新的第 0 輪紀錄時，直接把「確認修正日」填成當下時間（其餘輪次維持空白、照原本「設計師手動確認」流程）。這是為了不讓初稿紀錄被前台既有的「新修改需求」待處理通知邏輯（`hasPendingModification`／`modifyItems`，判斷依據是「確認修正日是否為空」）誤判成一筆還沒處理的修改請求——初稿本身就代表「已完成」，不是待辦事項。
  - **服務端驗證**：`addCaseDesignImages` 與 `uploadCaseDesignImages` 都認一把獨立的 `NAS_WATCHER_API_KEY`，跟現有的 `ADMIN_LOGIN_PASSWORD`（管理者密碼登入）完全分開、不共用——監控程式的設定檔外流不會連帶洩漏管理者密碼；反過來也不會因為要讓監控程式能寫入，就把它綁定到某個真人帳號的登入 session。有登入 session 且具備 `media.manage` 權限的人也可以呼叫 `addCaseDesignImages`（手動補寫），兩條路徑並存。
  - **圖片只存壓縮預覽，母檔不動**：不管是設計原始檔還是影片，NAS 上的母檔完全不會被搬動或複製一份大的進系統，監控程式只會另外產生一張 JPEG 預覽圖（預設最長邊 1600px、品質 70）上傳，符合 `upload/Code.gs` 既有 `MAX_FILE_SIZE_MB=10` 的限制，也是這次要解決的「大檔案/多圖」問題的做法。
  - **案件修改紀錄彈窗**：`renderRevisionModal()` 現在只要案件有任何一筆修改紀錄（含第 0 輪初稿）就會顯示可點擊圓標；點開後每一輪除了原本的日期/修改人/內容，多一排縮圖，點縮圖會在新分頁開啟 Drive 原圖。
- 風險區塊：
  - **Worker／Apps Script 這兩個檔案的修改完全沒有經過編譯器或測試框架驗證**——這台機器的 `worker/node_modules` 是在 macOS（darwin-arm64）安裝的，這次工作環境是 Linux 沙箱，執行 `wrangler types`／`tsc --noEmit`／`vitest run` 全部因為原生執行檔平台不合而直接報錯（`Unable to resolve @typescript/typescript-linux-arm64` 之類），且 `worker/node_modules` 是即時掛載到你電腦的資料夾、不是隔離副本，我刻意沒有嘗試在這裡重裝套件，避免把 Linux 版的執行檔覆蓋進你本機的 macOS 開發環境、弄壞你平常在 Mac 上跑 `pnpm test`/`pnpm deploy` 的能力。`database-coordinator.ts` 新增的 `addCaseDesignImages` 區塊是嚴格比照同檔案裡已經在跑的 `addModificationRecord`／`upsertDesignerStories` 寫法（同樣的 `let row=rows.find(...); if(!row){row={...};rows.push(row)}` 慣用法、同樣的 `Row=Record<string,unknown>` 寬鬆型別），型別上應該吃得過，但**部署前一定要在你自己的 Mac 上跑過 `cd worker && pnpm test && pnpm check && pnpm deploy:dry` 確認真的沒有編譯錯誤**，這件事我沒辦法幫你做。
  - **NAS 監控程式的「影片截圖／壓縮」核心指令沒有測過真正效果**：測試時 `sips`／`qlmanage` 都換成只做「複製檔案」的假指令，用來驗證程式呼叫指令的參數、找輸出檔案、失敗時的容錯（略過＋記警告，不中斷整個掃描）這些「控制流程」是對的，但真正的截圖畫質、壓縮效果、少見影片格式會不會被 `qlmanage` 拒絕，完全沒驗證，需要你在 Mac 上拿真實檔案跑一次。
  - **`upload/Code.gs` 的 `doPost` 需要正確的部署設定**：Web App 部署設定「具有存取權的使用者」必須是「任何人」，這件事我沒辦法從這裡檢查或修改（Apps Script 部署設定要在 Apps Script 編輯器裡手動確認），README 已經寫清楚，但這是「有沒有正確依照文件操作」的風險，不是我能驗證的。
  - **`CASE_DESIGN_IMAGE_ROOT_FOLDER_ID` 目前是空字串**，故意留空、沒有自動建立 Drive 資料夾——我沒有 Google 帳號權限可以操作你的 Drive，這一步必須由你手動建資料夾、貼 ID 進去，沒填的話 `uploadCaseDesignImages` 會直接丟錯擋下，不會誤傳到不對的地方。
  - **`revisionControl()` 判斷條件改變**：原本「count<=0 就顯示新增按鈕」的邏輯，現在改成「完全沒有任何紀錄才顯示新增按鈕」。這代表如果某天資料庫裡意外出現一筆 `修改次數` 是非數字或負值、又被 `normalizeModificationRecord` 正規化成 0 的髒資料，畫面上會出現一個「初稿」圓標而不是新增按鈕——這在正常操作流程下不會發生（修改次數只會由 Worker 從 1 開始遞增，或由 NAS 監控程式寫入 0），只有資料被外部工具直接改壞時才會出現，風險評估為低。
- 已檢查／驗證方式：
  - `backend/schema.mjs` 改完後 `node --test backend/test/*.test.mjs` 22/22 全過。
  - `worker/src/database-coordinator.ts` 只能人工比對既有寫法＋讀 `Row`/`ApiPayload` 型別定義確認邏輯合理，**編譯器完全沒有驗證過**（見風險區塊）。
  - `upload/Code.gs`：複製成 `.js` 副檔名後用 `node --check` 語法檢查通過（V8 runtime 與 Node 語法高度相容，可以檢查語法錯誤，但檢查不到 `DriveApp`/`PropertiesService` 這些 Apps Script 專屬全域物件的用法對不對）。
  - `scripts/nas_design_image_watcher.mjs`：`node --check` 語法檢查通過；用假的 `sips`／`qlmanage`（放進暫存 bin 目錄、加進 `PATH`）＋本機 Node HTTP 伺服器模擬 `dbJsonUrl` 與 Apps Script 上傳端點，完整測過八種情境（詳細列在 `scripts/nas_design_image_watcher.README.md` 的「已測試／未測試」小節）：狀態未過稿中不上傳、過稿中觸發第 0 輪上傳且只打包待歸類檔案、同輪重跑會略過不重複上傳、新一輪修改請求出現後只上傳該輪新增檔案（不重傳前一輪）、查無案件編號正確略過、缺 `qlmanage` 時影片正確略過並記警告但圖片仍正常上傳、服務金鑰錯誤時上傳正確失敗、金鑰修正後重跑能補上傳前次失敗的檔案。全部用完即刪，沒有留下任何暫存檔案在正式目錄。
  - `index.html`：抽出兩個 `<script>` 區塊用 `new Function(code)` 做語法檢查，皆通過；`node --test backend/test/*.test.mjs` 確認沒有任何既有測試字串比對鎖住這次改到的函式（`modificationLabel`／`revisionControl`／`renderRevisionModal`／`normalizeModificationRecord` 均未被鎖）。**沒有在真實瀏覽器裡實際點開修改紀錄彈窗看縮圖排版**，只靠人工比對 HTML 字串與既有 CSS 慣例。
- 部署狀態：
  - `backend/schema.mjs`、`index.html`、`.gitignore` 屬於純前端／共用 schema，git push 後自動生效（`backend/schema.mjs` 同時被 Worker 引用，但 Worker 執行的是**部署當下**打包進去的版本，不會因為 GitHub Pages 更新就自動跟著變，一定要重新 `wrangler deploy` 才會生效）。
  - `worker/` 需要手動部署：先 `wrangler secret put NAS_WATCHER_API_KEY`，再 `pnpm test && pnpm check && pnpm deploy:dry` 確認過關後 `pnpm deploy`——在這之前，`addCaseDesignImages` 這個 action 在正式站完全不存在，監控程式的上傳呼叫會全部失敗。
  - `upload/Code.gs` 需要手動部署新版本，且要先在 Drive 建母資料夾填入 `CASE_DESIGN_IMAGE_ROOT_FOLDER_ID`、在 Apps Script 指令碼屬性設定 `NAS_WATCHER_API_KEY`、確認 Web App 部署設定「具有存取權的使用者」是「任何人」——四個條件缺一，`doPost` 呼叫都會失敗或被導去 Google 登入頁。
  - `scripts/nas_design_image_watcher.*` 是純本機工具，不需要 git push、不需要部署 Worker 或 Apps Script 就能先用「只掃描」模式；要用到「自動上傳」模式，前提是上面 Worker／Apps Script 兩段都已經部署完成，並把 `appsScriptUploadUrl`／`serviceKey` 填進監控程式的設定檔／密鑰檔。
  - 這次全部改動尚未 commit（本機檔案異動，累積了這個 session 從「規劃流程」到「完整實作」的所有變動）。
- commit：（尚未提交，本機檔案異動）

### 2026-08-12 Asia/Taipei（更晚之後）— NAS 監控程式新增自動設定腳本（自動掛載偵測＋寫回設定檔）

- 修改目的：使用者手動照 README 一步步連 NAS、改設定檔覺得麻煩，要求「轉成 code 自動幫我設定」。
- 影響檔案：新增 `scripts/nas_design_image_watcher.setup.mjs`；`scripts/nas_design_image_watcher.config.json` 新增 `smbUrl`／`expectedVolumeName` 兩個欄位；`scripts/nas_design_image_watcher.README.md` 改成「快速執行（自動設定）」在前、「手動設定（自動失敗時才需要）」在後，並更新已測試/未測試段落。沒有改動 `nas_design_image_watcher.mjs` 本體的掃描邏輯。
- 影響功能：新腳本 `nas_design_image_watcher.setup.mjs` 執行流程——(1) 用 `fs.stat`/`fs.readdir` 檢查 `/Volumes/<expectedVolumeName>` 是否已掛載，也會抓 macOS 重複掛載時常見的 `-1`/`-2` 後綴；(2) 沒掛載就用 `execSync('open "<smbUrl>")` 呼叫 Finder 開啟連線視窗，之後每 2 秒輪詢一次、最多等 60 秒；(3) 偵測到掛載路徑後，若跟設定檔目前的 `mountRoot` 不同就自動改寫並存檔（用 `JSON.stringify(config,null,2)` 整份重寫，會連帶正規化格式，但欄位內容不變）；(4) 最後用 `spawnSync` 呼叫既有的 `nas_design_image_watcher.mjs --config <同一份設定檔>` 執行掃描，掃描的輸出直接透過 `stdio:'inherit'` 顯示在同一個終端機視窗，不用使用者再手動下第二個指令。
- 風險區塊：**這支腳本沒辦法、也不應該幫使用者輸入 SMB 帳號密碼**——`open smb://...` 只是觸發 macOS 原生的連線流程，如果 Keychain 沒存過密碼，還是會跳出系統的帳密輸入視窗，需要使用者手動完成；這是刻意的設計決定，不是還沒做完的功能，避免把密碼寫進任何腳本或設定檔。另外自動改寫 `mountRoot` 這一步是**整份 JSON 重新格式化後寫回**，如果使用者手動在設定檔裡加了其他這支程式看不懂的欄位、或是不合法的縮排/註解，會在這次執行時被正規化掉（不會遺失欄位本身，只是格式跟原本手動編輯的可能不一樣）。`open` 是 macOS 專屬指令，這支腳本理論上不能在 Windows/Linux 上執行，README 已註明「只能在 macOS 上執行」。
- 已檢查／驗證方式：`node --check` 語法檢查通過；用 `/tmp` 假的 `/Volumes` 路徑（把腳本裡的 `/Volumes` 字串暫時替換成測試路徑跑，驗證完刪除，沒有動到正式檔案）完整測過三種情境並確認輸出與檔案內容都正確——(1) 已掛載但 `mountRoot` 是舊的錯誤路徑，執行後正確偵測到掛載路徑並自動改寫 `mountRoot`、緊接著自動跑完掃描並列出新增的圖檔；(2) 掛載名稱帶 `-1` 後綴（模擬 macOS 重複掛載同一分享的情況）仍正確抓到；(3) `mountRoot`已經正確時重新執行，正確顯示「已經是最新的，不用更新」、不會重複寫檔。跑過 `node --test backend/test/*.test.mjs`，這次新增沒有影響既有 22 個測試（22/22 全過）。**未做的驗證：「呼叫 Finder 開啟連線視窗＋等待掛載完成」這一段完全沒測過**——`open` 是 macOS 專屬指令，沙箱是 Linux 沒有這個指令也沒有 `/Volumes`，這段行為（包含帳密視窗會不會正確跳出、輪詢等待的時機是否足夠）只能靠使用者在自己 Mac 上實際跑過一次才能確認。
- 部署狀態：純本機工具，不需要 git push、不需要部署 Worker 或 Apps Script；使用者需要在自己的 Mac 上手動執行 `node scripts/nas_design_image_watcher.setup.mjs`。尚未 commit（本機檔案異動，跟上一則「掃描階段」是同一批還沒提交的變動）。
- commit：（尚未提交，本機檔案異動）

### 2026-08-12 Asia/Taipei（更晚）— 新增 NAS 設計圖檔監控程式（掃描階段，尚未接上傳）

- 修改目的：使用者要規劃「案件設計圖片追蹤」功能——依案件指定公司內網 NAS 資料夾，自動找出資料夾裡最新的 `*.jpg`/`*.png`，未來要備份進後台資料庫。這次先做「掃描＋偵測新檔」這一步，確認可以在使用者的環境穩定運作，上傳到 Google Drive／寫入後台資料庫的部分還沒做。
- 影響檔案：新增 `scripts/nas_design_image_watcher.mjs`、`scripts/nas_design_image_watcher.config.json`、`scripts/nas_design_image_watcher.README.md`；`.gitignore` 新增一行忽略 `scripts/nas_design_image_watcher.state/`（本機狀態快取，不進 git）。沒有動到任何既有正式檔案（`index.html`、`worker/`、`upload/Code.gs`、`google_apps_script.gs` 皆未修改）。
- 影響功能：目前完全不影響正式站——這支程式是獨立的本機工具，不會被前台/後台/Worker 呼叫到。
  - `nas_design_image_watcher.mjs`：讀設定檔裡每個案件的 NAS 資料夾路徑（相對於掛載根目錄 `mountRoot`），遞迴掃描找出 jpg/png，跟本地狀態快取（`mtimeMs`＋`size`，`useHash:true` 時再加 MD5）比對，列出新增/有變動/未變動的檔案，掃完把最新狀態寫回快取。資料夾不存在時回傳清楚的錯誤訊息與非 0 結束碼，不會讓程式默默沒反應。
  - `nas_design_image_watcher.config.json`：範例設定，`mountRoot` 先填 `/Volumes/設計部`（假設 SMB 分享名稱是「設計部」），`projects` 目前只有使用者給的那個 Epson 案件路徑一筆，`caseId` 先用資料夾名稱佔位（之後要換成資料庫裡真正的案件編號）。
  - `nas_design_image_watcher.README.md`：完整的使用前準備（Finder 連線正確網址、確認掛載路徑、調整設定檔）、執行方式、已測試/未測試範圍，以及還沒做的四個下一步（Apps Script 上傳、Worker 新資料表、前台時間軸、排程執行）。
- 風險區塊：**這支程式無法在 Cowork（這次對話的執行環境）裡連到公司內網**——已實測確認 Cowork 的 shell 是隔離在 Anthropic 雲端的 Linux 環境，沒有 `/Volumes`、沒有 `smbclient`、對內網主機 ping 不通。這代表「掃描邏輯本身正不正確」我已經用假資料夾測過，但「連得到、連得對使用者實際的 NAS」完全沒有驗證，必須由使用者在自己的 Mac 上實際執行一次才知道。另外使用者提供的原始路徑寫的是 `smb://EMCNAS_Prod._smb._tcp.local/...`，這是 Bonjour 服務廣播格式、不是可連線的位址，README 裡特別註明要改用 `smb://EMCNAS_Prod.local/設計部` 連線，這點也還沒有實際驗證是否正確（正確的主機名稱/IP 需要使用者確認）。
- 已檢查／驗證方式：`node --check` 語法檢查通過；用 `/tmp` 底下的假資料夾＋假圖檔完整跑過四種情境並確認輸出正確——(1) 第一次執行 3 張圖全部判定為「新增」、(2) 沒有變動時重新執行顯示「未變動 3 張、沒有新增或變動」、(3) 修改其中一張圖片內容後重新執行正確判定該檔「更新」且只有 1 張、(4) 指到不存在的資料夾時正確顯示錯誤訊息並回傳非 0 結束碼。跑過 `node --test backend/test/*.test.mjs` 確認這次新增沒有影響既有 22 個測試（22/22 全過），且事先 grep 過 `backend/test/backend.test.mjs` 確認沒有任何斷言鎖住 `scripts/` 目錄的檔案清單或 `.gitignore` 內容。**未做的驗證：完全沒有連過真正的 NAS，中文路徑在真實 SMB 掛載下的行為、Bonjour 位址是否正確、案件與資料夾的對應方式都还没有跟使用者確認。**
- 部署狀態：純本機工具，不需要 git push、不需要部署 Worker 或 Apps Script；使用者需要在自己的 Mac 上手動執行 `node scripts/nas_design_image_watcher.mjs` 才會運作。尚未 commit（本機檔案異動）。
- commit：（尚未提交，本機檔案異動）

### 2026-08-12 Asia/Taipei（稍晚）— 沒有發信／編輯權限時整欄隱藏，不留空白直欄

- 修改目的：接續上一則，使用者回饋「如果是隱藏發信與編輯按鈕，乾脆整欄位直接隱藏」——原本只是 `mailAction()` 回傳空字串，欄位與表頭還在，畫面上留下一排空格子。
- 影響檔案：`index.html`。
- 影響功能：
  - 新增 `canSendMailNow()`／`canEditCasesNow()` 兩個判斷（分別對應 `request.mail` 與 `request.edit`，後者沿用 `canCaseEditRow()` 原本的 `hasDesignerAccountRole()` fallback）與 `allowedColumns(list)` 過濾器：欄位定義可加一個 `visible:()=>...`，回傳 false 就整欄不產生。
  - 三張表都套用（**這三張各自有一套欄位定義，只改一處會漏**）：
    1. 主案件列表的 `columns`：`subject`（信件）、`actions`（內容）；過濾點在 `orderedColumns()`，所以表頭、儲存格與「欄位設定」浮窗的勾選項目會一起消失——沒有權限的欄位不該還能被勾出來。
    2. 最新案件列表的固定欄：`modifyFixedColumns` 改名為 `modifyFixedColumnsAll`，新增同名函式 `modifyFixedColumns()` 回傳過濾後的結果，四個呼叫點改成呼叫函式。
    3. 專案負責人案件清單：`ownerProjectColumns` 同樣改名為 `...All` ＋ 同名函式。
  - 最新案件列表的固定表格在兩欄都沒權限時 `fixedWidth` 會是 0，另外加上 `fixedTable.hidden=fixedWidth===0`，整張表收起來，不留一條 0 寬度的空白直欄。
- 風險區塊：`visibleColumns`（使用者自訂的欄位顯示設定）仍可能存有 `subject`／`actions`，但 `orderedColumns()` 現在先過濾權限再比對，所以存在 localStorage 或帳號設定裡的舊值不會讓欄位重新出現；反過來說，**使用者被拿掉權限再加回來時，欄位會依照他原本的顯示設定自動回來**，不需要重設。
- 已檢查／驗證方式：1280×800 iframe 內 stub `accessAllowed`，四種組合（皆有／無發信／無編輯／皆無）逐一確認三張表的欄位清單都正確增減。再用本機管理者 session 實際登入後 `render()`：有權限時表頭出現「信件／內容」且欄位設定浮窗列出兩個勾選項；把兩個權限都關掉後，**表頭完全找不到信件與內容、欄位設定浮窗也不再列出它們**；最新案件固定表格由「不隱藏／寬 152px／2 個表頭」變成「隱藏／寬 0px／0 個表頭」，只關發信時則是「不隱藏／寬 76px／1 個表頭」。`node --test backend/test/*.test.mjs` 22/22。**未做的驗證：沒有用真實的無權限帳號登入正式站確認。**
- 部署狀態：純前端，git push 後自動生效。
- commit：`(見 push 紀錄)`

### 2026-08-12 Asia/Taipei — 新增「發送信件」權限開關＋帳號選單加入短網址工具

- 修改目的：使用者要求 (1) 權限設定的「設計需求」群組新增「發送信件」開關，對應前台的「發信」功能；(2) 「短網址工具」有頁面權限但前台沒有入口，要在帳號下拉選單加連結。
- 影響檔案：`assets/access-control.js`、`worker/src/model.ts`、`backend/app.mjs`、`index.html`、`CLAUDE.md`。
- 影響功能：
  - **新權限 `request.mail`「發送信件」**：加進三份必須同步的清單——`assets/access-control.js` 的 `CAPABILITY_CATALOG`（設計需求群組，排在匯出 CSV 之後）、`worker/src/model.ts` 的 `ACCESS_CAPABILITIES`、`backend/app.mjs` 的 `ACCESS_CAPABILITIES`。**Worker 那份是必要的**：`accessProfile()` 會用 `.filter(key => ACCESS_CAPABILITIES.includes(key))` 過濾，沒加的話這個 key 會被伺服器端整個丟掉，後台勾了也存不進去。三份的 `設計師`／`一般使用者` 預設範本也一併補上（`唯讀` 不給）。
  - **前台套用**：`mailAction()` 在 `accessAllowed('request.mail',true)` 為 false 時回傳空字串（不畫按鈕）；`composeMail()` 與 `openMailComposerMenu()` 各加一道 `requireAccess('request.mail','此帳號沒有發送信件權限')`，避免有人直接呼叫函式繞過。
  - **短網址工具入口**：帳號下拉選單新增 `#accountShortLinkTool`「短網址工具」，位置在「設計儀表板」之後；顯示條件 `accessAllowed('page.short_link',true)`，點擊用 `window.open(shortLinkToolUrl,'_blank')` 另開分頁。`shortLinkToolUrl='404.html'`——**這個頁面身兼兩用**：網址帶短碼時是轉址頁，直接開啟時顯示「建立短連結」表單（`404.html` 第 47-66 行的 `#creator` 區塊），所以 `PAGE_CATALOG` 才把 `short_link` 對到 `404.html`。
- 風險區塊：**新增權限 key 會讓既有的儲存範本少一項**。`角色權限範本` 資料表裡 `設計師`／`一般使用者`／`唯讀` 三列都有明確的功能權限字串，`accessTemplate()` 有存檔就以存檔為準、不會回退到程式碼預設值——所以**部署後這兩個角色的「發送信件」是關閉的，前台不會出現發信按鈕，必須到「權限設定」把它勾起來並儲存**。`管理者` 不受影響（`accessTemplate()` 對管理者一律回傳全部權限）。我沒有直接改資料表，因為 Worker 的 Durable Object 會快取 snapshot，從 git 改 `db.json` 有被下一次寫入蓋掉的風險，走後台介面才是安全路徑。
- 已檢查／驗證方式：1280×800 iframe 實測——`MachiAccess.capabilities` 確認 `request.mail=發送信件` 出現在 request 群組末端；預設範本檢查 設計師/一般使用者/管理者 皆為 true、唯讀為 false；stub `accessAllowed` 分別回傳 true/false，確認 `mailAction()` 有權限時產生發信按鈕、無權限時回傳空字串；無權限時呼叫 `composeMail()` 正確被擋並提示「此帳號沒有發送信件權限」。短網址工具：用本機管理者 session 登入後確認選單項目可見、文字正確，攔截 `window.open` 確認點擊會開啟 `404.html`。`node --test backend/test/*.test.mjs` 22/22、Worker `tsc` 無錯、Worker `npm test` 6/6。**未做的驗證：沒有實際在「權限設定」勾選發送信件並儲存、再回前台確認按鈕出現**（需要真實後台登入）。
- 部署狀態：`index.html`／`assets/access-control.js` 純前端，push 後自動生效；**`worker/` 需要重新部署**（`cd worker && npx wrangler deploy`）——沒部署的話後台勾了「發送信件」會被 Worker 過濾掉、存不進去。
- commit：`(見 push 紀錄)`

### 2026-08-11 16:04 Asia/Taipei — 後台設計師公開資料收攏＋REELS 小卡可編輯刪除＋側邊選單改名

- 修改目的：使用者一次提出五項：(1) 設計師公開資料欄位格子過大；(2) 頭像大圖連結不用完整顯示；(3) 設計師公開資料也要收合；(4) REELS 小卡要能編輯／刪除，之後側邊 reels 頁籤即可移除；(5) 側邊選單改名。
- 影響檔案：`json_database_admin.html`、`backend/test/backend.test.mjs`。
- 影響功能：
  - **收合**：`<section class="permission-section account-designer">` 改成 `<details class="account-section-fold account-designer">`，沿用喜愛設定既有樣式。`data-account-designer` 的 `hidden` 屬性在 `<details>` 上一樣有效，`syncAccountEditorState()` 的顯示／隱藏邏輯不受影響（已實測）。現在帳號編輯器共三個收合區：喜愛設定、設計師公開資料、帳號權限。
  - **收攏排版**：新增只作用在 `.account-designer` 底下的樣式——欄位從 2 欄改 3 欄、輸入框 `min-height` 38px→31px、內距 8/9→5/8、字級 11.5px、textarea 76px→50px、技能複選從 3 欄改 4 欄。**沒有動到其他區塊的欄位尺寸**。原本包住頭像大圖的 `.account-designer-grid`／`.account-image-fields` 兩層容器直接拿掉，所有欄位併進同一個 `.account-fields`。
  - **長網址**：新增 `accountLinkField(label,header,value)`——單行輸入框（不再是 `wide:true` 撐滿整列）＋下方一條 `.account-link-preview` 截斷連結（`text-overflow:ellipsis`），完整網址留在 `href` 與 `title`，沒設定時顯示灰字「尚未設定」。套用在頭像大圖連結與分享音樂（兩個都是長網址，一起收攏才一致）。
  - **REELS 小卡編輯／刪除**：小卡加上 `data-account-reel-edit`／`data-account-reel-delete`（值是 `_rowNumber`），事件委派在 `accountReelsRows` 找到該列後呼叫 `openEditor(row,'reels')`／`deleteRow(row,'reels')`。**`openEditor()` 與 `deleteRow()` 新增 `forcedTable` 參數**——這兩支原本都直接讀模組層的 `tableName`，不加參數的話會把 reels 當成「帳號權限」表去編輯／刪除。`saveEditor()` 本來就用 `editingTableName||tableName`，所以儲存端不用改。原本的「前往 REELS 管理」按鈕與 `openAccountReels()` 一併移除。
  - **側邊選單**：`tableLabel()` 改成查 `TABLE_LABELS` 對照表，新增 加權計分標準→加權設定、角色權限範本→權限設定、bug_report→問題回報。`TABLE_ORDER` 移除 `'reels'`。
- 風險區塊：
  - reels 頁籤移除後，**「名字」對不到任何帳號的 reels 資料列會變成後台無法觸及**。查過目前資料：reels 只有 1 列且對得到帳號，所以現在沒有孤兒列；但如果之後設計師改名造成對不上，那筆就只能改回 `TABLE_ORDER` 才看得到。`reelsCardsHtml()`、`BOARD_VIEWS` 裡的 `'reels'`、`renderTable()` 的 reels 分支都**刻意保留**，要復原只要把 `'reels'` 加回 `TABLE_ORDER` 一個字串即可。
  - `backend/test/backend.test.mjs` 有兩處鎖住這個檔案的原始碼字串（`tableLabel` 的完整函式內容、`accountField('頭像大圖連結'`），這次一併更新，並補上 reels 不在 `TABLE_ORDER`、小卡有編輯／刪除鈕、`accountLinkField` 存在的斷言。
- 已檢查／驗證方式：本機載入後台頁面，console 直接呼叫 `permissionEditorHtml()` 產生 DOM 檢查：三個收合區皆預設收合、設計師區確實是 `<details>` 且 `hidden` 屬性可用；`getComputedStyle` 確認設計師區輸入框 31px／內距 5px 8px／字級 11.5px／欄位 3 欄、連結預覽 `text-overflow:ellipsis`＋`white-space:nowrap`＋10.5px、小卡按鈕 26px；連結預覽的 `title` 等於完整網址。REELS 小卡**事件委派實測**：插入一張 `_rowNumber=999` 的假小卡並點「編輯」，正確走到「找不到這筆 REELS」錯誤分支，證明 handler 有掛上；`openEditor`／`deleteRow` 確認都收得到 `forcedTable`。`TABLE_ORDER`／`tableLabel()` 逐項確認改名正確且 reels 已不在選單。`node --test backend/test/*.test.mjs` 22/22 全過。**未做的驗證：沒有登入真實後台實際編輯或刪除一則 REELS 跑完整寫入流程**（假 `_rowNumber` 只驗到 handler，沒驗到 `openEditor(row,'reels')` 之後的儲存與 `deleteRow` 的實際刪除）。
- 部署狀態：純前端，git push 後自動生效。
- commit：`(見 push 紀錄)`

### 2026-08-11 15:26 Asia/Taipei — 後台「帳號設定」的帳號權限區塊改成可收合

- 修改目的：使用者要求資料庫後台「帳號設定」裡的「帳號權限」比照「喜愛設定」加上收合功能。
- 影響檔案：`json_database_admin.html`。
- 影響功能：`permissionEditorHtml()` 內原本包住帳號權限的 `<section class="permission-section"><h4>帳號權限</h4>` 換成 `<details class="account-section-fold"><summary>帳號權限</summary><div class="account-section-fold-body">`，收尾的 `</section>` 換成 `</div></details>`——直接沿用喜愛設定既有的 `.account-section-fold` 樣式（summary 右側自動顯示「展開／收合」徽章），**沒有新增任何 CSS**。角色範本、帳號狀態、可查看頁面、可執行功能全部收進去；下方的權限摘要列（角色／頁面數／功能數／更新時間）刻意留在收合區**外面**，收合狀態下仍看得到重點。預設收合，與喜愛設定一致。
- 風險區塊：`savePermission()` 是用 `editor.querySelectorAll('[data-permission-page]:checked')` 收集權限，若 `<details>` 關閉時讀不到勾選就會靜默存錯資料——已實測確認關閉狀態下 `:checked` 仍查得到（見下）。另外 `.permission-section:first-of-type{border-top:0}` 的作用對象改變了：巢狀的「可查看的頁面」現在是 fold body 內的第一個 section，會少一條分隔線，純視覺、不影響功能。
- 已檢查／驗證方式：本機 Node 靜態伺服器直接載入後台頁面，在 console 用假 model 呼叫 `permissionEditorHtml()` 產生 DOM 後檢查：收合區塊共 2 個（喜愛設定、帳號權限），皆預設收合；帳號權限區內含角色下拉、狀態下拉、7 個頁面核取、17 個功能核取；權限摘要列確實在收合區外。另外針對儲存風險做專門測試——手動勾選 `archive` 後把 `details.open` 設為 false，再用 `querySelectorAll('[data-permission-page]:checked')` 查詢，仍正確回傳 `archive`，確認收合不影響儲存。`node --test backend/test/*.test.mjs` 22/22 全過（該檔第 312 行有 `assert.match(html, /class="account-section-fold"/)`，這次改動讓它多一處匹配，不影響斷言）。**未做的驗證：沒有登入真實後台實際點開收合、按儲存跑完整一輪。**
- 部署狀態：純前端，git push 後自動生效。
- commit：`(見 push 紀錄)`

### 2026-08-11 15:10 Asia/Taipei — 管理者密碼欄位脫離 form submit，避免瀏覽器每次都跳「更新密碼」

- 修改目的：使用者回報登入後一直跳出要更新密碼。查證後確認**不是系統自己的畫面**——`#loginNewPasswordWrap`（設定新密碼）預設 hidden，唯一會顯示它的 `showNewPasswordField()` 只被 `#loginChangePassword` 按鈕呼叫，而那顆按鈕本身也是 hidden，沒有任何自動觸發路徑。跳出來的是瀏覽器密碼管理員：`#loginPassword` 位在 `#loginForm` 內，按下登入會觸發 form submit，Chrome 判定成一次登入行為；而管理者密碼是當日 `MMDD`、每天都不同，於是每天都被問要不要更新已存密碼（`test` 與四位數字也很可能被外洩密碼檢查標記）。
- 影響檔案：`index.html`。
- 影響功能：
  - `#loginPassword` 的 `autocomplete` 從 `current-password` 改成 `off`，並加上 `autocapitalize/autocorrect/spellcheck` 與 `data-lpignore`／`data-1p-ignore`（1Password、LastPass 的忽略提示）。
  - 管理者面板的按鈕從 `type="submit"` 改成 `type="button"`＋`id="adminLoginSubmit"`，改用 click 監聽；`#loginPassword` 自己處理 Enter（`preventDefault()` 後直接呼叫 `startAdminPasswordLogin()`），**所以密碼欄位不再參與任何 form submit**——這是關鍵，瀏覽器的儲存密碼提示主要就是靠「表單送出＋密碼欄位」這個組合觸發的。
  - `#loginForm` 的 submit handler 簡化成只走 `startEmailLogin()`（Google 登入），不再需要判斷管理者面板狀態。
  - `startAdminPasswordLogin()` 讀完密碼後立刻把輸入框清空，不讓值留在 DOM 裡。
- 風險區塊：主「登入」按鈕仍是 `type="submit"`，還是會觸發一次 form submit，但那時密碼欄位是空的，瀏覽器不會提示。另外**這個修改只能阻止未來的提示，無法清掉已經存進瀏覽器的那筆密碼**——使用者需要自己到 `chrome://password-manager/passwords` 刪掉 emctaipeiart.github.io 的紀錄，否則「建議變更密碼」的警告會繼續出現。
- 已檢查／驗證方式：1280×800 iframe 實測並在 form 上掛 capture 階段的 submit 監聽計數：點管理者面板「登入」→ 觸發管理者登入且 **form submit 次數 0**；在密碼框按 Enter → 同樣觸發登入且 **submit 次數仍 0**；點主「登入」→ 走 Google 路徑、submit 次數 1（密碼欄為空）。確認 `autocomplete="off"`、按鈕 `type="button"`。語法檢查通過。**未做的驗證：沒有在真實 Chrome 上跑一輪確認提示真的不再出現**（自動化瀏覽器不會顯示密碼管理員 UI），這點需要使用者實機確認。
- 部署狀態：純前端，git push 後自動生效。
- commit：`(見 push 紀錄)`

### 2026-08-11 14:52 Asia/Taipei — 捷徑登入改由 Worker 發真 session（可寫入），顯示名改用設定表

- 修改目的：使用者要求 (1) 顯示名改成「設定」表裡的「管理員」「測試使用者」；(2) 讓這兩組捷徑登入**真的能寫入**，不再只是唯讀檢視。
- 影響檔案：`index.html`、`worker/src/model.ts`、`worker/src/database-coordinator.ts`、`worker/test/index.test.ts`。
- 影響功能：
  - **Worker**：`passwordLogin()` 前面加 `shortcutLoginAccount(password)`——密碼 `test` → `test.user@emctaipei.com`、台北時區當日 `MMDD` → `admin@emctaipei.com`；命中就跳過 `ADMIN_LOGIN_ACCOUNTS`＋`ADMIN_LOGIN_PASSWORD` 檢查，其餘密碼完全走原本的白名單路徑（真正的管理者密碼行為不變）。之後照舊要求帳號存在於「設定」表、走 `createSession()` 發**正式 hash session**，所以拿到的 token 可以寫入。
  - **Worker `isManager()`** 新增：`canonicalAccount(session.account) === SHORTCUT_ADMIN_ACCOUNT` 直接視為管理者。**這行是必要的**——`admin@emctaipei.com` 在「設定」表的部門／組別都是空字串，原本的 `/^(?:管理者|admin)$/` 判斷會落空，捷徑登入只會拿到「一般使用者」權限。測試的 seed 也刻意把這兩個欄位留空，確保這條授權路徑被真的驗到。
  - **前端** `startShortcutLogin(account,password,role)`：先呼叫 `verifyEditorLogin()` 向 Worker 換真 session；**失敗才退回** `applyLocalPreviewSession()` 的本機唯讀模式，並在狀態列標明「Worker 尚未開放此密碼，無法寫入」。這樣 Worker 部署前後前端都不會壞，部署完成後自動升級成可寫入。
  - 本機唯讀 session 的顯示名改成「管理員」「測試使用者」，與「設定」表一致。
- 風險區塊：**這一步把唯讀後門變成可寫入後門**。部署後任何人用 `test` 或當日 `MMDD` 就能拿到真 session：`test.user` 是一般使用者權限，`admin` 是**完整管理者**（含資料庫後台、封存、權限管理）。跟前一版「寫入一定失敗」的緩解已經不存在了，剩下的只有「密碼每天變」這一層，而 MMDD 只有 365 種可能、且可從當天日期直接推出來，實際上等於沒有保護。使用者在我明確說明風險後仍要求這樣做，這是使用者的決定。若日後要收斂，建議把 `shortcutLoginAccount()` 整個移除，改成給 `test.user@emctaipei.com` 一組正常強度密碼並加進 `ADMIN_LOGIN_ACCOUNTS`。
- 已檢查／驗證方式：Worker `npx tsc --noEmit` 無錯、`npm test` 6/6（新增一支測試涵蓋：`test`→測試使用者／一般使用者、當日 MMDD→管理員／**管理者**、捷徑密碼帶其他 account 參數仍會被導到捷徑帳號、錯誤密碼仍回「帳號或密碼不正確」）、`wrangler deploy --dry-run` 打包成功。前端用 1280×800 iframe 測兩種情境：模擬 Worker 接受 → 送出帳號正確、拿到 Worker token、顯示「測試使用者」；模擬 Worker 拒絕 → 退回本機唯讀、顯示「管理員」、`isAdministrator()` 為 true、狀態列出現無法寫入提示。**未做的驗證：Worker 尚未部署（這台機器 `wrangler whoami` 未登入），所以「捷徑密碼真的能寫入正式資料」這件事還沒有端對端驗證過。**
- 部署狀態：`index.html` 純前端已 push、自動生效；**`worker/` 需要手動部署才會生效**——先 `wrangler login`，再 `cd worker && npm run deploy`。部署前 Worker 會拒絕捷徑密碼，前端自動退回唯讀檢視模式。
- commit：`(見 push 紀錄)`

### 2026-08-11 14:13 Asia/Taipei — 恢復「管理者登入」的兩組測試密碼（測試者＝test／管理者＝當日 MMDD）

- 修改目的：使用者回報登入畫面改版後，原本記得的兩組測試帳號（管理者＝今天日期、測試者＝test）都無法登入，要求恢復成「在『管理者登入』面板輸入密碼即可，不需要帳號欄位」。
- 追查結果（**不是登入改版造成的**）：這兩組是 commit `f641f53`「feat: move production auth to Cloudflare Worker」（作者 EMC-iMac1）移除的，時間早於登入畫面改版。那次把 `todayAdminPassword()`／`todayAdminToken()`／`loginLocalAdmin()` 整組刪掉，換成 `isLocalAdminToken(){return false}` 與會直接丟錯的 `loginLocalAdmin()`。舊版的 `test` 分支則是打後端 `login` action 用 `test.user@emctaipei.com` 登入，而現在 Worker 的 `ADMIN_LOGIN_ACCOUNTS` 只有 `machi.chen@emctaipei.com`，所以那條路現在也一定失敗。
- 影響檔案：`index.html`、`assets/access-control.js`。
- 影響功能：
  - `index.html` 恢復並擴充本機檢視 session：`todayAdminPassword()`（`MMDD`）、`todayAdminToken()`（`local-admin:YYYYMMDD`）、新增 `todayTesterToken()`（`local-tester:YYYYMMDD`）；`isLocalAdminToken()` 維持只認管理者前綴（`isAdministrator()`／`canOpenDesignDashboard()` 才不會把測試者當管理者），新增 `isLocalTesterToken()` 與涵蓋兩者的 `isLocalPreviewToken()`。
  - 新增 `applyLocalPreviewSession(role,{announce})` 統一建立 session：管理者→帳號 `admin@emctaipei.com`、`currentEditorGroup='管理者'`；測試者→帳號 `test.user@emctaipei.com`、`'一般使用者'`、部門 `'測試'`（帳號寫在 `localAdminAccount`／`localTesterAccount` 兩個常數）。`loginLocalAdmin()`／`loginLocalTester()` 都走它。**注意 `currentEditorGroup` 是刻意寫死的，不從「設定」表帶入**——`admin@emctaipei.com` 在設定表的組別／部門都是空的，若照抄會被 `roleFromIdentity()` 判成「一般使用者」，管理者預覽就失效了。
  - 原本用 `isLocalAdminToken()` 做「跳過後端驗證／擋個人設定編輯」的 7 個呼叫點全部換成 `isLocalPreviewToken()`（`refreshSignedInAccess` 前的守門、`showPersonalSettings`、頭像設定、`updateLoginUi` 的兩個按鈕、`keepEditorSessionAlive`、`show()` 兩處），只保留 `isAdministrator()` 與 `canOpenDesignDashboard()` 用管理者專屬判斷。
  - `verifyStoredEditorToken()` 恢復本機 token 分支：token 前綴符合但**不是今天的日期**就直接登出，是今天的就還原對應身分，不打 Worker。
  - `startAdminPasswordLogin()` 改成三段路由：`test` → 測試者本機 session；當日 `MMDD` → 管理者本機 session；**其餘密碼仍照舊送到 Worker 用 `machi.chen@emctaipei.com` 驗證**（真正的 `ADMIN_LOGIN_PASSWORD` 沒有被取代）。
  - `assets/access-control.js` 的 `refresh()` 新增短路：token 符合 `^local-(admin|tester):` 時直接套用對應角色範本（靠 `roleFromIdentity()` 依 group 判斷），不打 Worker。**沒有這段的話**，本機 token 會讓 `fetchServerAccess()` 失敗、fallback 成 `status:'停用'`／`pages:[]`，`guardPage()` 會用「存取受限」全螢幕覆蓋層把整頁擋掉——這是這次真正花時間的地方。
- 風險區塊：**這是刻意加回的弱密碼後門，而且網站是公開的**。`MMDD` 只有 4 位數、`test` 是常見字典字，任何知道網址的人都能拿到管理者「介面」。緩解條件有三個：(1) 這兩組 session 拿的是假 token，Worker 一律不認，**所有寫入（新增案件、改狀態、reels、後台儲存）都會失敗**，實際上只有唯讀檢視；(2) token 綁當日日期，隔天自動失效；(3) 資料本來就在公開 repo 的 `backend/data/db.json`，這條路徑沒有多洩漏任何東西。即便如此，團隊當初移除它應該就是為了這個風險，之後若要讓測試帳號真的能寫入，正確做法是在 Worker 的 `ADMIN_LOGIN_ACCOUNTS` 加帳號並重新部署，而不是把這個前端後門再擴大。
- 已檢查／驗證方式：本機 Node 靜態伺服器（port 8901，直接服務這個 clone）＋ 1280×800 iframe 隔離測試：輸入 `test` → 顯示名「測試者」、`isAdministrator()` 為 false、角色範本「一般使用者」、可見頁面 `request/avatar_upload/short_link`、**無存取受限覆蓋層**；輸入當日 `0811` → 顯示名「管理者」、`isAdministrator()` 為 true、角色「管理者」、可見頁面含 `database_admin`／`archive`；輸入其他密碼 → 攔截確認仍以 `machi.chen@emctaipei.com` 送往 Worker；重新載入頁面後管理者身分保持、無覆蓋層；把 token 竄改成**昨天**的日期後重新載入 → 正確登出成「登入」。`index.html` 兩個 script 區塊與 `access-control.js` 語法檢查通過，`node --test backend/test/*.test.mjs` 22/22 全過。**未做的驗證：沒有實際跑一次寫入操作去看失敗訊息長什麼樣**（預期是 Worker 回 token 無效），也沒有實機截圖。
- 部署狀態：純前端，git push 後自動生效（等一輪 GitHub Pages 部署，通常 1-3 分鐘）。不需要重新部署 Worker 或 Apps Script。
- commit：`(見下方 push 紀錄)`

### 2026-08-11 13:21 Asia/Taipei — 前台登入畫面改成單鍵 Google 登入卡片（參考 manage.emctaipei.com）

- 修改目的：使用者要求把前台 `index.html` 的登入彈窗換成單一帳號的登入畫面，視覺參考 <https://manage.emctaipei.com/login>。已與使用者確認範圍：**只改外觀、驗證仍走 Google OAuth、ERP 登入入口移除、純前端改動、所有人都還能登入、保留彈窗（不做整頁登入畫面）**。第一版做了 Email 輸入欄位，使用者看過後要求**拿掉 Email 欄位、直接按「登入」就跳 Google 視窗**，最終版本即為此。
- 影響檔案：`index.html`。
- 影響功能：
  - 登入卡片改成參考站樣式：綠色圓角方塊「E」logo、標題「EMC 設計需求系統」／副標「凱曜集團設計資源管理」、滿版綠色「登入」按鈕、底部灰色「管理者登入」摺疊入口。樣式寫在 `#loginModal` 內的 scoped `<style>`（跟 `designerSettingsModal` 一樣的做法），用 ID 選擇器＋`!important` 蓋過前面好幾層 CSS override block，不動任何既有全域樣式；同一個 block 內也補了 `html[data-theme="dark"]` 的深色版本。
  - 新增 `startEmailLogin()`（沿用這個函式名，實際上已經沒有 Email 輸入）：清掉上次的帳號提示後直接呼叫 `startGooglePopupLogin(localStorage.designRequestSavedAccount)`。**驗證機制完全沒變，還是原本的 Google id_token popup ＋ Worker `googleLogin`。**
  - `googleAuthorizationUrl()`／`startGooglePopupLogin()` 新增 `login_hint` 參數，把上次登入的帳號帶到 Google 授權頁預先選好；`prompt=select_account` 維持不變，所以還是會出現帳號選擇畫面，只是預選好而已。`startGooglePopupLogin` 有 `typeof loginHint==='string'` 防護，因為 `initGoogleLogin()` 是用 `button.onclick=startGooglePopupLogin` 綁定、會傳進 Event 物件。
  - 新增 `loginPendingText(account)`，統一登入等待覆蓋層文字為「`<帳號>` 登入中...」（拿不到帳號時是「登入中...」）。原本三處各自的長句（「請在 Google 視窗選擇公司帳號...」「Google 登入驗證中：xxx」「瀏覽器阻擋登入視窗，改用整頁 Google 登入...」）全部改用它；彈窗被瀏覽器擋掉改走整頁跳轉的情況改成只寫 console.warn，不再佔用畫面文字。
  - 移除 ERP 登入按鈕與它的 click 監聽（`startErpLogin`／`continueErpLoginViaAppsScript` 函式保留，避免正在跳轉中的 ERP 回程失效）。
  - `#googleSignInButton` 保留但 `hidden`：`initGoogleLogin()` 仍會跑 `googleLoginConfigError()` 設定檢查與 `ensureGoogleOauthChannel()`，只是不再顯示 Google 按鈕。
  - `loginForm` 的 submit 改成路由：管理者面板展開**且**密碼有值 → `startAdminPasswordLogin()`（原本的行為，帳號仍寫死 `machi.chen@emctaipei.com`）；其餘 → `startEmailLogin()`。這樣在密碼框按 Enter 也會走管理者登入。
  - `showLoginModal()` 改 focus「登入」按鈕（原本 focus Google 按鈕）；預設提示文字從「請使用 ERP 或 Google 帳號登入。」改成「請使用 @emctaipei.com 公司 Email 登入。」。
- 風險區塊：登入是全體使用者每天第一個碰到的畫面。這次沒有動任何驗證邏輯與 Worker，最壞情況是版面跑掉而不是登不進去。`login_hint` 只是提示 Google 預選哪個帳號，**不是驗證依據**——實際帳號一律以 Google 回傳的 id_token 為準。
- 已知限制（不是這次的 bug，但每次改登入都會遇到）：`googleAuthorizedOrigin` 寫死 `https://emctaipeiart.github.io`（`index.html` 約 6883 行），所以 **Google 登入在本機／未部署狀態一定無法完成**——授權完會導回正式站的舊版頁面，本機視窗永遠等不到回傳，畫面會一直停在「登入中...」。要驗證登入是否真的通，只能部署後在正式站測。
- 已檢查／驗證方式：本機用 Node 靜態伺服器（port 8899）開 `index.html`。因為 Browser pane 未顯示、主頁面 `innerWidth` 為 0 量不到真實版面，改用**在頁面內建立 1280×800 的 iframe 載入同一份 `index.html`** 再於 iframe 內量測：卡片 384×329、logo 56px 綠底、按鈕滿版 334×40 綠底、提示文字灰色，樣式都正確蓋過既有 CSS；卡片文字內容確認只剩「E／EMC 設計需求系統／凱曜集團設計資源管理／登入／管理者登入／請使用 @emctaipei.com 公司 Email 登入。」；攔截 `window.open` 確認按「登入」直接開 `accounts.google.com/o/oauth2/v2/auth`，帶 `prompt=select_account` 與 `login_hint=anna@emctaipei.com`（測試前寫入的上次登入帳號）；等待覆蓋層文字確認為「anna@emctaipei.com 登入中...」；submit 路由兩種情境（面板開+有密碼→admin、面板開+無密碼→google）都正確；console 無 JS 錯誤。`node --test backend/test/*.test.mjs` 22/22 全過（依照先前兩次踩坑的教訓，改動前已先 grep 過 `backend/test`、`worker/test`、`scripts`，確認沒有任何測試鎖住登入區塊的 markup）。**未做的驗證：沒有實機截圖（Browser pane 無法顯示），視覺是靠量測而非肉眼確認；也沒有跑完整的 Google 登入流程（原因見上面的已知限制）。**
- 部署狀態：純前端，git push 後自動生效（需等一輪 GitHub Pages 部署，通常 1-3 分鐘）。**不需要重新部署 Worker 或任何 Apps Script。**
- commit：（尚未提交，本機檔案異動）

### 2026-08-11 17:55 Asia/Taipei — 喜愛設定與帳號權限合併

- 修改目的：把原本獨立的「設定」資料編輯整合到每個帳號，以下拉選單與複選格維護喜愛設定，並補齊設計師專屬欄位。
- 影響檔案：`json_database_admin.html`、`backend/app.mjs`、`backend/test/backend.test.mjs`、`worker/src/model.ts`、`worker/src/database-coordinator.ts`、`worker/test/index.test.ts`、`backend/README.md`、`CODEX.md`、`CLAUDE.md`。
- 影響功能：帳號合併編輯器、新增帳號、設計師公開資料、喜愛設定、角色與自訂權限；`adminAccountSave` 在單一 Worker／Node 交易中寫入兩張底層表。
- 風險區塊：帳號與權限是高影響資料，因此保留舊的 `設定` 表結構供前台相容，並用預期資料列做樂觀並行檢查。
- 附帶修正：本機 Node API 會將 `Authorization: Bearer` 傳入 action payload，避免剛登入就被判定 `TOKEN_EXPIRED`；頭像失敗備援 SVG 全字串編碼，避免內嵌 `onerror` 因 URL 引號產生語法錯誤。
- 已檢查／驗證方式：HTML 內嵌 JS、Node 語法、`git diff --check`、Node 22/22、Worker 5/5、Worker types/tsc 與 dry-run；隔離資料庫瀏覽器 QA 完成新增設計師帳號、兩表交易寫入、既有自訂技能保留與頭像失敗備援，後台新分頁 console 無錯誤。
- 部署狀態：尚未推送 GitHub，也未重新部署 Worker；目前是本機已完成且可發布的狀態。
- commit：尚未建立。

### 2026-08-10 16:03 Asia/Taipei — 補上遺失的設計師大頭貼檔案

- 修改目的：`index.html` 的 6 個 `<link rel="preload">` 一直對 6 個設計師大頭貼發出 404 請求。
- 影響檔案：`assets/designers/{Machi,Anna,Karl,Noise,Amber,Leona}-avatar.jpg`（新增）。
- 影響功能：純視覺，這 6 個檔案是開場預先載入用的通用底圖，跟每個人在「設定」表裡實際設定的頭像連結是兩件事，不會互相取代。
- 風險區塊：無，純新增靜態檔案。
- 已檢查／驗證方式：推送後用 `curl` 逐一確認 6 個網址回傳 200。
- 部署狀態：純前端，git push 後自動生效。
- commit：`5bf9fff`

### 2026-08-10 16:51 Asia/Taipei — 資料庫後台整體改版：左側選單＋各表客製化呈現

- 修改目的：原本 `json_database_admin.html` 只有「資料庫」表用了客製化排版，其餘七張表共用一套通用表格，導致「設定」表 37 個欄位擠成一列、`reels` 留言直接顯示原始 JSON 字串等問題。
- 影響檔案：`json_database_admin.html`。
- 影響功能：頂部橫向頁籤改成左側選單；「加權計分標準」改依設計種類/階段分組；「短連結」「補充資料連結」從舊的合併虛擬表「連結管理」拆成兩個獨立頁籤；「修改統計表」改成依案件分組的時間軸；「設定」改成一人一張卡片，主要欄位與 26 個介面暫存欄位分開顯示；`reels` 改成留言泡泡＋讚/倒讚清單；`bug_report` 改成依狀態分欄的看板。資料讀寫底層邏輯（fetch/save/delete、Apps Script 溝通方式）沒有更動。
- 風險區塊：大範圍重寫渲染層，需確認既有的即時刷新（BroadcastChannel）、樂觀更新、錯誤還原邏輯都還正常運作。
- 已檢查／驗證方式：複製一份本機 `backend/data/db.json`，用本機 Node 後台＋瀏覽器實際點過全部 8 個頁籤，並完成一次真實的儲存測試（修訂版正確遞增）。
- 部署狀態：純前端，git push 後自動生效。
- commit：`ec09715`

### 2026-08-10 17:24 Asia/Taipei — 後台視覺質感調整、加權項目 CRUD、限動保留期限

- 修改目的：使用者回饋字體過大、有 emoji 顯得廉價、欄位文字沒有垂直置中、加權計分標準版面太空、補充資料連結／設定卡片太擠、且限時動態過期後希望保留資料只是前台不顯示。
- 影響檔案：`json_database_admin.html`、`google_apps_script.gs`、`upload/Code.gs`。
- 影響功能：
  - 移除所有 emoji，字重從 800/900 降到 600/700，表格與卡片欄位全面垂直置中。
  - 「加權計分標準」改成緊湊列表並新增「+新增項目」與逐列刪除。
  - 「補充資料連結」卡片改依更新時間新到舊排序，卡片間距加大。
  - `google_apps_script.gs`：`ADMIN_TABLE_CONFIG` 補上「加權計分標準」、新增 `adminTableInsert_`（後來發現跟 `user_directory.gs` 的同名函式重複，見下一筆修改）；`readReels_`／`publicReelRecord_` 新增依 `到期時間` 過濾已過期限動的邏輯，只影響前台 `listReels`，後台仍讀得到全部資料。
  - `upload/Code.gs`：`REELS_HEADERS` 新增「保留期限」「到期時間」欄位，新增限動時寫入；`expireDesignerStory_` 到期時不再刪除 reels 資料列，只處理 Drive 檔案清理。
- 風險區塊：`adminTableInsert_` 在兩個 `.gs` 檔案重複定義（Apps Script 會合併所有檔案到同一個作用域，後載入的會蓋掉先載入的）——這個問題在推送當下沒發現，直到下一次修改才用線上測試抓到。
- 已檢查／驗證方式：本機 QA 環境跑過視覺與互動；`node --test` 未涵蓋 `.gs` 檔案（Apps Script 無法在本機執行），這是後續踩坑的根因。
- 部署狀態：`json_database_admin.html` 純前端，git push 後自動生效；`google_apps_script.gs`／`upload/Code.gs` 需要分別手動部署對應的 Apps Script 專案。
- commit：`5bd339b`

### 2026-08-10 17:43 Asia/Taipei — 修正過時的後台回歸測試

- 修改目的：`backend/test/backend.test.mjs` 裡有一支測試專門比對 `json_database_admin.html` 的舊版原始碼字串（`連結管理`、`combinedLinkRows`、舊的加權表格頭…），這次改版後測試持續紅燈（CI「Test JSON backend」自這次 push 起連續失敗）。
- 影響檔案：`backend/test/backend.test.mjs`。
- 影響功能：無實際功能變更，純測試更新，比對新版的 `databaseTableHtml`／`shortLinkTableHtml`／`supplementCardsHtml`／`weightGroupsHtml`／`NO_INSERT_TABLES` 等新結構。
- 風險區塊：無。
- 已檢查／驗證方式：`node --test backend/test/*.test.mjs`，19/19 全過，CI 重新跑過確認轉綠燈。
- 部署狀態：純後端測試檔，git push 後由 GitHub Actions 自動執行。
- commit：`4f9ac11`

### 2026-08-10 18:05 Asia/Taipei — 修正 `adminTableInsert_` 重複定義

- 修改目的：使用者實際部署上一版 Apps Script 後回報「兩個都已經完成」，用唯讀線上測試（打 `adminTableInsert` action 但不帶有效登入）驗證時，從錯誤堆疊發現真正執行的是 `user_directory.gs` 裡「只能新增設定表」的舊版函式，`google_apps_script.gs` 裡新加的版本是死代碼，代表加權計分標準的新增功能其實不會生效。
- 影響檔案：`google_apps_script.gs`（移除重複函式）、`user_directory.gs`（合併邏輯）。
- 影響功能：`user_directory.gs` 的 `adminTableInsert_` 現在同時處理「設定」表的專屬驗證（帳號/名字/部門必填、帳號轉小寫、清除使用者名錄快取）與其餘表的通用主鍵驗證。
- 風險區塊：Apps Script 同一專案內多檔案定義同名函式時，後載入的會覆蓋先載入的，且沒有任何編輯器警告——這是這次踩坑的根本原因，未來新增 `.gs` 函式前應該先確認全專案（所有檔案）有沒有同名函式。
- 已檢查／驗證方式：`node --test`，19/19 全過（僅涵蓋字串比對層級，無法真正執行 Apps Script）。
- 部署狀態：需要重新手動部署主系統 Apps Script（`google_apps_script.gs` ＋ `user_directory.gs` 一起）。
- commit：`f691430`

### 2026-08-10 09:05 Asia/Taipei — 加權分數以 JSON 為主、後台寫入不再誤回寫試算表

- 修改目的：使用者要求釐清「所有資料寫進後台 JSON，只有填單案件備份到試算表，加權以 JSON 後台為主」，追查後發現兩個實際落差。
- 影響檔案：`google_apps_script.gs`、`user_directory.gs`。
- 影響功能：
  1. 新案件的加權分數本來就是 JSON 為主（前台用 `加權計分標準` JSON 表算好才送出），但**後台改權重規則後，既有案件的分數不會重算**。新增 `recalculateDatabaseWeights_()`，在編輯/刪除/新增加權規則的同一次交易內，把所有 `database` 案件的「加權」欄位依最新規則重算一次。
  2. 發現後台**所有**寫入（不只 database）其實都會在 60 秒後把對應試算表分頁整個覆寫，因為前端送的 `skipSpreadsheetBackup` 欄位跟後端實際檢查的 `_skipSheetBackup` 名稱對不上，形同沒有這道防護。改成後端用 `mutateGithubJsonDatabase_` 新增的 `allowSheetBackup` 參數強制把關：只有前台「填寫設計需求」觸發的案件寫入路徑（`githubJsonDatabaseWriteAction_`）會回寫試算表，資料庫後台的八表管理一律只寫 JSON。
- 風險區塊：`weightMap_()`（讀 Google 試算表算權重）確認是死代碼、沒有任何 action router 會呼叫到，保留但加註解說明，沒有刪除（避免不確定的隱藏依賴）。
- 已檢查／驗證方式：`node --test backend/test/*.test.mjs`，19/19 全過。
- 部署狀態：需要重新手動部署主系統 Apps Script（`google_apps_script.gs` ＋ `user_directory.gs` 一起，第三次同一組檔案的部署）。
- commit：`8cc4c6a`

### 2026-08-10 09:16 Asia/Taipei — 前台選單／後台列表／加權分數統一資料來源

- 修改目的：使用者問「加權計分標準的設計種類/階段/項目細節改名，前台填單選單跟後台資料庫列表會不會跟著變」，追查後發現不會——前台選單來自另一個獨立的 Google 試算表「階段」分頁，跟加權計分標準 JSON 表是兩份互不相干的資料。
- 影響檔案：`index.html`。
- 影響功能：新增 `designListsFromWeightTable()`／`syncDesignListsFromDatabase()`，把前台「項目細節」選單（同時也是資料庫列表「項目細節」編輯按鈕、`openDetailsEditor` 的選項來源）改成直接從 `加權計分標準` JSON 表分組產生，每次 JSON 重新讀取時跟著加權規則一起同步。移除已死的 `designListsFromStageSheet`／`splitDetailHeader`／`stagesGvizUrl`／`stagesSheetId`。「採購」類別沒有對應加權規則，維持 fallback 用寫死的預設清單。
- 風險區塊：這是全體設計組每天都在用的填單表單，改動範圍雖然只有選單資料來源，但影響面廣。
- 已檢查／驗證方式：複製一份 `backend/data/db.json` 把「字體設計」改名成「標準字設計」，用純靜態 HTTP 伺服器開啟 `index.html`，直接在瀏覽器 console 確認 `designLists.details['平面']['提案']` 顯示新名稱、`detailWeight('平面','提案','標準字設計')` 正確回傳 2 分。
- 部署狀態：純前端，git push 後自動生效，**不需要部署 Apps Script**。
- commit：`ec4847a`

### 2026-08-11 Asia/Taipei — 資料庫後台「補充資料連結」卡片單行連結、編輯框大小統一

- 修改目的：使用者回報「補充資料連結」卡片內 A/B/C/D 連結完整顯示網址造成版面雜亂，且點編輯時各欄位輸入框大小不一致（依網址長度忽大忽小）。
- 影響檔案：`json_database_admin.html`。
- 影響功能：`supplementCardsHtml()` 的連結改用 `.kv-list a.trunc`（新增 CSS：`white-space:nowrap;overflow:hidden;text-overflow:ellipsis`）單行截斷顯示，`href` 與 `title` 仍保留完整網址；`fieldHtml()` 新增 `forceWide` 參數，`editorFieldsHtml()` 針對「補充資料連結」表的 A/B/C/D 欄位強制統一用同樣大小的 `textarea`（不再依內容長度自動判斷），其餘欄位（案件編號／更新時間）維持原本單行輸入框。
- 風險區塊：`.kv-list a.trunc` 只加在補充資料連結卡片的連結上，未套用到「設定」「reels」等其他也用 `.kv-list` 的卡片，不影響其他頁籤呈現。
- 已檢查／驗證方式：本機起 `python3 -m http.server` 開啟 `json_database_admin.html`，因無法啟動 Node 後台，改用瀏覽器 console 直接呼叫頁面內的 `supplementCardsHtml()`／`editorFieldsHtml()` 搭配假資料（含超長網址與短網址混合），截圖確認卡片連結單行截斷、編輯框四個欄位大小一致。
- 部署狀態：純前端，git push 後自動生效。
- commit：`ce1d8ce`

### 2026-08-11 Asia/Taipei — 補充資料連結卡片新增短網址徽章

- 修改目的：上一版只把長網址做單行截斷顯示，但使用者實際想要的是「長網址單行截斷（href 仍完整）＋額外顯示一組真正的短網址」，而不只是視覺上的截斷。
- 影響檔案：`json_database_admin.html`。
- 影響功能：新增 `supplementShortUrl(slot, caseId)`，當「案件編號」符合 8 碼數字格式時，組出 `https://emctaipeiart.github.io/{slot}/{案件編號}`（slot 小寫 a–d）。這個路徑格式沿用 `404.html` 既有的 `legacyMatch` 短網址解析規則（`resolveLegacyLink`／Apps Script 的 `resolveSupplementLink_`），該機制早就存在、且 `scripts/generate_short_link_index.mjs` 會把 `補充資料連結` JSON 表的 A/B/C/D 網址打包進 `data/short_link_index.json` 供 404 頁面直接查表，因此**不需要**呼叫 `createShortLink` 另外產生短碼，也不需要新的後端邏輯。`supplementCardsHtml()` 每個有值的欄位現在會同時顯示：原始長網址（`.trunc` 單行截斷，`href`/`title` 保留完整網址）＋短網址徽章（`.badge.short-badge`，文字顯示 `/slot/案件編號`，`href` 指向完整短網址，點擊會經過 404 頁重新導向到原始連結）。
- 風險區塊：短網址徽章目前只在案件編號為 8 碼數字時顯示（不符合格式就不顯示徽章、只留原始連結），避免產生連到 404 頁但解析失敗的死連結；`.badge`／`a.short-badge` 是共用樣式類別，套用範圍僅限這個函式內新增的 `<a>`，不影響「短連結」頁籤原本的徽章樣式。
- 已檢查／驗證方式：本機 `python3 -m http.server` 開啟頁面，瀏覽器 console 直接呼叫 `supplementCardsHtml()` 搭配假資料（8 碼案件編號＋混合長度網址），截圖確認徽章文字為 `/a/26080018` 等格式，並用 `a.short-badge` 的 `.href` 屬性確認實際指向 `https://emctaipeiart.github.io/a/26080018` 這類正確網址。
- 部署狀態：純前端，git push 後自動生效。
- commit：`b01b174`

### 2026-08-11 Asia/Taipei — 資料庫後台編輯 database 表改回回寫試算表

- 修改目的：使用者詢問「後台 JSON 資料庫有沒有寫入 https://docs.google.com/spreadsheets/d/1cHxWBed715H0XufNhMOOk3hcZPTSpq5rA64-b5m8vWY（gid=1244538986，即『案件資料』分頁）」，追查後確認：這個分頁目前只會被「前台填單」動作（`githubJsonDatabaseWriteAction_`）寫入，資料庫後台（`json_database_admin.html`）編輯／刪除 `database` 表既有案件時完全不會回寫。跟使用者確認範圍後，只針對 `database` 這一張表比照前台行為補上回寫，其餘 7 張表維持[[2026-08-10 的修正]]（只寫 JSON，避免加權計分標準之類的表被意外整頁覆寫）不變。
- 影響檔案：`GS/google_apps_script.gs`（`adminTableUpdate_`、`adminTableDelete_` 呼叫 `mutateGithubJsonDatabase_` 時，第四個參數改傳 `{ allowSheetBackup: tableName === 'database' }`；`adminTableInsert_` 本來就對 `database` 表直接擋掉，不受影響，維持只由前台填單新增案件）。
- 影響功能：資料庫後台的「database」頁籤，編輯或刪除案件現在會跟前台填單一樣，60 秒後把整個 `database` 分頁覆寫回 gid=1244538986；其餘 7 張表（加權計分標準、短連結、補充資料連結、修改統計表、設定、reels、bug_report）的後台編輯行為不變，仍然只寫 JSON。
- 風險區塊：這個「回寫」是整分頁覆寫（不是單筆更新），跟前台填單原本的行為一致，但代表後台編輯 database 表時，如果同時間試算表上有人手動改動該分頁，會被下一次覆寫蓋掉——這個風險本來就存在於前台填單路徑，只是現在後台編輯 database 表也會有一樣的風險。另外：這台電腦上 `google_apps_script.gs`／`user_directory.gs` 這次工作開始前就已經（尚未 commit）從 repo 根目錄搬到 `GS/` 資料夾，這個搬移不是這次改動的一部分，我沒有動它、也還沒把搬移或這次的程式碼修改加入 git，純粹是本機檔案異動，需要手動部署才會生效（見下方部署狀態）。
- 已檢查／驗證方式：讀程式碼確認 `ADMIN_TABLE_CONFIG.database.sheetName` 與 `mirrorGithubJsonTableToSheet_` 用的是同一份對照表，跟前台填單寫入的是同一個分頁（已用 `gviz/tq` 匯出該分頁 CSV 核對過欄位與資料，確認就是使用者提供連結對應的分頁）；Apps Script 無法在本機執行，未做端對端測試。
- 部署狀態：**需要手動部署**——把 `GS/google_apps_script.gs`（含 `user_directory.gs`，兩個檔案是同一個 Apps Script 專案）貼到 Google Apps Script 編輯器，「部署 → 管理部署 → 編輯 → 新版本」，在此之前完全不會生效。
- commit：（尚未提交，本機檔案異動）

### 2026-08-11 Asia/Taipei — 前台正式站改讀 raw.githubusercontent.com，繞開 GitHub Pages 部署延遲【⚠️ 已於同日 revert，見下方兩則後續紀錄，不要重做這個方向】

- 修改目的：使用者實測回報「前台新增一筆案件確認後，馬上在資料庫後台刪除，前台卻保留那筆資料一段時間才消失」。追查後發現：這個 repo 的 GitHub Pages **不是**傳統「直接從分支發布」，而是靠 `.github/workflows/update-database-archive.yml` 跑 `actions/deploy-pages@v4` 部署（`on: push` 觸發，過程含 checkout／裝 Node 22／跑 `generate_database_archive_snapshot.mjs`／打包／部署，實測常需 1-3 分鐘）；且這個 workflow 有 `concurrency:{group:database-archive-snapshot,cancel-in-progress:true}`，短時間內連續兩次 push（例如先新增又馬上刪除）會讓後面那次直接取消前一次還在跑的部署、重新開始，延遲更久。而 `index.html` 原本讀的 `backend/data/db.json` 是相對路徑（`githubJsonDatabaseUrl='backend/data/db.json'`），指向的正是這個要等 Pages 部署完才會更新的靜態檔——前台雖然每次刷新都已經正確用 `cache:'no-store'`+時間戳繞開瀏覽器/CDN快取（不是快取問題），但終究要等這個部署管線本身跑完，數據來源（origin）才會真的更新。
- 影響檔案：`index.html`。
- 影響功能：新增 `githubJsonDatabaseRawUrl`（`https://raw.githubusercontent.com/EMCtaipeiART/EMCtaipeiART.github.io/main/backend/data/db.json`），`githubJsonDatabaseUrl` 改成依 `location.hostname` 判斷：正式站（`emctaipeiart.github.io`）讀這個 raw 網址（Apps Script commit 完成後幾秒內就能讀到最新內容，不必等 Pages 部署／不受 workflow 併發取消影響）；其他網域（本機測試、`file://`、未來如果換網域）維持讀原本的相對路徑 `backend/data/db.json`，本機開發流程不受影響。這個做法沿用了 `json_database_admin.html` 既有的 `loadDatabaseFile()` 邏輯（它在剛完成一次後台寫入、拿到 `commitSha` 時，本來就已經會改讀 `raw.githubusercontent.com/{commitSha}/...`），只是這次是套用在「一般讀取」而非「剛寫入後那次」。
- 風險區塊：raw.githubusercontent.com 是公開匿名讀取，有 GitHub 自己的頻率限制（一般匿名請求約每小時數千次等級），這個系統是內部小團隊使用、每個開著的分頁背景輪詢頻率是 6-30 秒一次，正常使用量不會接近上限，但如果之後同時有大量分頁長時間開著（例如貼在公用螢幕上），需要留意。另外這個網址寫死了 repo 路徑 `EMCtaipeiART/EMCtaipeiART.github.io`／分支 `main`，如果之後 repo 改名、換分支名稱，這裡要記得一起改。
- 已檢查／驗證方式：`curl -sI` 比對兩個網址的回應標頭，確認 `emctaipeiart.github.io/backend/data/db.json` 的 `cache-control: max-age=600` 是 Pages 自己的快取設定（但前台本來就用 `no-store`+時間戳繞開，不是這次問題的根因）；`curl` 直接抓 raw 網址內容確認是合法 JSON、`tables.database.rows` 有資料、`access-control-allow-origin: *`（跨網域不會被擋）；本機用 `python3 -m http.server` 開 `index.html`，在瀏覽器 console 直接對 raw 網址發一次帶時間戳的 fetch 確認 200＋資料正確；並確認 `location.hostname` 判斷邏輯在 `localhost` 時仍會選到相對路徑（本機測試不受影響）。
- 部署狀態：純前端，git push 後自動生效——但**這次修改本身第一次生效，還是得先等一輪原本的 GitHub Actions Pages 部署跑完**（大概 1-3 分鐘），之後往後的每一次讀取才會改用 raw 網址、不再受這個部署管線拖累。
- commit：`32ec558`（另外因為推送前遠端已經有多筆自動化資料同步 commit，用 merge commit `492b31c` 一起推上去，這幾筆自動化 commit 跟這次改動無關，只是資料快照同步）。

### 2026-08-11 Asia/Taipei（同日稍晚）— revert 上面那次改動：raw.githubusercontent.com 這條路 2026-08-08 就被人類同事試過又刻意廢棄

- 修改目的：上面那次「改讀 raw.githubusercontent.com」推上去之後，「Test JSON backend」CI 直接變紅（[run 31452973999](https://github.com/EMCtaipeiART/EMCtaipeiART.github.io/actions/runs/31452973999)），使用者回報「一直跳出問題，情況根本沒改善」。追查後發現 `backend/test/backend.test.mjs` 第 109-110 行**本來就有明確的迴歸測試**：`assert.match(html, /const githubJsonDatabaseUrl = 'backend\/data\/db\.json'/)` 加上 `assert.doesNotMatch(html, /raw\.githubusercontent\.com\/EMCtaipeiART.../)`，是用來擋住這個做法被重新引入的。用 `git log -S` 查出來：2026-08-08 commit `b1881f0` 一開始就是用 raw.githubusercontent.com，後續 commit `6ef21d6`「Fix stale JSON refresh hiding new records」加了 `incomingRevision<cachedRevision` 這個修訂版比對護欄想補救，最後 commit `dd46917`「Fix frontend database refresh consistency」（作者是團隊真人 machi.chen@emctaipei.com，不是自動化）直接整個改回相對路徑 `backend/data/db.json`。根本原因是 raw.githubusercontent.com 背後是 Fastly CDN，不同邊緣節點對「main 分支最新內容」的認知不一致，快速輪詢（前台每 6-30 秒一次）時會不規律讀到不同節點的回應，曾經造成「剛新增的案件被舊資料蓋掉、畫面上消失」，跟這次要修的「已刪除的案件在前台賴著不走」其實是同一種不穩定的兩種表現，並沒有真的解決問題，只是換了一種更難預期的壞法。
- 影響檔案：`index.html`（改回單行：`const githubJsonDatabaseUrl = 'backend/data/db.json';`，等同完整 revert 掉 `32ec558` 那次改動）。
- 影響功能：前台讀取行為回到 2026-08-08 之後已知穩定的狀態——會受 GitHub Pages 部署管線延遲影響（通常 1-3 分鐘），但不會再有資料忽隱忽現的問題。
- 風險區塊：（這次是檢討，不是新風險）這次教訓是：**改動前一定要先 `git log -S <關鍵字>` 查有沒有人試過同樣的做法、也要先跑一次相關測試（`npm test` 或至少手動比對 `backend/test/*.test.mjs` 裡有沒有相關斷言），不要只憑當下用 curl 測到「內容正確、CORS 沒問題」就當作方案可行**——CDN 一致性問題不會在單次請求裡顯現，需要看歷史踩坑紀錄或長時間觀察才會發現。
- 已檢查／驗證方式：`git log --oneline --all -S "raw.githubusercontent.com/EMCtaipeiART"` 抓出完整歷史；`git show <commit> -- index.html` 逐一確認每次改動的實際 diff；revert 後用 `git diff -- index.html` 確認跟 revert 前的 HEAD 完全一致（3 行差異，乾淨對稱）。
- 部署狀態：純前端，git push 後自動生效（一樣要等一輪 Pages 部署才會反映在正式站，這點跟本來就有的延遲無關，是這次 revert 本身也要走一次部署）。
- commit：`41edce9`（merge commit `cf43275` 一起推送，同樣只是夾帶自動化資料同步 commit）。

### 2026-08-11 Asia/Taipei（同日再晚一點）— 資料庫後台加上定時背景輪詢

- 修改目的：上面那個 raw.githubusercontent.com 的嘗試被 revert 掉之後，「後台刪除、前台顯示延遲」的根本問題（GitHub Pages 部署管線要 1-3 分鐘）還是存在，決定不再試圖繞過部署延遲本身，改成處理另一個真正找到、而且風險很低的獨立問題：使用者回報「前台改完狀態，跑去資料庫後台看，等了一段時間才看到更新，非常慢」。追查發現 `json_database_admin.html` **完全沒有任何定時輪詢**（不像 `index.html` 有每 6-30 秒的背景輪詢），只有兩種情況會更新畫面：(1) 手動按「重新讀取」、(2) 跟前台開在**同一個瀏覽器**時透過 BroadcastChannel／localStorage 收到即時通知。如果後台是開在不同瀏覽器/裝置，或分頁被切到背景很久，就會一直停留在舊資料，直到手動刷新才會更新——這跟 raw.githubusercontent.com 那個問題完全無關，是後台頁面本來就缺少的一塊，可以獨立、低風險地補上。
- 影響檔案：`json_database_admin.html`。
- 影響功能：新增 `backgroundPollTick()`，每 18 秒（`backgroundPollMs=18000`）背景檢查一次，呼叫 `loadMetadata({fresh:true})`；四個情況會跳過這次檢查：登入畫面還沒過（`$('app').hidden`）、分頁不在前景（`document.hidden`）、編輯視窗開著（`!$('editor').hidden`，避免使用者正在編輯時資料被背景刷新蓋掉）、已經有一次刷新在跑（`refreshInFlight`，跟既有的 `refreshFromBackend` 共用同一個旗標避免重疊請求）。另外把原本的 `visibilitychange` 監聽器擴充：分頁切回前景時，如果有 `pendingRefresh`（表示背景時收到過廣播通知）優先用既有的 `refreshFromBackend`（會 pin 住 commitSha，比較精準），否則才補一次 `backgroundPollTick()`，避免兩條路徑重複刷新。
- 風險區塊：每次背景刷新都會呼叫 `renderTable()` 重新產生整個畫面 HTML，任何使用者手動展開的 `<details>` 摺疊區塊（例如「加權計分標準」的分組、「設定」表的進階欄位）會被重置回預設開合狀態——這個行為跟原本手動按「重新讀取」完全一樣，不是新引入的問題，只是現在會每 18 秒自動發生一次而不是只在使用者手動點擊時發生。
- 已檢查／驗證方式：本機 `python3 -m http.server` 開頁面（本機沒有 Node 環境跑不了 `npm test`），用瀏覽器 console 直接對 `backgroundPollTick()` 做隔離測試：暫時替換 `window.loadMetadata` 為計數用的假函式，逐一驗證四個跳過條件（app 隱藏、`document.hidden`、編輯視窗開著、`refreshInFlight`）都正確跳過、且完全放行時真的會呼叫 `loadMetadata` 並在結束後把 `refreshInFlight` 重設回 `false`；`document.hidden` 在自動化瀏覽器環境預設是 `true`，額外用 `Object.defineProperty` 暫時覆寫 getter 才測到「條件全部允許」那個分支。
- 部署狀態：純前端，git push 後自動生效（一樣要等 Pages 部署跑完，通常 1-3 分鐘）。
- commit：`16cf70f`（merge commit `4990622` 一起推送，同樣只是夾帶自動化資料同步 commit）。

### 2026-08-11 Asia/Taipei（同日再晚一點）— 修正後台背景分頁收到即時通知時遺失 commitSha 的 bug

- 修改目的：使用者確認「前台寫入、後台接收」的情境是**同一台電腦、同一個瀏覽器的不同分頁**——這代表理論上應該吃得到 [[前台正式站改讀 raw.githubusercontent.com，繞開 GitHub Pages 部署延遲|同瀏覽器即時廣播機制]]（`publishDatabaseRefresh`／`receiveDatabaseRefresh`／pin 住 `commitSha` 讀 `raw.githubusercontent.com/{commitSha}/...`），理論上應該幾秒內就更新，不該「非常慢」。追查 `json_database_admin.html` 的 `receiveDatabaseRefresh`／`refreshFromBackend` 才發現真正的 bug：收到廣播訊息時，如果後台分頁剛好在背景（`document.hidden`），程式碼只記了一個布林值 `pendingRefresh=true`，**把整條訊息（包含 commitSha）直接丟掉**；等使用者切回分頁，補刷新用的是空字串 commitSha，`loadDatabaseFile()` 判斷 `commitSha&&location.hostname===...` 條件不成立，就退化成讀 `DATABASE_FILE_URL`（GitHub Pages 那份還沒部署完的靜態檔）——等於「即時通知」的通知本身有到，但補刷新完全沒吃到 pin commit 的加速效果，變成跟沒有這個機制一樣慢。同樣的問題也發生在 `refreshFromBackend` 執行中又收到下一則通知的情況（`refreshInFlight` 分支）。
- 影響檔案：`json_database_admin.html`。
- 影響功能：新增 `pendingRefreshMessage` 變數，在兩個原本只設 `pendingRefresh=true` 布林值的地方（`receiveDatabaseRefresh` 的 `document.hidden` 分支、`refreshFromBackend` 的 `refreshInFlight` 分支），改成同時保留完整訊息物件；`refreshFromBackend` 的 `finally` 區塊、以及 `visibilitychange` 監聽器裡的補刷新呼叫，都改成優先使用 `pendingRefreshMessage`（帶正確 commitSha）而不是丟掉重建一個空的 `{tables:[tableName]}`。修好之後，同瀏覽器不同分頁的情境下，不管後台分頁當下是不是在背景，切回來都能立刻吃到 pin commit 的快速路徑。
- 風險區塊：這個修正只影響「同瀏覽器收到廣播通知」這條路徑，不影響 `backgroundPollTick()` 那個定時輪詢（那個本來就沒有 commitSha 可用，一律讀 `DATABASE_FILE_URL`，一樣受 Pages 部署延遲影響——跨裝置/跨瀏覽器的情境目前仍然沒有解法，這點還沒變）。
- 已檢查／驗證方式：本機 `python3 -m http.server` 開頁面，瀏覽器 console 直接呼叫 `receiveDatabaseRefresh()` 餵一則帶假 `commitSha` 的訊息、用 `Object.defineProperty` 覆寫 `document.hidden` 模擬「收到時在背景」，確認 `pendingRefreshMessage` 正確存下該 commitSha；接著模擬切回前景（覆寫 `document.hidden` 回 `false`＋手動 `dispatchEvent(new Event('visibilitychange'))`），暫時替換 `window.loadMetadata` 為記錄呼叫參數的假函式，確認補刷新呼叫時 `commitSha` 確實是原本那則訊息裡的值，不是空字串。
- 部署狀態：純前端，git push 後自動生效（一樣要等 Pages 部署跑完，通常 1-3 分鐘——這次修正本身第一次生效也受這個延遲影響，之後同瀏覽器分頁間的即時更新就不會再受它拖累）。
- commit：`57926da`（merge commit `546d15c` 一起推送，同樣只是夾帶自動化資料同步 commit）。

### 2026-08-11 Asia/Taipei（同日再晚一點）— 恢復被 2026-08-10 改版意外拿掉的 GitHub Contents API 直讀路徑（真正根因）【⚠️ 已於同日 revert，見下方紀錄，不要重做這個方向】

- 修改目的：上面兩次修正（定時背景輪詢、修 commitSha 遺失）推上去之後，使用者仍然非常不滿意，明確說「今天以前前台寫入都是即時寫入後台 JSON 資料庫即時顯示，目前要等好幾分鐘」——這代表問題不是我今天新增的兩個小 bug，而是**這個系統原本就有更快的機制，在某個時間點被拿掉了**。用 `git log --oneline --follow -- json_database_admin.html` 配合 `git show <commit> -- json_database_admin.html` 逐一比對歷史版本，找到 commit `2972a54`「fix: bypass raw GitHub cache in database admin」：`loadDatabaseFile()` 原本會優先打 **GitHub Contents API**（`api.github.com/repos/EMCtaipeiART/EMCtaipeiART.github.io/contents/backend/data/db.json?ref=main`），這支 API 直接查詢 git ref 的即時狀態，不像 `raw.githubusercontent.com` 是走 CDN（有邊緣節點不一致的問題，[[前台正式站改讀 raw.githubusercontent.com，繞開 GitHub Pages 部署延遲|已經在別的地方踩過這個坑]]），也不用等 GitHub Pages 部署管線跑完（1-3 分鐘）。但 2026-08-10 那次「redesign: rebuild admin backend with left-nav + per-table specialized views」（commit `ec09715`）整個重寫後台時，這個 API 呼叫被拿掉了，只剩讀 GitHub Pages 靜態檔那條慢路——這個退化發生在**昨天**，不是今天的任何修改造成的，只是使用者這幾輪測試才明顯感受到。`decodeGithubContent()`（base64 解碼）這個函式當時沒被砍掉，只是變成沒人呼叫的死代碼，一直留到現在。
- 影響檔案：`json_database_admin.html`。
- 影響功能：`loadDatabaseFile()` 新增 `useApi` 參數（預設 `true`），在正式站（`location.hostname==='emctaipeiart.github.io'`）且 `useApi` 為真時，優先打 GitHub Contents API（帶 `ref=commitSha||'main'`），失敗才 fallback 到原本 raw/Pages 那條路。`loadMetadata()` 一併加上 `useApi` 並往下傳遞。但因為 GitHub Contents API 未登入只有**每小時 60 次**的速率限制，跟同一天稍早加的 `backgroundPollTick()`（每 18 秒一次）疊在一起，一個分頁一小時就會打超過 200 次、遠遠超過額度，所以刻意把兩者分開：`backgroundPollTick()` 呼叫 `loadMetadata({fresh:true,useApi:false})`，只走不吃額度的 Pages 靜態檔路徑；「手動按重新讀取」「開啟/整頁重新整理」「同瀏覽器收到即時通知」（`refreshFromBackend`）這幾個低頻率、使用者主動想看到最新結果的情境維持 `useApi` 預設 `true`，優先吃 API 的即時性。額外順手修正 `start()`（整頁載入/重新整理時執行）原本呼叫 `loadMetadata()` 沒帶 `fresh:true`——這代表開新分頁或整頁重新整理時，會用一個固定沒變過的版本字串當快取鍵，可能吃到 GitHub Pages 最長 10 分鐘的 CDN 快取；現在強制 `fresh:true`，同時也會優先走 Contents API。
- 風險區塊：GitHub Contents API 的速率限制是**依 IP**計算，如果辦公室多人同時開著後台分頁、都走同一個對外 IP，額度會共用、更容易打滿；打滿後會自動 fallback 到原本的慢路徑（不會整個壞掉，只是那次請求變慢），但如果之後想更保守，可以考慮把「同瀏覽器收到即時通知」這條也改成不用 API、只靠 pin 住的 `raw.githubusercontent.com/{commitSha}/...`（這條路徑本身已經因為 pin 住確切 commit 而不受 CDN 節點不一致影響，只是不像 Contents API 那樣完全沒有任何 CDN 層）。
- 已檢查／驗證方式：`curl` 直接打 Contents API 確認回應含 `content`／`size`／`sha`，檔案 786KB 遠低於 API 1MB 限制的門檻；`curl -sI` 確認速率限制標頭（`x-ratelimit-limit: 60`）；本機 `python3 -m http.server` 開頁面，瀏覽器 console 直接發一次真實的 Contents API fetch＋`decodeGithubContent()` 解碼，確認 CORS 沒被擋、200、解出來的物件有 `tables`／`revision`；另外攔截 `window.fetch` 呼叫 `loadDatabaseFile({fresh:true,useApi:true})`，確認在 `localhost`（非正式站網域）時完全不會嘗試打 Contents API，直接走相對路徑，本機開發流程不受影響。
- 部署狀態：純前端，git push 後自動生效（一樣要等 Pages 部署跑完，通常 1-3 分鐘，這次修正本身第一次生效也受這個延遲影響）。
- commit：`5fd53e6`（merge commit `db2ecf9` 一起推送，同樣只是夾帶自動化資料同步 commit）。

### 2026-08-11 Asia/Taipei（同日再晚一點）— revert 上面那次改動：GitHub Contents API 也是被刻意拿掉的，不是意外

- 修改目的：上面那次「恢復 GitHub Contents API」推上去之後，`backend/test/backend.test.mjs` 第 282 行的 `assert.doesNotMatch(html, /DATABASE_CONTENTS_API|api\.github\.com\/repos\/EMCtaipeiART/)` 直接讓「Test JSON backend」CI 變紅（[run 31455356613](https://github.com/EMCtaipeiART/EMCtaipeiART.github.io/actions/runs/31455356613)，`run #323`）。**這是我這個 session 第二次犯同一種錯誤**：看到 git 歷史裡某個機制被拿掉、當下判斷是「改版時不小心弄丟的」，但沒有先查 `backend/test/backend.test.mjs` 有沒有相關斷言就直接動手，結果兩次都是——這個機制其實是**被刻意拿掉的**，而且早就有測試鎖住不准重新引入。用 `git log -1 --format="%B" 2bba45f` 查到移除它的那次 commit（`2bba45f`「Speed up JSON database admin editing」，2026-08-08 22:56）訊息寫著「...and use same-origin JSON reads」——同一分鐘後緊接著的 `ae615eb`「Test fast JSON admin updates」就是把這個決定鎖進測試的那個 commit。合理推測（跟這次我自己實測到 `x-ratelimit-limit: 60` 未登入每小時 60 次的限制完全吻合）：拿掉 Contents API 就是為了避免同源以外的跨網域請求可能被瀏覽器擴充功能／公司網路政策擋掉、或是把有限的 API 額度用在高頻率的讀取上，才刻意全部改成只讀同源的 `backend/data/db.json`。
- 影響檔案：`json_database_admin.html`（`git revert --no-edit 5fd53e6`，乾淨整個復原，含 `DATABASE_CONTENTS_API` 常數、`loadDatabaseFile()`／`loadMetadata()` 的 `useApi` 參數、`start()` 的 `fresh:true` 都一併復原掉；同一天稍早修好的 `pendingRefreshMessage`／`backgroundPollTick` 兩個改動不受影響，繼續保留）。
- 影響功能：後台讀取行為回到「只讀同源 `backend/data/db.json`」，不再嘗試打 `api.github.com`。
- 風險區塊：（檢討，不是新風險）**這是本次工作 session 累積的第二次同類型教訓，必須寫清楚避免第三次發生**：以後只要打算把 git 歷史裡「消失的機制」加回來，動手前必須先做兩件事，缺一不可——(1) `git log -S <關鍵字>` 找出移除它的那個 commit，讀完整的 commit message；(2) `grep` 整個 `backend/test/backend.test.mjs`（不是只看相關函式附近，是整份檔案）有沒有 `assert.doesNotMatch` 或其他形式鎖住這個決定。兩次的教訓都指向同一件事：**這個 repo 裡「看起來像意外遺留的死代碼／舊機制」，很高機率其實是刻意的決定**，因為維護者會習慣性地留一個 `assert.doesNotMatch` 測試把决定寫死，而不是只删代码了事。之後如果真的要改善資料庫後台的讀取速度，必須先完整讀懂 2026-08-08 那幾次 commit（`8c28940`／`6bf3c1b`／`580196c`／`84a86e7`／`7c45a66`／`2972a54`／`2bba45f`／`ae615eb`）想解決的問題全貌，不能只看單一個函式的 diff。
- 已檢查／驗證方式：`git revert` 後用 `git diff` 確認檔案回到 `57926da`（上一個穩定點）的狀態、`grep -c DATABASE_CONTENTS_API json_database_admin.html` 確認是 0；push 後在 GitHub Actions 確認新的 CI run（`run #324`）轉綠燈。
- 部署狀態：純前端，git push 後自動生效（一樣要等 Pages 部署跑完，通常 1-3 分鐘）。
- commit：`301041f`。

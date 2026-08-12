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

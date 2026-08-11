# EMC 設計需求系統｜架構總覽與修改紀錄

這份文件是整個系統的「地圖」：說明各檔案的角色、資料實際怎麼流動、部署方式，以及**每一次修改的紀錄**。目的是讓任何人（包含之後接手的 AI 助理）不用重新逆向工程一次，就能知道改一個東西會牽動到哪裡。

- 逐日、逐次修改的更早期歷史（2026 年 8 月 10 日以前）記錄在 [`MAINTENANCE_LOG.md`](MAINTENANCE_LOG.md)。
- **從 2026-08-10 這次大改版開始，之後所有修改都記錄在本文件最下方的「修改紀錄」章節**，不再寫回 `MAINTENANCE_LOG.md`。

---

## 目錄

1. [系統是什麼](#1-系統是什麼)
2. [整體架構：三套各自獨立的後端](#2-整體架構三套各自獨立的後端)
3. [資料層：八張 JSON 表](#3-資料層八張-json-表)
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

## 2. 整體架構：三套各自獨立的後端

這是最容易搞混、也是這次修改踩到最多坑的地方。系統裡其實有 **3 套完全獨立的後端**，各自有各自的部署方式：

| | 檔案 | 部署方式 | 現在的角色 |
|---|---|---|---|
| **A. 主系統 Apps Script** | `google_apps_script.gs`、`user_directory.gs` | Google Apps Script 編輯器手動部署（同一個專案的兩個檔案，兩個都要更新） | **正式環境唯一在跑的寫入後端**。`index.html` 在 `emctaipeiart.github.io` 這個網域、且沒有額外設定 API 網址時，預設就是打這支 Apps Script 的 `/exec` 網址（寫死在 `index.html` 的 `appsScriptFallbackApiUrl`）。 |
| **B. 上傳用 Apps Script** | `upload/Code.gs`、`upload/upload.html` | 另一個獨立的 Google Apps Script 專案，也要手動部署 | 負責大頭貼、海報、限時動態圖片上傳到 Google Drive，以及限時動態 24 小時到期排程。前台「設定我的頭像」「管理照片與 Reels」都是開一個 iframe 指到這支 Web App。 |
| **C. Node.js JSON 後台** | `backend/app.mjs` 等 | `npm start`，需要一台常駐 Node 主機 | **目前沒有正式部署**，只在本機/測試環境使用。GitHub Pages 是純靜態託管，不能跑 Node，所以正式站沒有走這條路。README 裡寫的「正式部署」是還沒真的做的建議方案。 |

### 資料實際怎麼流動

```
使用者填單／管理者後台編輯
        │
        ▼
主系統 Apps Script（A）── 用 GitHub Contents API 直接 commit ──▶ backend/data/db.json（repo 裡的檔案）
        │                                                              │
        └── 只有「填單案件」(database 表) 會額外回寫 ──▶ Google 試算表   │
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

重點：**GitHub Pages 上看到的資料，永遠是「上一次 Apps Script commit 完」的靜態快照**，不是即時打 API 查詢。這也是為什麼 commit 紀錄裡一直看到自動化帳號 `EMCtaipeiART` 跟 `github-actions[bot]` 交替 commit（`data: add` / `data: update` / `data: align history database with current database`）——那就是這個迴圈在跑。

Google 試算表本身（`1cHxWBed715H0XufNhMOOk3hcZPTSpq5rA64-b5m8vWY`）現在**不是資料的主要來源**，只在「新增案件」時被動接收一份備份，其餘七張表（設定、reels、加權計分標準…）完全不會寫回試算表。試算表上另外還有「階段」分頁等舊資料，那些已經跟即時系統無關，只是歷史殘留。

## 3. 資料層：八張 JSON 表

全部存在 `backend/data/db.json` 一個檔案裡的 `tables` 物件底下，`backend/schema.mjs` 定義了 canonical 欄位。

| 表名 | primaryKey | 用途 |
|---|---|---|
| `database` | 案件編號 | 所有設計案件，前台填單/案件列表的主資料 |
| `加權計分標準` | （無，用列序） | 設計種類→階段→項目細節 的加權分數規則；**同時也是前台選單「項目細節」選項的來源**（2026-08-11 起統一） |
| `短連結` | 短碼 | 一般短網址對照表 |
| `補充資料連結` | 案件編號 | 每個案件的補充資料 A–D 連結 |
| `修改統計表` | （無，用列序） | 案件修改歷程 |
| `設定` | 帳號 | 設計師與一般使用者的個人設定（頭像、技能、對話框…），有 37 個欄位，其中約 26 個是介面暫存/草稿欄位，不是真正的「個人資料」 |
| `reels` | （無，用列序） | 限時動態、按讚倒讚、留言 |
| `bug_report` | （無，用列序） | 問題回報，用 5 個狀態時間戳記錄流程 |

另外 `階段`、`平面新開專案`、`影音新開專案` 也存在 JSON 裡，但**目前的 `json_database_admin.html` 後台沒有把這三張表列進管理介面**（`TABLE_ORDER` 沒有包含），如果之後要管理它們，要在後台程式裡補上。

## 4. 寫入與備份規則（重要）

`google_apps_script.gs` 裡的 `mutateGithubJsonDatabase_(action, payload, mutator, options)` 是所有寫入的共用函式，決定「這次寫入要不要順便回寫 Google 試算表」：

- 只有 `githubJsonDatabaseWriteAction_`（也就是前台「填寫設計需求」表單觸發的 `add`/`batchAdd`/`update`/`batchUpdate`/`delete`）會傳 `{allowSheetBackup:true}`，才會觸發 60 秒後把 `database` 分頁整個覆寫回試算表。
- 資料庫後台（`json_database_admin.html`）呼叫的 `adminTableUpdate_`／`adminTableDelete_`／`adminTableInsert_`（八張表管理介面）**一律不回寫試算表**，JSON 是唯一資料來源。
- 這個規則是 2026-08-11 才修好的（詳見下方修改紀錄）——在那之前，後台編輯任何一張表其實都會偷偷把整個分頁覆寫回試算表，跟畫面上顯示的「不等待試算表備份」不一致。

加權分數計算：`database` 表的「加權」欄位，由前台送出時用 `calculateRowWeight()`（讀 JSON 的 `加權計分標準`）算好後直接送出；後台編輯加權規則時，會在同一次交易內用 `recalculateDatabaseWeights_()` 把所有既有案件的分數重新算一次，確保舊案件也套用最新規則。

## 5. 前台 `index.html`

單一巨大檔案（一萬多行），內嵌兩段 `<script>`。關鍵機制：

- **登入**：Google OAuth 或 ERP OAuth（PKCE），登入後依「管理者／設計組／一般使用者」分權限。
- **API 位址解析**（`resolveDesignApiUrl`/`apiUrl`）：`?api=` 查詢參數 > `<meta name="design-api-url">` > localStorage 存的值 > 依網域自動判斷（`emctaipeiart.github.io` 或 `file://` 都會 fallback 到主系統 Apps Script）。
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
- `設定`：一人一張卡片，37 個欄位裡只有 12 個「主要欄位」直接顯示，其餘 26 個收進可折疊的「進階」區塊。
- `reels`：卡片＋留言泡泡，會顯示已過期但保留的限動。
- `bug_report`：依狀態分欄的看板（Kanban）。

登入方式：沿用前台的管理者登入狀態（`localStorage` 的 `designRequestEditorToken`），沒有獨立密碼。本機測試可以用 `local-admin:YYYYMMDD`（當天台北日期）這個特殊 token 繞過，本機 Node 後台也認得這個 token。

## 7. 其他頁面

| 檔案 | 用途 |
|---|---|
| `design_dashboard.html` | 歷史案件統計儀表板，讀 `data/database_archive.json`（GitHub Actions 每小時自動產生的快照） |
| `database_archive_admin.html` | 封存 JSON 的管理頁，讀寫 `data/database_archive.json` |
| `json_upload.html` | 給 Node.js 後台用的圖片上傳頁，**正式站目前用不到**（正式站走上傳用 Apps Script） |
| `upload/upload.html` | 上傳用 Apps Script 的前端頁面，正式站實際在用的圖片上傳介面 |
| `404.html` | 短連結／補充資料連結導向頁 |

## 8. 部署方式

**會自動生效（git push 之後）：**
- 所有純前端檔案：`index.html`、`json_database_admin.html`、`design_dashboard.html`、`database_archive_admin.html`、`404.html`、CSS/圖片等。
- `backend/**`、`scripts/**`：GitHub Actions 會用它們跑測試、重新產生快照，但**不會部署成正式跑的 Node 服務**（目前沒有正式 Node 主機）。

**不會自動生效，需要手動部署：**
- `google_apps_script.gs`、`user_directory.gs` → 要到 Google Apps Script 編輯器貼上最新內容，「部署 → 管理部署 → 編輯 → 新版本」。**兩個檔案是同一個專案，要一起貼、一起部署一次**。
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

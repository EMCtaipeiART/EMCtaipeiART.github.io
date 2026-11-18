# 企劃專案全流程盤點：填單 → 寄信 → 設計師回覆 → 備份 → 修改紀錄

> 整理日期：2026-11-18。依據：`site.js`、`worker/src/*`、`scripts/nas_design_image_lib.mjs`／`nas_design_image_watcher.mjs`、
> `scripts/nas_design_image_watcher.README.md`，以及 2026-10～11 的實際稽核紀錄（`backend/data/audit-log.json`）與線上資料。
> 標「（推論）」的是我從程式／資料推出來、沒有直接實測的地方。舊的 `SYSTEM_OVERVIEW.md` 第 2 節（主系統 Apps Script）已過時，以本文件為準。

---

## 0. 一張圖看完

```
企劃／專案人員                設計師                         系統
────────────────────────────────────────────────────────────────────────
① 填單 (index.html 表單) ──────────────────────▶ Worker add/batchAdd
   │  輪替決定設計負責人、算案件編號、加權
   ▼
② 「送出並撰寫信件」→ 寄需求信（Gmail，用企劃自己的帳號）
   │  信件串ID／寄件帳號 寫回案件；可排程、可合併多案
   ▼
                       ③ 設計師開始做：狀態 未開始→執行中
                          做完檔案存到 NAS 資料夾
                       ④ 在系統按「回信 → 設計師回覆信」
                          選圖片來源(NAS 同上次路徑／選資料夾／電腦上傳)
                          ──▶ 立即備份 NAS 檔案到 Google Drive、寫修改統計表
                          ──▶ 寄回覆信 ──▶ 狀態 → 過稿中
                          ◀── NAS 爬蟲(每分鐘)接手追蹤之後新增的檔案
⑤ 企劃收到信：
   ├ 客戶OK → 進度頁勾選「確認送出」→ 已完成（記客戶確認人／時間）
   └ 客戶要改 → 「需要修改」→ 填修改需求信 → 寫修改紀錄(第N輪)
                              → 狀態 → 修改中 ──▶ 回到 ③（輪次+1）
```

三個後端／資料位置要分清楚：

| 元件 | 位置 | 做什麼 |
|---|---|---|
| 前台 | `index.html` + `site.js` + `site.css`（GitHub Pages，emc-art.com） | 所有畫面與按鈕 |
| Worker＋Durable Object | `worker/`，`https://machi-design-api.machi-chen.workers.dev/api` | 所有寫入、權限、寄信、排程、稽核；改完要 `wrangler deploy` |
| 資料庫 | repo 內 `backend/data/db.json`（Worker 用 GitHub Contents API commit） | 8 張 JSON 表；Pages 重新部署後前台才讀得到（落後約 1–3 分鐘） |
| NAS 爬蟲／選擇器 | `scripts/nas_*.mjs`，跑在每位設計師的 Mac（launchd） | 掃 NAS 檔案、壓縮預覽、上傳 Drive |
| 上傳 Apps Script | `upload/Code.gs`（Google Apps Script，獨立部署） | 把圖片存到 Google Drive，回頭呼叫 Worker `addCaseDesignImages` |

---

## 1. 填單建立專案

**入口**：首頁上方「開始新增設計需求」→ 表單頁（`site.js` 的 `renderForm`）。

### 1.1 欄位
客戶別、專案名稱、專案負責人、設計種類（平面／影音）、階段、設計負責人、數量、開始／結束時間、**幾點前收到稿件（選填，2026-11-09 新增，欄位「收稿時間」）**、使用平台、補充資料 A–D（設計簡報／客戶素材／參考範例／其他，各有說明＋連結）、「這是新專案」開關。

- 專案負責人：管理者、Machi、設計部可自行填；其他人固定為登入者本人。
- 開始／結束不到 3 天（`rangeDays` 在 1～2 天）→ 自動在「項目細節」加「急件」。
- 可「批次新增」：每一筆各有一組欄位，下一筆沿用上一筆值（含 dueTime）。
- 前台驗證在 `validateRow`：客戶別、專案名稱、專案負責人、種類、階段、數量、設計負責人必填；有替代設計師時要填原因。

### 1.2 「這是新專案」與設計師輪替
- 勾選後，**設計負責人由後端依輪替順位自動指定**，前台傳 `expectedDesigner`（輪替第一位）。
- 輪替組別：平面 = Machi／Anna／Amber／Leona；影音 = Karl／Noise（`worker/src/model.ts` 的 `PROJECT_GROUPS`，實際名單取自「設定」表的設計師列）。
- 可指定「替代設計師」＋原因（至少 2 字），後端 `applyRotation`：
  1. 寫一列到 `平面新開專案` 或 `影音新開專案` 表（預計設計師、替換、調整原因）。
  2. 把實際接案的人排到輪替最後。
  3. 案件列的「新專案」欄寫 `v`。
- 沒勾新專案：設計負責人由填單者手選，不動輪替。

### 1.3 送出時後端（`addRequests`，`worker/src/database-coordinator.ts`）
1. 權限：`request.create`。
2. `requestId` 防重複（idempotency），同一個 requestId 重送不會建兩筆。
3. `toSheetRow` 把前台 key 轉成表頭（`KEY_TO_HEADER`，`worker/src/model.ts`），算「加權」（`加權計分標準` 表，依種類／階段／項目細節）。
4. 案件編號 `nextCaseId`：`YYMM` + 4 位流水號（例 `26110054`）。**注意：刪掉當月最新案件後，下一筆會拿到同一個編號**，這會影響 NAS 爬蟲的本機狀態（見 §6.6）。
5. 填單時間、月份、補充資料連結表（`補充資料連結`）同步。
6. 狀態初始為「未開始」。
7. 寫稽核紀錄「案件新增」，commit 到 GitHub（`db.json`、`audit-log.json`）。

### 1.4 欄位對照（database 表主要欄位）
案件編號、月份、客戶別、專案名稱、專案負責人、設計種類、階段、數量、開始日期、結束日期、**收稿時間**、設計負責人、項目細節、修改次數、狀態、加權、填單時間、繳交時間、使用平台、設計簡報／客戶素材／參考範例／其他（說明＋連結）、設計圖資料夾連結、設計圖檔名關鍵字、設計圖資料夾清單、Gmail信件串ID、Gmail寄件帳號、客戶確認人、客戶確認時間、新專案。（`backend/schema.mjs` 的 `DATABASE_HEADERS`）

---

## 2. 寄需求信

建立案件後直接進信件編輯頁（`renderMail`）；也可在案件列表按「發信」。

### 2.1 寄信方式
- **用寄件者自己的 Gmail 帳號寄**：Worker 用該帳號儲存的 Gmail OAuth token（`getValidGmailAccessToken`）呼叫 Gmail API `messages/send`。登入帳號必須先「連接 Gmail」。
- `sendCaseMail`：權限 `request.mail`；**案件已有信件串就擋**（`THREAD_EXISTS`，要改用回信）。
- 寄出成功後把 `Gmail信件串ID`、`Gmail寄件帳號`（＝寄件人帳號）寫回案件；**同一封合併信的每個案件都綁同一條信件串**。
- 信件內容：主旨、內文 HTML、簽名檔、內嵌圖片、附件（`resolveGmailInlineImages`、`resolveGmailAttachments`）。範本內含客戶別、需求描述、數量、尺寸、是否印刷、使用平台、交件日期、補充資料 A–D。

### 2.2 合併信件
同一個專案拆成多筆案件時，可勾選打包成一封寄出：主旨串接案件編號、共同內容只印一次、數量加總，每筆案件都綁同一條信件串。後續回信不論從哪一筆開，都是同一條討論串。

### 2.3 排程寄出（指定排程時間）
- `scheduleCaseMail`（新案）／`scheduleCaseReply`（回信）：把信存進排程佇列，**不立刻寄**。
- Cloudflare Cron **每分鐘**執行 `runScheduledDispatch`（`worker/src/index.ts` 的 `scheduled`）→ `dispatchScheduledMailItem` 到時間才真正寄出；格式與立即回信共用同一套組信邏輯。
- 排程時間必須在 3 分鐘以後。
- 稽核紀錄：排程當下記「寄信／排程」，真正寄出時記「寄信／排程寄出」（已觀察到兩種 note）。

### 2.4 讀信權限（昨天剛修過）
`canAccessCaseMailThread`：案件設計負責人、寄件帳號擁有者、或信件 From／To／Cc 裡有該帳號才能看／回；讀信件串一律用「寄件帳號擁有者」的 Gmail token。2026-11-04 補了「設計負責人視為有權限」。

---

## 3. 設計師作業與狀態

### 3.1 狀態一覽
`未開始` → `執行中` → `過稿中` → `已完成`；另有 `修改中`、`暫停中`（「已取消」已併入暫停中）。

| 轉換 | 誰／什麼觸發 | 備註 |
|---|---|---|
| 未開始 → 執行中 | 設計師手動（列表／卡牌／詳情）。稽核：actor=設計師，note=update | 常同時選「項目細節」 |
| 執行中／修改中 → 過稿中 | 設計師按「設計師回覆信」寄出（前台 `afterDesignerSend` → `applyMove`） | **2026-11-17 起**：合併信分類搬圖到別案件時，後端也會把目標案件改成過稿中（`moveCaseDesignImages`） |
| 過稿中 → 修改中 | 企劃新增修改紀錄（`addModificationRecord` 回傳 `statusChanged`） | 已是修改中／暫停中則不動 |
| 過稿中 → 已完成 | 企劃（專案負責人本人）在進度頁勾選「確認送出」（`ownerConfirmCases`），或設計師／管理者手動 | 記錄「客戶確認人」「客戶確認時間」；一次最多 200 筆；只能確認自己負責且目前是過稿中的案件 |
| 任一 → 暫停中 | 手動 | 已完成／暫停中不會被自動邏輯改回 |

### 3.2 卡牌與列表
- 卡牌：案件編號、客戶別、逾期標記、專案名稱（含「新專案」「急件」小標）、種類／階段、日期範圍、**收稿時間黃色標籤**、項目細節、進度條（執行中／修改中）、人員頭像、數量、修改膠囊（初稿／N 修）。
- 列表：預設欄位不含「結束」，所以收稿時間標籤放在專案名稱旁；有開「結束」欄時日期下另顯示一行。

---

## 4. 設計師回覆（核心流程）

入口：案件列／詳情「回信」→ 選回信方式（`openReplyChooser`）：

| 方式（mode） | 用途 | 會做什麼 |
|---|---|---|
| 一般回信 | 一般往來 | 只寄信 |
| `modification` 填寫修改需求信 | 企劃要求修改 | 寄信 ＋ 寫修改紀錄 ＋ 狀態 → 修改中 |
| `designer` 設計師回覆信 | 設計師交稿 | 圖片備份、寄信、狀態 → 過稿中、確認這一輪完成 |

### 4.1 設計師回覆信：選圖片來源
1. **同上次路徑**（`mode=reuse`）：案件已登記過 NAS 路徑時出現。開本機 `http://<本機>:8877/picker` 小視窗（背景自動執行，不用逐層選），帶入既有路徑與關鍵字，自動呼叫 `/api/confirm` 立即備份；備份完成後只把**該輪**圖片放進信件。失敗時（例如 NAS 沒掛載）會透過 postMessage 回報並跳 toast，不再一直卡在「圖片上傳中…」（2026-11-04 修）。
2. **選擇 NAS 資料夾**：同一個本機選擇器，自己點資料夾、可填「檔名關鍵字」。開啟時會依客戶別在 `專案企劃部/執行中/<客戶別>` 自動導覽。
3. **選擇電腦檔案上傳**：走 Apps Script 上傳頁（iframe）→ Google Drive。
4. 也可略過圖片（`skip`），只寄信。

> 網站是 HTTPS，無法 fetch 內網 HTTP，所以選擇器一律用 `window.open()` 開新分頁／視窗，再用 `postMessage` 把結果傳回網站（`machi-nas-folder-selected` 事件）。網站 `index.html`／`site.js` 內固定了選擇器位址 `nasFolderPickerBaseUrl` 與 `nasFolderPickerToken`（不是機密，只擋同網段亂戳）。

### 4.2 寄出
`replyCaseMail`（或排程 `scheduleCaseReply`）：
- 用**目前登入使用者自己的 Gmail**，在**寄件帳號擁有者的信件串**上回覆，並用 `findOwnMailboxThreadId` 找到使用者信箱中對應的 threadId。
- 標頭 In-Reply-To／References 依串內最後一封（排除草稿）組成，附標準引用區。
- 信件串內若所有信都被濾掉（草稿／垃圾桶），改取所有非草稿信（2026-11-04 修）。
- 圖片：信件內嵌的圖會用 `cid:` 內嵌寄出；NAS 備份後的縮圖以 Drive 連結嵌入；備份仍在背景進行時，允許先寄出，主頁再等最多 3 分鐘讓備份完成。

### 4.3 寄出後（前台 `afterDesignerSend`，依序）
1. **狀態先改為過稿中**（不等備份）。
2. 等圖片備份完成（最久 3 分鐘）。
3. 信內貼上的照片另備份（`backupReplyInlineImages`），排除已經由 NAS 備份的。
4. `drSaveClassification`：合併信的「分類確認」寫入後台（哪個檔案屬於哪個案件，`classifyCaseFiles`）。
5. `drDistribute`：依分類把檔案搬到別的案件（`moveCaseDesignImages` 跨案件；目標案件的 NAS 追蹤與檔名釘選一併轉移；目標案件若沒有該輪就自動建立）。
6. 第 N 輪（N>0）→ `setConfirm` 自動把該輪標成「設計師已確認修正」（`updateModificationConfirm`，寫確認修正日）。
7. 重新整理畫面。

### 4.4 合併信件分類（設計師回覆時）
一封回覆同時回覆 N 個專案時，畫面出現「合併信件分類」：每個檔案一列（縮圖＋下拉選案件），預設全歸在這封信的主案件；按「分類確認」或直接寄出都會依目前選擇歸類。已知陷阱：搬圖後別案的狀態曾經漏改（已修）。

---

## 5. 修改與修改紀錄

### 5.1 資料表：`修改統計表`
一案多列，一列 = 一輪。主要欄位：案件編號、修改次數（0＝初稿、1＝一修…）、建立日期、**修改日期（企劃端的日期，現在 UI 稱「預計收到日」）**、修改內容、修改內容連結（JSON）、修改人、確認修正日（設計師確認完成才有值；初稿自動帶）、圖片連結（JSON：fileName＋Drive URL）、圖片來源（`nas-watcher`／`nas-refresh`／`manual`／`manual-move`／`mail-inline-upload`）、圖片更新時間、待修改圖片（JSON 檔名清單，可選）。

案件列的「修改次數」由 `recalculateDatabaseModificationCounts` 依本表重算。

### 5.2 新增修改紀錄的三條路徑
| 路徑 | 觸發 | 內容 | 日期欄 |
|---|---|---|---|
| A. 進度頁／案件列「需要修改」 | 企劃按鈕 → `startReply(id,'modification')` → 寄信後 `recordModificationFromReply` | 取信件本文（去簽名、去「Hi 名字,」開頭），帶超連結文字 | 寄信當天 |
| B. 修改紀錄彈窗「＋新增修改紀錄」 | 手動填表（欄位標籤 2026-11-12 改為「預計收到日」） | 手填 | 手填 |
| C. NAS 爬蟲自動建立 | 初稿或沒有紀錄的輪次 | 「初稿完成（NAS 自動建立）」 | 自動 |

`addModificationRecord`（Worker）：寫入下一輪、同日同內容會去重（`deduplicated`）、狀態不是修改中／暫停中就改成修改中並回傳 `statusChanged`。

> **已修的漏洞**：
> - 2026-11-11：選「指定排程時間」寄出的修改需求信，原本完全不寫修改紀錄、狀態也不變（26110054、26100187 就是這樣）。現在排程當下就寫第 N 輪。
> - 仍存在：企劃若不經系統、直接在 Gmail 回信，系統不會知道（盤點時發現 26100165、26100167/168、26100169、26100179、26100151、26100190、26100195 的來信次數多於修改紀錄）。

### 5.3 確認與刪除
- 設計師確認修正完成：`updateModificationConfirm`（寫確認修正日；權限 `modification.confirm`）。設計師回覆信寄出時對第 N>0 輪會自動做。
- 刪除某輪：`deleteModificationRecord`，修改次數重算。
- 圖片搬輪次／搬案件：`moveCaseDesignImages`；刪單張：`removeCaseDesignImage`。

### 5.4 加權與完工
案件的「加權」在建案時算好（種類／階段／項目細節對照 `加權計分標準`）。「已完成」時統計用；若修改輪次影響統計表，由 `修改統計表` 與 `recalculate_*` 腳本重算。（細節推論：未逐行驗證計分公式。）

---

## 6. NAS 爬蟲與備份（細節）

### 6.1 角色分工
| 程式 | 啟動方式 | 作用 |
|---|---|---|
| `nas_design_image_watcher.mjs` | launchd 每 60 秒（設計師電腦）；管理者主機用 cron | 掃描、壓縮、上傳、輪次判斷 |
| `nas_folder_picker_server.mjs` | launchd 常駐（`KeepAlive`），port 8877 | 選資料夾＋「立即備份」＋ reuse 模式 |
| `nas_design_image_lib.mjs` | 被上面兩支共用 | 所有核心邏輯 |
| `nas_watcher_launcher.mjs` | launchd 實際執行的啟動器 | 每 10 分鐘讀 `scripts/nas_watcher_release.json`，有新版就下載更新並重啟 |
| `publish_nas_update.mjs` | 管理者執行 | 一鍵發布新版（`--skip-tests` 可略過測試），各電腦 ≤10 分鐘自動更新 |
| `nas_watcher_installer.mjs`＋`install_nas_watcher.command` | 新電腦安裝 | 裝到 `~/Library/Application Support/MachiNasWatcher`，記錄檔在 `~/Library/Logs/` |

必須跑在 macOS（影片截圖用 `qlmanage`、壓縮用 `sips`），且連得到 NAS（`smb://EMCNAS_Prod.local/設計部`，掛載點 `/Volumes/設計部`；沒掛載時自動請 Finder 連線，最多等 2 分鐘）。

### 6.2 案件清單怎麼來
讀 `dbJsonUrl`（`https://emctaipeiart.github.io/backend/data/db.json`，即 GitHub Pages 靜態檔）。**資料有 1–3 分鐘部署延遲**，所以程式有多處「剛上傳、db.json 還沒更新」的保護（見 6.5）。

`discoverProjects`（2026-11-12 起）篩出：**狀態＝過稿中**，且 `resolveCaseFolders` 解得出至少一個來源資料夾（欄位「設計圖資料夾清單」優先，其次單一「設計圖資料夾連結」＋「設計圖檔名關鍵字」）。
> 修改中案件**不再掃描**（之前會在設計師還沒回信時就把半成品記進新輪次）。現有 10 件已被提早抓過的輪次尚未清理（26100140 第 2 輪 9 張等）。

### 6.3 掃描規則
- 只看指定資料夾「這一層」的檔案，**不進子資料夾**。副檔名：jpg／png／webp，影片 mp4／mov／m4v（截一張畫面當紀錄圖）。
- **檔名關鍵字**：有填就只收檔名包含該字串的檔案（不分大小寫、純子字串），每一輪沿用同一個關鍵字；沒填則該資料夾底下全部都算（選擇器會警告可能誤抓）。多資料夾時每個資料夾可有自己的關鍵字。
- 壓縮：最大邊 1600 px、JPEG 品質 70（`maxDimension`／`jpegQuality`）。
- 本機狀態檔 `sync-state.json`（每個檔案的大小／mtime／歸屬輪次 `assignedRound`、資料夾層級 `sealedRound`、`pendingAfterRound`、`uploadAttempt`）與預覽圖目錄；整個資料夾刪掉會讓所有檔案被當新增重新判斷。

### 6.4 輪次判斷
- `computeRound`：目前這個案件在 `修改統計表` 的最大「修改次數」＝這次要歸的輪次（0＝初稿）。
- **封存（seal）**：某資料夾某輪成功上傳一批後標記 `sealedRound`。之後同檔再次儲存、或之後才出現的新檔，只更新本機待傳預覽，標 `pendingAfterRound`，**等資料庫開出下一輪**才歸到新輪次。一次掃描同時找到的多張初稿會一起上傳，不受封存影響。
- `roundDelivered`：封存只有在「這輪確實交付過」才算數（本機有檔案歸到這輪，或資料庫這輪已有圖片）。用來擋「案件編號被重複使用、新案件繼承舊案件的封存」這類殘留（26090074 曾因此整個初稿消失）。
- **待修改圖片**（`computeTargetImages`）：企劃在修改需求勾選的檔名清單；有的話這輪只收這些檔名。若這輪資料夾裡的新檔一個都對不上（常見：設計師存成新檔名），退回「不限制」——寧可多傳也不要永遠卡住，多傳的可在修改紀錄彈窗刪除。
- 同輪同檔名只寫一次（`lockNasFileNames`）。

### 6.5 上傳與防重
1. 流程：掃描 → 壓縮 → 分批（chunk）→ `uploadRound` → POST 到 Apps Script（`appsScriptUploadUrl`）→ Google Drive 依「設計師／客戶別／年度／月份／案件編號」建巢狀資料夾存檔 → Apps Script 回頭呼叫 Worker `addCaseDesignImages`（帶服務金鑰 `NAS_WATCHER_API_KEY`）寫進 `修改統計表`。
2. **防重鍵**：案件＋輪次＋相對路徑＋mtime＋size（`createCaseDesignUploadDedupeKey`）。POST 回應逾時但其實成功時，重送會得到同一個 Drive 檔，不會多一份。
3. 逾時後狀態：`uploadAttempt` 暫存「結果待確認」，下一輪先核對正式資料庫，**五分鐘內不重送**。
4. **多台電腦同時跑的三層保護**：①同輪同名圖（去副檔名比對）資料庫已有就跳過；②新電腦第一次掃到、資料庫別輪已有同名圖，視為別台備份過，沿用那一輪不上傳（除非 mtime 明顯比記錄晚＝新版本）；③相同檔案版本共用同一個 Drive 檔。
5. Worker 端最後一道：`addCaseDesignImages` 相同 URL 直接忽略、NAS 來源同檔名同輪只收第一張。
6. 圖片來源標記：`nas-watcher`（爬蟲）、`nas-refresh`（回覆時手動重新備份）、`manual`（手動上傳）、`manual-move`（搬移）、`mail-inline-upload`（信內貼圖備份）。

### 6.6 回覆時「立即備份」與 `refresh`
設計師按「同上次路徑」時（`refresh`＝`nas-refresh`）：
- 明確要求把資料夾現在的檔案備份進**這一輪**，不套用「封存後新檔等下一輪」。
- NAS 上存檔時間比資料庫這輪備份晚的同名檔＝回覆前才改好的新版，**取代**這輪原本那張（同位置，不多一張）。
- 之前被設計師刪掉紀錄的圖，若本機仍標為已歸本輪、但資料庫任何一輪都沒有，會補回待上傳。

### 6.7 其他保護與已知限制
- 子資料夾完全不掃（`ignoreFolderNames` 是舊機制，無作用）。
- 補填關鍵字不會清掉先前誤抓的圖，要手動刪。
- 案件編號重複使用（刪掉當月最後一筆）→ 本機同步紀錄會繼承舊案件，已用 `roundDelivered` 緩解。
- NAS 沒掛載的 Mac 會失敗；選擇器小視窗失敗時改成 toast，不再卡畫面。
- `index.html` 內的選擇器位址固定指向管理者那台 iMac（`nasFolderPickerBaseUrl`），其他電腦的選擇器是否被前端使用：（推論）仍是各人本機 8877。

---

## 7. 稽核、備份與發布

| 項目 | 說明 |
|---|---|
| 操作稽核 | Worker 每筆寫入產生紀錄（案件新增、欄位修改、狀態變更、寄信、寄信失敗…），先排佇列，Cron 每分鐘批次寫入 GitHub `backend/data/audit-log.json`（commit 訊息 `data: audit log`） |
| 資料庫 commit | 每次寫入由 Worker 用 GitHub Contents API commit 到 `db.json`（訊息 `data: <action> via Cloudflare Worker (使用者)`） |
| 歷史庫 | `data: align history database with current database` 自動對齊 |
| Durable Object 專屬資料 | 每週加密備份到 `do-backup.enc.json`（`data: encrypted backup`），含記事本、專案分配、值日替換 |
| 限時動態 | 到期／被移除前先備份到 Google Drive 才刪 |
| 前端部署 | push 到 `main` → GitHub Pages；改 `site.js` 後要跑 `node tools/stamp.cjs` 並提交 `index.html` |
| Worker 部署 | `cd worker && npx wrangler deploy`（不在 Git 裡） |
| NAS 程式發布 | `node scripts/publish_nas_update.mjs`，各電腦 ≤10 分鐘自動更新 |

---

## 8. 權限速查
`request.create`（填單）、`request.edit`、`request.status`（改狀態，設計師專屬）、`request.mail`（寄信／回信）、`modification.create`、`modification.confirm`、`media.manage`（NAS 路徑／圖片管理）、`request.delete`／`confirmDeleteCases`（刪除需管理者確認）、管理者另有後台資料表管理。專案負責人確認完成（`ownerConfirmCases`）不看角色，看「案件的專案負責人是登入者本人」。

---

## 9. 最近（2026-11）修過的問題與目前還開著的缺口

**已修**
1. 昨天無法寄信：讀信權限補上設計負責人、NAS reuse 視窗失敗不再卡住、信件串全被濾掉的退路、錯誤原因直接顯示。
2. 排程寄出的修改需求信沒寫修改紀錄（2026-11-11）。
3. NAS 爬蟲在修改中就提早抓圖（2026-11-12）：改為只掃過稿中。
4. 合併信件搬圖到修改輪次，目標案件沒改成過稿中（2026-11-17，26110135）。
5. 新增「幾點前收到稿件」欄位；修改紀錄日期標示為「預計收到日」；NAS 路徑／合併分類區塊的深色模式。

**還開著**
1. 10 個案件的修改輪次已被提早抓了圖（26100140 第 2 輪 9 張、26110001 第 3 輪 3 張、26100132 第 1 輪 4 張，另 26100017／069／016／081／099／106／107 各 1～2 張），尚未清理。
2. 企劃在 Gmail 直接回信，不經系統就不會有修改紀錄（盤點出 9 件可能漏記，尚未補）。
3. 回信自動記下的修改紀錄，日期是「填寫日」而非客戶的預計收到日，但列表現在統一標為「預計收到」，可能不準；若要準確，回信時需新增一個預計收到日欄位。
4. Anna 無法讀 26100203 信件串的原因仍未查明（Machi 帳號讀得到，疑為她的登入身分／畫面狀態）。
5. 本地資料／歷史對齊的測試偶有「archive snapshot…」失敗（資料同步時間差，與程式無關）。

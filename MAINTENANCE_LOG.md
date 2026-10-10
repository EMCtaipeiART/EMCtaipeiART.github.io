# 維護紀錄

> 每次修改網站後在最上面補一筆（新的在上）。AGENT.md 要求的修改紀錄放這裡。

## 2026-10-06

- 資料庫後台「修改列表」圖片：縮圖網址改 `=w150`（原圖連結不變），每輪圖片收進「顯示圖片（N）」摺疊區、展開才載入（`json_database_admin.html` 的 `modificationThumbUrl()`＋`toggle` 監聽）；純前端，未做瀏覽器實測。

## 2026-10-04

- v5.0 編輯流程：從列表／卡牌按「編輯」進入編輯頁，取消或儲存後直接回到原本的列表（`state.editFrom`），不再先落到案件詳情頁；從詳情頁（頂部「編輯案件」或底部「編輯」）進入的仍回到詳情頁。

- v5.0 卡牌右上角按鈕改成純圖示的圓形（28px，滑過顯示文字提示），只保留信件（發信／串接／回信）與編輯，移除刪除（刪除仍在列表與詳情頁）。

- v5.0：信件串內文改 13px；簽名檔裡的電話／手機／地址不再強制藍色（改回黑色、無底線）；卡牌右上角加入信件（發信／串接／回信）、編輯、刪除（設計師）按鈕，與列表同一套處理流程（卡牌外層改成 div，避免按鈕巢狀）。

- v5.0 案件詳情頁最下方加回操作列：信件（發信／串接／回信，邏輯同列表）、編輯、刪除（設計師）；沿用列表的按鈕與處理流程，刪除後自動回到列表。

- v5.0 信件串改成舊網站呈現：每封信一張圓角卡，頂列「寄件人：／收件人：／副本人：」顯示姓名（點線底線，滑過顯示信箱）＋日期，右側「收合／展開」，預設展開最後一封（讀信模式展開首封）；信件編輯器補回「選擇聯絡人」按鈕（收件人、副本各一，彈窗依單位分組、搜尋、全選，勾選即時加入／移除標籤）；副本標籤超過 3 個時收成「+N 位」。

- v5.0 信件欄邏輯比照舊網站：沒有 Gmail 信件串時，專案端＝「發信」、設計部＝「串接」（彈窗用 `searchGmailThreads` 以案件編號搜尋、點選串接，或手動貼 Message-ID，Worker `bindExistingThread`）；已有信件串＝「回信」→回信方式四選一：填寫修改需求信（寄出後自動 `addModificationRecord` 記入修改紀錄）、設計師回覆信（帶入預設範本與這輪設計圖連結；未移植 NAS 資料夾選擇／上傳）、一般回信、直接讀信（唯讀，預設展開首封）；回信編輯器上方顯示信件串（`getCaseMailThread`，內容經白名單過濾，收件人／副本帶入建議值）。信件／內容欄按鈕改成與列表小膠囊同高（26px）同字級（12px）。

- v5.0 工具列調整：移除「新到舊／舊到新」按鈕，排序改到列表表頭（點欄位標題 ▲升冪→▼降冪→還原，每欄各別排序，數字／日期／狀態依實際值排）；網格排列／列表排列／欄位三顆只留圖示、合成同一組（欄位只在列表排列出現）；網格與看板一律新到舊。

- v5.0 卡牌與詳情頁：狀態「修改中」也顯示進度條（與執行中同一套倒數進度與漸層）。

- v5.0 簽名檔／編輯器內的連結（電話、信箱、地址）改回藍色：全站 `a{color:inherit}` 讓它們變黑，已對 `.signature／.editor／.mini-editor` 內的連結強制藍色。

- v5.0 編輯器介面還原舊網站樣式（信件編輯器與設定頁的範本／簽名檔共用同一個工具列產生器 `barHtml`）：圓角白底工具列、圖示按鈕（復原／重做、文字大小 tT、字型 字、粗斜體底線、對齊、黑色圓點文字顏色、連結）、範本工具列內的「插入收件人名／插入項目細節」、圓角編輯區、「設為預設」綠色圓鈕、紅色圓形刪除鈕、綠色膠囊「新增／儲存」；文字大小與字型選單已接上。

- v5.0 左側「設定」改為站內設定頁，移植舊網站個人設定：①個人設定（顯示名，設計部同仁鎖定；Worker `saveUserSettings`）②信件範本（多筆、預設、富文字、插入 {收件人名}／{項目細節}）③簽名檔設定（命名多組、預設）④客戶設定（管理者／Machi／企劃部／專案部；權限設定組織樹＋全選規則、預設信箱、喜愛設計師；Worker `saveCustomerSettings`，只送有變動的欄位、自己固定勾選）。資料讀自 `getUserSettings`，與舊系統同一份。信件編輯器同步接上：新增「範本」按鈕（套用 {收件人名}／{項目細節}）、預設簽名檔自動帶入、多組簽名檔可挑選。未移植：更換頭像（需上傳頁）、設計師設定。

- v5.0 信件編輯器改為舊系統功能版：收件人／副本標籤（Enter／逗號新增、Backspace／× 移除、驗證信箱）、工具列（復原／重做、粗斜體底線刪除線、項目符號／編號、對齊、文字顏色、超連結、清除格式）、插入照片（內嵌 cid，含貼上圖片，單張 8MB）、附加檔案（合計 15MB）、插入簽名檔（放進內文指定位置，避免重複附上）、指定排程時間（Worker `scheduleCaseMail`／`scheduleCaseReply`）、合併信件（多筆案件併成一封，專案名稱併列、數量加總，可取消合併）、上一封／下一封。未移植：信件範本、NAS 路徑、串接既有信件串、已排程信的修改／取消。

- v5.0 修復圖片快速瀏覽：先前調整編輯小視窗樣式時，誤把「設計圖停留放大預覽／放大圖示」與詳情頁膠囊排列的 CSS 一起刪掉，預覽因此不會浮出來；已補回，並改放在樣式表最後面，避免再被區段取代誤刪。

- v5.0 修改欄「＋」改成白底正圓（28×28，同「初稿」膠囊色）；修改紀錄視窗每一輪補上備份設計圖縮圖（停留放大預覽、點擊開原圖）。

- v5.0：列表／詳情用膠囊選了項目細節且案件還是「未執行」時，狀態自動改為「執行中」（同一次 `update` 寫入）；列表「修改」欄對設計師加回「＋」（沒有紀錄）與可點的修改膠囊，開啟修改紀錄視窗：列出各輪紀錄、填修改日期＋內容新增下一輪（Worker `addModificationRecord`，狀態變更依回傳同步）。未移植：指定修改圖片、初稿建立、確認修正。

- v5.0 卡牌：日期後面加入項目細節小膠囊（白底細邊，每個細節一顆）。

- v5.0 列表排列加回「信件」「內容」欄與欄寬調整：信件欄（有 Gmail 信件串＝綠色「回信」→站內信件頁，走 Worker `replyCaseMail`；沒有＝「發信」走 `sendCaseMail`）、內容欄（黃色「編輯」→詳情編輯、設計師才有紅色「刪除」→確認後 Worker `delete`，失敗還原）；表頭右側邊線可拖曳調整欄寬（存 localStorage `v5ListCols.widths`）。未移植舊版「串接既有信件串」。

- v5.0 膠囊編輯小視窗改成舊網站的「膠囊清單」呈現：選項是自動換行的小膠囊（已選＝淺綠底綠字／狀態打勾）、狀態含暫停中（紫）、項目細節為可複選膠囊＋「關閉／套用」（套用為綠色實心按鈕）。
- **舊系統不再自動整頁重新整理**：`index.html` 的自動更新偵測到新版時，原本會在使用者閒置時自己 `location.reload()`，現在只在畫面下方顯示「有新版本了／立即更新」，由使用者自己按；像素辦公室（`EMC-ART-Pixel-Office/dist/app.js`）的自動重新載入也移除（app.js ?v=103、iframe ?v=56 讓瀏覽器拿到新版）。對應測試已更新。

## 2026-10-03

- v5.0 登入頁：Google 改用頁面內的 Google 按鈕（GSI，不再跳到舊網站；彈出視窗登入保留為備援）；密碼登入只要輸入密碼（沿用舊版管理者密碼：帳號固定 machi.chen@emctaipei.com，Worker `login`）；登入資料另存一份 `v5SessionBackup`，若被清掉（非明確登出）會在載入時還原，登出會一併清除。
- v5.0 修改紀錄設計圖改回舊網站的快速瀏覽：滑鼠停留浮出放大預覽卡（含檔名、跟著游標），縮圖中央顯示放大圖示，點擊另開原圖（取代先前的站內燈箱）。同時補回被誤刪的 dp-wrap／詳情頁狀態對齊樣式。
- v5.0 膠囊編輯小視窗改成舊網站樣式（白底圓角卡、標題、整列選項、已選打勾；狀態為舊版配色膠囊、項目細節為勾選＋關閉／套用）；設計師可改設計類型（若原階段不屬於新類型，自動改為該類型預設階段）；膠囊滑過不再出現綠色外框。
- v5.0 列表排列：只有案件編號、客戶別、專案名稱三欄可點選進入詳情（整列不再可點，其他欄位點了不會跳轉）。
- v5.0 案件詳情：「修改輪數」改成「項目細節」膠囊、種類／階段改成列表同款配色膠囊、狀態膠囊與按鈕垂直對齊、移除底部「到現行系統處理」按鈕；設計師可直接點 狀態／項目細節／階段 編輯；修改紀錄圖片改成站內燈箱快速瀏覽（上一張／下一張、方向鍵、Esc、開啟原圖）；從專案列表進詳情時不顯示首頁綠色主視覺。
- v5.0 進度條漸層改為全站一致：漸層鋪在整條軌道上（同進度同顏色），逾期不再另用紅色漸層。
- v5.0 卡牌進度條改漸層（萊姆→黃→橘；逾期為橘→紅漸層）。
- v5.0 卡牌：種類／階段與日期膠囊移到專案名稱下方（靠左），數量留在右下角改為純文字（無膠囊）。
- v5.0 列表排列加回舊版功能：表頭可拖移調整欄位順序、右上「欄位」可開關欄位（含預設隱藏的月份，順序與顯示存 localStorage `v5ListCols`、可還原預設）、整張列表可按住左鍵拖拉（橫向捲動列表＋縱向捲動頁面，拖拉後不會誤觸開詳情）、設計師可直接點膠囊編輯 狀態／項目細節（可複選）／階段／設計負責人（Worker `update`；改成執行中仍會先跳項目細節選擇；失敗還原）。首頁最新案件與專案列表共用。
- v5.0 最新案件卡牌右上角不再顯示狀態膠囊（逾期標籤保留）。
- v5.0 列表排列改回舊版樣式：欄位順序（案件編號、客戶別、專案名稱、數量、設計負責人、狀態、項目細節、修改、專案負責人、設計類型、階段、開始、結束），人名灰膠囊、狀態／設計類型（平面粉、影音藍）／階段沿用舊版配色，項目細節白底膠囊，修改顯示 初稿／一修…；首頁最新案件與專案列表共用。
- v5.0 卡牌版型：第一行＝案件編號＋客戶別膠囊（＋狀態／逾期）；專案名稱獨立一行；階段／日期／數量三個膠囊移到右下角（與設計師頭像同一列，窄時換行靠右）。
- v5.0 卡牌：客戶別膠囊改固定寬 72px（置中、過長省略），標題改 flex 排版，專案名稱各卡牌左緣對齊且首行與膠囊同高。
- v5.0 卡牌：客戶別灰色膠囊移到專案名稱前面（右下角移除）；專案列表網格改為第一排 未執行／執行中／修改中 三欄、第二排 過稿中／已完成 兩欄（窄螢幕自動 2 欄／1 欄）。
- v5.0 首頁：固定的下拉列後方加綠色橫幅（`#stickBand`）；種類／階段膠囊依「種類＋新製／再製」四色區分（平面新製靛、平面再製天藍、影音新製粉紅、影音再製紫）。
- v5.0 首頁：客戶別小膠囊改灰階；往下滾動時客戶別下拉列固定在視窗上方（`#promptSlot` 佔位＋JS 切換 `.is-stuck`）。
- v5.0 卡牌：右下角倒數移除，客戶別從左上移到右下並改成淺藍小膠囊（沿用倒數膠囊的版型）；倒數天數仍在詳情頁。
- v5.0 專案頁標題改「專案列表」，右上加入網格／列表排列與新到舊／舊到新排序（和最新案件同一組控制）；網格＝五欄看板（可拖移），列表＝表格（每次 50 筆）。
- v5.0 卡牌：影音（粉紅）與平面（藍紫）種類膠囊顏色區隔；倒數天數改成膠囊並依剩餘天數配色（逾期紅／今天橘／剩 1–2 天黃／其餘綠；過稿中、已完成不上色）。專案頁與首頁共用同一個卡牌樣式。
- v5.0 首頁：往下滾動收合設計師頭像、往上展開；「多元凱躍宇宙」改名「凱躍多元宇宙」；卡牌種類／階段、日期、數量改成三色小膠囊（藍紫／琥珀／青綠），倒數字樣縮小（順手修掉先前壞掉的 .card-meta CSS）。
- **v5.0 首頁第四版：專案頁（拖移改狀態）、卡牌資訊、站內登入頁**
  - 卡牌專案名稱下方新增「設計種類／階段」「起迄時間」「數量」，移除右下角數量。首頁不再放狀態欄。
  - 左側「專案」改為站內頁：未執行／執行中／過稿中／修改中／已完成五欄；設計師（組別平面／影音或名字為 Machi／Anna／Amber／Leona／Noise）可拖移卡牌改狀態（Worker `update`，status）；拖到「執行中」先彈出項目細節複選（選項取自加權計分標準，同種類＋階段），確認後一併寫入 `項目細節`；失敗會還原。
  - 登入改為站內登入頁（不再跳舊版網站）：Google 登入（彈窗，沿用 index.html 根網址的 redirect 與 BroadcastChannel `machi-google-oauth-v1`，只能在正式網址使用）＋帳號密碼登入（Worker `login`）。ERP 登入未移植。
- **v5.0 首頁第三版：登入、AI 判斷、批次完整欄位、排列／篩選／排序、案件編輯**
  - 左側欄最下方新增登入頭像：未登入點擊會開新視窗到 `index.html?v5login=1`（沿用現行登入：Google／ERP／密碼），登入成功自動關窗並通知 v5；已登入顯示頭像與登出選單。`index.html` 末尾新增橋接 script（只在 `?v5login=1` 時作用）。
  - 「開始填寫」需登入；下拉感應區含「＋」；下拉最下方「＋ 新增客戶別」（prompt 輸入名稱 → Worker `addCustomer`，同現行系統）。
  - 階段預設「新製」；階段選單同時有新製／再製時加回「AI判斷(beta)」（呼叫 emc-ai-stage-classifier Worker，彈窗上傳截圖→填入階段）。
  - 批次新增每一筆都有完整欄位（客戶別、專案、負責人、種類、階段、數量、起迄日、設計負責人、平台、補充資料），`往下套用`＝複製最後一筆。
  - 卡牌移除左側色條、編號改淺綠底綠字；移除「最新案件 由最新到最舊，共 N 筆」標題；右上新增網格／列表排列、篩選（月份／狀態／設計人，可複選）、排序（新到舊／舊到新）；最新案件先 12 筆。
  - 案件詳情新增「編輯案件」（Worker `update`，欄位同 formWriteKeys，可改狀態），儲存後本機先保留 10 分鐘直到 db.json 更新。
- **v5.0 首頁（`v5.html`）第二版：新增案件流程與看板改版**
  - 首頁搜尋框改成「＋ 客戶別下拉＋開始填寫」；選客戶別後下方列表換成內嵌填寫頁（不用彈窗）：客戶別、專案名稱、專案負責人（自動帶登入者名稱）、設計種類、階段（依種類從加權表帶）、數量、設計負責人（依客戶別「設計負責人」設定帶第一位，切換客戶別會重帶）、開始／結束（雙月區間行事曆，預設開始日 18:00 後算隔天）、使用平台（可複選）、補充資料（選填）、批次新增（共用欄位＋多筆專案）。
  - 送出走 Worker `add`／`batchAdd`（欄位 key 同現行系統 formCreateRow），成功後直接進內嵌信件編輯頁（收件人＝設計負責人、副本＝客戶別預設信箱並排除收件人、主旨 `【編號】客戶_專案`、內文同現行範本，簽名檔寄出時附上，走 `sendCaseMail`），批次時依序一封一封寄；寄完回列表。需要登入（與 `index.html` 共用 `designRequestEditor*`）與已連接 Gmail；未連接時提示並可略過。新案件先暫存在本機（db.json 要 1～3 分鐘才更新）。
  - 看板：頂部「最新案件」三欄合併區（全部狀態，新到舊，先 18 筆可顯示更多），下方依狀態四欄（未執行／執行中／過稿中／修改中）；配色沿用現行系統（未開始紅、執行中黃、過稿中藍、修改中橘、已完成綠）；卡片編號為綠色膠囊、客戶別灰字；點卡片在頁面內展開案件詳情（資訊、補充資料、修改紀錄與縮圖）。搜尋移到列表標題右側。
  - 限制：信件編輯器是簡化版（粗斜體底線、連結；沒有圖片／附件／排程／合併信件），要完整功能仍用現行系統。
- **v5.0 新版首頁試作 `v5.html`**（現行 `index.html` 不動）：左側窄欄（首頁／專案／設定，後兩者先連到現行系統）、綠色主視覺＋標題「你今天想設計些什麼呢？」＋搜尋列（即時篩選下方案件）、五位設計師像素大頭（`assets/v5/heads/`，從 `wardrobe-heads.webp` 裁切，只有頭）＋第六格「多元凱躍宇宙」（彈窗開舊版像素辦公室）。頭像依像素辦公室狀態切換：離席類狀態換成狀態圖示（`assets/v5/status/`），加班加月亮徽章；滑鼠停留顯示等級（算法同像素辦公室，第一次停留才載 `data/database_archive.json`）與案量。下方「最新案件列表」三欄看板：未執行（未開始）、執行中（含修改中）、過稿中；卡片有案件編號、客戶別、專案名稱、專案負責人／設計負責人頭像、倒數天數與數量，執行中多進度條（最後一天 99%、逾期標紅）。資料：`backend/data/db.json`（案件、`設定`頭像連結）＋ Worker `pixelOfficeState`（只允許正式網址，本機測試會被 CORS 擋，畫面會改顯示「狀態讀取中」而不是假裝在座）。設計師頭像改版時要重新裁切 `assets/v5/heads/`。
- **「您的案件進度」每筆新增「查看詳情」**：開案件詳情頁（進度清單先收起，因為兩個彈窗疊在同一層），詳情頁左上「返回」回到清單；從詳情按 X 關閉則不再跳回清單。
- **修好 CI「Test JSON backend」失敗**（`backend/test` 的原始碼對照測試被這幾天的修改弄壞）：app.js 版本號 `?v=102`、側身帽子 `WD_SIDE_CAP_BACK`、耳機帽子 `act.hx`、`PIXEL_OFFICE_ACTIONS` 加 `kick`、修改紀錄搬移測試補 `publishDatabaseRefresh` 等沙盒函式並新增「搬到初稿→目標案件過稿中」斷言。注意：這類測試把程式碼寫死，之後改 `EMC-ART-Pixel-Office/dist/app.js`、`index.html` 的對應行要一起改測試。Windows 本機另有 3 個 NAS 路徑測試會失敗（Mac 路徑／`::` 檔名），CI（Linux）不受影響。
- **修改紀錄「移到其他案件（初稿）」**：搬移時選取的圖片本來就會從來源案件 A 的紀錄移除（只動紀錄，Drive 檔案不動，確認視窗現在也寫明）；新增：目標案件 B 收到初稿（`toRound=0`）後，狀態自動改為「過稿中」（已是過稿中、已完成、已取消的不動）。Worker `moveCaseDesignImages` 回傳 `status`／`statusChanged`，前台立即同步 B 的狀態。Worker 已部署 `a14ca793`，測試在 `worker/test/index.test.ts`。
- **專案負責人確認「過稿中」案件完成（您的案件進度）**
  - 前台：每天第一次進站（台北日期），專案負責人名下有狀態「過稿中」的案件就跳出「您的案件進度」；每筆可勾「客戶已確認完成」，按「確認送出」直接改為已完成，設計師不用再確認。也可按「稍後再說」（今天不再跳）或「需要修改」（開既有的「填寫修改需求信」，內容記進修改紀錄、狀態轉修改中）。個人下拉選單新增「您的案件進度」，隨時可開，名下有過稿中案件時會顯示數量。
  - 設計師通知：案件被確認完成後，該案件的設計負責人在鈴鐺提醒收到「客戶已確認完成」（顯示確認人與時間，保留 14 天）。
  - 後端（Worker，已部署 `23a16dd9`）：新增動作 `ownerConfirmCases`——只允許「專案負責人本人（或管理者）」把「過稿中」的案件改為「已完成」，其餘狀態、他人案件一律略過並回報原因；資料表 `database` 新增欄位 `客戶確認人`、`客戶確認時間`（`backend/schema.mjs`、`worker/src/model.ts`）。測試：`worker/test/index.test.ts` 的 `ownerConfirmCases`。
  - 前台部署順序：先部署 Worker 再推前台。
- 填需求的「開始／結束時間」預設：台北時間 18:00 以後算隔天（`requestDefaultDateValue()`）。
- 進站載入動畫：綠底＋設計部 logo 彈跳＋白色進度條，進度條下方輪播設計師語錄（語錄清單移到 `window.emcQuotes`，送出遮罩與 AI 等待畫面共用）。
- 像素辦公室：Machi 新增動作「浪子踢球」（需部署 Worker，已部署）；閃身步、狗熊哆嗦毛、浪子踢球皆不限時；狗熊哆嗦毛加頭部左右橫移；側身帽子後緣往前；造型區移除提示文字。詳見 `EMC-ART-Pixel-Office/docs/HANDOFF.md`。

- v5.0: thread text 11px; signature tables no longer wrap/break; phone/mobile/address links unwrapped to plain black text.

- v5.0: thread body text bold 12px (signature table unchanged).

- v5.0: revision pill gets red border when a modification round is unconfirmed; modification records render links (修改內容連結 + plain URLs).

- v5.0: modification record modal — "確認修正完成" check button (updateModificationConfirm), add-record form collapsed behind a "＋ 新增修改紀錄" button.
- v5.0: designer reply — choose source first (同上次路徑 / NAS 資料夾 / 電腦檔案上傳, 不同步圖片 option), editor opens straight away with NAS path/images/video-path blocks filled in when backup finishes; NAS picker popup + upload iframe via postMessage as in legacy; after sending: backup inline photos, auto-confirm round, status → 過稿中; toolbar "插入 NAS 路徑"; reply-editor thread cards default collapsed.

- v5.0: 過稿中 cards get a quick-view revision pill before quantity; revision record modal has a close button and green confirmed meta line; grid layout gets a field show/hide menu (card parts, multi-select, remembered); fixed detail-pill split regex.

- v5.0: grid 欄位 menu now selects which case statuses to show (multi-select, remembered, 全部顯示 resets); replaces the card-field toggle menu.

- v5.0: 專案列表 grid layout 欄位 menu now hides/shows whole status columns (multi-select); removed the board status filter added earlier.

- v5.0: modification record text 12px and signature (from "--" line) not shown/saved.

- v5.0: 已完成 cards show a round "+score" badge (加權) before the mail button.

- v5.0: list layout gets the legacy timeline (甘特式時間表) on the right: day scale with weekday, weekend/holiday and today bands, status-colored bars with 🔥/⚠️, click opens detail, drag to scroll, draggable divider, toggle button (remembered).

- v5.0: 專案列表 grid: when fewer than 5 status columns are shown, columns share the full width and cards in a column flow into several sub-columns to the right (>=1181px).

- v5.0: 專案列表 grid: all cards in a view share one width (5 columns = 3-wide grid with equal columns; fewer columns split into equal sub-columns).

- v5.0: timeline bars use the same status colors as the pills/cards.

- v5.0: timeline bar colors set to the approved solid palette (pink/yellow/blue...).

- v5.0: timeline only on 專案列表 list layout (removed from 最新案件列表, incl. its toggle).

- v5.0: timeline default scroll puts today at 1/4 of the panel width; reset on each page switch.

- v5.0: timeline divider default snaps right after the column titles (table width, capped at 60% of the width); dragged position is remembered.

- v5.0: timeline divider snaps exactly to the end of the list columns (timeline keeps at least 300px).

- v5.0: timeline bars thinner (26px).

- v5.0: filters (month/status/designer) remembered across refresh; grid status menu gets 全部隱藏; timeline bars 33px.

- v5.0: login page — password 登入 button no longer disabled by a stuck Google "busy" state (separate pwBusy; popup-closed watcher resets Google busy; startLogin resets).

- v5.0: permissions follow the legacy system — loads assets/access-control.js (帳號權限/角色範本 via Worker verifyToken); 客戶別 部門組別 controls which cases are visible, 客戶別 專案負責人 rules (or request.edit/delete/mail/status) control edit/delete/mail/inline-edit per case, modification.create/confirm and media.manage gate the related buttons; refreshed on login/logout.

- v5.0: left rail gets 設計儀表板 (designers), 歷史資料庫管理 and 資料庫後台 (admins/Machi, by page.* + capability); settings entry follows profile.edit; request.create gate on 開始填寫.

- v5.0: 您的案件進度 restored (owner confirms 過稿中 cases → ownerConfirmCases; 查看詳情 returns to the list; 需要修改 → modification reply; daily auto popup; account-menu entry with count). Owners always see their own cases even if the customer visibility rule would hide them.

- v5.0: legacy entry splash (green screen, hopping logo, progress bar, designer quotes) added; it fades out once the page and case data are loaded.

- v5.0: 您的案件進度 moved from the avatar menu to a left-rail "進度" button with a red count badge.

- v5.0: settings rail button moved to the bottom; in-page Gmail connect (串接 Gmail button in mail notice, thread error, account menu and settings page; popup OAuth + gmailOauthConnect) replacing the broken link to index.html.

- v5.0: background data refresh like the legacy site — polls db.json every 6s (304 when unchanged; ignores older revisions), redraws only on a new revision and defers while typing / modal or popover open / editing / tab hidden.

- Worker: ownerConfirmCases now also matches the case owner against the account 顯示名 (設定 table), not just session.user/account — e.g. 26100013 owner "一般測試員" (user 測試使用者) could not be confirmed. Deployed (version 35c115ce).

- v5.0: 進度 is now a full page (rail button); the popup is kept only for the first-visit-of-the-day reminder (with a button to the page). Added 問題 rail button + full 問題回報 page (list with status pills, managers change status via updateIssueReportStatus, report form via reportIssue).

- v5.0: designer hover card counts use the shared status colors (5 tiles incl. 已完成, same order as the project columns).

- v5.0: 問題 rail button sits directly above 設定 at the bottom group.

## 2026-10-04 新舊網站切換
- 新版首頁 v5.html 改名為 index.html 上線；舊版 index.html 改名為 legacy.html 保留；v5.html 改為導向 index.html 的短檔。
- 新版開頭加入 OAuth 返回處理（Google 登入／Gmail 連接彈出視窗廣播結果並關閉；其他舊流程轉交 legacy.html）。
- 測試檔改讀 legacy.html；workflow 路徑同時監看 index.html 與 legacy.html。npm test 的 59 個既有失敗（Windows 路徑／舊測試）切換前後相同，沒有新增。

- Mobile (<=720px) fixes: bottom nav scrolls horizontally with the active item centered; "+" in the start bar aligned to its first row, and a compact one-row sticky bar; designer hover card becomes a bottom sheet; toast above the nav; non-home pages hide the big hero so forms/mail/detail start at the top; audited 375px width for horizontal overflow on home, list, projects, settings, issues, owner, form, detail, mail (none).

## 2026-10-04 手機修正
- 手機版篩選/欄位下拉改為固定置中（不再被左側裁切）；案件進度列文字不再被按鈕擠成直排。

- 篩選條件（月份/狀態/設計人）同步到雲端設定表，手機與電腦共用。

- 手機版登入選單（含登出）固定顯示在底部選單上方，不再被遮住。

- 個人設定加回「上傳／更換頭像」（沿用舊版上傳頁）；設計師（設計部或有設計師權限，管理者/Machi 除外）不能更換頭像與顯示名。

- 專案通知：設計師的新案件／新修改需求、提出需求者收到設計師回覆（過稿中）時，左側「專案」顯示紅點數字，點開後標出該案件並捲動過去。已讀記錄存在各裝置 localStorage。

- 專案通知：標籤改排在案件編號前；點開案件後紅框消失；加回右上角新通知提示卡（點擊前往專案）。

- 凱躍多元宇宙改為完整一頁（不再彈窗），設計師／管理者／Machi 有「編輯」按鈕（切到可編輯的像素辦公室）。

- 多元宇宙改成保留首頁上方綠底，只把下方最新列表換成像素辦公室（編輯鈕可操作人物）。

- 多元宇宙頁面滿版（移除邊界與綠底），比例改 16:9 並限制高度。

- 多元宇宙畫面置中、縮小 10%。

- 多元宇宙：移除另開分頁；畫面依首頁內容區寬度置中並再縮小 10%。

- 多元宇宙：六張桌子依首頁內容欄置中，場景縮小約 10%（像素辦公室 app.js 新增 ?pad= 參數，v=104）。

- 多元宇宙：標題與場景同一條垂直中心線。

- 多元宇宙：場景寬度與「開始填寫」列同寬(720px)，桌子左右切齊（app.js v=105）。

- 多元宇宙場景再縮小 10%（pad=.9）。

- 多元宇宙：上方綠底自動收合，只留下拉選單與綠底。

- 多元宇宙：綠底收合加動畫；編輯模式畫面加寬(1280px)讓人物資訊框出現在右側。

- 多元宇宙編輯模式：?clean=1 移除品牌列/標題/邊框/底部說明，六張桌子放大佔滿寬度（app.js v=107, style.css v=44）。

- 多元宇宙桌子再縮小20%（pad=.72），編輯版本同比例（?cs=.833），編輯版背景透明。

- 多元宇宙編輯：隱藏設計師名單；等級一覽表移到右側選單（可收合，單欄）。

- 多元宇宙編輯：角色工具欄移除「現在的心情」，順序：目前狀態>造型>動作>分享音樂>限時動態>想說的話。

- 首頁頭像框：用隱藏的像素辦公室小視窗取得造型/耳機頭像，並顯示對話框與分享音樂框。

- 首頁頭像：對話框/音樂框移到頭像上方；音樂框可點播放/暫停（播放器在隱藏的像素辦公室視窗），歌名過長以走馬燈呈現。

- 首頁頭像：對話氣泡半透明＋走馬燈；音樂框改放頭像下方；播放鈕改 SVG 置中；播放中/載入中狀態；多元宇宙新增關閉鈕；隱藏播放視窗移入可視範圍。

- 篩選預設：月份=本月、案件狀態與設計人=全選；案件狀態加上對應配色小膠囊。

- 首頁頭像：氣泡/音樂框寬度對齊頭像框(84px)並置中，半透明玻璃感，超出文字走馬燈。

- 首頁頭像：氣泡尖角與本體合為一體、寬度依文字（最多頭像寬）、多元宇宙頭像框對齊。

- 多元宇宙進出時捲回頁面頂端（關閉後頭像列不會被捲到畫面外）。

- 捲動收合頭像列時，綠底（標題與上下留白）一起收合。

- 音樂框預設為圓形播放鈕，滑鼠移上去才展開（走馬燈）。

- 首頁頭像以頭部實際範圍置中（Anna/Leona 偏左修正）。

- 多元宇宙編輯畫面：上緣依帽子與對話框動態保留，不再裁切（app.js v=116）。

- 多元宇宙編輯畫面：手機縮放不超過可用寬度（app.js v=117）。

- 多元宇宙手機編輯：場景改為整個可走動範圍放進寬度，搖桿搬進場景右下角（app.js v=118, style.css v=47）。

- 首頁頭像：頭像框內大頭縮小(裁切 100)；音樂框移到頭像正下方並稍微疊加。

- 首頁頭像右上角：限時動態氣泡（有未讀顯示綠點），點擊進多元宇宙並開啟該人的限時動態（app.js v=120）。

- 首頁頭像：肖像畫布加高，戴帽子不再被裁平；裁切依頭頂與左右範圍追蹤（app.js v=121）。

- 首頁頭像：配件圖載好才送出頭像，避免先出現光頭（app.js v=122）。

- 首頁頭像：下巴統一高度；音樂框絕對定位在頭像下緣(名字位置統一)、點歌名開網址、點圓形播放；限時動態直接在首頁彈出可按讚留言（app.js v=123）。

- 頭像框一律不戴帽子；案件卡片設計師頭像與左下角登入頭像連動像素辦公室造型頭像（app.js v=125）。

- 篩選器：舊的已存條件一次性重設為預設（月份=當月、狀態/設計人=全選），「清除篩選」改為「恢復預設」。

- 案件卡片頭像縮小留白，不再切到頭髮。

- 案件卡牌：點擊改為卡牌往下展開顯示詳細內容（含修改紀錄），再點收起；頭像列與數量對齊。

- 展開卡牌僅顯示補充資料與修改紀錄；備份圖單排橫向捲動；點展開內容空白處可收合。

- 最新案件卡牌：同一排統一高度（依最高者），下排靠底對齊；展開中的卡牌不參與。

- 卡牌展開改為一次只展開一張。

- 音樂框：點歌名第一下播放，第二下才開連結。

- 新增需求/寫信頁：上方綠底收合成只剩客戶別列，並回到頂端。

- 新增需求：專案負責人固定為登入者本人（唯讀），管理者/Machi/設計部人員可自行填寫。

- 回到首頁時展開頭像列（清除捲動收合狀態）並回到頂端。

- 回首頁：綠底收成只剩下拉列，畫面停在「最新案件列表」標題。

- 捲動/回首頁收合後的綠底與固定下拉列同高，不再出現兩層綠底。

- 2026-10-04: Mobile heat/lag fix: hidden avatar bridge iframe no longer redraws the pixel-office scene at 60fps (only when story viewer is open); avatar refresh 10s and paused when tab hidden; backdrop blur off on touch devices. app.js v=126, bridge v=13.

- 2026-10-04: Card expand shows 項目細節 row: designers get "＋ 新增項目細節" (未執行) / "編輯" (other statuses) using the existing details popover.

- 2026-10-04: Home avatars cached in localStorage (v5PixAvCache) so the last pixel-office heads show immediately on load.

- 2026-10-04: Health check: background timers skip while tab hidden (rail, office state), office state re-renders only when changed, db poll 6s->8s.

- 2026-10-04: Reply/modification/plain reply now apply the default 信件範本 from personal settings (settings loaded first if needed).

- 2026-10-04: HOTFIX: v5PixAvCache regex had an unescaped slash that broke the whole page script (site would not load data); fixed.

- 2026-10-04: Mail send: plain reply on 執行中 -> 過稿中 (designer reply already did); modification reply -> 修改中 (backend + client fallback). Scheduled sends do not change status.

- 2026-10-04: Plain reply on 修改中 also -> 過稿中.

- 2026-10-04: Plain reply from 修改中 now marks the latest unconfirmed modification round as done (setConfirm) before moving to 過稿中.

- 2026-10-04: Story badge (avatar top-right) restyled: solid green bubble with white outline, red when unread, yellow dot; stronger shadow.

- 2026-10-04: Unread story badge now bright green with gentle pulse (no red).

- 2026-10-04: Home bubbles/music/story badges now filled from the home page own pixelOfficeState (mergeOfficeIntoAvatars) instead of waiting for the hidden bridge iframe.

- 2026-10-04: Avatar bridge (avatars=1) no longer downloads the 4MB database_archive.json (ensureLevels skipped). app.js v=127, bridge v=14.

- 2026-10-04: CI fix: designer-panel-embed test regex for ensureLevels allows the avatars-mode guard. Workflow: compare failing tests vs last green commit before pushing.

- 2026-10-04: Pixel office speed: non-embed (edit/clean) canvas scale cap 3->2 and redraw throttled to ~30fps when idle. app.js v=128; host iframes embed v=63, clean v=66, bridge v=15.

- 2026-10-04: Story badge: white bubble, green outline, green dots; unread keeps yellow dot (no pulse/colour change).

- 2026-10-04: Story badge: removed green outline (white bubble + green dots, shadow only).

- 2026-10-04: Avatar hover card no longer shows the 已完成 count.

- 2026-10-04: Hover card counts grid 5 -> 4 columns after removing 已完成.

- 2026-10-04: Audit log (worker): new worker/src/audit.ts + github-store append; mutate() diffs cases/permissions into 狀態變更/欄位修改/案件新增·刪除/權限變更; logins, login failures and mail sends logged; queue in DO storage, flushed by cron to backend/data/audit-log.json (batched >=50 entries or >=5 min); admin action listAuditLog; test workflow ignores audit-log.json. Needs `wrangler deploy` to go live.

- 2026-10-04: json_database_admin.html: new 稽核 > 操作紀錄 sidebar view (listAuditLog; type filter, search, newest first, 500 rows shown).

- 2026-10-04: Modification record from reply strips the leading "Hi 名字" greeting (stripGreeting) and stores only the body.

- 2026-10-04: Settings: designers see the pixel-office avatar in 個人設定; Worker saveUserSettings now ignores avatar/displayName from non-admin designer accounts. Worker redeployed.

- 2026-10-04: Home designer avatars ordered by 設計列表 輪值 (rotation, 平面 before 影音 on ties): Anna, Noise, Amber, Machi, Leona; applyDesignerOrder() re-sorts after db load.

- 2026-10-04: Universe page: loading overlay (spinner + 正在進入凱曜多元宇宙) over the iframe until the pixel office is ready (max 10s).

- 2026-10-04: Logged-out users no longer see 編輯/發信/回信 buttons in cards or list (mail+actions cells empty, list columns hidden).

- 2026-10-04: 補充資料 in card/detail only for 設計部/企劃部/admin, the case 專案負責人 and members of the owner group (canSeeSupp). UI-only: db.json stays public.

- 2026-10-04: 作品牆: left-rail button, Pinterest-style masonry (random order, lazy 36/page, designer filter, shuffle), click opens modal with case details + 查看案件; images from 修改統計表 圖片連結 (lh3 googleusercontent, image files only).

- 2026-10-04: 作品牆 placeholder aspect-ratio 4/5 so columns balance before images load.

- 2026-10-04: 用餐中 (lunch) status icon in avatar +10% (66% -> 72.6%).

- 2026-10-04: lunch status icon nudged 5% right.

- 2026-10-04: lunch status icon nudged another 5px right.

- 2026-10-04: Realtime push: Worker DO accepts WebSocket at /ws (hibernation API, ping auto-response), broadcasts {type:pixel,v} when pixel-office version changes (after pixelOffice* actions and every cron minute); front-end reconnects with backoff and reloads office state on push; fallback poll 60s -> 5min while connected. Worker redeployed.

- 2026-10-04: lunch icon moved 5px back left (net 5% right of centre).

- 2026-10-04: Case data push: Worker action publicDatabase (db.json content from the DO snapshot, supports since=revision) + WebSocket {type:db,rev} after every committed write; front-end loadDatabase(background,viaWorker) fetches from the Worker on push and falls back to db.json; GitHub Pages poll slowed to ~24s while push is connected.

- 2026-10-04: Pixel office app (embed/clean/avatars bridge) now also uses the WebSocket push: syncNow() on {type:pixel}; polling falls back to 60s while connected (3s otherwise). app.js v=129, iframes embed v=64, clean v=67, bridge v=16.

- 2026-10-04: Universe opens directly in edit mode for designer/admin accounts (openUniverse sets uniEdit=canEditUniverse()); others still view-only.

- 2026-10-04: Removed the 編輯/完成編輯 toggle button from the universe page (designers always open in edit mode).

- 2026-10-04: 專案頁狀態欄可拖曳排序（設計師）；順序存 localStorage v5ColOrder 與帳號設定新欄位「專案欄位順序」(schema + settingsResponse.columnOrder + updateSettingsRow). Worker redeployed.

- 2026-10-04: afterDesignerSend now moves the case to 過稿中 first (parallel with image backup/confirm); 您的案件進度 page has a search box (編號/客戶/專案/設計師/日期).

- 2026-10-04: Card: top-right now a coloured status pill (lt-status); 發信/回信/串接/編輯/刪除 buttons moved under 項目細節 in the expanded card with Chinese labels (cardActsHtml).

- 2026-10-04: Case detail page: removed top-right 編輯案件 button; bottom-left 回信/編輯/刪除 buttons enlarged to the same size (36px, 14px font).

- 2026-10-04: Case detail page: 回信/編輯/刪除 buttons moved from bottom-left to the top-right (where 編輯案件 was, same 36px size); 編輯案件 button removed.

- 2026-10-04: Dark mode: rail toggle button (themeBtn) with localStorage + account sync (深淺模式); dark tweaks for access-denied gate, list timeline header, issue selects, wall placeholders. Existing html[data-theme=dark] stylesheet reused.

- 2026-10-04: Dark mode: darker hero/stick band/prompt/avatar frames, status pills via --st-* vars, dark 回信/編輯/刪除 buttons, dark cell-pop popovers.

- 2026-10-04: Mail/signature editor colour palette restored to the old Gmail-style 64-colour grid with separate 背景顏色 (hiliteColor) and 文字顏色 groups; colour application splits around contenteditable=false blocks like the legacy site.

- 2026-10-08: 記事本: left-rail button (設計部/管理者), Worker action getNotebook reads the 設計部資源 Google Sheet (2 tabs) server-side after auth, 60s cache; page renders tabs as grids, 密碼 cells masked with eye/copy. Sheet is NOT copied into the repo. Worker redeployed.

- 2026-10-08: 記事本 redesigned: card UI, add/edit/delete/reorder, search, categories; data now lives in the Worker DO (notebook_items, one-time import from the old Google Sheet, no sheet link). Actions getNotebook/saveNotebookItem/deleteNotebookItem/moveNotebookItem (designer/admin only); audit logs card title+action only, never values. Worker redeployed.

- 2026-10-08: 記事本: category tabs drag-reorder (shared, saved via saveNotebookCategoryOrder in the DO), cards fixed to 3 columns (2 <=1100px, 1 <=720px), titles single line with ellipsis + tooltip, tools overlay on hover. Worker redeployed.

- 2026-10-08: 行事曆: 值日生輪值（Leona→Anna→Machi→Noise→Amber 循環，2026/10=Leona）: banner with this month duty + next 5 months, tags on the 2nd/4th Wednesday, detail block, and a 1st-of-month reminder modal for the duty person (reminds to schedule 【設計部雙週會】N月上/下_案例分享, Wed 14:00-15:00, BOOKING room H, TAG six people). Reminder only; no calendar events are created automatically.

- 2026-10-09: 值日生自動預約: Worker duty.ts + dutyBook (uses the duty person own Google connection to create the 2nd/4th Wednesday 14:00-15:00 meetings on their primary calendar, inviting room H meetingroomh.emc@gmail.com + six people, dedupe by title, room decline check); actions getDutyBooking/bookDutyMeetings; cron runDutyBooking (1st-3rd, 09:00+, retry every 30 min); requires calendar.events write scope (incremental consent via startGmailConnect(true)). UI: booking status in calendar duty bar + reminder modal, manual 立即預約 button. Worker redeployed.

- 2026-10-09: Duty text changed to "14:00–15:00・會議室 H・ Eric、Machi、Anna、Noise、Amber、Leona".

- 2026-10-09: 值日生手動替換: Worker dutyOverrides in DO storage (actions getDutyOverrides/saveDutyOverride, allowed for the current duty person or admin, audited), front-end dutyWho() uses overrides; swap row in the calendar duty bar (替換/恢復輪值); swapped-in person gets the reminder once; cron/booking use the effective duty person. Worker redeployed.

- 2026-10-09: Duty swap can also be undone by the original rotation person.

- 2026-10-09: Both bi-weekly meetings get a description (會議摘要: 1 摘要工作指標(量體/事件) 2 作品案例討論 3 提案討論 4 週會回饋): in the auto-created Google event and shown in the calendar duty bar/detail. Worker redeployed.

- 2026-10-09: Calendar page no longer shows the meeting agenda (kept in the Google event description only).
- 2026-10-10 行事曆值日生：移除下拉選單，輪值小膠囊移到標題下，點人名直接替換本月值日生
- 2026-10-10 新增「專案分配」頁（左側欄「分配」）：客戶別分配表，依設計師／依客戶檢視、搜尋、新增編輯刪除；資料首次從 Google 試算表匯入，存在 Worker 資料庫（getAssignments/saveAssignment/deleteAssignment）；換負責人寫入操作紀錄
- 2026-10-10 專案分配頁改成矩陣表：客戶別 × 專案負責人／組別 × 各設計師每月維運；負責人取自系統客戶別設定；移除外發；社群歸為「社群貼文」
- 2026-10-10 專案分配：暱稱對照 David→廖秦葦、Allen→李明庭；移除（試算表）字樣；格子加編輯／刪除鈕
- 2026-10-10 專案分配：客戶別列可編輯／刪除；格子只顯示●負責並縮窄；負責人欄變窄
- 2026-10-10 專案分配：表格滿版等寬、單行等高、客戶別字母排序、搜尋框比照系統
- 2026-10-10 專案分配：客戶別／專案負責人與組別改為手動選擇對應系統；移除「系統無此客戶別」
- 2026-10-10 手機省電：金句輪播在背景分頁暫停、觸控裝置放慢；右側欄 10s→30s；WebSocket 心跳背景不送；觸控裝置關閉跑馬燈動畫
- 2026-10-10 專案分配：客戶別列「刪除」改為可從表中移除（含系統客戶別，只隱藏不刪系統設定）
- 2026-10-10 重新整理後停留在原本頁面（專案、行事曆、分配、記事本、作品牆、問題回報；以分頁為單位記住）
- 2026-10-10 重新整理後多元宇宙也停在原頁
- 2026-10-10 首頁頭像快速展開卡加入「工作負載」：進行中案件加權加總 vs 設計部平均，標示空檔/輕鬆/適中/偏高/滿載
- 2026-10-11 工作負載：平面組與影音組（Noise）分開比較；影音組只有一人，用固定參考值（加權≤6輕鬆、≤14適中、≤22偏高、其上滿載）
- 2026-10-11 專案分配：欄位標題顯示各設計師目前負載，並提示新進平面案建議先找負載最低者
- 2026-10-11 設定頁新增「系統通知」開關：新案／修改需求／回信時，分頁在背景會跳瀏覽器系統通知
- 2026-10-11 後台新增「權限總覽」：每個帳號實際生效的頁面／功能權限矩陣（Worker action listPermissionOverview，限 database.manage）
- 2026-10-11 效能：index.html 的樣式與程式拆成 site.css / site.js（帶內容雜湊版本，可被瀏覽器快取，回訪不再重抓約 175KB）；commit 前自動更新版本（.git/hooks/pre-commit + tools/stamp.cjs）；測試改讀三檔合併（backend/test/site-source.mjs）。若在別台電腦改 site.js/site.css，請先執行 node tools/stamp.cjs 再 commit
- 2026-10-11 首頁：頭像點擊在觸控裝置第二下進多元宇宙、名片加「進入多元宇宙」按鈕；最新列表／專案列表捲到底自動載入更多
- 2026-10-11 專案分配：長客戶別名稱不再把編輯／刪除鈕擠出欄位
- 2026-10-11 新增瀏覽器煙霧測試（tests/smoke/smoke.mjs，puppeteer-core + 本機 Chrome，假後端資料）：首頁/專案/行事曆/專案分配/記事本/作品牆；npm run smoke；CI 與本機 pre-push 都會跑
- 2026-10-11 安全：記事本欄位改以 AES-GCM 加密存放（Worker Secret NOTEBOOK_KEY；金鑰備份在本機 C:\Users\pcc10\.emc-notebook-key.txt，請另存密碼管理器）；每週自動把 DO 內資料（記事本、專案分配、值日替換）加密備份到 backend/data/do-backup.enc.json；後台 action backupNow / restoreBackup（restore 需 confirm:true）
- 2026-10-11 後台新增「備份與還原」頁：立即備份、從最近一次備份還原（需輸入「還原」確認）
- 2026-10-11 專案分配手機版：改成卡片清單（客戶別＋負責人＋設計師膠囊，可編輯／刪除／分配）

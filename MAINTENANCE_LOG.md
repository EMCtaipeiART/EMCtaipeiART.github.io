# 維護紀錄

> 每次修改網站後在最上面補一筆（新的在上）。AGENT.md 要求的修改紀錄放這裡。

## 2026-10-27

- GitHub 瀏覽器煙霧測試偶發失敗（actions run 40448046505）：04:08 那次是 runner 上 Chrome 啟動逾時（TimeoutError: WS endpoint，30 秒），跟網站程式無關，之後的執行都通過。`tests/smoke/smoke.mjs` 啟動 Chrome 改成逾時 90 秒、加容器用參數（`--disable-dev-shm-usage` 等），失敗自動重試最多 3 次，真的起不來才算失敗。本機煙霧測試通過。

- 修 GitHub 測試失敗（actions run 40427127496）：①`EMC-ART-Pixel-Office/dist/app.js` 被別台電腦以 CRLF 換行提交（2365 行全變），讓用 `\n` 比對原始碼的測試失效 → 轉回 LF，並新增 `.gitattributes`（`app.js text eol=lf`），之後不論哪台電腦提交都會正規化；②`staff-seat-assignment.test.mjs` 兩項釘死舊寫法的測試更新到新寫法（四樓 `viewY=FLOOR4?…`、`pixelOfficeState` 的 hours 多了 `force`），保留檢查意圖。完整測試 281 項全過。

## 2026-10-23

- 新增部門「呈鈺顧問」（外部顧問公司，Google 信箱網域 `jadeit.cc`），運作方式比照專案部：①Worker `model.ts` 新增 `ALLOWED_LOGIN_DOMAINS`／`isAllowedLoginAccount()`（`@emctaipei.com`、`@jadeit.cc`）、`PROJECT_LIKE_DEPARTMENTS=['專案部','呈鈺顧問']`；Google 登入、後台新增帳號、匯入帳號改用這個網域判斷（ERP 登入仍只限公司）；②寫死「企劃部|專案部」的地方（平台幣、元宇宙座位／服裝、客戶設定、刪除申請、前台 `site.js`）都加上呈鈺顧問；平台幣餘額多一個「呈鈺顧問」組；③資料庫後台新增帳號的網域檢查放行 jadeit.cc；④新增人員 Carrie Yeh（`carrieyeh@jadeit.cc`，部門／組別「呈鈺顧問」，一般使用者權限同專案部）。測試 `worker/test/login-domains.test.ts`。注意：Google OAuth 若是「僅限組織內部」，外部網域帳號會被 Google 擋下（需在 Google Cloud 主控台改外部或加測試使用者）。

## 2026-10-22

- v5.0 修改紀錄的刪除：移除剛加的「卡牌右下角刪除整個案件」圖示（使用者要的是刪除修改紀錄，不是整案）；改成在展開卡牌／案件詳情的「修改紀錄」每一輪標頭加刪除（純圖示的紅色圓形垃圾桶，無文字）（`site.js` 的 `data-rev-del`，設計師與管理者、含 Machi），只刪那一輪的文字與圖片關聯，案件本身不動、其他輪次編號不變；修改紀錄視窗裡同樣有。已 stamp。

- v5.0 修改紀錄視窗：設計師與管理者（含 Machi）都可以新增修改紀錄、補圖、移動／刪除圖片，並新增每一輪的「刪除」按鈕（`site.js` 的 `canModEdit()`、`data-rev-del`，呼叫 Worker 的 `deleteModificationRecord`，權限 media.manage；刪除後其他輪次編號不變，Drive 原始檔不動）。「確認修正完成」仍只有設計師。`site.css` 補 `.rev-del`。已 stamp。

- 修正展開卡牌跑版：補充資料裡很長的路徑／網址（例如參考範例的 NAS 長路徑）沒有換行，把「補充資料」那幾列撐出卡牌右緣。`site.css` 讓補充資料文字欄可縮（min-width:0）並任意位置換行、卡牌詳情不超出卡牌寬度。已 stamp。

## 2026-10-16

- v5.0 首頁「最新案件列表」與專案頁網格卡牌的負責人標示（`site.js`、`site.css`）：沿用 `faceHtml()`，改成不重疊的「頭像＋專案／設計＋姓名」細邊圓角膠囊；空白不顯示，同人兼任合併為「專案＋設計」，多人支援逗號／全形逗號／頓號並去重。姓名單行省略、title 保留完整姓名，配色使用主站深淺色變數；左側可用寬度大於 260px 時並排，窄版上下兩列保留角色，可用寬度不超過 160px 時膠囊內角色與姓名分成上下兩行，右側數量／修改紀錄不縮小。列表模式未改。新增 `backend/test/v5-card-people.test.mjs` 6 項測試（兩角色與原頭像、空值、同人兼任、多人去重、長名與 HTML 跳脫、首頁／專案卡牌含數量與修改紀錄），未刪改既有檢查。已執行 `node tools/stamp.cjs` 更新 `index.html` 快取版本；`node --check site.js`、`git diff --check` 通過；`node --test backend/test/*.test.mjs` 共 271 項，251 通過、20 項因環境禁止本機監聽（`listen EPERM 127.0.0.1`）失敗，新增 6 項全數通過。本機預覽伺服器同樣遭 `EPERM` 阻擋，瀏覽器亦禁止 `file:` 預覽，未完成截圖／實際渲染驗證；需人工確認四欄、手機與深色模式。未 commit、push 或部署。

## 2026-10-19

- 修正：從元宇宙回首頁，Machi 的頭像快照退回舊造型（進元宇宙又是新造型）。原因：關閉元宇宙時，遊戲用瀏覽器本機的記憶（`pixelSnap:<名字>`）判斷「這個造型已存過」就不再回報，但後端的「目前頭像」可能被別台裝置／別的分頁改回舊造型，本機因此一直不再更正。改法：`EMC-ART-Pixel-Office/dist/app.js` 不再用本機記憶略過，每次都把造型代碼交給外層；外層先問後端（不帶圖片的小請求），後端（`pixelOfficeAvatarSnapshot`）新增「目前指向的就是這個造型就什麼都不做、不推動版本號」，不同才更新、沒有這個造型才補傳圖片。`app.js` 版本 v=227、元宇宙 iframe 參數 v=118，已 stamp，Worker 已部署。

## 2026-10-15

- Cloudflare 通知 Durable Objects 免費額度 rows_read 已用 90%（每日 500 萬列，台北 08:00 重置）。減量：①Worker 新增 SQL 遷移 18：`pixel_office_*` 六張表的 `updated_at`／`expires_at`／`joined_at` 加索引，`pixelOfficeVersion()` 的 `MAX()` 不再整表掃描（行為不變，全天生效）；②夜間減量時段（台北 20:00～隔天 08:00，`isQuietHours()`）：`pixelOfficeVersion()` 結果快取 120 秒、電腦心跳不再立刻比對版本推送、每分鐘排程的 `runPixelPush` 改每 5 分鐘一次；③前台 `site.js`（`quietHours()`）：夜間案件資料背景輪詢由 8／24 秒改 40／120 秒（即時推送連著時 120 秒）、像素辦公室輪詢每 5 分鐘。白天維持原樣。測試：`worker/test/quiet-hours.test.ts`，`index.test.ts` 的遷移版本清單補 18。已 stamp、Worker 已部署。

## 2026-10-12

- v5.0 專案頁「顯示的狀態欄位」從欄位選單搬進篩選器（`site.js`）：網格與列表共用（列表也會依勾選隱藏該狀態的案件），篩選鈕的數字包含被隱藏的狀態欄位數，「恢復預設」一併恢復；欄位選單在網格模式只剩「每列顯示幾欄」。已 stamp。

- v5.0 專案頁篩選也跟著帳號跨裝置同步：帳號設定多存一份 `projectFilters`（設定表新增欄位「專案篩選月份／專案篩選狀態／專案篩選姓名」，`backend/schema.mjs`、`worker/src/model.ts`、`backend/app.mjs`），首頁那份仍是 `filters`。前台 `site.js` 的 `FILT.home`／`FILT.projects` 各自同步（各自的 synced 快照、只上傳有變動的那份）。已 stamp、Worker 已部署。

- v5.0 篩選器下拉：沒勾選的小膠囊一律灰階，勾選了才顯示各自的顏色（`site.css` 的 `.filter-pop .chips label:not(:has(input:checked))`）。已 stamp。

- v5.0 篩選器（月份／狀態／設計人）：首頁「最新案件列表」與專案頁各自一份，不再連動（`site.js` 的 `state.filtersHome`／`state.filtersProjects`，`state.filters` 依目前頁面取其一）。雲端帳號同步維持只綁首頁那份（localStorage `v5Filters`）；專案頁那份只存在該瀏覽器（`v5FiltersProjects`），第一次會複製首頁當時的條件。已 stamp。

- v5.0 篩選器／欄位選單：兩個下拉不再同時開啟（開一個會關另一個，外部點擊只認各自的外框）；選單小膠囊加上顏色（狀態沿用狀態色、設計人用設計師色、月份淡藍）。`site.js`／`site.css`，已 stamp。

- v5.0：首頁「最新案件列表」與「專案列表」的網格／列表切換改成各自記住（`site.js` 的 `state.layouts`，localStorage 鍵 `v5LayoutHome`／`v5LayoutProjects`；`state.layout` 依目前頁面讀寫對應那一份）。舊的單一鍵 `v5Layout` 只當兩邊的初始值，不再寫入。已用 `node tools/stamp.cjs` 更新 `index.html` 的快取版本號。

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
- 2026-10-11 專案分配：修改負責設計師會同步寫回系統客戶別設定的「設計負責人」（修正欣格家居這類來自系統設定的設計師改不掉）
- 2026-10-11 像素辦公室：行事曆讀不到某人且他的「休假／會議」是行事曆設的超過 12 小時時，自動交還給電腦判斷（修正休假狀態卡住）
- 2026-10-11 後台新增「狀態來源診斷」：每位設計師目前狀態、設定來源（行事曆／人資假單／手動）、最近一次行事曆同步判斷、人資假單時段、電腦心跳（Worker action pixelOfficeDiagnose，限 database.manage，不含事件標題）
- 2026-10-11 資料庫後台：移除「備份至雲端試算表」按鈕與函式
- 2026-10-11 資料庫後台：清除「備份至試算表」相關參數 spreadsheetBackupOptions
- 2026-10-11 資料庫後台手機版：統計卡縮成一排三格、工具頁（操作紀錄/權限總覽/備份/診斷）隱藏統計卡與匯入/新增鈕、側邊按鈕縮小、說明框排版修正
- 2026-10-11 像素辦公室：假日（含國定假日）沒心跳超過 5 分鐘一律顯示下班（含手動點的在座、從沒心跳的人）
- 2026-10-11 首頁綠底漸層可編輯：hero 右上「編輯背景」→ 6 組預設配色＋自訂三色（中心／中間／邊緣），記在本機與帳號（設定表新欄位「首頁背景」，Worker settings.heroBg）；深色模式不套用；煙霧測試加入編輯器開啟／套用／取消檢查
- 2026-10-11 首頁背景加入節慶主題：萬聖節（黑紫＋蜘蛛網／南瓜／蝙蝠／吊蜘蛛）、聖誕節（紅＋飄雪／雪人／聖誕樹）、新年（紅金＋燈籠／花紋）、情人節（粉＋愛心）；裝飾為 assets/festival/*.svg，手機靜態、只有電腦版聖誕飄雪會動；Worker 首頁背景欄位允許第 4 段節慶代碼
- 2026-10-11 首頁背景改為全站共用：依節慶日期自動切換（萬聖節10/1–11/1、聖誕12/1–12/26、新年農曆年前後約兩週、情人節2/7–2/14），也可固定一組；只有管理者與 Machi 看得到「編輯背景」並能儲存（Worker getHeroConfig 公開、saveHeroConfig 限 database.manage）；移除先前個人帳號版的背景設定
- 2026-10-11 萬聖節主題改為「鬼魅綠」（配色參考 bedimcode/responsive-halloween-website：橄欖綠→卡其漸層＋橘色重點；圖案自繪：月亮蝙蝠、幽靈、女巫帽、發亮南瓜、冒泡大鍋），原黑紫版保留為「萬聖節·黑夜」（固定主題可選）
- 2026-10-11 首頁節慶背景只保留一週：萬聖節10/25–10/31、聖誕12/19–12/25、新年除夕到初五、情人節2/8–2/14
- 2026-10-11 萬聖節（鬼魅綠）改用 Microsoft Fluent Emoji 3D（MIT 授權；assets/festival/fluent/，含授權檔）：滿月、蝙蝠、蜘蛛網、蜘蛛、幽靈、南瓜燈、糖果，配色維持橄欖綠→卡其漸層；移除自繪的 hw-*.svg
- 2026-10-11 編輯背景：「自動依日期」與「手動指定主題」改成兩個明確選項（手動立刻生效、不看日期）；煙霧測試加入手動選聖誕預覽與取消還原
- 2026-10-11 萬聖節（鬼魅綠）改用使用者提供的 3D 圖片（assets/festival/hw3d/，已壓成 webp 約 120KB）：月亮蝙蝠、幽靈、女巫帽、吊蜘蛛（擺動）、南瓜、鬼屋、糖果、發光南瓜；電腦版有漂浮／擺動／發光／薄霧動畫與滑鼠視差（transform/opacity，省電），手機靜態且只留 4 個；移除先前下載的 Fluent Emoji 檔案
- 2026-10-11 移除黑色版萬聖節（halloweennight）及其自繪圖檔
- 2026-10-11 聖誕／新年／情人節改用 Microsoft Fluent Emoji 3D（MIT，assets/festival/fluent3d/ 共 17 張 webp 約 120KB，含授權檔），資料驅動場景（HX_SCENES）：聖誕＝樹／雪人／禮物／鈴鐺擺動／旋轉雪花；新年＝四盞擺動燈籠／紅包／錢袋／鞭炮／金幣；情人節＝愛心／箭／情書／巧克力／玫瑰／小熊／上升愛心；電腦版有動畫與視差，手機靜態精簡；移除舊自繪 SVG
- 2026-10-11 新增端午節（綠色：龍／龍臉／粽子／龍舟／鼓／艾草擺動）與中秋節（深藍夜空：滿月／玉兔／月餅／茶具／燈籠／梨／閃爍星星），Fluent Emoji 3D（MIT）21 張 webp 約 140KB；日期內建 2026–2035，各保留一週（節日前 5 天到後 1 天）
- 2026-10-11 情人節移除白色愛心浮水印（保留 3D 圖案）

## 2026-10-11 節慶場景加強前後層次
- 聖誕／新年／端午／中秋／情人節各加「遠景」（小、淡、微模糊、低視差）與「近景」（超大、陰影重、高視差）物件，大小與前後層次更明顯。

## 2026-10-11 萬聖節加遠景／近景
- 萬聖節場景加小而淡的遠景（小鬼、糖果、蜘蛛、南瓜、帽子）與超大近景（南瓜、鬼），手機隱藏遠景與大鬼。

## 2026-10-13 修正：18:00 後沒心跳仍掛廁所
- pixelOfficeApplyOffline 的「廁所保留 1 小時」判斷繞過了 18:00 規則，已移除，統一交給 pixelOfficeOfflineStatus：18:00 後沒心跳直接下班。

## 2026-10-13 像素辦公室：下排「加班中」標籤移離臉部
- 下排座位的加班中標籤原本壓在人物臉上，往下移到胸口位置（drawOvertimeBadge）。

## 2026-10-13 像素辦公室：音樂與對話合併成同位置分頁，對話加清除鈕
- 音樂分享與「想說的話」合併為「音樂與對話」一區，頁籤切換；環形選單也合併成一個圖示。
- 想說的話加「清除」鈕（清空並移除人物上方對話）。

## 2026-10-13 像素辦公室：泡泡框輪流顯示（更正上一則）
- 還原「音樂與對話」合併頁籤；改成同時有音樂跑馬燈與對話時，兩個泡泡放同一位置、每 6 秒輪流顯示。想說的話保留「清除」鈕。

## 2026-10-13 像素辦公室：名牌改成「名字 (狀態)」小膠囊
- 移除人名牌與桌面上的狀態文字膠囊／加班標籤，改成每人一個「Machi (加班中)」小膠囊（在座也顯示）。狀態圖示保留。

- 在座時膠囊只顯示名字。

- 小膠囊位置：上排在座壓在電腦中間、不在座（開會／廁所…）放圖示上方；下排放桌子下緣；字級縮小。

- 下排座位：椅子改回背面圖並畫在人物上層。

- 下排在座：膠囊移到頭頂上方；椅子改回正面圖並在人物下層；膠囊字型回到 13px/高 22/半徑 11，並依狀態上色。

- 下排在座膠囊再往上移，確實放在頭頂上方。

- 多元宇宙 iframe 網址加 5 分鐘時間戳，避免 Ctrl+F5 刷不到新版像素辦公室（iframe 會吃舊快取）。

- 下排膠囊改為固定在座位上（不再隨人物走動飄移）。
- 2026-10-16: 短網址 restored in the left rail (短網址): new table 短連結 (短碼/原始網址/名稱/建立者帳號/建立者/建立時間/更新時間); Worker actions listShortLinks/createShortLink/updateShortLink/deleteShortLink/resolveShortLink + GET /<code> redirect; codes are custom or auto 6 chars, English+digits 3-32, case-insensitive unique, reserved words blocked; any logged-in account can create, owner/管理者 can edit/rename/re-target/delete; 404.html resolves via API (no static index). Worker redeployed.
- 2026-10-16: 短網址 v2: links now point at the Worker (`https://machi-design-api.machi-chen.workers.dev/<code>`) which answers a real 302 (no interstitial, Cache-Control no-store); click counts live in DO SQLite table short_link_clicks (moved on rename, cleared on delete); new 專案 column for project categories + project filter in the list; 404.html redirects short codes silently. Worker redeployed.
- 2026-10-16: 短網址 base kept as https://emctaipeiart.github.io/<code> (404.html resolves via Worker API with count:true; page stays hidden until it fails, so no interstitial).

- 2026-10-16: 重新設計短網址頁面：建立／編輯改用專案分類下拉與新增分類欄位，重繪保留分類與草稿；統一篩選、短碼前綴、卡片、點擊數與標籤，複製／編輯／刪除採綠／藍／紅並支援深色及手機排版。node --check 通過，27 項 Node VM 功能檢查通過；npm test 252 通過、20 項僅因沙盒 listen EPERM 未通過；已更新資源戳記，瀏覽器視覺驗證受環境限制未完成。
- 2026-10-16: 短網址 v3: Worker now owns custom domain go.emc-art.com (moved from the empty emc-shortener Worker; its KV had 0 keys) so https://go.emc-art.com/<code> is a real 302 + click count, root redirects to emc-art.com; links list is private by 組別 (viewer sees own links + links whose creator's current 設定.組別 equals theirs; 管理者 sees all; redirect itself stays public). Old emc-art.com/<code> still resolved by 404.html. Worker redeployed. Tests: Gmail redirectUri in worker tests aligned to emc-art.com.
- 2026-10-16: 短網址 v4: display base is https://emc-art.com/<code> (no go.). Worker route emc-art.com/* added: single-segment known codes -> 302 + click count, everything else passes through to GitHub Pages (fail-open). Takes effect only while the emc-art.com DNS record is Proxied (orange); while DNS-only (grey) 404.html still resolves the code. go.emc-art.com kept for old links. Worker redeployed.
- 2026-10-16: 短網址 隱私分類: new column 可見範圍 (同組=default/全部/僅自己) chosen per link in create/edit forms; list visibility = owner + 管理者 always, 全部 -> every logged-in user, 同組 -> same 設定.組別 as creator, 僅自己 -> nobody else; badge on each card; redirect itself stays public. Worker redeployed.
- 2026-10-16: 短網址 批次建立: collapsible box above the list; paste up to 200 URLs (one per line, optional name before/after URL), shared 專案/可見範圍; Worker action createShortLinksBatch (one commit, per-line failures reported, failed lines stay in the box); all new short URLs auto-copied. Worker redeployed.
- 2026-10-16: 短網址 delete UX: optimistic delete (row disappears at once, restored with a toast if the write fails); per-card checkbox (own links / 管理者 all) + 全選 bar + 刪除選取; Worker action deleteShortLinks (one commit, skips links you don't own and reports them). Worker redeployed.

## 2026-10-17 手機多元宇宙：拖動畫面走路
- 手機（窄螢幕）在畫面任何位置按住拖動＝自己的人物往該方向走（浮動搖桿），鏡頭固定跟著自己，不再平移；開始走動時環形選單收起。輕點照舊選人。原本的搖桿在手機隱藏。

## 2026-10-17 手機多元宇宙改開新分頁、拖動更靈敏
- 手機（窄螢幕＋觸控）進多元宇宙改開新分頁（全螢幕），新分頁用 window.opener 向主站取登入身分；彈出視窗被擋就退回站內顯示。重新整理不再自動回站內多元宇宙。
- 拖動走路：觸發距離 10→4、停止距離 12→5、方向門檻 .38→.3，手機走路速度 210→290。

## 2026-10-17 上下班時段設定（管理者與 Machi）
- 多元宇宙頁新增「上下班設定」按鈕：可關閉整組時間規則（假日／下班／加班／沒心跳自動下班都不套用，手動狀態保留，測試用），並可設定上班開始、午休、下班、加班開始的整點。
- Worker：getPixelHours（公開讀）／savePixelHours（database.manage），設定存 DO pixelHours；測試已補。

- 全員上班：多元宇宙頁新增「全員上班」按鈕（管理者與 Machi），一次把所有設計師設成在座（晚上加班），休假／出國的人不動。Worker 動作 pixelOfficeAllWork（database.manage），測試已補。

- 修正：全員上班與時間規則衝突。按下後到台北時間當天 24:00 為止，時間規則（假日、下班、沒心跳自動下班）暫時不套用（DO pixelAllWorkUntil）。

## 2026-10-17 手機多元宇宙：縮放與畫面殘影修正
- 手機新增兩指縮放與右下角＋／－按鈕，縮放範圍鎖在 0.3～0.95（偏好存 localStorage pixelZoom）。縮放時暫停拖動走路。
- 畫面殘影：每幀整張畫布清除後再畫，鏡頭位移對齊到整數像素（避免像素圖在小數位置閃爍／殘影感）。

- 手機縮放改為只用兩指捏合（pointer events，與拖動走路同一套）、移除＋／－按鈕；還原畫面清除與鏡頭取整的改動（無法確認有效，且懷疑影響走路）。

- 手機新分頁拿不到 window.opener 時（登入身分沒傳過去，導致鏡頭不鎖人物、拖動不走路）：主站開分頁前把登入交接資料存 localStorage pixelViewerHandoff，像素辦公室讀取（10 分鐘內有效）。

## 2026-10-17 手機發熱優化
- 靜止時改為按需喚醒（無動畫時不再每幀空轉；markDirty 與按鍵會立刻喚醒）。
- 只有加班特效在動時降到約 10fps；走路／操作最多約 60fps。
- 手機畫布解析度上限 2 倍 → 1.5 倍（像素約少 44
## 2026-10-17 手機發熱優化
- 靜止時改為按需喚醒（無動畫時不再每幀空轉；markDirty 與按鍵會立刻喚醒）。
- 只有加班特效在動時降到約 10fps；走路／操作最多約 60fps。
- 手機畫布解析度上限 2 倍改為 1.5 倍（像素約少 44 趴）。

## 2026-10-17 多元宇宙預設大小還原
- 縮放（手機兩指、桌機＋／－）不再記在 localStorage，每次進入都回預設大小，並清掉舊的記憶值。
- 直接開像素辦公室網址（沒帶參數）的預設場景比例由 .78 還原為 1.2（站內多元宇宙頁維持 .78）。

## 2026-10-17 多元宇宙頁鎖定一個畫面＋滑鼠拖曳平移
- 還原前一版「iframe 長高＋外層捲動」；改成電腦版站內多元宇宙整頁鎖定在一個畫面（iframe 高度＝視窗剩餘高度，標題、右上按鈕、右下 ＋／－ 一直看得到）。
- 場景不再用滾輪捲動（攔截滾輪），改成空白處按住滑鼠拖曳平移；點人物照舊。

- 多元宇宙 iframe 大小改變時重新對到自己的座位。

- 多元宇宙頁：iframe 一路拉到視窗底（載入後多次重算高度、去掉底部留白）；點人物開圓形選單時，自動把人物捲到視窗正中央，選單不再被邊緣擠歪。

- 手機走路更順：走路時重畫上限由約 30～60fps 提高到跟螢幕更新率（最高約 120fps），鏡頭跟隨改成依時間計算（不同幀率速度一致）。靜止時仍不重畫。

- 手機多元宇宙身分掉失修正：登入交接資料有效期 10 分鐘→24 小時，且主站登入狀態下每次載入與每 20 分鐘重寫一次；手機分頁拿不到身分時 4 秒後提示。

- 電腦版新增 W／A／S／D 走路（跟方向鍵一樣，不必先點人物，會自動選自己的角色）；手機版走路速度 290→400。

## 2026-10-17 網格／列表「填寫修改」與修改紀錄標示
- 網格卡片與列表（信件欄）新增「填寫修改」按鈕：專案部／企劃部、案件專案負責人、管理者在「過稿中／修改中」的案件可直接填修改需求（沿用「填寫修改需求信」流程，記錄進修改紀錄並寄給設計師）。
- 修改紀錄標示：「日期｜李明庭（填寫）」表示填寫人，後面獨立顯示「✓ 設計師已確認修正 時間」，不再看起來像填寫人做的確認。

- 「填寫修改」放寬：所有登入且有回信權限的人都看得到（過稿中／修改中）；設計部與管理者／Machi 顯示「新增修改」，直接開修改紀錄表單、不寄信；其他人沿用「填寫修改需求信」（寄信給設計師）。

- 列表：「填寫修改／新增修改」移到「內容」欄，與編輯、刪除同一欄（原本被擠在信件欄被截掉）；列表的修改輪次（初稿／一修…）不再鎖權限，看得到案件的人都能點開查看修改紀錄（新增仍受權限控制）。

## 2026-10-17 造型：進元宇宙不再先跳舊造型、選完造型就存頭像快照
- 像素辦公室本機快取現在也還原「造型 look」，第一幀就是上次選的服裝／帽子／眼鏡，不用等伺服器狀態到了才切換。
- 選完造型（或恢復預設）0.8 秒後通知外層，外層 0.6 秒後請遊戲產生頭像快照並上傳（沿用既有 pixelOfficeAvatarSnapshot、lookKey 相同不重傳），不必等關閉多元宇宙。

- 首頁隱藏小視窗（avatars 模式）：頭像圖只在造型或音樂狀態變了才重畫，其餘沿用上次的圖（以前每 10 秒全部重畫）。

- 音樂分享泡泡寬度 190→140，左右縮短約四分之一。

- 卡片展開區的操作列不再重複放「新增修改／填寫修改」，只保留卡片右下那一顆（列表內容欄不受影響）。

## 2026-10-17 手機底部選單避開 iPhone 底部手勢＋滑動切頁
- 手機（≤720px）底部選單改為多排格狀（每排 7 個），不能橫向滑動，整排抬高並加 safe-area 底部留白（viewport 加 viewport-fit=cover）。iPhone 螢幕最底部左右滑會切換／關閉 App，原本可橫向捲動的選單一滑就誤觸。
- 手機左右滑動切換主要頁面（順序同選單）：避開輸入框、橫向可捲動區域、地圖／iframe、彈出視窗與螢幕左右邊緣 28px；html/body 加 overscroll-behavior-x:none。

- 手機底部選單改回單排可左右滑動（兩排太醜）：按鈕放大（74px 寬、約 77px 高）、整排抬高並在底部留 16px＋safe-area 空白避開 iPhone 底部手勢區。

## 2026-10-17 主畫面 App 登入修正、底部選單空白縮小
- 加到主畫面的 App（standalone）改用整頁跳轉登入 Google（彈出視窗在 iOS 會跑到另一個瀏覽環境，結果傳不回來，要重試好幾次、最後 401）；回到 index.html 時由 site.js 驗證 state 後完成登入，不再轉去 legacy.html。standalone 只顯示自己的「使用 Google 帳號登入」按鈕。
- 手機底部選單下方空白縮小（safe-area 只取 60 趴＋6px）。

- 主畫面 App 登入頁：Google 按鈕改為直接寫在頁面裡的固定按鈕（原本事後塞進容器，iOS 第一次進入會畫成破圖、重新整理才好）。

- 手機單獨開啟的多元宇宙（新分頁／主畫面 App）左上角新增「返回系統」鈕：有 opener 先 window.close，沒有（或關不掉）就回網站首頁。

## 2026-10-18 出氣擂台改在原視窗內執行
- 元宇宙頁的「出氣擂台」按鈕原本是開新分頁（a target=_blank）；改成在原視窗內嵌 vent-arena 遊戲（左側功能列保留），上方有「返回元宇宙」，iframe 高度依視窗自動調整。

## 2026-10-18 出氣擂台：預設陪練李明庭、角色圖改用即時造型快照
- 預設陪練改為李明庭（vent-arena/arena.js 的 state.target 4→7）。
- 角色全身圖改用即時造型：首頁隱藏的像素辦公室小視窗為每個人畫目前造型的全身正面圖（只在造型變了才重畫），經主站轉給出氣擂台，遊戲收到就取代內建圖；沒有快照或獨立開啟時沿用 assets 內建圖。

## 2026-10-18 出氣擂台：我的角色綁定帳號、四個新場景
- 我的角色綁定登入帳號（vent-arena 向主站要登入者名字；對應到 11 位名單就鎖定為該角色，不能改選；沒登入或不在名單內預設 Amber）。
- 場景改為 辦公室／擂台場／練舞室／垃圾場，重新繪製（漸層、燈光、道具、透視地板；新增 vent-arena/scenes.js，畫一次快取）。

## 2026-10-18 出氣擂台電腦版滿版
- 進出氣擂台時移除上方綠色列、外層標題與「返回元宇宙」按鈕、外框與陰影，遊戲滿版；保留遊戲內左上的「返回元宇宙」（內嵌時改由主站切回元宇宙頁，不會在 iframe 裡再開一份）。

## 2026-10-18 修正：出氣擂台改版沒生效（快取）
- 原因：index.html 的 site.js 版本寫成手動字串（vent-arena-20261018），stamp 工具認不得（只認十六進位雜湊），之前幾次推送都沒換版本號，瀏覽器一直用舊的 site.js。改回雜湊版本。
- vent-arena 的 css／js 加上版本參數、內嵌網址加 5 分鐘時間戳，之後更新不會被快取卡住。

## 2026-10-18 修正：首次連線（無痕）出現頭身不合的即時快照
- 原因：自訂造型清單／圖還沒載好時，隱藏小視窗就先畫全身快照，造型被當成無效而退回預設，畫出「Machi 的頭接在 Leona 身體」這種半成品，還依造型代碼被快取住。
- 修正：全身快照要等 (1) 自訂清單已回來 (2) 伺服器記的造型沒被退回預設 (3) 用到的自訂圖都載好 才畫；沒準備好就先用遊戲內建的靜態圖。

- 出氣擂台：攻擊範圍鎖住右鍵／長按選單、文字與圖片選取、拖曳、雙擊縮放與手勢（輸入框除外），手機長時間連點不會變成選取狀態。

- 修正：GitHub Pages 發布流程的觸發檔案清單漏了 vent-arena/**，只改遊戲檔案的推送不會上線（Codex 的拳頭圖示與我的「鎖住右鍵／選取」都因此沒發布）。已補上；這次推送改到流程檔本身，會觸發一次完整發布。

- 修正：出氣擂台按重新整理會跳回首頁。原因是「記住目前頁面」的清單（KEEP_VIEWS）沒有 arena；補上後重新整理會停在出氣擂台。

## 2026-10-18 出氣擂台深色模式
- 新增 vent-arena/dark.css：整頁反相＋色相轉回，畫布／角色圖／圖示再反相還原原色；arena.js 依 ?theme=dark、主站訊息（pixelOfficeTheme）或獨立開啟時的系統深色設定切換。主站內嵌時跟著網站的深淺色切換鈕（broadcastTheme 加入 arenaFrame）。

## 2026-10-18 元宇宙辦公室：設計部左側新增三組桌子群
- 設計部左側新增三組桌子群，每組 4 張（2×2、兩兩合併、先空著），與設計部／同仁桌的三個上下層對齊；只在整頁／編輯版出現（首頁小框不變）。
- 世界座標整體右移 LX=200（整頁／編輯版），伺服器仍存舊座標（讀入 +LX、送出 -LX）；本機快取版號 5→6（舊的位置快取作廢一次）。整頁預設縮放因場景變寬略小，可用右下 ＋／－ 放大。

- 出氣擂台：陪練血量區塊移除白色底框（新增 vent-arena/overrides.css）。
- 修正：即時全身快照要等伺服器狀態同步完（syncVersion>0）才畫，否則造型是空的會被當成預設（例如吳冠賢的白衣服）。

- 設計部桌子群左側桌沿拉直（含往上複製的兩組）：左端兩張桌子改用「同仁左端」的直邊素材（type 12/13、empty 14），與左側新桌子群的右端直邊對齊。

## 2026-10-18 出氣擂台：共用排行榜、未登入使用者
- 排行榜改存 Worker（ventArenaScore／ventArenaRanking，DO 儲存）：全站共用、關掉再回來還在；登入的人每種模式只留最高分，沒登入顯示「未登入使用者」；回傳前 10 名。遊戲內仍保留本機紀錄當備援。
- 排行榜與本機紀錄的名字改用登入者名字（沒登入＝未登入使用者），不再顯示預設角色名（Amber）。

- 出氣擂台預設淺色：不再跟系統深色設定；只有網站本身（主畫面）選了深色模式才變深（內嵌時由主站傳主題，單獨開啟時讀網站的深色設定）。

- 出氣擂台排行榜移除「本機」「此瀏覽器」字樣：標題「排行榜」、說明「前十名紀錄」、成績欄「最高分」。

- 出氣擂台 K.O. 大字比照狀聲詞（POW!／SUPER!!）：粗斜體、深紫粗外框、亮黃字（vent-arena/overrides.css）。

## 2026-10-18 短網址批次合併顯示
- 短網址列表：同一建立者、同一建立時間且 2 筆以上的連結（批次建立）合併成一張「批次建立 N 筆」卡片，可展開/收合、複製整包（名稱＋短網址）、編輯整包（每行「名稱 原始網址」，行數需相同）、刪除整包。

## 2026-10-18 批次卡片顯示累計點擊
- 批次合併卡片補上整包累計點擊與每筆點擊次數。

## 2026-10-18 批次卡片預設展開
- 批次合併卡片預設展開，可手動收合。

## 2026-10-18 批次建立獨立區塊
- 「建立批次短網址」改為與「建立短網址」同樣的獨立表單區塊與標題列，不再收合。

## 2026-10-18 出氣擂台頭頂腫包弧度
- 頭頂 2～3 顆腫包改依頭型弧度排列：兩側略低並向外傾斜。

## 2026-10-19 元宇宙上下班時間統一
- 企劃部、專案部的人與桌子群、沒人坐的空桌：平日 09:00–19:00 亮（空桌不再午休變灰）；19:00 之後、09:00 之前，設計師一律套用加班濾鏡。
- 後端預設時段改為 上班開始 09:00、下班 19:00、加班 19:00（午休 12–14 不變）；若曾在「上下班設定」存過自訂值則以自訂值為準。

## 2026-10-21 出氣擂台一對一對戰連線日誌
- 連線失敗原因會顯示在畫面上（沒網路、元件載入失敗、配對伺服器無回應、找不到戰場、無法直連、戰場已滿），對戰中每 2 秒心跳、7 秒沒收到訊息顯示「連線中斷」。
- 新增連線日誌：記在 localStorage `emcVentDuelLogV1`（最近 300 行）與 console，對戰視窗與結果視窗都有「複製連線日誌」按鈕（vent-arena/duel.js）。

## 2026-10-21 出氣擂台對戰改走 Worker 中繼
- 原因：使用者連線日誌顯示「已連上配對伺服器、但 WebRTC 直連 15 秒失敗」（公司／NAT 網路擋 P2P，公用 TURN 不可靠）。
- 改法：新增 Durable Object `DuelRoom`（worker/src/duel-room.ts，migration v2，路由 `/duel`），雙方都連到 Worker、由房間轉送；關閉碼 4404 找不到戰場、4409 已滿／序號重複。前台 vent-arena/duel.js 移除 PeerJS，改 WebSocket，含斷線重連（房主）、重試（對手）、心跳。
- 驗證：worker vitest 172/172（含 test/duel-room.test.ts）、tsc 通過；已部署；本機（允許的來源 127.0.0.1:8787）兩分頁走真實 Worker 完成配對、出招同步、錯誤序號提示、對方離開偵測。

## 2026-10-21 出氣擂台 Safari 一直顯示舊版（快取）
- 原因：GitHub Pages 對所有檔案回 `cache-control: max-age=600`，Safari 對 iframe 內頁與子資源（css／js）的快取較積極，且 vent-arena 的檔案版本字串是手動維護、容易忘記改。
- 修正：①`tools/stamp.cjs` 新增 vent-arena/index.html 的 css／js 內容雜湊版本（執行 `node tools/stamp.cjs` 會自動更新，不必再手動改版本字串）；②site.js 內嵌出氣擂台的網址 `&t=` 改為每次開啟用 `Date.now()`，內頁 HTML 每次都重新抓。

## 2026-10-23 修正：Machi／管理者點選其他人物後無法操作
- 10月17日加入 WASD／手機拖動走路時，會強制把選取切回自己的人物，導致點選別人後按鍵或拖動只會動自己。改為只有「目前沒有選任何人」時才自動選自己，已選別人就操作那個人。

## 2026-10-23 元宇宙：只有管理者與 Machi 能操控別人
- 其他人（設計師、企劃／專案同仁）點別人的人物會提示「你只能操控自己的人物」，不再選取；管理者與 Machi（monitor）可選任何人並操作。

## 2026-10-23 元宇宙：空位坐透明人物（未登入）
- 沒人坐的辦公桌（不含會議室、廁所、無椅的大桌）在平日 09:00–19:00 坐一個半透明人影，下班與假日跟椅子一起收掉。

## 2026-10-23 修正：空位透明人物改用「未登入」角色圖
- 空桌上的人影改用 vent-arena/assets/ghost_unknown_back.png（背面圖），坐在椅子後面，露出頭髮與肩膀。

## 2026-10-23 修正：空位人物上排改正面、補左下角白色長桌
- 上排座位的「未登入」人物改用正面圖（原本背面看起來像陰靈）；下排維持背面。左下角白色長桌補上背面人物。

## 2026-10-23 未登入人物：名牌與隨機走動
- 空位上的「未登入」人物名牌顯示「未登入」。
- 約四分之一的空位會隨機起身，走到附近空地站一會兒或再走一段後回座位，同時最多 3 位；只在上班時間、整頁／編輯版，各瀏覽器各自隨機，不同步。

## 2026-10-23 修正：走動的未登入人物比例
- 走動人物高度由 290 改為 180，與坐著的未登入人物同一比例（頭部大小一致）。

## 2026-10-23 設計師可使用「對位基準不是自己」的自訂頭像
- Amber 的新頭像在頭像生成器是照 Leona 的原頭像（headIndex 0）對位，原本被遊戲濾掉。現在設計師的自訂頭像不再限制 headIndex，穿上時改用該頭像對位時的原頭像格子排（geoIdx），本機檢查正面／側面／背面都沒有錯位。
- 修正測試：名牌測試改配合「未登入」名牌新寫法。

## 2026-10-23 行事曆會議 → 人物入座會議室 A～D
- Worker：行事曆同步讀會議的地點／標題／說明，辨識「會議室 A～D」（pixelOfficeMeetingRoomOf），只把字母寫進人物狀態 meetingRoom（不留存活動內容）；會議結束或換房間時更新／清掉。
- 設定：上下班設定視窗新增「行事曆有會議時，人物依會議室入座」開關（PixelHours.meetingRooms，預設開）。
- 畫面：狀態為開會且有 meetingRoom 的設計師，畫面上依會議室椅子（上排→下排→兩側）入座，桌位維持「開會中」標記；不寫回後端座標。沒寫會議室的維持原本開會中。

## 2026-10-24 修正：下班時左側桌子群沒有收椅子與電腦、桌面灰階
- 左側新增桌子群與左下角白色長桌，下班與假日（平日 09:00–19:00 以外）跟其他桌子一樣：桌面灰階、椅子與桌上電腦收起來。

## 2026-10-24 修正：設計部左下角空桌（Mac mini 桌）下班沒收電腦
- 沒人坐的 Mac mini 桌在下班（桌面轉灰階）時，桌上的電腦一起收掉，只留灰階桌面。

## 2026-10-24 廁所改成隔間（立體隔板）
- 男廁、女廁：馬桶各自在一格隔間裡，隔板有厚度（頂面往右上斜、側面、3 px 黑外框，與房間素材同畫法），每格右側有一片半開的門，洗手台在最後一格。取代原本平放的細長隔板。程式畫（roomDivider／roomStallDoor），沒有新增圖檔。

## 2026-10-24 廁所與玻璃隔間改斜視角、輪廓變細
- 廁所：後排兩格隔間（隔板＋前門）各一個馬桶（正面略俯視），前面兩個洗手台；程式畫、2 px 深灰藍輪廓，取代原本側面素材與 3 px 純黑線。
- 玻璃隔間（會議室 A～D、廁所）：牆頂之外加上後牆與前牆的正面（高 30），與桌椅同樣的短斜視角；輪廓由 3 px 純黑改 2 px 深灰藍；門口內不畫牆。

## 2026-10-24 廁所退回 Codex 原側面素材、等 Codex 重畫；玻璃牆線條恢復 3 px 純黑
- 使用者覺得程式畫的廁所太醜、要串 Codex 重畫：廁所先放回 v5 側面圖（暫代），需求寫在 EMC-ART-Pixel-Office/ASSET_REQUESTS.md（斜視角、3 px 純黑線、2 個馬桶各一格隔間）。
- 玻璃隔間輪廓恢復 3 px 純黑（像素遊戲感）；保留 2026-10-24 新增的後牆／前牆正面（短斜視角）。

## 2026-10-24 廁所重畫（像素斜視角）
- 新素材 assets/office-toilet-v6（程式產生的低解析像素圖放大 3 倍、3 px 黑外框）：toilet_front、sink_front、partition_v、stall_door。
- 版面：後排兩格隔間（三片隔板＋兩片前門）各一個馬桶，前面兩個洗手台；馬桶與馬桶之間完全隔開。

## 2026-10-24 廁所改版 v7：由上而下 馬桶 > 馬桶 > 洗手台，全部朝右
- 素材 assets/office-toilet-v7（取代 v6）：toilet_r、sink_r（含鏡子、龍頭、台座陰影）、stall_wall_h（有頂面、正面、端面的橫隔板）、stall_door_v；多階陰影與高光，3 px 黑外框。
- 版面：橫隔板把馬桶與馬桶、馬桶與洗手台隔開，每個馬桶隔間右端一片門，右側留走道。

## 2026-10-24 書櫃與深紅工具箱改斜視角、洗手台改成洗手檯
- 新素材 assets/office-props-v8：prop_bookshelf（大黑書櫃）、prop_shelf（窄黑書櫃）、prop_cabinet（深紅工具箱，四層抽屜），都有頂面與正面、3 px 黑外框；drawProp 改用新圖（原 Codex 側面圖保留作備援）。
- 洗手台（office-toilet-v7 的 sink_r）改成洗手檯：白色檯面＋長方形水槽＋龍頭＋下方雙門櫃＋左側鏡子，不再像馬桶。

## 2026-10-25 廁所照使用者畫的圖重做（office-toilet-v8）
- 每間廁所：由上而下 馬桶隔間、馬桶隔間、洗手台，全朝右；隔間有兩側立柱、灰色後牆、前緣橫桿，最後一格前面一片灰色前板；地面改白磁磚＋淡灰格線；洗手台在左下。素材 stall_unit、stall_band、sink_r（取代 v7）。

## 2026-10-25 廁所直接套用使用者提供的圖
- assets/office-toilet-v9.webp：裁切自使用者的示意圖（含白磁磚地面、兩格隔間、洗手台），男廁女廁共用，貼在地面層；另放兩塊看不見的擋路區（隔間組、洗手台）。取代程式畫的 v8。

## 2026-10-25 整個元宇宙地板畫上灰色格線
- 比照廁所的白磁磚：整頁（非首頁小框）地板每 64 px 一條淡灰線（rgba(120,128,136,.16)），從世界座標 0 對齊，畫在最底層，桌椅、房間、人物都在它上面。

## 2026-10-25 廁所地板格線與全場地板對齊
- 廁所圖（office-toilet-v10）把地面磁磚去掉（只留兩格隔間、洗手台與上方玻璃帶），廁所地板改由全場 64 px 灰色格線決定，線條與外面連成一片、不再對不上。

## 2026-10-25 全員上班＝正常上班狀態、可自由切換
- Worker：全員上班一律設成「在座」（原本晚上會變加班）；期間（到台北時間當天 24:00）電腦心跳也判成在座、不套加班；pixelOfficeState 的 hours 帶 allWorkUntil。手動切換狀態照常可用，時間規則（假日、下班、沒心跳自動下班）暫停到 24:00。
- 前端：收到 allWorkUntil 期間，currentTaipeiClock 視為平日中午——不套加班濾鏡、桌椅不收、不顯示下班、空位人物照常坐著。

## 2026-10-25 會議室辨識加強與診斷
- 辨識「會議室（A）」「會議室-A」「A-會議室」「A廳」，以及行事曆預約的會議室資源（attendees.resource 的 displayName）。
- 行事曆同步結果新增 rooms：每位開會中的人是哪一間，沒寫會議室顯示「(會議沒寫會議室)」，讀不到活動內容顯示「(讀不到活動詳細內容)」，方便診斷「為什麼沒入座」。

## 2026-10-25 會議室辨識：受邀者信箱 meetingroom{a-d}.emc@gmail.com
- 行事曆活動邀請的受邀者信箱是 meetingrooma～d.emc@gmail.com 就算該會議室（對方拒絕的不算），優先於文字辨識。

## 2026-10-25 會議室：其他設計師也要入座、上排坐低一點
- Worker：讀會議室行事曆（meetingrooma～d.emc@gmail.com）看現在誰被邀進哪間（讀不到就略過），補上「讀不到他的活動內容」的人；有訂會議室＝人在會議室，電腦開著也照樣入座（原本「人在電腦前就不套用會議」「心跳把會議收回在座」對有會議室的會議不再生效）。同步結果 rooms 多一欄 _roomCalendars 顯示 A～D 行事曆是否讀得到。
- 畫面：會議室上排椅子的人往下 16 px（坐太高）。

## 2026-10-25 會議室：訂了會議室的活動照行事曆頁的認定算會議
- 受邀者有 meetingroom{a-d}.emc@gmail.com 或文字寫會議室的活動，就算被設成「空閒／透明」也算會議（行事曆頁顯示的就是這些活動），再套 4 小時長度規則；沒訂會議室的透明活動（專注時間等）仍不算。

## 2026-10-25 會議室：同一場會議（iCalUID）共用會議室
- 有人的行事曆看得到會議室（受邀者信箱／資源）時，其他被邀進同一場會議（相同 iCalUID）的設計師也算同一間——有些人的行事曆讀得到活動、卻看不到受邀者名單。

## 2026-10-25 行事曆頁顯示設計師開會的會議室
- Worker designCalendar：每個行程多一個 room（A～D；依受邀者信箱 meetingroom{a-d}.emc@gmail.com、資源、地點、標題判斷，同一場會議相同 iCalUID 共用）。
- 行事曆頁：每日格子的行程後面加「〔A室〕」，點開當天明細顯示「・會議室 A」。

## 2026-10-25 修正：人物進會議室後原本的桌椅要清空、桌面灰階
- 入座會議室時 isAway 被設成「不離席」才畫得出人物，連帶讓桌位變成沒離席（藍色桌面、椅子與電腦還在）。stationAway 改看出勤狀態：人在會議室時原本的桌子仍是離席——桌面灰階、椅子與電腦清空、桌位顯示「開會中」。

## 2026-10-25 修正：散會後人物卡在會議室
- 原因：人物在會議室時畫面位置是前端依會議室排的，卻被當成真的座標寫回後端（x、y），散會後狀態雖回到在座，位置仍是會議室座位。
- 前端：在會議室裡的人不會走動、也不會把座標送回後端（pushChange 過濾 x／y／dir）。
- Worker：行事曆會議且有 meetingRoom 時，pixelOfficeUpdate 忽略 x／y／dir（舊版畫面也不會再把位置寫壞）。
- 資料：把被寫壞的 Leona、Amber、Noise、Anna 位置還原到各自座位。

## 2026-10-25 「全員上班」改成單一切換鈕（全員上班 ↔ 全員下班）
- 元宇宙頁只剩一顆鈕：標籤是「按下去會變成的狀態」。全員上班＝大家在座、畫面當平日中午；全員下班＝大家下班、桌椅收起、桌面灰階。兩種都可再手動改個別狀態；時間規則暫停到下一次切換或當天 24:00。移除確認視窗與長說明。
- Worker：pixelOfficeAllWork 帶 mode（work/off），getPixelHours 與 pixelOfficeState.hours 回傳 force；前端以 force 決定畫面時段。

## 2026-10-25 去廁所的人物走進隔間
- 狀態為「去廁所」的設計師會走進廁所隔間、站在馬桶旁朝右（女生女廁、男生男廁，各兩格；超過兩人的維持原狀）；原本的桌位維持離席（灰階、清空）。位置只在畫面排，不寫回後端（沿用會議室的 inRoom 機制）。

## 2026-10-25 電梯改成 5 樓、只往下
- 電梯樓層顯示由「▲ 08 ▼」改成「5F ▼」（程式蓋掉原圖的指示燈，像素字），名牌改「5F 電梯 ↓ 往樓下」。

## 2026-10-25 手動操控也能走進廁所隔間
- 廁所的擋路區原本把兩格隔間整塊擋住；改成只擋左側水箱柱、兩片後牆、最下面的前板與洗手台，隔間中間留空，從右側走道走進去。本機測試：從走道往左走能走進隔間，撞到水箱柱停下。

## 2026-10-25 修正：操控人物走動時畫面鎖定該人物中心
- 畫面跟隨原本只鎖「自己」的人物；管理者／Machi 選了別人操控時，畫面不跟著走、要手動滾動。新增 focusIndex()：選的人剛走動過（4 秒內）或正在按方向鍵就鎖定他，否則鎖定自己；桌機的 followOwn 與手機的 updateCamera 都改用它。本機測試：操控 Anna 往下走 2.5 秒，畫面跟著捲、人物停在視窗正中央。

## 2026-10-26 四樓像素辦公室（樣板）
- 新增 EMC-ART-Pixel-Office/dist/floor4.html／floor4.js：靜態四樓場景（沒有人物），沿用五樓圖集。左上電梯（4F ↑↓）；右側 10 人木長桌，旁邊茶水間；左側五個米白桌子群（每群上下各一排、每排四張，共八張）；右側大會議室 H（玻璃、上下兩個出口、投影機往右、六張白桌排成「C」一桌兩椅）；桌子群下方會議室 F、G（同 B、C）；右側兩間大玻璃屋各六張桌椅。
- 元宇宙頁工具列新增「四樓／回五樓」按鈕切換（state.uniFloor）。

## 2026-10-26 四樓調整與電梯過場
- 四樓：桌子大小比照五樓（頁面縮放與五樓一致，過寬就橫向捲動）；電梯右側放男廁、女廁（同五樓的廁所圖與玻璃屋）；木長桌改放右邊，茶水間在它旁邊；桌子群與右側房間整體下移。四樓的電梯點一下回五樓。
- 電梯過場：五樓被操控的人物走到電梯門前朝上走，會通知外層（postMessage pixelOfficeFloor），元宇宙頁播放電梯門關上＋「4F」樓層顯示＋門打開的過場，並切到四樓；「四樓／回五樓」按鈕也走同一個過場（floorTransition，.uni-elev-fx）。單獨開像素辦公室時直接換頁到 floor4.html。

## 2026-10-26 四樓可走動、縮放比照五樓
- 四樓縮放固定比照五樓桌機（0.78；手機 0.5），不再依視窗寬度放大到走不動。
- 人物跟著下四樓：五樓人物走進電梯時帶上名字（pixelOfficeFloor.name），外層把該人物的「全身正面快照」（state.pixBodies）傳進四樓（floor4Hero），四樓用 WASD／方向鍵／手機拖動走路，撞牆與家具（blocks）停下、畫面跟著人物；走回電梯門前往上走回五樓。人物位置只在四樓本機，不同步。

## 2026-10-26 四樓改成跟五樓同一份遊戲（?floor=4）
- 先前四樓是獨立的簡易頁面（人物是靜態圖、沒有功能鍵、不會側身）。改成開同一份 app.js，加 ?floor=4&hero=人名：場景由 floor4.js（只負責地板、電梯、廁所、木長桌、茶水間、桌子群、會議室、玻璃屋與擋路方塊）提供，人物、資料卡、功能鍵（圓形選單）、走路側身、狀態心情對話、跟隨鏡頭全部沿用五樓。
- 四樓只顯示走下來的那位人物（其他人 f4hide）；位置只在本機、不寫回後端；縮放比照五樓 cs=.78，過寬時橫向捲動；走到四樓電梯門前往上走回五樓（pixelOfficeFloor floor=5）。
- 刪掉 floor4.html。

## 2026-10-26 修正測試：drawOffice 前面多了四樓分支

## 2026-10-26 四樓規格全面比照五樓
- 縮放：四樓套用跟五樓完全同一個算法（min(min(cs, 寬度×.96/場景寬)×＋－縮放, 寬度×.96/場景寬)，場景寬含同仁桌＝2250），同一個視窗寬度下地板格子（64 px）與桌椅大小與五樓一致（先前四樓固定 .78，五樓實際被視窗寬度限制在較小的值，所以格子不同）。
- 位置／間距沿用五樓數字：電梯 x＝TX0(245)、電梯與廁所下緣對齊（五樓電梯下緣＝廁所下緣）、電梯→男廁走廊 110（CORR）、男女廁寬 346×高 438、廁所→長桌走廊 110 且長桌位置＝五樓會議室 A 桌子位置；桌子群左緣 78、離廁所下緣 136、群距 497（GPV）、上排椅頭在桌上緣上方 67、下排椅頭在下排桌上緣下方 72；最後一群到會議室 F 的走廊 114；F、G 在 x=60；右側玻璃屋與小會議室間隔 92。

## 2026-10-26 四樓配置調整（一格＝地板一格 64 px）
- 木長桌往左 2 格、往下 2 格；茶水間搬到木長桌上方置中。
- 第一排（電梯、廁所、長桌）與下方桌子群、會議室的走道再拉開 2 格；桌子群間隔縮小 1 格（群距 497→433）。
- 會議室 H 往右 2 格、往下 1 格。
- 兩間玻璃辦公室搬到會議室 H 下方（上下兩間），每間改成上排 4 桌＋下排 4 桌共八個位置。

## 2026-10-26 四樓再調整
- 右下兩間玻璃辦公室：桌椅拆成「四張一個單位」、上下兩個座位群（各一排四張桌＋椅子）；拿掉「玻璃辦公室 1／2」文字。
- 會議室 F、G 再往右 1 格。
- 廁所下方走廊與辦公室（桌子群）之間再少 1 格（原本拉開 2 格，現為 1 格），下方各房間跟著上移。

## 2026-10-26 四樓玻璃辦公室改 2×2 群、窄長向下延伸
- 照使用者畫的圖：每間玻璃辦公室把左側兩張桌子移到右側兩張下方合併成 2×2（上排 2＋下排 2、椅子在最外側）為一個單位，上下共兩個桌子群；房間縮窄（寬 568）並向下延伸，兩間在會議室 H 下方左右並排（門：第一間上＋左、第二間上＋右）。
- 茶水間與木長桌再隔開一格（64 px）。

## 2026-10-26 四樓重新整理後停留在四樓
- 元宇宙頁換樓層時把樓層與下樓的人物記在 sessionStorage（uniFloor、uniHero），重新整理或從出氣擂台回來都回到原本的樓層。四樓遊戲內也記人物位置（f4pos，約每 0.8 秒存一次），重新整理後回到離開時的位置；搭電梯換樓層時清掉，從電梯口重新出發。

## 2026-10-26 會議室 H 向右延伸
- 會議室 H 寬度由 798 延伸到 1196，右緣與下方兩間玻璃辦公室（各 568、間隔 60）的右緣切齊；桌椅位置不變，上下出口仍在房間正中間。

## 2026-10-26 修正：四樓出現「找不到這個頁面」
- 原因：renderUniversePage 重畫元宇宙頁（例如重新整理後停留在四樓）時，iframe 還在用舊的 floor4.html 網址，而那個檔案已刪除。改成一律走 uniFrameSrc()（?floor=4）。另外補一個 floor4.html 轉址檔，給還快取舊版 site.js 的使用者。

## 2026-10-26 四樓：會議室 H 桌椅、廁所、木長桌、茶水間向右靠齊
- 會議室 H 的 C 形桌椅與投影機靠房間右側（右邊留 130）；男女廁、木長桌、茶水間（電梯除外）整組往右 398（＝H 變寬的量），彼此間距不變。

## 2026-10-26 三位同仁座位搬到四樓、四樓空位坐「未登入」
- 黎子瑄、余采馨、鄭筱舢的座位改到四樓左側由上而下第四桌群（STAFF_F4）：座位編號 1～4＝上排由左到右、5～8＝下排由左到右；黎子瑄 8 號、余采馨 6 號、鄭筱舢 7 號。五樓不再顯示他們，原座位空出來（跟其他空位一樣坐「未登入」人物）。
- 四樓桌椅改成與人物一起依深度排序的動態圖層（人坐在桌後、椅前）；四樓桌位名牌沿用五樓。
- 四樓其餘空座位比照五樓：上班時間坐「未登入」透明人物並有「未登入」名牌（不會走動）。

## 2026-10-26 四樓：會議室 F、G 搬到玻璃辦公室下方；桌子群走道加半格
- 會議室 F、G 左右並排放在兩間玻璃辦公室正下方（左緣各自對齊）；左側桌子群之間的走道再拉開半格（32 px，群距 465），玻璃辦公室內的兩個座位群跟著同一個群距。場景高度由 4600 縮到 3500（下方不再留一大片空白）。

## 2026-10-26 四樓三位同仁轉身向前
- 黎子瑄、余采馨、鄭筱舢在四樓座位上改成面向畫面（STAFF_F4.face＝down），不再背對。

## 2026-10-26 四樓：拿掉木長桌文字、會議室 H 上方出口改左側、會議室 G 出口改左側

## 2026-10-26 修正：四樓第一桌群出現廖秦葦、李明庭名牌
- 原因：applyStaff 照五樓同仁座位表把名字寫到 stations 的同位置，四樓因為 stations 裡放了空位，名字寫到四樓第一桌群的空位上。四樓不再用五樓座位表命名桌位，這兩個座位恢復「未登入」人物。

## 2026-10-26 四樓會議室 H 投影機移到桌子群右側、機身朝右

## 2026-10-26 會議室辨識擴到 A～H
- 四樓有會議室 F、G、H：行事曆辨識（受邀者信箱 meetingroom{a-h}.emc@gmail.com、地點／標題／說明的「會議室 X」）由 A～D 擴到 A～H，行事曆頁會顯示 F、G、H。五樓人物入座仍只處理 A～D（四樓房間沒有對應的五樓座位）。

## 2026-10-26 行事曆會議在會議室 F、G、H：人物自動進四樓會議室
- 後端已辨識 A～H（見上一筆）。前端 syncF4Meetings：狀態是開會、meetingRoom 為 F／G／H 的人（設計師或同仁，本人除外）在四樓出現並坐進該會議室的椅子（座位順序：上排→下排→兩側，F、G 各 4 位、H 12 位），散會就消失；五樓這時本來就是離席（桌面灰階、座位清空）。四樓桌子群裡的同仁（黎子瑄等）開會時不再坐在原位。
- 四樓桌、椅、電梯、標籤、小物都改成與人物一起依深度排序的圖層（人坐在桌後、下半身被桌子擋住）；地板格線、玻璃牆、廁所圖維持固定背景。

## 2026-10-26 行事曆同步在「全員上班／下班」強制期間不受 08–22 點限制
- 半夜（例如凌晨 3 點）按了全員上班後測試行事曆會議，原本同步因為不在 08–22 點被略過（skipped: off-hours），人物不會變開會中。強制期間改為照常每分鐘同步。

## 2026-10-26 手機版選單：四樓、全員上班／下班、上下班設定
- 手機單獨開啟的元宇宙（新分頁／主畫面 App）沒有外層工具列，所以左上「返回系統」旁多一顆「☰ 選單」：「四樓／回五樓」、（管理者與 Machi）「全員上班／下班（切換）」與「上下班設定」（含會議室入座開關）。用 storyIdentity.token 當 editorToken 呼叫同一組後端動作。

## 2026-10-27 元宇宙頂部「出氣擂台」改為「小遊戲」
- 主站元宇宙頁上方按鈕「出氣擂台」改成「小遊戲」：點了會通知像素辦公室 iframe（`pixelOfficeMiniGames`）載入並開啟小遊戲選單；像素辦公室畫面內下方兩顆彩色按鈕（出氣擂台 ↗、小遊戲）移除。
- 選單內容：所有人只看到「出氣擂台」（點了通知主站切到出氣擂台頁，`pixelOfficeOpenArena`）；其餘測試中的遊戲只有管理者與 Machi（`storyIdentity.monitor`）看得到。
- 先前「管理者／Machi 不帶 ?minigames=1 自動開入口」的做法改為上述選單機制。

## 2026-10-27 載入畫面金句
- 刪除「色彩學教了四年，最後還是改成老闆喜歡的藍。」，新增 22 句同類型的設計師日常金句（index.html、legacy.html 兩份清單同步）。

## 2026-10-27 小遊戲暱稱
- 已登入帳號的人進小遊戲選單與連線躲貓貓大廳，直接使用帳號名字（隱藏暱稱輸入框）；未登入者保留暱稱輸入。

## 2026-10-27 辦公室躲貓貓縮小場地
- 場地改成只用辦公室下半部一塊（會議室 B、C、茶水間與走道，約 1190×1000，原本整層 2370×3260）：hideseek-sim 的 MAP 加 view/bounds 裁切（家具、遮蔽區域、遮擋圖層、出生點只留範圍內的），畫面與小地圖只畫這一塊。單機與連線版（worker/hide-room 共用同一份 sim，已重新部署）一起縮小。

## 2026-10-27 躲貓貓場地再縮小並補家具
- 場地縮成約 1100×980；走道補 4 張米色辦公桌＋椅子、6 盆盆栽（各帶擋路範圍與綠色躲藏區），出生點改成走道上緣一排。家具畫在底圖上（hideseek-draw drawSorted），資料在 hideseek-sim 的 MAP.props。

## 2026-10-27 躲貓貓改橫式 16:9
- 場地改成橫式（view 1760×990）：茶水間、走道、4 組辦公桌椅、盆栽與會議室 D；B、C 不在範圍內。預設改全圖視角（人物與家具縮小，保留跑動空間），M 仍可切換跟隨；出生點改為走道上緣一排。

## 2026-10-27 躲貓貓場地重排（無玻璃隔間）
- 不再使用整層辦公室底圖與玻璃牆：場地改為專為躲貓貓排的 2240×1260 橫式空地（淺色格線地板），用現有素材重新排列辦公桌、會議桌（含投影機）、白色長桌與直式桌、茶水間、書櫃、冰箱、方柱、工具櫃、盆栽，每件家具有擋路範圍，高的也擋視線，旁邊有綠色躲藏區。世界變大、畫面比例縮小，跑動空間更多。
- worker/test/hide-room.test.ts 改成從場地動態挑一個躲藏區。

## 2026-10-27 辦公室尋寶：整批元件重畫並開放
- 道具從 8 個 10×10 簡陋像素圖改為 16 個 64×64 的 3 px 黑框像素道具（Codex 繪製，minigames/assets/office-treasure-v1.webp）；道具列格子、已找到框、提示按鈕、找到時的閃光三格動畫也一併換新。
- 辦公室尋寶開放給所有人（小遊戲選單的 PUBLIC 名單），其餘測試遊戲仍只有管理者與 Machi 看得到。

## 2026-10-27 辦公室尋寶：道具增加、全場景可捲動、改藏桌上與角落
- 道具從 16 個增為 32 個（再加 16 個：直尺、橡皮擦、迴紋針、螢光筆、仙人掌、檯燈、鬧鐘、甜甜圈、蘋果、筆筒、識別證、資料夾、手機、水壺、面紙盒、充電線，minigames/assets/office-treasure-v2.webp）；每天仍抽 5 個。
- 位置：不再只限目前看得到的畫面，整個辦公室都可能藏；4 個藏在桌面（辦公桌、白長桌、會議桌、茶水間桌）或房間角落／家具旁（app.js treasureSpots），最多 1 個放在地上。遊戲中滾輪或拖曳可捲動畫面（手機移動鏡頭）；用提示時若道具在畫面外會自動捲過去。
- 道具縮小（場景 44 px，原 64 px），命中範圍跟著縮。

## 2026-10-27 手機版小遊戲入口
- 手機單獨開啟的多元宇宙，左上「選單」加入「小遊戲」（所有人都有）；選單內容同桌機（出氣擂台、辦公室尋寶；管理者另有測試遊戲）。

## 2026-10-27 截稿倒數成績驗證太嚴
- 玩家高分局（50 題、答對 47）被伺服器判 too-fast、成績只存本機：兩題最短間隔 0.3 秒 → 0.12 秒、第一題最短 0.6 → 0.3 秒（人類連點極限）；機器人式等間隔偵測與正確性重算不變。worker 已重新部署。

## 2026-10-27 四樓：同仁下電梯後人物沒出現（只能走路）
- 原因：企劃／專案同仁的名單比四樓場景晚載入，initFloor4 只在一開始找一次自己的人物，找不到就整層人物全隱藏、但鍵盤還能操作走路。
- 修正：找不到自己就每 0.4 秒重找，找到才顯示；之後才載入進來的人物也一併照規則隱藏。

## 2026-10-27 樓層分身：記錄每個人在哪一層
- 症狀：人從五樓按「四樓」按鈕（或搭電梯）去四樓，其他人看到他還站在五樓（分身）。
- 後端 pixelOfficeUpdate 新增 floor 欄位：floor:4 記下 floor4At 時間、floor:5 清掉。四樓畫面每分鐘回報一次；回五樓後自己清除。
- 五樓畫面（app.js onFloor4）：別人 floor4At 在 2.5 分鐘內就不畫他（超時當作已離開四樓；本人在五樓不藏自己）。

## 2026-10-27 四樓人物與樓層標記：強制載入新版
- 本機以 iframe 模擬外層（唯讀、hero=Machi）確認四樓人物會出現、後端 floor 欄位（floor:4 記時間、floor:5 清除）正常；外層元宇宙 iframe 網址的版本參數 v=118 → v=119，讓已開啟的使用者拿到新版四樓程式。

## 2026-10-27 四樓：同樣在四樓的人互相看得到
- 症狀：Machi 去四樓後，別人（五樓看不到他是對的）在四樓也找不到他。
- 後端：floor:4 可附 fx／fy／fdir（四樓位置，和五樓 x／y 分開存為 f4x／f4y／f4dir）；floor:5 一併清除。
- 前端：四樓畫面把自己的走動改存成 fx／fy／fdir；收到別人的 floor4At（2.5 分鐘內）與 f4x／f4y 就把他畫在四樓該位置，超時或離開就藏起來。固定坐四樓的同仁與會議室中的人不受影響。

## 2026-10-27 四樓：未登入看不到在四樓的人／回五樓馬上出現
- 未登入（或找不到自己）的人看四樓，原本每 0.4 秒重找自己時會把所有人重設成隱藏，所以看不到別人。現在已出現的別人不會被重設，且只重找 30 秒。
- 回五樓：四樓離開前（電梯或外層按鈕）先告訴後端 floor:5 並把位置放在五樓電梯門前（leaveFloor4），五樓的人馬上看到他出現；五樓頁面載入時若還記得在四樓也會補送。外層切樓層前先通知四樓（pixelOfficeLeaveFloor4）。

## 2026-10-27 點「在座」會先跳到廁所洗手台
- 原因：狀態是「去廁所」（或會議）時，applyMeetingRooms 把人物的 x／y 直接改成廁所隔間（或會議室）的座位；改回「在座」後沒有還原，人物就停在廁所裡的位置，看起來像跳到洗手台。
- 修正：離開廁所／會議室時回到後端記的真實位置（realPos，沒有就回進去前的位置 preRoom）。

## 2026-10-27 桌機走路速度
- 桌機走路速度 210 → 290（手機維持 400）；走路時每格都 save()（寫 localStorage）改為約 0.6 秒一次，減少卡頓。

## 2026-10-27 四樓桌上筆電滑鼠與下班灰階
- 四樓桌子群與玻璃辦公室的米色桌：上班時桌上放黑色筆電＋黑色滑鼠（上排看背面、下排看正面，跟五樓左側新桌子群一樣）；下班（平日 09:00–19:00 以外、週末假日，window.f4DeskDimmed）桌面灰階、筆電滑鼠與椅子收起來。

## 2026-10-27 四樓下班收人物
- 下班（平日時段外、週末假日、全員下班）固定坐四樓的同仁一併收掉（只留加班中的）；未登入半透明人物原本就只在平日 9–19 點出現。

## 2026-10-27 茶水間冰箱互動（偷吃／補貨／排行／被抓包）
- 點元宇宙茶水間的冰箱或零食桌（座標 620–1104 × 1095–1265，冰箱上有「冰箱・點我」標籤）開 `fridge.js` 面板：拿零食、補貨（每次 +2，每人每天 5 次）、管理者一鍵補滿；顯示今日補貨人名牌、本週零食之王／補貨英雄。
- 趣味：優格 1/8 機率「過期優格」、部分日子出現限量金布丁、下班時間或週末偷吃會「被抓包」。
- 後端：`worker/src/minigame-board.ts` 新增 `fridge_*` 資料表與 `fridge()`／`fridgeAct()`；`index.ts` 加 `/minigames/fridge`（GET 查、POST 動作）。每天第一次被問到自動進貨（台北日期），補貨人顯示「自動進貨」。已 `wrangler deploy`。測試加在 `worker/test/minigame-board.test.ts`。
- 圖示：Codex 畫的 `assets/office-snacks-v1.webp/json`（8 個 64×64），同步到 `cdn/public/assets/`。`app.js?v=314`、新增 `fridge.js?v=1`。
- 本機測試可用 `?mgApi=<Worker 網址>` 指定後端。

## 2026-10-27 冰箱改版：場景裡直接開門、桌上紙箱拖進冰箱補貨
- 不再跳窗：點場景裡的冰箱，冰箱就地開門（關著的門收成窄條、側門浮現），三層架上的零食直接點一個拿一個；結果用冰箱上方的對話泡泡顯示，下方寫今日補貨人／零食之王／補貨英雄；30 秒沒動作或點旁邊會自動關門；管理者多一顆「一鍵補滿」。素材 Codex 畫的 `assets/office-fridge-ui-v1.webp/json`，同步到 cdn。
- 補貨：茶水間桌上有 3 個紙箱（每個標一種零食），拖到冰箱放開，後端 `action:'box'` 該格 +3、箱子被拿走（所有人同步，先搶先贏）、名牌換成補貨人；每 4 小時換一批。`fridge.js` 負責冰箱開門與紙箱拖曳（`window.fridgeBoxDraw`／`fridgeBoxDown`／`fridgeSceneClick`，app.js 在 pointerdown 最前面、`onGamePress` 開頭與 `pushRoomFurniture` 掛接）。
- 後端 `minigame-board.ts` 新增 boxes 與 `box` 動作，已部署；測試在 `minigame-board.test.ts`。`app.js?v=317`、`fridge.js?v=4`。
- 本機測試注意：Worker 的 ALLOWED_ORIGINS 不含 localhost:8765，本機要自己 mock fetch。

## 2026-10-27 冰箱再改：深色冰箱左右對開門、19 種辦公室食物、站近才能開、人物表情
- 場景裡兩台深色冰箱（各 82×170）點一下就「左右對開」（左台往左開、右台往右開，關著的門收成窄條、側門浮現），每台 3 層×3 格共 17 種可拿食物＋限量金布丁：珍珠奶茶、便當、御飯糰、三明治、提神飲料、茶葉蛋、泡麵、咖啡、蛋糕、甜甜圈、巧克力棒，加上原本的洋芋片、餅乾、糖果、布丁、優格、汽水。移除「一鍵補滿」（前端與後端 `fill` 動作都拿掉）。素材 Codex 畫：`assets/office-foods-v1`（28×28×19）、`assets/office-fridge-dark-open-v1`（內部 82×170、側門 34×170，右台鏡像），已同步 cdn。
- 必須「自己的人物」站在冰箱前（`NEAR` 範圍）才能開門；沒有自己的人物或太遠會跳提示，走遠自動關門；拖紙箱補貨也要在冰箱旁。
- 拿食物時人物轉向冰箱並有表情：甜食／珍奶 → 愛心跳（joy）、一般食物 → 開心跳（happy）、限量金布丁 → 愛心、過期優格 → 哭（sad）、下班偷吃被抓 → 氣炸（angry）。用 app.js 的 `tempMood`（只在自己畫面上，不寫回人物資料，時間到恢復）；`__pixelOffice` 新增 `ownPos`、`tempMood`。
- 後端 `FRIDGE_SLOTS` 擴成 17 種並已部署；`app.js?v=318`、`fridge.js?v=5`。

## 2026-10-27 冰箱開門後人物不再被擋住、表情時轉正面
- 開門的冰箱本體改成與冰箱同一層（depth 1266）畫，站在冰箱前的人物（腳在冰箱下方）會畫在冰箱前面；只有對話泡泡留在最上層（depth 99997）。冰箱下方的補貨名牌資訊也跟本體同層，不會蓋住人物。
- 拿食物做表情時人物轉成面向正面（dir `down`）；開門動作仍面向冰箱。`app.js?v=319`、`fridge.js?v=6`。

## 2026-10-27 小遊戲全部開放
- `minigames/core/menu.js` 不再依管理者過濾：出氣擂台＋辦公室尋寶、接籃框、截稿倒數、躲貓貓（單機／多人）全部對所有人顯示（原本只有尋寶公開）。`minigames/index.js?v=16`、`app.js?v=320`。

## 2026-10-27 四樓也有冰箱＋開門／拿食物大家都看得到
- 四樓茶水間的深色冰箱做成跟五樓一樣（左右對開、站近才能開、桌上紙箱拖進冰箱補貨、拿食物人物表情）。庫存、紙箱、補貨名牌與五樓分開（後端資料表鍵加 `4:` 前綴，`?floor=4`／body `floor:4`）；紙箱每 4 小時換一批、每日自動進貨。`fridge.js` 改成從 `sync()` 取座標：五樓固定，四樓由 `floor4.js` 設的 `window.__f4Fridge`；四樓圖層由 app.js 在 `layers` 裡用 `fridgeDepths()` 排序。四樓冰箱上方加「冰箱・點我」標籤。
- 同步：後端新增 `fridge_events` 表；`open`（開門）、`take`、`box` 都會記一筆事件，GET 回傳 `events`／`evMax`（只回 20 秒內、最多 20 筆）。每個畫面每 4 秒問一次，別人的動作會在自己畫面重演：冰箱自動開門 9 秒、頭上冒泡泡（「某某：台詞」）、該人物做對應表情（`__pixelOffice.tempMoodByName`，只在觀看者本機暫時改，不寫回資料）。自己的事件不重演；同樓層才看得到。
- app.js 的暫時表情由單一改成 Map（多人同時）。`app.js?v=321`、`fridge.js?v=7`、`floor4.js?v=17`；後端已部署，測試加在 `minigame-board.test.ts`。

## 2026-10-28 管理者操控企劃同事下四樓，下去的變成本人
- 原因：同仁（企劃／專案）是後端回應後才動態加進 `names`；四樓頁面載入時 `initFloor4` 用 `hero=` 找不到人，就退回「自己（ownIndex）」，所以 Machi 本人下樓，不是被操控的那位。
- 修：`initFloor4` 指定了 `hero` 卻還找不到時不再退回本人，先等名單載入（沿用既有的重試，最多 30 秒，之後才退回本人）；名字比對改成不分大小寫。`app.js?v=322`。

## 2026-10-28 右上角樓層按鈕一律帶「本人」
- 管理者操控企劃同事走電梯下四樓後，按右上角「5F」原本會把那位同事帶回五樓。改成：按鈕一律指定「我本人」（`ownUniName()`＝登入者名字）——去四樓時本人當主角、回五樓時只帶本人回去（`pixelOfficeLeaveFloor4` 帶 `only`，四樓主角不是本人就不動他）。走進電梯才是被操控的那位人物上下樓（維持原樣，電梯路徑不再重複送離開訊息）。
- 被留在四樓的同事沒人心跳，約 2.5 分鐘後會從四樓消失、回到五樓原位置。`site.js`（stamp）、`app.js?v=323`。

## 2026-10-28 提早散會解除會議；企劃／專案同仁依通訊錄信箱入座會議室
- 設計師：訂了會議室的會議以前即使人回到電腦前也不會解除。現在連續在電腦前（同一套門檻）就收回成在座，並記下該場會議結束時間（`meetingEnd`→`deskReleasedEnd`），行事曆同步在那之前不再把他設回會議；下一場會議照常。
- 企劃／專案：後端從 `設定` 表（通訊錄匯入的帳號＝公司信箱）取信箱，比對會議室 A～D 行事曆的受邀者，結果存 `pixel_office_settings.staffMeetings`，`pixelOfficeState` 回傳 `staffMeetings`；前端 `applyStaff` 收下後在 `applyMeetingRooms` 把同仁排進該會議室（桌子變灰）。會議室行事曆讀不到時維持上一輪，不會誤趕人。
- 限制：只認得「會議室行事曆（meetingrooma～d）有看到的活動」，且同仁帳號必須是信箱；四樓不套用。app.js v324，worker 已部署。

## 2026-10-28（續）通訊錄群組受邀的同仁、會議室 F～H
- 會議受邀者若是通訊錄群組（b@／c@emctaipei.com），會議室行事曆只會看到群組信箱、不展開成員（例：吳冠賢）。改為：會議室行事曆事件記下 iCalUID，再讀同仁自己的行事曆（有分享才讀得到），同一場會議（iCalUID）就對到那間會議室；同步結果多了 `staffRooms`、`staffCalStatus` 供診斷。
- 會議室行事曆加上 F、G、H（meetingroomf／g／h.emc@gmail.com；沒有 E）。前端把同仁的會議狀態移到 `applyMeetingRooms` 最前面，四樓也吃得到（app.js v325）。

## 2026-10-28（續）會議室座位不夠時站在空白處
- 會議室（五樓 A～D、四樓 F～H）椅子坐滿後，其餘的人改站在室內空白處：`standSpots()` 在室內畫格子、避開桌子家具與椅子，離中心近的先站。四樓 `floor4.js` 匯出 `roomRects`／`blocks`。
- 順手修正：企劃／專案同仁在五樓 A～D 的入座判斷（`applyMeetingRooms` 不再讓同仁提早 return）。app.js v326、floor4.js v18。未做畫面截圖驗證。

## 2026-10-28（續）固定坐四樓的同仁到五樓會議室開會
- 原因：`isAway` 把四樓固定同仁（黎子瑄、余采馨、鄭筱舢）在五樓一律當成離席，即使行事曆把他們排進五樓會議室（A～D）也不畫。改成在會議室（`inRoom`）時照常顯示。app.js v327。

## 2026-10-28（續）企劃／專案同仁提早散會自動解除
- 同仁沒有電腦心跳，行事曆到預定結束前都會把他留在會議室。新增：本人在元宇宙頁面操作（點擊／按鍵，每 60 秒最多通知一次）→ 前端送 `pixelOfficeStaffBack`，後端記下 `staffReleased[名字]＝那場會議的預定結束時間`，同步時不再把他排進會議室，並立即從 `staffMeetings` 移除。預定結束後照常交還給行事曆（下一場會議不受影響）。
- 後端同步結果新增 `staffEnds`（記在 `staffMeetEnds`）。app.js v328，worker 已部署。限制：必須是同仁本人登入且開著元宇宙頁面；沒開頁面的人只能等會議預定結束。

## 2026-10-28（續）AI 服裝生成器：「The image data you provided does not represent a valid image」
- 生成紀錄裡 12:24～12:39 王藍庭的頭像／參考照片／衣服共 8 筆失敗，錯誤都是 OpenAI 判定上傳的照片不是有效圖片（副檔名／type 是 JPG，內容多半是 HEIC 或毀損）。原因在獨立 repo `EMCtaipeiART/emc-ai-stage-classifier`。
- 修法（已部署 emc-ai-stage-classifier）：前端上傳前一律用 canvas 重新編碼成真正的 JPEG（最長邊 1600，`lib/normalize-photo.ts`，套用在服裝、頭像、建立角色三處）；後端 `describeOutfit` 改看檔頭位元組判斷真實格式，不是 PNG／JPEG／WebP／GIF 就回清楚的中文訊息。解不開的檔案（例如非 Safari 的 HEIC）會直接提示改用 JPG／PNG。未用真實 HEIC 實測。

## 2026-10-28（續）王藍庭固定坐四樓 E 桌子群 5 號
- `STAFF_F4` 加入 王藍庭（g:4、seat:5）。她還沒完成「建立你的角色」（後端同仁名單裡沒有她；AI 生成器的照片上傳失敗就是她卡住的原因，已修），所以目前畫面上沒有人物；完成後會自動入座並顯示在四樓這個座位。app.js v329。

## 2026-10-28（續）王藍庭角色直接設定完成
- 她的頭像（e6d65a91…）與衣服（2bdf597b…）都已生成完成，只差最後一步。依使用者指示：D1 `persona_profiles` 設為完成（step=done、completed_at）；後端新增一次性補登 `seedStaffLanTing`（由每分鐘排程呼叫、`seed:王藍庭` 標記只做一次）：排進同仁座位 6、造型用上述頭像與衣服。顯示位置是四樓 E 桌子群 5 號（`STAFF_F4`）。
- 不放在 migration：測試的空資料庫會被影響。首頁圓形頭像快照要等 Machi／管理者進元宇宙時由系統自動更新。

## 2026-10-28（續）四樓同仁在座位與會議室之間來回跳、鄭筱舢不見
- 王藍庭來回跳：遠端狀態每次輪詢（4 秒）都把同仁的 `status` 蓋回「在座」，四樓 `syncF4Meetings` 卻靠 `status==='meeting'` 判斷是否入座會議室，於是在座位與會議室之間跳。改為同仁一律直接看後端的 `staffMeetings` 名單；`syncF4Staff` 的桌面顯示判斷也加上這份名單。以正式站資料在本機四樓畫面驗證，連續 6 次取樣都穩定在 F 室。app.js v330。
- 鄭筱舢不見：她的後端狀態是手動設定的「會議」（15:19 起，沒有會議室），四樓把非在座／加班的人收掉，所以整天沒畫出來。已用 `pixelOfficeUpdate` 把她的狀態改回「在座」。後續若同仁自己點了「會議」忘記取消，仍會被收掉。

## 2026-10-28（續）固定坐四樓的同仁在四樓被釘在座位上不能動
- 原因：`syncF4Staff` 每一幀把 `STAFF_F4` 裡的人（含王藍庭）的座標重設成座位，連本人（或被操控的人，`__f4hero`）也一起，所以走不動。現在本人只放桌子、不改座標，並保持顯示。app.js v331。未在正式站實測。

## 2026-10-28（續）Machi 在四樓操控固定坐四樓的同仁走不開座位
- 原因：v331 只放過「本人（`__f4hero`）」；Machi 在四樓點選同仁來操控時，同仁不是 hero，仍被 `syncF4Staff` 每幀釘回座位，只剩小幅位移。改為 `i===__f4hero||i===selected` 都不釘（`syncF4Meetings` 也一樣）。本機用正式站資料驗證：強制選取王藍庭後從 x=188 走到 609。app.js v332。

## 2026-10-28（續）右上角四樓／五樓按鈕只切換畫面，人物不跟著移動
- 使用者確認的操作規則：Machi 登入後方向鍵操控 Machi 本人、點選其他人物就操控那個人、取消選取回到本人；右上角「四樓」「五樓」按鈕只切換畫面，不帶任何人上下樓；要上下樓走進電梯。
- site.js：按鈕改成 `floorTransition(to,'','view')`（不送 `pixelOfficeLeaveFloor4`、不指定 hero），四樓網址帶 `&view=1`，狀態存 `sessionStorage.uniView`（重新整理維持）。app.js v333：`view=1` 時 `initFloor4` 不放任何人到電梯口、`__f4hero=-1`，只顯示固定坐四樓的同仁與從電梯上來的人，點選即可操控；不再每 0.4 秒重試找 hero。本機用正式站資料驗證：view 模式下選取黎子瑄可走 848→1182。電梯路徑（人物自己上下樓）不變。已重跑 `node tools/stamp.cjs`。

## 2026-10-28（續）四樓按「在座」人物跑到別處消失
- 原因：狀態列「在座」會呼叫 `returnEveryone()`，把所有人移到五樓座位座標（`starts`）；四樓地圖用同一組座標，人物就被丟到四樓地圖的別處（畫面跟著跳、人看起來消失）。四樓改為：固定坐四樓的同仁回自己的四樓座位，被操控的其他人回電梯口，遠端的人不動。本機驗證：黎子瑄按「在座」後回到 (848,2633)＝她的四樓座位。app.js v334。

## 2026-10-28（續）四樓操控別人時畫面一直回朔
- 原因：右上角按鈕改成只切換畫面後，四樓沒有 hero；操控的人（被選取）被當成「別人」，`applyRemote` 每 4 秒用後端的四樓位置（f4x／f4y）蓋回去，而他的新位置又不會回報（只有 hero 才送 fx／fy），所以走一走或按「在座」後下一秒又跑回原位。
- 修法：`applyRemote` 不覆蓋被選取的人；`pushChange` 對被選取、可見、非固定坐四樓的人也送四樓位置（fx／fy）；「在座」把被操控者送回電梯口時也同步。本機模擬（Anna 當作從電梯上來的人）：選取後走 320→740，9 秒（兩次輪詢）後仍在 740。app.js v335。

## 2026-10-28（續）圓形選單的「在座」在四樓把人丟到五樓座標；滾動收合選單
- 真正原因：點選人物出現的圓形功能選單，「在座」按鈕（`defs` 的 `k==='seat'` 分支）自己寫了一段 `p.x=starts[i][0]…`，直接把人移到五樓座位座標（黎子瑄 → 1758,695），四樓地圖上等於跑到別處、畫面跟著跳走、人看起來消失。前幾次只改了狀態列那顆「在座」（`returnEveryone`），改錯地方。用使用者的 Chrome 在正式站重現後才找到。
- 修法：抽出 `returnSeatF4(i)`（固定坐四樓的同仁→四樓座位；其他被操控者→電梯口並回報位置），圓形選單的「在座」與 `returnEveryone` 的四樓分支都改用它。
- 圓形選單在使用者滾動畫面（滾輪、觸控、拖捲軸）時直接收合，跟人物走動一樣；程式自己的跟隨捲動不算。app.js v336。

## 2026-10-28（續）四樓點選人物畫面跳到最上面
- 用使用者的 Chrome 在正式站追到：點選人物開圓形選單時，`radialOpen` 會用五樓畫面比例的算式把畫面捲到「人物所在位置」；四樓比例不同（cleanScale），結果把畫面捲到地圖最上面（scrollY 1451→20）。四樓不再在這裡捲動（選單自己會限制在可見範圍內，`followOwn` 負責跟隨）。app.js v337。圓形選單測試的模擬環境補上 `FLOOR4`、`window.addEventListener`。

## 2026-10-28（續）四樓點選人物／回座位後畫面跳到地圖最上面（真正原因）
- 用使用者的 Chrome 在正式站記錄捲動來源，確認：`followOwn` → `focusIndex()` 只在「人物 4 秒內有動」時回傳被選取的人，否則退回「本人（ownIndex）」；右上角按鈕改成只切換畫面後，Machi 不在四樓（隱藏、座標在五樓），camera 就被帶到她的位置＝地圖最上面。人物停下 4 秒、或點選／按「在座」之後都會跳。
- 修法：四樓（`FLOOR4`）只要被選取的人可見，`focusIndex()` 一律回傳他。app.js v338。
- 這次排查另證實：圓形選單的「在座」（v336）已在正式站驗證會回到四樓座位（黎子瑄 → 848,2633）；選單在使用者滾動時會收合；v337 起 `radialOpen` 在四樓不捲動。注意：`dist/index.html` 有 10 分鐘快取，使用者要等或強制重新整理才拿到新版 app.js。

## 2026-10-28 四樓取消選取後不再彈回座位、畫面不亂彈（v339）
- 固定坐四樓的同仁被選取走動後，取消選取原本每幀被釘回座位 → 改記住離開位置（f4Free），留在原地，按「在座」才回座位。
- 四樓取消選取時鏡頭沿用最後操控的人（f4LastFocus），不再退回看不見的 Machi 而跳到地圖最上面。

## 2026-10-28 四樓取消選取後畫面跳到廁所（v340）
- 四樓沒有可跟隨的人時，focusIndex 退回看不見的本人、鏡頭預設跳到地圖底部（廁所）→ 改成回傳 -1，鏡頭停在原地。

## 2026-10-28 下班後企劃／專案同仁走動解除下班與加班，五分鐘無動作回下班（v341）
- 新增 staffAwake／awakeP：被操控走動的企劃、專案同仁 statusOf 視為「在座」，四樓 f4hide 也放行；每次走動刷新，10 秒檢查一次，超過 5 分鐘回下班並清掉四樓離座位置（四、五樓共用）。只在本機畫面生效。

## 2026-10-28 下班後走動的企劃／專案同仁改為加班狀態（v342）
- 走動解除下班後 statusOf 回傳 overtime（上班時間內仍是 present），5 分鐘無動作回下班。

## 2026-10-29 點選人物第一次選單立刻收合（v343）
- 點選時鏡頭自己捲動（followOwn）被當成使用者捲動而收合選單 → 開啟後 0.9 秒內、以及程式捲動後 0.5 秒內的 scroll 不收合。

## 2026-10-29 四樓人物在角落時圓形選單錯位（v344）
- place() 的邊界取了場景範圍（holder 左側留白 144px），四樓人物靠左時選單被推開 → 四樓只受視窗限制。

## 2026-10-29 手機兩指拖動平移畫面（v345）
- 捏合縮放時同時用兩指中心點移動鏡頭（cam.free），上下左右都能拖；原本只處理縮放。

## 2026-10-29 四樓地圖範圍與留白對齊五樓（v346）
- 四樓桌機版畫布原本靠左、上方與左側有大片空白；改成內容（x 20～2400、y 150 起）置中，上下留 130px 給選單，縮放倍率本來就與五樓相同。

## 2026-10-29 四樓地板改透明、右側不再出現橫向捲軸、桌機走路加快（v348）
- floor4.js 地板原本填白色造成「範圍框」；改成透明只留格線，與五樓一致（floor4.js?v=19）。
- 四樓外層 overflow-x 改 clip，不再需要拖橫向捲軸。
- 桌機走路速度 290→380（手機維持 400）；走路時本來就是每幀重畫，幀數受瀏覽器 rAF 限制。

## 2026-10-29 地板格線改畫在整頁背景（兩側不收邊）、窄書櫃碰撞縮小（v349）
- 桌機整頁：格線由 CSS 背景鋪滿整個頁面（setPageGrid，與場景座標對齊），畫布不再畫格線；四、五樓一致。
- 五樓中排兩個窄書櫃的碰撞範圍貼合實際寬度（83／85 → 52／54），通道變寬。

## 2026-10-29 辦公室小樂趣 fun.js＋四樓右側被切掉修正（v350）
- 新增 fun.js：廁所有人用時馬桶出現便便、點人物跳出「沖馬桶」（累計獎勵提示）；投影機點一下開／換頁；會議室桌上隨機遺落筆記本／紙筆；地上偶爾出現驚喜道具（點或走過去撿）。全部只在自己畫面隨機出現，不寫後端；app.js 提供 window.__funApi。
- 四樓右側人物被切掉：上一版把外層 overflow-x 設 clip 反而在 1600px 寬的外框切掉 → 改成不裁外框、只讓 html overflow-x:hidden。

## 2026-10-29 小樂趣改成全員共用＋隨機生成＋Codex 新圖（v353）
- Codex 重畫 assets/office-fun-v1.webp/.json（小便便 22x18、7 種道具、5 種遺落物、5 張投影畫面，黑框像素風）。
- 出現機制：便便（5 分鐘一個時段、每格約 4 成機率）、投影機（6 分鐘時段隨機開／關與隨機畫面，點擊只切開關）、遺落物（12 分鐘）、驚喜道具（8 分鐘）都由「時段＋種子」算出，每個人看到一樣。
- 後端新增 action pixelOfficeFun（先到先得；投影機 j: 開頭可反覆切換）與 pixelOfficeState.funClaims（已處理紀錄，保留 90 分鐘、最多 400 筆）；worker 已部署、新增測試。

## 2026-10-29 投影機改回文字簡報卡、馬桶便便位置微調
- 投影機畫面改回第一版的文字簡報卡（8 種隨機），只做開／關；便便位置調進馬桶水面（fun.js?v=6）。

## 2026-10-29 投影畫面不被牌子遮、內容加到 30 種每次開啟隨機、四樓會議室 H 牌子與投影機位置（app v354）
- fun 圖層深度提高到 200000（在所有房間牌子之上）。
- 投影簡報卡 8→30 種，每次開啟用「開啟時間」當種子換一張，所有人看到一樣。
- 四樓 H：牌子放桌子群中央空白處；投影機右緣與桌子群右側切齊。

## 2026-10-29 驚喜道具 1% 機率回饋 1 點平台幣
- pixelOfficeFun：撿到地上驚喜道具（id 以 d: 開頭、先到先得）且帶登入 token 時，伺服器抽 1/100，中獎寫入 coin_ledger（kind earn、ref fun:道具id、memo 辦公室驚喜道具回饋）；只有平台幣持有人（設計師／企劃專案同仁）能領。worker 已部署、新增測試（213 項全過）。前端中獎時跳提示。

## 2026-10-29 未登入人物四、五樓都會隨機走動（v356）
- ghostTick 不再限五樓、不再固定四分之一的空位：每個空位都可能隨機起身，同時走動上限 max(4, 空位數×14%)，走動範圍 ±560／-320～420、最多逛 4 站、各人速度不同。

## 2026-10-29 投影機開啟不再跳兩次、未登入人物走動範圍加大（app v357／fun v9）
- 跳兩次原因：樂觀更新用本機時間當畫面種子，後端回傳又換成伺服器時間 → 畫面換第二張。改成開啟的人決定畫面編號、一起存進後端（j: 的值 0＝關、1～99＝畫面編號+1），所有人同一張。worker 已部署。
- 未登入人物走動範圍 ±560 → ±950、上 480／下 720。

## 2026-10-29 會議桌接縫白線：每塊桌面多畫 1px 疊進下一塊（app v358／floor4 v24）
- 白線位置正好在桌子素材（左端／中段／右端）的接縫；除最右端外每塊多畫 1px 蓋住。

## 2026-10-29 冰箱開關門同步給所有人、人物顯示名字（app v359／fridge v8）
- 冰箱門：開／關寫進 pixelOfficeFun（id f:樓層:fridge，可反覆寫、0＝關、1＝開；30 秒內才算開著），其他人每秒檢查，開門／關門與開門的人同步。worker 已部署。
- 人物名字：離開座位（走動、站在別處）時，腳下顯示名字膠囊；被選取的人是綠底白字；坐在自己桌位時桌上有名牌不重複。

## 2026-10-29 小遊戲排行榜改用登入帳號、新增遊戲排行榜、名牌只在點選時顯示（app v361）
- 後端：POST /minigames/run 帶登入 token → 主站驗證出帳號本人名字（DatabaseCoordinator.minigameViewer），runs／scores 新增 account 欄位；榜單以帳號為同一人（換裝置也算），沒登入仍用「暱稱#裝置碼」。新增 GET /minigames/top3?range=today|week（每款遊戲前三名）。worker 已部署。
- 前端：board.js 送 token、top3；選單新增「🏆 排行榜」＝每款遊戲前三名的名字與分數（今日／本週，未登入者標示）。
- 人物名字膠囊改成只有點選（操控）的人才顯示，避免擋畫面。

## 2026-10-29 出氣擂台外殼統一為小遊戲系列
- `vent-arena/emc-theme.css` 新增與 `minigames.css` 同名的深藍、淡藍、黃、橘、藍、紅、綠色票及外框／硬陰影變數，讓早期擂台與後續小遊戲有一致的視覺語言。
- `vent-arena/overrides.css` 統一頂部導覽、角色／道具／模式按鈕、HUD 膠囊、成績卡、提示、結算／排行榜與一對一對戰視窗；套用深藍 3px 外框、6–12px 圓角、粗體與按下下沉效果。保留既有排列、定位、流程、角色／武器素材與戰鬥特效，手機維持八欄道具列並讓長名稱折行。
- `vent-arena/dark.css` 改用明確的深色色票，取消整頁及素材反相；`vent-arena/arena.css` 移除原有 dialog backdrop-filter，以純色遮罩維持可讀性。未修改 HTML 或任何 JavaScript，未執行 commit。
- 驗證：`npm test` 共 281 項，261 項通過；20 項失敗逐項確認皆為沙盒禁止監聽本機埠的 `listen EPERM`。`git diff --check` 通過，CSS 括號配對檢查通過，確認無 backdrop-filter 與 JS／HTML 差異。瀏覽器啟動及本機預覽受到環境限制，電腦操作工具亦回報 browser access host unavailable，因此未完成桌機／手機與深色模式的實際截圖驗證。

## 2026-10-29 行事曆「公出」套用成公出狀態
- 原本行事曆同步只會產生「會議」「休假」兩種狀態，標題寫公出／外出的活動因此被當成一般活動（長於 4 小時就被忽略、4 小時內被當會議），人還是顯示下班。
- 新增狀態 out：標題含 公出／外出／外勤／外訪／拜訪／外拍，且是本人建立或標題點名本人才算（避免被 tag 的通知讓全組一起公出）。優先序：休假 > 公出 > 會議；活動結束後自動收回。worker 已部署、新增測試（215 項全過）。

## 2026-10-29 截稿倒數：太快的重複點擊不再讓整局成績被拒絕
- 使用者回報截稿倒數登入後成績只存在本機（結算顯示「成績驗證失敗（too-fast）」）：前端沒有限制兩次作答的最短間隔，雙擊／觸控連發會產生間隔 0 的紀錄，伺服器下限是 0.12 秒（第一題 0.3 秒）→ 整局被拒。現在前端 0.15 秒（第一題 0.35 秒）內的重複輸入直接忽略。

# 開發交接

## 目前需求與畫面

純白背景的像素設計部。六張霧面深藍桌子、螢幕與黑色椅子使用原始高細節透明家具圖集，上下兩排各三張並排接合。椅子、人物、桌子以獨立圖層繪製。座位順序：

| 位置 | 人物 | 設備 |
| --- | --- | --- |
| 左上 | Leona：黑色長髮、時髦 | 白色 iMac |
| 中上 | Amber：黑棕髮、微肉、樸素 | 白色 iMac |
| 右上 | Noise：藍色帽子、短袖 T-shirt、短褲、白襪、灰色布鞋 | iMac + 黑色螢幕 |
| 左下 | 空位，無人物、無名牌 | Mac Studio + 黑色螢幕 |
| 中下 | Anna：棕色長髮、粉色穿搭 | 白色 iMac |
| 右下 | Machi：棕金中分頭、黑色潮流穿搭 | 白色 iMac |

2026-09-18 更新（第 7 版）：
- 圖示換成使用者重新設計的 `assets/icons-v3.png`：768×768、3×3 正方形格子（每格 256×256）。由原圖（1536×1024 透明底）去掉透明度 40 以下的光暈、逐一裁到實際範圍，再等比例置中（四周留 10 px）。`drawSymbol()` 改用正方形格子並開啟高品質平滑縮放，不會再被切到或變形。
- 人物旁的心情圖示、座位上的狀態圖示不再有外框；狀態文字改用白色描邊。
- 方向鍵移到右側面板「人物名稱」右邊（`.identity` 內），手機版遊戲畫面與方向鍵可同時看到。按鈕的 `setPointerCapture` 失敗不影響移動。
- 對話泡泡、照片卡改用細邊框＋圓角＋柔和陰影（`softPanel()`，取代粗像素切角框 `pixelPanel()`）；泡泡與尾巴同一個外框、字體改系統無襯線字。
- 點選人物時頭上顯示等級與稱號（`levelTag()`，例：Lv.33 設計大師），泡泡會自動往上讓位。

離席與搖桿（第 10 版）：下班、廁所、出國、公出時不畫椅子與電腦，桌子改用 `furnitureRects[4]` 的空桌（`assets/desk-empty.png` 由 iMac 桌去掉電腦、鍵盤、滑鼠與陰影做成，已併入 `furniture-packed.webp` 的 (0,987)），以 `grayscale(1) brightness(1.9) contrast(.85)` 呈現中灰色；狀態圖示畫在原本電腦的位置（中心 y = 座位 y − 24），大小 104、與桌上 iMac 相當，文字以白色小膠囊放在圖示上方。右側面板的上下左右鍵改成搖桿（`#joystick`）：按住拖曳換算 8 個方向寫入 `keys`，中心 28% 為不動區，放開即停；`touch-action:none`、禁止選取與長按選單，避免手機誤觸其他手勢。

多人同步（第 9 版）：心情、對話、離席狀態、位置與照片存在主系統 Cloudflare Worker（`machi-design-api`）的 Durable Object 資料表 `pixel_office_people`，不進案件資料庫、不觸發網站發布。不用登入、任何人都能改（使用者決定）。前端 `pollSync()` 每 3 秒（分頁在背景時 15 秒）呼叫 `pixelOfficeState`（帶 `since` 版本，沒變動只回 unchanged）；修改時 `pushChange()` 呼叫 `pixelOfficeUpdate`；走路位置最多每 350 ms 送一次（`queuePosition()`），自己剛移動的人物 1.5 秒內不被遠端舊位置拉回；照片只有 `photoVersion` 變了才用 `pixelOfficePhoto` 下載。連不上時照舊存在 localStorage，右上角顯示「離線中」。後端允許的來源（`ALLOWED_ORIGINS`）包含 GitHub Pages 與本機 `localhost:8787`。

進站加速（第 8 版）：遊戲實際讀取的是三張 WebP——`sprites-packed.webp`（420×946，5 列 × 3 欄、每欄 140 寬，列起點 0、192、381、572、757）、`furniture-packed.webp`（837×987，四種家具重新排列，座標見 `furnitureRects`；桌子分段位置改為相對 `sy` 的偏移）、`icons-v3.webp`（576×576，每格 192）。品質 94 的 WebP，放大比對與原圖幾乎無差異；三張合計約 340 KB（原本 PNG 約 2.5 MB）。進站只等人物與家具，圖示在背景載入（載入前用內建像素圖）；`index.html` 以 `<link rel="preload">` 提早下載。原始 PNG（sprites-noise.png、furniture.png、icons-v3.png）保留作為重新產生 WebP 的來源，網頁不會下載。

最新修正：桌中心 X = 548、768、988；角色腳底 Y = 355、695。桌上保留姓名牌，移除頭頂重複姓名；泡泡使用像素圓角框，心情及狀態讀取 `icons-refined.png` 的高細節透明圖示，照片使用可點擊的像素遊戲卡。下班、廁所、出國、公出會隱藏人物、灰階座位並顯示精緻狀態牌。

## 核心結構

- 世界座標 1536×1024；Canvas 像素密度依顯示尺寸與 devicePixelRatio 調整。
- `starts` 控制人物初始位置；`stations` 定義六個桌位和設備類型。
- `walls` 從桌位計算碰撞範圍；桌子重排時應同步確認角色可走出座位。
- `render` 按深度排序椅子、設備、人物與桌子；`drawOverlay` 顯示心情、對話與照片，`drawStatusMarker` 顯示離席狀態。
- `sprite` 使用人物圖的正面、側面、背面；向左使用右側面鏡像。走路使用轉向與上下浮動，沒有完整逐格走路動畫。
- `syncLevels()` 從 GitHub Pages 的 `data/database_archive.json` 讀取歷史完成案件，用 `scoreRows()` 累計分數，再用 `levelFromScore()` 換算 EXP、等級與進度。只讀取，不會寫回案件資料。
- `bubble` 處理手動換行、自動折行、文字置中與泡泡邊界。
- 檔案照片會縮至最長邊 1200 px，以 JPEG 儲存。大於 8 MB 會拒絕。
- localStorage 主資料鍵：`kaiyao-office-v1`；配置版本鍵：`kaiyao-office-layout`，目前值 `5`。版本不符只重設位置，仍讀取照片、訊息、心情與離席狀態。
- 網頁在支援 `document.modelContext` 時註冊 `set_character_status`，不支援時遊戲仍正常運作。
- `?embed=1` 是主系統用的精簡模式：`body.embed` 隱藏頁首、編輯工具、名單與說明，但保留 Canvas 的人物點選與人物資料卡。`embedMode` 只擋鍵盤移動，主系統 iframe 必須接受 pointer event，才能讓使用者直接點人物。主系統維持原本左右欄與 3:2 iframe 外框，並以較高的那側同步兩張卡片高度；Canvas 在外框內以 CSS 放大 137% 並裁切，手機版放大到 167%，垂直位移特別保留下排姓名。資料卡在各螢幕寬度都不得超過 iframe 欄位的三分之一。若調整 Canvas 比例，要一起檢查命中座標與資料卡定位。

## 新增人物

人物的尺寸、比例、畫風、服裝與配件規則見 `docs/CHARACTER-SPEC.md`（含生成提示詞與驗收清單）。實際套用用 `dist/tools/character-fitter.html`：拖入三視圖 → 自動去背（邊緣洪水填充）、清掉表格線與文字（小於最大連通區 8% 的碎塊）、切成三格、縮放到指定高度並置中貼底 → 檢查腳底／置中／寬度／眼睛高度 → 下載合併好的 `sprites-packed.webp` 與要修改的程式碼片段（`names`／`descriptions`／`rowTops`／`rowHeights`／`starts`／`stations`／`fallbackScores`，以及 Worker 的 `PIXEL_OFFICE_NAMES`）。

## 素材座標

`sprites-noise.png` 是目前遊戲讀取的 1536×1024、5×3 人物圖集，列順序 Leona、Amber、Noise、Anna、Machi，欄為正面、右側面、背面。`sprites.png` 保留原始 Noise 造型供回溯。

- 列起點：49、249、444、640、832。
- 列高：192、189、191、185、189。
- 欄中心：435、830、1258；取樣寬 140。

`furniture.png` 是 1254×1254 的透明高細節家具圖集，目前由 `drawChair` 與 `drawDesk` 分段取樣，以便人物正確穿插在椅子與桌面之間。`icons-v3.png` 是 768×768、3×3 的透明圖示圖集（正方形格子，順序：太陽、爆炸、水滴、愛心、在座、下班、廁所、出國、公出）；2026-09-21 只替換下班與公出兩格，其餘七格維持原樣。`overtime-filter.png` 是 1086×362 的三方向透明圖集（正面、側面、背面），用於加班的黑眼圈與左右鬼火。`icons-refined.png` 為舊版，已不使用。其他圖片保留作參考。

## 自動出勤狀態：開機＝在座、七點後＝加班、午休閒置＝用餐、關機＝下班、週末假日＝下班（2026-09-21）

設計師電腦上的 NAS 爬蟲（`scripts/nas_design_image_watcher.mjs`，排程每分鐘一次）會在每次執行的最一開始回報「這台電腦開著」（`pixelOfficeHeartbeat`，用爬蟲既有的服務金鑰 `NAS_WATCHER_API_KEY` 驗證，跟 NAS 有沒有連上無關）。後端據此自動決定狀態：

心跳除了「電腦開著」，還會帶一個 `idleSeconds`（鍵盤滑鼠閒置了幾秒，`currentIdleSeconds()`；macOS 讀 `ioreg` 的 `HIDIdleTime`、Windows 讀 `GetLastInputInfo`，查不到就整個欄位不送）。台北時間開著電腦時該顯示哪個狀態，全部集中在 `pixelOfficeWorkStatus(nowMs, idleSeconds)`：

| 什麼時候 | 狀態 |
| --- | --- |
| 週六日、國定假日（含補假）——就算電腦開著 | 下班 |
| 平日閒置滿 5 分鐘（人離開座位），12:00～14:00 | 用餐 |
| 平日閒置滿 5 分鐘，其他時段（含晚上的加班時段） | 廁所 |
| 平日 19:00～隔天 06:00，人在電腦前 | 加班 |
| 其餘平日時間 | 在座 |

閒置判斷排在時間判斷前面：人不在電腦前就不算還在工作，所以晚上離開座位五分鐘會從加班變成廁所，回來打字又變回加班。

- 心跳進來、且原本超過 5 分鐘沒有心跳（剛開機／剛醒來，或第一次）：不論原本是什麼狀態，一律改成上表算出來的狀態。
- 電腦持續開著：沒被手動指定過的「在座／加班／用餐／廁所／下班」會隨時間與閒置互相切換（離開座位五分鐘變廁所或用餐、回來打字又變回在座或加班）。
- 使用者在遊戲裡手動點的狀態（`statusSource:'manual'`）維持到電腦下次關機，**或是時間規則換到下一個時段為止**（白天↔晚上↔假日，記在 `statusBaseline`）。這樣昨晚手動點的加班不會隔天中午還掛著。用餐／廁所↔在座屬於同一個時段內的來回，不會讓手動失效。出國／公出電腦判斷不出來，手動指定了就維持到關機為止，完全不受時段影響。
- 超過 5 分鐘沒有心跳（關機或睡眠）：在每次有人讀取狀態（`pixelOfficeState`）時檢查，「在座／加班／用餐／廁所」改成「下班」。「出國／公出」不動；使用者在電腦離線之後才手動指定的狀態也尊重。把電腦關機或讓它睡著一律是「下班」而不是「用餐／廁所」——用餐與廁所的定義都是電腦開著、人不在。
- 從來沒有心跳的人（沒安裝爬蟲、或共用電腦）完全不會被自動改狀態，維持原本手動。
- **首次同步（`syncSeeded`）刻意不推送出勤狀態**：後端把任何送上去的狀態都當成「使用者手動指定」而暫停自動判斷，只要有人的瀏覽器留著舊的 `localStorage`，一開遊戲就會把那個人標成手動、之後自動狀態全部失效（實際發生過，查出來時五個人裡有四個是 `manual`）。心情、對話、位置、照片照樣補。

**國定假日每年要更新一次**：`PIXEL_OFFICE_HOLIDAYS`（`worker/src/database-coordinator.ts`）與 `TAIWAN_HOLIDAYS`（`dist/app.js`）各有一份，兩邊都要改。行政院公布新年度行事曆之後，從 `https://cdn.jsdelivr.net/gh/ruyut/TaiwanCalendar/data/<西元年>.json` 取 `isHoliday` 為 true 且 `description` 不是空字串的日期即可。沒收錄到的年份不會出錯，只是那一年的國定假日要自己點「下班」，週末照樣自動判斷。

「加班」（`overtime`，狀態按鈕圖示 `moon`）跟其他離席狀態不同：人還坐在位子上工作，所以人物、椅子、電腦照常繪製、也能用方向鍵走動。場景中不畫月亮，只把「加班中」標籤置中放在桌面中央（`drawOvertimeBadge`）；人物上另疊上三方向的黑眼圈與鬼火濾鏡（`drawOvertimeFilter`）。黑眼圈與鬼火分層繪製：黑眼圈貼在**黑色眼珠**正下方（`EYE_PUPIL_BOTTOM` 逐個角色記下眼珠下緣——Machi 的眼睛畫得高、Noise 戴帽子所以低，共用一個值就會有人對不準），左右用同一組尺寸所以一定對稱；兩團鬼火外擴並上移到頭像左右，不會被桌上螢幕遮住。鬼火的來源要從圖集的 y156 取，不能從黑眼圈還沒結束的 y145 取，否則頭頂兩側會多出兩條紫色橫條。濾鏡跟著方向、鏡像、走路浮動與心情旋轉。只要實際狀態是加班，或者台北時間 19:00～隔天 06:00 仍是在座，畫面就自動套用；這個視覺有效狀態不寫回後端。本機可加 `?overtime=1` 強制預覽。判斷是否離席請一律用 `isAway(p)`（只有「在座」與「加班」不算離席），不要再直接比 `p.status!=='present'`。狀態選單中的加班圖示由 `moonIconCanvas()` 用程式繪製；會議與用餐放在後來新增的 `assets/icons-status-v4.webp`（2 格正方形，`extraCells`，裁切與留白規則跟 `icons-v3` 一樣），因為 `icons-v3` 的 3×3 已經排滿。狀態共八個、每列 4 個剛好兩列。「用餐」「會議」跟廁所一樣算離席（`isAway`）：桌面淨空成灰階空桌，桌上顯示圖示。

「會議」（`meeting`）可以自己點，也可以由 Google 行事曆自動帶上（見下一段）。手動點的會議：閒置五分鐘不會被改成廁所，帶著筆電去會議室（電腦關機）也不會被改成下班，回座開機才重新由電腦決定，散會要自己取消。

## 嵌入設計需求系統（?embed=1）（2026-09-21）

設計需求系統左上角的「設計師專長與案件分配」用 iframe 嵌入 `?embed=1`，設計師頭像、限時動態、大海報與分享音樂一併從前台下架。

- **只留場景**：頁首、右側編輯工具、名單、標題列都隱藏，人物資料卡保留。鍵盤移動關閉。
- **版面**：下排座位往上收（`EMBED_ROW_SQUEEZE=0.8`，再小兩排就會疊住）。只改 `viewPeople`／`viewStations` 這兩份「畫面用座標」，同步給大家的 `people`／`stations` 完全沒動。六個座位連同姓名牌由 `fitEmbedView()` 依框的實際尺寸等比縮放、水平垂直置中——框的高度會跟著左右卡片對齊而變，所以不能寫死放大倍率。內容範圍記在 `EMBED_CONTENT`，下緣跟著壓縮比例走。
- **滑過就展開**：滑鼠移到人物上直接展開資料卡，移開收起；滑進卡片不算離開。觸控仍走點選。嵌入模式不顯示關閉鈕。
- **技能膠囊帶入表單**：點了用 `postMessage({type:'pixelOfficeSkill',designer,skill})` 通知外層（`location.origin`，外層也只收同源），外層跑 `applyDesignerSkill()` 帶入設計種類、階段與設計負責人。
- **進站不預載那 3.8 MB**：`ensureLevels()` 第一次真的要看人物資料時才載歷史快照，載完自動重畫卡片；快照本身用 `no-cache`，沒變就走 304。

## 人物資料卡與「預設不選人」（2026-09-21）

進站不再預設選取 Leona：`selected` 起始是 `null`，右側工具面板收起來、改顯示一行提示。點畫面上的人物才會選取，點場景空白處取消。所有讀 `people[selected]` 的函式都要先擋 `selected===null`（`updateMood`／`updateStatus`／`updatePhoto`／`updateLevel`／`updateStateText`／`moving`／`setMood`／`setStatus`）。

選取之後在人物**右側**展開資料卡（`#personCard`，HTML 浮層疊在 canvas 上，不是畫進 canvas）。位置由 `positionPersonCard()` 每一幀更新，所以人物走動時卡片會跟著；右邊放不下就自動翻到左邊，上下夾在場景內。手機（≤700px）改成排在場景下方（`position:relative` 加 `left/top:auto` 蓋掉每幀寫進去的座標），什麼都不遮、內容也不必擠在小框裡捲。

卡片內容與資料來源：

| 欄位 | 來源 |
| --- | --- |
| 等級、職稱、EXP | `syncLevels()` 已經下載的 `database_archive.json`（原本就要下載，不另外抓） |
| 技能、組別 | Worker 的 `pixelOfficeDesigners`（設定表的「技能」欄，逗號分隔） |
| 手上的案件 | 同一份 archive，篩「設計負責人」等於這個人、狀態是未開始／執行中／修改中，每組列前 3 件 |
| 新專案找誰 | `pixelOfficeDesigners` 的 `priority`：同組裡「新專案輪值」最小且啟用的人，跟主系統的 `rotationDesignerForGroup()` 同一套規則 |

`pixelOfficeDesigners` 只回傳名字、組別、技能、輪值、啟用與否這幾個欄位，所以遊戲不必為了技能去下載 1.5 MB 的 `db.json`。archive 裡本來就含未完成的案件（執行中、過稿中、未開始、修改中），所以案件清單也不必另外抓。

桌上的狀態圖示另外有 `DESK_ICON_SCALE`：電源鍵（下班）與公事包（公出）的圖形幾乎填滿整個格子，不透明面積是其他圖示的 1.6 倍，同尺寸畫在桌上會大一圈，所以這兩個縮到 0.8／0.78。面板按鈕有外框當基準、看不出差異，維持原樣。

## 行事曆自動顯示「會議」（2026-09-21）

Worker 每分鐘的排程（`runPixelOfficeCalendarSync`，跟排程寄信同一個 cron）會查五位設計師的 Google 行事曆，正在忙就顯示「會議」，散會就交還給電腦自動判斷。

- **只用 `machi.chen@emctaipei.com` 一個帳號的授權**（`PIXEL_OFFICE_CALENDAR_ACCOUNT`），其他四位不必連接任何東西——Google Workspace 網域內預設看得到彼此的忙碌時段。那個帳號要在系統裡重新連接一次 Gmail，授權畫面才會帶上 `calendar.freebusy`；`gmailStatus` 的 `canReadCalendar` 會告訴前端有沒有這個權限。
- 查的是 **freeBusy**，拿不到標題、地點與與會者，只知道「這段時間忙」，所以不會把會議內容帶進系統。
- **超過四小時的忙碌不算會議**（`PIXEL_OFFICE_CALENDAR_MAX_MEETING_MS`）：freeBusy 分不出會議與整天的特休，不擋的話請假的人會整天掛著「會議中」。
- 只在平日 08:00～22:00 查（`PIXEL_OFFICE_CALENDAR_START_HOUR`／`END_HOUR`），假日直接跳過。
- **手動指定的狀態優先**：行事曆只接管電腦自動判斷出來的在座／加班／用餐／廁所／下班，不會蓋掉使用者自己點的公出、出國或會議。它也只收回自己設的（`statusSource:'calendar'`）。
- 任何一步失敗（沒授權、專案沒啟用 Calendar API、某個人的行事曆看不到）都只是這一輪不動任何人的狀態，回傳裡的 `unreadable` 會列出看不到的人。
- 心跳那邊有一個對應的例外：`statusSource:'calendar'` 的會議不會被「剛開機」或閒置判斷蓋掉，否則開會中打開筆電會在「在座」與「會議」之間每分鐘來回跳。

**排錯**：`pixelOfficeCalendarStatus`（帶爬蟲的服務金鑰）會回傳這個帳號連了沒、有沒有行事曆權限、五個人的信箱對應，以及最後一次同步的結果：

```bash
curl -s -X POST https://machi-design-api.machi-chen.workers.dev/api \
  -H 'Content-Type: text/plain;charset=UTF-8' \
  -d '{"action":"pixelOfficeCalendarStatus","serviceKey":"<NAS_WATCHER_API_KEY>"}'
```

`last` 的常見值：`{"reason":"no-token"}` 是那個帳號還沒連 Gmail；`{"reason":"freebusy-failed","status":403,"message":"Request had insufficient authentication scopes."}` 是連了但授權還沒帶行事曆權限（重新連接一次即可）；`message` 出現 `has not been used in project` 則是 Google Cloud 專案還沒啟用 Calendar API。`unreadable` 列出看得到名字但讀不到行事曆的人。

每台電腦要在 `scripts/nas_design_image_watcher.local.json`（不進 git）寫 `{"designerName":"Noise"}` 才會回報；設計師電腦由安裝器在安裝時跳出選單記下，主機這台已手動設為 Machi。

## 驗證與已知限制

目前已做 JavaScript 語法、角色起點/碰撞、圖層深度、移動、畫布像素密度、泡泡文字置中、照片上傳、離席切換、1280 px 桌面版及 390 px 手機版實際瀏覽器測試，且無主控台錯誤。後續調整時仍需檢查：桌子接縫/尺寸、人物與提示物避讓、最長對話、手機排版、照片上傳與重開頁面存檔。

靜態前端，無帳戶識別、多人同步、雲端資料庫或伺服器相片上傳。localStorage 容量受瀏覽器限制。真正多人版需另行設計登入、資料存放、權限、同步；不要將「可分享網站連結」當成多人同步。

## 原網站資訊（僅供日後銜接）

Site ID：`appgprj_6aaca751308881918d954eafdffcbb43`。

原始託管設定可在 Git bundle 歷史的 `.openai/hosting.json` 找到。不要將新本地專案自動發布回原網站；只有使用者要求部署且具備權限時才操作。完整可執行原始碼已在 dist，不依赖原平台才能開發。

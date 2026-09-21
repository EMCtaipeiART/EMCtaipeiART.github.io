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
| 平日 19:00～隔天 06:00 | 加班 |
| 平日 12:00～14:00，且閒置滿 5 分鐘 | 用餐 |
| 其餘平日時間 | 在座 |

- 心跳進來、且原本超過 5 分鐘沒有心跳（剛開機／剛醒來，或第一次）：不論原本是什麼狀態，一律改成上表算出來的狀態。
- 電腦持續開著：沒被手動指定過的「在座／加班／用餐／下班」會隨時間互相切換（例如午休離開座位變用餐、回來打字又變回在座）。
- 使用者在遊戲裡手動點的狀態（`statusSource:'manual'`）維持到電腦下次關機，**或是時間規則換到下一個時段為止**（白天↔晚上↔假日，記在 `statusBaseline`）。這樣昨晚手動點的加班不會隔天中午還掛著。用餐↔在座屬於同一個時段內的來回，不會讓手動失效；廁所／出國／公出這類「人離開座位」的手動狀態也完全不受時段影響。
- 超過 5 分鐘沒有心跳（關機或睡眠）：在每次有人讀取狀態（`pixelOfficeState`）時檢查，「在座／加班／用餐／廁所」改成「下班」。「出國／公出」不動；使用者在電腦離線之後才手動指定的狀態也尊重。午休時間把電腦關機或讓它睡著也是「下班」而不是「用餐」——用餐的定義就是電腦開著、人不在。
- 從來沒有心跳的人（沒安裝爬蟲、或共用電腦）完全不會被自動改狀態，維持原本手動。

**國定假日每年要更新一次**：`PIXEL_OFFICE_HOLIDAYS`（`worker/src/database-coordinator.ts`）與 `TAIWAN_HOLIDAYS`（`dist/app.js`）各有一份，兩邊都要改。行政院公布新年度行事曆之後，從 `https://cdn.jsdelivr.net/gh/ruyut/TaiwanCalendar/data/<西元年>.json` 取 `isHoliday` 為 true 且 `description` 不是空字串的日期即可。沒收錄到的年份不會出錯，只是那一年的國定假日要自己點「下班」，週末照樣自動判斷。

「加班」（`overtime`，狀態按鈕圖示 `moon`）跟其他離席狀態不同：人還坐在位子上工作，所以人物、椅子、電腦照常繪製、也能用方向鍵走動。場景中不畫月亮，只把「加班中」標籤置中放在桌面中央（`drawOvertimeBadge`）；人物上另疊上三方向的黑眼圈與鬼火濾鏡（`drawOvertimeFilter`）。黑眼圈與鬼火分層繪製：黑眼圈貼在**黑色眼珠**正下方（`EYE_PUPIL_BOTTOM` 逐個角色記下眼珠下緣——Machi 的眼睛畫得高、Noise 戴帽子所以低，共用一個值就會有人對不準），左右用同一組尺寸所以一定對稱；兩團鬼火外擴並上移到頭像左右，不會被桌上螢幕遮住。鬼火的來源要從圖集的 y156 取，不能從黑眼圈還沒結束的 y145 取，否則頭頂兩側會多出兩條紫色橫條。濾鏡跟著方向、鏡像、走路浮動與心情旋轉。只要實際狀態是加班，或者台北時間 19:00～隔天 06:00 仍是在座，畫面就自動套用；這個視覺有效狀態不寫回後端。本機可加 `?overtime=1` 強制預覽。判斷是否離席請一律用 `isAway(p)`（只有「在座」與「加班」不算離席），不要再直接比 `p.status!=='present'`。狀態選單中的加班圖示由 `moonIconCanvas()`、用餐圖示由 `bowlIconCanvas()` 用程式繪製（`icons-v3` 的 3×3 已經排滿）；狀態按鈕每列 3 個，第七顆（出國）之後最後一列只剩一顆時用 CSS 移到中間欄。「用餐」跟廁所一樣算離席（`isAway`）：桌面淨空成灰階空桌，桌上顯示碗。

每台電腦要在 `scripts/nas_design_image_watcher.local.json`（不進 git）寫 `{"designerName":"Noise"}` 才會回報；設計師電腦由安裝器在安裝時跳出選單記下，主機這台已手動設為 Machi。

## 驗證與已知限制

目前已做 JavaScript 語法、角色起點/碰撞、圖層深度、移動、畫布像素密度、泡泡文字置中、照片上傳、離席切換、1280 px 桌面版及 390 px 手機版實際瀏覽器測試，且無主控台錯誤。後續調整時仍需檢查：桌子接縫/尺寸、人物與提示物避讓、最長對話、手機排版、照片上傳與重開頁面存檔。

靜態前端，無帳戶識別、多人同步、雲端資料庫或伺服器相片上傳。localStorage 容量受瀏覽器限制。真正多人版需另行設計登入、資料存放、權限、同步；不要將「可分享網站連結」當成多人同步。

## 原網站資訊（僅供日後銜接）

Site ID：`appgprj_6aaca751308881918d954eafdffcbb43`。

原始託管設定可在 Git bundle 歷史的 `.openai/hosting.json` 找到。不要將新本地專案自動發布回原網站；只有使用者要求部署且具備權限時才操作。完整可執行原始碼已在 dist，不依赖原平台才能開發。

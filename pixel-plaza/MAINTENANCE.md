# 3D 辦公室｜維護手冊（改程式前先看）

> 介面與視覺規範請看 [`UI-SPEC.md`](UI-SPEC.md)；這份講**結構、座標、資料、後端欄位、部署、排錯**。
> 最後更新：2026-11-01。

## 1. 檔案

| 位置 | 內容 |
| --- | --- |
| `pixel-plaza/index.html` | 整個 3D 版（HTML＋CSS＋一支 `<script type="module">`，three.js 從 `../character-studio/vendor/` 載入）。**所有功能都在這一個檔案**，改完要保持 `node --check` 通過 |
| `pixel-plaza/assets/` | 2D 版移過來的圖：`icons-v3.webp`、`icons-status-v4.webp`、`office-fun-v1/v2.webp/json`、`props2/elevator.png` |
| `pixel-plaza/snacks/` | 茶水檯八款零食（Codex 生成的像素圖，256×256 透明底） |
| `pixel-plaza/fridge/office-foods-v1.webp` | 冰箱食物圖集（28px 一格，順序見 `FOOD_IDX`） |
| `pixel-plaza/sprites-hd/`、`sprites/` | 人物 12 面向圖集（`<名字>.png`，240／60px 一格） |
| `pixel-plaza/ai-views/`、`bake.html`、`bake.mjs` | 人物圖集的來源與烘焙（**不上線**，線上只放 sprites） |
| 雲端人物圖集 | **角色工坊**（服裝生成器網站 `emc-ai-stage-classifier`，原始碼在獨立 repo）發佈的 12 視角圖集存在它的 KV；`index.html` 啟動時讀 `…/api/public/characters`（`{characters:{名字:版本}}`），有的人改用 `…/characters/<名字>/atlas(-hd).png?v=版本`，沒有或載入失敗就退回本機 `sprites*/`。開發時 `localStorage.noCloudChars='1'` 可關掉雲端 |
| `archive/EMC-ART-Pixel-Office-2D/` | **封存的 2D 版**（不要刪：Worker 的小遊戲驗證、網站首頁隱藏的頭像橋接、相關測試還在用） |
| `worker/src/database-coordinator.ts` | 後端 Durable Object；像素辦公室相關動作在 `pixelOffice*` |

本機預覽：`node serve.mjs`（任何靜態伺服器都行，根目錄＝repo 根），開 `http://localhost:4190/pixel-plaza/index.html?as=Machi`。`?as=名字` **只在 localhost 有效**；沒帶就是訪客。

## 2. 座標與單位

- 版面圖 px → 世界單位：`× U`（`U = 0.03`）。人物高 `WORLD_H = 2.04`。碰撞用世界單位。
- 五樓：x 0–1201 px、z 0–1526 px。四樓：整層加 `FX4 = 3600` px 的 x 偏移；本機座標 x∈[-100, 1430]、z∈[-100, 1700]。樓層判斷 `floorOf(c)`（`x > (FX4-100)*U` 就是四樓）。
- 四樓版面取自 2D 版 `floor4.js`，座標 ×0.5；所有四樓幾何寫在 `const F4 = {...}`，玻璃牆由 `glassWalls()` 寫進 `WALLS`，家具在 `buildFloor4()`。
- **五樓分區位移**：為了拓寬走道，`index.html` 把五樓北邊（z < 310 px：廁所、會議室 A、電梯）上移 67px、南邊（z > 1000 px：會議室 B/C/D、茶水間）下移 33px。**不要直接改這些區域建模用的原始座標去「搬位置」**——原始座標照舊（`buildOffice` 裡的數字），`reflow5F()` 在建好後統一位移；資料表（`WALLS`、`LABELS`、`ROOMS`、`PROJ_POS`、`NOTE_TABLES`）用 `zN()` 在定義時位移；程式裡直接寫死的位置（`elevSpot`、`inSlideZone`、`isMeetSeat`、`roomOf`、邊界）已手動更新。五樓可走範圍現在是 z∈[-100, 1560] px。
- 座位：`SEATS`（五樓：`[桌組, 排, 欄, 'top'|'bottom']`）、`SEATS4`（四樓：`[桌子群 0–4, 座位 1–8]`，1–4 上排、5–8 下排）。**改座位只改這兩張表**，四樓的人在 `SEATS` 裡要放一筆 `['f4',0,0,'top'|'bottom']` 佔位。

## 3. 資料與後端（Worker：`https://machi-design-api.machi-chen.workers.dev/api`，POST `text/plain` JSON）

| 用途 | 動作 / 欄位 |
| --- | --- |
| 讀全部狀態 | `pixelOfficeState {since}` → `people[]`（status、mood、message、music、meetingRoom、statusSource、floor4At/f4x/f4y/f4dir…）、`hours{force}`、`stories`、`funClaims` |
| 改自己 | `pixelOfficeUpdate {name, patch}`：`status`（含 `'auto'`＝交還電腦）、`mood`、`message`、`music`、`floor/fx/fy/fdir`（位置，見下） |
| 共用「已處理」紀錄 | `pixelOfficeFun {id, v, token}`；id 格式 `^[a-z]:[A-Za-z0-9:._-]{1,70}$`：`d:`掉落物、`n:`遺落物、`p:`便便、`j:`投影機（v=0 關、1–99 開且畫面編號） |
| **個人進度（雲端存檔）** | `pixelOfficeProgress {name, op:'get'|'save', progress:{dex:{d:[],n:[]}, stat:{flush,found,notes}}}`；存在 DO 的 `pixel_office_settings` key `progress:<名字>`，**圖鑑取聯集、次數取較大值**，不寫 GitHub；另外存 `last:{x,z,at}`（最後停留位置，px，取較新的），前端只採用 24 小時內的（`LAST_TTL`）。**這個動作是新加的，Worker 要部署才有效**（沒部署時前端會提示「雲端存檔尚未啟用」並暫存本機） |
| 管理者 | `pixelOfficeAllWork {mode}`、`getPixelHours`／`savePixelHours`、`pixelOfficePunish`（帶 `editorToken`／`token`） |
| 冰箱 | `GET /minigames/fridge?floor=5|4&since=` 、`POST /minigames/fridge {action:'open'|'take'|'box', slot, nick, floor}`（和 2D 版同一份庫存） |
| 限時動態 | `pixelOfficeStoryAdd／Comment／React／View／Remove` |
| 即時推送 | WebSocket `wss://…/ws`：後端每次寫入送 `{type:'pixel'}`，前端收到就重讀（`pollNow()`）；每 25 秒送 `ping` |

- **位置同步協定**（沿用 2D 版的四樓欄位，不用改後端）：自己走動時 `pixelOfficeUpdate {floor:4, fx, fy, fdir}`。`fx < 3000`＝五樓（`fx=x px`、`fy=z px`）；`fx ≥ 3000`＝四樓（`fx = 3000 + 本機x + 100`、`fy = z + 100`）。後端記成 `floor4At`（最後回報時間）、`f4x`、`f4y`、`f4dir`。其他人看到 `floor4At` 在 3 分鐘內就依這個位置擺人，過期就回到依狀態擺放。**人坐在自己座位上不回報**（回報一次 `{floor:5}` 清除），避免舊位置殘留。
- 後端只放行 `https://emc-art.com`、`https://emctaipeiart.github.io`、`localhost:8787`（`ALLOWED_ORIGINS`）。別的網址（例如 4190）寫入會失敗，**測試寫入請用模擬後端，不要打真實後端**。
- 全員上班／下班（`hours.force`）：`'off'`＝全部顯示下班（**已進辦公室的人除外**），`'work'`＝下班的顯示在座，`''`＝依時段。

## 4. 程式結構（`index.html` 內，大致由上到下）

1. CSS（`:root` 色票、`.hp-*` HUD、`.cp-*` 角色頁面、`.cui-*` 頭上資訊、`#swheel` 輪盤、`#elevFx`、`#fridgeP`、`.sv-*` 動態檢視器、手機 `@media (max-width:640px)`）。
2. 常數與版面表：`PROPS`、`TABLES`、`WALLS`、`LABELS`、`F4`、`ROOMS`、`SEATS`、`SEATS4`、`STATUS`、`MOOD`、`AWAY`。
3. 場景：地板、`blocked()`／`rects`（碰撞）、`buildOffice()`（家具、椅子、廁所、冰箱、茶水間、`buildFloor4()`，**最後才 `startGameplay()`**）。
4. 趣味系統：`dropsNow/notesNow/poopsNow`、`syncFun`、`collect*`、投影機（`projectorRig`、`projState`、`toggleProjector`）、`fnClaim/applyFunClaims`。
5. 角色：`addChar`、`applyStatus`、`sitDown/standUp`、`remoteFromState/remoteStep`（別人的位置）、`pushPosition`（自己的位置）、`stationFx`（座位現場）。
6. 互動：`pointerdown → onPick`、`wheelOpen`（狀態輪盤）、`updatePlate`（名牌）、`findPath`（A\*）、`elevInteract/elevGo/elevCover`、`fridge*`。
7. 角色頁面：`renderCharPage`、`renderAdmin`、`setOwn*`、音樂（`musicInfo`…）、限時動態（`openStory`…）、`progLoad/progSave`（雲端進度）。
8. HUD：按鈕圖示 `SVG_ICONS`／`svgIcon()`、`startGame()`（綁帳號）、`updateHud`。
9. 主迴圈 `tick()`：移動、遠端人物、攝影機、`updateTags/Fridge/Elev`、`pushPosition`。

## 5. 改東西的做法（避免錯亂）

- **一次只改一類東西**，改完先 `node --check`（把 `<script type="module">` 內容存成 .mjs 檢查），再用 puppeteer 截圖看。
- **新增家具**：`pbox`/`table3d`/`chair3d`/`officeChair3d` 建模＋ **登記 `rects` 碰撞** ＋ 黑色外框；樓層加在 `buildOffice()`（五樓）或 `buildFloor4()`（四樓）。通道 ≥ 1.2 單位，不然會卡住（A\* 也走不過）。
- **新增隨機物件**：一定用 `rng(id)`＋時段；**不可依賴載入順序**（碰撞必須在場景蓋完才算）；寫入共用紀錄用 `fnClaim`。
- **新增按鈕**：在 `SVG_ICONS` 加一個 24×24 單線條圖示（簡單、不塞滿），HTML 寫 `<i data-px="名稱"></i>`，class 選 `pk-*`（或新增一個 `--ac` 強調色）；手機要看過。
- **新增要跨裝置保存的資料**：不要只放 `localStorage`；放後端（見 `pixelOfficeProgress` 的做法：取聯集／取較大值，才不會被舊裝置覆蓋）。
- **改座位**：只動 `SEATS`／`SEATS4`；舊分頁會殘留舊座位位置（已改成坐在自己座位不回報；另外頁面會自動偵測新版重新載入）。
- 不要把 `EMC-ART-Pixel-Office/` 這個舊路徑寫進新程式（已封存到 `archive/EMC-ART-Pixel-Office-2D/`）。

## 6. 部署

1. 在工作分支（目前 `codex/character-studio-backup`）改好、commit、push。
2. **上線只放需要的檔案到 `main`**（不要整個分支合併，分支和 main 差很多）：`pixel-plaza/`（不含 `ai-views/`、`*.mjs`）、`character-studio/vendor/`。做法：從 `origin/main` 開一個暫存 worktree，把檔案複製過去，commit，`git push origin HEAD:main`（pre-push 會跑瀏覽器煙霧測試，worktree 需要 `node_modules` 的 junction）。
3. GitHub Pages 由 `.github/workflows/update-database-archive.yml` 發布，**路徑過濾包含 `pixel-plaza/**`、`character-studio/vendor/**`、`archive/**`**；新增別的資料夾要一起加進去。
4. 發布後約 1–3 分鐘生效（Pages 快取最長 10 分鐘），開著的舊頁面約 1 分鐘內自動重新載入。
5. **Worker（後端）要另外部署**（`worker/`，`wrangler deploy`，需要 Cloudflare 權限）：新增的 `pixelOfficeProgress`（雲端存檔）必須部署才有效。Worker 的小遊戲檔案已改指向 `archive/EMC-ART-Pixel-Office-2D/`。

## 7. 常見問題

| 現象 | 原因／處理 |
| --- | --- |
| 有人一直被拉回舊座位／舊位置 | 有人開著舊版分頁在回報位置 → 請他重新整理（新版會自動重載） |
| 道具、投影機各人看到不同 | 隨機在場景蓋完前就算了（`startGameplay` 要在 `buildOffice` 最後）；或種子／時段常數被改 |
| 圖鑑、等級換電腦不見 | `pixelOfficeProgress` 還沒部署到 Worker，或帳號沒綁到人物（訪客不存） |
| 寫入失敗 `Failed to fetch` | 網址不在 `ALLOWED_ORIGINS`（例如本機 4190）；請用 `localhost:8787` 或正式網址 |
| 畫面太亮／太暗、陰影怪 | 看 `index.html` 的 `HemisphereLight`、`DirectionalLight`（`sun`）、`scene.environmentIntensity` 三個亮度；`?flat=1` 可關掉材質與陰影比對 |
| 人物卡牆 | 先看碰撞矩形有沒有登記、通道寬度；`unstick` 會把卡進去的人推出來；A\* 走不通會直接走直線 |
| 狀態一直是下班 | 週末／下班時段後端自動判斷成下班；進入辦公室會自動改在座。管理者的「全員下班」開著時，沒進來的人仍顯示下班 |
| 手機版面重疊 | 看 `@media (max-width:640px)` 區塊（玩家卡、時鐘、按鈕） |

## 8. 還沒做／已知限制

- 四樓固定座位只有 2D 版指定的四位；其他同事不會坐在四樓桌子群。
- 位置同步靠後端欄位，延遲約 0.3–0.5 秒；要更即時需要新增 WebSocket 轉發（要改 Worker）。
- 雲端存檔、位置同步在真實後端的行為，開發時只用模擬後端測過。

## 9. 人物圖集來源（2026-11-02 起）

- 圖集規格不變：12 格橫排（每 30°；0 正面、90 朝右側面、180 背面、270 為 90 的鏡像），`sprites/` 每格 60px、`sprites-hd/` 每格 240px，人物高 224（HD）、腳底離格底 6。
- 新角色走「角色工坊」：照片＋提示詞 → AI 三視圖 → 自動對位（使用者確認）→ AI 補 8 個角度（30/60/120/150/210/240/300/330）→ 轉盤檢查 → 瀏覽器烘焙圖集 → 發佈到雲端。帽子、眼鏡已下架（直接畫進角色，不再單獨做配件）。
- 目前只有 `NAMES` 裡的 12 人會出現在 3D 辦公室；雲端圖集可覆蓋這 12 人的外觀。新增人物還需要座位（`SEATS`）與人物清單。

## 10. 額外人物與指定座位（2026-11-02）

- `…/api/public/characters` 回傳 `{characters:{名字:版本}, seats:{名字:座位編號}}`。名字不在 `NAMES` 的就是「額外人物」：`index.html` 的 `bootChars` 會替他們呼叫 `addChar`，並用 `cloudSeatFor` 把座位寫進 `SEATS`／`SEATS4`；沒有座位的在辦公室自由走動（`applyStatus` 會幫沒有 `home` 的人開 `wander`）。
- 額外人物沒有後端狀態：上下班用 `syncExtraStatus`（時間規則＋全員上班／下班）；不能登入操控。
- 座位編號 `S:x:z:t|b`＝椅子的版面 px（四樓含 3600 偏移）；`t` 坐桌後面向鏡頭、`b` 坐桌前背對鏡頭。可選座位只有辦公桌的椅子（五樓 43 個含左側新桌子群，四樓 56 個含右側兩間辦公室），會議室、茶水間、長桌、廁所不算。**清單在服裝生成器 repo 的 `lib/seat-layout.ts`（量自執行時的 `__plaza.seats`），改了辦公室家具或座位要重新量並兩邊一起改；固定 12 人的座位也在那裡（`FIXED_SEATS`）。** 3D 辦公室收到 `S:` 座位就把人放到那個座標、`sitDown` 坐最近的椅子。
- 本機測試：`?charApi=http://localhost:<port>/characters` 只在 localhost 有效，可指到假的雲端清單。

- 自由走動（沒選座位）的額外人物：`wanderStep` 只在辦公桌區走動（`WALK_AREA`：五樓 x6–1195／z300–1040；四樓本地 x-80–1400／z380–1540，不取點在會議室 H、F/G），用 `findPath` 走路；每 40–120 秒走到電梯、隱藏 3–7 秒後出現在另一層。同一人同一時間只在一層，每個瀏覽器各自隨機、不同步。

## 11. 辦公室流浪貓「橘子」（2026-11-03）

- **只住五樓**，一隻、全員共養。程式在 `index.html` 的「辦公室流浪貓」區塊（`catInit/catPlan/catAt/updateCat/catAct/catCare`，緊接在 `tick()` 之前）；`tick()` 呼叫 `updateCat(dt)`，`startGameplay` 後的 `.then` 裡呼叫 `catInit()`。除錯用 `window.__cat`（`at(ms)`、`plan(slot)`、`state()`、`set({belong})`、`give('treat',2)`、`act('treat')`、`click()`）。
- **位置不靠後端同步**：每 75 秒一個時段（`CAT.slot`），`rng('cat:'+時段)`＋台北時段／星期決定去哪（早上門口、午餐茶水間、其餘睡紙箱／空椅子／沒人的桌子／散步，夜間與週末睡紙箱），所有人算出來一樣（和掉落物同一套做法）。路線用 `findPath`（A\*）串起來並快取；約 12%（家貓等級 24%）的時段會「暴衝」：跑兩個點再跑回來、坐下理毛。**改 `catPlan` 的權重或 `CAT.slot` 會讓新舊版本的貓位置不同**，改了請讓使用者重新整理。
- **空椅子／空桌**＝`catInit` 當下沒有人物 `home` 的辦公桌椅（`desks` 取 `deskCells` 中沒人用的）；額外人物（雲端座位）在 `catInit` 之前已載入。茶水檯前新增共用貓碗（`catBowlBuild`）與紙箱（`catBoxBuild`，有碰撞），位置在 `catInit` 用 `blocked()` 從候選點挑第一個空的。
- **本機互動覆蓋（`catLocal`）**：叫牠、餵點心、逗貓棒、蹭腳、被吵醒走開，都只在做互動的那個人畫面上播（貓走向你再走回大家看到的位置）；其他人看到的還是時間表上的貓。
- **兩條進度**：歸屬感（全員共用，決定活動範圍：路過→常客（空椅子、散步）→室友（空桌）→家貓（更常暴衝），門檻 `CAT_LV_AT = [0,30,80,160]`）與個人信任度（陌生／好奇／熟悉／親近，門檻 `TRUST_AT = [0,10,25,50]`，決定叫牠會不會來、會不會玩、登入後會不會走來蹭你）。每天每種互動只有前幾次增加進度（`CAT_GAIN` 的 `cap`，前端與 Worker 兩邊要同步改）；吃飽（點心當天滿 3 次）會拒絕；睡覺時一直摸牠會走開 60 秒；週末碗視為滿（自動餵食器）。沒有「最愛誰」排行榜。
- **後端**：`pixelOfficeCat {name, op:'get'|'care', kind:'feed|treat|play|company|pet', effect:'food|water'}`，存 `pixel_office_settings` 的 `cat:<名字>`（信任、當天次數）與 `cat:office`（歸屬感、碗最後補充時間）；進度只增不減，前端取較大值合併。**這個動作是新加的，Worker 要 `wrangler deploy` 才有效**；沒部署時前端用 localStorage（`pixelCat:<名字>`）暫存，面板會註明「雲端存檔尚未啟用」。
- **道具**：冰箱面板最下面有「貓咪專用區」（貓飼料最多帶 2、貓零食最多帶 3、逗貓棒），存在 `catInv`（本機，不走冰箱庫存）。點碗：有飼料就倒進去、否則換水（都算「餵食」）。
- 還沒做：陽光／安靜程度／桌面擺設影響睡哪張桌子、四樓、貓的專屬圖鑑。

### 貼圖版（2026-11-03）
- 貓不再是方塊模型：`catBuild()` 建一片垂直平面，貼 `assets/cat/cat-atlas.webp`（`cat-atlas.json` 記格子大小）。圖集 3 欄（正面／右側／背面）× 10 列（`CAT_POSES`：stand、walkA、walkB、sit、loaf、sleep、eat、run、groom、belly），每格 377×239、腳底離格底 4 px。
- `catPose(a, now)` 負責挑格子：貓的朝向和鏡頭的相對角度 → 正／側／背（|sin|>.62 為側面，sin<0 時 `scale.x=-1` 鏡像）；pose 對應：walk／rub 以 4.5 Hz 交替 walkA／walkB，run 單張加彈跳，`loaf`（共享狀態「睡覺」）在紙箱（y<.3）用 sleep、椅子／桌上用 loaf，其餘同名。呼吸、吃東西用 `scale.y` 小幅抖動。
- 圖集由 `python3 tools/build-cat-atlas.py` 產生，來源是 `pixel-plaza/ai-views/cat-sheets/*-sheet.webp`（ChatGPT 網頁版生成的三視圖，藍底 #0066FF；stand 是米底。**只存在本機、不進 Git**，不見了就請 ChatGPT 依三視圖設定稿重畫）。要換圖：換來源 → 跑腳本 → 圖集與 json 一起 commit。
- 除錯：`window.__cat.force({pose, face, y})` 固定姿勢與朝向（face 0＝面向鏡頭、π/2＝朝畫面右），`force(null)` 取消。沒登入時改 `window.__plaza.guestAt` 的 x、z 就能把鏡頭移到貓旁邊。
- 外觀是三花貓（粉色項圈＋鈴鐺），名字目前仍叫「橘子」；要改名改 `CAT.name` 與文案（Worker 的儲存 key 是 `cat:<人名>`／`cat:office`，不含貓名）。

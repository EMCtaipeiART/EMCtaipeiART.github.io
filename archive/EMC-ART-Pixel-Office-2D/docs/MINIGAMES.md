# 小遊戲（Mini Games）

像素辦公室新增的四款小遊戲。**狀態：功能完成、尚未部署。** 所有遊戲資料都和同事工作狀態分開，成績僅供娛樂，不得作為任何工作績效依據。

## 遊戲

| 遊戲 | id | 時間 | 重點 |
|---|---|---|---|
| 辦公室尋寶 | `treasure` | 120 秒 | 每日種子 5 個道具；找到 +100，全找齊剩餘每秒 +2，提示 −50 |
| 廢紙投籃 | `hoops` | 60 秒 | 拖曳投球、固定 1/120 秒物理；進球 100、空心 150、連擊加分；20 秒後桶移動、35 秒後有風 |
| 截稿倒數 | `deadline` | 90 秒 | 色彩／圖形／排版／改稿四種挑戰；答對 +100、答錯 −20、連擊；每日同一題組 |
| 辦公室躲貓貓（單機） | `hideseek` | 20 + 120 秒 | 你 + 3 個機器人，在**真實辦公室**裡玩；規則與連線版共用 |
| 躲貓貓（連線） | `hideseek-online` | 20 + 120 秒 | 2–6 人、邀請碼、伺服器權威 |

入口：場景右上角「小遊戲」按鈕。**預設隱藏**：網址要帶 `?minigames=1`（例如 `/EMC-ART-Pixel-Office/dist/?minigames=1`）才會顯示按鈕並載入小遊戲程式；沒帶時完全不載入、不連線、不影響原本頁面。只認 `=1`，不會寫入瀏覽器儲存，所以嵌入在其他頁面的 iframe 也不會出現。要對所有人開放時，移除 `index.html` 的兩段開關腳本並恢復靜態載入即可。

## 躲貓貓的真實辦公室地圖

- 地圖直接取自真實場景：`tools/capture-office-map.mjs`（需先 `node server.cjs`）用 Chrome 把場景畫成沒有人物、沒有名牌的底圖（家具原尺寸、原位置、原角度），並輸出碰撞／門／高家具資料；`tools/build-office-map.mjs` 再整理成 `dist/minigames/data/office-map.js` 與 `dist/assets/office-map-v1.webp`（半尺寸）。辦公室版面改了就重跑這兩支。
- 世界座標＝擷取圖的像素（2370×3260）。玻璃牆（磨砂）、書櫃、櫃子、冰箱、電梯、廁所隔間擋視線；桌椅只擋人；會議室與廁所的門有缺口。窄於兩倍半徑的縫會被補平，避免人被推擠卡進家具。
- 遮蔽區域（綠色虛線）放在廁所隔間、書櫃旁、會議室角落、茶水間冰箱旁等；躲在裡面要靠近到 150 像素內才看得到。
- 人物用現有五位同事的原圖（`sprites-packed.webp`，不修改），第 6 位沿用第 5 位的圖、靠名牌顏色區分。遊戲內只顯示匿名暱稱。
- 人物走到家具後面時，把那件家具的底圖再畫一次蓋在人物上（深度排序）。畫面支援「跟隨」與「全圖」（M 鍵或按鈕），右上角有小地圖。

## 素材（Codex 畫）

- 流程：`tools/make-art-refs.mjs`（把現有素材裁成風格參考）→ `tools/run-codex-art.mjs`（本機 `codex exec` 畫圖集，使用你的 Codex 帳號與額度，提示詞與參考圖會送給 OpenAI）→ `tools/process-art.mjs`（去洋紅底、去鄰格溢出、排成圖集與審稿預覽）。提示詞在 `design/minigames-art/prompts/`。
- **每張圖集先審稿，通過才複製進 `dist/minigames/assets/` 並接上遊戲**；沒有素材時遊戲用程式繪製的圖示，不會壞。

## 架構

```
dist/minigames/
  index.js                 啟動點：橋接 window.__pixelOffice、註冊遊戲、選單、大廳
  core/manager.js          MiniGameManager：生命週期、輸入閘門、清理、安全退出
  core/{input,loop,rng,score,ui,net,lobby}.js
  games/*.js               各遊戲（彼此不 import；只用 manager 傳入的 ctx）
  assets/treasure-items.js 尋寶道具像素圖（獨立素材檔）
  minigames.css
worker/src/hide-room.ts    HideSeekRoom Durable Object（連線躲貓貓）
```

- 對 `app.js` 只加了 **2 行**（橋接），沒有改任何既有邏輯。
- 遊戲進行時，manager 在 window 的捕獲階段擋掉辦公室的鍵盤與指標事件；結束／離開／例外時由同一個 `AbortController` 一次移除所有監聽並放開按鍵。
- 每日題組：`dailySeed(遊戲, 台北日期)`；所有遊戲只能用 `ctx.rng` / `ctx.rngFor()`，不用 `Math.random`。
- 躲貓貓規則在 `games/hideseek-sim.js`，**單機與伺服器共用同一份程式碼**。

### 連線躲貓貓（伺服器權威）

- 路由：`wss://<worker>/hideseek?room=XXXXXX&mode=create|join&name=…&token=…`
- 客戶端只送 `{t:'in',seq,dx,dy,catch}`；位置、速度、抓捕、勝負全由伺服器算（30Hz，快照 15Hz）。
- 給尋找者的快照只含「看得到」的躲藏者，躲藏階段完全看不到人。
- 訊息 ≤ 512 位元組、每秒 60 則限流、序號必須遞增、每 tick 只消耗一則輸入。
- 斷線寬限 20 秒（憑證重連）；尋找者逾時＝整局作廢；空房 60 秒、閒置 10 分鐘清掉。
- 只存記憶體；不碰案件資料庫、`pixel_office_people`、`DuelRoom`。連線對戰不寫入任何排行榜或個人紀錄。
- 關閉碼：4400 請求錯誤、4404 找不到房間、4409 已存在／已滿／已開始、4413 訊息太大、4429 太頻繁、4408 閒置、4000 被新連線取代。

## 正式排行榜（伺服器驗證）

只對 **截稿倒數、廢紙投籃（完整驗證）** 與 **辦公室尋寶（簡易驗證）** 開放；兩款躲貓貓不上榜。

**「一局一張票」**
1. 開局：`POST /minigames/run` → 伺服器發 `runId`、**決定當天日期**（客戶端時鐘無效）並記下發出時間。要不到票（離線／伺服器錯誤）＝**練習模式**，成績只存本機。
2. 遊玩：客戶端用伺服器給的日期推出同一組題目／風力／道具。
3. 提交：`POST /minigames/submit {runId, device, log}`。伺服器檢查：票存在、屬於這個裝置、沒用過、沒過期；用同一份遊戲程式重算分數（**客戶端宣稱的分數無效**）；真實經過時間必須 ≥ 倒數 3 秒＋遊戲時間 − 2 秒。
4. 一票一次：交易內標記已使用；同票重送回第一次的結果（冪等）；驗證失敗也會作廢該票（不能拿同一張票反覆試探）。

| 遊戲 | 驗證 | 紀錄格式 |
|---|---|---|
| 截稿倒數 | 依種子重建題組，逐題檢查答案與選項是否存在、重算連擊與分數；最短間隔 0.3 秒、機器人式等間隔會被擋 | `{answers:[{i,a,t}]}` |
| 廢紙投籃 | 逐球重放物理（桶位置與風力由種子與幀號重算）；力道上限、球與球之間的最短間隔 | `{shots:[{k,vx,vy}]}`（k＝1/60 秒幀號） |
| 辦公室尋寶 | 位置依螢幕而異，伺服器無法重現；只檢查次數、間隔、提示最多一次、分數公式與真實時間 | `{finds:[{t}],hint}` |

**身分**：匿名裝置碼（伺服器發、存在瀏覽器）＋暱稱，榜上顯示「暱稱#後四碼」。不連結任何人事或工作狀態資料；換瀏覽器就是新身分。
**限流**：每裝置同時最多 3 張未用的票、每小時 40 局；每 IP 每小時 120 局（只存每天換鹽的雜湊）。請求 ≤ 16 KB，來源須在白名單內。
**榜單**：今日前 20、近 7 天前 20，每人每天只算最高分；查詢快取 30 秒。資料保留 90 天（alarm 每天清理）。
**誠實的限制**：無法證明「是真人玩的」。擋得住改本機紀錄、重放、假分數、不可能的速度；擋不住照人類速度精準解題的腳本。投籃用到 `Math.sin`，不同瀏覽器最後一位小數可能不同，極少數壓在邊緣的球以伺服器判定為準。

後端：`worker/src/minigame-board.ts`（Durable Object `MinigameBoard`，SQLite）、`worker/src/minigame-verify.ts`（驗證器，直接引用前端同一份遊戲程式碼）、`worker/src/index.ts`（`/minigames/run|submit|board`）。前端：`core/board.js`、`core/manager.js`（開票／提交）。

## 本機執行

```powershell
cd EMC-ART-Pixel-Office; node server.cjs            # 站台 http://localhost:8787
cd worker; npx wrangler dev --local --port 8799     # 連線躲貓貓與排行榜（localhost 自動連 127.0.0.1:8799）
```

`?hsServer=wss://…` 覆寫躲貓貓連線位址，`?mgApi=https://…` 覆寫排行榜位址。

## 測試

| 指令 | 內容 |
|---|---|
| `node --test tests/minigames-core.test.mjs` | 框架、四款遊戲規則、躲貓貓模擬與導航、連線客戶端 |
| `cd worker; npx vitest run test/hide-room.test.ts` | 連線房間（13 項，含規則一致性與資訊過濾） |
| `cd worker; npx vitest run test/minigame-board.test.ts` | 排行榜（16 項：票的生命週期、重放、偽造、限流、榜單、清理、HTTP 路由） |
| `cd worker; npx tsc --noEmit` | 型別檢查 |
| `npm run smoke` | 既有煙霧測試（pre-push 鉤子會跑） |

注意：`npm test`（backend）在 `origin/main` 上本來就有 35 項失敗，與小遊戲無關；本分支失敗項目與 main 完全相同。

### Phase 7 整合檢查（桌面 Chrome）

- 每款遊戲連續開關 20 次：DOM 節點、事件監聽數都不增加（唯一多出的是 AbortSignal 自己的 abort 監聽，隨 signal 回收）。
- 遊戲中按方向鍵：辦公室按鍵集合為空；關閉後恢復。遊戲中對辦公室畫布的指標事件被擋。
- 暫停／繼續／離開／結算流程正常；遊戲拋例外時自動安全退出並放開輸入。
- 結算成績寫入 localStorage（`emc-minigames-v1`）；連線對戰不寫入。

### 尚未驗證（需要人工）

- **iPhone Safari 實機**：觸控拖曳（投籃）、搖桿（躲貓貓）、點選命中、鍵盤彈出對大廳的影響。
- **真實幀率與真人手感**：投籃力道曲線、躲貓貓機器人強度與平衡。
- **多人真實網路**：預測與校正在真實延遲下的手感。

## 部署清單（尚未執行）

見 PR 說明／對話中的確認清單。重點：Worker 先部署（migration v3 只新增類別，不影響既有路由），網站後部署；回滾＝revert 網站 commit，Worker 可 `wrangler rollback`。

## 已知限制

- 排行榜尚無管理端刪除功能（需先確認現有管理員登入如何串接）。
- 排行榜的日期與種子由伺服器發：離線時只能玩練習模式。
- 躲貓貓使用獨立繪製的簡化地圖，不是真實辦公室座標。
- 重新整理頁面後不會自動回到連線房間。
- 全域建房限流需在 Cloudflare 另外設定。

## 交接（2026-10-27 上架當天寫）

**目前狀態：已上架，但預設隱藏。** 測試入口（管理者與 Machi）：

- <https://emc-art.com/EMC-ART-Pixel-Office/dist/?minigames=1>
- <https://emctaipeiart.github.io/EMC-ART-Pixel-Office/dist/?minigames=1>

網址沒帶 `?minigames=1` 的人看不到按鈕、也不會載入任何小遊戲程式。要對所有人開放：拿掉 `dist/index.html` 的兩段開關腳本（`minigames-on`）並恢復靜態載入、再拿掉 `minigames.css` 開頭的 `.mg-entry{display:none}`。要整個關掉：revert 網站那個合併 commit 即可（後端沒人呼叫就沒負載）。

**明天到公司，從這裡接手：**

1. `git pull`（main）。本機啟動：`cd EMC-ART-Pixel-Office; node server.cjs`（網站 8787），`cd worker; npx wrangler dev --local --port 8799`（排行榜與連線躲貓貓；localhost 自動連它）。測試網址帶 `?minigames=1`。
2. **Codex 素材（還沒進遊戲）**：圖集草稿在 `design/minigames-art/`：`raw/`（Codex 原圖）、`processed-soft/`（去背後的圖集與 `*.preview.png` 審稿圖）、`prompts/`（提示詞）、`*.soft.spec.json`（切格規格）。六張草稿：ui-skin、treasure-items、hoops-props、deadline-ui、hideseek-markers 已切成圖集（看 `processed-soft/*.preview.png`）；**guest-character（第 6 位訪客角色，正面／側面／背面）只有原圖 `raw/guest-character-v1.png`，還沒切格**（`process-art.mjs` 目前只支援正方形格，要切它得先加 cellW／cellH 支援，或手動裁三個 512×768 的格子）。**每張審稿通過才整合**：複製 `processed-soft/*.atlas.png` 與 `*.json` 到 `dist/minigames/assets/`，再改遊戲讀圖（見下），沒有圖時遊戲會退回程式繪製。重畫：改 `prompts/*.body.md` 後 `node tools/run-codex-art.mjs <名稱>`（先刪 `raw/<名稱>.png`），再 `node tools/process-art.mjs raw/<名稱>.png <名稱>.soft.spec.json processed-soft`。
3. **素材要接的地方**：尋寶道具（`assets/treasure-items.js` 現在是 10×10 程式點陣）、投籃場景（`games/hoops.js` 的紙團／垃圾桶／風向）、介面皮膚（`core/ui.js` 的 `pixelIcon` 與 `minigames.css`，樣式檔尾預留 `.mg-art-ui`）、躲貓貓標記與第 6 位角色（`games/hideseek-draw.js` 的 `AVATAR_ROWS`、`drawPerson`）。
4. **還沒驗證**：iPhone Safari 實機（投籃拖曳、躲貓貓搖桿、輸入法）、投籃分數在 iPhone 上是否與伺服器一致（`Math.sin` 的最後一位小數）、真人試玩躲貓貓平衡（`hideseek-sim.js` 的 `RULES`；機器人尋找者目前偏強）、真實網路下連線躲貓貓。
5. **已知缺口**：排行榜沒有管理端刪除（暱稱不當時只能直接清 `MinigameBoard` 的資料）；尋寶位置依螢幕而異，只能簡易驗證；地毯磚（投籃素材）不夠無縫、紙團有點像雲。
6. 改了之後的上線流程：`cd worker && npx wrangler deploy`（有改 Worker 才需要）→ 網站 push main（pre-push 會跑煙霧測試）。改地圖：先 `node tools/capture-office-map.mjs` 再 `node tools/build-office-map.mjs`。

**本機測試用的帳號與金鑰**：沒有。前端沒有任何秘密；排行榜用匿名裝置碼。

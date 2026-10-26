# 小遊戲（Mini Games）

像素辦公室新增的四款小遊戲。**狀態：功能完成、尚未部署。** 所有遊戲資料都和同事工作狀態分開，成績僅供娛樂，不得作為任何工作績效依據。

## 遊戲

| 遊戲 | id | 時間 | 重點 |
|---|---|---|---|
| 辦公室尋寶 | `treasure` | 120 秒 | 每日種子 5 個道具；找到 +100，全找齊剩餘每秒 +2，提示 −50 |
| 廢紙投籃 | `hoops` | 60 秒 | 拖曳投球、固定 1/120 秒物理；進球 100、空心 150、連擊加分；20 秒後桶移動、35 秒後有風 |
| 截稿倒數 | `deadline` | 90 秒 | 色彩／圖形／排版／改稿四種挑戰；答對 +100、答錯 −20、連擊；每日同一題組 |
| 辦公室躲貓貓（單機） | `hideseek` | 20 + 120 秒 | 你 + 3 個機器人；驗證碰撞、遮蔽、視線、抓捕規則 |
| 躲貓貓（連線） | `hideseek-online` | 20 + 120 秒 | 2–6 人、邀請碼、伺服器權威 |

入口：場景右上角「小遊戲」按鈕。

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

## 本機執行

```powershell
cd EMC-ART-Pixel-Office; node server.cjs            # 站台 http://localhost:8787
cd worker; npx wrangler dev --local --port 8799     # 連線躲貓貓（localhost 自動連 ws://127.0.0.1:8799）
```

`?hsServer=wss://…` 可覆寫連線位址。

## 測試

| 指令 | 內容 |
|---|---|
| `node --test tests/minigames-core.test.mjs` | 框架、四款遊戲規則、躲貓貓模擬與導航、連線客戶端 |
| `cd worker; npx vitest run test/hide-room.test.ts` | 連線房間（13 項，含規則一致性與資訊過濾） |
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

- 正式排行榜（後端驗證成績）**尚未實作**，目前只有本機紀錄。
- 躲貓貓使用獨立繪製的簡化地圖，不是真實辦公室座標。
- 重新整理頁面後不會自動回到連線房間。
- 全域建房限流需在 Cloudflare 另外設定。

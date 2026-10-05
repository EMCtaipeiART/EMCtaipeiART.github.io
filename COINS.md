# 平台幣機制（2026-10-05 上線）

## 規則
- **回饋**：設計師完成案件的積分 1 點 = 平台幣 1 點。只計算「**2026/10/01（含）以後結束**」且狀態「**已完成**」、「設計負責人」是五位設計師的案件列；每個案件列只記一次（積分之後被重算不會補差額，要補請在後台手動調整）。
- **花費**：每次用 AI 服裝生成器成功生成扣 **200 點**；失敗或被內容檢查擋下會**自動退回**（帳本有「退回」那一筆）。餘額不足 200 點不能生成。
- **誰能用**：只有設計師帳號（設定表的「名字」是五位設計師之一）有平台幣、能生成。管理員若沒有設計師身分，生成不扣點（紀錄仍留存）；其他人不能生成。
- **轉讓**：設計師之間互轉，**立即入帳**、轉出者無法自行取消；最小單位 0.1 點，備註最多 60 字。轉錯要請管理員在後台用「手動調整」更正。
- 積分有 0.5、1.5 這種小數，所以帳本內部用「十分之一點」整數存（`coins.ts`）。

## 帳本與防爭議
- 帳本在設計系統 Worker 的 Durable Object SQL（`coin_ledger`）：**只新增、不修改、不刪除**。每筆帶 `prev_hash` 與 `hash`（SHA-256，內容含上一筆的雜湊），後台「帳本驗證」會從頭重算，任何一筆被改動或刪除都會被抓到並指出第幾筆。
- 每筆記錄：時間、類型（回饋／服裝生成／退回／轉出／轉入／管理員調整）、設計師、點數、對象、備註、操作者帳號、參考編號（案件編號、生成編號、轉讓編號）。
- 手動調整一定要寫原因（至少 4 個字），操作者帳號也會記下來；扣回不能讓餘額變負。
- 後台頁面：`coin_ledger_admin.html`（前台左側「平台幣帳」，需要 `database.manage`）：各人餘額、驗證結果、明細篩選、匯出 CSV、手動調整、立即同步完成案件積分。
- 服裝生成的每次嘗試（成功與失敗，含用量、費用、圖片）另外記在生成器那邊的 `outfit_history`（D1）。

## 程式在哪
| 位置 | 內容 |
| --- | --- |
| `worker/src/coins.ts` | 規則常數、雜湊、驗證帳本、服務金鑰比對 |
| `worker/src/database-coordinator.ts` | `coinMe / coinTransfer / coinReserve / coinRefund / coinLedger / coinAdjust / coinEarnSyncNow`、`runCoinEarnSync`、migration 14 |
| `worker/src/index.ts` | Cron 每 10 分鐘呼叫 `runCoinEarnSync` |
| `EMC_AI_階段判定器_落地包/site-source/lib/coins-client.ts` | 生成器代使用者查餘額、轉讓，並以服務金鑰扣點／退回 |
| `…/app/api/outfit/route.ts` | 生成前扣點、失敗退回 |
| `…/app/outfit/page.tsx` | 錢包、轉讓、明細畫面 |

## 金鑰與登入
- `COIN_SERVICE_KEY`：設計系統 Worker 與生成器 Worker 各存一份相同的隨機值（`wrangler secret put`，不在 git、不在前端）。只有帶這把金鑰才能 `coinReserve`／`coinRefund`，所以使用者自己打 API 不能扣點、也不能把扣掉的點退給自己。換金鑰要兩邊同時換。
- 登入：前台左側「服裝」把設計系統 token 放在網址 `#t=…`（# 後面不會送到伺服器），生成器頁面收下後存在 sessionStorage 並立刻從網址移除；之後每個 API 以 `x-emc-editor-token` 標頭驗證。

## 營運注意
- 帳本放在 Durable Object，**沒有自動備份到別處**；建議之後把帳本定期匯出（後台 CSV）或加進現有的備份流程。
- 起算日在 `coins.ts` 的 `COIN_START_DATE`，每次花費在 `COIN_SPEND_PER_GENERATION`。

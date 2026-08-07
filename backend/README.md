# Machi 設計需求 JSON 後台

此後台將原 Google 試算表的七個分頁整合到單一 JSON 檔，並保留前台現有的 `action` API 介面：

- `database`
- `短連結`
- `修改統計表`
- `補充資料連結`
- `設定`
- `reels`
- `bug_report`

## 啟動

需要 Node.js 20 以上版本。

```bash
npm start
```

預設網址：`http://127.0.0.1:8787`

- 前台：`http://127.0.0.1:8787/`
- API：`http://127.0.0.1:8787/api?action=ping`
- JSON 資料：`backend/data/db.json`（不會由靜態網站公開）

前台在 GitHub Pages 上仍使用原 Apps Script；在其他網域或本機伺服器上會自動使用同網域 `/api`。也可透過 `?api=https://example.com/api` 或瀏覽器的 `designRequestApiUrl` 設定覆寫。

## 從 Google 試算表重新匯入

```bash
npm run import:sheets
```

匯入器會讀取七個指定分頁、保留精確欄位名稱，並在覆寫前留下 `.bak` 備份。正式啟用 JSON 後台後，請先確認 JSON 端沒有較新的寫入，再執行重新匯入，避免用試算表舊資料覆蓋 JSON 新資料。

## 環境設定

可參考 `backend/.env.example`；程式直接讀取程序環境變數。

| 變數 | 用途 |
| --- | --- |
| `HOST` / `PORT` | 監聽位址與連接埠 |
| `JSON_DB_PATH` | JSON 資料庫絕對路徑 |
| `JSON_DB_LOGIN_PASSWORD` | 固定登入密碼；未設定時沿用每日 `MMDD` 規則 |
| `PUBLIC_BASE_URL` | 產生 `/a`–`/d` 補充資料短網址時使用的公開網域 |
| `GOOGLE_OAUTH_CLIENT_ID` | Google ID token 驗證的 OAuth client ID |

正式環境建議設定固定登入密碼、HTTPS 與反向代理，並把 `backend/data` 放在定期備份的持久磁碟。

## API

前台相容端點使用：

```http
GET  /api?action=list&year=2026
POST /api
Content-Type: application/json

{"action":"add","row":{"client":"客戶","project":"專案"}}
```

已支援的主要動作：

- 案件：`list`、`recent`、`add`、`batchAdd`、`update`、`batchUpdate`、`delete`
- 短網址：`createShortLink`、`resolveShortLink`、`resolveSupplementLink`
- 設定與登入：`login`、`googleLogin`、`verifyToken`、`logout`、`getUserSettings`、`listDesignerProfiles`、`saveUserSettings`、`saveDesignerProfiles`
- 限時動態：`listReels`、`toggleReelReaction`、`addReelComment`
- 問題回報：`reportIssue`、`listIssueReports`、`updateIssueReportStatus`
- 修改紀錄：`listModificationRecords`、`addModificationRecord`、`updateModificationConfirm`

管理者可用 Bearer session token 存取通用資料表 API：

```http
GET    /api/tables
GET    /api/table/database?offset=0&limit=100
POST   /api/table/database
PATCH  /api/table/database/26080001
DELETE /api/table/database/26080001
Authorization: Bearer <editor token>
```

## 資料安全與持久化

- 所有寫入經過單一交易佇列，避免同時新增造成案件編號衝突。
- 使用暫存檔加原子更名，避免半寫入 JSON。
- 每次變更前自動備份到 `backend/data/backups/`，預設保留最近 20 份。
- `backend` 路徑不會由內建靜態伺服器公開。
- 案件新增支援 `requestId` 冪等處理，避免前台逾時重送產生重複案件。

## 驗證

```bash
npm test
```

測試涵蓋 CSV 解析、七個資料表持久化、案件新增/更新、短連結、設定、限動、問題回報、修改紀錄、登入權限與並行寫入。

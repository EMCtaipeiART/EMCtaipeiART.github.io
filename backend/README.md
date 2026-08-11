# Machi 設計需求 JSON 後台

這個 Node.js 後台是設計需求系統的唯一即時資料來源。原 Google 試算表資料及加權規則已整合到 `backend/data/db.json`：

- `database`
- `加權計分標準`
- `短連結`
- `修改統計表`
- `補充資料連結`
- `設定`
- `帳號權限`
- `角色權限範本`
- `reels`
- `bug_report`

前台、七表管理頁、登入、圖片上傳、限時動態及問題回報均直接使用 JSON API，不會在失敗時回退讀寫 Google Sheets。

## 本機啟動與驗收

需要 Node.js 20 以上版本。

```bash
npm start
```

預設入口：

- 前台：`http://127.0.0.1:8787/`
- 健康檢查：`http://127.0.0.1:8787/api?action=ping`
- JSON 資料庫管理：`http://127.0.0.1:8787/json_database_admin.html`
- JSON 圖片管理：`http://127.0.0.1:8787/json_upload.html`
- 資料檔：`backend/data/db.json`（內建靜態伺服器不會公開此路徑）

本機測試帳號為 `test.user@emctaipei.com`，密碼為 `test`。七表管理頁使用 `JSON_DB_LOGIN_PASSWORD`；未設定時沿用每日 `MMDD` 密碼規則。

## 正式部署

GitHub Pages 只能發布靜態檔，不能執行可寫入的 Node.js API。正式環境必須讓這個 repository 由 Node.js 20 服務執行，或把 `backend/` 部署到具有持久磁碟的 Node 主機，再將 Pages 前端指向該 API。

建議的單一網域部署方式是：

1. 在 Node 主機執行 `npm start`，由反向代理提供 HTTPS。
2. 將 `JSON_DB_PATH` 與 `MEDIA_ROOT` 指到備份中的持久磁碟。
3. 設定固定 `JSON_DB_LOGIN_PASSWORD`、`PUBLIC_BASE_URL`、`CORS_ORIGINS` 與 OAuth 環境變數。
4. 前端與後端同網域時會自動使用 `/api`；跨網域時，在 `index.html`、`json_database_admin.html`、`json_upload.html` 的 `design-api-url` meta 設定完整 API URL，或用 `?api=https://api.example.com/api` 驗收。
5. ERP 控制台登記的 redirect URI 必須與 `ERP_REDIRECT_URI` 完全一致；`ERP_CLIENT_SECRET` 只能存在伺服器環境變數。

## 環境設定

複製 `backend/.env.example` 的欄位到部署平台的環境變數。程式不會自動讀取 `.env` 檔。

| 變數 | 用途 |
| --- | --- |
| `HOST` / `PORT` | 監聽位址與連接埠 |
| `JSON_DB_PATH` | JSON 資料庫絕對路徑 |
| `JSON_DB_LOGIN_PASSWORD` | 固定登入與管理密碼；未設定時使用每日 `MMDD` |
| `PUBLIC_BASE_URL` | 圖片網址與 `/a`–`/d` 補充資料短網址的公開網域 |
| `CORS_ORIGINS` | 可呼叫 API 的前端來源，以逗號分隔 |
| `MEDIA_ROOT` | 圖片上傳的持久目錄 |
| `GOOGLE_OAUTH_CLIENT_ID` | Google ID token 驗證的 OAuth client ID |
| `ERP_BASE_URL` | ERP OAuth 服務根網址 |
| `ERP_CLIENT_ID` | ERP OAuth client ID |
| `ERP_CLIENT_SECRET` | ERP OAuth client secret，禁止寫入 Git |
| `ERP_REDIRECT_URI` | ERP OAuth 回跳網址 |

## API

前台相容端點：

```http
GET  /api?action=list&year=2026
POST /api
Content-Type: application/json

{"action":"add","row":{"client":"客戶","project":"專案"}}
```

主要動作：

- 案件：`list`、`recent`、`add`、`batchAdd`、`update`、`batchUpdate`、`delete`
- 短網址：`createShortLink`、`resolveShortLink`、`resolveSupplementLink`
- 設定、權限與登入：`login`、`googleLogin`、`erpLoginConfig`、`erpLogin`、`verifyToken`、`getAccessProfile`、`logout`、`getUserSettings`、`listDesignerProfiles`、`saveUserSettings`、`saveDesignerProfiles`
- JSON 媒體：`listDesignerMedia`、`uploadDesignerImage`、`uploadUserAvatar`、`deleteDesignerMedia`
- 限時動態：`listReels`、`toggleReelReaction`、`addReelComment`
- 問題回報：`reportIssue`、`listIssueReports`、`updateIssueReportStatus`
- 修改紀錄：`listModificationRecords`、`addModificationRecord`、`updateModificationConfirm`

管理者可用 Bearer session token 操作八張資料表：

```http
GET    /api/tables
GET    /api/table/database?offset=0&limit=100&q=關鍵字&sort=案件編號&order=desc
POST   /api/table/database
PATCH  /api/table/database/26080001
DELETE /api/table/database/26080001
Authorization: Bearer <admin token>
```

## 資料安全與持久化

- 所有寫入經過單一交易佇列，避免同時新增造成案件編號衝突。
- 使用暫存檔加原子更名，避免半寫入 JSON。
- 每次變更前自動備份到 `backend/data/backups/`，預設保留最近 20 份。
- `backend` 路徑不會由內建靜態伺服器公開。

## 帳號權限

`json_database_admin.html` 的「角色權限範本」頁籤可集中維護管理者、設計師、一般使用者與唯讀四種預設權限；更新後，所有套用該角色且未切換為「自訂」的帳號會同步生效，不必逐一修改。「帳號權限」頁籤會將 `設定` 人員名錄、喜愛設定與 `帳號權限` 資料表合併成單一帳號編輯器；設計師另可維護頭像、大圖、分享音樂、技能、對話框與新專案輪值。儲存時以 `adminAccountSave` 在單一交易中同步更新兩張底層資料表。權限同時由前台介面與 Worker／Node.js 寫入端驗證；管理者範本固定保留全部權限，避免管理帳號被鎖定。

## 加權分數

`加權` 依 JSON 的 `加權計分標準` 資料表計算：數量乘以所有一般項目細節的權重總和，再乘以急件倍率（預設 3 倍；未選急件時倍率為 1）。管理者可在資料庫後台直接編輯 `權重`；Node API 修改規則後會在同一筆交易內重算全部 `database` 案件。項目細節空白時不計分，欄位保持空白；若只選急件而沒有一般項目，分數為 0。可執行 `npm run weights:recalculate` 重新計算既有 JSON 案件。
- 圖片僅接受 JPG、PNG、WebP、GIF，單檔上限 8 MB。
- 案件新增支援 `requestId` 冪等處理，避免逾時重送產生重複案件。

## 重新匯入舊資料

`npm run import:sheets` 只保留作為一次性遷移工具。它會從原七張試算表重新建立 JSON，覆寫前先產生 `.bak`；正式切換後不要排程執行，以免試算表舊資料覆蓋 JSON 新資料。

## 驗證

```bash
npm test
```

測試涵蓋各資料表持久化與管理 CRUD、可編輯加權規則、角色範本與個別帳號權限、案件流程、短連結、設定、限時動態、問題回報、修改紀錄、並行寫入、ERP OAuth PKCE，以及圖片上傳／讀取／刪除。

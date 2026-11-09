# CLAUDE.md — 隱形眼鏡團購站（lens-shop）

> 在任何一台電腦接手這個資料夾的 Claude 先讀完這份。上層 `../CLAUDE.md` 的溝通慣例（繁體中文、先講結果、改完在 `MAINTENANCE_LOG.md` 檔尾記一段、commit 後直接 push）同樣適用。
> **不要把密碼、token、API 金鑰寫進任何檔案或對話。**

## 這是什麼
- 網址 https://shop.emc-art.com（多團購：`/g/<團購代號>/…`；根目錄只有一個進行中團購時自動導入，多個時顯示選單 `/campaigns`；舊網址與 `/order/<token>` 仍可用）（Cloudflare Worker `emc-lens-shop`＋靜態資源 `public/`＋D1 資料庫）。
- 前端單檔 `public/index.html`（路徑式路由 `/cart`、`/promo`、`/spec`、`/mine`、`/admin`、`/order/<token>`，沒有 `#`）；後端 `src/index.js`、`src/mail.js`、`src/xlsx.js`、`src/catalog.js`、`src/store.js`。細節看 `README.md`。

## 🔒 設定規範（不要動，除非使用者明確指名要改）
這些是「線上服務的設定」，改錯會讓網站、信件或資料壞掉，而且**不在 Git 裡補得回來**：

1. **`wrangler.jsonc` 一律不改**：`name`、`routes`（shop.emc-art.com 網域）、`d1_databases` 的 `database_id`、`assets`（含 `not_found_handling: single-page-application`，網址沒有 `#` 靠它）、`vars`（`MAIL_FROM`、`REPLY_TO`、`SITE_URL`）。要換寄件信箱／網址，先問使用者。
2. **Secrets 不碰**：`ADMIN_PASSWORD`、`BREVO_API_KEY`（及選用的 `RESEND_API_KEY`）只存在 Cloudflare。不要印出、不要寫進檔案、不要用 `wrangler secret put` 覆蓋或刪除。`.dev.vars` 是本機測試用、已被 `.gitignore`，不要 commit。
3. **資料庫不動線上資料**：`schema.sql` 只在新增欄位時才加（`ALTER TABLE`），執行前先問使用者；**不要對線上 D1 執行 DROP／DELETE／UPDATE 整批資料**（`orders`、`kv`、`files` 內有真實訂單、設定與上傳的 Excel／商品圖）。需要試資料用 `--local` 或 `.dev.vars` 的本機環境。
4. **不要重新上傳／覆蓋 `template.xlsx`、`catalog.json`、商品圖**：這些是管理員在後台上傳的，不在 Git 裡。
5. **DNS／Email（Brevo、DKIM、DMARC、Email Routing）不在這個專案改**：在 Cloudflare 網頁後台，Claude 不動。
6. 不要改 `package.json` 的依賴版本、`compatibility_date`，也不要升級 wrangler，除非使用者要求。

## 可以放心改的
- `public/index.html`（版面、文字、樣式）、`src/mail.js`（信件文案／配色）、`tools/`、`test/`、`README.md`。
- 改 `src/*.js`（邏輯）可以，但改到 API 回傳格式或訂單／Excel 回填流程時，先跑 `npm test` 並說明影響。

## 多團購架構（2026-11-09）
- 團購清單存在 kv `campaigns`（`id`、`status: open|ended`）。預設團購 `lens` **沿用舊 key（不加前綴）**，所以舊資料不需搬遷；其他團購的 kv key 為 `<id>:settings`／`<id>:pimgs`，檔案為 `<id>/template.xlsx`、`<id>/catalog.json`，期間限定圖為 `img/<id>_lim…`。
- `orders.campaign` 欄位標示訂單屬於哪個團購（預設 `lens`）；API 以 `?c=<id>` 指定團購（沒帶＝`lens`），token 開頭的訂單 API 以訂單自己的團購為準。
- 結束團購＝`status: ended`（訂單保留、不能下單／修改、可重新開放），**沒有刪除團購的功能**。團購代號限英文小寫／數字／-，不可用 `lim` 開頭或保留字（order、g、api、admin、campaigns）。
- 購物車依團購分開存（`lensCart`＝lens，`lensCart_<id>`＝其他）。後台「0. 團購管理」可切換、新增、結束／重新開放。
- 新環境第一次需對 D1 執行：`ALTER TABLE orders ADD COLUMN campaign TEXT NOT NULL DEFAULT 'lens'`（線上已執行過）。

## 部署與驗證（在這個資料夾）
- 部署：`npx wrangler deploy`（只上傳程式與 `public/`；不會動 D1 資料與 secrets）。需要已登入 Cloudflare；沒登入就請使用者在本機執行，不要請他貼 token。
- 本機預覽：`npx wrangler dev`（用 `.dev.vars` 與本機 D1，不碰線上資料）。
- 測試下單會寄**真的信**並寫進**線上資料庫**：驗證完要請使用者在後台刪掉測試訂單，不要拿同事的信箱測。
- 前端改完先用瀏覽器看桌面與手機寬度；網頁快取時加 `?v=數字` 強制重載。

## 商業規則（使用者決定的，別擅自改）
- 主色 EMC 綠 `#159E31`（`--b`）；信件按鈕同色。介面要簡潔，使用者嫌「太複雜」就是要減，不要加。
- 流程：選購商品 → 送出訂單 → 依帳號匯款 → 回報匯款（後 5 碼或截圖）；完成的步驟後面打勾。購物車、送出後頁面、單筆訂單、訂單列表都有進度條。
- 截止日期以台灣時間解讀；截止後不能下單／修改，但仍可回報匯款。
- 確認信必須帶系統信警語（`SYSTEM_NOTE`），按鈕連結為 `/order/<token>`；舊的 `/#/order/…` 連結由前端自動轉址，別移除那段轉址程式。
- 訂單列表只公開姓名、品項、金額、已付款，**不公開 email 與 token**。
- 商品圖要的是「隱眼外盒包裝圖」，**不要放品牌 logo**。
- 導覽列用線條小圖示，滑過展開文字；頂端不放 logo／站名／倒數（倒數只在首頁 hero）。

## 還沒做（使用者說「晚點」）
- 「回信回報匯款」：Cloudflare Email Routing＋Email Worker（從主旨解析訂單編號、後 5 碼、圖片附件，寄件者 email 要與訂單相符）。做之前先與使用者確認。

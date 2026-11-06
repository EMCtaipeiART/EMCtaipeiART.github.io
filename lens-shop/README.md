# 隱形眼鏡團購網站（Cloudflare Worker）

- 前台 `public/index.html`（選購／促銷／期間限定／規格表／購物車／我的訂單／管理）。
- 後端 `src/index.js`：D1 存訂單、R2 存 Excel 範本／目錄／圖片。
- `src/xlsx.js`：讀 Excel、回填「填寫單N」。只改 A、B、E、F、G、H、K、L 欄的儲存格，**遇到公式的儲存格絕不覆蓋**，其餘檔案內容原封不動，並設定開檔時重新計算。

## 首次部署
```bash
cd lens-shop && npm install
npx wrangler d1 create emc-lens-shop        # 把輸出的 database_id 貼進 wrangler.jsonc
npx wrangler d1 execute emc-lens-shop --remote --file=schema.sql
npx wrangler r2 bucket create emc-lens-shop
npx wrangler secret put ADMIN_PASSWORD      # 管理者密碼
npx wrangler secret put RESEND_API_KEY      # 寄信（Resend，需先驗證 emc-art.com 網域）
npx wrangler deploy
```
寄件人在 `wrangler.jsonc` 的 `MAIL_FROM`（shop@emc-art.com）。沒設 RESEND_API_KEY 時不寄信，頁面會提示。
本機測試：建立 `.dev.vars`（`ADMIN_PASSWORD=...`）後 `npx wrangler dev`。

## 使用
管理 → 上傳 Excel → 設定截止日／匯款帳號 → 同事下單（確認信含修改連結）→ 結單後「一鍵下載彙整 Excel」。

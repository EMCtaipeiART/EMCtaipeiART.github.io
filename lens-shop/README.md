# lens-shop（隱形眼鏡團購）

Cloudflare Worker `emc-lens-shop`，網址 https://shop.emc-art.com 。
- 前台／後台：`public/index.html`（單頁，SPA fallback；`/api/*` 先交給 Worker）
- API：`src/`（D1 資料庫 `emc-lens-shop`）
- 機密（ADMIN_PASSWORD、BREVO_API_KEY）只存在 Cloudflare，不在 repo。
- 部署：`cd lens-shop && npm i && npx wrangler deploy`
- 注意：此原始碼由線上版本的 source map 還原而來。

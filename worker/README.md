# Machi Design API Worker

正式站的登入、session、權限與 GitHub JSON 寫入 API。單一 SQLite Durable Object `primary` 負責序列化 `backend/data/db.json` 的讀寫，避免多人同時修改造成 lost update。

## 本機驗證

```bash
pnpm install
pnpm test
pnpm check
pnpm deploy:dry
```

## Secret

下列值只存在 Cloudflare Worker Secret，不可寫入 `.dev.vars` 以外的本機檔案，也不可提交 Git：

- `GITHUB_TOKEN`：僅限 `EMCtaipeiART/EMCtaipeiART.github.io`、Contents 讀寫。
- `ERP_CLIENT_SECRET`：ERP OAuth code exchange。
- `ADMIN_LOGIN_PASSWORD`：管理者密碼登入；Google 公司帳號登入不使用此密碼。

設定方式：

```bash
pnpm exec wrangler secret put GITHUB_TOKEN
pnpm exec wrangler secret put ERP_CLIENT_SECRET
pnpm exec wrangler secret put ADMIN_LOGIN_PASSWORD
```

## 部署

```bash
pnpm deploy
```

正式 API：`https://machi-design-api.machi-chen.workers.dev/api`

部署後先測 `ping` 與 CORS，再以公司 Google 帳號驗證登入；管理寫入只做無變更更新或 disposable 測試列。上傳圖片仍由 `upload/` Apps Script 處理，但它必須向 Worker 驗證 token 並透過 Worker 同步 metadata。

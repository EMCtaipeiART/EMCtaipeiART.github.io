# emc-pixel-assets

Pixel Office 的圖片（assets/*.webp）放在 Cloudflare 提供，避開 GitHub Pages 每次推送後的冷快取。
圖片檔名帶版本（?v=），內容更新時請先把新圖放進 `public/assets/` 再執行 `npx wrangler deploy`，然後才改 app.js 的版本號。

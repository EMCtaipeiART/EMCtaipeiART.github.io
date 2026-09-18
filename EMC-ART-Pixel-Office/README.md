# 凱曜設計部・像素辦公室

這是目前已發布第 6 版的完整本機開發交接包。純 HTML、CSS、JavaScript 與 Canvas，無第三方套件、無建置步驟，不需要 API 金鑰。

GitHub Pages 版：<https://emctaipeiart.github.io/EMC-ART-Pixel-Office/>

## 等級資料串接

遊戲載入時會以唯讀方式取得正式站的 `/data/database_archive.json`，只統計 2023 年起狀態為「已完成」的 Machi、Anna、Amber、Leona 與 Noise 案件。計分順序為已存「加權」、「數量」，兩者都空白時以該筆已完成案件 1 分計。

- `1 分 = 10 EXP`
- 抵達 `Lv.N` 需要的累計分數為 `10 × (N - 1)²`
- 後台快照更新後，重新載入遊戲即會更新等級與經驗條。
- 線上資料暫時無法取得時，畫面會顯示 2026-09-18 的最近同步值。

## 啟動

先安裝 Node.js（18 或以上，建議使用 LTS）。解壓縮後：

- Windows：雙擊 `Start-Windows.bat`。
- macOS：雙擊 `Start-Mac.command`。若系統不允許雙擊，直接在終端機進入此資料夾執行 `node server.cjs --open`。
- 或在此資料夾執行 `npm start`，開啟 http://localhost:8787。

不需執行 npm install。關閉伺服器請在啟動視窗按 Ctrl+C。固定使用同一個 localhost 網址，才能讀取同一份本機存檔。不要直接雙擊 dist/index.html；請透過本機伺服器開啟。

## 在本地 Codex 接手

在你的本地 Codex 開啟整個 `Kaiyao-Pixel-Office` 資料夾，請它先閱讀 `README.md` 與 `docs/HANDOFF.md`。可直接貼上：

> 這是凱曜設計部像素辦公室。請先讀 README.md 和 docs/HANDOFF.md，啟動本機網站，之後依我的需求修改。主要程式位於 dist/app.js、dist/style.css、dist/index.html。請保留人物、家具素材、對話、照片與本機存檔功能。

`dist/` 雖然叫 dist，但本專案的原始程式就在這裡，未壓縮也未經編譯。修改後重新整理網頁即可。

## 包含內容

- `dist/index.html`：網頁結構。
- `dist/style.css`：版面、工具面板與行動裝置樣式。
- `dist/app.js`：角色移動、碰撞、圖層、像素心情、離席狀態、對話、照片、本機存檔。
- `dist/assets/`：全部網站圖片素材，包括角色、透明精靈圖、拆分家具與舊版場景參考。
- `dist/assets/sprites-noise.png`：遊戲目前使用的人物圖集；Noise 為藍帽、短袖 T-shirt、短褲、白襪與灰色布鞋三視圖。
- `dist/assets/icons-refined.png`：與人物風格一致的 3×3 精緻像素圖示，包含四種心情與五種出勤狀態。
- `references/`：原始辦公室與人物三視圖參考圖。
- `server.cjs`：僅監聽本機的零依賴開發伺服器。
- `source-history.bundle`：原網站完整 Git 提交歷史（第 1 至第 4 版）。
- `docs/HANDOFF.md`：設計規格、素材座標、已知限制與後續修改說明。

若需要查看歷史，可執行 `git clone source-history.bundle history-copy`。這會另建歷史副本；目前交接包根目錄另外含有啟動腳本及本說明。

## 資料與網站連結

目前網站：https://kaiyao-pixel-office.emctaipei-9592.chatgpt.site

封存原始碼提交：0a1bf705f0d8fa6d90bc0c290dc1d5437b0f2b1b。

照片、對話、心情、離席狀態與人物位置保存在各使用者瀏覽器 localStorage，沒有雲端資料庫。下載包不包含你或同事瀏覽器中的個人存檔；線上網址的存檔不會自動搬到 localhost。這是一個單人版本，不提供多人同步。

本地修改不會自動更新原網站；發布需另外具備原網站或其他主機的部署權限。包內不含登入憑證、部署 Token 或 API 金鑰。原網站的存取權限由託管平台管理，本地版本不使用該登入門檻。

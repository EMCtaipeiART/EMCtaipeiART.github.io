# 辦公室翻身記（合成遊戲）

線上：https://emc-art.com/office-merge/（2026-11-28 上線）。手機直向網頁遊戲，純靜態檔案，沒有建置步驟。
**換電腦或新的 Claude 對話要改這個遊戲，先讀完這份，再照根目錄 `CLAUDE.md` 的工作流程。**

## 換一台電腦開始改

1. `git fetch origin`，從 `origin/main` 開臨時 worktree（做法見 `CLAUDE.md`）。主目錄若有未追蹤的 `office-merge/` 是上線前舊稿，不要改它。
2. 本機預覽：`node office-merge/serve.mjs` → http://127.0.0.1:4190/office-merge/
   - 假後端（不寫線上資料）：`?me=Machi&api=/mockapi`；版面示範：`?demo`。不帶 `api` 時本機不連正式後端。
   - 本機讀不到角色工坊的雲端圖（來源限制），會用 `pixel-plaza/sprites-hd`，屬正常。
3. 改完跑 `node office-merge/test.mjs`；改到後端另跑 `worker` 的測試。
4. 手機尺寸（375×812）實際看過畫面再推。

## 檔案

| 檔案 | 內容 |
| --- | --- |
| `logic.js` | 規則與**所有數值**（能量、關卡、經驗值、物品線、掉落率、人物名單），不碰畫面 |
| `game.js` | 棋盤、拖曳、訂單、能量面板、兌換、任務物品提示、蹦出動畫 |
| `home.js` | 首頁迷宮塔闖關榜 |
| `story.js` | 劇情章節（對話、要交的物品、解鎖或升級哪條線），加章節只改這裡 |
| `cloud.js` | 登入身分、排行、能量與存檔 API |
| `savesync.js` | 跨裝置同步與版本衝突規則 |
| `chars.js` | 人物圖（和元宇宙同一份最新角色） |
| `audio.js` | 配樂 `art/bgm.mp3` 循環播放、即時合成音效 |
| `effects.js` | 升級／過關特效 |
| `art.js` | 金幣與星星向量圖、產生器／紙箱圖檔路徑 |
| `style.css`、`index.html` | 版面 |
| `art/` | 文具櫃 `s`、茶水間 `t`、紙箱 `box`、背景 `bg.jpg`、配樂 |
| `items/` | 物品圖 6 條線各 7 張（`s` 文具、`t` 茶水、`i` IT、`m` 會議、`d` 設計、`w` 福利），複製自 `pixel-plaza/dex/` |

遊戲以外的相關程式：`worker/src/database-coordinator.ts`（`officeMergeRank`、`officeMergeEnergy`、`pixelOfficeFun` 撿道具）、`worker/src/coins.ts`（帳本類型 `merge_energy`）、`pixel-plaza/index.html`（`EXP_GAMES.merge`、右上小遊戲面板、撿道具提示）、`pixel-plaza/gameui.js`（右側選單的小遊戲）、`site.js`／`site.css`（小幫手固定按鈕 `.as-merge`）、`worker/src/assistant-knowledge.ts`。

## 使用者定的規範（照做，別擅自改）

- **畫風**：圓潤亮色的合成手遊風（天空／辦公室場景、奶油色棋盤、立體膠囊按鈕）。插圖要**厚塗立體**、細節少、50px 看得清楚；使用者否決過扁平向量圖與像素圖。
- **新插圖／配樂**用 Higgsfield（圖：GPT Image 2.6、quality high、透明底，以 `items/t3.png` 為畫風參考，約 1.25 點／張；樂：ElevenLabs Music v2.5，60 秒約 8.7 點）。**花點數前先報價並取得同意**，生成後先給使用者看再換上。
- **人物**用元宇宙最新角色；沒登入、沒上榜的人顯示「透明人」。
- 點產生器要有物品蹦出動畫；升級與過關要有特效；點任務物品要能看到它在合成路線的第幾階。
- 聲音面板（右上音符）：背景音樂與音效各有開關和 0–100 音量。能量兌換入口是上方能量膠囊的「＋」，能量用完時面板會自己打開。
- 能量上限 100、點一次 1 點、每分鐘回 1 點；獎勵／撿道具／兌換來的可超過上限、**沒有上限**。
- 元宇宙撿**地上**道具回饋 1 能量、四五樓**清大便回饋 2**；15 平台幣換 100 能量（要按兩次確認）。

## 關卡、劇情與圖鑑等級

- **一章＝一關**（使用者要求合併、50 關起跳），目前 50 關，之後是無限「加班挑戰」。章節在 `story.js`，加關卡只要往後加。
- 每關先完成 `levelGoal` 張一般訂單（2→6），上方第一張紫色「過關任務」卡才解鎖；交付就過關。點卡上頭像看對話。
- 開局只有文具、茶水兩條線；第 1–4 關依序解鎖 IT、會議、設計、福利。訂單只會要已解鎖的線。
- 部分關卡升圖鑑等級（上限 Lv.5）：該線一般訂單金幣每級 +15%、產生器多掉一階機率每級 +7%。
- 金幣 1000 換能量 100（使用者定的）。
- **改存檔格式要把 `SAVE_VERSION` 加 1**：Worker 與 `savesync.js` 靠它擋住舊版（快取）頁面覆蓋新版雲端存檔。
- 已上線的章節順序不要改（存檔記的是第幾章）。

## 後端與身分

- 身分來自網址 `?me=`、網站登入的 `pixelViewerHandoff` 或網站目前的登入狀態，不能自己挑名字；訪客不上榜。本機存檔依身分分開（`officeMergeSave:<名字>`）。
- **雲端存檔**（`savesync.js` ＋ Worker `officeMergeSave`）：登入者每個動作 1.5 秒後上傳，離開畫面立刻上傳，開啟與切回畫面時先讀雲端。雲端有版本號，撞版本的取捨規則寫在 `savesync.js` 開頭；改它要跑 `test.mjs`。訪客只存本機。使用者要求「玩到哪記錄到哪」。
- `officeMergeRank`：只往上記完成訂單數與經驗值，不寫 GitHub，**不驗證身分**（與其他元宇宙寫入一樣）。
- `officeMergeEnergy`（status／claim／buy）：要登入憑證；點數先記 pending，遊戲領取後才加進存檔；領取與兌換都用編號防重複。撿道具＋清大便每人每天合計上限 300（防直接打 API，Claude 設的，使用者尚未表示意見）。
- 可上榜名單：`logic.js` 的 `PEOPLE` 和 Worker 的 `OFFICE_MERGE_NAMES` 要一起改。

## 部署

1. 網站：push 到 `main` 後由 `.github/workflows/update-database-archive.yml` 發布（路徑清單要含 `office-merge/**`；遊戲用到清單外的新資料夾時要一起加），約一兩分鐘上線。瀏覽器快取約 10 分鐘，剛上線看到舊畫面或新舊混在一起時按 Ctrl+F5。
2. 後端有改才需要：這台電腦要先 `wrangler login`。部署前先確認 `origin/main` 是線上最新（`wrangler deployments list` 的時間對得上最後一次 worker 提交），再 `cd worker && wrangler deploy`。剛部署完幾秒內可能回 `Unknown action`，重打一次。

## 目前狀態（2026-11-28）

- 已有：棋盤 7×9、6 條物品線各 7 級、16 章劇情與圖鑑等級、產生器升級、紙箱、3 張訂單（每第 5 張急件×2）、暫存 2 格、販售、圖鑑、8 關＋加班挑戰、經驗值與升級、能量、闖關榜、配樂音效。
- 尚未在線上實測：撿道具回饋能量、實際按下兌換（本機與後端測試通過）。
- 還沒做：植栽物品線、裝修、加班模式、茶水間八卦。

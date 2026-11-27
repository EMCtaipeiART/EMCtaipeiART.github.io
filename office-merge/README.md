# 辦公室翻身記（合成遊戲原型）

手機直向的網頁合成遊戲。純靜態檔案，沒有建置步驟。

- 本機預覽：`node office-merge/serve.mjs` → http://127.0.0.1:4190/
- 規則與數值：`logic.js`　畫面與操作：`game.js`　金幣與星星向量圖：`art.js`　聲音：`audio.js`（配樂 `art/bgm.mp3`，Higgsfield ElevenLabs Music v2.5 生成 60 秒；音效即時合成）　升級／過關特效：`effects.js`
- 關卡與能量數值在 `logic.js` 最上面
- 產生器、紙箱、背景圖：`art/`（`s` 文具櫃、`t` 茶水間、`box` 紙箱、`bg.jpg` 辦公室；Higgsfield GPT Image 2.6 生成，以 `items/t3.png` 為畫風參考）
- 物品圖：`items/`，複製自 `pixel-plaza/dex/`（`s1–s7` 文具、`t1–t7` 茶水間）
- 存檔：瀏覽器 `localStorage` 的 `officeMergeSave`

## 首頁闖關榜（雲端）

`home.js` 畫面、`cloud.js` 身分與連線。後端 `worker/src/database-coordinator.ts` 的 `officeMergeRank`（只往上記完成訂單數與經驗值，不寫 GitHub，改了要 `wrangler deploy`）。身分來自網址 `?me=` 或網站登入的 `pixelViewerHandoff`，沒有身分的訪客不上榜。與其他元宇宙寫入一樣，後端不驗證身分。本機預覽不打正式後端，`?demo` 可看示範版面。

## 人物與能量

- 人物圖：`chars.js`，和元宇宙同一份最新角色（角色工坊雲端圖集，否則 `pixel-plaza/sprites-hd`）；沒登入的人顯示「透明人」。
- 能量：元宇宙撿地上道具 +1（每天上限 300 點，防直接打 API）；15 平台幣換 100 能量（帳本類型 `merge_energy`）。後端 `officeMergeEnergy`，要登入憑證；點數先記 pending，遊戲領取後才加進存檔，沒有上限。

## 入口

元宇宙右上角「小遊戲」按鈕（`pixel-plaza/index.html`）、小幫手聊天視窗的固定按鈕（`site.js`）。

## 第 1 階段範圍

能量 100 點（點產生器花 1、每分鐘回 1）、經驗值與等級、升級／過關回饋經驗值和能量（獎勵能量可超過上限）、8 個關卡＋無限加班挑戰、升級與過關特效、背景配樂與音效、任務物品的合成階段提示、棋盤 7×9、拖曳合成、紙箱、產生器升級、2 條物品線（各 7 級）、3 張訂單（每第 5 張為急件大單（獎金加倍））、暫存 2 格、販售、圖鑑、本機存檔。

尚未做（第 2 階段）：IT 與植栽物品線、裝修（金幣用途）、角色劇情、加班模式、茶水間八卦。

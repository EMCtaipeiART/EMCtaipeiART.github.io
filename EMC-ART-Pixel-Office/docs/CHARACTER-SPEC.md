# 人物製作規範（凱曜設計部・像素辦公室）

新人物要跟現有五位（Leona、Amber、Noise、Anna、Machi）看起來像同一套美術。這份規範的數字是直接量現有人物得到的，照著做就能直接套進遊戲。

搭配工具：`dist/tools/character-fitter.html`（把三視圖自動去背、切格、縮放對齊、檢查並輸出圖集與程式碼）。

---

## 1. 一句話風格

> 2 頭身的 Q 版像素上班族，深色描邊、平塗上色、白色背景的辦公室日常。

## 2. 尺寸與版位

| 項目 | 規範 |
| --- | --- |
| 交付圖 | 一張 PNG，左至右為**正面 → 右側面 → 背面**三個視圖 |
| 背景 | 透明最好；白色或單一底色也可以（工具會去背） |
| 遊戲內每格 | 140 × 192 像素（工具自動切） |
| 人物高度 | 186–190（含頭髮與帽子）；現有人物 182–190 |
| 腳底 | 貼齊格子底部（y = 190，±2） |
| 水平位置 | 置中於 x = 70（±6） |
| 最大寬度 | 含頭髮 ≤ 132，左右各留至少 4 像素 |

## 3. 身體比例（以人物總高 H 為基準）

| 部位 | 位置／大小 |
| --- | --- |
| 頭（含髮頂到下巴） | 約 0.5 H（約 2 頭身） |
| 眼睛中心 | 0.25 H（±0.04），三個視圖要一致 |
| 肩寬 | 60–75 像素（長髮會讓外輪廓看起來更寬，屬正常） |
| 腰 | 約 0.5 H |
| 手腕／袖口 | 約 0.75 H |
| 腳 | 兩腳併攏或微開，站姿正面朝前 |

## 4. 畫風

- **描邊**：深色外框 1–2 像素，用接近黑的深灰（#1b1b1b–#2a2a2a），不要純黑大面積。
- **上色**：平塗 2–3 階（底色＋暗部＋少量亮部），不要漸層、不要噪點、不要外光暈。
- **臉**：大圓黑眼珠＋一點白色高光、淡粉腮紅、細眉、簡單微笑；嘴巴不超過 4 像素寬。
- **頭髮**：分 2–3 階上色，髮流用幾條亮色線帶過，不畫細碎髮絲。
- **陰影**：不畫地面投影（遊戲會自己處理選取光圈）。

## 5. 服裝

- 上班休閒風：T 恤、襯衫、帽 T、外套、寬褲、長裙皆可，避免過於暴露或複雜圖騰。
- 每個人要有**一個一眼認得出的單品**（例如 Noise 的藍帽、Anna 的粉色上衣、Machi 的黑色帽 T）。
- 主色 2–3 色＋1 個點綴色。大面積純黑時要用深灰帶出布料質感（參考 Machi）。
- 鞋子與地面的接觸線要清楚，鞋底畫一條深色線。

## 6. 配件

| 配件 | 規範 |
| --- | --- |
| 眼鏡 | 鏡框 2 像素、深色；不可遮住眼睛高光；側面要畫出鏡腳 |
| 帽子 | 帽簷不超過肩寬；**背面視圖要畫出帽子背面**（例如後扣、帽圍） |
| 耳環、項鍊 | 最小 3 像素才畫得出來，否則會糊成一點 |
| 包包、識別證 | 掛在身體同一側，三個視圖位置要一致 |
| 手持物 | 不要（遊戲會在人物旁另外顯示心情與狀態圖示） |

## 7. 三視圖一致性

- 同一套服裝、同髮色、同配件位置。
- **側面一律朝右**（遊戲往左走時會自動鏡像）。
- 背面不畫臉，只有頭髮／帽子與背影。
- 三個視圖的頭頂與腳底要在同一水平線上。

## 8. 姿勢

正面站立、雙手自然垂放、不叉腰不比手勢。遊戲只會左右鏡像與上下浮動，沒有逐格走路動畫，動作太大反而會怪。

## 9. 生成提示詞（可直接貼給影像模型）

> Pixel-art character turnaround sheet, three views in one row: front, right side, back.
> Chibi office worker, 2 heads tall, eyes at 25% of total height, standing straight with arms relaxed at the sides.
> Style: crisp pixel art, dark 1–2px outline (#222), flat shading with 2–3 tones, soft highlights, rosy cheeks, large round black eyes with a single white highlight, simple smile.
> Transparent background, no ground shadow, no text, no frame, no glow.
> Same outfit, hair colour and accessories in all three views; side view faces right; back view shows hair/cap only, no face.
> Character: 【這裡寫人物特徵：髮型與髮色、服裝、配件、代表色】
> Output: one PNG, the three views evenly spaced left to right, equal height, feet aligned on the same baseline.

範例（Machi）：`棕金中分頭、黑色帽 T 與工裝褲、白色球鞋、黑色為主色`

## 10. 怎麼套進遊戲

1. 啟動本機網站（`Start-Mac.command`／`Start-Windows.bat`／`node server.cjs`），打開 <http://localhost:8787/tools/character-fitter.html>。
2. 拖入三視圖 → 確認預覽的三格與檢查項目全是綠色勾。
3. 下載 **sprites-packed.webp**，覆蓋 `dist/assets/sprites-packed.webp`（記得改 `app.js` 裡的 `?v=` 版本號讓瀏覽器重新抓）。
4. 依工具右下角產生的程式碼片段修改 `dist/app.js`：`names`、`descriptions`、`rowTops`、`rowHeights`、`starts`、`stations`、`fallbackScores`。
5. 把新名字加進 Worker 的 `PIXEL_OFFICE_NAMES`（`worker/src/database-coordinator.ts`）——這是多人同步的白名單，沒加會無法同步。
6. 等級來自案件資料的「設計負責人」欄位，名字要跟後台一致才有分數。
7. 座位只有六個（左下目前是空位）。要加到第七人時，得先在 `stations` 與 `starts` 安排新座位並確認 `walls` 的碰撞範圍。

## 11. 驗收清單

- [ ] 三視圖同一套服裝、同髮色、側面朝右、背面沒有臉
- [ ] 腳底貼齊格子底部、水平置中、左右留白 ≥ 4 像素
- [ ] 眼睛在總高 25%（±4%）
- [ ] 沒有背景、沒有地面陰影、沒有外光暈或文字
- [ ] 在遊戲裡站進座位時，頭不會被桌面切到、椅子看得到
- [ ] 手機尺寸下仍看得出是誰（縮到約 1/3 大小）

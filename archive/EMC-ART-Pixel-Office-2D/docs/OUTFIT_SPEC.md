# Pixel Office 服裝製作規範

用途：照這份規範做（或用 AI 生成）一套新服裝，做出來的圖可以直接丟給我裁切、接上頭像，不需要再調整比例。
數值都是從現有六套服裝（黃 T 星星褲、藍 T 寬牛仔褲、黑西裝、米白襯衫、丹寧外套、黑連帽衫）的參考圖實際量出來的，以「身體高度 H」為 100%。

> 參考圖：`600 × 1176` 像素、6 套 × 3 欄（正面、側面、背面），每格約 `200 × 196`。下面「px」都是這張參考圖的像素；你用多大尺寸製作都可以，只要**比例**一樣（建議整張放大 2–4 倍，線條才不會糊）。

---

## 1. 成品是什麼

- **只畫身體，不畫頭**：沒有頭、沒有頭髮、沒有帽子、沒有眼鏡。頭、帽子、眼鏡是遊戲另外疊上去的。
- **每套服裝 3 張圖**，由左至右排成一列：
  1. 正面
  2. 側面（**人物面向右邊**，遊戲往左走時會自動左右翻轉）
  3. 背面
- 3 張**同一個大小、同一條腳底線**排好，格子之間至少留 20 px 空白（參考圖是每格 200 px 寬）。
- **背景透明**（PNG 或 WebP 都可以）。如果生成工具做不到透明，就用純白底，我再去背——但白色不能出現在衣服裡（例如白鞋、白襯衫請用淺米白 `#F4EFE6` 之類，不要純白 `#FFFFFF`）。
- 一次可以放很多套（一套一排），像參考圖那樣；每排高度一樣。

## 2. 整體尺寸（以參考圖為準）

| 項目 | 數值 | 說明 |
|---|---|---|
| 身體高度 H（頸頂到鞋底） | **168 px**（164–171） | 3 張圖的鞋底要在同一條線上，誤差 ≤ 3 px |
| 正面寬度（含手臂） | **152–175 px**（H 的 90–104%） | 褲子與外套越寬，這個值越大 |
| 背面寬度 | **同正面** | 輪廓幾乎一樣 |
| 側面寬度 | **90–111 px**（H 的 54–66%） | 外套、口袋、手臂會讓側面變寬 |
| 格子 | 約 200 × 196 px | 身體置中，上下各留幾 px |

遊戲裡實際畫出來的大小 = 圖片大小 × 0.475，所以參考圖的 168 px 在遊戲裡約 80 px 高。不用管這個換算，只要比例對。

## 3. 比例（正面為準）

高度由上往下（y 從頸頂 = 0 算起，以 H = 168 px 為準）：

| 位置 | y | 占 H | 說明 |
|---|---|---|---|
| 頸頂 | **0** | 0% | **整張圖最高的點就是頸頂**（手舉過頭的動作圖除外），頸口是平平切掉的 |
| 領口／肩線 | 12–28 | 7–17% | T 恤、襯衫領口低，連帽衫連帽在這裡 |
| 手（拳頭）中心 | 60–85 | 36–50% | 手垂在大約腰到臀的高度 |
| 腰線／衣服下擺 | 60–85 | 36–50% | 依款式；外套短版約 50%，連帽衫約 48% |
| **褲襠（兩腿分開處）** | **73–80** | **44–48%** | 上身（頸頂到褲襠）約 **45%**，下身（褲襠到鞋底）約 **55%** |
| 鞋子上緣 | 約 138–142 | 約 82–85% | 鞋子占高度的 **15–19%**（約 26–32 px） |
| 鞋底 | 168 | 100% | 3 張圖同一條線 |

重點：**上身短、腿長**，褲子偏寬鬆，這是這個遊戲的人物比例，不要畫成正常人的 1:1。

## 4. 脖子（最重要，頭要接在這裡）

| 項目 | 數值 |
|---|---|
| 脖子寬度 | **24–34 px**（H 的 14–20%，約占正面寬度的 16–22%） |
| 脖子露出高度（頸頂到領口） | **12–27 px**：T 恤、連帽衫等高領口約 12–14 px；西裝、襯衫、丹寧外套這類 V 領約 22–27 px |
| 頸頂 | 平的、水平切口，**一定要是整張圖的最高點** |
| 脖子中心 x（正面、背面） | 在整個人**正中間**（約 50%） |
| 脖子中心 x（側面） | 約在人物寬度的 **45–46%**（稍微偏後、偏左，因為人物面向右） |
| 顏色 | 跟手的膚色**完全一樣** |

> 為什麼重要：我是用「頸頂的位置和脖子中心」把頭釘上去的。頸頂不平、脖子太細或太寬、或脖子被衣領蓋住，頭就會浮起來或陷進衣服裡。

## 5. 手

- 畫成**圓潤的拳頭／連指手套**，**不畫手指**。
- 大小：寬 **20–29 px**、高 **22–26 px**（H 的 12–17% 寬、13–15% 高）。
- 位置（正面）：兩手在身體兩側，**手中心離畫面邊緣約 12–15% 寬度**，也就是手的外緣幾乎貼到整個人最外側；高度約在 H 的 **36–56%**（y 60–95）。
- 手臂自然下垂、**稍微離開身體**（像 A 字站姿），不要緊貼身體，也不要往外張開很大。
- 短袖：袖子到上臂中間，前臂露膚色（黃 T、藍 T 就是這樣）；長袖：袖口剛好在手腕，只露出拳頭。
- 側面：只看得到靠近鏡頭的那隻手，約在人物寬度的 **30–60%**、y 70–92 的位置。
- 背面：手的位置、大小跟正面對稱一致。

## 6. 鞋子

- 鞋子總高度（鞋口到鞋底）**約 26–32 px（H 的 15–19%）**。
- 正面：兩隻鞋左右分開、**腳尖朝前**，每隻鞋寬約 **38–48 px**，兩隻鞋中間留 **約 12–25 px** 的空隙；兩隻鞋底在同一條線上。
- 側面：只看到一隻鞋（另一隻被擋住或露出一點點），**鞋頭朝右**，鞋長約 **45–55 px**。
- 背面：只看到鞋跟和鞋後半部，兩隻左右分開，寬度跟正面一樣。
- 款式不限（運動鞋、短靴、皮鞋、涼鞋），但鞋底要有厚度（約 4–6 px 的厚鞋底，這是這個遊戲的畫風）。

## 7. 畫風（要跟現有六套一致）

- **粗黑輪廓線**，顏色接近 `#302828`（暖黑，不是純黑），粗約 **10 px**（H 的 6%，2026-10-06 三次加粗；內部結構線約一半粗），線條平滑、粗細一致，整件衣服都有。
- **賽璐璐上色**：每塊顏色有一層淡淡的陰影和少量高光，不要寫實的漸層、不要紋理雜訊。
- **膚色**固定：`#F8B888`（高光 `#F8C890`，陰影 `#E8A070`）。手和脖子都用這組色。
- 圖案和文字（例如 T 恤上的字、褲子上的星星）要**簡單、色塊分明**，不用細節到看不出來——遊戲裡只有約 80 px 高。
- 配件（鍊子、手錶、珍珠項鍊等）可以有，但要小而清楚，不能大幅超出身體輪廓。
- 光線一律從**左上**來，3 個角度的陰影方向一致。

## 8. 三個角度要一致

- **同一件衣服在三個角度的顏色、圖案、長度、褲管寬度要一致**：正面看到的口袋、拉鍊、字樣，側面要看得到對應的位置；背面要有合理的背面設計（沒有的就畫平整布面，不要把正面的東西畫到背面）。
- 側面不是把正面壓扁：要有正確的厚度、前後的衣襬、褲管的前後腿錯開。
- 背面看不到臉的方向，所以**領口後面是脖子的背面**，不要畫出前面的 V 領。
- 3 張圖的**高度一致、頸頂在同一高度、腳底在同一條線**。

## 9. 不要做的事

- ❌ 畫出頭、頭髮、臉、帽子、眼鏡、耳機（遊戲會疊）。
- ❌ 頸頂不平、被領子蓋住、或脖子比 24 px 細／34 px 粗。
- ❌ 手畫出手指、或手貼在身體上看不出來。
- ❌ 3 個角度大小不一致、鞋底不在同一條線上。
- ❌ 純白的衣服／鞋子與純白背景混在一起（請用淺米白）。
- ❌ 身體太高太細的寫實比例（上身要短、腿要長、褲子要寬）。
- ❌ 圖片上有浮水印、文字說明、格線、色卡。

## 10. 交給我之前的檢查表

- [ ] 一套 3 張（正面、側面朝右、背面），同大小、腳底同一條線
- [ ] 背景透明（或純白底、衣服沒有純白）
- [ ] 沒有頭／帽子／眼鏡
- [ ] 頸頂是最高點，平切，寬度 24–34 px（H 的 14–20%）
- [ ] 褲襠在 H 的 44–48%，鞋子占 H 的 15–19%
- [ ] 手是沒有手指的拳頭，位置在 H 的 36–56%
- [ ] 輪廓線 2–3 px 暖黑、膚色 `#F8B888`
- [ ] 三個角度顏色圖案一致

交給我：**整張圖直接丟過來**，並告訴我這套是給誰穿（目前 Anna 可換兩套，其他人固定一套；如果要開放更多人換裝，也一併告訴我）。我會量每個角度的頸頂位置、重新排成遊戲用的圖集、接上頭像並檢查比例。

---

## 附錄 A：給圖片生成 AI 的提示詞（可直接貼）

使用方式：先上傳一張現有的服裝參考圖（本資料夾的 `outfit-reference.webp` 就是六套）作為「風格與比例參考」，再貼下面的提示詞，把【】裡的內容換成新服裝的描述。

```
Create a character OUTFIT SHEET in the exact same art style and proportions as the attached reference image.

Outfit: 【describe the clothes: e.g. a red varsity jacket, white crew-neck tee, black cargo pants, chunky white sneakers】

Layout: ONE ROW with THREE views side by side, in this order:
1) FRONT view  2) SIDE view facing RIGHT  3) BACK view.
All three views are the same size, aligned so that the soles of the shoes sit on the same baseline, with at least 20 px of empty space between views.

Body only — HEADLESS. Do NOT draw a head, hair, face, hat, glasses or headphones. The body ends at a short flat-cut neck stump (skin colored, #F8B888) that is the highest point of the figure.

Proportions (relative to total body height H, from top of the neck to the sole):
- Neck stump width ≈ 14–20% of H, visible neck height ≈ 7–16% of H, centered horizontally (in the side view slightly behind center).
- SHORT upper body, LONG legs: crotch at about 45% of H from the top; wide, loose pants.
- Hands: simple rounded mitten fists, NO fingers, about 12–17% of H wide, hanging at 36–56% of H from the top, slightly away from the torso (relaxed A-pose).
- Shoes: chunky, 15–19% of H tall, with thick soles, toes pointing forward (front), to the right (side).
- Front/back width including arms ≈ 90–104% of H; side width ≈ 54–66% of H.

Style: bold dark warm-black outline (#302828) about 12% of H thick, flat cel-shading with one soft shadow tone and small highlights, light from the upper left, no gradients, no textures. Cute chibi-like proportions identical to the reference. Simple, bold-color graphics on the clothes (no tiny details).

The three views must show the SAME outfit consistently (same colors, graphics, lengths, pocket positions). The back view must show a plausible back of the garment.

Background: fully transparent. If transparency is not possible, use a flat pure white background and do not use pure white anywhere on the clothes (use off-white #F4EFE6 instead).

No text, watermark, grid lines, labels or color swatches in the image.
```

### 只有關鍵字、沒有參考圖時

把上面「Outfit:」那一行換成關鍵字就可以，例如：`Outfit: streetwear, oversized orange hoodie, light-wash baggy jeans, black high-top sneakers`。其餘不用改。**建議仍然附上一張現有的服裝圖當比例參考**，不附的話比例（尤其是上身／腿長比、脖子粗細）會偏掉。

### 生成之後常見的修正

| 問題 | 怎麼修 |
|---|---|
| 畫出了頭或脖子被衣領蓋住 | 提示詞加：`The neck stump must be fully visible above the collar; no head.` |
| 腿太短、像正常人比例 | 加：`Make the legs twice as long as the torso; the torso from neck to crotch is shorter than the legs.` |
| 側面朝左 | 加：`The side view must face to the RIGHT.` |
| 三個角度大小不一 | 加：`All three views have exactly the same height and the same baseline.` |
| 手有手指 | 加：`Hands are plain rounded mitts with no fingers.` |

## 附錄 B：數值怎麼量的（給維護者）

參考圖 `600 × 1176`，6 列 × 3 欄，每列約 196 px 高。每個格子取不透明像素的外框：身體高 164–171 px、正面寬 152–175 px、側面寬 90–111 px。膚色連通區（頸、手）用 RGB 範圍偵測：脖子 24–34 × 12–27 px、手 20–29 × 22–26 px。褲襠取「由上往下第一個連續出現兩條腿」的列：y 73–80。鞋高是看畫面估的（約 26–32 px），所以那一項的誤差比較大；其餘數值都是量出來的。若之後新增的服裝跟這些數值差太多，以現有遊戲畫面看起來和諧為準，再回來更新這份規範。

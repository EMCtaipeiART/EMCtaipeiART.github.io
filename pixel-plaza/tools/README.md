# 新人物自動補走路／跑步影格

角色工坊（emc-ai-stage-classifier）發佈新人物或換新服裝後，雲端版本號會變。這裡的工具比對版本號，落後的人物用 Codex 畫走路表，處理成 12 視角圖集後上線。跑步沿用走路影格加速，不需另外生成。

## 檔案
- `../walk-manifest.json`：人物 → 已做走路影格時的雲端版本。網站啟動時讀它，名單內的人就會用 `sprites-walk*/名字` 走路。
- `walk-check.mjs`：只檢查，不花 AI。輸出落後清單 JSON，沒有就是 `[]`。
- `walk-make.mjs <名字> <版本>`：下載站姿圖 → Codex 畫 7x2 走路表 → 去背對位 → 寫入 `sprites-walk-hd/`、`sprites-walk/` 並更新 manifest。失敗以非 0 結束且不改檔（3 下載失敗、4 Codex 沒出圖、5 自動檢查失敗、6 找不到 Chrome）。
- `walk-lib.mjs`：共用設定。`SKIP` 內的人物（廖秦葦＝聖誕樹）不處理。

## 換電腦要準備（一次性）
1. 安裝 Node 20+、Chrome、Codex CLI，並在該電腦登入 Codex（自己登入，不要貼到任何地方）。確認 `codex exec` 能用圖片生成。
2. 下載專案到專用資料夾（不要用平常有未提交檔案的資料夾），執行 `npm install`。
3. 確認 `git push origin HEAD:main` 不需要輸入帳密。
4. Chrome 不在預設位置時設環境變數 `CHROME_PATH`；想指定暫存位置設 `WALK_JOBS`（預設為系統暫存資料夾）。
5. 開著 Claude 桌面 App，建立排程（下方提示詞，把 `<專案資料夾>` 換成第 2 步的路徑）。

排程時間建議 cron：`0 10,12,14,16,18 * * 1-5`（本機時間）。

## 排程提示詞
你是 EMC 元宇宙辦公室的維護助理。任務：角色工坊若有新人物或換了新服裝，就替他們補上走路與跑步用的影格並上線。全程用繁體中文簡短回報。

規則：只在 `<專案資料夾>` 操作；不要印出或處理任何帳號密碼、token；不可 force push、不可改寫歷史；沒有新人物就立刻結束。

步驟：
1. cd `<專案資料夾>`。若 `git status --short` 有未提交變更先 `git stash`；`git fetch origin` 後 `git checkout --detach origin/main`。
2. `node pixel-plaza/tools/walk-check.mjs`。輸出 `[]` 就回報「沒有新人物或新服裝」並結束。
3. 對每個人執行 `node pixel-plaza/tools/walk-make.mjs <name> <version>`（每人約 3–6 分鐘，timeout 600000）。非 0 結束：最多重試一次，仍失敗就 `git checkout -- pixel-plaza` 還原並記下原因。
4. 用 Read 看輸出 JSON 的 preview 圖（12 視角 x 2 排）。檢查服裝顏色與站姿一致、沒有缺手腳／裁切、沒有洋紅殘邊、方向合理、兩排腳步不同。不合格就還原並只重試一次。
5. 至少一位通過：`git add pixel-plaza`，commit 訊息 `pixel-plaza: auto walk frames for <名字>`，結尾加 `Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>`，`git pull --rebase origin main` 後 `git push origin HEAD:main`。pre-push 煙霧測試失敗就回報，不可 `--no-verify`。
6. 回報哪些上線、哪些失敗；有失敗用 PushNotification 通知一句話。

GitHub Pages 約數分鐘後生效。

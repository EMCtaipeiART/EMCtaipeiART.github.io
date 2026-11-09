# 新人物自動補走路／跑步影格

角色工坊（emc-ai-stage-classifier）發佈新人物或換新服裝後，雲端版本號會變。這裡的工具比對版本號，落後的人物用 Codex 畫走路表，處理成 12 視角圖集。跑步沿用走路影格加速，不需另外生成。

## 流程（GitHub Actions：`.github/workflows/walk-frames.yml`）
1. **檢查（雲端，免費）**：每 30 分鐘、手動執行、或收到 `character-published` 請求時，跑 `walk-check.mjs --ci`。沒有新人物就結束。
2. **製作（公司電腦的自架執行器）**：有新人物才交給標籤為 `self-hosted, macOS, walk` 的執行器，跑 `walk-make.mjs`（下載站姿圖 → Codex 畫走路表 → 去背對位 → 自動檢查）。
3. **待審分支**：成品只推到 `walk-pending/<名字>-v<版本>`，**不會上線**。
4. **人工把關**：請 Claude「看一下待審的走路影格」。Claude 取出分支裡 `pixel-plaza/sprites-walk-hd/<名字>.png` 目視檢查（服裝顏色與站姿一致、沒缺手腳或裁切、沒有洋紅殘邊、前後左右方向合理、兩排腳步不同），沒問題才把這三個檔案和 `walk-manifest.json` 合併進 main 並推送，再刪待審分支。不合格就刪分支，下一輪會重做（或請 Claude 手動調整）。

## 檔案
- `../walk-manifest.json`：人物 → 已做走路影格時的雲端版本。網站啟動時讀它，名單內的人就會用 `sprites-walk*/名字` 走路。
- `walk-check.mjs`：只檢查，不花 AI。`--ci` 會略過名字不安全的、以及待審分支已存在的。
- `walk-make.mjs <名字> <版本>`：失敗以非 0 結束且不改檔（3 下載失敗、4 Codex 沒出圖、5 自動檢查失敗、6 找不到 Chrome）。
- `walk-lib.mjs`：共用設定。`SKIP` 內的人物（廖秦葦＝聖誕樹）不處理。

## 公司電腦設定（一次性，macOS）
1. 安裝 Node 20+、Git、Google Chrome、Codex CLI（Homebrew 或官方安裝），並用**平常使用的 Mac 使用者帳號**登入 Codex（自己登入，不要貼到任何地方）。確認 `codex exec` 能用圖片生成。
2. 在 GitHub 專案 Settings → Actions → Runners → New self-hosted runner，系統選 **macOS**、架構依機型（Apple 晶片選 ARM64，Intel 選 x64），照頁面指示下載並用頁面上的一次性註冊碼設定（`./config.sh`）。**額外標籤填 `walk`**。
3. 執行器要用**同一個 Mac 帳號**執行（Codex 登入是帳號專屬）：先用 `./run.sh` 手動試跑；要常駐就 `./svc.sh install` 後 `./svc.sh start`（登入使用者的啟動項，Mac 要登入、不睡眠才會接工作）。
4. GitHub 專案 Settings → Actions → General：外部協作者的 workflow 一律要核准（專案是公開的，自架執行器不可對外部提交的修改請求啟動；本流程只由 schedule／手動／dispatch 觸發）。
5. Chrome 不在 `/Applications/Google Chrome.app` 時設環境變數 `CHROME_PATH`；想指定暫存位置設 `WALK_JOBS`。
6. 讓 Mac 在工作時不睡眠（系統設定 → 電池／節能，或 `caffeinate`）；睡著時工作會排隊，醒來後才處理。

## 想改成「發佈當下立即處理」
讓角色工坊後端在發佈完成後呼叫 GitHub `POST /repos/EMCtaipeiART/EMCtaipeiART.github.io/dispatches`，body `{"event_type":"character-published"}`（需一組只有這個專案 contents 權限的 token，放在後端 secret）。不加也行，最慢 30 分鐘內會被排程撿到。

## 2026-11-09 改成「本機算圖工作者」（取代每 30 分鐘排程）
角色工坊（emc-ai-stage-classifier）建立角色時，**8 個角度**與**走路／跑步影格**改由 Machi 的 iMac 用 Codex 做（免 API 費用）。電腦沒開機就自動退回原本的雲端 API 算圖（8 角度）；走路影格不急，排隊等電腦開機。
- 工作者：`local-worker.mjs`（常駐，launchd：`~/Library/LaunchAgents/com.emc.local-worker.plist`，記錄 `~/.emc-local-worker/worker.log`）。每 20 秒向角色工坊打心跳並領單；超過 2 分鐘沒心跳＝沒開機。
- 金鑰：`~/.emc-local-worker/key`（600 權限，不進 Git），與 Worker 秘密 `LOCAL_WORKER_KEY` 相同。換電腦：複製這份 key、把 plist 裝到新電腦、確認 Codex 已登入即可。
- 流程：三視圖對位確認 → 角色工坊把 grid 任務排進佇列（電腦在線）→ iMac 領單、Codex 畫 4×2 合圖（洋紅背景）→ `chroma.py` 去背與檢查 → 上傳 → 前端自動接續到檢查畫面 → 使用者「確認上線」後排入 walk 任務 → iMac 跑 `walk-make.mjs`（`WALK_OUT_DIR` 模式，不動專案檔）→ 上傳到雲端 `charpub/<名字>/walk(-hd).png`；3D 辦公室讀 `characters` API 的 `walks` 版本表，雲端走路影格優先於專案裡的靜態檔。
- 進度軸：前端 `Timeline`（character-workshop.tsx）顯示 5 個步驟、各步驟剩餘時間（預估值由後端記錄實際耗時的移動平均）。
- 重新啟動／停止：`launchctl unload|load ~/Library/LaunchAgents/com.emc.local-worker.plist`。

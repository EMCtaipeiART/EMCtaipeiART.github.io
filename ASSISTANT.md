# 小黃（設計部代班小幫手）｜完整維護手冊

> 給在任何一台電腦上接手的人或 Claude。這份講**小黃整套機制**：做什麼、程式在哪、資料存哪、怎麼改、怎麼部署、踩過的坑。
> 逐次修改歷程看 `MAINTENANCE_LOG.md` 檔尾（2026-11-19 起的「小黃」系列）；通用規則看 `CLAUDE.md`。**不要把任何金鑰寫進檔案。**

## 1. 小黃是誰

- 右下角的對話小幫手，**只有登入後才會出現**。角色設定：小黃**不是常駐機器人**，他最近剛失業，暫時代替設計部做系統解答；之後會因為熱門話題或時事換成別的角色。
- 能做的事：每日招呼、案量查詢、案件追蹤（依登入者可見範圍過濾）、介紹系統功能、回報最近的系統更動、問答與回饋記錄、管理者用量追蹤。
- 滑鼠移上去（桌機）會彈出小氣泡：自我介紹、最新公告、系統更新、設計新聞、科技新聞、功能小提示——**這些全是現成內容，不呼叫 Claude、不花 token**。
- 前台一律不提「管理者看得到紀錄」；但被問到會不會記錄，要如實回答「會記錄下來，用來改善系統」。

## 2. 檔案地圖

| 位置 | 內容 |
| --- | --- |
| `site.js`（檔尾 `asHelper`） | 前台全部邏輯：`ASSISTANT_CHARACTER`（角色設定）、`FACE`（頭像圖層）、浮動按鈕與聊天視窗、滑過氣泡 `hello`、捲動特效、管理者「用量」按鈕 |
| `site.css`（檔尾「小幫手」區塊） | 毛玻璃視窗、浮動按鈕、眨眼 `.as-lid`、張嘴 `.as-mouth`（位置用 `--lid-*`／`--mouth-*` CSS 變數）、氣泡 `.as-hello` |
| `assets/xiaohuang.webp` | 小黃頭像（192px、透明背景） |
| `worker/src/assistant.ts` | 核心：`ASSISTANT_CHARACTER`、system prompt、工具定義與執行、額度、問答紀錄、Claude API 呼叫、管理者報表 |
| `worker/src/assistant-knowledge.ts` | **內建系統知識庫**（13 個主題）＋滑過氣泡用的 `FEATURE_TIPS` |
| `worker/src/assistant-knowledge-pages.ts` | **實際走訪網站後補寫的功能說明**（午餐地圖、短網址、行事曆、作品牆、記事本、專案分配、進度、問題回報、專案看板、儀表板、角色工坊畫面、多元宇宙操作說明、團購站、選單總覽）；與 `assistant-knowledge.ts` 同 id 的主題取代內建內容 |
| `worker/src/assistant-news.ts` | 新聞話題（Google News RSS，每 3 小時快取） |
| `worker/src/assistant-changes.ts` | **自動讀 GitHub 更動**（`MAINTENANCE_LOG.md` 檔尾＋最近 commit，每 30 分鐘快取） |
| `worker/src/database-coordinator.ts` | 只做分派：`assistantToday`／`assistantChat`／`assistantFeedback`／`assistantTicker`／`assistantUsage`／`assistantLogs`／`runAssistantCleanup`／`githubSource()` |
| `worker/src/index.ts` | 每分鐘 Cron 呼叫 `runAssistantCleanup`（內部一天只清一次） |
| `json_database_admin.html` | 後台「問題回報 › 小黃（機器人）」追蹤頁（`showAssistant`／`renderAssistant`） |
| `worker/test/assistant.test.ts`、`assistant-changes.test.ts`、`index.test.ts`（assistant 區塊） | 測試 |

## 3. 後端 action（都在 Worker `https://machi-design-api.machi-chen.workers.dev/api`）

| action | 權限 | 說明 |
| --- | --- | --- |
| `assistantToday` | 登入 | 不呼叫 AI、不扣額度；回今日待辦、未讀公告、額度狀態 |
| `assistantChat` | 登入 | 額度 → Claude（最多 3 輪工具）→ 記錄；沒金鑰回 `skipped:true`「還在準備中」 |
| `assistantFeedback` | 登入 | 對某筆問答按「有幫助／沒幫助」 |
| `assistantTicker` | 登入 | 滑過氣泡資料：新聞、功能小提示、最近更新標題（不花 token） |
| `assistantUsage` | `database.manage` | 近 N 天用量（每日、每人、回饋次數）；**不含問答內容** |
| `assistantLogs` | `database.manage` | 近 N 天完整問答（含問題與回答） |
| `assistantGaps` | `database.manage` | 小黃答不出來、已記錄回報的問題清單（待補／已處理） |
| `assistantGapUpdate` | `database.manage` | 把某筆待補問題標為已處理（可附備註）或重新開啟 |

## 4. Claude 的工具（模型只能透過這些拿資料）

| 工具 | 資料來源 | 用途 |
| --- | --- | --- |
| `getCaseCounts` | 已載入的案件資料 | 案量（今日／本週／本月，可依客戶別或設計師分組）；團隊總數不過濾 |
| `findCase` | 同上，**依登入者可見範圍過濾** | 找案件（最多 3 筆） |
| `getMyToday` | 同上 | 待回信（專案負責人且過稿中）、3 天內截稿、今天新進 |
| `getSystemHelp` | `assistant-knowledge.ts` | 系統功能說明（system prompt 只放主題目錄，細節按需取回以省 token） |
| `getRecentUpdates` | 後台「系統公告欄」最近 5 則已啟用公告 | 管理者發公告即生效 |
| `reportUnanswered` | 寫進 DO storage `assistantGaps` | **答不出來、查不到或沒把握時呼叫**：把使用者原本的問題記錄下來（同一題合併計次）回報給管理者；小黃告訴使用者「這題我還不會，已經記下來回報給管理者，之後會補上」，**絕不叫人去問 Machi 或任何特定的人** |
| `getRecentChanges` | **GitHub**：`MAINTENANCE_LOG.md` 檔尾 8 段＋最近 commit 標題（略過 `data:`／merge） | 不必發公告就知道最近改了什麼；公告與內建說明衝突時以公告為準，GitHub 紀錄最即時 |

可見範圍過濾（`canViewCase`）是把前台 `canViewCustomerCases`＋`ownerMatches` 移植到後端；**前台規則改了要一併改這份**。

## 5. 資料存哪（Durable Object storage，不是 JSON 快照）

> 寫進 JSON 快照會產生 GitHub commit，所以小黃的紀錄與額度**絕對不要**存進快照。

| key | 內容 | 保留 |
| --- | --- | --- |
| `assistantUsage:<台灣日期>:<帳號>` | 當天累計 tokens（上限 `ASSISTANT_DAILY_TOKENS`＝30000） | 180 天 |
| `assistantLog:<台灣日期>`（超過 2000 筆分片 `…:<序號>`） | 問答紀錄：問題、回答、工具、是否查到、tokens、回饋、是否累了 | 180 天 |
| `assistantNews` | 新聞標題快取（3 小時） | 覆寫 |
| `assistantChanges` | GitHub 更動快取（30 分鐘） | 覆寫 |
| `assistantGaps` | 答不出來的問題（最多 300 筆；同一題合併 `count`／`askers`；`status` open／done＋管理者備註） | 手動處理 |
| `assistantLogCleanupDate` | 清理排程用，一天只跑一次 | — |

額度：用完不呼叫 API，隨機回 4 句「累了」台詞並停用輸入框；用量跨過 80% 時回覆後附一次電量提醒。

## 5.5 答不出來的問題 → 回報管理者

- 小黃查不到、沒把握時呼叫 `reportUnanswered`，問題進 `assistantGaps`；後台「問題回報 › 小黃（機器人）」最上方有「待補的問題」卡與清單（待補／已處理／全部），補完按「標為已處理」並可留備註。
- 管理者補資料的方式：發系統公告（立即）、或更新 `assistant-knowledge*.ts` 並部署（長期）。
- 小黃對使用者不主動提紀錄，也不會提到管理者看得到什麼；但回答時會說「已經記下來回報給管理者」。

## 5.6 個人設定：關閉小黃

- 帳號選單 › 個人設定 › 「顯示右下角小幫手（小黃）」，預設開啟；關閉後右下角不再出現小黃與氣泡。
- 存放：本機 `localStorage` `assistantEnabledV1:<帳號>`（立即生效）＋雲端個人設定（`設定` 表新欄位「小幫手」，空白＝開、「關」＝關；`getUserSettings` 回 `assistantEnabled`、`saveUserSettings` 接 `assistantEnabled`），換裝置也同步。

## 6. 讓小黃知道系統改了什麼（四條路，由即時到長期）

1. **自動（不必做任何事）**：每次 push 到 `main` 後，只要 `MAINTENANCE_LOG.md` 有新段落或 commit 有新標題，30 分鐘內小黃就能透過 `getRecentChanges` 回答「最近改了什麼」，滑過氣泡也會輪流顯示「系統更新」。**所以每次修改都要照規矩在 `MAINTENANCE_LOG.md` 檔尾記一段，寫給人看得懂的話。**
2. **系統公告**：管理者在後台發公告，立即生效（`getRecentUpdates`），也會出現在首頁提示條與氣泡。
3. **內建知識庫**：長期成立的規則、入口、玩法，要改 `assistant-knowledge.ts` 並 `wrangler deploy`。
4. **（未做）後台「教小黃」**：讓管理者在後台直接補說明條目，不用部署。需要再做。

## 7. 常見修改怎麼做

- **換角色**（小黃之後會被換掉）：①前台 `site.js` 的 `ASSISTANT_CHARACTER`（名字、副標、頭像 `img`、自我介紹 `intro`、臉部圖層 `vars`）②`worker/src/assistant.ts` 的 `ASSISTANT_CHARACTER`（名字、外型、背景設定，system prompt 由它組出）③換 `assets/` 的頭像圖。眼皮／嘴的位置用 CSS 變數對位：`--lid-top／--lid-h／--lid-w／--lid-l／--lid-r／--lid-color／--mouth-l／--mouth-t／--mouth-w／--mouth-h`（百分比，相對頭像）。表情若改用 Codex 補畫的閉眼／張嘴圖，只要換 `FACE` 的內容。
- **改人設或回答規則**：`worker/src/assistant.ts` 的 `ASSISTANT_SYSTEM_PROMPT`，再部署 Worker。
- **改額度**：`ASSISTANT_DAILY_TOKENS`；**改模型**：`ASSISTANT_MODEL`（目前 `claude-haiku-5-5`）。
- **改新聞來源或過濾**：`assistant-news.ts` 的 `NEWS_FEEDS`、`UNSAFE`、`DESIGN_WORDS`。Google News RSS 條款限個人非商業用途，長期建議改接正式新聞 API。
- **改滑過氣泡內容**：`site.js` 的 `HELLO_TIPS`（前台備援）與 `assistant-knowledge.ts` 的 `FEATURE_TIPS`（後端提供，優先）。

## 8. 部署與驗證

- **前台**：從 `origin/main` 開臨時 worktree（見 `CLAUDE.md`），改完 `node tools/stamp.cjs`（更新 `index.html` 的 `site.js?v=`／`site.css?v=` 雜湊，**只認 16 進位**）、commit、`git push origin HEAD:main`；push 前會自動跑瀏覽器煙霧測試。
- **Worker**：`cd worker && node node_modules/wrangler/bin/wrangler.js deploy`（電腦上沒有全域 `wrangler`，用專案內的；要先 `wrangler login`，可用 `…wrangler.js whoami` 確認）。**不要在停在別的分支的資料夾部署**，會把舊程式佈上去——用 `origin/main` 的乾淨 worktree。
- **金鑰**：`ANTHROPIC_API_KEY` 是 Worker secret，只需設定一次（`…wrangler.js secret put ANTHROPIC_API_KEY`，`secret list` 可確認）；換電腦或重新部署**不必**重設。
- **部署後要等約 1～2 分鐘**新版才會全面生效（Durable Object 換版有延遲）；用 `curl` 打一個新 action，從「Unknown action」變成「請先登入後再執行此操作」就代表生效。
- **測試**：`cd worker && node node_modules/vitest/vitest.mjs run test/assistant.test.ts test/assistant-changes.test.ts`；整套 `index.test.ts` 有幾個 Pixel Office 時間相關測試不穩定（改動前就有，每次失敗數不同），小黃的測試是穩定的。`node node_modules/typescript/bin/tsc --noEmit` 目前只會有 `index.test.ts` 4330 行附近既有的 3 個錯誤。前台 `npm test` 比較「前後失敗清單」（約 34 個既有失敗）。
- **畫面驗證**：headless Chrome（`puppeteer-core`，`C:/Program Files/Google/Chrome/Application/chrome.exe`）起靜態伺服器；**攔截所有對真實後端的請求並用模擬資料回應**（只放行讀取），登入用 localStorage 的 `designRequestEditorToken／User／DisplayName／Account` 並設 `designRequestApiUrl` 指向被攔截的 workers.dev 位址。

## 9. 踩過的坑

- 新 action 部署後一開始會回「Unknown action」是正常的（見上）。
- 在**停在其他分支的主目錄**部署 Worker，會漏掉新程式；一律用乾淨 worktree。
- `index.html` 的 `site.js?v=` 曾是非 16 進位的 `fullscreen1`，導致 `tools/stamp.cjs` 認不得、前台沒帶雜湊；已修，別再手寫非 16 進位版本字串。
- Bash heredoc／Python 在這台 Windows 環境不可靠（`python` 只是 Store 的空殼）：改檔用 Node 腳本，字串取代用函式 `()=>` 避免 `$&`，並先看檔案是 CRLF 還是 LF。
- 頭像要透明背景：從四邊洪水填色去白底（`xiaohuang.webp` 已處理）；浮動按鈕不要再加白色圓底或外環。
- 眨眼／張嘴是疊在頭像上的 CSS 圖層，位置對照原圖 1254px 校準；不同臉型要重新調 vars。

## 10. 還沒做、可以做的

- 後台「教小黃」（見第 6 節第 4 條）。
- 換成 Codex 畫的真正閉眼／張嘴圖。
- 新聞改接正式 API；滑過氣泡針對手機（無 hover）的替代入口。
- 小黃紀錄的自動備份（目前只存在 Durable Object）。

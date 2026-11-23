# 小黃（設計部代班小幫手）｜完整維護手冊

> 給在任何一台電腦上接手的人或 Claude。這份講**小黃整套機制**：做什麼、程式在哪、資料存哪、怎麼改、怎麼部署、踩過的坑。
> 逐次修改歷程看 `MAINTENANCE_LOG.md` 檔尾（2026-11-19 起的「小黃」系列）；通用規則看 `CLAUDE.md`。**不要把任何金鑰寫進檔案。**

## 1. 小黃是誰

- 右下角的對話小幫手，**只有登入後才會出現**。角色設定：小黃**不是常駐機器人**，他最近剛失業，暫時代替設計部做系統解答；之後會因為熱門話題或時事換成別的角色。
- 能做的事：每日招呼、案量查詢、案件追蹤（依登入者可見範圍過濾）、介紹系統功能、回報最近的系統更動、問答與回饋記錄、管理者用量追蹤。
- 滑鼠移上去（桌機）會彈出小氣泡：自我介紹、最新公告、系統更新、設計新聞、科技新聞、功能小提示——**這些全是現成內容，不呼叫 Claude、不花 token**。
- **NEW 標籤**：頭像左上角的小標籤＝**這是新上架的角色**。上架日起 14 天內、這位同事還沒點開過聊天視窗時顯示並每 7 秒閃動一下；點開就記下（`assistantMetV1:<帳號>`）；**換新角色（新 `id`）所有人再看一次**；電量用完或關閉小幫手時不顯示。
- **主動彈出**：不必滑過去，載入約 9 秒後與之後每 9 分鐘，有新的公告／設計新聞／系統更新／科技新聞時小黃會自己彈出氣泡（同一則只彈一次、每天最多 6 次、聊天視窗開著或捲動中不彈、手機也會彈），氣泡右上 × 可關閉。
- 前台一律不提「管理者看得到紀錄」；但被問到會不會記錄，要如實回答「會記錄下來，用來改善系統」。
- **內部實作細節（寫死、常數、快取、prompt、NEW 標籤做法等）同樣不呈現**，標題避開這些字。
- **後台與管理者專屬的內容不呈現、不說明**（使用者指定）：更新紀錄過濾在 `assistant-changes.ts` 的 `ADMIN_ONLY`，知識庫只寫一般同仁用得到的說明，prompt 也有明文規則。**2026-11-20 起改為白名單：只有標題帶「【同仁】」的 `MAINTENANCE_LOG.md` 段落（與 commit 標題）才會當成「系統更新」；沒標記一律不說，關鍵字過濾只是第二層保險。**（關鍵字也包含「小黃、小幫手、泡泡、氣泡、新聞、額度、電池」等小黃自己的機制，這類屬管理者層面，不對同仁呈現。）

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
| `assistantNotes`／`assistantNoteSave`／`assistantNoteDelete` | `database.manage` | **教小黃**：列出、新增或更新（帶 `gapId` 會順便結案）、刪除管理者補充的說明 |
| `assistantTrial` | `database.manage` | **試問**：照正常流程回答，但不寫紀錄、不計用量、不新增待補問題；回傳用到的工具與 tokens |

## 4. Claude 的工具（模型只能透過這些拿資料）

| 工具 | 資料來源 | 用途 |
| --- | --- | --- |
| `getCaseCounts` | 目前資料庫＋**歷史資料庫**（`data/database_archive.json`，2023 年起） | 案量（今日／本週／本月，或用 `year`／`month` 查任一年月，可依客戶別、設計師或月份分組）；團隊總數不過濾 |
| `findCase` | 同上（含歷史），**依登入者可見範圍過濾** | 找案件（最多 3 筆，標註來源） |
| `getMyToday` | 同上 | 待回信（專案負責人且過稿中）、3 天內截稿、今天新進 |
| `getDuty` | `dutyWho`（輪值表＋手動替換）、`duty.ts` 的雙週會日期 | 值日生與雙週會 |
| `getCalendar` | `designCalendarCore`（Google 行事曆＋人資假單，公開資料，**不做設計部限定的權限檢查**） | 設計師的會議、請假、出差；who=me 查自己 |
| `getSystemHelp` | `assistant-knowledge.ts` | 系統功能說明（system prompt 只放主題目錄，細節按需取回以省 token） |
| `getRecentUpdates` | 後台「系統公告欄」最近 5 則已啟用公告 | 管理者發公告即生效 |
| `reportUnanswered` | 寫進 DO storage `assistantGaps` | **答不出來、查不到或沒把握時呼叫**：把使用者原本的問題記錄下來（同一題合併計次）回報給管理者；小黃告訴使用者「這題我還不會，已經記下來回報給管理者，之後會補上」，**絕不叫人去問 Machi 或任何特定的人** |
| `getRecentChanges` | **GitHub**：`MAINTENANCE_LOG.md` 檔尾 8 段＋最近 commit 標題（略過 `data:`／merge） | 不必發公告就知道最近改了什麼；公告與內建說明衝突時以公告為準，GitHub 紀錄最即時 |

**行事曆分類**：後端的 `kind` 只認「休假、特休、請假…」字樣與人資假單，漏掉「Leona假」「(外出) …」這類寫法，所以 `assistant-calendar.ts` 的 `classifyEvent` 依標題再分類（請假／出差、外出、其他），`getCalendar` 的 `kind=away`（請假＋出差＋外出）用來回答「誰不在公司」；外出靠標題字眼判斷，請同事沿用「(外出) …」寫法。

**日期規則**：每次請求的 system 第二段會帶「現在是台灣時間…、這週＝週一到週日」（`todayLine()`，不進快取區塊）；查行事曆的「這週／下週／上週」請用 `getCalendar` 的 `week`（含已過去的日子），不要靠模型自己算日期。

可見範圍過濾（`canViewCase`）是把前台 `canViewCustomerCases`＋`ownerMatches` 移植到後端；**前台規則改了要一併改這份**。

## 5. 資料存哪（Durable Object storage，不是 JSON 快照）

> 寫進 JSON 快照會產生 GitHub commit，所以小黃的紀錄與額度**絕對不要**存進快照。

| key | 內容 | 保留 |
| --- | --- | --- |
| `assistantUsage:<台灣日期>:<帳號>` | 當天累計 tokens（上限 `ASSISTANT_DAILY_TOKENS`＝30000） | 180 天 |
| `assistantLog:<台灣日期>`（超過 2000 筆分片 `…:<序號>`） | 問答紀錄：問題、回答、工具、是否查到、tokens、回饋、是否累了 | 180 天 |
| `assistantNews` | 新聞標題快取（3 小時） | 覆寫 |
| `assistantChanges` | GitHub 更動快取（30 分鐘） | 覆寫 |
| （記憶體）歷史資料庫快取 | `assistant-history.ts` 的模組變數，1 小時；不存 storage | Worker／DO 重啟即清空 |
| `assistantNotes` | **教小黃**的補充說明（最多 200 條：標題、答案、關鍵字、啟用、建立／修改者與時間、來源 gapId） | 手動管理 |
| `assistantGaps` | 答不出來的問題（最多 300 筆；同一題合併 `count`／`askers`；`status` open／done＋管理者備註） | 手動處理 |
| `assistantLogCleanupDate` | 清理排程用，一天只跑一次 | — |

額度：用完不呼叫 API，隨機回 4 句「累了」台詞並停用輸入框；用量跨過 80% 時回覆後附一次電量提醒。**管理者（`isManager`）不受限**：不會被擋、不會累、沒有 80% 提醒，但用量照樣記錄。

**電量用完時前台的樣子**：頭像換成充電中的電池（三格依序充滿＋閃電跳動，`site.js` 的 `BATTERY`／`faceHtml()`，樣式 `.as-batt`），標題列副標「充電中…明天見」，滑過氣泡顯示「充電中」卡片；隔天重新整理恢復。

## 5.5 答不出來的問題 → 回報管理者

- 小黃查不到、沒把握時呼叫 `reportUnanswered`，問題進 `assistantGaps`；後台「問題回報 › 小黃（機器人）」最上方有「待補的問題」卡與清單（待補／已處理／全部），補完按「標為已處理」並可留備註。
- 管理者補資料的方式：發系統公告（立即）、或更新 `assistant-knowledge*.ts` 並部署（長期）。
- 小黃對使用者不主動提紀錄，也不會提到管理者看得到什麼；但回答時會說「已經記下來回報給管理者」。

- 第一次出現的新問題會同時用提問者名字寫進系統「問題回報」（`bug_report`，狀態回報中，內容開頭【小幫手自動回報】；`fileAssistantIssue`），同題再問只累計 `count`，試問不開單。

## 5.6 個人設定：關閉小黃

- 帳號選單 › 個人設定 › 「顯示右下角小幫手（小黃）」，預設開啟；關閉後右下角不再出現小黃與氣泡。
- 存放：本機 `localStorage` `assistantEnabledV1:<帳號>`（立即生效）＋雲端個人設定（`設定` 表新欄位「小幫手」，空白＝開、「關」＝關；`getUserSettings` 回 `assistantEnabled`、`saveUserSettings` 接 `assistantEnabled`），換裝置也同步。

## 6. 讓小黃知道系統改了什麼（四條路，由即時到長期）

1. **自動（不必做任何事）**：每次 push 到 `main` 後，只要 `MAINTENANCE_LOG.md` 有新段落或 commit 有新標題，30 分鐘內小黃就能透過 `getRecentChanges` 回答「最近改了什麼」，滑過氣泡也會輪流顯示「系統更新」。**所以每次修改都要照規矩在 `MAINTENANCE_LOG.md` 檔尾記一段，寫給人看得懂的話。**
2. **系統公告**：管理者在後台發公告，立即生效（`getRecentUpdates`），也會出現在首頁提示條與氣泡。
3. **內建知識庫**：長期成立的規則、入口、玩法，要改 `assistant-knowledge.ts` 並 `wrangler deploy`。
4. **後台「教小黃」**（已做）：後台「問題回報 › 小黃（機器人）› 教小黃」新增／編輯補充，存好立刻生效；`getSystemHelp` 會先查補充再查內建說明。同一頁有**試問框**可立刻看小黃現在怎麼回答。小黃答不出來的問題可按「回答這題」直接補。

## 7. 常見修改怎麼做

- **換角色（新角色上架）**：①Worker 的 `worker/src/assistant-character.ts` 與前台 `site.js` 的 `ASSISTANT_CHARACTER` **同步**改：新 `id`（NEW 標籤靠它）、`launched`（上架日）、`name`、`look`／`backstory`（只在 Worker）、`sub`／`intro`／`img`／`vars`（只在前台）；提示詞、知識庫、更新紀錄過濾、個人設定的開關文字都會自動用新名字；②換 `assets/` 的頭像圖（透明背景）；眼皮／嘴用 CSS 變數 `--lid-*`／`--mouth-*` 對位，表情若改用 Codex 補畫的閉眼／張嘴圖，只要換 `FACE` 的內容；③部署 Worker、推前台；④用後台「試問」問「你是誰」「可以把你關閉嗎」確認新角色答得出來。後台頁面的稱呼是通用的「小幫手」，不用改。
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

- 換成 Codex 畫的真正閉眼／張嘴圖。
- 新聞改接正式 API；滑過氣泡針對手機（無 hover）的替代入口。
- 小黃紀錄的自動備份（目前只存在 Durable Object）。


## 已封存的角色（可召回）
- 小黃：`assistant-characters/xiaohuang.json`（設定）＋`assistant-characters/xiaohuang.webp`（頭像）。召回步驟寫在 json 的「說明」。
- 2026-11-23 起上架的是「小劉」（`assets/xiaoliu.webp`，眼皮／嘴的位置已用 `vars` 對位）。

- 2026-11-23 起同時上架「小劉」「小蘇」，前台隨機抽一位（sessionStorage 記住），清單見 `ASSISTANT_CHARACTERS`（worker 與 site.js 各一份，要同步）。

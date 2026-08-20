# 設計需求系統維護紀錄

這份文件用來記錄系統欄位綁定、修改規則、容易互相影響的功能，以及每次修改後必須檢查的項目。之後任何功能調整都先看這份文件，再補上新的紀錄。

## 2026-08-20｜案件回信改由目前帳號本人寄出

- 根因是 Worker 為了強制沿用原 Gmail thread ID，回信時一律使用案件「Gmail寄件帳號」的 token 代寄，造成設計師操作時仍顯示為原寄件人；收件人建議也錯用原寄件人當作自己，可導致自寄。
- 信件串歷史仍由原寄件帳號讀取；即時回信與排程回信改由目前登入帳號自己連接的 Gmail token 送出。跨帳號時不傳送屬於原信箱的 thread ID，改以 `In-Reply-To`、`References` 與相同主旨維持回覆關聯。
- 回覆全部的預設收件人／副本改以「這次實際回信者」排除自己；前台回信編輯器的寄件人也改顯示該帳號實際連接的 Gmail address，不再顯示原信件串擁有者。
- 前端版本：`20260820-gmail-reply-sender-116`；Worker 版本：`cloudflare-worker-gmail-reply-sender-2026-08-20-5`。
- 驗收：Node 37/37、Worker 40/40、Worker 型別檢查、部署預演、前端內嵌程式語法與 `git diff --check` 通過。
- 正式部署：Cloudflare Worker Version ID `62f8ac2d-b23f-4c19-a62a-720f92dece39`。

## 2026-08-20｜系統公告已讀紀錄與後台開關

- `系統公告欄` 新增 `已讀紀錄` JSON 欄位；每則公告依登入帳號去重，保存帳號、顯示名稱與首次已讀時間。
- 前台登入使用者以關閉、「知道了」、Escape 或點擊遮罩結束公告時，會呼叫 `markSystemAnnouncementRead`；未登入訪客可閱讀但不列入帳號統計。
- 資料庫後台的公告卡片顯示唯一已讀帳號數，可展開姓名／帳號／已讀時間，並新增直接開啟或關閉公告的按鈕。
- 編輯公告與開關狀態時必須保留 `已讀紀錄`；公開 `getSystemAnnouncement` API 不回傳已讀名單，只有具資料庫管理權限的後台能查看。
- 驗收：Node 35/35、Worker 38/38 與 Worker 型別檢查通過。

## 2026-08-20｜系統公告欄與 v4.7 首頁公告

- 新增 `系統公告欄` JSON 資料表，欄位為公告版本、標題、內容、啟用狀態、發布／更新時間與更新者；預設內容為 v4.7 更新公告。
- 資料庫後台新增「系統公告欄」頁籤，可新增、編輯、啟用、停用與刪除版本化公告，內容使用 Markdown。
- 首頁會透過公開 `getSystemAnnouncement` API 取得最新啟用版本並顯示彈窗；勾選「不再出現」後以公告版本寫入瀏覽器，後續新版本仍會再次顯示。
- 前台顯示版本更新為 `v4.7`，前端 build 版本為 `20260820-system-announcements-113`。
- 驗收：Node 34/34、Worker 型別檢查、前後台內嵌程式語法與本機瀏覽器彈窗／不再顯示流程通過。Worker 完整測試另被既有排程寄信 migration 4 的舊預期值擋住，與本次公告功能無關。
- 正式部署：Cloudflare Worker Version ID `277063d6-ab31-49d4-8baf-dc53bb3ab541`；正式 API 已回傳 v4.7 公告，並以正式首頁瀏覽器確認公告彈窗顯示。
- 公告視覺微調：標題列移除綠色底色，左上大聲公改為無底色獨立圖示，右上關閉按鈕改為水平／垂直置中的正圓框；v4.7 公告正文移除所有 emoji。正式 Worker Version ID `f1223a07-4fdf-4d8e-874f-380b17ae9a46`。
- 系統預設公告會在資料正規化時同步最新版 v4.7 內容，清除 Durable Object 已暫存的舊預設 emoji；只更新「更新者＝系統預設」的 v4.7，不覆蓋後台人工公告。

## 2026-08-20｜後台顯示設計師回信範本

- 回信範本實際儲存於 `backend/data/db.json` 的「設定」表，每位設計師列使用「回信範本設定」欄位保存 JSON 對應。
- 後台「設計列表」的每位設計師卡片新增「05 回信範本設定」，與「04 REELS 管理」並列；可顯示、新增、編輯與刪除。
- 儲存時由 `adminDesignerSave` 連同其他設計師設定寫回 JSON；正式 Worker 與本機 Node 後端保持相同行為。

## 2026-08-19｜Gmail 信件串隱藏 Email

- Gmail 信件串彈窗的寄件人、收件人與副件人欄位只顯示姓名，不再直接顯示 Email address。
- Email 保留在人名的標準 `title` 提示與無障礙標籤中；滑鼠停在人名上可查看，純文字畫面不會露出地址。
- 支援多人地址與含逗號的引號姓名；標頭沒有顯示名稱時，以 Email 前綴轉成可讀姓名。
- 前端版本：`20260819-gmail-thread-names-112`。

## 2026-08-19｜設計師回信範本設定

- 「設計師設定」新增「5. 回信範本設定」，每位設計師可新增多筆「項目細節 → 回信文字」對應。
- 範本以 JSON 儲存在「設定」表的「回信範本設定」欄位，由前端、Node 後端與正式 Cloudflare Worker 流程讀寫；已停用的主系統 Apps Script 不再維護此功能。
- 範本選單以「設計種類／適用階段／項目細節」顯示；同名項目若適用多個階段會合併列出，儲存鍵值仍維持項目細節文字。
- 開啟已建立 Gmail 信件串的「回信」視窗時，系統依案件「設計負責人」取得該設計師範本；「項目細節」為多選時固定使用原始順序的第一項。
- 單一設計師儲存時會保留其他未顯示設計師的現有設定，避免個人編輯時覆寫他人範本、留言或音樂。
- 驗收：Node、Worker、Worker 型別檢查、前端語法與本機瀏覽器新增、儲存、重開驗證通過。

## 2026-08-13｜資料庫連結文字與設計圖路徑顯示

- 資料庫主表的一般補充連結由黑色「...」改為黑色「前往連結」，維持另開分頁與完整網址提示。
- 「設計圖資料夾連結」（並相容「設計圖資料連結」欄名）改用獨立寬欄完整顯示 NAS 路徑；內容若是網址則完整顯示可點擊網址，不再套用短連結文字或截斷樣式。
- 前端版本：`20260813-database-link-labels-12`；純前端修改，推送後由 GitHub Pages 自動生效。

## 2026-08-13｜修改次數與初稿繳交時間回填

- 主資料表的「修改次數」改由「修改統計表」對應案件的最大修改輪次派生；「繳交時間」改由第 0 輪「初稿」紀錄的建立日期派生，不再由案件轉成「過稿中」時蓋戳。
- JSON 正規化、Worker 每次寫入與本機 Node 後端都會重新校正這兩欄；沒有初稿紀錄的舊案件保留既有繳交時間。
- 資料庫後台進站與手動重讀時會先呼叫 Worker `refreshDatabase`，強制 Durable Object 重讀 GitHub 最新 JSON，避免靜態檔已更新但畫面仍停在舊修訂版。
- 資料庫欄位順序固定為「項目細節 → 修改次數 → 狀態」；後台縮短項目細節、補充說明與連結欄，連結改以黑色「...」顯示並保留可點擊的完整網址。
- 本地資料快照已回填 615 筆修改次數、25 筆初稿繳交時間，並新增可重複執行的 `scripts/recalculate_database_modification_stats.mjs`。

## 2026-08-13｜管理照片按鈕完整寫入 JSON

- 設計師「管理圖片與 Reels」彈窗的替換頭像、替換海報、24 小時／永久／取消限時動態、刪除已選圖片均統一要求 `media.manage` 權限並回傳 JSON revision。
- 頭像與海報替換新增 `saveDesignerProfiles` JSON 寫入；刪除新增 `deleteDesignerMediaFiles`，單一交易同時清除「設定」的頭像／海報及 `reels` 引用。
- 彈窗完成後透過 `machi-designer-media-updated` 立即通知主畫面重讀，不需關閉彈窗才看到新頭像、海報或刪除結果。
- Node 後端同步開放 `media.manage` 使用 `saveDesignerProfiles`，與正式 Worker 權限合約一致。
- 驗收：Node 25/25、Worker 10/10、Worker 型別檢查、乾跑部署、HTML／Apps Script 語法與 `git diff --check` 通過；線上 Apps Script 內容已可讀到新通知事件，Worker 新 action 無 token 時正確拒絕。
- 部署：Worker 版本 `363c41d2-d17c-4f27-94a2-cfd74c04cf44`；上傳 Apps Script 原部署 ID 更新為第 48 版。

## 2026-08-13｜設計師設定與圖片管理權限共用

- 前台新增 `canAccessDesignerSettings()`，讓 `designer.settings` 與 `media.manage` 都能進入設計師設定頁，帳號選單顯示也一起改用這個判斷。
- `saveDesignerSettings()` 改成接受圖片管理權限帳號，避免只負責海報／圖片管理的人被擋在設計師設定外。
- `upload/upload.html` 在替換設計師圖片時補送 `editorToken`，讓最近上傳流程可以正確寫回。
- Worker `saveDesignerProfiles` 新增 `media.manage` 相容判斷，並補上前端與後端測試。
- 驗收：`node --test backend/test/*.test.mjs`、`pnpm test`、`pnpm check` 通過。
- 版本：`8d81f6d`。

## 2026-08-11｜帳號設定分組、排序與 REELS 整合

- 資料庫後台的可見名稱由「帳號權限」改為「帳號設定」；底層 JSON 表名仍保留 `帳號權限`，避免破壞既有 API 與權限判斷。
- 左側帳號名單依「組別」使用原生收合區塊分組；點選帳號時只替換右側編輯器，保留已展開組別、名單捲動位置與選中帳號，儲存後也不會跳回第一位。
- 喜愛設定預設收合；「預設顯示欄位與順序」支援拖曳及上下箭頭，畫面顯示即時 1、2、3… 編號，儲存時依 DOM 順序寫回設定表。
- 頭像連結與預覽移至所有帳號共用的「帳號身分」區塊；設計師區塊另外顯示該設計師的 REELS 小卡、互動數與前往 REELS 管理入口。
- 驗收：HTML 內嵌程式語法、Node 22/22 與 `git diff --check` 通過。隔離瀏覽器 QA 確認一般使用者頭像、Anna REELS 小卡、組別收合與帳號選中狀態；實際將欄位順序互換後，臨時 JSON 正確寫入 `1`、`2` 新順序。
- 版本：資料庫後台 `20260811-account-settings-10`。

## 2026-08-11｜「設定」合併「帳號權限」

- 資料庫後台不再顯示獨立「設定」頁籤；底層 `設定` 表繼續保留供前台相容，但由「帳號權限」的單一帳號編輯器統一維護個人資料、喜愛設定與權限。
- 喜愛設定改為下拉選單與複選格，包含主題、年／月／狀態／設計師篩選、區塊收合、顯示欄位與順序。
- 設計師帳號額外顯示頭像、頭像大圖、分享音樂與起始秒數、多選技能、自訂技能、對話框與新專案輪值。
- Worker 與 Node 後端新增 `adminAccountSave`，在同一個交易中更新／建立 `設定` 與 `帳號權限`，並用預期資料列防止舊畫面覆寫新資料。
- 本機 Node `/api` 現在會將 Bearer token 傳給 `verifyToken`，與正式 Worker 的驗證合約一致；另修正頭像載入失敗時，SVG 備援圖的內嵌事件語法錯誤。
- 驗收：Node 22/22、Worker 5/5、Worker 型別檢查與乾跑部署、HTML 內嵌程式與 `git diff --check` 均通過。瀏覽器以臨時資料庫實際新增設計師帳號，兩張表同時寫入、Karl 自訂技能保留，無後台 console 錯誤。
- 版本：資料庫後台 `20260811-account-profile-merge-9`、Worker `cloudflare-worker-account-profile-2026-08-11-2`、Node `json-backend-account-profile-2026-08-11-2`。

## 2026-08-11｜正式驗證全面切換 Cloudflare Worker

- 正式登入驗證、雜湊 session、即時權限、資料 API 與 GitHub JSON 寫入已切換至 `https://machi-design-api.machi-chen.workers.dev/api`；前端不再以每日 `local-admin` token 或主系統 Apps Script 作為正式驗證來源。
- Worker 使用單一 SQLite Durable Object `primary` 保存雜湊 session、快取目前 JSON／GitHub SHA，並序列化所有修改，避免多人同時提交整份 `db.json` 時互相覆蓋。
- Google id token 由 Worker 向 Google 驗證；ERP OAuth secret 已從 Apps Script Script Properties 直接轉入 Cloudflare Secret；GitHub token 與管理密碼同樣只存在 Secret。臨時轉移部署、程式與本機 OAuth 憑證均已刪除。
- 前台、資料庫後台、歷史資料庫、設計儀表板、短連結與圖片管理頁統一使用 Worker token／權限。上傳 Apps Script 仍只處理 Drive 圖片位元組，已部署版本 38，會向 Worker 驗證 `media.manage` 並同步 Reels metadata。
- 正式 QA：Worker 4/4 測試、型別與乾跑部署通過；專案 21/21 測試通過；前端與 Apps Script 語法通過。線上 ping、CORS、管理登入、session、10 表管理讀取均成功；一次性短碼新增／刪除完整測試分別提交 revision 305／306，清理後未留下測試資料。
- 實測：Worker cold ping 1.83 秒；管理登入 0.36 秒；session 驗證 0.33 秒；管理讀取 0.32 秒；含 GitHub commit 的新增／清理各約 3.06／2.95 秒。
- Worker 版本：`2de4ddd7-75e7-4c60-a787-149851e66048`；上傳 Apps Script 版本：38。

## 2026-08-11｜權限設定改為立即套用與背景寫入

- 權限不是瀏覽器直接修改靜態檔案；正式寫入仍由 Apps Script 驗證後，讀取 GitHub 上約 773 KB 的完整 `db.json`，再提交整份檔案。實測僅驗證與 GitHub 讀取、沒有變更的請求也需約 2.85 秒。
- 帳號權限與角色範本改為先更新目前畫面，再以單一佇列依序背景寫入 JSON；不同帳號可連續設定，同一帳號只在自己的前一筆尚未完成時鎖定，避免快速操作互相覆寫。
- 背景寫入失敗會把該帳號或角色範本還原，並顯示明確錯誤；成功後才更新 JSON 修訂版。
- 權限元件合併同時間發生的重複刷新；資料庫後台直接沿用權限驗證已下載的 JSON，不再於進站時連續下載同一份資料兩次。
- Apps Script 對內建的 Machi／管理者 session 直接判定完整管理權限，避免每次管理寫入前再抓一次整份權限 JSON。
- 帳號權限與角色範本的更新／刪除改用「帳號／角色範本」主鍵重新定位最新 JSON 資料列；即使畫面快照較舊、其他操作造成列號位移，也不會誤判為資料衝突。
- 版本：資料庫後台 `20260811-permission-background-writes-6`、權限元件 `20260811-role-templates-3`、Apps Script `permission-primary-key-2026-08-11`。
- 驗證：前端與 Apps Script 語法通過、20/20 Node 測試通過；本機以每筆延遲 3 秒的模擬 API 連續儲存兩個帳號，第二個帳號仍可立即操作、兩筆皆顯示背景寫入並依序完成，後台無 console 警告或錯誤。

## 2026-08-07｜資料庫後台開放編輯與刪除

- 對外名稱由「JSON 資料庫後台」改為「資料庫後台」，移除介面中的 JSON 字樣。
- GitHub Pages 上的管理頁不再讀取唯讀快照，改以現有管理者登入 token 直接呼叫 Apps Script 的七表管理 API。
- Apps Script 新增 `adminTables`、`adminTableRows`、`adminTableUpdate`、`adminTableDelete`，管理者可搜尋、排序、分頁、編輯與刪除；Pages 模式暫不開放新增。
- 編輯與刪除會帶入原始資料核對；若資料列在操作前已被其他人異動，後端會拒絕寫入，避免依過期列號改錯或刪錯資料。
- 版本：前端 `20260807-database-editor-89`，管理頁 `20260807-database-admin-5`，Apps Script `database-admin-editor-2026-08-07`。

## 2026-08-06｜404 短連結快速跳轉

- 建立 6 碼短連結時立即將「短碼 → 目的網址」儲存在同來源本機快取，點開剛產生的短連結不再先等 Apps Script 解析。
- 6 碼短碼的本機快取由 10 分鐘延長為 30 天；短碼本身沒有編輯目的網址的流程，因此不會因延長快取而讀到可編輯的過期值。
- 新增 `script.google.com` 與 `script.googleusercontent.com` preconnect，縮短第一次未命中快取時的 DNS／TLS 等待。
- 實測同裝置快取命中從短網址至目的頁面為 647 ms；其他裝置首次開啟仍需 GitHub Pages 與 Apps Script 網路往返，當次實測約 1.37–1.60 秒，無法在目前架構下保證首次低於一秒。
- 版本：`404.html` 為 `20260806-fast-short-redirect-2`；本次不需重新部署 Apps Script。

## 2026-08-06｜跨分頁與設計儀表板登入狀態共用

- 根因：後端編輯者 token 可保存 30 天，但前端原本只寫入單一分頁的 `sessionStorage`，並主動刪除 `localStorage` 副本；新分頁、儀表板新視窗與返回需求系統都無法取得原分頁 token。
- 已驗證的帳號資料與 token 改為同時寫入 `localStorage` 與 `sessionStorage`；新分頁優先讀取共用副本，開啟時仍會呼叫後端 `verifyToken`，不會只依賴前端儲存判定登入。
- 主動登出、token 到期或驗證失敗會同時清除兩種儲存並寫入登出標記，之後新開或重載的分頁不會恢復舊 token。
- 時效：一般 Google／ERP 帳號後端 session 為 30 天；在剩餘 15 天內成功驗證時再延長 30 天，前台可見且活動時每小時最多驗證一次。本機管理者測試帳號仍只有當日有效。
- 驗證：同來源第二分頁可直接恢復登入；儀表板返回 `index.html` 後仍為同一登入身分；前端內嵌程式語法通過。
- 版本：前端 `20260806-shared-login-session-80`；後端已有 30 天 session 機制，本次不需重新部署 Apps Script。

## 2026-08-06｜恢復設計師 upload.html 頭像與 Reels 管理

- 設計師設定的「管理照片」恢復為 `upload.html` 彈窗入口，取代主頁內的頭像與海報原生選檔控制。
- 每位設計師都可從同一彈窗上傳圖片、替換頭像或海報，並設定 24 小時或永久保留的 Reels。
- 設計師 iframe 同樣使用 `credentialless` 與 `no-referrer`；關閉彈窗後會自動重讀設計師資料與 Reels，讓新圖片立即回到主畫面。
- 驗證：隔離 iframe 已成功載入 Machi 的指定 Drive 資料夾與最近圖片，無 Google Drive 錯誤導向；上傳頁程式仍包含替換頭像、替換海報與設定限時動態控制。
- 版本：前端 `20260806-designer-upload-modal-79`；本次不需重新部署 Apps Script。

## 2026-08-06｜恢復一般帳號頭像上傳彈窗

- 一般帳號點選「設定我的頭像」時，恢復使用原本的 Apps Script 圖片上傳彈窗；設計師設定內的頭像與海報原生選檔上傳保持不變。
- 上傳 iframe 使用 `credentialless` 及 `referrerpolicy="no-referrer"`，不帶入主頁的 Google Cookie，避免 Chrome 多 Google 帳號再次觸發 Drive 錯誤導向。
- 登入 token 改放在 URL fragment，彈窗與主頁以單次 nonce 驗證上傳完成訊息；成功後自動關閉並重新讀取帳號頭像。
- 驗證：前端內嵌程式語法通過，上傳 Web App 回應 HTTP 200，無效測試 token 可正常顯示頭像上傳畫面與「登入狀態已過期」。
- 版本：前端 `20260806-avatar-modal-78`；本次不需重新部署 Apps Script。

## 2026-08-06｜Chrome 多 Google 帳號與 Apps Script 導向修正

- 根因：Apps Script Web App 不支援同一瀏覽器工作階段的 Google 多帳號；原本的 JSONP、隱藏 iframe、表單跳轉與上傳 iframe 會攜帶一般 Chrome 的 Google Cookie，因而被錯誤導向 Drive「無法開啟這個檔案」。
- 主系統所有 Apps Script GET／POST 改用 CORS 匿名 `fetch`，固定設定 `credentials: omit`、`cache: no-store`、`redirect: follow` 與 `referrerPolicy: no-referrer`；舊函式名稱保留供呼叫端相容，但不再建立 script、iframe 或跨頁表單。
- Google Sheets GViz 備援也改用不攜帶 Cookie 的 CORS fetch，解析官方 Query response，不再注入 `docs.google.com` script。
- Google、ERP、測試帳號登入驗證、token 驗證與登出全部改走匿名 API；Google 帳號選擇仍留在 `accounts.google.com`，回站後的 Apps Script 驗證不受其他已登入 Google 帳號影響。
- 一般帳號頭像改為主頁原生選檔，直接呼叫既有 `uploadUserAvatar`；設計師頭像與海報改在設計師設定內顯示 12 個原生檔案選擇器，不再開啟獨立 Apps Script 上傳頁。
- `404.html` 的新短碼與舊 `/a-d/案件編號` 解析全部改走匿名 POST，不再使用 Apps Script JSONP；已實測 Pinterest 短網址建立與實際轉址成功。
- 最新案件 API 等待時間調整為 30 秒，避免 Apps Script 冷啟動時過早顯示備援警告。
- 驗證：前端語法、案件與 Reels 載入、2 個 Reels 入口、測試帳號登入、設計師原生照片控制、短網址建立及轉址皆通過；測試頁 Console 無 Apps Script 錯誤。
- 版本：前端 `20260806-credentialless-api-77`；本次沿用後端 `public-short-links-2026-08-06`，不需重新部署 Apps Script。

## 2026-08-06｜獨立隨機短連結產生器

- `404.html` 改為短連結產生器，可貼上 `http`／`https` 長網址並建立 `/{6碼隨機英數短碼}`，不再要求 `/a/b/c/d` 子路徑或 8 碼案件編號。
- Apps Script 新增 `createShortLink` 與 `resolveShortLink` action；首次使用時自動建立「短連結」工作表，欄位為短碼、原始網址與建立時間。
- 短碼由後端產生並在 Script Lock 內檢查碰撞；解析結果加入 6 小時快取，前端另保留 10 分鐘本機快取。
- 舊有 `/a/12345678` 至 `/d/12345678` 補充資料短連結維持相容，不改動既有案件資料。
- 已檢查前端與 Apps Script 語法、後端建立／解析／網址驗證情境、桌面與 390px 手機版面，以及無效網址提示。
- 版本：後端 `public-short-links-2026-08-06`。

## 2026-08-06｜案件與修改通知保證提示一次

- 新專案建立後，對應的設計負責人會收到右上角「新案件通知」；新增修改需求後，同一位設計負責人會收到「修改需求通知」。
- 設計師填寫確認修正日後，案件的專案負責人會收到「修改完成通知」。
- 移除登入或重新整理時直接把現有通知設為提示基準的行為；只要通知仍未讀且尚未浮出過，即使登入後才同步到，也會主動提示一次。
- 新增帳號別的「右上角已提示」本機紀錄，與鈴鐺已讀紀錄分開；浮卡實際顯示後才記錄，避免背景分頁漏掉，也避免重新整理重複跳出。
- 多筆同時抵達時顯示最新一筆並標示其餘通知數量，所有同批事件都會保留在鈴鐺清單。
- 版本：前端 `20260806-notification-delivery-76`。

## 2026-08-05｜專案負責人彈窗手機版縮小與捲動固定

- 手機版彈窗改為最多約 `70dvh`、寬度最多 350px，保留四周安全邊界，不再貼滿整個畫面。
- 標題列與關閉按鈕固定在彈窗上方，只有下方列表區可以水平或垂直捲動。
- 列表加入捲動邊界限制與 iOS 慣性捲動，避免滑到邊界時把背景頁面一起帶動。
- 彈窗開啟時鎖住背景頁面，關閉、進入案件資料或點擊遮罩時恢復背景捲動；每次開啟列表都回到左上角。
- 版本：前端 `20260805-owner-modal-mobile-75`。

## 2026-08-05｜右上角通知卡混合版

- 保留原有鈴鐺未讀數量與完整通知清單，新增右上角主動浮出的通知摘要卡。
- 浮卡只提示登入後新抵達的通知，不會在登入或重新整理時把既有未讀一次展開；同批多則通知會顯示額外數量。
- 「查看」只將目前通知標為已讀並前往對應案件、限動或問題回報；「稍後」與關閉按鈕只收合浮卡，未讀仍保留在鈴鐺。
- 浮卡 9 秒後自動收合，支援案件、修改需求、修改完成、問題回報與限動分類色，並補齊手機、深色模式及減少動態效果樣式。
- 版本：前端 `20260805-notification-toast-74`。

## 2026-08-04｜深色模式信件範例按鈕

- 「設計信件範例」按鈕新增深色模式專屬背景、文字、邊框與 hover/focus 樣式，避免沿用淺色模式的高亮灰底。
- 淺色模式與其他表單按鈕不受影響。
- 版本：前端 `20260804-dark-mail-guide-73`。

## 2026-08-04｜專案負責人列表表頭改為直角

- 「專案負責人」彈窗列表的 table、thead 與 th 強制使用 `border-radius: 0`，避免全站 table 圓角規則套用到灰底表頭。
- 彈窗本體、資料列與其他表格維持原樣。
- 版本：前端 `20260804-owner-header-square-72`。

## 2026-08-04｜個人頭像恢復可運行流程

- 依使用者要求，將一般帳號「設定我的頭像」恢復至 `20260804-avatar-account-identity-62` 的可運行流程。
- 點擊後直接在頁內 modal 開啟既有 Upload Web App，使用登入帳號、token 與一次性 `closeNonce`；不再執行後續加入的主頁原生上傳、新視窗、額外 token 預驗證與 ready/error 握手。
- 設計師圖片管理與 Reels 永久可見入口不受影響。
- 版本：前端 `20260804-avatar-rollback-71`。

## 2026-08-04｜Reels 永久可見入口

- 查明正式前台、`listReels` API 與三個現有 Drive 圖片均正常；實際問題是頭像外框只代表「未讀」，播放後即移除，造成仍有 Reels 的設計師看起來像沒有內容。
- 將 Reels 狀態拆為 `has-story` 與 `has-unread-story`：只要仍有內容就保留淡綠外框，未讀內容再顯示較強綠框；播放後只會降級為已讀提示，不會讓入口消失。
- 頭像同步寫入 Reels 筆數與對應的無障礙標籤，資料背景刷新後也會立即更新。
- 版本：前端 `20260804-visible-reels-70`。

## 2026-08-04｜reels 直接圖片連結與原生一般頭像上傳

- reels 檢查：線上 `listReels` 現有 3 個 Drive 檔案均存在且可公開讀取，thumbnail、usercontent 與 file view 請求皆為 HTTP 200；問題是試算表內的 `drive.google.com/thumbnail` 入口在特定瀏覽器被導向 Drive 錯誤頁，不是檔案過期或被刪除。
- reels 修正：主系統讀取 `reels` 時會將可辨識的舊 Drive URL 批次改寫為 `https://lh3.googleusercontent.com/d/{fileId}=w1600`；前端也統一用該直接圖片網址，不再經過 Drive 頁面導向。
- reels 新增：Upload Apps Script 之後新增限時動態時，也會直接寫入 `lh3.googleusercontent.com` 連結。
- 頭像根因：使用者瀏覽器無法穩定開啟另一個 Apps Script Web App，不論 iframe 或新視窗都可被 Google 改導向 Drive 的「無法開啟檔案」頁。
- 頭像修正：一般帳號改用主頁原生選檔、圖片預覽與上傳 modal，不再開啟 Upload Web App。新增主系統 `uploadUserAvatar` API，以當前 token 驗證帳號、建立 Drive 檔案、限制 8 MB 與圖片 MIME，再寫入設定表的「頭像連結」。
- 帳號設定讀取現在會回傳 `avatar` 與「頭像連結」，上傳完成後可立即更新帳號區頭像。
- 版本：前端 `20260804-native-avatar-reels-69`，主 Apps Script `native-avatar-reels-2026-08-04`。

## 2026-08-04｜一般帳號頭像設定改用獨立視窗

- 截圖根因：當前瀏覽器將 Apps Script Web App 嵌入主頁 iframe 時，Google 外層導向被改送到 Drive 的「無法開啟這個檔案」錯誤頁；這發生在 upload HTML 執行前，無法由 iframe 內的 ready 握手修復。
- 重現：同一個線上 Upload Web App 與相同 user 參數在可正常嵌入的測試瀏覽器會顯示「我的頭像」，證實 upload 程式與部署本身可用，問題是特定瀏覽器上下文的 Google 巢狀導向。
- 修正：一般帳號改為點擊後同步開啟獨立小視窗，避開 `script.google.com` 在主頁 iframe 內的 Drive 錯誤導向；只在新視窗被瀏覽器阻擋時退回原 modal。
- 回傳：upload 頁新增對 `window.opener` 送出 ready、error 與頭像更新訊號；主頁繼續驗證 `closeNonce`，更新成功後關閉小視窗並重讀帳號頭像。
- 前端版本更新為 `20260804-avatar-popup-68`；upload Apps Script 需使用包含 `window.opener` 回傳的新版部署。

## 2026-08-04｜頭像設定即時開啟與 iframe 載入備援

- 根因：一般帳號點「設定我的頭像」時，主頁先透過 Apps Script 做一次最長 20 秒的 token 預驗證，完成後才開 modal；這與 upload 後端原有驗證重複，造成點擊後延遲。
- 開啟流程：移除主頁預驗證，改為點擊後立即使用現有 session 的帳號與 token 開啟 modal；實際權限仍由 upload Apps Script 後端驗證。
- 載入備援：除 `machi-upload-ready` 訊號外，iframe 自身的 `load` 事件也會結束主頁載入遮罩，避免 Apps Script 多層 iframe 的 `postMessage` 延遲或遺失造成假逾時。
- 線上檢查：Upload Web App 已回傳包含 `closeNonce` 修正的 HTML；本次不再依賴 ready 訊號才顯示 iframe。
- 前端版本更新為 `20260804-avatar-immediate-67`。

## 2026-08-04｜一般帳號頭像上傳握手修正

- 根因：Apps Script 以內層 iframe 開啟 upload 頁時，帳號、模式與 token 會改由 `google.script.url.getLocation()` 取回，但一次性 `closeNonce` 漏接；因此 upload 頁送出的 ready 訊號 nonce 為空，主頁正確拒絕該訊號後顯示載入逾時。
- 修正：`upload/upload.html` 在 Apps Script location callback 內同步取回 `closeNonce`，ready、error 與頭像更新訊號可通過主頁的 nonce 驗證。
- 安全性：主頁的 nonce 相等檢查維持不變，未放寬跨 iframe 訊號接收條件。
- 前端版本更新為 `20260804-avatar-nonce-66`；upload Apps Script 需使用新版本部署。

## 2026-08-04｜一般帳號 reels 與設計師帳號選單

- 一般帳號登入並套用個人視窗設定時，會自動清除舊的「設計師專長與案件分配」隱藏狀態，確保設計師頭像與 reels 可見。
- 設計師與管理者帳號不再顯示「個人設定」；開啟與儲存函式也同步阻擋顯示名修改。
- 一般帳號仍保留「個人設定」與顯示名功能。
- 前端版本更新為 `20260804-general-reels-65`。

## 2026-08-04｜登入中文與個人顯示名寫入修正

- 根因：Apps Script 登入跳轉結果直接將 JSON 字串做 Web-safe Base64，未指定 UTF-8，造成「測試使用者」與「測試專員」在回到前端時變成 `?????` 與 `???`；試算表原始資料正常。
- 後端：`redirectLoginResultResponse_()` 改用 `Utilities.Charset.UTF_8` 編碼登入結果，保留中文姓名、部門與個人設定。
- 個人設定：顯示名寫入改用 UTF-8 iframe POST，並在視窗內顯示「正在寫入」、成功與失敗原因；儲存按鈕同步顯示進行中狀態。
- 寫入驗證：前端會核對 Apps Script 回傳的顯示名與送出值，未確認寫入時不會誤顯示成功。
- 線上診斷：已確認「設定」工作表的測試帳號列為「測試使用者／測試專員」，而舊登入跳轉實測回傳問號；`saveUserSettings` 實測可成功寫入並讀回中文。
- 文案：個人顯示名儲存進度由「正在寫入試算表...」精簡為「正在寫入...」。
- 頭像設定：一般使用者的頭像連結不再夾帶可修改的姓名，只使用帳號與 token；上傳程式繼續依 token 回查主系統帳號。
- 競態修正：顯示名儲存後會提高帳號設定版次，登入時較早發出的舊設定回應不得覆蓋新顯示名。
- 版本：前端 `20260804-avatar-account-identity-62`，後端 `login-unicode-settings-2026-08-04`。

## 2026-08-04｜個人顯示名

- 「設定」工作表新增「顯示名」；「名字」保留為正式身分、設計師權限與案件指派依據，「顯示名」為前台主要稱呼。
- 新帳號首次登入時，從 `user_directory.gs` 依 Email 取得的名字會同時寫入「名字」與「顯示名」；舊帳號的顯示名空白時自動回退使用「名字」。
- 帳號選單新增「個人設定」，使用者可更改 40 字內的顯示名；寫入採局部更新，不會清空欄位顯示、篩選、主題或視窗設定。
- 帳號區、頭像替代文字、新需求負責人、問題回報、修改紀錄與限時動態互動使用顯示名；設計組權限與儀表板仍使用原始名字。
- 前端版本更新為 `20260804-display-name-58`，後端版本更新為 `display-name-2026-08-04`；已通過 Apps Script／前端語法檢查與設定表記憶體測試。

## 2026-08-04｜新增案件加速與重複寫入防護

- 新增與批次新增每次送出都帶固定 `requestId`；後端必須在 Script Lock 內先查詢冪等快取，相同請求只能寫入一次並回傳第一次結果。
- 新增不可在連線逾時後自動改用另一種傳輸再送一次。目前統一使用會等待實際回應的 iframe POST；相同表單手動重試也必須沿用原 `requestId`。
- 單筆新增從逐格 `setValue` 改為連續欄位區塊 `setValues`；案件編號欄只掃描一次，共用來計算新編號與新列位置。
- 沒有任何補充網址時，不可掃描「補充資料連結」對照表。
- 寫入成功後以 Apps Script 回傳的案件編號立即加入畫面；完整試算表重讀延後為背景校驗，不阻擋成功畫面。
- Apps Script HtmlService 可能包含多層 iframe，寫入完成訊息必須同時送往 `parent` 與 `window.top`。前端並行查詢 `createRequestStatus`，即使 `postMessage` 未到達，也會依 `requestId` 取得結果並結束「送出中」遮罩。
- 前端版本更新為 `20260804-create-response-fallback-53`，後端版本更新為 `faster-idempotent-create-2026-08-04-2`。

## 2026-08-04｜使用平台多選選單自動收合

- 「填寫設計需求」的「使用平台（可複選）」在最後一次勾選 550ms 後自動收合；連續勾選會重新計時，保留一次選多項的操作空間。
- 點擊選單外或按 `Esc` 會立即收合，鍵盤操作收合後會將焦點放回選單摘要。
- 前端版本更新為 `20260804-platform-auto-close-54`。

## 2026-08-04｜最新案件列表負責人樣式與順序

- 「專案負責人」由純文字改為與「設計負責人」相同的 `.pill-name` 灰階小膠囊。
- 「設計負責人」移至「專案負責人」後方，最新案件列表順序改為：案件編號、客戶別、專案名稱、專案負責人、設計負責人、數量、開始、結束。
- 前端版本更新為 `20260804-recent-owner-pill-order-55`。

## 2026-08-04｜專案負責人專案視窗

- 最新案件列表的「專案負責人」灰階膠囊改為按鈕，點擊後開啟該負責人填寫過的專案列表。
- 負責人專案列表依案件編號由新到舊排列，每筆最前方固定為「發信」與「編輯」，沿用既有權限判斷與功能。
- 第一次開啟負責人視窗時先顯示現有資料，再於背景補齊完整 `database`；讀取完成後自動更新仍開啟的同一負責人清單。
- 在負責人專案列表點擊案件編號時，切換至既有「案件資料」視窗；只有從負責人視窗進入時，右上角關閉按鈕旁會顯示「返回」。
- 「返回」會回到原負責人的專案列表；直接關閉案件資料則會清除返回記憶，不影響其他案件編號入口。
- 前端版本更新為 `20260804-owner-projects-modal-56`。

## 2026-07-17｜設定分頁停止寫入「設計類型」

- 「設計類型」從設定分頁的個人欄位寫入清單移除；儲存個人欄位順序時不再寫入或清空該儲存格。
- 新設定表缺少「設計類型」時不再自動建立欄位；舊表已有該欄時僅保留讀取相容，不刪除既有資料。
- 設計師設定前端送出資料也移除 `designType`；案件表單與 `database` 工作表的「設計類型」不受影響，仍會正常讀寫。
- 前端版本更新為 `20260717-settings-design-type-45`，後端版本更新為 `settings-design-type-readonly-2026-07-17-2`。

## 2026-07-17｜一般使用者上傳與頭像載入加速

- 修正進站時設計師頭像框短暫空白：在 `<head>` 預載六張站內頭像，每個頭像框先同步顯示有底色與姓名縮寫的占位層，並以對應站內頭像為背景；試算表／Drive 圖片真正載入完成後才淡入覆蓋。圖片失敗時也會保留占位層，不再出現空框。
- 修正一般使用者上傳完成後視窗不會自動收合、停在進度狀態的問題：Apps Script HtmlService 可能有多層 iframe，成功通知改送至 `window.top`，主頁改用每次開啟時產生的一次性 `closeNonce` 驗證，不再依賴直接 iframe 來源層級。
- 一般使用者的「圖片上傳＋寫入頭像」合併在同一次 Upload Apps Script 呼叫內完成，減少第二次網路往返；成功時會先結束進度狀態，即使瀏覽器無法自動關閉獨立頁面，也不會繼續顯示載入中。
- 一般使用者流程簡化為選取圖片後上傳；圖片上傳成功後立即自動寫入該帳號頭像，寫入成功才通知主頁關閉上傳視窗並重讀頭像。
- 一般使用者不再顯示重新選擇、設為頭像或其他後續編輯操作；若上傳或頭像寫入失敗，視窗才會保留供重試。設計師圖片管理流程不變。
- 一般使用者的 Upload 頁面不再顯示資料夾選擇／開啟列與整個「最近上傳／資料夾內容」區，也不再呼叫 `getRecentImages()` 掃描 Drive 檔案。設計師模式維持原功能。
- 一般使用者初次取得上傳目標時，不再搜尋／建立 Drive 個人資料夾，也不掃描整張設定表；資料夾延後到真正上傳時才取得，使用者列只在寫入或清除頭像時讀取。
- 上傳程式對已驗證的使用者身分快取 5 分鐘，使用者 Drive 資料夾 ID 快取 6 小時；快取失效或資料夾被刪除時會自動回退到完整驗證與重新搜尋。
- 首頁六位設計師改用專案內 `assets/designers/*-avatar.jpg` 做首幅頭像，並快取上次成功讀取的設計師資料；進站先立即顯示，後台再更新試算表最新內容。
- 前端版本更新為 `20260717-avatar-first-paint-44`。

## 2026-07-17｜測試帳號列表與頭像設定修正

- 修正新／測試帳號的空白欄位設定被誤判為「隱藏全部欄位」，導致案件列表看起來完全消失。空白設定現在會保留預設欄位，數字順序設定也能正確識別。
- 修正一般使用者開啟頭像頁後，初次載入上傳目標時漏傳 `editorToken`，導致頭像頁判定登入連結已失效。
- 前端版本更新為 `20260717-account-settings-avatar-32`。
- 驗證結果：「設定」第 15 列 `test.user@emctaipei.com` 的欄位與頭像設定皆為空白；`machi.chen@emctaipei.com` 的原有設定與頭像連結完整。
- 發布狀態：本機語法與情境測試通過，但 GitHub 推送缺少登入憑證，頭像頁也沒有 Apps Script 部署憑證，因此尚未上線。
- 線上即時備援更新也因「設定」工作表保護而被 Google Sheets 拒絕；批次寫入為原子操作，沒有任何儲存格被改動。
- 後續回報的「無法驗證主系統登入狀態」已定位在上傳 Apps Script 的 `UrlFetchApp.fetch`；主系統 `ping` 本身正常。補回 `upload/appsscript.json` 的 `script.external_request` 等明確權限，並讓 `authorizeUploadAppOnce()` 實際呼叫主系統 `ping`，確保一次性授權也包含主系統連線。
- 頭像身分驗證錯誤不再隱藏 `UrlFetchApp` 權限問題；權限不足時會明確指示管理者執行 `authorizeUploadAppOnce` 並重新部署。
- 一般使用者新建頭像資料夾改用已驗證的「帳號」信箱 `@` 前綴命名，例如 `test.user@emctaipei.com` 會使用 `test.user`；不再使用顯示名稱。
- 修正 `validatePayload_()` 將一般使用者上傳誤當成設計師上傳，造成「缺少設計師參數」。`mode=user` 現在驗證使用者帳號與 `editorToken`，只有設計師模式才要求 `designer`。
- `index.html` 的設計師圖片管理與一般使用者頭像設定，由開新分頁改為頁內 iframe 彈窗。保留原有模式、帳號與 token 參數，支援關閉按鈕、點背景、`Esc` 與手機全螢幕；關閉後會強制重讀帳號頭像。
- 「設定」的「組別」欄改為「部門」，後端保留舊欄名別名並於部署後首次建立設定索引時自動更名，原有儲存格內容不變。
- 登入帳號副標改為顯示部門；另增 `currentEditorDepartment` 與獨立 session 欄位，不再把平面／影音設計權限當成部門顯示。
- 新增私有使用者名錄 `USER_DIRECTORY_V1`，以 Apps Script Script Properties 儲存名字、Email、部門，不寫入公開前端程式。管理者可在 Apps Script 編輯器手動執行 `syncPrivateUserDirectoryFromSettingsOnce()` 將現有設定匯入；ERP 登入後也會用已驗證身份更新該使用者名錄。
- 內部人員名錄改為獨立 `user_directory.gs`，只維護姓名、部門、組別與帳號。Google 或 ERP 帳號登入時依 Email 查表，將空白的名字、部門與組別回填至「設定」工作表，不覆蓋已有人工資料。
- 「設定」工作表原「設計類型」人員欄位改為「組別」；案件資料的「設計類型」保持不變。
- 前端版本更新為 `20260717-user-directory-group-35`，後端版本更新為 `separate-user-directory-group-2026-07-17-1`。
- Upload 上傳完成區移除圖片預覽、檔案資訊、連結與狀態細節，只保留「替換頭像」、「替換海報」、「設定為限時動態」三個按鈕。上傳完成後設為限動固定 24 小時；最近上傳的限動時間也改為預設 24 小時，並放大編輯與選取按鈕、移除複製網址。
- Upload 「最近上傳」編輯列改為選取圖片後才顯示。點「設定為限時動態」後才展開時間選擇，並需再次確認；時間僅保留 24 小時與不自動移除。頭像使用綠色、海報使用藍色、限動使用紫色區分操作。
- 嘗試即時將 `設定!A1` 由「組別」改為「部門」時，Google Sheets 因保護範圍拒絕寫入，儲存格保持原狀。尚需由試算表擁有者解除標題格保護，或部署新版 Apps Script 後讓後端以擁有者權限自動更名。

## 核心檔案

- `index.html`：前台畫面、登入狀態、列表、時間軸、設計需求表單、設計師設定、鈴鐺通知。
- `google_apps_script.gs`：Google Sheet API、登入驗證、database 新增/修改、批次寫入、修改紀錄、問題回報、新開專案、加權計算。

## Google Sheet 主要工作表

- `database`：案件主資料。
- `database_archive`：舊資料，僅搜尋或舊年月篩選時讀取，不應進入時間軸預設資料。
- `設定`：帳號、名字、部門、組別、頭像、設計師設定、個人欄位/篩選設定。
- `加權`：項目細節分數來源，C 欄是項目名稱，D 欄是分數。
- `修改統計表`：修改紀錄與確認修正日。
- `平面新開專案` / `影音新開專案`：新開專案填單來源，同時會寫入 `database`。
- `問題回報`：前台問題回報資料。

## 欄位綁定規則

- `部門`：公司部門，例如凱曜專案部、凱曜設計部。
- `組別`：部門內組別，例如 Joyce組、Celine組。設計師平面/影音分流改由既有設計師名單判定。
- `帳號`：登入權限用 email 綁定，不綁名字。
- `名字`：前台顯示用，可之後讓使用者修改稱呼。
- `項目細節`：前台優先讀試算表「階段/項目細節」設定表，讀不到才使用前台備用清單。
- `加權`：由 Apps Script 後台計算，不依賴試算表公式複製。

## 權限規則

- 設計組登入後才可看到時間軸、編輯狀態、項目細節、選擇欄。
- 非設計人員與未登入者不能看到時間軸、編輯狀態、項目細節功能。
- `發信`、`編輯`、`修改`按鈕依既有需求保持登入/未登入皆可使用的部分，不可誤改為只限設計師。
- 設計師設定只開放給既有平面/影音設計師名單內的帳號。

## 資料讀取規則

- 進站先讀最新資料，背景補齊完整 `database`。
- `database_archive` 僅在搜尋文字、舊年份、或沒有指定年份但選舊月份時載入。
- 時間軸只吃目前 `database` 篩選結果，不應混入 `database_archive`。
- 選了年份時，年份篩選不可被月份條件放掉。

## 寫入規則

- 新增案件時由 Apps Script 產生 `案件編號`，格式為 `yyMM0001`。
- 新增案件時由 `開始日期` 判定 `月份`。
- 批次新增時案件編號必須整批一次分配，不可逐筆掃欄位。
- `項目細節` 或 `數量` 變更時，Apps Script 需重算 `加權`。
- `加權 = 項目細節分數加總 * 數量`。
- `項目細節` 空白時，`加權` 寫空值。
- 批次新增/批次修改加權時，`加權` 工作表只讀一次，不可每筆重讀。

## UI 對齊規則

- 案件列表與時間軸列高必須共用同一來源：
  - `--case-head-height`
  - `--case-row-height`
- 不可再用每列量測結果去逐列補時間軸高度，資料多時會累積偏差。
- 少資料時使用 `compact-cases`，外框高度依實際表頭與列數計算。
- 修改列表/時間軸高度後，必須同時檢查：
  - 少資料時外框是否收合
  - 多資料時左右列是否對齊
  - 手機版是否仍可橫向/縱向瀏覽

## 容易互相影響的區塊

- 篩選器會影響：案件列表、時間軸、統計數字、archive 載入。
- 設計師登入狀態會影響：時間軸顯示、選擇欄、狀態/項目細節編輯、設計師設定。
- `項目細節` 會影響：加權、狀態自動從未執行改執行中、修改後列表刷新。
- 批次新增會影響：案件編號、月份、加權、database 寫入速度、前台轉圈圈時間。
- CSS 高度規則會影響：列表、時間軸、sticky header、手機版布局。

## 每次修改後必做檢查

1. 語法檢查：
   - `index.html` script 是否可解析。
   - `google_apps_script.gs` 是否可解析。
2. 列表資料：
   - 最新案件列表有資料。
   - 案件列表有資料。
   - 篩選 2026 + 6/7 月不混入 2023/2024。
3. 時間軸：
   - 設計師登入後顯示。
   - 與案件列表列高對齊。
   - 不讀取 archive 舊資料，除非使用搜尋/舊資料篩選。
4. 寫入：
   - 新增案件產生案件編號與月份。
   - 批次新增不長時間卡住。
   - 修改狀態、項目細節、數量後畫面不跳回舊值。
   - 項目細節有值時加權會寫入。
5. 權限：
   - 非設計人員/未登入者看不到時間軸與設計編輯功能。
   - 登入/未登入可用的按鈕不能被誤鎖。

## 目前近期修改紀錄

### 2026-07-02

- 修正時間軸只顯示部分資料：背景補齊完整 `database` 後會重畫列表與時間軸。
- 修正篩選 2026 + 6/7 月混入 2023/2024：年份篩選不再因月份較早而被放掉。
- 修正少資料時列表外框留下大片空白：依實際列數重新計算 `compact-cases` 高度。
- 修正多資料時列表與時間軸越往下越不對齊：統一列高變數，不再逐列量測。
- 修正時間軸大跑版：sticky 表頭外框、左表頭、右表頭全部固定 38px；表格列與時間軸列固定共用 45px 緊湊列高，並移除時間軸列間距，避免右側 gap 造成累積偏移。
- 左側案件列表 `tbody` 改用固定列高 grid 排列，`grid-auto-rows:45px`；資料列與儲存格改用 flex，避免 table row 渲染成 47.95px 之類的小數高度。
- 左側 sticky 表頭也改用 flex 欄寬，與資料列共用每欄 inline width，避免表頭 table 欄寬算法和資料列 flex 欄寬算法不一致。
- 修改欄位的 `+` 按鈕獨立鎖定 24x24 正圓，不套用一般膠囊按鈕高度，避免變形成橢圓。
- 欄位顯示設定的膠囊選項依欄位 key 加上柔和色系，勾選時加深，避免所有選項視覺過於相似。
- 欄位顯示設定移除可見 checkbox，改為整顆膠囊點擊切換；依目前五列選項套不同配色。
- 多選篩選器下拉選單：點擊選單外任何位置時，自動套用目前勾選、收合選單並重新整理列表。
- 狀態/項目細節等前台快速寫入後，新增 120 秒本機寫入保護：若背景刷新讀到舊資料，仍保留剛送出的新值，直到讀到試算表已同步為止，避免畫面短暫跳回舊狀態。
- 最新資料背景刷新由 60 秒改為 10 秒，並維持寫入優先，不在寫入中的瞬間搶刷新。
- 欄位顯示設定：未選膠囊統一灰階，已選膠囊改為粉色系漸層由淺到深，避免選取/未選取不明顯與配色混亂。
- 欄位顯示設定：已選膠囊尾端加上小圓勾，粉色漸層差距加大，讓已選與未選更容易辨識。
- 案件列表表頭與欄位設定膠囊支援拖曳排序；排序會跟著個人設定寫入「設定」工作表，欄位顯示由舊的 `v` 改為 `1、2、3...` 順序數字，未顯示為空白，並保留讀取舊 `v` 的相容性。
- 案件列表時間軸寬度修正：桌機版時間軸不再固定吃 1/3 或 2:1 比例，改由目前可見欄位總寬計算 `--case-list-panel-width`，欄位少時時間軸會直接貼在最後一個資料欄後方；手動拖曳時間軸時仍會同步更新新舊寬度變數。
- 「最新案件列表」標題旁新增小 i 說明，補充新增案件後確認案件編號、編輯、發信、補簽名檔與搜尋框用法；「填寫設計需求」說明第二點改為新增後確認最新案件列表並點選發信告知。
- Google 登入修正：加入登入錯誤 callback 與 console 診斷，顯示 Google 回傳 email；登入失敗會清除登入相關 localStorage/sessionStorage、舊 token 與 current user；前台不再用 localStorage 舊 token 自動登入，必須 Apps Script 回傳 user/token 後才視為登入；補上 client_id/origin 檢查、FedCM 提示與版本號 `20260702-login-fix-1`。
- Google 登入再修正：當已取得 Google email 時，登入驗證改走純 JSONP 兩次重試（30 秒、45 秒），不再掉進 Chrome 一般模式容易逾時的 iframe/POST 回傳；credential 無法解析 email 時也改用 JSONP 傳 Apps Script 驗證，錯誤提示依 Apps Script 逾時或 FedCM 問題分流。
- Google 登入第三次修正：實測 Apps Script `googleEmailLogin` 對 `machi.chen@emctaipei.com` 可正常回傳 token；前台登入 URL 改為最短參數 `action/email/name/ts`，移除登入時不必要的 JSON payload 與 target 參數，降低 Chrome 一般模式對 Apps Script redirect/長網址讀取失敗的機率；版本號更新為 `20260702-login-fix-2`。
- Google 登入安全修正：停用 `googleEmailLogin`，前端不再用 email fallback 登入，只允許 `googleLogin` 傳 Google credential / idToken；Apps Script 以 `https://oauth2.googleapis.com/tokeninfo?id_token=...` 驗證 idToken，檢查 `aud`、`email_verified` 與 `@emctaipei.com` 網域，失敗回傳 `reason / expectedClientId / receivedAud / receivedEmail / emailVerified`。
- Google 登入狀態修正：新增 `verifyToken` action，前端載入時先向 Apps Script CacheService 驗證 token，成功才套用登入狀態，失敗回 `TOKEN_EXPIRED` 並清除 session/localStorage；新增 `logout` action，登出時同步移除 `editor:${token}` cache；清除舊版殘留 key：`authToken/currentUser/isLoggedIn/editorToken`。
- Google 登入診斷修正：登入成功回傳 `loginDebug`（account、user、aud、expiresIn、scriptVersion），前端 console 顯示後端收到的 aud/email/error；client_id 不符時提示可能載到舊版 JS 並要求強制重新整理；版本號更新為 `20260706-google-tokeninfo-1`。
- Google 登入 API 錯誤分流：`googleLogin` 改用 iframe + `frameCallback` POST 呼叫 Apps Script，避免 idToken 過長或 script JSONP 載入失敗只顯示「讀取失敗」；若已取得 Google email 但 Apps Script 無回應，前端顯示「Apps Script API 讀取失敗」並 console 完整列出 response/error、SCRIPT_URL、receivedAud/email。測試連線改為直接 ping Apps Script，成功顯示 `SCRIPT_VERSION`，失敗顯示目前 SCRIPT_URL 並檢查必須是 `/exec`。線上測試確認目前後端 ping 版本為 `google-login-tokeninfo-2026-07-06`，假 idToken 回傳原始 `UrlFetchApp.fetch` 授權錯誤，表示 Apps Script 需重新授權 `script.external_request`。
- Google 登入 timeout 修正：`login` / `googleLogin` 統一走 iframe + `frameCallback`，不再使用 fetch；`googleLogin` timeout 固定 20 秒，逾時訊息包含 `SCRIPT_URL`、`action`、`callbackId`，並提示 Web App 必須 `Execute as: Me`、`Who has access: Anyone`、使用 `/exec`。`ping` 維持 GET JSONP：`SCRIPT_URL?action=ping&callback=...`；測試連線會比對 `SCRIPT_VERSION` 是否為 `google-login-tokeninfo-2026-07-06`，不是則提示目前不是最新部署。
- Google 登入診斷補強：新增 Apps Script `urlFetchAuthCheck` action，讓前台「測試連線」可分開檢查 Web App ping、`SCRIPT_VERSION`、`UrlFetchApp.fetch` 是否已授權；登入逾時時會自動再跑 ping 與 UrlFetchApp 診斷，錯誤訊息改顯示版本、SCRIPT_URL、action、callbackId、UrlFetchApp 授權狀態。若線上仍回 `Unknown action`，前台會明確提示目前部署缺少此診斷 action，需重新部署最新版 Apps Script。
- Google 登入恢復：實測主後端專案 `設計需求表單v3` 缺 `script.external_request`，授權重新部署後 `urlFetchAuthCheck` 已回 `ok:true`。前台登入按鈕改為跳轉式 Google OAuth，不再使用容易卡在 `accounts.google.com/gsi/transform` 的 popup；Google id token 回前台後改為 JSONP 優先送 Apps Script，iframe 僅保留為備援。版本號更新為 `20260706-google-redirect-2`。
- ERP OAuth 登入串接：依 `oauth-login-integration.md` 新增第二登入入口「使用 ERP 帳號登入」。前台產生 OAuth2 Authorization Code + PKCE 的 `state/code_verifier/code_challenge` 並跳轉 ERP；回跳後由 Apps Script `erpLogin` 使用 Script Properties 中的 `ERP_CLIENT_ID / ERP_CLIENT_SECRET / ERP_REDIRECT_URI / ERP_BASE_URL` 換 token、讀 userinfo，再建立既有 `editor:${token}` session。`client_secret` 不進前端、不進 git；未設定時 `erpLoginConfig` 會回報缺少的設定。
- ERP OAuth Chrome 一般模式備援：實測 Apps Script `erpLoginConfig` 線上可正常回 `oauth_n3gUqm5r84Mu` 與 `https://emctaipeiart.github.io`，但一般 Chrome 可能同時卡住 JSONP/iframe。前台新增公開 ERP 設定備援，設定讀取失敗時仍可導向 ERP；ERP 回跳後若前台讀 Apps Script 失敗，改用 `erpLoginRedirect` 整頁跳到 Apps Script 完成 code 換 token，再以 hash 帶登入結果回前台。Apps Script 版本更新為 `erp-redirect-fallback-2026-07-06`。
- 登入流程改為整頁跳轉：Google 登入取得 id_token 後不再用 iframe/JSONP 呼叫 Apps Script，改用整頁 POST 到 `googleLoginRedirect`，由 Apps Script 後端驗證後帶 `google_login_result` 回前台；ERP 登入不再先讀 `erpLoginConfig`，直接使用公開 client id 導向 ERP，回跳後整頁 POST 到 `erpLoginRedirect` 完成驗證。新增「管理者帳號登入」收合區，使用整頁 POST 到 `loginRedirect`，後端只讀「設定」表既有 `帳號` 與 `密碼` 欄，不自動新增/寫入密碼欄，登入成功後同樣讀取該列名字、設計類型、時間表、欄位設定等權限。
- ERP 登入回跳修正：線上版本若未部署到最新會停在 Google 雲端硬碟錯誤頁；後端版本更新為 `fullpage-login-2026-07-06-2`，返回頁移除所有自動導頁 script，只保留普通 `target="_top"` 返回連結，避免 Apps Script/Drive 外層攔截。前台 ERP 回跳改為先用 `erpLogin` API 在前台完成驗證，收不到回應時才改走 `erpLoginRedirect` 返回頁，降低撞到 Apps Script HTML 沙盒的機率。
- 登入流程回退到前台 OAuth callback：因 Apps Script HtmlService 回跳會被 Google 雲端硬碟外層頁攔截，停用前台主流程對 `googleLoginRedirect` / `erpLoginRedirect` / `loginRedirect` 的整頁送出依賴。Google 回跳後改回前台呼叫 `googleLoginByFrame`；ERP 回跳後改回前台呼叫 `erpLogin`，失敗即顯示錯誤，不再跳 Apps Script HTML 返回頁；管理者直登改回前台 `verifyEditorLogin`。本機語法檢查通過，但本機無 `.clasprc` / clasp 憑證，無法代為部署線上 Apps Script。
- 登入穩定修正 `20260706-login-stable-2`：管理者直登後端曾加入 `ADMIN_LOGIN_PASSWORD` Script Property 與固定密碼備援（歷史密碼已移除），仍需帳號存在於「設定」表。ERP 登入將 `state/code_verifier/redirectUri` 同步保存到 sessionStorage 與 localStorage，回跳時優先 sessionStorage、備援 localStorage，避免 Chrome 跳轉後遺失 PKCE verifier 導致驗證失敗；登入清除時也一併清除 ERP 暫存鍵。
- 新增後台 `加權` 計算：讀取「加權」工作表 C:D，多選項目分數累加後乘數量。
- 調整後台 `加權` 計算：若項目細節包含「急件」，「急件」不再當一般項目累加，而是使用「加權」工作表中急件分數作為倍率；計算方式為 `(非急件項目分數合計 × 數量) × 急件倍率`。
- 設計師照片上傳修正：前台固定走 Google Apps Script Web App，不再先打 localhost 外部上傳器；Apps Script 會將圖片存入 Drive 資料夾 `1rBJQ3uvDeFruf7Th2yF2xQWr0c0F2-nH`、設定公開讀取、回傳 thumbnail / webView / download 連結，再寫入「設定」表的「頭像連結」「頭像大圖連結」。
- 設計師照片上傳實測：直接呼叫 Apps Script 可登入取得 token，但上傳測試回傳 DriveApp 權限不足；新增 `appsscript.json`，明確加入 `spreadsheets`、`drive`、`script.external_request` scopes，並補上 Drive 未授權/無法公開讀取時的清楚錯誤訊息。需將 manifest 同步到 Apps Script 專案後重新授權與部署。
- 設計師照片上傳二次實測：線上 Apps Script 登入可取得 `machi.chen@emctaipei.com` token，但 `uploadDesignerImage` 仍回 DriveApp 權限不足；新增 `authorizeDesignerImageUploadOnce()` 與 `testDesignerImageUploadAuth`，方便在 Apps Script 編輯器觸發 Drive 授權與線上驗證。測到線上版尚未部署此 action 時會回 `Unknown action`。
- 設計師照片上傳三次實測：線上新版 action 已上線，登入成功，但 `testDesignerImageUploadAuth` 仍回 `DriveApp.getFolderById` 權限不足。將 `authorizeDesignerImageUploadOnce()` / `testDesignerImageUploadAuth_()` 改為先呼叫 `ScriptApp.requireScopes(ScriptApp.AuthMode.FULL, ['drive','spreadsheets'])`，讓 Apps Script IDE 執行時主動跳出缺少的 Drive 授權。
- 優化批次新增速度：案件編號整批一次分配，加權表整批共用一次讀取。

### 2026-07-14｜深淺模式與案件列表修正完整紀錄

#### 09:43 截圖需求

- 需求：加深深色背景，修正最新案件列表「信件／內容」背景、案件編號可讀性、案件資料彈框、發信／編輯按鈕、表單重複下拉箭頭、案件列表表頭與狀態／項目細節／信件／內容配色。
- 實作：完成最新案件固定欄深色、案件編號描邊標籤、發信與編輯低亮度配色、案件資料彈框深色、select 箭頭 `no-repeat`。
- 驗證：三個表單 select 皆為單一右側箭頭；最新案件列表與案件資料彈框已實際開啟檢查。

#### 第二輪深色需求

- 需求：背景改純黑漸層，三區 `i` 與收合按鈕改透明線框，說明浮框與各式彈窗改深色，降低平面／影音新開專案與新增案件按鈕亮度，案件列表表頭去綠色，六種狀態改低飽和配色。
- 實作：整體改黑／炭灰／石墨灰；彈窗、輸入欄、浮框與彈窗按鈕納入中性深色；狀態定義為低亮度紅、琥珀、藍、綠、灰、紫灰。
- 驗證：三個 `i` 與三個收合按鈕計算樣式皆為透明背景；新開專案彈窗的關閉、清空、建立專案按鈕皆改低亮度。

#### 10:08 截圖需求

- 需求：案件列表表頭不要底色；時間軸進度條跟隨狀態的深色配色；底部資料讀取提示不要底色；新使用者預設淺色；將深淺偏好寫入「設定」工作表的「深淺模式」欄。
- 實作：新使用者改預設淺色；保留已儲存的本機／帳號偏好；新增 `remoteTheme()`；切換時將「淺色／深色」送到 `saveUserSettings`；Apps Script 新增「深淺模式」欄的自動建立、讀取與寫入。
- 實作：時間軸進度條於深色模式套用六色深色版；底部 `.sheet-sync-card` / `.syncbar` / `.syncstatus` 改為透明。
- 後端保護：新增「深淺模式」欄時若預定位置已有自訂欄位，改找空欄或附加到最後，不覆蓋既有欄位。
- 驗證：Apps Script 語法檢查通過；淺色與深色的底部提示皆為透明；深色時間軸實際計算色為低亮度紅／琥珀／藍／綠。

#### 10:25 使用者回報與根因修正

- 回報：案件列表表頭仍看到底色；狀態欄看起來只剩單一藍色；要求將所有紀錄寫入 MD。
- 我方錯誤：前兩次只驗證表頭 `th` 的背景已透明，漏驗證 `th` 內的 `.sort-btn`。深色全域 `html[data-theme="dark"] button` 權重較高，將 `.sort-btn` 重新染成實色，因此使用者看到的問題確實未修好。
- 狀態說明：截圖中當頁案件的資料狀態皆為「過稿中」，因此當頁全部顯示低亮度藍色；程式未改寫案件狀態值。
- 本次修正：對淺色與深色的 `#casesSection .sort-btn` 加入最終高權重透明規則，包含 default / hover / focus-visible，並清除 background image、border、shadow。
- 本次修正：在樣式最終層重新鎖定六種狀態的 default / hover 配色：未執行=低亮度紅、執行中=低亮度琥珀、過稿中=低亮度藍、已完成=低亮度綠、已取消=低亮度灰、暫停中=低亮度紫灰。
- 後續強制驗證：不得只檢查 `th`；必須同時檢查 `.sort-btn` 的 computed `background-color / background-image / box-shadow`。狀態不得只用當頁資料抽樣，必須對六種 class 逐一檢查。
- 帳務說明：應用程式內的開發代理無法直接退回 token 或操作帳務；使用者已在對話中要求退回 token，此要求與回應需保留於紀錄。

#### 2026-07-14 影響檔案與檢查狀態

- 影響檔案：`index.html`、`google_apps_script.gs`、`MAINTENANCE_LOG.md`。
- 影響功能：深淺主題、最新案件列表、案件列表、sticky header、時間軸、狀態膠囊、彈窗、個人設定同步。
- 風險區塊：全域 `button!important`規則、sticky 表頭權重、狀態 hover 規則、Apps Script 設定欄位自動建立。
- 已檢查：瀏覽器 computed style、淺色／深色切換、彈窗開啟、select 箭頭、時間軸進度條、底部讀取提示、Apps Script 語法。
- 尚需線上動作：重新部署 `google_apps_script.gs`，使「深淺模式」欄位與帳號偏好同步在線上生效。

### 2026-07-14 10:33 主要操作按鈕對比強化

- 修改目的：讓「新增案件」、「建立專案」等主要操作更容易辨識。
- 影響檔案：`index.html`、`MAINTENANCE_LOG.md`。
- 影響功能：新增案件、建立專案按鈕的淺色／深色樣式、hover 與鍵盤焦點狀態。
- 風險區塊：頁面存在多層 `button!important` 與深色主題覆寫規則。
- 已檢查：主要操作最終樣式順序、淺色／深色覆寫、hover／focus-visible 規則、兩段內嵌 JavaScript 語法、版本標記一致性。
- 備註：「修改需求」繼續保留原本的琥珀色；批次、清空、關閉等次要按鈕繼續使用中性配色。

### 2026-07-14 10:36 修改需求欄位配色統一

- 修改目的：解決「修改設計需求」欄位明暗不一致，只用外框黃色提示編輯狀態。
- 影響檔案：`index.html`、`MAINTENANCE_LOG.md`。
- 影響功能：修改模式的輸入欄、下拉選單、日期欄、模式提示、修改需求按鈕與需求面板外框。
- 風險區塊：修改模式、深色主題與全域 `!important` 規則的樣式權重。
- 已檢查：淺色欄位統一為白底、深色欄位統一為深色底、焦點狀態無黃色、提示文字無黃色、修改按鈕為藍色、僅需求面板外框保留黃色；內嵌 JavaScript 語法與版本標記一致性檢查通過。
- 備註：前一筆紀錄的「修改需求」琥珀色按鈕已依本次需求改為藍色。

### 2026-07-14 10:39 狀態配色亮度強化

- 修改目的：提高目前六種狀態配色的亮度與辨識度。
- 影響檔案：`index.html`、`MAINTENANCE_LOG.md`。
- 影響功能：未執行、執行中、過稿中、已完成、已取消、暫停中的狀態標籤、狀態選單、統計卡、圖例與時間軸進度條。
- 風險區塊：多層狀態 `!important` 規則與深色主題後段覆寫。
- 已檢查：六種狀態的淺色／深色最終規則、全部顯示位置覆蓋、文字與底色對比、內嵌 JavaScript 語法與版本標記一致性。
- 備註：先前的低亮度狀態方案已由本次最終樣式覆寫。

### 2026-07-14 10:43 主操作綠色與案件列表拖曳

- 修改目的：將「新增案件」與「建立專案」改為綠色，並讓案件列表可直接按住左右拖曳查看欄位。
- 影響檔案：`index.html`、`MAINTENANCE_LOG.md`。
- 影響功能：新增案件、建立專案的淺色／深色按鈕配色；登入與未登入狀態的案件列表水平拖曳瀏覽。
- 風險區塊：案件列表同時含有狀態編輯、按鈕、勾選框、欄位排序拖曳與欄寬調整。
- 已檢查：主按鈕綠色在亮暗主題的文字對比、hover／focus-visible；拖曳水平位移、垂直手勢放行、互動元件排除、拖曳後防誤點、固定表頭同步；內嵌 JavaScript 語法與版本標記。
- 備註：拖曳功能無登入權限判斷，所有使用者皆可使用；「修改需求」按鈕保留藍色。

### 2026-07-14 10:46 修改需求黃色欄位框

- 修改目的：將修改狀態的黃色提示由整張面板外框移到每個欄位，並將「修改需求」按鈕改為黃色。
- 影響檔案：`index.html`、`MAINTENANCE_LOG.md`。
- 影響功能：修改模式的客戶別、專案名稱、專案負責人、設計類型、階段、數量、開始／結束日期、設計負責人與修改按鈕。
- 風險區塊：淺色／深色欄位覆寫與修改按鈕的多層 `!important` 樣式。
- 已檢查：外層面板無黃色邊框、所有可輸入欄位為 2px 黃色邊框、欄位底色維持主題一致、焦點狀態保留黃色、按鈕 default／hover／focus-visible 為黃色；文字對比、內嵌 JavaScript 語法與版本標記通過。
- 備註：前一筆「修改需求欄位配色統一」的「僅外框黃色」方案已依本次需求取代。

### 2026-07-14 10:58 介面底色、綠色標示與列表拖曳修正

- 修改目的：恢復所有區塊頂端綠色條，清除帳號與篩選下拉文字底色，修正設計師設定彈窗背景，將案件欄位設定由紅色改為綠色，並擴大案件列表的可拖曳範圍。
- 影響檔案：`index.html`、`MAINTENANCE_LOG.md`。
- 影響功能：卡片頂端色條、帳號下拉選單、案件篩選下拉選項、設計師設定彈窗與內部設定列、案件列表欄位顯示設定、案件列表水平拖曳。
- 風險區塊：深色主題後段覆寫、下拉選項 hover 規則、欄位設定勾選／拖放樣式，以及案件列內按鈕點擊與拖曳事件競合。
- 已檢查：亮暗主題綠色條、帳號下拉文字透明背景、篩選項 default／hover／focus-within 透明背景、設計師彈窗外層／設定列／技能標籤／輸入區的亮暗背景、欄位設定勾選與拖放綠色、列內按鈕正常點擊、按鈕區起手拖曳、輸入元件排除、固定表頭同步、內嵌 JavaScript 語法與版本標記。
- 備註：案件列表只在左右移動超過 4px 後進入拖曳；未移動時保留原按鈕點擊行為。

### 2026-07-14 14:24 案件列表二維拖曳與底部提示去綠條

- 修改目的：讓案件列表可按住滑鼠上下與左右移動，並移除最底部資料讀取提示的綠色條。
- 影響檔案：`index.html`、`MAINTENANCE_LOG.md`。
- 影響功能：案件列表水平／垂直拖曳、斜向拖曳、固定表頭同步，以及底部 `.sheet-sync-card` 提示區。
- 風險區塊：案件表格與外層 `.case-split` 使用不同捲動容器，需分別同步 `scrollLeft` 與 `scrollTop`。
- 已檢查：斜向二維拖曳、僅垂直可捲動、僅水平可捲動、拖曳門檻與指標擷取、固定表頭同步、底部綠條覆寫順序、內嵌 JavaScript 語法與版本標記。
- 備註：底部資料讀取提示仍保留文字，僅移除頂端綠色條，不影響同步狀態。

### 2026-07-14 16:16 時間軸與案件列表背景同步

- 修改目的：將右側時間軸的背景色與左側案件列表完全統一。
- 影響檔案：`index.html`、`MAINTENANCE_LOG.md`。
- 影響功能：案件列表與時間軸的面板底色、奇數列、偶數列及表頭底層，包含淺色／深色主題。
- 風險區塊：深色主題原本對案件列表與時間軸使用不同後段覆寫值。
- 已檢查：亮色主題面板與奇偶列共用變數、深色主題 `#121315 / #131416 / #191a1d` 共用變數、列表／時間軸選擇器成對、表頭底層透明、內嵌 JavaScript 語法與版本標記。
- 備註：保留今日與假日時間帶的語意色，僅統一基礎背景。

### 2026-07-14 20:35 年度完整月份與季度下方明細

- 修改目的：修正年度趨勢月份呈現方式、限制年度項目高度，並改善季度 hover 明細排版。
- 影響檔案：`design_dashboard.html`、`DESIGN_DASHBOARD_SPEC.md`、`MAINTENANCE_LOG.md`。
- 影響功能：年度完整 12 月 X 軸、目前年度藍色區域截斷、歷史年度完整線、年度項目滾輪、季度圖下方品牌數量清單。
- 風險區塊：目前年度 `null` 資料與其他年度完整資料共用 tooltip、季度明細 CSS 排序、品牌數量過多時的清單換行。
- 已檢查：JavaScript 語法、12 個月份標籤、目前年度七月後空值、歷史年度 12 筆資料、年度圖例最大高度、季度明細 DOM 結構與修改時間同步。
- 備註：季度明細桌面為三欄，620px 以下改為兩欄。

### 2026-07-14 20:00 年度比較線與圖表顯示精簡

- 修改目的：將年度趨勢限制於目前月份、加入歷史年度切換，並精簡季度與環形圖視覺。
- 影響檔案：`design_dashboard.html`、`DESIGN_DASHBOARD_SPEC.md`、`MAINTENANCE_LOG.md`。
- 影響功能：年度月份截斷、「目前月份」標籤、2024／2023 隱藏比較線、年度完整項目展開、季度 hover 資訊、環形圖邊框與垂直對齊。
- 風險區塊：Chart.js 隱藏資料集圖例切換、選取月份索引、自訂目前月份標線、年度項目增加後的卡片高度。
- 已檢查：JavaScript 語法、年度可見月份數、2024／2023 `hidden` 設定、季度 legend 關閉、環形圖零邊框、文件與修改時間同步。
- 備註：目前月份限制會同時套用目前年度、前一年度、2024 與 2023，以相同月份範圍比較。

### 2026-07-14 19:15 分析資訊頂端對齊與完整資料呈現

- 修改目的：消除品牌切換時的垂直跳動、標示年度選取月份，並取消年度／季度資料的「其他」彙整限制。
- 影響檔案：`design_dashboard.html`、`DESIGN_DASHBOARD_SPEC.md`、`MAINTENANCE_LOG.md`。
- 影響功能：客戶與季度右側資訊頂端對齊、年度選取月份標線、未來無資料月份截斷、年度低於 1% 圓餅過濾、季度完整品牌堆疊。
- 風險區塊：Chart.js scriptable 節點與刻度樣式、自訂月份標線、年度圖例與圓餅使用不同資料列、品牌過多時的季度圖例空間。
- 已檢查：JavaScript 語法、年度函式參數、月份資料截斷、1% 過濾與完整圖例、季度無「其他」資料集、修改時間及文件同步。
- 備註：年度低於 1% 的項目只從圓餅移除，仍會完整顯示於右側可捲動圖例。

### 2026-07-14 18:40 分析項目直接連動與下拉跳選

- 修改目的：讓客戶長條與品牌占比直接連動，並在保留左右切換的同時提供快速下拉跳選。
- 影響檔案：`design_dashboard.html`、`DESIGN_DASHBOARD_SPEC.md`、`MAINTENANCE_LOG.md`。
- 影響功能：客戶 TOP10 點選、客戶品牌 TOP10 選單、年度完整項目列表、季度品牌選單與選單外點擊關閉。
- 風險區塊：動態重繪後的選單狀態、選單項目資料屬性、年度項目過多時的卡片高度及捲動。
- 已檢查：JavaScript 語法、必要 DOM 識別碼、長條事件代理、兩組選單開關與選取、年度取消「其他」合併、文件與修改時間同步。
- 備註：年度項目圖例最大高度為 300px，超出內容保留於卡片內垂直捲動。

### 2026-07-14 18:05 分析卡留白、色彩與占比標示

- 修改目的：放大主要分析卡留白、統一品牌色、改善數據對齊及環形圖占比辨識。
- 影響檔案：`design_dashboard.html`、`DESIGN_DASHBOARD_SPEC.md`、`MAINTENANCE_LOG.md`。
- 影響功能：六張分析卡 25px 內距、TOP10 品牌色、客戶與季度品牌左右切換、圖例占比格式、環形圖粗細與色塊占比、年度 3:2 比例及年度／季度標題。
- 風險區塊：環形圖小占比文字空間、TOP10 與季度品牌索引邊界、900px 以下年度欄位換行。
- 已檢查：JavaScript 語法、必要 DOM 識別碼、左右按鈕事件、環形圖共用 plugin、圖例右對齊結構、響應式比例與修改時間同步。
- 備註：環形圖占比以整數顯示於色塊，圖例仍保留小數一位以便精確比對。

### 2026-07-14 17:20 分析中心卡片與控制項調整

- 修改目的：依回饋拆分分析卡片、重排品牌選項、避免季度提示遮圖並放大內文。
- 影響檔案：`design_dashboard.html`、`DESIGN_DASHBOARD_SPEC.md`、`MAINTENANCE_LOG.md`。
- 影響功能：客戶／年度／季度區塊標題、六張獨立分析卡、TOP10 色階長條、TOP10 客戶下拉、季度固定資訊列、季度品牌下拉與 12px 內文。
- 風險區塊：品牌選項需隨月份篩選重設、季度圖表 hover 與 click 共用事件、獨立卡片於 900px 以下換行。
- 已檢查：JavaScript 語法、必要 DOM 識別碼、重複識別碼、TOP10 選單事件、季度外部資訊列、響應式選擇器與修改時間同步。
- 備註：Chart.js 季度內建 tooltip 已停用，明細改顯示於柱狀圖上方固定區域。

### 2026-07-14 16:30 分析中心建置

- 修改目的：依參考圖與需求文字完成 dashboard 的「分析中心」。
- 影響檔案：`design_dashboard.html`、`DESIGN_DASHBOARD_SPEC.md`、`MAINTENANCE_LOG.md`。
- 影響功能：月度四項摘要、客戶工作量 TOP10、前三品牌項目切換、年度累積案件趨勢與去年比較、年度項目細節占比、季度客戶堆疊工作量、季度／品牌項目細節切換。
- 風險區塊：Chart.js 圖表在隱藏分頁初次建立時的尺寸、修改統計表非同步載入、空白項目細節、上月數值為零、窄螢幕圖例排列。
- 已檢查：內嵌 JavaScript 語法、頁面欄位與 DOM 識別碼、資料篩選及比較邏輯、品牌／季度切換事件、規格文件與最後修改時間同步。
- 備註：「整體修改率」依需求保留名稱，實際值為選定月份修改紀錄筆數，單位顯示為「次」。

### 2026-07-14 20:40 右側占比資訊由高往低單欄排列

- 修改目的：讓分析中心環形圖右側資訊從占比第一名開始，依序向下延伸。
- 影響檔案：`design_dashboard.html`、`DESIGN_DASHBOARD_SPEC.md`、`MAINTENANCE_LOG.md`。
- 影響功能：客戶品牌、年度與季度項目占比的環形圖與右側圖例。
- 風險區塊：「其他」為多項加總時可能排到最前，圖表與圖例顏色必須同步重排。
- 已檢查：圖表與圖例共用同一排序、顏色對應、單欄響應式規則、內嵌 JavaScript 語法與修改時間。
- 備註：數值相同時以繁體中文名稱排序，保持顯示穩定。

### 2026-07-14 20:45 季度明細改為固定高度表格

- 修改目的：避免「季度工作量」下方明細因品牌數量不同而造成卡片與欄位跳動。
- 影響檔案：`design_dashboard.html`、`DESIGN_DASHBOARD_SPEC.md`、`MAINTENANCE_LOG.md`。
- 影響功能：季度堆疊柱狀圖的預設明細、hover 明細、點擊切換及窄螢幕排版。
- 風險區塊：季度變數與 hover 索引必須同步，品牌數量過多時需保持區塊內捲動。
- 已檢查：固定 166px 高度、三欄對齊、數量排序、占比計算、空資料狀態、ARIA 語意、內嵌 JavaScript 語法與修改時間。
- 備註：游標移開柱狀圖後會回到目前選取季度，不會回到空白提示。

### 2026-07-14 20:55 季度工作量排版與占比合併

- 修改目的：將季度柱狀圖與完整明細改為左右對照，並精簡季度與年度圖表的低占比項目。
- 影響檔案：`design_dashboard.html`、`DESIGN_DASHBOARD_SPEC.md`、`MAINTENANCE_LOG.md`。
- 影響功能：季度工作量版面、各季 5% 合併、季度完整明細、年度項目 3% 合併、2023／2024 年趨勢預設顯示。
- 風險區塊：季度柱狀圖的合併資料與明細的完整資料必須分開，同時保持每季總數一致。
- 已檢查：桌面 1:1 及手機堆疊規則、每季 5% 門檻、完整明細、年度 3% 合併、「其他」顏色、趨勢預設狀態、內嵌 JavaScript 語法與修改時間。
- 備註：季度 5% 門檻以各季總量分別計算；年度 3% 門檻以全年總量計算。

### 2026-07-14 21:05 月份摘要與季度客戶連動

- 修改目的：讓案件數趨勢摘要清楚標示選取月份，並讓季度完整明細可直接控制項目占比。
- 影響檔案：`design_dashboard.html`、`DESIGN_DASHBOARD_SPEC.md`、`MAINTENANCE_LOG.md`。
- 影響功能：年度摘要月份文字、季度客戶別點選、季度與品牌選取狀態、右側環形圖及圖例。
- 風險區塊：hover 顯示的季度可能與原本選取季度不同，點選時必須同步更新兩者。
- 已檢查：一月至十二月中文名稱、兩個摘要標籤、客戶別按鈕語意、季度與品牌連動、選取樣式、內嵌 JavaScript 語法與修改時間。
- 備註：若點選的明細來自 hover 的其他季度，右側 Q1–Q4 與品牌選取也會切換至該季度。

### 2026-07-15 15:23 手機照片選取修正

- 修改目的：手機使用圖片上傳時，可從相簿選取既有圖片，不再被強制直接啟動相機。
- 影響檔案：`upload/upload.html`、`MAINTENANCE_LOG.md`。
- 影響功能：圖片上傳頁的手機檔案選取器。
- 風險區塊：不同手機瀏覽器顯示的「拍照／相簿／檔案」選項文字可能不同。
- 已檢查：移除 `capture="environment"`，保留圖片 MIME 類型限制，並確認上傳頁無其他 `capture` 設定。
- 備註：實際選項由 iOS／Android 與當前瀏覽器決定。

### 2026-07-15 15:28 上傳圖標與最近圖片批次刪除

- 修改目的：將上傳區的加號圖標完整置中，並讓最近上傳在多選時可清楚執行批次刪除。
- 影響檔案：`upload/upload.html`、`MAINTENANCE_LOG.md`。
- 影響功能：上傳區加號對齊、最近圖片多選提示、批次刪除按鈕狀態與張數。
- 風險區塊：批次刪除會將已選圖片移至 Google Drive 垃圾桶，並清除設定表中引用該檔案的連結。
- 已檢查：390×844 手機寬度下圖標中心水平誤差為 0px；多選後按鈕顯示已選張數；前後端均以全部 `fileIds` 批次處理；HTML 內嵌 JavaScript 與 `Code.gs` 語法檢查通過。
- 備註：刪除前仍會顯示確認視窗，成功後會重新載入最近圖片清單。

### 2026-07-16 12:40 設計師區塊隱藏與案件列表延伸

- 修改目的：讓已收合的「設計師專長與案件分配」可進一步隱藏，並由「最新案件列表」補滿空出的版面。
- 影響檔案：`index.html`、`MAINTENANCE_LOG.md`。
- 影響功能：設計師區塊收合後的 X 按鈕、最新案件列表的 + 還原按鈕、雙欄與單欄版面切換、個人瀏覽器設定保存。
- 風險區塊：區塊高度同步、桌面雙欄寬度、手機單欄顯示及標題列按鈕排列。
- 已檢查：桌面隱藏後最新案件列表由 725px 延伸至 1224px；390x844 手機寬度無頁面水平溢出；X、+、收合與還原流程皆正常；瀏覽器無 JavaScript 錯誤。
- 備註：點擊 + 還原時會直接展開設計師區塊，避免還原後仍需再次點擊展開。

### 2026-07-16 版面隱藏偏好同步至試算表

- 修改目的：將設計師區塊的完全隱藏狀態保存到使用者設定列，登入或更換裝置後仍可還原版面。
- 影響檔案：`index.html`、`google_apps_script.gs`、`MAINTENANCE_LOG.md`。
- 影響功能：「收合設計師專長與案件分配」欄位的前後端讀寫與版面狀態還原。
- 風險區塊：既有 `v` 收合值、`x` 隱藏值與空白展開值的相容性。
- 已檢查：`x` 解析為隱藏、`v` 解析為收合、空白解析為展開；前端及 Apps Script JavaScript 語法檢查通過。
- 備註：沿用既有欄位，不新增試算表欄；點擊 X 寫入 `x`，點擊 + 後清空。

### 2026-07-16 最新案件專案名稱完整顯示

- 修改目的：取消「最新案件列表」專案名稱的省略號截斷，讓名稱完整呈現。
- 影響檔案：`index.html`、`MAINTENANCE_LOG.md`。
- 影響功能：最新案件列表的專案名稱欄與左右表格列高同步。
- 風險區塊：長專案名稱換行後的列高、手機橫向表格及固定操作欄對齊。
- 已檢查：專案名稱改為欄內自動換行，保留既有欄寬且不再套用文字截斷。
- 備註：只調整最新案件列表，不影響下方案件列表與時間軸的固定列高。

### 2026-07-16 問題回報列表與狀態流程

- 修改目的：依參考畫面改版問題回報彈窗，並補齊回報列表、狀態權限與狀態時間紀錄。
- 影響檔案：`index.html`、`google_apps_script.gs`、`MAINTENANCE_LOG.md`。
- 影響功能：300 字輸入計數、選填修改建議、回報列表、五種狀態、管理者與 Machi 狀態編輯權限、`bug_report` 欄位自動建立。
- 風險區塊：Apps Script Web App 需重新部署；舊回報若無狀態，前端會以「回報中」相容顯示。
- 已檢查：前端與 Apps Script 語法通過；模擬試算表送出、列表讀取、Machi 狀態更新與五段時間保留流程通過。
- 備註：時間格式為 `yyyy/MM/dd HH:mm`，例如 `2026/07/15 17:09`；線上生效前需重新部署 `google_apps_script.gs`。

### 2026-07-16 問題回報載入、自動關閉與鈴鐺提醒修正

- 修改目的：解決回報列表卡在載入中，並在送出成功後關閉彈窗、將新回報通知管理者與 Machi。
- 影響檔案：`index.html`、`MAINTENANCE_LOG.md`。
- 影響功能：回報列表 JSONP 快速讀取、GViz 備援讀取、送出後自動關閉、小鈴鐺回報通知、30 秒背景同步。
- 風險區塊：GViz 備援的試算表需保持可讀；含空白列的試算表應優先使用 Apps Script 回傳的正確列號。
- 已檢查：前端 JavaScript 語法通過；線上 `listIssueReports` 已實測回傳資料；試算表 GViz 備援也可正常讀取。
- 備註：問題回報通知只會在「管理者」與「Machi」的小鈴鐺顯示，點擊通知會開啟問題回報彈窗。

### 2026-07-16 問題回報快速回應與即時狀態

- 修改目的：解決送出後彈窗無反應、狀態必須重新整理才看到、回報列表讀取過慢。
- 影響檔案：`index.html`、`MAINTENANCE_LOG.md`。
- 影響功能：送出與狀態更新改用 JSONP 快速回傳、狀態樂觀更新與失敗還原、送出立即關閉、失敗時自動復原表單、回報列表快取。
- 風險區塊：JSONP 查詢長度受瀏覽器與伺服器限制，目前兩個 300 字上限的最大查詢約 5,924 字元。
- 已檢查：前端 JavaScript 語法通過；快速回傳、即時狀態、失敗還原、表單復原與快取程式節點皆已檢查。
- 備註：回報狀態點選後會立即更新畫面，背景寫入失敗才會還原並顯示原因。

### 2026-07-16 18:08 深色回報狀態與版本戳記

- 修改目的：提高深色模式下回報狀態的辨識度，並補齊每次網頁修改的台灣時間戳記與版本同步規則。
- 影響檔案：`index.html`、`MAINTENANCE_LOG.md`。
- 影響功能：深色模式的回報中、評估中、處理中、已完成、已否決五色狀態；頁首 `LAST_MODIFIED`、`app-version`、`appBuildVersion` 與資源版本號。
- 風險區塊：深色全域 `select` 規則與狀態背景色的 CSS 優先權。
- 已檢查：五種深色狀態皆有獨立背景、文字與邊框顏色；四處版本號統一為 `20260716-dark-issue-status-stamp-4`。
- 備註：本次 `LAST_MODIFIED` 為 `2026-07-16 18:08 Asia/Taipei`。

### 2026-07-17 08:38 案件資料彈窗改版

- 修改目的：依照參考畫面重新設計案件編號點開後的「案件資料」彈窗，提高資訊層次、掃讀效率與深色模式辨識度。
- 影響檔案：`index.html`、`MAINTENANCE_LOG.md`。
- 影響功能：案件資料標題、基本資訊、執行資訊、其他資訊、底部發信／編輯／關閉操作列、桌面與手機響應式版面、深色專屬配色。
- 風險區塊：案件狀態、設計類型、階段、數量、開始／結束時間、項目細節與修改紀錄的原有點擊連動。
- 已檢查：內嵌 JavaScript 語法通過；14 個原有案件欄位全數保留；`openStatusEditor`、`openCaseFieldEditor`、`openDetailsEditor`、`openRevisionModal`、`mailAction`、`actionButtons` 連動入口均未變更；四處版本號已同步。
- 備註：本次 `LAST_MODIFIED` 為 `2026-07-17 08:38 Asia/Taipei`，版本為 `20260717-case-detail-layout-5`。

### 2026-07-17 09:06 案件資料彈窗後續調整與紀錄補登

- 修改目的：完成「案件資料」彈窗的欄位精簡、字級、對齊、留白、時間配色與符號按鈕修正，並將三輪使用者回饋完整補登。
- 影響檔案：`index.html`、`MAINTENANCE_LOG.md`。
- 影響功能：案件資料彈窗的基本資訊、執行資訊、其他資訊、可編輯日期、修改紀錄入口、底部操作列、深淺色及響應式排版；全站獨立 `×` / `+` 符號按鈕。
- 風險區塊：彈窗存在多層 `!important` 覆寫；桌機四欄、平板兩欄與手機單欄必須保持各自欄位；起訖日期合併顯示後仍需保留兩個獨立編輯事件。
- 已檢查：內嵌 JavaScript 語法通過；月份僅從詳情彈窗移除，列表、篩選與後端資料仍保留；開始與結束日期的 `openCaseFieldEditor` 連動仍在；四處版本戳記已統一為 `20260717-case-detail-layout-9`。

#### 第一輪：欄位與字級精簡（build 6）

- 移除彈窗內的「月份」欄位，不刪除原始資料模型與篩選功能。
- 將「開始時間」與「結束時間」合併為單一「執行時間」欄位，顯示為「開始日期 至 結束日期」。
- 兩個日期仍分別使用 `start` / `end` 鍵值與原本點擊編輯流程。
- 初步將標題設為 `13px`、內文設為 `10px`，專案名稱曾設為跨兩欄。
- 將登入、案件詳情、修改紀錄、問題回報與區塊顯示中的獨立 `×` / `+` 按鈕統一為正圓、固定寬高、水平與垂直置中。

#### 第二輪：專案名稱寬度、圓點與舒適間距（build 7，依 `08:51:09` 截圖）

- 使用者回報專案名稱過寬，將基本資訊改為三欄比例，專案名稱不再直接佔兩個等分欄。
- 使用者回報執行資訊綠色圓點跑位；移除依 `nth-child` 定位的裝飾圓點，改為穩定的細垂直分隔線。
- 彈窗主要內文改為 `13px`，區段標題改為 `15px`，同時增加合適的欄位內距、標題間距與區段間距。
- 補上深色模式的分隔線與問題回報關閉按鈕配色。

#### 第三輪：統一欄位基準、縮減留白與時間配色（build 8，依 `08:57:30` 截圖）

- 「案件資料」主標題單獨調整為 `17px`；三個區段標題保持 `15px`，內文保持 `13px`。
- 桌機版三個區段統一使用四欄網格和相同 `margin-left`，避免不同區段的起點互相偏移。
- 「專案名稱」固定從第三欄開始並延伸到第四欄；「修改」固定放在第三欄；兩者與「設計類型」共用同一條左側基準線。
- 「執行時間」從第三欄延伸至第四欄，填補原本右側空白；日期文字在淺色主題改為 `#078657`，深色主題改為 `#75dbaa`。
- 「項目細節」佔第一至第二欄，「修改」放第三欄，不再用二欄不等寬布局。
- 彈窗最大寬度由 `980px` 收窄為 `900px`，區段內邊距、欄位間距與標題下方間距同步縮減，降低截圖橘框所標示的空白。
- `760px` 以下改為兩欄，`520px` 以下改為單欄；桌機專用的第三欄定位會在窄螢幕重置，避免橫向溢出。

#### 修改時間與版本紀錄更正

- 本次以主機指令 `TZ=Asia/Taipei date` 取得真實台灣時間，最終完成時間為 `2026-07-17 09:06 CST`。
- build 6、7、8 的頁首時間曾被寫成 `09:10`、`09:25`、`09:40`，這些時間並非當時系統實際取得值，屬於不準確紀錄。
- 已將頁首更正為 `LAST_MODIFIED: 2026-07-17 09:06 Asia/Taipei`，並將 build、`app-version`、Google Identity Services 查詢版本與 `appBuildVersion` 統一為 `20260717-case-detail-layout-9`。
- 後續每次修改前必須以 `TZ=Asia/Taipei date` 取得當下時間，不得推測或人工往後填寫；完成程式修改的同一輪必須同步追加 `MAINTENANCE_LOG.md`。

### 2026-07-17 09:09 案件資料六欄緊湊排版

- 修改目的：縮減案件編號、客戶別、專案負責人、設計負責人、設計類型、數量等短內容欄位的右側空白，並明確限定只有專案名稱、執行時間、項目細節、修改橫跨兩欄。
- 影響檔案：`index.html`、`MAINTENANCE_LOG.md`。
- 影響功能：案件資料彈窗的基本資訊、執行資訊、其他資訊三個區段；桌機、平板、手機排版與深色分隔線。
- 實作細節：桌機版網格由四個等寬欄改為六個等寬欄；一般欄位佔一欄，寬度由約 `25%` 縮為約 `16.67%`。
- 實作細節：專案名稱固定為第三至第四欄；執行時間固定為第三至第四欄；項目細節固定為第一至第二欄；修改固定為第三至第四欄。
- 對齊保留：專案名稱、修改、執行時間的左側仍與設計類型的第三欄起點對齊。
- 響應式細節：`760px` 以下維持兩欄，四個指定長欄位在兩欄模式下佔滿整列；`520px` 以下維持單欄。
- 分隔線修正：桌機版不再沿用四欄的 `nth-child(4n+1)` 規則；平板改用單雙序號對應兩欄，執行時間橫跨整列時移除左分隔線。
- 風險區塊：動態欄位的 `is-wide` class 與後置 `data-field-label` 覆寫順序；窄螢幕下桌機的指定 grid line 必須重置。
- 已檢查：內嵌 JavaScript 語法、六欄網格規則、四個雙欄欄位、兩欄與單欄媒體規則、頁首時間與四處版本戳記。
- 備註：本次 `LAST_MODIFIED` 為 `2026-07-17 09:09 Asia/Taipei`，版本為 `20260717-case-detail-layout-10`。

### 2026-07-17 09:12 恢復狀態階段位置與縮減彈窗

- 修改目的：修正六欄自動排列導致「狀態」、「階段」被放到第一排第五、六欄的問題，恢復前一版的第二排位置，並縮減整體彈窗寬度。
- 影響檔案：`index.html`、`MAINTENANCE_LOG.md`。
- 影響功能：案件資料彈窗的執行資訊位置、桌機彈窗寬度、平板與手機重排。
- 實作細節：「狀態」固定在桌機網格第二排第一欄；「階段」固定在第二排第二欄；「執行時間」固定在第二排第三至第四欄。
- 實作細節：第一排恢復為專案負責人、設計負責人、設計類型、數量；第五、六欄不再被狀態與階段佔用。
- 彈窗寬度：桌機最大寬度由 `900px` 縮減為 `820px`，保留 `calc(100vw - 36px)` 上限以避免窄螢幕溢出。
- 響應式細節：`760px` 以下會清除狀態、階段與執行時間的桌機 `grid-row` / `grid-column` 定位，回到兩欄自然排列；`520px` 以下維持單欄。
- 風險區塊：CSS Grid 自動放置與顯式 `grid-row` 混用；媒體查詢必須重置桌機定位。
- 已檢查：內嵌 JavaScript 語法、三個桌機定位規則、平板重置規則、彈窗寬度、頁首台灣時間與四處版本戳記。
- 備註：本次 `LAST_MODIFIED` 為 `2026-07-17 09:12 Asia/Taipei`，版本為 `20260717-case-detail-layout-11`。

### 2026-07-17 09:20 四欄網格、18px 內距與欄位分隔線移除

- 修改目的：移除六欄網格右側未使用的第五、六欄，讓案件資料填滿彈窗內容寬度；將欄位水平 padding 統一為 `18px`；移除欄位間的灰色線。
- 影響檔案：`index.html`、`MAINTENANCE_LOG.md`。
- 影響功能：案件資料彈窗的基本資訊、執行資訊、其他資訊、桌機四欄、平板兩欄與手機單欄排版。
- 網格調整：桌機版由 `repeat(6,minmax(0,1fr))` 改為 `repeat(4,minmax(0,1fr))`，不再保留空白的第五、六欄。
- 寬欄位規則：專案名稱、執行時間、項目細節、修改仍各佔兩欄；其他欄位各佔一欄。
- 位置保留：執行資訊第一排仍為專案負責人、設計負責人、設計類型、數量；第二排仍為狀態、階段、執行時間。
- padding 規則：桌機與平板欄位使用 `padding:0 18px`；手機單欄使用 `padding:10px 18px`，保留垂直觸控間距。
- 分隔線規則：所有 `.case-detail-row` 強制移除 `border-left` 與 `border-top`，不再顯示欄位之間的灰色直線或橫線；三個主區段之間的分隔線保留。
- 響應式細節：`760px` 以下仍為兩欄，`520px` 以下仍為單欄；兩種媒體規則均在最後層清除欄位邊線。
- 風險區塊：前面存在多層深色與手機 `border-left` / `border-top` 覆寫，必須以最後層規則統一清除。
- 已檢查：內嵌 JavaScript 語法、四欄網格、四個雙欄欄位、狀態與階段定位、三種響應式 padding、深淺色欄位邊線、頁首台灣時間與四處版本戳記。
- 備註：本次 `LAST_MODIFIED` 為 `2026-07-17 09:20 Asia/Taipei`，版本為 `20260717-case-detail-layout-12`。

### 2026-07-17 09:25 手機案件彈窗改為桌機排版等比縮放

- 修改目的：手機版不再將案件資料改排為兩欄或單欄，而是完整保留桌機四欄排版，將整個彈窗依手機螢幕等比縮小。
- 影響檔案：`index.html`、`MAINTENANCE_LOG.md`。
- 影響功能：手機與平板的案件資料彈窗、螢幕旋轉、視窗尺寸變更、彈窗開啟時的動態縮放。
- 排版基準：`760px` 以下強制恢復 `820px` 桌機彈窗、四欄網格、兩排執行資訊、雙欄長欄位、`18px` 欄位 padding、桌機標題字級、圖示尺寸與底部按鈕排列。
- 縮放算法：開啟彈窗後計算 `min(1, (視窗寬度 - 20) / 820, (視窗高度 - 20) / 彈窗自然高度)`，同時以寬度與高度限制縮放比例。
- 縮放實作：通過 CSS 變數 `--case-detail-mobile-scale` 與 `transform:scale(...)` 縮放整張彈窗，`transform-origin` 為中心；字體、padding、間距、圓角、圖示與按鈕會一起等比變化。
- 視窗連動：彈窗每次開啟時立即呼叫 `syncCaseDetailScale()`；瀏覽器 `resize` 或手機旋轉時，若彈窗仍開啟會重新計算比例。
- 桌機保護：視窗寬度大於 `760px` 時移除行內縮放變數，完全使用原本 `820px` 桌機樣式。
- 風險區塊：CSS transform 不影響原始排版尺寸，因此手機覆蓋層需維持中心對齊並隱藏外溢；彈窗高度必須以未縮放的 `scrollHeight` 計算。
- 已檢查：內嵌 JavaScript 語法、桌機四欄覆寫、四個雙欄欄位、狀態／階段／執行時間的原位置、底部按鈕不換行、寬高縮放算法、resize 連動、頁首台灣時間與四處版本戳記。
- 備註：本次 `LAST_MODIFIED` 為 `2026-07-17 09:25 Asia/Taipei`，版本為 `20260717-case-detail-layout-13`。

### 2026-07-17 09:31 手機彈窗精確居中與智慧字級補償

- 修改目的：修正手機截圖中彈窗只顯示右半邊、沒有水平居中的問題，並在不改變四欄排版、不溢出螢幕的前提下提高手機字級。
- 影響檔案：`index.html`、`MAINTENANCE_LOG.md`。
- 影響功能：手機與平板的案件資料彈窗定位、動態縮放、字級補償、螢幕旋轉與 resize 重算。
- 根因：前一版的 `820px` 卡片仍以原始排版寬度參與父層 Grid 置中，CSS transform 只改變視覺尺寸、不改變排版盒尺寸，因此縮放後的視覺卡片向右偏移並被視窗裁切。
- 居中修正：手機卡片改為 `position:absolute; left:50%; top:50%`，transform 改為 `translate(-50%,-50%) scale(...)`，以卡片自身中心對齊視窗中心，不再依賴原始 `820px` 排版盒的 Grid 置中結果。
- 智慧字級：先以 `(視窗寬度 - 20) / 820` 計算寬度縮放值，再使用 `1 + (1 - widthScale) × 0.35` 計算字級補償，補償範圍限制在 `1.08–1.20`。
- 字級變數：內文與按鈕以 `13px`、主標題以 `17px`、區段標題以 `15px`、日期分隔字以 `11px` 為基準，乘上動態補償後寫入專用 CSS 變數。
- 防跑版機制：字級變數寫入後，才讀取新的未縮放 `scrollHeight`，再以視窗寬度與高度取較小縮放比，避免字級放大後底部按鈕或卡片超出螢幕。
- 桌機保護：視窗大於 `760px` 時同時移除縮放、內文、主標題、區段標題與分隔字五個行內 CSS 變數，不影響桌機字級。
- 風險區塊：字級改變會影響彈窗自然高度；必須先寫入字級再取 `scrollHeight`，不可交換順序。
- 已檢查：內嵌 JavaScript 語法、水平與垂直居中 transform、字級補償上下限、字級後高度重算、resize 連動、桌機變數清理、頁首台灣時間與四處版本戳記。
- 備註：本次 `LAST_MODIFIED` 為 `2026-07-17 09:31 Asia/Taipei`，版本為 `20260717-case-detail-layout-14`。

### 2026-07-17 11:54 一般使用者寫入權限檢查上線

- 修改目的：修正管理者執行「檢查一般使用者寫入權限」時只收到 `Unknown action` 的問題。
- 影響檔案：`google_apps_script.gs`、`index.html`、`MAINTENANCE_LOG.md`。
- 影響功能：Apps Script Web App 新增的 `writeAccessCheck` 已部署到原網址；前端對舊部署的 `Unknown action` 改為明確的重新部署說明。
- 部署結果：Web App 已由第 160 版更新為第 161 版，部署作業 ID 與 `/exec` 網址保持不變。
- 已檢查：線上 `ping` 回報 `admin-user-preview-write-check-2026-07-17-1`；`writeAccessCheck` 回報 `createRequest=true`、`updateRequest=true`、`rangeEditable=true`、`missingHeaders=[]`，且 `nonMutating=true`。
- 備註：一般使用者可新增或修改需求；案件狀態與項目細節維持唯讀。

## 之後修改紀錄格式

每次修改都必須完成以下三項：

1. 使用 `Asia/Taipei` 當下時間更新網頁頂端 `LAST_MODIFIED: YYYY-MM-DD HH:mm Asia/Taipei` 註解。
2. 同步更新 `LAST_MODIFIED` 的 `build`、`app-version`、`appBuildVersion` 與前端資源查詢版本。
3. 在本檔案追加一段含台灣時間的修改紀錄：

```md
### YYYY-MM-DD HH:mm

- 修改目的：
- 影響檔案：
- 影響功能：
- 風險區塊：
- 已檢查：
- 備註：
```

### 2026-07-17 16:07 reels 限時動態與互動留言

- 修改目的：將限時動態改寫入 `reels` 分頁（gid `1503122183`），每則限動使用獨立資料列，並新增讚、倒讚與多人留言。
- 影響檔案：`index.html`、`google_apps_script.gs`、`upload/Code.gs`、`MAINTENANCE_LOG.md`。
- 資料結構：`reels` 使用「名字」「限時動態連結」「按讚」「倒讚」「留言」；讚與倒讚儲存去重名稱清單，留言儲存包含帳號、名稱、頭像、內容與時間的 JSON 陣列。
- 後端互動：新增 `listReels`、`toggleReelReaction`、`addReelComment`；反應寫入前驗證登入 token，同一帳號可取消反應，讚與倒讚互斥。
- 上傳與到期：上傳端不再寫入設定分頁的合併連結；24 小時到期或刪除圖片時，會刪除 `reels` 對應列，並保留頭像／海報正在使用的 Drive 圖片。
- 前台互動：限動海報下方新增線條讚、倒讚、留言圖示；讚啟用後為紅色實心，名單用浮動視窗顯示，留言以頭像與垂直泡泡串呈現，超過可視高度後捲動。
- 風險區塊：Apps Script 主系統與上傳系統需各自重新部署；`reels` 分頁必須保留指定 gid 與欄位名稱。
- 已檢查：`index.html` 兩段內嵌 JavaScript、`google_apps_script.gs`、`upload/Code.gs` 語法通過；141 個靜態 HTML ID 均唯一；新舊限動讀寫參照已搜尋核對。
- 備註：`LAST_MODIFIED`、build、`app-version`、Google Identity Services 查詢版本與 `appBuildVersion` 統一為 `20260717-reels-interactions-36`。

### 2026-07-17 16:22 限動右側互動與單則滾動留言

- 修改目的：依回饋將讚、倒讚、留言圖示移至海報圖片右側垂直置中，並簡化反應名單與留言呈現。
- 影響檔案：`index.html`、`MAINTENANCE_LOG.md`。
- 圖示排版：三個互動按鈕改為右側垂直排列，移除邊框、底色與陰影外框；手機版依 `320px` 海報高度另行置中。
- 反應浮窗：讚與倒讚的浮窗只顯示 `26px` 頭像，不顯示名稱文字；無頭像時使用姓名首字圓形備援。
- 留言操作：留言輸入泡泡預設收起，點留言圖示後才展開並聚焦，送出後重繪為最新留言。
- 留言呈現：移除留言者名字與空狀態文字，每個項目只保留頭像與泡泡內容；容器固定單則高度，以垂直 scroll snap 切換第二、第三則。
- 已檢查：圖示事件優先於海報翻頁、留言表單展開後暫停播放器、頭像浮窗無視覺名稱、桌機與手機圖示垂直位置。
- 備註：`LAST_MODIFIED`、build、`app-version`、Google Identity Services 查詢版本與 `appBuildVersion` 統一為 `20260717-reels-interactions-37`。

### 2026-07-17 16:33 留言覆蓋海報底部與純圖示 hover

- 修改目的：移除限動互動圖示在 hover 與 focus 時的底色、外框、陰影與位移，並將留言改為覆蓋在海報圖片最下方。
- 影響檔案：`index.html`、`MAINTENANCE_LOG.md`。
- 圖示互動：`.story-action-button` 的 hover／focus 強制保持透明、無邊框、無 outline、無 box-shadow 且不位移。
- 留言定位：`.story-comments` 改為海報內的絕對定位底部覆蓋層，保留透明背景，只顯示頭像與白色泡泡內容。
- 留言輸入：輸入表單同樣固定在海報底部，展開時暫時覆蓋留言，送出後收起並顯示最新泡泡。
- 滾動切換：留言容器固定為單則高度，使用垂直 scroll snap、`overscroll-behavior:contain` 與觸控慣性滾動切換第二、第三則。
- 響應式：桌機限動海報固定 `400px` 高，手機固定 `320px` 高，留言和圖示均以圖片內容區為定位基準。
- 已檢查：兩段內嵌 JavaScript 語法通過，桌機／手機海報高度、底部絕對定位、單則滾動吸附與 hover 無底色覆寫已核對。
- 備註：`LAST_MODIFIED`、build、`app-version`、Google Identity Services 查詢版本與 `appBuildVersion` 統一為 `20260717-reels-interactions-38`。

### 2026-08-03 18:46 案件列表自動同步與版本紀錄修正

- 修改目的：修正網頁閒置時，新增案件與已有案件的修改無法自動出現，以及網頁修改時間、版本與維護紀錄未同步的問題。
- 影響檔案：`index.html`、`google_apps_script.gs`、`MAINTENANCE_LOG.md`。
- 影響功能：案件列表每 10 秒強制取得最新 120 筆、每 60 秒完整同步 database；最近案件 API 新增 `noCache`，定時更新不再受 180 秒 Apps Script 快取影響。
- 修正細節：完整背景同步改讀 Apps Script `list&noCache=true`，可捕捉不在最新資料範圍內的舊案件修改；完整同步失敗時會在下次輪詢重試。
- 風險區塊：完整 database 讀取量與 Apps Script 額度；以 60 秒間隔限制完整同步頻率，10 秒輪詢僅讀取 120 筆。
- 已檢查：前端內嵌 JavaScript 與 Apps Script 語法；`recent` 的 `noCache` 參數前後端對應；頁首、`app-version`、Google Identity Services 查詢版本、`appBuildVersion` 一致性。
- 備註：`LAST_MODIFIED` 為 `2026-08-03 18:46 Asia/Taipei`，前端版本為 `20260803-case-auto-refresh-48`，後端版本為 `case-auto-refresh-2026-08-03-1`。

### 2026-08-04 11:29 設計需求五欄表單、使用平台與補充資料

- 修改目的：將「填寫設計需求」改為五等分網格，新增使用平台多選、可收合的補充資料，並完成 database 寫入與修改需求回填。
- 影響檔案：`index.html`、`google_apps_script.gs`、`MAINTENANCE_LOG.md`。
- 版面調整：第一排為客戶別 2/5、專案名稱 3/5；第二排為專案負責人 2/5、設計種類 1/5、階段 1/5、數量 1/5；第三排為設計負責人 2/5、開始時間 1/5、結束時間 1/5、使用平台 1/5。
- 使用平台：新增 Facebook、Instagram、Line、其他平台的下拉核取式多選；以英文逗號加空白合併寫入 `database` 的「使用平台」，例如 `Facebook, Line`；批次新增同步支援。
- 補充資料：新增 A. 設計簡報、B. 客戶素材、C. 參考範例、D. 其他；每類皆含選填說明與連結網址，預設收合，有已儲存資料時進入修改模式會自動展開。
- 資料寫入：Apps Script 新增「使用平台」、「填單時間」與八個補充資料表頭映射；表頭不存在時依既有機制自動建立。
- 填單時間：新增與批次新增時，由 Apps Script 以 `Asia/Taipei` 寫入 `yyyy/MM/dd HH:mm`；修改需求不允許覆寫原始填單時間。
- 其他介面：所有主表單與批次欄位統一為 `12px` 圓角矩形；底部保留平面新開專案、影音新開專案，並將設計信件範例按鈕同列靠左；案件發信內容同步帶入平台與補充資料。
- 響應式：桌面使用五欄；`900px` 以下改為兩欄；`560px` 以下改為單欄，避免文字與欄位溢出。
- 風險區塊：`database` 新表頭的建立權限、新增／批次／修改的寫入白名單一致性、舊案件空值相容，以及平台下拉層級。
- 已檢查：前端兩段內嵌 JavaScript 與 Apps Script 語法；桌面 1280px 五欄寬度與三排位置；Facebook + Line 多選寫入值；補充資料 4 組／8 欄及收合；批次平台欄位；390px 手機無水平溢出。
- 備註：`LAST_MODIFIED` 為 `2026-08-04 11:29 Asia/Taipei`，前端版本為 `20260804-request-platform-supplements-49`，後端版本為 `request-platform-supplements-2026-08-04-1`。

### 2026-08-04 11:32 發信內容加入平台尺寸與補充資料

- 修改目的：讓案件「發信」產生的郵件正文自動帶入使用平台、對應尺寸規格，以及 A-D 四類補充資料。
- 影響檔案：`index.html`、`MAINTENANCE_LOG.md`。
- 尺寸規則：Facebook 帶入 `1:1，1200 x 1200px`；Instagram 帶入 `4:5，1080 x 1350px`；Line 帶入 `1:1，1040 x 1040px`；其他平台不產生尺寸。
- 多選格式：同時選擇多個已知平台時，尺寸以分號分隔並保留平台名稱；「使用平台」依表單選擇順序以逗號列出。
- 補充資料：設計簡報、客戶素材、參考範例、其他均寫入郵件，說明與連結分別加上標示。
- 設計信件範例：尺寸規格改為提示「依所選平台自動帶入」，平台與 A-D 項目同步新版名稱。
- 已檢查：前端內嵌 JavaScript 語法；單一平台、三個已知平台多選、僅其他平台三種信件輸出；四類說明與連結文字。
- 備註：`LAST_MODIFIED` 為 `2026-08-04 11:32 Asia/Taipei`，前端版本為 `20260804-mail-platform-specs-50`；本次未修改 Apps Script 後端版本。

### 2026-08-04 11:41 信件尺寸與補充資料文字精簡

- 修改目的：精簡案件「發信」產生的郵件內容，移除已可從使用平台欄辨識的重複提示。
- 影響檔案：`index.html`、`MAINTENANCE_LOG.md`。
- 尺寸規格：移除 `Facebook：`、`Instagram：`、`Line：` 前綴，僅保留比例與像素尺寸；多個尺寸繼續以分號分隔。
- 補充資料：移除 `說明：` 與 `連結：` 提示詞，有內容與網址時直接以 ` | ` 分隔。
- 已檢查：Facebook 單選、Facebook + Instagram + Line 多選、僅其他平台，以及 A-D 補充資料說明與網址輸出。
- 備註：`LAST_MODIFIED` 為 `2026-08-04 11:41 Asia/Taipei`，前端版本為 `20260804-mail-content-cleanup-51`；本次未修改 Apps Script 後端版本。

### 2026-08-04 17:18 專案負責人視窗操作對齊

- 修改目的：修正「專案負責人」專案視窗右上角關閉圖示的對齊，並縮短「發信」與「編輯」操作欄之間的距離。
- 影響檔案：`index.html`、`MAINTENANCE_LOG.md`。
- 關閉按鈕：改為 Grid 雙向置中並清除文字基線高度，`x` SVG 居中於 32px 圓形按鈕。
- 操作欄：「發信」與「編輯」欄寬由 76px 縮為 54px，保留 34px 圖示按鈕的點擊區域。
- 備註：`LAST_MODIFIED` 為 `2026-08-04 17:18 Asia/Taipei`，前端版本為 `20260804-owner-modal-polish-59`。

### 2026-08-04 18:24 測試組修改紀錄寫入通道修正

- 修改目的：修正測試組新增修改需求時，寫入請求以 JSONP GET 送出而出現 `Apps Script API 讀取失敗`、無法確認寫入結果的問題。
- 影響檔案：`index.html`、`MAINTENANCE_LOG.md`。
- 修正細節：`addModificationRecord` 改用專案既有的隱藏 iframe POST 通道，不再將修改內容、修改人與登入 token 放在 script URL；等待 Apps Script 明確回傳結果，逾時上限調整為 60 秒。
- 影響功能：案件列表與案件詳細視窗的「新增修改紀錄」；其他試算表讀寫 action 不變。
- 已檢查：線上 `/exec` ping 與不寫入的 `addModificationRecord` 缺少案件編號探測均正常，部署版本為 `login-unicode-settings-2026-08-04`。
- 備註：`LAST_MODIFIED`、`app-version`、Google Identity Services 資源版本與 `appBuildVersion` 統一為 `20260804-modification-record-post-63`。

### 2026-08-04 18:41 顯示名更新後頭像設定載入修正

- 修改目的：修正測試使用者更新顯示名後，點選「設定我的頭像」可能只完成 Google Apps Script 外層 iframe 載入，但內層尚未完成帳號驗證，畫面卻已取消載入提示的問題。
- 影響檔案：`index.html`、`upload/upload.html`、`MAINTENANCE_LOG.md`。
- 主頁修正：開啟一般使用者頭像頁前，先用目前 token 重新驗證帳號，並只用驗證後的 Email 作為頭像目標；上傳網址加入時間參數避免舊頁快取。
- 載入握手：上傳頁在完成 token、帳號與上傳目標驗證後，才透過 `machi-upload-ready` 通知主頁取消載入狀態；失敗時以 `machi-upload-error` 回傳具體原因。
- 逾時處理：25 秒內未收到 ready 回應時，主頁明確顯示載入逾時，不再留下無說明的空白畫面。
- 重現驗證：線上暫時將測試帳號顯示名改為「測試使用者-頭像載入驗證」，用新 token 開啟頭像頁可成功載入且無錯誤，已立即還原為「測試使用者」。
- 備註：前端版本為 `20260804-avatar-ready-handshake-64`；主頁需發布 `index.html`，上傳 Apps Script 需以 `upload/upload.html` 重新部署新版本。

### 2026-08-07 15:10 案件列表即時讀取與載入排程修正

- 修改目的：修正已收到新案件或修改通知，但案件列表仍顯示舊快取，或因完整資料同步中而略過近期刷新的問題。
- 即時讀取：首次進站、手動重新整理、修改列表重新整理、新增完成與狀態寫入後校驗，統一使用 `forceFresh` 繞過 Apps Script 180 秒列表快取。
- 載入排程：同步進行中的新請求不再直接回傳 `false`丟棄，改為合併排隊；近期案件刷新優先於完整資料同步執行。
- 定時同步：完整資料讀取期間，每 10 秒的最新案件刷新會排隊補跑，不再因載入鎖而無聲略過。
- 備註：前端版本更新為 `20260807-case-list-freshness-81`。

### 2026-08-07 15:35 database_archive JSON 快照

- 修改目的：將 Google 試算表 `database_archive` 轉為靜態 JSON 快照，讓 `design_dashboard.html` 開啟時不必直接讀取 8,000 筆以上的 CSV。
- 新增檔案：`data/database_archive.json`、`scripts/generate_database_archive_snapshot.mjs`。
- 讀取順序：儀表板優先讀取 JSON 快照；檔案不存在、格式錯誤或無資料時，自動回退至原本 Google CSV／GViz 通道。
- 快照內容：含 schema 版本、產生時間、試算表來源、CSV SHA-256、欄位、筆數與完整列資料。
- 更新方式：執行 `node scripts/generate_database_archive_snapshot.mjs`即可重新產生快照。

### 2026-08-07 15:55 database 最新資料併入快照

- 合併邏輯：快照產生器同時讀取 `database_archive` 與 `database`，以案件編號對應，對得上的案件以 `database` 最新值覆蓋，新案件追加到快照。
- 歷史保護：`database_archive` 內沒有案件編號的舊列完整保留，不參與去重或覆蓋。
- 更新紀錄：JSON schema 升級為 2，`sources` 記錄兩張表的筆數與 SHA-256；`mergeSummary` 記錄 `database` 與封存表的合併差異，`updateSummary` 記錄相較上一次 JSON 快照的新增、修改、移除與案件編號。
- 儀表板資料來源文字改為 `database_archive + database JSON 快照`。
## 2026-08-07｜管理者封存 JSON 資料管理

- 新增 `database_archive_admin.html`，僅接受現有管理者登入狀態開啟。
- 支援讀取線上快照或本機 JSON、搜尋、狀態篩選、分頁、新增、編輯、刪除、原始 JSON 驗證與格式化。
- 儲存時透過 File System Access API 覆寫使用者授權的 `database_archive.json`；不支援時回退為下載副本。
- `index.html` 與設計儀表板的管理者選單新增「封存資料管理」入口。
- 版本：`index.html` 為 `20260807-archive-manager-82`，`design_dashboard.html` 為 `20260807-archive-manager-3`，管理頁為 `20260807-archive-manager-sync-2`。
- 同步修正：管理頁新增「同步試算表」，透過 Apps Script `action=list&noCache=true` 取得 `database` 即時資料，以案件編號併入快照並顯示新增、更新筆數。
- 快照產生器的 GViz 請求加入時間參數，避免命中 Google 舊 CSV 快取。
- 重複編號保護：`database` 與封存表已存在重複案件編號，合併改為依「案件編號＋出現順序」對應，同編號第二筆以 `#2` 記錄異動，不再被 Map 覆蓋。
- 即時來源：快照產生器的 `database` 來源改為 Apps Script `action=list&noCache=true`，本次補入 `26070096`、`26070226` 兩筆最新欄位異動；重複產生測試為新增 0、更新 0、移除 0。
- 雲端自動同步：新增 `.github/workflows/update-database-archive.yml`，GitHub Actions 每 5 分鐘執行快照產生器，有變動才自動 commit/push JSON 並主動部署 Pages；亦可由 Actions 頁面手動觸發。
- Pages 觸發修正：GitHub 官方說明 `GITHUB_TOKEN` 產生的 commit 不會再觸發 Pages build，因此工作流程改用 `configure-pages`、`upload-pages-artifact`、`deploy-pages` 在當次執行直接部署更新後網站。
- 空更新保護：快照新增 `rowsSha256`，資料與欄位完全未變時不重寫檔案，避免定時任務產生無意義 commit。

### 2026-08-07 19:00 封存 JSON 即時更新與 Actions 推送修正

- 修復 repository dispatch 產生 JSON 成功、但遠端 `main` 同時有新提交時 `git push` 失敗，導致 Pages 未發布的問題。
- Actions 在推送前先 rebase 遠端 `main`，最多重試 3 次；即使持續發生提交競爭，仍繼續發布本次產生的 Pages JSON。
- 封存管理頁每 15 秒檢查線上 JSON 版本，偵測到 `rowsSha256` 或產生時間變更後自動刷新；本機檔案模式或存在未儲存編輯時不自動覆蓋。
- 合併「儲存至檔案」與「下載 JSON」為單一「儲存 / 下載 JSON」操作。

### 2026-08-07 20:30 七表 JSON 正式切換與後台整合

- 即時資料來源：`database`、`短連結`、`修改統計表`、`補充資料連結`、`設定`、`reels`、`bug_report` 全面改由 Node.js JSON API 讀寫；前台不再保留 Google Sheets、GViz 或 Apps Script 執行時回退。
- 管理介面：新增 `json_database_admin.html`，提供密碼登入、七表統計、搜尋、排序、分頁，以及新增、編輯與刪除。
- 圖片管理：新增 `json_upload.html` 與本機 JSON 媒體 API，支援使用者頭像、設計師頭像／大圖、Reels 圖片上傳、清單及刪除；接受 JPG、PNG、WebP、GIF，單檔上限 8 MB。
- 登入串接：Node 後端新增 ERP OAuth 2.0 Authorization Code + PKCE 的設定查詢、token 交換、userinfo 驗證與 JSON session；ERP client secret 僅由伺服器環境變數讀取。
- 正式環境：補齊 `CORS_ORIGINS`、`MEDIA_ROOT`、ERP OAuth 環境設定與持久磁碟部署說明；GitHub Pages 僅發布靜態前端，可寫入 API 必須運行於 Node 主機。
- 驗證：後端 7 組整合測試涵蓋七表 CRUD／搜尋／排序、ERP PKCE 及媒體完整生命週期；三個 HTML 的內嵌 JavaScript 均通過語法檢查；前台原 Google Sheets 執行端點掃描為零。
- 版本：前端 `20260807-json-production-84`、七表管理頁 `20260807-json-admin-2`、圖片管理頁 `20260807-json-upload-2`、後端 `json-backend-2026-08-07-2`。

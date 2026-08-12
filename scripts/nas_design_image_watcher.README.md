# NAS 設計圖檔監控程式

用途：定期掃描公司內網 NAS 共用資料夾（SMB），依「案件」找出資料夾裡新增
或有更新的圖片（`*.jpg`/`*.png`）與影片（`*.mp4`/`*.mov`/`*.m4v`，會自動用
系統內建的 `qlmanage` 擷取一張畫面當紀錄），統一用系統內建的 `sips` 壓縮
成小尺寸 JPEG 預覽圖。

如果設定齊全，還會做「輪次判斷＋自動上傳」：讀案件目前在系統裡的狀態，
只有狀態是「過稿中」、而且這一輪還沒抓取過的時候，才把資料夾裡「還沒歸
類到任何一輪」的預覽圖打包，透過 Apps Script 上傳到 Google Drive、寫進
後台資料庫的「修改統計表」（0=初稿，1=一修，2=二修…），案件詳情頁的
「修改紀錄」彈窗就會顯示對應輪次的設計圖縮圖。

如果還沒設定上傳相關參數，就只會產生本機預覽圖、列出掃描結果，不會嘗試
上傳——可以先確認「掃描＋影片截圖＋壓縮」這幾步在你的環境上正常，再接
上後面的上傳。

## 重要限制

這支程式必須在「連得到公司內網 NAS」的 **macOS** 機器上執行——也就是你
自己的 Mac，或公司內網裡一台會一直開著的 Mac，用 Terminal 直接跑
`node`。影片截圖用的 `qlmanage`、圖片壓縮用的 `sips` 都是 macOS 系統內建
指令，不能在 Windows/Linux 上執行。

**不能透過 Cowork（你跟 Claude 對話的這個環境）執行**：Cowork 的 shell 是
跑在 Anthropic 雲端的隔離 Linux 環境，連不到你公司內網、也看不到任何 SMB
分享、沒有 `qlmanage`/`sips`——這幾點都已經實際測試過。所以「掃描結果對
不對、影片截圖對不對、真的能不能上傳」都需要你自己在本機跑一次回報。

## 快速執行：自動設定 + 掃描（還沒接上傳也能先跑）

```
node scripts/nas_design_image_watcher.setup.mjs
```

這支腳本會自動：檢查 NAS 分享是否已掛載、沒有的話呼叫 Finder 幫你開啟連
線視窗、掛載完成後把實際路徑寫回設定檔的 `mountRoot`、設定好後直接執行
掃描。唯一它做不到的事是幫你輸入 SMB 帳號密碼（macOS 網路磁碟機驗證機制
本身的限制），Keychain 記住之後通常就不會再跳出來。

如果自動偵測不到掛載，會印出清楚的錯誤訊息，這時候才需要走下面「手動設
定」那一段調整 `mountRoot`／`smbUrl`／`expectedVolumeName`。

## 開通「自動上傳」需要做的事（跟前面的自動掛載是兩件事）

只做完上面「快速執行」只能掃描＋產生預覽圖，**不會**寫進系統。要接上自
動上傳，需要照順序做完下面四步，這四步都不能在 Cowork 這裡完成，需要你
或另一個有部署權限的環境動手：

1. **在 Google Drive 建一個資料夾**，當作所有案件設計圖的母資料夾，複製
   它的資料夾 ID，貼進 `upload/Code.gs` 的
   `CASE_DESIGN_IMAGE_ROOT_FOLDER_ID` 常數（目前是空字串，沒填就會直接
   擋掉上傳，不會誤用到不對的資料夾）。
2. **在 Apps Script 專案設定一組服務金鑰**：Apps Script 編輯器
   →「專案設定」→「指令碼屬性」，新增一筆 `NAS_WATCHER_API_KEY`，值用一
   串隨機字串（例如 `openssl rand -hex 32` 產生）。**這組字串等一下要跟
   Worker 的 `NAS_WATCHER_API_KEY` 設成完全一樣**，兩邊各自獨立比對，只
   是剛好要用同一個值。
3. **部署 Apps Script 新版本**：upload/Code.gs 這次新增了 `doPost(e)`，
   部署設定（Deploy → Manage deployments → 編輯）裡「具有存取權的使用
   者」必須是「任何人」，不能是「必須是 Google 帳戶」，否則外部程式呼叫
   會被導去 Google 登入頁面、收不到 JSON 回應。部署完會拿到一個
   `.../exec` 結尾的網址，這就是等一下要填的 `appsScriptUploadUrl`。
4. **部署 Worker**：`cd worker && pnpm exec wrangler secret put
   NAS_WATCHER_API_KEY`（貼上跟步驟 2 同一組字串）→
   `pnpm test && pnpm check && pnpm deploy:dry` 都過了才 `pnpm deploy`。

四步都做完之後，回來改這支監控程式的設定：

- `scripts/nas_design_image_watcher.config.json` 的 `appsScriptUploadUrl`
  填步驟 3 拿到的 `.../exec` 網址；`dbJsonUrl` 預設已經填好正式站的網址，
  通常不用改。
- `scripts/nas_design_image_watcher.secrets.json`（這個檔案已加進
  `.gitignore`，不會進 git）的 `serviceKey` 填步驟 2 那組隨機字串。
- `projects` 陣列裡每個案件的 `caseId` 要換成資料庫裡真正的案件編號
  （不是資料夾名稱），這樣監控程式才找得到對應案件目前的狀態。

都填好之後執行 `node scripts/nas_design_image_watcher.mjs`（或用
`nas_design_image_watcher.setup.mjs` 一次做完掛載+掃描+上傳），輸出開頭
會顯示「上傳模式：已啟用」，掃描結果下面會多出 `[輪次判斷]`／`[上傳]` 這
兩類訊息。

## 手動設定掛載路徑（自動設定失敗時才需要看這段）

1. 在 Finder 用「前往 → 連接伺服器」（快速鍵 `Cmd+K`）連上 NAS，網址列貼：

   ```
   smb://EMCNAS_Prod.local/設計部
   ```

   不要直接拿 `smb://EMCNAS_Prod._smb._tcp.local/...` 這種網址去連線——
   `._smb._tcp.local` 是 Bonjour 用來「廣播這台 NAS 存在」的服務名稱格式，
   是拿來被探索的，不是拿來連線用的位址，直接貼去連線經常會失敗或連到不
   對的地方。

2. 連線成功後，NAS 分享會掛載成一個本機路徑，通常在 `/Volumes/設計部`
   這樣的位置，實際名稱依你的分享設定而定。連上後在 Terminal 執行
   `ls /Volumes` 確認實際掛載出來的資料夾名稱。

3. 打開 `scripts/nas_design_image_watcher.config.json`：`mountRoot` 改成
   上一步看到的實際路徑；`smbUrl`／`expectedVolumeName` 如果跟實際情況
   不同也一併改掉，改對之後下次就能直接用自動設定腳本；`projects` 陣列
   裡每一筆的 `folderPath` 是「相對於 mountRoot」的案件資料夾路徑。

4. 手動設定好之後，執行純掃描（不會嘗試自動掛載）：

   ```
   node scripts/nas_design_image_watcher.mjs
   node scripts/nas_design_image_watcher.mjs --config 其他設定檔路徑.json
   ```

## 設定檔欄位說明（`nas_design_image_watcher.config.json`）

| 欄位 | 說明 |
|---|---|
| `mountRoot` | NAS 分享掛載後的本機根目錄 |
| `smbUrl`／`expectedVolumeName` | 自動掛載用的連線位址與預期分享名稱 |
| `maxDimension`／`jpegQuality` | 預覽圖最大邊長（預設 1600px）與 JPEG 品質（預設 70） |
| `dbJsonUrl` | 案件資料庫的公開 JSON 網址，用來判斷案件目前狀態與輪次 |
| `appsScriptUploadUrl` | Apps Script Web App 的 `.../exec` 網址，留空＝只掃描不上傳 |
| `secretsFile` | 存 `serviceKey` 的檔案路徑，預設同資料夾的 `nas_design_image_watcher.secrets.json`（不進 git） |
| `projects[].caseId` | 資料庫裡的案件編號 |
| `projects[].folderPath` | 相對於 `mountRoot` 的案件資料夾路徑 |

狀態快取存在 `scripts/nas_design_image_watcher.state/sync-state.json`
（已加進 `.gitignore`），記錄每個檔案的大小/修改時間、有沒有被歸類到某一
輪、目前抓到第幾輪；預覽圖存在同資料夾的 `previews/`。刪掉整個
`nas_design_image_watcher.state/` 資料夾會讓下次執行把所有檔案當成
「新增」、所有輪次重新判斷一次（已經上傳過的圖片還是會被視為「待歸類」
再上傳一次，等於重推）。

## 已測試 / 未測試

**掃描與狀態比對邏輯**：在沙箱環境用假資料夾＋假圖檔測過——第一次執行
正確偵測全部新增、第二次執行（沒有變動）正確顯示 0 張新增變動、修改檔案
內容後正確偵測到「更新」、資料夾不存在時正確顯示錯誤訊息並回傳非 0 結束
碼。

**影片截圖／壓縮／輪次判斷／上傳的完整流程**：用假的 `sips`／`qlmanage`
指令（模擬執行成功，只做複製檔案，不驗證真正的畫質/壓縮效果）＋本機
Node HTTP 伺服器模擬 `dbJsonUrl` 與 Apps Script 上傳端點，完整測過八種情
境都正確：案件狀態非「過稿中」時不上傳；狀態變成「過稿中」時正確觸發第
0 輪（初稿）上傳且只打包待歸類的檔案；同一輪重複執行會略過、不重複上
傳；新增修改請求（等於資料庫裡出現修改次數＝1 的紀錄）後再過稿，正確判
斷為第 1 輪、且只上傳這一輪新增的檔案（不會重複上傳第 0 輪已經傳過的
圖）；資料庫查無此案件編號時正確略過並提示；只有 `sips` 沒有 `qlmanage`
時，影片正確被略過並記警告，圖片仍正常繼續上傳；服務金鑰錯誤時上傳正確
失敗並回傳非 0 結束碼；金鑰修正後重跑，正確補上傳前一次失敗、還沒被標記
為已歸類的檔案。

**還沒測試、也沒辦法在這個環境測試的部分**：
- 真正的 `qlmanage`／`sips` 執行結果（畫質、影片格式支援度、少見編碼的
  影片會不會擷取失敗）——沙箱裡是用假指令模擬「執行成功」，真正的壓縮/
  截圖效果完全沒驗證過。
- 真的連上你的 NAS、真的用 Apps Script 把圖傳進 Google Drive、真的打通
  Worker 的 `addCaseDesignImages`——這三段都需要照上面「開通自動上傳」
  的四個步驟部署完成後，才有辦法端對端測試。
- 中文檔名／案件資料夾名稱在真實 SMB 掛載下的行為。
- `open smb://...` 觸發 Finder 連線視窗、等待掛載完成這段（macOS 專屬，
  沙箱沒有 `open` 指令）。

## 下一步（還沒做）

1. 確認案件與資料夾的對應方式要不要從「手動維護 `projects` 清單」，改成
   從資料庫的案件資料裡帶一個「NAS 資料夾路徑」欄位出來自動產生。
2. 把這支程式排程執行（例如 macOS 的 launchd，或簡單用 `cron`，建議 5-10
   分鐘一次），不用每次手動跑。
3. 案件很多時，`projects` 清單會變長，可以考慮改成程式自動掃「案件資料
   夾根目錄」下的所有子資料夾，而不是一筆一筆手動列。

# NAS 設計圖檔監控程式

用途：定期掃描公司內網 NAS 共用資料夾（SMB），依「案件」找出資料夾裡新增
或有更新的圖片（`*.jpg`/`*.png`）與影片（`*.mp4`/`*.mov`/`*.m4v`，會自動用
系統內建的 `qlmanage` 擷取一張畫面當紀錄），統一用系統內建的 `sips` 壓縮
成小尺寸 JPEG 預覽圖。

**案件清單完全動態產生，不用手動維護**：每次執行會先讀一次正式站的案件
資料庫（`dbJsonUrl`），自動篩出「狀態＝過稿中」且「設計圖資料夾連結」欄
位有值的案件——這個欄位是設計師在網頁上（把案件狀態改成「過稿中」時，
或案件詳情面板的「上傳設計圖」按鈕）選「選擇 NAS 資料夾」時填入的。設計
師可以用滑鼠瀏覽 NAS 資料夾樹狀結構點選，不用自己手動輸入路徑——這是
`nas_folder_picker_server.mjs`（跟這支掃描程式共用同一份核心邏輯
`nas_design_image_lib.mjs`，各自負責「選資料夾＋立即備份一次」與「定時
掃描接手追蹤後續新增的圖」，見下面「用滑鼠選 NAS 資料夾」那一節）。

如果設定齊全，還會做「輪次判斷＋自動上傳」：這一輪還沒抓取過的時候，才
把資料夾裡「還沒歸類到任何一輪」的預覽圖打包，透過 Apps Script 上傳到
Google Drive、依 **設計師/客戶別/年度/月份/案件編號** 自動建立巢狀資料
夾存放，並寫進後台資料庫的「修改統計表」（0=初稿，1=一修，2=二修…），
案件詳情頁的「修改紀錄」彈窗就會顯示對應輪次的設計圖縮圖。

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

同樣的理由，**來源資料夾一定要是 NAS 路徑，不能是 Google Drive 連結**：
這支程式跑在你的 Mac 上、連得到公司內網，但 Google Drive 上傳那一段是靠
Apps Script（跑在 Google 雲端）完成的，Apps Script 完全連不到公司內網，
這是技術上的硬限制。目的地（Google Drive）才是 Apps Script 的責任範圍。

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
動上傳，需要照順序做完下面幾步：

1. **Google Drive 母資料夾**：已完成，`upload/Code.gs` 的
   `CASE_DESIGN_IMAGE_ROOT_FOLDER_ID` 已經填好。
2. **Apps Script 服務金鑰**：Apps Script 編輯器 →「專案設定」→「指令碼
   屬性」，新增一筆 `NAS_WATCHER_API_KEY`，值用一串隨機字串（例如
   `openssl rand -hex 32` 產生）。**這組字串要跟 Worker 的
   `NAS_WATCHER_API_KEY` 設成完全一樣**，兩邊各自獨立比對，只是剛好要用
   同一個值。如果之前已經設定過，這步可以跳過。
3. **部署 Apps Script 新版本**：`upload/Code.gs` 的 `uploadCaseDesignImages`
   這次改成會依 設計師/客戶別/年度/月份/案件編號 建立巢狀資料夾，所以即
   使之前部署過，也需要重新部署一次新版本。部署設定（Deploy → Manage
   deployments → 編輯）裡「具有存取權的使用者」必須是「**任何人**」，不
   能是「必須是 Google 帳戶」，否則外部程式呼叫會被導去 Google 登入頁
   面、收不到 JSON 回應（可以用下面的 `curl` 指令驗證）：

   ```
   curl -X POST "你的 .../exec 網址" -H "Content-Type: application/json" -d '{"action":"ping"}'
   ```

   如果回應是一段 HTML（不是 JSON），代表部署設定還不對；回應
   `{"success":false,"message":"不支援的動作：ping"}` 這種 JSON 就代表部
   署設定正確（`ping` 本來就不是這支 Apps Script 支援的動作，但至少證明
   有跑到程式碼、不是被導去登入頁）。

   部署完會拿到一個 `.../exec` 結尾的網址，這就是等一下要填的
   `appsScriptUploadUrl`。
4. **部署 Worker**（如果 `NAS_WATCHER_API_KEY` 是新設定的才需要）：
   `cd worker && npx wrangler secret put NAS_WATCHER_API_KEY`（貼上跟步驟
   2 同一組字串）→ `npx wrangler deploy`。

都做完之後，回來改這支監控程式的設定：

- `scripts/nas_design_image_watcher.config.json` 的 `appsScriptUploadUrl`
  填步驟 3 拿到的 `.../exec` 網址；`dbJsonUrl` 預設已經填好正式站的網址，
  通常不用改。
- `scripts/nas_design_image_watcher.secrets.json`（這個檔案已加進
  `.gitignore`，不會進 git）的 `serviceKey` 填步驟 2 那組隨機字串。

都填好之後執行 `node scripts/nas_design_image_watcher.mjs`（或用
`nas_design_image_watcher.setup.mjs` 一次做完掛載+掃描+上傳），輸出開頭
會顯示「上傳模式：已啟用」，掃描結果下面會多出 `[輪次判斷]`／`[上傳]` 這
兩類訊息。

## 排程執行（建議 5-10 分鐘一次）

不用每次手動跑，可以排程背景定時執行。任選一種：

**方式一：`crontab`（比較簡單）**

```
crontab -e
```

加一行（`node` 路徑用 `which node` 確認，`<repo路徑>` 換成這個專案在你
電腦上的實際路徑）：

```
*/5 * * * * cd <repo路徑> && /usr/local/bin/node scripts/nas_design_image_watcher.mjs >> ~/Library/Logs/nas-watcher.log 2>&1
```

**方式二：`launchd`（macOS 原生排程，開機後自動生效，不用登入終端機）**

建立 `~/Library/LaunchAgents/com.emctaipei.nas-watcher.plist`（同樣要把
`<repo路徑>`／`<node路徑>` 換成實際值）：

```xml
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN"
  "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key>
  <string>com.emctaipei.nas-watcher</string>
  <key>ProgramArguments</key>
  <array>
    <string>&lt;node路徑&gt;</string>
    <string>&lt;repo路徑&gt;/scripts/nas_design_image_watcher.mjs</string>
  </array>
  <key>StartInterval</key>
  <integer>300</integer>
  <key>StandardOutPath</key>
  <string>/tmp/nas-watcher.log</string>
  <key>StandardErrorPath</key>
  <string>/tmp/nas-watcher.log</string>
</dict>
</plist>
```

載入：

```
launchctl load ~/Library/LaunchAgents/com.emctaipei.nas-watcher.plist
```

不管哪一種方式，NAS 分享都要先手動掛載一次（跑過一次
`nas_design_image_watcher.setup.mjs` 或手動用 Finder 連線），排程執行的
版本不會自動幫你跳出連線視窗處理帳密。

**資料夾選擇器伺服器（`nas_folder_picker_server.mjs`）要常駐，不是排程**：
它是一支會一直監聽連線的伺服器，不是「每隔幾分鐘執行一次就結束」的程
式，所以用 `launchd` 的 `KeepAlive`（掛掉自動重啟）而不是 `StartInterval`
（定時啟動）：

```xml
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN"
  "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key>
  <string>com.emctaipei.nas-folder-picker</string>
  <key>ProgramArguments</key>
  <array>
    <string>&lt;node路徑&gt;</string>
    <string>&lt;repo路徑&gt;/scripts/nas_folder_picker_server.mjs</string>
  </array>
  <key>RunAtLoad</key>
  <true/>
  <key>KeepAlive</key>
  <true/>
  <key>StandardOutPath</key>
  <string>/tmp/nas-folder-picker.log</string>
  <key>StandardErrorPath</key>
  <string>/tmp/nas-folder-picker.log</string>
</dict>
</plist>
```

存成 `~/Library/LaunchAgents/com.emctaipei.nas-folder-picker.plist`，
`launchctl load` 載入方式跟上面一樣。

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
   不同也一併改掉，改對之後下次就能直接用自動設定腳本。

4. 手動設定好之後，執行純掃描（不會嘗試自動掛載）：

   ```
   node scripts/nas_design_image_watcher.mjs
   node scripts/nas_design_image_watcher.mjs --config 其他設定檔路徑.json
   ```

## 用滑鼠選 NAS 資料夾（`nas_folder_picker_server.mjs`）

網站是 `https://emctaipeiart.github.io`（HTTPS），這支資料夾選擇器伺服器
只在辦公室內網、沒有 HTTPS 憑證，瀏覽器的 Mixed Content 規則會直接擋掉
「HTTPS 頁面用 fetch 呼叫 HTTP 網址」，內網 IP 也不例外——所以網站不是直
接呼叫這支伺服器的 API，而是用 `window.open()` 開一個新分頁導到這支伺服
器自己提供的網頁（開新分頁屬於「導覽」，不受 Mixed Content 限制），設計
師在新分頁裡瀏覽/點選資料夾後，這個新分頁用 `postMessage` 把選到的路徑
丟回原本的分頁，寫回案件資料庫的還是網站本身既有的邏輯（跟過去手動貼路
徑寫回的是同一個欄位、同一套權限檢查），這支伺服器完全不需要知道任何登
入 token 或資料庫寫入邏輯。

**點「選擇這個資料夾並備份」時會立即備份一次**：這支伺服器不只列出資料
夾名稱，選定資料夾的當下還會用 `nas_design_image_lib.mjs`（跟
`nas_design_image_watcher.mjs` 共用同一份核心邏輯）立刻掃描這個資料夾、
把目前已經存在的圖片/影片打包上傳一次，不用等背景監控程式下一輪輪詢（5-
10 分鐘）才處理；之後案件維持過稿中期間，同一資料夾若又新增圖片，就交給
背景監控程式接手——兩支程式讀寫同一份 `sync-state.json`，不會對同一批圖
重複上傳。就算這次立即備份失敗（例如網路不穩、Apps Script 暫時連不上），
資料夾路徑一樣會登記成功，只是提示「備份失敗，背景程式下次輪詢會自動重
試」，不會因為備份失敗就連路徑都沒登記到。

**開啟時會自動猜一個起始資料夾**：不用每次都從根目錄一層一層點——伺服器
會依這個案件的「客戶別」，在 `defaultBrowseRoot`（設定檔欄位，例如
`專案企劃部/執行中`）底下找同名子資料夾，找到就直接開到那一層（畫面上方
會有一行綠色提示「已自動開啟到『Epson』資料夾」之類的文字）；找不到就停
在 `defaultBrowseRoot` 這一層。不管哪種情況，麵包屑都會顯示完整路徑，隨
時可以點回任何上層資料夾，不會被鎖死在猜測結果裡。

**執行方式**（跟 `nas_design_image_watcher.mjs` 共用同一份
`nas_design_image_watcher.config.json`，讀同一個 `mountRoot`）：

```
node scripts/nas_folder_picker_server.mjs
```

第一次執行會自動在 `nas_design_image_watcher.secrets.json` 產生一組
`pickerToken`（隨機字串），並把它印在畫面上。**這個值要手動填進
`index.html` 的兩個常數**：

```js
const nasFolderPickerBaseUrl='http://<這台機器的區網位址>:8877/picker'; // 例如 http://Machi-Mac.local:8877/picker
const nasFolderPickerToken='<剛剛印出來的 pickerToken>';
```

（在 `index.html` 搜尋 `nasFolderPickerBaseUrl` 即可找到，兩個常數目前預
設是空字串——沒填之前，設計師點「選擇 NAS 資料夾」會看到「尚未設定」的
提示，但「選擇電腦檔案上傳」那個選項完全不受影響，照樣能用。）

因為這支伺服器只在辦公室內網開放，`pickerToken` 只是擋掉同一個網路上隨
手戳這支 API 的人，**不是真正的機密**——`index.html` 是公開網站，這個值
一定會出現在原始碼裡，任何看得到原始碼的人都看得到它；真正的防線是「這
支伺服器本來就連不到辦公室外」。

因為設計師隨時可能把案件標記過稿中，這支伺服器需要**常駐執行**（不像
`nas_design_image_watcher.mjs` 是定期跑一次就結束），建議跟下面「排程執
行」用同一台機器，用 `launchd` 的 `KeepAlive` 讓它常駐（見下面 launchd 範
例，`RunAtLoad`＋`KeepAlive` 那個寫法就是為了常駐服務設計的，跟排程用的
`StartInterval` 是兩種不同的 launchd 用法）。

## 同一個資料夾混有多個案件的檔案怎麼辦（檔名關鍵字比對＋忽略資料夾）

實務上很多客戶的 NAS 資料夾不是「一個案件一個專屬資料夾」，而是「一個月
份資料夾底下同時放好幾個案件的檔案」（例如 `.../2026/8月/` 裡混著這個月
所有平面案件的圖），選資料夾時只能選到這個共用的月份資料夾，沒有更細的
層級可以選。這支程式用兩道機制處理這個情況：

1. **忽略資料夾名稱（`ignoreFolderNames`）**：掃描時會整個跳過、不遞迴進
   去某些已知不是設計交付圖的資料夾——預設是 `["Links"]`（很多資料夾底下
   會有一個「Links」子資料夾放共用參考素材，不是這次要交的設計圖）。可以
   在 `nas_design_image_watcher.config.json` 的 `ignoreFolderNames` 陣列裡
   加更多名稱，不用改程式碼；比對時去頭尾空白、不分英文大小寫。
2. **檔名關鍵字（案件的「設計圖檔名關鍵字」欄位）**：設計師在 NAS 資料夾
   選擇器（`nas_folder_picker_server.mjs`）選好資料夾的畫面上，除了選資料
   夾本身，還有一個文字欄位可以填「檔名關鍵字」（例如產品代號
   `DJI_360II`，或專案名稱片段）。填了之後，這個資料夾底下**只有檔名包含
   這個關鍵字的圖片/影片**才會被當成這個案件的設計圖，同資料夾裡其他案件
   的檔案（檔名不含這個關鍵字）完全不會被抓取——不只是初稿，**一修、二修
   等後續每一輪也會沿用同一個關鍵字**，所以不需要每一輪重新設定。這個欄
   位留白的話，行為退回舊版（資料夾底下所有檔案都算，只排除
   `ignoreFolderNames` 裡的資料夾），選擇器畫面上留白按下確認時會另外跳一
   次警告，提醒可能誤抓其他案件的圖，但不會強制擋下（有些案件真的有專屬
   資料夾，不需要關鍵字也沒問題）。
   - 重新開啟選擇器（例如換一個資料夾、或想幫舊案件補填關鍵字）時，畫面
     會自動帶出這個案件目前已經存的關鍵字，不用重新輸入。
   - 也可以直接到資料庫後台（`json_database_admin.html`）的「database」表
     手動編輯該案件列的「設計圖檔名關鍵字」欄位，不透過選擇器畫面。
   - 關鍵字比對是「檔名裡有沒有包含這段文字」（不分大小寫的子字串比對），
     不是規則運算式，也不會嘗試模糊比對相似的檔名——設計師如果把檔案存成
     完全不含關鍵字的新檔名，仍然會抓不到，這點跟既有的「待修改圖片」目
     標檔名比對是同一種限制。
   - 如果案件先前已經在沒有設定關鍵字的情況下抓過幾輪（可能已經誤抓了其
     他案件的圖），事後補填關鍵字不會自動清掉先前誤抓的圖片，需要到案件
     詳情或「修改紀錄」彈窗手動用既有的刪除圖片功能個別移除。

## 「NAS 資料夾路徑」要怎麼寫（備用：資料庫後台手動改欄位）

前台目前沒有「手動貼路徑」的輸入框，只有「選擇 NAS 資料夾」（用上面的選
擇器）跟「選擇電腦檔案上傳」兩個選項。如果選擇器伺服器還沒設定好、又想
先手動指定某個案件的來源資料夾，可以到資料庫後台
（`json_database_admin.html`）的「database」表，直接編輯該案件列的「設計
圖資料夾連結」欄位。不管是用選擇器選的、還是後台手動填的，寫進去的都是
同一個欄位，這支掃描程式不分辨來源，開頭可以帶分享名稱本身、也可以不
帶，會自動判斷：

- `/設計部/專案企劃部/執行中/Epson/FB發文圖檔/2026/8月/260811_案件資料夾`
  （開頭含分享名稱「設計部」）
- `專案企劃部/執行中/Epson/FB發文圖檔/2026/8月/260811_案件資料夾`
  （純相對路徑，不含分享名稱）

兩種寫法都能正確接到 `mountRoot` 底下掃描到同一個資料夾。**不要貼
`smb://...` 開頭的完整網址**（那是連線位址，不是掛載後的資料夾路徑）；
如果不小心貼了，程式會自動把 `smb://主機名稱/` 這段去掉再處理，但保險起
見還是建議直接貼「相對路徑」比較不會出錯。

## 設定檔欄位說明（`nas_design_image_watcher.config.json`）

| 欄位 | 說明 |
|---|---|
| `mountRoot` | NAS 分享掛載後的本機根目錄 |
| `smbUrl`／`expectedVolumeName` | 自動掛載用的連線位址與預期分享名稱 |
| `maxDimension`／`jpegQuality` | 預覽圖最大邊長（預設 1600px）與 JPEG 品質（預設 70） |
| `dbJsonUrl` | 案件資料庫的公開 JSON 網址，**必填**，案件清單完全靠它動態算出 |
| `appsScriptUploadUrl` | Apps Script Web App 的 `.../exec` 網址，留空＝只掃描不上傳 |
| `secretsFile` | 存 `serviceKey`／`pickerToken` 的檔案路徑，預設同資料夾的 `nas_design_image_watcher.secrets.json`（不進 git） |
| `pickerPort` | `nas_folder_picker_server.mjs`（資料夾選擇器伺服器）監聽的埠號，預設 8877，只有跑那支程式時才會用到 |
| `defaultBrowseRoot` | 資料夾選擇器開啟時的預設瀏覽起點（相對於 `mountRoot`），選擇器會在這一層底下找跟案件客戶別同名的子資料夾直接打開；留空＝從根目錄開始，只有跑 `nas_folder_picker_server.mjs` 時才會用到 |
| `ignoreFolderNames` | 掃描時整個跳過、不遞迴進去的資料夾名稱清單（不分大小寫比對），預設 `["Links"]`；同一個案件底下實際要抓哪些檔案主要靠案件的「設計圖檔名關鍵字」欄位比對檔名，這裡只負責排除整個資料夾層級的已知非設計圖來源 |

狀態快取存在 `scripts/nas_design_image_watcher.state/sync-state.json`
（已加進 `.gitignore`），記錄每個檔案的大小/修改時間、有沒有被歸類到某一
輪、目前抓到第幾輪；預覽圖存在同資料夾的 `previews/`。刪掉整個
`nas_design_image_watcher.state/` 資料夾會讓下次執行把所有檔案當成
「新增」、所有輪次重新判斷一次（已經上傳過的圖片還是會被視為「待歸類」
再上傳一次，等於重推）。

## 已測試 / 未測試

**掃描與狀態比對邏輯**、**案件動態發現、路徑解析（含分享名稱前綴 vs. 相
對路徑兩種寫法）、輪次判斷、上傳 payload 帶 designer/client/year/month**：
用假的 `sips`／`qlmanage` 指令（模擬執行成功，只做複製檔案，不驗證真正
的畫質/壓縮效果）＋本機 Node HTTP 伺服器模擬 `dbJsonUrl` 與 Apps Script
上傳端點，完整測過：兩種路徑寫法都正確解析到同一層掃描目錄、狀態非過稿
中或沒填連結的案件正確被排除在外、第 0 輪（初稿）正確上傳且只打包新增
檔案、同一輪重複執行正確略過不重複上傳、修改統計表出現第 1 輪紀錄後正
確只上傳新增的那 1 個檔案（不重傳第 0 輪已經傳過的）、影片正確產生預覽
圖、上傳 payload 內容正確帶上 designer/client/year/month。

**檔名關鍵字比對＋忽略資料夾（`ignoreFolderNames`／案件「設計圖檔名關鍵
字」）**：用假的 `sips`／`qlmanage`＋假掛載資料夾完整重現使用者實際回報
的情境——同一個「8月」共用資料夾底下同時放著這個案件的檔案
（`260810_DJI_360II_...png`）、另一個不相關案件的檔案
（`260811_OtherProduct_...png`）、以及一個 `Links` 參考素材子資料夾——驗
證過：①`walkMedia` 完全不會遞迴進 `Links` 資料夾，裡面的檔案不管有沒有
設定關鍵字都不會出現在掃描結果裡；②設定關鍵字後，`scanProject` 只會把
檔名包含關鍵字的檔案視為這個案件的候選（不分大小寫），不相關案件的檔案
正確被排除、並算進 `skippedByKeywordCount`；③沒有設定關鍵字（舊案件相容
情境）時退回原本行為，`Links` 以外的檔案全部算數；④**一修/二修驗證**：
第 0 輪上傳成功、標記 `assignedRound` 之後，同資料夾新增一個仍符合關鍵字
的「一修」檔案＋一個不符合關鍵字的其他案件「一修」檔案，重新掃描只會把
符合關鍵字的那個判定成新增項目，另一個正確被關鍵字擋下，且第 0 輪的檔案
不會被重複判定成新增（不會重複上傳）；⑤透過真的啟動
`nas_folder_picker_server.mjs`＋假 `dbJsonUrl`／Apps Script 端點做端對端
測試：`/api/default-path` 正確把案件既有的關鍵字一併回傳（供選擇器畫面
預先帶出）；`/api/confirm` 帶關鍵字時只會把符合的那一張圖真的傳給 Apps
Script（`curl` 驗證上傳呼叫的 `images` 陣列裡確實只有那一張、檔名正
確）；同一資料夾之後改用空白關鍵字重新確認一次，正確把先前被關鍵字擋下
（因此從未被追蹤過）的另一張圖片當成新增項目上傳，同時第 0 輪已上傳過的
檔案不會被重複上傳、`Links` 資料夾內容全程都沒有被觸碰。

**資料夾選擇器伺服器（`nas_folder_picker_server.mjs`）**：因為這支伺服器
本身是純 Node.js（不需要 macOS 專屬指令，「立即備份」用到的 `sips`／
`qlmanage` 除外），用假的掛載資料夾（一般暫存目錄，不是真的 SMB 掛載點）
在沙箱裡實際啟動、實際測過：token 驗證（沒帶/帶錯 token 正確回 401）、路
徑穿越保護（`../../etc` 這類會被過濾掉，不會跳出 `mountRoot` 範圍）、資
料夾列表 API 正確回傳子資料夾清單、瀏覽器實際載入 `/picker` 頁面並點擊
資料夾逐層深入、麵包屑導覽正確可以跳回上層、按「選擇這個資料夾並備份」
正確關閉分頁（`window.close()` 真的把分頁關掉了）。也在 `index.html` 端
用假的 `window.open`／`accessAllowed` 存根，驗證了：標記過稿中會跳出
「NAS 資料夾／電腦檔案上傳」選擇彈窗（不是直接跳其中一個）、點「選擇
NAS 資料夾」會用正確的 `caseId`/`token`/`nonce`/`origin` 開新分頁、收到
帶正確 nonce 的 `postMessage` 會正確寫回 `designImageFolderUrl`、nonce 不
符或路徑是空的都正確被擋下不會誤寫。

**`/api/default-path`（依客戶別猜起始資料夾）**：用假的 `dbJsonUrl` 與假
掛載目錄完整測過三種情境——①客戶別有對應到子資料夾，正確回傳該子資料夾
路徑且 `matched:true`；②客戶別存在但資料夾裡沒有對應名稱，正確 fallback
回 `defaultBrowseRoot` 這一層並附上「找不到對應資料夾」的提示；③案件編
號在資料庫裡查不到，正確 fallback 回 `defaultBrowseRoot`（讀不到 dbJsonUrl
也一樣正確 fallback，不會讓整個選擇器打不開）。大小寫不同（如 `epson` vs
`Epson`）也驗證過能正確配對。

**`/api/confirm`（立即備份）**：用假的 `sips`／`qlmanage`（模擬執行成功，
只做複製檔案）＋假 `dbJsonUrl`／Apps Script 上傳端點完整測過：選定資料夾
後正確跑一次 `scanProject`＋輪次判斷＋上傳，回傳的 `backup.uploadedCount`
正確反映實際上傳張數；上傳端點刻意回傳失敗時，`/api/confirm` 仍然回應
`success:true`（路徑本身有效）且 `backup.message` 帶著失敗原因，不會讓整
個資料夾選擇流程失敗；案件編號在資料庫查不到時，同樣正確回應
`success:true`（僅登記路徑，不嘗試備份）；同一個資料夾連續呼叫兩次
`/api/confirm`，第二次正確判斷「沒有新的檔案可上傳」（因為第一次已經把
檔案標記為已歸類到該輪），不會重複上傳同一批圖片；跟
`nas_design_image_watcher.mjs` 的批次執行共用同一份假狀態檔測試，確認兩
支程式對同一批檔案的「已處理」判斷完全一致，不會互相重複上傳。

**已知但刻意接受的風險（不是 bug）**：`nas_folder_picker_server.mjs` 的
`/api/confirm` 跟 `nas_design_image_watcher.mjs` 的排程執行是兩支各自獨
立的行程（process），如果剛好同一時間都在處理同一個案件（例如使用者剛
好在點「選擇這個資料夾並備份」的當下，背景排程也剛好在跑那一輪掃描），
兩邊各自讀狀態檔、各自寫回，存在極小的競態窗口：最壞結果是同一批圖片被
上傳兩次（Google Drive 裡多一份重複檔案），不會遺失資料或寫壞狀態檔。目
前沒有加檔案鎖處理這個情況——機率很低（背景排程一般是 5-10 分鐘一次，跟
使用者手動點選重疊的機率很小），加鎖的複雜度暫時不划算，先接受這個風險
並記錄下來。

**還沒測試、也沒辦法在這個環境測試的部分**：
- 真正的 `qlmanage`／`sips` 執行結果（畫質、影片格式支援度、少見編碼的
  影片會不會擷取失敗；這次新增的 `.webp` 副檔名支援也還沒驗證過
  `sips` 真的能不能正確讀取 WebP 來源檔——沙箱環境沒有 macOS，無法測
  試）——沙箱裡是用假指令模擬「執行成功」，真正的壓縮/截圖效果完全沒驗
  證過。
- 資料夾選擇器伺服器真的連上你的 NAS、辦公室內網其他機器（不是伺服器自
  己那台）用區網 IP／`.local` 主機名稱真的連得到這支伺服器、Safari／
  Chrome 對「開新分頁導到 HTTP 網址」的實際行為（理論上「導覽」不受
  Mixed Content 限制，但實機瀏覽器有沒有額外的彈出視窗警告、有沒有因為
  網站是 HTTPS 而在新分頁上顯示「不安全」提示影響操作，都沒有實測過）。
- `index.html` 裡的 `nasFolderPickerBaseUrl`／`nasFolderPickerToken` 目前
  是空字串（未設定），需要你在跑起資料夾選擇器伺服器、拿到區網位址與
  `pickerToken` 之後手動填入才會生效；填之前「選擇 NAS 資料夾」會顯示清
  楚的「尚未設定」提示，不影響「選擇電腦檔案上傳」那個既有選項。
- 真的連上你的 NAS、真的用 Apps Script 把圖傳進 Google Drive、真的打通
  Worker 的 `addCaseDesignImages`、真的在 Google Drive 裡看到
  設計師/客戶別/年度/月份/案件編號 這樣的巢狀資料夾結構——這幾段都需要
  照上面「開通自動上傳」的步驟部署完成後，才有辦法端對端測試。
- 中文檔名／案件資料夾名稱在真實 SMB 掛載下的行為，包含「依客戶別猜起始
  資料夾」這個新功能——沙箱測試只用過純 ASCII 的假客戶名稱（如
  `Epson`），真實客戶別大多是中文，中文資料夾名稱在比對時理論上不受影響
  （用的是完整字串相等比對，不是英文專屬的大小寫轉換），但沒有用真實中
  文客戶名稱＋真實 NAS 資料夾實測過，全形/半形空白、中英文混排這類邊界
  情況也還沒驗證。
- `open smb://...` 觸發 Finder 連線視窗、等待掛載完成這段（macOS 專屬，
  沙箱沒有 `open` 指令）。
- `launchd`／`cron` 排程本身有沒有正確按時觸發（只能在真正排程一段時間
  後看 log 檔案確認）。
- 「立即備份」跟背景排程真的同時對同一個案件執行的競態情況（見上面「已
  知但刻意接受的風險」），只能在理論上推導，沒辦法在沙箱裡真的讓兩支程
  式同時搶同一份狀態檔測試出實際後果。
- **「設計圖檔名關鍵字」的選擇器畫面互動沒有用真實瀏覽器點過**：新增的
  關鍵字輸入框、留白時跳出的 `confirm()` 警告視窗、`showErrorPrompt()`
  換掉整個畫面之後「重試」是否正確沿用剛剛填過的關鍵字（`lastKeywordValue`
  這個備援變數），這幾塊只用程式碼推理＋沙箱裡直接呼叫 API 驗證邏輯正
  確，沒有像上一輪那樣實際用 Browser pane 點過 `/picker` 頁面操作一次。
- 這次同時修改了 `worker/src/model.ts`／`worker/src/database-coordinator.ts`
  （新增 `designImageFolderKeyword` 欄位映射與權限放寬），這台機器的
  `worker/node_modules` 是 macOS arm64 原生執行檔，這個沙箱是 Linux，
  `tsc --noEmit`／`vitest run` 都因為平台不合直接報錯（`Unable to resolve
  @typescript/typescript-linux-arm64`／`Cannot find module
  '@rolldown/binding-wasm32-wasi'`），跟過去幾次修改 Worker 時遇到的環境
  限制一樣。這次的 TypeScript 改動範圍很小（一行 `KEY_TO_HEADER` 映射、
  把單一字串比對換成兩個字串陣列的 `.every(...includes(...))` 比對），
  已經人工比對過既有寫法確認型別正確，並在 `worker/test/index.test.ts`
  補了新的測試案例，但**這次沒有機會真的在這個環境跑過 `pnpm test`／
  `pnpm check`／`pnpm deploy:dry`**，需要你在自己的 Mac 上執行一次確
  認，部署前務必照 [CLAUDE.md](CLAUDE.md) 慣例跑 `cd worker && pnpm test
  && pnpm check && pnpm deploy:dry`，過關後才 `pnpm deploy`。

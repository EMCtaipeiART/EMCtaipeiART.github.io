# EMC Character Atelier

獨立靜態展示頁：`/character-studio/`，不修改現有案件管理頁。

以 HTTP 伺服器提供專案根目錄後開啟此路徑。Three.js r170、OrbitControls、GLTFExporter 均保存在 vendor，授權見 vendor/LICENSE；Google 字型失敗時會使用系統字型。

## 本次資產範圍

11 位角色均由程式建立真正立體幾何，非圖片轉盤。每位角色有 15 個骨架節點，各網格以單骨骼剛性權重綁定。待機、走路及跑步是原地示範動作，並不包含場景移動控制。配件、髮型與服裝為簡化近似，並未精細還原三視圖。廖秦葦的坐騎在本版作為身旁配件，不包含騎乘姿勢。

models/ 提供各角色 GLB，可匯入 Blender。頁面也可下載目前角色，包含 idle、walk、run 動畫。正式製作仍需網格拓樸、接縫修正、材質貼圖、平滑權重、關節變形與碰撞測試。此版不等同人工精修、可直接量產的角色模型。

## 維護

- studio.js：角色參數、幾何建模、骨架、動畫、GLB 匯出。
- references/：使用者提供的 33 張原始三視圖副本；來源 exports/ 為 git 忽略目錄，所以提供可獨立部署的副本。
- verify.mjs：使用現有 puppeteer-core 與本機 Chrome，先在 4178 啟動根目錄靜態伺服器再執行 `node character-studio/verify.mjs`。驗證 11 位角色、骨架、篩選、放大圖、GLB 結構及手機溢出。
- export-all.mjs：在同一伺服器下以瀏覽器批次下載 GLB 至 models/。

網站尚未推送或正式部署。

## Amber 外觀修訂 v2（2026-10-18）

Amber 改用 `amber.js` 專用曲面模型：UV 臉部彩繪、漸變腮紅、可變截面捲髮與挑染、弧形帽沿與帽子縫線、襯衫領片／門襟、寬褲與鞋底細節。仍為程序化模型與剛性蒙皮，沒有宣稱忠實精修還原。其餘十位維持 v1 原型。models/EMC_Amber_prototype.glb 已替換為 v2，含三組動作。`check-amber.mjs` 可擷取側面與背面供檢查。

## 全員外觀修訂 v2（2026-10-18）

十一位皆已套用第二版曲面臉型、五官彩繪、獨立髮型及服裝。`amber.js` 現為共用建模函式，依角色參數分流長捲髮、長直髮、短髮、短鮑伯與光頭；`character-details.js` 管理眼鏡、服裝圖樣、肩包、項鍊與玩偶等個別特徵。全部 models/ GLB 已重新匯出，保留十五骨架節點與三組動作。`check-collection.mjs` 提供全員正面圖集，並逐一操作跑步及背面視角。仍為程序化近似模型，不宣稱完整精修還原。

# v3b 修正需求（以 v3.html 為基礎）

請建立 design/overtime-fx/v3b.html（不要改 v1/v2/v3，不要改此資料夾外任何檔案）。保留 v3 的視覺：舞台聚光、藍紫鬼火三簇繞身緩慢公轉、整身冷色調、腳底錨點定位、不依賴臉部位置。

## 修正一：效能（手機發燙）
- drawOvertimeFx(ctx, feetX, feetY, H, t, sprite) 簽名不變。
- 暗角、光錐、地面光斑：第一次用到時畫進離屏 canvas，依 H 四捨五入到 8px 的 bucket 快取（Map），之後每幀只 drawImage，不再每幀 createRadialGradient/createLinearGradient。
- 像素鬼火：預畫成小 canvas（含光暈），快取；公轉位置與忽明忽暗只用 globalAlpha 與座標變化，不再逐點 fillRect。
- 閃爍（光錐亮度微變）用 globalAlpha 控制。
- 疲憊色調：不要用 ctx.filter（iOS Safari 不支援）。改成快取的離屏 canvas：先 drawImage(sprite)，再用 globalCompositeOperation='source-atop' 疊冷藍灰 rgba（例如 rgba(120,140,180,.32)）達成降飽和感，並用 'multiply' 或 'source-atop' 疊淡色壓暗。快取 key 為 sprite（WeakMap），若 sprite 有 width/height 變化要重建。
- 每幀每人 drawImage 次數控制在約 6 次以內，不得有大面積 createGradient。
- 頁面內加一個效能面板：顯示 drawOvertimeFx 三人合計平均耗時（ms，用 performance.now() 取最近 60 次平均）。

## 修正二：亮底也看得到聚光燈
- 頁面加「背景：深色／白色」切換鈕，白色模式背景為 #ffffff 地板（桌椅改成淺灰線稿風），兩種背景都要能看出聚光燈。
- 不能只靠「白光」表現聚光：光錐加上 1px 偏藍紫細邊線（約 rgba(120,110,255,.55)），地面光斑外圈加一圈細橢圓光環，光錐內部淡藍白漸層（亮底時用較飽和的淡藍 rgba(150,180,255,.22) 以便看得見）。
- 暗角改為偏藍紫的柔和陰影（rgba(40,35,90,α)），不要純黑；深色背景 α 約 0.55，亮色背景 α 約 0.22。
- 函式新增第七個選填參數 opts = { light: false } ；opts.light 為 true 時用亮底參數組，false 用暗底參數組。快取 key 需包含此旗標。
- 頁面切換背景時，同步傳入 opts.light。

## 其他
- 動畫維持 10fps、requestAnimationFrame 節流、暫停鈕保留。
- 頁面標題 V3b · 最後的聚光（效能版）。
- 檔案必須是 UTF-8、單檔、無外部相依；中文不得變成問號亂碼。
- 完成後在 README.md 結尾追加一節「v3b 修正說明」，說明快取策略與亮暗底參數。

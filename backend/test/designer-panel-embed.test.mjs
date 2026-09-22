import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '../..');
const indexHtml = () => readFile(path.join(root, 'index.html'), 'utf8');
const officeHtml = () => readFile(path.join(root, 'EMC-ART-Pixel-Office/dist/index.html'), 'utf8');
const officeCss = () => readFile(path.join(root, 'EMC-ART-Pixel-Office/dist/style.css'), 'utf8');
const officeJs = () => readFile(path.join(root, 'EMC-ART-Pixel-Office/dist/app.js'), 'utf8');

function renderDesignersSource(html) {
  const start = html.indexOf('function renderDesigners(){');
  assert.notEqual(start, -1, '找不到 renderDesigners');
  return html.slice(start, html.indexOf('let activeDesignerStoryPlayback=null;', start));
}

test('「設計師專長與案件分配」嵌入像素辦公室，而不是畫設計師卡片', async () => {
  const source = renderDesignersSource(await indexHtml());
  assert.match(source, /class="office-embed"/, '應該嵌入像素辦公室');
  // 相對路徑：線上與本機預覽都會指到同一個 repo 裡的那份。
  assert.match(source, /src="EMC-ART-Pixel-Office\/dist\/\?embed=1&amp;v=32"/);
  assert.doesNotMatch(source, /designer-card/, '不該再畫設計師卡片');
  assert.doesNotMatch(source, /avatar-frame|avatar-shell/, '不該再畫頭像');
});

test('案件資料刷新時不會重新載入 iframe', async () => {
  const source = renderDesignersSource(await indexHtml());
  // renderDesigners 會被定時的背景刷新一直呼叫；每次重寫 innerHTML 會讓場景整個重載。
  assert.match(source, /if\(!designerRoster\.querySelector\('\.office-embed'\)\)/,
    'iframe 只能在還沒建立時才寫入');
});

test('嵌入場景放大並可點選人物，不顯示完整畫面按鈕', async () => {
  const html = await indexHtml();
  const source = renderDesignersSource(html);
  assert.doesNotMatch(html, /設計部現在的樣子——狀態會自動更新。/);
  assert.doesNotMatch(source, /office-embed-link|完整畫面/);
  assert.match(html, /\.top\{grid-template-columns:minmax\(280px,\.8fr\) minmax\(0,1\.2fr\)/,
    '首頁應恢復原本的左右欄比例');
  assert.match(html, /\.office-embed\{pointer-events:auto\}/,
    'iframe 應接受點選人物的滑鼠事件');
  assert.doesNotMatch(html, /office-embed-shell\{aspect-ratio:11\/8\}/,
    '外框應維持原本比例，不因內容放大而改變');
  assert.match(html, /#designerPanel\{display:flex;flex-direction:column\}/,
    '桌機版左側卡片應以垂直 flex 填滿對齊後的高度');
  assert.match(html, /#designerPanel \.office-embed-shell\{position:absolute;inset:0;width:100%;height:100%;aspect-ratio:auto\}/,
    '像素辦公室視窗應填滿左側剩餘高度，不留空白');
  assert.match(html, /\[designer,recent\]\.forEach\(panel=>\{[\s\S]*?panel\.style\.setProperty\('height',`\$\{height\}px`,'important'\)/,
    '左右卡片要同時套用較高的高度，底邊才會切齊');
});

test('頭像、限時動態、大海報與分享音樂都從前台下架', async () => {
  const html = await indexHtml();
  assert.match(html, /\.designer-setting-photo,\.designer-setting-music\{display:none!important\}/,
    '設計師設定裡的管理照片與分享音樂要收起來');
  assert.doesNotMatch(html, /點擊頭像可觀看限時動態與大海報/, '使用說明不該再提頭像');
  assert.doesNotMatch(html.slice(0, html.indexOf('</head>')), /assets\/designers\/[^"']+-avatar\.jpg/,
    '首頁不該再預載已下架的頭像');
  assert.match(html, /const \[profilesResult\]=await Promise\.allSettled\(\[fetchDesignerProfiles\(\)\]\)/,
    '前台不再取得 Reels');
  assert.match(html, /const storyItems=\[\];/,
    '前台不再顯示已沒有可開啟入口的限動通知');
  // 技能設定要留著——遊戲的人物卡還在用。
  assert.match(html, /1\. 設計師技能設定/);
});

test('像素辦公室的嵌入模式只留場景與可點選的人物卡', async () => {
  const [html, css, js] = await Promise.all([officeHtml(), officeCss(), officeJs()]);
  assert.match(js, /const embedMode=new URLSearchParams\(location\.search\)\.get\('embed'\)==='1'/);
  assert.match(js, /if\(embedMode\)\{document\.documentElement\.classList\.add\('embed'\);/);
  // 頁首、右側編輯工具、名單與標題列都不顯示，人物資料卡保留。
  for (const selector of ['header', 'aside', '.scene-bar', '.scene-foot', '#roster']) {
    assert.ok(new RegExp(`body\\.embed[^{]*${selector.replace('.', '\\.').replace('#', '#')}`).test(css)
      || css.includes(`html.embed ${selector}`), `嵌入模式應該隱藏 ${selector}`);
  }
  assert.doesNotMatch(css, /html\.embed[^\n{]*\.person-card\{display:none!important\}/,
    '嵌入模式不可隱藏人物卡');
  assert.match(js, /game\.addEventListener\('pointerdown',e=>\{if\(!ready\)return;/,
    '嵌入場景要能點選人物');
  assert.match(js, /game\.addEventListener\('pointermove',e=>\{const hit=hitAt\(e\.clientX,e\.clientY\);game\.style\.cursor=hit\?'pointer':'default';/,
    '人物上方應顯示可點選游標');
  // 姓名牌不再需要「下排特別上移」的特例：整排已經收上來，而且 fitEmbedView() 會把六個座位
  // 連同姓名牌整塊放進框裡，不會被底邊裁掉。
  assert.match(js, /labelY=s\.y\+56/);
  assert.doesNotMatch(js, /embedMode&&s\.y>500/, '不該再用下排特例調姓名牌');
  // 大小與位置由 fitEmbedView() 算，CSS 不再寫死放大倍率與位移。
  assert.doesNotMatch(css, /html\.embed #game\{width:\d/, '不該再用寫死的百分比放大');
  assert.match(css, /html\.embed #game\{position:absolute;top:0;left:0;max-width:none;display:block;transform-origin:top left/);
  assert.match(css, /html\.embed \.canvas-wrap\{position:relative;margin:0;overflow:hidden\}/,
    '放大後超出外框的場景應裁切在 iframe 內');
  assert.match(css, /html\.embed \.person-card-head,html\.embed \.person-card-title\{overflow-wrap:normal/,
    '名字與職稱不該被 overflow-wrap:anywhere 拆成單字');
  assert.doesNotMatch(css, /html\.embed \.person-card\{position:fixed!important;inset:8px!important/,
    '小螢幕人物卡不可再滿版');
  assert.match(js, /window\.addEventListener\('keydown',e=>\{if\(embedMode\|\|/,
    '嵌入場景仍不接受鍵盤方向鍵');
  // 版本號要跟著改，否則瀏覽器會吃到沒有嵌入模式的舊快取。
  const version = html.match(/app\.js\?v=(\d+)/);
  assert.ok(version && Number(version[1]) >= 38, `app.js 版本號要 ≥ 38，目前是 ${version?.[1]}`);
});

test('像素辦公室提供休假狀態與獨立圖示', async () => {
  const [html, js] = await Promise.all([officeHtml(), officeJs()]);
  assert.match(js, /\{id:'leave',symbol:'calendar',label:'休假',text:'休假中'\}/);
  assert.match(js, /calendar:\['010000010'/, '休假要有自己的行事曆像素圖示');
  assert.match(js, /status:\{type:'string',enum:\[[^\]]*'meeting','leave','abroad'/,
    '頁面工具也要接受休假狀態');
  assert.match(html, /app\.js\?v=40/, 'app.js 版本號要更新，避免瀏覽器沿用舊快取');
});

test('滑過預覽、點一下固定；固定後才吃得到滑鼠', async () => {
  const [js, css] = await Promise.all([officeJs(), officeCss()]);
  // 滑過人物直接展開；觸控裝置沒有 hover，仍走點選。固定之後滑過不再換人。
  assert.match(js, /if\(!embedMode\|\|e\.pointerType==='touch'\|\|cardPinned\)return;/,
    '固定之後滑過不該換人');
  assert.match(js, /if\(hit&&hit\.type!=='status'\)\{if\(hit\.i!==selected\)select\(hit\.i\);\}/);
  // 只是預覽時讓滑鼠穿透卡片，否則卡片會擋住右邊的同事，變成只有第一個人展得開。
  assert.match(css, /html\.embed \.person-card\{pointer-events:none\}/);
  assert.match(css, /html\.embed \.person-card\.is-pinned\{pointer-events:auto/,
    '固定後要吃得到滑鼠，才點得到技能膠囊');
  assert.match(js, /let cardPinned=false;/);
  assert.match(js, /function setCardPinned\(value\)\{cardPinned=value;\$\('personCard'\)\.classList\.toggle\('is-pinned',value\);\}/);
  // 點人物＝固定，點空白＝取消固定並收起。
  assert.match(js, /select\(hit\.i\);if\(embedMode\)setCardPinned\(true\)/);
  assert.match(js, /\{if\(embedMode\)setCardPinned\(false\);select\(null\);\}/);
  assert.match(js, /game\.addEventListener\('pointerleave',\(\)=>\{if\(embedMode&&!cardPinned\)select\(null\);\}\)/);
  // 關閉鈕要留著：固定之後卡片才吃得到滑鼠，剛好就是需要它的時候。
  assert.doesNotMatch(js, /\$\('personCardClose'\)\.hidden=true/, '不該再把關閉鈕藏起來');
  assert.doesNotMatch(css, /html\.embed \.person-card-close\{display:none\}/);
});

test('iframe 的高度鏈完整，場景不會把框撐大而被裁掉', async () => {
  const css = await officeCss();
  // 少了 html 這一層，body 會反過來被 canvas 撐大，fitEmbedView() 就以為框比 iframe 還高，
  // 把下排畫到看不見的地方（2026-09-21 使用者回報「整個下排被切掉」）。
  assert.match(css, /html\.embed,html\.embed body\{height:100%;overflow:hidden\}/);
  assert.match(css, /html\.embed main,html\.embed \.play,html\.embed \.canvas-wrap\{height:100%\}/);
  // canvas 脫離文件流，大小才不會回頭影響框。
  assert.match(css, /html\.embed #game\{position:absolute;top:0;left:0/);
  assert.match(css, /html\.embed \.canvas-wrap\{position:relative;margin:0;overflow:hidden\}/);
});

test('人物卡在嵌入的小框裡也夠寬', async () => {
  const css = await officeCss();
  // 340 px 的框取 46% 約 140 px，所以下限才是實際生效的那個值。
  assert.match(css, /html\.embed \.person-card\{width:clamp\(208px,calc\(46% - 16px\),286px\)/);
  assert.match(css, /width:clamp\(200px,calc\(52% - 8px\),286px\)/, '小螢幕同樣要夠寬');
});

test('點技能膠囊會把設計種類、階段與設計負責人帶進需求表單', async () => {
  const [js, css, html] = await Promise.all([officeJs(), officeCss(), indexHtml()]);
  // 遊戲端：技能是按鈕，點了用 postMessage 告訴外層（限定同源）。
  assert.match(js, /<button type="button" class="person-card-skill" data-skill="\$\{escapeHtml\(skill\)\}"/);
  assert.match(js, /window\.parent\.postMessage\(\{type:'pixelOfficeSkill',designer,skill\},location\.origin\)/);
  assert.match(css, /\.person-card-skill\{[^}]*cursor:pointer/);
  // 系統端：只收同源訊息，然後跑原本那套 applyDesignerSkill。
  assert.match(html, /window\.addEventListener\('message',event=>\{[\s\S]{0,200}?if\(event\.origin!==location\.origin\)return;/,
    '必須檢查來源');
  assert.match(html, /if\(!data\|\|data\.type!=='pixelOfficeSkill'\)return;/);
  assert.match(html, /applyDesignerSkill\(designer,skill\);/);
});

test('六個座位收攏並在框裡置中，不裁切', async () => {
  const js = await officeJs();
  // 下排往上收，中間的空地才不會佔掉一半高度；0.8 是不讓兩排疊在一起的極限。
  assert.match(js, /const EMBED_ROW_TOP=355,EMBED_ROW_SQUEEZE=\.8,EMBED_ROW_BOTTOM=695;/);
  assert.match(js, /const viewY=y=>embedMode&&y>EMBED_ROW_TOP\?EMBED_ROW_TOP\+\(y-EMBED_ROW_TOP\)\*EMBED_ROW_SQUEEZE:y;/);
  // 下緣跟著壓縮比例走，改了比例不用重新量一次。
  assert.match(js, /y1:EMBED_ROW_TOP\+\(EMBED_ROW_BOTTOM-EMBED_ROW_TOP\)\*EMBED_ROW_SQUEEZE\+112/);
  // 框的高度會跟著左右卡片對齊而變，所以縮放與置中要依實際尺寸算，不能寫死百分比。
  assert.match(js, /const scale=Math\.min\(wrap\.width\*EMBED_FIT_PADDING\/bw,wrap\.height\*EMBED_FIT_PADDING\/bh\);/);
  assert.match(js, /translate\(\$\{wrap\.width\/2-cx\*scale\}px,\$\{wrap\.height\/2-cy\*scale\}px\)/);
  // 資料座標不能被畫面偏移汙染：同步出去的還是 people／stations。
  assert.match(js, /viewPeople=people\.map\(p=>\(\{\.\.\.p,y:viewY\(p\.y\)\}\)\);/);
});

test('進站不再每 6 秒重抓整份 db.json，嵌入版也不預載歷史快照', async () => {
  const [html, js] = await Promise.all([indexHtml(), officeJs()]);
  // 以前是 ?v=時間戳 + no-store，等於每次背景刷新都重新下載 1.5 MB。
  assert.doesNotMatch(html, /fetch\(`\$\{githubJsonDatabaseUrl\}\?v=\$\{Date\.now\(\)\}`,\{cache:'no-store'\}\)/,
    '不該再用 cache-buster 重抓整份資料庫');
  assert.match(html, /const response=await fetch\(githubJsonDatabaseUrl,\{cache:'no-cache'\}\);/,
    '改用條件請求，內容沒變時走 304');
  // 3.8 MB 的歷史快照只在真的要看人物資料時才載。
  assert.match(js, /function ensureLevels\(\)\{if\(levelsRequested\)return;levelsRequested=true;syncLevels\(\);\}/);
  assert.match(js, /select\(null\);if\(!embedMode\)ensureLevels\(\);/, '嵌入模式進站不預載');
  assert.match(js, /const response=await fetch\(url,\{cache:'no-cache'\}\);/, '歷史快照也要能走 304');
});

test('人物頭上不再掛等級標籤，嵌入版也不顯示載入中的字', async () => {
  const [js, css] = await Promise.all([officeJs(), officeCss()]);
  // 等級在資料卡與右側面板都看得到，頭上再掛一個只是擋住人。
  assert.doesNotMatch(js, /levelTag/, '等級標籤應該整個移除');
  assert.match(js, /function drawOverlay\(i\)\{const p=viewPeople\[i\];if\(isAway\(p\)\)return;bubble\(p,0\);/);
  // 「正在整理設計部…」是給遊戲頁看的，嵌在系統裡只會變成一行突兀的字。
  assert.match(css, /html\.embed[^{]*#loading\{display:none!important\}/);
});

test('嵌入模式在 CSS 套用前就標記好，不會先閃出遊戲的頁首', async () => {
  const html = await officeHtml();
  const head = html.slice(0, html.indexOf('</head>'));
  // 等 app.js 執行才加 class 太晚了，使用者會先看到「凱曜設計部 / 今天，想說點什麼？」閃一下。
  assert.match(head, /<script>if\(new URLSearchParams\(location\.search\)\.get\('embed'\)==='1'\)document\.documentElement\.classList\.add\('embed'\);<\/script>/,
    'head 裡要先標記 embed');
  // 比對 rel="stylesheet" 而不是 stylesheet：上面的註解裡也有這個字。
  assert.ok(head.indexOf("classList.add('embed')") < head.indexOf('rel="stylesheet"'),
    '標記要在載入樣式表之前');
});

test('離席的灰階空桌不靠 ctx.filter（Safari 的 canvas 不支援）', async () => {
  const js = await officeJs();
  assert.doesNotMatch(js.replace(/\/\/[^\n]*/g, ''), /ctx\.filter/,
    '不能再用 canvas 的 filter，Safari 會直接忽略、桌子維持原色');
  // 改成圖集載入後先做一張灰階版本快取，各家瀏覽器結果一致。
  assert.match(js, /function ensureFurnitureGray\(\)\{/);
  assert.match(js, /const furnitureFor=s=>stationDimmed\(s\)\?\(ensureFurnitureGray\(\)\|\|furniture\):furniture;/);
  assert.match(js, /const type=stationAway\(s\)\?s\.empty:s\.type,art=furnitureFor\(s\)/);
});

test('嵌入版靜止時不重畫，資源也換成 WebP', async () => {
  const [js, html] = await Promise.all([officeJs(), officeHtml()]);
  // 不能走動，畫面多數時間完全靜止，沒必要每秒畫 60 次。
  assert.match(js, /if\(embedMode&&!needsRedraw&&!sceneAnimating\(\)\)\{requestAnimationFrame\(render\);return;\}/);
  assert.match(js, /function markDirty\(\)\{needsRedraw=true;\}/);
  // 宣告要在最前面：resizeCanvas() 在腳本載入時就會用到它。
  assert.ok(js.indexOf('function markDirty') < js.indexOf('function resizeCanvas'),
    'markDirty 要在 resizeCanvas 之前宣告，否則載入時就 TDZ 錯誤');
  for (const fn of ['applyRemote', 'resizeCanvas', 'select']) {
    assert.match(js, new RegExp(`function ${fn}\\([^)]*\\)\\{[^\n]*markDirty\\(\\)`), `${fn} 之後要重畫`);
  }
  // 142 KB 的 PNG 濾鏡圖改成 WebP。
  assert.match(js, /overtimeSheet\.src='assets\/overtime-filter\.webp/);
  assert.match(html, /preload[^>]*assets\/overtime-filter\.webp/);
});

test('面板標題與說明是「設計部即時動態」的版本', async () => {
  const html = await indexHtml();
  assert.match(html, /<h2>設計部即時動態<\/h2>/);
  assert.match(html, /title="關閉設計部即時動態" aria-label="關閉設計部即時動態"/);
  assert.doesNotMatch(html, /<h2>設計師專長與案件分配<\/h2>/);
  // 說明裡不再列舉狀態，也不再解釋狀態怎麼判斷。
  assert.doesNotMatch(html, /在座、加班、用餐、會議、外出或下班/);
  assert.doesNotMatch(html, /狀態由每位設計師的電腦與 Google 行事曆自動判斷/);
  assert.match(html, /<span>• 這裡顯示設計部的即時狀態。<\/span>/);
  // 後台「設定」表的欄位名不能跟著改，不然收合狀態會對不上。
  assert.match(html, /'收合設計師專長與案件分配'/);
});

test('換上新的桌子素材，左中右三種形狀各就各位', async () => {
  const [js, html] = await Promise.all([officeJs(), officeHtml()]);
  assert.match(js, /furniture\.src='assets\/furniture-v3\.webp/);
  assert.match(html, /preload[^>]*assets\/furniture-v3\.webp/);
  // 素材裡三張桌子形狀不同：最左有左斜邊、最右有右斜邊、中間是矩形。
  // 用錯位置的那一種，接起來就會缺一塊（使用者回報「桌子沒有換到」其實是接縫沒對上）。
  assert.match(js, /const furnitureRects=\[\[0,0,520,328,37\],\[0,328,517,328,37\],\[0,656,520,325,34\],\[0,981,520,325,34\],\[0,1306,520,316,25\],\[520,0,237,372,0\],\[0,1622,520,291,0\],\[0,1913,517,291,0\],\[0,2204,520,291,0\]\];/);
  // 每個座位指定自己的桌子與離席時的空桌：左端 0/6、中間 1/7、右端 2/8。
  assert.match(js, /\{x:548,y:355,type:0,empty:6,name:'Leona'\}/);
  assert.match(js, /\{x:768,y:355,type:1,empty:7,name:'Amber'\}/);
  assert.match(js, /\{x:988,y:355,type:3,empty:8,name:'Noise'\}/);
  assert.match(js, /\{x:548,y:695,type:4,empty:6,name:''\}/);
  assert.match(js, /\{x:988,y:695,type:2,empty:8,name:'Machi'\}/);
  // 繪製寬度要讓素材的分隔線對齊座位間距，相鄰兩張才接得平整。
  assert.match(js, /const DESK_SRC_FACE=221,DESK_SRC_FOOT=70,DESK_SRC_UNIT=517,DESK_SEAT_GAP=220;/);
  assert.match(js, /const DESK_DRAW_SCALE=DESK_SEAT_GAP\/DESK_SRC_UNIT;/);
  assert.match(js, /const drawW=Math\.round\(sw\*DESK_DRAW_SCALE\)/);
  assert.match(js, /if\(upper>0\)ctx\.drawImage\(art,sx,sy,sw,upper,left,deskTop-upperDraw,drawW,upperDraw\);/,
    'upper 為 0 時不能畫高度 0 的來源矩形');
  // 舊的寫死偏移與固定 250 寬都要消失。
  assert.doesNotMatch(js, /type===2\?28:68/);
  assert.doesNotMatch(js, /DESK_DRAW_WIDTH=250/);
  assert.doesNotMatch(js, /furniture-packed\.webp|furniture-v2\.webp/);
});

test('左下角空位依時段轉灰階，電腦留著', async () => {
  const js = await officeJs();
  assert.match(js, /const VACANT_DESK_ON_HOUR=9,VACANT_DESK_OFF_HOUR=18;/);
  assert.match(js, /const stationVacant=s=>!s\.name;/);
  // 09:00–18:00 正常，其餘時間連椅子一起暗下來。
  assert.match(js, /return hour<VACANT_DESK_ON_HOUR\|\|hour>=VACANT_DESK_OFF_HOUR;/);
  // 桌子的種類仍照 s.type 走（type 2 是有電腦的那張），只有配色換成灰階版本，電腦不會消失。
  assert.match(js, /const type=stationAway\(s\)\?s\.empty:s\.type,art=furnitureFor\(s\)/);
  assert.match(js, /const furnitureFor=s=>stationDimmed\(s\)\?/);
  // 椅子也要跟著灰，且六張椅背上緣都要降低到人物頭部中線。
  assert.match(js, /const CHAIR_WIDTH=102,CHAIR_HEIGHT=135,CHAIR_TOP_FROM_FEET=107;/);
  assert.match(js, /function drawChair\(s\)\{if\(stationAway\(s\)\)return;furnitureObject\(CHAIR_RECT,s\.x-CHAIR_WIDTH\/2,s\.y-CHAIR_TOP_FROM_FEET,CHAIR_WIDTH,CHAIR_HEIGHT,furnitureFor\(s\)\);\}/);
});

test('人物卡的「未開始」是紅燈', async () => {
  const js = await officeJs();
  assert.match(js, /\{key:'未開始',color:'#ff5a5a'\}/);
});

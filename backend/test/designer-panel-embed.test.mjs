import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';
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
  assert.match(source, /src="EMC-ART-Pixel-Office\/dist\/\?embed=1&amp;v=55"/);
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
  for (const selector of ['header', 'aside', '.scene-bar', '.scene-foot', '#roster', '.level-table-section']) {
    assert.ok(new RegExp(`body\\.embed[^{]*${selector.replace('.', '\\.').replace('#', '#')}`).test(css)
      || css.includes(`html.embed ${selector}`), `嵌入模式應該隱藏 ${selector}`);
  }
  assert.doesNotMatch(css, /html\.embed[^\n{]*\.person-card\{display:none!important\}/,
    '嵌入模式不可隱藏人物卡');
  assert.match(js, /game\.addEventListener\('pointerdown',e=>\{if\(!ready\)return;/,
    '嵌入場景要能點選人物');
  assert.match(js, /game\.addEventListener\('pointermove',e=>\{const hit=hitAt\(e\.clientX,e\.clientY\);game\.style\.cursor=hit\?'pointer':'default';/,
    '人物上方應顯示可點選游標');
  // 桌牌不再需要「下排特別上移」的特例：整排已經收上來，而且 fitEmbedView() 會把六個座位
  // 連同桌牌整塊放進框裡，不會被底邊裁掉。桌牌上緣沿用原本名牌的位置。
  assert.match(js, /const PLATE_TOP=56,PLATE_NAME_H=23;/);
  assert.match(js, /const x=Math\.round\(s\.x-w\/2\),y=Math\.round\(s\.y\+PLATE_TOP\);/);
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
  assert.match(js, /extraCells=\{meeting:0,bowl:1,calendar:2\}/, '休假要使用使用者提供的新椰子樹圖示');
  assert.match(js, /status:\{type:'string',enum:\[[^\]]*'meeting','leave','abroad'/,
    '頁面工具也要接受休假狀態');
  assert.match(html, /app\.js\?v=84/, 'app.js 版本號要更新，避免瀏覽器沿用舊快取');
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
  assert.match(js, /game\.addEventListener\('pointerleave',\(\)=>\{setHoverStory\(-1\);if\(embedMode&&!cardPinned\)select\(null\);\}\)/);
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

test('人物卡在嵌入的小框裡也夠寬，而且位置一律交給 JS 算', async () => {
  const css = await officeCss();
  // 340 px 的框取 46% 約 140 px，所以下限才是實際生效的那個值。
  assert.match(css, /html\.embed \.person-card\{width:clamp\(208px,calc\(46% - 16px\),286px\)/);
  assert.match(css, /width:clamp\(190px,calc\(48% - 8px\),252px\)/, '小螢幕同樣要夠寬');
  // 窄框以前用 position:fixed 把卡片釘在右上角，整個蓋掉 positionPersonCard() 算好的位置，
  // 右邊兩位的臉照樣被擋住（2026-09-24 使用者回報）。CSS 不可以再自己決定位置。
  const narrow = css.slice(css.indexOf('@media(max-width:640px)'));
  assert.doesNotMatch(narrow, /html\.embed \.person-card\{[^}]*position:fixed/, '窄框不可以把卡片釘死');
  assert.doesNotMatch(narrow, /html\.embed \.person-card\{[^}]*(top|right|left|bottom):[^;}]*!important/,
    '位置要交回 JS，CSS 不能用 !important 蓋掉');
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
  // 下排往上收，中間的空地才不會佔掉一半高度。收多少不能寫死：下排的對話框往上長，不能蓋到
  // 上排的名牌。比例直接從對話框的尺寸推回來，改對話框不用重算。
  assert.match(js, /const EMBED_ROW_TOP=355,EMBED_ROW_BOTTOM=695;/);
  assert.match(js, /const EMBED_ROW_SQUEEZE=Math\.min\(1,\(PLATE_TOP\+PLATE_NAME_H\+BUBBLE_CLEAR\+BUBBLE_MAX_H\+BUBBLE_HEAD_GAP\+150\)\/\(EMBED_ROW_BOTTOM-EMBED_ROW_TOP\)\);/);
  assert.match(js, /const viewY=y=>embedMode&&y>EMBED_ROW_TOP\?EMBED_ROW_TOP\+\(y-EMBED_ROW_TOP\)\*EMBED_ROW_SQUEEZE:y;/);
  // 上緣是「動」的：照上排現在真的有多少對話框去留，沒人講話就只留到頭頂，場景才不會被
  // 一直空著的四行保留區白白縮小（2026-09-24 使用者回報）。
  assert.match(js, /const SCENE_TOP_MIN=EMBED_ROW_TOP-158;/);
  assert.match(js, /function sceneTopExtent\(\)\{/);
  assert.match(js, /top=Math\.min\(top,p\.y-150-BUBBLE_HEAD_GAP-BUBBLE_TAIL-layout\.h-8-\(layout\.lift\|\|0\)\)/);
  assert.match(js, /function syncSceneTop\(\)\{[\s\S]*?EMBED_CONTENT\.y0=top;\s*fitEmbedView\(\);/,
    '上緣變了要重新 fit');
  // 算「想長多高」時不能看天花板，否則會變成「框小→少畫一行→框可以更小」的死循環。
  assert.match(js, /const layout=bubbleLayout\(p,true\);/);
  assert.match(js, /if\(!embedMode\|\|fitting\)return;/, 'syncSceneTop 會回頭呼叫 fitEmbedView，要擋遞迴');
  // 下緣是下排名牌的最低點，跟著常數與壓縮比例走。
  assert.match(js, /y1:EMBED_ROW_TOP\+\(EMBED_ROW_BOTTOM-EMBED_ROW_TOP\)\*EMBED_ROW_SQUEEZE\+PLATE_TOP\+PLATE_NAME_H\+8/);
  // 算出來的比例要真的夠：下排的對話框長到最高時，不能碰到上排名牌的下緣。
  const c = Object.fromEntries([...js.matchAll(/\b(PLATE_TOP|PLATE_NAME_H|BUBBLE_LINE|BUBBLE_MAX_LINES|BUBBLE_PAD_Y|BUBBLE_TAIL|BUBBLE_HEAD_GAP|BUBBLE_CLEAR)=([\d.]+)/g)].map(m => [m[1], Number(m[2])]));
  const bubbleMaxH = c.BUBBLE_MAX_LINES * c.BUBBLE_LINE + c.BUBBLE_PAD_Y * 2 + c.BUBBLE_TAIL;
  const squeeze = Math.min(1, (c.PLATE_TOP + c.PLATE_NAME_H + c.BUBBLE_CLEAR + bubbleMaxH + c.BUBBLE_HEAD_GAP + 150) / (695 - 355));
  const bubbleTop = 355 + (695 - 355) * squeeze - 150 - c.BUBBLE_HEAD_GAP - bubbleMaxH;
  const plateBottom = 355 + c.PLATE_TOP + c.PLATE_NAME_H;
  assert.ok(bubbleTop >= plateBottom + c.BUBBLE_CLEAR - 0.001,
    `下排的對話框畫到 ${bubbleTop}，上排名牌的下緣在 ${plateBottom}，會蓋住名字`);
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
  assert.match(js, /function drawOverlay\(i,time\)\{const p=viewPeople\[i\];if\(isAway\(p\)\)return;drawBubble\(p,i\);drawStoryBubble\(i,time\);/);
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
  // 加班濾鏡不是進站必要的圖：不預載（預載會跟 app.js、頭像、衣服搶頻寬，2026-10-01 瘦身），由 app.js 之後再載。
  assert.doesNotMatch(html, /preload[^>]*assets\/overtime-filter\.webp/);
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

test('左下角空位依時段轉灰階，週末與國定假日整天灰階，電腦留著', async () => {
  const js = await officeJs();
  assert.match(js, /const VACANT_DESK_ON_HOUR=9,VACANT_DESK_OFF_HOUR=18;/);
  assert.match(js, /const stationVacant=s=>!s\.name;/);
  // 平日 09:00–18:00 正常，其餘時間連椅子一起暗下來。
  assert.match(js, /return clock\.hour<VACANT_DESK_ON_HOUR\|\|clock\.hour>=VACANT_DESK_OFF_HOUR;/);
  // 週末與國定假日整天灰階，不必等到 18:00（2026-09-29 使用者要求）。workday 已經同時涵蓋
  // 週六日與 TAIWAN_HOLIDAYS，跟加班濾鏡用同一份假日表。
  const fn = js.slice(js.indexOf('function stationDimmed(s){'), js.indexOf('\nconst furnitureFor='));
  assert.match(fn, /const clock=currentTaipeiClock\(\);\s*\n\s*if\(!clock\.workday\)return true;/,
    '非工作日一律灰階，而且要排在時段判斷之前');
  // 中午 12–14 點也收掉（2026-09-30 使用者要求）：大家都去吃飯了，只有那張空桌亮著很突兀。
  assert.match(js, /const VACANT_DESK_LUNCH_START=12,VACANT_DESK_LUNCH_END=14;/);
  assert.match(fn, /if\(clock\.hour>=VACANT_DESK_LUNCH_START&&clock\.hour<VACANT_DESK_LUNCH_END\)return true;/);
  assert.match(js, /workday:!\['Sat','Sun'\]\.includes\(parts\.weekday\)&&!\(TAIWAN_HOLIDAYS\[parts\.year\]\|\|\[\]\)\.includes\(date\)/,
    'workday 要同時看週末與國定假日');
  // 假日表要涵蓋到今天以後，否則這條判定會悄悄失效。
  const years = [...js.matchAll(/(\d{4}):\['(\d{8})'/g)].map(m => Number(m[1]));
  assert.ok(years.includes(new Date().getFullYear()), `TAIWAN_HOLIDAYS 沒有今年（${new Date().getFullYear()}）`);
  // 桌子的種類仍照 s.type 走（type 2 是有電腦的那張），只有配色換成灰階版本，電腦不會消失。
  assert.match(js, /const type=stationAway\(s\)\?s\.empty:s\.type,art=furnitureFor\(s\)/);
  assert.match(js, /const furnitureFor=s=>stationDimmed\(s\)\?/);
  // 椅子也要跟著灰，且六張椅背上緣都要降低到人物頭部中線。
  assert.match(js, /const CHAIR_WIDTH=102,CHAIR_HEIGHT=135,CHAIR_TOP_FROM_FEET=107;/);
  // 椅子只在「有人而且在座」時才畫：離席不畫，左下角空位到了灰階時段也收掉，只留桌子與桌上電腦。
  assert.match(js, /function drawChair\(s\)\{if\(stationDimmed\(s\)\)return;furnitureObject\(CHAIR_RECT,s\.x-CHAIR_WIDTH\/2,s\.y-CHAIR_TOP_FROM_FEET,CHAIR_WIDTH,CHAIR_HEIGHT,furnitureFor\(s\)\);\}/);
});

test('人物卡的「未開始」是紅燈', async () => {
  const js = await officeJs();
  assert.match(js, /\{key:'未開始',color:'#ff5a5a'\}/);
});

test('「手上的案件」不算已經歸檔的舊案件', async () => {
  const js = await officeJs();
  // 歷史快照裡有早就歸檔的案件，其中有些當初忘了改成已完成，會一直被算成「手上的案件」，
  // 而且那些資料已經不在現行資料庫、改不動（2026-09-22 Leona 四、五月的案件還掛著）。
  // 快照自己帶了一份「目前還在現行資料庫」的清單，格式是「案件編號#序號」，要先拆掉序號。
  assert.match(js, /currentCaseIds=Array\.isArray\(payload\.currentDatabaseRowKeys\)/);
  assert.match(js, /new Set\(payload\.currentDatabaseRowKeys\.map\(key=>String\(key\)\.split\('#'\)\[0\]\)\)/,
    '要去掉 #序號 才對得上案件編號');
  assert.match(js, /if\(currentCaseIds&&!currentCaseIds\.has\(String\(row\['案件編號'\]\)\)\)continue;/,
    '只算還在現行資料庫的案件');
  // 舊格式的快照沒有這個欄位，就不過濾——不能因此整個壞掉。
  assert.match(js, /: null;/);
  // 等級與分數仍然要用完整的歷史資料，不受這個過濾影響。
  assert.match(js, /const totals=scoreRows\(payload\.rows\);/);
});

test('右欄關掉時場景不會塌掉', async () => {
  const html = await indexHtml();
  // 左右對齊時場景是 absolute 撐滿卡片剩餘高度；右欄一關，卡片自己沒有高度可撐，
  // absolute 的場景會塌成 0，整張卡只剩標題列（2026-09-22 使用者回報「內容會被遮蔽」）。
  assert.match(html, /const paired=!designer\.hidden&&!recent\.hidden&&!window\.matchMedia\('\(max-width:900px\)'\)\.matches;/);
  assert.match(html, /designer\.classList\.toggle\('is-solo',!paired\);/);
  assert.match(html, /if\(!paired\)return;/);
  // 單欄時退回長寬比模式，自己把高度撐開。
  assert.match(html, /#designerPanel\.is-solo \.office-embed-shell\{position:relative;inset:auto;height:auto;aspect-ratio:3\/2\}/);
  assert.match(html, /#designerPanel\.is-solo\{display:block\}/);
  assert.match(html, /#designerPanel\.is-solo \.designer-roster\{position:static\}/);
});

test('深色模式下場景背景跟著主題，不會是一塊白', async () => {
  const [html, js] = await Promise.all([indexHtml(), officeJs()]);
  // 三層都要處理：canvas 自己別填白、iframe 透明、外框跟著主題變數走。
  assert.match(js, /function drawOffice\(\)\{if\(embedMode\)\{ctx\.clearRect\(0,0,W,H\);return;\}ctx\.fillStyle='#fff';/,
    '嵌入模式不填白底，獨立開遊戲頁時仍是白底');
  assert.match(html, /\.office-embed\{display:block;width:100%;height:100%;border:0;background:transparent/);
  assert.match(html, /\.office-embed-shell\{[^}]*background:var\(--panel,#fff\)/);
  // body 自己有白底（給獨立開遊戲頁用），只清掉 html 的話嵌進去仍會卡著一塊白。
  const css = await officeCss();
  assert.match(css, /html\.embed,html\.embed body\{background:transparent\}/);
});

test('深色模式下 iframe 的文件底色跟著主題', async () => {
  const [html, js] = await Promise.all([indexHtml(), officeJs()]);
  // iframe 的文件底色是瀏覽器依 color-scheme 畫的，html 與 body 都設成 transparent 也蓋不掉——
  // 這才是深色模式下卡著一塊白的真正原因（2026-09-22）。
  assert.match(html, /function notifyOfficeTheme\(theme=currentTheme\(\)\)\{/);
  assert.match(html, /postMessage\(\{type:'pixelOfficeTheme',theme\},location\.origin\)/);
  assert.match(html, /document\.documentElement\.dataset\.theme=next; notifyOfficeTheme\(next\);/,
    '切換主題時要通知 iframe');
  assert.match(html, /if\(data&&data\.type==='pixelOfficeThemeRequest'\)\{notifyOfficeTheme\(\);return;\}/,
    '要回應 iframe 載好後的詢問');
  // 遊戲端：收到就套 color-scheme，並在載好後主動問一次（外層可能在它載好前就切換過）。
  assert.match(js, /if\(!data\|\|data\.type!=='pixelOfficeTheme'\)return;/);
  assert.match(js, /document\.documentElement\.style\.colorScheme=data\.theme==='dark'\?'dark':'light';/);
  assert.match(js, /postMessage\(\{type:'pixelOfficeThemeRequest'\},location\.origin\)/);
  // 兩邊都只收同源訊息。
  assert.match(js, /if\(event\.origin!==location\.origin\)return;/);
});

test('個人資料卡一律夾在場景框內，優先往左開，而且不會蓋到臉', async () => {
  const js = await officeJs();
  const fn = js.slice(js.indexOf('function positionPersonCard()'), js.indexOf('\nfunction ', js.indexOf('function positionPersonCard()') + 1));
  // 卡片是相對 .canvas-wrap 定位的，但嵌入模式下 canvas 被 fitEmbedView() 放大並平移過，
  // 兩者的矩形不一樣。之前拿 canvas 的矩形當邊界，右欄一關（場景變寬）右邊的人物就算出框外的
  // 位置，卡片被切掉看不到（2026-09-22 修）。
  assert.match(fn, /const holder=game\.parentElement\.getBoundingClientRect\(\),view=game\.getBoundingClientRect\(\);/,
    '位置基準要用卡片真正的容器');
  assert.match(fn, /const offsetX=view\.left-holder\.left,offsetY=view\.top-holder\.top;/,
    '人物位置要換算成相對容器的座標');
  assert.match(fn, /clampX=value=>Math\.max\(8,Math\.min\(farX,value\)\)/, '左右夾在容器內');
  assert.match(fn, /clampY=value=>Math\.max\(8,Math\.min\(farY,value\)\)/, '上下夾在容器內');
  assert.match(fn, /const cardW=card\.offsetWidth\|\|232,cardH=card\.offsetHeight\|\|240/);
  assert.doesNotMatch(fn, /if\(left\+cardW>holder\.width-8\)/, '不要再用「右邊放不下就翻左邊」的寫死規則');
  // 擋到臉才算真的擋到人；被點的那一位加重 200 倍，只要閃得開就一定閃得開。
  assert.match(fn, /const faceOf=person=>/, '要有臉的範圍');
  assert.match(fn, /overlapArea\(box,targetFace\)\*200/, '被點的人的臉權重要最高');
  assert.match(fn, /otherFaces\.reduce\(\(sum,face\)=>sum\+overlapArea\(box,face\),0\)/);
  // 候選位置從左邊排起，同分選最左邊的（2026-09-24 使用者指定往左開）。
  const spots = fn.slice(fn.indexOf('const spots=['), fn.indexOf('].map(spot=>'));
  assert.match(spots, /^\s*const spots=\[[\s\S]{0,200}?\{x:target\.x-gap-cardW/, '第一個候選位置要是人物左邊');
  assert.match(fn, /return b\.box\.x<a\.box\.x\?b:a;/, '同分時選最左邊的');
  assert.match(js, /function overlapArea\(a,b\)\{/);
});


test('對話框回到人物頭上：小、半透明，而且長不出場景外', async () => {
  const js = await officeJs();
  const fn = js.slice(js.indexOf('function drawBubble('), js.indexOf('\nfunction ', js.indexOf('function drawBubble(') + 1));
  const layout = js.slice(js.indexOf('function bubbleLayout('), js.indexOf('\nfunction ', js.indexOf('function bubbleLayout(') + 1));
  assert.ok(fn && layout, '要有 drawBubble() 與 bubbleLayout()');
  // 上不會被切、下不會蓋到上排名牌：可用高度是算出來的，放不下就少畫幾行。
  assert.match(js, /function bubbleCeiling\(p\)\{/);
  assert.match(layout, /const room=ignoreCeiling\?BUBBLE_MAX_LINES:Math\.floor\(\(tipY-BUBBLE_TAIL-BUBBLE_PAD_Y\*2-bubbleCeiling\(p\)\)\/lineHeight\);/,
    '行數要由實際可用高度決定，不能寫死');
  assert.match(layout, /lines\[limit-1\]=ellipsize\(lines\[limit-1\],inner\)/, '放不下要用「…」收尾');
  // 半透明＋柔和陰影＝浮在場景上的感覺（2026-09-24 使用者要求）。
  assert.match(fn, /glass\.addColorStop\(0,'rgba\(255,255,255,\.88\)'\)/, '底要是半透明的');
  assert.match(fn, /ctx\.shadowColor='rgba\(10,22,44,\.28\)'/, '要有柔和陰影');
  assert.doesNotMatch(fn, /softPanel\(/, 'softPanel 會補一層實色，把透明度蓋掉');
  // 左右也要夾在看得到的範圍內。
  assert.match(fn, /const left=embedMode\?EMBED_CONTENT\.x0\+4:10,right=embedMode\?EMBED_CONTENT\.x1-4:W-10;/);
  // 縮小過了：字級與寬度都比舊版（17px／寬 254）小一截。
  const c = Object.fromEntries([...js.matchAll(/\b(BUBBLE_FONT|BUBBLE_LINE|BUBBLE_MAX_W|BUBBLE_PAD_X|BUBBLE_MAX_LINES)=([\d.]+)/g)].map(m => [m[1], Number(m[2])]));
  assert.ok(c.BUBBLE_FONT <= 12 && c.BUBBLE_MAX_W <= 210, `對話框要比舊版小：${JSON.stringify(c)}`);
  // 60 字（對話上限）在正常縮放下要放得完，不該被截掉。
  const perLine = Math.floor((c.BUBBLE_MAX_W - c.BUBBLE_PAD_X * 2) / c.BUBBLE_FONT);
  assert.ok(perLine * c.BUBBLE_MAX_LINES >= 60,
    `一行 ${perLine} 個中文字 × ${c.BUBBLE_MAX_LINES} 行放不下 60 字的對話`);
});

test('名牌只放名字，對話不再擠在它下面', async () => {
  const js = await officeJs();
  const plate = js.slice(js.indexOf('function drawDeskPlate('), js.indexOf('\nfunction ', js.indexOf('function drawDeskPlate(') + 1));
  assert.ok(plate, '要有 drawDeskPlate()');
  assert.doesNotMatch(plate, /message|wrapText|ellipsize/, '名牌上不該再有對話');
  assert.match(plate, /ctx\.fillText\(s\.name,s\.x,y\+h\/2\+1\);/);
});

test('所有狀態的小膠囊排在同一條水平線上', async () => {
  const js = await officeJs();
  const marker = js.slice(js.indexOf('function drawStatusMarker('), js.indexOf('\nfunction ', js.indexOf('function drawStatusMarker(') + 1));
  // 膠囊原本是用「縮放後」的圖示高度往上推，所以圖示有縮小的狀態（公出 .78、下班 .8）膠囊
  // 就會比別人低 10～11px（2026-09-23 使用者回報）。高度改用未縮放的基準值，圖縮膠囊不跟著縮。
  assert.match(js, /const DESK_ICON_BASE=104;/);
  assert.match(marker, /iconSize=DESK_ICON_BASE\*\(DESK_ICON_SCALE\[status\.symbol\]\|\|1\)/, '圖示才吃縮放');
  assert.match(marker, /labelY=iconY-DESK_ICON_BASE\/2-h-2;/, '膠囊高度不能吃縮放');
  assert.doesNotMatch(marker, /labelY=iconY-iconSize\/2/, '不要再用縮放後的高度算膠囊');

  // 縮小仍然只作用在圖示上——這兩張圖留白少，照 104 畫會比別人大一圈。
  const scales = Object.fromEntries(js.match(/const DESK_ICON_SCALE=\{(.+?)\};/)[1]
    .split(',').map(pair => pair.split(':')).map(([key, value]) => [key, Number(value)]));
  assert.ok(scales.power < 1 && scales.briefcase < 1, '這兩張圖仍然維持縮小');
  // 膠囊的 y 只能由常數決定，不能出現任何跟 symbol 有關的變數，否則又會各自高低不同。
  const labelExpr = marker.match(/labelY=([^;]+);/)[1];
  assert.doesNotMatch(labelExpr, /iconSize|DESK_ICON_SCALE|symbol/, `膠囊高度還是會隨圖示變：${labelExpr}`);
});

test('標題後面的「編輯」開出嵌著完整像素辦公室的小視窗', async () => {
  const html = await indexHtml();
  // 面板裡的 iframe 是唯讀預覽（只放行點人物看資料），要改自己的心情／狀態／留言得開完整版。
  assert.match(html, /<div class="designer-title-wrap"><h2>設計部即時動態<\/h2>[\s\S]{0,200}?id="officeEditorOpen"[^>]*>編輯<\/button><\/div>/,
    '膠囊按鈕要接在標題（與說明鈕）後面');
  assert.match(html, /const OFFICE_EDITOR_URL='https:\/\/emctaipeiart\.github\.io\/EMC-ART-Pixel-Office\/dist\/';/);
  assert.match(html, /<iframe id="officeEditorFrame"/);
  // src 等到打開才給，關掉就拿掉：不然這一頁會在背景一直跑 canvas 與同步輪詢。
  assert.match(html, /if\(frame&&!frame\.getAttribute\('src'\)\)frame\.src=OFFICE_EDITOR_URL; modal\.hidden=false;/);
  assert.match(html, /modal\.hidden=true; \$\('#officeEditorFrame'\)\?\.removeAttribute\('src'\)/);
  // 按鈕長在 .designer-help-trigger 裡，不擋掉的話點擊會冒到面板的收合／說明上。
  assert.match(html, /\$\('#officeEditorOpen'\)\?\.addEventListener\('click',event=>\{event\.preventDefault\(\);event\.stopPropagation\(\);showOfficeEditor\(\)\}\)/);
  // 背景與 Esc 都能關。
  assert.match(html, /\$\('#officeEditorModal'\)\?\.addEventListener\('click',event=>\{if\(event\.target===event\.currentTarget\)hideOfficeEditor\(\)\}\)/);
  assert.match(html, /if\(event\.key==='Escape'&&!\$\('#officeEditorModal'\)\?\.hidden\)\{event\.preventDefault\(\);hideOfficeEditor\(\)\}/);
  assert.match(html, /SCROLL_LOCK_MODAL_IDS=\[[^\]]*'officeEditorModal'/, '打開時要鎖住背景捲動');
  // 只開放給設計師帳號（2026-09-24 使用者補充）：預設藏著，登入狀態變了才決定顯不顯示，
  // 登出時如果視窗還開著要收掉；就算有人硬叫 showOfficeEditor() 也擋得住。
  assert.match(html, /id="officeEditorOpen"[^>]*hidden>編輯<\/button>/, '預設要藏起來，登入前不要閃一下');
  assert.match(html, /\.office-editor-open\[hidden\]\{display:none!important\}/);
  assert.match(html, /const officeEditorBtn=\$\('#officeEditorOpen'\);if\(officeEditorBtn\)officeEditorBtn\.hidden=!designLogin;if\(!designLogin\)hideOfficeEditor\(\);/,
    '顯示與否跟著 isDesignerLogin\(\)，登出要收掉視窗');
  assert.match(html, /function showOfficeEditor\(\)\{[^\n]*if\(!isDesignerLogin\(\)\)\{setSync\('請用設計師帳號登入後再編輯像素辦公室',true\)/,
    '開視窗本身也要擋');
  // 遊戲自己會依框的大小縮放，剩下的高度全部給它；min-height:0 少了 flex 子元素撐不下去。
  assert.match(html, /\.office-editor-frame\{flex:1 1 auto;min-height:0;/);
  // 完整版的場景畫在 1536×1024 裡、桌子只佔中間那塊，框越寬人物畫得越大，所以視窗要開大
  // （2026-09-24 使用者要求）。這只動系統這邊的視窗，前台面板的 iframe 完全沒碰。
  const card = html.match(/\.office-editor-card\{([^}]*)\}/)[1];
  const width = Number(card.match(/width:min\((\d+)px/)[1]);
  assert.ok(width >= 1400, `編輯視窗要夠寬才看得清楚，目前 ${width}`);
  assert.match(html, /\.office-editor-modal\{padding:10px\}/, '外框留白要收一點，視窗才吃得到那個寬度');
});

test('限時動態：人物右上角是像素氣泡，開啟 Reels 樣式視窗，取代舊的照片卡', async () => {
  const [js, html, css] = await Promise.all([officeJs(), officeHtml(), officeCss()]);
  // 舊的照片卡與「想分享的照片」都不在了。
  assert.doesNotMatch(js, /drawPhotoCard|openPhoto|loadRemotePhoto/);
  assert.doesNotMatch(html, /想分享的照片|id="lightbox"/);
  assert.match(html, /<h3>限時動態<\/h3>/);
  // 氣泡：品牌綠 #008214 的三個點、固定在人物右上方，沒有動態就不畫，有動態的人心情圖示改放左邊。
  assert.match(js, /g:'#008214'/);
  assert.match(js, /function storyBubbleBox\(p\)\{return \{x:Math\.round\(p\.x\+38\),y:Math\.round\(p\.y-152\)/);
  assert.match(js, /if\(!storiesOf\(p\.name\)\.length\)return;/);
  assert.match(js, /const side=storiesOf\(p\.name\)\.length\?-1:/);
  // 未讀才有綠點與輕微跳動，而且尊重「減少動態效果」。
  assert.match(js, /if\(unread\)drawSprite\(STORY_DOT/);
  assert.match(js, /unread&&!storyReducedMotion\.matches&&phase<\.5/);
  // 滑鼠移入放大並顯示「查看 ○○ 的動態」；觸控不靠提示，點了就開。
  assert.match(js, /`查看 \$\{people\[i\]\.name\} 的動態`/);
  assert.match(js, /event\.pointerType==='touch'\)storyTip\.hidden=true/);
  assert.match(js, /if\(hit\.type==='story'\)openStory\(hit\.i\)/);
  // Reels 樣式：每則固定秒數並倒數、可以按讚與留言，互動都送到後端。
  assert.match(js, /STORY_SECONDS=6/);
  for (const action of ['pixelOfficeStoryAdd', 'pixelOfficeStoryReact', 'pixelOfficeStoryComment', 'pixelOfficeStoryView', 'pixelOfficeStoryRemove']) {
    assert.ok(js.includes(action), `前端要呼叫 ${action}`);
  }
  for (const id of ['svProgress', 'svLike', 'svForm']) assert.ok(html.includes(`id="${id}"`), `視窗要有 #${id}`);
  // 視窗的標題列與底部列不能用 <header>／<footer>：嵌入版會把 header 整個藏起來。
  assert.doesNotMatch(html.slice(html.indexOf('id="storyViewer"')), /<header|<footer/);
  assert.match(css, /#storyViewer\{/);
  // 不顯示倒數時間；不再自己選身分——按讚留言記在登入前台的人名下，沒登入不能互動。
  assert.doesNotMatch(html, /svTime|svCount|svViewer|選擇你是誰/);
  assert.match(js, /if\(event\.origin!==location\.origin\|\|event\.source!==window\.parent\)return;/);
  assert.match(js, /type:'pixelOfficeViewerRequest'/);
  assert.doesNotMatch(js, /viewer:who/);
  const parent = await indexHtml();
  assert.match(parent, /type:'pixelOfficeViewer',name:isLoggedIn\(\)\?currentEditor:''/);
  // 動態視窗的標題列與按鈕列在版面裡佔位，圖片放在中間，長圖不會被蓋住。
  assert.match(css, /\.sv-head\{position:relative/);
  assert.match(css, /\.sv-actions\{position:relative/);
});

test('自動更新：整天開著的頁面偵測到新版會自己更新，但不打斷正在做的事', async () => {
  const [parent, office] = await Promise.all([indexHtml(), officeJs()]);
  for (const source of [parent, office]) {
    assert.match(source, /method:'HEAD',cache:'no-store'/, '用 HEAD 比 ETag，不下載整頁');
    assert.match(source, /etag/);
  }
  // 主系統：有彈窗、正在打字、寫到一半、剛操作過都不會自己重整，只顯示按鈕；也有防無限重整的保護。
  assert.match(parent, /if\(dirty\|\|modalOpen\(\)\|\|typing\(\)\)return false;/);
  assert.match(parent, /立即更新/);
  assert.match(parent, /autoUpdateAt/);
  // 像素辦公室：動態視窗開著、正在打字時不重整。
  assert.match(office, /if\(!pending\|\|storyOpen\(\)\|\|typingNow\(\)\)return;/);
});

test('限時動態支援 GIF 與手機影片：GIF 保留動畫、影片限長並在瀏覽器裡壓縮、播放器依影片長度倒數', async () => {
  const [js, html] = await Promise.all([officeJs(), officeHtml()]);
  assert.match(html, /accept="image\/jpeg,image\/png,image\/webp,image\/gif,video\/mp4,video\/quicktime,video\/webm"/);
  assert.match(html, /<video id="svVideo" playsinline muted/);
  assert.match(js, /STORY_GIF_MAX=5\*1024\*1024,STORY_VIDEO_MAX=10\*1024\*1024,STORY_VIDEO_SECONDS=30/);
  // GIF 不能走縮圖（會失去動畫）；iPhone 的 .mov 一律重新錄成瀏覽器都放得出來的格式。
  assert.match(js, /if\(type==='image\/gif'\)\{/);
  assert.match(js, /file\.size>STORY_VIDEO_MAX\|\|type==='video\/quicktime'/);
  assert.match(js, /new MediaRecorder\(canvas\.captureStream\(30\)/);
  // webm 錄影檔的 duration 是 Infinity，不能拿來判斷「太長」。
  assert.match(js, /Number\.isFinite\(video\.duration\)&&video\.duration>STORY_VIDEO_SECONDS/);
  assert.match(js, /function storyDuration\(\)/);
  assert.match(js, /if\(video\.ended\)stepStory\(1\)/);
});

test('動態視窗的關閉鈕固定在右上角，不受標題列內容（開聲音、暫停中）擠壓', async () => {
  const css = await officeCss();
  assert.match(css, /#svClose\{position:absolute;top:10px;right:10px;/);
});

test('個人技能表（人物資料卡）只在前台嵌入畫面顯示，編輯畫面不顯示', async () => {
  const [js, css] = await Promise.all([officeJs(), officeCss()]);
  assert.match(js, /if\(selected===null\|\|!embedMode\)\{card\.hidden=true;return;\}/);
  assert.match(css, /html:not\(\.embed\) \.person-card\{display:none!important\}/);
});

test('手機版（單欄）等級一覽表搬到最下面，走動搖桿才能跟場景在同一個畫面', async () => {
  const [js, css] = await Promise.all([officeJs(), officeCss()]);
  assert.match(js, /matchMedia\('\(max-width:1000px\)'\)/);
  assert.match(js, /if\(section\.parentElement!==main\)main\.append\(section\)/);
  assert.match(js, /else if\(section\.parentElement!==play\)play\.append\(section\)/);
  assert.match(css, /main>\.level-table-section\{background:white;/);
});

test('音樂：耳機＋點頭＋浮動音符，對話框位置改成跑馬燈歌名與播放鈕，點歌名開網頁', async () => {
  const [js, html, css] = await Promise.all([officeJs(), officeHtml(), officeCss()]);
  assert.match(html, /id="musicToggle"[\s\S]*id="musicUrl"[\s\S]*id="musicSave"[\s\S]*id="musicClear"/);
  // 「現在的心情」那一區裡的音樂按鈕。
  assert.ok(html.indexOf('id="moods"') < html.indexOf('id="musicToggle"') && html.indexOf('id="musicToggle"') < html.indexOf('id="message"'));
  assert.match(js, /headphones\.src='assets\/headphones-v1\.webp/);
  assert.match(js, /HP_FRAMES=6/);
  assert.match(js, /Math\.floor\(t\*4\)%HP_FRAMES/, '六格音符輪流跳動');
  assert.match(js, /const MUSIC_NOD=0;/, '聽音樂時完全不搖（身體與頭都不動）');
  assert.match(js, /function musicOf\(p\)/, '要用 function 宣告：腳本開頭的 syncViewLayout 就會用到');
  assert.match(js, /hits\.push\(\{type:'musicPlay'/);
  assert.match(js, /hits\.push\(\{type:'musicLink'/);
  assert.match(js, /window\.open\(music\.url,'_blank','noopener'\)/);
  assert.match(js, /#008214/);
  assert.match(js, /https:\/\/open\.spotify\.com\/embed\/iframe-api\/v1/);
  assert.match(css, /#spotifyDock\{/);
});

test('耳機位置往左下收、點綠色播放鈕直接播放（先預載 Spotify 播放器）', async () => {
  const js = await officeJs();
  // 耳機全員同大小、同對位（以 Anna 確認過的為準）。
  assert.match(js, /HP_SPAN_W=204,HP_CHIN_UP=43\.4,HP_DX_NAT=-3/);
  assert.doesNotMatch(js, /HP_SIZE|HP_DY=\[/);
  assert.match(js, /const g=fr\.geom,S=WD_SCALE,fw=HP_SPAN_W\/\.8\*S/, '耳機全員同大小，位置跟著臉中心與眼睛走');
  assert.match(js, /if\(p\.music&&p\.music\.provider==='spotify'\)wantSpotifyApi\(\)/);
  assert.match(js, /controller\.addListener\('ready',\(\)=>\{controller\.play\(\)/);
});

test('Spotify 播放器在畫面上隱藏（只聽音樂），用人物頭上的綠色鈕控制', async () => {
  const [js, css] = await Promise.all([officeJs(), officeCss()]);
  assert.match(css, /#spotifyDock\{[^}]*opacity:0;pointer-events:none/);
  assert.doesNotMatch(js, /aria-label=\"關閉播放器\"/);
  assert.match(js, /if\(!p\.music&&musicPlaying\.i===i\)stopMusic\(\)/);
});

test('像素辦公室的 app.js 語法正確（只比對文字的測試抓不到整行被註解吃掉這種錯）', async () => {
  const source = await officeJs();
  assert.doesNotThrow(() => new vm.Script(source, { filename: 'app.js' }));
});

test('音樂可以分享 Spotify 的歌單、專輯與 Podcast，跑馬燈標明種類並用對應的 URI 播放', async () => {
  const js = await officeJs();
  assert.match(js, /\(track\|album\|playlist\|show\|episode\)/);
  assert.match(js, /playlist:'♪ 歌單 · '/);
  assert.match(js, /episode:'🎙 Podcast · '/);
  assert.match(js, /uri:`spotify:\$\{info\.kind\}:\$\{info\.id\}`/);
  assert.match(js, /label=musicPrefix\(music\)\+music\.title/);
});

test('造型：頭像＋服裝＋配件在瀏覽器裡組合，依現有人物比例，男生頭在前、女生正面側面頭髮在後', async () => {
  const [js, html, css] = await Promise.all([officeJs(), officeHtml(), officeCss()]);
  for (const file of ['wardrobe-heads.webp', 'wardrobe-outfits.webp', 'wardrobe-acc.webp']) assert.ok(js.includes(`assets/${file}`), file);
  assert.match(js, /WD_FEMALE=\[true,true,false,true,false\],WD_K=1\.7,WD_OV=8,WD_SCALE=\.475/);
  assert.match(js, /const layers=!WD_FEMALE\[i\]\|\|view===2\?\[body,head\]:\[head,body\]/);
  assert.match(js, /if\(look\.glasses&&view<2&&accessoriesReady\(\)\)/, '背面不畫眼鏡');
  // 預設造型＝現在的樣子；只有 Anna 可以換衣服（藍色／黃色）。
  assert.match(js, /\{outfit:2,cap:'',glasses:''\},\{outfit:3,cap:'',glasses:''\},\{outfit:4,cap:'blue',glasses:''\},\{outfit:1,cap:'',glasses:''\},\{outfit:5,cap:'',glasses:''\}/);
  assert.match(js, /function outfitChoices\(i\)\{return i===3\?\[1,0\]:null;\}/);
  // 原本的像素人物已下架：只剩組合版，不再載入舊圖集。
  assert.match(js, /function sprite\(context,index,dir,x,y,w=98,h=142\)\{drawWardrobe\(context,index,dir,x,y,h\);\}/);
  assert.doesNotMatch(js, /sprites-packed|rowTops|colLefts/);
  for (const id of ['lookOutfits', 'lookCaps', 'lookGlasses']) assert.ok(html.includes(`id="${id}"`), id);
  assert.match(js, /pushChange\(i,\{look:isDefault\?'':next\}\)/);
  assert.match(css, /\.look-outfits\{/);
});

test('造型側面：眼鏡對到眼睛（偏右）、衣服往左收、帽子貼頭', async () => {
  const js = await officeJs();
  assert.match(js, /WD_SIDE_BODY_SHIFT=12/);
  assert.match(js, /x:\(view===1\?-WD_SIDE_BODY_SHIFT:0\)\+WD_BODY_DX\[i\]/);
  assert.match(js, /WD_BODY_DX=\[-8,0,0,-8,0\]/);
  assert.match(js, /x:view===1\?hx\+w\*\.06:/);
  // 側面眼睛位置（頭像圖上的 x）：Leona 約 88、Machi 約 77，不是原本誤抓的 68／49。
  const eyes = JSON.parse(js.match(/"eyes":(\[\[.*?\]\])\};/s)[1]);
  assert.ok(eyes[0][1].x > 85 && eyes[4][1].x > 74, '側面眼睛 x 要靠臉的前緣');
});

test('Machi 的衣服與配件（帽子、眼鏡、墨鏡）相對頭往下移', async () => {
  const js = await officeJs();
  assert.match(js, /WD_DROP=\[0,0,0,0,10\]/);
  assert.match(js, /y:WD_DROP\[i\],/);
  assert.equal((js.match(/\+WD_DROP\[i\]\}\)/g) || []).length, 2, '眼鏡與帽子都要加上');
});

test('耳機放大、往右，並且在帽子下層（耳機畫完再把帽子蓋上去）', async () => {
  const js = await officeJs();
  assert.match(js, /cx-fw\/2,ear-fh\*\.77,fw,fh\);drawWardrobeCap\(ctx,i,p\.dir,0,bob\+nod\);/);
  // 聽音樂時身體不搖，只有頭層加 nod。
  assert.match(js, /layer\.isBody\?0:nod/);
  assert.match(js, /function drawWardrobeCap\(/);
  assert.match(js, /capCanvas/);
});

test('帽子比之前再往下一點（正面 .34、側面 .32 倍帽高）', async () => {
  const js = await officeJs();
  assert.match(js, /h\*\(view===1\?\.32:\.34\)\+WD_DROP\[i\]/);
});

test('眼鏡與墨鏡全員同樣大（固定寬度，不依各人臉寬換算）', async () => {
  const js = await officeJs();
  assert.match(js, /WD_GLASSES_W=120/);
  assert.match(js, /s=WD_GLASSES_W\/gf\.w\*\(view===1\?\.95:1\),w=g\.w\*s/);
});

test('進站瘦身：配件與耳機延後載入、不擋 ready，預載只留必要的圖，Spotify 播放器等使用者有動作才載', async () => {
  const [js, html] = await Promise.all([officeJs(), officeHtml()]);
  // ready 只等頭像、衣服、家具；配件圖在 ready 之後才開始載。
  assert.match(js, /Promise\.all\(\[load\(wardrobeSheets\.heads\),load\(wardrobeSheets\.outfits\),load\(furniture\)\]\)\.then\(\(\)=>\{ready=true;loadAccessories\(\);/);
  assert.match(js, /function loadAccessories\(\)\{if\(!wardrobeSheets\.acc\.getAttribute\('src'\)\)/);
  // 耳機圖只有在有人聽音樂（或編輯畫面）才載。
  assert.doesNotMatch(js, /const headphones=new Image\(\);headphones\.src/, '耳機圖不能在宣告時就載');
  assert.match(js, /function ensureHeadphones\(\)/);
  // 預載只留進站一定要用的三張；其他圖由 app.js 之後再載，不跟 app.js 搶頻寬。
  assert.match(html, /rel="preload" as="image" href="assets\/wardrobe-heads\.webp/);
  assert.match(html, /rel="preload" as="image" href="assets\/furniture-v3\.webp/);
  assert.doesNotMatch(html, /preload[^>]*(icons-v3|icons-status-v4|overtime-filter)/);
  assert.match(html, /<script src="app\.js\?v=\d+" fetchpriority="high">/);
  // Spotify 播放器程式等第一次互動才載。
  assert.match(js, /function wantSpotifyApi\(\)\{spotifyWanted=true;if\(userTouched\)/);
  assert.doesNotMatch(js, /if\(p\.music&&p\.music\.provider==='spotify'\)spotifyApi\(\)/);
});

test('Machi 對齊 Anna 的高度，Anna 與 Machi 坐下再往下約半個滑鼠高（10）：座位附近才位移，走遠了就不動', async () => {
  const js = await officeJs();
  assert.match(js, /SEAT_LIFT=\[0,0,0,-10,-2\.4\]/);
  assert.match(js, /Math\.max\(0,1-Math\.hypot\(q\.x-o\[0\],q\.y-o\[1\]\)\/80\)/);
  assert.match(js, /-seatLift\(i\),tilt=0/);
});

test('頭像與服裝換成 2026-10-02 的新版比例：圖集資料齊全，背面不帶臉的皮膚框', async () => {
  const js = await officeJs();
  const data = JSON.parse(js.match(/const WARDROBE=(\{.*?\});\nconst WARDROBE_OUTFITS/s)[1]);
  assert.equal(data.heads.length, 5);
  assert.equal(data.outfits.length, 6);
  for (const person of data.heads) {
    assert.equal(person.length, 3);
    assert.ok(Array.isArray(person[0].s) && Array.isArray(person[1].s), '正面與側面要有臉的範圍');
    assert.equal(person[2].s, undefined, '背面不能帶皮膚框（男生後腦勺的耳朵會被誤當成臉，帽子位置就錯了）');
  }
  for (const outfit of data.outfits) assert.equal(outfit.length, 3);
  assert.equal(data.eyes.length, 5);
  assert.match(js, /wardrobe-heads\.webp\?v=3/);
  assert.match(js, /wardrobe-outfits\.webp\?v=3/);
});

test('「設計部即時動態」載入加速：API 與圖片在 HTML 解析時就開始，不等 app.js，也不等 iframe 滾進畫面', async () => {
  const [parent, html, js] = await Promise.all([indexHtml(), officeHtml(), officeJs()]);
  // 像素辦公室：兩個 API 在 head 就送出，app.js 第一次直接用那份結果，失敗才自己再問。
  assert.match(html, /window\.__pixelP=\(function\(\)\{var u='https:\/\/machi-design-api\.machi-chen\.workers\.dev\/api'/);
  assert.match(html, /action:'pixelOfficeState',since:0/);
  assert.match(html, /action:'pixelOfficeDesigners'/);
  assert.ok(html.indexOf('window.__pixelP') < html.indexOf('app.js?v='), '提早送出要在 app.js 之前');
  assert.match(js, /const early=window\.__pixelP&&window\.__pixelP\.state;/);
  assert.match(js, /let data=early\?await early:null;if\(!data\|\|!data\.ok\)data=await syncCall\(\{action:'pixelOfficeState'/);
  assert.match(js, /if\(!data\|\|!data\.ok\)data=await syncCall\(\{action:'pixelOfficeDesigners'\}\)/);
  // 主系統：iframe 不再 lazy（版面在摺線下面時會拖到捲動才開始載），三張必要的圖在主頁 head 就預載。
  assert.doesNotMatch(parent, /class="office-embed"[^>]*loading="lazy"/);
  for (const asset of ['wardrobe-heads.webp?v=3', 'wardrobe-outfits.webp?v=3', 'furniture-v3.webp?v=1']) {
    assert.ok(parent.includes(`<link rel="preload" as="image" href="EMC-ART-Pixel-Office/dist/assets/${asset}" />`), `主頁要預載 ${asset}`);
    assert.ok(html.includes(`href="assets/${asset}"`), `像素辦公室也要預載 ${asset}（兩邊網址要一致才會共用快取）`);
  }
});

test('像素辦公室 iframe 直接寫在 HTML 裡，不等案件資料載完才建立；兩處 ?v= 一致', async () => {
  const parent = await indexHtml();
  const staticTag = parent.match(/<div class="designer-roster" id="designerRoster"[^>]*>(?:<!--.*?-->)?<div class="office-embed-shell"><iframe class="office-embed" src="([^"]+)"/s);
  assert.ok(staticTag, 'designerRoster 裡要有寫死的 iframe');
  const dynamic = parent.match(/designerRoster\.innerHTML='<div class="office-embed-shell"><iframe class="office-embed" src="([^"]+)"/);
  assert.ok(dynamic, 'renderDesigners 的備援 iframe 還要在');
  assert.equal(staticTag[1], dynamic[1], '兩份 iframe 的網址（含 ?v=）要一樣，不然切換時會重載一次');
  assert.match(parent, /if\(!designerRoster\.querySelector\('\.office-embed'\)\)\{/);
});

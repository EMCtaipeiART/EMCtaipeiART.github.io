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
  assert.match(source, /src="EMC-ART-Pixel-Office\/dist\/\?embed=1&amp;v=25"/);
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
  assert.match(js, /if\(embedMode\)\{document\.body\.classList\.add\('embed'\);game\.tabIndex=-1;game\.setAttribute\('aria-label','設計部即時狀態場景'\);\}/);
  // 頁首、右側編輯工具、名單與標題列都不顯示，人物資料卡保留。
  for (const selector of ['header', 'aside', '.scene-bar', '.scene-foot', '#roster']) {
    assert.ok(new RegExp(`body\\.embed[^{]*${selector.replace('.', '\\.').replace('#', '#')}`).test(css)
      || css.includes(`body.embed ${selector}`), `嵌入模式應該隱藏 ${selector}`);
  }
  assert.doesNotMatch(css, /body\.embed[^\n{]*\.person-card\{display:none!important\}/,
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
  assert.doesNotMatch(css, /body\.embed #game\{width:\d/, '不該再用寫死的百分比放大');
  assert.match(css, /body\.embed #game\{max-width:none;display:block;transform-origin:top left/);
  assert.match(css, /body\.embed \.canvas-wrap\{height:100%;margin:0;overflow:hidden\}/,
    '放大後超出外框的場景應裁切在 iframe 內');
  assert.match(css, /body\.embed \.person-card-head,body\.embed \.person-card-title\{overflow-wrap:normal/,
    '名字與職稱不該被 overflow-wrap:anywhere 拆成單字');
  assert.doesNotMatch(css, /body\.embed \.person-card\{position:fixed!important;inset:8px!important/,
    '小螢幕人物卡不可再滿版');
  assert.match(js, /window\.addEventListener\('keydown',e=>\{if\(embedMode\|\|/,
    '嵌入場景仍不接受鍵盤方向鍵');
  // 版本號要跟著改，否則瀏覽器會吃到沒有嵌入模式的舊快取。
  const version = html.match(/app\.js\?v=(\d+)/);
  assert.ok(version && Number(version[1]) >= 32, `app.js 版本號要 ≥ 32，目前是 ${version?.[1]}`);
});

test('滑鼠移到人物上就展開資料卡，不需要點也沒有關閉鈕', async () => {
  const [js, css] = await Promise.all([officeJs(), officeCss()]);
  // 滑過人物直接展開；觸控裝置沒有 hover，仍走點選。
  assert.match(js, /if\(!embedMode\|\|e\.pointerType==='touch'\)return;/,
    '只有嵌入模式的滑鼠操作才 hover 展開');
  assert.match(js, /if\(hit&&hit\.type!=='status'\)\{if\(hit\.i!==selected\)select\(hit\.i\);\}/);
  // 卡片會蓋到人物旁邊，滑進卡片不能當成離開，否則會一直閃。
  assert.match(js, /let cardHovered=false;/);
  assert.match(js, /\$\('personCard'\)\.addEventListener\('pointerenter'/);
  assert.match(js, /game\.addEventListener\('pointerleave',\(\)=>\{if\(embedMode&&!cardHovered\)select\(null\);\}\)/);
  assert.match(js, /if\(embedMode\)\$\('personCardClose'\)\.hidden=true;/, '嵌入模式不顯示關閉鈕');
  assert.match(css, /body\.embed \.person-card-close\{display:none\}/);
});

test('人物卡在嵌入的小框裡也夠寬', async () => {
  const css = await officeCss();
  // 340 px 的框取 46% 約 140 px，所以下限才是實際生效的那個值。
  assert.match(css, /body\.embed \.person-card\{width:clamp\(208px,calc\(46% - 16px\),286px\)/);
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

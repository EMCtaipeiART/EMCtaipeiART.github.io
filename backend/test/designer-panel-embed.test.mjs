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
  assert.match(source, /src="EMC-ART-Pixel-Office\/dist\/\?embed=1&amp;v=22"/);
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
  assert.match(js, /game\.addEventListener\('pointermove',e=>\{const r=/,
    '人物上方應顯示可點選游標');
  assert.match(js, /labelY=s\.y\+\(embedMode&&s\.y>500\?26:56\)/,
    '嵌入版下排姓名牌應上移，不可被視窗底邊裁掉');
  assert.match(css, /body\.embed #game\{width:137%;max-width:none;[^}]*transform:translate\(-13\.5%,-22%\)/,
    '六個座位應比上一版縮小 3%，並往上調整以保留下排姓名');
  assert.match(css, /body\.embed \.canvas-wrap\{height:100%;margin:0;overflow:hidden\}/,
    '放大後超出外框的場景應裁切在 iframe 內');
  assert.match(css, /body\.embed #game\{width:167%;max-width:none;transform:translate\(-20\.1%,-24%\)/,
    '手機版也應縮小 3% 並保留下排姓名');
  // 嵌進去的框只有 340 px 上下，單純取三分之一會算出 106 px，名字會被拆成單字。寬度要有下限。
  assert.match(css, /body\.embed \.person-card\{width:clamp\(172px,calc\(33\.333% - 16px\),270px\);max-width:calc\(100% - 16px\)/,
    '人物卡寬度要有讀得下去的下限');
  assert.match(css, /body\.embed \.person-card-head,body\.embed \.person-card-title\{overflow-wrap:normal/,
    '名字與職稱不該被 overflow-wrap:anywhere 拆成單字');
  assert.doesNotMatch(css, /body\.embed \.person-card\{position:fixed!important;inset:8px!important/,
    '小螢幕人物卡不可再滿版');
  assert.match(css, /width:clamp\(168px,calc\(33\.333% - 8px\),270px\)/,
    '小螢幕的人物卡同樣要有寬度下限');
  assert.match(js, /window\.addEventListener\('keydown',e=>\{if\(embedMode\|\|/,
    '嵌入場景仍不接受鍵盤方向鍵');
  // 版本號要跟著改，否則瀏覽器會吃到沒有嵌入模式的舊快取。
  const version = html.match(/app\.js\?v=(\d+)/);
  assert.ok(version && Number(version[1]) >= 28, `app.js 版本號要 ≥ 28，目前是 ${version?.[1]}`);
});

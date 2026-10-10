/* 讓 index.html 的 site.css / site.js 帶上內容雜湊版本（?v=…），內容有變才換網址：平常走瀏覽器快取，更新後馬上拿到新版。 */
const fs = require('fs'), crypto = require('crypto'), path = require('path');
const root = path.join(__dirname, '..');
const htmlPath = path.join(root, 'index.html');
let html = fs.readFileSync(htmlPath, 'utf8');
const hash = file => crypto.createHash('sha1').update(fs.readFileSync(path.join(root, file))).digest('hex').slice(0, 10);
const next = html
  .replace(/(href="site\.css)(\?v=[0-9a-f]+)?(")/, (m, a, b, c) => `${a}?v=${hash('site.css')}${c}`)
  .replace(/(src="site\.js)(\?v=[0-9a-f]+)?(")/, (m, a, b, c) => `${a}?v=${hash('site.js')}${c}`);
if (next !== html) { fs.writeFileSync(htmlPath, next); console.log('stamp: index.html 版本已更新'); }

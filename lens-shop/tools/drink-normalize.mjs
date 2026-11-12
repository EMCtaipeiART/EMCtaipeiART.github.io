// 把兩個平台抓下來的原始菜單整理成「飲料團」通用格式 menus/*.json
// 通用格式：{ store, platform, link, items:[{cat,name,price,img,groups:[{n,min,max,o:[[選項,加價],…]}]}] }
// 用法：node tools/drink-normalize.mjs
import fs from 'fs';
import { fileURLToPath } from 'url';
const P = fileURLToPath(new URL('../', import.meta.url));
fs.mkdirSync(P + 'menus', { recursive: true });
const IMG = 'https://tb-static.uber.com/prod/image-proc/processed_images/';
const SUF = { A: 'a19bb09692310dfd41e49a96c424b3a6.jpeg', C: 'c67fc65e9b4e16a553eb7574fba090f1.jpeg', H: '7f4ae9ca0446cbc23e71d8d395a98428.jpeg', F: '0fb376d1da56c05644450062d25c5c84.jpeg', D: 'd03e52b3c8af19d8fa8222e23efd9cfa.jpeg' };
const cleanOpt = (s) => s.replace(/\s+\d+(?=\s*\(|$)/, '').trim(); // 去掉 Uber 的份量標記（「珍珠 2」→「珍珠」）
const grp = (s) => { const [t, min, max, o] = s.split('|'); return { n: t.trim(), min: +min, max: +max, o: o.split('^').map((x) => { const [n, p] = x.split('~'); return [cleanOpt(n), +p]; }) }; };

// 清心福全（Uber Eats）
{
  const r = JSON.parse(fs.readFileSync(P + 'tools/ue-qingxin-menu.json', 'utf8'));
  const gs = r.groups.map(grp);
  const items = r.items.map((s) => {
    const [, name, price, img, g, cat] = s.split('|');
    let u = '';
    if (img) { const [h, k] = img.split('/'); u = IMG + h + '/' + (SUF[k] || k); }
    return { cat, name: name.trim(), price: +price, img: u, groups: g ? g.split(',').map((i) => gs[+i]) : [] };
  }).filter((i) => i.cat !== '塑膠袋');
  fs.writeFileSync(P + 'menus/qingxin-minsheng.json', JSON.stringify({ store: r.store.name, platform: 'ubereats', link: '', items }, null, 1));
  console.log('清心福全', items.length, '項');
}
// 樂法 民生店（你訂）
{
  const r = JSON.parse(fs.readFileSync(P + 'tools/nidin-lephare-menu.json', 'utf8'));
  const adj = {}; for (const id in r.adjs) { const [t, , min, max, o] = r.adjs[id].split('|'); adj[id] = grp([t, min, max, o].join('|')); }
  const items = r.items.map((s) => {
    const [name, price, g, cat] = s.split('|');
    return { cat, name, price: +price, img: '', groups: g ? g.split(',').map((i) => adj[i]) : [] };
  }).filter((i) => i.cat !== '背心袋');
  fs.writeFileSync(P + 'menus/lephare-minsheng.json', JSON.stringify({ store: r.store, platform: 'nidin', link: r.link, items }, null, 1));
  console.log('樂法', items.length, '項');
}

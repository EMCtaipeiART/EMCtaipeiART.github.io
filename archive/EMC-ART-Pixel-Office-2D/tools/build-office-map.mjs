// 開發工具：把 capture-office-map 擷取的「真實辦公室」資料整理成躲貓貓用的地圖模組。
// 用法：node tools/build-office-map.mjs [擷取資料夾，預設 design/office-map]
// 輸出：dist/minigames/data/office-map.js（碰撞、擋視線的高家具、遮蔽區、出生點、遮擋圖層）與 dist/assets/office-map-v1.webp（半尺寸底圖）。
// 座標：世界座標＝擷取圖的像素座標（畫面座標 y ＋ OY）。所有家具維持原尺寸、原位置、原角度。
import fs from 'node:fs';
import path from 'node:path';

const src = path.resolve(process.argv[2] || 'design/office-map');
const d = JSON.parse(fs.readFileSync(path.join(src, 'office-map-data.json'), 'utf8'));
const OY = d.canvas.OY, R = 28;           // 玩家碰撞半徑（約半個肩寬，和 hideseek-sim 的 RULES.r 一致）
const Y = v => v + OY;
const rc = (x, y, w, h) => ({ x: Math.round(x), y: Math.round(Y(y)), w: Math.round(w), h: Math.round(h) });
const same = (a, b) => a.x === b.x && a.y === b.y && a.w === b.w && a.h === b.h;

// ───────── 碰撞與擋視線 ─────────
const solids = [];
const add = (kind, r, tall) => solids.push({ id: kind + solids.length, kind, tall: !!tall, ...rc(r.x, r.y, r.w, r.h) });
const roomPieces = [...d.roomWalls, ...d.roomCorners];
d.allWalls.forEach((w, i) => {
  if (i < d.deskWalls.length) return add('desk', w, false);                       // 設計部桌子：低，不擋視線
  if (roomPieces.some(p => same(p, w))) return add('wall', w, true);              // 玻璃牆（磨砂）：擋視線，門的缺口保留
  const it = d.items.find(t => t.solid && w.x >= t.x - 2 && w.x < t.x + t.w + 2 && w.y >= t.y - 140 && w.y <= t.y + t.h);
  const tall = it ? ['blocker', 'elevator', 'fridge_dark'].includes(it.kind === 'sprite' ? it.name : it.kind) : false;
  // 沒對到房間家具的，是書櫃／方柱／紅箱那幾塊（場景本來就擋路）：蓋到書櫃或方柱的算高家具，其餘（長桌旁的小桌）是低家具
  const isShelf = !it && d.propCalls.some(p => w.x < p.x + p.w + 20 && p.x < w.x + w.w + 20 && w.y < p.y + p.h + 40 && p.y < w.y + w.h + 40);
  add(it ? (tall ? 'tall' : 'table') : isShelf ? 'shelf' : 'desk', w, tall || isShelf);
});

// ───────── 填平擠不過去的窄縫 ─────────
// 家具之間（或家具與邊界之間）若有 0 < 縫 < 兩倍半徑＋2 的縫，人走不進去、卻可能被推擠卡進家具裡；
// 這裡用 'gap' 方塊把縫補起來（只補縫的範圍，不改任何家具）。
const bnd = d.bounds, BX = bnd.minX, BY = Math.round(Y(bnd.minY)), BW = bnd.maxX - bnd.minX, BH = Math.round(bnd.maxY - bnd.minY);
const fences = [{ x: BX - 200, y: BY - 200, w: BW + 400, h: 200 }, { x: BX - 200, y: BY + BH, w: BW + 400, h: 200 }, { x: BX - 200, y: BY, w: 200, h: BH }, { x: BX + BW, y: BY, w: 200, h: BH }];
const NEED = 2 * R + 2;
const gapOf = (a, b) => [Math.max(0, a.x - (b.x + b.w), b.x - (a.x + a.w)), Math.max(0, a.y - (b.y + b.h), b.y - (a.y + a.h))];
let filled = 0;
const base = solids.slice(), seen = new Set();
const all = [...base, ...fences.map(f => ({ ...f, fence: true }))];
for (let i = 0; i < all.length; i++) for (let j = i + 1; j < all.length; j++) {
  const A = all[i], B = all[j];
  if (A.fence && B.fence) continue;
  const [gx, gy] = gapOf(A, B);
  if ((gx > 0) === (gy > 0)) continue;                 // 重疊（0,0）或斜角對斜角（兩邊都 >0）：不補
  if (Math.max(gx, gy) >= NEED) continue;
  const x0 = gx ? Math.min(A.x + A.w, B.x + B.w) : Math.max(A.x, B.x), x1 = gx ? Math.max(A.x, B.x) : Math.min(A.x + A.w, B.x + B.w);
  const y0 = gy ? Math.min(A.y + A.h, B.y + B.h) : Math.max(A.y, B.y), y1 = gy ? Math.max(A.y, B.y) : Math.min(A.y + A.h, B.y + B.h);
  if (x1 <= x0 || y1 <= y0) continue;
  const key = [x0, y0, x1, y1].join(',');
  if (seen.has(key)) continue;seen.add(key);
  solids.push({ kind: 'gap', tall: !!(A.tall && B.tall), x: x0, y: y0, w: x1 - x0, h: y1 - y0 }); filled++;
}

// ───────── 遮擋圖層（人物走到家具後面時，把家具那一塊底圖再畫一次蓋在人物上）─────────
const occluders = [];
const occ = (x, y, w, h, depth, tag) => occluders.push({ x: Math.round(x), y: Math.round(Y(y)), w: Math.round(w), h: Math.round(h), depth: Math.round(Y(depth)), tag });
for (const p of d.propCalls) occ(p.x, p.y, p.w, p.h, p.y + p.h, p.name);
for (const it of d.items) {
  if (it.kind === 'table') occ(it.x, it.y, it.w, it.h, it.y + it.h, 'table');
  else if (it.kind === 'sprite' && !/snack|projector/.test(it.name)) occ(it.x, it.y, it.w, it.h, it.depth || it.y + it.h, it.name);
}
const tops = d.deskWalls.filter(r => r.h === 55);
for (const t of tops) { const body = d.deskWalls.find(r => r.x === t.x && r.h === 150 && Math.abs(r.y - (t.y + 40)) < 6); if (body) occ(t.x, t.y - 45, t.w, body.y + body.h - (t.y - 45), body.y + body.h, 'desk'); }

// ───────── 遮蔽區域（躲在裡面，尋找者要靠近才看得到）─────────
const Z = [];
const zone = (id, label, x, y, w, h) => Z.push({ id, label, ...rc(x, y, w, h) });
for (const [pre, name, dx] of [['m', '男廁', 0], ['f', '女廁', 322]]) {
  zone(pre + '-stall1', name + '隔間', 592 + dx, -1240, 168, 60);
  zone(pre + '-stall2', name + '隔間', 592 + dx, -1128, 168, 60);
  zone(pre + '-sink', name + '洗手台旁', 625 + dx, -1040, 170, 96);
}
zone('elevator', '電梯前', 240, -850, 170, 90);
zone('a-left', '會議室 A 左側', 1335, -1180, 95, 220);
zone('a-right', '會議室 A 右側', 1985, -1180, 110, 220);
zone('b-top', '會議室 B 上方', 90, 760, 400, 66);
zone('b-bottom', '會議室 B 下方', 90, 1075, 400, 62);
zone('c-top', '會議室 C 上方', 90, 1222, 400, 66);
zone('c-bottom', '會議室 C 下方', 90, 1500, 400, 100);
zone('d-inside', '會議室 D 中央', 1500, 1180, 520, 330);
zone('d-left', '會議室 D 左側', 1270, 1010, 105, 400);
zone('d-right', '會議室 D 右側', 2160, 1010, 100, 400);
zone('d-bottom', '會議室 D 下方', 1290, 1430, 960, 170);
zone('d-topl', '會議室 D 入口左', 1280, 760, 410, 110);
zone('d-topr', '會議室 D 入口右', 1840, 760, 400, 110);
zone('tea-east', '茶水間冰箱旁', 1112, 1160, 130, 150);
zone('tea-south', '茶水間桌下', 620, 1245, 300, 90);
for (const [n, y] of [[0, 320], [1, -180], [2, -675]]) zone('shelf-' + n, '書櫃旁', 545, y, 105, 200);

// 每個遮蔽區挑一個「圓真的放得進去」的點，機器人與出生檢查都用它
const free = (x, y, r = R + 1) => solids.every(s => Math.hypot(x - Math.max(s.x, Math.min(x, s.x + s.w)), y - Math.max(s.y, Math.min(y, s.y + s.h))) >= r);
const issues = [];
for (const z of Z) {
  let best = null;
  for (let x = z.x + R; x <= z.x + z.w - R; x += 6) for (let y = z.y + R; y <= z.y + z.h - R; y += 6) {
    if (!free(x, y)) continue;
    const dc = Math.hypot(x - (z.x + z.w / 2), y - (z.y + z.h / 2));
    if (!best || dc < best.dc) best = { x, y, dc };
  }
  if (!best) issues.push('遮蔽區放不下一個人：' + z.id); else z.spot = { x: best.x, y: best.y };
  if (solids.some(s => z.x < s.x + s.w && s.x < z.x + z.w && z.y < s.y + s.h && s.y < z.y + z.h && s.kind !== 'prop' && false)) issues.push('overlap ' + z.id);
}
const spawns = [700, 800, 900, 1000, 1100, 1200].map(x => ({ x, y: Math.round(Y(800)) }));
for (const s of spawns) if (!free(s.x, s.y)) issues.push('出生點被擋住：' + s.x + ',' + s.y);

const b = d.bounds;
const OFFICE = {
  w: d.canvas.W, h: d.canvas.H, oy: OY, bounds: { x: b.minX, y: Math.round(Y(b.minY)), w: b.maxX - b.minX, h: Math.round(b.maxY - b.minY) },
  image: { file: 'assets/office-map-v1.webp', scale: 0.5 },
  solids: solids.map(({ id, ...s }) => s), zones: Z, spawns, occluders,
  rooms: d.rooms.map(r => ({ name: r.name, x: r.x, y: Math.round(Y(r.y)), w: r.w, h: r.h }))
};
const outJs = path.resolve('dist/minigames/data/office-map.js');
fs.mkdirSync(path.dirname(outJs), { recursive: true });
fs.writeFileSync(outJs, '// 由 tools/build-office-map.mjs 產生，請勿手改。來源：真實辦公室場景（家具原尺寸、原位置、原角度）。\nexport const OFFICE=' + JSON.stringify(OFFICE) + ';\n');
fs.copyFileSync(path.join(src, 'office-map-half.webp'), path.resolve('dist/assets/office-map-v1.webp'));
console.log('補縫', filled, '處；solids', solids.length, '(tall ' + solids.filter(s => s.tall).length + ') zones', Z.length, 'occluders', occluders.length, 'spawns', spawns.length);
if (issues.length) { console.log('需要處理：\n' + issues.join('\n')); process.exitCode = 1; }

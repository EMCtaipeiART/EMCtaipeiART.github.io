// 聖誕節佈置（四樓＋五樓）：露台與室內積雪（清出走道）、飄雪、雪人、聖誕樹、串燈、禮物盒、花圈。
// 規格見 UI-SPEC.md §7.5。關閉：網址加 ?xmas=0，或拿掉 index.html 裡的 createXmas() 呼叫。
// 聖誕樹整棵掛霓虹串燈閃爍。位置全部寫死或用固定種子（每個人看到一樣、碰撞一樣）；只有「室內聖誕樹區」登記碰撞，其餘放在走不到的露台、牆頂、櫃頂。
import * as THREE from 'three';
import {mergeGeometries} from '../character-studio/vendor/BufferGeometryUtils.js';

const C = {red:0xd8383f, darkRed:0xa8242e, green:0x1f8a45, pine:0x17703a, pine2:0x239150, gold:0xffc733, white:0xf8fbff, snow:0xeef5ff, coal:0x23282e,
  orange:0xf58a1f, wood:0x8a6a3c, blue:0x3f7fd8, cream:0xf4f1ea};
const BULBS = [0xff4048, 0xffc733, 0x35e06a, 0x4fb4ff];
const EDGE = .018;   // 黑色外框粗細（世界單位）

// 室內聖誕樹區：[x px, z px, 樹的大小, 要不要放雪人]；五樓座標是位移後的實際值，四樓是本機座標
const SPOTS5 = [[1137, 62, 1.15, true], [62, 40, 1.0, false], [1141, 1330, 1.05, true], [452, 1450, 1.0, false]];
const SPOTS4 = [[1335, 135, 1.15, true], [35, 40, 1.0, false], [528, 640, .82, false], [1340, 640, 1.05, true], [1340, 1610, 1.1, false], [470, 1620, 1.0, true]];

// ---------- 聖誕老人裝（傅思凱 Eric 的立體模型）：模型載入後、拆關節前呼叫，改衣服顏色並加上帽子、鬍子、毛邊、腰帶扣 ----------
// 座標是模型單位（身高約 6，臉朝 +z）；零件名稱沿用 machi_<部位>__<材質>，遊戲的外框與動作才會自動套用
export function santaSuit(root){
  const mats = {}, mat = (name, color) => mats[name] ||= Object.assign(new THREE.MeshStandardMaterial({color}), {name});
  const RED = 0xd42a33, DARK = 0x9c1c26, FUR = 0xfbfdff, GOLD = 0xffc733;
  const recolor = {shirt:RED, pants:RED, shirt_cuff:FUR, shirt_line:DARK, pants_line:DARK, button:GOLD, shoe:0x17181c};
  root.traverse(o => { if (!o.isMesh) return; const n = o.material.name, body = o.name.startsWith('machi_body__'), c = n === 'silver' && body ? GOLD : recolor[n];
    if (c !== undefined) o.material = mat(n + (n === 'silver' ? '_gold' : '_santa'), c); });
  let id = 0;
  const add = (part, key, color, geo, x, y, z) => { geo.translate(x, y, z); const m = new THREE.Mesh(geo, mat(key, color)); m.name = 'machi_' + part + '__' + key + '_' + (id++); root.add(m); };
  const fluff = (part, x, y, z, r, sx = 1, sy = 1, sz = 1) => { const g = new THREE.SphereGeometry(r, 12, 9); g.scale(sx, sy, sz); add(part, 'santa_fur', FUR, g, x, y, z); };
  // 帽子：沿著往右後方垂下的曲線一圈圈疊成的軟帽
  { const path = new THREE.CatmullRomCurve3([[0, 5.0, -.05], [.05, 5.75, -.15], [.35, 6.4, -.35], [1.05, 6.55, -.55], [1.75, 6.0, -.6]].map(p => new THREE.Vector3(...p)));
    const R = 18, S = 24, pos = [], ix = [], frames = path.computeFrenetFrames(R, false), v = new THREE.Vector3();
    for (let i = 0; i <= R; i++) { const t = i / R, c = path.getPointAt(t), r = .1 + 1.4 * Math.pow(1 - t, 1.35);
      for (let j = 0; j <= S; j++) { const a = j / S * Math.PI * 2; v.copy(c).addScaledVector(frames.normals[i], Math.cos(a) * r).addScaledVector(frames.binormals[i], Math.sin(a) * r); pos.push(v.x, v.y, v.z); } }
    for (let i = 0; i < R; i++) for (let j = 0; j < S; j++) { const a = i * (S + 1) + j, b = a + S + 1; ix.push(a, a + 1, b, b, a + 1, b + 1); }
    const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); g.setIndex(ix); g.computeVertexNormals(); add('head', 'santa_hat', RED, g, 0, 0, 0);
    const brim = new THREE.TorusGeometry(1.44, .25, 10, 36); brim.rotateX(Math.PI / 2 - .12); add('head', 'santa_fur', FUR, brim, 0, 5.03, -.04);
    fluff('head', 1.82, 5.9, -.6, .36); }
  // 鬍子：沿下巴一圈毛球＋兩撇小鬍子（不蓋到眼鏡與眼睛）
  for (let i = 0; i <= 8; i++) { const a = (i / 8 - .5) * 2.5, side = Math.abs(i - 4) / 4; fluff('head', Math.sin(a) * 1.18, 2.78 + side * side * .72, Math.cos(a) * 1.08 + .12, .34 - side * .13); }
  for (const x of [-.34, 0, .34]) fluff('head', x, 2.55 - (x ? 0 : .14), 1.12, .3);
  for (const k of [-1, 1]) fluff('head', k * .27, 3.4, 1.5, .17, 1.7, .7, .6);
  // 衣服：領口與下襬毛邊、前襟、金色腰帶扣
  const ring = (part, x, y, z, r, tube, sz = 1) => { const g = new THREE.TorusGeometry(r, tube, 8, 32); g.rotateX(Math.PI / 2); g.scale(1, 1, sz); add(part, 'santa_fur', FUR, g, x, y, z); };
  ring('body', 0, 1.7, .07, .84, .1, .92);
  add('body', 'santa_fur', FUR, new THREE.BoxGeometry(.2, .98, .08), 0, 2.2, .82);
  add('body', 'santa_buckle', GOLD, new THREE.BoxGeometry(.5, .36, .09), 0, 1.47, .92);
  add('body', 'santa_belthole', 0x17181c, new THREE.BoxGeometry(.28, .17, .06), 0, 1.47, .96);
  for (const k of [-1, 1]) ring('leg' + (k > 0 ? 'L' : 'R'), k * .5, .55, .1, .4, .1);
}

// ---------- 室內積雪的「踩出來的走道」（版面 px；五樓＝位移後的實際值，四樓＝本機座標）。整層鋪滿有高低的積雪，沿這些線零星清出幾塊地板 ----------
// 線段 [x0, y0, x1, y1]；矩形 {r:[x0, y0, x1, y1], full:true＝整塊清乾淨（地面投影），否則只壓薄}。改家具或通道後要回來調
const PATHS5 = [
  [40, 268, 1142, 268], [40, 512, 1142, 512], [40, 749, 1142, 749], [40, 1010, 1142, 1010],                 // 四條橫走道（桌排之間）
  [40, 268, 40, 1010], [346, 268, 346, 1010], [1142, 100, 1142, 1010],                                      // 三條直走道
  [201, 205, 201, 268], [408, 185, 408, 268], [570, 185, 570, 268], [634, 100, 634, 268], [634, 101, 705, 101],   // 電梯、男廁、女廁、會議室 A 門口
  {r:[305, 5, 425, 195]}, {r:[465, 5, 590, 195]},                                                           // 廁所內
  [440, 1010, 440, 1405], [240, 1177, 440, 1177], [240, 1385, 440, 1385], [440, 1330, 570, 1330], [440, 1300, 340, 1300],   // 茶水間、倉庫、會議室 C
  [846, 1010, 846, 1150], [650, 1140, 1044, 1140], {r:[738, 1312, 954, 1425], full:true}, [1142, 1010, 1142, 1250]     // 會議室 D（含地面投影範圍）、右下聖誕樹
];
const PATHS4 = [
  [-30, 305, 1345, 305], [-30, 578, 528, 578], [-30, 810, 528, 810], [-30, 1043, 528, 1043], [-30, 1275, 528, 1275], [-30, 1590, 1345, 1590],
  [-30, 110, -30, 1590], [528, 305, 528, 1590], [1345, 150, 1345, 1590], [528, 738, 1345, 738], [528, 1298, 1345, 1298], [872, 1298, 872, 1590],
  [160, 262, 160, 305], [582, 120, 582, 305], [743, 120, 743, 305], {r:[480, 50, 600, 225]}, {r:[640, 50, 760, 225]},   // 電梯、廁所
  [820, 110, 820, 305], [820, 100, 1190, 100], [1190, 100, 1190, 305],                                      // 茶水間、冰箱
  [705, 305, 705, 540], [705, 540, 897, 690], [897, 690, 897, 738],                                         // 會議室 H
  [768, 738, 768, 1298], [1118, 738, 1118, 1298], [598, 1018, 1288, 1018],                                  // 大辦公室
  [872, 1433, 790, 1433], [872, 1433, 955, 1433]                                                            // 會議室 F、G
];

// 薑餅人散步路線與室內麋鹿滑行路線（版面 px，繞圈）；改家具後要確認路線沒有穿過桌子和牆
const GINGER5 = [[[40, 268], [346, 268], [346, 749], [40, 749]], [[346, 512], [1142, 512], [1142, 749], [346, 749]], [[346, 268], [1142, 268], [1142, 512], [346, 512]], [[452, 1060], [570, 1060], [570, 1330], [452, 1330]]];
const GINGER4 = [[[-30, 305], [528, 305], [528, 578], [-30, 578]], [[-30, 810], [528, 810], [528, 1275], [-30, 1275]], [[528, 738], [1345, 738], [1345, 1298], [528, 1298]], [[820, 305], [1320, 305], [1320, 270], [820, 270]]];
const DEER_IN = [[[40, 1010], [1142, 1010], [1142, 749], [40, 749]], [[478, 305], [1250, 305], [1250, 738], [478, 738]]];
const F_ELEV = 160;   // 四樓電梯中心（本機 px）

export function createXmas({scene, rects, blocked, chairSeats, U, FX4, floor4, fridges, wallBoxes, outlineMat, HULL_LAYER, FLAT, themeHooks, dark, doors, now, people}){
  let seed = 20261225; const rnd = () => { seed = (seed * 1664525 + 1013904223) >>> 0; return seed / 4294967296; };
  const still = matchMedia('(prefers-reduced-motion: reduce)').matches;
  const small = Math.min(innerWidth, innerHeight) <= 640 || matchMedia('(pointer: coarse)').matches;   // 手機：雪花少一點
  const added = [];
  const add = o => { o.userData.noShift = true; scene.add(o); return o; };

  // ---------- 造型零件：每種道具合併成「本體＋黑外框」兩個幾何，用 InstancedMesh 重複擺放（每種只花 2 個 draw call） ----------
  const paint = (geo, color) => { const g = geo.index ? geo.toNonIndexed() : geo; g.deleteAttribute('uv'); const c = new THREE.Color(color), n = g.attributes.position.count, a = new Float32Array(n * 3); for (let i = 0; i < n; i++) c.toArray(a, i * 3); g.setAttribute('color', new THREE.BufferAttribute(a, 3)); return g; };
  function kit(){
    const body = [], line = [];
    const put = (list, g, x, y, z, rx, ry, rz) => { if (rx) g.rotateX(rx); if (rz) g.rotateZ(rz); if (ry) g.rotateY(ry); g.translate(x, y, z); list.push(g); };
    const strip = g => { const o = g.index ? g.toNonIndexed() : g; o.deleteAttribute('uv'); return o; };
    const part = (make, color, x, y, z, edge, rx = 0, ry = 0, rz = 0) => { put(body, paint(make(0), color), x, y, z, rx, ry, rz); if (edge) put(line, strip(make(EDGE)), x, y, z, rx, ry, rz); };
    return {
      box:(w, h, d, color, x, y, z, edge = true, ry = 0) => part(t => new THREE.BoxGeometry(w + 2 * t, h + 2 * t, d + 2 * t), color, x, y, z, edge, 0, ry),
      cyl:(r0, r1, h, color, x, y, z, edge = true, seg = 10) => part(t => new THREE.CylinderGeometry(r0 + t, r1 + t, h + 2 * t, seg), color, x, y, z, edge),
      cone:(r, h, color, x, y, z, edge = true, seg = 10, rx = 0, rz = 0) => part(t => new THREE.ConeGeometry(r + t * 1.3, h + t * 2.6, seg), color, x, y, z, edge, rx, 0, rz),
      ball:(r, color, x, y, z, edge = true, sy = 1) => part(t => { const g = new THREE.SphereGeometry(r + t, 12, 9); g.scale(1, sy, 1); return g; }, color, x, y, z, edge),
      torus:(r, tube, color, x, y, z, edge = true) => part(t => new THREE.TorusGeometry(r, tube + t, 7, 18), color, x, y, z, edge),
      // 扁片（薑餅人用）：正面看是膠囊形（半徑 r、上下長 len），厚度 depth
      cookie:(r, len, depth, color, x, y, z, edge = true) => part(t => { const R = r + t, d = depth + 2 * t, sh = new THREE.Shape(); sh.absarc(0, len / 2, R, 0, Math.PI, false); sh.absarc(0, -len / 2, R, Math.PI, Math.PI * 2, false);
        const g = new THREE.ExtrudeGeometry(sh, {depth:d, bevelEnabled:false, curveSegments:12}); g.translate(0, 0, -d / 2); return g; }, color, x, y, z, edge),
      done:() => ({body:mergeGeometries(body), line:line.length ? mergeGeometries(line) : null})
    };
  }
  const solidMat = FLAT ? new THREE.MeshLambertMaterial({vertexColors:true}) : new THREE.MeshStandardMaterial({vertexColors:true, roughness:.68, metalness:.03});
  if (!FLAT) {   // 雪白色的零件（雪人、雪帽、雪堆）加一點自發光，背光面才不會灰掉
    solidMat.onBeforeCompile = sh => { sh.fragmentShader = sh.fragmentShader.replace('#include <emissivemap_fragment>', `#include <emissivemap_fragment>
      totalEmissiveRadiance += vColor.rgb * smoothstep(.7, .85, min(vColor.r, vColor.g)) * vec3(.2, .22, .27);`); };
    solidMat.customProgramCacheKey = () => 'xmas-snow';
  }
  const dummy = new THREE.Object3D();
  function scatter(k, list, shadow = true){   // list：[x, y, z, 大小, 轉角]（世界座標）
    if (!list.length) return;
    for (const [geo, mat, isLine] of [[k.body, solidMat, false], [k.line, outlineMat, true]]) {
      if (!geo) continue; const m = new THREE.InstancedMesh(geo, mat, list.length);
      list.forEach(([x, y, z, s = 1, r = 0], i) => { dummy.position.set(x, y, z); dummy.rotation.set(0, r, 0); dummy.scale.setScalar(s); dummy.updateMatrix(); m.setMatrixAt(i, dummy.matrix); });
      if (isLine) m.layers.set(HULL_LAYER); else { m.castShadow = shadow && !FLAT; m.receiveShadow = !FLAT; }
      m.computeBoundingSphere(); add(m); added.push(m);
    }
  }

  // 大聖誕樹（室內）：四層樹冠＋雪邊＋彩球＋金星；燈泡另外做（才能閃）
  const TIERS = [[1.0, .95, .78], [.82, .9, 1.3], [.62, .82, 1.8], [.42, .72, 2.27]];   // [半徑, 高, 中心高]
  const bigTree = (() => { const k = kit();
    k.cyl(.3, .24, .34, C.red, 0, .17, 0); k.cyl(.33, .33, .07, C.gold, 0, .35, 0); k.cyl(.12, .14, .3, C.wood, 0, .5, 0, false);
    TIERS.forEach(([r, h, y], i) => { k.cone(r, h, i % 2 ? C.pine2 : C.pine, 0, y, 0, true, 12); k.cone(r * .36, h * .34, C.snow, 0, y + h * .335, 0, false, 12);
      for (let n = 0; n < 6 - i; n++) { const a = n / (6 - i) * Math.PI * 2 + i * .7, f = .74; k.ball(.085, [C.red, C.gold, C.blue, C.white][(n + i) % 4], Math.sin(a) * r * f, y - h * .5 + h * (1 - f) + .02, Math.cos(a) * r * f); } });
    k.ball(.1, C.gold, 0, 2.72, 0, false); for (let n = 0; n < 5; n++) { const a = n / 5 * Math.PI * 2; k.cone(.085, .24, C.gold, Math.sin(a) * .17, 2.72 + Math.cos(a) * .17, 0, true, 4, 0, -a); }
    return k.done(); })();
  // 戶外雪松（露台）
  const pine = (() => { const k = kit(); k.cyl(.13, .16, .4, C.wood, 0, .2, 0);
    for (const [r, h, y] of [[.78, .85, .72], [.6, .75, 1.17], [.4, .66, 1.6]]) { k.cone(r, h, C.green, 0, y, 0, true, 9); k.cone(r * .55, h * .5, C.snow, 0, y + h * .26, 0, false, 9); }
    return k.done(); })();
  const miniTree = (() => { const k = kit(); k.cyl(.13, .1, .15, C.red, 0, .075, 0);
    for (const [r, h, y] of [[.3, .34, .31], [.23, .3, .5], [.15, .26, .68]]) k.cone(r, h, C.pine2, 0, y, 0, true, 9);
    for (let n = 0; n < 5; n++) { const a = n * 2.4; k.ball(.04, n % 2 ? C.red : C.gold, Math.sin(a) * (.23 - n * .028), .24 + n * .12, Math.cos(a) * (.23 - n * .028), false); }
    k.ball(.07, C.gold, 0, .85, 0); return k.done(); })();
  const snowman = (() => { const k = kit();
    k.ball(.5, C.white, 0, .42, 0, true, .92); k.ball(.36, C.white, 0, 1.04, 0); k.ball(.27, C.white, 0, 1.52, 0);
    k.cyl(.27, .29, .11, C.red, 0, 1.31, 0); k.box(.13, .36, .07, C.red, .13, 1.1, .34);
    k.cyl(.31, .31, .05, C.coal, 0, 1.73, 0); k.cyl(.19, .2, .28, C.coal, 0, 1.89, 0); k.cyl(.21, .21, .07, C.green, 0, 1.8, 0, false);
    for (const x of [-.09, .09]) k.ball(.037, C.coal, x, 1.58, .25, false);
    k.cone(.055, .27, C.orange, 0, 1.5, .37, false, 8, Math.PI / 2);
    for (const y of [1.14, .95]) k.ball(.045, C.coal, 0, y, .355, false);
    for (const s of [-1, 1]) { k.box(.46, .06, .06, C.wood, s * .55, 1.12, 0, false, 0); k.box(.06, .22, .06, C.wood, s * .72, 1.2, 0, false); }
    return k.done(); })();
  const gift = (paper, ribbon) => { const k = kit(); k.box(.46, .34, .46, paper, 0, .17, 0); k.box(.51, .09, .51, paper, 0, .385, 0);
    k.box(.1, .445, .53, ribbon, 0, .218, 0, false); k.box(.53, .44, .1, ribbon, 0, .218, 0, false);
    for (const s of [-1, 1]) k.cone(.09, .2, ribbon, s * .1, .48, 0, true, 6, 0, s * Math.PI / 2); k.ball(.055, ribbon, 0, .47, 0); return k.done(); };
  const gifts = [gift(C.red, C.gold), gift(C.green, C.white), gift(C.blue, C.gold), gift(C.cream, C.red)];
  const wreath = (() => { const k = kit(); k.torus(.3, .1, C.pine, 0, 0, 0);
    for (let n = 0; n < 7; n++) { const a = n / 7 * Math.PI * 2 + .4; k.ball(.05, n % 2 ? C.red : C.gold, Math.sin(a) * .3, Math.cos(a) * .3, .1, false); }
    for (const s of [-1, 1]) { k.cone(.1, .22, C.red, s * .11, -.31, .13, true, 4, 0, s * Math.PI / 2); k.box(.07, .24, .04, C.red, s * .08, -.46, .12, false); } k.ball(.06, C.red, 0, -.31, .14); return k.done(); })();
  const mound = (() => { const k = kit(); k.ball(.6, C.snow, 0, 0, 0, false, .38); return k.done(); })();
  const post = (() => { const k = kit(); k.cyl(.055, .07, 1.0, C.darkRed, 0, .5, 0); for (const y of [.34, .66]) k.cyl(.068, .072, .11, C.white, 0, y, 0, false); k.ball(.1, C.gold, 0, 1.05, 0); return k.done(); })();
  const rug = (() => { const k = kit(); k.cyl(1.08, 1.08, .012, C.darkRed, 0, .008, 0, false, 28); k.cyl(.94, .94, .012, C.white, 0, .012, 0, false, 28); k.cyl(.86, .86, .012, C.red, 0, .016, 0, false, 28); return k.done(); })();

  // ---------- 串燈：全部燈泡分三組（InstancedMesh），輪流明暗；電線是一條 LineSegments ----------
  const bulbs = [[], [], []], wire = [];
  const bulb = (x, y, z, s = 1) => { const n = bulbs[0].length + bulbs[1].length + bulbs[2].length; bulbs[n % 3].push([x, y, z, s, BULBS[n % BULBS.length]]); };
  function strand(ax, ay, az, bx, by, bz, sag, gap){   // 兩點之間垂一段燈串
    const len = Math.hypot(bx - ax, bz - az), n = Math.max(2, Math.round(len / gap)); let px = ax, py = ay, pz = az;
    for (let i = 1; i <= n; i++) { const t = i / n, x = ax + (bx - ax) * t, y = ay + (by - ay) * t - Math.sin(t * Math.PI) * sag, z = az + (bz - az) * t;
      wire.push(px, py, pz, x, y, z); px = x; py = y; pz = z; if (i < n) bulb(x, y - .06, z); }
    bulb(bx, by - .02, bz);
  }
  // 聖誕樹整棵的霓虹串燈：分四組快慢輪閃，燈泡外面一圈彩色光暈
  const NEON = [0xff2bd6, 0x19e6ff, 0x66ff3a, 0xffe12b, 0x9b5cff, 0xff3b3b], neon = [[], [], [], []];
  let neonN = 0;
  function treeLights(x, y, z, s, tiers, per, size){   // 每層樹冠繞一圈圈燈泡，貼著圓錐表面
    tiers.forEach(([r, h, cy], i) => { const n = Math.max(4, Math.round(r * per));
      for (let j = 0; j < n; j++) { const a = j / n * Math.PI * 2 + i * .9, f = .05 + .2 * (j % 3), rad = r * (1 - f) * 1.07 + .015;
        neon[(neonN + Math.floor(j / 3)) % 4].push([x + Math.sin(a) * rad * s, y + (cy - h / 2 + h * f) * s, z + Math.cos(a) * rad * s, size * s, NEON[neonN % NEON.length]]); neonN++; } });
  }
  const PINE_TIERS = [[.78, .85, .72], [.6, .75, 1.17], [.4, .66, 1.6]], MINI_TIERS = [[.3, .34, .31], [.23, .3, .5], [.15, .26, .68]];

  // 玻璃隔間牆頂（缺口＝門，牆本來就斷開，燈串不會橫過門口）
  for (const [x, y, w, h] of wallBoxes) {
    const hz = w >= h, len = (hz ? w : h) * U; if (len < .7) continue;
    const spans = Math.max(1, Math.round(len / 1.7));
    for (let i = 0; i < spans; i++) { const a = i / spans, b = (i + 1) / spans;
      if (hz) { const z = (y + h / 2) * U; strand((x + w * a) * U, 1.58, z, (x + w * b) * U, 1.58, z, .2, .34); }
      else { const xx = (x + w / 2) * U; strand(xx, 1.58, (y + h * a) * U, xx, 1.58, (y + h * b) * U, .2, .34); } }
  }

  // ---------- 室內聖誕樹區（有碰撞） ----------
  const trees = [], rugs = [], men = [], boxes = [[], [], [], []], zones = [];
  const giftAt = (x, y, z, s) => boxes[Math.floor(rnd() * 4)].push([x, y, z, s, (rnd() - .5) * 1.1]);
  for (const [list, ox] of [[SPOTS5, 0], [SPOTS4, FX4]]) for (const [px, pz, s, man] of list) {
    const x = (px + ox) * U, z = pz * U; trees.push([x, 0, z, s, rnd() * 6.28]); rugs.push([x, 0, z, s]);
    for (const [dx, dz, g] of [[-.72, .52, .95], [.62, .66, .8], [.12, .86, .6], man ? [-.9, -.2, .62] : [.9, .05, .72]]) giftAt(x + dx * s, .02, z + dz * s, g * s);
    if (man) men.push([x + .98 * s, 0, z + .12 * s, .82 * s, -.3]);
    const r = [x - .82 * s, z - .75 * s, x + (man ? 1.25 : .82) * s, z + .8 * s]; rects.push(r); zones.push(r);
    treeLights(x, 0, z, s, TIERS, 30, 1);
  }

  // ---------- 櫃頂、柱子上的小佈置（原本就有碰撞的家具上面，不佔走道、不擋電腦） ----------
  const minis = [], wreaths = [];
  const px2 = (x, z) => [x * U, z * U];
  for (const top of [355, 592, 828]) { const [x, z] = px2(399, top + 47); minis.push([x, 2.02, z, 1.05]); giftAt(x, 2.02, z - .95, .62); giftAt(x, 2.02, z + .95, .55); }
  for (const x of [738.5, 869.5]) { const [wx, wz] = px2(x, 639); giftAt(wx, .83, wz - .6, .8); giftAt(wx, .83, wz + .55, .65); }
  { const [x, z] = px2(769.5, 402); giftAt(x, 1.62, z - .6, .7); minis.push([x, 1.62, z + .5, .85]); }
  for (const [cx, w, top] of [[725.5, 33, 355], [725.5, 55, 828]]) {   // 白柱：南面掛花圈、柱身繞燈
    const x = (cx + w / 2) * U, z = (top + 94) * U, hw = w * U / 2 + .03;
    wreaths.push([x, 2.35, z + .1, 1]);
    for (let i = 0; i < 4; i++) { const y = 3.25 - i * .12; strand(x - hw, y - i * .5, z + .05, x + hw, y - i * .5 - .22, z + .05, .04, .24); }
  }
  for (const f of fridges) { giftAt(f.cx - .2, 1.92, f.cz - .08, .66); minis.push([f.cx + .28, 1.92, f.cz - .05, .6]); }

  // ---------- 露台：雪地、柵欄燈串、雪松、雪人、禮物（全部在走不到的地方） ----------
  const snowCanvas = document.createElement('canvas'); snowCanvas.width = snowCanvas.height = 128;
  { const g = snowCanvas.getContext('2d'); g.fillStyle = '#f6faff'; g.fillRect(0, 0, 128, 128);
    for (let i = 0; i < 70; i++) { const x = rnd() * 128, y = rnd() * 128, r = 3 + rnd() * 14, gr = g.createRadialGradient(x, y, 0, x, y, r); gr.addColorStop(0, i % 3 ? 'rgba(170,196,232,.34)' : 'rgba(255,255,255,.9)'); gr.addColorStop(1, 'rgba(255,255,255,0)'); g.fillStyle = gr; g.fillRect(x - r, y - r, r * 2, r * 2); }
    g.fillStyle = '#b4cdf2'; for (let i = 0; i < 60; i++) g.fillRect(Math.floor(rnd() * 127), Math.floor(rnd() * 127), 1, 1); }
  const snowTex = new THREE.CanvasTexture(snowCanvas); snowTex.wrapS = snowTex.wrapT = THREE.RepeatWrapping; snowTex.colorSpace = THREE.SRGBColorSpace; snowTex.repeat.set(1 / 5, 1 / 5);
  const snowMat = FLAT ? new THREE.MeshLambertMaterial({map:snowTex}) : new THREE.MeshStandardMaterial({map:snowTex, roughness:.92, metalness:0});
  const sideMat = new THREE.MeshLambertMaterial({color:0xb9cbe6});
  const LANE = 1.5;   // 麋鹿滑行道：樓層外緣往外幾單位（這一圈不放樹和雪人）
  const OUT = 7.5;   // 露台往樓層外延伸多遠
  const pines = [], mounds = [], posts = [], indoorMats = [];
  // [樓層外緣 x0,x1,z0,z1], [雪線（內緣）x0,x1,z0,z1]
  const FLOORS = [
    {f:[-3, 1201 * U + 3, -100 * U, 1560 * U + 3], in:[.35, 1201 * U - .35, -2.25, 1560 * U - .35]},
    {f:[(FX4 + floor4[0]) * U, (FX4 + floor4[1]) * U, floor4[2] * U, floor4[3] * U], in:[(FX4 + floor4[0]) * U + .85, (FX4 + floor4[1]) * U - .85, floor4[2] * U + .85, floor4[3] * U - .85]}
  ];
  for (const {f:[x0, x1, z0, z1], in:[a0, a1, b0, b1]} of FLOORS) {
    const O0 = x0 - OUT, O1 = x1 + OUT, P0 = z0 - OUT, P1 = z1 + OUT;
    // 雪地：外框矩形挖掉辦公室（內緣做成起伏的雪線）。Shape 的 y＝-z
    const shape = new THREE.Shape(); shape.moveTo(O0, -P0); shape.lineTo(O1, -P0); shape.lineTo(O1, -P1); shape.lineTo(O0, -P1); shape.closePath();
    const hole = new THREE.Path(); let first = true;
    for (const [sx, sz, ex, ez, nx, nz] of [[a0, b0, a1, b0, 0, 1], [a1, b0, a1, b1, -1, 0], [a1, b1, a0, b1, 0, -1], [a0, b1, a0, b0, 1, 0]]) {
      const n = Math.round(Math.hypot(ex - sx, ez - sz) / .8);
      for (let i = 0; i < n; i++) { const t = i / n, wob = (i ? (Math.sin(i * 1.7) * .5 + rnd() - .5) * .28 : 0), x = sx + (ex - sx) * t + nx * wob, z = sz + (ez - sz) * t + nz * wob; if (first) { hole.moveTo(x, -z); first = false; } else hole.lineTo(x, -z); }
    }
    hole.closePath(); shape.holes.push(hole);
    const ground = new THREE.Mesh(new THREE.ShapeGeometry(shape), snowMat); ground.rotation.x = -Math.PI / 2; ground.position.y = .014; ground.userData.noMask = true; ground.receiveShadow = !FLAT; add(ground); added.push(ground);
    for (const [w, d, x, z] of [[O1 - O0, .1, (O0 + O1) / 2, P0], [O1 - O0, .1, (O0 + O1) / 2, P1], [.1, P1 - P0, O0, (P0 + P1) / 2], [.1, P1 - P0, O1, (P0 + P1) / 2]]) { const m = new THREE.Mesh(new THREE.BoxGeometry(w, .6, d), sideMat); m.position.set(x, -.29, z); m.userData.noMask = true; add(m); }
    // 柵欄燈串：四邊一圈紅柱子
    const fx0 = a0 - .75, fx1 = a1 + .75, fz0 = b0 - .6, fz1 = b1 + .75;
    for (const [sx, sz, ex, ez] of [[fx0, fz0, fx1, fz0], [fx1, fz0, fx1, fz1], [fx1, fz1, fx0, fz1], [fx0, fz1, fx0, fz0]]) {
      const n = Math.round(Math.hypot(ex - sx, ez - sz) / 2.6);
      for (let i = 0; i < n; i++) { const t = i / n, u = (i + 1) / n, ax = sx + (ex - sx) * t, az = sz + (ez - sz) * t; posts.push([ax, 0, az, 1]); strand(ax, 1.0, az, sx + (ex - sx) * u, 1.0, sz + (ez - sz) * u, .28, .4); }
    }
    // 雪松、雪堆、雪人、禮物：沿四邊散布。南邊（靠鏡頭）放矮一點，才不會擋住室內
    const along = (side, d, out) => side === 0 ? [x0 + d, z0 - out] : side === 1 ? [x1 + out, z0 + d] : side === 2 ? [x0 + d, z1 + out] : [x0 - out, z0 + d];
    for (let side = 0; side < 4; side++) {
      const len = side % 2 ? z1 - z0 : x1 - x0, south = side === 2;
      for (let d = 1.5; d < len; d += 3.1 + rnd() * 1.6) { const [x, z] = along(side, d, LANE + (south ? 2 : 1.4) + rnd() * 2.6); pines.push([x, 0, z, south ? .6 + rnd() * .25 : .95 + rnd() * .75, rnd() * 6.28]); }
      for (let d = .8; d < len; d += 1.7 + rnd() * 1.4) { const [x, z] = along(side, d, rnd() < .35 ? rnd() * .5 : LANE + 1 + rnd() * 3.2); mounds.push([x, -.02, z, .5 + rnd() * .9, rnd() * 6.28]); }
      for (let d = 5 + rnd() * 3; d < len - 2; d += 10 + rnd() * 4) {
        const [x, z] = along(side, d, LANE + 1.35);
        men.push([x, 0, z, south ? .8 : 1.05, (rnd() - .5) * .7]);
        giftAt(x + 1.0, .02, z + .25, .9); giftAt(x + 1.5, .02, z - .15, .65);
      }
    }
  }
  // ---------- 室內積雪：整層一片有高低起伏的雪地（格點網格，高度寫在頂點上）。純外觀，踩上去不影響走路 ----------
  // 高度（世界單位）：家具底下、牆邊堆得高（≤ .34）；走得到的地方薄（≤ .11）；走道上零星清到露出地板；椅子與寵物窩旁壓平，不擋東西
  const CELL = small ? 10 : 7;   // 格點間距（版面 px）
  const noise = (x, y) => { const h = (i, j) => { let n = Math.imul(i, 374761393) ^ Math.imul(j, 668265263); n = Math.imul(n ^ (n >>> 13), 1274126177); return ((n ^ (n >>> 16)) >>> 0) / 4294967296; };
    const i = Math.floor(x), j = Math.floor(y), u = x - i, v = y - j, a = u * u * (3 - 2 * u), b = v * v * (3 - 2 * v);
    return (h(i, j) * (1 - a) + h(i + 1, j) * a) * (1 - b) + (h(i, j + 1) * (1 - a) + h(i + 1, j + 1) * a) * b; };
  const clamp = v => v < 0 ? 0 : v > 1 ? 1 : v, ease = v => { v = clamp(v); return v * v * (3 - 2 * v); };
  const piles = [], fields = [];
  FLOORS.forEach(({f:[x0, x1, z0, z1]}, fi) => {
    const ox = fi ? FX4 : 0, step = CELL * U, W = Math.ceil((x1 - x0) / step) + 1, D = Math.ceil((z1 - z0) / step) + 1, N = W * D, dx = (x1 - x0) / (W - 1), dz = (z1 - z0) / (D - 1);
    const cut = new Float32Array(N).fill(99), cap = new Float32Array(N).fill(1), solid = new Float32Array(N), height = new Float32Array(N);
    const near = (px, py, R, fn) => { const wx = (px + ox) * U, wz = py * U, r = R * U;   // 走訪某點（版面 px）周圍的格點，傳回距離（px）
      for (let j = Math.max(0, Math.floor((wz - r - z0) / dz)); j <= Math.min(D - 1, Math.ceil((wz + r - z0) / dz)); j++) for (let i = Math.max(0, Math.floor((wx - r - x0) / dx)); i <= Math.min(W - 1, Math.ceil((wx + r - x0) / dx)); i++) fn(j * W + i, Math.hypot(x0 + i * dx - wx, z0 + j * dz - wz) / U); };
    const rectEach = ([a, b, c, d], pad, fn) => { for (let j = 0; j < D; j++) { const y = (z0 + j * dz) / U; if (y < b - pad || y > d + pad) continue; for (let i = 0; i < W; i++) { const x = (x0 + i * dx) / U - ox; if (x < a - pad || x > c + pad) continue; fn(j * W + i, Math.hypot(Math.max(a - x, 0, x - c), Math.max(b - y, 0, y - d))); } } };
    const stamps = [];
    for (const p of fi ? PATHS4 : PATHS5) {
      if (p.r) { if (p.full) rectEach(p.r, 14, (k, d) => { cut[k] = Math.min(cut[k], d - 4); }); else rectEach(p.r, 20, (k, d) => { cap[k] = Math.min(cap[k], .03 + .07 * ease(d / 20)); }); continue; }
      const [ax, ay, bx, by] = p, len = Math.hypot(bx - ax, by - ay), n = Math.max(1, Math.round(len / 25)), px = -(by - ay) / (len || 1), py = (bx - ax) / (len || 1);
      for (let i = 0; i <= n; i++) {
        const x = ax + (bx - ax) * i / n, y = ay + (by - ay) * i / n;
        near(x, y, 56, (k, d) => { cap[k] = Math.min(cap[k], .042 + .07 * ease((d - 28) / 28)); });   // 走道整條被踩薄
        if (rnd() < .24) continue;   // 留一些沒清到的段落
        const off = (rnd() - .5) * 30; stamps.push([x + px * off, y + py * off, 10 + rnd() * 17]);
        if (rnd() < .3) { const o2 = off + (rnd() < .5 ? -1 : 1) * (20 + rnd() * 14); stamps.push([x + px * o2, y + py * o2, 6 + rnd() * 8]); }
      }
    }
    for (const [x, y, r] of stamps) near(x, y, r + 34, (k, d) => { cut[k] = Math.min(cut[k], d - r); });
    for (const st of chairSeats) { const x = st.x / U - ox, y = st.z / U; if ((x + ox) * U > x0 && (x + ox) * U < x1) near(x, y, 58, (k, d) => { cap[k] = Math.min(cap[k], .018 + .1 * ease((d - 28) / 30)); }); }
    for (const [a, b, c, d] of zones) if (a >= x0 && c <= x1) rectEach([a / U - ox, b / U, c / U - ox, d / U], 24, (k, e) => { cap[k] = Math.min(cap[k], .03 + .09 * ease(e / 24)); });
    for (let j = 0; j < D; j++) for (let i = 0; i < W; i++) solid[j * W + i] = blocked(x0 + i * dx, z0 + j * dz) ? 1 : 0;
    const tmp = new Float32Array(N);   // 把「走不到」的範圍抹開，雪堆才是斜坡、不是直角台階
    for (let pass = 0; pass < 3; pass++) { for (const [src, dst, o, lim] of [[solid, tmp, 1, W], [tmp, solid, W, D]]) for (let k = 0; k < N; k++) { const at = o === 1 ? k % W : (k / W) | 0; dst[k] = (src[k] + src[at > 1 ? k - 2 * o : k] + src[at > 0 ? k - o : k] + src[at < lim - 1 ? k + o : k] + src[at < lim - 2 ? k + 2 * o : k]) / 5; } }
    for (let j = 0; j < D; j++) for (let i = 0; i < W; i++) {
      const k = j * W + i, X = x0 + i * dx, Z = z0 + j * dz;
      const big = noise(X * .55, Z * .55), mid = noise(X * 1.5 + 31, Z * 1.5 + 7), fine = noise(X * 4 + 3, Z * 4 + 19), lump = clamp(big * .62 + mid * .38);
      const open = .028 + .105 * ease((lump - .22) / .58) + fine * .012, piled = .07 + .3 * ease((lump - .15) / .65) + fine * .016;
      let h = open + (piled - open) * ease((solid[k] - .35) / .6);
      h = Math.min(h, cap[k] >= 1 ? 1 : cap[k] + fine * .008 + solid[k] * solid[k] * .1);
      const d = cut[k] + (noise(X * 2.6 + 11, Z * 2.6 + 5) - .5) * 16;   // 清出範圍的邊緣加雜訊
      if (d > 0 && d < 26) h += .034 * Math.sin(d / 26 * Math.PI) * (.4 + mid) * Math.min(1, cap[k] / .04);   // 清出來的雪堆在旁邊
      h = -.02 + (h + .02) * ease((d + 3) / 13);
      const rim = Math.min(i, W - 1 - i, j, D - 1 - j) * CELL; if (rim < 30) h = .018 + (h - .018) * rim / 30;   // 樓層邊緣接到露台雪地
      height[k] = h;
    }
    const pos = new Float32Array(N * 3), nor = new Float32Array(N * 3), col = new Float32Array(N * 3), uv = new Float32Array(N * 2), index = new Uint32Array((W - 1) * (D - 1) * 6), v = new THREE.Vector3();
    const low = new THREE.Color(0xb0c6ec), high = new THREE.Color(0xffffff), c = new THREE.Color();
    const paintAt = k => {   // 法線把起伏放大一點、凹處染藍，俯視才看得出高低
      const i = k % W, j = (k / W) | 0, l = height[i > 0 ? k - 1 : k], r = height[i < W - 1 ? k + 1 : k], u = height[j > 0 ? k - W : k], dn = height[j < D - 1 ? k + W : k], h = height[k];
      v.set(-(r - l) * 2.4 / (2 * dx), 1, -(dn - u) * 2.4 / (2 * dz)).normalize(); v.toArray(nor, k * 3);
      const wide = (height[i > 2 ? k - 3 : k] + height[i < W - 3 ? k + 3 : k] + height[j > 2 ? k - 3 * W : k] + height[j < D - 3 ? k + 3 * W : k]) / 4;
      c.copy(low).lerp(high, clamp(.22 + ease(h / .085) * .62 + (h - wide) * 7 + ease((h - .09) / .2) * .2)); c.toArray(col, k * 3);
      pos[k * 3 + 1] = h;
    };
    for (let k = 0; k < N; k++) { const i = k % W, j = (k / W) | 0; pos[k * 3] = x0 + i * dx; pos[k * 3 + 2] = z0 + j * dz; uv[k * 2] = pos[k * 3]; uv[k * 2 + 1] = -pos[k * 3 + 2]; paintAt(k); }
    let n = 0; for (let j = 0; j < D - 1; j++) for (let i = 0; i < W - 1; i++) { const a = j * W + i, b = a + 1, d = a + W, e = d + 1; if (Math.max(height[a], height[b], height[d], height[e]) < -.005) continue; index.set([a, d, b, b, d, e], n); n += 6; }
    const geo = new THREE.BufferGeometry(); geo.setAttribute('position', new THREE.BufferAttribute(pos, 3)); geo.setAttribute('normal', new THREE.BufferAttribute(nor, 3)); geo.setAttribute('color', new THREE.BufferAttribute(col, 3)); geo.setAttribute('uv', new THREE.BufferAttribute(uv, 2)); geo.setIndex(new THREE.BufferAttribute(index.slice(0, n), 1)); geo.computeBoundingSphere();
    const o = {map:snowTex, vertexColors:true}, mat = FLAT ? new THREE.MeshLambertMaterial(o) : new THREE.MeshStandardMaterial({...o, roughness:.93, metalness:0});
    indoorMats.push(mat);
    const m = new THREE.Mesh(geo, mat); m.userData.noMask = true; m.receiveShadow = !FLAT; add(m); added.push(m);
    fields.push({x0, x1, z0, z1, dx, dz, W, D, height, geo, paintAt});
    // 散在上面的雪團：牆邊、家具底下放大顆的，空地放小顆的；清出來的地方和椅子旁不放
    for (let t = 0, got = 0; t < 4000 && got < 150; t++) { const i = 2 + Math.floor(rnd() * (W - 4)), j = 2 + Math.floor(rnd() * (D - 4)), k = j * W + i; if (cut[k] < 24 || cap[k] < .1 || height[k] < .05) continue;
      got++; piles.push([x0 + i * dx, height[k] - .05, z0 + j * dz, solid[k] > .8 ? .35 + rnd() * .45 : .2 + rnd() * .2, rnd() * 6.28]); }
  });
  scatter(mound, piles, false);
  function flatten(x, z, r){   // 把某個點周圍的雪壓平（寵物的窩和碗是場景蓋完才擺的）
    for (const F of fields) { if (x < F.x0 || x > F.x1 || z < F.z0 || z > F.z1) continue; const touched = [];
      for (let j = Math.max(0, Math.floor((z - r - F.z0) / F.dz)); j <= Math.min(F.D - 1, Math.ceil((z + r - F.z0) / F.dz)); j++) for (let i = Math.max(0, Math.floor((x - r - F.x0) / F.dx)); i <= Math.min(F.W - 1, Math.ceil((x + r - F.x0) / F.dx)); i++) {
        const k = j * F.W + i, d = Math.hypot(F.x0 + i * F.dx - x, F.z0 + j * F.dz - z); if (d > r) continue; F.height[k] = Math.min(F.height[k], .012 + .09 * ease((d / r - .6) / .4)); touched.push(k); }
      for (const k of touched) F.paintAt(k); for (const a of ['position', 'normal', 'color']) F.geo.attributes[a].needsUpdate = true; }
  }

  scatter(rug, rugs, false); scatter(bigTree, trees); scatter(snowman, men); gifts.forEach((g, i) => scatter(g, boxes[i]));
  for (const [x, y, z, sc] of pines) treeLights(x, y, z, sc, PINE_TIERS, 11, .85);
  for (const [x, y, z, sc] of minis) treeLights(x, y, z, sc, MINI_TIERS, 20, .55);
  scatter(miniTree, minis); scatter(wreath, wreaths); scatter(pine, pines); scatter(mound, mounds, false); scatter(post, posts);

  // ---------- 鈴鐺、聖誕襪、拐杖糖 ----------
  const bell = (() => { const k = kit(); k.cyl(.035, .035, .1, C.darkRed, 0, -.03, 0, false); k.cyl(.07, .13, .17, C.gold, 0, -.19, 0); k.ball(.075, C.gold, 0, -.11, 0); k.cyl(.17, .17, .035, C.gold, 0, -.29, 0); k.ball(.05, C.darkRed, 0, -.35, 0);
    for (const d of [-1, 1]) k.cone(.075, .18, C.red, d * .1, .02, .02, true, 5, 0, d * Math.PI / 2); k.ball(.05, C.red, 0, .02, .03, false); return k.done(); })();
  const stocking = (paper, trim) => { const k = kit(); k.box(.2, .32, .1, paper, 0, -.24, 0); k.box(.3, .15, .1, paper, .07, -.44, 0); k.ball(.08, trim, .2, -.46, 0, false); k.box(.07, .08, .115, trim, -.07, -.47, 0, false);
    k.box(.26, .11, .14, C.white, 0, -.05, 0); k.box(.2, .05, .115, trim, 0, -.19, 0, false); k.box(.025, .09, .025, C.gold, -.08, .03, 0, false); return k.done(); };
  const stockings = [stocking(C.red, C.green), stocking(C.green, C.red), stocking(C.red, C.gold)];
  const cane = (() => { const path = new THREE.CatmullRomCurve3([[0, 0, 0], [0, .35, 0], [0, .68, 0], [.07, .83, 0], [.19, .84, 0], [.27, .74, 0], [.27, .63, 0]].map(p => new THREE.Vector3(...p)));
    const make = r => { const g = new THREE.TubeGeometry(path, 36, r, 8, false).toNonIndexed(); g.deleteAttribute('uv'); return g; };
    const body = make(.055), p = body.attributes.position, col = new Float32Array(p.count * 3), a = new THREE.Color(C.red), b = new THREE.Color(C.white);
    for (let i = 0; i < p.count; i++) (Math.floor(Math.floor(i / 48) / 3) % 2 ? b : a).toArray(col, i * 3);   // 每段 8 格×6 頂點＝48，三段換一次顏色
    body.setAttribute('color', new THREE.BufferAttribute(col, 3)); return {body, line:make(.055 + EDGE)}; })();
  const bells = [], hung = [[], [], []], canes = [];
  const hang = (x, y, z, s) => hung[Math.floor(rnd() * 3)].push([x, y, z, s, (rnd() - .5) * .25]);
  doors.forEach(o => { for (const [al, k] of [[o.a - 1, -1], [o.b + 1, 1]]) {   // 門柱上掛鈴鐺、柱腳靠一支拐杖糖
    const x = (o.horiz ? al : o.c) * U, z = (o.horiz ? o.c : al) * U;
    bells.push([x, 1.76, z + .2, 1]);
    canes.push([o.horiz ? x + k * .24 : x - .2, 0, o.horiz ? z + .2 : z + k * .22, .95, o.horiz ? (k > 0 ? Math.PI : 0) : 0]); } });
  for (const [x, y, w, h] of wallBoxes) {   // 朝鏡頭（南面）的長玻璃牆掛一排聖誕襪
    if (w < h || w * U < 3) continue; const n = Math.floor(w * U / 2.2); for (let i = 0; i < n; i++) hang((x + w * (i + .5) / n) * U, 1.2, (y + h) * U + .08, .85); }
  for (const [cx, w, top] of [[725.5, 33, 355], [725.5, 55, 828]]) { const z = (top + 94) * U + .1; for (const d of [-.28, .28]) hang((cx + w / 2) * U + d, 1.35, z, 1); bells.push([(cx + w / 2) * U, 1.82, z + .06, 1.15]); }
  for (const [x0, y, w] of [[305, 1301, 125], [862 + FX4, 87, 140]]) for (let i = 0; i < 4; i++) hang((x0 + w * (i + .5) / 4) * U, .84, y * U + .09, .9);   // 兩層樓的茶水檯
  for (const x of [201, F_ELEV + FX4]) for (const d of [-1.45, 1.45]) { const z = (x === 201 ? 196 : 252) * U; canes.push([x * U + d, 0, z, 1.6, d > 0 ? Math.PI : 0]); }
  for (const [x, , z, sc] of trees) { canes.push([x - .68 * sc, 0, z + .42 * sc, .9, 0], [x + .5 * sc, 0, z + .72 * sc, .8, Math.PI]); bells.push([x - .3 * sc, 1.25 * sc, z + .84 * sc, .75], [x + .32 * sc, 1.65 * sc, z + .6 * sc, .65]); }
  posts.forEach(([x, , z], i) => { if (i % 2 === 0) bells.push([x, .84, z + .12, .85]); else canes.push([x + .5, 0, z, 1.15, i % 4 === 1 ? 0 : Math.PI]); });
  stockings.forEach((k, i) => scatter(k, hung[i])); scatter(cane, canes);
  // 鈴鐺會輕輕擺動：同一個 InstancedMesh，每幀更新角度
  const swing = [];
  for (const [geo, matr, isLine] of [[bell.body, solidMat, false], [bell.line, outlineMat, true]]) { const m = new THREE.InstancedMesh(geo, matr, bells.length); if (isLine) m.layers.set(HULL_LAYER); m.frustumCulled = false; add(m); swing.push(m); added.push(m); }
  const swingBells = t => { bells.forEach(([x, y, z, sc], i) => { dummy.position.set(x, y, z); dummy.rotation.set(0, 0, Math.sin(t * 2.3 + i * 1.9) * .26); dummy.scale.setScalar(sc); dummy.updateMatrix(); for (const m of swing) m.setMatrixAt(i, dummy.matrix); }); for (const m of swing) m.instanceMatrix.needsUpdate = true; };
  swingBells(0);

  // ---------- 薑餅人（沿走道散步）與麋鹿（滑行）：位置只看伺服器時間，每個人看到一樣；純外觀、沒有碰撞 ----------
  const piece = (parent, k, x = 0, y = 0, z = 0) => { const g = new THREE.Group(); g.position.set(x, y, z); const m = new THREE.Mesh(k.body, solidMat); m.castShadow = !FLAT; g.add(m); if (k.line) { const l = new THREE.Mesh(k.line, outlineMat); l.layers.set(HULL_LAYER); g.add(l); } parent.add(g); return g; };
  const GB = 0xc47a36, ginger = (() => {   // 薑餅人是一片扁餅乾：正面看是人形、側面看很薄；糖霜與五官前後兩面都有
    const body = kit(), T = .1;
    body.cookie(.27, 0, T, GB, 0, .86, 0); body.cookie(.18, .22, T - .008, GB, 0, .46, 0);
    for (const f of [-1, 1]) { const z = f * (T / 2 + .006);
      for (const x of [-.095, .095]) body.cookie(.034, .022, .012, C.coal, x, .91, z, false);
      for (const x of [-.08, -.027, .027, .08]) body.cookie(.019, 0, .012, C.white, x, .785 - (Math.abs(x) < .05 ? .028 : 0), z, false);
      for (const [y, c] of [[.54, C.red], [.41, C.green]]) body.cookie(.042, 0, .014, c, 0, y, z, false);
      for (const y of [.625, .3]) body.box(.27, .03, .012, C.white, 0, y, z, false); }
    const limb = (len, r) => { const k = kit(); k.cookie(r, len, T - .02, GB, 0, -len / 2, 0); for (const f of [-1, 1]) k.box(r * 1.75, .032, .012, C.white, 0, -len * .8, f * (T / 2 - .004), false); return k.done(); };
    return {body:body.done(), arm:limb(.24, .072), leg:limb(.2, .088)}; })();
  const DEER = 0x9a6336, deer = (() => {
    const body = kit(); body.ball(.38, DEER, 0, .68, -.05, true, .85); body.ball(.3, DEER, 0, .68, -.34, true, .85); body.ball(.2, C.cream, 0, .6, .2, false); body.cyl(.13, .17, .38, DEER, 0, .95, .26); body.ball(.1, C.cream, 0, .76, -.62);
    body.ball(.27, DEER, 0, 1.2, .38); body.ball(.16, 0xd2a679, 0, 1.12, .6); body.ball(.075, 0xff2a2a, 0, 1.16, .76);
    for (const d of [-1, 1]) { body.ball(.042, C.coal, d * .13, 1.28, .61, false); body.cone(.075, .2, DEER, d * .27, 1.38, .3, true, 6, 0, -d * 1.1);
      body.box(.065, .46, .065, C.cream, d * .17, 1.62, .3); body.box(.26, .06, .06, C.cream, d * .31, 1.68, .3); body.box(.06, .22, .06, C.cream, d * .43, 1.8, .3); body.box(.06, .17, .06, C.cream, d * .26, 1.88, .3); }
    body.cyl(.2, .2, .08, C.red, 0, .98, .27); body.ball(.07, C.gold, 0, .9, .47);
    const leg = kit(); leg.cyl(.085, .06, .46, DEER, 0, -.23, 0); leg.cyl(.07, .075, .09, C.coal, 0, -.49, 0);
    return {body:body.done(), leg:leg.done()}; })();
  const walkers = [];
  const loopOf = (pts, ox) => { const P = pts.map(([x, y]) => [(x + ox) * U, y * U]), L = P.map((p, i) => { const q = P[(i + 1) % P.length]; return Math.hypot(q[0] - p[0], q[1] - p[1]); }); return {P, L, len:L.reduce((a, b) => a + b, 0)}; };
  function walker(g, route, speed, offset, pose, tag){ g.userData.noShift = true; g.traverse(o => { o.userData.noShift = o.userData.noMask = true; }); scene.add(g); walkers.push({g, route, speed, offset, pose, tag, ox:0, oz:0}); }
  for (const [list, ox] of [[GINGER5, 0], [GINGER4, FX4]]) list.forEach((pts, i) => {
    const g = new THREE.Group(), hop = new THREE.Group(); g.add(hop); piece(hop, ginger.body);
    const arms = [-1, 1].map(d => piece(hop, ginger.arm, d * .16, .6, 0)), legs = [-1, 1].map(d => piece(hop, ginger.leg, d * .12, .3, 0));
    walker(g, loopOf(pts, ox), .85 + (i % 3) * .12, i * 7.3 + (ox ? 3 : 0), t => { const s = Math.sin(t * 7.5 + i); legs[0].rotation.x = s * .55; legs[1].rotation.x = -s * .55; legs[0].rotation.z = -.16; legs[1].rotation.z = .16; arms.forEach((a, k) => { const d = k ? 1 : -1; a.rotation.set(0, 0, d * (1.2 + s * d * .3)); }); hop.position.y = Math.abs(Math.cos(t * 7.5 + i)) * .07; hop.rotation.z = s * .06; }, 'ginger');
  });
  function reindeer(route, speed, offset, i, scale, tag){
    const g = new THREE.Group(), slide = new THREE.Group(); slide.scale.setScalar(scale); g.add(slide); piece(slide, deer.body);
    const legs = [[-.2, .22], [.2, .22], [-.2, -.34], [.2, -.34]].map(([x, z]) => piece(slide, deer.leg, x, .55, z));
    const spray = [0, 1, 2, 3, 4].map(n => { const m = new THREE.Mesh(mound.body, solidMat); slide.add(m); return m; });
    walker(g, route, speed, offset, t => { const k = Math.sin(t * 2.6 + i); legs.forEach((l, n) => { const front = n < 2; l.rotation.set((front ? -.85 : .85) + k * .22 * (n % 2 ? 1 : -1), 0, (n % 2 ? 1 : -1) * .12); });
      slide.position.y = .02 + Math.abs(Math.sin(t * 1.3 + i)) * .07; slide.rotation.set(Math.sin(t * 2.6 + i) * .05, 0, Math.sin(t * 1.3 + i) * .09);
      spray.forEach((m, n) => { const f = (t * 1.6 + n / 5) % 1; m.position.set(Math.sin(n * 2.4) * (.15 + f * .45), .04 + Math.sin(f * Math.PI) * .3, -.65 - f * 1.1); m.scale.setScalar(.22 * (1 - f) + .02); }); }, tag);
  }
  FLOORS.forEach(({f:[x0, x1, z0, z1]}, fi) => {
    const a = x0 - LANE, b = x1 + LANE, c = z0 - LANE, d = z1 + LANE, ring = {P:[[a, c], [b, c], [b, d], [a, d]], L:[b - a, d - c, b - a, d - c], len:2 * (b - a + d - c)};
    for (let i = 0; i < 3; i++) reindeer(ring, 4.2, i * ring.len / 3, i + fi * 3, 1.15, 'deer-out');
    reindeer(loopOf(DEER_IN[fi], fi ? FX4 : 0), 2.6, 0, fi + 7, .85, 'deer-in');
  });
  const at = new THREE.Vector3();
  function moveWalkers(ms){
    const t = ms / 1000, folk = people();
    for (const w of walkers) {
      const {P, L, len} = w.route; let d = (t * w.speed + w.offset) % len, i = 0; while (d > L[i]) { d -= L[i]; i++; }
      const p = P[i], q = P[(i + 1) % P.length], f = d / L[i], dx = (q[0] - p[0]) / L[i], dz = (q[1] - p[1]) / L[i];
      at.set(p[0] + (q[0] - p[0]) * f, 0, p[1] + (q[1] - p[1]) * f);
      let sx = 0, sz = 0;   // 靠近人物時往旁邊讓一下（只影響自己畫面）
      for (const c of folk) { if (!c.holder.visible) continue; const ex = at.x - c.holder.position.x, ez = at.z - c.holder.position.z, near = 1.3 - Math.hypot(ex, ez); if (near > 0) { const side = (ex * -dz + ez * dx) >= 0 ? 1 : -1; sx += -dz * side * near * .8; sz += dx * side * near * .8; } }
      w.ox += (Math.max(-.8, Math.min(.8, sx)) - w.ox) * .08; w.oz += (Math.max(-.8, Math.min(.8, sz)) - w.oz) * .08;
      w.g.position.set(at.x + w.ox, 0, at.z + w.oz);
      const turn = Math.atan2(dx, dz) - w.g.rotation.y; w.g.rotation.y += Math.atan2(Math.sin(turn), Math.cos(turn)) * .14;
      w.pose(t);
    }
  }
  moveWalkers(now());

  // ---------- 燈泡與電線 ----------
  const bulbGeo = new THREE.IcosahedronGeometry(.07, 0), glow = [];
  bulbs.forEach(list => {
    const mat = new THREE.MeshBasicMaterial({color:0xffffff, toneMapped:false}), m = new THREE.InstancedMesh(bulbGeo, mat, list.length), col = new THREE.Color();
    list.forEach(([x, y, z, s, c], i) => { dummy.position.set(x, y, z); dummy.rotation.set(0, 0, 0); dummy.scale.set(s, s * 1.25, s); dummy.updateMatrix(); m.setMatrixAt(i, dummy.matrix); m.setColorAt(i, col.set(c)); });
    m.userData.noMask = true; m.computeBoundingSphere(); add(m); added.push(m); glow.push(mat);
  });
  const halo = (() => { const c = document.createElement('canvas'); c.width = c.height = 64; const g = c.getContext('2d'), gr = g.createRadialGradient(32, 32, 0, 32, 32, 32);
    gr.addColorStop(0, 'rgba(255,255,255,1)'); gr.addColorStop(.3, 'rgba(255,255,255,.65)'); gr.addColorStop(1, 'rgba(255,255,255,0)'); g.fillStyle = gr; g.fillRect(0, 0, 64, 64); return new THREE.CanvasTexture(c); })();
  const neonGlow = neon.map(list => {
    const mat = new THREE.MeshBasicMaterial({color:0xffffff, toneMapped:false}), m = new THREE.InstancedMesh(bulbGeo, mat, list.length), col = new THREE.Color(), pos = [], cols = [];
    list.forEach(([x, y, z, s, c], i) => { dummy.position.set(x, y, z); dummy.rotation.set(0, 0, 0); dummy.scale.setScalar(s); dummy.updateMatrix(); m.setMatrixAt(i, dummy.matrix); m.setColorAt(i, col.set(c)); pos.push(x, y, z); cols.push(col.r, col.g, col.b); });
    m.userData.noMask = true; m.computeBoundingSphere(); add(m); added.push(m);
    const geo = new THREE.BufferGeometry(); geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); geo.setAttribute('color', new THREE.Float32BufferAttribute(cols, 3));
    const glowMat = new THREE.PointsMaterial({size:.64, map:halo, vertexColors:true, transparent:true, opacity:.6, depthWrite:false, toneMapped:false});
    add(new THREE.Points(geo, glowMat)).userData.noMask = true;
    return {mat, glowMat};
  });
  const neonSet = (i, k) => { neonGlow[i].mat.color.setScalar(.16 + 2.2 * k); neonGlow[i].glowMat.opacity = .9 * k; };   // k：0 暗、1 全亮

  const wireGeo = new THREE.BufferGeometry(); wireGeo.setAttribute('position', new THREE.Float32BufferAttribute(wire, 3));
  add(new THREE.LineSegments(wireGeo, new THREE.LineBasicMaterial({color:0x1f4a30}))).userData.noMask = true;

  // ---------- 飄雪：一批 Points，位置全在著色器裡算（CPU 每幀只更新兩個數值）；雪花盒跟著畫面中心循環 ----------
  const N = small ? 260 : 620, seeds = new Float32Array(N * 4);
  for (let i = 0; i < N * 4; i++) seeds[i] = Math.random();
  const flakeGeo = new THREE.BufferGeometry(); flakeGeo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(N * 3), 3)); flakeGeo.setAttribute('seed', new THREE.BufferAttribute(seeds, 4));
  const flakeU = {time:{value:0}, center:{value:new THREE.Vector3()}, scale:{value:1000}, edge:{value:new THREE.Color(0x6f9fe0)}};
  const flakes = new THREE.Points(flakeGeo, new THREE.ShaderMaterial({uniforms:flakeU, transparent:true, depthWrite:false,
    vertexShader:`attribute vec4 seed; uniform float time; uniform vec3 center; uniform float scale; varying float vA;
      void main(){
        const vec3 box = vec3(36.0, 7.5, 30.0);
        vec3 p = seed.xyz * box;
        p.y -= time * (.5 + seed.w * .55);
        p.x += sin(time * (.35 + seed.w * .4) + seed.z * 40.0) * .7 + time * .16;
        p.z += cos(time * .3 + seed.x * 40.0) * .35;
        vec3 lo = vec3(center.x - box.x * .5, 0.0, center.z - 19.0);
        p = mod(p - lo, box) + lo;
        vec4 mv = viewMatrix * vec4(p, 1.0);
        vA = smoothstep(0.0, .5, p.y) * (1.0 - smoothstep(6.2, 7.5, p.y)) * smoothstep(4.0, 8.0, -mv.z);
        gl_Position = projectionMatrix * mv;
        gl_PointSize = min((.07 + seed.w * .09) * scale / -mv.z, scale * .014);
      }`,
    fragmentShader:`uniform vec3 edge; varying float vA;
      void main(){
        float r = length(gl_PointCoord - .5) * 2.0;
        if (r > 1.0) discard;
        gl_FragColor = vec4(mix(vec3(1.0), edge, smoothstep(.35, 1.0, r)), vA * .95 * (1.0 - smoothstep(.55, 1.0, r)));
        #include <colorspace_fragment>
      }`}));
  flakes.frustumCulled = false; flakes.visible = !still; add(flakes).userData.noMask = true;

  const theme = isDark => { snowMat.color.set(isDark ? 0x8f9ee0 : 0xffffff); for (const m of indoorMats) m.color.set(isDark ? 0x7d88cc : 0xf4f7fc); sideMat.color.set(isDark ? 0x56589a : 0xb9cbe6); flakeU.edge.value.set(isDark ? 0xa9c8ff : 0x6f9fe0); };
  themeHooks.push(theme); theme(dark);

  const size = new THREE.Vector2();
  function update(ms, center, renderer){
    if (still) { for (const m of glow) m.color.setScalar(1.35); neonGlow.forEach((n, i) => neonSet(i, .8)); return; }
    swingBells(ms / 1000); moveWalkers(now());
    // 霓虹燈：每 6 秒換一種閃法（交錯對閃 → 跑馬追逐 → 全體呼吸）；每顆每秒最多閃 2 次，不做刺眼的高頻閃爍
    const t = ms / 1000, mode = Math.floor(t / 6) % 3, beat = Math.floor(t * 3.2);
    for (let i = 0; i < 4; i++) neonSet(i, mode === 0 ? ((Math.floor(t * 2.4) + i) % 2 ? 1 : 0) : mode === 1 ? ((beat + i) % 4 < 2 ? 1 : .05) : .5 + .5 * Math.sin(t * 5 + i * .8));
    flakeU.time.value = (ms / 1000) % 3600; flakeU.center.value.copy(center); flakeU.scale.value = renderer.getDrawingBufferSize(size).y;
    glow.forEach((m, i) => m.color.setScalar(1.05 + .75 * Math.pow(Math.max(0, Math.sin(ms / 520 + i * Math.PI * 2 / 3)), 2)));
  }
  return {update, flatten, walkers, routes:{ginger:[...GINGER5.map(r => r), ...GINGER4.map(r => r.map(([x, y]) => [x + FX4, y]))], deer:[DEER_IN[0], DEER_IN[1].map(([x, y]) => [x + FX4, y])]}, zones, flakes, counts:{neon:neonN, piles:piles.length, flakes:N, bulbs:bulbs.reduce((s, b) => s + b.length, 0), meshes:added.length}};
}

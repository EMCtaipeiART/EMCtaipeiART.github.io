// 寵物聖誕裝（四隻各一套）。模型載入完成後呼叫 dressPet()：沿著模型實際表面量出脖子、身體、頭頂的位置，再把配件掛到骨頭上，跟著動作走。
//   cat  五樓三花貓：聖誕老貓（聖誕帽＋白毛邊紅披風）
//   cat2 四樓虎斑貓：小精靈（綠尖帽＋紅帽簷＋紅綠三角領＋鈴鐺）
//   dog1 四樓臘腸狗：麋鹿（鹿角＋紅鼻子＋紅綠條紋毛衣＋鈴鐺項圈）
//   dog2 五樓薩摩耶：暖冬雪人（紅白條紋毛帽＋毛球＋條紋圍巾）
import * as THREE from 'three';

const C = {red:0xd8383f, darkRed:0xa8242e, green:0x1f8a45, lime:0x35b862, gold:0xffc733, white:0xfbfdff, brown:0x8a5a2c, cream:0xf2dcb4, coal:0x232830, blue:0x3f7fd8};

export function dressPet(id, group, HULL_LAYER){
  let skin = null; group.traverse(o => { if (o.isSkinnedMesh && !skin && !o.layers.isEnabled(HULL_LAYER)) skin = o; });
  if (!skin) return;
  const pos = skin.geometry.attributes.position, si = skin.geometry.attributes.skinIndex, sw = skin.geometry.attributes.skinWeight;
  const BONE = {torso:1, head:2};
  const main = i => { let b = 0, w = -1; for (let k = 0; k < 4; k++) if (sw.getComponent(i, k) > w) { w = sw.getComponent(i, k); b = si.getComponent(i, k); } return b; };
  const verts = []; for (let i = 0; i < pos.count; i++) verts.push({p:new THREE.Vector3().fromBufferAttribute(pos, i), b:main(i)});
  const bone = name => group.getObjectByName(name);
  const toBone = name => { const sk = skin.skeleton; return sk.boneInverses[sk.bones.indexOf(bone(name))].clone().multiply(skin.bindMatrix); };   // 模型座標 → 骨頭座標（照身體網格綁定時的骨架，衣服和身體才對得齊）

  // 掛一個零件：幾何用模型座標寫，這裡換算成骨頭座標；顏色烤進頂點（和寵物一樣不受場景燈光），外框是沿法線外擴的背面
  const light = new THREE.Vector3(-.35, .75, .55).normalize();
  const ink = new THREE.MeshBasicMaterial({color:C.coal, side:THREE.BackSide}), flat = new THREE.MeshBasicMaterial({vertexColors:true, side:THREE.DoubleSide});
  function put(name, geo, color, edge = .028){
    if (!geo.attributes.normal) geo.computeVertexNormals();
    const n = geo.attributes.normal, p = geo.attributes.position, col = new Float32Array(p.count * 3), c = new THREE.Color(), v = new THREE.Vector3(), at = new THREE.Vector3();
    for (let i = 0; i < p.count; i++) { at.fromBufferAttribute(p, i); c.set(typeof color === 'function' ? color(at) : color).multiplyScalar(.86 + .18 * Math.max(0, v.fromBufferAttribute(n, i).dot(light))); c.toArray(col, i * 3); }
    geo.setAttribute('color', new THREE.BufferAttribute(col, 3));
    const to = toBone(name), add = (g, m, hull) => { g.applyMatrix4(to); const mesh = new THREE.Mesh(g, m); if (hull) mesh.layers.set(HULL_LAYER); mesh.frustumCulled = false; mesh.raycast = () => {}; bone(name).add(mesh); };
    if (edge) { const h = geo.clone(), hp = h.attributes.position; for (let i = 0; i < hp.count; i++) hp.setXYZ(i, hp.getX(i) + n.getX(i) * edge, hp.getY(i) + n.getY(i) * edge, hp.getZ(i) + n.getZ(i) * edge); add(h, ink, true); }
    add(geo, flat, false);
  }
  const ball = (name, x, y, z, r, color, edge) => { const g = new THREE.SphereGeometry(r, 14, 10); g.translate(x, y, z); put(name, g, color, edge); };
  const tube = (name, pts, r, color, closed = false, seg = 40, edge) => put(name, new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts, closed), seg, r, 8, closed), color, edge);

  // 頭頂：兩耳之間最高的點
  function crown(){
    let top = null; for (const v of verts) if (v.b === BONE.head && Math.abs(v.p.x) < .12 && (!top || v.p.y > top.y)) top = v.p;
    return top.clone();
  }
  // 脖子一圈：沿著項圈斜面（line = [高度, 前後, 斜率]）量外緣，往外推 pad
  function neckRing([ly, lz, slope], pad, drop = 0){
    const near = verts.filter(v => Math.abs(v.p.y - (ly - drop - (v.p.z - lz) * slope)) < .05 && Math.abs(v.p.x) < .75 && v.p.z > lz - .36);   // 只量脖子附近，才不會把背和尾巴框進去
    const zs = near.map(v => v.p.z), cz = (Math.min(...zs) + Math.max(...zs)) / 2, N = 28, far = new Array(N).fill(0);
    for (const {p} of near) { const dx = p.x, dz = p.z - cz, k = Math.round((Math.atan2(dx, dz) / (Math.PI * 2) + 1) * N) % N; far[k] = Math.max(far[k], Math.hypot(dx, dz)); }
    const known = far.filter(Boolean), avg = known.reduce((a, b) => a + b, 0) / known.length;
    const smooth = far.map((r, k) => { const a = far[(k + N - 1) % N] || avg, b = far[(k + 1) % N] || avg; return Math.max(r || avg, (a + b) / 2); });
    return smooth.map((r, k) => { const a = k / N * Math.PI * 2, x = Math.sin(a) * (r + pad), z = cz + Math.cos(a) * (r + pad); return new THREE.Vector3(x, ly - drop - (z - lz) * slope, z); });
  }
  // 身體外殼：z0～z1 之間逐段量背部與兩側，鋪成貼身的衣服；arc＝從背脊往兩側包多少（弧度）
  function shell(z0, z1, arc, pad, color){
    const S = 36, N = 24, body = verts.filter(v => v.b === BONE.torso && v.p.z > z0 - .1 && v.p.z < z1 + .1);
    const ys = body.map(v => v.p.y), cy = (Math.min(...ys) + Math.max(...ys)) / 2, grid = [];
    for (let s = 0; s <= S; s++) { const z = z0 + (z1 - z0) * s / S, far = new Array(N + 1).fill(0);
      for (const {p} of body) { if (Math.abs(p.z - z) > .07) continue; const a = Math.atan2(p.x, p.y - cy); if (Math.abs(a) > arc + .15) continue; const k = Math.max(0, Math.min(N, Math.round((a + arc) / (2 * arc) * N))); far[k] = Math.max(far[k], Math.hypot(p.x, p.y - cy)); }
      for (let k = 0; k <= N; k++) if (!far[k]) { let l = k, r = k; while (l > 0 && !far[l]) l--; while (r < N && !far[r]) r++; far[k] = far[l] || far[r] || .3; }
      grid.push(far.map((_, k) => Math.max(far[k], (far[Math.max(0, k - 1)] + far[k] + far[Math.min(N, k + 1)]) / 3)));
    }
    for (let pass = 0; pass < 2; pass++) for (let s = 1; s < S; s++) for (let k = 0; k <= N; k++) grid[s][k] = Math.max(grid[s][k], (grid[s - 1][k] + grid[s + 1][k]) / 2);
    { const all = grid.flatMap(g => g.map((r, k) => ({r, k}))); for (let k = 0; k <= N; k++) { const col = all.filter(o => o.k === k).map(o => o.r).sort((a, b) => a - b), top = col[col.length >> 1] * 1.14; for (const g of grid) g[k] = Math.min(g[k], top); } }   // 脖子、耳朵框進來的突起壓回去
    const at = (s, k, extra = 0) => { const a = -arc + 2 * arc * k / N, r = grid[s][k] + pad + extra; return new THREE.Vector3(Math.sin(a) * r, cy + Math.cos(a) * r, z0 + (z1 - z0) * s / S); };
    const P = [], ix = [];
    for (let s = 0; s <= S; s++) for (let k = 0; k <= N; k++) P.push(...at(s, k).toArray());
    for (let s = 0; s < S; s++) for (let k = 0; k < N; k++) { const a = s * (N + 1) + k, b = a + N + 1; ix.push(a, b, a + 1, b, b + 1, a + 1); }
    const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(P, 3)); g.setIndex(ix); g.computeVertexNormals(); put('torso', g, color, 0);
    return {edgeS:s => Array.from({length:N + 1}, (_, k) => at(s, k, .01)), edgeK:k => Array.from({length:S + 1}, (_, s) => at(s, k, .01)), S, N, at};
  }
  // 垂向一邊的軟帽：r 帽口半徑、h 高度、lean 帽尖往哪邊垂
  function softHat(base, r, h, lean, color, brim, pom, droop = .35){
    const path = new THREE.CatmullRomCurve3([[0, 0, 0], [lean * .05, h * .5, -.02], [lean * h * .35, h * .85, -.06], [lean * h * .7, h * (1 - droop), -.08]].map(p => new THREE.Vector3(...p).add(base)));
    const R = 40, Sg = 20, P = [], ix = [], f = path.computeFrenetFrames(R, false), v = new THREE.Vector3();
    for (let i = 0; i <= R; i++) { const t = i / R, c = path.getPointAt(t), rr = .03 + (r - .03) * Math.pow(1 - t, 1.15);
      for (let j = 0; j <= Sg; j++) { const a = j / Sg * Math.PI * 2; v.copy(c).addScaledVector(f.normals[i], Math.cos(a) * rr).addScaledVector(f.binormals[i], Math.sin(a) * rr); P.push(v.x, v.y, v.z); } }
    for (let i = 0; i < R; i++) for (let j = 0; j < Sg; j++) { const a = i * (Sg + 1) + j, b = a + Sg + 1; ix.push(a, a + 1, b, b, a + 1, b + 1); }
    const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(P, 3)); g.setIndex(ix); g.computeVertexNormals(); put('head', g, color);
    const t = new THREE.TorusGeometry(r, r * .2, 8, 28); t.rotateX(Math.PI / 2); t.translate(base.x, base.y + .01, base.z); put('head', t, brim);
    const tip = path.getPointAt(1); ball('head', tip.x, tip.y, tip.z, r * .3, pom);
  }
  const front = ring => ring.reduce((a, b) => b.z > a.z ? b : a);

  if (id === 'cat') {   // 聖誕老貓
    const top = crown(); softHat(new THREE.Vector3(0, top.y - .04, top.z - .02), .25, .55, -1, C.red, C.white, C.white);
    const cape = shell(-.55, .3, 1.5, .05, C.red);
    for (const s of [0, cape.S]) tube('torso', cape.edgeS(s), .05, C.white);
    for (const k of [0, cape.N]) tube('torso', cape.edgeK(k), .05, C.white);
    const neck = neckRing([1.3, .33, .42], .03); tube('head', neck, .05, C.red, true);
    const f = front(neck); ball('head', f.x, f.y - .05, f.z + .05, .1, C.gold);
  } else if (id === 'cat2') {   // 小精靈
    const top = crown(); softHat(new THREE.Vector3(0, top.y - .04, top.z - .03), .25, .62, 1, C.lime, C.red, C.gold, .2);
    const neck = neckRing([1.21, .52, .36], .05);
    neck.forEach((p, i) => { if (i % 2) return; const out = new THREE.Vector3(p.x, 0, p.z - neck.reduce((a, q) => a + q.z, 0) / neck.length).normalize();
      const g = new THREE.ConeGeometry(.12, .3, 4); g.rotateX(Math.PI); g.scale(1, 1, .45); g.rotateY(Math.atan2(out.x, out.z)); g.translate(p.x + out.x * .05, p.y - .13, p.z + out.z * .05); put('head', g, i % 4 ? C.green : C.red); });
    tube('head', neck, .045, C.green, true);
    const f = front(neck); ball('head', f.x, f.y - .06, f.z + .1, .095, C.gold);
    for (const i of [4, neck.length - 4]) ball('head', neck[i].x * 1.08, neck[i].y - .3, neck[i].z + .05, .055, C.gold);
  } else if (id === 'dog1') {   // 麋鹿
    const top = crown();
    for (const d of [-1, 1]) {
      const b = new THREE.Vector3(d * .17, top.y - .06, top.z - .05), q = (x, y, z) => new THREE.Vector3(b.x + d * x, b.y + y, b.z + z);
      tube('head', [b, q(.07, .22, -.02), q(.2, .38, -.03), q(.23, .55, -.02)], .05, C.cream, false, 20);
      tube('head', [q(.09, .24, -.02), q(.01, .36, .02), q(-.01, .46, .04)], .038, C.cream, false, 10);
      tube('head', [q(.19, .37, -.03), q(.34, .4, -.01), q(.42, .49, .01)], .038, C.cream, false, 10);
      for (const [x, y, z] of [[.23, .55, -.02], [-.01, .46, .04], [.42, .49, .01]]) { const v = q(x, y, z); ball('head', v.x, v.y, v.z, .048, C.cream); }
    }
    tube('head', [new THREE.Vector3(-.2, top.y - .06, top.z - .05), new THREE.Vector3(0, top.y + .015, top.z - .05), new THREE.Vector3(.2, top.y - .06, top.z - .05)], .035, C.darkRed, false, 20);
    ball('head', .048, 1.34, 1.76, .135, 0xff2a2a);
    ball('head', .005, 1.39, 1.87, .032, C.white, 0);
    const coat = shell(-.68, -.02, 2.35, .035, p => [C.red, C.green][Math.floor((p.z + 2) / .17) % 2]);
    for (const s of [0, coat.S]) tube('torso', coat.edgeS(s), .045, C.white);
    const neck = neckRing([1.0, .55, .5], .03); tube('head', neck, .05, C.red, true);
    neck.forEach((p, i) => { if (i % 4 === 0 && p.z > .45) ball('head', p.x * 1.1, p.y - .07, p.z + .04, .065, C.gold); });
  } else if (id === 'dog2') {   // 暖冬雪人
    const top = crown(), base = new THREE.Vector3(0, top.y - .1, top.z - .03);
    softHat(base, .3, .5, 1, p => [C.red, C.white][Math.floor((p.y - base.y + 2) / .085) % 2], C.green, C.white, .15);
    const stripe = p => [C.green, C.white][Math.floor((Math.atan2(p.x, p.z - .3) + 4) / .42) % 2];
    const neck = neckRing([1.18, .5, .3], .06); tube('head', neck, .11, stripe, true, 200);
    const k = neck.reduce((a, b) => (b.z - Math.abs(b.x - .26) * 2) > (a.z - Math.abs(a.x - .26) * 2) ? b : a);   // 圍巾垂下的那一端
    const hang = [new THREE.Vector3(k.x, k.y, k.z + .05), new THREE.Vector3(k.x + .04, k.y - .22, k.z + .13), new THREE.Vector3(k.x + .07, k.y - .48, k.z + .13)];
    tube('head', hang, .095, p => [C.green, C.white][Math.floor((p.y + 4) / .1) % 2], false, 60);
    ball('head', hang[2].x, hang[2].y, hang[2].z, .105, C.red);
    ball('head', k.x, k.y, k.z + .08, .13, C.red);
  }
}

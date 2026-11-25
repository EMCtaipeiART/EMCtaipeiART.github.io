// 辦公室寵物的立體模型（三花貓 cat、虎斑貓 cat2、臘腸狗 dog1、薩摩耶 dog2）。
// 全部用程式建模（不需要模型檔）：身體部位是變形球體與漸縮管，花色直接畫在頂點上，外框用沿法線外推的背面。
// 單位：舊圖集的 100 像素 = 1；面朝 +Z、腳底 y=0。makePet() 回傳 {group, update(姿勢, 毫秒, 移動距離)}。

const SPECS = {
  cat:{scale:.42, head:[0, 1.60, .50], hr:[.66, .55, .52], body:[0, .84, -.12], br:[.52, .47, .80], legF:[.27, .72, .38], legB:[.31, .72, -.60], lr:.155, ink:0x24120a},
  cat2:{scale:.42, head:[0, 1.58, .50], hr:[.67, .56, .53], body:[0, .83, -.12], br:[.54, .48, .80], legF:[.27, .70, .38], legB:[.31, .70, -.60], lr:.165, ink:0x2c180c},
  dog1:{scale:.61, head:[0, 1.22, .82], hr:[.47, .45, .45], body:[0, .64, -.14], br:[.42, .39, 1.00], legF:[.25, .50, .52], legB:[.26, .50, -.82], lr:.135, ink:0x2a1005},
  dog2:{scale:.61, head:[0, 1.46, .52], hr:[.55, .49, .47], body:[0, .84, -.22], br:[.55, .50, .74], legF:[.28, .62, .34], legB:[.31, .62, -.64], lr:.17, ink:0x3a1d10},
};

export function makePet(THREE, utils, id, hullLayer){
  const S = SPECS[id]; if (!S) return null;
  const {mergeGeometries, mergeVertices} = utils, V = (x, y, z) => new THREE.Vector3(x, y, z);
  const INK = .018 / S.scale, LIGHT = V(-.4, .75, .55).normalize();
  const flat = new THREE.MeshBasicMaterial({vertexColors:true}), inkMat = new THREE.MeshBasicMaterial({color:S.ink, side:THREE.BackSide});
  const C = h => new THREE.Color(h), clamp = (v, a = 0, b = 1) => Math.min(b, Math.max(a, v));
  const sm = (a, b, v) => { const t = clamp((v - a) / (b - a)); return t * t * (3 - 2 * t); };
  const mix = (a, b, t) => a.clone().lerp(b, clamp(t));

  // ───── 幾何 ─────
  function ellipsoid(c, r, {seg = 40, bump = null, rot = null} = {}){
    let g = new THREE.SphereGeometry(1, seg, Math.round(seg * .7)); g.deleteAttribute('uv'); g.deleteAttribute('normal'); g = mergeVertices(g, 1e-4);
    const p = g.attributes.position, q = rot ? new THREE.Quaternion().setFromEuler(new THREE.Euler(...rot)) : null, v = V();
    for (let i = 0; i < p.count; i++) {
      v.fromBufferAttribute(p, i); const k = bump ? bump(v) : 1;
      v.set(v.x * r[0] * k, v.y * r[1] * k, v.z * r[2] * k); if (q) v.applyQuaternion(q);
      p.setXYZ(i, v.x + c[0], v.y + c[1], v.z + c[2]);
    }
    g.computeVertexNormals(); return g;
  }
  function tube(pts, radii, {n = 28, sides = 18, bump = null} = {}){
    const curve = new THREE.CatmullRomCurve3(pts.map(a => V(...a))), frames = curve.computeFrenetFrames(n, false), pos = [], idx = [];
    const rad = f => { const x = f * (radii.length - 1), k = Math.min(radii.length - 2, x | 0); return radii[k] + (radii[k + 1] - radii[k]) * (x - k); };
    const cap = 4, rings = [];   // 兩端各補幾圈收成圓頭
    for (let i = cap; i > 0; i--) { const a = i / cap * Math.PI / 2; rings.push([0, -Math.sin(a) * rad(0), Math.cos(a)]); }
    for (let i = 0; i <= n; i++) rings.push([i / n, 0, 1]);
    for (let i = 1; i <= cap; i++) { const a = i / cap * Math.PI / 2; rings.push([1, Math.sin(a) * rad(1), Math.cos(a)]); }
    for (const [f, off, w] of rings) {
      const i = Math.round(f * n), at = curve.getPointAt(f).addScaledVector(frames.tangents[i], off);
      for (let j = 0; j < sides; j++) {
        const a = j / sides * Math.PI * 2, k = rad(f) * Math.max(w, .02) * (bump ? bump(f, a) : 1);
        const d = frames.normals[i].clone().multiplyScalar(Math.cos(a)).addScaledVector(frames.binormals[i], Math.sin(a));
        const q = at.clone().addScaledVector(d, k); pos.push(q.x, q.y, q.z);
      }
    }
    for (let i = 0; i < rings.length - 1; i++) for (let j = 0; j < sides; j++) {
      const a = i * sides + j, b = i * sides + (j + 1) % sides; idx.push(a, b, a + sides, b, b + sides, a + sides);
    }
    const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); g.setIndex(idx); g.computeVertexNormals(); return g;
  }
  const puff = (amp, f = 6.5) => v => 1 + amp * .55 * (Math.abs(Math.sin(v.x * f + v.y * 2.5)) + Math.abs(Math.sin(v.y * f + v.z * 2.5)) + Math.abs(Math.sin(v.z * f + v.x * 2.5))) / 1.5 - amp * .5;   // 蓬毛：輪廓一撮一撮

  // ───── 骨架：每根骨頭收集自己的零件，最後合併 ─────
  const bones = [];
  function bone(parent, at, name){   // at＝模型座標的關節位置
    const g = new THREE.Group(); g.name = name; g.userData = {at, solid:[], ink:[]};
    const pa = parent.userData.at || [0, 0, 0]; g.position.set(at[0] - pa[0], at[1] - pa[1], at[2] - pa[2]);
    g.userData.rest = g.position.clone(); parent.add(g); bones.push(g); return g;
  }
  function add(b, geo, color, {line = true, shade = 1} = {}){
    const p = geo.attributes.position, nr = geo.attributes.normal, col = new Float32Array(p.count * 3), v = V(), n = V();
    for (let i = 0; i < p.count; i++) {
      v.fromBufferAttribute(p, i); n.fromBufferAttribute(nr, i);
      const c = typeof color === 'function' ? color(v, n) : C(color), k = 1 - shade * (.08 - .1 * Math.max(0, n.dot(LIGHT)) + .07 * Math.max(0, -n.y));
      col.set([c.r * k, c.g * k, c.b * k], i * 3);
    }
    const at = b.userData.at, g = new THREE.BufferGeometry();
    g.setAttribute('position', p.clone().applyMatrix4(new THREE.Matrix4().makeTranslation(-at[0], -at[1], -at[2])));
    g.setAttribute('color', new THREE.BufferAttribute(col, 3)); g.setIndex(geo.index.clone()); b.userData.solid.push(g);
    if (line) {
      const h = new THREE.BufferGeometry(), a = new Float32Array(p.count * 3), q = g.attributes.position;
      for (let i = 0; i < p.count; i++) a.set([q.getX(i) + nr.getX(i) * INK, q.getY(i) + nr.getY(i) * INK, q.getZ(i) + nr.getZ(i) * INK], i * 3);
      h.setAttribute('position', new THREE.BufferAttribute(a, 3)); h.setIndex(geo.index.clone()); b.userData.ink.push(h);
    }
  }

  const group = new THREE.Group(), roll = new THREE.Group(); roll.position.set(0, S.body[1], S.body[2]); roll.userData = {at:[0, S.body[1], S.body[2]]}; group.add(roll);
  const [hx, hy, hz] = S.head, [rx, ry, rz] = S.hr, [, by, bz] = S.body, br = S.br, isCat = !id.startsWith('dog');
  const torso = bone(roll, [0, by, bz], 'torso');
  const head = bone(torso, [0, hy - ry * .62, hz - rz * .25], 'head');
  const tailAt = {cat:[0, 1.0, -.82], cat2:[0, .86, -.84], dog1:[0, .76, -1.05], dog2:[0, 1.1, -.82]}[id];
  const tail = bone(torso, tailAt, 'tail');
  const legs = {}; for (const [k, a, sx] of [['FL', S.legF, 1], ['FR', S.legF, -1], ['BL', S.legB, 1], ['BR', S.legB, -1]]) legs[k] = bone(roll, [a[0] * sx, a[1], a[2]], 'leg' + k);

  // 頭部表面上的點（五官貼在這裡）
  const surf = (x, y, out = 0) => [x, hy + y, hz + rz * Math.sqrt(Math.max(.05, 1 - (x / rx) ** 2 - (y / ry) ** 2)) + out];
  const stripe = (t, w = .34) => sm(1 - w * 2 - .12, 1 - w * 2 + .12, Math.sin(t));

  // ───── 花色 ─────
  const paint = {};
  if (id === 'cat') {
    const W = C(0xfdf3e4), O = C(0xe8812a), D = C(0x5a3220);
    paint.head = v => { const x = v.x / rx, y = (v.y - hy) / ry, z = (v.z - hz) / rz;
      let c = mix(O, D, sm(-.12, -.3, x) * sm(.05, .25, y)); c = mix(c, D, stripe(x * 19, .2) * sm(.5, .7, y) * .8);
      const blaze = z > 0 ? sm(.2 - .2 * clamp(-y), .08 - .2 * clamp(-y), Math.abs(x)) * sm(.65, .45, y) : 0;
      const muzzle = sm(-.02, -.2, y - .3 * x * x) * sm(-.2, .2, z);
      return mix(c, W, Math.max(blaze, muzzle)); };
    paint.body = v => { const y = (v.y - by) / br[1], z = (v.z - bz) / br[2];
      const c = mix(O, D, stripe(z * 9 + Math.abs(v.x) * 1.5, .27)); return mix(c, W, sm(-.12, -.34, y + .12 * Math.sin(z * 7) - .35 * sm(.45, .95, z))); };
    paint.leg = v => mix(O, W, sm(.62, .46, v.y));
    paint.tail = (v) => mix(O, D, Math.max(stripe((v.y * 1.6 - v.z) * 5.2, .3), sm(1.9, 2.05, v.y)));
    paint.ear = O; paint.earL = D; paint.chest = W; paint.paw = W;
  } else if (id === 'cat2') {
    const T = C(0xeec796), D = C(0xd29c66), W = C(0xfdecd2);
    paint.head = v => { const x = v.x / rx, y = (v.y - hy) / ry, z = (v.z - hz) / rz;
      let c = mix(T, D, Math.max(stripe(x * 17, .17) * sm(.42, .62, y), stripe(y * 15 + 1, .14) * sm(.55, .75, Math.abs(x))));
      return mix(c, W, sm(-.1, -.3, y - .35 * x * x) * sm(-.1, .3, z)); };
    paint.body = v => { const y = (v.y - by) / br[1], z = (v.z - bz) / br[2];
      return mix(mix(T, D, stripe(z * 11 + Math.abs(v.x) * 2.2, .2) * sm(-.35, .1, y)), W, sm(-.3, -.6, y - .3 * sm(.5, .95, z))); };
    paint.leg = v => mix(mix(T, D, stripe(v.y * 22, .14) * .8), W, sm(.28, .16, v.y));
    paint.tail = v => mix(T, D, stripe((v.z + v.y) * 11, .24));
    paint.ear = T; paint.earL = T; paint.chest = W; paint.paw = W;
  } else if (id === 'dog1') {
    const R = C(0xa8532b), D = C(0x873b1c), T = C(0xf4b06a), L = C(0xfdd39b);
    paint.head = v => { const x = v.x / rx, y = (v.y - hy) / ry, z = (v.z - hz) / rz; return mix(R, T, sm(-.15, -.45, y) * sm(0, .35, z) + sm(.2, .08, Math.hypot(Math.abs(x) - .34, y - .42)) * sm(.3, .5, z)); };
    paint.body = v => { const y = (v.y - by) / br[1]; return mix(mix(D, R, sm(.75, .1, y)), T, sm(-.28, -.62, y + .1 * Math.sin(v.z * 14))); };
    paint.chest = v => mix(R, mix(T, L, sm(.55, .35, v.y)), sm(.98, .8, v.y + .06 * Math.sin(v.x * 26)) * sm(.46, .66, v.z));
    paint.leg = v => mix(R, T, sm(.36, .24, v.y)); paint.paw = L;
    paint.tail = (v, n) => mix(R, L, sm(.1, -.45, n.y - n.z * .35)); paint.ear = D; paint.muzzle = T;
  } else {
    const W = C(0xfdf6f1), P = C(0xf2ddd5);
    const white = (v, n) => mix(W, P, sm(-.1, -.75, n.y));
    paint.head = (v, n) => { const x = v.x / rx, y = (v.y - hy) / ry; return mix(white(v, n), C(0xffab9c), sm(.24, .1, Math.hypot((Math.abs(x) - .56) * .9, (y + .2) * 1.5)) * (n.z > .3 ? 1 : 0)); };
    paint.body = paint.chest = paint.leg = paint.tail = paint.muzzle = white; paint.paw = W; paint.ear = W;
  }
  const fluffy = id === 'dog2';

  // ───── 身體 ─────
  add(torso, ellipsoid([0, by, bz], br, {seg:fluffy ? 64 : 44, bump:fluffy ? puff(.12) : null}), paint.body);
  const chest = {cat:[[0, .98, .34], [.40, .46, .35]], cat2:[[0, .96, .33], [.42, .46, .36]], dog1:[[0, .72, .56], [.37, .44, .36]], dog2:[[0, 1.04, .28], [.60, .52, .43]]}[id];
  add(torso, ellipsoid(chest[0], chest[1], {seg:fluffy ? 64 : 36, bump:fluffy ? puff(.14) : id === 'dog1' ? puff(.09, 11) : null}), paint.chest);
  if (id === 'dog1') add(torso, ellipsoid([0, .46, -.2], [.3, .2, .72], {bump:puff(.14, 12)}), paint.body);
  for (const k in legs) {
    const [x, y, z] = legs[k].userData.at, r = S.lr, front = k[0] === 'F';
    if (!front) add(legs[k], ellipsoid([x * .98, y - .04, z + .03], [r * 1.45, r * 1.9, r * 1.9], {seg:28, bump:fluffy ? puff(.1) : null}), paint.body);
    add(legs[k], tube([[x, y, z], [x, y * .55, z + (front ? .01 : -.02)], [x, r * .75, z + .03]], [r * 1.12, r * .96, r], {bump:fluffy ? (f, a) => 1 + .09 * Math.abs(Math.sin(a * 5 + f * 14)) : null}), paint.leg);
    add(legs[k], ellipsoid([x, r * .66, z + .09], [r * 1.16, r * .72, r * 1.38], {seg:24}), paint.paw);
    for (const t of [-1, 1]) add(legs[k], tube([[x + t * r * .38, r * .95, z + .09 + r * 1.18], [x + t * r * .4, r * .45, z + .09 + r * 1.36]], [.012, .012], {n:6, sides:6}), S.ink, {line:false, shade:0});
  }

  // ───── 尾巴 ─────
  if (id === 'cat') add(tail, tube([tailAt, [0, 1.12, -1.16], [0, 1.55, -1.30], [0, 1.98, -1.16], [0, 2.14, -.94]], [.15, .15, .145, .135, .115], {n:44, bump:(f, a) => 1 + .05 * Math.abs(Math.sin(a * 7 + f * 40))}), paint.tail);
  else if (id === 'cat2') add(tail, tube([tailAt, [0, .66, -1.18], [.05, .62, -1.5], [.14, .8, -1.7], [.18, 1.04, -1.68]], [.16, .155, .15, .14, .115], {n:40}), paint.tail);
  else if (id === 'dog1') add(tail, tube([tailAt, [0, .86, -1.34], [0, 1.16, -1.48], [0, 1.44, -1.34], [0, 1.5, -1.16]], [.11, .19, .2, .13, .04], {n:36, bump:(f, a) => 1 + .2 * Math.abs(Math.sin(a * 3 + f * 19))}), paint.tail);
  else add(tail, tube([tailAt, [0, 1.46, -1.02], [.06, 1.74, -.74], [.2, 1.68, -.38], [.3, 1.42, -.24]], [.2, .36, .38, .29, .1], {n:40, sides:34, bump:(f, a) => 1 + .17 * Math.pow(Math.abs(Math.sin(a * 4 + f * 17) * Math.sin(f * 23 + a)), .4)}), paint.tail);

  // ───── 頭 ─────
  const cheek = isCat ? v => 1 + .09 * sm(.35, .85, Math.abs(v.x)) * sm(.35, -.25, v.y) * sm(-.9, -.4, v.y) : null;
  add(head, ellipsoid(S.head, S.hr, {seg:fluffy ? 60 : 48, bump:fluffy ? v => 1 + (puff(.12)(v) - 1) * sm(.75, .2, v.z) : cheek}), paint.head);

  // 耳朵
  const ears = [];
  for (const s of [1, -1]) {
    if (id === 'dog1') {
      const e = bone(head, [s * rx * .74, hy + ry * .48, hz - .05], 'ear'); ears.push([e, s]);
      add(e, ellipsoid([s * rx * 1.06, hy - ry * .2, hz - .08], [.19, .50, .30], {seg:40, bump:v => 1 + (v.y < .1 ? .13 * Math.abs(Math.sin(v.x * 8 + v.z * 9)) : 0), rot:[0, 0, s * .2]}), v => mix(paint.ear, C(0xa04a24), sm(hy - ry * .1, hy - ry * .65, v.y)));
    } else {
      const big = isCat, w = big ? .27 : .2, h = big ? .5 : .38, ex = s * rx * .6, ey = hy + ry * .68, ez = hz - .04;
      const e = bone(head, [ex, ey, ez], 'ear'); ears.push([e, s]);
      const cone = (c, W, H, D) => ellipsoid(c, [W, H, D], {seg:32, rot:[0, 0, -s * .34], bump:v => v.y > 0 ? 1 - .0 * v.y : 1});
      const point = (g, c, H) => { const p = g.attributes.position, q = new THREE.Quaternion().setFromEuler(new THREE.Euler(0, 0, -s * .34)).invert(), v = V();   // 把球拉成尖耳
        for (let i = 0; i < p.count; i++) { v.fromBufferAttribute(p, i).sub(V(...c)).applyQuaternion(q); const t = clamp(v.y / H, 0, 1); v.x *= 1 - .86 * Math.pow(t, 1.6); v.z *= 1 - .6 * t; v.applyQuaternion(q.clone().invert()).add(V(...c)); p.setXYZ(i, v.x, v.y, v.z); }
        g.computeVertexNormals(); return g; };
      const oc = [ex + s * .05, ey + .08, ez], ic = [ex + s * .05, ey + .09, ez + .09];
      add(e, point(cone(oc, w, h, .15), oc, h), s > 0 || id !== 'cat' ? paint.ear : paint.earL);
      add(e, point(cone(ic, w * .6, h * .72, .08), ic, h * .72), 0xf59a8c, {line:false, shade:.4});
    }
  }

  // 眼睛、鼻子、嘴
  const open = new THREE.Group(), shut = new THREE.Group(), tongue = new THREE.Group();
  const face = bone(head, head.userData.at, 'face'), eyesO = bone(face, [0, hy, hz], 'eyesOpen'), eyesC = bone(face, [0, hy, hz], 'eyesShut'), tng = bone(face, head.userData.at, 'tongue');
  const ex = rx * (isCat ? .41 : id === 'dog1' ? .4 : .38), ey = isCat ? -.02 : id === 'dog1' ? .07 : .04;
  for (const s of [1, -1]) {
    const E = surf(s * ex, ey), look = [-ey * .9 / ry * .5, s * Math.atan2(ex / rx ** 2, Math.sqrt(1 - (ex / rx) ** 2) / rz) * .85, 0];
    const disc = (dx, dy, w, h, out, color) => add(eyesO, ellipsoid([E[0] + dx, E[1] + dy, E[2] + out], [w, h, .035], {seg:22, rot:look}), color, {line:false, shade:0});
    if (isCat) {
      disc(0, 0, .155, .175, -.012, S.ink); disc(0, 0, .135, .155, .004, id === 'cat' ? 0x86a62c : 0xb07422);
      disc(0, -.005, .085, .125, .018, 0x120a06); disc(s * -.035 + .015, .062, .04, .045, .036, 0xffffff); disc(.045 * -s, -.07, .018, .018, .034, 0xffffff);
    } else {
      const w = id === 'dog1' ? .083 : .074, h = id === 'dog1' ? .115 : .092;
      disc(0, 0, w, h, .005, 0x1c0c06); disc(-.022, h * .38, w * .32, h * .26, .028, 0xffffff);
    }
    const arc = [[-.13, .03], [-.065, -.03], [0, -.048], [.065, -.03], [.13, .03]].map(([dx, dy]) => surf(s * ex + dx * (isCat ? 1 : .75), ey + dy, .028));
    add(eyesC, tube(arc, [.014, .027, .03, .027, .014], {n:14, sides:8}), S.ink, {line:false, shade:0});
  }
  const lineTube = (pts, r, color = S.ink, b = face) => add(b, tube(pts, [r * .6, r, r * .6], {n:12, sides:7}), color, {line:false, shade:0});
  if (isCat) {
    const n = surf(0, -.19, .02);
    add(face, ellipsoid(n, [.062, .042, .035], {seg:16}), 0xe8776f, {line:false});
    for (const s of [1, -1]) {
      lineTube([surf(0, -.23, .02), surf(s * .045, -.3, .02), surf(s * .12, -.275, .02)], .014);
      for (const k of [0, 1]) lineTube([surf(s * rx * .66, -.17 - k * .08, .015), surf(s * rx * .84, -.17 - k * .11, .09), [s * rx * 1.16, hy - .16 - k * .14, hz + rz * .42]], .008, 0xfff6ea);
    }
    add(tng, ellipsoid(surf(0, -.33, .015), [.055, .075, .03], {seg:16}), 0xf27f83);
  } else {
    const dach = id === 'dog1', mc = dach ? [0, hy - .17, hz + rz * .88] : [0, hy - .17, hz + rz * .86], mr = dach ? [.23, .175, .3] : [.25, .18, .19];
    add(face, ellipsoid(mc, mr, {seg:32}), paint.muzzle);
    const tip = mc[2] + mr[2];
    add(face, ellipsoid([0, mc[1] + .07, tip - .02], [.09, .062, .06], {seg:20}), 0x24100a, {line:false, shade:.3});
    add(face, ellipsoid([-.028, mc[1] + .095, tip + .038], [.02, .012, .008], {seg:10}), 0xffffff, {line:false, shade:0});
    for (const s of [1, -1]) lineTube([[0, mc[1] - .005, tip + .012], [s * .045, mc[1] - .062, tip - .008], [s * .125, mc[1] - .045, tip - .07]], .015);
    add(tng, ellipsoid([0, mc[1] - .13, tip - .07], [.075, .11, .042], {seg:20, rot:[-.25, 0, 0]}), 0xf7848a);
    if (dach) for (const s of [1, -1]) add(face, ellipsoid(surf(s * ex * .82, ey + .19, .0), [.07, .05, .02], {seg:12, rot:[-.4, s * .3, 0]}), 0xf4b06a, {line:false});
  }

  // 項圈
  if (isCat) {
    const nc = [0, hy - ry * 1.05, hz - .1], ring = (a, r = 1) => [Math.sin(a) * .49 * r, nc[1] - .08 * Math.max(0, Math.cos(a)), nc[2] + Math.cos(a) * .50 * r];
    if (id === 'cat') {
      add(torso, tube(Array.from({length:25}, (_, i) => ring(i / 24 * Math.PI * 2, 1.02)), [.055, .055], {n:60, sides:10}), 0xe87f86);
      add(torso, ellipsoid([0, nc[1] - .2, nc[2] + .6], [.13, .13, .11], {seg:24}), 0xee8a72);
      add(torso, ellipsoid([0, nc[1] - .22, nc[2] + .71], [.028, .045, .016], {seg:10}), S.ink, {line:false});
    } else {
      const cols = [0xf6c9c0, 0xb58ad0, 0xa9cdea, 0x66c7c0, 0xfbf7ee, 0xf8d51f];
      for (let i = 0; i < 18; i++) add(torso, ellipsoid(ring((i - 2.5) / 18 * Math.PI * 2, 1.13), [.095, .095, .095], {seg:18}), cols[i % 6]);
      for (const s of [-.06, .07]) add(torso, ellipsoid([.24 + s, nc[1] - .2, nc[2] + .58], [.065, .065, .06], {seg:14}), 0xd99a1c);
    }
  }

  // 合併每根骨頭的零件
  for (const b of bones) {
    const {solid, ink} = b.userData;
    if (solid.length) b.add(new THREE.Mesh(mergeGeometries(solid), flat));
    if (ink.length) { const m = new THREE.Mesh(mergeGeometries(ink), inkMat); m.layers.set(hullLayer); b.add(m); }
    b.userData.solid = b.userData.ink = null;
  }
  head.scale.setScalar({cat:1.14, cat2:1.14, dog1:1.04, dog2:1.12}[id]);   // Q 版大頭
  group.scale.set(S.scale, S.scale * 1.08, S.scale);

  // ───── 動作 ─────
  // 每個姿勢是各骨頭相對站姿的偏移 [x,y,z, rx,ry,rz]；切換姿勢時平滑過去
  const keys = ['roll', 'torso', 'head', 'tail', 'FL', 'FR', 'BL', 'BR'], nodes = {roll, torso, head, tail, ...legs};
  const cur = {}; for (const k of keys) cur[k] = [0, 0, 0, 0, 0, 0];
  const rest = roll.position.clone(); let ph = 0, last = 0, lids = 1, tOut = 0;
  const low = by - br[1] * .93, legLen = S.legF[1];
  function target(pose, t){
    const o = {}; for (const k of keys) o[k] = [0, 0, 0, 0, 0, 0];
    let eyes = 1, tongueOut = id === 'dog2' ? 1 : 0;
    const set = (k, v) => { for (let i = 0; i < 6; i++) o[k][i] += v[i] || 0; };
    const s = Math.sin(ph), c = Math.cos(ph), breathe = Math.sin(t * 2.1) * .012;
    const sit = () => {
      const tilt = id === 'dog1' ? -.5 : -.66, drop = id === 'dog1' ? .14 : .24;
      set('torso', [0, -drop, 0, tilt]); set('head', [0, 0, 0, -tilt * .92]);
      for (const k of ['BL', 'BR']) set(k, [(k === 'BL' ? 1 : -1) * .07, -(legLen - S.lr * 1.9), .22, -1.42]);
      const up = Math.sin(-tilt) * (S.legF[2] - bz) - drop;   // 胸口抬高多少，前腳就跟著拉長
      for (const k of ['FL', 'FR']) { set(k, [0, up * .78, -.14]); o[k][6] = 1 + up * .78 / legLen; }
      set('tail', [0, 0, 0, id === 'cat' ? .95 : .55, Math.sin(t * 1.6) * .14]);
    };
    const lie = (headDown) => {
      set('torso', [0, -low, 0]); set('head', [0, -headDown, .05]);
      for (const k of ['FL', 'FR']) { set(k, [0, -(legLen - S.lr * 1.15), .24, -1.52]); o[k][6] = .8; }
      for (const k of ['BL', 'BR']) { set(k, [(k === 'BL' ? 1 : -1) * .1, -(legLen - S.lr * 1.4), .26, -1.5]); o[k][6] = .55; }
      set('tail', [0, 0, 0, id === 'cat' ? 1.5 : .75, id === 'dog2' ? .5 : 1.1]);
    };
    if (pose === 'walk') {
      set('FL', [0, Math.max(0, c) * .1, 0, -s * .55]); set('BR', [0, Math.max(0, c) * .1, 0, -s * .55]);
      set('FR', [0, Math.max(0, -c) * .1, 0, s * .55]); set('BL', [0, Math.max(0, -c) * .1, 0, s * .55]);
      set('torso', [0, Math.abs(c) * .06, 0, 0, s * .06]); set('head', [0, 0, 0, Math.sin(ph * 2) * .05, -s * .05]); set('tail', [0, 0, 0, 0, s * .28]);
    } else if (pose === 'run') {
      const lift = .16 + Math.abs(s) * .2;
      set('torso', [0, lift, 0, c * .13]); set('head', [0, 0, 0, -c * .11 + .05]);
      for (const k of ['FL', 'FR']) set(k, [0, lift + .04, .04, -.25 - s * .95 + (k === 'FL' ? .12 : -.12)]);
      for (const k of ['BL', 'BR']) set(k, [0, lift + .04, -.04, .25 + s * .95 + (k === 'BL' ? .12 : -.12)]);
      set('tail', [0, 0, 0, -.45 + c * .15]); tongueOut = isCat ? 0 : 1;
    } else if (pose === 'sit') sit();
    else if (pose === 'groom') {
      sit(); eyes = 0; tongueOut = 1; const lick = Math.sin(t * 9) * .09;
      set('FR', [.07, .3, .3, -1.85 + lick]); o.FR[6] = .9; set('head', [-.05, -.08, .04, .38 + lick * .5, -.2, -.12]);
    } else if (pose === 'loaf') { lie(id === 'cat' || id === 'cat2' ? .2 : .1); eyes = .38; set('torso', [0, breathe]); }
    else if (pose === 'down') { lie(.16); set('torso', [0, breathe]); set('tail', [0, 0, 0, 0, Math.sin(t * 3) * .2]); }
    else if (pose === 'sleep') {
      lie(hy - ry - low - .02); eyes = 0; tongueOut = 0; set('head', [.14, .05, .1, .03, .38, .2]); set('torso', [0, breathe * 1.8, 0, 0, -.16]); set('tail', [0, 0, 0, .3, .7]);
    } else if (pose === 'eat') {
      const drop = Math.max(.35, hy - ry * 1.5), chew = Math.abs(Math.sin(t * 9)) * .05;
      set('torso', [0, -.06, 0, .2]); set('head', [0, -drop * .72 - chew, .24, .42 + chew]);
      for (const k of ['FL', 'FR']) set(k, [0, 0, .02, 0]); set('tail', [0, 0, 0, -.2, Math.sin(t * 5) * .25]); tongueOut = 0; eyes = isCat ? .5 : 1;
    } else if (pose === 'wag') {
      const w = Math.sin(t * 14);
      set('torso', [0, Math.abs(w) * .03, 0, 0, w * .09]); set('head', [0, 0, 0, -.1, -w * .06, w * .05]); set('tail', [0, 0, 0, 0, w * .75]); tongueOut = 1;
    } else if (pose === 'belly') {
      const w = Math.sin(t * 7);
      set('roll', [0, -(by - br[1] * .95), 0, 0, 0, Math.PI + w * .16]);
      set('head', [0, .34, .16, .1, 0, -Math.PI * .92]);
      for (const [k, d] of [['FL', 1], ['FR', -1], ['BL', -1], ['BR', 1]]) set(k, [0, 0, 0, (k[0] === 'F' ? -.6 : .35) + w * .25 * d]);
      set('tail', [0, 0, 0, .9, w * .4]); eyes = 0; tongueOut = 1;
    } else {   // 站著
      set('torso', [0, breathe]); set('head', [0, breathe * .5, 0, 0, Math.sin(t * .7) * .12, Math.sin(t * .43) * .05]); set('tail', [0, 0, 0, 0, Math.sin(t * 2.2) * .22]);
    }
    return {o, eyes, tongueOut};
  }
  function update(pose, now, dist = 0){
    const t = now / 1000, dt = last ? Math.min(.1, (now - last) / 1000) : 0; last = now;
    const name = pose === 'walkA' || pose === 'walkB' ? 'walk' : pose;
    if (name === 'walk') ph += Math.min(dist, .5) * 6.5 + (dist < .001 ? dt * 9 : 0);
    else if (name === 'run') ph += Math.min(dist, .8) * 2.3 + (dist < .001 ? dt * 16 : 0);
    const {o, eyes, tongueOut} = target(name, t), snap = !dt;
    const k = snap ? 1 : 1 - Math.exp(-dt * (name === 'walk' || name === 'run' ? 22 : 11));
    for (const key of keys) {
      const c = cur[key], v = o[key], n = nodes[key], r = key === 'roll' ? rest : n.userData.rest;
      for (let i = 0; i < 6; i++) c[i] += (v[i] - c[i]) * k;
      n.position.set(r.x + c[0], r.y + c[1], r.z + c[2]); n.rotation.set(c[3], c[4], c[5]);
      if (key.length === 2) { c[6] = (c[6] || 1) + ((v[6] || 1) - (c[6] || 1)) * k; n.scale.y = c[6]; }
    }
    const blink = eyes === 1 && (t + (id.length * 1.3)) % 4.2 < .13;
    lids += ((blink ? 0 : eyes) - lids) * (snap ? 1 : Math.min(1, dt * 28));
    eyesO.visible = lids > .2; eyesC.visible = !eyesO.visible; eyesO.scale.y = Math.max(.2, lids);
    tOut += (tongueOut - tOut) * (snap ? 1 : Math.min(1, dt * 12)); tng.visible = tOut > .05; tng.scale.setScalar(.4 + .6 * tOut);
    for (const [e, s] of ears) e.rotation.set(name === 'run' ? -.4 : 0, 0, name === 'run' && id === 'dog1' ? s * .7 : name === 'sleep' ? -s * .1 : Math.sin(t * 1.3 + s) > .985 ? s * .14 : 0);
  }
  update('stand', 0);
  return {group, update};
}

// 辦公室寵物的立體模型（三花貓 cat、虎斑貓 cat2、臘腸狗 dog1、薩摩耶 dog2）。
// 外形照原圖站姿三視圖逐段量出來（程式建模、沒有模型檔）；花紋與五官直接取用原圖：assets/pets3d/<id>.webp
// （由 models/pets/build_pet_textures.py 產生），依每個面的朝向混合正面／側面／背面三張圖。外框是沿法線外推的背面。
// 量測座標＝三視圖縮成 1600 px 寬時的像素：u 橫向、v 向下；模型單位 = 200 px，面朝 +Z、腳底 y=0。
// makePet() 回傳 {group, update(姿勢, 毫秒, 移動距離)}。

const PX = 200, ATLAS = 1780;
// gy 腳底、fx 正面中線、sz 側面原點（要和貼圖腳本一致）
const REF = {
  cat:{gy:507, fx:319, sz:770, scale:.42, ink:0x351a10, line:16},
  cat2:{gy:505, fx:319, sz:760, scale:.42, ink:0x3c2216, line:16},
  dog1:{gy:432, fx:265, sz:790, scale:.61, ink:0x351c0c, line:11},
  dog2:{gy:464, fx:278, sz:800, scale:.61, ink:0x431f0a, line:11},
};
// body＝沿前後方向 [u, 上緣 v, 下緣 v, 半寬]；head／mane＝沿上下方向 [v, 後緣 u, 前緣 u, 半寬]
const SHAPE = {
  cat:{"white":1,"head":[[83.2,901.9,912.5,6.2],[84.3,891.2,919.6,21.3],[87.4,874.3,928.5,42.6],[92.7,855.7,939.2,60.4],[103.4,833.5,950.7,81.7],[116.7,805.1,959.6,98.6],[130.0,791.8,966.7,108.3],[147.8,782.4,974.7,116.3],[165.6,780.2,980.9,121.7],[183.3,782.9,984.5,123.9],[198.9,788.2,986.2,123.0],[214.4,798.9,985.3,116.3],[227.7,814.0,978.2,105.7],[241.0,842.4,966.7,89.7],[252.1,866.3,952.5,71.9],[261.0,892.1,937.4,48.0],[266.8,909.0,924.1,25.8]],"body":[[581.3,303.2,367.6,50.5],[595.5,268.6,396.4,78.8],[619.0,244.6,407.5,97.0],[652.3,228.6,413.3,108.3],[696.7,221.5,413.3,109.9],[741.1,222.4,418.6,105.9],[785.5,227.7,420.9,101.8],[825.5,225.5,418.6,97.0],[865.5,231.3,409.8,92.1],[909.9,252.6,396.4,82.4],[926.7,267.7,390.2,72.7],[936.5,281.9,381.3,59.8],[942.3,293.4,373.4,46.1],[945.8,305.9,362.7,29.9],[947.6,318.3,351.2,13.7]],"pivot":{"head":[174.4,891.2],"body":[321.0,761.1]},"front":{"x":38.2,"u":852.1,"top":338.7,"r":[42.6,33.7,31.1],"path":[851.3,853.0,860.1,869.9],"bottom":1},"hind":{"x":66.6,"u":625.7,"top":343.2,"r":[46.6,32.0,27.5],"path":[654.6,617.7,614.6,631.0],"thigh":[645.7,336.5,66.6,75.5,42.2]},"paw":[42.2,21.3,34.6],"ear":{"base":[253,121,849.9],"tip":[211,43,864.6],"w":46,"d":34,"turn":0.62},"tail":{"pts":[[639.0,272.1],[602.6,238.8],[581.3,198.9],[577.7,157.6],[590.2,118.9],[620.4,91.0],[657.7,80.3]],"r":[31.1,35.5,38.2,37.3,33.7,28.4,24.0]},"eyeAt":[46,163,24.5,25.5],"muzzleAt":[214.4,47.1,24.9],"faceMap":[[2.125,1.72,1.51,1.375,1.225],[82,163,205,232,262]],"collar":[879.7,87.0,248.1,31.1,92.4,297.9,23.1],"nose":[14254190,16643304],"eyes":[[272,162,27,28],[368,162,27,28]],"muzzlePatch":[319,213,42,28],"art":{"torso":[-0.612,0.393,-1.015,0.612,1.449,0.995],"head":[-0.637,1.225,0.138,0.637,2.18,1.275],"ear+":[0.186,1.706,0.363,0.65,2.352,0.684],"ear-":[-0.65,1.706,0.363,-0.186,2.352,0.684],"tail":[-0.18,0.944,-1.127,0.18,2.215,-0.439],"legFL":[0.015,0.001,0.34,0.415,0.982,0.82],"legFR":[-0.415,0.001,0.34,-0.015,0.982,0.82],"legBL":[0.111,0.001,-0.98,0.58,1.014,-0.36],"legBR":[-0.58,0.001,-0.98,-0.111,1.014,-0.36]}},
  cat2:{"white":1,"head":[[83.2,901.9,912.5,6.2],[84.3,891.2,919.6,21.3],[87.4,874.3,928.5,42.6],[92.7,855.7,939.2,60.4],[103.4,833.5,950.7,81.7],[116.7,805.1,959.6,98.6],[130.0,791.8,966.7,108.3],[147.8,782.4,974.7,116.3],[165.6,780.2,980.9,121.7],[183.3,782.9,984.5,123.9],[198.9,788.2,986.2,123.0],[214.4,798.9,985.3,116.3],[227.7,814.0,978.2,105.7],[241.0,842.4,966.7,89.7],[252.1,866.3,952.5,71.9],[261.0,892.1,937.4,48.0],[266.8,909.0,924.1,25.8]],"body":[[581.3,303.2,367.6,50.5],[595.5,268.6,396.4,78.8],[619.0,244.6,407.5,97.0],[652.3,228.6,413.3,108.3],[696.7,221.5,413.3,109.9],[741.1,222.4,418.6,105.9],[785.5,227.7,420.9,101.8],[825.5,225.5,418.6,97.0],[865.5,231.3,409.8,92.1],[909.9,252.6,396.4,82.4],[926.7,267.7,390.2,72.7],[936.5,281.9,381.3,59.8],[942.3,293.4,373.4,46.1],[945.8,305.9,362.7,29.9],[947.6,318.3,351.2,13.7]],"pivot":{"head":[174.4,891.2],"body":[321.0,761.1]},"front":{"x":38.2,"u":852.1,"top":338.7,"r":[42.6,33.7,31.1],"path":[851.3,853.0,860.1,869.9],"bottom":1},"hind":{"x":66.6,"u":625.7,"top":343.2,"r":[46.6,32.0,27.5],"path":[654.6,617.7,614.6,631.0],"thigh":[645.7,336.5,66.6,75.5,42.2]},"paw":[42.2,21.3,34.6],"ear":{"base":[253,121,849.9],"tip":[211,43,864.6],"w":46,"d":34,"turn":0.62},"tail":{"pts":[[639.0,272.1],[602.6,238.8],[581.3,198.9],[577.7,157.6],[590.2,118.9],[620.4,91.0],[657.7,80.3]],"r":[31.1,35.5,38.2,37.3,33.7,28.4,24.0]},"eyeAt":[46,161,24.5,25.5],"muzzleAt":[214.4,47.1,24.9],"faceMap":[[2.125,1.72,1.51,1.375,1.225],[86,178,215,238,264]],"collar":[879.7,87.0,248.1,31.1,92.4,297.9,23.1],"nose":[13994876,16245700],"eyes":[[273,178,27,28],[368,178,27,28]],"muzzlePatch":[320,224,40,28],"art":{"torso":[-0.561,0.404,-0.785,0.561,1.316,0.935],"head":[-0.635,1.19,0.148,0.635,2.17,1.255],"ear+":[0.198,1.701,0.343,0.64,2.311,0.652],"ear-":[-0.64,1.701,0.343,-0.198,2.311,0.652],"tail":[-0.2,0.106,-1.308,0.2,1.109,-0.465],"legFL":[0.015,0.001,0.29,0.415,0.972,0.77],"legFR":[-0.415,0.001,0.29,-0.015,0.972,0.77],"legBL":[0.111,0.001,-0.87,0.58,1.004,-0.25],"legBR":[-0.58,0.001,-0.87,-0.111,1.004,-0.25]}},
  dog1:{
    head:[[86,892,978,42],[100,870,998,62],[125,852,1012,76],[155,840,1018,84],[190,836,1010,86],[215,842,990,80],[240,855,975,64],[256,880,950,40]],
    muzzle:[[955,184,246,50],[985,187,245,48],[1010,192,238,40],[1030,195,228,28],[1046,200,217,13]],
    body:[[608,338,385,32],[630,296,396,66],[670,258,396,84],[720,254,392,80],[770,264,392,76],[820,260,396,78],[870,258,402,86],[920,266,398,80],[955,285,380,56],[978,315,350,26]],
    chest:[936,328,50,70,70], pivot:{head:[170,925], body:[330,790]},
    front:{x:50, u:882, top:352, r:[32,28,28]}, hind:{x:56, u:652, top:350, r:[34,28,28], thigh:[662,362,56,48,40]}, paw:[42,20,34],
    tail:{pts:[[628,305],[590,303],[555,276],[541,232],[562,194],[600,184]], r:[26,40,45,38,24,8]},
    eyes:[[222,187,17,23],[309,187,17,23]], muzzlePatch:[265,229,34,28],
  },
  dog2:{
    head:[[95,855,925,45],[110,832,948,72],[135,812,962,92],[165,795,975,104],[200,785,975,108],[235,790,965,100],[260,805,950,86],[280,830,930,58]],
    muzzle:[[940,158,226,50],[965,162,216,44],[988,167,204,30],[1003,170,192,13]],
    mane:[[150,800,925,78],[175,780,935,108],[200,766,940,130],[240,762,952,148],[290,770,978,152],[330,776,968,136],[365,800,948,106],[392,840,915,58]],
    body:[[625,310,390,48],[650,268,402,94],[700,250,405,106],[750,248,396,102],[800,248,396,100],[850,248,390,100],[890,262,385,86],[914,300,375,54]],
    pivot:{head:[185,885], body:[322,765]},
    front:{x:66, u:860, top:345, r:[42,36,36]}, hind:{x:66, u:668, top:345, r:[44,36,36], thigh:[668,368,62,70,48]}, paw:[46,23,38],
    ear:{base:[220,135,866], tip:[213,56,872], w:42, d:26},
    tail:{pts:[[668,322],[620,292],[597,230],[624,178],[688,162],[734,190]], r:[40,62,74,66,50,26], x:[0,0,0,4,10,16]},
    eyes:[[239,162,15,17],[318,162,15,17]], muzzlePatch:[279,207,52,46],
  },
};

export function makePet(THREE, utils, id, hullLayer, {ready = null, fail = null} = {}){
  const R = REF[id], A = SHAPE[id]; if (!R || !A) return null;
  const {mergeGeometries} = utils, V = (x, y, z) => new THREE.Vector3(x, y, z), C = h => new THREE.Color(h);
  const clamp = (v, a = 0, b = 1) => Math.min(b, Math.max(a, v)), sm = (a, b, v) => { const t = clamp((v - a) / (b - a)); return t * t * (3 - 2 * t); };
  const Y = v => (R.gy - v) / PX, Z = u => (u - R.sz) / PX, X = u => (u - R.fx) / PX;
  const INK = R.line / PX, isCat = !id.startsWith('dog');

  const atlas = new THREE.TextureLoader().load(new URL('assets/pets3d/' + id + '.webp?v=8', import.meta.url).href, () => { group.visible = true; ready && ready(); }, undefined, () => fail && fail());
  atlas.colorSpace = THREE.SRGBColorSpace; atlas.anisotropy = 4;
  // 身體材質：依面的朝向混合三視圖（aK＝正面、側面、背面的權重倍數；w=1 表示改用單色 aCol）
  const skin = new THREE.MeshBasicMaterial({map:atlas});
  skin.onBeforeCompile = sh => {
    const vary = 'varying vec3 vRest; varying vec3 vRestN; varying vec4 vK; varying vec3 vSolid;\n';
    sh.vertexShader = vary + 'attribute vec3 aRest; attribute vec3 aN; attribute vec4 aK; attribute vec3 aCol;\n' + sh.vertexShader.replace('#include <begin_vertex>', '#include <begin_vertex>\n vRest = aRest; vRestN = aN; vK = aK; vSolid = aCol;');
    sh.fragmentShader = vary + sh.fragmentShader.replace('#include <map_fragment>', `
      vec3 n = normalize(vRestN);
      float ty = 1.0 - (500.0 - vRest.y * 200.0) / 520.0;
      vec3 cF = texture2D(map, vec2((200.0 + vRest.x * 200.0) / ${ATLAS}.0, ty)).rgb;
      vec3 cS = texture2D(map, vec2((690.0 + vRest.z * 200.0) / ${ATLAS}.0, ty + (1.0 - step(0.001, vK.w)) * vSolid.x * 200.0 / 520.0)).rgb;
      vec3 cB = texture2D(map, vec2((1180.0 - vRest.x * 200.0) / ${ATLAS}.0, ty)).rgb;
      vec3 w = vec3(pow(max(n.z, 0.0) * vK.x, 5.0), pow(abs(n.x) * vK.y, 5.0) + 0.00002, pow(max(-n.z, 0.0) * vK.z, 5.0));
      vec3 art = (cF * w.x + cS * w.y + cB * w.z) / (w.x + w.y + w.z);
      diffuseColor.rgb *= mix(art, vSolid, vK.w) * (1.0 - 0.07 * max(-n.y, 0.0));`);
  };
  skin.customProgramCacheKey = () => 'pet-skin';
  const decal = new THREE.MeshBasicMaterial({map:atlas, side:THREE.DoubleSide});   // 眼睛、口鼻：直接貼正面原圖
  const flat = new THREE.MeshBasicMaterial({vertexColors:true}), inkMat = new THREE.MeshBasicMaterial({color:R.ink, side:THREE.BackSide});
  // 外框往鏡頭後方退一點：保留外輪廓，蓬毛零件交疊處不會冒出雜線
  const sink = id === 'dog2' ? .16 : id === 'dog1' ? .06 : A.white ? .11 : .045;
  inkMat.onBeforeCompile = sh => { sh.vertexShader = sh.vertexShader.replace('#include <project_vertex>', `#include <project_vertex>\n if (isOrthographic) mvPosition.z -= ${sink.toFixed(3)}; else mvPosition.xyz += normalize(mvPosition.xyz) * ${sink.toFixed(3)}; gl_Position = projectionMatrix * mvPosition;`); };
  inkMat.customProgramCacheKey = () => 'pet-ink' + sink;

  // ───── 幾何 ─────
  function fromRings(rings){   // rings：每圈同樣點數；兩端收成一點
    const n = rings[0].length, pos = [], idx = [];
    const mid = r => r.reduce((a, p) => a.add(p), V(0, 0, 0)).divideScalar(r.length);
    for (const r of rings) for (const p of r) pos.push(p.x, p.y, p.z);
    for (let i = 0; i < rings.length - 1; i++) for (let j = 0; j < n; j++) { const a = i * n + j, b = i * n + (j + 1) % n; idx.push(a, b, a + n, b, b + n, a + n); }
    for (const [i, flip] of [[0, true], [rings.length - 1, false]]) {
      const c = mid(rings[i]), k = pos.length / 3; pos.push(c.x, c.y, c.z);
      for (let j = 0; j < n; j++) { const a = i * n + j, b = i * n + (j + 1) % n; flip ? idx.push(k, b, a) : idx.push(k, a, b); }
    }
    let vol = 0; const P = i => V(pos[i * 3], pos[i * 3 + 1], pos[i * 3 + 2]);
    for (let i = 0; i < idx.length; i += 3) vol += P(idx[i]).dot(P(idx[i + 1]).cross(P(idx[i + 2])));
    if (vol < 0) for (let i = 0; i < idx.length; i += 3) [idx[i + 1], idx[i + 2]] = [idx[i + 2], idx[i + 1]];
    const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); g.setIndex(idx); g.computeVertexNormals(); return g;
  }
  const spline = (rows, t) => { const m = rows.length - 1, x = t * m, i = Math.min(m - 1, x | 0), f = x - i;
    return rows[0].map((_, k) => { const a = rows[Math.max(0, i - 1)][k], b = rows[i][k], c = rows[i + 1][k], d = rows[Math.min(m, i + 2)][k];
      return .5 * (2 * b + (c - a) * f + (2 * a - 5 * b + 4 * c - d) * f * f + (3 * b - a - 3 * c + d) * f * f * f); }); };
  const pw = (v, e) => Math.sign(v) * Math.pow(Math.abs(v), e);
  function loft(axis, rows, {n = 44, sides = 48, power = 2.25, bump = null, cx = 0} = {}){
    const rings = [], ring = (r, k, shift) => Array.from({length:sides}, (_, j) => {
      const a = j / sides * Math.PI * 2, c = pw(Math.cos(a), 2 / power), s = pw(Math.sin(a), 2 / power), b = (bump ? bump(a, k) : 1);
      if (axis === 'z') { const y0 = Y(r[1]), y1 = Y(r[2]), z = Z(r[0]) + shift, w = r[3] / PX; return V(cx + c * w * b, (y0 + y1) / 2 + s * (y0 - y1) / 2 * b, z); }
      const z0 = Z(r[1]), z1 = Z(r[2]), w = r[3] / PX; return V(cx + c * w * b, Y(r[0]) + shift, (z0 + z1) / 2 + s * (z1 - z0) / 2 * b);
    });
    const shrink = (r, f) => axis === 'z' ? [r[0], r[1] + (r[2] - r[1]) * (1 - f) / 2, r[2] - (r[2] - r[1]) * (1 - f) / 2, r[3] * f] : [r[0], r[1] + (r[2] - r[1]) * (1 - f) / 2, r[2] - (r[2] - r[1]) * (1 - f) / 2, r[3] * f];
    const dir = axis === 'z' ? Math.sign(rows[rows.length - 1][0] - rows[0][0]) : -Math.sign(rows[rows.length - 1][0] - rows[0][0]);
    for (const [f, d] of [[.45, .045], [.78, .028]]) rings.push(ring(shrink(rows[0], f), 0, -dir * d * (A.white ? .12 : 1)));
    for (let i = 0; i <= n; i++) rings.push(ring(spline(rows, i / n), i / n, 0));
    for (const [f, d] of [[.78, .028], [.45, .045]]) rings.push(ring(shrink(rows[rows.length - 1], f), 1, dir * d * (A.white ? .12 : 1)));
    return fromRings(rings);
  }
  function tube(pts, radii, {n = 30, sides = 24, bump = null} = {}){   // pts：模型座標
    const curve = new THREE.CatmullRomCurve3(pts), fr = curve.computeFrenetFrames(n, false);
    const rad = f => { const x = f * (radii.length - 1), k = Math.min(radii.length - 2, x | 0); return radii[k] + (radii[k + 1] - radii[k]) * (x - k); };
    const rings = [], ring = (i, off, k) => { const f = i / n, at = curve.getPointAt(f).addScaledVector(fr.tangents[i], off);
      return Array.from({length:sides}, (_, j) => { const a = j / sides * Math.PI * 2, r = rad(f) * k * (bump ? bump(a, f) : 1);
        return at.clone().addScaledVector(fr.normals[i], Math.cos(a) * r).addScaledVector(fr.binormals[i], Math.sin(a) * r); }); };
    for (const [d, k] of [[.85, .5], [.5, .86]]) rings.push(ring(0, -rad(0) * d, k));
    for (let i = 0; i <= n; i++) rings.push(ring(i, 0, 1));
    for (const [d, k] of [[.5, .86], [.85, .5]]) rings.push(ring(n, rad(1) * d, k));
    return fromRings(rings);
  }
  const oval = (x, y, z, rx, ry, rz, {seg = 32, bump = null} = {}) => {   // 橢球（模型座標）
    const rings = [];
    for (let i = 1; i < seg * .7; i++) { const t = i / (seg * .7) * Math.PI - Math.PI / 2;
      rings.push(Array.from({length:seg}, (_, j) => { const a = j / seg * Math.PI * 2, b = bump ? bump(a, i / (seg * .7)) : 1; return V(x + Math.cos(t) * Math.cos(a) * rx * b, y + Math.sin(t) * ry * b, z + Math.cos(t) * Math.sin(a) * rz * b); })); }
    return fromRings(rings);
  };
  const tufts = (amp, k = 9) => (a, t) => 1 + amp * (Math.pow(Math.abs(Math.sin(a * k / 2 + t * 7)), .5) * Math.pow(Math.abs(Math.sin(t * 17 + a)), .35) - .45);   // 蓬毛：輪廓一撮一撮

  // ───── 骨架：每根骨頭收集自己的零件，最後合併 ─────
  const bones = [];
  function bone(parent, at, name){
    const g = new THREE.Group(); g.name = name; g.userData = {at, skin:[], solid:[], ink:[]};
    const pa = parent.userData.at || [0, 0, 0]; g.position.set(at[0] - pa[0], at[1] - pa[1], at[2] - pa[2]);
    g.userData.rest = g.position.clone(); parent.add(g); bones.push(g); return g;
  }
  const local = (b, geo) => { const a = b.userData.at; return geo.clone().applyMatrix4(new THREE.Matrix4().makeTranslation(-a[0], -a[1], -a[2])); };
  function outline(b, geo){
    const p = geo.attributes.position, nr = geo.attributes.normal, a = new Float32Array(p.count * 3);
    for (let i = 0; i < p.count; i++) a.set([p.getX(i) + nr.getX(i) * INK, p.getY(i) + nr.getY(i) * INK, p.getZ(i) + nr.getZ(i) * INK], i * 3);
    const h = new THREE.BufferGeometry(); h.setAttribute('position', new THREE.BufferAttribute(a, 3)); h.setIndex(geo.index.clone()); b.userData.ink.push(local(b, h));
  }
  function paint(b, geo, k, {line = true, color = null, map = null} = {}){   // 貼原圖（k＝[正,側,背] 權重）或單色／漸層（color）
    const p = geo.attributes.position, nr = geo.attributes.normal, ak = new Float32Array(p.count * 4), col = new Float32Array(p.count * 3), v = V(0, 0, 0), n = V(0, 0, 0);
    for (let i = 0; i < p.count; i++) {
      ak.set([...(k || [0, 0, 0]), color != null ? 1 : 0], i * 4);
      if (color != null) { v.fromBufferAttribute(p, i); n.fromBufferAttribute(nr, i); const c = typeof color === 'function' ? color(v, n) : C(color); col.set([c.r, c.g, c.b], i * 3); }
    }
    if (line) outline(b, geo);
    const rest = p.clone(); if (map) for (let i = 0; i < rest.count; i++) { map(v.fromBufferAttribute(rest, i)); rest.setXYZ(i, v.x, v.y, v.z); }
    const g = local(b, geo); g.setAttribute('aRest', rest); g.setAttribute('aN', nr.clone()); g.setAttribute('aK', new THREE.BufferAttribute(ak, 4)); g.setAttribute('aCol', new THREE.BufferAttribute(col, 3));
    b.userData.skin.push(g);
  }
  function ink(b, geo, color){   // 純色小零件（閉眼線、舌頭）
    const p = geo.attributes.position, col = new Float32Array(p.count * 3), c = C(color); for (let i = 0; i < p.count; i++) col.set([c.r, c.g, c.b], i * 3);
    const g = local(b, geo); g.deleteAttribute('normal'); g.setAttribute('color', new THREE.BufferAttribute(col, 3)); b.userData.solid.push(g);
  }

  // 薩摩耶的身體、胸毛只能取原圖嘴巴以下的毛（否則臉會印在身上，趴下時看到第二張臉）
  const furBelow = id === 'dog2' ? p => p.setY(Math.min(p.y, Y(290))) : null;
  const maneMap = id === 'dog2' ? p => p.setY(Y(290 + clamp((R.gy - p.y * PX - 150) / 242) * 102)) : null;

  const group = new THREE.Group(); group.visible = false;
  const [hv, hu] = A.pivot.head, [bv, bu] = A.pivot.body;
  const hy = Y(hv), hz = Z(hu), by = Y(bv), bz = Z(bu);
  const hw = Math.max(...A.head.map(r => r[3])) / PX, hh = (A.head[A.head.length - 1][0] - A.head[0][0]) / PX / 2, hd = (hu - A.head[3][1]) / PX;
  const S = {scale:R.scale, head:[0, hy, hz], hr:[hw, hh, hd], body:[0, by, bz], br:[Math.max(...A.body.map(r => r[3])) / PX, (Math.max(...A.body.map(r => r[2])) - Math.min(...A.body.map(r => r[1]))) / PX / 2, 0],
    legF:[A.front.x / PX, Y(A.front.top), Z(A.front.u)], legB:[A.hind.x / PX, Y(A.hind.top), Z(A.hind.u)], lr:A.front.r[1] / PX};
  const [rx, ry, rz] = S.hr, br = S.br;
  const roll = new THREE.Group(); roll.position.set(0, by, bz); roll.userData = {at:[0, by, bz]}; group.add(roll);
  const torso = bone(roll, [0, by, bz], 'torso');
  const head = bone(torso, [0, hy - ry * .62, hz - rz * .25], 'head');
  const tp = A.tail.pts.map((p, i) => V((A.tail.x ? A.tail.x[i] : 0) / PX, Y(p[1]), Z(p[0])));
  const tail = bone(torso, [0, tp[0].y, tp[0].z], 'tail');
  const legs = {}; for (const [k, L, sx] of [['FL', S.legF, 1], ['FR', S.legF, -1], ['BL', S.legB, 1], ['BR', S.legB, -1]]) legs[k] = bone(roll, [L[0] * sx, L[1], L[2]], 'leg' + k);
  const fluffy = id === 'dog2';

  // ───── 身體 ─────
  paint(torso, loft('z', A.body, {n:48, sides:fluffy ? 72 : 48, bump:fluffy ? tufts(.07) : id === 'dog1' ? (a, t) => 1 + (Math.sin(a) < -.5 ? .07 * Math.abs(Math.sin(t * 26)) : 0) : null}), [.85, 1.35, 1], {map:furBelow});
  if (A.chest) { const [u, v, d, h, w] = A.chest; paint(torso, oval(0, Y(v), Z(u), w / PX, h / PX, d / PX, {seg:44, bump:id === 'dog1' ? tufts(.09, 11) : null}), [1.5, 1, 0], {line:id === 'dog1'}); }
  if (A.mane) paint(torso, loft('y', A.mane, {n:56, sides:84, power:2.1, bump:tufts(.1, 11)}), [1.15, 1, 1], {map:maneMap});

  for (const k in legs) {
    const front = k[0] === 'F', L = front ? A.front : A.hind, sx = k[1] === 'L' ? 1 : -1, x = sx * L.x / PX, [pl, ph, pwid] = A.paw;
    if (L.thigh) { const [u, v, d, h, w] = L.thigh; paint(legs[k], oval(x * .92, Y(v), Z(u), w / PX, h / PX, d / PX, {bump:fluffy ? tufts(.07) : null}), [.8, 1.3, 1], {line:fluffy}); }
    const lu = L.path || [L.u, L.u - (front ? 2 : 10), L.u + 4, L.u + 12];
    paint(legs[k], tube([V(x, Y(L.top), Z(lu[0])), V(x, Y((L.top + R.gy) / 2), Z(lu[1])), V(x, Y(R.gy - ph * 1.5), Z(lu[2]))], L.r.map(r => r / PX), {bump:fluffy ? tufts(.05, 7) : null}), [1, 1.2, 1]);
    paint(legs[k], oval(x, Y(R.gy - ph), Z(lu[3]), pwid / PX, ph / PX, pl / PX), [1.25, 1.1, 1]);
    if (A.white) for (const t of [-.36, 0, .36]) { const arc = [.05, .3, .55, .8].map(e => V(x + t * pwid / PX * Math.cos(e) * 1.02, Y(R.gy - ph) + Math.sin(e) * ph / PX * 1.03, Z(lu[3]) + Math.sqrt(1 - t * t) * Math.cos(e) * pl / PX * 1.02));
      ink(legs[k], tube(arc, [.004, .008, .007, .003], {n:12, sides:6}), R.ink); }
  }

  // ───── 尾巴 ─────
  const tg = tube(tp, A.tail.r.map(r => r / PX), {n:48, sides:fluffy ? 56 : 28, bump:fluffy ? tufts(.1, 9) : id === 'dog1' ? tufts(.14, 5) : null});
  if (id === 'dog1') paint(tail, tg, null, {color:(v, n) => C(0xa65a34).lerp(C(0xfbbd7c), sm(.15, -.55, n.y - n.z * .5 + Math.sin(v.y * 31 + v.z * 23) * .22))});
  else if (id === 'dog2') paint(tail, tg, null, {color:(v, n) => C(0xfbf5f1).lerp(C(0xe2d3d1), sm(.45, .95, Math.sin(v.y * 19 + v.z * 13 + Math.sin(v.x * 23) * 1.5)) * .55 + sm(.2, -.8, n.y) * .6)});
  else paint(tail, tg, [0, 1, 0]);

  // ───── 頭、耳朵 ─────
  const headGeo = [loft('y', [...A.head].reverse(), {n:A.white ? 110 : 48, sides:A.white ? 144 : 64, power:A.white ? 2.05 : isCat ? 2.35 : 2.15})];
  const bump = (x, y, cx, cy, rx, ry) => Math.exp(-(((x - cx) / rx) ** 2 + ((y - cy) / ry) ** 2));
  if (A.white) { const p = headGeo[0].attributes.position;   // 嘴邊、鼻梁、下巴：同一顆頭上的柔和隆起
    for (let i = 0; i < p.count; i++) { const x = p.getX(i), y = p.getY(i), z = p.getZ(i), f = sm(.7, 1.0, z); if (!f) continue;
      const pad = 1 - (1 - bump(x, y, .095, 1.43, .12, .098)) * (1 - bump(x, y, -.095, 1.43, .12, .098));
      const socket = sm(.06, .36, Math.abs(x)) * Math.exp(-(((y - 1.72) / .17) ** 2));
      p.setZ(i, z + f * (.108 * pad + .05 * bump(x, y, 0, 1.505, .075, .068) + .03 * bump(x, y, 0, 1.32, .12, .07) - .072 * socket)); }
    headGeo[0].computeVertexNormals(); }
  paint(head, headGeo[0], [1.55, 1, 1]);
  if (A.white) {   // 臉的範圍只用正面原圖（混到側面圖會出現兩層鼻嘴）
    const k = head.userData.skin[head.userData.skin.length - 1].attributes.aK, p = headGeo[0].attributes.position;
    for (let i = 0; i < p.count; i++) { if (p.getZ(i) < .7) continue; const nz = headGeo[0].attributes.normal.getZ(i), near = (1 - sm(.85, 1.3, Math.hypot(p.getX(i) / .36, (p.getY(i) - 1.48) / .29))) * sm(.7, .9, p.getZ(i)), w = near * sm(.5, .85, nz);
      k.setX(i, 1.55 + 5 * w); k.setY(i, 1 - .88 * w);
      head.userData.skin[head.userData.skin.length - 1].attributes.aCol.setX(i, .075 * Math.exp(-(((p.getY(i) - 1.45) / .16) ** 2)) * sm(.65, .95, p.getZ(i))); } }
  if (A.muzzle) { headGeo.push(loft('z', A.muzzle, {n:24, sides:36, power:2.1})); paint(head, headGeo[1], [1.2, 1, 0]); }
  if (A.pads) { const [u, v, dx, w, h, d] = A.pads; for (const s of [1, -1]) { const g = oval(s * dx / PX, Y(v), Z(u), w / PX, h / PX, d / PX, {seg:36}); headGeo.push(g); paint(head, g, [1.4, 1, 0]);
    // 嘴邊肉下緣的圓弧嘴線（往外側微微上勾），側面才看得出兩團圓嘴
    const arc = (A.white ? [[.35, -.72], [.62, -.66], [.9, -.52], [1.15, -.34], [1.35, -.14]] : [[.42, -.66], [.7, -.64], [.98, -.54], [1.24, -.36], [1.42, -.16]]).map(([az, el]) => V(s * (dx + Math.sin(az) * Math.cos(el) * w * 1.04) / PX, Y(v) + Math.sin(el) * h * 1.04 / PX, Z(u) + Math.cos(az) * Math.cos(el) * d * 1.04 / PX));
    if (!A.white) ink(head, tube(arc, [.005, .011, .012, .01, .004], {n:20, sides:8}), R.ink); } }
  const ears = [];
  for (const s of [1, -1]) {
    if (id === 'dog1') {   // 垂耳：[v, 後緣 u, 前緣 u, 半寬, 正面圖左耳中心 u]
      const rows = [[318,848,878,9,172],[298,816,908,30,161],[250,801,942,45,150],[200,808,945,45,153],[150,826,938,36,168],[122,846,922,20,188]];
      const e = bone(head, [s * .4, Y(140), Z(885)], 'ear'); ears.push([e, s]);
      const g = loft('y', rows.map(r => r.slice(0, 4)), {n:40, sides:40, power:2.2, bump:tufts(.07, 5)});
      const p = g.attributes.position; for (let i = 0; i < p.count; i++) { const v = R.gy - p.getY(i) * PX; let j = 0; while (j < rows.length - 2 && v < rows[j + 1][0]) j++; const a = rows[j], b = rows[j + 1], t = clamp((a[0] - v) / (a[0] - b[0])); p.setX(i, p.getX(i) - s * X(a[4] + (b[4] - a[4]) * t) * 1); }
      if (s < 0) { /* 右耳在 +x 側 */ } g.computeVertexNormals(); paint(e, g, [1, 1.3, 1]);
    } else {
      const E = A.ear, base = V(s * X(E.base[0]) * 1, Y(E.base[1]), Z(E.base[2])), tip = V(s * X(E.tip[0]) * 1, Y(E.tip[1]), Z(E.tip[2]));
      base.x = -s * X(E.base[0]); tip.x = -s * X(E.tip[0]);
      const e = bone(head, [base.x, base.y, base.z], 'ear'); ears.push([e, s]);
      const ax = tip.clone().sub(base), side = ax.clone().cross(V(0, 0, 1)).normalize(), dep = side.clone().cross(ax).normalize(), turn = ax.clone().normalize(), rings = [];
      side.applyAxisAngle(turn, s * (E.turn || .55)); dep.applyAxisAngle(turn, s * (E.turn || .55));   // 耳朵朝外轉一點，側面看才有寬度
      for (let i = 0; i <= 18; i++) { const t = -.3 + 1.3 * i / 18, k = clamp(t), w = E.w / PX * (A.white ? Math.max(.14, Math.pow(1 - Math.pow(k, 1.75), .82)) : 1 - .88 * Math.pow(k, 1.45)), d = E.d / PX * (1 - .72 * k), at = base.clone().addScaledVector(ax, t);
        rings.push(Array.from({length:32}, (_, j) => { const a = j / 32 * Math.PI * 2, hollow = Math.sin(a) * (dep.z > 0 ? 1 : -1) > 0 ? .55 : 1; let z = Math.sin(a) * hollow;
          if (A.white) { const c2 = Math.cos(a) ** 2, facing = Math.sin(a) * (dep.z > 0 ? 1 : -1); z = facing > 0 ? Math.sign(dep.z) * (1.5 * c2 * (1 - c2) - .42 * (1 - c2) ** 2) * Math.min(1, (1 - k) * 2.5) : Math.sin(a); }
          return at.clone().addScaledVector(side, Math.cos(a) * w).addScaledVector(dep, z * d); })); }
      paint(e, fromRings(rings), [1.5, .45, 1.2]);
    }
  }

  // ───── 眼睛、口鼻：沿著頭的表面貼原圖 ─────
  const probe = headGeo.map(g => new THREE.Mesh(g, new THREE.MeshBasicMaterial({side:THREE.DoubleSide}))), ray = new THREE.Raycaster();
  const front = (x, y) => { ray.set(V(x, y, 20), V(0, 0, -1)); const h = ray.intersectObjects(probe, false)[0]; return h ? h.point.z : null; };
  // yaw：貼片沿哪個水平方向貼到頭上（眼睛朝外斜一點，側面才看得到）
  function patch(b, [su, sv, qu, qv], lift, yaw = 0, shift = 0, at = null){
    const [cu, cv, pu, pv] = at || [su, sv, qu, qv];
    const rings = 8, seg = 36, pos = [], uv = [], idx = [], cx = X(cu + shift), c = V(cx, Y(cv), front(cx, Y(cv)) ?? hz + rz);
    const d = V(Math.sin(yaw), 0, Math.cos(yaw)), t = V(Math.cos(yaw), 0, -Math.sin(yaw)), wide = 1 / Math.sqrt(Math.cos(yaw));
    for (let i = 0; i <= rings; i++) for (let j = 0; j < seg; j++) {
      const k = i / rings, a = j / seg * Math.PI * 2, du = Math.cos(a) * pu * k, dv = Math.sin(a) * pv * k, q = c.clone().addScaledVector(t, du * wide / PX); q.y = Y(cv + dv);
      ray.set(q.clone().addScaledVector(d, 3), d.clone().negate()); const h = ray.intersectObjects(probe, false)[0]?.point || q;
      pos.push(h.x + d.x * lift, h.y, h.z + d.z * lift); const au = su + Math.cos(a) * (at ? pu : qu) * k, av = sv + Math.sin(a) * (at ? pv : qv) * k; uv.push((1380 + 200 + X(au) * PX) / ATLAS, 1 - (500 - Y(av) * PX) / 520);
    }
    for (let i = 0; i < rings; i++) for (let j = 0; j < seg; j++) { const a = i * seg + j, c2 = i * seg + (j + 1) % seg; idx.push(a, a + seg, c2, c2, a + seg, c2 + seg); }
    const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2)); g.setIndex(idx);
    const m = new THREE.Mesh(local(b, g), decal); b.add(m);
  }
  const face = bone(head, head.userData.at, 'face'), eyesO = bone(face, [0, Y(A.eyeAt ? A.eyeAt[1] : A.eyes[0][1]), hz], 'eyesOpen'), eyesC = bone(face, [0, hy, hz], 'eyesShut'), tng = bone(face, head.userData.at, 'tongue');
  for (const e of A.eyes) {
    const side = Math.sign(X(e[0])), at = A.eyeAt ? [R.fx + side * A.eyeAt[0], A.eyeAt[1], A.eyeAt[2], A.eyeAt[3]] : null;
    const yaw = side * (at ? .68 : isCat ? .76 : .7), shift = at ? 0 : side * (A.eyeGap || 0);
    patch(eyesO, e, .018, yaw, shift, at);
    const [cu, cv, pu, pv] = at || e, arc = [-.82, -.42, 0, .42, .82].map(t => { const x = X(cu + shift + t * pu), y = Y(cv + pv * (.3 - .42 * t * t)); return V(x, y, (front(x, y) ?? hz + rz) + .03); });
    ink(eyesC, tube(arc, [.012, .022, .025, .022, .012], {n:16, sides:8}), R.ink);
  }
  const mAt = A.muzzleAt ? [R.fx, ...A.muzzleAt] : null;
  if (!A.white) patch(face, A.muzzlePatch, .01, 0, 0, mAt);
  if (isCat) { const [u, v] = mAt || A.muzzlePatch, x = X(u), y = A.white ? 1.35 : Y(v + 20); ink(tng, oval(x, y, (front(x, y) ?? hz + rz) + .02, .05, .065, .028, {seg:16}), 0xf27f83); }
  else if (id === 'dog1') { const x = 0, y = Y(255), z = (front(0, Y(240)) ?? hz + rz) - .02; ink(tng, oval(x, y, z, .075, .105, .042, {seg:20}), 0xf7848a); }

  // ───── 項圈（跟著頭走，坐下時才不會蓋到嘴巴） ─────
  if (isCat) {
    const [uc, d, vc, tilt, w, bellV, bellR] = A.collar || (id === 'cat' ? [890, 86, 250, 28, 108] : [880, 88, 262, 30, 110]);
    const ring = a => V(Math.sin(a) * w / PX, Y(vc + tilt * Math.cos(a)), Z(uc + d * Math.cos(a)));
    if (id === 'cat') {
      paint(head, tube(Array.from({length:33}, (_, i) => ring(i / 32 * Math.PI * 2)), [9 / PX, 9 / PX], {n:80, sides:10}), null, {color:0xe8858c});
      const bv_ = bellV || 292, br_ = bellR ? bellR / PX : .135, dz = br_ * .8;
      paint(head, oval(0, Y(bv_), Z(uc + d + (A.white ? 16 : 6)), br_, br_, dz), null, {color:(v, n) => C(0xe9807a).lerp(C(0xffc9bd), sm(.55, .95, n.y * .7 + n.z * .5))});
      for (const [y, r] of [[bv_ - 6, .036], [bv_ + 10, .018]]) paint(head, oval(0, Y(y), Z(uc + d + (A.white ? 16 : 6)) + dz * .98, r, y > bv_ ? .05 : r, .018, {seg:12}), null, {color:R.ink, line:false});
    } else {
      const cols = [0x6cc5be, 0xfbf7ee, 0xf9d616, 0xf8c8bd, 0xb283c4, 0xa3c4e4];
      for (let i = 0; i < 18; i++) { const p = ring(i / 18 * Math.PI * 2), c = C(cols[i % 6]);
        paint(head, oval(p.x, p.y, p.z, .108, .108, .108, {seg:20}), null, {color:(v, n) => c.clone().multiplyScalar(.9 + .18 * Math.max(0, n.y * .8 + n.z * .3)).lerp(C(0xffffff), sm(.88, .99, n.y * .7 + n.z * .6) * .6)}); }
      for (const [a, dy] of [[.5, 30], [.72, 24]]) { const p = ring(a); paint(head, oval(p.x * 1.08, p.y - dy / PX, p.z + .04, .066, .066, .062, {seg:16}), null, {color:0xdb9b22}); }
    }
  }

  // 花紋對回原圖：新造型每個部位的取樣範圍，線性對到原圖造型同一部位的範圍
  if (A.art) for (const b of bones) {
    const box = A.art[b.name === 'ear' ? 'ear' + (b.position.x > 0 ? '+' : '-') : b.name], list = b.userData.skin.filter(g => g.attributes.aK.getW(0) < .5);
    if (!box || !list.length) continue;
    const lo = [9, 9, 9], hi = [-9, -9, -9];
    for (const g of list) { const a = g.attributes.aRest.array; for (let i = 0; i < a.length; i++) { lo[i % 3] = Math.min(lo[i % 3], a[i]); hi[i % 3] = Math.max(hi[i % 3], a[i]); } }
    for (const g of list) { const a = g.attributes.aRest.array; for (let i = 0; i < a.length; i++) { const k = i % 3;
      if (b.name === 'head' && A.faceMap && k < 2) { if (k === 1) { const [from, to] = A.faceMap, y = a[i]; let j = 0; while (j < from.length - 2 && y < from[j + 1]) j++; a[i] = Y(to[j] + (from[j] - y) / (from[j] - from[j + 1]) * (to[j + 1] - to[j])); } continue; }
      a[i] = box[k] + (a[i] - lo[k]) * (box[k + 3] - box[k]) / Math.max(1e-3, hi[k] - lo[k]); } }
  }

  // 合併每根骨頭的零件
  for (const b of bones) {
    const {skin:sk, solid, ink:lines} = b.userData;
    if (sk.length) b.add(new THREE.Mesh(mergeGeometries(sk.map(g => { g.deleteAttribute('normal'); return g; })), skin));
    if (solid.length) b.add(new THREE.Mesh(mergeGeometries(solid), flat));
    if (lines.length) { const m = new THREE.Mesh(mergeGeometries(lines), inkMat); m.layers.set(hullLayer); b.add(m); }
    b.userData.skin = b.userData.solid = b.userData.ink = null;
  }
  group.scale.set(S.scale, S.scale * (A.white ? 1.03 : 1.08), S.scale);

  // ───── 動作 ─────
  // 每個姿勢是各骨頭相對站姿的偏移 [x,y,z, rx,ry,rz]；切換姿勢時平滑過去
  const keys = ['roll', 'torso', 'head', 'tail', 'FL', 'FR', 'BL', 'BR'], nodes = {roll, torso, head, tail, ...legs};
  const cur = {}; for (const k of keys) cur[k] = [0, 0, 0, 0, 0, 0];
  const rest = roll.position.clone(); let ph = 0, last = 0, lids = 1, tOut = 0;
  const low = Y(Math.max(...A.body.map(r => r[2]))) - .04, legLen = S.legF[1];
  function target(pose, t){
    const o = {}; for (const k of keys) o[k] = [0, 0, 0, 0, 0, 0];
    let eyes = 1, tongueOut = id === 'dog2' ? 1 : 0;
    const set = (k, v) => { for (let i = 0; i < 6; i++) o[k][i] += v[i] || 0; };
    const s = Math.sin(ph), c = Math.cos(ph), breathe = Math.sin(t * 2.1) * .012;
    const sit = () => {
      const tilt = id === 'dog1' ? -.5 : -.66, drop = id === 'dog1' ? .14 : .24;
      set('torso', [0, -drop, 0, tilt]); set('head', [0, A.white ? -.07 : 0, A.white ? .2 : 0, -tilt * .92]);
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
    } else if (pose === 'loaf') { lie(id === 'cat' || id === 'cat2' ? .2 : .1); eyes = 0; tongueOut = 0; set('torso', [0, breathe]); }
    else if (pose === 'down') { lie(.16); eyes = 0; tongueOut = 0; set('torso', [0, breathe]); set('tail', [0, 0, 0, 0, Math.sin(t * 3) * .2]); }
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

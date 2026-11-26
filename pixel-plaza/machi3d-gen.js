// 生成版 3D Machi（目前只在展示頁 viewer.html 和舊版比對，遊戲仍用 assets/machi3d/machi.glb）。
// 模型：assets/machi3d/machi-gen.glb（models/pets/gen_cat_model.py … machi）；頭部上色圖：machi-gen.webp（models/machi/gen_machi_paint.py）
// 動作的數值和 index.html 的 attach3d 相同（站、走、跑、坐），差別是這裡用骨架權重讓整塊網格彎曲。
import {GLTFLoader} from '../character-studio/vendor/GLTFLoader.js';

export function makeMachiGen(THREE, {mergeVertices}, HULL_LAYER, {WORLD_H, edge = .0336, ready, fail} = {}){
  const group = new THREE.Group(), base = new URL('assets/machi3d/', import.meta.url).href, v = '?v=5';
  const k = WORLD_H * 224 / 240 / 2.2;                       // 身高和舊版一樣
  const OLD = 2.2 / 6;                                       // 舊版模型高約 6，位移量換算成這個模型的單位
  const PIVOT = {hips:[0, .55, .02], legL:[.18, .53, 0], legR:[-.18, .53, 0], armL:[.23, .99, 0], armR:[-.23, .99, 0], head:[0, 1.13, .03]};
  const order = ['root', 'hips', 'head', 'armL', 'armR', 'legL', 'legR'];
  const parent = {hips:'root', head:'hips', armL:'hips', armR:'hips', legL:'root', legR:'root'};
  const bones = {};
  for (const id of order) { const b = new THREE.Bone(), at = PIVOT[id] || [0, 0, 0], pa = PIVOT[parent[id]] || [0, 0, 0];
    b.name = id; b.position.set(at[0] - pa[0], at[1] - pa[1], at[2] - pa[2]); b.userData.rest = b.position.clone(); bones[id] = b; }
  const lean = new THREE.Group(), scaler = new THREE.Group();
  group.add(lean); lean.add(scaler); scaler.scale.set(k, k * 1.12, k);
  const sm = (a, b, x) => { const t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t); };
  const lerp = (a, b, t) => a + (b - a) * t;
  const CHICK = [-.378, 1.108, .14];
  const chickness = (x, y, z) => 1 - sm(.135, .16, Math.hypot(x - CHICK[0], y - CHICK[1], (z - CHICK[2]) * .95));
  const headness = (x, y, z) => {                            // 下巴比後腦杓的髮尾低；肩膀上的帽子不算頭
    const limit = lerp(1.175, 1.095, sm(0, .3, z));
    return sm(limit - .015, limit + .025, y) * (1 - (1 - sm(1.17, 1.21, y)) * sm(.24, .29, Math.abs(x)) * (1 - sm(.2, .3, z))) * (1 - chickness(x, y, z));
  };
  const armEdge = y => y > .78 ? lerp(.285, .225, sm(.78, .98, y)) : lerp(.322, .285, sm(.62, .78, y));
  function weigh(g){
    const pos = g.attributes.position, ids = [], ws = [], part = new Float32Array(pos.count * 2);
    for (let i = 0; i < pos.count; i++) {
      const x = pos.getX(i), y = pos.getY(i), z = pos.getZ(i), ax = Math.abs(x), chick = chickness(x, y, z);
      const head = headness(x, y, z);
      let arm = sm(armEdge(y) - .02, armEdge(y) + .025, ax) * (1 - sm(.96, 1.06, y)) * sm(.42, .46, y) * sm(-.24, -.17, z) * (1 - chick) * (1 - head);
      const leg = (1 - sm(.44, .55, y)) * (1 - arm), side = sm(-.025, .025, x);
      const list = [[2, head], [x > 0 ? 3 : 4, arm], [5, leg * side], [6, leg * (1 - side)], [1, Math.max(0, 1 - head - arm - leg)]].sort((a, b) => b[1] - a[1]).slice(0, 4);
      const sum = list.reduce((a, e) => a + e[1], 0) || 1;
      for (const [n, w] of list) { ids.push(n); ws.push(w / sum); }
      part[i * 2] = head; part[i * 2 + 1] = chick;
    }
    g.setAttribute('skinIndex', new THREE.Uint16BufferAttribute(ids, 4)); g.setAttribute('skinWeight', new THREE.Float32BufferAttribute(ws, 4));
    g.setAttribute('aPart', new THREE.BufferAttribute(part, 2));
  }
  function cavity(g){   // 凹下去的地方（髮束之間、衣服皺褶）稍微壓暗，單色塊才看得出造型
    const pos = g.attributes.position, nor = g.attributes.normal, ix = g.index.array, n = pos.count, sum = new Float32Array(n * 3), cnt = new Float32Array(n);
    for (let i = 0; i < ix.length; i += 3) for (let j = 0; j < 3; j++) for (let m = 1; m < 3; m++) {
      const a = ix[i + j], b = ix[i + (j + m) % 3]; sum[a * 3] += pos.getX(b); sum[a * 3 + 1] += pos.getY(b); sum[a * 3 + 2] += pos.getZ(b); cnt[a]++; }
    let c = new Float32Array(n);
    for (let i = 0; i < n; i++) { const dx = sum[i * 3] / cnt[i] - pos.getX(i), dy = sum[i * 3 + 1] / cnt[i] - pos.getY(i), dz = sum[i * 3 + 2] / cnt[i] - pos.getZ(i);
      c[i] = dx * nor.getX(i) + dy * nor.getY(i) + dz * nor.getZ(i); }
    for (let pass = 0; pass < 5; pass++) { const s = new Float32Array(n), m = new Float32Array(n);
      for (let i = 0; i < ix.length; i += 3) for (let j = 0; j < 3; j++) { const a = ix[i + j], b = ix[i + (j + 1) % 3]; s[a] += c[b]; m[a]++; s[b] += c[a]; m[b]++; }
      for (let i = 0; i < n; i++) c[i] = (c[i] + s[i] / m[i]) / 2; }
    g.setAttribute('aCav', new THREE.BufferAttribute(c, 1));
  }
  function soften(g, passes){   // 臉上的法線抹順：網格的小起伏打光後會變成一塊塊深淺
    const nor = g.attributes.normal, skin = g.attributes.aSkin, ix = g.index.array, n = nor.count;
    let c = Float32Array.from(nor.array);
    for (let pass = 0; pass < passes; pass++) { const s = c.slice();
      for (let i = 0; i < ix.length; i += 3) for (let j = 0; j < 3; j++) for (let m = 1; m < 3; m++) { const a = ix[i + j], b = ix[i + (j + m) % 3];
        s[a * 3] += c[b * 3]; s[a * 3 + 1] += c[b * 3 + 1]; s[a * 3 + 2] += c[b * 3 + 2]; }
      for (let i = 0; i < n; i++) { const l = Math.hypot(s[i * 3], s[i * 3 + 1], s[i * 3 + 2]) || 1; for (let k = 0; k < 3; k++) c[i * 3 + k] = skin.getX(i) > .5 ? s[i * 3 + k] / l : c[i * 3 + k]; } }
    g.setAttribute('aSoft', new THREE.BufferAttribute(c, 3));
  }
  const tint = {value:new THREE.Color(1, 1, 1)};
  const atlas = new Promise((res, rej) => new THREE.TextureLoader().load(base + 'machi-gen.webp' + v, res, undefined, rej));
  const model = new Promise((res, rej) => new GLTFLoader().load(base + 'machi-gen.glb' + v, res, undefined, rej));
  Promise.all([atlas, model]).then(([map, gltf]) => {
    // 不指定色彩空間：直接照圖上的顏色輸出。不用縮圖層級：換面取樣的交界會取到錯的層級、畫出虛線
    map.generateMipmaps = false; map.minFilter = THREE.LinearFilter;
    let src; gltf.scene.updateMatrixWorld(true); gltf.scene.traverse(o => { if (o.isMesh && !src) src = o.geometry.clone().applyMatrix4(o.matrixWorld); });
    const geo = new THREE.BufferGeometry(); geo.setAttribute('position', src.attributes.position); geo.setIndex(src.index);
    const vc = src.attributes.color;                          // 紅色通道＝皮膚（gen_machi_mask.py）
    geo.setAttribute('aSkin', new THREE.BufferAttribute(Float32Array.from({length:vc.count}, (_, i) => vc.getX(i)), 1));
    const g = mergeVertices(geo, 1e-4); g.computeVertexNormals(); weigh(g); cavity(g); soften(g, 25);
    const skin = new THREE.ShaderMaterial({uniforms:{map:{value:map}, tint}, vertexShader:`
      #include <common>
      #include <skinning_pars_vertex>
      attribute vec2 aPart; attribute float aCav; attribute float aSkin; attribute vec3 aSoft; varying vec3 soft; varying vec3 p; varying vec3 n; varying vec2 part; varying float cav; varying float flesh;
      void main(){ p = position; n = normal; part = aPart; cav = aCav; flesh = aSkin; soft = aSoft;
        #include <skinbase_vertex>
        #include <begin_vertex>
        #include <skinning_vertex>
        #include <project_vertex>
      }`, fragmentShader:`
      uniform sampler2D map; uniform vec3 tint; varying vec3 p; varying vec3 n; varying vec2 part; varying float cav; varying float flesh; varying vec3 soft;
      vec3 rgb(float r, float g, float b){ return vec3(r, g, b) / 255.0; }
      vec3 panel(float u, float i){ return texture2D(map, vec2((i + clamp(0.5 + u / 2.6, 0.002, 0.998)) / 3.0, 0.5 + (p.y - 1.1) / 2.6)).rgb; }
      float box(float v, float a, float b){ return step(a, v) * step(v, b); }
      float spot(vec2 q, vec2 c, vec2 r){ float d = length((q - c) / r); return 1.0 - smoothstep(1.0 - fwidth(d), 1.0 + fwidth(d), d); }
      void main(){
        vec3 m = normalize(n); float ax = abs(p.x);
        vec3 SKIN = rgb(252.0, 205.0, 180.0), HOODIE = rgb(46.0, 41.0, 43.0), SHORTS = rgb(38.0, 33.0, 35.0), SHOE = rgb(36.0, 32.0, 33.0);
        // ── 身體：依位置上色 ──
        vec3 c = HOODIE;
        if (p.y < 0.55 && ax < 0.325) c = SHORTS;
        float shoeTop = 0.3 + 0.045 * smoothstep(0.02, 0.16, p.z);
        if (p.y < 0.422) c = SKIN;
        if (p.y < shoeTop) c = p.y < 0.095 ? rgb(52.0, 47.0, 49.0) : SHOE;
        if (ax > 0.31 && p.y < 0.648 && length((vec3(ax, p.y, p.z) - vec3(0.425, 0.575, 0.12)) / vec3(0.15, 0.105, 0.17)) < 1.0) c = SKIN;   // 手
        if (p.z > 0.1 && p.y < 1.13 && p.y > 1.052 && abs(p.x + 0.002) < (p.y - 1.052) * 1.15) c = SKIN;   // 領口
        if (p.z > 0.16 && (box(p.x, -0.122, -0.078) > 0.0 || box(p.x, 0.074, 0.118) > 0.0) && box(p.y, 0.8, 1.055) > 0.0 && m.z > 0.25)
          c = p.y < 0.845 ? rgb(188.0, 184.0, 182.0) : rgb(84.0, 76.0, 78.0);                     // 帽繩
        float flatShade = 1.0;
        // ── 頭：用上色圖 ──
        if (part.x > 0.5) {
          bool centre = p.z > 0.24 && ax < 0.37 && m.z > 0.05;
          vec3 HAIR = rgb(74.0, 43.0, 29.0), BLOND = rgb(232.0, 166.0, 90.0);
          if (flesh > 0.5) {                                                                       // 皮膚上只畫五官和腮紅
            c = centre || m.z > abs(m.x) ? panel(p.x, 0.0) : panel(p.z, 1.0);
            if (distance(c, HAIR) < 0.09 || distance(c, BLOND) < 0.11) c = SKIN;
          } else {
          if (centre || p.z > 0.4) c = panel(p.x, 0.0);                                          // 瀏海整片照正面圖，挑染的邊緣才完整
          else if (p.z > -0.1) c = panel(p.z, 1.0);
          else c = panel(-p.x, 2.0);
          if (c.g > 0.52 && c.r > 0.85 && c.b > 0.45) c = HAIR;                                     // 頭髮上投到的膚色
          }
        }
        // ── 小雞 ──
        if (part.y > 0.5) {
          c = rgb(255.0, 208.0, 48.0);
          vec3 d = normalize(p - vec3(-0.378, 1.105, 0.135));                                      // 五官照小雞中心的方向畫，轉到側面也看得到一眼
          float eye = max(smoothstep(0.988, 0.991, dot(d, normalize(vec3(-0.6, 0.17, 0.78)))), smoothstep(0.988, 0.991, dot(d, normalize(vec3(0.5, 0.17, 0.85)))));
          float beak = 1.0 - smoothstep(0.9, 1.1, length((d.xy - vec2(-0.03, -0.14)) / vec2(0.22, 0.13)));
          c = mix(c, rgb(240.0, 128.0, 30.0), beak * step(0.3, d.z));
          c = mix(c, rgb(25.0, 16.0, 12.0), eye);
        }
        // ── 打光：柔和的兩階明暗，加上凹處壓暗 ──
        float lum = dot(c, vec3(0.3, 0.59, 0.11)), light = dot(m, normalize(vec3(-0.4, 0.75, 0.55)));
        float lit = smoothstep(-0.25, 0.65, light);
        float dark = 1.0 - smoothstep(0.35, 0.6, lum);                                            // 深色（頭髮、衣服）要亮暗差大一點才看得出形狀
        vec3 shade = mix(vec3(mix(0.86, 0.78, dark)), vec3(mix(1.05, 1.2, dark)), lit);
        if (flesh > 0.5 && part.y < 0.5) shade = mix(vec3(0.93, 0.9, 0.9), vec3(1.025), smoothstep(-0.5, 0.7, dot(normalize(soft), normalize(vec3(-0.4, 0.75, 0.55)))));
        c *= shade;
        c *= 1.0 - clamp(cav * 110.0, -0.12, 0.38) * max(dark, 1.0 - smoothstep(0.55, 0.75, lum));      // 皮膚不壓暗，臉上才不會有髒塊
        c += dark * smoothstep(0.6, 0.98, light) * 0.035;
        gl_FragColor = vec4(c, 1.0);
        gl_FragColor.rgb *= pow(tint, vec3(1.0 / 2.2));
      }`});
    group.updateMatrixWorld(true);
    for (const id of order) (parent[id] ? bones[parent[id]] : scaler).add(bones[id]);
    group.updateMatrixWorld(true);
    const skeleton = new THREE.Skeleton(order.map(id => bones[id]));
    const mesh = new THREE.SkinnedMesh(g, skin); mesh.frustumCulled = false; scaler.add(mesh); mesh.updateMatrixWorld(true); mesh.bind(skeleton);
    // 外框：沿法線外擴的背面（粗細、後退量和舊版相同）
    const hull = g.clone(), hp = hull.attributes.position, hn = hull.attributes.normal, out = edge / k;
    for (let i = 0; i < hp.count; i++) hp.setXYZ(i, hp.getX(i) + hn.getX(i) * out, hp.getY(i) + hn.getY(i) * out, hp.getZ(i) + hn.getZ(i) * out);
    const ink = new THREE.MeshBasicMaterial({color:0x0b0807, side:THREE.BackSide});
    ink.onBeforeCompile = sh => { sh.vertexShader = sh.vertexShader.replace('#include <project_vertex>', '#include <project_vertex>\n if (isOrthographic) mvPosition.z -= 0.2; else mvPosition.xyz += normalize(mvPosition.xyz) * 0.2; gl_Position = projectionMatrix * mvPosition;'); };
    ink.customProgramCacheKey = () => 'machi-gen-ink';
    const line = new THREE.SkinnedMesh(hull, ink); line.layers.set(HULL_LAYER); line.frustumCulled = false; scaler.add(line); line.updateMatrixWorld(true); line.bind(skeleton, mesh.bindMatrix);
    mesh.raycast = line.raycast = () => {};
    update('stand', 0);
    ready && ready();
  }).catch(e => { console.error(e); fail && fail(e); });
  const st = {walk:0, run:0, sit:0, ph:0};
  let last = 0;
  function update(pose, now, dist){
    const dt = last ? Math.min(.05, Math.max(0, (now - last) / 1000)) : 0; last = now;
    const speed = pose === 'walk' ? 2 : pose === 'run' ? 5 : 0, d = dist === undefined ? speed * dt : dist;
    const ease = (v, to, r) => dt ? v + (to - v) * (1 - Math.exp(-dt * r)) : to;
    st.walk = ease(st.walk, speed ? 1 : 0, 12); st.run = ease(st.run, speed > 3.5 ? 1 : 0, 9); st.sit = ease(st.sit, pose === 'sit' ? 1 : 0, pose === 'sit' ? 18 : 14);
    st.ph += d * (4.2 - 2.1 * st.run);
    lean.rotation.x = -.14;
    const t = now / 1000, w = st.walk, r = st.run, q = st.sit, s = Math.sin(st.ph), co = Math.cos(st.ph), mix = (a, b) => a + (b - a) * r;
    const leg = mix(.62, 1.05) * w, arm = mix(.6, 1.15) * w, lift = mix(.14, .42) * w * OLD;
    const J = bones, y = (b, dy) => { b.position.y = b.userData.rest.y + dy; };
    J.legL.rotation.x = -s * leg + .12 * r * w - 1.45 * q; J.legR.rotation.x = s * leg + .12 * r * w - 1.45 * q;
    y(J.legL, Math.max(0, co) * lift); y(J.legR, Math.max(0, -co) * lift);
    J.armL.rotation.x = s * arm - .35 * r * w - .62 * q; J.armR.rotation.x = -s * arm - .35 * r * w - .62 * q;
    J.armL.rotation.z = .16 * r * w + .08 * q; J.armR.rotation.z = -.16 * r * w - .08 * q;
    y(J.root, ((Math.abs(co) * mix(.16, .34) - mix(.07, .05)) * w - .12 * q) * OLD);
    J.hips.rotation.set(mix(.05, .24) * w + .05 * q, s * .09 * w, s * .035 * w * (1 - r));
    J.hips.scale.y = 1 + Math.sin(t * 2.2) * .008 * (1 - w);
    J.head.rotation.set(-mix(.03, .17) * w + Math.sin(st.ph * 2) * .025 * w, -s * .06 * w, 0);
  }
  return {group, update, tint:tint.value};
}

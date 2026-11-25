// 生成版 3D 寵物（試作，只在展示頁使用）：外型是白膜圖生成的 GLB，花紋用原圖三視圖依表面朝向投影。動作和 pets3d.js 同一套（骨架權重在 weigh()）。
// 模型：assets/pets3d-gen/cat.glb（models/pets/gen_cat_model.py）；貼圖：cat.webp（models/pets/gen_cat_texture.py）
import {GLTFLoader} from '../character-studio/vendor/GLTFLoader.js';
// 骨架（模型座標）：和 pets3d.js 同樣的骨頭名稱，姿勢數值共用
const IDS = {cat:{ink:0x33201a, body:[.85, -.1], br:.42, head:[1.6, .45], hr:[.5, .5], neck:[0, 1.29, .33], tail:[0, 1.18, -.7],
  legF:[.24, .74, .45], legB:[.28, .72, -.55], lr:.17, low:.35, eyes:[[-.2285, 1.575], [.2234, 1.575]], eyeR:[.112, .108]}};
export const hasPet = id => !!IDS[id];
export function makePet(THREE, {mergeVertices}, id, HULL_LAYER, {ready, fail} = {}){
  const P = IDS[id], group = new THREE.Group(), base = new URL('assets/pets3d-gen/', import.meta.url).href, v = '?v=6';
  const bones = {}, order = ['roll', 'torso', 'head', 'tail', 'FL', 'FR', 'BL', 'BR'];
  const [by, bz] = P.body, [hy] = P.head, ry = P.hr[0], isCat = id === 'cat' || id === 'cat2';
  const at = {roll:[0, by, bz], torso:[0, by, bz], head:P.neck, tail:P.tail,
    FL:[P.legF[0], P.legF[1], P.legF[2]], FR:[-P.legF[0], P.legF[1], P.legF[2]], BL:[P.legB[0], P.legB[1], P.legB[2]], BR:[-P.legB[0], P.legB[1], P.legB[2]]};
  const parent = {torso:'roll', head:'torso', tail:'torso', FL:'roll', FR:'roll', BL:'roll', BR:'roll'};
  for (const k of order) { const b = new THREE.Bone(), pa = parent[k] ? at[parent[k]] : [0, 0, 0]; b.name = k;
    b.position.set(at[k][0] - pa[0], at[k][1] - pa[1], at[k][2] - pa[2]); b.userData.rest = b.position.clone(); bones[k] = b; (parent[k] ? bones[parent[k]] : group).add(b); }
  const lid = {value:0};
  const sm = (a, b, v) => { const t = Math.min(1, Math.max(0, (v - a) / (b - a))); return t * t * (3 - 2 * t); };
  function weigh(g){   // 每個頂點分給哪些骨頭：脖子斜線以上是頭、背線以上的後端是尾巴、肚子以下分四條腿，交界漸層
    const pos = g.attributes.position, ids = [], ws = [];
    for (let i = 0; i < pos.count; i++) {
      const x = pos.getX(i), y = pos.getY(i), z = pos.getZ(i);
      const above = (y - (1.37 - (z - .07) * .42)) * .92;                        // 離項圈斜線多高
      // 項圈和鈴鐺跟著頭走，坐下低頭時才不會被蓋住
      const bell = 1 - sm(.15, .21, Math.hypot(x, y - .97, z - .86));
      let head = Math.max(sm(-.11, .03, above) * sm(-.3, -.05, z), bell);
      let tail = Math.max(sm(1.2, 1.4, y) * sm(-.28, -.5, z), sm(-.8, -.92, z) * sm(.98, 1.12, y)) * (1 - head);
      const legZ = z > -.02 ? sm(-.02, .22, z) : sm(-.05, -.3, z);
      let leg = (1 - sm(.3, .74, y)) * Math.max(legZ, 1 - sm(.2, .36, y));
      leg = Math.min(leg, 1 - head - tail);
      const side = sm(-.05, .05, x), front = z > -.05, L = leg * side, R = leg * (1 - side);
      const list = [[1, Math.max(0, 1 - head - tail - leg)], [2, head], [3, tail], [front ? 4 : 6, L], [front ? 5 : 7, R]].sort((a, b) => b[1] - a[1]).slice(0, 4);
      const sum = list.reduce((a, e) => a + e[1], 0) || 1;
      for (const [n, w] of list) { ids.push(n); ws.push(w / sum); }
    }
    g.setAttribute('skinIndex', new THREE.Uint16BufferAttribute(ids, 4)); g.setAttribute('skinWeight', new THREE.Float32BufferAttribute(ws, 4));
  }
  const atlas = new Promise((res, rej) => new THREE.TextureLoader().load(base + id + '.webp' + v, res, undefined, rej));
  const model = new Promise((res, rej) => new GLTFLoader().load(base + id + '.glb' + v, res, undefined, rej));
  Promise.all([atlas, model]).then(([map, gltf]) => {
    map.colorSpace = THREE.SRGBColorSpace; map.anisotropy = 8;
    let src; gltf.scene.updateMatrixWorld(true); gltf.scene.traverse(o => { if (o.isMesh && !src) src = o.geometry.clone().applyMatrix4(o.matrixWorld); });
    const geo = new THREE.BufferGeometry(); geo.setAttribute('position', src.attributes.position); geo.setIndex(src.index);
    const g = mergeVertices(geo, 1e-4); g.computeVertexNormals(); g.setAttribute('aRest', g.attributes.position); weigh(g);
    const e = P.eyes, er = P.eyeR;
    const skin = new THREE.ShaderMaterial({uniforms:{map:{value:map}, lid}, vertexShader:`
      #include <common>
      #include <skinning_pars_vertex>
      varying vec3 p; varying vec3 n;
      void main(){ p = position; n = normal;
        #include <skinbase_vertex>
        #include <begin_vertex>
        #include <skinning_vertex>
        #include <project_vertex>
      }`, fragmentShader:`
      uniform sampler2D map; uniform float lid; varying vec3 p; varying vec3 n;
      vec3 panel(float u, float v, float i){ return texture2D(map, vec2((i + clamp(0.5 + u / 2.6, 0.002, 0.998)) / 3.0, 0.5 + v / 2.6)).rgb; }
      void main(){
        vec3 m = normalize(n); float h = p.y - 1.1;
        float wf = pow(max(m.z, 0.0), 4.0), wb = pow(max(-m.z, 0.0), 4.0), ws = pow(abs(m.x), 4.0) + 0.7 * pow(abs(m.y), 4.0);
        // 臉：朝前的地方只用正面圖，五官才不會疊影
        float face = (1.0 - smoothstep(0.85, 1.25, length(vec2(p.x / 0.47, (p.y - 1.47) / 0.4)))) * smoothstep(0.35, 0.55, p.z) * smoothstep(0.35, 0.75, m.z);
        // 翹起的尾巴只用側面圖
        float tail = smoothstep(-0.35, -0.55, p.z) * smoothstep(1.15, 1.3, p.y);
        float bell = (1.0 - smoothstep(0.75, 1.4, length(vec2(p.x, p.y - 0.97) / 0.145))) * smoothstep(0.3, 0.5, p.z) * smoothstep(-0.1, 0.35, m.z);
        face = max(face, bell);
        wf = (wf + 6.0 * face) * (1.0 - tail); ws = ws * (1.0 - face) + tail; wb *= 1.0 - tail;
        vec3 c = panel(p.x, h, 0.0) * wf + panel(p.z + tail * p.x * abs(m.z) * 0.9, h, 1.0) * ws + panel(-p.x, h, 2.0) * wb;
        c /= max(wf + ws + wb, 1e-4);
        // 閉眼：眼睛範圍由上往下蓋上周圍的毛色，下緣畫一條彎彎的眼線
        if (lid > 0.01 && p.z > 0.45) for (int i = 0; i < 2; i++) {
          vec2 ctr = i == 0 ? vec2(${e[0][0]}, ${e[0][1]}) : vec2(${e[1][0]}, ${e[1][1]});
          vec2 q = (p.xy - ctr) / vec2(${er[0]}, ${er[1]});
          float inside = 1.0 - smoothstep(0.96, 1.08, length(q));
          if (inside > 0.0 && q.y > 1.1 - 2.2 * lid) {
            vec3 fur = panel(p.x * 1.12, p.y + ${er[1]} * 1.75 - 1.1, 0.0);
            c = mix(c, fur, inside);
          }
          float line = abs(q.y - (-0.38 + 0.42 * q.x * q.x));
          if (lid > 0.75 && abs(q.x) < 0.92) c = mix(c, vec3(0.045, 0.018, 0.01), 1.0 - smoothstep(0.07, 0.13, line));
        }
        gl_FragColor = vec4(c, 1.0);
        #include <colorspace_fragment>
      }`});
    group.updateMatrixWorld(true);
    const skeleton = new THREE.Skeleton(order.map(k => bones[k]));
    const mesh = new THREE.SkinnedMesh(g, skin); mesh.frustumCulled = false; group.add(mesh); mesh.updateMatrixWorld(true); mesh.bind(skeleton);
    // 外框：沿法線外擴的背面
    const hull = g.clone(), hp = hull.attributes.position, hn = hull.attributes.normal;
    for (let i = 0; i < hp.count; i++) hp.setXYZ(i, hp.getX(i) + hn.getX(i) * .034, hp.getY(i) + hn.getY(i) * .034, hp.getZ(i) + hn.getZ(i) * .034);
    const ink = new THREE.MeshBasicMaterial({color:P.ink, side:THREE.BackSide});
    ink.onBeforeCompile = sh => { sh.vertexShader = sh.vertexShader.replace('#include <project_vertex>', '#include <project_vertex>\n if (isOrthographic) mvPosition.z -= 0.1; else mvPosition.xyz += normalize(mvPosition.xyz) * 0.1; gl_Position = projectionMatrix * mvPosition;'); };
    const line = new THREE.SkinnedMesh(hull, ink); line.layers.set(HULL_LAYER); line.frustumCulled = false; group.add(line); line.updateMatrixWorld(true); line.bind(skeleton, mesh.bindMatrix);
    last = 0; update('stand', 0);
    ready && ready();
  }).catch(e => { console.error(e); fail && fail(e); });
  // ───── 動作（姿勢＝各骨頭相對站姿的偏移，切換時平滑過去） ─────
  const keys = order, cur = {}; for (const k of keys) cur[k] = [0, 0, 0, 0, 0, 0];
  let ph = 0, last = 0, lids = 1;
  const S = {legF:P.legF, lr:P.lr}, br = [0, P.br], low = P.low, legLen = P.legB[1];
  const A = {white:1};
  function target(pose, t){
    const o = {}; for (const k of keys) o[k] = [0, 0, 0, 0, 0, 0];
    let eyes = 1, tongueOut = id === 'dog2' ? 1 : 0;
    const set = (k, v) => { for (let i = 0; i < 6; i++) o[k][i] += v[i] || 0; };
    const s = Math.sin(ph), c = Math.cos(ph), breathe = Math.sin(t * 2.1) * .012;
    const sit = () => {
      const tilt = id === 'dog1' ? -.5 : -.66, drop = id === 'dog1' ? .14 : .24;
      set('torso', [0, -drop, 0, tilt]); set('head', [0, A.white ? -.14 : 0, A.white ? .28 : 0, -tilt * .92]);
      for (const k of ['BL', 'BR']) set(k, [(k === 'BL' ? 1 : -1) * .07, -(legLen - S.lr * 1.9), .22, -1.42]);
      const up = Math.sin(-tilt) * (S.legF[2] - bz) - drop;   // 胸口抬高多少，前腳就跟著拉長
      for (const k of ['FL', 'FR']) { set(k, [0, up * .78, -.14]); o[k][6] = 1 + up * .78 / legLen; }
      set('tail', [0, 0, 0, id === 'cat' ? .95 : .55, Math.sin(t * 1.6) * .14]);
    };
    const lie = (headDown) => {
      set('torso', [0, -low, 0]); set('head', [0, -headDown, .05]);
      for (const k of ['FL', 'FR']) { set(k, [0, -(legLen - S.lr * 1.15), .1, -1.52]); o[k][6] = .7; }
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
      set('FR', [.02, .1, .12, -1.05 + lick]); set('head', [-.02, -.05, .02, .3 + lick * .4, -.16, -.1]);
    } else if (pose === 'loaf') { lie(id === 'cat' || id === 'cat2' ? .2 : .1); eyes = 0; tongueOut = 0; set('torso', [0, breathe]); }
    else if (pose === 'down') { lie(.16); eyes = 0; tongueOut = 0; set('torso', [0, breathe]); set('tail', [0, 0, 0, 0, Math.sin(t * 3) * .2]); }
    else if (pose === 'sleep') {
      lie(.5); eyes = 0; tongueOut = 0; set('head', [.14, .04, .16, .03, .38, .2]); set('torso', [0, breathe * 1.8, 0, 0, -.16]); set('tail', [0, 0, 0, .3, .7]);
    } else if (pose === 'eat') {
      const drop = Math.max(.35, hy - ry * 1.5), chew = Math.abs(Math.sin(t * 9)) * .05;
      set('torso', [0, -.08, 0, .22]); set('head', [0, -drop * .5 - chew, .12, .38 + chew]);
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
    const {o, eyes} = target(name, t), snap = !dt;
    const k = snap ? 1 : 1 - Math.exp(-dt * (name === 'walk' || name === 'run' ? 22 : 11));
    for (const key of keys) {
      const c = cur[key], v = o[key], n = bones[key], r = n.userData.rest;
      for (let i = 0; i < 6; i++) c[i] += (v[i] - c[i]) * k;
      n.position.set(r.x + c[0], r.y + c[1], r.z + c[2]); n.rotation.set(c[3], c[4], c[5]);
      if (key.length === 2) { c[6] = (c[6] || 1) + ((v[6] || 1) - (c[6] || 1)) * k; n.scale.y = c[6]; }
    }
    const blink = eyes === 1 && (t + 4) % 4.2 < .13;
    lids += ((blink ? 0 : eyes) - lids) * (snap ? 1 : Math.min(1, dt * 28));
    lid.value = 1 - lids;
  }
  return {group, update};
}

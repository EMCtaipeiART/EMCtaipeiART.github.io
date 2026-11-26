// 生成版 3D 寵物（兩隻貓是遊戲與展示頁共用；兩隻狗是 trial，只在展示頁）：外型是白膜圖生成的 GLB，花紋用原圖三視圖依表面朝向投影。動作和 pets3d.js 同一套（骨架權重在 weigh()）。
// 模型：assets/pets3d-gen/<id>.glb（models/pets/gen_cat_model.py）；貼圖：<id>.webp（models/pets/gen_cat_texture.py）
import {GLTFLoader} from '../character-studio/vendor/GLTFLoader.js';
// 骨架（模型座標）：和 pets3d.js 同樣的骨頭名稱，姿勢數值共用
// neck：頭身分界斜線 [高度, 前後, 斜率, 頭部前後漸層起迄]；bell：鈴鐺 [x, y, z, 半徑]；legs：前後腿分界與各自的漸層
// face：臉部只用正面圖的最小前後值；upTail：翹起的尾巴只用側面圖；tp：各姿勢尾巴抬多少
const IDS = {
  cat:{ink:0x33201a, body:[.85, -.1], br:.42, head:[1.6, .45], hr:[.5, .5], neck:[0, 1.29, .33], tail:[0, 1.18, -.7],
    legF:[.24, .74, .45], legB:[.28, .72, -.55], lr:.17, low:.35, eyes:[[-.2285, 1.575], [.2234, 1.575]], eyeR:[.112, .108],
    line:[1.37, .07, .42, -.3, -.05], bell:[0, .97, .86, .15], bellFrom:-.1, bellZ:.3, beads:0, legs:[-.02, -.02, .22, -.05, -.3], face:.35, upTail:1,
    tp:{sit:.95, lie:1.5, run:-.45, eat:-.2, belly:.9, sleep:.3}},
  cat2:{ink:0x3d2418, body:[.8, -.05], br:.45, head:[1.55, .62], hr:[.5, .5], neck:[0, 1.2, .52], tail:[0, .9, -.6],
    legF:[.24, .72, .55], legB:[.3, .68, -.36], lr:.17, low:.35, eyes:[[-.239, 1.575], [.237, 1.575]], eyeR:[.128, .11],
    line:[1.22, .3, .36, .02, .24], bell:[.34, .92, .9, .13], bellFrom:-.35, bellZ:.8, beads:1, sideEye:[1.01, 1.575, .09, .115], legs:[.13, .13, .37, .1, -.15], face:.6, upTail:0,
    tp:{sit:1.35, lie:.45, run:.75, eat:.1, belly:.5, sleep:0}},
  // 狗另外給：span 貼圖視圖寬高；fc 臉部範圍 [高度, 半寬, 半高]；legY 腿的高度漸層；tailW 尾巴範圍 [[z起, z迄, y起, y迄]]；ears 垂耳也跟著頭 [x起迄, y起迄, z起迄]；sit [身體仰角, 下沉]
  dog1:{trial:1, ink:0x331c0e, body:[.65, 0], br:.4, head:[1.5, 1], hr:[.5, .5], neck:[0, 1.05, .55], tail:[0, .55, -1],
    legF:[.32, .5, .66], legB:[.3, .48, -.68], lr:.17, low:.12, eyes:[[-.245, 1.527], [.345, 1.527]], eyeR:[.1, .145], span:3.8,
    line:[1, .6, .25, .05, .35], bell:[9, 9, 9, .1], bellFrom:0, bellZ:9, beads:0, legs:[0, .15, .38, -.15, -.38], legY:[.18, .55, .1, .24], face:.85, upTail:0,
    fc:[1.45, .46, .42], sink:.18, muzzle:[1.42, 1.38], nose:[[.048, 1.322, 1.7], [.135, .09, .13]], tailW:[[-.95, -1.2, .12, .3]], ears:[.4, .52, .66, .8, -.05, .15], sit:[-.28, .04],
    tp:{sit:.2, lie:.1, run:.25, eat:0, belly:.3, sleep:0}},
  dog2:{trial:1, ink:0x432010, body:[.85, 0], br:.45, head:[1.65, .55], hr:[.5, .5], neck:[0, 1.22, .3], tail:[0, 1.2, -.45],
    legF:[.28, .6, .52], legB:[.28, .6, -.46], lr:.17, low:.28, eyes:[[-.203, 1.587], [.203, 1.587]], eyeR:[.08, .1],
    line:[1.18, .5, .3, -.05, .2], bell:[9, 9, 9, .1], bellFrom:0, bellZ:9, beads:0, legs:[.02, .15, .32, -.1, -.28], legY:[.25, .62, .15, .3], face:.45, upTail:1,
    fc:[1.45, .45, .42], earFront:[1.76, .05], sink:.3, hideFarEye:1, crisp:1, muzzle:[.94, 1.48], nose:[[0, 1.515, 1.135], [.1, .072, .11]], tailW:[[-.2, -.42, 1.26, 1.42], [-.66, -.84, .72, .94]], sit:[-.5, .18],
    tp:{sit:.2, lie:.2, run:-.15, eat:0, belly:.4, sleep:.15}},
};
export const hasPet = (id, trial) => !!IDS[id] && (!!trial || !IDS[id].trial);   // 遊戲只拿正式的；展示頁傳 true
// scale：模型高 2.2，遊戲裡縮到和舊版差不多大；outline：外框外擴量（模型單位）
export function makePet(THREE, {mergeVertices}, id, HULL_LAYER, {ready, fail, scale = 1, outline = .034} = {}){
  const P = IDS[id], group = new THREE.Group(), base = new URL('assets/pets3d-gen/', import.meta.url).href, v = '?v=15';
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
      const [ly, lz, slope, z0, z1] = P.line, above = (y - (ly - (z - lz) * slope)) * .92;   // 離項圈斜線多高
      // 項圈和鈴鐺跟著頭走，坐下低頭時才不會被蓋住
      const [bx, bh, bd, bs] = P.bell, bell = 1 - sm(bs, bs + .06, Math.hypot(x - bx, y - bh, z - bd));
      let head = Math.max(sm(-.11, .03, above) * sm(z0, z1, z), bell);
      if (P.ears) { const [x0, x1, y0, y1, z0, z1] = P.ears; head = Math.max(head, sm(x0, x1, Math.abs(x)) * sm(y0, y1, y) * sm(z0, z1, z)); }
      let tail = (P.tailW ? Math.max(...P.tailW.map(([z0, z1, y0, y1]) => sm(z0, z1, z) * sm(y0, y1, y)))
        : P.upTail ? Math.max(sm(1.2, 1.4, y) * sm(-.28, -.5, z), sm(-.8, -.92, z) * sm(.98, 1.12, y))
        : sm(-.58, -.76, z) * (1 - sm(1, 1.15, y))) * (1 - head);                     // 虎斑貓的尾巴垂在身後
      const [split, f0, f1, b0, b1] = P.legs, legZ = z > split ? sm(f0, f1, z) : sm(b0, b1, z);
      const [l0, l1, l2, l3] = P.legY || [.3, .74, .2, .36];
      let leg = (1 - sm(l0, l1, y)) * Math.max(legZ, 1 - sm(l2, l3, y));
      leg = Math.min(leg, 1 - head - tail);
      const side = sm(-.05, .05, x), front = z > split - .03, L = leg * side, R = leg * (1 - side);
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
    const e = P.eyes, er = P.eyeR, B = P.bell, num = n => n.toFixed(3), span = num(P.span || 2.6), fc = P.fc || [1.47, .47, .4];
    const skin = new THREE.ShaderMaterial({uniforms:{map:{value:map}, lid}, vertexShader:`
      #include <common>
      #include <skinning_pars_vertex>
      varying vec3 p; varying vec3 n; varying float facing;
      void main(){ p = position; n = normal;
        #include <beginnormal_vertex>
        #include <skinbase_vertex>
        #include <skinnormal_vertex>
        #include <defaultnormal_vertex>
        #include <begin_vertex>
        #include <skinning_vertex>
        #include <project_vertex>
        facing = dot(normalize(transformedNormal), isOrthographic ? vec3(0.0, 0.0, 1.0) : normalize(-mvPosition.xyz));
      }`, fragmentShader:`
      uniform sampler2D map; uniform float lid; varying vec3 p; varying vec3 n; varying float facing;
      vec3 panel(float u, float v, float i){ return texture2D(map, vec2((i + clamp(0.5 + u / ${span}, 0.002, 0.998)) / 3.0, 0.5 + v / ${span})).rgb; }
      void main(){
        vec3 m = normalize(n); float h = p.y - 1.1;
        float wf = pow(max(m.z, 0.0), 4.0), wb = pow(max(-m.z, 0.0), 4.0), ws = pow(abs(m.x), 4.0) + 0.7 * pow(abs(m.y), 4.0);
        // 彩珠項圈：三張圖混在一起珠子會糊掉，這一圈盡量只取一張
        float k = 1.0 + 3.0 * ${num(P.beads)} * (1.0 - smoothstep(0.1, 0.17, abs(p.y - (${num(P.line[0])} - (p.z - ${num(P.line[1])}) * ${num(P.line[2])}) - 0.02)));
        wf = pow(wf, k); wb = pow(wb, k); ws = pow(ws, k);
        // 臉：朝前的地方只用正面圖，五官才不會疊影
        float face = (1.0 - smoothstep(0.85, 1.25, length(vec2(p.x / ${num(fc[1])}, (p.y - ${num(fc[0])}) / ${num(fc[2])})))) * smoothstep(${num(P.face)}, ${num(P.face + .2)}, p.z) * smoothstep(0.35, 0.75, m.z);
        // 翹起的尾巴只用側面圖
        float tail = ${num(P.upTail)} * smoothstep(-0.35, -0.55, p.z) * smoothstep(1.15, 1.3, p.y);
        float bell = (1.0 - smoothstep(0.75, 1.4, length(vec2(p.x - ${num(B[0])}, p.y - ${num(B[1])}) / ${num(B[3])}))) * smoothstep(${num(P.bellZ)}, ${num(P.bellZ + .14)}, p.z) * smoothstep(${num(P.bellFrom)}, ${num(P.bellFrom + .45)}, m.z);
        face = max(face, bell);
        ${P.muzzle ? `// 凸出的口鼻：側面改用側面圖，鼻子和嘴巴才不會糊
        float muz = smoothstep(${num(P.muzzle[0])}, ${num(P.muzzle[0] + .08)}, p.z) * (1.0 - smoothstep(${num(P.muzzle[1])}, ${num(P.muzzle[1] + .08)}, p.y)) * smoothstep(1.1, 1.2, p.y) * smoothstep(0.45, 0.75, abs(m.x)) * (1.0 - smoothstep(0.35, 0.65, m.z));
        face *= 1.0 - muz; wf *= 1.0 - muz; ws = mix(ws, 1.0, muz);` : ''}
        wf = (wf + 6.0 * face) * (1.0 - tail); ws = ws * (1.0 - face) + tail; wb *= 1.0 - tail;
        vec3 c = panel(p.x, h, 0.0) * wf + panel(p.z + tail * p.x * abs(m.z) * 0.9, h, 1.0) * ws + panel(-p.x, h, 2.0) * wb;
        c /= max(wf + ws + wb, 1e-12);
        ${P.crisp ? `{   // 口鼻只在正面圖和側面圖之間乾脆地切換，兩張混在一起嘴巴會有灰色重影
          float zone = smoothstep(${num(P.muzzle[0])}, ${num(P.muzzle[0] + .06)}, p.z) * smoothstep(1.08, 1.14, p.y) * (1.0 - smoothstep(${num(P.muzzle[1])}, ${num(P.muzzle[1] + .06)}, p.y)) * (1.0 - smoothstep(0.28, 0.34, abs(p.x)));
          c = mix(c, mix(panel(p.x, h, 0.0), panel(p.z, h, 1.0), smoothstep(0.66, 0.74, abs(m.x))), zone);
        }` : ''}
        ${P.earFront ? `{   // 立耳只有朝前的面用正面圖（粉紅內耳），其他面是白毛；三張圖混著投會變成好幾隻耳朵
          float ear = smoothstep(${num(P.earFront[0])}, ${num(P.earFront[0] + .08)}, p.y) * smoothstep(${num(P.earFront[1])}, ${num(P.earFront[1] + .1)}, p.z);
          float inner = smoothstep(0.15, 0.4, m.z) * smoothstep(0.6, 0.64, p.z) * (1.0 - smoothstep(0.37, 0.41, abs(p.x)));
          vec3 fur = vec3(0.97, 0.93, 0.9);
          c = mix(c, mix(fur, panel(p.x, h, 0.0), inner), ear);
        }` : ''}
        // 閉眼：眼睛範圍由上往下蓋上周圍的毛色，下緣畫一條彎彎的眼線
        if (lid > 0.01 && p.z > ${num(P.face + .1)}) for (int i = 0; i < 2; i++) {
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
        ${P.sideEye ? `if (lid > 0.01 && abs(m.x) > 0.3) {   // 側面圖的眼睛也要一起閉上
          vec2 q = (vec2(p.z, p.y) - vec2(${num(P.sideEye[0])}, ${num(P.sideEye[1])})) / vec2(${num(P.sideEye[2])}, ${num(P.sideEye[3])});
          float inside = (1.0 - smoothstep(0.9, 1.15, length(q))) * smoothstep(0.3, 0.65, abs(m.x)) * (1.0 - face);
          if (inside > 0.0 && q.y > 1.1 - 2.2 * lid) c = mix(c, panel(p.z - 0.06, h + ${num(P.sideEye[3])} * 1.8, 1.0), inside);
          if (lid > 0.75 && abs(q.x) < 0.85) c = mix(c, vec3(0.045, 0.018, 0.01), (1.0 - smoothstep(0.07, 0.13, abs(q.y - (-0.38 + 0.42 * q.x * q.x)))) * smoothstep(0.3, 0.65, abs(m.x)) * (1.0 - face));
        }` : ''}
        ${P.crisp ? `{   // 白毛上除了眼睛和口鼻，不該有任何深色：殘影一律蓋掉
          float eyeZone = step(0.5, p.z) * smoothstep(1.44, 1.47, p.y) * (1.0 - smoothstep(1.71, 1.74, p.y)) * (1.0 - smoothstep(0.3, 0.34, abs(p.x)));
          float mouthZone = step(0.8, p.z) * smoothstep(1.06, 1.1, p.y) * (1.0 - smoothstep(1.55, 1.6, p.y)) * (1.0 - smoothstep(0.26, 0.31, abs(p.x)));
          float dark = 1.0 - smoothstep(0.35, 0.62, dot(c, vec3(0.3, 0.59, 0.11)));
          float pink = smoothstep(0.1, 0.2, c.r - c.g) * smoothstep(0.2, 0.3, c.r);
          c = mix(c, vec3(0.93, 0.88, 0.85), dark * (1.0 - pink) * (1.0 - max(eyeZone, mouthZone)));
          // 粉紅色只留在內耳、腮紅和舌頭，別處（例如尾巴）投到的蓋掉
          float cheekZone = step(0.6, p.z) * smoothstep(1.3, 1.34, p.y) * (1.0 - smoothstep(1.58, 1.62, p.y)) * (1.0 - smoothstep(0.46, 0.5, abs(p.x)));
          float earZone = smoothstep(1.76, 1.8, p.y) * step(0.05, p.z);
          float tint = smoothstep(0.03, 0.09, c.r - c.g) * smoothstep(0.35, 0.5, c.r);
          c = mix(c, vec3(0.97, 0.93, 0.9), tint * (1.0 - max(max(cheekZone, mouthZone), max(earZone, eyeZone))));
          // 毛的立體感改照模型本身的起伏打淡影（原圖的陰影線投上來會變污點）
          float white = smoothstep(0.55, 0.75, dot(c, vec3(0.3, 0.59, 0.11)));
          float lit = smoothstep(-0.35, 0.6, dot(m, normalize(vec3(0.25, 0.75, 0.6))));
          c *= mix(vec3(1.0), mix(vec3(0.8, 0.74, 0.74), vec3(1.0), lit), white);
        }` : ''}
        ${P.hideFarEye ? `for (int i = 0; i < 2; i++) {   // 背向鏡頭那側的眼睛只剩一條黑線，蓋回毛色
          vec2 ctr = i == 0 ? vec2(${e[0][0]}, ${e[0][1]}) : vec2(${e[1][0]}, ${e[1][1]});
          float inside = (1.0 - smoothstep(1.2, 1.45, length((p.xy - ctr) / vec2(${er[0]}, ${er[1]})))) * step(${num(P.face)}, p.z);
          c = mix(c, vec3(0.97, 0.93, 0.9), inside * (1.0 - smoothstep(0.45, 0.6, facing)));
        }` : ''}
        ${P.nose ? `{ vec3 q = (p - vec3(${P.nose[0].map(num)})) / vec3(${P.nose[1].map(num)});   // 鼻頭和上面的亮點
          c = mix(c, vec3(0.028, 0.01, 0.005), 1.0 - smoothstep(0.9, 1.08, length(q)));
          c = mix(c, vec3(0.11, 0.055, 0.035), (1.0 - smoothstep(0.7, 1.1, length((q.xy - vec2(-0.25, 0.42)) / vec2(0.36, 0.2)))) * step(0.0, q.z) * step(length(q), 1.05)); }` : ''}
        gl_FragColor = vec4(c, 1.0);
        #include <colorspace_fragment>
      }`});
    group.updateMatrixWorld(true);
    const skeleton = new THREE.Skeleton(order.map(k => bones[k]));
    const mesh = new THREE.SkinnedMesh(g, skin); mesh.frustumCulled = false; group.add(mesh); mesh.updateMatrixWorld(true); mesh.bind(skeleton);
    // 外框：沿法線外擴的背面
    const hull = g.clone(), hp = hull.attributes.position, hn = hull.attributes.normal;
    for (let i = 0; i < hp.count; i++) hp.setXYZ(i, hp.getX(i) + hn.getX(i) * outline, hp.getY(i) + hn.getY(i) * outline, hp.getZ(i) + hn.getZ(i) * outline);
    // 口鼻的外框退得更深：對著背景時照樣有輪廓，對著自己的臉時不會畫出一道黑弧
    const extra = new Float32Array(hp.count), rest = g.attributes.position;
    if (P.crisp) for (let i = 0; i < hp.count; i++) { const x = rest.getX(i), y = rest.getY(i), z = rest.getZ(i);
      extra[i] = .45 * scale * sm(.78, .92, z) * (1 - sm(.32, .42, Math.abs(x))) * sm(.98, 1.08, y) * (1 - sm(1.66, 1.76, y)); }
    hull.setAttribute('aSink', new THREE.BufferAttribute(extra, 1));
    const sink = ((P.sink || .1) * scale).toFixed(3);   // 外框往後退多少；蓬毛皺褶多的要退深一點，才不會穿出黑色碎線
    const ink = new THREE.MeshBasicMaterial({color:P.ink, side:THREE.BackSide});
    ink.onBeforeCompile = sh => { sh.vertexShader = 'attribute float aSink;\n' + sh.vertexShader.replace('#include <project_vertex>', '#include <project_vertex>\n if (isOrthographic) mvPosition.z -= ' + sink + ' + aSink; else mvPosition.xyz += normalize(mvPosition.xyz) * (' + sink + ' + aSink); gl_Position = projectionMatrix * mvPosition;'); };
    ink.customProgramCacheKey = () => 'pet-gen-ink' + sink;
    const line = new THREE.SkinnedMesh(hull, ink); line.layers.set(HULL_LAYER); line.frustumCulled = false; group.add(line); line.updateMatrixWorld(true); line.bind(skeleton, mesh.bindMatrix);
    mesh.raycast = line.raycast = () => {};   // 點選交給遊戲裡的平面範圍，4 萬面不做射線偵測
    group.scale.setScalar(scale);
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
      const [tilt, drop] = P.sit || [-.66, .24];
      set('torso', [0, -drop, 0, tilt]); set('head', [0, A.white ? -.14 : 0, A.white ? .28 : 0, -tilt * .92]);
      for (const k of ['BL', 'BR']) set(k, [(k === 'BL' ? 1 : -1) * .07, -(legLen - S.lr * 1.9), .22, -1.42]);
      const up = Math.sin(-tilt) * (S.legF[2] - bz) - drop;   // 胸口抬高多少，前腳就跟著拉長
      for (const k of ['FL', 'FR']) { set(k, [0, up * .78, -.14]); o[k][6] = 1 + up * .78 / legLen; }
      set('tail', [0, 0, 0, P.tp.sit, Math.sin(t * 1.6) * .14]);
    };
    const lie = (headDown) => {
      set('torso', [0, -low, 0]); set('head', [0, -headDown, .05]);
      for (const k of ['FL', 'FR']) { set(k, [0, -(legLen - S.lr * 1.15), .1, -1.52]); o[k][6] = .7; }
      for (const k of ['BL', 'BR']) { set(k, [(k === 'BL' ? 1 : -1) * .1, -(legLen - S.lr * 1.4), .26, -1.5]); o[k][6] = .55; }
      set('tail', [0, 0, 0, P.tp.lie, 1.1]);
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
      set('tail', [0, 0, 0, P.tp.run + c * .15]); tongueOut = isCat ? 0 : 1;
    } else if (pose === 'sit') sit();
    else if (pose === 'groom') {
      sit(); eyes = 0; tongueOut = 1; const lick = Math.sin(t * 9) * .09;
      set('FR', [.02, .1, .12, -1.05 + lick]); set('head', [-.02, -.05, .02, .3 + lick * .4, -.16, -.1]);
    } else if (pose === 'loaf') { lie(id === 'cat' || id === 'cat2' ? .2 : .1); eyes = 0; tongueOut = 0; set('torso', [0, breathe]); }
    else if (pose === 'down') { lie(.16); eyes = 0; tongueOut = 0; set('torso', [0, breathe]); set('tail', [0, 0, 0, 0, Math.sin(t * 3) * .2]); }
    else if (pose === 'sleep') {
      lie(.5); eyes = 0; tongueOut = 0; set('head', [.14, .04, .16, .03, .38, .2]); set('torso', [0, breathe * 1.8, 0, 0, -.16]); set('tail', [0, 0, 0, P.tp.sleep, .7]);
    } else if (pose === 'eat') {
      const drop = Math.max(.35, hy - ry * 1.5), chew = Math.abs(Math.sin(t * 9)) * .05;
      set('torso', [0, -.08, 0, .22]); set('head', [0, -drop * .5 - chew, .12, .38 + chew]);
      for (const k of ['FL', 'FR']) set(k, [0, 0, .02, 0]); set('tail', [0, 0, 0, P.tp.eat, Math.sin(t * 5) * .25]); tongueOut = 0; eyes = isCat ? .5 : 1;
    } else if (pose === 'wag') {
      const w = Math.sin(t * 14);
      set('torso', [0, Math.abs(w) * .03, 0, 0, w * .09]); set('head', [0, 0, 0, -.1, -w * .06, w * .05]); set('tail', [0, 0, 0, 0, w * .75]); tongueOut = 1;
    } else if (pose === 'belly') {
      const w = Math.sin(t * 7);
      set('roll', [0, -(by - br[1] * .95), 0, 0, 0, Math.PI + w * .16]);
      set('head', [0, .34, .16, .1, 0, -Math.PI * .92]);
      for (const [k, d] of [['FL', 1], ['FR', -1], ['BL', -1], ['BR', 1]]) set(k, [0, 0, 0, (k[0] === 'F' ? -.6 : .35) + w * .25 * d]);
      set('tail', [0, 0, 0, P.tp.belly, w * .4]); eyes = 0; tongueOut = 1;
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

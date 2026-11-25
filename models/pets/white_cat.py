# 用白膜三視圖量到的數值重建試作版的貓（每次都從線上版 pets3d.js 重新產生 pets3d-draft.js）
# 量測座標＝白膜圖放大 3 倍的裁切圖：正面 x0=40、側面 x0=1030、y0=140
import json, re
src = open('pixel-plaza/pets3d.js', encoding='utf-8').read()
K = 1.332 / 3                                   # 裁切像素 → 模型量測單位
GY, FX, SZ = 507, 319, 770
V = lambda y: round(GY - (1149 - y) * K, 1)      # 高度
U = lambda x: round(SZ + (x - 565) * K, 1)       # 前後（側面圖，右邊是前方）
W = lambda px: round(px * K, 1)                  # 長度、半寬
XU = lambda off: round(FX - off * K, 1)          # 正面圖左右偏移 → 原圖左半邊 u
HDY = 0                                          # 頭部高度以正面圖為準

# 頭：[y, 後緣 x, 前緣 x, 半寬]
head0 = [[194.5,862,886,14],[197,838,902,48],[204,800,922,96],[216,758,946,136],[240,708,972,184],[270,662,992,222],[300,632,1008,244],[340,611,1026,262],
        [380,606,1040,274],[420,612,1048,279],[455,624,1052,277],[490,648,1050,262],[520,682,1034,238],[550,728,1008,202],[575,782,976,162],[595,840,942,108],[608,878,912,58]]
# 側面輪廓：使用者提供的黑線比例尺（右近側面）逐點量出，座標 (y, 後緣 x, 前緣 x)；已扣掉約 3px 描邊。眼睛中心 y=68 對齊 v=163
SIDE = [(26.5,45,75),(28,36,87),(31,29,95),(36,21,102),(44,11,110),(52,6,115.5),(60,3,117.5),(65.5,2.3,117.8),(71,1.8,123),(76,1.5,125.5),(81,1.5,126),(86,2,125.5),(91,6,124),(96,16,120),(101,32,115),(108,52,107),(113,68,98),(117,80,89)]
def head_half(v):   # 正面半寬沿用正面白膜量到的值
    pts = [(V(y), W(w)) for y, a, b, w in head0]
    if v <= pts[0][0]: pass
    pts.sort()
    for (v0, w0), (v1, w1) in zip(pts, pts[1:]):
        if v0 <= v <= v1: return round(w0 + (w1 - w0) * (v - v0) / (v1 - v0), 1)
    return pts[0][1] if v < pts[0][0] else pts[-1][1]
head = [[round(163 + (y - 68) * 1.88, 1), round(779 + 1.88 * a, 1), round(779 + 1.88 * b, 1)] for y, a, b in SIDE]
head = [[v, a, b, head_half(v)] for v, a, b in head]
# 身體：[x, 上緣 y, 下緣 y, 半寬]
body = [[140,690,835,125],[172,612,900,195],[225,558,925,240],[300,522,938,268],[400,506,938,272],[500,508,950,262],[600,520,955,252],
        [690,515,950,240],[780,528,930,228],[880,576,900,204],[918,610,886,180],[940,642,866,148],[953,668,848,114],[961,696,824,74],[965,724,798,34]]
tail = [[270,620],[188,545],[140,455],[132,362],[160,275],[228,212],[312,188]]
tail_r = [70,80,86,84,76,64,54]

GY_OF = {'cat': 507, 'cat2': 505}
FACE_V = {'cat': [82, 163, 205, 232, 262], 'cat2': [86, 178, 215, 238, 264]}   # 頭頂、眼、鼻、嘴、下巴
def cat(key, art, collar):
    d = {
      'white': 1,
      'head': head,
      
      'body': [[U(x), V(a), V(b), W(w * .91)] for x, a, b, w in body],
      'pivot': {'head': [V(400), U(838)], 'body': [V(730), U(545)]},
      'front': {'x': W(86), 'u': U(750), 'top': V(770), 'r': [W(96), W(76), W(70)], 'path': [U(748), U(752), U(768), U(790)], 'bottom': 1},
      'hind': {'x': W(150), 'u': U(240), 'top': V(780), 'r': [W(105), W(72), W(62)], 'path': [U(305), U(222), U(215), U(252)],
               'thigh': [U(285), V(765), W(150), W(170), W(95)]},
      'paw': [W(95), W(48), W(78)],
      'ear': {'base': [319 - 66, 507 - 386, U(745)], 'tip': [319 - 108, 507 - 464, U(778)], 'w': 46, 'd': 34, 'turn': .62},
      'tail': {'pts': [[U(x), V(y)] for x, y in tail], 'r': [W(r) for r in tail_r]},
      'eyeAt': [46, GY_OF[key] - 344, 24.5, 25.5],      # 眼睛中心高度 y=1.72
      'muzzleAt': [V(490), W(106), W(56)],
      'faceMap': [[(507 - v) / 200 for v in FACE_V['cat']], FACE_V[key]],   # 模型高度 → 原圖高度（分段對位）
      'collar': collar,
      'nose': [0xd9806e, 0xfdf4e8] if key == 'cat' else [0xd58b7c, 0xf7e3c4],
    }
    d.update(art)
    return d

old = {}
for key in ('cat', 'cat2'):
    block = src[src.index('  %s:{\n    head:' % key):]
    block = block[:block.index('\n  },\n')]
    eyes = json.loads(re.search(r'eyes:(\[\[.*?\]\])', block).group(1))
    muz = json.loads(re.search(r'muzzlePatch:(\[.*?\])', block).group(1))
    old[key] = {'eyes': eyes, 'muzzlePatch': muz}
boxes = {"cat":{"torso":[-0.612,0.393,-1.015,0.612,1.449,0.995],"head":[-0.637,1.225,0.138,0.637,2.18,1.275],"ear+":[0.186,1.706,0.363,0.65,2.352,0.684],"ear-":[-0.65,1.706,0.363,-0.186,2.352,0.684],"tail":[-0.18,0.944,-1.127,0.18,2.215,-0.439],"legFL":[0.015,0.001,0.34,0.415,0.982,0.82],"legFR":[-0.415,0.001,0.34,-0.015,0.982,0.82],"legBL":[0.111,0.001,-0.98,0.58,1.014,-0.36],"legBR":[-0.58,0.001,-0.98,-0.111,1.014,-0.36]},
"cat2":{"torso":[-0.561,0.404,-0.785,0.561,1.316,0.935],"head":[-0.635,1.19,0.148,0.635,2.17,1.255],"ear+":[0.198,1.701,0.343,0.64,2.311,0.652],"ear-":[-0.64,1.701,0.343,-0.198,2.311,0.652],"tail":[-0.2,0.106,-1.308,0.2,1.109,-0.465],"legFL":[0.015,0.001,0.29,0.415,0.972,0.77],"legFR":[-0.415,0.001,0.29,-0.015,0.972,0.77],"legBL":[0.111,0.001,-0.87,0.58,1.004,-0.25],"legBR":[-0.58,0.001,-0.87,-0.111,1.004,-0.25]}}
collar = [U(812), W(196), V(566), W(70), W(208), V(678), W(52)]   # [中心 u, 前後半徑, 中心 v, 前傾, 左右半寬, 鈴鐺 v, 鈴鐺半徑]
entries = ''
for key in ('cat', 'cat2'):
    d = cat(key, dict(old[key], art=boxes[key]), collar)
    entries += '  %s:%s,\n' % (key, json.dumps(d, separators=(',', ':')))

s = src
def rep(a, b, count=1):
    global s
    assert s.count(a) >= 1, a[:80]
    s = s.replace(a, b, count)
i, j = s.index('  cat:{\n    head:'), s.index('  dog1:{\n    head:')
s = s[:i] + entries + s[j:]

# 花紋對回原圖：每個部位把新造型的範圍線性對到舊造型的範圍
rep("  // 合併每根骨頭的零件\n", """  // 花紋對回原圖：新造型每個部位的取樣範圍，線性對到原圖造型同一部位的範圍
  if (A.art) for (const b of bones) {
    const box = A.art[b.name === 'ear' ? 'ear' + (b.position.x > 0 ? '+' : '-') : b.name], list = b.userData.skin.filter(g => g.attributes.aK.getW(0) < .5);
    if (!box || !list.length) continue;
    const lo = [9, 9, 9], hi = [-9, -9, -9];
    for (const g of list) { const a = g.attributes.aRest.array; for (let i = 0; i < a.length; i++) { lo[i % 3] = Math.min(lo[i % 3], a[i]); hi[i % 3] = Math.max(hi[i % 3], a[i]); } }
    for (const g of list) { const a = g.attributes.aRest.array; for (let i = 0; i < a.length; i++) { const k = i % 3; a[i] = box[k] + (a[i] - lo[k]) * (box[k + 3] - box[k]) / Math.max(1e-3, hi[k] - lo[k]); } }
  }

  // 合併每根骨頭的零件
""")
# 腳：白膜有各段的前後位置
rep("paint(legs[k], tube([V(x, Y(L.top), Z(L.u)), V(x, Y((L.top + R.gy) / 2), Z(L.u - (front ? 2 : 10))), V(x, Y(R.gy - ph * 1.5), Z(L.u + 4))]",
    "const lu = L.path || [L.u, L.u - (front ? 2 : 10), L.u + 4, L.u + 12];\n    paint(legs[k], tube([V(x, Y(L.top), Z(lu[0])), V(x, Y((L.top + R.gy) / 2), Z(lu[1])), V(x, Y(R.gy - ph * 1.5), Z(lu[2]))]")
rep("paint(legs[k], oval(x, Y(R.gy - ph), Z(L.u + 12),", "paint(legs[k], oval(x, Y(R.gy - ph), Z(lu[3]),")
# 腳趾縫
rep("[1.25, 1.1, 1]);\n  }", """[1.25, 1.1, 1]);
    if (A.white && A.toes) for (const t of [-.36, 0, .36]) { const arc = [.05, .3, .55, .8].map(e => V(x + t * pwid / PX * Math.cos(e) * 1.02, Y(R.gy - ph) + Math.sin(e) * ph / PX * 1.03, Z(lu[3]) + Math.sqrt(1 - t * t) * Math.cos(e) * pl / PX * 1.02));
      ink(legs[k], tube(arc, [.004, .008, .007, .003], {n:12, sides:6}), R.ink); }
  }""")
rep("power:isCat ? 2.35 : 2.15", "power:A.white ? 2.05 : isCat ? 2.35 : 2.15")
# 嘴線只畫下緣
rep("[[.42, -.66], [.7, -.64], [.98, -.54], [1.24, -.36], [1.42, -.16]]", "(A.white ? [[.35, -.72], [.62, -.66], [.9, -.52], [1.15, -.34], [1.35, -.14]] : [[.42, -.66], [.7, -.64], [.98, -.54], [1.24, -.36], [1.42, -.16]])")
# 眼睛、口鼻：來源仍是原圖位置，貼到白膜上的位置
rep("function patch(b, [cu, cv, pu, pv], lift, yaw = 0, shift = 0){", "function patch(b, [su, sv, qu, qv], lift, yaw = 0, shift = 0, at = null){\n    const [cu, cv, pu, pv] = at || [su, sv, qu, qv];")
rep("uv.push((1380 + 200 + X(cu + du) * PX) / ATLAS, 1 - (500 - Y(cv + dv) * PX) / 520);",
    "const au = su + Math.cos(a) * qu * k, av = sv + Math.sin(a) * qv * k; uv.push((1380 + 200 + X(au) * PX) / ATLAS, 1 - (500 - Y(av) * PX) / 520);")
rep("""    const side = Math.sign(X(e[0])), yaw = side * (isCat ? .76 : .7), shift = side * (A.eyeGap || 0);
    patch(eyesO, e, .018, yaw, shift);
    const [cu, cv, pu, pv] = e,""", """    const side = Math.sign(X(e[0])), at = A.eyeAt ? [R.fx + side * A.eyeAt[0], A.eyeAt[1], A.eyeAt[2], A.eyeAt[3]] : null;
    const yaw = side * (at ? 0 : isCat ? .76 : .7), shift = at ? 0 : side * (A.eyeGap || 0);
    patch(eyesO, e, .018, yaw, shift, at);
    const [cu, cv, pu, pv] = at || e,""")
rep("eyesO = bone(face, [0, Y(A.eyes[0][1]), hz], 'eyesOpen')", "eyesO = bone(face, [0, Y(A.eyeAt ? A.eyeAt[1] : A.eyes[0][1]), hz], 'eyesOpen')")
rep("  patch(face, A.muzzlePatch, .01);", "  const mAt = A.muzzleAt ? [R.fx, ...A.muzzleAt] : null;\n  patch(face, A.muzzlePatch, .01, 0, 0, mAt);")
rep("if (isCat) { const [u, v] = A.muzzlePatch,", "if (isCat) { const [u, v] = mAt || A.muzzlePatch,")
# 項圈與鈴鐺位置
rep("""    const [uc, d, vc, tilt, w] = id === 'cat' ? [890, 86, 250, 28, 108] : [880, 88, 262, 30, 110];""",
    """    const [uc, d, vc, tilt, w, bellV, bellR] = A.collar || (id === 'cat' ? [890, 86, 250, 28, 108] : [880, 88, 262, 30, 110]);""")
rep("paint(head, oval(0, Y(292), Z(uc + d + 6), .135, .135, .11), null,", "const bv_ = bellV || 292, br_ = bellR ? bellR / PX : .135, dz = br_ * .8;\n      paint(head, oval(0, Y(bv_), Z(uc + d + 6), br_, br_, dz), null,")
rep("for (const [y, r] of [[286, .036], [302, .018]]) paint(head, oval(0, Y(y), Z(uc + d + 6) + .108, r, y > 290 ? .05 : r, .018, {seg:12})",
    "for (const [y, r] of [[bv_ - 6, .036], [bv_ + 10, .018]]) paint(head, oval(0, Y(y), Z(uc + d + 6) + dz * .98, r, y > bv_ ? .05 : r, .018, {seg:12})")
rep("group.scale.set(S.scale, S.scale * 1.08, S.scale);", "group.scale.set(S.scale, S.scale * (A.white ? 1.03 : 1.08), S.scale);")
rep("side.applyAxisAngle(turn, s * .55); dep.applyAxisAngle(turn, s * .55);", "side.applyAxisAngle(turn, s * (E.turn || .55)); dep.applyAxisAngle(turn, s * (E.turn || .55));")
rep("const sink = id === 'dog2' ? .16 : id === 'dog1' ? .06 : .045;", "const sink = id === 'dog2' ? .16 : id === 'dog1' ? .06 : A.white ? .085 : .045;")
# 頭部花紋直接用原圖座標（高度分段對位），原圖畫好的鼻子、嘴巴、鬍鬚才會落在正確位置
rep("for (let i = 0; i < a.length; i++) { const k = i % 3; a[i] =", "for (let i = 0; i < a.length; i++) { const k = i % 3;\n      if (b.name === 'head' && A.faceMap && k < 2) { if (k === 1) { const [from, to] = A.faceMap, y = a[i]; let j = 0; while (j < from.length - 2 && y < from[j + 1]) j++; a[i] = Y(to[j] + (from[j] - y) / (from[j] - from[j + 1]) * (to[j + 1] - to[j])); } continue; }\n      a[i] =")
# 嘴線改用原圖（另外畫線會變成兩層嘴巴）
rep("    ink(head, tube(arc, [.005, .011, .012, .01, .004], {n:20, sides:8}), R.ink); } }", "    if (!A.white) ink(head, tube(arc, [.005, .011, .012, .01, .004], {n:20, sides:8}), R.ink); } }")
rep("set('head', [0, 0, 0, -tilt * .92]);", "set('head', [0, A.white ? .07 : 0, A.white ? .13 : 0, -tilt * .92]);")
s = s.replace('Z(uc + d + 6)', 'Z(uc + d + (A.white ? 16 : 6))')
# ── 臉：鼻子、嘴邊、下巴直接雕在同一顆頭上 ──
rep("loft('y', [...A.head].reverse(), {n:48, sides:64,", "loft('y', [...A.head].reverse(), {n:A.white ? 110 : 48, sides:A.white ? 144 : 64,")
rep("  paint(head, headGeo[0], [1.55, 1, 1]);\n", """  const EYE_TAN = .85, bump = (x, y, cx, cy, rx, ry) => Math.exp(-(((x - cx) / rx) ** 2 + ((y - cy) / ry) ** 2));
  if (A.white) { const p = headGeo[0].attributes.position;   // 嘴邊、鼻梁、下巴：同一顆頭上的柔和隆起
    for (let i = 0; i < p.count; i++) { const x = p.getX(i), y = p.getY(i), z = p.getZ(i), f = sm(.7, 1.0, z); if (!f) continue;
      const pad = 1 - (1 - bump(x, y, .095, 1.43, .12, .098)) * (1 - bump(x, y, -.095, 1.43, .12, .098));
      p.setZ(i, z + f * .018 * pad); }
    const ex = A.eyeAt[0] / PX, ey = Y(A.eyeAt[1]), ea = A.eyeAt[2] / PX, eb = A.eyeAt[3] / PX;
    let zc = 0, best = 9; for (let i = 0; i < p.count; i++) { if (p.getZ(i) < .7) continue; const d = Math.hypot(Math.abs(p.getX(i)) - ex, p.getY(i) - ey); if (d < best) { best = d; zc = p.getZ(i); } }
    zc -= .05; head.userData.eyeZ = zc;
    for (let i = 0; i < p.count; i++) { const z = p.getZ(i); if (z < .5) continue; const q = Math.abs(p.getX(i)) - ex, w = 1 - sm(1.08, 2.1, Math.hypot(q / ea, (p.getY(i) - ey) / eb)); if (w > 0) p.setZ(i, z + (zc - q * EYE_TAN - z) * w); }
    headGeo[0].computeVertexNormals(); }
  paint(head, headGeo[0], [1.55, 1, 1]);
  if (A.white) {   // 臉的範圍只用正面原圖（混到側面圖會出現兩層鼻嘴）
    const k = head.userData.skin[head.userData.skin.length - 1].attributes.aK, p = headGeo[0].attributes.position;
    for (let i = 0; i < p.count; i++) { if (p.getZ(i) < .7) continue; const nz = headGeo[0].attributes.normal.getZ(i), near = (1 - sm(.85, 1.3, Math.hypot(p.getX(i) / .36, (p.getY(i) - 1.48) / .29))) * sm(.7, .9, p.getZ(i)), w = near * sm(.2, .55, nz);
      k.setX(i, 1.55 + 5 * w); k.setY(i, 1 - .88 * w);
      head.userData.skin[head.userData.skin.length - 1].attributes.aCol.setX(i, .075 * Math.exp(-(((p.getY(i) - 1.45) / .16) ** 2)) * sm(.65, .95, p.getZ(i))); } }
""")
rep("  patch(face, A.muzzlePatch, .01, 0, 0, mAt);", """  if (!A.white) patch(face, A.muzzlePatch, .01, 0, 0, mAt);""")
rep("if (isCat) { const [u, v] = mAt || A.muzzlePatch, x = X(u), y = Y(v + 20);", "if (isCat) { const [u, v] = mAt || A.muzzlePatch, x = X(u), y = A.white ? 1.35 : Y(v + 20);")
# 耳朵：前面凹、邊緣厚、尖端圓
rep("""const t = -.3 + 1.3 * i / 18, k = clamp(t), w = E.w / PX * (1 - .88 * Math.pow(k, 1.45)),""", """const t = -.3 + 1.3 * i / 18, k = clamp(t), w = E.w / PX * (A.white ? Math.max(.14, Math.pow(1 - Math.pow(k, 1.75), .82)) : 1 - .88 * Math.pow(k, 1.45)),""")
rep("return at.clone().addScaledVector(side, Math.cos(a) * w).addScaledVector(dep, Math.sin(a) * d * hollow); })); }",
    "let z = Math.sin(a) * hollow;\n          if (A.white) { const c2 = Math.cos(a) ** 2, facing = Math.sin(a) * (dep.z > 0 ? 1 : -1); z = facing > 0 ? Math.sign(dep.z) * (1.5 * c2 * (1 - c2) - .42 * (1 - c2) ** 2) * Math.min(1, (1 - k) * 2.5) : Math.sin(a); }\n          return at.clone().addScaledVector(side, Math.cos(a) * w).addScaledVector(dep, z * d); })); }")
# 坐下：頭往後收到胸口上方
s = s.replace("set('head', [0, A.white ? .07 : 0, A.white ? .13 : 0, -tilt * .92]);", "set('head', [0, A.white ? -.14 : 0, A.white ? .28 : 0, -tilt * .92]);")
rep("const au = su + Math.cos(a) * qu * k, av = sv + Math.sin(a) * qv * k;", "const au = su + Math.cos(a) * (at ? pu : qu) * k, av = sv + Math.sin(a) * (at ? pv : qv) * k;")
s = s.replace("A.white ? .085 : .045", "A.white ? .11 : .045")
# 白膜版的收尾圈不要往外突（否則頭頂、胸口會冒出小凸點）
rep("rings.push(ring(shrink(rows[0], f), 0, -dir * d));", "rings.push(ring(shrink(rows[0], f), 0, -dir * d * (A.white ? .12 : 1)));")
rep("rings.push(ring(shrink(rows[rows.length - 1], f), 1, dir * d));", "rings.push(ring(shrink(rows[rows.length - 1], f), 1, dir * d * (A.white ? .12 : 1)));")
rep("vec3 cS = texture2D(map, vec2((690.0 + vRest.z * 200.0) / ${ATLAS}.0, ty)).rgb;", "vec3 cS = texture2D(map, vec2((690.0 + vRest.z * 200.0) / ${ATLAS}.0, ty + (1.0 - step(0.001, vK.w)) * vSolid.x * 200.0 / 520.0)).rgb;")
s = s.replace("assets/pets3d/' + id + '.webp?v=7'", "assets/pets3d/' + id + '.webp?v=10'")
# 眼睛：固定在臉上的微凸鏡片（略朝外），任何角度都是同一顆，不切換、不跟著頭的曲面皺折
rep("pos.push(h.x + d.x * lift, h.y, h.z + d.z * lift);", """if (at) { const x = c.x + du / PX; pos.push(x, Y(cv + dv), head.userData.eyeZ - (Math.abs(x) - Math.abs(c.x)) * EYE_TAN + .012 + .034 * (1 - k * k)); }
      else pos.push(h.x + d.x * lift, h.y, h.z + d.z * lift);""")
# 鈴鐺自己描一圈貼身的邊（坐下時鈴鐺離胸口遠，整體外框會變成一圈懸空的黑環）
rep("n.y * .7 + n.z * .5))});", """n.y * .7 + n.z * .5)), line:!A.white});
      if (A.white) { const rim = new THREE.Mesh(local(head, oval(0, Y(bv_), Z(uc + d + 16), br_ * 1.14, br_ * 1.14, dz * 1.14)), new THREE.MeshBasicMaterial({color:R.ink, side:THREE.BackSide})); head.add(rim); }""")
open('pixel-plaza/pets3d-draft.js', 'w', encoding='utf-8').write(s)
print('ok')

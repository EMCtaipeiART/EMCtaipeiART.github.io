# Machi Q 版 3D 人物（第二版）
# 輪廓：照原圖正面／側面逐段量出來。臉的五官取自 expedition/story/Machi_neutral.webp（高解析正面），
# 頭髮顏色與髮際線由正面圖＋ pixel-plaza/sprites-hd/Machi.png（12 角度）投影成貼圖。
# 執行：blender --background --factory-startup --python models/machi/build_machi.py -- <預覽圖輸出資料夾>
# 座標：Z 向上、面朝 -Y；原圖 1 單位 = 36.92 px，腳底 z≈0、髮頂 z≈5.96。
import bpy, bmesh, math, os, sys
import numpy as np
from mathutils import Vector, Matrix

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(os.path.dirname(HERE))
OUT = sys.argv[sys.argv.index('--') + 1] if '--' in sys.argv else HERE
PX = 36.92
bpy.ops.wm.read_factory_settings(use_empty=True)
scene = bpy.context.scene

def Z(v): return 3.0 + (120 - v) / PX          # 原圖列 → 高度
def Y(u): return -(u - 120) / PX               # 側面圖欄 → 前後

# ───────── 原圖 ─────────
def load(path):
    im = bpy.data.images.load(path)
    w, h = im.size
    a = np.empty(w * h * 4, np.float32); im.pixels.foreach_get(a)
    return a.reshape(h, w, 4)[::-1].copy()

SHEET = load(os.path.join(ROOT, 'pixel-plaza/sprites-hd/Machi.png'))
NEU = load(os.path.join(ROOT, 'expedition/story/Machi_neutral.webp'))

def neutral_px(x, z):
    """模型座標 → 高解析正面圖像素。"""
    u = 121.5 + x * PX; v = 120 - (z - 3) * PX
    return 208 + (u - 121.5) * 2.64, 18 + (v - 10.5) * 2.66

def sample(img, px, py):
    h, w = img.shape[:2]
    px = np.clip(px - .5, 0, w - 1.001); py = np.clip(py - .5, 0, h - 1.001)
    x0, y0 = px.astype(int), py.astype(int); fx, fy = (px - x0)[..., None], (py - y0)[..., None]
    return ((img[y0, x0] * (1 - fx) + img[y0, x0 + 1] * fx) * (1 - fy) +
            (img[y0 + 1, x0] * (1 - fx) + img[y0 + 1, x0 + 1] * fx) * fy)

def erode(m, n):
    for _ in range(n):
        k = m.copy()
        k[1:] &= m[:-1]; k[:-1] &= m[1:]; k[:, 1:] &= m[:, :-1]; k[:, :-1] &= m[:, 1:]
        m = k
    return m

def dilate(m, n):
    return ~erode(~m, n)

def in_poly(px, py, poly):
    inside = np.zeros(px.shape, bool)
    for (ax, ay), (bx, by) in zip(poly, poly[1:] + poly[:1]):
        if ay == by:
            continue
        hit = ((ay > py) != (by > py)) & (px < (bx - ax) * (py - ay) / (by - ay) + ax)
        inside ^= hit
    return inside

# ───────── 逐段放樣（loft） ─────────
def smooth_rows(rows, n=160):
    """rows: [(z, 半寬, 前緣y, 後緣y)]，由下往上；用 Catmull-Rom 補成 n 段。"""
    P = np.array(rows, float)
    P = np.vstack([P[0] * 2 - P[1], P, P[-1] * 2 - P[-2]])
    segs = len(P) - 3; out = []
    for i in range(n + 1):
        t = i / n * segs; k = min(int(t), segs - 1); u = t - k
        a, b, c, d = P[k], P[k + 1], P[k + 2], P[k + 3]
        out.append(.5 * (2 * b + (-a + c) * u + (2 * a - 5 * b + 4 * c - d) * u * u + (-a + 3 * b - 3 * c + d) * u ** 3))
    out = np.array(out); out[:, 1] = np.maximum(out[:, 1], .001)
    return out

def surf(R, th, t, power, cx=0.0, bump=None):
    """th: 0=正前、+π/2=+X、±π=正後；t: 0(底)..1(頂)。回傳 x,y,z。"""
    i = t * (len(R) - 1)
    k = np.arange(len(R))
    z, w, yf, yb = (np.interp(i, k, R[:, j]) for j in range(4))
    cy, d = (yf + yb) / 2, np.maximum((yb - yf) / 2, .001)
    s, c = np.sin(th), np.cos(th)
    s = np.sign(s) * np.abs(s) ** (2 / power); c = np.sign(c) * np.abs(c) ** (2 / power)
    b = 1 + (bump(th, z) if bump else 0)
    return cx + w * s * b, cy - d * c * b, z

def new_obj(name, verts, faces, m, uvs=None, smooth=True):
    me = bpy.data.meshes.new(name)
    me.from_pydata(verts, [], faces)
    me.materials.append(m)
    if uvs is not None:
        layer = me.uv_layers.new(name='UVMap')
        li = 0
        for fi, f in enumerate(faces):
            for uv in uvs[fi]:
                layer.data[li].uv = uv; li += 1
    for p in me.polygons:
        p.use_smooth = smooth
    me.update()
    o = bpy.data.objects.new(name, me); scene.collection.objects.link(o)
    return o

def loft(name, rows, m, nth=40, nt=24, power=2.4, cx=0.0, bump=None, uv=False, caps=True):
    R = smooth_rows(rows)
    th = np.linspace(-math.pi, math.pi, nth + 1); t = np.linspace(0, 1, nt + 1)
    TH, T = np.meshgrid(th, t)
    x, y, z = surf(R, TH, T, power, cx, bump)
    cols = nth + 1 if uv else nth
    verts = [(x[j, i], y[j, i], z[j, i]) for j in range(nt + 1) for i in range(cols)]
    faces, uvs = [], []
    for j in range(nt):
        for i in range(nth):
            a, b = i, (i + 1) % cols
            faces.append((j * cols + a, j * cols + b, (j + 1) * cols + b, (j + 1) * cols + a))
            uvs.append([(i / nth, j / nt), ((i + 1) / nth, j / nt), ((i + 1) / nth, (j + 1) / nt), (i / nth, (j + 1) / nt)])
    if caps:
        for j, rev in ((0, True), (nt, False)):
            ring = [j * cols + i for i in range(nth)]
            faces.append(tuple(ring[::-1] if rev else ring))
            uvs.append([(.5, j / nt)] * nth)
    return new_obj(name, verts, faces, m, uvs if uv else None), R

# ───────── 材質 ─────────
def lin(v): return v / 12.92 if v <= .04045 else ((v + .055) / 1.055) ** 2.4

MATS = {}
def mat(name, rgb, glow=.5):
    """glow 越高越不受燈光影響（接近原圖的平塗）。"""
    if name in MATS:
        return MATS[name]
    c = [lin(v / 255) for v in rgb]
    m = bpy.data.materials.new(name); m.use_nodes = True
    b = m.node_tree.nodes['Principled BSDF']
    b.inputs['Base Color'].default_value = (*[v * (1 - glow) for v in c], 1)
    b.inputs['Roughness'].default_value = .9
    b.inputs['Specular IOR Level'].default_value = 0
    b.inputs['Emission Color'].default_value = (*c, 1)
    b.inputs['Emission Strength'].default_value = glow
    MATS[name] = m
    return m

def tex_mat(name, rgba, clip=False):
    h, w = rgba.shape[:2]
    im = bpy.data.images.new(name, w, h, alpha=True)
    im.pixels.foreach_set(np.ascontiguousarray(rgba[::-1], np.float32).ravel()); im.pack()
    m = bpy.data.materials.new(name); m.use_nodes = True
    nt = m.node_tree; b = nt.nodes['Principled BSDF']
    t = nt.nodes.new('ShaderNodeTexImage'); t.image = im; t.extension = 'EXTEND'
    b.inputs['Base Color'].default_value = (0, 0, 0, 1)
    b.inputs['Specular IOR Level'].default_value = 0
    nt.links.new(t.outputs['Color'], b.inputs['Emission Color'])
    b.inputs['Emission Strength'].default_value = 1
    if clip:
        r = nt.nodes.new('ShaderNodeMath'); r.operation = 'ROUND'
        nt.links.new(t.outputs['Alpha'], r.inputs[0]); nt.links.new(r.outputs[0], b.inputs['Alpha'])
    return m

SKIN_RGB = (249, 188, 161)
SKIN = mat('skin', SKIN_RGB, 1)
PINK = mat('skin_pink', (240, 146, 124), .85)
CLOTH = mat('hoodie', (36, 33, 32), .7)
RIB = mat('hoodie_rib', (27, 25, 24), .7)
SEAM = mat('seam', (12, 10, 10), .9)
CORD = mat('cord', (20, 18, 18), .8)
METAL = mat('cord_tip', (150, 146, 142), .7)
SHOE = mat('shoe', (28, 28, 27), .65)
SOLE = mat('sole', (39, 39, 38), .7)
LACE = mat('lace', (52, 51, 50), .7)
SKINLINE = mat('skin_line', (196, 96, 76), .9)
CHICK = mat('chick', (253, 205, 52), .75)
CHICK2 = mat('chick_wing', (246, 184, 20), .75)
BEAK = mat('beak', (240, 136, 22), .8)
EYE = mat('chick_eye', (22, 16, 14), .9)
GLINT = mat('glint', (255, 255, 255), 1)

# ───────── 臉（頭的皮膚） ─────────
FACE_ROWS = [(Z(v), w / PX, Y(f), Y(b)) for v, w, f, b in (
    (113.8, 5, 140, 122), (112.5, 15, 153, 108), (110, 23.5, 161, 99), (105, 34, 167.5, 90),
    (100, 40, 170.5, 82), (93, 42, 171.5, 76), (85, 42, 170.5, 72), (75, 41.5, 170, 71),
    (65, 41, 169.5, 71), (55, 38.5, 167, 74), (45, 32, 161, 82), (36, 22, 150, 96), (31, 1, 128, 118))]

def face_texture(W=1024, H=768):
    R = smooth_rows(FACE_ROWS)
    U, V = np.meshgrid((np.arange(W) + .5) / W, 1 - (np.arange(H) + .5) / H)
    th = (U - .5) * 2 * math.pi
    x, y, z = surf(R, th, V, 2.35)
    skin = np.array(SKIN_RGB, np.float32) / 255
    col = np.ones((H, W, 3), np.float32) * skin
    front = np.cos(th) > .2
    nx, ny = neutral_px(x, z)
    # 腮紅
    for cx in (131, 285):
        a = np.exp(-(((nx - cx) / 19) ** 2 + ((ny - 246) / 11) ** 2) ** 1.5) * .55 * front
        col = col * (1 - a[..., None]) + np.array((246, 135, 122), np.float32) / 255 * a[..., None]
    s = sample(NEU, nx, ny)[..., :3]
    r, g, b = s[..., 0], s[..., 1], s[..., 2]
    gold = (r > .55) & (g > .3) & (b < .45) & (r - b > .35) & (g - b > .08)
    # 眼睛（含上眼線）
    for cx in (147.5, 268.5):
        d = np.sqrt(((nx - cx) / 33) ** 2 + ((ny - 211) / 31) ** 2)
        a = np.clip((1 - d) / .08, 0, 1) * front * ~gold
        col = col * (1 - a[..., None]) + s * a[..., None]
    # 眉毛、嘴巴：只取深色／紅色的筆畫
    for x0, x1 in ((132, 179), (237, 284)):
        a = np.clip((.62 - r) / .2, 0, 1) * ((nx > x0) & (nx < x1) & (ny > 147) & (ny < 173)) * front
        col = col * (1 - a[..., None]) + s * a[..., None]
    a = np.clip((.66 - g) / .12, 0, 1) * ((nx > 180) & (nx < 236) & (ny > 249) & (ny < 268)) * front
    col = col * (1 - a[..., None]) + s * a[..., None]
    # 臉緣一點暖色陰影
    edge = np.clip((np.abs(th) - .75) / .9, 0, 1) * .35 + np.clip((Z(106) - z) / .35, 0, 1) * .3
    edge = np.clip(edge, 0, .45)[..., None]
    col = col * (1 - edge) + np.array((236, 148, 124), np.float32) / 255 * edge
    return np.dstack([col, np.ones((H, W), np.float32)])

loft('head', FACE_ROWS, tex_mat('face', face_texture()), 72, 48, 2.35, uv=True)

# ───────── 頭髮 ─────────
HAIR_ROWS = [(Z(v), w / PX, Y(f), Y(b)) for v, w, f, b in (
    (113, 22, 124, 98), (109, 37, 138, 84), (104, 48, 150, 72), (97, 57, 159, 62), (90, 63, 167, 57),
    (80, 68, 173.5, 55), (70, 70.5, 178, 52), (60, 69.5, 179, 55), (50, 64.5, 178, 54),
    (40, 57.5, 174, 62), (30, 48.5, 169, 71), (20, 36, 158, 83), (14, 24, 146, 96), (10.8, 1, 126, 116))]

def tufts(th, z):
    """側面與後方的翹髮尾，讓輪廓像原圖一樣有尖角。(方位角, 原圖列, 凸出比例)"""
    total = np.zeros(np.shape(th))
    for a0, v0, k in ((1.57, 62, .075), (1.62, 76, .05), (2.15, 52, .05), (2.55, 74, .075),
                      (3.14, 50, .03), (3.14, 71, .045), (2.8, 92, .025), (1.5, 48, .04)):
        for sg in (1, -1):
            da = np.angle(np.exp(1j * (th - sg * a0)))
            dz = z - Z(v0) + .16 * (np.abs(da) / .3)       # 尖端往下垂
            tri = np.clip(1 - np.abs(da) / .34, 0, 1) * np.clip(1 - np.abs(dz) / .19, 0, 1)
            total = np.maximum(total, k * tri)
    return total

def mirror(half):
    return half + [(416 - x, y) for x, y in half[::-1]]

# 正面圖上「不是頭髮」的範圍（額頭、臉、耳朵），高解析圖像素座標
FRONT_WIN = mirror([(208, 128), (196, 122), (176, 120), (161, 125), (158, 138), (154, 150), (146, 163), (133, 175),
                    (117, 184), (100, 188), (83, 186), (88, 195), (95, 199), (99, 212), (100, 226), (90, 218),
                    (82, 222), (70, 204), (52, 198), (36, 215), (36, 340), (208, 340)])
# 右側面圖（frame 3）上露出臉與耳朵的範圍
SIDE_WIN = [(195, 77), (160, 74), (141, 77), (135, 82), (133, 88), (129.5, 93.5), (126.5, 88), (123.5, 83.5), (117, 80),
            (111, 80.5), (107, 84), (105.5, 90), (106.5, 97), (111, 102), (118, 105), (124, 108), (122, 125), (195, 125)]

def hair_texture(W=1024, H=1024):
    R = smooth_rows(HAIR_ROWS)
    U, V = np.meshgrid((np.arange(W) + .5) / W, 1 - (np.arange(H) + .5) / H)
    th = (U - .5) * 2 * math.pi
    x, y, z = surf(R, th, V, 2.25, bump=tufts)
    col = np.zeros((H, W, 3), np.float32); tot = np.zeros((H, W), np.float32)

    def clean(img, n, skin=True):
        r, g, b, a = (img[..., i] for i in range(4))
        solid = erode(a > .9, n)
        if not skin:            # 正面圖的臉部已由開窗處理，金色高光不能被當成膚色濾掉
            return solid
        return solid & ~dilate((r > .72) & (b > .46), 2)

    def add(img, ok, px, py, w):
        s = sample(img, px, py)[..., :3]
        h_, w_ = ok.shape
        good = ok[np.clip(py.astype(int), 0, h_ - 1), np.clip(px.astype(int), 0, w_ - 1)]
        yellow = (s[..., 0] > .5) & (s[..., 1] > .36) & (s[..., 2] < .35) & (z < Z(97))      # 下緣不要取到小雞
        w = (w * good * ~yellow).astype(np.float32)
        col[...] += s * w[..., None]; tot[...] += w

    nx, ny = neutral_px(x, z)
    # 正面 ±55° 只用高解析正面圖，之後才漸漸換成側面圖，避免兩張圖疊出色塊
    deg_ = np.abs(np.degrees(th))
    fw = np.clip((69 - deg_) / 7, 0, 1)
    add(NEU, clean(NEU, 9, False), nx, ny, fw * 3)
    for frame, deg, cu, ang in ((3, 90, 120, -math.pi / 2), (9, 270, 120, math.pi / 2), (6, 180, 120, math.pi)):
        fr = SHEET[:, frame * 240:(frame + 1) * 240]
        a = math.radians(deg)
        u = cu + PX * (x * math.cos(a) - y * math.sin(a)); v = 120 - PX * (z - 3)
        add(fr, clean(fr, 4), u, v, np.clip(np.cos(th - ang), 0, 1) ** 5 * np.clip((deg_ - 62) / 7, 0, 1) + 1e-4 * (frame != 6))
    base = np.array((62, 35, 22), np.float32) / 255
    lack = np.clip(1 - tot / .06, 0, 1)[..., None]
    col = col / np.maximum(tot, 1e-5)[..., None]
    col = col * (1 - lack) + base * lack
    # 頭頂各角度投影會互相打架：改用乾淨的深棕加髮絲
    top = np.clip((z - Z(24)) / (Z(14) - Z(24)), 0, 1)[..., None]
    streak = (np.maximum(0, np.cos(th * 15 + z * 5)) ** 8)[..., None]
    col = col * (1 - top) + base * (1 - .35 * streak) * top
    # 臉與耳朵開窗
    win = (y < -.25) & (np.abs(x) < 1.22) & in_poly(nx, ny, FRONT_WIN)
    win |= (y < -.25) & (np.abs(x) >= 1.22) & (np.abs(x) < 1.55) & in_poly(nx, ny, FRONT_WIN) & (ny > 196)
    su = 120 - PX * y; sv = 120 - PX * (z - 3)
    win |= (np.abs(x) >= .9) & in_poly(su, sv, SIDE_WIN)
    win |= (z < Z(103)) & (y < -.15)
    # 開窗邊緣描深色線
    pad = np.pad(win, ((0, 0), (8, 8)), mode='wrap')
    line = dilate(pad, 4)[:, 8:-8] & ~win
    col[line] = col[line] * .25 + np.array((.07, .025, .01), np.float32) * .75
    return np.dstack([col, (~win).astype(np.float32)])

loft('hair', HAIR_ROWS, tex_mat('hair', hair_texture(), clip=True), 128, 80, 2.25, bump=tufts, uv=True, caps=False)

# ───────── 小零件 ─────────
def ball(name, c, r, m, seg=18, rings=12, rz=0.0, ry=0.0):
    bm = bmesh.new()
    bmesh.ops.create_uvsphere(bm, u_segments=seg, v_segments=rings, radius=1)
    M = Matrix.Rotation(rz, 3, 'Z') @ Matrix.Rotation(ry, 3, 'Y')
    for v in bm.verts:
        v.co = M @ Vector((v.co.x * r[0], v.co.y * r[1], v.co.z * r[2])) + Vector(c)
    me = bpy.data.meshes.new(name); bm.to_mesh(me); bm.free(); me.materials.append(m)
    for p in me.polygons:
        p.use_smooth = True
    o = bpy.data.objects.new(name, me); scene.collection.objects.link(o)
    return o

def catmull(pts, n):
    P = [Vector(p) for p in pts]
    P = [P[0] * 2 - P[1]] + P + [P[-1] * 2 - P[-2]]
    segs = len(P) - 3; out = []
    for i in range(n + 1):
        t = i / n * segs; k = min(int(t), segs - 1); u = t - k
        a, b, c, d = P[k], P[k + 1], P[k + 2], P[k + 3]
        out.append(.5 * ((2 * b) + (-a + c) * u + (2 * a - 5 * b + 4 * c - d) * u * u + (-a + 3 * b - 3 * c + d) * u ** 3))
    return out

def tube(name, pts, radii, m, n=14, sides=14, flat=1.0, line=False):
    path = catmull(pts, n); verts, faces = [], []
    for i, p in enumerate(path):
        t = (path[min(i + 1, n)] - path[max(i - 1, 0)]).normalized()
        side = t.cross(Vector((0, -1, 0.001))).normalized(); nr = side.cross(t).normalized()
        f = i / n * (len(radii) - 1); k = min(int(f), len(radii) - 2); u = f - k
        w = radii[k] * (1 - u) + radii[k + 1] * u
        for j in range(sides):
            a = j / sides * math.tau
            verts.append(tuple(p + side * math.cos(a) * w + nr * math.sin(a) * w * flat))
    for i in range(n):
        for j in range(sides):
            a, b = i * sides + j, i * sides + (j + 1) % sides
            faces.append((a, a + sides, b + sides, b))
    faces.append(tuple(range(sides))); faces.append(tuple(range(n * sides, (n + 1) * sides))[::-1])
    o = new_obj(name, verts, faces, m)
    bm = bmesh.new(); bm.from_mesh(o.data); bmesh.ops.recalc_face_normals(bm, faces=bm.faces); bm.to_mesh(o.data); bm.free()
    if line:
        o['noline'] = True
    return o

# 耳朵
for s in (-1, 1):
    ball('ear', (s * 1.34, .08, Z(90)), (.33, .17, .32), SKIN, 24, 16, rz=s * .75)
    ball('earin', (s * 1.42, -.055, Z(89)), (.17, .05, .19), PINK, 16, 10, rz=s * .75)['noline'] = True
    ball('earin2', (s * 1.385, -.10, Z(91.5)), (.10, .035, .10), SKIN, 14, 8, rz=s * .75)['noline'] = True

# ───────── 身體 ─────────
loft('neck', [(2.80, .30, -.52, .06), (3.05, .27, -.50, .02), (3.34, .30, -.52, .04)], SKIN, 24, 8, 2)
TORSO = [(1.58, .84, -.92, .57), (1.80, .84, -.92, .57), (2.10, .80, -.87, .53), (2.40, .76, -.81, .50),
         (2.68, .72, -.74, .46), (2.90, .66, -.66, .41), (3.04, .52, -.57, .34), (3.11, .30, -.46, .22)]
_, TR = loft('torso', TORSO, CLOTH, 48, 28, 2.5)
loft('hem', [(1.47, .82, -.90, .55), (1.50, .87, -.96, .60), (1.68, .875, -.965, .605), (1.72, .84, -.93, .57)], RIB, 48, 6, 2.5)

def front_y(x, z, off=.012):
    w = np.interp(z, TR[:, 0], TR[:, 1]); yf = np.interp(z, TR[:, 0], TR[:, 2]); yb = np.interp(z, TR[:, 0], TR[:, 3])
    q = max(0.0, 1 - min(1.0, abs(x) / w) ** 2.5) ** (1 / 2.5)
    return float((yf + yb) / 2 - (yb - yf) / 2 * q - off)

# V 領
verts, faces = [], []
n = 8
for j in range(n + 1):
    z = 2.74 + (3.12 - 2.74) * j / n; half = .31 * j / n + .001
    for i in range(n + 1):
        x = -half + 2 * half * i / n
        verts.append((x, front_y(x, z, .018), z))
for j in range(n):
    for i in range(n):
        a = j * (n + 1) + i
        faces.append((a, a + 1, a + n + 2, a + n + 1))
new_obj('vneck', verts, faces, SKIN)['noline'] = True

for s in (-1, 1):
    pts = [(s * x, front_y(x, z, .045), z) for x, z in ((.40, 3.10), (.27, 2.96), (.13, 2.83), (-.01, 2.70))]
    tube('collar', pts, [.055, .07, .06, .02], CLOTH, 14, 10, .55)
    pts = [(s * x, front_y(x, z, .03), z) for x, z in ((.25, 2.86), (.27, 2.60), (.275, 2.34))]
    tube('string', pts, [.022, .022, .022], CORD, 10, 8, line=True)
    ball('stringtip', (s * .275, front_y(.275, 2.30, .035), 2.31), (.026, .024, .045), METAL, 10, 8)['noline'] = True
    # 袖子：肩窄、往手腕放寬
    tube('sleeve', [(s * .50, -.12, 2.92), (s * .76, -.16, 2.70), (s * .99, -.23, 2.30), (s * 1.13, -.31, 1.90)],
         [.14, .22, .29, .30], CLOTH, 20, 20)
    tube('cuff', [(s * 1.125, -.305, 1.97), (s * 1.165, -.34, 1.78)], [.295, .255], RIB, 5, 20)
    ball('hand', (s * 1.20, -.37, 1.61), (.25, .27, .23), SKIN, 22, 16)
    ball('thumb', (s * 1.01, -.54, 1.62), (.095, .105, .14), SKIN, 14, 10, ry=-s * .5)
    tube('knuckle', [(s * 1.10, -.625, 1.70), (s * 1.12, -.645, 1.58), (s * 1.07, -.63, 1.48)], [.006, .013, .005], SKINLINE, 10, 6, line=True)
    tube('cuffline', [(s * (1.125 + .31 * math.cos(a)), -.305 + .31 * math.sin(a), 1.97 + s * .05 * math.cos(a))
                      for a in np.linspace(0, math.tau, 13)], [.012, .012], SEAM, 36, 6, line=True)
    tube('armseam', [(s * x, front_y(x, z, .02), z) for x, z in ((.50, 2.88), (.66, 2.58), (.74, 2.20), (.76, 1.88))],
         [.006, .016, .014, .004], SEAM, 18, 6, line=True)
    loft('short', [(1.17, .40, -.78, .39), (1.20, .43, -.82, .43), (1.42, .43, -.84, .44), (1.62, .40, -.80, .40)],
         CLOTH, 32, 8, 3, cx=s * .455)
    loft('leg', [(.62, .25, -.48, .07), (.90, .265, -.50, .09), (1.24, .29, -.54, .12)], SKIN, 24, 8, 2.1, cx=s * .54)
    cx = s * .685
    loft('sole', [(0, .47, -1.10, .36), (.035, .54, -1.19, .43), (.19, .54, -1.19, .43), (.23, .51, -1.14, .39)],
         SOLE, 36, 10, 2.6, cx=cx)
    loft('shoe', [(.20, .51, -1.15, .40), (.36, .49, -1.10, .37), (.50, .44, -.90, .34), (.62, .39, -.66, .30),
                  (.76, .36, -.58, .24), (.87, .34, -.55, .20), (.90, .27, -.48, .12)], SHOE, 36, 18, 2.45, cx=cx)
    for yy, zz in ((-.93, .50), (-.76, .58), (-.64, .67)):
        tube('lace', [(cx - .20, yy + .05, zz - .02), (cx, yy - .02, zz + .025), (cx + .20, yy + .05, zz - .02)],
             [.022, .034, .022], LACE, 8, 8, .7, line=True)
    tube('soleline', [(cx + .545 * math.copysign(abs(math.sin(a)) ** .77, math.sin(a)),
                       -.38 - .815 * math.copysign(abs(math.cos(a)) ** .77, math.cos(a)), .215) for a in np.linspace(0, math.tau, 33)],
         [.015, .015], SEAM, 96, 6, line=True)
    tube('toeline', [(cx - .45, -.88, .30), (cx - .22, -1.06, .39), (cx, -1.10, .40), (cx + .22, -1.06, .39), (cx + .45, -.88, .30)],
         [.008, .014, .014, .014, .008], SEAM, 20, 6, line=True)
tube('hemline', [(.875 * math.copysign(abs(math.sin(a)) ** .8, math.sin(a)),
                  -.18 - .79 * math.copysign(abs(math.cos(a)) ** .8, math.cos(a)), 1.69) for a in np.linspace(0, math.tau, 33)],
     [.013, .013], SEAM, 96, 6, line=True)
loft('hips', [(1.36, .70, -.76, .38), (1.64, .76, -.86, .50)], CLOTH, 40, 4, 2.6)

# 帽子
loft('hood', [(2.18, .16, .45, .66), (2.28, .45, .32, .90), (2.50, .66, .20, 1.03), (2.76, .70, .12, 1.02),
              (2.98, .62, .05, .86), (3.12, .45, .00, .55)], CLOTH, 36, 20, 2.3)
tube('hoodline', [(-.66, .55, 2.86), (-.45, .93, 2.60), (0, 1.045, 2.42), (.45, .93, 2.60), (.66, .55, 2.86)],
     [.008, .018, .018, .018, .008], SEAM, 28, 6, line=True)

# ───────── 肩上的小黃雞（角色右肩 = -X） ─────────
C = Vector((-.99, -.18, 3.03))
ball('chick', C, (.32, .31, .31), CHICK, 28, 20)
ball('chick_tail', C + Vector((0, .30, -.03)), (.09, .15, .07), CHICK2, 14, 10)
for s in (-1, 1):
    ball('chick_wing', C + Vector((s * .305, .06, -.08)), (.045, .13, .06), CHICK2, 14, 10, ry=s * .6)['noline'] = True
    ball('chick_eye', C + Vector((s * .155, -.265, .07)), (.036, .03, .046), EYE, 12, 8)['noline'] = True
    ball('chick_glint', C + Vector((s * .155 + s * .012, -.296, .088)), (.011, .008, .012), GLINT, 8, 6)['noline'] = True
    ball('chick_foot', C + Vector((s * .13, -.12, -.31)), (.075, .12, .035), BEAK, 12, 8)['noline'] = True
ball('chick_beak', C + Vector((0, -.315, -.025)), (.08, .075, .048), BEAK, 16, 10)['noline'] = True

# ───────── 匯出 GLB（依材質合併，不含預覽用外框） ─────────
def join(objs, name):
    bpy.ops.object.select_all(action='DESELECT')
    for o in objs:
        o.select_set(True)
    bpy.context.view_layer.objects.active = objs[0]
    if len(objs) > 1:
        bpy.ops.object.join()
    objs[0].name = name
    return objs[0]

groups = {}
for o in scene.collection.objects:
    groups.setdefault((o.data.materials[0].name, bool(o.get('noline'))), []).append(o)
parts = [(join(v, f'machi_{k[0]}' + ('_n' if k[1] else '')), k[1]) for k, v in groups.items()]
tris = sum(len(p.vertices) - 2 for o, _ in parts for p in o.data.polygons)

glb = os.path.join(HERE, 'machi.glb')
bpy.ops.object.select_all(action='SELECT')
bpy.ops.export_scene.gltf(filepath=glb, export_format='GLB', use_selection=True)
print(f'GLB {os.path.getsize(glb) / 1024:.0f} KB, {tris} tris, {len(parts)} meshes')

# ───────── 預覽渲染 ─────────
ink = bpy.data.materials.new('outline'); ink.use_nodes = True
nt = ink.node_tree; nt.nodes.clear()
em = nt.nodes.new('ShaderNodeEmission'); em.inputs['Color'].default_value = (.004, .002, .002, 1)
outn = nt.nodes.new('ShaderNodeOutputMaterial'); nt.links.new(em.outputs[0], outn.inputs[0])
ink.use_backface_culling = True
for o, noline in parts:
    if noline:
        continue
    o.data.materials.append(ink)
    m = o.modifiers.new('outline', 'SOLIDIFY')
    m.thickness = .034; m.offset = 1; m.use_flip_normals = True; m.use_rim = False; m.material_offset = 1

root = bpy.data.objects.new('turn', None); scene.collection.objects.link(root)
for o, _ in parts:
    o.parent = root
cam = bpy.data.cameras.new('cam'); cam.type = 'ORTHO'; cam.ortho_scale = 6.5
co = bpy.data.objects.new('cam', cam); scene.collection.objects.link(co); scene.camera = co
co.location = (0, -20, 3.0); co.rotation_euler = (math.pi / 2, 0, 0)
for name, energy, rot in (('key', 2.0, (.75, 0, -.55)), ('fill', .6, (1.25, 0, .85)), ('back', 1.0, (.9, 0, 2.8))):
    l = bpy.data.lights.new(name, 'SUN'); l.energy = energy; l.angle = .6
    lo = bpy.data.objects.new(name, l); scene.collection.objects.link(lo); lo.rotation_euler = rot
scene.view_settings.view_transform = 'Standard'
scene.render.engine = 'BLENDER_EEVEE'
scene.render.film_transparent = True
scene.render.resolution_x = scene.render.resolution_y = 720
for i, deg in enumerate((0, 30, 90, 180)):
    root.rotation_euler.z = math.radians(deg)
    scene.render.filepath = os.path.join(OUT, f'view{i}.png')
    bpy.ops.render.render(write_still=True)
root.rotation_euler.z = 0
print('DONE')

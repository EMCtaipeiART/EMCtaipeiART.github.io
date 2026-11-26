# 立體人物的共用建模工具（做法與函式取自 models/machi/build_machi.py：逐段放樣＋原畫貼圖）。
# 各角色腳本：from kit import *，建好零件後呼叫 finish(名字, 頭部零件, 腿部零件, 手部零件)。
# 座標：Z 向上、面朝 -Y；12 角度圖 1 單位 = 36.92 px，圖上第 120 列 = 高度 3，腳底 z≈0。
import bpy, bmesh, math, os, sys
import numpy as np
from mathutils import Vector, Matrix

ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
ARGS = sys.argv[sys.argv.index('--') + 1:] if '--' in sys.argv else []
PREVIEW = ARGS[0] if ARGS else None            # 給資料夾就另外渲染預覽圖
LITE = True
def res(n, low=6): return max(low, int(round(n * .6)))
bpy.ops.wm.read_factory_settings(use_empty=True)
scene = bpy.context.scene

def Z(v): return 3.0 + (120 - v) / PX          # 原圖列 → 高度
def Y(u): return -(u - 120) / PX               # 側面圖欄 → 前後
PX = 36.92


def load(path):
    im = bpy.data.images.load(path)
    w, h = im.size
    a = np.empty(w * h * 4, np.float32); im.pixels.foreach_get(a)
    return a.reshape(h, w, 4)[::-1].copy()

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
    nth, nt = res(nth, 14), res(nt, 4)
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
    if LITE:                      # 2×2 平均縮成一半
        rgba = rgba.reshape(rgba.shape[0] // 2, 2, rgba.shape[1] // 2, 2, 4).mean((1, 3))
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

def mirror(half):
    return half + [(416 - x, y) for x, y in half[::-1]]

# ───────── 小零件 ─────────
def ball(name, c, r, m, seg=18, rings=12, rz=0.0, ry=0.0):
    bm = bmesh.new()
    seg, rings = res(seg, 8), res(rings, 6)
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
    n, sides = res(n, 5), res(sides, 5)
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

def shoe(s, SHOE, SOLE, LACE, cx=.625, turn=15):
    before = set(scene.collection.objects)
    heel = lambda th, z: -.15 * np.clip(-np.cos(th), 0, 1) ** 1.5
    # 鞋底薄、邊緣圓，腳尖微微上翹
    loft('sole', [(0, .38, -1.02, .27), (.025, .47, -1.13, .35), (.075, .515, -1.19, .39), (.14, .515, -1.19, .39),
                  (.18, .485, -1.15, .36)], SOLE, 44, 14, 2.15, bump=heel)
    loft('shoe', [(.15, .475, -1.13, .35), (.25, .48, -1.15, .35), (.37, .455, -1.07, .33), (.47, .405, -.90, .31),
                  (.55, .365, -.68, .29), (.68, .33, -.50, .25), (.80, .325, -.47, .22), (.87, .305, -.45, .19)],
         SHOE, 44, 22, 2.1, bump=heel)
    loft('tongue', [(.50, .15, -.78, -.46), (.68, .17, -.64, -.36), (.86, .13, -.52, -.34), (.90, .05, -.49, -.38)], SHOE, 24, 10, 2.3)
    for k, (yy, zz) in enumerate(((-.86, .54), (-.74, .63), (-.63, .72))):
        for d in (1, -1):
            tube('lace', [(-.14 * d, yy + .09, zz + .02), (0, yy - .01, zz + .015), (.14 * d, yy - .02, zz - .035)],
                 [.012, .020, .012], LACE, 8, 8, .8, line=True)
    tube('toecap', [(-.40, -.84, .27), (-.25, -.98, .38), (0, -1.05, .42), (.25, -.98, .38), (.40, -.84, .27)],
         [.005, .014, .014, .014, .005], LACE, 24, 6, line=True)
    ring = lambda a: (.535 * math.copysign(abs(math.sin(a)) ** .89, math.sin(a)) * (1 - .15 * max(0, -math.cos(a)) ** 1.5),
                      -.40 - .79 * math.copysign(abs(math.cos(a)) ** .89, math.cos(a)) * (1 - .15 * max(0, -math.cos(a)) ** 1.5), .175)
    tube('soleline', [ring(a) for a in np.linspace(0, math.tau, 41)], [.013, .013], LACE, 120, 6, line=True)
    # 以腳踝為軸心向外轉，再放到左右腳位置
    pivot = Vector((0, -.22, 0))
    M = Matrix.Translation(Vector((s * cx, 0, 0)) + pivot) @ Matrix.Rotation(math.radians(s * turn), 4, 'Z') @ Matrix.Translation(-pivot)
    for o in set(scene.collection.objects) - before:
        for v in o.data.vertices:
            v.co.z += .07 * min(1, max(0, (-v.co.y - .70) / .50)) ** 2 * max(0, 1 - v.co.z / .5)
        o.data.transform(M)

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

def finish(name, heads, legs, arms):
    def limb(o):          # 遊戲要讓手腳擺動：節點名稱帶肢體（L＝角色左側 +X）
        n = o.name.split('.')[0]
        if n in heads: return 'head'
        if n in legs or n in arms:
            x = sum(v.co.x for v in o.data.vertices)
            return ('leg' if n in legs else 'arm') + ('L' if x > 0 else 'R')
        return 'body'
    groups = {}
    for o in scene.collection.objects:
        groups.setdefault((limb(o), o.data.materials[0].name, bool(o.get('noline'))), []).append(o)
    # 節點名稱沿用 machi_ 前綴：遊戲和展示間的綁定程式靠它分辨肢體
    parts = [(join(v, f'machi_{k[0]}__{k[1]}' + ('_n' if k[2] else '')), k[2]) for k, v in groups.items()]
    tris = sum(len(p.vertices) - 2 for o, _ in parts for p in o.data.polygons)
    glb = os.path.join(ROOT, 'pixel-plaza/assets/people3d/%s.glb' % name.lower())
    os.makedirs(os.path.dirname(glb), exist_ok=True)
    bpy.ops.object.select_all(action='SELECT')
    bpy.ops.export_scene.gltf(filepath=glb, export_format='GLB', use_selection=True, export_image_format='WEBP', export_image_quality=90)
    print(f'GLB {os.path.getsize(glb) / 1024:.0f} KB, {tris} tris, {len(parts)} meshes')
    if PREVIEW: preview(parts, PREVIEW)

def preview(parts, OUT):
    ink = bpy.data.materials.new('outline'); ink.use_nodes = True
    nt = ink.node_tree; nt.nodes.clear()
    em = nt.nodes.new('ShaderNodeEmission'); em.inputs['Color'].default_value = (.004, .002, .002, 1)
    outn = nt.nodes.new('ShaderNodeOutputMaterial'); nt.links.new(em.outputs[0], outn.inputs[0])
    ink.use_backface_culling = True
    for o, noline in parts:
        if noline:
            continue
        if any(n.type == 'TEX_IMAGE' for n in o.data.materials[0].node_tree.nodes) and o.data.materials[0].name != 'face':
            k = ink.copy(); t_ = k.node_tree
            tx = t_.nodes.new('ShaderNodeTexImage'); tx.image = next(n for n in o.data.materials[0].node_tree.nodes if n.type == 'TEX_IMAGE').image
            tr = t_.nodes.new('ShaderNodeBsdfTransparent'); mx = t_.nodes.new('ShaderNodeMixShader')
            rd = t_.nodes.new('ShaderNodeMath'); rd.operation = 'ROUND'
            e_ = next(n for n in t_.nodes if n.type == 'EMISSION'); ot = next(n for n in t_.nodes if n.type == 'OUTPUT_MATERIAL')
            t_.links.new(tx.outputs['Alpha'], rd.inputs[0]); t_.links.new(rd.outputs[0], mx.inputs[0])
            t_.links.new(tr.outputs[0], mx.inputs[1]); t_.links.new(e_.outputs[0], mx.inputs[2]); t_.links.new(mx.outputs[0], ot.inputs[0])
            o.data.materials.append(k)
        else:
            o.data.materials.append(ink)
        m = o.modifiers.new('outline', 'SOLIDIFY')
        m.thickness = .034; m.offset = 1; m.use_flip_normals = True; m.use_rim = False; m.material_offset = 1

    root = bpy.data.objects.new('turn', None); scene.collection.objects.link(root)
    for o, _ in parts:
        o.parent = root
    cam = bpy.data.cameras.new('cam'); cam.type = 'ORTHO'; cam.ortho_scale = 6.5
    co = bpy.data.objects.new('cam', cam); scene.collection.objects.link(co); scene.camera = co
    tilt = math.radians(6)
    co.location = (0, -20 * math.cos(tilt), 3.0 + 20 * math.sin(tilt)); co.rotation_euler = (math.pi / 2 - tilt, 0, 0)
    for name, energy, rot in (('key', 2.0, (.75, 0, -.55)), ('fill', .6, (1.25, 0, .85)), ('back', 1.0, (.9, 0, 2.8))):
        l = bpy.data.lights.new(name, 'SUN'); l.energy = energy; l.angle = .6
        lo = bpy.data.objects.new(name, l); scene.collection.objects.link(lo); lo.rotation_euler = rot
    scene.view_settings.view_transform = 'Standard'
    scene.render.engine = 'BLENDER_EEVEE'
    scene.render.film_transparent = True
    scene.render.resolution_x = scene.render.resolution_y = 720
    VIEWS = [int(v) for v in os.environ.get("MACHI_VIEWS", "0,30,90,180").split(",")]
    for i, deg in enumerate(VIEWS):
        root.rotation_euler.z = math.radians(deg)
        scene.render.filepath = os.path.join(OUT, f'view{i}.png')
        bpy.ops.render.render(write_still=True)
    root.rotation_euler.z = 0
    print('DONE')

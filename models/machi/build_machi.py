# Machi Q 版 3D 人物。參考：pixel-plaza/sprites-hd/Machi.png（12 角度）
# 執行：blender --background --factory-startup --python models/machi/build_machi.py -- <預覽圖輸出資料夾>
# 座標：Z 向上、面朝 -Y；全身高約 5.95 單位。
import bpy, bmesh, math, os, sys, random
from mathutils import Vector, Matrix

HERE = os.path.dirname(os.path.abspath(__file__))
OUT = sys.argv[sys.argv.index('--') + 1] if '--' in sys.argv else HERE
random.seed(7)

bpy.ops.wm.read_factory_settings(use_empty=True)
scene = bpy.context.scene

def lin(c):
    return tuple((v / 255 / 12.92) if v / 255 <= .04045 else (((v / 255) + .055) / 1.055) ** 2.4 for v in c)

MATS = {}
def mat(name, hexcol, rough=.85, glow=.28):
    if name in MATS:
        return MATS[name]
    rgb = lin(tuple(int(hexcol[i:i + 2], 16) for i in (0, 2, 4)))
    m = bpy.data.materials.new(name); m.use_nodes = True
    b = m.node_tree.nodes['Principled BSDF']
    b.inputs['Base Color'].default_value = (*rgb, 1)
    b.inputs['Roughness'].default_value = rough
    b.inputs['Specular IOR Level'].default_value = .12
    b.inputs['Emission Color'].default_value = (*rgb, 1)
    b.inputs['Emission Strength'].default_value = glow
    MATS[name] = m
    return m

SKIN = mat('skin', 'f7c3a2', glow=.34)
BLUSH = mat('blush', 'f4a08e', glow=.36)
HAIR = mat('hair', '3d2618', .75, .2)
HAIR2 = mat('hair_light', '56351f', .75, .2)
GOLD = mat('highlight', 'd9964a', .7, .3)
GOLD2 = mat('highlight_light', 'eeb56a', .7, .3)
CLOTH = mat('hoodie', '201e1e', .95, .22)
CLOTH2 = mat('hoodie_rib', '161515', .95, .22)
CORD = mat('cord', '4a4646', .8, .25)
SHOE = mat('shoe', '171818', .6, .2)
SOLE = mat('sole', '262728', .7, .22)
WHITE = mat('eye_white', 'ffffff', .5, .5)
BLACK = mat('pupil', '161212', .35, .05)
MOUTH = mat('mouth', 'b4503f', .8, .2)
CHICK = mat('chick', 'fbca1c', .8, .34)
BEAK = mat('beak', 'f08418', .6, .34)

def obj(name, bm, m, smooth=True):
    me = bpy.data.meshes.new(name)
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    bm.to_mesh(me); bm.free()
    me.materials.append(m)
    if smooth:
        for p in me.polygons:
            p.use_smooth = True
    o = bpy.data.objects.new(name, me); scene.collection.objects.link(o)
    return o

def ball(name, c, r, m, seg=20, rings=14, rot=(0, 0, 0)):
    bm = bmesh.new()
    bmesh.ops.create_uvsphere(bm, u_segments=seg, v_segments=rings, radius=1)
    for v in bm.verts:
        v.co = Vector((v.co.x * r[0], v.co.y * r[1], v.co.z * r[2]))
    o = obj(name, bm, m); o.location = c; o.rotation_euler = rot
    return o

def catmull(pts, n):
    P = [Vector(p) for p in pts]
    P = [P[0] * 2 - P[1]] + P + [P[-1] * 2 - P[-2]]
    segs = len(P) - 3
    out = []
    for i in range(n + 1):
        t = i / n * segs; k = min(int(t), segs - 1); u = t - k
        a, b, c, d = P[k], P[k + 1], P[k + 2], P[k + 3]
        out.append(.5 * ((2 * b) + (-a + c) * u + (2 * a - 5 * b + 4 * c - d) * u * u + (-a + 3 * b - 3 * c + d) * u ** 3))
    return out

def strand(name, pts, widths, thick, m, up=None, n=14, sides=8):
    """沿曲線的扁管：widths 是沿線的半寬，thick 是厚度比例，up(p) 回傳該點的表面法線。"""
    path = catmull(pts, n)
    bm = bmesh.new(); loops = []
    for i, p in enumerate(path):
        t = (path[min(i + 1, n)] - path[max(i - 1, 0)]).normalized()
        nr = up(p) if up else Vector((0, -1, 0))
        side = t.cross(nr).normalized()
        nr = side.cross(t).normalized()
        f = i / n * (len(widths) - 1); k = min(int(f), len(widths) - 2); u = f - k
        w = widths[k] * (1 - u) + widths[k + 1] * u
        loops.append([bm.verts.new(p + side * math.cos(a) * w + nr * math.sin(a) * w * thick)
                      for a in (j / sides * math.tau for j in range(sides))])
    for A, B in zip(loops, loops[1:]):
        for j in range(sides):
            bm.faces.new((A[j], A[(j + 1) % sides], B[(j + 1) % sides], B[j]))
    bm.faces.new(loops[0]); bm.faces.new(loops[-1])
    return obj(name, bm, m)

def lathe(name, profile, m, seg=32, power=2.6):
    """profile: [(z, rx, ry, cy)]；橫切面是圓角橢圓。"""
    bm = bmesh.new(); loops = []
    for z, rx, ry, cy in profile:
        lp = []
        for j in range(seg):
            a = j / seg * math.tau; c, s = math.cos(a), math.sin(a)
            lp.append(bm.verts.new((rx * math.copysign(abs(c) ** (2 / power), c),
                                    cy + ry * math.copysign(abs(s) ** (2 / power), s), z)))
        loops.append(lp)
    for A, B in zip(loops, loops[1:]):
        for j in range(seg):
            bm.faces.new((A[j], A[(j + 1) % seg], B[(j + 1) % seg], B[j]))
    bm.faces.new(loops[0]); bm.faces.new(loops[-1])
    return obj(name, bm, m)

# ───────── 頭與臉 ─────────
HC, HR = Vector((0, -.12, 4.14)), Vector((1.36, 1.28, 1.08))
head = ball('head', HC, HR, SKIN, 40, 28)
for v in head.data.vertices:          # 下半臉往兩頰鼓一點、下巴收圓
    nz = v.co.z / HR.z
    if nz < 0:
        k = 1 + .07 * math.sin(min(1, -nz) * math.pi)
        v.co.x *= k

def face_y(x, z, off=0.0):
    nx, nz = (x - HC.x) / HR.x, (z - HC.z) / HR.z
    k = 1 + .07 * math.sin(min(1, -nz) * math.pi) if nz < 0 else 1
    q = max(.02, 1 - (nx / k) ** 2 - nz ** 2)
    return HC.y - HR.y * math.sqrt(q) - off

def face_n(p):
    return Vector(((p.x - HC.x) / HR.x ** 2, (p.y - HC.y) / HR.y ** 2, (p.z - HC.z) / HR.z ** 2)).normalized()

def patch(name, cx, cz, rx, rz, off, m, seg=28, rings=5, dome=0.0):
    """貼在臉表面的橢圓片。"""
    bm = bmesh.new()
    center = bm.verts.new((cx, face_y(cx, cz, off + dome), cz)); loops = []
    for r in range(1, rings + 1):
        f = r / rings; lp = []
        for j in range(seg):
            a = j / seg * math.tau
            x, z = cx + math.cos(a) * rx * f, cz + math.sin(a) * rz * f
            lp.append(bm.verts.new((x, face_y(x, z, off + dome * (1 - f * f)), z)))
        loops.append(lp)
    for j in range(seg):
        bm.faces.new((center, loops[0][j], loops[0][(j + 1) % seg]))
    for A, B in zip(loops, loops[1:]):
        for j in range(seg):
            bm.faces.new((A[j], B[j], B[(j + 1) % seg], A[(j + 1) % seg]))
    o = obj(name, bm, m)
    o['flat'] = True
    return o

for s in (-1, 1):
    ex = s * .58
    patch('eye_w', ex, 3.98, .31, .30, .012, WHITE, dome=.025)
    patch('eye_p', ex - s * .045, 3.95, .215, .255, .045, BLACK, dome=.03)
    patch('eye_h', ex - s * .045 + .075, 4.075, .055, .062, .084, WHITE)
    strand('lash', [(ex + dx, face_y(ex + dx, z, .035), z) for dx, z in ((-.3, 4.17), (0, 4.31), (.3, 4.17))],
           [.012, .03, .012], .6, BLACK, face_n)
    strand('brow', [(s * x, face_y(s * x, z, .04), z) for x, z in ((.36, 4.55), (.58, 4.61), (.84, 4.53))],
           [.045, .08, .035], .45, HAIR, face_n)
    patch('blush', s * .86, 3.56, .24, .13, .012, BLUSH)
    # 耳朵
    ball('ear', (s * 1.40, .0, 3.80), (.27, .17, .34), SKIN, 20, 14, (0, s * .18, 0))
    ball('ear_in', (s * 1.46, -.145, 3.79), (.13, .05, .18), BLUSH, 14, 10, (0, s * .18, 0))
strand('mouth', [(x, face_y(x, z, .018), z) for x, z in ((-.24, 3.50), (-.08, 3.41), (.08, 3.41), (.24, 3.50))],
       [.012, .027, .027, .012], .6, MOUTH, face_n)
ball('nose', (0, face_y(0, 3.70, -.02), 3.70), (.09, .07, .065), SKIN, 12, 8)

# ───────── 頭髮 ─────────
KC, KR = Vector((0, .08, 4.52)), Vector((1.78, 1.62, 1.38))

def hair_n(p):
    return Vector(((p.x - KC.x) / KR.x ** 2, (p.y - KC.y) / KR.y ** 2, (p.z - KC.z) / KR.z ** 2)).normalized()

def on_hair(x, z, off=0.0, back=False):
    nx, nz = (x - KC.x) / KR.x, (z - KC.z) / KR.z
    q = max(.03, 1 - nx * nx - nz * nz)
    y = KR.y * math.sqrt(q)
    return (x, KC.y + (y + off if back else -y - off), z)

def sph(az, el, off=0.0):
    """az: 0=正前、π/2=角色左側(+X)、π=正後。"""
    return Vector((KC.x + (KR.x + off) * math.sin(az) * math.cos(el),
                   KC.y - (KR.y + off) * math.cos(az) * math.cos(el),
                   KC.z + (KR.z + off) * math.sin(el)))

def hairless(p):
    """髮殼要挖掉的區域：臉、耳朵、後頸以下。"""
    if p.y < -.15 and p.z < 5.12 - .16 * (p.x / 1.5) ** 2 and abs(p.x) < 1.46:
        return True
    if abs(p.x) > .9 and (p.y + .05) ** 2 / .20 + (p.z - 3.80) ** 2 / .30 < 1:      # 耳朵周圍的圓弧
        return True
    if abs(p.x) > .9 and p.y < -.25 and p.z < 4.30:
        return True
    return p.z < 3.30 + .60 * max(0, min(1, (.22 - p.y) / .6))

bm = bmesh.new()
bmesh.ops.create_uvsphere(bm, u_segments=144, v_segments=96, radius=1)
for v in bm.verts:
    v.co = Vector((v.co.x * KR.x, v.co.y * KR.y, v.co.z * KR.z)) + KC
bmesh.ops.delete(bm, geom=[v for v in bm.verts if hairless(v.co)], context='VERTS')
for _ in range(40):      # 把鋸齒狀的髮際線磨順
    edge = [v for v in bm.verts if v.is_boundary]
    new = {}
    for v in edge:
        nb = [e.other_vert(v).co for e in v.link_edges if e.is_boundary]
        if len(nb) == 2:
            new[v] = v.co * .5 + (nb[0] + nb[1]) * .25
    for v, c in new.items():
        v.co = c
cap = obj('hair_cap', bm, HAIR)
sol = cap.modifiers.new('thick', 'SOLIDIFY'); sol.thickness = .09; sol.offset = -1

# 後腦與兩側的髮束（一層層往下蓋、尾端往旁邊勾）
rows = [(-.50, 17, .55), (-.24, 19, .62), (.06, 19, .66), (.38, 17, .70), (.70, 14, .66)]
for r, (el, count, length) in enumerate(rows):
    for i in range(count):
        az = (i + .5 * (r % 2)) / count * math.tau + random.uniform(-.07, .07)
        side_ = math.copysign(1, math.sin(az) or 1)
        e = el + random.uniform(-.06, .05)
        tip = sph(az + side_ * .10, e - .12, .085 + random.uniform(0, .05))
        if hairless(tip) or hairless(sph(az, e, 0)) or (math.cos(az) > .2 and el < .8):
            continue
        pts = [sph(az - side_ * .20, e + length * .70, -.06), sph(az - side_ * .12, e + length * .32, .035),
               sph(az - side_ * .02, e + .02, .075), tip]
        o = strand('lock', pts, [.06, .22, .21, .012], .30, HAIR2 if (i * 3 + r) % 5 == 0 else HAIR, hair_n, 14, 10)
        o['soft'] = True
for s in (-1, 1):
    for az, el, d in ((1.55, .55, .20), (1.85, .22, .22), (2.10, -.08, .20), (2.45, -.36, .16), (1.35, .86, .16)):
        strand('flick', [sph(s * (az - .30), el + .34, -.03), sph(s * (az - .08), el + .10, .08), sph(s * (az + .10), el - .04, d)],
               [.08, .17, .006], .5, HAIR, hair_n, 10, 8)

# 頭頂分線兩側往後梳
for s in (-1, 1):
    for i, x in enumerate((.2, .55, .95)):
        pts = [sph(s * .12, 1.36 - i * .04, .0), sph(s * (.9 + i * .22), 1.1 - i * .14, .1), sph(s * (1.75 + i * .15), .75 - i * .2, .08)]
        strand('top', pts, [.05, .30, .03], .28, HAIR2 if i == 1 else HAIR, hair_n, 16, 10)['soft'] = True

# 瀏海：中分，兩邊往外下掃；金色挑染
def bang(name, s, xz, widths, m, off):
    pts = []
    for (x, z), o in zip(xz, off):
        y = on_hair(s * x, z, o)[1]
        if abs(x) > 1.1:
            y = min(y, -.78 - o)
        pts.append((s * x, y, z))
    strand(name, pts, widths, .36, m, hair_n, 20, 10)

for s in (-1, 1):
    bang('bang_base', s, [(.05, 5.66), (.62, 5.66), (1.22, 5.20), (1.62, 4.62)], [.07, .36, .34, .03], HAIR, [.0, .03, .06, .08])
    bang('bang_gold', s, [(.08, 5.38), (.40, 5.46), (.78, 4.98), (1.20, 4.64), (1.58, 4.74)], [.05, .22, .27, .17, .012], GOLD, [.10, .16, .20, .20, .16])
    bang('bang_gold2', s, [(.18, 5.22), (.38, 5.10), (.58, 4.82), (.96, 4.66)], [.03, .11, .10, .008], GOLD2, [.18, .22, .24, .22])
    bang('bang_gold3', s, [(.36, 5.64), (.86, 5.46), (1.22, 5.04), (1.50, 4.98)], [.03, .10, .09, .008], GOLD, [.10, .13, .15, .16])
    strand('side', [(s * 1.52, -.55, 4.95), (s * 1.62, -.52, 4.42), (s * 1.38, -.62, 4.12)], [.2, .17, .01], .45, HAIR, hair_n, 12, 8)
    strand('temple', [(s * 1.42, -.05, 5.10), (s * 1.62, -.34, 4.65), (s * 1.50, -.40, 4.28), (s * 1.30, -.62, 4.02)],
           [.22, .30, .17, .008], .34, HAIR, hair_n, 16, 10)
    strand('temple2', [(s * 1.55, .30, 5.00), (s * 1.74, -.05, 4.62), (s * 1.60, -.22, 4.34)],
           [.14, .24, .01], .34, HAIR, hair_n, 12, 10)
    strand('burn', [(s * 1.30, -.30, 4.55), (s * 1.34, -.46, 4.10), (s * 1.24, -.55, 3.84)], [.13, .10, .008], .4, HAIR, face_n, 10, 8)

# ───────── 身體 ─────────
lathe('neck', [(2.85, .34, .32, 0), (3.30, .36, .34, -.02)], SKIN, 20, 2)
lathe('torso', [(1.52, .86, .64, 0), (1.60, .97, .73, 0), (1.95, .93, .71, 0), (2.45, .86, .68, 0),
                (2.85, .80, .60, 0), (3.06, .58, .47, 0), (3.14, .40, .36, 0)], CLOTH)
lathe('hem', [(1.45, .92, .68, 0), (1.50, .99, .75, 0), (1.66, .99, .75, 0), (1.70, .94, .71, 0)], CLOTH2)
# V 領露出的脖子與領口
bm = bmesh.new()
vs = [bm.verts.new(p) for p in ((-.24, -.50, 3.07), (.24, -.50, 3.07), (0, -.668, 2.74))]
bm.faces.new(vs); obj('vneck', bm, SKIN, False)['flat'] = True
for s in (-1, 1):
    strand('collar', [(s * .44, -.32, 3.14), (s * .27, -.56, 3.02), (-s * .02, -.70, 2.70)], [.11, .12, .04], .5, CLOTH, None, 14, 8)
    strand('cord', [(s * .22, -.70, 2.76), (s * .24, -.75, 2.45), (s * .23, -.755, 2.14)], [.028, .028, .028], 1, CORD, None, 8, 8)
    ball('cord_end', (s * .23, -.755, 2.11), (.04, .04, .07), CORD, 10, 8)
    # 袖子、袖口、手
    strand('sleeve', [(s * .62, 0, 2.94), (s * .98, -.01, 2.66), (s * 1.17, -.03, 2.22), (s * 1.22, -.05, 1.86)],
           [.22, .30, .34, .34], .98, CLOTH, None, 16, 16)
    strand('cuff', [(s * 1.215, -.047, 1.91), (s * 1.228, -.056, 1.72)], [.30, .26], 1, CLOTH2, None, 4, 16)
    ball('hand', (s * 1.25, -.07, 1.52), (.27, .27, .28), SKIN)
    ball('thumb', (s * 1.10, -.27, 1.56), (.10, .11, .14), SKIN, 12, 8, (0, -s * .4, 0))
    # 短褲、腿
    lathe_leg = lathe('short', [(1.10, .39, .45, 0), (1.15, .43, .50, 0), (1.55, .43, .53, 0)], CLOTH, 24, 3)
    lathe_leg.location.x = s * .46
    leg = lathe('leg', [(.68, .27, .29, 0), (1.22, .31, .32, 0)], SKIN, 18, 2); leg.location.x = s * .50
    # 鞋
    sole = lathe('sole', [(0, .46, .72, -.20), (.04, .55, .82, -.20), (.20, .55, .82, -.20), (.24, .50, .76, -.20)], SOLE, 32, 2.5)
    upper = lathe('shoe', [(.20, .51, .77, -.20), (.42, .50, .72, -.18), (.58, .45, .55, -.05),
                           (.76, .36, .39, .04), (.90, .36, .38, .04), (.93, .30, .32, .04)], SHOE, 32, 2.4)
    for o in (sole, upper):
        o.location.x = s * .66
    for k, (y, z) in enumerate(((-.70, .52), (-.55, .60), (-.40, .70))):
        strand('lace', [(s * .66 - .22, y + .05, z - .03), (s * .66, y - .03, z + .02), (s * .66 + .22, y + .05, z - .03)],
               [.025, .035, .025], .8, SOLE, None, 8, 8)
lathe('waist', [(1.40, .80, .55, 0), (1.62, .84, .60, 0)], CLOTH)
# 背後的帽子
ball('hood', (0, .66, 2.78), (.80, .42, .46), CLOTH, 28, 18, (-.35, 0, 0))
strand('hood_rim', [(-.62, .30, 3.12), (-.45, .92, 2.86), (0, 1.12, 2.46), (.45, .92, 2.86), (.62, .30, 3.12)],
       [.05, .09, .11, .09, .05], .6, CLOTH2, lambda p: Vector((0, 1, .3)).normalized(), 24, 8)

# ───────── 肩上的小黃雞（角色右肩 = -X） ─────────
CH = Vector((-.98, -.42, 3.12))
ball('chick_body', CH, (.34, .31, .31), CHICK, 24, 18)
ball('chick_tail', CH + Vector((-.31, .05, -.02)), (.13, .10, .09), CHICK, 12, 8, (0, .6, 0))
for s in (-1, 1):
    ball('chick_eye', CH + Vector((s * .13, -.288, .07)), (.036, .024, .044), BLACK, 10, 8)
    ball('chick_foot', CH + Vector((s * .13, -.10, -.31)), (.08, .11, .04), BEAK, 10, 6)
ball('chick_beak', CH + Vector((0, -.325, -.035)), (.085, .08, .05), BEAK, 14, 10)
bpy.context.view_layer.update()
turn = Matrix.Translation(CH) @ Matrix.Rotation(math.radians(-24), 4, 'Z') @ Matrix.Translation(-CH)
for o in scene.collection.objects:
    if o.name.startswith('chick'):
        o.matrix_world = turn @ o.matrix_world

# 小零件不畫外框，避免線條糊成一團
for o in scene.collection.objects:
    if o.name.startswith(('lash', 'brow', 'mouth', 'nose', 'ear_in', 'cord', 'lace', 'chick_eye', 'chick_beak', 'chick_foot')):
        o['soft'] = True

# ───────── 匯出 GLB（依材質合併，不含預覽用外框） ─────────
bpy.context.view_layer.update()
deps = bpy.context.evaluated_depsgraph_get()
for o in list(scene.collection.objects):
    n = len(o.data.polygons)
    ratio = .16 if o.name.startswith('hair_cap') else .5 if o.name.startswith('lock') else .6 if n > 200 and not o.get('flat') else 1
    if ratio < 1:
        o.modifiers.new('lite', 'DECIMATE').ratio = ratio
        deps = bpy.context.evaluated_depsgraph_get()
    me = bpy.data.meshes.new_from_object(o.evaluated_get(deps))
    me.transform(o.matrix_world)
    o.modifiers.clear(); o.data = me; o.matrix_world.identity()

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
    groups.setdefault((o.data.materials[0].name, bool(o.get('flat') or o.get('soft'))), []).append(o)
parts = [(join(v, f'machi_{k[0]}' + ('_noline' if k[1] else '')), k[1]) for k, v in groups.items()]
tris = sum(len(p.vertices) - 2 for o, _ in parts for p in o.data.polygons)

bpy.ops.object.select_all(action='SELECT')
glb = os.path.join(HERE, 'machi.glb')
bpy.ops.export_scene.gltf(filepath=glb, export_format='GLB', use_selection=True, export_apply=True)
print(f'GLB {os.path.getsize(glb) / 1024:.0f} KB, {tris} tris, {len(parts)} meshes')

# ───────── 預覽渲染 ─────────
ink = bpy.data.materials.new('outline'); ink.use_nodes = True
nt = ink.node_tree; nt.nodes.clear()
em = nt.nodes.new('ShaderNodeEmission'); em.inputs['Color'].default_value = (.004, .002, .002, 1)
outn = nt.nodes.new('ShaderNodeOutputMaterial'); nt.links.new(em.outputs[0], outn.inputs[0])
ink.use_backface_culling = True
for o, flat in parts:
    if flat:
        continue
    o.data.materials.append(ink)
    m = o.modifiers.new('outline', 'SOLIDIFY')
    m.thickness = .030; m.offset = 1; m.use_flip_normals = True; m.use_rim = False; m.material_offset = 1

root = bpy.data.objects.new('turn', None); scene.collection.objects.link(root)
for o, _ in parts:
    o.parent = root
cam = bpy.data.cameras.new('cam'); cam.type = 'ORTHO'; cam.ortho_scale = 6.5
co = bpy.data.objects.new('cam', cam); scene.collection.objects.link(co); scene.camera = co
co.location = (0, -20, 3.0); co.rotation_euler = (math.pi / 2, 0, 0)
for name, energy, rot in (('key', 1.7, (.75, 0, -.55)), ('fill', .55, (1.25, 0, .85)), ('back', .9, (.9, 0, 2.8))):
    l = bpy.data.lights.new(name, 'SUN'); l.energy = energy; l.angle = .6
    lo = bpy.data.objects.new(name, l); scene.collection.objects.link(lo); lo.rotation_euler = rot
w = bpy.data.worlds.new('w'); scene.world = w; w.use_nodes = True
w.node_tree.nodes['Background'].inputs['Color'].default_value = (.7, .74, .78, 1)
w.node_tree.nodes['Background'].inputs['Strength'].default_value = .35
scene.view_settings.view_transform = 'Standard'
scene.render.engine = 'BLENDER_EEVEE'
scene.render.film_transparent = True
scene.render.resolution_x = scene.render.resolution_y = 720
for i, deg in enumerate((0, 30, 90, 180)):
    root.rotation_euler.z = math.radians(deg)      # 30/90 度時臉朝畫面右邊，與參考圖相同
    scene.render.filepath = os.path.join(OUT, f'view{i}.png')
    bpy.ops.render.render(write_still=True)
root.rotation_euler.z = 0
print('DONE')

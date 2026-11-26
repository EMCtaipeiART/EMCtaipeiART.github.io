# 生成版 Machi：哪些頂點是皮膚（臉、耳朵）。從正面與側面打深度圖，沿著深度的斷差（髮束邊緣）圈出皮膚範圍，
# 再寫回 pixel-plaza/assets/machi3d/machi-gen.glb 的頂點色（紅＝皮膚）。gen_cat_model.py 重做模型後要再跑一次。
# 執行：Blender --background --factory-startup --python models/machi/gen_machi_mask.py [-- 預覽圖.png]
import bpy, bmesh, os, sys
import numpy as np
from mathutils import Vector
from mathutils.bvhtree import BVHTree
ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
PATH = os.path.join(ROOT, 'pixel-plaza/assets/machi3d/machi-gen.glb')
bpy.ops.wm.read_factory_settings(use_empty=True)
bpy.ops.import_scene.gltf(filepath=PATH)
o = [o for o in bpy.context.scene.objects if o.type == 'MESH'][0]
me = o.data
bm = bmesh.new(); bm.from_mesh(me); bm.transform(o.matrix_world); bm.normal_update()
tree = BVHTree.FromBMesh(bm)
K = 2.6 / 1024                     # 和正交視圖同一套像素座標
X0, X1, Y0, Y1 = 230, 800, 180, 530

def depth(view):                    # front：從前面看；right/left：從兩側看（u＝朝前）
    D = np.full((Y1 - Y0, X1 - X0), -9.0)
    for j in range(Y1 - Y0):
        for i in range(X1 - X0):
            u, z = (X0 + i - 512) * K, 1.1 + (512 - Y0 - j) * K
            if view == 'front': a, d = Vector((u, -5, z)), Vector((0, 1, 0))
            else:
                s = 1 if view == 'right' else -1
                a, d = Vector((5 * s, -u, z)), Vector((-s, 0, 0))
            h = tree.ray_cast(a, d)
            if h[0]: D[j, i] = 5 - h[3]
    return D

def region(D, seeds, limit, jump):
    gy, gx = np.gradient(D)
    free = (np.hypot(gx, gy) < jump) & (D > -8) & limit
    got = np.zeros(D.shape, bool)
    stack = [(y - Y0, x - X0) for x, y in seeds if free[y - Y0, x - X0]]
    for p in stack: got[p] = True
    while stack:
        j, i = stack.pop()
        for a, b in ((j + 1, i), (j - 1, i), (j, i + 1), (j, i - 1)):
            if 0 <= a < D.shape[0] and 0 <= b < D.shape[1] and free[a, b] and not got[a, b]: got[a, b] = True; stack.append((a, b))
    def dilate(m, times):
        for _ in range(times):
            n = m.copy(); n[1:] |= m[:-1]; n[:-1] |= m[1:]; n[:, 1:] |= m[:, :-1]; n[:, :-1] |= m[:, 1:]; m = n
        return m
    return ~dilate(~dilate(got, 5), 3) & (D > -8)      # 補掉五官造成的小縫，再比原本大 2 px 讓交界落在摺角裡

yy, xx = np.mgrid[Y0:Y1, X0:X1]
def ell(cx, cy, rx, ry): return ((xx - cx) / rx) ** 2 + ((yy - cy) / ry) ** 2 < 1
def poly(pts):                      # 手描的大範圍（比實際寬一點），避免沿著平順的髮面漏到頭髮上
    inside = np.zeros(xx.shape, bool)
    for (x0, y0), (x1, y1) in zip(pts, pts[1:] + pts[:1]):
        if y0 != y1: inside ^= ((yy < y0) != (yy < y1)) & (xx < x0 + (yy - y0) * (x1 - x0) / (y1 - y0))
    return inside
LEFT = [(511, 256), (497, 243), (482, 232), (466, 232), (450, 244), (440, 262), (437, 295), (425, 320), (405, 340), (380, 355), (345, 362), (320, 372)]
FACE = LEFT + [(320, 420), (335, 470), (385, 505), (450, 522), (511, 526), (572, 522), (637, 505), (687, 470), (702, 420), (702, 372)] + [(1022 - x, y) for x, y in LEFT][::-1][:-1]
views = {}
D = depth('front')
face = region(D, [(512, 440), (450, 420), (575, 420), (512, 300)], poly(FACE), .0042)
ears = region(D, [(300, 410), (722, 410)], ell(303, 408, 48, 55) | ell(719, 408, 48, 55), .02) | ((ell(303, 410, 36, 40) | ell(719, 410, 36, 40)) & (D > -8))
views['front'] = (D, face | ears)
for name in ('right', 'left'):
    D = depth(name)
    ear = ell(530, 408, 42, 47) & (D > -8)
    cheek = region(D, [(660, 430), (700, 400)], poly([(560, 380), (610, 352), (660, 360), (740, 340), (800, 345), (800, 525), (640, 525), (560, 490)]), .0075)
    views[name] = (D, ear | cheek)
if '--' in sys.argv:
    out = sys.argv[sys.argv.index('--') + 1]
    img = np.concatenate([np.where(m, 1.0, np.clip((d + .2) / 1.2, 0, 1) * .6) for d, m in views.values()], 1)[::-1]
    im = bpy.data.images.new('p', img.shape[1], img.shape[0])
    im.pixels = np.dstack([img, img, img, np.ones(img.shape)]).ravel(); im.filepath_raw = out; im.file_format = 'PNG'; im.save()

def seen(view, co):                 # 這個頂點在該視圖裡看得到、而且落在皮膚範圍
    D, mask = views[view]
    u, d = (co.x, -co.y) if view == 'front' else (-co.y, co.x if view == 'right' else -co.x)
    i, j = int(round(u / K + 512 - X0)), int(round(512 - (co.z - 1.1) / K - Y0))
    if not (1 <= i < X1 - X0 - 1 and 1 <= j < Y1 - Y0 - 1): return False
    return any(mask[b, a] and abs(D[b, a] - d) < .03 for b in (j - 1, j, j + 1) for a in (i - 1, i, i + 1))
bm.verts.ensure_lookup_table()
def chin(co):                       # 下巴底面從正面、側面都看不到，另外指定（Blender：-y 朝前、z 朝上）
    if 1.18 < co.z < 1.44 and .07 < -co.y < .42 and .3 < abs(co.x) < .6: return True    # 耳朵和臉頰之間的凹縫，深度比對會漏
    return co.z < 1.205 and -co.y > -.01 and abs(co.x) < .42
skin = np.array([1.0 if (seen('front', v.co) or seen('right', v.co) or seen('left', v.co) or chin(v.co)) else 0.0 for v in bm.verts])
near = [[e.other_vert(v).index for e in v.link_edges] for v in bm.verts]
for p in range(3):                  # 去掉零星碎點、把交界抹順
    t = skin.copy()
    for i, n in enumerate(near):
        m = sum(skin[k] for k in n) / len(n)
        t[i] = (1.0 if m > .6 else 0.0 if m < .4 else skin[i]) if p < 2 else (skin[i] + m) / 2
    skin = t
print('SKIN', int((skin > .5).sum()), '/', len(skin))
for a in list(me.color_attributes): me.color_attributes.remove(a)
col = me.color_attributes.new('Col', 'FLOAT_COLOR', 'POINT')
for i, v in enumerate(skin): col.data[i].color = (v, 0, 0, 1)
me.color_attributes.active_color = col
bpy.ops.export_scene.gltf(filepath=PATH, export_format='GLB', export_normals=True, export_materials='NONE', export_texcoords=False, export_vertex_color='ACTIVE', export_all_vertex_colors=True)

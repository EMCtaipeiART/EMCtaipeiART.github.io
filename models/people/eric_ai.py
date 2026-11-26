# Eric 混合版：外型用本機 AI 生成的白模，貼圖照模型上的立體輪廓分區重畫。
# 執行：Blender --background --factory-startup --python eric_ai.py -- <預覽圖資料夾>
import os, sys
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from kit import *
from mathutils.bvhtree import BVHTree
from mathutils.kdtree import KDTree

SRC = os.path.expanduser('~/hunyuan3d-local/out/eric.glb')
SHEET = load(os.path.join(ROOT, 'pixel-plaza/sprites-hd/傅思凱.png'))

# ───────── 匯入並對齊原畫座標（正面欄 u = 120 + PX·x，列 v = 120 − PX·(z−3)） ─────────
bpy.ops.import_scene.gltf(filepath=SRC)
hi = next(o for o in scene.collection.all_objects if o.type == 'MESH')
w_ = hi.matrix_world.copy(); hi.parent = None; hi.data.transform(w_); hi.matrix_world.identity()
for o in list(scene.collection.all_objects):
    if o != hi: bpy.data.objects.remove(o)
co = np.array([v.co for v in hi.data.vertices])
z0, z1 = co[:, 2].min(), co[:, 2].max(); t0, t1 = Z(234), Z(11)
co = (co - [(co[:, 0].max() + co[:, 0].min()) / 2, (co[:, 1].max() + co[:, 1].min()) / 2, z0]) * ((t1 - t0) / (z1 - z0)) + [0, 0, t0]
hi.data.vertices.foreach_set('co', co.astype(np.float32).ravel()); hi.data.update()

def arrays(ob):
    n = len(ob.data.vertices)
    c = np.empty(n * 3, np.float32); ob.data.vertices.foreach_get('co', c)
    nr = np.array([v.normal for v in ob.data.vertices])
    e = np.empty(len(ob.data.edges) * 2, np.int32); ob.data.edges.foreach_get('vertices', e)
    return c.reshape(n, 3), nr, e.reshape(-1, 2)

def smooth(val, edges, it, keep=.0):
    a, b = np.concatenate([edges[:, 0], edges[:, 1]]), np.concatenate([edges[:, 1], edges[:, 0]])
    deg = np.maximum(1, np.bincount(a, minlength=len(val)))
    for _ in range(it):
        acc = np.zeros_like(val); np.add.at(acc, a, val[b])
        val = acc / (deg if val.ndim == 1 else deg[:, None]) * (1 - keep) + val * keep
    return val

# 頭型照原畫輪廓修正（量正面與側面原畫每一列的左右邊）：臉頰下緣收窄、後腦收淺、頭頂前緣收回
V_ = 120 - PX * (co[:, 2] - 3)
sx = np.interp(V_, [11, 30, 44, 62, 74, 86, 98, 104, 112, 124], [.97, .955, .935, .93, .945, .955, .94, .905, .945, 1.0])
co[:, 0] *= sx
VR = [11, 20, 26, 32, 44, 56, 68, 80, 92, 104, 112, 124]
mL = [103, 91.7, 78.5, 74, 58.5, 57, 58, 61, 66, 74.5, 83, 99]; tL = [108, 90.5, 82, 78, 65.5, 62, 61, 65.5, 69.5, 77, 84.5, 99]
mR = [155, 165, 173.5, 178, 179, 179.5, 175, 180, 181, 181, 179, 172]; tR = [149, 159, 167, 173, 176.5, 175.5, 174, 180, 180, 179, 176.5, 172]
a0, a1, b0, b1 = (np.interp(V_, VR, q) for q in (mL, mR, tL, tR))
side_u = 120 - PX * co[:, 1]
co[:, 1] = -((b0 + (side_u - a0) * (b1 - b0) / (a1 - a0)) - 120) / PX
# 下巴收短、變圓：臉的下半部往上收（麥克風與身體不動）
V_ = 120 - PX * (co[:, 2] - 3); F_ = -PX * co[:, 1]
lift = np.clip(V_ - 100, 0, 23) * .22 * np.clip((127.8 - V_) / 4.8, 0, 1) * np.clip((F_ - 8) / 20, 0, 1)
co[:, 2] += lift / PX
hi.data.vertices.foreach_set('co', co.astype(np.float32).ravel()); hi.data.update()

# 白模上生成的鏡框整圈磨平：框選範圍內的點，用四周的臉皮平順地補起來（雙調和填補）
def flatten_glasses(ob):
    n = len(ob.data.vertices)
    c = np.empty(n * 3, np.float32); ob.data.vertices.foreach_get('co', c); c = c.reshape(n, 3).astype(np.float64)
    e = np.empty(len(ob.data.edges) * 2, np.int32); ob.data.edges.foreach_get('vertices', e); e = e.reshape(-1, 2)
    u = 120 + PX * c[:, 0]; v = 120 - PX * (c[:, 2] - 3); f = -PX * c[:, 1]
    lens = np.zeros(n, bool)
    for s_ in (-1, 1):
        P_ = [(120 + s_ * a, b) for a, b in ((1, 77), (8, 71.8), (22, 71.6), (38, 72), (45.5, 76), (46.5, 85), (43, 95), (36, 100.6), (20, 101.2), (9, 99), (4.5, 92), (2.5, 85.5), (1, 84))]
        lens |= in_poly(u, v, P_)
    mask = lens & (f > 28)
    mask |= (np.abs(u - 120) < 6) & (v > 76) & (v < 86) & (f > 40)
    mask |= (np.abs(u - 120) > 33) & (v > 75.5) & (v < 88) & (f > 12.5) & (f < 60)
    a, b = np.concatenate([e[:, 0], e[:, 1]]), np.concatenate([e[:, 1], e[:, 0]])
    near = mask.copy()
    for _ in range(3):
        k = near.copy(); k[a[near[b]]] = True; near = k
    idx = np.nonzero(near)[0]; m = len(idx); back = -np.ones(n, int); back[idx] = np.arange(m)
    sel = (back[a] >= 0) & (back[b] >= 0); a, b = back[a[sel]], back[b[sel]]
    deg = np.bincount(a, minlength=m).astype(float); free = mask[idx]
    def L(x): return deg[:, None] * x - np.stack([np.bincount(a, x[b, k], m) for k in range(x.shape[1])], 1)
    x = c[idx].copy()
    fixed = np.where(free[:, None], 0, x)
    rhs = -L(L(fixed))[free]
    def A(z):
        full = np.zeros((m, 3)); full[free] = z
        return L(L(full))[free]
    z = x[free].copy(); r = rhs - A(z)
    M_ = 1 / (deg[free] ** 2 + deg[free])[:, None]
    q = M_ * r; p = q.copy(); rq = (r * q).sum(0)
    for it in range(6000):
        Ap = A(p); al = rq / np.maximum((p * Ap).sum(0), 1e-30)
        z += al * p; r -= al * Ap
        if np.abs(r).max() < 2e-7: break
        q = M_ * r; new = (r * q).sum(0); p = q + (new / np.maximum(rq, 1e-30)) * p; rq = new
    c[idx[free]] = z
    ob.data.vertices.foreach_set('co', c.astype(np.float32).ravel()); ob.data.update()
    print('flattened', int(free.sum()), 'iters', it, 'residual', float(np.abs(r).max()))
flatten_glasses(hi)
bpy.context.view_layer.objects.active = hi; hi.select_set(True)
hi.data.remesh_voxel_size = .016; bpy.ops.object.voxel_remesh()
hc, hn_, he = None, None, None
n_ = len(hi.data.vertices); hc = np.empty(n_ * 3, np.float32); hi.data.vertices.foreach_get('co', hc); hc = hc.reshape(n_, 3).astype(np.float64)
he = np.empty(len(hi.data.edges) * 2, np.int32); hi.data.edges.foreach_get('vertices', he); he = he.reshape(-1, 2)
fu_ = 120 + PX * hc[:, 0]; fv_ = 120 - PX * (hc[:, 2] - 3); ff_ = -PX * hc[:, 1]
wface = np.clip((46 - np.abs(fu_ - 120)) / 5, 0, 1) * np.clip((fv_ - 66) / 5, 0, 1) * np.clip((110 - fv_) / 6, 0, 1) * (ff_ > 30)
ea, eb = np.concatenate([he[:, 0], he[:, 1]]), np.concatenate([he[:, 1], he[:, 0]]); dg = np.maximum(1, np.bincount(ea, minlength=n_))
for _ in range(40):
    avg = np.stack([np.bincount(ea, hc[eb, k_], n_) for k_ in range(3)], 1) / dg[:, None]
    hc += (avg - hc) * (.6 * wface)[:, None]
hi.data.vertices.foreach_set('co', hc.astype(np.float32).ravel()); hi.data.update()

# 凹凸程度（高模）：凸起為正、溝縫為負，拿來畫髮束亮暗和衣服摺線
hco, hnor, hed = arrays(hi)
sm = smooth(hco.astype(np.float64), hed, 36)
bump_hi = smooth(((hco - sm) * hnor).sum(1), hed, 2)
hbvh = BVHTree.FromObject(hi, bpy.context.evaluated_depsgraph_get())

low = hi.copy(); low.data = hi.data.copy(); scene.collection.objects.link(low)
bpy.data.objects.remove(hi)
bpy.context.view_layer.objects.active = low; low.select_set(True)
m = low.modifiers.new('dec', 'DECIMATE'); m.ratio = (30000 if os.environ.get('EXPORT') else 42000) / sum(len(p.vertices) - 2 for p in low.data.polygons); m.use_collapse_triangulate = True
bpy.ops.object.modifier_apply(modifier='dec')
for p in low.data.polygons: p.use_smooth = True
low.data.update()
lco, lnor, led = arrays(low)
kd = KDTree(len(hco))
for i, c in enumerate(hco): kd.insert(c, i)
kd.balance()
bump = np.array([bump_hi[kd.find(c)[1]] for c in lco])

# ───────── 膚色／衣服分區：從種子點沿表面擴散，遇到溝縫（袖口、手指邊）代價變高，邊界就貼著立體線 ─────────
import heapq
N = len(lco)
lbvh = BVHTree.FromObject(low, bpy.context.evaluated_depsgraph_get())
def seed(deg, u_, v_):
    t = math.radians(deg); c, s_ = math.cos(t), math.sin(t)
    right = Vector((c, -s_, 0)); toward = Vector((-s_, -c, 0))
    p = right * ((u_ - 120) / PX) + toward * 10 + Vector((0, 0, Z(v_)))
    hit = lbvh.ray_cast(p, -toward)
    assert hit[0] is not None, (deg, u_, v_)
    return hit[0]
SEEDS = {
    'skin': [(0, 99, 157), (0, 93, 150.5), (0, 86, 155), (90, 150, 157), (90, 157, 150), (0, 147, 180), (0, 155, 175), (270, 94, 181), (270, 113, 168), (270, 99, 177)],
    'cloth': [(0, 135, 150), (0, 130, 163), (0, 108, 166), (0, 76, 152), (0, 74.5, 165), (90, 112, 141), (90, 100, 150), (90, 134, 160), (90, 105, 166), (270, 122, 140), (270, 121, 157),
              (270, 138, 165), (180, 120, 150), (180, 100, 140), (180, 140, 140), (180, 84, 156), (180, 156, 156), (0, 100, 200), (0, 142, 200), (0, 108, 176), (180, 105, 185), (180, 135, 185), (0, 89, 135), (0, 152, 138)],
}
adj = [[] for _ in range(N)]
for a, b in led:
    L_ = float(np.linalg.norm(lco[a] - lco[b])); bend = max(0.0, -(bump[a] + bump[b]) / 2 - .001)
    c_ = L_ * (1 + 900 * bend)
    adj[a].append((b, c_)); adj[b].append((a, c_))
dist = np.full(N, 1e18); lab = np.zeros(N, int); heap = []
for k_, name in enumerate(('cloth', 'skin')):
    for sd in SEEDS[name]:
        p = np.array(seed(*sd))
        for i in np.nonzero(np.linalg.norm(lco - p, axis=1) < .05)[0]:
            dist[i] = 0; lab[i] = k_; heapq.heappush(heap, (0.0, int(i)))
while heap:
    d_, i = heapq.heappop(heap)
    if d_ > dist[i]: continue
    for j, c_ in adj[i]:
        if d_ + c_ < dist[j]:
            dist[j] = d_ + c_; lab[j] = lab[i]; heapq.heappush(heap, (dist[j], int(j)))
cls = np.zeros((N, 3)); cls[:, 0] = smooth(lab.astype(float), led, 7, .1)

# ───────── 展 UV、把每個貼圖點的立體位置算出來 ─────────
bpy.ops.object.mode_set(mode='EDIT'); bpy.ops.mesh.select_all(action='SELECT')
bpy.ops.uv.smart_project(angle_limit=math.radians(62), island_margin=.002)
bpy.ops.object.mode_set(mode='OBJECT')
T = 4096
me = low.data; me.calc_loop_triangles()
uvl = me.uv_layers.active.data
feat = np.concatenate([lco, lnor, bump[:, None], cls], 1).astype(np.float32)     # 0:3 位置 3:6 法線 6 凹凸 7:10 分類
buf = np.zeros((T, T, feat.shape[1]), np.float32); cov = np.zeros((T, T), bool)
for tri in me.loop_triangles:
    P = np.array([uvl[l].uv for l in tri.loops]) * T - .5
    f = feat[list(tri.vertices)]
    x0, y0 = np.floor(P.min(0)).astype(int); x1, y1 = np.ceil(P.max(0)).astype(int)
    x0, y0 = max(x0, 0), max(y0, 0); x1, y1 = min(x1, T - 1), min(y1, T - 1)
    if x1 < x0 or y1 < y0: continue
    gx, gy = np.meshgrid(np.arange(x0, x1 + 1), np.arange(y0, y1 + 1))
    d = (P[1, 1] - P[2, 1]) * (P[0, 0] - P[2, 0]) + (P[2, 0] - P[1, 0]) * (P[0, 1] - P[2, 1])
    if abs(d) < 1e-9: continue
    w0 = ((P[1, 1] - P[2, 1]) * (gx - P[2, 0]) + (P[2, 0] - P[1, 0]) * (gy - P[2, 1])) / d
    w1 = ((P[2, 1] - P[0, 1]) * (gx - P[2, 0]) + (P[0, 0] - P[2, 0]) * (gy - P[2, 1])) / d
    w2 = 1 - w0 - w1
    e = -.02
    ins = (w0 >= e) & (w1 >= e) & (w2 >= e)
    if not ins.any(): continue
    W3 = np.stack([w0[ins], w1[ins], w2[ins]], 1)
    buf[gy[ins], gx[ins]] = W3 @ f; cov[gy[ins], gx[ins]] = True
F = buf[cov]; del buf
x, y, z = F[:, 0], F[:, 1], F[:, 2]
n = F[:, 3:6] / np.maximum(1e-6, np.linalg.norm(F[:, 3:6], axis=1))[:, None]
bp = F[:, 6]; pskin, pgrey, pwhite = F[:, 7], F[:, 8], F[:, 9]
M = len(x)
u = 120 + PX * x; v = 120 - PX * (z - 3)          # 正面
ub = 120 - PX * x                                  # 背面
fw = -PX * y                                       # 往前的距離（像素）
us = 120 + fw                                      # 側面（左右兩側共用，往臉的方向遞增）
yc = float(np.median(lco[lco[:, 2] > Z(80)][:, 1])); th = np.arctan2(x, -(y - yc))
rng = np.random.default_rng(5)
G = rng.random((64, 64, 64)).astype(np.float32)
def noise(s):
    i = (np.stack([x, y, z], 1) * s).astype(int) % 64
    return G[i[:, 0], i[:, 1], i[:, 2]]

col = np.zeros((M, 3), np.float32); flat = np.zeros(M, bool)
def rgb(c): return np.array(c, np.float32) / 255
def paint(a, c):
    a = np.clip(a, 0, 1).astype(np.float32)
    col[...] = col * (1 - a[:, None]) + rgb(c) * a[:, None]
def soft(d, edge=.28): return np.clip(.5 - d / (2 * edge), 0, 1)
def ramp(q, a, b): return np.clip((q - a) / (b - a), 0, 1)
def poly(pu, pv, pts):
    """有號距離（像素）：多邊形內為負。"""
    inside = in_poly(pu, pv, pts)
    best = np.full(pu.shape, 1e9)
    for (ax, ay), (bx, by) in zip(pts, pts[1:] + pts[:1]):
        dx, dy = bx - ax, by - ay
        t = np.clip(((pu - ax) * dx + (pv - ay) * dy) / max(1e-9, dx * dx + dy * dy), 0, 1)
        best = np.minimum(best, np.hypot(pu - ax - dx * t, pv - ay - dy * t))
    return np.where(inside, -best, best)
def seg(pu, pv, pts):
    P = np.array(pts, float); k = len(P) - 1
    best = np.full(pu.shape, 1e9); at = np.zeros(pu.shape)
    for i in range(k):
        a, d = P[i], P[i + 1] - P[i]
        t = np.clip(((pu - a[0]) * d[0] + (pv - a[1]) * d[1]) / max(1e-9, float(d @ d)), 0, 1)
        r = np.hypot(pu - a[0] - d[0] * t, pv - a[1] - d[1] * t)
        mm = r < best; best = np.where(mm, r, best); at = np.where(mm, (i + t) / k, at)
    return best, at
ridge = ramp(bp, .002, .016); groove = ramp(-bp, .0025, .014)

# ───────── 身體 ─────────
SHIRT, PANTS, SKIN, BELT = (31, 30, 34), (132, 128, 140), (253, 193, 148), (17, 16, 19)
paint(np.ones(M), SHIRT)
paint(ridge * .6, (70, 69, 78)); paint(groove * .85, (6, 6, 8))
front = n[:, 1] < -.1
for pts in ([(95.5, 123), (97.8, 131.2), (104.3, 138.2), (112.2, 129.8), (112, 123)], [(123.4, 123), (123.8, 128.8), (136.4, 139.4), (141.2, 133.4), (144.8, 123)]):
    d = poly(u, v, pts); area = front & (fw > 4)
    paint(soft(d) * area, (45, 43, 49)); paint(soft(np.abs(d) - .55) * area * ramp(v, 124, 127), (84, 82, 92))
torso_front = front & (v > 133) & (v < 171.5) & (fw > 8)
paint(soft(np.abs(u - 119.6) - .35) * torso_front, (6, 6, 8)); paint(soft(np.abs(u - 124.2) - .3) * torso_front, (66, 64, 72))
for bv in (141.5, 152, 163):
    d = np.hypot(u - 121.9, v - bv); paint(soft(d - 1.35) * torso_front, (8, 8, 10)); paint(soft(d - .85) * torso_front, (96, 94, 104))
# 皮帶
belt = soft(np.abs(v - 175.8) - 4.4, .3)
paint(belt, BELT); paint(belt * ridge * .35, (60, 58, 66))
paint(soft(np.abs(v - 171.7) - .35) * .8, (58, 56, 64))
# 褲子
pants = ramp(v, 180.1, 180.7)
paint(pants, PANTS); paint(pants * ridge * .45, (164, 160, 172)); paint(pants * groove * .8 * (1 - .65 * ramp(v, 206, 214)), (62, 58, 72))
paint(soft(seg(u, v, [(120, 181), (120.3, 189), (119.8, 196)])[0] - .45) * (front & (fw > 0)), (70, 66, 82))
for s in (-1, 1):
    d, _ = seg(u, v, [(120 + s * 23, 183), (120 + s * 19, 187.5), (120 + s * 12.5, 189.5)])
    paint(soft(d - .4) * (front & (fw > 8)), (76, 72, 90))
side = np.abs(n[:, 0]) > .6
paint(soft(np.abs(us - 119) - .45) * side * pants * (np.abs(x * PX) > 25), (80, 76, 94))
# 褲耳
for pu, facing_ in ((u - 99.3, front & (fw > 8)), (u - 141, front & (fw > 8)), (ub - 101, n[:, 1] > .1), (ub - 141.5, n[:, 1] > .1)):
    d = np.maximum(np.abs(pu) - 1.7, np.abs(v - 175.9) - 5.2)
    paint(soft(d) * facing_, (24, 22, 28)); paint(soft(d + .75) * facing_, PANTS)
# 皮帶扣
bk = front & (fw > 10)
def box_d(cu, cv, hw, hh, r):
    qx, qy = np.abs(u - cu) - hw + r, np.abs(v - cv) - hh + r
    return np.hypot(np.maximum(qx, 0), np.maximum(qy, 0)) + np.minimum(np.maximum(qx, qy), 0) - r
outer = box_d(120.3, 176.6, 6.9, 4.7, 2.2); inner = box_d(120.6, 176.7, 3.9, 2.1, .9)
paint(soft(outer - .7) * bk, (10, 10, 12)); paint(soft(outer) * bk, (206, 208, 214))
paint(soft(inner) * bk, (20, 19, 22)); paint(soft(seg(u, v, [(118, 176.7), (125.6, 176.7)])[0] - .75) * bk, (206, 208, 214))
# 鞋
shoe = ramp(v, 216.6, 217.2)
paint(shoe, (23, 21, 24)); paint(shoe * ridge * .5, (86, 84, 94)); paint(shoe * groove * .8, (4, 4, 5))
paint(soft(np.abs(v - 228.8) - .45) * shoe, (74, 72, 80)); paint(ramp(v, 229.4, 230) * shoe, (10, 9, 11))
for cu, cv in ((97.5, 221.6), (146.8, 221.6)):
    paint(np.exp(-(((u - cu) / 3.6) ** 2 + ((v - cv) / 1.5) ** 2) ** 1.5) * front * shoe * .8, (168, 168, 182))
# 手與前臂
body_zone = (v > 124) & (v < 196)
sk = ramp(pskin, .475, .525) * body_zone
cuff_ = soft(np.abs(pskin - .44) - .05, .02) * body_zone * (np.abs(x * PX) > 17)
paint(cuff_ * .75 * (1 - sk), (6, 6, 8))
paint(sk, SKIN); paint(sk * groove * .7, (196, 104, 72)); paint(sk * ridge * .2, (255, 214, 176))
# 手錶（+X 手腕）：沿前臂切一圈錶帶，外側加錶面
ax_ = np.array((23.0, 22.0)); ax_ /= np.linalg.norm(ax_)
along = (us - 135.5) * ax_[0] + (v - 173) * ax_[1]
wrist = (x * PX > 24) & (v > 160) & (v < 188) & (us > 118) & (us < 152)
band = soft(np.abs(along) - 3.0) * wrist * ramp(pskin, .3, .5)
paint(band, (192, 195, 204)); paint(soft(np.abs(np.abs(along) - 3.0) - .35) * band, (92, 94, 106)); paint(soft(np.abs(along) - .3) * band * .7, (128, 130, 142))
dial = np.hypot(us - 135.5, v - 173); onl = (x * PX > 30) & (n[:, 0] > .2) & wrist & (pskin > .3)
paint(soft(dial - 5.2) * onl, (60, 62, 70)); paint(soft(dial - 4.4) * onl, (206, 209, 216)); paint(soft(dial - 3.0) * onl, (240, 243, 247))
for hand_ in ([(135.5, 173), (135.5, 170.9)], [(135.5, 173), (137.1, 173.7)]):
    paint(soft(seg(us, v, hand_)[0] - .3) * onl, (40, 40, 48))
# 麥克風：拳頭上緣以上整段照白模外形上色（上黑、下白）
MIC_P = [(104.5, 140.8), (103.5, 137.5), (112, 127.4), (126, 127.4), (126, 135.5), (116.5, 147), (113.5, 146), (110, 142.2)]
mic = (fw > 27.5) & (v > 127.4)
on = soft(poly(u, v, MIC_P), .3) * mic
along = (u - 119.5) * -.70 + (v - 131) * .714
white_part = ramp(along, 5.2, 5.8)
paint(on * (1 - white_part), (21, 20, 23)); paint(on * (1 - white_part) * ridge * .45, (76, 74, 84))
paint(on * white_part, (238, 239, 243)); paint(on * white_part * groove * .55, (140, 142, 152))
paint(on * soft(np.abs(along - 5.5) - .55), (120, 122, 132))

# ───────── 頭 ─────────
head = (v < 118.5) | ((v < 127.5) & ((n[:, 2] < -.28) | (fw > 31)))
collar_back = (v > 116) & (fw < 8) & (n[:, 2] > -.55) & (np.hypot(x * PX, fw + 4) < 30)
head &= ~collar_back
flat[head] = True
col[head] = rgb(SKIN)
H = head.astype(np.float32)
def A(pts): return [(75 + a / 16, 55 + b / 16) for a, b in pts]     # 放大 16 倍原畫上的描點
for cu in (88, 152):
    paint(np.exp(-(((u - cu) / 8) ** 2 + ((v - 96.5) / 5) ** 2) ** 1.4) * .2 * H * front, (247, 126, 104))
paint(np.clip(ramp(-n[:, 2], .25, .9) * .30, 0, 1) * H, (240, 146, 106))
face = H * (front & (fw > 22) & (np.abs(u - 120) < 45))
INK = (14, 8, 7)
def shape(pts, c=INK, k=5, grow=0.0): 
    d_ = poly(u, v, smooth_poly(A(pts), k)); paint(soft(d_ - grow, .22) * face, c); return d_
for pts in ([(205,255),(222,232),(250,208),(290,190),(340,177),(400,170),(460,170),(510,178),(545,192),(562,210),(556,226),(538,227),(500,212),(450,200),(400,198),(345,204),(295,218),(250,240),(222,266),(209,272),(202,264)],
            [(897,212),(912,191),(945,177),(1000,170),(1060,170),(1120,180),(1172,196),(1216,222),(1246,248),(1252,265),(1238,272),(1218,262),(1180,236),(1120,212),(1060,200),(1008,200),(955,210),(916,229),(899,225)],
            [(235,448),(256,427),(292,405),(342,390),(400,386),(462,395),(515,415),(548,440),(558,458),(547,469),(529,466),(500,445),(450,427),(400,419),(345,423),(300,437),(266,456),(248,469),(236,462)],
            [(898,455),(912,434),(950,412),(1000,395),(1060,388),(1122,394),(1172,410),(1207,432),(1222,452),(1215,467),(1197,469),(1170,450),(1120,430),(1060,420),(1000,424),(950,439),(921,459),(906,467)]):
    shape(pts, grow=.32)
paint(soft(seg(u, v, A([(672,541),(690,523),(712,515),(736,515),(758,524),(776,541)]))[0] - .55, .25) * face, (178, 90, 58))
shape([(498,688),(510,671),(538,665),(580,657),(650,648),(730,645),(810,649),(880,658),(920,665),(950,672),(961,690),(951,714),(934,753),(903,794),(863,828),(813,851),(758,864),(715,865),(658,854),(606,830),(562,796),(532,755),(515,716),(499,704)])
mo = smooth_poly(A([(530,702),(560,690),(640,679),(730,675),(820,680),(900,689),(928,700),(912,746),(882,786),(842,817),(788,840),(725,849),(665,840),(614,817),(573,783),(543,742)]), 5)
md_ = poly(u, v, mo); paint(soft(md_, .22) * face, (146, 34, 38))
tg = poly(u, v, smooth_poly(A([(566,768),(606,746),(662,734),(728,741),(796,732),(856,746),(892,768),(856,826),(790,856),(725,864),(660,854),(600,822)]), 5))
paint(soft(np.maximum(md_, tg), .3) * face, (238, 112, 110))
shape([(552,692),(582,679),(650,671),(730,668),(812,672),(882,681),(916,693),(906,708),(862,712),(730,715),(598,712),(558,706)], (255, 253, 250), 4)
paint(soft(seg(u, v, A([(535,702),(598,719),(730,723),(862,719),(920,701)]))[0] - .42, .22) * face, INK)
paint(soft(np.hypot(u - 84.2, v - 94.4) - 1.3, .25) * face, (30, 14, 10))
# 耳窩
ear = H * (np.abs(x * PX) > 43.5) * (((us - 120) / 12) ** 2 + ((v - 91.5) / 17) ** 2 < 1)
inner_ = (np.hypot((us - 121.5) / 5.6, (v - 92) / 9.6) - 1) * 6
paint(soft(inner_, .6) * ear, (236, 140, 106)); paint(soft(np.abs(inner_) - .45) * ear * ramp(121 - us, -5, 1), (190, 100, 72))
paint(ear * groove * .55, (196, 104, 74))
# 推剪漸層（側面與後腦）
FADE = [(143, 40), (141, 56), (138.5, 71), (133.5, 81), (132.6, 90.5), (127.8, 90.5), (126.4, 83.5), (120, 76), (110, 80), (108.5, 104), (103.5, 111), (95, 114.5), (84, 112), (73, 105), (60, 93), (40, 70), (40, 40)]
fd = poly(us, v, FADE)
back_low = np.interp(np.abs(ub - 120), [0, 20, 32, 46, 60], [114.5, 113, 109.5, 99, 88])
is_back = np.abs(th) > 2.35
fa = np.where(is_back, soft(v - back_low, .8), soft(fd, .8)) * H * (np.abs(th) > .78) * (1 - ear)
k = np.interp(v, [58, 78, 92, 103, 114], [0, .12, .40, .70, 1])
grain = (noise(46) - .5) * .10 * (1 - .55 * k)
fade_c = rgb((34, 28, 28))[None] * (1 - k)[:, None] + rgb((156, 117, 98))[None] * k[:, None] + grain[:, None]
col[...] = col * (1 - fa[:, None]) + np.clip(fade_c, 0, 1) * fa[:, None]
# 捲髮：髮際線沿著白模髮束的下緣
FRINGE = [(40, 74), (62, 66), (67, 58.6), (73, 61.4), (76, 56.6), (79.5, 59), (84, 60.6), (87, 56.2), (90.5, 59.4), (95.5, 59), (98.2, 55.6), (101.4, 59.4), (104.5, 56.2), (107.6, 59),
          (111, 55.8), (114, 58.6), (119.4, 61), (123, 56.4), (126, 58.4), (131, 59), (134, 55.6), (137.4, 58.8), (142, 59.6), (146, 55.8), (149, 59.8), (153, 56.2), (156, 58.6),
          (158.4, 55.6), (161.2, 61.4), (163.4, 58.4), (166.4, 60.6), (169, 57.6), (172, 60), (178, 66), (200, 74)]
f_edge = np.interp(u, [120 + (p[0] - 120) * .935 for p in FRINGE], [p[1] for p in FRINGE])
s_edge = np.interp(us, [55, 60, 71, 84, 101, 117, 134, 146, 156, 163, 176], [79, 77.5, 74.5, 70.5, 64.5, 62.5, 61.5, 64, 67, 62.5, 60]) + 1.6 * np.abs(np.sin(us * .55)) - .8
b_edge = np.interp(np.abs(ub - 120), [0, 15, 30, 42, 55], [77.5, 76.5, 73.5, 71, 68]) + 1.8 * np.abs(np.sin(ub * .5)) - .9
wf = ramp(np.abs(th), .72, 1.02); wb = ramp(np.abs(th), 2.15, 2.55)
edge = f_edge * (1 - wf) + s_edge * wf * (1 - wb) + b_edge * wb
ha = soft(v - edge, .35) * (v < 82)
flat[ha > .5] = False
HAIR = (25, 23, 27)
paint(ha, HAIR)
paint(ha * ramp(bp, .001, .020) * .6, (60, 57, 66)); paint(ha * ramp(-bp, .000, .010), (3, 2, 4))
L = np.array((-.35, -.55, .76)); L /= np.linalg.norm(L)
paint(ha * soft(.80 - np.clip(n @ L, 0, 1), .10) * ramp(bp, .006, .016) * .75, (120, 117, 132))
L2 = np.array((.55, -.6, .58)); L2 /= np.linalg.norm(L2)
paint(ha * soft(.90 - np.clip(n @ L2, 0, 1), .06) * ramp(bp, .006, .016) * .6, (112, 108, 124))
# ───────── 寫回貼圖並渲染 ─────────
LG = np.array((-.4, -.55, .75), np.float32); LG /= np.linalg.norm(LG)
shade = .9 + .16 * np.clip(n @ LG, 0, 1)
col = np.where(flat[:, None], col, col * shade[:, None])
img = np.zeros((T, T, 4), np.float32); img[..., :3][cov] = np.clip(col, 0, 1); img[..., 3] = 1
have = cov.copy()
for _ in range(14):
    for ax, d in ((0, 1), (0, -1), (1, 1), (1, -1)):
        shifted = np.roll(have, d, ax); new = ~have & shifted
        img[new] = np.roll(img, d, ax)[new]; have |= new
img[~have, :3] = .1
img = img[::-1]                       # tex_mat 吃的是「第 0 列在上」
flatmap = np.zeros((T, T), bool); flatmap[cov] = flat
skin_mat = tex_mat('face', img)
me.materials.clear(); me.materials.append(skin_mat)
print('tris', len(me.polygons), 'texels', M)

# 預覽：和手工版相同的鏡頭與燈光（EXPORT=1 時改成匯出遊戲模型）
ink = bpy.data.materials.new('outline'); ink.use_nodes = True
nt = ink.node_tree; nt.nodes.clear()
em = nt.nodes.new('ShaderNodeEmission'); em.inputs['Color'].default_value = (.004, .002, .002, 1)
outn = nt.nodes.new('ShaderNodeOutputMaterial'); nt.links.new(em.outputs[0], outn.inputs[0]); ink.use_backface_culling = True
me.materials.append(ink)
mod = low.modifiers.new('outline', 'SOLIDIFY'); mod.thickness = .026; mod.offset = 1; mod.use_flip_normals = True; mod.use_rim = False; mod.material_offset = 1
cam = bpy.data.cameras.new('cam'); cam.type = 'ORTHO'; cam.ortho_scale = 6.5
cobj = bpy.data.objects.new('cam', cam); scene.collection.objects.link(cobj); scene.camera = cobj
tilt = math.radians(float(os.environ.get('TILT', '6')))
cobj.location = (0, -20 * math.cos(tilt), 3.0 + 20 * math.sin(tilt)); cobj.rotation_euler = (math.pi / 2 - tilt, 0, 0)
for name, energy, rot in (('key', 2.0, (.75, 0, -.55)), ('fill', .6, (1.25, 0, .85)), ('back', 1.0, (.9, 0, 2.8))):
    l = bpy.data.lights.new(name, 'SUN'); l.energy = energy; l.angle = .6
    lo = bpy.data.objects.new(name, l); scene.collection.objects.link(lo); lo.rotation_euler = rot
scene.view_settings.view_transform = 'Standard'
scene.render.engine = 'BLENDER_EEVEE'; scene.render.film_transparent = True
scene.render.resolution_x = scene.render.resolution_y = int(os.environ.get('RES', '720'))
low.rotation_mode = 'XYZ'
if not os.environ.get('NOGLASS'):
    FRAME = mat('glass_frame', (150, 150, 160), .8); ARM = mat('glass_arm', (74, 70, 80), .8)
    fb = BVHTree.FromObject(low, bpy.context.evaluated_depsgraph_get()) if False else BVHTree.FromPolygons([v_.co.copy() for v_ in me.vertices], [list(p.vertices) for p in me.polygons])
    def front_hit(u_, v_):
        h = fb.ray_cast(Vector(((u_ - 120) / PX, -10, Z(v_))), Vector((0, 1, 0)))[0]
        return None if h is None else h.y
    def side_x(sg, fw_, v_):
        h = fb.ray_cast(Vector((sg * 10, -fw_ / PX, Z(v_))), Vector((-sg, 0, 0)))[0]
        return sg * 1.3 if h is None else h.x
    A = lambda pts: [(75 + a / 16, 55 + b / 16) for a, b in pts]
    LOW = mat('glass_low', (182, 116, 100), .85)
    TOP = {-1: [(135,455),(135,400),(150,366),(186,337),(240,322),(340,317),(450,319),(540,325),(595,341),(626,368),(640,402),(640,455)],
            1: [(822,455),(822,400),(840,367),(877,339),(940,321),(1030,315),(1140,317),(1230,325),(1281,345),(1315,375),(1325,410),(1322,455)]}
    BOT = {-1: [(640,452),(634,505),(610,556),(562,590),(482,606),(380,612),(280,608),(220,595),(176,566),(150,522),(135,452)],
            1: [(1322,452),(1301,540),(1265,580),(1200,601),(1100,612),(1000,608),(920,592),(866,560),(835,508),(822,452)]}
    for sg in (-1, 1):
        in_u, out_u = (115.0, 83.5) if sg < 0 else (126.3, 157.7)
        d_in = front_hit(in_u, 83); d_mid = front_hit((in_u + out_u) / 2, 83); d_out = front_hit(out_u, 83)
        def gy(u_):
            a_ = abs(u_ - 120)
            return float(np.interp(a_, [5.5, 21, 38], [min(d_in, d_mid + .03) - .09, d_mid - .10, d_out - .07]))
        to3 = lambda pts: [((u_ - 120) / PX, gy(u_), Z(v_)) for u_, v_ in A(pts)]
        tube('glass', to3(TOP[sg]), [.017, .017], FRAME, 56, 8)
        tube('glass', to3(BOT[sg]), [.014, .014], LOW, 52, 8)
        o_u = 83.6 if sg < 0 else 157.6
        path = [((o_u - 120) / PX, gy(o_u), Z(80.6))]
        for fw_, v_ in ((40, 80.5), (30, 81.2), (20, 82), (13, 83)):
            path.append((side_x(sg, fw_, v_) + sg * .035, -fw_ / PX, Z(v_)))
        path.append((side_x(sg, 9, 86) - sg * .02, -8 / PX, Z(86)))
        tube('glass', path, [.019, .019, .016, .01], ARM, 48, 8)
        ball('glass', ((o_u - sg * 0 - 120) / PX, gy(o_u) - .005, Z(80.8)), (.035, .02, .038), FRAME, 10, 8)
    tube('glass', [((u_ - 120) / PX, front_hit(120, 82) - .085, Z(v_)) for u_, v_ in A([(645,433),(682,418),(727,412),(772,418),(815,433)])], [.021, .021], FRAME, 20, 8)
    for g_ in scene.collection.objects:
        if g_.name.startswith('glass'):
            g_.parent = low
# ───────── 匯出：切出頭、手、腳（節點名稱 machi_<肢體>__<材質>[_n]，遊戲靠名稱綁關節） ─────────
if os.environ.get('EXPORT'):
    NAMES_ = ['body', 'armR', 'armL']
    ASEEDS = {'body': [(0, 135, 150), (0, 130, 163), (0, 108, 166), (0, 108, 176), (0, 120, 185), (180, 120, 150), (180, 100, 140), (180, 140, 140), (180, 105, 176), (180, 120, 185), (90, 100, 175), (0, 133, 140)],
              'armR': [(0, 86, 155), (0, 99, 157), (90, 112, 150), (0, 76, 152), (0, 111.5, 137.5), (0, 116, 131.5), (180, 156, 156), (0, 89, 138), (90, 150, 157)],
              'armL': [(270, 122, 140), (270, 113, 168), (270, 99, 177), (0, 148, 180), (270, 121, 157), (180, 84, 156), (0, 153, 140), (0, 155, 175)]}
    pv_ = 120 - PX * (lco[:, 2] - 3); pf_ = -PX * lco[:, 1]; px_ = PX * lco[:, 0]
    domain = (pv_ > 121) & (pv_ < 193)
    d2 = np.full(N, 1e18); lb = np.zeros(N, int); hq = []
    adj2 = [[] for _ in range(N)]
    for a, b in led:
        if domain[a] and domain[b]:
            L_ = float(np.linalg.norm(lco[a] - lco[b])); bend = max(0.0, -(bump[a] + bump[b]) / 2 - .001)
            c_ = L_ * (1 + 1400 * bend); adj2[a].append((b, c_)); adj2[b].append((a, c_))
    for k_, name in enumerate(NAMES_):
        for sd in ASEEDS[name]:
            p = np.array(seed(*sd))
            for i in np.nonzero(np.linalg.norm(lco - p, axis=1) < .07)[0]:
                d2[i] = 0; lb[i] = k_; heapq.heappush(hq, (0.0, int(i)))
    while hq:
        d_, i = heapq.heappop(hq)
        if d_ > d2[i]: continue
        for j, c_ in adj2[i]:
            if d_ + c_ < d2[j]: d2[j] = d_ + c_; lb[j] = lb[i]; heapq.heappush(hq, (d2[j], int(j)))
    score = np.stack([smooth((lb == k_).astype(float), led, 3, .2) for k_ in range(3)], 1)
    labels = []
    for p in me.polygons:
        vs = list(p.vertices); c = lco[vs].mean(0); nm = lnor[vs].mean(0); nm /= max(1e-9, np.linalg.norm(nm))
        u_, v_, f_ = 120 + PX * c[0], 120 - PX * (c[2] - 3), -PX * c[1]
        collar = v_ > 116 and f_ < 8 and nm[2] > -.55 and math.hypot(c[0] * PX, f_ + 4) < 30
        if (v_ < 118.5 or (v_ < 127.5 and (nm[2] < -.28 or f_ > 31)) or (v_ < 129 and cls[vs, 0].mean() > .6)) and not collar:
            labels.append('head'); continue
        k_ = int(np.argmax(score[vs].sum(0))) if domain[vs].any() else 0
        if k_ and v_ < 193: labels.append(NAMES_[k_]); continue
        if v_ > 188: labels.append('legL' if c[0] > 0 else 'legR'); continue
        labels.append('body')
    # 膚色（手、前臂）一律跟著手臂走，不然擺手時身上會留下一塊手
    for fi, p in enumerate(me.polygons):
        vs = list(p.vertices); c = lco[vs].mean(0); v_ = 120 - PX * (c[2] - 3)
        if labels[fi] != 'head' and 128 < v_ < 193 and abs(c[0] * PX) > 2 and cls[vs, 0].mean() > .4:
            labels[fi] = 'armL' if c[0] > 0 else 'armR'
    # 邊界收整齊：多數決平滑，再把零碎的小塊併給旁邊
    ek = {}
    for fi, p in enumerate(me.polygons):
        for k_ in p.edge_keys: ek.setdefault(k_, []).append(fi)
    nb = [[] for _ in me.polygons]
    for fs in ek.values():
        for a in fs:
            nb[a].extend(b for b in fs if b != a)
    for _ in range(5):
        new = list(labels)
        for fi in range(len(labels)):
            around_ = [labels[j] for j in nb[fi]]
            for j in nb[fi]: around_ += [labels[q] for q in nb[j] if q != fi]
            best = max(set(around_), key=around_.count)
            if best != labels[fi] and around_.count(best) > len(around_) * .6: new[fi] = best
        labels = new
    seen = [False] * len(labels); comps = {}
    for st_ in range(len(labels)):
        if seen[st_]: continue
        seen[st_] = True; comp = [st_]; stack = [st_]
        while stack:
            a = stack.pop()
            for b in nb[a]:
                if not seen[b] and labels[b] == labels[a]: seen[b] = True; comp.append(b); stack.append(b)
        comps.setdefault(labels[st_], []).append(comp)
    for name, cs in comps.items():
        cs.sort(key=len, reverse=True)
        for comp in cs[1:]:
            if len(comp) < 400:
                around_ = [labels[b] for a in comp for b in nb[a] if labels[b] != name]
                if around_:
                    to = max(set(around_), key=around_.count)
                    for a in comp: labels[a] = to
    me.normals_split_custom_set_from_vertices([tuple(v_.normal) for v_ in me.vertices])
    made = []
    for part in ('head', 'body', 'armR', 'armL', 'legL', 'legR'):
        ob = low.copy(); ob.data = me.copy(); scene.collection.objects.link(ob); ob.modifiers.clear()
        bm_ = bmesh.new(); bm_.from_mesh(ob.data); bm_.faces.ensure_lookup_table()
        kill = [f for f, l_ in zip(bm_.faces, labels) if l_ != part]
        bmesh.ops.delete(bm_, geom=kill, context='FACES')
        if part == 'head':          # 脖子切口修順：先拿掉尖角三角形，再沿著邊緣磨平
            for _ in range(4):
                bmesh.ops.delete(bm_, geom=[f for f in bm_.faces if sum(e.is_boundary for e in f.edges) >= 2], context='FACES')
            for _ in range(25):
                move = {}
                for v_ in bm_.verts:
                    ns = [e.other_vert(v_).co for e in v_.link_edges if e.is_boundary]
                    if len(ns) == 2: move[v_] = v_.co * .5 + (ns[0] + ns[1]) * .25
                for v_, c_ in move.items(): v_.co = c_
        bm_.to_mesh(ob.data); bm_.free()
        ob.data.materials.clear(); ob.data.materials.append(skin_mat)
        ob.name = f'machi_{part}__face'; made.append(ob)
        print(part, len(ob.data.polygons))
    # 擺動時露出的內側：衣服裡襯、腿根與脖子（略小於外型，平常看不到）
    inner = []
    def inner_loft(vlist, m_, nm_):
        rows_ = []
        body_v = np.array([i for p, l_ in zip(me.polygons, labels) if l_ == 'body' for i in p.vertices])
        for v_ in vlist:
            sel = body_v[np.abs(pv_[body_v] - v_) < 3]
            mid = sel[np.abs(px_[sel]) < 12]
            w_ = float(min(np.percentile(np.abs(px_[sel]), 96), 29)) - 3.5
            ff = float(pf_[mid].max()) - 4; bk = float(pf_[mid].min()) + 4
            rows_.append((v_, max(8, w_), 120 + max(ff, bk + 6), 120 + bk))
        o_, _ = loft('inner', rows(rows_), m_, 36, 14, 2.4)
        o_.name = f'machi_body__{nm_}_n'; inner.append(o_)
    def rows(t): return [(Z(v_), w_ / PX, Y(f_), Y(b_)) for v_, w_, f_, b_ in t]
    inner_loft([171.5, 160, 150, 140, 131], mat('inner_shirt', (26, 25, 29), 1), 'inner_shirt')
    inner_loft([180.5, 176, 171.5], mat('inner_belt', (17, 16, 19), 1), 'inner_belt')
    inner_loft([189, 185, 180.5], mat('inner_pants', (112, 108, 120), 1), 'inner_pants')
    for sg, side_ in ((1, 'legL'), (-1, 'legR')):
        sel = np.nonzero((np.abs(pv_ - 192) < 3) & (px_ * sg > 1))[0]
        cx_, cy_ = float(lco[sel, 0].mean()), float(lco[sel, 1].mean())
        rx = float(np.ptp(lco[sel, 0])) / 2 * .9; ry = float(np.ptp(lco[sel, 1])) / 2 * .9
        o_ = ball('plug', (cx_, cy_, Z(189.5)), (rx, ry, .27), mat('inner_pants', (112, 108, 120), 1), 20, 14)
        o_.name = f'machi_{side_}__inner_pants_n'; inner.append(o_)
    o_ = ball('neck', (0, .0, Z(124)), (.36, .34, .3), mat('inner_skin', (233, 168, 128), 1), 18, 12)
    o_.name = 'machi_body__inner_skin_n'; inner.append(o_)
    glass = [o for o in scene.collection.objects if o.name.startswith('glass')]
    for o_ in glass:
        o_.parent = None; o_.name = f'machi_head__{o_.data.materials[0].name}_n'
    bpy.ops.object.select_all(action='DESELECT')
    for o_ in made + inner + glass: o_.select_set(True)
    out = os.environ['EXPORT']
    bpy.ops.export_scene.gltf(filepath=out, export_format='GLB', use_selection=True, export_image_format='WEBP', export_image_quality=90)
    print(f'GLB {os.path.getsize(out) / 1024:.0f} KB'); print('DONE'); sys.exit(0)

for i, deg in enumerate(int(q) for q in os.environ.get('MACHI_VIEWS', '0,35,90,135,180,270,325').split(',')):
    low.rotation_euler.z = math.radians(deg)
    scene.render.filepath = f'{PREVIEW}/view{i}.png'; bpy.ops.render.render(write_still=True)
print('DONE')

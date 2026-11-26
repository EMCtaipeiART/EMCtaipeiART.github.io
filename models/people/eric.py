# Eric（傅思凱）立體人物：黑色捲束短髮＋漸層推剪、銀框眼鏡、黑襯衫捲袖、灰長褲、黑皮鞋、手拿麥克風、左手手錶。
# 尺寸照角色工坊發佈的 12 角度圖（同 pixel-plaza/sprites-hd/傅思凱.png，240px 一格）量；
# 原畫解析度低，五官直接用向量畫在臉的貼圖上（比放大原畫清楚），耳朵剪原畫。
# 執行：Blender --background --factory-startup --python models/people/eric.py -- [預覽圖資料夾]
import os, sys
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from kit import *

SHEET = load(os.path.join(ROOT, 'pixel-plaza/sprites-hd/傅思凱.png'))
FRONT = SHEET[:, 0:240]

def art_px(x, z): return 121 + x * PX, 120 - (z - 3) * PX          # 模型座標 → 正面圖像素
def X(u): return (u - 121) / PX                                    # 正面圖欄 → 左右
def rows(table): return [(Z(v), w / PX, Y(f), Y(b)) for v, w, f, b in table]

SKIN_RGB = (253, 193, 148)
SKIN = mat('skin', SKIN_RGB, 1)
SKINLINE = mat('skin_line', (196, 108, 76), .9)
HAIR = mat('hair_twist', (30, 28, 31), .75)
SHINE = mat('hair_shine', (86, 84, 94), .9)
SHIRT = mat('shirt', (31, 30, 33), .78)
SHIRT2 = mat('shirt_cuff', (43, 42, 46), .8)
SLINE = mat('shirt_line', (8, 8, 10), .9)
BUTTON = mat('button', (66, 66, 72), .8)
PANTS = mat('pants', (130, 126, 136), .75)
PLINE = mat('pants_line', (78, 74, 86), .85)
BELT = mat('belt', (18, 17, 19), .8)
SILVER = mat('silver', (196, 198, 204), .75)
FRAME = mat('glass_frame', (150, 152, 160), .8)
DIAL = mat('dial', (232, 236, 240), .85)
SHOE = mat('shoe', (24, 22, 24), .65)
SOLE = mat('sole', (12, 11, 13), .7)
LACE = mat('lace', (44, 42, 46), .75)
MICW = mat('mic_white', (240, 240, 242), .8)
MICB = mat('mic_black', (20, 20, 22), .7)

# ───────── 臉 ─────────
FACE_ROWS = rows([(124, 4, 146, 112), (122.5, 19, 160, 101), (119.5, 31, 168, 93), (115, 39, 173, 88), (108, 44.5, 176.5, 81), (100, 47, 178, 74.5),
                  (90, 48.5, 177, 68), (78, 49, 173.5, 65), (66, 48, 171.5, 64), (54, 46, 168, 68), (42, 42, 162, 76), (30, 33, 150, 89), (22, 5, 124, 116)])
def cheek(th, z):
    side = np.exp(-((np.abs(th) - .85) / .36) ** 2)
    return side * (.035 * np.exp(-((z - Z(102)) / .2) ** 2))

def seg_dist(px, py, pts):
    """到折線的距離與沿線位置（0～1），用來畫兩頭收尖的筆畫。"""
    best = np.full(px.shape, 1e9); where = np.zeros(px.shape)
    P = np.array(pts, float); n = len(P) - 1
    for i in range(n):
        a, d = P[i], P[i + 1] - P[i]
        t = np.clip(((px - a[0]) * d[0] + (py - a[1]) * d[1]) / max(1e-9, float(d @ d)), 0, 1)
        r = np.hypot(px - a[0] - d[0] * t, py - a[1] - d[1] * t)
        m = r < best; best = np.where(m, r, best); where = np.where(m, (i + t) / n, where)
    return best, where

def face_texture(W=1024, H=768):
    R = smooth_rows(FACE_ROWS)
    U, V = np.meshgrid((np.arange(W) + .5) / W, 1 - (np.arange(H) + .5) / H)
    th = (U - .5) * 2 * math.pi
    x, y, z = surf(R, th, V, 2.35, bump=cheek)
    col = np.ones((H, W, 3), np.float32) * (np.array(SKIN_RGB, np.float32) / 255)
    front = np.cos(th) > .2
    nx, ny = art_px(x, z)
    def paint(a, rgb):
        a = np.clip(a, 0, 1) * front
        col[...] = col * (1 - a[..., None]) + np.array(rgb, np.float32) / 255 * a[..., None]
    def soft(d, edge=.35): return np.clip((edge - d) / (2 * edge) + .5, 0, 1)
    for cx in (89, 153):                                            # 腮紅
        paint(np.exp(-(((nx - cx) / 8.5) ** 2 + ((ny - 96) / 5.5) ** 2) ** 1.4) * .34, (247, 126, 104))
    INK = (26, 14, 12)
    def stroke(pts, w, rgb=INK, taper=.55):
        pts = smooth_open(pts)
        d, t = seg_dist(nx, ny, pts)
        paint(soft(d - w * (1 - taper * np.abs(t - .5) * 2)), rgb)
    for s in (-1, 1):
        m = lambda pts: [(121 + s * u, v) for u, v in pts]
        stroke(m([(11.5, 69.5), (17, 67), (24, 66.6), (31, 69.2)]), 1.5)          # 眉毛
        stroke(m([(11.5, 83.6), (16, 80.6), (22, 80), (27, 81.4), (30.5, 83.8)]), 1.4)   # 笑瞇的眼睛
    stroke([(116.5, 88.2), (119, 86.9), (122.5, 86.7), (125, 88)], .65, (204, 108, 70))   # 鼻子
    mouth = smooth_poly([(107, 96.6), (114, 97.6), (121, 98), (128, 97.4), (135, 96.4), (133, 101.6), (128.5, 106.2), (121, 108.4), (113.5, 106.4), (109, 101.8)], 5)
    inside = in_poly(nx, ny, mouth)
    paint(inside * 1.0, (148, 40, 42))
    teeth = in_poly(nx, ny, [(107, 96), (135, 96), (131.5, 100.4), (121, 101.2), (110.5, 100.6)]) & inside
    paint(teeth * 1.0, (255, 252, 248))
    tongue = (((nx - 121) / 9) ** 2 + ((ny - 107.5) / 5) ** 2 < 1) & inside & ~teeth
    paint(tongue * 1.0, (236, 112, 108))
    d, _ = seg_dist(nx, ny, mouth + mouth[:1]); paint(soft(d - .65), INK)
    paint(soft(np.hypot(nx - 84.5, ny - 94) - 1.3), (40, 18, 14))                    # 臉頰上的痣
    edge = np.clip((np.abs(th) - .75) / .9, 0, 1) * .26 + np.clip((Z(115) - z) / .25, 0, 1) * .3
    edge = np.clip(edge, 0, .42)[..., None]
    col = col * (1 - edge) + np.array((240, 146, 106), np.float32) / 255 * edge
    return np.dstack([col, np.ones((H, W), np.float32)])

def smooth_open(pts, k=6):
    return [(float(v.x), float(v.y)) for v in catmull([(u, v, 0) for u, v in pts], (len(pts) - 1) * k)]

loft('head', FACE_ROWS, tex_mat('face', face_texture()), 72, 48, 2.35, bump=cheek, uv=True)

# ───────── 頭髮 ─────────
# 外型照原畫輪廓量（正面給寬度、側面給前後緣），花紋直接把原畫前／後／左／右四個方向投上去：
# 一束一束的捲髮、瀏海的尖角、漸層推剪就和原畫一樣。
HAIR_ROWS = rows([(115, 27, 134, 92), (108, 42, 146, 80), (100, 47, 152, 73.5), (90, 49.5, 164, 67), (78, 49.8, 171, 63.5), (68, 49, 172.5, 62),
                  (60, 49, 172, 62), (52, 50.3, 175, 62.5), (46, 50.5, 175, 64.5), (40, 49.5, 174, 68.5), (34, 46.5, 172.5, 74.5), (28.5, 42.5, 167, 81),
                  (24, 38, 162.5, 86), (20.5, 33, 156.5, 91.5), (17.5, 27.5, 152, 100), (15.5, 21, 146, 107), (14, 11, 137, 113), (13.2, 2, 125, 121)])
def scallop(th, z):          # 髮束讓外輪廓有一點起伏
    hi = np.clip((z - Z(72)) / .5, 0, 1)
    return .048 * hi * (np.abs(np.sin(th * 10 + z * 5.5)) - .55) + .024 * hi * (np.abs(np.sin(th * 7 - z * 9)) - .5)

def sharpen(img, k=.9):
    p = np.pad(img, ((2, 2), (2, 2), (0, 0)), mode='edge')
    blur = sum(p[2 + dy:p.shape[0] - 2 + dy, 2 + dx:p.shape[1] - 2 + dx] for dy in (-1, 0, 1) for dx in (-1, 0, 1)) / 9
    out = img.copy(); out[..., :3] = np.clip(img[..., :3] + (img[..., :3] - blur[..., :3]) * k, 0, 1); return out
SHARP = sharpen(SHEET)
def view(i): return SHARP[:, i * 240:(i + 1) * 240]

def fade_color(v, grain):
    k = np.interp(v, [60, 78, 92, 103, 113], [0, .14, .42, .72, 1])[..., None]
    col = np.array((40, 33, 32), np.float32) / 255 * (1 - k) + np.array((150, 112, 94), np.float32) / 255 * k
    return np.clip(col + ((grain - .5) * .14)[..., None] * (1 - .5 * k), 0, 1)

def hair_texture(W=1024, H=768):
    R = smooth_rows(HAIR_ROWS)
    U, V = np.meshgrid((np.arange(W) + .5) / W, 1 - (np.arange(H) + .5) / H)
    th = (U - .5) * 2 * math.pi
    x, y, z = surf(R, th, V, 2.3, bump=scallop)
    u, v = 120 - PX * y, 120 - PX * (z - 3)
    rng = np.random.default_rng(3)
    grain = np.repeat(np.repeat(rng.random((H // 3 + 1, W // 3 + 1)), 3, 0), 3, 1)[:H, :W]
    # 曲面法線（決定每個點看哪一張原畫）
    P = np.dstack([x, y, z])
    du = np.gradient(P, axis=1); dv = np.gradient(P, axis=0)
    n = np.cross(du, dv); n /= np.maximum(1e-9, np.linalg.norm(n, axis=2))[..., None]
    out = P - np.dstack([x * 0, np.full_like(y, .05), np.full_like(z, Z(65))])
    n *= np.sign((n * out).sum(2))[..., None] + 0
    fade = fade_color(v, grain)
    def take(img, uu, vv, bad):
        c = sample(img, uu, vv)
        skin = (c[..., 0] > .62) & (c[..., 0] - c[..., 2] > .16)
        miss = (c[..., 3] < .6) | skin | bad
        rgb = c[..., :3].copy()
        top = miss & (vv < 58)
        rgb[top] = np.array((22, 20, 23), np.float32) / 255
        low = miss & ~top
        rgb[low] = fade[low]
        return rgb
    vv = np.clip(v, 15.5, 118)
    shrink = .955                                                   # 取樣往內縮，原畫外框線才不會貼到側面
    uf = 121 + (x * PX) * shrink
    ub = 120 - (x * PX) * shrink
    ul = 119 + (120 - PX * y - 119) * shrink                        # 面向畫面右的側面（角色右側 −X）
    ur = 240 - ul                                                   # 面向畫面左的側面（+X）
    temple = lambda s_u: (s_u > 120) & (v > 75) & (v < 87)
    def behind_ear(s_u):          # 原畫耳朵佔住的地方：改取後方同一列的推剪色，邊緣漸變才看不出色塊
        ramp = lambda t: (lambda c: c * c * (3 - 2 * c))(np.clip(t, 0, 1))
        w_ = ramp((s_u - 84) / 14) * ramp((140 - s_u) / 9) * ramp((v - 66) / 12) * ramp((118 - v) / 6)
        return s_u * (1 - w_) + (88 + (s_u - 112) * .12) * w_
    front = take(view(0), uf, vv, (v > 60) & (np.abs(x * PX) > 46))
    back = take(view(6), ub, vv, (np.abs(ub - 120) > 41) & (v > 72) & (v < 108))
    l_u = behind_ear(ul); r_u = behind_ear(240 - ur)
    left = take(view(3), l_u, vv, temple(l_u))
    right = take(view(9), 240 - r_u, vv, temple(r_u))
    nx_, ny_, nz_ = n[..., 0], n[..., 1], n[..., 2]
    w = np.stack([np.clip(-ny_, 0, 1), np.clip(ny_, 0, 1), np.clip(-nx_, 0, 1), np.clip(nx_, 0, 1)]) ** 7 + 1e-7
    w /= w.sum(0)
    col = w[0][..., None] * front + w[1][..., None] * back + w[2][..., None] * left + w[3][..., None] * right
    # 頭頂：用背面圖的髮旋花紋由上往下投
    tu = 121 - x * PX * .92
    tv = np.clip(40 + (y * PX + 3) * .62, 17, 66)
    crown = take(view(6), tu, tv, np.zeros(u.shape, bool))
    t = np.clip((nz_ - .5) / .3, 0, 1) * np.clip((30 - v) / 8 + .6, 0, 1)
    col = col * (1 - t[..., None]) + crown * t[..., None]
    # 哪些地方是頭髮
    a = np.abs(th)
    hi = v < top_edge(th) + 1.5
    low = np.interp(a, [0, 1.2, 1.55, 1.95, 2.5, 3.15], [60, 80, 98, 108, 113, 115])
    face = ~hi & ((u > np.interp(v, [55, 68, 84, 92], [149, 145, 134, 127])) & (v > 40))
    keep = hi | (~face & (v < low))
    fringe = (a < .95) & (v > 40) & (v < 62)                        # 瀏海下緣照原畫的尖角
    f0 = sample(view(0), 121 + x * PX, v)
    dark = (f0[..., 3] > .5) & (f0[..., :3].max(-1) < .42)
    keep = np.where(fringe, dark | (v < 43), keep)
    side_fade = ~hi & (u > 126) & (v < 84) & (np.abs(x * PX) > 33)          # 鬢角的推剪由深到淺
    k = np.clip((u - 128) / 22, 0, 1) * np.clip((v - 50) / 22, 0, 1)
    soft_ = np.array((96, 74, 66), np.float32) / 255 + ((grain - .5) * .2)[..., None]
    col = np.where(side_fade[..., None], col * (1 - k[..., None] * .8) + soft_ * k[..., None] * .8, col)
    bright = hi & (v < top_edge(th) - .5) & (col.max(-1) > .42)            # 捲髮區不能混到膚色亮點
    col[bright] = (.09, .08, .09)
    edge_ = fringe & (col.max(-1) > .3)
    col[edge_] = (.07, .05, .05)
    return np.dstack([col, keep.astype(np.float32)])

def top_edge(th):          # 上層捲髮的下緣（原圖列）：前面是瀏海、越往後越低
    return np.interp(np.abs(th), [0, .55, .95, 1.3, 1.8, 2.4, 3.15], [49, 50, 53, 60, 66, 72, 77])

loft('hair', HAIR_ROWS, tex_mat('hair', hair_texture(), clip=True), 128, 80, 2.3, bump=scallop, uv=True, caps=False)

# ───────── 耳朵 ─────────
# 原畫側面是大而圓的招風耳，從正面圖剪下來側看會太窄，所以直接做立體耳：外殼＋內側耳窩＋耳輪線
EARIN = mat('ear_in', (234, 138, 104), .9)
for s in (-1, 1):
    c = Vector((s * 50.3 / PX, Y(115.5), Z(91)))
    turn = Matrix.Rotation(s * -.62, 3, 'Z')                  # 耳面朝外前方
    def ep(out, fw, up): return tuple(c + turn @ Vector((s * out / PX, -fw / PX, up / PX)))
    ball('ear', tuple(c), (4.6 / PX, 12 / PX, 14.2 / PX), SKIN, 30, 22, rz=s * -.62)
    ball('ear', ep(3.4, .8, -.8), (2.0 / PX, 6.8 / PX, 8.8 / PX), EARIN, 20, 14, rz=s * -.62)['noline'] = True
    tube('earline', [ep(4.9, f, u) for f, u in ((5.8, 3), (3, 8.4), (-3.2, 8.8), (-6.3, 3), (-5.3, -3.2), (-1.9, -6.4))], [.006, .02, .02, .006], SKINLINE, 30, 6, line=True)
    tube('earline', [ep(5.2, f, u) for f, u in ((2.4, 1.5), (.4, 3), (-1.2, .5), (.2, -3.4), (2.6, -4.6))], [.005, .016, .005], SKINLINE, 20, 6, line=True)

# ───────── 眼鏡 ─────────
FR = smooth_rows(FACE_ROWS)
def face_y(x, z, off):
    w = np.interp(z, FR[:, 0], FR[:, 1]); yf = np.interp(z, FR[:, 0], FR[:, 2]); yb = np.interp(z, FR[:, 0], FR[:, 3])
    q = max(0.0, 1 - min(1.0, abs(x) / w) ** 2.35) ** (1 / 2.35)
    return float((yf + yb) / 2 - (yb - yf) / 2 * q - off)
def glass_pt(u, v): return (X(u), face_y(X(u), Z(v), .10) * .88 + face_y(X(121 + (u - 121) * .45), Z(v), .10) * .12, Z(v))
for s in (-1, 1):
    ring = [(6.5, 77.5), (9, 75.2), (18, 74.4), (30, 74.8), (35, 77), (35.8, 83), (34, 89.5), (29, 92.6), (18, 93.2), (10, 92), (7, 88), (6, 82), (6.5, 77.5)]
    pts = [glass_pt(121 + s * u, v) for u, v in ring]
    tube('glass', pts, [.021, .021], FRAME, 60, 8, line=True)
    side_x = s * 50.6 / PX
    tube('glass', [glass_pt(121 + s * 35.5, 79), (s * 46.5 / PX, Y(157), Z(79.5)), (side_x, Y(138), Z(80.5)), (side_x, Y(118), Z(82)), (s * 50 / PX, Y(108), Z(88))],
         [.022, .022, .019, .019, .012], BUTTON, 36, 6, line=True)
tube('glass', [glass_pt(114.5, 81), glass_pt(121, 79.6), glass_pt(127.5, 81)], [.022, .022], FRAME, 14, 8, line=True)

# ───────── 身體 ─────────
loft('neck', rows([(134, 12, 142, 104), (124, 11, 141, 103), (112, 12, 146, 102)]), SKIN, 24, 8, 2)
TORSO = rows([(178, 31, 148.5, 96.5), (170, 30.5, 149.5, 94.5), (160, 31, 147, 94), (150, 31.5, 145.5, 94), (140, 29.5, 143, 95.5), (132, 24, 140, 98.5), (125.5, 13, 135, 104)])
_, TR = loft('torso', TORSO, SHIRT, 56, 32, 2.5, caps=False)

def front_y(x, z, off=.012):
    w = np.interp(z, TR[:, 0], TR[:, 1]); yf = np.interp(z, TR[:, 0], TR[:, 2]); yb = np.interp(z, TR[:, 0], TR[:, 3])
    q = max(0.0, 1 - min(1.0, abs(x) / w) ** 2.5) ** (1 / 2.5)
    return float((yf + yb) / 2 - (yb - yf) / 2 * q - off)

for s in (-1, 1):                                                      # 尖領
    pts = [(s * u / PX, front_y(u / PX, Z(v), .035), Z(v)) for u, v in ((13, 127.5), (13.5, 131), (13, 134.5), (11.5, 139))]
    tube('collar', pts, [.07, .125, .10, .012], SHIRT2, 18, 10, .35)
for s in (-1, 1):
    tube('collarline', [(s * u / PX, front_y(u / PX, Z(v), .12), Z(v)) for u, v in ((4, 129.5), (6.5, 134), (11, 139.3), (17, 134.5), (20.5, 129))], [.006, .017, .017, .006], BUTTON, 30, 6, line=True)
tube('collar', [(math.sin(a) * 15 / PX, Y(121) - math.cos(a) * 16.5 / PX, Z(125.5) - .05 * max(0, math.cos(a))) for a in np.linspace(.75, math.tau - .75, 21)],
     [.05, .08, .08, .05], SHIRT2, 40, 8, .8)
tube('placket', [(0, front_y(0, Z(v), .008), Z(v)) for v in (133, 145, 157, 170)], [.012, .012], SLINE, 24, 6, line=True)
for v in (139, 150.5, 162):
    ball('button', (.09, front_y(.09, Z(v), .02), Z(v)), (.034, .022, .034), BUTTON, 10, 8)['noline'] = True
def around(rowsR, v, off, a0=-math.pi, a1=math.pi, n=48, power=2.5):
    pts = []
    for a in np.linspace(a0, a1, n):
        t = float(np.interp(Z(v), rowsR[:, 0], np.linspace(0, 1, len(rowsR))))
        x, y, z = (float(q) for q in surf(rowsR, np.array(a), np.array(t), power))
        d = Vector((x, y, 0)).normalized()
        pts.append((x + d.x * off, y + d.y * off, z))
    return pts

# 皮帶、扣環、褲耳
BELT_ROWS = rows([(181, 31.4, 150.3, 95.6), (176, 31.8, 151, 94.8), (171.5, 31.2, 150.6, 94.8)])
_, BR = loft('belt', BELT_ROWS, BELT, 56, 4, 2.5)
by = Y(151) - .045
tube('buckle', [(X(u), by, Z(v)) for u, v in ((115, 172.4), (126.5, 172.4), (127.6, 176), (126.5, 180), (115, 180), (114, 176), (115, 172.4))], [.038, .038], SILVER, 40, 8)
tube('buckle', [(X(120), by - .01, Z(176.2)), (X(127), by - .02, Z(176.2))], [.024, .024], SILVER, 6, 6)
for a in (-.62, .62, 2.45, -2.45):
    p0 = around(BR, 172.2, .02, a, a, 1)[0]; p1 = around(BR, 180.3, .02, a, a, 1)[0]
    tube('loop', [p0, p1], [.035, .035], PANTS, 6, 8, .5)

# 褲子
loft('hips', rows([(194, 27, 144, 101), (186, 30, 147.5, 98), (179, 30.5, 149.5, 96)]), PANTS, 40, 8, 2.6)
for s in (-1, 1):
    loft('leg', [(Z(219), .37, Y(143), Y(101)), (Z(216), .395, Y(145), Y(99.5)), (Z(204), .385, Y(144), Y(100)), (Z(192), .41, Y(146), Y(99)), (Z(184), .39, Y(144), Y(101))],
         PANTS, 32, 10, 2.8, cx=s * .43)
    tube('legline', [(s * .46, Y(146.6), Z(v)) for v in (192, 203, 214)], [.004, .012, .004], PLINE, 14, 6, line=True)
    tube('legline', [(s * u / PX, around(smooth_rows(rows([(194, 27, 144, 101), (186, 30, 147.5, 98), (179, 30.5, 149.5, 96)])), v, .012, 0, 0, 1, 2.6)[0][1], Z(v))
                     for u, v in ((24, 181), (20, 185), (13, 187.5))], [.006, .012, .006], PLINE, 14, 6, line=True)
    before = set(scene.collection.objects)
    shoe(s, SHOE, SOLE, LACE, cx=.57, turn=9)
    for o in set(scene.collection.objects) - before:                   # 低筒皮鞋
        for v in o.data.vertices:
            v.co.z *= .6; v.co.y = v.co.y * .96 + .2

# ───────── 手臂 ─────────
def hand(c, r, thumb, tr):
    ball('hand', c, r, SKIN, 22, 16)
    ball('thumb', thumb, tr, SKIN, 14, 10)
# 角色右手（畫面左側）：手肘外張，手舉到胸前握麥克風
tube('sleeve', [(-.55, -.02, Z(134)), (-.86, -.04, Z(141)), (-1.03, -.04, Z(150)), (-1.05, -.14, Z(156))], [.18, .27, .29, .28], SHIRT, 20, 20)
tube('cuff', [(-1.065, -.09, Z(153.5)), (-1.01, -.28, Z(159))], [.305, .285], SHIRT2, 6, 20)
tube('forearm', [(-1.01, -.24, Z(158)), (-.90, -.55, Z(157.5)), (-.68, -.82, Z(152))], [.23, .21, .17], SKIN, 16, 16)
hand((-.57, -.91, Z(149)), (.25, .21, .23), (-.40, -1.02, Z(144.5)), (.10, .09, .12))
for k, (u, v) in enumerate(((109, 143.5), (111, 149), (110, 154.5))):   # 握住麥克風的手指
    tube('finger', [(X(u - 10), -1.075, Z(v - 1)), (X(u - 3), -1.135, Z(v)), (X(u + 2.5), -1.06, Z(v + .8))], [.07, .078, .055], SKIN, 10, 10)
    tube('fingerline', [(X(u - 8), -1.16, Z(v + 2)), (X(u - 2), -1.215, Z(v + 3)), (X(u + 2), -1.14, Z(v + 3.4))], [.004, .012, .004], SKINLINE, 8, 6, line=True)
MIC = [Vector((X(96), -.93, Z(160))), Vector((X(106.5), -1.0, Z(147))), Vector((X(115.5), -1.08, Z(135.5))), Vector((X(119), -1.1, Z(131)))]
tube('mic', MIC[:2], [.085, .11], MICB, 8, 12)
tube('mic', MIC[1:3], [.135, .15], MICW, 10, 14)
tube('mic', MIC[2:], [.125, .1], MICB, 8, 14)
ball('mic', (X(120.8), -1.11, Z(127.8)), (.155, .14, .185), MICB, 18, 14, ry=.55)
# 角色左手（畫面右側）：手插在腰前，手腕戴錶
tube('sleeve', [(.55, -.02, Z(134)), (.86, -.04, Z(141)), (1.04, -.01, Z(150)), (1.09, -.07, Z(157))], [.18, .27, .29, .28], SHIRT, 20, 20)
tube('cuff', [(1.095, -.03, Z(153.5)), (1.08, -.2, Z(161))], [.305, .285], SHIRT2, 6, 20)
tube('forearm', [(1.08, -.17, Z(159.5)), (1.0, -.45, Z(167)), (.80, -.74, Z(173.5))], [.22, .19, .15], SKIN, 16, 16)
hand((.66, -.84, Z(176)), (.25, .2, .2), (.50, -.9, Z(170.5)), (.14, .09, .09))
for k in range(3):
    u, v = 140 + k * .6, 172.5 + k * 4
    tube('finger', [(X(u - 4), -.98, Z(v + 1.5)), (X(u + 3), -1.025, Z(v)), (X(u + 11), -.93, Z(v - 1))], [.055, .068, .055], SKIN, 10, 10)
wa, wb = Vector((1.0, -.45, Z(167))), Vector((.80, -.74, Z(173.5)))
wc = wa.lerp(wb, .42); axis = (wb - wa).normalized()
e1 = axis.cross(Vector((0, 0, 1))).normalized(); e2 = e1.cross(axis).normalized()
tube('watch', [tuple(wc + e1 * math.cos(a) * .205 + e2 * math.sin(a) * .205) for a in np.linspace(0, math.tau, 25)], [.05, .05], SILVER, 48, 8)
out = e1 if e1.x > 0 else -e1
face_c = wc + out * .22
ball('watch', tuple(face_c), (.075, .13, .13), SILVER, 18, 12, rz=math.atan2(out.y, out.x))
ball('watchdial', tuple(face_c + out * .055), (.04, .085, .085), DIAL, 16, 10, rz=math.atan2(out.y, out.x))['noline'] = True
tube('seam', [(x, y, z) for x, y, z in around(TR, 139, .012, 2.45, 3.83, 17)], [.004, .012, .004], SLINE, 24, 6, line=True)
tube('seam', [(0, around(TR, v, .012, math.pi, math.pi, 1)[0][1], Z(v)) for v in (141, 153, 166)], [.004, .011, .004], SLINE, 20, 6, line=True)

finish('Eric',
       heads={'head', 'hair', 'ear', 'earline', 'glass'},
       legs={'sole', 'shoe', 'tongue', 'lace', 'toecap', 'soleline', 'leg', 'legline'},
       arms={'sleeve', 'cuff', 'forearm', 'hand', 'thumb', 'finger', 'fingerline', 'mic', 'watch', 'watchdial'})

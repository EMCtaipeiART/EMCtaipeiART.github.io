# Noise 立體人物（藍色棒球帽、牛仔外套、白 T、深藍短褲、白球鞋）。做法同 Machi：逐段放樣＋原畫貼圖。
# 尺寸照 pixel-plaza/sprites-hd/Noise.png（12 角度）量；臉和外套正面取自 expedition/story/Noise_neutral.webp。
# 執行：Blender --background --factory-startup --python models/people/noise.py -- [預覽圖資料夾]
import os, sys
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from kit import *

SHEET = load(os.path.join(ROOT, 'pixel-plaza/sprites-hd/Noise.png'))
NEU = load(os.path.join(ROOT, 'expedition/story/Noise_neutral.webp'))
def frame(i): return SHEET[:, i * 240:(i + 1) * 240]

def neutral_px(x, z):
    """模型座標 → 高解析正面圖像素（眼睛、帽頂對位）。"""
    u = 121 + x * PX; v = 120 - (z - 3) * PX
    return 177.5 + (u - 121) * 2.34, 248 + (v - 100) * 2.62

def rows(table): return [(Z(v), w / PX, Y(f), Y(b)) for v, w, f, b in table]

SKIN_RGB = (252, 190, 150)
SKIN = mat('skin', SKIN_RGB, 1)
PINK = mat('skin_pink', (242, 140, 112), .85)
CAP = mat('cap', (14, 54, 150), .78)
CAPTOP = mat('cap_brim', (28, 74, 180), .8)
CAPDARK = mat('cap_dark', (17, 48, 128), .82)
CAPLINE = mat('cap_line', (5, 22, 82), .9)
HAIRM = mat('hair_flat', (38, 26, 24), .8)
DENIM = mat('denim', (98, 142, 188), .8)
DENIM2 = mat('denim_cuff', (130, 172, 212), .8)
DLINE = mat('denim_line', (40, 66, 104), .9)
NAVY = mat('shorts', (36, 50, 84), .75)
ROLL = mat('shorts_roll', (78, 108, 150), .75)
SEAM = mat('seam', (14, 20, 38), .9)
SKINLINE = mat('skin_line', (200, 98, 72), .9)
SHOE = mat('shoe', (244, 240, 234), .75)
SOLE = mat('sole', (226, 218, 208), .75)
LACE = mat('lace', (196, 186, 176), .75)
METAL = mat('button', (182, 176, 168), .8)

# ───────── 臉 ─────────
FACE_ROWS = rows([(126.5, 5, 142, 118), (124.5, 17, 154, 104), (120, 29, 161, 94), (114, 36.5, 165, 86), (108, 40, 166.5, 80), (100, 41.5, 166, 74),
                  (90, 41.5, 165, 71), (80, 40, 163, 70), (70, 37.5, 159, 72), (60, 33, 152, 77), (52, 24, 140, 88), (47, 2, 118, 112)])
def cheek(th, z):
    side = np.exp(-((np.abs(th) - .85) / .38) ** 2)
    return side * (.04 * np.exp(-((z - Z(111)) / .2) ** 2) - .03 * np.exp(-((z - Z(94)) / .22) ** 2))

def face_texture(W=1024, H=768):
    R = smooth_rows(FACE_ROWS)
    U, V = np.meshgrid((np.arange(W) + .5) / W, 1 - (np.arange(H) + .5) / H)
    th = (U - .5) * 2 * math.pi
    x, y, z = surf(R, th, V, 2.35, bump=cheek)
    col = np.ones((H, W, 3), np.float32) * (np.array(SKIN_RGB, np.float32) / 255)
    front = np.cos(th) > .2
    nx, ny = neutral_px(x, z)
    for cx in (115, 240):                                            # 腮紅
        a = np.exp(-(((nx - cx) / 17) ** 2 + ((ny - 286) / 12) ** 2) ** 1.5) * .62 * front
        col = col * (1 - a[..., None]) + np.array((246, 128, 112), np.float32) / 255 * a[..., None]
    s = sample(NEU, nx, ny)[..., :3]
    r, g = s[..., 0], s[..., 1]
    for cx in (127.5, 227.5):                                        # 眼睛
        d = np.sqrt(((nx - cx) / 28) ** 2 + ((ny - 248) / 27) ** 2)
        a = np.clip((1 - d) / .08, 0, 1) * front
        col = col * (1 - a[..., None]) + s * a[..., None]
    for x0, x1 in ((94, 153), (202, 262)):                           # 眉毛
        a = np.clip((.55 - r) / .2, 0, 1) * ((nx > x0) & (nx < x1) & (ny > 199) & (ny < 220)) * front
        col = col * (1 - a[..., None]) + s * a[..., None]
    a = np.clip((.62 - g) / .14, 0, 1) * ((nx > 156) & (nx < 200) & (ny > 280) & (ny < 296)) * front      # 嘴巴
    col = col * (1 - a[..., None]) + s * a[..., None]
    edge = np.clip((np.abs(th) - .75) / .9, 0, 1) * .3 + np.clip((Z(119) - z) / .3, 0, 1) * .35
    edge = np.clip(edge, 0, .45)[..., None]
    col = col * (1 - edge) + np.array((238, 140, 104), np.float32) / 255 * edge
    return np.dstack([col, np.ones((H, W), np.float32)])

loft('head', FACE_ROWS, tex_mat('face', face_texture()), 72, 48, 2.35, bump=cheek, uv=True)

# ───────── 短髮（帽子下露出的後腦、鬢角） ─────────
HAIR_ROWS = rows([(122, 20, 104, 92), (117, 34, 118, 78), (110, 42, 134, 68), (100, 47, 150, 62), (90, 50.5, 163, 59),
                  (80, 51.5, 169, 59), (70, 50, 168, 61), (60, 45, 162, 66), (50, 34, 148, 80), (45, 3, 120, 110)])
def tufts(th, z):
    total = np.zeros(np.shape(th))
    for a0, v0, k in ((1.65, 86, .085), (2.0, 112, .07), (2.55, 116, .075), (3.14, 120, .05), (2.2, 94, .05), (2.85, 100, .045), (1.4, 80, .05)):
        for sg in (1, -1):
            da = np.angle(np.exp(1j * (th - sg * a0)))
            dz = z - Z(v0) + .14 * (np.abs(da) / .3)
            tri = np.clip(1 - np.abs(da) / .3, 0, 1) * np.clip(1 - np.abs(dz) / .17, 0, 1)
            total = np.maximum(total, k * tri)
    return total

FWIN_L = [(177.5, 150), (92, 150), (82, 196), (88, 222), (80, 236), (66, 250), (62, 285), (84, 296), (98, 330), (177.5, 330)]
FRONT_WIN = FWIN_L + [(355 - x, y) for x, y in FWIN_L[::-1]]
SIDE_WIN = [(200, 40), (150, 66), (138, 76), (124, 80), (116, 84), (112, 96), (108, 109), (103, 100), (98, 92), (93, 96), (92, 108),
            (97, 116), (106, 121), (112, 140), (200, 140)]
def hair_texture(W=1024, H=768):
    R = smooth_rows(HAIR_ROWS)
    U, V = np.meshgrid((np.arange(W) + .5) / W, 1 - (np.arange(H) + .5) / H)
    th = (U - .5) * 2 * math.pi
    x, y, z = surf(R, th, V, 2.25, bump=tufts)
    base = np.array((36, 24, 22), np.float32) / 255
    streak = (np.maximum(0, np.cos(th * 19 + z * 6)) ** 6)[..., None]
    col = base * (1 + .3 * streak * np.clip((z - Z(120)) / .6, 0, 1)[..., None])
    nx, ny = neutral_px(x, z)
    win = (y < -.62) & in_poly(nx, ny, FRONT_WIN)
    win |= (np.abs(x) >= .75) & in_poly(120 - PX * y, 120 - PX * (z - 3), SIDE_WIN)
    win |= (z < Z(112)) & (y < -.15)
    pad = np.pad(win, ((0, 0), (6, 6)), mode='wrap')
    line = dilate(pad, 3)[:, 6:-6] & ~win
    col[line] = (.03, .012, .008)
    return np.dstack([col, (~win).astype(np.float32)])

loft('hair', HAIR_ROWS, tex_mat('hair', hair_texture(), clip=True), 96, 56, 2.25, bump=tufts, uv=True, caps=False)

# 耳朵
for s in (-1, 1):
    ball('ear', (s * 1.37, .12, Z(102)), (.31, .17, .34), SKIN, 24, 16, rz=s * .7)
    ball('earin', (s * 1.45, -.025, Z(101.5)), (.17, .05, .21), PINK, 16, 10, rz=s * .7)['noline'] = True
    ball('earin2', (s * 1.41, -.07, Z(103.5)), (.095, .035, .11), SKIN, 14, 8, rz=s * .7)['noline'] = True

# ───────── 棒球帽 ─────────
def droop(y, z):              # 帽緣前高後低
    return .36 * min(1, max(0, (y + .1) / 1.4)) * min(1, max(0, (Z(36) - z) / (Z(36) - Z(70))))
CAP_ROWS = rows([(70, 56.5, 169, 59.5), (63, 57.5, 171.5, 58.5), (54, 56, 169, 60), (44, 51.5, 162, 66), (34, 44, 151, 76),
                 (25, 37, 143, 83), (19, 27, 134, 93), (15.5, 16, 125, 103), (14, 1.5, 116, 113)])
capo, CR = loft('cap', CAP_ROWS, CAP, 64, 28, 2.25, caps=False)
for v in capo.data.vertices: v.co.z -= droop(v.co.y, v.co.z)

def cap_pt(th, v, out=.018):
    t = np.interp(Z(v), CR[:, 0], np.linspace(0, 1, len(CR)))
    x, y, z = surf(CR, np.array(th), np.array(t), 2.25)
    x, y, z = float(x), float(y), float(z)
    cy = float(np.interp(z, CR[:, 0], (CR[:, 2] + CR[:, 3]) / 2))
    d = Vector((x, y - cy, 0)).normalized() if abs(x) + abs(y - cy) > 1e-4 else Vector((0, -1, 0))
    return (x + d.x * out, y + d.y * out, z - droop(y, z) + .004)

for a in (0, 52, -52, 108, -108, 180):
    tube('capline', [cap_pt(math.radians(a), v) for v in (69, 58, 46, 34, 24, 17, 14.5)], [.014, .016, .016, .014, .008], CAPLINE, 22, 6, line=True)
tube('capline', [cap_pt(math.radians(a), 69.2, .012) for a in range(-180, 181, 15)], [.018, .018], CAPLINE, 60, 6, line=True)
ball('capbtn', (0, Y(116), Z(12.5)), (.22, .2, .12), CAP, 18, 10)
# 後方開口與扣帶
bx, by, bz = cap_pt(math.pi, 64, 0)
ball('capback', (0, by - .05, Z(74) - .34), (.50, .11, .30), HAIRM, 24, 12)['noline'] = True
tube('strap', [(-.56, by - .07, Z(76) - .36), (0, by + .09, Z(76) - .35), (.56, by - .07, Z(76) - .36)], [.075, .075, .075], CAPTOP, 16, 10, .45)

# 帽舌：由帽身前緣往外伸的弧形薄板
def brim_edge(s):   # s ∈ [-1, 1]；回傳 (帽身接合點, 外緣點)
    q = abs(s)
    root = Vector(cap_pt(s * math.radians(92), 53 + 17 * q ** 1.7, .005))
    outer = Vector((1.47 * math.sin(s * math.pi / 2 * .93), Y(192 - 30 * q ** 2 - 40 * q ** 5), Z(62 + 29 * q ** 1.7)))
    return root, outer
def brim(name, m, lift):
    nu, nv = 32, 8; verts, faces = [], []
    for i in range(nu + 1):
        s = -1 + 2 * i / nu; root, outer = brim_edge(s)
        for j in range(nv + 1):
            t = j / nv; p = root.lerp(outer, t); p.z += .12 * math.sin(math.pi * t) * (1 - s * s) + lift
            verts.append(tuple(p))
    for i in range(nu):
        for j in range(nv):
            a = i * (nv + 1) + j
            f = (a, a + 1, a + nv + 2, a + nv + 1)
            faces.append(f if lift > 0 else f[::-1])
    return new_obj(name, verts, faces, m)
brim('brim', CAPTOP, .045)
brim('brimunder', CAPDARK, -.03)['noline'] = True
for t, r, m in ((1.0, .04, CAPTOP), (.82, .012, CAPLINE)):
    pts = []
    for i in range(25):
        s = -1 + 2 * i / 24; root, outer = brim_edge(s); p = root.lerp(outer, t)
        p.z += .12 * math.sin(math.pi * t) * (1 - s * s) + (.006 if t == 1 else .062); pts.append(tuple(p))
    tube('brimline', pts, [r * .6, r, r * .6], m, 40, 8, line=m is CAPLINE)

# ───────── 身體 ─────────
loft('neck', rows([(138, 9, 141, 108), (130, 8.5, 142, 106), (121, 10, 143, 107)]), SKIN, 24, 8, 2)
TORSO = rows([(172, 31, 145, 96), (165, 30.5, 145, 96), (155, 29, 143.5, 98), (146, 28, 141.5, 100), (138, 25.5, 139, 102), (131, 20, 136, 105), (127, 11, 132, 110)])

def jacket_texture(W=1024, H=768):
    R = smooth_rows(TORSO)
    U, V = np.meshgrid((np.arange(W) + .5) / W, 1 - (np.arange(H) + .5) / H)
    th = (U - .5) * 2 * math.pi
    x, y, z = surf(R, th, V, 2.5)
    nx, ny = neutral_px(x, z)
    s = sample(NEU, nx, ny)
    den = np.array((100, 143, 188), np.float32) / 255
    col = np.ones((H, W, 3), np.float32) * den
    grain = (np.random.default_rng(1).random((H, W)) - .5) * .06
    col += grain[..., None]
    # 正面貼原畫；圖上屬於外套、白 T 或脖子的像素才用（深色描線與背景不用）
    px_ = s[..., :3]
    skin = (px_[..., 0] > .8) & (px_[..., 2] < .72) & (px_[..., 0] - px_[..., 2] > .22)
    ok = (s[..., 3] > .9) & (np.cos(th) > .45) & (px_.sum(-1) > .55) & (nx > 104) & (nx < 251) & (ny < 458) & ~(skin & (np.abs(nx - 177.5) > 34))
    a = (np.clip((np.cos(th) - .45) / .2, 0, 1) * ok)[..., None]
    col = col * (1 - a) + px_ * a
    # 圖上落在脖子下方的白 T 與下巴陰影
    collar = (np.cos(th) > .6) & (np.abs(nx - 177.5) < 26) & (ny < 350)
    col[collar] = np.array(SKIN_RGB, np.float32) / 255 * .97
    # 背面：肩線、中線、下擺
    back = np.cos(th) < -.55
    col[back & (np.abs(z - Z(143)) < .012)] = (.23, .36, .54)
    col[(np.cos(th) < .4) & (np.abs(z - Z(171)) < .09)] *= 1.12
    return np.dstack([np.clip(col, 0, 1), np.ones((H, W), np.float32)])

_, TR = loft('torso', TORSO, tex_mat('jacket', jacket_texture()), 56, 32, 2.5, uv=True, caps=False)
loft('hips', rows([(183, 30, 144, 99), (170, 30.5, 144.5, 97)]), NAVY, 40, 4, 2.6)

def front_y(x, z, off=.012):
    w = np.interp(z, TR[:, 0], TR[:, 1]); yf = np.interp(z, TR[:, 0], TR[:, 2]); yb = np.interp(z, TR[:, 0], TR[:, 3])
    q = max(0.0, 1 - min(1.0, abs(x) / w) ** 2.5) ** (1 / 2.5)
    return float((yf + yb) / 2 - (yb - yf) / 2 * q - off)

for s in (-1, 1):
    pts = [(s * x, front_y(x, Z(v), .04), Z(v)) for x, v in ((.36, 126.5), (.50, 131), (.50, 137), (.30, 140.5), (.22, 134))]
    tube('collar', pts, [.045, .075, .075, .05, .02], DENIM2, 18, 10, .5)
    for xx, v in ((.52, 148.5), (.30, 162), (.33, 171)):
        ball('button', (s * xx, front_y(xx, Z(v), .03), Z(v)), (.04, .028, .04), METAL, 10, 8)['noline'] = True
    tube('sleeve', [(s * .52, -.06, Z(136)), (s * .83, -.10, Z(143)), (s * 1.07, -.15, Z(151)), (s * 1.17, -.19, Z(156))],
         [.15, .22, .25, .26], DENIM, 20, 20)
    tube('cuff', [(s * 1.12, -.17, Z(153.5)), (s * 1.26, -.23, Z(161))], [.29, .275], DENIM2, 6, 20)
    tube('cuffline', [(s * (1.17 + .235 * math.cos(a)), -.20 + .285 * math.sin(a), Z(157) + s * .17 * math.cos(a))
                      for a in np.linspace(0, math.tau, 13)], [.011, .011], DLINE, 36, 6, line=True)
    ball('hand', (s * 1.34, -.27, Z(169)), (.23, .24, .25), SKIN, 22, 16)
    ball('thumb', (s * 1.17, -.43, Z(168.5)), (.085, .095, .13), SKIN, 14, 10, ry=-s * .45)
    # 短褲＋反折
    loft('short', [(Z(193), .43, Y(142), Y(99)), (Z(185), .43, Y(143), Y(98)), (Z(176), .40, Y(143), Y(98))], NAVY, 32, 8, 3, cx=s * .50)
    loft('cuffroll', [(Z(199.5), .445, Y(143), Y(97.5)), (Z(198.5), .475, Y(144.5), Y(96)), (Z(192.5), .47, Y(144.5), Y(96)), (Z(191.5), .43, Y(142), Y(98.5))],
         ROLL, 32, 8, 3, cx=s * .50)
    loft('leg', [(.60, .22, -.40, .12), (Z(205), .23, -.41, .13), (Z(194), .26, -.44, .14)], SKIN, 24, 8, 2.1, cx=s * .64)
    tube('pocket', [(s * x, front_y(x, Z(v), .02), Z(v)) for x, v in ((.78, 172), (.62, 177), (.42, 178))], [.006, .012, .006], SEAM, 12, 6, line=True)
    before = set(scene.collection.objects)
    shoe(s, SHOE, SOLE, LACE, cx=.66, turn=12)
    for o in set(scene.collection.objects) - before:        # 白球鞋比 Machi 的靴子矮一點
        for v in o.data.vertices:
            v.co.z *= .74; v.co.x = s * .66 + (v.co.x - s * .66) * .95; v.co.y *= .93

finish('Noise',
       heads={'head', 'hair', 'ear', 'earin', 'earin2', 'cap', 'capline', 'capbtn', 'capback', 'strap', 'brim', 'brimunder', 'brimline'},
       legs={'sole', 'shoe', 'tongue', 'lace', 'toecap', 'soleline', 'short', 'cuffroll', 'leg'},
       arms={'sleeve', 'cuff', 'cuffline', 'hand', 'thumb'})

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
FACE_ROWS = rows([(128.3, 5, 142, 118), (126.8, 18, 154, 104), (124.2, 29, 161, 94), (121, 35.5, 164, 87), (117, 39.5, 165.5, 81), (111, 41.5, 166.5, 76),
                  (103, 42.3, 166, 73), (95, 42.3, 165.5, 71), (86, 41.2, 164, 70), (76, 39, 161, 72), (66, 34.5, 155, 76), (56, 25, 141, 88), (51, 2, 118, 112)])
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
    for cx in (127.5, 227.5):                                        # 眼睛（整顆頭加寬，眼睛本身不跟著變胖）
        ex = cx + (nx - cx) * 1.08
        d = np.sqrt(((ex - cx) / 28) ** 2 + ((ny - 248) / 27) ** 2)
        a = np.clip((1 - d) / .08, 0, 1) * front
        col = col * (1 - a[..., None]) + sample(NEU, ex, ny)[..., :3] * a[..., None]
    for x0, x1 in ((94, 153), (202, 262)):                           # 眉毛
        a = np.clip((.55 - r) / .2, 0, 1) * ((nx > x0) & (nx < x1) & (ny > 199) & (ny < 232) & (s[..., 2] < r + .12)) * front
        col = col * (1 - a[..., None]) + s * a[..., None]
    a = np.clip((.62 - g) / .14, 0, 1) * ((nx > 156) & (nx < 200) & (ny > 280) & (ny < 296)) * front      # 嘴巴
    col = col * (1 - a[..., None]) + s * a[..., None]
    edge = np.clip((np.abs(th) - .75) / .9, 0, 1) * .3 + np.clip((Z(119) - z) / .3, 0, 1) * .35
    edge = np.clip(edge, 0, .45)[..., None]
    col = col * (1 - edge) + np.array((238, 140, 104), np.float32) / 255 * edge
    return np.dstack([col, np.ones((H, W), np.float32)])

loft('head', FACE_ROWS, tex_mat('face', face_texture()), 72, 48, 2.35, bump=cheek, uv=True)

# ───────── 短髮（帽子下露出的後腦、鬢角） ─────────
HAIR_ROWS = rows([(126.5, 24, 108, 90), (123, 37, 120, 78), (117, 45, 132, 70), (110, 47, 142, 66), (100, 47, 150, 62), (90, 50.5, 163, 59),
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

FWIN_L = [(177.5, 150), (92, 150), (77, 196), (80, 222), (72, 236), (62, 250), (62, 285), (84, 296), (98, 330), (177.5, 330)]
FRONT_WIN = FWIN_L + [(355 - x, y) for x, y in FWIN_L[::-1]]
SIDE_WIN = [(200, 40), (150, 66), (140, 76), (134, 88), (133, 98), (127, 107), (134, 108), (126, 116), (118, 126), (112, 140), (200, 140)]
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

# 耳朵：照原畫的形狀與耳窩
EAR_ART = [[(x / 4, y / 4 + 100) for x, y in pts] for pts in (
    [(318, 645), (296, 590), (262, 558), (215, 545), (165, 560), (128, 598), (112, 648), (122, 700), (158, 742), (215, 770), (285, 778), (332, 762), (346, 725), (334, 690)],
    [(1096, 645), (1120, 580), (1160, 548), (1215, 543), (1260, 568), (1288, 615), (1292, 660), (1272, 710), (1232, 750), (1165, 776), (1105, 776), (1072, 752), (1075, 700)])]
for s, poly in zip((-1, 1), EAR_ART):
    art_ear(NEU, neutral_px, poly, -.02, s * .55, .15, SKIN)
    for o in [o for o in bpy.context.scene.collection.all_objects if o.name.startswith('ear') and not o.get('moved')]:
        c = sum((v.co for v in o.data.vertices), Vector()) / len(o.data.vertices)
        for v in o.data.vertices:
            v.co = Vector((c.x * .985 + (v.co.x - c.x) * .96, v.co.y, c.z + (v.co.z - c.z) * .96 + 2.5 / PX))
        o['moved'] = True
# 鬢角和帽緣下翹出來的髮尾
for s in (-1, 1):
    tube('sideburn', [(s * 44 / PX, Y(130), Z(80)), (s * 44.5 / PX, Y(138), Z(90)), (s * 43 / PX, Y(143), Z(99)), (s * 40.5 / PX, Y(147), Z(106))],
         [.17, .15, .085, .008], HAIRM, 20, 12, .55)
    tube('sideburn', [(s * 45 / PX, Y(112), Z(78)), (s * 51 / PX, Y(111), Z(85)), (s * 58 / PX, Y(108), Z(88))], [.17, .11, .008], HAIRM, 14, 10, .7)

for s in (-1, 1):                                          # 帽緣兩側和耳下翹出來的捲髮（短而厚，貼著頭）
    for pts, r in ((((43, 112, 80), (51, 112, 82), (57.5, 108, 80)), .13), (((44, 106, 88), (51, 105, 93), (57, 101, 93)), .12),
                   (((38, 112, 109), (44, 111, 115), (49, 106, 114.5)), .16), (((30, 116, 117), (35, 113, 123), (41, 108, 123)), .16),
                   (((20, 122, 122), (23, 118, 126.5), (29, 114, 128)), .13)):
        tube('sideburn', [(s * u / PX, Y(d), Z(v)) for u, d, v in pts], [r * 1.15, r, .012], HAIRM, 16, 12, .75)

# ───────── 棒球帽 ─────────
def droop(y, z):              # 帽緣前高後低
    return .36 * min(1, max(0, (y + .1) / 1.4)) * min(1, max(0, (Z(36) - z) / (Z(36) - Z(70))))
CAP_ROWS = rows([(70, 56.5, 170, 59.5), (63, 57.8, 173.5, 58.5), (54, 57, 173.5, 60), (44, 53.5, 170, 65), (34, 46.5, 162, 73),
                 (25, 39, 152, 81), (19, 28.5, 141, 91), (15.5, 16.5, 129, 102), (14, 1.5, 118, 111)])
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
    root = Vector(cap_pt(s * math.radians(92), 61.5 + 11 * q ** 1.7, .005))
    outer = Vector((1.47 * math.sin(s * math.pi / 2 * .93), Y(192 - 30 * q ** 2 - 40 * q ** 5), Z(73.5 + 17.5 * q ** 1.7)))
    k = max(0.0, (q - .8) / .2) ** 2                       # 帽舌兩角收圓
    return root, outer.lerp(root, .55 * k)
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

pts = []                                                    # 帽舌和帽身之間的深色接縫
for i in range(33):
    root, _ = brim_edge(-1 + 2 * i / 32); pts.append((root.x, root.y - .012, root.z + .07))
tube('brimline', pts, [.012, .026, .03, .026, .012], CAPLINE, 48, 8, line=True)

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

# 原圖的臉寬而短：整顆頭（含帽子、耳朵、頭髮）橫向加寬，下半臉往上收
HEADS = ('head', 'hair', 'sideburn', 'ear', 'earback', 'cap', 'capline', 'capbtn', 'capback', 'strap', 'brim', 'brimunder', 'brimline')
for o in scene.collection.objects:
    if o.type != 'MESH' or o.name.split('.')[0] not in HEADS:
        continue
    for v in o.data.vertices:
        ear = o.name.startswith('ear')
        v.co.x *= 1.06 if ear else float(np.interp(v.co.z, (Z(70), Z(20)), (1.12, 1.06)))      # 耳朵少撐一點，才不會比原圖外擴
        if v.co.z < Z(96):
            v.co.z = Z(96) + (v.co.z - Z(96)) * .91

finish('Noise',
       heads={'head', 'hair', 'ear', 'sideburn', 'earback', 'cap', 'capline', 'capbtn', 'capback', 'strap', 'brim', 'brimunder', 'brimline'},
       legs={'sole', 'shoe', 'tongue', 'lace', 'toecap', 'soleline', 'short', 'cuffroll', 'leg'},
       arms={'sleeve', 'cuff', 'cuffline', 'hand', 'thumb'})

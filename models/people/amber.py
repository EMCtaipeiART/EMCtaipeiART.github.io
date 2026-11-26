# Amber 立體人物（深棕大波浪長髮、棕色短外套、淺藍襯衫、蕾絲背心、珍珠項鍊、寬牛仔褲、豹紋鞋）。
# 做法同 Machi：逐段放樣＋原畫貼圖。尺寸照 pixel-plaza/sprites-hd/Amber.png（12 角度）量；臉、頭髮正面與上衣取自 expedition/story/Amber_neutral.webp。
# 執行：Blender --background --factory-startup --python models/people/amber.py -- [預覽圖資料夾]
import os, sys
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from kit import *

NEU = load(os.path.join(ROOT, 'expedition/story/Amber_neutral.webp'))

def neutral_px(x, z):
    """模型座標 → 高解析正面圖像素（雙眼中心對位）。"""
    u = 120.5 + x * PX; v = 120 - (z - 3) * PX
    return 246 + (u - 120.5) * 2.55, 202 + (v - 78) * 2.55

def rows(table): return [(Z(v), w / PX, Y(f), Y(b)) for v, w, f, b in table]
def P(x, u, v): return (x / PX, Y(u), Z(v))          # 正面圖橫向偏移、側面圖欄、列
def rgb(c): return np.array(c, np.float32) / 255

SKIN_RGB = (254, 192, 152)
HAIR_RGB = (66, 41, 34)
SKIN = mat('skin', SKIN_RGB, 1)
PINK = mat('skin_pink', (238, 128, 88), .85)
HAIRM = mat('hair_flat', HAIR_RGB, .85)
JACKET = mat('jacket', (68, 42, 34), .75)
JLINE = mat('jacket_line', (30, 16, 12), .9)
SHIRT = mat('shirt', (216, 224, 250), .82)
PEARL = mat('pearl', (252, 244, 236), .85)
JEAN = mat('jeans', (96, 126, 164), .75)
JEAN2 = mat('jeans_fold', (62, 88, 126), .8)
JEAN3 = mat('jeans_light', (138, 164, 192), .8)
STITCH = mat('jeans_stitch', (186, 176, 156), .85)
METAL = mat('button', (190, 136, 84), .8)
SHOE = mat('shoe', (112, 68, 42), .75)
SOLE = mat('sole', (58, 34, 24), .75)
LACE = mat('lace', (44, 24, 16), .75)
WHITE = mat('shoe_white', (250, 244, 236), .85)
SPOT = mat('shoe_spot', (38, 20, 12), .85)
GOLD = mat('buckle', (196, 164, 100), .8)

# ───────── 臉：原畫正面直接貼 ─────────
FACE_ROWS = rows([(110, 4, 142, 112), (108, 15, 157, 98), (104, 28, 167, 88), (99, 35.5, 172, 82), (92, 40, 175, 78), (84, 41.5, 171, 76),
                  (74, 41.5, 171, 76), (62, 39, 170, 78), (50, 33, 165, 82), (40, 21, 151, 90), (36, 3, 125, 115)])
FACE_ART = [(216, 108), (232, 106), (248, 108), (262, 106), (280, 108), (298, 127), (312, 156), (327, 180), (342, 202), (342, 230), (328, 252),
            (299, 268), (248, 274), (200, 268), (167, 252), (150, 230), (150, 202), (166, 182), (181, 156), (195, 127)]

def face_texture(W=1024, H=768):
    R = smooth_rows(FACE_ROWS)
    U, V = np.meshgrid((np.arange(W) + .5) / W, 1 - (np.arange(H) + .5) / H)
    th = (U - .5) * 2 * math.pi
    x, y, z = surf(R, th, V, 2.35)
    col = np.ones((H, W, 3), np.float32) * rgb(SKIN_RGB)
    front = np.cos(th) > .2
    nx, ny = neutral_px(x, z)
    s = sample(NEU, nx, ny)
    inside = in_poly(nx, ny, FACE_ART) & front & (s[..., 3] > .9)
    eyes = (((nx - 193) / 35) ** 2 + ((ny - 201) / 32) ** 2 < 1) | (((nx - 299) / 35) ** 2 + ((ny - 201) / 32) ** 2 < 1)
    brows = ((np.abs(nx - 198) < 24) | (np.abs(nx - 294) < 24)) & (ny > 141) & (ny < 163)
    mouth = (np.abs(nx - 246) < 26) & (ny > 238) & (ny < 258)
    dark = s[..., :3].sum(-1) < 1.2
    a = ((inside & (~dark | eyes | brows | mouth)) | (eyes & front)).astype(np.float32)
    for cx in (180, 312):                                            # 腮紅補足
        b = np.exp(-(((nx - cx) / 17) ** 2 + ((ny - 236) / 11) ** 2) ** 1.5) * .3 * front * (1 - a)
        col = col * (1 - b[..., None]) + rgb((248, 124, 108)) * b[..., None]
    col = col * (1 - a[..., None]) + s[..., :3] * a[..., None]
    edge = np.clip((np.abs(th) - .8) / .9, 0, 1) * .3 + np.clip((Z(105) - z) / .2, 0, 1) * .3
    edge = np.clip(edge, 0, .4)[..., None] * (1 - a[..., None])
    col = col * (1 - edge) + rgb((236, 132, 92)) * edge
    return np.dstack([col, np.ones((H, W), np.float32)])

loft('head', FACE_ROWS, tex_mat('face', face_texture()), 72, 48, 2.35, uv=True)

# ───────── 大波浪長髮 ─────────
def waves(k):
    def f(th, z):
        return k * np.sin(z * 7.2 + np.abs(th) * 3.2) + k * .6 * np.sin(th * 9 + z * 2.5)
    return f

def hair_color(th, z, phase=0.0):
    """上段順直、往下才起大波浪；th 的倍數用整數，後面接縫才不會斷。"""
    col = np.ones(th.shape + (3,), np.float32) * rgb(HAIR_RGB)
    amp = np.clip((Z(62) - z) / 1.1, 0, 1)
    bend = amp * (1.9 * np.sin(z * 4.1 + 2.2 * np.sin(th * 3 + phase)) + .5 * np.sin(z * 8.3 + th * 5))
    light = np.maximum(0, np.sin(th * 5 + bend * 1.2 + 1.9 + phase)) ** 4
    light = (light * (.35 + .65 * np.clip(np.sin(z * 3.3 + th * 2 + phase), 0, 1)))[..., None]
    col = col * (1 - .8 * light) + rgb((96, 62, 48)) * .8 * light
    for k, off, power, strength in ((8, 0.0, 40, 1.0), (13, 1.7, 60, .7)):
        dark = (np.maximum(0, np.cos(th * k + bend + off + phase)) ** power * strength
                * np.clip(.55 + .8 * np.sin(z * 2.4 + th * k * .0 + off * 3 + np.sin(th * 4) * 2), 0, 1))[..., None]
        col = col * (1 - dark) + rgb((32, 17, 13)) * dark
    sheen = np.exp(-((z - Z(30) - .08 * np.cos(th * 8)) / .17) ** 2)[..., None]
    return col + sheen * np.array((.07, .045, .035), np.float32)

def paste_art(col, th, x, z, lo=.5):
    """正面把原畫的頭髮筆觸貼上去（上衣、皮膚、背景不用）。"""
    nx, ny = neutral_px(x, z)
    s = sample(NEU, nx, ny)
    r, g = s[..., 0], s[..., 1]
    hair = (s[..., 3] > .95) & (r < .5) & (g < .32) & (ny < 415) & ~((np.abs(nx - 246) < 88) & (ny > 312))
    a = (np.clip((np.cos(th) - lo) / .3, 0, 1) * hair)[..., None]
    return col * (1 - a) + s[..., :3] * a

SCALP = rows([(108, 48, 128, 84), (100, 54, 142, 74), (90, 65, 165, 65), (80, 66, 178, 61), (70, 62.5, 187, 61), (60, 61.5, 190, 62),
              (50, 59, 190, 65), (40, 55, 185, 70), (30, 49.5, 177, 76), (20, 40, 165, 86), (13.5, 26, 148, 100), (10, 2, 125, 118)])
# 臉的開口（原畫座標）：中分、兩側往下露出耳朵
FRONT_WIN = [(213, 104), (232, 101), (247, 106), (262, 101), (282, 104), (300, 125), (318, 155), (336, 178), (348, 196), (356, 214), (370, 234),
             (352, 246), (338, 254), (322, 268), (300, 282), (246, 292), (192, 282), (170, 268), (154, 254), (140, 246), (122, 234), (136, 214),
             (144, 196), (156, 178), (174, 155), (192, 125)]
SIDE_WIN = [(215, 50), (172, 55), (166, 64), (148, 67), (140, 78), (132, 86), (112, 81), (101, 88), (102, 99), (116, 105), (130, 110), (215, 114)]

def scalp_texture(W=1024, H=768):
    R = smooth_rows(SCALP)
    U, V = np.meshgrid((np.arange(W) + .5) / W, 1 - (np.arange(H) + .5) / H)
    th = (U - .5) * 2 * math.pi
    x, y, z = surf(R, th, V, 2.25, bump=waves(.022))
    col = paste_art(hair_color(th, z), th, x, z, .55)
    nx, ny = neutral_px(x, z)
    win = (y < -.45) & in_poly(nx, ny, FRONT_WIN)
    win |= (y < .52) & (y > -1.35) & (np.abs(x) > 1.05) & in_poly(120 - PX * y, 120 - PX * (z - 3), SIDE_WIN)
    win |= (z < Z(99)) & (y < -.3) & (np.abs(x) < 1.1)
    pad = np.pad(win, ((0, 0), (5, 5)), mode='wrap')
    line = dilate(pad, 3)[:, 5:-5] & ~win
    col[line] = (.09, .045, .03)
    return np.dstack([np.clip(col, 0, 1), (~win).astype(np.float32)])

_, SR = loft('hair', SCALP, tex_mat('hair', scalp_texture(), clip=True), 96, 56, 2.25, bump=waves(.022), uv=True, caps=False)

MASS = rows([(156, 56, 122, 80), (150, 70, 132, 62), (140, 81, 138, 53), (127, 88, 135, 49), (116, 83, 126, 52), (105, 73, 110, 53),
             (94, 74.5, 100, 54), (82, 69, 99, 58), (68, 56, 100, 68)])

def mass_texture(R_, bump, front_lo, phase, hem=None, cx=0.0, W=1024, H=768, power=2.3):
    R = smooth_rows(R_)
    U, V = np.meshgrid((np.arange(W) + .5) / W, 1 - (np.arange(H) + .5) / H)
    th = (U - .5) * 2 * math.pi
    x, y, z = surf(R, th, V, power, cx, bump)
    col = hair_color(th, z, phase)
    col = paste_art(col, th, x, z, front_lo)
    a = np.ones((H, W), np.float32)
    if hem is not None:
        win = z < hem(th, x)
        line = dilate(win, 4) & ~win
        col[line] = (.09, .045, .03)
        a = (~win).astype(np.float32)
    return np.dstack([np.clip(col, 0, 1), a])

hem = lambda th, x: Z(149) - .20 * np.abs(np.sin(th * 5.5)) ** .6 - .06 * np.sin(th * 13)
loft('hairback', MASS, tex_mat('hair_back', mass_texture(MASS, waves(.055), .8, 1.3, hem), clip=True), 96, 56, 2.3, bump=waves(.055), uv=True, caps=False)

# 肩前兩大束
for s in (-1, 1):
    LOCK = rows([(159, 3, 150, 140), (151, 15, 162, 129), (139, 25, 170, 121), (126, 27, 167, 117), (115, 21, 155, 116), (108, 14, 146, 117), (100, 3, 134, 122)])
    cx = s * 46 / PX
    lock, _ = loft('lock', LOCK, tex_mat('hair_lock%d' % (s > 0), mass_texture(LOCK, waves(.085), .35, s * 2.0, cx=cx, W=512, H=512, power=2.1), clip=False),
                   48, 40, 2.1, cx=cx, bump=waves(.085), uv=True)
    for v in lock.data.vertices:                                    # 上端靠臉側收進耳下，下端往外撇
        row = 120 - (v.co.z - 3) * PX
        v.co.x += s * float(np.interp(row, (100, 110, 124, 140, 159), (3, -1, -1, 6, 3))) / PX

for s in (-1, 1):                                                    # 兩鬢往耳後撥的髮束
    tube('strand', [P(s * 40, 163, 48), P(s * 47, 150, 65), P(s * 51, 135, 80), P(s * 54, 119, 81), P(s * 57, 100, 86)],
         [.05, .18, .24, .17, .05], HAIRM, 28, 14, .55)

# 耳朵
for s in (-1, 1):
    ball('ear', (s * 1.17, .13, Z(91)), (.22, .22, .27), SKIN, 22, 14, rz=s * .6)
    ball('earin', (s * 1.34, .04, Z(91.5)), (.07, .12, .15), PINK, 14, 10, rz=s * .6)['noline'] = True

# ───────── 身體：上衣正面直接貼原畫 ─────────
loft('neck', rows([(115, 9, 142, 118), (108, 8.5, 143, 117), (102, 9.5, 144, 115)]), SKIN, 24, 8, 2)
TORSO = rows([(167, 25.5, 147, 107), (158, 23.5, 148.5, 107), (147, 20.5, 148.5, 109), (135, 20, 149, 110), (124, 21.5, 147, 110), (117, 20, 143, 112),
              (112, 15, 139, 114), (108, 8, 136, 116)])

def torso_texture(W=1024, H=768):
    R = smooth_rows(TORSO)
    U, V = np.meshgrid((np.arange(W) + .5) / W, 1 - (np.arange(H) + .5) / H)
    th = (U - .5) * 2 * math.pi
    x, y, z = surf(R, th, V, 2.5)
    v = 120 - (z - 3) * PX; px_ = x * PX
    col = np.ones((H, W, 3), np.float32) * rgb((68, 42, 34))
    col += ((np.random.default_rng(5).random((H, W)) - .5) * .03)[..., None]
    col[v > 155] = rgb((216, 224, 250))
    col[v > 164] = rgb((96, 126, 164))
    nx, ny = neutral_px(x, z)
    s = sample(NEU, nx, ny)
    ok = (s[..., 3] > .9) & (np.cos(th) > .35) & (np.abs(nx - 246) < 74) & (ny > 282) & (ny < 475)
    a = (np.clip((np.cos(th) - .35) / .2, 0, 1) * ok)[..., None]
    col = col * (1 - a) + s[..., :3] * a
    neck = (np.cos(th) > .6) & (np.abs(px_) < 8) & (v < 114)
    col[neck] = rgb(SKIN_RGB) * .97
    back = np.cos(th) < -.4
    col[back & (np.abs(v - 154.6) < .6)] = (.62, .66, .80)
    return np.dstack([np.clip(col, 0, 1), np.ones((H, W), np.float32)])

_, TR = loft('torso', TORSO, tex_mat('outfit', torso_texture()), 56, 36, 2.5, uv=True, caps=False)

def front_y(x, z, off=.012):
    w = np.interp(z, TR[:, 0], TR[:, 1]); yf = np.interp(z, TR[:, 0], TR[:, 2]); yb = np.interp(z, TR[:, 0], TR[:, 3])
    q = max(0.0, 1 - min(1.0, abs(x) / w) ** 2.5) ** (1 / 2.5)
    return float((yf + yb) / 2 - (yb - yf) / 2 * q - off)

for s in (-1, 1):
    pts = [(s * x / PX, front_y(s * x / PX, Z(v), .05), Z(v)) for x, v in ((8, 111), (12, 114), (16.5, 120.5), (15, 124), (10.5, 119))]
    tube('collar', pts, [.04, .075, .075, .03, .012], SHIRT, 20, 10, .45)
for k in range(7):                                                   # 珍珠項鍊
    q = (k - 3) / 3
    xx = q * 9.5 / PX; v = 118.5 - 4.6 * q * q
    ball('pearl', (xx, front_y(xx, Z(v), .055), Z(v)), (.045, .04, .045), PEARL, 10, 8)
ball('jbtn', (0, front_y(0, Z(153.5), .03), Z(153.5)), (.048, .03, .048), METAL, 12, 8)

# 手臂：棕色外套袖＋淺藍袖口
for s in (-1, 1):
    tube('sleeve', [P(s * 17, 125, 116), P(s * 28, 126, 126), P(s * 38, 124, 139), P(s * 45, 121, 150)], [.14, .24, .27, .27], JACKET, 24, 20)
    tube('cuff', [P(s * 44, 121.5, 148.5), P(s * 48, 120, 155)], [.27, .245], SHIRT, 6, 20)
    ball('hand', P(s * 50, 119.5, 161.5), (.21, .23, .23), SKIN, 22, 16)
    ball('thumb', P(s * 45, 126.5, 161), (.085, .095, .125), SKIN, 14, 10, ry=-s * .45)

# ───────── 寬牛仔褲（刷色）與豹紋鞋 ─────────
def denim_texture(W=512, H=512, washed=True):
    r_ = np.random.default_rng(11)
    U, V = (np.arange(W) + .5) / W, (np.arange(H) + .5) / H
    th = (U - .5) * 2 * math.pi
    col = np.ones((H, W, 3), np.float32) * rgb((82, 110, 148))
    wash = np.exp(-((th[None, :] / .75) ** 2) - (((1 - V[:, None]) - .38) / .24) ** 2)
    col += (rgb((152, 172, 194)) - rgb((82, 110, 148))) * wash[..., None] * (1 if washed else 0)
    col += ((r_.random((H, W)) - .5) * .08)[..., None]
    for a in (-math.pi / 2, math.pi / 2):
        col[:, np.abs(th - a) < .016] = (.64, .62, .55)
    return np.dstack([np.clip(col, 0, 1), np.ones((H, W), np.float32)])
DENIM = tex_mat('jeans_tex', denim_texture())
DENIMTOP = tex_mat('jeans_top', denim_texture(washed=False))
loft('hips', rows([(176, 10, 143, 112), (169, 23, 148, 106.5), (160, 22.5, 146.5, 108)]), DENIMTOP, 40, 6, 2.6, uv=True)
r_ = np.random.default_rng(23)
for s in (-1, 1):
    loft('pant', [(Z(219), .55, Y(139), Y(99)), (Z(213), .64, Y(148), Y(97)), (Z(205), .55, Y(150), Y(100)), (Z(197), .60, Y(151), Y(102)),
                  (Z(186), .50, Y(149), Y(105)), (Z(173), .42, Y(148), Y(107)), (Z(160), .35, Y(145), Y(109))], DENIM, 44, 28, 2.4, cx=s * .57, uv=True)
    tube('fold', [P(s * 36, 142, 195), P(s * 25, 153, 202), P(s * 10, 148, 209)], [.008, .036, .006], JEAN2, 20, 8, line=True)
    tube('fold', [P(s * 7, 147, 182), P(s * 15, 150.5, 190), P(s * 24, 151, 192)], [.006, .028, .004], JEAN2, 16, 8, line=True)
    tube('fold', [P(s * 40, 143, 207), P(s * 30, 152, 212.5), P(s * 16, 150, 214)], [.006, .032, .006], JEAN2, 18, 8, line=True)
    tube('fold', [P(s * 5, 147, 168), P(s * 11, 150, 175), P(s * 21, 150, 176)], [.006, .022, .004], JEAN2, 14, 8, line=True)
    tube('foldlight', [P(s * 33, 145, 203), P(s * 22, 154, 208), P(s * 12, 150, 202)], [.006, .026, .004], JEAN3, 16, 8, line=True)
    ring = [(s * .57 + .625 * math.sin(a), Y(122) - .70 * math.cos(a), Z(214.5) + .05 * math.cos(a)) for a in np.linspace(0, math.tau, 25)]
    tube('hemline', ring, [.014, .014], STITCH, 72, 6, line=True)
    tube('backpocket', [P(s * x, 106.8, v) for x, v in ((6, 164), (7, 172), (14, 176), (22, 172), (23, 163))], [.011, .011], STITCH, 24, 6, line=True)
    before = set(scene.collection.objects)
    shoe(s, SHOE, SOLE, LACE, cx=.58, turn=10)
    new = set(scene.collection.objects) - before
    for o in list(new):
        if o.name.split('.')[0] in ('lace', 'toecap'):
            new.discard(o); bpy.data.objects.remove(o)
    for o in new:
        for v in o.data.vertices:
            v.co.z *= .80; v.co.y *= 1.14
    upper = next(o for o in new if o.name.split('.')[0] == 'shoe')
    cand = [v for v in upper.data.vertices if v.co.z < .46]
    for v in [cand[i] for i in r_.choice(len(cand), 34, replace=False)]:      # 豹紋斑點
        n = v.normal
        ball('spot', tuple(v.co + n * .006), (.06, .06, .035), SPOT, 8, 6, rz=float(r_.random() * 3))['noline'] = True
    bx = s * .61
    ball('shoewhite', (bx, -1.00, .50), (.24, .20, .075), WHITE, 18, 10)
    tube('shoestrap', [(bx - .36, -.76, .43), (bx - .18, -.84, .60), (bx + .18, -.84, .60), (bx + .36, -.76, .43)], [.045, .055, .055, .045], SOLE, 20, 8, .6)
    ball('shoebuckle', (bx + s * .30, -.84, .51), (.065, .05, .065), GOLD, 10, 8)

finish('Amber',
       heads={'head', 'hair', 'hairback', 'lock', 'strand', 'ear', 'earin'},
       legs={'sole', 'shoe', 'tongue', 'soleline', 'pant', 'fold', 'foldlight', 'hemline', 'backpocket', 'spot', 'shoewhite', 'shoestrap', 'shoebuckle'},
       arms={'sleeve', 'cuff', 'hand', 'thumb'})

# Leona 立體人物（黑長直髮齊瀏海＋公主頭、淺黃針織外套、灰背心、抱布丁狗、寬牛仔褲、橄欖綠蝴蝶結鞋）。
# 做法同 Machi：逐段放樣＋原畫貼圖。尺寸照已發布造型的 12 角度圖量；臉和瀏海取自 expedition/story/Leona_neutral.webp。
# 執行：Blender --background --factory-startup --python models/people/leona.py -- [預覽圖資料夾]
import os, sys
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from kit import *

NEU = load(os.path.join(ROOT, 'expedition/story/Leona_neutral.webp'))

def neutral_px(x, z):
    """模型座標 → 高解析正面圖像素（雙眼中心對位）。"""
    u = 120 + x * PX; v = 120 - (z - 3) * PX
    return 228 + (u - 120) * 2.857, 230 + (v - 80.5) * 2.857

def rows(table): return [(Z(v), w / PX, Y(f), Y(b)) for v, w, f, b in table]
def P(x, u, v): return (x / PX, Y(u), Z(v))          # 正面圖橫向偏移、側面圖欄、列

SKIN_RGB = (253, 199, 165)
HAIR_RGB = (48, 35, 33)
SKIN = mat('skin', SKIN_RGB, 1)
PINK = mat('skin_pink', (243, 150, 122), .85)
HAIRM = mat('hair_flat', HAIR_RGB, .85)
HLINE = mat('hair_line', (20, 12, 10), .9)
KNIT = mat('knit', (250, 222, 150), .8)
TRIM = mat('knit_trim', (255, 240, 198), .85)
KLINE = mat('knit_line', (196, 160, 96), .9)
JEAN = mat('jeans', (72, 108, 158), .75)
JEAN2 = mat('jeans_fold', (52, 80, 122), .8)
STITCH = mat('jeans_stitch', (178, 158, 120), .85)
METAL = mat('button', (172, 156, 130), .8)
PUD = mat('pudding', (255, 229, 142), .85)
PUDL = mat('pudding_line', (196, 148, 66), .9)
BERET = mat('beret', (128, 68, 36), .8)
INK = mat('ink', (38, 24, 18), .9)
SHOE = mat('shoe', (112, 118, 58), .75)
SOLE = mat('sole', (246, 238, 222), .8)
LACE = mat('lace', (232, 224, 204), .75)
BOW = mat('bow', (150, 172, 96), .8)
BOWL = mat('bow_line', (86, 100, 48), .9)

# ───────── 臉：原畫正面直接貼 ─────────
FACE_ROWS = rows([(106, 3, 138, 112), (104.5, 13, 152, 100), (101, 23, 159, 90), (96, 30, 163, 84), (90, 33.5, 165, 80),
                  (80, 34.5, 163.5, 78), (70, 34, 163, 78), (60, 32, 161, 80), (50, 27, 154, 86), (42, 3, 125, 115)])
FACE_ART = [(136, 194), (322, 194), (324, 236), (314, 264), (290, 285), (256, 297), (228, 300), (198, 297), (166, 285), (142, 264), (133, 236)]

def face_texture(W=1024, H=768):
    R = smooth_rows(FACE_ROWS)
    U, V = np.meshgrid((np.arange(W) + .5) / W, 1 - (np.arange(H) + .5) / H)
    th = (U - .5) * 2 * math.pi
    x, y, z = surf(R, th, V, 2.35)
    col = np.ones((H, W, 3), np.float32) * (np.array(SKIN_RGB, np.float32) / 255)
    front = np.cos(th) > .2
    nx, ny = neutral_px(x, z)
    s = sample(NEU, nx, ny)
    # 原畫：臉框內、不是瀏海深色的皮膚與五官
    inside = in_poly(nx, ny, FACE_ART) & front & (s[..., 3] > .9)
    eyes = (((nx - 170) / 42) ** 2 + ((ny - 229) / 38) ** 2 < 1) | (((nx - 286) / 42) ** 2 + ((ny - 229) / 38) ** 2 < 1)
    mouth = (np.abs(nx - 228) < 26) & (ny > 262) & (ny < 284)
    dark = s[..., :3].sum(-1) < 1.15
    use = (inside & (~dark | eyes | mouth)) | (eyes & front)
    a = use.astype(np.float32)
    for cx in (151, 305):                                            # 腮紅補足
        b = np.exp(-(((nx - cx) / 17) ** 2 + ((ny - 266) / 11) ** 2) ** 1.5) * .3 * front * (1 - a)
        col = col * (1 - b[..., None]) + np.array((246, 128, 112), np.float32) / 255 * b[..., None]
    col = col * (1 - a[..., None]) + s[..., :3] * a[..., None]
    for cx in (170, 286):                                            # 整顆頭加寬時，眼睛本身不跟著變胖
        ex = cx + (nx - cx) * 1.06
        w_ = np.clip((1 - np.sqrt(((nx - cx) / 40) ** 2 + ((ny - 229) / 36) ** 2)) / .08, 0, 1) * front
        e_ = sample(NEU, ex, ny)[..., :3]
        hair_ = (ex < 133.5) | (ex > 322)                            # 睫毛外側是原畫的頭髮，那裡鋪回膚色
        e_ = np.where(hair_[..., None], np.array(SKIN_RGB, np.float32) / 255, e_)
        w_ = np.maximum(w_, (hair_ & (np.abs(ny - 229) < 38) & ((nx < 150) | (nx > 306)) & front).astype(np.float32))
        w_ = w_ * ((nx < 228) == (cx < 228))
        col = col * (1 - w_[..., None]) + e_ * w_[..., None]
    edge = np.clip((np.abs(th) - .8) / .9, 0, 1) * .3 + np.clip((Z(101) - z) / .2, 0, 1) * .3
    edge = np.clip(edge, 0, .4)[..., None] * (1 - a[..., None])
    col = col * (1 - edge) + np.array((238, 140, 104), np.float32) / 255 * edge
    return np.dstack([col, np.ones((H, W), np.float32)])

loft('head', FACE_ROWS, tex_mat('face', face_texture()), 72, 48, 2.35, uv=True)

# ───────── 頭頂與瀏海 ─────────
# 後腦往後鼓一點（第四欄愈小愈後面），側面才不會扁
SCALP = rows([(108, 44, 128, 66), (100, 48, 146, 59), (90, 49.5, 160, 57), (80, 50, 168, 57), (70, 50, 173, 57.5), (60, 52, 176, 58),
              (50, 50.5, 176, 61), (40, 47, 172, 68), (30, 41.5, 165, 77), (20, 33, 154, 90), (13.5, 21, 141, 105), (10.5, 2, 125, 118)])
# 臉的開口（原畫座標）：齊瀏海下緣含三道髮縫
FRONT_WIN = [(134, 196), (141, 188), (154, 186), (166, 189), (170, 170), (173, 148), (177, 176), (182, 189), (196, 186), (207, 189),
             (210, 168), (212, 146), (217, 178), (222, 189), (240, 187), (256, 189), (268, 180), (274, 150), (278, 180), (284, 188),
             (298, 186), (312, 189), (321, 196), (325, 236), (316, 268), (292, 290), (258, 303), (228, 306), (196, 303), (164, 290),
             (140, 268), (130, 236)]
SIDE_WIN = [(200, 66), (162, 67), (148, 70), (138, 80), (134, 92), (136, 102), (140, 112), (200, 112)]

def hair_color(th, z, x):
    """黑長髮底色＋髮絲線＋頭頂光澤。"""
    base = np.array(HAIR_RGB, np.float32) / 255
    col = np.ones(th.shape + (3,), np.float32) * base
    wave = th * 13 + np.sin(z * 2.3 + th * 2) * .7
    dark = (np.maximum(0, np.cos(wave)) ** 24)[..., None]
    soft = (np.maximum(0, np.cos(wave * .5 + 1.2)) ** 6)[..., None]
    col = col * (1 + .16 * soft) * (1 - dark) + np.array((22, 14, 12), np.float32) / 255 * dark
    sheen = np.exp(-((z - Z(31) - .07 * np.cos(th * 9)) / .17) ** 2)[..., None]
    return col + sheen * np.array((.10, .075, .065), np.float32)

def scalp_texture(W=1024, H=768):
    R = smooth_rows(SCALP)
    U, V = np.meshgrid((np.arange(W) + .5) / W, 1 - (np.arange(H) + .5) / H)
    th = (U - .5) * 2 * math.pi
    x, y, z = surf(R, th, V, 2.25)
    col = hair_color(th, z, x)
    nx, ny = neutral_px(x, z)
    s = sample(NEU, nx, ny)
    art = (s[..., 3] > .95) & (s[..., :3].sum(-1) < 1.15) & (ny > 40) & (ny < 300)
    a = (np.clip((np.cos(th) - .55) / .3, 0, 1) * art)[..., None]
    col = col * (1 - a) + s[..., :3] * a
    win = (y < -.45) & in_poly(nx, ny, FRONT_WIN)
    win |= (y < -.15) & (np.abs(x) > .65) & in_poly(120 - PX * y, 120 - PX * (z - 3), SIDE_WIN)
    win |= (z < Z(97)) & (y < -.2) & (np.abs(x) < .95)
    pad = np.pad(win, ((0, 0), (5, 5)), mode='wrap')
    line = dilate(pad, 3)[:, 5:-5] & ~win
    col[line] = (.07, .04, .03)
    return np.dstack([np.clip(col, 0, 1), (~win).astype(np.float32)])

_, SR = loft('hair', SCALP, tex_mat('hair', scalp_texture(), clip=True), 96, 56, 2.25, uv=True, caps=False)

# ───────── 背後長髮 ─────────
CURTAIN = rows([(163, 55, 122, 70), (156, 63, 126, 61), (148, 67, 128, 54), (140, 68, 128, 53), (130, 66, 128, 55), (120, 62.5, 128, 57),
                (110, 58, 128, 59), (100, 54, 127, 59), (90, 49, 124, 61), (78, 43, 118, 66)])

def curtain_texture(W=1024, H=768):
    R = smooth_rows(CURTAIN)
    U, V = np.meshgrid((np.arange(W) + .5) / W, 1 - (np.arange(H) + .5) / H)
    th = (U - .5) * 2 * math.pi
    x, y, z = surf(R, th, V, 2.3)
    col = hair_color(th, z, x)
    lobe = np.abs(np.sin(th * 6.5))
    hem = Z(152) - .27 * np.clip((np.abs(x) - .6) / .8, 0, 1) - .24 * lobe ** .55 + .14
    win = z < hem
    line = dilate(win, 4) & ~win
    col[line] = (.07, .04, .03)
    return np.dstack([np.clip(col, 0, 1), (~win).astype(np.float32)])

loft('hairback', CURTAIN, tex_mat('hair_back', curtain_texture(), clip=True), 96, 48, 2.3, uv=True, caps=False)

# 肩前的兩束髮
for s in (-1, 1):
    tube('lock', [P(s * 42, 127, 66), P(s * 43, 132, 88), P(s * 42, 137, 106), P(s * 37, 138, 118), P(s * 32, 137, 127)], [.05, .12, .17, .12, .012], HAIRM, 26, 14, .55)

def hair_pt(th, v, out=.03):
    t = np.interp(Z(v), SR[:, 0], np.linspace(0, 1, len(SR)))
    x, y, z = surf(SR, np.array(th), np.array(t), 2.25)
    x, y, z = float(x), float(y), float(z)
    cy = float(np.interp(z, SR[:, 0], (SR[:, 2] + SR[:, 3]) / 2))
    d = Vector((x, y - cy, 0)).normalized()
    return (x + d.x * out, y + d.y * out, z)

# 公主頭：兩側往後收的髮辮（一節一節）＋中央髮束
BRAID = ((88, 40), (104, 49), (124, 56), (146, 61), (168, 61), (180, 59))
for s in (-1, 1):
    for dv, r, out in ((0, .13, .035), (-9, .075, .01)):
        pts = [hair_pt(s * math.radians(a), v + dv, out) for a, v in BRAID]
        radii = [.012] + [r * (1.0 if k % 2 else .62) for k in range(11)] + [r * .5]
        tube('braid', pts, radii, HAIRM, 64, 14, .62)
tube('tail', [hair_pt(math.pi, 54, .0), hair_pt(math.pi, 64, .07), (0, Y(61), Z(86)), (0, Y(57), Z(116)), (0, Y(54), Z(138))],
     [.09, .17, .23, .24, .02], HAIRM, 36, 16, .45)

# 耳朵：照原畫只在鬢髮和後面長髮之間露出一小片
for s in (-1, 1):
    ball('ear', (s * 1.23, -.02, Z(84)), (.19, .20, .27), SKIN, 22, 14, rz=s * .5)
    ball('earin', (s * 1.38, -.10, Z(85)), (.05, .11, .165), PINK, 14, 10, rz=s * .5)['noline'] = True
    tube('tail', [(s * u / PX, Y(d), Z(v)) for u, d, v in ((42, 108, 55), (49, 104, 70), (50, 103, 86), (50.5, 103, 104), (52, 102, 124))],
         [.04, .17, .21, .21, .05], HAIRM, 30, 14, .8)

# ───────── 身體：針織外套＋灰背心＋褲頭 ─────────
loft('neck', rows([(114, 8, 141, 118), (106, 7.5, 142, 117), (99, 8.5, 143, 115)]), SKIN, 24, 8, 2)
TORSO = rows([(160, 24, 147, 107), (150, 21.5, 147, 108), (138, 19.5, 147, 110), (128, 20, 146, 110), (119, 21.5, 143, 112), (112, 17, 139, 114), (108, 8, 135, 117)])

def torso_texture(W=768, H=640):
    R = smooth_rows(TORSO)
    U, V = np.meshgrid((np.arange(W) + .5) / W, 1 - (np.arange(H) + .5) / H)
    th = (U - .5) * 2 * math.pi
    x, y, z = surf(R, th, V, 2.5)
    nx, ny = neutral_px(x, z)
    v = 120 - (z - 3) * PX; px_ = x * PX
    front = np.cos(th) > .2
    rng = np.random.default_rng(3)
    knit = np.array((252, 229, 164), np.float32) / 255
    blot = rng.random((H // 8, W // 8)).repeat(8, 0).repeat(8, 1)
    col = np.ones((H, W, 3), np.float32) * knit
    col[blot > .70] = (1.0, .96, .82)
    col[blot < .2] = (.94, .80, .50)
    half = 11.5 + np.clip((v - 118) / 30, 0, 1) * 2.5
    opening = front & (np.abs(px_) < half)
    cami = np.array((186, 176, 168), np.float32) / 255
    rib = 1 - .09 * (np.maximum(0, np.cos(px_ * 2.4)) ** 8)
    top = 120.5 + 1.3 * np.abs(np.sin(px_ * .8))
    col[opening] = cami * rib[opening][:, None]
    col[opening & (v < top + 2.2)] = (.97, .94, .89)
    col[opening & (v < top)] = np.array(SKIN_RGB, np.float32) / 255 * .98
    strap = front & (np.abs(np.abs(px_) - 8.5) < 1.1) & (v < 123)
    col[strap] = (.84, .80, .76)
    jean = np.array((72, 108, 158), np.float32) / 255
    waist = (v > 139) & (opening | (v > 156))
    col[waist] = jean
    col[waist & (np.abs(v - 142.5) < .5)] = (.27, .40, .58)
    col[opening & (np.abs(v - 139.4) < .6)] = (.22, .33, .50)
    return np.dstack([np.clip(col, 0, 1), np.ones((H, W), np.float32)])

_, TR = loft('torso', TORSO, tex_mat('cardigan', torso_texture()), 56, 32, 2.5, uv=True, caps=False)

def front_y(x, z, off=.012):
    w = np.interp(z, TR[:, 0], TR[:, 1]); yf = np.interp(z, TR[:, 0], TR[:, 2]); yb = np.interp(z, TR[:, 0], TR[:, 3])
    q = max(0.0, 1 - min(1.0, abs(x) / w) ** 2.5) ** (1 / 2.5)
    return float((yf + yb) / 2 - (yb - yf) / 2 * q - off)

def around(v, off=.02, n=33):
    z = Z(v); w = float(np.interp(z, TR[:, 0], TR[:, 1])); yf = float(np.interp(z, TR[:, 0], TR[:, 2])); yb = float(np.interp(z, TR[:, 0], TR[:, 3]))
    out = []
    for a in np.linspace(.62, math.tau - .62, n):
        s, c = math.sin(a), math.cos(a)
        out.append(((w + off) * math.copysign(abs(s) ** .8, s), (yf + yb) / 2 - ((yb - yf) / 2 + off) * math.copysign(abs(c) ** .8, c), z))
    return out

# 外套下襬荷葉邊、門襟滾邊、鈕扣
for i, p in enumerate(around(155, .05, 30)):
    ball('hem', p, (.12, .085, .09), TRIM, 10, 8)
for s in (-1, 1):
    pts = [(s * x / PX, front_y(s * x / PX, Z(v), .035), Z(v)) for x, v in ((8.5, 113), (12, 121), (12.8, 132), (13.5, 143), (14.5, 154))]
    tube('placket', pts, [.04, .065, .065, .065, .05], TRIM, 28, 10, .55)
    tube('placketline', [(x + s * .085, front_y(x + s * .085, z, .04), z) for x, y, z in pts], [.006, .012, .006], KLINE, 24, 6, line=True)
for v in (126, 136, 146):
    ball('button', (15.4 / PX, front_y(15.4 / PX, Z(v), .05), Z(v)), (.045, .03, .045), METAL, 10, 8)['noline'] = True
ball('jbtn', (0, front_y(0, Z(142.5), .035), Z(142.5)), (.065, .035, .065), METAL, 12, 8)
tube('fly', [(.02, front_y(0, Z(v), .02), Z(v)) for v in (146, 153, 159)], [.012, .012], STITCH, 12, 6, line=True)

# 左手（角色左側）自然下垂
tube('sleeve', [P(17, 126, 112), P(25, 129, 124), P(31, 133, 138), P(36, 136, 150)], [.14, .24, .28, .27], KNIT, 24, 20)
for k in range(10):
    a = k / 10 * math.tau
    c = Vector(P(36.5, 136.5, 151.5))
    ball('wrist', tuple(c + Vector((math.cos(a) * .2, math.sin(a) * .2, -math.cos(a) * .07))), (.1, .1, .085), TRIM, 10, 8)
ball('hand', P(39, 138, 160), (.2, .21, .23), SKIN, 22, 16)
ball('thumb', P(34, 145, 159), (.08, .09, .12), SKIN, 14, 10, ry=-.45)

# 右手抱著布丁狗（固定在身上，走路時不甩動）
tube('holdsleeve', [P(-17, 126, 113), P(-28, 126, 129), P(-33, 131, 144), P(-31, 160, 147), P(-26, 171, 143.5)],
     [.14, .24, .27, .24, .21], KNIT, 32, 18)
# 布丁狗、抱住牠的手和袖口：輪廓與五官直接用原畫做成鼓起的立體片
def zp(pts): return [(x / 5 + 30, y / 5 + 300) for x, y in pts]
DOG = zp([(445, 195), (465, 150), (505, 118), (545, 100), (550, 66), (583, 62), (596, 90), (665, 95), (718, 118), (740, 150), (805, 162), (885, 188),
          (942, 232), (972, 292), (962, 342), (922, 368), (870, 372), (856, 428), (905, 482), (952, 550), (956, 612), (922, 646), (888, 645), (908, 700),
          (902, 762), (872, 805), (874, 862), (848, 906), (790, 918), (738, 900), (712, 862), (690, 858), (664, 900), (608, 922), (540, 906), (502, 862),
          (495, 820), (440, 770), (385, 660), (390, 520), (372, 478), (330, 500), (280, 500), (240, 475), (224, 420), (240, 368), (292, 308), (368, 240)])
HAND = zp([(512, 598), (528, 550), (582, 512), (652, 498), (704, 516), (712, 546), (748, 572), (760, 628), (748, 668), (718, 718), (682, 748),
           (620, 755), (558, 742), (516, 702), (504, 648)])
CUFF = zp([(318, 640), (338, 558), (392, 515), (462, 506), (540, 516), (562, 540), (522, 575), (510, 640), (516, 700), (538, 742), (500, 778),
           (430, 780), (368, 752), (330, 708)])
dogart = NEU.copy()                                                  # 狗身上被手擋住的地方補回布丁黃，側面才不會看到第二隻手
gx_, gy_ = np.meshgrid(np.arange(NEU.shape[1]) + .5, np.arange(NEU.shape[0]) + .5)
for poly in (HAND, CUFF):
    c_ = np.mean(poly, axis=0)
    big = [tuple(c_ + (np.array(p) - c_) * 1.16) for p in poly]
    cover = in_poly(gx_, gy_, big) & in_poly(gx_, gy_, DOG)
    dogart[cover, :3] = np.array((253, 230, 142), np.float32) / 255
art_puff('pud', dogart, neutral_px, DOG, Y(150), .68, (253, 230, 142), round_px=46, plump=True, back_k=.66, inset=7, line=True, nx_=64, nz=76)
art_puff('holdcuff', NEU, neutral_px, CUFF, Y(172), .22, (240, 218, 160), yaw=-.12, round_px=16)
art_puff('holdhand', NEU, neutral_px, HAND, Y(177), .17, SKIN_RGB, round_px=16)

# ───────── 寬牛仔褲與鞋 ─────────
def denim_texture(W=512, H=512):
    rng = np.random.default_rng(7)
    col = np.ones((H, W, 3), np.float32) * (np.array((72, 108, 158), np.float32) / 255)
    col += ((rng.random((H, W)) - .5) * .09)[..., None]
    U = (np.arange(W) + .5) / W
    th = (U - .5) * 2 * math.pi
    col *= (1 + .09 * np.exp(-(th / .8) ** 2))[None, :, None]
    for a in (-math.pi / 2, math.pi / 2):                            # 褲管側縫
        col[:, np.abs(th - a) < .014] = (.46, .50, .55)
    return np.dstack([np.clip(col, 0, 1), np.ones((H, W), np.float32)])
DENIM = tex_mat('jeans_tex', denim_texture())
loft('hips', rows([(172, 10, 143, 112), (165, 23, 148.5, 106.5), (153, 22, 146, 108.5)]), DENIM, 40, 6, 2.6, uv=True)
for s in (-1, 1):
    loft('pant', [(Z(219), .50, Y(138), Y(102)), (Z(213), .58, Y(147), Y(99)), (Z(204), .50, Y(149), Y(103)), (Z(197), .56, Y(151), Y(105)),
                  (Z(186), .45, Y(148), Y(108)), (Z(172), .39, Y(148), Y(108)), (Z(160), .35, Y(146), Y(109))], DENIM, 44, 28, 2.4, cx=s * .55, uv=True)
    tube('fold', [P(s * 34, 142, 196), P(s * 24, 152, 201), P(s * 11, 149, 208)], [.008, .034, .006], JEAN2, 20, 8, line=True)
    tube('fold', [P(s * 8, 146, 191), P(s * 15, 150.5, 196), P(s * 22, 151, 197)], [.006, .026, .004], JEAN2, 16, 8, line=True)
    tube('backpocket', [P(s * x, 107.2, v) for x, v in ((5, 158), (6, 167), (13, 170), (20, 167), (21, 158))],
         [.011, .011], STITCH, 24, 6, line=True)
    before = set(scene.collection.objects)
    shoe(s, SHOE, SOLE, LACE, cx=.56, turn=8)
    for o in set(scene.collection.objects) - before:
        for v in o.data.vertices:
            v.co.z *= .82; v.co.y *= 1.13
    bx, by, bz = s * .62, -1.12, .58
    for d in (-1, 1):
        ball('shoebow', (bx + d * .21, by, bz + .02), (.22, .09, .13), BOW, 16, 10, ry=-d * .3)
        tube('shoetail', [(bx + d * .04, by - .04, bz), (bx + d * .17, by - .13, bz - .12), (bx + d * .25, by - .20, bz - .26)],
             [.05, .075, .05], BOW, 12, 8, .45)
        tube('shoebowline', [(bx + d * .06, by - .095, bz + .01), (bx + d * .29, by - .10, bz + .07)], [.012, .006], BOWL, 8, 6, line=True)
    ball('shoeknot', (bx, by - .06, bz + .01), (.085, .08, .09), BOW, 12, 8)

# 臉再寬一些：整顆頭（臉、耳朵、頭髮）橫向加寬，肩膀以下的長髮少撐一點
HEADS = ('head', 'hair', 'hairback', 'lock', 'braid', 'braidline', 'tail', 'ear', 'earin')
for o in scene.collection.objects:
    if o.type != 'MESH' or o.name.split('.')[0] not in HEADS:
        continue
    for v in o.data.vertices:
        v.co.x *= float(np.interp(v.co.z, (Z(140), Z(104), Z(70), Z(20)), (1.02, 1.08, 1.08, 1.045)))

finish('Leona',
       heads={'head', 'hair', 'hairback', 'lock', 'braid', 'braidline', 'tail', 'ear', 'earin'},
       legs={'sole', 'shoe', 'tongue', 'lace', 'toecap', 'soleline', 'pant', 'fold', 'backpocket', 'shoebow', 'shoetail', 'shoebowline', 'shoeknot'},
       arms={'sleeve', 'wrist', 'hand', 'thumb'})

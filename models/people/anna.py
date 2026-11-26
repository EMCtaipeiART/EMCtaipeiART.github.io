# Anna 立體人物（金色長捲髮、兩個黑色蝴蝶結髮夾、紅色一字領上衣、豹紋寬褲、黑色小包、頸鍊、棕色厚底鞋）。
# 做法同 Machi：逐段放樣＋原畫貼圖。尺寸照已發布造型的 12 角度圖量；臉、頭髮正面與上衣取自 expedition/story/Anna_neutral.webp。
# 執行：Blender --background --factory-startup --python models/people/anna.py -- [預覽圖資料夾]
import os, sys
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from kit import *

NEU = load(os.path.join(ROOT, 'expedition/story/Anna_neutral.webp'))

def neutral_px(x, z):
    """模型座標 → 高解析正面圖像素（雙眼中心對位）。"""
    u = 120.5 + x * PX; v = 120 - (z - 3) * PX
    return 205 + (u - 120.5) * 2.43, 206 + (v - 87) * 2.43

def rows(table): return [(Z(v), w / PX, Y(f), Y(b)) for v, w, f, b in table]
def P(x, u, v): return (x / PX, Y(u), Z(v))          # 正面圖橫向偏移、側面圖欄、列
def rgb(c): return np.array(c, np.float32) / 255

SKIN_RGB = (254, 204, 172)
HAIR_RGB = (196, 142, 94)
SKIN = mat('skin', SKIN_RGB, 1)
PINK = mat('skin_pink', (240, 148, 120), .85)
HAIRM = mat('hair_flat', HAIR_RGB, .85)
RED = mat('red', (196, 30, 36), .78)
BLACK = mat('black', (34, 28, 28), .7)
SILVER = mat('silver', (222, 222, 226), .75)
WHITE = mat('charm_white', (250, 246, 244), .85)
ROSE = mat('charm_pink', (244, 130, 180), .85)
INK = mat('ink', (24, 18, 18), .9)
SHOE = mat('shoe', (88, 50, 32), .7)
SOLE = mat('sole', (58, 34, 24), .75)
LACE = mat('lace', (70, 40, 26), .75)

# ───────── 臉：原畫正面直接貼 ─────────
FACE_ROWS = rows([(114, 4, 142, 112), (112, 15, 155, 98), (108, 28, 166, 88), (103, 35, 171, 82), (96, 39.5, 173, 78), (88, 40.5, 171, 76),
                  (78, 40, 171, 76), (66, 38, 169, 78), (54, 33, 164, 82), (44, 21, 150, 90), (40, 3, 125, 115)])
FACE_ART = [(192, 108), (205, 104), (220, 108), (235, 130), (246, 150), (268, 170), (286, 190), (292, 220), (286, 244), (268, 261), (240, 270),
            (205, 273), (170, 270), (142, 261), (125, 244), (119, 220), (125, 190), (142, 172), (164, 150), (177, 130)]

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
    eyes = (((nx - 154) / 35) ** 2 + ((ny - 205) / 29) ** 2 < 1) | (((nx - 256) / 35) ** 2 + ((ny - 205) / 29) ** 2 < 1)
    brows = ((np.abs(nx - 165) < 18) | (np.abs(nx - 247) < 18)) & (ny > 150) & (ny < 167)
    mouth = (np.abs(nx - 205) < 22) & (ny > 233) & (ny < 252)
    skin = (s[..., 0] > .86) & (s[..., 1] > .55)                      # 臉框裡只收皮膚色，蓋到的金髮不收
    a = ((inside & skin) | (inside & (brows | mouth)) | (eyes & front)).astype(np.float32)
    for cx in (143, 267):                                            # 腮紅補足
        b = np.exp(-(((nx - cx) / 17) ** 2 + ((ny - 237) / 11) ** 2) ** 1.5) * .3 * front * (1 - a)
        col = col * (1 - b[..., None]) + rgb((248, 128, 112)) * b[..., None]
    col = col * (1 - a[..., None]) + s[..., :3] * a[..., None]
    edge = np.clip((np.abs(th) - .8) / .9, 0, 1) * .3 + np.clip((Z(109) - z) / .2, 0, 1) * .3
    edge = np.clip(edge, 0, .4)[..., None] * (1 - a[..., None])
    col = col * (1 - edge) + rgb((240, 146, 108)) * edge
    return np.dstack([col, np.ones((H, W), np.float32)])

loft('head', FACE_ROWS, tex_mat('face', face_texture()), 72, 48, 2.35, uv=True)

# ───────── 金色長捲髮 ─────────
def waves(k):
    def f(th, z):
        return k * np.sin(z * 7.6 + np.abs(th) * 3.4) + k * .5 * np.sin(th * 11 + z * 2.5)
    return f

def hair_color(th, z, phase=0.0):
    """上段順直、往下起波浪；th 的倍數用整數，後面接縫才不會斷。"""
    col = np.ones(th.shape + (3,), np.float32) * rgb(HAIR_RGB)
    amp = np.clip((Z(66) - z) / 1.0, 0, 1)
    bend = amp * (2.1 * np.sin(z * 5.2 + 1.4 * np.sin(th * 3 + phase)) + .35 * np.sin(z * 9.5 + th * 5))
    light = np.maximum(0, np.sin(th * 7 + bend * 1.3 + 1.9 + phase)) ** 4
    col = col * (1 - .6 * light[..., None]) + rgb((222, 170, 118)) * .6 * light[..., None]
    for k, off, power, strength in ((9, 0.0, 14, 1.0), (15, 1.7, 30, .85)):
        dark = (np.maximum(0, np.cos(th * k + bend + off + phase)) ** power * strength
                * np.clip(.7 + .7 * np.sin(z * 2.4 + off * 3 + np.sin(th * 4) * 2), 0, 1))[..., None]
        col = col * (1 - dark) + rgb((128, 80, 48)) * dark
    sheen = np.exp(-((z - Z(32) - .08 * np.cos(th * 8)) / .2) ** 2)[..., None]
    return col + sheen * np.array((.09, .08, .06), np.float32)

def paste_art(col, th, x, z, lo=.5):
    """正面把原畫的頭髮筆觸貼上去（上衣、皮膚、蝴蝶結、背景不用）。"""
    nx, ny = neutral_px(x, z)
    s = sample(NEU, nx, ny)
    r, g, b = s[..., 0], s[..., 1], s[..., 2]
    hair = (s[..., 3] > .95) & (r < .93) & (g < .72) & (r - b > .13) & (r > .3) & (ny < 405)
    hair &= ~((np.abs(nx - 205) < 68) & (ny > 285))
    a = (np.clip((np.cos(th) - lo) / .3, 0, 1) * hair)[..., None]
    return col * (1 - a) + s[..., :3] * a

EDGE = (.28, .15, .08)
SCALP = rows([(112, 47, 128, 84), (104, 54, 140, 75), (94, 62.5, 160, 68), (84, 61.5, 172, 65), (72, 61, 180, 64), (60, 59.5, 183, 64),
              (50, 56.5, 182, 66), (40, 53, 178, 70), (30, 47, 172, 77), (20, 37.5, 162, 87), (14, 26, 148, 100), (11, 2, 125, 118)])
FRONT_WIN = [(193, 105), (205, 99), (218, 105), (234, 128), (248, 151), (270, 171), (292, 190), (312, 204), (320, 220), (330, 234), (302, 248),
             (287, 262), (262, 273), (205, 286), (148, 273), (123, 262), (108, 248), (80, 234), (90, 220), (98, 204), (118, 190), (140, 171),
             (162, 151), (176, 128)]
SIDE_WIN = [(215, 48), (172, 54), (166, 64), (150, 69), (141, 80), (133, 89), (123, 86), (109, 87), (107, 102), (120, 109), (132, 116), (215, 120)]

def scalp_texture(W=1024, H=768):
    R = smooth_rows(SCALP)
    U, V = np.meshgrid((np.arange(W) + .5) / W, 1 - (np.arange(H) + .5) / H)
    th = (U - .5) * 2 * math.pi
    x, y, z = surf(R, th, V, 2.25, bump=waves(.018))
    col = paste_art(hair_color(th, z), th, x, z, .55)
    nx, ny = neutral_px(x, z)
    win = (y < -.45) & in_poly(nx, ny, FRONT_WIN)
    win |= (y < .52) & (y > -1.35) & (np.abs(x) > np.interp(z, (Z(82), Z(66)), (.8, 1.36))) & in_poly(120 - PX * y, 120 - PX * (z - 3), SIDE_WIN)
    win |= (z < Z(103)) & (y < -.3) & (np.abs(x) < 1.1)
    pad = np.pad(win, ((0, 0), (5, 5)), mode='wrap')
    line = dilate(pad, 3)[:, 5:-5] & ~win
    col[line] = EDGE
    return np.dstack([np.clip(col, 0, 1), (~win).astype(np.float32)])

_, SR = loft('hair', SCALP, tex_mat('hair', scalp_texture(), clip=True), 96, 56, 2.25, bump=waves(.018), uv=True, caps=False)

MASS = rows([(160, 52, 122, 82), (152, 68, 130, 66), (141, 73, 136, 59), (129, 65, 132, 56), (118, 58, 124, 57), (108, 68, 112, 57),
             (98, 71.5, 104, 60), (86, 65, 100, 61), (72, 55, 100, 65), (58, 42, 100, 74)])

def mass_texture(R_, bump, front_lo, phase, hem=None, cx=0.0, W=1024, H=768, power=2.3):
    R = smooth_rows(R_)
    U, V = np.meshgrid((np.arange(W) + .5) / W, 1 - (np.arange(H) + .5) / H)
    th = (U - .5) * 2 * math.pi
    x, y, z = surf(R, th, V, power, cx, bump)
    col = paste_art(hair_color(th, z, phase), th, x, z, front_lo)
    a = np.ones((H, W), np.float32)
    if hem is not None:
        win = z < hem(th, x)
        line = dilate(win, 4) & ~win
        col[line] = EDGE
        a = (~win).astype(np.float32)
    return np.dstack([np.clip(col, 0, 1), a])

hem = lambda th, x: Z(153) - .22 * np.abs(np.sin(th * 6.5)) ** .6 - .05 * np.sin(th * 15)
loft('hairback', MASS, tex_mat('hair_back', mass_texture(MASS, waves(.055), .8, 0.0, hem), clip=True), 96, 56, 2.3, bump=waves(.055), uv=True, caps=False)

# 肩前兩束
LOCK = rows([(160, 3, 148, 138), (152, 12, 160, 127), (140, 19, 165, 120), (127, 15, 160, 117), (115, 17, 153, 116), (108, 12, 146, 118), (100, 3, 136, 123)])
for s in (-1, 1):
    cx = s * 52 / PX
    lock, _ = loft('lock', LOCK, tex_mat('hair_lock%d' % (s > 0), mass_texture(LOCK, waves(.09), .35, s * 2.0, cx=cx, W=512, H=512, power=2.1)),
                   48, 40, 2.1, cx=cx, bump=waves(.09), uv=True)
    for v in lock.data.vertices:
        row = 120 - (v.co.z - 3) * PX
        v.co.x += s * float(np.interp(row, (100, 112, 127, 141, 160), (-1, -2, -5, 4, -1))) / PX
def hair_pt(th, v, out=.03):
    t = np.interp(Z(v), SR[:, 0], np.linspace(0, 1, len(SR)))
    x, y, z = surf(SR, np.array(th), np.array(t), 2.25)
    x, y, z = float(x), float(y), float(z)
    cy = float(np.interp(z, SR[:, 0], (SR[:, 2] + SR[:, 3]) / 2))
    d = Vector((x, y - cy, 0)).normalized()
    return (x + d.x * out, y + d.y * out, z)

# 蝴蝶結髮夾（先做在原點、正面朝 -Y，再轉到頭髮表面）
for s in (-1, 1):
    before = set(scene.collection.objects)
    for d in (-1, 1):
        wing = [(.06, .10), (.30, .23), (.47, .31), (.50, .20), (.44, .03), (.50, -.15), (.44, -.27), (.28, -.21), (.06, -.10)]
        n = len(wing)
        verts = [(d * x, yy, z) for yy in (-.055, .055) for x, z in wing]
        faces = [tuple(range(n)), tuple(range(n, 2 * n))[::-1]] + [(i, i + n, (i + 1) % n + n, (i + 1) % n) for i in range(n)]
        o = new_obj('clip', verts, faces, BLACK, smooth=False)
        bm = bmesh.new(); bm.from_mesh(o.data); bmesh.ops.recalc_face_normals(bm, faces=bm.faces); bm.to_mesh(o.data); bm.free()
    ball('cliphood', (0, -.07, .02), (.165, .09, .17), BLACK, 18, 12)
    ball('clipface', (0, -.135, -.065), (.155, .06, .12), WHITE, 18, 12)
    ball('clipskull', (0, -.17, .10), (.068, .035, .062), ROSE, 10, 8)
    for d in (-1, 1):
        ball('clipeye', (d * .062, -.195, -.062), (.026, .016, .034), INK, 8, 6)['noline'] = True
    th = s * math.radians(47)
    M = Matrix.Translation(Vector(hair_pt(th, 45, .1))) @ Matrix.Rotation(th, 4, 'Z') @ Matrix.Rotation(s * .12, 4, 'Y') @ Matrix.Scale(1.08, 4)
    for o in set(scene.collection.objects) - before:
        o.data.transform(M)

# 耳朵
for s in (-1, 1):
    ball('ear', (s * 1.17, .13, Z(95)), (.23, .21, .28), SKIN, 22, 14, rz=s * .6)
    ball('earin', (s * 1.35, .04, Z(95.5)), (.07, .12, .155), PINK, 14, 10, rz=s * .6)['noline'] = True

# ───────── 身體：上衣正面直接貼原畫 ─────────
def leopard(W=512, H=512, seed=31, cols=11, rows_=6):
    """豹紋：棕色斑心＋斷開的深色圈。"""
    r_ = np.random.default_rng(seed)
    U, V = np.meshgrid(np.arange(W) + .5, np.arange(H) + .5)
    col = np.ones((H, W, 3), np.float32) * rgb((198, 150, 100))
    col += ((r_.random((H, W)) - .5) * .06)[..., None]
    sx, sy = W / cols, H / rows_
    for j in range(-1, rows_ + 1):
        for i in range(cols):
            cx = (i + .5 * (j % 2) + (r_.random() - .5) * .35) * sx
            cy = (j + .5 + (r_.random() - .5) * .35) * sy
            dx = (U - cx + W / 2) % W - W / 2; dy = V - cy
            k = .8 + r_.random() * .35
            d = np.sqrt((dx / (sx * .40 * k)) ** 2 + (dy / (sy * .40 * k)) ** 2)
            ang = np.arctan2(dy / sy, dx / sx)
            wob = 1 + .09 * np.sin(ang * 4 + r_.random() * 6)
            col[d * wob < .64] = rgb((150, 92, 52))
            ring = (d * wob >= .64) & (d * wob < 1.04) & (np.cos(ang + r_.random() * 6) > -.74)
            col[ring] = rgb((52, 32, 22))
    return np.clip(col, 0, 1)

loft('neck', rows([(119, 9, 142, 118), (112, 8.5, 143, 117), (106, 9.5, 144, 115)]), SKIN, 24, 8, 2)
TORSO = rows([(171, 25, 147, 107), (161, 22.5, 148, 108), (150, 19, 147.5, 110), (141, 20, 149, 110), (132, 21.5, 148, 110), (123, 20.5, 144, 112),
              (117, 14, 140, 114), (112, 8, 136, 116)])

def torso_texture(W=1024, H=768):
    R = smooth_rows(TORSO)
    U, V = np.meshgrid((np.arange(W) + .5) / W, 1 - (np.arange(H) + .5) / H)
    th = (U - .5) * 2 * math.pi
    x, y, z = surf(R, th, V, 2.5)
    v = 120 - (z - 3) * PX
    col = np.ones((H, W, 3), np.float32) * rgb(SKIN_RGB) * .98
    gather = 1 - .14 * (np.maximum(0, np.cos(th * 34)) ** 6)
    red = (v > 130.5) & (v < 150)
    col[red] = rgb((196, 30, 36))
    ruffle = red & ((v < 133.5) | (v > 146))
    col[ruffle] *= gather[ruffle][:, None]
    col[(np.abs(v - 133.8) < .5) | (np.abs(v - 145.8) < .5)] = rgb((112, 14, 22))
    pants = v > 154.5
    col[pants] = leopard(W, H, 5, 20, 8)[pants]
    nx, ny = neutral_px(x, z)
    s = sample(NEU, nx, ny)
    ok = (s[..., 3] > .9) & (np.cos(th) > .45) & (np.abs(nx - 205) < 54) & (ny > 280) & (ny < 440)
    a = (np.clip((np.cos(th) - .45) / .2, 0, 1) * ok)[..., None]
    col = col * (1 - a) + s[..., :3] * a
    return np.dstack([np.clip(col, 0, 1), np.ones((H, W), np.float32)])

_, TR = loft('torso', TORSO, tex_mat('outfit', torso_texture()), 56, 36, 2.5, uv=True, caps=False)

def front_y(x, z, off=.012):
    w = np.interp(z, TR[:, 0], TR[:, 1]); yf = np.interp(z, TR[:, 0], TR[:, 2]); yb = np.interp(z, TR[:, 0], TR[:, 3])
    q = max(0.0, 1 - min(1.0, abs(x) / w) ** 2.5) ** (1 / 2.5)
    return float((yf + yb) / 2 - (yb - yf) / 2 * q - off)

# 頸鍊與星星墜
tube('choker', [(9.6 / PX * math.sin(a), Y(129.5) - 13.5 / PX * math.cos(a), Z(114.5) + .03 * -math.cos(a)) for a in np.linspace(0, math.tau, 17)],
     [.045, .045], BLACK, 48, 8)
for k in range(5):
    a = k / 5 * math.tau
    tube('pendant', [(0, Y(143.5), Z(117.5)), (math.sin(a) * .1, Y(144), Z(117.5) + math.cos(a) * .1)], [.04, .008], SILVER, 6, 8, .6)

# 手臂（露肩）＋紅色荷葉袖＋手鍊
for s in (-1, 1):
    tube('arm', [P(s * 17, 126, 126), P(s * 27, 126.5, 141), P(s * 37, 128, 155), P(s * 44, 130, 166)], [.12, .165, .155, .15], SKIN, 24, 18)
    ball('hand', P(s * 47, 131, 171), (.21, .23, .25), SKIN, 22, 16)
    ball('thumb', P(s * 42, 137.5, 169.5), (.08, .09, .12), SKIN, 14, 10, ry=-s * .45)
    tube('puff', [P(s * 18, 126, 130), P(s * 24, 126.3, 136), P(s * 29.5, 126.8, 142.5)], [.17, .23, .27], RED, 14, 20)
    for k in range(11):
        a = k / 11 * math.tau; c = Vector(P(s * 29.8, 126.8, 143))
        ball('puffedge', tuple(c + Vector((math.cos(a) * .22, math.sin(a) * .22, s * math.cos(a) * .12))), (.095, .095, .075), RED, 10, 8)
for k in range(12):
    a = k / 12 * math.tau; c = Vector(P(-43, 129.8, 164))
    ball('bracelet', tuple(c + Vector((math.cos(a) * .165, math.sin(a) * .165, -math.cos(a) * .08))), (.042, .042, .042), SILVER, 8, 6)

# 斜背小包（角色左側）
def pill(name, c, r, m, rz=0.0, ry=0.0): return ball(name, c, r, m, 24, 16, rz=rz, ry=ry)
pill('bag', P(30, 147, 172), (.36, .2, .34), BLACK, ry=.22)
pill('bagtop', P(25.5, 147, 164), (.2, .16, .24), BLACK, ry=.5)
strap = [(x / PX, front_y(x / PX, Z(v), .06), Z(v)) for x, v in ((12.5, 118), (15.5, 126), (18, 137))]
tube('strap', strap + [P(21, 153, 148), P(24, 150, 160)], [.055, .06, .062, .062, .055], BLACK, 30, 10, .45)
tube('strapback', [strap[0], P(15, 114, 119), P(19, 105, 134), P(24, 118, 154), P(28, 138, 164)], [.05, .06, .06, .06, .05], BLACK, 30, 10, .45)
for k in range(8):
    t = k / 7
    ball('chain', P(24 + 8 * t, 155.8 + 1.2 * math.sin(math.pi * t), 156 + 22 * t), (.06, .035, .075) if k % 2 else (.038, .035, .075), SILVER, 8, 6)
ball('bagface', P(35, 155.5, 173), (.16, .06, .13), WHITE, 16, 10)
for d in (-1, 1):
    ball('bagear', P(35 + d * 5, 154.8, 167.8), (.055, .045, .1), BLACK, 8, 6, ry=d * .55)
    ball('bageye', P(35 + d * 2.4, 157.9, 173), (.026, .016, .032), INK, 8, 6)['noline'] = True
ball('bagskull', P(35, 156, 165.5), (.065, .035, .06), ROSE, 10, 8)
ball('bagcharm', P(30, 157, 180), (.07, .04, .065), ROSE, 10, 8)

# ───────── 豹紋寬褲與厚底鞋 ─────────
PANTS = tex_mat('leopard_leg', np.dstack([leopard(512, 512, 31, 11, 6), np.ones((512, 512), np.float32)]))
HIPS = tex_mat('leopard_hip', np.dstack([leopard(512, 512, 47, 15, 2), np.ones((512, 512), np.float32)]))
loft('hips', rows([(177, 10, 143, 112), (170, 23, 148, 106.5), (160, 22, 147, 108)]), HIPS, 40, 6, 2.6, uv=True)
for s in (-1, 1):
    loft('pant', [(Z(218), .54, Y(143), Y(99)), (Z(210), .59, Y(150), Y(98)), (Z(200), .51, Y(149), Y(101)), (Z(188), .45, Y(148), Y(104)),
                  (Z(174), .41, Y(148), Y(107)), (Z(160), .35, Y(145), Y(109))], PANTS, 44, 28, 2.4, cx=s * .55, uv=True)
    before = set(scene.collection.objects)
    shoe(s, SHOE, SOLE, LACE, cx=.57, turn=9)
    new = set(scene.collection.objects) - before
    for o in list(new):
        if o.name.split('.')[0] in ('lace', 'toecap'):
            new.discard(o); bpy.data.objects.remove(o)
    for o in new:
        thick = o.name.split('.')[0] in ('sole', 'soleline')
        for v in o.data.vertices:
            v.co.y *= 1.13
            v.co.z = v.co.z * 1.7 if (thick or v.co.z < .18) else v.co.z * .80 + .16        # 厚底

finish('Anna',
       heads={'head', 'hair', 'hairback', 'lock', 'clip', 'cliphood', 'clipface', 'clipskull', 'clipeye', 'ear', 'earin'},
       legs={'sole', 'shoe', 'tongue', 'soleline', 'pant'},
       arms={'arm', 'hand', 'thumb', 'puff', 'puffedge', 'bracelet'})

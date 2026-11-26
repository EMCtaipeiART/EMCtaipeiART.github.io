# 生成版 Machi 的頭部上色圖：照白膜正交視圖（寬高 2.6 單位、中心高度 1.1，1024 px）畫出髮色、挑染、皮膚與五官。
# 版面：[正面 1024][側面（臉朝右） 1024][背面 1024]。身體、衣服、小雞的顏色在 pixel-plaza/machi3d-gen.js 裡依位置上色。
# 座標是照 gen_cat_model.py 輸出的正面／側面視圖描的；模型重做後要重描。
# 執行：python3 models/machi/gen_machi_paint.py
import os
from PIL import Image, ImageDraw, ImageFilter

ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
K = 4   # 先畫大再縮小，邊緣才平順
HAIR, BLOND, SKIN = (74, 43, 29), (232, 166, 90), (252, 205, 180)
BLUSH, BROW, EYE, MOUTH = (246, 160, 148), (45, 25, 17), (20, 15, 16), (176, 72, 58)

def panel():
    im = Image.new('RGB', (1024 * K, 1024 * K), HAIR)
    return im, ImageDraw.Draw(im)
def P(pts): return [(x * K, y * K) for x, y in pts]
def E(cx, cy, rx, ry): return [(cx - rx) * K, (cy - ry) * K, (cx + rx) * K, (cy + ry) * K]
def mirror(pts): return [(1022 - x, y) for x, y in pts]
def smooth(pts, n=10):   # 通過各點的圓滑封閉曲線
    out = []
    for i in range(len(pts)):
        p0, p1, p2, p3 = (pts[(i + j - 1) % len(pts)] for j in range(4))
        for s in range(n):
            t = s / n
            out.append(tuple(.5 * (2 * p1[k] + (p2[k] - p0[k]) * t + (2 * p0[k] - 5 * p1[k] + 4 * p2[k] - p3[k]) * t * t
                                   + (3 * p1[k] - p0[k] - 3 * p2[k] + p3[k]) * t ** 3) for k in (0, 1)))
    return out

# ───── 正面 ─────
front, d = panel()
left_edge = [(511, 252), (498, 232), (480, 217), (462, 215), (446, 228), (436, 250), (433, 283), (426, 306), (409, 330), (386, 347), (358, 358), (332, 364)]
face = left_edge + [(334, 400), (340, 440), (352, 470), (390, 497), (450, 516), (511, 522), (572, 516), (632, 497), (670, 470), (682, 440), (688, 400), (690, 364)] + mirror(left_edge)[::-1][:-1]
d.polygon(P(face), fill=SKIN)
for cx in (388, 634):   # 腮紅（柔邊）
    soft = Image.new('L', front.size, 0); ImageDraw.Draw(soft).ellipse(E(cx, 428, 30, 17), fill=175)
    front.paste(Image.new('RGB', front.size, BLUSH), (0, 0), soft.filter(ImageFilter.GaussianBlur(7 * K)))
d = ImageDraw.Draw(front)
streak = smooth([(478, 190), (442, 198), (410, 222), (385, 258), (355, 292), (318, 310), (274, 300), (284, 322), (312, 342), (348, 352),
                 (390, 340), (422, 312), (438, 280), (442, 252), (456, 232), (478, 226), (488, 208)])
for s in (streak, mirror(streak)):
    d.polygon(P(s), fill=BLOND)
    d.line(P(s + s[:1]), fill=BLOND, width=8 * K, joint='curve')   # 落在皮膚上的部分程式會換回膚色
brow = smooth([(419, 321), (428, 310), (446, 302), (464, 303), (473, 309), (468, 316), (450, 314), (434, 318), (425, 325)])
for s in (brow, mirror(brow)): d.polygon(P(s), fill=BROW)
for cx, side in ((434, 1), (588, -1)):   # side：往臉中央的方向
    d.ellipse(E(cx, 379, 37, 41), fill=(255, 253, 250))
    d.ellipse(E(cx + 5 * side, 380, 29, 36), fill=EYE)
    d.ellipse(E(cx + 15, 364, 9.5, 11), fill=(255, 255, 255))
    d.ellipse(E(cx - 7, 398, 4, 4), fill=(235, 232, 230))
    d.arc(E(cx, 380, 39, 44), 198, 342, fill=BROW, width=7 * K)
smile = [(484 + 54 * t, 452 + 52 * t * (1 - t)) for t in [i / 30 for i in range(31)]]
d.line(P(smile), fill=MOUTH, width=6 * K, joint='curve')
for p in (smile[0], smile[-1]): d.ellipse(E(p[0], p[1], 3, 3), fill=MOUTH)

# ───── 側面（臉朝右） ─────
side, d = panel()
d.polygon(P(smooth([(562, 392), (592, 372), (610, 354), (655, 362), (700, 356), (735, 342), (790, 345), (790, 530), (640, 530), (560, 510), (548, 466), (566, 440)], 6)), fill=SKIN)
ear = smooth([(486, 398), (497, 370), (522, 359), (550, 368), (570, 388), (577, 412), (566, 432), (571, 448), (545, 458), (515, 450), (494, 428)])
d.polygon(P(ear), fill=SKIN)
d.polygon(P(smooth([(750, 150), (762, 205), (757, 265), (738, 318), (702, 346), (652, 354), (590, 352), (548, 336), (600, 330), (648, 312), (678, 275), (700, 215), (722, 165)])), fill=BLOND)
soft = Image.new('L', side.size, 0); ImageDraw.Draw(soft).ellipse(E(668, 432, 30, 18), fill=165)
side.paste(Image.new('RGB', side.size, BLUSH), (0, 0), soft.filter(ImageFilter.GaussianBlur(7 * K)))

back, _ = panel()

out = Image.new('RGB', (3072, 1024))
for i, im in enumerate((front, side, back)): out.paste(im.resize((1024, 1024), Image.LANCZOS), (i * 1024, 0))
path = os.path.join(ROOT, 'pixel-plaza/assets/machi3d/machi-gen.webp')
out.save(path, quality=94, method=6)
print(os.path.getsize(path) // 1024, 'KB')

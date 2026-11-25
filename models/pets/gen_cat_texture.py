# 生成版 3D 貓的貼圖：把原圖三視圖照特徵點扭曲到模型的正交視圖座標，輸出 pixel-plaza/assets/pets3d-gen/cat.webp
# 版面：[正面 1024][側面（朝右） 1024][背面 1024]；每格是正交視圖：寬高 2.6 單位、中心高度 1.1（和 pets3d-gen.js 一致）。
# 執行：python3 models/pets/gen_cat_texture.py（需要本機 pixel-plaza/ai-views/ 原圖）
import os
import numpy as np
from PIL import Image
from scipy import ndimage
from scipy.interpolate import RBFInterpolator

ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
art = np.array(Image.open(os.path.join(ROOT, 'pixel-plaza/ai-views/cat-sheets/stand-sheet.webp')).convert('RGB')).astype(np.float32)
yy, xx = np.mgrid[0:art.shape[0], 0:art.shape[1]]

# 去掉背景與深色外框：往內縮一圈，外面用最近的毛色填滿
bg = np.abs(art - art[4, 4]).max(axis=2) < 14
lab, _ = ndimage.label(bg)
border = np.unique(np.concatenate([lab[0], lab[-1], lab[:, 0], lab[:, -1]]))
fg = ndimage.binary_fill_holes(ndimage.binary_opening(~np.isin(lab, border[border > 0]), iterations=1))

def fill(img, hole, blur):
    j = ndimage.distance_transform_edt(hole, return_distances=False, return_indices=True)
    out = img[j[0], j[1]]
    if blur:
        out = np.stack([ndimage.gaussian_filter(out[..., k], blur) for k in range(3)], axis=2)
    return np.where(hole[..., None], out, img)

clean = fill(art, ~ndimage.binary_erosion(fg, iterations=14), 0)
# 腿部的描線投到立體的腿上會變成黑線
lum = clean @ np.array([.3, .59, .11])
dark = ((lum < 120) | (lum < ndimage.uniform_filter(lum, 32) - 34)) & (yy > 492)
clean = fill(clean, ndimage.binary_dilation(dark, iterations=4), 5)
# 背面圖垂下來的尾巴塗掉（模型的尾巴是翹起來的）
x0, x1, y0, y1 = 1550, 1680, 420, 667
span = x1 - x0
back = clean.copy()
for y in range(y0, y1):
    n = span // 2
    t = np.linspace(0, 1, span)[:, None]
    a = clean[y, x0 - 1 - (np.arange(span) % n)]
    c = clean[y, x1 + (np.arange(span)[::-1] % n)]
    back[y, x0:x1] = a * (1 - t) + c * t
# 背面圖的項圈塗掉（模型的項圈從後面看會被身體擋住，投影到屁股上會變成粉紅色條紋）
back[250:316, 1400:1830] = back[316:382, 1400:1830][::-1]   # 用下面的背部毛色鏡射蓋過去

# 特徵點：(模型正交視圖像素, 原圖像素)
def f(mx, my, ax, ay): return ((mx, my), (120 + ax / 1.5, ay / 1.5))     # 量測圖放大 1.5 倍、左緣 120
def s(mx, my, ax, ay): return ((mx, my), (660 + ax / 1.5, ay / 1.5))
FRONT = [f(340,82,215,66), f(680,82,612,66), f(296,260,190,235), f(722,260,642,235), f(512,175,415,153), f(290,375,172,365), f(736,375,662,365),
         f(422,325,330,303), f(385,325,290,303), f(460,325,372,303), f(422,285,330,262), f(422,362,330,345),
         f(600,325,509,303), f(563,325,468,303), f(637,325,551,303), f(600,285,509,262), f(600,362,509,345),
         f(512,368,417,373), f(512,418,417,413), f(440,432,345,430), f(586,432,490,430), f(512,500,417,486),
         f(340,488,252,478), f(684,488,583,478), f(420,540,340,515), f(610,537,500,515), f(512,522,416,515), f(512,563,416,553), f(456,566,377,552), f(568,566,458,552), f(512,608,416,590),
         f(262,690,168,680), f(762,690,665,680), f(435,865,345,872), f(590,865,487,872), f(435,940,345,952), f(590,940,487,952),
         f(285,900,198,905), f(734,900,632,905), f(512,795,417,790)]
SIDE = [s(698,82,665,45), s(750,200,740,170), s(524,340,500,320), s(856,225,893,215),
        s(842,322,838,292), s(842,278,838,250), s(846,368,838,334), s(804,322,800,292), s(878,322,876,292),
        s(944,368,953,340), s(920,425,928,398), s(860,495,862,465), s(700,300,690,290),
        s(848,563,855,545), s(884,563,893,545), s(814,563,815,545), s(540,405,540,415), s(740,490,720,495),
        s(262,85,222,64), s(333,150,280,102), s(80,330,42,300), s(210,330,190,300), s(255,465,205,455),
        s(370,415,300,410), s(500,425,480,408), s(165,630,78,630), s(500,790,400,800), s(822,640,843,620),
        s(235,940,115,955), s(365,915,232,928), s(190,790,82,790), s(590,790,545,790), s(745,780,692,790),
        s(665,940,605,955), s(808,900,700,920), s(300,640,215,640), s(660,620,640,620)]
def b(mx, my, ax, ay): return ((mx, my), (ax, ay))
BACK = [b(344,82,1480,48), b(684,82,1768,48), b(512,175,1616,100), b(290,350,1452,215), b(736,350,1772,215),
        b(345,480,1478,300), b(680,480,1750,300), b(512,490,1612,282), b(262,690,1448,455), b(762,690,1782,455),
        b(300,880,1478,610), b(724,880,1750,610), b(435,940,1535,645), b(590,940,1690,645)]

panels = []
gy, gx = np.mgrid[0:1024, 0:1024]
for img, marks in ((clean, FRONT), (clean, SIDE), (back, BACK)):
    src = np.array([m[0] for m in marks], float); dst = np.array([m[1] for m in marks], float)
    warp = RBFInterpolator(src, dst, kernel='thin_plate_spline', smoothing=2.0)
    small = warp(np.stack([gx[::4, ::4].ravel(), gy[::4, ::4].ravel()], 1)).reshape(256, 256, 2)   # 先算粗格再放大
    big = np.stack([ndimage.map_coordinates(small[..., k], [gy / 4, gx / 4], order=1, mode='nearest') for k in range(2)], 2)
    panels.append(np.stack([ndimage.map_coordinates(img[..., k], [big[..., 1], big[..., 0]], order=1, mode='nearest') for k in range(3)], 2))
out = os.path.join(ROOT, 'pixel-plaza/assets/pets3d-gen/cat.webp')
Image.fromarray(np.concatenate(panels, 1).clip(0, 255).astype(np.uint8)).save(out, quality=92, method=6)
print(os.path.getsize(out) // 1024, 'KB')

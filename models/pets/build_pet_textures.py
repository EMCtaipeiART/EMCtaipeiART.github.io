# 從寵物原圖（站姿三視圖）做 3D 模型用的貼圖：pixel-plaza/assets/pets3d/<id>.webp
# 版面（單位＝三視圖縮成 1600 px 寬的座標 × SC）：[正面(去外框、塗掉眼睛) 400][側面 580][背面 400][正面原圖 400]，高 520。
# 座標常數要和 pixel-plaza/pets3d.js 的 REF 一致。原圖在本機 pixel-plaza/ai-views/（不進 Git）。
# 執行：python3 models/pets/build_pet_textures.py
import os
import numpy as np
from PIL import Image
from scipy import ndimage

ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
SC, H, W = 1.25, 520, (400, 580, 400, 400)
PETS = {
    'cat':  dict(src='cat-sheets/stand-sheet.webp', gy=507, fx=319, sz=770, bx=1291, bgy=510, edge=11,
                 eyes=[(272, 162, 25, 26), (368, 162, 25, 26), (975, 157, 23, 27)], tail=(1244, 1343, 335, 525)),
    'cat2': dict(src='cat2-sheets/stand-sheet.webp', gy=505, fx=319, sz=760, bx=1284, bgy=508, edge=11,
                 eyes=[(273, 178, 25, 26), (368, 178, 25, 26), (952, 162, 23, 27)], tail=(1240, 1330, 385, 525)),
    'dog1': dict(src='dog1-sheets/d1-stand-sheet.png', gy=432, fx=265, sz=790, bx=1332, bgy=433, edge=9,
                 eyes=[(222, 187, 16, 22), (309, 187, 16, 22), (984, 187, 15, 23)], tail=None),
    'dog2': dict(src='dog2-sheets/d2-stand-sheet.png', gy=464, fx=278, sz=800, bx=1312, bgy=465, edge=9,
                 eyes=[(239, 162, 14, 16), (318, 162, 14, 16), (935, 165, 14, 18)], tail=None),
}

for pid, P in PETS.items():
    im = Image.open(os.path.join(ROOT, 'pixel-plaza/ai-views', P['src'])).convert('RGB')
    full = np.array(im.resize((int(1600 * SC), int(round(im.height * 1600 * SC / im.width))), Image.LANCZOS)).astype(np.float32)
    r, g, b = full[..., 0], full[..., 1], full[..., 2]
    if pid.startswith('dog'):
        bg = (b > r + 70) & (b > g + 25)
    else:
        bg = np.abs(full - full[4, 4]).max(axis=2) < 14
        lab, _ = ndimage.label(bg)
        border = np.unique(np.concatenate([lab[0], lab[-1], lab[:, 0], lab[:, -1]]))
        bg = np.isin(lab, border[border > 0])
    fg = ndimage.binary_fill_holes(ndimage.binary_opening(~bg, iterations=1))
    if pid.startswith('dog'):   # 狗的深色外框很粗：和背景相連的深色一起當背景去掉
        lum = r * .3 + g * .59 + b * .11
        dark = lum < (58 if pid == 'dog1' else 120)
        fg &= ~ndimage.binary_propagation(~fg, mask=~fg | dark)
        fg = ndimage.binary_opening(fg, iterations=2)
    inner = ndimage.binary_erosion(fg, iterations=int(P['edge'] * SC))
    idx = ndimage.distance_transform_edt(~inner, return_distances=False, return_indices=True)
    clean = full[idx[0], idx[1]]
    yy, xx = np.mgrid[0:full.shape[0], 0:full.shape[1]]
    # 薩摩耶：白毛裡殘留的深色線（尾巴輪廓、腿間陰影）一併補掉，只保留臉上的五官
    if pid == 'dog2':
        keep = np.zeros(inner.shape, bool)
        for (x0, y0, x1, y1) in [(215, 150, 345, 265), (925, 130, 1045, 265)]:
            keep |= (xx >= x0 * SC) & (xx < x1 * SC) & (yy >= y0 * SC) & (yy < y1 * SC)
        line = ndimage.binary_dilation((clean[..., 0] * .3 + clean[..., 1] * .59 + clean[..., 2] * .11 < 178) & ~keep, iterations=3)
        j = ndimage.distance_transform_edt(line, return_distances=False, return_indices=True)
        filled = clean[j[0], j[1]]
        soft = np.stack([ndimage.gaussian_filter(filled[..., k], 3 * SC) for k in range(3)], axis=2)
        clean = np.where(line[..., None], soft, clean)
    # 虎斑貓的串珠項圈另外建模：把圖上的彩色珠子塗掉，變胖後才不會在背上透出色塊
    if pid == 'cat2':
        r2, b2 = clean[..., 0], clean[..., 2]
        beads = ((b2 > r2 * .8) | ((r2 > 200) & (clean[..., 1] > 160) & (b2 < 90))) & (yy < 345 * SC) & (yy > 249 * SC) & (r2 + clean[..., 1] + b2 > 150)
        beads = ndimage.binary_dilation(beads, iterations=int(9 * SC))
        j = ndimage.distance_transform_edt(beads, return_distances=False, return_indices=True)
        filled = clean[j[0], j[1]]
        soft = np.stack([ndimage.gaussian_filter(filled[..., k], 3 * SC) for k in range(3)], axis=2)
        clean = np.where(beads[..., None], soft, clean)
    # 三花貓的項圈和鈴鐺另外建模：從圖上塗掉，趴下時身上才不會印著第二個鈴鐺
    if pid == 'cat':
        r1, g1, b1 = clean[..., 0], clean[..., 1], clean[..., 2]
        band = (yy > 222 * SC) & (yy < 330 * SC)
        collar = (r1 > 150) & (r1 - g1 > 45) & (b1 > g1 * .9) & band
        for (cx, cy) in [(319, 292), (985, 292)]:
            collar |= (xx - cx * SC) ** 2 + (yy - cy * SC) ** 2 < (38 * SC) ** 2
        collar = ndimage.binary_dilation(collar, iterations=int(7 * SC))
        j = ndimage.distance_transform_edt(collar, return_distances=False, return_indices=True)
        filled = clean[j[0], j[1]]
        soft = np.stack([ndimage.gaussian_filter(filled[..., k], 4 * SC) for k in range(3)], axis=2)
        clean = np.where(collar[..., None], soft, clean)
    if pid == 'cat2':
        r3, g3, b3 = clean[..., 0], clean[..., 1], clean[..., 2]
        pink = (r3 > 190) & (r3 - g3 > 30) & (b3 > g3 * .9) & (yy > 230 * SC) & (yy < 360 * SC)
        pink = ndimage.binary_dilation(pink, iterations=int(8 * SC))
        j = ndimage.distance_transform_edt(pink, return_distances=False, return_indices=True)
        filled = clean[j[0], j[1]]
        soft = np.stack([ndimage.gaussian_filter(filled[..., k], 3 * SC) for k in range(3)], axis=2)
        clean = np.where(pink[..., None], soft, clean)
    if pid.startswith('cat'):   # 腿腳上的描線投到立體的腳上會變成一條條黑線：腿部高度的深色線換成旁邊的毛色
        lum = clean[..., :3] @ np.array([.3, .59, .11])
        local = ndimage.uniform_filter(lum, int(26 * SC))
        dark = ((lum < 120) | (lum < local - 34)) & (yy > 385 * SC)
        dark = ndimage.binary_dilation(dark, iterations=int(3 * SC))
        j = ndimage.distance_transform_edt(dark, return_distances=False, return_indices=True)
        filled = clean[j[0], j[1]]
        soft = np.stack([ndimage.gaussian_filter(filled[..., k], 4 * SC) for k in range(3)], axis=2)
        clean = np.where(dark[..., None], soft, clean)
    # 眼睛塗掉（模型上另外貼）：用周圍毛色補
    for n, (cx, cy, rx, ry) in enumerate(P['eyes']):
        if n == 2 and pid.startswith('cat'):   # 貓的側面眼睛：整塊換成旁邊的毛（只模糊填色會在側臉留下一圈霧斑）
            dx, dy = int(56 * SC), int(6 * SC)
            moved = np.roll(clean, (dy, dx), axis=(0, 1))
            d = np.sqrt(((xx - cx * SC) / (rx * 1.35 * SC)) ** 2 + ((yy - cy * SC) / (ry * 1.35 * SC)) ** 2)
            a = np.clip((1.15 - d) / .4, 0, 1)[..., None]
            clean = clean * (1 - a) + moved * a
            continue
        if pid.startswith('cat'):   # 正面眼睛位置換成上方的毛（模糊填色從側面看是一塊白霧）
            moved = np.roll(clean, int(50 * SC), axis=0)
            d = np.sqrt(((xx - cx * SC) / (rx * 1.06 * SC)) ** 2 + ((yy - cy * SC) / (ry * 1.06 * SC)) ** 2)
            a = np.clip((1.1 - d) / .12, 0, 1)[..., None]   # 範圍要比眼睛貼片小，貼片外緣才接得起原圖
            clean = clean * (1 - a) + moved * a
            continue
        hole = ((xx - cx * SC) / (rx * SC)) ** 2 + ((yy - cy * SC) / (ry * SC)) ** 2 < 1
        j = ndimage.distance_transform_edt(hole, return_distances=False, return_indices=True)
        filled = clean[j[0], j[1]]
        soft = np.stack([ndimage.gaussian_filter(filled[..., k], 5 * SC) for k in range(3)], axis=2)
        clean = np.where(hole[..., None], soft, clean)
    # 貓背面垂下來的尾巴塗掉（立體模型的尾巴是翹起來的）：左右毛色往中間接
    if P['tail']:
        x0, x1, y0, y1 = (int(v * SC) for v in P['tail'])
        span = x1 - x0
        for y in range(y0, min(y1, clean.shape[0])):
            n = span // 2
            t = np.linspace(0, 1, span)[:, None]
            a = clean[y, x0 - 1 - (np.arange(span) % max(1, n))]
            c = clean[y, x1 + (np.arange(span)[::-1] % max(1, n))]
            clean[y, x0:x1] = a * (1 - t) + c * t

    def crop(img, x0, y0, w):
        xs = np.clip((np.arange(int(w * SC)) + int(x0 * SC)), 0, img.shape[1] - 1)
        ys = np.clip((np.arange(int(H * SC)) + int(y0 * SC)), 0, img.shape[0] - 1)
        return img[np.ix_(ys, xs)]

    gy = P['gy']
    panels = [crop(clean, P['fx'] - 200, gy - 500, W[0]), crop(clean, P['sz'] - 290, gy - 500, W[1]),
              crop(clean, P['bx'] - 200, P['bgy'] - 500, W[2]), crop(full, P['fx'] - 200, gy - 500, W[3])]
    out = os.path.join(ROOT, 'pixel-plaza/assets/pets3d', pid + '.webp')
    os.makedirs(os.path.dirname(out), exist_ok=True)
    Image.fromarray(np.concatenate(panels, axis=1).clip(0, 255).astype(np.uint8)).save(out, quality=90, method=6)
    print(pid, os.path.getsize(out) // 1024, 'KB')

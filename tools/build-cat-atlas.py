# 貓咪貼圖集：把 pixel-plaza/ai-views/cat-sheets/<姿勢>-sheet.webp（ChatGPT 生成的三視圖，只存在本機、不進 Git）
# 去背（藍底／米底）、切成 正／側／背 三格，再併入 <姿勢>-q.png（右前斜 45°、右後斜 45° 兩格），依腳底對齊，輸出 5 格：正、前斜、側、後斜、背： pixel-plaza/assets/cat/cat-atlas.webp + .json
import numpy as np, json, sys
from PIL import Image
from scipy import ndimage as ndi

import os
PET = sys.argv[1] if len(sys.argv) > 1 else 'cat'   # 'cat'（五樓）或 'cat2'（四樓）：來源 ai-views/<PET>-sheets/，輸出 assets/<PET>/
D = os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', 'pixel-plaza', 'assets', PET) + '/'
DOG = PET.startswith('dog')   # dog1（臘腸，四樓）／dog2（薩摩耶，五樓）：來源 ai-views/<PET>-sheets/d<N>-<姿勢>-sheet.png，全部藍底
POSES = [('stand', 'stand-sheet.webp'), ('walkA', 'walkA-sheet.png'), ('walkB', 'walkB-sheet.png'), ('sit', 'sit-sheet.png'),
         ('loaf', 'loaf-sheet.png'), ('sleep', 'sleep-sheet.png'), ('eat', 'eat-sheet.png'), ('run', 'run-sheet.png'),
         ('groom', 'groom-sheet.png'), ('belly', 'belly-sheet.png')]
if DOG:
    _pf = 'd' + PET[3:] + '-'
    POSES = [(n, _pf + n + '-sheet.png') for n in ['stand', 'walkA', 'walkB', 'run', 'sit', 'down', 'sleep', 'eat', 'wag']]
OUT = 2 if DOG else 7   # 外圍黑色粗輪廓（圖集像素；畫面上約 2～3 px）
OL = (26, 20, 16, 255)
SC = 0.34   # 原圖 → 圖集縮放（站立貓約 200 px 高）

def cutout(im, name):
    a = np.asarray(im.convert('RGB')).astype(int)
    r, g, b = a[..., 0], a[..., 1], a[..., 2]
    if name == 'stand' and not DOG:   # 米色底：從四邊洪水填滿
        bg0 = (abs(r - 253) < 14) & (abs(g - 248) < 14) & (abs(b - 238) < 20)
        lab, n = ndi.label(bg0)
        edge = set(lab[0, :]) | set(lab[-1, :]) | set(lab[:, 0]) | set(lab[:, -1]); edge.discard(0)
        bg = np.isin(lab, list(edge))
    else:                 # 藍底（有漸層）：藍色明顯大於紅、綠
        bg = (b > r + 70) & (b > g + 25)
    fg = ~bg
    fg = ndi.binary_opening(fg, iterations=1)
    lab, n = ndi.label(fg)
    sizes = ndi.sum(fg, lab, range(1, n + 1))
    keep = np.isin(lab, [i + 1 for i, s in enumerate(sizes) if s > 400])   # 去掉雜點
    keep = ndi.binary_fill_holes(keep) | keep
    if DOG: keep &= ~((b > r + 60) & (b > g + 20))   # 狗：身體洞裡殘留的藍底（腿縫、尾巴縫）也去掉
    keep = ndi.binary_erosion(keep, iterations=1)   # 吃掉一圈藍邊
    out = np.dstack([a.astype(np.uint8), (keep * 255).astype(np.uint8)])
    return Image.fromarray(out), keep

def split3(keep):
    cols = keep.any(axis=0); xs = np.where(cols)[0]
    groups = []; s = xs[0]; p = xs[0]
    for x in xs[1:]:
        if x - p > 24: groups.append((s, p)); s = x
        p = x
    groups.append((s, p)); return groups

def outline(crop):
    w, h = crop.size; pad = Image.new('RGBA', (w + 2 * OUT, h + 2 * OUT), (0, 0, 0, 0)); pad.paste(crop, (OUT, OUT))
    a = np.asarray(pad)[..., 3] > 96
    yy, xx = np.ogrid[-OUT:OUT + 1, -OUT:OUT + 1]; st = (xx * xx + yy * yy) <= OUT * OUT + 1
    d = ndi.binary_dilation(a, structure=st)
    ol = np.zeros(a.shape + (4,), np.uint8); ol[d] = OL
    base = Image.fromarray(ol); base.alpha_composite(pad); return base

views = {}
for pose, f in POSES:
    _b = D + '../../ai-views/' + PET + '-sheets/' + (_pf if DOG else '') + pose + '-sheet'; im = Image.open(_b + ('.webp' if os.path.exists(_b + '.webp') else '.png')); k = SC * 2172 / im.size[0]
    rgba, keep = cutout(im, pose)
    gs = split3(keep)
    if pose == 'run' and len(gs) == 2 and not DOG: gs = [(gs[0][0], 546), (547, gs[0][1]), gs[1]]
    print(pose, im.size, 'groups', gs)
    if len(gs) != 3: print('  !! 不是 3 組'); sys.exit(1)
    arr = np.asarray(rgba)
    row = []
    for (x0, x1) in gs:
        sub = keep[:, x0:x1 + 1]; ys = np.where(sub.any(axis=1))[0]; y0, y1 = ys[0], ys[-1]
        crop = Image.fromarray(arr[y0:y1 + 1, x0:x1 + 1])
        w, h = crop.size; crop = crop.resize((max(1, round(w * k)), max(1, round(h * k))), Image.LANCZOS)
        row.append(outline(crop))
    # 斜 45° 兩格（ChatGPT 生成的 <姿勢>-q.png，正面斜、背面斜）：高度用相鄰兩個視角的平均來對齊，大小才一致
    qim = Image.open(D + '../../ai-views/' + PET + '-sheets/' + (_pf if DOG else '') + pose + '-q.png'); qrgba, qkeep = cutout(qim, pose + '-q'); qg = split3(qkeep)
    if len(qg) != 2: print('  !! 斜角不是 2 組', pose, qg); sys.exit(1)
    qarr = np.asarray(qrgba); qrow = []
    hs = [c.size[1] - 2 * OUT for c in row]   # 原三格的貓高（去掉外框）
    for qi, (x0, x1) in enumerate(qg):
        sub = qkeep[:, x0:x1 + 1]; ys = np.where(sub.any(axis=1))[0]; y0, y1 = ys[0], ys[-1]
        crop = Image.fromarray(qarr[y0:y1 + 1, x0:x1 + 1]); w, h = crop.size
        target = (hs[0] + hs[1]) / 2 if qi == 0 else (hs[1] + hs[2]) / 2
        kq = target / h
        crop = crop.resize((max(1, round(w * kq)), max(1, round(h * kq))), Image.LANCZOS); qrow.append(outline(crop))
    row = [row[0], qrow[0], row[1], qrow[1], row[2]]
    views[pose] = row

CW = max(c.size[0] for r in views.values() for c in r) + 8
CH = max(c.size[1] for r in views.values() for c in r) + 8
print('cell', CW, CH)
NV = 5
atlas = Image.new('RGBA', (CW * NV, CH * len(POSES)), (0, 0, 0, 0))
meta = {'cw': CW, 'ch': CH, 'poses': [p for p, _ in POSES], 'views': ['front', 'frontq', 'side', 'backq', 'back'], 'sc': SC, 'foot': 4 + OUT, 'h': {}}
for ri, (pose, _) in enumerate(POSES):
    for ci, c in enumerate(views[pose]):
        w, h = c.size
        atlas.paste(c, (ci * CW + (CW - w) // 2, ri * CH + CH - 4 - h), c)   # 底部置中；外框底緣離格底 4 px，所以腳底離格底 4+OUT px
        meta['h'][f'{pose}:{ci}'] = h
atlas.save(D + 'cat-atlas.webp', lossless=True, quality=100, method=6)
json.dump(meta, open(D + 'cat-atlas.json', 'w'), ensure_ascii=False)
print('stand heights', [meta['h'][f'stand:{i}'] for i in range(5)])

# 把 Codex 畫的 4×2 合圖（洋紅 #FF00FF 背景）去背成透明 PNG，輸出 1536×1024；每格要有足夠的人物像素才算合格。
import sys
from PIL import Image
import numpy as np
src, dst = sys.argv[1], sys.argv[2]
im = Image.open(src).convert('RGBA')
if im.size != (1536, 1024):
    im = im.resize((1536, 1024), Image.LANCZOS)
a = np.array(im).astype(np.float32)
r, g, b = a[..., 0], a[..., 1], a[..., 2]
if a[..., 3].min() < 250:   # 已經有透明背景就直接用
    out = a
else:
    dist = np.abs(r - 255) + g + np.abs(b - 255)
    al = np.clip((dist - 90) / 150, 0, 1)
    out = a.copy()
    m = al < 1
    safe = np.where(al > 0.03, al, 1)
    out[..., 0] = np.where(m, np.clip((r - (1 - al) * 255) / safe, 0, 255), r)
    out[..., 1] = np.where(m, np.clip(g / safe, 0, 255), g)
    out[..., 2] = np.where(m, np.clip((b - (1 - al) * 255) / safe, 0, 255), b)
    out[..., 3] = np.where(al < 0.03, 0, np.round(al * 255))
out = out.astype(np.uint8)
alpha = out[..., 3]
bad = []
for row in range(2):
    half = alpha[row * 512:(row + 1) * 512]
    cols = (half > 40).sum(axis=0) > 3
    segs, start = [], None
    for x, v in enumerate(cols):
        if v and start is None: start = x
        if not v and start is not None:
            if x - start > 60: segs.append((start, x))
            start = None
    if start is not None and len(cols) - start > 60: segs.append((start, len(cols)))
    if len(segs) != 4: bad.append(f'row {row} has {len(segs)} figures')
    ys, xs = np.where(half > 40)
    if len(ys) == 0 or ys.min() <= 1 or ys.max() >= 510 or xs.min() <= 1 or xs.max() >= 1534: bad.append(f'row {row} touches edge')
if bad:
    print('BAD ' + '; '.join(bad)); sys.exit(5)
Image.fromarray(out).save(dst)
print('OK')

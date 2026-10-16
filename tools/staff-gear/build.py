#!/usr/bin/env python3
"""Pack the imagegen source into a lossless, native-size office equipment atlas.

Run: python3 tools/staff-gear/build.py [--preview-dir /tmp/staff-gear]
Uses the workstation's Pillow; no project dependency is added.

Generation: built-in imagegen, transparent background. Prompt specification:
Four isolated office objects in a horizontal row: open black laptop with keys
and trackpad, black monitor with stand, black mouse, white landline with handset,
keypad, display and coiled cord. Elevated front view, thin dark stepped outlines,
top highlights and shaded lower facets matching furniture-v3/bottom-imac and the
pixel characters. No labels, logos, desks or colored accents. Source is retained
alongside this script; processing forces neutral colors and native pixel sizes.
"""
import argparse
import json
from pathlib import Path

from PIL import Image, ImageDraw

ROOT = Path(__file__).resolve().parents[2]
ASSETS = ROOT / 'EMC-ART-Pixel-Office/dist/assets'
SPRITES = {
    'laptop': {'x': 0, 'y': 0, 'w': 76, 'h': 48, 'dx': -38, 'dy': -48},
    'monitor': {'x': 80, 'y': 0, 'w': 84, 'h': 62, 'dx': -42, 'dy': -62},
    'mouse': {'x': 168, 'y': 0, 'w': 14, 'h': 19, 'dx': -7, 'dy': -17},
    'phone': {'x': 188, 'y': 0, 'w': 80, 'h': 34, 'dx': -34, 'dy': -30},
}
PALETTE = [12, 20, 28, 36, 44, 52, 60, 72, 84, 100, 120, 144,
           164, 184, 200, 212, 224, 236, 244, 252]
LAYOUTS = {
    'L': [('laptop', -10), ('mouse', 54)],
    'LM': [('laptop', -46), ('monitor', 34), ('mouse', 90)],
    'P': [('phone', 0)],
}


def gray(image):
    """Same brightness/contrast curve as app.js grayOfImage; alpha unchanged."""
    out = image.copy()
    pixels = []
    for r, g, b, a in image.getdata():
        bright = min(255, (r*.299+g*.587+b*.114)*1.9)
        value = round(max(0, min(255, (bright-128)*.85+128)))
        pixels.append((value, value, value, a))
    out.putdata(pixels)
    return out


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--preview-dir', type=Path, default=Path('/tmp/staff-gear'))
    args = parser.parse_args()
    args.preview_dir.mkdir(parents=True, exist_ok=True)
    source = Image.open(Path(__file__).with_name('source.png')).convert('RGBA')
    sheet = Image.new('RGBA', (272, 64))
    regions = [(0, 580), (580, 1240), (1240, 1470), (1470, source.width)]
    for (name, rect), (left, right) in zip(SPRITES.items(), regions):
        region = source.crop((left, 0, right, source.height))
        # Ignore near-transparent generation dust when finding the object bounds.
        bounds = region.getchannel('A').point(lambda a: 255 if a > 100 else 0).getbbox()
        sprite = region.crop(bounds).resize((rect['w'], rect['h']), Image.Resampling.NEAREST)
        pixels = []
        for r, g, b, a in sprite.getdata():
            value = min(PALETTE, key=lambda v: abs(v-(r*.299+g*.587+b*.114)))
            if name != 'phone':
                value = min(value, 100)  # Electronics stay black/dark gray, even edge highlights.
            pixels.append((value, value, value, a) if a else (0, 0, 0, 0))
        sprite.putdata(pixels)
        sheet.paste(sprite, (rect['x'], rect['y']))
    target = ASSETS / 'staff-gear-v1.webp'
    sheet.save(target, lossless=True, exact=True, method=6)
    metadata = {'image': target.name, 'width': sheet.width, 'height': sheet.height,
                'palette': [f'#{v:02x}{v:02x}{v:02x}' for v in PALETTE],
                'anchor': 'object center x / desk baseY; dx,dy are destination offsets',
                'sprites': SPRITES, 'layouts': LAYOUTS,
                'seats': ['L', 'LM', 'P', 'LM', 'P', 'L']}
    target.with_suffix('.json').write_text(json.dumps(metadata, indent=2)+'\n')
    sheet.save(args.preview_dir / 'staff-gear-v1.png')
    checker = Image.new('RGBA', sheet.size, '#dddddd')
    d = ImageDraw.Draw(checker)
    for y in range(0, sheet.height, 8):
        for x in range(0, sheet.width, 8):
            if (x//8+y//8) % 2:
                d.rectangle((x, y, x+7, y+7), fill='#ffffff')
    checker.alpha_composite(sheet)
    checker.resize((1088, 256), Image.Resampling.NEAREST).save(args.preview_dir / 'atlas-4x.png')
    # Two blocks of the six seats: normal and away. Use the actual empty desks.
    furniture = Image.open(ASSETS / 'furniture-v3.webp').convert('RGBA')
    review = Image.new('RGBA', (720, 640), '#f3f1eb')
    d = ImageDraw.Draw(review)
    desk_rects = [(0, 1622, 520, 291), (0, 1913, 517, 291), (0, 2204, 520, 291)]
    for dimmed in [False, True]:
        section = 320 if dimmed else 0
        d.text((20, section+8), 'AWAY / OFF HOURS' if dimmed else 'WORK HOURS', fill='#333333')
        for i, kind in enumerate(metadata['seats']):
            col, row = i % 3, i // 3
            x, y = 20+col*226, section+35+row*137
            sx, sy, sw, sh = desk_rects[col]
            desk = furniture.crop((sx, sy, sx+sw, sy+sh)).resize((round(sw*220/517), 124), Image.Resampling.NEAREST)
            review.alpha_composite(gray(desk) if dimmed else desk, (x, y))
            cx, base = x+110, y+94-22
            for name, offset in LAYOUTS[kind]:
                r = SPRITES[name]
                sprite = sheet.crop((r['x'], r['y'], r['x']+r['w'], r['y']+r['h']))
                review.alpha_composite(gray(sprite) if dimmed else sprite, (cx+offset+r['dx'], base+r['dy']))
    review.save(args.preview_dir / 'six-desks.png')
    assert Image.open(target).convert('RGBA').tobytes() == sheet.tobytes()
    assert all(r == g == b for r, g, b, a in sheet.getdata() if a)
    print(f'{target}: {sheet.size}, {target.stat().st_size} bytes; previews: {args.preview_dir}')


if __name__ == '__main__':
    main()

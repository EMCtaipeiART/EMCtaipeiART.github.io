import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';

const app = await readFile(new URL('../../EMC-ART-Pixel-Office/dist/app.js', import.meta.url), 'utf8');
const atlas = JSON.parse(await readFile(new URL('../../EMC-ART-Pixel-Office/dist/assets/staff-gear-v1.json', import.meta.url), 'utf8'));
const gearSource = app.slice(app.indexOf('const staffGearSheet='), app.indexOf('\nfunction drawDesk(s)'));
const functionSource = name => {
  const start = app.indexOf(`function ${name}(`);
  assert.notEqual(start, -1);
  // These helpers terminate at the end of a line (including the multiline gray helper).
  return app.slice(start, app.indexOf('\n}', start) + 2);
};

function fixture() {
  const draws = [], images = [], canvases = [], fills = [];
  let dirty = 0;
  const ctx = {
    imageSmoothingEnabled: true,
    stack: [],
    save() { this.stack.push(this.imageSmoothingEnabled); },
    restore() { this.imageSmoothingEnabled = this.stack.pop(); },
    fillRect(...args) { fills.push(args); },
    translate() {}, scale() {},
    drawImage(...args) { draws.push({ args, smoothing: this.imageSmoothingEnabled }); },
    set filter(_) { assert.fail('Safari must not need canvas filters'); },
  };
  const sandbox = {
    ctx, LX: 0, STAFF_DX: 880, bottomGray: new Map(), markDirty() { dirty++; },
    assetBase: () => 'https://assets.invalid/',
    Image: class {
      complete = false;
      naturalWidth = 0;
      naturalHeight = 0;
      constructor() { images.push(this); }
    },
    document: { createElement(tag) {
      assert.equal(tag, 'canvas');
      const pixels = new Uint8ClampedArray([20, 40, 60, 255, 0, 0, 0, 0, 244, 244, 244, 128]);
      const context = {
        drawImage() {}, getImageData: () => ({ data: pixels }), putImageData() {},
        set filter(_) { assert.fail('Safari must not need canvas filters'); },
      };
      const canvas = { getContext: () => context, pixels };
      canvases.push(canvas);
      return canvas;
    } },
  };
  const context = vm.createContext(sandbox);
  for (const name of ['setAsset', 'load']) {
    vm.runInContext(app.split('\n').find(line => line.startsWith(`function ${name}(`)), context);
  }
  vm.runInContext(functionSource('grayOfImage'), context);
  vm.runInContext(gearSource, context);
  return {
    draws, fills, images, canvases, ctx, context, get dirty() { return dirty; },
    draw(index, dimmed = false, baseY = 400) {
      sandbox.drawStaffGear({ x: 1428+(index%3)*220, row: index >= 3 ? 1 : 0 }, baseY, dimmed);
    },
    async loaded() {
      Object.assign(images[0], { complete: true, naturalWidth: atlas.width, naturalHeight: atlas.height });
      images[0].onload();
      await Promise.resolve();
    },
  };
}

test('six staff desks keep equipment order, original anchors and clear the desk edges', async () => {
  const f = fixture();
  await f.loaded();
  const expected = [
    [['laptop', -10], ['mouse', 54]],
    [['laptop', -46], ['monitor', 34], ['mouse', 90]],
    [['phone', 0]],
    [['laptop', -46], ['monitor', 34], ['mouse', 90]],
    [['phone', 0]],
    [['laptop', -10], ['mouse', 54]],
  ];
  for (let seat = 0; seat < 6; seat++) {
    f.draws.length = 0;
    f.draws.length = 0; f.fills.length = 0;
    f.draw(seat);
    const cx = 1428+(seat%3)*220;
    assert.equal(f.draws.length, expected[seat].length);
    expected[seat].forEach(([name, offset], index) => {
      const r = atlas.sprites[seat < 3 && name !== 'mouse' ? name + '_back' : name], { args, smoothing } = f.draws[index];
      assert.equal(args[0], f.images[0]);
      assert.deepEqual(args.slice(1), [r.x, r.y, r.w, r.h, cx+offset+r.dx, 400+r.dy, r.w, r.h]);
      assert.equal(smoothing, false);
      assert.ok(args[5] >= cx-100 && args[5]+args[7] <= cx+100, 'keep horizontal desk-edge clearance');
      assert.ok(args[6] >= 400-72 && args[6]+args[8] <= 400+5, 'keep top and front-edge clearance');
      assert.ok(r.x >= 0 && r.y >= 0 && r.x+r.w <= atlas.width && r.y+r.h <= atlas.height);
    });
    assert.equal(f.ctx.imageSmoothingEnabled, true, 'restore the surrounding scene context');
  }
});

test('staff gear skips incomplete and failed images without attempting canvas drawing', async () => {
  const f = fixture();
  for (const dimmed of [false, true]) f.draw(0, dimmed);
  f.images[0].complete = true;
  for (const dimmed of [false, true]) f.draw(0, dimmed);
  assert.equal(f.draws.length, 0);
  assert.equal(f.canvases.length, 0);
  await f.loaded();
  f.draw(5);
  assert.equal(f.draws.length, 2);
});

test('staff sheet retries same-origin assets after CDN failure and redraws after load', async () => {
  const f = fixture(), img = f.images[0];
  assert.equal(img.src, 'https://assets.invalid/assets/staff-gear-v1.webp?v=2');
  assert.equal(img.crossOrigin, 'anonymous');
  img.onerror();
  assert.equal(img.src, 'assets/staff-gear-v1.webp?v=2');
  assert.equal(img.crossOrigin, null);
  assert.equal(img.__fb, null);
  await f.loaded();
  assert.equal(f.dirty, 1);
});

test('failure of both staff image locations is nonfatal and does not loop', async () => {
  const f = fixture(), img = f.images[0];
  img.onerror();
  img.onerror();
  await Promise.resolve();
  await Promise.resolve();
  f.draw(0, true);
  assert.equal(f.draws.length, 0);
  assert.equal(f.dirty, 0);
  assert.equal(img.src, 'assets/staff-gear-v1.webp?v=2');
});

test('off-duty or away staff desks are cleared: nothing drawn, gray desk only', async () => {
  const f = fixture();
  await f.loaded();
  for (let seat = 0; seat < 6; seat++) f.draw(seat, true);
  assert.equal(f.draws.length, 0);
  f.draw(0, false);
  assert.ok(f.draws.length > 0 && f.draws.every(({ args }) => args[0] === f.images[0]), 'on duty: original artwork');
});

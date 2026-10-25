/* 四樓場景（2026-10-26）：只負責「場景」——地板格線、電梯、廁所、木長桌、茶水間、辦公桌群、會議室、玻璃屋，
 * 以及擋路方塊（blocks）、人物出生點與電梯位置。人物、功能鍵、走路、側身全部由 app.js（跟五樓同一份程式）負責：
 * 用 ?floor=4 開啟 app.js 時會讀這個檔的 window.FLOOR4_SCENE。座標都是場景座標，y 全部 +OFFY，讓所有 y 都落在 90 以上
 * （app.js 的 viewY 在 y<90 會換算成往上複製的桌子群，四樓用不到）。
 * 配置：左上電梯；電梯右側男廁、女廁；再右邊 10 人木長桌，旁邊茶水間。下方：左側五個米白桌子群（每群上下各一排、每排四張）；
 * 右側大會議室 H（上下兩個出口，投影機往右，六張白桌排成「C」，一桌兩椅）；桌子群下方會議室 F、G（同 B、C）；
 * 它們右側兩間大玻璃屋，各六張桌椅。素材全部沿用五樓的圖集。 */
(function () {
  const OFFY = 200, W = 2560, H = 4400;
  const TX0 = 245, CORR = 110, T_W = 346, T_H = 438, TY = 60, GPV = 497;/* 都是五樓的數字 */
  const RM = { table_black_left: [8, 8, 55, 130], table_black_mid: [71, 8, 85, 130], table_black_right: [164, 8, 55, 130], table_white_left: [227, 8, 55, 130], table_white_mid: [290, 8, 85, 130], table_white_right: [383, 8, 55, 130], table_wood_left: [446, 8, 55, 90], table_wood_mid: [509, 8, 85, 90], table_wood_right: [602, 8, 55, 90], table_white_v: [8, 146, 100, 200], chair_front: [116, 146, 52, 56], chair_back: [176, 146, 52, 56], chair_side_l: [236, 146, 48, 52], chair_side_r: [292, 146, 48, 52], elevator: [8, 354, 150, 200], fridge_dark: [166, 354, 82, 170], plant_small: [256, 354, 40, 80], projector_right: [304, 354, 64, 52], projector_left: [376, 354, 64, 52], snack_chips_red: [512, 354, 24, 32], snack_chips_yellow: [544, 354, 24, 32], snack_chips_blue: [576, 354, 24, 32], snack_box: [608, 354, 30, 22], snack_candy: [646, 354, 20, 14] };
  const RM4 = { table_whitewood_left: [178, 8, 55, 90], table_whitewood_mid: [241, 8, 85, 90], table_whitewood_right: [334, 8, 55, 90] };
  const DESK = [8, 8, 220, 124];
  const CHAIR = [520, 0, 237, 372], CHAIR_W = 102, CHAIR_H = 135;
  const RT = 24, ROOM_DOOR = 120, ROOM_MARGIN = 130, B = 3, WH = 30;
  const tableW = m => 110 + 85 * m;
  const items = [], blocks = [];
  const add = (depth, draw) => items.push({ depth, draw });
  const block = (x, y, w, h) => blocks.push([x, y + OFFY, w, h]);
  let imgs = null; // { rooms, props, furn, desks, toiletPic }
  const spr = (c, name, x, y) => { const r = RM[name]; c.drawImage(imgs.rooms, r[0], r[1], r[2], r[3], Math.round(x), Math.round(y), r[2], r[3]); };
  const sprite = (name, x, y, depth) => add(depth, c => spr(c, name, x, y));
  const table = (kind, x, y, mids, depth) => add(depth, c => {
    const piece = (part, dx) => { const key = 'table_' + kind + '_' + part, r = RM[key] || RM4[key], im = RM[key] ? imgs.rooms : imgs.props; c.drawImage(im, r[0], r[1], r[2], r[3], Math.round(x + dx), Math.round(y), r[2], r[3]); };
    piece('left', 0); for (let i = 0; i < mids; i++) piece('mid', 55 + i * 85); piece('right', 55 + mids * 85);
  });
  const label = (text, x, y, w) => add(99999, c => {
    c.save(); c.font = '700 13px -apple-system,BlinkMacSystemFont,"PingFang TC","Noto Sans TC",sans-serif';
    const tw = Math.round(c.measureText(text).width) + 16, lx = Math.round(x + w / 2 - tw / 2);
    c.fillStyle = '#0c0c0c'; c.fillRect(lx - 2, y - 2, tw + 4, 24); c.fillStyle = '#2f3640'; c.fillRect(lx, y, tw, 20);
    c.fillStyle = '#fff'; c.textAlign = 'center'; c.textBaseline = 'middle'; c.fillText(text, x + w / 2, y + 10.5); c.restore();
  });
  const chairBig = (cx, y, depth) => add(depth, c => c.drawImage(imgs.furn, CHAIR[0], CHAIR[1], CHAIR[2], CHAIR[3], Math.round(cx - CHAIR_W / 2), Math.round(y), CHAIR_W, CHAIR_H));
  const deskBeige = (x, y, depth) => add(depth, c => c.drawImage(imgs.desks, DESK[0], DESK[1], DESK[2], DESK[3], Math.round(x), Math.round(y), DESK[2], DESK[3]));
  // 玻璃屋：牆頂＋後牆／前牆正面，3 px 黑外框；doors＝[{side:'t'|'b'|'l'|'r', c:門中心座標}]
  const glass = (x, y, w, h, doors) => {
    const d = ROOM_DOOR / 2, gap = side => doors.find(o => o.side === side);
    const seg = (x1, x2, g) => { if (!g) return [[x1, x2]]; const g0 = g.c - d, g1 = g.c + d, o = []; if (x1 < g0) o.push([x1, Math.min(x2, g0)]); if (x2 > g1) o.push([Math.max(x1, g1), x2]); return o; };
    for (const [a, b] of seg(x, x + w, gap('t'))) block(a, y, b - a, RT);
    for (const [a, b] of seg(x, x + w, gap('b'))) block(a, y + h - RT, b - a, RT);
    for (const [a, b] of seg(y + RT, y + h - RT, gap('l'))) block(x, a, RT, b - a);
    for (const [a, b] of seg(y + RT, y + h - RT, gap('r'))) block(x + w - RT, a, RT, b - a);
    add(-9000, c => {
      c.save(); c.imageSmoothingEnabled = false;
      c.fillStyle = 'rgba(186,222,234,.55)';
      for (const [a, b] of seg(x, x + w, gap('t'))) c.fillRect(a, y, b - a, RT);
      for (const [a, b] of seg(x, x + w, gap('b'))) c.fillRect(a, y + h - RT, b - a, RT);
      for (const [a, b] of seg(y + RT, y + h - RT, gap('l'))) c.fillRect(x, a, RT, b - a);
      for (const [a, b] of seg(y + RT, y + h - RT, gap('r'))) c.fillRect(x + w - RT, a, RT, b - a);
      c.fillStyle = 'rgba(186,222,234,.30)';
      for (const [a, b] of seg(x + RT, x + w - RT, gap('t'))) c.fillRect(a, y + RT, b - a, WH);
      for (const [a, b] of seg(x, x + w, gap('b'))) c.fillRect(a, y + h, b - a, WH);
      c.fillStyle = '#0c0c0c';
      const hl = (x1, x2, yy, g) => { for (const [a, b] of seg(x1, x2, g)) c.fillRect(a, yy, b - a, B); };
      const vl = (y1, y2, xx, g) => { for (const [a, b] of seg(y1, y2, g)) c.fillRect(xx, a, B, b - a); };
      hl(x, x + w, y, gap('t')); hl(x, x + w, y + h - B, gap('b')); vl(y, y + h, x, gap('l')); vl(y, y + h, x + w - B, gap('r'));
      hl(x + RT - B, x + w - RT + B, y + RT - B, gap('t')); hl(x + RT - B, x + w - RT + B, y + h - RT, gap('b')); vl(y + RT - B, y + h - RT + B, x + RT - B, gap('l')); vl(y + RT - B, y + h - RT + B, x + w - RT, gap('r'));
      hl(x + RT, x + w - RT, y + RT + WH - B, gap('t')); hl(x, x + w, y + h + WH - B, gap('b')); c.fillRect(x, y + h, B, WH); c.fillRect(x + w - B, y + h, B, WH);
      for (const o of doors) {
        if (o.side === 't' || o.side === 'b') { const yy = o.side === 't' ? y : y + h - RT; c.fillRect(o.c - d - B, yy, B, RT); c.fillRect(o.c + d, yy, B, RT); }
        else { const xx = o.side === 'l' ? x : x + w - RT; c.fillRect(xx, o.c - d - B, RT, B); c.fillRect(xx, o.c + d, RT, B); }
      }
      c.restore();
    });
  };
  // ---- 左上：電梯（保留，樓層顯示改 4F、上下箭頭都保留）
  const EX = TX0, EY = TY + T_H - 200; block(EX, EY + 70, 150, 130); sprite('elevator', EX, EY, EY + 200); label('4F 電梯 ↑↓', EX, EY + 208, 150);
  add(EY + 201, c => {
    c.fillStyle = '#1b2027'; c.fillRect(EX + 66, EY + 14, 18, 11); c.fillStyle = '#e7bd60';
    const G = { '4': ['...YY.', '..YYY.', '.YYYY.', 'YY.YY.', 'YY.YY.', 'YYYYYY', 'YYYYYY', '...YY.', '...YY.'], 'F': ['YYYYYY', 'YY....', 'YY....', 'YYYYY.', 'YY....', 'YY....', 'YY....', 'YY....', 'YY....'] };
    [['4', 67], ['F', 77]].forEach(([ch, gx]) => G[ch].forEach((row, j) => { for (let i = 0; i < row.length; i++) if (row[i] === 'Y') c.fillRect(EX + gx + i, EY + 15 + j, 1, 1); }));
  });
  // ---- 電梯與長桌之間：男廁、女廁（跟五樓同一套：玻璃屋＋廁所圖，門在下方）
  {
    const TW = T_W, TH = T_H;
    [['男廁', TX0 + 150 + CORR], ['女廁', TX0 + 150 + CORR + T_W - RT]].forEach(([name, rx]) => {
      glass(rx, TY, TW, TH, [{ side: 'b', c: rx + 262 }]);
      { const lx = rx + RT, y0 = TY + RT; block(lx + 12, y0 + 8, 44, 264); block(lx + 12, y0 + 8, 164, 44); block(lx + 12, y0 + 120, 164, 44); block(lx + 12, y0 + 236, 164, 36); block(lx + 14, y0 + 282, 67, 94); }
      add(-8990, c => { if (imgs.toiletPic.naturalWidth) { c.save(); c.imageSmoothingEnabled = true; c.drawImage(imgs.toiletPic, rx + RT, TY + RT, TW - 2 * RT, TH - 2 * RT); c.restore(); } });
      label(name, rx, TY - 22, TW);
    });
  }
  const WOOD = { tx: 0, ty: 0, tw: 0 };
  // ---- 右側：木長桌（10 人：上下各 5 張椅子）
  {
    const tx = TX0 + 150 + CORR + 2 * T_W - RT + CORR + RT + ROOM_MARGIN - 2 * 64, ty = TY + RT + ROOM_MARGIN + 2 * 64, tw = tableW(5); WOOD.tx = tx; WOOD.ty = ty; WOOD.tw = tw; table('wood', tx, ty, 5, ty + 70); block(tx, ty + 20, tw, 80); label('木長桌（10 人）', tx, ty - 90, tw);
    for (let k = 0; k < 5; k++) { const cx = tx + tw * (2 * k + 1) / 10; sprite('chair_front', cx - 26, ty - 46, ty - 1); sprite('chair_back', cx - 26, ty + 60, ty + 130); }
  }
  // ---- 茶水間（木長桌旁）
  {
    const tx = Math.round(WOOD.tx + WOOD.tw / 2 - 250), ty = WOOD.ty - 190 - 64, fx = tx + 300, fy = ty - 40; table('whitewood', tx, ty, 2, ty + 70); block(tx, ty + 20, tableW(2), 70); block(fx, fy + 60, 164, 110); label('茶水間', tx, ty - 60, tableW(2));
    [['snack_chips_red', 30], ['snack_chips_yellow', 66], ['snack_chips_blue', 102], ['snack_box', 150], ['snack_candy', 215]].forEach(([n, dx]) => { const r = RM[n]; sprite(n, tx + dx, ty + 58 - r[3], ty + 85); });
    sprite('fridge_dark', fx, fy, fy + 170); sprite('fridge_dark', fx + 82, fy, fy + 170); sprite('plant_small', fx + 190, fy + 90, fy + 170);
  }
  // ---- 左側：五個米白桌子群（每群上排 4 張、下排 4 張，椅子在最外側）
  const GX = 78, GY0 = TY + T_H + 136 + 64 + 67, GP = GPV - 64;/* 左緣 78、離廁所下緣 136（五樓：左側桌子群左緣 78、廁所下緣到第一排椅頭 136） */
  for (let g = 0; g < 5; g++) {
    const gy = GY0 + g * GP; block(GX, gy + 20, 880, 200);
    for (let k = 0; k < 4; k++) {
      const dx = GX + k * 220, cx = dx + 110;
      chairBig(cx, gy - 67, gy + 10);       // 上排椅子（在桌子後面；椅頭在桌上緣上方 67）
      deskBeige(dx, gy, gy + 100);          // 上排桌
      deskBeige(dx, gy + 94, gy + 200);     // 下排桌（接在上排正下方，蓋住上排桌腳）
      chairBig(cx, gy + 94 + 72, gy + 420); // 下排椅子（在桌子前面；椅頭在下排桌上緣下方 72）
    }
  }
  const HROOM = { x: 0, bottom: 0 };
  // ---- 右側：大會議室 H（玻璃，上下兩個出口；投影機往右；六張白桌排成「C」，一桌兩椅）
  {
    const rx = GX + 880 + CORR + 2 * 64, ry = GY0 - 67 - RT + 64, xL = rx + RT + 130, y0 = ry + RT + 150, rw = 2 * (RT + 40 + 2 * 220 + 40 + RT) + 60,/* 往右延伸到跟下方兩間玻璃辦公室（各 568，中間 60）的右緣切齊 */ rh = RT + 150 + 400 + 90 + RT;
    glass(rx, ry, rw, rh, [{ side: 't', c: rx + rw / 2 }, { side: 'b', c: rx + rw / 2 }]);
    block(xL + 100, y0, 390, 130); block(xL + 100, y0 + 270, 390, 130); block(xL, y0, 100, 400);
    const xC = xL + 100;
    for (const k of [0, 1]) {
      const tx = xC + k * 195; table('white', tx, y0, 1, y0 + 110); table('white', tx, y0 + 270, 1, y0 + 380);
      for (const f of [.25, .75]) { const cx = tx + 195 * f; sprite('chair_front', cx - 26, y0 - 46, y0 - 1); sprite('chair_back', cx - 26, y0 + 270 + 120, y0 + 270 + 170); }
    }
    for (const k of [0, 1]) { const ty = y0 + k * 200; add(ty + 180, c => spr(c, 'table_white_v', xL, ty)); for (const dy of [50, 150]) sprite('chair_side_r', xL - 40, ty + dy - 26, ty + dy + 26); }
    sprite('projector_right', xL + 18, y0 + 170, y0 + 230);
    label('會議室 H', rx, ry + rh + WH + 8, rw);
    HROOM.x = rx; HROOM.bottom = ry + rh;
  }
  // ---- 桌子群下方：會議室 F、G（同 B、C）＋右側兩間大玻璃屋（各六張桌椅）
  const BY = GY0 + 4 * GP + 166 + 135 + 114,/* 最後一群下排椅腳到 F 會議室 114（五樓：下排椅腳到 B 會議室 114） */ BC_MX = 70, BC_W = tableW(2) + 2 * BC_MX + 2 * RT, meetH = 130 + 2 * ROOM_MARGIN + 2 * RT;
  const small = (name, rx, ry) => {
    glass(rx, ry, BC_W, meetH, [{ side: 'r', c: ry + meetH / 2 }]);
    const tx = rx + RT + BC_MX, ty = ry + RT + ROOM_MARGIN, tw = tableW(2); table('black', tx, ty, 2, ty + 110); block(tx, ty, tw, 130); label(name, tx, ty + 55, tw);
    sprite('projector_left', tx + tw - 84, ty + 26, ty + 125);
    for (let k = 0; k < 2; k++) { const cx = tx + tw * (2 * k + 1) / 4; sprite('chair_front', cx - 26, ty - 46, ty - 1); sprite('chair_back', cx - 26, ty + 120, ty + 170); }
  };
  small('會議室 F', 60 + 64, BY); small('會議室 G', 60 + 64, BY + meetH + RT);
  // 玻璃辦公室（2026-10-26）：窄長、往下延伸；每間上下兩個座位群，每群 2×2 共四張桌（上排 2＋下排 2，跟桌子群同一種接法），椅子在最外側。
  const big = (name, rx, ry, doors) => {
    const GP2 = GPV - 64, rw = RT + 40 + 2 * 220 + 40 + RT, rh = RT + 90 + 67 + GP2 + 94 + 72 + 135 + 50 + RT;
    glass(rx, ry, rw, rh, doors(rx, ry, rw, rh));
    const dx0 = rx + RT + 40;
    for (let g = 0; g < 2; g++) {
      const gy = ry + RT + 90 + 67 + g * GP2; block(dx0, gy + 20, 440, 200);
      for (let k = 0; k < 2; k++) { const dx = dx0 + k * 220, cx = dx + 110; chairBig(cx, gy - 67, gy + 10); deskBeige(dx, gy, gy + 100); deskBeige(dx, gy + 94, gy + 200); chairBig(cx, gy + 94 + 72, gy + 420); }
    }
    return rw;
  };
  const oy1 = HROOM.bottom + WH + 70;
  const w1 = big('office1', HROOM.x, oy1, (rx, ry, rw, rh) => [{ side: 't', c: rx + rw / 2 }, { side: 'l', c: ry + rh / 2 }]);
  big('office2', HROOM.x + w1 + 60, oy1, (rx, ry, rw, rh) => [{ side: 't', c: rx + rw / 2 }, { side: 'r', c: ry + rh / 2 }]);

  const load = src => new Promise(res => { const i = new Image(); i.onload = () => res(i); i.onerror = () => res(i); i.src = src; });
  const scene = {
    W, H, blocks, OFFY,
    heroStart: { x: EX + 75, y: EY + 262 + OFFY, dir: 'down' }, TX0, CORR, GPV,
    elevator: { x0: EX + 10, x1: EX + 140, y0: EY + 200 + OFFY, y1: EY + 250 + OFFY },
    canvas: null, ready: false, onReady: null,
    draw(ctx) { if (scene.canvas) ctx.drawImage(scene.canvas, 0, 0); },
  };
  window.FLOOR4_SCENE = scene;
  Promise.all([load('assets/office-rooms-v3.webp?v=1'), load('assets/office-props-v4.webp?v=1'), load('assets/furniture-v5.webp?v=1'), load('assets/office-desks-v6.webp?v=1'), load('assets/office-toilet-v10.webp?v=1')]).then(([rooms, props, furn, desks, toiletPic]) => {
    imgs = { rooms, props, furn, desks, toiletPic };
    const cv = document.createElement('canvas'); cv.width = W; cv.height = H; const c = cv.getContext('2d');
    c.imageSmoothingEnabled = false; c.fillStyle = '#fff'; c.fillRect(0, 0, W, H); c.fillStyle = 'rgba(120,128,136,.16)';
    for (let x = 0; x < W; x += 64) c.fillRect(x, 0, 2, H);
    for (let y = 0; y < H; y += 64) c.fillRect(0, y, W, 2);
    c.translate(0, OFFY);
    items.slice().sort((a, b) => a.depth - b.depth).forEach(it => it.draw(c));
    scene.canvas = cv; scene.ready = true; if (scene.onReady) scene.onReady();
  });
})();

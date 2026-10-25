/* 四樓像素辦公室（2026-10-26，照使用者給的配置）：靜態場景，沒有人物。
 * 左上電梯；電梯右側 10 人木長桌；桌子旁茶水間。下方：左側五個米白桌子群（每群上下各一排、每排四張，共八張）、
 * 右側大會議室 H（上下兩個出口，投影機往右，六張白桌排成「C」，一桌兩椅）；桌子群下方會議室 F、G（同 B、C）；
 * 它們右側兩間大玻璃屋，各六張桌椅。素材全部沿用五樓的圖集。 */
(function () {
  const cv = document.getElementById('c'), ctx = cv.getContext('2d');
  const W = 2300, H = 3720; cv.width = W; cv.height = H;
  const fitScale = () => { cv.style.width = Math.round(W * Math.min(1.6, Math.max(.3, window.innerWidth * .96 / 1362))) + 'px'; cv.style.height = 'auto'; };
  fitScale(); window.addEventListener('resize', fitScale);
  const RM = { table_black_left: [8, 8, 55, 130], table_black_mid: [71, 8, 85, 130], table_black_right: [164, 8, 55, 130], table_white_left: [227, 8, 55, 130], table_white_mid: [290, 8, 85, 130], table_white_right: [383, 8, 55, 130], table_wood_left: [446, 8, 55, 90], table_wood_mid: [509, 8, 85, 90], table_wood_right: [602, 8, 55, 90], table_white_v: [8, 146, 100, 200], chair_front: [116, 146, 52, 56], chair_back: [176, 146, 52, 56], chair_side_l: [236, 146, 48, 52], chair_side_r: [292, 146, 48, 52], elevator: [8, 354, 150, 200], fridge_dark: [166, 354, 82, 170], plant_small: [256, 354, 40, 80], projector_right: [304, 354, 64, 52], projector_left: [376, 354, 64, 52], snack_chips_red: [512, 354, 24, 32], snack_chips_yellow: [544, 354, 24, 32], snack_chips_blue: [576, 354, 24, 32], snack_box: [608, 354, 30, 22], snack_candy: [646, 354, 20, 14] };
  const RM4 = { table_whitewood_left: [178, 8, 55, 90], table_whitewood_mid: [241, 8, 85, 90], table_whitewood_right: [334, 8, 55, 90] };
  const DESK = [8, 8, 220, 124];
  const CHAIR = [520, 0, 237, 372], CHAIR_W = 102, CHAIR_H = 135;
  const RT = 24, ROOM_DOOR = 120, ROOM_MARGIN = 130, B = 3, WH = 30;
  const tableW = m => 110 + 85 * m;
  const img = src => new Promise(res => { const i = new Image(); i.onload = () => res(i); i.onerror = () => res(i); i.src = src; });
  Promise.all([img('assets/office-rooms-v3.webp?v=1'), img('assets/office-props-v4.webp?v=1'), img('assets/furniture-v5.webp?v=1'), img('assets/office-desks-v6.webp?v=1'), img('assets/office-toilet-v10.webp?v=1')]).then(([rooms, props, furn, desks, toiletPic]) => {
    ctx.imageSmoothingEnabled = false;
    const items = [];
    const add = (depth, draw) => items.push({ depth, draw });
    const spr = (name, x, y) => { const r = RM[name]; ctx.drawImage(rooms, r[0], r[1], r[2], r[3], Math.round(x), Math.round(y), r[2], r[3]); };
    const sprite = (name, x, y, depth) => add(depth, () => spr(name, x, y));
    const table = (kind, x, y, mids, depth) => add(depth, () => {
      const piece = (part, dx) => { const key = 'table_' + kind + '_' + part, r = RM[key] || RM4[key], im = RM[key] ? rooms : props; ctx.drawImage(im, r[0], r[1], r[2], r[3], Math.round(x + dx), Math.round(y), r[2], r[3]); };
      piece('left', 0); for (let i = 0; i < mids; i++) piece('mid', 55 + i * 85); piece('right', 55 + mids * 85);
    });
    const label = (text, x, y, w) => add(99999, () => {
      ctx.save(); ctx.font = '700 13px -apple-system,BlinkMacSystemFont,"PingFang TC","Noto Sans TC",sans-serif';
      const tw = Math.round(ctx.measureText(text).width) + 16, lx = Math.round(x + w / 2 - tw / 2);
      ctx.fillStyle = '#0c0c0c'; ctx.fillRect(lx - 2, y - 2, tw + 4, 24); ctx.fillStyle = '#2f3640'; ctx.fillRect(lx, y, tw, 20);
      ctx.fillStyle = '#fff'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.fillText(text, x + w / 2, y + 10.5); ctx.restore();
    });
    const chairBig = (cx, y, depth) => add(depth, () => ctx.drawImage(furn, CHAIR[0], CHAIR[1], CHAIR[2], CHAIR[3], Math.round(cx - CHAIR_W / 2), Math.round(y), CHAIR_W, CHAIR_H));
    const deskBeige = (x, y, depth) => add(depth, () => ctx.drawImage(desks, DESK[0], DESK[1], DESK[2], DESK[3], Math.round(x), Math.round(y), DESK[2], DESK[3]));
    // 地板：白底＋64 px 淡灰格線
    ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, W, H); ctx.fillStyle = 'rgba(120,128,136,.16)';
    for (let x = 0; x < W; x += 64) ctx.fillRect(x, 0, 2, H);
    for (let y = 0; y < H; y += 64) ctx.fillRect(0, y, W, 2);
    // 玻璃屋：牆頂＋後牆／前牆正面，3 px 黑外框；doors＝[{side:'t'|'b'|'l'|'r', c:門中心座標}]
    const glass = (x, y, w, h, doors) => add(-9000, () => {
      const d = ROOM_DOOR / 2, gap = side => doors.find(o => o.side === side);
      const seg = (x1, x2, g) => { if (!g) return [[x1, x2]]; const g0 = g.c - d, g1 = g.c + d, o = []; if (x1 < g0) o.push([x1, Math.min(x2, g0)]); if (x2 > g1) o.push([Math.max(x1, g1), x2]); return o; };
      ctx.save(); ctx.imageSmoothingEnabled = false;
      ctx.fillStyle = 'rgba(186,222,234,.55)';
      for (const [a, b] of seg(x, x + w, gap('t'))) ctx.fillRect(a, y, b - a, RT);
      for (const [a, b] of seg(x, x + w, gap('b'))) ctx.fillRect(a, y + h - RT, b - a, RT);
      for (const [a, b] of seg(y + RT, y + h - RT, gap('l'))) ctx.fillRect(x, a, RT, b - a);
      for (const [a, b] of seg(y + RT, y + h - RT, gap('r'))) ctx.fillRect(x + w - RT, a, RT, b - a);
      ctx.fillStyle = 'rgba(186,222,234,.30)';
      for (const [a, b] of seg(x + RT, x + w - RT, gap('t'))) ctx.fillRect(a, y + RT, b - a, WH);
      for (const [a, b] of seg(x, x + w, gap('b'))) ctx.fillRect(a, y + h, b - a, WH);
      ctx.fillStyle = '#0c0c0c';
      const hl = (x1, x2, yy, g) => { for (const [a, b] of seg(x1, x2, g)) ctx.fillRect(a, yy, b - a, B); };
      const vl = (y1, y2, xx, g) => { for (const [a, b] of seg(y1, y2, g)) ctx.fillRect(xx, a, B, b - a); };
      hl(x, x + w, y, gap('t')); hl(x, x + w, y + h - B, gap('b')); vl(y, y + h, x, gap('l')); vl(y, y + h, x + w - B, gap('r'));
      hl(x + RT - B, x + w - RT + B, y + RT - B, gap('t')); hl(x + RT - B, x + w - RT + B, y + h - RT, gap('b')); vl(y + RT - B, y + h - RT + B, x + RT - B, gap('l')); vl(y + RT - B, y + h - RT + B, x + w - RT, gap('r'));
      hl(x + RT, x + w - RT, y + RT + WH - B, gap('t')); hl(x, x + w, y + h + WH - B, gap('b')); ctx.fillRect(x, y + h, B, WH); ctx.fillRect(x + w - B, y + h, B, WH);
      for (const o of doors) {
        if (o.side === 't' || o.side === 'b') { const yy = o.side === 't' ? y : y + h - RT; ctx.fillRect(o.c - d - B, yy, B, RT); ctx.fillRect(o.c + d, yy, B, RT); }
        else { const xx = o.side === 'l' ? x : x + w - RT; ctx.fillRect(xx, o.c - d - B, RT, B); ctx.fillRect(xx, o.c + d, RT, B); }
      }
      ctx.restore();
    });
    // ---- 左上：電梯（保留，樓層顯示改 4F、上下箭頭都保留）
    const EX = 40, EY = 40; sprite('elevator', EX, EY, EY + 200); label('4F 電梯 ↑↓', EX, EY + 208, 150);
    add(EY + 201, () => {
      ctx.fillStyle = '#1b2027'; ctx.fillRect(EX + 66, EY + 14, 18, 11); ctx.fillStyle = '#e7bd60';
      const G = { '4': ['...YY.', '..YYY.', '.YYYY.', 'YY.YY.', 'YY.YY.', 'YYYYYY', 'YYYYYY', '...YY.', '...YY.'], 'F': ['YYYYYY', 'YY....', 'YY....', 'YYYYY.', 'YY....', 'YY....', 'YY....', 'YY....', 'YY....'] };
      [['4', 67], ['F', 77]].forEach(([ch, gx]) => G[ch].forEach((row, j) => { for (let i = 0; i < row.length; i++) if (row[i] === 'Y') ctx.fillRect(EX + gx + i, EY + 15 + j, 1, 1); }));
    });
    // ---- 電梯與長桌之間：男廁、女廁（跟五樓同一套：玻璃屋＋廁所圖，門在下方）
    {
      const TW = 346, TH = 438, TY = 40;
      [['男廁', 250], ['女廁', 250 + TW - RT]].forEach(([name, rx]) => {
        glass(rx, TY, TW, TH, [{ side: 'b', c: rx + 262 }]);
        add(-8990, () => { if (toiletPic.naturalWidth) { ctx.save(); ctx.imageSmoothingEnabled = true; ctx.drawImage(toiletPic, rx + RT, TY + RT, TW - 2 * RT, TH - 2 * RT); ctx.restore(); } });
        label(name, rx, TY - 22, TW);
      });
    }
    // ---- 右側：木長桌（10 人：上下各 5 張椅子）
    {
      const tx = 1000, ty = 130, tw = tableW(5); table('wood', tx, ty, 5, ty + 70); label('木長桌（10 人）', tx, ty - 90, tw);
      for (let k = 0; k < 5; k++) { const cx = tx + tw * (2 * k + 1) / 10; sprite('chair_front', cx - 26, ty - 46, ty - 1); sprite('chair_back', cx - 26, ty + 60, ty + 130); }
    }
    // ---- 茶水間（木長桌旁）
    {
      const tx = 1000 + tableW(5) + 110, ty = 130, fx = tx + 300, fy = ty - 40; table('whitewood', tx, ty, 2, ty + 70); label('茶水間', tx, ty - 60, tableW(2));
      [['snack_chips_red', 30], ['snack_chips_yellow', 66], ['snack_chips_blue', 102], ['snack_box', 150], ['snack_candy', 215]].forEach(([n, dx]) => { const r = RM[n]; sprite(n, tx + dx, ty + 58 - r[3], ty + 85); });
      sprite('fridge_dark', fx, fy, fy + 170); sprite('fridge_dark', fx + 82, fy, fy + 170); sprite('plant_small', fx + 190, fy + 90, fy + 170);
    }
    // ---- 左側：五個米白桌子群（每群上排 4 張、下排 4 張，椅子在最外側）
    const GX = 40, GY0 = 600, GP = 470;
    for (let g = 0; g < 5; g++) {
      const gy = GY0 + g * GP;
      for (let k = 0; k < 4; k++) {
        const dx = GX + k * 220, cx = dx + 110;
        chairBig(cx, gy - 70, gy + 10);       // 上排椅子（在桌子後面）
        deskBeige(dx, gy, gy + 100);          // 上排桌
        deskBeige(dx, gy + 94, gy + 200);     // 下排桌（接在上排正下方，蓋住上排桌腳）
        chairBig(cx, gy + 190, gy + 420);     // 下排椅子（在桌子前面）
      }
    }
    // ---- 右側：大會議室 H（玻璃，上下兩個出口；投影機往右；六張白桌排成「C」，一桌兩椅）
    {
      const rx = 1000, ry = GY0 - 70, xL = rx + RT + 130, y0 = ry + RT + 150, rw = RT + 130 + 100 + 2 * 195 + 130 + RT, rh = RT + 150 + 400 + 90 + RT;
      glass(rx, ry, rw, rh, [{ side: 't', c: rx + rw / 2 }, { side: 'b', c: rx + rw / 2 }]);
      const xC = xL + 100;
      for (const k of [0, 1]) {
        const tx = xC + k * 195; table('white', tx, y0, 1, y0 + 110); table('white', tx, y0 + 270, 1, y0 + 380);
        for (const f of [.25, .75]) { const cx = tx + 195 * f; sprite('chair_front', cx - 26, y0 - 46, y0 - 1); sprite('chair_back', cx - 26, y0 + 270 + 120, y0 + 270 + 170); }
      }
      for (const k of [0, 1]) { const ty = y0 + k * 200; add(ty + 180, () => spr('table_white_v', xL, ty)); for (const dy of [50, 150]) sprite('chair_side_r', xL - 40, ty + dy - 26, ty + dy + 26); }
      sprite('projector_right', xL + 18, y0 + 170, y0 + 230);
      label('會議室 H', rx, ry + rh + WH + 8, rw);
    }
    // ---- 桌子群下方：會議室 F、G（同 B、C）＋右側兩間大玻璃屋（各六張桌椅）
    const BY = GY0 + 5 * GP + 40, BC_MX = 70, BC_W = tableW(2) + 2 * BC_MX + 2 * RT, meetH = 130 + 2 * ROOM_MARGIN + 2 * RT;
    const small = (name, rx, ry) => {
      glass(rx, ry, BC_W, meetH, [{ side: 'r', c: ry + meetH / 2 }]);
      const tx = rx + RT + BC_MX, ty = ry + RT + ROOM_MARGIN, tw = tableW(2); table('black', tx, ty, 2, ty + 110); label(name, tx, ty + 55, tw);
      sprite('projector_left', tx + tw - 84, ty + 26, ty + 125);
      for (let k = 0; k < 2; k++) { const cx = tx + tw * (2 * k + 1) / 4; sprite('chair_front', cx - 26, ty - 46, ty - 1); sprite('chair_back', cx - 26, ty + 120, ty + 170); }
    };
    small('會議室 F', 40, BY); small('會議室 G', 40, BY + meetH + RT);
    const big = (name, rx, ry) => {
      const rw = RT + 40 + 3 * 220 + 40 + RT, rh = RT + 130 + 2 * 124 + 190 + 60 + RT;
      glass(rx, ry, rw, rh, [{ side: 't', c: rx + rw / 2 }, { side: 'l', c: ry + rh / 2 }]);
      const dx0 = rx + RT + 40, dy0 = ry + RT + 130;
      for (let k = 0; k < 3; k++) { const dx = dx0 + k * 220, cx = dx + 110; chairBig(cx, dy0 - 70, dy0 + 10); deskBeige(dx, dy0, dy0 + 100); deskBeige(dx, dy0 + 94, dy0 + 200); chairBig(cx, dy0 + 190, dy0 + 420); }
      label(name, rx, ry + rh + WH + 8, rw); return rw;
    };
    const bx = 40 + BC_W + 60; const w1 = big('玻璃辦公室 1', bx, BY); big('玻璃辦公室 2', bx + w1 + 60, BY);
    items.sort((a, b) => a.depth - b.depth).forEach(it => it.draw());
    cv.addEventListener('click', e => {
      const r = cv.getBoundingClientRect(), sx = W / r.width, x = (e.clientX - r.left) * sx, y = (e.clientY - r.top) * sx;
      if (x >= EX && x <= EX + 150 && y >= EY && y <= EY + 240) { try { window.parent.postMessage({ type: 'pixelOfficeFloor', floor: 5 }, location.origin); } catch (err) { /* 單獨開啟就不做事 */ } }
    });
    cv.style.cursor = 'default';
    window.__floor4Ready = true;
  });
})();

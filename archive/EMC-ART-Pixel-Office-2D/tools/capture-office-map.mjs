// 開發工具：把「真實辦公室場景」（沒有人物、沒有名牌）擷取成躲貓貓用的地圖底圖，並輸出碰撞／視線資料。
// 用法：先啟動本機網站（node server.cjs），再執行
//   node tools/capture-office-map.mjs [輸出資料夾]
// 輸出：office-map-source.png（1:1 原尺寸）與 office-map-data.json（家具、牆、門、高家具的座標，皆為畫面座標）。
// 辦公室版面更新後重跑即可；遊戲只讀產物，不會在執行時碰原本的場景。
import puppeteer from 'puppeteer-core';
import fs from 'node:fs';
import path from 'node:path';

const out = path.resolve(process.argv[2] || 'design/office-map');
fs.mkdirSync(out, { recursive: true });
const chromes = [process.env.CHROME_PATH, 'C:/Program Files/Google/Chrome/Application/chrome.exe', 'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe', '/usr/bin/google-chrome'].filter(Boolean);
const executablePath = chromes.find(p => fs.existsSync(p));
if (!executablePath) throw new Error('找不到 Chrome，請設定 CHROME_PATH');

const browser = await puppeteer.launch({ executablePath, headless: true, args: ['--no-sandbox', '--disable-gpu'] });
const page = await browser.newPage();
await page.setViewport({ width: 2400, height: 3400, deviceScaleFactor: 1 });
await page.goto('http://localhost:8787/?full=1', { waitUntil: 'networkidle0', timeout: 60000 });
await page.waitForFunction('typeof ready!=="undefined"&&ready&&roomsReady()&&desksReady()&&exReady()&&props8Img.complete&&toilet6Img.complete', { timeout: 30000 });

const data = await page.evaluate(async () => {
  // 去掉人物、名牌、狀態圖示；讓每張桌子都是「有人在座」的樣子（有椅子與電腦）
  const noop = () => {};
  for (const n of ['drawPerson', 'drawDeskPlate', 'drawOverlay', 'drawStatusMarker', 'drawOvertimeBadge', 'drawPunishBadge', 'drawActionLabel', 'drawHeadphones', 'drawBubble', 'drawStoryBubble', 'drawGhost', 'drawGhostWalker', 'drawLongDeskGhost']) { try { globalThis[n] = noop; } catch { /* 不存在就略過 */ } }
  globalThis.stationDimmed = () => false;
  document.documentElement.classList.remove('clean');
  markDirty();
  await new Promise(r => setTimeout(r, 1500));
  markDirty();
  await new Promise(r => setTimeout(r, 1500));
  // 記下 drawProp 這次畫了哪些書櫃／方柱／紅箱（位置由程式依桌組算出，這裡直接量）
  const propCalls = [];
  const origProp = globalThis.drawProp;
  globalThis.drawProp = (name, x, w, h, band, dimmed) => {
    if (P8[name]) { const r = RM8[P8[name]], py = Math.round(bandFeet() - band * GPV - r[3]); propCalls.push({ name, x: Math.round(w > r[2] ? x : x + (w - r[2]) / 2), y: py, w: w > r[2] ? Math.round(w) : r[2], h: r[3] }); }
    else propCalls.push({ name, x: Math.round(x), y: Math.round(bandFeet() - band * GPV - h), w: Math.round(w), h: Math.round(h) });
    return origProp(name, x, w, h, band, dimmed);
  };
  markDirty();
  await new Promise(r => setTimeout(r, 800));
  const rect = r => ({ x: Math.round(r[0]), y: Math.round(r[1]), w: Math.round(r[2]), h: Math.round(r[3]) });
  const toView = r => { const t = viewY(r[1]), b = viewY(r[1] + r[3]); return rect([r[0], t, r[2], b - t]); };
  return {
    canvas: { w: game.width, h: game.height, W, H, OY, cssW: game.getBoundingClientRect().width, cssH: game.getBoundingClientRect().height },
    rooms: ROOMS.map(r => ({ name: r[0], x: r[1], y: r[2], w: r[3], h: r[4], door: r[5], doorAt: r[6] })),
    roomWalls: roomWallList.map(rect), roomCorners: roomCornerList.map(([x, y]) => rect([x, y, RT, RT])),
    items: roomItems.map(it => ({ kind: it[0], x: Math.round(it[1]), y: Math.round(it[2]), w: it[3], h: it[4], depth: Math.round(it[5]), solid: !!it[6], name: (it[7] && (it[7].name || it[7].kind || it[7].text)) || '' })),
    deskWalls: walls0.map(toView),
    allWalls: walls.map(toView),
    propCalls: [...new Map(propCalls.map(p => [JSON.stringify(p), p])).values()],
    stations: stations.map(s => ({ x: Math.round(s.x), y: Math.round(viewY(s.y)), row: s.row || 0, big: !!s.big, beige: !!s.beige })),
    props: { bandFeet: bandFeet(), GPV, DL: typeof DL === 'undefined' ? null : DL, DR: typeof DR === 'undefined' ? null : DR },
    bounds: { minX: 65, maxX: W - 65, minY: Math.round(viewY(ROOM_MIN_Y)), maxY: Math.round(viewY(ROOM_MAX_Y)) }
  };
});

const png = await page.evaluate(() => game.toDataURL('image/png'));
fs.writeFileSync(path.join(out, 'office-map-source.png'), Buffer.from(png.split(',')[1], 'base64'));
const half = await page.evaluate(() => { const c = document.createElement('canvas'); c.width = Math.round(game.width / 2); c.height = Math.round(game.height / 2); const g = c.getContext('2d'); g.imageSmoothingEnabled = true; g.imageSmoothingQuality = 'high'; g.drawImage(game, 0, 0, c.width, c.height); return c.toDataURL('image/webp', 0.92); });
fs.writeFileSync(path.join(out, 'office-map-half.webp'), Buffer.from(half.split(',')[1], 'base64'));
fs.writeFileSync(path.join(out, 'office-map-data.json'), JSON.stringify(data, null, 1));
console.log('輸出到', out, '畫布', data.canvas.w + '×' + data.canvas.h, '房間', data.rooms.length, '家具', data.items.length, '桌牆', data.deskWalls.length);
await browser.close();

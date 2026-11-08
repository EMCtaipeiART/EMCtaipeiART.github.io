/* 辦公室劇場（?cinema=1）：服裝頁開場用。
 * 讓 3D 辦公室裡的真實同事演出有「分鏡、有腳本」的短劇：鏡頭推軌／跟拍／切換、字幕、幕名卡、黑邊。
 * 只接手幾位演員（其他人照常依出勤狀態出現在背景），不寫入任何資料。接點在 index.html 的 tick()（window.__cinema）。
 * 座標用 2D 版辦公室的 px（乘 U 變 3D 世界座標）；走路用遊戲自己的 findPath／moveChar，所以不會穿牆。 */
(() => {
const api = window.__cineApi;
if (!api) return;
const { THREE, camera, chars, U, blocked, findPath, moveChar, standUp, sun } = api;
const V = (x, y, z) => new THREE.Vector3(x, y, z);
const P = (x, z) => V(x * U, 0, z * U);                 // px → 世界座標（地面）
const params = new URLSearchParams(location.search);
const HERO = ['Machi', 'Anna', 'Amber', 'Leona', 'Noise'].includes(params.get('hero')) ? '' : (params.get('hero') || '');   // 設計部五位本來就是主角；其他人（企劃、專案同事）才演最後那位新同事                   // 服裝頁傳進來的「你」：新同事那一幕由你的角色演
const ACT_RANGE = params.has('act') && params.get('act') !== '' ? params.get('act').split('-').map(Number).filter(n => !Number.isNaN(n)) : [];   // 測試用：act=5 只演第 6 幕、act=5-6 演第 6～7 幕
const ONLY_ACT = ACT_RANGE.length ? ACT_RANGE[0] : -1;

const cin = window.__cinema = { active: false, cast: new Set(), t: 0, timeScale: 1, stepChar: null, camera: null };

// ---------- 畫面：黑邊、字幕、幕名卡、淡入淡出 ----------
const css = document.createElement('style');
css.textContent = `
#cin{position:fixed;inset:0;z-index:30;pointer-events:none;font-family:'Fredoka','Noto Sans TC',system-ui,sans-serif;overflow:hidden}
#cin .bar{position:absolute;left:0;right:0;height:0;background:#000;transition:height 1.1s ease}
#cin .bar.t{top:0}#cin .bar.b{bottom:0}
#cin.on .bar{height:9.5%}
#cin .sub{position:absolute;left:50%;bottom:12%;transform:translateX(-50%);max-width:84%;text-align:center;color:#fff;font-weight:700;font-size:clamp(13px,2.1vw,22px);line-height:1.5;padding:5px 16px;border-radius:8px;background:rgba(0,0,0,.58);text-shadow:0 1px 2px #000;opacity:0;transition:opacity .25s}
#cin .sub.on{opacity:1}
#cin .sub b{margin-right:8px;font-weight:800}
#cin .card{position:absolute;inset:0;display:grid;place-content:center;text-align:center;color:#fff;opacity:0;transition:opacity .5s;text-shadow:0 2px 12px rgba(0,0,0,.7)}
#cin .card.on{opacity:1}
#cin .card small{display:block;letter-spacing:.5em;font-size:clamp(10px,1.4vw,15px);opacity:.85;margin-bottom:.6em}
#cin .card h1{margin:0;font-size:clamp(22px,4.6vw,52px);font-weight:900;letter-spacing:.08em}
#cin .fade{position:absolute;inset:0;background:#000;opacity:1;transition:opacity .7s}
#cin .fade.off{opacity:0}
#cin .clk{position:absolute;left:3%;top:12%;color:#fff;font-size:clamp(12px,1.6vw,18px);font-weight:800;letter-spacing:.12em;background:rgba(0,0,0,.5);padding:3px 12px;border-radius:999px;opacity:0;transition:opacity .4s}
#cin .cap{position:absolute;right:3%;top:12%;color:#fff;font-size:12px;font-weight:800;letter-spacing:.2em;background:rgba(0,0,0,.45);padding:3px 10px;border-radius:999px}
`;
document.head.appendChild(css);
const root = document.createElement('div'); root.id = 'cin';
root.innerHTML = '<div class="bar t"></div><div class="bar b"></div><div class="sub"></div><div class="card"><small></small><h1></h1></div><div class="cap"></div><div class="clk"></div><div class="fade"></div>';
document.body.appendChild(root);
const $s = sel => root.querySelector(sel);
const sub = $s('.sub'), card = $s('.card'), fade = $s('.fade'), cap = $s('.cap'), clk = $s('.clk');
const COLORS = { Machi: '#7be08a', Anna: '#ff9cc0', Amber: '#ffc864', Leona: '#b7a2ff', Noise: '#7cc4ff' };
let subTimer = 0;
// 一句一句的台詞：可以被「下一句」跳過；沒有台詞在演時，按下去就先快轉到下一句出現
let curLine = null, boosted = 0, lastSpk = null;
const lineWait = sec => {
  if (boosted) { cin.timeScale = boosted; boosted = 0; }
  return new Promise(res => { const w = { at: cin.t + sec, res }; waiters.push(w); curLine = w; });
};
cin.skip = () => {
  if (curLine && waiters.includes(curLine)) { curLine.at = cin.t; return; }
  if (!boosted) { boosted = cin.timeScale; cin.timeScale = boosted * 6; }
};
window.addEventListener('message', e => { if (e.source === window.parent && e.data && e.data.type === 'cinemaSkip') cin.skip(); });
const spkName = who => actor[who] ? who : (who === (HERO || '新同事') && actor.newcomer ? actor.newcomer.name : null);
const faceTo = (n, o) => { const c = actor[n], p = c.holder.position, q = actor[o].holder.position; if (c.sitting) c.face = Math.atan2(q.x - p.x, q.z - p.z); else lookAtActor(n, o); };
const faceEach = (x, y) => { faceTo(x, y); faceTo(y, x); };
const say = (who, text, sec = 2.4) => {
  sub.innerHTML = `<b style="color:${COLORS[who] || '#ffe082'}">${who}</b>${text}`; sub.classList.add('on');
  clearTimeout(subTimer);
  const sn = spkName(who);   // 對話時兩個人面對面：說話的人轉向上一個說話的人，對方也轉過來
  if (sn) { if (lastSpk && lastSpk !== sn && actor[lastSpk]) { faceEach(sn, lastSpk); } lastSpk = sn; }
  return lineWait(sec).then(() => { sub.classList.remove('on'); return wait(0.25); });
};
const caption = text => { cap.textContent = text; cap.style.display = text ? '' : 'none'; };
const showCard = async (small, title, sec = 2.4) => { card.querySelector('small').textContent = small; card.querySelector('h1').textContent = title; card.classList.add('on'); await wait(sec); card.classList.remove('on'); await wait(0.5); };
const fadeOut = async () => { fade.classList.remove('off'); await wait(0.8); };
const fadeIn = async () => { fade.classList.add('off'); await wait(0.5); };

// ---------- 時間：全部用「模擬時間」，慢的電腦也不會讓劇情錯位 ----------
const waiters = [];
function wait(sec) { return new Promise(res => waiters.push({ at: cin.t + sec, res })); }

// ---------- 演員：走路、坐下、看向、跳一下 ----------
const free = (x, z) => {   // 找離 (x,z) 最近、沒被家具擋住的地面點（px）
  if (!blocked(x * U, z * U)) return P(x, z);
  for (let r = 16; r <= 240; r += 16) for (let a = 0; a < 16; a++) { const px = x + Math.cos(a * Math.PI / 8) * r, pz = z + Math.sin(a * Math.PI / 8) * r; if (!blocked(px * U, pz * U)) return P(px, pz); }
  return P(x, z);
};
const actor = {};
function stepChar(c, dt) {
  const s = c.cin; c.wander = false; c.remote = false;
  if (s.path.length && c.sitting) standUp(c);
  if (!c.holder.visible) c.holder.visible = true;
  if (s.path.length && !c.sitting) {
    const wp = s.path[0], p = c.holder.position, dx = wp.x - p.x, dz = wp.z - p.z, d = Math.hypot(dx, dz);
    if (d < (s.path.length > 1 ? 0.3 : 0.18)) { s.path.shift(); if (!s.path.length) { c.moving = 0; const r = s.done; s.done = null; if (r) r(); } }
    else {
      moveChar(c, V(dx, 0, dz), s.speed, dt);
      if (performance.now() - s.stuck.t > 1200) { const m = Math.hypot(p.x - s.stuck.x, p.z - s.stuck.z); s.stuck = { t: performance.now(), x: p.x, z: p.z }; if (m < 0.12 && s.goal) s.path = findPath(p, s.goal, 5); }
    }
  } else if (!s.path.length) { c.moving = 0; if (s.look && !c.sitting) { c.face = Math.atan2(s.look.x - c.holder.position.x, s.look.z - c.holder.position.z); } }
}
cin.stepChar = (c, dt) => { let d = dt * cin.timeScale; while (d > 1e-4) { const s = Math.min(d, 0.04); stepChar(c, s); d -= s; } };   // 小步前進：測試時加速、或畫面卡頓時，也不會一步跨過轉角卡牆
// 新同事站在 Machi 旁邊「隔開一步」的位置，不要貼在一起
const standBeside = () => { const m = pos('Machi'); const f = free(m.x / U + 115, m.z / U + 100); return [f.x / U, f.z / U]; };
const duoShot = (dur, fov = 34) => { const m = pos('Machi'), n = pos(actor.newcomer.name), cx = (m.x + n.x) / 2, cz = (m.z + n.z) / 2; return shot(V(cx + 1.2, 2.5, cz + 6.8), V(cx, 1.3, cz), dur, fov); };
const walk = (name, x, z, run = false) => new Promise(res => {
  const c = actor[name]; if (c.sitting) standUp(c);
  const goal = free(x, z); c.cin.goal = goal; c.cin.look = null; c.cin.speed = run ? 5.2 : 2.6;
  c.cin.path = findPath(c.holder.position, goal, 5); c.cin.stuck = { t: performance.now(), x: c.holder.position.x, z: c.holder.position.z };
  if (!c.cin.path.length) { res(); return; }
  c.cin.done = res;
});
const lookAt = (name, x, z) => { const c = actor[name]; c.cin.look = P(x, z); };
const lookAtActor = (name, other) => { const o = actor[other].holder.position; actor[name].cin.look = V(o.x, 0, o.z); };
const hop = name => { actor[name].hopAt = performance.now(); };
const sitHome = name => { const c = actor[name], h = c.cin.home; if (c.sitting) return; c.holder.position.set(h.x, 0, h.z); c.cin.path = []; c.cin.look = null; api.sitAt(c, { x: h.x, z: h.z }); };
const pos = name => actor[name].holder.position;
cin.dbg = () => { const o = {}; for (const n of ["Machi", "Anna", "Amber", "Leona", "Noise"]) o[n] = [Math.round(pos(n).x / U), Math.round(pos(n).z / U), actor[n].sitting ? 1 : 0]; o.newcomer = [actor.newcomer.name, Math.round(pos(actor.newcomer.name).x / U), Math.round(pos(actor.newcomer.name).z / U)]; return o; };

// ---------- 鏡頭 ----------
const cam = { p: V(18, 14, 40), l: V(18, 0, 22), fov: 45, tw: null, follow: null, shake: 0 };
const ease = t => t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2;
const shot = (p, l, dur = 0, fov = 45) => new Promise(res => {   // 推軌到新的位置；dur=0 就是直接切
  cam.follow = null;
  if (dur <= 0) { cam.p.copy(p); cam.l.copy(l); cam.fov = fov; cam.tw = null; res(); return; }
  cam.tw = { p0: cam.p.clone(), l0: cam.l.clone(), f0: cam.fov, p1: p.clone(), l1: l.clone(), f1: fov, t: 0, dur, res };
});
const follow = (name, dx, dy, dz, fov = 45, lookY = 1.1) => { cam.tw = null; cam.follow = { name, off: V(dx, dy, dz), lookY }; cam.fov = fov; };
cin.camera = dt => {
  dt *= cin.timeScale;
  cin.t += dt;
  for (let i = waiters.length - 1; i >= 0; i--) if (waiters[i].at <= cin.t) { const w = waiters.splice(i, 1)[0]; w.res(); }
  if (cam.tw) {
    const w = cam.tw; w.t += dt; const k = ease(Math.min(1, w.t / w.dur));
    cam.p.lerpVectors(w.p0, w.p1, k); cam.l.lerpVectors(w.l0, w.l1, k); cam.fov = w.f0 + (w.f1 - w.f0) * k;
    if (w.t >= w.dur) { cam.tw = null; w.res(); }
  } else if (cam.follow) {
    const c = actor[cam.follow.name].holder.position, f = cam.follow, k = 1 - Math.pow(0.02, dt);
    cam.p.lerp(V(c.x + f.off.x, f.off.y, c.z + f.off.z), k); cam.l.lerp(V(c.x, f.lookY, c.z), k);
  }
  camera.position.copy(cam.p);
  if (cam.shake > 0) { cam.shake = Math.max(0, cam.shake - dt); camera.position.x += (Math.random() - 0.5) * 0.12; camera.position.y += (Math.random() - 0.5) * 0.12; }
  camera.lookAt(cam.l);
  if (Math.abs(camera.fov - cam.fov) > 0.01) { camera.fov = cam.fov; camera.updateProjectionMatrix(); }
  api.setYaw(Math.atan2(camera.position.x - cam.l.x, camera.position.z - cam.l.z));   // 人物（看板）面向鏡頭的方向
  if (cin.tickMarker) cin.tickMarker();
  sun.target.position.set(cam.l.x, 0, cam.l.z); sun.position.set(cam.l.x - 10, 26, cam.l.z + 10);
};

// ---------- 劇本與分鏡 ----------
// 演員：設計部五位（真實同事）＋ 企劃同事來串場 ＋「新同事」（你的角色；沒登入或還沒有角色就由另一位同事代演）。座位照遊戲裡原本坐的位置。
const CAST = ['Machi', 'Anna', 'Amber', 'Leona', 'Noise'];
const TEA = [440, 1190], FRIDGE = [545, 1200], MEET = [846, 1330], ELEV = [201, 235];
Object.assign(COLORS, { '余采馨': '#ffb4a2', '吳冠賢': '#ffb4a2', '謝榕': '#9be7d8', '傅思凱': '#9be7d8' });
const cta = on => { try { if (window.parent !== window) window.parent.postMessage({ type: 'cinemaCta', on }, '*'); } catch (e) { /* 外層不收就算了 */ } };

// 「你的位置」：地上一圈綠光＋會上下跳的箭頭＋浮空的字
const marker = (() => {
  const g = new THREE.Group(), mat = new THREE.MeshBasicMaterial({ color: 0x00c853, side: THREE.DoubleSide, transparent: true, opacity: 0.9, depthTest: false });
  const ring = new THREE.Mesh(new THREE.RingGeometry(0.6, 0.82, 40), mat); ring.rotation.x = -Math.PI / 2; ring.position.y = 0.08; ring.renderOrder = 999;
  const arrow = new THREE.Mesh(new THREE.ConeGeometry(0.3, 0.6, 4), mat); arrow.rotation.x = Math.PI; arrow.renderOrder = 999;
  const cv = document.createElement('canvas'); cv.width = 320; cv.height = 90; const x = cv.getContext('2d');
  x.fillStyle = '#008214'; x.beginPath(); x.roundRect(4, 4, 312, 82, 18); x.fill(); x.fillStyle = '#fff'; x.font = '800 44px sans-serif'; x.textAlign = 'center'; x.textBaseline = 'middle'; x.fillText('你的位置', 160, 47);
  const label = new THREE.Sprite(new THREE.SpriteMaterial({ map: new THREE.CanvasTexture(cv), transparent: true, depthTest: false })); label.scale.set(2.4, 0.68, 1); label.renderOrder = 1000;
  g.add(ring, arrow, label); g.visible = false; api.scene.add(g);
  return { g, ring, arrow, label };
})();
const showMarker = p => { marker.g.position.set(p.x, 0, p.z); marker.g.visible = true; };
const hideMarker = () => { marker.g.visible = false; };
cin.tickMarker = () => { if (!marker.g.visible) return; const t = cin.t; marker.ring.scale.setScalar(1 + Math.sin(t * 4) * 0.08); marker.arrow.position.y = 2.7 + Math.sin(t * 4) * 0.18; marker.label.position.y = 3.5; };

const spawnAtElevator = name => { const c = actor[name]; if (c.sitting) standUp(c); const e = free(ELEV[0], ELEV[1]); c.holder.position.copy(e); c.cin.path = []; c.cin.look = null; return e; };
const restoreAll = () => { lastSpk = null; for (const c of new Set(Object.values(actor))) { c.cin.path = []; c.cin.look = null; if (c.sitting) standUp(c); const h = c.cin.home; c.holder.position.set(h.x, 0, h.z); api.sitAt(c, { x: h.x, z: h.z }); } };
const freeSeat = (x, z) => {   // 離 (x,z) 最近的空椅子（五樓辦公桌區）
  let best = null, bd = 1e9;
  for (const st of api.chairSeats) { if (st.by || st.hidden || st.kind) continue; const px = st.x / U, pz = st.z / U; if (px < 300 || px > 1100 || pz < 300 || pz > 1000) continue; const d = Math.hypot(px - x, pz - z); if (d < bd) { bd = d; best = st; } }
  return best;
};
const midOf = (a, b) => { const p = pos(a), q = pos(b); return V((p.x + q.x) / 2, 0, (p.z + q.z) / 2); };

const stamp = t => { clk.textContent = t; clk.style.opacity = t ? '1' : '0'; };
const nar = (text, sec = 2.6) => { sub.innerHTML = `<i style="font-weight:600;opacity:.92">${text}</i>`; sub.classList.add('on'); lastSpk = null; return lineWait(sec).then(() => { sub.classList.remove('on'); return wait(0.25); }); };
const nearDesk = (name, dx = 70, dz = 60) => { const p = pos(name); return [p.x / U + dx, p.z / U + dz]; };

// 《最後一版》（20 秒版）：客戶一句「再活潑一點」，改到第七版；新同事一句「第三版不是挺好的嗎」解了圍；結尾回到「下一位，就是你」。
const spawnNear = (name, px, pz) => { const c = actor[name]; if (c.sitting) standUp(c); const e = free(px, pz); c.holder.position.copy(e); c.cin.path = []; c.cin.look = null; return e; };
const acts = [
  async () => {   // 一、客戶來信、第七版
    restoreAll(); stamp('週五  18:30');
    await fadeIn();
    await shot(V(17.5, 3.6, 32.5), V(17.5, 1.3, 24), 0, 38);
    await say('Machi', '客戶說，再活潑一點。', 1.8);
    await say('Anna', '已經是第七版了。', 1.4);
    await say('Machi', '再活潑，就變夜市了。', 1.8);
  },
  async () => {   // 二、新同事的一句話
    await fadeOut(); restoreAll(); stamp('18:55');
    const nc = actor.newcomer, nm = nc.name, label = cin.label, m0 = pos('Machi'), e = spawnNear(nm, m0.x / U + 330, m0.z / U + 60);
    await shot(V(e.x + 2, 2.6, e.z + 6), V(e.x - 2, 1.3, e.z), 0, 40); await fadeIn();
    const sb = standBeside(), w = walk(nm, sb[0], sb[1], true); follow(nm, -3.5, 3, 5.5, 40);
    await say(label, '那個……第三版，不是挺好的嗎？', 2.2); await w;
    lookAtActor(nm, 'Machi'); duoShot(0.6, 34);
    await say('Machi', '……第三版。', 1.2); hop('Machi'); hop('Anna');
    await nar('（Machi 按下寄出。客戶秒回：「第三版，剛剛好。」）', 2.2);
  },
  async () => {   // 三、回到「下一位，就是你」
    stamp('19:00'); cam.shake = 0.3;
    const nc = actor.newcomer, nm = nc.name; await duoShot(0.3, 34);
    const m1 = pos(nm); const st = freeSeat(m1.x / U, m1.z / U), sx = st ? st.x / U : m1.x / U + 100, sz = st ? st.z / U : m1.z / U - 100;
    showMarker(P(sx, sz)); cta(true); lookAt('Machi', sx, sz);
    const w = walk(nm, sx, sz + 70, true);
    await say('Machi', '歡迎入職，位置在那邊。', 1.6); await w;
    const sp = P(sx, sz); if (st) api.sitAt(nc, st); hideMarker(); hop(nm);
    await shot(V(sp.x + 8, 13, sp.z + 14), V(sp.x, 0.5, sp.z - 3), 1.5, 46);
    await showCard('下一位', '就是你', 1.8); cta(false); stamp('');
  },
];

async function run() {
  // 等遊戲把人物與辦公室都載好（舊的 window.__plaza 是載完才出現的）
  while (!window.__plaza || !Object.keys(chars).length) await new Promise(r => setTimeout(r, 400));
  await api.cloudReady;
  for (const n of CAST) { const c = chars[n]; if (!c) return; actor[n] = c; }
  const on5F = ch => ch && ch.holder.position.x / U < 1500;   // 只用五樓的人演新同事和企劃：四樓的人在四樓座位，遊戲會一直把他們拉回去坐
  const taken = new Set([...CAST, HERO]);
  const stand = on5F(chars[HERO]) ? chars[HERO] : ['王穗紜', '謝榕', '陳雅筠'].map(n => chars[n]).find(on5F);
  cin.label = stand && stand.name === HERO ? HERO : '新同事';
  const planner = ['吳冠賢', '廖秦葦', '李明庭'].filter(n => !taken.has(n)).map(n => chars[n]).find(ch => on5F(ch) && ch !== stand);
  if (stand) { actor[stand.name] = stand; actor.newcomer = stand; }
  if (planner) { actor[planner.name] = planner; actor.planner = planner; }
  if (!stand) return;
  for (const c of new Set(Object.values(actor))) {
    cin.cast.add(c); c.cin = { path: [], speed: 2.6, done: null, look: null, goal: null, stuck: { t: 0, x: 0, z: 0 }, home: { x: c.holder.position.x, z: c.holder.position.z } };
    c.holder.visible = true; c.remote = false; c.wander = false;
  }
  cin.active = true; root.classList.add('on');
  window.parent !== window && window.parent.postMessage({ type: 'cinemaReady' }, '*');
  const order = ACT_RANGE.length ? Array.from({ length: (ACT_RANGE[1] ?? ACT_RANGE[0]) - ACT_RANGE[0] + 1 }, (_, i) => ACT_RANGE[0] + i) : acts.map((_, i) => i);
  for (;;) {
    for (const i of order) { caption('SCENE ' + (order.indexOf(i) + 1) + ' / ' + order.length); try { await acts[i](); } catch (e) { console.warn('cinema act', i, e); } }
    await fadeOut();
  }
}
cin.actor = actor; cin.free = free; cin.run = run; cin.acts = acts; cin.shot = shot; cin.cam = cam; cin.walk = walk; cin.say = say;
run();
})();

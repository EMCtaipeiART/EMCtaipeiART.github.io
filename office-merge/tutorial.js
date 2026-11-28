// 新手教學：把要看／要操作的地方打亮，其他地方擋住。有 wait 的步驟要玩家真的做到才往下。
import { face } from './chars.js';

const GUIDE = 'Machi';
let run = null;

// steps：[{ text, target: () => 元素陣列, wait?: 'spawn' | 'merge' }]；target 找不到東西時改成按「下一步」
export function startTutorial(steps, onDone) {
  stopTutorial();
  const el = document.createElement('div');
  el.className = 'tut';
  el.innerHTML = `<i class="shade"></i><i class="shade"></i><i class="shade"></i><i class="shade"></i><i class="shade mid"></i><div class="ring"></div>
    <div class="tip-card" role="dialog" aria-label="新手教學"><img alt=""><div><p></p><div class="acts"><small></small><button type="button" class="skip">略過教學</button><button type="button" class="next">下一步</button></div></div></div>`;
  document.body.append(el);
  run = { el, steps, at: 0, onDone };
  el.querySelector('.skip').addEventListener('click', () => end(true));
  el.querySelector('.next').addEventListener('click', () => go(run.at + 1));
  addEventListener('resize', place);
  run.timer = setInterval(place, 300);   // 畫面重畫或物品移動後跟上
  go(0);
}
function go(i) {
  if (!run) return;
  if (i >= run.steps.length) { end(true); return; }
  run.at = i;
  const step = run.steps[i];
  run.waiting = step.wait && step.target().length ? step.wait : '';
  run.el.querySelector('img').src = face(GUIDE);
  run.el.querySelector('p').textContent = step.text;
  run.el.querySelector('small').textContent = `${i + 1} / ${run.steps.length}`;
  run.el.querySelector('.next').hidden = Boolean(run.waiting);
  run.el.querySelector('.next').textContent = i === run.steps.length - 1 ? '開始上班！' : '下一步';
  place();
}
function place() {
  if (!run) return;
  const step = run.steps[run.at], targets = step.target().filter(Boolean);
  // 等玩家操作、但現在做不到了（冷卻、能量用完、沒有可合成的）：放行
  if (run.waiting && !targets.length) { run.waiting = ''; run.el.querySelector('.next').hidden = false; }
  const W = innerWidth, H = innerHeight, rects = targets.map(t => t.getBoundingClientRect());
  const pad = 5, hole = rects.length ? {
    l: Math.max(0, Math.min(...rects.map(r => r.left)) - pad), t: Math.max(0, Math.min(...rects.map(r => r.top)) - pad),
    r: Math.min(W, Math.max(...rects.map(r => r.right)) + pad), b: Math.min(H, Math.max(...rects.map(r => r.bottom)) + pad),
  } : { l: W / 2, t: H / 2, r: W / 2, b: H / 2 };
  const set = (node, l, t, w, h) => Object.assign(node.style, { left: l + 'px', top: t + 'px', width: Math.max(0, w) + 'px', height: Math.max(0, h) + 'px' });
  const [top, bottom, left, right, mid] = run.el.querySelectorAll('.shade');
  set(top, 0, 0, W, hole.t); set(bottom, 0, hole.b, W, H - hole.b); set(left, 0, hole.t, hole.l, hole.b - hole.t); set(right, hole.r, hole.t, W - hole.r, hole.b - hole.t);
  // 純說明的步驟連亮起來的地方也不能點
  set(mid, hole.l, hole.t, hole.r - hole.l, hole.b - hole.t); mid.hidden = Boolean(run.waiting);
  const ring = run.el.querySelector('.ring');
  set(ring, hole.l, hole.t, hole.r - hole.l, hole.b - hole.t); ring.hidden = !rects.length;
  // 說明卡放在亮區比較空的那一側
  const card = run.el.querySelector('.tip-card'), h = card.offsetHeight;
  const below = H - hole.b >= h + 16 || H - hole.b > hole.t;
  card.style.top = Math.max(8, Math.min(H - h - 8, rects.length ? (below ? hole.b + 12 : hole.t - h - 12) : (H - h) / 2)) + 'px';
}
// 遊戲回報玩家做了什麼
export function tutorialEvent(name) {
  if (run?.waiting !== name) return;
  const at = run.at;
  run.waiting = '';
  setTimeout(() => { if (run?.at === at) go(at + 1); }, 650);   // 等動畫播完
}
function end(finished) {
  if (!run) return;
  const { el, timer, onDone } = run;
  run = null; clearInterval(timer); removeEventListener('resize', place); el.remove();
  if (finished) onDone?.();
}
export const stopTutorial = () => end(false);
export const tutorialOn = () => Boolean(run);

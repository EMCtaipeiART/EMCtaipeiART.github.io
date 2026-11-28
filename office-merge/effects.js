// 升級與過關的全畫面特效。一次只播一個，其餘排隊。
import { art } from './art.js';
import { play } from './audio.js';

const queue = [], waiting = [];
let busy = false;
const calm = matchMedia('(prefers-reduced-motion: reduce)');
const COLORS = ['#ff6b6b', '#ffd93b', '#5fdc72', '#58b8ff', '#c58bff', '#ff9d2e'];

function confetti(root, count) {
  if (calm.matches) return;
  for (let k = 0; k < count; k++) {
    const p = document.createElement('i');
    p.className = 'confetti';
    p.style.background = COLORS[k % COLORS.length];
    root.append(p);
    const side = (Math.random() - .5) * innerWidth * 1.1, up = -(innerHeight * (.15 + Math.random() * .35));
    p.animate([
      { transform: 'translate(0px,0px) rotate(0deg)', opacity: 1, easing: 'cubic-bezier(.2,.7,.5,1)' },
      { transform: `translate(${side * .6}px,${up}px) rotate(${Math.random() * 500}deg)`, opacity: 1, offset: .35, easing: 'cubic-bezier(.5,0,.8,.7)' },
      { transform: `translate(${side}px,${innerHeight * .6}px) rotate(${Math.random() * 1200}deg)`, opacity: 0 },
    ], { duration: 1600 + Math.random() * 1200, delay: Math.random() * 250, fill: 'both' }).onfinish = () => p.remove();
  }
}

function next() {
  const job = queue.shift();
  busy = !!job;
  if (!job) { const then = waiting.splice(0); then.forEach(fn => fn()); return; }
  const el = document.createElement('dialog');
  el.className = `party ${job.kind}-party`;
  el.innerHTML = `<div class="rays"></div><div class="card">
    <div class="medal"><img src="${art('star')}" alt=""><b>${job.medal}</b></div>
    <h2>${job.title}</h2><p>${job.text}</p>${job.extra || ''}
    <button type="button">${job.button}</button></div>`;
  document.body.append(el);
  el.showModal();
  play(job.kind === 'clear' ? 'clear' : 'level');
  confetti(el, job.kind === 'clear' ? 90 : 45);
  // 稍等一下才能關，避免連點時一閃就沒了
  const ready = performance.now() + 600;
  el.addEventListener('cancel', e => e.preventDefault());
  el.querySelector('button').addEventListener('click', () => {
    if (performance.now() < ready) return;
    el.close(); el.remove(); next();
  });
}

// 全部特效播完後執行
export const afterParty = fn => { if (busy) waiting.push(fn); else fn(); };

export function celebrate(job) {
  queue.push(job);
  if (!busy) next();
}

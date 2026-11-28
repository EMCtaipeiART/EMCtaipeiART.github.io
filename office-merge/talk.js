// 劇情對話：一次一位人物的半身立繪＋下方對話框，逐字出現；點一下先把這句顯示完，再點換下一句。
import { bust } from './chars.js';
import { play } from './audio.js';

const SPEED = 34;   // 每個字幾毫秒
const calm = matchMedia('(prefers-reduced-motion: reduce)');

// lines：[[名字, 台詞], …]；全部看完（或按略過）後 resolve
export function talk(lines, title = '') {
  return new Promise(done => {
    if (!lines?.length) { done(); return; }
    const el = document.createElement('dialog');
    el.className = 'scene';
    el.innerHTML = `<div class="scene-top"><b></b><button type="button" class="scene-skip">略過 ››</button></div>
      <img class="bust" alt="">
      <div class="say-box" role="button" tabindex="0"><b class="say-name"></b><p><span></span><span class="rest"></span></p><i aria-hidden="true">▼</i><small></small></div>`;
    const [heading, skip] = el.querySelector('.scene-top').children;
    const img = el.querySelector('.bust'), box = el.querySelector('.say-box');
    const [shown, rest] = box.querySelector('p').children;
    heading.textContent = title;
    let at = -1, chars = [], n = 0, timer = 0, since = 0;
    const paint = () => { shown.textContent = chars.slice(0, n).join(''); rest.textContent = chars.slice(n).join(''); box.classList.toggle('done', n >= chars.length); };
    const finish = () => { clearInterval(timer); n = chars.length; paint(); };
    function show(i) {
      at = i; since = performance.now();
      const [who, text] = lines[i], changed = box.querySelector('.say-name').textContent !== who;
      box.querySelector('.say-name').textContent = who;
      img.src = bust(who); img.alt = who;
      if (changed && !calm.matches) img.animate([{ transform: 'translateY(30px)', opacity: 0 }, { transform: 'translateY(0)', opacity: 1 }], { duration: 260, easing: 'ease-out' });
      box.querySelector('small').textContent = `${i + 1} / ${lines.length}`;
      chars = Array.from(text); n = 0; paint();
      clearInterval(timer);
      if (calm.matches) { finish(); return; }
      timer = setInterval(() => { n++; paint(); if (n % 3 === 1) play('type'); if (n >= chars.length) clearInterval(timer); }, SPEED);
    }
    const close = () => { clearInterval(timer); el.close(); el.remove(); done(); };
    function advance() {
      if (performance.now() - since < 180) return;   // 連點保護
      if (n < chars.length) { since = performance.now(); finish(); return; }
      if (at + 1 < lines.length) show(at + 1); else close();
    }
    el.addEventListener('click', e => { if (e.target.closest('.scene-skip')) close(); else advance(); });
    box.addEventListener('keydown', e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); advance(); } });
    el.addEventListener('cancel', e => e.preventDefault());
    document.body.append(el);
    el.showModal();
    box.focus({ preventScroll: true });
    show(0);
  });
}

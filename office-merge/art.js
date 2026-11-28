// 向量插圖：金幣、星星。產生器、紙箱、背景是 art/ 裡的圖檔。
const url = (body, box = '0 0 100 100') =>
  'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="${box}">${body}</svg>`);

const grad = (id, a, b) => `<linearGradient id="${id}" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="${a}"/><stop offset="1" stop-color="${b}"/></linearGradient>`;

const coin = url(`<defs>${grad('c', '#ffe875', '#ffad1f')}</defs><circle cx="50" cy="50" r="45" fill="url(#c)" stroke="#a85f0a" stroke-width="6"/>
  <circle cx="50" cy="50" r="29" fill="none" stroke="#e08a12" stroke-width="5"/>
  <path d="M50 31l5.6 12 13 1.500-9.600 9 2.600 12.800L50 60l-11.600 6.300 2.600-12.800-9.600-9 13-1.500z" fill="#fff6c2"/>
  <path d="M22 35q8-17 25-21" stroke="#fff" stroke-width="6" fill="none" stroke-linecap="round" opacity=".8"/>`);

const star = url('<path d="M50 6l13 28 31 4-23 21 6 31-27-15-27 15 6-31L6 38l31-4z" fill="#ffd93b" stroke="#c8780a" stroke-width="7" stroke-linejoin="round"/>');

const ICONS = { s: 'art/s.png', t: 'art/t.png', i: 'art/i.png', m: 'art/m.png', d: 'art/d.png', w: 'art/w.png', box: 'art/box.png', coin, star };
export const art = name => ICONS[name];

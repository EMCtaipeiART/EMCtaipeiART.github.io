/* Shared vector artwork for the tool buttons and canvas attack ghosts. */
(()=>{
const art=[
`<path fill="#ee5470" d="M16 43L12 30Q7 16 16 11Q22 8 27 15Q30 5 38 8Q45 9 44 18Q52 17 54 25L53 39L44 49Z"/><path fill="#bc2d50" d="M18 40L46 42L44 57L20 57Z"/><path fill="none" stroke="#ffacb9" d="M17 21Q16 15 21 16M32 15L32 24M43 24L43 31"/><path fill="#fff1da" d="M25 47H39V52H25Z"/>`,
`<path fill="#fff" d="M18 8Q32 1 44 10Q51 18 47 34L43 51Q41 61 28 61Q15 61 14 51L13 28Q12 15 18 8Z"/><path fill="#1675d1" d="M14 21Q30 13 48 22L46 35Q29 27 14 35Z"/><path fill="none" stroke="#73b9fa" d="M19 23Q31 19 42 24"/>`,
`<path fill="#687781" d="M36 38L43 34L58 51Q61 56 56 59Q53 61 50 57Z"/><circle fill="#344956" cx="26" cy="25" r="21"/><circle fill="#8eabb7" cx="26" cy="25" r="16"/><path fill="#fff9e8" d="M16 18Q23 10 30 16Q40 15 39 25Q43 35 31 36Q21 41 16 32Q9 27 16 18Z"/><circle fill="#ffc94c" cx="26" cy="26" r="7"/>`,
`<path fill="#81aab3" d="M5 19L55 15L60 47L9 52Z"/><path fill="#e3f4f0" d="M7 17L55 13L59 43L10 48Z"/><g fill="#87b9b9" stroke-width="1.5"><path d="M13 23L20 22L21 28L14 29ZM25 22L32 21L33 27L26 28ZM37 21L44 20L45 26L38 27ZM48 20L52 20L53 26L49 26ZM15 33L22 32L23 38L16 39ZM27 32L34 31L35 37L28 38ZM39 31L46 30L47 36L40 37ZM50 30L54 30L55 36L51 36Z"/><path d="M24 41L45 39"/></g>`,
`<path fill="#bc8b5f" d="M8 39L56 39L49 56L16 56Z"/><path fill="#e2b078" d="M6 37Q30 26 58 37L55 44H10Z"/><path fill="#fff9e8" d="M12 34Q4 26 17 23Q12 14 26 14Q25 4 35 8Q44 10 42 18Q56 17 51 28Q62 35 48 37H17Z"/><path fill="none" stroke="#e6d8be" d="M18 28Q34 32 45 25M24 20Q32 23 39 18"/><circle fill="#ef5a64" cx="33" cy="10" r="5"/>`,
`<path fill="#ffd64f" d="M27 21L26 12Q21 9 25 5L31 8L35 4L38 10L35 21Q46 25 42 39L38 48L46 54L43 59L33 54L24 59L19 55L26 47Q16 39 20 30Z"/><path fill="#ff8b35" d="M26 18L15 22L26 26Z"/><circle fill="#fff" cx="31" cy="15" r="5"/><circle fill="#20394e" stroke="none" cx="30" cy="15" r="2"/><path fill="#ff8245" d="M26 33Q32 28 37 34Q40 39 32 43Z"/><path fill="none" stroke="#fff1a3" d="M24 29L23 36"/>`,
`<path fill="#e4a82a" d="M35 4L12 34H28L23 60L53 25H36L43 4Z"/><path fill="#ffe46b" d="M35 4L12 34H28L25 48L44 27H33L40 4Z"/><path fill="none" stroke="#fff5bd" d="M30 15L22 27"/>`,
`<path fill="#b6d9d6" d="M20 6L54 13L47 56L13 49Z"/><path fill="#fffdf2" d="M10 12L43 8L52 49L18 56Z"/><path fill="#e2eee7" d="M43 8L34 10L37 21L46 19Z"/><path fill="none" stroke="#79a6ab" d="M18 25L36 22M20 33L40 29M22 41L42 37"/><path fill="#63b9aa" d="M4 40L10 40L13 48L7 50ZM48 3L54 5L51 10L46 8Z"/>`
];
const svgs=art.map(body=>`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64" aria-hidden="true"><g stroke="#20394e" stroke-width="3" stroke-linejoin="round" stroke-linecap="round">${body}</g></svg>`);
const images=svgs.map(svg=>{const im=new Image();im.src='data:image/svg+xml;charset=utf-8,'+encodeURIComponent(svg);return im;});
window.ArenaWeaponArt={svg:i=>svgs[i],draw(ctx,i,size){const im=images[i];if(im.complete&&im.naturalWidth)ctx.drawImage(im,-size/2,-size*.9,size,size);}};
})();

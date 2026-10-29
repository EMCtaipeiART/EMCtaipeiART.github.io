/* 辦公室小樂趣：馬桶（有人用就出現便便、點人物順手沖水）、投影機（點一下開／切換簡報）、
   會議室遺落的筆記本與紙筆、地上偶爾出現的驚喜道具。全部只在自己的畫面隨機出現，不寫回後端。
   場景幾何由 app.js 的 window.__funApi 提供。 */
(()=>{
const api=()=>window.__funApi;
const KEY='pixelFun';
let stat={flush:0,found:0,notes:0};try{Object.assign(stat,JSON.parse(localStorage.getItem(KEY)||'{}'))}catch(e){}
const save=()=>{try{localStorage.setItem(KEY,JSON.stringify(stat))}catch(e){}};
const rnd=(a,b)=>a+Math.random()*(b-a),pick=l=>l[Math.floor(Math.random()*l.length)];
const dirty=()=>{try{api().markDirty()}catch(e){}};
const toast=m=>{try{api().toast(m)}catch(e){}};
const seen=new Set();
/* ---------- 馬桶 ---------- */
const BOWLS=[[92,86],[92,200]];/* 兩格馬桶中心（相對廁所內側左上角） */
const poop=new Map();/* key → {at,flushing} */
let prompt=null;/* {key,x,y,until} 點人物後出現的「沖馬桶」按鈕 */
function bowlList(){const g=api().geo();const out=[];(g.toilets||[]).forEach((t,ti)=>BOWLS.forEach((b,bi)=>out.push({key:ti+':'+bi,x:t.x+b[0],y:t.y+b[1]})));return out;}
function updateToilets(){const ps=api().people().filter(p=>!p.away);bowlList().forEach(b=>{const occ=ps.some(p=>Math.abs(p.x-(b.x+4))<62&&Math.abs(p.vy-(b.y+36))<62);const st=poop.get(b.key);if(occ&&!st)poop.set(b.key,{at:Date.now(),occ:true});else if(st&&!st.flushing){st.occ=occ;if(!occ&&Date.now()-st.at>180000)poop.delete(b.key);}});}
function flush(key){const st=poop.get(key);if(!st||st.flushing)return;st.flushing=Date.now();stat.flush++;save();
  const m=pick(['🚽 嘩～沖乾淨了！衛生之星 +1','🚽 順手沖馬桶，同事感謝你！','🚽 清潔小天使上線，今天運氣 +1','🚽 沖水成功！廁所又恢復清爽']);toast(m+'（累計 '+stat.flush+' 次）');
  const sel=api().selected();if(sel!==null&&sel!==undefined)api().mood(sel,'joy');setTimeout(()=>{poop.delete(key);dirty();},1100);dirty();}
function drawPoop(c,x,y,t){/* 像素便便：三層，黑外框，兩顆眼睛 */
  c.save();c.imageSmoothingEnabled=false;const bob=Math.round(Math.sin(t/260)*1.5);y+=bob;
  const box=(col,bx,by,w,h)=>{c.fillStyle='#111';c.fillRect(x+bx-3,y+by-3,w+6,h+6);c.fillStyle=col;c.fillRect(x+bx,y+by,w,h);};
  box('#8b5a2b',-18,0,36,12);box('#9c6a35',-13,-12,26,12);box('#ad7a40',-7,-22,14,10);
  c.fillStyle='#fff';c.fillRect(x-8,y-9,5,5);c.fillRect(x+3,y-9,5,5);c.fillStyle='#111';c.fillRect(x-6,y-7,2,3);c.fillRect(x+5,y-7,2,3);
  c.restore();}
function drawFlush(c,x,y,t){const k=Math.min(1,t/1000);c.save();c.strokeStyle='rgba(80,170,230,'+(1-k)+')';c.lineWidth=4;for(let i=0;i<3;i++){c.beginPath();c.arc(x,y+6,10+k*34+i*9,0,Math.PI*2);c.stroke();}c.restore();}
function drawPrompt(c,p){const w=150,h=34,x=p.x-w/2,y=p.y-92;c.save();c.fillStyle='#111';c.fillRect(x-3,y-3,w+6,h+6);c.fillStyle='#e6f6ff';c.fillRect(x,y,w,h);c.fillStyle='#111';c.font='bold 16px sans-serif';c.textAlign='center';c.textBaseline='middle';c.fillText('🚽 順手沖馬桶',p.x,y+h/2+1);c.restore();p.rect=[x,y,w,h];}
/* ---------- 投影機 ---------- */
const SLIDES=[['本週進度','▮▮▮▮▮▯▯ 72%'],['午餐投票','🍱 便當　🍜 拉麵　🥗 沙拉'],['今日金句','「改稿是設計師的日常」'],['Q4 目標','客戶滿意度 ↑ 加班 ↓'],['休息一下','☕ 15 分鐘後回來']];
const proj=new Map();/* key → 0=關，1..n=第幾張 */
const pkey=p=>p.x+','+p.y;
function drawProj(c,p){const n=proj.get(pkey(p))||0;if(!n)return;const s=SLIDES[(n-1)%SLIDES.length],right=/right/.test(p.name),down=/down/.test(p.name),W=170,H=104;
  const ox=p.x+(right?p.w:0)+(right?10:0),oy=p.y+p.h/2;let sx,sy;if(down){sx=p.x+p.w/2-W/2;sy=p.y+p.h+30;}else if(right){sx=p.x+p.w+36;sy=oy-H/2;}else{sx=p.x-36-W;sy=oy-H/2;}
  c.save();c.fillStyle='rgba(255,246,170,.20)';c.beginPath();
  if(down){c.moveTo(p.x+p.w/2-8,p.y+p.h);c.lineTo(p.x+p.w/2+8,p.y+p.h);c.lineTo(sx+W,sy);c.lineTo(sx,sy);}
  else if(right){c.moveTo(p.x+p.w,oy-6);c.lineTo(p.x+p.w,oy+6);c.lineTo(sx,sy+H);c.lineTo(sx,sy);}
  else{c.moveTo(p.x,oy-6);c.lineTo(p.x,oy+6);c.lineTo(sx+W,sy+H);c.lineTo(sx+W,sy);}
  c.closePath();c.fill();
  c.fillStyle='#111';c.fillRect(sx-4,sy-4,W+8,H+8);c.fillStyle='#f8fbff';c.fillRect(sx,sy,W,H);c.fillStyle='#2f6fd6';c.fillRect(sx,sy,W,22);
  c.fillStyle='#fff';c.font='bold 14px sans-serif';c.textAlign='left';c.textBaseline='middle';c.fillText(s[0],sx+8,sy+12);
  c.fillStyle='#223';c.font='bold 13px sans-serif';c.textAlign='center';c.fillText(s[1],sx+W/2,sy+H/2+10,W-12);
  c.fillStyle='#8a97a8';c.font='11px sans-serif';c.fillText(n+' / '+SLIDES.length+'　點投影機換頁',sx+W/2,sy+H-9);c.restore();}
/* ---------- 會議室遺落的筆記本與紙筆 ---------- */
const NOTES=[['筆記本','📓 撿到一本筆記本，上面寫著「下週一要交稿」'],['紙筆','✏️ 一張紙和一支筆，畫了一隻很醜的貓'],['便利貼','🗒️ 便利貼：「誰把我的馬克杯拿走了」'],['速寫本','📒 速寫本裡全是上班摸魚畫的小人'],['原子筆','🖊️ 一支有咬痕的原子筆，不知道是誰的']];
let notes=[];
function drawNote(c,n){c.save();c.imageSmoothingEnabled=false;const x=n.x,y=n.y,box=(col,bx,by,w,h)=>{c.fillStyle='#111';c.fillRect(x+bx-2,y+by-2,w+4,h+4);c.fillStyle=col;c.fillRect(x+bx,y+by,w,h);};
  if(n.k===0||n.k===3){box(n.k?'#e9c46a':'#3a6fb0',-12,-9,24,18);c.fillStyle='#fff';c.fillRect(x-8,y-6,2,12);c.fillStyle='#ffd166';c.fillRect(x-3,y-5,12,2);}
  else if(n.k===1){box('#fffdf5',-13,-8,22,16);c.fillStyle='#8a97a8';c.fillRect(x-9,y-4,14,2);c.fillRect(x-9,y,10,2);box('#e63946',4,-12,4,20);}
  else if(n.k===2){box('#ffe66d',-9,-9,18,18);c.fillStyle='#8a7a30';c.fillRect(x-5,y-3,10,2);c.fillRect(x-5,y+2,7,2);}
  else{box('#2a9d8f',-14,-2,28,4);}
  c.restore();}
function spawnNote(){const g=api().geo(),rooms=(g.rooms||[]).filter(r=>r.tables&&r.tables.length);if(!rooms.length||notes.length>=3)return;
  const r=pick(rooms),t=pick(r.tables),x=Math.round(rnd(t[0]+20,t[0]+Math.max(21,t[2]-20))),y=Math.round(rnd(t[1]+22,t[1]+Math.max(23,Math.min(t[3],120)-22)));
  if(notes.some(n=>Math.hypot(n.x-x,n.y-y)<50))return;notes.push({x,y,k:Math.floor(Math.random()*NOTES.length),at:Date.now()});dirty();}
/* ---------- 地上的驚喜道具 ---------- */
const ITEMS=[['🪙','金幣','撿到一枚金幣，今天財運不錯'],['🍀','幸運草','四葉幸運草！今天會順順利利'],['🎁','小禮物','撿到一份小禮物，裡面是一顆糖'],['🎫','抽獎券','撿到一張抽獎券，記得下午開獎'],['🔑','小鑰匙','一把小鑰匙，不知道開哪個抽屜'],['⭐','星星','撿到一顆星星，心情 +10'],['🍬','糖果','地上有顆糖果，沒拆封的，賺到']];
let drops=[];
function spawnDrop(){if(drops.length>=2)return;const a=api(),b=a.bounds();for(let k=0;k<40;k++){const x=Math.round(rnd(b.x0,b.x1)),y=Math.round(rnd(Math.max(b.y0,100),b.y1));
  if(a.blocked(x,y)||a.blocked(x+30,y)||a.blocked(x-30,y)||a.blocked(x,y+30)||a.blocked(x,y-30))continue;drops.push({x,y,k:Math.floor(Math.random()*ITEMS.length),at:Date.now()});dirty();return;}}
function drawDrop(c,d,t){const vy=api().viewY(d.y),bob=Math.round(Math.sin(t/300+d.x)*3),it=ITEMS[d.k];c.save();c.fillStyle='rgba(0,0,0,.14)';c.beginPath();c.ellipse(d.x,vy+6,15,6,0,0,Math.PI*2);c.fill();
  const glow=.5+.5*Math.sin(t/250+d.y);c.fillStyle='rgba(255,230,120,'+(.12+glow*.18)+')';c.beginPath();c.arc(d.x,vy-12+bob,26,0,Math.PI*2);c.fill();
  c.font='28px sans-serif';c.textAlign='center';c.textBaseline='middle';c.fillText(it[0],d.x,vy-12+bob);c.restore();}
function collect(d,who){const it=ITEMS[d.k];drops=drops.filter(q=>q!==d);stat.found++;save();toast('✨ '+it[2]+'（累計撿到 '+stat.found+' 個）');const sel=api().selected();if(sel!==null&&sel!==undefined)api().mood(sel,'joy');dirty();}
/* ---------- 對外 ---------- */
window.funDraw=c=>{try{
  const t=performance.now();
  const g=api().geo();
  bowlList().forEach(b=>{const st=poop.get(b.key);if(!st)return;if(st.flushing)drawFlush(c,b.x,b.y,Date.now()-st.flushing);else drawPoop(c,b.x,b.y,t);});
  (g.proj||[]).forEach(p=>drawProj(c,p));
  notes.forEach(n=>drawNote(c,n));
  drops.forEach(d=>drawDrop(c,d,t));
  if(prompt&&Date.now()<prompt.until)drawPrompt(c,prompt);else prompt=null;
  if(poop.size||drops.length||(proj.size&&[...proj.values()].some(Boolean)))dirty();/* 有動畫時才持續重畫 */
}catch(e){}};
window.funSceneClick=(x,y,hit)=>{try{
  if(prompt&&prompt.rect&&x>=prompt.rect[0]&&x<=prompt.rect[0]+prompt.rect[2]&&y>=prompt.rect[1]&&y<=prompt.rect[1]+prompt.rect[3]){const k=prompt.key;prompt=null;flush(k);return true;}
  for(const d of drops){const vy=api().viewY(d.y);if(Math.abs(x-d.x)<26&&Math.abs(y-(vy-12))<30){collect(d);return true;}}
  for(const n of notes){if(Math.abs(x-n.x)<24&&Math.abs(y-n.y)<20){notes=notes.filter(q=>q!==n);stat.notes++;save();toast(NOTES[n.k][1]+'（累計 '+stat.notes+' 件）');dirty();return true;}}
  const g=api().geo();for(const p of g.proj||[]){if(x>=p.x-6&&x<=p.x+p.w+6&&y>=p.y-6&&y<=p.y+p.h+6){const k=pkey(p),n=proj.get(k)||0;proj.set(k,n>=SLIDES.length?0:n+1);toast(n>=SLIDES.length?'📽️ 投影機關閉':'📽️ 投影中：'+SLIDES[n][0]);dirty();return true;}}
  /* 點到廁所裡有便便的人物：跳出「沖馬桶」 */
  if(hit&&hit.i!==undefined){const ps=api().people(),p=ps[hit.i];if(p){const b=bowlList().find(b=>poop.has(b.key)&&!poop.get(b.key).flushing&&Math.abs(p.x-(b.x+4))<70&&Math.abs(p.vy-(b.y+36))<70);if(b)prompt={key:b.key,x:p.x,y:p.vy,until:Date.now()+6000};}}
  for(const b of bowlList()){const st=poop.get(b.key);if(st&&!st.flushing&&Math.abs(x-b.x)<26&&Math.abs(y-b.y)<28){flush(b.key);return true;}}
  return false;}catch(e){return false;}};
/* 排程：廁所偵測、筆記本、驚喜道具；走過去也能撿 */
setInterval(()=>{try{if(!api()||document.hidden)return;updateToilets();
  const ps=api().people().filter(p=>!p.away),sel=api().selected();
  for(const d of drops.slice()){const w=ps.find(p=>p.i===sel&&Math.hypot(p.x-d.x,p.y-d.y)<46);if(w)collect(d);else if(Date.now()-d.at>600000){drops=drops.filter(q=>q!==d);dirty();}}
  notes=notes.filter(n=>Date.now()-n.at<900000);}catch(e){}},700);
setInterval(()=>{try{if(!api()||document.hidden)return;if(Math.random()<.45)spawnNote();if(Math.random()<.5)spawnDrop();}catch(e){}},45000);
setTimeout(()=>{try{if(api()){spawnDrop();if(Math.random()<.7)spawnNote();}}catch(e){}},9000);
window.__fun={spawnDrop,spawnNote,poop,stat:()=>stat};
})();

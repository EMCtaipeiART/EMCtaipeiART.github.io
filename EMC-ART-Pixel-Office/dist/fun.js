/* 辦公室小樂趣：馬桶（隨機冒出小便便、點一下沖掉）、投影機（隨機開／關，畫面也是隨機）、
   會議室遺落的筆記本與紙筆、地上偶爾出現的驚喜道具。
   所有人看到的都一樣：出現什麼、在哪裡，是用「時段＋種子」算出來的（每個人算出來相同）；
   誰沖了馬桶、撿走了道具、開關了投影機，記在後端（pixelOfficeFun）並隨輪詢傳給大家。
   場景幾何由 app.js 的 window.__funApi 提供；圖用 assets/office-fun-v1.webp（Codex 繪製），沒載入時用程式畫的備用圖。 */
(()=>{
const api=()=>window.__funApi;
const KEY='pixelFun';
let stat={flush:0,found:0,notes:0};try{Object.assign(stat,JSON.parse(localStorage.getItem(KEY)||'{}'))}catch(e){}
const save=()=>{try{localStorage.setItem(KEY,JSON.stringify(stat))}catch(e){}};
const dirty=()=>{try{api().markDirty()}catch(e){}};
const toast=m=>{try{api().toast(m)}catch(e){}};
/* ---------- 種子亂數 ---------- */
function rng(str){let h=1779033703^str.length;for(let i=0;i<str.length;i++){h=Math.imul(h^str.charCodeAt(i),3432918353);h=h<<13|h>>>19;}
  let a=Math.imul(h^h>>>16,2246822507)^Math.imul(h^h>>>13,3266489909)>>>0;return()=>{a|=0;a=a+0x6D2B79F5|0;let t=Math.imul(a^a>>>15,1|a);t=t+Math.imul(t^t>>>7,61|t)^t;return((t^t>>>14)>>>0)/4294967296;};}
const FL=()=>api().floor();
/* ---------- 共用的「已處理」紀錄 ---------- */
let claims={};
window.funSetClaims=m=>{if(m&&typeof m==='object'){claims=m;dirty();}};
function claim(id,v){v=Math.max(0,Math.floor(Number(v)||0));claims[id]=[v,Date.now()];dirty();try{return api().post({action:'pixelOfficeFun',id,v,token:api().token()}).then(r=>{if(r&&r.funClaims)claims=r.funClaims;dirty();return r;}).catch(()=>null);}catch(e){return Promise.resolve(null);}}
const taken=id=>!!claims[id];
/* ---------- 圖片 ---------- */
let sheet=null,rects=null;
(()=>{const im=new Image();im.onload=()=>{sheet=im;dirty();};im.src='assets/office-fun-v1.webp?v=1';fetch('assets/office-fun-v1.json?v=1').then(r=>r.ok?r.json():null).then(j=>{if(j){rects=j;dirty();}}).catch(()=>{});})();
const spr=(c,id,cx,cy)=>{const r=rects&&rects[id];if(!sheet||!r)return false;c.save();c.imageSmoothingEnabled=false;c.drawImage(sheet,r.x,r.y,r.w,r.h,Math.round(cx-r.w/2),Math.round(cy-r.h/2),r.w,r.h);c.restore();return true;};
/* ---------- 馬桶 ---------- */
const BOWLS=[[90,72],[90,186]];/* 兩格馬桶水面中心（相對廁所內側左上角） */
const SLOT_P=300000;
function bowlList(){const g=api().geo(),out=[];(g.toilets||[]).forEach((t,ti)=>BOWLS.forEach((b,bi)=>out.push({key:ti+':'+bi,x:t.x+b[0],y:t.y+b[1]})));return out;}
function poops(){const sl=Math.floor(Date.now()/SLOT_P),out=[];for(const b of bowlList()){const id='p:'+FL()+':'+sl+':'+b.key,r=rng(id);if(r()<.4)out.push({id,x:b.x,y:b.y,v:r()<.5?1:2});}return out;}
const flushing=new Map();/* id → 開始時間 */
let prompt=null;
function flush(p){if(flushing.has(p.id)||taken(p.id))return;flushing.set(p.id,Date.now());claim(p.id,1).then(r=>{if(r&&r.won===false){toast('🚽 已經被別人沖掉了');return;}stat.flush++;save();
  toast(pick(['🚽 嘩～沖乾淨了！衛生之星 +1','🚽 順手沖馬桶，同事感謝你！','🚽 清潔小天使上線，今天運氣 +1','🚽 沖水成功！廁所又恢復清爽'])+'（累計 '+stat.flush+' 次）');const sel=api().selected();if(sel!==null&&sel!==undefined)api().mood(sel,'joy');});
  setTimeout(()=>{flushing.delete(p.id);dirty();},1100);dirty();}
const pick=l=>l[Math.floor(Math.random()*l.length)];
function drawPoop(c,p,t){const fl=flushing.get(p.id);if(fl){const k=Math.min(1,(Date.now()-fl)/1000);c.save();c.strokeStyle='rgba(80,170,230,'+(1-k)+')';c.lineWidth=3;for(let i=0;i<2;i++){c.beginPath();c.ellipse(p.x,p.y+2,8+k*20+i*6,5+k*10+i*3,0,0,Math.PI*2);c.stroke();}c.restore();return;}
  if(spr(c,p.v===2?'poop2':'poop',p.x,p.y+Math.round(Math.sin(t/400+p.x)*1)))return;
  c.save();c.imageSmoothingEnabled=false;const x=p.x,y=p.y+4,box=(col,bx,by,w,h)=>{c.fillStyle='#111';c.fillRect(x+bx-2,y+by-2,w+4,h+4);c.fillStyle=col;c.fillRect(x+bx,y+by,w,h);};
  box('#8b5a2b',-9,0,18,6);box('#9c6a35',-6,-6,12,6);box('#ad7a40',-3,-11,6,5);c.fillStyle='#fff';c.fillRect(x-4,y-4,3,3);c.fillRect(x+1,y-4,3,3);c.restore();}
function drawPrompt(c,p){const w=150,h=34,x=p.x-w/2,y=p.y-92;c.save();c.fillStyle='#111';c.fillRect(x-3,y-3,w+6,h+6);c.fillStyle='#e6f6ff';c.fillRect(x,y,w,h);c.fillStyle='#111';c.font='bold 16px sans-serif';c.textAlign='center';c.textBaseline='middle';c.fillText('🚽 順手沖馬桶',p.x,y+h/2+1);c.restore();p.rect=[x,y,w,h];}
/* ---------- 投影機 ---------- */
const SLIDES=[['本週進度','▮▮▮▮▮▯▯ 72%'],['午餐投票','🍱 便當　🍜 拉麵　🥗 沙拉'],['今日金句','「改稿是設計師的日常」'],['Q4 目標','客戶滿意度 ↑ 加班 ↓'],['休息一下','☕ 15 分鐘後回來'],['週五提醒','🎉 下班前記得關電腦'],['新需求','「這個 logo 可以再大一點嗎」'],['會議紀錄','結論：下次再討論'],
 ['客戶回饋','「可以再活潑一點，但要高級」'],['修改次數','v1 ▸ v2 ▸ v3 ▸ final ▸ final_final'],['設計師日常','Ctrl+S 是一種信仰'],['今日運勢','🔮 今天交稿大吉，改稿小凶'],['咖啡指數','☕☕☕☕☕ 已達上限'],['急件警報','🚨 「這個明天要，今天能給嗎」'],['色彩小教室','「紅色」到底是哪一種紅？'],['字體大亂鬥','標楷體 vs 黑體：永遠的戰爭'],['準時下班','🕖 目標：19:00 準時打卡（不可能）'],['員工福利','🍰 下午茶蛋糕已抵達茶水間'],['冷知識','像素風其實是最耗時的風格'],['猜謎時間','什麼東西越改越像原稿？'],['謎底','……客戶說「還是第一版好」'],['團隊目標','今年沒有人被叫去重跑一次！'],['小提醒','存檔、存檔、再存檔'],['午休倒數','🍜 距離午餐還有 ∞ 分鐘'],['投票','貓派 🐱　狗派 🐶　（辦公室禁戰）'],['週報','本週完成：開會 × 12'],['吐槽大會','「這個很簡單，你隨便弄一下」'],['歡迎新人','👋 新同事，咖啡機在那邊'],['神秘訊息','🎁 今天茶水間有人偷放零食'],['彩蛋','你發現了投影機的秘密！']],SLIDE_N=SLIDES.length,SLOT_J=360000;
const pkey=p=>p.x+'_'+p.y;
function projState(p){const sl=Math.floor(Date.now()/SLOT_J),id='j:'+FL()+':'+sl+':'+pkey(p),r=rng(id),base=r()<.45,basePic=Math.floor(r()*SLIDE_N),ov=claims[id];/* 開啟的人隨機選畫面並一起記進後端（v＝畫面編號+1），所有人看到同一張、不會跳兩次 */return ov?{on:ov[0]>0,pic:Math.max(0,ov[0]-1)%SLIDE_N,id}:{on:base,pic:basePic,id};}
function drawProj(c,p){const st=projState(p);if(!st.on)return;const right=/right/.test(p.name),down=/down/.test(p.name),W=170,H=104,oy=p.y+p.h/2;let sx,sy;if(down){sx=p.x+p.w/2-W/2;sy=p.y+p.h+30;}else if(right){sx=p.x+p.w+36;sy=oy-H/2;}else{sx=p.x-36-W;sy=oy-H/2;}
  c.save();c.fillStyle='rgba(255,246,170,.20)';c.beginPath();
  if(down){c.moveTo(p.x+p.w/2-8,p.y+p.h);c.lineTo(p.x+p.w/2+8,p.y+p.h);c.lineTo(sx+W,sy);c.lineTo(sx,sy);}
  else if(right){c.moveTo(p.x+p.w,oy-6);c.lineTo(p.x+p.w,oy+6);c.lineTo(sx,sy+H);c.lineTo(sx,sy);}
  else{c.moveTo(p.x,oy-6);c.lineTo(p.x,oy+6);c.lineTo(sx+W,sy+H);c.lineTo(sx+W,sy);}
  c.closePath();c.fill();c.restore();
  const sl=SLIDES[st.pic%SLIDES.length];/* 第一版的簡報卡（藍色標題列＋一句話）：比較有趣，隨機挑一張 */
  c.save();c.fillStyle='#111';c.fillRect(sx-4,sy-4,W+8,H+8);c.fillStyle='#f8fbff';c.fillRect(sx,sy,W,H);c.fillStyle='#2f6fd6';c.fillRect(sx,sy,W,22);
  c.fillStyle='#fff';c.font='bold 14px sans-serif';c.textAlign='left';c.textBaseline='middle';c.fillText(sl[0],sx+8,sy+12);
  c.fillStyle='#223';c.font='bold 13px sans-serif';c.textAlign='center';c.fillText(sl[1],sx+W/2,sy+H/2+10,W-12);c.restore();}
/* ---------- 會議室遺落物 ---------- */
const NOTE_IDS=['note_book','note_paper','note_sticky','note_sketch','note_pen'];
const NOTES=[['筆記本','📓 撿到一本筆記本，上面寫著「下週一要交稿」'],['紙筆','✏️ 一張紙和一支筆，畫了一隻很醜的貓'],['便利貼','🗒️ 便利貼：「誰把我的馬克杯拿走了」'],['速寫本','📒 速寫本裡全是上班摸魚畫的小人'],['原子筆','🖊️ 一支有咬痕的原子筆，不知道是誰的']];
const SLOT_N=720000,cacheN=new Map();
function notesNow(){const g=api().geo(),rooms=(g.rooms||[]).filter(r=>r.tables&&r.tables.length),sl=Math.floor(Date.now()/SLOT_N),out=[];if(!rooms.length)return out;
  for(const s of [sl-1,sl]){const ck=FL()+':'+s+':'+rooms.length;let L=cacheN.get(ck);if(!L){L=[];const r=rng('n:'+ck),n=Math.floor(r()*4);for(let i=0;i<n;i++){const room=rooms[Math.floor(r()*rooms.length)],t=room.tables[Math.floor(r()*room.tables.length)],x=Math.round(t[0]+20+r()*Math.max(1,t[2]-40)),y=Math.round(t[1]+22+r()*Math.max(1,Math.min(t[3],120)-44));L.push({id:'n:'+FL()+':'+s+':'+i,x,y,k:Math.floor(r()*NOTE_IDS.length)});}cacheN.set(ck,L);}
    L.forEach(q=>{if(!taken(q.id))out.push(q);});}
  return out;}
function drawNote(c,n){if(spr(c,NOTE_IDS[n.k],n.x,n.y))return;c.save();c.imageSmoothingEnabled=false;c.fillStyle='#111';c.fillRect(n.x-14,n.y-10,28,20);c.fillStyle=['#3a6fb0','#fffdf5','#ffe66d','#e9c46a','#2a9d8f'][n.k];c.fillRect(n.x-12,n.y-8,24,16);c.restore();}
/* ---------- 地上的驚喜道具 ---------- */
const DROP_IDS=['drop_coin','drop_clover','drop_gift','drop_ticket','drop_key','drop_star','drop_candy'];
const ITEMS=[['🪙','金幣','撿到一枚金幣，今天財運不錯'],['🍀','幸運草','四葉幸運草！今天會順順利利'],['🎁','小禮物','撿到一份小禮物，裡面是一顆糖'],['🎫','抽獎券','撿到一張抽獎券，記得下午開獎'],['🔑','小鑰匙','一把小鑰匙，不知道開哪個抽屜'],['⭐','星星','撿到一顆星星，心情 +10'],['🍬','糖果','地上有顆糖果，沒拆封的，賺到']];
const SLOT_D=480000,cacheD=new Map();
function dropsNow(){const a=api(),b=a.bounds(),sl=Math.floor(Date.now()/SLOT_D),out=[];
  for(const s of [sl-1,sl]){const ck=FL()+':'+s;let L=cacheD.get(ck);if(!L){L=[];const r=rng('d:'+ck),n=1+Math.floor(r()*2);
    for(let i=0;i<n;i++){for(let k=0;k<60;k++){const x=Math.round(b.x0+r()*(b.x1-b.x0)),y=Math.round(Math.max(b.y0,100)+r()*(b.y1-Math.max(b.y0,100)));
      if(a.blocked(x,y)||a.blocked(x+30,y)||a.blocked(x-30,y)||a.blocked(x,y+30)||a.blocked(x,y-30))continue;L.push({id:'d:'+FL()+':'+s+':'+i,x,y,k:Math.floor(r()*ITEMS.length)});break;}}cacheD.set(ck,L);}
    L.forEach(q=>{if(!taken(q.id))out.push(q);});}
  return out;}
function drawDrop(c,d,t){const vy=api().viewY(d.y),bob=Math.round(Math.sin(t/300+d.x)*3);c.save();c.fillStyle='rgba(0,0,0,.14)';c.beginPath();c.ellipse(d.x,vy+6,15,6,0,0,Math.PI*2);c.fill();
  const glow=.5+.5*Math.sin(t/250+d.y);c.fillStyle='rgba(255,230,120,'+(.12+glow*.18)+')';c.beginPath();c.arc(d.x,vy-14+bob,24,0,Math.PI*2);c.fill();c.restore();
  if(spr(c,DROP_IDS[d.k],d.x,vy-14+bob))return;c.save();c.font='28px sans-serif';c.textAlign='center';c.textBaseline='middle';c.fillText(ITEMS[d.k][0],d.x,vy-14+bob);c.restore();}
function collectDrop(d){claim(d.id,1).then(r=>{if(r&&r.won===false){toast('✨ 被別人先撿走了');return;}stat.found++;save();if(r&&r.reward){toast('🎉 太幸運了！撿到的道具中獎，系統回饋你 1 點平台幣！');}else toast('✨ '+ITEMS[d.k][2]+'（累計撿到 '+stat.found+' 個）');const sel=api().selected();if(sel!==null&&sel!==undefined)api().mood(sel,'joy');});dirty();}
function collectNote(n){claim(n.id,1).then(r=>{if(r&&r.won===false){toast('📦 被別人先撿走了');return;}stat.notes++;save();toast(NOTES[n.k][1]+'（累計 '+stat.notes+' 件）');});dirty();}
/* ---------- 對外 ---------- */
window.funDraw=c=>{try{const t=performance.now(),g=api().geo();
  poops().forEach(p=>{if(taken(p.id)&&!flushing.has(p.id))return;drawPoop(c,p,t);});
  (g.proj||[]).forEach(p=>drawProj(c,p));
  notesNow().forEach(n=>drawNote(c,n));
  dropsNow().forEach(d=>drawDrop(c,d,t));
  if(prompt&&Date.now()<prompt.until)drawPrompt(c,prompt);else prompt=null;
  if(flushing.size||dropsNow().length)dirty();/* 有動畫時才持續重畫 */
}catch(e){}};
window.funSceneClick=(x,y,hit)=>{try{
  if(prompt&&prompt.rect&&x>=prompt.rect[0]&&x<=prompt.rect[0]+prompt.rect[2]&&y>=prompt.rect[1]&&y<=prompt.rect[1]+prompt.rect[3]){const p=prompt.p;prompt=null;flush(p);return true;}
  for(const d of dropsNow()){const vy=api().viewY(d.y);if(Math.abs(x-d.x)<26&&Math.abs(y-(vy-14))<30){collectDrop(d);return true;}}
  for(const n of notesNow()){if(Math.abs(x-n.x)<24&&Math.abs(y-n.y)<20){collectNote(n);return true;}}
  const g=api().geo();for(const p of g.proj||[]){const body=x>=p.x-6&&x<=p.x+p.w+6&&y>=p.y-6&&y<=p.y+p.h+6;let scr=false;if(!body&&projState(p).on){const rt=/right/.test(p.name),dn=/down/.test(p.name),oy=p.y+p.h/2,sx=dn?p.x+p.w/2-85:rt?p.x+p.w+36:p.x-36-170,sy=dn?p.y+p.h+30:oy-52;scr=x>=sx&&x<=sx+170&&y>=sy&&y<=sy+104;}/* 點投影畫面也能關 */if(body||scr){const st=projState(p);claim(st.id,st.on?0:1+Math.floor(Math.random()*SLIDE_N));toast(st.on?'📽️ 投影機關閉':'📽️ 投影機開啟');return true;}}
  /* 點到廁所裡、馬桶上有便便的人物：跳出「沖馬桶」 */
  const ps=poops().filter(q=>!taken(q.id));
  if(hit&&hit.i!==undefined){const pp=api().people()[hit.i];if(pp){const q=ps.find(q=>Math.abs(pp.x-(q.x+4))<70&&Math.abs(pp.vy-(q.y+32))<70);if(q)prompt={p:q,x:pp.x,y:pp.vy,until:Date.now()+6000};}}
  for(const q of ps){if(Math.abs(x-q.x)<24&&Math.abs(y-q.y)<24){flush(q);return true;}}
  return false;}catch(e){return false;}};
/* 走過去也能撿（只有自己操控的人）；時段換了就重畫 */
let lastSlot='';
setInterval(()=>{try{if(!api()||document.hidden)return;const sl=Math.floor(Date.now()/60000);if(String(sl)!==lastSlot){lastSlot=String(sl);dirty();}
  const sel=api().selected();if(sel===null||sel===undefined)return;const me=api().people().find(p=>p.i===sel);if(!me||me.away)return;
  for(const d of dropsNow()){if(Math.hypot(me.x-d.x,me.y-d.y)<46){collectDrop(d);break;}}}catch(e){}},700);
window.__fun={stat:()=>stat,poops,dropsNow,notesNow,claims:()=>claims};
})();

/* 茶水間冰箱：直接在場景裡開門。點冰箱→門轉開、架上的零食浮現，點零食拿一個；
   補貨＝把桌上的紙箱拖進冰箱。庫存、紙箱、每日自動進貨與排行都在 Worker（/minigames/fridge）；這裡只負責畫面。 */
(()=>{
const FOODS={
  chips:['洋芋片','🥔 喀滋喀滋！洋芋片超涮嘴','happy'],cookie:['餅乾','🍪 酥脆餅乾，配咖啡剛好','happy'],candy:['糖果','🍬 含顆糖，心情甜甜的','joy'],
  pudding:['布丁','🍮 Q彈布丁，幸福感滿格','joy'],yogurt:['優格','🥄 清爽優格，腸胃說謝謝','happy'],drink:['汽水','🥤 噗嗤～汽水氣泡好爽','happy'],
  rare:['限量金布丁','✨ 抽到限量金布丁！今天運氣爆棚','joy'],expired:['過期優格','🤢 吃到過期優格⋯⋯','sad'],
  boba:['珍珠奶茶','🧋 珍奶來一口，加班也有力氣','joy'],bento:['便當','🍱 開動！便當是午餐的靈魂','happy'],onigiri:['御飯糰','🍙 御飯糰，簡單的幸福','happy'],
  sandwich:['三明治','🥪 三明治，趕稿的好夥伴','happy'],energy:['提神飲料','⚡ 灌下提神飲料，血條回滿！','happy'],egg:['茶葉蛋','🥚 香噴噴茶葉蛋，整層樓都聞得到','happy'],
  noodle:['泡麵','🍜 泡麵三分鐘，等待的時間最漫長','happy'],coffee:['咖啡','☕ 咖啡續命，今天也要戰鬥','happy'],cake:['蛋糕','🍰 草莓蛋糕，有人過生日嗎？','joy'],
  donut:['甜甜圈','🍩 甜甜圈，熱量不算熱量','joy'],choco:['巧克力','🍫 巧克力讓大腦重新開機','joy']};
const NAMES=Object.fromEntries(Object.entries(FOODS).map(([k,v])=>[k,v[0]]));
const IDX={chips:0,cookie:1,candy:2,pudding:3,yogurt:4,drink:5,rare:6,expired:7,boba:8,bento:9,onigiri:10,sandwich:11,energy:12,egg:13,noodle:14,coffee:15,cake:16,donut:17,choco:18};
const FOOD='assets/office-foods-v1.webp?v=1',OPEN='assets/office-fridge-dark-open-v1.webp?v=1',ROOMS='assets/office-rooms-v3.webp?v=1',UI='assets/office-fridge-ui-v1.webp?v=1';
/* 兩台深色冰箱（各 82x170）左右對開：左台往左、右台往右開。每台 3 層、每層 3 格 */
const FR=[940,1095,82,170],SHELVES=[[['boba','bento','onigiri'],['sandwich','yogurt','pudding'],['drink','energy','egg']],[['chips','cookie','candy'],['noodle','coffee','cake'],['donut','choco','rare']]];
const SH_Y=[53,90,127],SH_X=[2,27,52],FOOD_PX=28,STRIDE=25,SWING=450,IDLE=30000,NEAR=[-150,150,40,200];// 站位範圍（相對冰箱左／右邊、上／下邊）
const BOX={w:60,h:50,x0:630,y:1154,gap:86,label:[14,22,24,24]},FRIDGE=[FR[0],FR[1],FR[2]*2,FR[3]];
const base=()=>new URLSearchParams(location.search).get('mgApi')?.replace(/\/$/,'')||(/^(localhost|127\.0\.0\.1)$/.test(location.hostname)?'http://127.0.0.1:8799':'https://machi-design-api.machi-chen.workers.dev');
const nick=()=>{try{return String(window.__pixelOffice.viewerName()||'').trim();}catch{return '';}};
const dirty=()=>{try{window.__pixelOffice.markDirty();}catch{}};
const img=src=>{const i=new Image();i.src=src;i.onload=dirty;return i;};
let state=null,busy=false,foodImg,openImg,roomsImg,uiImg,drag=null,openAt=0,bubble=null,idleTimer=0;
const ready=i=>i&&i.complete&&i.naturalWidth;
async function call(body){
  const r=await fetch(base()+'/minigames/fridge',{method:body?'POST':'GET',headers:body?{'Content-Type':'application/json'}:undefined,body:body?JSON.stringify(body):undefined});
  return {status:r.status,...(await r.json().catch(()=>({ok:false})))};
}
const setState=r=>{if(r&&r.stock){state=r;dirty();}};
const say=(text,icon)=>{bubble={text,icon,until:performance.now()+3800};dirty();};
/** 自己的人物是否站在冰箱前（沒有自己的人物＝不能開） */
const own=()=>{try{return window.__pixelOffice.ownPos();}catch{return null;}};
const nearFridge=p=>!!p&&p.x>=FRIDGE[0]+NEAR[0]&&p.x<=FRIDGE[0]+FRIDGE[2]+NEAR[1]&&p.y>=FRIDGE[1]+NEAR[2]&&p.y<=FRIDGE[1]+NEAR[3]+FRIDGE[3];
const isOpen=()=>openAt>0;
/** 每個食物格的位置（場景座標）；右台是左台的鏡像 */
function itemRects(){
  const st=state&&state.stock||{},out=[];
  SHELVES.forEach((rows,f)=>rows.forEach((row,r)=>row.forEach((id,c)=>{if(id==='rare'&&!(st.rare||0))return;
    const fx=FR[0]+f*FR[2],x=f?fx+FR[2]-SH_X[c]-FOOD_PX:fx+SH_X[c];
    out.push({id,x,y:FR[1]+SH_Y[r]-FOOD_PX,s:FOOD_PX,q:st[id]||0});})));
  return out;
}
function drawText(ctx,t,x,y,size,align='left'){ctx.font='bold '+size+'px system-ui,"PingFang TC","Microsoft JhengHei"';ctx.textAlign=align;ctx.textBaseline='top';ctx.lineWidth=4;ctx.strokeStyle='#000';ctx.lineJoin='round';ctx.strokeText(t,x,y);ctx.fillStyle='#fff';ctx.fillText(t,x,y);}
const flip=(ctx,im,sx,sy,sw,sh,x,y,w,h,mirror)=>{if(!mirror){ctx.drawImage(im,sx,sy,sw,sh,x,y,w,h);return;}ctx.save();ctx.translate(x+w,y);ctx.scale(-1,1);ctx.drawImage(im,sx,sy,sw,sh,0,y*0,w,h);ctx.restore();};
function drawFridge(ctx){
  const now=performance.now();
  ctx.save();ctx.imageSmoothingEnabled=false;
  if(isOpen()&&ready(openImg)&&ready(roomsImg)){
    const p=Math.min(1,(now-openAt)/SWING),e=1-Math.pow(1-p,3);
    for(const f of [0,1]){const fx=FR[0]+f*FR[2];
      flip(ctx,openImg,0,0,82,170,fx,FR[1],82,170,f===1);// 內部
      if(p>.4){ctx.globalAlpha=Math.min(1,(p-.4)/.4);flip(ctx,openImg,86,0,34,170,f?fx+FR[2]:fx-34,FR[1],34,170,f===1);ctx.globalAlpha=1;}// 打開的門
      if(p<1){const w=Math.max(2,Math.round(FR[2]*(1-e)));flip(ctx,roomsImg,166,354,82,170,f?fx+FR[2]-w:fx,FR[1],w,170,false);}}// 關著的門逐漸收成窄條
    if(p<1)dirty();
    if(ready(foodImg))for(const it of itemRects()){const a=Math.max(0,(p-.55)/.45);ctx.globalAlpha=a*(it.q?1:.3);
      ctx.drawImage(foodImg,IDX[it.id]*FOOD_PX,0,FOOD_PX,FOOD_PX,it.x,it.y-Math.round((1-a)*8),it.s,it.s);ctx.globalAlpha=1;
      if(it.q&&a>.9){const t=String(it.q);ctx.fillStyle='#000';ctx.fillRect(it.x+it.s-8,it.y-2,6+t.length*5,11);ctx.fillStyle='#fff';ctx.font='bold 9px system-ui';ctx.textAlign='left';ctx.textBaseline='top';ctx.fillText(t,it.x+it.s-5,it.y-1);}}
    if(p>=1){const b=state||{},info=['今日補貨：'+(b.stocker||'—'),b.kings&&b.kings[0]?'零食之王：'+b.kings[0].nick+' ×'+b.kings[0].n:'',b.heroes&&b.heroes[0]?'補貨英雄：'+b.heroes[0].nick+' ×'+b.heroes[0].n:''].filter(Boolean);
      info.forEach((t,i)=>drawText(ctx,t,FRIDGE[0]+FRIDGE[2]/2,FRIDGE[1]+FRIDGE[3]+6+i*15,12,'center'));}
  }
  if(bubble&&now<bubble.until){const t=bubble.text,y=FRIDGE[1]-52;ctx.font='bold 14px system-ui,"PingFang TC","Microsoft JhengHei"';const tw=Math.ceil(ctx.measureText(t).width)+(bubble.icon?44:16),x=Math.round(FRIDGE[0]+FRIDGE[2]/2-tw/2);
    ctx.fillStyle='#000';ctx.fillRect(x-3,y-3,tw+6,38);ctx.fillStyle='#fff';ctx.fillRect(x,y,tw,32);
    if(bubble.icon&&ready(foodImg))ctx.drawImage(foodImg,IDX[bubble.icon]*FOOD_PX,0,FOOD_PX,FOOD_PX,x+4,y+2,28,28);
    ctx.fillStyle='#111';ctx.textAlign='left';ctx.textBaseline='middle';ctx.fillText(t,x+(bubble.icon?36:8),y+17);dirty();}
  else if(bubble)bubble=null;
  ctx.restore();
}
function open(){
  if(isOpen())return true;
  const me=own();
  if(!me){say('要有自己的人物（先登入）才能開冰箱');return false;}
  if(!nearFridge(me)){say('走到冰箱前面才能開門喔');return false;}
  openAt=performance.now();dirty();touch();
  try{window.__pixelOffice.tempMood(me.i,'',SWING+200,'up');}catch{}
  call().then(setState,()=>say('連線失敗，等等再試'));return true;
}
function close(){if(!isOpen())return;openAt=0;clearTimeout(idleTimer);dirty();}
function touch(){clearTimeout(idleTimer);idleTimer=setTimeout(close,IDLE);}
window.fridgeIsOpen=isOpen;
window.openFridge=()=>{if(isOpen())close();else open();};
/** 場景點擊：回傳 true 代表這一下已被冰箱吃掉。 */
window.fridgeSceneClick=(x,y)=>{
  if(!isOpen())return false;
  const inside=x>=FRIDGE[0]-34&&x<=FRIDGE[0]+FRIDGE[2]+34&&y>=FRIDGE[1]&&y<=FRIDGE[1]+FRIDGE[3]+60;
  if(!inside){close();return false;}
  touch();if(performance.now()-openAt<SWING)return true;
  const hit=itemRects().find(it=>x>=it.x-1&&x<=it.x+it.s+1&&y>=it.y&&y<=it.y+it.s);
  if(hit){if(!nearFridge(own())){say('站太遠了，走近一點');close();return true;}act({action:'take',slot:hit.id});}
  return true;
};
/** 人物走遠就自動關門 */
setInterval(()=>{if(isOpen()&&!nearFridge(own())){close();say('你走遠了，冰箱門自動關上');}},500);
const react=(mood,ms=3200)=>{const me=own();if(me)try{window.__pixelOffice.tempMood(me.i,mood,ms,'up');}catch{}};
async function act(body){
  if(busy)return;busy=true;
  try{
    const r=await call({...body,nick:nick()||'匿名'});setState(r);
    if(r.ok&&body.action==='take'){
      const f=FOODS[body.slot];
      if(r.caught){say('🚨 被抓到下班偷吃「'+f[0]+'」！',body.slot);react('angry');}
      else if(r.surprise==='rare'){say(FOODS.rare[1],'rare');react('joy',4200);}
      else if(r.surprise==='expired'){say(FOODS.expired[1],'expired');react('sad',4200);}
      else{say(f[1],body.slot);react(f[2]);}
    }else if(r.ok){say('🦸 「'+NAMES[body.slot]+'」補貨完成 +3！',body.slot);react('joy');}
    else say(r.error==='empty'?'😢 空了⋯⋯等人搬紙箱來補貨':r.error==='full-stomach'?'🤰 你今天吃太多了':r.error==='enough'?'🙏 今天補太多次了，謝謝你！':r.error==='no-box'?'📦 那箱被別人搬走了':'發生一點問題，等等再試');
  }catch{say('連線失敗，等等再試');}finally{busy=false;}
}
document.addEventListener('keydown',e=>{if(e.key==='Escape')close();});
/* ───── 茶水間桌上的紙箱（畫在場景裡，可拖進冰箱）───── */
const boxes=()=>((state&&state.boxes)||[]);
const boxRect=i=>[BOX.x0+i*BOX.gap,BOX.y,BOX.w,BOX.h];
function drawBox(ctx,i,slot,x,y,lift){
  if(!ready(uiImg))return;
  ctx.save();ctx.imageSmoothingEnabled=false;
  if(lift){ctx.fillStyle='rgba(0,0,0,.25)';ctx.fillRect(x+4,y+BOX.h-2,BOX.w,6);}
  ctx.drawImage(uiImg,772,66+(i%3)*126,72,60,x,y,BOX.w,BOX.h);
  if(ready(foodImg))ctx.drawImage(foodImg,(IDX[slot]??0)*FOOD_PX,0,FOOD_PX,FOOD_PX,x+BOX.label[0],y+BOX.label[1],BOX.label[2],BOX.label[3]);
  ctx.restore();
}
window.fridgeBoxDraw=(ctx,top)=>{
  if(!uiImg)return;const list=boxes();
  if(top==='fridge'){drawFridge(ctx);return;}
  if(!top)list.forEach((slot,i)=>{if(!(drag&&drag.i===i)){const r=boxRect(i);drawBox(ctx,i,slot,r[0],r[1],false);}});
  else if(drag)drawBox(ctx,drag.i,boxes()[drag.i],drag.x-BOX.w/2,drag.y-BOX.h/2,true);
};
const inRect=(x,y,r)=>x>=r[0]&&x<=r[2]+r[0]&&y>=r[1]&&y<=r[3]+r[1];
const inFridge=(x,y)=>x>=FRIDGE[0]-40&&x<=FRIDGE[0]+FRIDGE[2]+40&&y>=FRIDGE[1]-60&&y<=FRIDGE[1]+FRIDGE[3];
/** 回傳 true 代表這次按下是在抓紙箱，場景不要再處理（選人／平移）。 */
window.fridgeBoxDown=(e,pt)=>{
  if(!boxes().length||busy)return false;
  const i=boxes().findIndex((_,k)=>inRect(pt.x,pt.y,boxRect(k)));if(i<0)return false;
  const po=window.__pixelOffice,game=po.game;drag={i,x:pt.x,y:pt.y,slot:boxes()[i]};try{game.setPointerCapture(e.pointerId);}catch{}po.markDirty();
  const mv=m=>{const p=po.toScene(m.clientX,m.clientY,game.getBoundingClientRect());drag.x=p.x;drag.y=p.y;po.markDirty();m.preventDefault();};
  const up=u=>{window.removeEventListener('pointermove',mv);window.removeEventListener('pointerup',up);window.removeEventListener('pointercancel',up);
    const d=drag;drag=null;po.markDirty();
    if(u.type==='pointerup'&&d&&inFridge(d.x,d.y)){if(!open()&&!isOpen())return;const list=boxes().slice();list.splice(d.i,1);if(state)state.boxes=list;setTimeout(()=>act({action:'box',slot:d.slot}),isOpen()?SWING:0);}};
  window.addEventListener('pointermove',mv,{passive:false});window.addEventListener('pointerup',up);window.addEventListener('pointercancel',up);
  return true;
};
(()=>{
  foodImg=img(FOOD);openImg=img(OPEN);roomsImg=img(ROOMS);uiImg=img(UI);
  if(/[?&]floor=4/.test(location.search))return;
  const poll=async()=>{if(document.hidden||drag||busy)return;try{setState(await call());}catch{}};
  setTimeout(poll,2500);setInterval(poll,90000);document.addEventListener('visibilitychange',()=>{if(!document.hidden)poll();});
})();
})();

/* 茶水間冰箱：直接在場景裡開門。點冰箱→門轉開、架上的零食浮現，點零食拿一個；
   補貨＝把桌上的紙箱拖進冰箱。庫存、紙箱、每日自動進貨與排行都在 Worker（/minigames/fridge）；這裡只負責畫面。 */
(()=>{
const NAMES={chips:'洋芋片',cookie:'餅乾',candy:'糖果',pudding:'布丁',yogurt:'優格',drink:'汽水',rare:'限量金布丁',expired:'過期優格'};
const SHELF=[['chips','cookie','candy'],['pudding','yogurt','drink'],['rare']];
const IDX={chips:0,cookie:1,candy:2,pudding:3,yogurt:4,drink:5,rare:6,expired:7};
const SNACK='assets/office-snacks-v1.webp?v=1',UI='assets/office-fridge-ui-v1.webp?v=1';
const SH_Y=[118,214,310],SH_X=[33,287],S=.7,SWING=450,IDLE=30000;// 層架上表面（inside 內座標）、開門放大倍率
const BOX={w:60,h:50,x0:630,y:1154,gap:86,label:[14,22,23,23]},FRIDGE=[940,1095,164,170],TABLE=[620,1095,1104,1265];
const base=()=>new URLSearchParams(location.search).get('mgApi')?.replace(/\/$/,'')||(/^(localhost|127\.0\.0\.1)$/.test(location.hostname)?'http://127.0.0.1:8799':'https://machi-design-api.machi-chen.workers.dev');
const nick=()=>{try{return String(window.__pixelOffice.viewerName()||'').trim();}catch{return '';}};
const isMonitor=()=>{try{return !!window.__pixelOffice.isMonitor();}catch{return false;}};
const dirty=()=>{try{window.__pixelOffice.markDirty();}catch{}};
const img=src=>{const i=new Image();i.src=src;i.onload=dirty;return i;};
let state=null,busy=false,snackImg,uiImg,drag=null,openAt=0,lastTouch=0,bubble=null,idleTimer=0;
const ready=i=>i&&i.complete&&i.naturalWidth;
async function call(body){
  const r=await fetch(base()+'/minigames/fridge',{method:body?'POST':'GET',headers:body?{'Content-Type':'application/json'}:undefined,body:body?JSON.stringify(body):undefined});
  return {status:r.status,...(await r.json().catch(()=>({ok:false})))};
}
const setState=r=>{if(r&&r.stock){state=r;dirty();}};
const say=(text,icon)=>{bubble={text,icon,until:performance.now()+3800};dirty();};
/* ───── 開門的冰箱（畫在場景裡）───── */
const geo=()=>{const w=Math.round(320*S),h=Math.round(420*S),dw=Math.round(70*S),left=Math.round(FRIDGE[0]+FRIDGE[2]/2-(w+dw)/2),top=FRIDGE[1]+FRIDGE[3]-h;return {w,h,dw,left,top,ix:left+dw};};
const isOpen=()=>openAt>0;
function itemRects(){
  const g=geo(),icon=Math.round(48*S),out=[];
  SHELF.forEach((row,r)=>row.forEach((id,c)=>{const st=state&&state.stock||{};if(id==='rare'&&!(st.rare||0))return;
    const n=row.length,sw=(SH_X[1]-SH_X[0])*S,x=g.ix+SH_X[0]*S+sw/n*(c+.5)-icon/2,y=g.top+(SH_Y[r]+6)*S-icon;
    out.push({id,x:Math.round(x),y:Math.round(y),s:icon,q:st[id]||0});}));
  return out;
}
const fillBtn=()=>{const g=geo();return {x:g.ix+g.w-74,y:g.top+g.h+6,w:74,h:22};};
function drawText(ctx,t,x,y,size,align='left'){ctx.font='bold '+size+'px system-ui,"PingFang TC","Microsoft JhengHei"';ctx.textAlign=align;ctx.textBaseline='top';ctx.lineWidth=4;ctx.strokeStyle='#000';ctx.lineJoin='round';ctx.strokeText(t,x,y);ctx.fillStyle='#fff';ctx.fillText(t,x,y);}
function drawFridge(ctx){
  if(!isOpen()||!ready(uiImg))return;
  const now=performance.now(),p=Math.min(1,(now-openAt)/SWING),e=1-Math.pow(1-p,3),g=geo();
  ctx.save();ctx.imageSmoothingEnabled=false;
  ctx.drawImage(uiImg,348,12,320,420,g.ix,g.top,g.w,g.h);// 內部
  if(p>.45){ctx.globalAlpha=Math.min(1,(p-.45)/.4);ctx.drawImage(uiImg,684,12,70,420,g.left,g.top,g.dw,g.h);ctx.globalAlpha=1;}// 打開的門（側面）
  if(ready(snackImg)){const st=state&&state.stock||{};
    for(const it of itemRects()){const a=Math.max(0,(p-.5)*2);ctx.globalAlpha=a*(it.q?1:.35);
      ctx.drawImage(snackImg,IDX[it.id]*64,0,64,64,it.x,it.y-Math.round((1-a)*10),it.s,it.s);ctx.globalAlpha=1;
      if(it.q&&a>.9){ctx.fillStyle='#000';const t=String(it.q);ctx.fillRect(it.x+it.s-9,it.y-3,8+t.length*6,13);ctx.fillStyle='#fff';ctx.font='bold 10px system-ui';ctx.textAlign='left';ctx.textBaseline='top';ctx.fillText(t,it.x+it.s-6,it.y-2);}}}
  if(p<1){const dw=Math.max(2,Math.round(g.w*(1-e)));ctx.drawImage(uiImg,12,12,320,420,g.ix,g.top,dw,g.h);dirty();}// 關著的門逐漸收成窄條
  if(p>=1){
    const b=state||{},info=['今日補貨：'+(b.stocker||'—'),b.kings&&b.kings[0]?'零食之王：'+b.kings[0].nick+' ×'+b.kings[0].n:'',b.heroes&&b.heroes[0]?'補貨英雄：'+b.heroes[0].nick+' ×'+b.heroes[0].n:''].filter(Boolean);
    info.forEach((t,i)=>drawText(ctx,t,g.ix+g.w/2,g.top+g.h+6+(isMonitor()?28:0)+i*15,12,'center'));
    if(isMonitor()){const f=fillBtn();ctx.fillStyle='#000';ctx.fillRect(f.x-3,f.y-3,f.w+6,f.h+6);ctx.fillStyle='#ffd23f';ctx.fillRect(f.x,f.y,f.w,f.h);ctx.fillStyle='#000';ctx.font='bold 12px system-ui,"PingFang TC"';ctx.textAlign='center';ctx.textBaseline='middle';ctx.fillText('一鍵補滿',f.x+f.w/2,f.y+f.h/2+1);}
  }
  if(bubble&&now<bubble.until){const t=bubble.text,y=g.top-38;ctx.font='bold 14px system-ui,"PingFang TC","Microsoft JhengHei"';const tw=Math.ceil(ctx.measureText(t).width)+(bubble.icon?44:16),x=Math.round(g.ix+g.w/2-tw/2);
    ctx.fillStyle='#000';ctx.fillRect(x-3,y-3,tw+6,38);ctx.fillStyle='#fff';ctx.fillRect(x,y,tw,32);
    if(bubble.icon&&ready(snackImg))ctx.drawImage(snackImg,IDX[bubble.icon]*64,0,64,64,x+4,y+2,28,28);
    ctx.fillStyle='#111';ctx.textAlign='left';ctx.textBaseline='middle';ctx.fillText(t,x+(bubble.icon?36:8),y+17);dirty();}
  else if(bubble)bubble=null;
  ctx.restore();
}
function open(){
  if(isOpen())return;openAt=performance.now();dirty();touch();
  call().then(setState,()=>say('連線失敗，等等再試'));
}
function close(){if(!isOpen())return;openAt=0;bubble=null;clearTimeout(idleTimer);dirty();}
function touch(){clearTimeout(idleTimer);idleTimer=setTimeout(close,IDLE);}
window.fridgeIsOpen=isOpen;
window.openFridge=()=>{if(isOpen())close();else open();};
/** 場景點擊：回傳 true 代表這一下已被冰箱吃掉。 */
window.fridgeSceneClick=(x,y)=>{
  if(!isOpen())return false;
  const g=geo(),inside=x>=g.left&&x<=g.ix+g.w&&y>=g.top&&y<=g.top+g.h+80;
  if(!inside){close();return false;}
  touch();if(performance.now()-openAt<SWING)return true;
  const hit=itemRects().find(it=>x>=it.x&&x<=it.x+it.s&&y>=it.y&&y<=it.y+it.s);
  if(hit)act({action:'take',slot:hit.id});
  else if(isMonitor()){const f=fillBtn();if(x>=f.x&&x<=f.x+f.w&&y>=f.y&&y<=f.y+f.h)act({action:'fill'});}
  return true;
};
async function act(body){
  if(busy)return;busy=true;
  try{
    const r=await call({...body,nick:nick()||'匿名'});setState(r);
    if(r.ok&&body.action==='take'){
      if(r.caught)say('🚨 被抓到下班偷吃「'+NAMES[body.slot]+'」！',body.slot);
      else if(r.surprise==='rare')say('✨ 抽到限量金布丁！今天運氣爆棚','rare');
      else if(r.surprise==='expired')say('🤢 吃到過期優格⋯⋯','expired');
      else say('😋 好吃！拿了一個'+NAMES[body.slot],body.slot);
    }else if(r.ok)say(body.action==='fill'?'🦸 全部補滿！':'🦸 「'+NAMES[body.slot]+'」補貨完成 +3！',body.slot);
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
  if(ready(snackImg))ctx.drawImage(snackImg,(IDX[slot]??0)*64,0,64,64,x+BOX.label[0],y+BOX.label[1],BOX.label[2],BOX.label[3]);
  ctx.restore();
}
window.fridgeBoxDraw=(ctx,top)=>{
  if(!uiImg)return;const list=boxes();
  if(top==='fridge'){drawFridge(ctx);return;}
  if(!top)list.forEach((slot,i)=>{if(!(drag&&drag.i===i)){const r=boxRect(i);drawBox(ctx,i,slot,r[0],r[1],false);}});
  else if(drag)drawBox(ctx,drag.i,boxes()[drag.i],drag.x-BOX.w/2,drag.y-BOX.h/2,true);
};
const inRect=(x,y,r)=>x>=r[0]&&x<=r[2]+r[0]&&y>=r[1]&&y<=r[3]+r[1];
const inFridge=(x,y)=>x>=FRIDGE[0]-60&&x<=FRIDGE[0]+FRIDGE[2]+60&&y>=FRIDGE[1]-120&&y<=FRIDGE[1]+FRIDGE[3];
/** 回傳 true 代表這次按下是在抓紙箱，場景不要再處理（選人／平移）。 */
window.fridgeBoxDown=(e,pt)=>{
  if(!boxes().length||busy)return false;
  const i=boxes().findIndex((_,k)=>inRect(pt.x,pt.y,boxRect(k)));if(i<0)return false;
  const po=window.__pixelOffice,game=po.game;drag={i,x:pt.x,y:pt.y,slot:boxes()[i]};try{game.setPointerCapture(e.pointerId);}catch{}po.markDirty();
  const mv=m=>{const p=po.toScene(m.clientX,m.clientY,game.getBoundingClientRect());drag.x=p.x;drag.y=p.y;po.markDirty();m.preventDefault();};
  const up=u=>{window.removeEventListener('pointermove',mv);window.removeEventListener('pointerup',up);window.removeEventListener('pointercancel',up);
    const d=drag;drag=null;po.markDirty();
    if(u.type==='pointerup'&&d&&inFridge(d.x,d.y)){const list=boxes().slice();list.splice(d.i,1);if(state)state.boxes=list;open();setTimeout(()=>act({action:'box',slot:d.slot}),SWING);}};
  window.addEventListener('pointermove',mv,{passive:false});window.addEventListener('pointerup',up);window.addEventListener('pointercancel',up);
  return true;
};
(()=>{
  snackImg=img(SNACK);uiImg=img(UI);
  if(/[?&]floor=4/.test(location.search))return;
  const poll=async()=>{if(document.hidden||drag||busy)return;try{setState(await call());}catch{}};
  setTimeout(poll,2500);setInterval(poll,90000);document.addEventListener('visibilitychange',()=>{if(!document.hidden)poll();});
})();
})();

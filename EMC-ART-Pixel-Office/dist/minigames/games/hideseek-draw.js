// 辦公室躲貓貓的共用繪製（單機與連線版共用同一套畫面）。
// 底圖是真實辦公室（tools/capture-office-map.mjs 擷取，半尺寸）；人物用現有五位同事的原圖（不修改）；
// 人物走到家具後面時，把那件家具的底圖再畫一次蓋在人物上（深度排序），家具維持原尺寸、原位置、原角度。
import {MAP,RULES} from './hideseek-sim.js';

const art={map:null,chars:null,ready:false,failed:false};
const base=()=>new URL('../../',import.meta.url).href;   // …/dist/
/** 載入底圖與人物圖；沒載入完成時 drawBoard 會畫簡單的色塊，不會出錯。 */
export function loadArt(onReady){
  if(art.map)return art;
  const mk=src=>{const i=new Image();i.src=base()+src;return i;};
  art.map=mk(MAP.image.file+'?v=1');art.chars=mk('assets/sprites-packed.webp?v=1');
  Promise.all([art.map,art.chars].map(i=>i.decode?i.decode():new Promise((ok,no)=>{i.onload=ok;i.onerror=no;}))).then(()=>{art.ready=true;if(onReady)onReady();}).catch(()=>{art.failed=true;});
  return art;
}
export const artReady=()=>art.ready;

export const tag=(g,text,x,y,col)=>{g.font='700 12px sans-serif';g.textAlign='center';const w=g.measureText(text).width+8;g.fillStyle=col;g.fillRect(Math.round(x-w/2),Math.round(y-13),Math.round(w),16);g.fillStyle='#fff';g.fillText(text,x,y-1);};

/**
 * 世界座標 → 畫布。mode 'full'：整層縮到放得下；'follow'：以 focus 為中心，約顯示 1500 世界像素寬（手機較窄時縮小到至少看得到視野）。
 */
export function makeView(ctx,hudTop,mode='full',focus=null){
  const V=MAP.view,availH=Math.max(10,ctx.height-hudTop-8),fullS=Math.max(.02,Math.min(ctx.width/V.w,availH/V.h));
  if(mode==='full'||!focus)return {s:fullS,ox:(ctx.width-V.w*fullS)/2-V.x*fullS,oy:hudTop+(availH-V.h*fullS)/2-V.y*fullS,mode:'full'};
  const s=Math.max(fullS,Math.min(ctx.width,availH)/900);
  /* 玩家可走的範圍（V）小於畫面就置中，否則鏡頭不超出 V */
  const clamp=(o,pos,size,view)=>size*s<=view?(view-size*s)/2-pos*s:Math.max(view-(pos+size)*s,Math.min(-pos*s,o));
  return {s,ox:clamp(ctx.width/2-focus.x*s,V.x,V.w,ctx.width),oy:hudTop+clamp(availH/2-focus.y*s,V.y,V.h,availH),mode:'follow'};
}
export const toCanvas=(v,x,y)=>({x:v.ox+x*v.s,y:v.oy+y*v.s});
export const toWorld=(v,x,y)=>({x:(x-v.ox)/v.s,y:(y-v.oy)/v.s});

/** 底圖與遮蔽區域提示。 */
export function drawBoard(g,ctx,v,{showZones=true}={}){
  g.imageSmoothingEnabled=false;
  g.fillStyle='#e9eef7';g.fillRect(0,0,ctx.width,ctx.height);
  if(art.ready){g.imageSmoothingEnabled=true;g.imageSmoothingQuality='high';{const V=MAP.view,k=art.map.naturalWidth/MAP.w;g.drawImage(art.map,V.x*k,V.y*k,V.w*k,V.h*k,v.ox+V.x*v.s,v.oy+V.y*v.s,V.w*v.s,V.h*v.s);}g.imageSmoothingEnabled=false;}
  else{g.fillStyle='#fff';g.fillRect(v.ox+MAP.view.x*v.s,v.oy+MAP.view.y*v.s,MAP.view.w*v.s,MAP.view.h*v.s);for(const s of MAP.solids){g.fillStyle=s.tall?'#3a4a68':'#8c98ad';g.fillRect(v.ox+s.x*v.s,v.oy+s.y*v.s,s.w*v.s,s.h*v.s);}}
  if(showZones){
    g.setLineDash([6,5]);g.lineWidth=2;g.strokeStyle='rgba(76,175,106,.85)';g.fillStyle='rgba(76,175,106,.10)';
    for(const z of MAP.zones){const x=v.ox+z.x*v.s,y=v.oy+z.y*v.s,w=z.w*v.s,h=z.h*v.s;if(x>ctx.width||y>ctx.height||x+w<0||y+h<0)continue;g.fillRect(x,y,w,h);g.strokeRect(x,y,w,h);}
    g.setLineDash([]);
  }
}

// 人物：現有五位同事的原圖（sprites-packed.webp：每格 140 寬、各列起點如下，正面／右側面／背面）。第 6 位沿用第 5 位的圖，靠名牌顏色區分。
const ROW_Y=[0,192,381,572,757],ROW_H=[190,189,190,190,189],CELL_W=140,DRAW_H=142;   // 場景裡人物約 142 px 高
const AVATAR_ROWS=[4,3,2,1,0,4];
const motion=new Map();// id → {x,y,face,t}：由位置變化推出朝向與走路動畫（協定不需要多傳朝向）
export function resetMotion(){motion.clear();}
export function noteMotion(id,x,y,now){
  let m=motion.get(id);if(!m){m={x,y,face:'down',moving:0,t:now};motion.set(id,m);return m;}
  const dx=x-m.x,dy=y-m.y;
  if(Math.hypot(dx,dy)>1.2){m.face=Math.abs(dx)>Math.abs(dy)?(dx>0?'right':'left'):(dy>0?'down':'up');m.moving=now;}
  m.x=x;m.y=y;return m;
}

/** 一位玩家：{id,x,y,color,name,role,index}；opts.me 加黃圈、opts.ghost 被抓（半透明）、opts.faded 躲在遮蔽區（半透明）、opts.now 毫秒。 */
export function drawPerson(g,v,p,opts={}){
  const x=v.ox+p.x*v.s,y=v.oy+p.y*v.s,now=opts.now||0,m=noteMotion(p.id,p.x,p.y,now),walking=now-m.moving<180;
  g.globalAlpha=opts.ghost?.35:(opts.faded?.55:1);
  const row=AVATAR_ROWS[(p.index||0)%AVATAR_ROWS.length];
  if(art.ready){
    const col=m.face==='up'?2:(m.face==='down'?0:1),sc=DRAW_H/ROW_H[row]*v.s,w=CELL_W*sc,h=ROW_H[row]*sc,bob=walking?Math.abs(Math.sin(now/90))*4*v.s:0;
    g.save();g.imageSmoothingEnabled=false;g.translate(x,y-bob);if(m.face==='left')g.scale(-1,1);
    g.drawImage(art.chars,col*CELL_W,ROW_Y[row],CELL_W,ROW_H[row],-w/2,-h+6*v.s,w,h);g.restore();
  }else{const r=RULES.r*v.s;g.fillStyle=p.color;g.fillRect(x-r,y-r*2,r*2,r*2);}
  g.globalAlpha=1;
  const top=y-DRAW_H*v.s-4;
  if(opts.me){g.strokeStyle='#ffd24a';g.lineWidth=3;g.beginPath();g.ellipse(x,y,RULES.r*v.s*1.5,RULES.r*v.s*.6,0,0,Math.PI*2);g.stroke();}
  tag(g,p.name+(p.role==='seeker'?'（尋找者）':''),x,top,p.role==='seeker'?'#d9534f':(p.color||'#182e54'));
}

/**
 * 深度排序繪製：人物與「家具遮擋圖層」一起依深度（腳底 y）排序。
 * entities：[{depth,draw}]。遮擋圖層只畫畫面內的，並且只在底圖載入完成後才有。
 */
export function drawSorted(g,ctx,v,entities){
  const list=entities.slice();
  if(art.ready){
    const k=art.map.naturalWidth/MAP.w;
    for(const o of MAP.occluders){
      const x=v.ox+o.x*v.s,y=v.oy+o.y*v.s,w=o.w*v.s,h=o.h*v.s;
      if(x>ctx.width||y>ctx.height||x+w<0||y+h<0)continue;
      list.push({depth:o.depth,draw:()=>{g.imageSmoothingEnabled=true;g.drawImage(art.map,o.x*k,o.y*k,o.w*k,o.h*k,x,y,w,h);g.imageSmoothingEnabled=false;}});
    }
  }
  list.sort((a,b)=>a.depth-b.depth);
  for(const e of list)e.draw();
}

/** 迷霧：視野圈外壓暗（尋找者）。 */
export function drawFog(g,ctx,v,center,radius,hudTop){
  const c=toCanvas(v,center.x,center.y);
  g.save();g.fillStyle='rgba(24,46,84,.5)';g.beginPath();g.rect(0,hudTop,ctx.width,ctx.height-hudTop);g.arc(c.x,c.y,radius*v.s,0,Math.PI*2,true);g.fill('evenodd');
  g.strokeStyle='rgba(217,83,79,.45)';g.lineWidth=2;g.setLineDash([4,6]);g.beginPath();g.arc(c.x,c.y,radius*v.s,0,Math.PI*2);g.stroke();g.restore();
}

/** 小地圖（右上角）：整層縮圖、自己（黃）、其他可見的人、目前視野框。 */
export function drawMinimap(g,ctx,v,hudTop,dots){
  const V=MAP.view,mw=Math.min(84,ctx.width*.22),mh=mw*V.h/V.w,x0=ctx.width-mw-8,y0=hudTop+8,k=mw/V.w;
  g.save();g.globalAlpha=.92;g.fillStyle='#fff';g.fillRect(x0-2,y0-2,mw+4,mh+4);
  if(art.ready){const ik=art.map.naturalWidth/MAP.w;g.drawImage(art.map,V.x*ik,V.y*ik,V.w*ik,V.h*ik,x0,y0,mw,mh);}
  g.globalAlpha=1;g.strokeStyle='#182e54';g.lineWidth=2;g.strokeRect(x0-2,y0-2,mw+4,mh+4);
  if(v.mode==='follow'){g.strokeStyle='#e8913a';g.lineWidth=1.5;g.strokeRect(x0+((-v.ox/v.s)-V.x)*k,y0+((-(v.oy-hudTop)/v.s)-V.y)*k,(ctx.width/v.s)*k,((ctx.height-hudTop)/v.s)*k);}
  for(const d of dots){g.fillStyle=d.color;g.beginPath();g.arc(x0+(d.x-V.x)*k,y0+(d.y-V.y)*k,d.me?3.5:2.5,0,Math.PI*2);g.fill();}
  g.restore();
  return {x:x0,y:y0,w:mw,h:mh};
}

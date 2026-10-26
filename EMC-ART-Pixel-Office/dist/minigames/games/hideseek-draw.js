// 辦公室躲貓貓的共用繪製（單機與連線版共用同一套畫面）。
import {MAP,RULES} from './hideseek-sim.js';

export const tag=(g,text,x,y,col)=>{g.font='700 12px sans-serif';g.textAlign='center';const w=g.measureText(text).width+8;g.fillStyle=col;g.fillRect(Math.round(x-w/2),Math.round(y-13),Math.round(w),16);g.fillStyle='#fff';g.fillText(text,x,y-1);};

/** 世界座標 → 畫布：等比縮放並置中，上方留給 HUD。 */
export function fitView(ctx,hudTop){
  const availH=ctx.height-hudTop-8,sc=Math.min(ctx.width/MAP.w,availH/MAP.h);
  return {s:sc,ox:(ctx.width-MAP.w*sc)/2,oy:hudTop+(availH-MAP.h*sc)/2};
}

/** 地板、格線、牆、遮蔽區域與家具。 */
export function drawBoard(g,ctx,v){
  const X=x=>v.ox+x*v.s,Y=y=>v.oy+y*v.s,R=(x,y,w,h,c)=>{g.fillStyle=c;g.fillRect(Math.round(X(x)),Math.round(Y(y)),Math.ceil(w*v.s),Math.ceil(h*v.s));};
  g.imageSmoothingEnabled=false;
  g.fillStyle='rgba(238,243,251,.98)';g.fillRect(0,0,ctx.width,ctx.height);
  R(MAP.bounds.x,MAP.bounds.y,MAP.bounds.w,MAP.bounds.h,'#f7f9fd');
  g.strokeStyle='rgba(24,46,84,.08)';g.lineWidth=1;
  for(let x=MAP.bounds.x;x<=MAP.bounds.x+MAP.bounds.w;x+=40){g.beginPath();g.moveTo(X(x)+.5,Y(MAP.bounds.y));g.lineTo(X(x)+.5,Y(MAP.bounds.y+MAP.bounds.h));g.stroke();}
  for(let y=MAP.bounds.y;y<=MAP.bounds.y+MAP.bounds.h;y+=40){g.beginPath();g.moveTo(X(MAP.bounds.x),Y(y)+.5);g.lineTo(X(MAP.bounds.x+MAP.bounds.w),Y(y)+.5);g.stroke();}
  g.strokeStyle='#182e54';g.lineWidth=4;g.strokeRect(X(MAP.bounds.x),Y(MAP.bounds.y),MAP.bounds.w*v.s,MAP.bounds.h*v.s);
  g.setLineDash([6,5]);g.strokeStyle='rgba(76,175,106,.9)';g.lineWidth=2;
  for(const z of MAP.zones){R(z.x,z.y,z.w,z.h,'rgba(76,175,106,.12)');g.strokeRect(X(z.x),Y(z.y),z.w*v.s,z.h*v.s);}
  g.setLineDash([]);
  const col={cabinet:'#3a4a68',shelf:'#3a4a68',partition:'#182e54',desk:'#8c98ad',table:'#a4afc2',sofa:'#b66a5a',plant:'#4caf6a'};
  for(const o of MAP.solids){R(o.x,o.y,o.w,o.h,col[o.kind]||'#8c98ad');g.strokeStyle='#182e54';g.lineWidth=2;g.strokeRect(X(o.x),Y(o.y),o.w*v.s,o.h*v.s);}
}

/** 一位玩家：{x,y,color,name,role,id}；opts.me 加黃圈、opts.ghost 被抓（半透明）、opts.faded 躲在遮蔽區（半透明）。 */
export function drawPerson(g,v,p,opts={}){
  const x=v.ox+p.x*v.s,y=v.oy+p.y*v.s,r=RULES.r*v.s;
  g.globalAlpha=opts.ghost?.35:(opts.faded?.55:1);
  g.fillStyle=p.color;g.fillRect(Math.round(x-r),Math.round(y-r*.2),Math.round(r*2),Math.round(r*1.4));// 身體
  g.fillStyle='#ffe0bd';g.fillRect(Math.round(x-r*.7),Math.round(y-r*1.5),Math.round(r*1.4),Math.round(r*1.3));// 頭
  g.strokeStyle='#182e54';g.lineWidth=2;g.strokeRect(Math.round(x-r),Math.round(y-r*.2),Math.round(r*2),Math.round(r*1.4));
  g.globalAlpha=1;
  if(opts.me){g.strokeStyle='#ffd24a';g.lineWidth=3;g.beginPath();g.ellipse(x,y+r*1.3,r*1.5,r*.5,0,0,Math.PI*2);g.stroke();}
  tag(g,p.name+(p.role==='seeker'?'（尋找者）':''),x,y-r*1.7,p.role==='seeker'?'#d9534f':'#182e54');
}

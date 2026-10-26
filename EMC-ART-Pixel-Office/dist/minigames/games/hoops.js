// 廢紙投籃：60 秒內把紙團投進垃圾桶。拖曳（滑鼠／觸控）決定方向與力道，放開投出。
import {GEO,launchVelocity,pointsFor,createBall,stepBall,previewPath,binXAt,makeWindSchedule,windAt,PHASES} from './hoops-sim.js';

const HUD_TOP=60,BALL_ROWS=['....kkkk....','..kkwwwwkk..','.kwwwswwwwk.','.kwswwwwswk.','kwwwwwswwwwk','kwswwwwwwwsk','kwwwwswwwwwk','kwwwwwwwswwk','.kwwswwwwwk.','.kwwwwwswwk.','..kkwwwwkk..','....kkkk....'];
const COL={k:'#182e54',w:'#ffffff',s:'#c9d2e0'};

function ballSprite(){
  const c=document.createElement('canvas');c.width=12;c.height=12;const g=c.getContext('2d');
  BALL_ROWS.forEach((row,y)=>{for(let x=0;x<12;x++){const col=COL[row[x]];if(col){g.fillStyle=col;g.fillRect(x,y,1,1);}}});
  return c;
}

export const hoopsGame={
  id:'hoops',title:'廢紙投籃',duration:60,
  start(ctx){
    this.state={
      t:0,ball:null,wait:0,drag:null,sprite:ballSprite(),fx:[],combo:0,bestCombo:0,
      shots:0,makes:0,swishes:0,log:[],wind:0,
      windSchedule:makeWindSchedule(ctx.rngFor('wind'),this.duration),binX:GEO.binBaseX,view:{s:1,ox:0,oy:0}
    };
    this.fit(ctx);this.spawn();
    ctx.input.on('down',p=>{const s=this.state;if((s.ball&&!s.ball.idle)||s.wait>0||ctx.timeLeft<=0)return;s.drag={ox:p.x,oy:p.y,x:p.x,y:p.y,id:p.id};});
    ctx.input.on('move',p=>{const d=this.state.drag;if(d&&d.id===p.id){d.x=p.x;d.y=p.y;}});
    ctx.input.on('up',p=>this.release(ctx,p));
  },
  resize(ctx){this.fit(ctx);},
  // 世界座標 → 畫布：等比縮放並置中，上方留給 HUD
  fit(ctx){
    const s=this.state;if(!s)return;
    const availH=ctx.height-HUD_TOP-8,sc=Math.min(ctx.width/GEO.W,availH/GEO.H);
    s.view={s:sc,ox:(ctx.width-GEO.W*sc)/2,oy:HUD_TOP+(availH-GEO.H*sc)/2};
  },
  toWorld(x,y){const v=this.state.view;return {x:(x-v.ox)/v.s,y:(y-v.oy)/v.s};},
  spawn(){const s=this.state;s.ball={x:GEO.start.x,y:GEO.start.y,vx:0,vy:0,idle:true,done:false,touched:false,age:0,spin:0};},
  release(ctx,p){
    const s=this.state,d=s.drag;if(!s||!d||d.id!==p.id)return;s.drag=null;
    const v=this.pull(d),len=Math.hypot(v.x,v.y);
    if(len<18||ctx.timeLeft<=0)return;// 拉太短視為取消
    const l=launchVelocity(v.x,v.y);
    s.ball=createBall(l.vx,l.vy);s.shots++;s.launchAt=s.t;
    s.log.push({t:+s.t.toFixed(3),vx:Math.round(l.vx),vy:Math.round(l.vy),bin:Math.round(s.binX),wind:s.wind});
  },
  /** 拖曳向量換成世界座標下的「往後拉」量（往左下拉 → 往右上投） */
  pull(d){const sc=this.state.view.s;return {x:(d.ox-d.x)/sc,y:(d.oy-d.y)/sc};},
  update(ctx,dt){
    const s=this.state;s.t=this.duration-ctx.timeLeft;
    s.binX=binXAt(s.t);s.wind=windAt(s.windSchedule,s.t);
    if(s.drag&&ctx.input.pointers.size===0)s.drag=null;// 暫停或失焦後取消拖曳
    s.fx=s.fx.filter(f=>s.t-f.t<1.1);
    if(s.wait>0){s.wait-=dt;if(s.wait<=0){s.ball=null;this.spawn();}return;}
    const b=s.ball;if(!b||b.idle)return;
    const ev=stepBall(b,dt,{binX:s.binX,wind:s.wind});
    if(!ev)return;
    if(ev.type==='score'){
      s.combo++;s.makes++;if(ev.swish)s.swishes++;s.bestCombo=Math.max(s.bestCombo,s.combo);
      const pts=pointsFor({swish:ev.swish,combo:s.combo});ctx.addScore(pts);
      s.fx.push({t:s.t,x:b.x,y:b.y,text:(ev.swish?'空心！':'進！')+' +'+pts+(s.combo>1?'  x'+s.combo:''),good:true});
      s.log[s.log.length-1].r=ev.swish?'swish':'make';
      s.wait=.35;
    }else{
      s.combo=0;s.fx.push({t:s.t,x:b.x,y:b.y-20,text:'沒進'});s.log[s.log.length-1].r='miss';s.wait=.4;
    }
    ctx.setExtra((s.combo>1?'連擊 x'+s.combo+'  ':'')+(s.t>=PHASES.windFrom?'風 '+(s.wind===0?'無':(s.wind>0?'→ ':'← ')+Math.abs(s.wind/45)):''));
  },
  render(ctx){
    const s=this.state,g=ctx.g,v=s.view,w2c=(x,y)=>({x:v.ox+x*v.s,y:v.oy+y*v.s});
    g.imageSmoothingEnabled=false;
    // 背景：淡藍紙面感，蓋住辦公室但保留格線氣氛
    g.fillStyle='rgba(238,243,251,.97)';g.fillRect(0,0,ctx.width,ctx.height);
    g.strokeStyle='rgba(24,46,84,.07)';g.lineWidth=1;
    for(let x=0;x<ctx.width;x+=32){g.beginPath();g.moveTo(x+.5,0);g.lineTo(x+.5,ctx.height);g.stroke();}
    for(let y=0;y<ctx.height;y+=32){g.beginPath();g.moveTo(0,y+.5);g.lineTo(ctx.width,y+.5);g.stroke();}
    const rect=(x,y,w,h,col)=>{const a=w2c(x,y);g.fillStyle=col;g.fillRect(Math.round(a.x),Math.round(a.y),Math.ceil(w*v.s),Math.ceil(h*v.s));};
    // 地板
    rect(0,GEO.floorY,GEO.W,10,'#182e54');rect(0,GEO.floorY+10,GEO.W,GEO.H-GEO.floorY,'#d6dbe4');
    // 籃板、垃圾桶
    const bx=s.binX,L=bx-GEO.rimHalf,R=bx+GEO.rimHalf;
    rect(bx+GEO.boardOff-5,GEO.boardTop,10,GEO.rimY+20-GEO.boardTop,'#182e54');rect(bx+GEO.boardOff-3,GEO.boardTop+2,6,GEO.rimY+16-GEO.boardTop,'#ffffff');
    rect(L-3,GEO.rimY,6,GEO.floorY-GEO.rimY,'#182e54');rect(R-3,GEO.rimY,6,GEO.floorY-GEO.rimY,'#182e54');
    rect(L+3,GEO.rimY,R-L-6,GEO.floorY-GEO.rimY,'#8c98ad');
    for(let y=GEO.rimY+20;y<GEO.floorY;y+=28)rect(L+3,y,R-L-6,3,'#6f7c92');
    rect(L-8,GEO.rimY-6,R-L+16,10,'#e8913a');rect(L-8,GEO.rimY-6,R-L+16,3,'#ffd24a');
    // 瞄準：預覽軌跡與拉力條
    const b=s.ball;
    if(s.drag){
      const p=this.pull(s.drag),len=Math.hypot(p.x,p.y);
      if(len>=18){
        const l=launchVelocity(p.x,p.y);
        g.fillStyle='#182e54';
        for(const pt of previewPath(l.vx,l.vy,s.wind)){const c=w2c(pt.x,pt.y);g.fillRect(Math.round(c.x)-2,Math.round(c.y)-2,4,4);}
        const bar=w2c(GEO.start.x-40,GEO.start.y+34);g.fillStyle='#fff';g.fillRect(bar.x,bar.y,80*v.s,8);
        g.fillStyle=l.power>.85?'#d9534f':'#4caf6a';g.fillRect(bar.x,bar.y,80*v.s*l.power,8);g.strokeStyle='#182e54';g.lineWidth=2;g.strokeRect(bar.x,bar.y,80*v.s,8);
      }
    }
    if(b){const c=w2c(b.x,b.y),size=GEO.r*2*v.s;g.save();g.translate(c.x,c.y);g.rotate(b.spin||0);g.drawImage(s.sprite,-size/2,-size/2,size,size);g.restore();}
    // 風向
    if(s.t>=PHASES.windFrom){
      g.fillStyle='#182e54';g.font='700 14px sans-serif';g.textAlign='left';
      const wx=ctx.width-130,wy=HUD_TOP+30;g.fillText('風',wx-24,wy+5);
      const n=Math.abs(s.wind/45);g.fillStyle=s.wind===0?'#aab4c4':'#e8913a';
      for(let i=0;i<Math.max(n,1);i++){const x=wx+(s.wind<0?-i*14:i*14)+30;g.fillRect(x,wy-3,10,6);}
      if(s.wind!==0){const tip=wx+(s.wind<0?-n*14:n*14)+30,d=s.wind<0?-1:1;g.beginPath();g.moveTo(tip+(d>0?0:6),wy-8);g.lineTo(tip+(d>0?10:-4),wy);g.lineTo(tip+(d>0?0:6),wy+8);g.fill();}
    }
    // 文字特效
    for(const f of s.fx){const a=1-(s.t-f.t)/1.1,c=w2c(f.x,f.y);g.globalAlpha=Math.max(0,a);g.fillStyle=f.good?'#0f7f27':'#c0392b';g.font='900 22px sans-serif';g.textAlign='center';g.fillText(f.text,c.x,c.y-30-(1-a)*40);g.globalAlpha=1;}
    if(s.t<3&&!s.drag&&s.shots===0){g.fillStyle='#182e54';g.font='700 16px sans-serif';g.textAlign='center';g.fillText('在畫面上往左下拖曳，放開投出（拉越長越用力）',ctx.width/2,ctx.height-24);}
  },
  result(ctx){
    const s=this.state,acc=s.shots?Math.round(s.makes/s.shots*100):0;
    return {lines:['投 '+s.shots+' 球，進 '+s.makes+' 球（命中率 '+acc+'%）','空心 '+s.swishes+' 次，最高連擊 '+s.bestCombo,'題組日期 '+ctx.day+'（風向每天固定）']};
  },
  destroy(){this.state=null;}
};

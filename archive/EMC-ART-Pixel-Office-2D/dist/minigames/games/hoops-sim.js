// 廢紙投籃：純物理模擬（不碰 DOM，可單獨測試）。
// 世界座標 1000×600，y 向下。固定 1/120 秒子步長，與畫面幀率無關。
export const GEO={W:1000,H:600,floorY:560,start:{x:150,y:470},r:14,rimY:400,rimHalf:60,rimR:5,binBaseX:640,boardOff:80,boardTop:270,gravity:1200,restitution:{rim:.5,wall:.45,board:.6,floor:.4}};
export const STEP=1/120;
export const SCORE={normal:100,swish:150,comboPer:20,comboCap:10};
export const MAX_PULL=170,POWER_K=7;

/** 拖曳向量（往後拉的像素）→ 初速。拉得越長越用力，超過 MAX_PULL 不再增加。 */
export function launchVelocity(pullX,pullY){
  const len=Math.hypot(pullX,pullY);if(len<1)return {vx:0,vy:0,power:0};
  const k=Math.min(len,MAX_PULL)/len;
  return {vx:pullX*k*POWER_K,vy:pullY*k*POWER_K,power:Math.min(len,MAX_PULL)/MAX_PULL};
}
/** 連擊加分：第 1 球沒有，第 2 球起每多一球 +20，最多 +200。 */
export function pointsFor({swish,combo}){return (swish?SCORE.swish:SCORE.normal)+Math.min(Math.max(combo-1,0),SCORE.comboCap)*SCORE.comboPer;}

function closestOnSegment(px,py,ax,ay,bx,by){
  const dx=bx-ax,dy=by-ay,l2=dx*dx+dy*dy,t=l2?Math.max(0,Math.min(1,((px-ax)*dx+(py-ay)*dy)/l2)):0;
  return {x:ax+dx*t,y:ay+dy*t};
}
function bounceOff(ball,cx,cy,thick,e){
  const dx=ball.x-cx,dy=ball.y-cy,d=Math.hypot(dx,dy),min=GEO.r+thick;
  if(d>=min)return false;
  const nx=d?dx/d:0,ny=d?dy/d:-1;
  ball.x=cx+nx*min;ball.y=cy+ny*min;
  const vn=ball.vx*nx+ball.vy*ny;
  if(vn<0){ball.vx-=(1+e)*vn*nx;ball.vy-=(1+e)*vn*ny;}
  return true;
}

export function createBall(vx,vy){return {x:GEO.start.x,y:GEO.start.y,vx,vy,touched:false,age:0,done:false,spin:0};}

/**
 * 推進一個球 dt 秒。env={binX,wind}（wind 為水平加速度）。
 * 回傳事件：null | {type:'score',swish} | {type:'miss'}；球一旦有事件就 done=true。
 */
export function stepBall(ball,dt,env){
  if(ball.done)return null;
  const n=Math.max(1,Math.round(dt/STEP));let event=null;
  for(let i=0;i<n&&!event;i++){
    const prevY=ball.y;
    ball.vx+=(env.wind||0)*STEP;ball.vy+=GEO.gravity*STEP;
    ball.x+=ball.vx*STEP;ball.y+=ball.vy*STEP;ball.age+=STEP;ball.spin+=ball.vx*STEP*.02;
    const L=env.binX-GEO.rimHalf,R=env.binX+GEO.rimHalf,e=GEO.restitution;
    // 進球：球心由上往下穿過籃框平面，且在兩側框緣之間
    if(prevY<GEO.rimY&&ball.y>=GEO.rimY&&ball.vy>0&&ball.x>L+GEO.rimR&&ball.x<R-GEO.rimR){
      ball.done=true;event={type:'score',swish:!ball.touched};break;
    }
    let hit=false;
    hit=bounceOff(ball,L,GEO.rimY,GEO.rimR,e.rim)||hit;
    hit=bounceOff(ball,R,GEO.rimY,GEO.rimR,e.rim)||hit;
    for(const wx of [L,R]){const c=closestOnSegment(ball.x,ball.y,wx,GEO.rimY,wx,GEO.floorY);hit=bounceOff(ball,c.x,c.y,2,e.wall)||hit;}
    {const bx=env.binX+GEO.boardOff,c=closestOnSegment(ball.x,ball.y,bx,GEO.boardTop,bx,GEO.rimY+20);hit=bounceOff(ball,c.x,c.y,3,e.board)||hit;}
    if(hit)ball.touched=true;
    if(ball.x<GEO.r){ball.x=GEO.r;ball.vx=Math.abs(ball.vx)*e.wall;}
    if(ball.x>GEO.W-GEO.r){ball.x=GEO.W-GEO.r;ball.vx=-Math.abs(ball.vx)*e.wall;}
    if(ball.y>GEO.floorY-GEO.r){ball.y=GEO.floorY-GEO.r;ball.vy=-Math.abs(ball.vy)*e.floor;ball.vx*=.8;ball.done=true;event={type:'miss'};}
    if(!ball.done&&ball.age>6){ball.done=true;event={type:'miss'};}
  }
  return event;
}

/** 軌跡預覽：只算重力與風，不含碰撞。 */
export function previewPath(vx,vy,wind=0,points=28,every=3){
  const b={x:GEO.start.x,y:GEO.start.y,vx,vy},out=[];
  for(let i=0;i<points*every;i++){b.vx+=wind*STEP;b.vy+=GEO.gravity*STEP;b.x+=b.vx*STEP;b.y+=b.vy*STEP;if(i%every===every-1)out.push({x:b.x,y:b.y});if(b.y>GEO.floorY)break;}
  return out;
}

/** 難度隨時間：0–20 秒固定籃框、無風；20 秒起籃框左右移動；35 秒起加入風。 */
export const PHASES={moveFrom:20,windFrom:35,windEvery:8};
export function binXAt(t){
  if(t<PHASES.moveFrom)return GEO.binBaseX;
  const amp=Math.min(100,(t-PHASES.moveFrom)*7);
  return GEO.binBaseX+amp*Math.sin((t-PHASES.moveFrom)*1.1);
}
/** 風力表：由每日種子的 rng 預先排好，每 windEvery 秒換一次。 */
export function makeWindSchedule(rng,duration=60){
  const out=[];for(let t=PHASES.windFrom;t<duration;t+=PHASES.windEvery)out.push({from:t,wind:rng.int(-6,6)*45});
  return out;
}
export function windAt(schedule,t){let w=0;for(const s of schedule)if(t>=s.from)w=s.wind;return w;}

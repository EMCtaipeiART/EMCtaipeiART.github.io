// 辦公室躲貓貓：導航格與 AI（純函式，只用傳入的 rng，結果可重現）。
import {RULES,MAP,zoneCenter,dist,canSee,lineOfSight,aliveHiders,seekerOf} from './hideseek-sim.js';

// ───────── 導航格 ─────────
export function buildNav(map=MAP,cell=24,margin=RULES.r+2){
  const cols=Math.ceil(map.w/cell),rows=Math.ceil(map.h/cell),ok=new Uint8Array(cols*rows),b=map.bounds;
  for(let cy=0;cy<rows;cy++)for(let cx=0;cx<cols;cx++){
    const x=cx*cell+cell/2,y=cy*cell+cell/2;
    let free=x>=b.x+margin&&x<=b.x+b.w-margin&&y>=b.y+margin&&y<=b.y+b.h-margin;
    if(free)for(const s of map.solids){
      const nx=Math.max(s.x,Math.min(x,s.x+s.w)),ny=Math.max(s.y,Math.min(y,s.y+s.h));
      if(Math.hypot(x-nx,y-ny)<margin){free=false;break;}
    }
    ok[cy*cols+cx]=free?1:0;
  }
  return {cell,cols,rows,ok};
}
const cellOf=(nav,p)=>({cx:Math.max(0,Math.min(nav.cols-1,Math.floor(p.x/nav.cell))),cy:Math.max(0,Math.min(nav.rows-1,Math.floor(p.y/nav.cell)))});
const free=(nav,cx,cy)=>cx>=0&&cy>=0&&cx<nav.cols&&cy<nav.rows&&nav.ok[cy*nav.cols+cx]===1;
function nearestFree(nav,p){
  const c=cellOf(nav,p);if(free(nav,c.cx,c.cy))return c;
  for(let r=1;r<20;r++)for(let dy=-r;dy<=r;dy++)for(let dx=-r;dx<=r;dx++){
    if(Math.max(Math.abs(dx),Math.abs(dy))!==r)continue;
    if(free(nav,c.cx+dx,c.cy+dy))return {cx:c.cx+dx,cy:c.cy+dy};
  }
  return null;
}
function lineClear(nav,a,b){
  const n=Math.ceil(dist(a,b)/(nav.cell/2));
  for(let i=0;i<=n;i++){const t=n?i/n:0,c=cellOf(nav,{x:a.x+(b.x-a.x)*t,y:a.y+(b.y-a.y)*t});if(!free(nav,c.cx,c.cy))return false;}
  return true;
}
/** A*（8 方向、不切角），回傳拉直後的路徑點；到不了回傳 null。 */
export function findPath(nav,from,to){
  const s=nearestFree(nav,from),e=nearestFree(nav,to);if(!s||!e)return null;
  const {cols}=nav,idx=(cx,cy)=>cy*cols+cx,g=new Map([[idx(s.cx,s.cy),0]]),prev=new Map(),open=[{cx:s.cx,cy:s.cy,f:0}],closed=new Set();
  const h=(cx,cy)=>Math.hypot(cx-e.cx,cy-e.cy);
  while(open.length){
    let bi=0;for(let i=1;i<open.length;i++)if(open[i].f<open[bi].f)bi=i;
    const cur=open.splice(bi,1)[0],ci=idx(cur.cx,cur.cy);
    if(closed.has(ci))continue;closed.add(ci);
    if(cur.cx===e.cx&&cur.cy===e.cy){
      const raw=[];for(let k=ci;k!==undefined;k=prev.get(k))raw.push({x:(k%cols)*nav.cell+nav.cell/2,y:Math.floor(k/cols)*nav.cell+nav.cell/2});
      raw.reverse();raw[raw.length-1]={x:Math.min(Math.max(to.x,raw[raw.length-1].x-nav.cell/2),raw[raw.length-1].x+nav.cell/2),y:Math.min(Math.max(to.y,raw[raw.length-1].y-nav.cell/2),raw[raw.length-1].y+nav.cell/2)};
      const out=[];let anchor={x:from.x,y:from.y},i=0;
      while(i<raw.length){let j=raw.length-1;while(j>i&&!lineClear(nav,anchor,raw[j]))j--;out.push(raw[j]);anchor=raw[j];i=j+1;}
      return out;
    }
    for(let dy=-1;dy<=1;dy++)for(let dx=-1;dx<=1;dx++){
      if(!dx&&!dy)continue;
      const nx=cur.cx+dx,ny=cur.cy+dy;if(!free(nav,nx,ny))continue;
      if(dx&&dy&&(!free(nav,cur.cx+dx,cur.cy)||!free(nav,cur.cx,cur.cy+dy)))continue;
      const ni=idx(nx,ny),ng=g.get(ci)+(dx&&dy?1.414:1);
      if(g.has(ni)&&ng>=g.get(ni))continue;
      g.set(ni,ng);prev.set(ni,ci);open.push({cx:nx,cy:ny,f:ng+h(nx,ny)});
    }
  }
  return null;
}

// ───────── 機器人 ─────────
export const BOT_SEEKER_PACE=.9;// 機器人尋找者只用 90% 速度，給人類躲藏者逃跑空間
function follow(bot,p){
  while(bot.path.length&&dist(p,bot.path[0])<8)bot.path.shift();
  if(!bot.path.length)return {dx:0,dy:0};
  const w=bot.path[0],d=dist(p,w);return {dx:(w.x-p.x)/d,dy:(w.y-p.y)/d};
}
export function createBot(player,{rng,nav,game}){
  const bot={id:player.id,role:player.role,path:[],spot:null,replan:0,fleeCd:0,lastSeen:null,lostFor:0,reaction:0,patrol:[],nav};
  if(player.role==='hider'){
    // 躲藏者：每人挑不同的遮蔽區域（用 rng 洗牌後依序分配）
    const zones=rng.shuffle(game.map.zones),mine=zones[(player.index-1+zones.length)%zones.length];
    bot.spot=mine;bot.path=findPath(nav,player,zoneCenter(mine))||[];
  }else{
    bot.patrol=rng.shuffle(game.map.zones.map(zoneCenter));bot.visited=new Set();
  }
  return bot;
}

/** 回傳這個機器人本幀的輸入 {dx,dy,catch}。 */
export function botInput(game,bot,dt,rng){
  const p=game.players.find(x=>x.id===bot.id);
  if(!p||p.state!=='alive')return {};
  bot.dt=dt;bot.replan-=dt;bot.fleeCd-=dt;
  return p.role==='hider'?hiderInput(game,bot,p,rng):seekerInput(game,bot,p,rng);
}

function hiderInput(game,bot,p,rng){
  const sk=seekerOf(game);
  if(game.phase==='seek'&&bot.fleeCd<=0&&sk.state==='alive'&&dist(sk,p)<170&&lineOfSight(sk,p,game.map)){
    // 被逼近：換到離尋找者最遠的遮蔽區域
    const far=game.map.zones.map(z=>({z,d:dist(zoneCenter(z),sk)})).sort((a,b)=>b.d-a.d)[rng.int(0,2)].z;
    bot.spot=far;bot.path=findPath(bot.nav,p,zoneCenter(far))||[];bot.fleeCd=3;
  }
  return follow(bot,p);
}

function seekerInput(game,bot,p,rng){
  if(game.phase==='hide')return {};
  const visible=aliveHiders(game).filter(h=>canSee(p,h,game.map)).sort((a,b)=>dist(p,a)-dist(p,b));
  if(visible.length){
    const h=visible[0];bot.lastSeen={x:h.x,y:h.y};bot.lostFor=0;bot.reaction+=bot.dt;
    if(bot.replan<=0){bot.path=findPath(bot.nav,p,h)||[];bot.replan=.35;}
    const near=dist(p,h)<=RULES.catchRange-4;
    const f=follow(bot,p);return {dx:f.dx*BOT_SEEKER_PACE,dy:f.dy*BOT_SEEKER_PACE,catch:near&&bot.reaction>.3};
  }
  bot.reaction=0;bot.lostFor+=bot.dt;
  if(bot.lastSeen&&bot.lostFor<3){// 剛跟丟：先去最後看到的位置
    if(bot.replan<=0){bot.path=findPath(bot.nav,p,bot.lastSeen)||[];bot.replan=.5;}
  }else{
    bot.lastSeen=null;
    if(!bot.path.length){
      let pool=bot.patrol.filter(z=>!bot.visited.has(z));if(!pool.length){bot.visited.clear();pool=bot.patrol;}
      const next=pool.map(z=>({z,d:dist(p,z)+rng.next()*300})).sort((a,b)=>a.d-b.d)[0].z;// 加一點亂數，每次路線不完全一樣
      bot.visited.add(next);bot.path=findPath(bot.nav,p,next)||[];}
  }
  const f=follow(bot,p);return {dx:f.dx*BOT_SEEKER_PACE,dy:f.dy*BOT_SEEKER_PACE};
}

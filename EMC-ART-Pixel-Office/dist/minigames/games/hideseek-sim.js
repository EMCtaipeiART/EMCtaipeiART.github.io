// 辦公室躲貓貓：純規則模擬（不碰 DOM、不用 Math.random），單機與伺服器共用同一份規則。
// 世界座標＝真實辦公室畫面的像素（2370×3260），y 向下。
import {OFFICE} from '../data/office-map.js';

// 單位＝真實辦公室畫面的像素（家具原尺寸）。人物腳底圓半徑 28、走路約 220 px/s（原場景手動走路 210）。
export const RULES={hideSecs:20,seekSecs:120,r:28,hiderSpeed:220,seekerSpeed:232,vision:800,coverReveal:150,catchRange:96,catchCooldown:.5,minPlayers:2,maxPlayers:6};
export const TOTAL_SECS=RULES.hideSecs+RULES.seekSecs;

/**
 * 地圖：真實辦公室（tools/build-office-map.mjs 由場景擷取產生，家具維持原尺寸、原位置、原角度）。
 * solids＝會擋人的家具與玻璃牆；tall＝同時擋視線（書櫃、冰箱、電梯、隔間與玻璃牆，門的缺口保留）；桌椅等矮家具只擋人。
 * zones＝遮蔽區域（走得進去）：躲在裡面時，尋找者要靠近到 coverReveal 內才看得到；zone.spot 是圓放得進去的點。
 */
/* 場地縮小（2026-10-27）：只用辦公室下半部的一塊（會議室 B、C、茶水間與中間走道），
 * 約 1190×1000，原本整層 2370×3260 太大。座標系不變，只是玩家限制在 view 之內、畫面只畫這一塊；
 * 家具、遮蔽區域、遮擋圖層只留與這塊相交的。伺服器（worker/hide-room）用同一份，所以線上版也一起縮小。 */
const VIEW={x:40,y:2250,w:1100,h:980};
const hit=r=>r.x<VIEW.x+VIEW.w&&r.x+r.w>VIEW.x&&r.y<VIEW.y+VIEW.h&&r.y+r.h>VIEW.y;
/* 走道補的家具（畫在底圖上，見 hideseek-draw drawSorted）：辦公桌＋椅子＋盆栽，各自帶擋路範圍與躲藏區域 */
const EXTRA_DESKS=[[600,2450],[840,2450],[600,2890],[840,2890]],EXTRA_PLANTS=[[552,2290],[1080,2290],[552,3150],[1080,3150],[1085,2870],[560,2720]];
const EXTRA={props:[],solids:[],zones:[]};
for(const [x,y] of EXTRA_DESKS){
  EXTRA.props.push({img:'desks',spr:'desk_beige',x,y,depth:y+104},{img:'rooms',spr:'chair_back',x:x+84,y:y+96,depth:y+160});
  EXTRA.solids.push({kind:'desk',tall:false,x,y:y+8,w:220,h:100});
  EXTRA.zones.push({id:'xd'+x+'-'+y,label:'辦公桌旁',x:x+40,y:y+110,w:140,h:80,spot:{x:x+110,y:y+150}});
}
for(const [x,y] of EXTRA_PLANTS){
  EXTRA.props.push({img:'rooms',spr:'plant_small',x,y,depth:y+78});
  EXTRA.solids.push({kind:'shelf',tall:false,x:x+4,y:y+40,w:32,h:38});
  EXTRA.zones.push({id:'xp'+x+'-'+y,label:'盆栽旁',x:x-34,y:y+10,w:108,h:90,spot:{x:x>800?x-26:x+66,y:y+60}});
}
export const MAP={...OFFICE,view:VIEW,bounds:{...VIEW},solids:[...OFFICE.solids.filter(hit),...EXTRA.solids],zones:[...OFFICE.zones.filter(hit),...EXTRA.zones],occluders:OFFICE.occluders.filter(hit),props:EXTRA.props,
  spawns:[640,720,800,880,960,1040].map(x=>({x,y:2340}))};

const PLAYER_COLORS=['#d9534f','#3b6fd8','#4caf6a','#f0b429','#a463d9','#e8913a'];
export const zoneCenter=z=>z.spot||({x:z.x+z.w/2,y:z.y+z.h/2});

// ───────── 幾何 ─────────
export function pushOutOfRect(p,rect,r=RULES.r){
  const cx=Math.max(rect.x,Math.min(p.x,rect.x+rect.w)),cy=Math.max(rect.y,Math.min(p.y,rect.y+rect.h)),dx=p.x-cx,dy=p.y-cy,d2=dx*dx+dy*dy;
  if(d2>=r*r)return false;
  if(d2>0){const d=Math.sqrt(d2),k=(r-d)/d;p.x+=dx*k;p.y+=dy*k;}
  else{// 圓心已在矩形內：往最近的邊推出
    const l=p.x-rect.x,rt=rect.x+rect.w-p.x,t=p.y-rect.y,b=rect.y+rect.h-p.y,m=Math.min(l,rt,t,b);
    if(m===l)p.x=rect.x-r;else if(m===rt)p.x=rect.x+rect.w+r;else if(m===t)p.y=rect.y-r;else p.y=rect.y+rect.h+r;
  }
  return true;
}
/** 線段與矩形是否相交（slab 法） */
export function segHitsRect(ax,ay,bx,by,rc){
  let t0=0,t1=1;const dx=bx-ax,dy=by-ay;
  for(const [p,q] of [[-dx,ax-rc.x],[dx,rc.x+rc.w-ax],[-dy,ay-rc.y],[dy,rc.y+rc.h-ay]]){
    if(p===0){if(q<0)return false;}
    else{const t=q/p;if(p<0){if(t>t1)return false;if(t>t0)t0=t;}else{if(t<t0)return false;if(t<t1)t1=t;}}
  }
  return true;
}
export function lineOfSight(a,b,map=MAP){return !map.solids.some(s=>s.tall&&segHitsRect(a.x,a.y,b.x,b.y,s));}
export const zoneAt=(p,map=MAP)=>map.zones.find(z=>p.x>=z.x&&p.x<=z.x+z.w&&p.y>=z.y&&p.y<=z.y+z.h)||null;
export const dist=(a,b)=>Math.hypot(a.x-b.x,a.y-b.y);

/** 尋找者看不看得到某位躲藏者：在視野內、沒被高家具擋住、且躲在遮蔽區域時要靠得夠近。 */
export function canSee(seeker,hider,map=MAP){
  const d=dist(seeker,hider);
  if(d>RULES.vision)return false;
  if(zoneAt(hider,map)&&d>RULES.coverReveal)return false;
  return lineOfSight(seeker,hider,map);
}

// ───────── 遊戲狀態 ─────────
/** rng：{next,int,shuffle}；count：2–6 位玩家；seekerIndex 預設用 rng 隨機挑。 */
export function createGame({rng,count=4,map=MAP,seekerIndex,timing={}}){
  if(count<RULES.minPlayers||count>RULES.maxPlayers)throw new Error('players must be '+RULES.minPlayers+'-'+RULES.maxPlayers);
  const seeker=seekerIndex??rng.int(0,count-1),spawns=rng.shuffle(map.spawns);
  const players=Array.from({length:count},(_,i)=>({id:'p'+i,index:i,name:i===0?'你':String.fromCharCode(64+i),color:PLAYER_COLORS[i],role:i===seeker?'seeker':'hider',
    x:spawns[i].x,y:spawns[i].y,dir:1,state:'alive',cooldown:0,caughtAt:null,catches:0,inCover:false}));
  // timing：只給測試縮短時間用（伺服器在正式環境不接受客戶端指定）
  return {map,players,t:0,phase:'hide',over:false,winner:null,events:[],seekerId:'p'+seeker,hideSecs:timing.hideSecs??RULES.hideSecs,totalSecs:(timing.hideSecs??RULES.hideSecs)+(timing.seekSecs??RULES.seekSecs)};
}
export const seekerOf=g=>g.players.find(p=>p.role==='seeker');
export const hidersOf=g=>g.players.filter(p=>p.role==='hider');
export const aliveHiders=g=>hidersOf(g).filter(p=>p.state==='alive');

/** 移動一步（含碰撞）。單機、伺服器與客戶端預測共用，結果必須完全相同。g 只需要 g.map。 */
export function movePlayer(g,p,ax,ay,dt){
  const l=Math.hypot(ax,ay);if(l<1e-6)return;
  const sp=p.role==='seeker'?RULES.seekerSpeed:RULES.hiderSpeed,k=Math.min(l,1)/l;
  p.x+=ax*k*sp*dt;p.y+=ay*k*sp*dt;if(ax)p.dir=ax>0?1:-1;
  for(let i=0;i<3;i++)for(const s of g.map.solids)pushOutOfRect(p,s);
  const b=g.map.bounds;p.x=Math.max(b.x+RULES.r,Math.min(b.x+b.w-RULES.r,p.x));p.y=Math.max(b.y+RULES.r,Math.min(b.y+b.h-RULES.r,p.y));
}

/**
 * 推進 dt 秒。inputs：{[playerId]:{dx,dy,catch}}（dx/dy 為 −1..1，catch 為本幀是否按下抓捕）。
 * 規則：躲藏階段尋找者不能動；之後才能移動與抓捕；全被抓＝尋找者贏，時間到還有人＝躲藏者贏。
 */
export function stepGame(g,inputs,dt){
  g.events=[];
  if(g.over)return g;
  g.t+=dt;
  const phase=g.t<g.hideSecs?'hide':'seek';
  if(phase!==g.phase){g.phase=phase;g.events.push({type:'phase',phase});}
  for(const p of g.players){
    if(p.cooldown>0)p.cooldown-=dt;
    if(p.state!=='alive')continue;
    const inp=inputs[p.id]||{};
    if(!(p.role==='seeker'&&g.phase==='hide'))movePlayer(g,p,inp.dx||0,inp.dy||0,dt);
    p.inCover=!!zoneAt(p,g.map);
  }
  const sk=seekerOf(g),skInp=inputs[sk.id]||{};
  if(g.phase==='seek'&&sk.state==='alive'&&skInp.catch&&sk.cooldown<=0){
    sk.cooldown=RULES.catchCooldown;
    let best=null,bd=Infinity;
    for(const h of aliveHiders(g)){const d=dist(sk,h);if(d<=RULES.catchRange&&d<bd&&lineOfSight(sk,h,g.map)){best=h;bd=d;}}
    if(best){best.state='caught';best.caughtAt=g.t;sk.catches++;g.events.push({type:'caught',id:best.id,by:sk.id});}
    else g.events.push({type:'miss',id:sk.id});
  }
  if(aliveHiders(g).length===0){g.over=true;g.winner='seeker';g.events.push({type:'over',winner:'seeker'});}
  else if(g.t>=g.totalSecs){g.over=true;g.winner='hiders';g.events.push({type:'over',winner:'hiders'});}
  return g;
}

/** 本地排行用的分數（不是績效指標）：尋找者每抓一人 300，全抓完再加剩餘秒數×3；躲藏者撐到最後 400，另加存活秒數×2。 */
export function scoreFor(g,id){
  const p=g.players.find(x=>x.id===id);if(!p)return 0;
  if(p.role==='seeker')return p.catches*300+(g.winner==='seeker'?Math.floor(Math.max(g.totalSecs-g.t,0))*3:0);
  const survived=Math.max(0,(p.state==='caught'?p.caughtAt:g.t)-g.hideSecs);
  return Math.floor(survived)*2+(p.state==='alive'&&g.winner==='hiders'?400:0);
}

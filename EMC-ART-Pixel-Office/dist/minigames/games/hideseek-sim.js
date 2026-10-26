// 辦公室躲貓貓：純規則模擬（不碰 DOM、不用 Math.random），單機與 Phase 6 的伺服器共用同一份規則。
// 世界座標 1000×640，y 向下。

export const RULES={hideSecs:20,seekSecs:120,r:12,hiderSpeed:150,seekerSpeed:158,vision:330,coverReveal:46,catchRange:44,catchCooldown:.5,minPlayers:2,maxPlayers:6};
export const TOTAL_SECS=RULES.hideSecs+RULES.seekSecs;

/**
 * 地圖：solid＝會擋人的家具；tall＝同時擋視線（櫃子、隔板、書架）；低矮家具（桌、沙發、盆栽）只擋人。
 * zones＝遮蔽區域（走得進去）：躲在裡面時，尋找者要靠近到 coverReveal 內才看得到。
 */
export const MAP={
  w:1000,h:640,bounds:{x:20,y:20,w:960,h:600},
  solids:[
    {id:'cabinetL',kind:'cabinet',x:60,y:56,w:44,h:154,tall:true},
    {id:'desk1',kind:'desk',x:200,y:70,w:160,h:60},
    {id:'desk2',kind:'desk',x:540,y:70,w:160,h:60},
    {id:'shelf',kind:'shelf',x:740,y:50,w:200,h:36,tall:true},
    {id:'part1',kind:'partition',x:330,y:200,w:12,h:150,tall:true},
    {id:'meeting',kind:'table',x:400,y:250,w:200,h:100},
    {id:'part2',kind:'partition',x:660,y:300,w:180,h:12,tall:true},
    {id:'cabinetR',kind:'cabinet',x:900,y:200,w:44,h:150,tall:true},
    {id:'desk3',kind:'desk',x:150,y:470,w:150,h:60},
    {id:'desk4',kind:'desk',x:340,y:470,w:150,h:60},
    {id:'desk5',kind:'desk',x:560,y:470,w:150,h:60},
    {id:'sofa',kind:'sofa',x:780,y:520,w:150,h:70},
    {id:'plantA',kind:'plant',x:860,y:120,w:36,h:36},
    {id:'plantB',kind:'plant',x:70,y:550,w:40,h:40}
  ],
  zones:[
    {id:'z-cabinetL',x:108,y:60,w:70,h:120},{id:'z-shelf',x:760,y:96,w:80,h:70},{id:'z-part1',x:346,y:210,w:50,h:130},
    {id:'z-part2',x:670,y:316,w:160,h:60},{id:'z-cabinetR',x:846,y:210,w:46,h:130},{id:'z-plantB',x:114,y:550,w:60,h:60},
    {id:'z-sofa',x:740,y:530,w:36,h:80},{id:'z-plantA',x:900,y:110,w:44,h:70},{id:'z-desks',x:494,y:474,w:62,h:56}
  ],
  spawns:[{x:300,y:400},{x:380,y:400},{x:460,y:400},{x:540,y:400},{x:620,y:400},{x:700,y:400}]
};

const PLAYER_COLORS=['#d9534f','#3b6fd8','#4caf6a','#f0b429','#a463d9','#e8913a'];
export const zoneCenter=z=>({x:z.x+z.w/2,y:z.y+z.h/2});

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

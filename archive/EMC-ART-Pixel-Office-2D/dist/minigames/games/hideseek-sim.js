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
/* 場地（2026-10-27 重做）：不再用整層辦公室的底圖與玻璃牆，改成專為躲貓貓排的橫式 16:9 場地（2240×1260，無隔間，方便跑動）。
 * 家具用現有素材拼出來：辦公桌、會議桌、茶水間、書櫃、盆栽……每件都有擋路範圍，高的（書櫃、冰箱、方柱、工具櫃）也擋視線，旁邊有綠色躲藏區。
 * 伺服器（worker/hide-room）用同一份，所以線上版是同一個場地。畫面見 hideseek-draw（SPR 表是素材座標）。 */
const VIEW={x:0,y:0,w:2240,h:1260};
const SZ={desk_beige:[220,124],desk_white_row:[354,152],desk_white_v:[110,218],table_white_v:[100,200],chair_front:[52,56],chair_back:[52,56],chair_side_l:[48,52],chair_side_r:[48,52],
  fridge_dark:[82,170],plant_small:[40,80],projector_right:[64,52],projector_left:[64,52],projector_down:[56,60],prop_pillar:[86,218],shelf_tall:[46,220],shelf_low:[44,150],cabinet_red:[56,150]};
const EXTRA={props:[],solids:[],zones:[]};
let zid=0;
const put=(spr,x,y,depth)=>EXTRA.props.push({spr,x,y,depth:depth??y+(SZ[spr]?SZ[spr][1]:0)});
const solid=(x,y,w,h,tall=false,kind='desk')=>EXTRA.solids.push({kind,tall,x,y,w,h});
const zone=(label,x,y,w,h,spot)=>EXTRA.zones.push({id:'z'+(zid++),label,x,y,w,h,spot:spot||{x:x+w/2,y:y+h/2}});
/** 單件家具：底下 55% 擋路；tall 的同時擋視線；zone 在左右或下方留一塊躲藏區 */
const item=(spr,x,y,{tall=false,side=null,label='家具旁'}={})=>{const [w,h]=SZ[spr];put(spr,x,y);solid(x,y+Math.round(h*.4),w,Math.round(h*.6),tall,tall?'tall':'shelf');
  if(side==='r')zone(label,x+w,y+Math.round(h*.3),70,Math.round(h*.7),{x:x+w+36,y:y+h-40});else if(side==='l')zone(label,x-70,y+Math.round(h*.3),70,Math.round(h*.7),{x:x-36,y:y+h-40});};
const chair=(spr,x,y)=>put(spr,x,y,y+SZ[spr][1]+(spr==='chair_back'?40:0));
/** 辦公桌（米色）＋背面椅子＋椅子下的躲藏區 */
const desk=(x,y)=>{put('desk_beige',x,y,y+104);solid(x,y+8,220,100);chair('chair_back',x+84,y+96);zone('辦公桌旁',x+40,y+110,140,80,{x:x+110,y:y+150});};
/** 長桌：左端＋中段×n＋右端，拼成一張（kind＝black／white／wood） */
const tbl=(kind,x,y,mids,h=130)=>{const w=110+85*mids,d=y+h-20;put('table_'+kind+'_left',x,y,d);for(let k=0;k<mids;k++)put('table_'+kind+'_mid',x+55+85*k,y,d);put('table_'+kind+'_right',x+55+85*mids,y,d);solid(x,y+10,w,h-34);return w;};
/** 會議桌：上下各 n 張椅子、一台投影機 */
const meet=(x,y,mids,n,proj)=>{const w=tbl('black',x,y,mids);put(proj,proj==='projector_right'?x+w-124:x+60,y+26,y+125);
  for(let k=0;k<n;k++){const cx=x+w*(2*k+1)/(2*n);chair('chair_front',cx-26,y-46);chair('chair_back',cx-26,y+120);}
  zone('會議桌下方',x+20,y+150,w-40,90);return w;};
// 上排：4 張辦公桌、一張 3＋3 椅的長會議桌
for(const x of [140,380,620,860])desk(x,120);
meet(1240,140,5,3,'projector_right');
// 中排：2 張辦公桌、白色長桌（單排）、2 椅的小會議桌、直式白桌
desk(140,540);desk(380,540);
put('desk_white_row',680,540,540+140);solid(680,550,354,118);chair('chair_back',680+177-26,540+130);zone('白色長桌旁',700,690,314,80);
meet(1240,560,3,2,'projector_left');
for(const y of [520,760]){put('desk_white_v',1700,y,y+196);solid(1700,y+10,110,186);}
chair('chair_side_l',1812,545);chair('chair_side_l',1812,785);zone('直式桌旁',1850,520,110,420);
// 下排：茶水間（木桌＋冰箱）、書櫃、方柱、工具櫃、盆栽
tbl('wood',140,920,2,90);zone('茶水間桌下',150,1020,260,80);item('fridge_dark',470,880,{tall:true,side:'r',label:'冰箱旁'});item('fridge_dark',552,880,{tall:true});
item('shelf_tall',760,900,{tall:true,side:'r',label:'書櫃旁'});item('shelf_tall',960,900,{tall:true,side:'r',label:'書櫃旁'});
item('shelf_low',1160,970,{side:'r'});item('cabinet_red',1260,970,{tall:false,side:'r',label:'工具櫃旁'});
item('prop_pillar',1480,900,{tall:true,side:'r',label:'方柱旁'});item('shelf_tall',1700,980,{tall:true,side:'l',label:'書櫃旁'});item('shelf_low',1880,1040,{side:'l'});
for(const [x,y] of [[60,60],[2120,60],[60,1120],[2120,1120],[1960,380],[40,500],[2100,640],[640,780],[1420,780]])item('plant_small',x,y,{side:x>1100?'l':'r',label:'盆栽旁'});
export const MAP={...OFFICE,w:2370,h:3260,view:VIEW,bounds:{...VIEW},solids:EXTRA.solids,zones:EXTRA.zones,occluders:[],props:EXTRA.props,rooms:[],
  spawns:[300,500,700,900,1100,1300].map(x=>({x,y:410}))};

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

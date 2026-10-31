import test from 'node:test';
import assert from 'node:assert/strict';
import {createRng,dailySeed,dayKey,hashString} from '../archive/EMC-ART-Pixel-Office-2D/dist/minigames/core/rng.js';
import {createFixedLoop} from '../archive/EMC-ART-Pixel-Office-2D/dist/minigames/core/loop.js';
import {createScoreStore} from '../archive/EMC-ART-Pixel-Office-2D/dist/minigames/core/score.js';
import {createMiniGameManager} from '../archive/EMC-ART-Pixel-Office-2D/dist/minigames/core/manager.js';

// ---- 追蹤監聽數量的假 window／document，用來檢查洩漏 ----
function fakeTarget(){
  const t=new EventTarget(),orig=t.addEventListener.bind(t);t.count=0;
  t.addEventListener=(type,fn,opts)=>{t.count++;orig(type,fn,opts);const s=opts&&opts.signal;if(s)s.addEventListener('abort',()=>t.count--);};
  return t;
}
function setupEnv(){
  globalThis.window=fakeTarget();globalThis.document=Object.assign(fakeTarget(),{hidden:false});
  globalThis.devicePixelRatio=1;
  const rafQueue=[];
  const ui={
    root:{style:{},contains:()=>false},canvas:{width:0,height:0,getContext:()=>({setTransform(){},clearRect(){}}),addEventListener:fakeTarget().addEventListener},
    calls:[],mounted:false,
    mount(){this.mounted=true;},unmount(){this.mounted=false;},show(){},hide(){},setTime(){},setScore(){},setExtra(){},setPauseLabel(){},setPauseVisible(){},banner(){},pausePanel(){},closePanel(){},
    results(r){this.last=r;},closePanel(){},onAction(fn,signal){this.act=fn;}
  };
  ui.canvas=Object.assign(fakeTarget(),{width:0,height:0,getContext:()=>({setTransform(){},clearRect(){}}),getBoundingClientRect:()=>({left:0,top:0,width:800,height:600})});
  const cleared=[];
  const bridge={canvasEl:fakeTarget(),rect:()=>({left:0,top:0,width:800,height:600}),releaseKeys:()=>cleared.push(1),markDirty(){}};
  const mem={};const storage={getItem:k=>mem[k]??null,setItem:(k,v)=>{mem[k]=v;}};
  // 手動推進的迴圈
  const loops=[];
  const loopFactory=({update,render})=>{const l={running:false,start(){l.running=true;},stop(){l.running=false;},tick(n=1){for(let i=0;i<n&&l.running;i++){update(1/60);render(0);}}};loops.push(l);return l;};
  return {ui,bridge,store:createScoreStore(storage),loops,cleared,loopFactory,rafQueue};
}
const simpleGame=(extra={})=>({id:'t',title:'T',duration:1,start(ctx){this.c=ctx;ctx.input.on('down',()=>ctx.addScore(10));},update(){},render(){},destroy(){this.destroyed=true;},...extra});

test('rng 與每日種子可重現',()=>{
  const a=createRng(dailySeed('x',new Date('2026-10-26T04:00:00Z'))),b=createRng(dailySeed('x',new Date('2026-10-26T10:00:00Z')));
  assert.deepEqual([a.next(),a.next(),a.int(1,9)],[b.next(),b.next(),b.int(1,9)]);
  assert.notEqual(dailySeed('x',new Date('2026-10-26T04:00:00Z')),dailySeed('y',new Date('2026-10-26T04:00:00Z')));
  assert.equal(dayKey(new Date('2026-10-26T20:00:00Z')),'2026-10-27');// 台北時間跨日
});

test('固定時間步長：120Hz 與 60Hz 步數一致',()=>{
  const run=hz=>{let steps=0,cb=null,t=0;const l=createFixedLoop({update(){steps++;},render(){},raf:f=>{cb=f;return 1;},caf(){}});l.start();cb(0);for(let i=0;i<hz;i++){t+=1000/hz;cb(t);}l.stop();return steps;};
  assert.ok(Math.abs(run(60)-run(120))<=1);
});

test('本機紀錄：最佳分與前十名',()=>{
  const s=createScoreStore({getItem:()=>null,setItem(){}});
  const r=s.submit('g',{score:50,day:'d'});assert.equal(r.isBest,true);
  const storage={};const s2=createScoreStore({getItem:k=>storage[k]??null,setItem:(k,v)=>{storage[k]=v;}});
  for(let i=0;i<15;i++)s2.submit('g',{score:i,day:'d'});
  assert.equal(s2.get('g').board.length,10);assert.equal(s2.get('g').best,14);assert.equal(s2.get('g').plays,15);
  assert.equal(createScoreStore({getItem(){throw new Error('x');},setItem(){throw new Error('x');}}).get('g').best,0);// 儲存不可用時不爆
});

test('生命週期：倒數→進行→暫停→時間到→結算→離開',()=>{
  const env=setupEnv(),game=simpleGame(),m=createMiniGameManager(env);
  m.register(game);
  assert.equal(m.open('t'),true);assert.equal(m.phase,'countdown');
  env.loops[0].tick(60*4);assert.equal(m.phase,'running');
  m.pause();assert.equal(m.phase,'paused');assert.equal(env.loops[0].running,false);
  m.resume();assert.equal(m.phase,'running');
  env.loops[0].tick(60*2);assert.equal(m.phase,'finished');assert.ok(env.ui.last);
  m.close();assert.equal(m.active,false);assert.equal(game.destroyed,true);assert.equal(env.ui.mounted,false);
});

test('重複進出 50 次不累積監聽',()=>{
  const env=setupEnv(),m=createMiniGameManager(env);m.register(simpleGame());
  for(let i=0;i<50;i++){m.open('t');m.close();}
  assert.equal(window.count,0);assert.equal(document.count,0);assert.equal(env.ui.canvas.count,0);
  assert.equal(env.cleared.length,100);// 每次進出都清空辦公室方向鍵
});

test('遊戲拋出例外時安全退出',()=>{
  const env=setupEnv(),errors=[],m=createMiniGameManager({...env,onError:e=>errors.push(e)});
  m.register(simpleGame({id:'bad',update(){throw new Error('boom');}}));
  m.open('bad');env.loops[0].tick(60*4);
  assert.equal(m.active,false);assert.equal(errors.length>=1,true);assert.equal(window.count,0);
});

test('一次只能開一局，且未註冊的遊戲不會開啟',()=>{
  const env=setupEnv(),m=createMiniGameManager(env);m.register(simpleGame());
  assert.equal(m.open('nope'),false);assert.equal(m.open('t'),true);assert.equal(m.open('t'),false);m.close();
});

// ---- Phase 2：辦公室尋寶 ----
import {floorCandidates,pickTreasures,treasureScore} from '../archive/EMC-ART-Pixel-Office-2D/dist/minigames/games/treasure-gen.js';
const types=['a','b','c','d','e','f','g','h'];
const free=(x,y)=>x>60&&x<1400&&y>200&&y<900&&!(x>400&&x<700&&y>300&&y<500);
const cands=floorCandidates({minX:80,maxX:1450,minY:210,maxY:880,isFree:free});

test('尋寶：同一天產生相同位置，不同天不同',()=>{
  const gen=day=>pickTreasures({rng:createRng(hashString('treasure-items@'+day)),candidates:cands,types});
  const a=gen('2026-10-26'),b=gen('2026-10-26'),c=gen('2026-10-27');
  assert.equal(a.length,5);assert.deepEqual(a,b);assert.notDeepEqual(a,c);
});
test('尋寶：道具不在家具上、彼此保持間距、一定點得到',()=>{
  const clickable=(x,y)=>x>=100&&x<=1000&&y>=250&&y<=800;
  for(let d=1;d<=30;d++){
    const r=pickTreasures({rng:createRng(d),candidates:cands,types,clickable});
    assert.equal(r.length,5);
    for(const it of r){assert.ok(free(it.x,it.y)&&clickable(it.x,it.y));assert.ok(free(it.x+24,it.y)&&free(it.x-24,it.y));}
    for(let i=0;i<5;i++)for(let j=i+1;j<5;j++)assert.ok(Math.hypot(r[i].x-r[j].x,r[i].y-r[j].y)>=180);
    assert.equal(new Set(r.map(i=>i.type)).size,5);
  }
});
test('尋寶：計分規則',()=>{
  assert.equal(treasureScore({found:3,timeLeft:40}),300);// 沒找齊沒有時間加成
  assert.equal(treasureScore({found:5,timeLeft:50}),500+100);
  assert.equal(treasureScore({found:5,timeLeft:50,hintUsed:true}),550);
  assert.equal(treasureScore({found:0,timeLeft:0,hintUsed:true}),0);// 不會變負分
});

// ---- Phase 3：廢紙投籃 ----
import {GEO,createBall,stepBall,launchVelocity,pointsFor,previewPath,binXAt,makeWindSchedule,windAt} from '../archive/EMC-ART-Pixel-Office-2D/dist/minigames/games/hoops-sim.js';
function fly(vx,vy,env={binX:GEO.binBaseX,wind:0}){const b=createBall(vx,vy);for(let i=0;i<60*8;i++){const ev=stepBall(b,1/60,env);if(ev)return {...ev,touched:b.touched};}return {type:'timeout'};}
function search(pred){for(let a=25;a<=80;a+=.5)for(let sp=350;sp<=1190;sp+=5){const r=a*Math.PI/180,res=fly(Math.cos(r)*sp,-Math.sin(r)*sp);if(pred(res))return {a,sp,res};}return null;}

test('投籃：存在空心進球，也存在碰框／板後的普通進球',()=>{
  assert.ok(search(r=>r.type==='score'&&r.swish),'找不到空心');
  assert.ok(search(r=>r.type==='score'&&!r.swish),'找不到普通進球');
});
test('投籃：太弱的球落地算沒進，且 60fps 與 120fps 結果一致',()=>{
  assert.equal(fly(100,-100).type,'miss');
  const hit=search(r=>r.type==='score'&&r.swish),r=hit.a*Math.PI/180,vx=Math.cos(r)*hit.sp,vy=-Math.sin(r)*hit.sp;
  const b=createBall(vx,vy);let ev=null;for(let i=0;i<60*8&&!ev;i++)ev=stepBall(b,1/120,{binX:GEO.binBaseX,wind:0})||stepBall(b,1/120,{binX:GEO.binBaseX,wind:0});
  assert.equal(ev&&ev.type,'score');
});
test('投籃：同一發球結果可重現',()=>{const h=search(r=>r.type==='score');const r=h.a*Math.PI/180;const run=()=>fly(Math.cos(r)*h.sp,-Math.sin(r)*h.sp);assert.deepEqual(run(),run());});
test('投籃：力道上限與計分、連擊',()=>{
  const a=launchVelocity(170,-170),b=launchVelocity(1700,-1700);assert.ok(Math.abs(a.vx-b.vx)<1e-6&&b.power===1);
  assert.equal(pointsFor({swish:false,combo:1}),100);assert.equal(pointsFor({swish:true,combo:1}),150);
  assert.equal(pointsFor({swish:true,combo:3}),190);assert.equal(pointsFor({swish:false,combo:99}),100+200);
});
test('投籃：籃框 20 秒前不動、風力由種子決定',()=>{
  assert.equal(binXAt(0),GEO.binBaseX);assert.equal(binXAt(19.9),GEO.binBaseX);assert.notEqual(binXAt(30),GEO.binBaseX);
  const s1=makeWindSchedule(createRng(hashString('wind@d')),60),s2=makeWindSchedule(createRng(hashString('wind@d')),60);
  assert.deepEqual(s1,s2);assert.equal(windAt(s1,10),0);assert.ok(previewPath(500,-500,0).length>5);
});

// ---- Phase 4：截稿倒數 ----
import {createDeck,TYPES,levelFor,pointsForCorrect,colorType,shapeType,alignType,revisionType} from '../archive/EMC-ART-Pixel-Office-2D/dist/minigames/games/deadline-challenges.js';
const BOX={x:12,y:124,w:700,h:420};
const overlaps=(a,b)=>a.x<b.x+b.w-1&&b.x<a.x+a.w-1&&a.y<b.y+b.h-1&&b.y<a.y+a.h-1;

test('截稿：每日題組可重現，同類型不連續三題',()=>{
  const mk=day=>{const d=createDeck(createRng(hashString('deck@'+day)));return Array.from({length:60},(_,i)=>d.get(i));};
  const a=mk('2026-10-26'),b=mk('2026-10-26'),c=mk('2026-10-27');
  assert.deepEqual(a.map(x=>[x.type.id,x.puzzle]),b.map(x=>[x.type.id,x.puzzle]));
  assert.notDeepEqual(a.map(x=>x.type.id+JSON.stringify(x.puzzle)),c.map(x=>x.type.id+JSON.stringify(x.puzzle)));
  for(let i=2;i<a.length;i++)assert.ok(!(a[i].type.id===a[i-1].type.id&&a[i].type.id===a[i-2].type.id));
  // 玩家讀題的順序不影響題目（惰性產生也一樣）
  const d=createDeck(createRng(hashString('deck@2026-10-26')));assert.deepEqual(d.get(30).puzzle,a[30].puzzle);
});
test('截稿：難度依題號升級，最高 6 級',()=>{assert.equal(levelFor(0),1);assert.equal(levelFor(5),2);assert.equal(levelFor(500),6);});
test('截稿：每種題型在各難度下都只有一個正確答案、選項互不重疊',()=>{
  for(let seed=1;seed<=40;seed++)for(let level=1;level<=6;level++)for(const type of TYPES){
    const p=type.generate(createRng(seed*100+level),level),regions=type.regions(p,BOX);
    const right=regions.filter(r=>type.isCorrect(p,r.id));
    assert.equal(right.length,1,type.id+' L'+level+' seed'+seed);
    for(let i=0;i<regions.length;i++){
      const r=regions[i];assert.ok(r.w>8&&r.h>8,type.id+' 區域太小');
      assert.ok(r.x>=BOX.x-1&&r.x+r.w<=BOX.x+BOX.w+1,type.id+' x 超出');
      if(type.id!=='align')for(let j=i+1;j<regions.length;j++)assert.ok(!overlaps(r,regions[j]),type.id+' 選項重疊');
    }
    if(type===shapeType){const keys=new Set(p.options.map(o=>o.map(c=>c.join(',')).sort().join(';')));assert.equal(keys.size,4);}
    if(type===revisionType){
      const k=new Set(p.options.map(o=>o.shape+'|'+o.color+'|'+o.size));assert.equal(k.size,4);
      const ok=p.options[p.correct];for(const a of ['shape','color','size'])assert.equal(ok[a],a in p.request?p.request[a]:p.current[a]);
      assert.equal(p.options.filter(o=>['shape','color','size'].every(a=>o[a]===(a in p.request?p.request[a]:p.current[a]))).length,1);
    }
  }
});
test('截稿：排版對齊的位移肉眼可見，且點擊區就是實際畫的位置',()=>{
  for(let level=1;level<=6;level++){
    const p=alignType.generate(createRng(level),level),rs=alignType.regions(p,BOX),odd=rs[p.odd],ref=rs[(p.odd+1)%rs.length];
    const off=p.axis==='y'?Math.abs(odd.y-ref.y):Math.abs(odd.x-ref.x);assert.ok(off>=2,'L'+level+' 位移 '+off);
  }
});
test('截稿：計分與連擊',()=>{assert.equal(pointsForCorrect(1),100);assert.equal(pointsForCorrect(2),110);assert.equal(pointsForCorrect(50),200);});

// ---- Phase 5：辦公室躲貓貓（單機原型）----
import {RULES,MAP,TOTAL_SECS,createGame,stepGame,canSee,lineOfSight,zoneAt,zoneCenter,pushOutOfRect,scoreFor,aliveHiders,seekerOf} from '../archive/EMC-ART-Pixel-Office-2D/dist/minigames/games/hideseek-sim.js';
import {buildNav,findPath,createBot,botInput} from '../archive/EMC-ART-Pixel-Office-2D/dist/minigames/games/hideseek-ai.js';
const nav=buildNav();
const mk=(count=4,seed=1,seekerIndex=0)=>{const rng=createRng(seed),g=createGame({rng,count,seekerIndex});return {g,rng};};
const run=(g,secs,inputs={})=>{for(let i=0;i<Math.round(secs*60)&&!g.over;i++)stepGame(g,inputs,1/60);};

test('躲貓貓：人數限制 2–6，尋找者隨機且只有一位',()=>{
  assert.throws(()=>createGame({rng:createRng(1),count:1}));assert.throws(()=>createGame({rng:createRng(1),count:7}));
  const roles=new Set();
  for(let seed=1;seed<=40;seed++){const g=createGame({rng:createRng(seed),count:5});assert.equal(g.players.filter(p=>p.role==='seeker').length,1);roles.add(g.seekerId);}
  assert.ok(roles.size>=3);
});
test('躲貓貓：碰撞——亂走一萬步不會進到家具或出界',()=>{
  const {g,rng}=mk(4,3);
  for(let i=0;i<10000;i++){const inp={};for(const p of g.players)inp[p.id]={dx:Math.sin(i*.013+p.index)*1.5,dy:Math.cos(i*.021+p.index*2)*1.5};stepGame(g,inp,1/60);if(g.over)break;
    for(const p of g.players){for(const s of MAP.solids){const nx=Math.max(s.x,Math.min(p.x,s.x+s.w)),ny=Math.max(s.y,Math.min(p.y,s.y+s.h));assert.ok(Math.hypot(p.x-nx,p.y-ny)>=RULES.r-.5,p.id+' 卡進 '+s.id);}
      assert.ok(p.x>=MAP.bounds.x&&p.x<=MAP.bounds.x+MAP.bounds.w&&p.y>=MAP.bounds.y&&p.y<=MAP.bounds.y+MAP.bounds.h);}}
});
test('躲貓貓：躲藏階段尋找者不能動；20 秒後才開始，也才能抓',()=>{
  const {g}=mk(3,5,0),sk=seekerOf(g),h=g.players[1];const x0=sk.x;
  h.x=sk.x+20;h.y=sk.y;// 貼在旁邊
  run(g,10,{p0:{dx:1,dy:0,catch:true}});
  assert.equal(sk.x,x0);assert.equal(g.phase,'hide');assert.equal(h.state,'alive');
  run(g,11);assert.equal(g.phase,'seek');
  run(g,0.1,{p0:{dx:0,dy:0,catch:true}});assert.equal(h.state,'caught');
});
test('躲貓貓：勝負——全被抓＝尋找者贏；時間到＝躲藏者贏；被抓者進入觀戰且不再移動',()=>{
  const a=mk(2,7,0);run(a.g,RULES.hideSecs+.05);const h=a.g.players[1];const s=seekerOf(a.g);s.x=200;s.y=300;h.x=210;h.y=300;
  stepGame(a.g,{p0:{catch:true}},1/60);assert.equal(a.g.over,true);assert.equal(a.g.winner,'seeker');
  const b=mk(3,8,0);run(b.g,TOTAL_SECS+1);assert.equal(b.g.over,true);assert.equal(b.g.winner,'hiders');
  assert.ok(scoreFor(b.g,'p1')>=400&&scoreFor(b.g,'p0')===0);
  const c=mk(3,9,0);run(c.g,RULES.hideSecs+.05);const v=c.g.players[1],sk=seekerOf(c.g);sk.x=200;sk.y=300;v.x=210;v.y=300;stepGame(c.g,{p0:{catch:true}},1/60);
  const px=v.x;run(c.g,1,{p1:{dx:1,dy:0}});assert.equal(v.x,px);
});
test('躲貓貓：導航——所有出生點到所有遮蔽區都走得到，路徑點不在家具裡',()=>{
  for(const sp of MAP.spawns)for(const z of MAP.zones){const path=findPath(nav,sp,zoneCenter(z));assert.ok(path&&path.length,'到不了 '+z.id);
    for(const w of path)for(const s of MAP.solids){const nx=Math.max(s.x,Math.min(w.x,s.x+s.w)),ny=Math.max(s.y,Math.min(w.y,s.y+s.h));assert.ok(Math.hypot(w.x-nx,w.y-ny)>=RULES.r-.5);}}
});
test('躲貓貓：2–6 人機器人對戰都能正常結束，且相同種子結果相同',()=>{
  const play=(count,seed)=>{const rng=createRng(seed),g=createGame({rng,count}),bots=g.players.map(p=>createBot(p,{rng,nav,game:g}));
    for(let i=0;i<60*150&&!g.over;i++){const inp={};bots.forEach(b=>inp[b.id]=botInput(g,b,1/60,rng));stepGame(g,inp,1/60);}
    return {over:g.over,winner:g.winner,t:+g.t.toFixed(3),caught:g.players.map(p=>p.state)};};
  for(const count of [2,3,4,5,6])for(let seed=1;seed<=6;seed++){const r=play(count,seed*31+count);assert.equal(r.over,true);assert.deepEqual(r,play(count,seed*31+count));}
});
// ---- Phase 6：連線客戶端 ----
import {createNet,createRoomCode,hideSeekServerUrl} from '../archive/EMC-ART-Pixel-Office-2D/dist/minigames/core/net.js';
function fakeWS(){
  const made=[];
  class FakeWS{constructor(url){this.url=url;this.readyState=0;this.sent=[];made.push(this);}
    send(s){this.sent.push(JSON.parse(s));}close(){this.readyState=3;}
    open(){this.readyState=1;this.onopen&&this.onopen();}msg(o){this.onmessage&&this.onmessage({data:JSON.stringify(o)});}drop(code){this.readyState=3;this.onclose&&this.onclose({code});}}
  return {FakeWS,made};
}
const mkNet=(extra={})=>{const {FakeWS,made}=fakeWS(),timers=[],states=[],msgs=[];
  const net=createNet({url:'ws://x/hideseek',room:'ABCDEF',mode:'create',name:'小明',max:4,WS:FakeWS,setTimer:(fn,ms)=>{timers.push({fn,ms});return timers.length;},clearTimer(){},setTick:()=>1,clearTick(){},onMessage:m=>msgs.push(m),onState:(s,i)=>states.push([s,i&&i.code]),...extra});
  return {net,made,timers,states,msgs};};

test('連線：邀請碼只含易辨識字元；伺服器網址依環境選擇',()=>{
  for(let i=0;i<50;i++)assert.match(createRoomCode(),/^[A-HJ-NP-Z2-9]{6}$/);
  assert.equal(hideSeekServerUrl({hostname:'localhost',search:''}),'ws://127.0.0.1:8799/hideseek');
  assert.match(hideSeekServerUrl({hostname:'emctaipeiart.github.io',search:''}),/^wss:\/\//);
  assert.equal(hideSeekServerUrl({hostname:'emctaipeiart.github.io',search:'?hsServer=wss://t/x'}),'wss://t/x');
});
test('連線：建立房間帶人數、取得憑證後重連一律用 join＋憑證',()=>{
  const {made,timers,states}=mkNet();
  assert.match(made[0].url,/mode=create/);assert.match(made[0].url,/max=4/);assert.match(made[0].url,/name=%E5%B0%8F%E6%98%8E/);
  made[0].open();made[0].msg({t:'welcome',token:'TOK123',you:'m0'});
  made[0].drop(1006);// 意外斷線
  assert.equal(states.at(-1)[0],'reconnecting');assert.equal(timers.length,1);
  timers[0].fn();
  assert.match(made[1].url,/mode=join/);assert.match(made[1].url,/token=TOK123/);assert.doesNotMatch(made[1].url,/max=/);
});
test('連線：致命關閉碼不重連；重連有次數上限；主動離開不重連',()=>{
  for(const code of [4404,4409,4429,4408,4400]){const t=mkNet();t.made[0].open();t.made[0].drop(code);assert.equal(t.states.at(-1)[0],'closed');assert.equal(t.timers.length,0);}
  const t=mkNet();t.made[0].open();
  for(let i=0;i<5;i++){t.made.at(-1).drop(1006);assert.equal(t.states.at(-1)[0],'reconnecting');t.timers.at(-1).fn();}
  t.made.at(-1).drop(1006);assert.equal(t.states.at(-1)[0],'closed');
  const u=mkNet();u.made[0].open();u.net.close();assert.equal(u.states.at(-1)[0],'closed');assert.equal(u.timers.length,0);
});
test('連線：舊連線的遲來訊息不會干擾新連線',()=>{
  const t=mkNet();t.made[0].open();t.made[0].drop(1006);t.timers[0].fn();
  const old=t.made[0];old.msg({t:'snap'});assert.equal(t.msgs.length,0);
  t.made[1].open();t.made[1].msg({t:'welcome',token:'T',you:'m0'});assert.equal(t.msgs.length,1);
});

// ---- Phase 7+：正式排行榜（客戶端）----
import {createBoardClient,boardBaseUrl} from '../archive/EMC-ART-Pixel-Office-2D/dist/minigames/core/board.js';
const tick=()=>new Promise(r=>setTimeout(r,0));
const rankedGame=(extra={})=>({id:'rk',title:'RK',duration:1,ranked:true,starts:0,start(ctx){this.starts++;this.day=ctx.day;this.seed=ctx.seed;ctx.input.on('down',()=>ctx.addScore(10));},update(){},render(){},log(){return {answers:[{i:0,a:1,t:1}]};},destroy(){},...extra});
const ticket={ok:true,runId:'a'.repeat(32),device:'b'.repeat(32),day:'2031-01-02',nick:'小明',tag:'bbbb',verification:'full'};

test('排行榜客戶端：裝置碼存在本機；逾時與錯誤不丟例外',async()=>{
  const mem={};const storage={getItem:k=>mem[k]??null,setItem:(k,v)=>{mem[k]=v;}};
  const calls=[];
  const fetchImpl=async(url,opt)=>{calls.push([url,opt&&opt.method,opt&&opt.body&&JSON.parse(opt.body)]);return {ok:true,status:200,json:async()=>({ok:true,device:'c'.repeat(32),runId:'r'})};};
  const c=createBoardClient({base:'http://x',fetchImpl,storage});
  const r=await c.startRun('hoops','甲');assert.equal(r.ok,true);assert.equal(mem['emc-mg-device'],'c'.repeat(32));
  await c.startRun('hoops','甲');assert.equal(calls[1][2].device,'c'.repeat(32));// 第二次帶上同一個裝置碼
  await c.submit(r,{shots:[]});assert.equal(calls[2][0],'http://x/minigames/submit');
  await c.board('hoops','week');assert.match(calls[3][0],/board\?game=hoops&range=week/);
  const slow=createBoardClient({base:'http://x',timeoutMs:20,fetchImpl:(u,o)=>new Promise((_,rej)=>o.signal.addEventListener('abort',()=>rej(new Error('abort'))))});
  await assert.rejects(()=>slow.startRun('hoops','x'));
  const bad=createBoardClient({base:'http://x',fetchImpl:async()=>({ok:false,status:429,json:async()=>({ok:false,error:'rate-limited'})})});
  assert.deepEqual({ok:(await bad.startRun('hoops','x')).ok},{ok:false});
  assert.equal(boardBaseUrl({hostname:'localhost',search:''}),'http://127.0.0.1:8799');
  assert.match(boardBaseUrl({hostname:'emctaipeiart.github.io',search:''}),/^https:\/\//);
});

test('正式排行：用伺服器發的日期開局；結算時提交紀錄，以伺服器分數為準',async()=>{
  const env=setupEnv(),game=rankedGame(),submitted=[];
  const board={startRun:async(g,n)=>({...ticket,nick:n||'小明'}),submit:async(t,log)=>{submitted.push([t.runId,log]);return {ok:true,score:777,rank:2,day:'2031-01-02',board:[{rank:1,name:'甲#aaaa',score:900},{rank:2,name:'小明#bbbb',score:777}]};}};
  const m=createMiniGameManager({...env,board,nickname:()=>'小明'});m.register(game);
  m.open('rk');assert.equal(m.phase,'pending');assert.equal(game.starts,0);// 還沒拿到票就不開始
  await tick();await tick();
  assert.equal(m.phase,'countdown');assert.equal(game.starts,1);assert.equal(game.day,'2031-01-02');// 日期是伺服器的，不是本機時鐘
  env.loops[0].tick(60*4);env.loops[0].tick(60*2);
  await tick();await tick();await tick();
  assert.equal(submitted.length,1);assert.deepEqual(submitted[0][1],{answers:[{i:0,a:1,t:1}]});
  assert.equal(env.ui.last.score,777);assert.equal(env.ui.last.remote.rank,2);assert.equal(env.ui.last.remote.me,'小明#bbbb');
  m.close();assert.equal(window.count,0);
});

test('正式排行：拿不到票就是練習模式，不提交、成績只存本機；等票時離開不會留下殘局',async()=>{
  const env=setupEnv(),game=rankedGame(),submits=[];
  const m=createMiniGameManager({...env,board:{startRun:async()=>{throw new Error('offline');},submit:async()=>{submits.push(1);}}});m.register(game);
  m.open('rk');await tick();await tick();
  assert.equal(m.phase,'countdown');assert.equal(game.starts,1);
  env.loops[0].tick(60*4);env.loops[0].tick(60*2);await tick();
  assert.equal(submits.length,0);assert.match(env.ui.last.lines.join(' '),/練習模式/);assert.ok(env.ui.last.record);
  m.close();
  const game2=rankedGame({id:'rk2'});m.register(game2);
  m.open('rk2');m.close();await tick();await tick();// 還在等票就關掉
  assert.equal(game2.starts,0);assert.equal(m.active,false);assert.equal(window.count,0);
});

test('正式排行：伺服器拒絕或連不上時，分數只留本機並說明原因',async()=>{
  for(const res of [{ok:false,error:'too-fast'},null]){
    const env=setupEnv(),game=rankedGame();
    const m=createMiniGameManager({...env,board:{startRun:async()=>ticket,submit:async()=>{if(!res)throw new Error('net');return res;}}});m.register(game);
    m.open('rk');await tick();await tick();env.loops[0].tick(60*4);env.loops[0].tick(60*2);await tick();await tick();
    assert.match(env.ui.last.lines.join(' '),res?/驗證失敗/:/無法連上排行榜/);assert.ok(env.ui.last.record);m.close();
  }
});

// ---- 入口開關 ----
import fs from 'node:fs';
test('入口開關：預設隱藏按鈕、不載入小遊戲程式；只有 ?minigames=1 才啟用',()=>{
  const html=fs.readFileSync(new URL('../archive/EMC-ART-Pixel-Office-2D/dist/index.html',import.meta.url),'utf8');
  const css=fs.readFileSync(new URL('../archive/EMC-ART-Pixel-Office-2D/dist/minigames/minigames.css',import.meta.url),'utf8');
  assert.doesNotMatch(html,/<script[^>]*type="module"[^>]*minigames/);// 不再靜態載入
  assert.match(html,/get\('minigames'\)==='1'/);
  assert.match(html,/classList\.contains\('minigames-on'\)/);
  assert.match(css,/\.mg-entry\{display:none\}/);
  assert.match(css,/html\.minigames-on \.mg-entry\{display:inline-flex/);
  // 開關只認 =1：模擬網址判斷
  const on=s=>new URLSearchParams(s).get('minigames')==='1';
  assert.equal(on(''),false);assert.equal(on('?clean=1&cs=1.2'),false);assert.equal(on('?minigames=0'),false);assert.equal(on('?minigames=true'),false);
  assert.equal(on('?minigames=1'),true);assert.equal(on('?clean=1&minigames=1&cs=1.2'),true);
});

// ---- 躲貓貓：真實辦公室地圖 ----
const inSolid=(x,y)=>MAP.solids.some(s=>x>=s.x&&x<=s.x+s.w&&y>=s.y&&y<=s.y+s.h);
const freeAt=(x,y,r=RULES.r+1)=>MAP.solids.every(s=>Math.hypot(x-Math.max(s.x,Math.min(x,s.x+s.w)),y-Math.max(s.y,Math.min(y,s.y+s.h)))>=r);
const zoneById=id=>MAP.zones.find(z=>z.id===id);
function openPointAt(from,dist){// 從 from 往各方向找一個「放得下人、而且和 from 之間沒有高家具」的點
  for(let a=0;a<360;a+=15){const p={x:from.x+Math.cos(a*Math.PI/180)*dist,y:from.y+Math.sin(a*Math.PI/180)*dist};
    if(p.x>MAP.bounds.x+40&&p.x<MAP.bounds.x+MAP.bounds.w-40&&p.y>MAP.bounds.y+40&&p.y<MAP.bounds.y+MAP.bounds.h-40&&freeAt(p.x,p.y)&&lineOfSight(from,p))return p;}
  throw new Error('找不到空點');
}

test('躲貓貓：地圖是真實辦公室——房間、遮蔽區、出生點、遮擋圖層都在，且都放得下人',()=>{
  assert.equal(MAP.w,2370);assert.equal(MAP.h,3260);
  assert.deepEqual(MAP.rooms.map(r=>r.name),['男廁','女廁','會議室 A','會議室 B','會議室 C','會議室 D']);
  assert.ok(MAP.zones.length>=20);assert.ok(MAP.occluders.length>=50);assert.equal(MAP.spawns.length,6);
  for(const z of MAP.zones){assert.ok(z.spot,z.id+' 沒有可站的點');assert.ok(freeAt(z.spot.x,z.spot.y),z.id+' 的點被家具擋住');assert.ok(z.spot.x>=z.x&&z.spot.x<=z.x+z.w&&z.spot.y>=z.y&&z.spot.y<=z.y+z.h);}
  for(const s of MAP.spawns)assert.ok(freeAt(s.x,s.y),'出生點被擋住');
  for(const o of MAP.occluders)assert.ok(o.w>0&&o.h>0&&o.depth>=o.y);
});
test('躲貓貓：玻璃牆與櫃子擋視線、桌子不擋；遮蔽區要靠近才看得到、超出視野看不到',()=>{
  const wall=MAP.solids.find(s=>s.kind==='wall'&&s.h===24&&s.w>=300&&s.tall);
  const a={x:wall.x+wall.w/2,y:wall.y-30},b={x:wall.x+wall.w/2,y:wall.y+wall.h+30};
  assert.equal(lineOfSight(a,b),false);
  const desk=MAP.solids.find(s=>s.kind==='desk'&&!s.tall&&s.w>=200&&s.h>=100);
  assert.equal(lineOfSight({x:desk.x+desk.w/2,y:desk.y-20},{x:desk.x+desk.w/2,y:desk.y+desk.h+20}),true);// 隔著桌子還看得到
  const z=zoneById('tea-south'),spot=z.spot;
  assert.ok(zoneAt(spot));
  const far=openPointAt(spot,RULES.coverReveal+120),near=openPointAt(spot,RULES.coverReveal-40);
  assert.equal(canSee(far,spot),false);assert.equal(canSee(near,spot),true);
  const open={x:MAP.spawns[0].x,y:MAP.spawns[0].y};
  assert.equal(canSee(open,{x:open.x+RULES.vision+50,y:open.y}),false);
});
test('躲貓貓：抓捕需要在範圍內、看得到；亂按有冷卻',()=>{
  const {g}=mk(3,5,0),sk=seekerOf(g),h=g.players[1],h2=g.players[2];
  run(g,RULES.hideSecs+0.05);
  const wall=MAP.solids.find(s=>s.kind==='wall'&&s.h===24&&s.w>=300&&s.tall);
  Object.assign(sk,{x:wall.x+wall.w/2,y:wall.y-30});Object.assign(h,{x:wall.x+wall.w/2,y:wall.y+wall.h+30});Object.assign(h2,{x:MAP.spawns[5].x,y:MAP.spawns[5].y});
  stepGame(g,{p0:{catch:true}},1/60);assert.equal(h.state,'alive');// 隔著牆（距離夠近也抓不到）
  const far=openPointAt(MAP.spawns[0],RULES.catchRange+30);
  sk.cooldown=0;Object.assign(sk,{x:MAP.spawns[0].x,y:MAP.spawns[0].y});Object.assign(h,far);stepGame(g,{p0:{catch:true}},1/60);assert.equal(h.state,'alive');// 太遠
  const close=openPointAt(MAP.spawns[0],RULES.catchRange-30);
  sk.cooldown=0;Object.assign(h,close);stepGame(g,{p0:{catch:true}},1/60);assert.equal(h.state,'caught');
  assert.ok(sk.cooldown>0);
});
test('躲貓貓：沒有擠不過去的窄縫——家具之間 0～58 像素的縫都被補平，人不會被推擠卡進去',()=>{
  const need=RULES.r*2+2,bd=MAP.bounds;
  const fences=[{x:bd.x-200,y:bd.y-200,w:bd.w+400,h:200},{x:bd.x-200,y:bd.y+bd.h,w:bd.w+400,h:200},{x:bd.x-200,y:bd.y,w:200,h:bd.h},{x:bd.x+bd.w,y:bd.y,w:200,h:bd.h}];
  const all=[...MAP.solids.filter(s=>s.kind!=='gap'),...fences];let checked=0;
  const gap=(a,b)=>[Math.max(0,a.x-(b.x+b.w),b.x-(a.x+a.w)),Math.max(0,a.y-(b.y+b.h),b.y-(a.y+a.h))];
  for(let i=0;i<all.length;i++)for(let j=i+1;j<all.length;j++){
    const [gx,gy]=gap(all[i],all[j]);if((gx>0)===(gy>0)||Math.max(gx,gy)>=need)continue;
    const A=all[i],B=all[j];
    const x0=gx?Math.min(A.x+A.w,B.x+B.w):Math.max(A.x,B.x),x1=gx?Math.max(A.x,B.x):Math.min(A.x+A.w,B.x+B.w),y0=gy?Math.min(A.y+A.h,B.y+B.h):Math.max(A.y,B.y),y1=gy?Math.max(A.y,B.y):Math.min(A.y+A.h,B.y+B.h);
    if(x1<=x0||y1<=y0)continue;
    for(const [fx,fy] of [[.5,.5],[.1,.5],[.9,.5],[.5,.1],[.5,.9]])assert.ok(inSolid(x0+(x1-x0)*fx,y0+(y1-y0)*fy),'縫沒補：'+(A.kind||'邊界')+' / '+(B.kind||'邊界')+' @'+Math.round(x0)+','+Math.round(y0));
    checked++;
  }
  assert.ok(checked>20);
});

// ---- 介面：怎麼玩說明卡、獎牌 ----
test('怎麼玩：第一次先顯示說明卡，按「開始」才進倒數；勾「不再顯示」後下次直接開始',()=>{
  const env=setupEnv();let shown=0,skip=false;const saved={};
  env.ui.howto=()=>{shown++;};env.ui.skipChecked=()=>skip;
  const game={...simpleGame(),howto:{goal:'g',pc:'p',touch:'t',tips:[]},starts:0};const orig=game.start;game.start=function(c){this.starts++;return orig.call(this,c);};
  const m=createMiniGameManager({...env,prefs:{get:k=>saved[k]??null,set:(k,v)=>{saved[k]=v;}}});m.register(game);
  m.open('t');assert.equal(m.phase,'howto');assert.equal(shown,1);assert.equal(game.starts,0);
  skip=true;env.ui.act('go');assert.equal(m.phase,'countdown');assert.equal(game.starts,1);assert.equal(saved['emc-mg-howto-t'],'1');
  m.close();m.open('t');assert.equal(m.phase,'countdown');assert.equal(shown,1);m.close();// 第二次不再顯示
  assert.equal(window.count,0);
});
test('獎牌：依分數門檻給銅／銀／金，並告知離下一面還差多少',()=>{
  const cases=[[0,null,100],[100,'bronze',200],[250,'bronze',50],[300,'silver',300],[600,'gold',null]];
  for(const [score,medal,next] of cases){
    const env=setupEnv(),game={...simpleGame({medals:[100,300,600]}),result(){return {score};}};
    const m=createMiniGameManager({...env,prefs:{get:()=>null,set(){}}});m.register(game);
    m.open('t');env.loops[0].tick(60*4);env.loops[0].tick(60*2);
    assert.equal(env.ui.last.medal,medal,'分數 '+score);assert.equal(env.ui.last.medalNext,next);
    m.close();
  }
});

import test from 'node:test';
import assert from 'node:assert/strict';
import {createRng,dailySeed,dayKey} from '../EMC-ART-Pixel-Office/dist/minigames/core/rng.js';
import {createFixedLoop} from '../EMC-ART-Pixel-Office/dist/minigames/core/loop.js';
import {createScoreStore} from '../EMC-ART-Pixel-Office/dist/minigames/core/score.js';
import {createMiniGameManager} from '../EMC-ART-Pixel-Office/dist/minigames/core/manager.js';

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
    mount(){this.mounted=true;},unmount(){this.mounted=false;},show(){},hide(){},setTime(){},setScore(){},setExtra(){},setPauseLabel(){},banner(){},pausePanel(){},closePanel(){},
    results(r){this.last=r;},onAction(fn,signal){this.act=fn;}
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

// MiniGameManager：註冊遊戲、管理生命週期（倒數→進行→暫停→結算）、輸入閘門與清理。
// 遊戲模組彼此不得 import；只能透過 manager 傳入的 ctx 使用共用能力。
import {createFixedLoop} from './loop.js';
import {createInput} from './input.js';
import {createRng,dayKey,hashString,seedForDay} from './rng.js';

const COUNTDOWN=3;// 遊戲可用 def.countdown 覆寫（連線遊戲由伺服器決定開始時間，設 0）

export function createMiniGameManager({ui,store,bridge,board=null,nickname=()=>'',loopFactory=createFixedLoop,inputFactory=createInput,now=()=>new Date(),onError=e=>console.error('[minigame]',e)}){
  const games=new Map();
  let run=null;// 目前進行中的一局，離開後為 null

  const guard=(fn,fallback)=>{try{return fn();}catch(error){onError(error);abort();return fallback;}};

  function register(def){
    for(const k of ['id','title','duration','start','update','render'])if(!(k in def))throw new Error('minigame missing '+k);
    if(games.has(def.id))throw new Error('duplicate minigame '+def.id);
    games.set(def.id,def);
  }

  function layout(){
    if(!run)return;
    // 整頁模式下場景畫布可能比視窗大（頁面捲動），遊戲區只取畫布與視窗重疊的部分。
    const b=bridge.rect(),vw=globalThis.innerWidth||b.width,vh=globalThis.innerHeight||b.height;
    const left=Math.max(b.left,0),top=Math.max(b.top,0),r={left,top,width:Math.max(1,Math.min(b.left+b.width,vw)-left),height:Math.max(1,Math.min(b.top+b.height,vh)-top)};
    const dpr=Math.min(2,globalThis.devicePixelRatio||1),s=ui.root.style;
    s.left=r.left+'px';s.top=r.top+'px';s.width=r.width+'px';s.height=r.height+'px';
    run.width=Math.max(1,Math.round(r.width));run.height=Math.max(1,Math.round(r.height));
    ui.canvas.width=Math.round(run.width*dpr);ui.canvas.height=Math.round(run.height*dpr);
    run.g.setTransform(dpr,0,0,dpr,0,0);
    if(run.def.resize)guard(()=>run.def.resize(run.ctx,run.width,run.height));
  }

  function open(id){
    if(run)return false;
    const def=games.get(id);if(!def)return false;
    const ac=new AbortController(),signal=ac.signal;
    const ranked=!!(def.ranked&&board);// 正式排行：日期與種子由伺服器發的票決定；要不到票就是練習模式
    const g=ui.canvas.getContext('2d');
    const countdown=def.countdown??COUNTDOWN;
    const r0=run={def,ac,phase:ranked?'pending':(countdown>0?'countdown':'running'),t:countdown,timeLeft:def.duration,score:0,day:dayKey(now()),seed:0,width:1,height:1,g,loop:null,input:null,ctx:null,ended:false,result:null,ticket:null,practice:false};
    // ---- 輸入閘門：進行中辦公室不接收任何移動、拖曳、縮放 ----
    bridge.releaseKeys();
    const shield=e=>{const t=e.target;if(ui.root.contains(t))return;if(t===bridge.canvasEl||(t.closest&&t.closest('#joystick,aside')))e.stopPropagation();};
    for(const type of ['pointerdown','pointermove','pointerup','touchstart','touchmove','wheel'])window.addEventListener(type,shield,{capture:true,signal,passive:false});
    window.addEventListener('keydown',e=>{
      if(e.target&&['INPUT','TEXTAREA','SELECT'].includes(e.target.tagName))return;
      if(e.key==='Escape'){e.preventDefault();e.stopPropagation();togglePause();return;}
      e.stopPropagation();
      if(e.key.startsWith('Arrow')||e.key===' ')e.preventDefault();
    },{capture:true,signal});
    window.addEventListener('keyup',e=>e.stopPropagation(),{capture:true,signal});
    document.addEventListener('visibilitychange',()=>{if(document.hidden&&run&&run.phase==='running')pause();},{signal});
    window.addEventListener('resize',layout,{signal});
    if(typeof ResizeObserver!=='undefined'){const ro=new ResizeObserver(layout);ro.observe(bridge.canvasEl);signal.addEventListener('abort',()=>ro.disconnect());}
    // ---- 介面 ----
    ui.mount();ui.show(def.title);ui.setPauseVisible(def.canPause!==false);ui.setScore(0);ui.setTime(def.duration);ui.setExtra('');ui.setPauseLabel(false);
    ui.onAction(act=>{
      if(act==='pause')togglePause();
      else if(act==='quit')close();
      else if(act==='again'){const again=run.def.id;close();open(again);}
    },signal);
    run.input=inputFactory(ui.canvas,signal);
    const ctx=run.ctx={
      g,get width(){return run.width;},get height(){return run.height;},
      rngFor:name=>createRng(hashString(id+':'+name+'@'+r0.day)),input:run.input,bridge,signal,
      get day(){return r0.day;},get seed(){return r0.seed;},get practice(){return r0.practice;},
      get score(){return run.score;},get timeLeft(){return run.timeLeft;},
      addScore(n){run.score=Math.max(0,run.score+n);ui.setScore(run.score);},
      setScore(n){run.score=Math.max(0,n);ui.setScore(run.score);},
      // 場景座標 <-> 遊戲畫布座標（相機移動、縮放後仍然對得上辦公室）
      sceneToLocal(x,y){const c=bridge.sceneToClient(x,y),r=ui.root.getBoundingClientRect();return {x:c.x-r.left,y:c.y-r.top};},
      localToScene(x,y){const r=ui.root.getBoundingClientRect();return bridge.clientToScene(r.left+x,r.top+y);},
      scenePxScale:()=>bridge.pxPerScene(),
      setExtra:t=>ui.setExtra(t),setTime:sec=>ui.setTime(sec),banner:t=>ui.banner(t),
      end:(lines)=>finish(lines)
    };
    layout();
    const begin=ticket=>{
      if(run!==r0)return;// 等票的時候玩家已經離開
      if(ticket){r0.ticket=ticket;r0.day=ticket.day;}else if(ranked){r0.practice=true;}
      r0.seed=seedForDay(id,r0.day);ctx.rng=createRng(r0.seed);
      r0.phase=countdown>0?'countdown':'running';
      ui.banner(r0.practice?'練習模式：未連上排行榜':'');
      r0.loop=loopFactory({update:step,render:draw});
      guard(()=>def.start(ctx));
      if(run===r0)r0.loop.start();
      bridge.markDirty();
    };
    if(ranked){
      ui.banner('連線中…');
      Promise.resolve().then(()=>board.startRun(id,nickname())).then(t=>begin(t&&t.ok?t:null),()=>begin(null));
    }else begin(null);
    return true;
  }

  function step(dt){
    if(!run||run.ended)return;
    if(run.phase==='countdown'){
      run.t-=dt;ui.banner(run.t>0?String(Math.ceil(run.t)):'GO!');
      if(run.t<=-0.4){run.phase='running';ui.banner('');}// t<=0 時顯示 GO!，再停 0.4 秒開始
      return;
    }
    if(run.phase!=='running')return;
    // timer:'external'＝時間由遊戲（伺服器）決定：不倒數、不自動結束，遊戲自己呼叫 ctx.setTime／ctx.end
    const external=run.def.timer==='external';
    if(!external){run.timeLeft-=dt;ui.setTime(run.timeLeft);}
    guard(()=>run.def.update(run.ctx,dt));
    if(run&&!external&&run.timeLeft<=0)finish();
  }

  function draw(alpha){
    if(!run)return;
    run.g.clearRect(0,0,run.width,run.height);
    guard(()=>run.def.render(run.ctx,alpha,run.phase));
  }

  function pause(){if(!run||run.phase!=='running'||run.def.canPause===false)return;run.phase='paused';run.loop.stop();ui.setPauseLabel(true);ui.pausePanel();run.input.clear();}
  function resume(){if(!run||run.phase!=='paused')return;run.phase='running';ui.setPauseLabel(false);ui.closePanel();run.loop.start();}
  function togglePause(){if(!run)return;if(run.phase==='paused')resume();else pause();}

  function finish(lines=[]){
    if(!run||run.ended)return;
    run.ended=true;run.phase='finished';run.loop.stop();
    const r=run,extra=guard(()=>r.def.result?r.def.result(r.ctx):null,null)||{};
    const score=Math.max(0,Math.round(extra.score??r.score));
    const baseLines=[...(extra.lines||[]),...lines];
    ui.setScore(score);ui.banner('');
    const showLocal=(note)=>{
      // noRecord：連線對戰不寫入任何成績紀錄或排行，避免互相配合刷分
      const record=r.def.noRecord?null:store.submit(r.def.id,{score,day:r.day});
      r.result={score,record};
      ui.results({title:r.def.title,score,lines:note?[...baseLines,note]:baseLines,record,board:record?record.board:[],again:!r.def.noAgain});
    };
    if(r.ticket&&!r.practice&&r.def.log){
      // 正式排行：成績由伺服器依作答紀錄重算，這裡顯示的分數以伺服器為準
      r.result={score,record:null};
      ui.results({title:r.def.title,score,lines:[...baseLines,'成績驗證中…'],record:null,board:[],again:false});
      const log=guard(()=>r.def.log(r.ctx),null);
      Promise.resolve().then(()=>board.submit(r.ticket,log)).then(res=>{
        if(run!==r)return;
        if(!res||!res.ok)return showLocal('成績驗證失敗（'+(res&&res.error||'無回應')+'），只存在本機');
        const record=store.submit(r.def.id,{score:res.score,day:r.day});
        r.result={score:res.score,record,remote:res};
        ui.setScore(res.score);
        ui.results({title:r.def.title,score:res.score,lines:baseLines.filter(l=>!/^題組日期/.test(l)),record,board:[],again:true,
          remote:{rank:res.rank,day:res.day,level:r.ticket.verification,board:res.board||[],me:r.ticket.nick+'#'+r.ticket.tag,replay:!!res.replay}});
      },()=>{if(run===r)showLocal('無法連上排行榜，成績只存在本機');});
      return;
    }
    showLocal(r.practice?'練習模式：成績只存在本機，不計入排行':'');
  }

  // 例外時的安全退出：不留下任何事件、計時器或被鎖住的輸入。
  function abort(){if(run)close();}

  function close(){
    if(!run)return;
    const r=run;run=null;
    try{r.loop&&r.loop.stop();}catch(e){onError(e);}
    try{r.def.destroy&&r.def.destroy(r.ctx);}catch(e){onError(e);}
    r.ac.abort();// 一次移除所有事件監聽（輸入、閘門、resize、visibility）
    ui.hide();ui.unmount();
    bridge.releaseKeys();bridge.markDirty();
    for(const fn of [...closeListeners])try{fn(r.def.id);}catch(e){onError(e);}
  }
  const closeListeners=new Set();

  return {register,open,close,pause,resume,onClosed:fn=>{closeListeners.add(fn);return ()=>closeListeners.delete(fn);},get(id){return games.get(id);},list:()=>[...games.values()].map(g=>({id:g.id,title:g.title})),
    get active(){return !!run;},get phase(){return run?run.phase:'idle';},get lastResult(){return run?run.result:null;}};
}

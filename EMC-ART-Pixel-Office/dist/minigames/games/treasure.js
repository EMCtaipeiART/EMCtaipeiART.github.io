// 辦公室尋寶：120 秒內找出今天藏在辦公室裡的 5 個小物。道具位置由每日種子決定。
import {TREASURE_ITEMS,loadTreasureArt,drawSprite} from '../assets/treasure-items.js';
import {floorCandidates,pickTreasures,treasureScore,TREASURE_COUNT,TREASURE_SECONDS,FIND_POINTS,HINT_PENALTY,TIME_BONUS_PER_SEC} from './treasure-gen.js';

const HUD_TOP=64,BOTTOM_PAD=70,HINT_W=120,HINT_H=44;

export const treasureGame={
  clock:'wall',
  id:'treasure',title:'辦公室尋寶',icon:'map',blurb:'限時找出藏在辦公室裡的 5 件小東西',medals:[300,500,650],
  howto:{goal:'在 120 秒內，找出今天藏在整個辦公室裡的 5 個小道具（桌上、角落、家具旁都可能有，畫面可以捲動）。',pc:'滾輪或拖曳捲動辦公室，用滑鼠點道具；按 H 或點右下「提示」看大概位置（扣 50 分，每局一次）。',touch:'手指拖曳捲動辦公室、點道具；點右下「提示」看大概位置。',tips:['道具很小，留意家具邊緣與房間角落','全部找齊後，剩餘時間每秒 +2 分','每天的題目不同，同一天大家一樣']},duration:TREASURE_SECONDS,ranked:true,
  start(ctx){
    loadTreasureArt(()=>ctx.bridge.markDirty());
    const sc=ctx.bridge.scene(),defs=Object.fromEntries(TREASURE_ITEMS.map(d=>[d.id,d])),office=window.__pixelOffice;
    // 整個辦公室都可以藏（畫面可以捲動）。大部分藏在桌面、會議桌、角落與家具旁，最多 1 個放在地上（太好找）
    const floor=floorCandidates({minX:80,maxX:sc.W-80,minY:sc.minY+30,maxY:sc.maxY-30,isFree:(x,y)=>!ctx.bridge.blocked(x,y)});
    const spots=office.treasureSpots?office.treasureSpots():{desk:[],table:[],corner:[]},surfaces=[...spots.desk,...spots.table,...spots.corner];
    const types=TREASURE_ITEMS.map(d=>d.id),rng=ctx.rngFor('items');
    let items=[];
    for(const gap of [220,150,90]){// 候選不足時逐步放寬間距，仍維持每日固定順序
      const main=pickTreasures({rng:ctx.rngFor('items-s'),candidates:surfaces,types,count:TREASURE_COUNT-1,minGap:gap});
      const rest=pickTreasures({rng,candidates:floor,types:types.filter(t=>!main.some(m=>m.type===t)),count:1,minGap:gap,existing:main});
      items=[...main,...rest];
      if(items.length>=TREASURE_COUNT)break;
    }
    this.state={
      items:items.map(i=>({...i,found:false,foundAt:0,sprite:'item_'+i.type,name:defs[i.type].name})),
      total:items.length,found:0,finds:[],hintUsed:false,hint:null,clock:0,fx:[],hDown:false,hintBox:null
    };
    this.sync(ctx);
    const st=this.state;st.drag=null;
    ctx.input.on('down',p=>{const hb=st.hintBox;if(hb&&p.x>=hb.x&&p.x<=hb.x+hb.w&&p.y>=hb.y&&p.y<=hb.y+hb.h){this.useHint(ctx);return;}st.drag={id:p.id,x:p.x,y:p.y,lx:p.x,ly:p.y,moved:false};});
    ctx.input.on('move',p=>{const d=st.drag;if(!d||d.id!==p.id)return;if(!d.moved&&Math.hypot(p.x-d.x,p.y-d.y)>10)d.moved=true;if(d.moved){this.scrollBy(d.lx-p.x,d.ly-p.y);}d.lx=p.x;d.ly=p.y;});
    ctx.input.on('up',p=>{const d=st.drag;if(!d||d.id!==p.id)return;st.drag=null;if(!d.moved)this.press(ctx,p);});
    this.onWheel=e=>{e.preventDefault();this.scrollBy(e.deltaX,e.deltaY);};document.addEventListener('wheel',this.onWheel,{passive:false});
    ctx.banner('');
  },
  /** 捲動辦公室畫面：桌機捲頁面，手機（鏡頭模式）移動鏡頭 */
  scrollBy(dx,dy){const o=window.__pixelOffice;if(!o)return;const cam=o.cam;
    if(cam&&cam.on){if(!cam.free){cam.fx=cam.left+cam.w/2/cam.s;cam.fy=cam.top+cam.h/2/cam.s;cam.free=true;}const sc=o.scene();cam.fx=Math.max(cam.w/2/cam.s,Math.min(sc.W-cam.w/2/cam.s,cam.fx+dx/cam.s));cam.fy+=dy/cam.s;o.markDirty();}
    else window.scrollBy(dx,dy);},
  sync(ctx){const s=this.state;ctx.setScore(treasureScore({found:s.found,total:s.total,timeLeft:0,hintUsed:s.hintUsed}));ctx.setExtra('找到 '+s.found+' / '+s.total);},
  press(ctx,p){
    const s=this.state;if(!s||ctx.timeLeft<=0)return;
    const reach=Math.max(24,Math.round(44*ctx.scenePxScale()*.7));// 命中半徑至少 26px，手指也點得到
    let best=null,bd=Infinity;
    for(const it of s.items){if(it.found)continue;const l=ctx.sceneToLocal(it.x,it.y),d=Math.hypot(l.x-p.x,l.y-p.y);if(d<=reach&&d<bd){best=it;bd=d;}}
    if(best){best.found=true;best.foundAt=s.clock;s.found++;s.finds.push({t:+(this.duration-ctx.timeLeft).toFixed(3)});s.fx.push({x:best.x,y:best.y,t:s.clock,text:'+'+FIND_POINTS});this.sync(ctx);if(s.found>=s.total)ctx.end();}
    else s.fx.push({x:ctx.localToScene(p.x,p.y).x,y:ctx.localToScene(p.x,p.y).y,t:s.clock,miss:true});
  },
  useHint(ctx){
    const s=this.state;if(s.hintUsed||s.found>=s.total)return;
    const it=s.items.find(i=>!i.found);if(!it)return;
    {const l=ctx.sceneToLocal(it.x,it.y);if(l.y<90||l.y>ctx.height-90||l.x<30||l.x>ctx.width-30)this.scrollBy(l.x-ctx.width/2,l.y-ctx.height/2);}// 提示的道具在畫面外：把畫面捲過去
    s.hintUsed=true;s.hint={item:it,until:s.clock+5,dx:ctx.rng.int(-30,30),dy:ctx.rng.int(-30,30)};this.sync(ctx);
    s.fx.push({x:it.x,y:it.y,t:s.clock,text:'-'+HINT_PENALTY,hintPenalty:true});
  },
  cell(ctx){return Math.max(2,Math.round(ctx.scenePxScale()*2.4));},
  update(ctx,dt){
    const s=this.state;s.clock+=dt;
    const h=ctx.input.isDown('KeyH');if(h&&!s.hDown)this.useHint(ctx);s.hDown=h;
    s.fx=s.fx.filter(f=>s.clock-f.t<1.2);
    if(s.hint&&s.clock>s.hint.until)s.hint=null;
  },
  render(ctx){
    const s=this.state,g=ctx.g,cell=this.cell(ctx);g.imageSmoothingEnabled=false;
    for(const it of s.items){
      const l=ctx.sceneToLocal(it.x,it.y),size=Math.max(26,Math.round(44*ctx.scenePxScale())),age=s.clock-it.foundAt;
      if(it.found){if(age<0.6){g.globalAlpha=1-age/0.6;drawSprite(g,it.sprite,l.x-size/2,l.y-size/2-age*30,size,size);const f=age<.2?'a':age<.4?'b':'c',fs=size*.9;drawSprite(g,'fx_sparkle_'+f,l.x-fs/2,l.y-fs/2-age*30,fs,fs);g.globalAlpha=1;}continue;}
      drawSprite(g,it.sprite,l.x-size/2,l.y-size/2,size,size);
    }
    if(s.hint){
      const l=ctx.sceneToLocal(s.hint.item.x,s.hint.item.y),r=70+Math.sin(s.clock*6)*6;
      g.strokeStyle='#ffd24a';g.lineWidth=4;g.setLineDash([10,8]);g.beginPath();g.arc(l.x+s.hint.dx,l.y+s.hint.dy,r,0,Math.PI*2);g.stroke();g.setLineDash([]);
    }
    for(const f of s.fx){
      const l=ctx.sceneToLocal(f.x,f.y),a=1-(s.clock-f.t)/1.2;g.globalAlpha=Math.max(0,a);
      if(f.miss){g.strokeStyle='#182e54';g.lineWidth=2;g.beginPath();g.arc(l.x,l.y,8+(1-a)*22,0,Math.PI*2);g.stroke();}
      else{g.fillStyle=f.hintPenalty?'#c0392b':'#0f7f27';g.font='900 22px sans-serif';g.textAlign='center';g.fillText(f.text,l.x,l.y-30-(1-a)*30);}
      g.globalAlpha=1;
    }
    // 道具列（左下）與提示鍵（右下）
    const slot=48;
    s.items.forEach((it,i)=>{
      const x=10+i*(slot+6),y=ctx.height-slot-10;
      if(it.found){drawSprite(g,'slot_frame',x,y,slot,slot);drawSprite(g,it.sprite,x+4,y+4,slot-8,slot-8);}else drawSprite(g,'slot_empty',x,y,slot,slot);
    });
    const hx=ctx.width-HINT_W-10,hy=ctx.height-HINT_H-10,off=s.hintUsed;s.hintBox={x:hx,y:hy,w:HINT_W,h:HINT_H};
    drawSprite(g,off?'hint_btn_off':'hint_btn',hx,hy,HINT_W,HINT_H);
    g.fillStyle='#182e54';g.font='700 14px sans-serif';g.textAlign='center';g.fillText(off?'提示已用':'提示 -50',hx+HINT_W/2,hy+HINT_H/2+5);
  },
  /** 正式排行用的紀錄（道具位置依螢幕而異，伺服器只能做簡易驗證：次數、間隔、真實時間）。 */
  log(){const s=this.state;return {finds:s.finds,hint:s.hintUsed};},
  result(ctx){
    const s=this.state,score=treasureScore({found:s.found,total:s.total,timeLeft:ctx.timeLeft,hintUsed:s.hintUsed});
    const lines=['找到 '+s.found+' / '+s.total+' 個'];
    if(s.found>=s.total)lines.push('剩餘 '+Math.floor(Math.max(ctx.timeLeft,0))+' 秒，加成 +'+Math.floor(Math.max(ctx.timeLeft,0))*TIME_BONUS_PER_SEC);
    if(s.hintUsed)lines.push('使用提示 -'+HINT_PENALTY);
    lines.push('題組日期 '+ctx.day+'（每天不同，同日大家相同）');
    return {score,lines};
  },
  destroy(){if(this.onWheel)document.removeEventListener('wheel',this.onWheel);this.onWheel=null;this.state=null;}
};


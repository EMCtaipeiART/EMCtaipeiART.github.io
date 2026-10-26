// 辦公室躲貓貓（單機）：你加上 3 個機器人，在真實辦公室裡玩。規則與伺服器共用同一份 hideseek-sim。
import {RULES,TOTAL_SECS,createGame,stepGame,canSee,aliveHiders,seekerOf,scoreFor,dist} from './hideseek-sim.js';
import {buildNav,createBot,botInput} from './hideseek-ai.js';
import {loadArt,makeView,drawBoard,drawPerson,drawSorted,drawFog,drawMinimap,resetMotion} from './hideseek-draw.js';

const HUD_TOP=56,PLAYERS=4,JOY_R=54,BTN_R=40;

export const hideseekGame={
  id:'hideseek',title:'辦公室躲貓貓',icon:'eye',blurb:'在真實辦公室裡躲貓貓（你加 3 個機器人）',medals:[300,600,900],
  howto:{goal:'尋找者：120 秒內抓到所有躲藏者。躲藏者：躲好，撐到時間結束。',pc:'WASD／方向鍵移動；尋找者靠近後按空白鍵抓人；M 切換全圖／跟隨。',touch:'按住左半邊畫面拖曳＝搖桿；尋找者按右下角「抓！」。',tips:['綠色虛線是遮蔽區域，躲在裡面要靠很近才會被看到','玻璃牆與櫃子會擋視線，會議室與廁所的門有缺口','開局 20 秒，尋找者要閉眼等躲藏者躲好']},duration:TOTAL_SECS,
  start(ctx){
    loadArt(()=>ctx.bridge.markDirty());resetMotion();
    const rng=ctx.rngFor('room:'+Math.floor(performance.now())),game=createGame({rng,count:PLAYERS}),nav=buildNav();
    this.state={game,rng,bots:game.players.slice(1).map(p=>createBot(p,{rng,nav,game})),view:null,mode:'follow',
      joy:null,btn:false,clock:0,bannerUntil:0,note:'',spectBtn:null,catchBox:null,modeBtn:null,lastExtra:'',wasKey:false};
    const me=game.players[0];
    ctx.banner(me.role==='seeker'?'你是尋找者':'你是躲藏者');this.state.bannerUntil=2;
    this.fit(ctx);
    ctx.input.on('down',p=>{
      const s=this.state;if(!s)return;
      if(s.spectBtn&&this.inBox(p,s.spectBtn)){ctx.end();return;}
      if(s.modeBtn&&this.inBox(p,s.modeBtn)){s.mode=s.mode==='full'?'follow':'full';return;}
      if(s.catchBox&&Math.hypot(p.x-s.catchBox.x,p.y-s.catchBox.y)<=BTN_R+10){s.btn=true;return;}
      if(p.x<ctx.width*.6&&!s.joy)s.joy={id:p.id,ox:p.x,oy:p.y,x:p.x,y:p.y};
    });
    ctx.input.on('move',p=>{const j=this.state&&this.state.joy;if(j&&j.id===p.id){j.x=p.x;j.y=p.y;}});
    ctx.input.on('up',p=>{const s=this.state;if(s&&s.joy&&s.joy.id===p.id)s.joy=null;});
  },
  resize(ctx){this.fit(ctx);},
  fit(ctx){const s=this.state;if(s)s.view=makeView(ctx,HUD_TOP,s.mode,s.game.players[0]);},
  inBox(p,b){return p.x>=b.x&&p.x<=b.x+b.w&&p.y>=b.y&&p.y<=b.y+b.h;},
  humanInput(ctx){
    const s=this.state,a=ctx.input.axis();let dx=a.x,dy=a.y;
    if(s.joy){const jx=s.joy.x-s.joy.ox,jy=s.joy.y-s.joy.oy,l=Math.hypot(jx,jy);if(l>8){const k=Math.min(l,JOY_R)/JOY_R/l;dx=jx*k;dy=jy*k;}}
    const doCatch=s.btn||ctx.input.isDown('Space')||ctx.input.isDown('KeyE');
    s.btn=false;
    return {dx,dy,catch:doCatch};
  },
  update(ctx,dt){
    const s=this.state,g=s.game;s.clock+=dt;
    const m=ctx.input.isDown('KeyM');if(m&&!s.wasKey)s.mode=s.mode==='full'?'follow':'full';s.wasKey=m;
    if(s.joy&&ctx.input.pointers.size===0)s.joy=null;
    if(s.bannerUntil&&s.clock>s.bannerUntil){ctx.banner('');s.bannerUntil=0;}
    if(!g.over){
      const inputs={p0:g.players[0].state==='alive'?this.humanInput(ctx):{}};
      for(const b of s.bots)inputs[b.id]=botInput(g,b,dt,s.rng);
      stepGame(g,inputs,dt);
      for(const e of g.events){
        if(e.type==='phase'&&e.phase==='seek'){ctx.banner('開始尋找！');s.bannerUntil=s.clock+1.2;}
        if(e.type==='caught'){s.note=(e.id==='p0'?'你被抓到了，進入觀戰':g.players.find(p=>p.id===e.id).name+' 被抓到了');s.noteUntil=s.clock+2.5;}
      }
    }
    const me=g.players[0],left=aliveHiders(g).length;
    const label=(me.role==='seeker'?'尋找者':'躲藏者')+'・'+(g.phase==='hide'?'躲藏中 '+Math.max(0,Math.ceil(RULES.hideSecs-g.t)):'剩 '+left+' 人')+(me.state==='caught'?'・觀戰':'')+(me.inCover?'・隱蔽':'');
    if(label!==s.lastExtra){s.lastExtra=label;ctx.setExtra(label);}
    if(g.over)ctx.end();
  },
  render(ctx){
    const s=this.state,g=ctx.g,G=s.game,me=G.players[0];
    s.view=makeView(ctx,HUD_TOP,s.mode,me);const v=s.view,now=performance.now();
    drawBoard(g,ctx,v);
    // 尋找者視角：看不到的躲藏者不畫；其他情況全畫
    const seekerView=me.role==='seeker'&&me.state==='alive',spectating=me.state==='caught';
    const ents=[],dots=[];
    for(const p of G.players){
      if(seekerView&&p.role==='hider'&&(p.state!=='alive'||!canSee(me,p)))continue;
      if(p.state==='caught'&&!spectating&&me.role!=='seeker')continue;
      dots.push({x:p.x,y:p.y,color:p.id==='p0'?'#ffd24a':(p.role==='seeker'?'#d9534f':p.color),me:p.id==='p0'});
      ents.push({depth:p.y,draw:()=>drawPerson(g,v,p,{me:p.id==='p0',ghost:p.state==='caught',faded:p.role==='hider'&&p.inCover&&p.id!=='p0'&&!spectating,now})});
    }
    drawSorted(g,ctx,v,ents);
    if(seekerView)drawFog(g,ctx,v,me,RULES.vision,HUD_TOP);
    if(me.role==='seeker'&&G.phase==='hide'){g.fillStyle='rgba(24,46,84,.93)';g.fillRect(0,HUD_TOP,ctx.width,ctx.height-HUD_TOP);g.fillStyle='#fff';g.font='900 28px sans-serif';g.textAlign='center';g.fillText('閉眼中… '+Math.max(0,Math.ceil(RULES.hideSecs-G.t))+' 秒',ctx.width/2,ctx.height/2);}
    drawMinimap(g,ctx,v,HUD_TOP,me.role==='seeker'&&G.phase==='hide'?dots.filter(d=>d.me):dots);
    // 全圖／跟隨切換鍵
    const bw=64,bh=30,bx=10,by=HUD_TOP+8;s.modeBtn={x:bx,y:by,w:bw,h:bh};
    g.fillStyle='#fff';g.fillRect(bx,by,bw,bh);g.strokeStyle='#182e54';g.lineWidth=2;g.strokeRect(bx,by,bw,bh);g.fillStyle='#182e54';g.font='700 13px sans-serif';g.textAlign='center';g.fillText(s.mode==='full'?'跟隨':'全圖',bx+bw/2,by+20);
    // 抓捕鍵（尋找者）與搖桿
    s.catchBox=null;
    if(me.role==='seeker'&&me.state==='alive'&&G.phase==='seek'){
      const bx2=ctx.width-BTN_R-16,by2=ctx.height-BTN_R-16;s.catchBox={x:bx2,y:by2};
      const near=aliveHiders(G).some(h=>dist(me,h)<=RULES.catchRange);
      g.fillStyle=near?'#d9534f':'#c9d2e0';g.beginPath();g.arc(bx2,by2,BTN_R,0,Math.PI*2);g.fill();g.strokeStyle='#182e54';g.lineWidth=3;g.stroke();
      g.fillStyle=near?'#fff':'#182e54';g.font='900 18px sans-serif';g.textAlign='center';g.fillText('抓！',bx2,by2+6);
    }
    if(s.joy){g.strokeStyle='rgba(24,46,84,.5)';g.lineWidth=3;g.beginPath();g.arc(s.joy.ox,s.joy.oy,JOY_R,0,Math.PI*2);g.stroke();
      const jx=s.joy.x-s.joy.ox,jy=s.joy.y-s.joy.oy,l=Math.min(Math.hypot(jx,jy),JOY_R)/(Math.hypot(jx,jy)||1);g.fillStyle='rgba(24,46,84,.6)';g.beginPath();g.arc(s.joy.ox+jx*l,s.joy.oy+jy*l,20,0,Math.PI*2);g.fill();}
    // 觀戰、提示
    s.spectBtn=null;
    if(spectating&&!G.over){const w=130,h=38,x=ctx.width-w-12,y=ctx.height-h-12;s.spectBtn={x,y,w,h};g.fillStyle='#ffd24a';g.fillRect(x,y,w,h);g.strokeStyle='#182e54';g.lineWidth=2;g.strokeRect(x,y,w,h);g.fillStyle='#182e54';g.font='700 14px sans-serif';g.textAlign='center';g.fillText('跳到結算',x+w/2,y+24);
      g.font='900 18px sans-serif';g.fillText('觀戰中',ctx.width/2,HUD_TOP+24);}
    if(s.note&&s.clock<(s.noteUntil||0)){g.fillStyle='#c0392b';g.font='900 18px sans-serif';g.textAlign='center';g.fillText(s.note,ctx.width/2,HUD_TOP+(spectating?48:24));}
    if(s.clock<6&&!s.joy){g.fillStyle='#182e54';g.font='700 13px sans-serif';g.textAlign='center';g.fillText(me.role==='seeker'?'WASD／方向鍵移動；靠近後按空白鍵或「抓！」；M 切換全圖':'WASD／方向鍵移動；躲進綠色區域，別被看到；M 切換全圖',ctx.width/2,ctx.height-14);}
  },
  result(ctx){
    const s=this.state,G=s.game,me=G.players[0];
    const win=(me.role==='seeker')===(G.winner==='seeker');
    const lines=[(win?'獲勝！':'敗北')+'　你是'+(me.role==='seeker'?'尋找者':'躲藏者')+'，'+(G.winner==='seeker'?'全員被抓到':'有人撐到時間結束'),'抓到 '+G.players.filter(p=>p.role==='hider'&&p.state==='caught').length+' / '+G.players.filter(p=>p.role==='hider').length+' 位躲藏者','單機：同房 '+PLAYERS+' 人（含 '+(PLAYERS-1)+' 個機器人）'];
    return {score:scoreFor(G,'p0'),lines};
  },
  destroy(){this.state=null;}
};

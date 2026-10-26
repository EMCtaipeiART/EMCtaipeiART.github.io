// 辦公室躲貓貓（連線版）：位置、抓捕、勝負全由伺服器算。這裡只做三件事——
// 送出輸入、預測自己的移動（和伺服器同一份 movePlayer，收到快照就校正並重播未確認的輸入）、內插別人的位置。
import {MAP,RULES,movePlayer} from './hideseek-sim.js';
import {fitView,drawBoard,drawPerson} from './hideseek-draw.js';
import {hideSeekSession} from '../core/net.js';

const HUD_TOP=56,JOY_R=54,BTN_R=40,STEP=1/30,INTERP_MS=110;
const lerp=(a,b,t)=>a+(b-a)*t;

export const hideseekOnline={
  id:'hideseek-online',title:'躲貓貓（連線）',duration:3600,timer:'external',countdown:0,canPause:false,noRecord:true,noAgain:true,
  start(ctx){
    const S=hideSeekSession,info=S.info;
    const meta=Object.fromEntries(info.players.map(p=>[p.id,p]));
    this.state={S,info,meta,role:info.role,you:info.you,ents:new Map(),me:{x:0,y:0,dir:1,role:info.role,alive:true,cover:false,ready:false},
      pending:[],seq:0,acc:0,phase:'hide',time:0,left:0,caught:new Set(),view:{s:1,ox:0,oy:0},joy:null,btn:false,wasCatch:false,
      clock:0,bannerUntil:0,note:'',noteUntil:0,netNote:'',over:null,voided:null,catchBox:null,lastExtra:''};
    ctx.banner(info.role==='seeker'?'你是尋找者':'你是躲藏者');this.state.bannerUntil=2;
    this.fit(ctx);
    S.handler=m=>this.onNet(ctx,m);
    S.onNetState=(st,i)=>{const s=this.state;if(!s)return;s.netNote=st==='reconnecting'?'連線中斷，重新連線中…':'';if(st==='closed'&&!s.over){s.voided='與伺服器的連線已中斷';ctx.end();}};
    ctx.input.on('down',p=>{
      const s=this.state;if(!s)return;
      if(s.catchBox&&Math.hypot(p.x-s.catchBox.x,p.y-s.catchBox.y)<=BTN_R+10){s.btn=true;return;}
      if(p.x<ctx.width*.6&&!s.joy)s.joy={id:p.id,ox:p.x,oy:p.y,x:p.x,y:p.y};
    });
    ctx.input.on('move',p=>{const j=this.state&&this.state.joy;if(j&&j.id===p.id){j.x=p.x;j.y=p.y;}});
    ctx.input.on('up',p=>{const s=this.state;if(s&&s.joy&&s.joy.id===p.id)s.joy=null;});
  },
  resize(ctx){this.fit(ctx);},
  fit(ctx){const s=this.state;if(s)s.view=fitView(ctx,HUD_TOP);},
  canMove(){const s=this.state;return s.me.ready&&s.me.alive&&!(s.role==='seeker'&&s.phase==='hide');},
  // ───────── 伺服器訊息 ─────────
  onNet(ctx,m){
    const s=this.state;if(!s)return;
    if(m.t==='snap')this.onSnap(ctx,m);
    else if(m.t==='over'){s.over=m;ctx.end();}
    else if(m.t==='void'){s.voided=m.reason==='seeker-left'?'尋找者離線，本局作廢':'本局作廢';ctx.end();}
  },
  onSnap(ctx,m){
    const s=this.state,now=performance.now(),seen=new Set();
    s.phase=m.phase;s.time=m.time;s.left=m.left;s.caught=new Set(m.c);
    for(const e of m.p){
      const [id,x,y,dir,flags]=e;seen.add(id);
      if(id===s.you){
        const me=s.me;me.alive=!(flags&1);me.cover=!!(flags&2);
        me.x=x;me.y=y;if(!me.ready){me.ready=true;me.dir=dir;}
        s.pending=s.pending.filter(p=>p.seq>m.ack);
        if(this.canMove())for(const p of s.pending)movePlayer({map:MAP},me,p.dx,p.dy,STEP);// 重播還沒被伺服器確認的輸入
      }else{
        let ent=s.ents.get(id);if(!ent){ent={buf:[]};s.ents.set(id,ent);}
        ent.buf.push({t:now,x,y,dir,flags});if(ent.buf.length>4)ent.buf.shift();
      }
    }
    for(const id of [...s.ents.keys()])if(!seen.has(id))s.ents.delete(id);// 看不到了（尋找者視角）
    for(const ev of m.ev||[]){
      if(ev.t==='phase'&&ev.phase==='seek'){ctx.banner('開始尋找！');s.bannerUntil=s.clock+1.2;}
      if(ev.t==='caught'){const nm=(s.meta[ev.id]||{}).name||'?';s.note=ev.id===s.you?'你被抓到了，進入觀戰':nm+(ev.left?' 離開了':' 被抓到了');s.noteUntil=s.clock+2.5;}
    }
  },
  // ───────── 輸入 ─────────
  readInput(ctx){
    const s=this.state,a=ctx.input.axis();let dx=a.x,dy=a.y;
    if(s.joy){const jx=s.joy.x-s.joy.ox,jy=s.joy.y-s.joy.oy,l=Math.hypot(jx,jy);if(l>8){const k=Math.min(l,JOY_R)/JOY_R/l;dx=jx*k;dy=jy*k;}}
    const down=ctx.input.isDown('Space')||ctx.input.isDown('KeyE'),edge=(down&&!s.wasCatch)||s.btn;
    s.wasCatch=down;s.btn=false;
    return {dx,dy,catch:edge};
  },
  update(ctx,dt){
    const s=this.state;s.clock+=dt;
    if(s.joy&&ctx.input.pointers.size===0)s.joy=null;
    if(s.bannerUntil&&s.clock>s.bannerUntil){ctx.banner('');s.bannerUntil=0;}
    s.acc+=dt;
    while(s.acc>=STEP){
      s.acc-=STEP;
      if(!s.me.ready||!s.me.alive)continue;
      const inp=this.readInput(ctx);s.seq++;
      s.S.send({t:'in',seq:s.seq,dx:+inp.dx.toFixed(3),dy:+inp.dy.toFixed(3),catch:inp.catch});
      s.pending.push({seq:s.seq,dx:inp.dx,dy:inp.dy});if(s.pending.length>60)s.pending.shift();
      if(this.canMove())movePlayer({map:MAP},s.me,inp.dx,inp.dy,STEP);// 先預測，等快照校正
    }
    ctx.setTime(Math.max(0,s.info.totalSecs-s.time));
    const label=(s.role==='seeker'?'尋找者':'躲藏者')+'・'+(s.phase==='hide'?'躲藏中 '+Math.max(0,Math.ceil(s.info.hideSecs-s.time)):'剩 '+s.left+' 人')+(!s.me.alive?'・觀戰':'')+(s.me.cover?'・隱蔽':'');
    if(label!==s.lastExtra){s.lastExtra=label;ctx.setExtra(label);}
  },
  // 別人的位置：用最近兩筆快照內插（刻意晚 110ms，畫面才順）
  posOf(ent,now){
    const b=ent.buf;if(!b.length)return null;
    const t=now-INTERP_MS;let i=b.length-1;while(i>0&&b[i-1].t>t)i--;
    const a=b[Math.max(0,i-1)],c=b[i];
    if(c.t<=t||a===c)return {x:c.x,y:c.y,dir:c.dir,flags:c.flags};
    const k=Math.max(0,Math.min(1,(t-a.t)/(c.t-a.t)));
    return {x:lerp(a.x,c.x,k),y:lerp(a.y,c.y,k),dir:c.dir,flags:c.flags};
  },
  render(ctx){
    const s=this.state,g=ctx.g,v=s.view,now=performance.now(),me=s.me;
    drawBoard(g,ctx,v);
    const list=[];
    if(me.ready)list.push({id:s.you,x:me.x,y:me.y,self:true,flags:me.alive?0:1,role:s.role});
    for(const [id,ent] of s.ents){const p=this.posOf(ent,now);if(p)list.push({id,x:p.x,y:p.y,flags:p.flags,role:p.flags&4?'seeker':'hider'});}
    list.sort((a,b)=>a.y-b.y);
    for(const p of list){const mt=s.meta[p.id]||{name:'?',color:'#888'};drawPerson(g,v,{x:p.x,y:p.y,color:mt.color,name:mt.name,role:p.role},{me:p.self,ghost:!!(p.flags&1)});}
    const X=x=>v.ox+x*v.s,Y=y=>v.oy+y*v.s;
    const blind=s.role==='seeker'&&me.alive;
    if(blind&&me.ready){g.strokeStyle='rgba(217,83,79,.35)';g.lineWidth=2;g.setLineDash([4,6]);g.beginPath();g.arc(X(me.x),Y(me.y),RULES.vision*v.s,0,Math.PI*2);g.stroke();g.setLineDash([]);}
    if(s.role==='seeker'&&s.phase==='hide'){g.fillStyle='rgba(24,46,84,.93)';g.fillRect(0,HUD_TOP,ctx.width,ctx.height-HUD_TOP);g.fillStyle='#fff';g.font='900 28px sans-serif';g.textAlign='center';g.fillText('閉眼中… '+Math.max(0,Math.ceil(s.info.hideSecs-s.time))+' 秒',ctx.width/2,ctx.height/2);}
    s.catchBox=null;
    if(s.role==='seeker'&&me.alive&&s.phase==='seek'){
      const bx=ctx.width-BTN_R-16,by=ctx.height-BTN_R-16;s.catchBox={x:bx,y:by};
      g.fillStyle='#d9534f';g.beginPath();g.arc(bx,by,BTN_R,0,Math.PI*2);g.fill();g.strokeStyle='#182e54';g.lineWidth=3;g.stroke();
      g.fillStyle='#fff';g.font='900 18px sans-serif';g.textAlign='center';g.fillText('抓！',bx,by+6);
    }
    if(s.joy){g.strokeStyle='rgba(24,46,84,.5)';g.lineWidth=3;g.beginPath();g.arc(s.joy.ox,s.joy.oy,JOY_R,0,Math.PI*2);g.stroke();
      const jx=s.joy.x-s.joy.ox,jy=s.joy.y-s.joy.oy,l=Math.min(Math.hypot(jx,jy),JOY_R)/(Math.hypot(jx,jy)||1);g.fillStyle='rgba(24,46,84,.6)';g.beginPath();g.arc(s.joy.ox+jx*l,s.joy.oy+jy*l,20,0,Math.PI*2);g.fill();}
    g.textAlign='center';
    if(!me.alive){g.fillStyle='#182e54';g.font='900 18px sans-serif';g.fillText('觀戰中',ctx.width/2,HUD_TOP+24);}
    if(s.note&&s.clock<s.noteUntil){g.fillStyle='#c0392b';g.font='900 18px sans-serif';g.fillText(s.note,ctx.width/2,HUD_TOP+(me.alive?24:48));}
    if(s.netNote){g.fillStyle='rgba(192,57,43,.95)';g.fillRect(0,HUD_TOP,ctx.width,28);g.fillStyle='#fff';g.font='700 14px sans-serif';g.fillText(s.netNote,ctx.width/2,HUD_TOP+19);}
    if(s.clock<6&&!s.joy){g.fillStyle='#182e54';g.font='700 13px sans-serif';g.fillText(s.role==='seeker'?'WASD／方向鍵移動；靠近後按空白鍵或「抓！」':'WASD／方向鍵移動；躲進綠色區域，別被看到',ctx.width/2,ctx.height-14);}
  },
  result(ctx){
    const s=this.state;
    if(s.voided||!s.over)return {score:0,lines:[s.voided||'連線結束，沒有結算']};
    const o=s.over,win=(s.role==='seeker')===(o.winner==='seeker');
    const rows=Object.entries(o.scores).map(([id,sc])=>(s.meta[id]||{name:id}).name+(o.roles[id]==='seeker'?'（尋找者）':'')+' '+sc+' 分');
    return {score:o.scores[s.you]??0,lines:[(win?'獲勝！':'敗北')+'　你是'+(s.role==='seeker'?'尋找者':'躲藏者')+'，'+(o.winner==='seeker'?'全員被抓到':'有人撐到時間結束'),...rows,'連線對戰不計入個人紀錄']};
  },
  destroy(){const S=hideSeekSession;S.handler=null;S.onNetState=null;this.state=null;}
};

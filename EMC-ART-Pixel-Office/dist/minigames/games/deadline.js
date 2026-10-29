// 截稿倒數：90 秒內盡量多完成設計小挑戰。題組由每日種子決定，同一天大家題目相同，方便排名。
import {createDeck,pointsForCorrect,WRONG_PENALTY,TYPES} from './deadline-challenges.js';

const HUD_TOP=60,PROMPT_H=64;

function wrap(g,text,maxW){
  const lines=[];let line='';
  for(const ch of text){const t=line+ch;if(g.measureText(t).width>maxW&&line){lines.push(line);line=ch;}else line=t;}
  if(line)lines.push(line);return lines;
}

export const deadlineGame={
  id:'deadline',title:'截稿倒數',icon:'clock',blurb:'90 秒完成色彩、圖形、排版、改稿挑戰',medals:[2000,4500,7000],
  howto:{goal:'90 秒內盡量完成設計挑戰。答對 +100，答錯 −20，連續答對有連擊加分。',pc:'用滑鼠點選答案，或按數字鍵 1–9。',touch:'用手指點選答案。',tips:['改稿題：只改客戶要求的地方，其他都不能動','每 5 題難度升一級','答錯也會換下一題，不要亂點']},duration:90,ranked:true,
  start(ctx){
    this.state={
      deck:createDeck(ctx.rngFor('deck')),idx:0,combo:0,bestCombo:0,correct:0,wrong:0,
      byType:Object.fromEntries(TYPES.map(t=>[t.id,{ok:0,bad:0}])),flash:null,clock:0,keys:new Set(),log:[]
    };
    ctx.setExtra('第 1 題');
    ctx.input.on('down',p=>this.press(ctx,p));
  },
  box(ctx){return {x:12,y:HUD_TOP+PROMPT_H,w:ctx.width-24,h:Math.max(80,ctx.height-HUD_TOP-PROMPT_H-12)};},
  press(ctx,p){
    const s=this.state;if(!s||ctx.timeLeft<=0)return;
    const cur=s.deck.get(s.idx),hit=cur.type.regions(cur.puzzle,this.box(ctx)).find(r=>p.x>=r.x&&p.x<=r.x+r.w&&p.y>=r.y&&p.y<=r.y+r.h);
    if(hit)this.answer(ctx,hit.id);
  },
  answer(ctx,id){
    const s=this.state;
    /* 兩次作答至少隔 0.125 秒（第一題 0.31 秒，剛好略高於伺服器下限 0.12／0.3）：伺服器驗證的下限是 0.12／0.3 秒；雙擊、觸控連發本來就不該算成兩題，
       否則整局成績會因為 too-fast 被拒絕、只存在本機 */
    if((s.log.length===0?s.clock:s.clock-s.lastT)<(s.log.length===0?.31:.125))return;
    s.lastT=s.clock;
    const cur=s.deck.get(s.idx),ok=cur.type.isCorrect(cur.puzzle,id),stat=s.byType[cur.type.id];
    if(ok){s.combo++;s.correct++;stat.ok++;s.bestCombo=Math.max(s.bestCombo,s.combo);const pts=pointsForCorrect(s.combo);ctx.addScore(pts);s.flash={t:s.clock,ok:true,text:'+'+pts+(s.combo>1?'  連擊 x'+s.combo:'')};}
    else{s.combo=0;s.wrong++;stat.bad++;ctx.addScore(-WRONG_PENALTY);s.flash={t:s.clock,ok:false,text:'-'+WRONG_PENALTY};}
    s.log.push({i:s.idx,a:id,ok,t:+s.clock.toFixed(3)});
    s.idx++;ctx.setExtra('第 '+(s.idx+1)+' 題'+(s.combo>1?'  連擊 x'+s.combo:''));
  },
  update(ctx,dt){
    const s=this.state;s.clock+=dt;
    // 數字鍵 1–9 選第幾個選項（只在選項不超過 9 個的題型有效）
    const cur=s.deck.get(s.idx),regions=cur.type.regions(cur.puzzle,this.box(ctx));
    if(regions.length<=9)for(let i=0;i<regions.length;i++){
      const down=ctx.input.isDown('Digit'+(i+1))||ctx.input.isDown('Numpad'+(i+1)),was=s.keys.has(i);
      if(down&&!was){s.keys.add(i);if(ctx.timeLeft>0)this.answer(ctx,regions[i].id);return;}
      if(!down)s.keys.delete(i);
    }
  },
  render(ctx){
    const s=this.state,g=ctx.g;g.imageSmoothingEnabled=false;
    g.fillStyle='rgba(238,243,251,.97)';g.fillRect(0,0,ctx.width,ctx.height);
    g.strokeStyle='rgba(24,46,84,.07)';g.lineWidth=1;
    for(let x=0;x<ctx.width;x+=32){g.beginPath();g.moveTo(x+.5,0);g.lineTo(x+.5,ctx.height);g.stroke();}
    for(let y=0;y<ctx.height;y+=32){g.beginPath();g.moveTo(0,y+.5);g.lineTo(ctx.width,y+.5);g.stroke();}
    const cur=s.deck.get(s.idx),box=this.box(ctx);
    g.fillStyle='#182e54';g.font='900 18px sans-serif';g.textAlign='center';
    const lines=wrap(g,cur.type.prompt(cur.puzzle),ctx.width-40);
    lines.slice(0,2).forEach((l,i)=>g.fillText(l,ctx.width/2,HUD_TOP+22+i*24));
    g.font='700 12px sans-serif';g.fillStyle='#6f7c92';g.fillText(cur.type.title+'　Lv.'+cur.level,ctx.width/2,HUD_TOP+PROMPT_H-6);
    cur.type.draw(g,cur.puzzle,box);
    if(s.flash){
      const age=s.clock-s.flash.t;
      if(age<.6){
        g.globalAlpha=1-age/.6;g.strokeStyle=s.flash.ok?'#4caf6a':'#d9534f';g.lineWidth=8;g.strokeRect(4,4,ctx.width-8,ctx.height-8);
        g.fillStyle=s.flash.ok?'#0f7f27':'#c0392b';g.font='900 26px sans-serif';g.fillText(s.flash.text,ctx.width/2,HUD_TOP+PROMPT_H+30-age*30);g.globalAlpha=1;
      }
    }
  },
  /** 正式排行用的作答紀錄：伺服器用同一份題組逐題重算分數（客戶端宣稱的分數無效）。 */
  log(){return {answers:this.state.log.map(({i,a,t})=>({i,a,t}))};},
  result(ctx){
    const s=this.state,n=s.correct+s.wrong,acc=n?Math.round(s.correct/n*100):0;
    const per=TYPES.map(t=>t.title+' '+s.byType[t.id].ok+'/'+(s.byType[t.id].ok+s.byType[t.id].bad)).join('　');
    return {lines:['完成 '+n+' 題，答對 '+s.correct+' 題（'+acc+'%）','最高連擊 '+s.bestCombo,per,'題組日期 '+ctx.day+'（同日題目相同）']};
  },
  destroy(){this.state=null;}
};

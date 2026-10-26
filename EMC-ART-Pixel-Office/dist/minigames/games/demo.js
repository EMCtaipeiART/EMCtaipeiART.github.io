// Phase 1 驗證用小遊戲：點擊出現的圓點得分。用來驗證生命週期、輸入、暫停、結算與清理；之後由正式遊戲取代入口。
export const demoGame={
  id:'demo',title:'點點測試',duration:20,
  start(ctx){
    this.state={targets:[],spawn:0,hits:0,misses:0};
    ctx.input.on('down',p=>{
      const s=this.state,i=s.targets.findIndex(t=>Math.hypot(t.x-p.x,t.y-p.y)<=t.r);
      if(i>=0){s.targets.splice(i,1);s.hits++;ctx.addScore(100);}else if(ctx.timeLeft>0){s.misses++;}
    });
  },
  update(ctx,dt){
    const s=this.state;s.spawn-=dt;
    if(s.spawn<=0&&s.targets.length<4){s.spawn=0.6;const r=ctx.rng.int(18,30);s.targets.push({x:ctx.rng.int(r,Math.max(r,ctx.width-r)),y:ctx.rng.int(60+r,Math.max(60+r,ctx.height-r)),r,life:2.5});}
    s.targets.forEach(t=>t.life-=dt);s.targets=s.targets.filter(t=>t.life>0);
  },
  render(ctx){
    const g=ctx.g;g.fillStyle='rgba(255,255,255,.55)';g.fillRect(0,0,ctx.width,ctx.height);
    for(const t of this.state.targets){g.fillStyle='#182e54';g.fillRect(Math.round(t.x-t.r),Math.round(t.y-t.r),t.r*2,t.r*2);g.fillStyle='#ffd24a';g.fillRect(Math.round(t.x-t.r+4),Math.round(t.y-t.r+4),t.r*2-8,t.r*2-8);}
  },
  result(ctx){return {lines:['命中 '+this.state.hits+' 次，落空 '+this.state.misses+' 次']};},
  destroy(){this.state=null;}
};

// 固定時間步長：畫面幀率不同（60／120Hz）時，遊戲邏輯仍以 step 秒推進。
export function createFixedLoop({step=1/60,update,render,raf=cb=>requestAnimationFrame(cb),caf=id=>cancelAnimationFrame(id),maxSteps=5}){
  let id=0,last=0,acc=0,running=false;
  const frame=now=>{
    if(!running)return;
    const dt=Math.min((now-last)/1000,step*maxSteps);last=now;acc+=dt;
    let n=0;while(acc>=step&&n<maxSteps){update(step);acc-=step;n++;}
    if(n===maxSteps)acc=0;// 卡頓太久就放棄補算，避免螺旋式追趕
    render(acc/step);
    if(running)id=raf(frame);
  };
  return {
    start(){if(running)return;running=true;last=0;acc=0;id=raf(t=>{last=t;id=raf(frame);});},
    stop(){running=false;if(id)caf(id);id=0;},
    get running(){return running;}
  };
}

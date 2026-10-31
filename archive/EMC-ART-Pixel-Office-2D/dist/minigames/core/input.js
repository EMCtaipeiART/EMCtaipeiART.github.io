// 統一輸入：滑鼠、觸控、鍵盤都走 Pointer／Keyboard 事件，座標一律換成遊戲畫布的 CSS 像素。
// 所有監聽都掛在同一個 AbortSignal 上，遊戲結束時一次移除。
export function createInput(target,signal,{onKey}={}){
  const pointers=new Map(),keys=new Set(),handlers={down:[],move:[],up:[]};
  const local=e=>{const r=target.getBoundingClientRect();return {x:e.clientX-r.left,y:e.clientY-r.top,id:e.pointerId,type:e.pointerType};};
  const fire=(name,p)=>handlers[name].forEach(fn=>fn(p));
  const opts={signal,passive:false};
  target.addEventListener('pointerdown',e=>{e.preventDefault();try{target.setPointerCapture(e.pointerId);}catch{}const p=local(e);pointers.set(p.id,p);fire('down',p);},opts);
  target.addEventListener('pointermove',e=>{const p=local(e);if(pointers.has(p.id))pointers.set(p.id,p);fire('move',p);},opts);
  const up=e=>{const p=local(e);pointers.delete(p.id);fire('up',p);};
  target.addEventListener('pointerup',up,opts);
  target.addEventListener('pointercancel',up,opts);
  target.addEventListener('contextmenu',e=>e.preventDefault(),opts);
  window.addEventListener('keydown',e=>{if(e.repeat&&keys.has(e.code))return;keys.add(e.code);if(onKey)onKey(e);},{signal,capture:true});
  window.addEventListener('keyup',e=>keys.delete(e.code),{signal,capture:true});
  window.addEventListener('blur',()=>{keys.clear();pointers.clear();},{signal});
  return {
    on(name,fn){handlers[name].push(fn);},
    isDown:code=>keys.has(code),
    /** 方向向量（WASD／方向鍵），長度最多 1 */
    axis(){
      const x=(keys.has('ArrowRight')||keys.has('KeyD')?1:0)-(keys.has('ArrowLeft')||keys.has('KeyA')?1:0);
      const y=(keys.has('ArrowDown')||keys.has('KeyS')?1:0)-(keys.has('ArrowUp')||keys.has('KeyW')?1:0);
      const l=Math.hypot(x,y)||1;return {x:x/l,y:y/l};
    },
    pointers,
    clear(){keys.clear();pointers.clear();}
  };
}

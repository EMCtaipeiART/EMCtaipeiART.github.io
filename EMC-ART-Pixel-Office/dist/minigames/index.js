// 小遊戲啟動點：把 manager 接到像素辦公室（透過 app.js 暴露的 window.__pixelOffice 橋接）。
import {createMiniGameManager} from './core/manager.js';
import {createUI} from './core/ui.js';
import {createScoreStore} from './core/score.js';
import {demoGame} from './games/demo.js';
import {treasureGame} from './games/treasure.js';
import {hoopsGame} from './games/hoops.js';
import {deadlineGame} from './games/deadline.js';
import {hideseekGame} from './games/hideseek.js';

const office=window.__pixelOffice;
if(office){
  const bridge={
    canvasEl:office.game,
    rect:()=>office.game.getBoundingClientRect(),
    releaseKeys:()=>office.keys.clear(),
    markDirty:()=>office.markDirty(),
    clientToScene:(cx,cy)=>office.toScene(cx,cy,office.game.getBoundingClientRect()),
    sceneToClient(x,y){
      const r=office.game.getBoundingClientRect(),c=office.cam,sc=office.scene();
      return c.on?{x:r.left+(x-c.left)*c.s,y:r.top+(y-c.top)*c.s}:{x:r.left+x*r.width/sc.W,y:r.top+(y+sc.OY)*r.height/sc.H};
    },
    pxPerScene(){const r=office.game.getBoundingClientRect(),c=office.cam;return c.on?c.s:r.width/office.scene().W;},
    scene:office.scene,blocked:office.blocked,
    get walls(){return office.walls();},get stations(){return office.stations;}
  };
  const manager=createMiniGameManager({ui:createUI(),store:createScoreStore(),bridge});
  manager.register(demoGame);manager.register(treasureGame);manager.register(hoopsGame);manager.register(deadlineGame);manager.register(hideseekGame);
  window.miniGames=manager;
  // 入口：點「小遊戲」展開選單（測試用的點點遊戲不列出）
  const btn=document.getElementById('miniGamesBtn');
  if(btn){
    const menu=document.createElement('div');menu.className='mg-menu';menu.hidden=true;btn.after(menu);
    const render=()=>{menu.innerHTML='';for(const g of manager.list().filter(g=>g.id!=='demo')){const b=document.createElement('button');b.type='button';b.className='mg-btn';const best=createScoreStore().get(g.id).best;b.textContent=g.title+(best?'（最佳 '+best+'）':'');b.onclick=()=>{menu.hidden=true;manager.open(g.id);};menu.appendChild(b);}};
    btn.addEventListener('click',()=>{if(menu.hidden){render();const r=btn.getBoundingClientRect();menu.style.top=(r.bottom+6)+'px';menu.style.right=Math.max(8,innerWidth-r.right)+'px';}menu.hidden=!menu.hidden;});
    document.addEventListener('pointerdown',e=>{if(!menu.hidden&&!menu.contains(e.target)&&e.target!==btn)menu.hidden=true;});
  }
}

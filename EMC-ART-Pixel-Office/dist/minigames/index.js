// 小遊戲啟動點：把 manager 接到像素辦公室（透過 app.js 暴露的 window.__pixelOffice 橋接）。
import {createMiniGameManager} from './core/manager.js';
import {createUI} from './core/ui.js';
import {createScoreStore} from './core/score.js';
import {demoGame} from './games/demo.js';

const office=window.__pixelOffice;
if(office){
  const bridge={
    canvasEl:office.game,
    rect:()=>office.game.getBoundingClientRect(),
    releaseKeys:()=>office.keys.clear(),
    markDirty:()=>office.markDirty(),
    toScene:office.toScene,blocked:office.blocked,
    get walls(){return office.walls();},get stations(){return office.stations;}
  };
  const manager=createMiniGameManager({ui:createUI(),store:createScoreStore(),bridge});
  manager.register(demoGame);
  window.miniGames=manager;
  const btn=document.getElementById('miniGamesBtn');
  if(btn)btn.addEventListener('click',()=>manager.open('demo'));
}

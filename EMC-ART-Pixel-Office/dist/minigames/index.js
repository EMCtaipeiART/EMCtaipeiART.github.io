// 小遊戲啟動點：把 manager 接到像素辦公室（透過 app.js 暴露的 window.__pixelOffice 橋接）。
import {createMiniGameManager} from './core/manager.js?v=2';
import {createUI} from './core/ui.js';
import {createScoreStore} from './core/score.js';
import {demoGame} from './games/demo.js';
import {treasureGame} from './games/treasure.js?v=2';
import {hoopsGame} from './games/hoops.js';
import {deadlineGame} from './games/deadline.js?v=3';
import {hideseekGame} from './games/hideseek.js';
import {hideseekOnline} from './games/hideseek-online.js';
import {createLobby} from './core/lobby.js';
import {createBoardClient} from './core/board.js?v=2';
import {createMenu} from './core/menu.js?v=2';

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
    scene:office.scene,
    // 場景座標＝畫面座標（會被縱向壓縮），app 的 blocked 吃的是邏輯座標：這裡換好，遊戲一律用場景座標
    blocked:(x,y)=>office.blocked(x,office.viewToLogical(y)),
    get walls(){return office.walls();},get stations(){return office.stations;}
  };
  // 暱稱：匿名、只用來顯示在排行榜（榜上是「暱稱#裝置碼後四碼」），和大廳共用同一個設定
  const NAME_KEY='emc-mg-name',acct=()=>String((office.viewerName&&office.viewerName())||'').trim().slice(0,12),/* 有登入帳號就直接用帳號名字，不用再輸入暱稱 */
  getNick=()=>acct()||(()=>{try{return(localStorage.getItem(NAME_KEY)||'').trim().slice(0,12);}catch{return '';}})();
  const boardClient=createBoardClient({getToken:()=>(office.viewerToken&&office.viewerToken())||''});
  const manager=createMiniGameManager({ui:createUI(),store:createScoreStore(),bridge,board:boardClient,nickname:getNick});
  manager.register(demoGame);manager.register(treasureGame);manager.register(hoopsGame);manager.register(deadlineGame);manager.register(hideseekGame);manager.register(hideseekOnline);const lobby=createLobby({manager});window.hideSeekLobby=lobby;
  window.miniGames=manager;
  // 入口：點「小遊戲」開啟卡片式選單（測試用的點點遊戲不列出）
  const store=createScoreStore();
  const menu=createMenu({manager,store,board:boardClient,getNick,setNick:v=>{try{localStorage.setItem(NAME_KEY,v);}catch{/* 儲存不可用 */}},
    loggedIn:()=>Boolean(acct()),isAdmin:()=>Boolean(office.isMonitor&&office.isMonitor()),
    onPick:id=>{if(id==='vent-arena'){if(window.parent!==window)window.parent.postMessage({type:'pixelOfficeOpenArena'},location.origin);else window.open('../../vent-arena/','_blank','noopener');}else if(id==='hideseek-online')lobby.show();else manager.open(id);}});
  window.miniGamesMenu=menu;
  const btn=document.getElementById('miniGamesBtn');/* 入口按鈕已移到主站上方的「小遊戲」，這裡只留相容 */
  if(btn)btn.addEventListener('click',()=>menu.toggle());
}

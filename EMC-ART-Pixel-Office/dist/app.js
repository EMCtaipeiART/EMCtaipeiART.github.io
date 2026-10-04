'use strict';
const $=id=>document.getElementById(id), game=$('game'), ctx=game.getContext('2d'), W=1536,H=1024;
const names=['Leona','Amber','Noise','Anna','Machi'], descriptions=['黑髮・時髦日常','暖色・樸素自在','短髮・專注模式','長髮・粉色靈感','挑染・街頭風格'];
const starts=[[548,355],[768,355],[988,355],[768,695],[988,695]];
const fallbackScores={Machi:10832,Anna:4749.5,Amber:2905,Leona:1907,Noise:1404.5};
descriptions[2]='藍帽・夏日休閒';
// 等級稱號：平面組與影音組各一套，級距固定在 Lv.1／10／20／30／40／50（跟 levelFromScore 的門檻一致）。
// 文字存在後端、所有人共用，可以在右邊「等級一覽表」直接改（使用者 2026-09-24 要求）。
// 這裡的預設值只在還沒跟後端要到之前用，跟後端的 PIXEL_OFFICE_DEFAULT_LEVEL_TITLES 是同一份。
const LEVEL_STEPS=[1,10,20,30,40,50];
const LEVEL_GROUP_LABELS={graphic:'平面組',video:'影音組'};
let levelTitles={graphic:['設計新秀','資深設計師','設計菁英','設計大師','傳奇設計師','設計神話'],video:['影音新秀','資深剪輯師','影音菁英','影音大師','傳奇導演','影像神話']};
let levelVideoMembers=['Noise'];
const levelGroupOf=name=>levelVideoMembers.includes(name)?'video':'graphic';
let levelScores=null;
let levelStats=Object.fromEntries(names.map(name=>[name,levelFromScore(fallbackScores[name],name)]));
let levelUpdatedAt='',levelIsLive=false;
// type 是桌子素材、empty 是離席時換上的空桌。素材裡三張桌子的形狀本來就不一樣——最左邊那張有
// 左斜邊、最右邊有右斜邊、中間是矩形——所以每個座位要用對應自己位置的那一種，接起來才是平整的一條。
const stations=[{x:548,y:355,type:0,empty:6,name:'Leona'},{x:768,y:355,type:1,empty:7,name:'Amber'},{x:988,y:355,type:3,empty:8,name:'Noise'},{x:548,y:695,type:4,empty:6,name:''},{x:768,y:695,type:1,empty:7,name:'Anna'},{x:988,y:695,type:2,empty:8,name:'Machi'}];
const moods=[{id:'happy',symbol:'sun',label:'喜',text:'陽光好心情'},{id:'angry',symbol:'burst',label:'怒',text:'爆炸氣噗噗'},{id:'sad',symbol:'drop',label:'哀',text:'大水滴低落中'},{id:'joy',symbol:'heart',label:'樂',text:'愛心滿格'}];
const statuses=[{id:'present',symbol:'person',label:'在座',text:'在座工作中'},{id:'overtime',symbol:'moon',label:'加班',text:'加班中'},{id:'lunch',symbol:'bowl',label:'用餐',text:'用餐中'},{id:'meeting',symbol:'meeting',label:'會議',text:'開會中'},{id:'leave',symbol:'calendar',label:'休假',text:'休假中'},{id:'offwork',symbol:'power',label:'下班',text:'已下班'},{id:'toilet',symbol:'toilet',label:'廁所',text:'去廁所'},{id:'abroad',symbol:'plane',label:'出國',text:'出國中'},{id:'out',symbol:'briefcase',label:'公出',text:'公出工作中'}];
// 在座與加班都是「人還坐在位子上工作」（人物、椅子、電腦都要畫，也能走動）；其餘狀態才是離席（灰階空桌）。
const workingStatusIds=['present','overtime'];const isAway=p=>!workingStatusIds.includes(p.status);
const overtimePreview=new URLSearchParams(location.search).get('overtime')==='1';
// 嵌入版不能走動，畫面多數時間是完全靜止的（只有心情動畫會動），沒必要每秒重畫 60 次。
// 有變化時才畫：遠端同步、選取、框變大小都會標記一次。省下來的 CPU 讓外層系統的進站更順。
// 宣告放在最前面：resizeCanvas() 在腳本載入時就會被呼叫一次，那時就要用到 markDirty。
let needsRedraw=true;
function markDirty(){needsRedraw=true;}

// 桌上的名牌。
const PLATE_TOP=56,PLATE_NAME_H=23;
// 頭上的對話框。2026-09-24 曾經把對話改掛到名牌下面（為了解決越界），但那樣很醜，同一天改回
// 頭上的對話框，只是整個縮小並改成半透明＋柔和陰影，看起來像浮在場景上面。
// 越界改用「算得出來的空間」處理：下面的 EMBED_ROW_SQUEEZE 會依這裡的尺寸把兩排拉開到
// 對話框放得下，drawBubble() 再依實際可用高度收行數，所以上不會被切、下不會蓋到上排的名牌。
// 小框會把字放大（不然讀不到），這時行數會自己變少並用「…」收尾。
const BUBBLE_FONT=11,BUBBLE_LINE=14,BUBBLE_MAX_W=200,BUBBLE_PAD_X=12,BUBBLE_PAD_Y=7,BUBBLE_MAX_LINES=4;
const BUBBLE_TAIL=8;// 尾巴長度
const BUBBLE_HEAD_GAP=8;// 尾巴尖端離頭頂多遠
const BUBBLE_MAX_H=BUBBLE_MAX_LINES*BUBBLE_LINE+BUBBLE_PAD_Y*2+BUBBLE_TAIL;
const BUBBLE_CLEAR=8;// 下排的對話框與上排名牌之間要留的空隙

// 嵌入模式的版面：上下兩排之間空了一大段，塞進側欄的小框裡會白白浪費一半高度。把下排往上收，
// 六張桌子擠在一起之後才有空間放大。上排以上不動、之後線性壓縮，所以人物走到中間時位置是連續的，
// 不會突然跳一格。只改「畫出來的位置」，同步給大家的座標完全沒動。
// 能收多少由下排的對話框決定：它往上長，不能蓋到上排的名牌。所以兩排的距離至少要有
// 「上排名牌的最低點 + 空隙 + 對話框 + 尾巴到頭頂的距離 + 半個人（150）」。
// 以前寫死 .8，那是還沒算對話框的年代；現在直接從對話框的尺寸算回來，改尺寸不用重算。
const EMBED_ROW_TOP=355,EMBED_ROW_BOTTOM=695;
const EMBED_ROW_SQUEEZE=Math.min(1,(PLATE_TOP+PLATE_NAME_H+BUBBLE_CLEAR+BUBBLE_MAX_H+BUBBLE_HEAD_GAP+150)/(EMBED_ROW_BOTTOM-EMBED_ROW_TOP));
const viewY=y=>embedMode&&y>EMBED_ROW_TOP?EMBED_ROW_TOP+(y-EMBED_ROW_TOP)*EMBED_ROW_SQUEEZE:y;
// 畫面用的座標（嵌入模式下把下排往上收過）。資料一律用 people／stations，畫面一律用這兩個。
let viewPeople=[],viewStations=[];
// 六張桌子實際佔到的範圍（場景座標，下排收上來之後量的）：左右是桌子邊緣。嵌入模式就是把這一塊
// 等比放到框裡置中，框變成什麼比例都不會裁到或偏一邊。
// 下緣：下排名牌的最低點，跟著常數與壓縮比例走，改了不用重量一次。
// 上緣（y0）是「動」的：照上排現在真的有多少對話框去留，沒人講話就只留到頭頂。
// 本來是固定留四行的最大值，結果大家都只講一句話時上面空一大片、場景被白白縮小
// （2026-09-24 使用者回報）。y0 由 sceneTopExtent() 每次重排時算，變了就重新 fit 一次。
const EMBED_CONTENT={x0:424,x1:1112,y0:EMBED_ROW_TOP-158,y1:EMBED_ROW_TOP+(EMBED_ROW_BOTTOM-EMBED_ROW_TOP)*EMBED_ROW_SQUEEZE+PLATE_TOP+PLATE_NAME_H+8};
// 上緣的下限：頭頂（-150）再往上 8，順便包住照片卡（-151）與心情圖示（-152）的上緣。
const SCENE_TOP_MIN=EMBED_ROW_TOP-158;
const EMBED_FIT_PADDING=Math.min(1,Math.max(.4,Number(new URLSearchParams(location.search).get('pad'))||.94)); // 外層可用 ?pad= 縮小場景（預設 .94）
let fitting=false;
// 外層（多元宇宙頁的編輯模式）用 ?clean=1 開完整版：不要邊框與標題文字，並把六張桌子放大到佔滿寬度。
let cleanTop=null;
function fitCleanView(){
  const wrapEl=game.parentElement,w=wrapEl.getBoundingClientRect().width;
  if(!w)return;
  let top=EMBED_ROW_TOP-158;try{top=Math.min(top,sceneTopExtent())}catch(error){}// 上排的帽子、對話框現在畫到哪就留到哪，不然會被切掉
  cleanTop=top;
  // 手機（窄螢幕）：桌子四周要留走動的空間，搖桿也要在同一個畫面，所以放大倍率改成「整個可走動範圍剛好放進寬度」
  const narrow=document.documentElement.classList.contains('clean-narrow');
  if(narrow)top=Math.min(top,140);
  cleanTop=top;
  const x0=narrow?300:424,x1=narrow?1236:1112,y0=top,y1=EMBED_ROW_BOTTOM+PLATE_TOP+PLATE_NAME_H+8+(narrow?170:0),bw=x1-x0,bh=y1-y0;
  const fitW=w*(narrow?.98:.96)/bw,csParam=Number(new URLSearchParams(location.search).get('cs'))||0,scale=csParam&&!narrow?Math.min(csParam,fitW):fitW,cx=(x0+x1)/2;// 窄螢幕（手機）不能超過可用寬度
  wrapEl.style.height=`${Math.round(bh*scale)}px`;
  game.style.width=`${W*scale}px`;game.style.height=`${H*scale}px`;
  game.style.transform=`translate(${w/2-cx*scale}px,${-y0*scale}px)`;
  markDirty();
}
function fitEmbedView(){
  if(document.documentElement.classList.contains('clean')){fitCleanView();return;}
  if(!embedMode||fitting)return;// syncSceneTop() 會回頭呼叫這裡，擋掉遞迴
  fitting=true;
  markDirty();
  const wrap=game.parentElement.getBoundingClientRect();
  if(!wrap.width||!wrap.height){fitting=false;return;}
  const bw=EMBED_CONTENT.x1-EMBED_CONTENT.x0,bh=EMBED_CONTENT.y1-EMBED_CONTENT.y0;
  const scale=Math.min(wrap.width*EMBED_FIT_PADDING/bw,wrap.height*EMBED_FIT_PADDING/bh);
  const cx=(EMBED_CONTENT.x0+EMBED_CONTENT.x1)/2,cy=(EMBED_CONTENT.y0+EMBED_CONTENT.y1)/2;
  game.style.width=`${W*scale}px`;game.style.height=`${H*scale}px`;
  game.style.transform=`translate(${wrap.width/2-cx*scale}px,${wrap.height/2-cy*scale}px)`;
  fitting=false;
}
function syncViewLayout(){
  if(!embedMode){viewPeople=people;viewStations=stations;if(document.documentElement.classList.contains('clean')&&ready){let t=EMBED_ROW_TOP-158;try{t=Math.min(t,sceneTopExtent())}catch(error){}if(t!==cleanTop)fitCleanView();}return;}
  viewPeople=people.map(p=>({...p,y:viewY(p.y)}));
  viewStations=stations.map(s=>({...s,y:viewY(s.y)}));
  syncSceneTop();
}
/** 上排的東西現在最高畫到哪裡（場景座標）。只有上排會頂到框的上緣，下排的對話框往上長
 *  最多到上排的名牌，那是另一條線（見 bubbleCeiling）。 */
function sceneTopExtent(){
  let top=SCENE_TOP_MIN;
  for(const p of viewPeople){
    if(p.y>EMBED_ROW_TOP+1||isAway(p))continue;
    if(effectiveLook(names.indexOf(p.name)).cap)top=Math.min(top,p.y-172);// 戴帽子的頭比原本高一點，上緣多留一些
    // 這裡要問「不管上面擋不擋得住，它想長多高」，否則會變成「因為框小所以少畫一行、
    // 因為少畫一行所以框可以再小」的死循環。
    const layout=bubbleLayout(p,true);
    if(layout)top=Math.min(top,p.y-150-BUBBLE_HEAD_GAP-BUBBLE_TAIL-layout.h-8-(layout.lift||0));
  }
  return Math.round(top);
}
/** 上緣變了就重新 fit 一次（fitEmbedView 自己會 markDirty，下一格就會用新的縮放重畫）。 */
function syncSceneTop(){
  const top=sceneTopExtent();
  if(Math.abs(top-EMBED_CONTENT.y0)<1)return;
  EMBED_CONTENT.y0=top;
  fitEmbedView();
}

// 嵌入模式：設計需求系統用 iframe 把場景放進「設計師專長與案件分配」。
// 保留點選人物與資料卡，但關閉鍵盤移動與右側編輯工具；狀態仍照常同步。
const embedMode=new URLSearchParams(location.search).get('embed')==='1';
// 嵌入首頁時 canvas 模糊陰影的光柵化成本最高（實測占單幀約 2/3），改成不模糊的偏移陰影。
const shadowBlurFor=v=>embedMode?0:v;
if(embedMode){document.documentElement.classList.add('embed');game.tabIndex=-1;game.setAttribute('aria-label','設計部即時狀態場景');}
// 嵌在設計需求系統裡時，iframe 的文件底色是瀏覽器依 color-scheme 畫的——html 與 body 都設成透明
// 也蓋不掉，深色模式下就會卡著一塊白。外層切換深淺色時會用 postMessage 告訴我們，跟著設就對了。
if(embedMode){
  window.addEventListener('message',event=>{
    if(event.origin!==location.origin)return;
    const data=event.data;
    if(!data||data.type!=='pixelOfficeTheme')return;
    document.documentElement.style.colorScheme=data.theme==='dark'?'dark':'light';
  });
  // 載入完成後主動問一次現在是什麼主題（外層可能在我們載好之前就切換過了）。
  if(window.parent!==window)try{window.parent.postMessage({type:'pixelOfficeThemeRequest'},location.origin)}catch(error){}
}
// 台灣的國定假日與補假（台北時間 YYYYMMDD）。後端 database-coordinator.ts 有同一份，兩邊都要更新——
// 後端負責真的改狀態，這裡只負責「沒裝爬蟲的人」畫面上的加班濾鏡。來源與更新方式見後端那份的註解。
const TAIWAN_HOLIDAYS={2026:['20260101','20260216','20260217','20260218','20260219','20260220','20260227','20260228','20260403','20260404','20260405','20260406','20260501','20260619','20260925','20260928','20261009','20261010','20261025','20261026','20261225'],2027:['20270101','20270204','20270205','20270206','20270207','20270208','20270209','20270210','20270228','20270301','20270404','20270405','20270406','20270430','20270501','20270609','20270915','20270928','20271010','20271011','20271025','20271224','20271225','20271231']};
let taipeiClock=null,taipeiClockCheckedAt=0;
function currentTaipeiClock(){const now=Date.now();if(now-taipeiClockCheckedAt>30000||!taipeiClock){taipeiClockCheckedAt=now;const parts=Object.fromEntries(new Intl.DateTimeFormat('en-GB',{timeZone:'Asia/Taipei',year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',weekday:'short',hourCycle:'h23'}).formatToParts(new Date(now)).map(part=>[part.type,part.value]));const date=`${parts.year}${parts.month}${parts.day}`;taipeiClock={hour:Number(parts.hour),date,workday:!['Sat','Sun'].includes(parts.weekday)&&!(TAIWAN_HOLIDAYS[parts.year]||[]).includes(date)};}return taipeiClock;}
const currentTaipeiHour=()=>currentTaipeiClock().hour;
// 加班濾鏡只是畫面的「有效狀態」，不寫回後端；實際出勤狀態仍由電腦心跳與手動指定決定。
// 週末與國定假日不套用（那幾天電腦開著也算下班，不是加班）。
function isOvertime(p){if(p.status==='overtime')return true;if(p.status!=='present')return false;if(overtimePreview)return true;const clock=currentTaipeiClock();return clock.workday&&(clock.hour>=19||clock.hour<6);}
const effectiveStatusId=p=>isOvertime(p)?'overtime':p.status;
let people=names.map((name,i)=>({name,x:starts[i][0],y:starts[i][1],dir:'down',mood:'',status:'present',message:'',photo:''})), selected=null,ready=false, keys=new Set(), last=0, saveTimer, photoImages=new Map(), hits=[];
try{const saved=JSON.parse(localStorage.getItem('kaiyao-office-v1')||'null');if(Array.isArray(saved))people.forEach((p,i)=>{const s=saved[i];if(!s)return;p.message=typeof s.message==='string'?s.message.slice(0,60):'';p.mood=moods.some(m=>m.id===s.mood)?s.mood:'';p.status=statuses.some(status=>status.id===s.status)?s.status:'present';p.photo='';if(['4','5'].includes(localStorage.getItem('kaiyao-office-layout'))&&Number.isFinite(s.x)&&Number.isFinite(s.y)){p.x=Math.max(65,Math.min(W-65,s.x));p.y=Math.max(180,Math.min(H-20,s.y));}});}catch{}
syncViewLayout();
function toast(message){$('toast').textContent=message;$('toast').classList.add('visible');clearTimeout(toast.timer);toast.timer=setTimeout(()=>$('toast').classList.remove('visible'),2500);}
function save(){clearTimeout(saveTimer);saveTimer=setTimeout(()=>{try{localStorage.setItem('kaiyao-office-v1',JSON.stringify(people));localStorage.setItem('kaiyao-office-layout','5');}catch{toast('瀏覽器空間不足，這次變更尚未保存。請移除部分照片。');}},200);}
const furniture=new Image(),iconSheet=new Image(),extraSheet=new Image(),overtimeSheet=new Image();// 進站加速（2026-09-18）：只保留實際用到的區塊並改存 WebP。
furniture.src='assets/furniture-v3.webp?v=1';iconSheet.src='assets/icons-v3.webp?v=3';extraSheet.src='assets/icons-status-v4.webp?v=2';
// 加班濾鏡圖（69 KB）只有有人加班（晚上、假日）才用得到，第一次要畫時才載，載好重畫。
function ensureOvertimeSheet(){if(overtimeSheet.getAttribute('src'))return;overtimeSheet.addEventListener('load',()=>{markDirty();if(ready&&selected!==null)portrait($('portrait').getContext('2d'),selected);});overtimeSheet.src='assets/overtime-filter.webp?v=1';}
function resizeCanvas(){markDirty();const scale=Math.max(1,Math.min(embedMode?1.5:3,(window.devicePixelRatio||1)*game.getBoundingClientRect().width/W));game.width=Math.round(W*scale);game.height=Math.round(H*scale);ctx.setTransform(game.width/W,0,0,game.height/H,0,0);ctx.imageSmoothingEnabled=false;}
new ResizeObserver(()=>{resizeCanvas();fitEmbedView();}).observe(game);new ResizeObserver(fitEmbedView).observe(game.parentElement);window.addEventListener('resize',()=>{resizeCanvas();fitEmbedView();});resizeCanvas();
function load(img){return new Promise((resolve,reject)=>{img.onload=resolve;img.onerror=reject;if(img.complete&&img.naturalWidth)resolve();});}
// ───────── 造型：頭像＋服裝＋配件組合（2026-10-01）─────────
// 圖集：wardrobe-heads（5 人 × 正面／側面／背面）、wardrobe-outfits（6 套 × 三面，沒有頭）、wardrobe-acc（黑／藍棒球帽
// 與黑框眼鏡／墨鏡）。資料是每格在圖集裡的位置：x y w h；頭的 s 是臉（皮膚）範圍 [x0,x1,y0,y1]；衣服的 n 是脖子中心 x；
// eyes 是眼睛位置（眼鏡對位用）。組合規則（尺寸全部是照現有人物比例量出來的）：頭放大 WD_K 倍、下巴蓋住脖子上緣
// 往下 WD_OV，整個人縮到跟原本的像素人物一樣高（WD_SCALE）。男生頭在衣服前面；女生有長髮，正面與側面頭髮在衣服後面、
// 背面在前面。帽子對臉的上緣、眼鏡對眼睛；背面不畫眼鏡。
const WARDROBE={"heads":[[{"x":0,"y":0,"w":135,"h":130,"s":[41,106,27,84]},{"x":156,"y":0,"w":117,"h":132,"s":[47,103,30,85]},{"x":312,"y":0,"w":133,"h":124}],[{"x":0,"y":156,"w":138,"h":133,"s":[38,100,25,87]},{"x":156,"y":156,"w":117,"h":132,"s":[47,104,27,85]},{"x":312,"y":156,"w":135,"h":133}],[{"x":0,"y":312,"w":108,"h":82,"s":[5,102,27,78]},{"x":156,"y":312,"w":105,"h":85,"s":[33,93,33,83]},{"x":312,"y":312,"w":110,"h":83}],[{"x":0,"y":468,"w":141,"h":131,"s":[39,108,28,86]},{"x":156,"y":468,"w":122,"h":135,"s":[53,109,29,83]},{"x":312,"y":468,"w":136,"h":127}],[{"x":0,"y":624,"w":106,"h":80,"s":[7,100,12,76]},{"x":156,"y":624,"w":105,"h":80,"s":[24,91,21,78]},{"x":312,"y":624,"w":114,"h":80}]],"outfits":[[{"x":0,"y":0,"w":157,"h":168,"n":78.5},{"x":200,"y":0,"w":110,"h":172,"n":41.5},{"x":400,"y":0,"w":157,"h":172,"n":78.0}],[{"x":0,"y":196,"w":152,"h":170,"n":74.5},{"x":200,"y":196,"w":111,"h":172,"n":49.0},{"x":400,"y":196,"w":152,"h":171,"n":76.0}],[{"x":0,"y":392,"w":160,"h":166,"n":80.5},{"x":200,"y":392,"w":107,"h":169,"n":39.0},{"x":400,"y":392,"w":160,"h":170,"n":79.5}],[{"x":0,"y":588,"w":164,"h":169,"n":81.5},{"x":200,"y":588,"w":112,"h":167,"n":50.0},{"x":400,"y":588,"w":163,"h":167,"n":81.5}],[{"x":0,"y":784,"w":172,"h":169,"n":85.5},{"x":200,"y":784,"w":110,"h":168,"n":51.0},{"x":400,"y":784,"w":168,"h":170,"n":83.0}],[{"x":0,"y":980,"w":174,"h":171,"n":85.5},{"x":200,"y":980,"w":90,"h":169,"n":25.0},{"x":400,"y":980,"w":175,"h":170,"n":87.0}]],"caps":[[{"x":0,"y":0,"w":208,"h":149},{"x":267,"y":0,"w":250,"h":147},{"x":533,"y":0,"w":198,"h":148}],[{"x":0,"y":161,"w":208,"h":149},{"x":267,"y":161,"w":250,"h":147},{"x":533,"y":161,"w":198,"h":148}]],"glasses":[[{"x":0,"y":322,"w":194,"h":63},{"x":267,"y":322,"w":178,"h":65}],[{"x":0,"y":403,"w":194,"h":66},{"x":267,"y":403,"w":179,"h":68}]],"eyes":[[{"x":78.2,"y":54.6},{"x":88.4,"y":53.7}],[{"x":66.2,"y":56.4},{"x":89.7,"y":53.0}],[{"x":54.1,"y":50.7},{"x":80.3,"y":58.4}],[{"x":78.2,"y":59.3},{"x":95.7,"y":53.3}],[{"x":53.1,"y":45.5},{"x":74.4,"y":48.4}]]};
const WARDROBE_OUTFITS=['街頭黃 T','藍 T 寬牛仔褲','黑色西裝外套','米白襯衫','丹寧外套短褲','黑色連帽衫'];
const WARDROBE_CAPS=[{id:'',label:'無'},{id:'black',label:'黑帽'},{id:'blue',label:'藍帽'}],WARDROBE_GLASSES=[{id:'',label:'無'},{id:'clear',label:'黑框'},{id:'sun',label:'墨鏡'}];
const WD_FEMALE=[true,true,false,true,false],WD_K=1.7,WD_OV=8,WD_SCALE=.475,WD_SIDE_BODY_SHIFT=12,WD_DROP=[0,0,0,0,10],WD_BODY_DX=[-8,0,0,-8,0],WD_GLASSES_W=120,WD_GLASSES_DX=[-8,0,0,-8,0],WD_GLASSES_DY=[0,0,8,0,8];// 眼鏡位置微調（原圖像素）：Anna 與 Leona 往左、Noise 與 Machi 往下（使用者 2026-10-02）
// WD_BODY_DX：衣服整體左右位移（原圖像素，負＝往左）：Leona 與 Anna 的衣服偏右（使用者 2026-10-02 回報）。
// WD_GLASSES_W：眼鏡與墨鏡的寬度（原圖像素），所有人一樣大、約等於兩邊臉頰的寬度（原本 100 太小，2026-10-02 使用者要求放大切齊臉頰）；不依各人臉寬換算（皮膚框含耳朵，男生會偏大）。
const WD_SIDE_GLASSES_L=.15,WD_EAR_TOP=[1.5,3,-1,3,3],WD_SIDE_CAP_GROW=1.18,WD_SIDE_CAP_BRIM=55,WD_SIDE_CAP_BACK=.07,WD_EAR_X=.06,WD_SIDE_GLASSES_UP=.6;// 眼鏡桿（鏡框左端那一截）對到耳朵上沿：整副眼鏡往上提鏡高的 .6 倍
//// 側面眼鏡左緣在膚色框的比例、耳朵上沿相對眼睛的位置（頭圖像素）、側面帽子放大倍率（使用者 2026-10-02）
const wardrobeSheets={heads:new Image(),outfits:new Image(),acc:new Image()};
wardrobeSheets.heads.src='assets/wardrobe-heads.webp?v=3';wardrobeSheets.outfits.src='assets/wardrobe-outfits.webp?v=3';// 配件圖（帽子、眼鏡，46 KB）不擋進站：場景準備好之後才載（loadAccessories），載好會自動重畫。
Object.values(wardrobeSheets).forEach(img=>{img.onload=()=>{wardrobeCache.clear();markDirty();if(typeof refreshRosterPortraits==='function')refreshRosterPortraits();if(typeof renderLookPanel==='function'&&selected!==null)renderLookPanel();};});
function loadAccessories(){if(!wardrobeSheets.acc.getAttribute('src'))wardrobeSheets.acc.src='assets/wardrobe-acc.webp?v=2';}
const accessoriesReady=()=>wardrobeSheets.acc.complete&&wardrobeSheets.acc.naturalWidth>0;
const wardrobeCache=new Map();
// ───────── 動作（人物的小動畫，2026-10-02）─────────
// 目前只有 Machi 的「閃身步」：8 張全身連續動作（無頭的身體），頭、帽子、眼鏡照樣疊在脖子上。
// frames 的 x/y/w/h 是動作圖集（wardrobe-action-dodge.webp）上的裁切，n 是脖子中心的 x。圖集第一次要用才載。
// 後端 PIXEL_OFFICE_ACTIONS 有同一份「誰可以用」，兩邊要一致。
// 每個動作一張圖集（各自 lazy 載入）。move：'slide'＝0～3 張往右、4～7 張往左快速位移（閃身步）；'sway'＝身體畫一個橢圓形的圈（小幅轉圈晃動）。
// frames 的 n 是脖子中心 x、t 是脖子頂端離圖片上緣的距離（手舉過頭時圖片上緣不是脖子）。over：這幾張手在臉旁邊，身體要畫在頭上面。noGlasses：這幾張不畫眼鏡（手蓋住臉）。
const WARDROBE_ACTIONS={
  dodge:{label:'閃身步',who:[4],src:'assets/wardrobe-action-dodge.webp?v=1',move:'slide',frameMs:125,hold:[0,4],holdMs:1500,shift:28,headDrop:16,over:[],noGlasses:[],ms:Infinity,frames:[{x:0,y:3,w:173,h:171,n:86.7},{x:177,y:3,w:167,h:171,n:93.8},{x:348,y:4,w:201,h:170,n:120.9},{x:553,y:7,w:197,h:167,n:133.3},{x:754,y:0,w:171,h:174,n:84.7},{x:929,y:0,w:168,h:174,n:76.3},{x:1101,y:0,w:199,h:174,n:77.1},{x:1304,y:2,w:173,h:172,n:86.2}]},
  bear:{label:'狗熊哆嗦毛',who:[4],src:'assets/wardrobe-action-bear.webp?v=1',move:'sway',frameMs:100,hold:[],holdMs:0,sway:8,swayY:6,swayRot:.02,swayPeriods:1,headSway:4,headPeriods:2,headDrop:8,over:[5,6,7,8],noGlasses:[6,7],ms:Infinity,frames:[{x:0,y:29,w:167,h:180,n:83.9,t:9.4},{x:171,y:29,w:124,h:180,n:55.4,t:1.9},{x:299,y:29,w:136,h:180,n:61.3,t:6.9},{x:439,y:29,w:166,h:180,n:81.7,t:4.4},{x:609,y:4,w:134,h:205,n:67.3,t:27.5},{x:747,y:4,w:135,h:205,n:67.9,t:30.7},{x:886,y:4,w:109,h:205,n:54.8,t:39.4},{x:999,y:4,w:109,h:205,n:52.3,t:42.6},{x:1112,y:0,w:169,h:209,n:73.6,t:30.7},{x:1285,y:0,w:164,h:209,n:84.5,t:26.9},{x:1453,y:0,w:134,h:209,n:64.8,t:27.5},{x:1591,y:0,w:166,h:209,n:85.4,t:35.7}]},
  kick:{label:'浪子踢球',who:[4],src:'assets/wardrobe-action-kick.webp?v=1',move:'none',frameMs:110,hold:[0,11],holdMs:250,dur:[300,650,350,600,110,110,110,110,110,110,110,250],headDrop:16,over:[],noGlasses:[],ms:Infinity,frames:[{"x":0,"y":0,"w":177,"h":168,"n":91.6,"t":4.3,"hd":0},{"x":181,"y":0,"w":179,"h":151,"n":93.3,"t":-12.7,"hd":17},{"x":364,"y":0,"w":176,"h":172,"n":91,"t":6.3,"hd":-2},{"x":544,"y":0,"w":176,"h":172,"n":90.4,"t":6,"hd":-2.3},{"x":724,"y":0,"w":180,"h":183,"n":89.2,"t":11.5,"hd":-7.8},{"x":908,"y":0,"w":169,"h":185,"n":86.6,"t":12.8,"hd":-8.5},{"x":1081,"y":0,"w":173,"h":184,"n":87,"t":12.3,"hd":-8},{"x":1258,"y":0,"w":174,"h":188,"n":89.2,"t":14.3,"hd":-10},{"x":1436,"y":0,"w":174,"h":192,"n":83.7,"t":21.5,"hd":-6.8},{"x":1614,"y":0,"w":182,"h":183,"n":91.7,"t":11.8,"hd":-7.5},{"x":1800,"y":0,"w":179,"h":174,"n":91.4,"t":7.3,"hd":-3},{"x":1983,"y":0,"w":176,"h":170,"n":91.5,"t":5.3,"hd":-1}]}
};
Object.entries(WARDROBE_ACTIONS).forEach(([id,def])=>{def.img=new Image();wardrobeSheets['a_'+id]=def.img;def.img.onload=()=>{wardrobeCache.clear();markDirty();if(typeof renderActionPanel==='function')renderActionPanel();};});
function loadActionSheet(id){const def=WARDROBE_ACTIONS[id];if(def&&!def.img.getAttribute('src'))def.img.src=def.src;}
const actionImgReady=def=>def.img.complete&&def.img.naturalWidth>0;
/** 這個人現在正在做的動作（沒有就 null）：開始後 ms 毫秒內，依時間挑第幾張。function 宣告，原因同 lookDefault（TDZ）。 */
function actionOf(i){
  const p=people[i],a=p&&p.action,def=a&&WARDROBE_ACTIONS[a.id];
  if(!def||!def.who.includes(i)||!actionImgReady(def))return null;
  const age=Date.now()-a.at;if(!(age>-3000&&age<def.ms))return null;
  // 循環播放：每一張 frameMs，hold 裡的那幾張多停 holdMs；整圈的長度是各張時間的總和。
  const dur=def.frames.map((f,n)=>def.dur?def.dur[n]:def.hold.includes(n)?def.holdMs:def.frameMs),cycle=dur.reduce((x,y)=>x+y,0),elapsed=Math.max(0,age)%cycle;
  let t=elapsed,n=0;while(n<dur.length-1&&t>=dur[n]){t-=dur[n];n++;}
  let dx=0,dy=0,rot=0,hx=0;
  if(def.move==='slide'){
    // 橫向位移（畫面像素）：0 號停在左邊，1～3 快速往右移到右邊；4 號停在右邊，5～7 快速往左移回左邊。
    const half=def.frames.length/2,k=n%half,frac=t/dur[n],D=def.shift;
    dx=k===0?(n<half?-D:D):(n<half?-D+2*D*((k-1)+frac)/(half-1):D-2*D*((k-1)+frac)/(half-1));
  }else if(def.move==='sway'){
    // 身體畫圈（橢圓形的「0」）：左右 sway、上下 swayY，一圈 = cycle / swayPeriods；傾斜跟著左右走。
    const ang=elapsed/cycle*Math.PI*2*def.swayPeriods;dx=-Math.sin(ang)*def.sway;dy=-Math.cos(ang)*def.swayY+def.swayY;rot=-Math.sin(ang)*def.swayRot;if(def.headSway)hx=Math.sin(elapsed/cycle*Math.PI*2*def.headPeriods)*def.headSway;
  }
  return {id:a.id,n,dx,dy,rot,hx};
}
const wardrobeReady=()=>[wardrobeSheets.heads,wardrobeSheets.outfits].every(img=>img.complete&&img.naturalWidth);
// 預設造型＝每個人現在的樣子（2026-10-01 使用者指定，原本的像素人物已下架）：Leona 黑西裝、Amber 米白襯衫、Noise 丹寧外套＋藍帽、
// Machi 全黑連帽衫長褲、Anna 藍色 T 恤。只有 Anna 可以在藍色（1）與黃色（0）兩套之間換；其他人的衣服固定，帽子與眼鏡大家都可以換。
// 用函式而不是常數：腳本最前面的版面計算（sceneTopExtent）就會用到，那時下面的 const 還沒宣告。
function lookDefault(i){return [{outfit:2,cap:'',glasses:''},{outfit:3,cap:'',glasses:''},{outfit:4,cap:'blue',glasses:''},{outfit:1,cap:'',glasses:''},{outfit:5,cap:'',glasses:''}][i]||{outfit:2,cap:'',glasses:''};}
function outfitChoices(i){return i===3?[1,0]:null;}
/** 這個人現在實際的造型：後端存的造型（有的話）補上預設值；不能換的衣服一律用預設。 */
function effectiveLook(i){
  const d=lookDefault(i),l=people[i]&&people[i].look;if(!l||typeof l!=='object')return d;
  const choices=outfitChoices(i),outfit=choices&&choices.includes(l.outfit)?l.outfit:d.outfit;
  return {outfit,cap:['','black','blue'].includes(l.cap)?l.cap:d.cap,glasses:['','clear','sun'].includes(l.glasses)?l.glasses:d.glasses};
}
const lookOf=effectiveLook;
const sameLook=(a,b)=>a.outfit===b.outfit&&a.cap===b.cap&&a.glasses===b.glasses;
function buildWardrobe(i,view,look,action){
  const D=WARDROBE,K=WD_K,H=D.heads[i][view],oIdx=look.outfit,act=action&&WARDROBE_ACTIONS[action.id],B=act?act.frames[action.n]:D.outfits[oIdx][view],front=D.heads[i][0].s,sk=H.s||front;
  const chin=view===2?{x:H.w/2,y:front[3]}:{x:(sk[0]+sk[1])/2,y:sk[3]};
  const hx=B.n-chin.x*K,hy=WD_OV-chin.y*K+(act?act.headDrop+(B.hd||0):0);
  const head={sheet:'heads',src:H,x:hx,y:hy,w:H.w*K,h:H.h*K},body={sheet:act?'a_'+action.id:'outfits',src:B,x:(view===1?-WD_SIDE_BODY_SHIFT:0)+WD_BODY_DX[i],y:WD_DROP[i]-(act?B.t||0:0),w:B.w,h:B.h};// 側面：衣服往左收一點（使用者回報側身衣服偏右），頭與配件不動
  const layers=(!WD_FEMALE[i]||view===2)&&!(act&&act.over.includes(action.n))?[body,head]:[head,body];
  const eye=D.eyes[i][view];
  if(look.glasses&&view<2&&accessoriesReady()&&!(act&&act.noGlasses.includes(action.n))){
    const row=look.glasses==='sun'?1:0,g=D.glasses[row][view],gf=D.glasses[row][0];
    if(view===0){const s=WD_GLASSES_W/gf.w,w=g.w*s,h=g.h*s;layers.push({sheet:'acc',src:g,w,h,x:hx+chin.x*K-w/2+WD_GLASSES_DX[i],y:hy+eye.y*K-h/2+WD_DROP[i]+WD_GLASSES_DY[i]});}
    else{// 側面：左右從耳朵前緣到臉頰最前面、上緣對齊耳朵上沿
      const span=sk[1]-sk[0],left=hx+(sk[0]+span*WD_SIDE_GLASSES_L)*K,right=hx+sk[1]*K,s=(right-left)/g.w,w=g.w*s,h=g.h*s;
      layers.push({sheet:'acc',src:g,w,h,x:left,y:hy+(eye.y+WD_EAR_TOP[i])*K+WD_DROP[i]-h*WD_SIDE_GLASSES_UP});}
  }
  if(look.cap&&accessoriesReady()){
    const row=look.cap==='blue'?1:0,c=D.caps[row][view],female=WD_FEMALE[i],factor=view===1?(female?.8:.98):(female?.72:.95),s=H.w*K*factor/c.w,w=c.w*s,h=c.h*s,bigS=view===1?(female?(sk[1]*K+WD_SIDE_CAP_BRIM-w*.06)/c.w:H.w*K*factor*WD_SIDE_CAP_GROW/c.w):s,bw=c.w*bigS,bh=c.h*bigS;
    // 女生頭像連長髮一起很寬，照頭寬放大帽沿到不了臉前面，所以改成帽沿尖端＝臉最前緣再往前 WD_SIDE_CAP_BRIM（頭圖放大後的像素）。
    // 側面：左緣固定、帽子放大，帽沿往前超出頭髮；下緣不動（往上長）
    layers.push(view===1?{sheet:'acc',src:c,w:bw*(1-WD_SIDE_CAP_BACK),h:bh,x:hx+w*.06+bw*WD_SIDE_CAP_BACK,y:hy+sk[2]*K-h+h*.32+WD_DROP[i]+h-bh}:{sheet:'acc',src:c,w,h,x:hx+H.w*K/2-w/2,y:hy+sk[2]*K-h+h*.34+WD_DROP[i]});
  }
  const minX=Math.min(...layers.map(l=>l.x)),minY=Math.min(...layers.map(l=>l.y)),maxX=Math.max(...layers.map(l=>l.x+l.w)),maxY=Math.max(...layers.map(l=>l.y+l.h));
  const canvas=document.createElement('canvas');canvas.width=Math.ceil(maxX-minX)+2;canvas.height=Math.ceil(maxY-minY)+2;
  const c2=canvas.getContext('2d');c2.imageSmoothingQuality='high';
  layers.forEach(l=>c2.drawImage(wardrobeSheets[l.sheet],l.src.x,l.src.y,l.src.w,l.src.h,l.x-minX,l.y-minY,l.w,l.h));
  // 帽子單獨再存一張（跟整張同尺寸、同位置）：戴耳機時耳機要夾在頭與帽子之間，帽子得在耳機上面再蓋一次。
  let capCanvas=null;
  if(look.cap&&accessoriesReady()){capCanvas=document.createElement('canvas');capCanvas.width=canvas.width;capCanvas.height=canvas.height;const cc=capCanvas.getContext('2d');cc.imageSmoothingQuality='high';const l=layers[layers.length-1];cc.drawImage(wardrobeSheets[l.sheet],l.src.x,l.src.y,l.src.w,l.src.h,l.x-minX,l.y-minY,l.w,l.h);}
  const eyeFront=D.eyes[i][Math.min(view,1)];
  // 臉的幾何（畫布座標、原圖像素）：耳機、加班黑眼圈用它對位，不再用固定數字。
  const geom={cx:hx+chin.x*K-minX,chinY:hy+chin.y*K-minY,eyeY:hy+eyeFront.y*K-minY,faceW:(front[1]-front[0])*K,faceH:(front[3]-front[2])*K,topY:hy-minY,earX:hx+(sk[0]+(sk[1]-sk[0])*WD_EAR_X)*K-minX};
  return {canvas,capCanvas,geom,layers,minX,minY,ax:(act?B.n:B.w/2)-minX,ay:B.h-(act?B.t||0:0)-minY};// 腳的落點仍以衣服原本的中心算，衣服往左之後腳會落在地面圓圈偏左一點，頭留在原處
}
function wardrobeFrame(index,dir,action){
  if(!wardrobeReady())return null;const look=lookOf(index);
  const view=action?0:dir==='up'?2:dir==='left'||dir==='right'?1:0,key=`${index}|${look.outfit}|${look.cap}|${look.glasses}|${view}${action?`|${action.id}${action.n}`:''}`;
  let frame=wardrobeCache.get(key);if(!frame){frame=buildWardrobe(index,view,look,action);wardrobeCache.set(key,frame);}
  return frame;
}
/** 聽音樂時身體不動、只有頭（連同帽子、眼鏡）點頭：把每一層分開畫，衣服那層不加位移，其他層加 nod。
 *  各層的畫布第一次用到才建、之後快取在 frame 上。 */
function drawWardrobeNod(context,index,dir,x,y,nod,h=142,action,hdx=0){
  const frame=wardrobeFrame(index,dir,action);if(!frame)return false;
  if(!frame.layerCanvases)frame.layerCanvases=frame.layers.map(layer=>{
    const canvas=document.createElement('canvas');canvas.width=frame.canvas.width;canvas.height=frame.canvas.height;
    const c=canvas.getContext('2d');c.imageSmoothingQuality='high';c.drawImage(wardrobeSheets[layer.sheet],layer.src.x,layer.src.y,layer.src.w,layer.src.h,layer.x-frame.minX,layer.y-frame.minY,layer.w,layer.h);
    return {canvas,isBody:layer.sheet==='outfits'||layer.sheet.startsWith('a_')};
  });
  const s=WD_SCALE*(h/142);
  context.save();context.translate(x,y);if(dir==='left'&&!action)context.scale(-1,1);context.imageSmoothingEnabled=true;
  frame.layerCanvases.forEach(layer=>context.drawImage(layer.canvas,(layer.isBody?0:hdx)-frame.ax*s,(layer.isBody?0:nod*(h/142))-frame.ay*s,layer.canvas.width*s,layer.canvas.height*s));
  context.restore();return true;
}
/** 帽子蓋在耳機上面：耳機畫好之後呼叫，把帽子（只有帽子）用同樣的位置再畫一次。 */
function drawWardrobeCap(context,index,dir,x,y,h=142,action){
  const frame=wardrobeFrame(index,dir,action);if(!frame||!frame.capCanvas)return;
  const s=WD_SCALE*(h/142);
  context.save();context.translate(x,y);if(dir==='left'&&!action)context.scale(-1,1);context.imageSmoothingEnabled=true;
  context.drawImage(frame.capCanvas,-frame.ax*s,-frame.ay*s,frame.canvas.width*s,frame.canvas.height*s);context.restore();
}
function drawWardrobe(context,index,dir,x,y,h,action){
  const frame=wardrobeFrame(index,dir,action);if(!frame)return false;
  const s=WD_SCALE*(h/142);
  context.save();context.translate(x,y);if(dir==='left'&&!action)context.scale(-1,1);context.imageSmoothingEnabled=true;
  context.drawImage(frame.canvas,-frame.ax*s,-frame.ay*s,frame.canvas.width*s,frame.canvas.height*s);context.restore();return true;
}
function sprite(context,index,dir,x,y,w=98,h=142){drawWardrobe(context,index,dir,x,y,h);}
// overtime-filter.webp：正面、側面、背面三格（每格 362）。黑眼圈與鬼火分層繪製。
// 黑眼圈：原圖正面兩團（x116/x200，y122 起高 28）、側面一團（x190，y124 起高 28），各自貼到眼珠正下方。
// 眼珠中心固定在 ±12（側面 +16），左右用同一組尺寸，所以兩邊一定對稱；寬度取 14（側面 12）比眼珠的
// 10 略寬一點，外緣才不會壓到頭髮或耳朵。
// 鬼火：原圖從 y160 才開始，來源要從 156 取（不是 145），否則黑眼圈下緣會被當成鬼火重畫在頭頂兩側。
function drawOvertimeFilter(context,index,dir,feetX,feetY,height=142,compact=false){ensureOvertimeSheet();if(!overtimeSheet.complete||!overtimeSheet.naturalWidth)return;const frame=dir==='up'?2:dir==='left'||dir==='right'?1:0,cell=overtimeSheet.naturalWidth/3,scale=height/142,size=150*scale,top=feetY-159*scale,half=cell/2,flameTop=156,flameHeight=102,flameWidth=(compact?50:half/cell*150)*scale,flameDrawHeight=flameHeight/cell*size,flameY=top+flameTop/cell*size-38*scale,leftX=(compact?-64:-105)*scale,rightX=(compact?14:30)*scale,inner=(compact?24:43)*scale,outer=(compact?70:112)*scale;context.save();context.imageSmoothingEnabled=true;context.imageSmoothingQuality='high';context.translate(feetX,0);if(dir==='left')context.scale(-1,1);
  // 兩團鬼火分開畫，中心約在頭像左右 68 px。
  // 只保留頭像外側的鬼火區域，避免鬼火內側疊到臉上。
  context.save();context.beginPath();context.rect(-outer,flameY,outer-inner,flameDrawHeight);context.clip();context.drawImage(overtimeSheet,frame*cell,flameTop,half,flameHeight,leftX,flameY,flameWidth,flameDrawHeight);context.restore();
  context.save();context.beginPath();context.rect(inner,flameY,outer-inner,flameDrawHeight);context.clip();context.drawImage(overtimeSheet,frame*cell+half,flameTop,half,flameHeight,rightX,flameY,flameWidth,flameDrawHeight);context.restore();
  // 背面原稿沒有黑眼圈；正面兩團、側面一團，分別對齊各自的眼睛中心。
  if(frame!==2){const bags=frame===1?[[190,124,52,28,16,12]]:[[116,122,50,28,-12,14],[200,122,51,28,12,14]],faceScale=(compact?95/98:1)*scale,fr=wardrobeFrame(index,'down'),bagY=fr?feetY+(fr.geom.eyeY+8-fr.ay)*WD_SCALE*scale:feetY-95*scale,eyeDx=fr&&frame===0?fr.geom.faceW*.23*WD_SCALE*scale/faceScale:0;
    for(const[sx,sy,sw,sh,cx0,bagWidth]of bags){const cx=eyeDx?Math.sign(cx0)*eyeDx:cx0,dw=bagWidth*faceScale,dh=dw*sh/sw;context.drawImage(overtimeSheet,frame*cell+sx,sy,sw,sh,cx*faceScale-dw/2,bagY,dw,dh);}}
  context.restore();}
function portrait(context,i,showOvertime=true,blank=false){context.clearRect(0,0,context.canvas.width,context.canvas.height);if(blank)return;if(ready){const x=context.canvas.width/2,y=context.canvas.height-3;sprite(context,i,'down',x,y,95,144);if(showOvertime&&isOvertime(people[i]))drawOvertimeFilter(context,i,'down',x,y,144,true);}}
function select(i){selected=i;keys.clear();markDirty();document.querySelectorAll('.roster-button').forEach((b,n)=>b.classList.toggle('active',n===i));
  const chosen=i!==null&&i!==undefined;
  $('tools').hidden=!chosen;$('toolsEmpty').hidden=chosen;$('selectedTag').textContent=chosen?'已選取':'未選取';
  if(!chosen){cardPinned=false;$('personCard').classList.remove('is-pinned');$('personCard').hidden=true;$('personName').textContent='—';$('personDesc').textContent='點人物開始';$('moodStatus').textContent='';portrait($('portrait').getContext('2d'),0,false,true);renderLevelTable();return;}
  $('personName').textContent=people[i].name;$('personDesc').textContent=descriptions[i];$('message').value=people[i].message;updateCount();
  ensureLevels();
  updateMood();updateStatus();renderMyStories();updateMusicPanel();renderLookPanel();renderActionPanel();updateLevel();portrait($('portrait').getContext('2d'),i);renderPersonCard();renderLevelTable();}
function numberText(value){return Number(value).toLocaleString('zh-TW',{maximumFractionDigits:1});}
function levelTitle(level,group='graphic'){
  const list=levelTitles[group]||levelTitles.graphic;
  let title=list[0];
  LEVEL_STEPS.forEach((step,index)=>{if(level>=step&&list[index])title=list[index];});
  return title;
}
function levelFromScore(score,name=''){
  const safe=Math.max(0,Number(score)||0),level=Math.floor(Math.sqrt(safe/10))+1,current=10*(level-1)**2,next=10*level**2,progress=(safe-current)/(next-current)*100;
  return {score:safe,xp:safe*10,level,title:levelTitle(level,levelGroupOf(name)),remaining:Math.max(0,next-safe),progress:Math.max(0,Math.min(100,progress))};
}
function updateLevel(){
  if(selected===null)return;
  const stat=levelStats[people[selected].name]||levelFromScore(0,people[selected].name);
  $('levelHeading').textContent='Lv.'+stat.level;$('levelTitle').textContent=stat.title;$('xpFill').style.width=stat.progress.toFixed(1)+'%';$('xpTrack').setAttribute('aria-valuenow',stat.progress.toFixed(1));
  $('scoreText').textContent=`${numberText(stat.score)} 分 · ${numberText(stat.xp)} EXP`;$('nextText').textContent=`距 Lv.${stat.level+1} 還差 ${numberText(stat.remaining)} 分`;
  $('levelSource').textContent=levelIsLive?`已同步歷史已完成案件 · ${levelUpdatedAt}`:'目前顯示最近同步值 · 連線後自動更新';
}
/** 等級一覽表：兩組各一欄，列出每個級距的稱號；稱號可以直接改。
 *  只有完整版看得到（嵌入模式整個右側工具欄都是隱藏的），所以不必另外判斷 embedMode。 */
function renderLevelTable(){
  const holder=$('levelTable');
  if(!holder)return;
  const focused=document.activeElement;
  // 正在打字時不要重畫，否則遠端輪詢一回來游標就被踢掉。
  if(focused&&holder.contains(focused))return;
  holder.textContent='';
  const selectedName=selected===null?'':people[selected].name;
  for(const group of ['graphic','video']){
    const column=document.createElement('div');
    column.className='level-group';
    const head=document.createElement('div');
    head.className='level-group-head';
    const title=document.createElement('strong');
    title.textContent=LEVEL_GROUP_LABELS[group];
    const members=document.createElement('span');
    members.textContent=names.filter(name=>levelGroupOf(name)===group).join('、')||'尚無成員';
    head.append(title,members);
    column.append(head);
    LEVEL_STEPS.forEach((step,index)=>{
      const row=document.createElement('label');
      row.className='level-row';
      // 這一列是不是「被選到的人現在的稱號」——一覽表才看得出自己站在哪一階。
      const stat=selectedName?levelStats[selectedName]:null;
      const reached=stat&&levelGroupOf(selectedName)===group&&stat.level>=step&&(index===LEVEL_STEPS.length-1||stat.level<LEVEL_STEPS[index+1]);
      if(reached)row.classList.add('is-current');
      const step_=document.createElement('span');
      step_.className='level-step';
      step_.textContent='Lv.'+step+(index<LEVEL_STEPS.length-1?'–'+(LEVEL_STEPS[index+1]-1):'+');
      const input=document.createElement('input');
      input.type='text';input.maxLength=12;input.value=levelTitles[group][index];
      input.setAttribute('aria-label',`${LEVEL_GROUP_LABELS[group]} Lv.${step} 的稱號`);
      input.onchange=()=>saveLevelTitle(group,index,input.value);
      input.onkeydown=event=>{if(event.key==='Enter'){event.preventDefault();input.blur();}};
      row.append(step_,input);
      column.append(row);
    });
    holder.append(column);
  }
}
/** 存一個稱號。後端會把空白、過長與缺漏都洗乾淨，所以這裡直接把它回傳的那份當作準。 */
function saveLevelTitle(group,index,value){
  const next=levelTitles[group].slice();
  next[index]=String(value||'').trim().slice(0,12);
  if(next[index]===levelTitles[group][index])return;
  syncCall({action:'pixelOfficeLevelTitlesUpdate',titles:{[group]:next}})
    .then(data=>{applyLevelTitles(data);toast('已更新稱號');})
    .catch(err=>{toast('稱號沒改成：'+err.message);renderLevelTable();});
}
/** 套用後端來的稱號，並把每個人的稱號重算一次（分數沒變，只有文字換了）。 */
function applyLevelTitles(source){
  const payload=source?.levels||source;
  if(!payload||!payload.titles)return;
  levelTitles=payload.titles;
  if(Array.isArray(payload.videoMembers))levelVideoMembers=payload.videoMembers;
  const scores=levelScores||fallbackScores;
  levelStats=Object.fromEntries(names.map(name=>[name,levelFromScore(scores[name],name)]));
  if(selected!==null){updateLevel();renderPersonCard();}
  renderLevelTable();
}
function validNumber(value){const text=String(value??'').trim().replace(/,/g,'');if(!text)return null;const number=Number(text);return Number.isFinite(number)?number:null;}
function rowYear(row){
  for(const key of ['開始日期','結束日期','填單時間','時間標記']){const match=String(row[key]||'').match(/(20\d{2})/);if(match)return Number(match[1]);}
  const match=String(row['案件編號']||'').match(/^(\d{2})/);return match?2000+Number(match[1]):null;
}
function scoreRows(rows){
  const totals=Object.fromEntries(names.map(name=>[name,0])),nameMap=Object.fromEntries(names.map(name=>[name.toLowerCase(),name]));
  for(const row of rows||[]){const name=nameMap[String(row['設計負責人']||'').trim().toLowerCase()];if(!name||String(row['狀態']||'').trim()!=='已完成'||rowYear(row)<2023)continue;const weight=validNumber(row['加權']),quantity=validNumber(row['數量']);totals[name]+=weight!==null?weight:quantity!==null?quantity:1;}
  return totals;
}
let levelsRequested=false;
// 嵌進設計需求系統時，進站不該為了等級與案件先扛一份 3.8 MB 的快照——那是整個首頁最大的一筆。
// 改成第一次真的要看某個人的資料（滑到人物上）才載，載好會自動把卡片重畫一次。
function ensureLevels(){if(levelsRequested)return;levelsRequested=true;syncLevels();}
async function syncLevels(){
  const urls=['/data/database_archive.json','https://emctaipeiart.github.io/data/database_archive.json'];let payload=null;
  // no-cache 而不是 no-store：這份快照有 3.8 MB，內容沒變時走 304 就好，不必每次重新下載。
  for(const url of urls){try{const response=await fetch(url,{cache:'no-cache'});if(!response.ok)throw Error(String(response.status));const candidate=await response.json();if(Array.isArray(candidate.rows)){payload=candidate;break;}}catch{}}
  if(!payload)return;
  caseRows=payload.rows;
  // 歷史快照裡也有早就歸檔的案件，其中有些當初忘了把狀態改成已完成，就會一直被算成「手上的案件」，
  // 而且那些資料已經不在現行資料庫裡、改不動（2026-09-22 使用者回報 Leona 四、五月的案件還掛著）。
  // 快照本身有一份「目前還在現行資料庫的案件」清單（格式是「案件編號#序號」），用它過濾就準了。
  // 舊格式的快照沒有這個欄位，那就維持原樣不過濾，不會比現在更差。
  currentCaseIds=Array.isArray(payload.currentDatabaseRowKeys)
    ? new Set(payload.currentDatabaseRowKeys.map(key=>String(key).split('#')[0]))
    : null;
  const totals=scoreRows(payload.rows);levelScores=totals;levelStats=Object.fromEntries(names.map(name=>[name,levelFromScore(totals[name],name)]));levelIsLive=true;
  const timestamp=new Date(payload.generatedAt||Date.now());levelUpdatedAt=Number.isNaN(timestamp.getTime())?'最新快照':timestamp.toLocaleString('zh-TW',{timeZone:'Asia/Taipei',year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',hour12:false});
  document.querySelectorAll('.roster-level').forEach((element,i)=>element.textContent='Lv.'+levelStats[names[i]].level);updateLevel();renderPersonCard();renderLevelTable();
}
// 人物資料卡：等級與案件用 syncLevels() 已經下載的那份歷史快照（含未完成的案件），技能與「新專案找誰」
// 另外跟 Worker 要一份很小的清單，這樣就不必在遊戲裡下載 1.5 MB 的 db.json。
let caseRows=null,designerInfo=null,newProjectPriority=null,currentCaseIds=null;
// 手上的案件只看這三種狀態（使用者指定）。顏色跟主系統的案件標籤一致。
const CARD_CASE_STATES=[{key:'未開始',color:'#ff5a5a'},{key:'執行中',color:'#5ea9ff'},{key:'修改中',color:'#f0b429'}];
const CARD_CASE_PREVIEW=3;
async function syncDesigners(){
  try{
    // 第一次先用 index.html 提早送出的結果（見 __pixelP）；沒有或失敗就自己問。
    const early=window.__pixelP&&window.__pixelP.designers;if(window.__pixelP)window.__pixelP.designers=null;
    let data=early?await early:null;if(!data||!data.ok)data=await syncCall({action:'pixelOfficeDesigners'});
    designerInfo=Object.fromEntries((data.designers||[]).map(item=>[item.name,item]));
    newProjectPriority=data.priority||null;
    renderPersonCard();
  }catch{}
}
function personCases(name){
  const groups=CARD_CASE_STATES.map(state=>({...state,rows:[]}));
  for(const row of caseRows||[]){
    if(String(row['設計負責人']||'').trim().toLowerCase()!==name.toLowerCase())continue;
    // 已經歸檔的案件不算在「手上」——它們的狀態已經沒辦法再更新了。
    if(currentCaseIds&&!currentCaseIds.has(String(row['案件編號'])))continue;
    const group=groups.find(item=>item.key===String(row['狀態']||'').trim());
    if(group)group.rows.push(row);
  }
  return groups;
}
function caseLabel(row){
  const client=String(row['客戶別']||'').trim(),project=String(row['專案名稱']||'').trim();
  const label=[client,project].filter(Boolean).join(' · ')||String(row['案件編號']||'未命名案件');
  return label.length>26?label.slice(0,25)+'…':label;
}
function renderPersonCard(){
  const card=$('personCard');
  // 個人技能表（資料卡）只給前台 index.html 的嵌入畫面看；編輯畫面有右側工具列，不需要這張卡。
  if(selected===null||!embedMode){card.hidden=true;return;}
  const p=people[selected],stat=levelStats[p.name]||levelFromScore(0,p.name),info=designerInfo?.[p.name];
  $('cardName').textContent=p.name;
  $('cardLevel').textContent='Lv.'+stat.level;
  $('cardTitle').textContent=stat.title+(info?.group?` · ${info.group}組`:'');
  $('cardXpFill').style.width=stat.progress.toFixed(1)+'%';
  $('cardXpText').textContent=`${numberText(stat.xp)} EXP`;
  const skills=info?.skills||[];
  $('cardSkills').innerHTML=skills.length
    ? skills.map(skill=>`<button type="button" class="person-card-skill" data-skill="${escapeHtml(skill)}" title="帶入設計需求表單">${escapeHtml(skill)}</button>`).join('')
    : '<span class="person-card-empty">'+(designerInfo?'後台還沒填技能':'讀取中…')+'</span>';
  if(!caseRows)$('cardCases').innerHTML='<span class="person-card-empty">讀取中…</span>';
  else{
    const groups=personCases(p.name).filter(group=>group.rows.length);
    $('cardCases').innerHTML=groups.length?groups.map(group=>`<div class="person-card-case-group">
      <div class="person-card-case-head"><span class="person-card-case-dot" style="background:${group.color}"></span>${group.key}<span class="person-card-case-count">${group.rows.length}</span></div>
      <ul class="person-card-case-list">${group.rows.slice(0,CARD_CASE_PREVIEW).map(row=>`<li>${escapeHtml(caseLabel(row))}</li>`).join('')}${group.rows.length>CARD_CASE_PREVIEW?`<li>…還有 ${group.rows.length-CARD_CASE_PREVIEW} 件</li>`:''}</ul></div>`).join('')
      :'<span class="person-card-empty">目前沒有未開始、執行中或修改中的案件</span>';
  }
  const priority=newProjectPriority;
  $('cardPriority').innerHTML=priority
    ? '新專案找 '+Object.entries(priority).map(([group,name])=>`${escapeHtml(group)}：<b>${escapeHtml(name)}</b>`).join('　')
    : '新專案輪值讀取中…';
  card.hidden=false;
  positionPersonCard();
}
function escapeHtml(value){return String(value).replace(/[&<>"]/g,ch=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[ch]));}
/** 兩塊矩形重疊的面積。 */
function overlapArea(a,b){
  return Math.max(0,Math.min(a.x+a.w,b.x+b.w)-Math.max(a.x,b.x))*Math.max(0,Math.min(a.y+a.h,b.y+b.h)-Math.max(a.y,b.y));
}
/** 把資料卡放在不會擋到人臉的地方，而且優先往左邊開。
 *  一路修過來的原因：
 *  - 最早是固定「右邊放不下就翻到左邊」，點最右邊那兩位時卡片一律翻左，正好蓋住中間的同事。
 *  - 接著改成八個候選位置挑重疊面積最小的，但「身體」跟「臉」同分，結果還是會壓到臉。
 *  現在：候選位置從左邊開始排，重疊只看臉（臉被擋住才是真的看不到人），被點的那一位加重
 *  200 倍——只要有位置閃得開就一定閃得開。同分時選最左邊的（使用者 2026-09-24 指定往左開）。 */
function positionPersonCard(){
  const card=$('personCard');
  if(card.hidden||selected===null)return;
  // 卡片是相對 .canvas-wrap 定位，但場景在嵌入模式下被放大並平移過，canvas 自己的矩形跟
  // .canvas-wrap 不一樣。兩者混用的話，右邊的人物算出來的位置會超出框外（卡片被切掉看不到）。
  // 位置用「canvas 相對 .canvas-wrap 的偏移」換算，邊界一律夾在 .canvas-wrap 之內。
  const holder=game.parentElement.getBoundingClientRect(),view=game.getBoundingClientRect();
  if(!holder.width||!view.width)return;
  const scaleX=view.width/W,scaleY=view.height/H;
  const offsetX=view.left-holder.left,offsetY=view.top-holder.top;
  const boxOf=person=>({x:offsetX+(person.x-53)*scaleX,y:offsetY+(person.y-150)*scaleY,w:106*scaleX,h:150*scaleY});
  // 臉：頭頂往下 62，左右各收一點。擋到臉才算真的擋到人，擋到桌子或身體無所謂。
  const faceOf=person=>({x:offsetX+(person.x-34)*scaleX,y:offsetY+(person.y-150)*scaleY,w:68*scaleX,h:62*scaleY});
  const p=viewPeople[selected]||people[selected];
  const target=boxOf(p),targetFace=faceOf(p);
  const otherFaces=viewPeople.filter((person,index)=>index!==selected&&!isAway(person)).map(faceOf);
  const cardW=card.offsetWidth||232,cardH=card.offsetHeight||240,gap=12;
  const farX=Math.max(8,holder.width-cardW-8),farY=Math.max(8,holder.height-cardH-8);
  const clampX=value=>Math.max(8,Math.min(farX,value));
  const clampY=value=>Math.max(8,Math.min(farY,value));
  const centerX=target.x+target.w/2;
  const spots=[
    // 先往左：貼著人物的左邊 → 靠框的左緣（跟人物切齊）→ 左下角 → 左上角。
    {x:target.x-gap-cardW,y:target.y-6},
    {x:8,y:target.y-6},
    {x:8,y:farY},{x:8,y:8},
    // 左邊都閃不開才往右／上下。
    {x:target.x+target.w+gap,y:target.y-6},
    {x:farX,y:target.y-6},
    {x:centerX-cardW/2,y:target.y+target.h+gap},
    {x:centerX-cardW/2,y:target.y-gap-cardH},
    {x:farX,y:farY},{x:farX,y:8}
  ].map(spot=>{
    const box={x:clampX(spot.x),y:clampY(spot.y),w:cardW,h:cardH};
    const cost=overlapArea(box,targetFace)*200+overlapArea(box,target)*20
      +otherFaces.reduce((sum,face)=>sum+overlapArea(box,face),0);
    return {box,cost};
  });
  // 差一點點不算差（避免為了幾十個 px² 就把卡片甩到很遠的角落），同分就選最左邊的。
  const best=spots.reduce((a,b)=>{
    const rank=Math.round(a.cost/400)-Math.round(b.cost/400);
    if(rank!==0)return rank>0?b:a;
    return b.box.x<a.box.x?b:a;
  });
  card.style.left=Math.round(best.box.x)+'px';card.style.top=Math.round(best.box.y)+'px';
}
// 點技能膠囊：把設計種類、階段與設計負責人帶進設計需求表單。嵌進系統裡時用 postMessage 請
// 外層處理（父子同源，只收自己這個站的訊息）；單獨開遊戲時沒有表單可填，就只提示一下。
$('cardSkills').addEventListener('click',event=>{
  const button=event.target.closest('[data-skill]');
  if(!button||selected===null)return;
  const designer=people[selected].name,skill=button.dataset.skill;
  if(embedMode&&window.parent!==window){
    window.parent.postMessage({type:'pixelOfficeSkill',designer,skill},location.origin);
    toast(`已帶入 ${designer} · ${skill}`);
    return;
  }
  toast(`${designer} 的專長：${skill}`);
});
$('personCardClose').onclick=()=>select(null);
function updateCount(){$('count').textContent=$('message').value.length+' / 60';}
function updateStateText(){if(selected===null)return;const p=people[selected],effective=effectiveStatusId(p),status=statuses.find(item=>item.id===effective),mood=moods.find(item=>item.id===p.mood);$('moodStatus').textContent=effective!=='present'?status.text:mood?mood.text:'自在工作中';}
function updateMood(){if(selected===null)return;updateStateText();document.querySelectorAll('[data-mood]').forEach(b=>{const active=b.dataset.mood===people[selected].mood;b.classList.toggle('active',active);b.setAttribute('aria-pressed',String(active));});}
function setMood(id){if(selected===null)return;people[selected].mood=id;updateMood();save();pushChange(selected,{mood:id});}
function updateStatus(){if(selected===null)return;updateStateText();const effective=effectiveStatusId(people[selected]);document.querySelectorAll('[data-status]').forEach(b=>{const active=b.dataset.status===effective;b.classList.toggle('active',active);b.setAttribute('aria-pressed',String(active));});portrait($('portrait').getContext('2d'),selected);}
function setStatus(id){if(selected===null)return;const p=people[selected];p.status=id;if(isAway(p))keys.clear();updateStatus();save();pushChange(selected,{status:id});toast(id==='present'?p.name+' 回到座位':p.name+' · '+statuses.find(status=>status.id===id).text);}
function refreshRosterPortraits(){
  if(!ready)return;
  document.querySelectorAll('.roster-button canvas:not([data-symbol])').forEach((canvas,i)=>portrait(canvas.getContext('2d'),i,false));
  if(selected!==null)portrait($('portrait').getContext('2d'),selected);
}
function renderLookPanel(){
  const outfitBox=$('lookOutfits');if(!outfitBox||selected===null||!wardrobeReady())return;
  loadAccessories();const look=effectiveLook(selected),choices=outfitChoices(selected);
  // 衣服只有 Anna 可以換（藍色與黃色兩套），其他人的衣服固定，整個「服裝」區就不顯示。
  $('lookOutfitGroup').hidden=!choices;
  if(choices)outfitBox.replaceChildren(...choices.map(o=>{
    const label=o===1?'藍色':'黃色',button=document.createElement('button');button.type='button';button.title=label;button.className=look.outfit===o?'active':'';
    const canvas=document.createElement('canvas');canvas.width=120;canvas.height=120;
    const frame=buildWardrobe(selected,0,{outfit:o,cap:'',glasses:''}),k=Math.min(112/frame.canvas.height,112/frame.canvas.width);
    canvas.getContext('2d').drawImage(frame.canvas,60-frame.canvas.width*k/2,116-frame.canvas.height*k,frame.canvas.width*k,frame.canvas.height*k);
    button.append(canvas,label);button.onclick=()=>setLook({outfit:o});return button;
  }));
  const chips=(host,list,current,rowOf,key)=>host.replaceChildren(...list.map(item=>{
    const button=document.createElement('button');button.type='button';button.className=current===item.id?'active':'';
    if(item.id&&accessoriesReady()){const canvas=document.createElement('canvas');canvas.width=88;canvas.height=52;const meta=rowOf(item.id)[0],k=Math.min(84/meta.w,48/meta.h);canvas.getContext('2d').drawImage(wardrobeSheets.acc,meta.x,meta.y,meta.w,meta.h,44-meta.w*k/2,26-meta.h*k/2,meta.w*k,meta.h*k);button.append(canvas);}
    button.append(item.label);button.onclick=()=>setLook({[key]:item.id});return button;
  }));
  chips($('lookCaps'),WARDROBE_CAPS,look.cap,id=>WARDROBE.caps[id==='blue'?1:0],'cap');
  chips($('lookGlasses'),WARDROBE_GLASSES,look.glasses,id=>WARDROBE.glasses[id==='sun'?1:0],'glasses');
  $('lookReset').hidden=sameLook(look,lookDefault(selected));
}
function setLook(patch){
  const i=selected;if(i===null)return;
  const next={...effectiveLook(i),...patch},isDefault=sameLook(next,lookDefault(i));
  people[i].look=isDefault?null:next;markDirty();save();renderLookPanel();refreshRosterPortraits();
  pushChange(i,{look:isDefault?'':next});
}
if($('lookReset'))$('lookReset').onclick=()=>{if(selected===null)return;people[selected].look=null;markDirty();save();renderLookPanel();refreshRosterPortraits();pushChange(selected,{look:''});};
// ───────── 動作（閃身步）─────────
/** 「動作」區：只有這個人有可以用的動作時才顯示（目前只有 Machi）。 */
function renderActionPanel(){
  const section=$('actionSection'),list=$('actionList');if(!section||!list)return;
  const ids=selected===null?[]:Object.keys(WARDROBE_ACTIONS).filter(id=>WARDROBE_ACTIONS[id].who.includes(selected));
  section.hidden=!ids.length;if(!ids.length)return;
  ids.forEach(loadActionSheet);
  list.replaceChildren(...ids.map(id=>{
    const def=WARDROBE_ACTIONS[id],button=document.createElement('button');button.type='button';const cur=actionOf(selected);button.className=cur&&cur.id===id?'active':'';
    const canvas=document.createElement('canvas');canvas.width=88;canvas.height=60;
    if(actionImgReady(def)){const f=def.frames[0],k=Math.min(84/f.w,56/f.h);canvas.getContext('2d').drawImage(def.img,f.x,f.y,f.w,f.h,44-f.w*k/2,58-f.h*k,f.w*k,f.h*k);}
    button.append(canvas,def.label);button.onclick=()=>toggleAction(id);return button;
  }));
}
function toggleAction(id){
  const i=selected;if(i===null||!WARDROBE_ACTIONS[id]||!WARDROBE_ACTIONS[id].who.includes(i))return;
  const cur=actionOf(i);
  if(cur&&cur.id===id){people[i].action=null;markDirty();renderActionPanel();pushChange(i,{action:''});return;}// 正在播放：再按一次停止
  loadActionSheet(id);people[i].action={id,at:Date.now()};markDirty();
  renderActionPanel();
  pushChange(i,{action:{id}}).then(data=>{if(data&&data.person&&data.person.action)people[i].action={id,at:Number(data.person.action.at)||Date.now()};});
}
// ───────── 音樂（現在正在聽的歌）─────────
// 貼 Spotify 單曲或 Apple Music 網址分享：頭上戴耳機並跟著點頭、浮動音符；原本對話框的位置改成跑馬燈歌名
// （左邊有播放小三角形，點歌名開網頁）。資料跟心情一樣存在後端、所有人都看得到。
const headphones=new Image(),headphonesSide=new Image();const HP_SIDE_SRC_W=160,HP_SIDE_CX=80,HP_SIDE_CY=205,HP_SIDE_D=30;// 側面耳機素材（單個耳罩＋頭帶，160x281）：耳罩圓心在 (80,205)，直徑約 160；HP_SIDE_D 是畫在人物身上的耳罩直徑（畫面像素）
headphonesSide.onload=()=>markDirty();
function ensureHeadphones(){if(!headphones.getAttribute('src'))headphones.src='assets/headphones-static-v1.webp?v=1';if(!headphonesSide.getAttribute('src'))headphonesSide.src='assets/headphones-side-v1.webp?v=1';}// 有人在聽音樂（或開編輯畫面）才載，平常進站不用下載
headphones.onload=()=>{markDirty();drawMusicIcon();};
const HP_FRAME_W=300,HP_FRAME_H=207,HP_FRAMES=1,HP_SPAN_W=204,HP_CHIN_UP=43.4,HP_DX_NAT=-3,HP_DY=[0,0,0,0,8],MUSIC_BUBBLE_W=190,MUSIC_LIFT=8;// 耳機相對人物腳底的位置：使用者說偏右上，往左下收一點
function musicOf(p){return p&&p.music&&p.music.url?p.music:null;}// function 宣告：腳本最前面的 syncViewLayout() 就會用到
function drawMusicIcon(){const canvas=$('musicIcon');if(!canvas||!headphones.naturalWidth)return;const c=canvas.getContext('2d');c.clearRect(0,0,canvas.width,canvas.height);c.drawImage(headphones,0,0,HP_FRAME_W,HP_FRAME_H,0,0,canvas.width,canvas.width*HP_FRAME_H/HP_FRAME_W);}
// 跟主系統「設計師設定」的分享音樂同一套判斷：Spotify 只收單曲，Apple Music 抓歌曲 id。
function musicInfo(value){const text=String(value||'').trim();if(!text)return null;try{const parsed=new URL(text);if(parsed.protocol!=='https:')return null;
  if(parsed.hostname==='open.spotify.com'){// 單曲、專輯、歌單，以及 Podcast 的節目與單集（網址可能帶 intl-xx 之類的前綴）
    const match=parsed.pathname.match(/^\/(?:intl-[a-z-]+\/)?(?:embed\/)?(track|album|playlist|show|episode)\/([A-Za-z0-9]{22})(?:\/|$)/);
    return match?{provider:'spotify',label:'Spotify',kind:match[1],id:match[2],url:`https://open.spotify.com/${match[1]}/${match[2]}`}:null;}
  if(parsed.hostname==='music.apple.com'){const parts=parsed.pathname.split('/').filter(Boolean),storefront=String(parts[0]||'us').toLowerCase(),pathId=[...parts].reverse().find(part=>/^\d+$/.test(part))||'',id=String(parsed.searchParams.get('i')||pathId);if(!/^[a-z]{2}$/.test(storefront)||!/^\d+$/.test(id))return null;return {provider:'apple',label:'Apple Music',id,storefront,url:`https://music.apple.com/${storefront}${parsed.pathname.slice(1+parts[0].length)}${parsed.search}`};}
  return null;}catch{return null;}}
// 分享的是什麼：跑馬燈歌名前面的小標。單曲用 ♪，其他標明種類，大家一看就知道不是單曲。
const MUSIC_KIND_PREFIX={track:'♪ ',album:'♪ 專輯 · ',playlist:'♪ 歌單 · ',show:'🎙 Podcast · ',episode:'🎙 Podcast · '};
const musicPrefix=music=>{const info=musicInfo(music.url);return MUSIC_KIND_PREFIX[info&&info.kind]||'♪ ';};
const musicMetaCache=new Map();
async function musicMetadata(info){
  const key=`${info.provider}:${info.id}`;if(musicMetaCache.has(key))return musicMetaCache.get(key);
  let meta={title:info.kind&&info.kind!=='track'?`${info.label} ${({album:'專輯',playlist:'歌單',show:'Podcast 節目',episode:'Podcast 單集'})[info.kind]||''}`.trim():`${info.label} 單曲`,previewUrl:''};
  try{
    if(info.provider==='spotify'){const response=await fetch(`https://open.spotify.com/oembed?url=${encodeURIComponent(info.url)}`);if(response.ok){const data=await response.json();meta.title=String(data.title||'').trim()||meta.title;}}
    else{const response=await fetch(`https://itunes.apple.com/lookup?id=${encodeURIComponent(info.id)}&country=${encodeURIComponent(info.storefront||'us')}`);if(response.ok){const data=await response.json(),track=(data.results||[]).find(item=>String(item.trackId||'')===info.id)||data.results?.[0];if(track)meta={title:[track.trackName,track.artistName].filter(Boolean).join(' - ')||meta.title,previewUrl:String(track.previewUrl||'')};}}
  }catch{}
  musicMetaCache.set(key,meta);return meta;
}
function updateMusicPanel(){
  ensureHeadphones();
  const toggle=$('musicToggle');if(!toggle||selected===null)return;
  const music=musicOf(people[selected]);
  toggle.classList.toggle('is-sharing',Boolean(music));$('musicNow').textContent=music?`正在分享：${music.title}`:'分享現在正在聽的歌';
  $('musicClear').hidden=!music;if(document.activeElement!==$('musicUrl'))$('musicUrl').value=music?music.url:'';
}
function setMusicHint(message,isError=false){const hint=$('musicHint');hint.textContent=message;hint.classList.toggle('is-error',isError);}
if($('musicToggle')){
  $('musicToggle').onclick=()=>{const open=$('musicPanel').hidden;$('musicPanel').hidden=!open;$('musicToggle').setAttribute('aria-expanded',String(open));if(open)$('musicUrl').focus();};
  $('musicSave').onclick=async()=>{
    const index=selected;if(index===null)return;
    const info=musicInfo($('musicUrl').value);
    if(!info){setMusicHint('網址看不懂：請貼 Spotify（單曲、專輯、歌單、Podcast）或 Apple Music 歌曲的網址。',true);return;}
    $('musicSave').disabled=true;setMusicHint('正在查歌名…');
    try{
      const meta=await musicMetadata(info);
      people[index].music={url:info.url,provider:info.provider,title:meta.title};markDirty();save();updateMusicPanel();
      await pushChange(index,{music:{url:info.url,title:meta.title}});
      setMusicHint('已分享！頭上會戴耳機，大家點歌名可以開網頁。');toast('正在分享：'+meta.title);
    }finally{$('musicSave').disabled=false;}
  };
  $('musicClear').onclick=()=>{const index=selected;if(index===null)return;people[index].music=null;if(musicPlaying.i===index)stopMusic();markDirty();save();updateMusicPanel();pushChange(index,{music:''});setMusicHint('已停止分享。');};
}
// 播放：Apple Music 播 30 秒試聽；Spotify 打開 Spotify 官方的小播放器（右下角），因為瀏覽器只允許在使用者點擊後播放。
let musicPlaying={i:-1,paused:true,audio:null,controller:null};
const isMusicPlaying=i=>musicPlaying.i===i&&!musicPlaying.paused;
function stopMusic(){
  if(musicPlaying.audio){musicPlaying.audio.pause();}
  const dock=$('spotifyDock');if(dock){dock.hidden=true;dock.querySelector('.dock-host').replaceChildren();}
  musicPlaying={i:-1,paused:true,audio:null,controller:null};markDirty();
}
let spotifyApiPromise=null;
function spotifyApi(){return spotifyApiPromise||(spotifyApiPromise=new Promise((resolve,reject)=>{window.onSpotifyIframeApiReady=api=>resolve(api);const tag=document.createElement('script');tag.src='https://open.spotify.com/embed/iframe-api/v1';tag.async=true;tag.onerror=()=>{spotifyApiPromise=null;reject(Error('無法載入 Spotify 播放器'));};document.head.append(tag);}));}
// Spotify 官方播放器必須「存在於頁面上」才會出聲，但畫面上看不到（樣式是透明、不吃點擊）；播放／暫停都用人物頭上的綠色小鈕。
// 先預載 Spotify 播放器程式，點播放鈕時才來得及在「使用者剛點擊」的有效時間內開始播——但要等到使用者第一次有動作才載
// （約 100 KB、兩個請求），進站時不搶頻寬；嵌入畫面沒人動就完全不載。
let spotifyWanted=false,userTouched=false;
function wantSpotifyApi(){spotifyWanted=true;if(userTouched)spotifyApi().catch(()=>{});}
['pointermove','pointerdown','touchstart','keydown'].forEach(type=>window.addEventListener(type,()=>{userTouched=true;if(spotifyWanted)spotifyApi().catch(()=>{});},{once:true,passive:true}));
function ensureSpotifyDock(){let dock=$('spotifyDock');if(dock)return dock;dock=document.createElement('div');dock.id='spotifyDock';dock.innerHTML='<div class="dock-host"></div>';dock.setAttribute('aria-hidden','true');document.body.append(dock);return dock;}
async function toggleMusic(i){
  const music=musicOf(people[i]),info=music&&musicInfo(music.url);if(!info)return;
  if(musicPlaying.i===i){
    if(musicPlaying.audio){if(musicPlaying.paused){await musicPlaying.audio.play();musicPlaying.paused=false;}else{musicPlaying.audio.pause();musicPlaying.paused=true;}markDirty();return;}
    if(musicPlaying.controller){if(!musicPlaying.started||musicPlaying.paused)musicPlaying.controller.play();else musicPlaying.controller.pause();return;}
  }
  stopMusic();
  try{
    if(info.provider==='apple'){
      const meta=await musicMetadata(info);
      if(!meta.previewUrl){window.open(info.url,'_blank','noopener');return;}
      const audio=new Audio(meta.previewUrl);audio.onended=stopMusic;await audio.play();
      musicPlaying={i,paused:false,audio,controller:null};markDirty();
    }else{
      const api=await spotifyApi(),dock=ensureSpotifyDock(),host=dock.querySelector('.dock-host'),target=document.createElement('div');
      host.replaceChildren(target);dock.hidden=false;musicPlaying={i,paused:false,started:false,audio:null,controller:null};markDirty();
      setTimeout(()=>{if(musicPlaying.i===i&&!musicPlaying.started)toast('瀏覽器擋住了自動播放，請再按一次綠色播放鍵。');},3000);
      api.createController(target,{uri:`spotify:${info.kind}:${info.id}`,width:'100%',height:80},controller=>{
        if(musicPlaying.i!==i)return;musicPlaying.controller=controller;
        controller.addListener('ready',()=>{controller.play();setTimeout(()=>{if(musicPlaying.i===i&&!musicPlaying.started)controller.resume&&controller.resume();},800);});
        controller.addListener('playback_update',event=>{if(musicPlaying.i!==i)return;musicPlaying.paused=Boolean(event.data&&event.data.isPaused);if(!musicPlaying.paused)musicPlaying.started=true;markDirty();});
      });
    }
  }catch(err){stopMusic();toast('無法播放：'+(err&&err.message?err.message:'請點歌名到網頁收聽'));}
}
// ───────── 限時動態 ─────────
// 貼出後 24 小時自動下架（後端負責），可以按讚、留言，互動紀錄會同步到資料庫後台的 REELS。
// 人物右上角只放一顆像素風訊息氣泡：有動態才出現，有沒看過的就多一顆綠色提示點。
const STORY_SECONDS=6,STORY_MAX_ACTIVE=5;
let stories=[],storiesLoaded=false,storiesKey='',storySeen=new Set(),hoverStory=-1;
try{storySeen=new Set(JSON.parse(localStorage.getItem('pixel-story-seen')||'[]'));}catch{}
const storiesOf=name=>stories.filter(story=>story.name===name);
const storyUnread=name=>storiesOf(name).some(story=>!storySeen.has(story.id));
const storyReducedMotion=window.matchMedia?matchMedia('(prefers-reduced-motion: reduce)'):{matches:false};
function markStorySeen(id){if(storySeen.has(id))return;storySeen.add(id);pruneStorySeen();markDirty();}
function pruneStorySeen(){if(storiesLoaded){const live=new Set(stories.map(story=>story.id));storySeen=new Set([...storySeen].filter(id=>live.has(id)));}try{localStorage.setItem('pixel-story-seen',JSON.stringify([...storySeen]));}catch{}}
// 按讚與留言記在「登入前台的人」名下：外層系統用 postMessage 把登入者（名字＋session token）交過來，
// 只放記憶體、不存起來；後端靠 token 認人。沒登入（或直接開這個網頁）只能看，不能互動。
let storyIdentity={name:'',token:''};
const storyLoggedIn=()=>Boolean(storyIdentity.name&&storyIdentity.token);
window.addEventListener('message',event=>{
  if(event.origin!==location.origin||event.source!==window.parent)return;
  const data=event.data;if(!data||data.type!=='pixelOfficeViewer')return;
  storyIdentity={name:String(data.name||''),token:String(data.token||'')};
  if(storyOpen())refreshStoryViewer();
});
if(window.parent!==window)try{window.parent.postMessage({type:'pixelOfficeViewerRequest'},location.origin);}catch{}
function storyTimeLeft(story){const minutes=Math.max(0,Math.ceil((story.expiresAt-Date.now())/60000));return minutes>=60?`還剩 ${Math.floor(minutes/60)} 小時 ${minutes%60} 分`:`還剩 ${minutes} 分`;}// 只給自己的動態清單用；動態視窗裡不顯示倒數
function applyStories(list){
  if(!Array.isArray(list))return;
  const key=JSON.stringify(list);if(storiesLoaded&&key===storiesKey)return;
  storiesKey=key;stories=list;storiesLoaded=true;pruneStorySeen();markDirty();renderMyStories();
  if(storyOpen())refreshStoryViewer();
}
function renderMyStories(){
  const box=$('storyMine'),upload=$('storyUpload');if(!box||selected===null)return;
  const mine=storiesOf(people[selected].name);
  upload.hidden=mine.length>=STORY_MAX_ACTIVE;
  $('storyHint').textContent=mine.length?`目前 ${mine.length} / ${STORY_MAX_ACTIVE} 則`:'貼出後 24 小時自動下架，可以按讚與留言';
  box.replaceChildren(...mine.map(story=>{
    const row=document.createElement('div');row.className='story-mine-row';
    const open=document.createElement('button');open.type='button';open.className='story-mine-thumb';open.setAttribute('aria-label','查看這則動態');
    const img=document.createElement(story.mediaType==='video'?'video':'img');if(story.mediaType==='video'){img.muted=true;img.preload='metadata';img.src=story.imageUrl+'#t=0.1';}else{img.alt='';img.loading='lazy';img.src=story.imageUrl;}open.append(img);
    open.onclick=()=>openStory(selected,story.id);
    const info=document.createElement('div');info.className='story-mine-info';
    info.innerHTML=`<strong>${storyTimeLeft(story)}</strong><span>♥ ${story.likes.length} · 留言 ${story.comments.length} · 已讀 ${story.viewerCount}</span>`;
    const remove=document.createElement('button');remove.type='button';remove.className='text-button';remove.textContent='移除';
    remove.onclick=async()=>{if(!confirm('要提前下架這則動態嗎？'))return;try{const data=await syncCall({action:'pixelOfficeStoryRemove',id:story.id});applyStories(data.stories);}catch(err){toast('移除失敗：'+err.message);}};
    row.append(open,info,remove);return row;
  }));
}
setInterval(()=>{if(selected!==null&&stories.length)renderMyStories();},30000);

// 像素氣泡：18 × 13 格，白底、深灰外框、三個品牌綠點（#008214），尾巴朝左下。
const STORY_SPRITE=['...############...','..#wwwwwwwwwwww#..','.#wwwwwwwwwwwwww#.','#wwwwwwwwwwwwwwww#','#wwwwwwwwwwwwwwww#','#wwggwwwggwwwggww#','#wwggwwwggwwwggww#','#wwwwwwwwwwwwwwww#','.#wwwwwwwwwwwwww#.','..#wwwwwwwwwwww#..','...#ww#########...','..#w#.............','..##..............'].map(row=>row.padEnd(18,'.'));
const STORY_DOT=['..###..','.#ggg#.','#ggggg#','#ggggg#','#ggggg#','.#ggg#.','..###..'];
const STORY_COLORS={'#':'#25272b',w:'#ffffff',g:'#008214'};
const STORY_CELL=3,STORY_W=18*STORY_CELL,STORY_H=13*STORY_CELL;
function drawSprite(rows,x,y,cell){rows.forEach((row,r)=>{for(let c=0;c<row.length;c++){const color=STORY_COLORS[row[c]];if(!color)continue;ctx.fillStyle=color;ctx.fillRect(Math.round(x+c*cell),Math.round(y+r*cell),Math.ceil(cell),Math.ceil(cell));}});}
/** 氣泡放在頭的右上方，各人物位置與大小一致；心情圖示改放左邊，不互相遮擋。 */
function storyBubbleBox(p){return {x:Math.round(p.x+38),y:Math.round(p.y-152),w:STORY_W,h:STORY_H};}
function drawStoryBubble(i,time){
  const p=viewPeople[i];if(!storiesOf(p.name).length)return;
  const box=storyBubbleBox(p),unread=storyUnread(p.name),hover=hoverStory===i;
  const phase=(time/1000)%4.6,hop=unread&&!storyReducedMotion.matches&&phase<.5?Math.sin(phase/.5*Math.PI)*5:0;
  const scale=hover?1.14:1,cx=box.x+box.w/2,cy=box.y+box.h/2-hop;
  ctx.save();ctx.translate(cx,cy);ctx.scale(scale,scale);ctx.translate(-box.w/2,-box.h/2);
  ctx.shadowColor='rgba(10,22,44,.28)';ctx.shadowBlur=shadowBlurFor(6);ctx.shadowOffsetY=2;
  drawSprite(STORY_SPRITE,0,0,STORY_CELL);
  ctx.shadowColor='transparent';
  if(unread)drawSprite(STORY_DOT,box.w-9,-7,2.4);
  ctx.restore();
  hits.push({type:'story',i,x:box.x-6,y:box.y-8,w:box.w+12,h:box.h+14});
}
const storyTip=document.createElement('div');storyTip.id='storyTip';storyTip.hidden=true;document.body.append(storyTip);
function showStoryTip(i,clientX,clientY){storyTip.textContent=`查看 ${people[i].name} 的動態`;storyTip.hidden=false;const w=storyTip.offsetWidth;storyTip.style.left=Math.max(6,Math.min(innerWidth-w-6,clientX-w/2))+'px';storyTip.style.top=Math.max(6,clientY-40)+'px';}
function setHoverStory(i,event){
  if(hoverStory!==i){hoverStory=i;markDirty();}
  if(i<0||!event||event.pointerType==='touch')storyTip.hidden=true;else showStoryTip(i,event.clientX,event.clientY);
}

// ── 動態視窗：類似 Reels，每則顯示 STORY_SECONDS 秒並倒數，可以按讚與留言 ──
const viewer=$('storyViewer');let viewerState={name:'',id:'',elapsed:0,paused:false,timer:0,lastTick:0};
const storyOpen=()=>viewer&&viewer.open;
function openStory(i,startId){
  const name=people[i].name,list=storiesOf(name);if(!list.length)return;
  keys.clear();setHoverStory(-1);
  viewerState={name,id:(list.find(story=>story.id===startId)||list.find(story=>!storySeen.has(story.id))||list[0]).id,elapsed:0,paused:false,timer:0,lastTick:0};
  if(!viewer.open)viewer.showModal();
  showStory();startStoryTimer();
}
function currentStory(){return storiesOf(viewerState.name).find(story=>story.id===viewerState.id)||null;}
function storyIndex(){return storiesOf(viewerState.name).findIndex(story=>story.id===viewerState.id);}
function showStory(){
  const list=storiesOf(viewerState.name),story=currentStory();
  if(!story){closeStory();return;}
  viewerState.elapsed=0;
  $('svName').textContent=viewerState.name;
  const image=$('svImage'),video=$('svVideo'),isVideo=story.mediaType==='video';
  viewerState.videoFailed=false;image.hidden=isVideo;video.hidden=!isVideo;$('svMute').hidden=!isVideo;
  if(isVideo){
    video.onerror=()=>{viewerState.videoFailed=true;toast('這則影片無法播放。');};
    video.muted=viewerState.muted!==false;$('svMute').textContent=video.muted?'開聲音':'靜音';
    video.src=story.imageUrl;video.currentTime=0;video.play().catch(()=>{});
    image.removeAttribute('src');
  }else{video.pause();video.removeAttribute('src');video.load();if(image.getAttribute('src')!==story.imageUrl)image.src=story.imageUrl;}
  $('svProgress').replaceChildren(...list.map(item=>{const seg=document.createElement('i');seg.dataset.id=item.id;seg.append(document.createElement('b'));return seg;}));
  renderStoryProgress();refreshStoryViewer();
  markStorySeen(story.id);
  if(storyLoggedIn())syncCall({action:'pixelOfficeStoryView',id:story.id,token:storyIdentity.token}).catch(()=>{});
}
/** 按讚、留言、名單變動時只更新互動區，不重新開始倒數。 */
function refreshStoryViewer(){
  const story=currentStory();if(!story){if(storyOpen()){const list=storiesOf(viewerState.name);if(list.length){viewerState.id=list[0].id;showStory();}else closeStory();}return;}
  const liked=storyLoggedIn()&&story.likes.includes(storyIdentity.name),locked=!storyLoggedIn();
  $('svLike').classList.toggle('is-active',liked);$('svLike').classList.toggle('is-locked',locked);$('svInput').disabled=locked;$('svForm').querySelector('button').disabled=locked;$('svInput').placeholder=locked?'登入前台帳號後才能留言':'留言…';$('svLike').setAttribute('aria-pressed',liked);$('svLikeCount').textContent=story.likes.length;
  $('svLike').title=story.likes.length?'按讚：'+story.likes.join('、'):'按讚';
  const box=$('svComments'),atEnd=box.scrollHeight-box.scrollTop-box.clientHeight<24;
  box.replaceChildren(...story.comments.map(comment=>{const row=document.createElement('p');const name=document.createElement('strong');name.textContent=comment.name;row.append(name,' '+comment.text);return row;}));
  box.hidden=!story.comments.length;if(atEnd)box.scrollTop=box.scrollHeight;
}
/** 影片播多久就是多久（最多 30 秒）；照片與 GIF 固定 STORY_SECONDS。 */
function storyDuration(){const video=$('svVideo');if(video.hidden||viewerState.videoFailed)return STORY_SECONDS;return Number.isFinite(video.duration)&&video.duration>0?Math.min(video.duration,30):30;}
function renderStoryProgress(){
  const list=storiesOf(viewerState.name),at=storyIndex(),fraction=Math.min(1,viewerState.elapsed/storyDuration());
  [...$('svProgress').children].forEach((seg,n)=>{seg.firstChild.style.transform=`scaleX(${n<at?1:n===at?fraction:0})`;});
  $('svPaused').hidden=!viewerState.paused;
  $('svPosition').textContent=list.length>1?`${at+1} / ${list.length}`:'';
}
function startStoryTimer(){
  clearInterval(viewerState.timer);viewerState.lastTick=performance.now();
  viewerState.timer=setInterval(()=>{
    const now=performance.now(),dt=(now-viewerState.lastTick)/1000;viewerState.lastTick=now;
    if(viewerState.paused||document.hidden||!storyOpen())return;
    const video=$('svVideo');
    if(!video.hidden&&!viewerState.videoFailed){viewerState.elapsed=video.currentTime;if(video.ended)stepStory(1);else renderStoryProgress();return;}
    viewerState.elapsed+=dt;
    if(viewerState.elapsed>=STORY_SECONDS)stepStory(1);else renderStoryProgress();
  },100);
}
function stepStory(delta){
  const list=storiesOf(viewerState.name),next=storyIndex()+delta;
  if(next>=list.length){closeStory();return;}
  if(next<0){viewerState.elapsed=0;renderStoryProgress();return;}
  viewerState.id=list[next].id;showStory();
}
function stopStoryVideo(){const video=$('svVideo');video.pause();video.removeAttribute('src');video.load();}
function closeStory(){clearInterval(viewerState.timer);stopStoryVideo();if(viewer.open)viewer.close();}
function pauseStory(value){if(viewerState.paused===value)return;viewerState.paused=value;const video=$('svVideo');if(!video.hidden){if(value)video.pause();else video.play().catch(()=>{});}renderStoryProgress();}
if(viewer){
  $('svClose').onclick=closeStory;$('svPrev').onclick=()=>stepStory(-1);$('svNext').onclick=()=>stepStory(1);
  viewer.addEventListener('close',()=>{clearInterval(viewerState.timer);stopStoryVideo();markDirty();});
  $('svMute').onclick=()=>{const video=$('svVideo');video.muted=!video.muted;viewerState.muted=video.muted;$('svMute').textContent=video.muted?'開聲音':'靜音';};
  viewer.addEventListener('cancel',()=>clearInterval(viewerState.timer));
  viewer.onclick=e=>{if(e.target===viewer)closeStory();};
  // 想慢慢看：滑鼠停在畫面上、正在打字、或按住畫面都會暫停倒數。
  const media=$('svMedia');media.addEventListener('pointerenter',e=>{if(e.pointerType==='mouse')pauseStory(true);});media.addEventListener('pointerleave',e=>{if(e.pointerType==='mouse'&&document.activeElement!==$('svInput'))pauseStory(false);});
  media.addEventListener('pointerdown',e=>{if(e.pointerType!=='mouse')pauseStory(true);});['pointerup','pointercancel'].forEach(type=>media.addEventListener(type,e=>{if(e.pointerType!=='mouse')pauseStory(false);}));
  $('svInput').addEventListener('focus',()=>pauseStory(true));$('svInput').addEventListener('blur',()=>pauseStory(false));
  const needLogin=()=>{if(!storyLoggedIn())toast('請先登入前台帳號，才能按讚與留言。');return storyLoggedIn();};
  $('svLike').onclick=async()=>{const story=currentStory();if(!story||!needLogin())return;try{applyStories((await syncCall({action:'pixelOfficeStoryReact',id:story.id,token:storyIdentity.token})).stories);}catch(err){toast('按讚失敗：'+err.message);}};
  $('svForm').onsubmit=async e=>{e.preventDefault();const story=currentStory(),input=$('svInput'),body=input.value.trim();if(!story||!body||!needLogin())return;input.disabled=true;try{const data=await syncCall({action:'pixelOfficeStoryComment',id:story.id,token:storyIdentity.token,text:body});input.value='';applyStories(data.stories);$('svComments').scrollTop=$('svComments').scrollHeight;}catch(err){toast('留言失敗：'+err.message);}finally{input.disabled=!storyLoggedIn();input.focus();}};
  viewer.addEventListener('keydown',e=>{if(typing())return;if(e.key==='ArrowRight')stepStory(1);else if(e.key==='ArrowLeft')stepStory(-1);});
}
const pixelSymbols={
  sun:['001010100','000111000','101222101','012222210','112222211','012222210','101222101','000111000','001010100'],
  burst:['100010001','010111010','001222100','112222211','122222221','112222211','001222100','010111010','100010001'],
  drop:['000010000','000111000','000121000','001222100','012222210','012222210','012222210','001222100','000111000'],
  heart:['000000000','011001100','122112210','122222210','012222100','001221000','000110000','000100000','000000000'],
  person:['000111000','001222100','001222100','000111000','001222100','012222210','012222210','001101100','011000110'],
  power:['000010000','000020000','001020100','012000210','120000021','120000021','012000210','001222100','000111000'],
  toilet:['000111100','000122200','000111100','000001100','011111100','012222200','001222000','001111000','011001100'],
  plane:['000010000','000110000','000210000','111222111','022222220','000210000','001212100','010000010','000000000'],
  briefcase:['000111000','001222100','011111110','122222221','122112221','122112221','122222221','111111111','010000010'],
  calendar:['010000010','111111111','122222221','111111111','122121221','121212121','122121221','121212121','111111111']
};
const symbolPalettes={sun:['#e8a528','#ffe070'],burst:['#d94b3d','#ff9b45'],drop:['#3577be','#7bd2ff'],heart:['#c83366','#ff759d'],person:['#4a718e','#8fd0a8'],power:['#697786','#e8f0f5'],toilet:['#647a92','#e8f3f5'],plane:['#4c6f9d','#eef5ff'],briefcase:['#704d35','#e7a34c'],calendar:['#b44b63','#ffe3a3']};
function drawPixelSymbol(context,symbol,cx,cy,scale=4){const pattern=pixelSymbols[symbol],palette=symbolPalettes[symbol]||['#263d59','#fff'];if(!pattern)return;const width=pattern[0].length,height=pattern.length,startX=Math.round(cx-width*scale/2),startY=Math.round(cy-height*scale/2);context.save();context.imageSmoothingEnabled=false;pattern.forEach((row,y)=>[...row].forEach((cell,x)=>{if(cell==='0')return;context.fillStyle=palette[Number(cell)-1];context.fillRect(startX+x*scale,startY+y*scale,scale,scale);}));context.restore();}
const symbolCells={sun:0,burst:1,drop:2,heart:3,person:4,power:5,toilet:6,plane:7,briefcase:8};
const extraCells={meeting:0,bowl:1,calendar:2};// icons-status-v4.webp：3 格正方形（會議、用餐、休假），規則與 icons-v3 相同。
// icons-v3.webp：3×3 正方形格子（每格 192×192，原檔 icons-v3.png 每格 256），每個圖示已裁到實際範圍並置中留白，不會被切到或變形。
function drawSymbol(context,symbol,cx,cy,size=48){if(symbol==='moon'){drawMoonIcon(context,cx,cy,size);return;}
  // 會議、用餐與休假放在後來新增的 icons-status-v4（3 格），icons-v3 的 3×3 已經排滿。
  const extra=extraCells[symbol];
  if(extra!==undefined&&extraSheet.complete&&extraSheet.naturalWidth){const cell=extraSheet.naturalWidth/3;context.save();context.imageSmoothingEnabled=true;context.imageSmoothingQuality='high';context.drawImage(extraSheet,extra*cell,0,cell,cell,cx-size/2,cy-size/2,size,size);context.restore();return;}
  const index=symbolCells[symbol];if(iconSheet.complete&&iconSheet.naturalWidth&&index!==undefined){const cell=iconSheet.naturalWidth/3,row=Math.floor(index/3),column=index%3;context.save();context.imageSmoothingEnabled=true;context.imageSmoothingQuality='high';context.drawImage(iconSheet,column*cell,row*cell,cell,cell,cx-size/2,cy-size/2,size,size);context.restore();return;}drawPixelSymbol(context,symbol,cx,cy,Math.max(2,Math.floor(size/10)));}
// 加班圖示（月亮＋星星）：icons-v3 圖集 3×3 已經排滿，這個圖示改用程式繪製。先畫在一張離屏畫布上（月牙靠
// destination-out 挖出來，不會誤刪目標畫布上已經畫好的桌子），再整張貼上；每種尺寸只畫一次。
const moonIconCache=new Map();
function moonIconCanvas(size){const px=Math.max(8,Math.round(size)),key=px;if(moonIconCache.has(key))return moonIconCache.get(key);const scale=2,c=document.createElement('canvas');c.width=c.height=px*scale;const g=c.getContext('2d');g.scale(scale,scale);const cx=px*.46,cy=px*.52,r=px*.34;
  const fill=g.createLinearGradient(cx-r,cy-r,cx+r,cy+r);fill.addColorStop(0,'#ffe58a');fill.addColorStop(1,'#f2a93b');
  g.fillStyle=fill;g.beginPath();g.arc(cx,cy,r,0,Math.PI*2);g.fill();
  g.globalCompositeOperation='destination-out';g.beginPath();g.arc(cx+r*.5,cy-r*.32,r*.86,0,Math.PI*2);g.fill();g.globalCompositeOperation='source-over';
  g.strokeStyle='#b8741d';g.lineWidth=Math.max(1,px*.03);g.lineJoin='round';
  g.beginPath();g.arc(cx,cy,r,Math.PI*.42,Math.PI*1.18);g.stroke();
  const star=(x,y,rad)=>{g.fillStyle='#fff3b8';g.strokeStyle='#e0a030';g.lineWidth=Math.max(.8,px*.02);g.beginPath();for(let i=0;i<8;i+=1){const a=-Math.PI/2+i*Math.PI/4,d=i%2?rad*.42:rad;g[i?'lineTo':'moveTo'](x+Math.cos(a)*d,y+Math.sin(a)*d);}g.closePath();g.fill();g.stroke();};
  star(px*.78,px*.28,px*.13);star(px*.86,px*.62,px*.08);
  moonIconCache.set(key,c);return c;}
function drawMoonIcon(context,cx,cy,size){context.save();context.imageSmoothingEnabled=true;context.imageSmoothingQuality='high';context.drawImage(moonIconCanvas(size),cx-size/2,cy-size/2,size,size);context.restore();}
function iconCanvas(symbol,size=46){const canvas=document.createElement('canvas');canvas.width=size;canvas.height=size;canvas.dataset.symbol=symbol;drawSymbol(canvas.getContext('2d'),symbol,size/2,size/2,size);return canvas;}
function refreshIconCanvases(){document.querySelectorAll('canvas[data-symbol]').forEach(canvas=>{const context=canvas.getContext('2d');context.clearRect(0,0,canvas.width,canvas.height);drawSymbol(context,canvas.dataset.symbol,canvas.width/2,canvas.height/2,canvas.height);});}
names.forEach((name,i)=>{const b=document.createElement('button');b.className='roster-button';b.setAttribute('aria-label','選取 '+name);const c=document.createElement('canvas'),label=document.createElement('span'),level=document.createElement('span');c.width=110;c.height=150;label.className='roster-name';label.textContent=name;level.className='roster-level';level.textContent='Lv.'+levelStats[name].level;b.append(c,label,level);b.onclick=()=>{select(i);game.focus({preventScroll:true});};$('roster').append(b);});
moods.forEach(m=>{const b=document.createElement('button');b.dataset.mood=m.id;b.title=m.text;b.append(iconCanvas(m.symbol),document.createTextNode(m.label));b.onclick=()=>setMood(m.id);$('moods').append(b);});
statuses.forEach(status=>{const b=document.createElement('button');b.dataset.status=status.id;b.title=status.text;b.append(iconCanvas(status.symbol,40),document.createTextNode(status.label));b.onclick=()=>setStatus(status.id);$('statuses').append(b);});
$('neutral').onclick=()=>setMood('');$('message').oninput=updateCount;$('say').onclick=()=>{people[selected].message=$('message').value.trim();save();pushChange(selected,{message:people[selected].message});toast(people[selected].message?'對話已放到人物上方':'已清除對話');game.focus({preventScroll:true});};
// 上傳：照片縮到 1200 px；GIF 原檔（保留動畫，5 MB 內）；影片 30 秒內、10 MB 內——太大或是 iPhone 的 .mov
// （可能是別的瀏覽器放不出來的 HEVC）就在瀏覽器裡重新錄成 720p，再送出。
const STORY_GIF_MAX=5*1024*1024,STORY_VIDEO_MAX=10*1024*1024,STORY_VIDEO_SECONDS=30;
const readDataURL=blob=>new Promise((resolve,reject)=>{const reader=new FileReader();reader.onload=()=>resolve(reader.result);reader.onerror=()=>reject(Error('讀不到這個檔案'));reader.readAsDataURL(blob);});
const cleanDataURL=(dataUrl,mime)=>`data:${mime};base64,${dataUrl.slice(dataUrl.indexOf(',')+1)}`;
async function openVideo(url){
  const video=document.createElement('video');video.muted=true;video.playsInline=true;video.preload='auto';video.src=url;
  await new Promise((resolve,reject)=>{video.onloadedmetadata=resolve;video.onerror=()=>reject(Error('這個影片瀏覽器讀不出來，請改用 MP4（H.264）格式'));});
  return video;
}
async function shrinkVideo(video){
  const types=['video/mp4;codecs=avc1.42E01E','video/mp4','video/webm;codecs=vp9','video/webm;codecs=vp8','video/webm'];
  const mime=window.MediaRecorder&&types.find(type=>MediaRecorder.isTypeSupported(type));
  const canvas=document.createElement('canvas');
  if(!mime||!canvas.captureStream)throw Error('這個瀏覽器無法壓縮影片，請先在手機上剪短到 10 MB 以內');
  const scale=Math.min(1,720/Math.max(video.videoWidth,video.videoHeight));
  canvas.width=Math.max(2,Math.round(video.videoWidth*scale/2)*2);canvas.height=Math.max(2,Math.round(video.videoHeight*scale/2)*2);
  const context=canvas.getContext('2d'),chunks=[],recorder=new MediaRecorder(canvas.captureStream(30),{mimeType:mime,videoBitsPerSecond:2000000});
  recorder.ondataavailable=e=>{if(e.data.size)chunks.push(e.data);};
  const stopped=new Promise(resolve=>{recorder.onstop=resolve;});
  video.currentTime=0;recorder.start(500);try{await video.play();}catch{recorder.stop();throw Error('影片處理被中斷，請留在這個分頁、不要切換視窗，再試一次。');}
  let over=false;
  await new Promise(resolve=>{video.onended=resolve;setTimeout(resolve,(STORY_VIDEO_SECONDS+2)*1000);const timer=setInterval(()=>{if(video.ended||over){clearInterval(timer);return;}context.drawImage(video,0,0,canvas.width,canvas.height);},33);});// 用 setInterval 而不是 rAF：切到別的分頁時 rAF 會停
  over=true;video.pause();recorder.stop();await stopped;
  return new Blob(chunks,{type:mime.split(';')[0]});
}
$('storyFile').onchange=async e=>{
  const file=e.target.files[0],index=selected;e.target.value='';if(!file||index===null)return;
  const type=file.type,url=URL.createObjectURL(file);
  try{
    let media;
    if(type==='image/gif'){
      if(file.size>STORY_GIF_MAX)throw Error('GIF 太大，請選 5 MB 以下的檔案。');
      media=cleanDataURL(await readDataURL(file),'image/gif');
    }else if(['video/mp4','video/quicktime','video/webm'].includes(type)){
      const video=await openVideo(url);
      if(Number.isFinite(video.duration)&&video.duration>STORY_VIDEO_SECONDS+.5)throw Error(`影片太長，請剪到 ${STORY_VIDEO_SECONDS} 秒以內。`);
      let blob=file,mime=type;
      if(file.size>STORY_VIDEO_MAX||type==='video/quicktime'){toast('影片處理中，需要跟影片一樣長的時間，請稍候…');blob=await shrinkVideo(video);mime=blob.type;}
      if(blob.size>STORY_VIDEO_MAX)throw Error('影片壓縮後還是太大，請縮短影片。');
      media=cleanDataURL(await readDataURL(blob),mime);
    }else if(['image/jpeg','image/png','image/webp'].includes(type)){
      if(file.size>8*1024*1024)throw Error('照片太大，請選擇 8 MB 以下的圖片。');
      const img=new Image();img.src=url;await load(img);
      const c=document.createElement('canvas'),scale=Math.min(1,1200/Math.max(img.width,img.height));c.width=Math.round(img.width*scale);c.height=Math.round(img.height*scale);c.getContext('2d').drawImage(img,0,0,c.width,c.height);
      media=c.toDataURL('image/jpeg',.8);
    }else throw Error('請選擇照片、GIF 或 MP4／MOV 影片。');
    const data=await syncCall({action:'pixelOfficeStoryAdd',name:people[index].name,media});
    setSyncStatus(true);applyStories(data.stories);toast('限時動態已貼出，24 小時後自動下架。');
  }catch(err){toast(err&&err.message&&err.message!=='undefined'?err.message:'無法讀取這個檔案，請換一個再試。');}
  finally{URL.revokeObjectURL(url);}
};$('home').onclick=()=>{people.forEach((p,i)=>{p.x=starts[i][0];p.y=starts[i][1];p.dir='down';localMoveAt.set(i,Date.now());pushChange(i,{x:p.x,y:p.y,dir:'down'});});save();toast('大家都回到自己的座位附近了');};
/* ---------------------------------------------------------------------------------------------
 * 多人同步（2026-09-18）：心情、對話、離席狀態、位置與照片存在主系統的 Cloudflare 後端，所有打開這個網頁的
 * 人看到同一個畫面。不用登入、任何人都能改（使用者決定）。每 3 秒輪詢一次（分頁在背景時 15 秒），沒有
 * 變動時後端只回「沒變」；照片只有版本號變了才另外下載。連不上後端時照舊用本機存檔，恢復後自動跟上。
 * ------------------------------------------------------------------------------------------- */
const SYNC_API='https://machi-design-api.machi-chen.workers.dev/api';
let syncVersion=0,syncOnline=null,syncSeeded=false;
const localMoveAt=new Map(),pendingPositions=new Map();
async function syncCall(payload){const response=await fetch(SYNC_API,{method:'POST',headers:{'Content-Type':'text/plain;charset=UTF-8'},body:JSON.stringify(payload),cache:'no-store'});const data=await response.json();if(!data.ok)throw Error(data.error||'同步失敗');return data;}
function setSyncStatus(online){if(syncOnline===online)return;syncOnline=online;const tag=$('syncTag');if(tag){tag.textContent=online?'多人同步中 · 大家看到同一個畫面':'離線中 · 變更先存在這台電腦';tag.classList.toggle('offline',!online);}}
function pushChange(i,patch){const name=people[i].name;return syncCall({action:'pixelOfficeUpdate',name,patch}).then(data=>{setSyncStatus(true);return data;}).catch(err=>{setSyncStatus(false);toast('同步失敗：'+err.message);});}
/** 走路時位置很頻繁，最多每 350 ms 送一次；最後停下來的位置一定會送出。 */
function queuePosition(i){localMoveAt.set(i,Date.now());if(pendingPositions.has(i))return;pendingPositions.set(i,setTimeout(()=>{pendingPositions.delete(i);const p=people[i];pushChange(i,{x:p.x,y:p.y,dir:p.dir});},350));}
function applyRemote(list){markDirty();let lookChanged=false;
  const seen=new Set();
  for(const entry of list||[]){
    const i=names.indexOf(entry.name);if(i<0)continue;seen.add(i);const p=people[i];
    if(typeof entry.message==='string')p.message=entry.message;
    if(typeof entry.mood==='string')p.mood=entry.mood;
    if(typeof entry.status==='string')p.status=entry.status;
    p.action=entry.action&&entry.action.id?{id:entry.action.id,at:Number(entry.action.at)||0}:null;if(p.action&&WARDROBE_ACTIONS[p.action.id]&&Date.now()-p.action.at<WARDROBE_ACTIONS[p.action.id].ms)loadActionSheet(p.action.id);// 後端會一直留著最後一次的動作，過期的不必載圖（112 KB）
    p.music=entry.music&&entry.music.url?entry.music:null;// 後端沒帶＝沒在分享
    if(p.music)ensureHeadphones();
    if(!p.music&&musicPlaying.i===i)stopMusic();
    {const look=entry.look&&typeof entry.look==='object'?{outfit:entry.look.outfit,cap:entry.look.cap,glasses:entry.look.glasses}:null;if(JSON.stringify(look)!==JSON.stringify(p.look||null)){p.look=look;lookChanged=true;}}// 那個人停止分享了，正在播的也跟著停
    if(p.music&&p.music.provider==='spotify')wantSpotifyApi();// 先把播放器程式載好，點播放鈕時才來得及在「使用者剛點擊」的有效時間內開始播
    // 自己剛移動過的人物，短時間內不被遠端的舊位置拉回去。
    if(Number.isFinite(entry.x)&&Number.isFinite(entry.y)&&Date.now()-(localMoveAt.get(i)||0)>1500&&!(i===selected&&keys.size)){p.x=entry.x;p.y=entry.y;if(entry.dir)p.dir=entry.dir;}
    if(i===selected){if(document.activeElement!==$('message')){$('message').value=p.message;updateCount();}updateMood();updateStatus();updateMusicPanel();}
  }
  // 第一次上線、後端還沒有某人的資料：把這台電腦上已經設定的內容補上去，大家從同一份開始。
  // 出勤狀態刻意不補：後端會把任何送上去的狀態當成「使用者手動指定」而暫停自動判斷，只是某台瀏覽器
  // 留著舊的 localStorage 就害那個人的在座／加班／用餐／廁所停止自動更新。狀態一律交給電腦心跳決定，
  // 要手動改就按狀態按鈕。
  if(!syncSeeded){syncSeeded=true;people.forEach((p,i)=>{if(seen.has(i))return;const patch={};if(p.message)patch.message=p.message;if(p.mood)patch.mood=p.mood;if(p.x!==starts[i][0]||p.y!==starts[i][1]){patch.x=p.x;patch.y=p.y;patch.dir=p.dir;}if(Object.keys(patch).length)pushChange(i,patch);});}
  if(lookChanged){refreshRosterPortraits();renderLookPanel();}
  save(false);
}
async function pollSync(){try{const early=window.__pixelP&&window.__pixelP.state;if(window.__pixelP)window.__pixelP.state=null;let data=early?await early:null;if(!data||!data.ok)data=await syncCall({action:'pixelOfficeState',since:syncVersion});setSyncStatus(true);if(!data.unchanged){applyRemote(data.people);applyLevelTitles(data);applyStories(data.stories);syncVersion=Number(data.version)||0;}}catch{setSyncStatus(false);}finally{setTimeout(pollSync,document.hidden?15000:3000);}}
document.addEventListener('visibilitychange',()=>{if(!document.hidden)syncCall({action:'pixelOfficeState',since:syncVersion}).then(data=>{if(!data.unchanged){applyRemote(data.people);applyLevelTitles(data);applyStories(data.stories);syncVersion=Number(data.version)||0;}}).catch(()=>{});});
const walls=stations.map(s=>[s.x-122,s.y+18,244,80]);
function blocked(x,y){return x<65||x>W-65||y<180||y>H-20||walls.some(([a,b,w,h])=>x>a-14&&x<a+w+14&&y>b-4&&y<b+h+4);}
function moving(dt){if(!ready||selected===null||storyOpen()||isAway(people[selected]))return false;let dx=(keys.has('ArrowRight')?1:0)-(keys.has('ArrowLeft')?1:0),dy=(keys.has('ArrowDown')?1:0)-(keys.has('ArrowUp')?1:0);if(!dx&&!dy)return false;const p=people[selected],length=Math.hypot(dx,dy);p.dir=dx?(dx>0?'right':'left'):(dy>0?'down':'up');dx=dx/length*210*dt;dy=dy/length*210*dt;if(!blocked(p.x+dx,p.y))p.x+=dx;if(!blocked(p.x,p.y+dy))p.y+=dy;save();queuePosition(selected);return true;}
function typing(){const el=document.activeElement;return el&&(['INPUT','TEXTAREA','SELECT'].includes(el.tagName)||el.isContentEditable);}
window.addEventListener('keydown',e=>{if(embedMode||!e.key.startsWith('Arrow')||typing()||storyOpen())return;e.preventDefault();keys.add(e.key);});window.addEventListener('keyup',e=>keys.delete(e.key));window.addEventListener('blur',()=>keys.clear());document.addEventListener('visibilitychange',()=>keys.clear());
// 搖桿：按住拖曳，依拖曳方向換算成 8 個方向（沿用鍵盤的 keys 集合），放開就停。
const joystick=$('joystick'),joystickKnob=joystick?.querySelector('.joystick-knob'),arrowKeys=['ArrowUp','ArrowDown','ArrowLeft','ArrowRight'];let joystickPointer=null;
function joystickMove(e){const rect=joystick.getBoundingClientRect(),max=rect.width/2-joystickKnob.offsetWidth/2;let dx=e.clientX-(rect.left+rect.width/2),dy=e.clientY-(rect.top+rect.height/2);const length=Math.hypot(dx,dy);if(length>max){dx=dx/length*max;dy=dy/length*max;}joystickKnob.style.transform=`translate(${dx}px,${dy}px)`;arrowKeys.forEach(key=>keys.delete(key));if(length<max*.28)return;const ax=dx/Math.hypot(dx,dy),ay=dy/Math.hypot(dx,dy);if(ax>.38)keys.add('ArrowRight');if(ax<-.38)keys.add('ArrowLeft');if(ay>.38)keys.add('ArrowDown');if(ay<-.38)keys.add('ArrowUp');}
function joystickEnd(e){if(e.pointerId!==joystickPointer)return;joystickPointer=null;joystick.classList.remove('active');joystickKnob.style.transform='';arrowKeys.forEach(key=>keys.delete(key));}
if(joystick){joystick.addEventListener('pointerdown',e=>{e.preventDefault();joystickPointer=e.pointerId;try{joystick.setPointerCapture(e.pointerId);}catch{}joystick.classList.add('active');joystickMove(e);});joystick.addEventListener('pointermove',e=>{if(e.pointerId!==joystickPointer)return;e.preventDefault();joystickMove(e);});['pointerup','pointercancel','lostpointercapture'].forEach(type=>joystick.addEventListener(type,joystickEnd));joystick.addEventListener('contextmenu',e=>e.preventDefault());joystick.addEventListener('touchstart',e=>e.preventDefault(),{passive:false});}
game.addEventListener('pointerdown',e=>{if(!ready)return;const rect=game.getBoundingClientRect(),x=(e.clientX-rect.left)*W/rect.width,y=(e.clientY-rect.top)*H/rect.height;const hit=[...hits].reverse().find(h=>x>=h.x&&x<=h.x+h.w&&y>=h.y&&y<=h.y+h.h);if(hit){if(hit.type==='story')openStory(hit.i);else if(hit.type==='musicPlay')toggleMusic(hit.i);else if(hit.type==='musicLink'){const music=musicOf(people[hit.i]);if(music)window.open(music.url,'_blank','noopener');}else{select(hit.i);if(embedMode)setCardPinned(true);else game.focus({preventScroll:true});}}else{if(embedMode)setCardPinned(false);select(null);}});
// 點一下把資料卡固定住：固定之後滑鼠移開不會收起，也才點得到上面的技能膠囊。
// 沒固定時只是滑過預覽（卡片不吃滑鼠事件，見 CSS），滑到別人身上就換人。
let cardPinned=false;
function setCardPinned(value){cardPinned=value;$('personCard').classList.toggle('is-pinned',value);}
function hitAt(clientX,clientY){const r=game.getBoundingClientRect();if(!r.width||!r.height)return null;const x=(clientX-r.left)*W/r.width,y=(clientY-r.top)*H/r.height;return [...hits].reverse().find(h=>x>=h.x&&x<=h.x+h.w&&y>=h.y&&y<=h.y+h.h)||null;}
game.addEventListener('pointermove',e=>{const hit=hitAt(e.clientX,e.clientY);game.style.cursor=hit?'pointer':'default';
  // 嵌入的是展示用畫面，滑過人物就直接展開資料卡（不用點、也沒有關閉鈕）。
  setHoverStory(hit&&hit.type==='story'?hit.i:-1,e);
  if(!embedMode||e.pointerType==='touch'||cardPinned)return;
  if(hit&&['story','musicPlay','musicLink'].includes(hit.type)){if(selected!==null)select(null);}
  else if(hit&&hit.type!=='status'){if(hit.i!==selected)select(hit.i);}
  else if(selected!==null)select(null);});
game.addEventListener('pointerleave',()=>{setHoverStory(-1);if(embedMode&&!cardPinned)select(null);});
// 細緻版面板：細邊框、圓角、柔和陰影（取代原本粗像素切角框）。
function softPanel(context,x,y,w,h,{radius=12,fill='#fffdf7',stroke='#c9d3e0',lineWidth=1.5,shadow=true}={}){context.save();const path=()=>{context.beginPath();context.roundRect(x,y,w,h,radius);};if(shadow){context.shadowColor='rgba(20,41,68,.18)';context.shadowBlur=shadowBlurFor(14);context.shadowOffsetY=4;path();context.fillStyle=fill;context.fill();context.shadowColor='transparent';}path();context.fillStyle=fill;context.fill();context.strokeStyle=stroke;context.lineWidth=lineWidth;context.stroke();context.restore();}
/** 點選人物時，頭上顯示等級與稱號。 */
function stationPerson(s){return s.name?people.find(person=>person.name===s.name):null;}
function stationAway(s){const person=stationPerson(s);return person&&isAway(person);}
// 離席的空桌要畫成灰階。原本用 ctx.filter='grayscale(1) brightness(1.9) contrast(.85)'，但 Safari 的
// canvas 不支援 filter，桌子就維持原本的藍色（使用者回報「下班或出國桌子沒有灰階」）。改成在圖集載入後
// 先做一張灰階版本快取起來，離席時換那張畫——每個瀏覽器結果都一樣，而且只算一次。
let furnitureGray=null;
function ensureFurnitureGray(){
  if(furnitureGray||!furniture.complete||!furniture.naturalWidth)return furnitureGray;
  const canvas=document.createElement('canvas');
  canvas.width=furniture.naturalWidth;canvas.height=furniture.naturalHeight;
  const context=canvas.getContext('2d',{willReadFrequently:true});
  context.drawImage(furniture,0,0);
  try{
    const image=context.getImageData(0,0,canvas.width,canvas.height),pixels=image.data;
    for(let i=0;i<pixels.length;i+=4){
      const luma=pixels[i]*.299+pixels[i+1]*.587+pixels[i+2]*.114;
      const bright=Math.min(255,luma*1.9);
      const value=Math.min(255,Math.max(0,(bright-128)*.85+128));
      pixels[i]=pixels[i+1]=pixels[i+2]=value;
    }
    context.putImageData(image,0,0);
    furnitureGray=canvas;
  }catch{furnitureGray=null;}
  return furnitureGray;
}
// 左下角那個位置還沒有人坐，但機器一直擺在那裡。上班時間（09:00–18:00）維持原本的顏色與椅子，
// 18:00 之後到隔天 08:59 連椅子一起轉灰階——電腦留著，只是整組暗下來，看起來就是「今天沒人用了」。
// 週六、週日與國定假日則整天都是灰階（使用者 2026-09-29 要求）：那幾天不會有人來坐，
// 早上九點到六點還亮著反而奇怪。假日表用的是 TAIWAN_HOLIDAYS，跟加班濾鏡同一份。
// 中午 12–14 點也一樣收掉（使用者 2026-09-30 要求）：大家都去吃飯了，只有那張空桌亮著很突兀。
const VACANT_DESK_ON_HOUR=9,VACANT_DESK_OFF_HOUR=18;
const VACANT_DESK_LUNCH_START=12,VACANT_DESK_LUNCH_END=14;
const stationVacant=s=>!s.name;
function stationDimmed(s){
  if(stationAway(s))return true;
  if(!stationVacant(s))return false;
  const clock=currentTaipeiClock();
  if(!clock.workday)return true;
  if(clock.hour>=VACANT_DESK_LUNCH_START&&clock.hour<VACANT_DESK_LUNCH_END)return true;
  return clock.hour<VACANT_DESK_ON_HOUR||clock.hour>=VACANT_DESK_OFF_HOUR;
}
const furnitureFor=s=>stationDimmed(s)?(ensureFurnitureGray()||furniture):furniture;
// 嵌入時不填底色，讓外層卡片的顏色透進來（深色模式才不會卡著一塊白）。獨立開遊戲頁時仍是白底。
function drawOffice(){if(embedMode){ctx.clearRect(0,0,W,H);return;}ctx.fillStyle='#fff';if(document.documentElement.classList.contains('clean')){ctx.clearRect(0,0,W,H);return;}ctx.fillRect(0,0,W,H);}
// furniture-v3.webp：桌子分「左端／中間／右端」三種形狀（素材裡本來就是這樣畫的），
// 0 一般桌左、1 一般桌中、2 一般桌右、3 副螢幕桌右、4 Mac mini 桌左、5 椅子、6-8 對應三種空桌。
// 每筆是 [x, y, 寬, 高, 螢幕露出桌面的高度]。桌子本體一律是「桌面 221 + 桌腳 70」，
// 差別只在螢幕露出多少，所以繪製時桌面與桌腳的高度固定，螢幕再按各自的 upper 等比縮。
const furnitureRects=[[0,0,520,328,37],[0,328,517,328,37],[0,656,520,325,34],[0,981,520,325,34],[0,1306,520,316,25],[520,0,237,372,0],[0,1622,520,291,0],[0,1913,517,291,0],[0,2204,520,291,0]];
const CHAIR_RECT=5;
// 人物高 142 px，頭部約佔最上方 70 px；椅背上緣放在頭部中線（腳底往上 107 px）。
// 六個座位共用這個定位，避免椅背一路頂到頭頂、搶走人物輪廓。
const CHAIR_WIDTH=102,CHAIR_HEIGHT=135,CHAIR_TOP_FROM_FEET=107;
const DESK_SRC_FACE=221,DESK_SRC_FOOT=70,DESK_SRC_UNIT=517,DESK_SEAT_GAP=220;
const DESK_DRAW_SCALE=DESK_SEAT_GAP/DESK_SRC_UNIT;
function furnitureObject(type,x,y,w,h,art=furniture){const[sx,sy,sw,sh]=furnitureRects[type];ctx.imageSmoothingEnabled=false;ctx.drawImage(art,sx,sy,sw,sh,x,y,w,h);}
// 椅子只在「有人而且在座」時才畫。離席時本來就不畫；左下角那個空位到了灰階時段
//（平日 18:00 之後，以及週末與國定假日整天）也把椅子收掉，只留灰階的桌子與桌上的電腦
// ——stationDimmed() 這幾種情況都涵蓋了。
function drawChair(s){if(stationDimmed(s))return;furnitureObject(CHAIR_RECT,s.x-CHAIR_WIDTH/2,s.y-CHAIR_TOP_FROM_FEET,CHAIR_WIDTH,CHAIR_HEIGHT,furnitureFor(s));}
function drawDesk(s){
  const type=stationAway(s)?s.empty:s.type,art=furnitureFor(s),[sx,sy,sw,sh,upper]=furnitureRects[type];
  const drawW=Math.round(sw*DESK_DRAW_SCALE),faceDraw=Math.round(DESK_SRC_FACE*DESK_DRAW_SCALE);
  const footDraw=Math.round(DESK_SRC_FOOT*DESK_DRAW_SCALE),upperDraw=Math.round(upper*DESK_DRAW_SCALE);
  const faceTop=sy+upper,footTop=faceTop+DESK_SRC_FACE,left=Math.round(s.x-drawW/2),deskTop=s.y-40;
  ctx.imageSmoothingEnabled=false;
  // 螢幕、桌面、桌腳分三段畫：桌面與桌腳一路相接，螢幕才能換一種桌子就換一個高度。
  if(upper>0)ctx.drawImage(art,sx,sy,sw,upper,left,deskTop-upperDraw,drawW,upperDraw);
  ctx.drawImage(art,sx,faceTop,sw,DESK_SRC_FACE,left,deskTop,drawW,faceDraw);
  ctx.drawImage(art,sx,footTop,sw,DESK_SRC_FOOT,left,deskTop+faceDraw,drawW,footDraw);
  drawDeskPlate(s);
}
/** 把一段文字折成不超過 maxWidth 的幾行（呼叫前要先設好 ctx.font）。 */
function wrapText(text,maxWidth){
  const lines=[];let line='';
  for(const ch of text){
    if(ch==='\n'){lines.push(line);line='';continue;}
    if(line&&ctx.measureText(line+ch).width>maxWidth){lines.push(line);line=ch;}
    else line+=ch;
  }
  lines.push(line);
  return lines;
}
/** 放不下就砍到放得下再加「…」（呼叫前要先設好 ctx.font）。 */
function ellipsize(text,maxWidth){
  let out=text;
  while(out&&ctx.measureText(out+'…').width>maxWidth)out=out.slice(0,-1);
  return out+'…';
}
/** 嵌入模式會把字放大，好讓小框裡的字仍讀得到。回傳現在該用多大。 */
function scaledFont(base,screenTarget,max){
  if(!embedMode)return base;
  const screenScale=game.getBoundingClientRect().width/W;
  return Math.min(max,Math.max(base,screenTarget/Math.max(screenScale,.01)));
}
/** 名牌：貼在桌子前緣，只有名字。 */
function drawDeskPlate(s){
  if(!s.name)return;
  const font=scaledFont(15,11,32);
  ctx.save();
  ctx.font=`bold ${font}px sans-serif`;
  const w=Math.max(84,ctx.measureText(s.name).width+24),h=Math.max(PLATE_NAME_H,font+8);
  const x=Math.round(s.x-w/2),y=Math.round(s.y+PLATE_TOP);
  ctx.fillStyle='#fff7e5';ctx.strokeStyle='#182c48';ctx.lineWidth=2;
  ctx.fillRect(x,y,w,h);ctx.strokeRect(x,y,w,h);
  ctx.fillStyle='#223652';ctx.textAlign='center';ctx.textBaseline='middle';
  ctx.fillText(s.name,s.x,y+h/2+1);
  ctx.textBaseline='alphabetic';ctx.restore();
}
/** 對話框往上最多能長到哪裡。
 *  上排：場景的上緣（再高就被框切掉）。
 *  下排：上排名牌的下緣（再高就把別人的名字蓋掉——這是舊版最醜的那個問題）。
 *  判斷用「頭頂有沒有低於上排名牌」，所以在完整版走到兩排中間的人也會自己挑對的那一條。 */
function bubbleCeiling(p){
  const plateBottom=EMBED_ROW_TOP+PLATE_TOP+Math.max(PLATE_NAME_H,scaledFont(15,11,32)+8)+BUBBLE_CLEAR;
  if(p.y-150>=plateBottom)return plateBottom;
  return embedMode?EMBED_CONTENT.y0+4:10;
}
/** 音樂對話框的內容：左邊播放小三角形（綠色圓鈕）、右邊跑馬燈歌名（點歌名開網頁）。 */
function drawMusicContent(p,i,layout,x,y,w,h){
  const music=musicOf(p),cy=y+h/2,t=performance.now()/1000,playing=isMusicPlaying(i);
  const bx=x+17,r=9;
  ctx.shadowColor='transparent';
  ctx.beginPath();ctx.arc(bx,cy,r,0,Math.PI*2);ctx.fillStyle='#008214';ctx.fill();
  ctx.fillStyle='#fff';ctx.beginPath();
  if(playing){ctx.rect(bx-4,cy-4.5,3,9);ctx.rect(bx+1,cy-4.5,3,9);}else{ctx.moveTo(bx-3,cy-5);ctx.lineTo(bx+5,cy);ctx.lineTo(bx-3,cy+5);ctx.closePath();}
  ctx.fill();
  if(i>=0)hits.push({type:'musicPlay',i,x:bx-r-4,y:y,w:r*2+8,h});
  const tx=x+32,tw=w-32-10,label=musicPrefix(music)+music.title;
  ctx.font=`700 ${layout.font}px -apple-system,BlinkMacSystemFont,"PingFang TC","Noto Sans TC",sans-serif`;
  ctx.textAlign='left';ctx.textBaseline='middle';ctx.fillStyle='#1d3350';
  const textW=ctx.measureText(label).width;
  ctx.save();ctx.beginPath();ctx.rect(tx,y+2,tw,h-4);ctx.clip();
  if(textW<=tw)ctx.fillText(label,tx,cy+.5);
  else{const gap=40,offset=(t*32)%(textW+gap);ctx.fillText(label,tx-offset,cy+.5);ctx.fillText(label,tx-offset+textW+gap,cy+.5);}
  ctx.restore();
  if(i>=0)hits.push({type:'musicLink',i,x:tx,y,w:tw,h});
}
/** 頭上的對話框。小、半透明、柔和陰影——像一塊浮在場景上面的玻璃，不搶人物的戲。 */
/** 算出這個人的對話框要多大（不畫）。ignoreCeiling 是「先不管上面擋不擋得住」——
 *  版面要先知道對話框想長多高，才有辦法在框裡把上面的空間留剛好（見 sceneTopExtent）。 */
function bubbleLayout(p,ignoreCeiling=false){
  if(musicOf(p)){// 正在聽音樂：這個位置改放跑馬燈（比一般對話框矮，略往上抬避開耳機）
    const font=scaledFont(BUBBLE_FONT,9,22),lineHeight=Math.max(BUBBLE_LINE,Math.round(font*1.28));
    return {music:true,font,lineHeight,lines:[],tipY:Math.round(p.y-150-BUBBLE_HEAD_GAP-MUSIC_LIFT),lift:MUSIC_LIFT,w:MUSIC_BUBBLE_W,h:Math.round(lineHeight+BUBBLE_PAD_Y*2+4)};
  }
  const message=String(p.message||'').trim();
  if(!message)return null;
  const font=scaledFont(BUBBLE_FONT,9,22),lineHeight=Math.max(BUBBLE_LINE,Math.round(font*1.28));
  ctx.save();
  ctx.font=`600 ${font}px -apple-system,BlinkMacSystemFont,"PingFang TC","Noto Sans TC",sans-serif`;
  const inner=BUBBLE_MAX_W-BUBBLE_PAD_X*2;
  let lines=wrapText(message,inner).filter(line=>line!=='');
  if(!lines.length){ctx.restore();return null;}
  const tipY=Math.round(p.y-150-BUBBLE_HEAD_GAP);
  const room=ignoreCeiling?BUBBLE_MAX_LINES:Math.floor((tipY-BUBBLE_TAIL-BUBBLE_PAD_Y*2-bubbleCeiling(p))/lineHeight);
  const limit=Math.max(1,Math.min(BUBBLE_MAX_LINES,room));
  if(lines.length>limit){lines=lines.slice(0,limit);lines[limit-1]=ellipsize(lines[limit-1],inner);}
  const textW=Math.max(...lines.map(line=>ctx.measureText(line).width));
  ctx.restore();
  return {
    font,lineHeight,lines,tipY,
    w:Math.round(Math.min(BUBBLE_MAX_W,Math.max(58,textW+BUBBLE_PAD_X*2))),
    h:Math.round(lines.length*lineHeight+BUBBLE_PAD_Y*2)
  };
}
/** 頭上的對話框。小、半透明、柔和陰影——像一塊浮在場景上面的玻璃，不搶人物的戲。 */
function drawBubble(p,personIndex=-1){
  const layout=bubbleLayout(p);
  if(!layout)return;
  const {lineHeight,lines,tipY,w,h}=layout;
  ctx.save();
  ctx.font=`600 ${layout.font}px -apple-system,BlinkMacSystemFont,"PingFang TC","Noto Sans TC",sans-serif`;
  const y=tipY-BUBBLE_TAIL-h;
  const left=embedMode?EMBED_CONTENT.x0+4:10,right=embedMode?EMBED_CONTENT.x1-4:W-10;
  const x=Math.round(Math.max(left,Math.min(right-w,p.x-w/2)));
  const tipX=Math.max(x+14,Math.min(x+w-14,p.x));
  const r=11,tail=()=>{
    ctx.beginPath();
    ctx.moveTo(x+r,y);ctx.lineTo(x+w-r,y);ctx.arcTo(x+w,y,x+w,y+r,r);
    ctx.lineTo(x+w,y+h-r);ctx.arcTo(x+w,y+h,x+w-r,y+h,r);
    ctx.lineTo(tipX+7,y+h);ctx.quadraticCurveTo(tipX+2,y+h+3,tipX,y+h+BUBBLE_TAIL);
    ctx.quadraticCurveTo(tipX-2,y+h+3,tipX-7,y+h);
    ctx.lineTo(x+r,y+h);ctx.arcTo(x,y+h,x,y+h-r,r);
    ctx.lineTo(x,y+r);ctx.arcTo(x,y,x+r,y,r);
    ctx.closePath();
  };
  // 半透明只畫一次：softPanel 那種「先投影再補一層實色」的做法會把透明度補掉。
  // 陰影本來就會透出來一點，反而更像玻璃。
  const glass=ctx.createLinearGradient(0,y,0,y+h);
  glass.addColorStop(0,'rgba(255,255,255,.88)');
  glass.addColorStop(1,'rgba(243,248,255,.74)');
  ctx.shadowColor='rgba(10,22,44,.28)';ctx.shadowBlur=shadowBlurFor(12);ctx.shadowOffsetY=5;
  tail();ctx.fillStyle=glass;ctx.fill();
  ctx.shadowColor='transparent';
  ctx.strokeStyle='rgba(140,162,192,.55)';ctx.lineWidth=1;ctx.stroke();
  if(layout.music){drawMusicContent(p,personIndex,layout,x,y,w,h);ctx.restore();return;}
  ctx.fillStyle='#1d3350';ctx.textAlign='center';ctx.textBaseline='middle';
  lines.forEach((line,index)=>ctx.fillText(line,x+w/2,y+BUBBLE_PAD_Y+lineHeight*index+lineHeight/2));
  ctx.textBaseline='alphabetic';ctx.restore();
}
// 回到座位時的高度對齊：Machi 的身形比 Anna 矮（組合後頭頂低約 22 px），坐在同一排桌子後面頭就比隔壁低一截。
// 只在座位附近往上抬（離座位 80 px 以上就不抬，走路時腳才不會懸空），中間線性過渡所以走出去不會跳一格。
// 數值＝兩人頭頂距腳底的差：(317-270) 原圖像素 × WD_SCALE。
const SEAT_LIFT=[0,0,0,-10,-2.4];// 負數＝往下：Anna 與 Machi 坐下的高度再往下約半個滑鼠高（10）；新版頭像與衣服（2026-10-02）兩人頭頂高度差只剩 16 原圖像素＝7.6，所以 Machi 先抬 7.6 對齊 Anna、再一起降 10，淨值 -2.4
function seatLift(i){if(!SEAT_LIFT[i])return 0;const o=starts[i],q=people[i];return SEAT_LIFT[i]*Math.max(0,1-Math.hypot(q.x-o[0],q.y-o[1])/80);}
// 聽音樂時的點頭幅度（像素）。目前 0＝完全不搖（使用者 2026-10-01 要求）；要恢復只有頭點頭就改成 2.2，身體仍然不動。
const MUSIC_NOD=0;
/** 耳機。背面（dir==='up'）要壓在人物後面，所以人物畫之前先畫一次（behind=true）；其餘方向在人物之後畫（behind=false）。
 *  正面兩個耳罩；側面只有靠鏡頭那一側的單個耳罩（有側面素材），對到耳朵。 */
function drawHeadphones(i,p,t,bob,nod,behind){
  const act=actionOf(i);
  if(!musicOf(p)||(p.dir==='up'&&!act)!==behind)return;
  const side=!act&&(p.dir==='left'||p.dir==='right');
  if(!headphones.complete||!headphones.naturalWidth)return;
  const fr=wardrobeFrame(i,p.dir,act);if(!fr)return;
  const g=fr.geom,S=WD_SCALE,ear=(g.chinY-HP_CHIN_UP-fr.ay)*S+HP_DY[i]+bob+nod;
  if(side){
    if(!headphonesSide.complete||!headphonesSide.naturalWidth)return;
    const k=HP_SIDE_D/HP_SIDE_SRC_W,dw=headphonesSide.naturalWidth*k,dh=headphonesSide.naturalHeight*k,dir=p.dir==='left'?-1:1,cx=dir*(g.earX-fr.ax)*S;
    ctx.save();ctx.translate(cx,ear);ctx.scale(dir,1);ctx.drawImage(headphonesSide,-HP_SIDE_CX*k,-HP_SIDE_CY*k,dw,dh);ctx.restore();
    drawWardrobeCap(ctx,i,p.dir,0,bob+nod);return;
  }
  // 耳機全員同樣大小、同樣對位（2026-10-02 使用者要求統一，以 Anna 已確認的大小為準）：兩個耳罩外緣 HP_SPAN_W 原圖像素寬，耳罩中心在下巴上方 HP_CHIN_UP（照 Anna 確認過的位置換算；不能用眼睛位置，男生眼睛畫得比較高，耳機會比女生高一截）、臉中心左 HP_DX_NAT。HP_DY 是畫面像素的個別微調：Machi 的臉畫得比 Anna 高（眼睛高約 11 px，頭頂則是對齊的），使用者要求兩人耳機同高，所以他的耳機往下 8。
  const fw=HP_SPAN_W/.8*S,fh=fw*HP_FRAME_H/HP_FRAME_W,cx=(g.cx+HP_DX_NAT-fr.ax)*S,frame=Math.floor(t*4)%HP_FRAMES;
  ctx.drawImage(headphones,frame*HP_FRAME_W,0,HP_FRAME_W,HP_FRAME_H,cx-fw/2,ear-fh*.77,fw,fh);
  if(!behind)drawWardrobeCap(ctx,i,p.dir,act?act.hx||0:0,bob+nod,142,act);
}
/** 動作進行中，在人物腳下顯示動作名稱（像素風小標籤，疊在桌子上面）。 */
function drawActionLabel(i){
  const act=actionOf(i),p=viewPeople[i];if(!act||!p||isAway(p))return;
  const label=WARDROBE_ACTIONS[act.id].label,font=scaledFont(13,10,26);
  ctx.save();ctx.font=`bold ${font}px sans-serif`;
  const w=ctx.measureText(label).width+16,h=font+8,x=Math.round(p.x+act.dx-w/2),y=Math.round(p.y+8);
  ctx.fillStyle='#fff7e5';ctx.strokeStyle='#182c48';ctx.lineWidth=2;ctx.fillRect(x,y,w,h);ctx.strokeRect(x,y,w,h);
  ctx.fillStyle='#223652';ctx.textAlign='center';ctx.textBaseline='middle';ctx.fillText(label,p.x+act.dx,y+h/2+1);
  ctx.restore();
}
function drawPerson(i,time,walk){const p=viewPeople[i];if(isAway(p))return;const t=time/1000;let bob=(walk&&selected===i?Math.sin(t*17)*3:0)-seatLift(i),tilt=0;if(p.mood==='happy')bob-=Math.abs(Math.sin(t*4))*12;if(p.mood==='angry')bob+=Math.sin(t*24)*2;if(p.mood==='joy'){tilt=Math.sin(t*7)*.1;bob-=Math.abs(Math.sin(t*7))*8;}if(p.mood==='sad')tilt=Math.sin(t*2)*.035;const music=musicOf(p),nod=music?Math.sin(t*9)*MUSIC_NOD:0;ctx.save();ctx.translate(p.x,p.y);if(i===selected){ctx.strokeStyle='#e9b94e';ctx.fillStyle='#ffdd7828';ctx.lineWidth=4;ctx.beginPath();ctx.ellipse(0,-2,45,12,0,0,Math.PI*2);ctx.fill();ctx.stroke();}const act=actionOf(i);ctx.rotate(tilt+(act?act.rot:0));if(act)ctx.translate(act.dx,act.dy);drawHeadphones(i,p,t,bob,nod,true);if(act){if(!(act.hx&&drawWardrobeNod(ctx,i,'down',0,bob,0,142,act,act.hx)))drawWardrobe(ctx,i,'down',0,bob,142,act);}else if(!(music&&MUSIC_NOD&&drawWardrobeNod(ctx,i,p.dir,0,bob,nod)))sprite(ctx,i,p.dir,0,bob);if(isOvertime(p))drawOvertimeFilter(ctx,i,p.dir,0,bob);drawHeadphones(i,p,t,bob,nod,false);ctx.restore();hits.push({type:'person',i,x:p.x-53,y:p.y-150,w:106,h:150});}
function drawOverlay(i,time){const p=viewPeople[i];if(isAway(p))return;drawBubble(p,i);drawStoryBubble(i,time);const mood=moods.find(item=>item.id===p.mood);if(mood){const side=storiesOf(p.name).length?-1:(p.x>W-120?-1:1),x=p.x+side*80,y=p.y-124;drawSymbol(ctx,mood.symbol,x,y,56);}}
/** 離席狀態：椅子與電腦都不畫，只留灰階空桌；狀態圖示放在原本電腦的位置、大小與電腦相當（104），文字在圖示上方。 */
// 圖示在桌上的縮放。電源鍵與公事包的圖形本身幾乎填滿整個格子（不透明面積是其他圖示的 1.6 倍），
// 用同樣的尺寸畫在桌上就會比別的狀態大一圈。面板按鈕有外框當基準、看不出來，所以只縮桌上這邊。
const DESK_ICON_BASE=104;
// 這兩張圖本身留白少，照 104 畫會比別人大一圈，所以縮一點。縮的是圖，膠囊的高度不跟著縮。
const DESK_ICON_SCALE={power:.8,briefcase:.78};
/** 加班標籤：移除場景中的月亮，只把「加班中」置中畫在桌面中央。 */
function drawOvertimeBadge(s,p){const status=statuses.find(item=>item.id==='overtime'),x=s.x,h=24;ctx.save();ctx.font='700 13px -apple-system,BlinkMacSystemFont,"PingFang TC","Noto Sans TC",sans-serif';const w=Math.round(ctx.measureText(status.text).width+22),labelY=s.y+24;softPanel(ctx,x-w/2,labelY-h/2,w,h,{radius:12,fill:'#fff6d6',stroke:'#e2b04a',lineWidth:1,shadow:true});ctx.fillStyle='#6a4a10';ctx.textAlign='center';ctx.textBaseline='middle';ctx.fillText(status.text,x,labelY+.5);ctx.restore();hits.push({type:'status',i:names.indexOf(p.name),x:x-w/2,y:labelY-h/2,w,h});}
function drawStatusMarker(s){const p=stationPerson(s);if(!p)return;const effective=effectiveStatusId(p);if(effective==='present')return;if(effective==='overtime'){drawOvertimeBadge(s,p);return;}const status=statuses.find(item=>item.id===effective),x=s.x,iconY=s.y-24,iconSize=DESK_ICON_BASE*(DESK_ICON_SCALE[status.symbol]||1);drawSymbol(ctx,status.symbol,x,iconY,iconSize);ctx.save();ctx.font='700 13px -apple-system,BlinkMacSystemFont,"PingFang TC","Noto Sans TC",sans-serif';const w=Math.round(ctx.measureText(status.label).width+22),h=22,labelY=iconY-DESK_ICON_BASE/2-h-2;softPanel(ctx,x-w/2,labelY,w,h,{radius:11,fill:'#ffffff',stroke:'#c9d3e0',lineWidth:1,shadow:true});ctx.fillStyle='#273b50';ctx.textAlign='center';ctx.textBaseline='middle';ctx.fillText(status.label,x,labelY+h/2+.5);ctx.restore();hits.push({type:'status',i:names.indexOf(p.name),x:x-iconSize/2,y:labelY,w:iconSize,h:iconY+iconSize/2-labelY});}
const sceneAnimating=()=>people.some((p,i)=>!isAway(p)&&(p.mood||musicOf(p)||actionOf(i)||(!storyReducedMotion.matches&&storyUnread(p.name))));
let embedVisible=true,embedLastDraw=0;
if(embedMode&&'IntersectionObserver' in window)new IntersectionObserver(entries=>{embedVisible=entries[entries.length-1].isIntersecting;if(embedVisible)markDirty()}).observe(document.documentElement);
function render(time){const dt=Math.min((time-last)/1000||0,.04);last=time;const walk=moving(dt);
  if(embedMode&&!needsRedraw&&!sceneAnimating()){requestAnimationFrame(render);return;}
  // 嵌入首頁時：畫面不在可視範圍就不重畫；持續動畫（心情／未讀動態）限制在約 30fps，避免整張場景每幀全畫拖慢首頁。
  if(embedMode&&!needsRedraw){if(!embedVisible||time-embedLastDraw<40){requestAnimationFrame(render);return;}}
  embedLastDraw=time;
  needsRedraw=false;syncViewLayout();ctx.clearRect(0,0,W,H);drawOffice();if(ready){hits=[];const layers=[];viewStations.forEach(s=>{layers.push({depth:s.y-20,draw:()=>drawChair(s)});layers.push({depth:s.y+106,draw:()=>drawDesk(s)});});viewPeople.forEach((p,i)=>layers.push({depth:p.y,draw:()=>drawPerson(i,time,walk)}));layers.sort((a,b)=>a.depth-b.depth).forEach(layer=>layer.draw());people.forEach((p,i)=>drawOverlay(i,time));people.forEach((p,i)=>drawActionLabel(i));viewStations.forEach(drawStatusMarker);positionPersonCard();}requestAnimationFrame(render);}
// 圖示不擋進站：人物與家具載好就開始畫，圖示載入前先用內建的像素小圖。
load(iconSheet).then(refreshIconCanvases).catch(()=>{});load(extraSheet).then(refreshIconCanvases).catch(()=>{});
load(overtimeSheet).then(()=>portrait($('portrait').getContext('2d'),selected)).catch(()=>{});
Promise.all([load(wardrobeSheets.heads),load(wardrobeSheets.outfits),load(furniture)]).then(()=>{ready=true;loadAccessories();fitEmbedView();setTimeout(fitEmbedView,300);setTimeout(fitEmbedView,1200);markDirty();$('loading').hidden=true;refreshIconCanvases();select(null);document.querySelectorAll('.roster-button canvas:not([data-symbol])').forEach((canvas,i)=>portrait(canvas.getContext('2d'),i,false));}).catch(()=>{$('loading').textContent='場景圖片載入失敗，請重新整理頁面。';});select(null);if(!embedMode)ensureLevels();syncDesigners();pollSync();renderLevelTable();requestAnimationFrame(render);
setInterval(()=>{const before=currentTaipeiClock().hour;taipeiClock=null;taipeiClockCheckedAt=0;if(currentTaipeiClock().hour!==before)updateStatus();},60000);
if(document.modelContext?.registerTool){try{document.modelContext.registerTool({name:'set_character_status',description:'選取設計師並設定心情、出勤狀態與頭頂對話。照片與對話僅儲存於本機瀏覽器。',inputSchema:{type:'object',properties:{name:{type:'string',enum:names},message:{type:'string',maxLength:60},mood:{type:'string',enum:['','happy','angry','sad','joy']},status:{type:'string',enum:['present','overtime','lunch','offwork','toilet','meeting','leave','abroad','out']}},required:['name'],additionalProperties:false},annotations:{readOnlyHint:false},execute(input){if(!input||!names.includes(input.name)||input.message!==undefined&&(typeof input.message!=='string'||input.message.length>60)||input.mood!==undefined&&!['','happy','angry','sad','joy'].includes(input.mood)||input.status!==undefined&&!statuses.some(status=>status.id===input.status))throw Error('人物、對話、心情或狀態無效');const i=names.indexOf(input.name);if(input.message!==undefined)people[i].message=input.message;if(input.mood!==undefined)people[i].mood=input.mood;if(input.status!==undefined)people[i].status=input.status;select(i);save();const patch={};for(const key of ['message','mood','status'])if(input[key]!==undefined)patch[key]=input[key];pushChange(i,patch);return {name:people[i].name,message:people[i].message,mood:people[i].mood,status:people[i].status};}});}catch{}}

// 手機（單欄）版面：等級一覽表放到最下面，讓走動搖桿跟場景在同一個畫面裡。桌面版維持放在場景卡片底下，
// 所以不是用 CSS 調順序（兩者不在同一層），而是跟著視窗寬度把這一塊搬到 main 的最後或搬回去。
(function placeLevelTable(){
  if(embedMode)return;
  const section=document.querySelector('.level-table-section'),play=document.querySelector('.play'),main=document.querySelector('main');
  if(!section||!play||!main||!window.matchMedia)return;
  const query=matchMedia('(max-width:1000px)');
  const place=()=>{if(query.matches){if(section.parentElement!==main)main.append(section);}else if(section.parentElement!==play)play.append(section);};
  query.addEventListener('change',place);place();
})();

// 自動更新：嵌在主系統裡（或單獨開著）的畫面整天不會被重新整理。每 3 分鐘用 HEAD 問一次自己的 index.html
// 的 ETag，跟載入當下比，不一樣就是有新版；等到不會打斷人的時候（沒開動態視窗、沒在打字）自己重新載入。
// 狀態都存在後端，重新載入不會掉資料。剛重新載入過 2 分鐘內不再連續重整。
(function autoUpdate(){
  if(location.protocol==='file:')return;
  const url=new URL('index.html',location.href).href,typingNow=()=>{const el=document.activeElement;return Boolean(el&&(['INPUT','TEXTAREA','SELECT'].includes(el.tagName)||el.isContentEditable));};
  let baseline='',pending=false,busy=false;
  const fingerprint=async()=>{try{const r=await fetch(url,{method:'HEAD',cache:'no-store'});return r.ok?(r.headers.get('etag')||r.headers.get('last-modified')||''):'';}catch{return '';}};
  function apply(){
    if(!pending||storyOpen()||typingNow())return;
    let recent=false;try{recent=Date.now()-Number(sessionStorage.getItem('pixel-auto-update-at')||0)<120000;}catch{}
    // 2026-10-04：不再自動重新載入（會打斷使用中的畫面），新版等使用者下次自己重新整理就會套用。
    void recent;
  }
  async function check(){if(busy)return;busy=true;try{const current=await fingerprint();if(!current)return;if(!baseline){baseline=current;return;}if(current!==baseline)pending=true;apply();}finally{busy=false;}}
  fingerprint().then(value=>{baseline=baseline||value;});
  setInterval(check,3*60*1000);setInterval(apply,20*1000);
  document.addEventListener('visibilitychange',()=>{if(!document.hidden)check();});
})();

// ?avatars=1：給新版首頁的隱藏小視窗用。把每個人目前的造型（帽子、眼鏡、耳機）畫成頭像圖，連同對話與分享的音樂一起傳給外層，首頁的頭像框就能顯示一樣的樣子。
if(new URLSearchParams(location.search).get('avatars')==='1'){
  const sendAvatars=()=>{
    if(!ready||window.parent===window)return;
    loadAccessories();if(!accessoriesReady())return;// 帽子、眼鏡的圖還沒載好時先不送，不然頭像會先是光頭
    try{
      const list={};
      people.forEach((p,i)=>{
        // 畫布比原本的肖像高一截：戴帽子的人物會超出頭頂，不留空間帽子就被切平
        const keepLook=p.look,eff=effectiveLook(i);
        p.look={outfit:eff.outfit,cap:'',glasses:eff.glasses};// 頭像框一律不戴帽子（眼鏡保留）
        const c=document.createElement('canvas');c.width=130;c.height=190;portrait(c.getContext('2d'),i,false);
        const o=document.createElement('canvas');o.width=o.height=160;
        // 每個人的下巴、臉中心用造型圖的幾何量出來，統一把下巴放在頭像框同一個高度（帽子、長髮不影響）
        let chin=null,cx=65;
        try{
          const fr=wardrobeFrame(i,'down');
          if(fr&&fr.geom){const s=WD_SCALE*(144/142);chin=(190-3)+(fr.geom.chinY-fr.ay)*s;cx=65+(fr.geom.cx-fr.ax)*s;}
        }catch(error){}
        p.look=keepLook;
        if(chin===null)chin=110;
        const size=AV_CROP.w,sy=chin-size*AV_CROP.chin;
        o.getContext('2d').drawImage(c,cx-size/2,sy,size,size,0,0,160,160);
        list[p.name]={img:o.toDataURL('image/png'),message:p.message||'',music:p.music&&p.music.url?{url:p.music.url,title:p.music.title||''}:null,status:p.status||'',story:{count:storiesOf(p.name).length,unread:storyUnread(p.name)}};
      });
      window.parent.postMessage({type:'pixelOfficeAvatars',list},location.origin);
    }catch(error){}
  };
  let avatarsSent=false;const sendAvatarsOnce=()=>{sendAvatars();};const fastSend=setInterval(()=>{sendAvatars();if(ready&&accessoriesReady()){avatarsSent=true;clearInterval(fastSend)}},700);setInterval(sendAvatarsOnce,5000);
  // 首頁頭像上的音樂框：點一下播放／暫停（播放器在這個隱藏視窗裡），並回報誰正在播。
  window.addEventListener('message',event=>{
    if(event.origin!==location.origin||!event.data||event.data.type!=='pixelOfficeToggleMusic')return;
    const i=names.indexOf(String(event.data.name||''));if(i>=0)toggleMusic(i);
  });
  let lastPlaying='';
  setInterval(()=>{
    const p=musicPlaying.i>=0&&people[musicPlaying.i]?people[musicPlaying.i].name:'',active=Boolean(p)&&!musicPlaying.paused,real=active&&Boolean(musicPlaying.audio||musicPlaying.started);
    const key=(real?'p:':active?'l:':'')+p;
    if(key===lastPlaying)return;lastPlaying=key;
    try{window.parent.postMessage({type:'pixelOfficeMusicState',playing:real?p:'',loading:active&&!real?p:''},location.origin)}catch(error){}
  },400);
}
const AV_CROP={w:112,chin:.74};// 裁切邊長（原圖像素）與下巴在框內的高度比例（所有人一致）

// 首頁頭像右上角的限時動態氣泡：外層點了之後切到多元宇宙頁，再用這則訊息叫場景直接打開那個人的限時動態。
window.addEventListener('message',event=>{
  if(event.origin!==location.origin||!event.data||event.data.type!=='pixelOfficeOpenStory')return;
  const i=names.indexOf(String(event.data.name||''));
  if(i>=0&&storiesOf(names[i]).length)openStory(i);
});

// 首頁直接顯示限時動態：隱藏視窗被外層放大成全螢幕後，動態看完（或關閉）要通知外層縮回去。
{let wasOpen=false;setInterval(()=>{const now=Boolean(viewer&&viewer.open);if(wasOpen&&!now){try{if(window.parent!==window)window.parent.postMessage({type:'pixelOfficeStoryClosed'},location.origin)}catch(error){}}wasOpen=now;},250);}

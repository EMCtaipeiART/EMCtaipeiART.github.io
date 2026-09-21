'use strict';
const $=id=>document.getElementById(id), game=$('game'), ctx=game.getContext('2d'), W=1536,H=1024;
const names=['Leona','Amber','Noise','Anna','Machi'], descriptions=['黑髮・時髦日常','暖色・樸素自在','短髮・專注模式','長髮・粉色靈感','挑染・街頭風格'];
const starts=[[548,355],[768,355],[988,355],[768,695],[988,695]];
const fallbackScores={Machi:10832,Anna:4749.5,Amber:2905,Leona:1907,Noise:1404.5};
descriptions[2]='藍帽・夏日休閒';
let levelStats=Object.fromEntries(names.map(name=>[name,levelFromScore(fallbackScores[name])]));
let levelUpdatedAt='',levelIsLive=false;
const stations=[{x:548,y:355,type:0,name:'Leona'},{x:768,y:355,type:0,name:'Amber'},{x:988,y:355,type:1,name:'Noise'},{x:548,y:695,type:2,name:''},{x:768,y:695,type:0,name:'Anna'},{x:988,y:695,type:0,name:'Machi'}];
const moods=[{id:'happy',symbol:'sun',label:'喜',text:'陽光好心情'},{id:'angry',symbol:'burst',label:'怒',text:'爆炸氣噗噗'},{id:'sad',symbol:'drop',label:'哀',text:'大水滴低落中'},{id:'joy',symbol:'heart',label:'樂',text:'愛心滿格'}];
const statuses=[{id:'present',symbol:'person',label:'在座',text:'在座工作中'},{id:'overtime',symbol:'moon',label:'加班',text:'加班中'},{id:'lunch',symbol:'bowl',label:'用餐',text:'用餐中'},{id:'meeting',symbol:'meeting',label:'會議',text:'開會中'},{id:'offwork',symbol:'power',label:'下班',text:'已下班'},{id:'toilet',symbol:'toilet',label:'廁所',text:'去廁所'},{id:'abroad',symbol:'plane',label:'出國',text:'出國中'},{id:'out',symbol:'briefcase',label:'公出',text:'公出工作中'}];
// 在座與加班都是「人還坐在位子上工作」（人物、椅子、電腦都要畫，也能走動）；其餘狀態才是離席（灰階空桌）。
const workingStatusIds=['present','overtime'];const isAway=p=>!workingStatusIds.includes(p.status);
const overtimePreview=new URLSearchParams(location.search).get('overtime')==='1';
// 嵌入版不能走動，畫面多數時間是完全靜止的（只有心情動畫會動），沒必要每秒重畫 60 次。
// 有變化時才畫：遠端同步、選取、框變大小都會標記一次。省下來的 CPU 讓外層系統的進站更順。
// 宣告放在最前面：resizeCanvas() 在腳本載入時就會被呼叫一次，那時就要用到 markDirty。
let needsRedraw=true;
function markDirty(){needsRedraw=true;}

// 嵌入模式的版面：上下兩排之間空了一大段，塞進側欄的小框裡會白白浪費一半高度。把下排往上收，
// 六張桌子擠在一起之後才有空間放大。上排以上不動、之後線性壓縮，所以人物走到中間時位置是連續的，
// 不會突然跳一格。只改「畫出來的位置」，同步給大家的座標完全沒動。
// 0.8 是能收到的極限：再小的話下排人物的頭就會疊到上排的桌子上。
const EMBED_ROW_TOP=355,EMBED_ROW_SQUEEZE=.8,EMBED_ROW_BOTTOM=695;
const viewY=y=>embedMode&&y>EMBED_ROW_TOP?EMBED_ROW_TOP+(y-EMBED_ROW_TOP)*EMBED_ROW_SQUEEZE:y;
// 畫面用的座標（嵌入模式下把下排往上收過）。資料一律用 people／stations，畫面一律用這兩個。
let viewPeople=[],viewStations=[];
// 六張桌子實際佔到的範圍（場景座標，下排收上來之後量的）：左右是桌子邊緣，上緣是人物頭頂，
// 下緣是下排桌腳。嵌入模式就是把這一塊等比放到框裡置中，框變成什麼比例都不會裁到或偏一邊。
// 上緣是上排人物的頭頂，下緣是下排桌子的桌腳（跟著上面的壓縮比例走，改了不用重量一次）。
const EMBED_CONTENT={x0:424,x1:1112,y0:206,y1:EMBED_ROW_TOP+(EMBED_ROW_BOTTOM-EMBED_ROW_TOP)*EMBED_ROW_SQUEEZE+112};
const EMBED_FIT_PADDING=.94;
function fitEmbedView(){
  if(!embedMode)return;
  markDirty();
  const wrap=game.parentElement.getBoundingClientRect();
  if(!wrap.width||!wrap.height)return;
  const bw=EMBED_CONTENT.x1-EMBED_CONTENT.x0,bh=EMBED_CONTENT.y1-EMBED_CONTENT.y0;
  const scale=Math.min(wrap.width*EMBED_FIT_PADDING/bw,wrap.height*EMBED_FIT_PADDING/bh);
  const cx=(EMBED_CONTENT.x0+EMBED_CONTENT.x1)/2,cy=(EMBED_CONTENT.y0+EMBED_CONTENT.y1)/2;
  game.style.width=`${W*scale}px`;game.style.height=`${H*scale}px`;
  game.style.transform=`translate(${wrap.width/2-cx*scale}px,${wrap.height/2-cy*scale}px)`;
}
function syncViewLayout(){
  if(!embedMode){viewPeople=people;viewStations=stations;return;}
  viewPeople=people.map(p=>({...p,y:viewY(p.y)}));
  viewStations=stations.map(s=>({...s,y:viewY(s.y)}));
}

// 嵌入模式：設計需求系統用 iframe 把場景放進「設計師專長與案件分配」。
// 保留點選人物與資料卡，但關閉鍵盤移動與右側編輯工具；狀態仍照常同步。
const embedMode=new URLSearchParams(location.search).get('embed')==='1';
if(embedMode){document.documentElement.classList.add('embed');game.tabIndex=-1;game.setAttribute('aria-label','設計部即時狀態場景');}
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
try{const saved=JSON.parse(localStorage.getItem('kaiyao-office-v1')||'null');if(Array.isArray(saved))people.forEach((p,i)=>{const s=saved[i];if(!s)return;p.message=typeof s.message==='string'?s.message.slice(0,60):'';p.mood=moods.some(m=>m.id===s.mood)?s.mood:'';p.status=statuses.some(status=>status.id===s.status)?s.status:'present';p.photo=typeof s.photo==='string'&&s.photo.startsWith('data:image/')?s.photo:'';if(['4','5'].includes(localStorage.getItem('kaiyao-office-layout'))&&Number.isFinite(s.x)&&Number.isFinite(s.y)){p.x=Math.max(65,Math.min(W-65,s.x));p.y=Math.max(180,Math.min(H-20,s.y));}});}catch{}
syncViewLayout();
function toast(message){$('toast').textContent=message;$('toast').classList.add('visible');clearTimeout(toast.timer);toast.timer=setTimeout(()=>$('toast').classList.remove('visible'),2500);}
function save(){clearTimeout(saveTimer);saveTimer=setTimeout(()=>{try{localStorage.setItem('kaiyao-office-v1',JSON.stringify(people));localStorage.setItem('kaiyao-office-layout','5');}catch{toast('瀏覽器空間不足，這次變更尚未保存。請移除部分照片。');}},200);}
const sheet=new Image(),furniture=new Image(),iconSheet=new Image(),extraSheet=new Image(),overtimeSheet=new Image();// 進站加速（2026-09-18）：只保留實際用到的區塊並改存 WebP。
sheet.src='assets/sprites-packed.webp?v=1';furniture.src='assets/furniture-packed.webp?v=2';iconSheet.src='assets/icons-v3.webp?v=3';extraSheet.src='assets/icons-status-v4.webp?v=1';overtimeSheet.src='assets/overtime-filter.webp?v=1';
function resizeCanvas(){markDirty();const scale=Math.max(1,Math.min(3,(window.devicePixelRatio||1)*game.getBoundingClientRect().width/W));game.width=Math.round(W*scale);game.height=Math.round(H*scale);ctx.setTransform(game.width/W,0,0,game.height/H,0,0);ctx.imageSmoothingEnabled=false;}
new ResizeObserver(()=>{resizeCanvas();fitEmbedView();}).observe(game);new ResizeObserver(fitEmbedView).observe(game.parentElement);window.addEventListener('resize',()=>{resizeCanvas();fitEmbedView();});resizeCanvas();
function load(img){return new Promise((resolve,reject)=>{img.onload=resolve;img.onerror=reject;if(img.complete&&img.naturalWidth)resolve();});}
// sprites-packed.webp：5 列（Leona、Amber、Noise、Anna、Machi）× 3 欄（正面、右側面、背面），每欄寬 140，列高沿用原圖。
const rowTops=[0,192,381,572,757], rowHeights=[192,189,191,185,189], colLefts=[0,140,280];
function sprite(context,index,dir,x,y,w=98,h=142){const col=dir==='up'?2:dir==='left'||dir==='right'?1:0;context.save();context.imageSmoothingEnabled=false;context.translate(x,y);if(dir==='left')context.scale(-1,1);context.drawImage(sheet,colLefts[col],rowTops[index],140,rowHeights[index],-w/2,-h,w,h);context.restore();}
// 黑色眼珠的下緣（人物高 142 時距頭頂多少），逐格量出來的：黑眼圈就從這裡往下畫。五張臉的眼珠高度
// 不一樣——Machi 的眼睛畫得比較高、Noise 戴帽子所以比較低——共用一個值就會有人對不準。
const EYE_PUPIL_BOTTOM=[47,47,50,47,45];// Leona、Amber、Noise、Anna、Machi
// overtime-filter.webp：正面、側面、背面三格（每格 362）。黑眼圈與鬼火分層繪製。
// 黑眼圈：原圖正面兩團（x116/x200，y122 起高 28）、側面一團（x190，y124 起高 28），各自貼到眼珠正下方。
// 眼珠中心固定在 ±12（側面 +16），左右用同一組尺寸，所以兩邊一定對稱；寬度取 14（側面 12）比眼珠的
// 10 略寬一點，外緣才不會壓到頭髮或耳朵。
// 鬼火：原圖從 y160 才開始，來源要從 156 取（不是 145），否則黑眼圈下緣會被當成鬼火重畫在頭頂兩側。
function drawOvertimeFilter(context,index,dir,feetX,feetY,height=142,compact=false){if(!overtimeSheet.complete||!overtimeSheet.naturalWidth)return;const frame=dir==='up'?2:dir==='left'||dir==='right'?1:0,cell=overtimeSheet.naturalWidth/3,scale=height/142,size=150*scale,top=feetY-159*scale,half=cell/2,flameTop=156,flameHeight=102,flameWidth=(compact?50:half/cell*150)*scale,flameDrawHeight=flameHeight/cell*size,flameY=top+flameTop/cell*size-38*scale,leftX=(compact?-64:-105)*scale,rightX=(compact?14:30)*scale,inner=(compact?24:43)*scale,outer=(compact?70:112)*scale;context.save();context.imageSmoothingEnabled=true;context.imageSmoothingQuality='high';context.translate(feetX,0);if(dir==='left')context.scale(-1,1);
  // 兩團鬼火分開畫，中心約在頭像左右 68 px。
  // 只保留頭像外側的鬼火區域，避免鬼火內側疊到臉上。
  context.save();context.beginPath();context.rect(-outer,flameY,outer-inner,flameDrawHeight);context.clip();context.drawImage(overtimeSheet,frame*cell,flameTop,half,flameHeight,leftX,flameY,flameWidth,flameDrawHeight);context.restore();
  context.save();context.beginPath();context.rect(inner,flameY,outer-inner,flameDrawHeight);context.clip();context.drawImage(overtimeSheet,frame*cell+half,flameTop,half,flameHeight,rightX,flameY,flameWidth,flameDrawHeight);context.restore();
  // 背面原稿沒有黑眼圈；正面兩團、側面一團，分別對齊各自的眼睛中心。
  if(frame!==2){const bags=frame===1?[[190,124,52,28,16,12]]:[[116,122,50,28,-12,14],[200,122,51,28,12,14]],faceScale=(compact?95/98:1)*scale,bagY=feetY-(142-EYE_PUPIL_BOTTOM[index])*scale;
    for(const[sx,sy,sw,sh,cx,bagWidth]of bags){const dw=bagWidth*faceScale,dh=dw*sh/sw;context.drawImage(overtimeSheet,frame*cell+sx,sy,sw,sh,cx*faceScale-dw/2,bagY,dw,dh);}}
  context.restore();}
function portrait(context,i,showOvertime=true,blank=false){context.clearRect(0,0,context.canvas.width,context.canvas.height);if(blank)return;if(ready){const x=context.canvas.width/2,y=context.canvas.height-3;sprite(context,i,'down',x,y,95,144);if(showOvertime&&isOvertime(people[i]))drawOvertimeFilter(context,i,'down',x,y,144,true);}}
function select(i){selected=i;keys.clear();markDirty();document.querySelectorAll('.roster-button').forEach((b,n)=>b.classList.toggle('active',n===i));
  const chosen=i!==null&&i!==undefined;
  $('tools').hidden=!chosen;$('toolsEmpty').hidden=chosen;$('selectedTag').textContent=chosen?'已選取':'未選取';
  if(!chosen){cardPinned=false;$('personCard').classList.remove('is-pinned');$('personCard').hidden=true;$('personName').textContent='—';$('personDesc').textContent='點人物開始';$('moodStatus').textContent='';portrait($('portrait').getContext('2d'),0,false,true);return;}
  $('personName').textContent=people[i].name;$('personDesc').textContent=descriptions[i];$('message').value=people[i].message;updateCount();
  ensureLevels();
  updateMood();updateStatus();updatePhoto();updateLevel();portrait($('portrait').getContext('2d'),i);renderPersonCard();}
function numberText(value){return Number(value).toLocaleString('zh-TW',{maximumFractionDigits:1});}
function levelTitle(level){if(level>=50)return '設計神話';if(level>=40)return '傳奇設計師';if(level>=30)return '設計大師';if(level>=20)return '設計菁英';if(level>=10)return '資深設計師';return '設計新秀';}
function levelFromScore(score){
  const safe=Math.max(0,Number(score)||0),level=Math.floor(Math.sqrt(safe/10))+1,current=10*(level-1)**2,next=10*level**2,progress=(safe-current)/(next-current)*100;
  return {score:safe,xp:safe*10,level,title:levelTitle(level),remaining:Math.max(0,next-safe),progress:Math.max(0,Math.min(100,progress))};
}
function updateLevel(){
  if(selected===null)return;
  const stat=levelStats[people[selected].name]||levelFromScore(0);
  $('levelHeading').textContent='Lv.'+stat.level;$('levelTitle').textContent=stat.title;$('xpFill').style.width=stat.progress.toFixed(1)+'%';$('xpTrack').setAttribute('aria-valuenow',stat.progress.toFixed(1));
  $('scoreText').textContent=`${numberText(stat.score)} 分 · ${numberText(stat.xp)} EXP`;$('nextText').textContent=`距 Lv.${stat.level+1} 還差 ${numberText(stat.remaining)} 分`;
  $('levelSource').textContent=levelIsLive?`已同步歷史已完成案件 · ${levelUpdatedAt}`:'目前顯示最近同步值 · 連線後自動更新';
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
  caseRows=payload.rows;const totals=scoreRows(payload.rows);levelStats=Object.fromEntries(names.map(name=>[name,levelFromScore(totals[name])]));levelIsLive=true;
  const timestamp=new Date(payload.generatedAt||Date.now());levelUpdatedAt=Number.isNaN(timestamp.getTime())?'最新快照':timestamp.toLocaleString('zh-TW',{timeZone:'Asia/Taipei',year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',hour12:false});
  document.querySelectorAll('.roster-level').forEach((element,i)=>element.textContent='Lv.'+levelStats[names[i]].level);updateLevel();renderPersonCard();
}
// 人物資料卡：等級與案件用 syncLevels() 已經下載的那份歷史快照（含未完成的案件），技能與「新專案找誰」
// 另外跟 Worker 要一份很小的清單，這樣就不必在遊戲裡下載 1.5 MB 的 db.json。
let caseRows=null,designerInfo=null,newProjectPriority=null;
// 手上的案件只看這三種狀態（使用者指定）。顏色跟主系統的案件標籤一致。
const CARD_CASE_STATES=[{key:'未開始',color:'#9aa7b8'},{key:'執行中',color:'#5ea9ff'},{key:'修改中',color:'#f0b429'}];
const CARD_CASE_PREVIEW=3;
async function syncDesigners(){
  try{
    const data=await syncCall({action:'pixelOfficeDesigners'});
    designerInfo=Object.fromEntries((data.designers||[]).map(item=>[item.name,item]));
    newProjectPriority=data.priority||null;
    renderPersonCard();
  }catch{}
}
function personCases(name){
  const groups=CARD_CASE_STATES.map(state=>({...state,rows:[]}));
  for(const row of caseRows||[]){
    if(String(row['設計負責人']||'').trim().toLowerCase()!==name.toLowerCase())continue;
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
  if(selected===null){card.hidden=true;return;}
  const p=people[selected],stat=levelStats[p.name]||levelFromScore(0),info=designerInfo?.[p.name];
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
/** 把卡片放在人物右邊；右邊擺不下就改放左邊，上下夾在場景裡面。 */
function positionPersonCard(){
  const card=$('personCard');
  if(card.hidden||selected===null)return;
  const wrap=game.getBoundingClientRect(),p=viewPeople[selected]||people[selected];
  const scaleX=wrap.width/W,scaleY=wrap.height/H;
  const cardW=card.offsetWidth||232,cardH=card.offsetHeight||240,gap=12;
  let left=p.x*scaleX+52*scaleX+gap;
  if(left+cardW>wrap.width-8)left=p.x*scaleX-52*scaleX-gap-cardW;
  left=Math.max(8,Math.min(wrap.width-cardW-8,left));
  let top=(p.y-150)*scaleY-6;
  top=Math.max(8,Math.min(wrap.height-cardH-8,top));
  card.style.left=Math.round(left)+'px';card.style.top=Math.round(top)+'px';
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
function updatePhoto(){if(selected===null)return;const photo=people[selected].photo;$('uploadLabel').hidden=!!photo;$('photoTools').hidden=!photo;if(photo)$('thumb').src=photo;else $('thumb').removeAttribute('src');}
function openPhoto(i){if(!people[i].photo)return;keys.clear();$('fullPhoto').src=people[i].photo;$('photoCaption').textContent=people[i].name+' 分享的照片';$('lightbox').showModal();}
const pixelSymbols={
  sun:['001010100','000111000','101222101','012222210','112222211','012222210','101222101','000111000','001010100'],
  burst:['100010001','010111010','001222100','112222211','122222221','112222211','001222100','010111010','100010001'],
  drop:['000010000','000111000','000121000','001222100','012222210','012222210','012222210','001222100','000111000'],
  heart:['000000000','011001100','122112210','122222210','012222100','001221000','000110000','000100000','000000000'],
  person:['000111000','001222100','001222100','000111000','001222100','012222210','012222210','001101100','011000110'],
  power:['000010000','000020000','001020100','012000210','120000021','120000021','012000210','001222100','000111000'],
  toilet:['000111100','000122200','000111100','000001100','011111100','012222200','001222000','001111000','011001100'],
  plane:['000010000','000110000','000210000','111222111','022222220','000210000','001212100','010000010','000000000'],
  briefcase:['000111000','001222100','011111110','122222221','122112221','122112221','122222221','111111111','010000010']
};
const symbolPalettes={sun:['#e8a528','#ffe070'],burst:['#d94b3d','#ff9b45'],drop:['#3577be','#7bd2ff'],heart:['#c83366','#ff759d'],person:['#4a718e','#8fd0a8'],power:['#697786','#e8f0f5'],toilet:['#647a92','#e8f3f5'],plane:['#4c6f9d','#eef5ff'],briefcase:['#704d35','#e7a34c']};
function drawPixelSymbol(context,symbol,cx,cy,scale=4){const pattern=pixelSymbols[symbol],palette=symbolPalettes[symbol]||['#263d59','#fff'];if(!pattern)return;const width=pattern[0].length,height=pattern.length,startX=Math.round(cx-width*scale/2),startY=Math.round(cy-height*scale/2);context.save();context.imageSmoothingEnabled=false;pattern.forEach((row,y)=>[...row].forEach((cell,x)=>{if(cell==='0')return;context.fillStyle=palette[Number(cell)-1];context.fillRect(startX+x*scale,startY+y*scale,scale,scale);}));context.restore();}
const symbolCells={sun:0,burst:1,drop:2,heart:3,person:4,power:5,toilet:6,plane:7,briefcase:8};
const extraCells={meeting:0,bowl:1};// icons-status-v4.webp：2 格正方形（會議、用餐），規則與 icons-v3 相同。
// icons-v3.webp：3×3 正方形格子（每格 192×192，原檔 icons-v3.png 每格 256），每個圖示已裁到實際範圍並置中留白，不會被切到或變形。
function drawSymbol(context,symbol,cx,cy,size=48){if(symbol==='moon'){drawMoonIcon(context,cx,cy,size);return;}
  // 會議與用餐放在後來新增的 icons-status-v4（2 格），icons-v3 的 3×3 已經排滿。
  const extra=extraCells[symbol];
  if(extra!==undefined&&extraSheet.complete&&extraSheet.naturalWidth){const cell=extraSheet.naturalWidth/2;context.save();context.imageSmoothingEnabled=true;context.imageSmoothingQuality='high';context.drawImage(extraSheet,extra*cell,0,cell,cell,cx-size/2,cy-size/2,size,size);context.restore();return;}
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
$('photo').onchange=async e=>{const file=e.target.files[0],index=selected;e.target.value='';if(!file)return;if(!['image/jpeg','image/png','image/webp'].includes(file.type)){toast('請選擇 JPG、PNG 或 WebP 圖片。');return;}if(file.size>8*1024*1024){toast('照片太大，請選擇 8 MB 以下的圖片。');return;}try{const url=URL.createObjectURL(file),img=new Image();img.src=url;try{await load(img);const c=document.createElement('canvas'),scale=Math.min(1,1200/Math.max(img.width,img.height));c.width=Math.round(img.width*scale);c.height=Math.round(img.height*scale);c.getContext('2d').drawImage(img,0,0,c.width,c.height);people[index].photo=c.toDataURL('image/jpeg',.8);photoImages.delete(index);save();pushChange(index,{photo:people[index].photo});if(selected===index)updatePhoto();toast('照片已加入，點人物旁的小照片即可放大。');}finally{URL.revokeObjectURL(url);}}catch{toast('無法讀取這張圖片，請換一張再試。');}};
$('expand').onclick=()=>openPhoto(selected);$('removePhoto').onclick=()=>{people[selected].photo='';photoImages.delete(selected);updatePhoto();save();pushChange(selected,{photo:''});};$('closePhoto').onclick=()=>$('lightbox').close();$('lightbox').onclick=e=>{if(e.target===$('lightbox'))$('lightbox').close();};
$('home').onclick=()=>{people.forEach((p,i)=>{p.x=starts[i][0];p.y=starts[i][1];p.dir='down';localMoveAt.set(i,Date.now());pushChange(i,{x:p.x,y:p.y,dir:'down'});});save();toast('大家都回到自己的座位附近了');};
/* ---------------------------------------------------------------------------------------------
 * 多人同步（2026-09-18）：心情、對話、離席狀態、位置與照片存在主系統的 Cloudflare 後端，所有打開這個網頁的
 * 人看到同一個畫面。不用登入、任何人都能改（使用者決定）。每 3 秒輪詢一次（分頁在背景時 15 秒），沒有
 * 變動時後端只回「沒變」；照片只有版本號變了才另外下載。連不上後端時照舊用本機存檔，恢復後自動跟上。
 * ------------------------------------------------------------------------------------------- */
const SYNC_API='https://machi-design-api.machi-chen.workers.dev/api';
let syncVersion=0,syncOnline=null,syncSeeded=false;
const photoVersions=new Map(),localMoveAt=new Map(),pendingPositions=new Map();
async function syncCall(payload){const response=await fetch(SYNC_API,{method:'POST',headers:{'Content-Type':'text/plain;charset=UTF-8'},body:JSON.stringify(payload),cache:'no-store'});const data=await response.json();if(!data.ok)throw Error(data.error||'同步失敗');return data;}
function setSyncStatus(online){if(syncOnline===online)return;syncOnline=online;const tag=$('syncTag');if(tag){tag.textContent=online?'多人同步中 · 大家看到同一個畫面':'離線中 · 變更先存在這台電腦';tag.classList.toggle('offline',!online);}}
function pushChange(i,patch){const name=people[i].name;return syncCall({action:'pixelOfficeUpdate',name,patch}).then(data=>{setSyncStatus(true);if('photo' in patch)photoVersions.set(name,Number(data.person?.photoVersion)||0);return data;}).catch(err=>{setSyncStatus(false);toast('同步失敗：'+err.message);});}
/** 走路時位置很頻繁，最多每 350 ms 送一次；最後停下來的位置一定會送出。 */
function queuePosition(i){localMoveAt.set(i,Date.now());if(pendingPositions.has(i))return;pendingPositions.set(i,setTimeout(()=>{pendingPositions.delete(i);const p=people[i];pushChange(i,{x:p.x,y:p.y,dir:p.dir});},350));}
async function loadRemotePhoto(i,version){const name=people[i].name;photoVersions.set(name,version);if(!version){people[i].photo='';photoImages.delete(i);if(i===selected)updatePhoto();return;}try{const data=await syncCall({action:'pixelOfficePhoto',name});if(photoVersions.get(name)!==version)return;people[i].photo=data.photo||'';photoImages.delete(i);if(i===selected)updatePhoto();save(false);}catch{}}
function applyRemote(list){markDirty();
  const seen=new Set();
  for(const entry of list||[]){
    const i=names.indexOf(entry.name);if(i<0)continue;seen.add(i);const p=people[i];
    if(typeof entry.message==='string')p.message=entry.message;
    if(typeof entry.mood==='string')p.mood=entry.mood;
    if(typeof entry.status==='string')p.status=entry.status;
    // 自己剛移動過的人物，短時間內不被遠端的舊位置拉回去。
    if(Number.isFinite(entry.x)&&Number.isFinite(entry.y)&&Date.now()-(localMoveAt.get(i)||0)>1500&&!(i===selected&&keys.size)){p.x=entry.x;p.y=entry.y;if(entry.dir)p.dir=entry.dir;}
    const version=Number(entry.photoVersion)||0;if(photoVersions.get(p.name)!==version)loadRemotePhoto(i,version);
    if(i===selected){if(document.activeElement!==$('message')){$('message').value=p.message;updateCount();}updateMood();updateStatus();}
  }
  // 第一次上線、後端還沒有某人的資料：把這台電腦上已經設定的內容補上去，大家從同一份開始。
  // 出勤狀態刻意不補：後端會把任何送上去的狀態當成「使用者手動指定」而暫停自動判斷，只是某台瀏覽器
  // 留著舊的 localStorage 就害那個人的在座／加班／用餐／廁所停止自動更新。狀態一律交給電腦心跳決定，
  // 要手動改就按狀態按鈕。
  if(!syncSeeded){syncSeeded=true;people.forEach((p,i)=>{if(seen.has(i))return;const patch={};if(p.message)patch.message=p.message;if(p.mood)patch.mood=p.mood;if(p.x!==starts[i][0]||p.y!==starts[i][1]){patch.x=p.x;patch.y=p.y;patch.dir=p.dir;}if(p.photo)patch.photo=p.photo;if(Object.keys(patch).length)pushChange(i,patch);});}
  save(false);
}
async function pollSync(){try{const data=await syncCall({action:'pixelOfficeState',since:syncVersion});setSyncStatus(true);if(!data.unchanged){applyRemote(data.people);syncVersion=Number(data.version)||0;}}catch{setSyncStatus(false);}finally{setTimeout(pollSync,document.hidden?15000:3000);}}
document.addEventListener('visibilitychange',()=>{if(!document.hidden)syncCall({action:'pixelOfficeState',since:syncVersion}).then(data=>{if(!data.unchanged){applyRemote(data.people);syncVersion=Number(data.version)||0;}}).catch(()=>{});});
const walls=stations.map(s=>[s.x-122,s.y+18,244,80]);
function blocked(x,y){return x<65||x>W-65||y<180||y>H-20||walls.some(([a,b,w,h])=>x>a-14&&x<a+w+14&&y>b-4&&y<b+h+4);}
function moving(dt){if(!ready||selected===null||$('lightbox').open||isAway(people[selected]))return false;let dx=(keys.has('ArrowRight')?1:0)-(keys.has('ArrowLeft')?1:0),dy=(keys.has('ArrowDown')?1:0)-(keys.has('ArrowUp')?1:0);if(!dx&&!dy)return false;const p=people[selected],length=Math.hypot(dx,dy);p.dir=dx?(dx>0?'right':'left'):(dy>0?'down':'up');dx=dx/length*210*dt;dy=dy/length*210*dt;if(!blocked(p.x+dx,p.y))p.x+=dx;if(!blocked(p.x,p.y+dy))p.y+=dy;save();queuePosition(selected);return true;}
function typing(){const el=document.activeElement;return el&&(['INPUT','TEXTAREA','SELECT'].includes(el.tagName)||el.isContentEditable);}
window.addEventListener('keydown',e=>{if(embedMode||!e.key.startsWith('Arrow')||typing()||$('lightbox').open)return;e.preventDefault();keys.add(e.key);});window.addEventListener('keyup',e=>keys.delete(e.key));window.addEventListener('blur',()=>keys.clear());document.addEventListener('visibilitychange',()=>keys.clear());
// 搖桿：按住拖曳，依拖曳方向換算成 8 個方向（沿用鍵盤的 keys 集合），放開就停。
const joystick=$('joystick'),joystickKnob=joystick?.querySelector('.joystick-knob'),arrowKeys=['ArrowUp','ArrowDown','ArrowLeft','ArrowRight'];let joystickPointer=null;
function joystickMove(e){const rect=joystick.getBoundingClientRect(),max=rect.width/2-joystickKnob.offsetWidth/2;let dx=e.clientX-(rect.left+rect.width/2),dy=e.clientY-(rect.top+rect.height/2);const length=Math.hypot(dx,dy);if(length>max){dx=dx/length*max;dy=dy/length*max;}joystickKnob.style.transform=`translate(${dx}px,${dy}px)`;arrowKeys.forEach(key=>keys.delete(key));if(length<max*.28)return;const ax=dx/Math.hypot(dx,dy),ay=dy/Math.hypot(dx,dy);if(ax>.38)keys.add('ArrowRight');if(ax<-.38)keys.add('ArrowLeft');if(ay>.38)keys.add('ArrowDown');if(ay<-.38)keys.add('ArrowUp');}
function joystickEnd(e){if(e.pointerId!==joystickPointer)return;joystickPointer=null;joystick.classList.remove('active');joystickKnob.style.transform='';arrowKeys.forEach(key=>keys.delete(key));}
if(joystick){joystick.addEventListener('pointerdown',e=>{e.preventDefault();joystickPointer=e.pointerId;try{joystick.setPointerCapture(e.pointerId);}catch{}joystick.classList.add('active');joystickMove(e);});joystick.addEventListener('pointermove',e=>{if(e.pointerId!==joystickPointer)return;e.preventDefault();joystickMove(e);});['pointerup','pointercancel','lostpointercapture'].forEach(type=>joystick.addEventListener(type,joystickEnd));joystick.addEventListener('contextmenu',e=>e.preventDefault());joystick.addEventListener('touchstart',e=>e.preventDefault(),{passive:false});}
game.addEventListener('pointerdown',e=>{if(!ready)return;const rect=game.getBoundingClientRect(),x=(e.clientX-rect.left)*W/rect.width,y=(e.clientY-rect.top)*H/rect.height;const hit=[...hits].reverse().find(h=>x>=h.x&&x<=h.x+h.w&&y>=h.y&&y<=h.y+h.h);if(hit){if(hit.type==='photo')openPhoto(hit.i);else{select(hit.i);if(embedMode)setCardPinned(true);else game.focus({preventScroll:true});}}else{if(embedMode)setCardPinned(false);select(null);}});
// 點一下把資料卡固定住：固定之後滑鼠移開不會收起，也才點得到上面的技能膠囊。
// 沒固定時只是滑過預覽（卡片不吃滑鼠事件，見 CSS），滑到別人身上就換人。
let cardPinned=false;
function setCardPinned(value){cardPinned=value;$('personCard').classList.toggle('is-pinned',value);}
function hitAt(clientX,clientY){const r=game.getBoundingClientRect();if(!r.width||!r.height)return null;const x=(clientX-r.left)*W/r.width,y=(clientY-r.top)*H/r.height;return [...hits].reverse().find(h=>x>=h.x&&x<=h.x+h.w&&y>=h.y&&y<=h.y+h.h)||null;}
game.addEventListener('pointermove',e=>{const hit=hitAt(e.clientX,e.clientY);game.style.cursor=hit?'pointer':'default';
  // 嵌入的是展示用畫面，滑過人物就直接展開資料卡（不用點、也沒有關閉鈕）。
  if(!embedMode||e.pointerType==='touch'||cardPinned)return;
  if(hit&&hit.type!=='status'){if(hit.i!==selected)select(hit.i);}
  else if(selected!==null)select(null);});
game.addEventListener('pointerleave',()=>{if(embedMode&&!cardPinned)select(null);});
// 細緻版面板：細邊框、圓角、柔和陰影（取代原本粗像素切角框）。
function softPanel(context,x,y,w,h,{radius=12,fill='#fffdf7',stroke='#c9d3e0',lineWidth=1.5,shadow=true}={}){context.save();const path=()=>{context.beginPath();context.roundRect(x,y,w,h,radius);};if(shadow){context.shadowColor='rgba(20,41,68,.18)';context.shadowBlur=14;context.shadowOffsetY=4;path();context.fillStyle=fill;context.fill();context.shadowColor='transparent';}path();context.fillStyle=fill;context.fill();context.strokeStyle=stroke;context.lineWidth=lineWidth;context.stroke();context.restore();}
function bubble(p,lift=0){if(!p.message)return;ctx.save();ctx.font='600 17px -apple-system,BlinkMacSystemFont,"PingFang TC","Noto Sans TC",sans-serif';const lines=[];let line='';for(const ch of p.message){if(ch==='\n'){lines.push(line);line='';continue;}if(ctx.measureText(line+ch).width>220&&line){lines.push(line);line=ch;}else line+=ch;}lines.push(line);const lineHeight=25,w=Math.max(90,...lines.map(text=>ctx.measureText(text).width+34)),h=lines.length*lineHeight+22,x=Math.max(10,Math.min(W-w-10,Math.round(p.x-w/2))),y=Math.max(10,Math.round(p.y-172-lift-h));const tipX=Math.max(x+20,Math.min(x+w-20,p.x));
  // 泡泡與尾巴畫成同一個外框，邊線連續，不會有接縫。
  const r=14,path=()=>{ctx.beginPath();ctx.moveTo(x+r,y);ctx.lineTo(x+w-r,y);ctx.arcTo(x+w,y,x+w,y+r,r);ctx.lineTo(x+w,y+h-r);ctx.arcTo(x+w,y+h,x+w-r,y+h,r);ctx.lineTo(tipX+9,y+h);ctx.quadraticCurveTo(tipX+2,y+h+4,tipX,y+h+12);ctx.quadraticCurveTo(tipX-3,y+h+4,tipX-9,y+h);ctx.lineTo(x+r,y+h);ctx.arcTo(x,y+h,x,y+h-r,r);ctx.lineTo(x,y+r);ctx.arcTo(x,y,x+r,y,r);ctx.closePath();};
  ctx.shadowColor='rgba(20,41,68,.18)';ctx.shadowBlur=14;ctx.shadowOffsetY=4;path();ctx.fillStyle='#fffdf7';ctx.fill();ctx.shadowColor='transparent';path();ctx.fillStyle='#fffdf7';ctx.fill();ctx.strokeStyle='#c9d3e0';ctx.lineWidth=1.5;ctx.stroke();
  ctx.fillStyle='#1d3350';ctx.textAlign='center';ctx.textBaseline='middle';const centerY=y+h/2;lines.forEach((text,index)=>ctx.fillText(text,x+w/2,centerY+(index-(lines.length-1)/2)*lineHeight));ctx.restore();}
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
const furnitureFor=s=>stationAway(s)?(ensureFurnitureGray()||furniture):furniture;
function withStationStyle(s,draw){draw();}
function drawOffice(){ctx.fillStyle='#fff';ctx.fillRect(0,0,W,H);}
// furniture-packed.webp：只保留四種家具（兩種桌、Mac Studio 桌、椅子）重新排列。
// 第 5 個（index 4）是空桌子：由 iMac 桌去掉電腦、鍵盤、滑鼠與陰影做成，離席（下班／廁所／出國／公出）時使用。
const furnitureRects=[[0,0,532,335],[0,335,553,334],[0,669,553,318],[553,0,284,445],[0,987,532,335]];
function furnitureObject(type,x,y,w,h,art=furniture){ctx.imageSmoothingEnabled=false;ctx.drawImage(art,...furnitureRects[type],x,y,w,h);}
function drawChair(s){if(stationAway(s))return;withStationStyle(s,()=>furnitureObject(3,s.x-51,s.y-135,102,135));}
function drawDesk(s){withStationStyle(s,()=>{const type=stationAway(s)?4:s.type,art=furnitureFor(s),[sx,sy,sw,sh]=furnitureRects[type],top=sy+(type===2?28:68),front=sy+(type===2?250:266),upperHeight=type===2?14:37;ctx.imageSmoothingEnabled=false;ctx.drawImage(art,sx,sy,sw,top-sy,s.x-125,s.y-40-upperHeight,250,upperHeight);ctx.drawImage(art,sx,top,sw,front-top,s.x-125,s.y-40,250,110);ctx.drawImage(art,sx,front,sw,sy+sh-front,s.x-125,s.y+70,250,36);if(s.name){const screenScale=game.getBoundingClientRect().width/W,fontSize=embedMode?Math.min(32,Math.max(15,11/Math.max(screenScale,.01))):15;ctx.font=`bold ${fontSize}px sans-serif`;const labelW=Math.max(84,ctx.measureText(s.name).width+24),labelH=Math.max(23,fontSize+8),labelX=s.x-labelW/2,labelY=s.y+56;ctx.fillStyle='#fff7e5';ctx.strokeStyle='#182c48';ctx.lineWidth=2;ctx.fillRect(labelX,labelY,labelW,labelH);ctx.strokeRect(labelX,labelY,labelW,labelH);ctx.fillStyle='#223652';ctx.textAlign='center';ctx.textBaseline='middle';ctx.fillText(s.name,s.x,labelY+labelH/2+1);ctx.textBaseline='alphabetic';}});}
function drawPerson(i,time,walk){const p=viewPeople[i];if(isAway(p))return;const t=time/1000;let bob=walk&&selected===i?Math.sin(t*17)*3:0,tilt=0;if(p.mood==='happy')bob-=Math.abs(Math.sin(t*4))*12;if(p.mood==='angry')bob+=Math.sin(t*24)*2;if(p.mood==='joy'){tilt=Math.sin(t*7)*.1;bob-=Math.abs(Math.sin(t*7))*8;}if(p.mood==='sad')tilt=Math.sin(t*2)*.035;ctx.save();ctx.translate(p.x,p.y);if(i===selected){ctx.strokeStyle='#e9b94e';ctx.fillStyle='#ffdd7828';ctx.lineWidth=4;ctx.beginPath();ctx.ellipse(0,-2,45,12,0,0,Math.PI*2);ctx.fill();ctx.stroke();}ctx.rotate(tilt);sprite(ctx,i,p.dir,0,bob);if(isOvertime(p))drawOvertimeFilter(ctx,i,p.dir,0,bob);ctx.restore();hits.push({type:'person',i,x:p.x-53,y:p.y-150,w:106,h:150});}
function drawPhotoCard(i){const p=viewPeople[i];if(!p.photo)return;let image=photoImages.get(i);if(!image){image=new Image();image.src=p.photo;photoImages.set(i,image);}const side=p.x>W-155?-1:1,x=Math.round(side>0?p.x+64:p.x-140),y=Math.round(p.y-151),w=76,h=70;softPanel(ctx,x,y,w,h,{radius:10,fill:'#fff',stroke:'#c9d3e0'});if(image.complete&&image.naturalWidth){ctx.save();ctx.beginPath();ctx.roundRect(x+5,y+5,w-10,h-24,7);ctx.clip();ctx.imageSmoothingEnabled=true;ctx.imageSmoothingQuality='high';const boxW=w-10,boxH=h-24,scale=Math.max(boxW/image.naturalWidth,boxH/image.naturalHeight),dw=image.naturalWidth*scale,dh=image.naturalHeight*scale;ctx.drawImage(image,x+5+(boxW-dw)/2,y+5+(boxH-dh)/2,dw,dh);ctx.restore();}ctx.save();ctx.fillStyle='#5b6d87';ctx.font='700 9px -apple-system,BlinkMacSystemFont,sans-serif';ctx.textAlign='center';ctx.textBaseline='middle';ctx.fillText('點開看看',x+w/2,y+h-9.5);ctx.restore();hits.push({type:'photo',i,x,y,w,h});}
function drawOverlay(i){const p=viewPeople[i];if(isAway(p))return;bubble(p,0);drawPhotoCard(i);const mood=moods.find(item=>item.id===p.mood);if(mood){const side=p.photo?-1:(p.x>W-120?-1:1),x=p.x+side*80,y=p.y-124;drawSymbol(ctx,mood.symbol,x,y,56);}}
/** 離席狀態：椅子與電腦都不畫，只留灰階空桌；狀態圖示放在原本電腦的位置、大小與電腦相當（104），文字在圖示上方。 */
// 圖示在桌上的縮放。電源鍵與公事包的圖形本身幾乎填滿整個格子（不透明面積是其他圖示的 1.6 倍），
// 用同樣的尺寸畫在桌上就會比別的狀態大一圈。面板按鈕有外框當基準、看不出來，所以只縮桌上這邊。
const DESK_ICON_SCALE={power:.8,briefcase:.78};
/** 加班標籤：移除場景中的月亮，只把「加班中」置中畫在桌面中央。 */
function drawOvertimeBadge(s,p){const status=statuses.find(item=>item.id==='overtime'),x=s.x,h=24;ctx.save();ctx.font='700 13px -apple-system,BlinkMacSystemFont,"PingFang TC","Noto Sans TC",sans-serif';const w=Math.round(ctx.measureText(status.text).width+22),labelY=s.y+24;softPanel(ctx,x-w/2,labelY-h/2,w,h,{radius:12,fill:'#fff6d6',stroke:'#e2b04a',lineWidth:1,shadow:true});ctx.fillStyle='#6a4a10';ctx.textAlign='center';ctx.textBaseline='middle';ctx.fillText(status.text,x,labelY+.5);ctx.restore();hits.push({type:'status',i:names.indexOf(p.name),x:x-w/2,y:labelY-h/2,w,h});}
function drawStatusMarker(s){const p=stationPerson(s);if(!p)return;const effective=effectiveStatusId(p);if(effective==='present')return;if(effective==='overtime'){drawOvertimeBadge(s,p);return;}const status=statuses.find(item=>item.id===effective),x=s.x,iconY=s.y-24,iconSize=104*(DESK_ICON_SCALE[status.symbol]||1);drawSymbol(ctx,status.symbol,x,iconY,iconSize);ctx.save();ctx.font='700 13px -apple-system,BlinkMacSystemFont,"PingFang TC","Noto Sans TC",sans-serif';const w=Math.round(ctx.measureText(status.label).width+22),h=22,labelY=iconY-iconSize/2-h-2;softPanel(ctx,x-w/2,labelY,w,h,{radius:11,fill:'#ffffff',stroke:'#c9d3e0',lineWidth:1,shadow:true});ctx.fillStyle='#273b50';ctx.textAlign='center';ctx.textBaseline='middle';ctx.fillText(status.label,x,labelY+h/2+.5);ctx.restore();hits.push({type:'status',i:names.indexOf(p.name),x:x-iconSize/2,y:labelY,w:iconSize,h:iconY+iconSize/2-labelY});}
const sceneAnimating=()=>people.some(p=>p.mood&&!isAway(p));
function render(time){const dt=Math.min((time-last)/1000||0,.04);last=time;const walk=moving(dt);
  if(embedMode&&!needsRedraw&&!sceneAnimating()){requestAnimationFrame(render);return;}
  needsRedraw=false;syncViewLayout();ctx.clearRect(0,0,W,H);drawOffice();if(ready){hits=[];const layers=[];viewStations.forEach(s=>{layers.push({depth:s.y-20,draw:()=>drawChair(s)});layers.push({depth:s.y+106,draw:()=>drawDesk(s)});});viewPeople.forEach((p,i)=>layers.push({depth:p.y,draw:()=>drawPerson(i,time,walk)}));layers.sort((a,b)=>a.depth-b.depth).forEach(layer=>layer.draw());people.forEach((p,i)=>drawOverlay(i));viewStations.forEach(drawStatusMarker);positionPersonCard();}requestAnimationFrame(render);}
// 圖示不擋進站：人物與家具載好就開始畫，圖示載入前先用內建的像素小圖。
load(iconSheet).then(refreshIconCanvases).catch(()=>{});load(extraSheet).then(refreshIconCanvases).catch(()=>{});
load(overtimeSheet).then(()=>portrait($('portrait').getContext('2d'),selected)).catch(()=>{});
Promise.all([load(sheet),load(furniture)]).then(()=>{ready=true;$('loading').hidden=true;refreshIconCanvases();select(null);document.querySelectorAll('.roster-button canvas:not([data-symbol])').forEach((canvas,i)=>portrait(canvas.getContext('2d'),i,false));}).catch(()=>{$('loading').textContent='場景圖片載入失敗，請重新整理頁面。';});select(null);if(!embedMode)ensureLevels();syncDesigners();pollSync();requestAnimationFrame(render);
setInterval(()=>{const before=currentTaipeiClock().hour;taipeiClock=null;taipeiClockCheckedAt=0;if(currentTaipeiClock().hour!==before)updateStatus();},60000);
if(document.modelContext?.registerTool){try{document.modelContext.registerTool({name:'set_character_status',description:'選取設計師並設定心情、出勤狀態與頭頂對話。照片與對話僅儲存於本機瀏覽器。',inputSchema:{type:'object',properties:{name:{type:'string',enum:names},message:{type:'string',maxLength:60},mood:{type:'string',enum:['','happy','angry','sad','joy']},status:{type:'string',enum:['present','overtime','lunch','offwork','toilet','meeting','abroad','out']}},required:['name'],additionalProperties:false},annotations:{readOnlyHint:false},execute(input){if(!input||!names.includes(input.name)||input.message!==undefined&&(typeof input.message!=='string'||input.message.length>60)||input.mood!==undefined&&!['','happy','angry','sad','joy'].includes(input.mood)||input.status!==undefined&&!statuses.some(status=>status.id===input.status))throw Error('人物、對話、心情或狀態無效');const i=names.indexOf(input.name);if(input.message!==undefined)people[i].message=input.message;if(input.mood!==undefined)people[i].mood=input.mood;if(input.status!==undefined)people[i].status=input.status;select(i);save();const patch={};for(const key of ['message','mood','status'])if(input[key]!==undefined)patch[key]=input[key];pushChange(i,patch);return {name:people[i].name,message:people[i].message,mood:people[i].mood,status:people[i].status};}});}catch{}}

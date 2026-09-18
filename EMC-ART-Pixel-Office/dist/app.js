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
const statuses=[{id:'present',symbol:'person',label:'在座',text:'在座工作中'},{id:'offwork',symbol:'power',label:'下班',text:'已下班'},{id:'toilet',symbol:'toilet',label:'廁所',text:'去廁所'},{id:'abroad',symbol:'plane',label:'出國',text:'出國中'},{id:'out',symbol:'briefcase',label:'公出',text:'公出工作中'}];
let people=names.map((name,i)=>({name,x:starts[i][0],y:starts[i][1],dir:'down',mood:'',status:'present',message:'',photo:''})), selected=0,ready=false, keys=new Set(), last=0, saveTimer, photoImages=new Map(), hits=[];
try{const saved=JSON.parse(localStorage.getItem('kaiyao-office-v1')||'null');if(Array.isArray(saved))people.forEach((p,i)=>{const s=saved[i];if(!s)return;p.message=typeof s.message==='string'?s.message.slice(0,60):'';p.mood=moods.some(m=>m.id===s.mood)?s.mood:'';p.status=statuses.some(status=>status.id===s.status)?s.status:'present';p.photo=typeof s.photo==='string'&&s.photo.startsWith('data:image/')?s.photo:'';if(['4','5'].includes(localStorage.getItem('kaiyao-office-layout'))&&Number.isFinite(s.x)&&Number.isFinite(s.y)){p.x=Math.max(65,Math.min(W-65,s.x));p.y=Math.max(180,Math.min(H-20,s.y));}});}catch{}
function toast(message){$('toast').textContent=message;$('toast').classList.add('visible');clearTimeout(toast.timer);toast.timer=setTimeout(()=>$('toast').classList.remove('visible'),2500);}
function save(){clearTimeout(saveTimer);saveTimer=setTimeout(()=>{try{localStorage.setItem('kaiyao-office-v1',JSON.stringify(people));localStorage.setItem('kaiyao-office-layout','5');}catch{toast('瀏覽器空間不足，這次變更尚未保存。請移除部分照片。');}},200);}
const sheet=new Image(),furniture=new Image(),iconSheet=new Image();// 進站加速（2026-09-18）：只保留實際用到的區塊並改存 WebP，三張圖由約 2.5 MB 降到約 340 KB。
sheet.src='assets/sprites-packed.webp?v=1';furniture.src='assets/furniture-packed.webp?v=1';iconSheet.src='assets/icons-v3.webp?v=1';
function resizeCanvas(){const scale=Math.max(1,Math.min(3,(window.devicePixelRatio||1)*game.getBoundingClientRect().width/W));game.width=Math.round(W*scale);game.height=Math.round(H*scale);ctx.setTransform(game.width/W,0,0,game.height/H,0,0);ctx.imageSmoothingEnabled=false;}
new ResizeObserver(resizeCanvas).observe(game);window.addEventListener('resize',resizeCanvas);resizeCanvas();
function load(img){return new Promise((resolve,reject)=>{img.onload=resolve;img.onerror=reject;if(img.complete&&img.naturalWidth)resolve();});}
// sprites-packed.webp：5 列（Leona、Amber、Noise、Anna、Machi）× 3 欄（正面、右側面、背面），每欄寬 140，列高沿用原圖。
const rowTops=[0,192,381,572,757], rowHeights=[192,189,191,185,189], colLefts=[0,140,280];
function sprite(context,index,dir,x,y,w=98,h=142){const col=dir==='up'?2:dir==='left'||dir==='right'?1:0;context.save();context.imageSmoothingEnabled=false;context.translate(x,y);if(dir==='left')context.scale(-1,1);context.drawImage(sheet,colLefts[col],rowTops[index],140,rowHeights[index],-w/2,-h,w,h);context.restore();}
function portrait(context,i){context.clearRect(0,0,context.canvas.width,context.canvas.height);if(ready)sprite(context,i,'down',context.canvas.width/2,context.canvas.height-3,95,144);}
function select(i){selected=i;keys.clear();$('personName').textContent=people[i].name;$('personDesc').textContent=descriptions[i];$('message').value=people[i].message;updateCount();document.querySelectorAll('.roster-button').forEach((b,n)=>b.classList.toggle('active',n===i));updateMood();updateStatus();updatePhoto();updateLevel();portrait($('portrait').getContext('2d'),i);}
function numberText(value){return Number(value).toLocaleString('zh-TW',{maximumFractionDigits:1});}
function levelTitle(level){if(level>=50)return '設計神話';if(level>=40)return '傳奇設計師';if(level>=30)return '設計大師';if(level>=20)return '設計菁英';if(level>=10)return '資深設計師';return '設計新秀';}
function levelFromScore(score){
  const safe=Math.max(0,Number(score)||0),level=Math.floor(Math.sqrt(safe/10))+1,current=10*(level-1)**2,next=10*level**2,progress=(safe-current)/(next-current)*100;
  return {score:safe,xp:safe*10,level,title:levelTitle(level),remaining:Math.max(0,next-safe),progress:Math.max(0,Math.min(100,progress))};
}
function updateLevel(){
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
async function syncLevels(){
  const urls=['/data/database_archive.json','https://emctaipeiart.github.io/data/database_archive.json'];let payload=null;
  for(const url of urls){try{const response=await fetch(url,{cache:'no-store'});if(!response.ok)throw Error(String(response.status));const candidate=await response.json();if(Array.isArray(candidate.rows)){payload=candidate;break;}}catch{}}
  if(!payload)return;
  const totals=scoreRows(payload.rows);levelStats=Object.fromEntries(names.map(name=>[name,levelFromScore(totals[name])]));levelIsLive=true;
  const timestamp=new Date(payload.generatedAt||Date.now());levelUpdatedAt=Number.isNaN(timestamp.getTime())?'最新快照':timestamp.toLocaleString('zh-TW',{timeZone:'Asia/Taipei',year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',hour12:false});
  document.querySelectorAll('.roster-level').forEach((element,i)=>element.textContent='Lv.'+levelStats[names[i]].level);updateLevel();
}
function updateCount(){$('count').textContent=$('message').value.length+' / 60';}
function updateStateText(){const p=people[selected],status=statuses.find(item=>item.id===p.status),mood=moods.find(item=>item.id===p.mood);$('moodStatus').textContent=p.status!=='present'?status.text:mood?mood.text:'自在工作中';}
function updateMood(){updateStateText();document.querySelectorAll('[data-mood]').forEach(b=>{const active=b.dataset.mood===people[selected].mood;b.classList.toggle('active',active);b.setAttribute('aria-pressed',String(active));});}
function setMood(id){people[selected].mood=id;updateMood();save();pushChange(selected,{mood:id});}
function updateStatus(){updateStateText();document.querySelectorAll('[data-status]').forEach(b=>{const active=b.dataset.status===people[selected].status;b.classList.toggle('active',active);b.setAttribute('aria-pressed',String(active));});}
function setStatus(id){const p=people[selected];p.status=id;if(id!=='present')keys.clear();updateStatus();save();pushChange(selected,{status:id});toast(id==='present'?p.name+' 回到座位':p.name+' · '+statuses.find(status=>status.id===id).text);}
function updatePhoto(){const photo=people[selected].photo;$('uploadLabel').hidden=!!photo;$('photoTools').hidden=!photo;if(photo)$('thumb').src=photo;else $('thumb').removeAttribute('src');}
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
// icons-v3.webp：3×3 正方形格子（每格 192×192，原檔 icons-v3.png 每格 256），每個圖示已裁到實際範圍並置中留白，不會被切到或變形。
function drawSymbol(context,symbol,cx,cy,size=48){const index=symbolCells[symbol];if(iconSheet.complete&&iconSheet.naturalWidth&&index!==undefined){const cell=iconSheet.naturalWidth/3,row=Math.floor(index/3),column=index%3;context.save();context.imageSmoothingEnabled=true;context.imageSmoothingQuality='high';context.drawImage(iconSheet,column*cell,row*cell,cell,cell,cx-size/2,cy-size/2,size,size);context.restore();return;}drawPixelSymbol(context,symbol,cx,cy,Math.max(2,Math.floor(size/10)));}
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
function applyRemote(list){
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
  if(!syncSeeded){syncSeeded=true;people.forEach((p,i)=>{if(seen.has(i))return;const patch={};if(p.message)patch.message=p.message;if(p.mood)patch.mood=p.mood;if(p.status!=='present')patch.status=p.status;if(p.x!==starts[i][0]||p.y!==starts[i][1]){patch.x=p.x;patch.y=p.y;patch.dir=p.dir;}if(p.photo)patch.photo=p.photo;if(Object.keys(patch).length)pushChange(i,patch);});}
  save(false);
}
async function pollSync(){try{const data=await syncCall({action:'pixelOfficeState',since:syncVersion});setSyncStatus(true);if(!data.unchanged){applyRemote(data.people);syncVersion=Number(data.version)||0;}}catch{setSyncStatus(false);}finally{setTimeout(pollSync,document.hidden?15000:3000);}}
document.addEventListener('visibilitychange',()=>{if(!document.hidden)syncCall({action:'pixelOfficeState',since:syncVersion}).then(data=>{if(!data.unchanged){applyRemote(data.people);syncVersion=Number(data.version)||0;}}).catch(()=>{});});
const walls=stations.map(s=>[s.x-122,s.y+18,244,80]);
function blocked(x,y){return x<65||x>W-65||y<180||y>H-20||walls.some(([a,b,w,h])=>x>a-14&&x<a+w+14&&y>b-4&&y<b+h+4);}
function moving(dt){if(!ready||$('lightbox').open||people[selected].status!=='present')return false;let dx=(keys.has('ArrowRight')?1:0)-(keys.has('ArrowLeft')?1:0),dy=(keys.has('ArrowDown')?1:0)-(keys.has('ArrowUp')?1:0);if(!dx&&!dy)return false;const p=people[selected],length=Math.hypot(dx,dy);p.dir=dx?(dx>0?'right':'left'):(dy>0?'down':'up');dx=dx/length*210*dt;dy=dy/length*210*dt;if(!blocked(p.x+dx,p.y))p.x+=dx;if(!blocked(p.x,p.y+dy))p.y+=dy;save();queuePosition(selected);return true;}
function typing(){const el=document.activeElement;return el&&(['INPUT','TEXTAREA','SELECT'].includes(el.tagName)||el.isContentEditable);}
window.addEventListener('keydown',e=>{if(!e.key.startsWith('Arrow')||typing()||$('lightbox').open)return;e.preventDefault();keys.add(e.key);});window.addEventListener('keyup',e=>keys.delete(e.key));window.addEventListener('blur',()=>keys.clear());document.addEventListener('visibilitychange',()=>keys.clear());
document.querySelectorAll('[data-key]').forEach(b=>{b.onpointerdown=e=>{e.preventDefault();keys.add(b.dataset.key);try{b.setPointerCapture(e.pointerId);}catch{}};b.onpointerup=b.onpointercancel=b.onlostpointercapture=()=>keys.delete(b.dataset.key);b.oncontextmenu=e=>e.preventDefault();});
game.addEventListener('pointerdown',e=>{if(!ready)return;const rect=game.getBoundingClientRect(),x=(e.clientX-rect.left)*W/rect.width,y=(e.clientY-rect.top)*H/rect.height;const hit=[...hits].reverse().find(h=>x>=h.x&&x<=h.x+h.w&&y>=h.y&&y<=h.y+h.h);if(hit){if(hit.type==='photo')openPhoto(hit.i);else{select(hit.i);game.focus({preventScroll:true});}}});
game.addEventListener('pointermove',e=>{const r=game.getBoundingClientRect(),x=(e.clientX-r.left)*W/r.width,y=(e.clientY-r.top)*H/r.height;game.style.cursor=hits.some(h=>x>=h.x&&x<=h.x+h.w&&y>=h.y&&y<=h.y+h.h)?'pointer':'default';});
// 細緻版面板：細邊框、圓角、柔和陰影（取代原本粗像素切角框）。
function softPanel(context,x,y,w,h,{radius=12,fill='#fffdf7',stroke='#c9d3e0',lineWidth=1.5,shadow=true}={}){context.save();const path=()=>{context.beginPath();context.roundRect(x,y,w,h,radius);};if(shadow){context.shadowColor='rgba(20,41,68,.18)';context.shadowBlur=14;context.shadowOffsetY=4;path();context.fillStyle=fill;context.fill();context.shadowColor='transparent';}path();context.fillStyle=fill;context.fill();context.strokeStyle=stroke;context.lineWidth=lineWidth;context.stroke();context.restore();}
function bubble(p,lift=0){if(!p.message)return;ctx.save();ctx.font='600 17px -apple-system,BlinkMacSystemFont,"PingFang TC","Noto Sans TC",sans-serif';const lines=[];let line='';for(const ch of p.message){if(ch==='\n'){lines.push(line);line='';continue;}if(ctx.measureText(line+ch).width>220&&line){lines.push(line);line=ch;}else line+=ch;}lines.push(line);const lineHeight=25,w=Math.max(90,...lines.map(text=>ctx.measureText(text).width+34)),h=lines.length*lineHeight+22,x=Math.max(10,Math.min(W-w-10,Math.round(p.x-w/2))),y=Math.max(10,Math.round(p.y-172-lift-h));const tipX=Math.max(x+20,Math.min(x+w-20,p.x));
  // 泡泡與尾巴畫成同一個外框，邊線連續，不會有接縫。
  const r=14,path=()=>{ctx.beginPath();ctx.moveTo(x+r,y);ctx.lineTo(x+w-r,y);ctx.arcTo(x+w,y,x+w,y+r,r);ctx.lineTo(x+w,y+h-r);ctx.arcTo(x+w,y+h,x+w-r,y+h,r);ctx.lineTo(tipX+9,y+h);ctx.quadraticCurveTo(tipX+2,y+h+4,tipX,y+h+12);ctx.quadraticCurveTo(tipX-3,y+h+4,tipX-9,y+h);ctx.lineTo(x+r,y+h);ctx.arcTo(x,y+h,x,y+h-r,r);ctx.lineTo(x,y+r);ctx.arcTo(x,y,x+r,y,r);ctx.closePath();};
  ctx.shadowColor='rgba(20,41,68,.18)';ctx.shadowBlur=14;ctx.shadowOffsetY=4;path();ctx.fillStyle='#fffdf7';ctx.fill();ctx.shadowColor='transparent';path();ctx.fillStyle='#fffdf7';ctx.fill();ctx.strokeStyle='#c9d3e0';ctx.lineWidth=1.5;ctx.stroke();
  ctx.fillStyle='#1d3350';ctx.textAlign='center';ctx.textBaseline='middle';const centerY=y+h/2;lines.forEach((text,index)=>ctx.fillText(text,x+w/2,centerY+(index-(lines.length-1)/2)*lineHeight));ctx.restore();}
/** 點選人物時，頭上顯示等級與稱號。 */
function levelTag(i){const p=people[i],stat=levelStats[p.name]||levelFromScore(0),label=`Lv.${stat.level}`,title=stat.title;ctx.save();ctx.font='800 13px -apple-system,BlinkMacSystemFont,"PingFang TC","Noto Sans TC",sans-serif';const lw=ctx.measureText(label).width;ctx.font='600 12px -apple-system,BlinkMacSystemFont,"PingFang TC","Noto Sans TC",sans-serif';const tw=ctx.measureText(title).width;const w=Math.round(lw+tw+34),h=26,x=Math.round(Math.max(8,Math.min(W-w-8,p.x-w/2))),y=Math.round(p.y-164-h);softPanel(ctx,x,y,w,h,{radius:13,fill:'#172d4c',stroke:'#e9b94e',lineWidth:1.5});ctx.textBaseline='middle';ctx.textAlign='left';ctx.font='800 13px -apple-system,BlinkMacSystemFont,"PingFang TC","Noto Sans TC",sans-serif';ctx.fillStyle='#ffdf75';ctx.fillText(label,x+12,y+h/2+.5);ctx.font='600 12px -apple-system,BlinkMacSystemFont,"PingFang TC","Noto Sans TC",sans-serif';ctx.fillStyle='#e8eef7';ctx.fillText(title,x+22+lw,y+h/2+.5);ctx.restore();return h+8;}
function stationPerson(s){return s.name?people.find(person=>person.name===s.name):null;}
function stationAway(s){const person=stationPerson(s);return person&&person.status!=='present';}
function withStationStyle(s,draw){ctx.save();if(stationAway(s))ctx.filter='grayscale(1) brightness(.72)';draw();ctx.restore();}
function drawOffice(){ctx.fillStyle='#fff';ctx.fillRect(0,0,W,H);}
// furniture-packed.webp：只保留四種家具（兩種桌、Mac Studio 桌、椅子）重新排列。
const furnitureRects=[[0,0,532,335],[0,335,553,334],[0,669,553,318],[553,0,284,445]];
function furnitureObject(type,x,y,w,h){ctx.imageSmoothingEnabled=false;ctx.drawImage(furniture,...furnitureRects[type],x,y,w,h);}
function drawChair(s){withStationStyle(s,()=>furnitureObject(3,s.x-51,s.y-135,102,135));}
function drawDesk(s){withStationStyle(s,()=>{const [sx,sy,sw,sh]=furnitureRects[s.type],top=sy+(s.type===2?28:68),front=sy+(s.type===2?250:266),upperHeight=s.type===2?14:37;ctx.imageSmoothingEnabled=false;ctx.drawImage(furniture,sx,sy,sw,top-sy,s.x-125,s.y-40-upperHeight,250,upperHeight);ctx.drawImage(furniture,sx,top,sw,front-top,s.x-125,s.y-40,250,110);ctx.drawImage(furniture,sx,front,sw,sy+sh-front,s.x-125,s.y+70,250,36);if(s.name){ctx.fillStyle='#fff7e5';ctx.strokeStyle='#182c48';ctx.lineWidth=2;ctx.fillRect(s.x-42,s.y+56,84,23);ctx.strokeRect(s.x-42,s.y+56,84,23);ctx.fillStyle='#223652';ctx.textAlign='center';ctx.font='bold 15px sans-serif';ctx.fillText(s.name,s.x,s.y+73);}});}
function drawPerson(i,time,walk){const p=people[i];if(p.status!=='present')return;const t=time/1000;let bob=walk&&selected===i?Math.sin(t*17)*3:0,tilt=0;if(p.mood==='happy')bob-=Math.abs(Math.sin(t*4))*12;if(p.mood==='angry')bob+=Math.sin(t*24)*2;if(p.mood==='joy'){tilt=Math.sin(t*7)*.1;bob-=Math.abs(Math.sin(t*7))*8;}if(p.mood==='sad')tilt=Math.sin(t*2)*.035;ctx.save();ctx.translate(p.x,p.y);if(i===selected){ctx.strokeStyle='#e9b94e';ctx.fillStyle='#ffdd7828';ctx.lineWidth=4;ctx.beginPath();ctx.ellipse(0,-2,45,12,0,0,Math.PI*2);ctx.fill();ctx.stroke();}ctx.rotate(tilt);sprite(ctx,i,p.dir,0,bob);ctx.restore();hits.push({type:'person',i,x:p.x-53,y:p.y-150,w:106,h:150});}
function drawPhotoCard(i){const p=people[i];if(!p.photo)return;let image=photoImages.get(i);if(!image){image=new Image();image.src=p.photo;photoImages.set(i,image);}const side=p.x>W-155?-1:1,x=Math.round(side>0?p.x+64:p.x-140),y=Math.round(p.y-151),w=76,h=70;softPanel(ctx,x,y,w,h,{radius:10,fill:'#fff',stroke:'#c9d3e0'});if(image.complete&&image.naturalWidth){ctx.save();ctx.beginPath();ctx.roundRect(x+5,y+5,w-10,h-24,7);ctx.clip();ctx.imageSmoothingEnabled=true;ctx.imageSmoothingQuality='high';const boxW=w-10,boxH=h-24,scale=Math.max(boxW/image.naturalWidth,boxH/image.naturalHeight),dw=image.naturalWidth*scale,dh=image.naturalHeight*scale;ctx.drawImage(image,x+5+(boxW-dw)/2,y+5+(boxH-dh)/2,dw,dh);ctx.restore();}ctx.save();ctx.fillStyle='#5b6d87';ctx.font='700 9px -apple-system,BlinkMacSystemFont,sans-serif';ctx.textAlign='center';ctx.textBaseline='middle';ctx.fillText('點開看看',x+w/2,y+h-9.5);ctx.restore();hits.push({type:'photo',i,x,y,w,h});}
function drawOverlay(i){const p=people[i];if(p.status!=='present')return;const lift=i===selected?levelTag(i):0;bubble(p,lift);drawPhotoCard(i);const mood=moods.find(item=>item.id===p.mood);if(mood){const side=p.photo?-1:(p.x>W-120?-1:1),x=p.x+side*80,y=p.y-124;drawSymbol(ctx,mood.symbol,x,y,56);}}
function drawStatusMarker(s){const p=stationPerson(s);if(!p||p.status==='present')return;const status=statuses.find(item=>item.id===p.status),x=s.x,y=s.y-158;drawSymbol(ctx,status.symbol,x,y-34,64);ctx.save();ctx.font='700 13px -apple-system,BlinkMacSystemFont,"PingFang TC","Noto Sans TC",sans-serif';ctx.textAlign='center';ctx.textBaseline='middle';ctx.lineJoin='round';ctx.lineWidth=4;ctx.strokeStyle='#ffffff';ctx.strokeText(status.label,x,y+8);ctx.fillStyle='#273b50';ctx.fillText(status.label,x,y+8);ctx.restore();hits.push({type:'status',i:names.indexOf(p.name),x:x-40,y:y-68,w:80,h:86});}
function render(time){const dt=Math.min((time-last)/1000||0,.04);last=time;const walk=moving(dt);ctx.clearRect(0,0,W,H);drawOffice();if(ready){hits=[];const layers=[];stations.forEach(s=>{layers.push({depth:s.y-20,draw:()=>drawChair(s)});layers.push({depth:s.y+106,draw:()=>drawDesk(s)});});people.forEach((p,i)=>layers.push({depth:p.y,draw:()=>drawPerson(i,time,walk)}));layers.sort((a,b)=>a.depth-b.depth).forEach(layer=>layer.draw());people.forEach((p,i)=>drawOverlay(i));stations.forEach(drawStatusMarker);}requestAnimationFrame(render);}
// 圖示不擋進站：人物與家具載好就開始畫，圖示載入前先用內建的像素小圖。
load(iconSheet).then(refreshIconCanvases).catch(()=>{});
Promise.all([load(sheet),load(furniture)]).then(()=>{ready=true;$('loading').hidden=true;refreshIconCanvases();select(0);document.querySelectorAll('.roster-button canvas:not([data-symbol])').forEach((canvas,i)=>portrait(canvas.getContext('2d'),i));}).catch(()=>{$('loading').textContent='場景圖片載入失敗，請重新整理頁面。';});select(0);syncLevels();pollSync();requestAnimationFrame(render);
if(document.modelContext?.registerTool){try{document.modelContext.registerTool({name:'set_character_status',description:'選取設計師並設定心情、出勤狀態與頭頂對話。照片與對話僅儲存於本機瀏覽器。',inputSchema:{type:'object',properties:{name:{type:'string',enum:names},message:{type:'string',maxLength:60},mood:{type:'string',enum:['','happy','angry','sad','joy']},status:{type:'string',enum:['present','offwork','toilet','abroad','out']}},required:['name'],additionalProperties:false},annotations:{readOnlyHint:false},execute(input){if(!input||!names.includes(input.name)||input.message!==undefined&&(typeof input.message!=='string'||input.message.length>60)||input.mood!==undefined&&!['','happy','angry','sad','joy'].includes(input.mood)||input.status!==undefined&&!statuses.some(status=>status.id===input.status))throw Error('人物、對話、心情或狀態無效');const i=names.indexOf(input.name);if(input.message!==undefined)people[i].message=input.message;if(input.mood!==undefined)people[i].mood=input.mood;if(input.status!==undefined)people[i].status=input.status;select(i);save();const patch={};for(const key of ['message','mood','status'])if(input[key]!==undefined)patch[key]=input[key];pushChange(i,patch);return {name:people[i].name,message:people[i].message,mood:people[i].mood,status:people[i].status};}});}catch{}}

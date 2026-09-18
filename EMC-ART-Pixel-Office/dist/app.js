'use strict';
const $=id=>document.getElementById(id), game=$('game'), ctx=game.getContext('2d'), W=1536,H=1024;
const names=['Leona','Amber','Noise','Anna','Machi'], descriptions=['黑髮・時髦日常','暖色・樸素自在','短髮・專注模式','長髮・粉色靈感','挑染・街頭風格'];
const starts=[[548,355],[768,355],[988,355],[768,695],[988,695]];
const fallbackScores={Machi:10832,Anna:4749.5,Amber:2905,Leona:1907,Noise:1404.5};
descriptions[2]='藍帽・夏日休閒';
let levelStats=Object.fromEntries(names.map(name=>[name,levelFromScore(fallbackScores[name])]));
let levelUpdatedAt='',levelIsLive=false;
const stations=[{x:548,y:355,type:0,name:'Leona'},{x:768,y:355,type:0,name:'Amber'},{x:988,y:355,type:1,name:'Noise'},{x:548,y:695,type:2,name:''},{x:768,y:695,type:0,name:'Anna'},{x:988,y:695,type:0,name:'Machi'}];
const moods=[{id:'happy',icon:'😊',label:'喜',text:'開心跳一下'},{id:'angry',icon:'😤',label:'怒',text:'氣噗噗跺腳'},{id:'sad',icon:'😢',label:'哀',text:'低落搖搖頭'},{id:'joy',icon:'🥳',label:'樂',text:'快樂左右舞'}];
let people=names.map((name,i)=>({name,x:starts[i][0],y:starts[i][1],dir:'down',mood:'',message:'',photo:''})), selected=0,ready=false, keys=new Set(), last=0, saveTimer, photoImages=new Map(), hits=[];
try{const saved=JSON.parse(localStorage.getItem('kaiyao-office-v1')||'null');if(Array.isArray(saved))people.forEach((p,i)=>{const s=saved[i];if(!s)return;p.message=typeof s.message==='string'?s.message.slice(0,60):'';p.mood=moods.some(m=>m.id===s.mood)?s.mood:'';p.photo=typeof s.photo==='string'&&s.photo.startsWith('data:image/')?s.photo:'';if(localStorage.getItem('kaiyao-office-layout')==='4'&&Number.isFinite(s.x)&&Number.isFinite(s.y)){p.x=Math.max(65,Math.min(W-65,s.x));p.y=Math.max(180,Math.min(H-20,s.y));}});}catch{}
function toast(message){$('toast').textContent=message;$('toast').classList.add('visible');clearTimeout(toast.timer);toast.timer=setTimeout(()=>$('toast').classList.remove('visible'),2500);}
function save(){clearTimeout(saveTimer);saveTimer=setTimeout(()=>{try{localStorage.setItem('kaiyao-office-v1',JSON.stringify(people));localStorage.setItem('kaiyao-office-layout','4');}catch{toast('瀏覽器空間不足，這次變更尚未保存。請移除部分照片。');}},200);}
const sheet=new Image(),furniture=new Image();sheet.src='assets/sprites-noise.png?v=2';furniture.src='assets/furniture.png';
function resizeCanvas(){const scale=Math.max(1,Math.min(3,(window.devicePixelRatio||1)*game.getBoundingClientRect().width/W));game.width=Math.round(W*scale);game.height=Math.round(H*scale);ctx.setTransform(game.width/W,0,0,game.height/H,0,0);ctx.imageSmoothingEnabled=false;}
new ResizeObserver(resizeCanvas).observe(game);window.addEventListener('resize',resizeCanvas);resizeCanvas();
function load(img){return new Promise((resolve,reject)=>{img.onload=resolve;img.onerror=reject;if(img.complete&&img.naturalWidth)resolve();});}
const rowTops=[49,249,444,640,832], rowHeights=[192,189,191,185,189], colCenters=[435,830,1258];
function sprite(context,index,dir,x,y,w=98,h=142){const col=dir==='up'?2:dir==='left'||dir==='right'?1:0;context.save();context.imageSmoothingEnabled=false;context.translate(x,y);if(dir==='left')context.scale(-1,1);context.drawImage(sheet,colCenters[col]-70,rowTops[index],140,rowHeights[index],-w/2,-h,w,h);context.restore();}
function portrait(context,i){context.clearRect(0,0,context.canvas.width,context.canvas.height);if(ready)sprite(context,i,'down',context.canvas.width/2,context.canvas.height-3,95,144);}
function select(i){selected=i;keys.clear();$('personName').textContent=people[i].name;$('personDesc').textContent=descriptions[i];$('message').value=people[i].message;updateCount();document.querySelectorAll('.roster-button').forEach((b,n)=>b.classList.toggle('active',n===i));updateMood();updatePhoto();updateLevel();portrait($('portrait').getContext('2d'),i);}
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
function updateMood(){const m=moods.find(m=>m.id===people[selected].mood);$('moodStatus').textContent=m?m.icon+' '+m.text:'自在工作中';document.querySelectorAll('[data-mood]').forEach(b=>{const active=b.dataset.mood===people[selected].mood;b.classList.toggle('active',active);b.setAttribute('aria-pressed',String(active));});}
function setMood(id){people[selected].mood=id;updateMood();save();}
function updatePhoto(){const photo=people[selected].photo;$('uploadLabel').hidden=!!photo;$('photoTools').hidden=!photo;if(photo)$('thumb').src=photo;else $('thumb').removeAttribute('src');}
function openPhoto(i){if(!people[i].photo)return;keys.clear();$('fullPhoto').src=people[i].photo;$('photoCaption').textContent=people[i].name+' 分享的照片';$('lightbox').showModal();}
names.forEach((name,i)=>{const b=document.createElement('button');b.className='roster-button';b.setAttribute('aria-label','選取 '+name);const c=document.createElement('canvas'),label=document.createElement('span'),level=document.createElement('span');c.width=110;c.height=150;label.className='roster-name';label.textContent=name;level.className='roster-level';level.textContent='Lv.'+levelStats[name].level;b.append(c,label,level);b.onclick=()=>{select(i);game.focus({preventScroll:true});};$('roster').append(b);});
moods.forEach(m=>{const b=document.createElement('button');b.dataset.mood=m.id;b.title=m.text;b.innerHTML='<span>'+m.icon+'</span>'+m.label;b.onclick=()=>setMood(m.id);$('moods').append(b);});
$('neutral').onclick=()=>setMood('');$('message').oninput=updateCount;$('say').onclick=()=>{people[selected].message=$('message').value.trim();save();toast(people[selected].message?'對話已放到人物上方':'已清除對話');game.focus({preventScroll:true});};
$('photo').onchange=async e=>{const file=e.target.files[0],index=selected;e.target.value='';if(!file)return;if(!['image/jpeg','image/png','image/webp'].includes(file.type)){toast('請選擇 JPG、PNG 或 WebP 圖片。');return;}if(file.size>8*1024*1024){toast('照片太大，請選擇 8 MB 以下的圖片。');return;}try{const url=URL.createObjectURL(file),img=new Image();img.src=url;try{await load(img);const c=document.createElement('canvas'),scale=Math.min(1,1200/Math.max(img.width,img.height));c.width=Math.round(img.width*scale);c.height=Math.round(img.height*scale);c.getContext('2d').drawImage(img,0,0,c.width,c.height);people[index].photo=c.toDataURL('image/jpeg',.8);photoImages.delete(index);save();if(selected===index)updatePhoto();toast('照片已加入，點人物旁的小照片即可放大。');}finally{URL.revokeObjectURL(url);}}catch{toast('無法讀取這張圖片，請換一張再試。');}};
$('expand').onclick=()=>openPhoto(selected);$('removePhoto').onclick=()=>{people[selected].photo='';photoImages.delete(selected);updatePhoto();save();};$('closePhoto').onclick=()=>$('lightbox').close();$('lightbox').onclick=e=>{if(e.target===$('lightbox'))$('lightbox').close();};
$('home').onclick=()=>{people.forEach((p,i)=>{p.x=starts[i][0];p.y=starts[i][1];p.dir='down';});save();toast('大家都回到自己的座位附近了');};
const walls=stations.map(s=>[s.x-122,s.y+18,244,80]);
function blocked(x,y){return x<65||x>W-65||y<180||y>H-20||walls.some(([a,b,w,h])=>x>a-14&&x<a+w+14&&y>b-4&&y<b+h+4);}
function moving(dt){if(!ready||$('lightbox').open)return false;let dx=(keys.has('ArrowRight')?1:0)-(keys.has('ArrowLeft')?1:0),dy=(keys.has('ArrowDown')?1:0)-(keys.has('ArrowUp')?1:0);if(!dx&&!dy)return false;const p=people[selected],length=Math.hypot(dx,dy);p.dir=dx?(dx>0?'right':'left'):(dy>0?'down':'up');dx=dx/length*210*dt;dy=dy/length*210*dt;if(!blocked(p.x+dx,p.y))p.x+=dx;if(!blocked(p.x,p.y+dy))p.y+=dy;save();return true;}
function typing(){const el=document.activeElement;return el&&(['INPUT','TEXTAREA','SELECT'].includes(el.tagName)||el.isContentEditable);}
window.addEventListener('keydown',e=>{if(!e.key.startsWith('Arrow')||typing()||$('lightbox').open)return;e.preventDefault();keys.add(e.key);});window.addEventListener('keyup',e=>keys.delete(e.key));window.addEventListener('blur',()=>keys.clear());document.addEventListener('visibilitychange',()=>keys.clear());
document.querySelectorAll('[data-key]').forEach(b=>{b.onpointerdown=e=>{e.preventDefault();b.setPointerCapture(e.pointerId);keys.add(b.dataset.key);};b.onpointerup=b.onpointercancel=()=>keys.delete(b.dataset.key);});
game.addEventListener('pointerdown',e=>{if(!ready)return;const rect=game.getBoundingClientRect(),x=(e.clientX-rect.left)*W/rect.width,y=(e.clientY-rect.top)*H/rect.height;const hit=[...hits].reverse().find(h=>x>=h.x&&x<=h.x+h.w&&y>=h.y&&y<=h.y+h.h);if(hit){if(hit.type==='photo')openPhoto(hit.i);else{select(hit.i);game.focus({preventScroll:true});}}});
game.addEventListener('pointermove',e=>{const r=game.getBoundingClientRect(),x=(e.clientX-r.left)*W/r.width,y=(e.clientY-r.top)*H/r.height;game.style.cursor=hits.some(h=>x>=h.x&&x<=h.x+h.w&&y>=h.y&&y<=h.y+h.h)?'pointer':'default';});
function bubble(p){
  if(!p.message)return;
  ctx.save();ctx.font='20px sans-serif';
  const lines=[];let line='';
  for(const ch of p.message){
    if(ch==='\n'){lines.push(line);line='';continue;}
    if(ctx.measureText(line+ch).width>190&&line){lines.push(line);line=ch;}else line+=ch;
  }
  lines.push(line);
  const lineHeight=28,w=Math.max(80,...lines.map(l=>ctx.measureText(l).width+32)),h=lines.length*lineHeight+24;
  const x=Math.max(8,Math.min(W-w-8,p.x-w/2)),y=Math.max(8,p.y-165-h);
  ctx.fillStyle='#fff';ctx.strokeStyle='#bbc9df';ctx.lineWidth=2;
  ctx.beginPath();ctx.roundRect(x,y,w,h,12);ctx.fill();ctx.stroke();
  const tipX=Math.max(x+14,Math.min(x+w-14,p.x));
  ctx.beginPath();ctx.moveTo(tipX-7,y+h);ctx.lineTo(tipX,y+h+9);ctx.lineTo(tipX+7,y+h);ctx.fill();
  ctx.fillStyle='#1c3457';ctx.textAlign='center';ctx.textBaseline='middle';
  const centerY=y+h/2;
  lines.forEach((l,j)=>ctx.fillText(l,x+w/2,centerY+(j-(lines.length-1)/2)*lineHeight));
  ctx.restore();
}
// Each furniture object is independently rendered from the transparent atlas.
const furnitureRects=[[54,242,532,335],[656,242,553,334],[50,780,553,318],[797,702,284,445]];
function furnitureObject(type,x,y,w,h){ctx.imageSmoothingEnabled=false;ctx.drawImage(furniture,...furnitureRects[type],x,y,w,h);}
function drawChair(s){furnitureObject(3,s.x-51,s.y-135,102,135);}
function drawDesk(s){const [sx,sy,sw,sh]=furnitureRects[s.type];const top=s.type===2?808:310,front=s.type===2?1030:508;const upperHeight=s.type===2?14:37;ctx.imageSmoothingEnabled=false;ctx.drawImage(furniture,sx,sy,sw,top-sy,s.x-125,s.y-40-upperHeight,250,upperHeight);ctx.drawImage(furniture,sx,top,sw,front-top,s.x-125,s.y-40,250,110);ctx.drawImage(furniture,sx,front,sw,sy+sh-front,s.x-125,s.y+70,250,36);if(s.name){ctx.fillStyle='#fff7e5';ctx.strokeStyle='#182c48';ctx.lineWidth=2;ctx.fillRect(s.x-42,s.y+56,84,23);ctx.strokeRect(s.x-42,s.y+56,84,23);ctx.fillStyle='#223652';ctx.textAlign='center';ctx.font='bold 15px sans-serif';ctx.fillText(s.name,s.x,s.y+73);}}
function drawPerson(i,time,walk){const p=people[i],t=time/1000;let bob=walk&&selected===i?Math.sin(t*17)*3:0,tilt=0;if(p.mood==='happy')bob-=Math.abs(Math.sin(t*4))*12;if(p.mood==='angry')bob+=Math.sin(t*24)*2;if(p.mood==='joy'){tilt=Math.sin(t*7)*.1;bob-=Math.abs(Math.sin(t*7))*8;}if(p.mood==='sad')tilt=Math.sin(t*2)*.035;ctx.save();ctx.translate(p.x,p.y);if(i===selected){ctx.strokeStyle='#e9b94e';ctx.fillStyle='#ffdd7828';ctx.lineWidth=3;ctx.beginPath();ctx.ellipse(0,-2,45,12,0,0,Math.PI*2);ctx.fill();ctx.stroke();}ctx.rotate(tilt);sprite(ctx,i,p.dir,0,bob);ctx.restore();hits.push({type:'person',i,x:p.x-53,y:p.y-150,w:106,h:150});}
function drawOverlay(i){const p=people[i];ctx.textAlign='center';ctx.textBaseline='alphabetic';const m=moods.find(m=>m.id===p.mood);if(m){ctx.font='29px sans-serif';ctx.fillText(m.icon,p.x+50,p.y-125);}bubble(p);if(p.photo){let im=photoImages.get(i);if(!im){im=new Image();im.src=p.photo;photoImages.set(i,im);}const x=p.x+51,y=p.y-135;ctx.fillStyle='white';ctx.strokeStyle='#728baa';ctx.lineWidth=2;ctx.fillRect(x-4,y-4,56,48);ctx.strokeRect(x-4,y-4,56,48);if(im.complete&&im.naturalWidth)ctx.drawImage(im,x,y,48,36);hits.push({type:'photo',i,x:x-5,y:y-5,w:60,h:52});}}
function render(time){const dt=Math.min((time-last)/1000||0,.04);last=time;const walk=moving(dt);ctx.clearRect(0,0,W,H);ctx.fillStyle='#fff';ctx.fillRect(0,0,W,H);if(ready){hits=[];const layers=[];stations.forEach(s=>{layers.push({depth:s.y-20,draw:()=>drawChair(s)});layers.push({depth:s.y+106,draw:()=>drawDesk(s)});});people.forEach((p,i)=>layers.push({depth:p.y,draw:()=>drawPerson(i,time,walk)}));layers.sort((a,b)=>a.depth-b.depth).forEach(l=>l.draw());people.forEach((p,i)=>drawOverlay(i));}requestAnimationFrame(render);}
Promise.all([load(sheet),load(furniture)]).then(()=>{ready=true;$('loading').hidden=true;select(0);document.querySelectorAll('.roster-button canvas').forEach((c,i)=>portrait(c.getContext('2d'),i));}).catch(()=>{$('loading').textContent='場景圖片載入失敗，請重新整理頁面。';});select(0);syncLevels();requestAnimationFrame(render);
if(document.modelContext?.registerTool){try{document.modelContext.registerTool({name:'set_character_status',description:'選取設計師並設定心情與頭頂對話。照片與對話僅儲存於本機瀏覽器。',inputSchema:{type:'object',properties:{name:{type:'string',enum:names},message:{type:'string',maxLength:60},mood:{type:'string',enum:['','happy','angry','sad','joy']}},required:['name'],additionalProperties:false},annotations:{readOnlyHint:false},execute(input){if(!input||!names.includes(input.name)||input.message!==undefined&&(typeof input.message!=='string'||input.message.length>60)||input.mood!==undefined&&!['','happy','angry','sad','joy'].includes(input.mood))throw Error('人物、對話或心情無效');const i=names.indexOf(input.name);if(input.message!==undefined)people[i].message=input.message;if(input.mood!==undefined)people[i].mood=input.mood;select(i);save();return {name:people[i].name,message:people[i].message,mood:people[i].mood};}});}catch{}}

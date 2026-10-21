'use strict';
(() => {
 const nodeCache=new Map(),$=s=>{if(!nodeCache.has(s))nodeCache.set(s,document.querySelector(s));return nodeCache.get(s);},canvas=$('#stage'),ctx=canvas.getContext('2d');
 const roomCache=document.createElement('canvas');let roomKey='',uiKey='',renderCount=0,renderWork=0,metricsAt=0;
 function put(selector,value){const el=$(selector),text=String(value);if(el.textContent!==text){el.textContent=text;if(['#score','#best','#hud-score','#kos'].includes(selector))el.dataset.digits=String(text.length);}}
 const combatFX=new window.ArenaCombatFX();
 const names=['Amber','Anna','Leona','Machi','Noise','余采馨','吳冠賢','李明庭','廖秦葦','鄭筱舢','黎子瑄'];
 const characters=names.map((name,i)=>{const image=new Image(),back=new Image();back.src=`assets/${i<5?'designer':'staff'}_${name}_back.png`;image.src=`assets/${i<5?'designer':'staff'}_${name}_front.png`;return {name,image,back};});
 /* 未登入使用者：第 12 位「半透明人」，只當自己的身份用（一對一對戰），不會出現在上場名單／陪練角色 */
 const GHOST=names.length;
 {const g={name:'未登入使用者',image:new Image(),back:new Image()};g.back.src='assets/ghost_unknown_back.png';g.image.src='assets/ghost_unknown_front.png';characters.push(g);}
 const weapons=[
  {name:'拳頭',power:8,rage:7,color:'#f6b89d'},
  {name:'藍白拖',power:11,rage:6,color:'#89c8f6'},
  {name:'平底鍋',power:15,rage:5,color:'#d2d8d8'},
  {name:'鍵盤',power:12,rage:6,color:'#bfe5d3'},
  {name:'奶油派',power:10,rage:8,color:'#fff1be'},
  {name:'橡皮雞',power:9,rage:9,color:'#ffe07e'},
  {name:'雷擊',power:18,rage:4,color:'#bdfb9b'},
  {name:'文件風暴',power:14,rage:5,color:'#b8dfdb'}
 ];
 const scenes=(window.ArenaScenes?window.ArenaScenes.names:['辦公室','擂台場','練舞室','垃圾場']).map(name=>({name}));
 const lines=['這個修改，真的是最後一版！','先喝口水，我們再來！','我的咖啡還沒喝完耶！','好啦好啦，今天準時下班！','有事好商量，先別加需求！','收到！這次一定不已讀！'];
 let state={player:GHOST,target:GHOST,role:'target',weapon:0,scene:0,mode:'free',running:true,remaining:60,score:0,kos:0,hits:0,hp:300,rage:0,combo:0,maxCombo:0,lastHit:-Infinity,hitUntil:0,attackUntil:0,knockUntil:0,ultUntil:0,ultCount:0};
 let best=0,sound=true,audio,particles=[],texts=[],holding=false,nextAuto=0,lastFrame=0,raf=0,toastTimer=0,bubbleUntil=0,width=0,height=0;
 let duel=null,duelSaved=null;
 const reduced=matchMedia('(prefers-reduced-motion: reduce)').matches;
 try{best=Math.max(0,Number(localStorage.getItem('emcVentArenaBestV1'))||0);}catch{}
 function saveBest(){if(state.score>best){best=state.score;try{localStorage.setItem('emcVentArenaBestV1',String(best));}catch{}}}
 function toast(text){$('#toast').textContent=text;$('#toast').classList.add('visible');clearTimeout(toastTimer);toastTimer=setTimeout(()=>$('#toast').classList.remove('visible'),2500);}
 function say(text){$('#bubble').textContent=text;bubbleUntil=performance.now()+3500;}
 let boundPlayer=-1;/* 登入帳號對應的角色（沒登入或不在名單內＝-1，預設 Amber） */
 function roster(){
  $('#roster').replaceChildren(...characters.slice(0,GHOST).map((c,i)=>{const b=document.createElement('button');b.className='person';const chosen=state[state.role]===i;b.classList.toggle('active',chosen);b.setAttribute('aria-pressed',String(chosen));b.setAttribute('aria-label',`選擇 ${c.name} 為${state.role==='player'?'我的角色':'陪練角色'}`);const img=c.image.cloneNode();img.alt='';const text=document.createElement('span');text.innerHTML=`<strong>${c.name}</strong>`;const number=document.createElement('span');number.textContent=chosen?'✓':String(i+1).padStart(2,'0');b.append(img,text,number);b.onclick=()=>{if(duel){say('對戰中不能更換角色');return;}if(state.role==='player'&&boundPlayer>=0&&i!==boundPlayer){say(`你的角色已綁定帳號：${names[boundPlayer]}`);return;}if(state[state.role]!==i){state[state.role]=i;state.hp=300;combatFX.reset();state.knockUntil=0;state.combo=0;state.lastHit=-Infinity;particles=[];texts=[];say(`${c.name} 已上場，輕鬆玩一局！`);}roster();update();wake();};return b;}));
 }
 function update(){
  if(duel)return;
  const now=performance.now(),ready=state.rage>=100&&state.running&&now>=state.knockUntil,combo=state.combo>=2&&now-state.lastHit<1200?state.combo:0,seconds=Math.ceil(state.remaining),impact=now<state.hitUntil,ult=now<state.ultUntil;
  const key=[ready,combo,seconds,impact,ult,state.hp,state.score,state.kos,best,state.target,state.player,state.rage,state.hits,state.maxCombo,state.scene,state.mode,state.running].join('|');if(key===uiKey)return;uiKey=key;
  $('#ultimate').classList.toggle('ready',ready);$('.rage-panel').classList.toggle('charged',ready);$('#arena').classList.toggle('ultimate-scene',ult);$('#arena').classList.toggle('impact',impact);$('#arena').classList.toggle('danger',state.hp<90);
  put('#injury-status',state.hp===300?'狀態完好':state.hp>210?'鼻子紅紅的':state.hp>90?'流鼻血、頭頂長包':'腫包累積、暈頭轉向');$('#injury-status').dataset.level=state.hp>210?'light':state.hp>90?'medium':'heavy';
  $('#health-fill').style.background=state.hp>150?'#22c55e':state.hp>75?'#ffd27c':'#ff8c8f';$('#health-fill').style.width=state.hp/3+'%';$('#rage-fill').style.width=state.rage+'%';$('#ultimate').disabled=!ready;
  put('#score',state.score.toLocaleString());put('#hud-score',state.score.toLocaleString());put('#kos',state.kos);put('#best',best.toLocaleString());put('#target-name',characters[state.target].name);put('#foe-name',characters[state.target].name);put('#player-name',characters[state.player].name);put('#hp-number',state.hp+' / 300');put('#rage-text',state.rage+'%');put('#combo strong',state.combo);$('#combo').classList.toggle('visible',combo>0);put('#timer',state.mode==='free'?'∞':String(seconds).padStart(2,'0'));
 }
 // Short cartoon Foley motifs, with bounded voices during rapid-fire attacks.
 let fxBus,fxVoices=[];
 function tone(heavy=false){if(!sound)return;try{
  audio||=new(window.AudioContext||window.webkitAudioContext)();if(audio.state==='suspended')audio.resume();
  if(!fxBus){fxBus=audio.createDynamicsCompressor();fxBus.threshold.value=-14;fxBus.knee.value=16;fxBus.ratio.value=5;fxBus.attack.value=.003;fxBus.release.value=.12;fxBus.connect(audio.destination);}
  const now=audio.currentTime,v=.93+Math.random()*.14;
  const keep=node=>{fxVoices.push(node);node.onended=()=>{const i=fxVoices.indexOf(node);if(i>=0)fxVoices.splice(i,1);node.disconnect();};while(fxVoices.length>24){const old=fxVoices.shift();try{old.stop();}catch{}}};
  function note(type,points,duration,gain=.15,delay=0){const o=audio.createOscillator(),g=audio.createGain(),t=now+delay;o.type=type;o.frequency.setValueAtTime(points[0][1]*v,t);for(const [dt,f] of points.slice(1))o.frequency.exponentialRampToValueAtTime(Math.max(20,f*v),t+dt);g.gain.setValueAtTime(.001,t);g.gain.linearRampToValueAtTime(gain,t+.006);g.gain.exponentialRampToValueAtTime(.001,t+duration);o.connect(g);g.connect(fxBus);keep(o);o.addEventListener('ended',()=>g.disconnect(),{once:true});o.start(t);o.stop(t+duration+.01);}
  function puff(duration,freq,gain=.13,delay=0){const t=now+delay,buf=audio.createBuffer(1,Math.ceil(audio.sampleRate*duration),audio.sampleRate),d=buf.getChannelData(0);for(let i=0;i<d.length;i++)d[i]=(Math.random()*2-1);const src=audio.createBufferSource(),f=audio.createBiquadFilter(),g=audio.createGain();src.buffer=buf;f.type='bandpass';f.frequency.value=freq;f.Q.value=.8;g.gain.setValueAtTime(gain,t);g.gain.exponentialRampToValueAtTime(.001,t+duration);src.connect(f);f.connect(g);g.connect(fxBus);keep(src);src.addEventListener('ended',()=>{f.disconnect();g.disconnect();},{once:true});src.start(t);src.stop(t+duration);}
  if(heavy){note('sawtooth',[[0,180],[.07,460],[.28,55],[.48,30]],.5,.18);[0,.09,.18].forEach((t,i)=>{puff(.15,1000+i*650,.15,t);note('triangle',[[0,700+i*300],[.12,160]],.16,.12,t);});return;}
  switch(state.weapon){
   case 0:note('sine',[[0,220],[.025,85],[.07,330],[.15,100],[.23,170]],.25,.23);puff(.06,650,.12);break;
   case 1:puff(.075,1550,.3);note('sine',[[0,470],[.035,130],[.09,260],[.15,75]],.17,.23);puff(.05,2300,.13,.065);break;
   case 2:[420,710,1130,1580].forEach((f,i)=>note('sine',[[0,f],[.28,f*.94]],.31,.12/(1+i*.35)));note('triangle',[[0,1100],[.04,700],[.1,1250]],.13,.08,.05);break;
   case 3:[0,.035,.075].forEach((t,i)=>{puff(.025,1800,.16,t);note('square',[[0,480+i*180],[.028,220]],.035,.07,t);});note('sine',[[0,1046],[.05,784],[.12,523]],.15,.15,.1);break;
   case 4:puff(.17,420,.22);note('sine',[[0,130],[.04,280],[.08,100],[.16,210],[.24,55]],.26,.24);break;
   case 5:note('sawtooth',[[0,620],[.035,1320],[.09,780],[.14,1450],[.22,530],[.29,900],[.36,270]],.38,.12);note('sine',[[0,920],[.07,1700],[.2,700]],.23,.09);break;
   case 6:[0,.045,.09].forEach((t,i)=>{note('sawtooth',[[0,1000-i*160],[.025,160],[.05,700],[.08,80]],.1,.09,t);puff(.045,3200,.15,t);});note('sine',[[0,700],[.15,1300],[.22,260]],.25,.13,.12);break;
   case 7:[0,.045,.09].forEach((t,i)=>{puff(.065,1800+i*650,.22,t);note('triangle',[[0,450+i*220],[.05,950+i*120]],.07,.09,t);});note('sine',[[0,1400],[.045,700]],.07,.1,.15);break;
  }
 }catch{sound=false;$('#sound').textContent='♫ 音樂關';$('#sound').setAttribute('aria-pressed','false');}}
 function effect(power,ultimate=false){const g=combatFX.geometry(width,height,state.target),x=g.x,y=g.y,w=weapons[state.weapon];for(let i=0;i<(reduced?4:ultimate?38:14);i++){const a=Math.random()*Math.PI*2,v=(ultimate?320:190)*(Math.random()*.8+.3);particles.push({x,y,vx:Math.cos(a)*v,vy:Math.sin(a)*v-60,life:.55+Math.random()*.35,color:ultimate?'#ffe68d':w.color,size:Math.random()*7+3,kind:state.weapon});}if(particles.length>110)particles.splice(0,particles.length-110);texts=texts.slice(-5);texts.push({x:x+(Math.random()-.5)*55,y:y-35,life:1.0,text:ultimate?'下班啦！':`-${power}`,color:ultimate?'#ffe68d':w.color});}
 function hit(ultimate=false){if(duel)return !document.hidden&&window.ArenaDuel.act(ultimate?{a:'heavy'}:{a:'atk',w:state.weapon});const now=performance.now();if(document.hidden||!state.running||now<state.knockUntil||(!ultimate&&now-state.lastHit<105))return false;if(ultimate&&state.rage<100)return false;
  state.combo=now-state.lastHit<1200?state.combo+1:1;state.lastHit=now;state.maxCombo=Math.max(state.maxCombo,state.combo);const w=weapons[state.weapon],power=ultimate?150:w.power;state.hp=Math.max(0,state.hp-power);state.hits++;state.score+=power*(1+Math.min(4,Math.floor(state.combo/10)));state.rage=ultimate?0:Math.min(100,state.rage+w.rage);state.hitUntil=now+320;state.attackUntil=now+170;if(ultimate){state.ultUntil=now+650;state.ultCount++;say('必殺！今日煩惱，全部退散！');}else if(state.hits%7===0)say(lines[Math.floor(Math.random()*lines.length)]);tone(ultimate);effect(power,ultimate);combatFX.hit(state.weapon,state.hp,now,ultimate);if(!reduced)document.querySelectorAll('.weapon')[state.weapon].animate([{transform:'translateY(3px) scale(.96)',filter:'brightness(1.6)'},{transform:'translateY(0) scale(1)',filter:'brightness(1)'}],{duration:170});
  if(state.hp===0){state.kos++;state.score+=100;state.knockUntil=now+1350;$('#stage-message').textContent='K.O.!';say('休息一下，馬上回到擂台！');}saveBest();update();wake();return true;
 }
 function reset(){recordRound();roundId=Date.now();stopHold();Object.assign(state,{running:state.mode==='free',remaining:60,score:0,kos:0,hits:0,hp:300,rage:0,combo:0,maxCombo:0,lastHit:-Infinity,hitUntil:0,attackUntil:0,knockUntil:0,ultUntil:0,ultCount:0});particles=[];texts=[];combatFX.reset();$('#stage-message').textContent='';$('#start').textContent=state.mode==='free'?'重新開局 ↗':'開始 60 秒挑戰 ↗';$('#timer-hint').textContent=state.mode==='free'?'喘口氣，慢慢來也可以。':'準備好了，再開始計時。';say(state.mode==='free'?'今天也辛苦了，來場友誼賽！':'挑戰準備中！按右側開始。');lastFrame=performance.now();update();wake();}
 function finish(){recordRound();state.running=false;state.remaining=0;stopHold();saveBest();update();$('#result-score').textContent=state.score.toLocaleString();$('#result-stats').textContent=`出手 ${state.hits} 次 · 擊倒 ${state.kos} 次 · 最高 ${state.maxCombo} 連擊`;$('#result').showModal();$('#timer-hint').textContent='挑戰完成！再來一局？';$('#start').textContent='再挑戰一次 ↗';}
 function start(){if(state.mode==='free'){reset();toast('新的一局，重新出發！');return;}reset();state.running=true;lastFrame=performance.now();$('#start').textContent='重新挑戰 ↗';$('#timer-hint').textContent='計時中！切到背景會自動暫停。';say('60 秒，讓煩惱全部下班！');update();wake();canvas.focus({preventScroll:true});}
 function stopHold(){holding=false;}
 function wake(){if(!raf)raf=requestAnimationFrame(frame);}
 function rect(x,y,w,h,color){ctx.fillStyle=color;ctx.fillRect(Math.round(x),Math.round(y),Math.ceil(w),Math.ceil(h));}
 function paintRoom(c){const floorY=combatFX.geometry(width,height,state.target).floorY;if(window.ArenaScenes)window.ArenaScenes.paint(c,width,height,floorY,state.scene);}
 function room(){const key=[Math.round(width),Math.round(height),state.scene].join(':');if(key!==roomKey){roomCache.width=Math.max(1,Math.round(width));roomCache.height=Math.max(1,Math.round(height));paintRoom(roomCache.getContext('2d'));roomKey=key;}ctx.drawImage(roomCache,0,0,width,height);}
 function sprite(index,x,y,h,rotation=0,scaleX=1,isTarget=false,scaleY=1){const im=characters[index].image;if(!im.complete||!im.naturalWidth)return;const b=combatFX.bounds(im);ctx.save();ctx.translate(x,y);ctx.rotate(rotation);ctx.scale(scaleX,scaleY);ctx.fillStyle='#55765826';ctx.beginPath();ctx.ellipse(0,0,h*.23,h*.035,0,0,Math.PI*2);ctx.fill();const w=h*b.w/b.h;ctx.imageSmoothingEnabled=true;ctx.drawImage(im,b.x,b.y,b.w,b.h,-w/2,-h,w,h);if(isTarget)combatFX.overlay(ctx,im,index,w,h);ctx.restore();}
 function hurtShape(now){/* 自己被打到：下方的大頭（背面）被壓扁再彈回，重擊更誇張 */
  const dur=state.hurtHeavy?460:300;if(reduced||!state.hurtUntil||now>=state.hurtUntil)return null;
  const t=Math.max(0,Math.min(1,1-(state.hurtUntil-now)/dur)),k=state.hurtHeavy?1.7:1;
  const keys=[[0,1,1,0],[.2,1+.2*k,1-.17*k,-.05*k],[.5,1-.1*k,1+.12*k,.04*k],[.75,1+.03*k,1-.03*k,-.015*k],[1,1,1,0]];
  let a=keys[0],b=keys[1];for(let i=1;i<keys.length;i++){if(t<=keys[i][0]){a=keys[i-1];b=keys[i];break;}}
  const f=(1-Math.cos(Math.PI*(t-a[0])/(b[0]-a[0])))/2;
  return {x:a[1]+(b[1]-a[1])*f,y:a[2]+(b[2]-a[2])*f,r:a[3]+(b[3]-a[3])*f,dx:Math.sin(now*.09)*4*(1-t)*k};
 }
 function playerBack(attacking,now){const im=characters[state.player].back;if(!im.complete||!im.naturalWidth)return;const b=combatFX.bounds(im),w=Math.min(320,width*.70),fullH=w*b.h/b.w,reveal=fullH*.23+(attacking&&!reduced?5:0),hs=hurtShape(now||performance.now());ctx.save();ctx.shadowColor='#263f4f33';ctx.shadowBlur=0;if(hs){ctx.translate(width/2+hs.dx,height);ctx.rotate(hs.r);ctx.scale(hs.x,hs.y);ctx.translate(-width/2,-height);}ctx.drawImage(im,b.x,b.y,b.w,b.h,width/2-w/2,height-reveal,w,fullH);selfBumps(width/2,height-reveal,w,reveal);ctx.restore();}
 function selfBumps(cx,topY,w,reveal){/* 自己被打：頭上跟對手一樣長腫包，越痛越多（1～3 顆） */
  const d=state.selfDamage||0;if(d<=.04)return;const count=d>.55?3:d>.22?2:1;
  for(let i=0;i<count;i++){const t=count>1?(i-(count-1)/2)/((count-1)/2):0,x=cx+t*w*.2,y=topY+reveal*.06+t*t*reveal*.1,r=w*(.06+d*.035)*(i%2?.8:1);
   ctx.save();ctx.translate(x,y);ctx.rotate(t*.42);ctx.fillStyle=i%2?'#efa18c':'#f6b0a0';ctx.strokeStyle='#b85c5e';ctx.lineWidth=Math.max(1.5,w*.008);ctx.beginPath();ctx.moveTo(-r,r*.25);ctx.bezierCurveTo(-r*1.15,-r*.8,-r*.55,-r*1.25,0,-r*1.2);ctx.bezierCurveTo(r*.75,-r*1.2,r*1.15,-r*.45,r,r*.25);ctx.closePath();ctx.fill();ctx.stroke();ctx.strokeStyle='#ffe4cf';ctx.lineWidth=w*.01;ctx.beginPath();ctx.moveTo(-r*.45,-r*.65);ctx.quadraticCurveTo(-r*.25,-r*.95,r*.12,-r*.9);ctx.stroke();ctx.restore();}
 }
 function hitShape(now){if(reduced||now>=state.hitUntil)return {x:1,y:1};const t=Math.max(0,Math.min(1,1-(state.hitUntil-now)/320));let keys=[[0,1,1],[.22,1.34,.66],[.56,.82,1.24],[.78,1.06,.94],[1,1,1]];if(state.weapon===2)keys=[[0,1,1],[.22,1.45,.60],[.56,.79,1.28],[.78,1.08,.93],[1,1,1]];if(state.weapon===6)keys=[[0,1,1],[.22,.74,1.37],[.56,1.23,.78],[.78,.95,1.05],[1,1,1]];let a=keys[0],b=keys[1];for(let i=1;i<keys.length;i++){if(t<=keys[i][0]){a=keys[i-1];b=keys[i];break;}}const f=(1-Math.cos(Math.PI*(t-a[0])/(b[0]-a[0])))/2;return {x:a[1]+(b[1]-a[1])*f,y:a[2]+(b[2]-a[2])*f};}
 function draw(now){ctx.clearRect(0,0,width,height);ctx.save();if(!reduced&&now<state.hitUntil){const strength=(state.hitUntil-now)/320;ctx.translate(Math.sin(now*.11)*5*strength,Math.cos(now*.09)*3*strength);}room();const layout=combatFX.geometry(width,height,state.target),h=layout.unit,foot=layout.foot,hitActive=now<state.hitUntil,ko=now<state.knockUntil,attacking=now<state.attackUntil;
  const pose=hitShape(now),wobble=!reduced&&hitActive?Math.sin(now*.055)*.075:0;
  if(ko){sprite(state.target,width*.50,foot,h,reduced?0:Math.PI*.40,.95,true);}else sprite(state.target,width*.50+(hitActive&&!reduced?Math.sin(now*.065)*3:0),foot,h,wobble,pose.x,true,pose.y);
  combatFX.draw(ctx,now,width,height,reduced,state.target);
  if(ko){ctx.fillStyle='#ffe494';ctx.font='22px sans-serif';ctx.fillText('✦ ✦ ✦',width*.42,height*.36);}
  if(now<state.ultUntil){ctx.fillStyle='#e7ffb51a';ctx.fillRect(0,0,width,height);ctx.strokeStyle='#e4ffb7';ctx.lineWidth=5;ctx.beginPath();ctx.arc(width*.50,height*.54,(1-(state.ultUntil-now)/650)*width*.70,0,Math.PI*2);ctx.stroke();}
  for(const p of particles){ctx.globalAlpha=Math.max(0,p.life);if(p.kind===7){rect(p.x,p.y,p.size*2,p.size*2.8,'#e9ecdc');rect(p.x+2,p.y+3,p.size,1,'#849a98');}else if(p.kind===6){ctx.strokeStyle=p.color;ctx.lineWidth=2;ctx.beginPath();ctx.moveTo(p.x,p.y-7);ctx.lineTo(p.x-4,p.y);ctx.lineTo(p.x+3,p.y);ctx.lineTo(p.x,p.y+8);ctx.stroke();}else if(p.kind===4){ctx.fillStyle='#fff3d5';ctx.beginPath();ctx.arc(p.x,p.y,p.size,0,Math.PI*2);ctx.fill();}else rect(p.x,p.y,p.size,p.size,p.color);}ctx.globalAlpha=1;for(const t of texts){ctx.globalAlpha=Math.min(1,t.life*2);ctx.fillStyle=t.color;ctx.font='900 italic 32px monospace';ctx.textAlign='center';ctx.strokeStyle='#193c2b';ctx.lineWidth=5;ctx.strokeText(t.text,t.x,t.y);ctx.fillText(t.text,t.x,t.y);}ctx.globalAlpha=1;ctx.textAlign='left';playerBack(attacking,now);ctx.restore();
 }
 function frame(now){const workStart=performance.now();raf=0;if(document.hidden)return;const elapsed=Math.max(0,(now-(lastFrame||now))/1000),dt=Math.min(.1,elapsed);lastFrame=now;
  if(state.mode==='timed'&&state.running){state.remaining=Math.max(0,state.remaining-elapsed);if(state.remaining<=0)finish();}
  if(holding&&now>=nextAuto){hit();nextAuto=now+125;}
  if(state.knockUntil&&now>=state.knockUntil){state.knockUntil=0;state.hp=300;combatFX.reset();$('#stage-message').textContent='';say('滿血回來了！新的一回合！');}
  if(state.combo&&now-state.lastHit>=1200){state.combo=0;}
  if(bubbleUntil&&now> bubbleUntil){bubbleUntil=0;$('#bubble').textContent='深呼吸，壞心情慢慢退散。';}
  particles=particles.filter(p=>{p.life-=dt;p.x+=p.vx*dt;p.y+=p.vy*dt;p.vy+=240*dt;return p.life>0;});texts=texts.filter(t=>{t.life-=dt;t.y-=45*dt;return t.life>0;});update();draw(now);renderWork+=performance.now()-workStart;renderCount++;if(now-metricsAt>1000){canvas.dataset.renderWorkMs=(renderWork/renderCount).toFixed(2);canvas.dataset.activeEffects=String(combatFX.events.length);canvas.dataset.particles=String(particles.length);renderCount=0;renderWork=0;metricsAt=now;}
  if(holding||state.running&&state.mode==='timed'||state.knockUntil||particles.length||texts.length||now<state.ultUntil||now<state.hitUntil||now<(state.hurtUntil||0)||state.combo||bubbleUntil||combatFX.active(now))wake();
 }
 new ResizeObserver(()=>{const b=canvas.getBoundingClientRect();width=b.width;height=b.height;const dpr=Math.min(devicePixelRatio||1,1.5);canvas.width=Math.round(width*dpr);canvas.height=Math.round(height*dpr);ctx.setTransform(dpr,0,0,dpr,0,0);wake();}).observe(canvas);
 characters.forEach(c=>{c.back.onload=wake;c.back.onerror=()=>toast(`角色 ${c.name} 背面圖載入失敗。`);c.image.onload=wake;c.image.onerror=()=>toast(`角色 ${c.name} 載入失敗，請重新整理。`);});
 canvas.addEventListener('pointerdown',e=>{if(e.button!==0)return;e.preventDefault();canvas.focus({preventScroll:true});holding=true;nextAuto=performance.now()+220;canvas.setPointerCapture(e.pointerId);hit();wake();});canvas.addEventListener('pointerup',stopHold);canvas.addEventListener('pointercancel',stopHold);canvas.addEventListener('lostpointercapture',stopHold);window.addEventListener('blur',stopHold);
 document.addEventListener('visibilitychange',()=>{stopHold();if(document.hidden){if(raf)cancelAnimationFrame(raf);raf=0;}else{lastFrame=performance.now();if(state.mode==='timed'&&state.running)toast('歡迎回來，挑戰繼續！');wake();}});
 document.addEventListener('keydown',e=>{if(e.ctrlKey||e.metaKey||e.altKey)return;if(e.target.closest('input,textarea,summary,dialog'))return;if(e.target.closest('button')){if(!(duel&&/^([1-8]|b|e)$/i.test(e.key)))return;}if(e.code==='Space'){e.preventDefault();if(!holding){holding=true;nextAuto=performance.now()+220;hit();wake();}}else if(/^[1-8]$/.test(e.key))selectWeapon(Number(e.key)-1);else if(e.key.toLowerCase()==='f'&&!duel)hit(true);else if(duel){if(e.key.toLowerCase()==='e')hit(true);else if(e.key.toLowerCase()==='b')window.ArenaDuel.act({a:'block'});else if(e.key.toLowerCase()==='c')$('#change-scene').click();}else {const shortcuts={c:'#change-scene',h:'#heal',m:'#sound',r:'#start',a:'#role-player',s:'#role-target',q:'[data-mode=free]',w:'[data-mode=timed]',l:'#leaderboard-open'};const selector=shortcuts[e.key.toLowerCase()];if(selector){e.preventDefault();$(selector).click();}}});document.addEventListener('keyup',e=>{if(e.code==='Space')stopHold();});
 function selectWeapon(i){state.weapon=i;if(document.activeElement&&document.activeElement.classList.contains('weapon'))document.activeElement.blur();canvas.style.cursor=weaponCursor(i);document.querySelectorAll('.weapon').forEach((b,n)=>b.setAttribute('aria-pressed',String(n===i)));wake();}
 $('#weapons').replaceChildren(...weapons.map((w,i)=>{const b=document.createElement('button');b.className='weapon';b.style.setProperty('--weapon-color',w.color);b.setAttribute('aria-pressed',String(i===0));b.title=w.name+'（'+(i+1)+'）';b.dataset.hotkey=String(i+1);b.setAttribute('aria-keyshortcuts',String(i+1));b.innerHTML=`<span aria-hidden="true">${window.ArenaWeaponArt.svg(i)}</span><b>${w.name}</b>`;b.onclick=()=>selectWeapon(i);return b;}));
 for(const role of ['player','target'])$('#role-'+role).onclick=()=>{state.role=role;$('#role-player').setAttribute('aria-pressed',String(role==='player'));$('#role-target').setAttribute('aria-pressed',String(role==='target'));roster();};
 document.querySelectorAll('[data-mode]').forEach(b=>b.onclick=()=>{if(duel)return;state.mode=b.dataset.mode;document.querySelectorAll('[data-mode]').forEach(x=>x.setAttribute('aria-pressed',String(x===b)));$('#mode-label').textContent=state.mode==='free'?'自由出氣':'60 秒挑戰';reset();});
 $('#start').onclick=()=>duel?window.ArenaDuel.leave():start();$('#ultimate').onclick=()=>hit(true);$('#change-scene').onclick=()=>{state.scene=(state.scene+1)%scenes.length;update();wake();};$('#heal').onclick=()=>{if(duel)return;state.hp=300;combatFX.reset();state.knockUntil=0;state.combo=0;state.lastHit=-Infinity;$('#stage-message').textContent='';update();say('休息完畢，狀態全滿！');wake();};$('#sound').onclick=()=>{sound=!sound;$('#sound').textContent=sound?'♫ 音樂開':'♫ 音樂關';$('#sound').setAttribute('aria-pressed',String(sound));syncMusic();if(sound)tone();};
 $('#again').onclick=()=>{if(duel){$('#again').textContent='等待對方…';$('#again').disabled=true;window.ArenaDuel.rematch();return;}$('#result').close();start();};$('#close-result').onclick=()=>{if(duel)window.ArenaDuel.leave();else $('#result').close();};$('#duel-block').onclick=()=>window.ArenaDuel.act({a:'block'});
 const weaponCursor=i=>'url("data:image/svg+xml,'+encodeURIComponent(window.ArenaWeaponArt.svg(i).replace('viewBox=', 'width="40" height="40" viewBox='))+'") 20 20, crosshair';
 canvas.style.cursor=weaponCursor(0);
 let roundId=Date.now();let rankings=[];try{const saved=JSON.parse(localStorage.getItem('emcVentArenaRankV1')||'[]');if(Array.isArray(saved))rankings=saved.filter(r=>Number.isFinite(r.score)&&r.score>0).slice(0,10);}catch{}
 const RANK_API='https://machi-design-api.machi-chen.workers.dev/api';
 const viewer={name:'',token:''};/* 登入者（由主站傳來）；沒登入＝空，排行榜顯示「未登入使用者」 */
 const who=()=>viewer.name||'未登入使用者';
 let lastSent={id:0,score:0};
 function submitScore(){
  if(!state.score||(lastSent.id===roundId&&lastSent.score===state.score))return;lastSent={id:roundId,score:state.score};
  try{fetch(RANK_API,{method:'POST',headers:{'Content-Type':'text/plain;charset=UTF-8'},body:JSON.stringify({action:'ventArenaScore',token:viewer.token,roundId:String(roundId),score:state.score,mode:state.mode,kos:state.kos}),cache:'no-store'}).catch(()=>{});}catch(error){}
 }
 function recordRound(){if(!state.score)return;rankings=rankings.filter(r=>r.id!==roundId);rankings.push({id:roundId,score:state.score,mode:state.mode,kos:state.kos,name:who()});submitScore();rankings.sort((a,b)=>b.score-a.score);rankings=rankings.slice(0,10);try{localStorage.setItem('emcVentArenaRankV1',JSON.stringify(rankings));}catch{}}
 function paintBoard(items){const list=$('#leaderboard-list');list.replaceChildren();if(!items.length){const li=document.createElement('li');li.textContent='尚無紀錄，來打一局吧！';list.append(li);}items.forEach((r,i)=>{const li=document.createElement('li');const label=document.createElement('span'),score=document.createElement('strong');label.textContent=(i+1)+'. '+r.name+' · '+(r.mode==='timed'?'60秒':'自由');score.textContent=Number(r.score).toLocaleString();li.append(label,score);list.append(li);});}
 $('#leaderboard-open').onclick=()=>{recordRound();paintBoard(rankings);$('#leaderboard').showModal();try{fetch(RANK_API,{method:'POST',headers:{'Content-Type':'text/plain;charset=UTF-8'},body:JSON.stringify({action:'ventArenaRanking'}),cache:'no-store'}).then(r=>r.json()).then(d=>{if(d&&d.ok&&Array.isArray(d.items))paintBoard(d.items);}).catch(()=>{});}catch(error){}};
 $('#leaderboard-close').onclick=()=>$('#leaderboard').close();
 roster();reset();

 /* 一對一對戰：沿用這個擂台畫面，由 duel.js 連線並運算規則，這裡只負責呈現 */
 {
  const HP=200,orig={h2:'下班快樂！',p:'這一回合，你把壞心情打散了。',span:'消氣分數',again:'再挑戰一回 ↗',close:'留在擂台'};
  const dtext=(x,y,text,color)=>{texts=texts.slice(-5);texts.push({x,y,life:1,text,color});wake();};
  const pr=()=>{const r=$('#result');return {r,h2:r.querySelector('h2'),p:r.querySelector('p:not(.eyebrow)'),span:r.querySelector('span')};};
  window.ArenaDuelBridge={
   enter({me,foe}){
    if(!duel)duelSaved={player:state.player,target:state.target,mode:state.mode};
    duel={me,foe,prev:'',fightMsg:0};
    Object.assign(state,{player:me.char,target:foe.char,mode:'duel',running:true,hp:HP,rage:0,combo:0,knockUntil:0,ultUntil:0,hitUntil:0,attackUntil:0,selfDamage:0,hurtUntil:0});
    particles=[];texts=[];combatFX.reset();stopHold();
    $('#arena').classList.add('in-duel');$('#stage-message').textContent='';$('#start').textContent='離開對戰 ↗';$('#mode-label').textContent='一對一對戰';$('#timer-hint').textContent='1–8 換道具，空白鍵／點擊出招，B 格擋，E 重擊';
    $('#ultimate .ultimate-label').textContent='💥 重擊';$('#heal').disabled=true;$('#duel-copy-log').hidden=false;$('#duel-copy-log').onclick=()=>window.ArenaDuel.copyLog();$('#ultimate').dataset.hotkey='E';$('#ultimate').setAttribute('aria-keyshortcuts','E');
    put('#target-name',foe.name);put('#foe-name',foe.name);put('#player-name',me.name);put('#self-name',me.name);
    if($('#result').open)$('#result').close();roster();wake();
   },
   paint(v,me){
    if(!duel)return;const f=1-me,now=performance.now(),fight=v.phase==='fight',stun=v.stun[me]>0,pct=v.hp[f]/HP*100;
    state.hp=v.hp[f];state.rage=v.rage[me];
    if(v.phase==='count'&&duel.prev!=='count'){combatFX.reset();particles=[];texts=[];state.knockUntil=0;const {r}=pr();if(r.open)r.close();$('#again').disabled=false;$('#again').textContent='再一場';}
    if(v.phase==='fight'&&duel.prev==='count')duel.fightMsg=now+900;
    duel.prev=v.phase;
    const hf=$('#health-fill');hf.style.width=pct+'%';hf.style.background=pct>50?'#22c55e':pct>25?'#ffd27c':'#ff8c8f';
    put('#hp-number',v.hp[f]+' / '+HP);put('#injury-status',pct>=100?'狀態完好':pct>70?'鼻子紅紅的':pct>30?'流鼻血、頭頂長包':'腫包累積、暈頭轉向');
    state.selfDamage=Math.max(0,1-v.hp[me]/HP);$('#self-fill').style.width=v.hp[me]/HP*100+'%';$('#self-fill').style.background=v.hp[me]/HP>.5?'#22c55e':v.hp[me]/HP>.25?'#ffd27c':'#ff8c8f';put('#self-hp',v.hp[me]+' / '+HP);
    $('#rage-fill').style.width=v.rage[me]+'%';put('#rage-text',v.rage[me]+'%');
    const ready=fight&&v.rage[me]>=100&&!stun;$('#ultimate').disabled=!ready;$('#ultimate').classList.toggle('ready',ready);$('.rage-panel').classList.toggle('charged',ready);
    $('#duel-block').disabled=!fight||v.gcd[me]>0||stun;$('#duel-block').classList.toggle('on',v.guard[me]>0);
    put('#timer',String(Math.ceil(v.left/1000)).padStart(2,'0'));put('#combo strong',state.combo);$('#combo').classList.toggle('visible',state.combo>=2&&now-state.lastHit<1200);$('#arena').classList.toggle('me-stun',stun);$('#arena').classList.toggle('danger',v.hp[me]<HP*.3);$('#arena').classList.toggle('low-hp',v.hp[me]>0&&v.hp[me]<HP*.35);$('#arena').classList.toggle('low-hp-critical',v.hp[me]>0&&v.hp[me]<HP*.15);
    if(v.stun[f]>0)combatFX.dizzyUntil=now+300;
    if(v.phase==='over'&&v.hp[f]<=0)state.knockUntil=1e15;else if(state.knockUntil>=1e14){state.knockUntil=0;combatFX.reset();}
    $('#stage-message').textContent=v.phase==='count'?String(Math.max(1,Math.ceil(v.count/1000))):now<duel.fightMsg?'FIGHT!':stun?'暈眩！':v.phase==='over'&&(v.hp[f]<=0||v.hp[me]<=0)?'K.O.!':'';
    wake();
   },
   fx(e,me){
    if(!duel)return;const mine=e.by===me,now=performance.now(),g=combatFX.geometry(width,height,state.target);
    if(e.k==='guard'){dtext(mine?width*.5:g.x,mine?height*.76:g.y-30,'格擋！','#7fd8ff');return;}
    if(mine){
     if(e.k==='block'){dtext(g.x,g.y-30,'被格擋！','#c9d3dc');return;}
     const heavy=e.k==='heavy',hp=Math.max(0,state.hp-e.dmg)*1.5;
     if(e.combo){state.combo=e.combo;state.lastHit=now;state.maxCombo=Math.max(state.maxCombo,e.combo);}tone(heavy);effect(e.dmg,heavy);combatFX.hit(state.weapon,hp,now,heavy);state.hitUntil=now+320;state.attackUntil=now+170;
     if(heavy){state.ultUntil=now+650;say('重擊！對手暈眩 3 秒！');}
    }else{
     const A=$('#arena');
     if(e.k==='block')dtext(width*.5,height*.76,'格擋成功！+5','#7fd8ff');
     else{dtext(width*.5,height*.8,e.k==='heavy'?'重擊 -'+e.dmg:'-'+e.dmg,e.k==='heavy'?'#ff3f93':'#ff6b7a');state.hurtHeavy=e.k==='heavy';state.hurtUntil=now+(state.hurtHeavy?460:300);A.classList.add('impact');setTimeout(()=>A.classList.remove('impact'),e.k==='heavy'?500:250);if(!reduced){const c=e.k==='heavy'?'duel-shake-heavy':'duel-shake';A.classList.remove('duel-shake','duel-shake-heavy');void A.offsetWidth;A.classList.add(c);setTimeout(()=>A.classList.remove(c),e.k==='heavy'?520:260);}if(e.k==='heavy')say('被重擊了！暈眩 3 秒');}
    }
    wake();
   },
   result(text,sub,hp){const {r,h2,p,span}=pr();h2.textContent=text;p.textContent=sub;$('#result-score').textContent=hp===''?'':hp;span.textContent=hp===''?'':'我的剩餘血量';$('#result-stats').textContent='';$('#again').textContent='再一場';$('#again').disabled=hp==='';$('#close-result').textContent='結束比賽';if(!r.open)r.showModal();},
   hint(t){const {r,p}=pr();if(r.open)p.textContent=t;else toast(t);},
   noRematch(){$('#again').disabled=true;},
   leave(){
    if(!duel)return;duel=null;const s=duelSaved;duelSaved=null;const {r,h2,p,span}=pr();if(r.open)r.close();
    h2.textContent=orig.h2;p.textContent=orig.p;span.textContent=orig.span;$('#again').textContent=orig.again;$('#again').disabled=false;$('#close-result').textContent=orig.close;
    $('#arena').classList.remove('in-duel','me-stun','low-hp','low-hp-critical','duel-shake','duel-shake-heavy');$('#ultimate .ultimate-label').textContent='✦ 下班衝擊波';$('#heal').disabled=false;$('#duel-copy-log').hidden=true;$('#ultimate').dataset.hotkey='F';$('#ultimate').setAttribute('aria-keyshortcuts','F');$('#stage-message').textContent='';
    Object.assign(state,{player:s.player,target:s.target,mode:s.mode,selfDamage:0,hurtUntil:0});uiKey='';reset();roster();
   }
  };
 }
 window.ArenaDuelInfo=()=>boundPlayer>=0?{char:boundPlayer,name:viewer.name||names[boundPlayer]}:{char:GHOST,name:'未登入使用者'};/* 一對一對戰一律用登入帳號本人的角色 */

 const shortcutLabels={'#ultimate':'F','#change-scene':'C','#heal':'H','#sound':'M','#start':'R','#role-player':'A','#role-target':'S','[data-mode=free]':'Q','[data-mode=timed]':'W','#leaderboard-open':'L','#again':'R','#close-result':'Esc'};
 for(const [selector,key] of Object.entries(shortcutLabels)){const b=$(selector);b.dataset.hotkey=key;b.setAttribute('aria-keyshortcuts',key);}
 $('#sound').textContent='♫ 音樂開';$('#sound').setAttribute('aria-pressed','true');
 // Local MP3 loops after the first user gesture, respecting mute and tab visibility.
 const music=$('#background-music');music.volume=.35;
 function syncMusic(){if(!sound||document.hidden){music.pause();return;}music.play().catch(()=>{});}
 function unlockMusic(){if(!sound)return;syncMusic();}
 document.addEventListener('pointerdown',unlockMusic);document.addEventListener('keydown',unlockMusic);
 document.addEventListener('visibilitychange',syncMusic);
 $('#result').addEventListener('keydown',e=>{if(e.key.toLowerCase()==='r')$('#again').click();});
 /* 在系統內開啟時：用像素辦公室即時送來的「目前造型」全身正面快照取代內建圖（沒有快照或獨立開啟就沿用 assets 內建圖） */
 window.addEventListener('message',e=>{
  if(e.origin!==location.origin||!e.data||e.data.type!=='ventArenaBodies'||!e.data.list)return;
  Object.keys(e.data.list).forEach(name=>{const i=names.indexOf(name),src=e.data.list[name];if(i<0||typeof src!=='string'||!src.startsWith('data:image/png;base64,'))return;
   const im=new Image();im.onload=()=>{characters[i].image=im;if(i===state.player||i===state.target)combatFX.reset();wake();roster();};im.src=src;});
 });
 if(window.parent!==window)try{window.parent.postMessage({type:'ventArenaBodiesRequest'},location.origin)}catch(error){}
 /* 我的角色綁定登入帳號：向主站要登入者名字；沒登入或不在 11 位名單內就維持預設 Amber */
 const normName=v=>String(v||'').trim().toLowerCase(),findName=v=>{const n=normName(v);if(!n)return -1;const lower=names.map(normName);let k=lower.indexOf(n);if(k<0)k=lower.indexOf(n.split(/[@\s._-]/)[0]);if(k<0)k=lower.findIndex(x=>n.startsWith(x+' '));return k;};
 function bindAccount(list,token){
  let i=-1;for(const v of list){i=findName(v);if(i>=0)break;}
  if(i<0||boundPlayer===i)return i>=0;
  viewer.name=names[i];if(token)viewer.token=String(token);
  boundPlayer=i;state.player=i;if(state.target===i)state.target=i===7?3:7;state.hp=300;combatFX.reset();say(`歡迎 ${names[i]}，你的角色已綁定帳號`);roster();update();wake();return true;
 }
 window.addEventListener('message',e=>{
  if(e.origin!==location.origin||!e.data||e.data.type!=='pixelOfficeViewer')return;
  viewer.name=String(e.data.name||'');viewer.token=String(e.data.token||'');
  bindAccount([viewer.name,...(Array.isArray(e.data.aliases)?e.data.aliases:[])],viewer.token);
 });
 /* 同網域直接讀主站的登入資料當備援（主站訊息沒到或名字對不上時）；並在綁定成功前重問幾次 */
 function bindFromStorage(){try{if(localStorage.getItem('designRequestEditorLoggedOut')==='1'||sessionStorage.getItem('designRequestEditorLoggedOut')==='1')return;const g=k=>localStorage.getItem(k)||sessionStorage.getItem(k)||'';bindAccount([g('designRequestEditorDisplayName'),g('designRequestEditorUser'),g('designRequestEditorAccount')],g('designRequestEditorToken'));}catch(error){}}
 bindFromStorage();[700,2000,4500].forEach(t=>setTimeout(()=>{if(boundPlayer<0){bindFromStorage();if(boundPlayer<0&&window.parent!==window)try{window.parent.postMessage({type:'pixelOfficeViewerRequest'},location.origin)}catch(error){}}},t));
 if(window.parent!==window)try{window.parent.postMessage({type:'pixelOfficeViewerRequest'},location.origin)}catch(error){}
 /* 在系統內開啟時：「返回元宇宙」交給主站切頁（直接連過去會在 iframe 裡又開一份像素辦公室） */
 document.querySelectorAll('.arena-home').forEach(a=>a.addEventListener('click',e=>{if(window.parent!==window){e.preventDefault();try{window.parent.postMessage({type:'ventArenaBack'},location.origin)}catch(error){}}}));
 /* 攻擊範圍鎖住左右鍵與選取：右鍵選單、長按選單、拖曳、文字／圖片選取、雙擊縮放都關掉（手機長時間連點才不會變成選取狀態）；輸入框除外 */
 {
  const css=document.createElement('style');css.textContent='html,body{-webkit-user-select:none;user-select:none;-webkit-touch-callout:none;-webkit-tap-highlight-color:transparent;touch-action:manipulation}input,textarea{-webkit-user-select:text;user-select:text;-webkit-touch-callout:default}#stage,#arena,#arena *{-webkit-user-select:none!important;user-select:none!important;-webkit-touch-callout:none!important;touch-action:manipulation}img,canvas{-webkit-user-drag:none;user-drag:none}';document.head.appendChild(css);
  const editable=e=>e.target&&e.target.closest&&e.target.closest('input,textarea');
  ['contextmenu','selectstart','dragstart'].forEach(t=>document.addEventListener(t,e=>{if(!editable(e))e.preventDefault();}));
  document.addEventListener('mousedown',e=>{if(e.button!==0&&!editable(e))e.preventDefault();});
  document.addEventListener('auxclick',e=>{if(!editable(e))e.preventDefault();});
  ['gesturestart','gesturechange'].forEach(t=>document.addEventListener(t,e=>e.preventDefault()));
 }
 /* 深色模式：預設淺色。?theme=dark、主站的 pixelOfficeTheme 訊息、或網站自己的深色設定（獨立開啟時） */
 {
  const root=document.documentElement,setTheme=t=>{if(t==='dark')root.setAttribute('data-theme','dark');else root.removeAttribute('data-theme');};
  const q=new URLSearchParams(location.search).get('theme');
  if(q)setTheme(q);else{try{if(localStorage.getItem('designRequestThemeV1')==='dark')setTheme('dark');}catch(error){}}/* 預設淺色；只有網站本身選了深色模式才跟著變深（不看系統深色設定） */
  window.addEventListener('message',e=>{if(e.origin!==location.origin||!e.data||e.data.type!=='pixelOfficeTheme')return;setTheme(e.data.theme);});
  if(window.parent!==window)try{window.parent.postMessage({type:'pixelOfficeThemeRequest'},location.origin)}catch(error){}
 }
})();
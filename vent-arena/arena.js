'use strict';
(() => {
 const nodeCache=new Map(),$=s=>{if(!nodeCache.has(s))nodeCache.set(s,document.querySelector(s));return nodeCache.get(s);},canvas=$('#stage'),ctx=canvas.getContext('2d');
 const roomCache=document.createElement('canvas');let roomKey='',uiKey='',renderCount=0,renderWork=0,metricsAt=0;
 function put(selector,value){const el=$(selector),text=String(value);if(el.textContent!==text){el.textContent=text;if(['#score','#best','#hud-score','#kos'].includes(selector))el.dataset.digits=String(text.length);}}
 const combatFX=new window.ArenaCombatFX();
 const names=['Amber','Anna','Leona','Machi','Noise','余采馨','吳冠賢','李明庭','廖秦葦','鄭筱舢','黎子瑄'];
 const characters=names.map((name,i)=>{const image=new Image(),back=new Image();back.src=`assets/${i<5?'designer':'staff'}_${name}_back.png`;image.src=`assets/${i<5?'designer':'staff'}_${name}_front.png`;return {name,image,back};});
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
 let state={player:0,target:7,role:'target',weapon:0,scene:0,mode:'free',running:true,remaining:60,score:0,kos:0,hits:0,hp:300,rage:0,combo:0,maxCombo:0,lastHit:-Infinity,hitUntil:0,attackUntil:0,knockUntil:0,ultUntil:0,ultCount:0};
 let best=0,sound=true,audio,particles=[],texts=[],holding=false,nextAuto=0,lastFrame=0,raf=0,toastTimer=0,bubbleUntil=0,width=0,height=0;
 const reduced=matchMedia('(prefers-reduced-motion: reduce)').matches;
 try{best=Math.max(0,Number(localStorage.getItem('emcVentArenaBestV1'))||0);}catch{}
 function saveBest(){if(state.score>best){best=state.score;try{localStorage.setItem('emcVentArenaBestV1',String(best));}catch{}}}
 function toast(text){$('#toast').textContent=text;$('#toast').classList.add('visible');clearTimeout(toastTimer);toastTimer=setTimeout(()=>$('#toast').classList.remove('visible'),2500);}
 function say(text){$('#bubble').textContent=text;bubbleUntil=performance.now()+3500;}
 let boundPlayer=-1;/* 登入帳號對應的角色（沒登入或不在名單內＝-1，預設 Amber） */
 function roster(){
  $('#roster').replaceChildren(...characters.map((c,i)=>{const b=document.createElement('button');b.className='person';const chosen=state[state.role]===i;b.classList.toggle('active',chosen);b.setAttribute('aria-pressed',String(chosen));b.setAttribute('aria-label',`選擇 ${c.name} 為${state.role==='player'?'我的角色':'陪練角色'}`);const img=c.image.cloneNode();img.alt='';const text=document.createElement('span');text.innerHTML=`<strong>${c.name}</strong>`;const number=document.createElement('span');number.textContent=chosen?'✓':String(i+1).padStart(2,'0');b.append(img,text,number);b.onclick=()=>{if(state.role==='player'&&boundPlayer>=0&&i!==boundPlayer){say(`你的角色已綁定帳號：${names[boundPlayer]}`);return;}if(state[state.role]!==i){state[state.role]=i;state.hp=300;combatFX.reset();state.knockUntil=0;state.combo=0;state.lastHit=-Infinity;particles=[];texts=[];say(`${c.name} 已上場，輕鬆玩一局！`);}roster();update();wake();};return b;}));
 }
 function update(){
  const now=performance.now(),ready=state.rage>=100&&state.running&&now>=state.knockUntil,combo=state.combo>=2&&now-state.lastHit<1200?state.combo:0,seconds=Math.ceil(state.remaining),impact=now<state.hitUntil,ult=now<state.ultUntil;
  const key=[ready,combo,seconds,impact,ult,state.hp,state.score,state.kos,best,state.target,state.player,state.rage,state.hits,state.maxCombo,state.scene,state.mode,state.running].join('|');if(key===uiKey)return;uiKey=key;
  $('#ultimate').classList.toggle('ready',ready);$('.rage-panel').classList.toggle('charged',ready);$('#arena').classList.toggle('ultimate-scene',ult);$('#arena').classList.toggle('impact',impact);$('#arena').classList.toggle('danger',state.hp<90);
  put('#injury-status',state.hp===300?'狀態完好':state.hp>210?'鼻子紅紅的':state.hp>90?'流鼻血、頭頂長包':'腫包累積、暈頭轉向');$('#injury-status').dataset.level=state.hp>210?'light':state.hp>90?'medium':'heavy';
  $('#health-fill').style.background=state.hp>150?'#22c55e':state.hp>75?'#ffd27c':'#ff8c8f';$('#health-fill').style.width=state.hp/3+'%';$('#rage-fill').style.width=state.rage+'%';$('#ultimate').disabled=!ready;
  put('#score',state.score.toLocaleString());put('#hud-score',state.score.toLocaleString());put('#kos',state.kos);put('#best',best.toLocaleString());put('#target-name',names[state.target]);put('#foe-name',names[state.target]);put('#player-name',names[state.player]);put('#hp-number',state.hp+' / 300');put('#rage-text',state.rage+'%');put('#combo strong',state.combo);$('#combo').classList.toggle('visible',combo>0);put('#timer',state.mode==='free'?'∞':String(seconds).padStart(2,'0'));
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
 function hit(ultimate=false){const now=performance.now();if(document.hidden||!state.running||now<state.knockUntil||(!ultimate&&now-state.lastHit<105))return false;if(ultimate&&state.rage<100)return false;
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
 function playerBack(attacking){const im=characters[state.player].back;if(!im.complete||!im.naturalWidth)return;const b=combatFX.bounds(im),w=Math.min(320,width*.70),fullH=w*b.h/b.w,reveal=fullH*.23+(attacking&&!reduced?5:0);ctx.save();ctx.shadowColor='#263f4f33';ctx.shadowBlur=0;ctx.drawImage(im,b.x,b.y,b.w,b.h,width/2-w/2,height-reveal,w,fullH);ctx.restore();}
 function hitShape(now){if(reduced||now>=state.hitUntil)return {x:1,y:1};const t=Math.max(0,Math.min(1,1-(state.hitUntil-now)/320));let keys=[[0,1,1],[.22,1.34,.66],[.56,.82,1.24],[.78,1.06,.94],[1,1,1]];if(state.weapon===2)keys=[[0,1,1],[.22,1.45,.60],[.56,.79,1.28],[.78,1.08,.93],[1,1,1]];if(state.weapon===6)keys=[[0,1,1],[.22,.74,1.37],[.56,1.23,.78],[.78,.95,1.05],[1,1,1]];let a=keys[0],b=keys[1];for(let i=1;i<keys.length;i++){if(t<=keys[i][0]){a=keys[i-1];b=keys[i];break;}}const f=(1-Math.cos(Math.PI*(t-a[0])/(b[0]-a[0])))/2;return {x:a[1]+(b[1]-a[1])*f,y:a[2]+(b[2]-a[2])*f};}
 function draw(now){ctx.clearRect(0,0,width,height);ctx.save();if(!reduced&&now<state.hitUntil){const strength=(state.hitUntil-now)/320;ctx.translate(Math.sin(now*.11)*5*strength,Math.cos(now*.09)*3*strength);}room();const layout=combatFX.geometry(width,height,state.target),h=layout.unit,foot=layout.foot,hitActive=now<state.hitUntil,ko=now<state.knockUntil,attacking=now<state.attackUntil;
  const pose=hitShape(now),wobble=!reduced&&hitActive?Math.sin(now*.055)*.075:0;
  if(ko){sprite(state.target,width*.50,foot,h,reduced?0:Math.PI*.40,.95,true);}else sprite(state.target,width*.50+(hitActive&&!reduced?Math.sin(now*.065)*3:0),foot,h,wobble,pose.x,true,pose.y);
  combatFX.draw(ctx,now,width,height,reduced,state.target);
  if(ko){ctx.fillStyle='#ffe494';ctx.font='22px sans-serif';ctx.fillText('✦ ✦ ✦',width*.42,height*.36);}
  if(now<state.ultUntil){ctx.fillStyle='#e7ffb51a';ctx.fillRect(0,0,width,height);ctx.strokeStyle='#e4ffb7';ctx.lineWidth=5;ctx.beginPath();ctx.arc(width*.50,height*.54,(1-(state.ultUntil-now)/650)*width*.70,0,Math.PI*2);ctx.stroke();}
  for(const p of particles){ctx.globalAlpha=Math.max(0,p.life);if(p.kind===7){rect(p.x,p.y,p.size*2,p.size*2.8,'#e9ecdc');rect(p.x+2,p.y+3,p.size,1,'#849a98');}else if(p.kind===6){ctx.strokeStyle=p.color;ctx.lineWidth=2;ctx.beginPath();ctx.moveTo(p.x,p.y-7);ctx.lineTo(p.x-4,p.y);ctx.lineTo(p.x+3,p.y);ctx.lineTo(p.x,p.y+8);ctx.stroke();}else if(p.kind===4){ctx.fillStyle='#fff3d5';ctx.beginPath();ctx.arc(p.x,p.y,p.size,0,Math.PI*2);ctx.fill();}else rect(p.x,p.y,p.size,p.size,p.color);}ctx.globalAlpha=1;for(const t of texts){ctx.globalAlpha=Math.min(1,t.life*2);ctx.fillStyle=t.color;ctx.font='900 italic 32px monospace';ctx.textAlign='center';ctx.strokeStyle='#193c2b';ctx.lineWidth=5;ctx.strokeText(t.text,t.x,t.y);ctx.fillText(t.text,t.x,t.y);}ctx.globalAlpha=1;ctx.textAlign='left';playerBack(attacking);ctx.restore();
 }
 function frame(now){const workStart=performance.now();raf=0;if(document.hidden)return;const elapsed=Math.max(0,(now-(lastFrame||now))/1000),dt=Math.min(.1,elapsed);lastFrame=now;
  if(state.mode==='timed'&&state.running){state.remaining=Math.max(0,state.remaining-elapsed);if(state.remaining<=0)finish();}
  if(holding&&now>=nextAuto){hit();nextAuto=now+125;}
  if(state.knockUntil&&now>=state.knockUntil){state.knockUntil=0;state.hp=300;combatFX.reset();$('#stage-message').textContent='';say('滿血回來了！新的一回合！');}
  if(state.combo&&now-state.lastHit>=1200){state.combo=0;}
  if(bubbleUntil&&now> bubbleUntil){bubbleUntil=0;$('#bubble').textContent='深呼吸，壞心情慢慢退散。';}
  particles=particles.filter(p=>{p.life-=dt;p.x+=p.vx*dt;p.y+=p.vy*dt;p.vy+=240*dt;return p.life>0;});texts=texts.filter(t=>{t.life-=dt;t.y-=45*dt;return t.life>0;});update();draw(now);renderWork+=performance.now()-workStart;renderCount++;if(now-metricsAt>1000){canvas.dataset.renderWorkMs=(renderWork/renderCount).toFixed(2);canvas.dataset.activeEffects=String(combatFX.events.length);canvas.dataset.particles=String(particles.length);renderCount=0;renderWork=0;metricsAt=now;}
  if(holding||state.running&&state.mode==='timed'||state.knockUntil||particles.length||texts.length||now<state.ultUntil||now<state.hitUntil||state.combo||bubbleUntil||combatFX.active(now))wake();
 }
 new ResizeObserver(()=>{const b=canvas.getBoundingClientRect();width=b.width;height=b.height;const dpr=Math.min(devicePixelRatio||1,1.5);canvas.width=Math.round(width*dpr);canvas.height=Math.round(height*dpr);ctx.setTransform(dpr,0,0,dpr,0,0);wake();}).observe(canvas);
 characters.forEach(c=>{c.back.onload=wake;c.back.onerror=()=>toast(`角色 ${c.name} 背面圖載入失敗。`);c.image.onload=wake;c.image.onerror=()=>toast(`角色 ${c.name} 載入失敗，請重新整理。`);});
 canvas.addEventListener('pointerdown',e=>{if(e.button!==0)return;e.preventDefault();canvas.focus({preventScroll:true});holding=true;nextAuto=performance.now()+220;canvas.setPointerCapture(e.pointerId);hit();wake();});canvas.addEventListener('pointerup',stopHold);canvas.addEventListener('pointercancel',stopHold);canvas.addEventListener('lostpointercapture',stopHold);window.addEventListener('blur',stopHold);
 document.addEventListener('visibilitychange',()=>{stopHold();if(document.hidden){if(raf)cancelAnimationFrame(raf);raf=0;}else{lastFrame=performance.now();if(state.mode==='timed'&&state.running)toast('歡迎回來，挑戰繼續！');wake();}});
 document.addEventListener('keydown',e=>{if(e.target.closest('input,textarea,button,summary,dialog')||e.ctrlKey||e.metaKey||e.altKey)return;if(e.code==='Space'){e.preventDefault();if(!holding){holding=true;nextAuto=performance.now()+220;hit();wake();}}else if(/^[1-8]$/.test(e.key))selectWeapon(Number(e.key)-1);else if(e.key.toLowerCase()==='f')hit(true);else {const shortcuts={c:'#change-scene',h:'#heal',m:'#sound',r:'#start',a:'#role-player',s:'#role-target',q:'[data-mode=free]',w:'[data-mode=timed]',l:'#leaderboard-open'};const selector=shortcuts[e.key.toLowerCase()];if(selector){e.preventDefault();$(selector).click();}}});document.addEventListener('keyup',e=>{if(e.code==='Space')stopHold();});
 function selectWeapon(i){state.weapon=i;canvas.style.cursor=weaponCursor(i);document.querySelectorAll('.weapon').forEach((b,n)=>b.setAttribute('aria-pressed',String(n===i)));wake();}
 $('#weapons').replaceChildren(...weapons.map((w,i)=>{const b=document.createElement('button');b.className='weapon';b.style.setProperty('--weapon-color',w.color);b.setAttribute('aria-pressed',String(i===0));b.title=w.name+'（'+(i+1)+'）';b.dataset.hotkey=String(i+1);b.setAttribute('aria-keyshortcuts',String(i+1));b.innerHTML=`<span aria-hidden="true">${window.ArenaWeaponArt.svg(i)}</span><b>${w.name}</b>`;b.onclick=()=>selectWeapon(i);return b;}));
 for(const role of ['player','target'])$('#role-'+role).onclick=()=>{state.role=role;$('#role-player').setAttribute('aria-pressed',String(role==='player'));$('#role-target').setAttribute('aria-pressed',String(role==='target'));roster();};
 document.querySelectorAll('[data-mode]').forEach(b=>b.onclick=()=>{state.mode=b.dataset.mode;document.querySelectorAll('[data-mode]').forEach(x=>x.setAttribute('aria-pressed',String(x===b)));$('#mode-label').textContent=state.mode==='free'?'自由出氣':'60 秒挑戰';reset();});
 $('#start').onclick=start;$('#ultimate').onclick=()=>hit(true);$('#change-scene').onclick=()=>{state.scene=(state.scene+1)%scenes.length;update();wake();};$('#heal').onclick=()=>{state.hp=300;combatFX.reset();state.knockUntil=0;state.combo=0;state.lastHit=-Infinity;$('#stage-message').textContent='';update();say('休息完畢，狀態全滿！');wake();};$('#sound').onclick=()=>{sound=!sound;$('#sound').textContent=sound?'♫ 音樂開':'♫ 音樂關';$('#sound').setAttribute('aria-pressed',String(sound));syncMusic();if(sound)tone();};
 $('#again').onclick=()=>{$('#result').close();start();};$('#close-result').onclick=()=>$('#result').close();
 const weaponCursor=i=>'url("data:image/svg+xml,'+encodeURIComponent(window.ArenaWeaponArt.svg(i).replace('viewBox=', 'width="40" height="40" viewBox='))+'") 20 20, crosshair';
 canvas.style.cursor=weaponCursor(0);
 let roundId=Date.now();let rankings=[];try{const saved=JSON.parse(localStorage.getItem('emcVentArenaRankV1')||'[]');if(Array.isArray(saved))rankings=saved.filter(r=>Number.isFinite(r.score)&&r.score>0).slice(0,10);}catch{}
 function recordRound(){if(!state.score)return;rankings=rankings.filter(r=>r.id!==roundId);rankings.push({id:roundId,score:state.score,mode:state.mode,kos:state.kos,name:names[state.player]});rankings.sort((a,b)=>b.score-a.score);rankings=rankings.slice(0,10);try{localStorage.setItem('emcVentArenaRankV1',JSON.stringify(rankings));}catch{}}
 $('#leaderboard-open').onclick=()=>{recordRound();const list=$('#leaderboard-list');list.replaceChildren();if(!rankings.length){const li=document.createElement('li');li.textContent='尚無紀錄，來打一局吧！';list.append(li);}rankings.forEach((r,i)=>{const li=document.createElement('li');const label=document.createElement('span'),score=document.createElement('strong');label.textContent=(i+1)+'. '+r.name+' · '+(r.mode==='timed'?'60秒':'自由');score.textContent=r.score.toLocaleString();li.append(label,score);list.append(li);});$('#leaderboard').showModal();};
 $('#leaderboard-close').onclick=()=>$('#leaderboard').close();
 roster();reset();

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
 window.addEventListener('message',e=>{
  if(e.origin!==location.origin||!e.data||e.data.type!=='pixelOfficeViewer')return;
  const i=names.indexOf(String(e.data.name||''));if(i<0)return;
  boundPlayer=i;state.player=i;if(state.target===i)state.target=i===7?3:7;state.hp=300;combatFX.reset();say(`歡迎 ${names[i]}，你的角色已綁定帳號`);roster();update();wake();
 });
 if(window.parent!==window)try{window.parent.postMessage({type:'pixelOfficeViewerRequest'},location.origin)}catch(error){}
 /* 在系統內開啟時：「返回元宇宙」交給主站切頁（直接連過去會在 iframe 裡又開一份像素辦公室） */
 document.querySelectorAll('.arena-home').forEach(a=>a.addEventListener('click',e=>{if(window.parent!==window){e.preventDefault();try{window.parent.postMessage({type:'ventArenaBack'},location.origin)}catch(error){}}}));
})();
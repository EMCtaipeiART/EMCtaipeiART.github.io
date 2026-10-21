'use strict';
/* 出氣擂台 · 一對一對戰。房主（host）負責裁判運算，對手（guest）只送操作、接收快照。
   連線走 Cloudflare Worker 的中繼房間（WebSocket，戰場序號 = 房間名），不需要 WebRTC 直連。
   對戰畫面沿用原本的擂台（arena.js 的 ArenaDuelBridge）；這裡只負責開戰場／輸入序號的小視窗與連線、規則運算。 */
(() => {
 const D={hp:200,hit:3,block:10,rageHit:4,comboStep:5,maxBonus:9,comboGap:1200,heavy:50,stun:3000,round:60000,count:3000,cd:220,guard:600,guardCd:1100};
 const names=['Amber','Anna','Leona','Machi','Noise','余采馨','吳冠賢','李明庭','廖秦葦','鄭筱舢','黎子瑄','未登入使用者'];
 /* 連線：不再用 WebRTC 直連（公司網路／NAT 常連不上），雙方都連到自家 Cloudflare Worker 的中繼房間（/duel），由房間轉送訊息 */
 const WS_BASE='wss://machi-design-api.machi-chen.workers.dev/duel',ALPHABET='ABCDEFGHJKMNPQRSTUVWXYZ23456789';
 const $=s=>document.querySelector(s),bridge=()=>window.ArenaDuelBridge;
 let root,conn,paired=false,isHost=false,code='',me=0,G=null,snap=null,snapAt=0,timer=0,lastSnapSent=0,foeWants=false,iWant=false,closed=true,inMatch=false,foe={name:'對手',char:4},self={name:'',char:3},toastTimer=0,lastAct=0,overShown=false;
 /* 連線日誌：記在記憶體與 localStorage（最近 300 行，重新整理後仍在），並寫到 console；畫面右下角「複製連線日誌」可一鍵複製回報 */
 const LOGKEY='emcVentDuelLogV1';let logs=[];try{logs=JSON.parse(localStorage.getItem(LOGKEY)||'[]');if(!Array.isArray(logs))logs=[];}catch{logs=[];}
 function dlog(tag,msg){const t=new Date(),p=(n,l=2)=>String(n).padStart(l,'0'),line=`${p(t.getHours())}:${p(t.getMinutes())}:${p(t.getSeconds())}.${p(t.getMilliseconds(),3)} [${isHost?'房主':'對手'}] ${tag} ${msg===undefined?'':msg}`;logs.push(line);if(logs.length>300)logs=logs.slice(-300);try{localStorage.setItem(LOGKEY,JSON.stringify(logs));}catch{}try{console.info('[duel]',tag,msg===undefined?'':msg);}catch{}}
 function logHeader(){const c=navigator.connection||{};return `出氣擂台連線日誌 ${new Date().toLocaleString()}\n頁面 ${location.origin}${location.pathname}${window.parent!==window?'（內嵌）':''}\n瀏覽器 ${navigator.userAgent}\n網路 online=${navigator.onLine} type=${c.effectiveType||'?'} rtt=${c.rtt??'?'} downlink=${c.downlink??'?'}\n身份 ${self.name||'?'}\n----\n`;}
 async function copyLog(){const text=logHeader()+(logs.length?logs.join('\n'):'（尚無紀錄）');try{await navigator.clipboard.writeText(text);}catch{const t=el('textarea');t.value=text;document.body.appendChild(t);t.select();try{document.execCommand('copy');}catch{}t.remove();}toast('已複製連線日誌，貼給管理員即可追蹤');}
 const info=()=>window.ArenaDuelInfo?window.ArenaDuelInfo():{name:'',char:3};
 function el(tag,cls,html){const e=document.createElement(tag);if(cls)e.className=cls;if(html!=null)e.innerHTML=html;return e;}
 function build(){
  root=el('div','duel');root.id='duel';root.hidden=true;root.setAttribute('role','dialog');root.setAttribute('aria-modal','true');root.setAttribute('aria-label','一對一對戰');
  root.innerHTML=`<div class="duel-card">
   <button class="duel-x" data-act="close" aria-label="關閉">✕</button>
   <button class="duel-log" data-act="log" type="button">複製連線日誌</button>
   <section class="duel-menu" data-view="menu"><p class="duel-eyebrow">1 VS 1 · ONLINE</p><h2>一對一對戰</h2><p class="duel-sub">邀請同事，在擂台上正面對決。60 秒一回合，血量多的人獲勝！</p>
    <div class="duel-entries"><button data-act="host"><span>⚔</span><b>新開戰場<small>產生序號，等朋友加入</small></b></button><button data-act="joinview"><span>⌨</span><b>輸入序號<small>加入朋友的戰場</small></b></button></div>
    <ul class="duel-rules"><li>每個攻擊道具傷害相同：<b>-${D.hit}</b></li><li>🛡 格擋成功不扣血，並 <b>+${D.block}</b> 怒氣</li><li>打擊成功 <b>+${D.rageHit}</b> 怒氣，滿 100% 可使用「重擊」</li><li>連擊越高越痛：每 ${D.comboStep} 連擊傷害 +1（最高 +${D.maxBonus}）</li><li>重擊無視格擋 <b>-${D.heavy}</b> 血，並暈眩對手 3 秒</li></ul></section>
   <section class="duel-wait" data-view="host"><p class="duel-eyebrow">WAITING FOR CHALLENGER</p><h2>戰場已開啟</h2><p class="duel-sub">把序號傳給對手，對方輸入後立即開打。</p><div class="duel-codewrap"><div class="duel-code" id="duel-code">······</div><button type="button" class="duel-copyicon" data-act="copycode" aria-label="複製序號" title="複製序號"><svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="9" y="9" width="11" height="11" rx="2"/><path d="M5 15V6a2 2 0 0 1 2-2h9"/></svg></button></div><div class="duel-row"><button class="duel-main" data-act="copy">複製邀請連結</button><button data-act="back">取消</button></div><p class="duel-sub">序號右邊的小圖示可以只複製序號（對方在擂台裡輸入）；「複製邀請連結」會連同點了就加入的連結一起複製。</p><p class="duel-status" id="duel-wait-status">連線中…</p></section>
   <section class="duel-join" data-view="join"><p class="duel-eyebrow">JOIN A BATTLE</p><h2>輸入戰場序號</h2><p class="duel-sub">貼上序號或整段邀請文字都可以。</p><input id="duel-input" class="duel-input" maxlength="200" autocomplete="off" autocapitalize="characters" spellcheck="false" placeholder="例如 K7Q3MD"><div class="duel-row"><button class="duel-main" data-act="join">加入戰場</button><button data-act="back">返回</button></div><p class="duel-status" id="duel-join-status"></p></section>
  </div>`;
  document.body.appendChild(root);
  root.addEventListener('click',e=>{const b=e.target.closest('[data-act]');if(!b)return;({host:openHost,joinview:()=>{show('join');setTimeout(()=>$('#duel-input').focus(),30);},back:backToMenu,copy:copyInvite,copycode:copyCode,join:()=>joinFrom($('#duel-input').value),close:()=>{leave();},log:copyLog})[b.dataset.act]?.();});
  $('#duel-input').addEventListener('keydown',e=>{if(e.key==='Enter')joinFrom(e.target.value);});
  document.addEventListener('keydown',e=>{if(!root.hidden){e.stopImmediatePropagation();if(e.key==='Escape')leave();}},true);
  document.addEventListener('keyup',e=>{if(!root.hidden)e.stopImmediatePropagation();},true);
 }
 function show(v){root.querySelectorAll('[data-view]').forEach(s=>s.classList.toggle('on',s.dataset.view===v));}
 function open(){if(!root)build();if(inMatch)return;closed=false;dlog('開啟','一對一對戰視窗');root.hidden=false;document.body.classList.add('duel-open');const i=info();self={name:i.name||names[i.char]||'玩家',char:i.char};show('menu');}
 function say(sel,text,bad){const e=$(sel);if(e){e.textContent=text;e.classList.toggle('bad',!!bad);}}
 function teardown(){clearInterval(hb);clearInterval(timer);timer=0;try{conn&&conn.close();}catch{}conn=null;paired=false;G=snap=null;foeWants=iWant=overShown=false;if(inMatch){inMatch=false;bridge().leave();}}
 function backToMenu(){teardown();show('menu');}
 function leave(){dlog('離開','本機結束');try{conn&&conn.open&&conn.send({t:'bye'});}catch{}teardown();closed=true;if(root){root.hidden=true;}document.body.classList.remove('duel-open');}

 /* ---------- 房主 ---------- */
 function newCode(){let s='';for(let i=0;i<6;i++)s+=ALPHABET[Math.floor(Math.random()*ALPHABET.length)];return s;}
 const OFFLINE='目前沒有網路連線，請檢查 Wi‑Fi／網路後再試。',NOSERVER='無法連上對戰伺服器（machi-design-api.machi-chen.workers.dev 可能被網路擋住），請換個網路（例如手機熱點）再試。';
 window.addEventListener('offline',()=>{if(!closed)toast('網路已中斷');});
 /* 房間連線的薄包裝：send 送 JSON、close 結束；控制訊息（hosted／ready／gone）與一般訊息在 onRoomMsg 分流 */
 function mkLink(ws){return {ws,get open(){return ws.readyState===1;},send(m){try{ws.send(JSON.stringify(m));}catch{}},close(){try{ws.close(1000);}catch{}}};}
 async function openHost(){
  show('host');isHost=true;me=0;dlog('開戰場','開始建立');say('#duel-wait-status','連線中…');$('#duel-code').textContent='······';
  if(navigator.onLine===false){say('#duel-wait-status',OFFLINE,true);return;}
  hostAttempt(0,'',0);
 }
 /* n：換序號重試次數（序號撞到）；c：固定序號（斷線重連用）；k：重連次數 */
 function hostAttempt(n,c,k){
  if(closed)return;if(n>5||k>3){say('#duel-wait-status','無法建立戰場，請稍後再試。',true);return;}
  code=c||newCode();const myCode=code,ws=new WebSocket(`${WS_BASE}?room=${myCode}&role=host`),link=mkLink(ws);conn=link;paired=false;let opened=false,hosted=false;
  const to=setTimeout(()=>{if(!opened){dlog('中繼伺服器','10 秒內沒有回應');say('#duel-wait-status',NOSERVER,true);try{ws.close();}catch{}}},10000);
  const ping=setInterval(()=>{if(ws.readyState===1&&!paired)link.send({t:'p'});},20000);
  ws.onopen=()=>{opened=true;clearTimeout(to);dlog('中繼伺服器','已連上');};
  ws.onmessage=ev=>{let m;try{m=JSON.parse(ev.data);}catch{return;}
   if(m.t==='hosted'){hosted=true;$('#duel-code').textContent=myCode;dlog('戰場開啟','序號 '+myCode);say('#duel-wait-status','等待對手加入…');}
   else onRoomMsg(m,link);};
  ws.onclose=ev=>{clearTimeout(to);clearInterval(ping);dlog('中繼連線關閉','code '+ev.code+' '+(ev.reason||''));if(closed||conn!==link)return;
   if(ev.code===4409&&!hosted){hostAttempt(n+1,'',0);return;}
   if(paired){peerGone();return;}
   if(hosted||opened){say('#duel-wait-status','與對戰伺服器斷線，重新連線中…');setTimeout(()=>hostAttempt(n,myCode,k+1),1500);}
   else say('#duel-wait-status',NOSERVER,true);};
  ws.onerror=()=>dlog('中繼連線錯誤','');
 }
 function inviteText(){const link=location.origin+location.pathname+'?room='+code;return `${self.name} 邀請您一同參加「EMC 出氣擂台」一對一對戰！\n戰場序號：${code}\n點此直接加入：${link}\n（開啟出氣擂台 → 遊戲模式 → 一對一對戰 → 輸入序號 也可以）`;}
 async function copyText(text){try{await navigator.clipboard.writeText(text);}catch{const t=el('textarea');t.value=text;document.body.appendChild(t);t.select();try{document.execCommand('copy');}catch{}t.remove();}}
 async function copyCode(){if(!/^[A-Z0-9]{6}$/.test(code)){say('#duel-wait-status','序號還沒產生，請稍等一下。',true);return;}await copyText(code);say('#duel-wait-status','已複製序號 '+code+'，貼給對手，請他在「一對一對戰 → 輸入序號」輸入。');}
 async function copyInvite(){const text=inviteText();try{await navigator.clipboard.writeText(text);}catch{const t=el('textarea');t.value=text;document.body.appendChild(t);t.select();try{document.execCommand('copy');}catch{}t.remove();}say('#duel-wait-status','已複製邀請連結，貼給對手，點開就會自動加入。');}

 /* ---------- 對手 ---------- */
 let joinGen=0;
 async function joinFrom(raw){
  const text=String(raw||'').toUpperCase(),m=text.match(/ROOM=([A-Z0-9]{6})/)||text.match(/序號[:：\s]*([A-Z0-9]{6})/)||text.match(/\b([A-Z0-9]{6})\b/);
  if(!m){say('#duel-join-status','請輸入 6 碼戰場序號。',true);return;}
  joinGen++;const gen=joinGen;teardown();isHost=false;me=1;code=m[1];dlog('加入戰場','序號 '+code+' 來源 '+(raw&&String(raw).length>12?'整段文字／連結':'輸入'));say('#duel-join-status','連線中…');
  if(navigator.onLine===false){say('#duel-join-status',OFFLINE,true);return;}
  let tries=0;
  const attempt=()=>{
   dlog('嘗試連線','第 '+(tries+1)+' 次');const ws=new WebSocket(`${WS_BASE}?room=${code}&role=guest`),link=mkLink(ws);conn=link;paired=false;let opened=false,settled=false;
   const fail=(msg,retry)=>{if(settled||gen!==joinGen)return;settled=true;dlog('連線失敗',msg+(retry?'（將重試）':''));try{ws.close();}catch{}if(conn===link)conn=null;if(retry&&++tries<3&&!closed){say('#duel-join-status','連線中…（第 '+(tries+1)+' 次嘗試）');setTimeout(()=>{if(gen===joinGen)attempt();},1200);}else say('#duel-join-status',msg,true);};
   const to=setTimeout(()=>{if(!opened)fail(NOSERVER,true);},10000);
   ws.onopen=()=>{opened=true;clearTimeout(to);dlog('中繼伺服器','已連上');};
   ws.onmessage=ev=>{let d;try{d=JSON.parse(ev.data);}catch{return;}onRoomMsg(d,link);};
   ws.onclose=ev=>{clearTimeout(to);dlog('中繼連線關閉','code '+ev.code+' '+(ev.reason||''));if(gen!==joinGen||closed)return;
    if(paired&&conn===link){peerGone();return;}
    if(ev.code===4404)fail('找不到這個戰場，請確認序號，或請對方重新開一個戰場。',false);
    else if(ev.code===4409)fail('這個戰場已經有人了。',false);
    else fail(opened?'與對戰伺服器的連線中斷，請重試。':NOSERVER,true);};
   ws.onerror=()=>dlog('中繼連線錯誤','');
  };
  attempt();
 }

 /* ---------- 共用連線 ---------- */
 /* 房間控制訊息：hosted（房主就位）、ready（雙方到齊，各自送 hello）、gone（對方離開）；其餘交給 onMsg */
 function onRoomMsg(m,link){
  if(m.t==='ready'){paired=true;conn=link;dlog('雙方到齊','送出 hello');hello();}
  else if(m.t==='gone'){dlog('對方離開房間','');if(inMatch||paired&&!isHost){paired=false;peerGone();}else{paired=false;dlog('等待新對手','');say('#duel-wait-status','對手已離開，等待新的對手…');}}
  else if(m.t!=='hosted')onMsg(m);
 }
 function hello(){try{conn.send({t:'hello',name:self.name,char:self.char});}catch{}}
 function toast(t){const e=$('#toast');if(!e)return;e.textContent=t;e.classList.add('visible');clearTimeout(toastTimer);toastTimer=setTimeout(()=>e.classList.remove('visible'),2500);}
 function peerGone(){
  dlog('對方離開',inMatch?'對戰中':'對戰前');
  clearInterval(timer);timer=0;if(G)G.phase='over';conn=null;
  if(inMatch){bridge().result('對手已離開','','');bridge().noRematch();toast('對方已離開');}else{backToMenu();toast('對方已離開');}
 }
 function onMsg(d){
  if(!d||typeof d!=='object')return;lastRx=performance.now();if(d.t==='p')return;
  if(d.t==='hello'){dlog('收到 hello',JSON.stringify({name:d.name,char:d.char}));foe={name:String(d.name||'對手').slice(0,16),char:names[d.char]?d.char:4};if(foe.name===self.name)foe.name+='（對手）';if(isHost)beginMatch();else enter();}
  else if(d.t==='full'){dlog('戰場已滿','被房主拒絕');say('#duel-join-status','這個戰場已經有人了。',true);teardown();}
  else if(d.t==='snap'){snap=d;snapAt=performance.now();if(!timer)timer=setInterval(render,80);render();}
  else if(d.t==='ev')bridge().fx(d,me);
  else if(d.t==='act'&&isHost)apply(1,d);
  else if(d.t==='rematch'){dlog('再一場','對方想再來一場');foeWants=true;if(isHost&&iWant)beginMatch();else bridge().hint('對方想再來一場！');}
  else if(d.t==='bye'){dlog('收到 bye','對方主動離開');conn=null;if(!closed)peerGone();}
 }
 let hb=0,lastRx=0;
 function startBeat(){clearInterval(hb);lastRx=performance.now();hb=setInterval(()=>{if(!inMatch||closed){clearInterval(hb);return;}send({t:'p'});if(performance.now()-lastRx>7000){clearInterval(hb);dlog('心跳逾時','超過 7 秒沒有收到對方訊息');if(G&&G.phase!=='over'||snap&&snap.phase!=='over'){const was=conn;conn=null;try{was&&was.close();}catch{}toast('連線中斷');bridge().result('連線中斷','超過 7 秒沒有收到對方的訊息，可能是網路中斷或對方關閉了頁面。','');bridge().noRematch();clearInterval(timer);timer=0;}}},2000);}
 function enter(){inMatch=true;startBeat();dlog('進場','對手 '+foe.name+'，我是 '+self.name);root.hidden=true;document.body.classList.remove('duel-open');bridge().enter({me:{char:self.char,name:self.name},foe});}

 /* ---------- 房主裁判 ---------- */
 const mk=()=>({combo:0,lastHit:0,hp:D.hp,rage:0,guardUntil:0,guardReady:0,stunUntil:0,next:0});
 function beginMatch(){
  dlog('開局','倒數 3 秒');
  const now=performance.now();G={phase:'count',countEnd:now+D.count,endAt:0,P:[mk(),mk()],winner:-2};iWant=foeWants=overShown=false;
  enter();clearInterval(timer);timer=setInterval(tick,50);tick(true);
 }
 function tick(force){
  const now=performance.now();if(!G)return;
  if(G.phase==='count'&&now>=G.countEnd){G.phase='fight';G.endAt=now+D.round;dlog('開打','60 秒');}
  if(G.phase==='fight'&&now>=G.endAt)finish();
  if(force||now-lastSnapSent>=100){lastSnapSent=now;send(snapOf(now));}
  render();
 }
 function snapOf(now){return {t:'snap',phase:G.phase,count:Math.max(0,G.countEnd-now),left:G.phase==='count'?D.round:Math.max(0,G.endAt-now),hp:G.P.map(p=>p.hp),rage:G.P.map(p=>p.rage),guard:G.P.map(p=>Math.max(0,p.guardUntil-now)),gcd:G.P.map(p=>Math.max(0,p.guardReady-now)),stun:G.P.map(p=>Math.max(0,p.stunUntil-now)),winner:G.winner};}
 function send(m){try{conn&&conn.open&&conn.send(m);}catch{}}
 function finish(){const [a,b]=G.P;G.phase='over';dlog('結束','房主 '+a.hp+' 血 / 對手 '+b.hp+' 血');G.winner=a.hp>b.hp?0:b.hp>a.hp?1:-1;send(snapOf(performance.now()));}
 function emit(e){e.t='ev';send(e);bridge().fx(e,me);}
 function apply(by,d){
  if(!G||G.phase!=='fight')return;const now=performance.now(),s=G.P[by],o=G.P[1-by];
  if(d.a==='block'){if(now>=s.guardReady&&now>=s.stunUntil){s.guardUntil=now+D.guard;s.guardReady=now+D.guardCd;emit({k:'guard',by});}}
  else if(now<s.stunUntil||now<s.next)return;
  else if(d.a==='atk'){s.next=now+D.cd;const w=Math.max(0,Math.min(7,Number(d.w)|0));
   if(now<o.guardUntil){o.rage=Math.min(100,o.rage+D.block);o.guardUntil=0;s.combo=0;emit({k:'block',by,w});}
   else{s.combo=now-s.lastHit<D.comboGap?s.combo+1:1;s.lastHit=now;o.combo=0;const dmg=D.hit+Math.min(D.maxBonus,Math.floor(s.combo/D.comboStep));o.hp=Math.max(0,o.hp-dmg);s.rage=Math.min(100,s.rage+D.rageHit);emit({k:'hit',by,w,dmg,combo:s.combo});}}
  else if(d.a==='heavy'){if(s.rage<100)return;s.next=now+D.cd;s.rage=0;o.hp=Math.max(0,o.hp-D.heavy);o.stunUntil=now+D.stun;o.guardUntil=0;emit({k:'heavy',by,dmg:D.heavy});}
  if(o.hp<=0)finish();
  send(snapOf(now));render();
 }
 /* arena.js 呼叫：出招／格擋／重擊 */
 function act(d){if(closed||!inMatch)return false;const now=performance.now();if(d.a==='atk'&&now-lastAct<D.cd)return false;if(d.a==='atk')lastAct=now;if(isHost)apply(0,d);else if(snap&&snap.phase==='fight')send({t:'act',a:d.a,w:d.w});return true;}
 function view(){
  if(isHost&&G)return snapOf(performance.now());
  if(!snap)return null;const dt=performance.now()-snapAt,s=snap,sub=a=>a.map(v=>Math.max(0,v-dt));
  return {...s,left:s.phase==='fight'?Math.max(0,s.left-dt):s.left,count:Math.max(0,s.count-dt),guard:sub(s.guard),gcd:sub(s.gcd),stun:sub(s.stun)};
 }
 function render(){
  const v=view();if(!v||!inMatch)return;bridge().paint(v,me,D);
  if(v.phase==='over'&&!overShown){overShown=true;const w=v.winner;bridge().result(w===-1?'平手！勢均力敵':w===me?'你贏了！':'你輸了…',`${self.name} ${v.hp[me]} 血 vs ${foe.name} ${v.hp[1-me]} 血`,v.hp[me]);}
  if(v.phase!=='over')overShown=false;
 }
 function rematch(){dlog('再一場','我按了再一場');iWant=true;if(isHost){if(foeWants)beginMatch();else send({t:'rematch'});}else send({t:'rematch'});}

 window.ArenaDuel={open,act,leave,rematch,copyLog,openJoin:text=>{open();show('join');$('#duel-input').value=text;joinFrom(text);}};
 const btn=$('#duel-open');if(btn)btn.onclick=open;
 const room=new URLSearchParams(location.search).get('room');
 if(room&&/^[A-Za-z0-9]{6}$/.test(room))setTimeout(()=>window.ArenaDuel.openJoin(room),400);
})();

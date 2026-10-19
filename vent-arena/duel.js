'use strict';
/* 出氣擂台 · 一對一對戰。房主（host）負責裁判運算，對手（guest）只送操作、接收快照。
   連線用 PeerJS（WebRTC 點對點），戰場序號 = 房主的 peer id 尾碼。
   對戰畫面沿用原本的擂台（arena.js 的 ArenaDuelBridge）；這裡只負責開戰場／輸入序號的小視窗與連線、規則運算。 */
(() => {
 const D={hp:200,hit:3,block:10,rageHit:4,comboStep:5,maxBonus:9,comboGap:1200,heavy:50,stun:3000,round:60000,count:3000,cd:220,guard:600,guardCd:1100};
 const names=['Amber','Anna','Leona','Machi','Noise','余采馨','吳冠賢','李明庭','廖秦葦','鄭筱舢','黎子瑄'];
 const PEER_SRC='https://unpkg.com/peerjs@1.5.4/dist/peerjs.min.js',PREFIX='emcvent-',ALPHABET='ABCDEFGHJKMNPQRSTUVWXYZ23456789';
 const $=s=>document.querySelector(s),bridge=()=>window.ArenaDuelBridge;
 let root,peer,conn,isHost=false,code='',me=0,G=null,snap=null,snapAt=0,timer=0,lastSnapSent=0,foeWants=false,iWant=false,closed=true,inMatch=false,foe={name:'對手',char:4},self={name:'',char:3},toastTimer=0,lastAct=0,overShown=false;
 const info=()=>window.ArenaDuelInfo?window.ArenaDuelInfo():{name:'',char:3};
 function el(tag,cls,html){const e=document.createElement(tag);if(cls)e.className=cls;if(html!=null)e.innerHTML=html;return e;}
 function build(){
  root=el('div','duel');root.id='duel';root.hidden=true;root.setAttribute('role','dialog');root.setAttribute('aria-modal','true');root.setAttribute('aria-label','一對一對戰');
  root.innerHTML=`<div class="duel-card">
   <button class="duel-x" data-act="close" aria-label="關閉">✕</button>
   <section class="duel-menu" data-view="menu"><p class="duel-eyebrow">1 VS 1 · ONLINE</p><h2>一對一對戰</h2><p class="duel-sub">邀請同事，在擂台上正面對決。60 秒一回合，血量多的人獲勝！</p>
    <div class="duel-entries"><button data-act="host"><span>⚔</span><b>新開戰場<small>產生序號，等朋友加入</small></b></button><button data-act="joinview"><span>⌨</span><b>輸入序號<small>加入朋友的戰場</small></b></button></div>
    <ul class="duel-rules"><li>每個攻擊道具傷害相同：<b>-${D.hit}</b></li><li>🛡 格擋成功不扣血，並 <b>+${D.block}</b> 怒氣</li><li>打擊成功 <b>+${D.rageHit}</b> 怒氣，滿 100% 可使用「重擊」</li><li>連擊越高越痛：每 ${D.comboStep} 連擊傷害 +1（最高 +${D.maxBonus}）</li><li>重擊無視格擋 <b>-${D.heavy}</b> 血，並暈眩對手 3 秒</li></ul></section>
   <section class="duel-wait" data-view="host"><p class="duel-eyebrow">WAITING FOR CHALLENGER</p><h2>戰場已開啟</h2><p class="duel-sub">把序號傳給對手，對方輸入後立即開打。</p><div class="duel-code" id="duel-code">······</div><div class="duel-row"><button class="duel-main" data-act="copy">複製邀請</button><button data-act="back">取消</button></div><p class="duel-status" id="duel-wait-status">連線中…</p></section>
   <section class="duel-join" data-view="join"><p class="duel-eyebrow">JOIN A BATTLE</p><h2>輸入戰場序號</h2><p class="duel-sub">貼上序號或整段邀請文字都可以。</p><input id="duel-input" class="duel-input" maxlength="200" autocomplete="off" autocapitalize="characters" spellcheck="false" placeholder="例如 K7Q3MD"><div class="duel-row"><button class="duel-main" data-act="join">加入戰場</button><button data-act="back">返回</button></div><p class="duel-status" id="duel-join-status"></p></section>
  </div>`;
  document.body.appendChild(root);
  root.addEventListener('click',e=>{const b=e.target.closest('[data-act]');if(!b)return;({host:openHost,joinview:()=>{show('join');setTimeout(()=>$('#duel-input').focus(),30);},back:backToMenu,copy:copyInvite,join:()=>joinFrom($('#duel-input').value),close:()=>{leave();}})[b.dataset.act]?.();});
  $('#duel-input').addEventListener('keydown',e=>{if(e.key==='Enter')joinFrom(e.target.value);});
  document.addEventListener('keydown',e=>{if(!root.hidden){e.stopImmediatePropagation();if(e.key==='Escape')leave();}},true);
  document.addEventListener('keyup',e=>{if(!root.hidden)e.stopImmediatePropagation();},true);
 }
 function show(v){root.querySelectorAll('[data-view]').forEach(s=>s.classList.toggle('on',s.dataset.view===v));}
 function open(){if(!root)build();if(inMatch)return;const who=info();if(who.blocked){toast('一對一對戰使用帳號本人的角色，請先登入帳號');return;}closed=false;root.hidden=false;document.body.classList.add('duel-open');const i=info();self={name:i.name||names[i.char]||'玩家',char:i.char};show('menu');}
 function say(sel,text,bad){const e=$(sel);if(e){e.textContent=text;e.classList.toggle('bad',!!bad);}}
 function loadPeer(){return window.Peer?Promise.resolve():new Promise((ok,no)=>{const s=document.createElement('script');s.src=PEER_SRC;s.onload=ok;s.onerror=()=>no(new Error('load'));document.head.appendChild(s);});}
 function teardown(){clearInterval(timer);timer=0;try{conn&&conn.close();}catch{}try{peer&&peer.destroy();}catch{}conn=peer=null;G=snap=null;foeWants=iWant=overShown=false;if(inMatch){inMatch=false;bridge().leave();}}
 function backToMenu(){teardown();show('menu');}
 function leave(){try{conn&&conn.open&&conn.send({t:'bye'});}catch{}teardown();closed=true;if(root){root.hidden=true;}document.body.classList.remove('duel-open');}

 /* ---------- 房主 ---------- */
 function newCode(){let s='';for(let i=0;i<6;i++)s+=ALPHABET[Math.floor(Math.random()*ALPHABET.length)];return s;}
 async function openHost(){
  show('host');isHost=true;me=0;say('#duel-wait-status','連線中…');$('#duel-code').textContent='······';
  try{await loadPeer();}catch{say('#duel-wait-status','無法載入連線元件，請檢查網路後重試。',true);return;}
  const tryOpen=n=>{if(closed||n>5){say('#duel-wait-status','無法建立戰場，請稍後再試。',true);return;}const c=newCode(),p=new window.Peer(PREFIX+c);
   p.on('open',()=>{peer=p;code=c;$('#duel-code').textContent=c;say('#duel-wait-status','等待對手加入…');});
   p.on('error',err=>{if(err.type==='unavailable-id'){p.destroy();tryOpen(n+1);}else if(!conn)say('#duel-wait-status','連線失敗（'+err.type+'），請重試。',true);});
   p.on('connection',c2=>{if(conn&&conn.open){c2.on('open',()=>{c2.send({t:'full'});setTimeout(()=>c2.close(),300);});return;}setupConn(c2);});};
  tryOpen(0);
 }
 function inviteText(){const link=location.origin+location.pathname+'?room='+code;return `${self.name} 邀請您一同參加「EMC 出氣擂台」一對一對戰！\n戰場序號：${code}\n點此直接加入：${link}\n（開啟出氣擂台 → 遊戲模式 → 一對一對戰 → 輸入序號 也可以）`;}
 async function copyInvite(){const text=inviteText();try{await navigator.clipboard.writeText(text);}catch{const t=el('textarea');t.value=text;document.body.appendChild(t);t.select();try{document.execCommand('copy');}catch{}t.remove();}say('#duel-wait-status','已複製邀請文字，貼給對手吧！');}

 /* ---------- 對手 ---------- */
 async function joinFrom(raw){
  const text=String(raw||'').toUpperCase(),m=text.match(/ROOM=([A-Z0-9]{6})/)||text.match(/序號[:：\s]*([A-Z0-9]{6})/)||text.match(/\b([A-Z0-9]{6})\b/);
  if(!m){say('#duel-join-status','請輸入 6 碼戰場序號。',true);return;}
  isHost=false;me=1;code=m[1];say('#duel-join-status','連線中…');
  try{await loadPeer();}catch{say('#duel-join-status','無法載入連線元件，請檢查網路後重試。',true);return;}
  const p=new window.Peer();peer=p;
  const fail=msg=>{say('#duel-join-status',msg,true);try{p.destroy();}catch{}if(peer===p)peer=conn=null;};
  p.on('error',err=>fail(err.type==='peer-unavailable'?'找不到這個戰場，請確認序號。':'連線失敗（'+err.type+'）。'));
  p.on('open',()=>{const c=p.connect(PREFIX+code,{reliable:true});const to=setTimeout(()=>{if(!c.open)fail('連線逾時，對方可能已離開。');},12000);c.on('open',()=>{clearTimeout(to);setupConn(c);});});
 }

 /* ---------- 共用連線 ---------- */
 function setupConn(c){
  conn=c;c.on('data',onMsg);
  c.on('open',hello);if(c.open)hello();
  c.on('close',()=>{if(closed||conn!==c)return;peerGone();});
 }
 function hello(){try{conn.send({t:'hello',name:self.name,char:self.char});}catch{}}
 function toast(t){const e=$('#toast');if(!e)return;e.textContent=t;e.classList.add('visible');clearTimeout(toastTimer);toastTimer=setTimeout(()=>e.classList.remove('visible'),2500);}
 function peerGone(){
  clearInterval(timer);timer=0;if(G)G.phase='over';conn=null;
  if(inMatch){bridge().result('對手已離開','','');bridge().noRematch();toast('對方已離開');}else{backToMenu();toast('對方已離開');}
 }
 function onMsg(d){
  if(!d||typeof d!=='object')return;
  if(d.t==='hello'){foe={name:String(d.name||'對手').slice(0,16),char:names[d.char]?d.char:4};if(foe.name===self.name)foe.name+='（對手）';if(isHost)beginMatch();else enter();}
  else if(d.t==='full'){say('#duel-join-status','這個戰場已經有人了。',true);teardown();}
  else if(d.t==='snap'){snap=d;snapAt=performance.now();if(!timer)timer=setInterval(render,80);render();}
  else if(d.t==='ev')bridge().fx(d,me);
  else if(d.t==='act'&&isHost)apply(1,d);
  else if(d.t==='rematch'){foeWants=true;if(isHost&&iWant)beginMatch();else bridge().hint('對方想再來一場！');}
  else if(d.t==='bye'){conn=null;if(!closed)peerGone();}
 }
 function enter(){inMatch=true;root.hidden=true;document.body.classList.remove('duel-open');bridge().enter({me:{char:self.char,name:self.name},foe});}

 /* ---------- 房主裁判 ---------- */
 const mk=()=>({combo:0,lastHit:0,hp:D.hp,rage:0,guardUntil:0,guardReady:0,stunUntil:0,next:0});
 function beginMatch(){
  const now=performance.now();G={phase:'count',countEnd:now+D.count,endAt:0,P:[mk(),mk()],winner:-2};iWant=foeWants=overShown=false;
  enter();clearInterval(timer);timer=setInterval(tick,50);tick(true);
 }
 function tick(force){
  const now=performance.now();if(!G)return;
  if(G.phase==='count'&&now>=G.countEnd){G.phase='fight';G.endAt=now+D.round;}
  if(G.phase==='fight'&&now>=G.endAt)finish();
  if(force||now-lastSnapSent>=100){lastSnapSent=now;send(snapOf(now));}
  render();
 }
 function snapOf(now){return {t:'snap',phase:G.phase,count:Math.max(0,G.countEnd-now),left:G.phase==='count'?D.round:Math.max(0,G.endAt-now),hp:G.P.map(p=>p.hp),rage:G.P.map(p=>p.rage),guard:G.P.map(p=>Math.max(0,p.guardUntil-now)),gcd:G.P.map(p=>Math.max(0,p.guardReady-now)),stun:G.P.map(p=>Math.max(0,p.stunUntil-now)),winner:G.winner};}
 function send(m){try{conn&&conn.open&&conn.send(m);}catch{}}
 function finish(){const [a,b]=G.P;G.phase='over';G.winner=a.hp>b.hp?0:b.hp>a.hp?1:-1;send(snapOf(performance.now()));}
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
 function rematch(){iWant=true;if(isHost){if(foeWants)beginMatch();else send({t:'rematch'});}else send({t:'rematch'});}

 window.ArenaDuel={open,act,leave,rematch,openJoin:text=>{open();show('join');$('#duel-input').value=text;joinFrom(text);}};
 const btn=$('#duel-open');if(btn)btn.onclick=open;
 const room=new URLSearchParams(location.search).get('room');
 if(room&&/^[A-Za-z0-9]{6}$/.test(room))setTimeout(()=>window.ArenaDuel.openJoin(room),400);
})();

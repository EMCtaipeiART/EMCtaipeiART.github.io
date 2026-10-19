'use strict';
/* 出氣擂台 · 一對一對戰。房主（host）負責裁判運算，對手（guest）只送操作、接收快照。
   連線用 PeerJS（WebRTC 點對點），戰場序號 = 房主的 peer id 尾碼。 */
(() => {
 const D={hp:200,hit:3,block:5,rageHit:1,heavy:50,stun:3000,round:60000,count:3000,cd:220,guard:600,guardCd:1100};
 const names=['Amber','Anna','Leona','Machi','Noise','余采馨','吳冠賢','李明庭','廖秦葦','鄭筱舢','黎子瑄'];
 const weaponNames=['拳頭','藍白拖','平底鍋','鍵盤','奶油派','橡皮雞','雷擊','文件風暴'];
 const PEER_SRC='https://unpkg.com/peerjs@1.5.4/dist/peerjs.min.js',PREFIX='emcvent-',ALPHABET='ABCDEFGHJKMNPQRSTUVWXYZ23456789';
 const img=i=>`assets/${i<5?'designer':'staff'}_${names[i]}_front.png`;
 const $=s=>document.querySelector(s);
 let root,peer,conn,isHost=false,code='',me=0,G=null,snap=null,snapAt=0,timer=0,lastSnapSent=0,weapon=0,foeWants=false,iWant=false,closed=true,foe={name:'對手',char:4},self={name:'',char:3},toastTimer=0;
 const info=()=>window.ArenaDuelInfo?window.ArenaDuelInfo():{name:'',char:3};

 function el(tag,cls,html){const e=document.createElement(tag);if(cls)e.className=cls;if(html!=null)e.innerHTML=html;return e;}
 function build(){
  root=el('div','duel');root.id='duel';root.hidden=true;root.setAttribute('role','dialog');root.setAttribute('aria-modal','true');root.setAttribute('aria-label','一對一對戰');
  root.innerHTML=`<div class="duel-card">
   <button class="duel-x" data-act="leave" aria-label="離開對戰">✕</button>
   <section class="duel-menu" data-view="menu"><p class="duel-eyebrow">1 VS 1 · ONLINE</p><h2>一對一對戰</h2><p class="duel-sub">邀請同事，在擂台上正面對決。60 秒一回合，血量多的人獲勝！</p>
    <div class="duel-entries"><button data-act="host"><span>⚔</span><b>新開戰場<small>產生序號，等朋友加入</small></b></button><button data-act="joinview"><span>⌨</span><b>輸入序號<small>加入朋友的戰場</small></b></button></div>
    <ul class="duel-rules"><li>每個攻擊道具傷害相同：<b>-${D.hit}</b></li><li>🛡 格擋成功不扣血，並 <b>+${D.block}</b> 怒氣</li><li>打擊成功 <b>+${D.rageHit}</b> 怒氣，滿 100% 可使用「重擊」</li><li>重擊無視格擋 <b>-${D.heavy}</b> 血，並暈眩對手 3 秒</li></ul></section>
   <section class="duel-wait" data-view="host"><p class="duel-eyebrow">WAITING FOR CHALLENGER</p><h2>戰場已開啟</h2><p class="duel-sub">把序號傳給對手，對方輸入後立即開打。</p><div class="duel-code" id="duel-code">······</div><div class="duel-row"><button class="duel-main" data-act="copy">複製邀請</button><button data-act="back">取消</button></div><p class="duel-status" id="duel-wait-status">連線中…</p></section>
   <section class="duel-join" data-view="join"><p class="duel-eyebrow">JOIN A BATTLE</p><h2>輸入戰場序號</h2><p class="duel-sub">貼上序號或整段邀請文字都可以。</p><input id="duel-input" class="duel-input" maxlength="200" autocomplete="off" autocapitalize="characters" spellcheck="false" placeholder="例如 K7Q3MD"><div class="duel-row"><button class="duel-main" data-act="join">加入戰場</button><button data-act="back">返回</button></div><p class="duel-status" id="duel-join-status"></p></section>
   <section class="duel-fight" data-view="fight">
    <div class="duel-hud"><div class="duel-side" data-i="me"><b class="duel-name"></b><div class="duel-hp"><i></i><em></em></div></div><div class="duel-clock"><strong id="duel-time">60</strong><small id="duel-state">準備</small></div><div class="duel-side" data-i="foe"><b class="duel-name"></b><div class="duel-hp"><i></i><em></em></div></div></div>
    <div class="duel-ring" id="duel-ring"><div class="duel-fighter me"><img alt=""><span class="duel-shield">🛡</span><span class="duel-stars">✦ ✦ ✦</span></div><div class="duel-fighter foe"><img alt=""><span class="duel-shield">🛡</span><span class="duel-stars">✦ ✦ ✦</span></div><div class="duel-pops" id="duel-pops"></div><div class="duel-banner" id="duel-banner"></div></div>
    <div class="duel-rage"><span>怒氣 <b id="duel-rage-t">0%</b></span><div><i id="duel-rage-f"></i></div></div>
    <div class="duel-controls"><button class="duel-circle block" data-act="block" id="duel-block"><span>🛡</span>格擋<small>B</small></button><div class="duel-weapons" id="duel-weapons"></div><button class="duel-circle heavy" data-act="heavy" id="duel-heavy" disabled><span>💥</span>重擊<small>F</small></button></div>
    <div class="duel-over" id="duel-over" hidden><h3 id="duel-result">勝負已分</h3><p id="duel-result-sub"></p><div class="duel-row"><button class="duel-main" data-act="rematch" id="duel-rematch">再一場</button><button data-act="leave">結束比賽</button></div></div>
   </section></div>`;
  document.body.appendChild(root);
  const ws=$('#duel-weapons');
  weaponNames.forEach((n,i)=>{const b=el('button','duel-weapon');b.dataset.w=i;b.title=`${n}（${i+1}）`;b.setAttribute('aria-pressed',String(i===0));b.innerHTML=`<span aria-hidden="true">${window.ArenaWeaponArt?window.ArenaWeaponArt.svg(i):''}</span><b>${n}</b>`;b.onclick=()=>{weapon=i;mark();act({a:'atk',w:i});};ws.appendChild(b);});
  root.addEventListener('click',e=>{const b=e.target.closest('[data-act]');if(!b)return;const a=b.dataset.act;({host:openHost,joinview:()=>{show('join');setTimeout(()=>$('#duel-input').focus(),30);},back:backToMenu,copy:copyInvite,join:()=>joinFrom($('#duel-input').value),leave:leave,block:()=>act({a:'block'}),heavy:()=>act({a:'heavy'}),rematch:rematch})[a]?.();});
  $('#duel-input').addEventListener('keydown',e=>{if(e.key==='Enter')joinFrom(e.target.value);});
  document.addEventListener('keydown',e=>{if(root.hidden)return;e.stopImmediatePropagation();if(e.target.closest('input'))return;if(e.key==='Escape'){e.preventDefault();return;}if(!$('[data-view=fight]').classList.contains('on'))return;if(/^[1-8]$/.test(e.key)){weapon=Number(e.key)-1;mark();act({a:'atk',w:weapon});}else if(e.code==='Space'){e.preventDefault();act({a:'atk',w:weapon});}else if(e.key.toLowerCase()==='b')act({a:'block'});else if(e.key.toLowerCase()==='f')act({a:'heavy'});},true);
  document.addEventListener('keyup',e=>{if(!root.hidden)e.stopImmediatePropagation();},true);
 }
 function mark(){document.querySelectorAll('.duel-weapon').forEach((b,n)=>b.setAttribute('aria-pressed',String(n===weapon)));}
 function show(v){root.querySelectorAll('[data-view]').forEach(s=>s.classList.toggle('on',s.dataset.view===v));}
 function open(){if(!root)build();closed=false;root.hidden=false;document.body.classList.add('duel-open');const i=info();self={name:i.name||names[i.char]||'玩家',char:i.char};show('menu');}
 function say(sel,text,bad){const e=$(sel);if(e){e.textContent=text;e.classList.toggle('bad',!!bad);}}
 function loadPeer(){return window.Peer?Promise.resolve():new Promise((ok,no)=>{const s=document.createElement('script');s.src=PEER_SRC;s.onload=ok;s.onerror=()=>no(new Error('load'));document.head.appendChild(s);});}
 function teardown(){clearInterval(timer);timer=0;try{conn&&conn.close();}catch{}try{peer&&peer.destroy();}catch{}conn=peer=null;G=snap=null;foeWants=iWant=false;}
 function backToMenu(){teardown();show('menu');}
 function leave(){try{conn&&conn.open&&conn.send({t:'bye'});}catch{}teardown();closed=true;root.hidden=true;document.body.classList.remove('duel-open');}

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
 function inviteText(){const link=location.origin+location.pathname+'?room='+code,n=self.name;return `${n} 邀請您一同參加「EMC 出氣擂台」一對一對戰！\n戰場序號：${code}\n點此直接加入：${link}\n（開啟出氣擂台 → 一對一對戰 → 輸入序號 也可以）`;}
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
  conn=c;
  c.on('open',()=>hello());if(c.open)hello();
  c.on('data',onMsg);
  c.on('close',()=>{if(closed||!conn)return;if(G&&G.phase!=='over'||snap&&snap.phase!=='over')banner('對方已離開');else toast('對方已離開');clearInterval(timer);G&&(G.phase='over');$('#duel-over').hidden=false;$('#duel-result').textContent='對手已離開';$('#duel-result-sub').textContent='';$('#duel-rematch').disabled=true;if(!$('[data-view=fight]').classList.contains('on')){backToMenu();toast('對方已離開');}});
 }
 function hello(){try{conn.send({t:'hello',name:self.name,char:self.char});}catch{}}
 function toast(t){const e=$('#toast');if(!e)return;e.textContent=t;e.classList.add('visible');clearTimeout(toastTimer);toastTimer=setTimeout(()=>e.classList.remove('visible'),2500);}
 function onMsg(d){
  if(!d||typeof d!=='object')return;
  if(d.t==='hello'){foe={name:String(d.name||'對手').slice(0,16),char:names[d.char]?d.char:4};if(foe.name===self.name)foe.name+='（對手）';if(isHost)beginMatch();else show('fight'),paintNames();}
  else if(d.t==='full'){say('#duel-join-status','這個戰場已經有人了。',true);teardown();}
  else if(d.t==='snap'){snap=d;snapAt=performance.now();if(!timer)timer=setInterval(render,80);render();}
  else if(d.t==='ev')anim(d);
  else if(d.t==='act'&&isHost)apply(1,d);
  else if(d.t==='rematch'){foeWants=true;if(isHost&&iWant)beginMatch();else $('#duel-result-sub').textContent='對方想再來一場！';}
  else if(d.t==='bye'){if(!closed){conn=null;toast('對方已結束比賽');if(snap||G){$('#duel-over').hidden=false;$('#duel-result').textContent='對手已離開';$('#duel-result-sub').textContent='';$('#duel-rematch').disabled=true;}else backToMenu();}}
 }
 function paintNames(){const a=$('[data-i=me] .duel-name'),b=$('[data-i=foe] .duel-name');if(!a)return;a.textContent=self.name;b.textContent=foe.name;$('.duel-fighter.me img').src=img(self.char);$('.duel-fighter.foe img').src=img(foe.char);}

 /* ---------- 房主裁判 ---------- */
 const mk=()=>({hp:D.hp,rage:0,guardUntil:0,guardReady:0,stunUntil:0,next:0});
 function beginMatch(){
  const now=performance.now();G={phase:'count',countEnd:now+D.count,endAt:0,P:[mk(),mk()],winner:-2,seq:0};iWant=foeWants=false;
  show('fight');paintNames();$('#duel-over').hidden=true;$('#duel-rematch').disabled=false;
  clearInterval(timer);timer=setInterval(tick,50);tick(true);
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
 function finish(){const [a,b]=G.P;G.phase='over';G.winner=a.hp>b.hp?0:b.hp>a.hp?1:-1;const s=snapOf(performance.now());send(s);}
 function emit(e){e.t='ev';send(e);anim(e);}
 function apply(by,d){
  if(!G||G.phase!=='fight')return;const now=performance.now(),s=G.P[by],o=G.P[1-by];
  if(d.a==='block'){if(now>=s.guardReady){s.guardUntil=now+D.guard;s.guardReady=now+D.guardCd;emit({k:'guard',by});}}
  else if(now<s.stunUntil||now<s.next)return;
  else if(d.a==='atk'){s.next=now+D.cd;const w=Math.max(0,Math.min(7,Number(d.w)|0));
   if(now<o.guardUntil){o.rage=Math.min(100,o.rage+D.block);o.guardUntil=0;emit({k:'block',by,w});}
   else{o.hp=Math.max(0,o.hp-D.hit);s.rage=Math.min(100,s.rage+D.rageHit);emit({k:'hit',by,w,dmg:D.hit});}}
  else if(d.a==='heavy'){if(s.rage<100)return;s.next=now+D.cd;s.rage=0;o.hp=Math.max(0,o.hp-D.heavy);o.stunUntil=now+D.stun;emit({k:'heavy',by,dmg:D.heavy});}
  if(o.hp<=0)finish();
  send(snapOf(now));render();
 }
 function act(d){if(closed)return;if(isHost)apply(0,d);else if(snap&&snap.phase==='fight')send({t:'act',a:d.a,w:d.w});}

 /* ---------- 畫面 ---------- */
 function view(){
  if(isHost&&G){const now=performance.now();return snapOf(now);}
  if(!snap)return null;const dt=performance.now()-snapAt,s=snap,sub=a=>a.map(v=>Math.max(0,v-dt));
  return {...s,left:s.phase==='fight'?Math.max(0,s.left-dt):s.left,count:Math.max(0,s.count-dt),guard:sub(s.guard),gcd:sub(s.gcd),stun:sub(s.stun)};
 }
 function render(){
  const v=view();if(!v||root.hidden)return;const o=1-me,ring=$('#duel-ring');
  for(const [side,i] of [['me',me],['foe',o]]){const box=$(`[data-i=${side}]`);box.querySelector('i').style.width=(v.hp[i]/D.hp*100)+'%';box.querySelector('em').textContent=v.hp[i]+' / '+D.hp;box.querySelector('i').dataset.low=v.hp[i]<D.hp*.3?'1':'';
   const f=ring.querySelector('.duel-fighter.'+side);f.classList.toggle('guarding',v.guard[i]>0);f.classList.toggle('stunned',v.stun[i]>0);}
  $('#duel-time').textContent=String(Math.ceil(v.left/1000));
  $('#duel-state').textContent=v.phase==='count'?'準備':v.phase==='fight'?'戰鬥中':'結束';
  $('#duel-rage-t').textContent=v.rage[me]+'%';$('#duel-rage-f').style.width=v.rage[me]+'%';$('#duel-rage-f').parentNode.classList.toggle('full',v.rage[me]>=100);
  const fight=v.phase==='fight',stun=v.stun[me]>0;
  $('#duel-heavy').disabled=!(fight&&v.rage[me]>=100&&!stun);$('#duel-heavy').classList.toggle('ready',v.rage[me]>=100);
  $('#duel-block').disabled=!fight||v.gcd[me]>0;$('#duel-block').classList.toggle('on',v.guard[me]>0);
  document.querySelectorAll('.duel-weapon').forEach(b=>b.disabled=!fight||stun);
  ring.classList.toggle('me-stun',stun);
  if(v.phase==='count')banner(String(Math.max(1,Math.ceil(v.count/1000))),true);
  else if(v.phase==='fight'&&bannerKey==='count'){banner('FIGHT!',false,900);}
  if(v.phase==='over'&&!overShown){overShown=true;showOver(v);}
  if(v.phase!=='over'){overShown=false;iWant=false;}
  if(stun)banner('暈眩中…'+(v.stun[me]/1000).toFixed(1)+'s',false,200,'stun');
 }
 let overShown=false,bannerKey='',bannerTimer=0;
 function banner(text,count,ms,key){const b=$('#duel-banner');if(!b)return;b.textContent=text;b.classList.add('show');bannerKey=count?'count':key||'';clearTimeout(bannerTimer);if(ms)bannerTimer=setTimeout(()=>{b.classList.remove('show');if(bannerKey!=='count')bannerKey='';},ms);else if(!count&&!ms)bannerTimer=setTimeout(()=>b.classList.remove('show'),1500);}
 function showOver(v){
  const w=v.winner,win=w===me,text=w===-1?'平手！勢均力敵':win?'你贏了！':'你輸了…';
  $('#duel-over').hidden=false;$('#duel-result').textContent=text;$('#duel-result-sub').textContent=`${self.name} ${v.hp[me]} 血 vs ${foe.name} ${v.hp[1-me]} 血`;
  $('#duel-rematch').disabled=false;$('#duel-rematch').textContent='再一場';$('#duel-banner').classList.remove('show');
 }
 function rematch(){iWant=true;$('#duel-rematch').disabled=true;$('#duel-rematch').textContent='等待對方…';if(isHost){if(foeWants)beginMatch();else send({t:'rematch'});}else send({t:'rematch'});if(!isHost&&foeWants){/* 房主會在收到我的請求時開局 */}}
 function anim(e){
  const side=e.by===me?'me':'foe',other=side==='me'?'foe':'me',ring=$('#duel-ring');if(!ring)return;
  const a=ring.querySelector('.duel-fighter.'+side),d=ring.querySelector('.duel-fighter.'+other);
  const pulse=(n,c)=>{n.classList.remove(c);void n.offsetWidth;n.classList.add(c);setTimeout(()=>n.classList.remove(c),420);};
  if(e.k==='guard')return;
  pulse(a,'lunge');
  if(e.k==='hit'){pulse(d,'hurt');pop(other,'-'+e.dmg,'hit');}
  else if(e.k==='block'){pulse(d,'blockfx');pop(other,'格擋！ +'+D.block,'block');}
  else if(e.k==='heavy'){pulse(d,'hurt');ring.classList.add('slam');setTimeout(()=>ring.classList.remove('slam'),500);pop(other,'重擊 -'+e.dmg,'heavy');banner('重擊！',false,700);}
 }
 function pop(side,text,kind){const p=el('span','duel-pop '+kind);p.textContent=text;p.style.left=(side==='me'?24:76)+'%';p.style.setProperty('--dx',(Math.random()*30-15)+'px');$('#duel-pops').appendChild(p);setTimeout(()=>p.remove(),900);}

 window.ArenaDuel={open,openJoin:codeText=>{open();show('join');$('#duel-input').value=codeText;joinFrom(codeText);}};
 const btn=$('#duel-open');if(btn)btn.onclick=open;
 const room=new URLSearchParams(location.search).get('room');
 if(room&&/^[A-Za-z0-9]{6}$/.test(room))setTimeout(()=>window.ArenaDuel.openJoin(room),400);
})();

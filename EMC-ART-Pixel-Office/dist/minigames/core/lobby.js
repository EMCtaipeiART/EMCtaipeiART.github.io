// 躲貓貓連線大廳：建立房間（邀請碼）、輸入邀請碼加入、等待並由房主開始。
// 玩家只用匿名暱稱；伺服器發的憑證只存在 sessionStorage（重連用），不連結任何同事資料。
import {createNet,createRoomCode,hideSeekServerUrl,hideSeekSession} from './net.js';

const esc=s=>String(s).replace(/[&<>"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]));
const ERR={4404:'找不到這個房間，請確認邀請碼',4409:'房間已滿或遊戲已開始',4400:'邀請碼格式不對',4429:'操作太頻繁，請稍後再試',4408:'房間閒置太久已關閉',4413:'訊息太大'};
const NAME_KEY='emc-mg-name',TOKEN_KEY=code=>'emc-hs-token-'+code;
const safe=(fn,fb)=>{try{return fn();}catch{return fb;}};

export function createLobby({manager,gameId='hideseek-online',doc=document,url=hideSeekServerUrl(),netFactory=createNet}){
  const root=doc.createElement('div');root.className='mg-lobby';root.hidden=true;doc.body.appendChild(root);
  const S=hideSeekSession;
  let net=null,room=null,view='connect',status='',retries=0,pendingCreate=null;

  const name=()=>(root.querySelector('#hsName')?.value||safe(()=>localStorage.getItem(NAME_KEY),'')||'').trim().slice(0,12);
  function render(){
    if(view==='connect'){
      root.innerHTML='<h2>躲貓貓・連線</h2><label>你的暱稱（匿名，最多 12 字）<input id="hsName" maxlength="12" value="'+esc(safe(()=>localStorage.getItem(NAME_KEY),'')||'')+'"></label>'
        +'<div class="row"><select id="hsMax" aria-label="人數">'+[2,3,4,5,6].map(n=>'<option value="'+n+'"'+(n===4?' selected':'')+'>'+n+' 人</option>').join('')+'</select><button type="button" class="mg-btn" data-a="create">建立房間</button></div>'
        +'<div class="row"><input id="hsCode" maxlength="6" placeholder="邀請碼" autocapitalize="characters" autocomplete="off"><button type="button" class="mg-btn" data-a="join">加入</button></div>'
        +'<p class="err">'+esc(status)+'</p><button type="button" class="mg-btn" data-a="close">關閉</button>';
    }else{
      const st=room||{};
      const list=(st.players||[]).map(p=>'<li class="'+(p.online?'on':'off')+'"><span>'+esc(p.name)+(p.id===st.host?'（房主）':'')+(p.id===st.you?'（你）':'')+'</span><em>'+(p.online?'在線':'離線')+'</em></li>').join('');
      const isHost=st.host===st.you,online=(st.players||[]).filter(p=>p.online).length;
      root.innerHTML='<h2>房間 <b class="code">'+esc(st.room||'')+'</b></h2><p class="hint">把邀請碼給同事；人數 '+(st.players||[]).length+' / '+(st.max||'?')+'</p><ul class="roster">'+list+'</ul>'
        +(st.state==='playing'?'<p>遊戲進行中</p><button type="button" class="mg-btn" data-a="back">回到遊戲</button>':
          (isHost?'<button type="button" class="mg-btn" data-a="start"'+(online<2?' disabled':'')+'>開始遊戲'+(online<2?'（至少 2 人）':'')+'</button>':'<p>等待房主開始…</p>'))
        +'<p class="err">'+esc(status)+'</p><button type="button" class="mg-btn" data-a="leave">離開房間</button>';
    }
  }
  function connect(code,mode,max){
    const nick=name();// 先取暱稱：下面 render 會重畫輸入框
    if(net)net.close();
    room=null;status='連線中…';view='connect';render();
    const token=mode==='join'?safe(()=>sessionStorage.getItem(TOKEN_KEY(code)),''):'';
    net=netFactory({url,room:code,mode,name:nick,max,token,onMessage,onState:(st,info)=>onState(st,info,code,mode,max)});
    S.net=net;
  }
  function onState(st,info,code,mode,max){
    if(st==='reconnecting'){status='連線中斷，重新連線…';render();}
    if(S.onNetState)S.onNetState(st,info);
    if(st==='closed'&&info&&info.code!==1000){
      if(info.code===4409&&mode==='create'&&pendingCreate&&retries<5){retries++;connect(createRoomCode(),'create',max);return;}// 邀請碼剛好被用過：換一組
      status=ERR[info.code]||'連線失敗，請稍後再試';net=null;S.reset();room=null;view='connect';render();
    }
  }
  function onMessage(m){
    if(m.t==='welcome'){
      S.you=m.you;room={room:m.room,max:m.max,host:m.host,state:m.state,players:m.players,you:m.you};view='wait';status='';
      safe(()=>sessionStorage.setItem(TOKEN_KEY(m.room),m.token));safe(()=>localStorage.setItem(NAME_KEY,m.players.find(p=>p.id===m.you).name));render();
    }else if(m.t==='lobby'){
      if(room){Object.assign(room,{host:m.host,max:m.max,state:m.state,players:m.players});if(!manager.active)render();}
    }else if(m.t==='game'){
      S.info=m;if(room)room.state='playing';
      if(!manager.active){root.hidden=true;manager.open(gameId);}
    }else if(m.t==='void'){if(room)room.state='lobby';status=m.reason==='seeker-left'?'上一局作廢：尋找者離線':'上一局作廢';S.handler&&S.handler(m);if(!manager.active)render();}
    else if(m.t==='over'){if(room)room.state='lobby';status='上一局結束';if(S.handler)S.handler(m);else render();}
    else if(S.handler)S.handler(m);
  }
  function leave(){
    if(net)net.close();
    if(room)safe(()=>sessionStorage.removeItem(TOKEN_KEY(room.room)));
    net=null;room=null;S.reset();view='connect';status='';render();
  }
  root.addEventListener('click',e=>{
    const b=e.target.closest('[data-a]');if(!b)return;
    const a=b.dataset.a;
    if(a==='create'){pendingCreate=true;retries=0;connect(createRoomCode(),'create',Number(root.querySelector('#hsMax').value)||4);}
    else if(a==='join'){const code=root.querySelector('#hsCode').value.trim().toUpperCase();if(!/^[A-Z0-9]{6}$/.test(code)){status='請輸入 6 碼邀請碼';render();return;}pendingCreate=false;connect(code,'join');}
    else if(a==='start')S.send({t:'start'});
    else if(a==='back'){if(S.info){root.hidden=true;manager.open(gameId);}}
    else if(a==='leave')leave();
    else if(a==='close')root.hidden=true;
  });
  // 遊戲視窗關掉後（結算或離開）回到大廳；連線還在就留在房間裡
  manager.onClosed(id=>{if(id===gameId){if(room&&room.state!=='playing')S.info=null;if(net)view='wait';render();root.hidden=false;}});
  return {show(){render();root.hidden=false;},hide(){root.hidden=true;},leave,get connected(){return !!net;}};
}

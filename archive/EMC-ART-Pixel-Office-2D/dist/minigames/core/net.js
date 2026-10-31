// 連線客戶端：WebSocket 連到躲貓貓房間，自動 ping、斷線自動重連（用伺服器發的憑證認回座位）。
// 開發時（localhost）連本機 wrangler dev；其他網址連正式 Worker。可用 ?hsServer=wss://… 覆寫。
const FATAL=new Set([4400,4404,4408,4409,4413,4429,4000,1000]);// 這些關閉碼代表「不要再重連」
const BACKOFF=[400,900,1800,3500,5000];

export function hideSeekServerUrl(loc=globalThis.location){
  const override=new URLSearchParams(loc.search).get('hsServer');
  if(override)return override;
  if(/^(localhost|127\.0\.0\.1)$/.test(loc.hostname))return 'ws://127.0.0.1:8799/hideseek';
  return 'wss://machi-design-api.machi-chen.workers.dev/hideseek';
}

export function createRoomCode(rand=n=>crypto.getRandomValues(new Uint32Array(n))){
  const A='ABCDEFGHJKLMNPQRSTUVWXYZ23456789',r=rand(6);// 去掉 0/O/1/I，避免唸錯
  return Array.from(r,v=>A[v%A.length]).join('');
}

export function createNet({url,room,mode,name,max,token='',WS=globalThis.WebSocket,setTimer=setTimeout,clearTimer=clearTimeout,setTick=setInterval,clearTick=clearInterval,onMessage,onState}){
  let ws=null,state='connecting',tries=0,timer=0,pinger=0,closing=false,curMode=mode,curToken=token;
  const set=(s,info)=>{state=s;if(onState)onState(s,info);};
  function connect(){
    const q=new URLSearchParams({room,mode:curMode,name:name||''});
    if(curMode==='create'&&max)q.set('max',String(max));
    if(curToken)q.set('token',curToken);
    ws=new WS(url+'?'+q.toString());
    const mine=ws;
    ws.onopen=()=>{if(mine!==ws)return;tries=0;set('open');clearTick(pinger);pinger=setTick(()=>send({t:'ping'}),20000);};
    ws.onmessage=e=>{
      if(mine!==ws)return;
      let m;try{m=JSON.parse(e.data);}catch{return;}
      if(m.t==='welcome'){curToken=m.token;curMode='join';}// 重連一律用 join＋憑證
      if(onMessage)onMessage(m);
    };
    ws.onclose=e=>{
      if(mine!==ws)return;
      clearTick(pinger);
      if(closing||FATAL.has(e.code)||tries>=BACKOFF.length)return set('closed',{code:e.code});
      set('reconnecting',{attempt:tries+1});
      timer=setTimer(()=>{timer=0;tries++;connect();},BACKOFF[tries]);
    };
    ws.onerror=()=>{};
  }
  function send(obj){if(ws&&ws.readyState===1){try{ws.send(JSON.stringify(obj));return true;}catch{return false;}}return false;}
  function close(){
    closing=true;clearTick(pinger);if(timer)clearTimer(timer);timer=0;
    if(ws){const w=ws;try{w.onmessage=w.onclose=w.onopen=null;send({t:'leave'});w.close(1000);}catch{/* 已關閉 */}}
    ws=null;set('closed',{code:1000});
  }
  connect();
  return {send,close,get state(){return state;},get token(){return curToken;}};
}

/** 大廳與遊戲共用的連線工作階段：大廳負責連線與房間，遊戲只接收訊息、送輸入。 */
export const hideSeekSession={net:null,you:'',info:null,handler:null,send(obj){return this.net?this.net.send(obj):false;},reset(){this.net=null;this.you='';this.info=null;this.handler=null;}};

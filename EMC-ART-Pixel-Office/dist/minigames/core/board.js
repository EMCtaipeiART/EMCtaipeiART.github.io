// 排行榜 API 客戶端：開票 → 玩 → 提交。日期與種子由伺服器決定，分數由伺服器重算；這裡只負責傳遞。
// 裝置碼是伺服器發的匿名隨機碼（存在這個瀏覽器），暱稱只是顯示用；不連結任何人事或工作狀態資料。
// 開發時（localhost）連本機 wrangler dev；可用 ?mgApi=https://… 覆寫。
const DEVICE_KEY='emc-mg-device',TIMEOUT_MS=4000;
const safe=(fn,fb)=>{try{return fn();}catch{return fb;}};

export function boardBaseUrl(loc=globalThis.location){
  const override=new URLSearchParams(loc.search).get('mgApi');
  if(override)return override.replace(/\/$/,'');
  if(/^(localhost|127\.0\.0\.1)$/.test(loc.hostname))return 'http://127.0.0.1:8799';
  return 'https://machi-design-api.machi-chen.workers.dev';
}

export function createBoardClient({base=boardBaseUrl(),fetchImpl=(...a)=>globalThis.fetch(...a),storage=globalThis.localStorage,timeoutMs=TIMEOUT_MS}={}){
  async function call(path,{method='GET',body}={}){
    const ac=new AbortController(),timer=setTimeout(()=>ac.abort(),timeoutMs);
    try{
      const res=await fetchImpl(base+path,{method,signal:ac.signal,headers:body?{'Content-Type':'application/json'}:undefined,body:body?JSON.stringify(body):undefined});
      const json=await res.json().catch(()=>({ok:false,error:'bad-response'}));
      return {...json,ok:!!json.ok&&res.ok,status:res.status};
    }finally{clearTimeout(timer);}
  }
  return {
    async startRun(game,nick){
      const device=safe(()=>storage.getItem(DEVICE_KEY),'')||'';
      const r=await call('/minigames/run',{method:'POST',body:{game,device,nick}});
      if(r.ok&&r.device)safe(()=>storage.setItem(DEVICE_KEY,r.device));
      return r;
    },
    submit(ticket,log){return call('/minigames/submit',{method:'POST',body:{runId:ticket.runId,device:ticket.device,log}});},
    board(game,range='today'){return call('/minigames/board?game='+encodeURIComponent(game)+'&range='+range);}
  };
}

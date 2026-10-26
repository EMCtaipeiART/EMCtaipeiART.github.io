// 每日種子：同一天、同一款遊戲，所有人拿到同一組題目。
export function hashString(text){let h=2166136261;for(let i=0;i<text.length;i++){h^=text.charCodeAt(i);h=Math.imul(h,16777619);}return h>>>0;}
export function dayKey(date=new Date()){
  return new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Taipei',year:'numeric',month:'2-digit',day:'2-digit'}).format(date);// YYYY-MM-DD（台北時間）
}
export function dailySeed(gameId,date=new Date()){return hashString(gameId+'@'+dayKey(date));}
export function createRng(seed){
  let a=seed>>>0;
  const next=()=>{a=(a+0x6D2B79F5)>>>0;let t=a;t=Math.imul(t^(t>>>15),t|1);t^=t+Math.imul(t^(t>>>7),t|61);return((t^(t>>>14))>>>0)/4294967296;};
  return {next,int:(min,max)=>min+Math.floor(next()*(max-min+1)),pick:list=>list[Math.floor(next()*list.length)],
    shuffle:list=>{const r=list.slice();for(let i=r.length-1;i>0;i--){const j=Math.floor(next()*(i+1));[r[i],r[j]]=[r[j],r[i]];}return r;}};
}

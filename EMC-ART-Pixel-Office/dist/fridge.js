/* 茶水間冰箱：點冰箱或零食桌開面板，拿零食（偷吃）、補貨、看今日補貨人與零食之王。
   庫存、每日自動進貨與排行都在 Worker（/minigames/fridge）；這裡只負責畫面。 */
(()=>{
const SLOTS=[['chips','洋芋片'],['cookie','餅乾'],['candy','糖果'],['pudding','布丁'],['yogurt','優格'],['drink','汽水'],['rare','限量金布丁']];
const SHEET='assets/office-snacks-v1.webp?v=1',IDX={chips:0,cookie:1,candy:2,pudding:3,yogurt:4,drink:5,rare:6,expired:7};
const base=()=>new URLSearchParams(location.search).get('mgApi')?.replace(/\/$/,'')||(/^(localhost|127\.0\.0\.1)$/.test(location.hostname)?'http://127.0.0.1:8799':'https://machi-design-api.machi-chen.workers.dev');
const nick=()=>{try{return String(window.__pixelOffice.viewerName()||'').trim();}catch{return '';}};
const isMonitor=()=>{try{return !!window.__pixelOffice.isMonitor();}catch{return false;}};
let root,state=null,mode='take',busy=false;
const css=`#fridgePanel{position:fixed;inset:0;z-index:60;display:flex;align-items:center;justify-content:center;background:rgba(10,16,24,.55);font-family:system-ui,'PingFang TC','Microsoft JhengHei',sans-serif}
#fridgePanel[hidden]{display:none}
#fridgePanel .fr{width:min(430px,94vw);max-height:94vh;overflow:auto;background:#dff3f8;border:3px solid #000;box-shadow:6px 6px 0 #000;padding:12px 14px 14px;color:#111}
#fridgePanel h2{margin:0 0 8px;font-size:18px;display:flex;justify-content:space-between;align-items:center}
#fridgePanel .x{border:3px solid #000;background:#fff;font-weight:900;width:30px;height:30px;cursor:pointer}
#fridgePanel .tabs{display:flex;gap:6px;margin-bottom:8px}
#fridgePanel .tab{flex:1;border:3px solid #000;background:#fff;padding:5px;font-weight:800;cursor:pointer}
#fridgePanel .tab.on{background:#159E31;color:#fff}
#fridgePanel .shelf{display:grid;grid-template-columns:repeat(4,1fr);gap:6px;background:#bfe3ec;border:3px solid #000;padding:8px}
#fridgePanel .cell{border:3px solid #000;background:#fff;padding:4px 2px;text-align:center;cursor:pointer;font-size:12px;font-weight:700;position:relative}
#fridgePanel .cell:active{transform:translate(2px,2px)}
#fridgePanel .cell.empty{opacity:.45;filter:grayscale(1)}
#fridgePanel .cell.rare{background:#fff4b8}
#fridgePanel .ic{width:48px;height:48px;margin:0 auto 2px;background-size:384px 48px;image-rendering:pixelated}
#fridgePanel .qty{position:absolute;right:3px;top:1px;font-size:11px;background:#000;color:#fff;padding:0 4px}
#fridgePanel .msg{min-height:44px;margin:8px 0;border:3px solid #000;background:#fff;padding:6px 8px;font-weight:800;display:flex;align-items:center;gap:8px}
#fridgePanel .msg .ic{margin:0;flex:none}
#fridgePanel .meta{font-size:12px;line-height:1.7}
#fridgePanel .fill{margin-top:6px;width:100%;border:3px solid #000;background:#ffd23f;font-weight:900;padding:6px;cursor:pointer}
@keyframes frpop{0%{transform:scale(.6)}60%{transform:scale(1.15)}100%{transform:scale(1)}}
#fridgePanel .msg.pop .ic{animation:frpop .35s}`;
function icon(name,cls=''){const i=IDX[name]??0;return `<div class="ic ${cls}" style="background-image:url(${SHEET});background-position:-${i*48}px 0"></div>`;}
function esc(t){return String(t).replace(/[&<>"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]));}
function render(msg){
  if(!root)return;const st=state||{stock:{}};
  const cells=SLOTS.filter(([id])=>id!=='rare'||(st.stock.rare||0)>0).map(([id,name])=>{const q=st.stock[id]||0;
    return `<div class="cell ${q?'':'empty'} ${id==='rare'?'rare':''}" data-slot="${id}">${icon(id)}<span class="qty">${q}</span>${name}</div>`;}).join('');
  const rank=(list,unit)=>list&&list.length?list.map((r,i)=>`${['🥇','🥈','🥉'][i]} ${esc(r.nick)} ×${r.n}${unit}`).join('　'):'還沒有人';
  const time=st.stockAt?new Date(st.stockAt).toLocaleTimeString('zh-TW',{hour:'2-digit',minute:'2-digit',hour12:false,timeZone:'Asia/Taipei'}):'';
  root.querySelector('.fr').innerHTML=`<h2><span>🧊 茶水間冰箱</span><button class="x" data-x>✕</button></h2>
   <div class="tabs"><button class="tab ${mode==='take'?'on':''}" data-mode="take">拿零食</button><button class="tab ${mode==='stock'?'on':''}" data-mode="stock">補貨</button></div>
   <div class="shelf">${cells}</div>
   <div class="msg ${msg&&msg.pop?'pop':''}">${msg?(msg.icon?icon(msg.icon):'')+'<span>'+msg.text+'</span>':(mode==='take'?'點一格零食拿一個～':'點一格零食補 2 個（每人每天最多 5 次）')}</div>
   ${mode==='stock'&&isMonitor()?'<button class="fill" data-fill>管理者：一鍵補滿</button>':''}
   <div class="meta">📦 今日補貨：<b>${esc(st.stocker||'—')}</b>${time?'（'+time+'）':''}<br>🍪 本週零食之王：${rank(st.kings,'')}<br>🦸 本週補貨英雄：${rank(st.heroes,'')}</div>`;
}
async function call(body){
  const r=await fetch(base()+'/minigames/fridge',{method:body?'POST':'GET',headers:body?{'Content-Type':'application/json'}:undefined,body:body?JSON.stringify(body):undefined});
  return {status:r.status,...(await r.json().catch(()=>({ok:false})))};
}
async function act(body){
  if(busy)return;busy=true;
  try{
    const r=await call({...body,nick:nick()||'匿名'});if(r.stock)state=r;
    if(r.ok&&body.action==='take'){
      const m={rare:{icon:'rare',text:'✨ 哇！抽到限量金布丁！今天運氣爆棚'},expired:{icon:'expired',text:'🤢 啊！吃到過期優格⋯⋯明天找人補貨吧'}}[r.surprise];
      const nm=SLOTS.find(s=>s[0]===body.slot)[1];
      render(r.caught?{icon:body.slot,text:'🚨 被抓到下班偷吃「'+nm+'」！下次小聲一點',pop:1}:m?{...m,pop:1}:{icon:body.slot,text:'😋 好吃！拿了一個'+nm,pop:1});
    }else if(r.ok)render({icon:body.slot,text:body.action==='fill'?'🦸 全部補滿！大家會感謝你':'🦸 補貨完成，名牌換成你了！',pop:1});
    else render({text:r.error==='empty'?'😢 空了⋯⋯去「補貨」分頁補一下吧':r.error==='full-stomach'?'🤰 你今天吃太多了，明天再來':r.error==='enough'?'🙏 今天補太多次了，謝謝你！':'發生一點問題，等等再試'});
  }catch{render({text:'連線失敗，等等再試'});}finally{busy=false;}
}
function build(){
  const st=document.createElement('style');st.textContent=css;document.head.appendChild(st);
  root=document.createElement('div');root.id='fridgePanel';root.hidden=true;root.innerHTML='<div class="fr"></div>';document.body.appendChild(root);
  root.addEventListener('click',e=>{
    if(e.target===root||e.target.closest('[data-x]')){root.hidden=true;return;}
    const m=e.target.closest('[data-mode]');if(m){mode=m.dataset.mode;render();return;}
    if(e.target.closest('[data-fill]')){act({action:'fill'});return;}
    const c=e.target.closest('[data-slot]');if(c)act({action:mode,slot:c.dataset.slot});
  });
  document.addEventListener('keydown',e=>{if(e.key==='Escape'&&!root.hidden)root.hidden=true;});
}
window.openFridge=async()=>{
  if(!root)build();root.hidden=false;render();
  try{const r=await call();if(r.stock){state=r;render();}}catch{render({text:'連線失敗，等等再試'});}
};
})();

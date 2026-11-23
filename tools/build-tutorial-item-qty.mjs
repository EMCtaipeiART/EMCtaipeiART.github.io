// 產生 tutorial/item-qty.html：項目細節「各項件數」操作教學（自動播放、附說明字幕）。
// 頁面直接嵌入 site.js 裡真正的件數下拉程式（detailPickHtml／dqInit／dqOnChange…），
// 所以教學畫面的行為跟網站一致；改了 site.js 的件數邏輯後重新執行本程式即可同步。
// 用法：node tools/build-tutorial-item-qty.mjs
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const site = fs.readFileSync(path.join(root, 'site.js'), 'utf8');
const a = site.indexOf('    function detailQtyOf(row)');
const b = site.indexOf('    /* 右上角的 Google 信箱');
if (a < 0 || b < 0) throw new Error('找不到 site.js 的件數程式區段');
const helper = site.slice(a, b);
let voice = { shifts: [], totalShift: 0, endExtra: 0 };
try { voice = JSON.parse(fs.readFileSync(path.join(root, 'tutorial', 'item-qty-voice.json'), 'utf8')); } catch (e) {}

const html = `<!doctype html>
<html lang="zh-Hant">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>教學｜項目細節分開填件數</title>
<script>(()=>{try{document.documentElement.dataset.theme=localStorage.getItem('designRequestThemeV1')==='dark'?'dark':'light'}catch(e){document.documentElement.dataset.theme='light'}})();</script>
<link rel="stylesheet" href="../site.css">
<style>
  html,body{margin:0;height:100%;background:var(--bg);color:var(--ink);font-family:"Noto Sans TC","PingFang TC","Microsoft JhengHei",system-ui,sans-serif;overflow:hidden}
  #wrap{position:fixed;inset:0;display:grid;place-items:center}
  #stage{position:relative;width:1280px;height:720px;background:var(--bg);overflow:hidden;transform-origin:center center;flex:none}
  .tbar{position:absolute;left:0;right:0;top:0;height:56px;display:flex;align-items:center;padding:0 28px;gap:14px;background:var(--panel);border-bottom:1px solid var(--line);font-weight:900;font-size:18px}
  .tbar small{font-weight:700;color:var(--muted);font-size:14px}
  .x-board{position:absolute;left:28px;top:84px;width:360px;display:grid;gap:14px}
  .x-case{background:var(--panel);border:1px solid var(--line);border-radius:16px;padding:16px 18px;box-shadow:0 6px 18px rgba(0,0,0,.06)}
  .x-case .xid{display:inline-block;background:var(--brand-soft);color:var(--brand-deep);font-weight:900;border-radius:999px;padding:2px 10px;font-size:13px}
  .x-case h4{margin:8px 0 4px;font-size:16px}.x-case p{margin:0;color:var(--muted);font-size:13px;font-weight:700}
  .x-case .xchips{margin-top:10px;display:flex;flex-wrap:wrap;gap:6px;min-height:26px;align-items:center}
  .x-case .xchips .xnone{color:var(--muted);font-size:13px;font-weight:700}
  .x-case .xedit{margin-left:auto;border:1px solid var(--line);background:var(--bg);border-radius:999px;padding:3px 12px;font-size:13px;font-weight:800;color:var(--ink)}
  .x-case.hi{outline:3px solid var(--brand)}
  #modalWrap{position:absolute;left:420px;top:68px;width:520px}
  #modalWrap .ai-card{width:520px;max-height:none;overflow:visible;box-shadow:0 14px 40px rgba(0,0,0,.22)}
  #modalWrap .detail-pick{max-height:none;overflow:visible}
  #mHint{display:none}
  #modalWrap .ai-card{padding:16px 20px}
  #modalWrap .detail-pick{gap:6px}
  #modalWrap .ai-actions{display:flex;justify-content:flex-end;gap:10px;margin-top:12px}
  #score{position:absolute;left:970px;top:84px;width:284px;background:var(--panel);border:1px solid var(--line);border-radius:16px;padding:16px 18px}
  #score h5{margin:0 0 10px;font-size:14px;color:var(--muted);font-weight:900}
  #score .row{display:flex;justify-content:space-between;font-size:14px;font-weight:800;padding:4px 0}
  #score .row.sum{border-top:2px solid var(--line);margin-top:8px;padding-top:10px;font-size:20px;color:var(--brand-deep)}
  #score .formula{font-size:13px;color:var(--muted);font-weight:700;margin-top:8px;line-height:1.6}
  #score .wtable{font-size:12.5px;color:var(--muted);font-weight:700;margin-bottom:8px;line-height:1.7}
  #cap{position:absolute;left:0;right:0;bottom:0;height:112px;background:var(--panel);border-top:1px solid var(--line);display:flex;align-items:center;padding:0 36px;gap:22px}
  #cap .step{flex:none;width:54px;height:54px;border-radius:50%;background:var(--brand);color:#fff;font-weight:900;font-size:24px;display:grid;place-items:center}
  #cap .txt{font-size:24px;font-weight:900;line-height:1.4}#cap .sub{font-size:16px;font-weight:700;color:var(--muted);margin-top:4px}
  #cursor{position:absolute;left:0;top:0;width:28px;height:28px;z-index:50;pointer-events:none;filter:drop-shadow(0 2px 3px rgba(0,0,0,.35))}
  .rip{position:absolute;width:30px;height:30px;margin:-15px 0 0 -15px;border-radius:50%;border:3px solid var(--brand);z-index:49;pointer-events:none}
  #ddl{position:absolute;z-index:48;background:var(--panel);border:1px solid var(--line);border-radius:10px;box-shadow:0 8px 24px rgba(0,0,0,.25);padding:4px;min-width:72px}
  #ddl div{padding:6px 12px;font-weight:800;border-radius:6px;font-size:15px}#ddl div.hov{background:var(--brand);color:#fff}
  #title{position:absolute;inset:0;z-index:60;background:var(--bg);display:grid;place-items:center;text-align:center}
  #title h1{font-size:44px;margin:0 0 14px}#title p{font-size:22px;color:var(--muted);font-weight:700;margin:6px 0}
  #ctl{position:fixed;right:14px;top:12px;z-index:99;display:flex;gap:8px}
  #ctl button{border:1px solid var(--line);background:var(--panel);color:var(--ink);border-radius:999px;padding:7px 16px;font-weight:800;cursor:pointer;font-size:14px}
  body.rec #ctl{display:none}
  .tag{display:inline-block;background:#fff3cd;color:#8a5300;border-radius:8px;padding:1px 8px;font-size:14px;font-weight:900}
  html[data-theme="dark"] .tag{background:#4a3a10;color:#ffd166}
</style>
</head>
<body>
<div id="ctl"><button id="bPlay">⏸ 暫停</button><button id="bRe">↻ 重播</button><a href="item-qty.webm" target="_blank" style="align-self:center;font-size:14px;font-weight:800;color:var(--brand-deep)">🔊 看有聲音的影片版</a><a href="../" style="align-self:center;font-size:14px;font-weight:800;color:var(--brand-deep)">回系統</a></div>
<div id="wrap"><div id="stage">
  <div class="tbar">專案 <small>｜設計師的案件看板（教學示範資料，不會改到真實案件）</small></div>
  <div class="x-board">
    <div class="x-case" id="caseA"><span class="xid">示範案件 A</span><h4>12月貼文＿第一篇</h4><p>平面／新製　·　數量 5</p><div class="xchips" id="chipsA"><span class="xnone">尚未選擇項目細節</span><button class="xedit" type="button">編輯</button></div></div>
    <div class="x-case" id="caseB"><span class="xid">示範案件 B</span><h4>作物輸出物</h4><p>平面／印刷　·　數量 37</p><div class="xchips" id="chipsB"><span class="xnone">尚未選擇項目細節</span><button class="xedit" type="button">編輯</button></div></div>
  </div>
  <div id="modalWrap"><div class="ai-card"><h3>選擇項目細節</h3><p class="ai-sub" id="mSub"></p><div class="detail-pick" id="dmList"></div><p class="dq-hint" id="mHint"></p><div class="ai-actions"><button type="button" class="btn">取消</button><button type="button" class="btn primary" id="mOk">確認</button></div></div></div>
  <div id="score"></div>
  <div id="cap"><div class="step" id="capN">1</div><div><div class="txt" id="capT"></div><div class="sub" id="capS"></div></div></div>
  <svg id="cursor" viewBox="0 0 24 24"><path d="M3 2l7 19 3-8 8-3z" fill="#111" stroke="#fff" stroke-width="1.6" stroke-linejoin="round"/></svg>
  <div id="title"><div><h1>項目細節怎麼「分開填件數」</h1><p style="color:var(--brand-deep);font-weight:900">這個頁面沒有聲音，要聽旁白請按右上角「看有聲音的影片版」</p><p>一個案件裡有不同成品時，分數照各項件數計算</p><p>約 1 分鐘・請看畫面下方說明</p></div></div>
</div></div>

<script>
/* ===== 以下是 site.js 裡真正的件數下拉程式（build 時自動嵌入） ===== */
const esc=x=>String(x==null?'':x).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
${helper}
/* ===== 教學流程 ===== */
const $=id=>document.getElementById(id);
const stage=$('stage'),list=$('dmList');
const W={'平面':{'新製':{'廣告素材':1,'影音包框':2,'美術設計':1,'急件':3},'印刷':{'前置設計':1,'輸出完稿':1,'急件':3}}};
let cur=null;
function setCase(c){
  cur=c;
  const row={'數量':String(c.qty),'項目細節':c.preset.join(', '),'項目數量':c.saved||''};
  $('mSub').textContent=c.title;
  list.innerHTML=detailPickHtml(c.opts,new Set(c.preset),row,'dm-opt');
  $('mHint').textContent='案件共 '+c.qty+' 件。只勾一項＝全部；勾兩項以上時用下拉分配各項件數（加總自動維持 '+c.qty+' 件）；若每個項目都做了全部件數，請勾下方「每個項目都做了全部」。';
  c.row=row;dqInit(list,row);renderScore();
  $('caseA').classList.toggle('hi',c.key==='A');$('caseB').classList.toggle('hi',c.key==='B');
}
function renderScore(){
  if(!cur)return;
  const pk=readDetailPick(list,cur.row),names=pk.details?pk.details.split(', '):[],qty=pk.detailQty?JSON.parse(pk.detailQty):{};
  const w=W['平面'][cur.stage],items=names.filter(n=>n!=='急件');let sum=0,rows='';
  items.forEach(n=>{const q=qty[n]!==undefined?qty[n]:cur.qty,sc=(w[n]||0)*q;sum+=sc;rows+='<div class="row"><span>'+esc(n)+'</span><span>'+q+' 件 × '+(w[n]||0)+' 分 = '+sc+'</span></div>'});
  if(names.includes('急件')){sum*=3}
  const tbl=Object.entries(w).filter(([k])=>k!=='急件').map(([k,v])=>esc(k)+' '+v+' 分').join('　');
  $('score').innerHTML='<h5>這個案件的分數（即時計算）</h5><div class="wtable">權重：'+tbl+'</div>'+(rows||'<div class="row"><span>還沒有勾選項目</span><span>0</span></div>')+'<div class="row sum"><span>加權分數</span><span>'+Number(sum.toFixed(2))+'</span></div><div class="formula">分數 = Σ（各項件數 × 該項權重）'+(names.includes('急件')?' × 急件 3':'')+'</div>';
}
document.addEventListener('change',()=>setTimeout(renderScore,0));
function chipsFor(c){
  const pk=readDetailPick(list,c.row),qty=pk.detailQty?JSON.parse(pk.detailQty):{};
  return pk.details.split(', ').filter(Boolean).map(n=>'<span class="lt-detail">'+esc(qty[n]!==undefined?n+'×'+qty[n]:n)+'</span>').join('')+'<button class="xedit" type="button">編輯</button>';
}
const CASE_A={key:'A',stage:'新製',qty:5,title:'示範案件 A｜12月貼文＿第一篇（平面／新製）：可複選，確認後狀態改為「執行中」。',opts:['社群貼文','廣告素材','美術設計','影音包框','急件'],preset:[]};
const CASE_B={key:'B',stage:'印刷',qty:37,title:'示範案件 B｜作物輸出物（平面／印刷）：可複選，確認後狀態改為「執行中」。',opts:['前置設計','輸出完稿','急件'],preset:[]};
W['平面']['新製']['社群貼文']=1;

/* ---- 時間軸引擎（可手動步進，錄影用） ---- */
let clock=0,playing=true,events=[],segs=[],fired=0,pos={x:640,y:660};
const ease=t=>t<.5?2*t*t:1-Math.pow(-2*t+2,2)/2;
const ctr=el=>{const s=stage.getBoundingClientRect(),r=el.getBoundingClientRect(),k=s.width/1280;return {x:(r.left-s.left+r.width/2)/k,y:(r.top-s.top+r.height/2)/k}};
const SHIFTS=${JSON.stringify(voice.shifts)};
const SCALE=${voice.scale||1};
const M=t=>{const q=t*SCALE;return q+SHIFTS.reduce((n,x)=>q>=x.from?n+x.add:n,0)};
const at=(t,fn)=>events.push({t:M(t),fn});
const move=(t0,t1,get)=>segs.push({t0:M(t0),t1:M(t1),get,from:null,to:null});
const rips=[];
function ripple(p){const d=document.createElement('div');d.className='rip';d.style.left=p.x+'px';d.style.top=p.y+'px';stage.appendChild(d);rips.push({d,t:clock})}
function stepRips(){for(let i=rips.length-1;i>=0;i--){const r=rips[i],k=(clock-r.t)/450;if(k>=1){r.d.remove();rips.splice(i,1)}else{r.d.style.transform='scale('+(.4+1.6*k)+')';r.d.style.opacity=String(1-k)}}}
function caption(n,t,s){$('capN').textContent=n;$('capT').innerHTML=t;$('capS').innerHTML=s||''}
const opt=name=>[...list.querySelectorAll('.dq-opt')].find(l=>l.querySelector('input').value===name);
const clickEl=el=>{ripple(ctr(el))};
function toggleItem(name){const c=opt(name).querySelector('input[type=checkbox]');c.checked=!c.checked;c.dispatchEvent(new Event('change',{bubbles:true}))}
function toggleAll(){const c=list.querySelector('.dq-all');c.checked=!c.checked;c.dispatchEvent(new Event('change',{bubbles:true}))}
function openList(name){const sel=opt(name).querySelector('select'),p=ctr(sel),o=document.createElement('div');o.id='ddl';o.style.left=(p.x-34)+'px';o.style.top=(p.y+18)+'px';o.innerHTML=[...sel.options].map(x=>'<div data-v="'+x.value+'">'+x.value+'</div>').join('');stage.appendChild(o)}
function closeList(){const o=$('ddl');if(o)o.remove()}
function pickList(v){const o=$('ddl');if(o){const sel=[...list.querySelectorAll('select')].find(s=>!s.disabled&&o)}closeList()}
function setSel(name,v){const s=opt(name).querySelector('select');s.value=String(v);s.dispatchEvent(new Event('change',{bubbles:true}))}
const optEl=v=>$('ddl')&&$('ddl').querySelector('[data-v="'+v+'"]');
function hov(v){const o=$('ddl');if(!o)return;o.querySelectorAll('div').forEach(d=>d.classList.toggle('hov',d.dataset.v===String(v)))}
const cb=name=>opt(name).querySelector('input[type=checkbox]');
const selOf=name=>opt(name).querySelector('select');

let T=0;
// 0. 片頭
at(0,()=>{$('title').style.display='grid';caption(1,'','')});
at(3500,()=>{$('title').style.display='none';setCase(CASE_A);caption(1,'情境 A：一個案件裡有<b>不同成品</b>','這個案件共 <b>5 件</b>：4 張廣告素材＋1 支影音包框。設計師要點「編輯」項目細節（或把卡牌拖到「執行中」）。')});
move(4500,6000,()=>ctr($('caseA').querySelector('.xedit')));
at(6100,()=>clickEl($('caseA').querySelector('.xedit')));
// 勾廣告素材
move(7500,9000,()=>ctr(cb('廣告素材')));
at(9100,()=>{clickEl(cb('廣告素材'));toggleItem('廣告素材');caption(2,'只勾<b>一個</b>項目：件數＝全部 5 件','下拉選單鎖定、不用選。右邊的分數是 5 × 1 ＝ 5 分。')});
// 勾影音包框
move(12500,14000,()=>ctr(cb('影音包框')));
at(14100,()=>{clickEl(cb('影音包框'));toggleItem('影音包框');caption(3,'再勾<b>第二個</b>項目：系統先<b>平均分配</b>','出現「件數」下拉：目前 3＋2，<b>加總永遠＝案件總數 5 件</b>，不會多也不會少。')});
// 改廣告素材=4
move(19000,20500,()=>ctr(selOf('廣告素材')));
at(20600,()=>{clickEl(selOf('廣告素材'));openList('廣告素材')});
move(21400,22300,()=>optEl(4)?ctr(optEl(4)):pos);
at(21800,()=>hov(4));
at(22400,()=>{clickEl(optEl(4));closeList();setSel('廣告素材',4);caption(4,'把「廣告素材」改成 <b>4 件</b>','「影音包框」<b>自動變成 1 件</b>（加總還是 5）。分數 ＝ 4×1 ＋ 1×2 ＝ <b>6 分</b>。')});
// 示範選不到超過範圍
at(27500,()=>{caption(5,'下拉只能選合理範圍','總數 5、勾 2 項時，每項只能選 1～4，<b>不會選到 0 或超過總數</b>。勾 3 項時改任何一項，其他兩項會自動補齊。')});
move(29000,30500,()=>ctr(selOf('廣告素材')));
at(30600,()=>{clickEl(selOf('廣告素材'));openList('廣告素材')});
at(33500,()=>closeList());
// 確認
move(34000,35500,()=>ctr($('mOk')));
at(35600,()=>{clickEl($('mOk'));$('chipsA').innerHTML=chipsFor(CASE_A);caption(6,'按「確認」：卡牌上顯示 <b>廣告素材×4、影音包框×1</b>','之後看卡牌或列表，就知道各項各做幾件；分數 <b>6 分</b> 已存進系統。')});
// 情境 B
at(41500,()=>{setCase(CASE_B);caption(7,'情境 B：<b>同一批件數做了多道工序</b>','作物輸出物 <b>37 件</b>：每一件都做了「前置設計」和「輸出完稿」，不是把 37 件拆成兩半。')});
move(43000,44500,()=>ctr(cb('前置設計')));
at(44600,()=>{clickEl(cb('前置設計'));toggleItem('前置設計')});
move(45000,46300,()=>ctr(cb('輸出完稿')));
at(46400,()=>{clickEl(cb('輸出完稿'));toggleItem('輸出完稿');caption(8,'勾兩項後，系統先分配成 19＋18 → 只有 <b>37 分</b>','但實際每項都做了 37 件，這樣會<b>少算分數</b>，要改用下面的選項。')});
move(51500,53000,()=>ctr(list.querySelector('.dq-all')));
at(53100,()=>{clickEl(list.querySelector('.dq-all'));toggleAll();caption(9,'勾「<b>每個項目都做了全部 37 件</b>」','分數 ＝ 37×1 ＋ 37×1 ＝ <b>74 分</b>。舊案件打開時<b>預設就是勾選</b>，不會被改掉。')});
move(59500,61000,()=>ctr($('mOk')));
at(61100,()=>{clickEl($('mOk'));$('chipsB').innerHTML=chipsFor(CASE_B)});
// 結語
at(65000,()=>{caption('✓','記住三件事','① 只勾一項＝全部件數　② 不同成品混在一案＝用下拉分配（加總自動等於總數）　③ 同一批件數做多道工序＝勾「每個項目都做了全部」')});
const END=M(74000)+${voice.endExtra||0};

function run(){
  while(fired<events.length&&events[fired].t<=clock){events[fired].fn();fired++}
  // 游標
  const act=segs.filter(g=>clock>=g.t0).pop();
  if(act){
    if(!act.from)act.from={...pos};
    const to=act.get();
    const k=Math.min(1,Math.max(0,(clock-act.t0)/(act.t1-act.t0))),e=ease(k);
    pos={x:act.from.x+(to.x-act.from.x)*e,y:act.from.y+(to.y-act.from.y)*e};
  }
  stepRips();
  $('cursor').style.transform='translate('+(pos.x-4)+'px,'+(pos.y-3)+'px)';
}
window.__tick=ms=>{clock+=ms;run();return clock};
window.__reset=()=>{clock=0;fired=0;segs.forEach(g=>{g.from=null;g.to=null});pos={x:640,y:660};$('chipsA').innerHTML='<span class="xnone">尚未選擇項目細節</span><button class="xedit" type="button">編輯</button>';$('chipsB').innerHTML=$('chipsA').innerHTML;closeList();rips.splice(0).forEach(r=>r.d.remove());list.innerHTML='';cur=null;$('score').innerHTML='';run()};
window.__end=END;
function fit(){const k=Math.min(innerWidth/1280,innerHeight/720);stage.style.transform='scale('+k+')'}
addEventListener('resize',fit);fit();
const q=new URLSearchParams(location.search);
if(q.has('record'))document.body.classList.add('rec');
if(!q.has('manual')){
  let last=performance.now();
  (function loop(now){const d=now-last;last=now;if(playing&&clock<END)window.__tick(Math.min(d,100));requestAnimationFrame(loop)})(last);
}
$('bPlay').onclick=()=>{playing=!playing;$('bPlay').textContent=playing?'⏸ 暫停':'▶ 播放'};
$('bRe').onclick=()=>{window.__reset();playing=true;$('bPlay').textContent='⏸ 暫停'};
run();
</script>
</body>
</html>
`;
fs.mkdirSync(path.join(root, 'tutorial'), { recursive: true });
fs.writeFileSync(path.join(root, 'tutorial', 'item-qty.html'), html);
console.log('wrote tutorial/item-qty.html');

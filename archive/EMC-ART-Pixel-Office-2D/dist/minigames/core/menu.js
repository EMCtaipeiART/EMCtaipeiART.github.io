// 遊戲大廳選單：卡片式，每款遊戲有圖示、一句說明、最佳成績與標籤；上方可改暱稱（排行榜顯示用）。
import {pixelIcon} from './ui.js';

const esc=s=>String(s).replace(/[&<>"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]));
const TAGS={treasure:['排行榜'],hoops:['排行榜'],deadline:['排行榜'],hideseek:['單機'],'hideseek-online':['多人','2–6 人']};

/* 小遊戲全部對所有人開放（出氣擂台另外排在最前面） */
const ARENA={id:'vent-arena',title:'出氣擂台',blurb:'把煩惱打包丟進擂台，痛快出氣',icon:'star'};

export function createMenu({manager,store,board=null,getNick,setNick,onPick,isAdmin=()=>false,loggedIn=()=>false,doc=document}){
  const el=doc.createElement('div');el.className='mg-menu-modal';el.hidden=true;el.setAttribute('role','dialog');el.setAttribute('aria-label','小遊戲');
  doc.body.appendChild(el);
  let lastFocus=null,view='games',range='today',rank=null,rankBusy=false;
  const MEDAL=['①','②','③'];
  /* 遊戲排行榜：每款遊戲前三名的名字與分數（登入的人用帳號本人名字上榜） */
  function loadRank(){if(!board||rankBusy)return;rankBusy=true;rank=null;Promise.all([Promise.resolve(board.top3(range)),Promise.resolve(board.arenaTop3?board.arenaTop3(range):null).catch(()=>null)]).then(([r,a])=>{rank=r&&r.ok?{...r,arena:a&&a.ok?a.entries:null}:{error:true};},()=>{rank={error:true};}).finally(()=>{rankBusy=false;if(view==='rank'&&!el.hidden)render();});}
  function renderRank(){
    const titles=Object.fromEntries(manager.list().map(g=>[g.id,g.title]));
    const tabs='<div class="mg-rank-tabs"><button type="button" data-range="today" class="'+(range==='today'?'on':'')+'">今日</button><button type="button" data-range="week" class="'+(range==='week'?'on':'')+'">本週</button><button type="button" data-range="all" class="'+(range==='all'?'on':'')+'">歷史</button></div>';
    let body;
    if(rankBusy||!rank)body='<p class="mg-note">載入中…</p>';
    else if(rank.error)body='<p class="mg-note">暫時抓不到排行榜，請稍後再試。</p>';
    else body='<div class="mg-rank-list">'+(rank.arena?'<section class="mg-rank-card"><h3>'+esc(ARENA.title)+'</h3>'+(rank.arena.length?'<ol>'+rank.arena.map((e,i)=>'<li><span class="mg-rank-no">'+MEDAL[i]+'</span><span class="mg-rank-name">'+esc(e.name)+(e.account?'':'<i>未登入</i>')+'</span><b class="mg-rank-score">'+e.score+'</b></li>').join('')+'</ol>':'<p class="mg-rank-empty">還沒有人上榜</p>')+'</section>':'')+rank.games.map(g=>'<section class="mg-rank-card"><h3>'+esc(titles[g.game]||g.game)+'</h3>'
      +(g.entries.length?'<ol>'+g.entries.map((e,i)=>'<li><span class="mg-rank-no">'+MEDAL[i]+'</span><span class="mg-rank-name">'+esc(e.name)+(e.account?'':'<i>未登入</i>')+'</span><b class="mg-rank-score">'+e.score+'</b></li>').join('')+'</ol>':'<p class="mg-rank-empty">還沒有人上榜</p>')+'</section>').join('')+'</div>';
    return '<div class="mg-menu-card"><div class="mg-menu-head"><h2>遊戲排行榜</h2><button type="button" class="mg-btn mg-icon-btn" data-m="close" aria-label="關閉">'+pixelIcon('quit',16)+'<span>關閉</span></button></div>'
      +'<p class="mg-nick">每款遊戲前三名的名字與分數（今日、本週、歷史）；登入帳號玩的成績會用你的名字上榜。</p>'+tabs+body
      +'<div class="mg-rank-foot"><button type="button" class="mg-btn" data-m="games">← 回遊戲列表</button></div><p class="mg-note">僅供娛樂，不作為任何工作績效依據。</p></div>';
  }
  function render(){
    if(view==='rank'){el.innerHTML=renderRank();return;}
    renderGames();
  }
  function renderGames(){
    const games=[ARENA,...manager.list().filter(g=>g.id!=='demo')];
    el.innerHTML='<div class="mg-menu-card"><div class="mg-menu-head"><h2>小遊戲</h2><div class="mg-head-btns">'+(board?'<button type="button" class="mg-btn" data-m="rank">🏆 排行榜</button>':'')+'<button type="button" class="mg-btn mg-icon-btn" data-m="close" aria-label="關閉">'+pixelIcon('quit',16)+'<span>關閉</span></button></div></div>'
      +(loggedIn()?'<p class="mg-nick">玩家：'+esc(getNick())+'（已登入，排行榜顯示你的名字）</p>':'<label class="mg-nick">暱稱（排行榜顯示，最多 12 字，匿名）<input maxlength="12" placeholder="玩家" value="'+esc(getNick())+'"></label>')
      +'<div class="mg-cards">'+games.map(g=>{
        const best=g.id==='vent-arena'?0:store.get(g.id).best;
        return '<button type="button" class="mg-card" data-game="'+g.id+'"><span class="mg-card-icon">'+pixelIcon(g.icon||'star',28)+'</span>'
          +'<span class="mg-card-body"><b>'+esc(g.title)+'</b><span class="mg-card-blurb">'+esc(g.blurb||'')+'</span>'
          +'<span class="mg-card-meta">'+(TAGS[g.id]||[]).map(t=>'<i>'+esc(t)+'</i>').join('')+(best?'<em>最佳 '+best+'</em>':'')+'</span></span></button>';
      }).join('')+'</div>'
      +'<p class="mg-note">僅供娛樂，不作為任何工作績效依據。</p></div>';
  }
  function open(){lastFocus=doc.activeElement;view='games';render();el.hidden=false;const c=el.querySelector('.mg-card');if(c)c.focus();}
  function close(){el.hidden=true;if(lastFocus&&lastFocus.focus)try{lastFocus.focus();}catch{/* 元素已移除 */}}
  el.addEventListener('click',e=>{
    if(e.target===el||e.target.closest('[data-m=close]'))return close();
    if(e.target.closest('[data-m=rank]')){view='rank';render();loadRank();return;}
    if(e.target.closest('[data-m=games]')){view='games';render();return;}
    const rg=e.target.closest('[data-range]');if(rg){range=rg.dataset.range;render();loadRank();return;}
    const card=e.target.closest('[data-game]');
    if(card){close();onPick(card.dataset.game);}
  });
  el.addEventListener('change',e=>{if(e.target.matches('.mg-nick input'))setNick(e.target.value.trim().slice(0,12));});
  doc.addEventListener('keydown',e=>{if(e.key==='Escape'&&!el.hidden){e.stopPropagation();close();}},true);
  return {open,close,toggle(){if(el.hidden)open();else close();},get isOpen(){return !el.hidden;},el};
}

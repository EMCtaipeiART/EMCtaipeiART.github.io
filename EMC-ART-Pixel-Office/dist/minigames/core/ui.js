// 小遊戲外框：畫布、HUD、倒數、暫停、結算。樣式在 minigames.css，沿用像素辦公室的配色。
const esc=s=>String(s).replace(/[&<>"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]));
export function createUI(doc=document){
  const root=doc.createElement('div');root.className='mg-root';root.hidden=true;
  root.innerHTML='<canvas class="mg-canvas"></canvas>'
    +'<div class="mg-hud"><span class="mg-title"></span><span class="mg-time">0</span><span class="mg-score">0</span><span class="mg-extra"></span>'
    +'<button type="button" class="mg-btn" data-act="pause">暫停</button><button type="button" class="mg-btn" data-act="quit">離開</button></div>'
    +'<div class="mg-banner" hidden></div><div class="mg-panel" hidden></div>';
  const q=s=>root.querySelector(s),canvas=q('.mg-canvas'),banner=q('.mg-banner'),panel=q('.mg-panel');
  return {
    root,canvas,
    mount(parent=doc.body){parent.appendChild(root);},
    unmount(){root.remove();},
    show(title){q('.mg-title').textContent=title;root.hidden=false;panel.hidden=true;banner.hidden=true;},
    hide(){root.hidden=true;},
    setTime(sec){q('.mg-time').textContent=Math.ceil(Math.max(sec,0))+' 秒';},
    setScore(n){q('.mg-score').textContent=n+' 分';},
    setExtra(t){q('.mg-extra').textContent=t||'';},
    setPauseLabel(paused){q('.mg-hud [data-act=pause]').textContent=paused?'繼續':'暫停';},
    banner(text){banner.textContent=text||'';banner.hidden=!text;},
    pausePanel(){panel.innerHTML='<h2>已暫停</h2><button type="button" class="mg-btn" data-act="pause">繼續</button><button type="button" class="mg-btn" data-act="quit">離開</button>';panel.hidden=false;},
    closePanel(){panel.hidden=true;},
    setPauseVisible(v){q('.mg-hud [data-act=pause]').hidden=!v;},
    results({title,score,lines=[],record,board=[],again=true,remote=null}){
      const rows=remote?remote.board.map(r=>'<li'+(r.name===remote.me?' class="me"':'')+'><b>'+r.rank+'</b><span>'+esc(r.name)+'</span><em>'+r.score+'</em></li>').join(''):board.map((r,i)=>'<li'+(record&&record.rank===i+1?' class="me"':'')+'><b>'+(i+1)+'</b><span>'+esc(r.day)+'</span><em>'+r.score+'</em></li>').join('');
      panel.innerHTML='<h2>'+esc(title)+'・結算</h2><p class="mg-big">'+score+' 分'+(record&&record.isBest?' <small>新紀錄！</small>':'')+'</p>'
        +lines.map(l=>'<p>'+esc(l)+'</p>').join('')+(remote?'<p><b>今日第 '+remote.rank+' 名</b>・'+(remote.level==='full'?'成績已由伺服器驗證':'簡易驗證')+'</p><h3 class="mg-sub">今日排行（'+esc(remote.day)+'）</h3>':'')+(rows?'<ol class="mg-board">'+rows+'</ol>':'')
        +'<p class="mg-note">僅供娛樂，不作為任何工作績效依據。</p>'+(again?'<button type="button" class="mg-btn" data-act="again">再玩一次</button>':'')+'<button type="button" class="mg-btn" data-act="quit">回辦公室</button>';
      panel.hidden=false;
    },
    onAction(fn,signal){root.addEventListener('click',e=>{const b=e.target.closest('[data-act]');if(b)fn(b.dataset.act);},{signal});}
  };
}

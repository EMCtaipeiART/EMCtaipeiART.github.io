// 小遊戲外框：畫布、HUD、倒數、怎麼玩、暫停、結算。樣式在 minigames.css，沿用像素辦公室的配色。
// 圖示是 8×8 的像素點陣（SVG，crispEdges），之後可以換成 Codex 畫的素材（見 minigames.css 的 .mg-art-ui）。
const esc=s=>String(s).replace(/[&<>"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]));

const ICON_ROWS={
  pause:['........','.##..##.','.##..##.','.##..##.','.##..##.','.##..##.','.##..##.','........'],
  play:['........','.##.....','.####...','.######.','.######.','.####...','.##.....','........'],
  quit:['........','.#####..','.#...#..','.#.###..','.#...#..','.#.###..','.#...#..','.#####..'],
  clock:['..####..','.#....#.','#..#...#','#..#...#','#..###.#','#......#','.#....#.','..####..'],
  star:['...##...','...##...','########','.######.','..####..','.##..##.','.#....#.','........'],
  help:['..####..','.##..##.','....##..','...##...','...##...','........','...##...','...##...'],
  map:['........','.#.##.#.','##.##.##','#.#..#.#','#.#..#.#','##.##.##','.#.##.#.','........'],
  ball:['..####..','.#.##.#.','#..##..#','########','#..##..#','#.#..#.#','.#.##.#.','..####..'],
  eye:['........','..####..','.#.##.#.','#..##..#','#..##..#','.#.##.#.','..####..','........'],
  ghost:['..####..','.######.','##.##.##','########','########','########','#.#..#.#','........'],
  user:['..####..','..####..','..####..','...##...','.######.','########','########','........']
};
export function pixelIcon(name,size=16){
  const rows=ICON_ROWS[name]||ICON_ROWS.star;let r='';
  rows.forEach((row,y)=>{for(let x=0;x<row.length;x++)if(row[x]==='#')r+='<rect x="'+x+'" y="'+y+'" width="1" height="1"/>';});
  return '<svg class="mg-icon" viewBox="0 0 8 8" width="'+size+'" height="'+size+'" shape-rendering="crispEdges" fill="currentColor" aria-hidden="true">'+r+'</svg>';
}

export function createUI(doc=document){
  const root=doc.createElement('div');root.className='mg-root';root.hidden=true;
  root.innerHTML='<canvas class="mg-canvas"></canvas>'
    +'<div class="mg-hud"><span class="mg-title"></span><span class="mg-chip mg-timechip">'+pixelIcon('clock',14)+'<b class="mg-time">0</b></span><span class="mg-chip mg-scorechip">'+pixelIcon('star',14)+'<b class="mg-score">0</b></span><span class="mg-chip mg-extra"></span>'
    +'<button type="button" class="mg-btn mg-icon-btn" data-act="pause" aria-label="暫停">'+pixelIcon('pause',16)+'<span>暫停</span></button><button type="button" class="mg-btn mg-icon-btn" data-act="quit" aria-label="離開">'+pixelIcon('quit',16)+'<span>離開</span></button></div>'
    +'<div class="mg-banner" hidden></div><div class="mg-panel" hidden></div>';
  const q=s=>root.querySelector(s),canvas=q('.mg-canvas'),banner=q('.mg-banner'),panel=q('.mg-panel');
  const setPanel=(cls,html)=>{panel.className='mg-panel '+cls;panel.innerHTML=html;panel.hidden=false;};
  let countTimer=0;
  return {
    root,canvas,
    mount(parent=doc.body){parent.appendChild(root);},
    unmount(){clearInterval(countTimer);root.remove();},
    show(title){q('.mg-title').textContent=title;root.hidden=false;panel.hidden=true;banner.hidden=true;},
    hide(){clearInterval(countTimer);root.hidden=true;},
    setTime(sec){q('.mg-time').textContent=Math.ceil(Math.max(sec,0))+' 秒';},
    setScore(n){q('.mg-score').textContent=n+' 分';},
    setExtra(t){q('.mg-extra').textContent=t||'';},
    setPauseLabel(paused){const b=q('.mg-hud [data-act=pause]');b.innerHTML=pixelIcon(paused?'play':'pause',16)+'<span>'+(paused?'繼續':'暫停')+'</span>';},
    banner(text){banner.textContent=text||'';banner.hidden=!text;if(text){banner.classList.remove('pop');void banner.offsetWidth;banner.classList.add('pop');}},
    pausePanel({howto=false}={}){setPanel('mg-pause','<h2>已暫停</h2><button type="button" class="mg-btn mg-primary" data-act="pause">繼續</button>'+(howto?'<button type="button" class="mg-btn" data-act="howto">怎麼玩</button>':'')+'<button type="button" class="mg-btn mg-danger" data-act="quit">離開</button>');},
    closePanel(){panel.hidden=true;},
    setPauseVisible(v){q('.mg-hud [data-act=pause]').hidden=!v;},
    /** 開局前的說明卡：目標、電腦與手機的操作、小提醒；勾選「下次不再顯示」。 */
    howto({title,goal,pc,touch,tips=[],canSkip=true,startLabel='開始',resume=false}){
      setPanel('mg-howto','<h2>'+esc(title)+'</h2><p class="mg-goal">'+esc(goal)+'</p>'
        +'<dl class="mg-keys"><dt>電腦</dt><dd>'+esc(pc)+'</dd><dt>手機</dt><dd>'+esc(touch)+'</dd></dl>'
        +(tips.length?'<ul class="mg-tips">'+tips.map(t=>'<li>'+esc(t)+'</li>').join('')+'</ul>':'')
        +(canSkip&&!resume?'<label class="mg-skip"><input type="checkbox" data-skip> 下次不再顯示</label>':'')
        +'<button type="button" class="mg-btn mg-primary" data-act="go">'+(resume?'回到遊戲':esc(startLabel))+'</button>');
    },
    skipChecked(){const c=panel.querySelector('[data-skip]');return !!(c&&c.checked);},
    /**
     * 結算：獎牌（依分數門檻）、分數滾動、新紀錄、名次與榜單。
     * medal：'gold'|'silver'|'bronze'|null；remote＝伺服器驗證後的名次與榜單。
     */
    results({title,score,lines=[],record,board=[],again=true,remote=null,medal=null,medalNext=null}){
      const rows=remote?remote.board.map(r=>'<li'+(r.name===remote.me?' class="me"':'')+'><b>'+r.rank+'</b><span>'+esc(r.name)+'</span><em>'+r.score+'</em></li>').join(''):board.map((r,i)=>'<li'+(record&&record.rank===i+1?' class="me"':'')+'><b>'+(i+1)+'</b><span>'+esc(r.day)+'</span><em>'+r.score+'</em></li>').join('');
      const medalName={gold:'金牌',silver:'銀牌',bronze:'銅牌'}[medal];
      setPanel('mg-results','<h2>'+esc(title)+'・結算</h2>'
        +'<div class="mg-medalrow">'+(medal?'<div class="mg-medal mg-medal-'+medal+'" title="'+medalName+'"><span>'+medalName+'</span></div>':'<div class="mg-medal mg-medal-none"><span>加油</span></div>')
        +'<div><p class="mg-big"><span class="mg-count" data-to="'+score+'">0</span> 分</p>'+(record&&record.isBest?'<p class="mg-new">新紀錄！</p>':'')+(medalNext?'<p class="mg-next">再 '+medalNext+' 分升級獎牌</p>':'')+'</div></div>'
        +lines.map(l=>'<p>'+esc(l)+'</p>').join('')
        +(remote?'<p class="mg-rank"><b>今日第 '+remote.rank+' 名</b>・'+(remote.level==='full'?'成績已由伺服器驗證':'簡易驗證')+'</p><h3 class="mg-sub">今日排行（'+esc(remote.day)+'）</h3>':'')+(rows?'<ol class="mg-board">'+rows+'</ol>':'')
        +'<p class="mg-note">僅供娛樂，不作為任何工作績效依據。</p>'
        +(again?'<button type="button" class="mg-btn mg-primary" data-act="again">再玩一次</button>':'')+'<button type="button" class="mg-btn" data-act="quit">回辦公室</button>');
      // 分數滾動（減少動態偏好時直接顯示）
      const el=panel.querySelector('.mg-count'),to=Number(score)||0;
      clearInterval(countTimer);
      const reduce=typeof matchMedia==='function'&&matchMedia('(prefers-reduced-motion: reduce)').matches;
      if(!el)return;
      if(reduce||to<=0){el.textContent=String(to);return;}
      let n=0;const step=Math.max(1,Math.round(to/30));
      countTimer=setInterval(()=>{n=Math.min(to,n+step);el.textContent=String(n);if(n>=to)clearInterval(countTimer);},25);
    },
    onAction(fn,signal){root.addEventListener('click',e=>{const b=e.target.closest('[data-act]');if(b)fn(b.dataset.act);},{signal});}
  };
}

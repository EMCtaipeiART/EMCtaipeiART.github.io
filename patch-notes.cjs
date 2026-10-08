const fs=require('fs');const raw=fs.readFileSync('index.html','utf8');const crlf=raw.includes('\r\n');let s=raw.replace(/\r\n/g,'\n');
const rep=(a,b)=>{if(!s.includes(a))throw new Error('nf: '+a.slice(0,70));s=s.replace(a,()=>b)};

// rail button (after 作品牆)
rep("      {k:'owner',label:'進度',",
"      {k:'notes',label:'記事本',title:'記事本（設計部資源）',ok:()=>loggedIn()&&(hasDesignerRole()||isAdminAcct()||isMachiUser()),svg:'<path d=\"M6 3.5h11a1.5 1.5 0 0 1 1.5 1.5v14A1.5 1.5 0 0 1 17 20.5H6zM6 3.5v17M9.5 8h5.5M9.5 12h5.5M9.5 16h3.5\"/>'},\n      {k:'owner',label:'進度',");
rep("(x.k==='wall'&&state.view==='wall')?' is-active'","(x.k==='wall'&&state.view==='wall')||(x.k==='notes'&&state.view==='notes')?' is-active'");
rep("      if(k==='wall'){","      if(k==='notes'){state.form=null;state.mail=null;state.editing=false;closeCal();show('notes');return}\n      if(k==='wall'){");
rep("||view==='issues'||view==='wall'||(view==='detail'&&state.home==='projects')","||view==='issues'||view==='wall'||view==='notes'||(view==='detail'&&state.home==='projects')");
rep("$('stage').classList.toggle('wide',view==='projects'||view==='wall');","$('stage').classList.toggle('wide',view==='projects'||view==='wall'||view==='notes');");
rep("else if(view==='wall')renderWallPage();","else if(view==='wall')renderWallPage();else if(view==='notes')renderNotesPage();");
rep("||view==='issues'||view==='wall')window.scrollTo({top:0,behavior:'smooth'})","||view==='issues'||view==='wall'||view==='notes')window.scrollTo({top:0,behavior:'smooth'})");

const code=`    /* ---------- 記事本：設計部資源（Google 試算表）。Worker 檢查登入與權限後才回傳；密碼欄預設遮住，按眼睛才顯示，按複製可直接複製 ---------- */
    const NOTE_LABELS=new Set(['密碼']);
    function noteCellHtml(v,masked){
      const t=String(v||'');if(!t.trim())return '';
      if(masked)return '<span class="nt-secret" data-secret="'+esc(t)+'"><span class="nt-dots">••••••••</span><button type="button" class="nt-eye" data-nt-eye title="顯示／隱藏" aria-label="顯示或隱藏密碼">👁</button><button type="button" class="nt-copy" data-nt-copy title="複製" aria-label="複製">複製</button></span>';
      return esc(t).replace(/(https?:\\/\\/[^\\s<]+)/g,u=>'<a href="'+u+'" target="_blank" rel="noopener noreferrer">'+u+'</a>').replace(/\\n/g,'<br>');
    }
    function noteTableHtml(rows){
      const maskedAt=(row,c)=>{ /* 同一列中「密碼」標籤右邊、到下一個空白格之前的格子都遮住 */
        for(let i=c-1;i>=0;i--){if(!String(row[i]||'').trim())return false;if(NOTE_LABELS.has(String(row[i]).trim()))return true}return false};
      const body=rows.map(row=>{
        const filled=row.filter(c=>String(c||'').trim());
        if(filled.length===1&&String(row[0]||'').trim()&&row.length>1)return '<tr class="nt-head"><td colspan="'+row.length+'">'+noteCellHtml(row[0],false)+'</td></tr>';
        return '<tr>'+row.map((c,i)=>{const lab=NOTE_LABELS.has(String(c||'').trim())||/^(網址|種類|帳號|購買方式|備註|所屬公司|使用信箱|項目|信箱|手機|姓名|預約方式|預約格式|會員|消費紀錄)$/.test(String(c||'').trim());return '<td class="'+(lab?'nt-lab':'')+'">'+noteCellHtml(c,!lab&&maskedAt(row,i))+'</td>'}).join('')+'</tr>';
      }).join('');
      return '<div class="table-wrap"><table class="nt-table"><tbody>'+body+'</tbody></table></div>';
    }
    async function renderNotesPage(refresh){
      const stage=$('stage');
      if(!loggedIn()){stage.innerHTML='<div class="page"><h2 class="page-title">記事本</h2><p class="page-sub">請先登入後再查看。</p></div>';return}
      if(!state.notes||refresh){
        stage.innerHTML='<div class="page notes-page"><div class="page-top"><div><h2 class="page-title">記事本</h2><p class="page-sub">正在讀取設計部資源…</p></div></div></div>';
        try{const data=await api('getNotebook',{refresh:Boolean(refresh)});state.notes={tabs:data.tabs||[],at:data.fetchedAt||Date.now(),tab:0}}
        catch(err){if(state.view==='notes')stage.innerHTML='<div class="page notes-page"><div class="page-top"><div><h2 class="page-title">記事本</h2></div></div><div class="notice error" role="alert">'+esc(/權限/.test(err.message||'')?'此帳號沒有查看記事本的權限（限設計部與管理者）。':'讀取失敗：'+(err.message||err))+'</div><div class="form-actions"><button type="button" class="btn" data-notes-reload>重新讀取</button></div></div>';return}
      }
      if(state.view!=='notes')return;
      const n=state.notes,t=n.tabs[n.tab]||n.tabs[0];if(!t){stage.innerHTML='<div class="page"><h2 class="page-title">記事本</h2><p class="page-sub">沒有資料。</p></div>';return}
      stage.innerHTML='<div class="page notes-page"><div class="page-top"><div><h2 class="page-title">記事本</h2><p class="page-sub">設計部資源：AI 工具、素材與廠商資訊。密碼預設遮住，按眼睛顯示。</p></div><div class="wall-tools"><a class="btn" href="'+esc(t.url)+'" target="_blank" rel="noopener noreferrer">開啟原試算表</a><button type="button" class="btn" data-notes-reload>重新讀取</button></div></div>'
        +'<div class="nt-tabs" role="tablist">'+n.tabs.map((x,i)=>'<button type="button" role="tab" class="nt-tab'+(i===n.tab?' on':'')+'" data-nt-tab="'+i+'">'+esc(x.name)+'</button>').join('')+'</div>'+noteTableHtml(t.rows)+'</div>';
    }
    document.addEventListener('click',e=>{
      const t=e.target;if(!t.closest)return;
      const tab=t.closest('[data-nt-tab]');if(tab&&state.notes){state.notes.tab=+tab.dataset.ntTab;renderNotesPage();return}
      if(t.closest('[data-notes-reload]')){renderNotesPage(true);return}
      const eye=t.closest('[data-nt-eye]');if(eye){const w=eye.closest('.nt-secret'),d=w.querySelector('.nt-dots'),on=w.classList.toggle('is-open');d.textContent=on?w.dataset.secret:'••••••••';return}
      const cp=t.closest('[data-nt-copy]');if(cp){const v=cp.closest('.nt-secret').dataset.secret;(navigator.clipboard?navigator.clipboard.writeText(v):Promise.reject()).then(()=>toast('已複製')).catch(()=>toast('無法複製，請按眼睛顯示後手動複製',true));return}
    });
`;
rep("    function openExt(k){",code+"    function openExt(k){");

rep("    .wall-page{max-width:1280px;",`    .notes-page{max-width:1280px;margin:0 auto}.nt-tabs{display:flex;gap:8px;flex-wrap:wrap;margin:0 0 14px}.nt-tab{border:1px solid var(--line);background:var(--panel);color:var(--ink);border-radius:999px;padding:7px 16px;font-size:14px;font-weight:800;cursor:pointer}.nt-tab.on{background:var(--brand);border-color:var(--brand);color:#fff}
    .nt-table{border-collapse:collapse;min-width:100%;font-size:13.5px}.nt-table td{border:1px solid var(--line);padding:7px 10px;vertical-align:top;min-width:110px;max-width:340px;word-break:break-word}.nt-table td.nt-lab{background:var(--bg);color:var(--muted);font-weight:800;white-space:nowrap;min-width:0}.nt-table tr.nt-head td{background:var(--brand-soft,#e6f4ea);font-weight:900;font-size:14.5px;border-color:var(--line)}
    .nt-secret{display:inline-flex;align-items:center;gap:6px;flex-wrap:wrap}.nt-dots{letter-spacing:1px;font-family:ui-monospace,Menlo,Consolas,monospace}.nt-eye,.nt-copy{border:1px solid var(--line);background:var(--panel);color:var(--ink);border-radius:8px;padding:1px 8px;font-size:12px;cursor:pointer}
    .wall-page{max-width:1280px;`);
fs.writeFileSync('index.html',crlf?s.replace(/\n/g,'\r\n'):s);
const sc=[...s.matchAll(/<script(?![^>]*src)[^>]*>([\s\S]*?)<\/script>/g)].map(m=>m[1]).sort((a,b)=>b.length-a.length)[0];fs.writeFileSync('chk.tmp.js',sc);
console.log('ok');

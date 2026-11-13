// 截稿倒數 2：設計挑戰類型與每日題組生成（不碰 DOM；前端與 Worker 驗證共用這一份，改動會讓同日題組改變）。
// 由 2D 版 deadline-challenges.js 擴充：新增 色號配對／字距找碴／對比檢查 三種題型，並依關卡逐步解鎖題型。
//
// 擴充方式：新增一種挑戰＝寫一個符合下列介面的物件，加進 TYPES 即可，遊戲本體不用改。
//   { id, title,
//     prompt(puzzle) -> 題目文字
//     generate(rng, level) -> puzzle（只能用傳入的 rng，這樣同一天題組才會一樣）
//     regions(puzzle, box) -> [{id,x,y,w,h}] 可點擊區域（同時用來畫與命中判定）
//     draw(g, puzzle, box)
//     isCorrect(puzzle, regionId) -> boolean }
// 難度：LEVEL_STEP 題升一級，最高 MAX_LEVEL；各類型自行用 level 決定差異大小與數量。

export const LEVEL_STEP=5,MAX_LEVEL=6;
export const levelFor=index=>Math.min(MAX_LEVEL,1+Math.floor(index/LEVEL_STEP));
const NAVY='#182e54';

function frame(g,x,y,w,h,fill,width=3){g.fillStyle=fill;g.fillRect(Math.round(x),Math.round(y),Math.round(w),Math.round(h));g.strokeStyle=NAVY;g.lineWidth=width;g.strokeRect(Math.round(x)+width/2,Math.round(y)+width/2,Math.round(w)-width,Math.round(h)-width);}
function grid(count,cols,area,gap=10){// 把 count 個格子平均排進 area
  const rows=Math.ceil(count/cols),cw=(area.w-gap*(cols-1))/cols,ch=(area.h-gap*(rows-1))/rows,side=Math.min(cw,ch),
    x0=area.x+(area.w-(side*cols+gap*(cols-1)))/2,y0=area.y+(area.h-(side*rows+gap*(rows-1)))/2;
  return Array.from({length:count},(_,i)=>({id:i,x:x0+(i%cols)*(side+gap),y:y0+Math.floor(i/cols)*(side+gap),w:side,h:side}));
}

// ───────── 1. 色彩辨識：找出顏色不一樣的色塊 ─────────
export const colorType={
  id:'color',title:'色彩辨識',
  prompt:()=>'找出顏色不一樣的色塊',
  generate(rng,level){
    const n=[3,3,4,4,5,6][level-1],delta=[16,11,8,6,4.5,3.2][level-1];
    return {n,h:rng.int(0,359),s:rng.int(50,75),l:rng.int(42,58),odd:rng.int(0,n*n-1),delta:delta*(rng.next()<.5?-1:1)};
  },
  regions(p,box){
    const side=Math.min(box.w,box.h),cell=side/p.n,x0=box.x+(box.w-side)/2,y0=box.y+(box.h-side)/2;
    return Array.from({length:p.n*p.n},(_,i)=>({id:i,x:x0+(i%p.n)*cell,y:y0+Math.floor(i/p.n)*cell,w:cell,h:cell}));
  },
  draw(g,p,box){for(const r of this.regions(p,box)){g.fillStyle='hsl('+p.h+','+p.s+'%,'+(p.l+(r.id===p.odd?p.delta:0))+'%)';g.fillRect(Math.round(r.x)+2,Math.round(r.y)+2,Math.round(r.w)-4,Math.round(r.h)-4);}},
  isCorrect:(p,id)=>id===p.odd
};

// ───────── 2. 圖形配對：找出和上方完全相同的圖形 ─────────
const shapeKey=cells=>cells.map(c=>c[0]+','+c[1]).sort().join(';');
const mirror=cells=>cells.map(([x,y])=>[3-x,y]);
const rot90=cells=>cells.map(([x,y])=>[3-y,x]);
const rot180=cells=>cells.map(([x,y])=>[3-x,3-y]);
function growShape(rng,count){
  const cells=[[rng.int(0,3),rng.int(0,3)]];
  while(cells.length<count){
    const [x,y]=rng.pick(cells),[dx,dy]=rng.pick([[1,0],[-1,0],[0,1],[0,-1]]),nx=x+dx,ny=y+dy;
    if(nx<0||ny<0||nx>3||ny>3||cells.some(c=>c[0]===nx&&c[1]===ny))continue;
    cells.push([nx,ny]);
  }
  return cells;
}
function moveOne(rng,cells){
  const i=rng.int(0,cells.length-1),rest=cells.filter((_,j)=>j!==i),free=[];
  for(let x=0;x<4;x++)for(let y=0;y<4;y++){
    if(cells.some(c=>c[0]===x&&c[1]===y))continue;
    if(rest.some(c=>Math.abs(c[0]-x)+Math.abs(c[1]-y)===1))free.push([x,y]);
  }
  return free.length?rest.concat([rng.pick(free)]):cells;
}
export const shapeType={
  id:'shape',title:'圖形配對',
  prompt:()=>'找出和上方完全相同的圖形',
  generate(rng,level){
    const count=[4,5,5,6,6,7][level-1],target=growShape(rng,count),seen=new Set([shapeKey(target)]),out=[];
    const easy=[c=>mirror(c),c=>rot90(c),c=>rot180(c),c=>moveOne(rng,c)],hard=[c=>moveOne(rng,c),c=>moveOne(rng,c),c=>mirror(c)];
    const pool=level<=2?easy:hard;
    for(let tries=0;out.length<3&&tries<200;tries++){
      const v=rng.pick(pool)(target),k=shapeKey(v);
      if(!seen.has(k)){seen.add(k);out.push(v);}
    }
    while(out.length<3){const v=moveOne(rng,rng.pick(out.concat([target]))),k=shapeKey(v);if(!seen.has(k)){seen.add(k);out.push(v);}}
    const correct=rng.int(0,3),options=out.slice();options.splice(correct,0,target);
    return {target,options,correct,hue:rng.int(0,359)};
  },
  layout(box){
    const top=Math.min(box.h*.4,box.w*.5),opts=grid(4,4,{x:box.x,y:box.y+top+14,w:box.w,h:box.h-top-14},12);
    return {target:{x:box.x+(box.w-top)/2,y:box.y,w:top,h:top},regions:opts};
  },
  regions(p,box){return this.layout(box).regions;},
  drawShape(g,cells,r,hue){
    frame(g,r.x,r.y,r.w,r.h,'#fff',3);
    const c=(r.w-6)/4;g.fillStyle='hsl('+hue+',60%,52%)';
    for(const [x,y] of cells)g.fillRect(Math.round(r.x+3+x*c)+1,Math.round(r.y+3+y*c)+1,Math.ceil(c)-2,Math.ceil(c)-2);
  },
  draw(g,p,box){
    const l=this.layout(box);this.drawShape(g,p.target,l.target,p.hue);
    l.regions.forEach((r,i)=>this.drawShape(g,p.options[i],r,p.hue));
  },
  isCorrect:(p,id)=>id===p.correct
};

// ───────── 3. 排版對齊：找出沒有對齊的版面元素 ─────────
export const alignType={
  id:'align',title:'排版對齊',
  prompt:p=>p.axis==='y'?'找出上下沒有對齊的卡片':'找出左右沒有對齊的項目',
  generate(rng,level){
    const n=[4,5,5,6,7,8][level-1],delta=[22,16,12,9,6,4][level-1];
    return {n,odd:rng.int(0,n-1),delta:delta*(rng.next()<.5?-1:1),axis:level>=4&&rng.next()<.5?'x':'y',tint:rng.int(0,3)};
  },
  regions(p,box){
    const gap=12;
    if(p.axis==='y'){
      const cw=Math.min((box.w-(p.n-1)*gap)/p.n,box.h*.45),ch=cw*1.15,x0=box.x+(box.w-(p.n*cw+(p.n-1)*gap))/2,y0=box.y+(box.h-ch)/2,u=cw/60;
      return Array.from({length:p.n},(_,i)=>({id:i,x:x0+i*(cw+gap),y:y0+(i===p.odd?Math.max(2,Math.abs(p.delta)*u)*Math.sign(p.delta):0),w:cw,h:ch}));
    }
    const ch=Math.min((box.h-(p.n-1)*8)/p.n,56),cw=Math.min(box.w*.6,ch*5),x0=box.x+(box.w-cw)/2,y0=box.y+(box.h-(p.n*ch+(p.n-1)*8))/2,u=ch/20;
    return Array.from({length:p.n},(_,i)=>({id:i,x:x0+(i===p.odd?Math.max(2,Math.abs(p.delta)*u)*Math.sign(p.delta):0),y:y0+i*(ch+8),w:cw,h:ch}));
  },
  draw(g,p,box){
    const tints=['#ffd24a','#5b8def','#4caf6a','#f4a6c0'];
    for(const r of this.regions(p,box)){
      frame(g,r.x,r.y,r.w,r.h,'#fff',3);
      if(p.axis==='y'){g.fillStyle=tints[p.tint];g.fillRect(Math.round(r.x)+6,Math.round(r.y)+6,Math.round(r.w)-12,Math.round(r.h*.4));g.fillStyle='#c9d2e0';g.fillRect(Math.round(r.x)+6,Math.round(r.y+r.h*.55),Math.round(r.w)-12,5);g.fillRect(Math.round(r.x)+6,Math.round(r.y+r.h*.7),Math.round(r.w*.6),5);}
      else{g.fillStyle=tints[p.tint];g.fillRect(Math.round(r.x)+5,Math.round(r.y)+5,Math.round(r.h)-10,Math.round(r.h)-10);g.fillStyle='#c9d2e0';g.fillRect(Math.round(r.x+r.h)+4,Math.round(r.y+r.h*.3),Math.round(r.w-r.h-14),5);}
    }
  },
  isCorrect:(p,id)=>id===p.odd
};

// ───────── 4. 客戶改稿：照客戶要求改，沒要求的地方不准動 ─────────
export const SHAPES=['圓形','方形','三角形'],COLORS=[{n:'紅',c:'#d9534f'},{n:'藍',c:'#3b6fd8'},{n:'綠',c:'#4caf6a'},{n:'黃',c:'#f0b429'}],SIZES=['放大','縮小'];
const ATTRS=['shape','color','size'],RANGE={shape:3,color:4,size:2};
const attrKey=a=>a.shape+'|'+a.color+'|'+a.size;
function drawPoster(g,r,a){
  frame(g,r.x,r.y,r.w,r.h,'#fff',3);
  g.fillStyle=NAVY;g.fillRect(Math.round(r.x+r.w*.1),Math.round(r.y+r.h*.08),Math.round(r.w*.5),Math.max(3,Math.round(r.h*.05)));
  g.fillStyle='#c9d2e0';g.fillRect(Math.round(r.x+r.w*.1),Math.round(r.y+r.h*.17),Math.round(r.w*.7),Math.max(2,Math.round(r.h*.03)));
  const cx=r.x+r.w/2,cy=r.y+r.h*.58,m=Math.min(r.w,r.h)*(a.size===0?.5:.28),col=COLORS[a.color].c;
  g.fillStyle=col;g.strokeStyle=NAVY;g.lineWidth=2;g.beginPath();
  if(a.shape===0)g.arc(cx,cy,m/2,0,Math.PI*2);
  else if(a.shape===1)g.rect(cx-m/2,cy-m/2,m,m);
  else{g.moveTo(cx,cy-m/2);g.lineTo(cx+m/2,cy+m/2);g.lineTo(cx-m/2,cy+m/2);g.closePath();}
  g.fill();g.stroke();
}
export const revisionType={
  id:'revision',title:'客戶改稿',
  prompt(p){
    const parts=[];
    if('shape' in p.request)parts.push('圖形改成'+SHAPES[p.request.shape]);
    if('color' in p.request)parts.push('顏色換成'+COLORS[p.request.color].n+'色');
    if('size' in p.request)parts.push('圖案'+SIZES[p.request.size]);
    return '客戶：'+parts.join('、')+'，其他都不要動！';
  },
  generate(rng,level){
    const k=[1,1,2,2,3,3][level-1],current={shape:rng.int(0,2),color:rng.int(0,3),size:rng.int(0,1)};
    const asked=rng.shuffle(ATTRS).slice(0,k),request={},correctAttrs={...current};
    for(const a of asked){let v;do{v=rng.int(0,RANGE[a]-1);}while(v===current[a]);request[a]=v;correctAttrs[a]=v;}
    const seen=new Set([attrKey(correctAttrs)]),out=[];
    for(let tries=0;out.length<3&&tries<400;tries++){
      const a=rng.pick(ATTRS),v=rng.int(0,RANGE[a]-1),cand={...correctAttrs,[a]:v};
      // 常見陷阱：只改一處（漏改或多改），第二層再混入兩處都錯
      if(tries>40){const b=rng.pick(ATTRS),w=rng.int(0,RANGE[b]-1);cand[b]=w;}
      const key=attrKey(cand);if(!seen.has(key)){seen.add(key);out.push(cand);}
    }
    const correct=rng.int(0,3),options=out.slice();options.splice(correct,0,correctAttrs);
    return {current,request,options,correct};
  },
  layout(box){
    const wide=box.w>box.h*1.3;
    if(wide){const cw=box.w*.26;return {cur:{x:box.x,y:box.y+(box.h-cw*1.2)/2,w:cw,h:cw*1.2},regions:grid(4,2,{x:box.x+cw+24,y:box.y,w:box.w-cw-24,h:box.h},12)};}
    const ch=box.h*.3;return {cur:{x:box.x+(box.w-ch)/2,y:box.y,w:ch,h:ch},regions:grid(4,2,{x:box.x,y:box.y+ch+16,w:box.w,h:box.h-ch-16},12)};
  },
  regions(p,box){return this.layout(box).regions;},
  draw(g,p,box){
    const l=this.layout(box);drawPoster(g,l.cur,p.current);
    g.fillStyle=NAVY;g.font='700 13px sans-serif';g.textAlign='center';g.fillText('目前稿件',l.cur.x+l.cur.w/2,l.cur.y+l.cur.h+16);
    l.regions.forEach((r,i)=>{drawPoster(g,r,p.options[i]);g.fillStyle=NAVY;g.font='700 13px sans-serif';g.textAlign='left';g.fillText(String(i+1),r.x+6,r.y+r.h-6);});
  },
  isCorrect:(p,id)=>id===p.correct
};


// ───────── 5. 色號配對：看色號，找出對應的色塊 ─────────
function hslToRgb(h,s,l){s/=100;l/=100;const k=n=>(n+h/30)%12,a=s*Math.min(l,1-l),f=n=>l-a*Math.max(-1,Math.min(k(n)-3,Math.min(9-k(n),1)));return [Math.round(f(0)*255),Math.round(f(8)*255),Math.round(f(4)*255)];}
const hex2=n=>n.toString(16).padStart(2,'0').toUpperCase();
const rgbHex=c=>'#'+c.map(hex2).join('');
const rgbCss=c=>'rgb('+c.join(',')+')';
export const hexType={
  id:'hex',title:'色號配對',minLevel:3,
  prompt:p=>'哪一塊是 '+p.hex+'？',
  generate(rng,level){
    const n=[4,4,4,6,6,6][level-1],delta=[26,20,15,11,8,6][level-1],h=rng.int(0,359),s=rng.int(45,80),l=rng.int(35,65);
    const target=hslToRgb(h,s,l),seen=new Set([rgbHex(target)]),out=[];
    for(let tries=0;out.length<n-1&&tries<400;tries++){
      const dh=rng.int(-delta,delta),dl=rng.int(-delta,delta)/2,ds=rng.int(-delta,delta)/2;
      if(Math.abs(dh)+Math.abs(dl)*2+Math.abs(ds)*2<delta*.6)continue;
      const c=hslToRgb((h+dh+360)%360,Math.max(20,Math.min(95,s+ds)),Math.max(20,Math.min(80,l+dl))),k=rgbHex(c);
      if(!seen.has(k)){seen.add(k);out.push(c);}
    }
    while(out.length<n-1){const c=target.map(v=>Math.max(0,Math.min(255,v+rng.int(-30,30)))),k=rgbHex(c);if(!seen.has(k)){seen.add(k);out.push(c);}}
    const correct=rng.int(0,n-1),options=out.slice();options.splice(correct,0,target);
    return {hex:rgbHex(target),options,correct};
  },
  regions(p,box){return grid(p.options.length,p.options.length>4?3:2,{x:box.x,y:box.y,w:box.w,h:box.h},12);},
  draw(g,p,box){this.regions(p,box).forEach((r,i)=>{frame(g,r.x,r.y,r.w,r.h,rgbCss(p.options[i]),3);g.fillStyle='rgba(255,255,255,.85)';g.font='800 13px sans-serif';g.textAlign='left';g.fillRect(Math.round(r.x)+6,Math.round(r.y+r.h)-24,22,18);g.fillStyle=NAVY;g.fillText(String(i+1),Math.round(r.x)+11,Math.round(r.y+r.h)-10);});},
  isCorrect:(p,id)=>id===p.correct
};

// ───────── 6. 字距找碴：找出字距和其他行不一樣的那一行 ─────────
const WORDS=['DEADLINE','REVISION','PANTONE','LAYOUT','TYPEFACE','KERNING','BRANDING','GRADIENT'];
export const kernType={
  id:'kern',title:'字距找碴',minLevel:2,
  prompt:()=>'找出字距和其他行不一樣的那一行',
  generate(rng,level){
    const n=[3,4,4,5,5,6][level-1],delta=[7,5,4,3,2.2,1.6][level-1];
    return {n,word:rng.pick(WORDS),odd:rng.int(0,n-1),delta:delta*(rng.next()<.5?-1:1),base:6};
  },
  regions(p,box){
    const gap=8,ch=Math.min((box.h-(p.n-1)*gap)/p.n,64),cw=Math.min(box.w,520),x0=box.x+(box.w-cw)/2,y0=box.y+(box.h-(p.n*ch+(p.n-1)*gap))/2;
    return Array.from({length:p.n},(_,i)=>({id:i,x:x0,y:y0+i*(ch+gap),w:cw,h:ch}));
  },
  draw(g,p,box){
    for(const r of this.regions(p,box)){
      frame(g,r.x,r.y,r.w,r.h,'#fff',3);
      const sp=p.base+(r.id===p.odd?p.delta:0),size=Math.round(r.h*.52);g.font='800 '+size+'px sans-serif';g.fillStyle=NAVY;g.textAlign='left';
      const ws=[...p.word].map(c=>g.measureText(c).width),total=ws.reduce((a,b)=>a+b,0)+sp*(p.word.length-1);
      let x=r.x+(r.w-total)/2;const y=r.y+r.h*.5+size*.35;
      [...p.word].forEach((c,i)=>{g.fillText(c,Math.round(x),Math.round(y));x+=ws[i]+sp;});
    }
  },
  isCorrect:(p,id)=>id===p.odd
};

// ───────── 7. 對比檢查：找出文字對比最低、最不好讀的卡片 ─────────
export const contrastType={
  id:'contrast',title:'對比檢查',minLevel:2,
  prompt:()=>'找出文字最不好讀（對比最低）的卡片',
  generate(rng,level){
    const n=[3,4,4,5,5,6][level-1],gapOdd=[24,19,15,12,9,7][level-1],hue=rng.int(0,359),dark=rng.next()<.5;
    const bgL=dark?rng.int(18,26):rng.int(80,90),sign=dark?1:-1,odd=rng.int(0,n-1);
    const diffs=Array.from({length:n},(_,i)=>i===odd?gapOdd+rng.int(0,3):gapOdd+22+rng.int(0,16));
    return {n,odd,hue,bgL,sign,diffs,s:rng.int(20,50)};
  },
  regions(p,box){return grid(p.n,p.n>4?3:2,box,12);},
  draw(g,p,box){
    this.regions(p,box).forEach(r=>{
      const bg=hslToRgb(p.hue,p.s,p.bgL),fg=hslToRgb(p.hue,p.s,Math.max(0,Math.min(100,p.bgL+p.sign*p.diffs[r.id])));
      frame(g,r.x,r.y,r.w,r.h,rgbCss(bg),3);
      g.fillStyle=rgbCss(fg);g.textAlign='center';g.font='900 '+Math.round(Math.min(r.h*.3,r.w*.14))+'px sans-serif';g.fillText('Aa 截稿',Math.round(r.x+r.w/2),Math.round(r.y+r.h*.5));
      g.font='700 '+Math.round(Math.min(r.h*.13,r.w*.08))+'px sans-serif';g.fillText('今天下班前要',Math.round(r.x+r.w/2),Math.round(r.y+r.h*.76));
    });
  },
  isCorrect:(p,id)=>id===p.odd
};

export const TYPES=[colorType,shapeType,alignType,revisionType,hexType,kernType,contrastType];

/**
 * 每日題組：同一個 rng 依序產生，同一天所有人題目一樣。
 * 題型依關卡解鎖（minLevel）；同一類型不會連續出現三題。
 */
export function createDeck(rng,types=TYPES){
  const items=[];
  return {
    get(i){
      while(items.length<=i){
        const idx=items.length,level=levelFor(idx),last=items.slice(-2).map(x=>x.type.id),pool=types.filter(t=>(t.minLevel||1)<=level);
        let type;for(let t=0;t<20;t++){type=rng.pick(pool);if(!(last.length===2&&last[0]===type.id&&last[1]===type.id))break;}
        items.push({type,level,puzzle:type.generate(rng,level)});
      }
      return items[i];
    },
    get length(){return items.length;}
  };
}

export const CORRECT_POINTS=100,WRONG_PENALTY=20,COMBO_PER=10,COMBO_CAP=10;
/** 答對得分：100＋連擊加成（第 2 題起每題 +10，最多 +100）；高關卡每題再加 5×(關卡-1)。 */
export const pointsForCorrect=(combo,level=1)=>CORRECT_POINTS+Math.min(Math.max(combo-1,0),COMBO_CAP)*COMBO_PER+5*(Math.max(level,1)-1);

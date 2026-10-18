/* 出氣擂台場景背景：辦公室／擂台場／練舞室／垃圾場。
   純 Canvas 繪製（漸層、燈光、道具與透視地板），畫一次就快取，不下載圖片。
   使用方式：ArenaScenes.names 是場景名稱；ArenaScenes.paint(ctx, 寬, 高, 地板線 y, 場景編號)。 */
(function(){
 const rnd=seed=>()=>((seed=(seed*16807)%2147483647)-1)/2147483646;
 const lg=(c,x0,y0,x1,y1,stops)=>{const g=c.createLinearGradient(x0,y0,x1,y1);stops.forEach(([o,col])=>g.addColorStop(o,col));return g;};
 const rg=(c,x,y,r0,r1,stops)=>{const g=c.createRadialGradient(x,y,r0,x,y,r1);stops.forEach(([o,col])=>g.addColorStop(o,col));return g;};
 const box=(c,x,y,w,h,fill,r)=>{c.fillStyle=fill;c.beginPath();if(r&&c.roundRect)c.roundRect(x,y,w,h,r);else c.rect(x,y,w,h);c.fill();};
 const circ=(c,x,y,r,fill)=>{c.fillStyle=fill;c.beginPath();c.arc(x,y,r,0,Math.PI*2);c.fill();};
 const poly=(c,pts,fill)=>{c.fillStyle=fill;c.beginPath();pts.forEach(([x,y],i)=>i?c.lineTo(x,y):c.moveTo(x,y));c.closePath();c.fill();};
 /* 透視地板線：從消失點往下放射的直線＋越近越寬的橫線 */
 function floorGrid(c,w,h,fy,col,cols,rows){c.save();c.strokeStyle=col;c.lineWidth=1;const vx=w/2;
  for(let i=-cols;i<=cols;i++){c.beginPath();c.moveTo(vx+i*(w/cols)*.22,fy);c.lineTo(vx+i*(w/cols)*1.15,h);c.stroke();}
  for(let j=1;j<=rows;j++){const t=Math.pow(j/rows,1.8),y=fy+(h-fy)*t;c.beginPath();c.moveTo(0,y);c.lineTo(w,y);c.stroke();}c.restore();}
 function vignette(c,w,h,a){c.fillStyle=rg(c,w/2,h*.52,Math.min(w,h)*.25,Math.max(w,h)*.75,[[0,'rgba(0,0,0,0)'],[1,'rgba(10,16,30,'+a+')']]);c.fillRect(0,0,w,h);}

 function office(c,w,h,fy){
  const R=rnd(11);
  c.fillStyle=lg(c,0,0,0,fy,[[0,'#f3f7f5'],[1,'#d4e1db']]);c.fillRect(0,0,w,fy);
  box(c,0,0,w,h*.07,'#c3d3cc');for(let i=0;i<5;i++){box(c,w*(.08+i*.19),h*.018,w*.13,h*.022,'#fffef2',4);c.fillStyle=rg(c,w*(.145+i*.19),h*.04,2,h*.16,[[0,'rgba(255,250,220,.35)'],[1,'rgba(255,250,220,0)']]);c.fillRect(w*(.145+i*.19)-h*.16,h*.04,h*.32,h*.2);}
  /* 大窗：天空＋城市天際線＋窗框＋日光 */
  const wx=w*.56,wy=fy-h*.56,ww=w*.38,wh=h*.4;box(c,wx-6,wy-6,ww+12,wh+12,'#8aa09a',6);c.save();c.beginPath();c.rect(wx,wy,ww,wh);c.clip();c.fillStyle=lg(c,0,wy,0,wy+wh,[[0,'#8fd3ff'],[1,'#e8f7ff']]);c.fillRect(wx,wy,ww,wh);
  circ(c,wx+ww*.82,wy+wh*.2,wh*.07,'#fff6c9');
  for(let i=0;i<9;i++){const bw=ww/8,bh=wh*(.25+R()*.4),bx=wx+i*bw*.95;box(c,bx,wy+wh-bh,bw,bh,i%2?'#9bbfd3':'#86abc2');for(let k=0;k<5;k++)for(let m=0;m<3;m++)if(R()>.4)box(c,bx+5+m*bw*.28,wy+wh-bh+8+k*bh*.17,3,3,'#e9f6fb');}
  c.restore();c.fillStyle='#8aa09a';c.fillRect(wx+ww/2-3,wy,6,wh);c.fillRect(wx,wy+wh*.55,ww,5);
  poly(c,[[wx+ww*.15,wy+wh],[wx+ww*.75,wy+wh],[wx+ww*.45,fy+(h-fy)*.7],[wx-ww*.2,fy+(h-fy)*.7]],'rgba(255,255,235,.18)');
  /* 白板＋便利貼 */
  const bx=w*.05,by=fy-h*.52,bw=w*.3,bh=h*.26;box(c,bx-5,by-5,bw+10,bh+10,'#b7c4c0',6);box(c,bx,by,bw,bh,'#ffffff',3);
  ['#ffd43b','#ff8787','#74c0fc','#8ce99a','#ffa94d','#b197fc'].forEach((col,i)=>{box(c,bx+bw*(.06+(i%3)*.3),by+bh*(.1+Math.floor(i/3)*.42),bw*.2,bh*.3,col,2);c.fillStyle='rgba(0,0,0,.25)';for(let k=0;k<3;k++)c.fillRect(bx+bw*(.08+(i%3)*.3),by+bh*(.18+Math.floor(i/3)*.42+k*.07),bw*.15,2);});
  /* 掛鐘 */
  circ(c,w*.46,fy-h*.5,h*.045,'#f4f4f0');c.strokeStyle='#5b6b66';c.lineWidth=3;c.beginPath();c.arc(w*.46,fy-h*.5,h*.045,0,7);c.stroke();c.beginPath();c.moveTo(w*.46,fy-h*.5);c.lineTo(w*.46,fy-h*.5-h*.03);c.moveTo(w*.46,fy-h*.5);c.lineTo(w*.46+h*.022,fy-h*.5);c.stroke();
  /* 桌子、螢幕、椅子、盆栽、檔案櫃 */
  const dy=fy-h*.13;box(c,w*.04,dy,w*.3,h*.02,'#c9a77c',3);box(c,w*.06,dy+h*.02,w*.012,fy-dy-h*.02,'#a8895f');box(c,w*.31,dy+h*.02,w*.012,fy-dy-h*.02,'#a8895f');
  box(c,w*.12,dy-h*.12,w*.12,h*.09,'#2b3440',4);box(c,w*.125,dy-h*.115,w*.11,h*.08,lg(c,0,dy-h*.115,0,dy-h*.035,[[0,'#6aa8ff'],[1,'#274690']]),3);box(c,w*.17,dy-h*.03,w*.02,h*.03,'#4c5663');box(c,w*.145,dy-h*.012,w*.07,h*.012,'#dfe5e8',3);circ(c,w*.27,dy-h*.015,h*.012,'#ff8787');
  box(c,w*.2,dy+h*.035,w*.07,h*.05,'#44505b',10);
  box(c,w*.88,fy-h*.17,w*.07,h*.17,'#9fb3ad',4);for(let i=0;i<3;i++){box(c,w*.89,fy-h*.16+i*h*.05,w*.05,h*.04,'#b9c9c4',2);box(c,w*.905,fy-h*.145+i*h*.05,w*.02,3,'#6f817b');}
  box(c,w*.82,fy-h*.07,w*.05,h*.07,'#c47f4f',5);for(let i=0;i<7;i++){const a=-1.2+i*.4;c.fillStyle=i%2?'#40a35a':'#2f8f49';c.beginPath();c.ellipse(w*.845+Math.sin(a)*w*.04,fy-h*.1-Math.cos(a)*h*.06,w*.012,h*.05,a,0,7);c.fill();}
  /* 地毯 */
  c.fillStyle=lg(c,0,fy,0,h,[[0,'#9db0bd'],[1,'#7a8e9d']]);c.fillRect(0,fy,w,h-fy);box(c,0,fy-5,w,5,'#7d8f88');floorGrid(c,w,h,fy,'rgba(255,255,255,.12)',10,6);
  c.fillStyle=rg(c,w*.5,fy+(h-fy)*.4,10,w*.5,[[0,'rgba(255,255,255,.22)'],[1,'rgba(255,255,255,0)']]);c.fillRect(0,fy,w,h-fy);
 }

 function ring(c,w,h,fy){
  const R=rnd(23);
  c.fillStyle=lg(c,0,0,0,fy,[[0,'#090d1e'],[1,'#22284a']]);c.fillRect(0,0,w,fy);
  /* 吊掛螢幕／旗幟 */
  box(c,w*.3,h*.17,w*.4,h*.12,'#10162f',6);box(c,w*.31,h*.18,w*.38,h*.10,lg(c,w*.31,0,w*.69,0,[[0,'#ff4d6d'],[.5,'#7b2ff7'],[1,'#00b4d8']]),4);c.fillStyle='#fff';c.font='900 '+Math.max(14,h*.06)+'px sans-serif';c.textAlign='center';c.textBaseline='middle';c.fillText('KO ARENA',w/2,h*.23);
  /* 觀眾（剪影＋螢光棒） */
  for(let row=0;row<3;row++){const y=fy-h*(.27-row*.07);c.fillStyle=['#0b1128','#0e1531','#121a3a'][row];for(let x=-10;x<w+20;x+=w*.045+row*3){const hh=h*(.045+R()*.02);circ(c,x,y-hh,hh*.45,c.fillStyle);box(c,x-hh*.55,y-hh*.7,hh*1.1,hh*1.2,c.fillStyle,hh*.4);if(R()>.82){const col=['#ff6b6b','#ffd43b','#69db7c','#4dabf7','#da77f2'][Math.floor(R()*5)];c.strokeStyle=col;c.lineWidth=3;c.beginPath();c.moveTo(x+hh*.4,y-hh);c.lineTo(x+hh*(.8+R()*.5),y-hh*(2+R()*.8));c.stroke();}}}
  /* 聚光燈錐 */
  [[.2,.3],[.5,.0],[.8,.3]].forEach(([fx])=>{const x=w*fx;poly(c,[[x-6,0],[x+6,0],[x+w*.14,fy+(h-fy)*.5],[x-w*.14,fy+(h-fy)*.5]],'rgba(255,248,214,.12)');circ(c,x,4,9,'#fff6c9');});
  /* 擂台柱、繩、角墊 */
  [[.04,1],[.96,-1]].forEach(([fx,dir])=>{const x=w*fx;box(c,x-8,fy-h*.38,16,h*.38+8,'#2a3050',3);[['#e5383b',.30],['#f1f1f1',.21],['#3a86ff',.12]].forEach(([col,t])=>{box(c,x-14,fy-h*t-8,28,16,col,6)});});
  [['#e5383b',.30],['#f1f1f1',.21],['#3a86ff',.12]].forEach(([col,t])=>{c.strokeStyle=col;c.lineWidth=6;c.lineCap='round';c.beginPath();c.moveTo(w*.04,fy-h*t);c.quadraticCurveTo(w/2,fy-h*t+h*.025,w*.96,fy-h*t);c.stroke();});
  /* 擂台地墊＋中央標誌 */
  c.fillStyle=lg(c,0,fy,0,h,[[0,'#d8d2c0'],[1,'#a79f88']]);c.fillRect(0,fy,w,h-fy);box(c,0,fy-4,w,8,'#2a3050');floorGrid(c,w,h,fy,'rgba(60,50,30,.12)',8,5);
  c.strokeStyle='rgba(200,40,50,.55)';c.lineWidth=5;c.beginPath();c.ellipse(w/2,fy+(h-fy)*.55,w*.2,(h-fy)*.32,0,0,7);c.stroke();c.fillStyle='rgba(200,40,50,.5)';c.font='900 '+Math.max(12,h*.05)+'px sans-serif';c.fillText('EMC',w/2,fy+(h-fy)*.55);
  c.fillStyle=rg(c,w/2,fy+(h-fy)*.4,10,w*.45,[[0,'rgba(255,248,214,.35)'],[1,'rgba(255,248,214,0)']]);c.fillRect(0,fy,w,h-fy);
 }

 function studio(c,w,h,fy){
  const R=rnd(37);
  c.fillStyle=lg(c,0,0,0,fy,[[0,'#f7f1e8'],[1,'#e6dac8']]);c.fillRect(0,0,w,fy);
  /* 天花板與軌道燈 */
  box(c,0,0,w,h*.06,'#d8cdb9');for(let i=0;i<7;i++){const x=w*(.08+i*.14);circ(c,x,h*.04,6,'#fff5d6');poly(c,[[x-4,h*.045],[x+4,h*.045],[x+w*.07,fy],[x-w*.07,fy]],'rgba(255,240,200,.10)');}
  /* 牆面彩條 */
  ['#ff8fab','#ffd166','#06d6a0','#4cc9f0'].forEach((col,i)=>box(c,0,h*.065+i*h*.012,w,h*.008,col));
  /* 整面鏡子：斜向反光＋地板倒影 */
  const mx=w*.04,my=fy-h*.52,mw=w*.92,mh=h*.43;box(c,mx-5,my-5,mw+10,mh+10,'#b9aa92',5);c.save();c.beginPath();c.rect(mx,my,mw,mh);c.clip();c.fillStyle=lg(c,mx,my,mx+mw,my+mh,[[0,'#d6ecf5'],[.5,'#eef8fc'],[1,'#c8e1ee']]);c.fillRect(mx,my,mw,mh);
  for(let i=0;i<5;i++){c.fillStyle='rgba(255,255,255,'+(.10+R()*.12)+')';poly(c,[[mx+mw*(.08+i*.2),my],[mx+mw*(.12+i*.2),my],[mx+mw*(.02+i*.2),my+mh],[mx-mw*.02+mw*i*.2,my+mh]],c.fillStyle);}
  c.fillStyle='rgba(230,200,160,.35)';c.fillRect(mx,my+mh*.82,mw,mh*.18);for(let i=1;i<6;i++){box(c,mx+mw*i/6-1,my,2,mh,'rgba(120,150,170,.35)');}c.restore();
  /* 扶手桿＋支架 */
  const by=fy-h*.24;c.strokeStyle='#a97c50';c.lineWidth=8;c.lineCap='round';c.beginPath();c.moveTo(w*.03,by);c.lineTo(w*.97,by);c.stroke();c.strokeStyle='#7d5a38';c.lineWidth=4;for(let i=0;i<6;i++){const x=w*(.1+i*.16);c.beginPath();c.moveTo(x,by);c.lineTo(x,by+h*.05);c.stroke();}
  /* 音響與盆栽 */
  box(c,w*.01,fy-h*.2,w*.045,h*.2,'#2b2f3a',4);circ(c,w*.0325,fy-h*.09,h*.03,'#454b5c');circ(c,w*.0325,fy-h*.16,h*.012,'#454b5c');
  box(c,w*.93,fy-h*.06,w*.04,h*.06,'#d98c5f',4);for(let i=0;i<6;i++){const a=-1+i*.4;c.fillStyle=i%2?'#52b788':'#40916c';c.beginPath();c.ellipse(w*.95+Math.sin(a)*w*.03,fy-h*.09-Math.cos(a)*h*.05,w*.01,h*.045,a,0,7);c.fill();}
  /* 木地板 */
  c.fillStyle=lg(c,0,fy,0,h,[[0,'#d9b283'],[1,'#b78a5a']]);c.fillRect(0,fy,w,h-fy);box(c,0,fy-5,w,5,'#8f6a43');floorGrid(c,w,h,fy,'rgba(90,60,30,.22)',12,6);
  c.fillStyle=lg(c,0,fy,0,h,[[0,'rgba(255,255,255,.30)'],[.5,'rgba(255,255,255,.05)'],[1,'rgba(255,255,255,0)']]);c.fillRect(0,fy,w,h-fy);
 }

 function junkyard(c,w,h,fy){
  const R=rnd(53);
  c.fillStyle=lg(c,0,0,0,fy,[[0,'#5a4a8a'],[.55,'#f0875b'],[1,'#ffd9a0']]);c.fillRect(0,0,w,fy);
  circ(c,w*.72,fy-h*.2,h*.07,'#fff0c4');c.fillStyle=rg(c,w*.72,fy-h*.2,h*.07,h*.4,[[0,'rgba(255,230,170,.55)'],[1,'rgba(255,230,170,0)']]);c.fillRect(0,0,w,fy);
  /* 遠景：廢料山＋起重機＋煙 */
  c.fillStyle='#6e4f78';c.beginPath();c.moveTo(0,fy);for(let x=0;x<=w;x+=w/16)c.lineTo(x,fy-h*(.12+R()*.12));c.lineTo(w,fy);c.fill();
  c.strokeStyle='#4a3555';c.lineWidth=5;c.beginPath();c.moveTo(w*.12,fy-h*.1);c.lineTo(w*.12,fy-h*.5);c.lineTo(w*.34,fy-h*.5);c.stroke();c.lineWidth=2;c.beginPath();c.moveTo(w*.3,fy-h*.5);c.lineTo(w*.3,fy-h*.32);c.stroke();box(c,w*.285,fy-h*.32,w*.03,h*.03,'#4a3555',2);
  for(let i=0;i<4;i++){c.fillStyle='rgba(90,70,100,'+(.35-i*.06)+')';c.beginPath();c.ellipse(w*.86+i*8,fy-h*(.3+i*.09),h*(.05+i*.02),h*.045,0,0,7);c.fill();}
  /* 中景：輪胎堆、油桶、木箱、報廢車身、電視 */
  const tire=(x,y,r)=>{circ(c,x,y,r,'#2a2630');circ(c,x,y,r*.55,'#4a4452');circ(c,x,y,r*.22,'#1d1a22');};
  const barrel=(x,y,bw,bh,col)=>{box(c,x,y,bw,bh,col,4);c.fillStyle='rgba(0,0,0,.25)';c.fillRect(x,y+bh*.25,bw,3);c.fillRect(x,y+bh*.7,bw,3);};
  for(let i=0;i<6;i++)tire(w*(.04+(i%3)*.05),fy-h*(.025+Math.floor(i/3)*.045)-4,h*.032);
  barrel(w*.2,fy-h*.1,w*.035,h*.1,'#c0392b');barrel(w*.24,fy-h*.085,w*.03,h*.085,'#e67e22');barrel(w*.21,fy-h*.19,w*.033,h*.09,'#2e86c1');
  box(c,w*.74,fy-h*.09,w*.07,h*.09,'#b9874f',2);box(c,w*.78,fy-h*.16,w*.06,h*.07,'#a8763f',2);c.strokeStyle='#7a5430';c.lineWidth=2;c.strokeRect(w*.74,fy-h*.09,w*.07,h*.09);
  box(c,w*.8,fy-h*.07,w*.17,h*.06,'#7a8b99',6);box(c,w*.83,fy-h*.115,w*.1,h*.05,'#667684',6);circ(c,w*.84,fy-h*.01,h*.022,'#1b1b22');circ(c,w*.93,fy-h*.01,h*.022,'#1b1b22');box(c,w*.84,fy-h*.105,w*.04,h*.03,'#9fb7c6',2);
  box(c,w*.9,fy-h*.2,w*.045,h*.05,'#454b5c',3);box(c,w*.905,fy-h*.195,w*.035,h*.036,'#223',2);
  /* 鐵絲網圍欄 */
  c.strokeStyle='rgba(40,35,50,.35)';c.lineWidth=1;const fyy=fy-h*.22;c.beginPath();for(let x=-h;x<w+h;x+=14){c.moveTo(x,fyy);c.lineTo(x+h*.22,fy);c.moveTo(x+h*.22,fyy);c.lineTo(x,fy);}c.stroke();c.strokeStyle='#3b3447';c.lineWidth=4;c.beginPath();c.moveTo(0,fyy);c.lineTo(w,fyy);c.stroke();for(let x=10;x<w;x+=w/9){box(c,x,fyy,5,fy-fyy,'#3b3447');}
  /* 警告牌 */
  box(c,w*.46,fy-h*.34,w*.08,h*.07,'#ffd43b',4);c.fillStyle='#222';c.font='900 '+Math.max(9,h*.034)+'px sans-serif';c.textAlign='center';c.textBaseline='middle';c.fillText('危險',w*.5,fy-h*.305);
  /* 泥地、積水、碎石、輪胎痕 */
  c.fillStyle=lg(c,0,fy,0,h,[[0,'#7a6450'],[1,'#4d3d30']]);c.fillRect(0,fy,w,h-fy);box(c,0,fy-4,w,5,'#4a3b2f');
  for(let i=0;i<70;i++){circ(c,R()*w,fy+R()*(h-fy),1+R()*2.4,'rgba(30,22,16,'+(.25+R()*.3)+')');}
  c.strokeStyle='rgba(30,22,16,.22)';c.lineWidth=6;[[.25,.75],[.35,.9]].forEach(([a,b])=>{c.beginPath();c.moveTo(w*a,fy);c.quadraticCurveTo(w*(a+.1),fy+(h-fy)*.5,w*b,h);c.stroke();});
  [[.3,.5,.12],[.72,.7,.1]].forEach(([fx,t,r])=>{c.fillStyle='rgba(255,190,130,.45)';c.beginPath();c.ellipse(w*fx,fy+(h-fy)*t,w*r,(h-fy)*.1,0,0,7);c.fill();});
 }

 window.ArenaScenes={
  names:['辦公室','擂台場','練舞室','垃圾場'],
  paint(c,w,h,fy,index){c.save();c.clearRect(0,0,w,h);[office,ring,studio,junkyard][((index%4)+4)%4](c,w,h,fy);vignette(c,w,h,.28);c.restore();}
 };
})();

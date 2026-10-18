/* Canvas-native cartoon damage and weapon animation. Original PNGs stay untouched. */
window.ArenaCombatFX=class {
 constructor(){this.lastBurst=-Infinity;this.events=[];this.damage=0;this.marks=[];this.layer=null;this.target=-1;this.dizzyUntil=0;this.boundCache=new WeakMap();this.faceY=[.39,.29,.33,.30,.40,.32,.31,.27,.33,.32,.33];}
 reset(){this.lastBurst=-Infinity;this.events=[];this.damage=0;this.marks=[];this.layer=null;this.target=-1;this.dizzyUntil=0;}
 bounds(image){if(this.boundCache.has(image))return this.boundCache.get(image);const cv=document.createElement('canvas');cv.width=image.naturalWidth;cv.height=image.naturalHeight;const c=cv.getContext('2d',{willReadFrequently:true});c.drawImage(image,0,0);const {data}=c.getImageData(0,0,cv.width,cv.height);let x0=cv.width,y0=cv.height,x1=0,y1=0;for(let y=0;y<cv.height;y++)for(let x=0;x<cv.width;x++)if(data[(y*cv.width+x)*4+3]>80){x0=Math.min(x0,x);y0=Math.min(y0,y);x1=Math.max(x1,x);y1=Math.max(y1,y);}const b={x:x0,y:y0,w:x1-x0+1,h:y1-y0+1};this.boundCache.set(image,b);return b;}
 hit(weapon,hp,now,ultimate){this.damage=1-hp/300;if(hp<150||weapon===2)this.dizzyUntil=now+2700;this.marks.push({weapon,side:this.marks.length%2?1:-1});if(this.marks.length>30)this.marks.shift();this.layer=null;const burst=ultimate||(now-this.lastBurst>650&&Math.random()<.35);if(burst)this.lastBurst=now;this.events.push({burst,weapon,start:now,duration:ultimate?1100:weapon===6?850:620,ultimate});this.events=this.events.slice(-3);}
 paint(image,index){
  if(this.layer&&this.target===index)return this.layer;
  this.target=index;const cv=this.layerBuffer||(this.layerBuffer=document.createElement('canvas'));if(cv.width!==image.naturalWidth||cv.height!==image.naturalHeight){cv.width=image.naturalWidth;cv.height=image.naturalHeight;}const c=cv.getContext('2d'),b=this.bounds(image),unit=b.h;c.clearRect(0,0,cv.width,cv.height);
  // Pixel coordinates are based on visible character bounds, including source padding.
  const cx=b.x+b.w*.5,cy=b.y+b.h*this.faceY[index],faceWidth=b.w*.50;
  function ellipse(x,y,rx,ry,color,rotation=0){c.fillStyle=color;c.beginPath();c.ellipse(x,y,rx,ry,rotation,0,Math.PI*2);c.fill();}
  if(this.damage>.04){
   const noseY=cy+unit*.065,bleed=unit*(.045+this.damage*.075);c.save();c.strokeStyle='#c63742';c.lineWidth=unit*.011;c.lineCap='round';c.beginPath();c.moveTo(cx+unit*.009,noseY);c.bezierCurveTo(cx-unit*.002,noseY+bleed*.4,cx+unit*.026,noseY+bleed*.55,cx+unit*.016,noseY+bleed);c.stroke();ellipse(cx+unit*.016,noseY+bleed,unit*.010,unit*.016,'#d9454e');c.strokeStyle='#ff9290';c.lineWidth=unit*.003;c.beginPath();c.moveTo(cx+unit*.007,noseY+unit*.01);c.lineTo(cx+unit*.013,noseY+bleed*.7);c.stroke();
   if(this.damage>.4){ellipse(cx-unit*.014,noseY+bleed*.45,unit*.005,unit*.008,'#d9454e');}c.restore();
  }
  // Uneven cheek patches, with no circular eye outlines.
  if(this.damage>.025){for(let side of [-1,1]){if(side===1&&this.marks.length<2)continue;const x=cx+side*faceWidth*.29,y=cy+unit*(side<0?.065:.075),r=unit*(side<0?.043:.035);c.save();c.translate(x,y);c.rotate(side*.22);c.fillStyle=side<0?'rgba(78,70,139,.70)':'rgba(57,102,127,.68)';c.beginPath();c.moveTo(-r,-r*.45);c.bezierCurveTo(-r*.5,-r*1.1,r*.3,-r*.65,r,-r*.3);c.lineTo(r*.8,r*.5);c.quadraticCurveTo(0,r*.95,-r*.85,r*.35);c.closePath();c.fill();c.strokeStyle='rgba(63,49,110,.6)';c.lineWidth=unit*.003;for(let j=-1;j<=1;j++){c.beginPath();c.moveTo(j*r*.4-r*.14,-r*.25);c.lineTo(j*r*.4+r*.14,r*.25);c.stroke();}c.restore();}}
  const recent=this.marks.slice(-8);
  if(recent.some(m=>m.weapon===1)){c.save();c.translate(cx+faceWidth*.23,cy-unit*.01);c.rotate(.38);ellipse(0,0,unit*.044,unit*.083,'rgba(41,63,154,.78)');c.strokeStyle='rgba(31,66,112,.70)';c.lineWidth=unit*.004;for(let i=-2;i<=2;i++){c.beginPath();c.moveTo(-unit*.031,i*unit*.024);c.lineTo(unit*.031,i*unit*.014);c.stroke();}c.restore();}
  if(recent.some(m=>m.weapon===4)){for(let i=0;i<7;i++){const a=i*2.4;ellipse(cx+Math.cos(a)*unit*.084,cy+unit*.033+Math.sin(a)*unit*.054,unit*(i%2?.031:.043),unit*.030,'#fff6df');}ellipse(cx,cy+unit*.017,unit*.025,unit*.031,'#f5c96d');}
  if(recent.some(m=>m.weapon===6)){const g=c.createRadialGradient(cx,cy+unit*.05,0,cx,cy+unit*.05,unit*.145);g.addColorStop(0,'rgba(30,17,50,.88)');g.addColorStop(1,'rgba(43,37,57,0)');c.fillStyle=g;c.fillRect(cx-unit*.16,cy-unit*.10,unit*.32,unit*.32);}
  if(recent.some(m=>m.weapon===3)){c.font=`bold ${unit*.025}px monospace`;c.textAlign='center';c.fillStyle='#51445a';c.fillText('Ctrl + Z',cx,b.y+unit*.69);}
  // Alpha-mask every mark to the character silhouette.
  c.globalCompositeOperation='destination-in';c.drawImage(image,0,0);c.globalCompositeOperation='source-over';this.layer=cv;return cv;
 }
 overlay(ctx,image,index,w,h){if(!this.damage&&!this.marks.length)return;const layer=this.paint(image,index),b=this.bounds(image);ctx.drawImage(layer,b.x,b.y,b.w,b.h,-w/2,-h,w,h);if(this.damage>.04){const count=this.damage>.55?3:this.damage>.22?2:1;for(let i=0;i<count;i++){const t=count>1?(i-(count-1)/2)/((count-1)/2):0,x=t*h*.115,y=-h+h*.03+t*t*h*.045,r=h*(.047+this.damage*.022)*(i%2?.80:1);ctx.save();ctx.translate(x,y);ctx.rotate(t*.42);ctx.fillStyle=i%2?'#efa18c':'#f6b0a0';ctx.strokeStyle='#b85c5e';ctx.lineWidth=Math.max(1,h*.006);ctx.beginPath();ctx.moveTo(-r,r*.25);ctx.bezierCurveTo(-r*1.15,-r*.8,-r*.55,-r*1.25,0,-r*1.2);ctx.bezierCurveTo(r*.75,-r*1.2,r*1.15,-r*.45,r,r*.25);ctx.closePath();ctx.fill();ctx.stroke();ctx.strokeStyle='#ffe4cf';ctx.lineWidth=h*.008;ctx.beginPath();ctx.moveTo(-r*.45,-r*.65);ctx.quadraticCurveTo(-r*.25,-r*.95,r*.12,-r*.90);ctx.stroke();ctx.restore();}}}
 geometry(width,height,index=4){const unit=Math.min(height*.34,width*.62);const foot=height*.56+unit*.5;return {x:width*.5,y:foot-unit+unit*(this.faceY[index]+.05),unit,foot,floorY:foot};}
 active(now){return now<this.dizzyUntil||this.events.some(e=>now<e.start+e.duration);}
 draw(ctx,now,width,height,reduced,index=4){
  this.events=this.events.filter(e=>now<e.start+e.duration);
  const {x,y,unit}=this.geometry(width,height,index);
  if(now<this.dizzyUntil){ctx.save();ctx.translate(x,y-unit*.46);ctx.font='bold 24px sans-serif';ctx.textAlign='center';for(let j=0;j<5;j++){const a=(reduced?0:now*.004)+j*Math.PI*2/5;ctx.fillStyle=j%2?'#6ffff0':'#ffed3c';ctx.strokeStyle='#441957';ctx.lineWidth=3;const sx=Math.cos(a)*unit*.37,sy=Math.sin(a)*unit*.08;ctx.strokeText('★',sx,sy);ctx.fillText('★',sx,sy);}ctx.restore();}
  for(const e of this.events){const p=(now-e.start)/e.duration,a=Math.max(0,1-p),colors=['#ff4caa','#52ffff','#ffe53a','#c58aff','#fff28c','#ff963e','#69ffdf','#f98dff'];ctx.save();ctx.translate(x,y);ctx.globalAlpha=a;
   if(e.ultimate&&!reduced){ctx.save();ctx.globalAlpha=a*.85;ctx.strokeStyle='#ff46bc';ctx.shadowColor='#ff5ac6';ctx.shadowBlur=0;ctx.lineWidth=unit*(.28+.13*Math.sin(p*Math.PI));ctx.beginPath();ctx.moveTo(0,height-y);ctx.lineTo(0,-unit*.04);ctx.stroke();ctx.strokeStyle='#ffef45';ctx.lineWidth=unit*.14;ctx.stroke();ctx.strokeStyle='#fff5d7';ctx.lineWidth=unit*.055;ctx.stroke();ctx.restore();}
   // Layered comic impact burst.
   if(e.burst&&p<.42){ctx.save();ctx.globalAlpha=a*.62;ctx.rotate(e.weapon*.8);ctx.scale(1+p,1+p);ctx.fillStyle=e.ultimate?'#fff3ab':colors[e.weapon];ctx.beginPath();for(let i=0;i<20;i++){const angle=i*Math.PI/10,r=unit*(i%2?.17:.38);ctx.lineTo(Math.cos(angle)*r,Math.sin(angle)*r);}ctx.closePath();ctx.strokeStyle='#351043';ctx.lineWidth=4;ctx.stroke();ctx.fill();ctx.fillStyle='#fffbe8';ctx.beginPath();ctx.arc(0,0,unit*.105,0,Math.PI*2);ctx.fill();ctx.restore();}
   if(!reduced){
    ctx.lineCap='round';ctx.strokeStyle=colors[e.weapon];
    // Speed lines converge on the hit; stable colors avoid a rapid full-screen flash.
    if(p<.55){ctx.save();ctx.globalAlpha=a*.48;ctx.lineWidth=3;for(let i=0;i<8;i++){const angle=i*Math.PI/7+e.weapon*.12,r=unit*(.50+p*.25);ctx.beginPath();ctx.moveTo(Math.cos(angle)*r,Math.sin(angle)*r);ctx.lineTo(Math.cos(angle)*(r+unit*.43),Math.sin(angle)*(r+unit*.43));ctx.stroke();}ctx.restore();}
    ctx.save();ctx.globalAlpha=a*.85;ctx.strokeStyle=e.ultimate?'#fff642':colors[e.weapon];ctx.lineWidth=7*(1-p)+1;ctx.beginPath();ctx.ellipse(0,0,unit*(.15+p*.85),unit*(.10+p*.54),-.25,0,Math.PI*2);ctx.stroke();ctx.restore();
    if([0,1,2,5].includes(e.weapon)){for(let i=0;i<3;i++){ctx.globalAlpha=a*(.6-i*.15);ctx.lineWidth=unit*(.045-i*.009);ctx.beginPath();ctx.arc(-unit*.26,-unit*.05,unit*(.39+i*.09),-.2-Math.PI*.55+p*.5,1.2+p*.6);ctx.stroke();}}
    if(e.weapon===6){ctx.globalAlpha=a;ctx.shadowBlur=0;ctx.shadowColor='#c0ffc1';for(let j=0;j<3;j++){ctx.strokeStyle=j?'#fffbd1':'#b9f5ac';ctx.lineWidth=j?4:13;ctx.beginPath();ctx.moveTo(-unit*.04,-height*.40);for(let i=0;i<8;i++)ctx.lineTo((i%2?.05:-.06)*unit+j*4,-height*.40+i*height*.06);ctx.stroke();}ctx.shadowBlur=0;}
    if(e.weapon===7){for(let i=0;i<14;i++){const angle=i*.8+p*5,r=unit*(.2+p*.5);ctx.save();ctx.translate(Math.cos(angle)*r,Math.sin(angle)*r*.6);ctx.rotate(angle);ctx.fillStyle='#f3f2df';ctx.fillRect(-8,-11,16,22);ctx.fillStyle='#6d9b9c';for(let j=0;j<3;j++)ctx.fillRect(-5,-6+j*5,10,2);ctx.restore();}}
    if(e.weapon===3){for(let i=0;i<6;i++){const angle=i*.8+2;ctx.save();ctx.translate(Math.cos(angle)*unit*p*.8,Math.sin(angle)*unit*p*.65);ctx.rotate(p*4);ctx.fillStyle='#d7c5ef';ctx.fillRect(-9,-9,18,18);ctx.fillStyle='#453b60';ctx.font='bold 10px monospace';ctx.textAlign='center';ctx.fillText(['Z','X','C','V','!'][i%5],0,4);ctx.restore();}}
    if(e.weapon===5){for(let i=0;i<5;i++){ctx.save();ctx.translate((i-2)*unit*p*.25,-unit*p*.5);ctx.rotate(i+p*5);ctx.fillStyle='#ffe59b';ctx.beginPath();ctx.ellipse(0,0,3,10,0,0,Math.PI*2);ctx.fill();ctx.restore();}}
    if(e.weapon===2){ctx.strokeStyle='#ffe395';ctx.lineWidth=2;ctx.beginPath();ctx.ellipse(0,-unit*.42,unit*.25,unit*.05,0,0,Math.PI*2);ctx.stroke();ctx.font='17px sans-serif';for(let i=0;i<3;i++){const angle=p*8+i*Math.PI*2/3;ctx.fillStyle='#ffe395';ctx.fillText('★',Math.cos(angle)*unit*.25,-unit*.42+Math.sin(angle)*unit*.05);}}
    // Weapon ghosts run from the player toward the impact point.
    if(p<.7&&e.weapon!==6&&e.weapon!==7)for(let j=2;j>=0;j--){ctx.save();const travel=Math.min(1,p*2.7-j*.10);ctx.translate(Math.sin(travel*Math.PI)*unit*.12,(height-y)*.8*(1-Math.max(0,travel)));ctx.rotate(-.7+travel*1.4);ctx.globalAlpha=a*(j?.15:.95);ctx.font=`${unit*.43}px sans-serif`;ctx.textAlign='center';window.ArenaWeaponArt.draw(ctx,e.weapon,unit*.43);ctx.restore();}
   }
   if(p<.80){ctx.save();ctx.globalAlpha=Math.min(1,a*1.7);ctx.translate(-unit*.34,-unit*(.28+p*.25));ctx.rotate(-.19);ctx.font='900 italic '+Math.max(24,unit*.22)+'px sans-serif';ctx.textAlign='center';ctx.strokeStyle='#291039';ctx.lineWidth=7;const word=e.ultimate?'SUPER!!':['POW!','啪!!','鏘!!','CTRL!','SPLAT!','SQUEAK!','ZAP!!','加班退散!'][e.weapon];ctx.strokeText(word,0,0);ctx.fillStyle=e.ultimate?'#ffed45':colors[e.weapon];ctx.fillText(word,0,0);ctx.restore();}
   ctx.restore();
  }
 }
};

/* 整層辦公室版面（2026-10-31）：桌組以外的房間、牆、道具。只在整頁／編輯版啟用，嵌入首頁小框（?embed=1）完全不受影響。
 * 座標全部用「版面圖」的像素寫（使用者提供的平面配置圖，1201×1526），由 fx/fy 轉成畫布座標，
 * 對不準時只要調 FLOOR_SCALE 與 fx／fy 的原點，不用改每一筆。
 * 遊戲的邏輯座標（同步給大家的位置）完全不動：畫面 x 只是多加 FLOOR_OX，y 由 viewY 轉換，
 * 碰撞則在畫面座標上判斷。 */
const FLOOR_ON=!/[?&]embed=1/.test(location.search);
const OX=FLOOR_ON?300:0;// 畫布往左多留的寬度（米黃桌組、電梯在原本的左邊界外）
const OB=FLOOR_ON?700:0;// 畫布往下多留的高度（下方會議室、茶水間）
const FLOOR_EXTRA_TOP=FLOOR_ON?550:0;// 畫布往上再多留的高度（廁所、會議室 A）
const FLOOR_SCALE=2.097;// 版面圖 1 px = 畫布 2.097 px（藍色桌組三排的間距 237 px ↔ 497）
const fx=ix=>OX+438+FLOOR_SCALE*(ix-408);
const fy=iy=>315+FLOOR_SCALE*(iy-828);
const fs=n=>FLOOR_SCALE*n;

const FLOOR_ASSET_DIR='assets/props2/';
const FLOOR_IMG={};
const FLOOR_FILES={elevator:'elevator.png',stall:'toilet_stall.png',sink:'pedestal_sink.png',tableA:'meeting_table_black_6.png',table4:'meeting_table_black_4.png',tableU:'meeting_table_white_U.png',pantry:'pantry_counter.png',fridge:'fridge_double.png',plant:'plant_pot.png',deskBeige:'desk_beige_front.png',deskL:'desk_white_L.png',shelf:'bookshelf_black_small.png',pillarCab:'pillar_cabinet.png',chair:'../props/chair_black.png',pillar:'../props/pillar_white.png'};
/** Codex 畫的圖四周有透明留白：裁到實際範圍，之後用寬或高定尺寸才準。 */
function floorTrim(img){
  const c=document.createElement('canvas');c.width=img.naturalWidth;c.height=img.naturalHeight;const g=c.getContext('2d',{willReadFrequently:true});g.drawImage(img,0,0);
  const d=g.getImageData(0,0,c.width,c.height).data;let x0=c.width,x1=-1,y0=c.height,y1=-1;
  for(let y=0;y<c.height;y++)for(let x=0;x<c.width;x++)if(d[(y*c.width+x)*4+3]>24){if(x<x0)x0=x;if(x>x1)x1=x;if(y<y0)y0=y;if(y>y1)y1=y;}
  if(x1<0)return img;
  const t=document.createElement('canvas');t.width=x1-x0+1;t.height=y1-y0+1;t.getContext('2d').drawImage(c,x0,y0,t.width,t.height,0,0,t.width,t.height);return t;
}
function floorLoad(){
  return Promise.all(Object.entries(FLOOR_FILES).map(([k,f])=>new Promise(res=>{const i=new Image();i.onload=()=>{FLOOR_IMG[k]=floorTrim(i);res();};i.onerror=()=>res();i.src=FLOOR_ASSET_DIR+f+'?v=1';})));
}

// 玻璃隔間牆：[x, y, w, h]（版面圖像素）。缺口就是門。
const FLOOR_WALLS=[
  // 男廁
  [290,48,153,12],[290,48,12,222],[431,48,12,222],[290,258,95,12],
  // 女廁
  [443,48,165,12],[596,48,12,222],[443,258,100,12],
  // 會議室 A
  [660,48,402,12],[1050,48,12,222],[660,258,402,12],[660,48,12,77],[660,210,12,60],
  // 影廳（左下上）與會議室 C（左下下）
  [82,1045,208,12],[82,1045,12,205],[278,1045,12,205],[82,1238,208,12],
  [82,1250,208,12],[82,1250,12,210],[278,1250,12,75],[278,1380,12,80],[82,1448,208,12],
  // 會議室 D（右下）
  [610,1045,210,12],[872,1045,210,12],[610,1045,12,417],[1070,1045,12,417],[610,1450,472,12]
];
// 道具：key, 左上 x, 底部 y, 寬（高依素材比例），碰撞（相對底部的高度 fh，預設 30；[x,y,w,h] 為版面圖像素的自訂碰撞）
const FLOOR_PROPS=[
  ['elevator',165,255,72,{fh:40}],
  ['stall',305,190,83,{col:[305,64,83,128],h:125}],['sink',305,242,36,{fh:30,h:48}],
  ['stall',460,190,83,{col:[460,64,83,128],h:125}],['sink',460,242,36,{fh:30,h:48}],
  ['tableA',735,210,256,{col:[735,118,256,84]}],
  ['table4',118,1205,132,{col:[118,1112,132,78]}],['table4',122,1405,128,{col:[122,1320,128,78]}],
  ['tableU',658,1350,380,{col:[676,1166,340,60]}],
  ['pantry',333,1268,125,{fh:34}],['fridge',477,1285,73,{fh:50}],['plant',570,1320,22,{fh:14}],
  // 米黃桌組（上下兩組，各 2×2）
  ...[0,237].flatMap(dy=>[[85,355],[190,355],[85,400],[190,400]].map(([x,y])=>['deskBeige',x,y+48+dy,105,{fh:42}])),
  ...[0,237].flatMap(dy=>[['chair',113,497+dy,50,{fh:20}],['chair',218,497+dy,50,{fh:20}]]),
  ['deskL',85,930,223,{fh:56}],['chair',198,952,48,{fh:20}],
  // 藍色桌組左側與縫隙的書櫃、白柱與紅色抽屜櫃
  ['shelf',388,445,22,{fh:90,h:90}],['shelf',388,682,22,{fh:90,h:90}],['shelf',388,920,22,{fh:90,h:90}],
  ['shelf',872,445,20,{fh:70,h:70}],['shelf',725,682,26,{fh:56,h:57}],['shelf',850,682,30,{fh:56,h:57}],
  ['pillarCab',730,445,70,{fh:90}],['pillar',730,920,42,{fh:90,h:92}]
];
const FLOOR_LABELS=[['男廁',370,44],['女廁',526,44],['會議室 A',863,153],['影廳',215,1060],['會議室 C',186,1352],['茶水間',396,1226],['冰箱',512,1208],['會議室 D',845,1285],['電梯',201,262]];
// 影廳螢幕（藍色簡報畫面）
const FLOOR_SCREEN=[118,1112,80,58];

function floorRects(){
  const out=[];
  for(const [x,y,w,h] of FLOOR_WALLS)out.push([fx(x),fy(y),fs(w),fs(h)]);
  for(const [key,x,bottom,w,o] of FLOOR_PROPS){
    if(o.col)out.push([fx(o.col[0]),fy(o.col[1]),fs(o.col[2]),fs(o.col[3])]);
    else out.push([fx(x),fy(bottom-(o.fh||30)),fs(w),fs(o.fh||30)]);
  }
  return out;
}
let FLOOR_RECTS=null;
/** 畫面座標（vx, vy）是否撞到牆或道具。腳底點外擴 12，避免貼著牆走時身體穿過去。 */
function floorBlocked(vx,vy){
  if(!FLOOR_ON)return false;
  if(!FLOOR_RECTS)FLOOR_RECTS=floorRects();
  return FLOOR_RECTS.some(([a,b,w,h])=>vx>a-12&&vx<a+w+12&&vy>b-6&&vy<b+h+6);
}

function floorWallPaint(c,x,y,w,h){
  c.fillStyle='#cfe6ee';c.fillRect(x,y,w,h);
  c.fillStyle='#f4fbfd';c.fillRect(x+3,y+3,Math.max(0,w-6),Math.max(0,h-6));
  c.strokeStyle='#26323a';c.lineWidth=3;c.strokeRect(x+1.5,y+1.5,w-3,h-3);
}
function floorPill(c,text,x,y){
  c.font='700 15px "Noto Sans TC","PingFang TC",system-ui,sans-serif';c.textAlign='center';c.textBaseline='middle';
  const w=c.measureText(text).width+16;
  c.fillStyle='#232b32';c.fillRect(Math.round(x-w/2),Math.round(y-10),Math.round(w),20);
  c.fillStyle='#fff';c.fillText(text,Math.round(x),Math.round(y+1));
}
/** 底層：牆、影廳螢幕。 */
function floorDrawGround(c){
  if(!FLOOR_ON)return;
  c.save();c.imageSmoothingEnabled=false;
  for(const [x,y,w,h] of FLOOR_WALLS)floorWallPaint(c,fx(x),fy(y),fs(w),fs(h));
  c.restore();
}
/** 道具與標籤，回傳要放進深度排序的圖層（depth 是畫面 y，跟人物同一套）。 */
function floorLayers(){
  if(!FLOOR_ON)return[];
  const layers=[];
  for(const [key,x,bottom,w,o] of FLOOR_PROPS){
    const img=FLOOR_IMG[key];if(!img)continue;
    const iw=img.naturalWidth||img.width,ih=img.naturalHeight||img.height;
    const dh=o.h?fs(o.h):fs(w)*ih/iw,dw=dh*iw/ih,dx=fx(x),dy=fy(bottom)-dh;
    layers.push({depth:fy(bottom)-4,draw:()=>{ctxFloor.imageSmoothingEnabled=false;ctxFloor.drawImage(img,dx,dy,dw,dh);}});
  }
  layers.push({depth:-99999,draw:()=>{
    const c=ctxFloor;
    const [sx,sy,sw,sh]=FLOOR_SCREEN;
    c.fillStyle='#2f64c8';c.fillRect(fx(sx),fy(sy),fs(sw),fs(14));c.fillStyle='#fff';c.fillRect(fx(sx),fy(sy+14),fs(sw),fs(sh-14));
    c.fillStyle='#fff';c.font='700 12px "Noto Sans TC",system-ui,sans-serif';c.textAlign='left';c.textBaseline='middle';c.fillText('影廳',fx(sx+3),fy(sy+7));
    c.fillStyle='#233';c.font='11px "Noto Sans TC",system-ui,sans-serif';c.textAlign='center';c.fillText('你發現了投影機的秘密！',fx(sx+sw/2),fy(sy+34));
  }});
  layers.push({depth:99998,draw:()=>{for(const [t,x,y] of FLOOR_LABELS)floorPill(ctxFloor,t,fx(x),fy(y));}});
  return layers;
}
let ctxFloor=null;

// 辦公室尋寶道具與介面素材（Codex 繪製，assets/office-treasure-v1.webp／.json：最終像素大小、3 px 黑外框）。
// 每個道具 64×64；藏起來的位置由每日種子決定（見 games/treasure-gen.js）。
export const TREASURE_ITEMS=[
  {id:'mug',name:'咖啡杯'},{id:'usb',name:'隨身碟'},{id:'sticky',name:'便利貼'},{id:'glasses',name:'眼鏡'},
  {id:'pencil',name:'鉛筆'},{id:'key',name:'鑰匙'},{id:'plant',name:'小盆栽'},{id:'swatch',name:'色票本'},
  {id:'stapler',name:'釘書機'},{id:'headphones',name:'耳機'},{id:'calculator',name:'計算機'},{id:'scissors',name:'剪刀'},
  {id:'tape',name:'膠帶台'},{id:'mouse',name:'滑鼠'},{id:'notebook',name:'筆記本'},{id:'camera',name:'小相機'}
];
const SPRITES={
  item_mug:[8,8,64,64],item_usb:[80,8,64,64],item_sticky:[152,8,64,64],item_glasses:[224,8,64,64],item_pencil:[296,8,64,64],item_key:[368,8,64,64],item_plant:[440,8,64,64],item_swatch:[512,8,64,64],
  item_stapler:[8,80,64,64],item_headphones:[80,80,64,64],item_calculator:[152,80,64,64],item_scissors:[224,80,64,64],item_tape:[296,80,64,64],item_mouse:[368,80,64,64],item_notebook:[440,80,64,64],item_camera:[512,80,64,64],
  fx_sparkle_a:[8,152,48,48],fx_sparkle_b:[64,152,48,48],fx_sparkle_c:[120,152,48,48],slot_empty:[176,152,48,48],slot_frame:[232,152,48,48],hint_btn:[8,208,120,44],hint_btn_off:[136,208,120,44]
};
const art={img:null,ready:false};
/** 載入素材圖（只載一次）；載入完成前 drawSprite 什麼都不畫。 */
export function loadTreasureArt(onReady){
  if(art.img)return art;
  const i=new Image();i.src=new URL('office-treasure-v1.webp?v=1',import.meta.url).href;art.img=i;
  (i.decode?i.decode():new Promise((ok,no)=>{i.onload=ok;i.onerror=no;})).then(()=>{art.ready=true;if(onReady)onReady();}).catch(()=>{});
  return art;
}
/** 把一個素材畫在 (x,y) 為左上角、寬 w 高 h（預設原大小）。 */
export function drawSprite(g,name,x,y,w,h){
  const r=SPRITES[name];if(!art.ready||!r)return;
  g.imageSmoothingEnabled=false;g.drawImage(art.img,r[0],r[1],r[2],r[3],Math.round(x),Math.round(y),Math.round(w??r[2]),Math.round(h??r[3]));
}
export const spriteSize=name=>{const r=SPRITES[name];return r?{w:r[2],h:r[3]}:{w:0,h:0};};

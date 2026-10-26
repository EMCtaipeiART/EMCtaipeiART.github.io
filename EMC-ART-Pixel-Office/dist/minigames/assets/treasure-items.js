// 辦公室尋寶道具像素圖（獨立素材檔）。每個 10×10，字母對應調色盤，'.' 透明。
// 配色沿用辦公室的深藍輪廓＋霧面色塊，不使用外部臨時圖片。
const P={k:'#182e54',w:'#ffffff',y:'#ffd24a',o:'#e8913a',r:'#d9534f',g:'#4caf6a',b:'#5b8def',s:'#aab4c4',t:'#8a5a3c',p:'#f4a6c0'};
export const TREASURE_ITEMS=[
  {id:'mug',name:'咖啡杯',rows:['..........','..sss.....','.kkkkkk...','.kwwwwkk..','.kwwwwk.k.','.kwwwwk.k.','.kwwwwkk..','.kkkkkk...','..kkkk....','..........']},
  {id:'usb',name:'隨身碟',rows:['..........','..........','.kkkkkkkk.','.kssssbbk.','.kssssbbk.','.kkkkkkkk.','.k.k......','..........','..........','..........']},
  {id:'sticky',name:'便利貼',rows:['..........','.kkkkkkkk.','.kyyyyyyk.','.kykkkkyk.','.kyyyyyyk.','.kykkkyyk.','.kyyyyyyk.','.kkkkkkyk.','........k.','..........']},
  {id:'glasses',name:'眼鏡',rows:['..........','..........','.kkkk.kkkk','.kwwk.kwwk','.kwwkkkwwk','.kkkk.kkkk','..........','..........','..........','..........']},
  {id:'pencil',name:'鉛筆',rows:['.........p','........pk','.......okk','......oo.k','.....oo...','....oo....','...oo.....','..koo.....','..kk......','..........']},
  {id:'key',name:'鑰匙',rows:['..........','.kkk......','k...k.....','k...kkkkkk','k...k.k.k.','.kkk..k.k.','..........','..........','..........','..........']},
  {id:'plant',name:'小盆栽',rows:['...g..g...','..ggggg...','...ggg....','...gkg....','..kttk....','..kttk....','..kttk....','...kk.....','..........','..........']},
  {id:'disk',name:'色票本',rows:['..........','.kkkkkkk..','.krgbyok..','.kkkkkkk..','.kwwwwwk..','.kwwwwwk..','.kwwwwwk..','.kkkkkkk..','..........','..........']}
];
export const PALETTE=P;
export function renderItem(def,doc=document){
  const c=doc.createElement('canvas');c.width=10;c.height=10;const g=c.getContext('2d');
  def.rows.forEach((row,y)=>{for(let x=0;x<row.length;x++){const col=P[row[x]];if(col){g.fillStyle=col;g.fillRect(x,y,1,1);}}});
  return c;
}

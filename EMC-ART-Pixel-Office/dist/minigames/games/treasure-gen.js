// 辦公室尋寶：每日道具位置生成（純函式，可單獨測試）。
// 同一天、同一種子 → 同一份候選順序；不在目前視窗內（點不到）的點會依序被下一個候選取代。
export const TREASURE_COUNT=5,TREASURE_SECONDS=120,FIND_POINTS=100,TIME_BONUS_PER_SEC=2,HINT_PENALTY=50;

/** 在場景裡以固定格距取樣可站立的空地，周圍 margin 內都不能碰到家具／牆。 */
export function floorCandidates({minX,maxX,minY,maxY,step=48,margin=24,isFree}){
  const out=[];
  for(let y=minY;y<=maxY;y+=step)for(let x=minX;x<=maxX;x+=step){
    if(!isFree(x,y))continue;
    if(![[-margin,0],[margin,0],[0,-margin],[0,margin]].every(([dx,dy])=>isFree(x+dx,y+dy)))continue;
    out.push({x,y});
  }
  return out;
}

/**
 * 依 rng 洗牌候選點與道具種類，挑出 count 個互相保持 minGap 距離、且 clickable(x,y) 為真的位置。
 * 回傳 [{type,x,y}]；候選不足時回傳較少的數量（呼叫端要處理）。
 */
export function pickTreasures({rng,candidates,types,count=TREASURE_COUNT,minGap=180,clickable=()=>true}){
  const order=rng.shuffle(candidates),kinds=rng.shuffle(types).slice(0,count),picked=[];
  for(const c of order){
    if(picked.length>=count)break;
    if(!clickable(c.x,c.y))continue;
    if(picked.some(p=>Math.hypot(p.x-c.x,p.y-c.y)<minGap))continue;
    picked.push({type:kinds[picked.length],x:c.x,y:c.y});
  }
  return picked;
}

/** 分數：找到 ×100；全部找到才有剩餘時間加成（每秒 +2）；用提示 −50；不低於 0。 */
export function treasureScore({found,total=TREASURE_COUNT,timeLeft=0,hintUsed=false}){
  const bonus=found>=total?Math.floor(Math.max(timeLeft,0))*TIME_BONUS_PER_SEC:0;
  return Math.max(0,found*FIND_POINTS+bonus-(hintUsed?HINT_PENALTY:0));
}

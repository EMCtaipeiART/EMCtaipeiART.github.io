// 個人紀錄與本機排行榜。只存在本機 localStorage；正式排行榜（Phase 2 起）由後端驗證。
// 遊戲資料與同事工作狀態分開，且不得用來評估績效。
const KEY='emc-minigames-v1';
export function createScoreStore(storage=globalThis.localStorage){
  const read=()=>{try{const v=JSON.parse(storage.getItem(KEY)||'{}');return v&&typeof v==='object'?v:{};}catch{return {};}};
  const write=data=>{try{storage.setItem(KEY,JSON.stringify(data));return true;}catch{return false;}};
  return {
    submit(gameId,{score,day,name='我'}){
      const data=read(),g=data[gameId]||(data[gameId]={best:0,plays:0,board:[]});
      const isBest=score>g.best;
      g.plays++;if(isBest)g.best=score;
      const entry={score,day,name,at:Date.now()};
      g.board.push(entry);
      g.board.sort((a,b)=>b.score-a.score||a.at-b.at);g.board.length=Math.min(g.board.length,10);
      write(data);
      return {isBest,best:g.best,plays:g.plays,rank:g.board.indexOf(g.board.find(r=>r.at===entry.at&&r.score===score))+1,board:g.board.slice()};
    },
    get(gameId){const g=read()[gameId];return g?{best:g.best,plays:g.plays,board:g.board.slice()}:{best:0,plays:0,board:[]};}
  };
}
// 計分輔助：連擊加分，各遊戲可自訂係數。
export function comboBonus(combo,per=10,cap=10){return Math.min(Math.max(combo-1,0),cap)*per;}

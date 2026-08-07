const SCORE_ROWS = [
  ['平面','提案','社群貼文',1],['平面','提案','視覺設計',2],['平面','提案','字體設計',2],
  ['平面','提案','色號設計',0],['平面','提案','素材參考',0],['平面','提案','預算參考',1],['平面','提案','急件',3],
  ...['場地勘景','分鏡腳本','演員選角','服裝道具','通告順場','製作統籌'].map(detail=>['平面','前製',detail,1]),
  ['平面','前製','急件',3],
  ...['監製','導演組','製片組','攝影組','燈光組','收音組','美術組','三妝組','場務組'].map(detail=>['平面','拍攝',detail,1]),
  ['平面','拍攝','急件',3],
  ['平面','後製','社群貼文',1],['平面','後製','廣告素材',1],['平面','後製','美術設計',1],
  ['平面','後製','影音包框',2],['平面','後製','修圖',0.5],['平面','後製','網站網頁',1],
  ['平面','後製','素材重置',0.5],['平面','後製','2D 動畫',2],['平面','後製','AI 影片',5],['平面','後製','急件',3],
  ['平面','印刷','前置設計',1],['平面','印刷','輸出完稿',1],['平面','印刷','急件',3],
  ...['腳本大綱','服裝參考','音樂參考','環境參考','影片參考','預算參考','時程參考'].map(detail=>['影音','提案',detail,1]),
  ['影音','提案','急件',3],
  ...['場地勘景','分鏡腳本','演員選角','服裝道具','通告順場','製作統籌'].map(detail=>['影音','前製',detail,1]),
  ['影音','前製','急件',3],
  ...['監製','導演組','製片組','攝影組','燈光組','收音組','美術組','三妝組','場務組'].map(detail=>['影音','拍攝',detail,1]),
  ['影音','拍攝','急件',3],
  ...['影音剪輯','調光調色','人聲配樂','視覺特效','字幕字卡','2D 動畫'].map(detail=>['影音','後製',detail,1]),
  ['影音','後製','急件',3],['影音','結案','預算結帳',1],['影音','結案','素材備份',1],
  ...['平面','動態','音樂','模板'].flatMap(stage=>['Shutterstock','Envato','Freepik'].map(detail=>['採購',stage,detail,0]))
];

export const DEFAULT_WEIGHT_RULE_ROWS = Object.freeze(SCORE_ROWS.map(([type,stage,detail,score])=>Object.freeze({
  '設計種類':type,
  '階段':stage,
  '項目細節':detail,
  '權重':String(score),
  '備註':''
})));

export function detailScoreMap(rules=DEFAULT_WEIGHT_RULE_ROWS) {
  const map=new Map();
  for(const rule of Array.isArray(rules)?rules:[]) {
    const type=normalizeDesignType(Array.isArray(rule)?rule[0]:rule?.['設計種類']);
    const stage=String(Array.isArray(rule)?rule[1]:rule?.['階段'] ?? '').trim();
    const detail=String(Array.isArray(rule)?rule[2]:rule?.['項目細節'] ?? '').trim();
    const score=Number(Array.isArray(rule)?rule[3]:rule?.['權重']);
    if(type&&stage&&detail&&Number.isFinite(score))map.set(`${type}\u0000${stage}\u0000${detail}`,score);
  }
  return map;
}

export const DETAIL_SCORE_MAP = detailScoreMap();

export function splitDetailValues(value) {
  return [...new Set(String(value ?? '').split(/\s*[,，、\n]\s*/).map(item=>item.trim()).filter(Boolean))];
}

export function normalizeDesignType(value) {
  const type=String(value ?? '').trim();
  if(['影片','影像','影音'].includes(type))return '影音';
  return type;
}

export function calculateWeight({type='',stage='',qty='',details='',rules=DEFAULT_WEIGHT_RULE_ROWS}={}) {
  const selected=splitDetailValues(details);
  if(!selected.length)return null;
  const normalizedType=normalizeDesignType(type),normalizedStage=String(stage ?? '').trim();
  const scoreMap=rules===DEFAULT_WEIGHT_RULE_ROWS?DETAIL_SCORE_MAP:detailScoreMap(rules);
  const regularScore=selected
    .filter(detail=>detail!=='急件')
    .reduce((sum,detail)=>sum+(scoreMap.get(`${normalizedType}\u0000${normalizedStage}\u0000${detail}`) ?? 0),0);
  const urgentScore=selected.includes('急件')
    ? (scoreMap.get(`${normalizedType}\u0000${normalizedStage}\u0000急件`) ?? 3)
    : 0;
  const quantity=Number(String(qty ?? '').replace(/,/g,''));
  const weighted=(Number.isFinite(quantity)?quantity:0)*regularScore+urgentScore;
  return Number(weighted.toFixed(4));
}

export function applyWeightToRow(row={},rules=DEFAULT_WEIGHT_RULE_ROWS) {
  const weight=calculateWeight({
    type:row['設計種類'] ?? row['設計類型'] ?? row['設計總類'],
    stage:row['階段'],
    qty:row['數量'],
    details:row['項目細節'],
    rules
  });
  row['加權']=weight===null?'':String(weight);
  return row;
}

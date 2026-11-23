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

/** 「項目數量」：各項目細節各自的數量（JSON，例如 {"廣告素材":4,"影音包框":1}）。沒列到的項目沿用案件總數量。 */
export function parseDetailQty(value) {
  let parsed=value;
  if(typeof value==='string'){try{parsed=JSON.parse(value||'{}')}catch{return {}}}
  if(!parsed||typeof parsed!=='object'||Array.isArray(parsed))return {};
  const out={};
  for(const [name,raw] of Object.entries(parsed)){
    const n=Number(String(raw??'').replace(/,/g,''));
    if(name&&Number.isFinite(n)&&n>=0)out[String(name).trim()]=n;
  }
  return out;
}

/** 各項目細節實際採用的數量（「項目數量」規範，詳見 CLAUDE.md「項目數量計分規範」）：
 * 1. 只勾 1 個項目（急件不算項目）→ 該項目 = 案件總數量，項目數量欄位被忽略。
 * 2. 勾 2 個以上：項目數量必須「每個勾選項目都有填」才採用；各項目件數合計 ≠ 總數量時，等比例縮放成總數量。
 * 3. 欄位缺項／壞掉／合計為 0 → 視為沒填，每個項目都乘總數量（舊案件的行為）。 */
export function resolveDetailQuantities(selected, totalQty, detailQty) {
  const items=(Array.isArray(selected)?selected:[]).filter(d=>d!=='急件');
  const out={};
  for(const d of items)out[d]=totalQty;
  if(items.length<2)return out;
  const map=parseDetailQty(detailQty);
  if(!items.every(d=>map[d]!==undefined))return out;
  const sum=items.reduce((n,d)=>n+map[d],0);
  if(!(sum>0))return out;
  const ratio=totalQty/sum;
  for(const d of items)out[d]=Number((map[d]*ratio).toFixed(4));
  return out;
}

export function calculateWeight({type='',stage='',qty='',details='',detailQty='',rules=DEFAULT_WEIGHT_RULE_ROWS}={}) {
  const selected=splitDetailValues(details);
  if(!selected.length)return null;
  const normalizedType=normalizeDesignType(type),normalizedStage=String(stage ?? '').trim();
  const scoreMap=rules===DEFAULT_WEIGHT_RULE_ROWS?DETAIL_SCORE_MAP:detailScoreMap(rules);
  const quantity=Number(String(qty ?? '').replace(/,/g,''));
  const totalQty=Number.isFinite(quantity)?quantity:0;
  const perDetail=resolveDetailQuantities(selected,totalQty,detailQty);
  const weightedSum=selected
    .filter(detail=>detail!=='急件')
    .reduce((sum,detail)=>sum+(scoreMap.get(`${normalizedType}\u0000${normalizedStage}\u0000${detail}`) ?? 0)*(perDetail[detail]!==undefined?perDetail[detail]:totalQty),0);
  const urgentMultiplier=selected.includes('急件')
    ? (scoreMap.get(`${normalizedType}\u0000${normalizedStage}\u0000急件`) ?? 3)
    : 1;
  const weighted=weightedSum*urgentMultiplier;
  return Number(weighted.toFixed(4));
}

export function applyWeightToRow(row={},rules=DEFAULT_WEIGHT_RULE_ROWS) {
  const weight=calculateWeight({
    type:row['設計種類'] ?? row['設計類型'] ?? row['設計總類'],
    stage:row['階段'],
    qty:row['數量'],
    details:row['項目細節'],
    detailQty:row['項目數量'],
    rules
  });
  row['加權']=weight===null?'':String(weight);
  return row;
}

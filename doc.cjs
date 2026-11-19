const fs = require('fs');
function app(f, t) { const nl = fs.readFileSync(f, 'utf8').includes('\r\n') ? '\r\n' : '\n'; fs.appendFileSync(f, t.replace(/\n/g, nl)); }
function edit(p, fn) { let s = fs.readFileSync(p, 'utf8'); const nl = s.includes('\r\n') ? '\r\n' : '\n'; s = fn(s, t => t.replace(/\r?\n/g, nl)); fs.writeFileSync(p, s); }

app('MAINTENANCE_LOG.md', `
## 2026-11-19 小黃：修正「這禮拜有沒有人請假」答成沒有（日期與週範圍）
- **現象**：使用者問「這禮拜有沒有人請假」，小黃回「這週（11/19～11/25）都沒有請假」，但行事曆上這週二（11/17）Anna 有人資假單。
- **原因（已用後台「試問」在正式站重現）**：①\`getCalendar\` 沒給日期時預設「今天起 7 天」，小黃把「這禮拜」當成這個範圍，漏掉本週已經過去的日子（週一到昨天）；②模型本身不知道今天幾號，system prompt 也沒有日期，容易把「今天、這週、去年」算錯。
- **修正**：\`getCalendar\` 新增 \`week\`（this／next／last＝台灣時間週一到週日，**含已過去的日子**），工具說明與 prompt 明確規定「這週／本週／這禮拜」用 \`week=this\`；每次請求的 system 加第二段「現在是台灣時間 YYYY-MM-DD（週X）；這週＝週一到週日…」（\`todayLine()\`，每次不同所以**不放進快取區塊**，固定規則那一段仍然快取）；工具結果也回傳「今天」與實際查詢範圍。這同時修正了「去年／今年／本月」等需要知道今天日期的問題。
- 測試：\`assistant-calendar.test.ts\` 新增回歸測試（週一到週日計算、週日仍算這週、重現「預設範圍漏掉週二休假、week=this 找得到」、prompt 含今天與週範圍）；既有的 system 區塊測試改為兩段。
- **教訓**：給模型的工具只要有「相對日期」（這週、下週、去年），一定要同時給它今天日期，並在工具層提供 week／month 這類明確參數，不要讓模型自己算日期。
`);
edit('ASSISTANT.md', (s, t) => {
  const b = "可見範圍過濾（`canViewCase`）";
  if (!s.includes(b)) throw new Error('anchor ASSISTANT.md');
  return s.replace(b, () => "**日期規則**：每次請求的 system 第二段會帶「現在是台灣時間…、這週＝週一到週日」（`todayLine()`，不進快取區塊）；查行事曆的「這週／下週／上週」請用 `getCalendar` 的 `week`（含已過去的日子），不要靠模型自己算日期。" + t("

") + b);
});
console.log('ok');

// 項目細節教學影片的旁白：用 macOS 內建「美佳」(zh_TW) 語音產生 WAV。
// 每句旁白 = { at: 教學頁時間軸毫秒, text }；錄影時依 at 播放。用法：node tools/tutorial-item-qty-voice.mjs <輸出資料夾>
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const SCALE = 0.5; // 時間軸整體加速倍率（0.5＝兩倍速）
export const SAY_RATE = 285;
export const NARRATION = [
  { at: 300, text: '這支影片教你，怎麼分開填各項件數。' },
  { at: 3600, text: '情境一，案件共五件，四張廣告素材，一支影音包框。' },
  { at: 9200, text: '只勾一個項目，件數就是全部五件，分數五分。' },
  { at: 14200, text: '再勾第二個項目，系統會先平均分配，加總永遠等於案件總數五件。' },
  { at: 22500, text: '廣告素材改四件，影音包框自動變一件。分數四加二，等於六分。' },
  { at: 27600, text: '下拉只能選合理範圍，不會選到零，也不會超過總數。' },
  { at: 35700, text: '按確認，卡牌就會顯示各項件數，分數一併存進系統。' },
  { at: 41600, text: '情境二，三十七件作物輸出，每件都做了前置設計和輸出完稿。' },
  { at: 46500, text: '勾兩項之後，系統先分成十九加十八，只有三十七分，會少算。' },
  { at: 53200, text: '這時勾選，每個項目都做了全部三十七件，分數就是三十七乘一，加三十七乘一，等於七十四分。' },
  { at: 65100, text: '記住三件事。只勾一項，是全部件數。不同成品，用下拉分配。同一批件數做多道工序，勾每個項目都做了全部。' }
];

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const out = process.argv[2];
  if (!out) throw new Error('請給輸出資料夾');
  fs.mkdirSync(out, { recursive: true });
  const durs = [];
  NARRATION.forEach((n, i) => {
    const f = path.join(out, `v${i}.wav`);
    const r = spawnSync('say', ['-v', 'Meijia', '-r', String(SAY_RATE), '--data-format=LEI16@22050', '-o', f, n.text]);
    if (r.status !== 0) throw new Error('say 失敗：' + r.stderr);
    const buf = fs.readFileSync(f);
    const rate = 22050, dataAt = buf.indexOf('data') + 8, dataLen = buf.length - dataAt;
    const sec = dataLen / (rate * 2);
    const next = NARRATION[i + 1] ? NARRATION[i + 1].at * SCALE : 74000 * SCALE;
    durs[i] = sec;
    console.log(i, 'at', n.at * SCALE, '長', sec.toFixed(1) + 's', '空檔', ((next - n.at * SCALE) / 1000).toFixed(1) + 's', sec * 1000 > next - n.at * SCALE ? '⚠ 超出' : 'ok');
  });
  // 旁白比原定空檔長時，把後面的時間軸整體往後推；結果存成 json，教學頁與錄影共用。
  let shift = 0; const shifts = [], starts = [];
  NARRATION.forEach((n, i) => {
    const start = n.at * SCALE + shift; starts.push(start);
    const end = start + durs[i] * 1000 + 600;
    const nextOrig = NARRATION[i + 1] ? NARRATION[i + 1].at * SCALE : null;
    if (nextOrig !== null) {
      const nextStart = nextOrig + shift;
      if (end > nextStart) { const add = Math.ceil(end - nextStart); shift += add; shifts.push({ from: nextOrig, add }); }
    }
  });
  const lastEnd = starts[starts.length - 1] + durs[durs.length - 1] * 1000 + 2500;
  const json = { scale: SCALE, narration: NARRATION.map((n, i) => ({ at: n.at, start: starts[i], dur: Number(durs[i].toFixed(2)), text: n.text })), shifts, endExtra: Math.max(0, Math.ceil(lastEnd - (74000 * SCALE + shift))) , totalShift: shift };
  fs.writeFileSync(new URL('../tutorial/item-qty-voice.json', import.meta.url), JSON.stringify(json, null, 1));
  console.log('shifts', JSON.stringify(shifts), '總長約', ((74000 * SCALE + shift + json.endExtra) / 1000).toFixed(0) + 's');
}

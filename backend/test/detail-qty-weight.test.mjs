import assert from 'node:assert/strict';
import test from 'node:test';
import { calculateWeight, applyWeightToRow, parseDetailQty } from '../weighting.mjs';

const rules = [
  { '設計種類': '平面', '階段': '新製', '項目細節': '廣告素材', '權重': '1' },
  { '設計種類': '平面', '階段': '新製', '項目細節': '影音包框', '權重': '2' },
  { '設計種類': '平面', '階段': '新製', '項目細節': '急件', '權重': '3' }
];
const base = { type: '平面', stage: '新製', qty: 5, rules };

test('沒填各項目數量時，每個項目都乘案件總數量（舊行為不變）', () => {
  assert.equal(calculateWeight({ ...base, details: '廣告素材' }), 5);
  assert.equal(calculateWeight({ ...base, details: '廣告素材, 影音包框' }), 15);
});

test('各項目分開填數量：4 張廣告素材＋1 支影音包框 = 4×1 + 1×2 = 6；沒列到的項目沿用總數量', () => {
  const dq = '{"廣告素材":4,"影音包框":1}';
  assert.equal(calculateWeight({ ...base, details: '廣告素材, 影音包框', detailQty: dq }), 6);
  assert.equal(calculateWeight({ ...base, details: '廣告素材, 影音包框', detailQty: '{"影音包框":1}' }), 7);
});

test('急件仍是整案倍數；取消勾選的項目的數量不會被計入；壞掉的 JSON 當成沒填', () => {
  const dq = { 廣告素材: 4, 影音包框: 1 };
  assert.equal(calculateWeight({ ...base, details: '廣告素材, 影音包框, 急件', detailQty: dq }), 18);
  assert.equal(calculateWeight({ ...base, details: '廣告素材', detailQty: dq }), 4);
  assert.deepEqual(parseDetailQty('不是JSON'), {});
  assert.equal(calculateWeight({ ...base, details: '廣告素材', detailQty: '壞掉' }), 5);
});

test('applyWeightToRow 讀「項目數量」欄', () => {
  const row = { '設計種類': '平面', '階段': '新製', '數量': '5', '項目細節': '廣告素材, 影音包框', '項目數量': '{"廣告素材":4,"影音包框":1}' };
  assert.equal(applyWeightToRow(row, rules)['加權'], '6');
});

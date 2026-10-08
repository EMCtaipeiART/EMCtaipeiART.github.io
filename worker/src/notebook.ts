/**
 * 記事本：設計部的資源筆記（AI 工具、素材網站、廠商資訊…，含共用帳號密碼）。
 * 資料存在 Worker 自己的資料庫（Durable Object SQLite），不放進公開的 GitHub 倉庫；
 * 後端檢查登入與權限後才回傳或修改。第一次使用時，從原本的 Google 試算表「EMC設計部資源」匯入一次，之後完全在網站內編輯。
 */
export const NOTEBOOK_SHEET_ID = '1x8K9kw46NzY65B2tNRbAIu8f1cwFZ4uJ7HyU2Q7JjLU';
export const NOTEBOOK_SEED_TABS: Array<{ gid: string; category: string; layout: 'columns' | 'vendors' }> = [
  { gid: '0', category: 'AI 工具與素材', layout: 'columns' },
  { gid: '1529630212', category: '廠商資訊', layout: 'vendors' }
];

export interface NotebookField { label: string; value: string; secret: boolean }
export interface NotebookSeed { category: string; section: string; title: string; fields: NotebookField[] }
export interface NotebookItem extends NotebookSeed { id: string; sort: number; updatedAt: number; updatedBy: string }

export function notebookCsvUrl(gid: string): string {
  return `https://docs.google.com/spreadsheets/d/${NOTEBOOK_SHEET_ID}/gviz/tq?tqx=out:csv&gid=${encodeURIComponent(gid)}`;
}

/** RFC 4180 的 CSV 解析（支援引號、引號內換行與雙引號跳脫） */
export function parseCsv(input: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [], cell = '', quoted = false;
  const text = input.replace(/^﻿/, '');
  for (let i = 0; i < text.length; i += 1) {
    const ch = text[i];
    if (quoted) {
      if (ch === '"') {
        if (text[i + 1] === '"') { cell += '"'; i += 1; } else quoted = false;
      } else cell += ch;
    } else if (ch === '"') quoted = true;
    else if (ch === ',') { row.push(cell); cell = ''; }
    else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && text[i + 1] === '\n') i += 1;
      row.push(cell); rows.push(row); row = []; cell = '';
    } else cell += ch;
  }
  if (cell !== '' || row.length) { row.push(cell); rows.push(row); }
  return rows;
}

/** 去掉結尾全空的列與欄，欄數補齊成一樣寬 */
export function trimGrid(rows: string[][]): string[][] {
  let last = rows.length;
  while (last > 0 && rows[last - 1].every(cell => !cell.trim())) last -= 1;
  const kept = rows.slice(0, last);
  const width = kept.reduce((max, row) => {
    let w = row.length;
    while (w > 0 && !row[w - 1].trim()) w -= 1;
    return Math.max(max, w);
  }, 0);
  return kept.map(row => Array.from({ length: width }, (_, i) => row[i] ?? ''));
}

const isSecretLabel = (label: string): boolean => /^(密碼|password|pwd)$/i.test(label.trim());
const field = (label: string, value: string): NotebookField | null => {
  const v = String(value ?? '').trim(), l = String(label ?? '').trim();
  return v && l ? { label: l, value: v, secret: isSecretLabel(l) } : null;
};
const compact = (list: Array<NotebookField | null>): NotebookField[] => list.filter((f): f is NotebookField => Boolean(f));

/** 版面 A：一個區塊標題列、下一列是各欄的名稱，之後每列是「標籤＋各欄的值」（AI 工具與素材那一頁） */
export function parseColumnLayout(rows: string[][], category: string): NotebookSeed[] {
  const out: NotebookSeed[] = [];
  let section = '';
  let columns: Array<NotebookSeed | null> | null = null;
  for (const row of rows) {
    const filled = row.filter(cell => cell.trim()).length;
    const label = (row[0] || '').trim();
    if (filled === 1 && label) { section = label; columns = null; continue; }
    if (!label && filled > 0 && !columns) {
      columns = row.map((name, i) => {
        if (i === 0 || !name.trim()) return null;
        const item: NotebookSeed = { category, section, title: name.trim(), fields: [] };
        out.push(item);
        return item;
      });
      continue;
    }
    if (label && columns) row.forEach((value, i) => { const f = columns && columns[i] ? field(label, value) : null; if (f && columns && columns[i]) columns[i]!.fields.push(f); });
  }
  return out.filter(item => item.fields.length || item.title);
}

const VENDOR_LABELS = new Set(['網址', '所屬公司', '會員', '帳號', '密碼', '使用信箱', '備註', '預約方式', '預約格式', '消費紀錄', '項目', '姓名', '信箱', '手機', '公司名稱', '公司電話', '地址']);

/** 版面 B：廠商資訊那一頁（左邊直式區塊、右邊另一組區塊，第一列的標題與標籤擠在同一格），依這份表格的實際排列解析 */
export function parseVendorLayout(rows: string[][], category: string): NotebookSeed[] {
  const out: NotebookSeed[] = [];
  const cell = (r: number, c: number) => String(rows[r]?.[c] ?? '').trim();
  const tokens = (s: string) => s.split(/\s+/).filter(Boolean);

  // 第一段：印刷資訊（第 0 列的標題格＋三家廠商分在欄 1~3；密碼、使用信箱、項目在第 1~3 列）
  const head = cell(0, 0).match(/^印刷資訊\s*(.*?)\s*網址\s*所屬公司\s*帳號\s*$/);
  if (head) {
    const first = tokens(cell(0, 1));
    out.push({ category, section: '印刷資訊', title: head[1] || '印刷廠商', fields: compact([field('網址', first[0] || ''), field('所屬公司', first[1] || ''), field('帳號', first[2] || ''), field('密碼', cell(1, 1)), field('使用信箱', cell(2, 1)), field('項目', cell(3, 1))]) });
    for (const c of [2, 3]) {
      const t = tokens(cell(0, c));
      if (!t.length) continue;
      out.push({ category, section: '印刷資訊', title: t[0], fields: compact([field('帳號', t[1] || ''), field('密碼', cell(1, c)), field('使用信箱', cell(2, c)), field('項目', cell(3, c))]) });
    }
  }

  // 直式區塊：標題列（該欄只有標題、旁邊沒有值）＋ 標籤／值 列，直到下一個標題
  const vertical = (labelCol: number, valueCol: number, from: number, section: string, start: NotebookSeed | null = null) => {
    let item: NotebookSeed | null = start;
    for (let r = from; r < rows.length; r += 1) {
      const label = cell(r, labelCol), value = cell(r, valueCol);
      if (!label) continue;
      if (!VENDOR_LABELS.has(label) && !value) { item = { category, section, title: label, fields: [] }; out.push(item); continue; }
      if (item) { const f = field(label, String(rows[r]?.[valueCol] ?? '')); if (f) item.fields.push(f); }
    }
  };
  vertical(0, 1, 4, '印刷資訊');

  // 右邊：影像器材租借
  const rhead = cell(0, 5).match(/^影像器材租借資訊\s*(.*?)\s*網址\s*所屬公司\s*會員\s*$/);
  if (rhead) {
    const t = tokens(cell(0, 6));
    const item: NotebookSeed = { category, section: '影像器材租借', title: rhead[1] || '器材租借', fields: compact([field('網址', t[0] || ''), field('所屬公司', t[1] || ''), field('會員', t[2] || '')]) };
    out.push(item);
    vertical(5, 6, 1, '影像器材租借', item);
  }
  return out.filter(item => item.fields.length);
}

export function seedFromGrids(grids: Array<{ gid: string; rows: string[][] }>): NotebookSeed[] {
  const out: NotebookSeed[] = [];
  for (const tab of NOTEBOOK_SEED_TABS) {
    const grid = grids.find(g => g.gid === tab.gid);
    if (!grid) continue;
    out.push(...(tab.layout === 'columns' ? parseColumnLayout(grid.rows, tab.category) : parseVendorLayout(grid.rows, tab.category)));
  }
  return out;
}

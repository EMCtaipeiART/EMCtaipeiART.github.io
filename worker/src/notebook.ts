/**
 * 記事本：把「EMC設計部資源」Google 試算表（AI 工具、素材、廠商資訊，內含共用帳號密碼）顯示在網站裡。
 * 由 Worker 在伺服器端讀取並檢查登入與權限後才回傳；內容不會放進公開的 GitHub 資料庫。
 */
export const NOTEBOOK_SHEET_ID = '1x8K9kw46NzY65B2tNRbAIu8f1cwFZ4uJ7HyU2Q7JjLU';
export const NOTEBOOK_TABS: Array<{ gid: string; name: string }> = [
  { gid: '0', name: 'AI 工具與素材' },
  { gid: '1529630212', name: '廠商資訊' }
];

export function notebookSheetUrl(gid = '0'): string {
  return `https://docs.google.com/spreadsheets/d/${NOTEBOOK_SHEET_ID}/edit?gid=${gid}#gid=${gid}`;
}

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

import { parseCsv } from './notebook';

/**
 * 專案分配表（客戶別）：每位設計師負責哪些客戶、專案所屬團隊、每月維運量與備註。
 * 第一次使用時從 Google 試算表匯入一次，之後在網站內編輯；內容存在 Worker 資料庫。
 */
export const ASSIGN_SHEET_ID = '1dwCq1ZGbhTfPxzNxsIHaWdoeUIhEjtEpI4vTnlH-euo';
export const assignCsvUrl = (): string => `https://docs.google.com/spreadsheets/d/${ASSIGN_SHEET_ID}/gviz/tq?tqx=out:csv&gid=0`;

export interface Assignment { id: string; designer: string; team: string; client: string; monthly: string; note: string; sort: number }
export interface AssignmentSeed { designer: string; team: string; client: string; monthly: string; note: string }

/** 解析：第 1 欄有名字且第 2 欄是「專案所屬」的列是設計師區塊標題；之後每列 第2欄=所屬、第3欄=客戶、倒數第2欄=每月維運、最後欄=備註 */
export function parseAssignments(rows: string[][]): AssignmentSeed[] {
  const out: AssignmentSeed[] = [];
  let designer = '';
  for (const row of rows) {
    const c = (i: number) => String(row[i] ?? '').trim();
    if (c(1) === '專案所屬') { designer = c(0); continue; }
    if (!designer || designer === '外發' || !c(2)) continue;
    const last = row.length;
    out.push({ designer, team: c(1), client: c(2), monthly: c(last - 2), note: c(last - 1) });
  }
  return out;
}

export const seedAssignments = (csv: string): AssignmentSeed[] => parseAssignments(parseCsv(csv));

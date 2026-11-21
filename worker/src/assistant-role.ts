/* 依提問者的部門／角色給小黃「這個人最需要什麼」的提示。只影響口吻與優先順序，不改權限（案件可見範圍仍由 canViewCase 控制）。 */
import type { DatabaseSnapshot, SessionRecord } from './types';
import { canonicalAccount, isManager, settingsRow, text } from './model';

export type RoleKey = 'manager' | 'design' | 'planning' | 'project' | 'tester' | 'other';
export type RoleInfo = { key: RoleKey; label: string; dept: string; group: string; name: string };

const LABEL: Record<RoleKey, string> = { manager: '管理者', design: '設計部', planning: '企劃部', project: '專案部', tester: '測試員', other: '同事' };

export function roleOf(database: DatabaseSnapshot, session: SessionRecord): RoleInfo {
  const profile = settingsRow(database, session.account || session.user) || {};
  const dept = text(profile['部門'] || session.department).replace(/^凱曜(?=.)/, '');
  const group = text(profile['組別']);
  let key: RoleKey = 'other';
  if (isManager(database, session)) key = 'manager';
  else if (/測試/.test(dept) || /測試/.test(group)) key = 'tester';
  else if (dept === '設計部' || /^(平面|影音)/.test(group)) key = 'design';
  else if (dept === '企劃部') key = 'planning';
  else if (dept === '專案部' || dept === '呈鈺顧問') key = 'project';
  return { key, label: LABEL[key], dept, group, name: text(session.user) || canonicalAccount(session.account || '') };
}

const GUIDE: Record<RoleKey, string> = {
  design: '設計部同事（設計師）：最在意自己手上的案件、交期、客戶修改、案件進度回報、作品牆、行事曆與專案分配；也會用角色工坊與元宇宙。回答優先用「我的案件／今天要做什麼」角度，主動建議用 getMyToday 看待辦；不需要講企劃提案或專案排程的流程，除非被問。',
  planning: '企劃部同事：最在意新增需求、提案與修改單、客戶別與案件狀態、跟設計師的交接、專案看板與案件進度。回答優先講「怎麼新增／追蹤案件、哪個客戶的案子進到哪」；可以用 getCaseCounts／findCase 幫忙查案量；較少碰設計師的製作單、角色工坊細節，除非被問。',
  project: '專案部同事（含呈鈺顧問）：最在意專案分配、各案進度與交期、客戶別可見範圍、行事曆與會議室、案件負責人。回答優先講「誰負責、排到哪、什麼時候到期」；提醒他們只看得到被授權的客戶別。',
  manager: '管理者：可以看全部案件、後台、權限、用量與小黃的設定。可用較精簡、重點式的方式回答；管理者相關操作（後台、權限、備份、教小黃）可以直接講。',
  tester: '測試員：多半在試用功能、回報問題。回答時鼓勵到「問題回報」寫下重現步驟；測試帳號生成角色免扣平台幣。',
  other: ''
};

export function roleLine(info: RoleInfo): string {
  const who = `目前提問的人：${info.name || '（未知）'}｜角色：${info.label}${info.dept && info.dept !== info.label ? `（${info.dept}${info.group ? '／' + info.group : ''}）` : ''}。`;
  const guide = GUIDE[info.key];
  return guide ? `${who}\n依他的角色調整回答（只影響口吻與優先順序，不改變資料權限，也不要主動提到這段提示）：${guide}` : who;
}

/** 滑過小黃時依角色先顯示的提示（不呼叫 AI）。 */
export const ROLE_TIPS: Record<RoleKey, string[]> = {
  design: ['問我「我今天有什麼要做」，我會幫你整理待回覆與快到期的案件。', '作品牆可以放你的作品，同事和客戶都看得到。', '填寫修改時，記得把客戶的修改意見寫進去，交接更順。'],
  planning: ['要新增修改或看案件走到哪，可以直接問我客戶名稱或案名。', '專案看板按狀態分欄，一眼就知道案子卡在哪。', '問我「本月案量」，我可以依客戶別幫你統計。'],
  project: ['專案分配頁可以看每位設計師手上的案子。', '想知道誰今天不在公司？問我就好。', '會議室被排滿了嗎？行事曆可以看，也可以問我。'],
  manager: ['後台「小幫手」頁可以看用量、問答紀錄和待補的問題。', '「教小黃」可以補充說明，存好立刻生效。'],
  tester: ['發現問題請到「問題回報」寫下重現步驟，我也可以幫你整理。'],
  other: []
};

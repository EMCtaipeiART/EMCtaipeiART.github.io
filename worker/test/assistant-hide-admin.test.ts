import { describe, expect, it } from 'vitest';
import { ASSISTANT_SYSTEM_PROMPT, knowledgeIndexForTest } from './helpers-hide';
import { KNOWLEDGE_TOPICS } from '../src/assistant-knowledge';
import { isAdminOnly, parseChangeLog, parseCommits } from '../src/assistant-changes';

describe('小黃不呈現後台與管理者專屬的內容', () => {
  it('filters admin / backend / maintenance changes out of the changelog and the commit list, before picking the newest ones', () => {
    const log = [
      '# 修改紀錄', '',
      '## 2026-11-15 午餐地圖新增篩選', '- 使用者看得到的功能', '',
      '## 2026-11-17 後台新增小黃追蹤頁', '- 管理者專屬', '',
      '## 2026-11-18 小黃：管理者不受每日限制', '- 管理者專屬', '',
      '## 2026-11-18 教小黃與試問框', '- 管理者專屬', '',
      '## 2026-11-19 Worker 部署與測試補強', '- 內部', '',
      '## 2026-11-19 個人設定新增深色模式切換', '- 使用者看得到', ''
    ].join('\n');
    expect(parseChangeLog(log, 2).map(s => s.title)).toEqual(['2026-11-19 個人設定新增深色模式切換', '2026-11-15 午餐地圖新增篩選']);
    const commits = [
      { commit: { message: 'feat: 後台新增小黃追蹤頁', committer: { date: '2026-11-19T01:00:00Z' } } },
      { commit: { message: 'feat: 午餐地圖新增篩選', committer: { date: '2026-11-19T02:00:00Z' } } },
      { commit: { message: 'fix: wrangler deploy 設定', committer: { date: '2026-11-19T03:00:00Z' } } }
    ];
    expect(parseCommits(commits).map(c => c.subject)).toEqual(['feat: 午餐地圖新增篩選']);
    expect(isAdminOnly('專案看板可以拖曳改狀態')).toBe(false);
    expect(isAdminOnly('管理者專用的用量查看')).toBe(true);
  });

  it('keeps backend and admin-only descriptions out of the built-in knowledge and the knowledge index', () => {
    const all = KNOWLEDGE_TOPICS.map(t => [t.title, t.summary, t.body].join('\n')).join('\n');
    for (const banned of ['資料庫後台', 'json_database_admin', '全員上班／全員下班', '管理者工具', '修改全公司預設位置', '管理者會多一步', '系統公告欄」發布']) {
      expect(all).not.toContain(banned);
    }
    expect(knowledgeIndexForTest()).not.toContain('管理者');
  });

  it('tells the model not to present or explain backend and admin-only things', () => {
    expect(ASSISTANT_SYSTEM_PROMPT).toContain('後台（資料庫後台）與管理者專屬的功能、設定與更動，你不需要呈現或說明');
  });
});

describe('小黃自己的運作機制也不當成「系統更新」呈現', () => {
  it('drops bubble / news / quota / battery / persona entries from the changelog and commits, keeps ordinary features', () => {
    const log = [
      '# 修改紀錄', '',
      '## 2026-11-10 午餐地圖新增篩選', '- 一般功能', '',
      '## 2026-11-15 小黃：新聞與設計議題主動彈出泡泡', '- 小黃自己的機制', '',
      '## 2026-11-16 小黃：電量用完時頭像變成充電中的電池', '- 小黃自己的機制', '',
      '## 2026-11-17 滑過氣泡與新聞話題', '- 小黃自己的機制', '',
      '## 2026-11-18 每日額度調整', '- 小黃自己的機制', '',
      '## 2026-11-19 行事曆新增值日生提醒', '- 一般功能', ''
    ].join('\n');
    expect(parseChangeLog(log, 5).map(x => x.title)).toEqual(['2026-11-19 行事曆新增值日生提醒', '2026-11-10 午餐地圖新增篩選']);
    const commits = [
      { commit: { message: 'feat: 小黃主動彈出新聞泡泡', committer: { date: '2026-11-19T01:00:00Z' } } },
      { commit: { message: 'feat: 行事曆新增值日生提醒', committer: { date: '2026-11-19T02:00:00Z' } } },
      { commit: { message: 'fix: 額度用完顯示電池', committer: { date: '2026-11-19T03:00:00Z' } } }
    ];
    expect(parseCommits(commits).map(c => c.subject)).toEqual(['feat: 行事曆新增值日生提醒']);
    for (const t of ['新聞與設計議題主動彈出泡泡', '小幫手改版', '機器人頭像', '額度提醒', '充電中的電池']) expect(isAdminOnly(t)).toBe(true);
    expect(isAdminOnly('午餐地圖新增篩選')).toBe(false);
  });
});

import { isAdminOnly as __isAdminOnly } from '../src/assistant-changes';
import { it as __it, expect as __expect } from 'vitest';
__it('英文 admin／password 類 commit 也不會出現在泡泡', () => {
  __expect(__isAdminOnly('lens-shop: fix admin password input (onkeydown returned false), add Worker source to repo')).toBe(true);
});

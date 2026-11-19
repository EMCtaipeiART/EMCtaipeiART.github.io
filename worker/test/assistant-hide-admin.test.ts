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
      '## 2026-11-19 個人設定可關閉小黃', '- 使用者看得到', ''
    ].join('\n');
    expect(parseChangeLog(log, 2).map(s => s.title)).toEqual(['2026-11-19 個人設定可關閉小黃', '2026-11-15 午餐地圖新增篩選']);
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

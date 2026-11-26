import { describe, expect, it } from 'vitest';
import { ASSISTANT_SYSTEM_PROMPT } from '../src/assistant';
import { KNOWLEDGE_TOPICS, lookupKnowledge } from '../src/assistant-knowledge';

describe('小黃知道自己的設定（怎麼關閉、NEW 標籤…）', () => {
  it('has the turn-off instructions straight in the prompt, so he never answers "no permission, ask an admin"', () => {
    expect(ASSISTANT_SYSTEM_PROMPT).toContain('個人設定');
    expect(ASSISTANT_SYSTEM_PROMPT).toContain('右下角小幫手');
    expect(ASSISTANT_SYSTEM_PROMPT).toContain('不要說沒權限');
    expect(ASSISTANT_SYSTEM_PROMPT).toContain('同仁自己就能做的事');
    expect(ASSISTANT_SYSTEM_PROMPT).toContain('× 只是先把視窗收成小圖示');
  });

  it('finds the "about 小黃" topic for questions about closing, hiding and the NEW tag', () => {
    for (const q of ['可以把你關閉嗎', '怎麼讓小黃不要出現', '右下角那個機器人可以關掉嗎', 'NEW 標籤是什麼', '小黃能做什麼']) {
      const hits = lookupKnowledge(q).topics.map(t => t.id);
      expect(hits, q).toContain('assistant');
    }
    const body = KNOWLEDGE_TOPICS.find(t => t.id === 'assistant')!.body;
    expect(body).toContain('個人設定');
    expect(body).toContain('右下角小幫手');
    expect(body).not.toContain('後台');
  });
});

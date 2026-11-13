import { env } from 'cloudflare:workers';
import { describe, expect, it } from 'vitest';

const stub = () => (env.MINIGAME_BOARD as any).getByName('primary');

describe('設計部遠征隊排行榜', () => {
  it('提交後上榜，同名只留最高分，並依分數排序', async () => {
    const s = stub();
    expect((await s.expSubmit({ nick: 'A', score: 8000, secs: 200, ip: '1.1.1.1' })).status).toBe(200);
    await s.expSubmit({ nick: 'A', score: 9000, secs: 180, ip: '1.1.1.1' });
    const r = await s.expSubmit({ nick: 'B', score: 9500, secs: 170, ip: '2.2.2.2' });
    expect(r.body.rows.map((x: any) => x.nick)).toEqual(['B', 'A']);
    expect(r.body.rows[1].score).toBe(9000);
    expect(r.body.me).toMatchObject({ nick: 'B', rank: 1 });
    expect((await s.expGet()).body.rows).toHaveLength(2);
  });
  it('拒絕不合理的分數與太短的時間', async () => {
    const s = stub();
    expect((await s.expSubmit({ nick: 'X', score: 99999, secs: 200, ip: '3.3.3.3' })).status).toBe(400);
    expect((await s.expSubmit({ nick: 'X', score: 100, secs: 5, ip: '3.3.3.3' })).status).toBe(400);
  });
});

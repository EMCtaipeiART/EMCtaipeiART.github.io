import { env } from 'cloudflare:workers';
import { describe, expect, it } from 'vitest';

const stub = () => (env.MINIGAME_BOARD as any).getByName('fps-test');

describe('辦公室槍戰排行榜', () => {
  it('勝場榜與單場最高傷害榜：同名累計勝場、取最高傷害', async () => {
    const s = stub();
    expect((await s.fpsSubmit({ nick: 'A', win: 1, dmg: 900, kills: 5, hero: 'anna', mode: 0, diff: 1, secs: 300, ip: '1.1.1.1' })).body.recorded).toBe(true);
    await s.fpsSubmit({ nick: 'A', win: 1, dmg: 1500, kills: 9, hero: 'noise', mode: 0, diff: 2, secs: 300, ip: '1.1.1.1' });
    await s.fpsSubmit({ nick: 'A', win: 0, dmg: 400, kills: 1, hero: 'machi', mode: 1, diff: 1, secs: 200, ip: '1.1.1.1' });
    const r = await s.fpsSubmit({ nick: 'B', win: 1, dmg: 2000, kills: 12, hero: 'anna', mode: 1, diff: 1, secs: 400, ip: '2.2.2.2' });
    expect(r.body.wins.map((x: any) => [x.nick, x.wins, x.games])).toEqual([['A', 2, 3], ['B', 1, 1]]);
    expect(r.body.dmg.map((x: any) => [x.nick, x.dmg, x.hero])).toEqual([['B', 2000, 'anna'], ['A', 1500, 'noise']]);
    expect(r.body.me).toMatchObject({ nick: 'B', wins: 1, best: 2000 });
    expect((await s.fpsGet({ range: 'week' })).body.wins).toHaveLength(2);
  });
  it('沒登入或單人簡單模式不記錄', async () => {
    const s = stub();
    expect((await s.fpsSubmit({ nick: '', win: 1, dmg: 500, kills: 3, hero: 'anna', mode: 0, diff: 1, secs: 300, ip: '3.3.3.3' })).body).toMatchObject({ ok: true, recorded: false, reason: 'login-required' });
    expect((await s.fpsSubmit({ nick: 'C', win: 1, dmg: 500, kills: 3, hero: 'anna', mode: 0, diff: 0, secs: 300, ip: '3.3.3.3' })).body).toMatchObject({ recorded: false, reason: 'easy-mode' });
    expect((await s.fpsSubmit({ nick: 'C', win: 1, dmg: 500, kills: 3, hero: 'anna', mode: 1, diff: 0, secs: 300, ip: '3.3.3.3' })).body.recorded).toBe(true);
  });
  it('拒絕不合理的數字', async () => {
    const s = stub();
    expect((await s.fpsSubmit({ nick: 'X', win: 1, dmg: 99999, kills: 3, hero: 'anna', mode: 1, diff: 1, secs: 300, ip: '4.4.4.4' })).status).toBe(400);
    expect((await s.fpsSubmit({ nick: 'X', win: 1, dmg: 500, kills: 3, hero: 'hacker', mode: 1, diff: 1, secs: 300, ip: '4.4.4.4' })).status).toBe(400);
    expect((await s.fpsSubmit({ nick: 'X', win: 1, dmg: 500, kills: 3, hero: 'anna', mode: 1, diff: 1, secs: 3, ip: '4.4.4.4' })).status).toBe(400);
  });
  it('同一個 IP 一小時最多 30 筆', async () => {
    const s = stub(); let last = 0;
    for (let i = 0; i < 32; i++) last = (await s.fpsSubmit({ nick: 'N' + (i % 3), win: 0, dmg: 100, kills: 0, hero: 'anna', mode: 1, diff: 1, secs: 300, ip: '5.5.5.5' })).status;
    expect(last).toBe(429);
  });
});

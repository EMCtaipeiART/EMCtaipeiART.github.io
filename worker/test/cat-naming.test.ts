import { describe, expect, it } from 'vitest';
import { applyNamingOp, cleanCatName, emptyNaming, namingView, normalizeNaming, settleNaming, CAT_NAME_EXTEND_MS, CAT_NAME_VOTE_MS } from '../src/cat-naming';

const T0 = Date.UTC(2026, 10, 3);
const run = (n: ReturnType<typeof emptyNaming>, op: string, who: string, arg = '', now = T0, admin = false) => applyNamingOp(n, op, who, arg, now, admin);

describe('cat naming vote', () => {
  it('cleans names and rejects empty or long ones', () => {
    expect(cleanCatName('  花  花 ')).toBe('花 花');
    expect(cleanCatName('<b>米糕</b>')).toBe('b米糕/b');
    expect(cleanCatName('')).toBeNull();
    expect(cleanCatName('一二三四五六七八九')).toBeNull();
  });

  it('limits proposals per person and rejects duplicates', () => {
    let n = emptyNaming(T0);
    n = run(n, 'namePropose', 'Anna', '米糕').naming;
    n = run(n, 'namePropose', 'Anna', '麻糬').naming;
    expect(run(n, 'namePropose', 'Anna', '湯圓').error).toMatch(/最多/);
    expect(run(n, 'namePropose', 'Leona', '米糕').error).toMatch(/已經有人/);
    expect(run(n, 'namePropose', '', '湯圓').error).toMatch(/登入/);
  });

  it('gives one vote per person, moves it, and withdraws it', () => {
    let n = run(emptyNaming(T0), 'namePropose', 'Anna', '米糕').naming;
    n = run(n, 'namePropose', 'Leona', '麻糬').naming;
    const [a, b] = n.proposals.map(p => p.id);
    n = run(n, 'nameVote', 'Amber', a).naming;
    n = run(n, 'nameVote', 'Amber', b).naming;
    expect(n.proposals.map(p => p.voters.length)).toEqual([0, 1]);
    n = run(n, 'nameVote', 'Amber', b).naming;
    expect(n.proposals.map(p => p.voters.length)).toEqual([0, 0]);
    expect(namingView(n, 'Amber', false).myVote).toBeNull();
  });

  it('crowns the top name at the deadline; ties go to the earlier proposal', () => {
    let n = run(emptyNaming(T0), 'namePropose', 'Anna', '米糕', T0 + 1).naming;
    n = run(n, 'namePropose', 'Leona', '麻糬', T0 + 2).naming;
    const [a, b] = n.proposals.map(p => p.id);
    n = run(n, 'nameVote', 'Amber', b, T0 + 3).naming;
    n = run(n, 'nameVote', 'Noise', a, T0 + 4).naming;
    expect(settleNaming(n, T0 + 100).winner).toBeUndefined();
    const done = settleNaming(n, T0 + CAT_NAME_VOTE_MS);
    expect(done.winner?.text).toBe('米糕');
    expect(run(done, 'nameVote', 'Anna', b, T0 + CAT_NAME_VOTE_MS + 1).error).toMatch(/定案/);
  });

  it('extends the deadline when nobody voted', () => {
    const n = run(emptyNaming(T0), 'namePropose', 'Anna', '米糕').naming;
    const later = T0 + CAT_NAME_VOTE_MS + 5;
    const s = settleNaming(n, later);
    expect(s.winner).toBeUndefined();
    expect(s.closesAt).toBe(later + CAT_NAME_EXTEND_MS);
  });

  it('lets only an admin close early or remove a proposal', () => {
    let n = run(emptyNaming(T0), 'namePropose', 'Anna', '米糕').naming;
    const id = n.proposals[0].id;
    expect(run(n, 'nameClose', 'Anna').error).toMatch(/管理者/);
    expect(run(n, 'nameClose', 'Machi', '', T0, true).error).toMatch(/還沒有人投票/);
    n = run(n, 'nameVote', 'Amber', id).naming;
    expect(run(n, 'nameClose', 'Machi', '', T0, true).naming.winner?.text).toBe('米糕');
    expect(run(n, 'nameRemove', 'Machi', id, T0, true).naming.proposals).toHaveLength(0);
  });

  it('survives junk in storage', () => {
    const n = normalizeNaming({ proposals: [{ id: 'x', text: '', voters: 5 }, { id: 'y', text: '米糕', by: 'Anna', at: 1, voters: ['A', 'A', 7] }], winner: { text: '<' } }, T0);
    expect(n.proposals).toHaveLength(1);
    expect(n.proposals[0].voters).toEqual(['A']);
    expect(n.winner).toBeUndefined();
  });
});

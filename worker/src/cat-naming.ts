/** 3D 辦公室貓的「大家來取名」：任何同仁可提名、每人投一票（投票期間可改票），票數最高的名字就是貓的名字。
 *  純邏輯，不碰儲存；database-coordinator 把整份狀態存在 pixel_office_settings 的 cat:name。 */

export const CAT_NAME_VOTE_MS = 7 * 86_400_000;      // 投票期：第一次有人打開起算 7 天
export const CAT_NAME_EXTEND_MS = 3 * 86_400_000;    // 截止時沒有任何人投票：再延 3 天
export const CAT_NAME_MAX_LEN = 8;
export const CAT_NAME_PER_PERSON = 2;
export const CAT_NAME_MAX_PROPOSALS = 60;

export interface CatProposal { id: string; text: string; by: string; at: number; voters: string[] }
export interface CatWinner { text: string; votes: number; by: string; at: number }
export interface CatNaming { opensAt: number; closesAt: number; proposals: CatProposal[]; winner?: CatWinner }

export interface CatNamingView {
  phase: 'open' | 'closed';
  closesAt: number;
  winner: CatWinner | null;
  proposals: { id: string; text: string; by: string; votes: number; mine: boolean }[];
  myVote: string | null;
  myProposals: number;
  canAdmin: boolean;
}

/** 名字清理：去前後空白、壓縮空白、拿掉控制字元與 < > & " '，1～8 個字（以字元計）。不合格回傳 null。 */
export function cleanCatName(input: unknown): string | null {
  const s = String(input ?? '').replace(/[\u0000-\u001f\u007f<>&"'`\\]/g, '').replace(/\s+/g, ' ').trim();
  const n = [...s].length;
  return n >= 1 && n <= CAT_NAME_MAX_LEN ? s : null;
}

export function emptyNaming(now: number): CatNaming {
  return { opensAt: now, closesAt: now + CAT_NAME_VOTE_MS, proposals: [] };
}

/** 從儲存的 JSON 還原：欄位型別不對就丟掉，投票人去重。 */
export function normalizeNaming(raw: unknown, now: number): CatNaming {
  const r = raw && typeof raw === 'object' ? raw as Record<string, unknown> : {};
  const opensAt = Number(r.opensAt) > 0 ? Math.floor(Number(r.opensAt)) : now;
  const closesAt = Number(r.closesAt) > 0 ? Math.floor(Number(r.closesAt)) : opensAt + CAT_NAME_VOTE_MS;
  const proposals: CatProposal[] = (Array.isArray(r.proposals) ? r.proposals : []).flatMap((p): CatProposal[] => {
    const q = p && typeof p === 'object' ? p as Record<string, unknown> : {};
    const text = cleanCatName(q.text), id = typeof q.id === 'string' ? q.id : '';
    if (!text || !id) return [];
    const voters = [...new Set((Array.isArray(q.voters) ? q.voters : []).filter((v): v is string => typeof v === 'string'))];
    return [{ id, text, by: String(q.by ?? ''), at: Math.floor(Number(q.at) || 0), voters }];
  });
  let winner: CatWinner | undefined;
  const w = r.winner && typeof r.winner === 'object' ? r.winner as Record<string, unknown> : null;
  if (w && cleanCatName(w.text)) winner = { text: String(w.text), votes: Math.max(0, Math.floor(Number(w.votes) || 0)), by: String(w.by ?? ''), at: Math.floor(Number(w.at) || 0) };
  return { opensAt, closesAt, proposals, ...(winner ? { winner } : {}) };
}

/** 得票最高者；同票取較早提名的。沒有任何票回傳 null。 */
export function leadingProposal(n: CatNaming): CatProposal | null {
  let best: CatProposal | null = null;
  for (const p of n.proposals) {
    if (!p.voters.length) continue;
    if (!best || p.voters.length > best.voters.length || (p.voters.length === best.voters.length && p.at < best.at)) best = p;
  }
  return best;
}

function crown(n: CatNaming, p: CatProposal): CatNaming {
  return { ...n, winner: { text: p.text, votes: p.voters.length, by: p.by, at: p.at } };
}

/** 到期結算：有票就定案；完全沒票就延後。已定案的不變。 */
export function settleNaming(n: CatNaming, now: number): CatNaming {
  if (n.winner || now < n.closesAt) return n;
  const top = leadingProposal(n);
  return top ? crown(n, top) : { ...n, closesAt: now + CAT_NAME_EXTEND_MS };
}

export type CatNamingOp = 'nameGet' | 'namePropose' | 'nameVote' | 'nameClose' | 'nameRemove';

/** 套用一個操作。who＝操作者（已驗證是同仁；nameGet 可為空）、admin＝是否管理者。回傳新狀態或錯誤訊息。 */
export function applyNamingOp(n0: CatNaming, op: string, who: string, arg: string, now: number, admin: boolean): { naming: CatNaming; error?: string } {
  const n = settleNaming(n0, now);
  if (op === 'nameGet') return { naming: n };
  if (!who) return { naming: n, error: '登入後才能參與取名' };
  if (op === 'nameClose' || op === 'nameRemove') {
    if (!admin) return { naming: n, error: '只有管理者可以這樣做' };
    if (op === 'nameClose') {
      if (n.winner) return { naming: n, error: '已經定案了' };
      const top = leadingProposal(n);
      return top ? { naming: crown(n, top) } : { naming: n, error: '還沒有人投票' };
    }
    const next = { ...n, proposals: n.proposals.filter(p => p.id !== arg) };
    if (next.proposals.length === n.proposals.length) return { naming: n, error: '找不到這個提名' };
    return { naming: next };
  }
  if (n.winner) return { naming: n, error: '名字已經定案了' };
  if (op === 'namePropose') {
    const text = cleanCatName(arg);
    if (!text) return { naming: n, error: '名字要 1～' + CAT_NAME_MAX_LEN + ' 個字' };
    if (n.proposals.length >= CAT_NAME_MAX_PROPOSALS) return { naming: n, error: '提名已滿' };
    if (n.proposals.some(p => p.text.toLowerCase() === text.toLowerCase())) return { naming: n, error: '這個名字已經有人提了，直接投票吧' };
    if (n.proposals.filter(p => p.by === who).length >= CAT_NAME_PER_PERSON) return { naming: n, error: '每人最多提名 ' + CAT_NAME_PER_PERSON + ' 個' };
    const id = 'n' + now.toString(36) + Math.floor(Math.random() * 1296).toString(36);
    return { naming: { ...n, proposals: [...n.proposals, { id, text, by: who, at: now, voters: [] }] } };
  }
  if (op === 'nameVote') {
    if (!n.proposals.some(p => p.id === arg)) return { naming: n, error: '找不到這個提名' };
    // 一人一票：先從所有提名收回，再投給指定的；再點一次同一個＝收回
    const had = n.proposals.some(p => p.id === arg && p.voters.includes(who));
    return { naming: { ...n, proposals: n.proposals.map(p => ({ ...p, voters: [...p.voters.filter(v => v !== who), ...(p.id === arg && !had ? [who] : [])] })) } };
  }
  return { naming: n, error: 'invalid op' };
}

export function namingView(n: CatNaming, who: string, admin: boolean): CatNamingView {
  const ranked = [...n.proposals].sort((a, b) => b.voters.length - a.voters.length || a.at - b.at);
  return {
    phase: n.winner ? 'closed' : 'open',
    closesAt: n.closesAt,
    winner: n.winner ?? null,
    proposals: ranked.map(p => ({ id: p.id, text: p.text, by: p.by, votes: p.voters.length, mine: p.voters.includes(who) })),
    myVote: n.proposals.find(p => p.voters.includes(who))?.id ?? null,
    myProposals: n.proposals.filter(p => p.by === who).length,
    canAdmin: admin
  };
}

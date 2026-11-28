// 雲端存檔同步。不碰畫面也不碰網路細節（由呼叫端給），所以能在 test.mjs 模擬兩台裝置。
//
// 雲端每存一次版本號 +1。這台裝置記著「上次同步到第幾版（rev）、之後有沒有再玩過（dirty）」。
// 版本對不上＝別台裝置存過了，要決定留哪一份：
//   開啟遊戲／切回畫面（load）：這台有還沒上傳的進度而且比較晚玩 → 傳上去；否則接續雲端。
//   玩到一半上傳時撞版本（push）：只有這台的訂單／經驗值比較多才覆蓋；否則接續雲端，避免舊畫面蓋掉新進度。
const progress = (a, b) => (a.done - b.done) || (a.xp - b.xp);

export function createCloudSave({ enabled, request, readMeta, writeMeta, getState, adopt, onStatus = () => {}, delay = 1500, retry = 20000 }) {
  let status = enabled ? 'loading' : 'off';   // off | loading | saving | saved | offline | login | old
  let chain = Promise.resolve(true), pushTimer = null, retryTimer = null;
  const set = s => { status = s; onStatus(s); };
  const meta = () => { const m = readMeta(); return { rev: Number.isInteger(m?.rev) ? m.rev : null, dirty: Boolean(m?.dirty) }; };

  async function push(baseRev, depth = 0) {
    set('saving');
    const state = JSON.parse(JSON.stringify(getState()));
    state.savedAt ||= 0;
    const r = await request('save', { baseRev, state });
    if (r.conflict) {
      if (depth < 2 && (!r.state || progress(state, r.state) > 0)) return push(r.rev, depth + 1);
      return take(r);
    }
    // 上傳途中又玩了幾步就維持 dirty，等下一輪
    const dirty = (getState().savedAt || 0) !== state.savedAt;
    writeMeta({ rev: r.rev, dirty });
    if (dirty) changed();
  }
  async function take(server) {
    if (!adopt(server.state)) {
      // 雲端是比較新版的遊戲存的：這台太舊，不能蓋掉
      if ((server.state?.ver || 1) > (getState().ver || 1)) throw Object.assign(new Error('遊戲版本太舊，請重新整理'), { refused: true });
      return push(server.rev, 2);   // 雲端那份壞了：用這台的蓋掉
    }
    writeMeta({ rev: server.rev, dirty: false });
  }
  async function load() {
    // 要在連線之前記下來：讀取途中的操作不能讓舊畫面看起來比雲端新
    const before = meta(), mine = JSON.parse(JSON.stringify(getState()));
    const server = await request('load');
    if (!server.state) return push(server.rev);
    if (server.rev === before.rev) return meta().dirty ? push(server.rev) : undefined;
    const keep = before.rev === null ? progress(mine, server.state) > 0 : before.dirty && (mine.savedAt || 0) > (server.state.savedAt || 0);
    return keep ? push(server.rev) : take(server);
  }

  // 所有連線排成一列，不會自己撞自己
  function run(full) {
    if (!enabled) return Promise.resolve(false);
    chain = chain.then(async () => {
      const m = meta();
      if (!full && !m.dirty) return true;
      try {
        // 沒同步過、或上次失敗：先讀雲端再決定
        if (full || m.rev === null || status === 'offline') await load(); else await push(m.rev);
        clearTimeout(retryTimer);
        set('saved');
        return true;
      } catch (e) {
        const login = e.refused && /登入/.test(e.message);
        const old = e.refused && /版本太舊/.test(e.message);
        set(login ? 'login' : old ? 'old' : 'offline');
        clearTimeout(retryTimer);
        if (!login && !old) retryTimer = setTimeout(() => run(true), retry);
        return false;
      }
    });
    return chain;
  }
  function changed() {
    if (!enabled) return;
    writeMeta({ ...meta(), dirty: true });
    clearTimeout(pushTimer);
    pushTimer = setTimeout(() => run(false), delay);
  }
  return {
    load: () => run(true),
    changed,
    flush: () => { clearTimeout(pushTimer); return run(false); },
    get status() { return status; },
  };
}

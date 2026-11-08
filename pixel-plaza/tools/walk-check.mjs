// 只檢查、不花 AI：列出「角色工坊已發佈，但走路影格版本落後」的人物。沒有就印 []。
// --ci：給 GitHub Actions 用。只留名字安全的人物，並略過「待審分支已存在」的（避免每 30 分鐘重複製作同一位）。
import { spawnSync } from 'node:child_process';
import { pending } from './walk-lib.mjs';

let list = await pending();
if (process.argv.includes('--ci')) {
  const branchOf = p => `walk-pending/${p.name}-v${p.version}`;
  list = list.filter(p => /^[\p{L}\p{N}_-]{1,30}$/u.test(p.name) && /^\d{1,6}$/.test(String(p.version)));
  list = list.filter(p => {
    const r = spawnSync('git', ['ls-remote', '--heads', 'origin', branchOf(p)], { encoding: 'utf8' });
    return r.status === 0 && !r.stdout.trim();
  });
  list = list.map(p => ({ ...p, branch: branchOf(p) }));
}
console.log(JSON.stringify(list));

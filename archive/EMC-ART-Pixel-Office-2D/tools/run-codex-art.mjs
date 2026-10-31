// 開發工具：依序請本機 Codex（codex exec）畫素材圖集。使用你登入的 Codex 帳號與額度；
// 提示詞與風格參考圖（design/minigames-art/refs，由現有素材裁出）會送給 OpenAI。已存在的 raw/*.png 會略過。
//   node tools/run-codex-art.mjs treasure-items-v1 hoops-props-v1 ...
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

const root = path.resolve('design/minigames-art');
const REFS = {
  'treasure-items-v1': ['ref-office-desks', 'ref-office-rooms', 'ref-icons'],
  'hoops-props-v1': ['ref-icons', 'ref-office-rooms'],
  'deadline-ui-v1': ['ref-icons', 'ref-office-desks'],
  'hideseek-markers-v1': ['ref-icons', 'ref-office-rooms', 'ref-office-toilet-elevator'],
  'guest-character-v1': ['ref-characters']
};
const head = fs.readFileSync(path.join(root, 'prompts/_head.md'), 'utf8');
for (const name of process.argv.slice(2)) {
  const out = path.join(root, 'raw', name + '.png');
  if (fs.existsSync(out)) { console.log('略過（已存在）', name); continue; }
  const prompt = head + '\n' + fs.readFileSync(path.join(root, 'prompts', name + '.body.md'), 'utf8');
  fs.writeFileSync(path.join(root, 'prompts', name + '.md'), prompt);
  const args = ['exec', '--skip-git-repo-check', '-s', 'workspace-write', '-C', root];
  for (const r of REFS[name] || []) args.push('-i', path.join(root, 'refs', r + '.png'));
  args.push('-');
  console.log('開始', name, new Date().toLocaleTimeString());
  await new Promise(resolve => {
    const log = fs.openSync(path.join(root, 'raw', 'codex-' + name + '.log'), 'w');
    const p = spawn('codex', args, { cwd: root, shell: true, stdio: ['pipe', log, log] });
    p.stdin.end(prompt);
    p.on('exit', code => { console.log('結束', name, 'exit', code, fs.existsSync(out) ? '有圖' : '沒有圖', new Date().toLocaleTimeString()); resolve(); });
  });
}

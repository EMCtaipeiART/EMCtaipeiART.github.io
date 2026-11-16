#!/usr/bin/env node
// 角色入庫紀錄與備份：每個角色都要「雲端可展示＋本機有 12 角度備份」。
//   node pixel-plaza/tools/sync-chars.mjs          從雲端把所有角色的 12 角度站姿／走路圖備份到 pixel-plaza/，並寫 characters-registry.json
//   node pixel-plaza/tools/sync-chars.mjs --check  只檢查、不下載；有缺（雲端沒有／本機沒有／角度不是 12）就以非 0 結束
// 走路圖：若本機的走路備份是自己重做的（walk-manifest.json 有記版本且比雲端新），不會被舊的雲端版覆蓋。
import fs from 'node:fs'; import path from 'node:path'; import { execFileSync } from 'node:child_process'; import { fileURLToPath } from 'node:url';
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..'), API = 'https://emc-ai-stage-classifier.machi-chen.workers.dev/api/public/characters', ANGLES = 12, CHECK = process.argv.includes('--check');
const UA = { headers: { 'User-Agent': 'emc-sync/1' } };
const dims = f => { const b = fs.readFileSync(f); return b.readUInt32BE(16) ? [b.readUInt32BE(16), b.readUInt32BE(20)] : [0, 0]; };
const has = f => fs.existsSync(path.join(ROOT, f));
const angles = (f, rows) => { if (!has(f)) return 0; const [w, h] = dims(path.join(ROOT, f)); return Math.round(w / (h / rows)); };
async function pull(name, file, v, dest) {
  const r = await fetch(`${API}/${encodeURIComponent(name)}/${file}.png?v=${v}`, UA); if (!r.ok) throw new Error(`${name} ${file} ${r.status}`);
  fs.writeFileSync(path.join(ROOT, dest), Buffer.from(await r.arrayBuffer()));
}
function toWebp(png) { try { execFileSync('python3', ['-c', 'import sys;from PIL import Image;Image.open(sys.argv[1]).convert("RGBA").save(sys.argv[2],"WEBP",quality=92,method=6)', path.join(ROOT, png), path.join(ROOT, png.replace(/\.png$/, '.webp'))]); } catch { console.warn('  （沒有 PIL，略過 webp：' + png + '）'); } }
const cloud = await (await fetch(API, UA)).json(), manifest = JSON.parse(fs.readFileSync(path.join(ROOT, 'walk-manifest.json'), 'utf8'));
const localNames = new Set(fs.readdirSync(path.join(ROOT, 'sprites')).filter(f => f.endsWith('.png')).map(f => f.slice(0, -4)));
const names = [...new Set([...Object.keys(cloud.characters), ...localNames])];
const registry = { updatedAt: new Date().toISOString(), note: '每個角色需雲端可展示＋本機 12 角度備份（stand 必備；walk 為走路影格）', characters: {} };
let bad = 0;
for (const n of names) {
  const cs = cloud.characters[n] || null, cw = cloud.walks[n] || null;
  if (!CHECK && cs) {
    await pull(n, 'atlas', cs, `sprites/${n}.png`); await pull(n, 'atlas-hd', cs, `sprites-hd/${n}.png`); toWebp(`sprites-hd/${n}.png`);
    const keepLocalWalk = manifest[n] && cw && manifest[n] > cw;   // 本機自己重做的走路圖比雲端新就不蓋
    if (cw && !keepLocalWalk && !(manifest[n] && manifest[n] >= cw && has(`sprites-walk/${n}.png`))) { await pull(n, 'walk', cw, `sprites-walk/${n}.png`); await pull(n, 'walk-hd', cw, `sprites-walk-hd/${n}.png`); toWebp(`sprites-walk-hd/${n}.png`); }
  }
  const local = { stand: angles(`sprites/${n}.png`, 1), standHd: angles(`sprites-hd/${n}.png`, 1), standHdWebp: has(`sprites-hd/${n}.webp`), walk: angles(`sprites-walk/${n}.png`, 2), walkHd: angles(`sprites-walk-hd/${n}.png`, 2) };
  const problems = [];
  if (!cs) problems.push('雲端沒有（無法展示）'); if (local.stand !== ANGLES || local.standHd !== ANGLES) problems.push('本機沒有完整 12 角度站姿備份');
  if (cw && local.walk !== ANGLES) problems.push('雲端有走路圖但本機沒有備份');
  if (problems.length) bad++;
  registry.characters[n] = { cloud: { stand: cs, walk: cw }, local, localWalkVersion: manifest[n] || null, ok: !problems.length, problems };
}
fs.writeFileSync(path.join(ROOT, 'characters-registry.json'), JSON.stringify(registry, null, 1) + '\n');
for (const [n, c] of Object.entries(registry.characters)) console.log((c.ok ? '✓ ' : '✗ ') + n + '  雲端 站v' + (c.cloud.stand ?? '—') + ' 走v' + (c.cloud.walk ?? '—') + '  本機 站' + c.local.stand + '/' + c.local.standHd + ' 走' + c.local.walk + '/' + c.local.walkHd + (c.problems.length ? '  ← ' + c.problems.join('、') : ''));
console.log(bad ? `\n${bad} 位有缺` : '\n全部齊全');
if (CHECK && bad) process.exit(1);

// 走路影格自動化共用設定。不需要 AI 的「檢查」與需要 Codex 的「製作」都用這份。
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
export const HERE = path.dirname(fileURLToPath(import.meta.url));
export const PLAZA = path.resolve(HERE, '..');
export const MANIFEST = path.join(PLAZA, 'walk-manifest.json');
export const API = 'https://emc-ai-stage-classifier.machi-chen.workers.dev/api/public/characters';
export const SKIP = ['廖秦葦'];   // 聖誕樹：不需要走路影格
export const readManifest = () => JSON.parse(fs.readFileSync(MANIFEST, 'utf8'));
export async function pending() {
  const r = await fetch(API, { signal: AbortSignal.timeout(15000) });
  if (!r.ok) throw new Error('characters API ' + r.status);
  const body = await r.json(), cloud = body.characters || {}, walks = body.walks || {};   // walks：家裡電腦工作者已放到雲端的走路影格版本，不用再重做
  const have = readManifest();
  return Object.entries(cloud).filter(([n, v]) => !SKIP.includes(n) && have[n] !== v && walks[n] !== v).map(([name, version]) => ({ name, version, was: have[name] ?? null }));
}

#!/usr/bin/env node
/**
 * 一鍵發布 NAS 爬蟲更新（管理者用，設計師電腦不需要）。
 *
 * 做的事：確認要發布的檔案都已經 commit → 同步遠端 → 語法檢查與全部測試 → 算出每個檔案的 sha256 寫進
 * scripts/nas_watcher_release.json → commit → push。push 完成後，各台設計師電腦上的啟動器最多 10 分鐘內
 * 會自己下載新版、驗證、替換（見 nas_watcher_update.mjs），不必每台重新執行安裝器。
 * 沒有任何檔案跟上次發布不同時什麼都不做（平常的 git push 不會驚動設計師電腦）。
 *
 * 用法：雙擊 publish_nas_update.command，或 node scripts/publish_nas_update.mjs [--dry-run] [--skip-tests]
 *       [--repo <路徑>] [--remote origin] [--branch main]
 */
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { BOOTSTRAP_FILES, RELEASE_MANIFEST_NAME, UPDATE_FILES, buildManifest } from './nas_watcher_update.mjs';

/** 台北時間 YYYYMMDD-HHmm，當作發布版本號。 */
export function taipeiStamp(date = new Date()) {
  const shifted = new Date(date.getTime() + 8 * 60 * 60 * 1000);
  const pad = value => String(value).padStart(2, '0');
  return `${shifted.getUTCFullYear()}${pad(shifted.getUTCMonth() + 1)}${pad(shifted.getUTCDate())}-${pad(shifted.getUTCHours())}${pad(shifted.getUTCMinutes())}`;
}

/** 同一分鐘內發布兩次時加流水號，確保版本號一定跟上一版不同。 */
export function nextVersion(previousVersion, date = new Date()) {
  const base = taipeiStamp(date);
  const previous = String(previousVersion || '');
  if (previous !== base && !previous.startsWith(`${base}-`)) return base;
  const serial = Number(previous.split('-')[2]) || 1;
  return `${base}-${serial + 1}`;
}

export async function collectReleaseFiles(scriptsDir) {
  const files = {};
  for (const name of UPDATE_FILES) files[name] = await fs.readFile(path.join(scriptsDir, name));
  return files;
}

export function parseArgs(argv) {
  const args = { dryRun: false, skipTests: false, repo: '', remote: 'origin', branch: 'main' };
  for (let i = 0; i < argv.length; i += 1) {
    const value = argv[i];
    if (value === '--dry-run') args.dryRun = true;
    else if (value === '--skip-tests') args.skipTests = true;
    else if (['--repo', '--remote', '--branch'].includes(value) && argv[i + 1]) {
      args[value.slice(2)] = argv[i + 1];
      i += 1;
    }
  }
  return args;
}

function run(command, args, { cwd, allowFail = false } = {}) {
  const result = spawnSync(command, args, { cwd, encoding: 'utf8' });
  if (result.status !== 0 && !allowFail) {
    const detail = String(result.stderr || result.stdout || '').trim().split('\n').slice(-8).join('\n');
    throw new Error(`${command} ${args.join(' ')} 失敗：\n${detail}`);
  }
  return result;
}

export async function publish(options = {}) {
  const args = { ...parseArgs([]), ...options };
  const scriptsDir = path.dirname(fileURLToPath(import.meta.url));
  const repo = path.resolve(args.repo || path.join(scriptsDir, '..'));
  const repoScripts = path.join(repo, 'scripts');
  const log = message => console.log(message);
  const releaseFiles = [...UPDATE_FILES, ...BOOTSTRAP_FILES].map(name => `scripts/${name}`);

  log('=== 發布 NAS 爬蟲更新 ===');
  const branch = run('git', ['rev-parse', '--abbrev-ref', 'HEAD'], { cwd: repo }).stdout.trim();
  if (branch !== args.branch) throw new Error(`目前在分支「${branch}」，發布要在「${args.branch}」上進行。`);

  const dirty = run('git', ['status', '--porcelain', '--', ...releaseFiles], { cwd: repo }).stdout.trim();
  if (dirty) throw new Error(`這些檔案還有沒 commit 的修改，請先 commit 再發布（避免發布出去的跟你測試的不一樣）：\n${dirty}`);

  log('同步遠端最新內容...');
  run('git', ['fetch', args.remote, args.branch], { cwd: repo });
  run('git', ['pull', '--rebase', '--autostash', args.remote, args.branch], { cwd: repo });

  log('檢查語法...');
  for (const name of [...UPDATE_FILES, ...BOOTSTRAP_FILES].filter(item => item.endsWith('.mjs'))) {
    run(process.execPath, ['--check', path.join(repoScripts, name)]);
  }
  JSON.parse(await fs.readFile(path.join(repoScripts, 'nas_design_image_watcher.config.json'), 'utf8'));

  if (!args.skipTests) {
    log('執行全部測試（約十幾秒）...');
    run(process.execPath, ['--test', 'backend/test/*.test.mjs'], { cwd: repo });
  }

  const manifestPath = path.join(repoScripts, RELEASE_MANIFEST_NAME);
  let previous = {};
  try { previous = JSON.parse(await fs.readFile(manifestPath, 'utf8')); } catch { previous = {}; }
  const version = nextVersion(previous.version);
  const manifest = buildManifest(await collectReleaseFiles(repoScripts), { version });
  const changed = Object.keys(manifest.files).filter(name => manifest.files[name] !== previous.files?.[name]);
  const removed = Object.keys(previous.files || {}).filter(name => !(name in manifest.files));
  if (!changed.length && !removed.length) {
    log('這些檔案跟上次發布的內容完全一樣，沒有需要發布的更新。');
    return { published: false, reason: 'no-change' };
  }
  log(`要發布的版本：${version}\n有變動的檔案：${changed.join('、') || '（無，只是移除舊項目）'}`);
  if (args.dryRun) {
    log('（試跑：沒有寫入、commit 或 push）');
    return { published: false, reason: 'dry-run', version, changed };
  }

  await fs.writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, 'utf8');
  run('git', ['add', `scripts/${RELEASE_MANIFEST_NAME}`], { cwd: repo });
  run('git', ['commit', '-m', `release: NAS 爬蟲更新 ${version}\n\n設計師電腦最多 10 分鐘內會自動更新：${changed.join('、')}\n\nCo-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>`, '--', `scripts/${RELEASE_MANIFEST_NAME}`], { cwd: repo });
  let push = run('git', ['push', args.remote, args.branch], { cwd: repo, allowFail: true });
  if (push.status !== 0) {
    // Cloudflare Worker 會不定時自動 commit 資料，剛好在這幾秒內有新的提交時重新同步後再推一次。
    run('git', ['pull', '--rebase', '--autostash', args.remote, args.branch], { cwd: repo });
    push = run('git', ['push', args.remote, args.branch], { cwd: repo });
  }
  log(`\n✅ 已發布版本 ${version}。各台設計師電腦最多約 10 分鐘內會自動更新（含選擇器服務自動重啟），不需要他們做任何事。`);
  return { published: true, version, changed };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  publish(parseArgs(process.argv.slice(2))).catch(error => {
    console.error(`\n❌ 發布失敗：${error.message}`);
    process.exitCode = 1;
  });
}

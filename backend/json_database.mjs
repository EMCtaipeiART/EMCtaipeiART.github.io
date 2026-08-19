import { mkdir, readFile, rename, writeFile, copyFile, readdir, unlink } from 'node:fs/promises';
import path from 'node:path';
import { emptyDatabase, normalizeDatabaseShape, stringifyDatabaseForStorage, TABLE_SCHEMAS } from './schema.mjs';

function clone(value) {
  return structuredClone(value);
}

export class JsonDatabase {
  constructor(filePath, options = {}) {
    this.filePath = path.resolve(filePath);
    this.backupDir = path.resolve(options.backupDir || path.join(path.dirname(this.filePath), 'backups'));
    this.maxBackups = Math.max(1, Number(options.maxBackups) || 20);
    this.state = null;
    this.writeQueue = Promise.resolve();
  }

  async init() {
    await mkdir(path.dirname(this.filePath), { recursive: true });
    try {
      const raw = await readFile(this.filePath, 'utf8');
      this.state = normalizeDatabaseShape(JSON.parse(raw));
    } catch (error) {
      if (error.code !== 'ENOENT') throw error;
      this.state = emptyDatabase();
      await this.#persist(this.state, false);
    }
    return this;
  }

  snapshot() {
    if (!this.state) throw new Error('JSON database is not initialized');
    return clone(this.state);
  }

  table(name) {
    if (!TABLE_SCHEMAS[name]) throw new Error(`未知資料表：${name}`);
    return clone(this.state.tables[name]);
  }

  async transaction(mutator, reason = 'write') {
    const run = async () => {
      const draft = clone(this.state);
      const result = await mutator(draft);
      normalizeDatabaseShape(draft);
      draft.revision = Number(this.state.revision || 0) + 1;
      draft.updatedAt = new Date().toISOString();
      draft.lastWrite = { reason: String(reason || 'write'), at: draft.updatedAt };
      await this.#persist(draft, true);
      this.state = draft;
      return clone(result);
    };
    const next = this.writeQueue.then(run, run);
    this.writeQueue = next.then(() => undefined, () => undefined);
    return next;
  }

  async replace(nextState, reason = 'replace') {
    return this.transaction(draft => {
      const replacement = normalizeDatabaseShape(clone(nextState));
      for (const key of Object.keys(draft)) delete draft[key];
      Object.assign(draft, replacement);
      return { revision: Number(this.state?.revision || 0) + 1 };
    }, reason);
  }

  async #persist(state, makeBackup) {
    const json = stringifyDatabaseForStorage(state);
    const tempPath = `${this.filePath}.${process.pid}.${Date.now()}.tmp`;
    if (makeBackup) {
      try {
        await mkdir(this.backupDir, { recursive: true });
        const stamp = new Date().toISOString().replace(/[:.]/g, '-');
        await copyFile(this.filePath, path.join(this.backupDir, `db-${stamp}.json`));
        await this.#trimBackups();
      } catch (error) {
        if (error.code !== 'ENOENT') throw error;
      }
    }
    await writeFile(tempPath, json, { encoding: 'utf8', mode: 0o600 });
    await rename(tempPath, this.filePath);
  }

  async #trimBackups() {
    const files = (await readdir(this.backupDir))
      .filter(name => /^db-.*\.json$/.test(name))
      .sort()
      .reverse();
    await Promise.all(files.slice(this.maxBackups).map(name => unlink(path.join(this.backupDir, name))));
  }
}

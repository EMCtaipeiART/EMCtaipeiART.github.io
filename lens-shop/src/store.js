// 以 D1 分塊儲存檔案（取代 R2；介面與 R2 的 get/put/list/delete 相容到本專案用到的程度）
const CH = 700 * 1024;
export class D1Files {
  constructor(db) { this.db = db; }
  async put(key, data, opts = {}) {
    const bytes = typeof data === 'string' ? new TextEncoder().encode(data) : data;
    const mime = opts.httpMetadata?.contentType || '';
    const st = [this.db.prepare('DELETE FROM files WHERE k=?').bind(key)];
    for (let i = 0, n = 0; i < Math.max(bytes.length, 1); i += CH, n++)
      st.push(this.db.prepare('INSERT INTO files(k,i,mime,data) VALUES(?,?,?,?)').bind(key, n, mime, bytes.slice(i, i + CH)));
    for (let i = 0; i < st.length; i += 1) await st[i].run();
  }
  async get(key) {
    const r = await this.db.prepare('SELECT mime,data FROM files WHERE k=? ORDER BY i').bind(key).all();
    if (!r.results.length) return null;
    const parts = r.results.map((x) => new Uint8Array(x.data)); const out = new Uint8Array(parts.reduce((s, p) => s + p.length, 0));
    let o = 0; for (const p of parts) { out.set(p, o); o += p.length; }
    return { body: out, httpMetadata: { contentType: r.results[0].mime }, text: async () => new TextDecoder().decode(out), arrayBuffer: async () => out.buffer };
  }
  async list({ prefix }) {
    const r = await this.db.prepare('SELECT DISTINCT k FROM files WHERE k LIKE ?').bind(prefix + '%').all();
    return { objects: r.results.map((x) => ({ key: x.k })) };
  }
  async delete(keys) { for (const k of [].concat(keys)) await this.db.prepare('DELETE FROM files WHERE k=?').bind(k).run(); }
}

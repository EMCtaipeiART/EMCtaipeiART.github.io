interface Env {
  LINKS: KVNamespace;
  FALLBACK_URL: string;
  SHORTENER_API_KEY: string;
}

const CODE_RE = /^[A-Za-z0-9_-]{2,32}$/;
const ALPHABET = "abcdefghjkmnpqrstuvwxyz23456789";

const json = (data: unknown, status = 200) =>
  new Response(JSON.stringify(data), { status, headers: { "Content-Type": "application/json; charset=utf-8" } });

const randomCode = (len = 5) => {
  const bytes = crypto.getRandomValues(new Uint8Array(len));
  return Array.from(bytes, (b) => ALPHABET[b % ALPHABET.length]).join("");
};

const authorized = (req: Request, env: Env) => {
  const key = (req.headers.get("Authorization") || "").replace(/^Bearer\s+/i, "");
  return !!env.SHORTENER_API_KEY && key === env.SHORTENER_API_KEY;
};

const ADMIN_HTML = `<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>縮短網址</title>
<style>body{font:16px system-ui;max-width:560px;margin:40px auto;padding:0 16px}input,button{font:inherit;padding:8px;margin:4px 0;width:100%;box-sizing:border-box}button{cursor:pointer}pre{background:#f4f4f4;padding:8px;white-space:pre-wrap;word-break:break-all}</style>
<h2>縮短網址</h2>
<input id="k" type="password" placeholder="管理金鑰">
<input id="u" placeholder="長網址 https://...">
<input id="c" placeholder="自訂短碼（可留空）">
<button id="go">產生</button><pre id="o"></pre>
<script>
const $=id=>document.getElementById(id);$('k').value=sessionStorage.getItem('k')||'';
$('go').onclick=async()=>{sessionStorage.setItem('k',$('k').value);
const r=await fetch('/api/links',{method:'POST',headers:{'Authorization':'Bearer '+$('k').value,'Content-Type':'application/json'},body:JSON.stringify({url:$('u').value,code:$('c').value||undefined})});
const j=await r.json();$('o').textContent=r.ok?j.short:('失敗：'+(j.error||r.status));};
</script>`;

export default {
  async fetch(req: Request, env: Env): Promise<Response> {
    const url = new URL(req.url);
    const path = url.pathname;

    if (path === "/admin") return new Response(ADMIN_HTML, { headers: { "Content-Type": "text/html; charset=utf-8" } });

    if (path === "/api/links") {
      if (!authorized(req, env)) return json({ error: "unauthorized" }, 401);
      if (req.method === "POST") {
        const body = (await req.json().catch(() => ({}))) as { url?: string; code?: string };
        let target: URL;
        try { target = new URL(String(body.url || "")); } catch { return json({ error: "invalid url" }, 400); }
        if (!/^https?:$/.test(target.protocol)) return json({ error: "only http(s) urls" }, 400);
        let code = body.code;
        if (code) {
          if (!CODE_RE.test(code) || ["admin", "api"].includes(code.toLowerCase())) return json({ error: "invalid code" }, 400);
          if (await env.LINKS.get(code)) return json({ error: "code already exists" }, 409);
        } else {
          do { code = randomCode(); } while (await env.LINKS.get(code));
        }
        await env.LINKS.put(code, target.toString(), { metadata: { created: new Date().toISOString() } });
        return json({ code, short: `${url.origin}/${code}`, url: target.toString() }, 201);
      }
      if (req.method === "GET") {
        const list = await env.LINKS.list({ limit: 1000 });
        const items = await Promise.all(list.keys.map(async (k) => ({ code: k.name, url: await env.LINKS.get(k.name), ...(k.metadata as object) })));
        return json({ items });
      }
      return json({ error: "method not allowed" }, 405);
    }

    if (path.startsWith("/api/links/") && req.method === "DELETE") {
      if (!authorized(req, env)) return json({ error: "unauthorized" }, 401);
      await env.LINKS.delete(decodeURIComponent(path.slice("/api/links/".length)));
      return json({ ok: true });
    }

    const code = decodeURIComponent(path.slice(1));
    if (code && CODE_RE.test(code)) {
      const target = await env.LINKS.get(code);
      if (target) return Response.redirect(target, 302);
      return new Response("找不到這個短網址", { status: 404, headers: { "Content-Type": "text/plain; charset=utf-8" } });
    }
    return Response.redirect(env.FALLBACK_URL, 302);
  },
};

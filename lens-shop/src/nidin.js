// 你訂（order.nidin.shop）開團連結解析：店家簡介與完整菜單都是公開 API，一次抓完
const API = 'https://loctw-service-api.nidin.shop/shopper/v2';
const H = { 'user-agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 Chrome/124 Safari/537.36', origin: 'https://order.nidin.shop' };

// 連結格式：https://order.nidin.shop/gb/(menu|login)/<店家id>/<開團代碼>…
export function nidinIds(url) {
  const m = new URL(url).pathname.match(/\/gb\/(?:menu|login|close|store)\/(\d+)\/(?:\d+\/)?([A-Za-z0-9]+)/);
  if (!m) throw new Error('看不懂這個你訂連結（需像 order.nidin.shop/gb/menu/店家代號/開團代碼）');
  return { storeId: m[1], code: m[2] };
}

export async function parseNidin(url) {
  const { storeId, code } = nidinIds(url);
  const [br, mr, pi] = await Promise.all([
    fetch(`${API}/groupBuy/${code}/brief`, { headers: H }).then((r) => r.json()).catch(() => ({})),
    fetch(`${API}/store/${storeId}/onShelfMenu`, { headers: H }).then((r) => r.json()).catch(() => ({})),
    fetch(`${API}/store/${storeId}/productImages`, { headers: H }).then((r) => r.json()).catch(() => ({})),
  ]);
  const pimg = (pi && pi.product_list && !Array.isArray(pi.product_list)) ? pi.product_list : {};
  if (br.status !== 200 || !br.group_buy_brief) throw new Error('讀不到這個你訂開團（連結可能已過期或團單已關閉）');
  if (mr.status !== 200 || !mr.menu) throw new Error('讀不到店家菜單');
  const b = br.group_buy_brief, M = mr.menu;
  const S = (j) => j.schema, D = (j) => j.data;
  const cat = M.category_list_json, prod = M.product_list_json, adj = M.adjust_list_json, opt = M.option_list_json;
  const cs = S(cat), ps = S(prod), as = S(adj), os = S(opt);
  const cb = M.combine_list_json, cbs = cb.schema, es = cb.edge_schema;
  const allowedOf = (p) => { const set = new Set(); for (const cid of p[ps.combine_list] || []) { const c = D(cb)[cid]; if (!c) continue; Object.keys(c[cbs.edge_list] || {}).forEach((k) => set.add(+k)); (c[cbs.common_list] || []).forEach((k) => set.add(+(Array.isArray(k) ? k[0] : k))); } return set; };
  const adjOf = (id, allow) => {
    const a = D(adj)[id]; if (!a || !a[as.is_enable] || !a[as.is_visible]) return null;
    const o = (a[as.option_list] || []).map((oid) => D(opt)[oid]).filter((x) => x && x[os.is_enable] && x[os.is_visible] && (!allow.size || allow.has(+x[os.product_id]))).map((x) => [String(x[os.name]), Math.round(Number(x[os.price]) || 0)]);
    if (!o.length) return null;
    const mand = !!a[as.is_mandatory]; const min = mand ? Math.max(1, a[as.min_limit] || 1) : 0; const max = a[as.max_limit] || 0;
    return { n: String(a[as.name]).replace(/[A-Za-z]?\d+$/, '').trim() || String(a[as.name]), min, max, o };
  };
  const items = [];
  const cats = Object.values(D(cat)).filter((c) => c[cs.is_enable] && c[cs.is_visible]).sort((x, y) => x[cs.sort] - y[cs.sort]);
  for (const c of cats) {
    for (const pid of c[cs.product_list] || []) {
      const p = D(prod)[pid]; if (!p || !p[ps.is_enable] || !p[ps.is_visible]) continue;
      const price = Math.round(Number(p[ps.price])); if (!(price >= 0)) continue;
      const img = ((pimg[pid] || {}).main_image || {}).url || ((p[ps.img_list] || [])[0] || [])[prod.img_schema.url] || '';
      items.push({ cat: String(c[cs.name]), name: String(p[ps.name]), price, img: /^https:\/\//.test(img) ? img : '', groups: (() => { const al = allowedOf(p); return (p[ps.adjust_list] || []).map((id) => adjOf(id, al)); })().filter(Boolean) });
    }
  }
  if (!items.length) throw new Error('菜單沒有任何品項');
  return { store: `${b.brand_name || ''} ${b.store_name || ''}`.trim(), groupName: b.group_buying_name || '', open: b.group_buying_status === 10, items };
}

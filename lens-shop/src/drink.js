// 飲料團：把通用格式的菜單（見 tools/drink-normalize.mjs）轉成網站用的目錄，並驗證下單選項
export function buildDrinkCatalog(m) {
  const t = (v, n) => String(v ?? '').trim().slice(0, n);
  if (!m || !Array.isArray(m.items) || !m.items.length) throw new Error('菜單沒有任何品項');
  if (m.items.length > 400) throw new Error('品項過多（上限 400）');
  const pimgs = {};
  const items = m.items.map((x, i) => {
    const price = Number(x.price);
    if (!x.name || !Number.isFinite(price) || price < 0 || price > 99999) throw new Error(`第 ${i + 1} 項：品名或價格不正確`);
    const groups = (Array.isArray(x.groups) ? x.groups : []).slice(0, 10).map((g) => {
      const o = (Array.isArray(g.o) ? g.o : []).slice(0, 60).map((p) => [t(p[0], 40), Math.max(0, Math.round(Number(p[1]) || 0))]).filter((p) => p[0]);
      if (!o.length) return null;
      const min = Math.max(0, Math.min(o.length, parseInt(g.min, 10) || 0));
      let max = parseInt(g.max, 10) || 0; if (max <= 0 || max > o.length) max = o.length; if (max < min) max = min;
      return { n: t(g.n, 20), min, max, o };
    }).filter(Boolean);
    if (x.img && /^https:\/\/[^\s]+$/i.test(x.img)) pimgs[i + 1] = x.img;
    return { no: i + 1, brand: t(x.cat, 20) || '飲料', name: t(x.name, 80), price: Math.round(price), range: '', market: null, power: false, toric: false, groups };
  });
  const platform = ['ubereats', 'nidin'].includes(m.platform) ? m.platform : '';
  const link = /^https:\/\/[^\s]+$/i.test(m.link || '') ? m.link : '';
  return { catalog: { drink: true, store: t(m.store, 40), platform, link, items, exclusive: [], limited: { title: '', cards: [], note: [] }, specs: null, builtAt: new Date().toISOString() }, pimgs };
}

// 依 l.sel（每組選了哪幾個選項的索引）驗證並算出加價與顯示文字
export function pickDrink(it, l, idx) {
  const sel = Array.isArray(l.sel) ? l.sel : [];
  let extra = 0; const names = []; const clean = [];
  it.groups.forEach((g, gi) => {
    const a = [...new Set((Array.isArray(sel[gi]) ? sel[gi] : []).map(Number).filter((n) => Number.isInteger(n) && n >= 0 && n < g.o.length))];
    if (a.length < g.min) throw new Error(`第 ${idx + 1} 筆（${it.name}）：請選擇「${g.n}」`);
    if (a.length > g.max) throw new Error(`第 ${idx + 1} 筆（${it.name}）：「${g.n}」最多選 ${g.max} 項`);
    a.forEach((n) => { extra += g.o[n][1]; names.push(g.o[n][0]); });
    clean.push(a);
  });
  return { extra, sel: clean, opts: names.join('／') };
}

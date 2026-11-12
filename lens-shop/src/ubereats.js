// Uber Eats 揪團連結解析：揪團頁的 HTML 內已含店名與完整菜單；各品項的選項（冰量／甜度／加料）由 getMenuItemV1 取得
const UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124 Safari/537.36';
const SKIP_SEC = /^(注意事項|茶葉原產地|塑膠袋|購物袋|背心袋)/;
const clean = (s) => String(s).replace(/\s+\d+(?=\s*\(|$)/, '').trim(); // 去掉 Uber 的份量標記（「珍珠 2」→「珍珠」）

export function checkLink(link) {
  let u; try { u = new URL(String(link).trim()); } catch { throw new Error('網址格式不正確'); }
  if (u.protocol !== 'https:') throw new Error('網址需為 https:// 開頭');
  const h = u.hostname;
  if (/(^|\.)ubereats\.com$|^eats\.uber\.com$/.test(h)) {
    if (!/group-orders/.test(u.pathname)) throw new Error('這不是 Uber Eats 的揪團連結（網址需含 group-orders）');
    return { platform: 'ubereats', url: u.origin + u.pathname.replace(/\/join\/?$/, '') + '/join' };
  }
  if (/(^|\.)nidin\.shop$/.test(h)) return { platform: 'nidin', url: u.toString() };
  throw new Error('目前只支援 Uber Eats 揪團連結與你訂開團連結');
}

const dec = (h) => h.split('\\u0022').join('"').split('%5C"').join('"').split('\\"').join('"');

// 回傳 { store, storeUuid, items:[{id,name,price,cat,img,sub}], sec }
export async function parseUberJoin(url) {
  const r = await fetch(url, { headers: { 'user-agent': UA, 'accept-language': 'zh-TW,zh;q=0.9' }, redirect: 'follow' });
  if (!r.ok) throw new Error('Uber Eats 回應 ' + r.status + '（可能擋掉伺服器連線，請改請 Claude 用瀏覽器抓）');
  const t = dec(await r.text());
  const storeUuid = (t.match(/"storeUuid":"([0-9a-f-]{36})"/) || [])[1];
  const store = (t.match(new RegExp('"title":"([^"]+)","uuid":"' + (storeUuid || 'x') + '"')) || [])[1];
  const mapAt = t.indexOf('"catalogSectionsMap":{');
  if (!storeUuid || !store || mapAt < 0) throw new Error('讀不到店家與菜單（連結可能已過期、團單已關閉，或 Uber 擋掉伺服器連線）');
  const seg = t.slice(mapAt, mapAt + 3e6);
  const starts = []; const re = /\{"uuid":"([0-9a-f-]{36})"/g; let m;
  while ((m = re.exec(seg))) starts.push([m.index, m[1]]);
  const secAt = []; const rs = /"standardItemsPayload":\{"title":\{"text":"([^"]*)"/g;
  while ((m = rs.exec(seg))) secAt.push([m.index, m[1]]);
  const subAt = []; const ru = /"catalogSectionUUID":"([0-9a-f-]{36})"/g;
  while ((m = ru.exec(seg))) subAt.push([m.index, m[1]]);
  const keyAt = []; const rk = /"([0-9a-f-]{36})":\[\{"type"/g;
  while ((m = rk.exec(seg))) keyAt.push([m.index, m[1]]);
  const last = (arr, i) => { let v = null; for (const a of arr) { if (a[0] < i) v = a[1]; else break; } return v; };
  const seen = new Map();
  starts.forEach(([i, id], k) => {
    const chunk = seg.slice(i, k + 1 < starts.length ? starts[k + 1][0] : i + 4000).slice(0, 4000);
    const title = (chunk.match(/"title":"([^"]+)"/) || [])[1]; const price = (chunk.match(/"price":(\d+)/) || [])[1];
    const hasItem = /"itemDescription"|"imageUrl"/.test(chunk.slice(0, 700));
    const cat = last(secAt, i);
    if (!title || price == null || !hasItem || !cat || SKIP_SEC.test(cat) || +price <= 0) return;
    const featured = /^(Featured|店長推薦|新品上市|熱銷|人氣|精選)/i.test(cat);
    const cur = seen.get(id);
    if (cur && !(cur.featured && !featured)) return;
    seen.set(id, { id, name: title.trim(), price: Math.round(+price / 100), cat: featured && cur ? cur.cat : cat, featured, img: (chunk.match(/"imageUrl":"([^"]*)"/) || [])[1] || '', sub: last(subAt, i), sec: last(keyAt, i) });
  });
  const items = [...seen.values()].map(({ featured, ...x }) => x);
  if (!items.length) throw new Error('沒有解析到任何品項');
  return { store, storeUuid, items };
}

// 取一批品項的選項群組（每批請控制在 ~30 項以內）
export async function fetchGroups(storeUuid, items) {
  const out = {};
  const one = async (it) => {
    try {
      const r = await fetch('https://www.ubereats.com/_p/api/getMenuItemV1', { method: 'POST', headers: { 'content-type': 'application/json', 'x-csrf-token': 'x', 'user-agent': UA },
        body: JSON.stringify({ storeUuid, menuItemUuid: it.id, sectionUuid: it.sec, subsectionUuid: it.sub, diningMode: 'DELIVERY' }) });
      const j = await r.json();
      if (j.status !== 'success') { out[it.id] = null; return; }
      out[it.id] = (j.data.customizationsList || []).map((g) => ({ n: clean(g.title), min: g.minPermitted || 0, max: g.maxPermitted || 0, o: g.options.filter((o) => !o.isSoldOut).map((o) => [clean(o.title), Math.round((o.price || 0) / 100)]) })).filter((g) => g.o.length);
    } catch { out[it.id] = null; }
  };
  for (let i = 0; i < items.length; i += 8) await Promise.all(items.slice(i, i + 8).map(one));
  return out;
}

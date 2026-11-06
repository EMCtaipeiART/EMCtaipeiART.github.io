// 從 Excel 工作簿組出網站用的目錄資料
import { openBook, readSheet, sheetImages } from './xlsx.js';

const S_QUOTE = '報價單', S_EXCL = '全台獨家活動', S_LIMIT = '期間限定', S_SPEC = '各品牌度數規格';

export function buildCatalog(bytes) {
  const book = openBook(bytes);
  const quote = readSheet(book, S_QUOTE);
  if (!quote) throw new Error('找不到工作表「報價單」');
  const items = [];
  const seen = new Set();
  for (let r = 7; r <= Math.min(quote.maxR, 3000); r++) {
    for (const base of [1, 8]) {
      const no = quote.get(r, base);
      if (typeof no !== 'number') continue;
      const price = quote.get(r, base + 4);
      if (typeof price !== 'number' || seen.has(no)) continue;
      seen.add(no);
      const range = String(quote.get(r, base + 3) ?? '');
      const name = String(quote.get(r, base + 2) ?? '');
      items.push({
        no, brand: String(quote.get(r, base + 1) ?? ''), name, range,
        price, market: typeof quote.get(r, base + 5) === 'number' ? quote.get(r, base + 5) : null,
        power: /\d/.test(range) && /度|~/.test(range) && !/抽|支|ML/i.test(range),
        toric: /散光/.test(name) && !/多焦|定軸/.test(name) ? true : /散光/.test(name),
      });
    }
  }
  items.sort((a, b) => a.no - b.no);
  if (!items.length) throw new Error('「報價單」沒有讀到任何商品（編號／團購價）');

  // 促銷：全台獨家活動 → 依序的文字段落
  const excl = readSheet(book, S_EXCL);
  const exclusive = [];
  if (excl) for (let r = 1; r <= excl.maxR; r++) {
    const parts = [];
    for (let c = 1; c <= excl.maxC; c++) { const v = excl.get(r, c); if (v != null) parts.push(String(v).trim()); }
    if (parts.length) exclusive.push(parts.join('  '));
  }

  // 期間限定：商品卡（編號、型號、框色、片色、價格、照片）
  const images = [];
  const limited = { title: '', cards: [], note: [] };
  const lim = readSheet(book, S_LIMIT);
  if (lim) {
    limited.title = String(lim.get(1, 1) ?? '');
    const imgs = sheetImages(book, S_LIMIT);
    for (let r = 1; r <= lim.maxR; r++) {
      for (const base of [1, 8]) {
        const no = lim.get(r, base);
        if (typeof no !== 'number') continue;
        const img = imgs.find((i) => i.col === base + 1 && i.row >= r - 1 && i.row <= r + 1);
        let imgKey = null;
        if (img) { imgKey = `lim${no}.${img.ext}`; images.push({ key: imgKey, mime: img.mime, data: img.data }); }
        const it = items.find((x) => x.no === no);
        limited.cards.push({
          no, img: imgKey, model: String(lim.get(r, base + 2) ?? '').replace(/\s*\n\s*/g, ' '),
          frame: String(lim.get(r, base + 3) ?? '').trim(), lens: String(lim.get(r, base + 4) ?? '').trim(),
          market: lim.get(r, base + 5) ?? null, price: lim.get(r, base + 6) ?? (it && it.price) ?? null,
          group: base === 1 ? String(lim.get(2, 1) ?? '') : String(lim.get(2, 9) ?? ''),
          inQuote: !!it,
        });
      }
    }
    for (let r = 1; r <= lim.maxR; r++) { // 表格以外的說明文字（A 欄、非標題列）
      const v = lim.get(r, 1);
      if (typeof v === 'string' && r > 3 && !/^編號$/.test(v) && String(v).length > 12) limited.note.push(v);
    }
  }

  // 規格表：整張表格，保留合併儲存格
  const specSheet = readSheet(book, S_SPEC);
  let specs = null;
  if (specSheet) {
    const cols = Math.min(specSheet.maxC, 12);
    const grid = [];
    for (let r = 1; r <= specSheet.maxR; r++) {
      const row = [];
      for (let c = 1; c <= cols; c++) { const v = specSheet.get(r, c); row.push(v == null ? '' : String(v).trim()); }
      grid.push(row);
    }
    specs = { cols, grid, merges: specSheet.merges.filter((m) => m.c1 <= cols).map((m) => ({ ...m, c2: Math.min(m.c2, cols) })) };
  }

  return { catalog: { items, exclusive, limited, specs, builtAt: new Date().toISOString() }, images };
}

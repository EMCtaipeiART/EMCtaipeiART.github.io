// 輕量 xlsx 讀取／回填（不依賴 DOM，Worker 與 Node 皆可）。
// 回填時只直接修改指定儲存格的 XML，其餘（公式、圖片、註解、樣式）原封不動。
import { unzipSync, zipSync } from 'fflate';

const td = new TextDecoder();
const te = new TextEncoder();

const unesc = (s) => s.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;/g, "'")
  .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(+n)).replace(/&#x([0-9a-f]+);/gi, (_, n) => String.fromCodePoint(parseInt(n, 16)))
  .replace(/&amp;/g, '&');
const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

export const colToNum = (c) => { let n = 0; for (const ch of c) n = n * 26 + ch.charCodeAt(0) - 64; return n; };
export const numToCol = (n) => { let s = ''; while (n > 0) { const m = (n - 1) % 26; s = String.fromCharCode(65 + m) + s; n = Math.floor((n - 1) / 26); } return s; };
const splitRef = (r) => { const m = /^([A-Z]+)(\d+)$/.exec(r); return [colToNum(m[1]), +m[2]]; };

function textOf(xml) {
  // <si> 或 <is> 內容；略過注音 <rPh>
  xml = xml.replace(/<rPh[\s\S]*?<\/rPh>/g, '');
  let out = ''; const re = /<t(?:\s[^>]*)?>([\s\S]*?)<\/t>/g; let m;
  while ((m = re.exec(xml))) out += unesc(m[1]);
  return out;
}

export function openBook(bytes) {
  const files = unzipSync(bytes);
  const str = (p) => (files[p] ? td.decode(files[p]) : null);
  const wbXml = str('xl/workbook.xml');
  const rels = {}; const relXml = str('xl/_rels/workbook.xml.rels');
  for (const m of relXml.matchAll(/<Relationship\b[^>]*>/g)) {
    const id = /Id="([^"]+)"/.exec(m[0])[1]; const t = /Target="([^"]+)"/.exec(m[0])[1];
    rels[id] = t.startsWith('/') ? t.slice(1) : 'xl/' + t;
  }
  const sheets = [];
  for (const m of wbXml.matchAll(/<sheet\b[^>]*>/g)) {
    const name = unesc(/name="([^"]*)"/.exec(m[0])[1]); const rid = /r:id="([^"]+)"/.exec(m[0])[1];
    sheets.push({ name, path: rels[rid] });
  }
  const shared = [];
  const ss = str('xl/sharedStrings.xml');
  if (ss) for (const m of ss.matchAll(/<si>([\s\S]*?)<\/si>|<si\/>/g)) shared.push(m[1] ? textOf(m[1]) : '');
  return { files, sheets, shared, str };
}

export function readSheet(book, name) {
  const sh = book.sheets.find((s) => s.name === name);
  if (!sh) return null;
  const xml = book.str(sh.path);
  const cells = new Map(); // "r,c" -> value
  let maxR = 0, maxC = 0;
  const sd = xml.indexOf('<sheetData'); const se = xml.indexOf('</sheetData>');
  const body = sd >= 0 ? xml.slice(sd, se) : '';
  for (const m of body.matchAll(/<c\b([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g)) {
    const attrs = m[1]; const inner = m[2];
    if (!inner) continue;
    const ref = /\br="([A-Z]+\d+)"/.exec(attrs)[1]; const t = (/\bt="([^"]+)"/.exec(attrs) || [])[1];
    let v;
    if (t === 'inlineStr') v = textOf(inner);
    else {
      const vm = /<v>([\s\S]*?)<\/v>/.exec(inner); if (!vm) continue;
      if (t === 's') v = book.shared[+vm[1]];
      else if (t === 'str') v = unesc(vm[1]);
      else if (t === 'b') v = vm[1] === '1';
      else if (t === 'e') continue;
      else v = Number(vm[1]);
    }
    if (v === '' || v === undefined) continue;
    const [c, r] = splitRef(ref); cells.set(r + ',' + c, v);
    if (r > maxR) maxR = r; if (c > maxC) maxC = c;
  }
  const merges = [];
  for (const m of xml.matchAll(/<mergeCell\s+ref="([A-Z]+)(\d+):([A-Z]+)(\d+)"/g))
    merges.push({ r1: +m[2], c1: colToNum(m[1]), r2: +m[4], c2: colToNum(m[3]) });
  return { name, cells, merges, maxR, maxC, get: (r, c) => cells.get(r + ',' + c), path: sh.path };
}

// 回傳 [{row, col, mime, data(Uint8Array)}]（以左上角儲存格為準；row/col 為 1 起算）
export function sheetImages(book, name) {
  const sh = book.sheets.find((s) => s.name === name); if (!sh) return [];
  const dir = sh.path.replace(/[^/]+$/, ''); const base = sh.path.split('/').pop();
  const relXml = book.str(dir + '_rels/' + base + '.rels'); if (!relXml) return [];
  let drawing = null;
  for (const m of relXml.matchAll(/<Relationship\b[^>]*>/g))
    if (/drawing/.test(m[0]) && !/vmlDrawing/.test(m[0])) drawing = norm(dir, /Target="([^"]+)"/.exec(m[0])[1]);
  if (!drawing) return [];
  const dxml = book.str(drawing); if (!dxml) return [];
  const ddir = drawing.replace(/[^/]+$/, ''); const dbase = drawing.split('/').pop();
  const drels = {}; const drx = book.str(ddir + '_rels/' + dbase + '.rels') || '';
  for (const m of drx.matchAll(/<Relationship\b[^>]*>/g))
    drels[/Id="([^"]+)"/.exec(m[0])[1]] = norm(ddir, /Target="([^"]+)"/.exec(m[0])[1]);
  const out = [];
  for (const m of dxml.matchAll(/<xdr:(?:twoCellAnchor|oneCellAnchor)\b[\s\S]*?<\/xdr:(?:twoCellAnchor|oneCellAnchor)>/g)) {
    const a = m[0]; const e = /r:embed="([^"]+)"/.exec(a); if (!e) continue;
    const col = +/<xdr:from>\s*<xdr:col>(\d+)/.exec(a)[1] + 1; const row = +/<xdr:from>[\s\S]*?<xdr:row>(\d+)/.exec(a)[1] + 1;
    const p = drels[e[1]]; const data = book.files[p]; if (!data) continue;
    const ext = p.split('.').pop().toLowerCase();
    out.push({ row, col, mime: ext === 'png' ? 'image/png' : 'image/jpeg', ext, data });
  }
  return out;
}
function norm(dir, target) {
  if (target.startsWith('/')) return target.slice(1);
  const parts = (dir + target).split('/'); const st = [];
  for (const p of parts) { if (p === '..') st.pop(); else if (p && p !== '.') st.push(p); }
  return st.join('/');
}

// ───────── 回填 ─────────
// updates: [{ref:'A8', value: string|number}]，只改這些儲存格（沿用原樣式 s）。
function patchSheetXml(xml, updates) {
  const byRow = new Map();
  for (const u of updates) { const [c, r] = splitRef(u.ref); if (!byRow.has(r)) byRow.set(r, []); byRow.get(r).push({ c, ...u }); }
  return xml.replace(/<row\b([^>]*)>([\s\S]*?)<\/row>|<row\b([^>]*)\/>/g, (whole, a1, inner, a2) => {
    const attrs = a1 ?? a2; const r = +/\br="(\d+)"/.exec(attrs)[1];
    const ups = byRow.get(r); if (!ups) return whole;
    inner = inner || '';
    const cells = [];
    for (const m of inner.matchAll(/<c\b([^>]*?)(?:\/>|>[\s\S]*?<\/c>)/g)) {
      const ref = /\br="([A-Z]+)\d+"/.exec(m[1])[1]; cells.push({ c: colToNum(ref), xml: m[0], attrs: m[1] });
    }
    for (const u of ups) {
      const idx = cells.findIndex((x) => x.c === u.c);
      const old = idx >= 0 ? cells[idx] : null;
      if (old && /<f[\s>\/]/.test(old.xml)) continue; // 絕不覆蓋公式
      const s = old ? (/\bs="(\d+)"/.exec(old.attrs) || [])[1] : undefined;
      const sAttr = s !== undefined ? ` s="${s}"` : '';
      const ref = numToCol(u.c) + r;
      const nx = typeof u.value === 'number'
        ? `<c r="${ref}"${sAttr}><v>${u.value}</v></c>`
        : u.value === '' || u.value == null ? `<c r="${ref}"${sAttr}/>`
          : `<c r="${ref}"${sAttr} t="inlineStr"><is><t xml:space="preserve">${esc(u.value)}</t></is></c>`;
      if (old) old.xml = nx; else { cells.push({ c: u.c, xml: nx }); cells.sort((x, y) => x.c - y.c); }
    }
    return `<row${attrs.replace(/\/$/, '')}>${cells.map((x) => x.xml).join('')}</row>`;
  });
}

export const FORM_FIRST_ROW = 8;
export const FORM_LAST_ROW = 222;

// rows: [{name, no, sph, cyl, axis, qty, gift, personTotal?}]
export function fillForms(bytes, rows) {
  const book = openBook(bytes);
  const formSheets = book.sheets.filter((s) => /^填寫單\d+$/.test(s.name));
  const cap = FORM_LAST_ROW - FORM_FIRST_ROW + 1;
  const edits = {};
  let overflow = 0;
  rows.forEach((row, i) => {
    const si = Math.floor(i / cap);
    if (si >= formSheets.length) { overflow++; return; }
    const r = FORM_FIRST_ROW + (i % cap); const p = formSheets[si].path;
    const u = (edits[p] ||= []);
    u.push({ ref: 'A' + r, value: row.name }, { ref: 'B' + r, value: Number(row.no) });
    if (row.sph !== '' && row.sph != null) u.push({ ref: 'E' + r, value: row.sph });
    if (row.cyl !== '' && row.cyl != null) u.push({ ref: 'F' + r, value: row.cyl });
    if (row.axis !== '' && row.axis != null) u.push({ ref: 'G' + r, value: row.axis });
    u.push({ ref: 'H' + r, value: Number(row.qty) });
    if (row.gift) u.push({ ref: 'L' + r, value: row.gift });
    if (row.personTotal != null) u.push({ ref: 'K' + r, value: row.personTotal });
  });
  const files = { ...book.files };
  for (const [p, ups] of Object.entries(edits)) files[p] = te.encode(patchSheetXml(td.decode(files[p]), ups));
  // 讓 Excel 開檔時重新計算所有公式
  let wb = td.decode(files['xl/workbook.xml']);
  if (/<calcPr\b/.test(wb)) wb = wb.replace(/<calcPr\b([^>]*?)\/>/, (m, a) => '<calcPr' + a.replace(/\sfullCalcOnLoad="[^"]*"/, '') + ' fullCalcOnLoad="1"/>');
  else wb = wb.replace('</workbook>', '<calcPr fullCalcOnLoad="1"/></workbook>');
  files['xl/workbook.xml'] = te.encode(wb);
  return { bytes: zipSync(files, { level: 6 }), overflow, sheetsUsed: Object.keys(edits).length };
}

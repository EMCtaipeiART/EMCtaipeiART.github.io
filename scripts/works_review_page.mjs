#!/usr/bin/env node
// 把中／低信心案件做成本機人工確認頁（file:// 直接讀 NAS 圖）。勾選後可下載 decisions JSON。
// 用法：node scripts/works_review_page.mjs --year 26
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const here = path.dirname(fileURLToPath(import.meta.url));
const args = process.argv.slice(2);
const year = args.includes('--year') ? args[args.indexOf('--year') + 1] : '26';
const mount = '/Volumes/設計部';
const m = JSON.parse(await fs.readFile(path.join(here, '..', 'notes', `works-match-${year}.json`), 'utf8'));
const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const isImg = (p) => /\.(jpe?g|png)$/i.test(p);
const review = m.cases.filter((c) => (c.confidence === 'medium' || c.confidence === 'low') && c.works.length);
const rows = review.map((c) => {
  const works = c.works.slice().sort((a, b) => b.score - a.score).slice(0, 6);
  return `<section data-case="${c.caseId}"><h3>${esc(c.caseId)}｜${esc(c.client)}｜${esc(c.project)} <small>${esc(c.start)}～${esc(c.end)}・${c.confidence}</small></h3><div class="ws">` +
    works.map((w, i) => { const f = w.files.find((x) => isImg(x.p)) || w.files[0]; return `<label class="w"><input type="checkbox" data-case="${c.caseId}" data-stem="${esc(w.stem)}"><img loading="lazy" src="file://${encodeURI(path.join(mount, f.p))}"><span>${esc(w.stem)}<br>相似度 ${w.score}・${w.files.length} 檔</span></label>`; }).join('') +
    `</div></section>`;
}).join('\n');
const html = `<!doctype html><meta charset="utf-8"><title>作品牆人工確認 20${year}</title>
<style>body{font:14px system-ui;margin:16px;background:#fafafa}section{background:#fff;border:1px solid #ddd;border-radius:8px;padding:10px;margin:10px 0}h3{margin:0 0 8px;font-size:14px}small{color:#888;font-weight:400}.ws{display:flex;flex-wrap:wrap;gap:8px}.w{width:170px;font-size:11px;cursor:pointer;border:2px solid transparent;border-radius:6px;padding:3px}.w:has(input:checked){border-color:#2a7;background:#e9f8ef}.w img{width:100%;height:120px;object-fit:contain;background:#eee}.w input{float:left}#bar{position:sticky;top:0;background:#222;color:#fff;padding:8px 12px;border-radius:6px;z-index:2}button{margin-left:12px}</style>
<div id="bar">共 ${review.length} 案。勾選「確實屬於該案件」的作品，未勾選＝不收。<span id="n"></span><button onclick="dl()">下載決定 JSON</button></div>${rows}
<script>const q=()=>[...document.querySelectorAll('input:checked')];document.addEventListener('change',()=>n.textContent='已勾 '+q().length+' 件');
function dl(){const d={year:'${year}',accepted:q().map(i=>({caseId:i.dataset.case,stem:i.dataset.stem}))};const a=document.createElement('a');a.href=URL.createObjectURL(new Blob([JSON.stringify(d,null,1)],{type:'application/json'}));a.download='works-review-decisions-${year}.json';a.click()}</script>`;
const out = path.join(here, '..', 'notes', `works-review-${year}.html`);
await fs.writeFile(out, html);
console.log(`${review.length} 案待確認 → ${out}`);

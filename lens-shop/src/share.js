// 分享連結預覽（LINE／FB 等）：/g/<團購代號> 的頁面帶入該團的團名、收單時間與附註
const esc = (s) => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

function deadlineText(d) { // 設定值為台灣時間 YYYY-MM-DDTHH:mm
  const m = String(d || '').match(/^(\d{4})-(\d\d)-(\d\d)T(\d\d:\d\d)/);
  if (!m) return '';
  return `${+m[2]}/${+m[3]}（${'日一二三四五六'[new Date(Date.UTC(+m[1], m[2] - 1, +m[3])).getUTCDay()]}）${m[4]}`;
}

export function shareMeta(s, ended) {
  const notes = String(s.notes || '').split(/\n+/).map((x) => x.trim()).filter(Boolean).join('｜');
  const dl = deadlineText(s.deadline);
  const parts = ended ? ['此團購已結束'] : [dl && !notes.includes('收單') ? `收單 ${dl}` : ''];
  parts.push(notes);
  const desc = parts.filter(Boolean).join('｜') || '點開選購下單';
  return { title: s.shopName || '凱曜團購平台', desc: desc.length > 120 ? desc.slice(0, 119) + '…' : desc };
}

export function injectShare(html, { title, desc }, url) {
  const tags = `<title>${esc(title)}</title>
<meta name="description" content="${esc(desc)}">
<meta property="og:type" content="website">
<meta property="og:site_name" content="凱曜團購平台">
<meta property="og:title" content="${esc(title)}">
<meta property="og:description" content="${esc(desc)}">
<meta property="og:url" content="${esc(url)}">`;
  return html.replace(/<title>[^<]*<\/title>/, () => tags);
}

const esc = (s) => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const nt = (n) => 'NT$ ' + Number(n).toLocaleString('en-US');

export function fmtDeadline(d) {
  if (!d) return '（尚未設定）';
  const m = /^(\d{4})-(\d{2})-(\d{2})(?:T(\d{2}):(\d{2}))?/.exec(d); if (!m) return d;
  const wd = '日一二三四五六'[new Date(Date.UTC(+m[1], +m[2] - 1, +m[3])).getUTCDay()];
  return `${m[1]}/${m[2]}/${m[3]}（${wd}）${m[4] ? ` ${m[4]}:${m[5]}` : ''}`;
}
export const powerText = (l) => [l.sph && `度數 ${l.sph}`, l.cyl && `散光 ${l.cyl}`, l.axis && `角度 ${l.axis}`].filter(Boolean).join('／');

export const SYSTEM_NOTE = '※ 此為系統自動發送的通知信，請勿直接回覆本信。如有問題請洽團購負責人。';

export function orderMail({ order, settings, link, kind }) {
  const title = { new: '下單完成', update: '訂單已更新', cancel: '訂單已取消' }[kind];
  const shop = settings.shopName;
  const subject = `【${shop}】${title}（訂單 ${order.id}）`;
  const cancelled = kind === 'cancel';
  const rows = order.items.map((l) => `<tr>
    <td style="padding:6px 8px;border-bottom:1px solid #eee">${l.no}</td>
    <td style="padding:6px 8px;border-bottom:1px solid #eee">${esc(l.brand)} ${esc(l.name)}${powerText(l) ? `<br><span style="color:#666;font-size:12px">${esc(powerText(l))}</span>` : ''}${l.gift ? `<br><span style="color:#666;font-size:12px">贈品：${esc(l.gift)}</span>` : ''}</td>
    <td style="padding:6px 8px;border-bottom:1px solid #eee;text-align:right">${nt(l.price)}</td>
    <td style="padding:6px 8px;border-bottom:1px solid #eee;text-align:center">${l.qty}</td>
    <td style="padding:6px 8px;border-bottom:1px solid #eee;text-align:right">${nt(l.price * l.qty)}</td></tr>`).join('');
  const bank = settings.bankAccount
    ? `<p style="margin:4px 0">銀行：${esc(settings.bankName)}<br>帳號：<b style="font-size:16px">${esc(settings.bankAccount)}</b><br>戶名：${esc(settings.accountName)}</p>` : '<p style="margin:4px 0;color:#888">（匯款帳號尚未設定）</p>';
  const html = `<div style="font-family:-apple-system,'Microsoft JhengHei',sans-serif;max-width:640px;margin:auto;color:#222">
  <h2 style="margin:0 0 8px">${esc(shop)}｜${title}</h2>
  <p>${esc(order.name)} 您好，${cancelled ? '您的訂單已取消，以下為取消前的內容。' : '以下是您的訂單內容：'}</p>
  <p style="margin:4px 0;color:#666">訂單編號：${order.id}</p>
  <table style="border-collapse:collapse;width:100%;font-size:14px"><thead><tr style="background:#f4f4f4">
    <th style="padding:6px 8px;text-align:left">編號</th><th style="padding:6px 8px;text-align:left">品項</th><th style="padding:6px 8px;text-align:right">單價</th><th style="padding:6px 8px">數量</th><th style="padding:6px 8px;text-align:right">小計</th></tr></thead><tbody>${rows}</tbody></table>
  <p style="text-align:right;font-size:18px;margin:12px 0"><b>${cancelled ? '原訂單金額' : '應付金額'}：${nt(order.total)}</b></p>
  ${cancelled ? '' : `<div style="background:#f7f9fc;border-radius:8px;padding:12px 14px;margin:12px 0"><b>匯款資訊</b>${bank}<p style="margin:6px 0 0;color:#666;font-size:13px">匯款後請回覆此信或告知後 5 碼，以便核對。</p></div>
  <p><b>截止日期：${esc(fmtDeadline(settings.deadline))}</b>（截止前都可以修改訂單）</p>
  <p><a href="${esc(link)}" style="display:inline-block;background:#1c64f2;color:#fff;padding:10px 18px;border-radius:6px;text-decoration:none">查看／修改我的訂單</a><br><span style="color:#888;font-size:12px">此連結為您個人專屬，請勿轉寄他人：${esc(link)}</span></p>`}
  ${settings.notes ? `<p style="color:#666;font-size:13px;white-space:pre-line">${esc(settings.notes)}</p>` : ''}<hr style="border:0;border-top:1px solid #eee;margin:18px 0 8px"><p style="color:#999;font-size:12px">${SYSTEM_NOTE}</p></div>`;
  const text = [`${shop}｜${title}`, `訂單編號：${order.id}`, '',
    ...order.items.map((l) => `${l.no} ${l.brand} ${l.name} ${powerText(l)} ${nt(l.price)} x ${l.qty} = ${nt(l.price * l.qty)}`), '',
    `金額：${nt(order.total)}`, cancelled ? '' : `匯款：${settings.bankName} ${settings.bankAccount} ${settings.accountName}`,
    cancelled ? '' : `截止日期：${fmtDeadline(settings.deadline)}`, cancelled ? '' : `修改訂單：${link}`, '', SYSTEM_NOTE].join('\n');
  return { subject, html, text };
}

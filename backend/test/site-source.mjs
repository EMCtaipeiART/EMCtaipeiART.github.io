import { readFile } from 'node:fs/promises';

/** index.html 的程式與樣式拆成 site.js / site.css（可被瀏覽器快取），測試要檢查原始碼時把三個檔案合在一起讀。 */
export async function readSite() {
  const parts = await Promise.all(['index.html', 'site.js', 'site.css'].map(name => readFile(new URL(`../../${name}`, import.meta.url), 'utf8')));
  return parts.join('\n');
}

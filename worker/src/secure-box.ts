/**
 * 靜態資料加密（AES-GCM 256）。金鑰放在 Worker 的 Secret（NOTEBOOK_KEY，base64 的 32 位元組），
 * 不在程式碼、不在資料庫、不在公開倉庫；資料庫或備份檔外流時，沒有金鑰就讀不出內容。
 * 密文格式：'enc1:' + base64(12 位元組 IV + 密文)。
 */
const PREFIX = 'enc1:';
const b64 = (bytes: Uint8Array): string => { let s = ''; bytes.forEach(b => { s += String.fromCharCode(b); }); return btoa(s); };
const unb64 = (value: string): Uint8Array => Uint8Array.from(atob(value), c => c.charCodeAt(0));

export const isSealed = (value: string): boolean => typeof value === 'string' && value.startsWith(PREFIX);

export async function importBoxKey(base64Key: string | undefined): Promise<CryptoKey | null> {
  const raw = String(base64Key || '').trim();
  if (!raw) return null;
  const bytes = unb64(raw);
  if (bytes.length !== 32) throw new Error('NOTEBOOK_KEY 必須是 32 位元組（base64）');
  return crypto.subtle.importKey('raw', bytes.buffer as ArrayBuffer, 'AES-GCM', false, ['encrypt', 'decrypt']);
}

export async function sealText(key: CryptoKey, plain: string): Promise<string> {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const cipher = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, new TextEncoder().encode(plain)));
  const out = new Uint8Array(iv.length + cipher.length);
  out.set(iv); out.set(cipher, iv.length);
  return PREFIX + b64(out);
}

export async function openText(key: CryptoKey, sealed: string): Promise<string> {
  const bytes = unb64(sealed.slice(PREFIX.length));
  const plain = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: bytes.slice(0, 12) }, key, bytes.slice(12));
  return new TextDecoder().decode(plain);
}

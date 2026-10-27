// Формат шифрования: Web Crypto, отдельный контекст роли и назначения файла.
// Старые PBKDF2-конверты читаем с их iter; новые создаём с 600 000 итераций.
const KDF_WORK = 600000;
const gzipAvailable = typeof CompressionStream !== 'undefined' && typeof DecompressionStream !== 'undefined';
function cryptoB64(bytes) {
  let s = '';
  for (let i = 0; i < bytes.length; i += 32768) s += String.fromCharCode.apply(null, bytes.subarray(i, i + 32768));
  return btoa(s);
}
function cryptoBytes(value, size) {
  if (typeof value !== 'string' || value.length > 200000000 || !/^[A-Za-z0-9+/]*={0,2}$/.test(value)) throw new Error('INVALID_CATALOG');
  const bytes = Uint8Array.from(atob(value), (c) => c.charCodeAt(0));
  if (size && bytes.length !== size) throw new Error('INVALID_CATALOG');
  return bytes;
}
async function passwordKey(password, salt, iter) {
  if (!Number.isSafeInteger(iter) || iter < 100000 || iter > 2000000) throw new Error('INVALID_CATALOG');
  const base = await crypto.subtle.importKey('raw', new TextEncoder().encode(password), 'PBKDF2', false, ['deriveKey']);
  return crypto.subtle.deriveKey({ name: 'PBKDF2', salt, iterations: iter, hash: 'SHA-256' }, base,
    { name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']);
}
function cipherOptions(iv, context) {
  return { name: 'AES-GCM', iv, ...(context ? { additionalData: new TextEncoder().encode(context) } : {}) };
}
export const importCatalogKey = (raw) => crypto.subtle.importKey('raw', raw, 'AES-GCM', false, ['encrypt', 'decrypt']);
export async function keyEncrypt(key, obj, context = '') {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  let bytes = new TextEncoder().encode(JSON.stringify(obj));
  let z = null;
  if (gzipAvailable) {
    bytes = new Uint8Array(await new Response(new Blob([bytes]).stream().pipeThrough(new CompressionStream('gzip'))).arrayBuffer());
    z = 'gz';
  }
  const ct = new Uint8Array(await crypto.subtle.encrypt(cipherOptions(iv, context), key, bytes));
  return JSON.stringify({ v: 2, alg: 'AES-GCM', z, iv: cryptoB64(iv), data: cryptoB64(ct) });
}
export async function keyDecrypt(key, blob, context = '') {
  const env = typeof blob === 'string' ? JSON.parse(blob) : blob;
  if (!env || ![1, 2].includes(env.v) || (context && env.v !== 2) || (env.alg && env.alg !== 'AES-GCM')
    || (env.z != null && env.z !== 'gz')) throw new Error('INVALID_CATALOG');
  const ct = cryptoBytes(env.data);
  if (ct.length < 16) throw new Error('INVALID_CATALOG');
  let plain;
  try { plain = new Uint8Array(await crypto.subtle.decrypt(cipherOptions(cryptoBytes(env.iv, 12), context), key, ct)); }
  catch (e) { throw new Error('INVALID_CATALOG'); }
  if (env.z === 'gz') {
    if (!gzipAvailable) throw new Error('COMPRESSION_UNAVAILABLE');
    plain = new Uint8Array(await new Response(new Blob([plain]).stream().pipeThrough(new DecompressionStream('gzip'))).arrayBuffer());
  }
  return JSON.parse(new TextDecoder().decode(plain));
}
export async function wrapCatalogKey(raw, password, context = '') {
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const kek = await passwordKey(password, salt, KDF_WORK);
  const ct = new Uint8Array(await crypto.subtle.encrypt(cipherOptions(iv, context), kek, raw));
  return { v: 2, kdf: 'PBKDF2', iter: KDF_WORK, salt: cryptoB64(salt), iv: cryptoB64(iv), data: cryptoB64(ct) };
}
export async function unwrapCatalogKey(entry, password, context = '') {
  if (!entry || entry.kdf !== 'PBKDF2' || (context && entry.v !== 2)) throw new Error('INVALID_CATALOG');
  const kek = await passwordKey(password, cryptoBytes(entry.salt, 16), entry.iter);
  const raw = new Uint8Array(await crypto.subtle.decrypt(cipherOptions(cryptoBytes(entry.iv, 12), context), kek, cryptoBytes(entry.data)));
  if (raw.length !== 32) throw new Error('INVALID_CATALOG');
  return raw;
}
export async function passwordEncrypt(obj, password) {
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const key = await passwordKey(password, salt, KDF_WORK);
  const env = JSON.parse(await keyEncrypt(key, obj));
  return JSON.stringify({ ...env, v: 1, kdf: 'PBKDF2', iter: KDF_WORK, salt: cryptoB64(salt) });
}
export async function passwordDecrypt(blob, password) {
  const env = typeof blob === 'string' ? JSON.parse(blob) : blob;
  if (!env || env.v !== 1 || env.kdf !== 'PBKDF2') throw new Error('INVALID_CATALOG');
  const key = await passwordKey(password, cryptoBytes(env.salt, 16), env.iter);
  return keyDecrypt(key, env);
}

// Независимая фикстура формата до PR #53 (publish.js, коммит 4286e48).
// Не импортирует новый шифратор: прежние части НЕ имели v/alg и писали z: 'gzip'.
// Все ключи, пароли и данные — тестовые; файлы магазина не используются.
const { webcrypto, createHash } = require('node:crypto');
const { gzipSync } = require('node:zlib');
const b64 = (bytes) => Buffer.from(bytes).toString('base64');
const random = (size) => webcrypto.getRandomValues(new Uint8Array(size));

async function passwordKey(password, salt) {
  const base = await webcrypto.subtle.importKey('raw', new TextEncoder().encode(password), 'PBKDF2', false, ['deriveKey']);
  return webcrypto.subtle.deriveKey({ name: 'PBKDF2', salt, iterations: 150000, hash: 'SHA-256' },
    base, { name: 'AES-GCM', length: 256 }, false, ['encrypt']);
}
async function encryptPart(key, value, compress) {
  const iv = random(12), bytes = Buffer.from(JSON.stringify(value));
  const data = await webcrypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, compress ? gzipSync(bytes) : bytes);
  return { z: compress ? 'gzip' : null, iv: b64(iv), data: b64(data) };
}
async function wrapKey(raw, password) {
  const salt = random(16), iv = random(12), key = await passwordKey(password, salt);
  const data = await webcrypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, raw);
  return { kdf: 'PBKDF2', iter: 150000, salt: b64(salt), iv: b64(iv), data: b64(data) };
}
function partIndex(id, n) {
  const s = String(id); let h = 2166136261;
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); }
  return (h >>> 0) % n;
}
async function legacyCatalogFiles(snapshot, ownerPassword, staffPassword, { compress = true, prefix = 'data' } = {}) {
  const files = new Map(), raw = random(32);
  const key = await webcrypto.subtle.importKey('raw', raw, 'AES-GCM', false, ['encrypt']);
  const keys = { v: 3, owner: await wrapKey(raw, ownerPassword), staff: await wrapKey(raw, staffPassword) };
  files.set(`${prefix}/keys.json`, JSON.stringify(keys));
  const head = { ...snapshot, staffPassword }, sets = {};
  for (const [name, n, field] of [['products', 24, 'id'], ['prices', 12, 'product_id'], ['sales', 6, 'code']]) {
    delete head[name];
    const parts = Array.from({ length: n }, () => []), hashes = [];
    for (const row of snapshot[name] || []) parts[partIndex(row[field] || row.name, n)].push(row);
    for (let i = 0; i < n; i++) {
      hashes.push(createHash('sha256').update(JSON.stringify(parts[i])).digest('hex').slice(0, 16));
      files.set(`${prefix}/sec/${name}-${String(i).padStart(2, '0')}.enc`, JSON.stringify(await encryptPart(key, parts[i], compress)));
    }
    sets[name] = { n, h: hashes };
  }
  files.set(`${prefix}/catalog.enc`, JSON.stringify(await encryptPart(key, { v: 3, head, sets }, compress)));
  return files;
}
async function legacyWholeFile(snapshot, password, compress = true) {
  const salt = random(16), key = await passwordKey(password, salt);
  return JSON.stringify({ v: 1, alg: 'AES-GCM', kdf: 'PBKDF2', iter: 150000, salt: b64(salt),
    ...await encryptPart(key, snapshot, compress) });
}
module.exports = { legacyCatalogFiles, legacyWholeFile };

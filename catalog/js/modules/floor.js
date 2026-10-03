// Вход «Сотрудника зала»: отдельный зашифрованный файл без денег
//
// Сотрудник зала входит общим кодом и видит данные для кассы, но НЕ деньги.
// Поэтому для него на GitHub лежит ОТДЕЛЬНЫЙ файл floor.enc — в нём только
// безденежные данные (см. floordata.js). Файл публичный, открывается кодом
// зала. Поскольку файл можно скачать, код подбираем офлайн — поэтому:
//   • в floor.enc денег нет вовсе (даже подобравший код не получит закупки);
//   • код зала не короткий ПИН (просим минимум 8 символов / фразу);
//   • шифрование усилено (PBKDF2 310 000 итераций) — перебор дороже.
// Стойкость «лимитом попыток» мы НЕ обещаем: защита — в составе данных и коде.

import { CFG, state } from './store.js';
import { ghCommit } from './publish.js';
import { buildIndex } from './catalog.js';
import { byName } from './data.js';
import { renderAll } from './render.js';
import { buildFloorData } from './floordata.js';

const FLOOR_FILE = 'floor.enc';
const FLOOR_ITER = 310000;          // усиленный PBKDF2 для публичного файла зала

// ── Примитивы шифрования (AES-GCM, ключ из кода через PBKDF2) ──────────────
async function deriveKey(code, salt) {
  const base = await crypto.subtle.importKey('raw', new TextEncoder().encode(code), 'PBKDF2', false, ['deriveKey']);
  return crypto.subtle.deriveKey(
    { name: 'PBKDF2', salt, iterations: FLOOR_ITER, hash: 'SHA-256' },
    base, { name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']);
}
function b64(bytes) { let s = ''; const CH = 0x8000; for (let i = 0; i < bytes.length; i += CH) s += String.fromCharCode.apply(null, bytes.subarray(i, i + CH)); return btoa(s); }
function unb64(str) { const bin = atob(str); const a = new Uint8Array(bin.length); for (let i = 0; i < bin.length; i++) a[i] = bin.charCodeAt(i); return a; }
const canGzip = typeof CompressionStream !== 'undefined' && typeof DecompressionStream !== 'undefined';
async function gzip(u8) { const st = new Blob([u8]).stream().pipeThrough(new CompressionStream('gzip')); return new Uint8Array(await new Response(st).arrayBuffer()); }
async function gunzip(u8) { const st = new Blob([u8]).stream().pipeThrough(new DecompressionStream('gzip')); return new Uint8Array(await new Response(st).arrayBuffer()); }

export async function encryptFloor(obj, code) {
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const key = await deriveKey(code, salt);
  let bytes = new TextEncoder().encode(JSON.stringify(obj));
  let z = null;
  if (canGzip) { bytes = await gzip(bytes); z = 'gzip'; }
  const ct = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, bytes));
  return JSON.stringify({ v: 1, alg: 'AES-GCM', kdf: 'PBKDF2', iter: FLOOR_ITER, z, salt: b64(salt), iv: b64(iv), data: b64(ct) });
}
export async function decryptFloor(blob, code) {
  const env = typeof blob === 'string' ? JSON.parse(blob) : blob;
  const key = await deriveKey(code, unb64(env.salt));
  // неверный код → decrypt бросит исключение (AES-GCM проверяет целостность)
  let plain = new Uint8Array(await crypto.subtle.decrypt({ name: 'AES-GCM', iv: unb64(env.iv) }, key, unb64(env.data)));
  if (env.z === 'gzip') plain = await gunzip(plain);
  return JSON.parse(new TextDecoder().decode(plain));
}

// ── Публикация файла зала (владелец) ───────────────────────────────────────
// Вызывается из общей публикации, когда владелец задал код зала.
export async function publishFloor(code) {
  const pass = code || state.floorPassword;
  if (!pass) return null;
  const data = buildFloorData(state.products, state.groups);
  const blob = await encryptFloor(data, pass);
  return ghCommit([{ path: `${CFG.DATA_PATH}/${FLOOR_FILE}`, content: blob }], 'Каталог: данные для сотрудников зала');
}

// ── Применить данные зала к приложению (роль zal, без денег) ────────────────
export function applyFloorSnapshot(data) {
  state.groups = data.groups || [];
  state.suppliers = [];
  state.products = (data.products || []).slice().sort(byName);
  state.prices = []; state.sales = []; state.contacts = {};
  state.competitors = []; state.compPrices = [];
  state.serverless = true;
  state.session = { user: { email: 'floor' }, serverless: true, floor: true };
  state.isAdmin = false; state.role = 'zal';
  state.canPurchase = false; state.canSales = false;   // деньги в UI скрыты этими флагами
  buildIndex();
  renderAll();
}

// ── Вход сотрудника по коду зала ────────────────────────────────────────────
function rawUrl() {
  return `https://raw.githubusercontent.com/${CFG.GITHUB_OWNER}/${CFG.GITHUB_REPO}/${CFG.GITHUB_BRANCH || 'main'}/${CFG.DATA_PATH}/${FLOOR_FILE}`;
}
export async function unlockFloor(code) {
  const r = await fetch(rawUrl() + '?t=' + Date.now(), { cache: 'no-store' });
  if (r.status === 404) throw new Error('NO_FLOOR');     // код зала ещё не задан владельцем
  if (!r.ok) throw new Error('Не удалось скачать данные (' + r.status + ')');
  const data = await decryptFloor(await r.text(), code); // неверный код → исключение
  applyFloorSnapshot(data);
  return 'zal';
}

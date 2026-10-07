// Данные и шифрование для «Сотрудника зала» — без денег, без зависимостей
//
// Модуль намеренно НИ ОТ ЧЕГО не зависит (чистый): его используют и публикация
// (publish.js, сборка floor.enc одним коммитом), и вход (floor.js). Так нет
// циклов импорта.
//
// Сотрудник зала видит данные для кассы (код, штрихкоды, артикул, отдел,
// группа, фото, наличие словом), но НИКОГДА — деньги. Поэтому:
//   • в floor-данные переносятся только разрешённые поля и только примитивы;
//   • массивы (photos/barcodes) — только строковые/числовые элементы;
//   • свободный note НЕ включаем (там может оказаться сумма закупки);
//   • файл floor.enc публичный, код подбираем офлайн → шифрование усилено
//     (PBKDF2 310 000), а в самом файле денег нет вовсе.

const FLOOR_SCALAR = [
  'id', 'name', 'code', 'article', 'department', 'group_id', 'category',
  'is_weighted', 'unit', 'retail_price', 'arrival_at', 'created_at', 'stock_state',
];
const FLOOR_ARRAY = ['photos', 'barcodes'];
/* Чего в данных зала нет НИКОГДА (белый список выше это и обеспечивает):
   закупки и наценка, продажи, контакты и сами поставщики, заказы, цены
   конкурентов, пароли, свободное примечание, остаток числом. История
   РОЗНИЧНОГО ценника есть: по ней сотрудник перепечатывает ценники, а цен
   закупки в ней нет по устройству (см. retailHist ниже).
   Проверяется тестами floor-data.js и floor-crypto.js. */

/* Что можно положить в публикуемый файл. Защита от «утечки через поле»: в данные
 * попадают только примитивы, а в списки (фото, штрихкоды) — только строки и числа.
 * Нужна в двух местах — витрине (publish.js) и данных зала — поэтому живёт здесь
 * одна: разойдись копии, и в один из файлов уехало бы лишнее. */
export const isPrim = (v) => typeof v === 'string' || typeof v === 'number' || typeof v === 'boolean';
export const primStrings = (arr) => (Array.isArray(arr)
  ? arr.filter((x) => typeof x === 'string' || typeof x === 'number').map(String).filter((s) => s.trim())
  : []);

function floorProduct(p) {
  const o = {};
  if (!p || typeof p !== 'object') return o;
  for (const k of FLOOR_SCALAR) if (p[k] != null && isPrim(p[k])) o[k] = p[k];
  for (const k of FLOOR_ARRAY) {
    const arr = primStrings(p[k]);
    if (arr.length) o[k] = arr;
  }
  return o;
}

/* История розничного ценника: {id товара: [{price, at}]}. Берём только то,
 * что относится к переданным товарам, и только числа с датами — никаких
 * вложенных объектов. Закупочных цен тут нет: их хранит отдельный state.prices,
 * который в данные зала не попадает вовсе. */
function floorRetailHist(hist, products) {
  const out = {};
  if (!hist || typeof hist !== 'object') return out;
  const ids = new Set((products || []).map((p) => p && p.id).filter(Boolean));
  for (const [id, rows] of Object.entries(hist)) {
    if (!ids.has(id) || !Array.isArray(rows)) continue;
    const keep = rows
      .filter((r) => r && Number(r.price) > 0 && typeof r.at === 'string')
      .map((r) => ({ price: Number(r.price), at: r.at }));
    if (keep.length) out[id] = keep;
  }
  return out;
}

export function buildFloorData(products, groups, retailHist) {
  return {
    v: 2,
    products: (products || []).map(floorProduct),
    retailHist: floorRetailHist(retailHist, products),
    groups: (groups || []).map((g) => ({
      id: isPrim(g.id) ? g.id : '',
      name: isPrim(g.name) ? g.name : '',
      sort_order: typeof g.sort_order === 'number' ? g.sort_order : 0,
    })),
  };
}

// ── Шифрование файла зала (AES-GCM, ключ из кода через PBKDF2) ──────────────
const FLOOR_ITER = 310000;   // усиленный PBKDF2: файл публичный
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
  let plain = new Uint8Array(await crypto.subtle.decrypt({ name: 'AES-GCM', iv: unb64(env.iv) }, key, unb64(env.data)));
  if (env.z === 'gzip') plain = await gunzip(plain);
  return JSON.parse(new TextDecoder().decode(plain));
}

// Имя файла зала в папке данных (используют и публикация, и вход).
export const FLOOR_FILE = 'floor.enc';

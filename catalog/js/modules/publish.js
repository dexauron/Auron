// Публикация на GitHub: шифрование, снимки, вход по паролю

import { $, CFG, state, ui } from './store.js';
import { norm, toast } from './core.js';
import { buildIndex } from './catalog.js';
import { renderAll } from './render.js';
import { orderRules } from './card.js';
import { byName, saveCache } from './data.js';
import { autoDedup } from './photos.js';
import { digest, partName, pool, shard } from './parts.js';

/* ── Публикация каталога на GitHub (бесплатно, без сервера) ──────────────
   Владелец один раз вставляет «ключ» (GitHub token) — он хранится ТОЛЬКО на
   устройстве (localStorage), в репозиторий/код не попадает. Через него
   приложение сохраняет файлы каталога прямо на GitHub одним коммитом (атомарно,
   чтобы деплой срабатывал один раз). Витрина — публично; секретное (закупка,
   «Ходовые») позже уедет в зашифрованный файл. */
export const GH_TOKEN_KEY = 'wm_gh_token';
export function ghToken() { try { return localStorage.getItem(GH_TOKEN_KEY) || ''; } catch (e) { return ''; } }
export function ghSetToken(t) { try { if (t) localStorage.setItem(GH_TOKEN_KEY, t); else localStorage.removeItem(GH_TOKEN_KEY); } catch (e) { /* приватный режим */ } }
export function ghConfigured() { return !!(ghToken() && CFG.GITHUB_OWNER && CFG.GITHUB_REPO); }
export const ghRepo = () => `/repos/${CFG.GITHUB_OWNER}/${CFG.GITHUB_REPO}`;
export const ghBranch = () => CFG.GITHUB_BRANCH || 'main';

export async function ghApi(path, opts = {}) {
  return fetch('https://api.github.com' + path, {
    ...opts,
    headers: {
      Authorization: 'Bearer ' + ghToken(),
      Accept: 'application/vnd.github+json',
      'X-GitHub-Api-Version': '2022-11-28',
      ...(opts.headers || {}),
    },
  });
}
async function ghJson(path, opts) {
  const r = await ghApi(path, opts);
  if (!r.ok) throw new Error('GitHub ' + ((opts && opts.method) || 'GET') + ' ' + path + ' → ' + r.status + ' ' + (await r.text()).slice(0, 200));
  return r.json();
}

// Один коммит с несколькими файлами (текстовыми). files: [{path, content}],
// path — от корня репозитория. content === null — файл удаляется.
// При параллельной правке (ветка ушла вперёд) один раз перечитываем вершину
// ветки и повторяем. onProgress(готово, всего) — для показа хода публикации.
export async function ghCommit(files, message, opts = {}) {
  const { onProgress = null, retry = true } = opts;
  const b = ghBranch();
  const ref = await ghJson(`${ghRepo()}/git/ref/heads/${b}`);
  const baseCommit = ref.object.sha;
  const baseInfo = await ghJson(`${ghRepo()}/git/commits/${baseCommit}`);
  // Каждый файл заливаем ОТДЕЛЬНЫМ запросом и складываем в дерево по ссылке.
  // Раньше всё содержимое шло одним запросом — на большом каталоге он весил
  // десятки мегабайт и обрывался («Failed to fetch»). Пачками по четыре:
  // по одному — долго, все разом — GitHub отвечает ошибкой.
  let done = 0;
  if (onProgress) onProgress(0, files.length);
  const entries = await pool(files, 4, async (f) => {
    if (f.content == null) { done++; if (onProgress) onProgress(done, files.length); return { path: f.path, mode: '100644', type: 'blob', sha: null }; }
    const blob = await ghJson(`${ghRepo()}/git/blobs`, {
      method: 'POST',
      body: JSON.stringify({ content: f.content, encoding: 'utf-8' }),
    });
    done++;
    if (onProgress) onProgress(done, files.length);
    return { path: f.path, mode: '100644', type: 'blob', sha: blob.sha };
  });
  const tree = await ghJson(`${ghRepo()}/git/trees`, {
    method: 'POST',
    body: JSON.stringify({ base_tree: baseInfo.tree.sha, tree: entries }),
  });
  const commit = await ghJson(`${ghRepo()}/git/commits`, {
    method: 'POST',
    body: JSON.stringify({ message: message || 'обновление каталога', tree: tree.sha, parents: [baseCommit] }),
  });
  const upd = await ghApi(`${ghRepo()}/git/refs/heads/${b}`, { method: 'PATCH', body: JSON.stringify({ sha: commit.sha }) });
  if (!upd.ok) {
    if ((upd.status === 409 || upd.status === 422) && retry) return ghCommit(files, message, { ...opts, retry: false });
    throw new Error('GitHub PATCH ref → ' + upd.status + ' ' + (await upd.text()).slice(0, 200));
  }
  return commit.sha;
}

// Витринные поля — что можно показывать покупателю (тот же белый список, что и
// в скрипте выгрузки). Секретное сюда не попадает.
// arrival_at (только дата, без поставщика и закупочной цены) нужен покупателю:
// на нём держится сортировка «Новее». Без него она у покупателя ничего не делала.
// Код товара показываем всем: с ним покупателю проще объяснить кассиру, что
// он берёт, и найти товар поиском по коду. Секретного в нём ничего нет —
// в отличие от артикула, штрихкодов, поставщиков и закупочных цен.
const PUBLIC_FIELDS = ['id', 'name', 'code', 'category', 'group_id', 'retail_price', 'is_weighted', 'unit', 'description', 'photos', 'arrival_at'];

/* Наличие товара — для СОТРУДНИКА, только после входа.
 * Сначала я положил признак наличия в ОТКРЫТЫЙ файл витрины, рассуждая
 * «покупателю полезно». Это было нарушением утверждённого правила: каталог —
 * инструмент сотрудников, ссылка публичная, и без входа он не показывает ни
 * цен, ни остатков. Слово «заканчивается» — тот же остаток, просто
 * округлённый. Теперь наличие считается на устройстве вошедшего из живого
 * числа и наружу не уходит вовсе.
 * «Заканчивается» — если известны продажи и хватит меньше чем на 2 дня,
 * иначе по простому порогу. Остатков не загружали — молчим. */
const LOW_DAYS = 2;      // хватит меньше — «заканчивается»
const LOW_QTY = 3;       // если продажи неизвестны — просто мало штук

export function stockState(p, perDay) {
  const q = p.stock != null ? Number(p.stock) : (p.stock_qty != null ? Number(p.stock_qty) : null);
  if (q == null || !Number.isFinite(q)) return null;
  if (q <= 0) return 'out';
  if (perDay > 0 ? q / perDay < LOW_DAYS : q <= LOW_QTY) return 'low';
  return 'in';
}

export function buildPublicProducts() {
  return state.products
    .map((p) => {
      const o = {};
      for (const k of PUBLIC_FIELDS) if (p[k] != null) o[k] = p[k];
      // даты кладём без времени — «Новее» нужна только дата, а витрину качает
      // каждый покупатель, лишние 14 символов на товар тут заметны
      if (o.arrival_at) o.arrival_at = String(o.arrival_at).slice(0, 10);
      // запасная дата: если товар ни разу не попадал в файл цен, «Новее»
      // сортирует хотя бы по дате появления в каталоге
      if (p.created_at) o.created_at = String(p.created_at).slice(0, 10);
      return o;
    })
    .sort((a, b) => String(a.name).localeCompare(String(b.name), 'ru'));
}
function buildPublicGroups() {
  return state.groups.map((g) => ({ id: g.id, name: g.name, sort_order: g.sort_order }));
}
// «Популярное» по продажам: суммируем проданное количество на товар (из данных
// продаж, товар ищем по коду → названию), берём топ. Публикуется отдельным
// списком id — видно всем (и покупателям), без раскрытия самих цифр продаж.
export function buildPopularIds() {
  if (!state.sales || !state.sales.length) return [];
  const byCode = new Map(), byName = new Map();
  for (const p of state.products) { if (p.code) byCode.set(String(p.code), p); byName.set(norm(p.name), p); }
  const qty = new Map();
  for (const s of state.sales) {
    const p = (s.code && byCode.get(String(s.code))) || byName.get(norm(s.name || ''));
    if (!p) continue;
    qty.set(p.id, (qty.get(p.id) || 0) + (Number(s.qty) || 0));
  }
  return [...qty.entries()].filter(([, q]) => q > 0).sort((a, b) => b[1] - a[1]).slice(0, 40).map(([id]) => id);
}

/* ── Витрина по частям ──────────────────────────────────────────────────────
   Витрина лежит кусками `data/p/00.json…`, рядом — опись `data/index.json`
   с подписью каждого куска. Публикуем только те куски, чья подпись изменилась;
   приложение по той же описи докачивает только изменившиеся (подпись стоит в
   адресе, поэтому остальное берётся из кэша браузера).
   Старый цельный `products.json` продолжаем читать — но больше не пишем. */
const PUB_PARTS = 16;              // кусков витрины
const PUB_DIR = 'p';               // папка кусков витрины
const INDEX_FILE = 'index.json';   // опись витрины
const LEGACY_FILE = 'products.json';      // старый цельный файл (только чтение)

async function showcaseFiles(prev) {
  const parts = shard(buildPublicProducts(), PUB_PARTS, (p) => p.id);
  const files = [];
  const hashes = [];
  for (let i = 0; i < PUB_PARTS; i++) {
    const json = JSON.stringify(parts[i]);
    const h = await digest(json);
    hashes.push(h);
    if (!prev || (prev.parts || [])[i] !== h) files.push({ path: `${CFG.DATA_PATH}/${PUB_DIR}/${partName(i)}.json`, content: json });
  }
  const gJson = JSON.stringify(buildPublicGroups());
  const gHash = await digest(gJson);
  if (!prev || prev.groups !== gHash) files.push({ path: `${CFG.DATA_PATH}/groups.json`, content: gJson });
  const popJson = JSON.stringify(buildPopularIds());
  const popHash = await digest(popJson);
  if (!prev || prev.popular !== popHash) files.push({ path: `${CFG.DATA_PATH}/popular.json`, content: popJson });
  const index = { v: 2, savedAt: new Date().toISOString(), n: PUB_PARTS, parts: hashes, groups: gHash, popular: popHash };
  return { files, index };
}

// опись прошлой публикации: что уже лежит на GitHub
async function loadPubIndex() {
  try {
    const raw = await fetchRaw(INDEX_FILE);
    if (!raw) return null;
    const idx = JSON.parse(raw);
    return idx && idx.v === 2 ? idx : null;
  } catch (e) { return null; }   // нет связи — считаем, что описи нет: перезальём всё
}

// Опубликовать витрину (товары + категории) одним коммитом на GitHub.
// Уезжают только изменившиеся куски; ничего не изменилось — коммита нет
// (раньше «изменилось ли» помнило само устройство, и на новом телефоне оно
// перезаливало витрину зря; теперь сверяемся с описью на самом GitHub).
export async function publishShowcase({ onProgress = null } = {}) {
  const prev = await loadPubIndex();
  const { files, index } = await showcaseFiles(prev);
  if (!files.length) return null;
  files.push({ path: `${CFG.DATA_PATH}/${INDEX_FILE}`, content: JSON.stringify(index) });
  // первый переход на куски: цельный файл больше не нужен — убираем, чтобы
  // приложение не читало устаревшую витрину
  if (!prev && await rawExists(LEGACY_FILE)) files.push({ path: `${CFG.DATA_PATH}/${LEGACY_FILE}`, content: null });
  const sha = await ghCommit(files, 'Каталог: обновлена витрина', { onProgress });
  return sha;
}

// Авто-публикация после правок каталога. Гейт: только вошедший админ с ключом.
// «Схлопывание»: частые правки (импорт) дают один коммит, а не десятки.
let _pubBusy = false, _pubAgain = false, _pubTimer = null;
export function autoPublish() {
  if (!state.isAdmin || !ghConfigured()) return;
  clearTimeout(_pubTimer);
  _pubTimer = setTimeout(doAutoPublish, 1200);
}
async function doAutoPublish() {
  if (_pubBusy) { _pubAgain = true; return; }
  _pubBusy = true;
  try {
    const sha = await publishShowcase();
    if (sha) toast('Витрина обновлена на GitHub');
  } catch (e) {
    toast('Витрину не удалось опубликовать — проверь ключ в «Публикация на GitHub»');
  } finally {
    _pubBusy = false;
    if (_pubAgain) { _pubAgain = false; autoPublish(); }
  }
}

/* ── Шифрование секретного (закупка, «Ходовые») для хранения на GitHub ──────
   Сервера больше нет, поэтому секретные данные будут лежать на GitHub, но в
   ЗАШИФРОВАННОМ виде. Шифруем паролем на устройстве (Web Crypto: AES-GCM, ключ
   из пароля через PBKDF2). На GitHub — только шифртекст, без пароля бесполезен.
   Разные пароли → разный доступ (владелец видит всё, сотрудник — только своё). */
const ENC_ITER = 150000;
async function deriveKey(password, salt) {
  const base = await crypto.subtle.importKey('raw', new TextEncoder().encode(password), 'PBKDF2', false, ['deriveKey']);
  return crypto.subtle.deriveKey(
    { name: 'PBKDF2', salt, iterations: ENC_ITER, hash: 'SHA-256' },
    base, { name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']);
}
function b64(bytes) { let s = ''; const CH = 0x8000; for (let i = 0; i < bytes.length; i += CH) s += String.fromCharCode.apply(null, bytes.subarray(i, i + CH)); return btoa(s); }
function unb64(str) { const bin = atob(str); const a = new Uint8Array(bin.length); for (let i = 0; i < bin.length; i++) a[i] = bin.charCodeAt(i); return a; }
// Сжатие перед шифрованием. Каталог на 17 тыс. товаров — это десятки мегабайт
// текста, который жмётся в разы. Без сжатия публикация упиралась в размер
// запроса к GitHub и обрывалась с «Failed to fetch».
const canGzip = typeof CompressionStream !== 'undefined' && typeof DecompressionStream !== 'undefined';
async function gzipBytes(u8) {
  const st = new Blob([u8]).stream().pipeThrough(new CompressionStream('gzip'));
  return new Uint8Array(await new Response(st).arrayBuffer());
}
async function gunzipBytes(u8) {
  const st = new Blob([u8]).stream().pipeThrough(new DecompressionStream('gzip'));
  return new Uint8Array(await new Response(st).arrayBuffer());
}

export async function encryptJSON(obj, password) {
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const key = await deriveKey(password, salt);
  let bytes = new TextEncoder().encode(JSON.stringify(obj));
  let z = null;
  if (canGzip) { bytes = await gzipBytes(bytes); z = 'gzip'; }
  const ct = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, bytes));
  return JSON.stringify({ v: 1, alg: 'AES-GCM', kdf: 'PBKDF2', iter: ENC_ITER, z, salt: b64(salt), iv: b64(iv), data: b64(ct) });
}
export async function decryptJSON(blob, password) {
  const env = typeof blob === 'string' ? JSON.parse(blob) : blob;
  const key = await deriveKey(password, unb64(env.salt));
  let plain = new Uint8Array(await crypto.subtle.decrypt({ name: 'AES-GCM', iv: unb64(env.iv) }, key, unb64(env.data)));
  // старые файлы без сжатия читаются как раньше (поля z у них нет)
  if (env.z === 'gzip') {
    if (!canGzip) throw new Error('Браузер не умеет распаковывать этот каталог — обнови браузер');
    plain = await gunzipBytes(plain);
  }
  return JSON.parse(new TextDecoder().decode(plain));
}

/* ── Серверлес-каталог: полный каталог в зашифрованном файле на GitHub ──────
   Сервера нет. Источник правды для владельца — зашифрованный файл
   secret-catalog.enc (полный каталог: товары со всеми полями + закупочные цены
   + продажи + контакты). Из него делается ОТКРЫТАЯ витрина products.json для
   покупателей. Читать шифрофайл может кто угодно (он публичный), но открыть —
   только по паролю. Писать (публиковать) — по GitHub-ключу владельца. */
const SECRET_FILE = 'secret-catalog.enc'; // полный каталог владельца
const STAFF_FILE = 'secret-staff.enc';    // урезанный каталог сотрудника (без продаж/«Ходовых»)
// Цены других магазинов лежат ОТКРЫТО (не шифруются): это чужие ценники из
// торгового зала, не наша тайна, а видеть их должны все — даже покупатель без входа.
export const SV_AUTH_KEY = 'wm_sv_auth';         // запомненный вход на устройстве (роль + пароль)
function rawUrl(file) {
  return `https://raw.githubusercontent.com/${CFG.GITHUB_OWNER}/${CFG.GITHUB_REPO}/${ghBranch()}/${CFG.DATA_PATH}/${file}`;
}
// null ТОЛЬКО если файла ещё нет (404). Сбой сети — исключение (чтобы не
// спутать обрыв связи с «файла нет» и случайно не затереть каталог первой настройкой).
async function fetchRaw(file) {
  const r = await fetch(rawUrl(file) + '?t=' + Date.now(), { cache: 'no-store' });
  if (r.status === 404) return null;
  if (!r.ok) throw new Error('Не удалось скачать данные (' + r.status + ')');
  return r.text();
}
async function rawExists(file) {
  try { return (await fetchRaw(file)) != null; } catch (e) { return false; }
}
// Кусок читаем с подписью в адресе: изменился — скачается заново, не изменился
// — придёт из кэша браузера. Так вход после мелкой правки не тянет весь каталог.
async function fetchPart(file, h) {
  const r = await fetch(rawUrl(file) + '?h=' + h);
  if (!r.ok) throw new Error('Не удалось скачать часть каталога (' + r.status + ')');
  return r.text();
}
// полный товар без служебных полей индекса (начинаются с "_")
function cleanProductsFull() {
  return state.products.map((p) => { const o = {}; for (const k in p) if (k[0] !== '_') o[k] = p[k]; return o; });
}
export function buildFullSnapshot() {
  return {
    v: 1, savedAt: new Date().toISOString(),
    products: cleanProductsFull(), groups: state.groups, suppliers: state.suppliers,
    prices: state.prices || [], sales: state.sales || [], contacts: state.contacts || {},
    competitors: state.competitors || [], compPrices: state.compPrices || [],
    unitCoef: state.unitCoef || {},
    orderRules: state.orderRules || null,       // правила заказа — общие для всего магазина
    staffPassword: state.staffPassword || null, // пароль сотрудника хранится в каталоге владельца
  };
}
// Каталог для сотрудника: полный ПРОСМОТР (товары + закупка + продажи +
// контакты), но без прав на правку/загрузку — это остаётся только у владельца.
export function buildStaffSnapshot() {
  return {
    v: 1, savedAt: new Date().toISOString(), staff: true,
    products: cleanProductsFull(), groups: state.groups, suppliers: state.suppliers,
    prices: state.prices || [], sales: state.sales || [], contacts: state.contacts || {},
    competitors: state.competitors || [], compPrices: state.compPrices || [],
    unitCoef: state.unitCoef || {},
    orderRules: state.orderRules || null,
  };
}

/* ── Закрытый каталог по частям ─────────────────────────────────────────────
   Файл `secret-catalog.enc` теперь не весь каталог, а зашифрованная ОПИСЬ:
   мелочь (группы, поставщики, контакты, правила) прямо в ней, а товары, цены и
   продажи — кусками в `data/sec/…`. У каждого куска в описи своя подпись, и
   на GitHub уезжают только изменившиеся.

   Ключ шифрования один на все куски (иначе пришлось бы каждый раз
   перешифровывать всё), поэтому «соль» берём из прошлой описи и меняем только
   когда сменился пароль — тогда перезаписываются все куски. */
const SETS = [
  { name: 'products', n: 24, key: (r) => r.id },
  { name: 'prices', n: 12, key: (r) => r.product_id },
  { name: 'sales', n: 6, key: (r) => r.code || r.name },
];
const SEC_DIR = 'sec';            // куски каталога владельца
const STAFF_DIR = 'sec-staff';    // куски каталога сотрудника
// опись прошлой публикации, чтобы знать, что уже лежит на GitHub
const _lastMani = {};             // файл описи → { salt, mani }

async function encPart(key, obj) {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  let bytes = new TextEncoder().encode(JSON.stringify(obj));
  let z = null;
  if (canGzip) { bytes = await gzipBytes(bytes); z = 'gzip'; }
  const ct = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, bytes));
  return JSON.stringify({ z, iv: b64(iv), data: b64(ct) });
}
async function decPart(key, raw) {
  const env = JSON.parse(raw);
  let plain = new Uint8Array(await crypto.subtle.decrypt({ name: 'AES-GCM', iv: unb64(env.iv) }, key, unb64(env.data)));
  if (env.z === 'gzip') plain = await gunzipBytes(plain);
  return JSON.parse(new TextDecoder().decode(plain));
}

// Разложить снимок на опись + куски и собрать список файлов к заливке.
// prev — опись прошлой публикации (или null: тогда пишем всё).
async function secretFiles(snapshot, password, dir, file, prev) {
  const sameSalt = prev && prev.salt;
  const salt = sameSalt ? unb64(prev.salt) : crypto.getRandomValues(new Uint8Array(16));
  const key = await deriveKey(password, salt);
  const head = { ...snapshot };
  const sets = {};
  const files = [];
  for (const s of SETS) {
    delete head[s.name];
    const parts = shard(snapshot[s.name] || [], s.n, s.key);
    const hashes = [];
    for (let i = 0; i < s.n; i++) {
      const json = JSON.stringify(parts[i]);
      const h = await digest(json);
      hashes.push(h);
      const known = prev && prev.mani && prev.mani.sets[s.name] && prev.mani.sets[s.name].h[i];
      if (!sameSalt || known !== h) files.push({ path: `${CFG.DATA_PATH}/${dir}/${s.name}-${partName(i)}.enc`, content: await encPart(key, parts[i]) });
    }
    sets[s.name] = { n: s.n, h: hashes };
  }
  const mani = { v: 2, savedAt: new Date().toISOString(), head, sets };
  const iv = crypto.getRandomValues(new Uint8Array(12));
  let bytes = new TextEncoder().encode(JSON.stringify(mani));
  let z = null;
  if (canGzip) { bytes = await gzipBytes(bytes); z = 'gzip'; }
  const ct = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, bytes));
  files.push({
    path: `${CFG.DATA_PATH}/${file}`,
    content: JSON.stringify({ v: 2, alg: 'AES-GCM', kdf: 'PBKDF2', iter: ENC_ITER, z, salt: b64(salt), iv: b64(iv), data: b64(ct) }),
  });
  return { files, saved: { salt: b64(salt), mani } };
}

// Прочитать закрытый каталог: опись + куски (новый формат) либо цельный файл
// (старый). Наружу отдаёт то же самое, что лежало в старом файле.
async function loadSnapshot(file, password) {
  const raw = await fetchRaw(file);
  if (raw == null) return null;
  const env = JSON.parse(raw);
  if (env.v !== 2) return decryptJSON(env, password);   // старый цельный файл
  const salt = unb64(env.salt);
  const key = await deriveKey(password, salt);
  let plain = new Uint8Array(await crypto.subtle.decrypt({ name: 'AES-GCM', iv: unb64(env.iv) }, key, unb64(env.data)));
  if (env.z === 'gzip') plain = await gunzipBytes(plain);
  const mani = JSON.parse(new TextDecoder().decode(plain));
  _lastMani[file] = { salt: env.salt, mani };
  const dir = file === SECRET_FILE ? SEC_DIR : STAFF_DIR;
  const data = { ...mani.head };
  for (const s of SETS) {
    const set = mani.sets[s.name];
    if (!set) { data[s.name] = []; continue; }
    const idx = Array.from({ length: set.n }, (_, i) => i);
    const chunks = await pool(idx, 6, async (i) => decPart(key, await fetchPart(`${dir}/${s.name}-${partName(i)}.enc`, set.h[i])));
    data[s.name] = [].concat(...chunks);
  }
  return data;
}

// Опубликовать всё одним коммитом: открытая витрина + закрытый каталог
// владельца (+ отдельный каталог сотрудника, если задан его пароль).
// Возвращает {sha, sent, total} — сколько файлов реально уехало.
export async function publishFull(password, { onProgress = null } = {}) {
  const prevIdx = await loadPubIndex();
  const { files, index } = await showcaseFiles(prevIdx);
  files.push({ path: `${CFG.DATA_PATH}/${INDEX_FILE}`, content: JSON.stringify(index) });
  if (!prevIdx && await rawExists(LEGACY_FILE)) files.push({ path: `${CFG.DATA_PATH}/${LEGACY_FILE}`, content: null });

  const own = await secretFiles(buildFullSnapshot(), password, SEC_DIR, SECRET_FILE, await prevMani(SECRET_FILE, password));
  files.push(...own.files);
  let staff = null;
  if (state.staffPassword) {
    staff = await secretFiles(buildStaffSnapshot(), state.staffPassword, STAFF_DIR, STAFF_FILE, await prevMani(STAFF_FILE, state.staffPassword));
    files.push(...staff.files);
  }
  const sha = await ghCommit(files, 'Каталог: обновлены витрина и защищённые данные', { onProgress });
  _lastMani[SECRET_FILE] = own.saved;
  if (staff) _lastMani[STAFF_FILE] = staff.saved;
  return { sha, sent: files.length };
}

// Опись прошлой публикации: из памяти (мы её уже читали при входе) или с
// GitHub. Не открылась нашим паролем — значит пароль сменился: перезапишем всё.
async function prevMani(file, password) {
  if (_lastMani[file]) return _lastMani[file];
  try {
    const raw = await fetchRaw(file);
    if (raw == null) return null;
    const env = JSON.parse(raw);
    if (env.v !== 2) return null;                   // старый формат — переходим на куски целиком
    const key = await deriveKey(password, unb64(env.salt));
    let plain = new Uint8Array(await crypto.subtle.decrypt({ name: 'AES-GCM', iv: unb64(env.iv) }, key, unb64(env.data)));
    if (env.z === 'gzip') plain = await gunzipBytes(plain);
    const saved = { salt: env.salt, mani: JSON.parse(new TextDecoder().decode(plain)) };
    _lastMani[file] = saved;
    return saved;
  } catch (e) { return null; }
}
// Вход владельца по паролю: скачать полный каталог и открыть паролем.
// Бросает NO_SECRET, если файла ещё нет; бросает при неверном пароле.
export async function unlockSecret(password) {
  const data = await loadSnapshot(SECRET_FILE, password); // неверный пароль → исключение
  if (data == null) throw new Error('NO_SECRET');
  state.groups = data.groups || [];
  state.suppliers = data.suppliers || [];
  state.products = (data.products || []).slice().sort(byName);
  state.prices = data.prices || [];
  state.sales = data.sales || [];
  state.contacts = data.contacts || {};
  state.competitors = data.competitors || [];
  state.compPrices = data.compPrices || [];
  state.unitCoef = data.unitCoef || {};
  if (data.orderRules) state.orderRules = data.orderRules;
  state.staffPassword = data.staffPassword || null;
  buildIndex();
  state.popularIds = buildPopularIds();
  state.serverless = true;
  state.isAdmin = true; state.role = 'admin'; state.canPurchase = true; state.canSales = true;
  return true;
}
// Вход сотрудника по паролю: скачать файл сотрудника (без продаж) и открыть.
export async function unlockStaff(password) {
  const data = await loadSnapshot(STAFF_FILE, password);
  if (data == null) throw new Error('NO_STAFF');
  state.groups = data.groups || [];
  state.suppliers = data.suppliers || [];
  state.products = (data.products || []).slice().sort(byName);
  state.prices = data.prices || [];
  state.sales = data.sales || []; // сотрудник видит всё, включая продажи
  state.contacts = data.contacts || {};
  state.competitors = data.competitors || [];   // цены магазинов сотрудник и видит, и вносит
  state.compPrices = data.compPrices || [];
  state.unitCoef = data.unitCoef || {};
  if (data.orderRules) state.orderRules = data.orderRules;
  buildIndex();
  state.popularIds = buildPopularIds();
  state.serverless = true;
  state.isAdmin = false; state.role = 'staff'; state.canPurchase = true; state.canSales = true;
  return true;
}

// запомнить вход на устройстве (по просьбе владельца — не выходить до явного выхода)
function saveSvAuth(role, pw) { try { localStorage.setItem(SV_AUTH_KEY, JSON.stringify({ role, pw })); } catch (e) { /* приватный режим */ } }
export function clearSvAuth() { try { localStorage.removeItem(SV_AUTH_KEY); } catch (e) { /* некритично */ } }

// Включить режим «вошёл владелец без сервера»: кнопки админа, внутренние
// разделы, запомнить пароль для публикаций и вход на устройстве.
export function applyServerless(pw) {
  ui.secretPw = pw;
  state.serverless = true;
  state.session = { user: { email: 'owner' }, serverless: true };
  state.isAdmin = true; state.role = 'admin'; state.canPurchase = true; state.canSales = true;
  saveSvAuth('owner', pw);
  $('fabAdd').hidden = false;
  $('adminBtn').classList.toggle('is-admin', true);
  $('adminBtnLabel').hidden = true;
  saveCache();
  renderAll();
  setTimeout(autoDedup, 2000);   // тихо убрать дубли, если импорт их наплодил
}
// Включить режим «вошёл сотрудник»: видит закупку/контакты, но не «Ходовые» и
// не правит каталог. Тоже запоминается на устройстве.
export function applyStaff(pw) {
  ui.secretPw = null; // сотрудник не публикует
  state.serverless = true;
  state.session = { user: { email: 'staff' }, serverless: true, staff: true };
  state.isAdmin = false; state.role = 'staff'; state.canPurchase = true; state.canSales = true;
  saveSvAuth('staff', pw);
  $('fabAdd').hidden = true;
  $('adminBtn').classList.toggle('is-admin', true);
  $('adminBtnLabel').hidden = true;
  saveCache();
  renderAll();
}

/* ── Вход/выход: админ или сотрудник ──────────── */

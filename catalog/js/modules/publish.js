// Публикация на GitHub: шифрование, снимки, вход по паролю

import { $, CFG, state, ui } from './store.js';
import { norm, toast } from './core.js';
import { buildIndex } from './catalog.js';
import { renderAll } from './render.js';
import { orderRules } from './card.js';
import { byName, saveCache } from './data.js';
import { autoDedup } from './photos.js';

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
// path — от корня репозитория. При параллельной правке (ветка ушла вперёд)
// один раз перечитываем вершину ветки и повторяем.
export async function ghCommit(files, message, _retry = true) {
  const b = ghBranch();
  const ref = await ghJson(`${ghRepo()}/git/ref/heads/${b}`);
  const baseCommit = ref.object.sha;
  const baseInfo = await ghJson(`${ghRepo()}/git/commits/${baseCommit}`);
  // Каждый файл заливаем ОТДЕЛЬНЫМ запросом и складываем в дерево по ссылке.
  // Раньше всё содержимое шло одним запросом — на большом каталоге он весил
  // десятки мегабайт и обрывался («Failed to fetch»).
  const entries = [];
  for (const f of files) {
    const blob = await ghJson(`${ghRepo()}/git/blobs`, {
      method: 'POST',
      body: JSON.stringify({ content: f.content, encoding: 'utf-8' }),
    });
    entries.push({ path: f.path, mode: '100644', type: 'blob', sha: blob.sha });
  }
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
    if ((upd.status === 409 || upd.status === 422) && _retry) return ghCommit(files, message, false);
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

// Опубликовать витрину (товары + категории) одним коммитом на GitHub.
// По умолчанию публикуем ТОЛЬКО если витрина изменилась (сравниваем подпись
// содержимого), чтобы не плодить пустые коммиты и лишние деплои. force=true —
// опубликовать в любом случае (кнопка «Опубликовать сейчас», первый перенос).
const GH_SIG_KEY = 'wm_gh_lastsig';
function strHash(s) { let h = 5381; for (let i = 0; i < s.length; i++) h = ((h << 5) + h + s.charCodeAt(i)) | 0; return (h >>> 0).toString(36); }
export async function publishShowcase({ force = false } = {}) {
  const pJson = JSON.stringify(buildPublicProducts());
  const gJson = JSON.stringify(buildPublicGroups());
  const sig = strHash(pJson) + '.' + strHash(gJson);
  if (!force) { try { if (localStorage.getItem(GH_SIG_KEY) === sig) return null; } catch (e) { /* приватный режим */ } }
  const files = [
    { path: `${CFG.DATA_PATH}/products.json`, content: pJson },
    { path: `${CFG.DATA_PATH}/groups.json`, content: gJson },
  ];
  const sha = await ghCommit(files, 'Каталог: обновлена витрина');
  try { localStorage.setItem(GH_SIG_KEY, sig); } catch (e) { /* приватный режим */ }
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

// Опубликовать всё одним коммитом: открытая витрина + зашифрованный полный
// каталог владельца (+ отдельный файл сотрудника, если задан его пароль).
export async function publishFull(password) {
  const pJson = JSON.stringify(buildPublicProducts());
  const gJson = JSON.stringify(buildPublicGroups());
  const files = [
    { path: `${CFG.DATA_PATH}/products.json`, content: pJson },
    { path: `${CFG.DATA_PATH}/groups.json`, content: gJson },
    { path: `${CFG.DATA_PATH}/popular.json`, content: JSON.stringify(buildPopularIds()) },
    { path: `${CFG.DATA_PATH}/${SECRET_FILE}`, content: await encryptJSON(buildFullSnapshot(), password) },
  ];
  if (state.staffPassword) files.push({ path: `${CFG.DATA_PATH}/${STAFF_FILE}`, content: await encryptJSON(buildStaffSnapshot(), state.staffPassword) });
  const sha = await ghCommit(files, 'Каталог: обновлены витрина и защищённые данные');
  try { localStorage.setItem(GH_SIG_KEY, strHash(pJson) + '.' + strHash(gJson)); } catch (e) { /* приватный режим */ }
  return sha;
}
// Вход владельца по паролю: скачать полный каталог и открыть паролем.
// Бросает NO_SECRET, если файла ещё нет; бросает при неверном пароле.
export async function unlockSecret(password) {
  const raw = await fetchRaw(SECRET_FILE);
  if (raw == null) throw new Error('NO_SECRET');
  const data = await decryptJSON(raw, password); // неверный пароль → исключение
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
  const raw = await fetchRaw(STAFF_FILE);
  if (raw == null) throw new Error('NO_STAFF');
  const data = await decryptJSON(raw, password);
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

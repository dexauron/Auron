// Публикация на GitHub: шифрование, снимки, вход по паролю

import { $, CFG, state, ui, CACHE_KEY, idbGet, idbSet, idbDelete } from './store.js';
import { availability, publicProducts, publicGroups, staffSnapshot } from './publication-data.js';
import { importCatalogKey, keyEncrypt, keyDecrypt, wrapCatalogKey, unwrapCatalogKey, passwordEncrypt, passwordDecrypt } from './catalog-crypto.js';
import { norm, toast } from './core.js';
import { buildIndex } from './catalog.js';
import { renderAll } from './render.js';
import { orderRules } from './card.js';
import { byName, saveCache, tidyMemory } from './data.js';
import { digest, partName, pool, shard } from './parts.js';

/* ── Публикация каталога на GitHub (бесплатно, без сервера) ──────────────
   Владелец один раз вставляет «ключ» (GitHub token) — он хранится ТОЛЬКО на
   устройстве (localStorage), в репозиторий/код не попадает. Через него
   приложение сохраняет файлы каталога прямо на GitHub одним коммитом (атомарно,
   чтобы деплой срабатывал один раз). Витрина — публично; внутренние данные
   публикуются зашифрованными отдельными наборами для ролей. */
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
/* Понятная причина отказа вместо кода и куска ответа сервера.
 * Владелец — не программист: «401 Bad credentials» ему ничего не говорит, а
 * действие требуется простое — обновить ключ. Технические подробности всё
 * равно сохраняются (в журнале ошибок), просто не лезут человеку в глаза. */
export function ghReason(status, text) {
  const t = String(text || '');
  if (status === 401 || /bad credentials/i.test(t)) {
    return { code: 'token', msg: 'Ключ доступа к GitHub больше не работает — обычно у него просто закончился срок. Нужен новый ключ.' };
  }
  if (status === 404) {
    return { code: 'place', msg: 'GitHub не нашёл, куда публиковать (репозиторий или ветка). Проверь настройки в «Публикация на GitHub».' };
  }
  if (status === 403 && /rate limit/i.test(t)) {
    return { code: 'wait', msg: 'GitHub просит подождать: слишком много запросов подряд. Попробуй через минуту.' };
  }
  if (status === 403) {
    return { code: 'token', msg: 'GitHub не разрешил запись этим ключом. Нужен ключ с правом записи в репозиторий.' };
  }
  if (status >= 500) return { code: 'server', msg: 'GitHub сейчас недоступен. Попробуй позже — записанное не потеряется.' };
  /* 422 — «не принял запись». Причин ровно две, и они совсем разные, поэтому
     достаём объяснение самого GitHub, а не отделываемся кодом.
     Чаще всего это гонка: ветку в тот же момент менял кто-то ещё (например,
     обновление кода каталога). Такое лечится повтором и ничего не портит. */
  if (status === 422) {
    const m = (t.match(/"message"\s*:\s*"([^"]+)"/) || [])[1] || '';
    if (/fast forward/i.test(m)) {
      return { code: 'wait', msg: 'Каталог на GitHub в этот момент менял кто-то ещё. Ничего не потерялось — нажми «Опубликовать витрину сейчас» ещё раз.' };
    }
    return { code: 'other', msg: 'GitHub не принял запись. Он объясняет так: «' + (m || 'без объяснения') + '».' };
  }
  return { code: 'other', msg: 'GitHub отказал (код ' + status + ').' };
}

function ghFail(status, text, path, method) {
  const r = ghReason(status, text);
  const e = new Error(r.msg);
  e.friendly = r.msg;
  e.code = r.code;
  e.tech = `GitHub ${method || 'GET'} ${path} → ${status} ${String(text || '').slice(0, 200)}`;
  return e;
}

async function ghJson(path, opts) {
  const r = await ghApi(path, opts);
  if (!r.ok) throw ghFail(r.status, await r.text(), path, (opts && opts.method) || 'GET');
  return r.json();
}

// Залить один файл. GitHub при частых записях подряд может ответить «слишком
// много запросов» — это не поломка, а просьба подождать: ждём и повторяем,
// иначе публикация каталога из десятков кусков срывалась бы на середине.
async function ghBlob(content, attempt = 0) {
  const r = await ghApi(`${ghRepo()}/git/blobs`, { method: 'POST', body: JSON.stringify({ content, encoding: 'utf-8' }) });
  if (r.ok) return r.json();
  const wait = (r.status === 403 || r.status === 429 || r.status >= 500) && attempt < 3;
  if (!wait) throw ghFail(r.status, await r.text(), `${ghRepo()}/git/blobs`, 'POST');
  await new Promise((res) => setTimeout(res, 2000 * (attempt + 1)));
  return ghBlob(content, attempt + 1);
}

// Один коммит с несколькими файлами (текстовыми). files: [{path, content}],
// path — от корня репозитория. content === null — файл удаляется.
// При параллельной правке (ветка ушла вперёд) один раз перечитываем вершину
// ветки и повторяем. onProgress(готово, всего) — для показа хода публикации.
export async function ghCommit(files, message, opts = {}) {
  const { onProgress = null, retry = 3 } = opts;
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
    const blob = await ghBlob(f.content);
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
    /* Ветку в этот же момент двигал кто-то ещё — GitHub отвечает «не перемотка
       вперёд». Это не поломка, а гонка: пересобираем от свежей вершины и
       пробуем снова. Раньше пробовали один раз, и второго совпадения хватало,
       чтобы владелец увидел непонятный «код 422». Теперь до трёх попыток,
       с паузой между ними. */
    if ((upd.status === 409 || upd.status === 422) && retry > 0) {
      await new Promise((r) => setTimeout(r, 700 * (4 - retry)));
      return ghCommit(files, message, { ...opts, retry: retry - 1 });
    }
    throw ghFail(upd.status, await upd.text(), `${ghRepo()}/git/refs/heads/${b}`, 'PATCH');
  }
  return commit.sha;
}

/* Витринные поля — что видит покупатель, зашедший без пароля.
 * arrival_at (только дата) — на нём держится «Новее» и строка «завоз».
 * Код товара — с ним проще объяснить кассиру, что берёшь.
 * ШТРИХКОДЫ здесь потому, что владелец решил оставить покупателю сканер
 * (2026-08-27): без них наведённая камера не находила ничего, и сканер у
 * покупателя выглядел сломанным. Секрета в штрихкоде нет — он напечатан на
 * самой упаковке. Артикул, поставщики, закупки и остаток числом остаются
 * закрытыми. */
export function stockState(p, perDay) { return availability(p, perDay); }
export function buildPublicProducts() { return publicProducts(state.products); }
function buildPublicGroups() { return publicGroups(state.groups); }
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
/* Версия витрины. Поднимается, когда в открытые файлы добавляется поле, без
 * которого покупатель чего-то не видит. Нужна вот зачем: 27 августа в витрину
 * добавили штрихкоды, владелец нажал «опубликовать» — и публикация прошла
 * успешно, но БЕЗ штрихкодов: на его телефоне ещё работала сохранённая старая
 * версия приложения. Со стороны всё выглядело исправным, а покупатели
 * по-прежнему не могли отсканировать товар. Теперь номер версии уезжает в
 * опись, и приложение владельца само говорит: «витрина собрана старой
 * версией — опубликуй заново».
 * 1 — без номера (до 27.08), 2 — наличие словом, 3 — штрихкоды покупателю,
 * 4 — отзывы соседей. */
export const SHOWCASE_V = 5;

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
  const index = { v: 2, app: SHOWCASE_V, savedAt: new Date().toISOString(), n: PUB_PARTS, parts: hashes, groups: gHash, popular: popHash };
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
  /* Куски не изменились — но если витрину собирала старая версия, опись всё
     равно надо переписать: иначе номер версии в ней так и остался бы старым,
     и приложение вечно просило бы опубликовать заново. */
  const stale = !prev || Number(prev.app || 1) !== SHOWCASE_V;
  if (!files.length && !stale) return null;
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
export async function encryptJSON(obj, password) { return passwordEncrypt(obj, password); }
export async function decryptJSON(blob, password) { return passwordDecrypt(blob, password); }

// Прежние цельные файлы читаются только для перехода владельца.
const SECRET_FILE = 'secret-catalog.enc'; // полный каталог владельца
const STAFF_FILE = 'secret-staff.enc';    // урезанный каталог сотрудника (без продаж/«Ходовых»)
// Цены других магазинов лежат ОТКРЫТО (не шифруются): это чужие ценники из
// торгового зала, не наша тайна, а видеть их должны все — даже покупатель без входа.
export const SV_AUTH_KEY = 'wm_sv_auth';         // указатель запомненного входа (без пароля)
function rawUrl(file) {
  return `https://raw.githubusercontent.com/${CFG.GITHUB_OWNER}/${CFG.GITHUB_REPO}/${ghBranch()}/${CFG.DATA_PATH}/${file}`;
}
// null ТОЛЬКО если файла ещё нет (404). Сбой сети — исключение (чтобы не
// спутать обрыв связи с «файла нет» и случайно не затереть каталог первой настройкой).
async function fetchRaw(file) {
  return fetchCatalogText(rawUrl(file) + '?t=' + Date.now(), true);
}
async function fetchCatalogText(url, raw = false) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 12000);
  let r;
  try {
    r = await fetch(url, { ...(raw ? { cache: 'no-store' } : {}), signal: controller.signal });
    if (r.status === 404 && raw) return null;
    if (!r.ok) { const err = new Error('Не удалось скачать данные (' + r.status + ')'); err.code = r.status >= 500 ? 'NETWORK' : 'ACCESS'; throw err; }
    return await r.text();
  } catch (e) {
    if (e.code === 'NETWORK' || e.code === 'ACCESS') throw e;
    const err = new Error('Нет связи с каталогом'); err.code = 'NETWORK'; throw err;
  } finally { clearTimeout(timer); }
}
async function rawExists(file) {
  try { return (await fetchRaw(file)) != null; } catch (e) { return false; }
}
// Кусок читаем с подписью в адресе: изменился — скачается заново, не изменился
// — придёт из кэша браузера. Так вход после мелкой правки не тянет весь каталог.
async function fetchPart(file, h, keyTag) {
  // Один plaintext-hash при смене ключа соответствует ДРУГОМУ шифртексту.
  // Конверт роли меняется вместе с ключом; его публичная подпись разделяет кэш.
  return fetchCatalogText(rawUrl(file) + '?h=' + h + '&k=' + keyTag);
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
    retailHist: state.retailHist || {},      // как менялся ценник — для «подорожало»
    requests: state.requests || [],          // заявки: собранные списки покупок для 1С
    orders: state.orders || [],                 // заказы поставщикам: кто, у кого, когда придёт
    orderRules: state.orderRules || null,       // правила заказа — общие для всего магазина
    staffPassword: state.staffPassword || null, // пароль сотрудника хранится в каталоге владельца
  };
}
/* ── Закрытые данные: независимые ключи и файлы для каждой роли ──────────
   v4: пароль сотрудника открывает только его набор. Владелец хранит полный
   снимок и отдельный пароль сотрудника в своей зашифрованной описи.
   v3 с общим ключом читается только владельцем для явного перехода на v4. */
const SETS = [
  { name: 'products', n: 24, key: (r) => r.id },
  { name: 'prices', n: 12, key: (r) => r.product_id },
  { name: 'sales', n: 6, key: (r) => r.code || r.name },
];
const ROLE_FILES = {
  owner: { manifest: 'catalog.enc', dir: 'sec' },
  staff: { manifest: 'staff-catalog.enc', dir: 'sec-staff' },
};
const KEYS_FILE = 'keys.json';
const ROLES = ['owner', 'staff'];
const roleContext = (role, file) => `wm.catalog.v4/${role}/${file}`;
let _cat = null;

export function passwordProblem(password) {
  return typeof password !== 'string' || password.trim().length < 12 || password.length > 1024
    ? 'Новый пароль — от 12 до 1024 символов. Используй длинную уникальную фразу.' : '';
}

async function readRoleCatalog(key, role, version, manifestOnly = false, keyTag = '') {
  const spec = ROLE_FILES[role];
  if (!spec || (!manifestOnly && !/^[a-f0-9]{16,64}$/.test(keyTag))) throw new Error('INVALID_CATALOG');
  const raw = await fetchRaw(spec.manifest);
  // Файл ключей уже существует: потеря описи не является первым запуском.
  if (raw == null) throw new Error('INVALID_CATALOG');
  const context = (file) => version === 4 ? roleContext(role, file) : '';
  const mani = await keyDecrypt(key, raw, context('manifest'));
  if (!mani || !mani.head || !mani.sets || (version === 4 && (mani.v !== 4 || mani.role !== role))) throw new Error('INVALID_CATALOG');
  if (manifestOnly) return { mani };
  const data = { ...mani.head };
  for (const s of SETS) {
    const set = mani.sets[s.name];
    if (!set || set.n !== s.n || !Array.isArray(set.h) || set.h.length !== s.n
      || !set.h.every((h) => typeof h === 'string' && /^[a-f0-9]{16,64}$/.test(h))) throw new Error('INVALID_CATALOG');
    const chunks = await pool(Array.from({ length: set.n }, (_, i) => i), 6, async (i) => {
      const rows = await keyDecrypt(key, await fetchPart(`${spec.dir}/${s.name}-${partName(i)}.enc`, set.h[i], keyTag), context(`${s.name}/${i}`));
      if (!Array.isArray(rows)) throw new Error('INVALID_CATALOG');
      // Ветка могла обновиться между чтением описи и частей. Проверяем подпись
      // расшифрованного содержимого, чтобы не смешать две версии каталога.
      if ((await digest(JSON.stringify(rows))).slice(0, set.h[i].length) !== set.h[i]) throw new Error('CATALOG_CHANGED');
      return rows;
    });
    data[s.name] = [].concat(...chunks);
  }
  return { mani, data };
}

async function openCatalog(password) {
  const keysRaw = await fetchRaw(KEYS_FILE);
  if (keysRaw == null) {
    // Потеря файла ключей не означает пустой новый магазин.
    if (await fetchRaw(ROLE_FILES.owner.manifest) != null || await fetchRaw(ROLE_FILES.staff.manifest) != null) throw new Error('INVALID_CATALOG');
    return openLegacy(password);
  }
  const ks = JSON.parse(keysRaw);
  if (![3, 4].includes(ks.v)) throw new Error('INVALID_CATALOG');
  let raw = null; let role = null;
  for (const r of ROLES) {
    if (!ks[r]) continue;
    try { raw = await unwrapCatalogKey(ks[r], password, ks.v === 4 ? roleContext(r, 'key') : ''); role = r; break; }
    catch (e) { if (e.message === 'INVALID_CATALOG') throw e; }
  }
  if (!raw) throw new Error('BAD_PASSWORD');
  // Старый общий ключ не выдаём сотруднику: сначала владелец публикует v4.
  if (ks.v === 3 && role === 'staff') throw new Error('SECURITY_UPGRADE_REQUIRED');
  const key = await importCatalogKey(raw);
  let mani, data;
  try { ({ mani, data } = await readRoleCatalog(key, role, ks.v, false, await digest(JSON.stringify(ks[role])))); }
  catch (e) { e.passwordAccepted = true; throw e; }
  _cat = { version: ks.v, key, role, mani, keys: ks, staff: null, staffPassword: data.staffPassword || null };
  state.securityNeedsUpgrade = ks.v !== 4;
  return { data, role };
}

async function openLegacy(password) {
  const own = await fetchRaw(SECRET_FILE);
  if (own != null) {
    try {
      const data = await decryptJSON(own, password);
      _cat = { version: 1, role: 'owner', key: null, keys: null };
      state.securityNeedsUpgrade = true;
      return { data, role: 'owner' };
    } catch (e) { /* может быть прежний пароль сотрудника */ }
  }
  const staff = await fetchRaw(STAFF_FILE);
  if (staff != null) {
    let valid = false;
    try { await decryptJSON(staff, password); valid = true; } catch (e) { /* неверный пароль */ }
    if (valid) throw new Error('SECURITY_UPGRADE_REQUIRED');
  }
  if (own == null && staff == null) throw new Error('NO_SECRET');
  throw new Error('BAD_PASSWORD');
}

async function roleFiles(snapshot, role, key, prev) {
  const spec = ROLE_FILES[role];
  const head = { ...snapshot }, sets = {}, files = [];
  for (const s of SETS) {
    delete head[s.name];
    const parts = shard(snapshot[s.name] || [], s.n, s.key);
    const hashes = [];
    for (let i = 0; i < s.n; i++) {
      const h = await digest(JSON.stringify(parts[i])); hashes.push(h);
      if (!prev || prev.sets[s.name]?.h[i] !== h) files.push({
        path: `${CFG.DATA_PATH}/${spec.dir}/${s.name}-${partName(i)}.enc`,
        content: await keyEncrypt(key, parts[i], roleContext(role, `${s.name}/${i}`)),
      });
    }
    sets[s.name] = { n: s.n, h: hashes };
  }
  const mani = { v: 4, role, savedAt: new Date().toISOString(), head, sets };
  files.push({ path: `${CFG.DATA_PATH}/${spec.manifest}`, content: await keyEncrypt(key, mani, roleContext(role, 'manifest')) });
  return { files, mani };
}

function passwordFailure(message) {
  const err = new Error(message); err.code = 'password'; err.friendly = message; return err;
}

async function catalogFiles(password, rotate) {
  if (_cat && _cat.role !== 'owner') throw new Error('FORBIDDEN');
  const snapshot = buildFullSnapshot();
  const staffPw = state.staffPassword || null;
  const freshOwner = !_cat || _cat.version !== 4 || rotate;
  if (freshOwner && passwordProblem(password)) throw passwordFailure(passwordProblem(password));
  if (staffPw && staffPw === password) throw passwordFailure('Пароли владельца и сотрудника должны отличаться.');
  const keys = freshOwner ? { v: 4 } : { ..._cat.keys };
  let key = freshOwner ? null : _cat.key;
  if (freshOwner) {
    const raw = crypto.getRandomValues(new Uint8Array(32));
    key = await importCatalogKey(raw);
    keys.owner = await wrapCatalogKey(raw, password, roleContext('owner', 'key'));
  }
  const own = await roleFiles(snapshot, 'owner', key, freshOwner ? null : _cat.mani);
  const files = [...own.files];
  let staffSaved = null;
  if (staffPw) {
    const changed = !_cat || _cat.staffPassword !== staffPw;
    let staff = !freshOwner && !changed ? _cat.staff : null;
    if (!staff && !freshOwner && !changed && keys.staff) {
      const raw = await unwrapCatalogKey(keys.staff, staffPw, roleContext('staff', 'key'));
      const staffKey = await importCatalogKey(raw);
      const { mani } = await readRoleCatalog(staffKey, 'staff', 4, true);
      staff = { key: staffKey, mani };
    }
    const freshStaff = !staff || rotate || changed;
    if (freshStaff) {
      if (passwordProblem(staffPw)) throw passwordFailure('Пароль сотрудника: ' + passwordProblem(staffPw));
      // После восстановления входа исходного пароля владельца в памяти нет.
      // Сравниваем новый пароль сотрудника с конвертом владельца, а не с null.
      if (!freshOwner) {
        let same = false;
        try { await unwrapCatalogKey(keys.owner, staffPw, roleContext('owner', 'key')); same = true; }
        catch (e) { if (e.message === 'INVALID_CATALOG') throw e; }
        if (same) throw passwordFailure('Пароли владельца и сотрудника должны отличаться.');
      }
      const raw = crypto.getRandomValues(new Uint8Array(32));
      staff = { key: await importCatalogKey(raw), mani: null };
      keys.staff = await wrapCatalogKey(raw, staffPw, roleContext('staff', 'key'));
    }
    const out = await roleFiles(staffSnapshot(snapshot), 'staff', staff.key, freshStaff ? null : staff.mani);
    files.push(...out.files);
    staffSaved = { key: staff.key, mani: out.mani };
  } else {
    if (keys.staff && _cat?.version === 4) {
      files.push({ path: `${CFG.DATA_PATH}/${ROLE_FILES.staff.manifest}`, content: null });
      for (const s of SETS) for (let i = 0; i < s.n; i++) files.push({ path: `${CFG.DATA_PATH}/sec-staff/${s.name}-${partName(i)}.enc`, content: null });
    }
    delete keys.staff;
  }
  if (!_cat || JSON.stringify(keys) !== JSON.stringify(_cat.keys)) files.push({ path: `${CFG.DATA_PATH}/${KEYS_FILE}`, content: JSON.stringify(keys) });
  return { files, saved: { version: 4, key, role: 'owner', mani: own.mani, keys, staff: staffSaved, staffPassword: staffPw } };
}

export async function publishFull(password, { onProgress = null, rotate = false } = {}) {
  if (!state.isAdmin) throw new Error('FORBIDDEN');
  if (_cat?.version === 4 && (!_cat.keys || !_cat.mani)) throw new Error('Показана сохранённая копия. Перед публикацией открой каталог заново при стабильном интернете.');
  const prevIdx = await loadPubIndex();
  const { files, index } = await showcaseFiles(prevIdx);
  files.push({ path: `${CFG.DATA_PATH}/${INDEX_FILE}`, content: JSON.stringify(index) });
  if (!prevIdx && await rawExists(LEGACY_FILE)) files.push({ path: `${CFG.DATA_PATH}/${LEGACY_FILE}`, content: null });

  const cat = await catalogFiles(password, rotate);
  files.push(...cat.files);
  // переход со старого формата: две цельные копии больше не нужны
  for (const old of [SECRET_FILE, STAFF_FILE, 'floor.enc']) {
    if (await rawExists(old)) files.push({ path: `${CFG.DATA_PATH}/${old}`, content: null });
  }
  const sha = await ghCommit(files, 'Каталог: обновлены витрина и защищённые данные', { onProgress });
  _cat = cat.saved;
  state.securityNeedsUpgrade = false;
  await rememberSession();
  return { sha, sent: files.length };
}

// Разложить открытый каталог по состоянию приложения.
function applySnapshot(data, role) {
  state.sessionWarning = '';
  state.catalogNeedsRefresh = false;
  state.groups = data.groups || [];
  state.suppliers = data.suppliers || [];
  state.products = (data.products || []).slice().sort(byName);
  state.prices = data.prices || [];
  state.sales = data.sales || [];
  state.contacts = data.contacts || {};
  state.competitors = data.competitors || [];
  state.compPrices = data.compPrices || [];
  state.unitCoef = data.unitCoef || {};
  state.retailHist = data.retailHist || {};
  state.requests = role === 'owner' ? data.requests || [] : [];
  state.orders = data.orders || [];
  if (data.orderRules) state.orderRules = data.orderRules;
  state.staffPassword = role === 'owner' ? data.staffPassword || null : null;
  tidyMemory();          // каталог мог прийти с залежавшейся историей — чистим сразу
  buildIndex();
  state.popularIds = buildPopularIds();
  state.serverless = true;
  state.isAdmin = role === 'owner';
  state.role = role === 'owner' ? 'admin' : 'staff';
  state.canPurchase = true;
  state.canSales = true;
  return role;
}

// Вход по паролю: приложение само понимает, чей это пароль — владельца или
// сотрудника (чей конвертик открылся). Возвращает 'owner' | 'staff'.
export async function unlockAny(password) {
  const { data, role } = await openCatalog(password);
  return applySnapshot(data, role);
}
// Вход именно владельца (запомненный вход, проверки).
export async function unlockSecret(password) {
  const previous = _cat;
  const { data, role } = await openCatalog(password);
  if (role !== 'owner') { _cat = previous; throw new Error('BAD_PASSWORD'); }
  applySnapshot(data, role);
  return true;
}
// Ожидаемая роль проверяется до изменения данных текущего пользователя.
export async function unlockStaff(password) {
  const previous = _cat;
  const { data, role } = await openCatalog(password);
  if (role !== 'staff') { _cat = previous; throw new Error('BAD_PASSWORD'); }
  applySnapshot(data, role);
  return true;
}

// На устройстве остаётся неизвлекаемый CryptoKey, а не исходный пароль.
// Закрытая офлайн-копия зашифрована и привязана к роли. JSON в localStorage
// содержит только указатель; подмена owner/staff не открывает другой шифртекст.
const AUTH_DEVICE = 'wm_auth_device_v2';
const PRIVATE_DEVICE = 'wm_private_device_v2';
let authGeneration = 0;
let rememberWork = Promise.resolve();
export function rememberSession() {
  const active = _cat;
  if (active?.version !== 4 || !active.key || (!active.keys && !active.tag) || !ROLES.includes(active.role)) return Promise.resolve();
  const gen = authGeneration, role = active.role;
  const snapshot = role === 'owner' ? buildFullSnapshot() : staffSnapshot(buildFullSnapshot());
  rememberWork = rememberWork.catch(() => {}).then(async () => {
    if (gen !== authGeneration) return;
    const old = await idbGet(AUTH_DEVICE);
    if (old && old.role !== role) { localStorage.removeItem(SV_AUTH_KEY); await idbDelete(AUTH_DEVICE); await idbDelete(PRIVATE_DEVICE); }
    const tag = active.keys ? await digest(JSON.stringify(active.keys[role])) : active.tag;
    const body = await keyEncrypt(active.key, snapshot, roleContext(role, 'offline'));
    if (gen !== authGeneration) return;
    await idbSet(PRIVATE_DEVICE, { role, body });
    await idbSet(AUTH_DEVICE, { v: 2, role, key: active.key, tag, version: active.version });
    if (gen === authGeneration) localStorage.setItem(SV_AUTH_KEY, JSON.stringify({ v: 2, role }));
  });
  // Отказ IndexedDB не превращает успешную публикацию в сообщение о провале.
  return rememberWork.catch(() => {});
}
function saveSvAuth() {
  try { const old = JSON.parse(localStorage.getItem(SV_AUTH_KEY) || 'null'); if (old?.pw || (old && old.role !== _cat?.role)) localStorage.removeItem(SV_AUTH_KEY); } catch (e) { /* приватный режим */ }
  return rememberSession();
}
export async function clearSvAuth() {
  authGeneration++;
  try { localStorage.removeItem(SV_AUTH_KEY); } catch (e) { /* приватный режим */ }
  _cat = null;
  await rememberWork.catch(() => {});
  await Promise.all([idbDelete(AUTH_DEVICE), idbDelete(PRIVATE_DEVICE),
    idbSet(CACHE_KEY, { products: publicProducts(state.products), groups: publicGroups(state.groups), suppliers: [], ts: Date.now() })]).catch(() => {});
}
/* ── Вход держится, пока человек сам не выйдет ────────────────────────────────
 * Решение владельца 30.10.2026: «чтобы постоянно с аккаунта не выкидывало,
 * пока сам пользователь не выйдет».
 *
 * Сохранённый вход снимается РОВНО в двух случаях:
 *   • человек нажал «Выйти из аккаунта»;
 *   • конвертик его роли в keys.json изменился или исчез — пароль сменили,
 *     доступ отозван. Это видно только когда файл действительно прочитан.
 *
 * Всё остальное — временные беды: нет сети, GitHub ответил 403 или 404, кусок
 * каталога не докачался, браузер притормозил со своей базой. Раньше любая из
 * них возвращала человека к паролю. Теперь открывается сохранённая копия —
 * расшифровать её может только ключ с ЭТОГО устройства, — а проверка отзыва
 * повторяется в фоне, когда появится связь (recheckAccess).
 *
 * Пароль по-настоящему нужен лишь тогда, когда ключа на устройстве больше нет:
 * браузер вытер свою базу. Чтобы это случалось как можно реже, у браузера
 * просим «постоянное хранилище» (keepStorage) и ставим каталог на домашний
 * экран — установленное приложение данные не теряет. */
export async function restoreSession() {
  // Указатель в localStorage — вторичный: роль и ключ лежат в базе устройства.
  // В приватном окне localStorage может не читаться вовсе; это не причина
  // требовать пароль, если ключ на месте.
  let saved = null;
  try { saved = JSON.parse(localStorage.getItem(SV_AUTH_KEY) || 'null'); }
  catch (e) { saved = null; }
  // Однократный переход со старого хранения пароля — только после проверки.
  if (saved && typeof saved.pw === 'string') {
    try {
      const role = await unlockAny(saved.pw);
      if (role === 'owner') applyServerless(saved.pw); else applyStaff(saved.pw);
      await rememberSession();
      keepStorage();
      return true;
    } catch (e) { await clearSvAuth(); return false; }
  }
  // База устройства могла не успеть открыться — пробуем второй раз, а не
  // выставляем человека к паролю из-за гонки при запуске.
  let device = null;
  for (let attempt = 0; attempt < 2 && !device; attempt++) {
    try { device = await idbGet(AUTH_DEVICE); }
    catch (e) { await new Promise((r) => setTimeout(r, 300)); }
  }
  if (!device) {
    // Ключа нет: либо никто не входил, либо браузер вытер свою базу.
    if (saved) state.sessionWarning = 'Браузер стёр сохранённый вход (так бывает, если каталог давно не открывали). Введи пароль один раз — дальше он сохранится. Чтобы не повторялось, добавь каталог на домашний экран.';
    return false;
  }
  // Указатель противоречит ключу — это подмена, а не сбой: чистим.
  if (!ROLES.includes(device.role) || device.version !== 4 || device.key?.extractable !== false
    || (saved && (saved.v !== 2 || saved.role !== device.role))) { await clearSvAuth(); return false; }
  let data, mani, keys, revoked = false, cached = false;
  try {
    const keysRaw = await fetchRaw(KEYS_FILE);
    if (keysRaw == null) throw new Error('INVALID_CATALOG');
    keys = JSON.parse(keysRaw);
    if (keys.v !== device.version) throw new Error('INVALID_CATALOG');
    if (!keys[device.role] || await digest(JSON.stringify(keys[device.role])) !== device.tag) { revoked = true; throw new Error('BAD_PASSWORD'); }
    ({ data, mani } = await readRoleCatalog(device.key, device.role, device.version, false, device.tag));
  } catch (e) {
    // Отзыв — изменение или удаление конвертика роли. Это единственная ошибка,
    // которая снимает вход; остальные означают «сейчас не получилось».
    if (revoked) { await clearSvAuth(); return false; }
    const cache = await idbGet(PRIVATE_DEVICE).catch(() => null);
    try {
      if (!cache || cache.role !== device.role) throw new Error('BAD_PASSWORD');
      data = await keyDecrypt(device.key, cache.body, roleContext(device.role, 'offline'));
    } catch (err) {
      // Копии нет (вошли и сразу закрыли без единой синхронизации) — тогда
      // пароль действительно нужен, но вход с устройства НЕ удаляем.
      state.sessionWarning = 'Сохранённая копия каталога ещё не собралась. Подключись к интернету и обнови страницу — вход остался на устройстве.';
      return false;
    }
    keys = null; mani = null;
    cached = true;
  }
  _cat = { version: device.version, role: device.role, key: device.key, keys, mani, tag: device.tag,
    staff: null, staffPassword: device.role === 'owner' ? data.staffPassword || null : null };
  applySnapshot(data, device.role);
  if (cached) {
    state.catalogNeedsRefresh = true;
    state.sessionWarning = 'Показана сохранённая копия: интернет пока не отдал свежие данные. Вход сохранён — как только связь появится, каталог обновится сам.';
  }
  // Нет актуальной описи — публикация ждёт сети, офлайн-просмотр работает.
  if (device.role === 'owner') applyServerless(null); else applyStaff(null);
  state.securityNeedsUpgrade = device.version !== 4;
  keepStorage();
  return true;
}

/* ── Быстрый вход: сначала своя копия, сеть потом ────────────────────────────
 * Владелец: «когда я открываю, сразу показывает, как будто я не вошёл, потом
 * загружается всё и уже в моём аккаунте».
 *
 * Так и было: запуск сперва проверял файл ключей по сети и только потом
 * поднимал роль. Замер при медленном интернете (задержка 3 с на ответ):
 * владелец видел кнопку «Войти» и гостевые блоки больше шести секунд.
 *
 * Поэтому вход поднимается из копии на устройстве — без единого сетевого
 * запроса. Копию можно расшифровать только неизвлекаемым ключом этого
 * устройства, то есть это не «доверие localStorage», а тот же ключ, что и при
 * обычном входе. Отзыв пароля и свежие данные догоняют сразу после, уже в
 * фоне (recheckAccess), и экран к тому времени работает.
 *
 * Возвращает false, если копии ещё нет (первый вход на этом устройстве) —
 * тогда зовут обычный restoreSession по сети. */
export async function restoreFast() {
  let saved = null;
  try { saved = JSON.parse(localStorage.getItem(SV_AUTH_KEY) || 'null'); }
  catch (e) { saved = null; }
  if (saved && typeof saved.pw === 'string') return false;    // старое хранение — только полный путь
  let device, cache;
  try { [device, cache] = await Promise.all([idbGet(AUTH_DEVICE), idbGet(PRIVATE_DEVICE)]); }
  catch (e) { return false; }
  if (!device || !cache) return false;
  if (!ROLES.includes(device.role) || device.version !== 4 || device.key?.extractable !== false
    || cache.role !== device.role || (saved && (saved.v !== 2 || saved.role !== device.role))) return false;
  let data;
  try { data = await keyDecrypt(device.key, cache.body, roleContext(device.role, 'offline')); }
  catch (e) { return false; }
  if (!data || !Array.isArray(data.products)) return false;
  _cat = { version: device.version, role: device.role, key: device.key, keys: null, mani: null, tag: device.tag,
    staff: null, staffPassword: device.role === 'owner' ? data.staffPassword || null : null };
  applySnapshot(data, device.role);
  // Предупреждение НЕ показываем: это обычный запуск, а не сбой. Его поставит
  // фоновая проверка, если связи не будет совсем.
  state.catalogNeedsRefresh = true;
  if (device.role === 'owner') applyServerless(null); else applyStaff(null);
  state.securityNeedsUpgrade = false;
  keepStorage();
  return true;
}

/* Попросить браузер не вытирать сохранённый вход. Браузеры сами убирают данные
 * редко посещаемых сайтов (Safari — примерно через неделю), а вместе с ними
 * уходит ключ, и человек оказывается перед паролем «ни с того ни с сего».
 * Просим только у вошедших: гостю хранить нечего. Отказ не беда — просто
 * вернётся прежнее поведение. */
export function keepStorage() {
  try {
    if (navigator.storage && navigator.storage.persist) return navigator.storage.persist().catch(() => false);
  } catch (e) { /* старый браузер */ }
  return Promise.resolve(false);
}

/* Повторная проверка доступа после входа из сохранённой копии: отозван ли
 * пароль и не пора ли подтянуть свежий каталог. Зовётся из app.js, когда
 * появляется связь. Возвращает:
 *   'revoked' — пароль сменили, вход снят (приложение сообщит и перезапустится)
 *   'ok'      — доступ в силе; если удалось дочитать каталог, он уже свежий
 *   'later'   — связи по-прежнему нет, попробуем позже */
export async function recheckAccess(force = false) {
  const active = _cat;
  if (!active || !active.tag || !ROLES.includes(active.role) || active.version !== 4) return 'ok';
  let keys;
  try {
    const raw = await fetchRaw(KEYS_FILE);
    if (raw == null) return 'later';
    keys = JSON.parse(raw);
  } catch (e) { return 'later'; }
  if (keys.v !== active.version) return 'later';
  if (!keys[active.role] || await digest(JSON.stringify(keys[active.role])) !== active.tag) {
    await clearSvAuth();
    return 'revoked';
  }
  if (!active.mani || force) {
    /* Доступ в силе — дочитываем настоящий каталог, чтобы владелец мог
       публиковать без перезагрузки страницы. */
    try {
      /* При возврате в каталог после паузы сначала смотрим ТОЛЬКО опись: в ней
         подписи всех кусков. Ничего не изменилось — расходиться незачем,
         расшифровка двенадцати тысяч товаров на бюджетном телефоне не бесплатна
         и человек почувствовал бы её как подвисание при каждом возврате. */
      if (force && active.mani) {
        const { mani: head } = await readRoleCatalog(active.key, active.role, active.version, true, active.tag);
        if (head && JSON.stringify(head.sets) === JSON.stringify(active.mani.sets)) return 'ok';
      }
      const { data, mani } = await readRoleCatalog(active.key, active.role, active.version, false, active.tag);
      _cat = { ...active, keys, mani };
      applySnapshot(data, active.role);
      if (active.role === 'owner') applyServerless(null); else applyStaff(null);
      await rememberSession();
    } catch (e) { return 'later'; }
  }
  return 'ok';
}

// Включить режим «вошёл владелец без сервера»: кнопки админа, внутренние
// разделы, запомнить пароль для публикаций и вход на устройстве.
export function applyServerless(pw) {
  ui.secretPw = pw;
  state.serverless = true;
  state.session = { user: { email: 'owner' }, serverless: true };
  state.isAdmin = true; state.role = 'admin'; state.canPurchase = true; state.canSales = true;
  saveSvAuth();
  $('adminBtn').classList.toggle('is-admin', true);
  $('adminBtnLabel').hidden = true;
  saveCache();
  renderAll();
  // При входе ничего не удаляем автоматически по имени или штрихкоду.

}
// Сотрудник-бухгалтер видит разрешённые закупки, продажи и контакты,
// но не правит опубликованный каталог и не получает секреты владельца.
export function applyStaff(pw) {
  ui.secretPw = null; // сотрудник не публикует
  state.serverless = true;
  state.session = { user: { email: 'staff' }, serverless: true, staff: true };
  state.isAdmin = false; state.role = 'staff'; state.canPurchase = true; state.canSales = true;
  saveSvAuth();
  $('adminBtn').classList.toggle('is-admin', true);
  $('adminBtnLabel').hidden = true;
  saveCache();
  renderAll();
}

/* ── Вход/выход: админ или сотрудник ──────────── */

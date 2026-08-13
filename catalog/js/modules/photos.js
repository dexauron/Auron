// Фото товаров: поиск в открытых базах, дозаполнение

import { $, state, ui } from './store.js';
import { esc, norm, openSheet, toast } from './core.js';
import { OTHER_CAT, ic } from './icons.js';
import { bigrams, buildIndex, dice, hasPhoto, productCategory } from './catalog.js';
import { renderAll, renderGrid } from './render.js';
import { saveCache } from './data.js';
import { cellStr, normCode, svSaveAndPublish, svUuid } from './imports.js';

/* ── Предложенные фото: сотрудник одобряет/отклоняет ── */
let suggestions = [];

/* ── «Дозаполни витрину»: сотрудник быстро фотографирует товары без фото ── */
const PHOTO_FILL_LIMIT = 60;

export function openPhotoFill() {
  $('photoFillSearch').value = '';
  $('cleanPhotosToggle').checked = cleanPhotosOn();
  renderPhotoFillList();
  openSheet('photoFillSheet');
}

export function renderPhotoFillList() {
  const q = norm($('photoFillSearch').value);
  const all = photoCandidates();
  const total = all.length;
  let list = all;
  if (q) list = all.filter((p) => (p._name || norm(p.name)).includes(q) || (p._codes || []).some((c) => c.includes(q)));
  $('photoFillCount').textContent = q ? `Без фото: ${total} · найдено: ${list.length}` : `Осталось без фото: ${total}`;
  const box = $('photoFillList');
  if (!list.length) {
    box.innerHTML = total
      ? '<p class="muted">Ничего не нашлось. Измени запрос.</p>'
      : '<p class="muted">У всех товаров есть фото — витрина заполнена!</p>';
    return;
  }
  const shown = list.slice(0, PHOTO_FILL_LIMIT);
  box.innerHTML = shown.map((p) => {
    const sub = [p.code ? 'Код ' + esc(p.code) : '', (p.barcodes || [])[0] ? 'ШК ' + esc(p.barcodes[0]) : ''].filter(Boolean).join(' · ');
    return `<div class="fill-row">
      <div class="fill-info"><div class="fill-name">${esc(p.name)}</div>${sub ? `<div class="fill-sub">${sub}</div>` : ''}</div>
      <button class="btn btn-primary fill-cam" data-fill-cam="${esc(p.id)}" aria-label="Снять">${ic('camera', 'ic-xs')}</button>
    </div>`;
  }).join('') + (list.length > shown.length
    ? `<p class="muted" style="text-align:center;margin-top:10px">…и ещё ${list.length - shown.length}. Уточни поиском.</p>` : '');
}

export async function photoFillPick(file) {
  const p = ui.photoFillTarget;
  ui.photoFillTarget = null;
  $('photoFillInput').value = '';
  if (!file || !p) return;
  await addPhotoToProduct(file, p);
  renderPhotoFillList(); // товар с фото уходит из списка
}

export async function createCompetitor(name) {
  const rec = { id: svUuid(), name: String(name).trim() };
  state.competitors.push(rec);
  state.competitors.sort((a, b) => a.name.localeCompare(b.name, 'ru'));
  return rec.id;
}

/* ── Кэш цен на телефоне: карточки открываются и без связи ── */

const PRICE_CACHE_KEY = 'wm_price_cache_v1';
const CONTACTS_CACHE_KEY = 'wm_contacts_cache_v1';
const PRICE_CACHE_MAX = 400; // товаров в кэше; старые вытесняются

/* ── Админ: фото в форме ──────────────────────── */

export function renderPhotoManager() {
  const html = ui.formPhotos.map((ph, i) => `
    <div class="photo-thumb">
      <img src="${esc(ph.url || ph.preview)}" alt="">
      <button type="button" class="thumb-x" data-idx="${i}" aria-label="Убрать">${ic('close', 'ic-xs')}</button>
    </div>`).join('');
  $('photoManager').innerHTML = html + `<button type="button" class="photo-add" id="photoAddBtn" aria-label="Добавить фото">${ic('camera')}</button>`;
}

export async function compressImage(file, maxSide = 1280, quality = 0.82) {
  try {
    const bmp = await createImageBitmap(file);
    const scale = Math.min(1, maxSide / Math.max(bmp.width, bmp.height));
    const w = Math.round(bmp.width * scale);
    const h = Math.round(bmp.height * scale);
    const canvas = document.createElement('canvas');
    canvas.width = w; canvas.height = h;
    canvas.getContext('2d').drawImage(bmp, 0, 0, w, h);
    bmp.close();
    const blob = await new Promise((res) => canvas.toBlob(res, 'image/jpeg', quality));
    return blob || file;
  } catch (e) {
    return file; // формат не поддержан — грузим как есть
  }
}

// «Чистый белый фон»: вырезаем товар из фона и ставим на белый — фото
// становятся ровными, как в витрине. Работает на телефоне, «мозг» для обрезки
// подгружается один раз. Если не вышло (нет сети/не потянул) — берём обычное фото.
let _bgr = null;
const cleanPhotosOn = () => { try { return localStorage.getItem('wm_clean_photos') === '1'; } catch (e) { return false; } };

/* ── Поиск фото по штрихкодам ─────────────────────
 * Открытая всемирная база Open Food Facts (+ Open Beauty Facts для химии
 * и косметики): по штрихкоду отдаёт фото товара. Находятся в основном
 * известные бренды. Найденное фото сжимается и сохраняется в НАШЕ
 * хранилище — дальше работает как обычное фото товара, в т.ч. офлайн. */

const PHOTO_CHECKED_KEY = 'wm_photo_checked_v2'; // товары (id), по которым фото уже искали и не нашли
export const photoCandidates = () =>
  state.products.filter((p) => !hasPhoto(p) && (p.name || (p.barcodes || []).length));

// Открытые бесплатные базы с фото товаров (еда, косметика/бытовая химия,
// корма, прочие товары). Легально, фото под открытой лицензией.
const PHOTO_HOSTS = [
  'world.openfoodfacts.org',
  'world.openbeautyfacts.org',
  'world.openproductsfacts.org',
  'world.openpetfoodfacts.org',
];
const sleep = (ms) => new Promise((res) => setTimeout(res, ms));

/* ── Категория по штрихкоду из открытой базы ────────
 * Что не удалось узнать по названию, пробуем узнать в интернете: у Open Food
 * Facts к штрихкоду привязаны категории. Они на английском и французском,
 * поэтому переводим их в наши тринадцать. Работает только для товаров со
 * штрихкодом и только для тех, что остались в «Прочем» — остальным интернет
 * не нужен, название и так всё сказало. */
const OFF_CAT_MAP = [
  [/dairy|milk|cheese|yogurt|yaourt|cream|butter|egg|fromage|lait/, 'Молочное'],
  [/bread|bakery|pastr|viennoiser|pain|biscotte|cake/, 'Хлеб и выпечка'],
  [/beverage|drink|water|juice|soda|coffee|tea|boisson|eau|jus/, 'Напитки'],
  [/chocolate|candy|sweet|confectioner|biscuit|cookie|wafer|honey|jam|dessert|bonbon/, 'Сладости'],
  [/snack|chips|crisps|nuts|popcorn|cracker|seeds/, 'Снеки'],
  [/meat|sausage|fish|seafood|poultry|ham|bacon|viande|poisson|charcuter/, 'Мясо и рыба'],
  [/frozen|ice-cream|ice cream|surgel|glace/, 'Заморозка'],
  [/hygiene|cosmetic|shampoo|soap|toothpaste|deodorant|beauty|shower|hair/, 'Красота и гигиена'],
  [/cleaning|detergent|laundry|household|home|battery|paper-towel/, 'Дом и химия'],
  [/vegetable|fruit|legume|fresh-produce/, 'Овощи и фрукты'],
  [/cereal|pasta|rice|flour|sugar|salt|oil|sauce|canned|conserve|condiment|spice|grocer/, 'Бакалея'],
  [/baby|infant|diaper|couche/, 'Детское'],
];
function catFromOffTags(tags) {
  const t = (tags || []).join(' ').toLowerCase();
  if (!t) return null;
  for (const [re, cat] of OFF_CAT_MAP) if (re.test(t)) return cat;
  return null;
}
// возвращает {cat, reached}: «база не ответила» и «база не знает» — разные
// вещи, иначе один сбой сети пометил бы товары как безнадёжные
async function catByBarcode(bc) {
  let reached = false;
  for (const host of PHOTO_HOSTS) {
    try {
      const r = await fetch(`https://${host}/api/v2/product/${encodeURIComponent(bc)}.json?fields=categories_tags`);
      if (r.ok) {
        reached = true;
        const d = await r.json();
        const cat = catFromOffTags(d.product && d.product.categories_tags);
        if (cat) return { cat, reached: true };
      } else if (r.status === 404) reached = true;
    } catch (e) { /* сеть моргнула — попробуем в другой раз */ }
    await sleep(320);   // вежливый темп к бесплатной базе
  }
  return { cat: null, reached };
}

// товары, которым название и группа ничего не подсказали
export function uncategorized() {
  return state.products.filter((p) => !p.category && productCategory(p) === OTHER_CAT.name);
}

export async function sortByInternet() {
  const todo = uncategorized().filter((p) => (p.barcodes || []).length);
  if (!todo.length) { toast('Все товары уже разложены по категориям'); return; }
  let found = 0; let miss = 0;
  toast(`Определяю категории по штрихкодам (${todo.length})…`);
  for (let i = 0; i < todo.length; i++) {
    const p = todo[i];
    const r = await catByBarcode(p.barcodes[0]);
    if (!r.reached) {
      if (++miss >= 3) { toast('Открытая база сейчас недоступна, попробуй позже. Найденное не потеряется'); break; }
    } else { miss = 0; }
    if (r.cat) { p.category = r.cat; delete p._cat; found++; }
    if (i % 20 === 0) toast(`Проверено ${i + 1} из ${todo.length}, определено ${found}`);
  }
  buildIndex(); renderAll();
  if (!found) { toast('В открытой базе про эти товары ничего не нашлось'); return; }
  if (state.serverless && state.isAdmin) await svSaveAndPublish(`Разложено по категориям: ${found}`);
  else toast(`Разложено по категориям: ${found}`);
}

// поиск фото по штрихкоду
async function offByBarcode(bc) {
  let reached = false; // хоть одна база ответила по-человечески
  for (const host of PHOTO_HOSTS) {
    try {
      const r = await fetch(`https://${host}/api/v2/product/${encodeURIComponent(bc)}.json?fields=image_front_url`);
      if (r.ok) {
        reached = true;
        const d = await r.json();
        const url = d.product && d.product.image_front_url;
        if (url) return { url, reached: true };
      } else if (r.status === 404) {
        reached = true; // базе вопрос понятен: такого товара у неё просто нет
      }
    } catch (e) { /* сеть моргнула — товар проверим в следующий раз */ }
    await sleep(350); // вежливый темп к бесплатной базе
  }
  return { url: null, reached };
}

// фото похоже на наш товар? (защита от чужой картинки — лучше без фото, чем не то)
function photoNameMatches(ours, theirs) {
  if (!theirs) return false;
  const a = norm(ours).replace(/[^0-9a-zа-я ]/g, ' ').replace(/\s+/g, ' ').trim();
  const b = norm(theirs).replace(/[^0-9a-zа-я ]/g, ' ').replace(/\s+/g, ' ').trim();
  if (!a || !b) return false;
  const sim = dice(bigrams(a.replace(/\s+/g, '')), bigrams(b.replace(/\s+/g, '')));
  if (sim >= 0.5) return true;
  // либо совпало значимое слово (бренд/название) длиной от 4 букв
  const bw = new Set(b.split(' ').filter((w) => w.length >= 4));
  return a.split(' ').some((w) => w.length >= 4 && bw.has(w));
}

// поиск фото по названию (для товаров без штрихкода или если по штрихкоду не нашли).
// Берём фото, только если найденное название реально похоже на наше.
async function offByName(name) {
  const q = norm(name).replace(/[^0-9a-zа-я ]/gi, ' ').replace(/\s+/g, ' ').trim();
  if (q.length < 3) return { url: null, reached: true }; // короткое имя — искать нечего
  let reached = false;
  for (const host of PHOTO_HOSTS) {
    try {
      const url = `https://${host}/cgi/search.pl?search_terms=${encodeURIComponent(q)}`
        + '&search_simple=1&action=process&json=1&page_size=5&fields=product_name,image_front_url';
      const r = await fetch(url);
      if (r.ok) {
        reached = true;
        const d = await r.json();
        for (const prod of (d.products || [])) {
          if (prod.image_front_url && photoNameMatches(name, prod.product_name)) return { url: prod.image_front_url, reached: true };
        }
      }
    } catch (e) { /* пропускаем источник */ }
    await sleep(500);
  }
  return { url: null, reached };
}

// фото товара: сперва по штрихкодам, потом по названию
// Возвращает { url, reached }. reached = false означает «база не ответила»:
// такой товар НЕ помечаем проверенным, попробуем в другой раз.
export async function findProductPhoto(p) {
  let reached = false;
  for (const bc of (p.barcodes || [])) {
    if (!bc) continue;
    const r = await offByBarcode(bc);
    reached = reached || r.reached;
    if (r.url) return r;
  }
  if (p.name) {
    const r = await offByName(p.name);
    return { url: r.url, reached: reached || r.reached };
  }
  return { url: null, reached };
}

export async function attachFoundPhoto(p, url) {
  // Бесплатный режим: своего хранилища нет, поэтому запоминаем ССЫЛКУ на фото
  // из открытой базы. Скачать и переложить к себе браузер всё равно не даёт
  // (чужие сайты это запрещают), а ссылка работает сразу и ничего не весит.
  // Чужую картинку скачать и положить к себе браузер не даёт (защита сайтов),
  // поэтому запоминаем ссылку — лицензия открытой базы это позволяет.
  p.photos = [url];
  p.updated_at = new Date().toISOString();
}

// владелец (личный аккаунт), а не общий аккаунт сотрудников — только он тянет фото автоматически
// фоновые задачи (автопоиск фото, автодедуп) меняют каталог → только у админа.
// Раньше «владелец» = любой не-staff аккаунт; с ролями это уже неверно
// (аналитик — тоже не staff, но менять каталог не может), поэтому проверяем admin.
export const isOwner = () => !!(state.session && state.isAdmin);

/* Автопоиск фото: приложение САМО ищет фото товаров без картинок в фоне,
 * пока владелец в приложении. Продолжается после каждого импорта и между
 * заходами (проверенные штрихкоды запоминаются). Тихо, без кнопок. */
export async function autoPhotoSearch() {
  if (!isOwner() || ui.photoSearchRunning || document.hidden || !navigator.onLine) return;
  let checked = {};
  try { checked = JSON.parse(localStorage.getItem(PHOTO_CHECKED_KEY)) || {}; } catch (e) { /* пусто */ }
  const todo = photoCandidates().filter((p) => !checked[p.id]);
  if (!todo.length) return;
  ui.photoSearchRunning = true;
  const save = () => { try { localStorage.setItem(PHOTO_CHECKED_KEY, JSON.stringify(checked)); } catch (e) { /* некритично */ } };
  toast(`Ищу фото товаров в фоне (${todo.length})…`);
  let done = 0;
  let found = 0;
  let miss = 0;   // подряд неудачных обращений к базе (признак, что она недоступна)
  for (const p of todo) {
    if (!isOwner() || document.hidden || !navigator.onLine) break; // тихо приостановиться
    try {
      const r = await findProductPhoto(p);
      if (r.url) { await attachFoundPhoto(p, r.url); found++; miss = 0; if (found % 6 === 0) { saveCache(); renderGrid(); } }
      else if (r.reached) { checked[p.id] = 1; miss = 0; }
      else miss++;   // база не ответила — товар не помечаем, попробуем позже
    } catch (e) { miss++; }
    if (miss >= 3) break;   // база явно лежит — не молотим впустую весь каталог
    done++;
    if (done % 15 === 0) save();
  }
  save();
  ui.photoSearchRunning = false;
  if (found) {
    saveCache(); renderGrid();
    // публикуем ОДНИМ разом: публикация на каждое фото создала бы тысячи
    // коммитов и упёрлась бы в ограничения GitHub
    if (state.serverless) await svSaveAndPublish(`Добавлено фото: ${found}`);
    else toast(`Добавлено фото: ${found}`);
  }
}

/* Дубли товаров: оставляем один на «имя + штрихкоды», приоритет строке с кодом
 * кассы, затем самой ранней. Работает и как ручная кнопка, и автоматически
 * (после импорта, при входе владельца) — тогда без вопросов. */
function findDuplicateIds() {
  const groups = new Map();
  for (const p of state.products) {
    const key = norm(p.name) + '|' + JSON.stringify(p.barcodes || []);
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(p);
  }
  const toDelete = [];
  for (const arr of groups.values()) {
    if (arr.length < 2) continue;
    arr.sort((a, b) => {
      if (!!a.code !== !!b.code) return a.code ? -1 : 1;
      return String(a.created_at || '').localeCompare(String(b.created_at || ''));
    });
    for (let i = 1; i < arr.length; i++) toDelete.push(arr[i].id);
  }
  return toDelete;
}

// Убрать дубли в бесплатном режиме: правим каталог в памяти и публикуем.
// Раньше это делала база (DELETE ... IN), теперь сервера нет.
async function svDedup(toDelete, silent) {
  if (ui.dedupRunning || !toDelete.length || !isOwner()) return;
  ui.dedupRunning = true;
  const btn = $('menuDedup');
  if (btn) btn.disabled = true;
  if (!silent) toast(`Убираю дубли: ${toDelete.length}…`);
  try {
    const del = new Set(toDelete);
    state.products = state.products.filter((p) => !del.has(p.id));
    buildIndex(); saveCache();
    await svSaveAndPublish(`Убрано дублей: ${toDelete.length}`);
  } catch (e) {
    if (!silent) toast('Ошибка: ' + (e.message || e));
  } finally {
    ui.dedupRunning = false;
    if (btn) { btn.disabled = false; btn.textContent = 'Убрать дубли товаров'; }
  }
}

export function dedupProducts() { // ручная кнопка
  const ids = findDuplicateIds();
  if (!ids.length) { toast('Дублей не найдено'); return; }
  if (confirm(`Найдено дублей: ${ids.length}. Убрать их? Останется по одному товару.`)) svDedup(ids, false);
}

export async function autoDedup() { // тихо, само (после импорта, при входе владельца)
  if (!isOwner()) return;
  const ids = findDuplicateIds();
  if (ids.length) await svDedup(ids, true);
}

export async function runPhotoSearch() {
  const btn = $('photoSearchRun');
  if (ui.photoSearchRunning) { ui.photoSearchRunning = false; return; }
  ui.photoSearchRunning = true;
  btn.textContent = '⏸ Остановить';
  let checked = {};
  try { checked = JSON.parse(localStorage.getItem(PHOTO_CHECKED_KEY)) || {}; } catch (e) { /* пусто */ }
  const saveChecked = () => { try { localStorage.setItem(PHOTO_CHECKED_KEY, JSON.stringify(checked)); } catch (e) { /* некритично */ } };
  const todo = photoCandidates().filter((p) => !checked[p.id]);
  const status = (msg) => { const el = $('photoSearchStatus'); el.hidden = false; el.textContent = msg; };
  let done = 0;
  let found = 0;
  let miss = 0;   // подряд неудачных обращений к базе
  let outage = false;
  status(`Будем проверять: ${todo.length} товаров без фото (по штрихкоду и названию)`);
  for (const p of todo) {
    if (!ui.photoSearchRunning || $('photoSearchSheet').hidden) break;
    try {
      const r = await findProductPhoto(p);
      if (r.url) { await attachFoundPhoto(p, r.url); found++; miss = 0; }
      else if (r.reached) { checked[p.id] = 1; miss = 0; }
      else miss++;
    } catch (e) { miss++; }
    if (miss >= 3) { outage = true; break; }
    done++;
    if (done % 10 === 0) saveChecked();
    status(`Проверено ${done} из ${todo.length} · найдено фото: ${found}`);
  }
  saveChecked();
  ui.photoSearchRunning = false;
  const finished = done >= todo.length;
  btn.textContent = finished ? '▶ Проверить снова' : '▶ Продолжить поиск';
  status(outage
    ? `Открытая база фото сейчас недоступна — попробуй позже. Проверено ${done} из ${todo.length} · найдено: ${found}. Проверенное не потеряется.`
    : `${finished ? 'Готово!' : 'Пауза.'} Проверено ${done} из ${todo.length} · найдено фото: ${found}`);
  if (found) {
    saveCache();
    renderGrid();
    if (state.serverless) await svSaveAndPublish(`Фото найдены и сохранены: ${found}`);
    else toast(`Фото найдены и сохранены: ${found}`);
  }
}

/* ── Фото из Excel по ссылкам ─────────────────────
 * Excel: колонка со ссылкой на фото + колонка со штрихкодом / кодом / названием.
 * Находим товар (штрихкод → код → точное название) и ставим ему это фото по
 * ссылке (внешний адрес, ничего не перезаливаем). */

let photoExcelParsed = null;

// ищем колонки в любом Excel: фото/ссылка + штрихкод/код/название
export function parsePhotoSheet(rows) {
  let header = -1;
  let cols = {};
  for (let r = 0; r < Math.min(rows.length, 30); r++) {
    const labels = rows[r].map((v) => cellStr(v).toLowerCase());
    const c = {};
    labels.forEach((l, i) => {
      if (!l) return;
      if (/фото|ссылк|url|изображ|картинк|photo|image|link/.test(l)) c.url ??= i;
      else if (/штрих|barcode|ean/.test(l)) c.barcode ??= i;
      else if (/код товара|код кассы|номенклатура\.код/.test(l)) c.code = i;
      else if (/^код$|\bкод\b/.test(l) && c.code === undefined) c.code = i;
      else if (/наимен|номенклатур|товар|название|name/.test(l)) c.name ??= i;
    });
    if (c.url !== undefined && (c.barcode !== undefined || c.code !== undefined || c.name !== undefined)) {
      header = r; cols = c; break;
    }
  }
  if (header < 0) throw new Error('Не нашёл в файле колонку со ссылкой на фото и колонку со штрихкодом/кодом/названием');
  const out = [];
  for (let r = header + 1; r < rows.length; r++) {
    const row = rows[r];
    const url = cols.url !== undefined ? cellStr(row[cols.url]) : '';
    if (!/^https?:\/\//i.test(url)) continue; // только настоящие ссылки
    out.push({
      url,
      barcode: cols.barcode !== undefined ? cellStr(row[cols.barcode]) : '',
      code: cols.code !== undefined ? normCode(row[cols.code]) : '',
      name: cols.name !== undefined ? cellStr(row[cols.name]) : '',
    });
  }
  return out;
}

// сопоставляем строки с товарами: штрихкод → код → точное название

// Импорт из 1С: разбор файлов и слияние в каталог

import { $, CFG, state, ui } from './store.js';
import { esc, logError, norm, toast, cmpRu } from './core.js';
import { ic } from './icons.js';
import { buildIndex, fmtNum } from './catalog.js';
import { renderAll } from './render.js';

import { byName, loadCache, saveCache, sortByName, tidyMemory } from './data.js';
import { buildPopularIds, publishFull, SHOWCASE_V } from './publish.js';
import { parsePhotoSheet } from './photos.js';
import { plural } from './competitors.js';
import { loadScript } from './scanner.js';

/* ── Серверлес-импорт: те же парсеры 1С, но результат сливается в каталог в
   памяти (сопоставление по коду → штрихкоду → названию, id и фото сохраняются)
   и публикуется в зашифрованный файл. Парсеры не трогаем — переиспользуем. ── */
// Отдельных экранов загрузки больше нет — всё идёт через «Импорт данных».
// Сами функции загрузки остались (их зовёт умный импорт), но кнопки у них
// теперь не существует: обращения к ней принимает пустышка вместо падения.
const deadBtn = () => ({ disabled: false, textContent: '' });

export function svUuid() { return (crypto.randomUUID ? crypto.randomUUID() : 'p' + Date.now() + Math.random().toString(36).slice(2)); }
// Код номенклатуры из выгрузки Excel приходит с разделителем тысяч, причём
// в разных файлах по-разному: «1 463», «1 463» (неразрывный пробел), «1,463».
// Один и тот же товар из-за этого раздваивался: код из прайса не совпадал с
// кодом из остатков. Приводим к одному виду: пробелы убираем всегда,
// запятые — только когда это явно тройки разрядов.
export function normCode(v) {
  const str = String(v == null ? '' : v).replace(/[\s\u00A0]/g, '');
  return /^\d{1,3}(,\d{3})+$/.test(str) ? str.replace(/,/g, '') : str;
}

/* Ключ названия: те же слова в любом порядке и с единой записью единиц.
 * В справочниках 1С одно и то же пишут по-разному: «Сметана Чабан 25% стакан
 * 200гр» против «Чабан Сметана 25% стакан 200г». Из-за этого штрихкоды таких
 * товаров не привязывались. Сравниваем НАБОР слов: он либо совпадает целиком,
 * либо нет. «Трусики 44шт» и «Трусики 38шт» так не склеятся — числа остаются
 * частью слова, а это разные товары.
 * Про кириллицу и границу слова: в JS «г\b» не срабатывает после русской буквы,
 * поэтому пишем «(?![а-яё])» — на этом уже спотыкались и в поиске, и в разборе. */
const UNIT_FIX = [
  [/(\d+)\s*(?:грамм|гр|г)(?![а-яё])/g, '$1г'],
  [/(\d+)\s*(?:килограмм|кг)(?![а-яё])/g, '$1кг'],
  [/(\d+)\s*(?:миллилитр|мл)(?![а-яё])/g, '$1мл'],
  [/(\d+)\s*(?:литр|л)(?![а-яё])/g, '$1л'],
  [/(\d+)\s*(?:штук|шт)(?![а-яё])/g, '$1шт'],
];
function nameKey(name) {
  let s = norm(name);
  if (!s) return '';
  for (const [re, to] of UNIT_FIX) s = s.replace(re, to);
  const words = s.replace(/[^0-9a-zа-я%]+/g, ' ').split(' ').filter(Boolean);
  return words.sort().join(' ');
}

function svIndex() {
  const byCode = new Map(), byBc = new Map(), byName = new Map(), byKey = new Map();
  for (const p of state.products) {
    if (p.code) byCode.set(normCode(p.code), p);
    for (const b of (p.barcodes || [])) byBc.set(String(b), p);
    byName.set(norm(p.name), p);
    const k = nameKey(p.name);
    // ключ, который подходит сразу двум товарам, ничего не доказывает —
    // такой не используем вовсе, чтобы не привязать штрихкод не туда
    if (k) byKey.set(k, byKey.has(k) ? null : p);
  }
  return { byCode, byBc, byName, byKey };
}
function svMatch(idx, code, barcodes, name) {
  if (code && idx.byCode.has(normCode(code))) return idx.byCode.get(normCode(code));
  for (const b of (barcodes || [])) if (idx.byBc.has(String(b))) return idx.byBc.get(String(b));
  if (name && idx.byName.has(norm(name))) return idx.byName.get(norm(name));
  // последняя попытка: те же слова в другом порядке / «200гр» против «200г»
  if (name) { const k = nameKey(name); if (k && idx.byKey.get(k)) return idx.byKey.get(k); }
  return null;
}
function svGroupId(name) {
  if (!name) return null;
  let g = state.groups.find((x) => norm(x.name) === norm(name));
  if (!g) { g = { id: svUuid(), name: String(name).trim(), sort_order: state.groups.length + 1 }; state.groups.push(g); }
  return g.id;
}
function svSupplierId(name) {
  if (!name) return null;
  let s = state.suppliers.find((x) => norm(x.name) === norm(name));
  if (!s) { s = { id: svUuid(), name: String(name).trim() }; state.suppliers.push(s); }
  return s.id;
}
function svNewProduct(idx, name) {
  const p = { id: svUuid(), name, group_id: null, supplier_ids: [], barcodes: [], photos: [], is_weighted: false, unit: null, retail_price: null };
  state.products.push(p); idx.byName.set(norm(name), p);
  return p;
}
function svAddBarcodes(idx, p, barcodes) {
  if (!barcodes || !barcodes.length) return;
  const set = new Set([...(p.barcodes || []), ...barcodes].filter(Boolean));
  p.barcodes = [...set];
  for (const b of barcodes) if (b) idx.byBc.set(String(b), p);
}
// «Цены поставщиков» (parsePriceReport): товары + штрихкоды + поставщики + закупка + иногда розница
function svUploadPrices(byKey) {
  const idx = svIndex(); state.prices = state.prices || [];
  for (const item of byKey.values()) {
    const barcodes = [...item.barcodes];
    let p = svMatch(idx, item.code, barcodes, item.name);
    if (!p) p = svNewProduct(idx, item.name);
    else { p.supplier_ids = p.supplier_ids || []; p.barcodes = p.barcodes || []; p.photos = p.photos || []; } // товар из витрины мог прийти без этих полей
    if (item.code && !p.code) { p.code = item.code; idx.byCode.set(String(item.code), p); }
    if (item.article && !p.article) p.article = item.article;
    if (item.group) p.group_id = svGroupId(item.group);
    if (item.unit && !p.unit) p.unit = item.unit;
    if (item.weighted) p.is_weighted = true;
    if (item.retail != null) p.retail_price = item.retail;
    svAddBarcodes(idx, p, barcodes);
    for (const supName of item.suppliers) { const sid = svSupplierId(supName); if (!p.supplier_ids.includes(sid)) p.supplier_ids.push(sid); }
    let maxDate = null; // дата поступления = самая свежая цена поставщика (столбец «Период»)
    for (const [supName, info] of item.prices) {
      const sid = svSupplierId(supName);
      if (!p.supplier_ids.includes(sid)) p.supplier_ids.push(sid);
      if (info.date && (!maxDate || info.date > maxDate)) maxDate = info.date;
      const ex = state.prices.find((x) => x.product_id === p.id && x.supplier_id === sid);
      if (ex) { if ((info.date || '') >= (ex.price_date || '')) { ex.price = info.price; ex.price_date = info.date || null; ex.unit = info.unit || null; } }
      else state.prices.push({ product_id: p.id, supplier_id: sid, price: info.price, price_date: info.date || null, unit: info.unit || null });
    }
    // «Поступление» — самая свежая дата цены (для фильтра «🆕 Пришло сегодня»)
    if (maxDate && (!p.arrival_at || maxDate > String(p.arrival_at).slice(0, 10))) p.arrival_at = maxDate;
  }
}
function svUploadRetail(parsed) {
  const idx = svIndex();
  for (const rec of parsed.recs) {
    let p = svMatch(idx, null, [], rec.name);
    if (!p && rec.article) p = state.products.find((x) => x.article && norm(x.article) === norm(rec.article)) || null;
    if (!p) { p = svNewProduct(idx, rec.name); if (rec.article) p.article = rec.article; }
    if (rec.retail != null) p.retail_price = rec.retail;
    if (rec.group) p.group_id = svGroupId(rec.group);
  }
}
function svUploadStock(parsed) {
  const idx = svIndex();
  for (const rec of parsed.recs) {
    const barcodes = rec.barcode ? [rec.barcode] : [];
    let p = svMatch(idx, rec.code, barcodes, rec.name);
    if (!p) p = svNewProduct(idx, rec.name);
    else { p.supplier_ids = p.supplier_ids || []; p.barcodes = p.barcodes || []; p.photos = p.photos || []; }
    if (rec.code && !p.code) { p.code = rec.code; idx.byCode.set(String(rec.code), p); }
    svAddBarcodes(idx, p, barcodes);
    if (rec.group) p.group_id = svGroupId(rec.group);
    if (rec.unit && !p.unit) p.unit = rec.unit;
    if (rec.unit === 'кг') p.is_weighted = true;
    if (rec.retail != null) p.retail_price = rec.retail;
    p.stock = rec.stock;
    // дата остатка из шапки отчёта («на конец дня: 12.08.2026») — без неё
    // непонятно, насколько число свежее, а устаревает оно за сутки
    p.stock_at = parsed.stockAt || null;
  }
}
function svUploadSales(parsed) {
  state.sales = (state.sales || []).filter((s) => !(s.period_from === (parsed.periodFrom || null) && s.period_to === (parsed.periodTo || null)));
  const idx = svIndex();
  const missing = new Set();
  for (const rec of parsed.recs) {
    // Продажи хранятся строками как есть, но сразу проверяем, находится ли товар:
    // молча потерянные строки означали бы, что «Ходовые товары» врут.
    if (!svMatch(idx, rec.code, [], rec.name)) missing.add(rec.name || rec.code || '?');
    state.sales.push({ period_from: parsed.periodFrom || null, period_to: parsed.periodTo || null, code: rec.code || null, name: rec.name, qty: rec.qty, amount: rec.hasAmount ? rec.amount : null });
  }
  return { rows: parsed.recs.length, missing: missing.size, missingList: [...missing] };
}
function svUploadContacts(list) {
  state.contacts = state.contacts || {};
  for (const rec of list) { const sid = svSupplierId(rec.name); state.contacts[sid] = Object.assign({}, state.contacts[sid], { phone: rec.phone || (state.contacts[sid] && state.contacts[sid].phone) || '' }); }
}
/* ── Витрину собрала старая версия приложения ────────────────────────────
 * Владелец работает с расшифрованным каталогом и открытую витрину не читает —
 * значит и не видит, что в ней лежит. Один раз это уже стоило покупателям
 * сканера: штрихкоды добавили в код, но публикация прошла со старой,
 * сохранённой на телефоне версией, и в витрину они не попали. Проверяем сами
 * и говорим владельцу словами. Сотруднику не показываем: публиковать может
 * только владелец, а тревожить человека тем, что он не может исправить,
 * — плохая привычка. */
export async function checkShowcaseFresh() {
  if (!state.isAdmin || !CFG.STATIC_URL) return;
  const el = $('publishBanner');
  if (!el || !el.hidden) return;          // уже висит беда посрочнее
  let meta = null;
  try {
    const r = await fetch(`${CFG.STATIC_URL}index.json?t=${Date.now()}`, { cache: 'no-cache' });
    meta = r.ok ? await r.json() : null;
  } catch (e) { return; }                 // нет связи — зря не пугаем
  if (!meta || Number(meta.app) >= SHOWCASE_V) return;
  el.textContent = 'Витрина на сайте собрана старой версией приложения: '
    + 'покупатели не видят штрихкоды и наличие. Нажми, чтобы опубликовать заново.';
  el.hidden = false;
}

/* Публикация не удалась. Записанное никуда не делось — оно на телефоне, — но
 * сказать об этом надо по-человечески и дать понятное действие, а не показывать
 * код ответа сервера. Плашка держится вверху экрана, пока не опубликуется. */
function showPublishTrouble(err) {
  const el = $('publishBanner');
  if (!el) return;
  if (!err) { el.hidden = true; return; }
  logError('публикация', err.tech || err);   // подробности — в журнал, не человеку
  const why = err.friendly || 'Не получилось опубликовать.';
  const fix = err.code === 'token' ? ' Нажми, чтобы вставить новый ключ.'
    : err.code === 'wait' ? ' Нажми, чтобы попробовать ещё раз.'
      : ' Нажми, чтобы открыть настройки публикации.';
  el.textContent = 'Сохранено на телефоне, но не опубликовано. ' + why + fix;
  el.hidden = false;
  toast('Сохранено на телефоне — опубликовать не вышло');
}

// После правки в памяти — пересобрать индекс, перерисовать и опубликовать на GitHub.
export async function svSaveAndPublish(okMsg) {
  state.products.sort((a, b) => cmpRu(a.name, b.name));
  buildIndex();
  state.popularIds = buildPopularIds();
  renderAll();
  // Каталог уезжает кусками, и их бывает много — показываем ход, чтобы человек
  // не смотрел в неподвижный экран и не думал, что всё зависло.
  const onProgress = (done, total) => { if (total > 3) toast(`Публикую… ${done} из ${total}`); };
  try {
    await publishFull(ui.secretPw, { onProgress });
    showPublishTrouble(null);
    if (okMsg) toast(okMsg);
  } catch (e) {
    showPublishTrouble(e);
  }
}

// Влить справочник штрихкодов: товар ищем по коду/названию, коды ДОБАВЛЯЕМ
// (не затирая уже имеющиеся) и запоминаем единицу каждого кода.
function svUploadBarcodes(parsed) {
  const idx = svIndex();
  let added = 0; let matched = 0; const missing = new Set();
  for (const rec of parsed.recs) {
    const p = svMatch(idx, rec.code, [rec.barcode], rec.name);
    if (!p) { missing.add(rec.name); continue; }
    p.barcodes = p.barcodes || [];
    matched++;
    if (!p.barcodes.includes(rec.barcode)) { p.barcodes.push(rec.barcode); added++; }
    idx.byBc.set(String(rec.barcode), p);
    if (rec.unit) {
      p.barcode_units = p.barcode_units || {};
      p.barcode_units[rec.barcode] = rec.unit;
    }
  }
  return { added, matched, missing: missing.size, missingList: [...missing] };
}

// Словарь единиц: название → сколько базовых единиц в одной такой.
function svUploadUnits(parsed) {
  state.unitCoef = state.unitCoef || {};
  const idx = svIndex();
  const byProduct = new Map();     // товар → его единицы
  let matched = 0; const missing = new Set();
  for (const r of parsed.recs) {
    if (r.coef != null) state.unitCoef[r.unit] = r.coef;
    if (!r.code) continue;
    const p = svMatch(idx, r.code, null, null);
    if (!p) { missing.add(r.code); continue; }
    const list = byProduct.get(p) || [];
    if (!list.some((x) => x.unit === r.unit)) list.push({ unit: r.unit, coef: r.coef });
    byProduct.set(p, list);
  }
  for (const [p, list] of byProduct) {
    // базовая единица первой, дальше упаковки по возрастанию
    list.sort((a, b) => (a.coef || 1) - (b.coef || 1));
    p.pack_units = list;
    matched++;
  }
  return { units: Object.keys(state.unitCoef).length, products: matched, missing: missing.size, missingList: [...missing] };
}

// Разобрать и влить один файл (rows — AoA из readSheet). Возвращает тип.
export function svImportRows(rows) {
  const type = detectReportType(rows);
  if (!type) throw new Error('не понял, что это за файл');
  if (type === 'prices') svUploadPrices(parsePriceReport(rows));
  else if (type === 'retail') svUploadRetail(parseRetailList(rows));
  else if (type === 'stock') svUploadStock(parseStockReport(rows));
  else if (type === 'sales') svUploadSales(parseSalesReport(rows));
  else if (type === 'contacts') svUploadContacts(parseContactsReport(rows));
  else if (type === 'barcodes') svUploadBarcodes(parseBarcodesReport(rows));
  else if (type === 'units') svUploadUnits(parseUnitsReport(rows));
  else throw new Error('тип «' + type + '» пока не поддержан в бесплатном режиме');
  return type;
}

// Витрина из статического файла (data/products.json на GitHub Pages) — для
// покупателя БЕЗ входа. Бесплатно, без сервера, работает офлайн. В файл попадает
// только витрина (товары, розничная цена, фото, описание, категория); секретное
// (закупка, поставщики, поступления, штрихкоды) — нет. Если файла нет или он не
// читается, тихо возвращаем false — приложение грузится с сервера, как раньше.
// Витрина лежит кусками (`p/00.json…`) с описью `index.json`: подпись куска
// стоит в адресе, поэтому после мелкой правки заново качается только один
// кусок, остальное берётся из кэша браузера. Описи нет — читаем старый цельный
// файл, как раньше.
async function fetchShowcase(base, onChunk) {
  const idx = await fetch(base + 'index.json', { cache: 'no-cache' }).catch(() => null);
  if (idx && idx.ok) {
    const meta = await idx.json().catch(() => null);
    if (meta && meta.v === 2 && Array.isArray(meta.parts)) {
      state.showcaseApp = Number(meta.app) || 1;   // чем собрана витрина
      const chunks = [];
      // Куски показываем ПО МЕРЕ ПРИХОДА, а не после последнего: каталог на
      // 17 тысяч товаров — это несколько мегабайт, и ждать их целиком перед
      // первой картинкой в зале слишком долго.
      await Promise.all(meta.parts.map(async (h, i) => {
        const r = await fetch(`${base}p/${String(i).padStart(2, '0')}.json?h=${h}`).catch(() => null);
        chunks[i] = (r && r.ok) ? await r.json().catch(() => []) : [];
        if (onChunk) onChunk(chunks[i]);
      }));
      return [].concat(...chunks);
    }
  }
  const pr = await fetch(base + 'products.json', { cache: 'no-cache' });
  return pr.json();
}

/* Показ по мере загрузки. Полная пересборка поискового индекса на 17 тысячах
 * товаров стоит заметного времени, поэтому делаем её не чаще раза в полсекунды,
 * а в конце — обязательно. Так первые товары видны почти сразу, а телефон не
 * захлёбывается перерисовками. */
function progressiveShow() {
  let last = 0;
  const acc = [];
  return {
    add(list) {
      if (!list || !list.length) return;
      acc.push(...list);
      const now = Date.now();
      if (now - last < 500) return;
      last = now;
      state.products = acc.slice().sort(byName);
      buildIndex();
      $('loader').hidden = true;
      renderAll();
    },
  };
}

async function refreshStatic({ progressive = false } = {}) {
  try {
    const base = CFG.STATIC_URL.endsWith('/') ? CFG.STATIC_URL : CFG.STATIC_URL + '/';
    const show = progressive ? progressiveShow() : null;
    // Цены чужих магазинов больше не качаем: покупателю они не показываются,
    // а вошедший сотрудник берёт их из своего зашифрованного каталога.
    const [products, gr, pop] = await Promise.all([
      fetchShowcase(base, show ? (list) => show.add(list) : null),
      fetch(base + 'groups.json', { cache: 'no-cache' }).catch(() => null),
      fetch(base + 'popular.json', { cache: 'no-cache' }).catch(() => null),
    ]);
    if (!Array.isArray(products)) return false;
    state.groups = (gr && gr.ok) ? await gr.json() : [];
    try { state.popularIds = (pop && pop.ok) ? await pop.json() : []; } catch (e) { state.popularIds = []; }
    state.competitors = []; state.compPrices = []; // разведка цен — только для вошедших
    state.suppliers = []; // покупателю поставщики не нужны (и в файле их нет)
    state.products = sortByName(products);
    buildIndex();
    state.syncMax = '';
    state.lastFetch = Date.now();
    saveCache();
    $('offlineBanner').hidden = true;
    $('loader').hidden = true;
    renderAll();
    return true;
  } catch (e) {
    return false; // любой сбой — откат на загрузку с сервера
  }
}

export async function refresh({ silent = false } = {}) {
  // серверлес: данные уже в памяти (расшифрованный каталог), сервера нет
  if (state.serverless) { renderAll(); return; }
  // Покупатель без входа и включённый STATIC_URL → читаем витрину из файла.
  // Не удалось (файла ещё нет / ошибка) — падаем на обычную загрузку с сервера.
  // Сотрудник после входа всегда грузится с сервера (полные данные).
  if (CFG.STATIC_URL && !state.session) {
    // Сохранённая копия с телефона уже показана при запуске (init). Если её
    // нет — это первый заход, и тогда показываем товары ПО МЕРЕ ЗАГРУЗКИ, не
    // дожидаясь последнего куска: иначе человек смотрит на пустой экран,
    // пока качаются мегабайты.
    const cached = state.products.length > 0;
    if (await refreshStatic({ progressive: !cached })) return;
    if (cached) {                       // сеть не ответила, но каталог показан
      const b = $('offlineBanner');
      b.textContent = 'Нет связи. Показан сохранённый каталог';
      b.hidden = false;
      return;
    }
  }
  // Магазин без базы (бесплатный режим): к серверу идти не к кому. Витрина не
  // загрузилась — значит нет интернета: показываем сохранённое и говорим об этом.
  // Сервера нет: витрина не загрузилась — значит нет интернета. Показываем
  // сохранённый каталог и честно говорим, что связи нет.
  $('loader').hidden = true;
  const banner = $('offlineBanner');
  banner.textContent = (await loadCache())
    ? 'Нет связи. Показан сохранённый каталог'
    : 'Нет интернета. Подключись к сети и обнови страницу';
  banner.hidden = false;
  renderAll();
}

/* ── Импорт из 1С (Excel) ─────────────────────────
 * Файл 1 — отчёт «Цены поставщиков»: товары, коды, группы, поставщики, ед.изм.
 * Файл 2 (не обязателен) — отчёт «Штрихкоды номенклатуры»: все штрихкоды.
 * Товары объединяются по «Код товара»; существующие обновляются, фото сохраняются. */

let impParsed = null; // результат разбора файлов, ждёт подтверждения

/* Разборщик Excel лежит РЯДОМ, а не на чужом сайте: загрузка файлов должна
 * работать и без интернета (телефон в подсобке), и там, где чужие адреса
 * закрыты. Если местной копии почему-то нет — пробуем интернет, чтобы старые
 * устройства с прежним кэшем не остались без импорта. */
function loadXlsxLib() {
  if (window.XLSX) return Promise.resolve();
  return loadScript('vendor/xlsx.min.js')
    .catch(() => loadScript('https://cdn.jsdelivr.net/npm/xlsx@0.18.5/dist/xlsx.full.min.js'));
}

export function cellStr(v) {
  if (v == null) return '';
  if (typeof v === 'number') return String(Math.round(v));
  return String(v).trim();
}

/* Разбор файла — в отдельном потоке (js/xlsx-worker.js): файл из 1С на 17 000
 * строк разбирается несколько секунд, и раньше на это время замирал весь
 * экран. Если отдельный поток недоступен (старый браузер, запрет), разбираем
 * как раньше, прямо здесь — лучше подождать, чем не загрузить вовсе. */
let sheetWorker = null;
function parseInWorker(buf) {
  return new Promise((resolve, reject) => {
    if (typeof Worker === 'undefined') { reject(new Error('нет отдельных потоков')); return; }
    try {
      if (!sheetWorker) sheetWorker = new Worker('js/xlsx-worker.js');
    } catch (e) { reject(e); return; }
    const done = (fn) => { sheetWorker.onmessage = null; sheetWorker.onerror = null; fn(); };
    sheetWorker.onmessage = (ev) => {
      const d = ev.data || {};
      if (d.error) done(() => reject(new Error(d.error)));
      else done(() => resolve(d.rows));
    };
    sheetWorker.onerror = (err) => {
      // поток не запустился — дальше разберём обычным способом
      try { sheetWorker.terminate(); } catch (e) { /* уже мёртв */ }
      sheetWorker = null;
      done(() => reject(err));
    };
    const vendor = new URL('vendor/xlsx.min.js', location.href).href;
    sheetWorker.postMessage({ buf, vendor }, [buf]);
  });
}

async function readSheet(file) {
  const buf = await file.arrayBuffer();
  try {
    const rows = await parseInWorker(buf);
    if (Array.isArray(rows)) return rows;
  } catch (e) { /* разберём здесь же, ниже */ }
  const again = await file.arrayBuffer();     // прежний буфер ушёл в поток
  await loadXlsxLib();
  const wb = window.XLSX.read(again, { type: 'array' });
  const sheet = wb.Sheets[wb.SheetNames[0]];
  return window.XLSX.utils.sheet_to_json(sheet, { header: 1, raw: true, defval: '' });
}

// ищем строку заголовков и определяем, в какой колонке что лежит
function detectColumns(rows) {
  for (let r = 0; r < Math.min(rows.length, 30); r++) {
    const labels = rows[r].map((v) => cellStr(v).toLowerCase());
    const next = (rows[r + 1] || []).map((v) => cellStr(v).toLowerCase());
    if (!labels.some((l) => l.includes('номенклатура') || l.includes('наименование'))) continue;

    const cols = {};
    const width = Math.max(labels.length, next.length);
    for (let c = 0; c < width; c++) {
      const l = (labels[c] || '') + ' ' + (next[c] || '');
      if (!l.trim()) continue;
      if (l.includes('артикул')) cols.article ??= c;
      else if (l.includes('штрих')) cols.barcode ??= c;
      else if (l.includes('код товара') || l.includes('номенклатура.код')) cols.code = c;
      else if (l.includes('код') && cols.code === undefined) cols.code = c;
      else if (l.includes('контрагент') || l.includes('поставщик')) cols.supplier ??= c;
      else if (l.includes('единиц') || /(^|\s)ед\.?(\s|$)/.test(l)) cols.unit ??= c; // «Единица измерения» или «Ед.»
      // розничная цена (цена продажи в магазине) — отдельно от закупочной
      else if (l.includes('розничн') || l.includes('продажн') || l.includes('цена продаж')) cols.retail ??= c;
      else if (l.includes('цена')) cols.price ??= c;
      else if (l.includes('количество') || /(^|\s)кол-?во(\s|$)/.test(l)) cols.qty ??= c;
      // выручка: «Сумма продажи»/«Выручка» — приоритетнее «приходной суммы»/себестоимости/НДС
      else if ((l.includes('сумма продаж') || l.includes('выручка')) && !/приход|ндс|скидк|закуп|себестоим/.test(l)) cols.amount = c;
      else if (l.includes('сумма') && cols.amount === undefined && !/приход|ндс|скидк|закуп|себестоим|дополнит/.test(l)) cols.amount = c;
      else if (l.includes('дата') || l.includes('период')) cols.date ??= c;
      else if (l.includes('групп')) cols.group ??= c;
      else if ((l.includes('номенклатура') || l.includes('наименование')) && cols.name === undefined) cols.name = c;
    }
    if (cols.name === undefined) continue;
    // если следующая строка — подзаголовки («Номенклатура.Код»), данные начинаются через одну
    const hasSubheader = next.some((l) => l.includes('номенклатура.'));
    return { cols, dataStart: r + (hasSubheader ? 2 : 1) };
  }
  return null;
}

// цена из ячейки: число или строка вида «1 234,50»
// Число из ячейки 1С. Универсально понимает разделители:
//   «1 234,56» и «1,234.56» и «1 234.56» -> 1234.56; «96,76» -> 96.76; «45.00» -> 45.
// Запятая = тысячи, если и точка есть, или если после неё ровно 3 цифры.
export function parsePriceNum(v) {
  if (v == null || v === '') return null;
  if (typeof v === 'number') return v > 0 ? v : null;
  let s = String(v).replace(/\s/g, '');
  if (s.includes(',') && s.includes('.')) {
    s = s.lastIndexOf(',') > s.lastIndexOf('.')
      ? s.replace(/\./g, '').replace(',', '.')
      : s.replace(/,/g, '');
  } else if (s.includes(',')) {
    const p = s.split(',');
    s = (p.length === 2 && p[1].length === 3 && /^\d+$/.test(p[0]) && Number(p[0]) !== 0)
      ? s.replace(',', '')
      : s.replace(',', '.');
  }
  const n = parseFloat(s);
  return Number.isFinite(n) && n > 0 ? n : null;
}

// Количество, остаток, коэффициент упаковки — НЕ деньги, и правило для них
// другое. 1С выгружает их с тремя знаками после запятой: «1,000» — это 1,
// «2,500» — это 2,5 кг, «48,000» — это 48 штук в упаковке. Денежный
// разборщик считал такую запятую разделителем тысяч и делал из 48 — 48 000,
// а из остатка 2,5 кг — 2500 кг. В русской выгрузке запятая всегда
// десятичная, разделитель тысяч — пробел. Минус допускаем: остаток бывает
// отрицательным. (Для цен старое правило оставлено: там «1,234» — это 1234 ₽.)
function parseCountNum(v) {
  if (v == null || v === '') return null;
  if (typeof v === 'number') return v;
  let s = String(v).replace(/[\s\u00A0]/g, '');
  const neg = s.startsWith('-');
  s = s.replace(/^[-+]/, '');
  // «1,234.56» — английский формат: запятая там разделяет тысячи
  s = (s.includes(',') && s.includes('.')) ? s.replace(/,/g, '') : s.replace(',', '.');
  const n = parseFloat(s);
  return Number.isFinite(n) ? (neg ? -n : n) : null;
}

function parsePriceReport(rows) {
  const det = detectColumns(rows);
  if (!det) throw new Error('Не нашёл строку заголовков (Номенклатура, Код товара…) в файле 1');
  const { cols, dataStart } = det;
  const byKey = new Map();
  for (let r = dataStart; r < rows.length; r++) {
    const row = rows[r];
    const name = cellStr(row[cols.name]);
    if (!name) continue;
    // «Итого»/«Всего» в конце отчёта — не товар. Без этой проверки после
    // каждой загрузки прайса в каталоге появлялся товар с таким названием.
    if (/^\s*(итого|всего)/i.test(name)) continue;
    const code = cols.code !== undefined ? normCode(row[cols.code]) : '';
    const key = code || norm(name);
    let item = byKey.get(key);
    if (!item) {
      item = { name, code: code || null, article: null, group: null, suppliers: new Set(), barcodes: new Set(), weighted: false, unit: null, retail: null, prices: new Map() };
      byKey.set(key, item);
    }
    const art = cols.article !== undefined ? cellStr(row[cols.article]) : '';
    const grp = cols.group !== undefined ? cellStr(row[cols.group]) : '';
    const sup = cols.supplier !== undefined ? cellStr(row[cols.supplier]) : '';
    const bc = cols.barcode !== undefined ? cellStr(row[cols.barcode]) : '';
    const unit = cols.unit !== undefined ? cellStr(row[cols.unit]).toLowerCase() : '';
    const price = cols.price !== undefined ? parsePriceNum(row[cols.price]) : null;
    const retail = cols.retail !== undefined ? parsePriceNum(row[cols.retail]) : null;
    const rowDate = cols.date !== undefined ? parseDateCell(row[cols.date]) : null; // дата последнего поступления
    if (art && !item.article) item.article = art;
    if (grp && !item.group) item.group = grp;
    if (retail != null && item.retail == null) item.retail = retail; // розничная цена товара
    if (sup) item.suppliers.add(sup);
    if (bc) item.barcodes.add(bc);
    if (unit && !item.unit) item.unit = unit;
    if (unit === 'кг') item.weighted = true;
    if (sup && price != null) {
      // несколько строк по поставщику — оставляем самое свежее поступление.
      // Единицу строки запоминаем: у одного поставщика цена стоит за штуку,
      // у другого — сразу за упаковку, и без этого их нельзя сравнивать.
      const prev = item.prices.get(sup);
      if (!prev || (rowDate || '') >= (prev.date || '')) item.prices.set(sup, { price, date: rowDate, unit: unit || null });
    }
  }
  return byKey;
}

// второй файл: пары «товар — штрихкод», добавляем штрихкоды к товарам из первого
function mergeBarcodesReport(rows, byKey) {
  const det = detectColumns(rows);
  if (!det) throw new Error('Не нашёл строку заголовков в файле 2');
  const { cols, dataStart } = det;
  const byName = new Map();
  for (const item of byKey.values()) byName.set(norm(item.name), item);
  let added = 0;
  for (let r = dataStart; r < rows.length; r++) {
    const row = rows[r];
    const bc = cols.barcode !== undefined ? cellStr(row[cols.barcode]) : '';
    if (!bc) continue;
    const code = cols.code !== undefined ? normCode(row[cols.code]) : '';
    const name = cellStr(row[cols.name]);
    const item = (code && byKey.get(code)) || byName.get(norm(name));
    if (item && !item.barcodes.has(bc)) { item.barcodes.add(bc); added++; }
  }
  return added;
}

// Прайс-лист розничных цен из 1С: колонка «Номенклатура» + «Розничный тип
// цен» (розничная цена). Товары сгруппированы строками-заголовками (у них нет
// цены). Артикул часто внутри названия («Арт.st-917»). Кода нет — товар ищем
// по артикулу и названию.
// дата из шапки прайс-листа: «17.07.2026» или «17 июля 2026 г.»
function parseHeaderDate(rows) {
  const RU_MON = ['январ', 'феврал', 'март', 'апрел', 'мая', 'июн', 'июл', 'август', 'сентябр', 'октябр', 'ноябр', 'декабр'];
  for (let r = 0; r < Math.min(rows.length, 8); r++) {
    const line = (rows[r] || []).map((v) => cellStr(v)).join(' ');
    const iso = parseDateCell(line);
    if (iso) return iso;
    const m = line.toLowerCase().match(/(\d{1,2})\s+([а-яё]+)\s+(\d{4})/);
    if (m) {
      const mi = RU_MON.findIndex((w) => m[2].startsWith(w));
      if (mi >= 0) return `${m[3]}-${String(mi + 1).padStart(2, '0')}-${m[1].padStart(2, '0')}`;
    }
  }
  return null;
}

function parseRetailList(rows) {
  const det = detectColumns(rows);
  if (!det || det.cols.name === undefined || det.cols.retail === undefined) {
    throw new Error('Не нашёл колонки «Номенклатура» и «Розничный тип цен» в прайс-листе');
  }
  const { cols, dataStart } = det;
  const fileDate = parseHeaderDate(rows);
  const recs = []; let group = null;
  for (let r = dataStart; r < rows.length; r++) {
    const name = cellStr(rows[r][cols.name]);
    if (!name) continue;
    if (/^\s*(итого|всего|номенклатура|наименование)/i.test(name)) continue;
    const retail = parsePriceNum(rows[r][cols.retail]);
    if (retail == null) { group = name; continue; } // строка без цены — заголовок группы
    const art = (name.match(/арт[\.\s№:]*([0-9a-zа-яё][0-9a-zа-яё\-\/.]*)/i) || [])[1] || null;
    recs.push({ name, article: art, group, retail });
  }
  return { recs, fileDate };
}

// Единица штрихкода из 1С приходит строкой: «шт», «упак (24)», «кг (2,5)»,
// «Упаковка (50)». В скобках — сколько штук (или кг) в этой упаковке.
// Разбираем её, чтобы показывать понятно: «упаковка — 24 шт».
export function parseBarcodeUnit(raw) {
  const str = String(raw || '').trim();
  if (!str) return null;
  const m = str.match(/^(.*?)\s*\(([^)]+)\)\s*$/);
  const base = (m ? m[1] : str).trim().toLowerCase();
  // сколько базовых единиц в одной такой: сначала из справочника единиц
  // (если он загружен), иначе — из числа в скобках названия
  const fromDict = (state.unitCoef || {})[str];
  const inParens = m ? Number(String(m[2]).replace(',', '.').replace(/\s/g, '')) : null;
  const qty = (fromDict != null && fromDict !== 1) ? fromDict : inParens;
  const isPack = /^упак|^упаковка|^блок|^кор/.test(base);
  const isKg = /^кг$/.test(base);
  const isPc = /^шт/.test(base);
  return { raw: str, base, qty: Number.isFinite(qty) ? qty : null, isPack, isKg, isPc };
}

// «упак (24)» → «упаковка — 24 шт»; «кг (2,5)» → «фасовка 2,5 кг»; «шт» → «штука»
export function fmtBarcodeUnit(raw) {
  const u = parseBarcodeUnit(raw);
  if (!u) return '';
  const n = u.qty != null ? fmtNum(u.qty) : null;
  if (u.isPack) return n ? `упаковка — ${n} шт` : 'упаковка';
  if (u.isKg) return n ? `фасовка ${n} кг` : 'на вес, кг';
  if (u.isPc) return n ? `набор — ${n} шт` : 'штука';
  return n ? `${u.base} — ${n}` : u.base;
}

// порядок показа: сначала штучный код, потом упаковки/блоки по возрастанию
export function barcodeSortKey(p, bc) {
  const u = parseBarcodeUnit((p.barcode_units || {})[bc]);
  if (!u) return [1, 0];
  if (u.isPc && !u.qty) return [0, 0];
  if (u.isKg) return [1, u.qty || 0];
  return [2, u.qty || 0];
}

// Справочник «Единицы измерения» из 1С. Товаров в нём нет — только сами
// единицы и коэффициент (сколько базовых единиц в одной такой). Нужен как
// словарь: «упак (24)» → 24 шт, «кг (2,5)» → 2,5 кг. Обычно число дублируется
// в скобках названия, но словарь надёжнее — он покрывает и единицы без скобок.
function parseUnitsReport(rows) {
  const det = detectColumns(rows);
  // у этого справочника нет колонки «Номенклатура», поэтому detectColumns не
  // сработает — ищем колонки по шапке сами
  let head = -1; let cUnit = 0; let cCoef = -1; let cCode = -1;
  for (let r = 0; r < Math.min(rows.length, 30); r++) {
    const labels = (rows[r] || []).map((v) => cellStr(v).toLowerCase());
    // именно СТРОКА ЗАГОЛОВКОВ: в ней есть и колонка единиц, и коэффициент.
    // Служебные строки шапки («Имя объекта: Единицы измерения») так отсеиваются.
    const ic = labels.findIndex((l) => l.includes('коэффициент') && !l.includes('цены'));
    if (ic < 0) continue;
    const iu = labels.findIndex((l) => /единиц/.test(l) && !l.includes('имя объекта') && !l.includes('в базовой'));
    if (iu < 0) continue;
    head = r; cUnit = iu; cCoef = ic;
    // код номенклатуры — если выгружен, единицы привяжутся к товарам
    cCode = labels.findIndex((l) => l.includes('номенклатура.код') || (l.includes('код') && l.includes('номенклатур')));
    break;
  }
  if (head < 0) throw new Error('Не нашёл в файле колонки «Единицы измерения» и «Коэффициент»');
  const recs = []; const seen = new Set();
  for (let r = head + 1; r < rows.length; r++) {
    const row = rows[r] || [];
    const unit = cellStr(row[cUnit]);
    if (!unit) continue;
    if (/^\s*(итого|всего)/i.test(unit)) continue;   // строка итогов — не единица
    const key = (cCode >= 0 ? normCode(row[cCode]) : '') + '|' + unit;
    if (seen.has(key)) continue;
    seen.add(key);
    const coef = cCoef >= 0 ? parseCountNum(row[cCoef]) : null;
    const code = cCode >= 0 ? normCode(row[cCode]) : '';
    recs.push({ unit, coef, code });
  }
  if (!recs.length) throw new Error('В справочнике единиц нет ни одной строки');
  return { recs };
}

// Справочник «Штрих коды» из 1С: колонки «Штрих код», «Единица», «Номенклатура».
// У одного товара может быть НЕСКОЛЬКО штрихкодов — на штуку, на упаковку, на
// весовую фасовку. Единицу сохраняем рядом с кодом, чтобы было видно, что
// именно пробивается: «шт», «упак (24)», «кг (2,5)».
function parseBarcodesReport(rows) {
  const det = detectColumns(rows);
  if (!det || det.cols.barcode === undefined || det.cols.name === undefined) {
    throw new Error('Не нашёл колонки «Штрих код» и «Номенклатура» в справочнике штрихкодов');
  }
  const { cols, dataStart } = det;
  const recs = [];
  for (let r = dataStart; r < rows.length; r++) {
    const row = rows[r] || [];
    const barcode = cellStr(row[cols.barcode]);
    const name = cellStr(row[cols.name]);
    if (!barcode || !name) continue;
    if (/^\s*(итого|всего)/i.test(name)) continue;
    recs.push({
      barcode,
      name,
      unit: cols.unit !== undefined ? cellStr(row[cols.unit]) : '',
      code: cols.code !== undefined ? normCode(row[cols.code]) : '',
    });
  }
  if (!recs.length) throw new Error('В справочнике штрихкодов нет ни одной строки с кодом и номенклатурой');
  return { recs };
}

// Каталог сам определяет, что за файл 1С загрузили, по его шапке.
// Возвращает: 'prices'|'stock'|'sales'|'contacts'|'retail'|'photo'|'barcodes'|null
function detectReportType(rows) {
  const scan = rows.slice(0, 32);
  const head = scan.map((r) => (r || []).map((c) => cellStr(c)).join('\t')).join('\n').toLowerCase();
  const has = (s) => head.includes(s);
  const cellExact = (val) => scan.some((r) => (r || []).some((c) => cellStr(c).toLowerCase() === val));
  const hasPrice = /цена/.test(head);
  // «Выводить количество подчинённых записей: Да» — служебная строка выгрузки 1С,
  // а не колонка количества. Из-за неё справочник штрихкодов раньше не опознавался.
  const headNoService = head.replace(/выводить количество[^\n]*/g, '');
  const hasQty = headNoService.includes('количество') || /кол-?во/.test(headNoService);
  const hasStock = has('остаток') || has('остатк') || has('на конец дня');
  const hasContragent = cellExact('контрагент');
  const hasPhone = has('телефон');
  const hasSupplier = has('поставщик') || hasContragent;

  if (/https?:\/\//.test(head)) return 'photo';
  // Справочник единиц измерения. Проверяем ПЕРВЫМ: в его шапке есть слова
  // «Розничная цена единицы» и «Количество в упаковке», из-за которых файл
  // раньше принимался за отчёт об остатках.
  if (/имя объекта:\s*единиц/.test(head)) return 'units';
  // Тот же справочник, выгруженный БЕЗ служебной шапки (другая настройка 1С,
  // пересохранённый файл): узнаём по составу колонок. «Коэффициент» рядом с
  // колонкой единиц больше ни в одном отчёте не встречается.
  if (/коэффициент/.test(head) && !/коэффициент цены/.test(head) && /единиц/.test(head)) return 'units';
  // Справочник штрихкодов: 1С сама пишет в шапке имя объекта.
  if (/имя объекта:\s*штрих/.test(head)) return 'barcodes';
  // Либо по составу колонок: есть «Штрих код» и «Номенклатура», а цен,
  // количеств и сумм нет — значит это справочник кодов, а не отчёт.
  const bcDet = detectColumns(rows);
  if (bcDet && bcDet.cols.barcode !== undefined && bcDet.cols.name !== undefined
    && bcDet.cols.price === undefined && bcDet.cols.retail === undefined
    && bcDet.cols.qty === undefined && bcDet.cols.amount === undefined) return 'barcodes';
  // «Контрагент» + «телефон» — однозначно справочник контактов (в отчётах цен
  // телефона нет). Слово «количество» в служебной шапке не должно мешать.
  if (hasContragent && hasPhone) return 'contacts';
  if (has('период') && hasQty && !hasStock) return 'sales';
  if (hasStock || (has('розничная цена') && hasQty)) return 'stock';
  if (has('прайс-лист') || has('прайслист') || has('тип цен')) return 'retail';
  if (hasSupplier && hasPrice) return 'prices';
  if (has('штрих') && !hasPrice && !hasQty) return 'barcodes';
  if ((has('номенклатура') || has('наименование')) && hasPrice) return 'retail';
  return null;
}

const REPORT_LABEL = {
  prices: 'Цены поставщиков и товары',
  stock: 'Остатки и розничные цены',
  sales: 'Продажи за период',
  contacts: 'Контакты поставщиков',
  retail: 'Прайс-лист (розничные цены)',
  photo: 'Фото по ссылкам',
  barcodes: 'Штрихкоды',
  units: 'Справочник единиц измерения',
};

// Загрузка прайс-листа розничных цен: находит товар по артикулу/названию,
// обновляет розничную цену (+ история), новый — создаёт с группой.

/* ── Умный импорт: одна вкладка, каталог сам распознаёт файлы ──
 * Пользователь выбирает любые файлы 1С — программа определяет тип каждого и
 * загружает по очереди (сначала товары/цены, потом продажи/контакты). */
let smartSink = null; // куда перенаправляются сообщения о ходе загрузки

function smartLog(msg) { const el = $('smartStatus'); if (el) { el.hidden = false; el.textContent = msg; } }

export async function smartPick(files) {
  ui.smartEntries = [];
  $('smartRun').hidden = true;
  if (!files || !files.length) { $('smartList').innerHTML = ''; return; }
  smartLog('Читаем файлы…');
  await loadXlsxLib();
  for (const f of files) {
    const entry = { file: f, name: f.name, type: null, count: 0, error: null, parsed: null, rows: null };
    try {
      const rows = await readSheet(f);
      entry.rows = rows;
      entry.type = detectReportType(rows);
      if (!entry.type) throw new Error('не понял, что это за файл');
      // разбираем сразу — чтобы показать, сколько строк распознано
      if (entry.type === 'prices') { entry.byKey = parsePriceReport(rows); entry.count = entry.byKey.size; }
      else if (entry.type === 'retail') { entry.parsed = parseRetailList(rows); entry.count = entry.parsed.recs.length; }
      else if (entry.type === 'stock') { entry.parsed = parseStockReport(rows); entry.count = entry.parsed.recs.length; }
      else if (entry.type === 'sales') { entry.parsed = parseSalesReport(rows); entry.count = entry.parsed.recs.length; }
      else if (entry.type === 'contacts') { entry.parsed = parseContactsReport(rows); entry.count = entry.parsed.length; }
      else if (entry.type === 'photo') { entry.parsed = parsePhotoSheet(rows); entry.count = entry.parsed.length; }
      else if (entry.type === 'barcodes') { entry.parsed = parseBarcodesReport(rows); entry.count = entry.parsed.recs.length; }
      else if (entry.type === 'units') { entry.parsed = parseUnitsReport(rows); entry.count = entry.parsed.recs.length; }
    } catch (e) { entry.error = e.message || String(e); }
    ui.smartEntries.push(entry);
  }
  // На сервере штрихкоды умеют грузиться только «в довесок» к файлу цен —
  // приклеиваем. В бесплатном режиме это отдельный полноценный файл.
  if (!state.serverless) {
    const priceEntry = ui.smartEntries.find((e) => e.type === 'prices' && e.byKey);
    for (const e of ui.smartEntries) {
      if (e.type === 'barcodes' && priceEntry && e.rows) {
        try { e.count = mergeBarcodesReport(e.rows, priceEntry.byKey); e.mergedInto = priceEntry.name; } catch (er) { e.error = er.message; }
      }
    }
  }
  renderSmartList();
  smartLog('');
  $('smartStatus').hidden = true;
  if (ui.smartEntries.some((e) => e.type && !e.error && (state.serverless || e.type !== 'barcodes' || e.mergedInto))) $('smartRun').hidden = false;
}

function renderSmartList() {
  $('smartList').innerHTML = ui.smartEntries.map((e) => {
    if (e.error) return `<div class="smart-row smart-bad"><b>${esc(e.name)}</b><span>${esc(e.error)}</span></div>`;
    const label = REPORT_LABEL[e.type] || e.type;
    const extra = e.mergedInto ? ` → добавятся к «${esc(e.mergedInto)}»` : '';
    return `<div class="smart-row"><b>${esc(e.name)}</b><span>${esc(label)}: ${e.count} ${extra}<span class="smart-st" data-st="${esc(e.name)}"></span></span></div>`;
  }).join('');
}

function setSmartRowStatus(entry, msg) {
  const el = $('smartList').querySelector(`[data-st="${(window.CSS && CSS.escape) ? CSS.escape(entry.name) : entry.name}"]`);
  if (el) el.textContent = ' · ' + msg;
  smartLog(`${entry.name}: ${msg}`);
}

// «Не нашлось товаров: 228» — с голым числом ничего не сделать. Показываем
// несколько примеров и складываем полный список, чтобы владелец мог свериться
// с 1С: чаще всего это снятые с продажи позиции, которых в каталоге и нет.
function missingHint(entry, list) {
  if (!list || !list.length) return '';
  ui.lastMissing.push({ file: entry.name, codes: list });
  const shown = list.slice(0, 3).join(', ');
  return ` (например: ${shown}${list.length > 3 ? '…' : ''})`;
}
// Полный список — файлом: так его можно открыть в Excel и сверить с 1С.
export function downloadMissing() {
  const txt = ui.lastMissing.map((m) => `=== ${m.file} — не нашлось в каталоге: ${m.codes.length}\n` + m.codes.join('\n')).join('\n\n');
  const url = URL.createObjectURL(new Blob([txt], { type: 'text/plain;charset=utf-8' }));
  const a = document.createElement('a');
  a.href = url; a.download = 'не-нашлось-в-каталоге.txt';
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 5000);
}

/* Порядок обработки файлов при загрузке нескольких сразу.
 * Сначала те, что СОЗДАЮТ товары (прайс, розница, остатки), и только потом
 * справочники, которые к товарам привязываются (единицы, штрихкоды).
 * Раньше словарь единиц шёл ПЕРВЫМ — и фасовки у товаров, появившихся в этой
 * же загрузке, не проставлялись: справочник искал их в каталоге, где их ещё
 * не было. Отсюда «кодов без товара» в отчёте о загрузке.
 * Штрихкодам словарь единиц при загрузке не нужен: единицу они хранят
 * строкой как есть, а расшифровывается она уже при показе карточки. */
/* Пары товаров с одинаковым набором слов, но разными кодами. Это почти всегда
 * один и тот же товар, заведённый в 1С дважды («Круассаны Мини» и «Мини
 * Круассаны»). Каталогу они не мешают, но владельцу полезно знать. */
function findTwins() {
  const seen = new Map(); const out = [];
  for (const p of state.products) {
    const k = nameKey(p.name);
    if (!k) continue;
    const first = seen.get(k);
    if (first) { if (String(first.code || '') !== String(p.code || '')) out.push(`${first.name} [${first.code || 'без кода'}] ↔ ${p.name} [${p.code || 'без кода'}]`); }
    else seen.set(k, p);
  }
  return out;
}

export const IMPORT_ORDER = { prices: 0, retail: 1, stock: 2, units: 3, barcodes: 4, photo: 5, sales: 6, contacts: 7 };

export async function smartRun() {
  const btn = $('smartRun');
  btn.disabled = true;
  ui.lastMissing = [];
  $('smartMissing').hidden = true;
  const todo = ui.smartEntries.filter((e) => e.type && !e.error)
    .sort((a, b) => (IMPORT_ORDER[a.type] ?? 9) - (IMPORT_ORDER[b.type] ?? 9));
  let okCount = 0;

  for (const e of todo) {
    try {
      if (e.type === 'prices') svUploadPrices(e.byKey);
      else if (e.type === 'retail') svUploadRetail(e.parsed);
      else if (e.type === 'stock') svUploadStock(e.parsed);
      else if (e.type === 'sales') {
        const r = svUploadSales(e.parsed);
        setSmartRowStatus(e, `строк продаж: ${r.rows}`
          + (r.missing ? `. Нет в каталоге: ${r.missing} — продажи по товарам, которых нет в прайсе${missingHint(e, r.missingList)}` : ''));
        okCount++; continue;
      }
      else if (e.type === 'contacts') svUploadContacts(e.parsed);
      else if (e.type === 'units') {
        const r = svUploadUnits(e.parsed);
        setSmartRowStatus(e, `единиц: ${r.units}` + (r.products ? `, фасовки у товаров: ${r.products}` : '')
          + (r.missing ? `. Нет в каталоге: ${r.missing} — это позиции, которых нет в прайсе (обычно снятые с продажи)${missingHint(e, r.missingList)}` : ''));
        okCount++; continue;
      }
      else if (e.type === 'barcodes') {
        const r = svUploadBarcodes(e.parsed);
        setSmartRowStatus(e, `новых штрихкодов: ${r.added}, привязано к товарам: ${r.matched}`
          + (r.missing ? `. Нет в каталоге: ${r.missing} — штрихкоды от товаров, которых нет в прайсе${missingHint(e, r.missingList)}` : ''));
        okCount++; continue;
      }
      else { setSmartRowStatus(e, 'пропущен (пока не поддержан)'); continue; }
      setSmartRowStatus(e, 'загружено'); okCount++;
    } catch (err) { setSmartRowStatus(e, 'ошибка: ' + (err.message || err)); }
    }
    state.products.sort((a, b) => cmpRu(a.name, b.name));
    // Разобранные файлы больше не нужны: это десятки тысяч строк, которые
    // иначе висели бы в памяти телефона до перезагрузки страницы.
    for (const e of ui.smartEntries) { e.parsed = null; e.byKey = null; e.rows = null; }
    const tidy = tidyMemory();   // выкинуть залежавшуюся историю цен и старые отчёты
    // Одни и те же товары под ДВУМЯ кодами — это дубли в самой 1С, а не в
    // каталоге. Сами их не сливаем (у каждого свой код, и оба пробиваются на
    // кассе), но показываем владельцу: почистить проще у источника.
    const twins = findTwins();
    if (twins.length) {
      smartLog(`Похоже на дубли в самой 1С: ${twins.length} ${plural(twins.length, 'пара', 'пары', 'пар')} — один товар заведён под двумя кодами. Список можно скачать.`);
      ui.lastMissing.push({ file: 'Похожие товары под разными кодами', codes: twins });
    }
    buildIndex(); state.popularIds = buildPopularIds(); renderAll();
    if (tidy.pricesRemoved || tidy.salesRemoved) {
      smartLog(`Убрал из памяти старое: строк истории цен ${tidy.pricesRemoved}, строк старых отчётов продаж ${tidy.salesRemoved}`);
    }
    smartLog('Сохраняем на GitHub…');
    $('smartMissing').hidden = !ui.lastMissing.length;
    try { await publishFull(ui.secretPw); smartLog(`Готово! Загружено файлов: ${okCount} из ${todo.length}. Каталог обновлён и опубликован`); toast('Каталог обновлён'); }
    catch (err) {
      smartLog('Каталог собран, но не опубликован. ' + (err.friendly || err.message || err));
      showPublishTrouble(err);
    }
    btn.disabled = false; btn.hidden = true;
}

/* ── Импорт продаж из 1С ──────────────────────────
 * Отчёт «Продажи»: товар + количество (+ сумма, + дата/период, если есть).
 * Есть колонка даты — продажи раскладываются по дням из файла;
 * нет — все строки записываются на дату, выбранную админом. */

let salesParsed = null;

// дата из ячейки Excel: число-«серийник» или строка «01.07.2026»
function parseDateCell(v) {
  if (v == null || v === '') return null;
  if (typeof v === 'number' && v > 20000 && v < 80000) {
    return new Date(Date.UTC(1899, 11, 30) + v * 86400000).toISOString().slice(0, 10);
  }
  const s = String(v);
  let m = s.match(/(\d{1,2})\.(\d{1,2})\.(\d{2,4})/);
  if (m) {
    const y = m[3].length === 2 ? '20' + m[3] : m[3];
    return `${y}-${m[2].padStart(2, '0')}-${m[1].padStart(2, '0')}`;
  }
  m = s.match(/\d{4}-\d{2}-\d{2}/);
  return m ? m[0] : null;
}

// период отчёта: ищем в верхних строках текст «Период: 01.06.2026 - 12.07.2026»
function parseReportPeriod(rows) {
  for (let r = 0; r < Math.min(rows.length, 14); r++) {
    for (const cell of (rows[r] || [])) {
      const s = String(cell ?? '');
      if (/период/i.test(s)) {
        const ds = s.match(/\d{1,2}\.\d{1,2}\.\d{2,4}/g);
        if (ds && ds.length >= 2) return [parseDateCell(ds[0]), parseDateCell(ds[1])];
        if (ds && ds.length === 1) return [parseDateCell(ds[0]), parseDateCell(ds[0])];
      }
    }
  }
  return [null, null];
}

// Отчёт «Продажи» из 1С обычно агрегирован ЗА ПЕРИОД (в шапке «Период: …»),
// без разбивки по дням, и товары в нём — по названию (кода/штрихкода нет).
function parseSalesReport(rows) {
  const det = detectColumns(rows);
  if (!det) throw new Error('Не нашёл строку заголовков (Номенклатура…) в отчёте');
  const { cols, dataStart } = det;
  if (cols.qty === undefined) throw new Error('Не нашёл колонку «Количество» — выгрузи отчёт «Продажи» с количеством');
  const [periodFrom, periodTo] = parseReportPeriod(rows);
  const recs = new Map(); // товар (по коду или названию) → количество и сумма за период
  for (let r = dataStart; r < rows.length; r++) {
    const row = rows[r];
    const name = cellStr(row[cols.name]);
    if (!name) continue;
    if (/^\s*(итого|всего|total)/i.test(name)) continue; // строки-итоги пропускаем
    const qty = parseCountNum(row[cols.qty]);
    if (qty == null) continue; // итоговые и пустые строки
    const code = cols.code !== undefined ? normCode(row[cols.code]) : '';
    const amount = cols.amount !== undefined ? parsePriceNum(row[cols.amount]) : null;
    const key = code || norm(name);
    let rec = recs.get(key);
    if (!rec) { rec = { code: code || null, name, qty: 0, amount: 0, hasAmount: false }; recs.set(key, rec); }
    rec.qty += qty;
    if (amount != null) { rec.amount += amount; rec.hasAmount = true; }
  }
  return { recs: [...recs.values()], periodFrom, periodTo, hasPeriod: !!(periodFrom && periodTo) };
}

/* ── Импорт контактов поставщиков из 1С ───────────
 * Справочник «Контрагенты»: колонка «Контрагент» (название) + колонка с
 * телефоном. Поставщик находится по названию (нет — создаётся), телефон
 * обновляется. Так контакты накапливаются: повторная загрузка обновит. */

let contactsParsed = null;

function parseContactsReport(rows) {
  let nameCol = -1; let phoneCol = -1; let dataStart = -1;
  for (let r = 0; r < Math.min(rows.length, 30); r++) {
    const cells = (rows[r] || []).map((v) => cellStr(v).toLowerCase());
    let nc = -1; let pc = -1;
    cells.forEach((l, c) => {
      if (nc < 0 && l === 'контрагент') nc = c;
      if (pc < 0 && l.includes('телефон')) pc = c;
    });
    if (nc >= 0 && pc >= 0) { nameCol = nc; phoneCol = pc; dataStart = r + 1; break; }
  }
  if (dataStart < 0) throw new Error('Не нашёл колонки «Контрагент» и «Номер телефона» в файле');
  const byName = new Map();
  for (let r = dataStart; r < rows.length; r++) {
    const name = cellStr(rows[r][nameCol]).trim();
    if (!name) continue;
    const phone = cellStr(rows[r][phoneCol]).replace(/[^\d+]/g, '');
    const prev = byName.get(norm(name));
    // при повторах оставляем запись с телефоном
    if (!prev || (!prev.phone && phone)) byName.set(norm(name), { name, phone });
  }
  return [...byName.values()];
}

/* ── Импорт остатков из 1С (отчёт «Остатки номенклатуры») ──
 * Многострочная шапка. Берём: название, код, штрихкод, группа, ед.,
 * количество (остаток), розничная цена. Товар находится по коду/штрихкоду/
 * названию — обновляется остаток и розничная цена; нет — создаётся. */

let stockParsed = null;

// число из ячейки 1С: убираем разделители тысяч (запятые) и пробелы
// как parsePriceNum, но допускает 0 и отрицательные (остаток бывает минусовым)
function stockNum(v) { return parseCountNum(v); }

function parseStockReport(rows) {
  const cols = {};
  let stockAt = null;
  for (let r = 0; r < Math.min(rows.length, 16); r++) {
    const row = rows[r] || [];
    for (let c = 0; c < row.length; c++) {
      const l = cellStr(row[c]).toLowerCase();
      if (!l) continue;
      if (cols.name === undefined && (l === 'номенклатура' || l === 'наименование' || l === 'название')) cols.name = c;
      else if (cols.code === undefined && (l.includes('код товара') || l === 'номенклатура.код')) cols.code = c;
      else if (cols.barcode === undefined && (l.includes('штрихкод') || l.includes('штрих-код'))) cols.barcode = c;
      else if (cols.group === undefined && (l.includes('группа товара') || l.includes('входит в группу'))) cols.group = c;
      else if (cols.unit === undefined && l.includes('базовая единица')) cols.unit = c;
      else if (cols.stock === undefined && l === 'количество') cols.stock = c;
      else if (cols.retail === undefined && l.includes('розничная цена')) cols.retail = c;
    }
    const line = row.map((v) => cellStr(v)).join(' ');
    const m = line.match(/на конец дня:?\s*(\d{1,2}\.\d{1,2}\.\d{2,4})/i) || line.match(/на дату:?\s*(\d{1,2}\.\d{1,2}\.\d{2,4})/i);
    if (m && !stockAt) stockAt = parseDateCell(m[1]);
  }
  if (cols.name === undefined) throw new Error('Не нашёл колонку «Номенклатура» в отчёте «Остатки»');
  if (cols.stock === undefined) throw new Error('Не нашёл колонку «Количество» — нужен отчёт «Остатки номенклатуры»');
  const recs = [];
  for (let r = 0; r < rows.length; r++) {
    const name = cellStr(rows[r][cols.name]);
    if (!name) continue;
    const code = cols.code !== undefined ? normCode(rows[r][cols.code]) : '';
    const barcode = cols.barcode !== undefined ? cellStr(rows[r][cols.barcode]).replace(/\s/g, '') : '';
    if (!code && !barcode) continue; // строки склада/итогов — пропускаем
    const retail = cols.retail !== undefined ? stockNum(rows[r][cols.retail]) : null;
    recs.push({
      name, code: code || null, barcode: barcode || null,
      group: cols.group !== undefined ? cellStr(rows[r][cols.group]) : '',
      unit: cols.unit !== undefined ? cellStr(rows[r][cols.unit]).toLowerCase() : '',
      stock: stockNum(rows[r][cols.stock]) || 0,
      retail: retail != null && retail > 0 ? retail : null,
    });
  }
  return { recs, stockAt };
}

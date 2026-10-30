// Список покупок — для покупателя

/* Человек листает каталог дома и решает, что взять. Раньше он это держал в
 * голове или писал в заметках отдельно от цен. Здесь он отмечает товары прямо
 * в каталоге и сразу видит, во сколько выйдет: «7 позиций · 1 340 ₽».
 * В зале строки вычёркиваются одним касанием, список можно отправить близким.
 *
 * Всё живёт на его телефоне: сервера нет, да и не нужен — список личный. */

import { $, state, ui } from './store.js';
import { closeSheet, esc, openSheet, toast } from './core.js';
import { fmtNum, fmtPrice, searchProducts } from './catalog.js';
import { plural } from './competitors.js';
import { ic } from './icons.js';
import { buzz, wolfSay } from './mascot.js';
import { WA_MAX_LINES, sendWhatsApp, storeSignature } from './whatsapp.js';
import { copyForOnec, downloadForOnec } from './onec.js';
import { findByBarcode, startScan } from './scanner.js';

const KEY = 'wm_shop_v1';
const MAX = 200;

function read() {
  try { return JSON.parse(localStorage.getItem(KEY)) || []; } catch (e) { return []; }
}
function write(list) {
  try { localStorage.setItem(KEY, JSON.stringify(list.slice(-MAX))); } catch (e) { /* нет места */ }
}

/* Сколько единиц в упаковке — из описания фасовок товара. Нужна только для
   подсказки «это 2 коробки по 12», в расходник уходят штуки. */
function packSize(p) {
  for (const u of ((p && p.pack_units) || [])) {
    const n = Number(u && u.qty);
    if (n > 1) return n;
  }
  return 0;
}

const priceOf = (p) => (p && p.retail_price != null && p.retail_price !== '' ? Number(p.retail_price) : 0);
const inShop = (id) => read().some((x) => x.id === id);

/* Итог считаем по цене, записанной в момент добавления: она могла измениться,
 * но человек планировал бюджет по той, что видел. Если товар ещё в каталоге —
 * берём свежую, чтобы сумма не врала. */
function total(list) {
  return list.filter((x) => !x.done).reduce((s, x) => {
    const p = state.products.find((y) => y.id === x.id);
    const price = p ? priceOf(p) : Number(x.price) || 0;
    return s + price * (Number(x.qty) || 1);
  }, 0);
}

/* Наружу — ради ценника: покупатель отсканировал товар и тут же кладёт его
 * в список, не открывая карточку. */
export function toggleShop(p) {
  if (!p) return false;
  const list = read();
  const i = list.findIndex((x) => x.id === p.id);
  if (i >= 0) { list.splice(i, 1); write(list); renderShopBar(); return false; }
  /* Складываем сразу всё, что нужно выгрузке в 1С: товар может уйти из
     каталога после очередной выгрузки, а заявка должна остаться читаемой. */
  list.push({
    id: p.id, name: p.name || '', code: p.code || '', article: p.article || '',
    barcode: (p.barcodes || [])[0] || '',
    unit: p.is_weighted ? 'кг' : (p.unit || 'шт'), weighted: !!p.is_weighted,
    price: priceOf(p), qty: p.is_weighted ? 1 : 1, done: false,
  });
  write(list);
  renderShopBar();
  return true;
}

function shopQty(id, delta) {
  const list = read();
  const row = list.find((x) => x.id === id);
  if (!row) return;
  // у весового товара шаг полкило: «+1 кг» колбасы — это уже много
  const step = row.weighted ? 0.5 : 1;
  const min = row.weighted ? 0.1 : 1;
  row.qty = Math.max(min, Math.round(((Number(row.qty) || 1) + delta * step) * 1000) / 1000);
  write(list);
  renderShop();
  renderShopBar();
}

// вычеркнуть: в зале удобно отмечать, что уже положил в корзину
function shopDone(id) {
  const list = read();
  const row = list.find((x) => x.id === id);
  if (!row) return;
  row.done = !row.done;
  write(list);
  renderShop();
  renderShopBar();
}

function removeShop(id) {
  write(read().filter((x) => x.id !== id));
  renderShop();
  renderShopBar();
}

function clearShop() {
  if (!read().length) return;
  if (!confirm('Очистить список покупок?')) return;
  write([]);
  closeSheet('shopSheet');
  renderShopBar();
}

/* Полоска над нижней панелью: сколько отмечено и на какую сумму. Она и есть
 * ответ на вопрос «сколько выйдет» — видно, не открывая список. */
function renderShopBar() {
  ui.renderShopBar = renderShopBar;   // звать из общей перерисовки без встречного импорта
  const bar = $('shopBar');
  if (!bar) return;
  const list = read();
  const left = list.filter((x) => !x.done).length;
  /* Виден всем: владелец собирает им расходник, сотрудник — что донести из
     склада, покупатель — что взять. Раньше полоска была только у покупателя. */
  bar.hidden = !list.length;
  if (list.length) {
    $('shopCount').textContent = `${left} ${plural(left, 'позиция', 'позиции', 'позиций')}`;
    $('shopTotal').textContent = fmtPrice(total(list));
  }
}

function openShop() {
  renderShop();
  openSheet('shopSheet');
}

function renderShop() {
  const box = $('shopBody');
  if (!box) return;
  const list = read();
  if (!list.length) {
    box.innerHTML = `<p class="ios-note">Список пуст. Открой товар и нажми «В список покупок» —
      здесь соберётся, что взять, и сколько это выйдет.</p>`;
    $('shopShare').hidden = true;
    $('shopWa').hidden = true;
    renderFind();            // поле поиска остаётся: с него список и начинают
    return;
  }
  const rows = list.map((x) => {
    const p = state.products.find((y) => y.id === x.id);
    const price = p ? priceOf(p) : Number(x.price) || 0;
    const qty = Number(x.qty) || 1;
    const sum = price * qty;
    // «кг» или «шт» прямо у числа: иначе непонятно, две штуки или два килограмма
    const unit = x.unit || (p && p.is_weighted ? 'кг' : ((p && p.unit) || 'шт'));
    /* Подсказка про упаковки: количество ставится в штуках (в них считается и
       расходник), а сколько это коробок — говорим рядом словами. */
    const packQty = packSize(p);
    const packHint = (!x.weighted && packQty > 1 && qty >= packQty)
      ? `${fmtNum(Math.floor(qty / packQty))} ${plural(Math.floor(qty / packQty), 'упаковка', 'упаковки', 'упаковок')} по ${fmtNum(packQty)}`
      : '';
    return `<div class="swipe-wrap"><span class="swipe-hint">Убрать</span>
    <div class="ios-row shop-row${x.done ? ' shop-done' : ''}">
      <button class="shop-check" data-shop-done="${esc(x.id)}" aria-label="Вычеркнуть">
        ${x.done ? ic('check', 'ic-xs') : ''}</button>
      <span class="ios-row-title">${esc(x.name)}
        <span class="ord-sub">${(Number(x.qty) || 1) > 1
    ? `${fmtNum(x.qty)} ${esc(unit)} × ${fmtPrice(price)} = ${fmtPrice(sum)}`
    : (price ? fmtPrice(price) : 'цена не указана')}${x.code ? ' · код ' + esc(x.code) : ''}${
  packHint ? ' · ' + esc(packHint) : ''}</span></span>
      <span class="qty-step">
        <button data-shop-minus="${esc(x.id)}" aria-label="Меньше">−</button>
        <input class="shop-qty" type="text" inputmode="decimal" data-shop-qty="${esc(x.id)}"
               value="${fmtNum(x.qty)}" aria-label="Количество">
        <span class="shop-unit">${esc(unit)}</span>
        <button data-shop-plus="${esc(x.id)}" aria-label="Больше">+</button>
      </span>
      <button class="rst-rm" data-shop-rm="${esc(x.id)}" aria-label="Убрать">${ic('close', 'ic-xs')}</button>
    </div></div>`;
  }).join('');
  const left = list.filter((x) => !x.done).length;
  box.innerHTML = `
    <div class="ord-total">${left} ${plural(left, 'позиция', 'позиции', 'позиций')} · итого <b>${fmtPrice(total(list))}</b></div>
    <div class="ios-group">${rows}</div>
    <p class="ios-note">Отметил кружком — вычеркнул: удобно в зале. Строку можно смахнуть влево,
    чтобы убрать. Сумма считается по сегодняшним ценам магазина и по количеству,
    которое ты поставил.</p>`;
  $('shopShare').hidden = false;
  $('shopWa').hidden = false;
  renderFind();
}

/* ── Список по ссылке ───────────────────────────────────────────────────────
 * Раньше список уходил близким простым текстом: прочитать можно, а пользоваться
 * нельзя — ни цен, ни суммы, ни возможности вычёркивать по ходу. Теперь рядом
 * с текстом уходит ссылка, и тот, кто её откроет, получает ТОТ ЖЕ список прямо
 * в каталоге: с сегодняшними ценами, суммой и галочками.
 *
 * Сервер для этого не нужен: весь список умещается в самой ссылке. Кодируем
 * кодами товаров — они короткие («5940»), в отличие от внутренних номеров.
 * Ссылка получается вида …/catalog/#l=5940-101x2-102 и спокойно живёт в
 * WhatsApp. У товара без кода берём внутренний номер с пометкой «i».
 *
 * Полученный список ДОБАВЛЯЕТСЯ к своему, а не заменяет его: человек мог уже
 * что-то отметить сам, и потерять это из-за чужой ссылки он не должен. */
const LIST_MAX = 60;      // длиннее в ссылку не влезет, да и не бывает

export function shopLink() {
  const parts = [];
  for (const x of read().filter((y) => !y.done).slice(0, LIST_MAX)) {
    const p = state.products.find((y) => y.id === x.id);
    const code = p && p.code ? String(p.code) : '';
    const key = code ? code : 'i' + x.id;
    if (/[-x&#]/.test(key)) continue;                 // ключ в ссылку не годится
    const q = Number(x.qty) || 1;
    parts.push(q > 1 ? `${key}x${q}` : key);
  }
  if (!parts.length) return '';
  const base = location.origin + location.pathname;
  return `${base}#l=${parts.join('-')}`;
}

/* Открыли ссылку со списком: собираем товары и добавляем к своим. */
export function shopFromHash() {
  const m = String(location.hash || '').match(/[#&]l=([^&]+)/);
  if (!m) return;
  try { history.replaceState(history.state, '', location.pathname + location.search); } catch (e) { /* некритично */ }
  const list = read();
  const have = new Set(list.map((x) => x.id));
  let added = 0; let missing = 0;
  for (const chunk of decodeURIComponent(m[1]).split('-')) {
    if (!chunk) continue;
    const [key, qty] = chunk.split('x');
    const p = key[0] === 'i'
      ? state.products.find((x) => String(x.id) === key.slice(1))
      : state.products.find((x) => x.code != null && String(x.code) === key);
    if (!p) { missing++; continue; }
    if (have.has(p.id)) continue;                      // уже есть — количество не трогаем
    /* Кладём тот же набор полей, что и обычное добавление: артикул, штрихкод,
       единицу и признак «весовой». Без них присланный список выгружался в 1С
       неполным, стоило товару уйти из каталога, а у весового товара кнопка «+»
       шагала по килограмму вместо полукилограмма. */
    list.push({
      id: p.id, name: p.name || '', code: p.code || '', article: p.article || '',
      barcode: (p.barcodes || [])[0] || '',
      unit: p.is_weighted ? 'кг' : (p.unit || 'шт'), weighted: !!p.is_weighted,
      price: priceOf(p), qty: Number(qty) || 1, done: false,
    });
    have.add(p.id);
    added++;
  }
  if (!added && !missing) return;
  write(list);
  renderShopBar();
  openShop();
  toast(added
    ? `Добавил ${added} ${plural(added, 'позицию', 'позиции', 'позиций')} из присланного списка`
    : 'Этих товаров у нас нет');
}

/* ── Отправить список ───────────────────────────────────────────────────────
 * Собрал список дома — отправил мужу, матери, в группу «Семья»: пусть купит
 * тот, кто ближе к магазину. Текст один и тот же, отличается только разметка:
 * WhatsApp понимает *звёздочки* как жирный шрифт, в остальных местах это
 * просто мусор на экране.
 *
 * Длинный список в сообщение не заталкиваем: после шестидесяти строк это уже
 * не сообщение, а простыня. Хвост честно назван числом, а весь список целиком
 * открывается по ссылке. */
function shopText(wa) {
  const list = read().filter((x) => !x.done);
  const b = (s) => (wa ? `*${s}*` : s);
  const lines = list.slice(0, WA_MAX_LINES).map((x, i) => {
    const p = state.products.find((y) => y.id === x.id);
    const price = p ? priceOf(p) : Number(x.price) || 0;
    const qty = Number(x.qty) || 1;
    let tail = '';
    if (price && qty > 1) tail = ` — ${fmtNum(qty)} × ${fmtPrice(price)} = ${fmtPrice(price * qty)}`;
    else if (price) tail = ` — ${fmtPrice(price)}`;
    else if (qty > 1) tail = ` — ${fmtNum(qty)} шт`;
    return `${i + 1}. ${x.name}${tail}`;
  });
  const rest = list.length - lines.length;
  const parts = [b('Список покупок'), '', lines.join('\n')];
  if (rest > 0) parts.push(`…и ещё ${rest} ${plural(rest, 'позиция', 'позиции', 'позиций')} — весь список по ссылке.`);
  parts.push('', b(`Итого: ${fmtPrice(total(read()))}`));
  // ссылку даём отдельной строкой: текст читается и без неё, а по ссылке
  // список откроется живым — с ценами и галочками
  const link = shopLink();
  if (link) parts.push('', 'Открыть список в каталоге:', link);
  const sign = storeSignature();
  if (sign) parts.push('', sign);
  return parts.join('\n');
}

// Кнопка «Отправить в WhatsApp»: контакты покажет сам WhatsApp
function shopToWhatsApp() {
  if (!read().some((x) => !x.done)) { toast('Список пуст'); return; }
  buzz();
  sendWhatsApp(shopText(true));
}

// Кнопка «Отправить»: телеграм, почта, СМС — что человек выберет сам
async function shareShop() {
  if (!read().some((x) => !x.done)) { toast('Список пуст'); return; }
  const text = shopText(false);
  try {
    if (navigator.share) { await navigator.share({ text }); return; }
    await navigator.clipboard.writeText(text);
    toast('Список и ссылка скопированы');
  } catch (e) { toast('Не получилось поделиться'); }
}

// подпись кнопки в карточке товара
export function syncShopButton(p) {
  const b = $('btnShopAdd');
  if (!b || !p) return;
  b.textContent = inShop(p.id) ? 'Убрать из списка покупок' : 'В список покупок';
  ui.shopFor = p.id;
}

/* ── Добавление прямо в окне списка ─────────────────────────────────────────
 * Собрать список на сорок позиций, выходя за каждой в каталог, невозможно:
 * найти товар, открыть карточку, нажать «в список», вернуться — и так сорок
 * раз. Поэтому здесь своё поле и своя кнопка камеры. Поиск при этом НЕ свой:
 * зовём тот же searchProducts, что и главный экран, иначе выдача разъехалась
 * бы с привычной. */
const FIND_ROWS = 7;          // больше строк не помещается над списком

function renderFind() {
  const box = $('shopFindList');
  if (!box) return;
  const q = String(ui.shopQuery || '').trim();
  if (q.length < 2) { box.innerHTML = ''; return; }
  const have = new Set(read().map((x) => x.id));
  const hits = searchProducts(q, state.products, FIND_ROWS);
  if (!hits.length) {
    box.innerHTML = '<p class="ios-note">Ничего не нашлось. Попробуй код или часть названия.</p>';
    return;
  }
  box.innerHTML = `<div class="ios-group">${hits.map((p) => {
    const inList = have.has(p.id);
    return `<button class="ios-row ios-row-link${inList ? ' grp-on' : ''}" data-shop-pick="${esc(p.id)}">
      <span class="ios-row-title">${esc(p.name)}
        <span class="ord-sub">${p.code ? 'код ' + esc(p.code) : 'без кода'}${
  p.retail_price ? ' · ' + esc(fmtPrice(p.retail_price)) : ''}${p.is_weighted ? ' · весовой' : ''}</span></span>
      <span class="ios-row-value">${inList ? ic('check', 'ic-xs') : '+'}</span></button>`;
  }).join('')}</div>`;
}

/* Выбрали товар из найденного: добавляем и очищаем поле, чтобы сразу набирать
 * следующий. Уже добавленный не удаляем по второму тапу — в списке покупок это
 * было бы ловушкой: искал, нашёл, тапнул и случайно убрал. */
function pickFound(id) {
  const p = state.products.find((x) => x.id === id);
  if (!p) return;
  if (!inShop(p.id)) { toggleShop(p); toast('Добавил: ' + p.name); }
  else toast('Уже в списке');
  ui.shopQuery = '';
  const f = $('shopFind');
  if (f) { f.value = ''; f.focus(); }
  renderFind();
  renderShop();
}

/* Сканер в окне списка. Камера не закрывается: обходя склад, человек наводит
 * её на товар за товаром. Весовую этикетку понимаем тоже — вес с неё сразу
 * становится количеством, его не надо набирать руками. */
export function scanToShop(text) {
  const box = $('scanResult');
  if (!box) return;
  const found = findByBarcode(text);
  const p = found && found.p;
  box.hidden = false;
  if (!p) {
    box.innerHTML = `<div class="scan-result-miss">Нет в каталоге</div>
      <div class="scan-result-code">${esc(text)}</div>`;
    return;
  }
  const list = read();
  const row = list.find((x) => x.id === p.id);
  const kg = found.grams ? Math.round((found.grams / 1000) * 1000) / 1000 : 0;
  if (row) {
    // тот же товар второй раз — прибавляем: так считают, обходя полки
    row.qty = Math.round(((Number(row.qty) || 0) + (kg || 1)) * 1000) / 1000;
    write(list);
  } else {
    toggleShop(p);
    if (kg) {
      const l2 = read();
      const r2 = l2.find((x) => x.id === p.id);
      if (r2) { r2.qty = kg; write(l2); }
    }
  }
  renderShopBar();
  renderShop();
  const now = read().find((x) => x.id === p.id) || {};
  box.innerHTML = `<div class="scan-result-name">${esc(p.name)}</div>
    <div class="scan-result-price">в списке: ${fmtNum(now.qty)} ${esc(now.unit || 'шт')}</div>
    <div class="scan-result-code">всего позиций: ${read().length}</div>`;
}

/* ── Смахнуть строку влево — убрать ──────────────────────────────────────
 * В зале человек держит телефон одной рукой, и попасть в маленький крестик
 * на ходу трудно. Смахивание — то же движение, что в почте и в заметках:
 * его не нужно объяснять. Направление определяем по первым восьми точкам
 * пути: если палец пошёл вниз, это прокрутка списка, и мы отпускаем строку.
 * Крестик при этом никуда не делся — жест его дополняет, а не заменяет. */
const SWIPE_OUT = 80;    // столько нужно протянуть, чтобы строка ушла

function enableSwipeRemove(box) {
  let row = null; let x0 = 0; let y0 = 0; let dx = 0; let axis = '';
  const release = (animate) => {
    if (!row) return;
    const r = row;
    row = null;
    r.style.transition = animate ? 'transform .24s cubic-bezier(.32,.72,0,1)' : '';
    r.style.transform = '';
    r.classList.remove('swipe-armed');
    setTimeout(() => { r.style.transition = ''; }, 300);
  };
  box.addEventListener('touchstart', (e) => {
    row = null;
    const r = e.target.closest('.shop-row');
    // по кнопкам и по полю количества жест не начинаем: там набирают цифры
    if (!r || e.target.closest('button, input')) return;
    row = r; dx = 0; axis = '';
    x0 = e.touches[0].clientX; y0 = e.touches[0].clientY;
    r.style.transition = 'none';
  }, { passive: true });
  box.addEventListener('touchmove', (e) => {
    if (!row) return;
    const x = e.touches[0].clientX; const y = e.touches[0].clientY;
    if (!axis) {
      if (Math.abs(x - x0) < 8 && Math.abs(y - y0) < 8) return;
      axis = Math.abs(x - x0) > Math.abs(y - y0) ? 'x' : 'y';
      if (axis === 'y') { release(false); return; }   // это прокрутка, не жест
    }
    dx = Math.min(0, x - x0);                          // тянем только влево
    row.style.transform = `translateX(${dx}px)`;
    row.classList.toggle('swipe-armed', dx < -SWIPE_OUT);
  }, { passive: true });
  const finish = () => {
    if (!row) return;
    const id = (row.querySelector('[data-shop-rm]') || {}).dataset;
    const far = dx < -SWIPE_OUT;
    release(true);
    if (far && id && id.shopRm) { buzz(12); removeShop(id.shopRm); }
  };
  box.addEventListener('touchend', finish);
  box.addEventListener('touchcancel', () => release(true));
}

/* Обработчики модуль вешает сам: раньше все до одного жили в app.js, и он
 * разросся за предел, который держит проверка «модули». Логика списка покупок
 * и кнопки к ней — это одно целое, им и место рядом. */
export function bindShopping() {
  $('btnShopAdd').addEventListener('click', () => {
    const p = ui.currentProduct;
    if (!p) return;
    const added = toggleShop(p);
    syncShopButton(p);
    if (added) { buzz(); wolfSay('Записал в список покупок'); }
    else toast('Убрано из списка');
  });
  $('shopOpen').addEventListener('click', openShop);
  $('shopShare').addEventListener('click', shareShop);
  $('shopWa').addEventListener('click', shopToWhatsApp);
  /* Выгрузка в 1С и «Сохранить как заявку» — только вошедшим: это рабочая
     часть, покупателю она ни к чему. */
  $('shopFind').addEventListener('input', (e) => { ui.shopQuery = e.target.value; renderFind(); });
  $('shopFindList').addEventListener('click', (e) => {
    const b = e.target.closest('[data-shop-pick]');
    if (b) pickFound(b.dataset.shopPick);
  });
  $('shopScan').addEventListener('click', () => {
    const t = $('scanTitle'); if (t) t.textContent = 'Наведи камеру — товар уйдёт в список покупок';
    const seg = $('scanModeSeg'); if (seg) seg.hidden = true;   // режимы тут не нужны
    const res = $('scanResult'); if (res) { res.hidden = true; res.innerHTML = ''; }
    startScan(scanToShop, { keepOpen: true });
  });
  /* Количество набирается руками: кнопками ±1 набрать «24» — двадцать четыре
     нажатия. Пустое поле и мусор не превращаем в ноль молча — возвращаем то,
     что было, иначе позиция тихо исчезла бы из выгрузки. */
  $('shopBody').addEventListener('change', (e) => {
    const inp = e.target.closest('[data-shop-qty]');
    if (!inp) return;
    const list = read();
    const row = list.find((x) => x.id === inp.dataset.shopQty);
    if (!row) return;
    const n = Number(String(inp.value).replace(',', '.').replace(/\s/g, ''));
    if (!Number.isFinite(n) || n <= 0) { inp.value = fmtNum(row.qty); return; }
    row.qty = Math.round(n * 1000) / 1000;
    write(list);
    renderShop();
    renderShopBar();
  });
  $('shopCopy1c').addEventListener('click', () => copyForOnec(read()));
  $('shopFile1c').addEventListener('click', () => downloadForOnec(read(), 'Список покупок'));
  $('shopSaveReq').addEventListener('click', () => {
    if (ui.saveAsRequest) ui.saveAsRequest(read());
  });
  $('shopClear').addEventListener('click', clearShop);
  $('shopBody').addEventListener('click', (e) => {
    const done = e.target.closest('[data-shop-done]');
    if (done) { shopDone(done.dataset.shopDone); return; }
    const minus = e.target.closest('[data-shop-minus]');
    if (minus) { shopQty(minus.dataset.shopMinus, -1); return; }
    const plus = e.target.closest('[data-shop-plus]');
    if (plus) { shopQty(plus.dataset.shopPlus, 1); return; }
    const rm = e.target.closest('[data-shop-rm]');
    if (rm) removeShop(rm.dataset.shopRm);
  });
  enableSwipeRemove($('shopBody'));
  // ссылку со списком могли открыть, уже находясь в каталоге
  window.addEventListener('hashchange', shopFromHash);
  renderShopBar();   // список мог остаться с прошлого захода
}

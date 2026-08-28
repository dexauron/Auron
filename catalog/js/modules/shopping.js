// Список покупок — для покупателя

/* Человек листает каталог дома и решает, что взять. Раньше он это держал в
 * голове или писал в заметках отдельно от цен. Здесь он отмечает товары прямо
 * в каталоге и сразу видит, во сколько выйдет: «7 позиций · 1 340 ₽».
 * В зале строки вычёркиваются одним касанием, список можно отправить близким.
 *
 * Всё живёт на его телефоне: сервера нет, да и не нужен — список личный. */

import { $, state, ui } from './store.js';
import { closeSheet, esc, openSheet, toast } from './core.js';
import { fmtNum, fmtPrice } from './catalog.js';
import { plural } from './competitors.js';
import { ic } from './icons.js';
import { buzz, wolfSay } from './mascot.js';

const KEY = 'wm_shop_v1';
const MAX = 200;

function read() {
  try { return JSON.parse(localStorage.getItem(KEY)) || []; } catch (e) { return []; }
}
function write(list) {
  try { localStorage.setItem(KEY, JSON.stringify(list.slice(-MAX))); } catch (e) { /* нет места */ }
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
  list.push({ id: p.id, name: p.name || '', code: p.code || '', price: priceOf(p), qty: 1, done: false });
  write(list);
  renderShopBar();
  return true;
}

function shopQty(id, delta) {
  const list = read();
  const row = list.find((x) => x.id === id);
  if (!row) return;
  row.qty = Math.max(1, Math.round(((Number(row.qty) || 1) + delta) * 1000) / 1000);
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
  bar.hidden = !(list.length && !state.session);
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
    return;
  }
  const rows = list.map((x) => {
    const p = state.products.find((y) => y.id === x.id);
    const price = p ? priceOf(p) : Number(x.price) || 0;
    const sum = price * (Number(x.qty) || 1);
    return `<div class="swipe-wrap"><span class="swipe-hint">Убрать</span>
    <div class="ios-row shop-row${x.done ? ' shop-done' : ''}">
      <button class="shop-check" data-shop-done="${esc(x.id)}" aria-label="Вычеркнуть">
        ${x.done ? ic('check', 'ic-xs') : ''}</button>
      <span class="ios-row-title">${esc(x.name)}
        <span class="ord-sub">${(Number(x.qty) || 1) > 1
    ? `${fmtNum(x.qty)} × ${fmtPrice(price)} = ${fmtPrice(sum)}`
    : (price ? fmtPrice(price) : 'цена не указана')}${x.code ? ' · код ' + esc(x.code) : ''}</span></span>
      <span class="qty-step">
        <button data-shop-minus="${esc(x.id)}" aria-label="Меньше">−</button>
        <span class="shop-qty">${fmtNum(x.qty)}</span>
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
}

// отправить список близким: пусть купят по дороге
async function shareShop() {
  const list = read().filter((x) => !x.done);
  if (!list.length) { toast('Список пуст'); return; }
  const text = 'Список покупок:\n' + list.map((x) => {
    const p = state.products.find((y) => y.id === x.id);
    const price = p ? priceOf(p) : Number(x.price) || 0;
    return `— ${x.name}${(Number(x.qty) || 1) > 1 ? ` × ${fmtNum(x.qty)}` : ''}${price ? ` — ${fmtPrice(price)}` : ''}`;
  }).join('\n') + `\nИтого: ${fmtPrice(total(read()))}`;
  try {
    if (navigator.share) { await navigator.share({ text }); return; }
    await navigator.clipboard.writeText(text);
    toast('Список скопирован');
  } catch (e) { toast('Не получилось поделиться'); }
}

// подпись кнопки в карточке товара
export function syncShopButton(p) {
  const b = $('btnShopAdd');
  if (!b || !p) return;
  b.textContent = inShop(p.id) ? 'Убрать из списка покупок' : 'В список покупок';
  ui.shopFor = p.id;
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
    if (!r || e.target.closest('button')) return;   // по кнопкам жест не начинаем
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
  renderShopBar();   // список мог остаться с прошлого захода
}

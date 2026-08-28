// Сторож наценки: где магазин продаёт в минус

/* Разбор выгрузок из 1С (август 2026) показал то, чего в приложении не было
 * видно: 98 товаров лежат на складе и продаются ДЕШЕВЛЕ, чем куплены, ещё
 * 54 идут почти в ноль, а 14 вообще без розничной цены. Инжир: закупка
 * 650 ₽, цена 145 ₽. Компот 1л: 193 ₽ и 99 ₽.
 *
 * Такое не находится глазами: товаров больше десяти тысяч, и каждый по
 * отдельности выглядит нормально. Поэтому — отдельный экран, который считает
 * это сам при каждой загрузке цен.
 *
 * Считаем САМИ, из двух цен. Колонке «Процент наценки» из отчёта 1С доверять
 * нельзя: у товара с закупкой 15 ₽ и ценой 25 ₽ она пишет «−1673%».
 * Экран только для того, кто видит закупки (владелец): сотруднику зала эти
 * числа не показываются нигде и никогда. */

import { $, state } from './store.js';
import { closeSheet, esc, openSheet } from './core.js';
import { fmtPrice, isFreshPrice } from './catalog.js';
import { priceParts } from './card.js';
import { plural } from './competitors.js';

const THIN_PCT = 5;        // наценка ниже этой — «почти в ноль»
const MAX_ROWS = 200;      // длиннее список никто не прочитает

/* Лучшая СВЕЖАЯ закупочная цена за штуку — та же, по которой карточка
 * считает наценку. Старую цену без нового поступления за настоящую не
 * считаем: товар мог давно подорожать. */
function bestCost(p) {
  const rows = (state.prices || []).filter((r) => r.product_id === p.id);
  let best = null;
  for (const r of rows) {
    if (!isFreshPrice(r)) continue;      // строка целиком, дату функция берёт сама
    const q = priceParts(p, r);
    if (q && q.piece > 0 && (best == null || q.piece < best)) best = q.piece;
  }
  return best;
}

const inStock = (p) => {
  const n = Number(p.stock);
  return !Number.isFinite(n) || n > 0;    // остатка не знаем — считаем, что есть
};

export function marginIssues() {
  const loss = []; const thin = []; const noPrice = [];
  if (!state.canPurchase) return { loss, thin, noPrice };
  for (const p of state.products || []) {
    const retail = Number(p.retail_price);
    const has = p.retail_price != null && p.retail_price !== '' && Number.isFinite(retail) && retail > 0;
    const cost = bestCost(p);
    if (!has) {
      // без цены товар нельзя продать — но говорим только про то, что на полке
      if (inStock(p) && cost != null) noPrice.push({ p, cost });
      continue;
    }
    if (cost == null || !inStock(p)) continue;
    const pct = ((retail - cost) / cost) * 100;
    if (pct < 0) loss.push({ p, cost, retail, pct });
    else if (pct < THIN_PCT) thin.push({ p, cost, retail, pct });
  }
  loss.sort((a, b) => a.pct - b.pct);          // самые убыточные наверх
  thin.sort((a, b) => a.pct - b.pct);
  return { loss, thin, noPrice };
}

export function marginCount() {
  const x = marginIssues();
  return x.loss.length + x.thin.length + x.noPrice.length;
}

function row(x, kind) {
  const sub = kind === 'noPrice'
    ? `закупка ${fmtPrice(x.cost)} · розничной цены нет`
    : `закупка ${fmtPrice(x.cost)} → цена ${fmtPrice(x.retail)}`;
  const val = kind === 'noPrice' ? 'нет цены'
    : `${x.pct > 0 ? '+' : ''}${Math.round(x.pct)}%`;
  return `<button class="ios-row ios-row-link" data-margin-open="${esc(x.p.id)}">
    <span class="ios-row-title">${esc(x.p.name)}<span class="ord-sub">${esc(sub)}</span></span>
    <span class="ios-row-value ${kind === 'thin' ? '' : 'margin-bad'}">${esc(val)}</span></button>`;
}

export function openMargin() {
  const box = $('marginBody');
  if (!box) return;
  const { loss, thin, noPrice } = marginIssues();
  const total = loss.length + thin.length + noPrice.length;
  const block = (title, list, kind, note) => (list.length ? `<div class="ios-group-title">${title} · ${list.length}</div>
    <div class="ios-group">${list.slice(0, MAX_ROWS).map((x) => row(x, kind)).join('')}</div>
    ${list.length > MAX_ROWS ? `<p class="ios-note">Показаны первые ${MAX_ROWS}.</p>` : ''}
    ${note ? `<p class="ios-note">${note}</p>` : ''}` : '');
  box.innerHTML = total ? `
    <div class="ord-total">${total} ${plural(total, 'товар требует', 'товара требуют', 'товаров требуют')} внимания</div>
    ${block('Продаём дешевле закупки', loss, 'loss', 'Каждая продажа такого товара — убыток. Либо поднять цену, либо убрать с полки.')}
    ${block('Наценка меньше 5%', thin, 'thin', 'После расходов магазина это работа в ноль.')}
    ${block('Без розничной цены', noPrice, 'noPrice', 'Товар лежит на полке, а цены у него нет — кассир не сможет его пробить.')}
    <p class="ios-note">Считается по лучшей свежей цене поставщика. Товары, которых нет
    на складе, не показываем — им цену править незачем.</p>`
    : `<p class="ios-note">Всё в порядке: товаров, которые продаются дешевле закупки или почти
    в ноль, не нашлось. Список пересчитывается сам после каждой загрузки цен из 1С.</p>`;
  openSheet('marginSheet');
}

/* Счётчик в меню. Ноль пишем прочерком, а не пустотой: пустое место читается
 * как «ещё не посчитали», прочерк — как «посчитали, всё в порядке». */
export function renderMarginBadge() {
  const row = $('menuMargin');
  if (!row) return;
  row.hidden = !state.canPurchase;
  // «Залежалось» видит и сотрудник: ему решать, что убрать с полки
  const se = $('menuStaleCount');
  if (se) { const st = staleItems().length; se.textContent = st ? String(st) : '—'; }
  if (!state.canPurchase) return;
  const n = marginCount();
  const el = $('menuMarginCount');
  el.textContent = n ? String(n) : '—';
  el.classList.toggle('margin-bad', n > 0);
}

/* Обработчики модуль вешает сам: app.js уже дорос до предела, который держит
 * проверка «модули», и складывать в него ещё и это нельзя. */
export function bindMargin(openProduct) {
  $('menuMargin').addEventListener('click', () => { closeSheet('adminMenuSheet'); openMargin(); });
  $('menuStale').addEventListener('click', () => { closeSheet('adminMenuSheet'); openStale(); });
  $('staleBody').addEventListener('click', (e) => {
    const b = e.target.closest('[data-margin-open]');
    if (!b) return;
    closeSheet('staleSheet');
    const p = (state.products || []).find((x) => x.id === b.dataset.marginOpen);
    if (p) openProduct(p);
  });
  $('marginBody').addEventListener('click', (e) => {
    const b = e.target.closest('[data-margin-open]');
    if (!b) return;
    closeSheet('marginSheet');
    const p = (state.products || []).find((x) => x.id === b.dataset.marginOpen);
    if (p) openProduct(p);
  });
}

/* ── «Залежалось» ───────────────────────────────────────────────────────────
 * Товар лежит на полке, приехал давно и не продаётся. Это замороженные
 * деньги: их уже потратили, а обратно они не возвращаются. Считается из
 * отчёта «Неликвидные товары» — оттуда берутся настоящая дата последнего
 * поступления и продажи за период.
 * Видят и владелец, и сотрудник: сотруднику нужно знать, что убрать с полки.
 * Но СУММУ замороженных денег показываем только тому, кто видит закупки. */
const STALE_DAYS = 90;

export function staleItems() {
  const now = Date.now();
  const out = [];
  for (const p of state.products || []) {
    const left = Number(p.stock);
    if (!Number.isFinite(left) || left <= 0) continue;      // на полке ничего нет
    const d = String(p.arrival_at || '').slice(0, 10);
    if (!d) continue;
    const days = Math.round((now - new Date(d).getTime()) / 86400000);
    if (!(days >= STALE_DAYS)) continue;
    const sold = Number(p.sold_qty);
    if (Number.isFinite(sold) && sold > 0) continue;         // всё-таки продаётся
    out.push({ p, days, left, money: (bestCost(p) || 0) * left });
  }
  out.sort((a, b) => b.money - a.money || b.days - a.days);  // дорогое и давнее наверх
  return out;
}

export function openStale() {
  const box = $('staleBody');
  if (!box) return;
  const list = staleItems();
  const money = list.reduce((s, x) => s + x.money, 0);
  const rows = list.slice(0, MAX_ROWS).map((x) => `<button class="ios-row ios-row-link" data-margin-open="${esc(x.p.id)}">
    <span class="ios-row-title">${esc(x.p.name)}<span class="ord-sub">лежит ${x.days} ${plural(x.days, 'день', 'дня', 'дней')} · остаток ${esc(String(x.left))}</span></span>
    ${state.canPurchase && x.money ? `<span class="ios-row-value">${esc(fmtPrice(x.money))}</span>` : ''}</button>`).join('');
  box.innerHTML = list.length ? `
    <div class="ord-total">${list.length} ${plural(list.length, 'товар', 'товара', 'товаров')} лежит без движения${
  state.canPurchase && money ? ` · <b>${esc(fmtPrice(money))}</b>` : ''}</div>
    <div class="ios-group">${rows}</div>
    ${list.length > MAX_ROWS ? `<p class="ios-note">Показаны первые ${MAX_ROWS} — самые дорогие.</p>` : ''}
    <p class="ios-note">Товар есть на полке, приехал больше ${STALE_DAYS} дней назад и за это время
    не продавался ни разу. Считается по отчёту «Неликвидные товары» из 1С.</p>`
    : `<p class="ios-note">Залежавшихся товаров не нашлось. Если список пустой сразу после
    установки — загрузи из 1С отчёт «Неликвидные товары»: в нём лежат даты поступления.</p>`;
  openSheet('staleSheet');
}

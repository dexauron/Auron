// «Подорожало» — обратная сторона «Сегодня дешевле», только для своих

/* Покупателю каталог показывает, что подешевело. Владельцу и сотруднику нужно
 * ровно обратное, и по двум разным ценам:
 *   • ЗАКУПОЧНАЯ — сколько мы платим поставщику. Выросла — это прямо наши
 *     деньги, и видно, кто из поставщиков поднял и на сколько.
 *   • РОЗНИЧНАЯ — то, что на ценнике. Сотрудника у полки спрашивают «почему
 *     подорожало», и он должен знать ответ, не бегая к компьютеру.
 * Сотруднику показываем только ценник: закупка — не его дело (см. правило
 * приватности). Владельцу — обе цены рядом.
 *
 * Самое дорогое молчание, которое тут можно допустить: закупка выросла, а
 * ценник остался прежним. Товар продолжает продаваться, всё выглядит нормально,
 * а наценка тает. Такое помечаем отдельно.
 *
 * Считаем по истории цен: она наконец копится (см. svRememberPrice в
 * imports.js) и живёт месяц — старше владельцу неинтересно. Порога нет:
 * владелец просил показывать ЛЮБОЕ изменение. */

import { $, state, ui } from './store.js';
import { closeSheet, esc, openSheet, supplierById } from './core.js';
import { fmtPrice } from './catalog.js';
import { priceParts } from './card.js';
import { plural } from './competitors.js';
import { ic } from './icons.js';

const RISE_DAYS = 30;          // окно новостей — месяц, как просил владелец
const RISE_ROWS = 6;           // столько строк в полосе на главной
const LIST_MAX = 200;          // длиннее список никто не листает

const edgeISO = () => new Date(Date.now() - RISE_DAYS * 86400000).toISOString().slice(0, 10);
const pct = (was, is) => Math.round(((is - was) / was) * 1000) / 10;

/* ── Закупка ────────────────────────────────────────────────────────────────
 * Сравниваем ЗА ШТУКУ: поставщик мог перейти со штук на упаковки, тогда само
 * число в прайсе меняется, а цена — нет. Берём поставщика, у которого рост
 * больше всех: именно с ним и предстоит разговор. */
export function costRise(p) {
  if (!p) return null;
  const from = edgeISO();
  const bySup = new Map();
  for (const r of (state.prices || [])) {
    if (r.product_id !== p.id) continue;
    if (!bySup.has(r.supplier_id)) bySup.set(r.supplier_id, []);
    bySup.get(r.supplier_id).push(r);
  }
  let best = null;
  for (const [sid, rows] of bySup) {
    rows.sort((a, b) => String(b.price_date || '').localeCompare(String(a.price_date || '')));
    const now = priceParts(p, rows[0]);
    if (!now || !(now.piece > 0)) continue;
    // прежняя цена — первая, что отличается за штуку, и не старше месяца
    const prevRow = rows.slice(1).find((r) => {
      const q = priceParts(p, r);
      return q && q.piece > 0 && q.piece !== now.piece;
    });
    if (!prevRow) continue;
    const at = String(rows[0].price_date || '').slice(0, 10);
    if (!at || at < from) continue;
    const prev = priceParts(p, prevRow);
    if (prev.piece >= now.piece) continue;                 // подешевело — это не наша новость
    const item = {
      was: prev.piece, is: now.piece, at, pct: pct(prev.piece, now.piece),
      sup: (supplierById(sid) || {}).name || '',
    };
    if (!best || item.pct > best.pct) best = item;
  }
  return best;
}

/* ── Ценник ─────────────────────────────────────────────────────────────────
 * История ценника пишется при выгрузке из 1С: там даты смены цены нет, поэтому
 * датой считаем день выгрузки. Владелец выгружает каждый вечер — ошибка не
 * больше суток. */
export function retailRise(p) {
  if (!p) return null;
  const is = Number(p.retail_price);
  if (!(is > 0)) return null;
  const rows = (state.retailHist || {})[p.id] || [];
  const from = edgeISO();
  const row = rows.find((r) => Number(r.price) > 0 && Number(r.price) !== is && String(r.at || '') >= from);
  if (!row || Number(row.price) >= is) return null;
  return { was: Number(row.price), is, at: String(row.at).slice(0, 10), pct: pct(Number(row.price), is) };
}

/* ── Наценка тает ───────────────────────────────────────────────────────────
 * Закупка выросла, ценник прежний. Считаем наценку до и после — в этом вся
 * суть: «было 22%, стало 9%» понятнее, чем «закупка +14%». */
export function marginSqueeze(p) {
  const c = costRise(p);
  if (!c) return null;
  if (retailRise(p)) return null;                          // ценник тоже подняли — всё честно
  const sell = Number(p && p.retail_price);
  if (!(sell > 0) || sell <= c.is) return null;
  return { wasPct: Math.round(((sell - c.was) / c.was) * 100), isPct: Math.round(((sell - c.is) / c.is) * 100) };
}

/* Кому что видно: сотруднику — только ценник, владельцу — обе цены.
 * Это то же правило, по которому сотруднику не показывают закупку нигде. */
const seesCost = () => !!state.canPurchase;

export function riseOf(p) {
  const retail = retailRise(p);
  const cost = seesCost() ? costRise(p) : null;
  if (!retail && !cost) return null;
  const squeeze = cost ? marginSqueeze(p) : null;
  // «когда» — по самому свежему из двух событий
  const at = [retail && retail.at, cost && cost.at].filter(Boolean).sort().pop();
  return { p, retail, cost, squeeze, at, pct: Math.max(retail ? retail.pct : 0, cost ? cost.pct : 0) };
}

/* Список для экрана и для полосы. Пересчитываем при каждом открытии: каталог
 * обновляется раз в сутки, а список короткий — считать заранее незачем. */
export function risenList() {
  if (!state.session) return [];
  const out = [];
  for (const p of state.products) {
    const r = riseOf(p);
    if (r) out.push(r);
  }
  out.sort((a, b) => b.pct - a.pct);
  return out.slice(0, LIST_MAX);
}

export const riseCount = () => risenList().length;

// одна строка «было → стало, дата» — общий вид для полосы, списка и карточки
function riseText(kind, r) {
  return `${kind}: ${fmtPrice(r.was)} → ${fmtPrice(r.is)} (+${String(r.pct).replace('.', ',')}%) · ${whenText(r.at)}`;
}

/* Дата словами: «сегодня», «вчера», иначе числом. У полки человек думает
 * днями, а не датами. */
function whenText(at) {
  const d = new Date(String(at) + 'T00:00:00');
  const days = Math.round((new Date().setHours(0, 0, 0, 0) - d.getTime()) / 86400000);
  if (days <= 0) return 'сегодня';
  if (days === 1) return 'вчера';
  if (days < 7) return `${days} ${plural(days, 'день', 'дня', 'дней')} назад`;
  return d.toLocaleDateString('ru-RU', { day: 'numeric', month: 'long' });
}

/* ── Строка в карточке товара ───────────────────────────────────────────── */
export function riseHtml(p) {
  const r = riseOf(p);
  if (!r) return '';
  const lines = [];
  if (r.retail) lines.push(riseText('Ценник', r.retail));
  if (r.cost) lines.push(riseText(`Закупка${r.cost.sup ? ' · ' + r.cost.sup : ''}`, r.cost));
  if (r.squeeze) lines.push(`Ценник не меняли — наценка упала с ${r.squeeze.wasPct}% до ${r.squeeze.isPct}%`);
  return `<div class="rise-box">${ic('warn', 'ic-xs')}<div>${lines.map((t) => `<div>${esc(t)}</div>`).join('')}</div></div>`;
}

/* ── Полоса на главной ──────────────────────────────────────────────────────
 * Ровно там же, где у покупателя «Сегодня дешевле», и по тем же правилам:
 * прячется, как только человек начал искать или фильтровать — иначе она лезет
 * в глаза поверх результата. */
export function renderRiseStrip() {
  ui.renderRiseStrip = renderRiseStrip;
  const box = $('riseStrip');
  if (!box) return;
  const show = state.session && state.tab === 'catalog' && !state.query && !state.favOnly && !ui.anyFilter();
  const list = show ? risenList() : [];
  if (!list.length) { box.hidden = true; box.innerHTML = ''; return; }
  const rows = list.slice(0, RISE_ROWS).map((r) => {
    const main = r.cost || r.retail;
    return `<button class="arr-row" data-similar="${esc(r.p.id)}">
      <span class="arr-name">${esc(r.p.name)}</span>
      <span class="arr-price rise-up">+${String(main.pct).replace('.', ',')}%
        <span class="card-was">${esc(fmtPrice(main.was))}</span></span></button>`;
  }).join('');
  box.innerHTML = `<div class="arr-head">
      <span class="arr-title">Подорожало</span>
      <span class="arr-when">${list.length} ${plural(list.length, 'товар', 'товара', 'товаров')}</span>
    </div>
    <div class="arr-list">${rows}</div>`;
  box.hidden = false;
}

/* ── Отдельный экран во вкладке «Работа» ────────────────────────────────── */
function renderRisen() {
  const box = $('risenBody');
  if (!box) return;
  const list = risenList();
  if (!list.length) {
    box.innerHTML = `<p class="ios-note">За месяц цены не менялись — ни на ценнике, ни у поставщиков.
      Список заполнится сам после ближайшей выгрузки из 1С.</p>`;
    return;
  }
  const squeezed = list.filter((r) => r.squeeze).length;
  box.innerHTML = `
    <div class="ord-total">${list.length} ${plural(list.length, 'товар', 'товара', 'товаров')} подорожало за месяц${
  squeezed ? ` · у ${squeezed} ${plural(squeezed, 'него', 'них', 'них')} ценник не меняли` : ''}</div>
    <div class="ios-group">${list.map((r) => {
    const lines = [];
    if (r.retail) lines.push(riseText('Ценник', r.retail));
    if (r.cost) lines.push(riseText(`Закупка${r.cost.sup ? ' · ' + r.cost.sup : ''}`, r.cost));
    if (r.squeeze) lines.push(`наценка упала с ${r.squeeze.wasPct}% до ${r.squeeze.isPct}%`);
    const main = r.cost || r.retail;
    return `<button class="ios-row ios-row-link" data-rise-open="${esc(r.p.id)}">
        <span class="ios-row-title">${esc(r.p.name)}
          <span class="ord-sub">${esc(lines.join(' · '))}</span></span>
        <span class="ios-row-value rise-up">+${String(main.pct).replace('.', ',')}%</span>
      </button>`;
  }).join('')}</div>
    <p class="ios-note">Сверху то, что подорожало сильнее. Даты берутся из выгрузок 1С;
    история хранится месяц, потом стирается сама.</p>`;
}

export function openRisen() {
  renderRisen();
  openSheet('risenSheet');
}

export function bindPriceRise(openProduct) {
  ui.workActions = ui.workActions || {};
  ui.workActions.risen = openRisen;
  $('risenBody').addEventListener('click', (e) => {
    const b = e.target.closest('[data-rise-open]');
    if (!b) return;
    closeSheet('risenSheet');
    const p = state.products.find((x) => x.id === b.dataset.riseOpen);
    if (p) openProduct(p);
  });
}

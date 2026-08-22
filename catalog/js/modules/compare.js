// Сравнение нескольких товаров: цены поставщиков рядом, в одной таблице

/* В карточке видно поставщиков ОДНОГО товара. Но заказ собирают иначе: держат
 * в голове несколько позиций сразу и решают, у кого брать. Раньше для этого
 * приходилось открывать карточки по очереди и запоминать цифры.
 * Здесь товары, отобранные сотрудником, показаны рядом: розница, лучшая
 * закупка, у кого она, наценка и остаток. Список живёт на устройстве. */

import { $, state, ui } from './store.js';
import { closeSheet, esc, openSheet, supplierById, toast } from './core.js';
import { fmtPrice, fmtRetail } from './catalog.js';
import { priceParts } from './card.js';
import { ic } from './icons.js';

const MAX = 8;   // больше восьми колонок на телефоне всё равно не читается

function compareIds() { return ui.compareIds || (ui.compareIds = []); }
export const inCompare = (id) => compareIds().includes(id);
export const compareCount = () => compareIds().length;

export function toggleCompare(id) {
  const list = compareIds();
  const i = list.indexOf(id);
  if (i >= 0) list.splice(i, 1);
  else if (list.length >= MAX) { toast(`Больше ${MAX} товаров сразу не сравнить`); return false; }
  else list.push(id);
  renderCompareBar();
  return true;
}

export function clearCompare() {
  ui.compareIds = [];
  renderCompareBar();
  closeSheet('compareSheet');
}

// Полоска внизу главного экрана: сколько товаров отобрано и кнопка сравнить.
export function renderCompareBar() {
  const bar = $('compareBar');
  if (!bar) return;
  const n = compareIds().length;
  bar.hidden = !(n > 0 && state.canPurchase);
  if (n) $('compareCount').textContent = n;
}

// лучшая (самая низкая) цена за штуку среди поставщиков товара
function bestOffer(p) {
  const rows = (state.prices || []).filter((r) => r.product_id === p.id);
  let best = null;
  for (const r of rows) {
    const parts = priceParts(p, r);
    if (!parts) continue;
    if (!best || parts.piece < best.piece) best = { piece: parts.piece, supplier_id: r.supplier_id, date: r.price_date };
  }
  return best;
}

export function openCompare() {
  const list = compareIds().map((id) => state.products.find((p) => p.id === id)).filter(Boolean);
  const box = $('compareBody');
  if (!list.length) { box.innerHTML = '<p class="ios-note">Ничего не отобрано. Открой товар и нажми «К сравнению».</p>'; openSheet('compareSheet'); return; }

  const rows = list.map((p) => {
    const best = bestOffer(p);
    const sup = best ? (supplierById(best.supplier_id) || {}).name || '—' : '—';
    const retail = (p.retail_price != null && p.retail_price !== '') ? Number(p.retail_price) : null;
    // наценка: сколько магазин зарабатывает сверху закупки
    const markup = (best && retail) ? Math.round(((retail - best.piece) / best.piece) * 100) : null;
    const stock = p.stock != null ? Number(p.stock) : null;
    return { p, best, sup, retail, markup, stock };
  });
  // самая выгодная закупка среди отобранных — подсветим
  const minPiece = Math.min(...rows.filter((r) => r.best).map((r) => r.best.piece), Infinity);

  box.innerHTML = `<div class="cmp-wrap"><table class="cmp">
    <thead><tr><th>Товар</th><th>Закупка</th><th>У кого</th><th>Розница</th><th>Наценка</th><th>Остаток</th><th></th></tr></thead>
    <tbody>${rows.map((r) => `<tr>
      <td class="cmp-name">${esc(r.p.name)}${r.p.code ? `<span class="cmp-code">${esc(r.p.code)}</span>` : ''}</td>
      <td class="cmp-num${r.best && r.best.piece === minPiece ? ' cmp-best' : ''}">${r.best ? fmtPrice(r.best.piece) : '—'}</td>
      <td>${esc(r.sup)}</td>
      <td class="cmp-num">${r.retail != null ? esc(fmtRetail(r.p)) : '—'}</td>
      <td class="cmp-num">${r.markup != null ? r.markup + '%' : '—'}</td>
      <td class="cmp-num">${r.stock != null ? r.stock : '—'}</td>
      <td><button class="cmp-rm" data-cmp-rm="${esc(r.p.id)}" aria-label="Убрать">${ic('close', 'ic-xs')}</button></td>
    </tr>`).join('')}</tbody></table></div>
    <p class="ios-note">Закупка — за штуку, приведена к одной единице: цена за упаковку поделена на количество в ней. Зелёным — самая выгодная из отобранных.</p>`;
  openSheet('compareSheet');
}

export function removeFromCompare(id) {
  const list = compareIds();
  const i = list.indexOf(id);
  if (i >= 0) list.splice(i, 1);
  renderCompareBar();
  openCompare();
}

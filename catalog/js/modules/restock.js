// «Закончилось на полке» — список того, что надо пополнить

/* Сотрудник зала видит пустую полку раньше всех, но записать это было некуда:
 * запоминали в голове или на бумажке, до заказа доживало не всё. Здесь он
 * отмечает товар одним касанием (или сканирует штрихкод подряд, обходя зал),
 * а список сам раскладывается по поставщикам — из него сразу оформляется заказ.
 *
 * Где живёт список. Сервера нет, писать в общий каталог может только владелец,
 * поэтому список лежит на телефоне сотрудника и одной кнопкой уходит владельцу
 * текстом. Так же, как заказы: инструмент есть у всех, записи не теряются. */

import { $, state, ui } from './store.js';
import { closeSheet, esc, openSheet, supplierById, toast } from './core.js';
import { fmtDate, todayISO } from './catalog.js';
import { deviceName } from './device.js';
import { plural } from './competitors.js';
import { ic } from './icons.js';
import { openOrderForm } from './orders.js';
import { findByBarcode } from './scanner.js';

const KEY = 'wm_restock_v1';
const MAX = 300;          // столько строк уже не список, а склад — дальше не копим
const KEEP_ORDERED_DAYS = 14;  // заказанное держим две недели и убираем само

function read() {
  try { return JSON.parse(localStorage.getItem(KEY)) || []; } catch (e) { return []; }
}
function write(list) {
  try { localStorage.setItem(KEY, JSON.stringify(list.slice(-MAX))); } catch (e) { /* нет места */ }
}

/* Список сам подчищается: заказанное старше двух недель уже не нужно —
 * иначе за полгода экран превращается в простыню, а телефон копит мусор. */
function tidy(list) {
  const edge = new Date(Date.now() - KEEP_ORDERED_DAYS * 86400000).toISOString().slice(0, 10);
  return list.filter((x) => !(x.ordered && String(x.ordered).slice(0, 10) < edge));
}

function restockList() {
  const list = tidy(read());
  return list;
}
export const restockCount = () => restockList().filter((x) => !x.ordered).length;
export const inRestock = (id) => restockList().some((x) => x.id === id);

/* Отметить/снять отметку. Название и код запоминаем прямо в строке: товар
 * могут удалить из каталога, а список пополнения от этого рассыпаться не должен. */
export function toggleRestock(p) {
  if (!p) return false;
  const list = restockList();
  const i = list.findIndex((x) => x.id === p.id);
  if (i >= 0) { list.splice(i, 1); write(list); renderRestockBadge(); return false; }
  const sup = (p.supplier_ids || [])[0] || '';
  list.push({
    id: p.id,
    name: p.name || '',
    code: p.code || '',
    supplier_id: sup,
    supplier_name: (supplierById(sup) || {}).name || '',
    who: deviceName(),
    at: todayISO(),
  });
  write(list);
  renderRestockBadge();
  return true;
}

export function removeRestock(id) {
  write(restockList().filter((x) => x.id !== id));
  renderRestockBadge();
  renderRestock();
}

export function clearRestock() {
  if (!restockList().length) return;
  if (!confirm('Очистить весь список пополнения?')) return;
  write([]);
  renderRestockBadge();
  renderRestock();
}

// Счётчик в меню: сколько позиций ждёт заказа, видно не открывая список
export function renderRestockBadge() {
  const el = $('menuRestockCount');
  if (!el) { if (ui.renderWorkBadge) ui.renderWorkBadge(); return; }
  const n = restockCount();
  el.textContent = n ? String(n) : '';
  if (ui.renderWorkBadge) ui.renderWorkBadge();
}

export function openRestock() {
  renderRestock();
  openSheet('restockSheet');
}

function groupBySupplier(list) {
  const map = new Map();
  for (const x of list) {
    const key = x.supplier_id || '';
    const name = (supplierById(x.supplier_id) || {}).name || x.supplier_name || 'Без поставщика';
    if (!map.has(key)) map.set(key, { id: key, name, items: [] });
    map.get(key).items.push(x);
  }
  return [...map.values()].sort((a, b) => a.name.localeCompare(b.name, 'ru'));
}

function renderRestock() {
  const box = $('restockBody');
  if (!box) return;
  const list = restockList();
  write(list);            // заодно сохраняем подчищенный список
  if (!list.length) {
    box.innerHTML = `<p class="ios-note">Список пуст. Открой товар и нажми «Закончилось на полке»
      — или включи в сканере режим «Закончилось» и обойди зал с камерой.</p>`;
    return;
  }
  const waiting = list.filter((x) => !x.ordered).length;
  box.innerHTML = `
    <div class="ord-total">${waiting} ${plural(waiting, 'позиция ждёт', 'позиции ждут', 'позиций ждут')} заказа</div>
    ${groupBySupplier(list).map((g) => {
    const wait = g.items.filter((x) => !x.ordered).length;
    return `<div class="ios-group-title rst-head">
        <span>${esc(g.name)} · ${g.items.length}</span>
        ${g.id && wait ? `<button class="rst-order" data-rst-order="${esc(g.id)}">Заказать</button>` : ''}
      </div>
      <div class="ios-group">${g.items.map(rowHtml).join('')}</div>`;
  }).join('')}
    <p class="ios-note">Список лежит на этом телефоне. Кнопка «Передать» отправит его владельцу
    текстом. Заказанное пропадёт из списка само через две недели.</p>`;
}

function rowHtml(x) {
  const mark = x.ordered ? '<span class="ord-done">заказано</span>' : '';
  const sub = [x.code ? 'код ' + esc(x.code) : '', x.who ? esc(x.who) : '', fmtDate(x.at)]
    .filter(Boolean).join(' · ');
  return `<div class="ios-row${x.ordered ? ' rst-done' : ''}">
    <span class="ios-row-title">${esc(x.name)} ${mark}<span class="ord-sub">${sub}</span></span>
    <button class="rst-rm" data-rst-rm="${esc(x.id)}" aria-label="Убрать из списка">${ic('close', 'ic-xs')}</button>
  </div>`;
}

/* Из списка — сразу в заказ. Поставщик подставлен, в примечание уходит, что
 * именно закончилось: иначе сотрудник переписывал бы названия руками. */
export function orderFromRestock(supplierId) {
  const items = restockList().filter((x) => (x.supplier_id || '') === supplierId && !x.ordered);
  if (!items.length) return;
  closeSheet('restockSheet');
  // Позициями, а не строчкой в примечании: в заказе их видно списком, можно
  // проставить количество и убрать лишнее.
  // onSaved: заказ сохранён — эти позиции больше не ждут. Передаём действием,
  // а не импортом, иначе заказы и список пополнения ссылались бы друг на друга.
  openOrderForm(null, null, {
    supplier_id: supplierId,
    items: items.map((x) => ({ name: x.name, code: x.code || '', qty: 0 })),
    onSaved: () => markRestockOrdered(supplierId),
  });
}

/* Отметить позиции поставщика как заказанные — вызывается после сохранения
 * заказа. Строки остаются видимыми (серым), чтобы было понятно, что уже сделано. */
function markRestockOrdered(supplierId) {
  const list = restockList();
  let n = 0;
  for (const x of list) {
    if ((x.supplier_id || '') === supplierId && !x.ordered) { x.ordered = todayISO(); n++; }
  }
  if (!n) return;
  write(list);
  renderRestockBadge();
  renderRestock();
}

// Передать владельцу: сотрудник не может писать в общий каталог
export async function shareRestock() {
  const list = restockList().filter((x) => !x.ordered);
  if (!list.length) { toast('Список пополнения пуст'); return; }
  const text = 'Закончилось на полке:\n' + groupBySupplier(list)
    .map((g) => `${g.name}:\n` + g.items.map((x) => `— ${x.name}${x.code ? ' (код ' + x.code + ')' : ''}`).join('\n'))
    .join('\n');
  try {
    if (navigator.share) { await navigator.share({ text }); return; }
    await navigator.clipboard.writeText(text);
    toast('Список скопирован — отправь владельцу');
  } catch (e) { toast('Не получилось поделиться'); }
}

/* Сканер, режим «Закончилось»: обходишь зал, наводишь камеру на пустую полку —
 * товар попадает в список, камера не закрывается. */
export function scanToRestock(text) {
  const box = $('scanResult');
  if (!box) return;
  // весовую этикетку тоже понимаем: сотрудник наводит камеру на пустую полку,
  // а на упаковке от весов обычного штрихкода нет
  const found = findByBarcode(text);
  const p = found && found.p;
  box.hidden = false;
  if (!p) {
    box.innerHTML = `<div class="scan-result-miss">Нет в каталоге</div>
      <div class="scan-result-code">${esc(text)}</div>`;
    return;
  }
  const added = inRestock(p.id) ? false : toggleRestock(p);
  box.innerHTML = `<div class="scan-result-name">${esc(p.name)}</div>
    <div class="scan-result-price">${added ? 'в списке пополнения' : 'уже в списке'}</div>
    <div class="scan-result-code">всего в списке: ${restockCount()}</div>`;
}

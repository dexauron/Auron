// Заказы поставщикам: кто, у кого, на сколько и когда придёт

/* Заказ оформляет сотрудник зала прямо в каталоге, а видеть нужно всем и по
 * дням: в какой день сколько поставок и на какую сумму. Отсюда две части —
 * список заказов и неделя-календарь с суммами по дням.
 *
 * Где живут заказы. Сервера нет, писать в общий каталог может только владелец
 * (ключ публикации у него). Поэтому:
 *   • у владельца заказ уходит в каталог и виден всем после публикации;
 *   • у сотрудника заказ лежит на его телефоне с пометкой «не отправлен» и
 *     одной кнопкой передаётся владельцу текстом (WhatsApp, сообщение).
 * Так сотрудник не остаётся без инструмента, а записи не теряются. */

import { $, state } from './store.js';
import { closeSheet, esc, openSheet, supplierById, toast } from './core.js';
import { fmtDate, fmtPrice, todayISO } from './catalog.js';
import { deviceName } from './device.js';
import { plural } from './competitors.js';
import { svSaveAndPublish, svUuid } from './imports.js';

const LOCAL_KEY = 'wm_orders_local_v1';   // заказы сотрудника, ещё не у владельца
const DAYS = ['Пн', 'Вт', 'Ср', 'Чт', 'Пт', 'Сб', 'Вс'];

let weekStart = null;      // понедельник показываемой недели (ISO)
let editingId = null;

function localOrders() {
  try { return JSON.parse(localStorage.getItem(LOCAL_KEY)) || []; } catch (e) { return []; }
}
function saveLocal(list) {
  try { localStorage.setItem(LOCAL_KEY, JSON.stringify(list)); } catch (e) { /* нет места */ }
}
function allOrders() {
  const mine = localOrders().map((o) => ({ ...o, local: true }));
  return [...(state.orders || []), ...mine];
}

const iso = (d) => new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 10);
function mondayOf(dateISO) {
  const d = new Date(dateISO + 'T00:00:00');
  d.setDate(d.getDate() - ((d.getDay() + 6) % 7));   // воскресенье = 6, а не 0
  return iso(d);
}
function addDays(dateISO, n) {
  const d = new Date(dateISO + 'T00:00:00');
  d.setDate(d.getDate() + n);
  return iso(d);
}
const weekDays = (start) => Array.from({ length: 7 }, (_, i) => addDays(start, i));

export function openOrders() {
  if (!weekStart) weekStart = mondayOf(todayISO());
  renderOrders();
  openSheet('ordersSheet');
}

function renderOrders() {
  const box = $('ordersBody');
  if (!box) return;
  const days = weekDays(weekStart);
  const list = allOrders().filter((o) => o.status !== 'cancelled');
  const byDay = {};
  for (const o of list) {
    const d = String(o.due_at || '').slice(0, 10);
    (byDay[d] = byDay[d] || []).push(o);
  }
  const weekList = days.flatMap((d) => byDay[d] || []);
  const weekSum = weekList.reduce((s, o) => s + (Number(o.amount) || 0), 0);
  const maxDay = Math.max(1, ...days.map((d) => (byDay[d] || []).reduce((s, o) => s + (Number(o.amount) || 0), 0)));

  // Столбик = сумма поставок за день: видно, какой день перегружен, а какой
  // пустой, ещё до того как прочитаешь хоть одну цифру.
  const calendar = days.map((d, i) => {
    const dayList = byDay[d] || [];
    const sum = dayList.reduce((s, o) => s + (Number(o.amount) || 0), 0);
    const h = sum ? Math.max(6, Math.round((sum / maxDay) * 46)) : 0;
    return `<button class="ord-day${d === todayISO() ? ' is-today' : ''}${dayList.length ? ' has' : ''}" data-ord-day="${d}">
      <span class="ord-bar" style="height:${h}px"></span>
      <span class="ord-dow">${DAYS[i]}</span>
      <span class="ord-date">${d.slice(8, 10)}</span>
      <span class="ord-sum">${dayList.length ? fmtPrice(sum) : '—'}</span>
    </button>`;
  }).join('');

  const rows = weekList
    .sort((a, b) => String(a.due_at).localeCompare(String(b.due_at)))
    .map(orderRow).join('')
    || '<div class="ios-row"><span class="ios-row-title muted">На этой неделе поставок нет</span></div>';

  box.innerHTML = `
    <div class="ord-week">
      <button class="ios-nav-btn" data-ord-week="-1">‹ Неделя</button>
      <span class="ord-week-label">${fmtDate(weekStart)} — ${fmtDate(addDays(weekStart, 6))}</span>
      <button class="ios-nav-btn" data-ord-week="1">Неделя ›</button>
    </div>
    <div class="ord-cal">${calendar}</div>
    <div class="ord-total">${weekList.length} ${plural(weekList.length, 'поставка', 'поставки', 'поставок')} · на сумму <b>${fmtPrice(weekSum)}</b></div>
    <div class="ios-group">${rows}</div>`;
}

function orderRow(o) {
  const sup = o.supplier_name || (supplierById(o.supplier_id) || {}).name || 'Поставщик';
  const mark = o.local ? '<span class="ord-flag">не отправлен</span>' : '';
  const done = o.status === 'received' ? '<span class="ord-done">пришёл</span>' : '';
  return `<button class="ios-row ios-row-link" data-ord-open="${esc(o.id)}">
    <span class="ios-row-title">${esc(sup)} ${mark}${done}
      <span class="ord-sub">${fmtDate(o.due_at)} · заказал ${esc(o.who || '—')} · от ${fmtDate(o.placed_at)}</span></span>
    <span class="ios-row-value">${fmtPrice(Number(o.amount) || 0)}</span>
  </button>`;
}

export function openOrderForm(id, dayISO) {
  editingId = id || null;
  const o = id ? allOrders().find((x) => x.id === id) : null;
  const sel = $('ordSupplier');
  sel.innerHTML = '<option value="">— выбери поставщика —</option>'
    + state.suppliers.map((s) => `<option value="${esc(s.id)}">${esc(s.name)}</option>`).join('');
  sel.value = o ? (o.supplier_id || '') : '';
  $('ordPlaced').value = o ? String(o.placed_at || '').slice(0, 10) : todayISO();
  // тап по дню недели — сразу заказ на этот день, без лишней возни
  $('ordDue').value = o ? String(o.due_at || '').slice(0, 10) : (dayISO || addDays(todayISO(), 3));
  $('ordAmount').value = o ? (o.amount ?? '') : '';
  $('ordWho').value = o ? (o.who || '') : deviceName();
  $('ordNote').value = o ? (o.note || '') : '';
  $('ordError').hidden = true;
  $('ordDelete').hidden = !o;
  $('ordReceived').hidden = !o || o.status === 'received';
  $('ordFormTitle').textContent = o ? 'Заказ' : 'Новый заказ';
  openSheet('orderFormSheet');
}

function readForm() {
  const supplier_id = $('ordSupplier').value;
  return {
    supplier_id,
    supplier_name: (supplierById(supplier_id) || {}).name || '',
    placed_at: $('ordPlaced').value || todayISO(),
    due_at: $('ordDue').value || '',
    amount: Number(String($('ordAmount').value).replace(',', '.')) || 0,
    who: $('ordWho').value.trim() || deviceName(),
    note: $('ordNote').value.trim(),
  };
}

/* Показать неделю, в которую попал заказ. Без этого сохранённый заказ на
 * следующий понедельник просто исчезал: человек жал «Сохранить» и не видел
 * никакого результата. */
function showWeekOf(dateISO) {
  if (dateISO) weekStart = mondayOf(String(dateISO).slice(0, 10));
  renderOrders();
}

export async function saveOrder() {
  const data = readForm();
  const err = $('ordError');
  if (!data.supplier_id) { err.textContent = 'Выбери поставщика.'; err.hidden = false; return; }
  if (!data.due_at) { err.textContent = 'Укажи, когда заказ должен прийти.'; err.hidden = false; return; }
  if (!(data.amount > 0)) { err.textContent = 'Укажи сумму заказа.'; err.hidden = false; return; }

  if (state.isAdmin) {
    state.orders = state.orders || [];
    const found = state.orders.find((x) => x.id === editingId);
    if (found) Object.assign(found, data);
    else state.orders.push({ id: svUuid(), status: 'ordered', ...data });
    closeSheet('orderFormSheet');
    showWeekOf(data.due_at);
    await svSaveAndPublish('Заказ сохранён');
    return;
  }
  const list = localOrders();
  const found = list.find((x) => x.id === editingId);
  if (found) Object.assign(found, data);
  else list.push({ id: svUuid(), status: 'ordered', ...data });
  saveLocal(list);
  closeSheet('orderFormSheet');
  showWeekOf(data.due_at);
  toast('Заказ записан на этом телефоне');
}

export async function markReceived() {
  const id = editingId;
  if (!id) return;
  const own = (state.orders || []).find((x) => x.id === id);
  if (own && state.isAdmin) {
    own.status = 'received';
    closeSheet('orderFormSheet');
    renderOrders();
    await svSaveAndPublish('Заказ отмечен как пришедший');
    return;
  }
  const list = localOrders();
  const mine = list.find((x) => x.id === id);
  if (mine) { mine.status = 'received'; saveLocal(list); }
  closeSheet('orderFormSheet');
  renderOrders();
}

export async function deleteOrder() {
  if (!editingId) return;
  if (!confirm('Удалить этот заказ?')) return;
  const id = editingId;
  if (state.isAdmin && (state.orders || []).some((x) => x.id === id)) {
    state.orders = state.orders.filter((x) => x.id !== id);
    closeSheet('orderFormSheet');
    renderOrders();
    await svSaveAndPublish('Заказ удалён');
    return;
  }
  saveLocal(localOrders().filter((x) => x.id !== id));
  closeSheet('orderFormSheet');
  renderOrders();
}

/* Передать владельцу: сотрудник не может писать в общий каталог, поэтому свои
 * заказы отдаёт готовым текстом — отправить в мессенджер или скопировать. */
export async function shareOrders() {
  const mine = localOrders().filter((o) => o.status !== 'cancelled');
  if (!mine.length) { toast('Своих заказов пока нет'); return; }
  const text = 'Заказы поставщикам:\n' + mine.map((o) => {
    const sup = o.supplier_name || (supplierById(o.supplier_id) || {}).name || 'поставщик';
    return `${sup} · ${fmtPrice(Number(o.amount) || 0)} · заказал ${o.who || '—'} ${fmtDate(o.placed_at)} · придёт ${fmtDate(o.due_at)}${o.note ? ' · ' + o.note : ''}`;
  }).join('\n');
  try {
    if (navigator.share) { await navigator.share({ text }); return; }
    await navigator.clipboard.writeText(text);
    toast('Список заказов скопирован — отправь владельцу');
  } catch (e) { toast('Не получилось поделиться'); }
}

export function shiftWeek(n) {
  weekStart = addDays(weekStart || mondayOf(todayISO()), n * 7);
  renderOrders();
}

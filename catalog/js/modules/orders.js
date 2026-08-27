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
import { ic } from './icons.js';
import { fmtDate, fmtPrice, todayISO } from './catalog.js';
import { deviceName } from './device.js';
import { plural } from './competitors.js';
import { svSaveAndPublish, svUuid } from './imports.js';

const LOCAL_KEY = 'wm_orders_local_v1';   // заказы сотрудника, ещё не у владельца
const DAYS = ['Пн', 'Вт', 'Ср', 'Чт', 'Пт', 'Сб', 'Вс'];

const MODE_KEY = 'wm_ord_mode';   // «неделя» или «месяц» — как человек привык
let weekStart = null;      // понедельник показываемой недели (ISO)
let editingId = null;
let formItems = [];        // позиции текущего заказа: что именно заказали
let onSaved = null;        // что сделать после сохранения (например, пометить
                           // заказанным то, что закончилось на полке)

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
const monthOf = (dateISO) => String(dateISO).slice(0, 7);
const MONTHS = ['январь', 'февраль', 'март', 'апрель', 'май', 'июнь', 'июль',
  'август', 'сентябрь', 'октябрь', 'ноябрь', 'декабрь'];
function monthLabel(ym) {
  const [y, m] = ym.split('-').map(Number);
  return `${MONTHS[m - 1]} ${y}`;
}
// все дни месяца, начиная с понедельника той недели, в которую попало 1-е число
function monthGrid(ym) {
  const [y, m] = ym.split('-').map(Number);
  const first = `${ym}-01`;
  const days = new Date(y, m, 0).getDate();
  const start = mondayOf(first);
  const cells = [];
  for (let d = start; ; d = addDays(d, 1)) {
    cells.push(d);
    if (cells.length >= 42) break;
    if (d >= `${ym}-${String(days).padStart(2, '0')}` && new Date(d + 'T00:00:00').getDay() === 0) break;
  }
  return cells;
}

const mode = () => { try { return localStorage.getItem(MODE_KEY) === 'month' ? 'month' : 'week'; } catch (e) { return 'week'; } };
export function setOrdersMode(m) {
  try { localStorage.setItem(MODE_KEY, m); } catch (e) { /* приватный режим */ }
  renderOrders();
}
export function ordersToday() {
  weekStart = mondayOf(todayISO());
  renderOrders();
}

/* Просроченные поставки: день прихода прошёл, а «пришёл» никто не отметил.
 * Их показываем отдельно и всегда — иначе заказ, потерявшийся на прошлой
 * неделе, никто больше не увидит. */
function overdueOrders() {
  const today = todayISO();
  return allOrders().filter((o) => o.status !== 'cancelled' && o.status !== 'received'
    && String(o.due_at || '').slice(0, 10) < today);
}

// Поставки, которые должны прийти в этот день (и на какую сумму)
export function ordersDue(dateISO) {
  const list = allOrders().filter((o) => o.status !== 'cancelled' && o.status !== 'received'
    && String(o.due_at || '').slice(0, 10) === dateISO);
  return { count: list.length, sum: list.reduce((s, o) => s + (Number(o.amount) || 0), 0) };
}

/* Короткая сводка для экрана «Работа»: сколько поставок на этой неделе, на
 * какую сумму и сколько просрочено. */
export function ordersSummary() {
  const days = weekDays(mondayOf(todayISO()));
  const list = allOrders().filter((o) => o.status !== 'cancelled' && days.includes(String(o.due_at || '').slice(0, 10)));
  return {
    week: list.length,
    sum: list.reduce((s, o) => s + (Number(o.amount) || 0), 0),
    overdue: overdueOrders().length,
  };
}

export function openOrders() {
  if (!weekStart) weekStart = mondayOf(todayISO());
  renderOrders();
  openSheet('ordersSheet');
}

function renderOrders() {
  const box = $('ordersBody');
  if (!box) return;
  /* Просроченное показываем отдельным блоком, но только то, чего не видно в
   * самом календаре: иначе заказ этой недели попадал бы в список дважды.
   * В режиме месяца отдельных строк нет вовсе — там показываем всё. */
  const days = weekDays(weekStart);
  const late = overdueOrders().filter((o) => mode() === 'month'
    || !days.includes(String(o.due_at || '').slice(0, 10)));
  const lateBlock = late.length
    ? `<div class="ios-group-title ord-late-head">Просрочено · ${late.length}</div>
       <div class="ios-group">${late.sort((a, b) => String(a.due_at).localeCompare(String(b.due_at))).map(orderRow).join('')}</div>`
    : '';
  const head = `<div class="seg ord-seg" id="ordModeSeg">
      <button data-ord-mode="week"${mode() === 'week' ? ' class="active"' : ''}>Неделя</button>
      <button data-ord-mode="month"${mode() === 'month' ? ' class="active"' : ''}>Месяц</button>
    </div>`;
  box.innerHTML = head + (mode() === 'month' ? renderMonth() : renderWeek()) + lateBlock;
}

/* Неделя: столбик = сумма поставок за день. Видно, какой день перегружен, а
 * какой пустой, ещё до того как прочитаешь хоть одну цифру. */
function renderWeek() {
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

  return `<div class="ord-week">
      <button class="ios-nav-btn" data-ord-week="-1">‹ Неделя</button>
      <button class="ord-today" data-ord-today="1">Сегодня</button>
      <button class="ios-nav-btn" data-ord-week="1">Неделя ›</button>
    </div>
    <div class="ord-week-label">${fmtDate(weekStart)} — ${fmtDate(addDays(weekStart, 6))}</div>
    <div class="ord-cal">${calendar}</div>
    <div class="ord-total">${weekList.length} ${plural(weekList.length, 'поставка', 'поставки', 'поставок')} · на сумму <b>${fmtPrice(weekSum)}</b></div>
    <div class="ios-group">${rows}</div>`;
}

/* Месяц: вся картина сразу — в какие дни поставки и на сколько. Тап по дню
 * переводит на его неделю, где день расписан по заказам. */
function renderMonth() {
  const ym = monthOf(weekStart || todayISO());
  const byDay = {};
  for (const o of allOrders()) {
    if (o.status === 'cancelled') continue;
    const d = String(o.due_at || '').slice(0, 10);
    (byDay[d] = byDay[d] || []).push(o);
  }
  const cells = monthGrid(ym).map((d) => {
    const list = byDay[d] || [];
    const sum = list.reduce((s, o) => s + (Number(o.amount) || 0), 0);
    const out = monthOf(d) !== ym;
    return `<button class="ord-cell${out ? ' out' : ''}${d === todayISO() ? ' is-today' : ''}${list.length ? ' has' : ''}" data-ord-month-day="${d}">
      <span class="ord-cell-date">${d.slice(8, 10)}</span>
      <span class="ord-cell-sum">${list.length ? fmtPrice(sum) : ''}</span>
    </button>`;
  }).join('');
  const monthList = Object.entries(byDay).filter(([d]) => monthOf(d) === ym).flatMap(([, v]) => v);
  const sum = monthList.reduce((s, o) => s + (Number(o.amount) || 0), 0);

  return `<div class="ord-week">
      <button class="ios-nav-btn" data-ord-month="-1">‹ Месяц</button>
      <button class="ord-today" data-ord-today="1">Сегодня</button>
      <button class="ios-nav-btn" data-ord-month="1">Месяц ›</button>
    </div>
    <div class="ord-week-label">${monthLabel(ym)}</div>
    <div class="ord-grid-dow">${DAYS.map((d) => `<span>${d}</span>`).join('')}</div>
    <div class="ord-grid">${cells}</div>
    <div class="ord-total">${monthList.length} ${plural(monthList.length, 'поставка', 'поставки', 'поставок')} за месяц · на сумму <b>${fmtPrice(sum)}</b></div>
    <p class="ios-note">Тап по дню — покажу его неделю с заказами.</p>`;
}

function orderRow(o) {
  const sup = o.supplier_name || (supplierById(o.supplier_id) || {}).name || 'Поставщик';
  const mark = o.local ? '<span class="ord-flag">не отправлен</span>' : '';
  const done = o.status === 'received' ? '<span class="ord-done">пришёл</span>' : '';
  const late = (o.status !== 'received' && String(o.due_at || '').slice(0, 10) < todayISO())
    ? '<span class="ord-late">просрочен</span>' : '';
  return `<button class="ios-row ios-row-link" data-ord-open="${esc(o.id)}">
    <span class="ios-row-title">${esc(sup)} ${mark}${done}${late}
      <span class="ord-sub">${fmtDate(o.due_at)} · заказал ${esc(o.who || '—')} · от ${fmtDate(o.placed_at)}${
  (o.items || []).length ? ` · ${o.items.length} ${plural(o.items.length, 'позиция', 'позиции', 'позиций')}` : ''}</span></span>
    <span class="ios-row-value">${fmtPrice(Number(o.amount) || 0)}</span>
  </button>`;
}

/* ── Что заказали ────────────────────────────────────────────────────────
 * Раньше в заказе была только сумма — при приёмке сверять было не с чем.
 * Позиции необязательны: заказ по телефону «как обычно» так и остаётся одной
 * суммой, а если позиции записали — они видны и в списке, и в сообщении
 * владельцу. Товар ищем по коду, штрихкоду и названию; чего нет в каталоге,
 * записываем как есть (заказывают и то, чего в базе ещё нет). */
function renderOrderItems() {
  const box = $('ordItems');
  if (!box) return;
  box.hidden = !formItems.length;
  box.innerHTML = formItems.map((it, i) => `<div class="ios-row">
    <span class="ios-row-title">${esc(it.name)}${it.code ? `<span class="ord-sub">код ${esc(it.code)}</span>` : ''}</span>
    <span class="ios-row-value">${it.qty ? '× ' + esc(String(it.qty)) : ''}</span>
    <button class="rst-rm" data-ord-item-rm="${i}" aria-label="Убрать позицию">${ic('close', 'ic-xs')}</button>
  </div>`).join('');
}

export function addOrderItem() {
  const nameEl = $('ordItemName'); const qtyEl = $('ordItemQty');
  const raw = String(nameEl.value || '').trim();
  if (!raw) return;
  const low = raw.toLowerCase();
  const p = state.products.find((x) => String(x.code || '').trim() === raw)
    || state.products.find((x) => (x.barcodes || []).some((b) => String(b).trim() === raw))
    || state.products.find((x) => String(x.name || '').toLowerCase() === low);
  formItems.push({
    name: p ? p.name : raw,
    code: p ? (p.code || '') : '',
    qty: Number(String(qtyEl.value).replace(',', '.')) || 0,
  });
  nameEl.value = ''; qtyEl.value = '';
  renderOrderItems();
}

export function removeOrderItem(i) {
  formItems.splice(Number(i), 1);
  renderOrderItems();
}

/* prefill — заказ, начатый из списка «закончилось на полке»: поставщик уже
 * выбран, в примечании перечислено, что закончилось. После сохранения такие
 * позиции помечаются заказанными, чтобы их не заказали второй раз. */
export function openOrderForm(id, dayISO, prefill) {
  editingId = id || null;
  onSaved = (prefill && prefill.onSaved) || null;
  const o = id ? allOrders().find((x) => x.id === id) : null;
  formItems = (o ? (o.items || []) : ((prefill && prefill.items) || [])).map((x) => ({ ...x }));
  const sel = $('ordSupplier');
  sel.innerHTML = '<option value="">— выбери поставщика —</option>'
    + state.suppliers.map((s) => `<option value="${esc(s.id)}">${esc(s.name)}</option>`).join('');
  sel.value = o ? (o.supplier_id || '') : ((prefill && prefill.supplier_id) || '');
  $('ordPlaced').value = o ? String(o.placed_at || '').slice(0, 10) : todayISO();
  // тап по дню недели — сразу заказ на этот день, без лишней возни
  $('ordDue').value = o ? String(o.due_at || '').slice(0, 10) : (dayISO || addDays(todayISO(), 3));
  $('ordAmount').value = o ? (o.amount ?? '') : '';
  $('ordWho').value = o ? (o.who || '') : deviceName();
  $('ordNote').value = o ? (o.note || '') : ((prefill && prefill.note) || '');
  renderOrderItems();
  $('ordItemName').value = ''; $('ordItemQty').value = '';
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
    items: formItems.map((x) => ({ ...x })),
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
    afterSaved();
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
  afterSaved();
  toast('Заказ записан на этом телефоне');
}

/* Заказ оформлен — сообщаем тому, кто его начал (список «закончилось на полке»
 * помечает свои позиции заказанными). Обратный вызов вместо импорта: иначе два
 * модуля ссылались бы друг на друга по кругу. */
function afterSaved() {
  const fn = onSaved;
  onSaved = null;
  if (fn) { try { fn(); } catch (e) { /* заказ уже сохранён — это не должно мешать */ } }
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
    const items = (o.items || []).length
      ? '\n   ' + o.items.map((x) => `${x.name}${x.qty ? ' × ' + x.qty : ''}`).join(', ') : '';
    return `${sup} · ${fmtPrice(Number(o.amount) || 0)} · заказал ${o.who || '—'} ${fmtDate(o.placed_at)} · придёт ${fmtDate(o.due_at)}${o.note ? ' · ' + o.note : ''}${items}`;
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

export function shiftMonth(n) {
  const ym = monthOf(weekStart || todayISO());
  const [y, m] = ym.split('-').map(Number);
  const d = new Date(y, m - 1 + n, 1);
  weekStart = mondayOf(iso(d));
  renderOrders();
}

/* Тап по дню в месяце — на его неделю: в месяце видно «где густо», а что
 * именно за поставки, читается уже в неделе. */
export function showDayWeek(dateISO) {
  weekStart = mondayOf(dateISO);
  setOrdersMode('week');
}

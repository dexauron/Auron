// Правка каталога: товар, группы, поставщики, «Ходовые»

import { $, state, ui } from './store.js';
import { closeSheet, esc, groupById, norm, openSheet, supplierById, toast, translit } from './core.js';
import { checkMark, ic } from './icons.js';
import { fmtDate, fmtPrice, telHref, waHref, fmtNum } from './catalog.js';
import { byName } from './data.js';
import { renderPhotoManager } from './photos.js';
import { svSaveAndPublish, svUuid } from './imports.js';

/* ── Админ: форма товара ──────────────────────── */

export function openForm(product) {
  ui.editingProduct = product;
  $('formTitle').textContent = product ? 'Изменить товар' : 'Новый товар';
  $('fName').value = product?.name || '';
  $('fCode').value = product?.code || '';
  $('fArticle').value = product?.article || '';
  $('fBarcodes').value = (product?.barcodes || []).join('\n');
  $('fWeighted').checked = !!product?.is_weighted;
  $('fUnit').value = product?.unit || '';
  $('fDepartment').value = product?.department || '';
  $('fNote').value = product?.note || '';
  $('fDescription').value = product?.description || '';
  $('fGroup').innerHTML = '<option value="">Без группы</option>' +
    state.groups.map((g) => `<option value="${esc(g.id)}"${g.id === product?.group_id ? ' selected' : ''}>${esc(g.name)}</option>`).join('');
  $('fSupplier').innerHTML = '<option value="">Выбрать поставщика…</option>' +
    state.suppliers.map((s) => `<option value="${esc(s.id)}">${esc(s.name)}</option>`).join('');
  ui.formSupplierIds = [...(product?.supplier_ids || [])];
  renderFormSupplierTags();
  ui.formPhotos = (product?.photos || []).map((url) => ({ url }));
  renderPhotoManager();
  $('formError').hidden = true;
  openSheet('formSheet');
}

export async function submitForm(e) {
  e.preventDefault();
  const btn = $('formSubmit');
  btn.disabled = true;
  btn.textContent = 'Сохраняем…';
  $('formError').hidden = true;
  try {
    const photos = ui.formPhotos.map((ph) => ph.url).filter(Boolean); // новые фото-файлы пока не грузим
    const rec = {
      name: $('fName').value.trim(), group_id: $('fGroup').value || null, supplier_ids: ui.formSupplierIds,
      code: $('fCode').value.trim() || null, article: $('fArticle').value.trim() || null,
      barcodes: $('fBarcodes').value.split('\n').map((s) => s.trim()).filter(Boolean),
      is_weighted: $('fWeighted').checked, unit: $('fUnit').value.trim() || null,
      department: $('fDepartment').value.trim() || null, note: $('fNote').value.trim() || null,
      description: $('fDescription').value.trim() || null, photos, updated_at: new Date().toISOString(),
    };
    if (!rec.name) { $('formError').textContent = 'Впиши название товара.'; $('formError').hidden = false; btn.disabled = false; btn.textContent = 'Сохранить'; return; }
    if (ui.editingProduct) Object.assign(ui.editingProduct, rec);
    else state.products.push(Object.assign({ id: svUuid() }, rec));
    closeSheet('formSheet'); closeSheet('productSheet');
    await svSaveAndPublish(ui.editingProduct ? 'Товар обновлён' : 'Товар добавлен');
  } catch (err) {
    $('formError').textContent = 'Не удалось сохранить: ' + (err.message || err);
    $('formError').hidden = false;
  } finally { btn.disabled = false; btn.textContent = 'Сохранить'; }
}

export async function deleteProduct() {
  if (!ui.currentProduct) return;
  if (!confirm(`Удалить «${ui.currentProduct.name}» из каталога?`)) return;
  state.products = state.products.filter((p) => p.id !== ui.currentProduct.id);
  closeSheet('productSheet');
  await svSaveAndPublish('Товар удалён');
}

/* ── Админ: группы ────────────────────────────── */

export function renderGroupsManager() {
  $('groupsList').innerHTML = state.groups.map((g) => `
    <div class="group-row" data-id="${esc(g.id)}">
      <input class="input group-name" value="${esc(g.name)}">
      <button class="group-del" title="Удалить группу" aria-label="Удалить">${ic('trash', 'ic-xs')}</button>
    </div>`).join('') || '<p class="muted">Групп пока нет — добавь первую ниже</p>';
}

export async function addGroup() {
  const name = $('newGroupName').value.trim();
  if (!name) return;
  const maxSort = Math.max(0, ...state.groups.map((g) => g.sort_order || 0));
  if (state.serverless) {
    state.groups.push({ id: svUuid(), name, sort_order: maxSort + 1 });
    $('newGroupName').value = '';
    renderGroupsManager();
    await svSaveAndPublish('Группа добавлена');
    return;
  }
}

export async function renameGroup(id, name) {
  if (!name.trim()) return;
  if (state.serverless) {
    const g = groupById(id); if (g) g.name = name.trim();
    await svSaveAndPublish();
    return;
  }
}

export async function deleteGroup(id) {
  const g = groupById(id);
  if (!confirm(`Удалить группу «${g?.name}»? Товары останутся — без группы.`)) return;
  if (state.serverless) {
    state.groups = state.groups.filter((x) => x.id !== id);
    for (const p of state.products) if (p.group_id === id) p.group_id = null;
    state.selGroups = state.selGroups.filter((x) => x !== id);
    renderGroupsManager();
    await svSaveAndPublish('Группа удалена');
    return;
  }
}

/* ── Поставщики ───────────────────────────────── */

// выбранные поставщики в форме товара
export function renderFormSupplierTags() {
  $('fSupplierTags').innerHTML = ui.formSupplierIds.map((id) => {
    const s = supplierById(id);
    if (!s) return '';
    return `<span class="tag">${esc(s.name)} <button type="button" data-untag="${esc(id)}" aria-label="Убрать">${ic('close', 'ic-xs')}</button></span>`;
  }).join('') || '<span class="muted" style="margin:0">Не указаны</span>';
}

// список для фильтра (доступен всем; с поиском — поставщиков может быть много)
export function renderSupplierList() {
  const counts = {};
  for (const p of state.products) {
    for (const id of (p.supplier_ids || [])) counts[id] = (counts[id] || 0) + 1;
  }
  const q = norm($('supplierSearch').value);
  const filtered = q
    ? state.suppliers.filter((s) => norm(s.name).includes(q) || translit(norm(s.name)).includes(translit(q)))
    : state.suppliers;
  let html = '';
  if (state.selSuppliers.length) {
    html += `<button class="btn btn-ghost btn-block" data-pick-supplier="" style="margin-bottom:6px">Снять выбор (${state.selSuppliers.length})</button>`;
  }
  html += filtered.slice(0, 100).map((s) => {
    const on = state.selSuppliers.includes(s.id);
    // после входа под поставщиком видны контакты: позвонить или написать в WhatsApp
    const c = state.contacts[s.id];
    const contact = c && (c.phone || c.contact_name || c.note)
      ? `<div class="sup-contact">${c.contact_name ? `<span>${esc(c.contact_name)}</span>` : ''}${
        c.phone ? `<a href="${esc(telHref(c.phone))}">${esc(c.phone)}</a><a href="${esc(waHref(c.phone))}" target="_blank" rel="noopener">WhatsApp</a>` : ''}${
        c.note ? `<div class="sup-note">${esc(c.note)}</div>` : ''}</div>`
      : '';
    return `<div class="sup-row">
      <button class="btn btn-secondary btn-block${on ? ' picked' : ''}" data-pick-supplier="${esc(s.id)}">
        <span>${on ? checkMark : ''}${esc(s.name)}</span> <span class="chip-count">${counts[s.id] || 0}</span>
      </button>${contact}</div>`;
  }).join('') || '<p class="muted">Не нашлось — попробуй иначе</p>';
  if (filtered.length > 100) html += `<p class="muted">Показаны первые 100 из ${filtered.length} — уточни поиск</p>`;
  $('supplierList').innerHTML = html;
}

/* ── Все группы (список с поиском) ────────────── */

export function renderGroupsPick() {
  const counts = {};
  for (const p of state.products) {
    if (p.group_id) counts[p.group_id] = (counts[p.group_id] || 0) + 1;
  }
  const q = norm($('groupsPickSearch').value);
  const filtered = q ? state.groups.filter((g) => norm(g.name).includes(q)) : state.groups;
  const picked = state.selGroups.filter((x) => x !== 'none' && x !== 'weighted');
  let html = '';
  if (picked.length) {
    html += `<button class="btn btn-ghost btn-block" data-pick-group="" style="margin-bottom:6px">Снять выбор (${picked.length})</button>`;
  }
  html += filtered.map((g) => {
    const on = state.selGroups.includes(g.id);
    return `
    <button class="btn btn-secondary btn-block${on ? ' picked' : ''}" data-pick-group="${esc(g.id)}">
      <span>${on ? checkMark : ''}${esc(g.name)}</span> <span class="chip-count">${counts[g.id] || 0}</span>
    </button>`;
  }).join('') || '<p class="muted">Не нашлось — попробуй иначе</p>';
  $('groupsPickList').innerHTML = html;
}

// управление (только админ): список поставщиков с числом товаров
export function renderSuppliersManager() {
  const counts = {};
  for (const p of state.products) for (const id of p.supplier_ids || []) counts[id] = (counts[id] || 0) + 1;
  $('suppliersManageList').innerHTML = state.suppliers.map((s) => {
    const c = state.contacts[s.id] || {};
    const sub = c.phone ? ` · ${esc(c.phone)}` : '';
    return `<button class="ios-row ios-row-link" data-sup-edit="${esc(s.id)}">
      <span class="ios-row-title">${esc(s.name)}${sub}</span>
      <span class="ios-row-value">${counts[s.id] || 0}</span></button>`;
  }).join('') || '<div class="ios-row"><span class="ios-row-title muted">Поставщиков пока нет</span></div>';
}

/* ── Один поставщик: название, контакты, удаление ─────────────────────────
   Раньше этот экран был мёртвым: кнопки рисовались, но ни одна ничего не
   делала — правка поставщиков жила на сервере, а сервер убрали. Теперь всё
   происходит на устройстве владельца и уезжает обычной публикацией. */
let editingSupplier = null;

export function openSupplierEdit(id) {
  const sup = supplierById(id);
  if (!sup) return;
  editingSupplier = id;
  const c = state.contacts[id] || {};
  $('supEditName').value = sup.name || '';
  $('supEditPhone').value = c.phone || '';
  $('supEditPerson').value = c.contact_name || '';
  $('supEditNote').value = c.note || '';
  const n = state.products.filter((p) => (p.supplier_ids || []).includes(id)).length;
  $('supEditInfo').textContent = n
    ? `За этим поставщиком числится товаров: ${n}. Удалить можно — товары останутся, просто без поставщика.`
    : 'За этим поставщиком товаров нет.';
  openSheet('supplierEditSheet');
}

export async function saveSupplierEdit() {
  if (!editingSupplier) return;
  const name = $('supEditName').value.trim();
  if (!name) { toast('Название не может быть пустым'); return; }
  const sup = supplierById(editingSupplier);
  if (sup) sup.name = name;
  const phone = $('supEditPhone').value.trim();
  const person = $('supEditPerson').value.trim();
  const note = $('supEditNote').value.trim();
  if (phone || person || note) state.contacts[editingSupplier] = { phone, contact_name: person, note };
  else delete state.contacts[editingSupplier];
  closeSheet('supplierEditSheet');
  renderSuppliersManager();
  await svSaveAndPublish('Поставщик сохранён');
}

export async function deleteSupplier() {
  if (!editingSupplier) return;
  const sup = supplierById(editingSupplier);
  const n = state.products.filter((p) => (p.supplier_ids || []).includes(editingSupplier)).length;
  const warn = n ? `\nУ ${n} товаров он указан — они останутся, просто без этого поставщика.` : '';
  if (!confirm(`Удалить поставщика «${sup?.name}»?${warn}`)) return;
  const id = editingSupplier;
  state.suppliers = state.suppliers.filter((x) => x.id !== id);
  for (const p of state.products) if (p.supplier_ids) p.supplier_ids = p.supplier_ids.filter((x) => x !== id);
  state.prices = (state.prices || []).filter((r) => r.supplier_id !== id);
  state.selSuppliers = state.selSuppliers.filter((x) => x !== id);
  delete state.contacts[id];
  editingSupplier = null;
  closeSheet('supplierEditSheet');
  renderSuppliersManager();
  await svSaveAndPublish('Поставщик удалён');
}

export async function addSupplier() {
  const name = (prompt('Название поставщика') || '').trim();
  if (!name) return;
  const id = svUuid();
  state.suppliers.push({ id, name });
  renderSuppliersManager();
  await svSaveAndPublish('Поставщик добавлен');
  openSupplierEdit(id);
}

/* ── Контакты поставщика (редактирует админ) ──── */

let editingContactSupplier = null;

/* ── Ходовые товары (после входа) ─────────────── */

const isoDay = (d) => d.toISOString().slice(0, 10);

export const daysBetween = (from, to) => Math.max(1, Math.round((new Date(to) - new Date(from)) / 86400000) + 1);

const MONTHS_GEN = ['января', 'февраля', 'марта', 'апреля', 'мая', 'июня', 'июля', 'августа', 'сентября', 'октября', 'ноября', 'декабря'];
const MONTHS_NOM = ['Январь', 'Февраль', 'Март', 'Апрель', 'Май', 'Июнь', 'Июль', 'Август', 'Сентябрь', 'Октябрь', 'Ноябрь', 'Декабрь'];
// Человеческое название периода: «Июль 2026» (полный месяц) · «17 июля 2026»
// (один день) · «1 июля – 15 августа 2026» (произвольный диапазон).
export function periodLabel(from, to) {
  const [fy, fm, fd] = String(from).split('-').map(Number);
  const [ty, tm, td] = String(to).split('-').map(Number);
  if (!fy || !ty) return `${fmtDate(from)}–${fmtDate(to)}`;
  if (from === to) return `${fd} ${MONTHS_GEN[fm - 1]} ${fy}`;
  const lastDay = new Date(fy, fm, 0).getDate(); // последний день месяца fm
  if (fd === 1 && fy === ty && fm === tm && td === lastDay) return `${MONTHS_NOM[fm - 1]} ${fy}`;
  const yr = ty === fy ? '' : ` ${fy}`;
  return `${fd} ${MONTHS_GEN[fm - 1]}${yr} – ${td} ${MONTHS_GEN[tm - 1]} ${ty}`;
}

// загруженные периоды продаж: один — просто подпись, несколько — простой список
export async function renderTopPeriods() {
  const box = $('topChips');
  let periods = [];
  if (state.serverless) {
    const seen = new Map();
    for (const s of (state.sales || [])) {
      const k = (s.period_from || '') + '|' + (s.period_to || '');
      if (!seen.has(k)) seen.set(k, { period_from: s.period_from, period_to: s.period_to });
    }
    periods = [...seen.values()].sort((a, b) => String(b.period_to || '').localeCompare(String(a.period_to || '')));
  }
  if (!periods.length) {
    box.innerHTML = '';
    $('topDeletePeriod').hidden = true;
    $('topList').innerHTML = '<p class="muted">Продажи ещё не загружены. Меню админа → «Импорт продаж» — загрузи отчёт «Продажи» из 1С.</p>';
    return;
  }
  // удалить отчёт может только администратор
  $('topDeletePeriod').hidden = !state.isAdmin;
  // по умолчанию — самый свежий отчёт (список приходит от новых к старым)
  ui.topPeriod = { from: periods[0].period_from, to: periods[0].period_to };
  if (periods.length === 1) {
    box.innerHTML = `<div class="top-period-one">${esc(periodLabel(ui.topPeriod.from, ui.topPeriod.to))}</div>`;
  } else {
    box.innerHTML = '<label class="top-period-field"><span class="top-period-cap">Период</span>'
      + '<select id="topPeriodSel">'
      + periods.map((p) => `<option value="${esc(p.period_from)}|${esc(p.period_to)}">${esc(periodLabel(p.period_from, p.period_to))}</option>`).join('')
      + '</select></label>';
  }
  loadTopProducts();
}

// как считаем «ходовость»: по выручке (деньгам) — профессиональный вариант по
// умолчанию — или по количеству. Деньги сравнимы для весовых и штучных, поэтому
// выручка честнее: топ не путает кг и шт и не прячет дорогие позиции.

export async function loadTopProducts() {
  if (!ui.topPeriod) return;
  const from = ui.topPeriod.from;
  const to = ui.topPeriod.to;
  const days = daysBetween(from, to);
  const box = $('topList');
  box.innerHTML = '<p class="muted">Считаем…</p>';

  let data; let total = null;
  if (state.serverless) {
    // считаем из данных продаж в памяти (тот же формат: product_id, total_qty, total_amount)
    const byCode = new Map(), byName = new Map();
    for (const p of state.products) { if (p.code) byCode.set(String(p.code), p); byName.set(norm(p.name), p); }
    const agg = new Map();
    for (const s of (state.sales || [])) {
      if ((s.period_from || '') !== from || (s.period_to || '') !== to) continue;
      const p = (s.code && byCode.get(String(s.code))) || byName.get(norm(s.name || ''));
      if (!p) continue;
      const a = agg.get(p.id) || { product_id: p.id, total_qty: 0, total_amount: 0 };
      a.total_qty += Number(s.qty) || 0; a.total_amount += Number(s.amount) || 0;
      agg.set(p.id, a);
    }
    data = [...agg.values()];
    total = { total_amount: data.reduce((x, r) => x + r.total_amount, 0) };
  }
  if (!data || !data.length) { box.innerHTML = '<p class="muted">За этот период продаж нет</p>'; return; }

  const byId = new Map(state.products.map((p) => [p.id, p]));
  // Количества тоже пишем с разделителями: «12 000 шт» читается сразу,
  // «12000 шт» приходится пересчитывать глазами по цифрам.
  const rnd = (n) => fmtNum(n % 1 ? Math.round(n * 10) / 10 : n);
  const num = (v) => Number(v) || 0;
  const metric = (r) => (ui.topMode === 'qty' ? num(r.total_qty) : num(r.total_amount));
  // на всякий случай (и для старой базы) сортируем сами по выбранной мере
  data = data.slice().sort((a, b) => metric(b) - metric(a));

  const totAmount = total ? num(total.total_amount) : data.reduce((s, r) => s + num(r.total_amount), 0);
  const maxMetric = metric(data[0]) || 1;
  const modeLabel = ui.topMode === 'qty' ? 'по количеству' : 'по выручке';
  const head = `<div class="top-summary">${esc(periodLabel(from, to))} · ${days} дн. · ${modeLabel}`
    + (totAmount ? ` · оборот ${fmtPrice(totAmount)}` : '') + `</div>`;

  box.innerHTML = head + data.map((row, i) => {
    const p = byId.get(row.product_id);
    if (!p) return '';
    const photo = (p.photos || [])[0];
    const qty = num(row.total_qty);
    const amt = num(row.total_amount);
    const u = p.unit || (p.is_weighted ? 'кг' : 'шт');
    const perDay = rnd(qty / days);
    const primary = ui.topMode === 'qty' ? `${rnd(qty)} ${esc(u)}` : fmtPrice(amt);
    const secondary = ui.topMode === 'qty' ? (amt ? fmtPrice(amt) : '') : `${rnd(qty)} ${esc(u)}`;
    const share = totAmount ? (amt / totAmount) * 100 : 0;
    const shareTxt = share ? ` · ${share >= 10 ? Math.round(share) : share.toFixed(1)}% оборота` : '';
    const barW = Math.max(4, Math.round((metric(row) / maxMetric) * 100));
    return `<div class="top-row${i < 3 ? ' top-row-lead' : ''}" data-id="${esc(p.id)}">
      <span class="top-rank">${i + 1}</span>
      <span class="top-photo">${photo ? `<img src="${esc(photo)}" loading="lazy" alt="">` : ic('box', 'ic-ph')}</span>
      <div class="top-main">
        <div class="top-name">${esc(p.name)}</div>
        <div class="top-bar"><span style="width:${barW}%"></span></div>
        <div class="top-sub">≈${perDay} ${esc(u)}/день${shareTxt}</div>
      </div>
      <div class="top-val">
        <span class="top-primary">${primary}</span>
        ${secondary ? `<span class="top-secondary">${secondary}</span>` : ''}
      </div>
    </div>`;
  }).join('');
}

export function openTopSheet() {
  openSheet('topSheet');
  $('topList').innerHTML = '<p class="muted">Загружаем…</p>';
  renderTopPeriods();
}

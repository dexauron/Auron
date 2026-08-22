// Пересчёт (инвентаризация): что реально стоит на полке против того, что в базе

/* Как считали раньше: бумага, ручка, потом кто-то вбивает это в 1С и сверяет
 * глазами. Здесь сотрудник идёт по залу с телефоном, сканирует товар — каждое
 * сканирование это «плюс один», — а расхождение с остатком из 1С видно сразу,
 * прямо в строке. Готовый список одной кнопкой уходит владельцу текстом.
 *
 * Остатки в каталоге НЕ переписываем: они приходят из 1С, и пересчёт их не
 * заменяет. Задача экрана — показать разницу, а не подменить учёт. */

import { $, state } from './store.js';
import { esc, openSheet, toast } from './core.js';
import { fmtDate, fmtNum, todayISO } from './catalog.js';
import { plural } from './competitors.js';
import { ic } from './icons.js';
import { startScan } from './scanner.js';

const KEY = 'wm_count_v1';
const MAX = 1000;   // больше тысячи позиций за один заход не считают

function read() {
  try {
    const v = JSON.parse(localStorage.getItem(KEY));
    return v && Array.isArray(v.items) ? v : { started: todayISO(), items: [] };
  } catch (e) { return { started: todayISO(), items: [] }; }
}
function write(sheet) {
  try {
    localStorage.setItem(KEY, JSON.stringify({ ...sheet, items: sheet.items.slice(0, MAX) }));
  } catch (e) { /* нет места */ }
}

// остаток из 1С на момент, когда позицию добавили в пересчёт
const stockOf = (p) => (p && p.stock != null && p.stock !== '' ? Number(p.stock) : null);

function findProduct(text) {
  const t = String(text || '').trim();
  if (!t) return null;
  const low = t.toLowerCase();
  return state.products.find((p) => (p.barcodes || []).some((b) => String(b).trim() === t))
    || state.products.find((p) => String(p.code || '').trim() === t)
    || state.products.find((p) => String(p.name || '').toLowerCase() === low)
    || null;
}

/* Добавить позицию или прибавить к ней. Одно сканирование = одна штука:
 * сотрудник ведёт камерой по полке, а счёт растёт сам. */
function addToCount(p, delta = 1) {
  if (!p) return null;
  const sheet = read();
  let row = sheet.items.find((x) => x.id === p.id);
  if (!row) {
    row = { id: p.id, name: p.name || '', code: p.code || '', unit: p.unit || '', stock: stockOf(p), qty: 0 };
    sheet.items.unshift(row);       // только что посчитанное — сверху
  }
  row.qty = Math.max(0, Math.round((row.qty + delta) * 1000) / 1000);
  write(sheet);
  return row;
}

/* Кнопки «−» и «+» в строке: правим только то, что уже посчитано, поэтому
 * товар искать не нужно — строка со всеми данными уже есть. */
export function bumpCount(id, delta) {
  const sheet = read();
  const row = sheet.items.find((x) => x.id === id);
  if (!row) return;
  row.qty = Math.max(0, Math.round((row.qty + delta) * 1000) / 1000);
  write(sheet);
  renderCount();
}

export function setCountQty(id, qty) {
  const sheet = read();
  const row = sheet.items.find((x) => x.id === id);
  if (!row) return;
  row.qty = Math.max(0, Number(String(qty).replace(',', '.')) || 0);
  write(sheet);
  renderCount();
}

export function removeFromCount(id) {
  const sheet = read();
  sheet.items = sheet.items.filter((x) => x.id !== id);
  write(sheet);
  renderCount();
}

export function clearCount() {
  if (!read().items.length) return;
  if (!confirm('Очистить пересчёт? Посчитанное не сохранится.')) return;
  write({ started: todayISO(), items: [] });
  renderCount();
}

/* В меню видно, что пересчёт начат и не доведён до конца: без этого его легко
 * забыть открытым на неделю и потом удивиться цифрам. */
export function renderCountBadge() {
  const el = $('menuCountValue');
  if (!el) return;
  const n = read().items.length;
  el.textContent = n ? `посчитано ${n}` : '';
}

export function openCount() {
  renderCount();
  openSheet('countSheet');
}

const diffOf = (row) => (row.stock == null ? null : Math.round((row.qty - row.stock) * 1000) / 1000);

function renderCount() {
  const box = $('countBody');
  if (!box) return;
  const sheet = read();
  if (!sheet.items.length) {
    box.innerHTML = `<p class="ios-note">Пересчёт пуст. Нажми «Сканировать» и веди камерой по полке —
      каждое сканирование прибавляет одну штуку. Товар без штрихкода добавь по коду в поле ниже.</p>`;
    return;
  }
  const withDiff = sheet.items.filter((x) => diffOf(x) !== null && diffOf(x) !== 0);
  const rows = sheet.items.map((x) => {
    const d = diffOf(x);
    const diffTxt = d === null ? 'нет остатка в базе'
      : d === 0 ? 'сходится'
        : `${d > 0 ? '+' : '−'}${fmtNum(Math.abs(d))}`;
    const cls = d === null ? 'cnt-none' : d === 0 ? 'cnt-ok' : (d < 0 ? 'cnt-minus' : 'cnt-plus');
    return `<div class="ios-row cnt-row">
      <span class="ios-row-title">${esc(x.name)}
        <span class="ord-sub">${x.code ? 'код ' + esc(x.code) + ' · ' : ''}в базе ${x.stock == null ? '—' : fmtNum(x.stock)}
          · <span class="${cls}">${diffTxt}</span></span></span>
      <span class="cnt-step">
        <button data-cnt-minus="${esc(x.id)}" aria-label="Минус один">−</button>
        <input type="text" inputmode="decimal" value="${esc(fmtNum(x.qty))}" data-cnt-qty="${esc(x.id)}" aria-label="Сколько на полке">
        <button data-cnt-plus="${esc(x.id)}" aria-label="Плюс один">+</button>
        <button class="cnt-rm" data-cnt-rm="${esc(x.id)}" aria-label="Убрать">${ic('close', 'ic-xs')}</button>
      </span>
    </div>`;
  }).join('');

  box.innerHTML = `
    <div class="ord-total">${fmtDate(sheet.started)} · ${sheet.items.length}
      ${plural(sheet.items.length, 'позиция', 'позиции', 'позиций')}${withDiff.length
  ? ` · <b class="cnt-minus">расхождений ${withDiff.length}</b>` : ' · всё сходится'}</div>
    <div class="ios-group">${rows}</div>
    <p class="ios-note">«В базе» — остаток из 1С на момент, когда позицию добавили. Пересчёт его
    не переписывает: это сверка, а поправить учёт можно только в 1С.</p>`;
}

/* Добавление руками — для товара без штрихкода (весовое, выпечка): вводишь код
 * или название, позиция появляется в списке. */
export function addCountByCode() {
  const inp = $('countCode');
  const p = findProduct(inp.value);
  if (!p) { toast('Товар с таким кодом не найден'); return; }
  addToCount(p, 1);
  inp.value = '';
  renderCount();
}

// Сканирование подряд: камера не закрывается, каждый штрихкод — плюс одна штука
export function startCountScan() {
  // переключатель режимов сканера («Товар / Ценник / Закончилось») сейчас ни при
  // чём — камеру открыл пересчёт. Обратно его показывает обычный запуск сканера.
  const seg = $('scanModeSeg'); if (seg) seg.hidden = true;
  const res = $('scanResult'); if (res) { res.hidden = true; res.innerHTML = ''; }
  startScan((text) => {
    const box = $('scanResult');
    const p = findProduct(text);
    if (!p) {
      if (box) {
        box.hidden = false;
        box.innerHTML = `<div class="scan-result-miss">Нет в каталоге</div>
          <div class="scan-result-code">${esc(text)}</div>`;
      }
      return;
    }
    const row = addToCount(p, 1);
    renderCount();
    if (!box) return;
    box.hidden = false;
    const d = diffOf(row);
    box.innerHTML = `<div class="scan-result-name">${esc(p.name)}</div>
      <div class="scan-result-price">посчитано ${fmtNum(row.qty)}</div>
      <div class="scan-result-code">${row.stock == null ? 'остатка в базе нет'
    : `в базе ${fmtNum(row.stock)}${d ? ` · разница ${d > 0 ? '+' : '−'}${fmtNum(Math.abs(d))}` : ' · сходится'}`}</div>`;
  }, { keepOpen: true });
}

// Передать владельцу: пересчёт уходит текстом — расхождения первыми
export async function shareCount() {
  const sheet = read();
  if (!sheet.items.length) { toast('Пересчёт пуст'); return; }
  const line = (x) => {
    const d = diffOf(x);
    return `${x.name}${x.code ? ' (' + x.code + ')' : ''}: на полке ${fmtNum(x.qty)}`
      + (x.stock == null ? ', в базе нет данных' : `, в базе ${fmtNum(x.stock)}`)
      + (d ? `, разница ${d > 0 ? '+' : '−'}${fmtNum(Math.abs(d))}` : '');
  };
  const bad = sheet.items.filter((x) => diffOf(x) !== null && diffOf(x) !== 0);
  const ok = sheet.items.filter((x) => !bad.includes(x));
  const text = `Пересчёт от ${fmtDate(sheet.started)}\n`
    + (bad.length ? `Расхождения (${bad.length}):\n${bad.map(line).join('\n')}\n` : '')
    + (ok.length ? `Сходится (${ok.length}):\n${ok.map(line).join('\n')}` : '');
  try {
    if (navigator.share) { await navigator.share({ text }); return; }
    await navigator.clipboard.writeText(text);
    toast('Пересчёт скопирован — отправь владельцу');
  } catch (e) { toast('Не получилось поделиться'); }
}

// Заявки: собранные списки покупок, которые владелец проводит в 1С

/* Владелец: «сделай отдельное окно, где собирается список покупок, и чтобы я
 * мог скопировать список как у шаблона… отметить, что всё принял, зачеркнуть,
 * и чтобы даже зачёркнутый я мог посмотреть и скопировать заново в любое
 * время».
 *
 * Как это живёт без сервера. Список собирается на устройстве — своём или
 * чужом. Чужой приходит ссылкой (её шлёт покупатель или сотрудник), владелец
 * открывает ссылку, список подхватывается в его каталог — и одной кнопкой
 * откладывается сюда, в заявки. Телефон покупателя сам ничего владельцу
 * положить не может: писать в общий каталог умеет только владелец, у него
 * ключ. Это не обход, это устройство каталога.
 *
 * Заявки лежат в общем снимке каталога (а не только на телефоне), поэтому
 * переживают переустановку и видны на всех устройствах владельца после
 * публикации. Принятые НЕ удаляются: владелец просил возвращаться к ним через
 * любое время — «если будут вопросы, сомнения». Чистим только по числу, чтобы
 * снимок не разрастался. */

import { $, state, ui } from './store.js';
import { closeSheet, esc, openSheet, toast } from './core.js';
import { fmtDate, fmtNum, fmtPrice, todayISO } from './catalog.js';
import { plural } from './competitors.js';
import { ic } from './icons.js';
import { copyForOnec, downloadForOnec } from './onec.js';
import { deviceName } from './device.js';

const MAX_KEEP = 300;        // больше трёхсот заявок в снимке держать незачем

const all = () => (state.requests = state.requests || []);
const byId = (id) => all().find((r) => r.id === id) || null;

// сколько заявок ждёт приёмки — для значка во вкладке «Работа»
export const requestsWaiting = () => all().filter((r) => !r.takenAt).length;

const sum = (items) => items.reduce((s, x) => s + (Number(x.price) || 0) * (Number(x.qty) || 0), 0);
const lines = (items) => items.filter((x) => Number(x.qty) > 0).length;

/* Отложить текущий список покупок в заявки. Сам список при этом не стираем:
 * человек мог отложить его «на всякий» и продолжить собирать. */
export function saveAsRequest(items, who) {
  const keep = (items || []).filter((x) => Number(x.qty) > 0);
  if (!keep.length) { toast('В списке нет количества — нечего сохранять'); return null; }
  const rec = {
    id: 'r' + Date.now().toString(36),
    at: new Date().toISOString(),
    who: who || deviceName() || '',
    items: keep.map((x) => ({ ...x })),       // копия: правки в списке её не тронут
    takenAt: null,
  };
  all().unshift(rec);
  if (all().length > MAX_KEEP) state.requests = all().slice(0, MAX_KEEP);
  if (ui.renderWorkBadge) ui.renderWorkBadge();
  toast(`Заявка сохранена: ${lines(keep)} ${plural(lines(keep), 'позиция', 'позиции', 'позиций')}`);
  return rec.id;
}

/* ── Экран ──────────────────────────────────────────────────────────────────
 * Одно окно, два состояния: список заявок и одна раскрытая. Отдельного окна
 * под раскрытую не завожу — это была бы ещё одна шторка поверх шторки. */
let openId = null;

function listHtml() {
  const rows = all();
  if (!rows.length) {
    return `<p class="ios-note">Заявок пока нет. Собери список покупок (кнопка «В список покупок»
      в карточке товара) и нажми в нём «Сохранить как заявку». Список, который прислали ссылкой,
      тоже сначала открывается как список покупок, а потом сохраняется сюда.</p>`;
  }
  const wait = rows.filter((r) => !r.takenAt);
  const done = rows.filter((r) => r.takenAt);
  const group = (title, list) => (list.length ? `<div class="ios-group-title">${title}</div>
    <div class="ios-group">${list.map((r) => `
      <button class="ios-row ios-row-link${r.takenAt ? ' req-taken' : ''}" data-req-open="${esc(r.id)}">
        <span class="ios-row-title">${esc(fmtDate(r.at.slice(0, 10)))}${r.who ? ' · ' + esc(r.who) : ''}
          <span class="ord-sub">${lines(r.items)} ${plural(lines(r.items), 'позиция', 'позиции', 'позиций')}
          · ${esc(fmtPrice(sum(r.items)))}${r.takenAt ? ' · принято ' + esc(fmtDate(r.takenAt.slice(0, 10))) : ''}</span></span>
      </button>`).join('')}</div>` : '');
  return group(`Ждут приёмки · ${wait.length}`, wait) + group(`Принятые · ${done.length}`, done)
    + `<p class="ios-note">Принятые не удаляются: открывай и копируй их в любой день, если
       появятся вопросы. Храним последние ${MAX_KEEP}.</p>`;
}

function oneHtml(r) {
  const rows = r.items.filter((x) => Number(x.qty) > 0).map((x) => `
    <div class="ios-row">
      <span class="ios-row-title">${esc(x.name)}
        <span class="ord-sub">${fmtNum(x.qty)} ${esc(x.unit || 'шт')}${
  x.code ? ' · код ' + esc(x.code) : ''}${x.barcode ? ' · ' + esc(x.barcode) : ''}</span></span>
      <span class="ios-row-value">${x.price ? esc(fmtPrice(Number(x.price) * Number(x.qty))) : '—'}</span>
    </div>`).join('');
  return `
    <button class="cat-back" data-req-back>‹ Все заявки</button>
    <div class="ord-total${r.takenAt ? ' req-taken' : ''}">${lines(r.items)} ${plural(lines(r.items), 'позиция', 'позиции', 'позиций')}
      · итого <b>${esc(fmtPrice(sum(r.items)))}</b>${r.takenAt ? ' · принято ' + esc(fmtDate(r.takenAt.slice(0, 10))) : ''}</div>
    <div class="ios-group">${rows}</div>
    <div class="sheet-actions">
      <button class="btn btn-primary" data-req-copy="${esc(r.id)}">Скопировать для 1С</button>
      <button class="btn btn-secondary" data-req-file="${esc(r.id)}">Скачать файл</button>
    </div>
    <div class="ios-group">
      <button class="ios-row ios-row-action" data-req-take="${esc(r.id)}">
        <span class="ios-row-title">${r.takenAt ? 'Вернуть в работу' : 'Отметить: всё принял'}</span></button>
    </div>
    <div class="ios-group">
      <button class="ios-row ios-row-danger" data-req-del="${esc(r.id)}">
        <span class="ios-row-title">Удалить заявку</span></button>
    </div>
    <p class="ios-note">«Скопировать для 1С» кладёт строки в буфер через табуляцию — вставляются
    в Excel сразу по колонкам шаблона: код, штрих-код, наименование, артикул, единица,
    количество, цена, сумма. Дальше в 1С: «Заполнить → Загрузить из файла».</p>`;
}

function renderRequests() {
  const box = $('requestsBody');
  if (!box) return;
  const r = openId ? byId(openId) : null;
  box.innerHTML = r ? oneHtml(r) : listHtml();
}

export function openRequests() {
  openId = null;
  renderRequests();
  openSheet('requestsSheet');
}

export function bindRequests(onChanged) {
  ui.workActions = ui.workActions || {};
  ui.workActions.requests = openRequests;
  ui.saveAsRequest = saveAsRequest;       // список покупок зовёт через ui, без встречного импорта

  $('requestsBody').addEventListener('click', async (e) => {
    const open = e.target.closest('[data-req-open]');
    if (open) { openId = open.dataset.reqOpen; renderRequests(); return; }
    if (e.target.closest('[data-req-back]')) { openId = null; renderRequests(); return; }

    const copy = e.target.closest('[data-req-copy]');
    if (copy) { const r = byId(copy.dataset.reqCopy); if (r) await copyForOnec(r.items); return; }

    const file = e.target.closest('[data-req-file]');
    if (file) {
      const r = byId(file.dataset.reqFile);
      if (r) await downloadForOnec(r.items, 'Заявка ' + r.at.slice(0, 10));
      return;
    }

    const take = e.target.closest('[data-req-take]');
    if (take) {
      const r = byId(take.dataset.reqTake);
      if (!r) return;
      r.takenAt = r.takenAt ? null : todayISO();
      renderRequests();
      if (ui.renderWorkBadge) ui.renderWorkBadge();
      if (onChanged) onChanged(r.takenAt ? 'Заявка принята' : 'Заявка снова в работе');
      return;
    }

    const del = e.target.closest('[data-req-del]');
    if (del) {
      const r = byId(del.dataset.reqDel);
      if (!r) return;
      // спрашиваем: принятую заявку владелец просил хранить, случайное удаление обидно
      if (!confirm('Удалить заявку? Вернуть её будет нельзя.')) return;
      state.requests = all().filter((x) => x.id !== r.id);
      openId = null;
      renderRequests();
      if (ui.renderWorkBadge) ui.renderWorkBadge();
      if (onChanged) onChanged('Заявка удалена');
    }
  });
}

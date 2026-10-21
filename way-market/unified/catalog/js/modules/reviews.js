// Отзывы соседей

/* Сравнение с каталогами сетей показало ровно одну вещь, которой у нас нет, а
 * у них есть: отзывы покупателей. «Виктория, 25 июля — очень вкусно» под
 * товаром работает сильнее любой рекламы, потому что это написали не мы.
 *
 * Сервера нет, значит принимать отзывы напрямую нельзя — и не надо. Путь такой:
 * покупатель ставит оценку и пишет пару слов → уходит готовое сообщение в
 * WhatsApp владельцу → владелец одной кнопкой добавляет отзыв в каталог, и при
 * следующей публикации его видят все. Небыстро, зато честно: ни одного
 * выдуманного отзыва и ни одной анонимной ругани — владелец видит, что
 * публикует.
 *
 * В маленьком магазине это работает лучше, чем 5000 отзывов у сети: люди
 * узнают соседей по именам. */

import { $, state, ui } from './store.js';
import { closeSheet, esc, openSheet, toast } from './core.js';
import { fmtDate, todayISO } from './catalog.js';
import { plural } from './competitors.js';
import { ic } from './icons.js';
import { sendWhatsApp, storeWa } from './whatsapp.js';

const MAX_TEXT = 200;        // длиннее никто не читает, а витрина тяжелеет

/* Оценка товара: среднее и сколько отзывов. Пусто — значит показывать нечего,
 * и никаких «нет оценок» мы не пишем: пустая строка хуже её отсутствия. */
export function ratingOf(p) {
  const list = (p && p.reviews) || [];
  const marks = list.map((x) => Number(x.r)).filter((n) => n >= 1 && n <= 5);
  if (!marks.length) return null;
  const avg = marks.reduce((s, n) => s + n, 0) / marks.length;
  return { avg: Math.round(avg * 10) / 10, n: list.length };
}

export function ratingText(p) {
  const r = ratingOf(p);
  return r ? `${String(r.avg).replace('.', ',')} · ${r.n} ${plural(r.n, 'отзыв', 'отзыва', 'отзывов')}` : '';
}

/* Звёзды рисуем значком из набора, а не символом-эмодзи: эмодзи и типографские
 * знаки на Android, iPhone и Windows выглядят по-разному, и правило проекта
 * их запрещает. Заполненные — цветом, пустые — бледные. */
const stars = (n) => {
  const k = Math.round(Number(n) || 0);
  let out = '<span class="rev-mark">';
  for (let i = 1; i <= 5; i++) out += ic('star', i <= k ? 'ic-xs star-on' : 'ic-xs star-off');
  return out + '</span>';
};

/* Отзывы в карточке товара: имя, когда, оценка и сами слова. */
export function reviewsHtml(p) {
  const list = ((p && p.reviews) || []).slice().sort((a, b) => String(b.d || '').localeCompare(String(a.d || '')));
  if (!list.length) return '';
  const r = ratingOf(p);
  return `<div class="rev-block">
    <div class="rev-head"><span class="rev-stars">${stars(r.avg)}</span>
      <b>${esc(String(r.avg).replace('.', ','))}</b>
      <span class="rev-count">${r.n} ${plural(r.n, 'отзыв', 'отзыва', 'отзывов')}</span></div>
    ${list.map((x) => `<div class="rev-row">
      <div class="rev-who">${esc(x.n || 'Покупатель')}
        <span class="rev-when">${esc(fmtDate(x.d) || '')}</span>
        ${stars(x.r)}</div>
      ${x.t ? `<div class="rev-text">${esc(x.t)}</div>` : ''}
    </div>`).join('')}
  </div>`;
}

/* ── Покупатель ставит оценку ───────────────────────────────────────────── */
export function openRate(p) {
  if (!p) return;
  ui.rateFor = p;
  $('rateName').value = localStorage.getItem('wm_rate_name') || '';
  $('rateText').value = '';
  $('rateError').hidden = true;
  ui.rateStars = 0;
  syncStars();
  $('rateTitle').textContent = p.name || 'Товар';
  openSheet('rateSheet');
}

function syncStars() {
  const n = ui.rateStars || 0;
  document.querySelectorAll('#rateStars [data-star]').forEach((b) => {
    b.classList.toggle('on', Number(b.dataset.star) <= n);
  });
}

function sendRate() {
  const p = ui.rateFor;
  const err = $('rateError');
  if (!p) return;
  if (!ui.rateStars) { err.textContent = 'Поставь оценку — от одной звезды до пяти.'; err.hidden = false; return; }
  const wa = storeWa();
  if (!wa) { toast('Магазин не указал номер для связи'); return; }
  const name = $('rateName').value.trim().slice(0, 40);
  const words = $('rateText').value.trim().slice(0, MAX_TEXT);
  try { localStorage.setItem('wm_rate_name', name); } catch (e) { /* приватный режим */ }
  const text = `Отзыв о товаре\n${p.name}${p.code ? ` (код ${p.code})` : ''}\n`
    + `Оценка: ${ui.rateStars} из 5\n`
    + (name ? `Имя: ${name}\n` : '')
    + (words ? `${words}\n` : '');
  sendWhatsApp(text, wa);
  closeSheet('rateSheet');
  toast('Спасибо! Отзыв ушёл в магазин');
}

/* ── Владелец добавляет отзыв ───────────────────────────────────────────── */
function openReviews() {
  renderReviews();
  openSheet('reviewsSheet');
}

function renderReviews() {
  const box = $('reviewsBody');
  if (!box) return;
  const withRev = (state.products || []).filter((p) => (p.reviews || []).length);
  const rows = [];
  for (const p of withRev) {
    for (let i = 0; i < p.reviews.length; i++) {
      const x = p.reviews[i];
      rows.push(`<div class="ios-row">
        <span class="ios-row-title">${esc(p.name)}
          <span class="ord-sub">${esc(x.n || 'Покупатель')} · ${stars(x.r)} · ${esc(fmtDate(x.d) || '')}
          ${x.t ? '— ' + esc(x.t) : ''}</span></span>
        <button class="rst-rm" data-rev-rm="${esc(p.id)}:${i}" aria-label="Убрать">${ic('close', 'ic-xs')}</button>
      </div>`);
    }
  }
  const total = rows.length;
  box.innerHTML = `<p class="ios-note">Покупатель ставит оценку в каталоге, и она приходит вам в
    WhatsApp. Здесь вы добавляете её в каталог — и её видят все. Ничего не публикуется
    само: что добавите, то и будет.</p>
    ${total ? `<div class="ios-group-title">Опубликовано · ${total}</div>
      <div class="ios-group">${rows.join('')}</div>`
    : '<p class="ios-note">Пока ни одного отзыва.</p>'}`;
}

function addReview() {
  const code = $('revCode').value.trim();
  const err = $('revError');
  const p = (state.products || []).find((x) => x.code != null && String(x.code) === code)
    || (state.products || []).find((x) => String(x.id) === code);
  if (!p) { err.textContent = 'Товар с таким кодом не найден. Код есть в сообщении покупателя.'; err.hidden = false; return null; }
  const r = Number($('revStars').value);
  if (!(r >= 1 && r <= 5)) { err.textContent = 'Оценка — число от 1 до 5.'; err.hidden = false; return null; }
  err.hidden = true;
  p.reviews = p.reviews || [];
  p.reviews.push({
    n: $('revName').value.trim().slice(0, 40) || 'Покупатель',
    r,
    t: $('revText').value.trim().slice(0, MAX_TEXT),
    d: todayISO(),
  });
  $('revCode').value = ''; $('revName').value = ''; $('revText').value = ''; $('revStars').value = '5';
  renderReviews();
  return p;
}

function removeReview(key) {
  const [id, i] = String(key).split(':');
  const p = (state.products || []).find((x) => String(x.id) === id);
  if (!p || !p.reviews) return null;
  p.reviews.splice(Number(i), 1);
  if (!p.reviews.length) delete p.reviews;
  renderReviews();
  return p;
}

/* Обработчики модуль вешает сам: app.js уже дорос до предела, который держит
 * проверка «модули». */
export function renderReviewsBadge() {
  const el = $('menuReviewsCount');
  if (!el) return;
  let n = 0;
  for (const p of state.products || []) n += (p.reviews || []).length;
  el.textContent = n ? String(n) : '—';
}

export function bindReviews(onSaved) {
  $('rateStars').addEventListener('click', (e) => {
    const b = e.target.closest('[data-star]');
    if (!b) return;
    ui.rateStars = Number(b.dataset.star);
    syncStars();
  });
  $('rateSend').addEventListener('click', sendRate);
  $('menuReviews').addEventListener('click', () => { closeSheet('adminMenuSheet'); openReviews(); });
  $('revAdd').addEventListener('click', () => { if (addReview()) onSaved('Отзыв добавлен'); });
  $('reviewsBody').addEventListener('click', (e) => {
    const rm = e.target.closest('[data-rev-rm]');
    if (rm && removeReview(rm.dataset.revRm)) onSaved('Отзыв убран');
  });
}

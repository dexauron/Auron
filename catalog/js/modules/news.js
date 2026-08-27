// Новости для покупателя: «появилось то, что ты ждал» и «что подешевело»

/* Сервера нет, значит и push-уведомлений честно быть не может. Но телефон сам
 * может заметить перемены: он помнит, чего человек ждал и почём товары стоили
 * в прошлый заход. При следующем открытии каталога сравниваем и показываем
 * плашку — «появилось» и «подешевело». Ничего никуда не отправляется.
 *
 * Снимок цен держим неделю: иначе «подешевело» исчезало бы сразу после
 * первого же захода, и человек ничего не успевал заметить. */

import { $, idbGet, idbSet, state, ui } from './store.js';
import { closeSheet, esc, openSheet, toast } from './core.js';
import { daysAgoISO, fmtDate, fmtPrice, fmtRetail, todayISO } from './catalog.js';
import { plural } from './competitors.js';
import { stockState } from './publish.js';

const WAIT_KEY = 'wm_guest_wait_v1';
const SNAP_KEY = 'wm_price_snapshot';
const SNAP_DAYS = 7;            // столько живёт снимок цен
const DROP_MIN_RUB = 1;         // мелочь в копейках — не новость
const DROP_MIN_PCT = 3;

/* Новинки. «Новое» — то, что появилось в каталоге за две недели. Защита от
 * ложных новинок: если разом «новым» оказалась половина каталога, это не завоз,
 * а первая загрузка данных — тогда ничего не показываем. */
const NEW_DAYS = 14;
const NEW_MAX_SHARE = 0.2;
const SEEN_KEY = 'wm_news_seen';

let news = { appeared: [], cheaper: [], fresh: [] };

function readWait() {
  try { return JSON.parse(localStorage.getItem(WAIT_KEY)) || []; } catch (e) { return []; }
}
function writeWait(list) {
  try { localStorage.setItem(WAIT_KEY, JSON.stringify(list.slice(-100))); } catch (e) { /* нет места */ }
}
const isWaiting = (id) => readWait().some((x) => x.id === id);
const priceOf = (p) => (p && p.retail_price != null && p.retail_price !== '' ? Number(p.retail_price) : 0);

/* Кнопка «Сообщите, когда появится» — только у покупателя и только когда
 * товара нет: в остальных случаях она бессмысленна и только мешает. */
export function syncWaitButton(p) {
  const b = $('btnWait');
  if (!b || !p) return;
  const out = stockState(p, null) === 'out';
  b.hidden = !!state.session || !out;
  b.textContent = isWaiting(p.id) ? 'Не сообщать об этом товаре' : 'Сообщить, когда появится';
}

function toggleWait(p) {
  if (!p) return;
  const list = readWait();
  const i = list.findIndex((x) => x.id === p.id);
  if (i >= 0) { list.splice(i, 1); writeWait(list); toast('Больше не слежу за этим товаром'); }
  else {
    list.push({ id: p.id, name: p.name || '', code: p.code || '', at: todayISO() });
    writeWait(list);
    toast('Хорошо! Скажу, когда он снова появится');
  }
  syncWaitButton(p);
}

/* ── Что изменилось с прошлого захода ─────────────────────────────────── */
export async function checkGuestNews() {
  if (state.session || !state.products.length) { hideBanner(); return; }
  const now = {};
  for (const p of state.products) { const v = priceOf(p); if (v) now[p.id] = v; }

  let snap = null;
  try { snap = await idbGet(SNAP_KEY); } catch (e) { snap = null; }
  const fresh = snap && snap.prices && snap.at
    && (Date.now() - new Date(snap.at).getTime()) < SNAP_DAYS * 86400000;

  news.cheaper = [];
  if (fresh) {
    for (const p of state.products) {
      const was = snap.prices[p.id];
      const is = now[p.id];
      if (!was || !is || is >= was) continue;
      const diff = was - is;
      if (diff < DROP_MIN_RUB || (diff / was) * 100 < DROP_MIN_PCT) continue;
      news.cheaper.push({ p, was, is });
    }
    news.cheaper.sort((a, b) => (b.was - b.is) / b.was - (a.was - a.is) / a.was);
  }

  // то, чего человек ждал, снова в продаже
  const wait = readWait();
  news.appeared = [];
  if (wait.length) {
    const left = [];
    for (const w of wait) {
      const p = state.products.find((x) => x.id === w.id);
      if (p && stockState(p, null) !== 'out') news.appeared.push({ p });
      else left.push(w);
    }
    if (news.appeared.length) writeWait(left);   // сказали один раз — больше не напоминаем
  }

  // новинки: что появилось в каталоге за две недели
  const from = daysAgoISO(NEW_DAYS);
  const added = state.products.filter((p) => String(p.created_at || '').slice(0, 10) >= from);
  news.fresh = (added.length && added.length <= state.products.length * NEW_MAX_SHARE)
    ? added.sort((a, b) => String(b.created_at || '').localeCompare(String(a.created_at || ''))).slice(0, 40)
    : [];

  if (!fresh) { try { await idbSet(SNAP_KEY, { at: new Date().toISOString(), prices: now }); } catch (e) { /* не влезло */ } }
  renderNewsBanner();
}

function hideBanner() { const el = $('newsBanner'); if (el) el.hidden = true; }

function renderNewsBanner() {
  const el = $('newsBanner');
  if (!el) return;
  const parts = [];
  if (news.appeared.length) {
    parts.push(`Появилось: ${esc(news.appeared.slice(0, 2).map((x) => x.p.name).join(', '))}`
      + (news.appeared.length > 2 ? ` и ещё ${news.appeared.length - 2}` : ''));
  }
  if (news.cheaper.length) {
    parts.push(`подешевело ${news.cheaper.length} ${plural(news.cheaper.length, 'товар', 'товара', 'товаров')}`);
  }
  /* Новинки есть почти всегда, и если каждый раз показывать плашку, она
   * примелькается и её перестанут замечать. Поэтому ради одних новинок
   * напоминаем не чаще раза в день; появление ожидаемого товара или снижение
   * цены — новость сама по себе и показывается всегда. */
  let seen = '';
  try { seen = localStorage.getItem(SEEN_KEY) || ''; } catch (e) { seen = ''; }
  if (news.fresh.length >= 3 && (parts.length || seen !== todayISO())) {
    parts.push(`${news.fresh.length} ${plural(news.fresh.length, 'новинка', 'новинки', 'новинок')}`);
  }
  if (!parts.length) { el.hidden = true; return; }
  el.innerHTML = `${parts.join(' · ')} <span class="banner-go">Посмотреть ›</span>`;
  el.hidden = false;
}

function openNews() {
  const box = $('newsBody');
  if (!box) return;
  // посмотрел — сегодня про новинки больше не напоминаем
  try { localStorage.setItem(SEEN_KEY, todayISO()); } catch (e) { /* приватный режим */ }
  const row = (p, extra) => `<button class="ios-row ios-row-link" data-news-open="${esc(p.id)}">
    <span class="ios-row-title">${esc(p.name)}${extra ? `<span class="ord-sub">${extra}</span>` : ''}</span>
    <span class="ios-row-value">${esc(fmtRetail(p))}</span></button>`;
  box.innerHTML = `
    ${news.appeared.length ? `<div class="ios-group-title">Снова в продаже</div>
      <div class="ios-group">${news.appeared.map((x) => row(x.p, 'ты просил сообщить')).join('')}</div>` : ''}
    ${news.cheaper.length ? `<div class="ios-group-title">Подешевело</div>
      <div class="ios-group">${news.cheaper.slice(0, 40).map((x) => row(x.p, `было ${fmtPrice(x.was)}`)).join('')}</div>` : ''}
    ${news.fresh.length ? `<div class="ios-group-title">Новое в магазине</div>
      <div class="ios-group">${news.fresh.map((p) => row(p, p.arrival_at ? `завоз ${esc(fmtDateSafe(p.arrival_at))}` : '')).join('')}</div>` : ''}
    <p class="ios-note">Сравнение с ценами, которые были при твоём прошлом заходе. Считает сам
    телефон — ничего никуда не отправляется.</p>`;
  openSheet('newsSheet');
}

/* openProduct приходит доводом, а не импортом: карточка товара уже знает про
 * этот модуль (кнопка «сообщить, когда появится»), и встречный импорт замкнул
 * бы их друг на друга. */
export function bindNews(openProduct) {
  ui.checkGuestNews = checkGuestNews;
  $('newsBanner').addEventListener('click', openNews);
  $('btnWait').addEventListener('click', () => toggleWait(ui.currentProduct));
  $('newsBody').addEventListener('click', (e) => {
    const b = e.target.closest('[data-news-open]');
    if (!b) return;
    closeSheet('newsSheet');
    const p = state.products.find((x) => x.id === b.dataset.newsOpen);
    if (p) openProduct(p);
  });
}

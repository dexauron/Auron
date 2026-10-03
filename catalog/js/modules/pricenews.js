/* Изменения цен — ОДИН экран вместо трёх мест
 *
 * Раньше «Стало дешевле» и «Подорожало» висели двумя списками прямо на
 * главном экране: человек заходил в каталог и первым делом упирался в них,
 * а сам каталог начинался ниже. Плюс у «Подорожало» было ещё своё окно во
 * вкладке «Работа». Владелец решил иначе: главный экран чистый, а весь
 * список — отдельным экраном, куда заходят из «Фильтров».
 *
 * Здесь всё, что про этот экран: что считается новостью, поиск по списку и
 * отрисовка. Сами расчёты не дублируются — «подешевело» берётся из снимка
 * цен (news.js), «подорожало» из pricerise.js.
 */

import { $, state, ui } from './store.js';
import { closeSheet, esc, norm, openSheet } from './core.js';
import { fmtDate, fmtPrice } from './catalog.js';
import { plural } from './competitors.js';
import { risenAll, risenReady, risenSoon } from './pricerise.js';

const PAGE = 60;            // столько строк рисуем за раз, дальше — «Показать ещё»
let dir = 'down';           // какая половина открыта: down — подешевело, up — подорожало
let query = '';
let limit = PAGE;

/* ── Что подешевело ────────────────────────────────────────────────────────
 * Снимок цен живёт до недели (news.js), поэтому «сегодня» мы не обещаем:
 * говорим, с ценами какого дня сравниваем. */
function cheaperList() {
  const was = state.priceWas || {};
  const at = state.priceWasAt || '';
  const out = [];
  for (const p of state.products) {
    const w = Number(was[p.id]); const n = Number(p.retail_price);
    if (w > 0 && n > 0 && w > n) out.push({ p, what: 'ценник', was: w, is: n, at, down: true });
  }
  // сверху та, где выгода больше в рублях: она и решает
  out.sort((a, b) => (b.was - b.is) - (a.was - a.is));
  return out;
}

/* ── Что подорожало ───────────────────────────────────────────────────────
 * Берём ту цену, по которой товар попал наверх, — ценник или закупку, — и
 * подписываем её. Без подписи непонятно, перепечатывать ценник или звонить
 * поставщику. */
function risenRows() {
  return risenAll().map((r) => {
    const main = (r.cost && r.cost.pct >= (r.retail ? r.retail.pct : 0)) ? r.cost : r.retail;
    if (!main) return null;
    /* Предупреждение прямо в строке. Раньше оно жило в отдельном окне
       «Подорожало»; окна больше нет, а новость эта — самая важная из всех,
       и ради неё не должно приходиться открывать каждый товар. */
    let note = '';
    if (r.squeeze && r.squeeze.loss != null) note = `продаём в минус ${fmtPrice(r.squeeze.loss)}`;
    else if (r.squeeze) note = `наценка ${r.squeeze.wasPct}% → ${r.squeeze.isPct}%`;
    return { p: r.p, what: main === r.cost ? 'закупка' : 'ценник', was: main.was, is: main.is, at: main.at, down: false, note };
  }).filter(Boolean);
}

function listFor(d) {
  // «Подорожало» считается только для вошедших: покупателю это не новость магазина
  if (d === 'up') return state.session ? risenRows() : [];
  return cheaperList();
}

/* Поиск внутри списка: по названию и по коду, как в самом каталоге —
 * в списке на несколько сотен строк иначе ничего не найти. */
function match(row, q) {
  if (!q) return true;
  const hay = norm(row.p.name) + ' ' + norm(row.p.code || '');
  return q.split(/\s+/).filter(Boolean).every((w) => hay.includes(w));
}

function rowHtml(r) {
  const cls = r.down ? 'pn-down' : 'pn-up';
  const when = r.at ? fmtDate(r.at) : '';
  const sub = [r.what, when].filter(Boolean).join(' · ');
  const loss = /в минус/.test(r.note);
  return `<button class="pn-row" data-pn-open="${esc(r.p.id)}">
    <span class="pn-main">
      <span class="pn-name">${esc(r.p.name)}</span>
      <span class="pn-sub">${esc(sub)}</span>
      ${r.note ? `<span class="pn-note${loss ? ' pn-loss' : ''}">${esc(r.note)}</span>` : ''}
    </span>
    <span class="pn-price ${cls}">${esc(fmtPrice(r.is))}
      <span class="pn-was">${esc(fmtPrice(r.was))}</span></span>
  </button>`;
}

function render() {
  const box = $('priceNewsBody');
  if (!box) return;
  const seg = $('priceNewsSeg');
  if (seg) for (const b of seg.querySelectorAll('[data-dir]')) b.classList.toggle('active', b.dataset.dir === dir);
  const upBtn = seg && seg.querySelector('[data-dir="up"]');
  if (upBtn) upBtn.hidden = !state.session;      // покупателю половины «подорожало» нет

  const all = listFor(dir);
  const q = norm(query);
  const list = q ? all.filter((r) => match(r, q)) : all;

  const since = $('priceNewsSince');
  if (since) {
    const at = dir === 'down' ? state.priceWasAt : '';
    since.textContent = at ? `сравниваем с ценами на ${fmtDate(at)}` : '';
    since.hidden = !since.textContent;
  }

  if (!list.length) {
    box.innerHTML = `<p class="ios-note">${q
      ? 'В этом списке ничего не нашлось. Попробуй другое слово.'
      : (dir === 'down' ? 'Пока ничего не подешевело.' : 'За месяц цены не поднимались.')}</p>`;
    return;
  }
  const shown = list.slice(0, limit);
  box.innerHTML = `<div class="pn-total">${list.length} ${plural(list.length, 'товар', 'товара', 'товаров')}</div>
    <div class="pn-list">${shown.map(rowHtml).join('')}</div>
    ${list.length > shown.length
    ? `<button class="btn btn-secondary btn-block pn-more" id="priceNewsMore">Показать ещё ${Math.min(PAGE, list.length - shown.length)}</button>`
    : ''}`;
}

function openPriceNews(d) {
  dir = (d === 'up' && state.session) ? 'up' : 'down';
  query = ''; limit = PAGE;
  const inp = $('priceNewsQuery');
  if (inp) inp.value = '';
  render();
  openSheet('priceNewsSheet');
}

/* Вход в «Фильтрах»: две строки с числами. Строка показывается, только когда
 * есть о чём говорить — пустых пунктов в меню быть не должно. */
function renderPriceNewsEntry() {
  const wrap = $('priceNewsEntry');
  if (!wrap) return;
  const down = listFor('down').length;
  /* Подорожавшие считаем, только если ответ уже готов. Иначе просим посчитать
     в свободную минуту и перерисовать строку: прямой вызов отсюда замедлял
     каждую перерисовку главного экрана втрое. */
  let up = 0;
  if (state.session) {
    if (risenReady()) up = listFor('up').length;
    else risenSoon(renderPriceNewsEntry);
  }
  const set = (id, valId, n) => {
    const b = $(id); const v = $(valId);
    if (!b) return;
    b.hidden = !n;
    if (v) v.textContent = n ? `${n} ${plural(n, 'товар', 'товара', 'товаров')}` : '';
  };
  set('openCheaper', 'openCheaperVal', down);
  set('openRisen', 'openRisenVal', up);
  wrap.hidden = !down && !up;
}

export function bindPriceNews(openProductFn) {
  ui.openPriceNews = openPriceNews;
  ui.renderPriceNewsEntry = renderPriceNewsEntry;
  const ch = $('openCheaper');
  if (ch) ch.addEventListener('click', () => { closeSheet('filterSheet'); openPriceNews('down'); });
  const ri = $('openRisen');
  if (ri) ri.addEventListener('click', () => { closeSheet('filterSheet'); openPriceNews('up'); });
  const seg = $('priceNewsSeg');
  if (seg) seg.addEventListener('click', (e) => {
    const b = e.target.closest('[data-dir]');
    if (!b) return;
    dir = b.dataset.dir; limit = PAGE;
    render();
  });
  const inp = $('priceNewsQuery');
  if (inp) inp.addEventListener('input', () => { query = inp.value || ''; limit = PAGE; render(); });
  const box = $('priceNewsBody');
  if (box) box.addEventListener('click', (e) => {
    if (e.target.closest('#priceNewsMore')) { limit += PAGE; render(); return; }
    const b = e.target.closest('[data-pn-open]');
    if (!b) return;
    // карточка товара показывает и историю цен — отдельно её тут не повторяем
    closeSheet('priceNewsSheet');
    const p = state.products.find((x) => x.id === b.dataset.pnOpen);
    if (p && openProductFn) openProductFn(p);
  });
}

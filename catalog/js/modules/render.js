// Отрисовка: сетка, разделы, фильтры, ленты

import { $, PAGE_SIZE, state, ui } from './store.js';
import { esc, expectPop, groupById, highlight, openSheet, supplierById, moneyText } from './core.js';
import { CATEGORIES, OTHER_CAT, ic } from './icons.js';
import { QUICK, catGroupPredicate, catIcon, catalogSections, categoryOf, daysAgoISO, fmtDate, fmtRetail, isTopSeller, nameNoPack, packText, productCategory, queryHlTokens, todayISO, visibleProducts, fmtPrice } from './catalog.js';
import { trackSearch } from './device.js';
import { stockState } from './publish.js';
import { plural } from './competitors.js';
import { wolfEmpty } from './mascot.js';
import { ratingText } from './reviews.js';

/* ── Отрисовка ────────────────────────────────── */

/* ── Разделы нижней панели ──────────────────────────
 * «Каталог» — сетка товаров, «Категории» — плитки разделов, «Избранное» —
 * отмеченные сердечком, «Ещё» — меню/вход. Так устроено любое продуктовое
 * приложение: разделы внизу, под большим пальцем, а не спрятаны в фильтре.
 * Категории у нас уже есть (CATEGORIES) — раньше они были доступны только
 * через кнопку фильтра, и с главной страницы каталог не «просматривался». */

// Наличие словами — по живому числу остатка, которое есть только у вошедшего.
/* Метка наличия видна ВСЕМ, включая покупателя: «есть / мало / нет» — это то
 * же, что человек и так увидит, дойдя до полки, зато экономит ему дорогу.
 * Число остатка при этом остаётся внутренним и показывается только своим. */
export function stockLabel(p) {
  const st = stockState(p, null);
  if (st === 'in') return { txt: `${ic('check', 'ic-xs')} Есть в магазине`, cls: 'tag-instock', short: 'Есть' };
  if (st === 'low') return { txt: 'Заканчивается', cls: 'tag-lowstock', short: 'Мало' };
  if (st === 'out') return { txt: 'Нет в наличии', cls: 'tag-outstock', short: 'Нет' };
  return null;
}

// «похоже на адрес почты»: собака, точка после неё и никаких пробелов
const looksLikeEmail = (q) => /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(String(q || '').trim());

export function switchTab(tab) {
  // «Фильтры» — не раздел, а окно: нижняя панель даёт до них дотянуться большим
  // пальцем. Меню и настройки устройства переехали на кнопку человечка в шапке.
  if (tab === 'filters') { syncControls(); openSheet('filterSheet'); return; }
  state.tab = tab;
  if (tab === 'fav') { state.favOnly = true; state.selCats = []; }
  else if (state.favOnly) state.favOnly = false;
  if (tab !== 'catalog') { state.query = ''; $('searchInput').value = ''; }
  state.renderLimit = PAGE_SIZE;
  window.scrollTo({ top: 0 });
  renderAll();
}

function syncTabs() {
  for (const b of document.querySelectorAll('.tabbar .tab')) {
    b.classList.toggle('active', b.dataset.tab === state.tab);
  }
  const n = favorites().length;
  const badge = $('tabFavCount');
  if (badge) { badge.textContent = n > 99 ? '99+' : n; badge.hidden = !n; }
  // «Работа»: сколько дел ждёт. Через ui, а не импортом — иначе модули
  // сетки и рабочих списков ссылались бы друг на друга по кругу.
  if (ui.renderWorkBadge) ui.renderWorkBadge();
  // экран категорий и сетка товаров не показываются одновременно
  const cats = state.tab === 'cats';
  $('catScreen').hidden = !cats;
  $('productGrid').hidden = cats;
  if (cats) { $('emptyState').hidden = true; $('loader').hidden = true; }
}

// Плитки категорий: иконка, название и сколько товаров. Пустые не показываем —
// тыкать в раздел, где ничего нет, обидно.
/* Два уровня: сначала 13 понятных категорий плитками, внутри — настоящие
 * группы из 1С, которые в эту категорию попали. Групп в базе больше двухсот,
 * простым списком их не просмотреть; разложенные по категориям — можно.
 * Товар ищется либо поиском, либо этими двумя тапами. */

function catCounts() {
  const cats = {}; const groupsIn = {};
  for (const p of state.products) {
    const c = productCategory(p) || OTHER_CAT.name;
    cats[c] = (cats[c] || 0) + 1;
    const g = p.group_id || 'none';
    (groupsIn[c] = groupsIn[c] || {})[g] = (groupsIn[c][g] || 0) + 1;
  }
  return { cats, groupsIn };
}

export function renderCatScreen() {
  const box = $('catScreen');
  if (!box || state.tab !== 'cats') return;
  const { cats, groupsIn } = catCounts();
  const all = catalogSections(cats);
  if (!all.length) {
    box.innerHTML = '<p class="muted cat-empty">Каталог пока пустой — категории появятся вместе с товарами.</p>';
    return;
  }
  all.sort((a, b) => cats[b.name] - cats[a.name]);

  // вторая ступень: раскрытая категория показывает свои группы
  if (ui.openCat && cats[ui.openCat]) {
    const cat = all.find((c) => c.name === ui.openCat) || OTHER_CAT;
    const list = Object.entries(groupsIn[ui.openCat] || {})
      .map(([id, n]) => ({ id, name: id === 'none' ? 'Без группы' : (groupById(id) || {}).name || 'Без названия', n }))
      .sort((a, b) => b.n - a.n);
    box.innerHTML = `
      <button class="cat-back" data-cat-back>‹ Все категории</button>
      <div class="cat-head"><span class="cat-ico">${catIcon(cat.name)}</span>
        <span><b>${esc(ui.openCat)}</b><span class="cat-count">${cats[ui.openCat]} ${plural(cats[ui.openCat], 'товар', 'товара', 'товаров')} · ${list.length} ${plural(list.length, 'группа', 'группы', 'групп')}</span></span></div>
      <button class="grp-row grp-all" data-cat-tile="${esc(ui.openCat)}">
        <span class="grp-name">Показать все</span><span class="grp-count">${cats[ui.openCat]}</span></button>
      ${list.map((g) => `<button class="grp-row" data-grp="${esc(g.id)}">
        <span class="grp-name">${esc(g.name)}</span><span class="grp-count">${g.n}</span></button>`).join('')}`;
    return;
  }

  box.innerHTML = '<div class="cat-grid">' + all.map((c) => `
    <button class="cat-tile" data-cat-open="${esc(c.name)}">
      <span class="cat-ico">${catIcon(c.name)}</span>
      <span class="cat-name">${esc(c.name)}</span>
      <span class="cat-count">${cats[c.name]} ${plural(cats[c.name], 'товар', 'товара', 'товаров')} · ${Object.keys(groupsIn[c.name] || {}).length} ${plural(Object.keys(groupsIn[c.name] || {}).length, 'группа', 'группы', 'групп')}</span>
    </button>`).join('') + '</div>';
}

export function renderGrid() {
  // поиск перерисовывает только сетку, а лента завоза при поиске не нужна
  renderArrivals();
  const list = visibleProducts();
  const grid = $('productGrid');
  $('loader').hidden = true;
  /* Покупателю каталог показывается СПИСКОМ и без фотографий (решение
     владельца): ему нужны название, код, цена, наличие и дата поступления,
     а не витрина. Сотруднику вид остаётся тот, который он выбрал. */
  const guest = !state.session;
  const view = guest ? 'list' : state.view;
  grid.classList.toggle('compact', view === 'compact');
  grid.classList.toggle('list', view === 'list');
  // с заголовками сетка перестаёт быть сеткой: колонки живут внутри разделов
  grid.classList.toggle('grouped', !!state.query && view !== 'list');
  grid.classList.remove('skeleton');
  updateResultsCount(list.length);

  if (!list.length) {
    grid.innerHTML = '';
    const empty = $('emptyState');
    empty.hidden = false;
    if (state.favOnly && !favorites().length) {
      empty.querySelector('.empty-icon').innerHTML = wolfEmpty(ic('heart'));
      empty.querySelector('.empty-title').textContent = 'В избранном пусто';
      empty.querySelector('.empty-text').textContent = 'Открой товар и нажми на сердечко — товар появится здесь';
    } else if (!state.products.length) {
      empty.querySelector('.empty-icon').innerHTML = wolfEmpty(ic('box'));
      empty.querySelector('.empty-title').textContent = 'Каталог пока пустой';
      empty.querySelector('.empty-text').textContent = state.session
        ? 'Нажми внизу, чтобы добавить первый товар'
        : 'Администратор скоро его заполнит';
    } else if (looksLikeEmail(state.query)) {
      // Браузер иногда сам подставляет в поиск сохранённый адрес почты.
      // В каталоге почты нет и быть не может, поэтому не отправляем человека
      // «искать по-другому», а прямо говорим, что случилось.
      empty.querySelector('.empty-icon').innerHTML = wolfEmpty(ic('search'));
      empty.querySelector('.empty-title').textContent = 'Это адрес почты';
      empty.querySelector('.empty-text').textContent = 'Похоже, браузер подставил его сам. В каталоге почты нет — очисти поиск и введи название или код.';
    } else {
      empty.querySelector('.empty-icon').innerHTML = wolfEmpty(ic('search'));
      empty.querySelector('.empty-title').textContent = 'Ничего не нашлось';
      /* «Снимите фильтры» человеку, который просто искал словом, — совет ни о
         чём: никаких фильтров он не включал. Отвечаем по тому, что он сделал. */
      empty.querySelector('.empty-text').textContent = filtersBesidesQuery()
        ? 'Под выбранные фильтры товаров нет. Снимите часть фильтров.'
        : 'Попробуй написать по-другому или выбери группу';
    }
    /* Когда пусто из-за фильтров или поиска — предлагаем сбросить одним
       касанием. Пустое избранное сюда не относится: сбрасывать там нечего,
       а кнопка «Сбросить фильтры» просто уводила с раздела. */
    $('emptyReset').hidden = !(anyFilterActive() && state.products.length);
    /* Покупатель искал товар и не нашёл. Раньше он на этом просто уходил, и
       магазин об этом не узнавал. Теперь предлагаем спросить — заодно владелец
       увидит, чего людям не хватает. */
    const ask = $('emptyAsk');
    if (ask) ask.hidden = !(!state.session && state.query && state.query.trim().length > 1);
    // Ничего не нашлось — значит и показывать нечего: чистим сетку и убираем
    // кнопку «Показать ещё» от прошлого показа. Без этого экран говорил
    // «Ничего не нашлось» и тут же предлагал «Показать ещё (осталось 17795)».
    grid.innerHTML = '';
    document.querySelectorAll('.load-more').forEach((b) => b.remove());
    return;
  }

  $('emptyState').hidden = true;
  // на больших каталогах рисуем страницами — телефон не потянет 15 000 карточек разом
  const shown = list.slice(0, state.renderLimit);
  const hlTokens = queryHlTokens();
  // При поиске раскладываем найденное по категориям с заголовками: «Молочное 4»,
  // «Сладости 2». Плоская простыня из шестидесяти карточек читается хуже, чем
  // те же карточки, разложенные по полкам. Только при поиске: когда листаешь
  // каталог целиком, заголовки мешают. В режиме списка тоже не делим — он и
  // так плотный, а сотруднику там нужен код, а не раскладка.
  const grouped = !!state.query && view !== 'list';
  const catOf = (p) => productCategory(p) || OTHER_CAT.name;
  const catIconOf = (n) => catIcon(n);
  const cards = shown.map((p) => {
    const photo = (p.photos || []).find((u) => u && String(u).trim());
    const img = photo
      ? `<img src="${esc(photo)}" alt="" loading="lazy" onerror="wmImgFail(this)">`
      : ic('box', 'ic-ph');
    const photoCls = photo ? 'card-photo' : 'card-photo no-photo';
    // минимализм: на плитке только код и, если весовой, значок — остальное в карточке
    const tags = [];
    const sl = stockLabel(p);
    if (sl && sl.cls !== 'tag-instock') tags.push(`<span class="tag ${sl.cls}">${sl.short}</span>`);
    if (p.is_weighted) tags.push(`<span class="tag">${ic('scale', 'ic-xs')}</span>`);
    /* «Часто берут» — только покупателю: сотруднику ходовые товары показывает
       отдельный экран с цифрами, а в рабочем списке это лишний шум. */
    if (!state.session && isTopSeller(p)) tags.push('<span class="tag tag-hit">Часто берут</span>');
    // оценка соседей — покупателю: по ней он и выбирает между двумя похожими
    if (!state.session) { const rt = ratingText(p); if (rt) tags.push(`<span class="tag tag-rating">${ic('star', 'ic-xs')} ${esc(rt)}</span>`); }
    // «без ШК» — служебная пометка для кассы (пробивать по коду). Покупателю
    // она ничего не говорит, поэтому показываем только своим.
    if (state.session && !(p.barcodes || []).length) tags.push('<span class="tag tag-nobarcode">без ШК</span>');
    /* Прежняя цена зачёркнутой и выгода рядом — приём из индийского Zepto:
       экономия читается за долю секунды, без единого нажатия. По решению
       владельца видно всем: сотрудника у полки спрашивают именно об этом,
       а владельцу видно, что его правка цены доехала. */
    const was = Number((state.priceWas || {})[p.id]);
    const now = Number(p.retail_price);
    const drop = (was > 0 && now > 0 && was > now)
      ? `<span class="card-was">${esc(fmtPrice(was))}</span><span class="card-drop">−${esc(fmtPrice(was - now))}</span>` : '';
    const price = (p.retail_price != null && p.retail_price !== '')
      ? `<div class="card-price${drop ? ' has-drop' : ''}">${esc(fmtRetail(p))}${drop}</div>` : '';
    // Код — не метка в общей куче, а главное на плитке: ради него каталог и
    // сделан. Тап по коду копирует его, не открывая карточку: сотруднику за
    // кассой нужен именно код, а не описание товара.
    const code = p.code
      ? `<button type="button" class="card-code" data-copy-code="${esc(p.code)}" title="Скопировать код">${esc(p.code)}</button>`
      : '';
    const tagRow = tags.length ? `<div class="card-tags">${tags.join('')}</div>` : '';
    /* Фасовка отдельной серой строкой, а название — без неё: так товар
       читается с одного взгляда (приём из Zepto). При поиске оставляем
       название целиком: человек мог искать как раз по граммам. */
    const pack = !state.query ? packText(p) : '';
    if (view === 'list') {
      // покупателю важно, свежий ли завоз — показываем дату прямо в строке
      const arrived = guest && p.arrival_at
        ? `<span class="row-arrived">завоз ${esc(fmtDate(p.arrival_at))}</span>` : '';
      /* Фасовка отдельной серой строкой, а название — без неё: так товар
         читается с одного взгляда (приём из Zepto). При поиске подсвечиваем
         полное название: человек мог искать как раз по граммам. */
      const title = pack ? nameNoPack(p) : p.name;
      return `<article class="card card-row" data-id="${esc(p.id)}">
        <div class="row-main">
          <div class="card-name">${highlight(title, hlTokens)}</div>
          ${pack ? `<div class="row-pack">${esc(pack)}</div>` : ''}
          <div class="row-sub">${price}${tagRow}${arrived}</div>
        </div>
        ${code}
      </article>`;
    }
    return `<article class="card" data-id="${esc(p.id)}">
      <div class="${photoCls}">${img}</div>
      <div class="card-body">
        <div class="card-name">${highlight(pack ? nameNoPack(p) : p.name, hlTokens)}</div>
        ${pack ? `<div class="row-pack">${esc(pack)}</div>` : ''}
        ${code}
        ${price}
        ${tagRow}
      </div>
    </article>`;
  });
  let html = cards.join('');
  if (grouped) {
    const order = []; const buckets = new Map();
    shown.forEach((p, i) => {
      const c = catOf(p);
      if (!buckets.has(c)) { buckets.set(c, []); order.push(c); }
      buckets.get(c).push(cards[i]);
    });
    // одна категория на весь результат — заголовок ничего не делит, не рисуем
    if (order.length > 1) {
      html = order.map((c) => `<div class="cat-sep">${catIconOf(c)} ${esc(c)}<span class="cat-sep-n">${buckets.get(c).length}</span></div>`
        + `<div class="cat-part">${buckets.get(c).join('')}</div>`).join('');
    }
  }
  grid.innerHTML = html;
  document.querySelectorAll('.load-more').forEach((b) => b.remove());
  if (list.length > shown.length) {
    const btn = document.createElement('button');
    btn.className = 'btn btn-secondary load-more';
    btn.textContent = `Показать ещё (осталось ${list.length - shown.length})`;
    btn.addEventListener('click', () => {
      state.renderLimit += 200;
      renderGrid();
    });
    grid.after(btn);
  }
}

// мерцающие плитки-заглушки, пока каталог грузится (вместо пустого экрана)
export function showSkeleton() {
  const grid = $('productGrid');
  if (grid.children.length) return; // уже что-то показано (кэш)
  $('loader').hidden = true;
  grid.classList.remove('compact');
  grid.classList.add('skeleton');
  grid.innerHTML = Array.from({ length: 12 }, () =>
    '<div class="card"><div class="sk-photo"></div><div class="sk-line"></div><div class="sk-line short"></div></div>').join('');
}

// товары после фильтров по категориям/группам/поставщикам (без быстрых фильтров,
// цены и поиска) — основа для подсчёта в быстрых фильтрах
function baseFiltered() {
  const { selCats, selGroups, selSuppliers } = state;
  let list = state.products;
  if (selCats.length || selGroups.length) {
    list = list.filter(catGroupPredicate());
  }
  if (selSuppliers.length) list = list.filter((p) => (p.supplier_ids || []).some((id) => selSuppliers.includes(id)));
  return list;
}

// admin: фильтры «чего не хватает в каталоге» — это работа над самим каталогом,
// сотруднику в зале они не нужны и только занимают место
const QUICK_CHIPS = [
  { k: 'withprice', label: 'С ценой' },
  { k: 'barcode', label: 'Штрихкод' },
  { k: 'nophoto', label: 'Без фото', warn: true, admin: true },
  { k: 'noprice', label: 'Без цены', warn: true, admin: true },
  { k: 'nobarcode', label: 'Без ШК', warn: true, admin: true },
];

// Категории списком-чекбоксами в окне фильтра (как в референсе)
// какие категории раскрыты в дереве фильтра (показывают свои подкатегории)
export const filterCatOpen = new Set();
export function renderFilterCats() {
  const box = $('filterCats');
  if (!box) return;
  // товаров в категории и в каждой подгруппе; подгруппы, отнесённые к категории
  const counts = {};
  const groupCounts = {};
  const subsByCat = {};
  for (const g of state.groups) {
    const c = categoryOf(g.name) || OTHER_CAT.name;
    (subsByCat[c] = subsByCat[c] || []).push(g);
  }
  for (const p of state.products) {
    const c = productCategory(p); if (c) counts[c] = (counts[c] || 0) + 1;
    if (p.group_id) groupCounts[p.group_id] = (groupCounts[p.group_id] || 0) + 1;
  }
  const cats = catalogSections(counts).map((c) => c.name).sort((a, b) => counts[b] - counts[a]);
  if (!cats.length) { box.innerHTML = '<p class="muted" style="margin:0">Категорий пока нет</p>'; return; }
  box.innerHTML = cats.map((c) => {
    const on = state.selCats.includes(c);
    const subs = (subsByCat[c] || []).filter((g) => groupCounts[g.id]).sort((a, b) => groupCounts[b.id] - groupCounts[a.id]);
    const expanded = filterCatOpen.has(c);
    const caret = subs.length
      ? `<button type="button" class="tree-caret${expanded ? ' open' : ''}" data-tcat="${esc(c)}" aria-label="Показать подкатегории">▸</button>`
      : '<span class="tree-caret-empty"></span>';
    let html = `<div class="tree-cat">${caret}`
      + `<label class="tree-cat-label"><input type="checkbox" class="check-cb" data-fcat="${esc(c)}"${on ? ' checked' : ''}>`
      + `<span class="check-text">${catIcon(c)} ${esc(c)}</span><span class="check-count">${counts[c]}</span></label></div>`;
    if (subs.length && expanded) {
      html += '<div class="tree-subs">' + subs.map((g) => {
        const gon = state.selGroups.includes(g.id);
        return `<label class="tree-sub"><input type="checkbox" class="check-cb" data-fgroup="${esc(g.id)}"${gon ? ' checked' : ''}>`
          + `<span class="check-text">${esc(g.name)}</span><span class="check-count">${groupCounts[g.id]}</span></label>`;
      }).join('') + '</div>';
    }
    return html;
  }).join('');
}

function renderQuick() {
  const base = baseFiltered();
  let html = '';
  for (const c of QUICK_CHIPS) {
    if (c.admin && !state.isAdmin) continue;
    const cnt = base.reduce((n, p) => n + (QUICK[c.k](p) ? 1 : 0), 0);
    if (!cnt && !state.quick.includes(c.k)) continue; // нечего показывать
    const active = state.quick.includes(c.k) ? ' active' : '';
    const warn = c.warn ? ' warn' : '';
    html += `<button class="chip chip-quick${warn}${active}" data-quick="${c.k}">${c.label}<span class="chip-count">${cnt}</span></button>`;
  }
  $('quickChips').innerHTML = html;
}

// сколько «фильтров» активно (для значка на кнопке «Фильтры»)
export function countActiveFilters() {
  return state.quick.length + state.selCats.length + state.selGroups.length
    + state.selSuppliers.length + ((state.priceMin != null || state.priceMax != null) ? 1 : 0)
    + (state.selType ? 1 : 0) + ((state.arrivalFrom || state.arrivalTo) ? 1 : 0);
}

function updateResultsCount(n) {
  const ap = $('filterApply');
  if (ap) ap.textContent = `Показать ${n}`;
}

// синхронизирует окно фильтров и значок с состоянием
export function syncControls() {
  renderFilterCats();
  { const ff = $('filterFav'); if (ff) ff.checked = !!state.favOnly; }
  document.querySelectorAll('#sortSeg button').forEach((b) => b.classList.toggle('active', b.dataset.sort === state.sort));
  document.querySelectorAll('#typeSeg button').forEach((b) => b.classList.toggle('active', b.dataset.type === state.selType));
  // даты поступления в поля + подсветка активного пресета
  const af = $('arrivalFrom'); const at = $('arrivalTo');
  if (af && document.activeElement !== af) af.value = state.arrivalFrom || '';
  if (at && document.activeElement !== at) at.value = state.arrivalTo || '';
  document.querySelectorAll('#arrivalPresets [data-days]').forEach((b) => {
    const from = daysAgoISO(Number(b.dataset.days));
    b.classList.toggle('active', state.arrivalTo === todayISO() && state.arrivalFrom === from);
  });
  const pmin = $('priceMin'); const pmax = $('priceMax');
  // возвращаем в поля читаемый вид: «100 000», а не «100000»
  if (pmin && document.activeElement !== pmin) pmin.value = state.priceMin != null ? moneyText(String(state.priceMin)) : '';
  if (pmax && document.activeElement !== pmax) pmax.value = state.priceMax != null ? moneyText(String(state.priceMax)) : '';
  document.querySelectorAll('#pricePresets [data-pmin]').forEach((b) => {
    const mn = b.dataset.pmin === '' ? null : Number(b.dataset.pmin);
    const mx = b.dataset.pmax === '' ? null : Number(b.dataset.pmax);
    b.classList.toggle('active', state.priceMin === mn && state.priceMax === mx);
  });
  // разделы для сотрудников/закупок показываем по роли
  document.querySelectorAll('.emp-only').forEach((el) => { el.hidden = !state.session; });
  /* То, что видит только покупатель (связь с магазином, подсказка о цене).
     ВАЖНО: этот класс — для того, что просто «есть у покупателя и нет у
     сотрудника». Плашкам со своей логикой показа (что нового, «спросить в
     магазине») его вешать нельзя: иначе они показываются всегда, даже
     пустыми — так на экране однажды повисла пустая белая полоса. */
  document.querySelectorAll('.guest-only').forEach((el) => { el.hidden = !!state.session; });
  if (ui.applyGuestMode) ui.applyGuestMode();   // класс «покупатель» на странице
  if (ui.renderShopBar) ui.renderShopBar();     // полоска «сколько выйдет»
  document.querySelectorAll('.purchase-only').forEach((el) => { el.hidden = !state.canPurchase; });
  // подписи кнопок «Группы» и «Поставщики» — со счётчиком выбранного
  const gBtn = $('filterGroupsBtn');
  if (gBtn) {
    const gn = state.selGroups.filter((x) => x !== 'none' && x !== 'weighted').length + state.selCats.length;
    gBtn.textContent = gn ? `Группы: выбрано ${gn}` : 'Выбрать группы…';
    gBtn.classList.toggle('picked', gn > 0);
  }
  const sVal = $('filterSuppliersVal');
  if (sVal) sVal.textContent = state.selSuppliers.length ? `Выбрано: ${state.selSuppliers.length}` : 'Все';
  const n = countActiveFilters();
  // Кнопки фильтра в шапке больше нет (решение владельца 29.08): вход остался
  // один — вкладкой снизу, где её и ищут большим пальцем. Значок с числом
  // включённых фильтров живёт теперь только на вкладке.
  // тот же счётчик на вкладке «Фильтры» — видно, что фильтр включён,
  // даже когда шапка ушла вверх при прокрутке
  const tb = $('tabFilterCount');
  if (tb) { tb.hidden = !n; tb.textContent = n || ''; }
}

const QUICK_LABEL = { withprice: 'С ценой', barcode: 'Штрихкод', nophoto: 'Без фото', noprice: 'Без цены', nobarcode: 'Без ШК' };

// Плашки активных фильтров на главном экране: видно, что включено, и каждый
// можно снять по ✕ — не открывая окно фильтров. Универсально и удобно.
export function renderActiveFilters() {
  const box = $('activeFilters');
  if (!box) return;
  const items = [];
  if (state.query) items.push(['q', '', `«${state.query}»`]);
  for (const c of state.selCats) items.push(['cat', c, c]);
  for (const gid of state.selGroups) {
    const label = gid === 'none' ? 'Без группы' : gid === 'weighted' ? 'Весовые' : (groupById(gid)?.name || 'Группа');
    items.push(['group', gid, label]);
  }
  for (const sid of state.selSuppliers) items.push(['sup', sid, '' + (supplierById(sid)?.name || 'Поставщик')]);
  if (state.selType) items.push(['type', '', state.selType === 'weighted' ? 'Весовые' : 'Штучные']);
  if (state.arrivalFrom || state.arrivalTo) {
    const f = state.arrivalFrom ? fmtDate(state.arrivalFrom) : '…';
    const t = state.arrivalTo ? fmtDate(state.arrivalTo) : '…';
    items.push(['arrival', '', `${f}–${t}`]);
  }
  if (state.priceMin != null || state.priceMax != null) {
    const m = (n) => fmtPrice(n).replace(' ₽', '');
    const lbl = state.priceMin != null && state.priceMax != null ? `${m(state.priceMin)}–${fmtPrice(state.priceMax)}`
      : state.priceMin != null ? `от ${fmtPrice(state.priceMin)}` : `до ${fmtPrice(state.priceMax)}`;
    items.push(['price', '', lbl]);
  }
  for (const k of state.quick) items.push(['quick', k, QUICK_LABEL[k] || k]);

  if (!items.length) { box.hidden = true; box.innerHTML = ''; return; }
  box.hidden = false;
  let html = items.map(([t, v, label]) =>
    `<button class="chip chip-active-filter" data-rm="${esc(t)}" data-val="${esc(v)}">${esc(label)}<span class="rm-x">${ic('close', 'ic-xs')}</span></button>`).join('');
  html += '<button class="chip chip-reset" data-rm="all" data-val="">Сбросить всё</button>';
  box.innerHTML = html;
}

// снять один активный фильтр
export function removeFilter(type, val) {
  switch (type) {
    case 'q': state.query = ''; { const i = $('searchInput'); if (i) i.value = ''; } $('searchClear').hidden = true; break;
    case 'cat':
      state.selCats = state.selCats.filter((x) => x !== val);
      { const ids = new Set(state.groups.filter((g) => categoryOf(g.name) === val).map((g) => g.id)); state.selGroups = state.selGroups.filter((x) => !ids.has(x)); }
      break;
    case 'group': state.selGroups = state.selGroups.filter((x) => x !== val); break;
    case 'sup': state.selSuppliers = state.selSuppliers.filter((x) => x !== val); break;
    case 'type': state.selType = ''; break;
    case 'arrival': state.arrivalFrom = ''; state.arrivalTo = ''; { const af = $('arrivalFrom'); const at = $('arrivalTo'); if (af) af.value = ''; if (at) at.value = ''; } break;
    case 'price': state.priceMin = null; state.priceMax = null; { const a = $('priceMin'); const b = $('priceMax'); if (a) a.value = ''; if (b) b.value = ''; } break;
    case 'quick': state.quick = state.quick.filter((x) => x !== val); break;
    case 'all': clearAllFilters(); return;
  }
  state.renderLimit = PAGE_SIZE;
  renderAll();
}

export function renderAll() {
  renderQuick(); renderActiveFilters(); syncControls(); saveFilters();
  syncTabs(); renderCatScreen();
  renderNewProducts();
  renderCheaper();
  renderArrivals();
  renderMyFrequent();
  if (state.tab !== 'cats') renderGrid();
}

// включён ли хоть один настоящий фильтр — поиск словом за фильтр не считаем
function filtersBesidesQuery() {
  return !!(state.quick.length || state.selCats.length
    || state.selGroups.length || state.selSuppliers.length
    || state.priceMin != null || state.priceMax != null
    || state.selType || state.arrivalFrom || state.arrivalTo);
}

// есть ли хоть один активный фильтр/поиск
function anyFilterActive() {
  return !!(state.query || state.quick.length || state.selCats.length
    || state.selGroups.length || state.selSuppliers.length
    || state.priceMin != null || state.priceMax != null
    || state.selType || state.arrivalFrom || state.arrivalTo);
}

// полный сброс всех фильтров и поиска (сортировку и вид не трогаем — это привычка)
export function clearAllFilters() {
  state.selCats = []; state.selGroups = []; state.selSuppliers = [];
  state.quick = []; state.priceMin = null; state.priceMax = null;
  state.selType = ''; state.arrivalFrom = ''; state.arrivalTo = ''; state.favOnly = false;
  const af = $('arrivalFrom'); const at = $('arrivalTo'); if (af) af.value = ''; if (at) at.value = '';
  state.query = '';
  state.renderLimit = PAGE_SIZE;
  const inp = $('searchInput'); if (inp) inp.value = '';
  const sc = $('searchClear'); if (sc) sc.hidden = true;
  const pmin = $('priceMin'); if (pmin) pmin.value = '';
  const pmax = $('priceMax'); if (pmax) pmax.value = '';
  renderAll();
}

/* ── Память фильтров, недавних запросов и темы ──── */
const FILTERS_KEY = 'wm_filters_v1';
const RECENT_KEY = 'wm_recent_q_v1';
export const THEME_KEY = 'wm_theme';

function saveFilters() {
  try {
    localStorage.setItem(FILTERS_KEY, JSON.stringify({
      selCats: state.selCats, selGroups: state.selGroups, selSuppliers: state.selSuppliers,
      quick: state.quick, sort: state.sort, view: state.view, tab: state.tab,
      priceMin: state.priceMin, priceMax: state.priceMax,
      selType: state.selType, arrivalFrom: state.arrivalFrom, arrivalTo: state.arrivalTo,
    }));
  } catch (e) { /* нет места — не критично */ }
}
export function loadFilters() {
  try {
    const f = JSON.parse(localStorage.getItem(FILTERS_KEY));
    if (!f) return;
    state.selCats = Array.isArray(f.selCats) ? f.selCats : [];
    state.selGroups = Array.isArray(f.selGroups) ? f.selGroups : [];
    state.selSuppliers = Array.isArray(f.selSuppliers) ? f.selSuppliers : [];
    state.quick = Array.isArray(f.quick) ? f.quick : [];
    if (['relevance', 'name', 'cheap', 'expensive', 'new', 'popular'].includes(f.sort)) state.sort = f.sort;
    if (['normal', 'compact', 'list'].includes(f.view)) state.view = f.view;
    if (['catalog', 'cats', 'fav'].includes(f.tab)) state.tab = f.tab;
    if (state.tab === 'fav') state.favOnly = true;
    state.priceMin = (typeof f.priceMin === 'number') ? f.priceMin : null;
    state.priceMax = (typeof f.priceMax === 'number') ? f.priceMax : null;
    if (f.selType === 'weighted' || f.selType === 'piece') state.selType = f.selType;
    const isDate = (s) => typeof s === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(s);
    if (isDate(f.arrivalFrom)) state.arrivalFrom = f.arrivalFrom;
    if (isDate(f.arrivalTo)) state.arrivalTo = f.arrivalTo;
  } catch (e) { /* игнорируем битые данные */ }
}

function recentQueries() { try { return JSON.parse(localStorage.getItem(RECENT_KEY)) || []; } catch (e) { return []; } }
export function addRecentQuery(q) {
  q = q.trim();
  if (q.length < 2) return;
  if (q.includes('@')) return; // email в подсказки поиска не пускаем (автозаполнение браузера)
  let list = recentQueries().filter((x) => x.toLowerCase() !== q.toLowerCase());
  list.unshift(q);
  list = list.slice(0, 8);
  try { localStorage.setItem(RECENT_KEY, JSON.stringify(list)); } catch (e) { /* нет места */ }
  trackSearch(q); // анонимный учёт запроса — для подсказок частых запросов
  renderRecent();
}
export function renderRecent() {
  const dl = $('recentQ');
  if (!dl) return;
  // сначала личные недавние запросы, затем частые запросы других (без повторов)
  const personal = recentQueries().filter((x) => !String(x).includes('@')); // без email
  const seen = new Set(personal.map((x) => x.toLowerCase()));
  const popular = (state.popularTerms || []).filter((t) => !seen.has(String(t).toLowerCase()));
  dl.innerHTML = [...personal, ...popular].slice(0, 14)
    .map((q) => `<option value="${esc(q)}"></option>`).join('');
}

/* ── Избранное (♥) и «Недавно смотрели» — у покупателя на телефоне ──
 * Хранятся только на устройстве (localStorage), в базу не уходят. */
const FAV_KEY = 'wm_favorites_v1';
const RECENT_PROD_KEY = 'wm_recent_products_v1';

export function favorites() { try { return JSON.parse(localStorage.getItem(FAV_KEY)) || []; } catch (e) { return []; } }
export const isFav = (id) => favorites().includes(id);
export function toggleFav(id) {
  const list = favorites();
  const i = list.indexOf(id);
  if (i >= 0) list.splice(i, 1); else list.unshift(id);
  try { localStorage.setItem(FAV_KEY, JSON.stringify(list.slice(0, 500))); } catch (e) { /* нет места */ }
  return i < 0; // true = товар стал избранным
}

function recentProducts() { try { return JSON.parse(localStorage.getItem(RECENT_PROD_KEY)) || []; } catch (e) { return []; } }
export function pushRecentProduct(id) {
  const list = recentProducts().filter((x) => x !== id);
  list.unshift(id);
  try { localStorage.setItem(RECENT_PROD_KEY, JSON.stringify(list.slice(0, 24))); } catch (e) { /* нет места */ }
}

/* ── Популярность: анонимный учёт (без личности) ──
 * Считаем на сервере, сколько раз открывали товар и что искали. Из этого —
 * раздел «Популярное» и подсказки частых запросов. Личность не сохраняется. */

// стабильный анонимный номер устройства — «якорь» памяти (избранное/просмотры
// и так живут в localStorage; номер даёт единый идентификатор на будущее)
export function deviceId() {
  let id = null;
  try { id = localStorage.getItem('wm_device_id'); } catch (e) { /* */ }
  if (!id) {
    id = (window.crypto && crypto.randomUUID) ? crypto.randomUUID()
      : String(Date.now()) + Math.random().toString(16).slice(2);
    try { localStorage.setItem('wm_device_id', id); } catch (e) { /* */ }
  }
  return id;
}

/* ── «Что нового в магазине» ────────────────────────
 * Лента новинок на главной — видна всем, в том числе покупателю без входа.
 * «Новое» = товар ПОЯВИЛСЯ в каталоге недавно (created_at), а не «был
 * последний завоз» (arrival_at): иначе в новинки каждую неделю попадали бы
 * хлеб и молоко, которые просто регулярно привозят.
 * Оговорка: при первой загрузке каталога у ВСЕХ товаров дата появления —
 * день импорта, и лента показала бы весь ассортимент. Поэтому если «новых»
 * больше пятой части каталога, это не новинки, а первая загрузка — молчим. */

const NEW_DAYS = 30;          // сколько дней товар считается новым
const NEW_MAX_SHARE = 0.2;    // больше этой доли каталога — это первая загрузка

function newProducts() {
  const from = daysAgoISO(NEW_DAYS);
  const fresh = state.products.filter((p) => String(p.created_at || '').slice(0, 10) >= from);
  if (!fresh.length || fresh.length > state.products.length * NEW_MAX_SHARE) return [];
  return fresh.sort((a, b) => String(b.created_at || '').localeCompare(String(a.created_at || ''))).slice(0, 12);
}

/* «Мои частые товары»: телефон и так считает, что этот сотрудник открывает
 * чаще всего, но нигде это не показывал. Хот-доги, выпечка и весовое — в одно
 * касание, без поиска. Список у каждого телефона свой и наружу не уходит. */
const MY_MIN_VIEWS = 2;   // случайно открытое один раз в ленту не тащим
function renderMyFrequent() {
  const box = $('myStrip');
  if (!box) return;
  // «мои частые» — рабочая память сотрудника; покупателю её не показываем
  if (!state.session) { box.hidden = true; box.innerHTML = ''; return; }
  const show = !state.query && !state.favOnly && !anyFilterActive() && state.tab === 'catalog';
  const pop = state.popularity || {};
  const top = show
    ? state.products.filter((p) => (pop[p.id] || 0) >= MY_MIN_VIEWS)
      .sort((a, b) => (pop[b.id] || 0) - (pop[a.id] || 0)).slice(0, 12)
    : [];
  if (top.length < 2) { box.hidden = true; box.innerHTML = ''; return; }
  box.hidden = false;
  box.innerHTML = `<div class="similar-title">${ic('heart', 'ic-xs')} Мои частые товары</div><div class="similar-row">`
    + top.map((x) => {
      const ph = (x.photos || []).find((u) => u && String(u).trim());
      const price = (x.retail_price != null && x.retail_price !== '') ? `<span class="similar-price">${esc(fmtRetail(x))}</span>` : '';
      const code = x.code ? `<span class="similar-code">${esc(x.code)}</span>` : '';
      return `<button class="similar-card" data-similar="${esc(x.id)}">
        <span class="similar-photo${ph ? '' : ' no-photo'}">${ph ? `<img src="${esc(ph)}" loading="lazy" alt="" onerror="wmImgFail(this)">` : ic('box', 'ic-ph')}</span>
        <span class="similar-name">${esc(x.name)}</span>${code}${price}</button>`;
    }).join('') + '</div>';
}

export function renderNewProducts() {
  const box = $('newStrip');
  if (!box) return;
  // ленты с фотографиями покупателю не показываем: у него каталог списком
  if (!state.session) { box.hidden = true; box.innerHTML = ''; return; }
  const show = !state.query && !state.favOnly && !anyFilterActive();
  const top = show ? newProducts() : [];
  if (!top.length) { box.hidden = true; box.innerHTML = ''; return; }
  box.hidden = false;
  box.innerHTML = `<div class="similar-title">${ic('star', 'ic-xs')} Новое в магазине</div><div class="similar-row">`
    + top.map((x) => {
      const ph = (x.photos || []).find((u) => u && String(u).trim());
      const price = (x.retail_price != null && x.retail_price !== '') ? `<span class="similar-price">${esc(fmtRetail(x))}</span>` : '';
      return `<button class="similar-card" data-similar="${esc(x.id)}">
        <span class="similar-photo${ph ? '' : ' no-photo'}">${ph ? `<img src="${esc(ph)}" loading="lazy" alt="" onerror="wmImgFail(this)">` : ic('box', 'ic-ph')}</span>
        <span class="similar-name">${esc(x.name)}</span>${price}</button>`;
    }).join('') + '</div>';
}

/* ── «Сегодня дешевле» ──────────────────────────────────────────────────────
 * Приём из китайского JD: полоса «успей» с ценами прямо на главной. Ради неё
 * туда и заходят каждый день — не потому что понадобилось, а посмотреть.
 * У нас она честнее: это не выдуманная акция, а настоящее снижение цены с
 * прошлого захода. Считает сам телефон, сравнивая с ценами, которые он видел
 * в прошлый раз; поэтому у первого посетителя полосы нет — сравнивать не с чем.
 * Видна всем (решение владельца): сотруднику у полки этот вопрос задают чаще
 * всего, а владельцу по ней видно, что новая цена доехала до каталога. */
const CHEAP_ROWS = 5;

function renderCheaper() {
  ui.renderCheaper = renderCheaper;      // звать из «что нового» без встречного импорта
  const box = $('cheaperStrip');
  if (!box) return;
  const show = state.tab === 'catalog'
    && !state.query && !state.favOnly && !anyFilterActive();
  const was = state.priceWas || {};
  const list = show ? state.products.filter((p) => {
    const w = Number(was[p.id]); const n = Number(p.retail_price);
    return w > 0 && n > 0 && w > n;
  }) : [];
  if (!list.length) { box.hidden = true; box.innerHTML = ''; return; }
  // сверху то, где выгода больше в рублях: она и решает
  list.sort((a, b) => (was[b.id] - b.retail_price) - (was[a.id] - a.retail_price));
  const rows = list.slice(0, CHEAP_ROWS).map((p) => `<button class="arr-row" data-similar="${esc(p.id)}">
      <span class="arr-name">${esc(p.name)}</span>
      <span class="arr-price">${esc(fmtRetail(p))}
        <span class="card-was">${esc(fmtPrice(was[p.id]))}</span></span></button>`).join('');
  box.innerHTML = `<div class="arr-head">
      <span class="arr-title">Сегодня дешевле</span>
      <span class="arr-when">${list.length} ${plural(list.length, 'товар', 'товара', 'товаров')}</span>
    </div>
    <div class="arr-list">${rows}</div>`;
  box.hidden = false;
}

/* ── «Сегодня привезли» ──────────────────────────────────────────────────
 * Покупателю важен один вопрос: «что у вас нового?». Раньше ответ на него
 * лежал в фильтре по дате поступления — то есть нигде. Теперь завоз виден
 * сразу на главной, без единого нажатия.
 * Если сегодня ещё не привозили, показываем последний завоз за неделю и
 * честно называем день: пустой блок «сегодня ничего» никому не нужен, а
 * «привезли в понедельник» — это по-прежнему свежий товар.
 * Только покупателю: у сотрудника на главной своя лента новинок с фото,
 * а завоз он и так видит в заказах. */

const ARR_MAX_DAYS = 7;   // дальше недели «свежим завозом» это уже не назвать
const ARR_ROWS = 6;       // больше строк — и блок съедает весь первый экран

/* Ответ не меняется, пока не приехал новый каталог, а товаров бывает
 * пятнадцать тысяч: считаем один раз на загрузку данных. */
let arrCache = { src: null, day: '' };

function arrivalDay() {
  if (arrCache.src === state.products) return arrCache.day;
  const today = todayISO();
  const from = daysAgoISO(ARR_MAX_DAYS);
  let best = '';
  for (const p of state.products) {
    const d = String(p.arrival_at || '').slice(0, 10);
    if (d && d <= today && d >= from && d > best) best = d;
  }
  arrCache = { src: state.products, day: best };
  return best;
}

function renderArrivals() {
  const box = $('arrivalStrip');
  if (!box) return;
  const show = !state.session && state.tab === 'catalog'
    && !state.query && !state.favOnly && !anyFilterActive();
  const day = show ? arrivalDay() : '';
  const list = day
    ? state.products.filter((p) => String(p.arrival_at || '').slice(0, 10) === day)
    : [];
  // один товар — это не завоз, а случайность в данных: молчим
  if (list.length < 2) { box.hidden = true; box.innerHTML = ''; return; }
  list.sort((a, b) => String(a.name || '').localeCompare(String(b.name || '')));
  const title = day === todayISO() ? 'Сегодня привезли'
    : day === daysAgoISO(1) ? 'Вчера привезли'
      : 'Привезли ' + fmtDate(day);
  const rows = list.slice(0, ARR_ROWS).map((p) => `<button class="arr-row" data-similar="${esc(p.id)}">
      <span class="arr-name">${esc(p.name)}</span>
      <span class="arr-price">${esc(fmtRetail(p))}</span></button>`).join('');
  const rest = list.length - ARR_ROWS;
  box.innerHTML = `<div class="arr-head">
      <span class="arr-title">${esc(title)}</span>
      <span class="arr-when">${list.length} ${plural(list.length, 'товар', 'товара', 'товаров')}</span>
    </div>
    <div class="arr-list">${rows}</div>
    ${rest > 0 ? `<button class="arr-more" data-arr-all="${esc(day)}">Показать все ${list.length} \u203a</button>` : ''}`;
  box.hidden = false;
}

// «Недавно смотрели» — горизонтальная лента на главной, когда нет поиска и фильтров

export function applyTheme(t) {
  // t: 'dark' | 'light' | null (авто — по системе)
  const root = document.documentElement;
  if (t === 'dark' || t === 'light') root.setAttribute('data-theme', t);
  else root.removeAttribute('data-theme');
  const icon = $('themeIcon');
  if (icon) icon.innerHTML = ic(t === 'dark' ? 'sun' : t === 'light' ? 'moon' : 'auto');
}
export function initTheme() { try { applyTheme(localStorage.getItem(THEME_KEY)); } catch (e) { /* */ } }
export function toggleTheme() {
  let cur; try { cur = localStorage.getItem(THEME_KEY); } catch (e) { cur = null; }
  // цикл: авто → тёмная → светлая → авто
  const next = cur == null ? 'dark' : cur === 'dark' ? 'light' : null;
  try { next ? localStorage.setItem(THEME_KEY, next) : localStorage.removeItem(THEME_KEY); } catch (e) { /* */ }
  applyTheme(next);
}

// Фото на весь экран (зум по тапу). Кнопка «назад» телефона его закрывает.
export function openLightbox(url) {
  if (!url) return;
  $('lightboxImg').src = url;
  $('lightbox').hidden = false;
  try { history.pushState({ wmLightbox: true }, ''); } catch (e) { /* некритично */ }
}
export function closeLightbox() {
  const lb = $('lightbox');
  if (!lb || lb.hidden) return;
  lb.hidden = true; $('lightboxImg').src = '';
  // «съедаем» нашу history-запись, чтобы счётчик «назад» не сбился
  if (window.history.state && window.history.state.wmLightbox) { expectPop++; try { history.back(); } catch (e) { expectPop--; } }
}

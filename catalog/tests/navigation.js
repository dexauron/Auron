// Нижняя панель разделов, экран категорий и подпись наличия товара.
const { chromium, newPage, asOwner, openProduct, text, runner } = require('./helpers');

const now = '2026-01-01T00:00:00Z';
// Категория товара определяется по НАЗВАНИЮ ГРУППЫ, а не по названию товара,
// поэтому группы тут расставлены осмысленно — иначе тест проверяет ерунду.
const mk = (i, name, group, extra) => Object.assign({
  id: 'p' + i, name, code: String(1000 + i), group_id: group,
  retail_price: 50 + i, is_weighted: false, unit: 'шт', photos: [], created_at: now,
}, extra || {});
// Остаток — внутренние данные: он есть только у вошедшего сотрудника,
// в открытый файл витрины не попадает вовсе.
const products = [
  mk(1, 'Молоко Простоквашино 3.2%', 'g1', { stock: 40 }),
  mk(2, 'Кефир Домик в деревне', 'g1', { stock: 2 }),      // мало
  mk(3, 'Хлеб Бородинский', 'g2', { stock: 0 }),           // закончился
  mk(4, 'Шампунь Head & Shoulders', 'g3'),                 // остатки не загружали
  mk(5, 'Конфеты Мишка косолапый', 'g4', { stock: 30 }),
  mk(6, 'Печенье Юбилейное', 'g4', { stock: 25 }),
  mk(7, 'Шоколад молочный Алёнка', 'g4', { stock: 15 }),   // «мол…» найдётся в двух категориях
];
const groups = [
  { id: 'g1', name: 'Молочные продукты', sort_order: 1 },
  { id: 'g2', name: 'Хлеб и выпечка', sort_order: 2 },
  { id: 'g3', name: 'Шампуни', sort_order: 3 },
  { id: 'g4', name: 'Конфеты и печенье', sort_order: 4 },
];

(async () => {
  const b = await chromium.launch();
  const { chk, done } = runner('НАВИГАЦИЯ, КАТЕГОРИИ И НАЛИЧИЕ');
  const { page, errs } = await newPage(b, { products, groups });

  // ── нижняя панель ──
  const tabs = await page.evaluate(() => [...document.querySelectorAll('.tabbar .tab')].map((t) => t.innerText.replace(/\s+/g, ' ').trim()));
  chk(tabs.length === 4, `в нижней панели 4 раздела (${tabs.join(' | ')})`);
  chk(/Каталог/.test(tabs[0]) && /Категории/.test(tabs[1]), 'первые разделы — «Каталог» и «Категории»');
  // «Ещё» заменили на «Фильтры»: до фильтров теперь дотягивается большой палец
  chk(/Фильтры/.test(tabs[3]) && !tabs.some((t) => /Ещё/.test(t)),
    `последний раздел — «Фильтры», а не «Ещё» (${tabs[3]})`);
  await page.click('.tabbar [data-tab="filters"]'); await page.waitForTimeout(450);
  const filt = await page.evaluate(() => ({
    open: !document.getElementById('filterSheet').hidden,
    nav: (document.querySelector('#filterSheet .ios-nav-title') || {}).textContent,
    apply: (document.getElementById('filterApply') || {}).textContent,
  }));
  chk(filt.open && /Фильтры/.test(filt.nav || ''), `вкладка открывает окно фильтров (${filt.nav})`);
  chk(/Показать/.test(filt.apply || ''), `внизу окна видно, сколько товаров найдётся (${filt.apply})`);
  await page.click('#filterSheet [data-close="filterSheet"]'); await page.waitForTimeout(350);
  // ленты «Популярное» на главной больше нет — владелец попросил убрать
  const noPopular = await page.evaluate(() => !document.getElementById('popularStrip')
    && !/Популярное/.test(document.body.innerText));
  chk(noPopular, 'на главной нет ленты «Популярное»');
  const atBottom = await page.evaluate(() => {
    const t = document.getElementById('tabbar'); const r = t.getBoundingClientRect();
    return getComputedStyle(t).position === 'fixed' && Math.abs(r.bottom - innerHeight) < 2;
  });
  chk(atBottom, 'панель закреплена внизу экрана');
  const overlap = await page.evaluate(() => {
    const t = document.getElementById('tabbar').getBoundingClientRect();
    const fab = document.getElementById('fabAdd').getBoundingClientRect();
    return fab.bottom > t.top;
  });
  chk(!overlap, 'кнопка «＋» не перекрывается панелью');

  // ── экран категорий ──
  await page.click('.tabbar [data-tab="cats"]'); await page.waitForTimeout(500);
  const cats = await page.evaluate(() => ({
    hidden: document.getElementById('catScreen').hidden,
    gridHidden: document.getElementById('productGrid').hidden,
    tiles: [...document.querySelectorAll('.cat-tile')].map((t) => t.innerText.replace(/\s+/g, ' ').trim()),
  }));
  console.log('--- категории ---\n' + cats.tiles.join('\n') + '\n---');
  chk(!cats.hidden && cats.gridHidden, 'на вкладке «Категории» видны плитки, сетка товаров скрыта');
  chk(cats.tiles.length >= 3, `категории разложены по плиткам (${cats.tiles.length})`);
  chk(cats.tiles.some((t) => /Молочное/.test(t)), 'молочные товары попали в «Молочное»');
  chk(cats.tiles.every((t) => /\d+ товар/.test(t)), 'у каждой плитки написано, сколько товаров');
  chk(cats.tiles.join(' ').includes('Хлеб и выпечка'), 'хлеб — в своей категории');

  // ── второй уровень: внутри категории — её группы из 1С ──
  await page.click('.cat-tile[data-cat-open="Молочное"]'); await page.waitForTimeout(500);
  const inside = await page.evaluate(() => ({
    head: (document.querySelector('.cat-head') || {}).innerText || '',
    back: !!document.querySelector('[data-cat-back]'),
    rows: [...document.querySelectorAll('.grp-row')].map((r) => r.innerText.replace(/\s+/g, ' ').trim()),
  }));
  console.log('--- внутри категории ---\n' + inside.rows.join('\n') + '\n---');
  chk(/Молочное/.test(inside.head), 'заголовок раскрытой категории на месте');
  chk(inside.back, 'есть возврат «Все категории»');
  chk(inside.rows.some((r) => /Молочные продукты/.test(r)), 'внутри категории видны настоящие группы из 1С');
  chk(inside.rows.some((r) => /Показать все/.test(r)), 'есть «Показать все» — вся категория целиком');

  // тап по группе ведёт в каталог с этой группой
  await page.click('.grp-row[data-grp="g1"]'); await page.waitForTimeout(600);
  const after = await page.evaluate(() => ({
    tab: [...document.querySelectorAll('.tabbar .tab')].find((t) => t.classList.contains('active')).dataset.tab,
    names: [...document.querySelectorAll('#productGrid .card')].map((c) => c.innerText.replace(/\s+/g, ' ')),
  }));
  chk(after.tab === 'catalog', 'после выбора группы открывается «Каталог»');
  chk(after.names.length === 2 && after.names.every((n) => /Молоко|Кефир/.test(n)),
    `показаны только товары группы (${after.names.length}: ${after.names.map((n) => n.slice(0, 18)).join(', ')})`);

  // ── поиск раскладывает найденное по категориям ──
  await page.fill('#searchInput', ''); await page.waitForTimeout(200);
  await page.evaluate(() => { const P = window.WM_PUBLISH; const s = P._state(); s.selGroups = []; s.selCats = []; P.renderAll(); });
  await page.waitForTimeout(300);
  await page.fill('#searchInput', 'мол'); await page.waitForTimeout(700);
  const search = await page.evaluate(() => ({
    seps: [...document.querySelectorAll('.cat-sep')].map((x) => x.innerText.replace(/\s+/g, ' ').trim()),
    grouped: document.getElementById('productGrid').classList.contains('grouped'),
  }));
  console.log('--- заголовки в поиске ---\n' + search.seps.join('\n') + '\n---');
  chk(search.grouped && search.seps.length >= 2, `найденное разложено по категориям (${search.seps.length})`);
  chk(search.seps.every((t) => /\d+$/.test(t)), 'у каждой категории написано, сколько в ней нашлось');
  await page.fill('#searchInput', ''); await page.waitForTimeout(400);
  chk(!(await page.evaluate(() => document.getElementById('productGrid').classList.contains('grouped'))),
    'без поиска заголовков нет — при листании каталога они мешают');

  // ── избранное ──
  await openProduct(page, 'p5');
  await page.click('#btnFav'); await page.waitForTimeout(300);
  await page.evaluate(() => { const s = document.getElementById('productSheet'); if (!s.hidden) history.back(); });
  await page.waitForTimeout(400);
  await page.click('.tabbar [data-tab="fav"]'); await page.waitForTimeout(500);
  const fav = await page.evaluate(() => ({
    badge: document.getElementById('tabFavCount').textContent,
    hidden: document.getElementById('tabFavCount').hidden,
    n: document.querySelectorAll('#productGrid .card').length,
  }));
  chk(!fav.hidden && fav.badge === '1', `на «Избранном» счётчик (${fav.badge})`);
  chk(fav.n === 1, `в избранном ровно отмеченный товар (${fav.n})`);

  // ── наличие: без входа его не видно вовсе ──
  await page.click('.tabbar [data-tab="catalog"]'); await page.waitForTimeout(500);
  const guest = await page.evaluate(() => document.getElementById('productGrid').innerText);
  chk(!/Мало|Нет в наличии|Есть в магазине/.test(guest), 'без входа наличие не показывается — каталог для сотрудников, но ссылка публичная');
  // входим сотрудником
  await page.evaluate(() => { const P = window.WM_PUBLISH; P.applyServerless('pw'); P.renderAll(); });
  await page.waitForTimeout(500);
  const tiles = await page.evaluate(() => Object.fromEntries(
    [...document.querySelectorAll('#productGrid .card')].map((c) => [c.dataset.id, c.innerText.replace(/\s+/g, ' ').trim()])));
  chk(/Нет/.test(tiles.p3 || ''), `у закончившегося товара на плитке «Нет» (${tiles.p3})`);
  chk(/Мало/.test(tiles.p2 || ''), `у заканчивающегося — «Мало» (${tiles.p2})`);
  chk(!/Есть/.test(tiles.p1 || ''), 'у обычного товара плитка не засоряется значком «Есть»');
  chk(!/Нет|Мало|Есть/.test(tiles.p4 || ''), 'без данных об остатке на плитке ничего не пишем');

  await openProduct(page, 'p1');
  chk(/Есть в магазине/.test(await text(page, '#sheetBadges')), 'в карточке наличие написано словами');
  await openProduct(page, 'p3');
  chk(/Нет в наличии/.test(await text(page, '#sheetBadges')), 'в карточке видно, что товара нет');
  await openProduct(page, 'p4');
  chk(!/наличи|Есть|Мало/.test(await text(page, '#sheetBadges')), 'без остатков про наличие молчим, а не выдумываем');

  chk(!errs.length, `нет сбоев в коде (${errs.length}${errs.length ? ': ' + errs[0] : ''})`);
  await done(b);
})();

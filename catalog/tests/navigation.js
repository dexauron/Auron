// Нижняя панель разделов, экран категорий и подпись наличия товара.
const { chromium, newPage, asOwner, openProduct, text, runner } = require('./helpers');

const now = '2026-01-01T00:00:00Z';
// Категория товара определяется по НАЗВАНИЮ ГРУППЫ, а не по названию товара,
// поэтому группы тут расставлены осмысленно — иначе тест проверяет ерунду.
const mk = (i, name, group, extra) => Object.assign({
  id: 'p' + i, name, code: String(1000 + i), group_id: group,
  retail_price: 50 + i, is_weighted: false, unit: 'шт', photos: [], created_at: now,
}, extra || {});
const products = [
  mk(1, 'Молоко Простоквашино 3.2%', 'g1', { stock_state: 'in' }),
  mk(2, 'Кефир Домик в деревне', 'g1', { stock_state: 'low' }),
  mk(3, 'Хлеб Бородинский', 'g2', { stock_state: 'out' }),
  mk(4, 'Шампунь Head & Shoulders', 'g3'),    // наличие неизвестно
  mk(5, 'Конфеты Мишка косолапый', 'g4', { stock_state: 'in' }),
  mk(6, 'Печенье Юбилейное', 'g4', { stock_state: 'in' }),
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

  // тап по плитке ведёт в каталог с этим фильтром
  await page.click('.cat-tile[data-cat-tile="Молочное"]'); await page.waitForTimeout(600);
  const after = await page.evaluate(() => ({
    tab: [...document.querySelectorAll('.tabbar .tab')].find((t) => t.classList.contains('active')).dataset.tab,
    names: [...document.querySelectorAll('#productGrid .card')].map((c) => c.innerText.replace(/\s+/g, ' ')),
  }));
  chk(after.tab === 'catalog', 'после выбора категории открывается «Каталог»');
  chk(after.names.length === 2 && after.names.every((n) => /Молоко|Кефир/.test(n)),
    `показаны только товары категории (${after.names.length}: ${after.names.map((n) => n.slice(0, 18)).join(', ')})`);

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

  // ── наличие ──
  await page.click('.tabbar [data-tab="catalog"]'); await page.waitForTimeout(500);
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

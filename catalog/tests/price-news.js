/* Экран «Изменения цен».
 *
 * Решение владельца: при заходе в каталог никаких списков «подешевело» и
 * «подорожало» быть не должно — они закрывали собой товар. Теперь это один
 * отдельный экран с поиском, вход — из «Фильтров».
 */
const { chromium, newPage, asOwner, runner } = require('./helpers');

const iso = (d) => new Date(Date.now() - d * 86400000).toISOString().slice(0, 10);
const products = [
  { id: 'p1', name: 'Молоко Простоквашино 3,2%', code: '101', group_id: 'g1', retail_price: 89, unit: 'шт', photos: [], barcodes: [], supplier_ids: ['s1'] },
  { id: 'p2', name: 'Кефир Домик в деревне', code: '102', group_id: 'g1', retail_price: 60, unit: 'шт', photos: [], barcodes: [], supplier_ids: ['s1'] },
  { id: 'p3', name: 'Батон нарезной', code: '201', group_id: 'g1', retail_price: 45, unit: 'шт', photos: [], barcodes: [], supplier_ids: ['s2'] },
];
const groups = [{ id: 'g1', name: 'Разное' }];

const openFilters = (page) => page.evaluate(async () => {
  document.querySelectorAll('.sheet-backdrop:not([hidden])').forEach((x) => { x.hidden = true; });
  document.querySelector('.tabbar [data-tab="filters"]').click();
  await new Promise((r) => setTimeout(r, 400));
});

(async () => {
  const b = await chromium.launch();
  const { chk, done } = runner('ИЗМЕНЕНИЯ ЦЕН');
  const { page, errs } = await newPage(b, { products, groups });

  // ── 1. Покупатель: главный экран чистый ──
  await page.evaluate((at) => {
    const s = window.WM_PUBLISH._state();
    s.priceWas = { p1: 120, p2: 75 }; s.priceWasAt = at;
    window.WM_PUBLISH.renderAll();
  }, iso(3));
  await page.waitForTimeout(500);
  const main = await page.evaluate(() => ({
    strips: ['cheaperStrip', 'riseStrip'].filter((id) => document.getElementById(id)),
    text: document.querySelector('.content').innerText.replace(/\s+/g, ' '),
  }));
  chk(main.strips.length === 0, `полос «подешевело/подорожало» на главном экране нет (${main.strips.join(', ') || 'ни одной'})`);
  chk(!/Стало дешевле|Подорожало/.test(main.text), 'и в тексте главного экрана их не видно');

  // ── 2. Вход — из «Фильтров», с числом ──
  await openFilters(page);
  const entry = await page.evaluate(() => ({
    wrap: (document.getElementById('priceNewsEntry') || {}).hidden,
    down: (document.getElementById('openCheaper') || {}).hidden,
    downVal: (document.getElementById('openCheaperVal') || {}).textContent || '',
    up: (document.getElementById('openRisen') || {}).hidden,
  }));
  chk(entry.wrap === false && entry.down === false, 'в «Фильтрах» есть вход «Подешевело»');
  chk(/2 товара/.test(entry.downVal), `сказано, сколько товаров (${entry.downVal})`);
  chk(entry.up === true, 'покупателю «Подорожало» не предлагают — это новость магазина');

  // ── 3. Экран: список, поиск, с какого дня сравниваем ──
  await page.click('#openCheaper'); await page.waitForTimeout(500);
  const sheet = await page.evaluate(() => ({
    open: !document.getElementById('priceNewsSheet').hidden,
    filters: document.getElementById('filterSheet').hidden,
    rows: document.querySelectorAll('#priceNewsBody .pn-row').length,
    since: (document.getElementById('priceNewsSince') || {}).textContent || '',
    text: document.getElementById('priceNewsBody').innerText.replace(/\s+/g, ' '),
  }));
  chk(sheet.open && sheet.filters, 'экран открылся, «Фильтры» закрылись');
  chk(sheet.rows === 2, `в списке оба подешевевших товара (${sheet.rows})`);
  chk(/сравниваем с ценами на/.test(sheet.since), `сказано, с какого дня сравниваем (${sheet.since})`);
  chk(/89/.test(sheet.text) && /120/.test(sheet.text), 'видна и новая цена, и прежняя');

  const found = await page.evaluate(async () => {
    const inp = document.getElementById('priceNewsQuery');
    inp.value = 'кефир';
    inp.dispatchEvent(new Event('input', { bubbles: true }));
    await new Promise((r) => setTimeout(r, 200));
    return { rows: document.querySelectorAll('#priceNewsBody .pn-row').length,
      text: document.getElementById('priceNewsBody').innerText.replace(/\s+/g, ' ') };
  });
  chk(found.rows === 1 && /Кефир/.test(found.text), `поиск по списку работает (${found.rows})`);

  const opened = await page.evaluate(async () => {
    document.querySelector('#priceNewsBody .pn-row').click();
    await new Promise((r) => setTimeout(r, 450));
    return { card: !document.getElementById('productSheet').hidden,
      name: (document.getElementById('sheetName') || {}).textContent || '',
      news: document.getElementById('priceNewsSheet').hidden };
  });
  chk(opened.card && /Кефир/.test(opened.name), `нажал строку — открылся товар (${opened.name})`);
  chk(opened.news, 'список при этом закрылся');

  // ── 4. Владелец: обе половины, и «Подорожало» считает по-настоящему ──
  await asOwner(page, {
    suppliers: [{ id: 's1', name: 'Молзавод' }, { id: 's2', name: 'Хлебозавод' }],
    prices: [
      { product_id: 'p3', supplier_id: 's2', price: 30, price_date: iso(9), unit: 'шт' },
      { product_id: 'p3', supplier_id: 's2', price: 36, price_date: iso(1), unit: 'шт' },
    ],
  });
  await page.waitForTimeout(1500);
  await openFilters(page);
  const own = await page.evaluate(() => ({
    up: (document.getElementById('openRisen') || {}).hidden,
    upVal: (document.getElementById('openRisenVal') || {}).textContent || '',
  }));
  chk(own.up === false && /1 товар/.test(own.upVal), `владельцу предложено «Подорожало» (${own.upVal})`);

  await page.click('#openRisen'); await page.waitForTimeout(600);
  const up = await page.evaluate(() => ({
    active: (document.querySelector('#priceNewsSeg .active') || {}).textContent || '',
    text: document.getElementById('priceNewsBody').innerText.replace(/\s+/g, ' '),
  }));
  chk(/Подорожало/.test(up.active), `открылась нужная половина (${up.active})`);
  chk(/Батон/.test(up.text) && /36/.test(up.text) && /30/.test(up.text), `видно, что и с какой цены подорожало (${up.text.slice(0, 60)})`);
  chk(/закупка/.test(up.text), 'сказано, что подорожала закупка, а не ценник');

  const toDown = await page.evaluate(async () => {
    document.querySelector('#priceNewsSeg [data-dir="down"]').click();
    await new Promise((r) => setTimeout(r, 300));
    return document.getElementById('priceNewsBody').innerText.replace(/\s+/g, ' ');
  });
  chk(/Молоко|Кефир/.test(toDown), 'половины переключаются на одном экране');

  chk(errs.length === 0, `нет сбоев JS (${errs.length}${errs.length ? ': ' + errs[0] : ''})`);
  await done(b);
})();

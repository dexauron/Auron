/* Кнопка «назад» возвращает туда, откуда пришёл.
 *
 * Жалоба владельца: «кнопки назад выбрасывают на главный экран». Так и было:
 * почти каждый переход в каталоге — это «закрыть окно А, открыть окно Б», и
 * окно А закрывалось насовсем. Вернуться было некуда.
 */
const { chromium, newPage, asOwner, runner } = require('./helpers');

const products = [{ id: 'p1', name: 'Молоко 1л', code: '101', group_id: 'g1', retail_price: 89, unit: 'шт', photos: [], barcodes: [] }];
const groups = [{ id: 'g1', name: 'Молочное' }];

const openSheets = (page) => page.evaluate(() => [...document.querySelectorAll('.sheet-backdrop')]
  .filter((x) => !x.hidden).map((x) => x.id));
const closeAll = (page) => page.evaluate(() => {
  document.querySelectorAll('.sheet-backdrop').forEach((x) => { x.hidden = true; });
});

(async () => {
  const b = await chromium.launch();
  const { chk, done } = runner('КНОПКА «НАЗАД»');
  const { page, errs } = await newPage(b, { products, groups });
  await asOwner(page, {});
  await page.waitForTimeout(400);

  // ── 1. Меню → Заказы → «назад» возвращает в меню ──
  await page.evaluate(async () => {
    document.querySelectorAll('.sheet-backdrop:not([hidden])').forEach((x) => { x.hidden = true; });
    document.querySelector('.tabbar [data-tab="work"]').click();
    await new Promise((r) => setTimeout(r, 350));
    document.querySelector('[data-work="orders"]').click();
    await new Promise((r) => setTimeout(r, 400));
  });
  chk((await openSheets(page)).includes('ordersSheet'), 'со вкладки «Работа» открылись «Заказы поставщикам»');
  const backToMenu = await page.evaluate(async () => {
    const btn = document.querySelector('#ordersSheet .sheet-back') || document.querySelector('#ordersSheet [data-close]');
    btn.click();
    await new Promise((r) => setTimeout(r, 400));
    return [...document.querySelectorAll('.sheet-backdrop')].filter((x) => !x.hidden).map((x) => x.id);
  });
  chk(backToMenu.includes('workSheet'), `«назад» вернул на «Работу», а не на главный экран (${backToMenu.join(', ') || 'пусто'})`);
  chk(!backToMenu.includes('ordersSheet'), 'а заказы закрылись');

  // ── 2. Кнопка «назад» телефона — тоже ──
  await closeAll(page);
  await page.evaluate(async () => {
    document.querySelectorAll('.sheet-backdrop:not([hidden])').forEach((x) => { x.hidden = true; });
    document.querySelector('.tabbar [data-tab="work"]').click();
    await new Promise((r) => setTimeout(r, 350));
    document.querySelector('[data-work="restock"]').click();
    await new Promise((r) => setTimeout(r, 400));
  });
  await page.goBack();
  await page.waitForTimeout(500);
  const phoneBack = await openSheets(page);
  chk(phoneBack.includes('workSheet'), `кнопка «назад» телефона тоже возвращает на «Работу» (${phoneBack.join(', ') || 'пусто'})`);

  // ── 3. Фильтры → «Подешевело» → назад в фильтры ──
  await closeAll(page);
  await page.evaluate(async () => {
    const s = window.WM_PUBLISH._state();
    s.priceWas = { p1: 120 }; s.priceWasAt = new Date().toISOString().slice(0, 10);
    window.WM_PUBLISH.renderAll();
    await new Promise((r) => setTimeout(r, 300));
    document.querySelector('.tabbar [data-tab="filters"]').click();
    await new Promise((r) => setTimeout(r, 400));
    document.getElementById('openCheaper').click();
    await new Promise((r) => setTimeout(r, 450));
  });
  chk((await openSheets(page)).includes('priceNewsSheet'), 'из фильтров открылись «Изменения цен»');
  const backToFilters = await page.evaluate(async () => {
    document.querySelector('#priceNewsSheet [data-close]').click();
    await new Promise((r) => setTimeout(r, 400));
    return [...document.querySelectorAll('.sheet-backdrop')].filter((x) => !x.hidden).map((x) => x.id);
  });
  chk(backToFilters.includes('filterSheet'), `«Готово» вернуло в фильтры (${backToFilters.join(', ') || 'пусто'})`);

  // ── 4. Из списка изменений открыли товар — назад в список ──
  await closeAll(page);
  await page.evaluate(async () => {
    document.querySelector('.tabbar [data-tab="filters"]').click();
    await new Promise((r) => setTimeout(r, 350));
    document.getElementById('openCheaper').click();
    await new Promise((r) => setTimeout(r, 450));
    document.querySelector('#priceNewsBody .pn-row').click();
    await new Promise((r) => setTimeout(r, 450));
  });
  chk((await openSheets(page)).includes('productSheet'), 'из списка открылся товар');
  const backToList = await page.evaluate(async () => {
    document.getElementById('sheetClose').click();
    await new Promise((r) => setTimeout(r, 400));
    return [...document.querySelectorAll('.sheet-backdrop')].filter((x) => !x.hidden).map((x) => x.id);
  });
  chk(backToList.includes('priceNewsSheet'), `закрыл товар — вернулся в список изменений (${backToList.join(', ') || 'пусто'})`);

  // ── 5. Окно, открытое с главного экрана, закрывается насовсем ──
  await closeAll(page);
  const plain = await page.evaluate(async () => {
    document.querySelector('.tabbar [data-tab="filters"]').click();
    await new Promise((r) => setTimeout(r, 400));
    document.querySelector('#filterSheet [data-close]').click();
    await new Promise((r) => setTimeout(r, 400));
    return [...document.querySelectorAll('.sheet-backdrop')].filter((x) => !x.hidden).map((x) => x.id);
  });
  chk(plain.length === 0, `пришёл с главного экрана — туда и вернулся (${plain.join(', ') || 'пусто'})`);

  // ── 6. Цепочка из трёх окон разворачивается по шагам ──
  await closeAll(page);
  await page.evaluate(async () => {
    document.getElementById('adminBtn').click();
    await new Promise((r) => setTimeout(r, 300));
    document.getElementById('menuDevice').click();
    await new Promise((r) => setTimeout(r, 400));
    document.getElementById('devLogout') || document.getElementById('devLogin');
  });
  const chain1 = await page.evaluate(async () => {
    document.querySelector('#deviceSheet [data-close]').click();
    await new Promise((r) => setTimeout(r, 400));
    return [...document.querySelectorAll('.sheet-backdrop')].filter((x) => !x.hidden).map((x) => x.id);
  });
  chk(chain1.includes('adminMenuSheet'), `меню → устройство → назад вернул в меню (${chain1.join(', ') || 'пусто'})`);
  const chain2 = await page.evaluate(async () => {
    document.querySelector('#adminMenuSheet [data-close]').click();
    await new Promise((r) => setTimeout(r, 400));
    return [...document.querySelectorAll('.sheet-backdrop')].filter((x) => !x.hidden).map((x) => x.id);
  });
  chk(chain2.length === 0, `а из меню — на главный экран (${chain2.join(', ') || 'пусто'})`);

  chk(errs.length === 0, `нет сбоев JS (${errs.length}${errs.length ? ': ' + errs[0] : ''})`);
  await done(b);
})();

// Покупатель (без входа) не видит код кассы — даже если код остался
// в уже выложенных данных витрины. Защита не только в файле, но и в экране.
const { chromium, newPage, openProduct, runner } = require('./helpers');

const PRODS = [{
  id: 'p1', name: 'Молоко 1л', code: '100500', barcodes: ['4600000000011'],
  group_id: 'g1', unit: 'шт', retail_price: 89, photos: [], arrival_at: '2026-10-01',
}];
const GRPS = [{ id: 'g1', name: 'Молочные', sort_order: 1 }];

(async () => {
  const b = await chromium.launch();
  const { chk, done } = runner('ПОКУПАТЕЛЬ БЕЗ КОДА КАССЫ');
  // данные витрины СО старым кодом — как на уже опубликованном сайте
  const { page, errs } = await newPage(b, { products: PRODS, groups: GRPS });

  const grid = await page.evaluate(() => {
    const g = document.getElementById('productGrid');
    return { html: g ? g.innerHTML : 'НЕТ', codeBadges: document.querySelectorAll('#productGrid .card-code').length };
  });
  chk(grid.codeBadges === 0, 'на плитках покупателя нет бейджа с кодом (' + grid.codeBadges + ')');
  chk(!grid.html.includes('100500'), 'значение кода не попало в сетку покупателя');

  await openProduct(page, 'p1');
  const card = await page.evaluate(() => {
    const f = document.getElementById('sheetFields');
    return { text: f ? (f.textContent || '') : 'НЕТ' };
  });
  chk(!card.text.includes('100500'), 'в карточке покупателя нет кода кассы');
  chk(!card.text.includes('Код товара'), 'в карточке покупателя нет строки «Код товара»');

  // а вошедший сотрудник код видит
  await page.evaluate((d) => {
    window.WM_PUBLISH.applyFloorSnapshot({ v: 1, products: d.p, groups: d.g });
  }, { p: PRODS, g: GRPS });
  await page.waitForTimeout(300);
  await openProduct(page, 'p1');
  const staff = await page.evaluate(() => {
    const f = document.getElementById('sheetFields');
    return f ? (f.textContent || '') : 'НЕТ';
  });
  chk(staff.includes('100500'), 'вошедший сотрудник код кассы видит');
  chk(errs.length === 0, 'нет ошибок страницы (' + errs.length + ')');

  await done(b);
})();

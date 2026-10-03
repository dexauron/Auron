// Фото для покупателя: витрина и карточка показывают картинку товара,
// но коды кассы и внутреннее по-прежнему скрыты. У сотрудника список
// остаётся плотным — фото в нём не занимает место.
const { chromium, newPage, openProduct, runner } = require('./helpers');

const IMG = 'data:image/gif;base64,R0lGODlhAQABAIAAAP///wAAACH5BAEAAAAALAAAAAABAAEAAAICRAEAOw==';
const PRODS = [
  { id: 'p1', name: 'Молоко 1л', code: '100500', group_id: 'g1', unit: 'шт',
    retail_price: 89, photos: [IMG, IMG], barcodes: ['4600000000011'] },
  { id: 'p2', name: 'Хлеб без фото', code: '100501', group_id: 'g1', unit: 'шт',
    retail_price: 45, photos: [], barcodes: [] },
];
const GRPS = [{ id: 'g1', name: 'Молочные', sort_order: 1 }];

(async () => {
  const b = await chromium.launch();
  const { chk, done } = runner('ФОТО ДЛЯ ПОКУПАТЕЛЯ');
  const { page, errs } = await newPage(b, { products: PRODS, groups: GRPS });

  // ── покупатель: в разметке списка есть место под фото ──
  const grid = await page.evaluate(() => ({
    rows: document.querySelectorAll('#productGrid .card-row').length,
    photoBlocks: document.querySelectorAll('#productGrid .card-row .card-photo').length,
    withPhoto: document.querySelectorAll('#productGrid .card-row .card-photo:not(.no-photo)').length,
    noPhoto: document.querySelectorAll('#productGrid .card-row .card-photo.no-photo').length,
    imgs: document.querySelectorAll('#productGrid .card-row .card-photo img').length,
  }));
  chk(grid.rows === 2, 'покупатель видит каталог списком (' + grid.rows + ')');
  chk(grid.photoBlocks === 2, 'в каждой строке есть блок под фото (' + grid.photoBlocks + ')');
  chk(grid.withPhoto === 1 && grid.imgs === 1, 'у товара с фото картинка подставлена');
  chk(grid.noPhoto === 1, 'у товара без фото блок помечен no-photo (строка остаётся компактной)');

  // ── покупатель: карточка показывает фото, но не коды ──
  await openProduct(page, 'p1');
  const card = await page.evaluate(() => {
    const ph = document.getElementById('sheetPhotos');
    const dots = document.getElementById('sheetDots');
    const f = document.getElementById('sheetFields');
    return {
      photosHidden: ph ? ph.hidden : 'НЕТ', imgs: ph ? ph.querySelectorAll('img').length : 0,
      dotsHidden: dots ? dots.hidden : 'НЕТ',
      fields: f ? (f.textContent || '') : '',
    };
  });
  chk(card.photosHidden === false && card.imgs === 2, 'в карточке покупателя показаны фото (' + card.imgs + ')');
  chk(card.dotsHidden === false, 'точки листания показаны — фото несколько');
  chk(!card.fields.includes('100500') && !card.fields.includes('Код товара'), 'кода кассы у покупателя по-прежнему нет');

  // ── товар без фото: блок фото не занимает место ──
  await openProduct(page, 'p2');
  const empty = await page.evaluate(() => {
    const ph = document.getElementById('sheetPhotos');
    return { hidden: ph ? ph.hidden : 'НЕТ' };
  });
  chk(empty.hidden === true, 'у товара без фото блок фото скрыт');

  // ── сотрудник: список остаётся плотным, фото в строке не видно ──
  await page.evaluate((d) => {
    window.WM_PUBLISH.applyFloorSnapshot({ v: 1, products: d.p, groups: d.g });
    const s = window.WM_PUBLISH._state(); s.view = 'list'; window.WM_PUBLISH.renderAll();
  }, { p: PRODS, g: GRPS });
  await page.waitForTimeout(400);
  const staff = await page.evaluate(() => {
    const el = document.querySelector('#productGrid .card-row .card-photo');
    return { shown: el ? getComputedStyle(el).display !== 'none' : 'НЕТ' };
  });
  chk(staff.shown === false, 'у сотрудника фото в списке не занимает место (список плотный)');
  chk(errs.length === 0, 'нет ошибок страницы (' + errs.length + ')');

  await done(b);
})();

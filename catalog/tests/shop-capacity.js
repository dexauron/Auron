/* Список покупок: на границе 200 своих позиций новая не вытесняет старую. */
const { chromium, newPage, openProduct, runner } = require('./helpers');

const products = [
  { id: 'p1', name: 'Молоко', code: '101', retail_price: 89,
    group_id: 'g1', photos: [], barcodes: [] },
  { id: 'p2', name: 'Хлеб', code: '102', retail_price: 49,
    group_id: 'g1', photos: [], barcodes: [] },
];
const groups = [{ id: 'g1', name: 'Продукты' }];

const seed = (page, count) => page.evaluate((n) => {
  const rows = Array.from({ length: n }, (_, i) => ({
    id: `own-${i}`, name: `Мой товар ${i}`, code: '', price: 1,
    qty: 1, done: false,
  }));
  localStorage.setItem('wm_shop_v1', JSON.stringify(rows));
}, count);

const snapshot = (page, button) => page.evaluate((sel) => {
  const rows = JSON.parse(localStorage.getItem('wm_shop_v1'));
  return {
    length: rows.length,
    own: rows.filter((x) => String(x.id).startsWith('own-')).length,
    first: rows.some((x) => x.id === 'own-0'),
    p1: rows.some((x) => x.id === 'p1'),
    p2: rows.some((x) => x.id === 'p2'),
    label: document.querySelector(sel)?.textContent.trim(),
  };
}, button);

(async () => {
  const b = await chromium.launch();
  const { chk, done } = runner('СПИСОК ПОКУПОК: ПРЕДЕЛ БЕЗ ПОТЕРЬ');
  const { page, errs } = await newPage(b, { products, groups });

  await seed(page, 199);
  await openProduct(page, 'p1');
  await page.locator('#btnShopAdd').click();
  const lastFree = await snapshot(page, '#btnShopAdd');
  chk(lastFree.length === 200 && lastFree.own === 199 && lastFree.first && lastFree.p1,
    `200-я позиция добавилась, 199 своих остались (${JSON.stringify(lastFree)})`);

  await openProduct(page, 'p2');
  await page.locator('#btnShopAdd').click();
  const fullCard = await snapshot(page, '#btnShopAdd');
  chk(fullCard.length === 200 && fullCard.own === 199 && fullCard.first
    && fullCard.p1 && !fullCard.p2 && fullCard.label === 'В список покупок',
  `карточка не вытеснила своё и не обещает добавить (${JSON.stringify(fullCard)})`);

  await seed(page, 200);
  const fullScan = await page.evaluate(() => {
    const result = document.getElementById('scanResult');
    result.innerHTML = '<button data-shop-scanned="p2">В список покупок</button>';
    result.querySelector('button').click();
    const rows = JSON.parse(localStorage.getItem('wm_shop_v1'));
    return {
      length: rows.length,
      own: rows.filter((x) => String(x.id).startsWith('own-')).length,
      first: rows.some((x) => x.id === 'own-0'),
      p2: rows.some((x) => x.id === 'p2'),
      label: result.querySelector('button').textContent.trim(),
    };
  });
  chk(fullScan.length === 200 && fullScan.own === 200 && fullScan.first
    && !fullScan.p2 && fullScan.label === 'В список покупок',
  `сканер сохранил 200 своих и подпись кнопки (${JSON.stringify(fullScan)})`);

  chk(!errs.length, `нет сбоев JS (${errs.length}${errs.length ? ': ' + errs[0] : ''})`);
  await done(b);
})();

// Сравнение нескольких товаров: цены поставщиков рядом, в одной таблице.
// Раньше приходилось открывать карточки по очереди и держать цифры в голове.
const { chromium, newPage, asOwner, openProduct, runner } = require('./helpers');

const products = [
  { id: 'p1', name: 'Молоко 3,2%', code: '101', group_id: 'g1', retail_price: 100, unit: 'шт', photos: [], stock: 5, supplier_ids: ['s1', 's2'] },
  { id: 'p2', name: 'Кефир 1%', code: '102', group_id: 'g1', retail_price: 90, unit: 'шт', photos: [], stock: 2, supplier_ids: ['s1'] },
  { id: 'p3', name: 'Сметана 20%', code: '103', group_id: 'g1', retail_price: 120, unit: 'шт', photos: [], supplier_ids: ['s2'] },
];
const suppliers = [{ id: 's1', name: 'Молзавод' }, { id: 's2', name: 'Опт' }];
const prices = [
  { product_id: 'p1', supplier_id: 's1', price: 70, price_date: '2026-08-01', unit: 'шт' },
  { product_id: 'p1', supplier_id: 's2', price: 65, price_date: '2026-08-02', unit: 'шт' },  // дешевле
  { product_id: 'p2', supplier_id: 's1', price: 60, price_date: '2026-08-01', unit: 'шт' },
  { product_id: 'p3', supplier_id: 's2', price: 96, price_date: '2026-08-01', unit: 'шт' },
];

(async () => {
  const b = await chromium.launch();
  const { chk, done } = runner('СРАВНЕНИЕ ТОВАРОВ');
  const { page, errs } = await newPage(b, { products, groups: [{ id: 'g1', name: 'Молочные' }] });
  await asOwner(page, { suppliers, prices });
  await page.waitForTimeout(300);

  const addToCompare = async (id) => {
    await openProduct(page, id);
    await page.waitForTimeout(300);
    await page.evaluate(() => document.getElementById('btnCompareAdd').click());
    await page.waitForTimeout(200);
    await page.evaluate(() => document.querySelectorAll('.sheet-backdrop:not([hidden])').forEach((s) => { s.hidden = true; }));
  };
  await addToCompare('p1');
  await addToCompare('p2');

  const bar = await page.evaluate(() => ({
    shown: !document.getElementById('compareBar').hidden,
    n: document.getElementById('compareCount').textContent,
  }));
  chk(bar.shown && bar.n === '2', `полоска сравнения показывает, сколько отобрано (${bar.n})`);

  await addToCompare('p3');
  const table = await page.evaluate(async () => {
    document.getElementById('compareOpen').click();
    await new Promise((r) => setTimeout(r, 400));
    const rows = [...document.querySelectorAll('#compareBody tbody tr')].map((tr) =>
      [...tr.querySelectorAll('td')].slice(0, 6).map((td) => td.innerText.replace(/\s+/g, ' ').trim()));
    return { open: !document.getElementById('compareSheet').hidden, rows, best: document.querySelectorAll('#compareBody .cmp-best').length };
  });
  chk(table.open && table.rows.length === 3, `в таблице все отобранные товары (${table.rows.length})`);
  console.log('--- таблица сравнения ---');
  table.rows.forEach((r) => console.log('  ' + r.join(' | ')));
  console.log('---');
  const milk = table.rows.find((r) => /Молоко/.test(r[0])) || [];
  chk(/65/.test(milk[1] || ''), `у товара берётся САМАЯ ВЫГОДНАЯ закупка (${milk[1]})`);
  chk(/Опт/.test(milk[2] || ''), `видно, у кого она (${milk[2]})`);
  chk(/54|53|55/.test(milk[4] || ''), `наценка посчитана (${milk[4]})`);
  chk(table.best === 1, `самая выгодная закупка среди отобранных подсвечена ровно один раз (${table.best})`);

  const afterRm = await page.evaluate(async () => {
    document.querySelector('#compareBody [data-cmp-rm]').click();
    await new Promise((r) => setTimeout(r, 350));
    return document.querySelectorAll('#compareBody tbody tr').length;
  });
  chk(afterRm === 2, `товар можно убрать из сравнения (осталось ${afterRm})`);

  const cleared = await page.evaluate(async () => {
    document.getElementById('compareClear2').click();
    await new Promise((r) => setTimeout(r, 300));
    return document.getElementById('compareBar').hidden;
  });
  chk(cleared, 'после «Очистить» полоска сравнения пропадает');

  chk(!errs.length, `нет сбоев JS (${errs.length}${errs.length ? ': ' + errs[0] : ''})`);
  await done(b);
})();

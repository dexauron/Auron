// Публичная витрина (без входа) НЕ содержит код кассы, но содержит штрихкод.
// Решение владельца 2026-10-03: коды — только для сотрудников зала.
const { chromium, newPage, runner } = require('./helpers');

(async () => {
  const b = await chromium.launch();
  const { chk, done } = runner('ВИТРИНА БЕЗ КОДА КАССЫ');
  const { page } = await newPage(b, {});

  const out = await page.evaluate(() => {
    const P = window.WM_PUBLISH; const s = P._state();
    s.products = [{
      id: 'p1', name: 'Молоко 1л', code: '100500', barcodes: ['4600000000011'],
      article: 'A-1', department: 'Молочка', group_id: 'g1', unit: 'шт',
      retail_price: 89, photos: ['a.jpg'], arrival_at: '2026-10-01',
    }];
    const pub = P.buildPublicProducts();
    return { pub, json: JSON.stringify(pub) };
  });

  const p = out.pub[0];
  chk(!!p, 'товар в публичной витрине есть');
  chk(p.code === undefined, 'кода кассы в публичной витрине НЕТ');
  chk(Array.isArray(p.barcodes) && p.barcodes.includes('4600000000011'), 'штрихкод в витрине есть (нужен сканеру покупателя)');
  chk(p.name === 'Молоко 1л' && p.retail_price === 89, 'название и розничная цена на месте');
  chk(!out.json.includes('100500'), 'значение кода нигде не просочилось в витрину');

  await done(b);
})();

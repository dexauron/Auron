// Публичная витрина не выносит наружу вложенные объекты из разрешённых полей.
// Находка аудита: photos/barcodes копировались «как есть», и объект вида
// {url, buy_price} утащил бы закупку в открытый файл.
const { chromium, newPage, runner } = require('./helpers');
const SENT = ['777.77', 'ТАЙНЫЙ_ПОСТАВЩИК', '4242424242'];

(async () => {
  const b = await chromium.launch();
  const { chk, done } = runner('ВИТРИНА — ТОЛЬКО ПРОСТЫЕ ЗНАЧЕНИЯ');
  const { page, errs } = await newPage(b, {});

  const out = await page.evaluate((sent) => {
    const P = window.WM_PUBLISH; const s = P._state();
    s.products = [{
      id: 'p1', name: 'Молоко 1л', category: 'Молочные', group_id: 'g1',
      unit: 'шт', retail_price: 89, arrival_at: '2026-10-01',
      // «хитрое» содержимое разрешённых полей
      photos: [{ url: 'x.jpg', buy_price: sent[0] }, 'ok.jpg'],
      barcodes: [{ value: '1', supplier_cost: sent[0] }, 4600000000099],
      description: { text: 'описание', cost: sent[0] },
      // запрещённые поля верхнего уровня
      code: '100500', article: 'A-1', supplier_ids: [sent[1]], stock: 7,
    }];
    const pub = P.buildPublicProducts();
    return { pub, json: JSON.stringify(pub) };
  }, SENT);

  const p = out.pub[0];
  chk(!!p, 'товар в витрине есть');
  chk(Array.isArray(p.photos) && p.photos.every((x) => typeof x === 'string'), 'photos — только строки (объект выброшен)');
  chk(Array.isArray(p.barcodes) && p.barcodes.every((x) => typeof x === 'string'), 'barcodes — только строки (объект выброшен)');
  chk(p.description === undefined, 'описание-объект в витрину не попало');
  chk(p.code === undefined && p.article === undefined, 'кода кассы и артикула в витрине нет');
  chk(p.supplier_ids === undefined && p.stock === undefined, 'поставщиков и остатка в витрине нет');
  const leaked = SENT.filter((v) => out.json.includes(v));
  chk(leaked.length === 0, 'ни одной денежной метки в витрине' + (leaked.length ? ': ' + leaked.join(',') : ''));
  chk(errs.length === 0, 'нет ошибок страницы (' + errs.length + ')');

  await done(b);
})();

// Безопасность роли «Сотрудник зала»: данные зала НЕ содержат денег —
// в т.ч. при «хитром» содержимом разрешённых полей (вложенные объекты, note).
const { chromium, newPage, runner } = require('./helpers');

// Разрешённые поля (должны совпадать с FLOOR_FIELDS в floordata.js). note НЕТ.
const ALLOWED = new Set([
  'id', 'name', 'code', 'article', 'department', 'group_id', 'category',
  'is_weighted', 'unit', 'retail_price', 'arrival_at', 'created_at',
  'stock_state', 'photos', 'barcodes',
]);
const SENTINELS = ['777.77', '4242424242', 'ТАЙНЫЙ_ПОСТАВЩИК', '13.13', 'Закупка 999'];

(async () => {
  const b = await chromium.launch();
  const { chk, done } = runner('ДАННЫЕ ЗАЛА БЕЗ ДЕНЕГ');
  const { page } = await newPage(b, {});

  const out = await page.evaluate((sent) => {
    const P = window.WM_PUBLISH; const s = P._state();
    s.products = [
      { // обычный товар со всеми денежными полями верхнего уровня
        id: 'p1', name: 'Молоко 1л', code: '100500', barcodes: ['4600000000011'],
        article: 'A-1', department: 'Молочка', group_id: 'g1', unit: 'шт',
        retail_price: 89, photos: [], arrival_at: '2026-10-01', stock_state: 'in',
        note: 'пробивать по коду',
        cost: sent[0], buy_price: sent[0], purchase: sent[0],
        supplier_id: sent[2], supplier_ids: [sent[2]], margin: 42, stock: 7, stock_qty: 7,
      },
      { // «хитрый» товар: объект в photos/barcodes и деньги в note (пример из аудита)
        id: 'p2', name: 'Товар 2', code: '200',
        photos: [{ url: 'x', buy_price: sent[0] }, 'ok.jpg'],
        barcodes: [{ code: sent[1] }, 4600000000099],
        note: 'Закупка 999 ₽ у поставщика',
      },
    ];
    s.groups = [{ id: 'g1', name: 'Молочные', sort_order: 1 }];
    s.prices = [{ product_id: 'p1', supplier_id: sent[2], price: sent[0], price_date: '2026-10-01' }];
    s.sales = [{ code: '100500', name: 'Молоко 1л', qty: 10, amount: sent[3] }];
    s.contacts = { [sent[2]]: { phone: sent[1] } };
    /* История ценника: нужна залу (перепечатать ценники), но и в ней не должно
       оказаться ничего лишнего — проверяем «хитрую» строку с закупкой и чужой
       товар, которого в выгрузке нет. */
    s.retailHist = {
      p1: [{ price: 79, at: '2026-09-20', cost: sent[0], supplier: sent[2] }],
      p2: [{ price: 0, at: '2026-09-01' }],
      pX: [{ price: 55, at: '2026-09-02' }],
    };
    const data = window.WM_FLOOR.buildFloorData(s.products, s.groups, s.retailHist);
    return { data, json: JSON.stringify(data) };
  }, SENTINELS);

  const [p1, p2] = out.data.products;
  const allKeys = [...Object.keys(p1), ...Object.keys(p2)];

  chk(out.data.products.length === 2, 'оба товара на месте');
  chk(allKeys.every((k) => ALLOWED.has(k)), 'только разрешённые поля: ' + [...new Set(allKeys)].join(','));
  chk(p1.code === '100500' && p1.article === 'A-1' && p1.department === 'Молочка', 'нужное для кассы на месте');
  chk(p1.note === undefined && p2.note === undefined, 'свободного note в данных зала нет');
  chk(p1.cost === undefined && p1.supplier_ids === undefined && p1.stock === undefined, 'деньги верхнего уровня срезаны');
  chk(Array.isArray(p2.photos) && p2.photos.every((x) => typeof x === 'string'), 'photos — только строки (объект с buy_price выкинут)');
  chk(Array.isArray(p2.barcodes) && p2.barcodes.every((x) => typeof x === 'string'), 'barcodes — только строки (объект выкинут)');
  chk(!('prices' in out.data) && !('sales' in out.data) && !('contacts' in out.data), 'нет массивов цен/продаж/контактов');
  const rh = out.data.retailHist || {};
  chk(rh.p1 && rh.p1.length === 1 && rh.p1[0].price === 79 && rh.p1[0].at === '2026-09-20',
    'история РОЗНИЧНОГО ценника дошла до зала (по ней он перепечатывает ценники)');
  chk(Object.keys(rh.p1[0]).join(',') === 'price,at', 'в строке истории только цена и дата: ' + Object.keys(rh.p1[0]).join(','));
  chk(!rh.p2 && !rh.pX, 'пустые и чужие записи истории выброшены');

  const leaked = SENTINELS.filter((v) => out.json.includes(v));
  chk(leaked.length === 0, 'ни одной денежной метки в данных зала' + (leaked.length ? ': ' + leaked.join(',') : ''));

  await done(b);
})();

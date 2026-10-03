// Безопасность роли «Сотрудник зала»: данные зала НЕ содержат денег.
// Сотрудник зала видит коды кассы/штрихкоды/артикул/отдел, но закупочные
// цены, продажи и контакты поставщиков в его данные попадать не должны —
// ни в каком виде. Этот тест ловит утечку по полю и по значению-метке.
const { chromium, newPage, runner } = require('./helpers');

// Разрешённые поля (должны совпадать с FLOOR_FIELDS в floordata.js)
const ALLOWED = new Set([
  'id', 'name', 'code', 'barcodes', 'article', 'department', 'group_id',
  'category', 'is_weighted', 'unit', 'retail_price', 'photos',
  'arrival_at', 'created_at', 'stock_state', 'note',
]);
// Значения-метки: если всплывут в данных зала — значит деньги утекли
const SENTINELS = ['777.77', '4242424242', 'ТАЙНЫЙ_ПОСТАВЩИК', '13.13'];

(async () => {
  const b = await chromium.launch();
  const { chk, done } = runner('ДАННЫЕ ЗАЛА БЕЗ ДЕНЕГ');
  const { page } = await newPage(b, {});

  const out = await page.evaluate((sent) => {
    const P = window.WM_PUBLISH; const s = P._state();
    // товар со ВСЕМИ полями, включая денежные/секретные
    s.products = [{
      id: 'p1', name: 'Молоко 1л', code: '100500', barcodes: ['4600000000011'],
      article: 'A-1', department: 'Молочка', group_id: 'g1', unit: 'шт',
      retail_price: 89, photos: [], arrival_at: '2026-10-01', stock_state: 'in',
      note: 'пробивать по коду',
      // то, чего зал видеть НЕ должен:
      cost: sent[0], buy_price: sent[0], purchase: sent[0],
      supplier_id: sent[2], supplier_ids: [sent[2]], margin: 42, stock: 7, stock_qty: 7,
    }];
    s.groups = [{ id: 'g1', name: 'Молочные', sort_order: 1 }];
    // денежные массивы состояния — их в floor-данные класть нельзя
    s.prices = [{ product_id: 'p1', supplier_id: sent[2], price: sent[0], price_date: '2026-10-01' }];
    s.sales = [{ code: '100500', name: 'Молоко 1л', qty: 10, amount: sent[3] }];
    s.contacts = { [sent[2]]: { phone: sent[1] } };
    const data = P.buildFloorData(s.products, s.groups);
    return { data, json: JSON.stringify(data) };
  }, SENTINELS);

  const prod = out.data.products[0];
  const keys = Object.keys(prod);

  chk(!!out.data.products && out.data.products.length === 1, 'есть товар в данных зала');
  chk(keys.every((k) => ALLOWED.has(k)), 'у товара только разрешённые поля (нет лишних): ' + keys.join(','));
  chk(prod.code === '100500' && prod.article === 'A-1' && prod.department === 'Молочка',
    'нужное для кассы на месте: код, артикул, отдел');
  chk(prod.cost === undefined && prod.buy_price === undefined && prod.purchase === undefined,
    'закупочной цены у товара нет');
  chk(prod.supplier_id === undefined && prod.supplier_ids === undefined, 'поставщиков у товара нет');
  chk(prod.stock === undefined && prod.stock_qty === undefined, 'точного остатка числом нет');
  chk(!('prices' in out.data) && !('sales' in out.data) && !('contacts' in out.data),
    'в данных зала нет массивов цен/продаж/контактов');
  const leaked = SENTINELS.filter((v) => out.json.includes(v));
  chk(leaked.length === 0, 'ни одной денежной метки в данных зала (утечки нет)' + (leaked.length ? ': ' + leaked.join(',') : ''));

  await done(b);
})();

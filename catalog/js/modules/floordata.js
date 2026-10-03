// Данные для «Сотрудника зала» — без денег
//
// Сотрудник зала входит отдельным коротким кодом и должен видеть ВСЁ, что
// нужно, чтобы пробить товар на кассе: код кассы, штрихкоды, артикул, отдел,
// группу, фото, наличие словом. Но НИКОГДА — деньги магазина: закупочные
// цены, поставщиков, продажи/«Ходовые», наценку.
//
// Поэтому для зала собирается ОТДЕЛЬНЫЙ набор данных: сюда переносятся только
// разрешённые поля товара, а денежные массивы (prices, sales, contacts и т.п.)
// не кладутся вовсе. Файл зала шифруется кодом зала (floor.enc), так что даже
// тот, у кого есть код зала, физически не достанет закупки — их там нет.

// Единственный «белый список» полей товара, которые видит зал.
// Всё, чего здесь нет, в данные зала не попадает.
export const FLOOR_FIELDS = [
  'id', 'name', 'code', 'barcodes', 'article', 'department', 'group_id',
  'category', 'is_weighted', 'unit', 'retail_price', 'photos',
  'arrival_at', 'created_at', 'stock_state', 'note',
];

// Поля, которых в данных зала быть НЕ ДОЛЖНО ни при каких условиях.
// Нужны тесту безопасности: если что-то из этого просочилось — тест падает.
export const FLOOR_FORBIDDEN = [
  'prices', 'sales', 'contacts', 'orders', 'orderRules', 'compPrices',
  'competitors', 'retailHist', 'unitCoef', 'staffPassword',
  'cost', 'buy_price', 'purchase', 'supplier_id', 'supplier_ids',
  'margin', 'markup', 'stock', 'stock_qty',
];

// Один товар → только разрешённые поля (и только непустые).
export function floorProduct(p) {
  const o = {};
  for (const k of FLOOR_FIELDS) if (p[k] != null) o[k] = p[k];
  return o;
}

// Весь набор данных зала: товары (урезанные) + группы (имя и порядок).
// На вход — то же состояние, что у владельца; на выходе — ничего денежного.
export function buildFloorData(products, groups) {
  return {
    v: 1,
    products: (products || []).map(floorProduct),
    groups: (groups || []).map((g) => ({ id: g.id, name: g.name, sort_order: g.sort_order })),
  };
}

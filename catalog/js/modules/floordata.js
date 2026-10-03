// Данные для «Сотрудника зала» — без денег
//
// Сотрудник зала входит отдельным коротким кодом и должен видеть ВСЁ, что
// нужно, чтобы пробить товар на кассе: код кассы, штрихкоды, артикул, отдел,
// группу, фото, наличие словом. Но НИКОГДА — деньги магазина: закупочные
// цены, поставщиков, продажи/«Ходовые», наценку.
//
// Для зала собирается ОТДЕЛЬНЫЙ набор данных: переносятся только разрешённые
// поля, и только как ПРИМИТИВЫ. Это важно: разрешённое поле с «хитрым»
// содержимым — тоже канал утечки (например, фото пришло объектом
// {url, buy_price} из кривого импорта, или в свободном примечании написана
// сумма закупки). Поэтому:
//   • скалярные поля берём, только если это строка/число/логическое;
//   • массивы (photos, barcodes) — только строковые/числовые элементы;
//   • свободный текст note в данные зала НЕ кладём вовсе (там может оказаться
//     закупочная сумма) — сотруднику зала он не нужен для кассы.

// Скалярные поля (копируются, только если значение — примитив).
const FLOOR_SCALAR = [
  'id', 'name', 'code', 'article', 'department', 'group_id', 'category',
  'is_weighted', 'unit', 'retail_price', 'arrival_at', 'created_at', 'stock_state',
];
// Поля-массивы: оставляем только строковые/числовые элементы (объекты выкидываем).
const FLOOR_ARRAY = ['photos', 'barcodes'];

// Полный список разрешённых ключей (для тестов и ревью).
export const FLOOR_FIELDS = [...FLOOR_SCALAR, ...FLOOR_ARRAY];

// Поля, которых в данных зала быть НЕ ДОЛЖНО ни при каких условиях.
export const FLOOR_FORBIDDEN = [
  'prices', 'sales', 'contacts', 'orders', 'orderRules', 'compPrices',
  'competitors', 'retailHist', 'unitCoef', 'staffPassword', 'note',
  'cost', 'buy_price', 'purchase', 'supplier_id', 'supplier_ids',
  'margin', 'markup', 'stock', 'stock_qty',
];

const isPrim = (v) => typeof v === 'string' || typeof v === 'number' || typeof v === 'boolean';

// Один товар → только разрешённые поля, только примитивы и строковые массивы.
export function floorProduct(p) {
  const o = {};
  if (!p || typeof p !== 'object') return o;
  for (const k of FLOOR_SCALAR) {
    if (p[k] != null && isPrim(p[k])) o[k] = p[k];
  }
  for (const k of FLOOR_ARRAY) {
    if (Array.isArray(p[k])) {
      // только строки/числа → в строку; объекты и вложенность выкидываем
      const arr = p[k].filter((x) => typeof x === 'string' || typeof x === 'number').map(String).filter((s) => s.trim());
      if (arr.length) o[k] = arr;
    }
  }
  return o;
}

// Весь набор данных зала: товары (урезанные) + группы (имя и порядок — строками).
export function buildFloorData(products, groups) {
  return {
    v: 1,
    products: (products || []).map(floorProduct),
    groups: (groups || []).map((g) => ({
      id: isPrim(g.id) ? g.id : '',
      name: isPrim(g.name) ? g.name : '',
      sort_order: typeof g.sort_order === 'number' ? g.sort_order : 0,
    })),
  };
}

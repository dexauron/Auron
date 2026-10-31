// Качество поиска: что именно человек находит, набирая слово, код или с опечаткой.
// Этот набор — страховка при любом ускорении поиска: скорость меняем, выдачу нет.
const { chromium, newPage, asOwner, runner } = require('./helpers');

const products = [
  { id: 'p1', name: 'Молоко Простоквашино 3.2% 930мл', code: '100500', group_id: 'g1', retail_price: 89, unit: 'шт', photos: [], barcodes: ['4600000000011'] },
  { id: 'p2', name: 'Молоко Домик в деревне 2.5% 950мл', code: '100501', group_id: 'g1', retail_price: 79, unit: 'шт', photos: [], barcodes: ['4600000000028'] },
  { id: 'p3', name: 'Вода Святой источник 0,5л', code: '200100', group_id: 'g2', retail_price: 35, unit: 'шт', photos: [], barcodes: [] },
  { id: 'p4', name: 'Водолей лимонад 1,5л', code: '200101', group_id: 'g2', retail_price: 65, unit: 'шт', photos: [], barcodes: [] },
  { id: 'p5', name: 'Сок Добрый яблочный 1л', code: '200102', group_id: 'g2', retail_price: 99, unit: 'шт', photos: [], barcodes: [] },
  { id: 'p6', name: 'Коктейль высокобелковый шоколад', code: '200103', group_id: 'g2', retail_price: 120, unit: 'шт', photos: [], barcodes: [] },
  { id: 'p7', name: 'Рис Мистраль круглозерный 900г', code: '300100', group_id: 'g3', retail_price: 145, unit: 'шт', photos: [], barcodes: [] },
  { id: 'p8', name: 'Ирис Кис-кис 250г', code: '300101', group_id: 'g4', retail_price: 110, unit: 'шт', photos: [], barcodes: [] },
  { id: 'p9', name: 'Хот-дог классический', code: '400100', group_id: 'g5', retail_price: 150, unit: 'шт', photos: [], barcodes: [] },
  { id: 'p10', name: 'Snickers батончик 50г', code: '400101', group_id: 'g4', retail_price: 75, unit: 'шт', photos: [], barcodes: [] },
  { id: 'p11', name: 'Яшкино Печенье овсяное 300г', code: '400102', group_id: 'g4', retail_price: 95, unit: 'шт', photos: [], barcodes: [] },
  { id: 'p12', name: 'Гвоздь строительный арт. 8816', code: '500100', group_id: 'g6', retail_price: 15, unit: 'кг', photos: [], barcodes: [], is_weighted: true },
  { id: 'p13', name: 'Сыр Ламбер 500г', code: '500101', group_id: 'g1', retail_price: 450, unit: 'шт', photos: [], barcodes: ['4600000000035'] },
];
const groups = [
  { id: 'g1', name: 'Молочные продукты' }, { id: 'g2', name: 'Напитки' },
  { id: 'g3', name: 'Крупы' }, { id: 'g4', name: 'Сладости' },
  { id: 'g5', name: 'Готовая еда' }, { id: 'g6', name: 'Хозтовары' },
];

(async () => {
  const b = await chromium.launch();
  const { chk, done } = runner('КАЧЕСТВО ПОИСКА');
  const { page, errs } = await newPage(b, { products, groups });
  await asOwner(page, {});
  await page.waitForTimeout(300);

  // что находится по запросу — списком названий, в порядке выдачи
  const find = (q) => page.evaluate((query) => {
    const P = window.WM_PUBLISH;
    P._state().query = query;
    return P.visibleProducts().map((p) => p.name);
  }, q);

  const cases = [
    ['молоко', 'Молоко', 'находит товар по первому слову'],
    ['простоквашино', 'Молоко Простоквашино 3.2% 930мл', 'находит по слову в середине названия'],
    ['просток', 'Молоко Простоквашино 3.2% 930мл', 'находит по началу слова, не дописывая его'],
    ['вода', 'Вода Святой источник 0,5л', 'целое слово важнее куска: «вода» — это вода, а не «Водолей»'],
    ['сок', 'Сок Добрый яблочный 1л', '«сок» не лезет в «Высокобелковый»'],
    ['рис', 'Рис Мистраль круглозерный 900г', '«рис» не лезет в «Ирис»'],
    ['дог', 'Хот-дог классический', 'находит слово после дефиса'],
    ['хатдок', 'Хот-дог классический', 'прощает опечатку'],
    ['сникерс', 'Snickers батончик 50г', 'находит латиницу по русскому написанию'],
    ['snickers', 'Snickers батончик 50г', 'находит и по латинице'],
    ['печенье яшкино', 'Яшкино Печенье овсяное 300г', 'слова в любом порядке'],
    ['100500', 'Молоко Простоквашино 3.2% 930мл', 'находит по коду'],
    ['4600000000035', 'Сыр Ламбер 500г', 'находит по штрихкоду'],
    ['арт8816', 'Гвоздь строительный арт. 8816', 'находит артикул без знаков и пробелов'],
    ['ламбер', 'Сыр Ламбер 500г', 'находит по второму слову'],
  ];

  for (const [q, expect, why] of cases) {
    const res = await find(q);
    const top = res[0] || '—';
    chk(top === expect || (expect === 'Молоко' && top.startsWith('Молоко')),
      `«${q}» → ${why} (первым: ${top})`);
  }

  // мусор в выдаче: по «вода» не должно вываливаться пол-каталога
  const water = await find('вода');
  chk(water.length <= 3, `«вода» не тащит хвост слабых совпадений (${water.length})`);
  const nothing = await find('зюзюка');
  chk(nothing.length === 0, `бессмыслица честно ничего не находит (${nothing.length})`);
  const both = await find('молоко');
  chk(both.length === 2, `оба молока находятся по общему слову (${both.length})`);

  chk(!errs.length, `нет сбоев JS (${errs.length}${errs.length ? ': ' + errs[0] : ''})`);
  await done(b);
})();

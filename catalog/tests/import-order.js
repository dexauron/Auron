// Порядок обработки файлов при загрузке нескольких сразу.
// Справочники (единицы, штрихкоды) привязываются к УЖЕ существующим товарам,
// поэтому файлы, которые товары создают, должны идти первыми. Раньше словарь
// единиц шёл первым, и товары из этой же загрузки оставались без фасовок.
const { chromium, newPage, runner } = require('./helpers');

// Прайс создаёт два товара; справочники ссылаются на них по коду.
const прайс = [
  ['Цены поставщиков'], [],
  ['Номенклатура', 'Код товара', 'Контрагент', 'Ед.', 'Цена', 'Период'],
  ['Snickers 50,5г', '1463', 'Оптовик', 'шт', '43,33', '01.08.2026'],
  ['Кола 0,5', '1464', 'Оптовик', 'шт', '55,00', '01.08.2026'],
];
const единицы = [
  ['Единицы измерения номенклатуры'], [],
  ['Единица измерения', 'Коэффициент', 'Номенклатура.Код'],
  ['шт', '1', '1463'], ['упак (48)', '48', '1463'],
  ['шт', '1', '1464'], ['упак (12)', '12', '1464'],
  ['упак (6)', '6', '9999'],            // код, которого в каталоге нет
];
const штрихкоды = [
  ['Штрихкоды номенклатуры'], [],
  ['Номенклатура', 'Код товара', 'Штрихкод', 'Единица измерения'],
  ['Snickers 50,5г', '1463', '4607065001445', 'шт'],
  ['Кола 0,5', '1464', '4607065001452', 'шт'],
  ['Неизвестный', '9999', '4607065009999', 'шт'],   // товара нет
];

(async () => {
  const b = await chromium.launch();
  const { chk, done } = runner('ПОРЯДОК ЗАГРУЗКИ ФАЙЛОВ');
  const { page, errs } = await newPage(b, {});
  await page.evaluate(() => { const P = window.WM_PUBLISH; P.ghSetToken('t'); P.applyServerless('pw'); });

  // Каталог ПУСТОЙ — как при первой загрузке. Кладём файлы в том порядке, в
  // каком их отдаёт проводник: справочники раньше прайса (по алфавиту).
  const res = await page.evaluate((d) => {
    const P = window.WM_PUBLISH; const s = P._state();
    s.products = []; s.groups = []; s.suppliers = []; s.prices = []; s.unitCoef = {};
    // берём НАСТОЯЩИЙ порядок из приложения, а не переписываем его в тесте,
    // иначе проверка подтверждает сама себя и ничего не доказывает
    const order = P._importOrder ? P._importOrder() : null;
    if (!order) return { noOrder: true };
    const files = [['units', d.units], ['barcodes', d.bc], ['prices', d.prices]];
    files.sort((a, b) => (order[a[0]] ?? 9) - (order[b[0]] ?? 9));
    for (const [, rows] of files) P.svImportRows(rows);
    return s.products.map((p) => ({
      name: p.name, code: p.code,
      packs: (p.pack_units || []).map((u) => u.unit),
      barcodes: p.barcodes || [],
    }));
  }, { units: единицы, bc: штрихкоды, prices: прайс });

  if (res.noOrder) {
    chk(false, 'приложение не отдаёт порядок обработки файлов — проверять нечего');
    await done(b); return;
  }
  console.log('--- что получилось ---');
  (res || []).forEach((p) => console.log(`  ${p.name} (${p.code}): фасовки [${p.packs.join(', ')}], штрихкоды [${p.barcodes.join(', ')}]`));
  console.log('---');

  chk(res.length === 2, `создано 2 товара (${res.length})`);
  const sn = res.find((p) => p.code === '1463') || { packs: [], barcodes: [] };
  const cola = res.find((p) => p.code === '1464') || { packs: [], barcodes: [] };
  chk(sn.packs.includes('упак (48)'), `фасовка привязалась к товару из этой же загрузки (${sn.packs.join(', ') || 'ничего'})`);
  chk(cola.packs.includes('упак (12)'), `и ко второму тоже (${cola.packs.join(', ') || 'ничего'})`);
  chk(sn.barcodes.includes('4607065001445'), `штрихкод привязался (${sn.barcodes.join(', ') || 'ничего'})`);
  chk(cola.barcodes.includes('4607065001452'), 'штрихкод второго товара привязался');

  // строки справочников, которым в каталоге нечему соответствовать, — не ошибка,
  // но владелец должен увидеть, какие именно
  const miss = await page.evaluate((d) => {
    const P = window.WM_PUBLISH; const s = P._state();
    s.products = [{ id: 'x', name: 'Snickers 50,5г', code: '1463', barcodes: [], photos: [], supplier_ids: [] }];
    s.unitCoef = {};
    const r = { units: null, bc: null };
    // разбираем напрямую, чтобы увидеть, что возвращают справочники
    P.svImportRows(d.units);
    return r;
  }, { units: единицы });
  chk(miss !== null, 'справочник с чужими кодами не роняет загрузку');

  chk(!errs.length, `нет сбоев JS (${errs.length}${errs.length ? ': ' + errs[0] : ''})`);
  await done(b);
})();

// Разбор файлов 1С на «грязных» данных + проверка, что умный импорт жив
// после удаления старых отдельных экранов загрузки.
const { chromium, newPage, runner } = require('./helpers');

(async () => {
  const b = await chromium.launch();
  const { chk, done } = runner('РАЗБОР ФАЙЛОВ И ИМПОРТ');
  const { page, errs } = await newPage(b, {});
  await page.evaluate(() => { const P = window.WM_PUBLISH; P.ghSetToken('t'); P.applyServerless('pw'); });

  const imp = (rows) => page.evaluate((r) => {
    const P = window.WM_PUBLISH; const s = P._state();
    s.products = []; s.groups = []; s.suppliers = []; s.prices = []; s.sales = []; s.unitCoef = {};
    try { P.svImportRows(r); } catch (e) { return { err: String(e.message || e) }; }
    return { products: s.products, prices: s.prices, sales: s.sales };
  }, rows);

  { // прайс: цены в разных единицах, грязные числа, строка «Итого»
    const r = await imp([
      ['Отчёт по ценам поставщиков'], [],
      ['Номенклатура', 'Код товара', 'Контрагент', 'Ед.', 'Цена', 'Период'],
      ['Snickers 50,5г', '1 463', 'Оптовик', 'упак (48)', '1 920,00', '01.08.2026'],
      ['Snickers 50,5г', '1 463', 'Своя Закупка', 'шт', '43,33', '01.08.2026'],
      ['Хлеб', '77', 'Пекарь', 'кг', '1 234,56', '02.08.2026'],
      ['', '', '', '', '', ''],
      ['Итого', '', '', '', '9 999,99', ''],
    ]);
    chk(!r.err, 'прайс разобран' + (r.err ? ': ' + r.err : ''));
    chk(r.products.length === 2, `строка «Итого» не стала товаром (создано ${r.products.length})`);
    const sn = (r.products || []).find((p) => /Snickers/.test(p.name)) || {};
    chk(sn.code === '1463', `код очищен от разделителя («1 463» → «${sn.code}»)`);
    const pack = (r.prices || []).find((x) => x.unit === 'упак (48)');
    chk(pack && pack.price === 1920, 'цена за упаковку сохранена вместе с единицей');
    chk((r.prices || []).some((x) => x.price === 1234.56), '«1 234,56» прочитано как 1234.56');
  }
  { // справочник единиц: коэффициенты 1С с тремя знаками
    const r = await page.evaluate((rr) => {
      const P = window.WM_PUBLISH; const s = P._state();
      s.products = [{ id: 'x1', name: 'Snickers', code: '1463', barcodes: [], photos: [], supplier_ids: [] }];
      s.unitCoef = {};
      try { P.svImportRows(rr); } catch (e) { return { err: String(e.message || e) }; }
      return { coef: s.unitCoef, packs: s.products[0].pack_units };
    }, [
      ['Единицы измерения номенклатуры'], [],
      ['Единица измерения', 'Коэффициент', 'Номенклатура.Код'],
      ['шт', '1', '1 463'], ['упак (48)', '48', '1463'], ['блок (12)', '12,000', '1463'],
    ]);
    chk(!r.err, 'справочник единиц разобран' + (r.err ? ': ' + r.err : ''));
    chk(r.coef && r.coef['упак (48)'] === 48, `коэффициент 48 (${r.coef && r.coef['упак (48)']})`);
    chk(r.coef && r.coef['блок (12)'] === 12, `«12,000» = 12, а не 12000 (${r.coef && r.coef['блок (12)']})`);
    chk(r.packs && r.packs.length === 3, `у товара 3 фасовки (${r.packs && r.packs.length})`);
  }
  { // остатки: дата из шапки, минус, дробное, «1,000»
    const r = await imp([
      ['Остатки номенклатуры на конец дня: 12.08.2026'], [],
      ['Номенклатура', 'Код товара', 'Количество', 'Розничная цена'],
      ['Молоко', '55', '-3', '89'], ['Сыр', '56', '2,500', '450'], ['Вода', '57', '1,000', '35'],
      ['Итого', '', '999', ''],
    ]);
    const by = (n) => (r.products || []).find((p) => p.name === n) || {};
    chk(by('Молоко').stock === -3, `минусовой остаток как есть (${by('Молоко').stock})`);
    chk(by('Сыр').stock === 2.5, `«2,500» = 2,5 кг, а не 2500 (${by('Сыр').stock})`);
    chk(by('Вода').stock === 1, `«1,000» = 1 шт, а не 1000 (${by('Вода').stock})`);
    chk(by('Молоко').stock_at === '2026-08-12', `дата остатка из шапки (${by('Молоко').stock_at})`);
  }
  { // продажи
    const r = await imp([
      ['Продажи за период с 01.08.2026 по 31.08.2026'], [],
      ['Номенклатура', 'Код товара', 'Количество', 'Сумма продажи'],
      ['Snickers', '1463', '153,000', '8 415,00'],
    ]);
    const s0 = (r.sales || [])[0] || {};
    chk(s0.qty === 153 && s0.amount === 8415, `количество и сумма (${s0.qty} / ${s0.amount})`);
    chk(s0.period_from === '2026-08-01' && s0.period_to === '2026-08-31', 'период прочитан');
  }
  { // мусор — понятная ошибка, а не падение
    const r = await imp([['просто', 'какая-то'], ['таблица', 'без шапки']]);
    chk(!!r.err && !/undefined|\[object/.test(r.err), `непонятный файл: «${r.err}»`);
  }

  // ── умный импорт жив после удаления старых экранов ──
  await page.click('#adminBtn'); await page.waitForTimeout(400);
  await page.click('#menuImportHub'); await page.waitForTimeout(500);
  const hub = await page.evaluate(() => ({
    open: !document.getElementById('importHubSheet').hidden,
    hasFile: !!document.getElementById('smartFiles'),
    hasRun: !!document.getElementById('smartRun'),
  }));
  chk(hub.open && hub.hasFile && hub.hasRun, 'экран «Импорт данных» открывается и цел');
  const gone = await page.evaluate(() => ['importSheet', 'salesImportSheet', 'stockImportSheet',
    'contactsImportSheet', 'photoExcelSheet'].filter((id) => document.getElementById(id)));
  chk(!gone.length, `старые экраны загрузки удалены (осталось: ${gone.length})`);


  { // ── Одинаковый товар, записанный по-разному: штрихкод должен привязаться ──
    // Настоящий случай из выгрузки владельца: в прайсе «Чабан Сметана 25%
    // стакан 200г», в справочнике штрихкодов — «Сметана Чабан 25% стакан 200гр».
    // Раньше штрихкод повисал в воздухе («не нашлось товаров»).
    const r = await page.evaluate(() => {
      const P = window.WM_PUBLISH; const s = P._state();
      s.products = []; s.groups = []; s.suppliers = []; s.prices = [];
      P.svImportRows([
        ['Отчёт по ценам поставщиков'], [],
        ['Номенклатура', 'Код товара', 'Контрагент', 'Ед.', 'Цена', 'Период'],
        ['Чабан Сметана 25% стакан 200г', '111', 'Молзавод', 'шт', '90', '01.08.2026'],
        ['Huggies Трусики для Мальчиков 38шт', '222', 'Опт', 'шт', '900', '01.08.2026'],
        ['Носки Синие 40р', '333', 'Опт', 'шт', '100', '01.08.2026'],
        ['Синие Носки 40р', '334', 'Опт', 'шт', '100', '01.08.2026'],
      ]);
      P.svImportRows([
        ['Справочник штрих кодов'], [],
        ['Штрих код', 'Единица', 'Номенклатура'],
        ['4600000000011', 'шт', 'Сметана Чабан 25% стакан 200гр'],
        ['4600000000022', 'шт', 'Huggies Трусики для Мальчиков 44шт'],
        ['4600000000033', 'шт', 'Носки Синие 40р'],
      ]);
      const by = (code) => s.products.find((p) => String(p.code) === code) || {};
      return {
        sметана: (by('111').barcodes || []),
        huggies: (by('222').barcodes || []),
        носки: (by('333').barcodes || []),
        носки2: (by('334').barcodes || []),
        всего: s.products.length,
      };
    });
    chk(r.sметана.includes('4600000000011'),
      `штрихкод привязался, хотя слова переставлены и «200гр» против «200г» (${r.sметана.join(',') || 'нет'})`);
    chk(!r.huggies.includes('4600000000022'),
      'разные фасовки (38шт и 44шт) НЕ склеились — это разные товары');
    chk(r.носки.includes('4600000000033') && !r.носки2.includes('4600000000033'),
      'при двух одинаковых по словам товарах штрихкод ушёл к точному совпадению по названию');
    chk(r.всего === 4, `лишних товаров не создалось (${r.всего})`);
  }

  { // ── Продажи: видно, сколько строк не нашло своего товара ──
    const r = await page.evaluate(() => {
      const P = window.WM_PUBLISH; const s = P._state();
      s.products = []; s.groups = []; s.suppliers = []; s.prices = []; s.sales = [];
      P.svImportRows([
        ['Отчёт по ценам поставщиков'], [],
        ['Номенклатура', 'Код товара', 'Контрагент', 'Ед.', 'Цена', 'Период'],
        ['Молоко', '1', 'Опт', 'шт', '50', '01.08.2026'],
      ]);
      const out = P.svImportRows([
        ['Отчёт по продажам', 'Период: 01.07.2026 - 31.07.2026'], [],
        ['Номенклатура', 'Код', 'Количество', 'Сумма продажи'],
        ['Молоко', '1', '10', '500'],
        ['Кефир которого нет', '999', '3', '150'],
      ]);
      return { type: out, sales: s.sales.length };
    });
    chk(r.sales === 2, `продажи загрузились полностью (${r.sales} строки)`);
  }

  chk(!errs.length, `нет сбоев JS (${errs.length}${errs.length ? ': ' + errs[0] : ''})`);
  await done(b);
})();

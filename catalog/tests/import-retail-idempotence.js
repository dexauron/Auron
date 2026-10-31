const { chromium, newPage, runner } = require('./helpers');
(async () => {
  const b = await chromium.launch();
  const { chk, done } = runner('ПОВТОРНЫЙ ИМПОРТ ОДИНАКОВЫХ НАЗВАНИЙ');
  const { page, errs } = await newPage(b, {});
  const result = await page.evaluate(() => {
    const P = window.WM_PUBLISH, s = P._state(); P.applyServerless('fixture-import-only');
    P.svImportRows([['Цены поставщиков'], ['Номенклатура', 'Код товара', 'Контрагент', 'Ед.', 'Цена'],
      ['Жевательная резинка 54г', '0011', 'Тестовый поставщик', 'шт', 30],
      ['Жевательная резинка 54г', '0022', 'Тестовый поставщик', 'шт', 40]]);
    s.products.find((p) => p.code === '0011').retail_price = 100;
    s.products.find((p) => p.code === '0022').retail_price = 200;
    const ids = s.products.map((p) => p.id).sort().join('|');
    const ambiguous = [['Прайс-лист'], ['Номенклатура', 'Розничный тип цен'], ['Жевательная резинка 54г', 99]];
    P.svImportRows(ambiguous); P.svImportRows(ambiguous);
    const kept = s.products.length === 2 && s.products.find((p) => p.code === '0011').retail_price === 100
      && s.products.find((p) => p.code === '0022').retail_price === 200;
    const explicit = [['Прайс-лист'], ['Номенклатура', 'Код товара', 'Розничный тип цен'], ['Жевательная резинка 54г', '0011', 99]];
    P.svImportRows(explicit); P.svImportRows(explicit);
    return { kept, n: s.products.length, ids: ids === s.products.map((p) => p.id).sort().join('|'),
      first: s.products.find((p) => p.code === '0011').retail_price,
      second: s.products.find((p) => p.code === '0022').retail_price };
  });
  chk(result.kept, 'неоднозначное название не создаёт пустую карточку и не меняет цену случайного товара');
  chk(result.n === 2 && result.ids, 'повторный прайс сохраняет количество и идентификаторы товаров');
  chk(result.first === 99 && result.second === 200, 'явный строковый код обновляет цену нужного товара и сохраняет ведущие нули');
  const guarded = await page.evaluate(async () => {
    const I = await import('./js/modules/imports.js');
    const P = window.WM_PUBLISH, s = P._state(), before = JSON.stringify(s.products);
    s.catalogNeedsRefresh = true; P._ui().smartEntries = [{ type: 'prices', name: 'fixture.xls' }];
    await I.smartRun();
    return before === JSON.stringify(s.products) && /файлы ещё не применены/.test(document.getElementById('smartStatus').textContent);
  });
  chk(guarded, 'импорт не применяется поверх непроверенной сохранённой копии');
  chk(!errs.length, `нет ошибок JS (${errs.join('; ')})`);
  await done(b);
})().catch((e) => { console.error(e); process.exitCode = 1; });

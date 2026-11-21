// Копия большого каталога обрабатывается порциями и сохраняет тот же состав
// публичных данных. Поздний кэш не перезаписывает уже выполненный вход.
const { chromium, newPage, runner } = require('./helpers');
(async () => {
  const b = await chromium.launch();
  const { chk, done } = runner('БОЛЬШОЙ КЭШ НА ТЕЛЕФОНЕ');
  const { page, errs } = await newPage(b, {});
  const result = await page.evaluate(async () => {
    const D = await import('./js/modules/data.js');
    const S = await import('./js/modules/store.js');
    const W = await import('./js/modules/publication-data.js');
    const rows = Array.from({ length: 20000 }, (_, i) => ({ id: 'fixture-' + i,
      name: 'Товар ' + String(20000 - i).padStart(5, '0'), code: String(i).padStart(6, '0'),
      retail_price: i / 100, photos: [], barcodes: ['000' + i], supplier_ids: ['private-supplier'],
      purchase_price: 50, password: 'fixture-private', _index: 'temporary',
    }));
    const expected = JSON.stringify(W.publicProducts(rows));
    await S.idbSet(S.CACHE_KEY, { products: rows, groups: [] });
    const loaded = await D.loadCache();
    const equal = expected === JSON.stringify(S.state.products);
    let ticks = 0;
    const interval = setInterval(() => { ticks++; }, 1);
    const loading = D.loadCache();
    await new Promise((resolve) => setTimeout(resolve, 5));
    S.state.session = { fixture: true }; S.state.role = 'admin';
    S.state.products = [{ id: 'signed-in-fixture', name: 'Данные вошедшего владельца' }];
    const accepted = await loading;
    clearInterval(interval);
    const ownerKept = S.state.products[0]?.id === 'signed-in-fixture';
    S.state.session = null; S.state.role = null;
    S.state.products = rows; D.saveCache();
    // Ещё одна правка, пока первая копия обрабатывается: последняя версия
    // должна сохраниться после неё, а не уступить место устаревшей записи.
    await new Promise((resolve) => setTimeout(resolve, 30));
    S.state.products = rows.concat({ id: 'last-fixture', name: 'Я Последняя правка', code: '000999', photos: [], barcodes: [] });
    D.saveCache();
    return { loaded, equal, accepted, ownerKept, ticks };
  });
  chk(result.loaded && result.equal, '20 000 товаров, коды и штрихкоды совпадают с прежним безопасным составом кэша');
  chk(result.ticks > 3, `во время обработки телефон получает время на другие действия (${result.ticks} тактов)`);
  chk(!result.accepted && result.ownerKept, 'поздняя публичная копия не перезаписывает данные после входа');
  const latest = await page.evaluate(async () => {
    const S = await import('./js/modules/store.js');
    const end = performance.now() + 15000;
    while (performance.now() < end) {
      const saved = await S.idbGet(S.CACHE_KEY);
      if (saved?.products?.length === 20001 && saved.products.some((p) => p.id === 'last-fixture')) return true;
      await new Promise((resolve) => setTimeout(resolve, 30));
    }
    return false;
  });
  chk(latest, 'последняя правка сохранена после серии запросов кэша');
  const fields = await page.evaluate(async () => {
    const S = await import('./js/modules/store.js');
    const saved = await S.idbGet(S.CACHE_KEY);
    const bad = saved.products.find((p) => ['password', 'purchase_price', 'supplier_ids', '_index'].some((key) => key in p));
    return bad ? Object.keys(bad) : [];
  });
  chk(!fields.length, `закупка, поставщики, пароли и поисковые поля не попадают в публичную копию (${fields.join(', ')})`);
  chk(!errs.length, `нет ошибок JavaScript (${errs.join('; ')})`);
  await done(b);
})().catch((e) => { console.error(e); process.exitCode = 1; });

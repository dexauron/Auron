// Обход всех экранов и кнопок в двух ролях: ловим сбои, «undefined»/«NaN»
// на экране и утечку внутренних данных покупателю. Это страховка для любых
// переделок интерфейса — сюда попадают «трудные» товары, а не идеальные.
const { chromium, newPage, asOwner, closeAll, openProduct, runner } = require('./helpers');

const now = '2026-01-01T00:00:00Z';
const mk = (i, extra) => Object.assign({
  id: 'p' + i, name: 'Товар номер ' + i, group_id: 'g1', supplier_ids: ['s1', 's2'], code: String(1000 + i),
  barcodes: ['460706500' + (1000 + i)], barcode_units: { ['460706500' + (1000 + i)]: 'шт' },
  is_weighted: false, unit: 'шт', retail_price: 50 + i, photos: [], created_at: now, updated_at: now,
}, extra || {});
const products = [
  mk(1, { pack_units: [{ unit: 'шт', coef: 1 }, { unit: 'упак (48)', coef: 48 }], stock: 12, stock_at: '2026-08-12' }),
  mk(2, { is_weighted: true, unit: 'кг', stock: 3.5, stock_at: '2026-08-12' }),   // весовой
  mk(3, { retail_price: null, stock: 0, stock_at: '2026-08-12' }),               // без цены, закончился
  mk(4, { barcodes: [], barcode_units: {} }),                                    // без штрихкода и остатков
  mk(5, { pack_units: [{ unit: 'упак', coef: null }] }),                         // упаковка без количества
];
const groups = [{ id: 'g1', name: 'Продукты', sort_order: 1 }];
const suppliers = [{ id: 's1', name: 'Своя Закупка' }, { id: 's2', name: 'Оптовик' }];
const prices = [
  { product_id: 'p1', supplier_id: 's1', price: 43.33, price_date: '2026-08-01', unit: 'шт' },
  { product_id: 'p1', supplier_id: 's2', price: 1920, price_date: '2026-08-01', unit: 'упак (48)' },
  { product_id: 'p2', supplier_id: 's1', price: 210, price_date: '2026-08-02', unit: 'кг' },
  { product_id: 'p3', supplier_id: 's1', price: 10, price_date: null, unit: null },            // без даты
  { product_id: 'p5', supplier_id: 's1', price: 99, price_date: '2026-01-01', unit: 'упак' },  // старая цена
];
const sales = [
  { code: '1001', name: 'Товар номер 1', qty: 153, amount: 8415, period_from: '2026-08-01', period_to: '2026-08-31' },
  { code: '1003', name: 'Товар номер 3', qty: 5, amount: 100, period_from: '2026-01-01', period_to: '2026-01-31' },
];
const competitors = [{ id: 'c1', name: 'Магнит' }];
const compPrices = [{ product_id: 'p1', competitor_id: 'c1', price: 59, observed_at: '2026-08-10' }];
const МУСОР = ['undefined', 'NaN', 'Infinity', '[object', 'null ₽'];

(async () => {
  const b = await chromium.launch();
  const { chk, done } = runner('ЭКРАНЫ И КНОПКИ');
  const problems = [];
  const cover = { cards: 0, menu: [], sorts: [], tabs: 0 };
  const { page, errs } = await newPage(b, { products, groups, comp: { stores: competitors, prices: compPrices } });
  await page.addInitScript(() => { addEventListener('unhandledrejection', (e) => { (window.__rej = window.__rej || []).push(String(e.reason)); }); });
  await asOwner(page, { prices, sales, suppliers, competitors, compPrices });

  // ── каждая карточка ──
  for (const p of products) {
    await openProduct(page, p.id);
    if (await page.evaluate(() => document.getElementById('productSheet').hidden)) { problems.push(`карточка ${p.id} не открылась`); continue; }
    cover.cards++;
    await page.evaluate(() => document.querySelectorAll('#productSheet details').forEach((d) => { d.open = true; }));
    await page.waitForTimeout(150);
    const txt = await page.evaluate(() => document.querySelector('#productSheet .sheet').innerText);
    for (const bad of МУСОР) {
      if (txt.includes(bad)) problems.push(`карточка ${p.id}: «${bad}» → ${txt.split('\n').find((l) => l.includes(bad))}`);
    }
    // калькулятор на граничных вводах
    if (await page.locator('#calcOpenBtn').count()) {
      await page.click('#calcOpenBtn'); await page.waitForTimeout(250);
      for (const v of ['', '0', '-5', '999999999', 'абв', '0,5']) {
        await page.evaluate((x) => { const el = document.getElementById('calcPrice'); el.value = x; el.dispatchEvent(new Event('input', { bubbles: true })); }, v);
        await page.waitForTimeout(70);
        const r = await page.evaluate(() => document.getElementById('calcResult').innerText);
        for (const bad of МУСОР) if (r.includes(bad)) problems.push(`калькулятор ${p.id}, ввод «${v}»: «${bad}»`);
      }
      await closeAll(page);
    }
  }
  chk(cover.cards === products.length, `открылись все карточки (${cover.cards} из ${products.length})`);

  // ── разделы нижней панели ──
  for (const t of ['cats', 'fav', 'catalog']) {
    await closeAll(page);
    await page.click(`.tabbar [data-tab="${t}"]`); await page.waitForTimeout(400);
    const ok = await page.evaluate((x) => document.querySelector(`.tabbar [data-tab="${x}"]`).classList.contains('active'), t);
    if (!ok) problems.push(`раздел «${t}» не включился`); else cover.tabs++;
  }
  chk(cover.tabs === 3, `разделы панели переключаются (${cover.tabs} из 3)`);

  // ── меню ──
  await closeAll(page); await page.click('#adminBtn'); await page.waitForTimeout(400);
  const menuIds = await page.evaluate(() => [...document.querySelectorAll('#adminMenuSheet button[id]')]
    .filter((x) => x.offsetParent !== null).map((x) => x.id));
  // кнопки-действия ничего не открывают, они сразу делают работу
  const ACTIONS = ['menuLogout', 'menuDedup', 'menuSortCats'];
  for (const id of menuIds) {
    if (ACTIONS.includes(id)) continue;
    await closeAll(page); await page.click('#adminBtn'); await page.waitForTimeout(250);
    await page.click('#' + id).catch((e) => problems.push(`меню «${id}»: ${e.message.slice(0, 60)}`));
    await page.waitForTimeout(500);
    const open = await page.evaluate(() => [...document.querySelectorAll('.sheet-backdrop')].filter((x) => !x.hidden).map((x) => x.id));
    if (!open.length) problems.push(`меню «${id}»: ничего не открылось`); else cover.menu.push(id);
  }
  chk(cover.menu.length >= 6, `пункты меню открываются (${cover.menu.length}: ${cover.menu.join(', ')})`);

  // ── сортировка и поиск ──
  await closeAll(page); await page.click('#filterBtn'); await page.waitForTimeout(400);
  const sorts = await page.evaluate(() => [...document.querySelectorAll('#filterSheet [data-sort]')].map((x) => x.dataset.sort));
  for (const s of sorts) {
    await page.click(`#filterSheet [data-sort="${s}"]`).catch(() => problems.push(`сортировка «${s}» не нажалась`));
    await page.waitForTimeout(200);
    const n = await page.evaluate(() => document.querySelectorAll('#productGrid .card').length);
    if (!n) problems.push(`сортировка «${s}»: сетка опустела`); else cover.sorts.push(s);
  }
  chk(cover.sorts.length === sorts.length, `все сортировки работают (${cover.sorts.join(', ')})`);
  await closeAll(page);
  for (const q of ['товар', 'ТОВАР 1', '1001', '4607065001001', 'ъъъ', '   ']) {
    await page.fill('#searchInput', q); await page.waitForTimeout(350);
    const st = await page.evaluate(() => ({
      n: document.querySelectorAll('#productGrid .card').length,
      empty: !document.getElementById('emptyState').hidden,
    }));
    if (!st.n && !st.empty) problems.push(`поиск «${q}»: пусто и без объяснения`);
  }
  await page.fill('#searchInput', ''); await page.waitForTimeout(250);

  // ── покупатель без входа ──
  await page.evaluate(() => { const P = window.WM_PUBLISH; const s = P._state();
    s.session = null; s.isAdmin = false; s.canPurchase = false; s.canSales = false; P.renderAll(); });
  await page.waitForTimeout(300);
  await openProduct(page, 'p1');
  const buyer = await page.evaluate(() => document.querySelector('#productSheet .sheet').innerText);
  for (const secret of ['Артикул', 'Штрихкод', 'Наценка', 'закупка', 'Остаток', 'Своя Закупка', 'ПРОДАЖИ',
    'Магнит', 'ЦЕНЫ В ДРУГИХ МАГАЗИНАХ', 'Дешевле в магазине']) {
    if (buyer.includes(secret)) problems.push(`покупатель видит внутреннее: «${secret}»`);
  }
  chk(/Код товара/.test(buyer), 'без входа виден код товара — ради него каталог и делался');
  // самое важное: лишнее не должно попадать в ОТКРЫТЫЙ файл витрины, даже если
  // в интерфейсе оно скрыто — файл скачивается по прямой ссылке
  const leak = await page.evaluate(() => {
    const P = window.WM_PUBLISH;
    const closed = ['stock', 'stock_qty', 'stock_state', 'supplier_ids', 'barcodes', 'article', 'note', 'department'];
    const found = new Set();
    for (const o of P.buildPublicProducts()) for (const k of closed) if (k in o) found.add(k);
    return [...found];
  });
  chk(!leak.length, `в открытой витрине нет внутренних полей${leak.length ? ': ' + leak.join(', ') : ''}`);
  /* Покупателю не видны ЦЕНЫ чужих магазинов (это внутренняя разведка), но
     подсказать цену он может — кнопка «Видел дешевле в другом магазине»
     задумана владельцем: так покупатель помогает магазину. */
  const comp = await page.evaluate(() => ({
    block: (document.getElementById('sheetCompetitors') || {}).innerHTML || '',
    report: !document.getElementById('btnReportPrice').hidden,
  }));
  chk(!comp.block.trim(), 'покупателю не видны цены чужих магазинов — это внутренняя разведка');
  chk(comp.report, 'зато покупатель может подсказать цену из другого магазина');
  // а вошедший сотрудник их видит
  await page.evaluate(() => { const P = window.WM_PUBLISH; P.applyServerless('pw'); P.renderAll(); });
  await page.waitForTimeout(300);
  await openProduct(page, 'p1');
  chk(/Магнит/.test(await page.evaluate(() => document.getElementById('sheetCompetitors').innerText)),
    'сотруднику цены чужих магазинов по-прежнему видны');

  const rej = await page.evaluate(() => window.__rej || []);
  rej.forEach((r) => problems.push('необработанный сбой: ' + String(r).slice(0, 120)));

  // ── Поставщики: экран, который до аудита был мёртвым ──
  // Кнопки рисовались, но ни переименование, ни удаление, ни контакты не
  // работали — правка жила на сервере, а сервер убрали.
  await page.evaluate(() => document.querySelectorAll('.sheet-backdrop:not([hidden])').forEach((s) => { s.hidden = true; }));
  await page.evaluate(() => { const st = window.WM_PUBLISH._state(); st.suppliers = [{ id: 's1', name: 'Поставщик А' }, { id: 's2', name: 'Поставщик Б' }]; });
  await page.evaluate(() => document.getElementById('adminBtn').click());
  await page.waitForTimeout(300);
  await page.evaluate(() => document.getElementById('menuSuppliers').click());
  await page.waitForTimeout(400);
  const sup = await page.evaluate(async () => {
    window.confirm = () => true;
    document.querySelector('[data-sup-edit="s1"]').click();
    await new Promise((r) => setTimeout(r, 300));
    document.getElementById('supEditName').value = 'Молокозавод';
    document.getElementById('supEditPhone').value = '+79990001122';
    document.getElementById('supEditSave').click();
    await new Promise((r) => setTimeout(r, 450));
    const s = window.WM_PUBLISH._state();
    const named = s.suppliers[0].name; const phone = (s.contacts.s1 || {}).phone;
    document.getElementById('menuSuppliers').click();
    await new Promise((r) => setTimeout(r, 200));
    document.querySelector('[data-sup-edit="s2"]').click();
    await new Promise((r) => setTimeout(r, 300));
    document.getElementById('supEditDelete').click();
    await new Promise((r) => setTimeout(r, 450));
    return { named, phone, left: s.suppliers.length };
  });
  chk(sup.named === 'Молокозавод', `поставщика можно переименовать (${sup.named})`);
  chk(sup.phone === '+79990001122', `телефон поставщика сохраняется (${sup.phone})`);
  chk(sup.left === 1, `лишнего поставщика можно удалить (осталось ${sup.left})`);

  chk(!errs.length, `нет сбоев JS (${errs.length}${errs.length ? ': ' + errs[0] : ''})`);
  chk(!problems.length, `нет замечаний по экранам (${problems.length})`);
  [...new Set(problems)].forEach((p) => console.log('   • ' + p));
  await done(b);
})();

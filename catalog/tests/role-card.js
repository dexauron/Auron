// Сквозная проверка роли «Сотрудник зала»: в карточке товара есть всё для кассы
// и НЕТ денежных блоков (цены поставщиков, продажи, наценка, остаток числом).
const { chromium, newPage, openProduct, runner } = require('./helpers');

(async () => {
  const b = await chromium.launch();
  const { chk, done } = runner('КАРТОЧКА ДЛЯ ЗАЛА');
  const { page, errs } = await newPage(b, {});

  // Входим как сотрудник зала: данные зала (как из floor.enc) — без денег
  await page.evaluate(() => {
    window.WM_PUBLISH.applyFloorSnapshot({
      v: 1,
      products: [{
        id: 'p1', name: 'Молоко 1л', code: '100500', article: 'A-1',
        department: 'Молочка', group_id: 'g1', unit: 'шт', retail_price: 89,
        barcodes: ['4600000000011'], photos: [], stock_state: 'in',
      }],
      groups: [{ id: 'g1', name: 'Молочные', sort_order: 1 }],
    });
  });
  await page.waitForTimeout(300);
  await openProduct(page, 'p1');

  const r = await page.evaluate(() => {
    const t = (id) => { const el = document.getElementById(id); return el ? (el.textContent || '').trim() : 'НЕТ'; };
    const s = window.WM_PUBLISH._state();
    return {
      role: s.role, isAdmin: s.isAdmin, canPurchase: s.canPurchase, canSales: s.canSales,
      fields: t('sheetFields'),
      stock: t('sheetStock'), sales: t('sheetSales'),
      markup: t('sheetMarkup'), supplier: t('sheetSupplier'),
      /* Отдельный класс на строке кода — контракт для оформления: по нему
         стили делают крупную плашку кода, не задевая артикул. */
      codeRows: [...document.querySelectorAll('#sheetFields .field-row.field-code')]
        .map((x) => (x.textContent || '').trim()),
      adminHidden: (document.getElementById('sheetAdminActions') || {}).hidden,
      fabHidden: (document.getElementById('fabAdd') || {}).hidden,
    };
  });

  chk(r.role === 'zal' && r.isAdmin === false && r.canPurchase === false && r.canSales === false,
    'роль зала выставлена верно (без прав на деньги)');
  chk(r.fields.includes('100500'), 'код кассы показан сотруднику');
  chk(r.codeRows.length === 1 && r.codeRows[0].includes('100500'),
    'строка кода помечена классом field-code (и только она) — на это опирается оформление');
  chk(r.fields.includes('A-1'), 'артикул показан сотруднику');
  chk(r.fields.includes('Молочка'), 'отдел показан сотруднику');
  chk(r.stock === '', 'остатка числом нет');
  chk(r.sales === '', 'продаж/«Ходовых» нет');
  chk(r.markup === '', 'наценки нет');
  chk(r.supplier === '', 'цен и контактов поставщиков нет');
  chk(r.adminHidden === true, 'кнопки правки товара скрыты');
  chk(r.fabHidden === true, 'кнопка «добавить товар» скрыта');
  // шапка: сотрудник должен видеть, что он ВОШЁЛ (а не кнопку «Войти»),
  // и иметь возможность выйти
  const hdr = await page.evaluate(() => {
    const vis = (id) => { let n = document.getElementById(id); if (!n) return 'НЕТ';
      while (n && n !== document.body) { if (n.hidden) return false; n = n.parentElement; } return true; };
    document.getElementById('adminBtn').click();
    const ab = document.getElementById('adminBtn'); const al = document.getElementById('adminBtnLabel');
    return { isAdminClass: !!(ab && ab.classList.contains('is-admin')), labelHidden: !!(al && al.hidden),
      logout: vis('menuLogout'), device: vis('menuDevice'), addProduct: vis('menuAddProduct'), publish: vis('menuPublish') };
  });
  chk(hdr.isAdminClass === true && hdr.labelHidden === true, 'шапка показывает вошедшего сотрудника (нет кнопки «Войти»)');
  chk(hdr.logout === true, 'сотрудник может выйти из аккаунта');
  chk(hdr.device === true, 'настройки устройства доступны сотруднику');
  chk(hdr.addProduct === false && hdr.publish === false, 'правка и публикация сотруднику недоступны');
  chk(errs.length === 0, 'нет ошибок страницы (' + errs.length + ')');

  await done(b);
})();

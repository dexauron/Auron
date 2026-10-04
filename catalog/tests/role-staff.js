// Роль «Бухгалтер»: видит деньги (закупки, цены поставщиков, историю, наценку),
// но НЕ правит каталог. Проверяем обещание «только смотрит» по всем экранам.
const { chromium, newPage, openProduct, runner } = require('./helpers');

const iso = (d) => new Date(Date.now() - d * 86400000).toISOString().slice(0, 10);
const products = [
  { id: 'p1', name: 'Молоко 3,2%', code: '101', group_id: 'g1', retail_price: 120, unit: 'шт',
    photos: [], barcodes: ['4600000000011'], supplier_ids: ['s1'], article: 'A-1', department: 'Молочка' },
];
const groups = [{ id: 'g1', name: 'Молочное' }];
const suppliers = [{ id: 's1', name: 'Молзавод' }];
const prices = [
  { product_id: 'p1', supplier_id: 's1', price: 62, price_date: iso(9), unit: 'шт' },
  { product_id: 'p1', supplier_id: 's1', price: 71, price_date: iso(1), unit: 'шт' },
];

(async () => {
  const b = await chromium.launch();
  const { chk, done } = runner('БУХГАЛТЕР: СМОТРИТ, НО НЕ ПРАВИТ');
  const { page, errs } = await newPage(b, { products, groups });

  await page.evaluate((d) => {
    const P = window.WM_PUBLISH; const s = P._state();
    P.ghSetToken('tok');
    P.applyStaff('pw');
    s.suppliers = d.suppliers; s.prices = d.prices;
    P.renderAll();
  }, { suppliers, prices });
  await page.waitForTimeout(400);

  const r = await page.evaluate(() => {
    const s = window.WM_PUBLISH._state();
    return {
      role: s.role, isAdmin: s.isAdmin, canPurchase: s.canPurchase,
      mark: document.body.dataset.role,
      fab: !!document.getElementById('fabAdd'),
    };
  });
  chk(r.role === 'staff' && r.isAdmin === false, 'роль бухгалтера выставлена');
  chk(r.canPurchase === true, 'деньги ему открыты — это его работа');
  chk(r.mark === 'staff', `страница помечена ролью для оформления (${r.mark})`);
  chk(r.fab === false, 'кнопки «добавить товар» нет вовсе — товары приходят из 1С');

  // ── карточка: цены видны, правка — нет ──
  await openProduct(page, 'p1');
  const card = await page.evaluate(() => {
    const t = (id) => { const el = document.getElementById(id); return el ? (el.textContent || '').trim() : 'НЕТ'; };
    return {
      prices: t('sheetPrices'), rise: t('sheetRise'), markup: t('sheetMarkup'),
      adminHidden: (document.getElementById('sheetAdminActions') || {}).hidden,
      /* Любые кнопки правки в карточке. Смотрим НАСТОЯЩУЮ видимость, а не
         атрибут hidden: сами кнопки его не имеют, их прячет блок-родитель. */
      edits: [...document.querySelectorAll('#productSheet button')]
        .filter((x) => x.offsetParent !== null)
        .map((x) => (x.textContent || '').trim())
        .filter((x) => /Изменить|Удалить|Редактировать|Сохранить|Добавить фото|Найти фото/i.test(x)),
    };
  });
  chk(/62|71/.test(card.prices), `закупочные цены видны (${card.prices.slice(0, 50)})`);
  chk(/Закупка/.test(card.rise), `подорожание закупки видно (${card.rise.slice(0, 50)})`);
  chk(card.adminHidden === true, 'блок действий владельца в карточке скрыт');
  chk(card.edits.length === 0, `кнопок правки в карточке нет (${card.edits.join(', ') || 'ни одной'})`);

  // ── меню: ничего, что меняет каталог или публикует ──
  const menu = await page.evaluate(async () => {
    document.querySelectorAll('.sheet-backdrop:not([hidden])').forEach((x) => { x.hidden = true; });
    document.getElementById('adminBtn').click();
    await new Promise((r) => setTimeout(r, 350));
    return {
      title: (document.getElementById('menuTitle') || {}).textContent || '',
      ownerBlock: (document.getElementById('menuAdminOnly') || {}).hidden,
      items: [...document.querySelectorAll('#adminMenuSheet .ios-row')]
        .filter((x) => !x.hidden && x.offsetParent !== null)
        .map((x) => (x.textContent || '').replace(/\s+/g, ' ').trim()),
    };
  });
  chk(menu.ownerBlock === true, 'раздел меню «только владелец» скрыт');
  const danger = menu.items.filter((t) => /Опубликовать|Импорт|Удалить|Разложить|Дозаполнить|Код сотрудник/i.test(t));
  chk(danger.length === 0, `в меню нет ничего, что меняет каталог (${danger.join(' | ') || 'чисто'})`);
  chk(menu.items.length > 0, `рабочие пункты меню на месте (${menu.items.length})`);
  /* «Ходовые» — продажи и выручка. Бухгалтеру они нужны: без выручки ему
     нечего считать. (Комментарий в коде годами уверял в обратном, хотя сам
     код всегда их открывал — теперь это записано и закреплено.) */
  const top = await page.evaluate(() => (document.getElementById('menuTop') || {}).hidden);
  chk(top === false, 'продажи и выручка бухгалтеру открыты — это его работа');

  chk(errs.length === 0, `нет сбоев JS (${errs.length}${errs.length ? ': ' + errs[0] : ''})`);
  await done(b);
})();

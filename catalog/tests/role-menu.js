// Чистота меню по ролям: владелец видит денежные пункты, сотрудник зала — нет.
const { chromium, newPage, asOwner } = require('./helpers');
const { runner } = require('./helpers');

/* Денежные пункты меню. Заказы и «закончилось на полке» отсюда УБРАНЫ: они
   живут на вкладке «Работа», и держать их в двух местах было лишним. У зала
   на той вкладке показывается только его работа — это проверяет role-work.js. */
const MONEY_ITEMS = ['menuStale', 'menuCompStores', 'menuTop', 'menuAdminOnly'];

(async () => {
  const b = await chromium.launch();
  const { chk, done } = runner('МЕНЮ ПО РОЛЯМ');
  const { page } = await newPage(b, {});

  // Владелец: денежные/управляющие пункты видны
  await asOwner(page, {});
  const ownerHidden = await page.evaluate((ids) => {
    document.getElementById('adminBtn').click();
    const r = {}; ids.forEach((id) => { const el = document.getElementById(id); r[id] = el ? el.hidden : 'нет элемента'; });
    return r;
  }, MONEY_ITEMS);
  chk(ownerHidden.menuStale === false && ownerHidden.menuCompStores === false
    && ownerHidden.menuTop === false && ownerHidden.menuAdminOnly === false,
  'владелец видит заказы/остатки/залежавшиеся/разведку/Ходовые/админ-блок: ' + JSON.stringify(ownerHidden));

  // Сотрудник зала: те же пункты скрыты
  const floorHidden = await page.evaluate((ids) => {
    const s = window.WM_PUBLISH._state();
    s.isAdmin = false; s.canPurchase = false; s.canSales = false; s.role = 'zal';
    window.WM_PUBLISH.renderAll();
    document.getElementById('adminBtn').click();   // openAdminOrLogin пересчитает видимость
    const r = {}; ids.forEach((id) => { const el = document.getElementById(id); r[id] = el ? el.hidden : 'нет элемента'; });
    return r;
  }, MONEY_ITEMS);
  chk(floorHidden.menuStale === true, 'залежавшиеся скрыты у зала');
  chk(floorHidden.menuCompStores === true, 'разведка цен скрыта у зала');
  chk(floorHidden.menuTop === true, '«Ходовые» скрыты у зала');
  chk(floorHidden.menuAdminOnly === true, 'админ-блок (добавить/импорт/публикация) скрыт у зала');

  await done(b);
})();

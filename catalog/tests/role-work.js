// Экран «Работа» по ролям: сотрудник зала видит свои дела, но не закупки/деньги.
const { chromium, newPage, asOwner, runner } = require('./helpers');

const openWorkTab = (page) => page.evaluate(() => {
  const b = document.querySelector('.tabbar .tab[data-tab="work"]');
  if (b) b.click();
  const el = document.getElementById('workBody');
  return el ? (el.textContent || '') : 'НЕТ';
});

(async () => {
  const b = await chromium.launch();
  const { chk, done } = runner('ЭКРАН «РАБОТА» ПО РОЛЯМ');
  const { page, errs } = await newPage(b, {});

  // Владелец: заказы поставщикам видны
  await asOwner(page, {});
  await page.waitForTimeout(200);
  const owner = await openWorkTab(page);
  chk(owner.includes('Заказы поставщикам'), 'владелец видит «Заказы поставщикам»');
  chk(owner.includes('Закончилось на полке'), 'владелец видит «Закончилось на полке»');

  // Сотрудник зала: заказы скрыты, рабочие пункты на месте
  await page.evaluate(() => {
    window.WM_PUBLISH.applyFloorSnapshot({
      v: 1,
      products: [{ id: 'p1', name: 'Молоко 1л', code: '100500', group_id: 'g1' }],
      groups: [{ id: 'g1', name: 'Молочные', sort_order: 1 }],
    });
  });
  await page.waitForTimeout(300);
  const floor = await openWorkTab(page);
  chk(!floor.includes('Заказы поставщикам'), 'у зала НЕТ «Заказы поставщикам»');
  const orderRows = await page.evaluate(() => document.querySelectorAll('#workBody [data-work="orders"]').length);
  chk(orderRows === 0, 'у зала нет ни одной строки заказов/просрочки (' + orderRows + ')');
  chk(!floor.includes('«Просрочено» — поставки'), 'у зала нет пояснения про просроченные поставки');
  chk(!floor.includes('Сравнение товаров'), 'у зала НЕТ «Сравнение товаров» (цены)');
  chk(floor.includes('Закончилось на полке'), 'у зала ЕСТЬ «Закончилось на полке» (его работа)');
  chk(floor.includes('Сканировать штрихкод'), 'у зала ЕСТЬ «Сканировать штрихкод»');
  const banner = await page.evaluate(() => {
    const el = document.getElementById('todayBanner'); return el ? el.hidden : 'НЕТ';
  });
  chk(banner === true, 'плашка про поставки и суммы у зала скрыта');
  chk(errs.length === 0, 'нет ошибок страницы (' + errs.length + ')');

  await done(b);
})();

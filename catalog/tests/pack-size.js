// Фасовка из названия товара: «Молоко Простоквашино 3,2%, 930 мл» → «930 мл».
/* Веса товара в 1С нет ни в одном справочнике — он написан в названии, и мы
 * его оттуда достаём, чтобы показать отдельной строкой. Названия в базе живые,
 * с описками, поэтому правила выведены из 10 673 настоящих названий владельца.
 * Главное правило разборщика: сомневаешься — молчи. Здесь проверяем и то, что
 * он находит, и то, о чём ПРАВИЛЬНО молчит.
 *
 * Отсюда же считалась цена за килограмм и литр. Владелец её убрал (29.08):
 * на штучном товаре она чаще путала, чем помогала — «1 143 ₽/кг» под жвачкой
 * за 4 ₽ читается как ошибка. Разбор остался. */
const { chromium, newPage, runner } = require('./helpers');

(async () => {
  const b = await chromium.launch();
  const { chk, done } = runner('ФАСОВКА ИЗ НАЗВАНИЯ');
  const { page, errs } = await newPage(b, { products: [], groups: [] });

  const pack = (names) => page.evaluate((list) => list.map((name) =>
    window.WM_PUBLISH._packText({ name })), names);

  // ── 1. Обычные случаи ──
  const ok = await pack([
    'Молоко Простоквашино 3,2%, 930 мл',
    'Ulker Альбени XXL 70г',
    'Вкусно Сок Апельсин 0,2л',
    'Печенье Овсяное 5кг',
    'Лола Финики Мазафати 550гр',
  ]);
  chk(ok[0] === '930 мл', `«930 мл» найдено (${ok[0]})`);
  chk(ok[1] === '70 г', `граммы найдены (${ok[1]})`);
  chk(ok[2] === '0,2 л', `литры найдены (${ok[2]})`);
  chk(ok[3] === '5 кг', `килограммы найдены (${ok[3]})`);
  chk(ok[4] === '550 г', `«гр» приводится к «г» (${ok[4]})`);

  // ── 2. Когда фасовки нет — молчим ──
  const quiet = await pack([
    'Сыр Российский',
    'MacCoffee Кофе 3в1 Латте',
    'Пряники Кольцо №137 3кг32',
    'тетрадь 96 листов',
  ]);
  const why = ['без фасовки', 'цифры не в конце', 'мусор в названии', 'листы, а не литры'];
  quiet.forEach((v, i) => chk(!v, `молчим: ${why[i]}${v ? ' — а показали «' + v + '»' : ''}`));

  // ── 3. В списке товаров фасовка стоит своей строкой ──
  await page.evaluate(async () => {
    const P = window.WM_PUBLISH, s = P._state();
    s.products = [{ id: 'u1', name: 'Ulker Альбени XXL 70г', code: '1', retail_price: 69,
      unit: 'шт', photos: [], barcodes: [], group_id: 'g1', stock_state: 'in' }];
    P.buildIndex(); P.renderAll();
    await new Promise((r) => setTimeout(r, 300));
  });
  const grid = await page.evaluate(() => ({
    text: document.getElementById('productGrid').innerText.replace(/\s+/g, ' '),
    html: document.getElementById('productGrid').innerHTML,
  }));
  chk(/Ulker Альбени XXL 70 г/.test(grid.text), `фасовка стоит отдельной строкой (${grid.text.slice(0, 40)})`);
  chk(/row-pack/.test(grid.html), 'и это именно своя строка, а не кусок названия');
  chk(!/₽\/кг/.test(grid.text) && !/₽\/л/.test(grid.text),
    'цены за килограмм на штучном товаре больше нет — владелец её убрал');

  chk(!errs.length, `нет сбоев JS (${errs.length}${errs.length ? ': ' + errs[0] : ''})`);
  await done(b);
})();

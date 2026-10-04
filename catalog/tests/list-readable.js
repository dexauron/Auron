/* Список должен давать УЗНАТЬ товар — иначе он не нужен.
 *
 * Со снимка владельца: названия из 1С обрезались в одну строку так рано, что
 * разные товары выглядели одинаково — «`ПЛ Конструктор в ведре 68эл…» это и
 * красный, и синий. У многих название начинается со служебной приставки
 * («.кб/с», «`ПЛ»), и она съедала половину видимого.
 * Там же: ПОСЛЕДНИЙ товар навсегда оставался под круглой кнопкой «+», и его
 * код нельзя было увидеть, сколько ни листай.
 */
const { chromium, newPage, asOwner, runner } = require('./helpers');

const names = [
  '`ПЛ Конструктор в ведре 68эл красный',
  '`ПЛ Конструктор в ведре 68эл синий',
  '.кб/с Кукла цветочное платье Арт.wzb8821',
  '.кб/с Кукла Vinyl doll Арт.wzb8822',
  '`ПЛ Конструктор Малый 48эл Арт.2233',
];
const products = names.map((n, i) => ({
  id: 'p' + i, name: n, code: String(19370 + i), group_id: 'g1',
  retail_price: 1295 - i * 10, unit: 'шт', photos: [], barcodes: ['46000000' + i],
}));
const groups = [{ id: 'g1', name: 'Игрушки' }];

const toList = (page) => page.evaluate(async () => {
  const s = window.WM_PUBLISH._state();
  s.view = 'list';
  window.WM_PUBLISH.renderAll();
  await new Promise((r) => setTimeout(r, 400));
});

(async () => {
  const b = await chromium.launch();
  const { chk, done } = runner('СПИСОК: ТОВАР МОЖНО УЗНАТЬ');
  const { page, errs } = await newPage(b, { products, groups });
  await asOwner(page, {});
  await page.setViewportSize({ width: 390, height: 844 });
  await toList(page);

  // ── 1. Названия не обрезаются так, что товары путаются ──
  const rows = await page.evaluate(() => [...document.querySelectorAll('.grid.list .card-name')].map((e) => ({
    txt: e.textContent.trim(),
    // влезло ли название целиком (с учётом переноса на вторую строку)
    clipped: e.scrollHeight > e.clientHeight + 1 || e.scrollWidth > e.clientWidth + 1,
  })));
  chk(rows.length === 5, `все товары в списке (${rows.length})`);
  chk(rows.every((r) => !r.clipped), `названия помещаются целиком (обрезано: ${rows.filter((r) => r.clipped).length})`);
  const red = rows.find((r) => /красный/.test(r.txt));
  const blue = rows.find((r) => /синий/.test(r.txt));
  chk(!!red && !!blue, `два похожих товара различимы по названию (${red ? 'красный' : '—'} / ${blue ? 'синий' : '—'})`);

  // ── 2. Список остаётся плотным: одна строка — это не карточка в пол-экрана ──
  const height = await page.evaluate(() => {
    const c = document.querySelector('.grid.list .card');
    return Math.round(c.getBoundingClientRect().height);
  });
  chk(height <= 110, `строка списка осталась компактной (${height} точек)`);

  // ── 3. Последний товар не прячется под кнопкой «+» ──
  const bottom = await page.evaluate(async () => {
    window.scrollTo(0, document.body.scrollHeight);
    await new Promise((r) => setTimeout(r, 400));
    const cards = [...document.querySelectorAll('.grid.list .card')];
    const last = cards[cards.length - 1].getBoundingClientRect();
    const tab = document.querySelector('.tabbar').getBoundingClientRect();
    return {
      // круглой кнопки «+» больше нет — проверяем, что её и правда нет
      подКнопкой: !!document.getElementById('fabAdd'),
      подПанелью: last.bottom > tab.top,
      name: cards[cards.length - 1].innerText.replace(/\s+/g, ' ').trim().slice(0, 40),
    };
  });
  chk(!bottom.подКнопкой, `кнопки «+» нет — последний товар ничем не закрыт (${bottom.name})`);
  chk(!bottom.подПанелью, 'и не уходит под нижнюю панель');

  chk(errs.length === 0, `нет сбоев JS (${errs.length}${errs.length ? ': ' + errs[0] : ''})`);
  await done(b);
})();

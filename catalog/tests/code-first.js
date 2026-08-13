// Быстрый путь к коду товара — главная задача каталога: сотрудник за кассой
// должен узнать код, не открывая карточку и не листая экран.
const { chromium, newPage, asOwner, runner } = require('./helpers');

const now = '2026-01-01T00:00:00Z';
const products = [...Array(24)].map((_, i) => ({
  id: 'p' + i, name: 'Хот-дог с сыром и беконом номер ' + i, code: String(1200 + i),
  group_id: 'g1', retail_price: 90 + i, is_weighted: false, unit: 'шт',
  barcodes: i % 2 ? ['460706500' + i] : [],       // половина без штрихкода
  photos: [], created_at: now,
}));
const groups = [{ id: 'g1', name: 'Выпечка и фастфуд', sort_order: 1 }];

(async () => {
  const b = await chromium.launch();
  const { chk, done } = runner('БЫСТРЫЙ ПУТЬ К КОДУ');
  const { page, errs } = await newPage(b, { products, groups });
  await page.waitForTimeout(400);

  const fits = () => page.evaluate(() => [...document.querySelectorAll('#productGrid .card')]
    .filter((c) => { const r = c.getBoundingClientRect(); return r.top >= 0 && r.bottom <= innerHeight; }).length);
  const fitTiles = await fits();

  // ── код виден на плитке и он заметнее прочего ──
  const sizes = await page.evaluate(() => {
    const card = document.querySelector('#productGrid .card');
    const code = card.querySelector('.card-code');
    const name = card.querySelector('.card-name');
    const price = card.querySelector('.card-price');
    const px = (el) => (el ? parseFloat(getComputedStyle(el).fontSize) : 0);
    return { code: code ? code.textContent.trim() : '', codePx: px(code), namePx: px(name), pricePx: px(price) };
  });
  chk(/^\d{4}$/.test(sizes.code), `код напечатан на плитке (${sizes.code})`);
  chk(sizes.codePx >= sizes.namePx, `код не мельче названия (${sizes.codePx}px против ${sizes.namePx}px)`);

  // ── тап по коду копирует его и НЕ открывает карточку ──
  await page.context().grantPermissions(['clipboard-read', 'clipboard-write']);
  await page.click('#productGrid .card .card-code'); await page.waitForTimeout(400);
  const afterTap = await page.evaluate(async () => ({
    sheet: document.getElementById('productSheet').hidden,
    buf: await navigator.clipboard.readText().catch(() => ''),
    toast: (document.querySelector('.toast') || {}).textContent || '',
  }));
  chk(afterTap.sheet, 'тап по коду НЕ открывает карточку — сотруднику нужен только код');
  chk(afterTap.buf === '1200', `код попал в буфер обмена (${afterTap.buf})`);
  chk(/скопирован/i.test(afterTap.toast), `показано подтверждение («${afterTap.toast}»)`);

  // ── плотный вид больше не прячет код ──
  await page.click('#viewToggleBtn'); await page.waitForTimeout(400);
  const compact = await page.evaluate(() => ({
    cls: document.getElementById('productGrid').className,
    codes: document.querySelectorAll('#productGrid .card-code').length,
    visible: [...document.querySelectorAll('#productGrid .card-code')].every((c) => c.offsetParent !== null),
  }));
  chk(/compact/.test(compact.cls), 'второе нажатие — плотные плитки');
  chk(compact.codes === products.length && compact.visible, `в плотном виде код виден у всех товаров (${compact.codes})`);

  // ── режим списка: без фото, кода видно втрое больше ──
  await page.click('#viewToggleBtn'); await page.waitForTimeout(400);
  const list = await page.evaluate(() => {
    const grid = document.getElementById('productGrid');
    const rows = [...grid.querySelectorAll('.card-row')];
    const photoShown = [...grid.querySelectorAll('.card-photo')].some((x) => x.offsetParent !== null);
    const codePx = rows.length ? parseFloat(getComputedStyle(rows[0].querySelector('.card-code')).fontSize) : 0;
    return { cls: grid.className, rows: rows.length, photoShown, codePx };
  });
  const fitList = await fits();
  chk(/list/.test(list.cls), 'третье нажатие — режим списка');
  chk(!list.photoShown, 'в списке фото не показываются — место под коробки не тратится');
  chk(list.codePx >= 18, `код в списке крупный (${list.codePx}px)`);
  chk(fitList >= fitTiles * 1.8, `на экран влезает заметно больше товаров: список ${fitList} против плиток ${fitTiles}`);

  // ── четвёртое нажатие возвращает плитки ──
  await page.click('#viewToggleBtn'); await page.waitForTimeout(300);
  chk(await page.evaluate(() => document.getElementById('productGrid').className.trim() === 'grid'),
    'по кругу возвращается к обычным плиткам');

  // ── товары без штрихкода помечены: их пробивают по коду ──
  const noBc = await page.evaluate(() => [...document.querySelectorAll('#productGrid .card')]
    .filter((c) => /без ШК/.test(c.innerText)).map((c) => c.dataset.id));
  chk(noBc.length === 12, `товары без штрихкода помечены (${noBc.length} из 24)`);

  // ── гигиена каталога не мешает залу ──
  const chipsGuest = await page.evaluate(() => document.getElementById('quickChips').innerText);
  chk(!/Без фото|Без цены|Без ШК/.test(chipsGuest), `сотруднику не показываем админские фильтры («${chipsGuest.replace(/\s+/g, ' ').trim()}»)`);
  await asOwner(page, {});
  await page.waitForTimeout(400);
  const chipsAdmin = await page.evaluate(() => document.getElementById('quickChips').innerText);
  chk(/Без фото/.test(chipsAdmin), 'админу они по-прежнему нужны — остались');

  chk(!errs.length, `нет сбоев JS (${errs.length}${errs.length ? ': ' + errs[0] : ''})`);
  await done(b);
})();

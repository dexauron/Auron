// Товары без фото показываются компактно: пустой квадрат не занимает плитку.
const { chromium, newPage, runner } = require('./helpers');

const noPhoto = Array.from({ length: 6 }, (_, i) => ({
  id: 'n' + i, name: 'Товар без фото ' + i, code: String(200100 + i),
  group_id: 'g1', unit: 'шт', retail_price: 50 + i, photos: [], barcodes: [],
}));
const withPhoto = [{
  id: 'ph', name: 'Товар с фото', code: '300100', group_id: 'g1', unit: 'шт',
  retail_price: 99, photos: ['data:image/gif;base64,R0lGODlhAQABAIAAAP///wAAACH5BAEAAAAALAAAAAABAAEAAAICRAEAOw=='], barcodes: [],
}];
const GRPS = [{ id: 'g1', name: 'Молочные', sort_order: 1 }];

(async () => {
  const b = await chromium.launch();
  const { chk, done } = runner('КОМПАКТНЫЕ ПЛИТКИ БЕЗ ФОТО');
  const { page, errs } = await newPage(b, {});
  // данные кладём напрямую: обвязка тестов ещё мокает старый products.json,
  // а приложение читает витрину по частям — иначе подхватится настоящий каталог
  await page.evaluate((d) => {
    window.WM_PUBLISH.applyFloorSnapshot({ v: 1, products: d.p, groups: d.g });
  }, { p: [...noPhoto, ...withPhoto], g: GRPS });
  await page.waitForTimeout(500);

  const r = await page.evaluate(() => {
    const sel = (id) => document.querySelector(`#productGrid .card[data-id="${id}"]`);
    const h = (id) => { const c = sel(id); return c ? Math.round(c.getBoundingClientRect().height) : 0; };
    const emptyShown = [...document.querySelectorAll('#productGrid .card-photo.no-photo')]
      .filter((el) => el.getBoundingClientRect().height > 0).length;
    return { hNo: h('n0'), hPh: h('ph'), emptyShown, cards: document.querySelectorAll('#productGrid .card').length };
  });

  chk(r.cards === 7, 'все товары на месте (' + r.cards + ')');
  chk(r.emptyShown === 0, 'пустых фото-квадратов не рисуется (' + r.emptyShown + ')');
  chk(r.hNo > 0 && r.hNo < 260, 'плитка без фото компактная: ' + r.hNo + 'px');
  chk(r.hPh > 0, 'плитка с фото продолжает показывать фото (' + r.hPh + 'px)');
  chk(errs.length === 0, 'нет ошибок страницы (' + errs.length + ')');

  await done(b);
})();

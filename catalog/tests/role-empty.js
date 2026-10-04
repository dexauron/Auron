/* Пустые экраны — тоже экраны, и у каждой роли на них свой выход.
 *
 * Покупатель искал и не нашёл — ему предлагают спросить в магазине, и
 * владелец заодно узнаёт, чего людям не хватает. Сотруднику у полки
 * переписывать запрос неудобно: ему предлагаем навести камеру — штрихкод на
 * упаковке находит товар там, где название из 1С подвело. Раньше сотруднику
 * тут не предлагали ничего.
 */
const { chromium, newPage, asOwner, runner } = require('./helpers');

const products = [{ id: 'p1', name: 'Молоко 1л', code: '101', group_id: 'g1', retail_price: 89, unit: 'шт', photos: [], barcodes: ['4600000000011'] }];
const groups = [{ id: 'g1', name: 'Молочное' }];

const search = (page, q) => page.evaluate(async (text) => {
  document.querySelectorAll('.sheet-backdrop:not([hidden])').forEach((x) => { x.hidden = true; });
  document.querySelector('.tabbar [data-tab="catalog"]').click();
  await new Promise((r) => setTimeout(r, 250));
  const inp = document.getElementById('searchInput');
  inp.value = text;
  inp.dispatchEvent(new Event('input', { bubbles: true }));
  await new Promise((r) => setTimeout(r, 500));
  const es = document.getElementById('emptyState');
  return {
    shown: !es.hidden,
    text: (es.innerText || '').replace(/\s+/g, ' ').trim(),
    ask: !document.getElementById('emptyAsk').hidden,
    scan: !document.getElementById('emptyScan').hidden,
    reset: !document.getElementById('emptyReset').hidden,
  };
}, q);

(async () => {
  const b = await chromium.launch();
  const { chk, done } = runner('ПУСТЫЕ ЭКРАНЫ ПО РОЛЯМ');
  const { page, errs } = await newPage(b, { products, groups });

  // ── покупатель ──
  const guest = await search(page, 'шоколадка милка');
  chk(guest.shown && /Ничего не нашлось/.test(guest.text), `покупателю сказано, что ничего не нашлось (${guest.text.slice(0, 40)})`);
  chk(guest.ask, 'покупателю предложено спросить в магазине');
  chk(!guest.scan, 'сканера покупателю тут не предлагаем — он пришёл за товаром, а не за кодом');

  // ── сотрудник ──
  await asOwner(page, {});
  await page.waitForTimeout(400);
  const staff = await search(page, 'шоколадка милка');
  chk(staff.shown, 'сотруднику тоже сказано, что ничего не нашлось');
  chk(staff.scan, 'сотруднику предложено навести камеру — у полки это быстрее, чем переписывать запрос');
  chk(!staff.ask, 'а «спросить в магазине» ему не предлагают — он и есть магазин');

  // ── пустое избранное: сбрасывать нечего ──
  const fav = await page.evaluate(async () => {
    document.querySelectorAll('.sheet-backdrop:not([hidden])').forEach((x) => { x.hidden = true; });
    const inp = document.getElementById('searchInput');
    inp.value = ''; inp.dispatchEvent(new Event('input', { bubbles: true }));
    await new Promise((r) => setTimeout(r, 300));
    document.querySelector('.tabbar [data-tab="fav"]').click();
    await new Promise((r) => setTimeout(r, 500));
    const es = document.getElementById('emptyState');
    return {
      text: (es.innerText || '').replace(/\s+/g, ' ').trim(),
      reset: !document.getElementById('emptyReset').hidden,
      scan: !document.getElementById('emptyScan').hidden,
    };
  });
  chk(/избранном пусто/i.test(fav.text), `пустое избранное объясняет себя (${fav.text.slice(0, 60)})`);
  chk(!fav.reset && !fav.scan, 'и не предлагает ни сбросить фильтры, ни сканировать — тут нечего');

  chk(errs.length === 0, `нет сбоев JS (${errs.length}${errs.length ? ': ' + errs[0] : ''})`);
  await done(b);
})();

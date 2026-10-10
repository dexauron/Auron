// Список покупок по ссылке: отправил близкому — он открыл ЖИВОЙ список.
/* Раньше список уходил простым текстом: прочитать можно, пользоваться нельзя.
 * Теперь рядом уходит ссылка, и открывший получает тот же список в каталоге —
 * с сегодняшними ценами, суммой и галочками. Сервер для этого не нужен: весь
 * список умещается в самой ссылке.
 * Главное, что проверяем: чужая ссылка ДОБАВЛЯЕТ товары к своим, а не стирает
 * их — человек мог уже что-то отметить сам. */
const { chromium, newPage, runner } = require('./helpers');

const products = [
  { id: 'p1', name: 'Молоко Простоквашино 3,2%', code: '101', retail_price: 89, group_id: 'g1', photos: [], barcodes: [], stock_state: 'in' },
  { id: 'p2', name: 'Хлеб Столовый', code: '102', retail_price: 45, group_id: 'g1', photos: [], barcodes: [], stock_state: 'in' },
  { id: 'p3', name: 'Сыр Российский', code: '5940', retail_price: 790, group_id: 'g1', photos: [], barcodes: [], stock_state: 'in' },
  // у этого товара кода нет — в ссылку он должен уйти по внутреннему номеру
  { id: 'p4', name: 'Зелень укроп', code: '', retail_price: 30, group_id: 'g1', photos: [], barcodes: [], stock_state: 'in' },
];

(async () => {
  const b = await chromium.launch();
  const { chk, done } = runner('СПИСОК ПО ССЫЛКЕ');
  const { page, errs } = await newPage(b, { products, groups: [{ id: 'g1', name: 'Разное' }] });

  // ── 1. Ссылка собирается из списка ──
  const link = await page.evaluate(() => {
    const P = window.WM_PUBLISH;
    localStorage.setItem('wm_shop_v1', JSON.stringify([
      { id: 'p1', name: 'Молоко', code: '101', price: 89, qty: 2, done: false },
      { id: 'p3', name: 'Сыр', code: '5940', price: 790, qty: 1, done: false },
      { id: 'p4', name: 'Зелень', code: '', price: 30, qty: 1, done: false },
      { id: 'p2', name: 'Хлеб', code: '102', price: 45, qty: 1, done: true },   // вычеркнут
    ]));
    return P._shopLink();
  });
  chk(/#l=/.test(link), `ссылка со списком собралась (${String(link).slice(-40)})`);
  chk(/101x2/.test(link), 'количество попало в ссылку (101x2)');
  chk(/5940/.test(link), 'товар с кодом ушёл по коду');
  chk(/ip4/.test(link), 'товар без кода ушёл по внутреннему номеру');
  chk(!/102/.test(link), 'вычеркнутое в ссылку не кладём — это уже куплено');

  // ── 2. Другой человек открыл ссылку ──
  const got = await page.evaluate(async (l) => {
    const P = window.WM_PUBLISH;
    // как будто это ДРУГОЙ телефон, где уже есть свой список
    localStorage.setItem('wm_shop_v1', JSON.stringify([
      { id: 'p2', name: 'Хлеб Столовый', code: '102', price: 45, qty: 1, done: false },
    ]));
    window.location.hash = l.slice(l.indexOf('#'));
    await new Promise((r) => setTimeout(r, 100));
    P._shopFromHash();
    await new Promise((r) => setTimeout(r, 400));
    const list = JSON.parse(localStorage.getItem('wm_shop_v1'));
    return {
      names: list.map((x) => x.name),
      qty: (list.find((x) => x.id === 'p1') || {}).qty,
      open: !document.getElementById('shopSheet').hidden,
      body: document.getElementById('shopBody').innerText.replace(/\s+/g, ' '),
      hash: window.location.hash,
    };
  }, link);
  chk(got.names.includes('Хлеб Столовый'), 'свой список не стёрли — хлеб на месте');
  chk(got.names.includes('Молоко Простоквашино 3,2%') && got.names.includes('Сыр Российский'),
    `присланные товары добавились (${got.names.join(', ')})`);
  chk(got.names.includes('Зелень укроп'), 'товар без кода тоже нашёлся');
  chk(got.qty === 2, `количество из ссылки сохранилось (${got.qty})`);
  chk(got.open, 'список сразу открылся — человеку не надо его искать');
  chk(/итого/i.test(got.body), `видна сумма, а не просто перечисление (${got.body.slice(0, 60)})`);
  chk(!got.hash, 'ссылка из адреса убрана — обновление страницы не задвоит список');

  // ── 3. Повторное открытие той же ссылки ничего не ломает ──
  const again = await page.evaluate(async (l) => {
    const P = window.WM_PUBLISH;
    window.location.hash = l.slice(l.indexOf('#'));
    await new Promise((r) => setTimeout(r, 100));
    P._shopFromHash();
    await new Promise((r) => setTimeout(r, 300));
    return JSON.parse(localStorage.getItem('wm_shop_v1')).length;
  }, link);
  chk(again === 4, `та же ссылка второй раз не задваивает товары (${again})`);

  chk(!errs.length, `нет сбоев JS (${errs.length}${errs.length ? ': ' + errs[0] : ''})`);
  await done(b);
})();

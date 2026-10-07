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
  ...Array.from({ length: 57 }, (_, i) => ({
    id: `p${i + 5}`, name: `Товар ${i + 5}`, code: String(i + 1005),
    retail_price: 10, group_id: 'g1', photos: [], barcodes: [], stock_state: 'in',
  })),
  { id: '3f4933ec-86a7-4c3e-8300-6f0d30b5e63e', name: 'Товар без кода',
    code: '', retail_price: 25, group_id: 'g1', photos: [], barcodes: [], stock_state: 'in' },
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

  /* Вес меньше килограмма тоже должен уйти в ссылку — иначе 0,5 кг станет
     1 кг у получателя (находка GPT). Проверяем и смесь: две дроби подряд и
     целое — разделитель позиций «-» не должен спорить с точкой в дроби. */
  const fractionalLink = await page.evaluate(() => {
    localStorage.setItem('wm_shop_v1', JSON.stringify([
      { id: 'p3', name: 'Сыр Российский', code: '5940', price: 790, unit: 'кг', qty: 0.5, done: false },
    ]));
    return window.WM_PUBLISH._shopLink();
  });
  chk(/#l=5940x0\.5$/.test(fractionalLink), `полкилограмма не превратились в килограмм (${fractionalLink})`);

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

  // получатель читает точку в ссылке как десятичный разделитель
  const receivedHalf = await page.evaluate(async (l) => {
    localStorage.setItem('wm_shop_v1', '[]');
    window.location.hash = l.slice(l.indexOf('#'));
    await new Promise((r) => setTimeout(r, 100));
    window.WM_PUBLISH._shopFromHash();
    await new Promise((r) => setTimeout(r, 200));
    return (JSON.parse(localStorage.getItem('wm_shop_v1')).find((x) => x.code === '5940') || {}).qty;
  }, fractionalLink);
  chk(receivedHalf === 0.5, `получатель увидел 0,5, а не 1 (${receivedHalf})`);

  // смесь дробей и целого в одной ссылке доезжает до последней позиции
  const mixed = await page.evaluate(async () => {
    const P = window.WM_PUBLISH;
    localStorage.setItem('wm_shop_v1', JSON.stringify([
      { id: 'p3', name: 'Сыр', code: '5940', price: 790, unit: 'кг', qty: 0.5, done: false },
      { id: 'p1', name: 'Молоко', code: '101', price: 89, unit: 'шт', qty: 3, done: false },
    ]));
    const link = P._shopLink();
    localStorage.setItem('wm_shop_v1', '[]');
    window.location.hash = link.slice(link.indexOf('#'));
    await new Promise((r) => setTimeout(r, 120));
    P._shopFromHash();
    await new Promise((r) => setTimeout(r, 250));
    return { link, got: JSON.parse(localStorage.getItem('wm_shop_v1')).map((x) => `${x.code}:${x.qty}`).sort() };
  });
  chk(mixed.got.join(',') === '101:3,5940:0.5',
    `дроби и целое в одной ссылке не мешают друг другу (${mixed.link.split('#')[1]} → ${mixed.got.join(', ')})`);

  // В списке можно хранить 200 позиций. Ссылка должна передавать и 61-ю:
  // текст сообщения обещает получателю весь список целиком по ссылке.
  const longList = await page.evaluate(async (items) => {
    localStorage.setItem('wm_shop_v1', JSON.stringify(items.map((p) => ({
      id: p.id, name: p.name, code: p.code, price: p.retail_price, qty: 1, done: false,
    }))));
    const link = window.WM_PUBLISH._shopLink();
    localStorage.setItem('wm_shop_v1', '[]');
    window.location.hash = link.slice(link.indexOf('#'));
    await new Promise((r) => setTimeout(r, 120));
    window.WM_PUBLISH._shopFromHash();
    await new Promise((r) => setTimeout(r, 250));
    const received = JSON.parse(localStorage.getItem('wm_shop_v1'));
    return { count: received.length, last: received.some((x) => x.id === 'p61') };
  }, products.slice(0, 61));
  chk(longList.count === 61 && longList.last,
    `ссылка передала все 61 позиции, включая последнюю (${longList.count}, p61: ${longList.last})`);

  // В публичном каталоге внутренний id бывает UUID с дефисами, а кода кассы
  // у товара нет. Такой товар тоже должен доехать по ссылке.
  const uuid = await page.evaluate(async (item) => {
    localStorage.setItem('wm_shop_v1', JSON.stringify([{
      id: item.id, name: item.name, code: '', price: item.retail_price, qty: 1, done: false,
    }]));
    const link = window.WM_PUBLISH._shopLink();
    localStorage.setItem('wm_shop_v1', '[]');
    if (link) {
      window.location.hash = link.slice(link.indexOf('#'));
      await new Promise((r) => setTimeout(r, 120));
      window.WM_PUBLISH._shopFromHash();
      await new Promise((r) => setTimeout(r, 250));
    }
    return { link, received: JSON.parse(localStorage.getItem('wm_shop_v1')).some((x) => x.id === item.id) };
  }, products[61]);
  chk(uuid.received, `товар без кода с UUID передан по ссылке (${uuid.link || 'ссылка пустая'})`);

  // Когда свой список почти полон, новая ссылка не должна вытеснять
  // записанные человеком товары из-за ограничения хранения в 200 позиций.
  const nearLimit = await page.evaluate(async () => {
    const own = Array.from({ length: 199 }, (_, i) => ({
      id: `own-${i}`, name: `Свой товар ${i}`, code: '', price: 1, qty: 1, done: false,
    }));
    localStorage.setItem('wm_shop_v1', JSON.stringify(own));
    window.location.hash = '#l=101-102';
    await new Promise((r) => setTimeout(r, 120));
    window.WM_PUBLISH._shopFromHash();
    await new Promise((r) => setTimeout(r, 250));
    const list = JSON.parse(localStorage.getItem('wm_shop_v1'));
    return { count: list.length, own: list.filter((x) => x.id.startsWith('own-')).length,
      first: list.some((x) => x.id === 'own-0'), added: list.filter((x) => x.id === 'p1' || x.id === 'p2').length };
  });
  chk(nearLimit.count === 200 && nearLimit.own === 199 && nearLimit.first && nearLimit.added === 1,
    `при полном списке свои 199 товаров сохранены (${JSON.stringify(nearLimit)})`);

  /* САМЫЙ ТЯЖЁЛЫЙ СЛУЧАЙ — покупатель. В публичной витрине кода кассы НЕТ
     ни у одного товара (его там прячут нарочно), поэтому весь его список
     уезжает внутренними номерами. 200 позиций — предел списка. Проверяем две
     вещи: ссылка доезжает целиком и остаётся обозримой по длине. */
  const heavy = await page.evaluate(async () => {
    const ids = Array.from({ length: 200 }, (_, i) => {
      const h = i.toString(16).padStart(12, '0');
      return `3f4933ec-86a7-4c3e-8300-${h}`;
    });
    const P = window.WM_PUBLISH;
    P._state().products = ids.map((id, i) => ({
      id, name: `Товар ${i}`, code: '', retail_price: 10, group_id: 'g1',
      photos: [], barcodes: [], stock_state: 'in',
    }));
    localStorage.setItem('wm_shop_v1', JSON.stringify(
      ids.map((id, i) => ({ id, name: `Товар ${i}`, code: '', price: 10, qty: 1, done: false })),
    ));
    const link = P._shopLink();
    localStorage.setItem('wm_shop_v1', '[]');
    window.location.hash = link.slice(link.indexOf('#'));
    await new Promise((r) => setTimeout(r, 120));
    P._shopFromHash();
    await new Promise((r) => setTimeout(r, 400));
    const got = JSON.parse(localStorage.getItem('wm_shop_v1'));
    return { len: link.length, head: link.slice(0, 90), count: got.length, last: got.some((x) => x.id === ids[199]) };
  });
  chk(heavy.count === 200 && heavy.last,
    `все 200 товаров покупателя доехали по ссылке (${heavy.count}, последний: ${heavy.last})`);
  chk(heavy.len < 8000, `ссылка остаётся обозримой: ${heavy.len} знаков на 200 товаров`);
  chk(!/%2D/.test(heavy.head), `дефисы в номерах не раздувают ссылку (${heavy.head.slice(-46)})`);

  chk(!errs.length, `нет сбоев JS (${errs.length}${errs.length ? ': ' + errs[0] : ''})`);
  await done(b);
})();

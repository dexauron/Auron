// Заявки и выгрузка списка покупок в 1С по шаблону владельца.
/* Владелец прислал шаблон своей «Загрузки из файла»: один лист, одна строка
 * заголовков, девять колонок в строгом порядке. Если порядок или написание
 * разъедутся, 1С либо не найдёт колонку, либо подставит не туда — и расходник
 * выйдет неверным, причём молча. Поэтому заголовки здесь прописаны ТАК ЖЕ, как
 * в шаблоне, и сверяются буква за буквой.
 *
 * Остальное — то, что владелец просил словами: список покупок у всех, не
 * только у покупателя; окно заявок, где собранный список откладывается; можно
 * отметить «всё принял» — заявка зачёркивается; и даже зачёркнутую можно
 * открыть и скопировать заново в любой день. */
const { chromium, newPage, asOwner, openProduct, runner } = require('./helpers');

// ровно как в шаблоне, который прислал владелец (прочитан из его .xls)
const TEMPLATE = ['Код', 'Штрих-код', 'Наименование номенклатуры', 'Артикул',
  'Наименование единицы', 'Количество', 'Розничная цена', 'Розничная сумма', 'Всего'];

const products = [
  { id: 'p1', name: 'Молоко 3,2% 930 мл', code: '101', article: 'АРТ-1', group_id: 'g1',
    retail_price: 89, unit: 'шт', photos: [], barcodes: ['4600000000011'], stock: 7,
    pack_units: [{ unit: 'упак (12)', qty: 12 }] },
  { id: 'p2', name: 'Колбаса варёная', code: '202', article: '', group_id: 'g1',
    retail_price: 540, unit: 'кг', is_weighted: true, photos: [], barcodes: [], stock: 3 },
  { id: 'p3', name: 'Батон нарезной', code: '303', article: '', group_id: 'g2',
    retail_price: 45, unit: 'шт', photos: [], barcodes: ['4600000000035'], stock: 5 },
];
const groups = [{ id: 'g1', name: 'Молочные' }, { id: 'g2', name: 'Хлеб' }];

// подкладываем список покупок и открываем его
const openShop = (page, rows) => page.evaluate(async (list) => {
  document.querySelectorAll('.sheet-backdrop:not([hidden])').forEach((s) => { s.hidden = true; });
  localStorage.setItem('wm_shop_v1', JSON.stringify(list));
  window.WM_PUBLISH.renderAll();
  await new Promise((r) => setTimeout(r, 250));
  document.getElementById('shopOpen').click();
  await new Promise((r) => setTimeout(r, 350));
}, rows);

const SHOP = [
  { id: 'p1', name: 'Молоко 3,2% 930 мл', code: '101', article: 'АРТ-1', barcode: '4600000000011', unit: 'шт', weighted: false, price: 89, qty: 24, done: false },
  { id: 'p2', name: 'Колбаса варёная', code: '202', article: '', barcode: '', unit: 'кг', weighted: true, price: 540, qty: 2.5, done: false },
  { id: 'p3', name: 'Батон нарезной', code: '303', article: '', barcode: '4600000000035', unit: 'шт', weighted: false, price: 45, qty: 0, done: false },
];

(async () => {
  const b = await chromium.launch();
  const { chk, done } = runner('ЗАЯВКИ И ВЫГРУЗКА В 1С');
  const { page, errs } = await newPage(b, { products, groups });

  // буфер обмена подменяем: настоящий в проверке недоступен
  await page.evaluate(() => {
    window.__clip = '';
    try {
      Object.defineProperty(navigator, 'clipboard', {
        configurable: true,
        value: { writeText: (t) => { window.__clip = t; return Promise.resolve(); } },
      });
    } catch (e) { /* */ }
  });

  // ── 1. Список покупок есть у всех, а не только у покупателя ──
  await openProduct(page, 'p1');
  const guestBtn = await page.evaluate(() => {
    const el = document.getElementById('btnShopAdd');
    return { there: !!el, hidden: el.hidden, onec: !document.getElementById('shopOnec') ? 'нет' : 'есть' };
  });
  chk(guestBtn.there && !guestBtn.hidden, 'у покупателя кнопка «В список покупок» на месте');

  await asOwner(page, {});
  await openProduct(page, 'p1');
  const ownerBtn = await page.evaluate(() => {
    const el = document.getElementById('btnShopAdd');
    return { hidden: el.hidden, label: el.textContent.trim() };
  });
  chk(!ownerBtn.hidden, `и у вошедшего владельца тоже (${ownerBtn.label})`);
  const added = await page.evaluate(async () => {
    document.getElementById('btnShopAdd').click();
    await new Promise((r) => setTimeout(r, 250));
    return {
      bar: !document.getElementById('shopBar').hidden,
      saved: JSON.parse(localStorage.getItem('wm_shop_v1') || '[]')[0],
    };
  });
  chk(added.bar, 'полоска «Список» видна вошедшему — раньше её прятали');
  chk(added.saved && added.saved.code === '101' && added.saved.article === 'АРТ-1'
    && added.saved.barcode === '4600000000011' && added.saved.unit === 'шт',
  `в строку сразу запоминаются код, артикул, штрихкод и единица (${JSON.stringify(added.saved && added.saved.code)})`);

  // ── 2. В списке видно единицу и упаковки ──
  await openShop(page, SHOP);
  const view = await page.evaluate(() => document.getElementById('shopBody').innerText.replace(/\s+/g, ' '));
  chk(/24 шт/.test(view), `у штучного товара количество в штуках (${(view.match(/Молоко[^·]*/) || [''])[0]})`);
  chk(/2,5 кг/.test(view), `у весового — в килограммах (${(view.match(/Колбаса[^·]*/) || [''])[0]})`);
  chk(/2 упаковки по 12/.test(view), `сказано, сколько это упаковок (${(view.match(/\d+ упаковки[^·]*/) || [''])[0]})`);
  chk(/код 101/.test(view), 'код товара виден в строке');

  // ── 3. «Скопировать для 1С» — ровно по шаблону ──
  const clip = await page.evaluate(async () => {
    document.getElementById('shopCopy1c').click();
    await new Promise((r) => setTimeout(r, 400));
    return window.__clip;
  });
  const rows = clip.split('\n').map((r) => r.split('\t'));
  chk(rows[0].join('|') === TEMPLATE.join('|'),
    `заголовки совпадают с шаблоном 1С (${rows[0].join(' | ')})`);
  chk(rows[0].length === 9, `девять колонок, как в шаблоне (${rows[0].length})`);
  chk(rows.length === 3, `строки только с количеством, пустые не уехали (${rows.length - 1} из 3)`);
  const milk = rows.find((r) => /Молоко/.test(r[2])) || [];
  chk(milk[0] === '101' && milk[1] === '4600000000011' && milk[3] === 'АРТ-1' && milk[4] === 'шт',
    `код, штрих-код, артикул и единица на своих местах (${milk.slice(0, 5).join(' | ')})`);
  chk(milk[5] === '24' && milk[6] === '89' && milk[7] === '2136',
    `количество, цена и сумма посчитаны (${milk.slice(5, 8).join(' | ')})`);
  const saus = rows.find((r) => /Колбаса/.test(r[2])) || [];
  chk(saus[4] === 'кг' && saus[5] === '2,5',
    `у весового единица «кг», а дробное число с запятой — иначе Excel сделает из него дату (${saus[4]}, ${saus[5]})`);
  // без строки заголовков: в ней «Всего» — это само название колонки
  chk(rows.slice(1).every((r) => r[8] === ''), 'колонка «Всего» оставлена пустой — её считает сама 1С');

  // ── 4. Сохранить как заявку ──
  const saved = await page.evaluate(async () => {
    document.getElementById('shopSaveReq').click();
    await new Promise((r) => setTimeout(r, 400));
    const st = window.WM_PUBLISH._state();
    return { n: (st.requests || []).length, items: (st.requests || [])[0].items.length, badge: document.getElementById('tabWorkCount').textContent };
  });
  chk(saved.n === 1, `заявка сохранилась (${saved.n})`);
  chk(saved.items === 2, `в заявку ушли только позиции с количеством (${saved.items})`);

  // ── 5. Окно «Заявки»: открыть, принять, зачеркнуть, открыть снова ──
  const screen = await page.evaluate(async () => {
    document.querySelectorAll('.sheet-backdrop:not([hidden])').forEach((s) => { s.hidden = true; });
    window.WM_PUBLISH._work('requests');
    await new Promise((r) => setTimeout(r, 400));
    return {
      open: !document.getElementById('requestsSheet').hidden,
      text: document.getElementById('requestsBody').innerText.replace(/\s+/g, ' '),
      rows: document.querySelectorAll('#requestsBody [data-req-open]').length,
    };
  });
  chk(screen.open && screen.rows === 1, `окно заявок открывается из «Работы» (${screen.rows})`);
  chk(/ждут приёмки · 1/i.test(screen.text), `видно, сколько ждёт приёмки (${screen.text.slice(0, 40)})`);

  const inside = await page.evaluate(async () => {
    document.querySelector('#requestsBody [data-req-open]').click();
    await new Promise((r) => setTimeout(r, 350));
    const t = document.getElementById('requestsBody').innerText.replace(/\s+/g, ' ');
    return { text: t, copy: !!document.querySelector('[data-req-copy]'), file: !!document.querySelector('[data-req-file]') };
  });
  chk(/Молоко/.test(inside.text) && /Колбаса/.test(inside.text), 'внутри заявки видны её товары');
  chk(/код 101/.test(inside.text), 'с кодами — чтобы сверить с 1С глазами');
  chk(inside.copy && inside.file, 'внутри заявки есть «Скопировать для 1С» и «Скачать файл»');

  const taken = await page.evaluate(async () => {
    document.querySelector('[data-req-take]').click();
    await new Promise((r) => setTimeout(r, 400));
    document.querySelector('[data-req-back]').click();
    await new Promise((r) => setTimeout(r, 350));
    return {
      text: document.getElementById('requestsBody').innerText.replace(/\s+/g, ' '),
      struck: document.querySelectorAll('#requestsBody .req-taken').length,
      takenAt: window.WM_PUBLISH._state().requests[0].takenAt,
    };
  });
  chk(!!taken.takenAt, `отметка «всё принял» сохранилась (${taken.takenAt})`);
  chk(/принятые · 1/i.test(taken.text), `принятая переехала в свою группу (${taken.text.slice(0, 60)})`);
  chk(taken.struck === 1, 'принятая заявка зачёркнута');

  // главное требование: принятую можно открыть и скопировать заново в любой день
  const again = await page.evaluate(async () => {
    window.__clip = '';
    document.querySelector('#requestsBody [data-req-open]').click();
    await new Promise((r) => setTimeout(r, 350));
    document.querySelector('[data-req-copy]').click();
    await new Promise((r) => setTimeout(r, 400));
    return window.__clip;
  });
  chk(again.split('\n')[0] === TEMPLATE.join('\t'),
    'принятую заявку можно скопировать заново — заголовки те же');
  chk(/Молоко/.test(again) && /Колбаса/.test(again), 'и строки в ней те же');

  // ── 6. Заявки переживают переустановку: едут в снимке каталога ──
  const snap = await page.evaluate(() => {
    const s = window.WM_PUBLISH.buildFullSnapshot();
    return { n: (s.requests || []).length, items: ((s.requests || [])[0] || {}).items.length };
  });
  chk(snap.n === 1 && snap.items === 2,
    `заявки уходят в каталог владельца, а не только на телефон (${snap.n})`);

  // ── 7. Покупателю рабочих кнопок не видно ──
  const guest = await page.evaluate(async () => {
    const P = window.WM_PUBLISH; const s = P._state();
    s.session = null; s.isAdmin = false; s.canPurchase = false; s.canSales = false;
    P.renderAll();
    await new Promise((r) => setTimeout(r, 300));
    document.querySelectorAll('.sheet-backdrop:not([hidden])').forEach((x) => { x.hidden = true; });
    document.getElementById('shopOpen').click();
    await new Promise((r) => setTimeout(r, 350));
    const vis = (id) => { const el = document.getElementById(id); if (!el) return false;
      for (let n = el; n && n !== document.body; n = n.parentElement) if (n.hidden) return false; return true; };
    return { copy: vis('shopCopy1c'), save: vis('shopSaveReq'), wa: vis('shopWa') };
  });
  chk(!guest.copy && !guest.save, 'покупателю выгрузки в 1С и «Сохранить как заявку» не видно');
  chk(guest.wa, 'а «Отправить в WhatsApp» у него на месте — этим он и присылает список');


  /* ── 8. Список собирается прямо в своём окне ───────────────────────────────
   * Владелец: «заходишь в это окно, и там же сканером или вводишь код,
   * наименование, поиск — и заодно количество». Раньше за каждым товаром
   * приходилось выходить в каталог, искать, открывать карточку и возвращаться:
   * на сорок позиций — сорок кругов по приложению. */
  await asOwner(page, {});
  await openShop(page, []);
  const addRow = await page.evaluate(() => ({
    field: !!document.getElementById('shopFind'),
    scan: !!document.getElementById('shopScan'),
  }));
  chk(addRow.field && addRow.scan, 'в окне списка есть поле поиска и кнопка камеры');

  // поиск по названию
  const byName = await page.evaluate(async () => {
    const f = document.getElementById('shopFind');
    f.value = 'колбас'; f.dispatchEvent(new Event('input', { bubbles: true }));
    await new Promise((r) => setTimeout(r, 400));
    return [...document.querySelectorAll('#shopFindList [data-shop-pick]')]
      .map((x) => x.innerText.replace(/\s+/g, ' ').trim());
  });
  chk(byName.length === 1 && /Колбаса/.test(byName[0]), `поиск по названию находит товар (${byName.join(' | ')})`);
  chk(/код 202/.test(byName[0]), `в найденном видно код и цену (${byName[0]})`);

  // поиск по коду
  const byCode = await page.evaluate(async () => {
    const f = document.getElementById('shopFind');
    f.value = '303'; f.dispatchEvent(new Event('input', { bubbles: true }));
    await new Promise((r) => setTimeout(r, 400));
    return [...document.querySelectorAll('#shopFindList [data-shop-pick]')]
      .map((x) => x.innerText.replace(/\s+/g, ' ').trim());
  });
  chk(byCode.some((r) => /Батон/.test(r)), `поиск по коду находит товар (${byCode.join(' | ')})`);

  // выбрали — добавилось, поле очистилось, можно набирать следующий
  const picked = await page.evaluate(async () => {
    document.querySelector('#shopFindList [data-shop-pick]').click();
    await new Promise((r) => setTimeout(r, 400));
    return {
      list: JSON.parse(localStorage.getItem('wm_shop_v1') || '[]').map((x) => x.code),
      field: document.getElementById('shopFind').value,
      focus: document.activeElement.id,
      rows: document.querySelectorAll('#shopBody [data-shop-qty]').length,
    };
  });
  chk(picked.list.includes('303'), `тап по найденному добавляет его в список (${picked.list.join(',')})`);
  chk(picked.field === '' && picked.focus === 'shopFind',
    'поле очищается и курсор остаётся в нём — следующий товар набирается сразу');
  chk(picked.rows === 1, `товар появился в списке строкой (${picked.rows})`);

  // количество набирается руками
  const typedQty = await page.evaluate(async () => {
    const inp = document.querySelector('#shopBody [data-shop-qty]');
    inp.value = '24';
    inp.dispatchEvent(new Event('change', { bubbles: true }));
    await new Promise((r) => setTimeout(r, 350));
    return JSON.parse(localStorage.getItem('wm_shop_v1') || '[]')[0].qty;
  });
  chk(typedQty === 24, `количество можно ввести числом, а не кнопками ±1 (${typedQty})`);

  const badQty = await page.evaluate(async () => {
    const inp = document.querySelector('#shopBody [data-shop-qty]');
    inp.value = '';
    inp.dispatchEvent(new Event('change', { bubbles: true }));
    await new Promise((r) => setTimeout(r, 300));
    return { saved: JSON.parse(localStorage.getItem('wm_shop_v1') || '[]')[0].qty, shown: inp.value };
  });
  chk(badQty.saved === 24 && badQty.shown === '24',
    `пустое поле не превращает позицию в ноль — возвращается прежнее (${badQty.saved})`);

  const comma = await page.evaluate(async () => {
    const inp = document.querySelector('#shopBody [data-shop-qty]');
    inp.value = '2,5';
    inp.dispatchEvent(new Event('change', { bubbles: true }));
    await new Promise((r) => setTimeout(r, 300));
    return JSON.parse(localStorage.getItem('wm_shop_v1') || '[]')[0].qty;
  });
  chk(comma === 2.5, `дробное через запятую понимается — так набирают вес (${comma})`);

  // сканер добавляет в список и складывает повторы
  const scanned = await page.evaluate(async () => {
    const P = window.WM_PUBLISH;
    P._scanShop('4600000000011');          // Молоко
    P._scanShop('4600000000011');          // то же второй раз
    P._scanShop('0000000000000');          // чужой штрихкод
    await new Promise((r) => setTimeout(r, 300));
    const list = JSON.parse(localStorage.getItem('wm_shop_v1') || '[]');
    return {
      milk: (list.find((x) => x.code === '101') || {}).qty,
      n: list.length,
      panel: document.getElementById('scanResult').innerText.replace(/\s+/g, ' '),
    };
  });
  chk(scanned.milk === 2, `сканирование добавляет товар, повтор прибавляет количество (${scanned.milk})`);
  chk(/Нет в каталоге/.test(scanned.panel), `чужой штрихкод так и говорит (${scanned.panel.slice(0, 30)})`);

  // весовая этикетка: вес с неё сразу становится количеством
  const weighed = await page.evaluate(async () => {
    const P = window.WM_PUBLISH;
    const ean = P._ean13('23' + '00202' + '00330');   // код 202, 330 г
    P._scanShop(ean);
    await new Promise((r) => setTimeout(r, 300));
    const list = JSON.parse(localStorage.getItem('wm_shop_v1') || '[]');
    return { ean, qty: (list.find((x) => x.code === '202') || {}).qty };
  });
  chk(weighed.qty === 0.33,
    `с весовой этикетки вес сразу становится количеством, его не набирают руками (${weighed.qty} кг)`);

  chk(!errs.length, `нет сбоев JS (${errs.length}${errs.length ? ': ' + errs[0] : ''})`);
  await done(b);
})();

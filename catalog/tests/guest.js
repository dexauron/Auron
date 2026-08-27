// Покупатель: зашёл по ссылке, пароль не вводил. Видит только «магазинное»
// (название, код, цену, наличие, дату поступления) и может связаться с
// магазином. Всё рабочее и внутреннее ему не показывается вовсе.
const { chromium, newPage, asOwner, openProduct, runner } = require('./helpers');

const products = [
  { id: 'p1', name: 'Молоко Простоквашино 3.2%', code: '101', group_id: 'g1', retail_price: 89, unit: 'шт',
    photos: ['https://example.com/1.jpg'], barcodes: ['4600000000011'], stock: 7, arrival_at: '2026-08-20',
    article: 'АРТ-9', department: 'Молочный', note: 'ставить вперёд', supplier_ids: ['s1'] },
  { id: 'p2', name: 'Кефир Домик в деревне', code: '102', group_id: 'g1', retail_price: 75, unit: 'шт',
    photos: [], barcodes: [], stock: 0, arrival_at: '2026-08-25' },
];
const groups = [{ id: 'g1', name: 'Молочные' }];

(async () => {
  const b = await chromium.launch();
  const { chk, done } = runner('ПОКУПАТЕЛЬ БЕЗ ПАРОЛЯ');
  const { page, errs } = await newPage(b, { products, groups });
  await page.waitForTimeout(400);

  // ── 1. Каталог показан списком, без фотографий ──
  const grid = await page.evaluate(() => ({
    list: document.getElementById('productGrid').classList.contains('list'),
    photos: document.querySelectorAll('#productGrid img').length,
    toggle: getComputedStyle(document.getElementById('viewToggleBtn')).display,
    strips: [...document.querySelectorAll('.recent-strip')].filter((s) => !s.hidden).length,
    text: document.getElementById('productGrid').innerText.replace(/\s+/g, ' '),
  }));
  chk(grid.list, 'каталог показан списком');
  chk(grid.photos === 0, `фотографий в списке нет (${grid.photos})`);
  chk(grid.toggle === 'none', 'переключателя вида нет — покупателю нечего переключать');
  chk(grid.strips === 0, `ленты с фотографиями скрыты (${grid.strips})`);
  chk(/89|75/.test(grid.text), `цена видна (${grid.text.slice(0, 60)})`);
  chk(/101|102/.test(grid.text), 'код товара виден');
  chk(/Есть|Мало|Нет/.test(grid.text), 'видно, есть ли товар в магазине');
  chk(!/без ШК/.test(grid.text), 'служебных пометок для кассы («без ШК») покупателю не видно');
  chk(/завоз 20\.08|завоз 25\.08/.test(grid.text), `в списке видно, когда товар завезли (${(grid.text.match(/завоз [\d.]+/) || [''])[0]})`);

  // ── 2. Карточка товара: только нужное покупателю ──
  await openProduct(page, 'p1');
  const card = await page.evaluate(() => {
    const t = document.querySelector('#productSheet .sheet-body').innerText.replace(/\s+/g, ' ');
    return {
      text: t,
      photos: document.querySelectorAll('#sheetPhotos img').length,
      photoHidden: document.getElementById('sheetPhotos').hidden,
      similar: (document.getElementById('sheetSimilar') || {}).innerHTML || '',
      prices: (document.getElementById('sheetPrices') || {}).innerHTML || '',
      stock: (document.getElementById('sheetStock') || {}).innerHTML || '',
      report: !document.getElementById('btnReportPrice').hidden,
      restock: document.getElementById('btnRestock').hidden,
      compare: document.getElementById('btnCompareAdd').hidden,
    };
  });
  chk(card.photoHidden && card.photos === 0, 'в карточке нет фотографий');
  chk(/Поступил/.test(card.text) && /20\.08/.test(card.text), `видно, когда товар поступил (${(card.text.match(/Поступил[^·]*/) || [''])[0]})`);
  chk(/Код товара/.test(card.text) && /101/.test(card.text), 'код товара показан');
  chk(!/Артикул|Штрихкод|Отдел|Примечание/.test(card.text), 'внутренние поля скрыты (артикул, штрихкод, отдел, примечание)');
  chk(!card.prices.trim() && !card.stock.trim(), 'закупочные цены и остаток числом не показаны');
  chk(!card.similar.trim(), 'лента «похожие» с фотографиями скрыта');
  chk(card.restock && card.compare, 'рабочие кнопки («закончилось», «к сравнению») скрыты');
  chk(card.report, 'зато есть «Видел дешевле в другом магазине»');

  // ── 3. Подсказка о цене копится на телефоне ──
  const rep = await page.evaluate(async () => {
    document.getElementById('btnReportPrice').click();
    await new Promise((r) => setTimeout(r, 400));
    const open = !document.getElementById('priceReportSheet').hidden;
    const name = document.getElementById('repName').textContent;
    const price = document.getElementById('repPrice');
    price.value = '75';
    price.dispatchEvent(new Event('input', { bubbles: true }));
    document.getElementById('repStore').value = 'Магнит';
    document.getElementById('repSave').click();
    await new Promise((r) => setTimeout(r, 400));
    return { open, name, saved: JSON.parse(localStorage.getItem('wm_guest_prices_v1') || '[]'),
      badge: document.getElementById('tabStoreCount').textContent };
  });
  chk(rep.open && /Молоко/.test(rep.name), `форма открылась с нужным товаром (${rep.name})`);
  chk(rep.saved.length === 1 && rep.saved[0].price === 75 && rep.saved[0].store === 'Магнит',
    `подсказка сохранена на телефоне (${JSON.stringify(rep.saved[0] || {})})`);
  chk(rep.badge === '1', `на вкладке «Магазин» счётчик подсказок (${rep.badge})`);

  // ── 4. Экран «Магазин»: связь с владельцем и отправка списком ──
  const store = await page.evaluate(async () => {
    document.querySelectorAll('.sheet-backdrop:not([hidden])').forEach((s) => { s.hidden = true; });
    document.querySelector('.tabbar [data-tab="store"]').click();
    await new Promise((r) => setTimeout(r, 400));
    const wa = document.getElementById('storeWa');
    const tel = document.getElementById('storeTel');
    return {
      open: !document.getElementById('storeSheet').hidden,
      wa: wa ? wa.getAttribute('href') : '',
      tel: tel ? tel.getAttribute('href') : '',
      body: document.getElementById('storeBody').innerText.replace(/\s+/g, ' '),
      canSend: !document.getElementById('storeSend').hidden,
    };
  });
  chk(store.open, 'вкладка «Магазин» открывает свой экран');
  chk(/wa\.me\/79640616601/.test(store.wa), `есть кнопка WhatsApp на номер магазина (${store.wa})`);
  chk(/^tel:\+79640616601$/.test(store.tel), `и кнопка позвонить (${store.tel})`);
  chk(/Молоко/.test(store.body) && /Магнит/.test(store.body), 'подсказка о цене видна в списке');
  chk(store.canSend, 'кнопка «Отправить подсказки в WhatsApp» доступна');

  const sent = await page.evaluate(async () => {
    let opened = '';
    const real = window.open;
    window.open = (u) => { opened = u; return null; };
    document.getElementById('storeSend').click();
    await new Promise((r) => setTimeout(r, 300));
    window.open = real;
    return { opened, left: JSON.parse(localStorage.getItem('wm_guest_prices_v1') || '[]').length };
  });
  chk(/wa\.me\/79640616601\?text=/.test(sent.opened), 'отправка открывает WhatsApp с готовым текстом');
  chk(decodeURIComponent(sent.opened).includes('Молоко') && decodeURIComponent(sent.opened).includes('Магнит'),
    `в сообщении перечислены подсказки (${decodeURIComponent(sent.opened).slice(0, 80)}…)`);
  chk(sent.left === 0, `отправленное больше не копится (${sent.left})`);

  // ── 5. Список покупок: сколько выйдет ──
  const shop = await page.evaluate(async () => {
    document.querySelectorAll('.sheet-backdrop:not([hidden])').forEach((s) => { s.hidden = true; });
    window.location.hash = ''; await new Promise((r) => setTimeout(r, 100));
    window.location.hash = '#p=p1'; await new Promise((r) => setTimeout(r, 500));
    const btn = document.getElementById('btnShopAdd');
    const label = btn.textContent.trim();
    btn.click(); await new Promise((r) => setTimeout(r, 200));
    const after = btn.textContent.trim();
    window.location.hash = ''; await new Promise((r) => setTimeout(r, 100));
    window.location.hash = '#p=p2'; await new Promise((r) => setTimeout(r, 500));
    document.getElementById('btnShopAdd').click();
    await new Promise((r) => setTimeout(r, 300));
    document.querySelectorAll('.sheet-backdrop:not([hidden])').forEach((s) => { s.hidden = true; });
    const bar = document.getElementById('shopBar');
    return { label, after, barShown: !bar.hidden,
      count: document.getElementById('shopCount').textContent,
      total: document.getElementById('shopTotal').textContent,
      saved: JSON.parse(localStorage.getItem('wm_shop_v1') || '[]').length };
  });
  chk(/В список покупок/.test(shop.label) && /Убрать/.test(shop.after), `кнопка списка переключается (${shop.after})`);
  chk(shop.saved === 2, `оба товара в списке (${shop.saved})`);
  chk(shop.barShown && /2 позиции/.test(shop.count), `полоска показывает, сколько отмечено (${shop.count})`);
  chk(/164/.test(shop.total.replace(/\s/g, '')), `и на какую сумму — 89 + 75 (${shop.total})`);

  const shopSheet = await page.evaluate(async () => {
    document.getElementById('shopOpen').click();
    await new Promise((r) => setTimeout(r, 400));
    document.querySelector('[data-shop-plus="p1"]').click();   // молока — две штуки
    await new Promise((r) => setTimeout(r, 250));
    const afterPlus = document.getElementById('shopBody').innerText.replace(/\s+/g, ' ');
    document.querySelector('[data-shop-done="p2"]').click();   // кефир уже в корзине
    await new Promise((r) => setTimeout(r, 250));
    return { afterPlus, done: document.querySelectorAll('#shopBody .shop-done').length,
      total: document.getElementById('shopBody').innerText.replace(/\s+/g, ' '),
      barTotal: document.getElementById('shopTotal').textContent };
  });
  chk(/253/.test(shopSheet.afterPlus.replace(/\s/g, '')), `количество меняет итог: 89×2 + 75 (${shopSheet.afterPlus.slice(0, 60)})`);
  chk(shopSheet.done === 1, 'вычеркнутая строка отмечена');
  chk(/178/.test(shopSheet.barTotal.replace(/\s/g, '')), `вычеркнутое из суммы уходит (${shopSheet.barTotal})`);

  // ── 6. После входа сотрудника всё рабочее возвращается ──
  await asOwner(page, {});
  await page.waitForTimeout(400);
  const staff = await page.evaluate(() => ({
    guestClass: document.documentElement.classList.contains('guest'),
    storeTab: document.querySelector('.tabbar [data-tab="store"]').hidden,
    workTab: document.querySelector('.tabbar [data-tab="work"]').hidden,
    toggle: getComputedStyle(document.getElementById('viewToggleBtn')).display,
    shopBar: document.getElementById('shopBar').hidden,
  }));
  chk(!staff.guestClass && staff.storeTab && !staff.workTab,
    'после входа каталог снова рабочий: «Магазин» скрыт, «Работа» на месте');
  chk(staff.shopBar, 'полоска списка покупок сотруднику не мешает');
  chk(staff.toggle !== 'none', 'переключатель вида вернулся сотруднику');

  chk(!errs.length, `нет сбоев JS (${errs.length}${errs.length ? ': ' + errs[0] : ''})`);
  await done(b);
})();

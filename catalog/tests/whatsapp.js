// Отправка в WhatsApp: список покупок — близким, заказ — поставщику.
/* Сайт не может читать телефонную книжку, и не должен: мы открываем WhatsApp с
 * готовым текстом, а кому отправить — спрашивает он сам. Поэтому проверяем не
 * «выбрался контакт», а то, что уходит наружу: адрес wa.me и текст сообщения.
 * window.open подменяем — настоящий WhatsApp в проверке открывать незачем. */
const { chromium, newPage, asOwner, runner } = require('./helpers');

const products = [
  { id: 'p1', name: 'Молоко Простоквашино 3,2%', code: '101', retail_price: 89, group_id: 'g1', photos: [], barcodes: [], stock_state: 'in' },
  { id: 'p2', name: 'Хлеб Столовый', code: '102', retail_price: 45, group_id: 'g1', photos: [], barcodes: [], stock_state: 'in' },
  { id: 'p3', name: 'Сыр Российский', code: '5940', retail_price: 790, group_id: 'g1', photos: [], barcodes: [], stock_state: 'in' },
];
const groups = [{ id: 'g1', name: 'Разное' }];
const suppliers = [{ id: 's1', name: 'Молзавод' }, { id: 's2', name: 'Хлебозавод' }];

// подменяем открытие окна и возвращаем адрес, который приложение попыталось открыть
const spy = (page) => page.evaluate(() => {
  window.__wa = null;
  window.open = (u) => { window.__wa = u; return { closed: false }; };
});
const grabbed = (page) => page.evaluate(() => {
  const u = window.__wa;
  if (!u) return null;
  const q = u.indexOf('?text=');
  return { url: u, phone: u.slice('https://wa.me/'.length, q < 0 ? undefined : q), text: q < 0 ? '' : decodeURIComponent(u.slice(q + 6)) };
});

const openShopList = (page, rows) => page.evaluate(async (list) => {
  document.querySelectorAll('.sheet-backdrop:not([hidden])').forEach((s) => { s.hidden = true; });
  localStorage.setItem('wm_shop_v1', JSON.stringify(list));
  window.WM_PUBLISH.renderAll();
  await new Promise((r) => setTimeout(r, 250));
  document.getElementById('shopOpen').click();
  await new Promise((r) => setTimeout(r, 350));
}, rows);

(async () => {
  const b = await chromium.launch();
  const { chk, done } = runner('ОТПРАВКА В WHATSAPP');
  const { page, errs } = await newPage(b, { products, groups });

  // ── 1. Список покупок уходит в WhatsApp ──
  await spy(page);
  await openShopList(page, [
    { id: 'p1', name: 'Молоко Простоквашино 3,2%', code: '101', price: 89, qty: 2, done: false },
    { id: 'p3', name: 'Сыр Российский', code: '5940', price: 790, qty: 1, done: false },
    { id: 'p2', name: 'Хлеб Столовый', code: '102', price: 45, qty: 1, done: true },   // уже куплен
  ]);
  const btn = await page.evaluate(() => {
    const el = document.getElementById('shopWa');
    return { there: !!el, hidden: el ? el.hidden : true, label: el ? el.textContent.trim() : '' };
  });
  chk(btn.there && !btn.hidden, `в списке покупок есть кнопка отправки (${btn.label})`);
  chk(/WhatsApp/.test(btn.label), `кнопка названа понятно (${btn.label})`);

  await page.evaluate(() => document.getElementById('shopWa').click());
  await page.waitForTimeout(200);
  const shop = await grabbed(page);
  chk(!!shop && /^https:\/\/wa\.me\//.test(shop.url), `открывается WhatsApp (${shop ? shop.url.slice(0, 24) : 'ничего'})`);
  chk(shop.phone === '', 'номер не подставлен — контакты покажет сам WhatsApp, отправить можно кому угодно');
  chk(/Список покупок/.test(shop.text), `в сообщении есть заголовок (${shop.text.slice(0, 20)})`);
  chk(/Молоко Простоквашино 3,2%/.test(shop.text) && /Сыр Российский/.test(shop.text), 'в сообщении есть названия товаров');
  chk(/2\s*×/.test(shop.text), `количество написано (${(shop.text.match(/.*Молоко.*/) || [''])[0]})`);
  chk(/Итого/.test(shop.text), 'внизу итоговая сумма');
  chk(!/Хлеб Столовый/.test(shop.text), 'вычеркнутое не отправляем — это уже куплено');
  chk(/#l=/.test(shop.text), 'рядом с текстом ушла ссылка на живой список');
  chk(/Мира/.test(shop.text), `в конце подпись магазина с адресом (${shop.text.split('\n').pop()})`);

  // ── 2. Длинный список не превращается в простыню ──
  await spy(page);
  const many = Array.from({ length: 65 }, (_, i) => ({ id: 'z' + i, name: 'Товар ' + i, code: '', price: 10, qty: 1, done: false }));
  await openShopList(page, many);
  await page.evaluate(() => document.getElementById('shopWa').click());
  await page.waitForTimeout(200);
  const big = await grabbed(page);
  const numbered = (big.text.match(/^\d+\. /gm) || []).length;
  chk(numbered === 60, `в сообщение уходит не больше шестидесяти строк (${numbered})`);
  chk(/…и ещё 5 позиций/.test(big.text), `про остальные сказано честно (${(big.text.match(/…и ещё.*/) || [''])[0]})`);

  // ── 3. Пустой список отправить нельзя ──
  await spy(page);
  await page.evaluate(async () => {
    localStorage.setItem('wm_shop_v1', JSON.stringify([{ id: 'p1', name: 'Молоко', code: '101', price: 89, qty: 1, done: true }]));
    window.WM_PUBLISH.renderAll();
    await new Promise((r) => setTimeout(r, 250));
    document.getElementById('shopWa').click();
    await new Promise((r) => setTimeout(r, 200));
  });
  chk(await grabbed(page) === null, 'из пустого списка ничего не отправляется');

  // ── 4. Заказ поставщику ──
  await page.evaluate(() => document.querySelectorAll('.sheet-backdrop:not([hidden])').forEach((s) => { s.hidden = true; }));
  await asOwner(page, { suppliers });
  await page.evaluate(() => { window.WM_PUBLISH._state().contacts.s1 = { phone: '8 964 061-66-01' }; });
  await spy(page);
  const noSup = await page.evaluate(async () => {
    window.WM_PUBLISH._orderForm(null, null, { items: [{ name: 'Молоко 3,2%', code: '101', qty: 6 }] });
    await new Promise((r) => setTimeout(r, 350));
    document.getElementById('ordSendWa').click();
    await new Promise((r) => setTimeout(r, 200));
    const err = document.getElementById('ordError');
    return { opened: window.__wa, err: err.hidden ? '' : err.textContent };
  });
  chk(!noSup.opened && /поставщик/i.test(noSup.err), `без поставщика заказ не уходит и объясняет почему (${noSup.err})`);

  await spy(page);
  await page.evaluate(async () => {
    document.querySelectorAll('.sheet-backdrop:not([hidden])').forEach((s) => { s.hidden = true; });
    window.WM_PUBLISH._orderForm(null, null, {
      supplier_id: 's1',
      items: [{ name: 'Молоко 3,2%', code: '101', qty: 6 }, { name: 'Кефир 1%', code: '102', qty: 4 }],
    });
    await new Promise((r) => setTimeout(r, 350));
    document.getElementById('ordDue').value = '2026-09-05';
    document.getElementById('ordWho').value = 'Смена 1';
    document.getElementById('ordSendWa').click();
    await new Promise((r) => setTimeout(r, 200));
  });
  const ord = await grabbed(page);
  chk(!!ord, 'заказ открывает WhatsApp');
  chk(ord.phone === '79640616601', `номер поставщика приведён к международному виду — восьмёрка стала семёркой (${ord.phone})`);
  chk(/Молзавод/.test(ord.text), 'в заказе видно, кому он адресован');
  chk(/Молоко 3,2%.*101.*6/.test(ord.text), `позиция с кодом и количеством (${(ord.text.match(/1\. .*/) || [''])[0]})`);
  chk(/Нужно к/.test(ord.text), 'указан срок поставки');
  chk(/Смена 1/.test(ord.text), 'видно, кто заказал — поставщику будет с кем сверяться');

  // ── 5. Поставщик без телефона: отправить всё равно можно ──
  await spy(page);
  await page.evaluate(async () => {
    document.querySelectorAll('.sheet-backdrop:not([hidden])').forEach((s) => { s.hidden = true; });
    window.WM_PUBLISH._orderForm(null, null, { supplier_id: 's2', items: [{ name: 'Батон', code: '201', qty: 10 }] });
    await new Promise((r) => setTimeout(r, 350));
    document.getElementById('ordSendWa').click();
    await new Promise((r) => setTimeout(r, 200));
  });
  const noPhone = await grabbed(page);
  chk(noPhone && noPhone.phone === '', 'телефона у поставщика нет — WhatsApp просто спросит, кому отправить');
  chk(/Батон/.test(noPhone.text), 'текст заказа при этом собран полностью');

  chk(!errs.length, `нет сбоев JS (${errs.length}${errs.length ? ': ' + errs[0] : ''})`);
  await done(b);
})();

/* Заказ поставщику: собрать удобно и отправить кому угодно.
 *
 * Просьба владельца: удобно искать товар, удобно вводить количество; добавил
 * позицию — сразу добавляешь следующую; готовый заказ уходит в WhatsApp
 * поставщику, а ещё его можно СКОПИРОВАТЬ целиком и отправить тому, кого в
 * базе нет.
 *
 * Было: одно поле и точное совпадение кода, штрихкода или названия. Ошибся в
 * букве — позиция уходила в заказ свободным текстом, без кода, и поставщик
 * получал заказ, по которому непонятно, что отгружать.
 */
const { chromium, newPage, asOwner, runner } = require('./helpers');

const products = [
  { id: 'p1', name: 'Молоко Простоквашино 3,2% 950мл', code: '101', group_id: 'g1', retail_price: 89, unit: 'шт', photos: [], barcodes: ['4600000000011'], supplier_ids: ['s1'] },
  { id: 'p2', name: 'Молоко Домик в деревне 2,5%', code: '102', group_id: 'g1', retail_price: 79, unit: 'шт', photos: [], barcodes: ['4600000000028'], supplier_ids: ['s1'] },
  { id: 'p3', name: 'Сыр Российский 45% весовой', code: '103', group_id: 'g1', retail_price: 699, unit: 'кг', is_weighted: true, photos: [], barcodes: [], supplier_ids: ['s1'] },
];
const groups = [{ id: 'g1', name: 'Разное' }];
const suppliers = [{ id: 's1', name: 'Молзавод' }];

const openForm = (page) => page.evaluate(async () => {
  document.querySelectorAll('.sheet-backdrop:not([hidden])').forEach((x) => { x.hidden = true; });
  document.getElementById('adminBtn').click();
  await new Promise((r) => setTimeout(r, 300));
  document.getElementById('menuOrders').click();
  await new Promise((r) => setTimeout(r, 400));
  document.getElementById('ordAdd').click();
  await new Promise((r) => setTimeout(r, 400));
});
const type = (page, text) => page.evaluate(async (t) => {
  const inp = document.getElementById('ordItemName');
  inp.value = t;
  inp.dispatchEvent(new Event('input', { bubbles: true }));
  await new Promise((r) => setTimeout(r, 250));
  return [...document.querySelectorAll('#ordSuggest .ord-sug-row')].map((x) => x.innerText.replace(/\s+/g, ' ').trim());
}, text);
const items = (page) => page.evaluate(() => [...document.querySelectorAll('#ordItems .ord-item')]
  .map((x) => x.innerText.replace(/\s+/g, ' ').trim()));

(async () => {
  const b = await chromium.launch();
  const { chk, done } = runner('ЗАКАЗ ПОСТАВЩИКУ');
  const { page, errs } = await newPage(b, { products, groups });
  await asOwner(page, { suppliers });
  await page.waitForTimeout(400);
  await openForm(page);

  // ── 1. Поиск подсказками, а не точным совпадением ──
  const sug = await type(page, 'молок');
  chk(sug.length === 2 && sug.every((t) => /Молоко/.test(t)), `поиск подсказывает товары (${sug.length}: ${sug.join(' | ').slice(0, 60)})`);
  chk(sug.some((t) => /101/.test(t)), 'в подсказке виден код товара');
  const typo = await type(page, 'прастоквашино');
  chk(typo.length > 0 && /Простоквашино/.test(typo[0]), `опечатка не мешает найти товар (${typo[0] || 'НЕ НАШЁЛ'})`);

  // ── 2. Весовой товар считается в килограммах ──
  await type(page, 'сыр рос');
  const weighted = await page.evaluate(async () => {
    document.querySelector('#ordSuggest .ord-sug-row').click();
    await new Promise((r) => setTimeout(r, 200));
    const unit = document.getElementById('ordItemUnit').textContent;
    document.getElementById('ordQtyPlus').click();
    document.getElementById('ordQtyPlus').click();
    await new Promise((r) => setTimeout(r, 100));
    return { unit, qty: document.getElementById('ordItemQty').value };
  });
  chk(weighted.unit === 'кг', `у весового товара единица — килограммы (${weighted.unit})`);
  chk(weighted.qty === '1,2', `шаг у весового — по сто граммов, а не по штуке (${weighted.qty})`);

  await page.evaluate(() => document.getElementById('ordItemAdd').click());
  await page.waitForTimeout(250);
  const after = await page.evaluate(() => ({
    name: document.getElementById('ordItemName').value,
    unit: document.getElementById('ordItemUnit').textContent,
    focused: document.activeElement && document.activeElement.id,
  }));
  chk(!after.name, 'поле очистилось — следующую позицию вводишь сразу');
  chk(after.focused === 'ordItemName', `и осталось в руках (в фокусе «${after.focused}»)`);

  // ── 3. Штучный товар — по коду с ценника ──
  await type(page, '101');
  await page.evaluate(() => document.getElementById('ordItemAdd').click());
  await page.waitForTimeout(250);
  const list = await items(page);
  chk(list.length === 2, `в заказе две позиции (${list.length})`);
  chk(/1,2 кг/.test(list[0]), `весовой записан в килограммах (${list[0].slice(0, 40)})`);
  chk(/1 шт/.test(list[1]) && /101/.test(list[1]), `штучный записан в штуках и с кодом (${list[1].slice(0, 46)})`);

  // количество можно поправить прямо в списке
  const stepped = await page.evaluate(async () => {
    document.querySelector('#ordItems [data-ord-item-plus="1"]').click();
    await new Promise((r) => setTimeout(r, 150));
    return document.querySelectorAll('#ordItems .ord-item')[1].innerText.replace(/\s+/g, ' ');
  });
  chk(/2 шт/.test(stepped), `количество правится прямо в списке (${stepped.slice(0, 46)})`);

  // ── 4. Скопировать весь заказ — для поставщика не из базы ──
  const copied = await page.evaluate(async () => {
    let text = '';
    // clipboard в браузере только для чтения — подменяем его как свойство
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: { writeText: (t) => { text = t; return Promise.resolve(); } },
    });
    document.getElementById('ordCopy').click();
    await new Promise((r) => setTimeout(r, 300));
    return { text, err: document.getElementById('ordError').hidden };
  });
  chk(copied.err, 'копирование не ругается на отсутствие поставщика — его может и не быть');
  chk(/Сыр Российский/.test(copied.text) && /Молоко Простоквашино/.test(copied.text),
    'в скопированном тексте оба товара');
  chk(/1,2 кг/.test(copied.text) && /2 шт/.test(copied.text),
    `и количество с единицей (${(copied.text.match(/— [^\n]*/g) || []).join(' | ')})`);
  chk(/код 103/.test(copied.text) && /код 101/.test(copied.text), 'и коды товаров — поставщику понятно, что отгружать');

  /* ── 5. Количество только положительное (находка GPT) ──
     Поле ввода свободное: «0» или «-3» уехали бы в заказ как есть, и
     поставщик получил бы «— -3 шт». */
  const bad = await page.evaluate(async () => {
    const inp = document.getElementById('ordItemName');
    inp.value = '102'; inp.dispatchEvent(new Event('input', { bubbles: true }));
    await new Promise((r) => setTimeout(r, 250));
    document.getElementById('ordItemQty').value = '-3';
    document.getElementById('ordItemAdd').click();
    await new Promise((r) => setTimeout(r, 200));
    const rows = [...document.querySelectorAll('#ordItems .ord-item')];
    return rows[rows.length - 1].innerText.replace(/\s+/g, ' ').trim();
  });
  chk(/1 шт/.test(bad) && !/-/.test(bad.replace(/−/g, '')), `отрицательное количество не уходит в заказ (${bad.slice(0, 46)})`);

  /* ── 6. Копия заказа — ЦЕЛИКОМ ──
     В сообщение WhatsApp длинный список не заталкиваем, но копия должна быть
     полной: «…и ещё 40 позиций» в заказе поставщику означало бы недопоставку
     (находка GPT). */
  const big = await page.evaluate(async () => {
    let text = '';
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true, value: { writeText: (t) => { text = t; return Promise.resolve(); } },
    });
    // набиваем заказ выше предела сообщения
    for (let i = 0; i < 70; i++) {
      const inp = document.getElementById('ordItemName');
      inp.value = 'Товар ' + i;
      inp.dispatchEvent(new Event('input', { bubbles: true }));
      document.getElementById('ordItemAdd').click();
    }
    await new Promise((r) => setTimeout(r, 300));
    document.getElementById('ordCopy').click();
    await new Promise((r) => setTimeout(r, 300));
    return { text, rows: document.querySelectorAll('#ordItems .ord-item').length };
  });
  chk(big.rows >= 70, `в заказе больше шестидесяти позиций (${big.rows})`);
  chk(!/и ещё/.test(big.text), 'копия заказа не обрезана словами «и ещё N позиций»');
  chk(/Товар 69/.test(big.text), 'в копии есть и последняя позиция');

  // ── 7. Отправка в WhatsApp без поставщика не уходит ──
  const noSup = await page.evaluate(async () => {
    document.getElementById('ordSendWa').click();
    await new Promise((r) => setTimeout(r, 200));
    const e = document.getElementById('ordError');
    return { hidden: e.hidden, text: e.textContent };
  });
  chk(!noSup.hidden && /поставщик/i.test(noSup.text), `без поставщика в WhatsApp не отправляем (${noSup.text})`);

  chk(errs.length === 0, `нет сбоев JS (${errs.length}${errs.length ? ': ' + errs[0] : ''})`);
  await done(b);
})();

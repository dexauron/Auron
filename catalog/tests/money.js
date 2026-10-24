// Деньги пишутся с разделителями разрядов — и там, где показываются, и там,
// где вводятся. «100000» и «1000000» на телефоне различаются только длиной,
// и ошибиться в разряде проще простого.
const { chromium, newPage, asOwner, runner } = require('./helpers');

const products = [
  { id: 'p1', name: 'Молоко', code: '101', group_id: 'g1', retail_price: 89, unit: 'шт', photos: [], barcodes: [] },
  { id: 'p2', name: 'Сыр дорогой', code: '102', group_id: 'g1', retail_price: 125000, unit: 'шт', photos: [], barcodes: [] },
];
const groups = [{ id: 'g1', name: 'Молочные' }];
const suppliers = [{ id: 's1', name: 'Молзавод' }];
const local = (d) => new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 10);
// в русском формате разряды разделяет неразрывный пробел — сравниваем по нему
const spaced = (s) => String(s).replace(/ | /g, ' ');

(async () => {
  const b = await chromium.launch();
  const { chk, done } = runner('ДЕНЬГИ С РАЗДЕЛИТЕЛЯМИ');
  const { page, errs } = await newPage(b, { products, groups });
  await asOwner(page, { suppliers });
  await page.waitForTimeout(300);

  // ── как показываем ──
  const shown = await page.evaluate(() => {
    const cards = [...document.querySelectorAll('.grid .card')].map((c) => c.innerText);
    return { cards };
  });
  chk(shown.cards.some((t) => /125 000|125 000|125 000/.test(t)),
    `цена в плитке разбита на разряды (${spaced(shown.cards.find((t) => /125/.test(t)) || '').replace(/\n/g, ' ')})`);

  // ── как вводим: сумма заказа ──
  const typed = await page.evaluate(async (due) => {
    document.querySelectorAll('.sheet-backdrop:not([hidden])').forEach((s) => { s.hidden = true; });
    document.getElementById('adminBtn').click();
    await new Promise((r) => setTimeout(r, 250));
    window.WM_PUBLISH._work('orders');
    await new Promise((r) => setTimeout(r, 350));
    document.getElementById('ordAdd').click();
    await new Promise((r) => setTimeout(r, 300));
    const inp = document.getElementById('ordAmount');
    inp.focus();
    // печатаем по одной цифре, как человек
    for (const ch of '1250000') {
      inp.value += ch;
      inp.dispatchEvent(new Event('input', { bubbles: true }));
      await new Promise((r) => setTimeout(r, 20));
    }
    const asTyped = inp.value;
    document.getElementById('ordSupplier').value = 's1';
    document.getElementById('ordDue').value = due;
    document.getElementById('ordSave').click();
    await new Promise((r) => setTimeout(r, 900));
    const saved = window.WM_PUBLISH._state().orders[0] || {};
    return { asTyped, amount: saved.amount, list: document.getElementById('ordersBody').innerText };
  }, local(new Date()));

  chk(spaced(typed.asTyped) === '1 250 000', `в поле сумма разбивается по ходу набора (${spaced(typed.asTyped)})`);
  chk(typed.amount === 1250000, `сохраняется настоящее число, а не текст с пробелами (${typed.amount})`);
  chk(/1 250 000|1 250 000|1 250 000/.test(typed.list),
    'в календаре заказов сумма тоже с разделителями');

  // правка суммы существующего заказа: в поле снова читаемый вид
  const reopened = await page.evaluate(async () => {
    document.querySelector('#ordersBody [data-ord-open]').click();
    await new Promise((r) => setTimeout(r, 350));
    return document.getElementById('ordAmount').value;
  });
  chk(spaced(reopened) === '1 250 000', `открыл заказ — сумма читается (${spaced(reopened)})`);

  // ── фильтр цены понимает пробелы ──
  const filtered = await page.evaluate(async () => {
    document.querySelectorAll('.sheet-backdrop:not([hidden])').forEach((s) => { s.hidden = true; });
    const min = document.getElementById('priceMin');
    min.value = '100000';
    min.dispatchEvent(new Event('input', { bubbles: true }));
    await new Promise((r) => setTimeout(r, 600));
    return { text: min.value, found: window.WM_PUBLISH.visibleProducts().map((p) => p.name) };
  });
  chk(spaced(filtered.text) === '100 000', `в фильтре цена тоже с разделителями (${spaced(filtered.text)})`);
  chk(filtered.found.length === 1 && /Сыр/.test(filtered.found[0]),
    `фильтр понимает сумму с пробелами (нашлось: ${filtered.found.join(', ')})`);

  // ── калькулятор считает от суммы с пробелами ──
  const calc = await page.evaluate(() => {
    const o = window.WM_PUBLISH._calcOffer('1 850', false, '', '');
    const o2 = window.WM_PUBLISH._calcOffer(1850, false, '', '');
    return { spacedCalc: o && Math.round(o.piece), plain: o2 && Math.round(o2.piece) };
  });
  chk(calc.spacedCalc === 1850 && calc.plain === 1850, `калькулятор понимает «1 850» (${calc.spacedCalc})`);

  chk(!errs.length, `нет сбоев JS (${errs.length}${errs.length ? ': ' + errs[0] : ''})`);
  await done(b);
})();

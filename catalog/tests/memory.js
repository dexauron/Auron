// Каталог не должен копить мусор и не должен ломаться на мелочах, которые
// владелец увидел вживую: почта из автозаполнения в поиске, «ничего не нашлось»
// вместе с «показать ещё», разрастающаяся история цен.
const { chromium, newPage, asOwner, runner } = require('./helpers');

const N = 60;
const products = Array.from({ length: N }, (_, i) => ({
  id: 'p' + i, name: 'Товар ' + i, code: String(100 + i), group_id: 'g1',
  retail_price: 10 + i, unit: 'шт', photos: [], created_at: '2026-01-01',
}));
// история цен: по 20 записей на товар, часть — очень старые
const prices = [];
for (const p of products) {
  for (let k = 0; k < 20; k++) {
    const year = k < 10 ? 2026 : 2021;
    prices.push({ product_id: p.id, supplier_id: 's1', price: 10 + k, price_date: `${year}-0${(k % 9) + 1}-01`, unit: 'шт' });
  }
}
// продажи за 20 разных периодов
const sales = [];
for (let m = 1; m <= 20; m++) {
  const mm = String(m % 12 + 1).padStart(2, '0');
  sales.push({ period_from: `2025-${mm}-01`, period_to: `2025-${mm}-28`, code: '100', name: 'Товар 0', qty: 5, amount: 50 });
}

(async () => {
  const b = await chromium.launch();
  const { chk, done } = runner('ПАМЯТЬ И МЕЛОЧИ ИНТЕРФЕЙСА');
  const { page, errs } = await newPage(b, { products, groups: [{ id: 'g1', name: 'Товары' }] });

  // ── 1. Поле поиска не должно быть узнаваемым для автозаполнения ──
  const field = await page.evaluate(() => {
    const el = document.getElementById('searchInput');
    return { name: el.getAttribute('name'), auto: el.getAttribute('autocomplete'), type: el.type };
  });
  chk(field.auto === 'off' && field.name !== 'wm-q' && /^q[a-z0-9]+$/.test(field.name || ''),
    `имя поля поиска непредсказуемо, автозаполнение выключено (${field.name})`);

  // ── 2. Почта в поиске: понятная подсказка, а не «ничего не нашлось» ──
  const mail = await page.evaluate(async () => {
    const P = window.WM_PUBLISH, s = P._state();
    s.query = 'Dexauron@gmail.com';
    P.renderAll();
    await new Promise((r) => setTimeout(r, 200));
    return {
      title: document.querySelector('#emptyState .empty-title').textContent,
      more: document.querySelectorAll('.load-more').length,
      cards: document.querySelectorAll('.card').length,
    };
  });
  chk(/почт/i.test(mail.title), `на почту в поиске каталог отвечает по-человечески («${mail.title}»)`);
  chk(mail.more === 0 && mail.cards === 0,
    `при пустом результате нет ни карточек, ни кнопки «Показать ещё» (кнопок ${mail.more}, карточек ${mail.cards})`);

  // ── 3. Обычный пустой результат — прежнее сообщение ──
  const none = await page.evaluate(async () => {
    const P = window.WM_PUBLISH, s = P._state();
    s.query = 'ъъъщщщ';
    P.renderAll();
    await new Promise((r) => setTimeout(r, 200));
    return { title: document.querySelector('#emptyState .empty-title').textContent, more: document.querySelectorAll('.load-more').length };
  });
  chk(/Ничего не нашлось/.test(none.title) && none.more === 0, `обычный пустой поиск не изменился («${none.title}»)`);

  // ── 4. Уборка памяти: история цен и старые отчёты режутся ──
  await page.evaluate(() => { window.WM_PUBLISH._state().query = ''; });
  await asOwner(page, { prices, sales, suppliers: [{ id: 's1', name: 'Поставщик' }] });
  const tidy = await page.evaluate(() => {
    const P = window.WM_PUBLISH, s = P._state();
    const was = { prices: s.prices.length, sales: s.sales.length };
    const r = P._tidyMemory();
    const periods = new Set(s.sales.map((x) => x.period_from + '|' + x.period_to)).size;
    const perPair = {};
    s.prices.forEach((x) => { const k = x.product_id + '|' + x.supplier_id; perPair[k] = (perPair[k] || 0) + 1; });
    return { was, now: { prices: s.prices.length, sales: s.sales.length }, periods, maxPerPair: Math.max(...Object.values(perPair)), r };
  });
  console.log(`--- цены: ${tidy.was.prices} → ${tidy.now.prices}, продажи: ${tidy.was.sales} → ${tidy.now.sales}, периодов ${tidy.periods} ---`);
  chk(tidy.now.prices < tidy.was.prices && tidy.maxPerPair <= 8,
    `история цен ужимается (не больше 8 записей на поставщика, сейчас ${tidy.maxPerPair})`);
  chk(tidy.periods <= 12, `старые отчёты продаж не копятся (периодов ${tidy.periods})`);
  chk(tidy.now.prices > 0, 'свежие цены при уборке не теряются');

  // ── 5. Каждый товар сохранил хотя бы одну цену ──
  const kept = await page.evaluate(() => {
    const s = window.WM_PUBLISH._state();
    const have = new Set(s.prices.map((x) => x.product_id));
    return s.products.filter((p) => !have.has(p.id)).length;
  });
  chk(kept === 0, `ни один товар не остался без цены после уборки (без цены: ${kept})`);

  chk(!errs.length, `нет сбоев JS (${errs.length}${errs.length ? ': ' + errs[0] : ''})`);
  await done(b);
})();

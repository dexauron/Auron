// Сторож наценки: где магазин продаёт дешевле, чем купил.
/* Разбор выгрузок владельца показал 98 таких товаров, 54 почти в ноль и 14
 * без розничной цены — глазами это не находится, товаров больше десяти тысяч.
 * Здесь проверяем, что экран их находит, считает наценку САМ (колонке 1С
 * доверять нельзя) и не показывается тому, кому закупки видеть не положено. */
const { chromium, newPage, asOwner, runner } = require('./helpers');

const today = new Date().toISOString().slice(0, 10);
const products = [
  // продаём дешевле закупки: закупка 650, цена 145
  { id: 'p1', name: 'Инжир', code: '1', retail_price: 145, photos: [], barcodes: [], supplier_ids: ['s1'], stock: 4 },
  // почти в ноль: 100 → 103 (+3%)
  { id: 'p2', name: 'Компот Вишня 1л', code: '2', retail_price: 103, photos: [], barcodes: [], supplier_ids: ['s1'], stock: 2 },
  // нормальный товар — в список попасть не должен
  { id: 'p3', name: 'Молоко 1л', code: '3', retail_price: 89, photos: [], barcodes: [], supplier_ids: ['s1'], stock: 7 },
  // без розничной цены, но лежит на полке
  { id: 'p4', name: 'Хлеб Столовый', code: '4', retail_price: null, photos: [], barcodes: [], supplier_ids: ['s1'], stock: 3 },
  // убыточный, но на складе его НЕТ — цену править незачем
  { id: 'p5', name: 'Мороженое Сезонное', code: '5', retail_price: 30, photos: [], barcodes: [], supplier_ids: ['s1'], stock: 0 },
];
const prices = [
  { product_id: 'p1', supplier_id: 's1', price: 650, price_date: today, unit: 'шт' },
  { product_id: 'p2', supplier_id: 's1', price: 100, price_date: today, unit: 'шт' },
  { product_id: 'p3', supplier_id: 's1', price: 60, price_date: today, unit: 'шт' },
  { product_id: 'p4', supplier_id: 's1', price: 40, price_date: today, unit: 'шт' },
  { product_id: 'p5', supplier_id: 's1', price: 90, price_date: today, unit: 'шт' },
];

(async () => {
  const b = await chromium.launch();
  const { chk, done } = runner('НАЦЕНКА');
  const { page, errs } = await newPage(b, { products, groups: [{ id: 'g1', name: 'Разное' }] });

  // ── 1. Без входа сторожа нет вовсе ──
  const guest = await page.evaluate(() => window.WM_PUBLISH._marginCount());
  chk(guest === 0, `покупатель ничего про наценку не считает (${guest})`);

  await asOwner(page, { prices, suppliers: [{ id: 's1', name: 'Поставщик' }] });

  const found = await page.evaluate(() => {
    const x = window.WM_PUBLISH._marginIssues();
    return {
      loss: x.loss.map((r) => r.p.name),
      thin: x.thin.map((r) => r.p.name),
      noPrice: x.noPrice.map((r) => r.p.name),
      pct: Math.round(x.loss[0] ? x.loss[0].pct : 0),
    };
  });
  chk(found.loss.length === 1 && found.loss[0] === 'Инжир',
    `убыточный товар найден (${found.loss.join(', ') || 'никого'})`);
  chk(found.pct === -78, `наценка посчитана сама: 650 → 145 это ${found.pct}%`);
  chk(found.thin.length === 1 && found.thin[0] === 'Компот Вишня 1л',
    `«почти в ноль» найден (${found.thin.join(', ') || 'никого'})`);
  chk(found.noPrice.length === 1 && found.noPrice[0] === 'Хлеб Столовый',
    `товар без цены найден (${found.noPrice.join(', ') || 'никого'})`);
  chk(!found.loss.includes('Мороженое Сезонное'),
    'товар, которого нет на складе, не тревожит — ему цену править незачем');
  chk(!found.loss.includes('Молоко 1л') && !found.thin.includes('Молоко 1л'),
    'нормальный товар в список не попал');

  // ── 2. Экран открывается и читается словами ──
  const sheet = await page.evaluate(async () => {
    window.WM_PUBLISH._openMargin();
    await new Promise((r) => setTimeout(r, 300));
    const el = document.getElementById('marginSheet');
    return { open: !el.hidden, text: document.getElementById('marginBody').innerText.replace(/\s+/g, ' ') };
  });
  chk(sheet.open, 'экран наценки открывается');
  // заголовки групп рисуются прописными — сравниваем без учёта регистра
  chk(/продаём дешевле закупки/i.test(sheet.text) && /Инжир/.test(sheet.text),
    `на экране видно, что именно убыточно (${sheet.text.slice(0, 60)})`);
  chk(/закупка 650 ₽ → цена 145 ₽/.test(sheet.text), 'обе цены показаны рядом — понятно без объяснений');

  /* ── 3. «Залежалось» ──
     Товар на полке, приехал давно и ни разу не продался — это замороженные
     деньги. Дата поступления приходит из отчёта «Неликвидные товары». */
  const stale = await page.evaluate(async () => {
    const P = window.WM_PUBLISH, s = P._state();
    const old = new Date(Date.now() - 200 * 86400000).toISOString().slice(0, 10);
    const fresh = new Date(Date.now() - 10 * 86400000).toISOString().slice(0, 10);
    s.products = [
      { id: 'a', name: 'Кукла в джинсах', retail_price: 500, stock: 3, arrival_at: old, sold_qty: 0, photos: [], barcodes: [], supplier_ids: ['s1'] },
      { id: 'b', name: 'Молоко', retail_price: 89, stock: 12, arrival_at: fresh, sold_qty: 40, photos: [], barcodes: [], supplier_ids: ['s1'] },
      { id: 'c', name: 'Ёлочные игрушки', retail_price: 300, stock: 0, arrival_at: old, sold_qty: 0, photos: [], barcodes: [], supplier_ids: ['s1'] },
      { id: 'd', name: 'Пряники давние', retail_price: 120, stock: 5, arrival_at: old, sold_qty: 7, photos: [], barcodes: [], supplier_ids: ['s1'] },
    ];
    const names = P._staleItems().map((x) => x.p.name);
    P._openStale();
    await new Promise((r) => setTimeout(r, 300));
    return { names, text: document.getElementById('staleBody').innerText.replace(/\s+/g, ' ') };
  });
  chk(stale.names.length === 1 && stale.names[0] === 'Кукла в джинсах',
    `залежавшийся товар найден (${stale.names.join(', ') || 'никого'})`);
  chk(!stale.names.includes('Молоко'), 'свежий и продающийся товар не считаем залежавшимся');
  chk(!stale.names.includes('Ёлочные игрушки'), 'то, чего нет на полке, не залежалось — его просто нет');
  chk(!stale.names.includes('Пряники давние'), 'давний, но продающийся товар не трогаем');
  // «201 день», «202 дня», «205 дней» — падеж меняется, проверка не должна цепляться за одну форму
  chk(/лежит \d+ (день|дня|дней)/.test(stale.text), `на экране написано, сколько дней лежит (${stale.text.slice(0, 60)})`);

  chk(!errs.length, `нет сбоев JS (${errs.length}${errs.length ? ': ' + errs[0] : ''})`);
  await done(b);
})();

// «Подорожало»: на сколько выросла цена и когда — сотруднику и владельцу.
/* Зеркало покупательского «Стало дешевле», только для своих и по двум ценам:
 * закупочной (наши деньги) и розничной (что на ценнике).
 *
 * Главное, что здесь проверяется, — причина, по которой этой возможности не
 * было вовсе: каждая вечерняя выгрузка из 1С ЗАТИРАЛА вчерашнюю цену, и
 * сравнивать было не с чем. Если однажды кто-то вернёт затирание, первым
 * упадёт пункт «вчерашняя цена не потерялась». */
const { chromium, newPage, asOwner, openProduct, runner } = require('./helpers');

const products = [
  { id: 'p1', name: 'Молоко 3,2%', code: '101', group_id: 'g1', retail_price: 100, unit: 'шт', photos: [], barcodes: [], supplier_ids: ['s1'] },
  { id: 'p2', name: 'Кефир 1%', code: '102', group_id: 'g1', retail_price: 75, unit: 'шт', photos: [], barcodes: [], supplier_ids: ['s1'] },
  { id: 'p3', name: 'Батон нарезной', code: '201', group_id: 'g1', retail_price: 45, unit: 'шт', photos: [], barcodes: [], supplier_ids: ['s2'] },
];
const groups = [{ id: 'g1', name: 'Разное' }];
const suppliers = [{ id: 's1', name: 'Молзавод' }, { id: 's2', name: 'Хлебозавод' }];

const iso = (days) => new Date(Date.now() - days * 86400000).toISOString().slice(0, 10);
const ru = (days) => { const [y, m, d] = iso(days).split('-'); return `${d}.${m}.${y}`; };

// прайс из 1С: одна выгрузка = один файл
const priceFile = (rows) => [
  ['Отчёт по ценам поставщиков'], [],
  ['Номенклатура', 'Код товара', 'Контрагент', 'Ед.', 'Цена', 'Период'],
  ...rows,
];

const openWork = (page) => page.evaluate(async () => {
  document.querySelectorAll('.sheet-backdrop:not([hidden])').forEach((s) => { s.hidden = true; });
  document.querySelector('.tabbar [data-tab="work"]').click();
  await new Promise((r) => setTimeout(r, 400));
});

(async () => {
  const b = await chromium.launch();
  const { chk, done } = runner('ПОДОРОЖАЛО');
  const { page, errs } = await newPage(b, { products, groups });
  await asOwner(page, { suppliers });
  await page.waitForTimeout(300);

  // ── 1. Вчерашняя цена больше не теряется ──
  const kept = await page.evaluate(async (d) => {
    const P = window.WM_PUBLISH; const s = P._state();
    s.prices = []; s.retailHist = {};
    P.svImportRows(d.old);          // выгрузка двухнедельной давности
    const afterFirst = s.prices.filter((x) => x.product_id === 'p1').length;
    P.svImportRows(d.now);          // сегодняшняя: у Молока цена выросла
    const rows = s.prices.filter((x) => x.product_id === 'p1')
      .map((x) => ({ price: x.price, at: x.price_date }));
    P.svImportRows(d.now);          // та же выгрузка второй раз — дубля быть не должно
    return { afterFirst, rows, afterRepeat: s.prices.filter((x) => x.product_id === 'p1').length };
  }, {
    old: priceFile([
      ['Молоко 3,2%', '101', 'Молзавод', 'шт', '62,00', ru(14)],
      ['Кефир 1%', '102', 'Молзавод', 'шт', '50,00', ru(14)],
      ['Батон нарезной', '201', 'Хлебозавод', 'шт', '30,00', ru(14)],
    ]),
    now: priceFile([
      ['Молоко 3,2%', '101', 'Молзавод', 'шт', '71,00', ru(2)],
      ['Кефир 1%', '102', 'Молзавод', 'шт', '50,00', ru(2)],     // цена та же
      ['Батон нарезной', '201', 'Хлебозавод', 'шт', '36,00', ru(2)],
    ]),
  });
  chk(kept.afterFirst === 1, `после первой выгрузки одна запись цены (${kept.afterFirst})`);
  chk(kept.rows.length === 2, `вчерашняя цена не потерялась — рядом с новой лежит старая (${kept.rows.length})`);
  chk(kept.rows.some((x) => x.price === 62) && kept.rows.some((x) => x.price === 71),
    `видно обе цены: было 62, стало 71 (${kept.rows.map((x) => x.price).join(' и ')})`);
  chk(kept.afterRepeat === 2, `повторная загрузка того же файла лишних записей не плодит (${kept.afterRepeat})`);
  const same = await page.evaluate(() => window.WM_PUBLISH._state().prices.filter((x) => x.product_id === 'p2').length);
  chk(same === 1, `у товара с неизменной ценой запись по-прежнему одна (${same})`);

  // ── 2. Экран «Подорожало» ──
  await openWork(page);
  const work = await page.evaluate(async () => {
    const row = document.querySelector('[data-work="risen"]');
    const value = row ? row.innerText.replace(/\s+/g, ' ').trim() : '';
    row.click();
    await new Promise((r) => setTimeout(r, 400));
    return { value, open: !document.getElementById('priceNewsSheet').hidden, body: document.getElementById('priceNewsBody').innerText.replace(/\s+/g, ' ') };
  });
  chk(/Подорожало/.test(work.value), `во вкладке «Работа» есть строка «Подорожало» (${work.value})`);
  chk(/2 товара/.test(work.value), `в строке видно, сколько подорожало (${work.value})`);
  chk(work.open, 'строка открывает свой экран');
  chk(/Молоко/.test(work.body) && /Батон/.test(work.body), 'в списке оба подорожавших товара');
  chk(!/Кефир/.test(work.body), 'товар с неизменной ценой в список не попал');
  chk(/62\D+₽.*71\D+₽/.test(work.body) || /71\D+₽.*62\D+₽/.test(work.body),
    `видно «было → стало» (${(work.body.match(/Молоко[^А-Я]{0,60}/) || [''])[0]})`);
  chk(/закупка/.test(work.body), `сказано, что подорожала закупка (${(work.body.match(/закупка[^·]*·[^0-9]*/) || [''])[0]})`);
  chk(/2 дня назад|\d\d\.\d\d\.\d\d/.test(work.body), `сказано, когда подорожало (${(work.body.match(/(сегодня|вчера|\d+ дн[а-я]+ назад|\d\d\.\d\d\.\d\d)/) || [''])[0]})`);
  // Молоко +14,5%, Батон +20% — сверху то, что подорожало сильнее
  chk(work.body.indexOf('Батон') < work.body.indexOf('Молоко'), 'сверху то, что подорожало сильнее');

  /* ── 3. Наценка тает: закупка выросла, ценник прежний ──
     Батон: 45 ₽ при закупке 30 → 36, значит 50% → 25%.
     Молоко: 100 ₽ при 62 → 71, значит 61% → 41%.
     В СПИСКЕ про это сказано коротко (строка под названием), а подробности —
     «Закупка · Молзавод: 62 ₽ → 71 ₽ (+14,5%) · 2 дня назад» — в карточке
     товара: окна «Подорожало» больше нет, список остался списком. */
  chk(/наценка 50% → 25%/.test(work.body) && /наценка 61% → 41%/.test(work.body),
    `в списке сказано, что наценка упала (${(work.body.match(/наценка [^а-я]*/g) || []).join(' | ')})`);
  await openProduct(page, 'p1');
  const detail = await page.evaluate(() => document.getElementById('sheetRise').innerText.replace(/\s+/g, ' '));
  chk(/Молзавод/.test(detail), `в карточке видно, кто из поставщиков поднял цену (${detail.slice(0, 60)})`);
  chk(/\+14,5%/.test(detail), `и на сколько процентов (${(detail.match(/\+[\d,]+%/g) || []).join(' ')})`);
  chk(/62\D+₽\D+71\D+₽/.test(detail), 'и было → стало');
  await page.evaluate(() => { document.querySelectorAll('.sheet-backdrop:not([hidden])').forEach((x) => { x.hidden = true; }); window.location.hash = ''; });

  // ── 4. Ценник подняли — про наценку молчим, зато видно новую цену ──
  const retail = await page.evaluate(async () => {
    const P = window.WM_PUBLISH; const s = P._state();
    // как будто вчера выгрузка принесла новый ценник: 100 → 120
    s.retailHist = { p1: [{ price: 100, at: new Date(Date.now() - 86400000).toISOString().slice(0, 10) }] };
    s.products.find((x) => x.id === 'p1').retail_price = 120;
    document.querySelectorAll('.sheet-backdrop:not([hidden])').forEach((x) => { x.hidden = true; });
    document.querySelector('.tabbar [data-tab="work"]').click();
    await new Promise((r) => setTimeout(r, 300));
    document.querySelector('[data-work="risen"]').click();
    await new Promise((r) => setTimeout(r, 400));
    return document.getElementById('priceNewsBody').innerText.replace(/\s+/g, ' ');
  });
  chk(/ценник/.test(retail) && /120\D+₽/.test(retail) && /100\D+₽/.test(retail),
    `подорожание ценника видно в списке (${(retail.match(/Молоко[^А-Я]{0,60}/) || [''])[0]})`);
  chk(!/Молоко[^А-Я]*наценка/.test(retail), 'ценник подняли — про упавшую наценку больше не пишем');

  // ── 5. Карточка товара и полоса на главной ──
  await openProduct(page, 'p1');
  const card = await page.evaluate(() => document.getElementById('sheetRise').innerText.replace(/\s+/g, ' '));
  chk(/Закупка/.test(card) && /Ценник/.test(card), `в карточке товара тоже видно подорожание (${card.slice(0, 70)})`);

  /* Полос «Подорожало» и «Стало дешевле» на главном экране больше НЕТ —
     решение владельца: они закрывали собой каталог. Всё переехало на один
     экран «Изменения цен», вход — из «Фильтров». Проверяем, что переехало и
     содержание: раньше на полосе был только процент и старая цена, причём
     ВСЕГДА закупочная, хотя наверх строка попадала по большему из двух
     ростов. Владелец видел «+1099,8%» и зачёркнутые 12,81 ₽ и не понимал ни
     сколько стоит теперь, ни что подорожало. */
  const screen = await page.evaluate(async () => {
    document.querySelectorAll('.sheet-backdrop:not([hidden])').forEach((s) => { s.hidden = true; });
    window.location.hash = '';
    window.WM_PUBLISH.renderAll();
    await new Promise((r) => setTimeout(r, 400));
    window.WM_PUBLISH._state().ui;
    document.querySelector('.tabbar [data-tab="filters"]').click();
    await new Promise((r) => setTimeout(r, 350));
    document.getElementById('openRisen').click();
    await new Promise((r) => setTimeout(r, 450));
    return {
      open: !document.getElementById('priceNewsSheet').hidden,
      total: (document.querySelector('#priceNewsBody .pn-total') || {}).textContent || '',
      rows: [...document.querySelectorAll('#priceNewsBody .pn-row')].map((r) => ({
        what: (r.querySelector('.pn-sub') || {}).textContent || '',
        price: ((r.querySelector('.pn-price') || {}).textContent || '').replace(/\s+/g, ' ').trim(),
        was: (r.querySelector('.pn-was') || {}).textContent || '',
      })),
    };
  });
  chk(screen.open, 'экран «Изменения цен» открывается из «Фильтров»');
  chk(screen.rows.length > 0 && screen.rows.every((r) => /ценник|закупка/.test(r.what)),
    `сказано, ЧТО подорожало — ценник или закупка (${screen.rows.map((r) => r.what.split(' ·')[0]).join(', ')})`);
  chk(screen.rows.every((r) => r.was && r.price.replace(r.was, '').trim()),
    `видна и новая цена, и прежняя (${screen.rows.map((r) => r.price).join(' | ')})`);
  chk(!screen.rows.some((r) => /%/.test(r.price)), 'голого процента без цены в списке нет');

  // число в заголовке — настоящее, а не «сколько поместилось в список»
  const honest = await page.evaluate(async () => {
    const P = window.WM_PUBLISH; const s = P._state();
    const hist = {};
    for (const p of s.products) hist[p.id] = [{ price: Number(p.retail_price) / 2, at: new Date(Date.now() - 2 * 86400000).toISOString().slice(0, 10) }];
    s.retailHist = hist;
    P.renderAll();
    await new Promise((r) => setTimeout(r, 1200));
    document.querySelectorAll('.sheet-backdrop:not([hidden])').forEach((x) => { x.hidden = true; });
    document.querySelector('.tabbar [data-tab="filters"]').click();
    await new Promise((r) => setTimeout(r, 350));
    document.getElementById('openRisen').click();
    await new Promise((r) => setTimeout(r, 450));
    return { head: (document.querySelector('#priceNewsBody .pn-total') || {}).textContent || '', n: s.products.length };
  });
  chk(new RegExp('^' + honest.n + ' ').test(honest.head.trim()),
    `в заголовке настоящее число подорожавших (${honest.head.trim()}, товаров ${honest.n})`);

  /* Закупка переросла ценник — продаём в минус. Раньше этот случай молча
     пропадал: наценку в минусе посчитать нельзя, и строка не выводилась
     вовсе — самый тяжёлый случай был единственным, о котором мы молчали
     (находка аудита 2026-10-03). */
  const loss = await page.evaluate(async (d) => {
    const P = window.WM_PUBLISH; const s = P._state();
    s.prices = []; s.retailHist = {};
    P.svImportRows(d.a); P.svImportRows(d.b);
    s.products.find((x) => x.id === 'p3').retail_price = 45;   // ценник прежний
    document.querySelectorAll('.sheet-backdrop:not([hidden])').forEach((x) => { x.hidden = true; });
    document.querySelector('.tabbar [data-tab="work"]').click();
    await new Promise((r) => setTimeout(r, 300));
    document.querySelector('[data-work="risen"]').click();
    await new Promise((r) => setTimeout(r, 400));
    return document.getElementById('priceNewsBody').innerText.replace(/\s+/g, ' ');
  }, {
    a: priceFile([['Батон нарезной', '201', 'Хлебозавод', 'шт', '30', ru(10)]]),
    b: priceFile([['Батон нарезной', '201', 'Хлебозавод', 'шт', '60', ru(1)]]),
  });
  chk(/продаём в минус/.test(loss), `сказано прямо, что товар продаётся в минус (${(loss.match(/.{0,20}продаём в минус.{0,20}/) || ['НЕ СКАЗАНО'])[0]})`);
  chk(/15\D*₽/.test(loss), `и на сколько именно — 60 закупка против 45 ценника (${(loss.match(/минус[^·]*/) || [''])[0]})`);

  // ── 6. Покупателю этого не видно ──
  const guest = await page.evaluate(async () => {
    const P = window.WM_PUBLISH; const s = P._state();
    s.session = null; s.isAdmin = false; s.canPurchase = false; s.canSales = false;
    P.renderAll();
    await new Promise((r) => setTimeout(r, 400));
    const entry = (document.getElementById('openRisen') || {}).hidden;
    // вкладка «Работа» покупателю и так спрятана (.emp-only), но откроем её
    // насильно: содержимое тоже не должно ничего ему рассказывать
    document.querySelectorAll('.sheet-backdrop:not([hidden])').forEach((x) => { x.hidden = true; });
    document.querySelector('.tabbar [data-tab="work"]').click();
    await new Promise((r) => setTimeout(r, 400));
    return { strip: entry, work: document.getElementById('workBody').innerText.replace(/\s+/g, ' ') };
  });
  chk(guest.strip, 'покупателю полоса «Подорожало» не показывается');
  chk(!/Подорожало/.test(guest.work), `и во вкладке «Работа» её для него нет (${guest.work.slice(0, 50)})`);

  // ── 7. Сотруднику — только ценник, закупка остаётся закрытой ──
  const staff = await page.evaluate(async () => {
    const P = window.WM_PUBLISH; const s = P._state();
    /* Возвращаем историю ценника: проверка «в минус» выше её обнуляла, а без
       истории строки «Подорожало» у роли без доступа к закупкам нет вовсе —
       мы специально не выдумываем «за месяц не менялось», когда не знаем. */
    s.retailHist = { p1: [{ price: 100, at: new Date(Date.now() - 86400000).toISOString().slice(0, 10) }] };
    s.products.find((x) => x.id === 'p1').retail_price = 120;
    s.session = { role: 'staff' }; s.isAdmin = false; s.canPurchase = false; s.canSales = false;
    P.renderAll();
    await new Promise((r) => setTimeout(r, 300));
    document.querySelectorAll('.sheet-backdrop:not([hidden])').forEach((x) => { x.hidden = true; });
    document.querySelector('.tabbar [data-tab="work"]').click();
    await new Promise((r) => setTimeout(r, 300));
    document.querySelector('[data-work="risen"]').click();
    await new Promise((r) => setTimeout(r, 400));
    return document.getElementById('priceNewsBody').innerText.replace(/\s+/g, ' ');
  });
  chk(/ценник/i.test(staff), `сотрудник видит подорожание ценника (${staff.slice(0, 60)})`);
  chk(!/Закупка/.test(staff) && !/Молзавод/.test(staff) && !/наценка/.test(staff),
    'закупочные цены, поставщики и наценка сотруднику по-прежнему не видны');

  chk(!errs.length, `нет сбоев JS (${errs.length}${errs.length ? ': ' + errs[0] : ''})`);
  await done(b);
})();

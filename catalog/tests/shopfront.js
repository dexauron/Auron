// Витрина покупателя: приёмы, подсмотренные у лучших каталогов мира.
/* Zepto (Индия) — фасовка отдельной серой строкой и зачёркнутая старая цена
 * рядом с новой. JD (Китай) — полоса «сегодня дешевле» на главной как причина
 * зайти. И то, чего нет ни у кого: «цена на ценнике другая» — главная жалоба
 * во всех отзывах на сети. Здесь проверяем, что всё это работает и что ничего
 * из этого не показывается сотруднику: у него другая работа. */
const { chromium, newPage, asOwner, runner } = require('./helpers');

const today = new Date().toISOString().slice(0, 10);
const products = [
  { id: 'p1', name: 'Молоко Простоквашино 3,2%, 930 мл', code: '101', retail_price: 89, unit: 'шт',
    group_id: 'g1', photos: [], barcodes: ['4600000000011'], stock_state: 'in', arrival_at: today },
  { id: 'p2', name: 'Вкусно Сок Апельсин 0,2л', code: '102', retail_price: 20, unit: 'шт',
    group_id: 'g1', photos: [], barcodes: [], stock_state: 'in' },
  { id: 'p3', name: 'Сыр Российский', code: '103', retail_price: 790, is_weighted: true,
    group_id: 'g1', photos: [], barcodes: [], stock_state: 'in' },
];

(async () => {
  const b = await chromium.launch();
  const { chk, done } = runner('ВИТРИНА ПОКУПАТЕЛЯ');
  const { page, errs } = await newPage(b, { products, groups: [{ id: 'g1', name: 'Разное' }] });

  const paint = (was) => page.evaluate(async (w) => {
    const P = window.WM_PUBLISH, s = P._state();
    s.priceWas = w;
    P.renderAll();
    await new Promise((r) => setTimeout(r, 250));
    return {
      grid: document.getElementById('productGrid').innerText.replace(/\s+/g, ' '),
      html: document.getElementById('productGrid').innerHTML,
      cheap: document.getElementById('cheaperStrip').hidden
        ? '' : document.getElementById('cheaperStrip').innerText.replace(/\s+/g, ' '),
    };
  }, was);

  // ── 1. Фасовка отдельной строкой, как у Zepto ──
  const v = await paint({ p1: 101, p2: 25 });
  chk(/Молоко Простоквашино 3,2% 930 мл/.test(v.grid),
    `фасовка вынесена из названия отдельной строкой (${(v.grid.match(/Молоко.{0,26}/) || [''])[0]})`);
  chk(/row-pack/.test(v.html), 'фасовка — своей строкой, а не куском названия');
  chk(!/3,2%, 930 мл/.test(v.grid), 'в названии фасовка больше не повторяется');
  chk(/Сыр Российский 790 ₽\/кг/.test(v.grid), 'у товара без фасовки лишней строки нет');

  // ── 2. Прежняя цена зачёркнутой и выгода рядом ──
  // пробелов между ними нет: это соседние вставки в одной строке
  chk(/89 ₽\s*101 ₽\s*−12 ₽/.test(v.grid),
    `видно, что подешевело и на сколько (${(v.grid.match(/89 ₽.{0,16}/) || [''])[0]})`);
  chk(/card-was/.test(v.html) && /card-drop/.test(v.html), 'старая цена зачёркнута, выгода — плашкой');

  // ── 3. Полоса «Сегодня дешевле» ──
  chk(/Сегодня дешевле/.test(v.cheap), `полоса на главной есть (${v.cheap.slice(0, 50)})`);
  chk(/2 товара/.test(v.cheap), 'сказано, сколько товаров подешевело');
  chk(/Молоко/.test(v.cheap) && /Сок/.test(v.cheap), 'в полосе именно подешевевшие товары');

  // ── 4. Не с чем сравнивать — ничего не выдумываем ──
  const empty = await paint({});
  chk(!empty.cheap, 'у первого посетителя полосы нет — сравнивать не с чем');
  chk(!/card-was/.test(empty.html), 'и зачёркнутых цен тоже нет');

  // ── 5. «Цена на ценнике другая» ──
  const shelf = await page.evaluate(async () => {
    const P = window.WM_PUBLISH;
    P._scanPrice('4600000000011');
    await new Promise((r) => setTimeout(r, 250));
    const btn = document.querySelector('[data-shelf-scanned]');
    if (!btn) return { btn: false };
    btn.click();
    await new Promise((r) => setTimeout(r, 250));
    let opened = '';
    const real = window.open;
    window.open = (u) => { opened = u; return null; };
    document.getElementById('shelfPrice').value = '95';
    document.getElementById('shelfSend').click();
    await new Promise((r) => setTimeout(r, 200));
    window.open = real;
    return { btn: true, ours: document.getElementById('shelfOurs').textContent, opened: decodeURIComponent(opened) };
  });
  chk(shelf.btn, 'на ценнике есть кнопка «цена на ценнике другая»');
  chk(/89 ₽/.test(shelf.ours), `человеку показана наша цена для сверки (${shelf.ours})`);
  chk(/wa\.me\//.test(shelf.opened), 'сообщение уходит владельцу сразу — ценник правят сегодня');
  chk(/На ценнике: 95 ₽/.test(shelf.opened) && /В каталоге: 89 ₽/.test(shelf.opened),
    'в сообщении обе цены и код — владельцу не надо ничего искать');
  chk(/код 101/.test(shelf.opened), 'код товара в сообщении есть');

  // ── 6. Сотруднику ничего из этого не показывается ──
  await asOwner(page);
  const staff = await page.evaluate(async () => {
    const P = window.WM_PUBLISH, s = P._state();
    s.priceWas = { p1: 101 };
    P.renderAll();
    await new Promise((r) => setTimeout(r, 250));
    P._scanPrice('4600000000011');
    await new Promise((r) => setTimeout(r, 200));
    return {
      html: document.getElementById('productGrid').innerHTML,
      cheap: document.getElementById('cheaperStrip').hidden,
      shelfBtn: !!document.querySelector('[data-shelf-scanned]'),
    };
  });
  chk(!/card-was/.test(staff.html), 'сотруднику зачёркнутых цен не показываем — ему важна касса');
  chk(staff.cheap, 'полосы «сегодня дешевле» у сотрудника нет');
  chk(!staff.shelfBtn, 'кнопки про ценник у сотрудника нет — он сам его и печатает');

  chk(!errs.length, `нет сбоев JS (${errs.length}${errs.length ? ': ' + errs[0] : ''})`);
  await done(b);
})();

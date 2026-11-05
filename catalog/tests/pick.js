// Подборки «что изменилось»: завоз, подешевело, подорожало — во вкладке «Подбор».
/* Раньше это были три полосы на главном экране, каждая по пять-шесть строк.
 * Владелец: «во вкладке каталога я не хочу, чтобы это там было, хочу в подборе,
 * где уже выдаётся список с поиском». Теперь это строки рядом с категориями, а
 * список открывает сам каталог — поиск, сортировка и вид там уже есть.
 *
 * Отдельно проверяется поломка, из-за которой «Подорожало» не показывалось
 * вовсе: расчёт сверял «те же ли данные?» с заново созданным пустым списком
 * цен, не совпадал никогда и считал себя устаревшим всегда. */
const { chromium, newPage, asOwner, runner } = require('./helpers');

const iso = (d) => new Date(Date.now() - d * 86400000).toISOString().slice(0, 10);
const products = [
  { id: 'p1', name: 'Молоко 3,2%', code: '101', group_id: 'g1', retail_price: 89, unit: 'шт', photos: [], barcodes: [], stock: 5, arrival_at: iso(0) },
  { id: 'p2', name: 'Кефир 1%', code: '102', group_id: 'g1', retail_price: 75, unit: 'шт', photos: [], barcodes: [], stock: 5, arrival_at: iso(0) },
  { id: 'p3', name: 'Батон нарезной', code: '201', group_id: 'g2', retail_price: 45, unit: 'шт', photos: [], barcodes: [], stock: 5, arrival_at: iso(0) },
  { id: 'p4', name: 'Сыр Российский', code: '301', group_id: 'g1', retail_price: 790, unit: 'кг', photos: [], barcodes: [], stock: 5, arrival_at: iso(40) },
];
const groups = [{ id: 'g1', name: 'Молочные' }, { id: 'g2', name: 'Хлеб' }];

const openPick = (page) => page.evaluate(async () => {
  document.querySelectorAll('.sheet-backdrop:not([hidden])').forEach((s) => { s.hidden = true; });
  document.querySelector('.tabbar [data-tab="pick"]').click();
  await new Promise((r) => setTimeout(r, 450));
  return [...document.querySelectorAll('#pickLists [data-pick]')]
    .map((x) => `${x.dataset.pick}: ${x.innerText.replace(/\s+/g, ' ').trim()}`);
});

const tap = (page, kind) => page.evaluate(async (k) => {
  const row = document.querySelector(`#pickLists [data-pick="${k}"]`);
  if (row) row.click();
  await new Promise((r) => setTimeout(r, 500));
  return {
    tab: [...document.querySelectorAll('.tabbar .tab')].find((t) => t.classList.contains('active')).dataset.tab,
    names: [...document.querySelectorAll('#productGrid .card')].map((c) => c.innerText.split('\n')[0]),
    chip: document.getElementById('activeFilters').innerText.replace(/\s+/g, ' ').trim(),
  };
}, kind);

(async () => {
  const b = await chromium.launch();
  const { chk, done } = runner('ПОДБОРКИ «ЧТО ИЗМЕНИЛОСЬ»');
  const { page, errs } = await newPage(b, { products, groups });

  // ── 1. Полос на главном экране больше нет ──
  const gone = await page.evaluate(() => ['cheaperStrip', 'riseStrip', 'arrivalStrip']
    .filter((i) => document.getElementById(i)));
  chk(!gone.length, `полос на главном экране нет (${gone.join(', ') || 'ни одной'})`);

  // ── 2. Покупатель: завоз и «подешевело» ──
  await page.evaluate(async () => {
    window.WM_PUBLISH._state().priceWas = { p1: 101, p3: 50 };
    window.WM_PUBLISH.renderAll();
    await new Promise((r) => setTimeout(r, 300));
  });
  const guest = await openPick(page);
  chk(guest.some((r) => /^arrived: Сегодня привезли 3 товара/.test(r)),
    `есть подборка завоза со счётчиком (${guest.join(' | ')})`);
  chk(guest.some((r) => /^cheaper: Сегодня дешевле 2 товара/.test(r)),
    `есть подборка «подешевело» (${guest.join(' | ')})`);
  chk(!guest.some((r) => /^risen:/.test(r)), 'подорожания покупателю не показываем — это рабочая цифра');

  // ── 3. Тап открывает список в каталоге, а не свой экран ──
  const tapped = await tap(page, 'cheaper');
  chk(tapped.tab === 'catalog', `тап уводит на каталог (${tapped.tab})`);
  chk(tapped.names.length === 2 && tapped.names.join(' ').includes('Молоко') && tapped.names.join(' ').includes('Батон'),
    `показаны именно подешевевшие (${tapped.names.join(', ')})`);
  chk(/Сегодня дешевле/.test(tapped.chip), `подборка видна плашкой и снимается ✕ (${tapped.chip})`);

  // ── 4. Внутри подборки работает обычный поиск — за ним и шли ──
  const found = await page.evaluate(async () => {
    const inp = document.getElementById('searchInput');
    inp.value = 'батон';
    inp.dispatchEvent(new Event('input', { bubbles: true }));
    await new Promise((r) => setTimeout(r, 600));
    return [...document.querySelectorAll('#productGrid .card')].map((c) => c.innerText.split('\n')[0]);
  });
  chk(found.length === 1 && /Батон/.test(found[0]), `поиск внутри подборки сужает список (${found.join(', ')})`);

  // ── 5. Повторный тап снимает подборку ──
  const off = await page.evaluate(async () => {
    const inp = document.getElementById('searchInput');
    inp.value = ''; inp.dispatchEvent(new Event('input', { bubbles: true }));
    await new Promise((r) => setTimeout(r, 400));
    document.querySelector('.tabbar [data-tab="pick"]').click();
    await new Promise((r) => setTimeout(r, 400));
    document.querySelector('[data-pick="cheaper"]').click();
    await new Promise((r) => setTimeout(r, 450));
    return {
      pick: window.WM_PUBLISH._state().pick,
      cards: document.querySelectorAll('#productGrid .card').length,
    };
  });
  chk(off.pick === '' && off.cards === products.length,
    `повторный тап снимает подборку — снова весь каталог (${off.cards})`);

  // ── 6. «Сбросить» в подборе снимает и подборку ──
  const reset = await page.evaluate(async () => {
    document.querySelector('.tabbar [data-tab="pick"]').click();
    await new Promise((r) => setTimeout(r, 400));
    document.querySelector('[data-pick="cheaper"]').click();
    await new Promise((r) => setTimeout(r, 400));
    document.querySelector('.tabbar [data-tab="pick"]').click();
    await new Promise((r) => setTimeout(r, 400));
    document.getElementById('filterReset').click();
    await new Promise((r) => setTimeout(r, 400));
    return window.WM_PUBLISH._state().pick;
  });
  chk(reset === '', `кнопка «Сбросить» снимает подборку (${reset || 'снята'})`);

  // ── 7. Владелец: «Подорожало» считается, даже когда цен поставщиков ещё нет ──
  /* Именно здесь ломалось: список цен не был заведён, и сверка «те же ли
     данные?» каждый раз получала новый пустой список — расчёт считал себя
     устаревшим всегда, и подборка не появлялась никогда. */
  await asOwner(page, {});
  const owner = await page.evaluate(async () => {
    const P = window.WM_PUBLISH; const s = P._state();
    delete s.prices;                       // цен поставщиков ещё не загрузили
    s.retailHist = { p1: [{ price: 60, at: new Date(Date.now() - 86400000).toISOString().slice(0, 10) }] };
    P.buildIndex(); P.renderAll();
    await new Promise((r) => setTimeout(r, 2600));   // отложенный расчёт успевает
    document.querySelector('.tabbar [data-tab="pick"]').click();
    await new Promise((r) => setTimeout(r, 450));
    const row = document.querySelector('#pickLists [data-pick="risen"]');
    return row ? row.innerText.replace(/\s+/g, ' ').trim() : '';
  });
  chk(/Подорожало 1 товар/.test(owner), `подборка «Подорожало» появляется у владельца (${owner || 'нет строки'})`);

  const ownerTap = await tap(page, 'risen');
  chk(ownerTap.names.length === 1 && /Молоко/.test(ownerTap.names[0]),
    `и открывает подорожавший товар списком (${ownerTap.names.join(', ')})`);

  // ── 8. Завоза у вошедшего в подборках нет: он видит поставки в заказах ──
  const ownerRows = await openPick(page);
  chk(!ownerRows.some((r) => /^arrived:/.test(r)),
    `вошедшему завоз в подборках не дублируется (${ownerRows.join(' | ')})`);

  chk(!errs.length, `нет сбоев JS (${errs.length}${errs.length ? ': ' + errs[0] : ''})`);
  await done(b);
})();

// Скорость на слабом телефоне. Проверка держит планку: если правка снова
// заставит каталог считать всё подряд при загрузке, набор упадёт.
// Замеры идут на процессоре в 6 раз медленнее обычного — это бюджетный Android.
const { chromium, runner } = require('./helpers');

const WORDS = ['Молоко', 'Кефир', 'Сметана', 'Творог', 'Батон', 'Хлеб', 'Колбаса', 'Сыр', 'Печенье', 'Конфеты',
  'Сок', 'Вода', 'Чай', 'Кофе', 'Масло', 'Йогурт', 'Ряженка', 'Сосиски', 'Пельмени', 'Мороженое'];
const BRANDS = ['Простоквашино', 'Домик в деревне', 'Весёлый молочник', 'Село Зелёное', 'Чудо', 'Яшкино',
  'Славянка', 'Мистраль', 'Макфа', 'Добрый', 'Святой источник', 'Липтон'];
const N = 12000;
const products = Array.from({ length: N }, (_, i) => ({
  id: 'p' + i,
  name: `${WORDS[i % WORDS.length]} ${BRANDS[(i * 7) % BRANDS.length]} ${(i % 900) + 100}г`,
  code: String(100000 + i), barcodes: ['46' + String(10000000000 + i)],
  group_id: 'g' + (i % 20), retail_price: 30 + (i % 500), unit: 'шт', stock: i % 11,
  photos: [], created_at: '2026-08-01',
})).sort((a, b) => a.name.localeCompare(b.name, 'ru'));
const groups = Array.from({ length: 20 }, (_, i) => ({ id: 'g' + i, name: 'Группа ' + i }));
const J = (o) => ({ status: 200, contentType: 'application/json', body: JSON.stringify(o) });

(async () => {
  const b = await chromium.launch();
  const { chk, done } = runner('СКОРОСТЬ НА СЛАБОМ ТЕЛЕФОНЕ');
  const ctx = await b.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, serviceWorkers: 'block' });
  await ctx.addInitScript(() => {
    localStorage.setItem('wm_gh_token', 'tok');
    // телефон «сообщает» о себе как бюджетный — должен включиться экономный режим
    try { Object.defineProperty(navigator, 'deviceMemory', { get: () => 2 }); } catch (e) { /* */ }
    window.__long = [];
    try {
      new PerformanceObserver((l) => { for (const e of l.getEntries()) window.__long.push(Math.round(e.duration)); })
        .observe({ entryTypes: ['longtask'] });
    } catch (e) { /* */ }
  });
  await ctx.route('**/auth/v1/**', (r) => r.fulfill({ status: 200, body: '{}' }));
  await ctx.route('**/rest/v1/**', (r) => r.fulfill(J([])));
  await ctx.route('**/data/products.json*', (r) => r.fulfill(J(products)));
  await ctx.route('**/data/groups.json*', (r) => r.fulfill(J(groups)));
  await ctx.route('**/data/popular.json*', (r) => r.fulfill(J([])));
  await ctx.route('**/data/competitors.json*', (r) => r.fulfill(J({ stores: [], prices: [] })));
  await ctx.route('https://raw.githubusercontent.com/**', (r) => r.fulfill({ status: 404, body: 'x' }));
  await ctx.route('https://api.github.com/**', (r) => r.fulfill(J({})));
  const page = await ctx.newPage();
  const errs = [];
  page.on('pageerror', (e) => errs.push(e.message));
  const client = await ctx.newCDPSession(page);
  await client.send('Emulation.setCPUThrottlingRate', { rate: 6 });

  const t0 = Date.now();
  await page.goto('http://localhost:8123/', { waitUntil: 'commit' });
  await page.waitForFunction(() => document.querySelectorAll('.grid .card').length > 0, { timeout: 120000 });
  const firstCards = Date.now() - t0;
  await page.waitForFunction(() => window.WM_PUBLISH && window.WM_PUBLISH._state().products.length > 1000, { timeout: 120000 });
  const loaded = Date.now() - t0;
  chk(firstCards < 2500, `первые товары на экране быстро (${firstCards} мс, потолок 2500)`);
  chk(loaded < 4500, `весь каталог из ${N} товаров загрузился (${loaded} мс, потолок 4500)`);

  // экономный режим: без «матового стекла», иначе Android пересчитывает его каждый кадр
  const low = await page.evaluate(() => ({
    on: document.documentElement.classList.contains('low-power'),
    header: getComputedStyle(document.querySelector('.header')).backdropFilter,
  }));
  chk(low.on, 'на слабом телефоне включается экономный режим');
  chk(!low.header || low.header === 'none', `размытие под шапкой выключено (${low.header})`);

  // человек секунду смотрит на экран, потом печатает — за это время собирается указатель
  await page.waitForTimeout(1200);
  const search = async (text, expect) => page.evaluate(async (d) => {
    const inp = document.getElementById('searchInput');
    const t = performance.now();
    inp.value = d.text;
    inp.dispatchEvent(new Event('input', { bubbles: true }));
    return new Promise((res) => {
      const check = () => {
        const first = document.querySelector('.grid .card');
        const ok = first && new RegExp(d.expect, 'i').test(first.innerText);
        if (ok || performance.now() - t > 15000) res(Math.round(performance.now() - t));
        else requestAnimationFrame(check);
      };
      check();
    });
  }, { text, expect });

  // Запросы берём из НАСТОЯЩИХ названий этого набора: иначе можно случайно
  // спросить то, чего в нём нет, и мерить не скорость, а пустую выдачу.
  const sample = products[Math.floor(N / 2)];
  const [w1, w2] = sample.name.split(' ');
  const word = await search(`${w1} ${w2.slice(0, 5)}`, w2.slice(0, 5));
  chk(word < 2500, `поиск словом отвечает быстро (${word} мс, потолок 2500)`);
  const other = products[Math.floor(N / 3)];
  const [o1, o2] = other.name.split(' ');
  const word2 = await search(`${o1} ${o2.slice(0, 4)}`, o2.slice(0, 4));
  chk(word2 < 2500, `второй поиск словом (${word2} мс, потолок 2500)`);
  const byCode = products[7];
  const code = await search(byCode.code, byCode.name.split(' ')[0]);
  chk(code < 1500, `поиск по коду отвечает быстро (${code} мс, потолок 1500)`);

  // самая длинная заминка: во время неё телефон не отвечает на нажатия
  const longest = await page.evaluate(() => Math.max(0, ...window.__long));
  chk(longest < 1500, `нет длинных заморозок (самая долгая ${longest} мс, потолок 1500)`);

  // подсказка «поставить на главный экран»: Android предлагает установку сам,
  // мы лишь показываем свою кнопку — и только один раз
  const inst = await page.evaluate(async () => {
    const ev = new Event('beforeinstallprompt');
    ev.prompt = () => {}; ev.userChoice = Promise.resolve({ outcome: 'dismissed' });
    window.dispatchEvent(ev);
    await new Promise((r) => setTimeout(r, 200));
    const banner = document.getElementById('installBanner');
    const shown = !banner.hidden;
    document.getElementById('installHide').click();
    await new Promise((r) => setTimeout(r, 150));
    return { shown, text: document.getElementById('installText').textContent, hiddenNow: banner.hidden,
      remembered: localStorage.getItem('wm_install_hint') };
  });
  chk(inst.shown && /главный экран/.test(inst.text), `подсказка про главный экран появляется (${inst.text.slice(0, 40)})`);
  chk(inst.hiddenNow && inst.remembered === 'off', 'закрыл подсказку — больше не показывается');

  /* ── Вошедший владелец ──────────────────────────────────────────────────
   * Всё, что выше, меряет каталог глазами ПОКУПАТЕЛЯ — а тормозил он у
   * владельца: там появляются 25 000 строк закупочных цен, и расчёты, которые
   * ходили по всему списку на каждый товар, превращались в сотни миллионов
   * сравнений. Меню открывалось 21 секунду, экран наценки — 17, перерисовка
   * главного экрана — 35, вечерняя выгрузка из 1С — 33. Снаружи это выглядело
   * как «каталог завис».
   * Потолки здесь с большим запасом: важно поймать возврат перебора, а не
   * ловить каждую сотню миллисекунд. */
  const SUP = 600;
  const iso = (d) => new Date(Date.now() - d * 86400000).toISOString().slice(0, 10);
  const suppliers = Array.from({ length: SUP }, (_, i) => ({ id: 's' + i, name: 'Поставщик ' + i }));
  const prices = [];
  for (let i = 0; i < N; i++) {
    prices.push({ product_id: 'p' + i, supplier_id: 's' + (i % SUP), price: 20 + (i % 300), price_date: iso(10), unit: 'шт' });
    prices.push({ product_id: 'p' + i, supplier_id: 's' + (i % SUP), price: 22 + (i % 300), price_date: iso(2), unit: 'шт' });
  }
  const own = await page.evaluate(async (d) => {
    const P = window.WM_PUBLISH; const s = P._state();
    P.ghSetToken('tok'); P.applyServerless('pw');
    s.suppliers = d.suppliers; s.prices = d.prices;
    /* Убираем поиск, оставшийся от замеров выше: полоса «Подорожало» при
       активном поиске не показывается, и без этой строчки самый тяжёлый
       расчёт просто не запускался бы — проверка мерила бы пустоту. */
    const inp2 = document.getElementById('searchInput');
    inp2.value = ''; inp2.dispatchEvent(new Event('input', { bubbles: true }));
    await new Promise((r) => setTimeout(r, 300));
    P.buildIndex();
    const out = {};
    const timeIt = (k, fn) => { const t = performance.now(); fn(); out[k] = Math.round(performance.now() - t); };
    timeIt('render', () => P.renderAll());
    timeIt('render2', () => P.renderAll());
    await new Promise((r) => setTimeout(r, 2500));       // свободная минута: указатели догоняют
    const tap = async (k, fn) => {
      document.querySelectorAll('.sheet-backdrop:not([hidden])').forEach((x) => { x.hidden = true; });
      await new Promise((r) => setTimeout(r, 30));
      const t = performance.now();
      fn();
      await new Promise((r) => setTimeout(r, 0));
      out[k] = Math.round(performance.now() - t);
    };
    await tap('menu', () => document.getElementById('adminBtn').click());
    await tap('margin', () => P._openMargin());
    await tap('work', () => document.querySelector('.tabbar [data-tab="work"]').click());
    await tap('risen', () => document.querySelector('[data-work="risen"]').click());
    document.querySelectorAll('.sheet-backdrop:not([hidden])').forEach((x) => { x.hidden = true; });
    window.location.hash = '';
    await new Promise((r) => setTimeout(r, 60));
    const t = performance.now();
    window.location.hash = '#p=p500';
    await new Promise((r) => setTimeout(r, 0));
    out.card = Math.round(performance.now() - t);
    return out;
  }, { suppliers, prices });
  chk(own.render < 2000, `перерисовка главного экрана у владельца (${own.render} мс, потолок 2000)`);
  chk(own.render2 < 800, `повторная перерисовка не считает всё заново (${own.render2} мс, потолок 800)`);
  chk(own.menu < 2500, `меню открывается (${own.menu} мс, потолок 2500)`);
  chk(own.margin < 3000, `сторож наценки открывается (${own.margin} мс, потолок 3000)`);
  chk(own.work < 2000, `вкладка «Работа» открывается (${own.work} мс, потолок 2000)`);
  chk(own.risen < 2500, `экран «Подорожало» открывается (${own.risen} мс, потолок 2500)`);
  chk(own.card < 2500, `карточка товара открывается (${own.card} мс, потолок 2500)`);

  // Вечерняя выгрузка из 1С: владелец делает её каждый день на телефоне
  const ru = (days) => { const x = new Date(Date.now() - days * 86400000);
    return `${String(x.getDate()).padStart(2, '0')}.${String(x.getMonth() + 1).padStart(2, '0')}.${x.getFullYear()}`; };
  const priceFile = (days, bump) => [
    ['Отчёт по ценам поставщиков'], [],
    ['Номенклатура', 'Код товара', 'Контрагент', 'Ед.', 'Цена', 'Период'],
    ...Array.from({ length: N }, (_, i) => [`Товар ${i} марка ${i % 97}`, String(100000 + i),
      'Поставщик ' + (i % SUP), 'шт', String(20 + (i % 300) + bump), ru(days)]),
  ];
  const imp = await page.evaluate(async (d) => {
    const P = window.WM_PUBLISH; const s = P._state();
    s.products = []; s.groups = []; s.suppliers = []; s.prices = []; s.retailHist = {};
    P.buildIndex();
    const out = {};
    let t = performance.now(); P.svImportRows(d.a); out.first = Math.round(performance.now() - t);
    t = performance.now(); P.svImportRows(d.b); out.second = Math.round(performance.now() - t);
    out.rows = s.prices.length;
    return out;
  }, { a: priceFile(10, 0), b: priceFile(1, 5) });
  chk(imp.first < 8000, `выгрузка ${N} строк из 1С (${imp.first} мс, потолок 8000)`);
  chk(imp.second < 8000, `вторая выгрузка, цены выросли (${imp.second} мс, потолок 8000)`);
  chk(imp.rows === N * 2, `вчерашние цены сохранены рядом с новыми (${imp.rows} строк)`);

  chk(!errs.length, `нет сбоев JS (${errs.length}${errs.length ? ': ' + errs[0] : ''})`);
  await done(b);
})();

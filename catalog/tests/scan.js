/* Сканер: один на штрихкод и QR, и он не роняет приложение.
 *
 * Главное, ради чего эта проверка написана: после КАЖДОГО скана на всех
 * телефонах выскакивало «что-то пошло не так». Причина — гашение подсветки
 * при закрытии камеры: applyConstraints возвращает обещание, а его отказ
 * ничем не ловился. Обычный try/catch ловит только мгновенные ошибки.
 * Если кто-то снова забудет про отказ обещания, упадёт первый же пункт. */
const { chromium, runner } = require('./helpers');

const iso = (d) => new Date(Date.now() - d * 86400000).toISOString().slice(0, 10);
const products = [
  { id: 'p1', name: 'Серноводская Горная Вода 1,5л', code: '3209', group_id: 'g1',
    retail_price: 50, unit: 'шт', photos: [], barcodes: ['4607167620117'],
    arrival_at: iso(3), article: 'A-1', department: 'Вода' },
  // штрихкод записан в 12 цифр (UPC-A), а камера прочитает 13 с нулём впереди
  { id: 'p2', name: 'Сок апельсиновый', code: '777', group_id: 'g1',
    retail_price: 120, unit: 'шт', photos: [], barcodes: ['012345678905'] },
];
const groups = [{ id: 'g1', name: 'Вода' }];
const J = (o) => ({ status: 200, contentType: 'application/json', body: JSON.stringify(o) });

// страница с поддельной камерой: распознаватель «видит» заданный код
async function scanPage(b, code) {
  const ctx = await b.newContext({
    viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true,
    serviceWorkers: 'block', permissions: ['camera'],
  });
  await ctx.addInitScript((c) => {
    localStorage.setItem('wm_gh_token', 'tok');
    let t0 = 0;
    window.BarcodeDetector = class {
      constructor() { t0 = Date.now(); }
      static getSupportedFormats() { return Promise.resolve(['ean_13', 'qr_code', 'code_128']); }
      detect() { return Promise.resolve(Date.now() - t0 > 300 ? [{ rawValue: c }] : []); }
    };
  }, code);
  await ctx.route('**/auth/v1/**', (r) => r.fulfill({ status: 200, body: '{}' }));
  await ctx.route('**/rest/v1/**', (r) => r.fulfill(J([])));
  await ctx.route('**/data/index.json*', (r) => r.fulfill(J({ v: 2, app: 4, savedAt: new Date().toISOString(), n: 1, parts: ['t'], groups: 't', popular: 't' })));
  await ctx.route('**/data/p/*.json*', (r) => { const m = /\/p\/(\d+)\.json/.exec(r.request().url()); r.fulfill(J((m ? Number(m[1]) : 0) === 0 ? products : [])); });
  await ctx.route('**/data/groups.json*', (r) => r.fulfill(J(groups)));
  await ctx.route('**/data/popular.json*', (r) => r.fulfill(J([])));
  await ctx.route('**/data/competitors.json*', (r) => r.fulfill(J({ stores: [], prices: [] })));
  await ctx.route('https://raw.githubusercontent.com/**', (r) => r.fulfill({ status: 404, body: 'x' }));
  await ctx.route('https://api.github.com/**', (r) => r.fulfill(J({})));
  const page = await ctx.newPage();
  const errs = [];
  page.on('pageerror', (e) => errs.push(e.message));
  await page.goto('http://localhost:8123/', { timeout: 60000 });
  await page.waitForFunction(() => window.WM_PUBLISH, { timeout: 30000 });
  await page.waitForTimeout(800);
  await page.evaluate(() => {
    const P = window.WM_PUBLISH; P.ghSetToken('tok'); P.applyServerless('pw');
    P.renderAll(); localStorage.removeItem('wm_errors_v1');
  });
  await page.waitForTimeout(400);
  return { ctx, page, errs };
}

(async () => {
  const b = await chromium.launch({ args: ['--use-fake-device-for-media-stream', '--use-fake-ui-for-media-stream'] });
  const { chk, done } = runner('СКАНЕР');

  // ── 1. Скан штрихкода не роняет приложение ──
  {
    const { ctx, page, errs } = await scanPage(b, '4607167620117');
    await page.click('#scanSearchBtn');
    await page.waitForTimeout(2500);
    const st = await page.evaluate(() => ({
      card: !document.getElementById('productSheet').hidden,
      name: (document.getElementById('sheetName') || {}).textContent || '',
      scan: !document.getElementById('scanSheet').hidden,
      logged: JSON.parse(localStorage.getItem('wm_errors_v1') || '[]'),
    }));
    chk(st.logged.length === 0, `после скана нет сбоя (${st.logged.map((x) => x.msg).join('; ') || 'чисто'})`);
    chk(errs.length === 0, `нет ошибок страницы (${errs[0] || 0})`);
    chk(st.card && /Серноводская/.test(st.name), `товар найден и открыт (${st.name})`);
    chk(!st.scan, 'камера закрылась сама — карточка на весь экран');
    await ctx.close();
  }

  // ── 7. Из двух кодов выбираем тот, что ближе к центру камеры ──
  {
    const { ctx, page } = await scanPage(b, '4607167620117');
    await page.evaluate(() => {
      window.BarcodeDetector = class {
        static getSupportedFormats() { return Promise.resolve(['ean_13']); }
        detect(video) { return Promise.resolve([
          { rawValue: '4607167620117', boundingBox: { x: 0, y: 0, width: 10, height: 10 } },
          { rawValue: '012345678905', boundingBox: { x: video.videoWidth / 2 - 5,
            y: video.videoHeight / 2 - 5, width: 10, height: 10 } },
        ]); }
      };
    });
    await page.click('#scanSearchBtn');
    await page.waitForFunction(() => !document.getElementById('productSheet').hidden, { timeout: 5000 });
    const name = await page.locator('#sheetName').textContent();
    chk(/Сок/.test(name), `из нескольких кодов выбран центральный (${name})`);
    await ctx.close();
  }

  // ── 2. QR с ссылкой на наш же товар ──
  {
    const { ctx, page, errs } = await scanPage(b, 'https://dexauron.github.io/Auron/catalog/?p=p2');
    await page.click('#scanSearchBtn');
    await page.waitForTimeout(2500);
    const st = await page.evaluate(() => ({
      card: !document.getElementById('productSheet').hidden,
      name: (document.getElementById('sheetName') || {}).textContent || '',
      logged: JSON.parse(localStorage.getItem('wm_errors_v1') || '[]').length,
    }));
    chk(st.card && /Сок/.test(st.name), `QR со ссылкой на товар открывает его (${st.name})`);
    chk(st.logged === 0 && errs.length === 0, 'QR не роняет приложение');
    await ctx.close();
  }

  // ── 3. Разбор того, что поймала камера ──
  {
    const { ctx, page } = await scanPage(b, '4607167620117');
    const r = await page.evaluate(() => {
      const P = window.WM_PUBLISH;
      const f = (t) => { const h = P._findByBarcode(t); return h ? h.p.name : null; };
      return {
        plain: f('4607167620117'),
        spaces: f(' 4607 167 620117 '),            // пробелы из выгрузки
        upcAsEan: f('0012345678905'),              // камера прочитала UPC-A как EAN-13
        eanAsUpc: f('012345678905'),               // и наоборот
        qrLink: f('https://dexauron.github.io/Auron/catalog/?p=p1'),
        qrDigits: f('https://shop.example.com/item/4607167620117'),
        byCode: f('3209'),                         // код товара с ценника
        junk: f('просто надпись'),
      };
    });
    chk(r.plain === 'Серноводская Горная Вода 1,5л', 'обычный штрихкод находит товар');
    chk(r.spaces === r.plain, 'пробелы в штрихкоде не мешают');
    /* 1С отдаёт UPC-A в 12 цифр, а камера читает его же как EAN-13 с нулём
       впереди. Раньше сравнивали строку в строку — и товар «не находился». */
    chk(r.upcAsEan === 'Сок апельсиновый', `UPC-A с нулём впереди находит товар (${r.upcAsEan})`);
    chk(r.eanAsUpc === 'Сок апельсиновый', `и без нуля тоже (${r.eanAsUpc})`);
    chk(r.qrLink === r.plain, 'QR со ссылкой на наш каталог находит товар');
    chk(r.qrDigits === r.plain, 'QR с чужой ссылкой: берём штрихкод изнутри');
    chk(r.byCode === r.plain, 'код товара с ценника тоже находит товар');
    chk(r.junk === null, 'на бессмыслицу товар не выдумываем');
    await ctx.close();
  }

  /* ── 4. Сканер у сотрудника зала открывает ТОВАР ──
     Его главная задача у полки — узнать товар и его код кассы, ради этого
     каталог и делался. «Закончилось на полке» он отмечает из той же карточки
     (там эта кнопка первая и крупная) или сканером подряд с экрана
     «Закончилось». Отдельного режима в камере нет: лишний выбор заранее. */
  {
    const { ctx, page, errs } = await scanPage(b, '4607167620117');
    await page.evaluate(() => { window.WM_PUBLISH._state().role = 'zal'; });
    await page.click('#scanSearchBtn');
    await page.waitForTimeout(2500);
    const st = await page.evaluate(() => ({
      card: !document.getElementById('productSheet').hidden,
      name: (document.getElementById('sheetName') || {}).textContent || '',
      restockBtn: (document.getElementById('btnRestock') || {}).className || '',
      modes: document.getElementById('scanModeSeg'),
    }));
    chk(st.card && /Серноводская/.test(st.name), `залу скан открывает карточку товара (${st.name})`);
    chk(/btn-primary/.test(st.restockBtn), 'а «закончилось на полке» — первой крупной кнопкой в ней');
    chk(st.modes === null && errs.length === 0, 'переключателя режимов в камере нет — режим задаёт экран');
    await ctx.close();
  }

  // отмечать пустые полки ПОДРЯД — со своего экрана «Закончилось на полке»
  {
    const { ctx, page, errs } = await scanPage(b, '4607167620117');
    await page.evaluate(async () => {
      document.querySelectorAll('.sheet-backdrop:not([hidden])').forEach((x) => { x.hidden = true; });
      document.querySelector('.tabbar [data-tab="work"]').click();
      await new Promise((r) => setTimeout(r, 350));
      document.querySelector('[data-work="restock"]').click();
      await new Promise((r) => setTimeout(r, 400));
      document.getElementById('restockScan').click();
    });
    await page.waitForFunction(() => /в списке пополнения/.test(document.getElementById('scanResult').textContent), { timeout: 8000 });
    const st = await page.evaluate(() => ({
      camera: !document.getElementById('scanSheet').hidden,
      card: !document.getElementById('productSheet').hidden,
      saved: JSON.parse(localStorage.getItem('wm_restock_v1') || '[]').length,
    }));
    chk(st.saved === 1, `товар отмечен как закончившийся (${st.saved})`);
    chk(st.camera && !st.card, 'камера осталась открытой — следующую полку сканируешь сразу');
    chk(errs.length === 0, `нет сбоев (${errs[0] || 0})`);
    await ctx.close();
  }

  // ── 5. Если товара нет, сообщение остаётся в открытом сканере ──
  {
    const { ctx, page } = await scanPage(b, '9999999999999');
    await page.click('#scanSearchBtn');
    await page.waitForFunction(() => /Товар не найден/.test(document.getElementById('scanResult').textContent), { timeout: 5000 });
    const st = await page.evaluate(() => ({
      camera: !document.getElementById('scanSheet').hidden,
      result: document.getElementById('scanResult').textContent,
    }));
    chk(st.camera && /9999999999999/.test(st.result), 'неизвестный код виден рядом с камерой');
    await ctx.close();
  }

  // ── 6. Нет доступа к библиотеке: говорим о распознавании, не о камере ──
  {
    const { ctx, page, errs } = await scanPage(b, '4607167620117');
    await page.evaluate(() => { delete window.BarcodeDetector; });
    await ctx.route('https://cdn.jsdelivr.net/**', (r) => r.abort());
    await page.click('#scanSearchBtn');
    await page.waitForFunction(() => /Распознавание сейчас недоступно/.test(document.getElementById('scanContainer').textContent), { timeout: 5000 });
    const st = await page.evaluate(() => ({
      fallback: !document.getElementById('scanFallback').hidden,
      camera: !document.getElementById('scanSheet').hidden,
    }));
    chk(st.fallback && st.camera && errs.length === 0, 'при сбое CDN виден честный ответ и ручной поиск');
    await ctx.close();
  }

  await done(b);
})();

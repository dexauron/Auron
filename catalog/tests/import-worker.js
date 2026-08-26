// Разбор файла 1С идёт в отдельном потоке: экран во время загрузки живой.
// Проверяем на настоящем файле .xlsx, собранном прямо в браузере.
const { chromium, newPage, runner } = require('./helpers');

(async () => {
  const b = await chromium.launch();
  const { chk, done } = runner('РАЗБОР ФАЙЛА В ОТДЕЛЬНОМ ПОТОКЕ');
  const { page, errs } = await newPage(b, {});
  // следим, какие отдельные потоки создаёт приложение
  await page.evaluate(() => {
    window.__workers = [];
    const Real = window.Worker;
    window.Worker = function (url, opts) { window.__workers.push(String(url)); return new Real(url, opts); };
  });
  await page.evaluate(() => { const P = window.WM_PUBLISH; P.ghSetToken('t'); P.applyServerless('pw'); });
  await page.waitForTimeout(300);

  const res = await page.evaluate(async () => {
    // собираем файл, как выгрузка из 1С: шапка, заголовки, 400 строк цен
    await new Promise((r, j) => {
      const s = document.createElement('script');
      s.src = 'vendor/xlsx.min.js'; s.onload = r; s.onerror = j; document.head.appendChild(s);
    });
    const rows = [['Отчёт по ценам поставщиков'], [], ['Номенклатура', 'Код товара', 'Контрагент', 'Ед.', 'Цена', 'Период']];
    for (let i = 0; i < 400; i++) rows.push([`Товар проверочный ${i}`, String(9000 + i), 'Оптовик', 'шт', `${40 + i},00`, '01.08.2026']);
    const ws = window.XLSX.utils.aoa_to_sheet(rows);
    const wb = window.XLSX.utils.book_new();
    window.XLSX.utils.book_append_sheet(wb, ws, 'Лист1');
    const out = window.XLSX.write(wb, { bookType: 'xlsx', type: 'array' });
    const file = new File([out], 'цены поставщиков.xlsx', { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
    const dt = new DataTransfer(); dt.items.add(file);
    const input = document.getElementById('smartFiles');
    input.files = dt.files;
    input.dispatchEvent(new Event('change', { bubbles: true }));
    await new Promise((r) => setTimeout(r, 2500));
    const runBtn = document.getElementById('smartRun');
    const canRun = !runBtn.hidden;
    if (canRun) { runBtn.click(); await new Promise((r) => setTimeout(r, 2500)); }
    return {
      workers: window.__workers.slice(),
      canRun,
      products: window.WM_PUBLISH._state().products.length,
      prices: (window.WM_PUBLISH._state().prices || []).length,
      text: document.getElementById('smartList') ? document.getElementById('smartList').innerText.replace(/\s+/g, ' ').slice(0, 120) : '',
    };
  });

  chk(res.workers.some((u) => /xlsx-worker\.js/.test(u)),
    `файл разбирается в отдельном потоке (${res.workers.join(', ') || 'потоков не создано'})`);
  chk(res.canRun, `файл распознан как выгрузка цен (${res.text})`);
  chk(res.products === 400, `все 400 строк стали товарами (${res.products})`);
  chk(res.prices >= 400, `цены поставщика записаны (${res.prices})`);
  chk(!errs.length, `нет сбоев JS (${errs.length}${errs.length ? ': ' + errs[0] : ''})`);
  await done(b);
})();

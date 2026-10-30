// В ряде мобильных браузеров MediaQueryList ещё предоставляет addListener,
// но не addEventListener. Изменение темы не должно обрывать весь запуск.
const { chromium, runner, J } = require('./helpers');
(async () => {
  const b = await chromium.launch();
  const { chk, done } = runner('МОБИЛЬНЫЙ ЗАПУСК');
  const ctx = await b.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, serviceWorkers: 'block' });
  await ctx.addInitScript(() => {
    const original = window.matchMedia.bind(window);
    window.matchMedia = (query) => {
      const value = original(query);
      Object.defineProperty(value, 'addEventListener', { value: undefined });
      return value;
    };
    window.requestIdleCallback = undefined;
    window.cancelIdleCallback = undefined;
  });
  await ctx.route('**/data/index.json*', (r) => r.fulfill({ status: 404, body: 'fixture' }));
  await ctx.route('**/data/products.json*', (r) => r.fulfill(J([{ id: 'fixture', name: 'Мобильный запуск', code: '001', retail_price: 10, photos: [], barcodes: [] }])));
  await ctx.route('**/data/groups.json*', (r) => r.fulfill(J([])));
  await ctx.route('**/data/popular.json*', (r) => r.fulfill(J([])));
  await ctx.route('https://raw.githubusercontent.com/**', (r) => r.fulfill({ status: 404, body: 'fixture' }));
  const page = await ctx.newPage(), errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto('http://localhost:8123/');
  const ready = await page.waitForFunction(() => !!document.querySelector('.card[data-id]'), null, { timeout: 5000 }).then(() => true).catch(() => false);
  chk(ready, 'каталог запускается с прежним API подписки на тему и без requestIdleCallback');
  if (ready) {
    await page.emulateMedia({ colorScheme: 'dark' });
    await page.waitForTimeout(100);
    chk(await page.evaluate(() => getComputedStyle(document.documentElement).getPropertyValue('--bg').trim().toLowerCase() === '#10141e'), 'автоматическая тёмная тема продолжает работать');
  }
  chk(!errors.length, `нет ошибки мобильного запуска (${errors.join('; ')})`);
  await done(b);
})().catch((e) => { console.error(e); process.exitCode = 1; });

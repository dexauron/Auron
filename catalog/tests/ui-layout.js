// Общие окна: переносы на телефоне, обе темы, панели действий и доступные формы.
const { chromium, newPage, asOwner, closeAll, openProduct, runner } = require('./helpers');
(async () => {
  const b = await chromium.launch();
  const { chk, done } = runner('ОБЩИЙ ДИЗАЙН И АДАПТИВНОСТЬ');
  const { page, errs } = await newPage(b, { products: [{ id: 'p1', name: 'Молоко с длинным названием для проверки переноса',
    code: '000000001234567', retail_price: 1234567.89, barcodes: ['046012345678912345678'], photos: [], group_id: 'g1' }], groups: [{ id: 'g1', name: 'Продукты' }] });
  await asOwner(page);
  await openProduct(page, 'p1'); await closeAll(page);
  const ids = await page.locator('.sheet-backdrop').evaluateAll(es => es.map(e => e.id));
  const failures = []; let checked = 0;
  for (const width of [320, 390, 1280]) {
    await page.setViewportSize({ width, height: 900 });
    for (const theme of ['light', 'dark']) {
      await page.evaluate(async t => (await import('./js/modules/render.js')).applyTheme(t), theme);
      const chrome = await page.evaluate(() => {
        const color = getComputedStyle(document.documentElement).getPropertyValue('--bg').trim();
        return [...document.querySelectorAll('meta[name="theme-color"]')].every(e => e.content === color);
      });
      if (!chrome) failures.push({ width, theme, reason: 'цвет браузера не совпадает с темой' });
      for (const id of ids) {
        await closeAll(page);
        const size = await page.evaluate(x => {
          const bd = document.getElementById(x); bd.hidden = false;
          const e = bd.querySelector('.sheet');
          return { width: e.clientWidth, scroll: e.scrollWidth, body: document.documentElement.scrollWidth, viewport: innerWidth };
        }, id);
        checked++;
        if (size.scroll > size.width + 2 || size.body > size.viewport + 2) failures.push({ id, width, theme, ...size });
      }
      await closeAll(page);
      const panels = await page.evaluate(() => {
        const e = document.getElementById('compareBar'); e.hidden = false;
        const top = document.getElementById('tabbar').getBoundingClientRect().top;
        const bottom = e.getBoundingClientRect().bottom; e.hidden = true;
        return { ok: bottom <= top + 1, bottom, top };
      });
      if (!panels.ok) failures.push({ width, theme, reason: 'панель действий перекрывает вкладки', ...panels });
    }
  }
  chk(checked === ids.length * 6 && !failures.length,
    `${ids.length} окон × 3 ширины × 2 темы: ${checked} проверок без переполнения и перекрытия панелей${failures.length ? ': ' + JSON.stringify(failures) : ''}`);
  await page.evaluate(async () => (await import('./js/modules/render.js')).applyTheme(null));
  const auto = [];
  for (const colorScheme of ['dark', 'light']) {
    await page.emulateMedia({ colorScheme });
    await page.waitForFunction(() => [...document.querySelectorAll('meta[name="theme-color"]')]
      .every(e => e.content === getComputedStyle(document.documentElement).getPropertyValue('--bg').trim()));
    auto.push(await page.evaluate(() => getComputedStyle(document.documentElement).getPropertyValue('--bg').trim()));
  }
  chk(auto[0] !== auto[1], 'автоматическая тема и цвет браузера следуют смене системной темы');
  await closeAll(page); await page.setViewportSize({ width: 390, height: 900 });
  await page.evaluate(() => { const s = window.WM_PUBLISH._state(); s.session = null; s.isAdmin = false; });
  await page.click('#adminBtn'); await page.click('label[for="loginPassword"]');
  chk(await page.evaluate(() => document.activeElement.id === 'loginPassword'), 'подпись поля входа переводит фокус в пароль');
  chk(await page.evaluate(() => document.getElementById('loginError').getAttribute('role') === 'alert'
    && document.getElementById('toast').getAttribute('role') === 'status'), 'ошибки и результаты доступны для озвучивания');
  chk(!errs.length, `нет ошибок JS (${errs.length})`);
  await done(b);
})().catch(e => { console.error(e); process.exitCode = 1; });

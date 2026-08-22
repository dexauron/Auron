// Быстрые действия с ярлыка приложения: долгое нажатие на значок на главном
// экране телефона → «Сканер», «Закончилось», «Пересчёт».
const { chromium, newPage, runner } = require('./helpers');
const fs = require('fs');
const path = require('path');

const products = [{ id: 'p1', name: 'Молоко', code: '101', group_id: 'g1', retail_price: 89, unit: 'шт', photos: [], barcodes: ['4600000000011'] }];
const groups = [{ id: 'g1', name: 'Молочные' }];

(async () => {
  const b = await chromium.launch();
  const { chk, done } = runner('БЫСТРЫЕ ДЕЙСТВИЯ С ЯРЛЫКА');

  // 1. Ярлыки объявлены в манифесте — иначе телефон их не покажет
  const man = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'manifest.webmanifest'), 'utf8'));
  const urls = (man.shortcuts || []).map((x) => x.url);
  chk(urls.length === 3, `в манифесте три ярлыка (${urls.length})`);
  chk(urls.join(' ') === './?do=scan ./?do=restock ./?do=count', `адреса ярлыков на месте (${urls.join(' ')})`);
  chk((man.shortcuts || []).every((x) => x.name && x.short_name && (x.icons || []).length),
    'у каждого ярлыка есть название, короткое имя и значок');

  // 2. Без входа рабочий список не открывается — сначала вход
  {
    const { page } = await newPage(b, { products, groups });
    await page.goto('http://localhost:8123/?do=restock', { waitUntil: 'load' });
    await page.waitForFunction(() => window.WM_PUBLISH, { timeout: 30000 });
    await page.waitForTimeout(1200);
    const st = await page.evaluate(() => ({
      login: !document.getElementById('loginSheet').hidden,
      restock: !document.getElementById('restockSheet').hidden,
      url: location.search,
    }));
    chk(st.login && !st.restock, 'без входа ярлык «Закончилось» открывает вход');
    chk(st.url === '', `адрес чистится, чтобы обновление не повторяло действие (“${st.url}”)`);
    await page.context().close();
  }

  // 3. С запомненным входом открывается сам список
  for (const [what, sheet] of [['restock', 'restockSheet'], ['count', 'countSheet']]) {
    const { page } = await newPage(b, { products, groups });
    await page.evaluate(() => localStorage.setItem('wm_sv_auth', JSON.stringify({ pw: 'pw', role: 'owner' })));
    await page.goto(`http://localhost:8123/?do=${what}`, { waitUntil: 'load' });
    await page.waitForFunction(() => window.WM_PUBLISH, { timeout: 30000 });
    await page.waitForTimeout(1500);
    const open = await page.evaluate((id) => !document.getElementById(id).hidden, sheet);
    chk(open, `ярлык «${what}» открывает свой экран сразу`);
    await page.context().close();
  }

  // 4. Обычный заход без ярлыка ничего лишнего не открывает
  {
    const { page } = await newPage(b, { products, groups });
    const st = await page.evaluate(() => [...document.querySelectorAll('.sheet-backdrop:not([hidden])')].map((x) => x.id));
    chk(!st.length, `без ярлыка окна не открываются (${st.join(',') || 'ни одного'})`);
    await page.context().close();
  }

  await done(b);
})();

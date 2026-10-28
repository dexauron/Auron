// Отказ загрузки модулей: восстановление работает независимо от app.js,
// оставляет ключ/закрытую копию/настройки и не удаляет кэши других приложений.
const { chromium, runner, J } = require('./helpers');
let complete = false;
process.on('exit', (code) => { if (!complete && code === 0) process.exitCode = 1; });
(async () => {
  const b = await chromium.launch();
  const { chk, done } = runner('ВОССТАНОВЛЕНИЕ ЗАПУСКА');
  const ctx = await b.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, serviceWorkers: 'allow' });
  await ctx.route('**/js/modules/app.js', (r) => r.abort('failed'));
  await ctx.route('**/data/index.json*', (r) => r.fulfill({ status: 404, body: 'fixture' }));
  await ctx.route('**/data/products.json*', (r) => r.fulfill(J([{ id: 'fixture-recovery', name: 'Каталог после восстановления', code: '001', retail_price: 10, photos: [], barcodes: [] }])));
  await ctx.route('**/data/groups.json*', (r) => r.fulfill(J([])));
  await ctx.route('**/data/popular.json*', (r) => r.fulfill(J([])));
  await ctx.route('https://raw.githubusercontent.com/**', (r) => r.fulfill({ status: 404, body: 'fixture' }));
  const page = await ctx.newPage();
  await page.goto('http://localhost:8123/');
  await page.waitForFunction(() => !document.getElementById('startupNotice').hidden);
  chk(await page.evaluate(() => /обнови приложение/i.test(document.getElementById('startupMessage').textContent)), 'ошибка загрузки модулей даёт доступное действие восстановления');
  await page.evaluate(async () => {
    localStorage.setItem('wm_gh_token', 'fixture-recovery-token');
    await new Promise((resolve, reject) => {
      const q = indexedDB.open('wm_catalog_db', 1);
      q.onupgradeneeded = () => q.result.createObjectStore('kv');
      q.onerror = () => reject(q.error);
      q.onsuccess = () => {
        const tx = q.result.transaction('kv', 'readwrite');
        tx.objectStore('kv').put({ body: 'fixture-encrypted-private-copy' }, 'wm_private_device_v2');
        tx.oncomplete = () => { q.result.close(); resolve(); };
      };
    });
    for (const key of ['wm-data-v1', 'other-app-fixture']) {
      const c = await caches.open(key); await c.put('/fixture-preserved', new Response('fixture'));
    }
  });
  await ctx.setOffline(true);
  await page.click('#startupReload');
  chk(await page.evaluate(() => /нужен интернет/.test(document.getElementById('startupMessage').textContent)), 'без связи восстановление не удаляет установленное приложение');
  await ctx.setOffline(false);
  await ctx.unroute('**/js/modules/app.js');
  await Promise.all([page.waitForNavigation({ waitUntil: 'commit' }), page.click('#startupReload')]);
  await page.waitForFunction(() => !!document.querySelector('.card[data-id]'), null, { timeout: 30000 });
  const kept = await page.evaluate(async () => {
    const S = await import('./js/modules/store.js');
    return {
      token: localStorage.getItem('wm_gh_token') === 'fixture-recovery-token',
      private: (await S.idbGet('wm_private_device_v2'))?.body === 'fixture-encrypted-private-copy',
      data: !!(await (await caches.open('wm-data-v1')).match('/fixture-preserved')),
      other: !!(await (await caches.open('other-app-fixture')).match('/fixture-preserved')),
      hidden: document.getElementById('startupNotice').hidden,
    };
  });
  chk(kept.hidden, 'после восстановления каталог открывается, сообщение исчезает');
  chk(kept.token && kept.private, 'настройки публикации и закрытая офлайн-копия сохранены');
  chk(kept.data && kept.other, 'куски каталога и кэш другого приложения сохранены');
  await page.goto('http://localhost:8123/recover.html');
  chk(await page.evaluate(() => document.body.hasAttribute('data-recovery')
    && !document.getElementById('startupNotice').hidden), 'отдельная ссылка восстановления открывается независимо от главного экрана');
  await Promise.all([page.waitForNavigation({ waitUntil: 'commit' }), page.click('#startupReload')]);
  const returned = await page.waitForFunction(() => !!document.querySelector('.card[data-id]'), null, { timeout: 4000 })
    .then(() => true).catch(() => false);
  chk(returned && await page.evaluate(() => !document.body.hasAttribute('data-recovery')),
    'кнопка на отдельной странице восстановления возвращает в работающий каталог');
  await page.goto('http://localhost:8123/recover.html?wm-reload=1', { waitUntil: 'commit' });
  await page.waitForFunction(() => !!document.querySelector('.card[data-id]'));
  chk(await page.evaluate(() => !document.body.hasAttribute('data-recovery')), 'переход от прежнего загрузчика восстановления тоже возвращает в каталог');
  complete = true; await done(b);
})().catch((e) => { console.error(e); process.exitCode = 1; });

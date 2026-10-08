// Офлайн и обновления. Каталог живёт на телефоне сотрудника: связь в зале
// пропадает, и приложение обязано открываться без неё. А когда связь есть —
// новая версия должна приезжать сама, без «очистите кэш».
const { chromium, runner } = require('./helpers');
const fs = require('fs');
const path = require('path');

const products = Array.from({ length: 30 }, (_, i) => ({
  id: 'p' + i, name: 'Товар номер ' + i, code: String(1000 + i), barcodes: [],
  group_id: 'g1', retail_price: 50 + i, unit: 'шт', photos: [], created_at: '2026-08-01',
}));
const J = (o) => ({ status: 200, contentType: 'application/json', body: JSON.stringify(o) });

(async () => {
  const b = await chromium.launch();
  const { chk, done } = runner('ОФЛАЙН И ОБНОВЛЕНИЯ');
  const ctx = await b.newContext({ viewport: { width: 390, height: 844 }, isMobile: true });
  await ctx.route('**/auth/v1/**', (r) => r.fulfill({ status: 200, body: '{}' }));
  await ctx.route('**/rest/v1/**', (r) => r.fulfill(J([])));
  await ctx.route('**/data/products.json*', (r) => r.fulfill(J(products)));
  await ctx.route('**/data/groups.json*', (r) => r.fulfill(J([{ id: 'g1', name: 'Группа' }])));
  await ctx.route('**/data/popular.json*', (r) => r.fulfill(J([])));
  await ctx.route('https://raw.githubusercontent.com/**', (r) => r.fulfill({ status: 404, body: 'x' }));
  await ctx.route('https://api.github.com/**', (r) => r.fulfill(J({})));

  const page = await ctx.newPage();
  const errs = [];
  page.on('pageerror', (e) => errs.push(e.message));
  await page.goto('http://localhost:8123/', { waitUntil: 'load' });
  await page.waitForFunction(() => document.querySelectorAll('.grid .card').length > 0, { timeout: 60000 });
  // ждём, пока офлайн-копия установится и возьмёт управление
  await page.waitForFunction(() => navigator.serviceWorker && navigator.serviceWorker.controller, { timeout: 30000 })
    .catch(() => {});
  await page.waitForTimeout(1500);
  const controlled = await page.evaluate(() => !!(navigator.serviceWorker && navigator.serviceWorker.controller));
  chk(controlled, 'офлайн-копия приложения установилась и управляет страницей');

  // что попало в офлайн-копию: оболочка — да, тяжёлый разборщик Excel — нет
  const cached = await page.evaluate(async () => {
    const names = await caches.keys();
    const shell = names.find((n) => n.startsWith('wm-catalog-'));
    const c = await caches.open(shell);
    const keys = (await c.keys()).map((r) => new URL(r.url).pathname);
    return { shell, count: keys.length, hasApp: keys.some((k) => k.endsWith('js/modules/app.js')), hasXlsx: keys.some((k) => k.includes('vendor/xlsx.min.js')) };
  });
  chk(cached.hasApp, `оболочка сохранена на телефоне (${cached.count} файлов)`);
  chk(!cached.hasXlsx, 'разборщик Excel не занимает место, пока не понадобился');

  // ── связь пропала ──
  await ctx.setOffline(true);
  const t = Date.now();
  await page.reload({ waitUntil: 'commit' });
  const opened = await page.waitForFunction(() => document.querySelectorAll('.grid .card').length > 0, { timeout: 30000 })
    .then(() => true).catch(() => false);
  const offlineMs = Date.now() - t;
  chk(opened, `без связи каталог всё равно открывается (${offlineMs} мс)`);
  // Ждём, пока карточка не только появится, но и наполнится: сразу после
  // открытия сетка может успеть нарисовать только «заготовки» без текста.
  await page.waitForFunction(() => {
    const c = document.querySelector('.grid .card');
    return c && /Товар номер/.test(c.innerText);
  }, { timeout: 15000 }).catch(() => {});
  const shown = await page.evaluate(() => ({
    cards: document.querySelectorAll('.grid .card').length,
    text: (document.querySelector('.grid .card') || {}).innerText || '',
  }));
  chk(shown.cards > 0 && /Товар номер/.test(shown.text), `товары видны из памяти телефона (${shown.cards})`);

  // ── связь вернулась: новая версия должна приезжать сама ──
  await ctx.setOffline(false);
  const sw = fs.readFileSync(path.join(__dirname, '..', 'sw.js'), 'utf8');
  chk(/self\.skipWaiting\(\)/.test(sw), 'новая версия не ждёт закрытия всех вкладок (skipWaiting)');
  chk(/clients\.claim\(\)/.test(sw), 'новая версия сразу берёт управление (clients.claim)');
  const app = fs.readFileSync(path.join(__dirname, '..', 'js', 'modules', 'app.js'), 'utf8');
  chk(/controllerchange/.test(app) && /location\.reload\(\)/.test(app),
    'когда новая версия взяла управление, страница один раз перезагружается сама');
  chk(/busyNow\(\)/.test(app) && /pendingReload/.test(app),
    'но не под руками: если человек печатает или открыл окно, обновление ждёт');
  chk(/visibilitychange/.test(app) && /reg\.update\(\)/.test(app),
    'обновление проверяется при каждом возврате к приложению');

  chk(!errs.length, `нет сбоев JS (${errs.length}${errs.length ? ': ' + errs[0] : ''})`);
  await done(b);
})();

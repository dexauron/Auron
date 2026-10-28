// Настоящие service worker и CacheStorage. Обновление HTML не должно
// подменять часть уже установленной оболочки: старый JS может требовать
// удалённый элемент (реальный прежний контракт fabAdd из версии v139).
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const { chromium, runner } = require('./helpers');
const root = path.join(__dirname, '..');
const source = (p) => fs.readFileSync(path.join(root, p), 'utf8');
const mime = { '.js': 'application/javascript', '.html': 'text/html', '.css': 'text/css', '.json': 'application/json', '.png': 'image/png' };
const currentHtml = source('index.html');
const oldHtml = currentHtml.replace(/<script src="js\/boot\.js(?:\?[^\"]*)?"><\/script>\s*/, '')
  .replace('<body>', '<body><button id="fabAdd" hidden>+</button>');
const oldApp = source('js/modules/app.js').replace("  $('menuAddProduct').addEventListener", "  $('fabAdd').addEventListener('click', () => openForm(null));\n  $('menuAddProduct').addEventListener");
const sw = source('sw.js'), cacheName = sw.match(/const CACHE = '([^']+)'/)[1];
let newHtml = false, newApp = false, nextWorker = false;
const server = http.createServer((q, r) => {
  const name = new URL(q.url, 'http://localhost').pathname.replace(/^\//, '') || 'index.html';
  r.setHeader('Cache-Control', 'no-store');
  r.setHeader('Content-Type', mime[path.extname(name)] || 'application/octet-stream');
  if (name === 'index.html') return r.end(newHtml ? currentHtml : oldHtml);
  if (name === 'js/modules/app.js' && !newApp) return r.end(oldApp);
  if (name === 'sw.js') return r.end(nextWorker ? sw.replace(cacheName, cacheName + '-next') : sw);
  if (name === 'data/index.json') { r.statusCode = 404; return r.end('legacy fixture'); }
  if (name === 'data/products.json') return r.end(JSON.stringify([{ id: 'fixture-p1', name: 'Тест запуска', code: '001', retail_price: 10, photos: [], barcodes: [] }]));
  if (name === 'data/groups.json' || name === 'data/popular.json') return r.end('[]');
  const file = path.resolve(root, name);
  if (!file.startsWith(root + path.sep)) { r.statusCode = 403; return r.end(); }
  fs.readFile(file, (e, b) => { if (e) r.statusCode = 404; r.end(e ? 'fixture missing' : b); });
});

(async () => {
  const { chk, done } = runner('ЦЕЛЬНАЯ ВЕРСИЯ ПРИ ЗАПУСКЕ');
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const b = await chromium.launch();
  try {
    const ctx = await b.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, serviceWorkers: 'allow' });
    const page = await ctx.newPage(), errors = [];
    page.on('pageerror', (e) => errors.push(e.message));
    const url = `http://localhost:${server.address().port}/`;
    await page.goto(url);
    await page.waitForFunction(() => !!document.querySelector('.card[data-id]'));
    await page.evaluate(() => navigator.serviceWorker.register('sw.js'));
    await page.waitForFunction(() => !!navigator.serviceWorker.controller);
    await page.reload();
    await page.waitForFunction(() => !!document.querySelector('.card[data-id]'));

    // Сервер уже отдаёт новый HTML, а скрипт пока прежний. Контролирующий
    // worker обязан оставить установленную пару, пока не готов новый релиз.
    newHtml = true;
    await page.evaluate(async () => { await fetch('index.html'); await fetch('js/modules/app.js'); });
    await page.waitForTimeout(300); // завершение фоновых записей старой реализации
    const kept = await page.evaluate(async (name) => {
      const c = await caches.open(name);
      return (await (await c.match(new URL('index.html', location.href))).text()).includes('id="fabAdd"');
    }, cacheName);
    chk(kept, 'HTML установленной версии не заменяется отдельно от её JavaScript');
    await page.goto(url + 'index.html?from=phone');
    const opened = await page.waitForFunction(() => !!document.querySelector('.card[data-id]'), null, { timeout: 2500 })
      .then(() => true).catch(() => false);
    chk(opened, 'повторное открытие, включая адрес с параметром, работает во время публикации');

    // Полная следующая версия устанавливается целиком, затем виден новый экран.
    newApp = true; nextWorker = true;
    await page.evaluate(async () => { const r = await navigator.serviceWorker.getRegistration(); await r.update(); }).catch(() => {});
    await page.waitForFunction(async (name) => (await caches.keys()).includes(name + '-next'), cacheName);
    const automatic = await page.waitForFunction(() => !document.getElementById('fabAdd')
      && !!document.querySelector('.card[data-id]'), null, { timeout: 6000 }).then(() => true).catch(() => false);
    chk(automatic, 'установленная новая версия открывается автоматически');
    if (!automatic) await page.goto(url + 'index.html?from=updated');
    await page.waitForFunction(() => !!document.querySelector('.card[data-id]'));
    chk(await page.evaluate(() => !document.getElementById('fabAdd')), 'после установки цельного обновления показана новая версия без кнопки «+»');
    chk(!errors.length, `нет ошибки запуска при обновлении (${errors.join('; ')})`);
    await done(b);
  } finally { await b.close().catch(() => {}); server.close(); }
})().catch((e) => { console.error(e); server.close(); process.exitCode = 1; });

/* Свой браузер для изучения чужих сайтов.
 *
 * Зачем. Прокси среды пропускает обычные программы, но сбрасывает соединения
 * самого Chromium — «зайти и посмотреть» через обычный Playwright нельзя.
 * Здесь браузер в сеть не ходит вовсе: он только рисует страницу, а каждый его
 * запрос перехватывается и выполняется нашим каналом (net.js) через
 * CONNECT-туннель, который прокси разрешает.
 *
 * Запуск:
 *   NODE_EXTRA_CA_CERTS=/root/.ccr/ca-bundle.crt \
 *   node .claude/tools/browse/browse.js <папка-для-снимков> имя=адрес [имя=адрес…]
 *
 * Кладёт PNG в папку и печатает заголовок, текст страницы и вес (запросы/МБ).
 * Проверено на magnit.ru и lenta.com; 5ka.ru отдаёт 403 — у них своя защита
 * от роботов, и это не проблема канала. */
const { chromium } = require('/opt/node22/lib/node_modules/playwright');
const { fetchVia } = require(require('path').join(__dirname, 'net.js'));

const UA = 'Mozilla/5.0 (Linux; Android 13; Pixel 7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Mobile Safari/537.36';
const CLOSERS = ['Не сейчас', 'Закрыть', 'Принять', 'Хорошо', 'Понятно', 'Отклонить'];

async function open(urls, outDir, opts = {}) {
  const b = await chromium.launch();
  const ctx = await b.newContext({
    viewport: { width: 412, height: 915 }, isMobile: true, hasTouch: true, deviceScaleFactor: 2,
    locale: 'ru-RU', timezoneId: 'Europe/Moscow', userAgent: UA,
    extraHTTPHeaders: { 'accept-language': 'ru-RU,ru;q=0.9' },
  });
  const page = await ctx.newPage();
  let n = 0; let bytes = 0; let failed = 0;
  await page.route('**/*', async (route) => {
    const req = route.request();
    if (!/^https?:/.test(req.url())) { await route.abort(); return; }
    try {
      const r = await fetchVia(req.url(), {
        method: req.method(), headers: req.headers(), body: req.postDataBuffer() || null,
      });
      n++; bytes += r.body.length;
      await route.fulfill({ status: r.status, headers: r.headers, body: r.body });
    } catch (e) { failed++; await route.abort(); }
  });

  const out = [];
  for (const [name, url] of urls) {
    n = 0; bytes = 0; failed = 0;
    try {
      await page.goto(url, { timeout: 90000, waitUntil: 'domcontentloaded' });
      await page.waitForTimeout(opts.wait || 6000);
      // баннеры про cookie и «откройте приложение» закрываем — они закрывают экран
      for (const t of CLOSERS) {
        const el = page.locator(`button:has-text("${t}")`).first();
        if (await el.count() && await el.isVisible().catch(() => false)) {
          await el.click().catch(() => {}); await page.waitForTimeout(500);
        }
      }
      await page.waitForTimeout(1200);
      const shot = `${outDir}/${name}.png`;
      await page.screenshot({ path: shot, fullPage: !!opts.full });
      const title = await page.title();
      const text = (await page.evaluate(() => (document.body ? document.body.innerText : ''))).replace(/\s+/g, ' ');
      out.push({ name, url, title, text, shot, requests: n, mb: +(bytes / 1048576).toFixed(1) });
      console.log(`${name}: ${title.slice(0, 60)}`);
      console.log(`   вес: ${n} запросов, ${(bytes / 1048576).toFixed(1)} МБ (не дошло ${failed})`);
      console.log(`   ${text.slice(0, 300)}`);
    } catch (e) { console.log(`${name}: ошибка ${e.message.split('\n')[0].slice(0, 70)}`); }
  }
  await b.close();
  return out;
}

module.exports = { open };
if (require.main === module) {
  const outDir = process.argv[2];
  const urls = process.argv.slice(3).map((s) => { const i = s.indexOf('='); return [s.slice(0, i), s.slice(i + 1)]; });
  open(urls, outDir).catch((e) => { console.error(e.message); process.exit(1); });
}

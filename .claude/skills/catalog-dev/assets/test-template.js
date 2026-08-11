// Стартовый шаблон Playwright-теста каталога с моками Supabase.
// Скопируй в рабочую папку, дай имя (напр. myfeature.js), допиши свои проверки.
// Запуск:  cd catalog && python3 -m http.server 8123 &
//          NODE_PATH=/opt/node22/lib/node_modules node myfeature.js
//
// Фикстуры (groups.json / suppliers.json / p_1000.json) лежат в рабочей папке
// тестов рядом; поправь путь FX под своё окружение.
const { chromium } = require('playwright');
const fs = require('fs');

const FX = process.env.FX || './fixtures';
const groups = JSON.parse(fs.readFileSync(`${FX}/groups.json`));
const suppliers = JSON.parse(fs.readFileSync(`${FX}/suppliers.json`));
// собственные товары теста: сюда добавляй поля под проверяемую фичу
const products = JSON.parse(fs.readFileSync(`${FX}/p_1000.json`))
  .map((p, i) => ({ ...p, retail_price: 100 + i, photos: [] }));

// PostgREST отдаёт срез по offset/limit — повторяем это в моке
function slice(rows, req) {
  const u = new URL(req.url());
  const o = Number(u.searchParams.get('offset') || 0);
  const l = Number(u.searchParams.get('limit') || rows.length);
  return rows.slice(o, o + l);
}

(async () => {
  const b = await chromium.launch();
  const ctx = await b.newContext({
    viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true,
    serviceWorkers: 'block',
  });

  // ВАЖНО: широкие ловушки — ПЕРВЫМИ (Playwright матчит последний-первым),
  // конкретные маршруты — ПОСЛЕ них, иначе ловушка перехватит всё.
  await ctx.route('**/auth/v1/**', (r) => r.fulfill({ status: 200, contentType: 'application/json', body: '{}' }));
  await ctx.route('**/rest/v1/**', (r) => r.fulfill({ status: 200, contentType: 'application/json', body: '[]' }));
  await ctx.route('**/rest/v1/rpc/**', (r) => r.fulfill({ status: 200, contentType: 'application/json', body: '[]' }));
  await ctx.route('**/rest/v1/catalog_groups*', (r) => r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(groups) }));
  await ctx.route('**/rest/v1/catalog_suppliers*', (r, q) => r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(slice(suppliers, q)) }));
  await ctx.route('**/rest/v1/catalog_products*', (r, q) => {
    const u = new URL(q.url());
    // запрос общего числа товаров: select=id → 206 + content-range
    if (u.searchParams.get('select') === 'id') {
      return r.fulfill({ status: 206, headers: { 'content-range': `0-0/${products.length}` }, body: '' });
    }
    r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(slice(products, q)) });
  });

  const page = await ctx.newPage();
  const errs = [];
  page.on('pageerror', (e) => errs.push(e.message));
  await page.goto('http://localhost:8123/', { timeout: 60000 });
  await page.waitForSelector('.card', { timeout: 30000 });
  await page.waitForTimeout(400);

  let fail = false;
  const chk = (c, m) => { if (!c) { console.log('FAIL:', m); fail = true; } else console.log('OK:', m); };

  // ─── твои проверки здесь ───
  chk(await page.evaluate(() => document.querySelectorAll('#productGrid .card').length > 0), 'товары показаны');

  if (errs.length) { console.log('FAIL: JS-ошибки:', errs); fail = true; }
  if (!fail) console.log('\n=== ТЕСТ ОК ===');
  await b.close();
  process.exit(fail ? 1 : 0);
})();

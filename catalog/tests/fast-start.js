// Быстрый вход. Сотрудник в зале не должен ждать, пока скачается весь каталог:
// товары показываются по мере загрузки, а при повторном заходе — сразу из
// памяти телефона, ещё до того, как ответит сеть.
const { chromium, runner } = require('./helpers');

const N = 1600;
const products = Array.from({ length: N }, (_, i) => ({
  id: 'p' + i, name: 'Товар ' + String(i).padStart(4, '0'), code: String(3000 + i),
  group_id: 'g1', retail_price: 10 + i, unit: 'шт', photos: [], created_at: '2026-01-01',
}));
const groups = [{ id: 'g1', name: 'Товары' }];

// раскладываем по 16 кускам тем же способом, что и приложение
function partIndex(id, n) {
  let h = 2166136261;
  const s = String(id);
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); }
  return (h >>> 0) % n;
}
const PARTS = 16;
const parts = Array.from({ length: PARTS }, () => []);
products.forEach((p) => parts[partIndex(p.id, PARTS)].push(p));
const index = { v: 2, n: PARTS, parts: parts.map((_, i) => 'h' + i), groups: 'g', popular: 'p' };

const json = (o) => ({ status: 200, contentType: 'application/json', body: JSON.stringify(o) });
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

// SLOW_FROM — с какого куска начинается «медленная сеть»
async function openCatalog(ctx, slowFrom, delayMs) {
  await ctx.route('**/data/*.json*', (r) => r.fulfill(json([])));
  await ctx.route('**/data/index.json*', (r) => r.fulfill(json(index)));
  await ctx.route('**/data/groups.json*', (r) => r.fulfill(json(groups)));
  await ctx.route('**/data/p/*.json*', async (r, q) => {
    const i = Number((/\/p\/(\d+)\.json/.exec(q.url()) || [])[1]);
    if (i >= slowFrom) await wait(delayMs);
    r.fulfill(json(parts[i] || []));
  });
  await ctx.route('https://raw.githubusercontent.com/**', (r) => r.fulfill({ status: 404, body: 'x' }));
}

const cards = (page) => page.evaluate(() => document.querySelectorAll('.card').length);
// Ждём именно ТОВАРЫ. По появлению «.card» ориентироваться нельзя: пока идёт
// загрузка, приложение рисует такими же карточками серый скелет, и проверка
// показывала бы 200 мс даже там, где товаров ещё нет.
const waitProducts = (page) => page.waitForFunction(
  () => window.WM_PUBLISH && window.WM_PUBLISH._state().products.length > 0, { timeout: 15000 });

(async () => {
  const b = await chromium.launch();
  const { chk, done } = runner('БЫСТРЫЙ ВХОД');
  const ctx = await b.newContext({ viewport: { width: 390, height: 900 }, isMobile: true, hasTouch: true, serviceWorkers: 'block' });
  const errs = [];

  // ── 1. Первый заход: два куска приходят быстро, остальные — через 3 секунды ──
  await openCatalog(ctx, 2, 3000);
  const page = await ctx.newPage();
  page.on('pageerror', (e) => errs.push(e.message));
  const t0 = Date.now();
  await page.goto('http://localhost:8123/', { timeout: 60000 });
  await waitProducts(page);
  const firstMs = Date.now() - t0;
  // сколько товаров УЖЕ загружено в этот момент (а не сколько влезло на экран:
  // на экране всегда не больше страницы, и по нему прогресс не увидеть)
  const early = await page.evaluate(() => window.WM_PUBLISH._state().products.length);
  chk(firstMs < 3000, `первые товары видны, не дожидаясь всего каталога (${firstMs} мс)`);
  chk(early > 0 && early < N, `показана часть каталога, остальное ещё грузится (${early} из ${N})`);

  await page.waitForTimeout(4000);
  const total = await page.evaluate(() => window.WM_PUBLISH._state().products.length);
  chk(total === N, `к концу загрузки каталог полный (${total})`);
  const search = await page.evaluate(() => {
    const s = window.WM_PUBLISH._state();
    s.query = 'Товар 0100';
    return window.WM_PUBLISH.visibleProducts().length;
  });
  chk(search > 0, `поиск работает по загруженному каталогу (нашёл ${search})`);

  // ── 2. Повторный заход при очень медленной сети: каталог из памяти телефона ──
  await page.evaluate(() => { window.WM_PUBLISH._state().query = ''; });
  await ctx.unroute('**/data/p/*.json*');
  await openCatalog(ctx, 0, 8000);            // теперь ВСЕ куски по 8 секунд
  const t1 = Date.now();
  await page.reload({ timeout: 60000 });
  await waitProducts(page);
  const againMs = Date.now() - t1;
  const shown = await cards(page);
  // это поведение было и раньше — проверка сторожит, чтобы показ по мере
  // загрузки его не сломал
  chk(againMs < 4000, `повторный заход по-прежнему не ждёт сеть (${againMs} мс при сети в 8 секунд)`);
  chk(shown > 0, `каталог показан из памяти телефона (${shown} карточек на экране)`);

  chk(!errs.length, `нет сбоев JS (${errs.length}${errs.length ? ': ' + errs[0] : ''})`);
  await done(b);
})();

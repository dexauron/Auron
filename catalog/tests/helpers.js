// Общая обвязка для проверок каталога: поднимает страницу с подменёнными
// данными, чтобы тесты не зависели от настоящей базы и от интернета.
const { chromium } = require('playwright');

const J = (o) => ({ status: 200, contentType: 'application/json', body: JSON.stringify(o) });

// ВАЖНО: порядок моков. js/config.js подменяем ПЕРВЫМ — иначе он перезапишет
// подставленные настройки, и тест незаметно уйдёт на настоящий магазин.
async function newPage(browser, data = {}) {
  const ctx = await browser.newContext({
    viewport: { width: 390, height: 900 }, isMobile: true, hasTouch: true, serviceWorkers: 'block',
  });
  await ctx.addInitScript(() => localStorage.setItem('wm_gh_token', 'tok'));
  await ctx.route('**/auth/v1/**', (r) => r.fulfill({ status: 200, body: '{}' }));
  await ctx.route('**/rest/v1/**', (r) => r.fulfill(J([])));
  /* Витрина лежит кусками (`p/00.json…`) с описью `index.json` — приложение
     читает именно её. Пока обвязка подменяла только старый цельный
     products.json, подставленные товары до приложения не доходили, и тесты
     молча работали на НАСТОЯЩЕМ каталоге из репозитория. Теперь подменяем
     новый формат: опись из одного куска + сам кусок. Старый файл оставляем
     запасным — его читают при отсутствии описи. */
  await ctx.route('**/data/index.json*', (r) => r.fulfill(J({
    v: 2, app: 4, savedAt: new Date().toISOString(), n: 1,
    parts: ['test'], groups: 'test', popular: 'test',
  })));
  await ctx.route('**/data/p/*.json*', (r) => {
    const m = /\/p\/(\d+)\.json/.exec(r.request().url());
    const i = m ? Number(m[1]) : 0;
    r.fulfill(J(i === 0 ? (data.products || []) : []));
  });
  await ctx.route('**/data/products.json*', (r) => r.fulfill(J(data.products || [])));
  await ctx.route('**/data/groups.json*', (r) => r.fulfill(J(data.groups || [])));
  await ctx.route('**/data/popular.json*', (r) => r.fulfill(J(data.popular || [])));
  await ctx.route('**/data/competitors.json*', (r) => r.fulfill(J(data.comp || { stores: [], prices: [] })));
  await ctx.route('https://raw.githubusercontent.com/**', (r) => r.fulfill({ status: 404, body: 'x' }));
  await ctx.route('https://api.github.com/**', (r) => r.fulfill(J({})));
  const page = await ctx.newPage();
  const errs = [];
  page.on('pageerror', (e) => errs.push(e.message));
  await page.goto('http://localhost:8123/', { timeout: 60000 });
  await page.waitForFunction(() => window.WM_PUBLISH, { timeout: 30000 });
  await page.waitForTimeout(900);
  return { ctx, page, errs };
}

// войти владельцем (бесплатный режим) и подложить внутренние данные
async function asOwner(page, d = {}) {
  await page.evaluate((x) => {
    const P = window.WM_PUBLISH; P.ghSetToken('tok'); P.applyServerless('pw');
    const s = P._state();
    if (x.prices) s.prices = x.prices;
    if (x.sales) s.sales = x.sales;
    if (x.suppliers) s.suppliers = x.suppliers;
    if (x.competitors) s.competitors = x.competitors;
    if (x.compPrices) s.compPrices = x.compPrices;
    P.renderAll();
  }, d);
  await page.waitForTimeout(400);
}

const closeAll = (page) => page.evaluate(() => {
  document.querySelectorAll('.sheet-backdrop').forEach((x) => { x.hidden = true; });
});

// ВАЖНО: сначала сбрасываем адрес. Если он уже указывает на этот товар,
// повторная установка того же значения не считается переходом — карточка не
// перерисуется, и тест будет смотреть на старое содержимое.
const openProduct = async (page, id) => {
  await closeAll(page);
  await page.evaluate(() => { window.location.hash = ''; });
  await page.waitForTimeout(150);
  await page.evaluate((i) => { window.location.hash = '#p=' + i; }, id);
  await page.waitForTimeout(800);
};

const text = (page, sel) => page.evaluate((s) => {
  const el = document.querySelector(s);
  return el ? el.innerText.replace(/\s+/g, ' ').trim() : '';
}, sel);

function runner(title) {
  let fail = false;
  const chk = (cond, msg) => { if (!cond) { console.log('FAIL:', msg); fail = true; } else console.log('OK:', msg); };
  const done = async (browser) => {
    console.log(fail ? `\n=== ${title}: ЕСТЬ ОШИБКИ ===` : `\n=== ${title}: ОК ===`);
    await browser.close();
    process.exit(fail ? 1 : 0);
  };
  return { chk, done };
}

module.exports = { chromium, J, newPage, asOwner, closeAll, openProduct, text, runner };

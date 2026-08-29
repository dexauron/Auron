// Движок один, магазинов может быть много. Проверяем, что каталог целиком
// описывается ОДНИМ файлом настроек: поменял — получил каталог другого
// магазина, и нигде в коде не осталось зашитого «Way Market».
const fs = require('fs');
const path = require('path');
const { chromium, newPage, asOwner, runner } = require('./helpers');

const products = [
  { id: 'p1', name: 'Молоко Простоквашино 3,2%', code: '101', group_id: 'g1', retail_price: 89, unit: 'шт', photos: [], created_at: '2026-01-01' },
  { id: 'p2', name: 'Саморез 3,5х25 оцинк', code: '102', group_id: 'g2', retail_price: 3, unit: 'шт', photos: [], created_at: '2026-01-01' },
];
const groups = [{ id: 'g1', name: 'Молочные продукты' }, { id: 'g2', name: 'Крепёж' }];

// настройки ДРУГОГО магазина: другое имя, цвет, без логотипа,
// без цен конкурентов и без «Ходовых», разделы — из групп 1С
const OTHER_STORE = {
  STORE_NAME: 'Стройдвор', STORE_SUBTITLE: 'Каталог для зала', LOGO: '', ACCENT: '#B3261E',
  CATEGORIES: 'none', FEATURES: { competitors: false, sales: false, stock: false },
};

(async () => {
  const b = await chromium.launch();
  const { chk, done } = runner('НАСТРОЙКИ МАГАЗИНА');

  // ── 1. В коде движка нет названия конкретного магазина ──
  const dir = path.join(__dirname, '..', 'js', 'modules');
  const hard = fs.readdirSync(dir).filter((f) => f.endsWith('.js'))
    .filter((f) => /Way Market/.test(fs.readFileSync(path.join(dir, f), 'utf8').replace(/^.*названия «Way Market».*$/gm, '')));
  chk(!hard.length, `в модулях нет зашитого названия магазина${hard.length ? ': ' + hard.join(', ') : ''}`);
  const html = fs.readFileSync(path.join(dir, '..', '..', 'index.html'), 'utf8');
  chk(/class="brand-name"/.test(html), 'в разметке есть место под название магазина');

  // ── 2. Каталог как есть — это Way Market ──
  {
    const { page, errs } = await newPage(b, { products, groups });
    // «Работа» — экран вошедшего: без входа там предложение войти
    await asOwner(page);
    const own = await page.evaluate(() => ({
      title: document.title,
      name: (document.querySelector('.brand-name') || {}).textContent,
      // «цены магазинов» и «ходовые» живут во вкладке «Работа» (29.08):
      // раньше они были строками меню, и проверка смотрела туда
      work: window.WM_PUBLISH._workRows(),
      cat: window.WM_PUBLISH._cat(window.WM_PUBLISH._state().products.find((p) => p.id === 'p1')),
    }));
    chk(/Way Market/.test(own.title) && own.name === 'Way Market', `свой магазин на месте (${own.name})`);
    chk(/Цены других магазинов/.test(own.work) && /Ходовые товары/.test(own.work),
      'включённые возможности видны во вкладке «Работа»');
    chk(own.cat === 'Молочное', `разделы продуктового магазина работают (молоко → ${own.cat})`);
    chk(!errs.length, `нет сбоев JS (${errs.length}${errs.length ? ': ' + errs[0] : ''})`);
    await page.context().close();
  }

  // ── 3. Тот же движок с другими настройками — другой магазин ──
  {
    const ctx = await b.newContext({ viewport: { width: 390, height: 900 }, isMobile: true, hasTouch: true, serviceWorkers: 'block' });
    // настройки подменяем ПОСЛЕ загрузки config.js — иначе он перезапишет наши
    await ctx.route('**/js/config.js', (r, q) => r.fulfill({
      status: 200, contentType: 'application/javascript',
      body: `window.CATALOG_CONFIG = ${JSON.stringify({ ...OTHER_STORE, STATIC_URL: 'data/', GITHUB_OWNER: 'o', GITHUB_REPO: 'r', GITHUB_BRANCH: 'b', DATA_PATH: 'd' })};`,
    }));
    // ВАЖНО: широкая ловушка — ПЕРВОЙ, конкретные адреса после неё,
    // иначе ловушка перехватит и товары (Playwright проверяет роуты с конца).
    await ctx.route('**/data/*.json*', (r) => r.fulfill({ status: 200, contentType: 'application/json', body: '[]' }));
    await ctx.route('**/data/products.json*', (r) => r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(products) }));
    await ctx.route('**/data/groups.json*', (r) => r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(groups) }));
    await ctx.route('https://raw.githubusercontent.com/**', (r) => r.fulfill({ status: 404, body: 'x' }));
    const page = await ctx.newPage();
    const errs = [];
    page.on('pageerror', (e) => errs.push(e.message));
    await page.goto('http://localhost:8123/', { timeout: 60000 });
    await page.waitForFunction(() => window.WM_PUBLISH, { timeout: 30000 });
    await page.waitForTimeout(700);

    await asOwner(page);
    const other = await page.evaluate(() => ({
      title: document.title,
      name: (document.querySelector('.brand-name') || {}).textContent,
      sub: (document.querySelector('.brand-sub') || {}).textContent,
      letter: (document.querySelector('.brand-logo-letter') || {}).textContent,
      accent: document.documentElement.style.getPropertyValue('--brand').trim(),
      work: window.WM_PUBLISH._workRows(),
      milk: window.WM_PUBLISH._cat(window.WM_PUBLISH._state().products.find((p) => p.id === 'p1')),
      screw: window.WM_PUBLISH._cat(window.WM_PUBLISH._state().products.find((p) => p.id === 'p2')),
      cards: document.querySelectorAll('.card').length,
    }));
    chk(other.name === 'Стройдвор' && /Стройдвор/.test(other.title) && other.sub === 'Каталог для зала',
      `другой магазин: ${other.name} · ${other.sub}`);
    chk(other.letter === 'С', `логотипа нет — показана первая буква названия (${other.letter})`);
    chk(other.accent === '#B3261E', `цвет магазина применён (${other.accent})`);
    chk(!/Цены других магазинов/.test(other.work) && !/Ходовые товары/.test(other.work),
      'выключенные возможности исчезли из вкладки «Работа»');
    chk(other.milk === 'Молочные продукты' && other.screw === 'Крепёж',
      `разделы взяты из групп 1С, а не из продуктовых правил (молоко → ${other.milk}, саморез → ${other.screw})`);
    chk(other.cards === products.length, `товары показываются (${other.cards})`);
    chk(!errs.length, `нет сбоев JS у другого магазина (${errs.length}${errs.length ? ': ' + errs[0] : ''})`);
    await ctx.close();
  }

  await done(b);
})();

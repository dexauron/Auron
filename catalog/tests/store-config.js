// Движок один, магазинов может быть много. Проверяем, что каталог целиком
// описывается ОДНИМ файлом настроек: поменял — получил каталог другого
// магазина, и нигде в коде не осталось зашитого названия, телефона, адреса
// или картинок конкретного магазина.
const fs = require('fs');
const path = require('path');
const { chromium, newPage, runner } = require('./helpers');

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

  // ── 1. В коде движка нет ничего, что описывает конкретный магазин ──
  const dir = path.join(__dirname, '..', 'js', 'modules');
  const html = fs.readFileSync(path.join(dir, '..', '..', 'index.html'), 'utf8');
  chk(/class="brand-name"/.test(html), 'в разметке есть место под название магазина');

  /* ── Движок должен быть пригоден для ЧУЖОГО магазина ───────────────────────
   * Каталог отдаётся заготовкой: «чтобы любой смог переделать под свой
   * магазин». Значит ничего, что описывает КОНКРЕТНЫЙ магазин, не должно быть
   * зашито ни в разметке, ни в модулях. Проверка не знает, чей это магазин:
   * она берёт значения из js/config.js и ищет ИХ в коде — поэтому работает и в
   * заготовке, и в любой копии, кем бы она ни была настроена. */
  const cfgText = fs.readFileSync(path.join(dir, '..', 'config.js'), 'utf8');
  const cfg = {};
  for (const [, k, v] of cfgText.matchAll(/^\s*([A-Z_]+):\s*'([^']*)'/gm)) cfg[k] = v;
  const mods = fs.readdirSync(dir).filter((f) => f.endsWith('.js'))
    .map((f) => ({ f, t: fs.readFileSync(path.join(dir, f), 'utf8').replace(/\/\*[\s\S]*?\*\/|\/\/[^\n]*/g, '') }));
  const htmlNoComments = html.replace(/<!--[\s\S]*?-->/g, '');
  const OWN = ['STORE_NAME', 'STORE_PHONE', 'STORE_WHATSAPP', 'STORE_ADDRESS',
    'STORE_PROMISE', 'LOGO', 'MASCOT', 'MASCOT_HEAD', 'MASCOT_NAME'];
  const leaked = [];
  for (const k of OWN) {
    const v = cfg[k];
    if (!v || v.length < 4) continue;                  // пустое и короткое не ищем
    if (htmlNoComments.includes(v)) leaked.push(`${k} → index.html`);
    for (const m of mods) if (m.t.includes(v)) leaked.push(`${k} → ${m.f}`);
  }
  chk(!leaked.length, `ничего из настроек магазина не зашито в движке${leaked.length ? ': ' + leaked.join(', ') : ''}`);
  // и наоборот: настройки действительно заполнены — иначе проверка выше пустая
  chk(OWN.filter((k) => cfg[k]).length >= 5,
    `настройки магазина заполнены, проверке есть что искать (${OWN.filter((k) => cfg[k]).length} из ${OWN.length})`);
  // офлайн-копия тоже не должна знать имена наших картинок
  const sw = fs.readFileSync(path.join(dir, '..', '..', 'sw.js'), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');
  const swLeak = OWN.filter((k) => cfg[k] && cfg[k].length > 4 && sw.includes(cfg[k]));
  chk(!swLeak.length, `офлайн-копия не знает картинок магазина${swLeak.length ? ': ' + swLeak.join(', ') : ''}`);

  /* ── 2. Настройки действительно применились ────────────────────────────────
   * Сверяем с тем, что написано в js/config.js, а не с именем нашего магазина:
   * должна проходить и в заготовке, и в копии любого магазина. */
  {
    const { page, errs } = await newPage(b, { products, groups });
    const own = await page.evaluate(() => ({
      c: window.CATALOG_CONFIG,
      title: document.title,
      name: (document.querySelector('.brand-name') || {}).textContent,
      letter: (document.querySelector('.brand-logo-letter') || {}).textContent,
      logo: (document.querySelector('.brand-logo-img') || {}).getAttribute
        ? (document.querySelector('.brand-logo-img') || {}).getAttribute('src') : null,
      work: (window.WM_PUBLISH.ghSetToken('t'), window.WM_PUBLISH.applyServerless('pw'),
        window.WM_PUBLISH._work('x'), window.WM_PUBLISH._workRows().join(' | ')),
      cat: window.WM_PUBLISH._cat(window.WM_PUBLISH._state().products.find((p) => p.id === 'p1')),
    }));
    chk(own.name === own.c.STORE_NAME && own.title.includes(own.c.STORE_NAME),
      `название из настроек стоит в шапке и на вкладке (${own.name})`);
    chk(own.c.LOGO ? own.logo === own.c.LOGO : !!own.letter,
      `логотип из настроек, а без логотипа — первая буква (${own.logo || own.letter})`);
    const on = (k) => own.c.FEATURES[k] !== false;
    chk(/Ходовые/.test(own.work) === on('sales')
      && /других магазинов/.test(own.work) === on('competitors'),
    `во вкладке «Работа» ровно то, что включено в настройках (${own.work})`);
    chk(own.c.CATEGORIES !== 'grocery' || own.cat === 'Молочное',
      `разделы продуктового магазина работают (молоко → ${own.cat})`);
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

    const other = await page.evaluate(() => ({
      title: document.title,
      name: (document.querySelector('.brand-name') || {}).textContent,
      sub: (document.querySelector('.brand-sub') || {}).textContent,
      letter: (document.querySelector('.brand-logo-letter') || {}).textContent,
      accent: document.documentElement.style.getPropertyValue('--brand').trim(),
      work: (window.WM_PUBLISH.ghSetToken('t'), window.WM_PUBLISH.applyServerless('pw'),
        window.WM_PUBLISH._work('x'), window.WM_PUBLISH._workRows().join(' | ')),
      milk: window.WM_PUBLISH._cat(window.WM_PUBLISH._state().products.find((p) => p.id === 'p1')),
      screw: window.WM_PUBLISH._cat(window.WM_PUBLISH._state().products.find((p) => p.id === 'p2')),
      cards: document.querySelectorAll('.card').length,
    }));
    chk(other.name === 'Стройдвор' && /Стройдвор/.test(other.title) && other.sub === 'Каталог для зала',
      `другой магазин: ${other.name} · ${other.sub}`);
    chk(other.letter === 'С', `логотипа нет — показана первая буква названия (${other.letter})`);
    chk(other.accent === '#B3261E', `цвет магазина применён (${other.accent})`);
    chk(!/Ходовые/.test(other.work) && !/других магазинов/.test(other.work),
      `выключенные возможности исчезли и из вкладки «Работа» (${other.work})`);
    chk(other.milk === 'Молочные продукты' && other.screw === 'Крепёж',
      `разделы взяты из групп 1С, а не из продуктовых правил (молоко → ${other.milk}, саморез → ${other.screw})`);
    chk(other.cards === products.length, `товары показываются (${other.cards})`);
    chk(!errs.length, `нет сбоев JS у другого магазина (${errs.length}${errs.length ? ': ' + errs[0] : ''})`);
    await ctx.close();
  }

  await done(b);
})();

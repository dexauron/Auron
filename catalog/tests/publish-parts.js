// Публикация по частям. Главное, что проверяем: после мелкой правки на GitHub
// уезжает НЕСКОЛЬКО файлов, а не весь каталог. Раньше любая мелочь переписывала
// витрину целиком и два зашифрованных файла по 17 МБ.
const { chromium, runner } = require('./helpers');

const N = 400;                       // товаров в проверочном каталоге
const products = Array.from({ length: N }, (_, i) => ({
  id: 'p' + i, name: 'Товар ' + String(i).padStart(3, '0'), code: String(2000 + i),
  group_id: 'g1', retail_price: 100 + i, is_weighted: false, unit: 'шт',
  photos: [], barcodes: ['46' + String(i).padStart(11, '0')], created_at: '2026-01-01',
}));
const prices = products.map((p, i) => ({ product_id: p.id, supplier_id: 's1', price: 50 + i, price_date: '2026-08-01', unit: 'шт' }));
const sales = products.slice(0, 100).map((p) => ({ period_from: '2026-07-01', period_to: '2026-07-31', code: p.code, name: p.name, qty: 5, amount: 500 }));

// ── Мини-GitHub: хранит файлы в памяти, как настоящий репозиторий ──
function fakeGithub() {
  const fs = new Map();          // путь → содержимое
  const blobs = new Map();       // sha → содержимое
  const commits = [];            // список залитых деревьев (пути каждого коммита)
  let n = 0;
  const json = (o) => ({ status: 200, contentType: 'application/json', body: JSON.stringify(o) });
  return {
    fs, commits,
    async route(ctx) {
      await ctx.route('https://api.github.com/**', async (r, q) => {
        const url = new URL(q.url());
        const path = url.pathname;
        if (q.method() === 'GET' && /\/git\/ref\/heads\//.test(path)) return r.fulfill(json({ object: { sha: 'base' } }));
        if (q.method() === 'GET' && /\/git\/commits\//.test(path)) return r.fulfill(json({ tree: { sha: 'tree0' } }));
        if (q.method() === 'POST' && path.endsWith('/git/blobs')) {
          const body = JSON.parse(q.postData() || '{}');
          const sha = 'blob' + (++n);
          blobs.set(sha, body.content);
          return r.fulfill(json({ sha }));
        }
        if (q.method() === 'POST' && path.endsWith('/git/trees')) {
          const body = JSON.parse(q.postData() || '{}');
          const paths = [];
          for (const e of body.tree) {
            paths.push(e.path);
            if (e.sha == null) fs.delete(e.path);
            else fs.set(e.path, blobs.get(e.sha));
          }
          commits.push(paths);
          return r.fulfill(json({ sha: 'tree' + commits.length }));
        }
        if (q.method() === 'POST' && path.endsWith('/git/commits')) return r.fulfill(json({ sha: 'commit' + commits.length }));
        if (q.method() === 'PATCH') return r.fulfill(json({ ok: true }));
        return r.fulfill(json({}));
      });
      // чтение репозитория (raw) и витрины с сайта — из той же памяти.
      // Путь берём по куску «/data/…», а не по номеру папки: в адресе raw
      // название ветки само содержит косую черту и сбивает счёт.
      const serve = (r, q) => {
        const key = 'catalog/data/' + q.url().split('/data/')[1].split('?')[0];
        return fs.has(key)
          ? r.fulfill({ status: 200, contentType: 'application/json', body: fs.get(key) })
          : r.fulfill({ status: 404, body: 'no' });
      };
      await ctx.route('https://raw.githubusercontent.com/**', (r, q) => serve(r, q));
      await ctx.route('http://localhost:8123/data/**', (r, q) => serve(r, q));
    },
  };
}

(async () => {
  const b = await chromium.launch();
  const { chk, done } = runner('ПУБЛИКАЦИЯ ПО ЧАСТЯМ');
  const gh = fakeGithub();
  const ctx = await b.newContext({ viewport: { width: 390, height: 900 }, isMobile: true, hasTouch: true, serviceWorkers: 'block' });
  await ctx.addInitScript(() => localStorage.setItem('wm_gh_token', 'tok'));
  await gh.route(ctx);
  const page = await ctx.newPage();
  const errs = [];
  page.on('pageerror', (e) => errs.push(e.message));
  await page.goto('http://localhost:8123/', { timeout: 60000 });
  await page.waitForFunction(() => window.WM_PUBLISH, { timeout: 30000 });

  const load = (d) => page.evaluate((x) => {
    const P = window.WM_PUBLISH, s = P._state();
    s.products = x.products; s.prices = x.prices; s.sales = x.sales;
    s.groups = [{ id: 'g1', name: 'Товары' }]; s.suppliers = [{ id: 's1', name: 'Поставщик' }];
    s.staffPassword = 'staffpw';
    P.applyServerless('ownerpw');
  }, d);
  await load({ products, prices, sales });

  // ── 1. Первая публикация: уезжает весь каталог ──
  const first = await page.evaluate(() => window.WM_PUBLISH.publishFull('ownerpw'));
  const firstPaths = gh.commits[0] || [];
  chk(first && first.sha, `первая публикация прошла (файлов: ${firstPaths.length})`);
  chk(firstPaths.some((p) => /\/p\/00\.json$/.test(p)) && firstPaths.some((p) => /index\.json$/.test(p)),
    'витрина легла кусками и с описью');
  chk(firstPaths.some((p) => /sec\/products-00\.enc$/.test(p)) && firstPaths.some((p) => /secret-catalog\.enc$/.test(p)),
    'закрытый каталог тоже лёг кусками и с описью');

  // ── 2. Правка ОДНОГО товара: уезжают единицы файлов ──
  await page.evaluate(() => {
    const s = window.WM_PUBLISH._state();
    s.products.find((p) => p.id === 'p7').retail_price = 999;
  });
  await page.evaluate(() => window.WM_PUBLISH.publishFull('ownerpw'));
  const second = gh.commits[1] || [];
  console.log('--- второй раз уехало ---');
  second.forEach((p) => console.log('  ' + p));
  console.log('---');
  chk(second.length < firstPaths.length / 4,
    `после правки одного товара уезжает мало файлов: ${second.length} против ${firstPaths.length}`);
  chk(second.filter((p) => /\/p\/\d+\.json$/.test(p)).length === 1,
    'из витрины переписан ровно один кусок');
  chk(second.filter((p) => /sec\/products-\d+\.enc$/.test(p)).length === 1,
    'из закрытого каталога переписан ровно один кусок товаров');
  chk(!second.some((p) => /sec\/(prices|sales)-/.test(p)),
    'цены и продажи не переписывались — они не менялись');

  // ── 3. Прочитать обратно: из кусков собирается тот же каталог ──
  const back = await page.evaluate(async () => {
    const P = window.WM_PUBLISH, s = P._state();
    s.products = []; s.prices = []; s.sales = [];
    await P.unlockSecret('ownerpw');
    return {
      products: s.products.length, prices: s.prices.length, sales: s.sales.length,
      changed: (s.products.find((p) => p.id === 'p7') || {}).retail_price,
      groups: s.groups.length, staffPw: s.staffPassword,
    };
  });
  chk(back.products === N && back.prices === N && back.sales === 100,
    `каталог собрался из кусков полностью (товаров ${back.products}, цен ${back.prices}, продаж ${back.sales})`);
  chk(back.changed === 999, `правка на месте (цена ${back.changed})`);
  chk(back.groups === 1 && back.staffPw === 'staffpw', 'мелочь из описи (группы, пароль сотрудника) на месте');

  // ── 4. Вход сотрудника — по своему паролю и своим кускам ──
  const st = await page.evaluate(async () => {
    const P = window.WM_PUBLISH, s = P._state();
    s.products = []; s.prices = [];
    await P.unlockStaff('staffpw');
    return { products: s.products.length, prices: s.prices.length };
  });
  chk(st.products === N && st.prices === N, `сотрудник видит весь каталог (${st.products} товаров)`);

  // ── 5. Чужой пароль не открывает ──
  const wrong = await page.evaluate(async () => {
    try { await window.WM_PUBLISH.unlockSecret('нетакой'); return 'открылось'; } catch (e) { return 'отказ'; }
  });
  chk(wrong === 'отказ', 'неверный пароль каталог не открывает');

  // ── 6. Витрина без входа читается по частям ──
  const shop = await page.evaluate(async () => {
    const P = window.WM_PUBLISH, s = P._state();
    s.session = null; s.serverless = false; s.products = []; s.groups = [];
    await P.refresh({ silent: true });
    return { products: s.products.length, price7: (s.products.find((p) => p.id === 'p7') || {}).retail_price };
  });
  chk(shop.products === N, `витрина собралась из кусков (${shop.products} товаров)`);
  chk(shop.price7 === 999, 'в витрине свежая цена — куски и опись согласованы');

  // ── 7. Старый цельный файл всё ещё читается ──
  const legacy = await page.evaluate(async () => {
    const P = window.WM_PUBLISH;
    const old = await P.encryptJSON({ v: 1, products: [{ id: 'x1', name: 'Старый товар' }], groups: [] }, 'oldpw');
    window.__legacy = old;
    return old.length > 0;
  });
  gh.fs.set('catalog/data/secret-catalog.enc', await page.evaluate(() => window.__legacy));
  const readOld = await page.evaluate(async () => {
    const P = window.WM_PUBLISH, s = P._state();
    s.products = [];
    await P.unlockSecret('oldpw');
    return s.products.length && s.products[0].name;
  });
  chk(legacy && readOld === 'Старый товар', `каталог старого формата открывается как раньше (${readOld})`);

  chk(!errs.length, `нет сбоев JS (${errs.length}${errs.length ? ': ' + errs[0] : ''})`);
  await done(b);
})();

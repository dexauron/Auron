// Настоящие service worker и CacheStorage: одинаковые данные после смены ключа
// имеют прежний plaintext-hash, но ДРУГОЙ шифртекст. Старый кэш открывать нельзя.
const fs = require('node:fs');
const path = require('node:path');
const { chromium, runner } = require('./helpers');
const DP = (fs.readFileSync(path.join(__dirname, '..', 'js/config.js'), 'utf8').match(/DATA_PATH:\s*'([^']+)'/) || [, 'data'])[1];
let completed = false;
process.on('exit', (code) => { if (!completed && code === 0) { console.error('FAIL: сценарий не дошёл до конца'); process.exitCode = 1; } });

(async () => {
  const b = await chromium.launch();
  try {
    const { chk, done } = runner('ВХОД ПОСЛЕ СМЕНЫ КЛЮЧА С НАСТОЯЩИМ КЭШЕМ');
    const ctx = await b.newContext({ viewport: { width: 390, height: 900 }, serviceWorkers: 'allow' });
    const files = new Map(), blobs = new Map(); let seq = 0;
    const json = (v) => ({ status: 200, contentType: 'application/json', body: JSON.stringify(v) });
    await ctx.route('https://api.github.com/**', async (r, q) => {
      const p = new URL(q.url()).pathname, body = JSON.parse(q.postData() || '{}');
      if (/\/git\/ref\/heads\//.test(p)) return r.fulfill(json({ object: { sha: 'base' } }));
      if (q.method() === 'GET' && /\/git\/commits\//.test(p)) return r.fulfill(json({ tree: { sha: 'tree' } }));
      if (p.endsWith('/git/blobs')) { const sha = 'b' + (++seq); blobs.set(sha, body.content); return r.fulfill(json({ sha })); }
      if (p.endsWith('/git/trees')) {
        for (const e of body.tree) e.sha == null ? files.delete(e.path) : files.set(e.path, blobs.get(e.sha));
      }
      return r.fulfill(json({ sha: 'fixture-commit' }));
    });
    const serve = (r, q) => {
      const name = DP + '/' + q.url().split('/data/')[1].split('?')[0];
      return files.has(name) ? r.fulfill({ status: 200, contentType: 'application/json', body: files.get(name) })
        : r.fulfill({ status: 404, body: 'fixture missing' });
    };
    await ctx.route('https://raw.githubusercontent.com/**', serve);
    await ctx.route('http://localhost:8123/data/**', serve);
    await ctx.addInitScript(() => localStorage.setItem('wm_gh_token', 'fixture-token'));
    const page = await ctx.newPage(), errors = [];
    page.on('pageerror', (e) => errors.push(e.message));
    await page.goto('http://localhost:8123/');
    await page.waitForFunction(() => window.WM_PUBLISH && navigator.serviceWorker.controller, { timeout: 30000 });
    chk(await page.evaluate(() => !!navigator.serviceWorker.controller), 'настоящий service worker управляет страницей');
    await page.evaluate(async () => {
      const P = window.WM_PUBLISH, s = P._state();
      s.products = [{ id: 'p1', code: '001', name: 'Кэш-проверка', barcodes: ['001234'], photos: [], retail_price: 100 }];
      s.groups = []; s.suppliers = [{ id: 's1', name: 'Поставщик' }];
      s.prices = [{ product_id: 'p1', supplier_id: 's1', price: 50 }]; s.sales = [];
      s.staffPassword = 'old-staff-fixture'; s.requests = [{ id: 'owner-request' }];
      P.applyServerless('old-owner-fixture');
      await P.publishFull('old-owner-fixture');
      await P.unlockStaff('old-staff-fixture');
      await P.unlockSecret('old-owner-fixture');
      P.applyServerless('old-owner-fixture');
    });
    await page.waitForFunction(async () => (await (await caches.open('wm-data-v1')).keys()).filter((q) => q.url.includes('.enc?')).length >= 84);
    const oldUrls = await page.evaluate(async () => (await (await caches.open('wm-data-v1')).keys()).map((r) => r.url));
    chk(oldUrls.filter((u) => u.includes('.enc?')).length >= 84, 'части обеих ролей действительно сохранены в CacheStorage');
    const readHashes = (pw) => page.evaluate(async (x) => {
      const C = await import('./js/modules/catalog-crypto.js');
      const key = await C.importCatalogKey(await C.unwrapCatalogKey(x.keys.owner, x.pw, 'wm.catalog.v4/owner/key'));
      return (await C.keyDecrypt(key, x.body, 'wm.catalog.v4/owner/manifest')).sets.products.h;
    }, { pw, keys: JSON.parse(files.get(`${DP}/keys.json`)), body: files.get(`${DP}/catalog.enc`) });
    const beforeHashes = await readHashes('old-owner-fixture');
    const beforeKeys = files.get(`${DP}/keys.json`);
    await page.click('#adminBtn'); await page.click('#menuOwnerPass');
    await page.fill('#ownerPassNew', 'new-owner-fixture'); await page.fill('#ownerPassAgain', 'new-owner-fixture');
    await page.fill('#ownerPassStaff', 'new-staff-fixture'); await page.click('#ownerPassSubmit');
    await page.waitForFunction(() => document.getElementById('ownerPassSheet').hidden, { timeout: 30000 });
    chk(beforeKeys !== files.get(`${DP}/keys.json`), 'форма действительно сменила ключи обеих ролей');
    chk(JSON.stringify(beforeHashes) === JSON.stringify(await readHashes('new-owner-fixture')), 'хэши неизменённых товаров остались прежними после перешифрования');
    const restored = await page.evaluate(async () => {
      const P = await import('./js/modules/publish.js'); await P.rememberSession(); return P.restoreSession();
    });
    chk(restored, 'сохранённый вход читает части нового ключа поверх старого кэша');

    const logout = async () => {
      if (await page.evaluate(() => !!window.WM_PUBLISH._state().session)) {
        await page.click('#adminBtn');
        await Promise.all([page.waitForNavigation(), page.click('#menuLogout')]);
        await page.waitForFunction(() => window.WM_PUBLISH && !window.WM_PUBLISH._state().session);
      }
    };
    for (const [role, password] of [['owner', 'new-owner-fixture'], ['staff', 'new-staff-fixture']]) {
      await logout();
      if (await page.evaluate(() => document.getElementById('loginSheet').hidden)) await page.click('#adminBtn');
      await page.fill('#loginPassword', password); await page.click('#loginSubmit');
      await page.waitForFunction(() => window.WM_PUBLISH._state().session || !document.getElementById('loginError').hidden);
      const entered = await page.evaluate(() => {
        const s = window.WM_PUBLISH._state();
        return { session: !!s.session, owner: s.isAdmin, code: s.products[0]?.code, prices: (s.prices || []).length, requests: (s.requests || []).length };
      });
      chk(entered.session && entered.owner === (role === 'owner') && entered.code === '001' && entered.prices === 1
        && entered.requests === (role === 'owner' ? 1 : 0), `${role}: новый пароль работает через форму при наличии старых шифртекстов в кэше`);
    }
    await logout(); await page.click('#adminBtn');
    chk(await page.evaluate(() => document.getElementById('loginEmailWrap').hidden
      && /новый пароль/.test(document.getElementById('loginHint').textContent)), 'файловый вход не требует email и объясняет смену пароля');
    await page.fill('#loginPassword', 'old-owner-fixture'); await page.click('#loginSubmit');
    await page.waitForFunction(() => !document.getElementById('loginError').hidden);
    chk(await page.evaluate(() => /Пароль каталога не подошёл/.test(document.getElementById('loginError').textContent)
      && !window.WM_PUBLISH._state().session), 'старый пароль отклонён с отдельным сообщением');
    files.delete(`${DP}/catalog.enc`);
    await page.fill('#loginPassword', 'new-owner-fixture'); await page.click('#loginSubmit');
    await page.waitForFunction(() => window.WM_PUBLISH._state().session || !document.getElementById('loginError').hidden);
    chk(await page.evaluate(() => /Пароль принят/.test(document.getElementById('loginError').textContent)
      && !window.WM_PUBLISH._state().session && !window.WM_PUBLISH._state().isAdmin),
    'при пропавшей описи пароль признан верным, первая настройка и права не выданы');
    chk(!errors.length, `нет сбоев JS (${errors.join('; ')})`);
    completed = true;
    await done(b);
  } catch (e) { await b.close(); throw e; }
})().catch((e) => { console.error(e); process.exitCode = 1; });

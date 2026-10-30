// Запуск: вошедший человек сразу в своём аккаунте, даже при плохом интернете.
/* Владелец: «когда я закрываю приложение и открываю, сразу показывает, как
 * будто я не вошёл, потом загружается всё и уже в моём аккаунте».
 *
 * Так и было. Запуск сперва спрашивал у сети файл ключей и только потом
 * поднимал роль. Замер на этом же наборе до правки: при задержке ответа 3 с
 * владелец видел кнопку «Войти» и гостевые блоки больше шести секунд, а
 * аккаунт не появлялся вовсе.
 *
 * Теперь вход поднимается из копии на устройстве, без единого запроса в сеть,
 * и только потом идёт проверка и обновление. Набор держит именно это: гостевой
 * экран не должен мелькнуть НИ РАЗУ.
 *
 * Куски каталога забирает service worker — его запросы Playwright подменяет
 * только с этим флагом (см. tests/auth-cache.js). */
process.env.PW_EXPERIMENTAL_SERVICE_WORKER_NETWORK_EVENTS = '1';

const fs = require('node:fs');
const path = require('node:path');
const { chromium, runner } = require('./helpers');

const DP = (fs.readFileSync(path.join(__dirname, '..', 'js/config.js'), 'utf8').match(/DATA_PATH:\s*'([^']+)'/) || [, 'data'])[1];
const SLOW = 3000;        // «очень плохой интернет»: ответ через три секунды
const CEILING = 1500;     // аккаунт обязан подняться быстрее, чем ответит сеть

let completed = false;
process.on('exit', (code) => { if (!completed && code === 0) { console.error('FAIL: сценарий не дошёл до конца'); process.exitCode = 1; } });

// Что видно на экране прямо сейчас — глазами человека, а не кода.
const look = (page) => page.evaluate(() => {
  const label = document.getElementById('adminBtnLabel');
  const S = window.WM_PUBLISH ? window.WM_PUBLISH._state() : null;
  return {
    entered: !!(S && S.session),
    loginVisible: !!(label && !label.hidden && label.offsetParent !== null),
    guestBlocks: document.querySelectorAll('.guest-only:not([hidden])').length,
    cards: document.querySelectorAll('#productGrid .card').length,
  };
}).catch(() => null);

/* Снимаем экран подряд от самого открытия: мелькание меньше сотой секунды
   человек не заметит, а вот полсекунды — заметит, и нам нужно поймать именно
   это. Останавливаемся, как только аккаунт поднялся. */
async function watch(page, ms = 8000) {
  const t0 = Date.now();
  const frames = [];
  while (Date.now() - t0 < ms) {
    const shot = await look(page);
    if (shot) frames.push({ at: Date.now() - t0, ...shot });
    if (shot && shot.entered) break;
    await new Promise((r) => setTimeout(r, 25));
  }
  const guest = frames.filter((f) => !f.entered && (f.loginVisible || f.guestBlocks));
  const entered = frames.find((f) => f.entered);
  return { frames, guest, enteredAt: entered ? entered.at : null, first: frames[0] || {} };
}

(async () => {
  const b = await chromium.launch();
  try {
    const { chk, done } = runner('ЗАПУСК: СРАЗУ В СВОЁМ АККАУНТЕ');
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
    let net = 'fast';        // fast | slow | dead
    const serve = async (r, q) => {
      if (net === 'dead') return r.abort('internetdisconnected');
      const name = DP + '/' + q.url().split('/data/')[1].split('?')[0];
      if (net === 'slow') await new Promise((res) => setTimeout(res, SLOW));
      return files.has(name) ? r.fulfill({ status: 200, contentType: 'application/json', body: files.get(name) })
        : r.fulfill({ status: 404, body: 'fixture missing' });
    };
    await ctx.route('https://raw.githubusercontent.com/**', serve);
    await ctx.route('http://localhost:8123/data/**', serve);
    await ctx.addInitScript(() => localStorage.setItem('wm_gh_token', 'fixture-token'));
    const page = await ctx.newPage();
    const errs = [];
    page.on('pageerror', (e) => errs.push(e.message));

    // ── владелец настраивает каталог и входит, как в жизни ──
    await page.goto('http://localhost:8123/');
    await page.waitForFunction(() => window.WM_PUBLISH, { timeout: 30000 });
    await page.evaluate(async () => {
      const P = window.WM_PUBLISH, s = P._state();
      s.products = Array.from({ length: 40 }, (_, i) => ({ id: 'p' + i, code: String(100 + i),
        name: 'Товар ' + i, barcodes: [], photos: [], retail_price: 50 + i, stock: 5 }));
      s.groups = []; s.suppliers = [{ id: 's1', name: 'Поставщик' }];
      s.prices = [{ product_id: 'p0', supplier_id: 's1', price: 30 }]; s.sales = [];
      s.staffPassword = 'fixture-staff-password-long';
      P.applyServerless('fixture-owner-password-long');
      await P.publishFull('fixture-owner-password-long');
      await P.unlockSecret('fixture-owner-password-long');
      P.applyServerless('fixture-owner-password-long');
      await (await import('./js/modules/publish.js')).rememberSession();
      document.querySelectorAll('.sheet-backdrop').forEach((n) => { n.hidden = true; });
    });

    // ── 1. Закрыл и открыл при очень плохом интернете ──
    net = 'slow';
    await page.goto('http://localhost:8123/');
    const slow = await watch(page);
    chk(slow.enteredAt !== null && slow.enteredAt < CEILING,
      `аккаунт поднимается, не дожидаясь сети (${slow.enteredAt} мс, потолок ${CEILING}, сеть отвечает за ${SLOW})`);
    chk(!slow.guest.length,
      `гостевой экран не мелькнул ни разу (кадров с «Войти» или гостевыми блоками: ${slow.guest.length})`);
    chk(slow.first.cards > 0, `товары из своей копии видны с первого кадра (${slow.first.cards})`);
    chk(await page.evaluate(() => window.WM_PUBLISH._state().isAdmin), 'права владельца на месте');
    chk(await page.evaluate(() => window.WM_PUBLISH._state().prices.length > 0),
      'закупочные цены из своей копии на месте — это рабочий инструмент, а не витрина');

    // ── 2. Интернета нет совсем ──
    net = 'dead';
    await page.goto('http://localhost:8123/');
    const dead = await watch(page, 5000);
    chk(dead.enteredAt !== null && dead.enteredAt < CEILING,
      `без интернета каталог открывается в аккаунте (${dead.enteredAt} мс)`);
    chk(!dead.guest.length, 'без интернета гостевой экран тоже не мелькает');

    // ── 3. Владелец правит каталог с другого устройства ──
    /* Этот телефон открыт и ничего не знает о правке. Проверяем, что при
       возврате в каталог он подтянет свежее сам — без пароля и перезагрузки.
       Второе устройство изображает вторая страница: тот же магазин, своя
       память приложения. */
    net = 'fast';
    const mine = await page.evaluate(async () => {
      const P = await import('./js/modules/publish.js');
      return P.recheckAccess();        // подтверждаем вход и получаем опись
    });
    chk(mine === 'ok', `связь появилась — вход подтверждён (${mine})`);

    const other = await ctx.newPage();
    await other.goto('http://localhost:8123/');
    await other.waitForFunction(() => window.WM_PUBLISH?._state().session, { timeout: 30000 });
    await other.evaluate(async () => {
      const P = await import('./js/modules/publish.js');
      await P.recheckAccess();
      const S = await import('./js/modules/store.js');
      S.state.products.find((p) => p.id === 'p0').name = 'Товар изменён';
      await P.publishFull(null);
    });
    await other.close();

    const picked = await page.evaluate(async () => {
      const P = await import('./js/modules/publish.js');
      const verdict = await P.recheckAccess(true);
      const S = await import('./js/modules/store.js');
      return { verdict, name: S.state.products.find((p) => p.id === 'p0')?.name, warn: S.state.sessionWarning || '' };
    });
    chk(picked.verdict === 'ok' && /изменён/.test(picked.name || ''),
      `правка с другого устройства подхватилась сама (${picked.verdict}, «${picked.name}»)`);
    chk(!picked.warn, 'и предупреждение «показана сохранённая копия» снято');

    chk(!errs.length, `нет сбоев JS (${errs.length ? errs.join('; ') : '0'})`);
    completed = true;
    await done(b);
  } catch (e) { await b.close(); throw e; }
})().catch((e) => { console.error(e); process.exitCode = 1; });

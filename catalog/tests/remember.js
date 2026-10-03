/* Каталог помнит, кто вошёл — и помнит, когда это было.
 *
 * Жалоба владельца: «каталог не запоминает, когда зашли и когда вышли».
 * Так и было: запомнить вход умели только владелец и бухгалтер, а сотрудник
 * зала набирал код у полки заново при каждом открытии. Журнала входов не
 * существовало ни у одной роли.
 */
const { chromium, newPage, runner } = require('./helpers');

const products = [{ id: 'p1', name: 'Молоко 1л', code: '101', group_id: 'g1', retail_price: 89, unit: 'шт', photos: [], barcodes: [] }];
const groups = [{ id: 'g1', name: 'Молочное' }];

(async () => {
  const b = await chromium.launch();
  const { chk, done } = runner('КАТАЛОГ ПОМНИТ ВХОД');
  const { ctx, page, errs } = await newPage(b, { products, groups });

  // ── 1. Владелец: вход запомнен и записан в журнал ──
  await page.evaluate(() => {
    const P = window.WM_PUBLISH; P.ghSetToken('tok'); P.applyServerless('pw');
  });
  await page.waitForTimeout(300);
  const own = await page.evaluate(() => ({
    saved: JSON.parse(localStorage.getItem('wm_sv_auth') || 'null'),
    log: JSON.parse(localStorage.getItem('wm_session_log_v1') || '[]'),
  }));
  chk(own.saved && own.saved.role === 'owner', `вход владельца запомнен (${own.saved && own.saved.role})`);
  chk(own.log.length === 1 && own.log[0].event === 'in' && own.log[0].role === 'owner',
    `в журнале записан вход владельца (${JSON.stringify(own.log[0] || {})})`);

  // ── 2. Сотрудник зала: вход тоже запоминается ──
  await page.evaluate(() => {
    localStorage.removeItem('wm_sv_auth'); localStorage.removeItem('wm_session_log_v1');
    window.WM_PUBLISH._rememberFloor('кодзала123');
  });
  const floor = await page.evaluate(() => ({
    saved: JSON.parse(localStorage.getItem('wm_sv_auth') || 'null'),
    log: JSON.parse(localStorage.getItem('wm_session_log_v1') || '[]'),
  }));
  chk(floor.saved && floor.saved.role === 'zal', `вход сотрудника зала запомнен (${floor.saved && floor.saved.role})`);
  chk(floor.log.length === 1 && floor.log[0].role === 'zal', 'и записан в журнал');

  // ── 3. Открыли каталог заново — код заново не спрашивают ──
  const page2 = await ctx.newPage();
  const errs2 = [];
  page2.on('pageerror', (e) => errs2.push(e.message));
  await page2.goto('http://localhost:8123/', { timeout: 60000 });
  await page2.waitForFunction(() => window.WM_PUBLISH, { timeout: 30000 });
  await page2.waitForTimeout(1200);
  const again = await page2.evaluate(() => {
    const s = window.WM_PUBLISH._state();
    return { role: s.role, session: !!s.session, entry: document.getElementById('entryChoiceSheet').hidden };
  });
  /* Данные зала (floor.enc) в проверке подменены на 404, поэтому роль не
     поднимется — но важно другое: приложение ПОПЫТАЛОСЬ войти запомненным
     кодом, а не выбросило человека к форме. Это и проверяем. */
  chk(again.entry === true, 'при открытии каталога форма входа не выскакивает');
  chk(errs2.length === 0, `нет сбоев при восстановлении (${errs2[0] || 0})`);

  // ── 4. Повторный вход не плодит одинаковых строк в журнале ──
  const twice = await page.evaluate(() => {
    const P = window.WM_PUBLISH;
    P.applyServerless('pw'); P.applyServerless('pw'); P.applyServerless('pw');
    return JSON.parse(localStorage.getItem('wm_session_log_v1') || '[]');
  });
  chk(twice.filter((x) => x.role === 'owner' && x.event === 'in').length === 1,
    `запуск приложения не плодит одинаковых записей (${twice.length} всего)`);

  // ── 5. Выход записан ──
  const out = await page.evaluate(async () => {
    document.querySelectorAll('.sheet-backdrop:not([hidden])').forEach((x) => { x.hidden = true; });
    window.WM_PUBLISH._logSession('out', 'owner');
    return JSON.parse(localStorage.getItem('wm_session_log_v1') || '[]');
  });
  chk(out[0] && out[0].event === 'out', `выход записан в журнал (${out[0] && out[0].event})`);

  // ── 6. Журнал виден владельцу человеческими словами ──
  const shown = await page.evaluate(async () => {
    window.WM_PUBLISH._openDevice();
    await new Promise((r) => setTimeout(r, 400));
    return (document.getElementById('devSessions') || {}).innerText || '';
  });
  chk(/Владелец/.test(shown), `в «Это устройство» журнал показан ролями, а не служебными словами (${shown.slice(0, 60).replace(/\n/g, ' ')})`);
  chk(!/owner|zal|staff/.test(shown), 'служебных слов на экране нет');
  chk(/вышел/.test(shown) && /вошёл/.test(shown), 'видно и вход, и выход');

  // ── 7. Сменённый пароль снимает запомненную роль при доступной сети ──
  await page.evaluate(() => window.WM_PUBLISH.applyStaff('старый-пароль'));
  let keyReads = 0;
  await ctx.route('**/data/keys.json*', (route) => {
    keyReads++;
    route.fulfill({ status: 200, contentType: 'application/json', body: '{"staff":{}}' });
  });
  const page3 = await ctx.newPage();
  const errs3 = [];
  page3.on('pageerror', (e) => errs3.push(e.message));
  await page3.goto('http://localhost:8123/', { timeout: 60000 });
  await page3.waitForFunction(() => window.WM_PUBLISH
    && !localStorage.getItem('wm_sv_auth') && !window.WM_PUBLISH._state().session,
  null, { timeout: 15000 });
  const revoked = await page3.evaluate(() => ({
    saved: localStorage.getItem('wm_sv_auth'),
    role: window.WM_PUBLISH._state().role,
    session: !!window.WM_PUBLISH._state().session,
  }));
  chk(keyReads > 0, 'новые ключи были прочитаны перед отзывом роли');
  chk(!revoked.saved && !revoked.session && !revoked.role,
    `старый пароль снят, роль не осталась (${JSON.stringify(revoked)})`);
  chk(errs3.length === 0, `нет сбоев при отзыве роли (${errs3[0] || 0})`);

  chk(errs.length === 0, `нет сбоев JS (${errs.length}${errs.length ? ': ' + errs[0] : ''})`);
  await done(b);
})();

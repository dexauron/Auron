// Один вход. Раньше дверей было две: «Войти» в шапке и «Я сотрудник» под
// поиском — покупателю лишние обе, а сотруднику непонятно, какая его.
// Теперь одна кнопка спрашивает, кто пришёл, и открывает нужную форму.
const { chromium, newPage, runner } = require('./helpers');

const products = [{ id: 'p1', name: 'Молоко 1л', code: '101', group_id: 'g1', retail_price: 89, unit: 'шт', photos: [], barcodes: ['4600000000011'] }];
const groups = [{ id: 'g1', name: 'Молочное' }];

const sheets = (page) => page.evaluate(() => ({
  choice: !document.getElementById('entryChoiceSheet').hidden,
  floor: !document.getElementById('floorLoginSheet').hidden,
  owner: !document.getElementById('loginSheet').hidden,
}));
const closeAll = (page) => page.evaluate(() => {
  document.querySelectorAll('.sheet-backdrop').forEach((x) => { x.hidden = true; });
});

(async () => {
  const b = await chromium.launch();
  const { chk, done } = runner('ОДИН ВХОД');
  const { page, errs } = await newPage(b, { products, groups });

  // ── покупатель видит ровно одну дверь ──
  const doors = await page.evaluate(() => ({
    old: !!document.getElementById('floorLoginBtn'),
    admin: !document.getElementById('adminBtn').hidden,
    label: (document.getElementById('adminBtnLabel') || {}).textContent,
  }));
  chk(!doors.old, 'второй кнопки «Я сотрудник» под поиском больше нет');
  chk(doors.admin && /Войти/.test(doors.label || ''), `дверь одна — «${doors.label}»`);

  // ── нажал «Войти» → спрашиваем, кто пришёл ──
  await page.click('#adminBtn'); await page.waitForTimeout(400);
  let s = await sheets(page);
  chk(s.choice && !s.floor && !s.owner, 'нажал «Войти» — спрашиваем, кто пришёл');
  const opts = await page.evaluate(() => [...document.querySelectorAll('#entryChoiceSheet .entry-choice-option')]
    .map((x) => (x.textContent || '').replace(/\s+/g, ' ').trim()));
  chk(opts.length === 2 && /Сотрудник зала/.test(opts[0]) && /Владелец|бухгалтер/.test(opts[1]),
    `два понятных варианта (${opts.join(' | ')})`);

  // ── «Сотрудник зала» → форма кода ──
  await page.click('#entryChoiceFloor'); await page.waitForTimeout(400);
  s = await sheets(page);
  chk(!s.choice && s.floor && !s.owner, 'выбрал «Сотрудник зала» — открылась форма кода');

  // ── «Владелец или бухгалтер» → форма аккаунта ──
  await closeAll(page);
  await page.click('#adminBtn'); await page.waitForTimeout(400);
  await page.click('#entryChoiceOwner'); await page.waitForTimeout(400);
  s = await sheets(page);
  chk(!s.choice && !s.floor && s.owner, 'выбрал «Владелец или бухгалтер» — открылась форма аккаунта');

  // ── вошедший сотрудник попадает в меню, а не в выбор входа ──
  await closeAll(page);
  await page.evaluate(() => { const P = window.WM_PUBLISH; P.ghSetToken('tok'); P.applyServerless('pw'); });
  await page.waitForTimeout(300);
  await page.click('#adminBtn'); await page.waitForTimeout(400);
  const after = await page.evaluate(() => ({
    choice: !document.getElementById('entryChoiceSheet').hidden,
    menu: !document.getElementById('adminMenuSheet').hidden,
  }));
  chk(!after.choice && after.menu, 'вошедшему та же кнопка открывает меню, а не вход');

  chk(errs.length === 0, `нет сбоев JS (${errs.length}${errs.length ? ': ' + errs[0] : ''})`);
  await done(b);
})();

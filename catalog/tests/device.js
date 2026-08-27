// Каждое устройство помнит свои настройки: вид списка, раздел, тему,
// избранное, фильтры. Ничего не улетает на сервер и не мешает другому телефону.
const { chromium, newPage, asOwner, runner } = require('./helpers');

const products = [...Array(6)].map((_, i) => ({
  id: 'p' + i, name: 'Товар ' + i, code: String(1300 + i), group_id: 'g1',
  retail_price: 40 + i, is_weighted: false, unit: 'шт', photos: [], created_at: '2026-01-01',
}));
const groups = [{ id: 'g1', name: 'Продукты', sort_order: 1 }];

(async () => {
  const b = await chromium.launch();
  const { chk, done } = runner('НАСТРОЙКИ УСТРОЙСТВА');

  // ── ПЕРВОЕ устройство: меняем настройки ──
  const one = await newPage(b, { products, groups });
  // настройки вида — история сотрудника: входим, иначе каталог в режиме
  // покупателя и переключателя вида там нет
  await asOwner(one.page, {});
  await one.page.waitForTimeout(400);
  await one.page.click('#viewToggleBtn');                       // плотные
  await one.page.click('#viewToggleBtn'); await one.page.waitForTimeout(300);   // список
  await one.page.click('.tabbar [data-tab="cats"]'); await one.page.waitForTimeout(300);
  await one.page.click('#themeBtn'); await one.page.waitForTimeout(200);
  const set = await one.page.evaluate(() => ({
    view: window.WM_PUBLISH._state().view,
    tab: window.WM_PUBLISH._state().tab,
    theme: document.documentElement.getAttribute('data-theme'),
  }));
  chk(set.view === 'list' && set.tab === 'cats', `настройки выставлены (вид «${set.view}», раздел «${set.tab}»)`);

  // перезагрузка того же устройства — всё на месте
  await one.page.reload({ waitUntil: 'load' });
  await one.page.waitForFunction(() => window.WM_PUBLISH, { timeout: 30000 });
  await one.page.waitForTimeout(900);
  const after = await one.page.evaluate(() => ({
    view: window.WM_PUBLISH._state().view,
    tab: window.WM_PUBLISH._state().tab,
    theme: document.documentElement.getAttribute('data-theme'),
    listShown: !!document.querySelector('#productGrid.list, #catScreen:not([hidden])'),
  }));
  chk(after.view === 'list', `после перезагрузки вид списка сохранился (${after.view})`);
  chk(after.tab === 'cats', `и открытый раздел тоже (${after.tab})`);
  chk(after.theme === set.theme, `и тема (${after.theme})`);

  // ── ВТОРОЕ устройство: свои настройки, чужие не подхватывает ──
  const two = await newPage(b, { products, groups });
  await two.page.waitForTimeout(600);
  const fresh = await two.page.evaluate(() => ({
    view: window.WM_PUBLISH._state().view,
    tab: window.WM_PUBLISH._state().tab,
  }));
  chk(fresh.view === 'normal' && fresh.tab === 'catalog',
    `другое устройство начинает со своих настроек (вид «${fresh.view}», раздел «${fresh.tab}»)`);

  // ── экран «Это устройство» ──
  // Путь человека: кнопка входа в шапке → «Настройки этого устройства».
  // Раньше сюда вела вкладка «Ещё», теперь на её месте «Фильтры».
  const openDevice = async (page) => {
    await page.click('#adminBtn'); await page.waitForTimeout(350);
    await page.click('#loginDevice'); await page.waitForTimeout(450);
  };
  await openDevice(two.page);
  const dev = await two.page.evaluate(() => ({
    open: !document.getElementById('deviceSheet').hidden,
    txt: document.getElementById('devList').innerText.replace(/\s+/g, ' ').trim(),
    hasLogin: !!document.getElementById('devLogin'),
  }));
  console.log('--- что помнит устройство ---\n' + dev.txt + '\n---');
  chk(dev.open, 'настройки устройства открываются из окна входа');
  chk(dev.hasLogin, 'кнопка входа тут же — человек не упирается в тупик');
  for (const row of ['Вход', 'Вид списка', 'Тема', 'Избранное', 'Фильтры']) {
    chk(dev.txt.includes(row), `видно, что запомнено: «${row}»`);
  }

  // имя устройства
  await two.page.fill('#devName', 'Касса 1');
  await two.page.dispatchEvent('#devName', 'change'); await two.page.waitForTimeout(300);
  await two.page.reload({ waitUntil: 'load' });
  await two.page.waitForFunction(() => window.WM_PUBLISH, { timeout: 30000 });
  await two.page.waitForTimeout(700);
  await openDevice(two.page);
  chk(await two.page.evaluate(() => document.getElementById('devName').value) === 'Касса 1',
    'название устройства запомнилось');
  chk(await one.page.evaluate(() => { try { return localStorage.getItem('wm_device_name'); } catch (e) { return null; } }) === null,
    'имя, заданное на одном телефоне, не появилось на другом');

  // ── сброс чистит настройки, но не выкидывает сохранённый каталог ──
  await two.page.evaluate(() => {
    try { localStorage.setItem('wm_catalog', '{"x":1}'); localStorage.setItem('wm_gh_token', 'tok'); } catch (e) { /* */ }
    document.getElementById('deviceSheet').hidden = true;      // экран перекрывает кнопки
  });
  await two.page.waitForTimeout(200);
  // второй телефон тоже «сотрудник»: у покупателя переключателя вида нет
  await asOwner(two.page, {});
  await two.page.waitForTimeout(200);
  await two.page.click('#viewToggleBtn'); await two.page.waitForTimeout(200);
  await openDevice(two.page);
  await two.page.click('#devReset'); await two.page.waitForTimeout(500);
  const reset = await two.page.evaluate(() => ({
    view: window.WM_PUBLISH._state().view,
    name: localStorage.getItem('wm_device_name'),
    cache: localStorage.getItem('wm_catalog'),
    token: localStorage.getItem('wm_gh_token'),
  }));
  chk(reset.view === 'normal', `сброс вернул обычный вид (${reset.view})`);
  chk(reset.name === null, 'название устройства сброшено');
  chk(reset.cache === '{"x":1}', 'сохранённый каталог для работы без связи НЕ стёрт');
  chk(reset.token === 'tok', 'ключ публикации НЕ стёрт — иначе владелец потерял бы доступ');

  chk(!one.errs.length && !two.errs.length, `нет сбоев JS (${one.errs.length + two.errs.length})`);
  await done(b);
})();

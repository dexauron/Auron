// Экран «Работа»: дела смены (заказы, «закончилось», сравнение, сканер)
// вынесены из меню в нижнюю панель — и сразу показывают состояние дел.
const { chromium, newPage, asOwner, runner } = require('./helpers');

const products = [{ id: 'p1', name: 'Молоко', code: '101', group_id: 'g1', retail_price: 89, unit: 'шт', photos: [], barcodes: [], supplier_ids: ['s1'] }];
const groups = [{ id: 'g1', name: 'Молочные' }];
const suppliers = [{ id: 's1', name: 'Молзавод' }];

const local = (d) => new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 10);
const monday = () => { const d = new Date(); d.setDate(d.getDate() - ((d.getDay() + 6) % 7)); return d; };
const iso = (shift) => { const d = monday(); d.setDate(d.getDate() + shift); return local(d); };

const openWork = (page) => page.evaluate(async () => {
  document.querySelectorAll('.sheet-backdrop:not([hidden])').forEach((s) => { s.hidden = true; });
  document.querySelector('.tabbar [data-tab="work"]').click();
  await new Promise((r) => setTimeout(r, 350));
});

(async () => {
  const b = await chromium.launch();
  const { chk, done } = runner('ЭКРАН «РАБОТА»');
  const { page, errs } = await newPage(b, { products, groups });

  // 1. Без входа — экран объясняет, что это для сотрудников, и предлагает войти
  await openWork(page);
  const guest = await page.evaluate(() => ({
    open: !document.getElementById('workSheet').hidden,
    text: document.getElementById('workBody').innerText.replace(/\s+/g, ' '),
    login: !!document.querySelector('[data-work="login"]'),
  }));
  chk(guest.open, 'вкладка «Работа» открывает свой экран');
  chk(guest.login && /для сотрудников/.test(guest.text), `без входа предлагается войти (${guest.text.slice(0, 45)})`);

  const toLogin = await page.evaluate(async () => {
    document.querySelector('[data-work="login"]').click();
    await new Promise((r) => setTimeout(r, 400));
    return { work: document.getElementById('workSheet').hidden, login: !document.getElementById('loginSheet').hidden };
  });
  chk(toLogin.work && toLogin.login, 'кнопка «Войти» ведёт на вход');

  // 2. После входа — состояние дел прямо в строках
  await asOwner(page, { suppliers });
  await page.evaluate(async (due) => {
    const P = window.WM_PUBLISH;
    const s = P._state();
    s.orders = [
      { id: 'o1', status: 'ordered', supplier_id: 's1', supplier_name: 'Молзавод', placed_at: due.now, due_at: due.now, amount: 12000, who: 'Анна' },
      { id: 'o2', status: 'ordered', supplier_id: 's1', supplier_name: 'Молзавод', placed_at: due.past, due_at: due.past, amount: 3000, who: 'Пётр' },
    ];
    localStorage.setItem('wm_restock_v1', JSON.stringify([
      { id: 'p1', name: 'Молоко', code: '101', supplier_id: 's1', supplier_name: 'Молзавод', who: '', at: due.now },
    ]));
    P.renderAll();
    await new Promise((r) => setTimeout(r, 200));
    // воскресенье этой недели: не раньше «сегодня» в любой день запуска,
    // поэтому поставка считается будущей, а не просроченной
  }, { now: iso(6), past: iso(-9) });

  await openWork(page);
  const work = await page.evaluate(() => {
    const box = document.getElementById('workBody');
    const row = (w) => { const el = box.querySelector(`[data-work="${w}"]`); return el ? el.innerText.replace(/\s+/g, ' ') : ''; };
    return {
      orders: row('orders'), restock: row('restock'), scan: row('scan'),
      late: (box.querySelector('.ord-late') || {}).textContent || '',
      badge: document.getElementById('tabWorkCount').textContent,
      badgeShown: !document.getElementById('tabWorkCount').hidden,
    };
  });
  chk(/1 поставка/.test(work.orders) && /12\s?000/.test(work.orders.replace(/ /g, ' ')),
    `видно, сколько поставок на неделе и на какую сумму (${work.orders})`);
  chk(work.late === '1', `просроченная поставка вынесена отдельно (${work.late})`);
  chk(/1 ждёт заказа/.test(work.restock), `видно, сколько позиций ждёт заказа (${work.restock})`);
  chk(/Сканировать/.test(work.scan), 'сканер открывается отсюда же');
  chk(work.badgeShown && work.badge === '2', `на вкладке значок «сколько дел» (${work.badge})`);

  // 3. Строки ведут туда, куда обещают
  for (const [what, sheet] of [['orders', 'ordersSheet'], ['restock', 'restockSheet']]) {
    await openWork(page);
    const ok = await page.evaluate(async (w) => {
      document.querySelector(`[data-work="${w}"]`).click();
      await new Promise((r) => setTimeout(r, 450));
      return { work: document.getElementById('workSheet').hidden, ids: [...document.querySelectorAll('.sheet-backdrop:not([hidden])')].map((x) => x.id) };
    }, what);
    chk(ok.work && ok.ids.includes(sheet), `«${what}» открывает свой экран (${ok.ids.join(',')})`);
  }

  chk(!errs.length, `нет сбоев JS (${errs.length}${errs.length ? ': ' + errs[0] : ''})`);
  await done(b);
})();

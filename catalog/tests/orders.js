// Заказы поставщикам: кто, у кого, на сколько, когда придёт — и неделя, по
// которой видно, какие дни загружены. Сотрудник записывает заказ на своём
// телефоне (в общий каталог он писать не может), владелец — сразу в каталог.
const { chromium, newPage, asOwner, runner } = require('./helpers');

const products = [{ id: 'p1', name: 'Молоко', code: '101', group_id: 'g1', retail_price: 89, unit: 'шт', photos: [], supplier_ids: ['s1'] }];
const groups = [{ id: 'g1', name: 'Молочные' }];
const suppliers = [{ id: 's1', name: 'Молзавод' }, { id: 's2', name: 'Хлебозавод' }];

/* Даты считаем от ПОНЕДЕЛЬНИКА текущей недели, а не от «сегодня + N»: иначе в
 * пятницу «сегодня + 3» уезжает на следующую неделю, и проверка падает не
 * из-за кода, а из-за дня, в который её запустили. */
const local = (d) => new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 10);
const monday = () => { const d = new Date(); d.setDate(d.getDate() - ((d.getDay() + 6) % 7)); return d; };
const iso = (shift) => { const d = monday(); d.setDate(d.getDate() + shift); return local(d); };

(async () => {
  const b = await chromium.launch();
  const { chk, done } = runner('ЗАКАЗЫ ПОСТАВЩИКАМ');
  const { page, errs } = await newPage(b, { products, groups });
  await asOwner(page, { suppliers });
  await page.waitForTimeout(300);

  const openOrders = async () => {
    await page.evaluate(() => document.querySelectorAll('.sheet-backdrop:not([hidden])').forEach((s) => { s.hidden = true; }));
    await page.evaluate(() => document.getElementById('adminBtn').click());
    await page.waitForTimeout(250);
    await page.evaluate(() => window.WM_PUBLISH._work('orders'));
    await page.waitForTimeout(400);
  };
  await openOrders();
  const empty = await page.evaluate(() => ({
    open: !document.getElementById('ordersSheet').hidden,
    days: document.querySelectorAll('#ordersBody [data-ord-day]').length,
    text: document.getElementById('ordersBody').innerText.replace(/\s+/g, ' '),
  }));
  chk(empty.open && empty.days === 7, `экран заказов показывает неделю (${empty.days} дней)`);
  chk(/поставок нет/i.test(empty.text), 'пустая неделя так и говорит');

  const add = (sup, amount, due, who) => page.evaluate(async (d) => {
    document.getElementById('ordAdd').click();
    await new Promise((r) => setTimeout(r, 300));
    document.getElementById('ordSupplier').value = d.sup;
    document.getElementById('ordAmount').value = d.amount;
    document.getElementById('ordDue').value = d.due;
    document.getElementById('ordWho').value = d.who;
    document.getElementById('ordSave').click();
    await new Promise((r) => setTimeout(r, 700));
    return window.WM_PUBLISH._state().orders.length;
  }, { sup, amount, due, who });

  await add('s1', 12000, iso(1), 'Анна');
  await add('s2', 3500, iso(1), 'Пётр');
  const n3 = await add('s1', 7000, iso(2), 'Анна');
  chk(n3 === 3, `заказы сохраняются в каталог владельца (${n3})`);

  const week = await page.evaluate(() => {
    const box = document.getElementById('ordersBody');
    const days = [...box.querySelectorAll('[data-ord-day]')].map((d) => ({
      date: d.dataset.ordDay,
      bar: parseInt(d.querySelector('.ord-bar').style.height || '0', 10),
    }));
    return { days, total: box.querySelector('.ord-total').innerText.replace(/\s+/g, ' '), rows: box.querySelectorAll('[data-ord-open]').length };
  });
  chk(week.days.filter((d) => d.bar > 0).length === 2, `загруженные дни выделены столбиками (${week.days.filter((d) => d.bar > 0).length} из 7)`);
  const busiest = week.days.reduce((m, d) => (d.bar > m.bar ? d : m), week.days[0]);
  chk(busiest.date === iso(1), `самый загруженный — день с двумя заказами (${busiest.date})`);
  chk(/22\s?500/.test(week.total.replace(/ /g, ' ')), `итог недели считается верно (${week.total})`);
  chk(week.rows === 3, `в списке все три поставки (${week.rows})`);

  const amounts = await page.evaluate(() => [...document.querySelectorAll('#ordersBody [data-ord-open] .ios-row-value')].map((x) => x.textContent.replace(/\s/g, '')));
  chk(amounts.some((a) => /12\D?000/.test(a)) && amounts.some((a) => /3\D?500/.test(a)), `у каждого заказа своя сумма (${amounts.join(' | ')})`);
  const rowText = await page.evaluate(() => document.querySelector('#ordersBody [data-ord-open]').innerText.replace(/\s+/g, ' '));
  chk(/Анна|Пётр/.test(rowText), `видно, кто заказал и когда придёт (${rowText.slice(0, 60)})`);

  const received = await page.evaluate(async () => {
    document.querySelector('#ordersBody [data-ord-open]').click();
    await new Promise((r) => setTimeout(r, 350));
    document.getElementById('ordReceived').click();
    await new Promise((r) => setTimeout(r, 700));
    return window.WM_PUBLISH._state().orders.filter((o) => o.status === 'received').length;
  });
  chk(received === 1, `заказ можно отметить пришедшим (${received})`);

  // заказ, сохранённый на другую неделю, не должен пропадать с глаз
  const jump = await page.evaluate(async (due) => {
    document.getElementById('ordAdd').click();
    await new Promise((r) => setTimeout(r, 300));
    document.getElementById('ordSupplier').value = 's2';
    document.getElementById('ordAmount').value = '500';
    document.getElementById('ordDue').value = due;
    document.getElementById('ordSave').click();
    await new Promise((r) => setTimeout(r, 700));
    return document.getElementById('ordersBody').innerText.includes('500');
  }, iso(9));
  chk(jump, 'заказ на другую неделю не теряется — календарь сам туда переходит');

  const staff = await page.evaluate(async () => {
    const P = window.WM_PUBLISH;
    P.applyStaff('staffpw');
    await new Promise((r) => setTimeout(r, 200));
    document.getElementById('adminBtn').click();
    await new Promise((r) => setTimeout(r, 250));
    window.WM_PUBLISH._work('orders');
    await new Promise((r) => setTimeout(r, 350));
    document.getElementById('ordAdd').click();
    await new Promise((r) => setTimeout(r, 300));
    document.getElementById('ordSupplier').value = 's2';
    document.getElementById('ordAmount').value = '900';
    document.getElementById('ordWho').value = 'Зал';
    document.getElementById('ordSave').click();
    await new Promise((r) => setTimeout(r, 600));
    return {
      inCatalog: P._state().orders.length,
      local: JSON.parse(localStorage.getItem('wm_orders_local_v1') || '[]').length,
      flagged: document.querySelectorAll('#ordersBody .ord-flag').length,
    };
  });
  chk(staff.local === 1 && staff.inCatalog === 4,
    `заказ сотрудника остаётся на его телефоне (свои ${staff.local}, в каталоге ${staff.inCatalog})`);
  chk(staff.flagged === 1, 'заказ сотрудника помечен «не отправлен»');

  // ── Месяц, «Сегодня» и просроченные поставки ──
  const month = await page.evaluate(async () => {
    document.querySelector('[data-ord-mode="month"]').click();
    await new Promise((r) => setTimeout(r, 350));
    const box = document.getElementById('ordersBody');
    return {
      cells: box.querySelectorAll('[data-ord-month-day]').length,
      withSum: [...box.querySelectorAll('.ord-cell.has')].length,
      label: (box.querySelector('.ord-week-label') || {}).textContent,
      total: (box.querySelector('.ord-total') || {}).innerText.replace(/\s+/g, ' '),
    };
  });
  chk(month.cells >= 28 && month.cells <= 42, `месяц показывает сетку дней (${month.cells})`);
  chk(month.withSum >= 2, `дни с поставками выделены (${month.withSum})`);
  chk(/за месяц/.test(month.total), `внизу итог за месяц (${month.total})`);
  chk(/20\d\d/.test(month.label || ''), `видно, какой это месяц (${month.label})`);

  const back = await page.evaluate(async () => {
    document.querySelector('.ord-cell.has[data-ord-month-day]').click();
    await new Promise((r) => setTimeout(r, 350));
    const box = document.getElementById('ordersBody');
    return { days: box.querySelectorAll('[data-ord-day]').length, rows: box.querySelectorAll('[data-ord-open]').length };
  });
  chk(back.days === 7 && back.rows > 0, `тап по дню в месяце открывает его неделю (${back.rows} заказ(ов))`);

  const today = await page.evaluate(async (mon) => {
    document.querySelector('[data-ord-week="1"]').click();
    await new Promise((r) => setTimeout(r, 250));
    document.querySelector('[data-ord-today]').click();
    await new Promise((r) => setTimeout(r, 250));
    return (document.querySelector('#ordersBody .ord-week-label') || {}).textContent;
  });
  chk(!!today, `кнопка «Сегодня» возвращает на текущую неделю (${today})`);

  const late = await page.evaluate(async (due) => {
    const P = window.WM_PUBLISH;
    P._state().orders.push({ id: 'late1', status: 'ordered', supplier_id: 's1', supplier_name: 'Молзавод', placed_at: due, due_at: due, amount: 1000, who: 'Анна' });
    document.querySelector('[data-ord-today]').click();
    await new Promise((r) => setTimeout(r, 300));
    const box = document.getElementById('ordersBody');
    return {
      head: (box.querySelector('.ord-late-head') || {}).textContent || '',
      marks: box.querySelectorAll('.ord-late').length,
    };
  }, iso(-10));
  chk(/Просрочено · 1/.test(late.head), `поставка из прошлой недели без отметки «пришёл» видна как просроченная (${late.head})`);
  chk(late.marks >= 1, `в строке стоит пометка «просрочен» (${late.marks})`);

  // ── Что заказали: позиции внутри заказа ──
  const items = await page.evaluate(async (due) => {
    document.querySelectorAll('.sheet-backdrop:not([hidden])').forEach((s) => { s.hidden = true; });
    document.getElementById('adminBtn').click();
    await new Promise((r) => setTimeout(r, 250));
    window.WM_PUBLISH._work('orders');
    await new Promise((r) => setTimeout(r, 350));
    document.getElementById('ordAdd').click();
    await new Promise((r) => setTimeout(r, 300));
    const add = async (name, qty) => {
      document.getElementById('ordItemName').value = name;
      document.getElementById('ordItemQty').value = qty;
      document.getElementById('ordItemAdd').click();
      await new Promise((r) => setTimeout(r, 120));
    };
    await add('101', '6');                 // по коду — подставится название из каталога
    await add('Ящик бананов', '2');        // чего нет в каталоге — как написали
    await add('Лишнее', '1');
    document.querySelector('[data-ord-item-rm="2"]').click();
    await new Promise((r) => setTimeout(r, 150));
    const rows = [...document.querySelectorAll('#ordItems .ios-row')].map((x) => x.innerText.replace(/\s+/g, ' ').trim());
    document.getElementById('ordSupplier').value = 's1';
    document.getElementById('ordAmount').value = '4000';
    document.getElementById('ordDue').value = due;
    document.getElementById('ordSave').click();
    await new Promise((r) => setTimeout(r, 700));
    // к этому моменту тест уже переключился на сотрудника, поэтому заказ лежит
    // на телефоне, а не в каталоге — ищем в обоих местах
    const all = [...window.WM_PUBLISH._state().orders,
      ...JSON.parse(localStorage.getItem('wm_orders_local_v1') || '[]')];
    const saved = all.find((o) => o.amount === 4000);
    return { rows, items: saved ? saved.items : [], list: document.getElementById('ordersBody').innerText.replace(/\s+/g, ' ') };
  }, iso(2));
  chk(items.rows.length === 2, `лишнюю позицию можно убрать (осталось ${items.rows.length})`);
  chk(/Молоко/.test(items.rows[0]) && /код 101/.test(items.rows[0]),
    `по коду подставляется товар из каталога (${items.rows[0]})`);
  chk(/Ящик бананов/.test(items.rows[1]), `чего нет в каталоге — записывается как есть (${items.rows[1]})`);
  chk(items.items.length === 2 && items.items[0].qty === 6, `позиции сохраняются в заказе (${JSON.stringify(items.items[0])})`);
  chk(/2 позиции/.test(items.list), 'в списке заказов видно, сколько позиций');

  const reopened = await page.evaluate(async () => {
    const btn = [...document.querySelectorAll('#ordersBody [data-ord-open]')].find((b) => /4\s?000/.test(b.innerText.replace(/\s/g, ' ')));
    btn.click();
    await new Promise((r) => setTimeout(r, 350));
    return document.querySelectorAll('#ordItems .ios-row').length;
  });
  chk(reopened === 2, `при открытии заказа позиции на месте (${reopened})`);

  chk(!errs.length, `нет сбоев JS (${errs.length}${errs.length ? ': ' + errs[0] : ''})`);
  await done(b);
})();

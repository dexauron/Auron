(() => {
  'use strict';

  // Главная — первый экран при открытии.
  // docs/03-SCREENS.md, Экран 1.
  //
  // Два правила задают всё поведение:
  //   • Умные карточки — карточка не показывается, если показывать нечего.
  //     Нет выплат сегодня → нет карточки выплат. Экран не давит пустотой.
  //   • Вид зависит от роли. Бухгалтер видит полную версию, владелец —
  //     то же без кнопок ввода, администратор — без сумм кассы,
  //     сотрудник зала — только заказы и поставки, никаких денег.

  const el = (tag, cls, text) => {
    const n = document.createElement(tag);
    if (cls)  n.className = cls;
    if (text != null) n.textContent = text;
    return n;
  };

  // Суммы показываем целыми рублями: копейки в интерфейсе только мешают
  const money = k => (window.API ? API.rubInt(k) : Math.round((k || 0) / 100)).toLocaleString('ru-RU');

  const DAYS   = ['вс', 'пн', 'вт', 'ср', 'чт', 'пт', 'сб'];
  const MONTHS = ['янв', 'фев', 'мар', 'апр', 'мая', 'июн', 'июл', 'авг', 'сен', 'окт', 'ноя', 'дек'];

  function today() {
    const d = new Date();
    return DAYS[d.getDay()] + ', ' + d.getDate() + ' ' + MONTHS[d.getMonth()];
  }

  function isoToday() { return new Date().toISOString().slice(0, 10); }

  // ── Скелетон ────────────────────────────────────────────────────────
  // Только при первом открытии: дальше работает оптимистичный UI
  // и мигать нечем.
  function skeleton(root) {
    root.innerHTML =
      '<div class="home-skeleton">' +
        '<div class="sk sk-balance"></div>' +
        '<div class="sk sk-actions"></div>' +
        '<div class="sk sk-card"></div>' +
      '</div>';
  }

  // ── Карточки ────────────────────────────────────────────────────────

  // Чеклист дня: исчезает, когда всё сделано
  function checklist(items) {
    const done = items.filter(i => i.done).length;
    if (!items.length || done === items.length) return null;

    const box = el('div', 'card checklist');
    box.appendChild(el('div', 'checklist-title', 'Сегодня:'));
    const row = el('div', 'checklist-row');
    items.forEach(i => {
      const chip = el('button', 'checklist-item' + (i.done ? ' done' : ''));
      chip.type = 'button';
      chip.appendChild(el('span', 'checklist-mark', i.done ? '☑' : '☐'));
      chip.appendChild(el('span', null, i.label));
      if (i.go) chip.onclick = () => ROUTER.go(i.go);
      row.appendChild(chip);
    });
    box.appendChild(row);
    return box;
  }

  function balance(summary, opts) {
    const box = el('div', 'card balance');
    box.appendChild(el('div', 'balance-label', 'Наличных в кассе'));

    const cash = el('div', 'balance-main', '₽ ' + money(summary.cash_kopecks));
    // Отрицательный баланс — красным со знаком минус, пульс уходит в красный
    if ((summary.cash_kopecks || 0) < 0) cash.classList.add('negative');
    box.appendChild(cash);
    box.appendChild(el('div', 'balance-date', today()));

    const grid = el('div', 'balance-grid');
    const add = (label, value) => {
      const c = el('div', 'balance-cell');
      c.appendChild(el('div', 'balance-cell-label', label));
      c.appendChild(el('div', 'balance-cell-value', '₽ ' + money(value)));
      grid.appendChild(c);
    };
    add('Выручка сегодня', summary.revenue_kopecks);
    // «Свободно» = наличка − запланированные выплаты − пополнение накоплений
    add('Свободно', summary.free_kopecks);
    box.appendChild(grid);

    if (opts && opts.hideCash) {
      // Администратор сумм кассы не видит
      cash.textContent = '—';
      cash.classList.add('hidden-value');
    }
    return box;
  }

  function quickActions(actions) {
    if (!actions.length) return null;
    const box = el('div', 'quick-actions');
    actions.forEach(a => {
      const b = el('button', 'quick-action');
      b.type = 'button';
      b.appendChild(el('span', 'quick-action-icon', a.icon));
      b.appendChild(el('span', 'quick-action-label', a.label));
      b.onclick = a.onClick;
      box.appendChild(b);
    });
    return box;
  }

  // Смена не закрыта — карточка с переходом. После заполнения исчезает.
  function shiftCard(shiftClosed) {
    if (shiftClosed) return null;
    const box = el('button', 'card card-action shift-card');
    box.type = 'button';
    box.appendChild(el('div', 'card-title', '🧾 Смена не закрыта'));
    box.appendChild(el('div', 'card-sub', 'Внести Z-отчёт'));
    box.onclick = () => ROUTER.go('kassa');
    return box;
  }

  function paymentsCard(payments) {
    if (!payments.length) return null;
    const total = payments.reduce((s, p) => s + (p.amount_kopecks || 0), 0);

    const box = el('div', 'card payments-card');
    box.appendChild(el('div', 'card-title', 'Выплаты сегодня'));
    box.appendChild(el('div', 'card-sub',
      payments.length + ' ' + plural(payments.length, 'поставщик', 'поставщика', 'поставщиков') +
      '  •  ₽ ' + money(total)));

    // 10+ выплат сразу не показываем — первые три и кнопка «и ещё N»
    const list = el('div', 'card-list');
    const visible = payments.slice(0, 3);
    visible.forEach(p => list.appendChild(paymentRow(p)));

    if (payments.length > 3) {
      const more = el('button', 'card-more', 'и ещё ' + (payments.length - 3) + '…');
      more.type = 'button';
      more.onclick = () => {
        payments.slice(3).forEach(p => list.insertBefore(paymentRow(p), more));
        more.remove();
      };
      list.appendChild(more);
    }
    box.appendChild(list);
    return box;
  }

  function paymentRow(p) {
    const row = el('button', 'card-row');
    row.type = 'button';
    row.appendChild(el('span', 'card-row-name', p.name || 'Без названия'));
    row.appendChild(el('span', 'card-row-value', '₽ ' + money(p.amount_kopecks)));
    row.onclick = () => ROUTER.go('suppliers', [p.counterparty_id || ''], { tab: 'payments' });
    return row;
  }

  function ordersCard(orders) {
    if (!orders.length) return null;
    const box = el('div', 'card orders-card');
    box.appendChild(el('div', 'card-title', 'Ожидаемые заказы'));
    const list = el('div', 'card-list');
    orders.slice(0, 5).forEach(o => {
      const row = el('button', 'card-row');
      row.type = 'button';
      const name = (o.department ? o.department + ' • ' : '') + (o.counterparties?.name || '');
      row.appendChild(el('span', 'card-row-name', name));
      row.appendChild(el('span', 'card-row-value', '~₽ ' + money(o.total_kopecks)));
      row.onclick = () => ROUTER.go('suppliers', [], { tab: 'orders' });
      list.appendChild(row);
    });
    box.appendChild(list);
    return box;
  }

  function savingsCard(goals) {
    const items = goals.filter(g => g.type === 'reserve_item');
    if (!items.length) return null;

    const box = el('div', 'card savings-card');
    box.appendChild(el('div', 'card-title', 'Накопления'));
    const list = el('div', 'card-list');

    items.forEach(g => {
      const row = el('div', 'savings-row');
      row.appendChild(el('span', 'savings-name', g.name));

      const bar  = el('div', 'savings-bar');
      const fill = el('div', 'savings-fill');
      fill.style.width = (g.percent || 0) + '%';
      // Отстаём от плана — подсвечиваем, чтобы заметили до конца месяца
      if (g.behind) fill.classList.add('behind');
      if ((g.percent || 0) >= 100) fill.classList.add('done');
      bar.appendChild(fill);
      row.appendChild(bar);

      row.appendChild(el('span', 'savings-value',
        '₽' + money(g.current_kopecks) + '/₽' + money(g.target_kopecks)));
      list.appendChild(row);
    });

    box.appendChild(list);
    return box;
  }

  // Всё сделано — вместо пустых карточек итог дня
  function dayClosedCard(summary) {
    const box = el('div', 'card day-closed');
    box.appendChild(el('div', 'card-title', '✓ День закрыт'));
    box.appendChild(el('div', 'card-sub',
      'Выручка ₽' + money(summary.revenue_kopecks) + '  •  Свободно ₽' + money(summary.free_kopecks)));
    const btn = el('button', 'btn-primary', '📤 Отправить отчёт владельцу');
    btn.type = 'button';
    btn.onclick = () => ROUTER.go('finance', [], { tab: 'report' });
    box.appendChild(btn);
    return box;
  }

  // Пустое состояние первого запуска: не пугаем нулями, зовём начать
  function emptyState() {
    const box = el('div', 'card empty-state');
    box.appendChild(el('div', 'empty-title', 'Здесь появится сводка дня'));
    box.appendChild(el('div', 'empty-text',
      'Начните с Z-отчёта за вчера — дальше всё считается само.'));
    const btn = el('button', 'btn-primary', 'Внести Z-отчёт');
    btn.type = 'button';
    btn.onclick = () => ROUTER.go('kassa');
    box.appendChild(btn);
    return box;
  }

  function plural(n, one, few, many) {
    const m10 = n % 10, m100 = n % 100;
    if (m10 === 1 && m100 !== 11) return one;
    if (m10 >= 2 && m10 <= 4 && (m100 < 10 || m100 >= 20)) return few;
    return many;
  }

  // ── Сборка экрана ───────────────────────────────────────────────────

  async function render(root) {
    const org = AUTH.getCurrentOrg();
    if (!org) {
      root.appendChild(el('div', 'screen-notice', 'Сначала выберите магазин.'));
      return;
    }

    skeleton(root);

    const date = isoToday();
    let summary = {}, goals = [], orders = [], shifts = [];

    // Экран не должен падать целиком из-за одного медленного запроса:
    // что пришло — показываем, что нет — просто не рисуем.
    const results = await Promise.allSettled([
      API.getHomeSummary(org.org_id, date),
      API.getGoals(org.org_id, 'reserve_item'),
      API.getPurchaseOrders(org.org_id, { status: 'planned' }),
      API.getShifts(org.org_id, { date, limit: 5 })
    ]);
    if (results[0].status === 'fulfilled') summary = results[0].value || {};
    if (results[1].status === 'fulfilled') goals   = results[1].value || [];
    if (results[2].status === 'fulfilled') orders  = results[2].value || [];
    if (results[3].status === 'fulfilled') shifts  = results[3].value || [];

    const payments    = summary.payments_today || [];
    const shiftClosed = shifts.some(s => s.status === 'closed');
    const isEmpty     = !shifts.length && !payments.length && !orders.length && !goals.length;

    root.innerHTML = '';
    root.setAttribute('data-role', STATE.get('role') || '');

    // Плашка офлайна: показываем, на какой момент данные
    if (!STATE.get('online')) {
      const at = STATE.lastSyncLabel();
      root.appendChild(el('div', 'offline-bar',
        at ? 'Нет соединения · данные на ' + at : 'Нет соединения'));
    }

    if (isEmpty) { root.appendChild(emptyState()); return; }

    // Чеклист — только тем, кто действительно закрывает эти задачи
    if (STATE.can('edit_cash')) {
      const cl = checklist([
        { label: 'Z-отчёт', done: shiftClosed, go: 'kassa' },
        { label: payments.length + ' ' + plural(payments.length, 'выплата', 'выплаты', 'выплат'),
          done: !payments.length, go: 'suppliers' },
        { label: 'Табель', done: !!summary.timesheet_confirmed, go: 'staff' }
      ]);
      if (cl) root.appendChild(cl);
    }

    // Сотрудник зала денег не видит вовсе
    if (STATE.can('view_cash') || STATE.can('view_home')) {
      if (STATE.get('role') !== 'staff') {
        root.appendChild(balance(summary, { hideCash: !STATE.can('view_cash') }));
      }
    }

    // Кнопки ввода — только у тех, кто вводит. Владелец смотрит.
    const actions = [];
    if (STATE.can('edit_cash')) {
      actions.push({ icon: '🧾', label: 'Z-отчёт',  onClick: () => ROUTER.go('kassa') });
      actions.push({ icon: '💸', label: 'Выплата',  onClick: () => ROUTER.go('suppliers', [], { tab: 'payments' }) });
    }
    if (STATE.can('create_order')) {
      actions.push({ icon: '📦', label: 'Заказ', onClick: () => ROUTER.go('suppliers', [], { tab: 'orders' }) });
    }
    if (STATE.can('view_reports')) {
      actions.push({ icon: '📤', label: 'Отчёт', onClick: () => ROUTER.go('finance', [], { tab: 'report' }) });
    }
    const qa = quickActions(actions);
    if (qa) root.appendChild(qa);

    // Умные карточки: каждая появляется, только если ей есть что сказать
    const cards = [];
    if (STATE.can('edit_cash'))  cards.push(shiftCard(shiftClosed));
    if (STATE.can('view_debts')) cards.push(paymentsCard(payments));
    cards.push(ordersCard(orders));
    if (STATE.can('view_reports')) cards.push(savingsCard(goals));

    const shown = cards.filter(Boolean);
    // День закрыт: задач не осталось — показываем итог вместо пустоты
    if (!shown.length && shiftClosed && STATE.can('view_reports')) {
      root.appendChild(dayClosedCard(summary));
    } else {
      shown.forEach(c => root.appendChild(c));
    }

    // Перерисовываемся, когда что-то поменялось в другом разделе
    const offs = [
      STATE.on('shift.*',   () => render(root)),
      STATE.on('payment.*', () => render(root)),
      STATE.on('goal.*',    () => render(root)),
      STATE.on('net.online', () => render(root))
    ];
    return () => offs.forEach(off => off());
  }

  STATE.registerModule({
    key:      'home',
    title:    'Главная',
    order:    1,
    requires: 'view_home',
    render
  });
})();

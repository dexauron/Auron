/* ============================================================================
   Экраны работы с данными 1С и ручного ввода:
   Импорт · Сопоставление имён · Разбор оплат · Подтверждение выплат ·
   Отсрочки · Ручные записи · Долги покупателей · Шаблон Excel.
   Файл подключается ДО js/ui.js и дополняет общий список экранов.
   ========================================================================== */
(function () {
  'use strict';
  var E = window.WM, S = window.WMStore, SUP = window.WMSupply, F = window.WMFin, Q = window.WMQuick;

  function U() { return window.WMUI; }
  function sup() { return U().calc().sup || SUP.compute(S.state, S.settings); }
  function today() { return new Date().toISOString().slice(0, 10); }
  function num(v) { return SUP.num(v); }
  function dateRu(d) { return U().dateRu(d); }
  function esc(s) { return U().esc(s); }

  function refresh() { U().recompute(); }

  function categories() {
    var v = S.settings.finCategories;
    if (typeof v === 'string' && v.trim()) return v.split(',').map(function (x) { return x.trim(); }).filter(Boolean);
    return ['Закуп товара', 'ЗП', 'Аренда', 'Налоги', 'Коммуналка', 'Оплата ТП', 'Другое'];
  }
  function firmNames() {
    return (S.state.supreg || []).map(function (f) { return f.name; }).sort();
  }
  function dict() { return Q.dicts(S.state, S.settings); }
  function learn(map) {
    var changed = false;
    Object.keys(map).forEach(function (d) { if (Q.learn(S.settings, d, map[d])) changed = true; });
    if (changed) S.save();
  }

  /* --- Формы ---------------------------------------------------------------- */
  var FORMS = window.WM_EXTRA_FORMS = window.WM_EXTRA_FORMS || {};

  // Забор денег владельцем: деньги уходят из оборота, но это не расход магазина
  FORMS.ownerDraw = {
    title: 'Забор денег владельцем', icon: '🏦',
    body: function (v) {
      var u = U(); v = v || {};
      return u.fieldRow('Дата', 'date', 'date', v.date || today()) +
        u.fieldRow('Сумма', 'amount', 'number', v.amount || '') +
        u.fieldRow('Откуда', 'method', 'list', v.method || 'Наличные', { options: dict().methods }) +
        u.fieldRow('Комментарий', 'note', 'text', v.note || '', { placeholder: 'личные нужды' });
    },
    hint: 'Не попадает в расходы и не уменьшает прибыль — только уменьшает деньги в обороте.',
    save: function (v) {
      if (!num(v.amount)) return 'Укажите сумму.';
      S.add('dds', { date: v.date || today(), type: 'Забор', category: 'Забор владельца',
        method: v.method || 'Наличные', amount: num(v.amount), note: v.note || '' });
      return { ok: 'Записано: из оборота ушло ' + E.fmtMoney(num(v.amount)) + '.' };
    }
  };

  // Долг покупателя: бывшая тетрадка у кассы
  FORMS.debtor = {
    title: 'Долг покупателя', icon: '📓',
    body: function (v) {
      var u = U(); v = v || {};
      return u.fieldRow('Дата', 'date', 'date', v.date || today()) +
        u.fieldRow('Имя', 'name', 'text', v.name || '', { placeholder: 'как записал кассир' }) +
        u.fieldRow('Телефон', 'phone', 'text', v.phone || '', { placeholder: '+7 …' }) +
        u.fieldRow('Сумма', 'sum', 'number', v.sum || '') +
        u.fieldRow('Обещал вернуть', 'promise', 'date', v.promise || '') +
        u.fieldRow('Кто записал', 'cashier', 'list', v.cashier || Q.last(S.state, 'cashier'), { options: dict().cashiers });
    },
    hint: 'Пока долг не погашен, он не считается выручкой — иначе касса не сойдётся.',
    save: function (v) {
      if (!v.name) return 'Укажите имя.';
      if (!num(v.sum)) return 'Укажите сумму.';
      learn({ cashiers: v.cashier });
      S.add('debtors', { date: v.date || today(), name: v.name, phone: v.phone || '',
        sum: num(v.sum), promise: v.promise || '', cashier: v.cashier || '', paid: false });
      refresh();
      return { ok: 'Записано. Долг «' + v.name + '» — ' + E.fmtMoney(num(v.sum)) + '.' };
    }
  };

  // Своя операция: когда ни одна готовая форма не подходит
  FORMS.freeOp = {
    title: 'Своя операция', icon: '✳️',
    body: function (v) {
      var u = U(); v = v || {}; var pre = Q.defaults(S.state, S.settings, 'freeOp');
      return u.fieldRow('Дата', 'date', 'date', v.date || pre.date) +
        u.fieldRow('Что это', 'type', 'list', v.type || 'Расход',
          { options: ['Приход', 'Расход', 'Долг', 'Забор'] }) +
        u.fieldRow('Статья', 'category', 'list', v.category || pre.category, { options: dict().categories, placeholder: 'своё название' }) +
        u.fieldRow('Способ', 'method', 'list', v.method || pre.method, { options: dict().methods }) +
        u.fieldRow('Сумма', 'amount', 'number', v.amount || '') +
        u.fieldRow('Смена', 'shift', 'list', v.shift || '', { options: dict().shifts }) +
        u.fieldRow('Кто вносит', 'cashier', 'list', v.cashier || pre.cashier, { options: dict().cashiers }) +
        u.fieldRow('Комментарий', 'note', 'text', v.note || '');
    },
    hint: 'Приход — деньги пришли · Расход — ушли · Долг — товар взяли без оплаты · Забор — деньги вынули из оборота.',
    save: function (v) {
      if (!num(v.amount)) return 'Укажите сумму.';
      if (!v.category) return 'Напишите статью — за что это.';
      learn({ categories: v.category, methods: v.method, cashiers: v.cashier, shifts: v.shift });
      S.add('dds', { date: v.date || today(), type: v.type || 'Расход', category: v.category,
        method: v.method || 'Наличные', amount: num(v.amount), shift: v.shift || '',
        cashier: v.cashier || '', diff: 0, note: v.note || '' });
      refresh();
      return { ok: 'Записано: ' + v.type + ' · ' + v.category + ' — ' + E.fmtMoney(num(v.amount)) };
    }
  };

  // Карточка фирмы: отсрочка, чем обычно платим, телефон
  FORMS.supFirm = {
    editsInPlace: true,
    title: 'Поставщик', icon: '🏢',
    body: function (v) {
      var u = U(); v = v || {};
      return u.fieldRow('Фирма', 'name', 'text', v.name || '', { placeholder: 'как называем между собой' }) +
        u.fieldRow('Отсрочка, дней', 'termDays', 'number', v.termDays == null ? '' : v.termDays) +
        u.fieldRow('Обычная оплата', 'method', 'select', v.method || 'Наличные',
          { options: ['Наличные', 'Безнал', 'Карта', 'Оплата сразу'] }) +
        u.fieldRow('Телефон', 'phone', 'text', v.phone || '') +
        u.fieldRow('Имена в 1С (через запятую)', 'aliases', 'text',
          (v.aliases || []).join ? (v.aliases || []).join(', ') : (v.aliases || '')) +
        u.fieldRow('Заметка', 'note', 'text', v.note || '');
    },
    hint: 'Отсрочка 0 — «оплата сразу». Дата выплаты = дата накладной + отсрочка.',
    save: function (v) {
      if (!v.name) return 'Укажите название фирмы.';
      var reg = S.state.supreg = S.state.supreg || [];
      var f = SUP.findFirm(reg, v.name);
      if (!f) { f = SUP.firmRecord(v.name); reg.push(f); }
      f.termDays = v.termDays === '' || v.termDays == null ? null : num(v.termDays);
      f.method = v.method || ''; f.phone = v.phone || ''; f.note = v.note || '';
      if (typeof v.aliases === 'string') {
        f.aliases = v.aliases.split(',').map(function (x) { return x.trim(); }).filter(Boolean);
      }
      S.save(); recalcDates(); refresh();
      return { ok: 'Сохранено. Даты выплат по «' + f.name + '» пересчитаны.' };
    }
  };

  // Правка накладной, если в 1С сумма или дата оказались не те
  FORMS.supDoc = {
    editsInPlace: true,
    title: 'Накладная', icon: '📄',
    body: function (v) {
      var u = U(); v = v || {};
      return u.fieldRow('Документ', 'doc', 'text', v.doc || '') +
        u.fieldRow('Дата', 'date', 'date', v.date || today()) +
        u.fieldRow('Поставщик', 'firm', 'text', v.firm || '', { list: 'dl-sup' }) +
        u.fieldRow('Сумма закупа', 'sum', 'number', v.sum || '') +
        u.fieldRow('Сумма в рознице', 'retail', 'number', v.retail || 0) +
        u.fieldRow('Платить', 'payDate', 'date', v.payDate || '');
    },
    hint: 'Правка живёт до следующей загрузки этого же документа из 1С.',
    save: function (v) {
      var d = (S.state.docs || []).filter(function (x) { return x.doc === v.doc; })[0];
      if (!d) return 'Накладная не найдена.';
      d.date = v.date || d.date; d.firm = v.firm || d.firm;
      d.sum = num(v.sum); d.retail = num(v.retail);
      if (v.payDate) { d.payDate = v.payDate; d.confirmed = true; }
      S.save(); refresh();
      return { ok: 'Накладная ' + d.doc + ' обновлена.' };
    }
  };

  // Правка оплаты из 1С: сумма, дата, к какой накладной относится
  FORMS.supPay = {
    editsInPlace: true,
    title: 'Оплата', icon: '💸',
    body: function (v) {
      var u = U(); v = v || {};
      return u.fieldRow('Документ', 'doc', 'text', v.doc || '') +
        u.fieldRow('Дата', 'date', 'date', v.date || today()) +
        u.fieldRow('Поставщик', 'firm', 'list', v.firm || '', { options: firmNames() }) +
        u.fieldRow('Сумма', 'sum', 'number', v.sum || '') +
        u.fieldRow('Основание (накладная)', 'basis', 'text', v.basis || '') +
        u.fieldRow('Статья расхода', 'category', 'list', v.category || '', { options: categories() }) +
        u.fieldRow('Касса', 'cashbox', 'text', v.cashbox || '');
    },
    hint: 'Если оплата относится к накладной — впишите её номер в «Основание».',
    save: function (v) {
      var p = (S.state.pays || []).filter(function (x) { return x.doc === v.doc; })[0];
      if (!p) return 'Оплата не найдена.';
      p.date = v.date || p.date; p.firm = v.firm || p.firm; p.sum = num(v.sum);
      p.basis = v.basis || ''; p.basisKey = SUP.norm(p.basis);
      p.category = v.category || ''; p.cashbox = v.cashbox || p.cashbox;
      if (p.category) { p.linkKind = 'expense'; p.resolved = true; }
      else if (p.basisKey) { p.linkKind = ''; p.linkKey = ''; p.resolved = false; }
      S.save(); refresh();
      return { ok: 'Оплата обновлена: ' + E.fmtMoney(num(v.sum)) };
    }
  };

  // Пересчёт неподтверждённых дат после правки отсрочек
  function recalcDates() {
    var reg = S.state.supreg || [];
    (S.state.docs || []).forEach(function (d) {
      if (d.confirmed) return;
      d.payDate = SUP.addDays(d.date, SUP.termDaysFor(d.firm, reg, S.settings));
    });
    S.save();
  }

  /* --- Импорт из 1С --------------------------------------------------------- */
  var MAPPING = [
    ['Приходная накладная (номер и дата)', 'Документ · ключ, по которому ищем дубли'],
    ['Контрагент / Грузоотправитель', 'Поставщик, затем фирма из справочника'],
    ['Входящий номер документа', 'Вх. номер — по нему сверяются бумаги'],
    ['Сумма документа прих.', 'Сумма закупа'],
    ['Сумма документа розница', 'Сумма в розничных ценах'],
    ['Документ основание (в РКО)', 'Связь оплаты с накладной'],
    ['Касса (в РКО)', 'Откуда ушли деньги'],
    ['Вид операции (в РКО)', 'Оплата поставщику или прочий расход'],
    ['Статья ДДС (в РКО)', 'Статья расхода']
  ];

  function viewImport() {
    var u = U(), c = sup(), last = u.lastImport(), D = u.data();
    var h = u.pageHead('Импорт из 1С', 'Бросьте выгрузки — программа сама поймёт, что это, и обновит данные');

    h += '<div class="card"><div class="card-pad" style="text-align:center">' +
      '<div style="font-size:34px">📥</div>' +
      '<div style="font-size:17px;font-weight:650;margin-top:8px">Выберите файлы из 1С</div>' +
      '<div class="card-note" style="margin-top:4px">Приходные накладные · РКО · Остатки · Продажи · Списания · Возвраты. Можно сразу несколько</div>' +
      '<div style="margin-top:14px"><button class="btn btn-primary btn-lg" data-act="pick-files">Выбрать файлы</button> ' +
      '<button class="btn btn-lg" data-act="folder-connect">📂 Подключить папку</button></div></div></div>';

    if (last.length) {
      var added = 0, updated = 0, same = 0;
      last.forEach(function (f) { added += f.stat.added; updated += f.stat.updated; same += f.stat.same; });
      var attention = c.newNames.length + c.recon.length;
      h += u.card('Распознано в последней загрузке', u.listOf(last.map(function (f) {
        return u.listRow({ icon: '📄', title: esc(f.name),
          sub: esc(f.kind) + ' · строк ' + u.nf(f.rows),
          value: '<span class="c-muted">+' + f.stat.added + ' / ~' + f.stat.updated + '</span>' });
      }), 'Пока ничего не загружали'), last.length + ' ' + u.plural(last.length, 'файл', 'файла', 'файлов'));

      h += '<div class="stat-grid">' +
        u.stat('Новых документов', u.nf(added), 'добавлены в базу', added ? 'c-green' : '') +
        u.stat('Обновлено', u.nf(updated), 'изменилась сумма или дата') +
        u.stat('Пропущено дублей', u.nf(same), 'уже загружались раньше') +
        u.stat('Требует внимания', u.nf(attention), 'новые имена и несошедшиеся оплаты', attention ? 'c-orange' : '') +
        '</div>';
    }

    h += '<div class="stat-grid">' +
      u.stat('Накладных в базе', u.nf(c.totals.docs), 'за всё время') +
      u.stat('Оплат в базе', u.nf((S.state.pays || []).length), 'расходные ордера') +
      u.stat('Долг поставщикам', u.priv(c.totals.left), 'по всем накладным', c.totals.left ? 'c-red' : 'c-green') +
      u.stat('Фирм в справочнике', u.nf((S.state.supreg || []).length), 'имена из 1С связаны') +
      '</div>';

    h += u.card('Как программа читает колонки 1С', u.table('impMap', [
      { title: 'Колонка в файле 1С', fn: function (r) { return esc(r[0]); } },
      { title: 'Поле в базе', fn: function (r) { return '<b>' + esc(r[1]) + '</b>'; } }
    ], MAPPING, { step: 20 }));

    if (D.files.length) {
      h += u.card('Файлы, прочитанные в этой сессии', u.listOf(D.files.map(function (f) {
        return u.listRow({ icon: '🗂', title: esc(f.name),
          sub: esc(f.note || f.kind), value: u.nf(f.rows) + ' стр.' });
      }), 'Файлов пока нет'));
    }

    h += '<div class="banner green"><span>🔒</span><span>Повторная загрузка того же файла не создаёт дублей: ' +
      'документы сверяются по номеру и обновляются на месте.</span></div>';
    return h;
  }

  /* --- Сопоставление имён --------------------------------------------------- */
  function viewMatch() {
    var u = U(), c = sup();
    var h = u.pageHead('Сопоставление имён',
      'В 1С один поставщик записан по-разному. Свяжите имена — и долг сложится в одну сумму',
      '<button class="btn btn-primary" data-form="supFirm">＋ Фирма</button>');

    if (c.newNames.length) {
      h += '<div class="banner"><span>🔗</span><span>' + c.newNames.length + ' ' +
        u.plural(c.newNames.length, 'имя ждёт', 'имени ждут', 'имён ждут') +
        ' решения. Пока имя не связано, долг по нему считается отдельно.</span></div>';
    } else {
      h += '<div class="banner green"><span>✅</span><span>Все имена из выгрузок связаны с фирмами.</span></div>';
    }

    h += u.card('Новые имена', u.listOf(c.newNames.map(function (n) {
      var raw = encodeURIComponent(n.raw), firm = encodeURIComponent(n.firm);
      var buttons = n.kind === 'empty'
        ? '<button class="btn btn-sm btn-primary" data-act="sup-empty-pick">Выбрать поставщика</button>'
        : '<button class="btn btn-sm btn-primary" data-act="sup-link" data-raw="' + raw + '" data-firm="' + firm + '">Связать</button>' +
          '<button class="btn btn-sm" data-act="sup-link-other" data-raw="' + raw + '">Другой</button>' +
          '<button class="btn btn-sm" data-act="sup-link-own" data-raw="' + raw + '">Отдельный</button>';
      return '<div class="row" style="flex-wrap:wrap">' +
        '<div class="row-main"><div class="row-title">' + esc(n.raw) + '</div>' +
        '<div class="row-sub">' + [
          n.docs ? n.docs + ' ' + u.plural(n.docs, 'накладная', 'накладные', 'накладных') : '',
          n.pays ? n.pays + ' ' + u.plural(n.pays, 'оплата', 'оплаты', 'оплат') : '',
          '<span class="private">' + E.fmtMoney(n.sum) + '</span>'
        ].filter(Boolean).join(' · ') + '</div></div>' +
        '<div class="row-main"><div class="row-title c-blue">' + esc(n.firm) + '</div>' +
        '<div class="row-sub">' + esc(n.reason) + '</div></div>' +
        '<div style="display:flex;gap:8px;flex-wrap:wrap">' + buttons + '</div></div>';
    }), 'Новых имён нет'), 'программа предлагает — вы подтверждаете');

    h += u.card('Фирмы и торговые представители', u.listOf(c.firms.map(function (f) {
      var reps = f.reps.map(function (r) { return '<span class="badge b-gray">' + esc(r) + '</span>'; }).join(' ');
      return '<div class="row" style="align-items:flex-start">' +
        '<div class="row-icon">🏢</div>' +
        '<div class="row-main"><div class="row-title">' + esc(f.firm) + '</div>' +
        '<div class="row-sub">' + f.docs + ' ' + u.plural(f.docs, 'накладная', 'накладные', 'накладных') +
        ' · ' + (f.term === null ? 'отсрочка не задана' : 'отсрочка ' + f.term + ' дн.') + '</div>' +
        (reps ? '<div style="margin-top:7px">' + reps + '</div>' : '') + '</div>' +
        '<div class="row-value private">' + E.fmtMoney(f.left) + '</div>' +
        '<button class="btn btn-sm" data-act="sup-firm-edit" data-firm="' + encodeURIComponent(f.firm) + '">✎</button>' +
        '</div>';
    }), 'Накладных ещё нет'), 'долг считается по фирме');
    return h;
  }

  /* --- Разбор оплат --------------------------------------------------------- */
  function viewRecon() {
    var u = U(), c = sup(), st = c.linkStat;
    var h = u.pageHead('Разбор оплат', 'РКО сами встают к накладным по документу-основанию. Здесь только то, что не сошлось');

    h += '<div class="stat-grid">' +
      u.stat('Связалось само', u.nf(st.auto) + ' из ' + u.nf(st.total), 'по документу-основанию', st.auto ? 'c-green' : '') +
      u.stat('Требует решения', u.nf(c.recon.length), 'недоплата, без основания, не поставщик', c.recon.length ? 'c-orange' : 'c-green') +
      u.stat('По старым накладным', u.nf(st.old), 'накладной нет в базе — гасили прежний долг') +
      u.stat('Не по поставщикам', u.nf(st.expense), 'нужна статья расхода') +
      '</div>';

    h += u.card('Разберите вручную', u.listOf(c.recon.map(function (r) {
      var id = r.id, btns = '';
      if (r.kind === 'underpay') {
        btns = '<button class="btn btn-sm btn-primary" data-act="sup-underpay-debt" data-id="' + id + '">Оставить долгом</button>' +
          '<button class="btn btn-sm' + (r.roundable ? ' btn-primary' : '') + '" data-act="sup-underpay-round" data-id="' + id +
          '">Считать округлением' + (r.roundable ? ' (до ' + E.fmtMoney(num(S.settings.roundTolerance)) + ')' : '') + '</button>' +
          '<button class="btn btn-sm" data-act="sup-doc-edit" data-id="' + id + '">Изменить сумму</button>';
      } else if (r.kind === 'nobasis') {
        btns = '<button class="btn btn-sm btn-primary" data-act="sup-pay-pick" data-id="' + id + '">Выбрать накладную</button>' +
          '<button class="btn btn-sm" data-act="sup-pay-expense" data-id="' + id + '">Это расход магазина</button>' +
          '<button class="btn btn-sm" data-act="sup-pay-advance" data-id="' + id + '">Аванс поставщику</button>';
      } else {
        var cats = categories().slice(0, 2).map(function (cat) {
          return '<button class="btn btn-sm" data-act="sup-pay-cat" data-id="' + id +
            '" data-cat="' + encodeURIComponent(cat) + '">' + esc(cat) + '</button>';
        }).join('');
        btns = cats + '<button class="btn btn-sm btn-primary" data-act="sup-pay-expense" data-id="' + id + '">Другая статья</button>';
      }
      return '<div class="row" style="flex-wrap:wrap;align-items:flex-start">' +
        '<div>' + u.badge(r.problem, r.tone) + '</div>' +
        '<div class="row-main"><div class="row-title">' + esc(r.title) + '</div>' +
        '<div class="row-sub">' + esc(r.sub) + '</div>' +
        '<div style="display:flex;gap:8px;flex-wrap:wrap;margin-top:10px">' + btns + '</div></div>' +
        '<div class="row-value private">' + E.fmtMoney(r.sum) + '</div></div>';
    }), 'Всё сошлось — разбирать нечего'), c.recon.length + ' ' + u.plural(c.recon.length, 'запись', 'записи', 'записей'));
    return h;
  }

  /* --- Подтверждение выплат -------------------------------------------------- */
  function viewConfirm() {
    var u = U(), c = sup(), q = c.confirm;
    var h = u.pageHead('Подтверждение выплат', 'Дата предложена по отсрочке поставщика — подтвердите каждую накладную',
      q.length ? '<button class="btn btn-primary" data-act="sup-confirm-all">Подтвердить все</button>' : '');

    var done = c.docs.filter(function (d) { return d.confirmed; }).length;
    h += '<div class="banner blue"><span>💡</span><span>' + q.length + ' из ' + c.docs.length +
      ' ждут решения · ' + done + ' уже в календаре выплат. Ничего не платится автоматически.</span></div>';

    var limit = u.page('confirmQ', 40);
    h += q.slice(0, limit).map(function (d) {
      var tone = d.tone < 0 ? 'b-red' : (d.tone > 0 ? 'b-orange' : 'b-blue');
      return '<div class="card"><div class="card-pad">' +
        '<div style="display:flex;gap:14px;flex-wrap:wrap;align-items:flex-start">' +
        '<div style="flex:1;min-width:220px">' +
        '<div class="card-title">' + esc(d.supplier) + '</div>' +
        '<div class="card-note">' + esc(d.doc) + (d.incomingNo ? ' · вх. ' + esc(d.incomingNo) : '') + '</div>' +
        '<div class="card-note">' + (d.termKnown ? 'отсрочка ' + d.term + ' дн.' : 'отсрочка не задана') +
        ' · поставка ' + esc(dateRu(d.date)) + '</div></div>' +
        '<div style="text-align:right"><div class="hero-value private" style="font-size:24px">' + E.fmtMoney(d.sum) + '</div>' +
        '<div class="card-note">в розницу <span class="private">' + E.fmtMoney(d.retail) + '</span></div></div></div>' +
        '<div style="display:flex;gap:12px;flex-wrap:wrap;align-items:center;margin-top:12px;padding-top:12px;border-top:.5px solid var(--separator)">' +
        '<span class="card-note">Платить</span>' +
        '<span class="badge ' + tone + '" style="font-size:15px;padding:8px 14px">' + esc(dateRu(d.due) || 'без срока') + '</span>' +
        '<span class="card-note">' + esc(d.hint) + '</span>' +
        '<span style="margin-left:auto;display:flex;gap:8px;flex-wrap:wrap">' +
        '<button class="btn btn-sm" data-act="sup-confirm-date" data-id="' + d.id + '">Другая дата</button>' +
        '<button class="btn btn-sm" data-act="sup-doc-paid" data-id="' + d.id + '">Уже оплачено</button>' +
        '<button class="btn btn-sm btn-primary" data-act="sup-confirm" data-id="' + d.id + '">Подтвердить</button>' +
        '</span></div></div></div>';
    }).join('');

    if (q.length > limit) {
      h += '<div class="more"><button class="btn" data-act="more" data-id="confirmQ" data-step="40">' +
        'Показать ещё (' + u.nf(q.length - limit) + ')</button></div>';
    }
    if (!q.length) h += u.card('Всё подтверждено', '<div class="empty">Новых накладных без даты выплаты нет.</div>');
    return h;
  }

  /* --- Отсрочки ------------------------------------------------------------- */
  function viewTerms() {
    var u = U(), c = sup();
    var h = u.pageHead('Отсрочки поставщиков', 'Задаётся один раз. Дата выплаты = дата накладной + отсрочка',
      '<button class="btn btn-primary" data-form="supFirm">＋ Поставщик</button>');

    h += u.card('Поставщики', u.table('supTerms', [
      { title: 'Поставщик', fn: function (r) { return esc(r.firm); } },
      { title: 'Отсрочка, дней', cls: 'num', fn: function (r) {
        return '<input class="term-input" type="number" min="0" step="1" style="width:74px;text-align:right" ' +
          'data-firm="' + encodeURIComponent(r.firm) + '" value="' + r.termShown + '">'; } },
      { title: 'Обычная оплата', fn: function (r) { return esc(r.method || (r.termShown === 0 ? 'Оплата сразу' : '—')); } },
      { title: 'Поставок в месяц', cls: 'num', fn: function (r) { return u.nf(r.freq); } },
      { title: 'Накладных', cls: 'num', fn: function (r) { return u.nf(r.docs); } },
      { title: 'Долг сейчас', cls: 'num', fn: function (r) {
        return '<span class="' + (r.overdue > 0 ? 'c-red' : (r.left > 0 ? '' : 'c-muted')) + ' private">' +
          E.fmtMoney(r.left) + '</span>'; } },
      { title: '', cls: 'center', fn: function (r) {
        return '<button class="btn btn-sm" data-act="sup-firm-edit" data-firm="' + encodeURIComponent(r.firm) + '">✎</button>'; } }
    ], c.terms, { step: 40, empty: 'Накладных из 1С ещё нет' }) +
      '<div class="form-actions" style="padding:14px 20px"><button class="btn btn-primary" data-act="sup-terms-save">Сохранить и пересчитать даты</button></div>',
      'по умолчанию ' + (+S.settings.termDaysDefault || 0) + ' дн.');

    h += '<div class="banner"><span>⏱</span><span>«Оплата сразу» — это отсрочка 0 дней: такие накладные ' +
      'попадают в подтверждение сразу после загрузки.</span></div>';
    return h;
  }

  /* --- Ручные записи -------------------------------------------------------- */
  var MANUAL_TABS = [
    { key: 'cashShift', icon: '💵', name: 'Касса за смену', main: 'zCash' },
    { key: 'ddsExpense', icon: '🧾', name: 'Расход', main: 'amount' },
    { key: 'payout', icon: '👥', name: 'Зарплата и аванс', main: 'amount' },
    { key: 'ownerDraw', icon: '🏦', name: 'Забор владельцем', main: 'amount' },
    { key: 'writeoff', icon: '🗑', name: 'Списание', main: 'cost' },
    { key: 'debtor', icon: '📓', name: 'Долг покупателя', main: 'sum' },
    { key: 'freeOp', icon: '✳️', name: 'Своя операция', main: 'amount' }
  ];
  function tabDef(key) {
    for (var i = 0; i < MANUAL_TABS.length; i++) if (MANUAL_TABS[i].key === key) return MANUAL_TABS[i];
    return MANUAL_TABS[0];
  }

  // Последние ручные записи — из всех журналов, свежие сверху
  function manualLog() {
    var rows = [];
    (S.state.dds || []).forEach(function (r) {
      if (r.src === 'импорт') return;
      rows.push({ date: r.date, kind: r.type === 'Забор' ? 'Забор' : r.type,
        tone: r.type === 'Приход' ? 'green' : (r.type === 'Долг' ? 'orange' : (r.type === 'Забор' ? 'gray' : 'red')),
        title: r.category || '—', sub: [r.shift, r.cashier, r.note].filter(Boolean).join(' · '),
        sum: num(r.amount), sign: r.type === 'Приход' ? 1 : -1, coll: 'dds', id: r.id,
        form: r.type === 'Приход' ? 'ddsIncome' : (r.type === 'Забор' ? 'ownerDraw' : 'ddsExpense') });
    });
    (S.state.payouts || []).forEach(function (r) {
      rows.push({ date: r.date, kind: 'Зарплата', tone: 'blue', title: r.employee || '—',
        sub: [r.type, r.form, r.note].filter(Boolean).join(' · '), sum: num(r.amount), sign: -1,
        coll: 'payouts', id: r.id, form: 'payout' });
    });
    (S.state.debtors || []).forEach(function (r) {
      rows.push({ date: r.date, kind: 'Долг покупателя', tone: r.paid ? 'green' : 'orange',
        title: r.name || '—', sub: r.paid ? 'погашен' : ('обещал ' + (dateRu(r.promise) || '—')),
        sum: num(r.sum), sign: 0, coll: 'debtors', id: r.id, form: 'debtor' });
    });
    (S.state.inventory || []).forEach(function (r) {
      rows.push({ date: r.date, kind: 'Списание', tone: 'red', title: r.name || '—',
        sub: r.reason || '', sum: num(r.accounted) * num(r.price), sign: -1,
        coll: 'inventory', id: r.id, form: 'writeoff' });
    });
    (S.state.expiry || []).forEach(function (r) {
      rows.push({ date: r.date || '', kind: 'Срок', tone: 'orange', title: r.name || '—',
        sub: 'годен до ' + (dateRu(r.bestBefore) || '—'), sum: num(r.qty) * num(r.price), sign: 0,
        coll: 'expiry', id: r.id, form: 'expiryItem' });
    });
    return rows.sort(function (a, b) { return (b.date || '').localeCompare(a.date || ''); }).slice(0, 15);
  }

  // Живая подсказка под формой: считает то, что важно, ещё до сохранения
  function liveHint(tab, v) {
    var u = U();
    if (tab === 'cashShift') {
      var m = Q.shiftMath(v);
      if (!m.revenue) return 'Впишите Z-отчёт — программа сама посчитает выручку, расхождение и остаток наличных.';
      var tone = m.status === 'сходится' ? 'c-green' : (m.status === 'нет факта' ? 'c-muted' : 'c-red');
      return 'Выручка за смену <b class="private">' + E.fmtMoney(m.revenue) + '</b>' +
        (!m.hasFact ? ' · впишите факт, чтобы увидеть расхождение'
          : ' · <b class="' + tone + '">' + m.status +
            (m.diff ? ' ' + E.fmtMoney(Math.abs(m.diff)) : '') + '</b>') +
        (m.payout ? ' · выдано из кассы ' + E.fmtMoney(m.payout) +
          ', наличных останется <b class="' + (m.cash < 0 ? 'c-red' : '') + ' private">' +
          E.fmtMoney(m.cash) + '</b>' : '');
    }
    var amount = num(v.amount || v.sum || v.cost);
    if (!amount) return '';
    var parts = ['Сумма <b class="private">' + E.fmtMoney(amount) + '</b>'];
    if (tab === 'ownerDraw') parts.push('прибыль не изменится — уменьшатся деньги в обороте');
    if (tab === 'debtor') parts.push('в выручку попадёт только после погашения');
    if (tab === 'writeoff') parts.push('уменьшит прибыль этого месяца');
    var coll = tab === 'debtor' ? 'debtors' : (tab === 'payout' ? 'payouts' : (tab === 'writeoff' ? 'inventory' : 'dds'));
    var dup = Q.duplicate(S.state, coll, { date: v.date, amount: amount, category: v.category,
      name: v.name, employee: v.employee });
    if (dup) parts.push('<b class="c-orange">такая запись за этот день уже есть — не задвойте</b>');
    var warn = Q.warnings({ date: v.date, amount: amount });
    if (warn.length) parts.push('<b class="c-orange">' + u.esc(warn.join(', ')) + '</b>');
    return parts.join(' · ');
  }

  function formValues(form) {
    var out = {};
    if (!form) return out;
    Array.prototype.forEach.call(form.querySelectorAll('input,select,textarea'), function (i) {
      if (i.name) out[i.name] = i.value;
    });
    return out;
  }

  function viewManual() {
    var u = U(), tab = u.tab('manual', 'cashShift'), def = tabDef(tab);
    var f = u.form(tab) || window.WM_EXTRA_FORMS[tab] || {};
    var draft = Q.loadDraft(tab) || {};
    var h = u.pageHead('Записать', 'Всё, чего нет в выгрузках 1С: касса, расходы, зарплата, списания, долги');

    h += '<div class="stat-grid">' + MANUAL_TABS.map(function (t) {
      return '<div class="stat" data-tab="manual:' + t.key + '" ' +
        'style="cursor:pointer;align-items:center;text-align:center;gap:7px' +
        (t.key === tab ? ';background:var(--blue);color:#fff' : '') + '">' +
        '<div style="font-size:20px">' + t.icon + '</div>' +
        '<div style="font-weight:600;font-size:14px">' + esc(t.name) + '</div></div>';
    }).join('') + '</div>';

    h += '<div class="card"><div class="card-head">' +
      '<div class="card-title">' + esc(f.title || 'Запись') + '</div>' +
      '<div class="card-note">' + (Object.keys(draft).length ? 'черновик сохранён — можно продолжить' : 'заполните и нажмите «Записать»') + '</div></div>' +
      '<form id="wmForm" data-fid="' + tab + '"><div class="form-list">' + (f.body ? f.body(draft) : '') + '</div>' +
      '<div class="form-hint" id="quickHint">' + (liveHint(tab, draft) || esc(f.hint || '')) + '</div>' +
      '<div class="quick" style="padding:12px 20px 0">' +
      [100, 500, 1000, 5000].map(function (n) {
        return '<button type="button" class="btn btn-sm" data-act="q-add" data-add="' + n +
          '" data-field="' + def.main + '">+' + u.nf(n) + '</button>';
      }).join('') +
      '<button type="button" class="btn btn-sm" data-act="q-add" data-add="0" data-field="' + def.main + '">Очистить сумму</button>' +
      '</div>' +
      '<div class="form-actions" style="padding:14px 20px">' +
      '<button type="button" class="btn" data-act="q-clear">Стереть черновик</button>' +
      '<button type="submit" class="btn btn-primary btn-lg">Записать</button></div></form></div>';

    h += u.card('Последние записи', u.listOf(manualLog().map(function (r) {
      return '<div class="row">' + u.badge(r.kind, r.tone) +
        '<div class="row-main"><div class="row-title">' + esc(r.title) + '</div>' +
        '<div class="row-sub">' + esc(dateRu(r.date)) + (r.sub ? ' · ' + esc(r.sub) : '') + '</div></div>' +
        '<div class="row-value"><span class="' + (r.sign > 0 ? 'c-green' : (r.sign < 0 ? 'c-red' : '')) + ' private">' +
        E.fmtMoney(r.sum) + '</span></div>' +
        '<button class="btn btn-sm" data-act="q-repeat" data-coll="' + r.coll + '" data-id="' + r.id +
        '" data-target="' + r.form + '" title="Записать такую же">↻</button>' +
        '<button class="btn btn-sm" data-edit="' + r.coll + ':' + r.id + ':' + r.form + '">✎</button>' +
        '<button class="btn btn-sm btn-danger" data-del="' + r.coll + ':' + r.id + '">✕</button></div>';
    }), 'Ручных записей ещё нет'), '↻ повторить · ✎ исправить · ✕ удалить');

    var d = dict();
    h += u.card('Ваши справочники', u.listOf([
      ['🧾', 'Статьи расходов', d.categories], ['👤', 'Кассиры', d.cashiers],
      ['🕘', 'Смены', d.shifts], ['💳', 'Способы оплаты', d.methods],
      ['👥', 'Сотрудники', d.employees], ['🗑', 'Причины списания', d.reasons]
    ].map(function (row) {
      return u.listRow({ icon: row[0], title: esc(row[1]),
        sub: row[2].length ? row[2].slice(0, 8).map(esc).join(' · ') + (row[2].length > 8 ? ' …' : '') : 'пока пусто — впишите своё слово в форме',
        value: '<span class="c-muted">' + row[2].length + '</span>' });
    }), ''), '<button class="btn btn-sm" data-go="settings">Изменить</button>');

    h += '<div class="banner blue"><span>💡</span><span>В полях со списком можно выбрать своё значение или вписать новое — ' +
      'программа его запомнит и в следующий раз предложит.</span></div>';
    return h;
  }

  /* --- Все записи: единый журнал с правкой, удалением и корзиной ------------- */

  // Тип записи → как показать и какой формой править
  var RECORD_KINDS = [
    { id: 'all', name: 'Все' },
    { id: 'dds', name: 'Касса и расходы', coll: 'dds', icon: '💵' },
    { id: 'docs', name: 'Накладные 1С', coll: 'docs', icon: '📄' },
    { id: 'pays', name: 'Оплаты 1С', coll: 'pays', icon: '💸' },
    { id: 'plans', name: 'План выплат', coll: 'plans', icon: '📅' },
    { id: 'payouts', name: 'Зарплата', coll: 'payouts', icon: '👥' },
    { id: 'debtors', name: 'Долги покупателей', coll: 'debtors', icon: '📓' },
    { id: 'inventory', name: 'Списания', coll: 'inventory', icon: '🗑' },
    { id: 'expiry', name: 'Сроки годности', coll: 'expiry', icon: '⏰' },
    { id: 'supreg', name: 'Поставщики', coll: 'supreg', icon: '🏢' }
  ];

  // Одна запись любого журнала в понятном виде
  function recordRow(coll, r) {
    var d = { coll: coll, id: r.id, date: r.date || r.due || r.bestBefore || '', title: '', sub: '', sum: 0, form: '', kind: '' };
    if (coll === 'dds') {
      d.kind = r.type || 'Расход'; d.title = r.category || '—';
      d.sub = [r.shift, r.cashier, r.method, r.note].filter(Boolean).join(' · ');
      d.sum = num(r.amount);
      d.form = r.type === 'Приход' ? 'ddsIncome' : (r.type === 'Забор' ? 'ownerDraw' : 'ddsExpense');
    } else if (coll === 'docs') {
      d.kind = 'Накладная'; d.title = r.firm || r.supplier || '—';
      d.sub = SUP.shortDoc(r.doc) + (r.confirmed ? ' · дата подтверждена' : ' · дата не подтверждена');
      d.sum = num(r.sum); d.form = 'supDoc';
    } else if (coll === 'pays') {
      d.kind = 'Оплата'; d.title = r.firm || r.supplier || 'Выплата из кассы';
      d.sub = SUP.shortDoc(r.doc) + (r.basis ? ' · ' + SUP.shortDoc(r.basis) : '') + (r.category ? ' · ' + r.category : '');
      d.sum = num(r.sum); d.form = 'supPay';
    } else if (coll === 'plans') {
      d.kind = 'Выплата'; d.title = r.supplier || '—'; d.sub = [r.doc, r.method, r.status].filter(Boolean).join(' · ');
      d.sum = num(r.amount); d.form = 'payPlan';
    } else if (coll === 'payouts') {
      d.kind = 'Зарплата'; d.title = r.employee || '—'; d.sub = [r.type, r.form, r.note].filter(Boolean).join(' · ');
      d.sum = num(r.amount); d.form = 'payout';
    } else if (coll === 'debtors') {
      d.kind = 'Долг покупателя'; d.title = r.name || '—';
      d.sub = (r.paid ? 'погашен ' + (dateRu(r.paidDate) || '') : 'обещал ' + (dateRu(r.promise) || '—')) +
        (r.cashier ? ' · записал ' + r.cashier : '');
      d.sum = num(r.sum); d.form = 'debtor';
    } else if (coll === 'inventory') {
      d.kind = 'Списание'; d.title = r.name || '—'; d.sub = r.reason || '';
      d.sum = num(r.accounted) * num(r.price); d.form = 'writeoff';
    } else if (coll === 'expiry') {
      d.kind = 'Срок'; d.title = r.name || '—'; d.sub = 'годен до ' + (dateRu(r.bestBefore) || '—');
      d.sum = num(r.qty) * num(r.price); d.form = 'expiryItem';
    } else if (coll === 'supreg') {
      d.kind = 'Поставщик'; d.title = r.name || '—';
      d.sub = (r.termDays == null ? 'отсрочка не задана' : 'отсрочка ' + r.termDays + ' дн.') +
        ((r.aliases || []).length ? ' · имён в 1С: ' + r.aliases.length : '');
      d.sum = 0; d.form = 'supFirm';
    }
    return d;
  }

  function allRecords(kind, query) {
    var out = [], nq = SUP.norm(query || '');
    RECORD_KINDS.forEach(function (k) {
      if (!k.coll) return;
      if (kind !== 'all' && kind !== k.id) return;
      (S.state[k.coll] || []).forEach(function (r) {
        var row = recordRow(k.coll, r);
        if (nq && SUP.norm(row.title + ' ' + row.sub + ' ' + row.kind + ' ' + row.sum).indexOf(nq) < 0) return;
        out.push(row);
      });
    });
    return out.sort(function (a, b) { return (b.date || '').localeCompare(a.date || ''); });
  }

  function viewRecords() {
    var u = U(), kind = u.tab('records', 'all');
    var q = (document.getElementById('search') && document.getElementById('search').value || '').trim();
    var rows = allRecords(kind, q);
    var trash = (S.state.trash || []).slice().reverse();

    var h = u.pageHead('Все записи', 'Любую запись можно исправить, повторить или удалить — удалённое лежит в корзине',
      (trash.length ? '<button class="btn" data-act="rec-undo">↩ Вернуть последнее</button> ' : '') +
      '<button class="btn" data-act="rec-del-selected">✕ Удалить отмеченные</button>');

    h += '<div class="quick">' + RECORD_KINDS.map(function (k) {
      var n = k.coll ? (S.state[k.coll] || []).length : rows.length;
      return '<button class="btn btn-sm' + (k.id === kind ? ' btn-primary' : '') + '" data-tab="records:' + k.id + '">' +
        (k.icon ? k.icon + ' ' : '') + esc(k.name) + ' <b>' + u.nf(n) + '</b></button>';
    }).join('') + '</div>';

    if (q) h += '<div class="banner blue"><span>🔍</span><span>Показаны записи со словом «' + esc(q) +
      '». Очистите поиск наверху, чтобы увидеть все.</span></div>';

    h += u.card('Записи', u.table('recT', [
      { title: '', cls: 'center', fn: function (r) {
        return '<input type="checkbox" class="rec-pick" data-coll="' + r.coll + '" data-id="' + r.id + '">'; } },
      { title: 'Дата', fn: function (r) { return esc(dateRu(r.date)) || '—'; } },
      { title: 'Что это', fn: function (r) { return u.badge(r.kind, r.kind === 'Приход' ? 'green' :
        (r.kind === 'Долг' || r.kind === 'Долг покупателя' ? 'orange' : (r.kind === 'Поставщик' ? 'gray' : 'blue'))); } },
      { title: 'Кто или за что', fn: function (r) { return esc(r.title); } },
      { title: 'Подробности', fn: function (r) { return '<span class="c-muted">' + esc(r.sub) + '</span>'; } },
      { title: 'Сумма', cls: 'num', fn: function (r) { return r.sum ? u.priv(r.sum) : '—'; } },
      { title: '', cls: 'center', fn: function (r) {
        return '<button class="btn btn-sm" data-act="q-repeat" data-coll="' + r.coll + '" data-id="' + r.id +
          '" data-target="' + r.form + '" title="Повторить">↻</button> ' +
          '<button class="btn btn-sm" data-edit="' + r.coll + ':' + r.id + ':' + r.form + '" title="Исправить">✎</button> ' +
          '<button class="btn btn-sm btn-danger" data-del="' + r.coll + ':' + r.id + '" title="Удалить">✕</button>'; } }
    ], rows, { step: 50, empty: 'Записей пока нет' }),
      rows.length + ' ' + u.plural(rows.length, 'запись', 'записи', 'записей'));

    h += u.card('Корзина', u.listOf(trash.slice(0, 20).map(function (t) {
      var row = recordRow(t.coll, t.rec);
      return '<div class="row"><div class="row-icon">🗑</div>' +
        '<div class="row-main"><div class="row-title">' + esc(row.title || row.kind) + '</div>' +
        '<div class="row-sub">' + esc(row.kind) + ' · ' + esc(dateRu(row.date)) +
        ' · удалено ' + esc(new Date(t.at).toLocaleString('ru-RU').slice(0, 16)) + '</div></div>' +
        '<div class="row-value private">' + E.fmtMoney(row.sum) + '</div>' +
        '<button class="btn btn-sm btn-primary" data-act="rec-restore" data-id="' + t.id + '">Вернуть</button></div>';
    }), 'Корзина пуста'),
      trash.length ? '<button class="btn btn-sm btn-danger" data-act="rec-empty-trash">Очистить корзину (' +
        u.nf(trash.length) + ')</button>' : '');

    h += '<div class="banner"><span>💡</span><span>Удалённое хранится в корзине (последние 200 записей) — ' +
      'пока не очистите, любую можно вернуть. Документы из 1С вернутся сами при следующей загрузке того же файла.</span></div>';
    return h;
  }

  /* --- Долги покупателей ---------------------------------------------------- */
  function viewDebtors() {
    var u = U(), c = sup(), d = c.debtors;
    var h = u.pageHead('Долги покупателей', 'Бывшая тетрадка у кассы · записывает кассир, видит владелец',
      '<button class="btn btn-primary" data-form="debtor">＋ Записать долг</button>');

    h += u.hero('Должны магазину', E.fmtMoney(d.total),
      d.people + ' ' + u.plural(d.people, 'человек', 'человека', 'человек') +
      ' · старше ' + d.oldDays + ' дней <b class="c-red private">' + E.fmtMoney(d.old) + '</b>',
      d.total ? 'c-orange' : 'c-green');

    h += u.card('Кто должен', u.listOf(d.list.map(function (r) {
      return '<div class="row"><div class="row-icon">📓</div>' +
        '<div class="row-main"><div class="row-title">' + esc(r.name) +
        (r.phone ? ' <a class="phone" href="tel:' + esc(r.phone) + '">' + esc(r.phone) + '</a>' : '') + '</div>' +
        '<div class="row-sub">' + esc(dateRu(r.date)) + (r.cashier ? ' · записал ' + esc(r.cashier) : '') +
        (r.promise ? ' · обещал ' + esc(dateRu(r.promise)) : '') + '</div></div>' +
        u.badge(r.ageText, r.tone) +
        '<div class="row-value private">' + E.fmtMoney(r.sum) + '</div>' +
        '<button class="btn btn-sm btn-primary" data-act="sup-debtor-paid" data-id="' + r.id + '">Погасил</button>' +
        '<button class="btn btn-sm btn-danger" data-del="debtors:' + r.id + '">✕</button></div>';
    }), 'Долгов нет — тетрадка пустая'), 'сначала самые старые');

    var paid = (S.state.debtors || []).filter(function (r) { return r.paid; });
    if (paid.length) {
      h += u.card('Погашенные', u.listOf(paid.slice(-10).reverse().map(function (r) {
        return u.listRow({ icon: '✅', title: esc(r.name),
          sub: 'погашен ' + esc(dateRu(r.paidDate || r.date)),
          value: '<span class="c-green private">' + E.fmtMoney(num(r.sum)) + '</span>' });
      }), ''));
    }

    h += '<div class="banner"><span>💡</span><span>Долг покупателя не считается выручкой, пока не погашен — ' +
      'иначе касса не сойдётся.</span></div>';
    return h;
  }

  /* --- Книга «Бухгалтерия» --------------------------------------------------- */
  var RULES = [
    ['💾', 'Книга — это и есть база', 'После каждой записи в программе файл «Бухгалтерия.xlsx» перезаписывается. Отдельно ничего сохранять не нужно.'],
    ['✏️', 'Правьте прямо в Excel', 'Закройте файл после правки — программа увидит изменения и перечитает их. Строку узнаёт по колонке ID; новая строка без ID тоже примется.'],
    ['🧮', 'Листы-отчёты не правятся', 'Отчёт по месяцам, Доходы и расходы, Долг поставщикам и Товар программа пересобирает сама при каждом сохранении.'],
    ['🔑', 'Дублей не будет', 'Накладные и оплаты сверяются по номеру документа: повторная загрузка того же файла из 1С обновляет строку.'],
    ['🛟', 'Копия перед чтением правок', 'Прежняя база уходит в «Данные_дашборда/копии» — если правка в Excel окажется неудачной, есть куда вернуться.']
  ];

  function viewSheets() {
    var u = U(), B = window.WMBook, F = window.WMFiles;
    var built = B.build(S.state, S.settings, { stock: u.data().stock });
    var ready = F.state === 'ready';
    var where = ready ? (F.dirName + '/' + F.BOOK_FILE) : 'папка не подключена';

    var h = u.pageHead('Книга «Бухгалтерия»', 'Вся база лежит в одном файле Excel рядом с программой',
      '<button class="btn" data-act="sup-template">⬇ Скачать копию</button> ' +
      '<button class="btn" data-act="sup-book-read">📖 Прочитать правки</button> ' +
      '<button class="btn btn-primary" data-act="sup-book-save">💾 Сохранить сейчас</button>');

    h += ready
      ? '<div class="banner green"><span>💾</span><span>Книга пишется сама после каждой записи: <b>' +
        esc(where) + '</b>' + (F.bookSaved ? ' · сохранена в ' + F.bookSaved.toLocaleTimeString('ru-RU').slice(0, 5) : '') +
        '. Правьте её в Excel — программа подхватит изменения.</span></div>'
      : '<div class="banner"><span>📂</span><span>Чтобы книга сохранялась в папку, подключите папку программы.</span>' +
        '<button class="btn" data-act="folder-connect">Подключить папку</button></div>';

    h += built.map(function (sh) {
      return '<div class="card"><div class="card-pad">' +
        '<div style="display:flex;gap:12px;align-items:center;flex-wrap:wrap">' +
        u.badge(sh.edit ? 'правится вручную' : 'считается сама', sh.edit ? 'orange' : 'blue') +
        '<span class="card-title">' + esc(sh.name) + '</span>' +
        '<span class="card-note" style="margin-left:auto">' + u.nf(sh.count) + ' ' +
        u.plural(sh.count, 'строка', 'строки', 'строк') + '</span></div>' +
        '<div class="card-note" style="margin-top:4px">' + esc(sh.about || '') + '</div>' +
        '<div style="display:flex;flex-wrap:wrap;gap:7px;margin-top:11px">' +
        (sh.aoa[0] || []).map(function (c) { return '<span class="badge b-gray" style="border-radius:7px">' + esc(c) + '</span>'; }).join('') +
        '</div></div></div>';
    }).join('');

    h += u.card('Правила, по которым живёт файл', u.listOf(RULES.map(function (r) {
      return u.listRow({ icon: r[0], title: esc(r[1]), sub: esc(r[2]) });
    }), ''));
    return h;
  }

  // Скачать книгу копией — когда папка не подключена или нужна копия «на память»
  function downloadBook() {
    var wb = XLSX.utils.book_new();
    window.WMBook.build(S.state, S.settings, { stock: U().data().stock }).forEach(function (sh) {
      XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(sh.aoa), sh.name.slice(0, 31));
    });
    XLSX.writeFile(wb, 'Бухгалтерия_' + today() + '.xlsx');
  }

  /* --- Действия -------------------------------------------------------------- */
  var A = window.WM_EXTRA_ACTIONS = window.WM_EXTRA_ACTIONS || {};
  function docById(id) { return (S.state.docs || []).filter(function (d) { return d.id === id; })[0]; }
  function payById(id) { return (S.state.pays || []).filter(function (p) { return p.id === id; })[0]; }

  A['sup-link'] = function (el) {
    var raw = decodeURIComponent(el.dataset.raw), firm = decodeURIComponent(el.dataset.firm);
    var reg = S.state.supreg = S.state.supreg || [];
    // если это имя уже отдельная фирма — объединяем карточки, иначе просто связываем имя
    if (SUP.findFirm(reg, raw)) SUP.mergeFirms(reg, raw, firm);
    else SUP.linkAlias(reg, raw, firm);
    reFirm(); refresh();
    return '«' + raw + '» теперь считается фирмой «' + firm + '».';
  };
  A['sup-link-own'] = function (el) {
    var raw = decodeURIComponent(el.dataset.raw);
    var reg = S.state.supreg = S.state.supreg || [];
    var f = SUP.findFirm(reg, raw);
    if (f) { f.keepSeparate = true; }
    else SUP.linkAlias(reg, raw, raw);
    reFirm(); refresh();
    return '«' + raw + '» остаётся отдельной фирмой.';
  };
  A['sup-link-other'] = function (el) {
    var raw = decodeURIComponent(el.dataset.raw), u = U();
    var list = firmNames();
    u.sheet('Связать «' + raw + '»',
      (list.length ? '<div class="list">' + list.map(function (f) {
        return '<div class="row tappable" data-act="sup-link" data-raw="' + encodeURIComponent(raw) +
          '" data-firm="' + encodeURIComponent(f) + '"><div class="row-icon">🏢</div>' +
          '<div class="row-main"><div class="row-title">' + esc(f) + '</div></div></div>';
      }).join('') + '</div>' : '<div class="empty">Фирм в справочнике пока нет.</div>') +
      '<div class="form-actions"><button class="btn" data-act="close-sheet">Отмена</button>' +
      '<button class="btn btn-primary" data-form="supFirm">Новая фирма</button></div>');
    return null;
  };
  // после связывания имя фирмы у документов пересчитывается
  function reFirm() {
    var idx = SUP.aliasIndex(S.state.supreg || []);
    (S.state.docs || []).forEach(function (d) { d.firm = SUP.firmOf(d.supplier, idx); });
    (S.state.pays || []).forEach(function (p) { if (p.supplier) p.firm = SUP.firmOf(p.supplier, idx); });
    recalcDates();
    S.save();
  }

  A['sup-empty-pick'] = function () {
    var u = U(), list = firmNames();
    var n = (S.state.docs || []).filter(function (d) { return !SUP.clean(d.supplier) || d.supplier === 'Без контрагента'; }).length;
    u.sheet('Кому относятся документы без контрагента (' + n + ')',
      (list.length ? '<div class="list">' + list.map(function (f) {
        return '<div class="row tappable" data-act="sup-empty-set" data-firm="' + encodeURIComponent(f) + '">' +
          '<div class="row-icon">🏢</div><div class="row-main"><div class="row-title">' + esc(f) + '</div></div></div>';
      }).join('') + '</div>' : '<div class="empty">Фирм в справочнике пока нет.</div>') +
      '<div class="form-actions"><button class="btn" data-act="close-sheet">Отмена</button></div>');
    return null;
  };
  A['sup-empty-set'] = function (el) {
    var firm = decodeURIComponent(el.dataset.firm), n = 0;
    (S.state.docs || []).forEach(function (d) {
      if (!SUP.clean(d.supplier) || d.supplier === 'Без контрагента') { d.supplier = firm; d.firm = firm; n++; }
    });
    (S.state.pays || []).forEach(function (p) {
      if (p.linkKind !== 'other' && !SUP.clean(p.supplier) && p.basis) { p.supplier = firm; p.firm = firm; }
    });
    S.save(); U().closeSheet(); refresh();
    return 'Документов без контрагента отнесено к «' + firm + '»: ' + n + '.';
  };

  A['sup-firm-edit'] = function (el) {
    var name = decodeURIComponent(el.dataset.firm);
    var f = SUP.findFirm(S.state.supreg || [], name) || { name: name, aliases: [], termDays: null };
    U().openForm('supFirm', f);
    return null;
  };

  A['sup-confirm'] = function (el) {
    var d = docById(el.dataset.id); if (!d) return null;
    d.confirmed = true; S.save(); refresh();
    return 'Выплата «' + d.firm + '» подтверждена на ' + dateRu(d.payDate) + '.';
  };
  A['sup-confirm-all'] = function () {
    var q = sup().confirm, n = 0;
    q.forEach(function (x) { var d = docById(x.id); if (d) { d.confirmed = true; n++; } });
    S.save(); refresh();
    return 'Подтверждено накладных: ' + n + '.';
  };
  A['sup-confirm-date'] = function (el) {
    var d = docById(el.dataset.id); if (!d) return null;
    U().sheet('Дата выплаты · ' + d.firm,
      '<form id="supDate" data-id="' + d.id + '"><div class="form-list">' +
      U().fieldRow('Платить', 'date', 'date', d.payDate || today()) + '</div>' +
      '<div class="form-hint">Накладная ' + esc(d.doc) + ' на ' + E.fmtMoney(d.sum) + '.</div>' +
      '<div class="form-actions"><button type="button" class="btn" data-act="close-sheet">Отмена</button>' +
      '<button type="submit" class="btn btn-primary btn-lg">Подтвердить</button></div></form>');
    return null;
  };
  A['sup-doc-paid'] = function (el) {
    var d = docById(el.dataset.id); if (!d) return null;
    d.closedManual = true; d.confirmed = true; S.save(); refresh();
    return 'Накладная ' + d.doc + ' отмечена оплаченной.';
  };
  A['sup-doc-edit'] = function (el) {
    var d = docById(el.dataset.id); if (!d) return null;
    U().openForm('supDoc', d);
    return null;
  };

  A['sup-underpay-debt'] = function (el) {
    var d = docById(el.dataset.id); if (!d) return null;
    d.underpayKeep = true; S.save(); refresh();
    return 'Остаток по накладной ' + d.doc + ' остаётся долгом.';
  };
  A['sup-underpay-round'] = function (el) {
    var d = docById(el.dataset.id); if (!d) return null;
    var calc = sup().docs.filter(function (x) { return x.id === d.id; })[0];
    var left = calc ? calc.left : 0;
    d.roundOff = SUP.round(num(d.roundOff) + left); d.underpayKeep = true;
    S.save(); refresh();
    return 'Списано на округление: ' + E.fmtMoney(left) + '.';
  };

  A['sup-pay-pick'] = function (el) {
    var p = payById(el.dataset.id); if (!p) return null;
    var docs = sup().docs.filter(function (d) {
      return d.left > 0 && (!p.firm || SUP.norm(d.firm) === SUP.norm(p.firm));
    }).slice(0, 40);
    U().sheet('К какой накладной отнести ' + E.fmtMoney(p.sum) + '?',
      (docs.length ? '<div class="list">' + docs.map(function (d) {
        return '<div class="row tappable" data-act="sup-pay-link" data-id="' + p.id + '" data-doc="' + esc(d.key) + '">' +
          '<div class="row-icon">📄</div><div class="row-main"><div class="row-title">' + esc(d.doc) + '</div>' +
          '<div class="row-sub">' + esc(d.firm) + ' · ' + esc(dateRu(d.date)) + '</div></div>' +
          '<div class="row-value private">' + E.fmtMoney(d.left) + '</div></div>';
      }).join('') + '</div>' : '<div class="empty">Неоплаченных накладных этого поставщика нет.</div>') +
      '<div class="form-actions"><button class="btn" data-act="close-sheet">Закрыть</button></div>');
    return null;
  };
  A['sup-pay-link'] = function (el) {
    var p = payById(el.dataset.id); if (!p) return null;
    p.linkKind = 'manual'; p.linkKey = el.dataset.doc; p.resolved = true;
    S.save(); U().closeSheet(); refresh();
    return 'Оплата привязана к накладной.';
  };
  A['sup-pay-advance'] = function (el) {
    var p = payById(el.dataset.id); if (!p) return null;
    p.linkKind = 'advance'; p.resolved = true; S.save(); refresh();
    return 'Оплата учтена как аванс поставщику «' + (p.firm || p.supplier) + '».';
  };
  A['sup-pay-cat'] = function (el) {
    var p = payById(el.dataset.id); if (!p) return null;
    setPayCategory(p, decodeURIComponent(el.dataset.cat));
    return 'Отнесено к статье «' + p.category + '».';
  };
  A['sup-pay-expense'] = function (el) {
    var p = payById(el.dataset.id); if (!p) return null;
    U().sheet('Статья расхода · ' + E.fmtMoney(p.sum),
      '<form id="supCat" data-id="' + p.id + '"><div class="form-list">' +
      U().fieldRow('Статья', 'category', 'select', categories()[0], { options: categories() }) + '</div>' +
      '<div class="form-hint">РКО ' + esc(p.doc) + '. Запись попадёт в расходы магазина.</div>' +
      '<div class="form-actions"><button type="button" class="btn" data-act="close-sheet">Отмена</button>' +
      '<button type="submit" class="btn btn-primary btn-lg">Записать в расходы</button></div></form>');
    return null;
  };
  function setPayCategory(p, cat) {
    p.linkKind = 'expense'; p.category = cat; p.resolved = true;
    S.add('dds', { date: p.date, type: 'Расход', category: cat, method: 'Наличные',
      amount: num(p.sum), note: 'РКО ' + p.doc, source: 'rko' });
    S.save(); refresh();
  }

  A['sup-terms-save'] = function () {
    var inputs = document.querySelectorAll('.term-input'), reg = S.state.supreg = S.state.supreg || [];
    Array.prototype.forEach.call(inputs, function (i) {
      var name = decodeURIComponent(i.dataset.firm);
      var f = SUP.findFirm(reg, name);
      if (!f) { f = SUP.firmRecord(name); reg.push(f); }
      f.termDays = i.value === '' ? null : num(i.value);
    });
    S.save(); recalcDates(); refresh();
    return 'Отсрочки сохранены для ' + inputs.length + ' поставщиков. Неподтверждённые даты пересчитаны.';
  };

  A['sup-debtor-paid'] = function (el) {
    var r = (S.state.debtors || []).filter(function (x) { return x.id === el.dataset.id; })[0];
    if (!r) return null;
    r.paid = true; r.paidDate = today(); S.save(); refresh();
    return 'Долг «' + r.name + '» погашен.';
  };

  A['rec-undo'] = function () {
    var back = S.undo();
    refresh();
    return back ? 'Запись возвращена на место.' : 'Корзина пуста.';
  };
  A['rec-restore'] = function (el) {
    var back = S.restore(el.dataset.id);
    refresh();
    return back ? 'Запись возвращена.' : null;
  };
  A['rec-empty-trash'] = function () {
    var n = (S.state.trash || []).length;
    if (!n) return 'Корзина и так пуста.';
    if (!confirm('Очистить корзину? ' + n + ' записей удалятся насовсем.')) return null;
    S.emptyTrash(); refresh();
    return 'Корзина очищена.';
  };
  A['rec-del-selected'] = function () {
    var picks = document.querySelectorAll('.rec-pick:checked');
    if (!picks.length) return 'Отметьте галочками записи, которые нужно удалить.';
    if (!confirm('Удалить отмеченные записи (' + picks.length + ')? Их можно будет вернуть из корзины.')) return null;
    var n = 0;
    Array.prototype.forEach.call(picks, function (el) {
      if (S.remove(el.dataset.coll, el.dataset.id)) n++;
    });
    refresh();
    return 'Удалено записей: ' + n + '. Вернуть можно из корзины.';
  };

  A['sup-book-save'] = function () { U().saveBook(); return null; };
  A['sup-book-read'] = function () { U().readBook(); return null; };

  A['sup-template'] = function () {
    try { downloadBook(); return 'Копия книги «Бухгалтерия» скачана.'; }
    catch (e) { return 'Не получилось собрать книгу: ' + e.message; }
  };

  /* --- Живой ввод: подсказка, черновик, быстрые суммы ------------------------- */
  function currentTab() { return U().tab('manual', 'cashShift'); }

  // пока печатаете — пересчитываем подсказку и держим черновик
  document.addEventListener('input', function (e) {
    var form = e.target.closest && e.target.closest('#wmForm');
    if (!form) return;
    var tab = form.dataset.fid;
    if (!tabDef(tab) || tabDef(tab).key !== tab) return;
    var v = formValues(form);
    Q.saveDraft(tab, v);
    var hint = document.getElementById('quickHint');
    if (hint) {
      var text = liveHint(tab, v);
      if (text) hint.innerHTML = text;
    }
  });

  A['q-add'] = function (el) {
    var form = document.getElementById('wmForm'); if (!form) return null;
    var field = form.querySelector('[name="' + el.dataset.field + '"]');
    if (!field) return null;
    var add = num(el.dataset.add);
    field.value = add ? SUP.round(num(field.value) + add) : '';
    field.dispatchEvent(new Event('input', { bubbles: true }));
    return null;
  };
  A['q-clear'] = function () {
    Q.clearDraft(currentTab());
    return 'Черновик стёрт.';
  };
  A['q-repeat'] = function (el) {
    var rec = (S.state[el.dataset.coll] || []).filter(function (x) { return x.id === el.dataset.id; })[0];
    if (!rec) return null;
    var copy = JSON.parse(JSON.stringify(rec));
    delete copy.id;
    copy.date = today();
    if (copy.paid) { copy.paid = false; copy.paidDate = ''; }
    U().openForm(el.dataset.target, copy);
    return null;
  };

  /* --- Формы внутри окон ----------------------------------------------------- */
  document.addEventListener('submit', function (e) {
    var f0 = e.target;
    if (f0 && f0.id === 'wmForm' && tabDef(f0.dataset.fid).key === f0.dataset.fid) {
      var tab = f0.dataset.fid;
      // черновик стираем, только если запись действительно сохранилась
      setTimeout(function () {
        if (window.WM_LAST_SAVE && window.WM_LAST_SAVE.form === tab && window.WM_LAST_SAVE.ok) {
          Q.clearDraft(tab);
          U().render();
        }
      }, 30);
    }
  }, true);

  document.addEventListener('submit', function (e) {
    var f = e.target;
    if (f.id === 'supDate') {
      e.preventDefault();
      var d = docById(f.dataset.id);
      var v = f.querySelector('[name="date"]').value;
      if (d && v) { d.payDate = v; d.confirmed = true; S.save(); }
      U().closeSheet(); refresh(); U().render();
      U().toast(d ? ('Выплата «' + d.firm + '» подтверждена на ' + dateRu(v) + '.') : '');
    } else if (f.id === 'supCat') {
      e.preventDefault();
      var p = payById(f.dataset.id);
      var cat = f.querySelector('[name="category"]').value;
      if (p) setPayCategory(p, cat);
      U().closeSheet(); U().render();
      U().toast('Записано в расходы: ' + cat + '.');
    }
  }, true);

  /* --- Регистрация экранов --------------------------------------------------- */
  var VIEWS = window.WM_EXTRA_VIEWS = window.WM_EXTRA_VIEWS || [];
  VIEWS.push(
    // встаём после последнего отчёта, чтобы раздел «Отчёты» не разрывался
    { id: 'import', icon: '📥', name: 'Импорт из 1С', group: 'Данные из 1С', render: viewImport, after: 'finday' },
    { id: 'match', icon: '🔗', name: 'Сопоставление имён', group: 'Данные из 1С', render: viewMatch, after: 'import' },
    { id: 'recon', icon: '🧷', name: 'Разбор оплат', group: 'Данные из 1С', render: viewRecon, after: 'match' },
    { id: 'confirm', icon: '✅', name: 'Подтверждение выплат', group: 'Данные из 1С', render: viewConfirm, after: 'recon' },
    { id: 'terms', icon: '⏱', name: 'Отсрочки поставщиков', group: 'Данные из 1С', render: viewTerms, after: 'confirm' },
    { id: 'manual', icon: '✍️', name: 'Записать', group: 'Ручной ввод', render: viewManual, after: 'terms' },
    { id: 'records', icon: '🗂', name: 'Все записи', group: 'Ручной ввод', render: viewRecords, after: 'manual' },
    { id: 'debtors', icon: '📓', name: 'Долги покупателей', group: 'Ручной ввод', render: viewDebtors, after: 'records' },
    { id: 'sheets', icon: '📗', name: 'Книга Бухгалтерия', group: 'Ручной ввод', render: viewSheets, after: 'debtors' }
  );
})();

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
  function FLT() { return window.WMFilter; }
  function FS() { return window.WMFiles; }      // папка программы и копии базы
  function DET() { return window.WMDetail; }
  function dateBack(days) {
    var d = new Date(today()); d.setDate(d.getDate() - days);
    return d.toISOString().slice(0, 10);
  }
  // Какое окно «Подробнее» открывать для записи из общего списка
  var MORE_BY_COLL = { docs: 'doc', pays: 'pay', supreg: 'firm', debtors: 'debtor',
    dds: 'day', payouts: 'employee', plans: 'firm', inventory: 'product', expiry: 'product' };
  function moreFor(r) {
    var kind = MORE_BY_COLL[r.coll];
    if (!kind) return '';
    var key = r.id;
    if (kind === 'day') key = r.date;
    else if (kind === 'firm' || kind === 'product' || kind === 'employee') key = E.norm(r.title);
    if (!key) return '';
    return DET().btn(kind, key, '👁');
  }

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
      var bad = Q.checkAmount(v.amount); if (bad) return bad;
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
      var badSum = Q.checkAmount(v.sum); if (badSum) return badSum;
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
      var badAmount = Q.checkAmount(v.amount); if (badAmount) return badAmount;
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
    hint: 'Ваша цифра главнее выгрузки: повторная загрузка того же файла из 1С её не затрёт.',
    save: function (v) {
      var d = (S.state.docs || []).filter(function (x) { return x.doc === v.doc; })[0];
      if (!d) return 'Накладная не найдена.';
      // запоминаем, что именно владелец поправил: это и есть правда,
      // 1С при следующей загрузке эти поля не тронет
      var mine = [];
      if (v.date && v.date !== d.date) { d.date = v.date; mine.push('date'); }
      if (v.firm && v.firm !== d.firm) { d.firm = v.firm; mine.push('firm'); }
      if (num(v.sum) !== num(d.sum)) { d.sum = num(v.sum); mine.push('sum'); }
      if (num(v.retail) !== num(d.retail)) { d.retail = num(v.retail); mine.push('retail'); }
      if (v.payDate) { d.payDate = v.payDate; d.confirmed = true; mine.push('payDate'); }
      SUP.markMine(d, mine);
      S.save(); refresh();
      var diff = SUP.conflicts(d);
      return { ok: 'Накладная ' + d.doc + ' обновлена.' +
        (diff.length ? ' Ваша цифра теперь главнее 1С — расхождение видно на экране «Расхождения с 1С».' : '') };
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
      var mine = [];
      if (v.date && v.date !== p.date) mine.push('date');
      if (v.firm && v.firm !== p.firm) mine.push('firm');
      if (num(v.sum) !== num(p.sum)) mine.push('sum');
      if ((v.basis || '') !== (p.basis || '')) mine.push('basis');
      SUP.markMine(p, mine);
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

    var nnDefs = [
      { key: 'kind', name: 'Что предлагаем', auto: function (n) { return n.reason; }, limit: 10 },
      { key: 'has', name: 'Где встречается', options: [
        { v: 'docs', name: 'В накладных', test: function (n) { return n.docs > 0; } },
        { v: 'pays', name: 'В оплатах', test: function (n) { return n.pays > 0; } }
      ] },
      { key: 'sum', name: 'Сумма', options: [
        { v: 'big', name: 'От 50 000', test: function (n) { return n.sum >= 50000; } },
        { v: 'mid', name: 'До 50 000', test: function (n) { return n.sum < 50000; } }
      ] }
    ];
    var newNames = FLT().apply('match', c.newNames, nnDefs, function (n) { return n.raw + ' ' + n.firm; });
    if (c.newNames.length) h += FLT().bar('match', nnDefs, c.newNames, { search: 'имя из 1С' });

    h += u.card('Новые имена', u.listOf(newNames.map(function (n) {
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
    }), FLT().active('match') ? 'Под фильтр ничего не подошло' : 'Новых имён нет'),
      'программа предлагает — вы подтверждаете');

    var fDefs = [
      { key: 'debt', name: 'Долг', options: [
        { v: 'yes', name: 'Есть долг', test: function (f) { return f.left > 0; } },
        { v: 'no', name: 'Нет долга', test: function (f) { return f.left <= 0; } }
      ] },
      { key: 'reps', name: 'Имена в 1С', options: [
        { v: 'many', name: 'Несколько имён', test: function (f) { return f.reps.length > 0; } },
        { v: 'one', name: 'Одно имя', test: function (f) { return f.reps.length === 0; } }
      ] },
      { key: 'term', name: 'Отсрочка', options: [
        { v: 'none', name: 'Не задана', test: function (f) { return f.term === null; } },
        { v: 'set', name: 'Задана', test: function (f) { return f.term !== null; } }
      ] }
    ];
    var firms = FLT().apply('matchFirms', c.firms, fDefs, function (f) { return f.firm + ' ' + f.reps.join(' '); });
    h += FLT().bar('matchFirms', fDefs, c.firms, { search: 'фирма или представитель' });
    h += FLT().note(firms.length, c.firms.length);

    h += u.card('Фирмы и торговые представители', u.listOf(firms.map(function (f) {
      var reps = f.reps.map(function (r) { return '<span class="badge b-gray">' + esc(r) + '</span>'; }).join(' ');
      return '<div class="row" style="align-items:flex-start">' +
        '<div class="row-icon">🏢</div>' +
        '<div class="row-main"><div class="row-title">' + DET().link('firm', E.norm(f.firm), f.firm) + '</div>' +
        '<div class="row-sub">' + f.docs + ' ' + u.plural(f.docs, 'накладная', 'накладные', 'накладных') +
        ' · ' + (f.term === null ? 'отсрочка не задана' : 'отсрочка ' + f.term + ' дн.') + '</div>' +
        (reps ? '<div style="margin-top:7px">' + reps + '</div>' : '') + '</div>' +
        '<div class="row-value private">' + E.fmtMoney(f.left) + '</div>' +
        DET().btn('firm', E.norm(f.firm)) + ' ' +
        '<button class="btn btn-sm" data-act="sup-firm-edit" data-firm="' + encodeURIComponent(f.firm) + '">✎</button>' +
        '</div>';
    }), FLT().active('matchFirms') ? 'Под фильтр ничего не подошло' : 'Накладных ещё нет'),
      'долг считается по фирме');
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

    var recDefs = [
      { key: 'kind', name: 'Что не сошлось', options: [
        { v: 'underpay', name: 'Недоплата', test: function (r) { return r.kind === 'underpay'; } },
        { v: 'nobasis', name: 'Без основания', test: function (r) { return r.kind === 'nobasis'; } },
        { v: 'other', name: 'Не поставщик', test: function (r) { return r.kind !== 'underpay' && r.kind !== 'nobasis'; } },
        { v: 'round', name: 'Похоже на округление', test: function (r) { return !!r.roundable; } }
      ] },
      { key: 'size', name: 'Сумма', options: [
        { v: 'big', name: 'От 5 000', test: function (r) { return num(r.sum) >= 5000; } },
        { v: 'small', name: 'До 5 000', test: function (r) { return num(r.sum) < 5000; } }
      ] }
    ];
    var recon = FLT().apply('recon', c.recon, recDefs, function (r) { return (r.title || '') + ' ' + (r.sub || ''); });
    h += FLT().bar('recon', recDefs, c.recon, { search: 'поставщик или документ' });

    h += u.card('Разберите вручную', u.listOf(recon.map(function (r) {
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
        '<div class="row-value private">' + E.fmtMoney(r.sum) + '</div>' +
        // у недоплаты id — это накладная, у остальных — оплата
        DET().btn(r.kind === 'underpay' ? 'doc' : 'pay', r.id) + '</div>';
    }), FLT().active('recon') ? 'Под фильтр ничего не подошло' : 'Всё сошлось — разбирать нечего'),
      recon.length + ' из ' + c.recon.length + ' ' + u.plural(c.recon.length, 'запись', 'записи', 'записей'));
    return h;
  }

  /* --- Подтверждение выплат -------------------------------------------------- */
  function viewConfirm() {
    var u = U(), c = sup(), all = c.confirm;
    var h = u.pageHead('Подтверждение выплат', 'Дата предложена по отсрочке поставщика — подтвердите каждую накладную',
      all.length ? '<button class="btn btn-primary" data-act="sup-confirm-all">Подтвердить все</button>' : '');

    var done = c.docs.filter(function (d) { return d.confirmed; }).length;
    h += '<div class="banner blue"><span>💡</span><span>' + all.length + ' из ' + c.docs.length +
      ' ждут решения · ' + done + ' уже в календаре выплат. Ничего не платится автоматически.</span></div>';

    var cfDefs = [
      { key: 'firm', name: 'Поставщик', auto: function (d) { return d.supplier || d.firm; }, limit: 14 },
      { key: 'term', name: 'Отсрочка', options: [
        { v: 'known', name: 'Задана', test: function (d) { return d.termKnown; } },
        { v: 'unknown', name: 'Не задана', test: function (d) { return !d.termKnown; } }
      ] },
      { key: 'due', name: 'Срок', options: [
        { v: 'past', name: 'Уже прошёл', test: function (d) { return d.due && d.due < today(); } },
        { v: 'today', name: 'Сегодня', test: function (d) { return d.due === today(); } },
        { v: 'soon', name: 'Ближайшая неделя', test: function (d) {
          if (!d.due) return false;
          var w = new Date(today()); w.setDate(w.getDate() + 7);
          return d.due > today() && d.due <= w.toISOString().slice(0, 10); } }
      ] },
      { key: 'sum', name: 'Сумма', options: [
        { v: 'big', name: 'От 20 000', test: function (d) { return d.sum >= 20000; } },
        { v: 'mid', name: 'До 20 000', test: function (d) { return d.sum < 20000; } }
      ] }
    ];
    var q = FLT().apply('confirm', all, cfDefs, function (d) { return (d.supplier || '') + ' ' + (d.doc || '') + ' ' + (d.incomingNo || ''); });
    h += FLT().bar('confirm', cfDefs, all, { search: 'поставщик или номер' });
    h += FLT().note(q.length, all.length, 'на сумму ' + E.fmtMoney(q.reduce(function (a, d) { return a + d.sum; }, 0)));

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
        DET().btn('doc', d.id, 'Подробнее') +
        '</span></div></div></div>';
    }).join('');

    if (q.length > limit) {
      h += '<div class="more"><button class="btn" data-act="more" data-id="confirmQ" data-step="40">' +
        'Показать ещё (' + u.nf(q.length - limit) + ')</button></div>';
    }
    if (!q.length) h += u.card(all.length ? 'Под фильтр ничего не подошло' : 'Всё подтверждено',
      '<div class="empty">' + (all.length ? 'Снимите фильтры, чтобы увидеть остальные накладные.'
        : 'Новых накладных без даты выплаты нет.') + '</div>');
    return h;
  }

  /* --- Отсрочки ------------------------------------------------------------- */
  function viewTerms() {
    var u = U(), c = sup();
    var h = u.pageHead('Отсрочки поставщиков', 'Задаётся один раз. Дата выплаты = дата накладной + отсрочка',
      '<button class="btn btn-primary" data-form="supFirm">＋ Поставщик</button>');

    var tDefs = [
      { key: 'term', name: 'Отсрочка', options: [
        { v: 'none', name: 'Не задана', test: function (r) { return r.term === null || r.term === undefined; } },
        { v: 'now', name: 'Оплата сразу', test: function (r) { return r.termShown === 0; } },
        { v: 'set', name: 'Задана', test: function (r) { return r.term !== null && r.term !== undefined && r.termShown > 0; } }
      ] },
      { key: 'debt', name: 'Долг', options: [
        { v: 'yes', name: 'Есть долг', test: function (r) { return r.left > 0; } },
        { v: 'over', name: 'Просрочен', test: function (r) { return r.overdue > 0; } },
        { v: 'no', name: 'Нет долга', test: function (r) { return r.left <= 0; } }
      ] },
      { key: 'freq', name: 'Как часто возит', options: [
        { v: 'often', name: 'Чаще раза в неделю', test: function (r) { return r.freq >= 4; } },
        { v: 'rare', name: 'Редко', test: function (r) { return r.freq < 1; } }
      ] }
    ];
    var terms = FLT().apply('terms', c.terms, tDefs, function (r) { return r.firm; });
    h += FLT().bar('terms', tDefs, c.terms, { search: 'название фирмы' });

    h += u.card('Поставщики', FLT().note(terms.length, c.terms.length) + u.table('supTerms', [
      { title: 'Поставщик', fn: function (r) { return DET().link('firm', E.norm(r.firm), r.firm); } },
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
        return DET().btn('firm', E.norm(r.firm), 'Подробнее') +
          ' <button class="btn btn-sm" data-act="sup-firm-edit" data-firm="' + encodeURIComponent(r.firm) + '">✎</button>'; } }
    ], terms, { step: 40, empty: FLT().active('terms') ? 'Под фильтр ничего не подошло' : 'Накладных из 1С ещё нет' }) +
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

    h += '<div class="quick">' +
      '<button class="btn btn-primary" data-form="quickLine">⌨️ Записать строкой</button>' +
      '<button class="btn" data-form="bulkLines">📋 Много записей сразу</button>' +
      '<button class="btn" data-act="repeat-shift">↻ Как в прошлый раз</button>' +
      (EN().clip() ? '<button class="btn" data-act="rec-paste">📎 Вставить скопированное</button>' : '') +
      '</div>';

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
    var d = { coll: coll, id: r.id, date: r.date || r.due || r.bestBefore || '', title: '', sub: '', sum: 0,
      form: '', kind: '', source: r.source || 'мои', mine: r.mine || null };
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
    var allRows = allRecords(kind, q);
    var recDefs = [
      { key: 'kind', name: 'Что это', auto: function (r) { return r.kind; }, limit: 12 },
      // чтобы данные 1С не мешали видеть свои записи
      { key: 'src', name: 'Откуда', options: [
        { v: 'my', name: 'Только мои', test: function (r) { return r.source !== '1c'; } },
        { v: '1c', name: 'Только из 1С', test: function (r) { return r.source === '1c'; } },
        { v: 'fixed', name: 'Исправленные мной', test: function (r) { return !!(r.mine && r.mine.length); } }
      ] },
      { key: 'sum', name: 'Сумма', options: [
        { v: 'big', name: 'От 10 000', test: function (r) { return num(r.sum) >= 10000; } },
        { v: 'mid', name: '1 000 – 10 000', test: function (r) { return num(r.sum) >= 1000 && num(r.sum) < 10000; } },
        { v: 'small', name: 'До 1 000', test: function (r) { return num(r.sum) > 0 && num(r.sum) < 1000; } },
        { v: 'none', name: 'Без суммы', test: function (r) { return !num(r.sum); } }
      ] },
      { key: 'when', name: 'Когда', options: [
        { v: 'd', name: 'Сегодня', test: function (r) { return r.date === today(); } },
        { v: 'w', name: 'Неделя', test: function (r) { return r.date >= dateBack(7); } },
        { v: 'm', name: 'Месяц', test: function (r) { return r.date >= dateBack(30); } },
        { v: 'q', name: 'Три месяца', test: function (r) { return r.date >= dateBack(90); } }
      ] }
    ];
    var rows = FLT().apply('records', allRows, recDefs, function (r) { return r.title + ' ' + r.sub; });
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

    h += FLT().bar('records', recDefs, allRows, { search: 'кто, за что, сумма' });

    h += u.card('Записи', u.table('recT', [
      { title: '', cls: 'center', fn: function (r) {
        return '<input type="checkbox" class="rec-pick" data-coll="' + r.coll + '" data-id="' + r.id + '">'; } },
      { title: 'Дата', fn: function (r) { return r.date ? DET().link('day', r.date, dateRu(r.date)) : '—'; } },
      { title: 'Что это', fn: function (r) { return u.badge(r.kind, r.kind === 'Приход' ? 'green' :
        (r.kind === 'Долг' || r.kind === 'Долг покупателя' ? 'orange' : (r.kind === 'Поставщик' ? 'gray' : 'blue'))); } },
      { title: 'Кто или за что', fn: function (r) {
        return esc(r.title) +
          (r.source === '1c' ? ' <span class="badge b-gray">1С</span>' : '') +
          (r.mine && r.mine.length ? ' <span class="badge b-orange">исправлено</span>' : ''); } },
      { title: 'Подробности', fn: function (r) { return '<span class="c-muted">' + esc(r.sub) + '</span>'; } },
      { title: 'Сумма', cls: 'num', fn: function (r) { return r.sum ? u.priv(r.sum) : '—'; } },
      { title: '', cls: 'center', fn: function (r) {
        // все действия в одном меню: смотреть, изменить, повторить, копировать, удалить
        var mk = MORE_BY_COLL[r.coll];
        var moreKey = mk === 'day' ? r.date
          : (mk === 'firm' || mk === 'product' || mk === 'employee' ? E.norm(r.title) : r.id);
        return U().rowMenu(r.coll, r.id, {
          form: r.form,
          more: mk && moreKey ? { kind: mk, key: moreKey } : null
        }); } }
    ], rows, { step: 50, empty: FLT().active('records') ? 'Под фильтр ничего не подошло' : 'Записей пока нет' }),
      FLT().note(rows.length, allRows.length) ||
      (rows.length + ' ' + u.plural(rows.length, 'запись', 'записи', 'записей')));

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

    var dbDefs = [
      { key: 'age', name: 'Давность', options: [
        { v: 'old', name: 'Старые (' + d.oldDays + '+ дн.)', test: function (r) { return r.age >= d.oldDays; } },
        { v: 'week', name: 'Больше недели', test: function (r) { return r.age >= 7; } },
        { v: 'new', name: 'Свежие', test: function (r) { return r.age < 7; } }
      ] },
      { key: 'promise', name: 'Обещание', options: [
        { v: 'broken', name: 'Срок обещания прошёл', test: function (r) { return r.promise && r.promise < today(); } },
        { v: 'has', name: 'Обещал вернуть', test: function (r) { return !!r.promise; } },
        { v: 'none', name: 'Без обещания', test: function (r) { return !r.promise; } }
      ] },
      { key: 'who', name: 'Кто записал', auto: function (r) { return r.cashier; }, limit: 10 },
      { key: 'sum', name: 'Сумма', options: [
        { v: 'big', name: 'От 1 000', test: function (r) { return r.sum >= 1000; } },
        { v: 'small', name: 'До 1 000', test: function (r) { return r.sum < 1000; } }
      ] }
    ];
    var debtRows = FLT().apply('debtors', d.list, dbDefs, function (r) { return r.name + ' ' + (r.phone || ''); });
    h += FLT().bar('debtors', dbDefs, d.list, { search: 'имя или телефон' });
    h += FLT().note(debtRows.length, d.list.length,
      'на ' + E.fmtMoney(debtRows.reduce(function (a, r) { return a + r.sum; }, 0)));

    h += u.card('Кто должен', u.listOf(debtRows.map(function (r) {
      return '<div class="row"><div class="row-icon">📓</div>' +
        '<div class="row-main"><div class="row-title">' + esc(r.name) +
        (r.phone ? ' <a class="phone" href="tel:' + esc(r.phone) + '">' + esc(r.phone) + '</a>' : '') + '</div>' +
        '<div class="row-sub">' + esc(dateRu(r.date)) + (r.cashier ? ' · записал ' + esc(r.cashier) : '') +
        (r.promise ? ' · обещал ' + esc(dateRu(r.promise)) : '') + '</div></div>' +
        u.badge(r.ageText, r.tone) +
        '<div class="row-value private">' + E.fmtMoney(r.sum) + '</div>' +
        DET().btn('debtor', r.id) +
        '<button class="btn btn-sm btn-primary" data-act="sup-debtor-paid" data-id="' + r.id + '">Погасил</button>' +
        '<button class="btn btn-sm btn-danger" data-del="debtors:' + r.id + '">✕</button></div>';
    }), FLT().active('debtors') ? 'Под фильтр ничего не подошло' : 'Долгов нет — тетрадка пустая'), 'сначала самые старые');

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

  /* --- Сброс и откат базы ---------------------------------------------------
     Каждое действие сначала кладёт копию в папку, потом делает своё дело.
     Так «очистить всё» перестаёт быть точкой невозврата.
     -------------------------------------------------------------------- */
  async function safetyCopy(tag) {
    if (FS().state !== 'ready') return '';
    return await FS().backupNow(function () { return S.state; }, tag);
  }

  A['base-list-backups'] = function () {
    if (FS().state !== 'ready') return 'Папка не подключена — копий нет. Подключите её на экране «Данные и файлы».';
    FS().listBackups().then(function (list) {
      BACKUPS = list;
      U().render();
      U().toast(list.length ? 'Копий найдено: ' + list.length + '. Выберите, на какую откатиться.'
        : 'Копий пока нет — они появятся после первой записи.');
    });
    return null;
  };

  A['base-rollback'] = function (el) {
    var name = decodeURIComponent(el.dataset.name || '');
    if (!name) return null;
    var human = name.replace(/^база-(\d{4})-(\d{2})-(\d{2})-(\d{2})-(\d{2})\.json$/i, '$3.$2.$1 в $4:$5');
    if (!confirm('Откатить базу на ' + human + '?\n\nВсё, что записано после этого момента, ' +
      'из базы уйдёт. Прямо сейчас будет сохранена копия сегодняшнего состояния — ' +
      'на неё можно будет вернуться.')) return null;
    (async function () {
      var copy = await safetyCopy('перед откатом на ' + human);
      var data = await FS().readBackup(name);
      if (!data) { U().toast('Не получилось прочитать копию ' + name); return; }
      S.replaceAll(data);
      refresh(); U().render();
      U().toast('База откачена на ' + human + '.' +
        (copy ? ' Прежнее состояние сохранено в копию ' + copy + '.' : ''), 11000);
    })();
    return null;
  };

  A['base-clear-coll'] = function (el) {
    var coll = el.dataset.coll, name = decodeURIComponent(el.dataset.name || coll);
    var n = (S.state[coll] || []).length;
    if (!n) return 'Здесь и так пусто.';
    if (!confirm('Очистить раздел «' + name + '»? Удалится ' + n + ' записей.\n\n' +
      'Копия базы будет сохранена — откатиться можно на экране «Сброс и откат базы».')) return null;
    (async function () {
      var copy = await safetyCopy('перед очисткой «' + name + '»');
      S.clear(coll);
      refresh(); U().render();
      U().toast('Раздел «' + name + '» очищен.' + (copy ? ' Копия: ' + copy : ''), 9000);
    })();
    return null;
  };

  A['base-drop-1c'] = function () {
    var count = 0;
    ['docs', 'pays'].forEach(function (c) {
      count += (S.state[c] || []).filter(function (r) { return r.source === '1c'; }).length;
    });
    if (!count) return 'Данных из 1С в базе нет.';
    if (!confirm('Убрать из базы всё, что пришло из 1С (' + count + ' записей)?\n\n' +
      'Ваши собственные записи останутся на месте. Выгрузки можно будет загрузить заново.\n' +
      'Копия базы будет сохранена.')) return null;
    (async function () {
      var copy = await safetyCopy('перед удалением данных 1С');
      ['docs', 'pays'].forEach(function (c) {
        S.state[c] = (S.state[c] || []).filter(function (r) { return r.source !== '1c'; });
      });
      // фирмы, которые программа завела сама под имена из 1С и по которым
      // не осталось ни одного документа, тоже убираем — иначе справочник зарастает
      var used = {};
      (S.state.docs || []).concat(S.state.pays || []).forEach(function (r) {
        if (r.firm) used[SUP.norm(r.firm)] = 1;
      });
      S.state.supreg = (S.state.supreg || []).filter(function (f) {
        return f.source !== 'auto' || used[SUP.norm(f.name)];
      });
      S.save(); refresh(); U().render();
      U().toast('Данные 1С убраны: ' + count + ' записей. Ваши записи на месте.' +
        (copy ? ' Копия: ' + copy : ''), 11000);
    })();
    return null;
  };

  A['base-clear-all'] = function () {
    var total = 0;
    S.COLLECTIONS.forEach(function (c) { total += (S.state[c] || []).length; });
    if (!confirm('Очистить всю базу? Удалится ' + total + ' записей и сбросятся настройки.\n\n' +
      'Копия базы будет сохранена в папку — на неё можно откатиться.')) return null;
    if (!confirm('Точно очистить? Это последнее предупреждение.')) return null;
    (async function () {
      var copy = await safetyCopy('перед полной очисткой базы');
      S.clear();
      refresh(); U().render();
      U().toast('База очищена.' + (copy ? ' Всё прежнее лежит в копии ' + copy +
        ' — откатиться можно здесь же.' : ' Копия не сохранена: папка не подключена.'), 13000);
    })();
    return null;
  };

  A['conf-revert'] = function (el) {
    var rec = (S.state[el.dataset.coll] || []).filter(function (x) { return x.id === el.dataset.id; })[0];
    if (!rec) return 'Запись не найдена.';
    var diff = SUP.conflicts(rec);
    if (!diff.length) return 'Здесь и так всё как в 1С.';
    if (!confirm('Вернуть значения из 1С по документу ' + SUP.shortDoc(rec.doc) + '?\n\n' +
      diff.map(function (d) { return fieldRu(d.field) + ': ' + valRu(d.field, d.now) +
        ' → ' + valRu(d.field, d.was); }).join('\n'))) return null;
    diff.forEach(function (d) { SUP.unmark(rec, d.field); });
    if (rec.basis !== undefined) rec.basisKey = SUP.norm(rec.basis);
    S.save(); refresh();
    return 'Значения вернулись как в 1С.';
  };

  A['conf-revert-all'] = function () {
    var list = conflictList();
    if (!list.length) return 'Расхождений нет.';
    if (!confirm('Вернуть как в 1С все ' + list.length + ' исправлений?\n\n' +
      'Ваши правки по этим документам будут сняты. Копия базы сохранится.')) return null;
    (async function () {
      var copy = await safetyCopy('перед возвратом всех значений к 1С');
      list.forEach(function (c) {
        var rec = (S.state[c.coll] || []).filter(function (x) { return x.id === c.id; })[0];
        if (!rec) return;
        c.diff.forEach(function (d) { SUP.unmark(rec, d.field); });
        if (rec.basis !== undefined) rec.basisKey = SUP.norm(rec.basis);
      });
      S.save(); refresh(); U().render();
      U().toast('Все значения вернулись как в 1С.' + (copy ? ' Копия ваших правок: ' + copy : ''), 10000);
    })();
    return null;
  };

  /* --- Проверка базы и журнал ------------------------------------------------ */
  A['check-again'] = function () {
    var n = (window.WMAlerts ? window.WMAlerts.checkBase(S.state) : [])
      .reduce(function (a, p) { return a + p.count; }, 0);
    U().render();
    return n ? 'Проверено: сломанных записей — ' + n + '.' : 'Проверено: база в порядке.';
  };

  A['check-show'] = function (el) {
    var kind = el.dataset.kind;
    var p = (window.WMAlerts ? window.WMAlerts.checkBase(S.state) : [])
      .filter(function (x) { return x.kind === kind; })[0];
    if (!p) return 'Такой проблемы больше нет.';
    var u = U();
    // ищем сами записи по всей базе: одна проблема бывает в разных списках
    var rows = [];
    S.COLLECTIONS.forEach(function (coll) {
      (S.state[coll] || []).forEach(function (r) {
        if (p.ids.indexOf(r.id) >= 0) rows.push({ coll: coll, rec: r });
      });
    });
    u.sheet(p.text.charAt(0).toUpperCase() + p.text.slice(1) + ' — ' + p.count,
      '<div class="detail">' +
      '<div class="banner"><span>&#9888;</span><span>' + esc(CHECK_HELP[kind] || '') + '</span></div>' +
      u.table('checkRows', [
        { title: 'Где', fn: function (r) { return esc(S.COLL_RU[r.coll] || r.coll); } },
        { title: 'Дата', fn: function (r) { return esc(dateRu(r.rec.date)) || '<span class="c-red">нет</span>'; } },
        { title: 'Кто или что', fn: function (r) {
          return esc(r.rec.firm || r.rec.supplier || r.rec.name || r.rec.category || r.rec.doc || '—'); } },
        { title: 'Документ', fn: function (r) { return esc(SUP.shortDoc(r.rec.doc || '')) || '—'; } },
        { title: 'Сумма', cls: 'num', fn: function (r) {
          return E.fmtMoney(num(r.rec.sum != null ? r.rec.sum : r.rec.amount)); } },
        { title: '', cls: 'center', fn: function (r) {
          return '<button class="btn btn-sm btn-danger" data-del="' + r.coll + ':' + r.rec.id + '">Удалить</button>'; } }
      ], rows, { step: 60 }) + '</div>');
    return null;
  };

  A['check-drop'] = function (el) {
    var kind = el.dataset.kind;
    var p = (window.WMAlerts ? window.WMAlerts.checkBase(S.state) : [])
      .filter(function (x) { return x.kind === kind; })[0];
    if (!p || !p.coll) return 'Тут нечего удалять автоматически — посмотрите список.';
    if (!confirm('Удалить ' + p.count + ' ' + u2('запись', 'записи', 'записей', p.count) +
      ' («' + p.text + '»)?\n\nОни уедут в корзину, вернуть можно на экране «Все записи». ' +
      'Копия базы тоже сохранится.')) return null;
    (async function () {
      var copy = await safetyCopy('перед удалением: ' + p.text);
      p.ids.forEach(function (id) { S.remove(p.coll, id); });
      refresh(); U().render();
      U().toast('Удалено записей: ' + p.count + '. Вернуть можно из корзины.' +
        (copy ? ' Копия: ' + copy : ''), 9000);
    })();
    return null;
  };
  function u2(one, few, many, n) { return U().plural(n, one, few, many); }

  A['log-undo'] = function (el) {
    var row = (S.state.log || []).filter(function (r) { return r.id === el.dataset.id; })[0];
    if (!row) return 'Действие не найдено.';
    if (!confirm('Отменить это действие?\n\n' + row.what + ' · ' + row.collName +
      (row.title ? ' · ' + row.title : '') + '\n\nЗапись вернётся такой, какой была до него.')) return null;
    var back = S.logUndo(row.id);
    if (!back) return 'Это действие отменить нельзя: программа не помнит, что было до него.';
    refresh();
    return 'Отменено. Запись вернулась к прежнему виду.';
  };

  A['backup2-connect'] = function () {
    FS().connectBackup().then(function () {
      return FS().copyToBackup(function () { return S.state; }, 'первая копия');
    }).then(function (name) {
      FS().markCopied(); U().render();
      U().toast(name ? 'Папка подключена, копия положена: ' + name : 'Папка подключена.', 9000);
    }).catch(function (e) {
      var why = FS().humanError(e);
      if (why) U().toast(why, 10000);
    });
    return null;
  };
  A['backup2-now'] = function () {
    FS().copyToBackup(function () { return S.state; }, 'по кнопке').then(function (name) {
      FS().markCopied(); U().render();
      U().toast(name ? 'Копия положена: ' + name : 'Не получилось записать во вторую папку.', 9000);
    });
    return null;
  };
  A['backup2-forget'] = function () {
    if (!confirm('Больше не класть копии во вторую папку?')) return null;
    FS().forgetBackup(); U().render();
    return 'Вторая папка отключена.';
  };

  /* --- Файл для бухгалтера ---------------------------------------------------
     Один xlsx со всем, что обычно просят: доходы и расходы по дням, статьи,
     поставщики, зарплата и налог за период.
     -------------------------------------------------------------------- */
  A['export-buh'] = function () {
    var range = U().periodRange();
    var d = window.WMExtra.accountantData(S.state, S.settings, F, sup(), range.from, range.to);
    var wb = XLSX.utils.book_new();
    function add(name, aoa) {
      XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(aoa), name.slice(0, 31));
    }
    add('Сводка', [
      ['Магазин', S.settings.storeName || ''],
      ['ИНН', S.settings.inn || ''],
      ['Период', dateRu(d.from) + ' — ' + dateRu(d.to)],
      [],
      ['Показатель', 'Сумма'],
      ['Приход', d.totals.income],
      ['Расход', d.totals.expense],
      ['Прибыль', d.totals.profit],
      ['Закуп товара', d.totals.purchase],
      ['Зарплата', d.totals.salary],
      ['Аренда', d.totals.rent],
      ['Взято в долг', d.totals.debtTaken],
      ['Погашено долга', d.totals.debtPaid],
      [],
      ['Налог', d.tax.name],
      ['База', d.tax.base],
      ['Ставка, %', d.tax.rate],
      ['Сумма налога', d.tax.sum]
    ]);
    add('По дням', [['Дата', 'Приход', 'Расход', 'Прибыль']].concat(
      d.days.map(function (r) { return [r.date, r.income, r.expense, r.profit]; })));
    add('Статьи расходов', [['Статья', 'Сумма', 'Доля %', 'Записей']].concat(
      d.categories.map(function (c) { return [c.name, c.sum, c.share, c.count]; })));
    add('Способы оплаты', [['Способ', 'Сумма', 'Доля %']].concat(
      d.methods.map(function (m) { return [m.name, m.sum, m.share]; })));
    add('Поставщики', [['Дата', 'Поставщик', 'Документ', 'Сумма закуп', 'Оплачено', 'Долг']].concat(
      d.docs.map(function (r) { return [r.date, r.firm, r.doc, r.sum, r.paid, r.left]; })));
    add('Оплаты', [['Дата', 'Поставщик', 'Документ', 'Сумма', 'Касса']].concat(
      d.pays.map(function (r) { return [r.date, r.firm || r.supplier, r.doc, num(r.sum), r.cashbox]; })));
    add('Зарплата', [['Дата', 'Сотрудник', 'Что', 'Сумма', 'Чем']].concat(
      d.payouts.map(function (r) { return [r.date, r.employee, r.type, num(r.amount), r.form]; })));
    add('Табель', [['Дата', 'Сотрудник', 'Смена', 'Часы', 'Ставка', 'Премия', 'Штраф', 'Начислено']].concat(
      d.timesheet.map(function (r) {
        return [r.date, r.employee, r.shift, num(r.hours), num(r.rate), num(r.bonus), num(r.penalty),
          E.timesheetCalc(r)]; })));

    var name = 'Для-бухгалтера-' + d.from + '_' + d.to + '.xlsx';
    XLSX.writeFile(wb, name);
    return 'Файл «' + name + '» скачан: 8 листов за ' + dateRu(d.from) + ' — ' + dateRu(d.to) + '.';
  };

  /* --- Повторить вчерашнюю смену --------------------------------------------
     Смены в магазине похожи одна на другую. Открываем форму, заполненную
     вчерашними цифрами: остаётся поправить суммы.
     -------------------------------------------------------------------- */
  A['repeat-shift'] = function () {
    var rows = (S.state.dds || []).filter(function (r) {
      return F.isIncome(r) && r.date && (r.shift || r.cashier);
    }).sort(function (a, b) { return (b.date || '').localeCompare(a.date || ''); });
    if (!rows.length) return 'Прошлых смен ещё нет — запишите первую.';
    var last = rows[0].date;
    var same = rows.filter(function (r) { return r.date === last; });
    var pre = { date: today(), shift: same[0].shift, cashier: same[0].cashier };
    same.forEach(function (r) {
      var m = SUP.norm(r.method);
      if (m.indexOf('нал') >= 0) pre.zCash = num(r.amount);
      else if (m.indexOf('карт') >= 0) pre.zCard = num(r.amount);
      else pre.zTrans = num(r.amount);
    });
    U().openForm('cashShift', pre);
    U().toast('Взято со смены ' + dateRu(last) + ' — поправьте суммы и сохраните.', 7000);
    return null;
  };

  A['sup-book-save'] = function () { U().saveBook(); return null; };
  A['sup-book-read'] = function () { U().readBook(); return null; };

  A['sup-template'] = function () {
    try { downloadBook(); return 'Копия книги «Бухгалтерия» скачана.'; }
    catch (e) { return 'Не получилось собрать книгу: ' + e.message; }
  };

  /* --- Живой ввод: подсказка, черновик, быстрые суммы ------------------------- */
  function currentTab() { return U().tab('manual', 'cashShift'); }

  // купюры: пока вбиваете количество — итог считается на глазах
  document.addEventListener('input', function (e) {
    var el = e.target;
    if (!el.classList || !el.classList.contains('note-input')) return;
    var form = el.closest('#wmForm'); if (!form) return;
    var total = 0;
    Array.prototype.forEach.call(form.querySelectorAll('.note-input'), function (i) {
      var n = num(i.dataset.note), cnt = num(i.value);
      var cell = i.parentNode.querySelector('[data-note-sum="' + i.dataset.note + '"]');
      if (cell) cell.textContent = cnt ? window.WMNum.money(n * cnt) : '';
      total += n * cnt;
    });
    var box = document.getElementById('notesTotal');
    if (box) box.textContent = window.WMNum.money(total);
    var expected = window.WMAlerts ? window.WMAlerts.cashNow(S.state, S.settings, F).cash : 0;
    var diffBox = document.getElementById('notesDiff');
    if (diffBox) {
      var d = SUP.round(total - expected);
      diffBox.querySelector('b').innerHTML = !total ? '—'
        : '<span class="' + (d === 0 ? 'c-green' : (d > 0 ? 'c-orange' : 'c-red')) + '">' +
          (d === 0 ? 'сходится' : (d > 0 ? 'излишек ' : 'недостача ') +
            window.WMNum.money(Math.abs(d))) + '</span>';
    }
  });

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




  /* --- Быстрая строка и массовый ввод -----------------------------------------
     31 — «аренда 168000 переводом» одной строкой, без полей.
     29 — та же строка, но много: таблица вместо формы на каждую запись.
     -------------------------------------------------------------------- */
  function EN() { return window.WMEntry; }

  function parsedRow(p) {
    if (!p) return '';
    var bits = [];
    bits.push(esc(dateRu(p.date)));
    bits.push(u2b(p.type));
    if (p.amount) bits.push('<b class="private">' + E.fmtMoney(p.amount) + '</b>');
    if (p.category) bits.push(esc(p.category));
    if (p.method) bits.push(esc(p.method));
    if (p.supplier) bits.push(esc(p.supplier));
    if (p.employee) bits.push(esc(p.employee));
    return bits.join(' · ');
  }
  function u2b(type) {
    return U().badge(type, type === 'Приход' ? 'green' : (type === 'Долг' ? 'orange' :
      (type === 'Забор' ? 'blue' : 'red')));
  }

  FORMS.quickLine = {
    title: 'Записать строкой', icon: '⌨️',
    body: function (v) {
      var u = U(); v = v || {};
      return '<div class="form-row"><label>Напишите как думаете' +
        '<small style="display:block;font-size:12px;color:var(--label-2);font-weight:400">' +
        'Программа сама разложит по полям: дату, сумму, статью, способ оплаты.</small></label>' +
        '<input type="text" name="line" class="quick-line" value="' + esc(v.line || '') + '" ' +
        'placeholder="аренда 168000 переводом">' +
        '<div class="quick-parsed" id="quickParsed"></div></div>' +
        '<div class="banner blue"><span>&#128161;</span><span>Так тоже понимает: ' +
        '«вчера закуп товара 45000 наличными», «5 тыс коммуналка», «12.09 пекарня 3200 картой», ' +
        '«молоко юг 12500 в долг».</span></div>';
    },
    save: function (v) {
      var p = EN().parseLine(v.line, dict());
      if (!p || !p.__ok) return 'Не нашлась сумма. Напишите, сколько денег, — например «аренда 168000 переводом».';
      learn({ categories: p.category, methods: p.method, suppliers: p.supplier, employees: p.employee });
      S.add('dds', {
        date: p.date, shift: '', cashier: '', type: p.type,
        category: p.category || 'Другое', method: p.method || 'Наличные',
        amount: p.amount, diff: 0, note: p.note || '', src: 'строкой'
      });
      refresh();
      return { ok: 'Записано: ' + p.type.toLowerCase() + ' ' + E.fmtMoney(p.amount) +
        (p.category ? ' · ' + p.category : '') };
    }
  };

  FORMS.bulkLines = {
    title: 'Много записей сразу', icon: '📋',
    body: function (v) {
      v = v || {};
      return '<div class="form-row"><label>По одной записи в строке' +
        '<small style="display:block;font-size:12px;color:var(--label-2);font-weight:400">' +
        'Можно вставить из блокнота или Excel. Пустые строки пропускаются.</small></label>' +
        '<textarea name="lines" class="bulk-lines" rows="9" ' +
        'placeholder="аренда 168000 переводом&#10;вчера закуп товара 45000 наличными&#10;5 тыс коммуналка">' +
        esc(v.lines || '') + '</textarea>' +
        '<div class="bulk-preview" id="bulkPreview"></div></div>';
    },
    hint: 'Строки, где не нашлась сумма, подсвечены красным — они не сохранятся.',
    save: function (v) {
      var rows = EN().parseBulk(v.lines, dict());
      var good = rows.filter(function (r) { return r.ok; });
      if (!good.length) return 'Ни одной понятной строки. В каждой должна быть сумма.';
      var bad = rows.length - good.length;
      good.forEach(function (r) {
        var p = r.parsed;
        learn({ categories: p.category, methods: p.method, suppliers: p.supplier, employees: p.employee });
        S.add('dds', {
          date: p.date, shift: '', cashier: '', type: p.type,
          category: p.category || 'Другое', method: p.method || 'Наличные',
          amount: p.amount, diff: 0, note: p.note || '', src: 'списком'
        });
      });
      refresh();
      var sum = good.reduce(function (a, r) { return a + r.parsed.amount; }, 0);
      return { ok: 'Записано ' + good.length + ' ' + U().plural(good.length, 'строка', 'строки', 'строк') +
        ' на ' + E.fmtMoney(sum) + (bad ? '. Пропущено непонятных: ' + bad : '') };
    }
  };

  // Живая раскладка: печатаете — под полем видно, что поняла программа
  document.addEventListener('input', function (e) {
    var el = e.target;
    if (el.classList && el.classList.contains('quick-line')) {
      var box = document.getElementById('quickParsed');
      if (!box) return;
      var p = EN().parseLine(el.value, dict());
      box.innerHTML = !el.value.trim() ? ''
        : (p && p.__ok ? '<span class="c-green">Поняла:</span> ' + parsedRow(p)
          : '<span class="c-red">Не вижу суммы</span> — напишите, сколько денег');
      return;
    }
    if (el.classList && el.classList.contains('bulk-lines')) {
      var pv = document.getElementById('bulkPreview');
      if (!pv) return;
      var rows = EN().parseBulk(el.value, dict());
      if (!rows.length) { pv.innerHTML = ''; return; }
      var okN = rows.filter(function (r) { return r.ok; }).length;
      var sum = rows.filter(function (r) { return r.ok; })
        .reduce(function (a, r) { return a + r.parsed.amount; }, 0);
      pv.innerHTML = '<div class="bulk-head">Поняла ' + okN + ' из ' + rows.length +
        ' · на <b class="private">' + E.fmtMoney(sum) + '</b></div>' +
        rows.map(function (r) {
          return '<div class="bulk-row' + (r.ok ? '' : ' bad') + '">' +
            '<span class="bulk-no">' + r.no + '</span>' +
            (r.ok ? parsedRow(r.parsed)
              : '<span class="c-red">' + esc(r.raw) + ' — ' + esc(r.why) + '</span>') + '</div>';
        }).join('');
    }
  });

  /* --- Пересчёт кассы по купюрам --------------------------------------------
     Кассир не считает в уме: вбивает, сколько каких купюр в ящике, программа
     складывает сама и сразу говорит, сходится ли с тем, что должно быть.
     -------------------------------------------------------------------- */
  var NOTES = [5000, 2000, 1000, 500, 200, 100, 50, 10, 5, 2, 1];

  function notesTotal(v) {
    var sum = 0;
    NOTES.forEach(function (n) { sum += num(v['n' + n]) * n; });
    return SUP.round(sum);
  }

  FORMS.cashCount = {
    title: 'Пересчёт кассы по купюрам', icon: '🧾',
    body: function (v) {
      var u = U(); v = v || {};
      var expected = window.WMAlerts
        ? window.WMAlerts.cashNow(S.state, S.settings, F).cash : 0;
      return u.fieldRow('Дата', 'date', 'date', v.date || today()) +
        u.fieldRow('Кассир', 'cashier', 'list', v.cashier || '', { options: dict().cashiers }) +
        '<div class="form-row"><label>Сколько каких купюр в ящике' +
        '<small style="display:block;font-size:12px;color:var(--label-2);font-weight:400">' +
        'Пишите количество, а не сумму. Программа сложит сама.</small></label>' +
        '<div class="notes-grid">' + NOTES.map(function (n) {
          return '<div class="note-cell"><label>' + window.WMNum.group(n) + ' ₽</label>' +
            '<input type="text" inputmode="numeric" class="note-input" name="n' + n + '" ' +
            'data-note="' + n + '" value="' + esc(v['n' + n] || '') + '" placeholder="0">' +
            '<div class="note-sum" data-note-sum="' + n + '"></div></div>';
        }).join('') + '</div>' +
        '<div class="notes-total"><span>Насчитали в ящике</span>' +
        '<b class="private" id="notesTotal">0 ₽</b></div>' +
        '<div class="notes-total"><span>Должно быть по программе</span>' +
        '<b class="private">' + E.fmtMoney(expected) + '</b></div>' +
        '<div class="notes-total" id="notesDiff"><span>Расхождение</span><b>—</b></div>' +
        '</div>' +
        u.fieldRow('Комментарий', 'note', 'text', v.note || '');
    },
    hint: 'Расхождение записывается как излишек или недостача по кассе — ' +
      'и попадает в отчёт по кассирам.',
    save: function (v) {
      var counted = notesTotal(v);
      if (!counted) return 'Впишите хотя бы одну купюру.';
      var expected = window.WMAlerts
        ? window.WMAlerts.cashNow(S.state, S.settings, F).cash : 0;
      var diff = SUP.round(counted - expected);
      S.add('cashcount', {
        date: v.date, cashier: v.cashier, counted: counted, expected: SUP.round(expected),
        diff: diff, note: v.note,
        notes: NOTES.map(function (n) { return n + '×' + (num(v['n' + n]) || 0); })
          .filter(function (x) { return !/×0$/.test(x); }).join(', ')
      });
      // расхождение — это настоящие деньги, поэтому оно идёт в кассу записью
      if (diff !== 0) {
        S.add('dds', { date: v.date, cashier: v.cashier, shift: '',
          type: diff > 0 ? 'Приход' : 'Расход',
          category: diff > 0 ? 'Излишек по кассе' : 'Недостача по кассе',
          method: 'Наличные', amount: Math.abs(diff), diff: diff,
          note: 'пересчёт по купюрам' + (v.note ? ': ' + v.note : ''), src: 'пересчёт' });
      }
      refresh();
      return { ok: 'Насчитано ' + E.fmtMoney(counted) + '. ' +
        (diff === 0 ? 'Касса сходится.' :
          (diff > 0 ? 'Излишек ' + E.fmtMoney(diff) : 'Недостача ' + E.fmtMoney(-diff))) };
    }
  };

  /* --- Расхождения с 1С -----------------------------------------------------
     Владелец говорит: «в 1С долг и выплата одни, а по факту другие — в 1С
     есть ошибки». Значит, правда — это его цифра. Программа считает по ней,
     а здесь честно показывает, где именно она разошлась с выгрузкой, и даёт
     вернуть «как в 1С», если владелец передумал.
     -------------------------------------------------------------------- */
  var FIELD_RU = {
    sum: 'Сумма', date: 'Дата', firm: 'Поставщик', supplier: 'Имя в 1С',
    retail: 'Сумма в рознице', payDate: 'Дата выплаты', basis: 'Основание',
    incomingNo: 'Входящий номер', incomingDate: 'Дата бумаги поставщика',
    operation: 'Вид операции', article: 'Статья ДДС', cashbox: 'Касса'
  };
  function fieldRu(f) { return FIELD_RU[f] || f; }
  function valRu(field, v) {
    if (v === undefined || v === null || v === '') return '—';
    if (field === 'sum' || field === 'retail') return E.fmtMoney(num(v));
    if (/date$/i.test(field)) return dateRu(v);
    return String(v);
  }

  // Все расхождения одним списком: и по накладным, и по оплатам
  function conflictList() {
    var out = [];
    [['docs', 'Накладная', 'supDoc', 'doc'], ['pays', 'Оплата', 'supPay', 'pay']].forEach(function (t) {
      (S.state[t[0]] || []).forEach(function (r) {
        var diff = SUP.conflicts(r);
        if (!diff.length) return;
        out.push({
          coll: t[0], kind: t[1], form: t[2], more: t[3], id: r.id,
          doc: SUP.shortDoc(r.doc), firm: r.firm || r.supplier || '—',
          date: r.date, diff: diff,
          money: diff.reduce(function (a, d) {
            return d.field === 'sum' ? a + (num(d.now) - num(d.was)) : a;
          }, 0)
        });
      });
    });
    return out.sort(function (a, b) {
      return Math.abs(b.money) - Math.abs(a.money) || (b.date || '').localeCompare(a.date || '');
    });
  }

  function viewConflicts() {
    var u = U();
    var all = conflictList();
    var money = all.reduce(function (a, c) { return a + c.money; }, 0);

    var h = u.pageHead('Расхождения с 1С',
      'Где ваша цифра отличается от выгрузки. Программа считает по вашей');

    h += '<div class="banner blue"><span>&#9995;</span><span>Главное правило: <b>правда — то, что ввели вы</b>. ' +
      'Повторная загрузка того же файла из 1С не затирает исправленные вами поля. ' +
      'Здесь видно, что именно разошлось, и можно вернуть «как в 1С», если ошиблись вы, а не 1С.</span></div>';

    h += '<div class="stat-grid">' +
      u.stat('Исправлено вами', u.nf(all.length),
        all.length ? 'документов отличаются от 1С' : 'расхождений нет', all.length ? 'c-orange' : 'c-green') +
      u.stat('Разница в деньгах', u.priv(Math.abs(money)),
        money > 0 ? 'у вас больше, чем в 1С' : (money < 0 ? 'у вас меньше, чем в 1С' : 'по суммам сходится'),
        money ? 'c-orange' : 'c-green') +
      u.stat('По накладным', u.nf(all.filter(function (c) { return c.coll === 'docs'; }).length), 'приход товара') +
      u.stat('По оплатам', u.nf(all.filter(function (c) { return c.coll === 'pays'; }).length), 'расходные ордера') +
      '</div>';

    var defs = [
      { key: 'what', name: 'Что расходится', options: [
        { v: 'sum', name: 'Сумма', test: function (c) { return c.diff.some(function (d) { return d.field === 'sum'; }); } },
        { v: 'date', name: 'Дата', test: function (c) { return c.diff.some(function (d) { return /date$/i.test(d.field); }); } },
        { v: 'firm', name: 'Поставщик', test: function (c) { return c.diff.some(function (d) { return d.field === 'firm' || d.field === 'basis'; }); } }
      ] },
      { key: 'kind', name: 'Где', options: [
        { v: 'docs', name: 'Накладные', test: function (c) { return c.coll === 'docs'; } },
        { v: 'pays', name: 'Оплаты', test: function (c) { return c.coll === 'pays'; } }
      ] },
      { key: 'firm', name: 'Поставщик', auto: function (c) { return c.firm; }, limit: 12 }
    ];
    var rows = FLT().apply('conflicts', all, defs, function (c) { return c.firm + ' ' + c.doc; });
    if (all.length) h += FLT().bar('conflicts', defs, all, { search: 'поставщик или документ' });

    h += u.card('Где ваша цифра не совпала с 1С',
      FLT().note(rows.length, all.length) + u.table('conflT', [
      { title: 'Дата', fn: function (c) { return esc(dateRu(c.date)) || '—'; } },
      { title: 'Что', fn: function (c) { return u.badge(c.kind, c.coll === 'docs' ? 'blue' : 'green'); } },
      { title: 'Документ', fn: function (c) { return DET().link(c.more, c.id, c.doc || '—'); } },
      { title: 'Поставщик', fn: function (c) { return DET().link('firm', E.norm(c.firm), c.firm); } },
      { title: 'Поле', fn: function (c) {
        return c.diff.map(function (d) { return esc(fieldRu(d.field)); }).join(', '); } },
      { title: 'Было в 1С', cls: 'num', fn: function (c) {
        return c.diff.map(function (d) { return '<span class="c-muted">' + esc(valRu(d.field, d.was)) + '</span>'; }).join('<br>'); } },
      { title: 'Стало у вас', cls: 'num', fn: function (c) {
        return c.diff.map(function (d) { return '<b>' + esc(valRu(d.field, d.now)) + '</b>'; }).join('<br>'); } },
      { title: '', cls: 'center', fn: function (c) {
        return DET().btn(c.more, c.id, 'Подробнее') +
          ' <button class="btn btn-sm" data-edit="' + c.coll + ':' + c.id + ':' + c.form + '">&#9998;</button>' +
          ' <button class="btn btn-sm" data-act="conf-revert" data-coll="' + c.coll + '" data-id="' + c.id +
          '" title="Вернуть значения из 1С">Как в 1С</button>'; } }
    ], rows, { step: 40,
      empty: all.length ? 'Под фильтр ничего не подошло'
        : 'Расхождений нет: всё, что в базе, совпадает с выгрузкой 1С.' }),
      all.length ? '<button class="btn btn-sm" data-act="conf-revert-all">Вернуть всё как в 1С</button>' : '');

    h += '<div class="banner"><span>&#128161;</span><span>Как исправлять: откройте накладную или оплату кнопкой &#9998;, ' +
      'впишите верную цифру и сохраните. Программа запомнит, что это ваше значение, и будет считать долг ' +
      'по нему. Кнопка «Как в 1С» снимает вашу правку с документа.</span></div>';
    return h;
  }




  /* --- Сравнение периодов, ведомость, наценка, файл бухгалтеру ---------------- */
  function X() { return window.WMExtra; }

  function deltaHtml(now, was, moneyFmt) {
    var d = X().delta(now, was);
    if (!d.has) return '';
    var arrow = d.dir === 'up' ? '▲' : (d.dir === 'down' ? '▼' : '=');
    var txt = (moneyFmt === false ? U().nf(Math.abs(d.diff)) : E.fmtMoney(Math.abs(d.diff)));
    return '<span class="delta ' + d.dir + '">' + arrow + ' ' + txt +
      (d.pct === null ? '' : ' (' + Math.abs(d.pct) + '%)') + '</span>';
  }

  function viewCompare() {
    var u = U(), all = S.state.dds || [];
    var range = u.periodRange();
    function pick(from, to) {
      return all.filter(function (r) { return r.date >= from && r.date <= to; });
    }
    // если в выбранном периоде записей нет, сравниваем последний месяц,
    // где они есть: иначе экран показывал бы два пустых столбца
    var moved = false;
    if (!pick(range.from, range.to).length && all.length) {
      var last = '';
      all.forEach(function (r) { if (r.date && r.date > last) last = r.date; });
      var days = Math.max(1, Math.round((new Date(range.to) - new Date(range.from)) / 86400000) + 1);
      range = { from: X().addDays(last, -days + 1), to: last };
      moved = true;
    }
    var prev = X().prevRange(range.from, range.to);
    var now = pick(range.from, range.to), was = pick(prev.from, prev.to);
    var tn = F.totals(now), tw = F.totals(was);

    var h = u.pageHead('Сравнение периодов',
      'Что изменилось: ' + dateRu(range.from) + '–' + dateRu(range.to) +
      ' против ' + dateRu(prev.from) + '–' + dateRu(prev.to),
      '<button class="btn" data-act="print">🖨 Печать</button>');

    if (moved) {
      h += '<div class="banner"><span>📅</span><span>В выбранном наверху периоде записей нет, поэтому ' +
        'показан последний период с данными: ' + esc(dateRu(range.from)) + ' — ' + esc(dateRu(range.to)) +
        '.</span></div>';
    }
    h += '<div class="banner blue"><span>📐</span><span>Период берётся из переключателя наверху, ' +
      'а сравнивается с таким же по длине перед ним: ' + prev.days + ' ' +
      u.plural(prev.days, 'день', 'дня', 'дней') + '.</span></div>';

    var lines = [
      ['Выручка', tn.income, tw.income],
      ['Расходы', tn.expense, tw.expense],
      ['Прибыль', tn.profit, tw.profit],
      ['Закуп товара', tn.purchase, tw.purchase],
      ['Зарплата', tn.salary, tw.salary],
      ['Аренда', tn.rent, tw.rent],
      ['Взято в долг', tn.debtTaken, tw.debtTaken],
      ['Погашено долга', tn.debtPaid, tw.debtPaid],
      ['Средний день', tn.avgDay, tw.avgDay],
      ['Средняя смена', tn.avgShift, tw.avgShift],
      ['Расхождения кассы', tn.diffSum, tw.diffSum]
    ];
    h += '<div class="stat-grid">' +
      u.stat('Выручка', u.priv(tn.income), 'было ' + E.fmtMoney(tw.income) + ' ' + deltaHtml(tn.income, tw.income)) +
      u.stat('Расходы', u.priv(tn.expense), 'было ' + E.fmtMoney(tw.expense) + ' ' + deltaHtml(tn.expense, tw.expense)) +
      u.stat('Прибыль', u.priv(tn.profit), 'было ' + E.fmtMoney(tw.profit) + ' ' + deltaHtml(tn.profit, tw.profit),
        tn.profit >= tw.profit ? 'c-green' : 'c-red') +
      u.stat('Рентабельность', u.pct(tn.profitability), 'было ' + u.pct(tw.profitability)) +
      '</div>';

    h += u.card('Строка в строку', u.table('cmpPer', [
      { title: 'Показатель', fn: function (r) { return esc(r[0]); } },
      { title: 'Сейчас', cls: 'num', fn: function (r) { return u.priv(r[1]); } },
      { title: 'Раньше', cls: 'num', fn: function (r) { return u.priv(r[2]); } },
      { title: 'Разница', cls: 'num', fn: function (r) { return deltaHtml(r[1], r[2]); } }
    ], lines, { step: 30 }));

    // по статьям расходов: где именно стали тратить больше
    var cn = {}, cw = {};
    F.byCategory(now).forEach(function (c) { cn[c.name] = c.sum; });
    F.byCategory(was).forEach(function (c) { cw[c.name] = c.sum; });
    var names = {};
    Object.keys(cn).concat(Object.keys(cw)).forEach(function (n) { names[n] = 1; });
    var cats = Object.keys(names).map(function (n) {
      return { name: n, now: cn[n] || 0, was: cw[n] || 0, diff: (cn[n] || 0) - (cw[n] || 0) };
    }).sort(function (a, b) { return Math.abs(b.diff) - Math.abs(a.diff); });

    h += u.card('Где изменились расходы', u.table('cmpCat', [
      { title: 'Статья', fn: function (r) { return DET().link('category', r.name, r.name); } },
      { title: 'Сейчас', cls: 'num', fn: function (r) { return u.priv(r.now); } },
      { title: 'Раньше', cls: 'num', fn: function (r) { return u.priv(r.was); } },
      { title: 'Разница', cls: 'num', fn: function (r) { return deltaHtml(r.now, r.was); } },
      { title: '', cls: 'center', fn: function (r) { return DET().btn('category', r.name, 'Подробнее'); } }
    ], cats, { step: 30, empty: 'Расходов в этих периодах нет' }));
    return h;
  }

  /* --- Наценка по поставщикам ------------------------------------------------ */
  function viewMarkup() {
    var u = U(), c = sup();
    var rows = X().markupByFirm(c.docs || []);
    var h = u.pageHead('Кто зарабатывает магазину',
      'Наценка по каждому поставщику: сколько принесёт его товар, если продать всё',
      '<button class="btn" data-act="print">🖨 Печать</button>');

    if (!rows.length) {
      return h + '<div class="card"><div class="empty"><b>Нужны накладные с розничной суммой</b><br>' +
        'В выгрузке 1С «Приходные накладные» есть колонка «Сумма документа розница» — по ней и считается наценка.</div></div>';
    }
    var buy = rows.reduce(function (a, r) { return a + r.buy; }, 0);
    var gross = rows.reduce(function (a, r) { return a + r.gross; }, 0);

    h += '<div class="stat-grid">' +
      u.stat('Завезли в закупе', u.priv(buy), rows.length + ' поставщиков') +
      u.stat('Заработаем на этом', u.priv(gross), 'если продать всё по розничной цене', 'c-green') +
      u.stat('Средняя наценка', u.pct(buy ? gross / buy * 100 : 0), 'по всем поставкам') +
      u.stat('Лучший поставщик', esc(rows[0].firm.slice(0, 22)), 'принесёт ' + E.fmtMoney(rows[0].gross), 'c-green') +
      '</div>';

    var defs = [
      { key: 'mk', name: 'Наценка', options: [
        { v: 'low', name: 'Меньше 15%', test: function (r) { return r.markup < 15; } },
        { v: 'mid', name: '15–30%', test: function (r) { return r.markup >= 15 && r.markup < 30; } },
        { v: 'hi', name: 'Больше 30%', test: function (r) { return r.markup >= 30; } }
      ] },
      { key: 'debt', name: 'Долг', options: [
        { v: 'yes', name: 'Есть долг', test: function (r) { return r.left > 0; } },
        { v: 'no', name: 'Нет долга', test: function (r) { return r.left <= 0; } }
      ] }
    ];
    var list = FLT().apply('markup', rows, defs, function (r) { return r.firm; });
    h += FLT().bar('markup', defs, rows, { search: 'поставщик' });

    h += u.card('Поставщики по заработку', FLT().note(list.length, rows.length) + u.table('mkT', [
      { title: 'Поставщик', fn: function (r) { return DET().link('firm', E.norm(r.firm), r.firm); } },
      { title: 'Накладных', cls: 'num', fn: function (r) { return u.nf(r.docs); } },
      { title: 'Завезли (закуп)', cls: 'num', fn: function (r) { return u.priv(r.buy); } },
      { title: 'В рознице', cls: 'num', fn: function (r) { return u.priv(r.retail); } },
      { title: 'Заработаем', cls: 'num', fn: function (r) { return '<span class="c-green private">' + E.fmtMoney(r.gross) + '</span>'; } },
      { title: 'Наценка', cls: 'num', fn: function (r) {
        return '<span class="' + (r.markup < 15 ? 'c-red' : (r.markup >= 30 ? 'c-green' : '')) + '">' +
          u.pct(r.markup) + '</span>'; } },
      { title: 'Долг ему', cls: 'num', fn: function (r) { return r.left ? u.priv(r.left) : '—'; } },
      { title: '', cls: 'center', fn: function (r) { return DET().btn('firm', E.norm(r.firm), 'Подробнее'); } }
    ], list, { step: 40, empty: 'Под фильтр ничего не подошло' }));

    h += '<div class="banner"><span>💡</span><span>Наценка ниже 15% — повод поговорить о цене: ' +
      'этот поставщик занимает деньги и место на полке, а приносит мало.</span></div>';
    return h;
  }

  /* --- Ведомость зарплаты на печать ------------------------------------------ */
  function viewPayroll() {
    var u = U();
    var range = u.periodRange();
    function inR(d) { return d >= range.from && d <= range.to; }
    var ts = (S.state.timesheet || []).filter(function (r) { return inR(r.date); });
    var po = (S.state.payouts || []).filter(function (r) { return inR(r.date); });
    var rows = E.payrollSummary(ts, po);
    var sheet = X().payrollSheet(rows, dateRu(range.from) + ' — ' + dateRu(range.to));

    var h = u.pageHead('Ведомость на зарплату',
      'За ' + sheet.period + ' · подпишите и выдайте',
      '<button class="btn btn-primary" data-act="print">🖨 Печать ведомости</button>');

    h += '<div class="stat-grid">' +
      u.stat('Начислено', u.priv(sheet.total.accrued), u.nf(sheet.total.shifts) + ' смен, ' + u.nf(sheet.total.hours) + ' ч') +
      u.stat('Уже выдано', u.priv(sheet.total.paid), 'авансы и выплаты') +
      u.stat('К выдаче', u.priv(sheet.total.left), 'остаток по ведомости',
        sheet.total.left > 0 ? 'c-orange' : 'c-green') +
      u.stat('Человек', u.nf(rows.length), 'в ведомости') +
      '</div>';

    h += u.card('Ведомость', u.table('payrollT', [
      { title: '№', cls: 'num', fn: function (r, i) { return i + 1; } },
      { title: 'Сотрудник', fn: function (r) { return DET().link('employee', r.employee, r.employee); } },
      { title: 'Должность', fn: function (r) { return esc(r.position || '—'); } },
      { title: 'Смен', cls: 'num', fn: function (r) { return u.nf(r.shifts); } },
      { title: 'Часов', cls: 'num', fn: function (r) { return u.nf(r.hours); } },
      { title: 'Начислено', cls: 'num', fn: function (r) { return u.priv(r.accrued); } },
      { title: 'Премии', cls: 'num', fn: function (r) { return r.bonus ? u.priv(r.bonus) : '—'; } },
      { title: 'Штрафы', cls: 'num', fn: function (r) { return r.penalty ? '<span class="c-red private">' + E.fmtMoney(r.penalty) + '</span>' : '—'; } },
      { title: 'Выдано', cls: 'num', fn: function (r) { return u.priv(r.paid); } },
      { title: 'К выдаче', cls: 'num', fn: function (r) { return '<b class="private">' + E.fmtMoney(r.left) + '</b>'; } },
      { title: 'Подпись', fn: function () { return '<span class="sign-line"></span>'; } }
    ], rows, { step: 60, empty: 'В этом периоде смен не записано',
      total: [{ html: 'Итого', span: 5 },
        { html: E.fmtMoney(sheet.total.accrued), cls: 'num' }, { html: '' }, { html: '' },
        { html: E.fmtMoney(sheet.total.paid), cls: 'num' },
        { html: '<b>' + E.fmtMoney(sheet.total.left) + '</b>', cls: 'num' }, { html: '' }] }));

    h += '<div class="card"><div class="card-pad print-sign">' +
      '<div>Выдал: ______________________ / ' + esc(S.settings.ownerName || '') + '</div>' +
      '<div>Дата: ______________</div></div></div>';
    return h;
  }

  /* --- Проверка базы и журнал действий ---------------------------------------
     Программа сама смотрит, что в базе сломано: накладные без поставщика,
     документы без даты, дубли номеров, записи будущим числом. И ведёт журнал:
     кто что менял, чтобы можно было отмотать одну запись, а не всю базу.
     -------------------------------------------------------------------- */
  var CHECK_HELP = {
    'docs-no-firm': 'Программа не знает, кому вы должны по этим накладным — они не попадут в долг ни одной фирме.',
    'no-date': 'Без даты документ не встанет ни в один период и не попадёт в отчёт за месяц.',
    'docs-zero': 'Накладная на ноль обычно значит, что сумма не прочиталась из файла.',
    'dds-future': 'Запись будущим числом ломает остаток в кассе: деньги «уже пришли», хотя их ещё нет.',
    'docs-dup': 'Один и тот же номер дважды — долг по нему посчитается два раза.',
    'firm-no-name': 'Фирма без названия не показывается в списках и мешает сопоставлению имён.'
  };

  function viewCheck() {
    var u = U();
    var problems = window.WMAlerts ? window.WMAlerts.checkBase(S.state) : [];
    var total = problems.reduce(function (a, p) { return a + p.count; }, 0);
    var log = (S.state.log || []).slice().reverse();

    var h = u.pageHead('Проверка базы', 'Что в базе сломано и что вы меняли в последнее время',
      '<button class="btn" data-act="check-again">Проверить заново</button>');

    h += total
      ? '<div class="banner"><span>&#9888;</span><span>Нашлось <b>' + u.nf(total) + '</b> ' +
        u.plural(total, 'проблемная запись', 'проблемные записи', 'проблемных записей') +
        '. Ничего страшного не произошло — просто эти строки считаются неправильно. ' +
        'Нажмите «Показать», чтобы разобраться.</span></div>'
      : '<div class="banner green"><span>&#9989;</span><span>База в порядке: ни одной сломанной записи ' +
        'не нашлось.</span></div>';

    if (problems.length) {
      h += u.card('Что нашлось', u.listOf(problems.map(function (p) {
        return u.listRow({ icon: '&#9888;', title: esc(p.text) + ' — ' + u.nf(p.count),
          sub: esc(CHECK_HELP[p.kind] || ''),
          value: '<button class="btn btn-sm" data-act="check-show" data-kind="' + esc(p.kind) + '">Показать</button>' +
            (p.coll ? ' <button class="btn btn-sm btn-danger" data-act="check-drop" data-kind="' + esc(p.kind) +
              '">Удалить их</button>' : '') });
      }), ''));
    }

    h += u.card('Журнал действий', u.table('logT', [
      { title: 'Когда', fn: function (r) {
        return esc(new Date(r.at).toLocaleString('ru-RU').slice(0, 16)); } },
      { title: 'Что сделали', fn: function (r) { return u.badge(r.what, r.what === 'удаление' ? 'red' :
        (r.what === 'правка' ? 'orange' : 'green')); } },
      { title: 'Где', fn: function (r) { return esc(r.collName || r.coll); } },
      { title: 'Запись', fn: function (r) { return esc(r.title || '—'); } },
      { title: 'Сумма', cls: 'num', fn: function (r) { return r.sum ? u.priv(r.sum) : '—'; } },
      { title: '', cls: 'center', fn: function (r) {
        return r.before ? '<button class="btn btn-sm" data-act="log-undo" data-id="' + esc(r.id) +
          '">&#8617; Отменить</button>' : ''; } }
    ], log, { step: 40, empty: 'Журнал пуст — здесь появится всё, что вы измените' }),
      log.length ? u.nf(log.length) + ' ' + u.plural(log.length, 'запись', 'записи', 'записей') : '');

    h += '<div class="banner"><span>&#128161;</span><span>Журнал хранит последние 500 действий и живёт в базе, ' +
      'то есть переезжает вместе с папкой. «Отменить» возвращает запись такой, какой она была до правки.</span></div>';
    return h;
  }

  /* --- Сброс и откат базы ---------------------------------------------------
     Три кнопки, которых не хватало: вернуть настройки, очистить лишнее и
     откатить базу на любой момент, когда программа делала копию.
     Перед каждым опасным действием пишется свежая копия — вернуться можно
     всегда, даже если передумали через минуту.
     -------------------------------------------------------------------- */
  var BACKUPS = null;          // список копий, подгружается по кнопке

  // Что и сколько лежит в базе — чтобы владелец видел, что именно чистит
  function baseCounts() {
    var map = [
      ['dds', 'Касса и расходы'], ['docs', 'Накладные'], ['pays', 'Оплаты'],
      ['supreg', 'Поставщики'], ['plans', 'План выплат'], ['payouts', 'Зарплата'],
      ['timesheet', 'Табель'], ['debtors', 'Долги покупателей'],
      ['inventory', 'Списания'], ['expiry', 'Сроки годности'], ['trash', 'Корзина']
    ];
    return map.map(function (m) {
      var rows = S.state[m[0]] || [];
      var own = rows.filter(function (r) { return r.source !== '1c'; }).length;
      return { coll: m[0], name: m[1], all: rows.length, own: own, from1c: rows.length - own };
    });
  }

  function viewReset() {
    var u = U();
    var counts = baseCounts();
    var total = counts.reduce(function (a, c) { return a + c.all; }, 0);
    var from1c = counts.reduce(function (a, c) { return a + c.from1c; }, 0);

    var h = u.pageHead('Сброс и откат базы',
      'Вернуть настройки, убрать лишнее или откатить базу на нужный день');

    h += '<div class="banner blue"><span>🛟</span><span>Перед каждым действием на этой странице ' +
      'программа сама сохраняет копию базы. Если передумаете — откатитесь на неё ' +
      'в разделе «Откатить базу на дату» ниже.</span></div>';

    h += '<div class="stat-grid">' +
      u.stat('Всего записей в базе', u.nf(total), 'вместе с корзиной') +
      u.stat('Ваших записей', u.nf(total - from1c), 'введены руками') +
      u.stat('Пришло из 1С', u.nf(from1c), 'накладные, оплаты, справочник') +
      u.stat('Копий в папке', BACKUPS === null ? '—' : u.nf(BACKUPS.length),
        BACKUPS === null ? 'нажмите «Показать копии»' : 'можно откатиться на любую') +
      '</div>';

    h += u.card('Что в базе сейчас', u.table('baseCnt', [
      { title: 'Раздел', fn: function (r) { return esc(r.name); } },
      { title: 'Всего', cls: 'num', fn: function (r) { return u.nf(r.all); } },
      { title: 'Ваших', cls: 'num', fn: function (r) { return u.nf(r.own); } },
      { title: 'Из 1С', cls: 'num', fn: function (r) { return r.from1c ? u.nf(r.from1c) : '—'; } },
      { title: '', cls: 'center', fn: function (r) {
        return r.all ? '<button class="btn btn-sm btn-danger" data-act="base-clear-coll" data-coll="' +
          r.coll + '" data-name="' + encodeURIComponent(r.name) + '">Очистить</button>' : ''; } }
    ], counts, { step: 20 }));

    h += u.card('Сброс', u.listOf([
      u.listRow({ icon: '⚙️', title: 'Вернуть настройки к стандартным',
        sub: 'Налоги, смены, отсрочки, справочники, внешний вид. Записи не тронутся',
        value: '<button class="btn btn-sm" data-act="settings-reset">Сбросить настройки</button>' }),
      u.listRow({ icon: '📥', title: 'Убрать всё, что пришло из 1С',
        sub: u.nf(from1c) + ' ' + u.plural(from1c, 'запись', 'записи', 'записей') +
          ' — накладные, оплаты и автосозданные фирмы. Ваши записи останутся',
        value: '<button class="btn btn-sm btn-danger" data-act="base-drop-1c">Убрать данные 1С</button>' }),
      u.listRow({ icon: '🗑', title: 'Очистить корзину',
        sub: u.nf((S.state.trash || []).length) + ' удалённых записей ждут возврата',
        value: '<button class="btn btn-sm" data-act="rec-empty-trash">Очистить корзину</button>' }),
      u.listRow({ icon: '💣', title: 'Очистить всю базу',
        sub: 'Удалит все записи и вернёт настройки. Останется только копия в папке',
        value: '<button class="btn btn-sm btn-danger" data-act="base-clear-all">Очистить всё</button>' })
    ], ''));

    h += u.card('Откатить базу на дату',
      (BACKUPS === null
        ? '<div class="card-pad"><button class="btn btn-primary" data-act="base-list-backups">Показать копии</button>' +
          '<div class="card-note" style="margin-top:8px">Копии лежат в папке ' +
          esc(FS().DATA_DIR) + '/копии и создаются при каждой записи, но не чаще раза в минуту.</div></div>'
        : (BACKUPS.length
          ? u.table('backupsT', [
            { title: 'Когда', fn: function (r) { return esc(dateRu(r.date)) + ' · ' + esc(r.time); } },
            { title: 'День недели', fn: function (r) {
              return esc(r.when.toLocaleDateString('ru-RU', { weekday: 'long' })); } },
            { title: 'Размер', cls: 'num', fn: function (r) { return u.nf(Math.round(r.size / 1024)) + ' КБ'; } },
            { title: 'Файл', fn: function (r) { return '<span class="c-muted">' + esc(r.name) + '</span>'; } },
            { title: '', cls: 'center', fn: function (r) {
              return '<button class="btn btn-sm btn-primary" data-act="base-rollback" data-name="' +
                encodeURIComponent(r.name) + '">Откатить сюда</button>'; } }
          ], BACKUPS, { step: 30 })
          : '<div class="empty">Копий пока нет. Они появятся, как только вы что-нибудь запишете ' +
            'при подключённой папке.</div>')),
      BACKUPS !== null ? '<button class="btn btn-sm" data-act="base-list-backups">Обновить список</button>' : '');

    // вторая папка: флешка или облачный диск
    var bs = FS().backupState;
    h += u.card('Вторая копия — на флешку или в облачную папку', u.listOf([
      u.listRow({ icon: '💽',
        title: bs === 'ready' ? 'Копии уходят в папку «' + esc(FS().backupDirName) + '»'
          : (bs === 'lost' ? 'Вторая папка не найдена'
            : (bs === 'needs-permission' ? 'Нужно подтвердить доступ ко второй папке'
              : 'Вторая папка не выбрана')),
        sub: bs === 'ready'
          ? 'Копия кладётся раз в ' + (+S.settings.backupEveryHours || 24) + ' ч при запуске программы' +
            (FS().lastCopy ? ' · последняя ' + FS().lastCopy.toLocaleString('ru-RU').slice(0, 16) : '')
          : 'Выберите флешку или папку Яндекс.Диска — программа сама будет класть туда копию базы',
        value: (bs === 'ready'
          ? '<button class="btn btn-sm" data-act="backup2-now">Скопировать сейчас</button> ' +
            '<button class="btn btn-sm" data-act="backup2-forget">Отключить</button>'
          : '<button class="btn btn-sm btn-primary" data-act="backup2-connect">Выбрать папку</button>') })
    ], ''));

    if (FS().state !== 'ready') {
      h += '<div class="banner"><span>⚠️</span><span>Папка не подключена, поэтому копии не пишутся ' +
        'и откатиться некуда. Подключите папку на экране «Данные и файлы» — и программа начнёт ' +
        'хранить историю базы сама.</span><button class="btn" data-go="data">Данные и файлы</button></div>';
    }
    return h;
  }

  /* --- Сверка с поставщиком -------------------------------------------------
     Тот самый акт сверки, который привозит представитель: долг на начало,
     что привезли, что оплатили, долг на конец. Считается по нашим данным —
     остаётся сравнить строку в строку и найти, где расхождение.
     -------------------------------------------------------------------- */
  function reconcileData(firmKey, from, to) {
    var c = sup();
    var docs = c.docs.filter(function (d) { return E.norm(d.firm) === firmKey; });
    var pays = (S.state.pays || []).filter(function (p) { return E.norm(p.firm) === firmKey; });
    function before(list, field) {
      return SUP.round(list.filter(function (r) { return r.date && r.date < from; })
        .reduce(function (a, r) { return a + num(r[field]); }, 0));
    }
    function inside(list) {
      return list.filter(function (r) { return r.date && r.date >= from && r.date <= to; });
    }
    var startDocs = before(docs, 'sum'), startPays = before(pays, 'sum');
    var perDocs = inside(docs), perPays = inside(pays);
    var comeSum = SUP.round(perDocs.reduce(function (a, d) { return a + num(d.sum); }, 0));
    var paidSum = SUP.round(perPays.reduce(function (a, p) { return a + num(p.sum); }, 0));
    // одна лента движений: приход увеличивает долг, оплата уменьшает
    var moves = perDocs.map(function (d) {
      return { date: d.date, kind: 'Приход товара', doc: d.doc, id: d.id, more: 'doc',
        debit: num(d.sum), credit: 0 };
    }).concat(perPays.map(function (p) {
      return { date: p.date, kind: 'Оплата', doc: SUP.shortDoc(p.doc), id: p.id, more: 'pay',
        debit: 0, credit: num(p.sum) };
    })).sort(function (a, b) { return (a.date || '').localeCompare(b.date || '') || a.kind.localeCompare(b.kind); });
    var run = SUP.round(startDocs - startPays);
    moves.forEach(function (m) { run = SUP.round(run + m.debit - m.credit); m.balance = run; });
    return {
      firm: (docs[0] || pays[0] || {}).firm || '',
      start: SUP.round(startDocs - startPays), come: comeSum, paid: paidSum,
      end: SUP.round(startDocs - startPays + comeSum - paidSum),
      moves: moves, docs: perDocs.length, pays: perPays.length,
      allDocs: docs.length, allPays: pays.length
    };
  }

  function viewReconcile() {
    var u = U(), c = sup();
    var range = u.periodRange();
    var firms = c.firms.slice().sort(function (a, b) { return b.sum - a.sum; });
    // имя фирмы приезжает из кнопки закодированным — раскодируем обратно
    var pick = decodeURIComponent(u.tab('reconcile', firms.length ? encodeURIComponent(E.norm(firms[0].firm)) : ''));

    var h = u.pageHead('Сверка с поставщиком',
      'Долг на начало · что привезли · что оплатили · долг на конец — как в акте сверки',
      '<button class="btn" data-act="print">🖨 Печать</button>');

    if (!firms.length) {
      return h + '<div class="card"><div class="empty"><b>Нет накладных из 1С</b><br>' +
        'Загрузите «Приходные накладные» и «Расходные кассовые ордера» на экране «Импорт из 1С».</div></div>';
    }

    // выбор фирмы теми же кнопками, что и обычные фильтры
    h += '<div class="filters"><div class="filter-head"><span>Выберите поставщика</span></div>' +
      '<div class="filter-line"><span class="filter-name">Поставщик</span><div class="chips">' +
      firms.slice(0, 40).map(function (f) {
        return '<button class="chip' + (E.norm(f.firm) === pick ? ' active' : '') +
          '" data-tab="reconcile:' + encodeURIComponent(E.norm(f.firm)) + '">' + esc(f.firm) + '</button>';
      }).join('') + '</div></div></div>';

    var r = reconcileData(pick, range.from, range.to);

    h += '<div class="banner blue"><span>📅</span><span>Период: <b>' + esc(dateRu(range.from)) +
      ' — ' + esc(dateRu(range.to)) + '</b> (меняется переключателем периода наверху). ' +
      'Всего по этой фирме в базе: ' + r.allDocs + ' ' + u.plural(r.allDocs, 'накладная', 'накладные', 'накладных') +
      ' и ' + r.allPays + ' ' + u.plural(r.allPays, 'оплата', 'оплаты', 'оплат') + '.</span></div>';

    h += '<div class="stat-grid">' +
      u.stat('Долг на начало', u.priv(r.start), 'что было должны до ' + dateRu(range.from),
        r.start > 0 ? 'c-orange' : 'c-green') +
      u.stat('Привезли за период', u.priv(r.come), r.docs + ' ' + u.plural(r.docs, 'накладная', 'накладные', 'накладных')) +
      u.stat('Оплатили за период', u.priv(r.paid), r.pays + ' ' + u.plural(r.pays, 'оплата', 'оплаты', 'оплат'), 'c-green') +
      u.stat('Долг на конец', u.priv(r.end), 'начало + приход − оплата', r.end > 0 ? 'c-red' : 'c-green') +
      '</div>';

    h += u.card('Движения по счёту — ' + esc(r.firm || '—'), u.table('recAct', [
      { title: 'Дата', fn: function (m) { return DET().link('day', m.date, dateRu(m.date)); } },
      { title: 'Операция', fn: function (m) { return u.badge(m.kind, m.kind === 'Оплата' ? 'green' : 'orange'); } },
      { title: 'Документ', fn: function (m) { return DET().link(m.more, m.id, m.doc || '—'); } },
      { title: 'Долг вырос', cls: 'num', fn: function (m) { return m.debit ? u.priv(m.debit) : '—'; } },
      { title: 'Долг погашен', cls: 'num', fn: function (m) { return m.credit ? u.priv(m.credit) : '—'; } },
      { title: 'Остаток долга', cls: 'num', fn: function (m) {
        return '<span class="' + (m.balance > 0 ? 'c-red' : 'c-green') + ' private">' +
          E.fmtMoney(m.balance) + '</span>'; } },
      { title: '', cls: 'center', fn: function (m) { return DET().btn(m.more, m.id, 'Подробнее'); } }
    ], r.moves, { step: 50, empty: 'За этот период движений не было — смените период наверху',
      total: [{ html: 'Итого за период', span: 3 },
        { html: E.fmtMoney(r.come), cls: 'num' }, { html: E.fmtMoney(r.paid), cls: 'num' },
        { html: '<b>' + E.fmtMoney(r.end) + '</b>', cls: 'num' }, { html: '' }] }),
      DET().btn('firm', pick, 'Всё о поставщике'));

    h += '<div class="banner"><span>💡</span><span>Если ваша цифра не сходится с бумагой поставщика — ' +
      'ищите строку, которой нет у вас (не загружена накладная) или лишнюю оплату. ' +
      'Нажмите «Подробнее» на строке, чтобы увидеть весь документ.</span></div>';
    return h;
  }

  var VIEWS = window.WM_EXTRA_VIEWS = window.WM_EXTRA_VIEWS || [];
  VIEWS.push(
    // встаём после последнего отчёта, чтобы раздел «Отчёты» не разрывался
    { id: 'import', icon: '📥', name: 'Импорт из 1С', group: 'Данные из 1С', render: viewImport, after: 'finday' },
    { id: 'match', icon: '🔗', name: 'Сопоставление имён', group: 'Данные из 1С', render: viewMatch, after: 'import' },
    { id: 'recon', icon: '🧷', name: 'Разбор оплат', group: 'Данные из 1С', render: viewRecon, after: 'match' },
    { id: 'confirm', icon: '✅', name: 'Подтверждение выплат', group: 'Данные из 1С', render: viewConfirm, after: 'recon' },
    { id: 'terms', icon: '⏱', name: 'Отсрочки поставщиков', group: 'Данные из 1С', render: viewTerms, after: 'confirm' },
    { id: 'reconcile', icon: '⚖️', name: 'Сверка с поставщиком', group: 'Данные из 1С', render: viewReconcile, after: 'terms' },
    { id: 'manual', icon: '✍️', name: 'Записать', group: 'Ручной ввод', render: viewManual, after: 'reconcile' },
    { id: 'records', icon: '🗂', name: 'Все записи', group: 'Ручной ввод', render: viewRecords, after: 'manual' },
    { id: 'debtors', icon: '📓', name: 'Долги покупателей', group: 'Ручной ввод', render: viewDebtors, after: 'records' },
    { id: 'sheets', icon: '📗', name: 'Книга Бухгалтерия', group: 'Ручной ввод', render: viewSheets, after: 'debtors' },
    { id: 'conflicts', icon: '⚖️', name: 'Расхождения с 1С', group: 'Данные из 1С', render: viewConflicts, after: 'reconcile' },
    { id: 'compare', icon: '📐', name: 'Сравнение периодов', group: 'Отчёты', render: viewCompare, after: 'finreport' },
    { id: 'markup', icon: '💹', name: 'Кто зарабатывает', group: 'Отчёты', render: viewMarkup, after: 'compare' },
    { id: 'payroll', icon: '🧾', name: 'Ведомость зарплаты', group: 'Отчёты', render: viewPayroll, after: 'markup' },
    { id: 'check', icon: '🩺', name: 'Проверка базы', group: 'Ручной ввод', render: viewCheck, after: 'sheets' },
    { id: 'reset', icon: '♻️', name: 'Сброс и откат базы', group: 'Ручной ввод', render: viewReset, after: 'check' }
  );
})();

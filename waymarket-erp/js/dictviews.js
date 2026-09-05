/* ============================================================================
   Экран «Справочники»: списки, которыми пользуетесь каждый день.
   Поставщики и сотрудники — карточками, остальное — списками слов.
   Файл подключается ДО js/ui.js и дополняет общий список экранов.
   ========================================================================== */
(function () {
  'use strict';
  var E = window.WM, S = window.WMStore, SUP = window.WMSupply, DI = window.WMDicts;

  function U() { return window.WMUI; }
  function DET() { return window.WMDetail; }
  function esc(s) { return U().esc(s); }
  function dateRu(d) { return U().dateRu(d); }
  function num(v) { return E.num(v); }
  function today() { return new Date().toISOString().slice(0, 10); }
  function refresh() { U().recompute(); }

  var TABS = [
    { id: 'firms', icon: '🏢', name: 'Поставщики' },
    { id: 'staff', icon: '👤', name: 'Сотрудники' }
  ].concat(DI.KINDS.map(function (k) {
    return { id: k.key, icon: k.icon, name: k.name };
  }));

  function tabBar(cur) {
    return '<div class="tabs">' + TABS.map(function (t) {
      return '<button class="chip' + (t.id === cur ? ' active' : '') +
        '" data-tab="dicts:' + t.id + '">' + t.icon + ' ' + esc(t.name) + '</button>';
    }).join('') + '</div>';
  }

  /* --- Поставщики -------------------------------------------------------------- */
  function viewFirms() {
    var u = U();
    var all = S.state.supreg || [];
    var live = DI.firmsActive(S.state), gone = DI.firmsArchived(S.state);
    var noPhone = live.filter(function (f) { return !f.phone; }).length;
    var noTerm = live.filter(function (f) { return f.termDays == null; }).length;

    var h = '<div class="stat-grid">' +
      u.stat('Поставщиков', u.nf(live.length), gone.length ? 'ещё ' + gone.length + ' закрыто' : 'все работают') +
      u.stat('Без телефона', u.nf(noPhone), noPhone ? 'некому позвонить о поставке' : 'у всех есть',
        noPhone ? 'c-orange' : 'c-green') +
      u.stat('Без отсрочки', u.nf(noTerm), noTerm ? 'дата выплаты считается по общему правилу' : 'у всех задана',
        noTerm ? 'c-orange' : 'c-green') +
      '</div>';

    h += '<div class="quick">' +
      '<button class="btn btn-primary" data-form="supFirm">＋ Добавить поставщика</button> ' +
      '<button class="btn" data-act="dict-firms-import">📥 Загрузить из 1С</button> ' +
      '<button class="btn" data-go="terms">⏱ Отсрочки списком</button></div>';

    h += '<div class="banner blue"><span>📥</span><span>«Загрузить из 1С» соберёт поставщиков из ' +
      'накладных, цен и «Контактной информации»: имена — в справочник, телефоны — в карточки. ' +
      'Программа сначала покажет, что собирается добавить, и ничего не сделает без вашего согласия.</span></div>';

    function firmTable(id, rows, archived) {
      return u.table(id, [
        { title: 'Фирма', fn: function (r) { return DET().link('firm', E.norm(r.name), r.name); } },
        { title: 'Отсрочка', cls: 'num', fn: function (r) {
          return r.termDays == null ? '<span class="c-muted">не задана</span>' : r.termDays + ' дн.'; } },
        { title: 'Чем платим', fn: function (r) { return esc(r.method || '—'); } },
        { title: 'Телефон', fn: function (r) {
          return r.phone ? '<a href="tel:' + esc(r.phone) + '">' + esc(r.phone) + '</a>'
            : '<span class="c-muted">нет</span>'; } },
        { title: 'Имена в 1С', fn: function (r) {
          var a = r.aliases || [];
          return a.length ? '<span class="c-muted">' + esc(a.slice(0, 3).join(', ')) +
            (a.length > 3 ? ' и ещё ' + (a.length - 3) : '') + '</span>' : '—'; } },
        { title: 'Записей', cls: 'num', fn: function (r) { return u.nf(DI.firmUsage(S.state, r.name)); } },
        { title: '', cls: 'center', fn: function (r) {
          var used = DI.firmUsage(S.state, r.name);
          return '<button class="btn btn-sm" data-edit="supreg:' + r.id + ':supFirm">✎</button> ' +
            (archived
              ? '<button class="btn btn-sm" data-act="firm-restore" data-id="' + r.id + '">Вернуть</button>'
              : '<button class="btn btn-sm" data-act="firm-archive" data-id="' + r.id + '">Больше не возит</button>') +
            (used ? '' : ' <button class="btn btn-sm btn-danger" data-act="firm-del" data-id="' + r.id + '">✕</button>'); } }
      ], rows, { step: 40, empty: archived ? 'Закрытых поставщиков нет'
        : 'Поставщиков пока нет. Загрузите из 1С или добавьте руками.' });
    }

    h += u.card('Работают', firmTable('dfLive', live, false),
      'Кнопка «Больше не возит» убирает поставщика из подсказок, накладные остаются');
    if (gone.length) {
      h += u.card('Больше не возят', firmTable('dfGone', gone, true),
        'В формах не предлагаются, в отчётах видны');
    }
    return h;
  }

  /* --- Сотрудники -------------------------------------------------------------- */
  function viewStaff() {
    var u = U();
    var live = DI.staffActive(S.state), gone = DI.staffFired(S.state);
    var missing = DI.staffFromRecords(S.state);

    var h = '<div class="stat-grid">' +
      u.stat('Работают', u.nf(live.length), gone.length ? 'уволено ' + gone.length : 'уволенных нет') +
      u.stat('Без ставки', u.nf(live.filter(function (p) {
        return !num(p.rate) && !num(p.salary) && !num(p.percent); }).length),
        'зарплата не посчитается', 'c-orange') +
      u.stat('Есть в записях, но без карточки', u.nf(missing.length),
        missing.length ? 'нажмите «Собрать из записей»' : 'все заведены',
        missing.length ? 'c-orange' : 'c-green') +
      '</div>';

    h += '<div class="quick">' +
      '<button class="btn btn-primary" data-form="staffCard">＋ Добавить сотрудника</button> ' +
      (missing.length ? '<button class="btn" data-act="dict-staff-import">👥 Собрать из записей (' +
        missing.length + ')</button> ' : '') +
      '<button class="btn" data-go="staffcards">👤 Личные листы</button> ' +
      '<button class="btn" data-go="sched">🗓 График смен</button></div>';

    if (missing.length) {
      h += '<div class="banner orange"><span>👥</span><span>В табеле, выплатах и сменах встречаются ' +
        'люди без карточки: <b>' + esc(missing.slice(0, 6).map(function (m) { return m.name; }).join(', ')) +
        (missing.length > 6 ? ' и ещё ' + (missing.length - 6) : '') + '</b>. ' +
        'Пока карточки нет, зарплата по ним не считается.</span></div>';
    }

    function staffTable(id, rows, fired) {
      return u.table(id, [
        { title: 'Имя', fn: function (r) { return DET().link('employee', E.norm(r.name), r.name); } },
        { title: 'Должность', fn: function (r) { return esc(r.position || '—'); } },
        { title: 'Как считаем', fn: function (r) { return esc(r.scheme || '—'); } },
        { title: 'Ставка / оклад', cls: 'num', fn: function (r) {
          var bits = [];
          if (num(r.rate)) bits.push(E.fmtMoney(r.rate) + '/ч');
          if (num(r.salary)) bits.push(E.fmtMoney(r.salary) + '/мес');
          if (num(r.percent)) bits.push(u.pct(r.percent) + ' с выручки');
          return bits.length ? '<span class="private">' + bits.join(' + ') + '</span>'
            : '<span class="c-orange">не задана</span>'; } },
        { title: 'Телефон', fn: function (r) {
          return r.phone ? '<a href="tel:' + esc(r.phone) + '">' + esc(r.phone) + '</a>' : '—'; } },
        { title: fired ? 'Уволен' : 'Принят', fn: function (r) {
          var d = fired ? r.fired : r.hired;
          return d ? esc(dateRu(d)) : '—'; } },
        { title: 'Записей', cls: 'num', fn: function (r) { return u.nf(DI.staffUsage(S.state, r.name)); } },
        { title: '', cls: 'center', fn: function (r) {
          var used = DI.staffUsage(S.state, r.name);
          return '<button class="btn btn-sm" data-edit="staff:' + r.id + ':staffCard">✎</button> ' +
            (fired
              ? '<button class="btn btn-sm" data-act="staff-hire" data-id="' + r.id + '">Вернуть в штат</button>'
              : '<button class="btn btn-sm" data-act="staff-fire" data-id="' + r.id + '">Уволить</button>') +
            (used ? '' : ' <button class="btn btn-sm btn-danger" data-act="staff-del" data-id="' + r.id + '">✕</button>'); } }
      ], rows, { step: 40, empty: fired ? 'Уволенных нет'
        : 'Сотрудников пока нет. Добавьте или соберите из записей.' });
    }

    h += u.card('В штате', staffTable('dsLive', live, false),
      'Уволенный не предлагается в формах, но его смены и выплаты остаются в отчётах');
    if (gone.length) h += u.card('Уволены', staffTable('dsGone', gone, true), '');
    return h;
  }

  /* --- Простые справочники: списки слов ------------------------------------------ */
  function viewSimple(key) {
    var u = U(), k = DI.kindOf(key);
    var rows = DI.list(S.state, S.settings, key);
    var live = rows.filter(function (r) { return !r.hidden; });
    var hid = rows.filter(function (r) { return r.hidden; });
    var unused = live.filter(function (r) { return !r.used; }).length;

    var h = '<div class="stat-grid">' +
      u.stat('Всего', u.nf(live.length), k.hint) +
      u.stat('Ни разу не использовали', u.nf(unused), unused ? 'их можно удалить' : 'все в деле') +
      (hid.length ? u.stat('Скрыто', u.nf(hid.length), 'в формах не предлагаются') : '') +
      '</div>';

    h += '<div class="quick"><button class="btn btn-primary" data-act="dict-add" data-kind="' +
      esc(key) + '">＋ Добавить ' + esc(k.one) + '</button></div>';

    function tbl(id, list, hidden) {
      return u.table(id, [
        { title: 'Название', fn: function (r) { return esc(r.name); } },
        { title: 'Где стоит', cls: 'num', fn: function (r) {
          return r.used ? u.nf(r.used) + ' ' + u.plural(r.used, 'запись', 'записи', 'записей')
            : '<span class="c-muted">нигде</span>'; } },
        { title: 'Откуда', fn: function (r) {
          return r.inList ? '<span class="c-muted">из справочника</span>'
            : '<span class="c-muted">вписано в форме</span>'; } },
        { title: '', cls: 'center', fn: function (r) {
          var d = ' data-kind="' + esc(key) + '" data-name="' + encodeURIComponent(r.name) + '"';
          return '<button class="btn btn-sm" data-act="dict-rename"' + d + '>Переименовать</button> ' +
            (hidden
              ? '<button class="btn btn-sm" data-act="dict-show"' + d + '>Вернуть</button>'
              : '<button class="btn btn-sm" data-act="dict-hide"' + d + '>Скрыть</button>') +
            (r.used ? '' : ' <button class="btn btn-sm btn-danger" data-act="dict-del"' + d + '>✕</button>'); } }
      ], list, { step: 40, empty: hidden ? 'Скрытых нет' : 'Пока пусто — нажмите «Добавить».' });
    }

    h += u.card(k.name, tbl('dk' + key, live, false), k.hint);
    if (hid.length) h += u.card('Скрытые', tbl('dkh' + key, hid, true),
      'В формах не предлагаются. Записи, где они стоят, не тронуты');

    h += '<div class="banner"><span>💡</span><span>«Переименовать» меняет слово и в справочнике, ' +
      'и во всех записях, где оно стоит, — поэтому отчёты не разъедутся на «Хозтовары» и ' +
      '«Хозрасходы». Удалить можно только то, чем ни разу не пользовались; всё остальное ' +
      '<b>скрывается</b>: из форм пропадает, в истории остаётся.</span></div>';
    return h;
  }

  /* --- Экран целиком ------------------------------------------------------------- */
  function viewDicts() {
    var u = U();
    var tab = u.tab('dicts', 'firms');
    if (!TABS.filter(function (t) { return t.id === tab; }).length) tab = 'firms';

    var h = u.pageHead('Справочники',
      'Поставщики, сотрудники и слова, которые подставляются в формах',
      '<button class="btn" data-act="print">🖨 Печать</button>');
    h += tabBar(tab);

    if (tab === 'firms') h += viewFirms();
    else if (tab === 'staff') h += viewStaff();
    else h += viewSimple(tab);
    return h;
  }

  /* --- Формы --------------------------------------------------------------------- */
  var FORMS = window.WM_EXTRA_FORMS = window.WM_EXTRA_FORMS || {};
  var DICT_KIND = '', DICT_OLD = '';

  FORMS.dictAdd = {
    title: 'Новое значение', icon: '📚',
    body: function (v) {
      var u = U(); v = v || {};
      var k = DI.kindOf(DICT_KIND) || { name: '', hint: '' };
      return u.fieldRow(k.name, 'name', 'text', v.name || '', { hint: k.hint });
    },
    save: function (v) {
      var res = DI.add(S.state, S.settings, DICT_KIND, v.name);
      if (res.error) return res.error;
      S.save(); refresh();
      return { ok: res.ok };
    }
  };

  FORMS.dictRename = {
    title: 'Переименовать', icon: '✏️',
    body: function (v) {
      var u = U(); v = v || {};
      var used = DI.usage(S.state, DICT_KIND, DICT_OLD);
      return u.fieldRow('Было', 'old', 'text', DICT_OLD, { hint: 'менять не нужно' }) +
        u.fieldRow('Станет', 'name', 'text', v.name || DICT_OLD) +
        u.fieldRow('Переписать в записях', 'records', 'select',
          v.records || (used ? 'да' : 'нет'), { options: ['да', 'нет'],
          hint: used ? 'сейчас это слово стоит в ' + used + ' записях' : 'записей с этим словом нет' });
    },
    hint: 'Если переписать в записях — отчёты не разъедутся на два похожих слова.',
    save: function (v) {
      var res = DI.rename(S.state, S.settings, DICT_KIND, DICT_OLD, v.name,
        String(v.records) === 'да');
      if (res.error) return res.error;
      S.save(); refresh();
      return { ok: res.ok };
    }
  };

  var FIRE_ID = '';
  FORMS.staffFire = {
    title: 'Увольнение', icon: '👋',
    body: function (v) {
      var u = U(); v = v || {};
      var p = (S.state.staff || []).filter(function (x) { return x.id === FIRE_ID; })[0] || {};
      return u.fieldRow('Кто', 'who', 'text', p.name || '', { hint: 'выбран в списке' }) +
        u.fieldRow('С какого числа не работает', 'fired', 'date', v.fired || today());
    },
    hint: 'Смены, выплаты и недостачи останутся в отчётах — уйдёт только из подсказок в формах.',
    save: function (v) {
      var p = (S.state.staff || []).filter(function (x) { return x.id === FIRE_ID; })[0];
      if (!p) return 'Сотрудник не найден.';
      p.fired = v.fired || today();
      S.save(); refresh();
      return { ok: p.name + ' уволен с ' + dateRu(p.fired) +
        '. В формах больше не предлагается, история осталась.' };
    }
  };

  /* --- Действия ------------------------------------------------------------------- */
  var A = window.WM_EXTRA_ACTIONS = window.WM_EXTRA_ACTIONS || {};

  A['dict-add'] = function (el) {
    DICT_KIND = el.dataset.kind;
    U().openForm('dictAdd');
    return null;
  };
  A['dict-rename'] = function (el) {
    DICT_KIND = el.dataset.kind;
    DICT_OLD = decodeURIComponent(el.dataset.name || '');
    U().openForm('dictRename');
    return null;
  };
  A['dict-hide'] = function (el) {
    var res = DI.hide(S.state, el.dataset.kind, decodeURIComponent(el.dataset.name || ''));
    if (res.error) return res.error;
    S.save(); refresh(); U().render();
    return res.ok;
  };
  A['dict-show'] = function (el) {
    var res = DI.show(S.state, el.dataset.kind, decodeURIComponent(el.dataset.name || ''));
    S.save(); refresh(); U().render();
    return res.ok;
  };
  A['dict-del'] = function (el) {
    var name = decodeURIComponent(el.dataset.name || '');
    var res = DI.remove(S.state, S.settings, el.dataset.kind, name);
    if (res.error) return res.error;
    S.save(); refresh(); U().render();
    return res.ok;
  };

  /* Сбор поставщиков из выгрузок 1С. Сначала показываем, что собираемся
     сделать, и только потом делаем — молча базу не меняем. */
  function importOpts() {
    var D = U().data();
    return { contacts: D.contacts || [], prices: D.prices || [] };
  }
  A['dict-firms-import'] = function () {
    var res = DI.firmsFromData(S.state, importOpts());
    if (!res.add.length && !res.update.length) {
      return 'Новых поставщиков не нашлось — все уже в справочнике. ' +
        'Если ждали больше, загрузите выгрузки 1С на экране «Импорт из 1С».';
    }
    var u = U();
    var body = '<div class="card"><div class="card-pad">' +
      'Программа посмотрела накладные, цены и «Контактную информацию» из 1С.<br><br>' +
      (res.add.length ? '<b>Добавить поставщиков: ' + res.add.length + '</b><br>' +
        '<span class="c-muted">' + esc(res.add.slice(0, 12).map(function (a) { return a.name; }).join(', ')) +
        (res.add.length > 12 ? ' и ещё ' + (res.add.length - 12) : '') + '</span><br><br>' : '') +
      (res.update.length ? '<b>Проставить телефон: ' + res.update.length + '</b><br>' +
        '<span class="c-muted">' + esc(res.update.slice(0, 12).map(function (a) { return a.name; }).join(', ')) +
        (res.update.length > 12 ? ' и ещё ' + (res.update.length - 12) : '') + '</span><br><br>' : '') +
      'Отсрочку и «чем платим» программа не выдумывает — их вы проставите сами ' +
      'на экране «Отсрочки поставщиков» или в карточке.' +
      '</div></div>' +
      '<div class="form-actions">' +
      '<button class="btn" data-act="close-sheet">Не сейчас</button>' +
      '<button class="btn btn-primary" data-act="dict-firms-apply">Добавить в справочник</button></div>';
    u.sheet('Поставщики из 1С', body);
    return null;
  };
  A['dict-firms-apply'] = function () {
    var res = DI.firmsFromData(S.state, importOpts());
    var reg = S.state.supreg = S.state.supreg || [];
    res.add.forEach(function (a) {
      var f = SUP.firmRecord(a.name);
      if (a.phone) f.phone = a.phone;
      reg.push(f);
    });
    res.update.forEach(function (up) {
      var f = SUP.findFirm(reg, up.name);
      if (f && !f.phone) f.phone = up.phone;
    });
    S.save(); refresh(); U().closeSheet(); U().render();
    return 'Справочник поставщиков пополнен: добавлено ' + res.add.length +
      (res.update.length ? ', телефонов проставлено ' + res.update.length : '') +
      '. Отсрочки задайте на экране «Отсрочки поставщиков».';
  };

  A['dict-staff-import'] = function () {
    var found = DI.staffFromRecords(S.state);
    if (!found.length) return 'Все, кто встречается в записях, уже заведены.';
    found.forEach(function (m) {
      S.add('staff', { name: m.name, position: '', scheme: '', rate: 0, salary: 0,
        normShifts: 15, percent: 0, phone: '', hired: '', note: 'заведён из записей' });
    });
    S.save(); refresh(); U().render();
    return 'Заведено сотрудников: ' + found.length +
      '. Откройте карточку и впишите ставку — иначе зарплата по ним не посчитается.';
  };

  A['staff-fire'] = function (el) {
    FIRE_ID = el.dataset.id;
    U().openForm('staffFire');
    return null;
  };
  A['staff-hire'] = function (el) {
    var p = (S.state.staff || []).filter(function (x) { return x.id === el.dataset.id; })[0];
    if (!p) return 'Сотрудник не найден.';
    p.fired = '';
    S.save(); refresh(); U().render();
    return p.name + ' снова в штате.';
  };
  A['staff-del'] = function (el) {
    var p = (S.state.staff || []).filter(function (x) { return x.id === el.dataset.id; })[0];
    if (!p) return 'Сотрудник не найден.';
    if (DI.staffUsage(S.state, p.name)) return 'У этого сотрудника есть записи — его можно только уволить.';
    if (!confirm('Удалить карточку «' + p.name + '»? Записей по нему нет.')) return null;
    S.remove('staff', p.id);
    refresh(); U().render();
    return 'Карточка удалена. Вернуть можно из корзины.';
  };

  A['firm-archive'] = function (el) {
    var f = (S.state.supreg || []).filter(function (x) { return x.id === el.dataset.id; })[0];
    if (!f) return 'Поставщик не найден.';
    f.archived = true;
    S.save(); refresh(); U().render();
    return '«' + f.name + '» убран из подсказок. Накладные и оплаты по нему остались.';
  };
  A['firm-restore'] = function (el) {
    var f = (S.state.supreg || []).filter(function (x) { return x.id === el.dataset.id; })[0];
    if (!f) return 'Поставщик не найден.';
    f.archived = false;
    S.save(); refresh(); U().render();
    return '«' + f.name + '» снова в работе.';
  };
  A['firm-del'] = function (el) {
    var f = (S.state.supreg || []).filter(function (x) { return x.id === el.dataset.id; })[0];
    if (!f) return 'Поставщик не найден.';
    if (DI.firmUsage(S.state, f.name)) return 'По этому поставщику есть записи — его можно только закрыть.';
    if (!confirm('Удалить «' + f.name + '» из справочника? Записей по нему нет.')) return null;
    S.remove('supreg', f.id);
    refresh(); U().render();
    return 'Удалено. Вернуть можно из корзины.';
  };

  var VIEWS = window.WM_EXTRA_VIEWS = window.WM_EXTRA_VIEWS || [];
  VIEWS.push({ id: 'dicts', icon: '📚', name: 'Справочники', group: 'Ручной ввод',
    render: viewDicts, after: 'records' });
})();

/* ============================================================================
   Экран «Справочники»: списки, которыми пользуетесь каждый день.
   Поставщики и сотрудники — карточками, остальное — списками слов.
   Файл подключается ДО js/ui.js и дополняет общий список экранов.
   ========================================================================== */
(function () {
  'use strict';
  var E = window.WM, S = window.WMStore, DI = window.WMDicts;

  function U() { return window.WMUI; }
  function esc(s) { return U().esc(s); }
  function ic(n, size) { return U().ic(n, size); }
  function dateRu(d) { return U().dateRu(d); }
  function num(v) { return E.num(v); }
  function today() { return new Date().toISOString().slice(0, 10); }
  function refresh() { U().recompute(); }

  var TABS = [{ id: 'accounts', icon: 'wallet', name: 'Счета' },
    { id: 'staff', icon: 'person', name: 'Сотрудники' }].concat(
    DI.KINDS.map(function (k) { return { id: k.key, icon: k.icon, name: k.name }; }));

  function tabBar(cur) {
    return '<div class="tabs">' + TABS.map(function (t) {
      return '<button class="chip' + (t.id === cur ? ' active' : '') +
        '" data-tab="dicts:' + t.id + '">' + ic(t.icon, 16) + ' ' + esc(t.name) + '</button>';
    }).join('') + '</div>';
  }

  /* --- Счета: где лежат деньги ---------------------------------------------
     Как в приложениях банков: сколько мест нужно, столько и заводим. Вид
     счёта решает, как он участвует в учёте, а не название. */
  function viewAccounts() {
    var u = U();
    var accs = S.state.accounts || [];
    var bal = E.accountBalances(S.state.dds || [], accs);
    var live = bal.rows.filter(function (a) { return !a.archived; });
    var gone = bal.rows.filter(function (a) { return a.archived; });

    var h = '<div class="stat-grid">' +
      u.stat('Наличными', u.priv(bal.totals.cash), 'в ящиках и сейфе') +
      u.stat('На счетах', u.priv(bal.totals.bank), 'эквайринг, СБП, переводы') +
      u.stat('Всего денег', u.priv(bal.totals.total), 'по всем счетам') +
      '</div>';

    h += '<div class="quick"><button class="btn btn-primary" data-form="accountCard">' +
      ic('plus') + ' Новый счёт</button> ' +
      '<button class="btn" data-form="moveCash">' + ic('truck') + ' Перевести между счетами</button></div>';

    if (!live.some(function (a) { return a.defaultCash; })) {
      h += '<div class="banner orange"><span>' + ic('warning') + '</span><span>' +
        'Не выбран счёт для наличной выручки. Отметьте его в карточке счёта — ' +
        'иначе при закрытии смены придётся выбирать каждый раз.</span></div>';
    }

    function table(id, rows, archived) {
      return u.table(id, [
        { title: 'Счёт', fn: function (r) { return esc(r.name); } },
        { title: 'Вид', fn: function (r) {
          var k = S.ACCOUNT_KINDS.filter(function (x) { return x.key === r.kind; })[0];
          return u.badge(k ? k.name : r.kind, r.kind === 'bank' ? 'blue' : 'gray'); } },
        { title: 'По умолчанию', fn: function (r) {
          var b = [];
          if (r.defaultCash) b.push('наличная выручка');
          if (r.defaultCashless) b.push('безнал');
          return b.length ? esc(b.join(', ')) : '—'; } },
        { title: 'Было на старте', cls: 'num', fn: function (r) { return u.priv(r.opening); } },
        { title: 'Сейчас', cls: 'num', fn: function (r) {
          return '<b class="' + (r.balance < 0 ? 'c-red' : '') + '">' + u.priv(r.balance) + '</b>'; } },
        { title: '', cls: 'center', fn: function (r) {
          return '<button class="btn btn-sm" data-edit="accounts:' + esc(r.id) + ':accountCard">' +
            ic('edit', 16) + '</button> ' +
            (archived
              ? '<button class="btn btn-sm" data-act="acc-use" data-id="' + esc(r.id) + '">Вернуть</button>'
              : '<button class="btn btn-sm" data-act="acc-hide" data-id="' + esc(r.id) + '">Убрать</button>'); } }
      ], rows, { step: 30, empty: archived ? 'Убранных счетов нет'
        : 'Счетов нет — заведите хотя бы кассу' });
    }

    h += u.card('Счета', table('accLive', live, false),
      'Ящик пересчитывают при закрытии смены, остальные меняются переводами и расходами');
    if (gone.length) h += u.card('Убранные', table('accGone', gone, true), '');
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
      '<button class="btn btn-primary" data-form="staffCard">' + ic('plus') + ' Добавить сотрудника</button> ' +
      (missing.length ? '<button class="btn" data-act="dict-staff-import">' + ic('people') + ' Собрать из записей (' +
        missing.length + ')</button> ' : '') +
      '<button class="btn" data-go="staffcards">' + ic('person') + ' Личные листы</button> ' +
      '<button class="btn" data-go="sched">' + ic('calendar') + ' График смен</button></div>';

    if (missing.length) {
      h += '<div class="banner orange"><span>' + ic('people') + '</span><span>В табеле, выплатах и сменах встречаются ' +
        'люди без карточки: <b>' + esc(missing.slice(0, 6).map(function (m) { return m.name; }).join(', ')) +
        (missing.length > 6 ? ' и ещё ' + (missing.length - 6) : '') + '</b>. ' +
        'Пока карточки нет, зарплата по ним не считается.</span></div>';
    }

    function staffTable(id, rows, fired) {
      return u.table(id, [
        { title: 'Имя', fn: function (r) { return esc(r.name); } },
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
          return '<button class="btn btn-sm" data-edit="staff:' + r.id + ':staffCard">' + ic('edit') + '</button> ' +
            (fired
              ? '<button class="btn btn-sm" data-act="staff-hire" data-id="' + r.id + '">Вернуть в штат</button>'
              : '<button class="btn btn-sm" data-act="staff-fire" data-id="' + r.id + '">Уволить</button>') +
            (used ? '' : ' <button class="btn btn-sm btn-danger" data-act="staff-del" data-id="' + r.id + '">' + ic('close') + '</button>'); } }
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
      esc(key) + '">' + ic('plus') + ' Добавить ' + esc(k.one) + '</button>' +
      '<button class="btn" data-act="dict-paste" data-kind="' + esc(key) + '">' +
      ic('clipboard') + ' Вставить списком из Excel</button></div>';

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
            (r.used ? '' : ' <button class="btn btn-sm btn-danger" data-act="dict-del"' + d + '>' + ic('close') + '</button>'); } }
      ], list, { step: 40, empty: hidden ? 'Скрытых нет' : 'Пока пусто — нажмите «Добавить».' });
    }

    h += u.card(k.name, tbl('dk' + key, live, false), k.hint);
    if (hid.length) h += u.card('Скрытые', tbl('dkh' + key, hid, true),
      'В формах не предлагаются. Записи, где они стоят, не тронуты');

    h += '<div class="banner"><span>' + ic('info') + '</span><span>«Переименовать» меняет слово и в справочнике, ' +
      'и во всех записях, где оно стоит, — поэтому отчёты не разъедутся на «Хозтовары» и ' +
      '«Хозрасходы». Удалить можно только то, чем ни разу не пользовались; всё остальное ' +
      '<b>скрывается</b>: из форм пропадает, в истории остаётся.</span></div>';
    return h;
  }

  /* --- Экран целиком ------------------------------------------------------------- */
  function viewDicts() {
    var u = U();
    var tab = u.tab('dicts', 'accounts');
    if (!TABS.filter(function (t) { return t.id === tab; }).length) tab = 'firms';

    var h = u.pageHead('Справочники',
      'Счета, сотрудники и слова, которые подставляются в формах',
      '<button class="btn" data-act="print">' + ic('print') + ' Печать</button>');
    h += tabBar(tab);

    if (tab === 'accounts') h += viewAccounts();
    else if (tab === 'staff') h += viewStaff();
    else h += viewSimple(tab);
    return h;
  }

  /* --- Формы --------------------------------------------------------------------- */
  var FORMS = window.WM_EXTRA_FORMS = window.WM_EXTRA_FORMS || {};
  var DICT_KIND = '', DICT_OLD = '';

  FORMS.dictAdd = {
    title: 'Новое значение', icon: 'book',
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
    title: 'Переименовать', icon: 'edit',
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

  /* Карточка счёта. Вид меняет поведение, поэтому подписан словами:
     владелец выбирает не «till», а «денежный ящик». */
  FORMS.accountCard = {
    title: 'Счёт', icon: 'wallet',
    editsInPlace: true,
    body: function (v) {
      var u = U(); v = v || {};
      var kind = v.kind || 'cash';
      var k = S.ACCOUNT_KINDS.filter(function (x) { return x.key === kind; })[0];
      return u.fieldRow('Название', 'name', 'text', v.name || '',
        { placeholder: 'Касса 2, Сейф, Счёт в Сбере, Карта' }) +
        u.fieldRow('Вид счёта', 'kind', 'select', kind,
          { options: S.ACCOUNT_KINDS.map(function (x) { return { value: x.key, text: x.name }; }),
            hint: k ? k.hint : '' }) +
        u.fieldRow('Было на старте', 'opening', 'number', v.opening || 0,
          { hint: 'сколько лежит на этом счёте в день, когда начинаете вести учёт' }) +
        u.fieldRow('Сюда идёт наличная выручка', 'defaultCash', 'select',
          v.defaultCash ? 'да' : 'нет', { options: ['да', 'нет'],
            hint: 'подставляется при закрытии смены' }) +
        u.fieldRow('Сюда идёт безнал', 'defaultCashless', 'select',
          v.defaultCashless ? 'да' : 'нет', { options: ['да', 'нет'],
            hint: 'карта, СБП, эквайринг' }) +
        u.fieldRow('Заметка', 'note', 'text', v.note || '');
    },
    hint: 'Денежный ящик пересчитывают при закрытии смены — его остаток правит факт. ' +
      'Наличные и безнал меняются переводами, расходами и приходами.',
    save: function (v) {
      if (!E.txt(v.name)) return 'Впишите название счёта.';
      var bad = window.WMQuick.checkAmount(v.opening, { allowEmpty: true, allowZero: true,
        allowNegative: true });
      if (bad) return 'Остаток на старте: ' + bad;
      var ed = U().editing();
      var same = (S.state.accounts || []).filter(function (a) {
        return E.norm(a.name) === E.norm(v.name) && (!ed || a.id !== ed.id);
      })[0];
      if (same) return 'Счёт «' + same.name + '» уже есть.';
      var rec = { name: E.txt(v.name), kind: E.txt(v.kind) || 'cash',
        opening: num(v.opening), note: E.txt(v.note),
        defaultCash: E.norm(v.defaultCash) === 'да',
        defaultCashless: E.norm(v.defaultCashless) === 'да' };
      // «По умолчанию» бывает только у одного счёта: иначе непонятно, куда класть
      if (rec.defaultCash || rec.defaultCashless) {
        (S.state.accounts || []).forEach(function (a) {
          if (ed && a.id === ed.id) return;
          if (rec.defaultCash) a.defaultCash = false;
          if (rec.defaultCashless) a.defaultCashless = false;
        });
      }
      if (ed) S.update(ed.coll, ed.id, rec); else S.add('accounts', rec);
      S.save(); refresh();
      return { ok: 'Счёт «' + rec.name + '» сохранён.' };
    }
  };

  /* Вставка из Excel. Владелец копирует столбец в таблице и вставляет сюда —
     разбирать файл не нужно, буфер обмена и так отдаёт по строке на значение. */
  FORMS.dictPaste = {
    title: 'Вставить список', icon: 'clipboard',
    body: function (v) {
      var u = U(); v = v || {};
      var k = DI.kindOf(DICT_KIND) || { name: '', one: 'значение' };
      return '<div class="form-row"><label>' + esc(k.name) +
        '<small style="display:block;font-size:12px;color:var(--label-2);font-weight:400">' +
        'по одному в строке — как в столбце Excel</small></label>' +
        '<textarea name="text" rows="9" placeholder="Продавец-кассир&#10;Товаровед&#10;' +
        'Администратор&#10;Уборщица" style="width:100%;font:inherit;padding:10px 12px;' +
        'border:1px solid var(--separator);border-radius:var(--r-inner);' +
        'background:var(--bg-inset);color:var(--label);resize:vertical"></textarea></div>';
    },
    hint: 'Откройте свою таблицу, выделите столбец, скопируйте — и вставьте сюда. ' +
      'Если скопировали несколько столбцов, программа возьмёт первый. ' +
      'То, что уже есть в списке, второй раз не добавится.',
    save: function (v) {
      var res = DI.addMany(S.state, S.settings, DICT_KIND, v.text);
      if (res.error) return res.error;
      S.save(); refresh();
      return { ok: res.ok };
    }
  };

  var FIRE_ID = '';
  FORMS.staffFire = {
    title: 'Увольнение', icon: 'person',
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
  A['dict-paste'] = function (el) {
    DICT_KIND = el.dataset.kind;
    U().openForm('dictPaste');
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

  A['acc-hide'] = function (el) {
    var a = (S.state.accounts || []).filter(function (x) { return x.id === el.dataset.id; })[0];
    if (!a) return 'Счёт не найден.';
    var live = (S.state.accounts || []).filter(function (x) { return !x.archived; });
    if (live.length <= 1) return 'Это последний счёт — деньги должно быть куда класть.';
    a.archived = true; a.defaultCash = false; a.defaultCashless = false;
    S.save(); refresh(); U().render();
    return 'Счёт «' + a.name + '» убран из форм. Записи по нему остались, остаток считается.';
  };
  A['acc-use'] = function (el) {
    var a = (S.state.accounts || []).filter(function (x) { return x.id === el.dataset.id; })[0];
    if (!a) return 'Счёт не найден.';
    a.archived = false;
    S.save(); refresh(); U().render();
    return 'Счёт «' + a.name + '» снова в списке.';
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

  var VIEWS = window.WM_EXTRA_VIEWS = window.WM_EXTRA_VIEWS || [];
  VIEWS.push({ id: 'dicts', icon: 'book', name: 'Справочники', group: 'Ещё',
    render: viewDicts, after: 'data' });
})();

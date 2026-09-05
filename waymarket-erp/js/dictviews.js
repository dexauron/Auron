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
  function dateRu(d) { return U().dateRu(d); }
  function num(v) { return E.num(v); }
  function today() { return new Date().toISOString().slice(0, 10); }
  function refresh() { U().recompute(); }

  var TABS = [{ id: 'staff', icon: '👤', name: 'Кассиры' }].concat(
    DI.KINDS.map(function (k) { return { id: k.key, icon: k.icon, name: k.name }; }));

  function tabBar(cur) {
    return '<div class="tabs">' + TABS.map(function (t) {
      return '<button class="chip' + (t.id === cur ? ' active' : '') +
        '" data-tab="dicts:' + t.id + '">' + t.icon + ' ' + esc(t.name) + '</button>';
    }).join('') + '</div>';
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
    var tab = u.tab('dicts', 'staff');
    if (!TABS.filter(function (t) { return t.id === tab; }).length) tab = 'firms';

    var h = u.pageHead('Справочники',
      'Поставщики, сотрудники и слова, которые подставляются в формах',
      '<button class="btn" data-act="print">🖨 Печать</button>');
    h += tabBar(tab);

    if (tab === 'staff') h += viewStaff();
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

  var VIEWS = window.WM_EXTRA_VIEWS = window.WM_EXTRA_VIEWS || [];
  VIEWS.push({ id: 'dicts', icon: '📚', name: 'Справочники', group: 'Ещё',
    render: viewDicts, after: 'data' });
})();

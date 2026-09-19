/* ============================================================================
   ЭКРАН РЕВИЗОРА И КОНСТРУКТОР ПРАВИЛ

   Экран отвечает на один вопрос: «всё ли в порядке с моими деньгами прямо
   сейчас». Если да — так и написано, крупно, и больше ничего. Если нет —
   список находок, каждая объяснена словами и, где можно, с готовой поправкой.

   Конструктор собирает правило из списков. Владелец видит собранную фразу
   целиком, пока выбирает, — и понимает, что получится, до сохранения.
   ========================================================================== */
(function () {
  'use strict';
  var E = window.WM, S = window.WMStore, R = window.WMRevizor;
  function U() { return window.WMUI; }
  function esc(s) { return U().esc(s); }
  function ic(n, size) { return U().ic(n, size); }
  function money(v) { return E.fmtMoney(v); }
  function refresh() { U().recompute(); }
  function rules() { return S.state.rules || []; }

  function прогон() { return R.check(S.state, S.settings); }

  var ЦВЕТ = { alarm: 'red', warn: 'orange', note: 'blue' };
  var ЗНАЧОК = { alarm: 'warning', warn: 'bell', note: 'info' };

  function viewRevizor() {
    var u = U(), r = прогон();
    var h = u.pageHead('Ревизор', 'Программа проверяет саму себя и ваши записи',
      '<button class="btn btn-primary" data-form="ruleNew">' + ic('plus') +
      ' Своё правило</button>');

    h += '<div class="stat-grid">' +
      u.stat('Тревоги', u.nf(r.counts.alarm), 'разобрать сегодня',
        r.counts.alarm ? 'c-red' : 'c-green') +
      u.stat('Внимание', u.nf(r.counts.warn), 'посмотреть на неделе',
        r.counts.warn ? 'c-orange' : '') +
      u.stat('Заметки', u.nf(r.counts.note), 'к сведению') +
      '</div>';

    if (r.clean) {
      h += u.blank({ icon: 'check', title: 'Всё сходится',
        why: 'Деньги сходятся до копейки, смены закрыты, расхождений нет. ' +
          'Ревизор проверяет это сам при каждом изменении — вам заходить сюда ' +
          'незачем, пока он молчит.',
        actions: [{ name: 'Собрать своё правило', form: 'ruleNew', icon: 'plus' }] });
    } else {
      h += u.card('Что нашлось', u.listOf(r.findings.map(function (f) {
        var подробно = (f.what
          ? '<b class="c-' + ЦВЕТ[f.level] + '">' + esc(f.what) + '</b>' : '') +
          u.more(f.why, 'Почему');
        return u.listRow({ icon: ЗНАЧОК[f.level] || 'info',
          title: f.title + (f.own ? ' · ваше правило' : ''),
          sub: подробно,
          value: '<span class="badge ' + ЦВЕТ[f.level] + '">' +
            esc(R.level(f.level).name) + '</span>',
          tap: !!f.go, attrs: f.go ? ' data-go="' + esc(f.go) + '"' : '' });
      }), ''));
    }

    /* --- Правила владельца --------------------------------------------------- */
    var свои = rules();
    h += '<div class="card"><div class="card-head"><div class="card-title">Мои правила</div>' +
      '<div class="card-sub">собираются из готовых кубиков, без программирования</div></div>';
    if (!свои.length) {
      h += '<div class="empty">' + ic('gear') +
        ' Своих правил пока нет. Программа и без них стережёт деньги — ' +
        'свои нужны, когда у вашего магазина есть привычки, о которых она не знает.' +
        '<div class="blank-acts"><button class="btn btn-primary" data-form="ruleNew">' +
        'Собрать первое</button></div></div>';
    } else {
      h += u.listOf(свои.map(function (rl) {
        return u.listRow({ icon: rl.off ? 'close' : 'check',
          title: E.txt(rl.title) || R.ruleText(rl),
          sub: R.ruleText(rl) + (E.txt(rl.what) ? ' · ' + E.txt(rl.what) : ''),
          value: '<button class="btn btn-sm" data-act="rule-off" data-id="' + esc(rl.id) + '">' +
            (rl.off ? 'Включить' : 'Выключить') + '</button>' +
            ' <button class="btn btn-sm" data-act="rule-del" data-id="' + esc(rl.id) + '">' +
            ic('trash', 14) + '</button>',
          tap: true, attrs: ' data-edit="rules:' + esc(rl.id) + ':ruleNew"' });
      }), '');
    }
    h += '</div>';

    h += '<div class="card"><div class="card-head"><div class="card-title">' +
      'Что Ревизор стережёт всегда' + u.more('Эти проверки выключить нельзя: они ' +
        'стерегут сами деньги, а не привычки магазина.') +
      '</div></div><div class="rev-list">' +
      ['Деньги сходятся: у каждого рубля есть пара — откуда пришёл и куда ушёл',
        'Инкассация: сколько пробила касса и сколько доехало до сейфа',
        'Терминал и касса говорят одно и то же',
        'Крупные расхождения по кассе — с подсказкой, какое число поправить',
        'Выплаты из ящика расписаны по статьям'
      ].map(function (t) {
        return '<div class="rev-item">' + ic('check', 15) + '<span>' + esc(t) + '</span></div>';
      }).join('') + '</div></div>';
    return h;
  }

  /* --- Конструктор правила ------------------------------------------------------ */
  var FORMS = window.WM_EXTRA_FORMS = window.WM_EXTRA_FORMS || {};

  FORMS.ruleNew = {
    title: 'Своё правило', icon: 'gear',
    editsInPlace: true,
    body: function (v) {
      var u = U(); v = v || {};
      var м = R.metric(v.metric) || R.МЕТРИКИ[0];
      var текущее = { metric: v.metric || м.id, op: v.op || '>',
        value: v.value != null ? v.value : 1000, level: v.level || 'warn' };
      return '<div class="rule-preview">' + ic('info', 16) +
        '<span>' + esc(R.ruleText(текущее)) + '</span></div>' +
        u.fieldRow('Что смотрим', 'metric', 'select', текущее.metric,
          { options: R.МЕТРИКИ.map(function (x) {
            return { value: x.id, text: x.name + ' (' + x.scope + ', ' + x.unit + ')' };
          }), hint: м.hint }) +
        u.fieldRow('Условие', 'op', 'select', текущее.op,
          { options: R.СРАВНЕНИЯ.map(function (x) { return { value: x.id, text: x.name }; }) }) +
        u.fieldRow('Сколько', 'value', 'number', текущее.value,
          { unit: м.unit === '₽' ? 'money' : 'plain',
            hint: 'порог, после которого Ревизор скажет' }) +
        u.fieldRow('Насколько важно', 'level', 'select', текущее.level,
          { options: R.УРОВНИ.map(function (x) { return { value: x.id, text: x.name }; }),
            hint: 'тревога — разобрать сегодня, внимание — на неделе, заметка — к сведению' }) +
        u.fieldRow('Заголовок', 'title', 'text', v.title || '',
          { placeholder: 'например: много наличных в кассе',
            hint: 'как эта находка будет называться в списке' }) +
        u.fieldRow('Что делать', 'what', 'text', v.what || '',
          { placeholder: 'например: увезти в сейф',
            hint: 'ваш совет самому себе — Ревизор покажет его рядом' });
    },
    hint: 'Правило собирается из готовых кубиков: показатель, условие, порог. ' +
      'Формулы писать не нужно, и сломать расчёты таким правилом нельзя — ' +
      'оно только смотрит и говорит.',
    save: function (v) {
      var м = R.metric(v.metric);
      if (!м) return 'Выберите, что смотреть.';
      if (!R.op(v.op)) return 'Выберите условие.';
      var bad = window.WMQuick.checkAmount(v.value, { allowZero: true });
      if (bad) return 'Порог: ' + bad;
      var ed = U().editing();
      var rec = { metric: E.txt(v.metric), op: E.txt(v.op), value: E.num(v.value),
        level: E.txt(v.level) || 'warn', title: E.txt(v.title), what: E.txt(v.what),
        off: ed ? !!(rules().filter(function (r) { return r.id === ed.id; })[0] || {}).off : false };
      if (ed) S.update(ed.coll, ed.id, rec); else S.add('rules', rec);
      S.save(); refresh();
      return { ok: 'Правило записано: ' + R.ruleText(rec) + '.' };
    }
  };

  var A = window.WM_EXTRA_ACTIONS = window.WM_EXTRA_ACTIONS || {};

  A['rule-off'] = function (el) {
    var id = E.txt(el.dataset.id);
    var r = rules().filter(function (x) { return x.id === id; })[0];
    if (!r) return 'Правило не найдено.';
    S.update('rules', id, { off: !r.off });
    S.save(); refresh();
    return r.off ? 'Правило снова работает.' : 'Правило выключено — оно осталось, но молчит.';
  };

  A['rule-del'] = function (el) {
    var id = E.txt(el.dataset.id);
    var r = rules().filter(function (x) { return x.id === id; })[0];
    if (!r) return 'Правило не найдено.';
    S.remove('rules', id);
    S.save(); refresh();
    return 'Правило убрано.';
  };

  var V = window.WM_EXTRA_VIEWS = window.WM_EXTRA_VIEWS || [];
  V.push({ id: 'revizor', icon: 'lifebuoy', name: 'Ревизор', group: 'Каждый день',
    render: viewRevizor });
})();

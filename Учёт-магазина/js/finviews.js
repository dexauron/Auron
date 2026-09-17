/* ============================================================================
   Экраны кассового учёта.

   Порядок дня в магазине 24/7:
     утром  — закрыли смену, сверили ящик  → экран «Утро: сверка кассы»;
     вечером — записали товар и долги      → экран «Вечер: итоги дня»;
     когда нужно — план выплат, расходы, долги покупателей.

   Два правила, на которых держится вся арифметика:
   1. В ящике только наличные. Карта и СБП туда не попадают.
   2. У каждой цифры один источник. Кассу двигают смены и явные расходы;
      долг поставщикам — только вечерние итоги. Двух дорог к одному числу
      нет специально: они всегда кончаются двойным счётом.
   ========================================================================== */
(function () {
  'use strict';
  var E = window.WM, S = window.WMStore, Q = window.WMQuick;

  function U() { return window.WMUI; }
  function FLT() { return window.WMFilter; }
  function esc(s) { return U().esc(s); }
  function ic(n, size) { return U().ic(n, size); }
  function dateRu(d) { return U().dateRu(d); }
  function num(v) { return E.num(v); }
  function money(v) { return E.fmtMoney(v); }
  function today() { return E.today(); }
  function dds() { return S.state.dds || []; }
  function refresh() { U().recompute(); }

  function dict(name, fallback) {
    var v = S.settings[name];
    if (typeof v === 'string' && v.trim()) {
      return v.split(',').map(function (x) { return x.trim(); }).filter(Boolean);
    }
    return fallback || [];
  }
  function tills() { return dict('tills', E.TILLS); }

  /* Счета для выпадающих списков. Убранные не предлагаем, но и не теряем:
     в старых записях они остаются, и остаток по ним считается. */
  function accounts() { return (S.state.accounts || []).filter(function (a) { return !a.archived; }); }
  function accOptions(kinds) {
    return accounts().filter(function (a) { return !kinds || kinds.indexOf(a.kind) >= 0; })
      .map(function (a) { return { value: a.id, text: a.name }; });
  }
  function accDefault(cashless) {
    var a = E.defaultAccount(accounts(), cashless);
    return a ? a.id : '';
  }

  /* --------------------------------------------------------------------------
     С КАКОГО СЧЁТА ПОДСТАВИТЬ В «РАСХОДЕ»

     Выбирать счёт при каждом расходе утомительно, а один общий счёт по
     умолчанию врёт: обед покупают из кассы, аренду платят переводом.
     Поэтому по старшинству:

       1. ЧЕМ ЗАПЛАТИЛИ ПРОШЛЫЙ РАЗ ПО ЭТОЙ СТАТЬЕ. Программа сама помнит:
          «Аренда» вспомнит счёт, «Обед» — кассу. Ничего настраивать не надо.
       2. Счёт, отмеченный в карточке как «отсюда обычно платим расходы».
       3. Счёт наличной выручки — как было раньше.

     Счёт всё равно виден в форме и меняется одним нажатием: подстановка
     экономит время, а не отнимает выбор.
     -------------------------------------------------------------------------- */
  function funds() { return S.state.funds || []; }
  function fundOptions(withNone) {
    var o = withNone ? [{ value: '', text: '— не в конверт —' }] : [];
    return o.concat(funds().map(function (f) {
      return { value: f.id, text: f.name };
    }));
  }
  /* Конверт по названию статьи. Заплатили «Аренду» — программа сама
     подставит конверт «Аренда», если он есть. Без этого владелец платил бы
     аренду обычным расходом, забывал отметить конверт, и тот рос бы вечно,
     показывая деньги, которых давно нет. */
  function fundForCategory(category) {
    var c = E.norm(category);
    if (!c) return '';
    var hit = funds().filter(function (f) { return E.norm(f.name) === c; })[0];
    return hit ? hit.id : '';
  }

  function fundName(id) {
    var f = funds().filter(function (x) { return x.id === id; })[0];
    return f ? f.name : '';
  }

  function accForCategory(category, cashless) {
    var cat = E.norm(category);
    if (cat) {
      var rows = dds().filter(function (r) {
        return E.isExpense(r) && E.norm(r.category) === cat && E.txt(r.account);
      });
      // берём самую свежую по дате, а при равных — последнюю записанную
      var best = null;
      rows.forEach(function (r) {
        if (!best || E.txt(r.date) >= E.txt(best.date)) best = r;
      });
      if (best) {
        var live = accounts().filter(function (a) {
          return a.id === E.txt(best.account) && !a.archived;
        })[0];
        if (live) return live.id;
      }
    }
    var pick = accounts().filter(function (a) { return a.defaultExpense && !a.archived; })[0];
    if (pick) return pick.id;
    return accDefault(cashless);
  }
  function accName(id) {
    var a = accounts().filter(function (x) { return x.id === id; })[0];
    return a ? a.name : '';
  }
  function shiftNames() { return dict('shiftNames', E.SHIFTS); }
  function cashiers() { return Q.dicts(S.state, S.settings).cashiers; }
  function categories() { return Q.dicts(S.state, S.settings).categories; }
  function methods() { return Q.dicts(S.state, S.settings).methods; }
  function suppliers() { return Q.dicts(S.state, S.settings).suppliers; }
  function learn(map) {
    var changed = false;
    Object.keys(map).forEach(function (d) {
      if (Q.learn(S.settings, d, map[d], S.state)) changed = true;
    });
    if (changed) S.save();
  }
  function period() {
    return dds().filter(function (r) { return U().inPeriod(r.date); });
  }
  // Если за выбранный период записей нет — считаем по всему, но говорим об этом
  function pick() {
    var p = period();
    if (p.length) return { rows: p, whole: false };
    return { rows: dds(), whole: true };
  }
  function wholeNote(sel) {
    if (!sel.whole || !dds().length) return '';
    return '<div class="banner blue"><span>' + ic('info') + '</span><span>За ' +
      esc(U().periodName().toLowerCase()) + ' записей нет — показаны все данные.</span></div>';
  }

  // Факт последней закрытой смены по этой кассе: подставляем как размен
  function lastFact(till) {
    var list = E.shiftsOf(dds(), function (r) { return E.txt(r.till) === E.txt(till); },
      S.settings);
    if (!list.length) return null;
    var prev = list[list.length - 1];
    return { fact: E.shiftCalc(prev).factCash, date: E.txt(prev.date), shift: E.txt(prev.shift) };
  }

  /* ==========================================================================
     ФОРМЫ
     ========================================================================== */
  var FORMS = window.WM_EXTRA_FORMS = window.WM_EXTRA_FORMS || {};

  /* --- Утро: сверка кассы ----------------------------------------------------
     Единственное место, где считается расхождение. Безнал сюда не входит:
     этих денег в ящике не было. */
  /* --------------------------------------------------------------------------
     РАСХОЖДЕНИЕ ВИДНО СРАЗУ, А НЕ ПОСЛЕ СОХРАНЕНИЯ

     Кассир сдаёт смену и хочет знать, сошлось ли, ПОКА он у кассы и помнит,
     что брал. Раньше расхождение показывалось только после «Сохранить» —
     и разбираться приходилось задним числом.

     Считаем то же самое, что и движок, той же формулой: размен + Z-наличные
     − выплаты = расчётный остаток; факт − расчётный = расхождение.
     -------------------------------------------------------------------------- */
  function shiftSumBox(v) {
    v = v || {};
    function n(x) {
      if (x == null || x === '') return 0;
      var c = window.WMNum.calc(String(x));
      return c === null ? num(x) : c;
    }
    /* Считаем ровно тем же движком, что и при сохранении: чтобы то, что
       владелец видит в форме, не разошлось с тем, что потом ляжет в базу. */
    var c = E.shiftCalc({
      openCash: n(v.openCash), zCash: n(v.zCash), zCashless: n(v.zCashless),
      payouts: n(v.payouts), factCash: n(v.factCash),
      returnsCash: n(v.returnsCash), returnsCashless: n(v.returnsCashless),
      deposits: n(v.deposits), collected: n(v.collected),
      zCard: n(v.zCard), zQr: n(v.zQr), zNfc: n(v.zNfc), checks: n(v.checks),
      factFilled: v.factCash !== '' && v.factCash != null
    });
    var zb = c.zCashless, пусто = !c.zCash && !c.factCash && !c.payouts;

    var h = '<div class="cc-total">';
    h += '<div class="cc-line"><span>Размен на начало</span><b>' + esc(money(c.openCash)) + '</b></div>';
    h += '<div class="cc-line"><span>+ Z-отчёт: наличные</span><b>' + esc(money(c.zCash)) + '</b></div>';
    // Показываем только те строки, которые владелец заполнил: пустые молчат
    if (c.returnsCash) h += '<div class="cc-line"><span>− Возвраты покупателям</span><b>' +
      esc(money(c.returnsCash)) + '</b></div>';
    if (c.deposits) h += '<div class="cc-line"><span>+ Внесения в кассу</span><b>' +
      esc(money(c.deposits)) + '</b></div>';
    h += '<div class="cc-line"><span>− Выплаты из ящика</span><b>' + esc(money(c.payouts)) + '</b></div>';
    if (c.collected) h += '<div class="cc-line"><span>− Инкассация</span><b>' +
      esc(money(c.collected)) + '</b></div>';
    h += '<div class="cc-line" style="border-top:1px solid var(--separator);padding-top:8px">' +
      '<span>Должно быть в ящике</span><b class="cc-big">' + esc(money(c.expected)) + '</b></div>';
    h += '<div class="cc-line"><span>Факт в ящике</span><b>' + esc(money(c.factCash)) + '</b></div>';

    if (пусто) {
      h += '<div class="cc-sub">Впишите Z-отчёт и факт — расхождение посчитается само.</div>';
    } else {
      h += '<div class="cc-line cc-diff ' + (c.ok ? 'ok' : (c.diff < 0 ? 'bad' : 'warn')) + '">' +
        '<span>' + (c.ok ? 'Сходится' : (c.diff < 0 ? 'НЕДОСТАЧА' : 'ИЗЛИШЕК')) + '</span>' +
        '<b>' + (c.ok ? '—' : esc(money(Math.abs(c.diff)))) + '</b></div>';
      if (!c.ok) {
        /* Раньше здесь был совет вообще: «проверьте выплаты и возвраты».
           При расхождении в 56 231 ₽ такой совет бесполезен — владелец решает,
           что врёт программа. Теперь показываем обратный счёт: каким должно
           было быть КАЖДОЕ поле, чтобы ящик сошёлся. По этому списку ошибка
           находится за минуту — одно из чисел он узнает сразу. */
        var f = E.shiftFix(c);
        h += '<div class="cc-sub">' + (c.diff < 0
          ? 'В ящике меньше, чем должно.'
          : 'В ящике больше, чем должно.') +
          (f.big ? ' Это ' + esc(E.fmtPct(f.share * 100, 0)) + ' от наличных за смену. ' +
            'Чаще всего при таком расхождении неверно вписано одно число — ' +
            'сверьтесь со списком ниже. Если всё верно, недостача настоящая, ' +
            'и разбираться надо с людьми, а не с цифрами.' : '') + '</div>';
        if (f.reason) h += '<div class="cc-sub c-red">' + esc(f.reason) + '</div>';
        if (f.list.length) {
          h += '<div class="cc-fix"><div class="cc-fix-h">Чтобы ящик сошёлся, ' +
            'достаточно исправить одно из чисел:</div>';
          f.list.slice(0, 4).forEach(function (x) {
            h += '<div class="cc-fix-r"><span>' + esc(x.name) + '</span>' +
              '<b><s>' + esc(money(x.now)) + '</s> → ' + esc(money(x.need)) + '</b></div>';
          });
          h += '<div class="cc-fix-n">Если ни одно не подходит — расхождение настоящее, ' +
            'сохраняйте как есть: программа его запомнит и покажет в отчёте.</div></div>';
        }
      }
    }
    if (zb) {
      h += '<div class="cc-line" style="border-top:1px solid var(--separator);padding-top:8px">' +
        '<span>Безнал (в ящик не попадает)</span><b>' + esc(money(zb)) + '</b></div>';
      /* Сверка с отчётом терминала: карта + QR + телефон обязаны дать Z-безнал.
         Не сошлось — либо платёж не долетел до кассы, либо пробили мимо. */
      if (c.wayFilled) {
        h += '<div class="cc-line"><span class="c-muted">карта ' + esc(money(c.card)) +
          ' · QR ' + esc(money(c.qr)) + (c.nfc ? ' · телефон ' + esc(money(c.nfc)) : '') +
          '</span><b class="' + (c.wayOk ? 'c-green' : 'c-red') + '">' +
          esc(money(c.byWay)) + '</b></div>';
        if (!c.wayOk) {
          h += '<div class="cc-sub c-red">Терминал и Z-отчёт разошлись на ' +
            esc(money(Math.abs(c.wayDiff))) + '. ' +
            (c.wayDiff > 0 ? 'По терминалу прошло больше, чем пробито на кассе.'
              : 'На кассе пробито больше, чем прошло по терминалу.') +
            ' Это надо разобрать сегодня: завтра концов не найти.</div>';
        }
      }
    }
    /* Выручку показываем ВСЕГДА, а не только когда заполнен безнал: у наличной
       кассы безнала нет вовсе, и владелец не увидел бы, сколько наторговал. */
    if (!пусто) {
      h += '<div class="cc-sub">Выручка за смену: <b>' + esc(money(c.revenue)) + '</b>' +
        (c.returns ? ' (возвраты ' + esc(money(c.returns)) + ' уже вычтены)' : '') +
        (c.avgCheck ? ' · средний чек ' + esc(money(c.avgCheck)) : '') + '</div>';
    }

    /* Наличные смены обязаны лечь в денежный ящик той кассы, что выбрана
       выше. Если выбран сейф, остаток ящика навсегда останется нулевым,
       а сверка — бессмысленной. Молчать об этом нельзя. */
    var acc = accounts().filter(function (a) { return a.id === E.txt(v.account); })[0];
    if (acc && acc.kind !== 'till') {
      h += '<div class="cc-sub" style="color:var(--orange)">⚠ Наличные вы отправляете ' +
        'на счёт «' + esc(acc.name) + '», а это не денежный ящик. Тогда в ящике так и ' +
        'останется ноль, и сверять будет нечего. Обычно здесь ставят кассу.</div>';
    }
    return h + '</div>';
  }

  /* Пересчёт на каждое нажатие. Форму не перерисовываем — набранное пропало бы. */
  (function () {
    /* Следим за ВСЕМИ полями, из которых считается ящик. Забудешь здесь одно —
       владелец введёт его, а расчёт над кнопкой не шелохнётся, и будет
       казаться, что программа его не услышала. */
    var WATCH = ['openCash', 'zCash', 'zCashless', 'payouts', 'factCash', 'account', 'till',
      'returnsCash', 'returnsCashless', 'deposits', 'collected',
      'zCard', 'zQr', 'zNfc', 'checks'];
    function tick(el) {
      if (!el || !el.name || WATCH.indexOf(el.name) < 0 || !el.closest) return;
      var box = el.closest('.sheet');
      if (!box) return;
      var slot = box.querySelector('#shiftSum');
      if (!slot) return;
      var v = {};
      WATCH.forEach(function (k) {
        var f = box.querySelector('[name="' + k + '"]');
        if (f) v[k] = f.value;
      });
      slot.innerHTML = shiftSumBox(v);
    }
    function later(el) { setTimeout(function () { tick(el); }, 0); }
    document.addEventListener('input', function (e) { later(e.target); });
    document.addEventListener('change', function (e) { later(e.target); });
  })();

  FORMS.shiftClose = {
    title: 'Сверка кассы за смену', icon: 'calculator',
    editsInPlace: true,   // правит запись сама — удалять старую нельзя
    body: function (v) {
      var u = U(); v = v || {};
      var till = v.till || tills()[0];
      var prev = lastFact(till);
      var что = 'мелкие деньги, лежавшие в ящике ДО открытия смены — чтобы было ' +
        'чем давать сдачу. Это не выручка. Донесли деньги среди смены — это не ' +
        'размен, а «Внесения в кассу» ниже';
      var openHint = prev
        ? что + '. Прошлая смена (' + dateRu(prev.date) + ') закрылась с ' +
          money(prev.fact) + ' — столько и должно было остаться в ящике'
        : что + '. Это первая смена по этой кассе. Всё увозят инкассацией и ящик ' +
          'закрывается в ноль? Тогда здесь ноль';
      return u.fieldRow('Дата смены', 'date', 'date', v.date || today()) +
        u.fieldRow('Касса', 'till', 'select', till, { options: tills() }) +
        u.fieldRow('Смена', 'shift', 'select', v.shift || shiftNames()[0], { options: shiftNames() }) +
        u.fieldRow('Кассир', 'cashier', 'list', v.cashier || '',
          { options: cashiers(), placeholder: 'кто сдаёт смену' }) +
        u.fieldRow('Размен на начало', 'openCash', 'number',
          v.openCash != null ? v.openCash : (prev ? prev.fact : 0), { hint: openHint }) +
        u.fieldRow('Z-отчёт: наличные', 'zCash', 'number', v.zCash || '',
          { hint: 'из Z-отчёта: строка «НАЛИЧНЫМИ» под «ЧЕКОВ ПРИХОДА». ' +
            'Это приход ДО вычета возвратов, а НЕ строка «ВЫРУЧКА» — возвраты ' +
            'вычтет сама программа. Аппаратов на кассе два и ящик общий? ' +
            'Пишите через плюс: 50000+3000' }) +
        u.fieldRow('Наличные лягут на счёт', 'account', 'select',
          v.account || accDefault(false), { options: accOptions(['till', 'cash']),
            hint: 'денежный ящик той кассы, что выбрана выше' }) +
        u.fieldRow('Z-отчёт: безнал', 'zCashless', 'number', v.zCashless || '',
          { hint: 'из Z-отчёта: «БЕЗНАЛИЧНЫМИ». Карта, СБП, эквайринг — купюрами ' +
            'их не бывает, в ящик они не попадают' }) +
        u.fieldRow('Безнал ляжет на счёт', 'cashlessAccount', 'select',
          v.cashlessAccount || accDefault(true), { options: accOptions(['bank']),
            hint: 'расчётный счёт или карта, куда банк зачисляет' }) +
        /* Разбивка безнала по способам. Нужна не для красоты: комиссия банка
           за карту и за СБП разная, а сверить Z-отчёт с отчётом терминала
           иначе нечем — терминал печатает именно эти три строки. */
        u.fieldRow('Из них картой', 'zCard', 'number', v.zCard || '',
          { hint: 'из отчёта терминала: «ОПЛАТА» / «КАРТА»' }) +
        u.fieldRow('Из них по QR (СБП)', 'zQr', 'number', v.zQr || '',
          { hint: 'из отчёта терминала: «ОПЛАТА ПО QR». Комиссия по СБП ниже, чем по карте' }) +
        u.fieldRow('Из них телефоном', 'zNfc', 'number', v.zNfc || '',
          { hint: 'из отчёта терминала: «BLUETOOTH» или «БИО». Не вводили — оставьте пусто' }) +
        u.fieldRow('Возвраты покупателям, наличными', 'returnsCash', 'number', v.returnsCash || 0,
          { hint: 'из Z-отчёта: «ЧЕКОВ ВОЗВРАТОВ ПРИХОДА». Их отдали из ящика, и выручкой они не были' }) +
        u.fieldRow('Возвраты покупателям, на карту', 'returnsCashless', 'number', v.returnsCashless || 0,
          { hint: 'если возврат ушёл обратно на карту — ящик он не трогает' }) +
        u.fieldRow('Внесения в кассу', 'deposits', 'number', v.deposits || 0,
          { hint: 'из Z-отчёта: «ВНЕСЕНИЙ». Довезли размен среди смены — эти деньги в ящике есть, а выручкой не являются' }) +
        u.fieldRow('Выплаты из ящика', 'payouts', 'number', v.payouts || 0,
          { hint: 'из Z-отчёта: «ВЫПЛАТ». Что брали из кассы за смену: поставщикам, на хознужды' }) +
        u.fieldRow('Инкассация', 'collected', 'number', v.collected || 0,
          { hint: 'сколько денег РЕАЛЬНО увезли из ящика в сейф — пересчитанных ' +
            'купюрами. На чеке есть строка «ИНКАССАЦИЯ», но если в сейф доехало ' +
            'меньше, пишите пересчитанное: разница и есть недостача. ' +
            'Несколько аппаратов на кассе — складывайте: 50000+3000. ' +
            'Перевод в сейф программа запишет сама — второй раз вводить не надо' }) +
        u.fieldRow('Инкассацию положить на счёт', 'collectAccount', 'select',
          v.collectAccount || accDefault(false), { options: accOptions(['cash', 'bank']),
            hint: 'куда увезли: сейф или банк' }) +
        u.fieldRow('Факт в ящике', 'factCash', 'number', v.factCash || '',
          { hint: 'сколько ОСТАЛОСЬ в ящике после инкассации и выплат — обычно ' +
            'размен на следующую смену, часто ноль. Деньги, увезённые в сейф, ' +
            'сюда не входят: они в «Инкассации»' }) +
        /* unit: 'plain' обязателен — иначе программа подпишет число чеков
           рублями: «391 ₽». Чеки не деньги, и такая подпись сбивает с толку. */
        u.fieldRow('Чеков за смену', 'checks', 'number', v.checks || '',
          { unit: 'plain', hint: 'из Z-отчёта — для среднего чека, на кассу не влияет' }) +
        u.fieldRow('Аннулированных чеков', 'voided', 'number', v.voided || '',
          { unit: 'plain',
            hint: 'из Z-отчёта. На деньги не влияет, но много аннулирований — повод спросить кассира' }) +
        u.fieldRow('Комментарий', 'note', 'text', v.note || '') +
        '<div id="shiftSum">' + shiftSumBox(v) + '</div>';
    },
    hint: 'Должно быть в ящике = размен + наличная выручка − возвраты + внесения ' +
      '− выплаты − инкассация. Расхождение = факт − это число. Безнал в формуле ' +
      'не участвует: карта и СБП в ящик не попадают. ' +
      'Заполняйте прямо по Z-отчёту сверху вниз — строки названы так же, как на чеке.',
    save: function (v) {
      var badDate = Q.checkDate(v.date);
      if (badDate) return badDate;
      var bad = Q.checkAmount(v.zCash, { allowZero: true });
      if (bad) return 'Z-отчёт наличные: ' + bad;
      if (!E.txt(v.factCash) && v.factCash !== 0) return 'Впишите, сколько денег пересчитали в ящике.';
      if (!E.txt(v.cashier)) return 'Укажите кассира — иначе непонятно, с кем разбирать расхождение.';
      var fields = ['openCash', 'zCash', 'zCashless', 'payouts', 'factCash',
        'zCard', 'zQr', 'zNfc', 'returnsCash', 'returnsCashless', 'deposits', 'collected'];
      for (var i = 0; i < fields.length; i++) {
        var b = Q.checkAmount(v[fields[i]], { allowEmpty: true, allowZero: true });
        if (b) return 'Поле «' + fields[i] + '»: ' + b;
      }
      learn({ cashiers: v.cashier });
      var edS = U().editing();
      var rec = { type: E.T_SHIFT, date: v.date, till: v.till, shift: v.shift,
        cashier: v.cashier, openCash: num(v.openCash), zCash: num(v.zCash),
        zCashless: num(v.zCashless), payouts: num(v.payouts),
        zCard: num(v.zCard), zQr: num(v.zQr), zNfc: num(v.zNfc),
        returnsCash: num(v.returnsCash), returnsCashless: num(v.returnsCashless),
        deposits: num(v.deposits), collected: num(v.collected),
        collectAccount: E.txt(v.collectAccount),
        factCash: num(v.factCash), checks: num(v.checks), voided: num(v.voided),
        account: E.txt(v.account), cashlessAccount: E.txt(v.cashlessAccount),
        note: v.note };
      var c = E.shiftCalc(rec);
      rec.diff = c.diff;
      var saved;
      if (edS) { S.update(edS.coll, edS.id, rec); saved = edS.id; }
      else { saved = (S.add('dds', rec) || {}).id; }

      /* Инкассация из Z-отчёта сама становится переводом в сейф: иначе деньги
         из ящика ушли бы в никуда — по кассе их нет, а в сейфе не появились.
         Перевод помечен номером смены, поэтому при повторном сохранении он
         обновляется, а не заводится второй раз. */
      syncCollect(saved, rec);
      S.save(); refresh();

      var msg = 'Смена записана. Расчётный остаток ' + money(c.expected) + ', в ящике ' +
        money(c.factCash) + ' — ';
      msg += c.ok ? 'касса сходится.'
        : (c.diff < 0 ? 'НЕДОСТАЧА ' + money(c.short) + '.' : 'излишек ' + money(c.over) + '.');
      /* Смену мы сохраняем в любом случае — учёт не место для запретов. Но если
         расхождение размером с выручку, молчать нельзя: почти наверняка одно
         число вписано неверно, и в отчётах это разъедется на весь месяц. */
      var fx = E.shiftFix(c);
      if (fx.big) {
        var сам = fx.list[0];
        msg += ' Это ' + E.fmtPct(fx.share * 100, 0) + ' от наличных за смену — проверьте числа: ' +
          (fx.reason ? fx.reason.replace(/^Похоже, /, 'похоже, ')
            : сам ? 'например, «' + сам.name + '» вместо ' + money(сам.now) +
              ' должно быть ' + money(сам.need) + '.'
              : 'что-то введено неверно.');
      }
      // размен новой смены должен равняться факту предыдущей — иначе деньги
      // вынули, и это надо записать, иначе учёт разъедется
      var prev = lastFact(v.till);
      msg += ' Безнал ' + money(c.zCashless) + ' ушёл на счёт, в кассу не считается.';
      return { ok: msg };
    }
  };

  /* Перевод-инкассация, привязанный к смене. Один на смену: заново сохранили
     смену — он обновился; стёрли сумму — он ушёл; смены нет — и его нет. */
  function syncCollect(shiftId, rec) {
    if (!shiftId) return;
    var было = dds().filter(function (r) { return E.txt(r.fromShift) === E.txt(shiftId); })[0];
    var сумма = num(rec.collected);
    if (!сумма) {
      if (было) S.remove('dds', было.id);
      return;
    }
    var куда = E.txt(rec.collectAccount) || accDefault(false);
    var перевод = {
      type: E.T_MOVE, date: rec.date, amount: сумма,
      account: E.txt(rec.account), toAccount: куда,
      category: 'Инкассация', fromShift: E.txt(shiftId),
      note: 'Инкассация из смены ' + (rec.till || '') + ' ' + (rec.shift || '')
    };
    if (было) S.update('dds', было.id, перевод); else S.add('dds', перевод);
  }

  /* --- Вечер: итоги дня ------------------------------------------------------
     Кассу эта форма НЕ двигает: деньги за товар уже ушли через «выплаты из
     ящика» в сверке смены. Здесь — товарные обороты и долг поставщикам. */
  FORMS.dayTotals = {
    title: 'Итоги дня', icon: 'moon',
    editsInPlace: true,   // правит запись сама — удалять старую нельзя
    body: function (v) {
      var u = U(); v = v || {};
      return u.fieldRow('Дата', 'date', 'date', v.date || today()) +
        u.fieldRow('Товар за наличные', 'goodsCash', 'number', v.goodsCash || 0,
          { hint: 'сколько товара взяли и сразу заплатили' }) +
        u.fieldRow('Погашение долгов ТП', 'debtPaid', 'number', v.debtPaid || 0,
          { hint: 'сколько отдали поставщикам по старым долгам' }) +
        u.fieldRow('Взят новый товар в долг', 'debtTaken', 'number', v.debtTaken || 0,
          { hint: 'привезли, деньги не платили — долг вырос' }) +
        u.fieldRow('Откуда платили', 'source', 'select', v.source || 'Из ящика',
          { options: E.MONEY_SOURCES,
            hint: 'обычно из ящика — тогда сумма должна попасть в «выплаты» смены' }) +
        u.fieldRow('Комментарий', 'note', 'text', v.note || '');
    },
    hint: 'Эта форма про товар и долги, а не про кассу: деньги за товар уже ушли ' +
      'из ящика и посчитаны в «Выплатах» при сверке смены. Если вычесть их ещё раз, ' +
      'одни и те же деньги уйдут дважды.',
    save: function (v) {
      var badDay = Q.checkDate(v.date);
      if (badDay) return badDay;
      var f = ['goodsCash', 'debtPaid', 'debtTaken'];
      for (var i = 0; i < f.length; i++) {
        var b = Q.checkAmount(v[f[i]], { allowEmpty: true, allowZero: true });
        if (b) return 'Поле «' + f[i] + '»: ' + b;
      }
      if (!num(v.goodsCash) && !num(v.debtPaid) && !num(v.debtTaken)) {
        return 'Все три поля пустые — записывать нечего.';
      }
      /* Защита от двойных итогов за один день. Саму правку она блокировать
         не должна: когда исправляют уже записанный день, «одинаковая» запись —
         это он сам. Раньше из-за этого итоги дня нельзя было исправить вовсе. */
      var ed = U().editing();
      var same = dds().filter(function (r) {
        return E.isDay(r) && r.date === v.date && (!ed || r.id !== ed.id);
      })[0];
      if (same) return 'Итоги за ' + dateRu(v.date) + ' уже записаны. ' +
        'Поправьте ту запись на экране «База операций», чтобы не задвоить.';
      var rec = { type: E.T_DAY, date: v.date, goodsCash: num(v.goodsCash),
        debtPaid: num(v.debtPaid), debtTaken: num(v.debtTaken),
        source: E.txt(v.source) || 'Из ящика', note: v.note };
      if (ed) S.update(ed.coll, ed.id, rec); else S.add('dds', rec);
      S.save(); refresh();
      var d = E.supplierDebt(dds(), S.settings);
      return { ok: 'Итоги дня записаны. Долг поставщикам теперь ' + money(d.debt) + '.' };
    }
  };

  /* --- Расход и приход денег -------------------------------------------------- */
  /* --- Расход ----------------------------------------------------------------
     Две вещи, из-за которых расход раньше врал:
       1) наличные вычитались из ящика второй раз, если эти же деньги уже
          прошли выплатой при сверке смены;
       2) статьи «Закуп товара» и «Оплата ТП» резали прибыль, хотя закуп
          считается из итогов дня, а погашение долга — вообще не трата.
     Теперь форма спрашивает, ОТКУДА взяли деньги, и не принимает статьи,
     которые тратой не являются. */
  FORMS.moneyOut = {
    title: 'Расход', icon: 'receipt',
    editsInPlace: true,   // правит запись сама — удалять старую нельзя
    body: function (v) {
      var u = U(); v = v || {};
      var cash = E.norm(v.method || 'Наличные') === 'наличные';
      return u.fieldRow('Дата', 'date', 'date', v.date || today()) +
        u.fieldRow('Статья', 'category', 'list', v.category || '',
          { options: categories(), placeholder: 'за что платим',
            hint: 'подстатья пишется через косую черту: «Коммунальные / Свет». ' +
              'Закуп товара и долги поставщикам сюда не пишут — им место в «Итогах дня»' }) +
        u.fieldRow('Чем платим', 'method', 'select', v.method || 'Наличные', { options: methods() }) +
        u.fieldRow('С какого счёта', 'account', 'select',
          v.account || accForCategory(v.category, !cash), { options: accOptions(),
            hint: 'подставлен тот, с которого платили по этой статье в прошлый раз; ' +
              'из денежного ящика деньги уже посчитаны в «выплатах» смены — ' +
              'второй раз их не вычтут' }) +
        u.fieldRow('Сумма', 'amount', 'number', v.amount || '') +
        (funds().length ? u.fieldRow('Из какого конверта', 'fund', 'select',
          v.fund || fundForCategory(v.category), { options: fundOptions(true),
            hint: 'если на это откладывали — отметьте, иначе конверт так и будет расти' }) : '') +
        u.fieldRow('Комментарий', 'note', 'text', v.note || '');
    },
    hint: 'Расход уменьшает прибыль. Остаток наличных он уменьшает, только если ' +
      'деньги взяли не из ящика: то, что вынули из ящика, уже сидит в «выплатах» смены.',
    save: function (v) {
      var badD = Q.checkDate(v.date); if (badD) return badD;
      var bad = Q.checkAmount(v.amount); if (bad) return bad;
      if (!E.txt(v.category)) return 'Укажите статью — иначе непонятно, за что ушли деньги.';
      // Ловим статью, которая тратой не является: иначе прибыль занизится
      var not = E.notACost(v.category);
      if (not) {
        if (not.key === 'purchase') {
          return 'Закуп товара расходом не записывают: впишите сумму в «Итоги дня» → ' +
            '«Товар за наличные». Иначе один и тот же товар уменьшит прибыль дважды.';
        }
        if (not.key === 'debt') {
          return 'Погашение долга поставщику — не расход, а возврат денег. ' +
            'Впишите сумму в «Итоги дня» → «Погашение долгов ТП».';
        }
        return 'Перемещение денег расходом не записывают — прибыль от этого не меняется. ' +
          'Для инкассации есть своя кнопка «Инкассация».';
      }
      learn({ categories: v.category, methods: v.method });
      var rec = { type: E.T_OUT, date: v.date, category: v.category,
        method: v.method, account: E.txt(v.account), amount: num(v.amount),
        fund: E.txt(v.fund), note: v.note };
      var ed = U().editing();
      if (ed) S.update(ed.coll, ed.id, rec); else S.add('dds', rec);
      S.save(); refresh();
      var acc = E.accountOf(rec, accounts());
      return { ok: 'Расход записан: ' + E.catLabel(v.category) + ' — ' + money(v.amount) +
        (acc && acc.kind === 'till'
          ? '. Ящик не трогаем: эти деньги уже в «выплатах» смены.'
          : acc ? '. Списано со счёта «' + acc.name + '».' : '.') };
    }
  };

  /* --- Инкассация: перемещение денег, а не трата ------------------------------
     Увезли выручку в сейф или в банк — деньги не потрачены, они лежат в другом
     месте. Касса уменьшается, прибыль НЕ меняется. Раньше это можно было
     записать только расходом, и месяц закрывался с ложным убытком. */
  FORMS.moneyIn = {
    title: 'Приход денег', icon: 'banknote',
    body: function (v) {
      var u = U(); v = v || {};
      return u.fieldRow('Дата', 'date', 'date', v.date || today()) +
        u.fieldRow('Откуда', 'category', 'list', v.category || 'Прочий приход',
          { options: categories().concat(['Прочий приход', 'Вернули долг', 'Внёс владелец']) }) +
        u.fieldRow('Чем', 'method', 'select', v.method || 'Наличные', { options: methods() }) +
        u.fieldRow('На какой счёт', 'account', 'select', v.account || accDefault(false),
          { options: accOptions(),
            hint: 'в денежный ящик — кассир пересчитает их вместе со сменой' }) +
        u.fieldRow('Сумма', 'amount', 'number', v.amount || '') +
        u.fieldRow('Комментарий', 'note', 'text', v.note || '');
    },
    hint: 'Выручку сюда писать не нужно — она приходит из сверки смены. Наличные, ' +
      'положенные в ящик, остаток не увеличивают: их пересчитают при закрытии смены, ' +
      'и они попадут в факт. Иначе те же деньги посчитались бы дважды.',
    save: function (v) {
      var bad = Q.checkAmount(v.amount); if (bad) return bad;
      learn({ categories: v.category, methods: v.method });
      S.add('dds', { type: E.T_IN, date: v.date, category: v.category || 'Прочий приход',
        method: v.method, account: E.txt(v.account), amount: num(v.amount), note: v.note });
      S.save(); refresh();
      return { ok: 'Приход записан: ' + money(v.amount) +
        (accName(v.account) ? ' на счёт «' + accName(v.account) + '».' : '.') };
    }
  };

  FORMS.moneyDraw = {
    title: 'Забрал владелец', icon: 'wallet',
    body: function (v) {
      var u = U(); v = v || {};
      return u.fieldRow('Дата', 'date', 'date', v.date || today()) +
        u.fieldRow('Чем', 'method', 'select', v.method || 'Наличные', { options: methods() }) +
        u.fieldRow('С какого счёта', 'account', 'select', v.account || accDefault(false),
          { options: accOptions(),
            hint: 'сейф, расчётный счёт или касса — откуда деньги взяли на самом деле' }) +
        u.fieldRow('Сумма', 'amount', 'number', v.amount || '') +
        u.fieldRow('Комментарий', 'note', 'text', v.note || '');
    },
    editsInPlace: true,
    hint: 'Деньги ушли из оборота, но это не расход магазина: прибыль они не уменьшают. ' +
      'Владелец берёт уже из заработанного, поэтому в отчёте о прибыли забор стоит ' +
      'отдельной строкой, а не в затратах.',
    save: function (v) {
      var badD = Q.checkDate(v.date); if (badD) return badD;
      var bad = Q.checkAmount(v.amount); if (bad) return bad;
      if (!E.txt(v.account)) return 'Выберите, с какого счёта взяли деньги.';
      var rec = { type: E.T_DRAW, date: v.date, category: 'Забор владельца',
        method: v.method, account: E.txt(v.account), amount: num(v.amount), note: v.note };
      var ed = U().editing();
      if (ed) S.update(ed.coll, ed.id, rec); else S.add('dds', rec);
      S.save(); refresh();
      var acc = E.accountOf(rec, accounts());
      var bal = E.accountBalances(dds(), accounts()).rows
        .filter(function (x) { return acc && x.id === acc.id; })[0];
      return { ok: 'Записано: владелец взял ' + money(v.amount) +
        (acc ? ' со счёта «' + acc.name + '»' : '') + '.' +
        (bal ? ' Там осталось ' + money(bal.balance) + '.' : '') +
        (acc && acc.kind === 'till'
          ? ' Проверьте, что кассир записал эти деньги в «выплаты из ящика».' : '') };
    }
  };

  FORMS.moveCash = {
    title: 'Перевод между счетами', icon: 'truck',
    editsInPlace: true,
    body: function (v) {
      var u = U(); v = v || {};
      var bal = E.accountBalances(dds(), accounts());
      function label(a) {
        var b = bal.rows.filter(function (x) { return x.id === a.value; })[0];
        return { value: a.value, text: a.text + (b ? ' — ' + money(b.balance) : '') };
      }
      var opts = accOptions().map(label);
      return u.fieldRow('Дата', 'date', 'date', v.date || today()) +
        u.fieldRow('Откуда', 'account', 'select', v.account || accDefault(false),
          { options: opts }) +
        u.fieldRow('Куда', 'toAccount', 'select', v.toAccount || accDefault(true),
          { options: opts }) +
        u.fieldRow('Сумма', 'amount', 'number', v.amount || '') +
        u.fieldRow('Кто повёз', 'cashier', 'list', v.cashier || '',
          { options: cashiers(), placeholder: 'необязательно' }) +
        (funds().length ? u.fieldRow('Откладываем в конверт', 'fund', 'select', v.fund || '',
          { options: fundOptions(true),
            hint: 'на аренду, зарплату, налоги — чтобы эти деньги было видно отдельно' }) : '') +
        u.fieldRow('Комментарий', 'note', 'text', v.note || '');
    },
    hint: 'Инкассация в сейф, перевод со счёта на счёт, размен обратно в кассу — всё это ' +
      'перевод. Деньги переложили, а не потратили: прибыль от перевода не меняется ни на рубль. ' +
      'Из денежного ящика они уходят через «выплаты» той смены, где их вынули, поэтому ' +
      'остаток ящика здесь второй раз не уменьшается.',
    save: function (v) {
      var badD = Q.checkDate(v.date); if (badD) return badD;
      var bad = Q.checkAmount(v.amount); if (bad) return bad;
      if (!E.txt(v.account) || !E.txt(v.toAccount)) return 'Выберите, откуда и куда.';
      if (E.txt(v.account) === E.txt(v.toAccount)) return 'Откуда и куда — один и тот же счёт.';
      var bal = E.accountBalances(dds(), accounts());
      var from = bal.rows.filter(function (x) { return x.id === E.txt(v.account); })[0];
      // Ящик не проверяем: смену могли ещё не закрыть, и остаток там временный
      if (from && from.kind !== 'till' && num(v.amount) > from.balance + 0.5) {
        return 'На счёте «' + from.name + '» сейчас ' + money(from.balance) +
          ' — перевести ' + money(v.amount) + ' не получится.';
      }
      var rec = { type: E.T_MOVE, date: v.date, account: E.txt(v.account),
        toAccount: E.txt(v.toAccount), amount: num(v.amount),
        cashier: E.txt(v.cashier), fund: E.txt(v.fund), note: E.txt(v.note) };
      var ed = U().editing();
      if (ed) S.update(ed.coll, ed.id, rec); else S.add('dds', rec);
      S.save(); refresh();
      var msg = 'Перевод записан: ' + money(v.amount) + ' с «' + accName(v.account) +
        '» на «' + accName(v.toAccount) + '». Прибыль не изменилась — деньги переложили.';
      if (from && from.kind === 'till') {
        msg += ' Проверьте, что эти ' + money(v.amount) +
          ' кассир записал в «выплаты из ящика» за смену.';
      }
      return { ok: msg };
    }
  };

  /* --- План выплат ------------------------------------------------------------ */
  /* --------------------------------------------------------------------------
     ПОВТОРЯЮЩИЕСЯ ВЫПЛАТЫ

     Аренда, интернет, вывоз мусора, охрана — суммы одни и те же из месяца
     в месяц, и каждый месяц их вбивали руками. Теперь достаточно поставить
     «повторять»: как только выплату отметили оплаченной, следующая встаёт
     в план сама, той же суммой и на то же число.

     Важно: следующая создаётся ТОЛЬКО в момент оплаты, а не заранее пачкой
     на год вперёд. Иначе план выплат превратился бы в свалку из ста будущих
     строк, а просрочка — во враньё.
     -------------------------------------------------------------------------- */
  var REPEATS = ['не повторять', 'каждый месяц', 'раз в квартал', 'раз в год'];

  /* Что обычно платят по календарю. Не только поставщикам: аренда, коммуналка
     и налоги приходят так же по расписанию, и планировать их надо там же.
     «Выплата ТП» — общей суммой, когда развозчиков много и расписывать
     каждого по отдельности незачем. */
  function planKinds() {
    var базовые = ['Выплата ТП', 'Аренда', 'Коммунальные', 'Интернет и связь',
      'Охрана', 'Вывоз мусора', 'Налоги', 'Зарплата', 'Прочее'];
    var свои = categories();
    var было = {}, out = [];
    базовые.concat(свои).forEach(function (x) {
      var k = E.norm(x);
      if (!k || было[k]) return;
      было[k] = 1; out.push(x);
    });
    return out;
  }

  // Следующая дата с тем же числом месяца. 31 января + месяц = 28 февраля:
  // прыгать на 3 марта нельзя, платёж привязан к концу месяца.
  function nextDue(date, repeat) {
    var p = E.txt(date).split('-');
    if (p.length !== 3) return '';
    var y = +p[0], m = +p[1] - 1, d = +p[2];
    if (repeat === 'каждый месяц') m += 1;
    else if (repeat === 'раз в квартал') m += 3;
    else if (repeat === 'раз в год') y += 1;
    else return '';
    y += Math.floor(m / 12); m = ((m % 12) + 12) % 12;
    var last = new Date(y, m + 1, 0).getDate();
    var dd = Math.min(d, last);
    return y + '-' + String(m + 1).padStart(2, '0') + '-' + String(dd).padStart(2, '0');
  }

  /* Завести следующую выплату по повторяющейся. Возвращает строку для
     владельца или пустоту, если повторять не просили. */
  function makeNext(plan) {
    if (!plan || !E.txt(plan.repeat)) return '';
    var due = nextDue(plan.due, E.txt(plan.repeat));
    if (!due) return '';
    // Не заводим дважды: вдруг отметили оплаченной, передумали и отметили снова
    var same = (S.state.plans || []).filter(function (x) {
      return x.due === due && E.norm(x.supplier) === E.norm(plan.supplier) &&
        E.txt(x.status) !== 'Отменена';
    })[0];
    if (same) return '';
    S.add('plans', { due: due, supplier: plan.supplier, amount: num(plan.amount),
      method: plan.method, status: E.PLAN_STATUS[0], note: plan.note,
      repeat: E.txt(plan.repeat) });
    return ' Следующая — ' + dateRu(due) + ', уже в плане.';
  }

  FORMS.payPlan = {
    title: 'Выплата поставщику', icon: 'calendar',
    editsInPlace: true,
    body: function (v) {
      var u = U(); v = v || {};
      return u.fieldRow('Дата выплаты', 'due', 'date', v.due || today()) +
        u.fieldRow('Что платим', 'category', 'list', v.category || '',
          { options: planKinds(),
            placeholder: 'выплата ТП, аренда, коммуналка, налоги…',
            hint: 'можно выбрать из списка или вписать своё' }) +
        u.fieldRow('Кому', 'supplier', 'list', v.supplier || '',
          { options: suppliers(),
            placeholder: 'поставщик, ТП, арендодатель — или оставьте пустым',
            hint: 'для общей выплаты ТП можно не указывать' }) +
        u.fieldRow('Сумма', 'amount', 'number', v.amount || '') +
        u.fieldRow('Чем платим', 'method', 'select', v.method || 'Наличные', { options: methods() }) +
        u.fieldRow('Статус', 'status', 'select', v.status || E.PLAN_STATUS[0],
          { options: E.PLAN_STATUS }) +
        u.fieldRow('Повторять', 'repeat', 'select', v.repeat || 'не повторять',
          { options: REPEATS,
            hint: 'аренда, интернет, охрана — суммы одни и те же каждый месяц' }) +
        u.fieldRow('Комментарий', 'note', 'text', v.note || '');
    },
    hint: 'Это календарь: кому и когда платить. Долг поставщикам отметка «Оплачена» ' +
      'сама не уменьшает — сумму погашения впишите в «Итоги дня», иначе она посчитается дважды. ' +
      'Поставили «повторять» — следующая выплата встанет в план сама, как только отметите эту оплаченной.',
    save: function (v) {
      var bad = Q.checkAmount(v.amount); if (bad) return bad;
      /* План — это календарь на будущее, поэтому дату вперёд разрешаем
         широко. Проверяем только очевидную опечатку в годе. */
      var badD2 = Q.checkDate(v.due, { aheadDays: 400 }); if (badD2) return badD2;
      /* Раньше требовали поставщика — и запланировать аренду или коммуналку
         было нельзя вовсе. Теперь достаточно любого из двух: «что платим»
         или «кому». Общая выплата ТП — это «Выплата ТП» без имени. */
      if (!E.txt(v.supplier) && !E.txt(v.category)) {
        return 'Напишите, что платим или кому — иначе в плане будет пустая строка.';
      }
      learn({ suppliers: v.supplier, methods: v.method, categories: v.category });
      var rec = { due: v.due, supplier: v.supplier, category: E.txt(v.category),
        amount: num(v.amount),
        method: v.method, status: v.status, note: v.note,
        repeat: E.txt(v.repeat) === REPEATS[0] ? '' : E.txt(v.repeat),
        paidAt: v.status === 'Оплачена' ? (v.paidAt || today()) : '' };
      var edit = U().editing && U().editing();
      if (edit && edit.coll === 'plans') {
        var old = (S.state.plans || []).filter(function (p) { return p.id === edit.id; })[0];
        if (old) { Object.keys(rec).forEach(function (k) { old[k] = rec[k]; }); S.save(); refresh();
          return { ok: 'Выплата обновлена.' }; }
      }
      S.add('plans', rec);
      S.save(); refresh();
      return { ok: 'В плане: ' + (E.txt(v.supplier) || E.txt(v.category)) +
        ' — ' + money(v.amount) + ' на ' + dateRu(v.due) };
    }
  };

  /* --- Долг покупателя --------------------------------------------------------- */
  FORMS.debtor = {
    title: 'Долг покупателя', icon: 'notebook',
    editsInPlace: true,
    body: function (v) {
      var u = U(); v = v || {};
      return u.fieldRow('Дата', 'date', 'date', v.date || today()) +
        u.fieldRow('Кто', 'name', 'text', v.name || '', { placeholder: 'имя из тетрадки' }) +
        u.fieldRow('Телефон', 'phone', 'text', v.phone || '') +
        u.fieldRow('Сумма долга', 'sum', 'number', v.sum || '') +
        u.fieldRow('Уже погашено', 'paid', 'number', v.paid || 0) +
        u.fieldRow('Кто записал', 'cashier', 'list', v.cashier || '', { options: cashiers() }) +
        u.fieldRow('Комментарий', 'note', 'text', v.note || '');
    },
    hint: 'Пока долг не погашен, выручкой он не считается.',
    save: function (v) {
      var bad = Q.checkAmount(v.sum); if (bad) return bad;
      if (!E.txt(v.name)) return 'Впишите, кто должен.';
      learn({ cashiers: v.cashier });
      var rec = { date: v.date, name: v.name, phone: v.phone, sum: num(v.sum),
        paid: num(v.paid), cashier: v.cashier, note: v.note };
      var edit = U().editing && U().editing();
      if (edit && edit.coll === 'debtors') {
        var old = (S.state.debtors || []).filter(function (d) { return d.id === edit.id; })[0];
        if (old) { Object.keys(rec).forEach(function (k) { old[k] = rec[k]; }); S.save(); refresh();
          return { ok: 'Долг обновлён.' }; }
      }
      S.add('debtors', rec);
      S.save(); refresh();
      return { ok: 'Записано: ' + v.name + ' должен ' + money(num(v.sum) - num(v.paid)) };
    }
  };

  /* --- Пересчёт кассы по купюрам ----------------------------------------------- */
  /* --------------------------------------------------------------------------
     ПЕРЕСЧИТАТЬ КАССУ

     Владелец (или старший смены) открывает ящик и считает купюры: сколько
     пятитысячных, сколько тысячных и так далее. Программа складывает их сама
     и сравнивает с тем, сколько в этой кассе должно быть по последней смене.

     Зачем это нужно, если есть сверка смены: сверка говорит, сколько ДОЛЖНО
     быть, а пересчёт — сколько есть НА САМОМ ДЕЛЕ, по купюрам. Совпало —
     касса в порядке. Не совпало — видно сразу, а не через неделю в отчёте.

     Пересчёт ничего не меняет в деньгах: он только фиксирует, что насчитали.
     Остаток ящика по-прежнему правит сверка смены и только она.
     -------------------------------------------------------------------------- */

  // Сколько должно быть в этой кассе по последней закрытой смене
  function tillExpected(till) {
    var st = E.tillState(dds(), S.settings).filter(function (t) {
      return E.norm(t.till) === E.norm(till);
    })[0];
    return st ? st.fact : 0;
  }

  /* Живой итог под купюрами. Считается на каждое нажатие: владелец видит сумму
     СРАЗУ, а не после сохранения — иначе непонятно, зачем вообще всё это
     вводить и когда остановиться. */
  function cashCountSum(box) {
    var total = 0, pieces = 0;
    E.NOMINALS.forEach(function (n) {
      var el = box.querySelector('[name="n' + n + '"]');
      if (!el) return;
      var k = Math.max(0, Math.round(num(window.WMNum.calc(el.value))));
      var sum = k * n;
      total += sum; pieces += k;
      var hint = box.querySelector('[data-hint-for="n' + n + '"]');
      if (hint) {
        hint.innerHTML = k
          ? E.fmtNum(k) + ' шт × ' + esc(money(n)) + ' = <b>' + esc(money(sum)) + '</b>'
          : '';
      }
    });
    return { total: E.safeRound(total), pieces: pieces };
  }

  function cashCountBox(total, pieces, till) {
    var exp = tillExpected(till);
    var diff = E.safeRound(total - exp);
    var ok = Math.abs(diff) < 1;
    return '<div class="cc-total">' +
      '<div class="cc-line"><span>Насчитано в ящике</span>' +
      '<b class="cc-big">' + esc(money(total)) + '</b></div>' +
      '<div class="cc-sub">' + E.fmtNum(pieces) + ' ' +
        esc(E.plural(pieces, 'купюра', 'купюры', 'купюр')) + '</div>' +
      (exp
        ? '<div class="cc-line"><span>Должно быть по последней смене</span>' +
          '<b>' + esc(money(exp)) + '</b></div>' +
          '<div class="cc-line cc-diff ' + (ok ? 'ok' : (diff < 0 ? 'bad' : 'warn')) + '">' +
          '<span>' + (ok ? 'Сходится' : (diff < 0 ? 'Не хватает' : 'Больше, чем должно')) +
          '</span><b>' + (ok ? '—' : esc(money(Math.abs(diff)))) + '</b></div>'
        : '<div class="cc-sub">Смен по этой кассе ещё нет — сравнивать не с чем. ' +
          'Пересчёт всё равно запишется.</div>') +
      '</div>';
  }

  FORMS.cashCount = {
    title: 'Пересчитать кассу', icon: 'receipt',
    body: function (v) {
      var u = U(); v = v || {};
      var till = v.till || tills()[0];
      var h = '<div class="form-hint">Откройте ящик и впишите, сколько каких купюр. ' +
        'Складывать в уме не надо — программа посчитает сама и скажет, сходится ли ' +
        'с тем, сколько должно быть по последней смене.</div>';
      h += u.fieldRow('Дата', 'date', 'date', v.date || today()) +
        u.fieldRow('Касса', 'till', 'select', till, { options: tills() }) +
        u.fieldRow('Кассир', 'cashier', 'list', v.cashier || '', { options: cashiers() });
      var total = 0, pieces = 0;
      E.NOMINALS.forEach(function (n) {
        var k = Math.max(0, Math.round(num(v['n' + n])));
        total += k * n; pieces += k;
        h += u.fieldRow(E.fmtNum(n) + ' ₽ — сколько штук', 'n' + n, 'number',
          v['n' + n] || '', { unit: 'plain', placeholder: '0' });
      });
      h += '<div id="ccTotal">' + cashCountBox(E.safeRound(total), pieces, till) + '</div>';
      return h;
    },
    hint: 'Пересчёт ничего не меняет в деньгах — он только записывает, что насчитали ' +
      'по факту. Остаток ящика по-прежнему правит сверка смены и только она.',
    save: function (v) {
      var badD = Q.checkDate(v.date); if (badD) return badD;
      var c = E.countCash(v);
      if (!c.sum) return 'Ни одной купюры не вписано — считать нечего.';
      var expected = tillExpected(v.till);
      var diff = E.safeRound(c.sum - expected);
      S.add('cashcount', { date: v.date, till: v.till, cashier: v.cashier,
        sum: c.sum, expected: expected, diff: diff,
        note: c.pieces + ' ' + E.plural(c.pieces, 'купюра', 'купюры', 'купюр') });
      S.save(); refresh();
      return { ok: 'Насчитали ' + money(c.sum) + ' — ' + c.pieces + ' ' +
        E.plural(c.pieces, 'купюра', 'купюры', 'купюр') + '. ' +
        (!expected ? 'Сравнивать пока не с чем: смен по этой кассе нет.'
          : Math.abs(diff) < 1 ? 'Сходится с тем, сколько должно быть.'
          : diff < 0 ? 'Не хватает ' + money(-diff) + ' — разберитесь, пока помните смену.'
          : 'Больше на ' + money(diff) + ' — возможно, не записали приход.') };
    }
  };

  /* Пересчёт: считаем на каждое нажатие. Форму не перерисовываем — введённое
     пропало бы; обновляем только подписи и итог. */
  (function () {
    function tick(el) {
      if (!el || !el.name || !el.closest) return;
      if (!/^n\d+$/.test(el.name) && el.name !== 'till') return;
      var box = el.closest('.sheet');
      if (!box) return;
      var slot = box.querySelector('#ccTotal');
      if (!slot) return;
      var r = cashCountSum(box);
      var till = box.querySelector('[name="till"]');
      slot.innerHTML = cashCountBox(r.total, r.pieces, till ? till.value : '');
    }
    /* Откладываем на следующий тик нарочно. Общий обработчик в ui.js тоже
       пишет в подпись под числовым полем — и для поля, в которое печатают,
       он затирал бы нашу строку «2 шт × 5 000 = 10 000 ₽» сразу после того,
       как мы её поставили. Отложенный вызов всегда идёт последним. */
    function later(el) { setTimeout(function () { tick(el); }, 0); }
    document.addEventListener('input', function (e) { later(e.target); });
    document.addEventListener('change', function (e) { later(e.target); });
  })();

  /* ==========================================================================
     ЭКРАНЫ
     ========================================================================== */

  function quickBar() {
    return '<div class="quick">' +
      '<button class="btn btn-primary" data-form="shiftClose">' + ic('calculator') + ' Сверка кассы</button>' +
      '<button class="btn" data-form="dayTotals">' + ic('moon') + ' Итоги дня</button>' +
      '<button class="btn" data-form="moneyOut">' + ic('receipt') + ' Расход</button>' +
      '<button class="btn" data-form="moveCash">' + ic('truck') + ' Инкассация</button>' +
      '<button class="btn" data-form="payPlan">' + ic('calendar') + ' Выплата</button></div>';
  }

  /* СЧЁТ В МИНУСЕ — ЭТО НЕ БЫВАЕТ.

     Из сейфа нельзя заплатить больше, чем в нём лежит. Если счёт ушёл в
     минус, значит расход записали не с того счёта — обычно заплатили из
     кассы, а отметили сейф. Программа не запрещает такую запись (владелец
     может вносить историю не по порядку), но молчать о ней нельзя: минус
     в сейфе тихо ломает и «сколько у нас денег», и закрытие месяца.

     Денежный ящик не проверяем: пока смена не закрыта, его остаток временный. */
  function negativeAccounts() {
    return E.accountBalances(dds(), accounts()).live.filter(function (a) {
      return a.kind !== 'till' && a.balance < -0.5;
    });
  }

  function negativeBanner() {
    var bad = negativeAccounts();
    if (!bad.length) return '';
    return '<div class="banner orange"><span>' + ic('warning') + '</span><span>' +
      (bad.length === 1
        ? 'Счёт «' + esc(bad[0].name) + '» ушёл в минус на <b>' +
          esc(money(-bad[0].balance)) + '</b>.'
        : 'В минусе ' + bad.length + ' счёта: ' +
          esc(bad.map(function (a) { return a.name + ' (' + money(a.balance) + ')'; }).join(', ')) + '.') +
      ' Так не бывает: заплатить больше, чем лежит, нельзя. Скорее всего расход ' +
      'записан не с того счёта — проверьте последние записи в «Базе операций».' +
      '</span> <button class="btn btn-sm" data-go="ledger">Проверить</button></div>';
  }

  /* --- Пульт ------------------------------------------------------------------ */
  /* ==========================================================================
     ПУЛЬТ

     Утром владельцу нужны две вещи: сколько денег в кассе и что сегодня
     сделать. Раньше экран отвечал на них двадцать первым числом — пять
     одинаковых плашек, баннер на сорок слов и пять кнопок. Глазу негде было
     остановиться.

     Теперь так: одна крупная цифра, под ней список дел по одной строке на
     дело, и одна кнопка — та, которой пользуются прямо сейчас. Объяснения
     переехали на те экраны, куда эти дела ведут: на Пульте они не нужны,
     нужен повод туда зайти.
     ====================================================================== */

  // Дела на сегодня: коротко, по строке. Пусто — значит всё в порядке.
  function todoList(all, sel) {
    var out = [];
    var t = today();
    var pt = E.planTotals(S.state.plans || [], t);
    if (pt.overdue) {
      out.push({ icon: 'warning', color: 'c-red', text: 'Просрочено ' + money(pt.overdue),
        go: 'finpay', act: 'Открыть' });
    } else if (pt.dueToday) {
      out.push({ icon: 'calendar', text: 'Сегодня платить ' + money(pt.dueToday),
        go: 'finpay', act: 'Открыть' });
    }

    var yest = E.addDays(t, -1);
    if (all.length && !E.shiftsOf(all, null, S.settings).some(function (r) { return r.date === yest; })) {
      out.push({ icon: 'calculator', text: 'Смена за ' + dateRu(yest) + ' не сверена',
        form: 'shiftClose', act: 'Свести' });
    }

    var chk = E.tillPayoutCheck(sel.rows, null, { payouts: S.state.payouts || [], accounts: accounts() });
    if (chk.left > 0.5) {
      out.push({ icon: 'receipt', color: 'c-orange',
        text: 'Не расписано ' + money(chk.left) + ' из ящика',
        act2: 'payout-help', act: 'Разобрать' });
    } else if (chk.over) {
      out.push({ icon: 'warning', color: 'c-red',
        text: 'Лишних расходов из ящика на ' + money(-chk.left),
        go: 'ledger', act: 'Проверить' });
    }


    var cash = E.cashOnHand(all, S.settings, null, accounts());
    if (num(S.settings.cashLimit) && cash > num(S.settings.cashLimit)) {
      out.push({ icon: 'truck', text: 'В ящике ' + money(cash) + ' — пора увезти',
        form: 'moveCash', act: 'Инкассация' });
    }

    var gaps = E.cashGaps(all, S.settings);
    if (gaps.length) {
      var g = gaps[gaps.length - 1];
      out.push({ icon: 'warning', color: 'c-orange',
        text: 'Размен ' + dateRu(g.date) + ' не сошёлся на ' + money(Math.abs(g.gap)),
        go: 'cashiers', act: 'Смотреть' });
    }

    var deb = E.debtorTotals(S.state.debtors || [], t);
    if (deb.old > 0) {
      out.push({ icon: 'hourglass', text: 'Старые долги покупателей ' + money(deb.old),
        go: 'debtors', act: 'Открыть' });
    }
    return out;
  }

  function viewPulse() {
    var u = U();
    var all = dds();
    var h = u.pageHead('Пульт', 'Деньги и дела на сегодня');

    // Счёт в минусе — так не бывает; сказать об этом надо первым делом
    h += negativeBanner();

    /* Программа ещё не настроена под свой магазин. Форму поверх экрана не
       открываем — она перекрыла бы работу; достаточно спокойной строки,
       которую можно закрыть, вписав название. */
    if (!E.txt(S.settings.storeName)) {
      h += '<div class="banner blue"><span>' + ic('store') + '</span><span>' +
        'Программа ещё не настроена под ваш магазин: название, кассы, смены и ' +
        'начальные остатки. Без остатков касса и долг начнут считаться с нуля. ' +
        '<button class="btn btn-sm" data-form="setupWizard">Настроить магазин</button>' +
        '</span></div>';
    }

    if (!all.length) {
      return h + u.blank({ icon: 'gauge', title: 'Пульт пока пуст',
        why: 'Здесь будет видно, сколько денег в кассе, что сделать сегодня и ' +
          'где не сходится. Всё это собирается из закрытых смен — закройте первую, ' +
          'и пульт оживёт.',
        actions: [
          { name: 'Свести кассу', icon: 'calculator', form: 'shiftClose' },
          { name: 'Настроить магазин', icon: 'gear', go: 'settings' }
        ] });
    }

    var cash = E.cashOnHand(all, S.settings, null, accounts());
    var safe = E.safeOnHand(all, S.settings, null, accounts());
    var debt = E.supplierDebt(all, S.settings);
    var sel = pick(), t = E.totals(sel.rows);

    /* Главная цифра. Всё остальное про деньги — одной строкой под ней:
       эти суммы нужны для справки, а не для решения. */
    /* Подпись под главной цифрой: только то, что не ноль. Строка «в сейфе
       0 ₽» ничего не сообщает, а место занимает. Отрицательный долг — это
       переплата, и написать это словом понятнее, чем показать минус. */
    var bits = [];
    if (safe) bits.push('в сейфе ' + money(safe));
    if (debt.debt > 0) bits.push('долг поставщикам ' + money(debt.debt));
    else if (debt.debt < 0) bits.push('переплата поставщикам ' + money(-debt.debt));
    if (t.zCashless) bits.push('безнал ' + money(t.zCashless));
    var sub = bits.join('  ·  ');
    h += u.hero('Наличные в кассе', u.priv(cash), esc(sub),
      cash < 0 ? 'c-red' : '');

    // Дела: по строке на дело, без объяснений — они ждут на своём экране
    var todo = todoList(all, sel);
    if (todo.length) {
      h += u.card('Что сделать', u.listOf(todo.map(function (x) {
        var attrs = x.act2 ? ' data-act="' + esc(x.act2) + '"'
          : x.go ? ' data-go="' + esc(x.go) + '"' : ' data-form="' + esc(x.form) + '"';
        return u.listRow({ icon: x.icon,
          title: '<span class="' + (x.color || '') + '">' + esc(x.text) + '</span>',
          value: '<button class="btn btn-sm"' + attrs + '>' + esc(x.act) + '</button>' });
      }), ''));
    } else {
      h += '<div class="banner green"><span>' + ic('check') + '</span><span>' +
        'Всё сведено: смены закрыты, выплаты не просрочены, деньги из ящика расписаны.</span></div>';
    }

    // Одна главная кнопка — та, которой пользуются прямо сейчас
    var hourNow = new Date().getHours();
    var evening = hourNow >= 17 || hourNow < 4;
    h += '<div class="quick quick-main">' +
      (evening
        ? '<button class="btn btn-primary btn-lg" data-form="dayTotals">' + ic('moon') +
          ' Итоги дня</button>'
        : '<button class="btn btn-primary btn-lg" data-form="shiftClose">' + ic('calculator') +
          ' Свести кассу</button>') +
      '<button class="btn" data-form="' + (evening ? 'shiftClose' : 'dayTotals') + '">' +
      (evening ? 'Сверка кассы' : 'Итоги дня') + '</button>' +
      '<button class="btn" data-form="moneyOut">Расход</button>' +
      '<button class="btn" data-form="moveCash">Перевод</button>' +
      '<button class="btn" data-form="moneyDraw">Взял себе</button>' +
      '</div>';

    h += wholeNote(sel);

    var rating = E.cashierRating(sel.rows);
    var pt = E.planTotals(S.state.plans || [], today());
    var deb = E.debtorTotals(S.state.debtors || [], today());
    var st = E.tillState(all, S.settings);

    h += u.card('Кассы', u.listOf(st.map(function (x) {
      return u.listRow({ icon: 'coins', title: esc(x.till),
        sub: x.closed ? 'последняя смена ' + dateRu(x.date) + ' · ' + esc(x.shift) +
          (x.cashier ? ' · ' + esc(x.cashier) : '') : 'смен ещё не было',
        value: u.priv(x.fact) });
    }), ''), 'По факту последней закрытой смены');

    h += '<div class="grid-2">' +
      u.card('Выплаты поставщикам', u.listOf([
        u.listRow({ icon: 'warning', title: 'Просрочено', sub: pt.overdueCount + ' платежей',
          value: '<span class="c-red private">' + money(pt.overdue) + '</span>',
          tap: true, attrs: ' data-go="finpay"' }),
        u.listRow({ icon: 'calendar', title: 'Сегодня', value: u.priv(pt.dueToday),
          tap: true, attrs: ' data-go="finpay"' }),
        u.listRow({ icon: 'calendar', title: 'На неделе', value: u.priv(pt.week),
          tap: true, attrs: ' data-go="finpay"' })
      ], ''), '') +
      u.card('Долги покупателей', u.listOf([
        u.listRow({ icon: 'notebook', title: 'Всего не отдали', value: u.priv(deb.open),
          tap: true, attrs: ' data-go="debtors"' }),
        u.listRow({ icon: 'hourglass', title: 'Старше 30 дней',
          value: '<span class="' + (deb.old ? 'c-orange' : '') + ' private">' + money(deb.old) + '</span>',
          tap: true, attrs: ' data-go="debtors"' }),
        u.listRow({ icon: 'people', title: 'Должников', value: u.nf(deb.people.length) })
      ], ''), '') +
      '</div>';

    // Антирейтинг: сверху тот, у кого недостач больше
    var bad = rating.filter(function (r) { return r.short > 0; });
    h += u.card('Кто недосдаёт', bad.length ? u.table('pulseRate', [
      { title: 'Кассир', fn: function (r) { return esc(r.name); } },
      { title: 'Смен', cls: 'num', fn: function (r) { return u.nf(r.shifts); } },
      { title: 'Недостачи', cls: 'num', fn: function (r) {
        return '<b class="c-red private">' + money(r.short) + '</b>'; } },
      { title: 'На 1000 ₽ выручки', cls: 'num', fn: function (r) { return u.priv(r.per1000); } },
      { title: 'Смен с расхождением', cls: 'num', fn: function (r) {
        return u.nf(r.badShifts) + ' <span class="c-muted">' + u.pct(r.badPct) + '</span>'; } }
    ], bad.slice(0, 5), { step: 5 })
      : '<div class="empty">' + ic('check') + ' Недостач нет — все смены сошлись.</div>',
      '<button class="btn btn-sm" data-go="cashiers">Все кассиры</button>');

    h += u.card('Как идёт магазин — ' + (sel.whole ? 'за всё время' : u.periodName().toLowerCase()),
      u.listOf([
        u.listRow({ icon: 'banknote', title: 'Выручка', sub: 'наличные ' + money(t.zCash) +
          ' · безнал ' + money(t.zCashless), value: u.priv(t.revenue) }),
        u.listRow({ icon: 'receipt', title: 'Выплаты из ящика', sub: 'что брали из кассы за смены',
          value: u.priv(t.payouts) }),
        u.listRow({ icon: 'coins', title: 'Прочие расходы', sub: 'записаны отдельно',
          value: u.priv(t.expense) }),
        u.listRow({ icon: 'box', title: 'Товар за наличные', value: u.priv(t.goodsCash) }),
        u.listRow({ icon: 'clock', title: 'Смен закрыто',
          sub: t.shifts ? 'в среднем ' + money(t.avgShift) + ' за смену' : '',
          value: u.nf(t.shifts) }),
        u.listRow({ icon: 'calendar', title: 'Средняя выручка в день',
          sub: 'дней с записями: ' + t.dayCount, value: u.priv(t.avgDay) })
      ], ''));
    return h;
  }

  /* --- Утро: сверка кассы ------------------------------------------------------ */
  function viewMorning() {
    var u = U();
    var all = dds();
    var shifts = E.shiftsOf(all, null, S.settings).slice().reverse();
    var sel = pick();
    var t = E.totals(sel.rows);

    var h = u.pageHead('Утро: сверка кассы',
      'Закрыли смену — сверили ящик. Безнал в ящик не попадает',
      '<button class="btn btn-primary" data-form="shiftClose">' + ic('plus') + ' Закрыть смену</button>');

    h += '<div class="banner blue"><span>' + ic('calculator') + '</span><span>' +
      '<b>Расчётный остаток</b> = размен + Z-наличные − выплаты из ящика.<br>' +
      '<b>Расхождение</b> = факт в ящике − расчётный остаток. ' +
      'Минус — недостача кассира, плюс — излишек. ' +
      'Карта и СБП сюда не входят: этих денег в ящике не было.</span></div>';

    h += '<div class="stat-grid">' +
      u.stat('Смен за период', u.nf(t.shifts),
        t.badShifts ? t.badShifts + ' с расхождением' : 'все сошлись',
        t.badShifts ? 'c-orange' : 'c-green') +
      u.stat('Недостачи', u.priv(t.short), 'не хватило в ящике', t.short ? 'c-red' : 'c-green') +
      u.stat('Излишки', u.priv(t.over), 'оказалось больше расчётного') +
      u.stat('Выплаты из ящика', u.priv(t.payouts), 'брали за смены') +
      '</div>';
    h += wholeNote(sel);

    var defs = [
      { key: 'res', name: 'Как сошлась', options: [
        { v: 'short', name: 'Недостача', test: function (r) { return E.shiftCalc(r).diff < -0.5; } },
        { v: 'over', name: 'Излишек', test: function (r) { return E.shiftCalc(r).diff > 0.5; } },
        { v: 'ok', name: 'Сошлась', test: function (r) { return E.shiftCalc(r).ok; } }
      ] },
      { key: 'till', name: 'Касса', auto: function (r) { return r.till; }, limit: 6 },
      { key: 'shift', name: 'Смена', auto: function (r) { return r.shift; }, limit: 6 },
      { key: 'cashier', name: 'Кассир', auto: function (r) { return r.cashier; }, limit: 12 }
    ];
    var list = FLT().apply('morning', shifts, defs, function (r) {
      return (r.cashier || '') + ' ' + (r.note || '') + ' ' + (r.date || '');
    });
    h += FLT().bar('morning', defs, shifts, { search: 'кассир, дата, комментарий' });

    h += u.card('Закрытые смены', FLT().note(list.length, shifts.length) + u.table('shiftsT', [
      { title: 'Дата', fn: function (r) { return esc(dateRu(r.date)); } },
      { title: 'Касса', fn: function (r) { return esc(r.till || '—'); } },
      { title: 'Смена', fn: function (r) { return esc(r.shift || '—'); } },
      { title: 'Кассир', fn: function (r) { return esc(r.cashier || '—'); } },
      { title: 'Размен', cls: 'num', fn: function (r) { return u.priv(r.openCash); } },
      { title: 'Z наличные', cls: 'num', fn: function (r) { return u.priv(r.zCash); } },
      { title: 'Z безнал', cls: 'num', fn: function (r) { return u.priv(r.zCashless); } },
      { title: 'Выплаты', cls: 'num', fn: function (r) { return u.priv(r.payouts); } },
      { title: 'Должно быть', cls: 'num', fn: function (r) { return u.priv(E.shiftCalc(r).expected); } },
      { title: 'Факт', cls: 'num', fn: function (r) { return u.priv(r.factCash); } },
      { title: 'Расхождение', cls: 'num', fn: function (r) {
        var c = E.shiftCalc(r);
        if (c.ok) return '<span class="c-green">сходится</span>';
        return '<b class="' + (c.diff < 0 ? 'c-red' : 'c-orange') + ' private">' +
          (c.diff > 0 ? '+' : '') + money(c.diff) + '</b>'; } },
      { title: '', cls: 'center', fn: function (r) {
        return u.rowMenu('dds', r.id, { form: 'shiftClose' }); } }
    ], list, { step: 40, empty: FLT().active('morning') ? 'Под фильтр ничего не подошло'
      : 'Смен пока нет. Нажмите «Закрыть смену».',
      total: [{ html: 'Итого', span: 5, label: 'Итого' },
        { html: money(t.zCash), cls: 'num', label: 'Z наличные' },
        { html: money(t.zCashless), cls: 'num', label: 'Z безнал' },
        { html: money(t.payouts), cls: 'num', label: 'Выплаты' },
        { html: '', cls: 'num' }, { html: '', cls: 'num' },
        { html: '<span class="' + u.cls(t.diff) + '">' + money(t.diff) + '</span>', cls: 'num', label: 'Расхождение' },
        { html: '' }] }));

    h += '<div class="quick"><button class="btn" data-form="cashCount">' + ic('receipt') + ' Пересчитать по купюрам</button> ' +
      '<button class="btn" data-go="cashiers">' + ic('people') +
      ' Кассиры и расхождения</button></div>';
    return h;
  }

  /* --- Вечер: итоги дня --------------------------------------------------------- */
  function viewEvening() {
    var u = U();
    var days = dds().filter(E.isDay).slice().sort(function (a, b) {
      return E.txt(b.date).localeCompare(E.txt(a.date));
    });
    var sel = pick(), t = E.totals(sel.rows);
    var debt = E.supplierDebt(dds(), S.settings);

    var h = u.pageHead('Вечер: итоги дня', 'Товар и долги поставщикам за день',
      '<button class="btn btn-primary" data-form="dayTotals">' + ic('plus') + ' Записать итоги дня</button>');

    h += '<div class="banner blue"><span>' + ic('moon') + '</span><span>Эта форма про <b>товар и долги</b>, ' +
      'а не про кассу. Деньги за товар уже ушли из ящика и посчитаны в «Выплатах» при сверке ' +
      'смены — если вычесть их ещё раз, одни и те же деньги уйдут дважды.</span></div>';

    h += '<div class="stat-grid">' +
      u.stat('Долг поставщикам', u.priv(debt.debt), 'на сегодня',
        debt.debt >= num(S.settings.debtCrit) ? 'c-red' : '') +
      u.stat('Взято в долг за период', u.priv(t.debtTaken), 'привезли без оплаты') +
      u.stat('Погашено за период', u.priv(t.debtPaid), 'отдали поставщикам', 'c-green') +
      u.stat('Товар за наличные', u.priv(t.goodsCash), 'взяли и сразу заплатили') +
      '</div>';
    h += wholeNote(sel);

    if (debt.opening) {
      h += '<div class="banner"><span>' + ic('info') + '</span><span>Долг считается от начального: ' +
        '<b>' + money(debt.opening) + '</b> из «Настроек» плюс взятое в долг минус погашенное. ' +
        'Если начальная цифра не та — поправьте в настройках, раздел «Начальные остатки».</span></div>';
    }

    h += u.card('Итоги по дням', u.table('daysT', [
      { title: 'Дата', fn: function (r) { return esc(dateRu(r.date)); } },
      { title: 'Товар за наличные', cls: 'num', fn: function (r) { return u.priv(r.goodsCash); } },
      { title: 'Погашено долга', cls: 'num', fn: function (r) { return u.priv(r.debtPaid); } },
      { title: 'Взято в долг', cls: 'num', fn: function (r) { return u.priv(r.debtTaken); } },
      { title: 'Долг вырос на', cls: 'num', fn: function (r) {
        var d = E.safeRound(num(r.debtTaken) - num(r.debtPaid));
        return '<span class="' + (d > 0 ? 'c-red' : 'c-green') + ' private">' +
          (d > 0 ? '+' : '') + money(d) + '</span>'; } },
      { title: 'Комментарий', fn: function (r) { return esc(r.note || '—'); } },
      { title: '', cls: 'center', fn: function (r) {
        return u.rowMenu('dds', r.id, { form: 'dayTotals' }); } }
    ], days, { step: 40, empty: 'Итогов дня пока нет.',
      total: [{ html: 'Итого', label: 'Итого' },
        { html: money(t.goodsCash), cls: 'num', label: 'Товар за наличные' },
        { html: money(t.debtPaid), cls: 'num', label: 'Погашено' },
        { html: money(t.debtTaken), cls: 'num', label: 'Взято в долг' },
        { html: '', cls: 'num' }, { html: '' }, { html: '' }] }));
    return h;
  }

  /* --- План выплат -------------------------------------------------------------- */
  function viewPlans() {
    var u = U();
    var plans = (S.state.plans || []).slice().sort(function (a, b) {
      return E.txt(a.due).localeCompare(E.txt(b.due));
    });
    var t = E.planTotals(plans, today());

    var h = u.pageHead('План выплат', 'Кому и когда платить',
      '<button class="btn btn-primary" data-form="payPlan">' + ic('plus') + ' Запланировать выплату</button>');

    h += '<div class="stat-grid">' +
      u.stat('Просрочено', u.priv(t.overdue), t.overdueCount + ' платежей',
        t.overdue ? 'c-red' : 'c-green') +
      u.stat('Сегодня', u.priv(t.dueToday), 'платить сегодня') +
      u.stat('На неделе', u.priv(t.week), 'ближайшие 7 дней') +
      u.stat('Всего запланировано', u.priv(t.planned), t.plannedCount + ' платежей') +
      '</div>';

    h += '<div class="banner"><span>' + ic('info') + '</span><span>Отметка «Оплачена» закрывает пункт плана, ' +
      'но долг поставщикам сама не уменьшает: сумму погашения впишите в «Итоги дня». ' +
      'Так у долга остаётся один источник и он не считается дважды.</span></div>';

    var defs = [{ key: 'st', name: 'Состояние', options: [
      { v: 'late', name: 'Просрочено', test: function (p) { return E.planStatus(p).key === 'late'; } },
      { v: 'today', name: 'Сегодня', test: function (p) { return E.planStatus(p).key === 'today'; } },
      { v: 'plan', name: 'Впереди', test: function (p) {
        var k = E.planStatus(p).key; return k === 'plan' || k === 'soon'; } },
      { v: 'paid', name: 'Оплачено', test: function (p) { return E.planStatus(p).key === 'paid'; } }
    ] }, { key: 'who', name: 'Кому', auto: function (p) { return p.supplier; }, limit: 14 }];
    var list = FLT().apply('plans', plans, defs, function (p) { return p.supplier + ' ' + (p.note || ''); });
    h += FLT().bar('plans', defs, plans, { search: 'поставщик или комментарий' });

    h += u.card('Календарь платежей', FLT().note(list.length, plans.length) + u.table('plansT', [
      { title: 'Когда', fn: function (p) { return esc(dateRu(p.due)); } },
      { title: 'Что и кому', fn: function (p) {
        var что = E.txt(p.category), кому = E.txt(p.supplier);
        if (что && кому) return esc(что) + '<br><small class="c-muted">' + esc(кому) + '</small>';
        return esc(что || кому || '—'); } },
      { title: 'Сумма', cls: 'num', fn: function (p) { return u.priv(p.amount); } },
      { title: 'Чем', fn: function (p) { return esc(p.method || '—'); } },
      { title: 'Состояние', fn: function (p) {
        var st = E.planStatus(p, today());
        return u.badge(st.name, st.color); } },
      { title: 'Комментарий', fn: function (p) { return esc(p.note || '—'); } },
      { title: '', cls: 'center', fn: function (p) {
        var st = E.planStatus(p, today());
        return (st.key === 'paid' ? ''
          : '<button class="btn btn-sm btn-primary" data-act="plan-paid" data-id="' + p.id + '">Оплатил</button> ') +
          u.rowMenu('plans', p.id, { form: 'payPlan' }); } }
    ], list, { step: 40, empty: 'Плановых выплат нет.' }));
    return h;
  }

  /* --- Кассиры и расхождения ------------------------------------------------------ */
  function viewCashiers() {
    var u = U();
    var sel = pick();
    var rating = E.cashierRating(sel.rows);
    var t = E.totals(sel.rows);
    var crit = num(S.settings.diffCrit) || 1000;

    var h = u.pageHead('Кассиры и расхождения',
      'У кого касса не сходится — ' + (sel.whole ? 'за всё время' : u.periodName().toLowerCase()),
      '<button class="btn" data-act="print">' + ic('print') + ' Печать</button>');

    h += '<div class="stat-grid">' +
      u.stat('Недостачи', u.priv(t.short), 'всего не хватило', t.short ? 'c-red' : 'c-green') +
      u.stat('Излишки', u.priv(t.over), 'всего оказалось лишним') +
      u.stat('Смен с расхождением', u.nf(t.badShifts), 'из ' + t.shifts,
        t.badShifts ? 'c-orange' : 'c-green') +
      u.stat('Кассиров', u.nf(rating.length), 'работали за период') +
      '</div>';
    h += wholeNote(sel);

    h += u.card('Антирейтинг', u.table('rateT', [
      { title: 'Кассир', fn: function (r) { return esc(r.name); } },
      { title: 'Смен', cls: 'num', fn: function (r) { return u.nf(r.shifts); } },
      { title: 'Выручка', cls: 'num', fn: function (r) { return u.priv(r.revenue); } },
      { title: 'Недостачи', cls: 'num', fn: function (r) {
        return r.short ? '<b class="c-red private">' + money(r.short) + '</b>' : '—'; } },
      { title: 'Излишки', cls: 'num', fn: function (r) {
        return r.over ? '<span class="c-orange private">' + money(r.over) + '</span>' : '—'; } },
      { title: 'На 1000 ₽ выручки', cls: 'num', fn: function (r) { return u.priv(r.per1000); } },
      { title: 'Смен с расхождением', cls: 'num', fn: function (r) {
        return u.nf(r.badShifts) + ' <span class="c-muted">' + u.pct(r.badPct) + '</span>'; } },
      { title: 'Худший случай', cls: 'num', fn: function (r) {
        return r.worst ? '<span class="private">' + money(r.worst) + '</span>' +
          '<small class="c-muted"> ' + esc(dateRu(r.worstDate)) + '</small>' : '—'; } }
    ], rating, { step: 30, empty: 'Смен за период нет.' }));

    var bigOnes = E.shiftsOf(sel.rows, null, S.settings).filter(function (r) {
      return Math.abs(E.shiftCalc(r).diff) >= crit;
    }).sort(function (a, b) { return E.shiftCalc(a).diff - E.shiftCalc(b).diff; });
    if (bigOnes.length) {
      h += u.card('Крупные расхождения — от ' + money(crit), u.table('bigT', [
        { title: 'Дата', fn: function (r) { return esc(dateRu(r.date)); } },
        { title: 'Касса', fn: function (r) { return esc(r.till || '—'); } },
        { title: 'Смена', fn: function (r) { return esc(r.shift || '—'); } },
        { title: 'Кассир', fn: function (r) { return esc(r.cashier || '—'); } },
        { title: 'Должно быть', cls: 'num', fn: function (r) { return u.priv(E.shiftCalc(r).expected); } },
        { title: 'Факт', cls: 'num', fn: function (r) { return u.priv(r.factCash); } },
        { title: 'Расхождение', cls: 'num', fn: function (r) {
          var c = E.shiftCalc(r);
          return '<b class="' + (c.diff < 0 ? 'c-red' : 'c-orange') + ' private">' +
            (c.diff > 0 ? '+' : '') + money(c.diff) + '</b>'; } },
        { title: 'Комментарий', fn: function (r) { return esc(r.note || '—'); } }
      ], bigOnes, { step: 30 }),
        'Порог задаётся в настройках, раздел «Пороги»');
    }

    h += '<div class="banner"><span>' + ic('info') + '</span><span>Сравнивайте не сумму недостач, а ' +
      '<b>недостачу на 1000 ₽ выручки</b>: кассир с большой выручкой и парой ошибок ' +
      'аккуратнее того, у кого выручка маленькая, а недостачи те же.</span></div>';
    return h;
  }

  /* --- База операций -------------------------------------------------------------- */
  function viewLedger() {
    var u = U();
    var sel = pick(), rows = sel.rows.slice().sort(function (a, b) {
      return E.txt(b.date).localeCompare(E.txt(a.date));
    });
    var t = E.totals(rows);

    var h = u.pageHead('База операций', 'Все записи о деньгах — ' +
      (sel.whole ? 'за всё время' : u.periodName().toLowerCase()),
      '<button class="btn" data-act="export-screen">' + ic('download') + ' В Excel</button>');

    h += '<div class="stat-grid">' +
      u.stat('Записей', u.nf(rows.length), 'смены, дни, приходы и расходы') +
      u.stat('Выручка', u.priv(t.revenue), 'наличные ' + money(t.zCash) + ' · безнал ' + money(t.zCashless)) +
      u.stat('Потрачено', u.priv(t.spent), 'выплаты из ящика плюс расходы') +
      u.stat('Забрал владелец', u.priv(t.draw), 'из оборота') +
      '</div>';
    h += wholeNote(sel);

    var defs = [
      { key: 'type', name: 'Что это', auto: function (r) { return r.type; }, limit: 6 },
      { key: 'cat', name: 'Статья', auto: function (r) { return r.category; }, limit: 14 },
      { key: 'method', name: 'Чем', auto: function (r) { return r.method; }, limit: 6 },
      { key: 'cashier', name: 'Кассир', auto: function (r) { return r.cashier; }, limit: 12 }
    ];
    var list = FLT().apply('ledger', rows, defs, function (r) {
      return [r.category, r.note, r.cashier, r.till, r.shift].filter(Boolean).join(' ');
    });
    h += FLT().bar('ledger', defs, rows, { search: 'статья, кассир, комментарий' });

    function sumOf(r) {
      if (E.isShift(r)) return E.shiftCalc(r).revenue;
      if (E.isDay(r)) return E.safeRound(num(r.goodsCash) + num(r.debtPaid));
      return num(r.amount);
    }
    function whatOf(r) {
      if (E.isShift(r)) return 'Смена: ' + esc(r.till || '') + ' ' + esc(r.shift || '') +
        (r.cashier ? ' · ' + esc(r.cashier) : '');
      if (E.isDay(r)) return 'Итоги дня';
      // Подстатью показываем стрелкой: «Коммунальные → Свет» читается легче черты
      return esc(E.catLabel(r.category) || '—');
    }
    h += u.card('Записи', FLT().note(list.length, rows.length) + u.table('ledgerT', [
      { title: 'Дата', fn: function (r) { return esc(dateRu(r.date)); } },
      { title: 'Что это', fn: function (r) { return u.badge(r.type || '—',
        E.isShift(r) ? 'blue' : E.isDay(r) ? 'gray' : E.isIncome(r) ? 'green'
          : E.isDraw(r) ? 'orange' : 'red'); } },
      { title: 'Подробности', fn: whatOf },
      { title: 'Чем', fn: function (r) { return esc(r.method || (E.isShift(r) ? 'нал + безнал' : '—')); } },
      { title: 'Сумма', cls: 'num', fn: function (r) { return u.priv(sumOf(r)); } },
      { title: 'Расхождение', cls: 'num', fn: function (r) {
        if (!E.isShift(r)) return '—';
        var c = E.shiftCalc(r);
        return c.ok ? '<span class="c-green">сходится</span>'
          : '<span class="' + (c.diff < 0 ? 'c-red' : 'c-orange') + ' private">' + money(c.diff) + '</span>'; } },
      { title: 'Комментарий', fn: function (r) { return esc(r.note || '—'); } },
      { title: '', cls: 'center', fn: function (r) {
        var form = E.isShift(r) ? 'shiftClose' : E.isDay(r) ? 'dayTotals'
          : E.isIncome(r) ? 'moneyIn' : E.isDraw(r) ? 'moneyDraw' : 'moneyOut';
        return u.rowMenu('dds', r.id, { form: form }); } }
    ], list, { step: 50, empty: FLT().active('ledger') ? 'Под фильтр ничего не подошло' : 'Записей нет.' }));

    h += '<div class="quick">' +
      '<button class="btn" data-form="moneyIn">' + ic('banknote') + ' Приход</button> ' +
      '<button class="btn" data-form="moneyOut">' + ic('receipt') + ' Расход</button> ' +
      '<button class="btn" data-form="moneyDraw">' + ic('wallet') + ' Забрал владелец</button></div>';
    return h;
  }

  /* --- Долги покупателей ---------------------------------------------------------- */
  function viewDebtors() {
    var u = U();
    var rows = (S.state.debtors || []).slice().sort(function (a, b) {
      return E.txt(b.date).localeCompare(E.txt(a.date));
    });
    var t = E.debtorTotals(rows, today());
    var oldDays = num(S.settings.debtorOldDays) || 30;

    var h = u.pageHead('Долги покупателей', 'Бывшая тетрадка у кассы',
      '<button class="btn btn-primary" data-form="debtor">' + ic('plus') + ' Записать долг</button>');

    h += '<div class="stat-grid">' +
      u.stat('Не отдали', u.priv(t.open), t.people.length + ' человек', t.open ? 'c-orange' : 'c-green') +
      u.stat('Старше ' + oldDays + ' дней', u.priv(t.old), 'пора напомнить', t.old ? 'c-red' : 'c-green') +
      u.stat('Погашено', u.priv(t.closed), 'вернули полностью', 'c-green') +
      '</div>';

    var defs = [{ key: 'st', name: 'Состояние', options: [
      { v: 'open', name: 'Не отдал', test: function (d) { return num(d.sum) - num(d.paid) > 0; } },
      { v: 'old', name: 'Старше ' + oldDays + ' дней', test: function (d) {
        return num(d.sum) - num(d.paid) > 0 && E.daysBetween(d.date, today()) > oldDays; } },
      { v: 'closed', name: 'Вернул', test: function (d) { return num(d.sum) - num(d.paid) <= 0; } }
    ] }];
    var list = FLT().apply('debtors', rows, defs, function (d) { return d.name + ' ' + (d.phone || ''); });
    h += FLT().bar('debtors', defs, rows, { search: 'имя или телефон' });

    h += u.card('Кто должен', FLT().note(list.length, rows.length) + u.table('debtT', [
      { title: 'Кто', fn: function (d) { return esc(d.name); } },
      { title: 'Телефон', fn: function (d) {
        return d.phone ? '<a href="tel:' + esc(d.phone) + '">' + esc(d.phone) + '</a>' : '—'; } },
      { title: 'Когда', fn: function (d) { return esc(dateRu(d.date)); } },
      { title: 'Дней', cls: 'num', fn: function (d) {
        var n = E.daysBetween(d.date, today());
        return '<span class="' + (n > oldDays ? 'c-red' : '') + '">' + u.nf(n) + '</span>'; } },
      { title: 'Взял', cls: 'num', fn: function (d) { return u.priv(d.sum); } },
      { title: 'Вернул', cls: 'num', fn: function (d) { return u.priv(d.paid); } },
      { title: 'Осталось', cls: 'num', fn: function (d) {
        var left = E.safeRound(num(d.sum) - num(d.paid));
        return left > 0 ? '<b class="c-red private">' + money(left) + '</b>'
          : '<span class="c-green">вернул</span>'; } },
      { title: 'Кассир', fn: function (d) { return esc(d.cashier || '—'); } },
      { title: '', cls: 'center', fn: function (d) { return u.rowMenu('debtors', d.id, { form: 'debtor' }); } }
    ], list, { step: 40, empty: 'Долгов нет.' }));

    h += '<div class="banner"><span>' + ic('info') + '</span><span>Пока долг не погашен, он не выручка. ' +
      'Когда человек вернёт деньги — впишите сумму в «Уже погашено», а сами деньги ' +
      'придут в кассу через сверку смены (или запишите «Приход денег»).</span></div>';
    return h;
  }

  /* --- Отчёт за месяц -------------------------------------------------------------- */
  function viewReport() {
    var u = U();
    var all = dds();
    if (!all.length) {
      return u.pageHead('Отчёт за месяц', 'Что было и как это выглядит рядом с прошлым месяцем') +
        u.blank({ icon: 'doc', title: 'Сравнивать пока не с чем',
          why: 'Этот отчёт ставит месяц рядом с прошлым и показывает, что выросло, ' +
            'а что просело. Он появится, когда наберётся хотя бы одна закрытая смена.',
          actions: [
            { name: 'Свести кассу', icon: 'calculator', form: 'shiftClose' },
            { name: 'На Пульт', icon: 'gauge', go: 'pulse' }
          ] });
    }
    var months = {};
    all.forEach(function (r) { if (r.date) months[E.ymOf(r.date)] = 1; });
    var list = Object.keys(months).sort().reverse();
    var ym = S.settings.reportMonth && list.indexOf(S.settings.reportMonth) >= 0
      ? S.settings.reportMonth : list[0];
    var prevYm = E.prevMonth(ym);
    function of(m) { return all.filter(function (r) { return E.ymOf(r.date) === m; }); }
    var a = E.totals(of(ym)), b = E.totals(of(prevYm));

    var h = u.pageHead('Отчёт за месяц', E.monthTitle(ym) + ' — против ' + E.monthName(prevYm),
      '<select id="repMonth" style="background:var(--fill);border:none;border-radius:9px;padding:9px 12px;font-size:14px">' +
      list.map(function (m) {
        return '<option value="' + m + '"' + (m === ym ? ' selected' : '') + '>' +
          esc(E.monthTitle(m)) + '</option>';
      }).join('') + '</select> <button class="btn" data-act="print">' + ic('print') + ' Печать</button>');

    function line(name, x, y, isMoney) {
      return { name: name, cur: x, prev: y, delta: E.safeRound(x - y),
        pct: y ? E.safeRound((x - y) / Math.abs(y) * 100) : null, money: isMoney !== false };
    }
    var lines = [
      line('Выручка', a.revenue, b.revenue),
      line('в т.ч. наличными', a.zCash, b.zCash),
      line('в т.ч. безналом', a.zCashless, b.zCashless),
      line('Доля безнала, %', a.cashlessShare, b.cashlessShare, false),
      line('Выплаты из ящика', a.payouts, b.payouts),
      line('Прочие расходы', a.expense, b.expense),
      line('Товар за наличные', a.goodsCash, b.goodsCash),
      line('Взято в долг', a.debtTaken, b.debtTaken),
      line('Погашено долга', a.debtPaid, b.debtPaid),
      line('Недостачи', a.short, b.short),
      line('Излишки', a.over, b.over),
      line('Забрал владелец', a.draw, b.draw),
      line('Смен закрыто', a.shifts, b.shifts, false),
      line('Средняя выручка за смену', a.avgShift, b.avgShift)
    ];

    h += '<div class="stat-grid">' +
      u.stat('Выручка', u.priv(a.revenue), 'в прошлом месяце ' + money(b.revenue)) +
      u.stat('Потрачено', u.priv(a.spent), 'выплаты плюс расходы') +
      u.stat('Недостачи', u.priv(a.short), a.badShifts + ' смен не сошлись',
        a.short ? 'c-red' : 'c-green') +
      u.stat('Доля безнала', u.pct(a.cashlessShare), 'в прошлом месяце ' + u.pct(b.cashlessShare)) +
      '</div>';

    h += u.card('Строка за строкой', u.table('repT', [
      { title: 'Показатель', fn: function (r) { return esc(r.name); } },
      { title: E.monthTitle(ym), cls: 'num', fn: function (r) {
        return r.money ? u.priv(r.cur) : u.nf(r.cur, r.name.indexOf('%') > 0 ? 1 : 0); } },
      { title: E.monthTitle(prevYm), cls: 'num', fn: function (r) {
        return r.money ? u.priv(r.prev) : u.nf(r.prev, r.name.indexOf('%') > 0 ? 1 : 0); } },
      { title: 'Разница', cls: 'num', fn: function (r) {
        return '<span class="' + u.cls(r.delta) + (r.money ? ' private' : '') + '">' +
          (r.delta > 0 ? '+' : '') + (r.money ? money(r.delta) : u.nf(r.delta, 1)) + '</span>'; } },
      { title: '%', cls: 'num', fn: function (r) {
        return r.pct == null ? '—' : '<span class="' + u.cls(r.pct) + '">' +
          (r.pct > 0 ? '+' : '') + u.pct(r.pct) + '</span>'; } }
    ], lines, { step: 30 }));

    var cats = Object.keys(a.byCategory).map(function (k) {
      return { name: k, sum: a.byCategory[k], prev: b.byCategory[k] || 0 };
    }).sort(function (x, y) { return y.sum - x.sum; });
    if (cats.length) {
      h += u.card('Расходы по статьям', u.table('catT', [
        { title: 'Статья', fn: function (r) { return esc(E.catLabel(r.name)); } },
        { title: 'Сумма', cls: 'num', fn: function (r) { return u.priv(r.sum); } },
        { title: 'Доля', cls: 'num', fn: function (r) {
          return u.pct(E.div(r.sum, a.expense) * 100); } },
        { title: 'В прошлом месяце', cls: 'num', fn: function (r) { return u.priv(r.prev); } }
      ], cats, { step: 20 }));
    }
    return h;
  }

  /* ==========================================================================
     ДЕЙСТВИЯ
     ========================================================================== */
  var A = window.WM_EXTRA_ACTIONS = window.WM_EXTRA_ACTIONS || {};

  /* ==========================================================================
     ОКНО ПОДРОБНОСТЕЙ

     В отчёте видно «Коммунальные 7 000 ₽». Первый вопрос владельца — из чего
     они сложились. Раньше на него можно было ответить только уйдя в «Базу
     операций» и выставив там фильтры руками.

     Теперь строка отчёта нажимается и открывает окно: все записи, из которых
     сложилась сумма, с датой, счётом и кассиром. Отчёт при этом не покидается —
     закрыл окно и читаешь дальше.

     data-drill="вид|что|с|по" — вид говорит, что показывать:
       cat    — расходы по статье (и по её подстатьям)
       acc    — движение по счёту
       shift  — смены за период
     ========================================================================== */
  A['drill'] = function (el) {
    var p = E.txt(el.dataset.drill).split('|');
    var вид = p[0], что = decodeURIComponent(p[1] || ''), от = p[2] || '', до = p[3] || '';
    var u = U();

    var строки = dds().filter(function (r) {
      var d = E.txt(r.date);
      if (от && d < от) return false;
      if (до && d > до) return false;
      if (вид === 'cat') {
        if (!E.isExpense(r)) return false;
        var c = E.txt(r.category);
        // Статья-группа показывает и свои подстатьи: «Коммунальные» и «Свет»
        return E.norm(c) === E.norm(что) || E.norm(E.catGroup(c)) === E.norm(что);
      }
      if (вид === 'kind') {
        /* Группа затрат из отчёта о прибыли («Аренда», «Коммунальные»).
           Группу считаем по ГРУППЕ статьи: «Коммунальные / Свет» должен
           попасть в «Коммунальные», а не в «прочие расходы». */
        if (!E.isExpense(r) || E.notACost(r.category)) return false;
        return E.costKindOf(E.catGroup(r.category) || r.category) === что;
      }
      if (вид === 'acc') return E.txt(r.account) === что || E.txt(r.toAccount) === что;
      if (вид === 'shift') return E.isShift(r);
      return false;
    }).sort(function (a, b) { return E.txt(a.date) < E.txt(b.date) ? -1 : 1; });

    var сумма = E.safeRound(строки.reduce(function (a, r) {
      return a + num(вид === 'shift' ? E.shiftCalc(r).revenue : r.amount);
    }, 0));

    var заголовок = вид === 'cat' ? E.catLabel(что)
      : вид === 'kind' ? (E.costKindName ? E.costKindName(что) : что)
      : вид === 'acc' ? (accName(что) || 'Счёт') : 'Смены';
    var период = (от || до)
      ? ' · ' + (от ? dateRu(от) : '') + (до ? ' – ' + dateRu(до) : '') : '';

    var h = '<div class="drill-head"><div class="drill-sum">' + esc(money(сумма)) + '</div>' +
      '<div class="drill-sub">' + u.nf(строки.length) + ' ' +
      u.plural(строки.length, 'запись', 'записи', 'записей') + esc(период) + '</div></div>';

    if (!строки.length) {
      h += '<div class="empty">За этот период записей по «' + esc(заголовок) + '» нет.</div>';
    } else {
      h += u.table('drillT', [
        { title: 'Дата', fn: function (r) { return esc(dateRu(r.date)); } },
        { title: 'Что', fn: function (r) {
          return вид === 'shift'
            ? esc((r.till || '') + ' ' + (r.shift || '') + (r.cashier ? ' · ' + r.cashier : ''))
            : esc(E.catLabel(r.category) || '—') +
              (r.note ? ' <span class="c-muted">· ' + esc(r.note) + '</span>' : ''); } },
        { title: 'Счёт', fn: function (r) { return esc(accName(r.account) || '—'); } },
        { title: 'Сумма', cls: 'num', fn: function (r) {
          return u.priv(вид === 'shift' ? E.shiftCalc(r).revenue : r.amount); } },
        { title: '', cls: 'center', fn: function (r) {
          return вид === 'shift' ? '' : u.rowMenu('dds', r.id, { form: 'moneyOut' }); } }
      ], строки, { step: 60,
        total: [{ html: 'Всего' }, { html: '' }, { html: '' },
          { cls: 'num', html: '<b>' + u.priv(сумма) + '</b>' }, { html: '' }] });
    }

    /* Кнопка в базу операций: когда подробностей мало — правят прямо здесь,
       когда надо копать глубже — идут туда, где есть все фильтры. */
    h += '<div class="form-actions"><button class="btn" data-act="drill-ledger" ' +
      'data-kind="' + esc(вид) + '" data-what="' + esc(encodeURIComponent(что)) + '">' +
      ic('list') + ' Показать в базе операций</button></div>';

    u.sheet(заголовок + период, h);
    return null;
  };

  /* Перейти в базу операций с уже выставленным фильтром */
  A['drill-ledger'] = function (el) {
    var вид = E.txt(el.dataset.kind), что = decodeURIComponent(el.dataset.what || '');
    U().closeSheet();
    if (вид === 'cat') FLT().set('ledger', 'cat', что);
    U().go('ledger');
    return null;
  };


  /* Отметить выплату оплаченной. Долг сама не уменьшает — предлагает вписать
     сумму в итоги дня, чтобы у кредиторки остался один источник. */
  /* «Отложить» у конверта: открывает обычный перевод, но конверт и счёт-получатель
     уже проставлены. Отдельной «операции откладывания» в программе нет — это
     важно: чем меньше видов записей, тем меньше мест, где деньги могут
     потеряться. */
  A['fund-put'] = function (el) {
    var f = funds().filter(function (x) { return x.id === el.dataset.id; })[0];
    if (!f) return 'Конверт не найден.';
    var ft = E.fundTotals(funds(), dds(), null, U().month ? U().month() : E.ymOf(today()));
    var row = ft.rows.filter(function (x) { return x.id === f.id; })[0];
    U().openForm('moveCash', { date: today(), toAccount: E.txt(f.account),
      account: accDefault(false), fund: f.id,
      amount: row && row.toPut > 0 ? row.toPut : '' });
    return null;
  };

  /* --------------------------------------------------------------------------
     «РАЗОБРАТЬ»: ЧТО ЗНАЧИТ «НЕ РАСПИСАНО ИЗ ЯЩИКА»

     Это самая непонятная строка в программе, и объяснять её надо словами,
     а не отправлять человека в журнал разбираться самому.

     Суть простая. При сверке смены кассир пишет одной строкой, сколько всего
     вынул из ящика («выплаты из ящика»). Сумма известна, а на ЧТО ушли эти
     деньги — нет. Пока не расписано, в отчёте о прибыли их не видно:
     программа не знает, товар это был, зарплата или аренда.

     Окно показывает, сколько не расписано по дням, и даёт кнопки — каждая
     открывает нужную форму с уже подставленной датой.
     -------------------------------------------------------------------------- */
  /* Кнопки быстрого ввода. Экран перерисовываем целиком: на нём нет полей,
     которые можно потерять, — только набранная сумма, а она в FAST_SUM. */
  A['fast-key'] = function (el) {
    var k = el.dataset.key;
    if (k === 'C') FAST_SUM = '';
    else if (k === '⌫') FAST_SUM = FAST_SUM.slice(0, -1);
    else if (k === '00') FAST_SUM = FAST_SUM ? FAST_SUM + '00' : '';
    else FAST_SUM = (FAST_SUM + k).replace(/^0+(?=\d)/, '');
    if (FAST_SUM.length > 9) FAST_SUM = FAST_SUM.slice(0, 9);
    return null;      // перерисовку делает общий обработчик нажатий
  };

  A['fast-add'] = function (el) {
    var было = num(window.WMNum.calc(FAST_SUM) || 0);
    FAST_SUM = String(было + num(el.dataset.add));
    return null;
  };

  /* Нажали статью — запись готова. Дата сегодняшняя, счёт по памяти о том,
     чем платили по этой статье в прошлый раз, конверт по названию статьи. */
  A['fast-cat'] = function (el) {
    var cat = decodeURIComponent(el.dataset.cat || '');
    var сумма = E.safeRound(num(window.WMNum.calc(FAST_SUM) || 0));
    if (!сумма) return 'Сначала наберите сумму.';
    if (!cat) return 'Не понял статью.';

    var не = E.notACost(cat);
    if (не) {
      return 'Это не расход магазина. ' + (не.why || '') +
        ' Запишите через «Итоги дня» или «Перевод».';
    }
    var lock = S.lockedWhy('dds', { date: today() });
    if (lock) return lock;

    var acc = accForCategory(cat, false);
    var rec = { type: E.T_OUT, date: today(), category: cat, method: 'Наличные',
      account: acc, amount: сумма, fund: fundForCategory(cat) };
    S.add('dds', rec);
    S.save();
    FAST_SUM = '';
    refresh();

    /* Сразу говорим, куда легло, и даём поправить: быстрый ввод хорош тем,
       что ошибка исправляется так же быстро, как делается.
       Возвращаем строку — объект {ok:…} это соглашение форм, не действий. */
    return E.catLabel(cat) + ' — ' + money(сумма) + ', счёт «' +
      (accName(acc) || '—') + '», сегодня. Ошиблись — поправьте в списке ниже.';
  };

  A['payout-help'] = function () {
    var u = U();
    var sel = { rows: dds() };
    var chk = E.tillPayoutCheck(dds(), null,
      { payouts: S.state.payouts || [], accounts: accounts() });
    var дни = (chk.rows || []).filter(function (r) { return r.left > 0.5; })
      .sort(function (a, b) { return b.date < a.date ? -1 : 1; });
    var день = дни.length ? дни[0].date : today();

    var h = '<div class="card-pad">' +
      '<p><b>Что это значит.</b> При сверке смены вы написали, сколько всего вынули ' +
      'из денежного ящика — это поле «Выплаты из ящика». Сумма известна, а на что ' +
      'именно ушли эти деньги — нет. Пока не расписано, в отчёте о прибыли их не видно: ' +
      'программа не знает, товар это был, зарплата или аренда.</p>' +
      '<p><b>Что сделать.</b> Вспомните, на что уходили деньги из ящика, и запишите ' +
      'каждую трату своей кнопкой. Сумма «не расписано» будет уменьшаться, пока не ' +
      'дойдёт до нуля.</p></div>';

    h += '<div class="nav-group">Куда обычно уходят деньги из ящика</div>';
    h += '<div class="list">' +
      u.listRow({ icon: 'box', title: 'Купили товар за наличные',
        sub: 'впишите сумму в «Итоги дня» — это не расход, это закуп', tap: true,
        attrs: ' data-form="dayTotals" data-pre-date="' + esc(день) + '"' }) +
      u.listRow({ icon: 'supplier', title: 'Отдали долг поставщику',
        sub: 'тоже в «Итоги дня», поле «Погашение долгов»', tap: true,
        attrs: ' data-form="dayTotals" data-pre-date="' + esc(день) + '"' }) +
      u.listRow({ icon: 'receipt', title: 'Расход магазина',
        sub: 'аренда, обед, ГСМ, хозтовары — «Расход», счёт «Касса»', tap: true,
        attrs: ' data-form="moneyOut" data-pre-date="' + esc(день) + '"' }) +
      u.listRow({ icon: 'people', title: 'Выдали зарплату',
        sub: 'из журнала выплат — тогда она попадёт и в ведомость', tap: true,
        attrs: ' data-form="payoutRow" data-pre-date="' + esc(день) + '"' }) +
      u.listRow({ icon: 'truck', title: 'Увезли в сейф или банк',
        sub: 'это перевод, а не трата — прибыль он не меняет', tap: true,
        attrs: ' data-form="moveCash" data-pre-date="' + esc(день) + '"' }) +
      u.listRow({ icon: 'wallet', title: 'Владелец взял себе',
        sub: 'не расход магазина, но записать надо', tap: true,
        attrs: ' data-form="moneyDraw" data-pre-date="' + esc(день) + '"' }) +
      '</div>';

    if (дни.length) {
      h += '<div class="nav-group">По каким дням не сходится</div>';
      h += u.table('payoutDays', [
        { title: 'День', fn: function (r) { return esc(dateRu(r.date)); } },
        { title: 'Вынули из ящика', cls: 'num', fn: function (r) { return u.priv(r.payouts); } },
        { title: 'Уже расписано', cls: 'num', fn: function (r) { return u.priv(r.explained); } },
        { title: 'Не расписано', cls: 'num', fn: function (r) {
          return '<b class="c-orange">' + u.priv(r.left) + '</b>'; } }
      ], дни, { step: 12, empty: 'Всё расписано' });
    }

    h += '<div class="card-pad"><div class="form-hint">Если вспомнить не удаётся — ' +
      'не страшно. Проверьте, не завышены ли «выплаты из ящика» в той смене: ' +
      'бывает, что кассир написал больше, чем брал. Открыть смену можно в «Базе операций».' +
      '</div><button class="btn" data-go="ledger">Открыть базу операций</button></div>';

    u.sheet('Не расписано ' + money(chk.left) + ' из ящика', h);
    return null;
  };

  A['plan-paid'] = function (el) {
    var p = (S.state.plans || []).filter(function (x) { return x.id === el.dataset.id; })[0];
    if (!p) return 'Выплата не найдена.';
    p.status = 'Оплачена';
    p.paidAt = today();
    var next = makeNext(p);
    S.save(); refresh(); U().render();
    var day = dds().filter(function (r) { return E.isDay(r) && r.date === today(); })[0];
    if (day) {
      return 'Отмечено: ' + p.supplier + ' — ' + money(p.amount) + '.' + next + ' ' +
        'Не забудьте добавить эту сумму в «Погашение долгов ТП» за сегодня: ' +
        'сейчас там ' + money(day.debtPaid) + '.';
    }
    U().openForm('dayTotals', { date: today(), debtPaid: num(p.amount) });
    return 'Отмечено: ' + p.supplier + ' — ' + money(p.amount) + '.' + next + ' ' +
      'Вписал сумму в итоги дня — проверьте и сохраните.';
  };

  window.WM_EXTRA_CHANGE = function (el) {
    if (el.id === 'repMonth') { S.setSetting('reportMonth', el.value); return true; }
    return false;
  };

  /* ==========================================================================
     РЕГИСТРАЦИЯ ЭКРАНОВ
     ========================================================================== */
  /* Выбрали статью — счёт подставляется сам, тот же, с которого платили по ней
     в прошлый раз. Нельзя перебивать владельца: если он уже трогал поле счёта
     руками, его выбор остаётся. Перерисовывать всю форму ради этого тоже
     нельзя — набранное пропало бы. */
  (function () {
    function refit(el) {
      if (!el || !el.name || !el.closest) return;
      var box = el.closest('.sheet');
      if (!box) return;
      var acc = box.querySelector('select[name="account"]');
      if (!acc) return;
      if (el.name === 'account') { acc.dataset.touched = '1'; return; }
      if (el.name === 'fund') { el.dataset.touched = '1'; return; }
      if (el.name !== 'category' && el.name !== 'method') return;
      if (acc.dataset.touched === '1') return;
      var cat = box.querySelector('[name="category"]');
      var met = box.querySelector('[name="method"]');
      var cashless = met ? E.norm(met.value) !== 'наличные' : false;
      var want = accForCategory(cat ? cat.value : '', cashless);
      if (want && acc.value !== want) acc.value = want;
      // и конверт: «Аренда» → конверт «Аренда»
      var fnd = box.querySelector('select[name="fund"]');
      if (fnd && fnd.dataset.touched !== '1' && cat) {
        var wf = fundForCategory(cat.value);
        if (wf && fnd.value !== wf) fnd.value = wf;
      }
    }
    document.addEventListener('change', function (e) { refit(e.target); });
    document.addEventListener('input', function (e) { refit(e.target); });
  })();

  /* --------------------------------------------------------------------------
     НАКОПЛЕНИЯ

     Экран отвечает на один вопрос: хватит ли денег, когда придёт счёт.
     Сверху — сколько отложено всего, сколько ещё надо отложить в этом месяце
     и не съедает ли закуп больше положенного.
     -------------------------------------------------------------------------- */
  function viewFunds() {
    var u = U(), m = U().month ? U().month() : E.ymOf(today());
    var ft = E.fundTotals(funds(), dds(), null, m);
    var pc = E.purchaseCheck(dds(), S.settings, m);
    var t = ft.totals;

    var h = u.pageHead('Накопления', 'Чтобы в конце месяца было чем платить',
      '<button class="btn btn-primary" data-form="moveCash">' + ic('truck') +
      ' Отложить</button> <button class="btn" data-form="fundCard">' + ic('plus') +
      ' Новый конверт</button>');

    h += '<div class="stat-grid">' +
      u.stat('Отложено сейчас', u.priv(t.left), 'лежит в конвертах') +
      u.stat('Надо отложить в этом месяце', u.priv(t.short),
        t.short > 0 ? 'ещё не отложено' : 'план выполнен',
        t.short > 0 ? 'c-orange' : 'c-green') +
      u.stat('План на месяц', u.priv(t.plan), 'по всем конвертам') +
      '</div>';

    /* Закуп — главный пожиратель выручки. Если он выходит за рамки,
       откладывать будет не из чего, и это надо видеть заранее. */
    if (pc.revenue) {
      var bad = !pc.ok;
      h += '<div class="banner ' + (bad ? 'orange' : 'green') + '"><span>' +
        ic(bad ? 'warning' : 'check') + '</span><span>' +
        'На товар ушло <b>' + esc(money(pc.purchase)) + '</b> — это ' +
        esc(u.pct(pc.sharePct)) + ' выручки. ' +
        (bad
          ? 'Больше вашей планки в ' + esc(u.pct(pc.limitPct)) + ' на <b>' +
            esc(money(pc.over)) + '</b>. Столько же не хватит на аренду, зарплату и налоги — ' +
            'закупайте осторожнее или поднимайте наценку.'
          : 'Ваша планка — ' + esc(u.pct(pc.limitPct)) + ', до неё ещё ' +
            esc(money(pc.room)) + '. Планка меняется в настройках.') +
        '</span></div>';
    }

    if (!ft.rows.length) {
      return h + u.blank({ icon: 'safe', title: 'Конвертов пока нет',
        why: 'Конверт — это цель, под которую откладывают заранее: аренда, зарплата, ' +
          'налоги. Заведите первый, впишите, сколько откладывать в месяц, — ' +
          'и программа будет следить, чтобы к сроку деньги были.',
        actions: [{ name: 'Завести конверт', icon: 'plus', form: 'fundCard' }] });
    }

    h += u.card('Конверты', u.table('fundsT', [
      { title: 'На что', fn: function (r) { return esc(r.name) +
        (r.note ? '<br><small class="c-muted">' + esc(r.note) + '</small>' : ''); } },
      { title: 'План в месяц', cls: 'num', fn: function (r) {
        return r.plan ? u.priv(r.plan) : '<span class="c-muted">не задан</span>'; } },
      { title: 'Отложено в этом месяце', cls: 'num', fn: function (r) {
        return u.priv(r.putThisMonth) + (r.plan
          ? ' <small class="c-muted">' + u.pct(r.donePct) + '</small>' : ''); } },
      { title: 'Ещё отложить', cls: 'num', fn: function (r) {
        return r.toPut > 0 ? '<b class="c-orange">' + u.priv(r.toPut) + '</b>'
          : '<span class="c-green">хватает</span>'; } },
      { title: 'Лежит в конверте', cls: 'num', fn: function (r) {
        return '<b>' + u.priv(r.left) + '</b>'; } },
      { title: 'Потрачено', cls: 'num', fn: function (r) {
        return r.spent ? u.priv(r.spent) : '—'; } },
      { title: '', cls: 'center', fn: function (r) {
        return '<button class="btn btn-sm" data-edit="funds:' + esc(r.id) + ':fundCard">' +
          ic('edit', 16) + '</button> ' +
          '<button class="btn btn-sm" data-act="fund-put" data-id="' + esc(r.id) +
          '">Отложить</button>'; } }
    ], ft.rows, { step: 30, empty: 'Конвертов нет',
      total: [{ html: 'Всего' },
        { cls: 'num', html: u.priv(t.plan) },
        { cls: 'num', html: u.priv(t.putThisMonth) },
        { cls: 'num', html: t.short ? '<b class="c-orange">' + u.priv(t.short) + '</b>' : '—' },
        { cls: 'num', html: '<b>' + u.priv(t.left) + '</b>' },
        { cls: 'num', html: u.priv(t.spent) }, { html: '' }] }),
      'Деньги в конвертах лежат на настоящих счетах — конверт лишь помечает, что они заняты');

    /* Бюджеты. Отдельная карточка, потому что это про другое: конверт копит
       деньги, бюджет ставит потолок трате. Смешать их — запутать владельца. */
    var bt = E.budgetTotals(budgets(), dds(), m);
    var bh = '';
    if (bt.rows.length) {
      bh = u.table('budgetsT', [
        { title: 'Статья', fn: function (r) { return esc(r.label); } },
        { title: 'Лимит на месяц', cls: 'num', fn: function (r) { return u.priv(r.limit); } },
        { title: 'Потрачено', cls: 'num', fn: function (r) {
          return u.priv(r.spent) + ' <small class="c-muted">' + u.pct(r.pct) + '</small>'; } },
        { title: 'Осталось', cls: 'num', fn: function (r) {
          return r.over
            ? '<b class="c-red">перебор ' + u.priv(r.over) + '</b>'
            : '<b class="c-green">' + u.priv(r.left) + '</b>'; } },
        { title: '', cls: 'center', fn: function (r) {
          return '<button class="btn btn-sm" data-edit="budgets:' + esc(r.id) + ':budgetCard">' +
            ic('edit', 16) + '</button>'; } }
      ], bt.rows, { step: 30, empty: 'Лимитов нет',
        total: [{ html: 'Всего' }, { cls: 'num', html: u.priv(bt.totals.limit) },
          { cls: 'num', html: u.priv(bt.totals.spent) },
          { cls: 'num', html: bt.totals.over
            ? '<b class="c-red">перебор ' + u.priv(bt.totals.over) + '</b>'
            : '<b class="c-green">' + u.priv(bt.totals.left) + '</b>' }, { html: '' }] });
    } else {
      bh = '<div class="empty"><b>Лимитов пока нет</b><br>' +
        'Бюджет — это потолок траты по статье: «на обеды не больше 10 000 в месяц». ' +
        'Деньги он не двигает, просто предупреждает, когда разогналось.</div>';
    }
    h += u.card('Лимиты на месяц', bh +
      '<div class="card-pad"><button class="btn btn-primary" data-form="budgetCard">' +
      ic('plus') + ' Поставить лимит</button></div>',
      bt.totals.overCount
        ? '<span class="c-red">перебор по ' + bt.totals.overCount + ' статьям</span>'
        : 'Конверт копит деньги, бюджет ставит потолок трате');

    h += '<div class="banner blue"><span>' + ic('info') + '</span><span>' +
      'Конверт не создаёт новых денег и не меняет прибыль: он помечает переводы и расходы, ' +
      'которые и так есть. «Отложить» — это обычный перевод, например из кассы в сейф, ' +
      'с пометкой конверта. Заплатили аренду и отметили тот же конверт — он уменьшился.' +
      '</span></div>';
    return h;
  }

  function budgets() { return S.state.budgets || []; }

  FORMS.budgetCard = {
    title: 'Лимит на статью', icon: 'scale',
    editsInPlace: true,
    body: function (v) {
      var u = U(); v = v || {};
      return u.fieldRow('На какую статью', 'category', 'list', v.category || '',
        { options: categories(), placeholder: 'Обед, ГСМ, Расходники',
          hint: 'если поставить на группу («Коммунальные»), засчитаются и подстатьи' }) +
        u.fieldRow('Не больше, в месяц', 'limit', 'number', v.limit || '') +
        u.fieldRow('Заметка', 'note', 'text', v.note || '');
    },
    hint: 'Бюджет денег не двигает — он только следит, чтобы трата по статье ' +
      'не разогналась. Копить деньги заранее — это конверты, они выше.',
    save: function (v) {
      if (!E.txt(v.category)) return 'Выберите статью, на которую ставим лимит.';
      var bad = Q.checkAmount(v.limit); if (bad) return 'Лимит: ' + bad;
      var ed = U().editing();
      var same = budgets().filter(function (b) {
        return E.norm(b.category) === E.norm(v.category) && (!ed || b.id !== ed.id);
      })[0];
      if (same) return 'Лимит на «' + E.catLabel(same.category) + '» уже стоит — поправьте его.';
      var rec = { category: E.txt(v.category), limit: num(v.limit), note: E.txt(v.note) };
      if (ed) S.update(ed.coll, ed.id, rec); else S.add('budgets', rec);
      S.save(); refresh();
      return { ok: 'Лимит на «' + E.catLabel(rec.category) + '»: ' + money(rec.limit) + ' в месяц.' };
    }
  };

  FORMS.fundCard = {
    title: 'Конверт', icon: 'safe',
    editsInPlace: true,
    body: function (v) {
      var u = U(); v = v || {};
      return u.fieldRow('На что откладываем', 'name', 'text', v.name || '',
        { placeholder: 'Аренда, Зарплата, Налоги, На ремонт' }) +
        u.fieldRow('Сколько в месяц', 'plan', 'number', v.plan || '',
          { hint: 'сколько надо откладывать каждый месяц; 0 — если просто копите' }) +
        u.fieldRow('Где лежат деньги', 'account', 'select', v.account || accDefault(false),
          { options: accOptions(),
            hint: 'настоящий счёт, обычно сейф или расчётный счёт' }) +
        u.fieldRow('Заметка', 'note', 'text', v.note || '');
    },
    hint: 'Конверт — это цель, а не отдельный кошелёк. Деньги лежат на обычном счёте, ' +
      'а конверт показывает, сколько из них уже занято под аренду или зарплату.',
    save: function (v) {
      if (!E.txt(v.name)) return 'Впишите, на что откладываете.';
      var bad = Q.checkAmount(v.plan, { allowEmpty: true, allowZero: true });
      if (bad) return 'Сколько в месяц: ' + bad;
      var ed = U().editing();
      var same = funds().filter(function (f) {
        return E.norm(f.name) === E.norm(v.name) && (!ed || f.id !== ed.id);
      })[0];
      if (same) return 'Конверт «' + same.name + '» уже есть.';
      var rec = { name: E.txt(v.name), plan: num(v.plan),
        account: E.txt(v.account), note: E.txt(v.note) };
      if (ed) S.update(ed.coll, ed.id, rec); else S.add('funds', rec);
      S.save(); refresh();
      return { ok: 'Конверт «' + rec.name + '» сохранён.' };
    }
  };

  /* ==========================================================================
     БЫСТРЫЙ ВВОД: СУММА → СТАТЬЯ → ГОТОВО

     Обычная форма расхода — шесть полей, и это правильно, когда запись
     непростая. Но девять расходов из десяти в магазине одинаковые: обед,
     хозтовары, ГСМ. Ради них открывать форму и заполнять шесть полей —
     слишком долго, и владелец просто перестаёт записывать.

     Здесь три касания: набрал сумму, ткнул статью — записано. Всё остальное
     программа подставляет сама: дата сегодняшняя, счёт — тот, с которого
     платили по этой статье в прошлый раз, конверт — по названию статьи.

     Статьи показываем те, которыми пользуются чаще всего: программа считает
     их по вашим же записям, а не по списку из справочника.
     ========================================================================== */
  var FAST_SUM = '';

  // Чем чаще статьёй пользуются, тем выше она стоит
  function topCategories(n) {
    var by = {};
    dds().forEach(function (r) {
      if (!E.isExpense(r)) return;
      var c = E.txt(r.category);
      if (!c || E.notACost(c)) return;
      by[c] = (by[c] || 0) + 1;
    });
    var list = Object.keys(by).sort(function (a, b) { return by[b] - by[a]; });
    // Добавим справочные статьи, если своих записей ещё мало
    categories().forEach(function (c) {
      if (list.indexOf(c) < 0 && !E.notACost(c)) list.push(c);
    });
    return list.slice(0, n || 12);
  }

  function viewFast() {
    var u = U();
    var сумма = FAST_SUM;
    var число = сумма ? num(window.WMNum.calc(сумма) || 0) : 0;

    var h = u.pageHead('Быстрый ввод', 'Сумма, статья — и записано',
      '<button class="btn" data-form="moneyOut">' + ic('receipt') + ' Обычная форма</button>');

    h += '<div class="fast-sum' + (число ? '' : ' empty') + '">' +
      (число ? esc(money(число)) : '0 ₽') + '</div>';
    if (число) {
      var acc = accounts().filter(function (a) { return a.id === accForCategory('', false); })[0];
      h += '<div class="fast-note">Спишется со счёта «' +
        esc(acc ? acc.name : 'по умолчанию') + '» сегодняшним числом. ' +
        'Счёт подставится точнее, когда выберете статью.</div>';
    } else {
      h += '<div class="fast-note">Наберите сумму и нажмите статью — запись готова.</div>';
    }

    h += '<div class="fast-pad">';
    ['7', '8', '9', '4', '5', '6', '1', '2', '3', '00', '0', '⌫'].forEach(function (k) {
      h += '<button class="fast-key' + (k === '⌫' ? ' wide-del' : '') +
        '" data-act="fast-key" data-key="' + esc(k) + '">' + esc(k) + '</button>';
    });
    h += '</div>';

    h += '<div class="quick fast-quick">' +
      [100, 500, 1000, 5000].map(function (q) {
        return '<button class="btn" data-act="fast-add" data-add="' + q + '">+' +
          E.fmtNum(q) + '</button>';
      }).join('') +
      (число ? ' <button class="btn" data-act="fast-key" data-key="C">Стереть</button>' : '') +
      '</div>';

    var cats = topCategories(12);
    h += u.card('На что потратили', '<div class="fast-cats">' +
      cats.map(function (c) {
        return '<button class="btn fast-cat' + (число ? ' btn-primary' : '') +
          '" data-act="fast-cat" data-cat="' + encodeURIComponent(c) + '"' +
          (число ? '' : ' disabled') + '>' +
          esc(E.catLabel(c)) + '</button>';
      }).join('') + '</div>',
      число ? 'Нажмите статью — запись сохранится' : 'Сначала наберите сумму');

    var сегодня = dds().filter(function (r) {
      return E.isExpense(r) && E.txt(r.date) === today();
    });
    if (сегодня.length) {
      h += u.card('Записано сегодня', u.table('fastToday', [
        { title: 'Статья', fn: function (r) { return esc(E.catLabel(r.category)); } },
        { title: 'Счёт', fn: function (r) { return esc(accName(r.account) || '—'); } },
        { title: 'Сумма', cls: 'num', fn: function (r) { return u.priv(r.amount); } },
        { title: '', cls: 'center', fn: function (r) {
          return u.rowMenu('dds', r.id, { form: 'moneyOut' }); } }
      ], сегодня.slice().reverse(), { step: 20, empty: '' }),
        'Ошиблись — поправьте здесь же');
    }
    return h;
  }

  var VIEWS = window.WM_EXTRA_VIEWS = window.WM_EXTRA_VIEWS || [];
  VIEWS.push(
    { id: 'pulse', icon: 'gauge', name: 'Пульт', group: 'Каждый день', render: viewPulse },
    { id: 'morning', icon: 'calculator', name: 'Утро: сверка кассы', group: 'Каждый день', render: viewMorning },
    { id: 'evening', icon: 'moon', name: 'Вечер: итоги дня', group: 'Каждый день', render: viewEvening },
    { id: 'finpay', icon: 'calendar', name: 'План выплат', group: 'Каждый день', render: viewPlans },
    { id: 'ledger', icon: 'list', name: 'База операций', group: 'Деньги', render: viewLedger },
    { id: 'cashiers', icon: 'people', name: 'Кассиры и расхождения', group: 'Деньги', render: viewCashiers },
    { id: 'debtors', icon: 'notebook', name: 'Долги покупателей', group: 'Деньги', render: viewDebtors },
    { id: 'finreport', icon: 'doc', name: 'Отчёт за месяц', group: 'Деньги', render: viewReport },
    { id: 'funds', icon: 'safe', name: 'Накопления', group: 'Деньги', render: viewFunds },
    { id: 'fast', icon: 'plus', name: 'Быстрый ввод', group: 'Каждый день', render: viewFast }
  );
})();

/* ============================================================================
   РЕВИЗОР: программа проверяет себя сама

   Владелец попросил, чтобы «внутри был ИИ, который анализирует ошибки,
   говорит о них и исправляет». Настоящую языковую модель в папку, которая
   открывается двойным щелчком без интернета, не положить — это десятки
   гигабайт. Но то, что он описал, делается иначе и надёжнее: правилами.
   Правило не устаёт, не отвлекается и не ошибается через раз.

   До сих пор 34 правила проверяли ВЫДУМАННЫЕ магазины у разработчика. У
   владельца они не работали вовсе. Ревизор переносит ту же проверку на его
   собственные данные и запускает её постоянно.

   Три вещи, которые он делает:

     1. Гоняет встроенные проверки — те самые, что стерегут деньги.
     2. Гоняет правила, собранные САМИМ ВЛАДЕЛЬЦЕМ, без строчки кода.
     3. Каждую находку объясняет словами и, где может, предлагает поправку.

   КОНСТРУКТОР ПРАВИЛ — «как лего»

   Правило собирается из готовых кубиков, выбором из списков:

       Если [расхождение по кассе] [больше] [1000 ₽] → [тревога]: «текст»

   Никакого «введите формулу» и никакого выполнения чужого кода. Список
   показателей закрытый — что в нём есть, то владелец и может взять. Это
   не ограничение ради простоты, а ради надёжности: правило, собранное из
   проверенных кубиков, не может сломать расчёты. Программу, которая считает
   чужие деньги, нельзя делать полем для свободного программирования.
   ========================================================================== */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) {
    module.exports = factory(require('./engine.js'));
  } else root.WMRevizor = factory(root.WM);
})(typeof self !== 'undefined' ? self : this, function (E) {
  'use strict';

  function num(v) { return E.num(v); }
  function txt(v) { return E.txt(v); }
  function руб(v) { return E.fmtMoney(v); }
  function round(v) { return E.safeRound(v); }
  /* Дату показываем по-русски. Движок такого не отдаёт, а тащить сюда экранный
     слой нельзя: Ревизор должен считаться и без браузера, в проверках. */
  function дата(iso) {
    var m = txt(iso).match(/(\d{4})-(\d{2})-(\d{2})/);
    return m ? m[3] + '.' + m[2] + '.' + m[1] : txt(iso);
  }

  /* --- Кубики: что можно измерить ---------------------------------------------
     Каждый показатель знает своё имя человеческими словами, единицу и то, как
     его посчитать. Добавил показатель сюда — он сразу появился в конструкторе
     у владельца. Ничего больше менять не надо.

     scope: 'смена' — считается по каждой смене отдельно, и находка будет на
     конкретную смену. 'итог' — одно число за весь период.
     -------------------------------------------------------------------------- */
  var МЕТРИКИ = [
    { id: 'diff', scope: 'смена', unit: '₽', name: 'Расхождение по кассе',
      hint: 'насколько факт в ящике разошёлся с расчётом, без знака',
      calc: function (c) { return Math.abs(c.diff); } },
    { id: 'short', scope: 'смена', unit: '₽', name: 'Недостача по кассе',
      hint: 'в ящике меньше, чем должно быть',
      calc: function (c) { return c.short; } },
    { id: 'over', scope: 'смена', unit: '₽', name: 'Излишек по кассе',
      hint: 'в ящике больше, чем должно быть',
      calc: function (c) { return c.over; } },
    { id: 'collectShort', scope: 'смена', unit: '₽', name: 'Не доехало до сейфа',
      hint: 'касса пробила инкассацию больше, чем пересчитали в сейфе',
      calc: function (c) { return c.collectShort; } },
    { id: 'wayDiff', scope: 'смена', unit: '₽', name: 'Терминал против кассы',
      hint: 'карта плюс QR плюс телефон не сошлись с Z-безналом',
      calc: function (c) { return Math.abs(c.wayDiff); } },
    { id: 'payouts', scope: 'смена', unit: '₽', name: 'Выплаты из ящика за смену',
      hint: 'сколько денег выдали из кассы',
      calc: function (c) { return c.payouts; } },
    { id: 'revenue', scope: 'смена', unit: '₽', name: 'Выручка за смену',
      hint: 'наличными и безналом, за вычетом возвратов',
      calc: function (c) { return c.revenue; } },
    { id: 'avgCheck', scope: 'смена', unit: '₽', name: 'Средний чек',
      hint: 'выручка, делённая на число чеков',
      calc: function (c) { return c.avgCheck; } },
    { id: 'factCash', scope: 'смена', unit: '₽', name: 'Осталось в ящике',
      hint: 'сколько денег пересчитали при закрытии',
      calc: function (c) { return c.factCash; } },
    { id: 'voided', scope: 'смена', unit: 'шт', name: 'Аннулированных чеков',
      hint: 'много аннулирований — повод спросить кассира',
      calc: function (c) { return c.voided; } },
    { id: 'returns', scope: 'смена', unit: '₽', name: 'Возвраты покупателям',
      hint: 'сколько денег вернули за смену',
      calc: function (c) { return c.returns; } },

    { id: 'cashInTill', scope: 'итог', unit: '₽', name: 'Наличных в ящиках сейчас',
      hint: 'много денег в кассе — повод увезти в сейф',
      calc: function (t) { return t.cashInTill; } },
    { id: 'cashTotal', scope: 'итог', unit: '₽', name: 'Всего наличных',
      hint: 'ящики и сейф вместе',
      calc: function (t) { return t.cashTotal; } },
    { id: 'shortSum', scope: 'итог', unit: '₽', name: 'Недостач за период',
      hint: 'сколько всего не хватило по всем сменам',
      calc: function (t) { return t.shortSum; } },
    { id: 'revenueSum', scope: 'итог', unit: '₽', name: 'Выручка за период',
      hint: 'по всем сменам',
      calc: function (t) { return t.revenueSum; } },
    { id: 'payoutGap', scope: 'итог', unit: '₽', name: 'Не расписано, куда ушли деньги',
      hint: 'прошло через ящик и нигде не объяснено',
      calc: function (t) { return Math.abs(t.tillGap); } },
    { id: 'journalGap', scope: 'итог', unit: '₽', name: 'Деньги не сходятся',
      hint: 'журнал проводок не даёт ноль — деньги взялись из воздуха или пропали',
      calc: function (t) { return Math.abs(t.journalGap); } }
  ];

  function метрика(id) {
    for (var i = 0; i < МЕТРИКИ.length; i++) if (МЕТРИКИ[i].id === txt(id)) return МЕТРИКИ[i];
    return null;
  }

  var СРАВНЕНИЯ = [
    { id: '>', name: 'больше', test: function (a, b) { return a > b; } },
    { id: '>=', name: 'больше или равно', test: function (a, b) { return a >= b; } },
    { id: '<', name: 'меньше', test: function (a, b) { return a < b; } },
    { id: '<=', name: 'меньше или равно', test: function (a, b) { return a <= b; } },
    { id: '=', name: 'равно', test: function (a, b) { return Math.abs(a - b) < 0.005; } },
    { id: '!=', name: 'не равно', test: function (a, b) { return Math.abs(a - b) >= 0.005; } }
  ];
  function сравнение(id) {
    for (var i = 0; i < СРАВНЕНИЯ.length; i++) if (СРАВНЕНИЯ[i].id === txt(id)) return СРАВНЕНИЯ[i];
    return null;
  }

  var УРОВНИ = [
    { id: 'alarm', name: 'Тревога', rank: 3 },
    { id: 'warn', name: 'Внимание', rank: 2 },
    { id: 'note', name: 'Заметка', rank: 1 }
  ];
  function уровень(id) {
    for (var i = 0; i < УРОВНИ.length; i++) if (УРОВНИ[i].id === txt(id)) return УРОВНИ[i];
    return УРОВНИ[1];
  }

  /* Правило словами — чтобы владелец видел, что именно он собрал, ещё до
     того, как нажмёт «Сохранить». Кубики должны читаться как фраза. */
  function ruleText(rule) {
    var м = метрика(rule && rule.metric), с = сравнение(rule && rule.op);
    if (!м || !с) return 'Правило собрано не до конца';
    var знач = м.unit === '₽' ? руб(rule.value) : E.fmtNum(rule.value, 0) + ' ' + м.unit;
    return 'Если «' + м.name + '» ' + с.name + ' ' + знач + ' — ' +
      уровень(rule.level).name.toLowerCase();
  }

  /* --- Что считаем один раз на весь прогон ------------------------------------ */
  function итоги(rows, accounts) {
    var b = E.accountBalances(rows || [], accounts || []);
    var j = E.journal(rows || [], accounts || []);
    var t = E.totals(rows || []);
    return {
      cashInTill: b.totals.till, cashTotal: b.totals.cash,
      shortSum: t.short, revenueSum: t.revenue,
      tillGap: j.tillGap, journalGap: j.total,
      journal: j, balances: b, totals: t
    };
  }

  /* --- Встроенные проверки -----------------------------------------------------
     Это не «правила владельца», а то, что нарушаться не должно никогда. Их
     нельзя выключить: они стерегут сами деньги, а не вкусы магазина.
     -------------------------------------------------------------------------- */
  function встроенные(rows, accounts, settings, t) {
    var out = [];
    function нашли(o) { out.push(o); }

    if (Math.abs(t.journalGap) >= 0.005) {
      нашли({ level: 'alarm', key: 'journal',
        title: 'Деньги не сходятся на ' + руб(Math.abs(t.journalGap)),
        why: 'У каждого движения денег две стороны: откуда ушло и куда пришло. ' +
          'Сложили все стороны — ноль не получился. Значит, где-то деньги взялись ' +
          'из воздуха или пропали молча.',
        what: 'Такого быть не должно ни при каких записях: это ошибка в самой ' +
          'программе, а не в ваших данных. Сохраните копию базы и покажите её ' +
          'разработчику.',
        go: 'ledger' });
    }
    if (Math.abs(t.tillGap) >= 1) {
      нашли({ level: 'warn', key: 'tillgap',
        title: 'Через ящик прошло ' + руб(Math.abs(t.tillGap)) + ' без объяснения',
        why: 'Смена объявила, сколько денег прошло через ящик — выплаты, инкассация, ' +
          'внесения. Записи объясняют это с другой стороны. Они не сошлись.',
        what: t.tillGap > 0
          ? 'Скорее всего, выплаты из ящика не расписаны по статьям: деньги выдали, ' +
            'а на что — не записали.'
          : 'Скорее всего, это внесение размена, у которого не указано, откуда его ' +
            'взяли. Откройте смену и заполните «Внесение взяли со счёта» — ' +
            'иначе в сейфе останутся деньги, которых там уже нет.',
        go: 'ledger' });
    }

    var смен = 0;
    (rows || []).forEach(function (r) {
      if (!E.isShift(r)) return;
      смен++;
      var c = E.shiftCalc(r);
      var подпись = дата(r.date) + ', ' + (txt(r.till) || 'касса') + ', ' + (txt(r.shift) || 'смена');

      if (!c.collectOk) {
        нашли({ level: 'alarm', key: 'collect:' + txt(r.id), id: txt(r.id),
          title: 'До сейфа не доехало ' + руб(c.collectShort),
          why: подпись + '. Касса пробила инкассацию ' + руб(c.collected) +
            ', а пересчитали в сейфе ' + руб(c.collectedFact) + '.',
          what: 'Если пересчитали верно — это недостача, и разбираться надо с людьми. ' +
            'Если ошиблись при вводе — поправьте смену.',
          go: 'cashiers' });
      }
      if (!c.wayOk) {
        нашли({ level: 'warn', key: 'way:' + txt(r.id), id: txt(r.id),
          title: 'Терминал и касса разошлись на ' + руб(Math.abs(c.wayDiff)),
          why: подпись + '. Карта, QR и телефон в сумме дали ' + руб(c.byWay) +
            ', а Z-безнал — ' + руб(c.zCashless) + '.',
          what: 'Это надо разобрать сегодня: завтра концов не найти.',
          go: 'cashiers' });
      }
      /* Расхождение, которое разбор умеет объяснить, показываем вместе с
         его подсказкой: не просто «не сошлось», а какое число поправить. */
      var крит = num(settings && settings.diffCrit) || 1000;
      if (!c.ok && Math.abs(c.diff) >= крит) {
        var f = E.shiftFix(c);
        var совет = f.reason || (f.list.length
          ? 'Чтобы сошлось, хватит поправить одно число: «' + f.list[0].name + '» вместо ' +
            руб(f.list[0].now) + ' должно быть ' + руб(f.list[0].need) + '.'
          : '');
        нашли({ level: f.big ? 'alarm' : 'warn', key: 'diff:' + txt(r.id), id: txt(r.id),
          title: (c.diff < 0 ? 'Недостача ' : 'Излишек ') + руб(Math.abs(c.diff)),
          why: подпись + '. Должно было остаться ' + руб(c.expected) +
            ', насчитали ' + руб(c.factCash) + '.',
          what: совет, go: 'cashiers' });
      }
    });

    if (!смен) {
      нашли({ level: 'note', key: 'noshifts',
        title: 'Смен пока нет',
        why: 'Ревизор проверяет то, что записано. Пока смен нет, проверять нечего.',
        what: 'Запишите первую смену — дальше он будет следить сам.',
        go: 'morning' });
    }
    return out;
  }

  /* --- Правила владельца -------------------------------------------------------
     Собраны из кубиков. Считаются ровно так же, как встроенные, но текст
     пишет владелец: он знает свой магазин лучше.
     -------------------------------------------------------------------------- */
  function свои(rows, rules, t) {
    var out = [];
    (rules || []).forEach(function (rule) {
      if (rule.off) return;
      var м = метрика(rule.metric), с = сравнение(rule.op);
      if (!м || !с) return;
      var порог = num(rule.value);

      if (м.scope === 'итог') {
        var знач = round(м.calc(t));
        if (!с.test(знач, порог)) return;
        out.push({ level: txt(rule.level) || 'warn', key: 'own:' + txt(rule.id), own: true,
          ruleId: txt(rule.id),
          title: txt(rule.title) || м.name,
          why: м.name + ': ' + (м.unit === '₽' ? руб(знач) : E.fmtNum(знач, 0) + ' ' + м.unit) +
            '. Ваше правило: ' + ruleText(rule) + '.',
          what: txt(rule.what), go: txt(rule.go) || 'ledger' });
        return;
      }

      (rows || []).forEach(function (r) {
        if (!E.isShift(r)) return;
        var c = E.shiftCalc(r);
        var знач2 = round(м.calc(c));
        if (!с.test(знач2, порог)) return;
        var подпись = дата(r.date) + ', ' +
          (txt(r.till) || 'касса') + ', ' + (txt(r.shift) || 'смена');
        out.push({ level: txt(rule.level) || 'warn', key: 'own:' + txt(rule.id) + ':' + txt(r.id),
          own: true, ruleId: txt(rule.id), id: txt(r.id),
          title: txt(rule.title) || м.name,
          why: подпись + '. ' + м.name + ': ' +
            (м.unit === '₽' ? руб(знач2) : E.fmtNum(знач2, 0) + ' ' + м.unit) +
            '. Ваше правило: ' + ruleText(rule) + '.',
          what: txt(rule.what), go: txt(rule.go) || 'cashiers' });
      });
    });
    return out;
  }

  /* --- Главный прогон ---------------------------------------------------------- */
  function check(state, settings) {
    var st = state || {};
    var rows = st.dds || [];
    var accounts = st.accounts || [];
    var t = итоги(rows, accounts);
    var найдено = встроенные(rows, accounts, settings || {}, t)
      .concat(свои(rows, st.rules || [], t));

    // Сверху самое важное, внутри уровня — по сумме в заголовке
    найдено.sort(function (a, b) {
      return уровень(b.level).rank - уровень(a.level).rank;
    });
    var счёт = { alarm: 0, warn: 0, note: 0 };
    найдено.forEach(function (f) { счёт[f.level] = (счёт[f.level] || 0) + 1; });
    return {
      findings: найдено, counts: счёт,
      ok: !счёт.alarm && !счёт.warn,
      clean: !найдено.length,
      totals: t
    };
  }

  return {
    МЕТРИКИ: МЕТРИКИ, СРАВНЕНИЯ: СРАВНЕНИЯ, УРОВНИ: УРОВНИ,
    metric: метрика, op: сравнение, level: уровень,
    ruleText: ruleText, check: check, totals: итоги
  };
});

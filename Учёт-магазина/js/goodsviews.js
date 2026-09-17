/* ============================================================================
   КОНТУР 2: товарная аналитика из выгрузок 1С.
   Склад, заказы, сроки годности, списания, неликвиды, группы, рейтинг по
   прибыли, полки, возвраты, ABC, цены поставщиков, поставки.

   Все данные этих экранов лежат в памяти и приходят из файлов 1С. Ручную
   кассу, зарплаты и долг магазина они не трогают: закрыли программу —
   аналитика ушла, учёт остался.
   ========================================================================== */
(function () {
  'use strict';
  var E = window.WM, S = window.WMStore, G = window.WMGoods;

  function U() { return window.WMUI; }
  function FLT() { return window.WMFilter; }
  function D() { return U().data(); }
  function C() { return U().calc(); }
  function esc(s) { return U().esc(s); }
  function ic(n, size) { return U().ic(n, size); }
  function num(v) { return E.num(v); }
  function money(v) { return E.fmtMoney(v); }
  function dateRu(d) { return U().dateRu(d); }

  // Единая заглушка: какого отчёта не хватает и где его взять
  function need(title, sub, what) {
    var u = U();
    return u.pageHead(title, sub) +
      '<div class="card"><div class="empty"><b>Нужна выгрузка из 1С</b><br>' +
      'Этот экран считается по отчёту <b>' + esc(what) + '</b>.<br>' +
      'Выгрузите его из 1С и загрузите на экране «Данные и копии» — ' +
      'имя файла значения не имеет, программа смотрит внутрь.<br><br>' +
      'На кассу, зарплаты и долг магазина это никак не влияет: ' +
      'товарная аналитика живёт отдельно.</div>' +
      '<div class="card-pad"><button class="btn btn-primary" data-go="data">' + ic('folder') + ' Загрузить выгрузки</button></div></div>';
  }

  /* ==========================================================================
     ПОИСК И ПОДСВЕТКА

     hl(id, текст) — показать название с подсветкой того, что нашли. Владелец
     ищет «моло 3.2», видит десять строк и должен понимать, за что зацепилось
     в каждой. Без подсветки список выглядит случайным.
     ========================================================================== */
  function hl(id, value) { return FLT().highlight(value, FLT().text(id)); }

  /* Числа строки для поиска вида «>1000». Каждый экран сам решает, какие его
     числа имеют смысл: на складе это остаток и деньги на полке, в рейтинге —
     выручка и прибыль. */
  function nums() {
    var list = Array.prototype.slice.call(arguments);
    return function (r) {
      return list.map(function (f) { return num(r[f]); });
    };
  }

  /* --- Склад ------------------------------------------------------------------ */
  function viewStock() {
    var u = U(), d = D(), c = C();
    if (!d.stock.length) return need('Склад', 'Что лежит на полках и сколько это стоит', 'Остатки номенклатуры');
    var t = c.stock;
    var h = u.pageHead('Склад', u.nf(t.sku) + ' позиций из 1С',
      '<button class="btn" data-act="export-screen">' + ic('download') + ' В Excel</button>');
    h += snapNote(d.stockTaken, 'Остатки');

    h += '<div class="stat-grid">' +
      u.stat('Товара на складе', u.priv(t.buySum), 'по себестоимости') +
      u.stat('В розничных ценах', u.priv(t.retailSum), 'если продать всё') +
      u.stat('Наценка', u.pct(E.div(t.retailSum - t.buySum, t.buySum) * 100), 'в среднем по складу') +
      u.stat('Закончилось', u.nf(t.zeroSku), 'позиций с нулевым остатком',
        t.zeroSku ? 'c-orange' : 'c-green') +
      '</div>';

    var defs = [
      { key: 'group', name: 'Группа', auto: function (r) { return r.group; }, limit: 14 },
      { key: 'left', name: 'Остаток', options: [
        { v: 'zero', name: 'Закончилось', test: function (r) { return num(r.qty) <= 0; } },
        { v: 'low', name: 'Мало (до 3)', test: function (r) { return num(r.qty) > 0 && num(r.qty) <= 3; } },
        { v: 'has', name: 'Есть', test: function (r) { return num(r.qty) > 3; } }
      ] },
      { key: 'mk', name: 'Наценка', options: [
        { v: 'no', name: 'Нет наценки', test: function (r) { return num(r.buyPrice) && num(r.retailPrice) <= num(r.buyPrice); } },
        { v: 'lo', name: 'До 20%', test: function (r) {
          var m = E.div(num(r.retailPrice) - num(r.buyPrice), num(r.buyPrice)) * 100;
          return num(r.buyPrice) > 0 && m > 0 && m < 20; } },
        { v: 'hi', name: 'Больше 40%', test: function (r) {
          return E.div(num(r.retailPrice) - num(r.buyPrice), num(r.buyPrice)) * 100 >= 40; } }
      ] }
    ];
    var rows = FLT().apply('stock', d.stock, defs,
      function (r) { return r.name + ' ' + (r.barcode || '') + ' ' + (r.group || ''); },
      nums('qty', 'buyPrice', 'retailPrice', 'buySum'));
    h += FLT().bar('stock', defs, d.stock, { search: 'товар, штрихкод, группа' });

    h += u.card('Остатки', FLT().note(rows.length, d.stock.length) + u.table('stockT', [
      { title: 'Товар', fn: function (r) { return hl('stock', r.name); } },
      { title: 'Группа', fn: function (r) { return esc(r.group || '—'); } },
      { title: 'Остаток', cls: 'num', fn: function (r) { return u.nf(r.qty, 2); } },
      { title: 'Закупка', cls: 'num', fn: function (r) { return u.priv(r.buyPrice); } },
      { title: 'Розница', cls: 'num', fn: function (r) { return u.priv(r.retailPrice); } },
      { title: 'Наценка', cls: 'num', fn: function (r) {
        var m = E.safeRound(E.div(num(r.retailPrice) - num(r.buyPrice), num(r.buyPrice)) * 100);
        return '<span class="' + (m >= 25 ? 'c-green' : m > 0 ? '' : 'c-red') + '">' + u.pct(m) + '</span>'; } },
      { title: 'Денег на полке', cls: 'num', fn: function (r) { return u.priv(r.buySum); } }
    ], rows, { step: 50 }));
    return h;
  }

  /* --- Заказы: что заканчивается ----------------------------------------------- */
  function viewOrders() {
    var u = U(), d = D(), c = C();
    if (!d.sales.length || !d.stock.length) {
      return need('Заказы', 'Что заканчивается и у кого дешевле купить', 'Продажи и Остатки номенклатуры');
    }
    /* Скорость продаж считается за ВЫБРАННЫЙ период, а не за последнюю
       выгрузку: иначе «продаём 3 штуки в день» бралось бы из одного месяца,
       а заказ делался бы по другому. */
    var sel = U().anaPick(d.sales);
    var days = anaDays(d);
    var list = E.ropList(c.salesMerged, d.stock, days, S.settings, c.bestPrices);
    var h = u.pageHead('Заказы', 'Что заканчивается и сколько заказать · ' + anaTitle(),
      '<button class="btn" data-act="export-screen">' + ic('download') + ' В Excel</button>');
    h += anaBar('sales');
    h += snapNote(d.stockTaken, 'Остатки');

    var money0 = list.reduce(function (a, r) { return a + num(r.orderSum); }, 0);
    h += '<div class="stat-grid">' +
      u.stat('Пора заказать', u.nf(list.length), 'позиций ниже точки заказа',
        list.length ? 'c-orange' : 'c-green') +
      u.stat('На сумму', u.priv(money0), 'по лучшим ценам поставщиков') +
      u.stat('Расход в день', u.nf(E.safeRound(list.reduce(function (a, r) { return a + num(r.demand); }, 0)), 1),
        'штук по этим позициям') +
      '</div>';

    /* Фильтры тут не украшение: список заказа читают стоя у полки, и «покажи
       только то, что кончится завтра» — самый частый вопрос к нему. */
    var defs = [{ key: 'urg', name: 'Срочность', options: [
      { v: 'now', name: 'Уже кончилось', test: function (r) { return num(r.stock) <= 0; } },
      { v: 'day', name: 'Хватит на день', test: function (r) {
        return r.daysLeft != null && r.daysLeft <= 1 && num(r.stock) > 0; } },
      { v: 'week', name: 'Меньше недели', test: function (r) {
        return r.daysLeft != null && r.daysLeft <= 7; } }
    ] }, { key: 'sup', name: 'Поставщик', auto: function (r) { return r.supplier; }, limit: 12 }];
    var rows = FLT().apply('orders', list, defs,
      function (r) { return r.name + ' ' + (r.supplier || ''); },
      nums('stock', 'daysLeft', 'order', 'price', 'orderSum'));
    h += FLT().bar('orders', defs, list, { search: 'товар, поставщик' });

    h += u.card('Заказать', FLT().note(rows.length, list.length) + u.table('ropT', [
      { title: 'Товар', fn: function (r) { return hl('orders', r.name); } },
      { title: 'Остаток', cls: 'num', fn: function (r) { return u.nf(r.stock, 2); } },
      { title: 'Хватит на', cls: 'num', fn: function (r) {
        return r.daysLeft == null ? '—' : '<span class="' + (r.daysLeft <= 2 ? 'c-red' : '') + '">' +
          u.nf(r.daysLeft, 1) + ' дн.</span>'; } },
      { title: 'Заказать', cls: 'num', fn: function (r) { return '<b>' + u.nf(r.order, 2) + '</b>'; } },
      { title: 'У кого дешевле', fn: function (r) { return hl('orders', r.supplier || '—'); } },
      { title: 'Цена', cls: 'num', fn: function (r) { return u.priv(r.price); } },
      { title: 'Сумма', cls: 'num', fn: function (r) { return u.priv(r.orderSum); } }
    ], rows, { step: 50, empty: 'Заказывать нечего — всего хватает.' }));
    return h;
  }

  /* --- Списания: синхронизация с отчётом 1С --------------------------------------
     Отчёт «Причины списания» перечитывается целиком: что было в прошлом файле,
     но пропало в новом, из аналитики уходит — иначе на экране копились бы
     позиции, которых в 1С уже нет. */
  /* ==========================================================================
     ПЕРИОД АНАЛИЗА — одна панель на все товарные экраны

     Период один на весь контур: выбрали сентябрь — сентябрь везде. Иначе
     владелец сравнил бы рейтинг за сентябрь с ABC за октябрь и не заметил.

     ЧЕСТНО О ТОЧНОСТИ. Отчёты 1С — своды за период: одна строка на товар за
     весь период выгрузки, дней внутри неё нет. Поэтому выбрать можно любые
     даты, но точность будет такой, как часто владелец выгружает файлы.
     Программа говорит об этом прямо, а не рисует уверенные цифры.
     ========================================================================== */
  /* Дата с годом. В выборе периода «1 сен – 30 сен» не говорит, какого года,
     а сравнивать год к году владельцу нужно постоянно. */
  function датаПолная(iso) {
    var m = String(iso || '').match(/(\d{4})-(\d{2})-(\d{2})/);
    return m ? m[3] + '.' + m[2] + '.' + m[1] : String(iso || '');
  }

  function anaFrom() { return E.txt(S.settings.anaFrom); }
  function anaTo() { return E.txt(S.settings.anaTo); }

  function anaPresets() {
    var t = U().today(), y = t.slice(0, 4), m = t.slice(0, 7);
    var prev = new Date(t.slice(0, 8) + '01');
    prev.setUTCMonth(prev.getUTCMonth() - 1);
    var pm = prev.toISOString().slice(0, 7);
    var last = new Date(Date.UTC(prev.getUTCFullYear(), prev.getUTCMonth() + 1, 0))
      .toISOString().slice(0, 10);
    return [
      { name: 'Всё', from: '', to: '' },
      { name: 'Этот месяц', from: m + '-01', to: t },
      { name: 'Прошлый месяц', from: pm + '-01', to: last },
      { name: 'Этот год', from: y + '-01-01', to: t }
    ];
  }

  /* Кнопки самих загруженных выгрузок. Это главное: попадание в них —
     единственный способ получить точную цифру, и владелец должен видеть,
     из чего он выбирает. */
  function anaLoaded(kind) {
    var c = C(), list = (c.periods && c.periods[kind]) || [];
    if (!list.length) return [];
    return list.filter(function (p) { return p.from && p.to; });
  }

  function anaBar(kind) {
    var u = U(), f = anaFrom(), t = anaTo();
    var чипы = anaPresets().map(function (p) {
      var on = (p.from === f && p.to === t);
      return '<button class="btn btn-sm' + (on ? ' btn-primary' : '') +
        '" data-act="ana-period" data-from="' + esc(p.from) + '" data-to="' + esc(p.to) +
        '">' + esc(p.name) + '</button>';
    }).join('');

    var h = '<div class="quick ana-bar">' + чипы +
      '<label class="inline-label">с&nbsp;<input type="date" id="anaFrom" value="' +
      esc(f) + '"></label>' +
      '<label class="inline-label">по&nbsp;<input type="date" id="anaTo" value="' +
      esc(t) + '"></label></div>';

    var загр = anaLoaded(kind);
    if (загр.length > 1) {
      h += '<div class="quick ana-loaded"><span class="filter-name">Выгрузки</span>' +
        загр.map(function (p) {
          var on = (p.from === f && p.to === t);
          return '<button class="btn btn-sm' + (on ? ' btn-primary' : '') +
            '" data-act="ana-period" data-from="' + esc(p.from) + '" data-to="' + esc(p.to) +
            '">' + esc(датаПолная(p.from)) + ' – ' + esc(датаПолная(p.to)) + '</button>';
        }).join('') + '</div>';
    }
    return h;
  }

  /* Сколько дней в выбранном периоде. От этого числа считается скорость
     продаж («сколько уходит в день»), а по ней — сколько заказывать. Ошибка
     здесь заказывает не тот товар, поэтому дни берём из того же периода,
     что и сами продажи, а не из последней выгрузки. */
  function anaDays(d) {
    var f = anaFrom(), t = anaTo();
    if (!f && !t) {
      var cov = (C().cover) || {};
      f = cov.from; t = cov.to;
    }
    if (f && t) {
      var n = Math.round((new Date(t) - new Date(f)) / 86400000) + 1;
      if (n > 0) return n;
    }
    return d && d.salesPeriod && d.salesPeriod.days ? d.salesPeriod.days : 30;
  }

  // Что написано в подзаголовке экрана про период
  function anaTitle() {
    var f = anaFrom(), t = anaTo(), c = C();
    if (f || t) return (f ? датаПолная(f) : 'начала') + ' – ' + (t ? датаПолная(t) : 'сегодня');
    var cov = c.cover || {};
    return cov.from ? 'всё загруженное: ' + датаПолная(cov.from) + ' – ' + датаПолная(cov.to)
      : 'весь загруженный период';
  }

  /* Оговорка про приблизительность. Появляется ТОЛЬКО когда выбранные даты
     режут выгрузку: если границы совпали с выгрузкой, цифра точная и
     пугать владельца нечем. */
  function anaRough(sel, что) {
    if (!sel || !sel.rough) return '';
    return '<div class="banner orange"><span>' + ic('info') + '</span><span>' +
      'Из них ' + U().nf(sel.rough) + ' строк на ' + money(sel.roughSum) +
      ' попали в период приблизительно: 1С отдаёт ' + esc(что) + ' сводом за период ' +
      'целиком, дней внутри него нет — такие строки считаются полностью. ' +
      'Чтобы цифра была точной, выбирайте период по границам выгрузок ' +
      '(кнопки «Выгрузки» выше) или выгружайте из 1С помельче.' +
      '</span></div>';
  }

  /* Экран-СНИМОК (остатки, цены): периода у него нет вовсе. Вместо
     фальшивого фильтра по датам показываем, на какой момент снят отчёт. */
  function snapNote(taken, что) {
    var u = U();
    if (!taken || !taken.date) {
      return '<div class="banner blue"><span>' + ic('info') + '</span><span>' +
        esc(что) + ' — это снимок на момент выгрузки, а не отчёт за период. ' +
        'Выбор дат к нему не относится: он всегда показывает то, что было ' +
        'в последнем загруженном файле.</span></div>';
    }
    var свежесть = '';
    var дней = Math.round((new Date(u.today()) - new Date(taken.date)) / 86400000);
    if (дней >= 3) свежесть = ' <b class="c-orange">Снимку ' + u.nf(дней) + ' ' +
      u.plural(дней, 'день', 'дня', 'дней') +
      ' — выгрузите свежий, иначе решения будут по вчерашней полке.</b>';
    return '<div class="banner blue"><span>' + ic('info') + '</span><span>' +
      esc(что) + ' на <b>' + esc(датаПолная(taken.date)) + '</b>' +
      (taken.from === 'загрузка' ? ' (дату взяли по дню загрузки — в файле её не было)' : '') +
      '. Это снимок, а не отчёт за период: выбор дат к нему не относится.' +
      свежесть + '</span></div>';
  }

  function viewLosses() {
    var u = U(), d = D();
    if (!d.writeoffs.length) return need('Списания', 'Что и почему списали', 'Причины списания');

    var sel = U().anaPick(d.writeoffs);
    var list = sel.rows;
    var byReason = E.byReason(list);
    var top = E.topByCost(list, 40);
    var months = E.perMonth(list);
    var total = E.safeRound(list.reduce(function (a, r) { return a + num(r.cost); }, 0));

    var h = u.pageHead('Списания', 'Что и почему ушло не через кассу · ' + anaTitle(),
      '<button class="btn" data-act="export-screen">' + ic('download') + ' В Excel</button>');

    h += anaBar('writeoffs');

    h += '<div class="stat-grid">' +
      u.stat('Списано всего', u.priv(total), u.nf(list.length) + ' строк', 'c-red') +
      u.stat('Причин', u.nf(byReason.length), 'разных') +
      u.stat('Самая дорогая причина', esc((byReason[0] || {}).reason || '—'),
        byReason[0] ? money(byReason[0].cost) : '') +
      '</div>';

    if (!list.length) {
      h += '<div class="card"><div class="empty"><b>За эти дни списаний нет</b><br>' +
        'Либо в выбранный период ничего не списывали, либо выгрузка 1С за эти дни ' +
        'ещё не загружена. Нажмите «Всё», чтобы увидеть весь загруженный период.' +
        '</div></div>';
      return h;
    }

    h += anaRough(sel, 'причины списания');

    h += '<div class="banner blue"><span>' + ic('refresh') + '</span><span>Список пересобирается при каждой загрузке ' +
      'отчёта: новые строки добавляются, изменившиеся обновляются, а пропавшие из файла ' +
      'исчезают и из аналитики. Дубли не копятся.</span></div>';

    /* Причина и сумма — то, ради чего сюда заходят. Количество здесь
       складывать бессмысленно: килограммы и штуки в одну колонку не сложить. */
    h += u.card('По причинам', u.table('reasonT', [
      { title: 'Причина', fn: function (r) { return esc(r.reason); } },
      { title: 'Сумма', cls: 'num', fn: function (r) { return u.priv(r.cost); } },
      { title: 'Доля', cls: 'num', fn: function (r) { return u.pct(E.div(r.cost, total) * 100); } }
    ], byReason, { step: 20,
      total: [{ html: 'Всего' }, { cls: 'num', html: '<b>' + u.priv(total) + '</b>' },
        { cls: 'num', html: '100%' }] }));

    if (months.length > 1) {
      h += u.card('По месяцам', u.table('woMonthT', [
        { title: 'Месяц', fn: function (r) { return esc(E.monthTitle(r.ym)); } },
        { title: 'Сумма', cls: 'num', fn: function (r) { return u.priv(r.cost); } }
      ], months, { step: 24 }));
    }

    var wdefs = [{ key: 'why', name: 'Причина', auto: function (r) { return r.reason; }, limit: 10 }];
    var wrows = FLT().apply('losses', top, wdefs,
      function (r) { return r.name + ' ' + (r.reason || ''); }, nums('qty', 'cost'));
    h += FLT().bar('losses', wdefs, top, { search: 'товар, причина' });

    h += u.card('Самое дорогое', FLT().note(wrows.length, top.length) + u.table('woTopT', [
      { title: 'Товар', fn: function (r) { return hl('losses', r.name); } },
      { title: 'Причина', fn: function (r) { return hl('losses', r.reason || '—'); } },
      { title: 'Количество', cls: 'num', fn: function (r) { return u.nf(r.qty, 2); } },
      { title: 'Сумма', cls: 'num', fn: function (r) { return u.priv(r.cost); } }
    ], wrows, { step: 40 }));
    return h;
  }

  /* --- Неликвиды ---------------------------------------------------------------- */
  function viewDead() {
    var u = U(), c = C();
    if (!c.dead) return need('Неликвиды', 'Что лежит без движения', 'Неликвидные товары');
    var list = c.dead.list;
    var h = u.pageHead('Неликвиды', 'Деньги, которые стоят на полке без движения · ' + anaTitle());
    h += anaBar('dead');
    h += anaRough(c.deadSel, 'неликвиды');
    h += '<div class="stat-grid">' +
      u.stat('Заморожено денег', u.priv(c.dead.total), u.nf(c.dead.count) + ' позиций', 'c-orange') +
      u.stat('Совсем не продавались', u.nf(c.dead.noSale), 'ни одной продажи за период') +
      '</div>';
    var defs = [{ key: 'why', name: 'Почему в списке', options: [
      { v: 'nosale', name: 'Совсем не продавался', test: function (r) { return r.sold <= 0; } },
      { v: 'slow', name: 'Продаётся плохо', test: function (r) { return r.sold > 0; } }
    ] }, { key: 'group', name: 'Группа', auto: function (r) { return r.group; }, limit: 12 }];
    var rows = FLT().apply('dead', list, defs,
      function (r) { return r.name + ' ' + (r.group || '') + ' ' + (r.reason || ''); },
      nums('left', 'sold', 'age', 'money'));
    h += FLT().bar('dead', defs, list, { search: 'товар, группа' });
    h += u.card('Что лежит', FLT().note(rows.length, list.length) + u.table('deadT', [
      { title: 'Товар', fn: function (r) { return hl('dead', r.name); } },
      { title: 'Группа', fn: function (r) { return esc(r.group || '—'); } },
      { title: 'Остаток', cls: 'num', fn: function (r) { return u.nf(r.left, 2); } },
      { title: 'Продано', cls: 'num', fn: function (r) { return u.nf(r.sold, 2); } },
      { title: 'Лежит дней', cls: 'num', fn: function (r) { return r.age == null ? '—' : u.nf(r.age); } },
      { title: 'Денег', cls: 'num', fn: function (r) { return u.priv(r.money); } },
      { title: 'Почему', fn: function (r) { return '<span class="c-muted">' + esc(r.reason) + '</span>'; } }
    ], rows, { step: 50 }));
    return h;
  }

  /* --- Группы товаров ------------------------------------------------------------ */
  function viewGroups() {
    var u = U(), c = C();
    if (!c.byGroup || !c.byGroup.length) return need('Группы товаров', 'Кто даёт выручку, а кто прибыль', 'Продажи и Остатки');
    var rows = c.byGroup.slice();
    var rev = rows.reduce(function (a, g) { return a + num(g.revenue); }, 0);
    var gross = rows.reduce(function (a, g) { return a + num(g.gross); }, 0);
    rows.forEach(function (g) {
      g.revShare = E.safeRound(E.div(g.revenue, rev) * 100);
      g.profitShare = E.safeRound(E.div(g.gross, gross) * 100);
      g.gap = E.safeRound(g.profitShare - g.revShare);
    });
    rows.sort(function (a, b) { return b.gross - a.gross; });

    var h = u.pageHead('Группы товаров', 'Доля в выручке против доли в прибыли · ' + anaTitle());
    h += anaBar('sales');
    h += anaRough(c.salesSel, 'продажи');
    h += '<div class="stat-grid">' +
      u.stat('Выручка по группам', u.priv(rev), rows.length + ' групп') +
      u.stat('Валовая прибыль', u.priv(gross), 'выручка минус закуп', 'c-green') +
      u.stat('Общая маржа', u.pct(E.div(gross, rev) * 100), 'сколько остаётся с рубля') +
      '</div>';
    var traps = rows.filter(function (r) { return r.gap < -3 && r.revShare >= 3; });
    if (traps.length) {
      h += '<div class="banner orange"><span>' + ic('warning') + '</span><span>Продаём много, зарабатываем мало: <b>' +
        traps.map(function (r) { return esc(r.group); }).join(', ') + '</b>. Доля в выручке заметно ' +
        'больше доли в прибыли — проверьте наценку.</span></div>';
    }
    var gdefs = [{ key: 'gap', name: 'Доля прибыли против доли выручки', options: [
      // Группа даёт много выручки и мало прибыли — это и есть «работаем даром»
      { v: 'bad', name: 'Прибыли меньше, чем выручки', test: function (r) { return r.gap < -1; } },
      { v: 'good', name: 'Прибыли больше', test: function (r) { return r.gap > 1; } }
    ] }];
    var grows = FLT().apply('groups', rows, gdefs, function (r) { return r.group; },
      nums('revenue', 'gross', 'margin', 'items'));
    h += FLT().bar('groups', gdefs, rows, { search: 'группа' });

    h += u.card('Группы по прибыли', FLT().note(grows.length, rows.length) + u.table('grpT', [
      { title: 'Группа', fn: function (r) { return hl('groups', r.group); } },
      { title: 'Позиций', cls: 'num', fn: function (r) { return u.nf(r.items); } },
      { title: 'Выручка', cls: 'num', fn: function (r) { return u.priv(r.revenue); } },
      { title: 'Доля выручки', cls: 'num', fn: function (r) { return u.pct(r.revShare); } },
      { title: 'Прибыль', cls: 'num', fn: function (r) { return u.priv(r.gross); } },
      { title: 'Доля прибыли', cls: 'num', fn: function (r) { return '<b>' + u.pct(r.profitShare) + '</b>'; } },
      { title: 'Маржа', cls: 'num', fn: function (r) { return u.pct(r.margin); } }
    ], grows, { step: 40 }));
    return h;
  }

  /* --- Рейтинг товаров по прибыли -------------------------------------------------- */
  function viewItemProfit() {
    var u = U(), d = D(), c = C();
    if (!d.sales.length) return need('Рейтинг по прибыли', 'Кто приносит деньги, а не выручку', 'Продажи');
    var sel = U().anaPick(d.sales);
    var rows = c.salesMerged.map(function (s) {
      var profit = E.safeRound(num(s.revenue) - num(s.cogs));
      return { name: s.name, key: s.key, qty: E.safeRound(s.qty), revenue: E.safeRound(s.revenue),
        cogs: E.safeRound(s.cogs), profit: profit,
        margin: num(s.revenue) ? E.safeRound(E.div(profit, s.revenue) * 100) : 0 };
    });
    var byProfit = rows.slice().sort(function (a, b) { return b.profit - a.profit; });
    var byRevenue = rows.slice().sort(function (a, b) { return b.revenue - a.revenue; });
    var rank = {}; byProfit.forEach(function (r, i) { rank[r.key || r.name] = i + 1; });
    var fakes = byRevenue.slice(0, 20).filter(function (r) { return rank[r.key || r.name] > 40; })
      .map(function (r) { r.place = rank[r.key || r.name]; return r; });
    var total = E.safeRound(rows.reduce(function (a, r) { return a + r.profit; }, 0));

    var h = u.pageHead('Рейтинг по прибыли',
      'Не кто больше продаётся, а кто больше приносит · ' + anaTitle());
    h += anaBar('sales');
    h += anaRough(sel, 'продажи');
    h += '<div class="stat-grid">' +
      u.stat('Прибыль по товарам', u.priv(total), u.nf(rows.length) + ' позиций', 'c-green') +
      u.stat('«Обманщиков»', u.nf(fakes.length), 'в топе выручки, но не прибыли',
        fakes.length ? 'c-orange' : 'c-green') +
      '</div>';
    if (fakes.length) {
      h += u.card('Продаются хорошо, зарабатывают плохо', u.table('fakeT', [
        { title: 'Товар', fn: function (r) { return esc(r.name); } },
        { title: 'Выручка', cls: 'num', fn: function (r) { return u.priv(r.revenue); } },
        { title: 'Прибыль', cls: 'num', fn: function (r) { return u.priv(r.profit); } },
        { title: 'Маржа', cls: 'num', fn: function (r) { return '<span class="c-orange">' + u.pct(r.margin) + '</span>'; } },
        { title: 'Место по прибыли', cls: 'num', fn: function (r) { return u.nf(r.place); } }
      ], fakes, { step: 20 }));
    }
    var defs = [{ key: 'm', name: 'Маржа', options: [
      { v: 'hi', name: 'Больше 25%', test: function (r) { return r.margin >= 25; } },
      { v: 'mid', name: '10–25%', test: function (r) { return r.margin >= 10 && r.margin < 25; } },
      { v: 'lo', name: 'Меньше 10%', test: function (r) { return r.margin < 10; } }
    ] }, { key: 'p', name: 'Прибыль', options: [
      // Торговать в минус можно годами и не заметить: пусть будет одна кнопка
      { v: 'minus', name: 'В минус', test: function (r) { return r.profit < 0; } },
      { v: 'plus', name: 'В плюс', test: function (r) { return r.profit > 0; } },
      { v: 'zero', name: 'В ноль', test: function (r) { return r.profit === 0; } }
    ] }];
    var list = FLT().apply('itemprof', byProfit, defs, function (r) { return r.name; },
      nums('qty', 'revenue', 'profit', 'margin'));
    h += FLT().bar('itemprof', defs, byProfit, { search: 'название товара' });
    h += u.card('Кто приносит деньги', FLT().note(list.length, byProfit.length) + u.table('ipT', [
      { title: '#', cls: 'num', fn: function (r, i) { return u.nf(i + 1); } },
      { title: 'Товар', fn: function (r) { return hl('itemprof', r.name); } },
      { title: 'Продано', cls: 'num', fn: function (r) { return u.nf(r.qty, 2); } },
      { title: 'Выручка', cls: 'num', fn: function (r) { return u.priv(r.revenue); } },
      { title: 'Прибыль', cls: 'num', fn: function (r) {
        return '<b class="' + (r.profit >= 0 ? 'c-green' : 'c-red') + ' private">' + money(r.profit) + '</b>'; } },
      { title: 'Маржа', cls: 'num', fn: function (r) { return u.pct(r.margin); } }
    ], list, { step: 50 }));
    return h;
  }

  /* --- Полки: что окупает место ---------------------------------------------------- */
  function viewShelf() {
    var u = U(), d = D(), c = C();
    if (!d.sales.length || !d.stock.length) {
      return need('Полки', 'Сколько прибыли приносит каждый рубль в товаре', 'Продажи и Остатки');
    }
    var sel = U().anaPick(d.sales);
    var res = G.shelfValue(d.stock, c.salesMerged, c.groupIdx);
    var h = u.pageHead('Полки: что окупает место',
      'Сколько прибыли приносит каждый рубль, вложенный в группу товаров · ' + anaTitle());
    h += anaBar('sales');
    h += anaRough(sel, 'продажи');
    h += snapNote(d.stockTaken, 'Остатки');
    function perRub(v) {
      return num(v).toLocaleString('ru-RU', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + ' ₽';
    }
    h += '<div class="stat-grid">' +
      u.stat('Денег в товаре', u.priv(res.totalStock), 'по себестоимости') +
      u.stat('Прибыль с рубля', perRub(res.avgPerRuble), 'в среднем по складу') +
      u.stat('Мёртвых полок', u.nf(res.deadCount),
        res.deadMoney ? 'в них ' + money(res.deadMoney) + ' — приносят меньше трети среднего'
          : 'приносят меньше трети среднего',
        res.deadCount ? 'c-orange' : 'c-green') +
      '</div>';
    var sdefs = [{ key: 'pay', name: 'Окупает ли место', options: [
      { v: 'no', name: 'Место зря', test: function (r) { return !!r.dead; } },
      { v: 'yes', name: 'Окупает', test: function (r) { return !r.dead; } }
    ] }, { key: 'big', name: 'Размер вложения', options: [
      { v: 'top', name: 'Больше 5% полки', test: function (r) { return num(r.share) >= 5; } },
      { v: 'small', name: 'Меньше 1%', test: function (r) { return num(r.share) < 1; } }
    ] }];
    var srows = FLT().apply('shelf', res.rows, sdefs,
      function (r) { return r.group || ''; },
      nums('stockSum', 'profit', 'perRuble', 'sku'));
    h += FLT().bar('shelf', sdefs, res.rows, { search: 'группа товаров' });

    /* Полки считаются ПО ГРУППАМ ТОВАРОВ, а не по каждому товару: место на
       полке занимает группа целиком, и решение принимается тоже про группу. */
    h += u.card('Что стоит на полке', FLT().note(srows.length, res.rows.length) + u.table('shelfT', [
      { title: 'Группа товаров', fn: function (r) { return hl('shelf', r.group || '—'); } },
      { title: 'Позиций', cls: 'num', fn: function (r) { return u.nf(r.sku); } },
      { title: 'Денег в товаре', cls: 'num', fn: function (r) { return u.priv(r.stockSum); } },
      { title: 'Доля полки', cls: 'num', fn: function (r) { return u.pct(r.share); } },
      { title: 'Прибыль', cls: 'num', fn: function (r) { return u.priv(r.profit); } },
      { title: 'На рубль', cls: 'num', fn: function (r) {
        return r.perRuble === null ? '<span class="c-muted">—</span>'
          : '<b class="' + (r.dead ? 'c-orange' : 'c-green') + '">' + perRub(r.perRuble) + '</b>'; } },
      { title: 'Против среднего', cls: 'num', fn: function (r) {
        return r.vsAvg === null ? '—'
          : '<span class="' + u.cls(r.vsAvg) + '">' + (r.vsAvg > 0 ? '+' : '') +
            u.pct(r.vsAvg) + '</span>'; } },
      { title: '', cls: 'center', fn: function (r) { return r.dead ? u.badge('место зря', 'orange') : ''; } }
    ], srows, { step: 50 }));
    h += '<div class="banner"><span>' + ic('info') + '</span><span>Полка не резиновая. Если рубль, вложенный в товар, ' +
      'приносит копейки, его лучше вложить в тот, что приносит рубль.</span></div>';
    return h;
  }

  /* --- Возвраты поставщикам --------------------------------------------------------- */
  function viewReturns() {
    var u = U(), d = D(), c = C();
    if (!d.returns.length) return need('Возвраты поставщикам', 'Что вернули и почему', 'Причины возвратов');
    var sel = U().anaPick(d.returns);
    var список = sel.rows;
    var byReason = E.byReason(список);
    var сумма = E.safeRound(список.reduce(function (a, r) { return a + num(r.cost); }, 0));
    var h = u.pageHead('Возвраты поставщикам', 'Что вернули и почему · ' + anaTitle());
    h += anaBar('returns');
    h += anaRough(sel, 'причины возврата');
    h += '<div class="stat-grid">' +
      u.stat('Вернули на сумму', u.priv(сумма), u.nf(список.length) + ' строк') +
      u.stat('Причин', u.nf(byReason.length), 'разных') +
      '</div>';
    h += u.card('По причинам', u.table('retReasonT', [
      { title: 'Причина', fn: function (r) { return esc(r.reason); } },
      { title: 'Сумма', cls: 'num', fn: function (r) { return u.priv(r.cost); } }
    ], byReason, { step: 20 }));
    var топ = E.topByCost(список, 60);
    var rdefs = [{ key: 'why', name: 'Причина', auto: function (r) { return r.reason; }, limit: 10 }];
    var rrows = FLT().apply('returns', топ, rdefs,
      function (r) { return r.name + ' ' + (r.reason || ''); }, nums('qty', 'cost'));
    h += FLT().bar('returns', rdefs, топ, { search: 'товар, причина' });

    h += u.card('Что возвращали', FLT().note(rrows.length, топ.length) + u.table('retTopT', [
      { title: 'Товар', fn: function (r) { return hl('returns', r.name); } },
      { title: 'Причина', fn: function (r) { return hl('returns', r.reason || '—'); } },
      { title: 'Количество', cls: 'num', fn: function (r) { return u.nf(r.qty, 2); } },
      { title: 'Сумма', cls: 'num', fn: function (r) { return u.priv(r.cost); } }
    ], rrows, { step: 40 }));
    return h;
  }

  /* --- ABC-анализ --------------------------------------------------------------------- */
  function viewAbc() {
    var u = U(), d = D(), c = C();
    if (!d.sales.length) return need('ABC-анализ', 'Какие товары дают выручку', 'Продажи');
    var rows = c.abc;
    var counts = { A: 0, B: 0, C: 0 };
    rows.forEach(function (r) { counts[r.abc] = (counts[r.abc] || 0) + 1; });
    var h = u.pageHead('ABC и XYZ',
      'ABC — сколько денег приносит. XYZ — можно ли на него положиться · ' + anaTitle());
    h += anaBar('sales');
    h += anaRough(c.salesSel, 'продажи');
    h += '<div class="stat-grid">' +
      u.stat('Группа A', u.nf(counts.A), 'дают 80% выручки', 'c-green') +
      u.stat('Группа B', u.nf(counts.B), 'следующие 15%') +
      u.stat('Группа C', u.nf(counts.C), 'последние 5% — кандидаты на вылет', 'c-orange') +
      '</div>';

    /* --- XYZ: девять клеток -------------------------------------------------
       ABC один отвечает только на половину вопроса. Товар может давать много
       денег и при этом браться рывками — заказывать его как хлеб значит
       сделать из него неликвид. XYZ добавляет вторую половину. */
    var ax = c.abcXyz;
    if (!ax || !ax.enough) {
      h += u.blank({ icon: 'chartBar', title: 'XYZ пока посчитать не из чего',
        why: 'XYZ смотрит, как товар продавался ОТ ПЕРИОДА К ПЕРИОДУ: ровно или ' +
          'рывками. Для этого нужно хотя бы три выгрузки за разные недели или ' +
          'месяцы, а сейчас загружено ' + ((ax && ax.periods) || 0) + '. ' +
          'Загрузите ещё — программа сама всё сопоставит.',
        actions: [{ name: 'Загрузить выгрузку', go: 'data', icon: 'upload' }] });
    } else {
      var сетка = ax.grid, всего = 0;
      сетка.forEach(function (g) { всего += g.count; });
      h += '<div class="card"><div class="card-head"><div class="card-title">' +
        'Девять групп</div><div class="card-sub">по ' + ax.periods +
        ' выгрузкам · XYZ считается по всем загруженным периодам, а не по ' +
        'выбранному сверху — иначе сравнивать не с чем</div></div>' +
        '<div class="xyz-grid">';
      сетка.forEach(function (g) {
        var цвет = g.group === 'AX' ? 'ax' : (g.group === 'CZ' ? 'cz' : '');
        h += '<div class="xyz-cell ' + цвет + (g.count ? '' : ' empty') +
          '" data-act="xyz-cell" data-group="' + esc(g.group) + '" title="' +
          esc(g.advice) + '">' +
          '<b>' + esc(g.group) + '</b>' +
          '<span>' + u.nf(g.count) + '</span>' +
          '<i>' + u.priv(g.revenue) + '</i></div>';
      });
      h += '</div><div class="xyz-legend">' +
        '<b>A · B · C</b> — сколько приносит денег. ' +
        '<b>X · Y · Z</b> — насколько ровно берут: ' +
        'X до 10% разброса, Y до 25%, Z больше.</div></div>';

      var топ = сетка.filter(function (g) { return g.count; })
        .sort(function (a, b) { return b.revenue - a.revenue; });
      if (топ.length) {
        h += u.card('Что с этим делать', u.listOf(топ.map(function (g) {
          return u.listRow({ icon: g.group === 'CZ' ? 'warning' : 'medal',
            title: g.group + ' — ' + u.nf(g.count) + ' ' +
              E.plural(g.count, 'товар', 'товара', 'товаров'),
            sub: g.advice, value: u.priv(g.revenue) });
        }), ''));
      }
    }

    var defs = [{ key: 'abc', name: 'Класс', auto: function (r) { return r.abc; }, limit: 3 }];
    if (ax && ax.enough) {
      defs.push({ key: 'xyz', name: 'Ровность', auto: function (r) { return r.xyz; }, limit: 3 });
    }
    // К строкам ABC подмешиваем XYZ того же товара: таблица одна, а не две
    var поКлючу = {};
    if (ax) ax.rows.forEach(function (r) { поКлючу[r.key] = r; });
    rows = rows.map(function (r) {
      var k = E.txt(r.key) || E.norm(r.name);
      var x = поКлючу[k];
      var копия = {};
      for (var f in r) копия[f] = r[f];
      копия.xyz = x ? x.xyz : '';
      копия.spread = x ? x.spread : 0;
      копия.group = x ? x.group : '';
      копия.advice = x ? x.advice : '';
      return копия;
    });
    var list = FLT().apply('abc', rows, defs, function (r) { return r.name; },
      nums('revenue', 'share', 'cum', 'spread'));
    h += FLT().bar('abc', defs, rows, { search: 'товар' });
    h += u.card('Товары', FLT().note(list.length, rows.length) + u.table('abcT', [
      { title: 'Товар', fn: function (r) { return hl('abc', r.name); } },
      { title: 'Класс', cls: 'center', fn: function (r) {
        return u.badge(r.abc, r.abc === 'A' ? 'green' : r.abc === 'B' ? 'blue' : 'gray'); } },
      { title: 'Ровность', cls: 'center', fn: function (r) {
        if (!r.xyz) return '<span class="c-muted">—</span>';
        return u.badge(r.xyz, r.xyz === 'X' ? 'green' : r.xyz === 'Y' ? 'blue' : 'orange'); } },
      { title: 'Разброс', cls: 'num', fn: function (r) {
        return r.xyz ? u.pct(r.spread) : '<span class="c-muted">—</span>'; } },
      { title: 'Выручка', cls: 'num', fn: function (r) { return u.priv(r.revenue); } },
      { title: 'Доля', cls: 'num', fn: function (r) { return u.pct(r.share); } },
      { title: 'Накопленно', cls: 'num', fn: function (r) { return u.pct(r.cum); } }
    ], list, { step: 50 }));
    return h;
  }

  /* --- Цены поставщиков ---------------------------------------------------------------- */
  function viewPrices() {
    var u = U(), d = D(), c = C();
    if (!d.prices.length) return need('Цены поставщиков', 'Где дешевле', 'Текущие цены поставщиков');

    /* priceComparison возвращает СПИСОК позиций, у каждой: min, max, spread,
       bestSupplier, suppliers, bestPhone. Вторым аргументом ей нужен указатель
       на контакты — с ним в таблице появляется телефон, по которому звонить. */
    var rows = E.priceComparison(d.prices, c.contactsIdx);
    var поставщиков = {};
    d.prices.forEach(function (p) { поставщиков[E.norm(p.supplier)] = 1; });
    var сВыбором = rows.filter(function (r) { return r.suppliers > 1; });
    // Сколько экономим, если каждую позицию брать у самого дешёвого
    var экономия = E.safeRound(сВыбором.reduce(function (a, r) { return a + num(r.spread); }, 0));

    var h = u.pageHead('Цены поставщиков', u.nf(d.prices.length) + ' цен от ' +
      u.nf(Object.keys(поставщиков).length) + ' поставщиков',
      '<button class="btn" data-act="export-screen">' + ic('download') + ' В Excel</button>');
    h += snapNote(d.pricesTaken, 'Цены поставщиков');
    h += '<div class="stat-grid">' +
      u.stat('Разница в ценах', u.priv(экономия),
        'на ' + u.nf(сВыбором.length) + ' ' +
        u.plural(сВыбором.length, 'позиции', 'позициях', 'позициях') + ', где есть выбор', 'c-green') +
      u.stat('Позиций с выбором', u.nf(сВыбором.length), 'есть из кого выбрать') +
      u.stat('Только один поставщик', u.nf(rows.length - сВыбором.length),
        'сравнить не с чем') +
      '</div>';

    var defs = [{ key: 'ch', name: 'Есть выбор', options: [
      { v: 'many', name: 'Двое и больше', test: function (r) { return r.suppliers > 1; } },
      { v: 'one', name: 'Один поставщик', test: function (r) { return r.suppliers === 1; } }
    ] }, { key: 'sup', name: 'Дешевле у', auto: function (r) { return r.bestSupplier; }, limit: 12 },
    { key: 'gain', name: 'Разница на единице', options: [
      { v: 'big', name: 'Больше 10 ₽', test: function (r) { return num(r.spread) >= 10; } },
      { v: 'any', name: 'Хоть какая-то', test: function (r) { return num(r.spread) > 0; } }
    ] }];
    var list = FLT().apply('prices', rows, defs,
      function (r) { return r.name + ' ' + (r.bestSupplier || '') + ' ' + (r.barcode || ''); },
      nums('min', 'max', 'spread', 'suppliers'));
    h += FLT().bar('prices', defs, rows, { search: 'товар, поставщик, штрихкод' });

    h += u.card('Где дешевле', FLT().note(list.length, rows.length) + u.table('priceT', [
      { title: 'Товар', fn: function (r) { return hl('prices', r.name); } },
      { title: 'Дешевле у', fn: function (r) { return hl('prices', r.bestSupplier || '—'); } },
      { title: 'Телефон', fn: function (r) {
        return r.bestPhone ? esc(r.bestPhone) : '<span class="c-muted">—</span>'; } },
      { title: 'Лучшая цена', cls: 'num', fn: function (r) { return u.priv(r.min); } },
      { title: 'Худшая', cls: 'num', fn: function (r) { return u.priv(r.max); } },
      { title: 'Разница', cls: 'num', fn: function (r) {
        return r.spread ? '<span class="c-green private">' + money(r.spread) + '</span>' : '—'; } },
      { title: 'Поставщиков', cls: 'num', fn: function (r) { return u.nf(r.suppliers); } }
    ], list, { step: 50 }));

    h += '<div class="banner"><span>' + ic('info') + '</span><span>Разница — это на ОДНОЙ ' +
      'единице товара. Умножьте на то, сколько берёте за месяц, и станет видно, ' +
      'стоит ли менять поставщика. Цены — снимок из последней выгрузки, ' +
      'за период они не считаются.</span></div>';
    return h;
  }

  /* --- Поставщики и общий долг ----------------------------------------------------------
     Долг магазина — ручная цифра из вечерних итогов, общей суммой.
     Здесь же показываем, кто и сколько привозит по данным 1С: это аналитика,
     она долг не считает и не меняет. */
  function viewSuppliers() {
    var u = U(), d = D(), c = C();
    var debt = E.supplierDebt(S.state.dds || [], S.settings);
    var pt = E.planTotals(S.state.plans || [], E.today());

    var h = u.pageHead('Поставщики и долг', 'Общий долг магазина и кто сколько привозит',
      '<button class="btn btn-primary" data-form="payPlan">' + ic('plus') + ' Запланировать выплату</button>');

    h += '<div class="stat-grid">' +
      u.stat('Должны поставщикам', u.priv(debt.debt), 'общей суммой по магазину',
        debt.debt >= num(S.settings.debtCrit) ? 'c-red' : '') +
      u.stat('Взято в долг', u.priv(debt.taken), 'за всё время') +
      u.stat('Погашено', u.priv(debt.paid), 'за всё время', 'c-green') +
      u.stat('Просрочено выплат', u.priv(pt.overdue), pt.overdueCount + ' платежей',
        pt.overdue ? 'c-red' : 'c-green') +
      '</div>';

    h += '<div class="banner blue"><span>' + ic('clipboard') + '</span><span>Долг магазина ведётся <b>общей суммой</b>: ' +
      'вечером вы вписываете, сколько взяли в долг и сколько погасили. Разносить каждую ' +
      'накладную по торговым представителям не нужно. Таблица ниже — это аналитика из 1С: ' +
      'она показывает, кто сколько привозит, но на долг не влияет.</span></div>';

    if (!c.supplies) {
      h += '<div class="card"><div class="empty">Чтобы увидеть, кто сколько привозит, ' +
        'загрузите отчёт «Приходные накладные» из 1С на экране «Данные и копии».</div></div>';
      return h;
    }
    var rows = c.supplies.rows || c.supplies;
    h += u.card('Кто сколько привозит — по данным 1С', u.table('supT', [
      { title: 'Поставщик', fn: function (r) { return esc(r.supplier || r.name); } },
      { title: 'Накладных', cls: 'num', fn: function (r) { return u.nf(r.docs); } },
      { title: 'Привезли', cls: 'num', fn: function (r) { return u.priv(r.sum); } },
      { title: 'Оплачено по ордерам', cls: 'num', fn: function (r) { return u.priv(r.paid); } },
      { title: 'Телефон', fn: function (r) {
        var ph = c.contactsIdx ? c.contactsIdx[E.norm(r.supplier || r.name)] : '';
        return ph ? '<a href="tel:' + esc(ph) + '">' + esc(ph) + '</a>' : '—'; } }
    ], rows, { step: 40, empty: 'Накладных 1С не загружено' }),
      'Это аналитика поставок, а не долг: долг магазина — цифра выше');
    return h;
  }

  /* --- Сезонность --------------------------------------------------------------------- */
  function viewSeasons() {
    var u = U();
    var F = window.WMFin;
    var rows = F.flatten(S.state.dds || []);
    var sez = G.seasons(rows, F.isIncome);
    var h = u.pageHead('Сезонность', 'В каком месяце магазин работает лучше');
    if (!sez.monthsWithData) {
      return h + u.blank({ icon: 'calendar', title: 'Сезонность пока не видна',
        why: 'Она складывается из нескольких месяцев работы: программа сравнивает, ' +
          'в каком месяце магазин заработал больше. Закрывайте смены — через ' +
          'два-три месяца здесь появится картина года.',
        actions: [
          { name: 'Свести кассу', icon: 'calculator', form: 'shiftClose' },
          { name: 'Отчёт собственнику', icon: 'person', go: 'owner' }
        ] });
    }
    h += '<div class="stat-grid">' +
      u.stat('Месяцев с данными', u.nf(sez.monthsWithData), 'из 12') +
      u.stat('Лучший месяц', esc(sez.best ? sez.best.name : '—'),
        sez.best ? money(sez.best.avg) + ' в среднем' : '') +
      u.stat('Самый тихий', esc(sez.worst ? sez.worst.name : '—'),
        sez.worst ? money(sez.worst.avg) + ' в среднем' : '') +
      '</div>';
    h += u.card('По месяцам', u.table('seasonT', [
      { title: 'Месяц', fn: function (r) { return esc(r.name); } },
      { title: 'Лет наблюдений', cls: 'num', fn: function (r) { return u.nf(r.years); } },
      { title: 'В среднем', cls: 'num', fn: function (r) { return u.priv(r.avg); } },
      { title: 'Против обычного', cls: 'num', fn: function (r) {
        return r.vs === null ? '—' : '<span class="' + u.cls(r.vs) + '">' +
          (r.vs > 0 ? '+' : '') + u.pct(r.vs) + '</span>'; } },
      { title: '', fn: function (r) { return r.mark ? u.badge(r.mark, r.mark === 'сезон' ? 'green' : 'gray') : ''; } }
    ], sez.months, { step: 12 }));
    return h;
  }

  /* --- Действия и поля экрана «Списания» ---------------------------------------- */
  var A = window.WM_EXTRA_ACTIONS = window.WM_EXTRA_ACTIONS || {};

  /* Нажатие на клетку девяти групп ставит оба фильтра разом. Без обработчика
     клетка была бы мёртвой кнопкой: выглядит нажимаемой, а не делает ничего.
     Пустые клетки не трогаем — фильтровать там нечего. */
  A['xyz-cell'] = function (el) {
    var g = E.txt(el.dataset.group);
    if (g.length !== 2) return null;
    if (el.classList && el.classList.contains('empty')) return null;
    FLT().set('abc', 'abc', g.charAt(0));
    FLT().set('abc', 'xyz', g.charAt(1));
    return null;      // перерисовку делает общий обработчик нажатий
  };

  A['ana-period'] = function (el) {
    S.setSetting('anaFrom', E.txt(el.dataset.from));
    S.setSetting('anaTo', E.txt(el.dataset.to));
    U().recompute();
    return null;      // перерисовку делает общий обработчик нажатий
  };

  /* Поля «с» и «по». Перепутанные местами даты не ошибка владельца, а обычная
     оговорка: отбор всё равно сработает, rowsInRange поменяет их местами сам. */
  var prevGoodsChange = window.WM_EXTRA_CHANGE;
  window.WM_EXTRA_CHANGE = function (el) {
    if (el.id === 'anaFrom') { S.setSetting('anaFrom', el.value); U().recompute(); return true; }
    if (el.id === 'anaTo') { S.setSetting('anaTo', el.value); U().recompute(); return true; }
    return prevGoodsChange ? prevGoodsChange(el) : false;
  };

  var VIEWS = window.WM_EXTRA_VIEWS = window.WM_EXTRA_VIEWS || [];
  VIEWS.push(
    { id: 'suppliers', icon: 'supplier', name: 'Поставщики и долг', group: 'Деньги', render: viewSuppliers },
    { id: 'stock', icon: 'box', name: 'Склад', group: 'Товары', render: viewStock },
    { id: 'orders', icon: 'truck', name: 'Заказы', group: 'Товары', render: viewOrders },
    { id: 'losses', icon: 'trash', name: 'Списания', group: 'Товары', render: viewLosses },
    { id: 'dead', icon: 'snowflake', name: 'Неликвиды', group: 'Товары', render: viewDead },
    { id: 'groups', icon: 'chartBar', name: 'Группы товаров', group: 'Товары', render: viewGroups },
    { id: 'itemprofit', icon: 'trophy', name: 'Рейтинг по прибыли', group: 'Товары', render: viewItemProfit },
    { id: 'shelf', icon: 'grid', name: 'Полки: что окупает место', group: 'Товары', render: viewShelf },
    { id: 'returns', icon: 'returnArrow', name: 'Возвраты поставщикам', group: 'Товары', render: viewReturns },
    { id: 'abc', icon: 'medal', name: 'ABC и XYZ', group: 'Товары', render: viewAbc },
    { id: 'pricecmp', icon: 'tag', name: 'Цены поставщиков', group: 'Товары', render: viewPrices },
    { id: 'seasons', icon: 'calendar', name: 'Сезонность', group: 'Отчёты', render: viewSeasons }
  );
})();

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
      '<div class="card-pad"><button class="btn btn-primary" data-go="data">📂 Загрузить выгрузки</button></div></div>';
  }

  /* --- Склад ------------------------------------------------------------------ */
  function viewStock() {
    var u = U(), d = D(), c = C();
    if (!d.stock.length) return need('Склад', 'Что лежит на полках и сколько это стоит', 'Остатки номенклатуры');
    var t = c.stock;
    var h = u.pageHead('Склад', u.nf(t.sku) + ' позиций из 1С',
      '<button class="btn" data-act="export-screen">⤓ В Excel</button>');

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
    var rows = FLT().apply('stock', d.stock, defs, function (r) { return r.name + ' ' + (r.barcode || ''); });
    h += FLT().bar('stock', defs, d.stock, { search: 'товар, штрихкод, артикул' });

    h += u.card('Остатки', FLT().note(rows.length, d.stock.length) + u.table('stockT', [
      { title: 'Товар', fn: function (r) { return esc(r.name); } },
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
    var days = d.salesPeriod ? d.salesPeriod.days : 30;
    var list = E.ropList(d.sales, d.stock, days, S.settings, c.bestPrices);
    var h = u.pageHead('Заказы', 'Что заканчивается и сколько заказать',
      '<button class="btn" data-act="export-screen">⤓ В Excel</button>');

    var money0 = list.reduce(function (a, r) { return a + num(r.orderSum); }, 0);
    h += '<div class="stat-grid">' +
      u.stat('Пора заказать', u.nf(list.length), 'позиций ниже точки заказа',
        list.length ? 'c-orange' : 'c-green') +
      u.stat('На сумму', u.priv(money0), 'по лучшим ценам поставщиков') +
      u.stat('Расход в день', u.nf(E.safeRound(list.reduce(function (a, r) { return a + num(r.demand); }, 0)), 1),
        'штук по этим позициям') +
      '</div>';

    h += u.card('Заказать', u.table('ropT', [
      { title: 'Товар', fn: function (r) { return esc(r.name); } },
      { title: 'Остаток', cls: 'num', fn: function (r) { return u.nf(r.stock, 2); } },
      { title: 'Хватит на', cls: 'num', fn: function (r) {
        return r.daysLeft == null ? '—' : '<span class="' + (r.daysLeft <= 2 ? 'c-red' : '') + '">' +
          u.nf(r.daysLeft, 1) + ' дн.</span>'; } },
      { title: 'Заказать', cls: 'num', fn: function (r) { return '<b>' + u.nf(r.order, 2) + '</b>'; } },
      { title: 'У кого дешевле', fn: function (r) { return esc(r.supplier || '—'); } },
      { title: 'Цена', cls: 'num', fn: function (r) { return u.priv(r.price); } },
      { title: 'Сумма', cls: 'num', fn: function (r) { return u.priv(r.orderSum); } }
    ], list, { step: 50, empty: 'Заказывать нечего — всего хватает.' }));
    return h;
  }

  /* --- Сроки годности ----------------------------------------------------------- */
  function viewExpiry() {
    var u = U(), d = D();
    if (!d.stock.length) return need('Сроки годности', 'Что уценить сегодня', 'Остатки номенклатуры');
    var rows = d.stock.filter(function (r) { return r.bestBefore; }).map(function (r) {
      var f = E.fefoStatus(r.bestBefore, S.settings);
      return { name: r.name, group: r.group, qty: num(r.qty), price: num(r.retailPrice),
        bestBefore: r.bestBefore, days: f.days, level: f.level, discount: f.discount,
        now: E.safeRound(num(r.retailPrice) * (100 - f.discount) / 100) };
    }).sort(function (a, b) { return a.days - b.days; });

    var h = u.pageHead('Сроки годности', 'Что уценить сегодня, пока не списали');
    if (!rows.length) {
      return h + '<div class="banner blue"><span>ℹ️</span><span>В выгрузке остатков нет колонки со сроком ' +
        'годности, поэтому считать нечего. Если 1С её отдаёт — она подхватится сама.</span></div>';
    }
    var crit = rows.filter(function (r) { return r.level === 'crit' || r.level === 'expired'; });
    h += '<div class="stat-grid">' +
      u.stat('Красная зона', u.nf(crit.length), 'уценить сегодня', crit.length ? 'c-red' : 'c-green') +
      u.stat('Денег в красной зоне', u.priv(crit.reduce(function (a, r) { return a + r.qty * r.price; }, 0)),
        'если не продать — спишем') +
      '</div>';
    h += u.card('По срокам', u.table('fefoT', [
      { title: 'Товар', fn: function (r) { return esc(r.name); } },
      { title: 'Годен до', fn: function (r) { return esc(dateRu(r.bestBefore)); } },
      { title: 'Дней', cls: 'num', fn: function (r) {
        return '<span class="' + (r.days <= 2 ? 'c-red' : r.days <= 5 ? 'c-orange' : '') + '">' +
          u.nf(r.days) + '</span>'; } },
      { title: 'Остаток', cls: 'num', fn: function (r) { return u.nf(r.qty, 2); } },
      { title: 'Цена', cls: 'num', fn: function (r) { return u.priv(r.price); } },
      { title: 'Уценка', cls: 'num', fn: function (r) { return r.discount ? u.pct(r.discount) : '—'; } },
      { title: 'Ставить в зал', cls: 'num', fn: function (r) { return u.priv(r.now); } }
    ], rows, { step: 50 }));
    return h;
  }

  /* --- Списания: синхронизация с отчётом 1С --------------------------------------
     Отчёт «Причины списания» перечитывается целиком: что было в прошлом файле,
     но пропало в новом, из аналитики уходит — иначе на экране копились бы
     позиции, которых в 1С уже нет. */
  function viewLosses() {
    var u = U(), d = D(), c = C();
    if (!d.writeoffs.length) return need('Списания', 'Что и почему списали', 'Причины списания');
    var byReason = E.byReason(d.writeoffs);
    var top = E.topByCost(d.writeoffs, 40);
    var months = E.perMonth(d.writeoffs);
    var total = c.writeoffSum;

    var h = u.pageHead('Списания', 'Что и почему ушло не через кассу' +
      (d.writeoffsPeriod ? ' · ' + d.writeoffsPeriod.from + ' – ' + d.writeoffsPeriod.to : ''),
      '<button class="btn" data-act="export-screen">⤓ В Excel</button>');

    h += '<div class="stat-grid">' +
      u.stat('Списано всего', u.priv(total), u.nf(d.writeoffs.length) + ' строк', 'c-red') +
      u.stat('Причин', u.nf(byReason.length), 'разных') +
      u.stat('Самая дорогая причина', esc((byReason[0] || {}).name || '—'),
        byReason[0] ? money(byReason[0].cost) : '') +
      '</div>';

    h += '<div class="banner blue"><span>🔄</span><span>Список пересобирается при каждой загрузке ' +
      'отчёта: новые строки добавляются, изменившиеся обновляются, а пропавшие из файла ' +
      'исчезают и из аналитики. Дубли не копятся.</span></div>';

    h += u.card('По причинам', u.table('reasonT', [
      { title: 'Причина', fn: function (r) { return esc(r.name); } },
      { title: 'Позиций', cls: 'num', fn: function (r) { return u.nf(r.count); } },
      { title: 'Количество', cls: 'num', fn: function (r) { return u.nf(r.qty, 2); } },
      { title: 'Сумма', cls: 'num', fn: function (r) { return u.priv(r.cost); } },
      { title: 'Доля', cls: 'num', fn: function (r) { return u.pct(E.div(r.cost, total) * 100); } }
    ], byReason, { step: 20 }));

    if (months.length > 1) {
      h += u.card('По месяцам', u.table('woMonthT', [
        { title: 'Месяц', fn: function (r) { return esc(E.monthTitle(r.ym)); } },
        { title: 'Сумма', cls: 'num', fn: function (r) { return u.priv(r.cost); } },
        { title: 'Позиций', cls: 'num', fn: function (r) { return u.nf(r.count); } }
      ], months, { step: 24 }));
    }

    h += u.card('Самое дорогое', u.table('woTopT', [
      { title: 'Товар', fn: function (r) { return esc(r.name); } },
      { title: 'Причина', fn: function (r) { return esc(r.reason || '—'); } },
      { title: 'Количество', cls: 'num', fn: function (r) { return u.nf(r.qty, 2); } },
      { title: 'Сумма', cls: 'num', fn: function (r) { return u.priv(r.cost); } }
    ], top, { step: 40 }));
    return h;
  }

  /* --- Неликвиды ---------------------------------------------------------------- */
  function viewDead() {
    var u = U(), c = C();
    if (!c.dead) return need('Неликвиды', 'Что лежит без движения', 'Неликвидные товары');
    var list = c.dead.list;
    var h = u.pageHead('Неликвиды', 'Деньги, которые стоят на полке без движения');
    h += '<div class="stat-grid">' +
      u.stat('Заморожено денег', u.priv(c.dead.total), u.nf(c.dead.count) + ' позиций', 'c-orange') +
      u.stat('Совсем не продавались', u.nf(c.dead.noSale), 'ни одной продажи за период') +
      '</div>';
    var defs = [{ key: 'why', name: 'Почему в списке', options: [
      { v: 'nosale', name: 'Совсем не продавался', test: function (r) { return r.sold <= 0; } },
      { v: 'slow', name: 'Продаётся плохо', test: function (r) { return r.sold > 0; } }
    ] }, { key: 'group', name: 'Группа', auto: function (r) { return r.group; }, limit: 12 }];
    var rows = FLT().apply('dead', list, defs, function (r) { return r.name; });
    h += FLT().bar('dead', defs, list, { search: 'товар' });
    h += u.card('Что лежит', FLT().note(rows.length, list.length) + u.table('deadT', [
      { title: 'Товар', fn: function (r) { return esc(r.name); } },
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

    var h = u.pageHead('Группы товаров', 'Доля в выручке против доли в прибыли');
    h += '<div class="stat-grid">' +
      u.stat('Выручка по группам', u.priv(rev), rows.length + ' групп') +
      u.stat('Валовая прибыль', u.priv(gross), 'выручка минус закуп', 'c-green') +
      u.stat('Общая маржа', u.pct(E.div(gross, rev) * 100), 'сколько остаётся с рубля') +
      '</div>';
    var traps = rows.filter(function (r) { return r.gap < -3 && r.revShare >= 3; });
    if (traps.length) {
      h += '<div class="banner orange"><span>⚠️</span><span>Продаём много, зарабатываем мало: <b>' +
        traps.map(function (r) { return esc(r.group); }).join(', ') + '</b>. Доля в выручке заметно ' +
        'больше доли в прибыли — проверьте наценку.</span></div>';
    }
    h += u.card('Группы по прибыли', u.table('grpT', [
      { title: 'Группа', fn: function (r) { return esc(r.group); } },
      { title: 'Позиций', cls: 'num', fn: function (r) { return u.nf(r.items); } },
      { title: 'Выручка', cls: 'num', fn: function (r) { return u.priv(r.revenue); } },
      { title: 'Доля выручки', cls: 'num', fn: function (r) { return u.pct(r.revShare); } },
      { title: 'Прибыль', cls: 'num', fn: function (r) { return u.priv(r.gross); } },
      { title: 'Доля прибыли', cls: 'num', fn: function (r) { return '<b>' + u.pct(r.profitShare) + '</b>'; } },
      { title: 'Маржа', cls: 'num', fn: function (r) { return u.pct(r.margin); } }
    ], rows, { step: 40 }));
    return h;
  }

  /* --- Рейтинг товаров по прибыли -------------------------------------------------- */
  function viewItemProfit() {
    var u = U(), d = D();
    if (!d.sales.length) return need('Рейтинг по прибыли', 'Кто приносит деньги, а не выручку', 'Продажи');
    var rows = d.sales.map(function (s) {
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

    var h = u.pageHead('Рейтинг по прибыли', 'Не кто больше продаётся, а кто больше приносит');
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
    ] }];
    var list = FLT().apply('itemprof', byProfit, defs, function (r) { return r.name; });
    h += FLT().bar('itemprof', defs, byProfit, { search: 'название товара' });
    h += u.card('Кто приносит деньги', FLT().note(list.length, byProfit.length) + u.table('ipT', [
      { title: '#', cls: 'num', fn: function (r, i) { return u.nf(i + 1); } },
      { title: 'Товар', fn: function (r) { return esc(r.name); } },
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
    var res = G.shelfValue(d.stock, d.sales, c.groupIdx);
    var h = u.pageHead('Полки: что окупает место', 'Сколько прибыли приносит каждый рубль, вложенный в товар');
    function perRub(v) {
      return num(v).toLocaleString('ru-RU', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + ' ₽';
    }
    h += '<div class="stat-grid">' +
      u.stat('Денег в товаре', u.priv(res.money), 'по себестоимости') +
      u.stat('Прибыль с рубля', perRub(res.avgPerRuble), 'в среднем по складу') +
      u.stat('Мёртвых полок', u.nf(res.deadCount), 'приносят меньше трети среднего',
        res.deadCount ? 'c-orange' : 'c-green') +
      '</div>';
    h += u.card('Что стоит на полке', u.table('shelfT', [
      { title: 'Товар', fn: function (r) { return esc(r.name); } },
      { title: 'Группа', fn: function (r) { return esc(r.group || '—'); } },
      { title: 'Денег в товаре', cls: 'num', fn: function (r) { return u.priv(r.money); } },
      { title: 'Прибыль', cls: 'num', fn: function (r) { return u.priv(r.profit); } },
      { title: 'На рубль', cls: 'num', fn: function (r) {
        return '<b class="' + (r.dead ? 'c-orange' : 'c-green') + '">' + perRub(r.perRuble) + '</b>'; } },
      { title: '', cls: 'center', fn: function (r) { return r.dead ? u.badge('место зря', 'orange') : ''; } }
    ], res.rows, { step: 50 }));
    h += '<div class="banner"><span>💡</span><span>Полка не резиновая. Если рубль, вложенный в товар, ' +
      'приносит копейки, его лучше вложить в тот, что приносит рубль.</span></div>';
    return h;
  }

  /* --- Возвраты поставщикам --------------------------------------------------------- */
  function viewReturns() {
    var u = U(), d = D(), c = C();
    if (!d.returns.length) return need('Возвраты поставщикам', 'Что вернули и почему', 'Причины возвратов');
    var byReason = E.byReason(d.returns);
    var h = u.pageHead('Возвраты поставщикам', 'Что вернули и почему' +
      (d.returnsPeriod ? ' · ' + d.returnsPeriod.from + ' – ' + d.returnsPeriod.to : ''));
    h += '<div class="stat-grid">' +
      u.stat('Вернули на сумму', u.priv(c.returnSum), u.nf(d.returns.length) + ' строк') +
      u.stat('Причин', u.nf(byReason.length), 'разных') +
      '</div>';
    h += u.card('По причинам', u.table('retReasonT', [
      { title: 'Причина', fn: function (r) { return esc(r.name); } },
      { title: 'Позиций', cls: 'num', fn: function (r) { return u.nf(r.count); } },
      { title: 'Сумма', cls: 'num', fn: function (r) { return u.priv(r.cost); } }
    ], byReason, { step: 20 }));
    h += u.card('Что возвращали', u.table('retTopT', [
      { title: 'Товар', fn: function (r) { return esc(r.name); } },
      { title: 'Причина', fn: function (r) { return esc(r.reason || '—'); } },
      { title: 'Количество', cls: 'num', fn: function (r) { return u.nf(r.qty, 2); } },
      { title: 'Сумма', cls: 'num', fn: function (r) { return u.priv(r.cost); } }
    ], E.topByCost(d.returns, 60), { step: 40 }));
    return h;
  }

  /* --- ABC-анализ --------------------------------------------------------------------- */
  function viewAbc() {
    var u = U(), d = D(), c = C();
    if (!d.sales.length) return need('ABC-анализ', 'Какие товары дают выручку', 'Продажи');
    var rows = c.abc;
    var counts = { A: 0, B: 0, C: 0 };
    rows.forEach(function (r) { counts[r.abc] = (counts[r.abc] || 0) + 1; });
    var h = u.pageHead('ABC-анализ', 'A — первые 80% выручки, B — до 95%, C — остальное');
    h += '<div class="stat-grid">' +
      u.stat('Группа A', u.nf(counts.A), 'дают 80% выручки', 'c-green') +
      u.stat('Группа B', u.nf(counts.B), 'следующие 15%') +
      u.stat('Группа C', u.nf(counts.C), 'последние 5% — кандидаты на вылет', 'c-orange') +
      '</div>';
    var defs = [{ key: 'abc', name: 'Класс', auto: function (r) { return r.abc; }, limit: 3 }];
    var list = FLT().apply('abc', rows, defs, function (r) { return r.name; });
    h += FLT().bar('abc', defs, rows, { search: 'товар' });
    h += u.card('Товары', FLT().note(list.length, rows.length) + u.table('abcT', [
      { title: 'Товар', fn: function (r) { return esc(r.name); } },
      { title: 'Класс', cls: 'center', fn: function (r) {
        return u.badge(r.abc, r.abc === 'A' ? 'green' : r.abc === 'B' ? 'blue' : 'gray'); } },
      { title: 'Выручка', cls: 'num', fn: function (r) { return u.priv(r.revenue); } },
      { title: 'Доля', cls: 'num', fn: function (r) { return u.pct(r.share); } },
      { title: 'Накопленно', cls: 'num', fn: function (r) { return u.pct(r.cum); } }
    ], list, { step: 50 }));
    return h;
  }

  /* --- Цены поставщиков ---------------------------------------------------------------- */
  function viewPrices() {
    var u = U(), d = D();
    if (!d.prices.length) return need('Цены поставщиков', 'Где дешевле', 'Текущие цены поставщиков');
    var cmp = E.priceComparison(d.prices, d.stock);
    var h = u.pageHead('Цены поставщиков', u.nf(d.prices.length) + ' цен от ' +
      u.nf(cmp.suppliers) + ' поставщиков');
    h += '<div class="stat-grid">' +
      u.stat('Можно сэкономить', u.priv(cmp.saveTotal), 'если брать у самого дешёвого', 'c-green') +
      u.stat('Позиций с выбором', u.nf(cmp.rows.filter(function (r) { return r.count > 1; }).length),
        'есть из кого выбрать') +
      '</div>';
    var defs = [{ key: 'ch', name: 'Есть выбор', options: [
      { v: 'many', name: 'Двое и больше', test: function (r) { return r.count > 1; } },
      { v: 'one', name: 'Один поставщик', test: function (r) { return r.count === 1; } }
    ] }];
    var list = FLT().apply('prices', cmp.rows, defs, function (r) { return r.name; });
    h += FLT().bar('prices', defs, cmp.rows, { search: 'товар' });
    h += u.card('Где дешевле', FLT().note(list.length, cmp.rows.length) + u.table('priceT', [
      { title: 'Товар', fn: function (r) { return esc(r.name); } },
      { title: 'Дешевле у', fn: function (r) { return esc(r.bestSupplier || '—'); } },
      { title: 'Лучшая цена', cls: 'num', fn: function (r) { return u.priv(r.best); } },
      { title: 'Худшая', cls: 'num', fn: function (r) { return u.priv(r.worst); } },
      { title: 'Разница', cls: 'num', fn: function (r) {
        return r.diff ? '<span class="c-green private">' + money(r.diff) + '</span>' : '—'; } },
      { title: 'Поставщиков', cls: 'num', fn: function (r) { return u.nf(r.count); } }
    ], list, { step: 50 }));
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
      '<button class="btn btn-primary" data-form="payPlan">＋ Запланировать выплату</button>');

    h += '<div class="stat-grid">' +
      u.stat('Должны поставщикам', u.priv(debt.debt), 'общей суммой по магазину',
        debt.debt >= num(S.settings.debtCrit) ? 'c-red' : '') +
      u.stat('Взято в долг', u.priv(debt.taken), 'за всё время') +
      u.stat('Погашено', u.priv(debt.paid), 'за всё время', 'c-green') +
      u.stat('Просрочено выплат', u.priv(pt.overdue), pt.overdueCount + ' платежей',
        pt.overdue ? 'c-red' : 'c-green') +
      '</div>';

    h += '<div class="banner blue"><span>💼</span><span>Долг магазина ведётся <b>общей суммой</b>: ' +
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
      return h + '<div class="card"><div class="empty">Пока мало данных: сезонность видно ' +
        'после нескольких месяцев работы.</div></div>';
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

  var VIEWS = window.WM_EXTRA_VIEWS = window.WM_EXTRA_VIEWS || [];
  VIEWS.push(
    { id: 'suppliers', icon: '🤝', name: 'Поставщики и долг', group: 'Деньги', render: viewSuppliers },
    { id: 'stock', icon: '📦', name: 'Склад', group: 'Товары', render: viewStock },
    { id: 'orders', icon: '🚚', name: 'Заказы', group: 'Товары', render: viewOrders },
    { id: 'expiry', icon: '⏰', name: 'Сроки годности', group: 'Товары', render: viewExpiry },
    { id: 'losses', icon: '🗑', name: 'Списания', group: 'Товары', render: viewLosses },
    { id: 'dead', icon: '🧊', name: 'Неликвиды', group: 'Товары', render: viewDead },
    { id: 'groups', icon: '📊', name: 'Группы товаров', group: 'Товары', render: viewGroups },
    { id: 'itemprofit', icon: '🏆', name: 'Рейтинг по прибыли', group: 'Товары', render: viewItemProfit },
    { id: 'shelf', icon: '🧱', name: 'Полки: что окупает место', group: 'Товары', render: viewShelf },
    { id: 'returns', icon: '↩️', name: 'Возвраты поставщикам', group: 'Товары', render: viewReturns },
    { id: 'abc', icon: '🥇', name: 'ABC-анализ', group: 'Товары', render: viewAbc },
    { id: 'pricecmp', icon: '🏷', name: 'Цены поставщиков', group: 'Товары', render: viewPrices },
    { id: 'seasons', icon: '🗓', name: 'Сезонность', group: 'Отчёты', render: viewSeasons }
  );
})();

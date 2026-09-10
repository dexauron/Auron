/* ============================================================================
   Товар: цены, сезонность, мёртвые полки, возвраты поставщику.

   72 — история цен товара: когда и на сколько дорожал;
   73 — предупреждение «поставщик поднял цену на 12%»;
   74 — сезонность: что берут летом, что зимой;
   75 — что покупают вместе (по тому, что везут одной накладной);
   76 — мёртвые полки: группы, которые не окупают место;
   84 — возврат поставщику как документ.
   ========================================================================== */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.WMGoods = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  function num(v) {
    if (typeof v === 'number') return isFinite(v) ? v : 0;
    var n = parseFloat(String(v == null ? '' : v).replace(/\s/g, '').replace(',', '.'));
    return isFinite(n) ? n : 0;
  }
  function norm(v) { return String(v == null ? '' : v).trim().toLowerCase().replace(/ё/g, 'е'); }
  function round(v) { return Math.round(v * 100) / 100; }
  function today() { return new Date().toISOString().slice(0, 10); }

  /* --- 72/73. История цен ----------------------------------------------------
     Каждая загрузка прайса — снимок цен на дату. Складываем снимки в историю
     и смотрим, что подорожало. Снимок за тот же день перезаписывается.
     ---------------------------------------------------------------------- */
  /* --- 74. Сезонность --------------------------------------------------------
     Продажи по месяцам из накладных прихода: что и когда завозят больше.
     Это не идеально (приход ≠ продажа), но других помесячных данных в
     выгрузках 1С нет — так и говорим владельцу.
     ---------------------------------------------------------------------- */
  var MONTH_RU = ['январь', 'февраль', 'март', 'апрель', 'май', 'июнь',
    'июль', 'август', 'сентябрь', 'октябрь', 'ноябрь', 'декабрь'];

  function seasons(dds, isIncome) {
    var by = {}, total = 0;
    (dds || []).forEach(function (r) {
      if (!r.date || (isIncome && !isIncome(r))) return;
      var m = +r.date.slice(5, 7) - 1;
      if (m < 0 || m > 11) return;
      by[m] = (by[m] || 0) + num(r.amount);
      total += num(r.amount);
    });
    var months = [];
    for (var i = 0; i < 12; i++) {
      var sum = round(by[i] || 0);
      months.push({ m: i, name: MONTH_RU[i], sum: sum,
        share: total ? round(sum / total * 100) : 0 });
    }
    var withData = months.filter(function (x) { return x.sum > 0; });
    var avg = withData.length ? total / withData.length : 0;
    months.forEach(function (x) {
      x.vsAvg = avg ? round((x.sum - avg) / avg * 100) : 0;
      x.kind = !x.sum ? 'нет данных' : (x.vsAvg > 15 ? 'сезон' : (x.vsAvg < -15 ? 'затишье' : 'обычно'));
    });
    return { months: months, total: round(total), avg: round(avg), monthsWithData: withData.length };
  }

  // Сезонность группы товаров по приходам
  function groupSeasons(docs, groupIdx) {
    var by = {};
    (docs || []).forEach(function (d) {
      if (!d.date) return;
      var m = +d.date.slice(5, 7) - 1;
      var k = 'все';
      if (!by[k]) by[k] = new Array(12).fill(0);
      by[k][m] += num(d.sum);
    });
    return by;
  }

  /* --- 75. Что везут вместе --------------------------------------------------
     Настоящих чеков в выгрузках нет, поэтому смотрим, какие поставщики
     приезжают в один день — это подсказывает, как строить приёмку.
     ---------------------------------------------------------------------- */
  function together(docs, minTimes) {
    var need = num(minTimes) || 3;
    var byDay = {};
    (docs || []).forEach(function (d) {
      if (!d.date || !d.firm) return;
      (byDay[d.date] = byDay[d.date] || {})[norm(d.firm)] = d.firm;
    });
    var pairs = {};
    Object.keys(byDay).forEach(function (day) {
      var firms = Object.keys(byDay[day]).sort();
      for (var i = 0; i < firms.length; i++) {
        for (var j = i + 1; j < firms.length; j++) {
          var k = firms[i] + ' + ' + firms[j];
          if (!pairs[k]) pairs[k] = { a: byDay[day][firms[i]], b: byDay[day][firms[j]], days: 0 };
          pairs[k].days++;
        }
      }
    });
    var out = [];
    Object.keys(pairs).forEach(function (k) {
      if (pairs[k].days >= need) out.push(pairs[k]);
    });
    return out.sort(function (a, b) { return b.days - a.days; }).slice(0, 40);
  }

  /* --- 76. Мёртвые полки: группы, которые не окупают место -------------------
     Считаем по группе: сколько денег в ней заморожено на складе и сколько
     она приносит. Отношение «прибыль на вложенный рубль» и показывает,
     стоит ли группа своего места.
     ---------------------------------------------------------------------- */
  function shelfValue(stock, sales, groupIdx) {
    var g = {};
    function cell(name) {
      var k = norm(name || 'без группы');
      if (!g[k]) g[k] = { group: name || 'Без группы', stockSum: 0, sku: 0,
        revenue: 0, profit: 0, sold: 0, soldSku: 0 };
      return g[k];
    }
    (stock || []).forEach(function (r) {
      var c = cell(r.group);
      c.stockSum += num(r.buySum); c.sku++;
    });
    (sales || []).forEach(function (r) {
      var c = cell((groupIdx || {})[r.key]);
      c.revenue += num(r.revenue); c.profit += num(r.profit);
      c.sold += num(r.qty); c.soldSku++;
    });
    var out = [];
    Object.keys(g).forEach(function (k) {
      var c = g[k];
      c.stockSum = round(c.stockSum); c.revenue = round(c.revenue); c.profit = round(c.profit);
      // сколько прибыли приносит каждый рубль, замороженный на полке
      c.perRuble = c.stockSum ? round(c.profit / c.stockSum * 100) / 100 : null;
      c.deadSku = c.sku - c.soldSku;
      out.push(c);
    });
    out.sort(function (a, b) {
      if (a.perRuble === null) return 1;
      if (b.perRuble === null) return -1;
      return a.perRuble - b.perRuble;
    });
    var totalStock = out.reduce(function (a, c) { return a + c.stockSum; }, 0);
    var totalProfit = out.reduce(function (a, c) { return a + c.profit; }, 0);
    var avg = totalStock ? totalProfit / totalStock : 0;
    out.forEach(function (c) {
      c.share = totalStock ? round(c.stockSum / totalStock * 100) : 0;
      c.vsAvg = avg && c.perRuble !== null ? round((c.perRuble - avg) / avg * 100) : null;
      c.dead = c.perRuble !== null && avg > 0 && c.perRuble < avg * 0.35 && c.stockSum > 0;
    });
    return { rows: out, avgPerRuble: round(avg * 100) / 100,
      totalStock: round(totalStock), totalProfit: round(totalProfit),
      deadCount: out.filter(function (c) { return c.dead; }).length,
      deadMoney: round(out.filter(function (c) { return c.dead; })
        .reduce(function (a, c) { return a + c.stockSum; }, 0)) };
  }

  /* --- 84. Возврат поставщику как документ ------------------------------------ */
  return {
    seasons: seasons, groupSeasons: groupSeasons, together: together,
    shelfValue: shelfValue, MONTH_RU: MONTH_RU
  };
});

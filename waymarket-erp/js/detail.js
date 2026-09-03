/* ============================================================================
   Кнопка «Подробнее» для всего.
   Где бы ни стояла цифра — рядом кнопка. Нажали: открывается окно, в котором
   собрано ВСЁ, что с этой цифрой связано. Поставщик — его накладные, оплаты,
   долг, телефон, цены. Товар — продажи, остаток, цены поставщиков, срок
   годности, списания. День — выручка, расходы, смены, приходы.

   Из экрана достаточно вставить кнопку:
       WMDetail.btn('firm', 'молоко юг')            → «Подробнее»
       WMDetail.link('product', key, 'Название')    → ссылка-название

   Обработчик клика ловит data-more="вид|ключ" и открывает окно сам.
   ========================================================================== */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.WMDetail = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  var G = typeof window !== 'undefined' ? window : (typeof self !== 'undefined' ? self : {});
  function u() { return G.WMUI || {}; }
  function S() { return G.WMStore || { state: {}, settings: {} }; }
  function E() { return G.WMEngine || {}; }
  function SUP() { return G.WMSupply || {}; }
  function D() { return u().data ? u().data() : {}; }
  function C() { return u().calc ? u().calc() : {}; }

  // экранирование своё, а не из интерфейса: кнопка должна быть безопасной
  // даже когда модуль вызывают отдельно (например, в проверках)
  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }
  function money(v) { return u().money ? u().money(v) : String(v); }
  function priv(v) { return u().priv ? u().priv(v) : money(v); }
  function nf(v) { return u().nf ? u().nf(v) : String(v); }
  function dateRu(v) { return u().dateRu ? u().dateRu(v) : String(v || ''); }
  function num(v) { return E().num ? E().num(v) : (parseFloat(v) || 0); }
  function norm(v) { return E().norm ? E().norm(v) : String(v || '').toLowerCase(); }
  function round(v) { return Math.round(v * 100) / 100; }

  /* --- Мелкие кирпичики окна ------------------------------------------------ */
  function facts(pairs) {
    var rows = pairs.filter(function (p) { return p && p[1] !== '' && p[1] != null; });
    if (!rows.length) return '';
    return '<div class="facts">' + rows.map(function (p) {
      return '<div class="fact"><div class="fact-label">' + esc(p[0]) + '</div>' +
        '<div class="fact-value' + (p[2] ? ' ' + p[2] : '') + '">' + p[1] + '</div></div>';
    }).join('') + '</div>';
  }
  function block(title, html, empty) {
    if (!html) return title ? '<div class="det-block"><h4>' + esc(title) + '</h4>' +
      '<div class="empty">' + esc(empty || 'Ничего нет') + '</div></div>' : '';
    return '<div class="det-block">' + (title ? '<h4>' + esc(title) + '</h4>' : '') + html + '</div>';
  }
  // Простая таблица внутри окна: без страниц, но с ограничением по строкам
  function mini(cols, rows, limit) {
    if (!rows.length) return '';
    var lim = limit || 60;
    var h = '<div class="table-wrap"><table class="data"><thead><tr>';
    cols.forEach(function (c) { h += '<th class="' + (c.cls || '') + '">' + esc(c.title) + '</th>'; });
    h += '</tr></thead><tbody>';
    rows.slice(0, lim).forEach(function (r) {
      h += '<tr>';
      cols.forEach(function (c) { h += '<td class="' + (c.cls || '') + '">' + c.fn(r) + '</td>'; });
      h += '</tr>';
    });
    if (rows.length > lim) {
      h += '<tr><td colspan="' + cols.length + '"><div class="c-muted">…и ещё ' +
        nf(rows.length - lim) + '</div></td></tr>';
    }
    return h + '</tbody></table></div>';
  }
  function sum(rows, field) {
    var s = 0; for (var i = 0; i < rows.length; i++) s += num(rows[i][field]); return round(s);
  }
  function nothing(what) {
    return '<div class="empty">' + esc(what) + '</div>';
  }

  /* --- Кнопки, которые ставятся в экранах ----------------------------------- */
  function btn(kind, key, label) {
    return '<button class="btn btn-sm" data-more="' + esc(kind) + '|' + esc(key) + '">' +
      esc(label || 'Подробнее') + '</button>';
  }
  function link(kind, key, text) {
    return '<a class="more-link" href="#" data-more="' + esc(kind) + '|' + esc(key) + '">' + esc(text) + '</a>';
  }
  function chev(kind, key) {
    return '<button class="btn btn-sm btn-ghost" data-more="' + esc(kind) + '|' + esc(key) + '" title="Подробнее">›</button>';
  }

  /* ==========================================================================
     Разделы: что показывать для каждого вида
     ======================================================================== */

  /* Поставщик (фирма) */
  function firmDetail(key) {
    var c = C().sup, k = norm(key);
    if (!c) return { title: 'Поставщик', html: nothing('Данных о поставках ещё нет.') };
    var f = null;
    c.firms.forEach(function (x) { if (norm(x.firm) === k) f = x; });
    var docs = c.docs.filter(function (d) { return norm(d.firm) === k; });
    var pays = (S().state.pays || []).filter(function (p) { return norm(p.firm) === k; });
    var name = f ? f.firm : (docs[0] ? docs[0].firm : key);
    var reg = SUP().findFirm ? SUP().findFirm(S().state.supreg || [], name) : null;
    var prices = (D().prices || []).filter(function (p) { return norm(p.supplier) === k; });

    var h = facts([
      ['Долг сейчас', priv(f ? f.left : 0), f && f.left > 0 ? 'c-red' : 'c-green'],
      ['Просрочено', f && f.overdue ? priv(f.overdue) : money(0), f && f.overdue ? 'c-red' : ''],
      ['Переплата', f && f.over ? priv(f.over) : money(0), f && f.over ? 'c-orange' : ''],
      ['Всего поставок', priv(f ? f.sum : sum(docs, 'sum'))],
      ['Всего оплачено', priv(f ? f.paid : sum(pays, 'sum'))],
      ['Накладных', nf(docs.length)],
      ['Оплат', nf(pays.length)],
      ['Отсрочка', f && f.term !== null && f.term !== undefined ? f.term + ' дн.' : 'не задана'],
      ['Ближайший срок', f && f.due ? dateRu(f.due) : '—'],
      ['Телефон', f && f.phone ? '<a href="tel:' + esc(f.phone) + '">' + esc(f.phone) + '</a>' : '—'],
      ['Обычная оплата', f && f.method ? esc(f.method) : '—'],
      ['Позиций в прайсе', prices.length ? nf(prices.length) : '—']
    ]);

    if (f && f.reps && f.reps.length) {
      h += block('Так фирма называется в 1С', '<div class="chips">' + f.reps.map(function (r) {
        return '<span class="chip">' + esc(r) + '</span>';
      }).join('') + '</div>');
    }
    if (reg && reg.note) h += block('Заметка', '<div class="note-box">' + esc(reg.note) + '</div>');

    h += block('Накладные', mini([
      { title: 'Дата', fn: function (r) { return esc(dateRu(r.date)); } },
      { title: 'Документ', fn: function (r) { return link('doc', r.id, r.doc); } },
      { title: 'Сумма', cls: 'num', fn: function (r) { return priv(r.sum); } },
      { title: 'Оплачено', cls: 'num', fn: function (r) { return priv(r.paid); } },
      { title: 'Долг', cls: 'num', fn: function (r) {
        return '<span class="' + (r.left > 0 ? 'c-red' : 'c-green') + ' private">' + money(r.left) + '</span>'; } },
      { title: 'Платить', fn: function (r) { return r.left > 0 ? esc(dateRu(r.due)) + (r.confirmed ? '' : ' <small class="c-muted">не подтв.</small>') : '—'; } }
    ], docs), 'Накладных от этой фирмы нет');

    h += block('Оплаты', mini([
      { title: 'Дата', fn: function (r) { return esc(dateRu(r.date)); } },
      { title: 'Документ', fn: function (r) { return link('pay', r.id, SUP().shortDoc ? SUP().shortDoc(r.doc) : r.doc); } },
      { title: 'Сумма', cls: 'num', fn: function (r) { return priv(r.sum); } },
      { title: 'К чему привязана', fn: function (r) { return esc(linkText(r)); } }
    ], pays.slice().sort(function (a, b) { return (b.date || '').localeCompare(a.date || ''); })),
      'Оплат этой фирме нет');

    if (prices.length) {
      h += block('Цены этого поставщика', mini([
        { title: 'Товар', fn: function (r) { return link('product', r.key, r.name); } },
        { title: 'Группа', fn: function (r) { return esc(r.group || '—'); } },
        { title: 'Цена', cls: 'num', fn: function (r) { return priv(r.price); } }
      ], prices.slice().sort(function (a, b) { return b.price - a.price; }), 40));
    }

    h += '<div class="quick"><button class="btn" data-form="supFirm" data-more-firm="' + esc(name) +
      '">✏️ Правка справочника</button>' +
      '<button class="btn" data-go="terms">⏱ Отсрочки</button></div>';
    return { title: name, html: h };
  }

  function linkText(p) {
    if (p.linkKind === 'auto' || p.linkKind === 'manual') return 'к накладной';
    if (p.linkKind === 'old') return 'старый долг';
    if (p.linkKind === 'advance') return 'аванс';
    if (p.linkKind === 'expense') return 'расход: ' + (p.category || p.article || '—');
    return 'не разобрано';
  }

  /* Накладная */
  function docDetail(id) {
    var c = C().sup;
    var d = c ? c.docs.filter(function (x) { return x.id === id; })[0] : null;
    if (!d) return { title: 'Накладная', html: nothing('Накладная не найдена.') };
    var pays = (S().state.pays || []).filter(function (p) {
      return (p.linkKind === 'auto' || p.linkKind === 'manual') && p.linkKey === d.key;
    });
    var h = facts([
      ['Поставщик', link('firm', norm(d.firm), d.firm)],
      ['Документ', esc(d.fullDoc || d.doc)],
      ['Дата прихода', esc(dateRu(d.date))],
      ['Входящий номер', d.incomingNo ? esc(d.incomingNo) : '—'],
      ['Сумма закупа', priv(d.sum)],
      ['Сумма в рознице', d.retail ? priv(d.retail) : '—'],
      ['Наценка', d.retail && d.sum ? Math.round((d.retail / d.sum - 1) * 100) + '%' : '—'],
      ['Оплачено', priv(d.paid)],
      ['Долг', '<span class="' + (d.left > 0 ? 'c-red' : 'c-green') + ' private">' + money(d.left) + '</span>'],
      ['Переплата', d.over ? priv(d.over) : '—', d.over ? 'c-orange' : ''],
      ['Списано округление', d.roundOff ? priv(d.roundOff) : '—'],
      ['Отсрочка', d.termKnown ? d.term + ' дн.' : 'не задана (' + d.term + ' по умолчанию)'],
      ['Платить', d.left > 0 ? esc(dateRu(d.due)) : '—', d.overdue ? 'c-red' : ''],
      ['Состояние', esc(d.statusText)]
    ]);
    if (!d.confirmed && d.left > 0) {
      h += '<div class="banner"><span>✅</span><span>Дата выплаты ещё не подтверждена — накладная не попадает в план ' +
        'и не считается просроченной.</span><button class="btn" data-go="confirm">Подтвердить</button></div>';
    }
    h += block('Оплаты по этой накладной', mini([
      { title: 'Дата', fn: function (r) { return esc(dateRu(r.date)); } },
      { title: 'Документ', fn: function (r) { return link('pay', r.id, SUP().shortDoc ? SUP().shortDoc(r.doc) : r.doc); } },
      { title: 'Касса', fn: function (r) { return esc(r.cashbox || '—'); } },
      { title: 'Сумма', cls: 'num', fn: function (r) { return priv(r.sum); } }
    ], pays), 'Оплат по этой накладной пока нет');

    h += '<div class="quick"><button class="btn" data-edit="docs:' + esc(d.id) + ':supDoc">✏️ Изменить</button>' +
      '<button class="btn" data-del="docs:' + esc(d.id) + '">🗑 Удалить</button></div>';
    return { title: 'Накладная ' + (d.doc || ''), html: h };
  }

  /* Оплата */
  function payDetail(id) {
    var p = (S().state.pays || []).filter(function (x) { return x.id === id; })[0];
    if (!p) return { title: 'Оплата', html: nothing('Оплата не найдена.') };
    var c = C().sup;
    var doc = c && p.linkKey ? c.docs.filter(function (d) { return d.key === p.linkKey; })[0] : null;
    var h = facts([
      ['Поставщик', p.firm ? link('firm', norm(p.firm), p.firm) : '—'],
      ['Имя в 1С', p.supplier ? esc(p.supplier) : '—'],
      ['Документ', esc(p.doc || '—')],
      ['Дата', esc(dateRu(p.date))],
      ['Сумма', priv(p.sum)],
      ['Касса', esc(p.cashbox || '—')],
      ['Вид операции', esc(p.operation || '—')],
      ['Статья ДДС', esc(p.article || '—')],
      ['Основание', esc(p.basis || '—')],
      ['Привязка', esc(linkText(p))],
      ['Накладная', doc ? link('doc', doc.id, doc.doc) : '—']
    ]);
    h += '<div class="quick"><button class="btn" data-edit="pays:' + esc(p.id) + ':supPay">✏️ Изменить</button>' +
      '<button class="btn" data-go="recon">🧷 Разбор оплат</button>' +
      '<button class="btn" data-del="pays:' + esc(p.id) + '">🗑 Удалить</button></div>';
    return { title: 'Оплата ' + (SUP().shortDoc ? SUP().shortDoc(p.doc) : p.doc || ''), html: h };
  }

  /* Товар */
  function productDetail(key) {
    var k = norm(key);
    var sale = (D().sales || []).filter(function (r) { return r.key === k; })[0];
    var st = (C().stockIdx || {})[k];
    var prices = (D().prices || []).filter(function (r) { return r.key === k; })
      .sort(function (a, b) { return a.price - b.price; });
    var name = (sale && sale.name) || (st && st.name) || (prices[0] && prices[0].name) || key;
    var days = D().salesPeriod ? D().salesPeriod.days : 30;
    var perDay = sale && days ? round(sale.qty / days) : 0;
    var abcRow = (C().abc || []).filter(function (r) { return r.key === k; })[0];
    var dead = C().dead ? (C().dead.list || []).filter(function (r) { return r.key === k; })[0] : null;
    var exp = (S().state.expiry || []).filter(function (r) { return norm(r.name) === k; });
    var inv = (S().state.inventory || []).filter(function (r) { return norm(r.name) === k; });
    var wo = (D().writeoffs || []).filter(function (r) { return norm(r.name) === k; });

    var h = facts([
      ['Группа', esc((st && st.group) || (prices[0] && prices[0].group) || '—')],
      ['Штрихкод', st && st.barcode ? esc(st.barcode) : '—'],
      ['Остаток', st ? nf(st.qty) + ' ' + esc(st.unit || '') : '—', st && st.qty <= 0 ? 'c-red' : ''],
      ['Остаток в закупе', st ? priv(st.buySum) : '—'],
      ['Цена закупа', st && st.buyPrice ? priv(st.buyPrice) : '—'],
      ['Цена продажи', st && st.retailPrice ? priv(st.retailPrice) : '—'],
      ['Наценка', st && st.buyPrice ? Math.round((st.retailPrice / st.buyPrice - 1) * 100) + '%' : '—'],
      ['Продано за период', sale ? nf(sale.qty) : '—'],
      ['Выручка', sale ? priv(sale.revenue) : '—'],
      ['Прибыль', sale ? priv(sale.profit) : '—'],
      ['Маржа', sale && sale.revenue ? Math.round(sale.profit / sale.revenue * 100) + '%' : '—'],
      ['Уходит в день', perDay ? nf(perDay) : '—'],
      ['Хватит на', perDay && st ? Math.floor(st.qty / perDay) + ' дн.' : '—'],
      ['ABC', abcRow ? abcRow.abc + ' (' + abcRow.share + '% оборота)' : '—'],
      ['Лежит без продаж', dead ? dead.left + ' на ' + money(dead.money) : '—', dead ? 'c-orange' : '']
    ]);

    if (prices.length) {
      h += block('Цены поставщиков — от дешёвого к дорогому', mini([
        { title: 'Поставщик', fn: function (r) { return link('firm', norm(r.supplier), r.supplier || '—'); } },
        { title: 'Цена', cls: 'num', fn: function (r) { return priv(r.price); } },
        { title: 'Разница с лучшей', cls: 'num', fn: function (r) {
          var d = r.price - prices[0].price;
          return d ? '<span class="c-red">+' + money(d) + '</span>' : '<span class="c-green">лучшая</span>'; } }
      ], prices));
    }
    if (exp.length) {
      h += block('Сроки годности', mini([
        { title: 'Годен до', fn: function (r) { return esc(dateRu(r.bestBefore)); } },
        { title: 'Осталось', cls: 'num', fn: function (r) { return nf(num(r.qty)); } },
        { title: 'Цена', cls: 'num', fn: function (r) { return priv(num(r.price)); } }
      ], exp));
    }
    if (inv.length || wo.length) {
      var losses = inv.map(function (r) {
        return { date: r.date, reason: r.reason || 'пересчёт',
          qty: num(r.fact) - num(r.accounted), cost: (num(r.fact) - num(r.accounted)) * num(r.price) };
      }).concat(wo.map(function (r) {
        return { date: r.date || '', reason: r.reason || 'списание 1С', qty: -num(r.qty), cost: -num(r.cost) };
      }));
      h += block('Списания и пересчёты', mini([
        { title: 'Дата', fn: function (r) { return esc(dateRu(r.date)) || '—'; } },
        { title: 'Причина', fn: function (r) { return esc(r.reason); } },
        { title: 'Количество', cls: 'num', fn: function (r) { return nf(r.qty); } },
        { title: 'Деньги', cls: 'num', fn: function (r) {
          return '<span class="' + (r.cost < 0 ? 'c-red' : 'c-green') + ' private">' + money(r.cost) + '</span>'; } }
      ], losses));
    }

    h += '<div class="quick">' +
      '<button class="btn" data-form="expiryItem" data-more-name="' + esc(name) + '">⏰ Записать срок</button>' +
      '<button class="btn" data-form="writeoff" data-more-name="' + esc(name) + '">🗑 Списать</button>' +
      '<button class="btn" data-go="orders">🚚 Заказы</button></div>';
    return { title: name, html: h };
  }

  /* Товарная группа */
  function groupDetail(name) {
    var k = norm(name);
    var idx = C().groupIdx || {};
    var sales = (D().sales || []).filter(function (r) { return norm(idx[r.key]) === k; });
    var stock = (D().stock || []).filter(function (r) { return norm(r.group) === k; });
    var t = E().salesTotals ? E().salesTotals(sales) : { revenue: 0, gross: 0, margin: 0 };
    var stTot = E().stockTotals ? E().stockTotals(stock) : { buySum: 0, retailSum: 0, sku: 0 };
    var h = facts([
      ['Выручка', priv(t.revenue)],
      ['Прибыль', priv(t.gross)],
      ['Маржа', (t.margin || 0) + '%'],
      ['Позиций в продаже', nf(sales.length)],
      ['Позиций на складе', nf(stTot.sku)],
      ['Остаток в закупе', priv(stTot.buySum)],
      ['Остаток в рознице', priv(stTot.retailSum)]
    ]);
    h += block('Топ по выручке', mini([
      { title: 'Товар', fn: function (r) { return link('product', r.key, r.name); } },
      { title: 'Продано', cls: 'num', fn: function (r) { return nf(r.qty); } },
      { title: 'Выручка', cls: 'num', fn: function (r) { return priv(r.revenue); } },
      { title: 'Прибыль', cls: 'num', fn: function (r) { return priv(r.profit); } }
    ], sales.slice().sort(function (a, b) { return b.revenue - a.revenue; }), 40), 'Продаж в группе нет');
    h += block('Лежит на складе больше всего денег', mini([
      { title: 'Товар', fn: function (r) { return link('product', r.key, r.name); } },
      { title: 'Остаток', cls: 'num', fn: function (r) { return nf(r.qty); } },
      { title: 'В закупе', cls: 'num', fn: function (r) { return priv(r.buySum); } }
    ], stock.slice().sort(function (a, b) { return b.buySum - a.buySum; }), 40), 'Остатков в группе нет');
    return { title: 'Группа: ' + name, html: h };
  }

  /* Сотрудник */
  function employeeDetail(name) {
    var k = norm(name);
    var ts = (S().state.timesheet || []).filter(function (r) { return norm(r.employee) === k; });
    var po = (S().state.payouts || []).filter(function (r) { return norm(r.employee) === k; });
    var sumRow = (E().payrollSummary ? E().payrollSummary(ts, po) : [])[0] ||
      { accrued: 0, paid: 0, left: 0, hours: 0, shifts: 0, bonus: 0, penalty: 0, position: '' };
    var h = facts([
      ['Должность', esc(sumRow.position || '—')],
      ['Смен', nf(sumRow.shifts)],
      ['Часов', nf(sumRow.hours)],
      ['Начислено', priv(sumRow.accrued)],
      ['Премии', sumRow.bonus ? priv(sumRow.bonus) : '—'],
      ['Штрафы', sumRow.penalty ? priv(sumRow.penalty) : '—', sumRow.penalty ? 'c-red' : ''],
      ['Выдано', priv(sumRow.paid)],
      ['Осталось выдать', priv(sumRow.left), sumRow.left > 0 ? 'c-orange' : 'c-green']
    ]);
    h += block('Смены', mini([
      { title: 'Дата', fn: function (r) { return esc(dateRu(r.date)); } },
      { title: 'Смена', fn: function (r) { return esc(r.shift || '—'); } },
      { title: 'Часы', cls: 'num', fn: function (r) { return nf(num(r.hours)); } },
      { title: 'Ставка', cls: 'num', fn: function (r) { return priv(num(r.rate)); } },
      { title: 'Премия', cls: 'num', fn: function (r) { return num(r.bonus) ? priv(num(r.bonus)) : '—'; } },
      { title: 'Штраф', cls: 'num', fn: function (r) { return num(r.penalty) ? '<span class="c-red private">' + money(num(r.penalty)) + '</span>' : '—'; } },
      { title: 'Начислено', cls: 'num', fn: function (r) { return priv(E().timesheetCalc ? E().timesheetCalc(r) : 0); } },
      { title: '', cls: 'center', fn: function (r) { return '<button class="btn btn-sm" data-edit="timesheet:' + esc(r.id) + ':timesheet">✏️</button>'; } }
    ], ts.slice().sort(function (a, b) { return (b.date || '').localeCompare(a.date || ''); })), 'Смен не записано');
    h += block('Выплаты', mini([
      { title: 'Дата', fn: function (r) { return esc(dateRu(r.date)); } },
      { title: 'Что', fn: function (r) { return esc(r.type || '—'); } },
      { title: 'Чем', fn: function (r) { return esc(r.form || '—'); } },
      { title: 'Сумма', cls: 'num', fn: function (r) { return priv(num(r.amount)); } },
      { title: '', cls: 'center', fn: function (r) { return '<button class="btn btn-sm" data-edit="payouts:' + esc(r.id) + ':payout">✏️</button>'; } }
    ], po.slice().sort(function (a, b) { return (b.date || '').localeCompare(a.date || ''); })), 'Выплат не было');
    h += '<div class="quick">' +
      '<button class="btn btn-primary" data-form="payout" data-employee="' + esc(name) + '">💰 Выдать</button>' +
      '<button class="btn" data-form="timesheet" data-employee="' + esc(name) + '">🕒 Записать смену</button></div>';
    return { title: name, html: h };
  }

  /* Статья расходов */
  function categoryDetail(name) {
    var k = norm(name);
    var rows = (S().state.dds || []).filter(function (r) { return norm(r.category) === k; });
    var exp = rows.filter(function (r) { return r.type === 'Расход' || r.type === 'Долг'; });
    var byMonth = {};
    exp.forEach(function (r) {
      var m = (r.date || '').slice(0, 7);
      byMonth[m] = round((byMonth[m] || 0) + num(r.amount));
    });
    var months = Object.keys(byMonth).sort().reverse().map(function (m) { return { m: m, v: byMonth[m] }; });
    var h = facts([
      ['Всего потрачено', priv(sum(exp, 'amount'))],
      ['Операций', nf(exp.length)],
      ['Средняя операция', exp.length ? priv(sum(exp, 'amount') / exp.length) : '—'],
      ['В среднем в месяц', months.length ? priv(sum(exp, 'amount') / months.length) : '—']
    ]);
    h += block('По месяцам', mini([
      { title: 'Месяц', fn: function (r) { return link('month', r.m, monthRu(r.m)); } },
      { title: 'Потрачено', cls: 'num', fn: function (r) { return priv(r.v); } }
    ], months), 'Пока пусто');
    h += block('Все операции', mini([
      { title: 'Дата', fn: function (r) { return link('day', r.date, dateRu(r.date)); } },
      { title: 'Способ', fn: function (r) { return esc(r.method || '—'); } },
      { title: 'Комментарий', fn: function (r) { return esc(r.note || '—'); } },
      { title: 'Сумма', cls: 'num', fn: function (r) { return priv(num(r.amount)); } },
      { title: '', cls: 'center', fn: function (r) { return '<button class="btn btn-sm" data-edit="dds:' + esc(r.id) + ':ddsExpense">✏️</button>'; } }
    ], exp.slice().sort(function (a, b) { return (b.date || '').localeCompare(a.date || ''); })), 'Операций нет');
    return { title: 'Статья: ' + name, html: h };
  }

  function monthRu(m) {
    var mon = ['январь', 'февраль', 'март', 'апрель', 'май', 'июнь', 'июль',
      'август', 'сентябрь', 'октябрь', 'ноябрь', 'декабрь'];
    var p = String(m || '').split('-');
    return p.length === 2 ? mon[+p[1] - 1] + ' ' + p[0] : m;
  }

  /* День */
  function dayDetail(date) {
    var dds = (S().state.dds || []).filter(function (r) { return r.date === date; });
    var inc = dds.filter(function (r) { return r.type === 'Приход'; });
    var exp = dds.filter(function (r) { return r.type === 'Расход' || r.type === 'Долг'; });
    var draw = dds.filter(function (r) { return r.type === 'Забор'; });
    var docs = (C().sup ? C().sup.docs : []).filter(function (d) { return d.date === date; });
    var pays = (S().state.pays || []).filter(function (p) { return p.date === date; });
    var po = (S().state.payouts || []).filter(function (p) { return p.date === date; });
    var deb = (S().state.debtors || []).filter(function (p) { return p.date === date; });
    var ts = (S().state.timesheet || []).filter(function (p) { return p.date === date; });

    var h = facts([
      ['Выручка', priv(sum(inc, 'amount'))],
      ['Расходы', priv(sum(exp, 'amount'))],
      ['Забор владельцем', draw.length ? priv(sum(draw, 'amount')) : '—'],
      ['Итог дня', priv(sum(inc, 'amount') - sum(exp, 'amount')),
        sum(inc, 'amount') - sum(exp, 'amount') >= 0 ? 'c-green' : 'c-red'],
      ['Приход товара', docs.length ? priv(sum(docs, 'sum')) + ' · ' + docs.length + ' накл.' : '—'],
      ['Оплачено поставщикам', pays.length ? priv(sum(pays, 'sum')) : '—'],
      ['Выдано зарплаты', po.length ? priv(sum(po, 'amount')) : '—'],
      ['Записано в долг покупателям', deb.length ? priv(sum(deb, 'sum')) : '—']
    ]);
    h += block('Деньги за день', mini([
      { title: 'Тип', fn: function (r) { return esc(r.type); } },
      { title: 'Смена', fn: function (r) { return esc(r.shift || '—'); } },
      { title: 'Кто', fn: function (r) { return esc(r.cashier || '—'); } },
      { title: 'Статья', fn: function (r) { return r.category ? link('category', r.category, r.category) : '—'; } },
      { title: 'Способ', fn: function (r) { return esc(r.method || '—'); } },
      { title: 'Сумма', cls: 'num', fn: function (r) { return priv(num(r.amount)); } },
      { title: 'Расхожд.', cls: 'num', fn: function (r) { return num(r.diff) ? '<span class="c-red private">' + money(num(r.diff)) + '</span>' : '—'; } }
    ], dds), 'Записей о деньгах нет');
    h += block('Приходы товара', mini([
      { title: 'Поставщик', fn: function (r) { return link('firm', norm(r.firm), r.firm); } },
      { title: 'Документ', fn: function (r) { return link('doc', r.id, r.doc); } },
      { title: 'Сумма', cls: 'num', fn: function (r) { return priv(r.sum); } }
    ], docs), 'Приходов не было');
    h += block('Оплаты поставщикам', mini([
      { title: 'Поставщик', fn: function (r) { return link('firm', norm(r.firm), r.firm || '—'); } },
      { title: 'Документ', fn: function (r) { return link('pay', r.id, SUP().shortDoc ? SUP().shortDoc(r.doc) : r.doc); } },
      { title: 'Сумма', cls: 'num', fn: function (r) { return priv(num(r.sum)); } }
    ], pays), 'Оплат не было');
    h += block('Кто работал', mini([
      { title: 'Сотрудник', fn: function (r) { return link('employee', r.employee, r.employee); } },
      { title: 'Смена', fn: function (r) { return esc(r.shift || '—'); } },
      { title: 'Часы', cls: 'num', fn: function (r) { return nf(num(r.hours)); } },
      { title: 'Начислено', cls: 'num', fn: function (r) { return priv(E().timesheetCalc ? E().timesheetCalc(r) : 0); } }
    ], ts), 'Смены не записаны');
    return { title: dateRu(date), html: h };
  }

  /* Месяц */
  function monthDetail(m) {
    function inM(d) { return String(d || '').slice(0, 7) === m; }
    var dds = (S().state.dds || []).filter(function (r) { return inM(r.date); });
    var inc = dds.filter(function (r) { return r.type === 'Приход'; });
    var exp = dds.filter(function (r) { return r.type === 'Расход' || r.type === 'Долг'; });
    var docs = (C().sup ? C().sup.docs : []).filter(function (d) { return inM(d.date); });
    var pays = (S().state.pays || []).filter(function (p) { return inM(p.date); });
    var days = {};
    dds.forEach(function (r) {
      if (!days[r.date]) days[r.date] = { date: r.date, income: 0, expense: 0 };
      if (r.type === 'Приход') days[r.date].income += num(r.amount);
      else if (r.type === 'Расход' || r.type === 'Долг') days[r.date].expense += num(r.amount);
    });
    var dayList = Object.keys(days).sort().reverse().map(function (d) {
      days[d].income = round(days[d].income); days[d].expense = round(days[d].expense);
      days[d].profit = round(days[d].income - days[d].expense);
      return days[d];
    });
    var h = facts([
      ['Выручка', priv(sum(inc, 'amount'))],
      ['Расходы', priv(sum(exp, 'amount'))],
      ['Прибыль', priv(sum(inc, 'amount') - sum(exp, 'amount')),
        sum(inc, 'amount') - sum(exp, 'amount') >= 0 ? 'c-green' : 'c-red'],
      ['Дней с выручкой', nf(dayList.filter(function (d) { return d.income > 0; }).length)],
      ['Средний день', dayList.length ? priv(sum(inc, 'amount') / dayList.filter(function (d) { return d.income > 0; }).length || 0) : '—'],
      ['Приход товара', priv(sum(docs, 'sum'))],
      ['Оплачено поставщикам', priv(sum(pays, 'sum'))]
    ]);
    var cats = G.WMFinance ? G.WMFinance.byCategory(dds) : [];
    h += block('Расходы по статьям', mini([
      { title: 'Статья', fn: function (r) { return link('category', r.name, r.name); } },
      { title: 'Сумма', cls: 'num', fn: function (r) { return priv(r.sum); } },
      { title: 'Доля', cls: 'num', fn: function (r) { return r.share + '%'; } }
    ], cats), 'Расходов нет');
    h += block('По дням', mini([
      { title: 'День', fn: function (r) { return link('day', r.date, dateRu(r.date)); } },
      { title: 'Выручка', cls: 'num', fn: function (r) { return priv(r.income); } },
      { title: 'Расход', cls: 'num', fn: function (r) { return priv(r.expense); } },
      { title: 'Итог', cls: 'num', fn: function (r) {
        return '<span class="' + (r.profit >= 0 ? 'c-green' : 'c-red') + ' private">' + money(r.profit) + '</span>'; } }
    ], dayList, 40), 'Записей нет');
    return { title: monthRu(m), html: h };
  }

  /* Долг покупателя */
  function debtorDetail(id) {
    var r = (S().state.debtors || []).filter(function (x) { return x.id === id; })[0];
    if (!r) return { title: 'Долг покупателя', html: nothing('Запись не найдена.') };
    var same = (S().state.debtors || []).filter(function (x) { return norm(x.name) === norm(r.name); });
    var h = facts([
      ['Имя', esc(r.name)],
      ['Телефон', r.phone ? '<a href="tel:' + esc(r.phone) + '">' + esc(r.phone) + '</a>' : '—'],
      ['Сумма', priv(num(r.sum))],
      ['Взял', esc(dateRu(r.date))],
      ['Обещал вернуть', r.promise ? esc(dateRu(r.promise)) : '—'],
      ['Кто записал', esc(r.cashier || '—')],
      ['Погашено', r.paid ? 'да, ' + dateRu(r.paidDate) : 'нет', r.paid ? 'c-green' : 'c-red'],
      ['Всего долгов этого человека', priv(sum(same.filter(function (x) { return !x.paid; }), 'sum'))]
    ]);
    h += block('Вся история этого покупателя', mini([
      { title: 'Дата', fn: function (x) { return esc(dateRu(x.date)); } },
      { title: 'Сумма', cls: 'num', fn: function (x) { return priv(num(x.sum)); } },
      { title: 'Состояние', fn: function (x) { return x.paid ? '<span class="c-green">погашен</span>' : '<span class="c-red">должен</span>'; } }
    ], same.slice().sort(function (a, b) { return (b.date || '').localeCompare(a.date || ''); })));
    h += '<div class="quick"><button class="btn" data-edit="debtors:' + esc(r.id) + ':debtor">✏️ Изменить</button>' +
      '<button class="btn" data-del="debtors:' + esc(r.id) + '">🗑 Удалить</button></div>';
    return { title: 'Долг: ' + r.name, html: h };
  }

  /* Статья или вид операции из отчёта 1С «Общие доходы и расходы» */
  function incexpDetail(kind, name) {
    var rows = (D().incexp ? D().incexp.rows : []).filter(function (r) {
      return norm(kind === 'operation' ? r.operation : (kind === 'party' ? r.party : r.article)) === norm(name);
    });
    var h = facts([
      ['Доход', priv(sum(rows, 'income'))],
      ['Расход', priv(sum(rows, 'expense'))],
      ['Итог', priv(sum(rows, 'income') - sum(rows, 'expense')),
        sum(rows, 'income') - sum(rows, 'expense') >= 0 ? 'c-green' : 'c-red'],
      ['Документов', nf(rows.length)]
    ]);
    h += block('Документы', mini([
      { title: 'Дата', fn: function (r) { return esc(dateRu(r.date)) || '—'; } },
      { title: 'Документ', fn: function (r) { return esc(SUP().shortDoc ? SUP().shortDoc(r.doc) : r.doc || '—'); } },
      { title: 'Кто или за что', fn: function (r) { return esc(r.group || r.party || '—'); } },
      { title: 'Доход', cls: 'num', fn: function (r) { return r.income ? priv(r.income) : '—'; } },
      { title: 'Расход', cls: 'num', fn: function (r) { return r.expense ? priv(r.expense) : '—'; } }
    ], rows.slice().sort(function (a, b) { return (b.date || '').localeCompare(a.date || ''); }), 80), 'Документов нет');
    return { title: name, html: h };
  }

  /* Способ оплаты: наличные, карта, перевод */
  function methodDetail(name) {
    var k = norm(name);
    var rows = (S().state.dds || []).filter(function (r) { return norm(r.method) === k; });
    var inc = rows.filter(function (r) { return r.type === 'Приход'; });
    var exp = rows.filter(function (r) { return r.type === 'Расход' || r.type === 'Долг' || r.type === 'Забор'; });
    var h = facts([
      ['Пришло', priv(sum(inc, 'amount'))],
      ['Ушло', priv(sum(exp, 'amount'))],
      ['Остаток', priv(sum(inc, 'amount') - sum(exp, 'amount')),
        sum(inc, 'amount') - sum(exp, 'amount') >= 0 ? 'c-green' : 'c-red'],
      ['Операций', nf(rows.length)]
    ]);
    h += block('Операции', mini([
      { title: 'Дата', fn: function (r) { return link('day', r.date, dateRu(r.date)); } },
      { title: 'Тип', fn: function (r) { return esc(r.type); } },
      { title: 'Статья', fn: function (r) { return r.category ? link('category', r.category, r.category) : '—'; } },
      { title: 'Сумма', cls: 'num', fn: function (r) { return priv(num(r.amount)); } }
    ], rows.slice().sort(function (a, b) { return (b.date || '').localeCompare(a.date || ''); }), 80));
    return { title: 'Способ: ' + name, html: h };
  }

  /* Смена (дата + название смены) */
  function shiftDetail(key) {
    var p = String(key).split('~'), date = p[0], name = p[1] || '';
    var rows = (S().state.dds || []).filter(function (r) {
      return r.date === date && (!name || norm(r.shift) === norm(name));
    });
    var inc = rows.filter(function (r) { return r.type === 'Приход'; });
    var ts = (S().state.timesheet || []).filter(function (r) {
      return r.date === date && (!name || norm(r.shift) === norm(name));
    });
    var h = facts([
      ['Дата', esc(dateRu(date))],
      ['Смена', esc(name || '—')],
      ['Выручка', priv(sum(inc, 'amount'))],
      ['Расхождение', priv(sum(rows, 'diff')), sum(rows, 'diff') ? 'c-red' : 'c-green'],
      ['Кассир', esc((rows[0] && rows[0].cashier) || '—')]
    ]);
    h += block('Выручка по способам', mini([
      { title: 'Способ', fn: function (r) { return link('method', r.method || 'Наличные', r.method || 'Наличные'); } },
      { title: 'Сумма', cls: 'num', fn: function (r) { return priv(num(r.amount)); } },
      { title: 'Расхожд.', cls: 'num', fn: function (r) { return num(r.diff) ? '<span class="c-red private">' + money(num(r.diff)) + '</span>' : '—'; } },
      { title: '', cls: 'center', fn: function (r) { return '<button class="btn btn-sm" data-edit="dds:' + esc(r.id) + ':ddsIncome">✏️</button>'; } }
    ], inc), 'Выручка не записана');
    h += block('Кто работал', mini([
      { title: 'Сотрудник', fn: function (r) { return link('employee', r.employee, r.employee); } },
      { title: 'Часы', cls: 'num', fn: function (r) { return nf(num(r.hours)); } },
      { title: 'Начислено', cls: 'num', fn: function (r) { return priv(E().timesheetCalc ? E().timesheetCalc(r) : 0); } }
    ], ts), 'Смены не записаны');
    h += '<div class="quick"><button class="btn" data-more="day|' + esc(date) + '">📅 Весь день</button></div>';
    return { title: 'Смена ' + dateRu(date), html: h };
  }

  /* ==========================================================================
     Разбор адреса «вид|ключ» и открытие окна
     ======================================================================== */
  var KINDS = {
    firm: firmDetail,
    doc: docDetail,
    pay: payDetail,
    product: productDetail,
    group: groupDetail,
    employee: employeeDetail,
    category: categoryDetail,
    day: dayDetail,
    month: monthDetail,
    debtor: debtorDetail,
    method: methodDetail,
    shift: shiftDetail,
    operation: function (k) { return incexpDetail('operation', k); },
    article: function (k) { return incexpDetail('article', k); },
    party: function (k) { return incexpDetail('party', k); }
  };

  function build(kind, key) {
    var fn = KINDS[kind];
    if (!fn) return { title: 'Подробнее', html: nothing('Для этого вида подробностей пока нет.') };
    try { return fn(key); }
    catch (e) { return { title: 'Подробнее', html: nothing('Не получилось собрать подробности: ' + e.message) }; }
  }

  var TRAIL = [];             // куда возвращаться по кнопке «Назад»
  function open(kind, key, keepTrail) {
    if (!keepTrail) TRAIL.push({ kind: kind, key: key });
    var d = build(kind, key);
    var back = TRAIL.length > 1
      ? '<button class="btn btn-sm" data-act="more-back">‹ Назад</button> ' : '';
    if (u().sheet) u().sheet(d.title, '<div class="detail">' + back + d.html + '</div>');
    return d;
  }
  function back() {
    TRAIL.pop();
    var prev = TRAIL[TRAIL.length - 1];
    if (prev) open(prev.kind, prev.key, true);
    else if (u().closeSheet) u().closeSheet();
  }
  function reset() { TRAIL = []; }

  return {
    btn: btn, link: link, chev: chev, open: open, back: back, reset: reset, build: build,
    facts: facts, block: block, mini: mini, kinds: KINDS
  };
});

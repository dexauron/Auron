/* ============================================================================
   Поставки и оплаты: накладные из 1С живут в базе постоянно.
   Здесь всё, что делает из выгрузок 1С понятную картину долга:
   — один поставщик, записанный в 1С по-разному, сводится в одну фирму;
   — повторная загрузка того же файла обновляет документ, а не создаёт второй;
   — РКО встают к накладным по документу-основанию, спорные идут в разбор;
   — дата выплаты предлагается по отсрочке и подтверждается владельцем.
   ========================================================================== */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.WMSupply = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  var DAY = 86400000;

  function clean(s) { return String(s == null ? '' : s).replace(/\s+/g, ' ').trim(); }
  function norm(s) { return clean(s).toLowerCase().replace(/ё/g, 'е'); }
  function num(v) {
    if (typeof v === 'number') return isFinite(v) ? v : 0;
    var s = String(v == null ? '' : v).replace(/ |\s/g, '').replace(/₽|руб\.?/gi, '').replace(',', '.');
    var n = parseFloat(s);
    return isFinite(n) ? n : 0;
  }
  function round(x) { return Math.round((x + Number.EPSILON) * 100) / 100; }
  function uid() { return 'sp' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6); }

  function addDays(date, days) {
    if (!date) return '';
    var d = new Date(date + 'T00:00:00');
    if (isNaN(d.getTime())) return '';
    d = new Date(d.getTime() + (+days || 0) * DAY);
    return d.toISOString().slice(0, 10);
  }
  function today() { return new Date().toISOString().slice(0, 10); }

  // «Приходная накладная ПФ0000040006441 от 01.08.2026 10:21:25» → «ПФ0000040006441»
  function shortDoc(doc) {
    var s = clean(doc)
      .replace(/^(приходная накладная|расходный кассовый ордер|приходный кассовый ордер)\s*/i, '')
      .replace(/\s+от\s+\d.*$/i, '');
    return s || clean(doc);
  }
  // Название без «ООО», «ИП» и прочих форм — по нему сравниваем фирмы
  function bareName(name) {
    return norm(name).replace(/^(ооо|оао|зао|пао|ао|ип|тд|тк|кфх|снт)[\s.]+/, '');
  }
  function daysBetween(a, b) {
    if (!a || !b) return 0;
    return Math.round((new Date(b + 'T00:00:00') - new Date(a + 'T00:00:00')) / DAY);
  }

  /* --- Имена поставщиков ---------------------------------------------------- */

  // «Рамми ТП Гутаев Магомед-Эмин» → фирма «Рамми», представитель «Гутаев…»
  function splitRep(raw) {
    var name = clean(raw);
    if (!name) return { firm: '', rep: '' };
    var m = name.match(/^(.*?)[\s,.]+ТП[\s.]+(.+)$/i);
    if (m && clean(m[1])) return { firm: clean(m[1]), rep: clean(m[2]) };
    var head = name.match(/^ТП[\s.]+(.+)$/i);
    if (head) return { firm: name, rep: clean(head[1]) };
    return { firm: name, rep: '' };
  }

  // Алиасы всех фирм: как это написано в 1С → имя фирмы в программе
  function aliasIndex(reg) {
    var idx = {};
    (reg || []).forEach(function (f) {
      idx[norm(f.name)] = f.name;
      (f.aliases || []).forEach(function (a) { if (clean(a)) idx[norm(a)] = f.name; });
    });
    return idx;
  }

  // Имя фирмы для строки из 1С. Незнакомое имя остаётся как есть —
  // связать его с фирмой владелец решает на экране «Сопоставление имён».
  function firmOf(raw, idx) {
    var name = clean(raw);
    if (!name) return 'Без контрагента';
    return idx[norm(name)] || name;
  }

  // Что предложить для нового имени: фирму, к которой оно скорее всего относится
  function guessFirm(raw, reg, idx) {
    var name = clean(raw);
    if (!name) return { firm: 'Требует выбора', reason: 'в файле не заполнен контрагент', kind: 'empty' };
    if (idx[norm(name)]) return { firm: idx[norm(name)], reason: 'уже связано', kind: 'known' };
    var parts = splitRep(name);
    if (parts.rep && idx[norm(parts.firm)]) {
      return { firm: idx[norm(parts.firm)], reason: 'совпало по названию до «ТП»', kind: 'rep' };
    }
    var i, f;
    for (i = 0; i < (reg || []).length; i++) {
      f = reg[i];
      if (norm(f.name) === norm(parts.firm)) return { firm: f.name, reason: 'совпало по названию', kind: 'same' };
    }
    for (i = 0; i < (reg || []).length; i++) {
      f = reg[i];
      if (norm(name).indexOf(norm(f.name)) === 0 && norm(f.name).length > 3) {
        return { firm: f.name, reason: 'начинается так же, как «' + f.name + '»', kind: 'prefix' };
      }
    }
    return { firm: parts.firm || name, reason: 'нет в справочнике — станет новой фирмой', kind: 'new' };
  }

  // Карточка фирмы в справочнике: создаётся при первой связке
  function firmRecord(name) {
    return { id: uid(), name: clean(name), aliases: [], termDays: null, method: '', phone: '', note: '' };
  }

  function findFirm(reg, name) {
    for (var i = 0; i < (reg || []).length; i++) if (norm(reg[i].name) === norm(name)) return reg[i];
    return null;
  }

  // Связать написание из 1С с фирмой (создаёт фирму, если её ещё нет)
  function linkAlias(reg, raw, firmName) {
    var f = findFirm(reg, firmName);
    if (!f) { f = firmRecord(firmName); reg.push(f); }
    var a = clean(raw);
    if (a && norm(a) !== norm(f.name) && (f.aliases || []).every(function (x) { return norm(x) !== norm(a); })) {
      f.aliases = (f.aliases || []).concat([a]);
    }
    return f;
  }

  // Объединить две фирмы: все имена уходят к оставшейся, карточка лишней удаляется
  function mergeFirms(reg, fromName, toName) {
    var from = findFirm(reg, fromName), to = findFirm(reg, toName);
    if (!to) { to = firmRecord(toName); reg.push(to); }
    if (!from || from === to) { linkAlias(reg, fromName, to.name); return to; }
    linkAlias(reg, from.name, to.name);
    (from.aliases || []).forEach(function (a) { linkAlias(reg, a, to.name); });
    if (to.termDays == null && from.termDays != null) to.termDays = from.termDays;
    if (!to.phone && from.phone) to.phone = from.phone;
    if (!to.method && from.method) to.method = from.method;
    var i = reg.indexOf(from);
    if (i >= 0) reg.splice(i, 1);
    return to;
  }

  function termDaysFor(firmName, reg, settings) {
    var f = findFirm(reg, firmName);
    if (f && f.termDays !== null && f.termDays !== '' && f.termDays !== undefined) return +f.termDays;
    return +(settings && settings.termDaysDefault) || 0;
  }
  function termKnown(firmName, reg) {
    var f = findFirm(reg, firmName);
    return !!(f && f.termDays !== null && f.termDays !== '' && f.termDays !== undefined);
  }

  /* --- Загрузка документов в базу ------------------------------------------- */

  // Накладные 1С. Ключ документа — его номер: тот же файл, загруженный второй
  // раз, обновляет строку на месте. Подтверждённая дата выплаты не сбивается.
  function mergeDocs(state, rows, file, reg, settings) {
    var idx = {}, stat = { added: 0, updated: 0, same: 0 };
    state.docs = state.docs || [];
    state.docs.forEach(function (d) { idx[d.key] = d; });
    var alias = aliasIndex(reg || state.supreg || []);

    (rows || []).forEach(function (r) {
      var key = norm(r.doc);
      if (!key) return;
      var firm = firmOf(r.supplier, alias);
      var term = termDaysFor(firm, reg || state.supreg || [], settings);
      var old = idx[key];
      if (!old) {
        var rec = {
          id: uid(), key: key, doc: clean(r.doc), date: r.date || '', incomingNo: clean(r.incomingNo),
          supplier: clean(r.supplier) || 'Без контрагента', firm: firm,
          sum: round(num(r.sum)), retail: round(num(r.retail)),
          payDate: addDays(r.date, term), confirmed: false, roundOff: 0,
          source: '1c', file: file || '', loaded: today()
        };
        state.docs.push(rec); idx[key] = rec; stat.added++;
        return;
      }
      var changed = round(num(r.sum)) !== old.sum || (r.date || '') !== old.date ||
        clean(r.supplier) !== old.supplier;
      old.doc = clean(r.doc); old.date = r.date || old.date;
      old.incomingNo = clean(r.incomingNo) || old.incomingNo;
      old.supplier = clean(r.supplier) || old.supplier;
      old.firm = firmOf(old.supplier, alias);
      old.sum = round(num(r.sum)); old.retail = round(num(r.retail));
      old.file = file || old.file;
      if (!old.confirmed) old.payDate = addDays(old.date, termDaysFor(old.firm, reg || state.supreg || [], settings));
      if (changed) stat.updated++; else stat.same++;
    });
    return stat;
  }

  // Расходные кассовые ордера: оплаты поставщикам и прочие выплаты из кассы
  function mergePays(state, rows, file, reg, settings) {
    var idx = {}, stat = { added: 0, updated: 0, same: 0 };
    state.pays = state.pays || [];
    state.pays.forEach(function (p) { idx[p.key] = p; });
    var alias = aliasIndex(reg || state.supreg || []);

    (rows || []).forEach(function (r) {
      var key = norm(r.doc);
      if (!key) return;
      var firm = r.supplier ? firmOf(r.supplier, alias) : '';
      var old = idx[key];
      if (!old) {
        var rec = {
          id: uid(), key: key, doc: clean(r.doc), date: r.date || '',
          supplier: clean(r.supplier), firm: firm,
          basis: clean(r.basis), basisKey: norm(r.basis),
          operation: clean(r.operation), article: clean(r.article),
          cashbox: clean(r.cashbox), sum: round(num(r.sum)),
          linkKey: '', linkKind: '', category: '', resolved: false,
          source: '1c', file: file || '', loaded: today()
        };
        state.pays.push(rec); idx[key] = rec; stat.added++;
        return;
      }
      var changed = round(num(r.sum)) !== old.sum || norm(r.basis) !== old.basisKey;
      old.date = r.date || old.date;
      old.supplier = clean(r.supplier) || old.supplier;
      old.firm = old.supplier ? firmOf(old.supplier, alias) : '';
      old.basis = clean(r.basis) || old.basis; old.basisKey = norm(old.basis);
      old.operation = clean(r.operation) || old.operation;
      old.article = clean(r.article) || old.article;
      old.cashbox = clean(r.cashbox) || old.cashbox;
      old.sum = round(num(r.sum)); old.file = file || old.file;
      if (changed) stat.updated++; else stat.same++;
    });
    return stat;
  }

  // Справочник наполняется сам: «Фирма ТП Иванов» уходит к фирме «Фирма»,
  // остальные имена становятся отдельными фирмами. Владелец потом объединяет
  // похожие и отделяет лишние на экране «Сопоставление имён».
  function autoRegister(state, settings) {
    var reg = state.supreg = state.supreg || [];
    var idx = aliasIndex(reg), added = 0;
    function take(raw) {
      var name = clean(raw);
      if (!name || idx[norm(name)]) return;
      var parts = splitRep(name);
      var firmName = parts.rep && parts.firm ? parts.firm : name;
      linkAlias(reg, name, firmName);
      idx = aliasIndex(reg); added++;
    }
    (state.docs || []).forEach(function (d) { take(d.supplier); });
    (state.pays || []).forEach(function (p) { if (isSupplierPay(p)) take(p.supplier); });
    (state.docs || []).forEach(function (d) { d.firm = firmOf(d.supplier, idx); });
    (state.pays || []).forEach(function (p) { if (p.supplier) p.firm = firmOf(p.supplier, idx); });
    return added;
  }

  // Похожие фирмы: одно название начинается с другого или совпадают два первых
  // слова — кандидаты на объединение (долг тогда сложится в одну сумму).
  function similarFirms(reg) {
    var out = [], i, j;
    var list = (reg || []).filter(function (f) { return !f.keepSeparate; });
    function head(n) { return bareName(n).split(' ').slice(0, 2).join(' '); }
    for (i = 0; i < list.length; i++) {
      for (j = 0; j < list.length; j++) {
        if (i === j) continue;
        var a = list[i], b = list[j];
        if (norm(a.name).length <= norm(b.name).length) continue;
        var pref = norm(a.name).indexOf(norm(b.name) + ' ') === 0;
        var same = bareName(b.name).split(' ').length >= 2 && head(a.name) === head(b.name);
        if (pref || same) {
          out.push({ raw: a.name, firm: b.name, kind: 'similar',
            reason: pref ? 'начинается так же, как «' + b.name + '»' : 'первые слова совпадают' });
          break;
        }
      }
    }
    return out;
  }

  /* --- Связка оплат с накладными -------------------------------------------- */

  function isSupplierPay(p) {
    var s = norm(p.operation) + ' ' + norm(p.article);
    if (s.indexOf('контрагент') >= 0 || s.indexOf('поставщик') >= 0) return true;
    if (s.indexOf('прочие выплаты') >= 0 || s.indexOf('сотрудник') >= 0 || s.indexOf('зарплат') >= 0) return false;
    return !!p.supplier;
  }

  // Каждая оплата привязывается к накладной: сама — по документу-основанию,
  // вручную — решением владельца на экране «Разбор оплат».
  function link(docs, pays) {
    var byKey = {}, stat = { auto: 0, manual: 0, none: 0, expense: 0, old: 0, oldSum: 0, total: (pays || []).length };
    (docs || []).forEach(function (d) { byKey[d.key] = d; });
    (pays || []).forEach(function (p) {
      if (p.linkKind === 'manual' && p.linkKey && byKey[p.linkKey]) { stat.manual++; return; }
      if (p.linkKind === 'expense' || p.category) { stat.expense++; return; }
      if (p.basisKey && byKey[p.basisKey]) { p.linkKind = 'auto'; p.linkKey = p.basisKey; stat.auto++; return; }
      if (!isSupplierPay(p)) { p.linkKind = p.linkKind === 'manual' ? p.linkKind : 'other'; stat.expense++; return; }
      // основание есть, но такой накладной в базе нет: это погашение старого долга
      if (p.basisKey) { p.linkKind = 'old'; p.linkKey = ''; stat.old++; stat.oldSum = round(stat.oldSum + num(p.sum)); return; }
      p.linkKind = p.linkKind === 'manual' ? p.linkKind : 'none';
      stat.none++;
    });
    return stat;
  }

  // Оплачено по каждой накладной + остаток долга
  function docsCalc(docs, pays, reg, settings) {
    var paid = {}, advance = {};
    (pays || []).forEach(function (p) {
      var k = (p.linkKind === 'manual' || p.linkKind === 'auto') ? p.linkKey : '';
      if (k) { paid[k] = round((paid[k] || 0) + num(p.sum)); return; }
      if (p.linkKind === 'advance' && p.firm) advance[norm(p.firm)] = round((advance[norm(p.firm)] || 0) + num(p.sum));
    });
    var t = today(), out = [];
    (docs || []).forEach(function (d) {
      var p = round(paid[d.key] || 0);
      var left = d.closedManual ? 0 : Math.max(0, round(num(d.sum) - p - num(d.roundOff)));
      var due = d.confirmed ? (d.payDate || '') : (d.payDate || addDays(d.date, termDaysFor(d.firm, reg, settings)));
      out.push({
        id: d.id, key: d.key, doc: shortDoc(d.doc), fullDoc: d.doc, date: d.date, supplier: d.supplier, firm: d.firm,
        incomingNo: d.incomingNo, sum: round(d.sum), retail: round(d.retail),
        paid: p, left: left, roundOff: round(num(d.roundOff)),
        due: due, confirmed: !!d.confirmed, closed: !!d.closedManual, underpayKeep: !!d.underpayKeep,
        term: termDaysFor(d.firm, reg, settings),
        termKnown: termKnown(d.firm, reg),
        overdue: left > 0 && due && due < t,
        dueToday: left > 0 && due === t,
        status: left === 0 ? 'paid' : (p > 0 ? 'part' : 'debt'),
        statusText: d.closedManual ? 'Закрыто вручную' : (left === 0 ? 'Оплачено' : (p > 0 ? 'Частично' : 'В долг'))
      });
    });
    out.sort(function (a, b) { return (b.date || '').localeCompare(a.date || ''); });
    return { docs: out, advance: advance };
  }

  // Долг по фирмам: все написания имени сложены в одну строку
  function firmDebt(calc, reg) {
    var map = {};
    (calc.docs || []).forEach(function (d) {
      var k = norm(d.firm);
      if (!map[k]) map[k] = { firm: d.firm, docs: 0, sum: 0, paid: 0, left: 0, overdue: 0, due: '', names: {} };
      var m = map[k];
      m.docs++; m.sum += d.sum; m.paid += d.paid; m.left += d.left;
      if (d.overdue) m.overdue += d.left;
      if (d.left > 0 && d.due && (!m.due || d.due < m.due)) m.due = d.due;
      if (d.supplier) m.names[d.supplier] = 1;
    });
    var out = [];
    for (var k in map) {
      var v = map[k];
      var f = findFirm(reg, v.firm);
      v.sum = round(v.sum); v.paid = round(v.paid); v.left = round(v.left); v.overdue = round(v.overdue);
      v.left = Math.max(0, round(v.left - ((calc.advance || {})[k] || 0)));
      v.reps = Object.keys(v.names).filter(function (n) { return norm(n) !== norm(v.firm); });
      v.term = f && f.termDays !== null && f.termDays !== '' && f.termDays !== undefined ? +f.termDays : null;
      v.method = f ? f.method : '';
      v.phone = f ? f.phone : '';
      out.push(v);
    }
    return out.sort(function (a, b) { return b.left - a.left || b.overdue - a.overdue; });
  }

  /* --- Очереди, которые ждут решения владельца ------------------------------ */

  // Имена из выгрузок, которых ещё нет в справочнике
  function newNames(docs, pays, reg) {
    var idx = aliasIndex(reg), seen = {}, out = [];
    function look(name, kind, sum) {
      var key = norm(name);
      if (idx[key]) return;
      if (!seen[key]) {
        var g = guessFirm(name, reg, idx);
        seen[key] = { raw: clean(name) || '(пусто)', docs: 0, pays: 0, sum: 0,
          firm: g.firm, reason: g.reason, kind: g.kind };
        out.push(seen[key]);
      }
      seen[key][kind]++; seen[key].sum = round(seen[key].sum + num(sum));
    }
    (docs || []).forEach(function (d) { look(d.supplier, 'docs', d.sum); });
    (pays || []).forEach(function (p) { if (isSupplierPay(p)) look(p.supplier, 'pays', p.sum); });

    // фирмы, которые похожи между собой: предлагаем объединить
    var byFirm = {};
    (docs || []).forEach(function (d) { byFirm[norm(d.firm)] = round((byFirm[norm(d.firm)] || 0) + num(d.sum)); });
    similarFirms(reg).forEach(function (sm) {
      out.push({ raw: sm.raw, docs: 0, pays: 0, sum: byFirm[norm(sm.raw)] || 0,
        firm: sm.firm, reason: sm.reason, kind: 'similar' });
    });
    return out.sort(function (a, b) { return b.sum - a.sum; });
  }

  // Что не сошлось: недоплата у поставщика «оплата сразу», оплата без основания,
  // выплата не поставщику (нужна статья расхода).
  function reconQueue(calc, pays, reg, settings) {
    var out = [], byKey = {};
    (calc.docs || []).forEach(function (d) { byKey[d.key] = d; });

    (calc.docs || []).forEach(function (d) {
      if (d.underpayKeep || d.closed) return;
      if (d.paid > 0 && d.left > 0 && d.term === 0 && d.termKnown) {
        out.push({
          kind: 'underpay', tone: 'orange', problem: 'Недоплата', id: d.id, key: d.key,
          title: d.firm + ' · накладная ' + shortDoc(d.doc),
          sub: 'накладная ' + round(d.sum) + ' ₽, оплачено ' + d.paid + ' ₽ — остаток ' + d.left + ' ₽',
          sum: d.left
        });
      }
    });

    (pays || []).forEach(function (p) {
      if (p.resolved) return;
      if (p.linkKind === 'none') {
        out.push({
          kind: 'nobasis', tone: 'red', problem: 'Без основания', id: p.id,
          title: (p.firm || p.supplier || 'Поставщик не указан') + ' · РКО ' + shortDoc(p.doc),
          sub: p.basis ? ('основание «' + p.basis + '» не нашлось среди накладных')
            : 'в РКО не указана накладная — к чему отнести оплату?',
          sum: round(p.sum)
        });
      } else if (p.linkKind === 'other' && !p.category) {
        out.push({
          kind: 'notsupplier', tone: 'gray', problem: 'Не поставщик', id: p.id,
          title: (p.article || p.operation || 'Выплата из кассы') + ' · РКО ' + shortDoc(p.doc),
          sub: 'вид операции «' + (p.operation || '—') + '» — нужна статья расхода',
          sum: round(p.sum)
        });
      }
    });
    return out.sort(function (a, b) { return b.sum - a.sum; });
  }

  // Накладные, по которым дата выплаты ещё не подтверждена
  function confirmQueue(calc, reg, settings) {
    var out = [];
    (calc.docs || []).forEach(function (d) {
      if (d.confirmed || d.left <= 0) return;
      var tone = 0, hint = 'по отсрочке поставщика · ' + d.term + ' дн.';
      if (!d.termKnown) { tone = 1; hint = 'отсрочка не задана — поставили ' + d.term + ' дн. по умолчанию'; }
      else if (d.term === 0) { tone = -1; hint = 'оплата сразу — платить сегодня'; }
      else if (d.due && d.due <= today()) { tone = -1; hint = 'срок уже подошёл'; }
      out.push({
        id: d.id, key: d.key, supplier: d.firm, doc: d.doc, date: d.date, incomingNo: d.incomingNo,
        sum: d.left, full: d.sum, retail: d.retail, due: d.due, term: d.term,
        termKnown: d.termKnown, hint: hint, tone: tone
      });
    });
    return out.sort(function (a, b) { return (a.due || '').localeCompare(b.due || ''); });
  }

  // Отсрочки: строка на каждую фирму, которая встречалась в накладных
  function termsTable(calc, reg, settings) {
    var rows = firmDebt(calc, reg), months = {};
    (calc.docs || []).forEach(function (d) {
      var k = norm(d.firm), m = (d.date || '').slice(0, 7);
      if (!months[k]) months[k] = {};
      if (m) months[k][m] = (months[k][m] || 0) + 1;
    });
    rows.forEach(function (r) {
      var m = months[norm(r.firm)] || {}, keys = Object.keys(m), n = 0;
      keys.forEach(function (k) { n += m[k]; });
      r.freq = keys.length ? Math.round(n / keys.length) : r.docs;
      r.termShown = r.term === null ? (+(settings && settings.termDaysDefault) || 0) : r.term;
      r.termDefault = r.term === null;
    });
    return rows.sort(function (a, b) { return b.left - a.left || b.docs - a.docs; });
  }

  /* --- Долги покупателей (тетрадка у кассы) --------------------------------- */

  function debtorsList(rows, settings) {
    var t = today(), old = +(settings && settings.debtorOldDays) || 30;
    var out = (rows || []).filter(function (r) { return !r.paid; }).map(function (r) {
      var age = daysBetween(r.date, t);
      return {
        id: r.id, name: r.name || '—', phone: r.phone || '', sum: round(num(r.sum)),
        date: r.date, promise: r.promise || '', cashier: r.cashier || '', note: r.note || '',
        age: age, tone: age >= old ? 'red' : (age >= 7 ? 'orange' : 'gray'),
        ageText: age <= 0 ? 'сегодня' : age + ' дн.'
      };
    });
    out.sort(function (a, b) { return b.age - a.age || b.sum - a.sum; });
    var total = 0, oldSum = 0, people = {};
    out.forEach(function (r) { total += r.sum; if (r.age >= old) oldSum += r.sum; people[norm(r.name)] = 1; });
    return { list: out, total: round(total), old: round(oldSum),
      oldDays: old, people: Object.keys(people).length };
  }

  /* --- Всё вместе для экранов ----------------------------------------------- */

  function compute(state, settings) {
    var reg = state.supreg || [];
    var docs = state.docs || [], pays = state.pays || [];
    var linkStat = link(docs, pays);
    var calc = docsCalc(docs, pays, reg, settings);
    var firms = firmDebt(calc, reg);
    var t = today();
    var totals = { sum: 0, paid: 0, left: 0, overdue: 0, dueToday: 0, docs: calc.docs.length };
    calc.docs.forEach(function (d) {
      totals.sum += d.sum; totals.paid += d.paid; totals.left += d.left;
      if (d.overdue) totals.overdue += d.left;
      if (d.dueToday) totals.dueToday += d.left;
    });
    for (var k in totals) totals[k] = round(totals[k]);
    totals.docs = calc.docs.length;
    return {
      reg: reg, calc: calc, docs: calc.docs, firms: firms, totals: totals, linkStat: linkStat,
      newNames: newNames(docs, pays, reg),
      recon: reconQueue(calc, pays, reg, settings),
      confirm: confirmQueue(calc, reg, settings),
      terms: termsTable(calc, reg, settings),
      debtors: debtorsList(state.debtors || [], settings),
      today: t
    };
  }

  return {
    clean: clean, norm: norm, num: num, round: round, uid: uid,
    addDays: addDays, today: today, daysBetween: daysBetween, shortDoc: shortDoc, bareName: bareName,
    splitRep: splitRep, aliasIndex: aliasIndex, firmOf: firmOf, guessFirm: guessFirm,
    findFirm: findFirm, linkAlias: linkAlias, firmRecord: firmRecord, mergeFirms: mergeFirms,
    termDaysFor: termDaysFor, termKnown: termKnown, isSupplierPay: isSupplierPay,
    mergeDocs: mergeDocs, mergePays: mergePays, link: link, docsCalc: docsCalc,
    autoRegister: autoRegister, similarFirms: similarFirms,
    firmDebt: firmDebt, newNames: newNames, reconQueue: reconQueue, confirmQueue: confirmQueue,
    termsTable: termsTable, debtorsList: debtorsList, compute: compute
  };
});

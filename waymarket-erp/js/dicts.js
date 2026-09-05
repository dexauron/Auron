/* ============================================================================
   Справочники: списки слов, которыми вы пользуетесь каждый день.
   Статьи расходов, кассиры, смены, способы оплаты, причины списания —
   плюс поставщики и сотрудники, у которых есть своя карточка.

   Правила, которые тут заложены:
   — ничего нельзя потерять молча: значение, которым уже пользовались,
     нельзя удалить — только скрыть, и старые записи останутся как были;
   — переименование — это переименование, а не «завести новое»: программа
     предлагает переписать и все записи, где старое слово встречается;
   — скрытое не предлагается в формах, но видно в справочнике и в отчётах.
   ========================================================================== */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.WMDicts = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  function txt(v) { return v == null ? '' : String(v).trim(); }
  function norm(v) { return txt(v).toLowerCase().replace(/ё/g, 'е'); }
  function split(v) {
    if (typeof v !== 'string' || !v.trim()) return [];
    return v.split(',').map(function (x) { return x.trim(); }).filter(Boolean);
  }

  /* Какие справочники бывают и где их слова встречаются в записях.
     «where» нужен, чтобы честно сказать: «этим пользовались 118 раз» —
     и не дать удалить то, на чём висит история. */
  var KINDS = [
    { key: 'categories', name: 'Статьи расходов', icon: '🏷', setting: 'finCategories',
      one: 'статью', hint: 'За что платим: закуп, аренда, зарплата, хозрасходы.',
      where: [['dds', 'category']] },
    { key: 'methods', name: 'Способы оплаты', icon: '💳', setting: 'finMethods',
      one: 'способ оплаты', hint: 'Наличные, карта, СБП, перевод со счёта.',
      where: [['dds', 'method'], ['plans', 'method']] },
    { key: 'shifts', name: 'Смены', icon: '🕒', setting: 'finShifts',
      one: 'смену', hint: 'Как называете смены: день, ночь, сутки.',
      where: [['dds', 'shift']] },
    { key: 'cashiers', name: 'Кассиры', icon: '🧑‍💼', setting: 'finCashiers',
      one: 'кассира', hint: 'Кто сдаёт кассу. Это подсказка в форме; полная карточка — в «Сотрудниках».',
      where: [['dds', 'cashier'], ['debtors', 'cashier'], ['cashcount', 'cashier']] },
    { key: 'suppliers', name: 'Поставщики', icon: '🏢', setting: 'finSuppliers',
      one: 'поставщика', hint: 'Кому платим: имена подставляются в плане выплат.',
      where: [['plans', 'supplier']] }
  ];
  function kindOf(key) {
    for (var i = 0; i < KINDS.length; i++) if (KINDS[i].key === key) return KINDS[i];
    return null;
  }

  /* --- Скрытые значения ------------------------------------------------------
     Лежат отдельной коллекцией: сам список слов остаётся в настройках, а
     здесь только пометка «в формах не предлагать».
     ---------------------------------------------------------------------- */
  function hiddenMap(state, key) {
    var out = {};
    ((state && state.dictoff) || []).forEach(function (r) {
      if (r && r.kind === key && r.name) out[norm(r.name)] = true;
    });
    return out;
  }
  function isHidden(state, key, name) { return !!hiddenMap(state, key)[norm(name)]; }

  // Сколько записей пользуется этим словом
  function usage(state, key, name) {
    var k = kindOf(key); if (!k) return 0;
    var n = norm(name), total = 0;
    k.where.forEach(function (pair) {
      ((state && state[pair[0]]) || []).forEach(function (r) {
        if (norm(r[pair[1]]) === n) total++;
      });
    });
    return total;
  }

  // Весь справочник: что задано в настройках плюс то, что встречалось в записях
  function list(state, settings, key) {
    var k = kindOf(key); if (!k) return [];
    var seen = {}, out = [], hid = hiddenMap(state, key);
    function put(name, fromSettings) {
      var v = txt(name); if (!v || seen[norm(v)]) return;
      seen[norm(v)] = 1;
      out.push({ name: v, used: usage(state, key, v), hidden: !!hid[norm(v)],
        inList: !!fromSettings });
    }
    split((settings || {})[k.setting]).forEach(function (v) { put(v, true); });
    k.where.forEach(function (pair) {
      ((state && state[pair[0]]) || []).forEach(function (r) { put(r[pair[1]], false); });
    });
    return out.sort(function (a, b) {
      if (a.hidden !== b.hidden) return a.hidden ? 1 : -1;   // скрытые в конец
      return b.used - a.used || a.name.localeCompare(b.name, 'ru');
    });
  }

  /* --- Изменения -------------------------------------------------------------
     Все функции возвращают { ok: 'что произошло' } или { error: 'почему нет' },
     чтобы экран показал владельцу человеческий ответ.
     ---------------------------------------------------------------------- */
  function add(state, settings, key, name) {
    var k = kindOf(key); if (!k) return { error: 'Неизвестный справочник.' };
    var v = txt(name);
    if (!v) return { error: 'Впишите название.' };
    if (v.length > 60) return { error: 'Слишком длинное название — до 60 символов.' };
    if (v.indexOf(',') >= 0) return { error: 'Запятая в названии не годится: по ней справочник делится на слова.' };
    var cur = split(settings[k.setting]);
    for (var i = 0; i < cur.length; i++) {
      if (norm(cur[i]) === norm(v)) return { error: '«' + cur[i] + '» уже есть в списке.' };
    }
    cur.push(v);
    settings[k.setting] = cur.join(', ');
    return { ok: 'Добавлено: ' + v };
  }

  // Переименование: и в списке, и — по желанию — во всех записях
  function rename(state, settings, key, from, to, alsoRecords) {
    var k = kindOf(key); if (!k) return { error: 'Неизвестный справочник.' };
    var a = txt(from), b = txt(to);
    if (!b) return { error: 'Впишите новое название.' };
    if (b.indexOf(',') >= 0) return { error: 'Запятая в названии не годится.' };
    if (norm(a) === norm(b)) return { error: 'Название не изменилось.' };
    var cur = split(settings[k.setting]), found = false, dup = false;
    cur = cur.map(function (v) {
      if (norm(v) === norm(a)) { found = true; return b; }
      if (norm(v) === norm(b)) dup = true;
      return v;
    });
    if (dup) {
      // такое слово уже есть — просто сливаем: старое из списка убираем
      cur = cur.filter(function (v, i) { return cur.indexOf(v) === i && norm(v) !== norm(a); });
    }
    if (!found && !dup) cur.push(b);
    settings[k.setting] = cur.join(', ');

    var touched = 0;
    if (alsoRecords) {
      k.where.forEach(function (pair) {
        ((state && state[pair[0]]) || []).forEach(function (r) {
          if (norm(r[pair[1]]) === norm(a)) { r[pair[1]] = b; touched++; }
        });
      });
    }
    // пометка «скрыто» переезжает вместе с названием
    ((state && state.dictoff) || []).forEach(function (r) {
      if (r.kind === key && norm(r.name) === norm(a)) r.name = b;
    });
    return { ok: 'Теперь это «' + b + '»' + (touched ? ', переписано записей: ' + touched : ''),
      records: touched };
  }

  function hide(state, key, name) {
    state.dictoff = state.dictoff || [];
    if (isHidden(state, key, name)) return { error: 'Уже скрыто.' };
    state.dictoff.push({ id: 'off' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6),
      kind: key, name: txt(name) });
    return { ok: '«' + txt(name) + '» больше не предлагается в формах. Старые записи не тронуты.' };
  }
  function show(state, key, name) {
    state.dictoff = (state.dictoff || []).filter(function (r) {
      return !(r.kind === key && norm(r.name) === norm(name));
    });
    return { ok: '«' + txt(name) + '» снова предлагается в формах.' };
  }

  // Удалить можно только то, чем ни разу не пользовались
  function remove(state, settings, key, name) {
    var k = kindOf(key); if (!k) return { error: 'Неизвестный справочник.' };
    var used = usage(state, key, name);
    if (used) {
      return { error: 'Нельзя удалить: этим пользуются ' + used + ' ' +
        (used === 1 ? 'запись' : 'записей') + '. Скройте — тогда в формах не будет, а записи останутся.' };
    }
    settings[k.setting] = split(settings[k.setting]).filter(function (v) {
      return norm(v) !== norm(name);
    }).join(', ');
    show(state, key, name);
    return { ok: '«' + txt(name) + '» удалено из справочника.' };
  }

  /* --- Сотрудники и поставщики ----------------------------------------------
     У них не слово, а карточка, поэтому «скрыть» здесь называется по-людски:
     сотрудник уволен, поставщик больше не возит.
     ---------------------------------------------------------------------- */
  function staffActive(state) {
    return ((state && state.staff) || []).filter(function (p) { return !p.fired; });
  }
  function staffFired(state) {
    return ((state && state.staff) || []).filter(function (p) { return !!p.fired; });
  }

  // Сколько записей связано с человеком — чтобы не удалить того, у кого история
  function staffUsage(state, name) {
    var n = norm(name), c = 0;
    [['dds', 'cashier'], ['debtors', 'cashier'], ['cashcount', 'cashier']].forEach(function (p) {
      ((state && state[p[0]]) || []).forEach(function (r) { if (norm(r[p[1]]) === n) c++; });
    });
    return c;
  }
  /* Собрать сотрудников из того, что уже записано: имена в табеле, выплатах,
     сменах и кассе. Программа не выдумывает людей — только собирает тех, кто
     в записях уже есть, но карточки не имеет. */
  function staffFromRecords(state) {
    var have = {}, found = {};
    ((state && state.staff) || []).forEach(function (p) { have[norm(p.name)] = 1; });
    [['dds', 'cashier'], ['debtors', 'cashier'], ['cashcount', 'cashier']].forEach(function (p) {
      ((state && state[p[0]]) || []).forEach(function (r) {
        var v = txt(r[p[1]]);
        if (!v || have[norm(v)]) return;
        if (!found[norm(v)]) found[norm(v)] = { name: v, seen: 0 };
        found[norm(v)].seen++;
      });
    });
    return Object.keys(found).map(function (k) { return found[k]; })
      .sort(function (a, b) { return b.seen - a.seen; });
  }

  return {
    KINDS: KINDS, kindOf: kindOf,
    list: list, usage: usage, isHidden: isHidden, hiddenMap: hiddenMap,
    add: add, rename: rename, hide: hide, show: show, remove: remove,
    staffActive: staffActive, staffFired: staffFired,
    staffUsage: staffUsage,
    staffFromRecords: staffFromRecords,
    split: split, norm: norm
  };
});

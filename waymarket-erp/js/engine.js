/* ============================================================================
   ВАЙ МАРКЕТ — ERP 24/7. Движок: разбор выгрузок 1С/Excel и все расчёты.
   Файл работает и в браузере (window.WM), и в Node (тесты в tests/).
   Никаких обращений в интернет — всё считается на месте.
   ========================================================================== */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.WM = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  /* --- 1. Утилиты чисел и строк ------------------------------------------ */

  // Округление до копейки без «плавающего хвоста» (0.1+0.2 = 0.30000000000000004)
  function safeRound(x) {
    if (!isFinite(x)) return 0;
    return Math.round((x + Number.EPSILON) * 100) / 100;
  }

  // Число из любой ячейки: «1 234,56 ₽», «1&nbsp;234.56», «-", null, число
  function num(v) {
    if (v == null || v === '') return 0;
    if (typeof v === 'number') return isFinite(v) ? v : 0;
    var s = String(v)
      .replace(/[   \s]/g, '')
      .replace(/₽|руб\.?|rub|р\.$/gi, '')
      .replace(/,/g, '.');
    var m = s.match(/-?\d+(?:\.\d+)?/);
    if (!m) return 0;
    var n = parseFloat(m[0]);
    return isFinite(n) ? n : 0;
  }

  function txt(v) {
    if (v == null) return '';
    return String(v).replace(/[  ]/g, ' ').trim();
  }

  // Нормализация для поиска и сопоставления: регистр, ё→е, лишние пробелы
  function norm(v) {
    return txt(v).toLowerCase().replace(/ё/g, 'е').replace(/\s+/g, ' ');
  }

  function fmtMoney(x) {
    return Math.round(num(x)).toLocaleString('ru-RU') + ' ₽';
  }
  function fmtNum(x, digits) {
    var d = digits == null ? 0 : digits;
    return num(x).toLocaleString('ru-RU', { minimumFractionDigits: d, maximumFractionDigits: d });
  }
  function fmtPct(x, digits) {
    var d = digits == null ? 1 : digits;
    return num(x).toFixed(d).replace('.', ',') + '%';
  }
  // Деление, которое не ломается на нуле
  function div(a, b) {
    b = num(b);
    return b === 0 ? 0 : num(a) / b;
  }

  function uid() {
    return 'id' + Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
  }

  /* --- 2. Разбор шапки отчёта 1С ----------------------------------------- */
  // Отчёты 1С имеют «многоэтажную» шапку: название, «Параметры:», «Отбор:»,
  // затем 2-6 строк заголовков колонок, и только потом данные.

  var HEADER_SCAN_ROWS = 22;

  // Склеиваем текст шапки по каждой колонке: колонка 8 в «Остатках» —
  // это «Группа товара» + «Номенклатура.Входит в группу».
  function columnTitles(matrix, headerEnd) {
    var titles = [];
    for (var r = 0; r <= headerEnd && r < matrix.length; r++) {
      var row = matrix[r] || [];
      for (var c = 0; c < row.length; c++) {
        var t = txt(row[c]);
        if (!t) continue;
        titles[c] = (titles[c] ? titles[c] + ' ' : '') + t;
      }
    }
    for (var i = 0; i < titles.length; i++) titles[i] = norm(titles[i] || '');
    return titles;
  }

  // Ищем колонку по ключевым словам (все слова из группы должны встретиться)
  function findCol(titles, variants, opts) {
    opts = opts || {};
    for (var v = 0; v < variants.length; v++) {
      var words = variants[v];
      for (var c = 0; c < titles.length; c++) {
        if (opts.skip && opts.skip.indexOf(c) >= 0) continue;
        var t = titles[c] || '';
        if (!t) continue;
        var ok = true;
        for (var w = 0; w < words.length; w++) {
          if (t.indexOf(words[w]) < 0) { ok = false; break; }
        }
        if (opts.not) {
          for (var n2 = 0; n2 < opts.not.length; n2++) {
            if (t.indexOf(opts.not[n2]) >= 0) { ok = false; break; }
          }
        }
        if (ok) return c;
      }
    }
    return -1;
  }

  // Ячейка с числом (дата «12.02.2026» числом не считается — в ней две точки)
  function isNumericCell(v) {
    if (typeof v === 'number') return isFinite(v);
    if (typeof v !== 'string') return false;
    var t = v.replace(/[   ]/g, '').trim();
    return t !== '' && /^-?\d+(?:[.,]\d+)?$/.test(t);
  }

  // Конец шапки = последняя строка с «заголовочными» словами ДО начала данных.
  // Важно: в отчётах «Причины списания/возврата» слово «Склад» стоит и в данных
  // («Основной склад»), поэтому шапка обязана обрываться на первой строке данных,
  // иначе первые полтора десятка позиций просто теряются.
  function findHeaderEnd(matrix, keywords) {
    var last = -1;
    var limit = Math.min(matrix.length, HEADER_SCAN_ROWS);
    for (var r = 0; r < limit; r++) {
      var row = matrix[r] || [];
      var joined = norm(row.map(txt).join(' '));
      var nums = 0;
      for (var c = 0; c < row.length; c++) if (isNumericCell(row[c])) nums++;
      var hasKeyword = false;
      for (var k = 0; k < keywords.length; k++) {
        if (joined && joined.indexOf(keywords[k]) >= 0) { hasKeyword = true; break; }
      }
      if (last >= 0 && (nums >= 2 || (nums >= 1 && !hasKeyword))) break; // пошли данные
      if (hasKeyword) last = r;
    }
    return last;
  }

  // Строки-итоги и служебные строки, которые нельзя считать товаром.
  // Именно из-за них прошлые сводки задваивали выручку.
  var STOP_NAMES = ['итого', 'всего', 'общий итог', 'итого:', 'итог'];
  function isTotalRow(name) {
    var n = norm(name);
    if (!n) return true;
    for (var i = 0; i < STOP_NAMES.length; i++) if (n === STOP_NAMES[i] || n.indexOf(STOP_NAMES[i] + ' ') === 0) return true;
    return false;
  }

  /* --- 3. Определение вида файла ----------------------------------------- */

  function sheetSignature(matrix) {
    var lines = [];
    for (var r = 0; r < Math.min(matrix.length, HEADER_SCAN_ROWS); r++) {
      lines.push((matrix[r] || []).map(txt).join(' '));
    }
    return norm(lines.join(' | '));
  }

  // Вид файла определяем по содержимому (имя файла — только подсказка),
  // чтобы переименованная выгрузка всё равно попала в нужный модуль.
  function detectKind(fileName, matrix, sheetNames) {
    var sig = sheetSignature(matrix);
    var fn = norm(fileName || '');
    var sn = norm((sheetNames || []).join(' '));

    // Книга финансового учёта: листы БАЗА_ДДС / Ввод_Касса / Запись_Выплат
    if (sn.indexOf('база_ддс') >= 0 || sn.indexOf('ввод_касса') >= 0 ||
        (sn.indexOf('пульт') >= 0 && sn.indexOf('настройки') >= 0)) return 'finance_book';
    // Ручная книга владельца: листы ДДС / ОПЛАТА / ПЛАТЕЖКА / ОТЧЁТ
    if (sn.indexOf('ддс') >= 0 || sn.indexOf('платежка') >= 0 || sn.indexOf('кассовая книга') >= 0) return 'owner_book';
    if (sn.indexOf('журнал_смен') >= 0 || sn.indexOf('журнал смен') >= 0 ||
        sn.indexOf('накладные_и_выплаты') >= 0) return 'journal_shifts';
    if (sn.indexOf('табель_смен') >= 0 || sn.indexOf('выплаты_и_авансы') >= 0) return 'journal_staff';

    // Отчёт «Неликвидные товары»: что лежит без движения
    if (sig.indexOf('неликвидные товары') >= 0 ||
        (sig.indexOf('процент продаж от остатка') >= 0 && sig.indexOf('конечный остаток') >= 0)) return 'deadstock';
    // Регистр «Общие доходы и расходы»: обороты по статьям и контрагентам.
    // Проверяем раньше накладных — в нём накладные встречаются как регистраторы
    if (sig.indexOf('общиедоходыирасходы') >= 0 || sig.indexOf('общие доходы и расходы') >= 0 ||
        (sig.indexOf('статья доходов') >= 0 && sig.indexOf('статья расходов') >= 0)) return 'incexp1c';
    if (sig.indexOf('текущие цены поставщиков') >= 0) return 'prices';
    if (sig.indexOf('контактная информация') >= 0 && sig.indexOf('контрагент') >= 0) return 'contacts';
    // Кассовые ордера проверяем раньше накладных: в ордерах накладная стоит
    // в колонке «Документ основание», иначе отчёт по кассе примут за поставки
    if (sig.indexOf('расходный кассовый ордер') >= 0) return 'cashout';
    if (sig.indexOf('приходный кассовый ордер') >= 0) return 'cashin';
    if (sig.indexOf('приходная накладная') >= 0) return 'invoices1c';
    if (sig.indexOf('прайс-лист') >= 0 || sig.indexOf('закупочный тип цен') >= 0) return 'pricelist';
    if (sig.indexOf('сумма продажи') >= 0 && sig.indexOf('номенклатура') >= 0) return 'sales';
    if (sig.indexOf('остатки номенклатуры') >= 0 ||
        (sig.indexOf('приходная сумма') >= 0 && sig.indexOf('розничная цена') >= 0)) return 'stock';
    if (sig.indexOf('штрих код') >= 0 && sig.indexOf('номенклатура') >= 0) return 'barcodes';
    if (sig.indexOf('единицы измерения') >= 0 && sig.indexOf('коэффициент') >= 0) return 'units';
    if (sig.indexOf('причина списания') >= 0 || sig.indexOf('причины списания') >= 0) return 'writeoffs1c';
    if (sig.indexOf('причина возврата') >= 0 || sig.indexOf('причины возврата') >= 0) return 'returns';
    if (sig.indexOf('списан') >= 0 || sig.indexOf('брак') >= 0 || fn.indexOf('списан') >= 0 || fn.indexOf('брак') >= 0) return 'writeoffs';
    if (fn.indexOf('возврат') >= 0) return 'returns';

    // Подсказки по имени файла — если внутри непривычная шапка
    if (fn.indexOf('продаж') >= 0) return 'sales';
    if (fn.indexOf('остатк') >= 0) return 'stock';
    if (fn.indexOf('цены') >= 0 && fn.indexOf('поставщик') >= 0) return 'prices';
    if (fn.indexOf('контакт') >= 0) return 'contacts';
    if (fn.indexOf('прайс') >= 0) return 'pricelist';
    if (fn.indexOf('штрихкод') >= 0 || fn.indexOf('штрих код') >= 0) return 'barcodes';
    if (fn.indexOf('единиц') >= 0) return 'units';
    if (fn.indexOf('неликвид') >= 0) return 'deadstock';
    if (fn.indexOf('доходы и расходы') >= 0) return 'incexp1c';
    return 'unknown';
  }

  /* --- 4. Разбор конкретных отчётов -------------------------------------- */

  // «Период: 01.08.2026 - 31.08.2026» из шапки отчёта
  function parsePeriod(matrix) {
    var sig = sheetSignature(matrix);
    var m = sig.match(/(\d{2}\.\d{2}\.\d{4})\s*[-–—]\s*(\d{2}\.\d{2}\.\d{4})/);
    if (!m) return null;
    return { from: m[1], to: m[2], days: daysBetween(m[1], m[2]) };
  }

  function ruDateToISO(d) {
    var m = txt(d).match(/(\d{2})\.(\d{2})\.(\d{4})/);
    return m ? m[3] + '-' + m[2] + '-' + m[1] : '';
  }
  function daysBetween(a, b) {
    var d1 = new Date(ruDateToISO(a)), d2 = new Date(ruDateToISO(b));
    if (isNaN(d1) || isNaN(d2)) return 0;
    return Math.round((d2 - d1) / 86400000) + 1;
  }

  // Продажи.xls (отчёт ОРП «Продажи»)
  function parseSales(matrix) {
    var he = findHeaderEnd(matrix, ['номенклатура', 'сумма продажи', 'себестоимость']);
    var t = columnTitles(matrix, he);
    var col = {
      name: findCol(t, [['номенклатура']]),
      qty: findCol(t, [['количество']], { not: ['ед.отч'] }),
      buyPrice: findCol(t, [['усредненная цена закупки'], ['цена закупки']]),
      cogs: findCol(t, [['себестоимость продажи']], { not: ['%'] }),
      inSum: findCol(t, [['приходная сумма продажи']]),
      sellPrice: findCol(t, [['усредненная цена продажи']]),
      revenue: findCol(t, [['сумма продажи']], { not: ['приходная'] }),
      vat: findCol(t, [['сумма ндс']]),
      discount: findCol(t, [['сумма скидки']]),
      profit: findCol(t, [['прибыль']], { not: ['рентабельность', '%'] }),
      markup: findCol(t, [['процент наценки']], { not: ['доп'] }),
      abc: findCol(t, [['класс abc'], ['abc']]),
      xyz: findCol(t, [['класс xyz'], ['xyz']])
    };
    if (col.name < 0 || col.revenue < 0) return { rows: [], period: parsePeriod(matrix), cols: col };

    var rows = [];
    for (var r = he + 1; r < matrix.length; r++) {
      var row = matrix[r]; if (!row) continue;
      var name = txt(row[col.name]);
      if (isTotalRow(name) && name) continue;
      var revenue = num(row[col.revenue]);
      var cogs = col.cogs >= 0 ? num(row[col.cogs]) : (col.inSum >= 0 ? num(row[col.inSum]) : 0);
      if (revenue === 0 && cogs === 0) continue;
      // Позиция без имени в 1С (переименована или помечена на удаление) — суммы у неё
      // настоящие, поэтому строку сохраняем, иначе итог дашборда не сойдётся с отчётом
      if (!name) name = 'Без наименования';
      rows.push({
        name: name,
        key: norm(name),
        qty: col.qty >= 0 ? num(row[col.qty]) : 0,
        buyPrice: col.buyPrice >= 0 ? num(row[col.buyPrice]) : 0,
        sellPrice: col.sellPrice >= 0 ? num(row[col.sellPrice]) : 0,
        revenue: revenue,
        cogs: cogs,
        profit: safeRound(revenue - cogs),
        discount: col.discount >= 0 ? num(row[col.discount]) : 0,
        abcSrc: col.abc >= 0 ? txt(row[col.abc]) : '',
        xyzSrc: col.xyz >= 0 ? txt(row[col.xyz]) : ''
      });
    }
    return { rows: rows, period: parsePeriod(matrix), cols: col };
  }

  // Остатки_Номенклатуры.xls
  function parseStock(matrix) {
    var he = findHeaderEnd(matrix, ['номенклатура', 'штрих', 'приходная', 'розничная', 'базовая единица', 'группа товара']);
    var t = columnTitles(matrix, he);
    var col = {
      name: findCol(t, [['номенклатура']], { not: ['артикул', 'код', 'штрих', 'группа', 'единица'] }),
      article: findCol(t, [['артикул']]),
      code: findCol(t, [['код товара'], ['номенклатура.код']]),
      barcode: findCol(t, [['штрих']]),
      group: findCol(t, [['группа товара'], ['входит в группу']]),
      unit: findCol(t, [['базовая единица'], ['единица']]),
      qty: findCol(t, [['количество']], { not: ['ед.отч'] }),
      buyPrice: findCol(t, [['приходная цена']]),
      buySum: findCol(t, [['приходная сумма']]),
      markup: findCol(t, [['процент наценки']]),
      retailPrice: findCol(t, [['розничная цена']]),
      retailSum: findCol(t, [['розничная сумма']])
    };
    if (col.name < 0) col.name = 0;

    var rows = [];
    for (var r = he + 1; r < matrix.length; r++) {
      var row = matrix[r]; if (!row) continue;
      var name = txt(row[col.name]);
      if (isTotalRow(name) && name) continue;
      var barcode = col.barcode >= 0 ? txt(row[col.barcode]) : '';
      var group = col.group >= 0 ? txt(row[col.group]) : '';
      var unit = col.unit >= 0 ? txt(row[col.unit]) : '';
      var buyPrice0 = col.buyPrice >= 0 ? num(row[col.buyPrice]) : 0;
      var retailPrice0 = col.retailPrice >= 0 ? num(row[col.retailPrice]) : 0;
      // Строка склада («Основной склад») несёт итоги: у неё нет ни реквизитов, ни цен
      if (!barcode && !group && !unit && !buyPrice0 && !retailPrice0) continue;
      if (!name) name = 'Без наименования';
      rows.push({
        name: name,
        key: norm(name),
        article: col.article >= 0 ? txt(row[col.article]) : '',
        code: col.code >= 0 ? txt(row[col.code]).replace(/\.0$/, '') : '',
        barcode: barcode.replace(/\.0$/, ''),
        group: group || 'Без группы',
        unit: unit,
        qty: col.qty >= 0 ? num(row[col.qty]) : 0,
        buyPrice: buyPrice0,
        buySum: col.buySum >= 0 ? num(row[col.buySum]) : 0,
        retailPrice: retailPrice0,
        retailSum: col.retailSum >= 0 ? num(row[col.retailSum]) : 0
      });
    }
    return { rows: rows, cols: col };
  }

  // Цены_Поставщиков.xls («Текущие цены поставщиков»)
  function parsePrices(matrix) {
    var he = findHeaderEnd(matrix, ['номенклатура', 'контрагент', 'цена', 'штрихкод', 'группа']);
    var t = columnTitles(matrix, he);
    var col = {
      name: findCol(t, [['номенклатура']], { not: ['артикул', 'код', 'штрих', 'группа', 'единица'] }),
      supplier: findCol(t, [['контрагент']]),
      price: findCol(t, [['цена']], { not: ['тип цен'] }),
      barcode: findCol(t, [['штрих']]),
      unit: findCol(t, [['единица']]),
      group: findCol(t, [['группа'], ['входит в группу']]),
      date: findCol(t, [['период']]),
      article: findCol(t, [['артикул']]),
      code: findCol(t, [['номенклатура.код'], ['код']])
    };
    var rows = [];
    for (var r = he + 1; r < matrix.length; r++) {
      var row = matrix[r]; if (!row) continue;
      var name = txt(row[col.name]);
      if (!name || isTotalRow(name)) continue;
      var price = num(row[col.price]);
      if (price <= 0) continue;
      rows.push({
        name: name,
        key: norm(name),
        supplier: col.supplier >= 0 ? txt(row[col.supplier]) : '',
        price: price,
        barcode: col.barcode >= 0 ? txt(row[col.barcode]).replace(/\.0$/, '') : '',
        unit: col.unit >= 0 ? txt(row[col.unit]) : '',
        group: col.group >= 0 ? txt(row[col.group]) : '',
        date: col.date >= 0 ? txt(row[col.date]) : '',
        article: col.article >= 0 ? txt(row[col.article]) : ''
      });
    }
    return { rows: rows, cols: col };
  }

  // Контакты_Поставщиков.xls — справочник контрагентов с телефонами
  function parseContacts(matrix) {
    var he = findHeaderEnd(matrix, ['контрагент', 'контактная информация', 'телефон']);
    var t = columnTitles(matrix, he);
    var col = {
      name: findCol(t, [['контрагент']], { not: ['контактная'] }),
      phone: findCol(t, [['контактная информация'], ['телефон']])
    };
    if (col.name < 0) col.name = 0;
    var rows = [];
    for (var r = he + 1; r < matrix.length; r++) {
      var row = matrix[r]; if (!row) continue;
      var name = txt(row[col.name]);
      if (!name || isTotalRow(name)) continue;
      var phone = col.phone >= 0 ? txt(row[col.phone]).replace(/\.0$/, '') : '';
      rows.push({ name: name, key: norm(name), phone: phone });
    }
    return { rows: rows, cols: col };
  }

  // Прайслист.xls — товары сгруппированы: строка группы, под ней товары
  function parsePricelist(matrix) {
    var he = findHeaderEnd(matrix, ['номенклатура', 'штрих-код', 'закупочный тип цен', 'розничный тип цен']);
    var t = columnTitles(matrix, he);
    var col = {
      name: findCol(t, [['номенклатура']]),
      barcode: findCol(t, [['штрих']]),
      code: findCol(t, [['код']], { not: ['штрих'] }),
      buy: findCol(t, [['закупочный тип цен'], ['закупочн']]),
      retail: findCol(t, [['розничный тип цен'], ['розничн']])
    };
    if (col.name < 0) col.name = 0;
    var rows = [], group = 'Без группы';
    for (var r = he + 1; r < matrix.length; r++) {
      var row = matrix[r]; if (!row) continue;
      var name = txt(row[col.name]);
      if (!name || isTotalRow(name)) continue;
      var buy = col.buy >= 0 ? num(row[col.buy]) : 0;
      var retail = col.retail >= 0 ? num(row[col.retail]) : 0;
      var barcode = col.barcode >= 0 ? txt(row[col.barcode]).replace(/\.0$/, '') : '';
      if (buy === 0 && retail === 0 && !barcode) { group = name; continue; } // строка-группа
      rows.push({
        name: name, key: norm(name), group: group, barcode: barcode,
        code: col.code >= 0 ? txt(row[col.code]).replace(/\.0$/, '') : '',
        buy: buy, retail: retail
      });
    }
    return { rows: rows, cols: col };
  }

  function parseBarcodes(matrix) {
    var he = findHeaderEnd(matrix, ['штрих код', 'штрихкод', 'номенклатура', 'единица']);
    var t = columnTitles(matrix, he);
    var col = {
      barcode: findCol(t, [['штрих']]),
      unit: findCol(t, [['единица']]),
      name: findCol(t, [['номенклатура']])
    };
    var rows = [];
    for (var r = he + 1; r < matrix.length; r++) {
      var row = matrix[r]; if (!row) continue;
      var bc = col.barcode >= 0 ? txt(row[col.barcode]).replace(/\.0$/, '') : '';
      var nm = col.name >= 0 ? txt(row[col.name]) : '';
      if (!bc || !nm) continue;
      rows.push({ barcode: bc, name: nm, key: norm(nm), unit: col.unit >= 0 ? txt(row[col.unit]) : '' });
    }
    return { rows: rows, cols: col };
  }

  function parseUnits(matrix) {
    var he = findHeaderEnd(matrix, ['единицы измерения', 'коэффициент', 'количество в упаковке']);
    var t = columnTitles(matrix, he);
    var col = {
      unit: findCol(t, [['единицы измерения']]),
      code: findCol(t, [['номенклатура.код'], ['код']]),
      inPack: findCol(t, [['количество в упаковке']]),
      coef: findCol(t, [['коэффициент']], { not: ['цены'] })
    };
    var rows = [];
    for (var r = he + 1; r < matrix.length; r++) {
      var row = matrix[r]; if (!row) continue;
      var code = col.code >= 0 ? txt(row[col.code]).replace(/\.0$/, '') : '';
      if (!code) continue;
      rows.push({
        code: code,
        unit: col.unit >= 0 ? txt(row[col.unit]) : '',
        inPack: col.inPack >= 0 ? num(row[col.inPack]) : 0,
        coef: col.coef >= 0 ? num(row[col.coef]) : 1
      });
    }
    return { rows: rows, cols: col };
  }

  // Списания_Брак.xlsx — свободная форма: дата / товар / кол-во / сумма / причина
  function parseWriteoffs(matrix) {
    var he = findHeaderEnd(matrix, ['дата', 'товар', 'номенклатура', 'сумма', 'причина', 'количество']);
    var t = columnTitles(matrix, he);
    var col = {
      date: findCol(t, [['дата']]),
      name: findCol(t, [['товар'], ['номенклатура']]),
      qty: findCol(t, [['количество'], ['кол-во']]),
      sum: findCol(t, [['сумма']]),
      reason: findCol(t, [['причина'], ['основание'], ['примечание']])
    };
    var rows = [];
    for (var r = he + 1; r < matrix.length; r++) {
      var row = matrix[r]; if (!row) continue;
      var name = col.name >= 0 ? txt(row[col.name]) : '';
      if (!name || isTotalRow(name)) continue;
      rows.push({
        id: uid(),
        date: excelDate(col.date >= 0 ? row[col.date] : ''),
        name: name,
        qty: col.qty >= 0 ? num(row[col.qty]) : 0,
        sum: col.sum >= 0 ? num(row[col.sum]) : 0,
        reason: col.reason >= 0 ? txt(row[col.reason]) : ''
      });
    }
    return { rows: rows, cols: col };
  }

  // Отчёт 1С «Причины списания»: номенклатура / склад / партия / причина / суммы.
  // Себестоимость берём из «Приходной суммы» — это деньги, которые магазин потерял.
  function parseWriteoffs1C(matrix) {
    var he = findHeaderEnd(matrix, ['номенклатура', 'причина списания', 'партия', 'склад', 'приходная сумма']);
    var t = columnTitles(matrix, he);
    var col = {
      name: findCol(t, [['номенклатура']]),
      warehouse: findCol(t, [['склад']]),
      batch: findCol(t, [['партия']]),
      reason: findCol(t, [['причина списания'], ['причина']]),
      qty: findCol(t, [['количество']], { not: ['записей'] }),
      cost: findCol(t, [['приходная сумма в регламентной'], ['приходная сумма'], ['себестоимость']]),
      retail: findCol(t, [['розничная сумма']])
    };
    var rows = [];
    for (var r = he + 1; r < matrix.length; r++) {
      var row = matrix[r]; if (!row) continue;
      var name = txt(row[col.name]);
      if (name && isTotalRow(name)) continue;
      var wh = col.warehouse >= 0 ? txt(row[col.warehouse]) : '';
      var batch = col.batch >= 0 ? txt(row[col.batch]) : '';
      if (!wh && !batch) continue;
      rows.push({
        id: uid(),
        name: name || 'Без наименования',
        key: norm(name),
        warehouse: wh,
        batch: batch,
        reason: (col.reason >= 0 ? txt(row[col.reason]) : '') || 'Без причины',
        qty: col.qty >= 0 ? num(row[col.qty]) : 0,
        cost: col.cost >= 0 ? num(row[col.cost]) : 0,
        retail: col.retail >= 0 ? num(row[col.retail]) : 0
      });
    }
    return { rows: rows, period: parsePeriod(matrix), cols: col };
  }

  // Отчёт 1С «Причины возврата»: причина / склад / договор / номенклатура / суммы
  function parseReturns(matrix) {
    var he = findHeaderEnd(matrix, ['причина возврата', 'номенклатура', 'договор', 'склад', 'приходная сумма']);
    var t = columnTitles(matrix, he);
    var col = {
      reason: findCol(t, [['причина возврата'], ['причина']]),
      warehouse: findCol(t, [['склад']]),
      contract: findCol(t, [['договор']]),
      name: findCol(t, [['номенклатура']]),
      qty: findCol(t, [['количество']], { not: ['записей'] }),
      cost: findCol(t, [['приходная сумма в регламентной'], ['приходная сумма'], ['себестоимость']]),
      retail: findCol(t, [['розничная сумма']])
    };
    var rows = [];
    for (var r = he + 1; r < matrix.length; r++) {
      var row = matrix[r]; if (!row) continue;
      var name = col.name >= 0 ? txt(row[col.name]) : '';
      var first = txt(row[0]);
      if (first && isTotalRow(first)) continue;
      if (!name) continue;
      rows.push({
        id: uid(),
        name: name,
        key: norm(name),
        reason: (col.reason >= 0 ? txt(row[col.reason]) : '') || 'Без причины',
        warehouse: col.warehouse >= 0 ? txt(row[col.warehouse]) : '',
        contract: col.contract >= 0 ? txt(row[col.contract]) : '',
        qty: col.qty >= 0 ? num(row[col.qty]) : 0,
        cost: col.cost >= 0 ? num(row[col.cost]) : 0,
        retail: col.retail >= 0 ? num(row[col.retail]) : 0
      });
    }
    return { rows: rows, period: parsePeriod(matrix), cols: col };
  }

  // Свод «по причине»: сколько денег ушло и какая доля от общей суммы
  function byReason(rows) {
    var map = {}, total = 0, i;
    for (i = 0; i < rows.length; i++) {
      var k = rows[i].reason || 'Без причины';
      if (!map[k]) map[k] = { reason: k, qty: 0, cost: 0, retail: 0, docs: 0 };
      map[k].qty += num(rows[i].qty); map[k].cost += num(rows[i].cost);
      map[k].retail += num(rows[i].retail); map[k].docs++;
      total += num(rows[i].cost);
    }
    var out = [];
    for (var k2 in map) {
      var m = map[k2];
      m.qty = safeRound(m.qty); m.cost = safeRound(m.cost); m.retail = safeRound(m.retail);
      m.share = safeRound(div(m.cost, total) * 100);
      out.push(m);
    }
    return out.sort(function (a, b) { return b.cost - a.cost; });
  }

  // Топ позиций по сумме потерь (списания или возвраты)
  function topByCost(rows, limit) {
    var map = {};
    for (var i = 0; i < rows.length; i++) {
      var k = rows[i].key || norm(rows[i].name);
      if (!map[k]) map[k] = { name: rows[i].name, qty: 0, cost: 0, retail: 0, docs: 0, reasons: {} };
      map[k].qty += num(rows[i].qty); map[k].cost += num(rows[i].cost);
      map[k].retail += num(rows[i].retail); map[k].docs++;
      map[k].reasons[rows[i].reason] = true;
    }
    var out = [];
    for (var k2 in map) {
      var m = map[k2];
      m.qty = safeRound(m.qty); m.cost = safeRound(m.cost); m.retail = safeRound(m.retail);
      m.reason = Object.keys(m.reasons).join(', ');
      delete m.reasons;
      out.push(m);
    }
    out.sort(function (a, b) { return b.cost - a.cost; });
    return limit ? out.slice(0, limit) : out;
  }

  // Приведение суммы за произвольный период к месяцу (30 дней) — для P&L
  function perMonth(sum, days) {
    var d = num(days);
    return d > 0 ? safeRound(num(sum) / d * 30) : safeRound(sum);
  }

  // Дата из имени документа 1С: «Приходная накладная ПФ000… от 01.08.2026 10:21:25»
  function docDate(name) {
    var m = txt(name).match(/от\s+(\d{2})\.(\d{2})\.(\d{4})/);
    return m ? m[3] + '-' + m[2] + '-' + m[1] : '';
  }

  // Отчёт 1С «Приходная накладная» — реальные поставки за период
  function parseIncomingInvoices(matrix) {
    var he = findHeaderEnd(matrix, ['приходная накладная', 'контрагент', 'сумма документа', 'склад', 'договор']);
    var t = columnTitles(matrix, he);
    var col = {
      doc: findCol(t, [['приходная накладная']]),
      // «Дата документа» — когда товар пришёл в магазин.
      // «Входящая дата документа» — дата на бумаге поставщика, она другая:
      // поставщик выписал накладную 30 июля, а привёз 1 августа.
      date: findCol(t, [['дата документа']], { not: ['входящ'] }),
      incomingDate: findCol(t, [['входящая дата документа']]),
      incomingNo: findCol(t, [['входящий номер документа']]),
      supplier: findCol(t, [['контрагент']]),
      contract: findCol(t, [['договор']], { not: ['спецификация'] }),
      warehouse: findCol(t, [['склад']]),
      storeman: findCol(t, [['кладовщик']]),
      author: findCol(t, [['автор']], { not: ['не используется'] }),
      payDate: findCol(t, [['дата оплаты']]),
      sum: findCol(t, [['сумма документа прих']]),
      retail: findCol(t, [['сумма документа розница']]),
      comment: findCol(t, [['комментарий']])
    };
    var rows = [];
    for (var r = he + 1; r < matrix.length; r++) {
      var row = matrix[r]; if (!row) continue;
      var doc = txt(row[col.doc]);
      if (!doc || isTotalRow(doc)) continue;
      // Дата прихода — дата самого документа 1С (она стоит в его названии
      // «…от 01.08.2026»). По ней считаются день, месяц и отсрочка платежа.
      // Раньше бралась входящая дата поставщика — из-за этого приход
      // попадал в другой день, а то и в прошлый месяц.
      var date = docDate(doc) || (col.date >= 0 ? excelDate(row[col.date]) : '');
      var incoming = col.incomingDate >= 0 ? excelDate(row[col.incomingDate]) : '';
      if (!date) date = incoming;
      rows.push({
        id: uid(),
        doc: doc,
        key: norm(doc),
        date: date,
        incomingDate: incoming,
        incomingNo: col.incomingNo >= 0 ? txt(row[col.incomingNo]) : '',
        supplier: (col.supplier >= 0 ? txt(row[col.supplier]) : '') || 'Без контрагента',
        contract: col.contract >= 0 ? txt(row[col.contract]) : '',
        warehouse: col.warehouse >= 0 ? txt(row[col.warehouse]) : '',
        storeman: col.storeman >= 0 ? txt(row[col.storeman]) : '',
        author: col.author >= 0 ? txt(row[col.author]) : '',
        payDate: col.payDate >= 0 ? excelDate(row[col.payDate]) : '',
        sum: col.sum >= 0 ? num(row[col.sum]) : 0,
        retail: col.retail >= 0 ? num(row[col.retail]) : 0,
        comment: col.comment >= 0 ? txt(row[col.comment]) : ''
      });
    }
    return { rows: rows, period: parsePeriod(matrix), cols: col };
  }

  // Отчёт 1С «Расходный/Приходный кассовый ордер» — движение наличных
  function parseCashOrders(matrix, direction) {
    var he = findHeaderEnd(matrix, ['кассовый ордер', 'вид операции', 'статья ддс', 'контрагент', 'касса']);
    var t = columnTitles(matrix, he);
    var col = {
      doc: findCol(t, [['кассовый ордер']]),
      operation: findCol(t, [['вид операции']]),
      article: findCol(t, [['статья ддс'], ['статья доходов и расходов']]),
      basis: findCol(t, [['документ основание'], ['основание']]),
      supplier: findCol(t, [['контрагент']]),
      cashbox: findCol(t, [['касса']], { not: ['счет', 'кассир'] }),
      cashier: findCol(t, [['кассир']]),
      employee: findCol(t, [['сотрудник']], { not: ['не используется'] }),
      shiftNo: findCol(t, [['номер смены']]),
      zReport: findCol(t, [['учет z-отчетов'], ['учет z']]),
      comment: findCol(t, [['комментарий']]),
      sum: findCol(t, [['сумма']], { not: ['ндс', 'планиру', 'валют', 'кратность'] })
    };
    var rows = [];
    for (var r = he + 1; r < matrix.length; r++) {
      var row = matrix[r]; if (!row) continue;
      var doc = txt(row[col.doc]);
      if (!doc || isTotalRow(doc)) continue;
      var basis = col.basis >= 0 ? txt(row[col.basis]) : '';
      rows.push({
        id: uid(),
        doc: doc,
        date: docDate(doc),
        direction: direction || 'out',
        operation: col.operation >= 0 ? txt(row[col.operation]) : '',
        article: (col.article >= 0 ? txt(row[col.article]) : '') || 'Без статьи',
        basis: basis,
        basisKey: norm(basis),
        supplier: (col.supplier >= 0 ? txt(row[col.supplier]) : '') || '',
        cashbox: col.cashbox >= 0 ? txt(row[col.cashbox]) : '',
        cashier: col.cashier >= 0 ? txt(row[col.cashier]) : '',
        employee: col.employee >= 0 ? txt(row[col.employee]) : '',
        shiftNo: col.shiftNo >= 0 ? txt(row[col.shiftNo]).replace(/\.0$/, '') : '',
        zReport: col.zReport >= 0 ? txt(row[col.zReport]) : '',
        comment: col.comment >= 0 ? txt(row[col.comment]) : '',
        sum: col.sum >= 0 ? num(row[col.sum]) : 0
      });
    }
    return { rows: rows, period: parsePeriod(matrix), cols: col };
  }

  // Отчёт 1С «Неликвидные товары»: приход, продажи и остаток в штуках,
  // плюс дата последнего поступления — по ней видно, сколько товар лежит.
  function parseDeadStock(matrix) {
    var he = findHeaderEnd(matrix, ['неликвидные товары', 'номенклатура', 'конечный остаток', 'продажи', 'склад']);
    var t = columnTitles(matrix, he);
    var col = {
      name: findCol(t, [['номенклатура'], ['склад']], { not: ['артикул', 'код', 'штрих'] }),
      inSum: findCol(t, [['общий приход']]),
      income: findCol(t, [['поступление']], { not: ['дата'] }),
      lastIn: findCol(t, [['дата последнего поступ']]),
      left: findCol(t, [['конечный остаток']]),
      sold: findCol(t, [['продажи']], { not: ['процент', 'тип'] }),
      pctIn: findCol(t, [['процент продаж от поступ'], ['процент продаж от прих']]),
      pctLeft: findCol(t, [['процент продаж от остатка']])
    };
    if (col.name < 0) col.name = 0;
    var rows = [], i;
    for (var r = he + 1; r < matrix.length; r++) {
      var row = matrix[r]; if (!row) continue;
      var name = txt(row[col.name]);
      if (!name || isTotalRow(name)) continue;
      if (norm(name).indexOf('склад') >= 0 && norm(name).length < 20) continue;   // строка склада
      var left = col.left >= 0 ? num(row[col.left]) : 0;
      var sold = col.sold >= 0 ? num(row[col.sold]) : 0;
      var lastIn = col.lastIn >= 0 ? excelDate(row[col.lastIn]) : '';
      rows.push({
        name: name, key: norm(name),
        inSum: col.inSum >= 0 ? num(row[col.inSum]) : 0,
        income: col.income >= 0 ? num(row[col.income]) : 0,
        lastIn: lastIn,
        left: left, sold: sold,
        pctIn: col.pctIn >= 0 ? num(row[col.pctIn]) : 0,
        pctLeft: col.pctLeft >= 0 ? num(row[col.pctLeft]) : 0
      });
    }
    return { rows: rows, period: parsePeriod(matrix), cols: col };
  }

  // Замороженные деньги: что лежит на полке и не продаётся.
  // Цену берём из «Остатков номенклатуры», давность — по последнему приходу.
  function deadStockList(rows, stockIdx, settings, todayStr) {
    settings = settings || {};
    var maxPct = num(settings.deadSoldPct) || 20;      // продали меньше этого % от остатка
    var days = num(settings.deadDays) || 60;           // и завозили давно
    var today = todayStr || new Date().toISOString().slice(0, 10);
    var out = [], total = 0, noSale = 0;
    for (var i = 0; i < (rows || []).length; i++) {
      var r = rows[i];
      var left = safeRound(r.left);
      if (left <= 0) continue;                          // на полке ничего нет — не о чем говорить
      var age = r.lastIn ? Math.round((new Date(today) - new Date(r.lastIn)) / 86400000) : null;
      var slow = r.sold <= 0 || (r.pctLeft > 0 && r.pctLeft < maxPct);
      var old = age !== null && age >= days;
      if (!slow && !old) continue;
      var st = stockIdx ? stockIdx[r.key] : null;
      var price = st ? num(st.buyPrice) : 0;
      var money = safeRound(left * price);
      total += money;
      if (r.sold <= 0) noSale++;
      out.push({
        name: r.name, key: r.key, left: left, sold: safeRound(r.sold),
        lastIn: r.lastIn, age: age, price: price, money: money,
        group: st ? st.group : '',
        pctLeft: r.pctLeft,
        reason: r.sold <= 0 ? 'нет продаж' : (old ? 'лежит ' + age + ' дн.' : 'продаётся медленно')
      });
    }
    out.sort(function (a, b) { return b.money - a.money || b.left - a.left; });
    return { list: out, total: safeRound(total), count: out.length, noSale: noSale };
  }

  // Регистр 1С «Общие доходы и расходы»: иерархия «вид операции → статья →
  // контрагент → документ». Уровень определяем по суммам: сумма родителя
  // равна сумме его строк, поэтому разбираем стеком.
  // Документ 1С узнаём по номеру вида «ПФ0000040007665» — так надёжнее,
  // чем список названий: документы бывают самые разные.
  var DOC_RE = /(ПФ|АА|ЦБ)\d{6,}|№\s*\d+\s+от\s+\d{2}\.\d{2}\.\d{4}/i;

  function parseIncomeExpense(matrix) {
    var he = findHeaderEnd(matrix, ['вид операции', 'приход', 'расход', 'статья доходов',
      'статья расходов', 'регистратор', 'количество записей']);
    var t = columnTitles(matrix, he);
    var col = {
      name: 0,
      income: findCol(t, [['приход']], { not: ['статья', 'вид', 'количество'] }),
      expense: findCol(t, [['расход']], { not: ['статья', 'вид', 'количество'] }),
      count: findCol(t, [['количество записей']])
    };
    if (col.income < 0) col.income = 5;
    if (col.expense < 0) col.expense = 7;

    var stack = [], rows = [], totals = null;
    for (var r = he + 1; r < matrix.length; r++) {
      var row = matrix[r]; if (!row) continue;
      var name = txt(row[col.name]);
      var inc = num(row[col.income]), exp = num(row[col.expense]);
      var sum = inc + exp;
      if (!name && !sum) continue;
      if (isTotalRow(name)) continue;
      // первая строка без имени — общий итог отчёта
      if (totals === null && !name && !stack.length) { totals = { income: inc, expense: exp }; continue; }

      // уровень определяем по суммам: сумма родителя равна сумме его строк
      while (stack.length && stack[stack.length - 1].rest + 0.01 < sum) stack.pop();
      if (stack.length) stack[stack.length - 1].rest = safeRound(stack[stack.length - 1].rest - sum);

      if (DOC_RE.test(name)) {
        rows.push({
          operation: stack[0] ? stack[0].name : '',
          article: stack[1] ? stack[1].name : '',
          party: stack[2] ? stack[2].name : '',
          // самый глубокий заполненный уровень — обычно это контрагент или статья
          group: (stack[2] && stack[2].name) || (stack[1] && stack[1].name) || '',
          doc: name, date: docDate(name),
          income: safeRound(inc), expense: safeRound(exp),
          count: col.count >= 0 ? num(row[col.count]) : 1
        });
      } else {
        stack.push({ name: name, rest: sum });
      }
    }
    if (!totals) {
      totals = { income: 0, expense: 0 };
      rows.forEach(function (x) { totals.income += x.income; totals.expense += x.expense; });
    }
    totals.income = safeRound(totals.income); totals.expense = safeRound(totals.expense);
    return { rows: rows, totals: totals, period: parsePeriod(matrix), cols: col };
  }

  // Свод: по видам операций, по статьям и по контрагентам
  function incomeExpenseSummary(rows) {
    function group(field) {
      var map = {};
      (rows || []).forEach(function (r) {
        var k = r[field] || '—';
        if (!map[k]) map[k] = { name: k, income: 0, expense: 0, count: 0 };
        map[k].income += r.income; map[k].expense += r.expense; map[k].count++;
      });
      var out = [];
      for (var k in map) {
        map[k].income = safeRound(map[k].income); map[k].expense = safeRound(map[k].expense);
        map[k].net = safeRound(map[k].income - map[k].expense);
        out.push(map[k]);
      }
      return out.sort(function (a, b) { return (b.income + b.expense) - (a.income + a.expense); });
    }
    return { byOperation: group('operation'), byArticle: group('article'),
      byParty: group('party'), byGroup: group('group') };
  }

  // Сопоставление накладных и оплат: сколько заплатили сразу, сколько ушло
  // на погашение старых долгов и сколько магазин должен поставщикам сейчас.
  function matchPayments(invoices, orders) {
    var paidByDoc = {}, i;
    var oldDebtPaid = 0, matchedPaid = 0, orphan = [];
    var invKeys = {};
    for (i = 0; i < invoices.length; i++) invKeys[invoices[i].key] = true;

    for (i = 0; i < orders.length; i++) {
      var o = orders[i];
      if (!o.basisKey) continue;
      if (invKeys[o.basisKey]) {
        paidByDoc[o.basisKey] = (paidByDoc[o.basisKey] || 0) + num(o.sum);
        matchedPaid += num(o.sum);
      } else {
        // оплата по накладной вне периода выгрузки = погашение старого долга
        oldDebtPaid += num(o.sum);
        orphan.push(o);
      }
    }

    var docs = [], totalSum = 0, totalLeft = 0, overpaid = 0;
    for (i = 0; i < invoices.length; i++) {
      var inv = invoices[i];
      var paid = safeRound(paidByDoc[inv.key] || 0);
      var left = Math.max(0, safeRound(num(inv.sum) - paid));
      // переплата по документу не уменьшает долг по другим накладным — считаем отдельно
      overpaid += Math.max(0, safeRound(paid - num(inv.sum)));
      totalSum += num(inv.sum); totalLeft += left;
      docs.push({
        doc: inv.doc, date: inv.date, supplier: inv.supplier, sum: safeRound(inv.sum),
        retail: safeRound(inv.retail), paid: paid, left: left,
        status: left === 0 ? 'paid' : (paid > 0 ? 'part' : 'debt'),
        statusText: left === 0 ? 'Оплачено 100%' : (paid > 0 ? 'Частичный долг' : 'В долг 100%')
      });
    }
    docs.sort(function (a, b) { return b.left - a.left || (b.date || '').localeCompare(a.date || ''); });

    return {
      docs: docs,
      totalSum: safeRound(totalSum),
      totalPaid: safeRound(matchedPaid),
      totalLeft: safeRound(totalLeft),
      overpaid: safeRound(overpaid),
      oldDebtPaid: safeRound(oldDebtPaid),
      orphan: orphan
    };
  }

  // Свод по поставщикам: поставки, оплаты, текущий долг
  function supplierBalance(invoices, orders) {
    var map = {}, i, k;
    function slot(name) {
      var key = norm(name) || '—';
      if (!map[key]) map[key] = { supplier: name || '—', docs: 0, sum: 0, paid: 0, paidNow: 0, paidDebt: 0 };
      return map[key];
    }
    for (i = 0; i < invoices.length; i++) {
      var m = slot(invoices[i].supplier);
      m.docs++; m.sum += num(invoices[i].sum);
    }
    for (i = 0; i < orders.length; i++) {
      var o = orders[i];
      if (!o.supplier) continue;
      var m2 = slot(o.supplier);
      m2.paid += num(o.sum);
      if (norm(o.article).indexOf('сразу') >= 0) m2.paidNow += num(o.sum);
      else if (norm(o.article).indexOf('долг') >= 0) m2.paidDebt += num(o.sum);
    }
    var out = [];
    for (k in map) {
      var v = map[k];
      v.sum = safeRound(v.sum); v.paid = safeRound(v.paid);
      v.paidNow = safeRound(v.paidNow); v.paidDebt = safeRound(v.paidDebt);
      v.debt = safeRound(v.sum - v.paid);
      out.push(v);
    }
    return out.sort(function (a, b) { return b.debt - a.debt; });
  }

  // Свод выплат наличными по статьям и кассам
  function cashSummary(orders) {
    var byArticle = {}, byCashbox = {}, byOperation = {}, total = 0, shifts = {};
    for (var i = 0; i < orders.length; i++) {
      var o = orders[i], s = num(o.sum);
      total += s;
      byArticle[o.article] = safeRound((byArticle[o.article] || 0) + s);
      if (o.cashbox) byCashbox[o.cashbox] = safeRound((byCashbox[o.cashbox] || 0) + s);
      if (o.operation) byOperation[o.operation] = safeRound((byOperation[o.operation] || 0) + s);
      if (o.shiftNo) shifts[o.shiftNo] = safeRound((shifts[o.shiftNo] || 0) + s);
    }
    function toList(obj) {
      var out = [];
      for (var k in obj) out.push({ name: k, sum: obj[k], share: safeRound(div(obj[k], total) * 100) });
      return out.sort(function (a, b) { return b.sum - a.sum; });
    }
    return {
      total: safeRound(total), byArticle: toList(byArticle),
      byCashbox: toList(byCashbox), byOperation: toList(byOperation), byShift: shifts
    };
  }

  // Дата из ячейки: «2026-08-18», «18.08.2026», Date, серийный номер Excel
  function excelDate(v) {
    if (v == null || v === '') return '';
    if (v instanceof Date && !isNaN(v)) return v.toISOString().slice(0, 10);
    // 2958465 — 31.12.9999 по календарю Excel: раньше предел был 2064 год
    if (typeof v === 'number' && v > 20000 && v < 2958466) {
      var ms = Math.round((v - 25569) * 86400000);
      return new Date(ms).toISOString().slice(0, 10);
    }
    var s = txt(v);
    var iso = s.match(/(\d{4})-(\d{2})-(\d{2})/);
    if (iso) return iso[0];
    var ru = s.match(/(\d{1,2})\.(\d{1,2})\.(\d{4})/);
    if (ru) return ru[3] + '-' + pad2(ru[2]) + '-' + pad2(ru[1]);
    return s;
  }
  function pad2(x) { return String(x).length < 2 ? '0' + x : String(x); }

  /* --- 5. Журналы из Excel (смены, накладные, табель, выплаты) ------------ */

  function rowsByHeader(matrix) {
    // Первая непустая строка — заголовки, дальше данные (наши журналы простые)
    var start = 0;
    while (start < matrix.length && !(matrix[start] || []).some(function (c) { return txt(c); })) start++;
    var head = (matrix[start] || []).map(norm);
    var out = [];
    for (var r = start + 1; r < matrix.length; r++) {
      var row = matrix[r]; if (!row) continue;
      var first = txt(row[0]);
      if (!first || isTotalRow(first)) continue;
      var obj = {};
      for (var c = 0; c < head.length; c++) if (head[c]) obj[head[c]] = row[c];
      obj.__row = row;
      out.push(obj);
    }
    return { head: head, rows: out };
  }

  function pick(obj, variants) {
    for (var v = 0; v < variants.length; v++) {
      for (var k in obj) {
        if (k === '__row') continue;
        if (k.indexOf(variants[v]) >= 0) return obj[k];
      }
    }
    return '';
  }

  function parseShiftJournalSheet(matrix) {
    var d = rowsByHeader(matrix), out = [];
    for (var i = 0; i < d.rows.length; i++) {
      var o = d.rows[i];
      out.push({
        id: uid(),
        date: excelDate(pick(o, ['дата'])),
        shift: txt(pick(o, ['смена'])) || 'Дневная',
        cashier: txt(pick(o, ['кассир'])),
        cashbox: txt(pick(o, ['касса №', 'касса'])),
        openCash: num(pick(o, ['остаток утро', 'остаток на начало'])),
        zCash: num(pick(o, ['z-отчет', 'выручка z'])),
        payouts: num(pick(o, ['выплаты из кассы'])),
        factCash: num(pick(o, ['факт нал', 'факт в кассе'])),
        terminal: num(pick(o, ['терминал'])),
        note: ''
      });
    }
    return out;
  }

  function parseInvoiceSheet(matrix) {
    var d = rowsByHeader(matrix), out = [];
    for (var i = 0; i < d.rows.length; i++) {
      var o = d.rows[i];
      out.push({
        id: uid(),
        date: excelDate(pick(o, ['дата'])),
        doc: txt(pick(o, ['№ накладной', 'накладной', 'документ'])),
        supplier: txt(pick(o, ['поставщик', 'контрагент'])),
        goods: txt(pick(o, ['товар'])),
        total: num(pick(o, ['сумма накладной'])),
        paidCash: num(pick(o, ['оплачено сразу', 'оплачено налом'])),
        paidDebt: num(pick(o, ['погашение', 'оплачено в погашение'])),
        shift: txt(pick(o, ['смена приемки', 'смена'])),
        receiver: txt(pick(o, ['кассир', 'приемщик'])),
        due: ''
      });
    }
    return out;
  }

  function parseTimesheetSheet(matrix) {
    var d = rowsByHeader(matrix), out = [];
    for (var i = 0; i < d.rows.length; i++) {
      var o = d.rows[i];
      out.push({
        id: uid(),
        date: excelDate(pick(o, ['дата'])),
        employee: txt(pick(o, ['фио', 'сотрудник'])),
        position: txt(pick(o, ['должность'])),
        shift: txt(pick(o, ['смена'])),
        hours: num(pick(o, ['отработано часов', 'часов'])),
        rate: num(pick(o, ['ставка за час', 'ставка'])),
        penalty: num(pick(o, ['штраф', 'удержан'])),
        bonus: num(pick(o, ['премия']))
      });
    }
    return out;
  }

  function parsePayoutSheet(matrix) {
    var d = rowsByHeader(matrix), out = [];
    for (var i = 0; i < d.rows.length; i++) {
      var o = d.rows[i];
      out.push({
        id: uid(),
        date: excelDate(pick(o, ['дата выплаты', 'дата'])),
        employee: txt(pick(o, ['фио', 'сотрудник'])),
        type: txt(pick(o, ['тип выплаты'])) || 'Аванс',
        amount: num(pick(o, ['сумма выплаты', 'сумма'])),
        form: txt(pick(o, ['форма оплаты'])) || 'Наличные из кассы',
        note: txt(pick(o, ['основание', 'примечание'])),
        issuedBy: txt(pick(o, ['выдал']))
      });
    }
    return out;
  }

  /* --- 5б. Ручная книга владельца (ДДС, ОПЛАТА, ПЛАТЕЖКА, ОТЧЁТ) ---------- */

  // Лист «ДДС»: одна строка = одна смена. Ведётся вручную каждый день.
  function parseOwnerDaily(matrix) {
    var he = findHeaderEnd(matrix, ['дата', 'смена', 'наличная', 'долг поставщикам', 'общаяя торговля']);
    var t = columnTitles(matrix, he);
    var col = {
      date: findCol(t, [['дата']]),
      shift: findCol(t, [['смена']]),
      cash: findCol(t, [['наличная торголвя'], ['наличная торговля']]),
      payout: findCol(t, [['выплата кассы']]),
      online: findCol(t, [['онлайн торговля']]),
      transfer: findCol(t, [['перевод']]),
      iman: findCol(t, [['иман']]),
      diff: findCol(t, [['расхождение кассы']]),
      cashLeft: findCol(t, [['наличка']]),
      forPurchase: findCol(t, [['на закуп']]),
      buyCashOffice: findCol(t, [['закуп за наличку офисом']]),
      payDebtOffice: findCol(t, [['выплата долга офисом']]),
      buyCredit: findCol(t, [['закуп товаров долг']]),
      writeoff: findCol(t, [['списание продукта']]),
      bankFee: findCol(t, [['комиссия банка']]),
      lunch: findCol(t, [['обед']]),
      fuel: findCol(t, [['гсм']]),
      supplies: findCol(t, [['расходники']]),
      diffOffice: findCol(t, [['расхождение выплат офиса']]),
      buyTotal: findCol(t, [['общий закуп']]),
      salary: findCol(t, [['зарплата']]),
      rent: findCol(t, [['аренда']]),
      utilities: findCol(t, [['комунальные'], ['коммунальные']]),
      tax: findCol(t, [['налог']]),
      revenue: findCol(t, [['общаяя торговля'], ['общая торговля']]),
      margin: findCol(t, [['25%']]),
      profit: findCol(t, [['прибыль']]),
      debt: findCol(t, [['долг поставщикам']])
    };
    var rows = [], openingDebt = 0;
    for (var r = he + 1; r < matrix.length; r++) {
      var row = matrix[r]; if (!row) continue;
      var d = excelDate(row[col.date]);
      if (!d) {
        // строка без даты в начале листа — входящий остаток долга
        if (col.debt >= 0 && num(row[col.debt]) > 0 && !openingDebt) openingDebt = num(row[col.debt]);
        continue;
      }
      var o = { date: d, shift: txt(row[col.shift]) || '—' };
      for (var k in col) {
        if (k === 'date' || k === 'shift') continue;
        o[k] = col[k] >= 0 ? num(row[col[k]]) : 0;
      }
      o.total = safeRound(o.cash + o.online + o.transfer);
      rows.push(o);
    }
    return { rows: rows, openingDebt: safeRound(openingDebt), cols: col };
  }

  // Лист «ОПЛАТА»: каждая строка — оплата поставщику за день
  function parseOwnerPayments(matrix) {
    var he = findHeaderEnd(matrix, ['дата', 'оплата за наличку', 'оплата долга', 'закуп в долг']);
    var t = columnTitles(matrix, he);
    var col = {
      date: findCol(t, [['дата']]),
      paidCash: findCol(t, [['оплата за наличку']]),
      paidDebt: findCol(t, [['оплата долга']]),
      buyCredit: findCol(t, [['закуп в долг']]),
      salary: findCol(t, [['зарплата']]),
      other: findCol(t, [['прочие расходы']]),
      total: findCol(t, [['итог']]),
      available: findCol(t, [['доступно']])
    };
    var rows = [];
    for (var r = he + 1; r < matrix.length; r++) {
      var row = matrix[r]; if (!row) continue;
      var d = excelDate(row[col.date]);
      if (!d) continue;
      var o = { date: d };
      for (var k in col) { if (k === 'date') continue; o[k] = col[k] >= 0 ? num(row[col[k]]) : 0; }
      if (!o.paidCash && !o.paidDebt && !o.buyCredit && !o.salary && !o.other) continue;
      rows.push(o);
    }
    return { rows: rows, cols: col };
  }

  // Лист «ПЛАТЕЖКА»: должность, ФИО, график, дневная ставка
  function parseOwnerPayroll(matrix) {
    var he = findHeaderEnd(matrix, ['должность', 'фио', 'график работы', 'зарплата']);
    var t = columnTitles(matrix, he);
    var col = {
      position: findCol(t, [['должность']]),
      name: findCol(t, [['фио']]),
      schedule: findCol(t, [['график работы']]),
      rate: findCol(t, [['зарплата']])
    };
    var rows = [];
    for (var r = he + 1; r < matrix.length; r++) {
      var row = matrix[r]; if (!row) continue;
      var pos = col.position >= 0 ? txt(row[col.position]) : '';
      var nm = col.name >= 0 ? txt(row[col.name]) : '';
      if (!pos && !nm) continue;
      if (isTotalRow(pos) && pos) continue;
      rows.push({
        position: pos, name: nm,
        schedule: col.schedule >= 0 ? txt(row[col.schedule]) : '',
        rate: col.rate >= 0 ? num(row[col.rate]) : 0,
        night: norm(pos).indexOf('ночь') >= 0
      });
    }
    return { rows: rows, cols: col };
  }

  // Листы «ОТЧЁТ», «ОТЧЁТ МЕС», «ОТЧЁТ ДДС» — сводка по статьям за месяц
  function parseOwnerMonthly(matrix) {
    var rows = [];
    for (var r = 0; r < matrix.length; r++) {
      var row = matrix[r]; if (!row) continue;
      var name = '';
      var nums = [];
      for (var c = 0; c < row.length; c++) {
        var v = row[c];
        if (!name && typeof v === 'string' && txt(v) && !/^\d+([.,]\d+)?$/.test(txt(v))) name = txt(v);
        else if (num(v) !== 0 && (typeof v === 'number' || /^-?[\d\s.,]+$/.test(txt(v)))) nums.push(num(v));
      }
      if (!name || !nums.length) continue;
      if (norm(name) === 'значения' || norm(name) === 'дата') continue;
      rows.push({ name: name, value: safeRound(nums[nums.length - 1]), values: nums });
    }
    return { rows: rows };
  }

  // Свод ручной книги за выбранные даты
  function ownerTotals(rows) {
    var t = { days: {}, shifts: rows.length, cash: 0, online: 0, transfer: 0, revenue: 0, shiftSum: 0, payout: 0,
      diff: 0, writeoff: 0, buyCash: 0, buyCredit: 0, payDebt: 0, buyTotal: 0, salary: 0, rent: 0,
      utilities: 0, tax: 0, lunch: 0, fuel: 0, supplies: 0, bankFee: 0, margin: 0, profit: 0, debt: 0 };
    var lastDebt = 0, lastDate = '';
    for (var i = 0; i < rows.length; i++) {
      var r = rows[i];
      t.days[r.date] = true;
      t.cash += r.cash; t.online += r.online; t.transfer += r.transfer;
      t.revenue += r.revenue;            // колонка «Общаяя торговля» — только в дневной строке
      t.shiftSum += r.total;             // контрольная сумма по сменам (нал + онлайн + перевод)
      t.payout += r.payout; t.diff += r.diff;
      t.writeoff += r.writeoff; t.buyCash += r.buyCashOffice; t.buyCredit += r.buyCredit;
      t.payDebt += r.payDebtOffice; t.buyTotal += r.buyTotal;
      t.salary += r.salary; t.rent += r.rent; t.utilities += r.utilities; t.tax += r.tax;
      t.lunch += r.lunch; t.fuel += r.fuel; t.supplies += r.supplies; t.bankFee += r.bankFee;
      t.margin += r.margin; t.profit += r.profit;
      if (r.debt > 0 && r.date >= lastDate) { lastDebt = r.debt; lastDate = r.date; }
    }
    t.dayCount = Object.keys(t.days).length;
    delete t.days;
    for (var k in t) if (typeof t[k] === 'number') t[k] = safeRound(t[k]);
    t.debt = safeRound(lastDebt);
    t.debtDate = lastDate;
    t.expenses = safeRound(t.salary + t.rent + t.utilities + t.tax + t.lunch + t.fuel + t.supplies + t.bankFee + t.writeoff);
    if (!t.revenue) t.revenue = t.shiftSum;   // если колонку не заполняли — берём сумму смен
    t.avgDay = t.dayCount ? safeRound(t.revenue / t.dayCount) : 0;
    return t;
  }

  /* --- 6. Расчёты: продажи, склад, цены ---------------------------------- */

  function salesTotals(sales) {
    var revenue = 0, cogs = 0, qty = 0, discount = 0;
    for (var i = 0; i < sales.length; i++) {
      revenue += sales[i].revenue; cogs += sales[i].cogs;
      qty += sales[i].qty; discount += sales[i].discount;
    }
    revenue = safeRound(revenue); cogs = safeRound(cogs);
    var gross = safeRound(revenue - cogs);
    return {
      revenue: revenue, cogs: cogs, gross: gross, qty: safeRound(qty), discount: safeRound(discount),
      margin: safeRound(div(gross, revenue) * 100),   // маржинальность = ВП / выручка
      markup: safeRound(div(gross, cogs) * 100),      // наценка = ВП / себестоимость
      positions: sales.length
    };
  }

  // ABC по выручке (A — первые 80% оборота, B — до 95%, C — остальное)
  function abcClassify(sales) {
    var sorted = sales.slice().sort(function (a, b) { return b.revenue - a.revenue; });
    var total = 0, i;
    for (i = 0; i < sorted.length; i++) total += sorted[i].revenue;
    var acc = 0;
    for (i = 0; i < sorted.length; i++) {
      acc += sorted[i].revenue;
      var share = div(acc, total);
      sorted[i].abc = share <= 0.8 ? 'A' : (share <= 0.95 ? 'B' : 'C');
      sorted[i].share = safeRound(div(sorted[i].revenue, total) * 100);   // доля позиции в обороте
      sorted[i].shareCum = safeRound(share * 100);                        // накопленная доля
    }
    return sorted;
  }

  function stockTotals(stock) {
    var buySum = 0, retailSum = 0, qty = 0, zero = 0;
    for (var i = 0; i < stock.length; i++) {
      buySum += stock[i].buySum; retailSum += stock[i].retailSum; qty += stock[i].qty;
      if (stock[i].qty <= 0) zero++;
    }
    return {
      buySum: safeRound(buySum), retailSum: safeRound(retailSum),
      qty: safeRound(qty), sku: stock.length, zeroSku: zero
    };
  }

  // Индекс «товар → группа» для разреза продаж по категориям
  function groupIndex(stock, prices) {
    var idx = {};
    var i;
    for (i = 0; i < stock.length; i++) if (stock[i].group) idx[stock[i].key] = stock[i].group;
    for (i = 0; i < prices.length; i++) if (!idx[prices[i].key] && prices[i].group) idx[prices[i].key] = prices[i].group;
    return idx;
  }

  function salesByGroup(sales, idx) {
    var map = {};
    for (var i = 0; i < sales.length; i++) {
      var g = idx[sales[i].key] || 'Без группы';
      if (!map[g]) map[g] = { group: g, qty: 0, revenue: 0, cogs: 0, items: 0 };
      map[g].qty += sales[i].qty; map[g].revenue += sales[i].revenue;
      map[g].cogs += sales[i].cogs; map[g].items++;
    }
    var out = [];
    for (var k in map) {
      var m = map[k];
      m.qty = safeRound(m.qty); m.revenue = safeRound(m.revenue); m.cogs = safeRound(m.cogs);
      m.gross = safeRound(m.revenue - m.cogs);
      m.margin = safeRound(div(m.gross, m.revenue) * 100);
      out.push(m);
    }
    return out.sort(function (a, b) { return b.revenue - a.revenue; });
  }

  // Лучшая цена по каждому товару среди всех поставщиков
  function bestPriceIndex(prices) {
    var best = {};
    for (var i = 0; i < prices.length; i++) {
      var p = prices[i];
      if (!best[p.key] || p.price < best[p.key].price) best[p.key] = p;
    }
    return best;
  }

  // Матрица сравнения: по товару — все предложения, экономия к минимуму
  function priceComparison(prices, contactsIdx, limitItems) {
    var byItem = {};
    for (var i = 0; i < prices.length; i++) {
      var p = prices[i];
      if (!byItem[p.key]) byItem[p.key] = { name: p.name, key: p.key, group: p.group, barcode: p.barcode, offers: [] };
      byItem[p.key].offers.push(p);
    }
    var out = [];
    for (var k in byItem) {
      var it = byItem[k];
      it.offers.sort(function (a, b) { return a.price - b.price; });
      it.min = it.offers[0].price;
      it.max = it.offers[it.offers.length - 1].price;
      it.spread = safeRound(it.max - it.min);
      it.bestSupplier = it.offers[0].supplier;
      it.bestPhone = contactsIdx ? (contactsIdx[norm(it.offers[0].supplier)] || '') : '';
      it.suppliers = it.offers.length;
      out.push(it);
    }
    out.sort(function (a, b) { return b.spread - a.spread; });
    return limitItems ? out.slice(0, limitItems) : out;
  }

  function contactsIndex(contacts) {
    var idx = {};
    for (var i = 0; i < contacts.length; i++) if (contacts[i].phone) idx[contacts[i].key] = contacts[i].phone;
    return idx;
  }

  /* --- 7. Расчёты: касса, накладные, зарплата ---------------------------- */

  // Расчетный остаток = остаток утро + Z-отчет нал - выплаты из кассы
  function shiftCalc(s) {
    var expected = safeRound(num(s.openCash) + num(s.zCash) - num(s.payouts));
    var diff = safeRound(num(s.factCash) - expected);
    var status = diff === 0 ? 'ok' : (diff > 0 ? 'over' : 'short');
    return {
      expected: expected, diff: diff, status: status,
      statusText: diff === 0 ? 'Сдано точно' : (diff > 0 ? 'Излишек ' + fmtMoney(diff) : 'Недостача ' + fmtMoney(Math.abs(diff))),
      total: safeRound(num(s.zCash) + num(s.terminal))
    };
  }

  function shiftsTotals(shifts) {
    var t = { openCash: 0, zCash: 0, payouts: 0, expected: 0, factCash: 0, diff: 0, terminal: 0, revenue: 0, count: shifts.length, short: 0, over: 0 };
    for (var i = 0; i < shifts.length; i++) {
      var c = shiftCalc(shifts[i]);
      t.openCash += num(shifts[i].openCash); t.zCash += num(shifts[i].zCash);
      t.payouts += num(shifts[i].payouts); t.factCash += num(shifts[i].factCash);
      t.terminal += num(shifts[i].terminal);
      t.expected += c.expected; t.diff += c.diff;
      if (c.diff < 0) t.short += Math.abs(c.diff);
      if (c.diff > 0) t.over += c.diff;
    }
    t.revenue = safeRound(t.zCash + t.terminal);
    for (var k in t) t[k] = safeRound(t[k]);
    t.count = shifts.length;
    return t;
  }

  // Остаток по накладной в долг = max(0, сумма - оплачено сразу налом)
  function invoiceCalc(inv) {
    var left = Math.max(0, safeRound(num(inv.total) - num(inv.paidCash)));
    var status = num(inv.total) === 0 && num(inv.paidDebt) > 0 ? 'repay'
      : (left === 0 ? 'paid' : (num(inv.paidCash) > 0 ? 'part' : 'debt'));
    return {
      left: left, status: status,
      statusText: status === 'repay' ? 'Долг погашен'
        : status === 'paid' ? 'Оплачено 100%'
        : status === 'part' ? 'Частичный долг' : 'В долг 100%'
    };
  }

  // Общий долг магазина = сумма остатков в долг - сумма погашений старых долгов
  function invoicesTotals(invoices) {
    var t = { total: 0, paidCash: 0, paidDebt: 0, left: 0, debt: 0, count: invoices.length };
    for (var i = 0; i < invoices.length; i++) {
      t.total += num(invoices[i].total);
      t.paidCash += num(invoices[i].paidCash);
      t.paidDebt += num(invoices[i].paidDebt);
      t.left += invoiceCalc(invoices[i]).left;
    }
    t.debt = safeRound(t.left - t.paidDebt);
    for (var k in t) t[k] = safeRound(t[k]);
    t.count = invoices.length;
    return t;
  }

  function debtBySupplier(invoices) {
    var map = {};
    for (var i = 0; i < invoices.length; i++) {
      var inv = invoices[i], s = inv.supplier || '—';
      if (!map[s]) map[s] = { supplier: s, total: 0, paidCash: 0, paidDebt: 0, left: 0, docs: 0 };
      map[s].total += num(inv.total); map[s].paidCash += num(inv.paidCash);
      map[s].paidDebt += num(inv.paidDebt); map[s].left += invoiceCalc(inv).left; map[s].docs++;
    }
    var out = [];
    for (var k in map) {
      var m = map[k];
      m.debt = safeRound(m.left - m.paidDebt);
      for (var f in m) if (typeof m[f] === 'number') m[f] = safeRound(m[f]);
      m.status = m.debt <= 0 ? 'paid' : (m.paidCash > 0 || m.paidDebt > 0 ? 'part' : 'debt');
      out.push(m);
    }
    return out.sort(function (a, b) { return b.debt - a.debt; });
  }

  // Начислено за смену = часы × ставка - штрафы + премия
  function timesheetCalc(t) {
    return safeRound(num(t.hours) * num(t.rate) - num(t.penalty) + num(t.bonus));
  }

  // Сводная по зарплате: начислено по табелю - выданные авансы = остаток
  function payrollSummary(timesheet, payouts) {
    var map = {}, i, k;
    for (i = 0; i < timesheet.length; i++) {
      var t = timesheet[i], e = t.employee || '—';
      if (!map[e]) map[e] = { employee: e, position: t.position || '', shifts: 0, hours: 0, accrued: 0, paid: 0, rate: 0, penalty: 0, bonus: 0 };
      map[e].shifts++; map[e].hours += num(t.hours);
      map[e].accrued += timesheetCalc(t);
      map[e].penalty += num(t.penalty); map[e].bonus += num(t.bonus);
      map[e].rate = num(t.rate) || map[e].rate;
      if (!map[e].position && t.position) map[e].position = t.position;
    }
    for (i = 0; i < payouts.length; i++) {
      var p = payouts[i], en = p.employee || '—';
      if (!map[en]) map[en] = { employee: en, position: '', shifts: 0, hours: 0, accrued: 0, paid: 0, rate: 0, penalty: 0, bonus: 0 };
      map[en].paid += num(p.amount);
    }
    var out = [];
    for (k in map) {
      var m = map[k];
      m.hours = safeRound(m.hours); m.accrued = safeRound(m.accrued); m.paid = safeRound(m.paid);
      m.dayRate = safeRound(m.rate * 12);
      m.left = safeRound(m.accrued - m.paid);
      out.push(m);
    }
    return out.sort(function (a, b) { return b.accrued - a.accrued; });
  }

  /* --- 7б. Ручной учёт: поставки и оплаты поставщикам --------------------- */
  // Владелец записывает накладную (что привезли) и оплату (что отдал).
  // Долг поставщику = сумма поставок − сумма оплат.

  function paymentsFor(doc, payments) {
    var sum = 0;
    for (var i = 0; i < payments.length; i++) {
      if (doc && norm(payments[i].doc) === norm(doc)) sum += num(payments[i].amount);
    }
    return safeRound(sum);
  }

  function manualDocs(invoices, payments) {
    var out = [];
    for (var i = 0; i < invoices.length; i++) {
      var inv = invoices[i];
      // paidCash/paidDebt приходят из старых журналов Excel — это тоже оплаты
      var paid = safeRound(num(inv.paidCash) + num(inv.paidDebt) + paymentsFor(inv.doc, payments));
      var left = Math.max(0, safeRound(num(inv.total) - paid));
      out.push({
        id: inv.id, date: inv.date, doc: inv.doc, supplier: inv.supplier, goods: inv.goods,
        due: inv.due || '', sum: safeRound(inv.total), paid: paid, left: left,
        status: left === 0 ? 'paid' : (paid > 0 ? 'part' : 'debt'),
        statusText: left === 0 ? 'Оплачено' : (paid > 0 ? 'Частично' : 'В долг')
      });
    }
    return out.sort(function (a, b) { return (b.date || '').localeCompare(a.date || ''); });
  }

  function manualBalance(invoices, payments) {
    var map = {}, i, k;
    function slot(name) {
      var key = norm(name) || '—';
      if (!map[key]) map[key] = { supplier: name || 'Без названия', docs: 0, sum: 0, paid: 0, payCount: 0 };
      return map[key];
    }
    for (i = 0; i < invoices.length; i++) {
      var m = slot(invoices[i].supplier);
      m.docs++; m.sum += num(invoices[i].total);
      m.paid += num(invoices[i].paidCash) + num(invoices[i].paidDebt);
    }
    for (i = 0; i < payments.length; i++) {
      var p = slot(payments[i].supplier);
      p.paid += num(payments[i].amount); p.payCount++;
    }
    var out = [];
    for (k in map) {
      var v = map[k];
      v.sum = safeRound(v.sum); v.paid = safeRound(v.paid);
      v.debt = safeRound(v.sum - v.paid);
      out.push(v);
    }
    return out.sort(function (a, b) { return b.debt - a.debt; });
  }

  function manualTotals(invoices, payments) {
    var t = { supplies: 0, paid: 0, paidNow: 0, paidDebt: 0, debt: 0, docs: invoices.length, payments: payments.length };
    for (var i = 0; i < invoices.length; i++) {
      t.supplies += num(invoices[i].total);
      t.paid += num(invoices[i].paidCash) + num(invoices[i].paidDebt);
      t.paidNow += num(invoices[i].paidCash); t.paidDebt += num(invoices[i].paidDebt);
    }
    for (var j = 0; j < payments.length; j++) {
      t.paid += num(payments[j].amount);
      if (norm(payments[j].kind).indexOf('долг') >= 0) t.paidDebt += num(payments[j].amount);
      else t.paidNow += num(payments[j].amount);
    }
    for (var k in t) t[k] = safeRound(t[k]);
    t.debt = safeRound(t.supplies - t.paid);
    t.docs = invoices.length; t.payments = payments.length;
    return t;
  }

  /* --- 8. Точка безубыточности, P&L, ROP, FEFO --------------------------- */

  // BEP = постоянные расходы / маржинальность
  function bep(fixedMonth, marginPct, revenueMonth) {
    var m = num(marginPct) / 100;
    var bepMonth = m > 0 ? safeRound(num(fixedMonth) / m) : 0;
    var bepDay = safeRound(bepMonth / 30);
    var bepWeek = safeRound(bepDay * 7);
    var rev = num(revenueMonth);
    var doneP = bepMonth > 0 ? safeRound(div(rev, bepMonth) * 100) : 0;
    var safety = rev > 0 ? safeRound(div(rev - bepMonth, rev) * 100) : 0;
    var avgDay = safeRound(rev / 30);
    var bepDayOfMonth = avgDay > 0 ? Math.ceil(bepMonth / avgDay) : 0;
    return {
      fixedMonth: safeRound(fixedMonth), margin: safeRound(marginPct),
      month: bepMonth, week: bepWeek, day: bepDay,
      revenue: rev, done: doneP, safety: safety,
      dayOfMonth: bepDayOfMonth, avgDay: avgDay,
      profitable: rev >= bepMonth
    };
  }

  // P&L: выручка - COGS = ВП; ВП - OPEX = чистая прибыль
  function pnl(sales, settings, writeoffSum, payrollAccrued) {
    var st = salesTotals(sales);
    var fot = num(payrollAccrued) > 0 ? num(payrollAccrued) : num(settings.fot);
    var opex = [
      { name: 'ФОТ сотрудников магазина', value: safeRound(fot) },
      { name: 'Аренда торговой площади', value: num(settings.rent) },
      { name: 'Коммунальные услуги и свет', value: num(settings.utilities) },
      { name: 'Налоги и фиксированные расходы', value: num(settings.taxes) },
      { name: 'Прочие постоянные расходы', value: num(settings.other) },
      { name: 'Списания товаров и брак', value: safeRound(writeoffSum) }
    ];
    var opexSum = 0;
    for (var i = 0; i < opex.length; i++) opexSum += opex[i].value;
    opexSum = safeRound(opexSum);
    var net = safeRound(st.gross - opexSum);
    return {
      revenue: st.revenue, cogs: st.cogs, gross: st.gross, margin: st.margin,
      opex: opex, opexSum: opexSum, net: net,
      netMargin: safeRound(div(net, st.revenue) * 100)
    };
  }

  // Точка перезаказа: ROP = среднесуточный спрос × плечо + страховой запас
  // Розничная цена по наценке владельца, округлённая по его же правилу
  function priceFor(buy, markupPct, step) {
    var raw = num(buy) * (1 + num(markupPct) / 100);
    var st = num(step) || 1;
    if (!raw) return 0;
    return safeRound(Math.ceil(raw / st) * st);
  }

  function ropList(sales, stock, days, settings, bestPrices) {
    var stockIdx = {}, i;
    for (i = 0; i < stock.length; i++) stockIdx[stock[i].key] = stock[i];
    var lead = num(settings.leadDays) || 2;
    var safetyPct = num(settings.safetyPct) || 30;
    var cover = num(settings.coverDays) || 0;      // на сколько дней держим запас
    var d = num(days) || 30;
    var out = [];
    for (i = 0; i < sales.length; i++) {
      var s = sales[i];
      var st = stockIdx[s.key];
      var demand = safeRound(div(s.qty, d));
      if (demand <= 0) continue;
      var safety = safeRound(demand * lead * safetyPct / 100);
      var rop = safeRound(demand * lead + safety);
      var have = st ? st.qty : 0;
      if (have > rop) continue;
      // заказываем столько, чтобы хватило и на плечо поставки, и на нужное покрытие
      var order = Math.ceil(Math.max(rop + demand * lead, demand * (lead + cover)) - have);
      if (order <= 0) continue;
      var bp = bestPrices ? bestPrices[s.key] : null;
      out.push({
        name: s.name, key: s.key,
        group: st ? st.group : '',
        stock: safeRound(have), demand: demand, lead: lead, rop: rop,
        order: order,
        price: bp ? bp.price : (st ? st.buyPrice : s.buyPrice),
        supplier: bp ? bp.supplier : '',
        sum: safeRound(order * (bp ? bp.price : (st ? st.buyPrice : s.buyPrice))),
        critical: have <= 0
      });
    }
    return out.sort(function (a, b) { return b.sum - a.sum; });
  }

  // FEFO-светофор по сроку годности
  function fefoStatus(bestBefore, settings, today) {
    var crit = num(settings.fefoCrit) || 2;      // дней
    var warn = num(settings.fefoWarn) || 5;
    var d0 = today ? new Date(today) : new Date();
    var d1 = new Date(bestBefore);
    if (isNaN(d1)) return { days: null, level: 'none', discount: 0, action: 'Дата не указана' };
    var days = Math.floor((d1 - new Date(d0.toISOString().slice(0, 10))) / 86400000);
    if (days < 0) return { days: days, level: 'expired', discount: 100, action: 'Просрочено — снять с полки и списать' };
    if (days <= crit) return { days: days, level: 'crit', discount: num(settings.discountCrit) || 30, action: 'Уценка и выкладка в прикассовую зону' };
    if (days <= warn) return { days: days, level: 'warn', discount: num(settings.discountWarn) || 15, action: 'Ротация: первая линия полки' };
    return { days: days, level: 'ok', discount: 0, action: 'Обычная реализация' };
  }

  /* --- 9. Умный поиск ----------------------------------------------------- */

  function search(query, data, scope, limit) {
    var q = norm(query);
    if (!q) return [];
    var lim = limit || 200;
    var out = [], i, r;
    function add(type, name, cols) {
      out.push({ type: type, name: name, cols: cols });
    }
    if ((scope === 'all' || scope === 'sales') && data.sales) {
      for (i = 0; i < data.sales.length && out.length < lim; i++) {
        r = data.sales[i];
        if (r.key.indexOf(q) >= 0) add('Продажи 1С', r.name, [fmtNum(r.qty, 2), fmtMoney(r.revenue), fmtMoney(r.profit)]);
      }
    }
    if ((scope === 'all' || scope === 'stock') && data.stock) {
      for (i = 0; i < data.stock.length && out.length < lim; i++) {
        r = data.stock[i];
        if (r.key.indexOf(q) >= 0 || (r.barcode && r.barcode.indexOf(q) >= 0) || (r.code && r.code.indexOf(q) >= 0) || norm(r.article).indexOf(q) >= 0)
          add('Остатки склада', r.name, [r.barcode || '—', fmtNum(r.qty, 2) + ' ' + r.unit, fmtMoney(r.retailPrice)]);
      }
    }
    if ((scope === 'all' || scope === 'prices') && data.prices) {
      for (i = 0; i < data.prices.length && out.length < lim; i++) {
        r = data.prices[i];
        if (r.key.indexOf(q) >= 0 || norm(r.supplier).indexOf(q) >= 0 || (r.barcode && r.barcode.indexOf(q) >= 0))
          add('Цены поставщиков', r.name, [r.supplier, fmtMoney(r.price), r.date || '—']);
      }
    }
    if ((scope === 'all' || scope === 'contacts') && data.contacts) {
      for (i = 0; i < data.contacts.length && out.length < lim; i++) {
        r = data.contacts[i];
        if (r.key.indexOf(q) >= 0 || (r.phone && r.phone.indexOf(q.replace(/\D/g, '')) >= 0 && q.replace(/\D/g, '')))
          add('Контакты', r.name, [r.phone || '—', '', '']);
      }
    }
    return out;
  }

  return {
    safeRound: safeRound, num: num, txt: txt, norm: norm, div: div, uid: uid,
    fmtMoney: fmtMoney, fmtNum: fmtNum, fmtPct: fmtPct,
    excelDate: excelDate, isTotalRow: isTotalRow,
    detectKind: detectKind, columnTitles: columnTitles, findHeaderEnd: findHeaderEnd, findCol: findCol,
    parseSales: parseSales, parseStock: parseStock, parsePrices: parsePrices, parseContacts: parseContacts,
    parsePricelist: parsePricelist, parseBarcodes: parseBarcodes, parseUnits: parseUnits,
    parseWriteoffs: parseWriteoffs, parsePeriod: parsePeriod,
    parseWriteoffs1C: parseWriteoffs1C, parseReturns: parseReturns,
    parseIncomingInvoices: parseIncomingInvoices, parseCashOrders: parseCashOrders, docDate: docDate,
    parseDeadStock: parseDeadStock, deadStockList: deadStockList,
    parseIncomeExpense: parseIncomeExpense, incomeExpenseSummary: incomeExpenseSummary,
    matchPayments: matchPayments, supplierBalance: supplierBalance, cashSummary: cashSummary,
    byReason: byReason, topByCost: topByCost, perMonth: perMonth,
    parseOwnerDaily: parseOwnerDaily, parseOwnerPayments: parseOwnerPayments,
    parseOwnerPayroll: parseOwnerPayroll, parseOwnerMonthly: parseOwnerMonthly, ownerTotals: ownerTotals,
    parseShiftJournalSheet: parseShiftJournalSheet, parseInvoiceSheet: parseInvoiceSheet,
    parseTimesheetSheet: parseTimesheetSheet, parsePayoutSheet: parsePayoutSheet,
    salesTotals: salesTotals, abcClassify: abcClassify, stockTotals: stockTotals,
    groupIndex: groupIndex, salesByGroup: salesByGroup,
    bestPriceIndex: bestPriceIndex, priceComparison: priceComparison, contactsIndex: contactsIndex,
    shiftCalc: shiftCalc, shiftsTotals: shiftsTotals,
    invoiceCalc: invoiceCalc, invoicesTotals: invoicesTotals, debtBySupplier: debtBySupplier,
    timesheetCalc: timesheetCalc, payrollSummary: payrollSummary,
    manualDocs: manualDocs, manualBalance: manualBalance, manualTotals: manualTotals, paymentsFor: paymentsFor,
    bep: bep, pnl: pnl, ropList: ropList, priceFor: priceFor, fefoStatus: fefoStatus, search: search
  };
});

/* ============================================================================
   ЭКРАН В PDF-ФАЙЛ

   Печать через браузер у нас уже была: нажал — поехало на принтер. Но отчёт
   часто нужен ФАЙЛОМ: отправить бухгалтеру, приложить к письму, положить в
   папку за месяц. Раньше для этого приходилось печатать «в PDF» средствами
   Windows, и получалось по-разному на разных компьютерах.

   Здесь файл собирается сам, одинаково везде.

   ПОЧЕМУ СВОЙ ШРИФТ. jsPDF из коробки знает только латиницу. Проверено: в
   готовом файле слова «Ведомость» не оказывалось вовсе — не «кракозябры», а
   пустота. Поэтому рядом лежит vendor/pdf-font-ptsans.js с урезанным PT Sans.

   ПОЧЕМУ СВОЯ ВЁРСТКА ТАБЛИЦ. Готовая надстройка к jsPDF — ещё одна
   библиотека и ещё одна лицензия ради восьмидесяти строк. Своя короче и
   делает ровно то, что нужно: колонки по ширине, переносы страниц, шапка
   магазина и подпись внизу — как на бумаге.
   ========================================================================== */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.WMPdf = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  var ПОЛЕ = 14;          // отступ от края листа, мм
  var СТРОКА = 5;         // высота строки, мм
  var ШРИФТ = 'PTSans';

  function jsPDF() {
    return (window.jspdf && window.jspdf.jsPDF) || window.jsPDF || null;
  }
  function готов() { return !!jsPDF() && !!window.WMPdfFont; }

  function чисто(s) {
    // Неразрывные пробелы в PDF выглядят как пустые квадраты в части читалок
    return String(s == null ? '' : s).replace(/[  ]/g, ' ')
      .replace(/\s+/g, ' ').trim();
  }

  /* --- Что показано на экране, то и в файле ------------------------------------
     Читаем готовую страницу, а не считаем заново: иначе в PDF однажды попадёт
     не то, что владелец видел глазами, и доверять файлу станет нельзя.
     -------------------------------------------------------------------------- */
  function собрать(корень) {
    var блоки = [];
    var шапка = корень.querySelector('.page-head');
    if (шапка) {
      var t = шапка.querySelector('h1, .page-title');
      var s = шапка.querySelector('.page-sub, .page-head-sub');
      блоки.push({ вид: 'титул', текст: чисто(t ? t.textContent : ''),
        под: чисто(s ? s.textContent : '') });
    }
    var плитки = корень.querySelectorAll('.stat-grid .stat');
    if (плитки.length) {
      блоки.push({ вид: 'плитки', items: Array.prototype.map.call(плитки, function (e) {
        var зн = e.querySelector('.stat-val, .stat-value, b');
        var им = e.querySelector('.stat-label, .stat-name, span');
        var под = e.querySelector('.stat-sub, small');
        return { имя: чисто(им ? им.textContent : ''), знач: чисто(зн ? зн.textContent : ''),
          под: чисто(под ? под.textContent : '') };
      }) });
    }
    Array.prototype.forEach.call(корень.querySelectorAll('.card'), function (c) {
      if (c.classList.contains('print-hide')) return;
      var зг = c.querySelector('.card-title');
      var таб = c.querySelector('table.data');
      if (таб) {
        var шапки = Array.prototype.map.call(таб.querySelectorAll('thead th'),
          function (th) { return чисто(th.textContent); });
        var строки = [];
        Array.prototype.forEach.call(таб.querySelectorAll('tbody tr'), function (tr) {
          if (tr.classList.contains('plain')) return;
          строки.push(Array.prototype.map.call(tr.querySelectorAll('td'),
            function (td) { return чисто(td.textContent); }));
        });
        if (строки.length) {
          блоки.push({ вид: 'таблица', заголовок: чисто(зг ? зг.textContent : ''),
            шапки: шапки, строки: строки });
        }
        return;
      }
      var рядов = c.querySelectorAll('.list-row');
      if (рядов.length) {
        блоки.push({ вид: 'список', заголовок: чисто(зг ? зг.textContent : ''),
          строки: Array.prototype.map.call(рядов, function (r) {
            var t2 = r.querySelector('.list-title, .lr-title, b');
            var s2 = r.querySelector('.list-sub, .lr-sub, small');
            var v2 = r.querySelector('.list-val, .lr-val, .num');
            return { имя: чисто(t2 ? t2.textContent : r.textContent).slice(0, 90),
              под: чисто(s2 ? s2.textContent : '').slice(0, 120),
              знач: чисто(v2 ? v2.textContent : '') };
          }) });
      }
    });
    return блоки;
  }

  /* --- Рисуем ------------------------------------------------------------------ */
  function build(корень, настройки) {
    var J = jsPDF();
    if (!J) return null;
    var doc = new J({ unit: 'mm', format: 'a4' });
    window.WMPdfFont.install(doc);

    var W = doc.internal.pageSize.getWidth();
    var H = doc.internal.pageSize.getHeight();
    var шир = W - ПОЛЕ * 2;
    var y = ПОЛЕ;
    var s = настройки || {};
    var страниц = 1;

    function низ() {
      doc.setFont(ШРИФТ, 'normal'); doc.setFontSize(8);
      doc.setTextColor(130);
      var д = new Date();
      var дата = ('0' + д.getDate()).slice(-2) + '.' + ('0' + (д.getMonth() + 1)).slice(-2) +
        '.' + д.getFullYear() + ', ' + ('0' + д.getHours()).slice(-2) + ':' +
        ('0' + д.getMinutes()).slice(-2);
      doc.text('Составлено ' + дата, ПОЛЕ, H - 8);
      doc.text('Стр. ' + страниц, W - ПОЛЕ, H - 8, { align: 'right' });
      doc.setTextColor(0);
    }
    function лист() {
      низ(); doc.addPage(); страниц++; y = ПОЛЕ;
    }
    function место(h) { if (y + h > H - 16) лист(); }

    // Шапка магазина — как на бумаге
    var орг = чисто(s.storeName);
    var подпись = [s.legalName, s.inn ? 'ИНН ' + s.inn : '', s.address, s.phone]
      .map(чисто).filter(Boolean).join(' · ');
    if (орг || подпись) {
      doc.setFont(ШРИФТ, 'bold'); doc.setFontSize(11);
      if (орг) { doc.text(орг, ПОЛЕ, y); y += СТРОКА; }
      if (подпись) {
        doc.setFont(ШРИФТ, 'normal'); doc.setFontSize(8); doc.setTextColor(120);
        doc.text(подпись, ПОЛЕ, y); doc.setTextColor(0); y += СТРОКА;
      }
      doc.setDrawColor(200); doc.line(ПОЛЕ, y, W - ПОЛЕ, y); y += 6;
    }

    собрать(корень).forEach(function (b) {
      if (b.вид === 'титул') {
        место(16);
        doc.setFont(ШРИФТ, 'bold'); doc.setFontSize(17);
        doc.text(b.текст, ПОЛЕ, y); y += 7;
        if (b.под) {
          doc.setFont(ШРИФТ, 'normal'); doc.setFontSize(9); doc.setTextColor(110);
          doc.splitTextToSize(b.под, шир).forEach(function (l) { doc.text(l, ПОЛЕ, y); y += 4.4; });
          doc.setTextColor(0);
        }
        y += 4;
        return;
      }
      if (b.вид === 'плитки') {
        var вРяд = 3, ш = шир / вРяд;
        b.items.forEach(function (it, i) {
          if (i % вРяд === 0) { место(16); }
          var x = ПОЛЕ + (i % вРяд) * ш;
          var yy = y;
          doc.setFont(ШРИФТ, 'normal'); doc.setFontSize(8); doc.setTextColor(120);
          doc.text(doc.splitTextToSize(it.имя, ш - 3)[0] || '', x, yy);
          doc.setFont(ШРИФТ, 'bold'); doc.setFontSize(13); doc.setTextColor(0);
          doc.text(doc.splitTextToSize(it.знач, ш - 3)[0] || '', x, yy + 5.5);
          if (it.под) {
            doc.setFont(ШРИФТ, 'normal'); doc.setFontSize(7); doc.setTextColor(140);
            doc.text(doc.splitTextToSize(it.под, ш - 3)[0] || '', x, yy + 9.5);
            doc.setTextColor(0);
          }
          if (i % вРяд === вРяд - 1 || i === b.items.length - 1) y += 14;
        });
        y += 3;
        return;
      }
      if (b.заголовок) {
        место(10);
        doc.setFont(ШРИФТ, 'bold'); doc.setFontSize(12);
        doc.text(b.заголовок, ПОЛЕ, y); y += 6;
      }
      if (b.вид === 'список') {
        b.строки.forEach(function (r) {
          место(9);
          doc.setFont(ШРИФТ, 'normal'); doc.setFontSize(10);
          doc.text(doc.splitTextToSize(r.имя, шир - 35)[0] || '', ПОЛЕ, y);
          if (r.знач) doc.text(r.знач, W - ПОЛЕ, y, { align: 'right' });
          y += 4.6;
          if (r.под) {
            doc.setFontSize(8); doc.setTextColor(125);
            doc.splitTextToSize(r.под, шир).slice(0, 2).forEach(function (l) {
              doc.text(l, ПОЛЕ, y); y += 3.8;
            });
            doc.setTextColor(0);
          }
          y += 1.6;
        });
        y += 4;
        return;
      }
      if (b.вид === 'таблица') {
        var n = b.шапки.length || (b.строки[0] || []).length;
        if (!n) return;
        /* Ширина колонок — по самому длинному, что в них лежит. Делить лист
           поровну нельзя: колонка «Товар» обрежется, а «Класс» будет пустой
           на треть страницы. */
        var веса = [];
        for (var i = 0; i < n; i++) {
          var данные = 0;
          b.строки.forEach(function (r) { данные = Math.max(данные, (r[i] || '').length); });
          /* Заголовок считаем вполовину: он переносится на две строки, а
             данные — нет. Считать его целиком значило бы отдать треть листа
             под колонку «Смен с расхождением» с числом «1» внутри.
             Но и совсем не считать нельзя — иначе «Смен» обрежется до «Сме».  */
          var шапкаДл = Math.ceil((b.шапки[i] || '').length / 2);
          /* Колонка обязана вместить самое длинное СЛОВО заголовка целиком.
             Иначе «Недостачи» переносится как «Недостач / и» — читается как
             опечатка, и владелец справедливо не верит такому документу. */
          var слово = 0;
          (b.шапки[i] || '').split(/\s+/).forEach(function (w) {
            слово = Math.max(слово, w.length);
          });
          веса.push(Math.max(5, Math.min(40, Math.max(данные, шапкаДл, слово))));
        }
        var сумма = веса.reduce(function (a, x) { return a + x; }, 0);
        var ширК = веса.map(function (w) { return шир * w / сумма; });
        // Числа прижимаем вправо: так столбик читается сверху вниз
        var число = [];
        for (var k = 0; k < n; k++) {
          var цифр = 0, всего = 0;
          b.строки.forEach(function (r) {
            var v = r[k] || ''; if (!v) return;
            всего++; if (/^[−\-+]?[\d\s.,%₽]+$/.test(v)) цифр++;
          });
          число.push(всего > 0 && цифр / всего > 0.7);
        }
        /* Заголовок переносится на две строки: длинные названия колонок
           иначе обрезались посередине слова, и владелец гадал, что это. */
        function шапкаТаб() {
          doc.setFont(ШРИФТ, 'bold'); doc.setFontSize(8.5); doc.setTextColor(110);
          var x = ПОЛЕ, строк = 1;
          b.шапки.forEach(function (t, i) {
            var линии = doc.splitTextToSize(t || '', ширК[i] - 2).slice(0, 2);
            строк = Math.max(строк, линии.length);
            линии.forEach(function (l, j) {
              doc.text(l, число[i] ? x + ширК[i] - 2 : x, y + j * 3.4,
                число[i] ? { align: 'right' } : undefined);
            });
            x += ширК[i];
          });
          doc.setTextColor(0); y += 3.4 * строк + 1.4;
          doc.setDrawColor(215); doc.line(ПОЛЕ, y - 1.6, W - ПОЛЕ, y - 1.6);
        }
        // Место под шапку считаем по самой длинной из них, а не «на глаз»
        место(18);
        шапкаТаб();
        b.строки.forEach(function (r) {
          if (y + 6 > H - 16) { лист(); шапкаТаб(); }
          doc.setFont(ШРИФТ, 'normal'); doc.setFontSize(9);
          var x2 = ПОЛЕ, высота = 4.6;
          r.forEach(function (v, i) {
            var линии = doc.splitTextToSize(v || '', ширК[i] - 2).slice(0, 2);
            линии.forEach(function (l, j) {
              doc.text(l, число[i] ? x2 + ширК[i] - 2 : x2, y + j * 3.8,
                число[i] ? { align: 'right' } : undefined);
            });
            высота = Math.max(высота, линии.length * 3.8 + 1.2);
            x2 += ширК[i];
          });
          y += высота;
        });
        y += 5;
      }
    });
    низ();
    return doc;
  }

  function имяФайла(корень, настройки) {
    var t = корень.querySelector('.page-head h1, .page-head .page-title');
    var имя = чисто(t ? t.textContent : 'Отчёт').replace(/[\\/:*?"<>|]/g, '');
    var д = new Date().toISOString().slice(0, 10);
    var магазин = чисто((настройки || {}).storeName);
    return (магазин ? магазин + ' — ' : '') + имя + ' ' + д + '.pdf';
  }

  function save(корень, настройки) {
    if (!готов()) return 'Не получилось собрать PDF: не загрузилась библиотека.';
    var doc = build(корень, настройки);
    if (!doc) return 'Не получилось собрать PDF.';
    doc.save(имяФайла(корень, настройки));
    return '';
  }

  return { ready: готов, build: build, save: save, collect: собрать, fileName: имяФайла };
});

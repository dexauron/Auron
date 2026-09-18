// Сборка полного учёта в ОДНУ страницу для Apps Script.
//
// ЗАЧЕМ. Apps Script умеет отдавать страницу, но не папку: ссылок на
// соседние файлы там нет. А программа «Учёт магазина» — это 30 файлов.
// Поэтому собираем их в один файл: разметка, стили и весь код внутри.
//
// Запуск:  node webapp/build-uchet.js
// Итог:    webapp/Uchet.html  (его заливает clasp вместе с остальным)
//
// ПОЧЕМУ НЕ ШАБЛОН APPS SCRIPT. Шаблоны разбирают `<? ... ?>` внутри файла,
// а в коде программы такие сочетания встречаются в регулярных выражениях.
// Страница отдаётся как есть — `createHtmlOutputFromFile`, без разбора.
const fs = require('fs'), path = require('path');
const ROOT = path.join(__dirname, '..');
const SRC = path.join(ROOT, 'desktop');
const OUT = path.join(__dirname, 'Uchet.html');

const html = fs.readFileSync(path.join(SRC, 'Учёт_магазина.html'), 'utf8');

function читать(rel) {
  const f = path.join(SRC, rel);
  if (!fs.existsSync(f)) throw new Error('нет файла: ' + rel);
  return fs.readFileSync(f, 'utf8');
}

// Внутри <script> нельзя оставлять последовательность </script> — браузер
// закроет тег раньше времени. В коде она встречается в строках разметки.
function безопасно(js) {
  return js.replace(/<\/script>/gi, '<\\/script>');
}

let out = html;
let файлов = 0, байт = 0;

/* Признак «мы внутри Auron Finance на сервере». По нему программа берёт
   данные владельца из его Google-таблицы, а не из памяти браузера: внутри
   Apps Script страница живёт на временном адресе, и память браузера там
   может обнулиться между обновлениями — записи пропали бы молча.

   Ставим ДО вклейки кода и в ГОЛОВУ страницы, а не в конец. Две причины,
   обе стоили ошибок:
   1) `js/server-store.js` читает эти два значения раньше, чем `store.js`
      прочитает базу. Стояло бы в конце — он увидел бы пустоту и не стал
      бы подкладывать данные владельца: программа открылась бы пустой;
   2) после вклейки `</body>` встречается ещё и ВНУТРИ чужой библиотеки
      (xlsx собирает из строк целую html-страницу), и вставка уезжала
      туда, ломая библиотеку: экраны работали, а чтение Excel отваливалось. */
if ((out.match(/<\/head>/g) || []).length !== 1) {
  throw new Error('в исходной странице должен быть ровно один </head>');
}
/* Метку `AURON_BOOT` при выдаче страницы подменяет сервер: на её место
   встают данные владельца. Пока страница лежит файлом, там ноль — и
   программа работает как обычная папка. */
out = out.replace('</head>',
  '<script>\n' +
  'window.AURON_SERVER = !!(typeof google !== "undefined" && google.script && google.script.run);\n' +
  'window.AURON_BOOT = /*AURON_BOOT*/null/*/AURON_BOOT*/;\n' +
  '</script>\n</head>');

// Стили
out = out.replace(/<link rel="stylesheet" href="([^"]+)">/g, function (_, f) {
  const css = читать(f); файлов++; байт += css.length;
  return '<style>\n' + css + '\n</style>';
});

// Код: и чужие библиотеки, и наш — в том же порядке, что в папке.
out = out.replace(/<script src="([^"]+)"><\/script>/g, function (_, f) {
  const js = читать(f); файлов++; байт += js.length;
  return '<script>\n/* ' + f + ' */\n' + безопасно(js) + '\n</script>';
});

if (/<script src=|<link rel="stylesheet"/.test(out)) {
  throw new Error('остались ссылки на соседние файлы — страница не будет работать');
}

/* Проверяем СОБРАННОЕ, а не намерение. Один испорченный кусок ломает
   молча: экраны открываются, а чтение Excel отваливается. */
var сбои = [];
out.replace(/<script>\n\/\* ([^*]+) \*\/\n([\s\S]*?)\n<\/script>/g, function (_, имя, код) {
  try { new Function(код); } catch (e) { сбои.push(имя + ': ' + e.message); }
  return '';
});
if (сбои.length) throw new Error('вклеенный код не разбирается —\n  ' + сбои.join('\n  '));

/* Метка должна остаться ровно одна: по ней сервер вставляет данные. Ноль
   меток — страница откроется пустой у всех; две — данные встанут не туда. */
var меток = (out.match(/\/\*AURON_BOOT\*\/null\/\*\/AURON_BOOT\*\//g) || []).length;
if (меток !== 1) throw new Error('метка данных должна быть одна, найдено: ' + меток);

fs.writeFileSync(OUT, out);
console.log('собрано: webapp/Uchet.html');
console.log('вложено файлов: ' + файлов + ', из них кода и стилей ' + Math.round(байт / 1024) + ' КБ');
console.log('размер страницы: ' + Math.round(out.length / 1024) + ' КБ');

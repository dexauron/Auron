/* Что уедет в Apps Script.
 *
 * clasp заливает из папки webapp/ всё, что похоже на код: .gs, .js, .html,
 * .json. Node-скрипты туда попадать НЕ должны: у них сверху require('fs'),
 * Apps Script падает при загрузке проекта — и вместе со скриптом перестают
 * работать ВСЕ функции приложения, а не только он. Владелец при этом видит
 * не «сломался один файл», а мёртвое приложение.
 *
 * Поэтому здесь проверяется список: каждый .js в webapp/ либо исключён в
 * .claspignore, либо это осознанно заливаемый файл.
 */
const fs = require('fs');
const path = require('path');
const WEBAPP = path.join(__dirname, '..');

let passed = 0, failed = 0;
function check(name, ok, got, want) {
  if (ok) { passed++; console.log('  ✅ ' + name + (got !== undefined ? '  → ' + got : '')); }
  else { failed++; console.log('  ❌ ' + name + '  получено: ' + got + ', ожидалось: ' + want); }
}

const ignore = fs.readFileSync(path.join(WEBAPP, '.claspignore'), 'utf8')
  .split('\n').map(s => s.trim()).filter(s => s && s[0] !== '#');

// Файлы в корне webapp/ — именно их берёт clasp (подпапки отдельной строкой).
const корень = fs.readdirSync(WEBAPP).filter(f => fs.statSync(path.join(WEBAPP, f)).isFile());

function исключён(f) {
  return ignore.some(p => p === f || (p.endsWith('/**') && f.startsWith(p.slice(0, -3) + '/'))
    || (p.startsWith('**/*') && f.endsWith(p.slice(4))));
}

console.log('\n— В Apps Script уезжает только то, что там работает');

const заливаемые = корень.filter(f => /\.(gs|js|html|json)$/.test(f) && !исключён(f));
const ожидаем = ['Code.gs', 'Index.html', 'Uchet.html', 'appsscript.json'];

check('список заливаемых файлов известен',
  заливаемые.slice().sort().join(', ') === ожидаем.slice().sort().join(', '),
  заливаемые.slice().sort().join(', '), ожидаем.slice().sort().join(', '));

check('СБОРЩИК СТРАНИЦЫ НЕ УЕЗЖАЕТ (он ронял бы весь проект)',
  исключён('build-uchet.js'), 'исключён', 'исключён');
check('проверки не уезжают', ignore.indexOf('tests/**') >= 0, 'исключены', 'исключены');

// Каждый заливаемый .js обязан разбираться без Node-овских require.
заливаемые.filter(f => /\.(js|gs)$/.test(f)).forEach(f => {
  const код = fs.readFileSync(path.join(WEBAPP, f), 'utf8');
  check(f + ' — без require(), иначе Apps Script не загрузит проект',
    !/\brequire\s*\(/.test(код), /\brequire\s*\(/.test(код) ? 'есть require' : 'чисто', 'чисто');
});

console.log('\n— Страница полного учёта готова к заливке');
const uchet = path.join(WEBAPP, 'Uchet.html');
check('файл собран', fs.existsSync(uchet), 'есть', 'есть');
if (fs.existsSync(uchet)) {
  const размер = fs.statSync(uchet).size;
  check('размер разумный (не пустышка и не бесконечность)',
    размер > 1e6 && размер < 9e6, Math.round(размер / 1024) + ' КБ', 'от 1 до 9 МБ');
  const текст = fs.readFileSync(uchet, 'utf8');
  check('внутри нет ссылок на соседние файлы — Apps Script их не отдаст',
    !/<script src=|<link rel="stylesheet"/.test(текст), 'нет', 'нет');
}

console.log('\nИтог: ' + passed + ' проверок пройдено, ' + failed + ' провалено.');
process.exit(failed ? 1 : 0);

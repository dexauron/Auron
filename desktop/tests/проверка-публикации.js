/* ============================================================================
   Проверка публикации полного учёта на сайт.
   Запуск:  node tests/проверка-публикации.js   (из папки desktop)

   Сайт собирается из трёх веток и публикуется с force_orphan — то есть
   ЗАМЕНЯЕТ содержимое целиком. Ошибка в сборке не ломает ничего локально:
   она видна только на сайте, когда у людей уже 404. Так однажды пропал
   каталог.

   Поэтому здесь проверяется не поведение программы, а файл сборки и
   ссылки на неё: что полный учёт вообще попадает на сайт, что вместе с
   ним НЕ уезжают выгрузки 1С владельца, и что порядок шагов не съел сам
   себя — исходники удаляются после копирования, а не до.
   ========================================================================== */
const fs = require('fs');
const path = require('path');
const КОРЕНЬ = path.join(__dirname, '..', '..');

let passed = 0, failed = 0;
function check(name, ok, got, want) {
  if (ok) { passed++; console.log('  ✅ ' + name + (got !== undefined ? '  → ' + got : '')); }
  else { failed++; console.log('  ❌ ' + name + '  получено: ' + got + ', ожидалось: ' + want); }
}
function читать(p) {
  try { return fs.readFileSync(path.join(КОРЕНЬ, p), 'utf8'); } catch (e) { return ''; }
}

const СТРАНИЦА = 'desktop/Учёт_магазина.html';
const НА_САЙТЕ = 'https://dexauron.github.io/Auron/desktop/Учёт_магазина.html';

console.log('\n— Сборка сайта кладёт полный учёт рядом с приложением');

const deploy = читать('.github/workflows/deploy.yml');
check('файл сборки на месте', !!deploy, deploy.length + ' символов', '> 0');
check('есть шаг «Добавить полный учёт»', deploy.indexOf('Добавить полный учёт') >= 0,
  deploy.indexOf('Добавить полный учёт') >= 0 ? 'есть' : 'нет', 'есть');
check('копирует папку целиком, а не один файл',
  /cp -r scan-src\/desktop\/\. app\/desktop\//.test(deploy), 'копирует', 'копирует');
check('ПРОВЕРЯЕТ, ЧТО ИСХОДНИКИ ВООБЩЕ ЕСТЬ (ветка могла не выкачаться)',
  /if \[ -f "scan-src\/desktop\/Учёт_магазина\.html" \]/.test(deploy), 'проверяет', 'проверяет');

console.log('\n— Чужого на сайт не уезжает');

check('ВЫГРУЗКИ 1С ВЛАДЕЛЬЦА УДАЛЯЮТСЯ ПЕРЕД ПУБЛИКАЦИЕЙ',
  /rm -rf "app\/desktop\/Данные_1С_и_Excel"/.test(deploy), 'удаляются', 'удаляются');
check('проверки на сайт не публикуются', /rm -rf app\/desktop\/tests/.test(deploy),
  'не публикуются', 'не публикуются');

console.log('\n— Порядок шагов: исходники стираются ПОСЛЕ копирования');

/* Самая дорогая ошибка в этом файле — удалить scan-src раньше, чем из него
   скопировали. Локально это никак не видно: падает только на сборке, и то
   тихо, предупреждением. */
const копия = deploy.indexOf('cp -r scan-src/desktop/.');
const стирание = deploy.indexOf('rm -rf scan-src');
check('копирование раньше удаления', копия > 0 && стирание > копия,
  'копия на ' + копия + ', удаление на ' + стирание, 'удаление позже');
check('scan-src стирается ровно один раз',
  (deploy.match(/rm -rf scan-src/g) || []).length === 1,
  (deploy.match(/rm -rf scan-src/g) || []).length, 1);

console.log('\n— Ссылки ведут туда, куда кладём');

const webapp = читать('webapp/Index.html');
check('в приложении записан адрес на сайте', webapp.indexOf(НА_САЙТЕ) >= 0,
  webapp.indexOf(НА_САЙТЕ) >= 0 ? 'записан' : 'нет', 'записан');
check('и локальный адрес — та же страница',
  webapp.indexOf("DEEP_URL:'" + СТРАНИЦА + "'") >= 0, 'совпадает', 'совпадает');

const site = читать('app/index.html');
check('в приложении на сайте есть кнопка полного учёта',
  site.indexOf('si-desktop') >= 0, 'есть', 'есть');
check('она ведёт в соседнюю папку сайта',
  site.indexOf("window.open('" + СТРАНИЦА + "'") >= 0, 'ведёт', 'ведёт');

console.log('\n— То, что публикуем, существует');

check('страница полного учёта на месте',
  fs.existsSync(path.join(КОРЕНЬ, СТРАНИЦА)), 'на месте', 'на месте');
['js/ui.js', 'js/engine.js', 'js/auron-bridge.js', 'styles.css', 'vendor/xlsx.full.min.js']
  .forEach(function (f) {
    check('без ' + f + ' программа не работает — файл есть',
      fs.existsSync(path.join(КОРЕНЬ, 'desktop', f)), 'есть', 'есть');
  });

console.log('\nИтог: ' + passed + ' проверок пройдено, ' + failed + ' провалено.');
process.exit(failed ? 1 : 0);

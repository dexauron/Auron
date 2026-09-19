/* ============================================================================
   Проверка настроек и связности кода. Запуск:  node tests/проверка-настроек.js

   Эта проверка появилась после аудита, который нашёл два вида поломок,
   не видных ни в расчётах, ни на экранах:

   1. Программа читала настройку, которой нет в базе. Работало это тихо:
      вместо числа подставлялось зашитое в код значение, а владелец даже
      не знал, что такая настройка существует и что её можно поменять.
      Так тринадцать чисел — срок поставки, страховой запас, сроки
      годности, размер уценки — оказались недоступны магазину, хотя
      программа обязана настраиваться под каждый магазин.

   2. Кнопка вызывала функцию, которой в программе нет. Экранные проверки
      этого не ловят: до такой кнопки нужен настоящий доступ к папке.

   Поэтому здесь проверяется не арифметика, а сам код: что каждая
   настройка объявлена, что её можно изменить, и что у каждой кнопки есть
   и обработчик, и все функции, которые он зовёт.
   ========================================================================== */
const path = require('path');
const fs = require('fs');
const КОРЕНЬ = path.join(__dirname, '..');
const STORE = require(path.join(КОРЕНЬ, 'js', 'store.js'));
const SET = require(path.join(КОРЕНЬ, 'js', 'settings.js'));

let passed = 0, failed = 0;
function check(name, ok, got, want) {
  if (ok) { passed++; console.log('  ✅ ' + name + (got !== undefined ? '  → ' + got : '')); }
  else { failed++; console.log('  ❌ ' + name + '  получено: ' + got + ', ожидалось: ' + want); }
}

function файлы() {
  return fs.readdirSync(path.join(КОРЕНЬ, 'js')).filter(function (f) { return /\.js$/.test(f); });
}
function текст(f) { return fs.readFileSync(path.join(КОРЕНЬ, 'js', f), 'utf8'); }
// комментарии выкидываем: в них полно примеров, которые кодом не являются
function безКомментариев(t) {
  return t.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:'"\\])\/\/.*$/gm, '$1');
}

const ОБЪЯВЛЕНЫ = Object.keys(STORE.DEFAULT_SETTINGS);
const ПОЛЯ = SET.all().map(function (it) { return it.key; });

/* Настройки, которые программа заводит себе сама во время работы: какой
   месяц открыт в отчёте, какие пункты меню свёрнуты, какой период выбран
   на товарных экранах. Это не настройки магазина, поля им не нужны, и в
   базе по умолчанию их быть не должно. */
const СЛУЖЕБНЫЕ = ['anaFrom', 'anaTo', 'reportMonth', 'payrollMonth', 'payslipMode',
  'payslipFrom', 'payslipTo', 'menuFav', 'menuHidden', 'menuOpen', 'closedTo',
  'ownerMode', 'ownerDay', 'debtChecked', 'noticeSeen'];

console.log('\n— Каждая настройка, которую читает программа, существует в базе');
{
  const читают = {};
  файлы().forEach(function (f) {
    const t = безКомментариев(текст(f));
    let m;
    const re1 = /settings\s*\.\s*([a-zA-Z_]\w*)/g;
    while ((m = re1.exec(t))) (читают[m[1]] = читают[m[1]] || []).push(f);
    const re2 = /settings\s*\[\s*'([^']+)'\s*\]/g;
    while ((m = re2.exec(t))) (читают[m[1]] = читают[m[1]] || []).push(f);
  });
  // методы объекта настройками не являются
  const МЕТОДЫ = ['hasOwnProperty', 'toString', 'valueOf', 'constructor'];
  const чужие = Object.keys(читают).filter(function (k) {
    return ОБЪЯВЛЕНЫ.indexOf(k) < 0 && СЛУЖЕБНЫЕ.indexOf(k) < 0 && МЕТОДЫ.indexOf(k) < 0;
  });
  check('нет настроек, которых нет в базе', чужие.length === 0,
    чужие.length ? чужие.join(', ') : 'все на месте', 'ни одной');
}

console.log('\n— Каждую настройку магазина владелец может изменить');
{
  const без = ОБЪЯВЛЕНЫ.filter(function (k) {
    return ПОЛЯ.indexOf(k) < 0 && СЛУЖЕБНЫЕ.indexOf(k) < 0;
  });
  check('у каждой настройки есть поле на экране «Настройки»', без.length === 0,
    без.length ? без.join(', ') : 'все настраиваются', 'ни одной без поля');
}

/* ОБРАТНАЯ СТОРОНА ТОЙ ЖЕ ОШИБКИ. Проверка выше ловит настройку, которую
   программа читает, а в базе её нет. Бывает наоборот: настройка есть, у неё
   есть поле, владелец её меняет — а не читает её никто. Он переключает и
   уверен, что программа теперь считает иначе. Это хуже, чем отсутствие
   настройки: отсутствие видно, а обман — нет. */
console.log('\n— Каждая настройка на что-то влияет');
{
  /* Читателем считается любое упоминание имени настройки в коде, КРОМЕ двух
     мест, где её только объявляют: списка значений по умолчанию в store.js и
     списка полей в settings.js. Имя настройки — слово редкое, случайно в
     коде оно не встречается, так что искать по имени тут надёжнее, чем
     разбирать `settings.что-то`: половина программы получает настройки под
     своими короткими именами (наст, s, st), и по ним не поймёшь. */
  const умолчания = текст('store.js');
  const началоУ = умолчания.indexOf('var DEFAULT_SETTINGS = {');
  const конецУ = умолчания.indexOf('\n  };', началоУ);
  const кодБезОбъявлений = файлы().filter(function (f) { return f !== 'settings.js'; })
    .map(function (f) {
      const t = безКомментариев(текст(f));
      if (f !== 'store.js') return t;
      return t.slice(0, началоУ) + t.slice(конецУ);   // объявление — не чтение
    }).join('\n');

  const мёртвые = ПОЛЯ.filter(function (k) {
    return !new RegExp('\\b' + k + '\\b').test(кодБезОбъявлений);
  });
  check('НЕТ ПОЛЯ, КОТОРОЕ НИЧЕГО НЕ МЕНЯЕТ', мёртвые.length === 0,
    мёртвые.join(', ') || 'все ' + ПОЛЯ.length + ' работают',
    'ни одного мёртвого');
}

console.log('\n— Поля настроек не врут');
{
  const лишние = ПОЛЯ.filter(function (k) { return ОБЪЯВЛЕНЫ.indexOf(k) < 0; });
  check('нет поля без значения по умолчанию', лишние.length === 0,
    лишние.length ? лишние.join(', ') : 'у всех есть', 'ни одного');

  const дубли = ПОЛЯ.filter(function (k, i) { return ПОЛЯ.indexOf(k) !== i; });
  check('одна настройка — одно поле', дубли.length === 0,
    дубли.length ? дубли.join(', ') : 'дублей нет', 'ни одного');

  const ТИПЫ = ['text', 'number', 'money', 'percent', 'days', 'time', 'select', 'list', 'yesno'];
  const плохие = SET.all().filter(function (it) { return ТИПЫ.indexOf(it.type) < 0; });
  check('тип каждого поля известен программе', плохие.length === 0,
    плохие.length ? плохие.map(function (x) { return x.key + ':' + x.type; }).join(', ') : 'все известны',
    'ни одного чужого типа');

  const безВариантов = SET.all().filter(function (it) {
    return it.type === 'select' && (!it.options || !it.options.length);
  });
  check('у списка выбора есть из чего выбрать', безВариантов.length === 0,
    безВариантов.length ? безВариантов.map(function (x) { return x.key; }).join(', ') : 'у всех есть',
    'ни одного пустого');

  const пустое = SET.all().filter(function (it) { return !it.label || !String(it.label).trim(); });
  check('у каждого поля есть название по-человечески', пустое.length === 0,
    пустое.length ? пустое.map(function (x) { return x.key; }).join(', ') : 'все подписаны', 'все подписаны');
}

console.log('\n— Значение по умолчанию подходит своему полю');
{
  const плохие = [];
  SET.all().forEach(function (it) {
    const v = STORE.DEFAULT_SETTINGS[it.key];
    if (v === undefined) return;                       // это ловит проверка выше
    if (it.type === 'yesno' && ['да', 'нет'].indexOf(String(v)) < 0) плохие.push(it.key + '=' + v);
    if (it.type === 'select' && it.options && String(v) !== '' && it.options.indexOf(v) < 0) плохие.push(it.key + '=' + v);
    if ((it.type === 'number' || it.type === 'money' || it.type === 'percent') &&
        v !== '' && typeof v !== 'number') плохие.push(it.key + '=' + JSON.stringify(v));
  });
  check('ни одного значения не того вида', плохие.length === 0,
    плохие.length ? плохие.join(', ') : 'все подходят', 'все подходят');
}

console.log('\n— У каждой кнопки есть обработчик');
{
  const действия = {}, обработчики = {};
  const html = fs.readFileSync(path.join(КОРЕНЬ, 'Учёт_магазина.html'), 'utf8');
  let m;
  const reHtml = /data-act="([^"]+)"/g;
  while ((m = reHtml.exec(html))) действия[m[1]] = 'Учёт_магазина.html';
  файлы().forEach(function (f) {
    const t = безКомментариев(текст(f));
    let x;
    /* Имя действия — это всегда простое слово через дефис. Всё остальное
       («' + esc(x.act) + '») — кусок шаблона, который собирается на лету;
       такие имена не проверить, и в список они не идут. */
    const re = /data-act=(?:"|\\"|')([a-z][a-z0-9-]*)(?:"|\\"|')/g;
    while ((x = re.exec(t))) действия[x[1]] = f;
    const reH1 = /\bA\s*\[\s*'([^']+)'\s*\]\s*=/g;
    while ((x = reH1.exec(t))) обработчики[x[1]] = f;
    const reH2 = /\ba\s*===\s*'([^']+)'/g;
    while ((x = reH2.exec(t))) обработчики[x[1]] = f;
  });
  const сироты = Object.keys(действия).filter(function (k) { return !обработчики[k]; });
  check('нет кнопки, которая ничего не делает', сироты.length === 0,
    сироты.length ? сироты.join(', ') : 'все кнопки живые',
    'ни одной сироты');
  check('кнопок проверено', Object.keys(действия).length > 60, Object.keys(действия).length, 'больше 60');
}

console.log('\n— Никто не зовёт функцию, которой нет');
{
  /* Тот самый случай, ради которого и появилась эта проверка:
     connectFolder() вызывался из обработчика кнопки, а написан не был.
     Разобрать это вручную нельзя — нужен настоящий разбор кода, поэтому
     зовём ESLint с правилом no-undef (настройки в eslint.config.mjs).
     Если ESLint не установлен, проверка честно говорит, что пропущена:
     соврать «всё хорошо» здесь хуже, чем признаться. */
  const { spawnSync } = require('child_process');
  let бин = null;
  ['eslint', path.join(КОРЕНЬ, 'node_modules', '.bin', 'eslint')].forEach(function (к) {
    if (бин) return;
    const r = spawnSync(к, ['--version'], { encoding: 'utf8' });
    if (!r.error && r.status === 0) бин = к;
  });
  if (!бин) {
    console.log('  ⏭  ESLint не установлен — проверка пропущена (npm i -g eslint)');
  } else {
    const r = spawnSync(бин, ['--no-config-lookup', '--config',
      path.join(КОРЕНЬ, 'eslint.config.mjs'), '--quiet', '--format', 'json',
      path.join(КОРЕНЬ, 'js')], { encoding: 'utf8' });
    let беды = [];
    try {
      JSON.parse(r.stdout).forEach(function (файл) {
        (файл.messages || []).forEach(function (м) {
          беды.push(path.basename(файл.filePath) + ':' + м.line + ' ' + м.message);
        });
      });
    } catch (e) { беды.push('ESLint не отдал ответ: ' + (r.stderr || e.message).slice(0, 200)); }
    check('ни одного вызова в пустоту и ни одной сломанной строки', беды.length === 0,
      беды.length ? беды.slice(0, 8).join('; ') : 'чисто во всех ' + файлы().length + ' файлах',
      'ни одной');
  }
}

console.log('\n— Вся программа читается как код');
{
  let плохие = [];
  файлы().forEach(function (f) {
    try { new Function(текст(f)); } catch (e) { плохие.push(f + ': ' + e.message); }
  });
  check('ни один файл не сломан', плохие.length === 0,
    плохие.length ? плохие.join('; ') : 'все ' + файлы().length + ' файлов читаются', 'все читаются');
}

/* Владелец разрешил программе быть умнее — с одним условием: «чтобы это
   было в уведомлениях, а не на виду». И назвал поимённо, что имеет право
   прорваться на экран полосой: записи не сохраняются, крупная недостача
   прямо сейчас, сегодня надо платить поставщику.

   Экранная проверка это тоже сторожит, но только на своём магазине: если
   в её данных какая-то тревога не сработала, сторожить ей нечего. Здесь
   смотрим сам код — тогда правило держится для любого магазина. */
console.log('\n— Срочным становится только то, что назвал владелец');
{
  const РАЗРЕШЕНО = ['save', 'overdue', 'duetoday', 'freshdiff'];
  const t = безКомментариев(текст('notices.js'));
  const re = /добавить\s*\(\s*'срочно'\s*,\s*'([^']+)'/g;
  const найдено = [];
  let m;
  while ((m = re.exec(t))) найдено.push(m[1]);
  const лишние = найдено.filter(function (id) { return РАЗРЕШЕНО.indexOf(id) < 0; });
  check('ни одна тревога не прорвалась на полосу самовольно', лишние.length === 0,
    лишние.length ? лишние.join(', ') : найдено.length + ' срочных, все разрешённые',
    'ни одной сверх списка владельца');
  check('и ни одна из трёх названных не потерялась',
    РАЗРЕШЕНО.every(function (id) { return найдено.indexOf(id) >= 0; }),
    найдено.join(', '), РАЗРЕШЕНО.join(', '));
}

console.log('\nИтог: ' + passed + ' проверок пройдено, ' + failed + ' провалено.');
process.exit(failed ? 1 : 0);

// Сборка содержимого Android-приложения: получается ли самостоятельная
// страница, которая работает без Google и без интернета.
var fs=require('fs'), path=require('path'), cp=require('child_process');
var ok=0,fail=0;
function t(n,c,x){if(c){ok++;console.log('  ✓ '+n);}else{fail++;console.log('  ✗ '+n+(x?' → '+x:''));}}
var ROOT=path.join(__dirname,'..','..');

cp.execSync('node '+path.join(ROOT,'android','build-www.js'),{stdio:'pipe'});
var out=path.join(ROOT,'android','www','index.html');
t('файл собран', fs.existsSync(out));
var h=fs.readFileSync(out,'utf8');
t('размер разумный', h.length>1000000 && h.length<5000000, Math.round(h.length/1024)+' КБ');

// ── Внутри всё нужное ────────────────────────────────────────────────
t('логика магазина внутри', h.indexOf('function getHomeSummary(')>0);
t('переходник внутри', h.indexOf('SpreadsheetApp')>0 && h.indexOf('chainable')>0);
t('вставки Apps Script вырезаны', !/<\?[!=]/.test(h));
t('сервер подменён на прямой вызов', /window\.google=\{script:\{/.test(h));

// ── Данные переживают закрытие ───────────────────────────────────────
t('данные пишутся в память телефона', /localStorage\.setItem\(_SAVE_KEY/.test(h));
t('и читаются при запуске', /function _dbLoad\(\)/.test(h));
t('сохранение при сворачивании приложения',
  /visibilitychange/.test(h) && /pagehide/.test(h));
t('запись не чаще раза в секунду — иначе импорт из 1С повесит телефон',
  /_saveTimer=setTimeout/.test(h));
t('даты в копии помечаются особо', /__d:this\[k\]\.toISOString\(\)/.test(h));

// ── Владелец узнаётся ────────────────────────────────────────────────
// На этом я уже спотыкался: адрес владельца не совпал с тем, что
// отдаёт переходник, и приложение отказывало человеку в доступе
// к его же деньгам.
t('владелец берётся из того же места, что и текущий пользователь',
  /_setSetting\(SS,'OWNER_EMAIL', Session\.getActiveUser\(\)\.getEmail\(\)\)/.test(h));
t('листы создаются ДО записи владельца',
  h.indexOf('ensureSheets(SS);')<h.indexOf("_setSetting(SS,'OWNER_EMAIL'"));

// ── Имя главного объекта ─────────────────────────────────────────────
// Переходник один и для проверки в Node, и для браузера.
t('переходник работает и в браузере', /var global = \(typeof globalThis/.test(h));

// ── Ошибки не теряются ───────────────────────────────────────────────
t('ошибка расчёта доходит до экрана', /setTimeout\(function\(\)\{ err&&err\(e\); \},0\)/.test(h));
t('неизвестное действие названо понятно', /Не найдено действие/.test(h));

console.log('\nСборка приложения: '+ok+' passed, '+fail+' failed');
process.exit(fail?1:0);

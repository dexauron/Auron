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

// ── Резервные копии ──────────────────────────────────────────────────
// Единственное, чем можно по-настоящему навредить человеку, — потерять
// его данные. Поэтому копия делается сама, а не по кнопке.
t('копия делается автоматически раз в сутки', /function _bakAuto\(\)/.test(h));
t('за сегодня копия делается один раз', /if\(localStorage\.getItem\(key\)\) return false;/.test(h));
t('хранится семь последних', /_BAK_KEEP=7/.test(h) && /while\(all\.length>_BAK_KEEP\)/.test(h));
t('при нехватке памяти чистим старое, а не теряем данные',
  /localStorage\.removeItem\(a\[0\]\)/.test(h));
t('копия выгружается файлом', /window\.auronBackupFile=function/.test(h));
t('файл называется с датой', /'auron-'\+_bakToday\(\)\+'\.json'/.test(h));

// Загрузка копии ЗАМЕЩАЕТ данные. Человек должен знать это ДО того,
// как нажмёт, — иначе однажды потеряет день работы и не поймёт почему.
t('перед заменой считаем, сколько записей сейчас и сколько в копии',
  /current:cur, incoming:incoming/.test(h));
t('перед заменой делается страховочная копия',
  /_BAK_PREFIX\+'before-restore'/.test(h));
t('чужой файл отклоняется понятно',
  /Это не файл копии Auron/.test(h) && /В файле нет данных магазина/.test(h));
t('после замены сбрасывается кэш — иначе экран покажет старое',
  /Object\.keys\(CACHE\)\.forEach\(function\(k\)\{delete CACHE\[k\];\}\)/.test(h));

// ── Напоминания с телефона ───────────────────────────────────────────
// Раньше подсказка «закрой смену» была видна только тому, кто сам
// открыл приложение. А если открыл — он и так помнит.
t('напоминание ставит сам телефон', /LocalNotifications/.test(h));
t('разрешение спрашивается', /requestPermissions/.test(h));
t('по умолчанию 21:00 — магазин закрыт, но записать ещё не поздно',
  /auron_notif_hour'\)\|\|'21'/.test(h));
t('час можно поменять', /window\.auronSetNotifHour=function/.test(h));
t('напоминания можно выключить и включить',
  /window\.auronNotifOff=function/.test(h) && /window\.auronNotifOn=function/.test(h));
t('старые будильники снимаются перед новым — иначе телефон звонил бы пачками',
  /cancel\(\{notifications:\[\{id:1\},\{id:2\}\]\}\)/.test(h));
t('повторяется каждый день', /repeats:true, every:'day'/.test(h));
t('просрочка по выплатам — отдельно и сразу', /function _notifOverdue\(\)/.test(h));
t('о просрочке напоминаем не чаще раза в день',
  /auron_overdue_'\+_bakToday\(\)/.test(h));
t('без плагина приложение не падает',
  /window\.Capacitor&&window\.Capacitor\.Plugins&&/.test(h) &&
  /if\(!_Notif\) return Promise\.resolve\(false\);/.test(h));

// ── Сборка на GitHub ─────────────────────────────────────────────────
var wf=fs.readFileSync(path.join(ROOT,'.github','workflows','build-apk.yml'),'utf8');
t('сборка запускается кнопкой', /workflow_dispatch/.test(wf));
t('файл попадает в Releases по метке версии', /softprops\/action-gh-release/.test(wf));
t('значок ставится в сборке', /make-icons\.py/.test(wf) && /mipmap-/.test(wf));
t('пустое содержимое не соберётся',
  /test -s www\/index\.html/.test(wf));
t('про ключ подписи предупреждено прямо в файле сборки',
  /ОБНОВИТЬ её потом не выйдет/.test(wf));

console.log('\nСборка приложения: '+ok+' passed, '+fail+' failed');
process.exit(fail?1:0);

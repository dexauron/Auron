// Месячный итог выручки из листа «ОТЧЁТ МЕС».
//
// Повод: в файле владельца выручка по дням есть только за июль, а лист
// «Отчёт мес» держит итог за другой месяц — 11 142 917 ₽. Без него
// «Общий капитал» показывал минус на пустом месте.
//
// Главная тонкость: месяц в этом листе НЕ написан. Ни даты, ни
// заголовка, ни одной формулы. Вычислить его по данным нельзя — долг
// 2 854 749 не совпадает ни с началом, ни с концом ни одного месяца,
// оборот закупа 8 357 188 лишь близок к июньскому 8 281 777, зарплата
// 654 000 не равна фактической ни за один месяц. Поэтому месяц
// спрашивается у владельца, а не угадывается.
var fs=require('fs'), path=require('path');
var code=fs.readFileSync(path.join(__dirname,'..','Code.gs'),'utf8');
var html=fs.readFileSync(path.join(__dirname,'..','Index.html'),'utf8');
var ok=0,fail=0;
function t(n,c,x){if(c){ok++;console.log('  ✓ '+n);}else{fail++;console.log('  ✗ '+n+(x!==undefined?' → '+JSON.stringify(x):''));}}
function grab(n){var i=code.indexOf('function '+n+'(');if(i<0)throw new Error('нет '+n);
  var d=0,j=code.indexOf('{',i);
  for(var k=j;k<code.length;k++){if(code[k]==='{')d++;else if(code[k]==='}'){d--;if(!d){j=k+1;break;}}}
  return code.slice(i,j);}
function grabVar(n){var i=code.indexOf('var '+n+' = [');var j=code.indexOf('\n];',i);return code.slice(i,j+3);}

global.Utilities={getUuid:function(){return 'u';}};
eval(grabVar('MON_ROWS'));
var MON_TAG='MON', B_COLS=13;
eval(grab('_xlsNum')); eval(grab('_ddsMonthlyRead')); eval(grab('_ddsMonthlyRows'));
eval(grab('_ddsFindMonthlySheet'));

function sheet(v){return {getLastRow:function(){return v.length;},
  getLastColumn:function(){return v[0].length;},
  getRange:function(){return {getValues:function(){return v;}};}};}

// ── Настоящий лист владельца ────────────────────────────────────────
var real=[
  ['Общаяя торговля ','','','',11142917],
  ['Наличная Торголвя ','','','',6890762],
  ['Онлайн Торговля','','','',4252155],
  ['Перевод ','','','',''],
  ['Выплата Кассы ','','','',''],
  ['Иман ','','','',131915],
  ['Зарплата ','','','',654000],
  ['ДОЛГ ПОСТАВЩИКАМ','','','',2854749]
];
var m=_ddsMonthlyRead(sheet(real));
t('наличная выручка найдена: 6 890 762', m.cash===6890762, m.cash);
t('безналичная найдена: 4 252 155', m.online===4252155, m.online);
t('итог сходится с листом: 11 142 917', m.total===11142917, m.total);
t('лист опознан как содержащий выручку', m.found===true);
t('«Общая торговля» НЕ берётся отдельно — это сумма двух',
  m.total===m.cash+m.online);

// Пустой и мусорный лист.
t('пустой лист не роняет', _ddsMonthlyRead(sheet([['','']])).found===false);
t('лист без выручки не считается найденным',
  _ddsMonthlyRead(sheet([['Зарплата ','','','',654000]])).found===false);
t('нет листа — нет данных', _ddsMonthlyRead(null).found===false);

// Число может стоять в любом столбце, не только в пятом.
t('число найдено во втором столбце',
  _ddsMonthlyRead(sheet([['Наличная торговля',500]])).cash===500);
// Текст вместо числа не проходит.
t('текст вместо суммы игнорируется',
  _ddsMonthlyRead(sheet([['Наличная торговля','много']])).cash===0);

// ── Операции пишутся последним числом месяца ────────────────────────
var rows=_ddsMonthlyRows('2026-06',6890762,4252155);
t('две операции: наличные и карта', rows.length===2, rows.length);
t('дата — последний день месяца (30 июня)',
  rows[0][2].getMonth()===5 && rows[0][2].getDate()===30,
  rows[0][2] && rows[0][2].toISOString());
t('обе — доход', rows.every(function(r){return r[3]==='Доход';}));
t('счета разные: Наличные и Карта', rows[0][6]==='Наличные' && rows[1][6]==='Карта');
t('помечены источником MON:2026-06',
  rows.every(function(r){return r[10]==='MON:2026-06';}), rows[0][10]);
t('февраль: последний день 28', _ddsMonthlyRows('2026-02',1,0)[0][2].getDate()===28);
t('декабрь не уезжает в следующий год',
  _ddsMonthlyRows('2026-12',1,0)[0][2].getMonth()===11);
t('нулевая часть не создаёт пустую операцию',
  _ddsMonthlyRows('2026-06',5000,0).length===1);

// ── Месяц спрашивается, а не угадывается ────────────────────────────
t('в коде нет попытки вычислить месяц по данным',
  !/угадыва[а-я]*\s*месяц\s*=/.test(code));
t('запись требует явно указанного месяца',
  /if \(!\/\^\\d\{4\}-\\d\{2\}\$\/\.test\(ym\)\) return \{__error:'Не указан месяц'\}/.test(code));
t('запись только с правом финансов',
  /_permGuard\(ssId,'finance'\)[\s\S]{0,120}Записывать выручку/.test(code));
t('повторная запись заменяет прежнюю, а не удваивает',
  /tags\[MON_TAG\+':'\+ym\] = true;[\s\S]{0,80}_ddsWipe\(ss, tags\)/.test(code));
t('нулевая выручка не записывается', /Выручка нулевая/.test(code));

// ── Экран спрашивает месяц ──────────────────────────────────────────
t('экран показывает найденные суммы', /_monthlyAsk:function/.test(html));
t('в списке — только месяцы без выручки', /_monthlyAsk\(d\.monthly,d\.noRevenue\)/.test(html));
t('вопрос есть в обоих окнах загрузки',
  (html.match(/App\._monthlyAsk\(/g)||[]).length===2,
  (html.match(/App\._monthlyAsk\(/g)||[]).length);
// Найденное должно ДОЕХАТЬ до экрана: в окне «Импорт из 1С» результат
// складывается в свой список, и поле легко потерять.
t('месячный итог передаётся в список результатов', /monthly:r\.monthly/.test(html));
t('экран зовёт запись на сервере', /gs\('ddsMonthlySave'/.test(html));
t('сервер такую функцию имеет', /function ddsMonthlySave\(/.test(code));
t('месяц показывается словом, а не 2026-06', /_monthName:function/.test(html));

console.log('\nМесячный итог выручки: '+ok+' passed, '+fail+' failed');
process.exit(fail?1:0);

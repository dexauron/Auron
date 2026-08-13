// Ловим вызовы НЕСУЩЕСТВУЮЩИХ функций в Code.gs.
//
// Повод: я вызвал _num(), которой в приложении нет и никогда не было —
// выдумал её по аналогии. Apps Script такое не проверяет заранее: код
// заливается нормально, а падает только когда владелец открывает экран.
// Он видит «Не получилось выполнить действие», а причина — опечатка,
// которую машина могла бы поймать за секунду.
//
// Тест не разбирает JS целиком: он ищет вызовы вида _имя( и проверяет,
// что такая функция объявлена или является встроенной.
var fs=require('fs'), path=require('path');
var code=fs.readFileSync(path.join(__dirname,'..','Code.gs'),'utf8');
var ok=0,fail=0;
function t(n,c,x){if(c){ok++;console.log('  ✓ '+n);}else{fail++;console.log('  ✗ '+n+(x?' → '+x:''));}}

// Объявления берём из ИСХОДНОГО текста: попытка вырезать блочные
// комментарии регулярным выражением съедала куски файла вместе с
// функциями — первая версия этого теста объявила призраками 17
// существующих функций. Урок: чем проще проверка, тем ей больше веры.
var declared = {};
(code.match(/function\s+([A-Za-z_$][\w$]*)\s*\(/g)||[]).forEach(function(m){
  declared[m.replace(/function\s+/,'').replace(/\s*\($/,'')] = true;
});
(code.match(/var\s+([A-Za-z_$][\w$]*)\s*=\s*function/g)||[]).forEach(function(m){
  declared[m.split(/\s+/)[1]] = true;
});

// Вызовы ищем построчно, выбрасывая строки-комментарии и содержимое
// кавычек — этого достаточно и ничего не ломает.
var lines = code.split('\n').map(function(l){
  var t = l.replace(/'(?:[^'\\]|\\.)*'/g,"''").replace(/"(?:[^"\\]|\\.)*"/g,'""');
  var i = t.indexOf('//');
  if (i >= 0 && !/https?:$/.test(t.slice(0,i+1))) t = t.slice(0, i);
  return t;
});
var clean = lines.join('\n');

// Наши служебные функции начинаются с подчёркивания: у них нет объекта-
// владельца, значит они обязаны быть объявлены в этом же файле.
var calls = {};
var rx = /(^|[^\w$.])(_[A-Za-z][\w$]*)\s*\(/g, m;
while ((m = rx.exec(clean))) calls[m[2]] = (calls[m[2]]||0) + 1;

var ghosts = Object.keys(calls).filter(function(n){ return !declared[n]; });
t('нет вызовов несуществующих служебных функций ('+Object.keys(calls).length+' имён проверено)',
  ghosts.length===0, ghosts.join(', '));

// Отдельно: та самая функция, на которой обожглись
t('_num не вызывается (её нет в приложении)', !/[^\w$.]_num\s*\(/.test(clean));
t('_gnum объявлена и используется', declared['_gnum'] && /_gnum\s*\(/.test(clean));

// Функции, которые обязаны существовать для новых экранов
['_ddsCollect','_ddsCompute','_ddsRate','_ddsSheetToOps','_ddsWipe','_incexpParse',
 '_ddsFindSheet','_ddsDateKey','_incexpSave'].forEach(function(n){
  t(n+' объявлена', !!declared[n]);
});

// Серверные точки входа, которые дёргает экран
['getDayDDS','getMonthDDS','getReconcile','ddsImport'].forEach(function(n){
  t(n+' объявлена', !!declared[n]);
});

// Имена серверных функций не должны повторяться: в Apps Script вторая
// молча затирает первую. Так уже чуть не потерялся getDayReport.
var names = (clean.match(/^function\s+([A-Za-z_$][\w$]*)\s*\(/gm)||[])
  .map(function(x){return x.replace(/^function\s+/,'').replace(/\s*\($/,'');});
var seen = {}, dup = [];
names.forEach(function(n){ if(seen[n]&&dup.indexOf(n)<0)dup.push(n); seen[n]=true; });
t('нет двух функций с одним именем ('+names.length+' функций)', dup.length===0, dup.join(', '));

console.log('\nПроверка вызовов: '+ok+' passed, '+fail+' failed');
process.exit(fail?1:0);

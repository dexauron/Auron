// Табель: сотрудники, начисления, выплаты.
//
// Владелец: «у некоторых оклад, у некоторых за смену, у некоторых по
// часам» + авансы, отпуска, штрафы, график, и чтобы во всех окнах были
// кнопки добавить/изменить/сохранить/отменить/удалить.
var fs=require('fs'), path=require('path');
var code=fs.readFileSync(path.join(__dirname,'..','Code.gs'),'utf8');
var html=fs.readFileSync(path.join(__dirname,'..','Index.html'),'utf8');
var ok=0,fail=0;
function t(n,c,x){if(c){ok++;console.log('  ✓ '+n);}else{fail++;console.log('  ✗ '+n+(x!==undefined?' → '+JSON.stringify(x):''));}}

// ── Начисление по трём видам оплаты ─────────────────────────────────
function accrue(e,x){
  var base = e.payType==='oklad' ? e.rate
           : e.payType==='hour'  ? Math.round(x.hours*e.rate)
           :                       x.shifts*e.rate;
  return Math.round(base + (x.bonus||0) - (x.fine||0));
}
t('за смену: 26 смен × 1 500 = 39 000',
  accrue({payType:'shift',rate:1500},{shifts:26})===39000);
t('по часам: 180 ч × 200 = 36 000',
  accrue({payType:'hour',rate:200},{hours:180})===36000);
t('оклад не зависит от числа смен',
  accrue({payType:'oklad',rate:45000},{shifts:12})===45000 &&
  accrue({payType:'oklad',rate:45000},{shifts:26})===45000);
t('премия прибавляется', accrue({payType:'shift',rate:1000},{shifts:10,bonus:5000})===15000);
t('штраф вычитается', accrue({payType:'shift',rate:1000},{shifts:10,fine:3000})===7000);
t('штраф может увести в минус — это честно',
  accrue({payType:'shift',rate:0},{shifts:0,fine:2000})===-2000);
t('остаток = начислено − выдано', (function(){
  var a=accrue({payType:'shift',rate:1500},{shifts:20}); return a-25000===5000;})());

// ── Сервер ──────────────────────────────────────────────────────────
t('тип оплаты хранится У СОТРУДНИКА, а не общий', /payType:_s\(e\.payType\|\|'shift'\)/.test(code));
t('допустимы только три вида оплаты', /\['shift','hour','oklad'\]\.indexOf\(payType\) < 0/.test(code));
t('начисление считает по типу', /if \(e\.payType === 'oklad'\)\s+base = e\.rate;/.test(code));
t('выданное берётся из настоящих операций ЗП и Аванс',
  /if \(cat !== 'ЗП' && cat !== 'Аванс'\) return;/.test(code));
t('премии и штрафы копятся отдельно', /if \(d\.status === 'Прем'\)/.test(code) && /if \(d\.status === 'Штр'\)/.test(code));

// Ключ строки: премия не должна затирать рабочий день той же даты.
t('вид записи входит в ключ строки', /var kind  = money \? status : 'work';/.test(code));
t('поиск строки учитывает вид', /function _tsFindRow\(sh, year, month, day, emp, kind\)/.test(code));

// Удаление раньше не работало: «сохранение с пустым именем» не находило
// строку по ключу и не удаляло никогда.
t('есть настоящее удаление записи', /function deleteTimesheetEntry\(p\)/.test(code));
t('пустое имя больше не считается удалением', /if \(!emp\) return \{__error:'Не указан сотрудник'\}/.test(code));

// Имя связывает табель и выплаты — переименование тянет историю.
t('переименование переносит табель', /function _tsRename\(ss, was, now\)/.test(code));
t('тёзка не заводится', /return \{__error:'Сотрудник «'\+name\+'» уже есть'\}/.test(code));
t('удаление с историей предлагает скрыть', /canHide:true/.test(code));

// Права: табель — это зарплаты людей.
t('табель требует прав', /getTimesheetMonth[\s\S]{0,300}_anyPermGuard\(ssId,\['manage','payments'\]\)/.test(code));
t('менять сотрудников — владелец или администратор',
  /saveEmployee[\s\S]{0,300}_permGuard\(ssId,'manage'\)/.test(code));

// ── Экран ───────────────────────────────────────────────────────────
t('три вкладки', /data-ts="grid"/.test(html)&&/data-ts="pay"/.test(html)&&/data-ts="emp"/.test(html));
// ── Календарь ───────────────────────────────────────────────────────
// Владелец: «табель сделай в виде календаря», «неделя начинается с
// понедельника». В JavaScript getDay() отдаёт 0 для воскресенья —
// без перевода календарь сдвинулся бы на день.
t('неделя начинается с понедельника', /\(new Date\(Y,M,1\)\.getDay\(\)\+6\)%7/.test(html));
t('дни недели подписаны с Пн', /\['Пн','Вт','Ср','Чт','Пт','Сб','Вс'\]/.test(html));
t('суббота и воскресенье выделены', /dow>=5/.test(html));
t('пустые клетки до первого числа', /for\(var i=0;i<first;i\+\+\) h\+='<div class="ts-cell pad">/.test(html));
t('хвост недели добивается', /var tail=\(7-\(\(first\+dIM\)%7\)\)%7;/.test(html));
t('сетка ровно в семь столбцов', /\.ts-weeks\{display:grid;grid-template-columns:repeat\(7,1fr\)/.test(html));
t('есть подпись, что означают цвета', /ts-legend/.test(html));
t('лишние отметки показаны числом, а не спрятаны', /\+'\(list\.length-3\)\+'|list\.length>3/.test(html));
// Проверка самого расчёта: 1 августа 2026 — суббота.
(function(){
  var f=(new Date(2026,7,1).getDay()+6)%7;
  t('1 августа 2026 попадает на субботу', f===5, f);
  var g=(new Date(2026,8,1).getDay()+6)%7;
  t('1 сентября 2026 — вторник', g===1, g);
  var v=(new Date(2026,10,1).getDay()+6)%7;
  t('1 ноября 2026 — воскресенье (последняя клетка)', v===6, v);
})();

t('в дне видны ВСЕ отмеченные, а не первый',
  /days\.forEach\(function\(x\)\{ \(byDay\[x\.day\]=byDay\[x\.day\]\|\|\[\]\)\.push\(x\); \}\);/.test(html));
t('сетка рисуется до ответа сервера', /App\._tsGrid\(App\._ts&&App\._ts\.month/.test(html));
['openTsDay','openTsEntry','tsDelete','openTsBonus','openTsEmpForm','deleteTsEmp',
 'openTsPerson','openSalaryPay'].forEach(function(f){
  t('есть окно: '+f, html.indexOf(f+':function')>0||html.indexOf(f+':async function')>0);
});
t('формы открываются полной страницей, а не окошком',
  (html.match(/'full'\)/g)||[]).length>=6);
t('везде есть «Отмена»', (html.match(/>Отмена<\/button>/g)||[]).length>=4);
t('старое перенаправление табеля в Поставщиков убрано',
  html.indexOf("App.setSuppTab('timesheet',null)")<0);
t('раздел грузится при переходе', /else if\(tab==='timesheet'\)App\.loadTimesheet\(\);/.test(html));

console.log('\nТабель: '+ok+' passed, '+fail+' failed');
process.exit(fail?1:0);

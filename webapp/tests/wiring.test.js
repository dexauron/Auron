// Связка «экран ↔ сервер»: всё, что экран зовёт, должно существовать.
//
// Повод — две настоящие поломки, которые владелец увидел раньше меня:
//   1) сервер вызывал _num(), которой нет  → «Не получилось выполнить действие»;
//   2) экран вызывал App._cacheClear(), которой нет → кэш молча не чистился.
// Ни синтаксис, ни прежние тесты этого не видели: в JavaScript вызов
// несуществующего имени — ошибка времени выполнения, а не разбора.
var fs=require('fs'), path=require('path');
var html=fs.readFileSync(path.join(__dirname,'..','Index.html'),'utf8');
var code=fs.readFileSync(path.join(__dirname,'..','Code.gs'),'utf8');
var ok=0,fail=0;
function t(n,c,x){if(c){ok++;console.log('  ✓ '+n);}else{fail++;console.log('  ✗ '+n+(x?' → '+x:''));}}

// ── 1. Экран → сервер: каждая gs('имя') должна быть функцией в Code.gs ──
var srv = {};
(code.match(/^function\s+([A-Za-z_$][\w$]*)\s*\(/gm)||[]).forEach(function(m){
  srv[m.replace(/^function\s+/,'').replace(/\s*\($/,'')] = true;
});
var calledSrv = {};
var rx1=/gs\(\s*'([A-Za-z_$][\w$]*)'/g, m1;
while((m1=rx1.exec(html))) calledSrv[m1[1]]=true;
var names1=Object.keys(calledSrv);
var missSrv=names1.filter(function(n){return !srv[n];});
t('все серверные вызовы существуют ('+names1.length+' имён)', missSrv.length===0,
  missSrv.join(', '));

// ── 2. Экран → экран: каждый App.метод() должен быть объявлен ──────────
// Учитываем и обычные, и async-методы: первая версия этой проверки
// не знала про async и объявила призраками 19 живых методов.
var app = {};
(html.match(/([A-Za-z_$][\w$]*)\s*:\s*(?:async\s+)?function/g)||[]).forEach(function(m){
  app[m.split(':')[0].trim()] = true;
});
(html.match(/App\.([A-Za-z_$][\w$]*)\s*=\s*(?:async\s+)?function/g)||[]).forEach(function(m){
  app[m.replace(/^App\./,'').split(/\s*=/)[0].trim()] = true;
});
var calledApp = {};
var rx2=/App\.([A-Za-z_$][\w$]*)\s*\(/g, m2;
while((m2=rx2.exec(html))) calledApp[m2[1]]=true;
var names2=Object.keys(calledApp);
var missApp=names2.filter(function(n){return !app[n];});
t('все методы экрана существуют ('+names2.length+' имён)', missApp.length===0,
  missApp.join(', '));

// ── 3. Проверка сама должна ловить ошибку, иначе ей нет веры ──────────
// Имена берём ЛАТИНСКИЕ: поиск ищет [A-Za-z_$], и кириллическое имя
// он просто не увидит — первая версия самопроверки на этом и упала.
(function selfCheck(){
  var fake = html + "\n<script>App.thisMethodDoesNotExist();</script>";
  var c={}; var rx=/App\.([A-Za-z_$][\w$]*)\s*\(/g, m;
  while((m=rx.exec(fake))) c[m[1]]=true;
  t('проверка ловит выдуманный метод', !app['thisMethodDoesNotExist'] && c['thisMethodDoesNotExist']);
  var fake2 = html + "\ngs('thisServerFnDoesNotExist',{});";
  var c2={}; var r2=/gs\(\s*'([A-Za-z_$][\w$]*)'/g, m3;
  while((m3=r2.exec(fake2))) c2[m3[1]]=true;
  t('проверка ловит выдуманную серверную функцию', !srv['thisServerFnDoesNotExist'] && c2['thisServerFnDoesNotExist']);
})();

// ── 4. Экраны, которые мы только что построили, подключены целиком ────
[['getDayDDS','День'],['getMonthDDS','Месяц'],['getReconcile','Сверка'],
 ['ddsImport','Загрузка отчёта']].forEach(function(p){
  t('«'+p[1]+'»: '+p[0]+' есть на сервере и вызывается с экрана',
    srv[p[0]] && calledSrv[p[0]]);
});

// ── 5. Вкладки Кассы ведут в существующие блоки ───────────────────────
['k-hub','k-day','k-month','k-load'].forEach(function(id){
  t('блок '+id+' есть в разметке', html.indexOf('id="'+id+'"')>0);
});
['hub','day','month','load'].forEach(function(kt){
  t('вкладка '+kt+' есть в переключателе', html.indexOf("data-kt=\""+kt+"\"")>0);
});

// ── Подписи, зашитые в вёрстку намертво ─────────────────────────────
// Роль пользователя стояла в разметке словом «Администратор» и никогда
// не менялась: владелец видел себя администратором. На права это не
// влияло — их проверяет сервер, — но человек не мог понять, кто он.
t('роль в боковой панели не зашита в вёрстку',
  html.indexOf('<div class="sb-user-role">Администратор</div>')<0);
t('роль подставляется из данных', /_paintRole:function\(\)/.test(html) &&
  /el\.textContent=App\.s\.myRole/.test(html));
t('роль обновляется, когда сервер сказал, кто мы',
  (html.match(/App\._paintRole\(\)/g)||[]).length>=3);

console.log('\nСвязка экрана и сервера: '+ok+' passed, '+fail+' failed');
process.exit(fail?1:0);

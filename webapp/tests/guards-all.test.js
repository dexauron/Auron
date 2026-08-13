// Каждая серверная функция, до которой дотягивается экран, должна
// проверять права.
//
// Повод — аудит 01.08.2026. Прежние проверки смотрели отдельные функции,
// а не ВЕСЬ список из 145 точек входа. Нашлось 20 без защиты, из них
// самая опасная — seedDemoData: она СТИРАЕТ все данные и заполняет
// демонстрационными, и позвать её мог любой сотрудник.
//
// Проверка идёт на шаг вглубь: обёртка вроде setMemberRoleMulti защиты не
// содержит, но передаёт работу setMemberRole, где стоит _isOwner. Без
// этого шага тест выдал бы 87 ложных тревог.
var fs=require('fs'), path=require('path');
var code=fs.readFileSync(path.join(__dirname,'..','Code.gs'),'utf8');
var html=fs.readFileSync(path.join(__dirname,'..','Index.html'),'utf8');
var ok=0,fail=0;
function t(n,c,x){if(c){ok++;console.log('  ✓ '+n);}else{fail++;console.log('  ✗ '+n+(x!==undefined?' → '+JSON.stringify(x):''));}}

var called={},m,rx=/gs\(\s*'([A-Za-z_$][\w$]*)'/g;
while((m=rx.exec(html)))called[m[1]]=1;
var decl={},d2,r2=/^function\s+([A-Za-z_$][\w$]*)\s*\(/gm;
while((d2=r2.exec(code)))decl[d2[1]]=1;
function body(n){var i=code.indexOf('function '+n+'(');if(i<0)return null;
  var d=0,j=code.indexOf('{',i);
  for(var k=j;k<code.length;k++){if(code[k]==='{')d++;else if(code[k]==='}'){d--;if(!d){j=k+1;break;}}}
  return code.slice(i,j);}
var G=/_permGuard|_finGuard|_anyPermGuard|_isOwner\(|_canManage\(|MANAGE_DENIED|FIN_DENIED/;
function guarded(n,depth){var b=body(n);if(!b)return false;if(G.test(b))return true;
  if(depth>=2)return false;var seen={},mm,rr=/([A-Za-z_$][\w$]*)\s*\(/g;
  while((mm=rr.exec(b))){var f=mm[1];if(f===n||!decl[f]||seen[f])continue;seen[f]=1;
    if(guarded(f,depth+1))return true;}return false;}

// До входа в магазин прав ещё нет — эти по смыслу открыты.
var PUBLIC={getAppUrl:1,registerUser:1,logoutUser:1,initUserApp:1,acceptInvite:1,
  findInvites:1,createOrg:1,getMyProfile:1,updateMyProfile:1,getUserFlags:1,setUserFlag:1,
  getTeamAll:1,getNotifications:1,askAuron:1,brainLearn:1,suggestCategory:1,getSettings:1};

var names=Object.keys(called);
t('экран зовёт '+names.length+' серверных функций', names.length>100);

// Всё, что ПИШЕТ в таблицу, обязано проверять права. Без исключений.
var writers=names.filter(function(n){
  if(PUBLIC[n])return false;
  var b=body(n)||'';
  return /setValue|appendRow|deleteRow|setValues|_killRows|_wipeSheetRows/.test(b);
});
var badWriters=writers.filter(function(n){return !guarded(n,0);});
t('всё пишущее защищено ('+writers.length+' функций)', badWriters.length===0, badWriters);

// Самое опасное — стирание данных.
t('seedDemoData стирает данные и требует владельца',
  /function seedDemoData[\s\S]{0,400}_isOwner/.test(code));
t('clearAllData требует владельца',
  /function clearAllData[\s\S]{0,600}_isOwner/.test(code));

// Деньги и долги.
[['importRows','finance'],['updateDebtEntry','payments'],['saveObligation','finance'],
 ['saveAccount','finance'],['toggleAccountVisibility','finance'],
 ['saveRecurring','finance'],['getPayments','payments'],['getObligations','finance'],
 ['getRepDebt','payments'],['getLosses','finance'],['getDayReport','finance'],
 ['getAuditLog','manage'],['saveTimesheetEntry','manage']].forEach(function(pair){
  var b=body(pair[0])||'';
  t(pair[0]+" требует права «"+pair[1]+"»", b.indexOf("'"+pair[1]+"'")>0, b.slice(0,120));
});

// Проверка должна следовать за делегированием, иначе толку от неё нет.
t('обёртки засчитываются через ту функцию, которой передают работу',
  guarded('setMemberRoleMulti',0) && !G.test(body('setMemberRoleMulti')));

// Сама проверка должна ловить дыру, иначе ей нет веры.
t('проверка ловит незащищённую функцию', (function(){
  var fake='function totallyOpenWrite(p) {\n  sh.appendRow([1]);\n}';
  var saved=code; code=code+'\n'+fake;
  var r=!guarded('totallyOpenWrite',0);
  code=saved; return r;})());

console.log('\nПрава на всех точках входа: '+ok+' passed, '+fail+' failed');
process.exit(fail?1:0);

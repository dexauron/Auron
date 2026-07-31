// Права по ролям: у каждого своё, лишнего не видно.
// Ловим: 1) Администратор ≠ Владелец (не должен удалять и менять настройки);
//        2) UI и сервер дают ОДИН И ТОТ ЖЕ набор прав (иначе кнопка есть,
//           а сервер отказывает); 3) сотрудник зала не видит финансы.
function serverPerms(role){            // копия _rolePerms из Code.gs
  if (role==='Владелец')      return ['finance','kassa','receive','goods','payments','manage'];
  if (role==='Администратор') return ['finance','kassa','receive','goods','payments'];
  if (role==='Бухгалтер')     return ['finance','payments','goods'];
  return ['kassa','receive'];
}
function clientPerms(role){            // копия _rolePermsClient из Index.html
  if(role==='Владелец')      return ['finance','kassa','receive','goods','payments','manage'];
  if(role==='Администратор') return ['finance','kassa','receive','goods','payments'];
  if(role==='Бухгалтер')     return ['finance','payments','goods'];
  return ['kassa','receive'];
}
var ALL=['finance','kassa','receive','goods','payments','manage'];
var ROLES=['Владелец','Администратор','Бухгалтер','Сотрудник зала'];
var ok=0,fail=0;
function t(n,c){ if(c){ok++;console.log('  ✓ '+n);}else{fail++;console.log('  ✗ '+n);} }
function has(role,p){ return serverPerms(role).indexOf(p)>=0; }

// сервер и клиент не расходятся
ROLES.forEach(function(r){
  t('UI и сервер совпадают: '+r, serverPerms(r).slice().sort().join()===clientPerms(r).slice().sort().join());
});
// только владелец удаляет и меняет настройки
ROLES.forEach(function(r){
  if(r==='Владелец') t('владелец может manage', has(r,'manage'));
  else t(r+' НЕ может manage', !has(r,'manage'));
});
// сотрудник зала не видит деньги
t('сотрудник зала без финансов',  !has('Сотрудник зала','finance'));
t('сотрудник зала без выплат',    !has('Сотрудник зала','payments'));
t('сотрудник зала без товаров',   !has('Сотрудник зала','goods'));
t('сотрудник зала видит кассу',    has('Сотрудник зала','kassa'));
t('сотрудник зала принимает товар',has('Сотрудник зала','receive'));
// бухгалтер: деньги да, касса/приём нет
t('бухгалтер видит финансы',       has('Бухгалтер','finance'));
t('бухгалтер платит',              has('Бухгалтер','payments'));
t('бухгалтер НЕ на кассе',        !has('Бухгалтер','kassa'));
t('бухгалтер НЕ принимает товар', !has('Бухгалтер','receive'));
// администратор ведёт магазин
t('админ на кассе',                has('Администратор','kassa'));
t('админ принимает товар',         has('Администратор','receive'));
t('админ видит финансы',           has('Администратор','finance'));
// у всех ролей права только из справочника
ROLES.forEach(function(r){
  t('нет неизвестных прав: '+r, serverPerms(r).every(function(p){return ALL.indexOf(p)>=0;}));
});
// никто, кроме владельца, не имеет полного набора
ROLES.filter(function(r){return r!=='Владелец';}).forEach(function(r){
  t(r+' не равен владельцу', serverPerms(r).length<ALL.length);
});
// Гарды принимают ID таблицы (строку). Если передать объект Spreadsheet,
// openById внутри падает и catch возвращает true — проверка пропускает всех.
// Так было в xlsPreview/xlsApply/saveLoss: сотрудник зала мог грузить 1С.
var srcGuards=require('fs').readFileSync(__dirname+'/../Code.gs','utf8');
var badGuards=srcGuards.match(/_(perm|any|fin)Guard\(\s*ss\s*[,)]/g)||[];
t('гарды не вызываются с объектом ss вместо ssId', badGuards.length===0);

// Денежные экраны требуют права на финансы, а не на товары.
// «Общие доходы и расходы» из 1С — это сводка для «Сверки»: именно по
// ней владелец видит расхождение между 1С и своим отчётом. Раньше её
// пускало право «товары», и сотрудник мог подменить цифры сверки.
var incexpBlock = srcGuards.slice(srcGuards.indexOf("if (type === 'incexp')"),
                                  srcGuards.indexOf("if (type === 'incexp')")+700);
t('сводка доходов и расходов требует права финансов',
  /_permGuard\(p\.ssId,'finance'\)/.test(incexpBlock));
t('при отказе временный файл удаляется', /_xlsDrop\(tmp\);\n *return \{__error:'Сводку/.test(incexpBlock));

// Загрузка собственного отчёта владельца — тоже деньги.
[['ddsImport','finance'],['getReconcile','finance']].forEach(function(pair){
  var i=srcGuards.indexOf('function '+pair[0]+'(');
  t(pair[0]+' требует права «'+pair[1]+'»',
    i>0 && srcGuards.slice(i,i+700).indexOf("_permGuard(ssId,'"+pair[1]+"')")>0);
});
[['getDayDDS'],['getMonthDDS']].forEach(function(pair){
  var i=srcGuards.indexOf('function '+pair[0]+'(');
  t(pair[0]+' требует финансов или кассы',
    i>0 && srcGuards.slice(i,i+400).indexOf("_anyPermGuard(ssId, ['finance','kassa'])")>0);
});

console.log('\nПрава по ролям: '+ok+' passed, '+fail+' failed');
process.exit(fail?1:0);

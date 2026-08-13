// Несколько ролей на одном человеке + галочка «все мои магазины».
// Владелец сказал: один и тот же человек бывает и бухгалтером, и
// администратором. Роль стала пресетом прав, а не рамкой — права
// складываются. Проверяем НАСТОЯЩИЕ функции из Code.gs, а не копии.
var fs=require('fs'), path=require('path');
var code=fs.readFileSync(path.join(__dirname,'..','Code.gs'),'utf8');
var html=fs.readFileSync(path.join(__dirname,'..','Index.html'),'utf8');
var ok=0,fail=0;
function t(n,c,x){if(c){ok++;console.log('  ✓ '+n);}else{fail++;console.log('  ✗ '+n+(x?' → '+x:''));}}

function grab(name){
  var i=code.indexOf('function '+name+'(');
  if(i<0) throw new Error('нет функции '+name);
  var d=0,j=code.indexOf('{',i);
  for(var k=j;k<code.length;k++){ if(code[k]==='{')d++; else if(code[k]==='}'){d--; if(!d){j=k+1;break;}} }
  return code.slice(i,j);
}
eval(code.match(/var ALL_ROLES=\[[^\]]*\];/)[0]);
eval(grab('_roleList')); eval(grab('_roleStr'));
eval(grab('_oneRolePerms')); eval(grab('_rolePerms'));

// ── Разбор строки ролей ──────────────────────────────────────────────
t('одна роль', _roleList('Бухгалтер').join('|')==='Бухгалтер');
t('две роли через запятую',
  _roleList('Бухгалтер, Администратор').join('|')==='Бухгалтер|Администратор');
t('лишние пробелы не мешают',
  _roleList('  Бухгалтер ,Администратор  ').join('|')==='Бухгалтер|Администратор');
t('повтор не удваивается', _roleList('Бухгалтер, Бухгалтер').length===1);
t('выдуманная роль отбрасывается', _roleList('Хакер').join('|')==='Сотрудник зала');
t('пусто → сотрудник зала', _roleList('').join('|')==='Сотрудник зала');
t('null не роняет', _roleList(null).join('|')==='Сотрудник зала');
t('строка нормализуется обратно',
  _roleStr('Администратор,Бухгалтер')==='Администратор, Бухгалтер');

// ── Права складываются ───────────────────────────────────────────────
var buh=_rolePerms('Бухгалтер'), adm=_rolePerms('Администратор');
var both=_rolePerms('Бухгалтер, Администратор');
t('бухгалтер+администратор получают всё от обоих',
  buh.concat(adm).every(function(k){return both.indexOf(k)>=0;}), both.join(','));
t('дублей в правах нет', both.length===new Set(both).size, both.join(','));
t('лишнего не появилось: manage не выдан',
  both.indexOf('manage')<0, both.join(','));
t('сотрудник зала + бухгалтер = касса, приём и деньги',
  ['kassa','receive','finance','payments'].every(function(k){
    return _rolePerms('Сотрудник зала, Бухгалтер').indexOf(k)>=0; }));
t('владелец по-прежнему может всё', _rolePerms('Владелец').length===6);
t('одна роль работает как раньше',
  _rolePerms('Бухгалтер').join('|')===_oneRolePerms('Бухгалтер').join('|'));

// ── Сервер: приём массива ролей ──────────────────────────────────────
t('setMemberRole принимает массив roles',
  /function setMemberRole[\s\S]{0,400}Array\.isArray\(p\.roles\)/.test(code));
t('приглашение принимает массив ролей',
  /_inviteMemberLocked[\s\S]{0,400}Array\.isArray\(p\.roles\)/.test(code));
t('приглашение в несколько магазинов принимает массив',
  /function inviteMemberMulti[\s\S]{0,300}Array\.isArray\(p\.roles\)/.test(code));
t('роль в списке команды нормализуется', /var role=_roleStr\(r\[1\]/.test(code));
t('фронт получает роли отдельным списком', /roles:_roleList\(role\)/.test(code));

// ── «Все мои магазины» ───────────────────────────────────────────────
t('карта галочек хранится у владельца', /ALL_STORES/.test(code));
t('есть функция включения', /function setMemberAllStores\(/.test(code));
t('включение сразу добавляет в существующие магазины',
  /setMemberAllStores[\s\S]{0,700}inviteMember\(\{ssId:o\.ssId/.test(code));
t('выключение убирает из карты',
  /if \(!on\) \{ delete m\[email\]/.test(code));
t('новый магазин зовёт отмеченных', /_inviteAllStoresInto\(res\.ssId\)/.test(code));
t('функция приглашения в новый магазин есть',
  /function _inviteAllStoresInto\(/.test(code));
t('getTeamAll отдаёт карту галочек', /allStores:_allStoresMap\(\)/.test(code));

// Смысл: галочка не должна молча ждать будущего магазина. Если бы она
// только запоминалась, владелец отметил бы человека и решил, что доступ
// выдан, — а тот ничего бы не увидел до открытия новой точки.
t('галочка действует и на сегодняшние магазины',
  code.indexOf('_inviteAllStoresInto')>0 &&
  /setMemberAllStores[\s\S]{0,700}\(d\.orgs\|\|\[\]\)\.forEach/.test(code));

// ── Фронт ────────────────────────────────────────────────────────────
t('выбор ролей галочками, а не одним select',
  /_roleChecks:function/.test(html) && html.indexOf('id="tm-role"')<0);
t('роль сотрудника открывается отдельным окном',
  /openMemberRoles:function/.test(html));
t('пустой набор ролей не сохраняется',
  /_mrSave[\s\S]{0,200}Выбери хотя бы одну роль/.test(html));
t('галочка «все мои магазины» есть в списке',
  /_teamAllStores:function/.test(html) && /Все мои магазины/.test(html));
t('приглашение шлёт массив ролей',
  /inviteMemberMulti',\{email:email,roles:roles/.test(html));
t('старый обработчик роли не остался мусором',
  html.indexOf('App._teamRole(')<0 || /_teamRole:function/.test(html));

console.log('\nНесколько ролей и все магазины: '+ok+' passed, '+fail+' failed');
process.exit(fail?1:0);

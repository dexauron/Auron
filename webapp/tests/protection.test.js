// Защита листов от прямой правки в Google Таблице.
//
// Смысл проверки: приложение работает ОТ ИМЕНИ вошедшего, поэтому лист,
// в который сотрудник пишет по своей работе, закрывать нельзя — иначе
// приложение у него сломается. А листы с деньгами, куда он по роли не пишет,
// закрыть можно и нужно: иначе все серверные проверки прав обходятся тем,
// что человек просто открывает таблицу и правит руками.
var fs=require('fs'), path=require('path');
var code=fs.readFileSync(path.join(__dirname,'..','Code.gs'),'utf8');
var ok=0,fail=0;
function t(n,c,extra){if(c){ok++;console.log('  ✓ '+n);}else{fail++;console.log('  ✗ '+n+(extra?' → '+extra:''));}}

// ── 1) Разбираем карту SHEET_PERM прямо из кода ──
var m=code.match(/var SHEET_PERM = \{([\s\S]*?)\n\};/);
t('карта SHEET_PERM найдена', !!m);
var map={};
if (m) m[1].split('\n').forEach(function(line){
  var r=line.match(/'([^']+)'\s*:\s*(?:'([^']+)'|null)/);
  if (r) map[r[1]] = r[2] || null;
});

// ── 2) Листы, куда сотрудник пишет сам, защищать НЕЛЬЗЯ ──
// Это не придирка: закрыв БАЗУ, мы бы сломали кассиру запись операции.
['БАЗА','СМЕНЫ','ЖУРНАЛ','АУДИТ','ТОВАРЫ','ЦЕНЫ_ИСТ'].forEach(function(name){
  t('лист «'+name+'» не закрыт (в него пишет сотрудник)', !(name in map));
});

// ── 3) Денежные листы защищены и требуют осмысленного права ──
var need={'ВЫПЛАТЫ':'payments','ДОЛГИ':'payments','СЧЕТА':'finance','ДОСТУП':null};
Object.keys(need).forEach(function(name){
  t('лист «'+name+'» защищён', name in map, 'нет в SHEET_PERM');
  t('  право для «'+name+'» = '+String(need[name]), map[name]===need[name], String(map[name]));
});

// ── 4) Права из карты существуют в каталоге прав ──
var perms=Object.keys(map).map(function(k){return map[k];}).filter(Boolean);
var known=(code.match(/var PERM_CATALOG\s*=\s*\[([\s\S]*?)\];/)||[,''])[1];
var unknown=perms.filter(function(p){ return known.indexOf("'"+p+"'")<0; });
t('все права из SHEET_PERM есть в PERM_CATALOG', unknown.length===0, unknown.join(','));

// ── 5) Состав допущенных считается по ролям, а не берётся «на глазок» ──
t('состав допущенных берётся из листа ДОСТУП', /_membersWithPerm[\s\S]{0,400}SH_ACCESS/.test(code));
t('учитываются индивидуальные права сотрудника', /_membersWithPerm[\s\S]{0,600}JSON\.parse/.test(code));
t('перед выдачей доступа старые редакторы снимаются', /removeEditor[\s\S]{0,200}addEditors/.test(code));

// ── 6) Смена ролей перестраивает защиту ──
// Иначе уволенный или понижённый сотрудник остаётся редактором листа.
['setMemberRole','setMemberPerms','_inviteMemberLocked','removeMember'].forEach(function(fn){
  var body=(code.match(new RegExp('function '+fn+'\\(p\\)\\{?[\\s\\S]*?\\n\\}\\n','m'))||[''])[0];
  t(fn+' пересобирает защиту', /_protectionStale\(/.test(body));
});
t('пересборка сбрасывает и кэш ensureSheets', /_protectionStale[\s\S]{0,400}_ensureHeavyKey/.test(code));

// ── 7) Ручные функции — только для владельца ──
['getSheetProtection','protectSheetsNow'].forEach(function(fn){
  var i=code.indexOf('function '+fn+'(');
  t(fn+' доступна только владельцу', i>0 && /_isOwner\(ss\)/.test(code.slice(i,i+400)));
});

// ── 8) Неудача не запоминается ──
// Защиту ставит только владелец. Если её попробовал поставить сотрудник и не
// смог, пометка «уже защищено» не должна сохраниться — иначе владелец, зайдя
// позже, защиту так и не поставит.
t('метка ставится только при полном успехе', /if\s*\(r\.failed\)\s*return false;/.test(code));

console.log('\nЗащита листов: '+ok+' passed, '+fail+' failed');
process.exit(fail?1:0);

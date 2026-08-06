// Права по ролям в базе обязаны совпадать с правами в работающем
// приложении. Если они разойдутся, получится худший из миров: в
// интерфейсе кнопки спрятаны, а через прямой запрос к базе всё открыто.
// Именно так и было до миграции 005 — кассир видел зарплаты.
var fs=require('fs'), path=require('path');
var code=fs.readFileSync(path.join(__dirname,'..','Code.gs'),'utf8');
var sqlPath=path.join(__dirname,'..','..','infra','migrations','005_role_policies.sql');
var sql=fs.readFileSync(sqlPath,'utf8');
var ok=0,fail=0;
function t(n,c,x){if(c){ok++;console.log('  ✓ '+n);}else{fail++;console.log('  ✗ '+n+(x?' → '+x:''));}}

// ── Права из работающего приложения ──────────────────────────────────
function permsFromCode(ruRole){
  var i=code.indexOf('function _oneRolePerms(');
  var body=code.slice(i, code.indexOf('\n}', i));
  var line=body.split('\n').filter(function(L){return L.indexOf(ruRole)>=0;})[0];
  if(!line) return null;
  return (line.match(/'([a-z]+)'/g)||[]).map(function(s){return s.replace(/'/g,'');});
}
var cashier=(function(){
  var i=code.indexOf('function _oneRolePerms(');
  var body=code.slice(i, code.indexOf('\n}', i));
  var line=body.split('\n').filter(function(L){return /Сотрудник зала/.test(L);})[0]||'';
  return (line.match(/'([a-z]+)'/g)||[]).map(function(s){return s.replace(/'/g,'');});
})();

// ── Права из базы ────────────────────────────────────────────────────
function permsFromSql(enRole){
  var re=new RegExp("WHEN '"+enRole+"'\\s+THEN\\s+ARRAY\\[([^\\]]+)\\]");
  var m=sql.match(re);
  if(!m) return null;
  return (m[1].match(/'([a-z]+)'/g)||[]).map(function(s){return s.replace(/'/g,'');});
}
var elseM=sql.match(/ELSE\s+ARRAY\[([^\]]+)\]/);
var sqlCashier=elseM?(elseM[1].match(/'([a-z]+)'/g)||[]).map(function(s){return s.replace(/'/g,'');}):null;

function same(a,b){
  if(!a||!b) return false;
  return a.slice().sort().join(',')===b.slice().sort().join(',');
}

[['Владелец','owner'],['Администратор','admin'],['Бухгалтер','accountant']].forEach(function(pair){
  var fromCode=permsFromCode(pair[0]), fromSql=permsFromSql(pair[1]);
  t('права «'+pair[0]+'» совпадают с базой', same(fromCode,fromSql),
    'приложение '+JSON.stringify(fromCode)+' ≠ база '+JSON.stringify(fromSql));
});
t('права «Сотрудник зала» совпадают с базой', same(cashier,sqlCashier),
  'приложение '+JSON.stringify(cashier)+' ≠ база '+JSON.stringify(sqlCashier));

// ── Главное, ради чего всё затевалось ────────────────────────────────
t('у сотрудника зала НЕТ доступа к финансам',
  cashier.indexOf('finance')<0 && sqlCashier.indexOf('finance')<0);
t('у сотрудника зала НЕТ управления магазином',
  cashier.indexOf('manage')<0 && sqlCashier.indexOf('manage')<0);
t('у бухгалтера НЕТ кассы', (permsFromSql('accountant')||[]).indexOf('kassa')<0);
t('у бухгалтера НЕТ управления', (permsFromSql('accountant')||[]).indexOf('manage')<0);
t('управление магазином только у владельца',
  (permsFromSql('admin')||[]).indexOf('manage')<0);

// ── Денежные таблицы закрыты ─────────────────────────────────────────
// Ищем по ИМЕНИ политики, а не по «тексту после имени таблицы»: первым
// вхождением имени таблицы идёт DROP POLICY, и проверка цеплялась за него.
[['tx_read','transactions'],['debt_read','debt_entries'],
 ['acc_read','accounts'],['emp_read','employees']].forEach(function(pair){
  var m=sql.match(new RegExp('CREATE POLICY "'+pair[0]+'"[\\s\\S]{0,200}?;'));
  t('читать '+pair[1]+' можно только с доступом к финансам',
    !!m && /FOR SELECT USING \(public\.auron_can\(org_id,'finance'\)\)/.test(m[0]),
    m?m[0].replace(/\s+/g,' ').slice(0,90):'политика не найдена');
});
t('старое правило «свой — значит всё можно» снимается',
  /DROP POLICY IF EXISTS "org_isolation"/.test(sql));
t('помощник обходит защиту строк, иначе рекурсия',
  /SECURITY DEFINER SET search_path = public/.test(sql));
t('путь поиска прибит — чужую таблицу не подсунуть',
  /SET search_path = public/.test(sql));
t('нет прав у того, кто не в магазине',
  /COALESCE\(p_perm = ANY\(public\.auron_perms\(p_org\)\), false\)/.test(sql));

// ── Кассир обязан мочь работать ──────────────────────────────────────
// Закрыть всё — не решение: если кассир не запишет смену, приложение
// для него бесполезно.
t('кассир может записать смену', /FOR INSERT WITH CHECK \(public\.auron_can\(org_id,'kassa'\)\)/.test(sql));
t('кассир может записать операцию смены',
  /"tx_write"[\s\S]{0,200}auron_can\(org_id,'kassa'\)/.test(sql));
t('кассир может записать накладную',
  /"debt_write"[\s\S]{0,200}auron_can\(org_id,'receive'\)/.test(sql));
t('кассир видит справочник поставщиков',
  /"cp_read"[\s\S]{0,120}auron_perms\(org_id\) IS NOT NULL/.test(sql));

console.log('\nПрава по ролям в базе: '+ok+' passed, '+fail+' failed');
process.exit(fail?1:0);

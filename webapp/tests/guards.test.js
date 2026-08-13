// Проверки прав на сервере. Ловим баг, который уже случался:
// _permGuard(ss, ...) вместо _permGuard(ssId, ...) — внутрь передавали
// объект таблицы вместо её id, openById падал, а catch возвращал true.
// Проверка молча пропускала ВСЕХ, и по коду это было незаметно.
var fs=require('fs'), path=require('path');
var code=fs.readFileSync(path.join(__dirname,'..','Code.gs'),'utf8');
var ok=0,fail=0;
function t(n,c,extra){if(c){ok++;console.log('  ✓ '+n);}else{fail++;console.log('  ✗ '+n+(extra?' → '+extra:''));}}

// 1) Никто не передаёт объект ss туда, где ждут ssId
var wrong=(code.match(/_(?:perm|fin)Guard\(\s*ss\s*[,)]/g)||[]);
t('нигде не передаётся объект ss вместо ssId', wrong.length===0, wrong.join(', '));

// 2) Воспроизводим поведение: почему это опасно
function hasPerm(){ return false; }
function openById(id){ if(typeof id!=='string'||!id) throw new Error('Invalid argument'); return {}; }
function guard(ssId){ try{ return hasPerm(openById(ssId)); }catch(e){ return true; } }
t('со строкой id права проверяются', guard('1abc')===false);
t('с объектом проверка пропускала всех (так было)', guard({})===true);

// 3) Все проверки берут id из параметра запроса
var calls=(code.match(/_(?:perm|fin)Guard\([^)]*\)/g)||[]);
// Смысл проверки — что внутрь идёт СТРОКА-идентификатор, а не объект
// таблицы. Имена переменных бывают разные (ssId, src, dst), поэтому
// разрешаем их явным списком, а не только слово «ssId».
var bad=calls.filter(function(c){
  return !/p\s*&&\s*p\.ssId|p\.ssId|\bssId\b|\bsrc\b|\bdst\b|\bid\b/.test(c);
});
t('все проверки получают ssId ('+calls.length+' вызовов)', bad.length===0, bad.slice(0,3).join(' | '));

// 4) Временный файл импорта проверяется по имени — чужой id не разберут и не удалят
t('есть проверка «наш ли это временный файл»', /_xlsIsTmp/.test(code));
t('удаление файла только после проверки', /_xlsDrop[\s\S]{0,120}_xlsIsTmp/.test(code));
t('разбор файла только после проверки', /if\s*\(!_xlsIsTmp\(tmp\)\)/.test(code));

// 5) Товары с одинаковым названием, но разными штрихкодами, не сливаются
t('одинаковые названия с разными ШК не сливаются', /это разные товары/.test(code));


// ── Аудит 4.68.0: три функции меняли данные без проверки прав ──
// Найдены сплошным обходом всех серверных функций, которые вызывает экран.
t('удаление таблицы магазина — только владелец',
  /okOwner = _isOwner\(SpreadsheetApp\.openById\(ssId\)\)/.test(code) &&
  /if \(!okOwner\) return \{ ok: true, removedFromList: true/.test(code));
t('заполнение табеля требует права «управление»',
  /_permGuard\(ssId,'manage'\)[\s\S]{0,120}Заполнять табель/.test(code));
t('копирование настроек проверяет ОБЕ таблицы',
  /_permGuard\(src,'manage'\)/.test(code) && /_permGuard\(dst,'manage'\)/.test(code));

console.log('\nПроверки прав: '+ok+' passed, '+fail+' failed');
process.exit(fail?1:0);

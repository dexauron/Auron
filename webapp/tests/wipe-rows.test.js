// Удаление строк при повторной загрузке отчёта.
//
// Повод — счёт на настоящих числах владельца. Повторная загрузка его
// файла удаляет 3 320 строк в БАЗЕ и 2 304 в ДОЛГАХ. Прежний код звал
// deleteRow на КАЖДУЮ: 5 624 обращения к таблице, а у Apps Script есть
// шесть минут на всё. Загрузка обрывалась бы на середине, оставляя
// половину старых строк и половину новых — то есть неверные деньги.
//
// Здесь проверяется не скорость, а две вещи: удаляются ровно нужные
// строки и вызовов получается мало.
var fs=require('fs'), path=require('path');
var code=fs.readFileSync(path.join(__dirname,'..','Code.gs'),'utf8');
var ok=0,fail=0;
function t(n,c,x){if(c){ok++;console.log('  ✓ '+n);}else{fail++;console.log('  ✗ '+n+(x!==undefined?' → '+JSON.stringify(x):''));}}

function grab(n){var i=code.indexOf('function '+n+'(');if(i<0)throw new Error('нет '+n);
  var d=0,j=code.indexOf('{',i);
  for(var k=j;k<code.length;k++){if(code[k]==='{')d++;else if(code[k]==='}'){d--;if(!d){j=k+1;break;}}}
  return code.slice(i,j);}
eval(grab('_killRows'));

// Считаем вызовы deleteRows.
function calls(rows){var out=[];_killRows({deleteRows:function(a,b){out.push([a,b]);}},rows.slice());return out;}
// Настоящее удаление: что осталось от листа в n строк.
function left(n,rows){var arr=[];for(var i=1;i<=n;i++)arr.push(i);
  calls(rows).forEach(function(c){arr.splice(arr.indexOf(c[0]),c[1]);});return arr;}
function eq(a,b){return JSON.stringify(a)===JSON.stringify(b);}

t('сплошной кусок — один вызов', eq(calls([5,6,7,8]),[[5,4]]), calls([5,6,7,8]));
t('два куска — два вызова', eq(calls([2,3,10,11,12]),[[10,3],[2,2]]), calls([2,3,10,11,12]));
t('одна строка', eq(calls([7]),[[7,1]]));
t('пустой список — ни одного вызова', eq(calls([]),[]));
t('номера вразнобой сортируются', eq(calls([12,2,11,3,10]),[[10,3],[2,2]]));

// Главное: удаляются ИМЕННО те строки. Удалять надо снизу вверх, иначе
// после первого же удаления номера оставшихся уезжают.
t('удалены ровно указанные (сплошняк)', eq(left(10,[3,4,5]),[1,2,6,7,8,9,10]), left(10,[3,4,5]));
t('удалены ровно указанные (два куска)', eq(left(10,[2,3,7,8]),[1,4,5,6,9,10]), left(10,[2,3,7,8]));
t('удалены ровно указанные (вразнобой)', eq(left(10,[9,1,5]),[2,3,4,6,7,8,10]), left(10,[9,1,5]));
t('удалена последняя строка', eq(left(5,[5]),[1,2,3,4]));
t('удалены все строки', eq(left(4,[1,2,3,4]),[]));

// Объём на числах владельца: строки загрузки лежат подряд.
var big=[]; for(var i=2;i<=3321;i++) big.push(i);
t('3 320 подряд идущих строк — один вызов вместо 3 320', calls(big).length===1, calls(big).length);
t('после удаления не осталось ни одной из них', eq(left(3321,big),[1]));

// ── Google не даёт удалить ВСЕ незакреплённые строки ────────────────
// Владелец увидел «Невозможно удалить все незакреплённые строки»: при
// повторной загрузке все строки БАЗЫ — с прошлой загрузки, и кроме
// закреплённой шапки не остаётся ничего. Значит перед удалением надо
// добавить снизу пустых строк, чтобы листу было чем остаться.
function withGrid(maxRows, frozen, rows){
  var ins=[], del=[];
  var sh={ getMaxRows:function(){return maxRows;},
           getFrozenRows:function(){return frozen;},
           insertRowsAfter:function(a,n){ins.push([a,n]);maxRows+=n;},
           deleteRows:function(a,n){del.push([a,n]);} };
  _killRows(sh, rows.slice());
  return {ins:ins, del:del, left:maxRows-frozen-rows.length};
}
// Лист ровно из шапки и данных: удаляем всё, что не шапка.
var full=[]; for(var q=2;q<=3321;q++) full.push(q);
var g1=withGrid(3321,1,full);
t('удаление всех строк добавляет запас снизу', g1.ins.length===1, g1.ins);
t('после удаления остаётся хотя бы одна строка', g1.left>=1, g1.left);
t('сами строки всё равно удаляются одним куском', g1.del.length===1, g1.del);
// Если запас уже есть — ничего не добавляем.
var g2=withGrid(5000,1,full);
t('когда место есть, лишние строки не добавляются', g2.ins.length===0, g2.ins);
// Лист без закреплённой шапки.
var g3=withGrid(10,0,[1,2,3,4,5,6,7,8,9,10]);
t('лист без шапки тоже не остаётся пустым', g3.ins.length===1 && g3.left>=1, g3);

// ── Записать больше строк, чем есть в сетке листа, нельзя ───────────
// После чистки лист ужимается, а записать надо 3 320 строк. Без запаса
// приходит «диапазон выходит за границы» и загрузка обрывается.
eval(grab('_ensureRows'));
function grid(maxRows){var ins=[];return {sh:{getMaxRows:function(){return maxRows;},
  insertRowsAfter:function(a,n){ins.push([a,n]);maxRows+=n;}},ins:ins,
  size:function(){return maxRows;}};}
var e1=grid(2); _ensureRows(e1.sh,2,3320);
t('места не хватало — сетка выросла', e1.size()>=3321, e1.size());
t('выросла ровно на нужное, не больше', e1.size()===3321, e1.size());
var e2=grid(5000); _ensureRows(e2.sh,2,3320);
t('места хватало — сетка не трогается', e2.ins.length===0);
var e3=grid(100); _ensureRows(e3.sh,101,1);
t('запись сразу за краем добавляет одну строку', e3.size()===101, e3.size());

// Все массовые записи защищены — иначе на пустом магазине или после
// чистки импорт из 1С упрётся в ту же стену.
['base, sr, out.length','sh, 2, data.length','ph, pr, hist.length',
 'rh, rr, rhist.length','base, sr, baseRows.length','base, br, all.length',
 'dsh, dr, allDebts.length'].forEach(function(call){
  t('защищена запись: '+call, code.indexOf('_ensureRows('+call+')')>0);
});

// Защита от возврата к построчному удалению.
// Одиночные удаления (одна запись по её номеру) — это нормально.
// Ловим именно ЦИКЛЫ, которые удаляют строку за строкой.
var loops = (code.match(/for\s*\([^)]*\)\s*\{[^{}]*deleteRow\(/g)||[])
  .concat(code.match(/forEach\([^)]*\)\s*\{[^{}]*deleteRow\(/g)||[]);
t('нет циклов, удаляющих строки по одной ('+loops.length+' найдено)',
  loops.length===0, loops.map(function(x){return x.slice(0,60);}));
t('_ddsWipe пользуется кусками', /_killRows\(sh, kill\)/.test(code));
t('чистка корзины пользуется кусками', /_killRows\(sh, kill\);\n    return \{ ok:true, removed:kill\.length \}/.test(code));
t('восстановление из корзины пользуется кусками',
  /_killRows\(trash, restore\.map/.test(code));

console.log('\nУдаление строк: '+ok+' passed, '+fail+' failed');
process.exit(fail?1:0);

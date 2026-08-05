// Каждая кнопка должна вести к существующей функции — на экране и на сервере.
// Опечатка в имени = кнопка молча ничего не делает, и заметит это владелец,
// а не я. Проверка быстрая, поэтому идёт в общий прогон перед пушем.
// Живое прокликивание — отдельным инструментом:
//   node .claude/skills/look/scripts/gas.js webapp/Index.html /tmp/click.html webapp/tests/fixtures/ui-stub.json
//   node .claude/skills/look/scripts/clickall.js /tmp/click.html
var fs=require('fs'), path=require('path');
var html=fs.readFileSync(path.join(__dirname,'..','Index.html'),'utf8');
var code=fs.readFileSync(path.join(__dirname,'..','Code.gs'),'utf8');
var ok=0,fail=0;
function t(n,c,x){if(c){ok++;console.log('  ✓ '+n);}else{fail++;console.log('  ✗ '+n+(x?' → '+x:''));}}

// ── Что вызывается с экрана ──────────────────────────────────────────
var defs={}, m;
var dre=/^\s{2}([A-Za-z_$][A-Za-z0-9_$]*)\s*:\s*(async\s+)?function/gm;
while((m=dre.exec(html))) defs[m[1]]=1;
// часть методов назначается на ходу: App._calcify=function(){...}
var dre2=/App\.([A-Za-z_$][A-Za-z0-9_$]*)\s*=\s*(async\s+)?function/g;
while((m=dre2.exec(html))) defs[m[1]]=1;

var calls={};
var cre=/App\.([A-Za-z_$][A-Za-z0-9_$]*)\s*\(/g;
while((m=cre.exec(html))) calls[m[1]]=1;
var missing=Object.keys(calls).filter(function(k){return !defs[k];});
t('все вызовы App.* ведут к существующей функции ('+Object.keys(calls).length+' шт)',
  missing.length===0, missing.join(', '));

// ── Кнопки: onclick без функции ──────────────────────────────────────
var onclicks=[];
var ore=/onclick="([^"]*)"/g;
while((m=ore.exec(html))) onclicks.push(m[1]);
t('кнопок с действием в разметке больше двухсот', onclicks.length>200, onclicks.length);
var badBtn=[];
onclicks.forEach(function(src){
  var r=/App\.([A-Za-z_$][A-Za-z0-9_$]*)\s*\(/g, mm;
  while((mm=r.exec(src))) if(!defs[mm[1]]) badBtn.push(mm[1]+' в «'+src.slice(0,40)+'»');
});
t('ни одна кнопка не зовёт несуществующее', badBtn.length===0, badBtn.slice(0,5).join('; '));
// Кнопка вообще без действия — тоже плохо: нажал, ничего не произошло.
t('нет кнопок с пустым onclick',
  onclicks.filter(function(s){return !s.trim();}).length===0);

// ── Серверные вызовы ─────────────────────────────────────────────────
var sdef={};
var sre=/^function\s+([A-Za-z_$][A-Za-z0-9_$]*)\s*\(/gm;
while((m=sre.exec(code))) sdef[m[1]]=1;
var scalls={};
var gre=/gs\(\s*'([A-Za-z_$][A-Za-z0-9_$]*)'/g;
while((m=gre.exec(html))) scalls[m[1]]=1;
var smiss=Object.keys(scalls).filter(function(k){return !sdef[k];});
t('все серверные вызовы существуют ('+Object.keys(scalls).length+' шт)',
  smiss.length===0, smiss.join(', '));

// ── Ответ сервера может оказаться не списком ─────────────────────────
// При отказе в правах приходит объект с ошибкой. Раньше на нём падал
// .filter, и экран замирал недорисованным — «зависло» вместо «нет доступа».
t('есть страховка на список', /_list:function/.test(html));
t('страховка понимает и голый список, и {items:[]}',
  /if\(Array\.isArray\(v\)\)return v;[\s\S]{0,120}v\.items/.test(html));
t('главный экран через страховку', /App\.s\.accounts=App\._list\(allAcc\)/.test(html));
t('список операций через страховку', /App\.renderTxList\(App\._list\(r\.transactions\)/.test(html));

// ── Заглушка для живого прогона ──────────────────────────────────────
var fix=JSON.parse(fs.readFileSync(path.join(__dirname,'fixtures','ui-stub.json'),'utf8'));
t('заглушка покрывает главный экран',
  Array.isArray(fix.getAccountsAll) && !!fix.getHomeSummary);
var need=['getSettings','getAccounts','getAccountsAll','getHomeSummary','getAllTransactions',
          'getTeamAll','getNetworkSummary','getTrash','getProductDetail'];
var lack=need.filter(function(k){return !(k in fix);});
t('в заглушке есть все ключевые экраны', lack.length===0, lack.join(', '));
t('формы ответов совпадают с сервером: выплаты — список',
  Array.isArray(fix.getPayments) && /function getPayments[\s\S]{0,4000}catch\(e\) \{ return \[\]; \}/.test(code));

console.log('\nКнопки и вызовы: '+ok+' passed, '+fail+' failed');
process.exit(fail?1:0);

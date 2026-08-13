// Средние показатели.
//
// Владелец: «добавь средние показатели везде по всем пунктам».
//
// Главное решение: делим на дни С ЗАПИСЯМИ, а не на календарные дни
// периода. Магазин заполняется не каждый день — в июле у владельца
// записан 31 день, но в другом месяце может быть 22, и деление на 31
// занизило бы всё на треть. Среднее, которое врёт вниз, хуже, чем
// отсутствие среднего: по нему принимают решения о закупе.
var fs=require('fs'), path=require('path');
var code=fs.readFileSync(path.join(__dirname,'..','Code.gs'),'utf8');
var html=fs.readFileSync(path.join(__dirname,'..','Index.html'),'utf8');
var ok=0,fail=0;
function t(n,c,x){if(c){ok++;console.log('  ✓ '+n);}else{fail++;console.log('  ✗ '+n+(x!==undefined?' → '+JSON.stringify(x):''));}}

// ── Считаем так же, как приложение ──────────────────────────────────
function avgByActiveDays(total, days){ return days?Math.round(total/days):0; }
t('среднее по дням с записями, а не по календарю',
  avgByActiveDays(1300000,22)===59091, avgByActiveDays(1300000,22));
t('ноль дней не делит на ноль', avgByActiveDays(1000,0)===0);
t('июль владельца: торговля 13 207 164 за 31 день = 426 038',
  avgByActiveDays(13207164,31)===426038, avgByActiveDays(13207164,31));
t('прибыль по факту 2 526 294 за 31 день = 81 493',
  avgByActiveDays(2526294,31)===81493, avgByActiveDays(2526294,31));
t('отрицательное среднее остаётся отрицательным',
  avgByActiveDays(-62000,31)===-2000, avgByActiveDays(-62000,31));

// ── Месяц: средние по всем показателям ──────────────────────────────
var mon=code.slice(code.indexOf('function getMonthDDS('),
                   code.indexOf('function getMonthDDS(')+4000);
t('в месяце считаются средние', /tot\.avg = \{\};/.test(mon));
t('делится на дни с записями, а не на 30',
  /var dn = out\.length \|\| 1;/.test(mon));
['trade','cashRev','onlineRev','profitPlan','profitFact','forBuy','spentOnBuy',
 'iman','writeOff'].forEach(function(k){
  t('среднее считается для «'+k+'»', mon.indexOf("'"+k+"'")>0);
});

// ── Аналитика: средние за день и по каждой статье ───────────────────
t('в аналитике есть среднее за день', /var avg = \{ days: actDays,/.test(code));
t('дни считаются только те, где были деньги',
  /return dayMap\[k\]\.income \|\| dayMap\[k\]\.expense; \}\)\.length;/.test(code));
t('по статье считается среднее за день', /avgDay: dn\?Math\.round\(c\.total\/dn\):0/.test(code));
t('по статье считается среднее за одну запись', /avgOne: c\.n\?Math\.round\(c\.total\/c\.n\):0/.test(code));
t('у статьи хранятся свои дни, а не общие', /catMap\[cat\]\.days\[dk\]=1/.test(code));

// ── Экраны показывают ───────────────────────────────────────────────
t('в таблице месяца есть строка средних', html.indexOf('В среднем за день')>0);
t('строка средних отличается от итога', /tfoot tr\.ddm-avg td\{/.test(html));
t('долг в средних не усредняется (это остаток)',
  /n\(av\.profitFact\)\+'<\/td><td>—<\/td>'/.test(html));
t('карточка «В среднем за день» есть', html.indexOf('<h4>В среднем за день</h4>')>0);
t('объясняется, по скольким дням считали',
  html.indexOf('с записями, а не по всем дням месяца')>0);
t('в окне выручки/расходов есть среднее', /В среднем <b>'\+fmt\(avV/.test(html));
t('у каждой статьи показано ₽/день', html.indexOf("' ₽/день'")>0);
t('и сумма за одну запись', html.indexOf("' ₽ за раз ('")>0);

console.log('\nСредние показатели: '+ok+' passed, '+fail+' failed');
process.exit(fail?1:0);

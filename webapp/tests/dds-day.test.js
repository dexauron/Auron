// Модель дня из отчёта ДДС владельца.
// Проверяем НЕ на удобных примерах, а на его настоящих числах за первые
// дни июля 2026. Если правка сломает формулу — тест покраснеет здесь,
// а не через месяц в магазине.
var fs=require('fs'), path=require('path');
var code=fs.readFileSync(path.join(__dirname,'..','Code.gs'),'utf8');
var ok=0,fail=0;
function t(n,c,x){if(c){ok++;console.log('  ✓ '+n);}else{fail++;console.log('  ✗ '+n+(x?' → '+x:''));}}
function near(a,b,eps){return Math.abs(a-b)<=(eps===undefined?1:eps);}

// Берём НАСТОЯЩУЮ функцию расчёта из приложения, а не переписываем её тут.
function grab(name){
  var i=code.indexOf('function '+name+'(');
  if(i<0) throw new Error('нет функции '+name);
  var d=0,j=code.indexOf('{',i);
  for(var k=j;k<code.length;k++){ if(code[k]==='{')d++; else if(code[k]==='}'){d--; if(!d){j=k+1;break;}} }
  return code.slice(i,j);
}
eval(grab('_ddsCompute'));

// Пустая заготовка сумм дня
function box(o){
  var b={cashRev:0,onlineRev:0,iman:0,transfer:0,cashOut:0,buyCash:0,payDebt:0,
         buyDebt:0,writeOff:0,bank:0,meal:0,fuel:0,supplies:0,salary:0,rent:0,
         utils:0,tax:0,other:0,count:0,debtUp:0,debtDown:0};
  for(var k in o) b[k]=o[k];
  // Закуп в долг живёт на листе ДОЛГИ: он растит долг, а не тратит деньги.
  if (o && o.buyDebt && !o.debtUp) b.debtUp=o.buyDebt;
  return b;
}

// ── Настоящие дни из файла владельца ─────────────────────────────────
// Постоянные расходы у него размазаны на каждый день ровными долями:
// зарплата 23 800, аренда 12 200, коммунальные 3 000, налог 3 000.
var FIX={salary:23800,rent:12200,utils:3000,tax:3000};

var DAYS=[
  { d:'01.07', in:{cashRev:136232+97545, onlineRev:73068+60953, iman:3334,
      writeOff:75, bank:3116, meal:1381, supplies:12368},
    trade:367798, gross:91950, profit:29676, cashLeft:132898 },
  { d:'02.07', in:{cashRev:188760+101555, onlineRev:64989+73032, iman:2986,
      writeOff:297, bank:2866, meal:692, supplies:91},
    trade:428336, gross:107084, profit:58152, cashLeft:185774 },
  { d:'03.07', in:{cashRev:180237+99780, onlineRev:91350+87523, iman:6448,
      writeOff:360, bank:7429, meal:718, supplies:1830},
    trade:458890, gross:114722, profit:55938, cashLeft:173789 },
  { d:'04.07', in:{cashRev:167826+150380, onlineRev:112156+16507, iman:1275,
      writeOff:746, bank:3517, meal:654},
    trade:446869, gross:111717, profit:63525, cashLeft:166551 },
  { d:'05.07', in:{cashRev:166796+82780, onlineRev:87408+87400, iman:6020,
      writeOff:0, bank:3211, meal:691},
    trade:424384, gross:106096, profit:54174, cashLeft:160776 }
];

DAYS.forEach(function(x){
  var b=box(x.in); for(var k in FIX) b[k]=FIX[k];
  // Наличка считается по ДНЕВНОЙ смене, а не по суткам целиком.
  var day=box(x.in); for(var k2 in FIX) day[k2]=FIX[k2];
  var r=_ddsCompute(b, 0.25, 0);
  t(x.d+' общая торговля '+x.trade,      near(r.trade,x.trade),  r.trade);
  t(x.d+' валовая 25% '+x.gross,          near(r.gross,x.gross,1), r.gross);
  t(x.d+' прибыль по плану '+x.profit,    near(r.profitPlan,x.profit,1), r.profitPlan);
});

// ── Смысловые свойства модели ────────────────────────────────────────
var b=box({cashRev:100000,onlineRev:50000,cashOut:0,iman:5000,transfer:20000});
var r=_ddsCompute(b,0.25,0);
t('расхождение кассы по построению ноль', r.cashDiff===0, r.cashDiff);
t('наличка = выручка − изъятия − перевод', r.cashLeft===100000-5000-20000, r.cashLeft);

// Закуп в долг НЕ уменьшает деньги: товар взяли в долг, касса не тронута.
var a1=_ddsCompute(box({cashRev:100000}),0.25,0);
var a2=_ddsCompute(box({cashRev:100000,buyDebt:70000}),0.25,0);
t('закуп в долг не трогает прибыль по факту', a1.profitFact===a2.profitFact,
  a1.profitFact+' vs '+a2.profitFact);
t('закуп в долг увеличивает долг поставщикам', a2.debt===70000, a2.debt);
// Смысл правила владельца: товар взяли, деньги не отдали. Значит ни
// прибыль, ни касса от закупа в долг двинуться не должны. Раньше он
// писался расходом наличными, и «Общий капитал» уходил в минус на 47,9 млн.
var a2b=_ddsCompute(box({cashRev:100000}),0.25,0);
t('закуп в долг НЕ уменьшает прибыль по факту', a2.profitFact===a2b.profitFact,
  a2.profitFact+' vs '+a2b.profitFact);
t('закуп в долг НЕ уменьшает остаток кассы', a2.cashLeft===a2b.cashLeft);
// Постоянные расходы: в листе ДДС это ПЛАН на месяц, а выплачивают
// другое. Прибыль «по плану» считается по плану, «по факту» — по тому,
// что реально выплачено. За июль владельца: план 23 800 в день,
// выплачено меньше — прибыль по факту должна быть ВЫШЕ плановой.
var pl=_ddsCompute(box({cashRev:200000,salary:10000}),0.25,0,23800);
t('план постоянных расходов ушёл в прибыль по плану', pl.fixedPlan===23800, pl.fixedPlan);
t('факт постоянных расходов — настоящая выплата', pl.fixedFact===10000, pl.fixedFact);
t('прибыль по плану считается по плану',
  pl.profitPlan===Math.round(200000*0.25-23800), pl.profitPlan);
t('прибыль по факту считается по выплаченному',
  pl.profitFact===200000-10000, pl.profitFact);
// Без плана расчёт не должен обнуляться: берём факт.
var pn=_ddsCompute(box({cashRev:200000,salary:10000}),0.25,0);
t('без плана берётся факт', pn.fixedPlan===10000 && pn.profitPlan===Math.round(200000*0.25-10000));

// Оплата долга — обратный случай: деньги действительно уходят.
var a2c=_ddsCompute(box({cashRev:100000,payDebt:70000,debtDown:70000}),0.25,70000);
t('оплата долга уменьшает долг до нуля', a2c.debt===0, a2c.debt);
t('оплата долга уменьшает прибыль по факту', a2c.profitFact===a2b.profitFact-70000);
t('выплата долга уменьшает долг',
  _ddsCompute(box({payDebt:30000}),0.25,100000).debt===70000);

// Две прибыли расходятся, когда настоящая наценка не равна плановой.
// Закуп 110 000 при выручке 100 000: по плану 25 000 прибыли,
// по факту минус 10 000. Первый вариант этого теста был неверен —
// я взял закуп 90 000, при котором убытка и не должно быть.
var real=_ddsCompute(box({cashRev:100000,buyCash:110000}),0.25,0);
t('по плану прибыль есть, по факту убыток — видно обе',
  real.profitPlan>0 && real.profitFact<0, real.profitPlan+' / '+real.profitFact);
t('разница прибылей посчитана', real.profitGap===real.profitFact-real.profitPlan);

// Ставка берётся из настроек, а не зашита намертво
t('ставка валовой прибыли настраивается', /DDS_RATE/.test(code));
t('по умолчанию 25%', /\? 0\.25 :/.test(code) || /: 0\.25/.test(code));

// ── Кривые данные не должны валить расчёт ────────────────────────────
var zero=_ddsCompute(box({}),0.25,0,0);
t('пустой день не даёт NaN', Object.keys(zero).every(function(k){
  return typeof zero[k]!=='number'||isFinite(zero[k]);}), JSON.stringify(zero));
var over=_ddsCompute(box({debtDown:5000}),0.25,1000,0);
t('переплата долга даёт минус, а не мусор', over.debt===-4000, over.debt);
t('ставка 0 не роняет', isFinite(_ddsCompute(box({cashRev:1000}),0,0,0).gross));

console.log('\nМодель дня (ДДС): '+ok+' passed, '+fail+' failed');
process.exit(fail?1:0);

// Итог «плюс-минус»: Выручка − Себестоимость − Расходы − Потери − Нужды + Возвраты
// Ловим: двойной вычет закупки, путаницу «нужды магазина» ≠ «потеря»,
// возвраты должны ПЛЮСовать, себестоимость не может быть отрицательной.
var LOSS_REASONS=[
  ['Нужды магазина','',true],['Просрочка','',false],['Брак','',false],
  ['Порча','',false],['Недостача','',false]
];
function isNeeds(r){for(var i=0;i<LOSS_REASONS.length;i++)if(LOSS_REASONS[i][0]===r)return !!LOSS_REASONS[i][2];return false;}

// Копия расчёта из getBottomLine
function calc(ops, goods, losses){
  var revenue=0, expense=0;
  ops.forEach(function(o){
    if(o.cat==='Перевод')return;
    if(o.type==='Доход')revenue+=o.amt;
    else if(o.type==='Расход'){ if(o.cat==='Закупка')return; expense+=o.amt; }
  });
  var gRev=0,gProf=0;
  goods.forEach(function(g){gRev+=g.revenue;gProf+=g.profit;});
  var cogs=Math.max(gRev-gProf,0);
  var loss=0,needs=0,ret=0;
  losses.forEach(function(l){
    if(l.kind==='return'){ret+=l.amt;return;}
    if(isNeeds(l.reason))needs+=l.amt; else loss+=l.amt;
  });
  var revUsed=revenue>0?revenue:gRev;
  return {total:revUsed-cogs-expense-loss-needs+ret,
          revenue:revUsed,cogs:cogs,expense:expense,losses:loss,needs:needs,returns:ret};
}
var ok=0,fail=0;
function t(n,c,extra){if(c){ok++;console.log('  ✓ '+n);}else{fail++;console.log('  ✗ '+n+(extra?' → '+extra:''));}}

// 1) базовый расчёт
var r=calc(
  [{type:'Доход',cat:'Продажи',amt:100000},{type:'Расход',cat:'Аренда',amt:20000}],
  [{revenue:100000,profit:30000}],   // себестоимость = 70000
  [{kind:'writeoff',reason:'Просрочка',amt:3000}]);
t('себестоимость из 1С', r.cogs===70000);
t('итог = 100000-70000-20000-3000 = 7000', r.total===7000, r.total);

// 2) закупка НЕ вычитается второй раз
r=calc(
  [{type:'Доход',cat:'Продажи',amt:100000},{type:'Расход',cat:'Закупка',amt:70000}],
  [{revenue:100000,profit:30000}], []);
t('закупка не вычтена дважды', r.expense===0&&r.total===30000, 'расходы='+r.expense+' итог='+r.total);

// 3) нужды магазина ≠ потеря, но тоже минус
r=calc([{type:'Доход',cat:'Продажи',amt:50000}],[],
  [{kind:'writeoff',reason:'Нужды магазина',amt:2000},
   {kind:'writeoff',reason:'Брак',amt:1000}]);
t('нужды отдельно от потерь', r.needs===2000&&r.losses===1000);
t('и нужды, и потери в минус', r.total===50000-2000-1000, r.total);

// 4) возврат поставщику — в плюс
r=calc([{type:'Доход',cat:'Продажи',amt:10000}],[],
  [{kind:'writeoff',reason:'Брак',amt:3000},{kind:'return',amt:3000}]);
t('возврат компенсирует брак', r.total===10000, r.total);
t('возврат учтён отдельно', r.returns===3000);

// 5) переводы между счетами не влияют
r=calc([{type:'Доход',cat:'Продажи',amt:5000},
        {type:'Доход',cat:'Перевод',amt:99999},{type:'Расход',cat:'Перевод',amt:99999}],[],[]);
t('переводы не влияют на итог', r.total===5000, r.total);

// 6) себестоимость не отрицательная (прибыль > выручки в данных 1С)
r=calc([],[{revenue:100,profit:500}],[]);
t('себестоимость не уходит в минус', r.cogs===0);

// 7) нет операций — выручка берётся из 1С
r=calc([],[{revenue:80000,profit:20000}],[]);
t('выручка из 1С, если операций нет', r.revenue===80000&&r.total===20000, r.total);

// 8) пустой период не падает
r=calc([],[],[]);
t('пусто = ноль, без ошибок', r.total===0);

// 9) убыток показывается минусом
r=calc([{type:'Доход',cat:'Продажи',amt:10000},{type:'Расход',cat:'Аренда',amt:25000}],[],[]);
t('убыток отрицательный', r.total===-15000, r.total);

console.log('\nИтог «плюс-минус»: '+ok+' passed, '+fail+' failed');
process.exit(fail?1:0);

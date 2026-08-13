// Выплата поставщику должна гасить ДОЛГ, а не только тратить деньги.
//
// Повод — владелец: «когда я выплачиваю по записи, с общего долга сумма
// не списывается». Так и было: запись о выплате жила в своём листе,
// создавала расход по счёту и книги долгов не касалась. «Общий долг»
// стоял на месте, хотя поставщику уже заплатили.
var fs=require('fs'), path=require('path');
var code=fs.readFileSync(path.join(__dirname,'..','Code.gs'),'utf8');
var ok=0,fail=0;
function t(n,c,x){if(c){ok++;console.log('  ✓ '+n);}else{fail++;console.log('  ✗ '+n+(x!==undefined?' → '+JSON.stringify(x):''));}}
function grab(n){var i=code.indexOf('function '+n+'(');if(i<0)throw new Error('нет '+n);
  var d=0,j=code.indexOf('{',i);
  for(var k=j;k<code.length;k++){if(code[k]==='{')d++;else if(code[k]==='}'){d--;if(!d){j=k+1;break;}}}
  return code.slice(i,j);}

var D_ID=1,D_REP=2,D_TYPE=3,D_AMT=4,D_DATE=5,D_ACC=6,D_CMT=7,D_COLS=10;
var SH_DEBTS='ДОЛГИ';
global.Utilities={getUuid:function(){return 'u'+Math.random();}};
global._s=function(v){return String(v==null?'':v);};
eval(grab('_ensureRows')); eval(grab('_killRows'));
eval(grab('_payDebtLedger')); eval(grab('_unpayDebtLedger'));

// Простой лист ДОЛГИ
function ledger(){
  var rows=[['ID','Представитель','Тип','Сумма','Дата','Счёт','Комментарий','','','']];
  var maxRows=1000;
  var sh={ getLastRow:function(){return rows.length;}, getMaxRows:function(){return maxRows;},
    getFrozenRows:function(){return 1;},
    insertRowsAfter:function(a,n){maxRows+=n;},
    deleteRows:function(st,n){rows.splice(st-1,n);maxRows-=n;},
    getRange:function(r,c,nr,nc){nr=nr||1;nc=nc||1;return{
      getValues:function(){var o=[];for(var i=0;i<nr;i++){var src=rows[r-1+i]||[];var l=[];
        for(var j=0;j<nc;j++)l.push(src[c-1+j]!==undefined?src[c-1+j]:'');o.push(l);}return o;},
      setValues:function(v){for(var i=0;i<v.length;i++)rows[r-1+i]=v[i].slice();return this;},
      setNumberFormat:function(){return this;}};}
  };
  return { ss:{getSheetByName:function(){return sh;}}, rows:rows,
    total:function(){var s=0;for(var i=1;i<rows.length;i++){
      if(!rows[i]||!rows[i][D_AMT-1])continue;
      s+=(String(rows[i][D_TYPE-1])==='oplata'?-1:1)*rows[i][D_AMT-1];}return s;} };
}

// Долг 100 000 у поставщика «Малаев»
function withDebt(){
  var L=ledger();
  L.rows.push(['d1','Малаев','zakupka',100000,new Date(),'','Поставка','','','']);
  return L;
}

var L=withDebt();
t('начальный долг 100 000', L.total()===100000, L.total());

_payDebtLedger(L.ss,'p1','Малаев',30000,'частично');
t('выплата 30 000 уменьшила долг до 70 000', L.total()===70000, L.total());
t('строка погашения без счёта — деньги ею не списываются',
  L.rows[2][D_ACC-1]==='', L.rows[2][D_ACC-1]);
t('строка помечена номером записи', String(L.rows[2][D_CMT-1]).indexOf('PAY:p1')>0, L.rows[2][D_CMT-1]);
t('тип погашения — oplata', L.rows[2][D_TYPE-1]==='oplata');
t('поставщик сохранён', L.rows[2][D_REP-1]==='Малаев');

_payDebtLedger(L.ss,'p1','Малаев',70000,'');
t('вторая выплата догасила долг до нуля', L.total()===0, L.total());

// Отмена/удаление записи возвращает долг.
var n=_unpayDebtLedger(L.ss,'p1');
t('снято обе строки погашения', n===2, n);
t('долг вернулся к 100 000', L.total()===100000, L.total());

// Чужие погашения не трогаем.
var L2=withDebt();
_payDebtLedger(L2.ss,'p1','Малаев',10000,'');
_payDebtLedger(L2.ss,'p2','Малаев',20000,'');
_unpayDebtLedger(L2.ss,'p1');
t('снята только своя запись', L2.total()===80000, L2.total());
t('чужое погашение осталось',
  L2.rows.some(function(r){return String(r[D_CMT-1]).indexOf('PAY:p2')>0;}));

// Нулевые и кривые суммы не создают пустых строк.
var L3=withDebt(); var before=L3.rows.length;
_payDebtLedger(L3.ss,'p9','Малаев',0,'');
_payDebtLedger(L3.ss,'p9','Малаев','мусор','');
_payDebtLedger(L3.ss,'p9','Малаев',-500,'');
t('нулевая, текстовая и отрицательная сумма игнорируются',
  L3.rows.length===before, L3.rows.length-before);

// ── Общий долг — ЧИСТАЯ сумма, а не только должники ─────────────────
// Тут и была настоящая причина жалобы. Погашение пишется на того
// поставщика, кого выбрали в записи. Если за ним долга не числилось,
// его долг уходит в минус. Раньше такие минусы отбрасывались, и общий
// долг не двигался — «выплачиваю, а с общего не списывается».
function totalOld(list){return list.reduce(function(s,x){return s+Math.max(x.debt,0);},0);}
function totalNew(list){var v=list.reduce(function(s,x){return s+x.debt;},0);return v<0?0:v;}
var mixed=[{debt:4182653},{debt:-5000}];
t('по-старому выплата не уменьшала общий долг', totalOld(mixed)===4182653);
t('по-новому уменьшает', totalNew(mixed)===4177653, totalNew(mixed));
t('общий долг не уходит в минус', totalNew([{debt:-5000}])===0);
t('переплата одному гасит долг другому',
  totalNew([{debt:100000},{debt:-30000}])===70000);

// ── Записи на выплату сами по себе долг НЕ трогают ──────────────────
// Правило владельца: «записи не влияют на долг, если не было выплаты».
var save=grab('_savePaymentLocked');
t('создание записи не пишет в книгу долгов',
  save.indexOf('_payDebtLedger')<0 && save.indexOf('SH_DEBTS')<0);
t('создание записи не создаёт расход', save.indexOf('saveQuickEntry')<0);
t('долг считается только по листу ДОЛГИ',
  grab('getDebts').indexOf('SH_PAYMENTS')<0);
t('сводка поставщиков тоже только по ДОЛГАМ',
  grab('getSupplierAnalytics').indexOf('SH_PAYMENTS')<0);
t('общий долг считается чистой суммой',
  /return s\+x\.debt;/.test(code) && !/Math\.max\(x\.debt,0\)/.test(code));

// ── Деньги нельзя списать дважды ────────────────────────────────────
// Владелец увидел: записи на 105 000, а в расходах 200 000 двумя
// операциями. Причина — «Подтвердить оплату» списывало ВСЮ сумму
// записи заново, не глядя на уже оплаченное.
var mark=grab('_markPaymentPaidLocked');
t('«подтвердить оплату» списывает только остаток',
  /var rest=Math\.max\(total-already,0\);/.test(mark) &&
  /if \(account&&rest>0\)/.test(mark));
t('расход создаётся на остаток, а не на всю сумму',
  /amount:rest,/.test(mark));
t('если уже всё оплачено — расхода нет', /rest>0/.test(mark));
var upd=grab('_updatePaymentLocked');
t('частичная оплата не списывает больше остатка',
  /payAmt = Math\.min\(payAmt, Math\.max\(totalAmt-paidBefore, 0\)\);/.test(upd));

// Считаем на числах владельца: запись 100 000, оплатили её целиком,
// потом нажали «подтвердить» — из кассы должно уйти 100 000, не 200 000.
function payFlow(total, steps){
  var paid=0, spent=0;
  steps.forEach(function(st){
    if(st.kind==='pay'){ var amt=Math.min(st.amount, Math.max(total-paid,0));
      paid+=amt; spent+=amt; }
    else { var rest=Math.max(total-paid,0); paid=total; spent+=rest; }
  });
  return spent;
}
t('оплата 100 000 + подтверждение = 100 000, а не 200 000',
  payFlow(100000,[{kind:'pay',amount:100000},{kind:'mark'}])===100000,
  payFlow(100000,[{kind:'pay',amount:100000},{kind:'mark'}]));
t('две частичные по 50 000 = 100 000',
  payFlow(100000,[{kind:'pay',amount:50000},{kind:'pay',amount:50000}])===100000);
t('попытка заплатить больше суммы записи не проходит',
  payFlow(100000,[{kind:'pay',amount:500000}])===100000);
t('подтверждение дважды не списывает дважды',
  payFlow(100000,[{kind:'mark'},{kind:'mark'}])===100000);

// Один и тот же долг на двух экранах должен совпадать.
var h=require('fs').readFileSync(__dirname+'/../Index.html','utf8');
t('экран Поставщиков считает долг чистой суммой',
  /var dv=\(d\.debt\|\|0\);realDebt\+=dv;/.test(h));
t('на экране не осталось зажима минусов', !/Math\.max\(d\.debt\|\|0,0\)/.test(h));

// ── Проверки в самом приложении ─────────────────────────────────────
t('оплата записи гасит долг',
  /_payDebtLedger\(ss, id, String\(rowData\[PY_NAME-1\]\|\|''\), payAmt/.test(code));
t('«оплачено» целиком тоже гасит долг',
  /_payDebtLedger\(ss, String\(id\), String\(rowData\[PY_NAME-1\]\|\|''\)/.test(code));
t('отмена записи возвращает долг',
  /setValue\('cancelled'\);[\s\S]{0,120}_unpayDebtLedger/.test(code));
t('возврат записи в работу возвращает долг',
  /setValue\('open'\);[\s\S]{0,120}_unpayDebtLedger/.test(code));
t('удаление записи возвращает долг',
  /'удалил',''\);[\s\S]{0,180}_unpayDebtLedger/.test(code));
t('повторное «оплачено» не гасит дважды',
  /_unpayDebtLedger\(ss, String\(id\)\);\n\s*_payDebtLedger/.test(code));

console.log('\nВыплата гасит долг: '+ok+' passed, '+fail+' failed');
process.exit(fail?1:0);

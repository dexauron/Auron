// Смены из загруженного отчёта.
//
// Владелец: «почему программа не занесла смены из файла?». Занесла —
// пометка «День»/«Ночь» лежит в каждой операции, и экран «Касса → День»
// её показывал. Но он смотрел «Аналитика → Смены», а тот экран читает
// лист СМЕНЫ, который заполняется только когда смену открывают и
// закрывают в приложении. При полном отчёте экран стоял пустым.
var fs=require('fs'), path=require('path');
var code=fs.readFileSync(path.join(__dirname,'..','Code.gs'),'utf8');
var html=fs.readFileSync(path.join(__dirname,'..','Index.html'),'utf8');
var ok=0,fail=0;
function t(n,c,x){if(c){ok++;console.log('  ✓ '+n);}else{fail++;console.log('  ✗ '+n+(x!==undefined?' → '+JSON.stringify(x):''));}}
function grab(n){var i=code.indexOf('function '+n+'(');if(i<0)throw new Error('нет '+n);
  var d=0,j=code.indexOf('{',i);
  for(var k=j;k<code.length;k++){if(code[k]==='{')d++;else if(code[k]==='}'){d--;if(!d){j=k+1;break;}}}
  return code.slice(i,j);}

var B_COLS=13,B_DATE=3,B_TYPE=4,B_AMT=6,B_SHIFT=13,SH_BASE='БАЗА';
global.Utilities={formatDate:function(d){return d.toISOString().slice(0,10);}};
global._gnum=function(v){var n=parseFloat(v);return isNaN(n)?0:n;};
global._period=function(){return {from:null,to:null};};
eval(grab('_shiftsFromBase'));

function op(dateStr,type,amt,shift){
  var r=new Array(B_COLS).fill('');
  r[B_DATE-1]=new Date(dateStr+'T12:00:00'); r[B_TYPE-1]=type;
  r[B_AMT-1]=amt; r[B_SHIFT-1]=shift; return r;
}
function store(rows){
  return { getSheetByName:function(){ return {
    getLastRow:function(){return rows.length+1;},
    getRange:function(){return {getValues:function(){return rows;}};} };} };
}

// Настоящий вид данных владельца: на дату две строки, наличные и онлайн.
var rows=[
  op('2026-07-01','Доход',136232,'День'), op('2026-07-01','Доход',73068,'День'),
  op('2026-07-01','Доход',97545,'Ночь'), op('2026-07-01','Доход',60953,'Ночь'),
  op('2026-07-02','Доход',150000,'День'), op('2026-07-02','Доход',90000,'Ночь'),
  op('2026-07-02','Расход',50000,'День')      // расход в смену не идёт
];
var r=_shiftsFromBase(store(rows),'year','UTC');
var byName={}; r.byShift.forEach(function(s){byName[s.name]=s;});

t('смены собраны из операций', r.byShift.length===2, r.byShift.length);
t('дневная выручка 359 300', byName['День'].revenue===136232+73068+150000, byName['День'].revenue);
t('ночная выручка 248 498', byName['Ночь'].revenue===97545+60953+90000, byName['Ночь'].revenue);
t('расход в выручку смены не попал',
  byName['День'].revenue===359300, byName['День'].revenue);
// Главная тонкость: смена — это дата, а не строка. Иначе среднее
// поделится на число операций и выйдет вдвое меньше настоящего.
t('дневных смен 2, а не 3 операции', byName['День'].count===2, byName['День'].count);
t('ночных смен 2, а не 4 операции', byName['Ночь'].count===2, byName['Ночь'].count);
t('средняя дневная смена 179 650', byName['День'].avgRevenue===179650, byName['День'].avgRevenue);
t('средняя ночная смена 124 249', byName['Ночь'].avgRevenue===124249, byName['Ночь'].avgRevenue);
t('итог = сумма смен', r.total===byName['День'].revenue+byName['Ночь'].revenue, r.total);
t('по дням два дня', r.byDay.length===2, r.byDay.length);
t('помечено, что смены из отчёта', r.fromBase===true);
t('расхождения кассы нет — в файле его не ведут', r.totalDisc===0);

// Операции без пометки смены игнорируются.
var r2=_shiftsFromBase(store([op('2026-07-01','Доход',1000,'')]),'year','UTC');
t('операция без смены не создаёт смену', r2.byShift.length===0);
// Пустая база.
t('пустая база не роняет',
  _shiftsFromBase({getSheetByName:function(){return null;}},'year','UTC').byShift.length===0);

// ── Подключено к экранам ────────────────────────────────────────────
t('аналитика падает на операции, когда лист смен пуст',
  /return _shiftsFromBase\(ss, period, tz\);/.test(code));
t('в месяце копятся смены врозь', /tot\.shifts = tot\.shifts \|\|/.test(code));
t('средняя выручка смены — по дням этой смены',
  /x\.avgTrade = x\.days \? Math\.round\(x\.trade\/x\.days\) : 0;/.test(code));
t('столбцы День и Ночь в таблице месяца', /\['День',function\(d\)\{return shTrade\(d,'day'\)/.test(html));
t('столбцы прячутся, если смен нет', /var hasShifts=days\.some/.test(html));
t('карточка сравнения смен', html.indexOf('<h4>Дневная и ночная смены</h4>')>0);
t('в сравнении есть разница средних', html.indexOf('Разница средних')>0);
t('смена видна в каждой операции', /tx\.shift\?' · <span/.test(html));
t('сервер отдаёт смену в операции', /shift:String\(r\[B_SHIFT-1\]\|\|''\)/.test(code));
t('пустой экран смен подсказывает про отчёт',
  html.indexOf('смены возьмутся из него')>0);

console.log('\nСмены: '+ok+' passed, '+fail+' failed');
process.exit(fail?1:0);

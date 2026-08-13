// Сквозной прогон загрузки отчёта на НАСТОЯЩЕМ файле владельца
// (июль 2026) через имитацию листов Google — с теми же ограничениями,
// на которых загрузка у него и обрывалась:
//   · нельзя удалить ВСЕ незакреплённые строки листа;
//   · нельзя писать за пределы сетки листа.
//
// Проверяем главное: три загрузки подряд дают одно и то же, ничего не
// удваивается, и общий долг сходится с его собственной колонкой
// «ДОЛГ ПОСТАВЩИКАМ» — 4 182 653 ₽.
// Сквозной прогон загрузки на НАСТОЯЩЕМ файле владельца с имитацией
// листов Google — включая ограничения, на которых он и споткнулся.
var fs=require('fs'),code=fs.readFileSync(require('path').join(__dirname,'..','Code.gs'),'utf8');
function grab(n){var i=code.indexOf('function '+n+'(');var d=0,j=code.indexOf('{',i);
 for(var k=j;k<code.length;k++){if(code[k]==='{')d++;else if(code[k]==='}'){d--;if(!d){j=k+1;break;}}}return code.slice(i,j);}
function gv(n){var i=code.indexOf('var '+n+' = [');var j=code.indexOf('\n];',i);return code.slice(i,j+3);}
global.Utilities={getUuid:function(){return 'u'+(Math.random());},
  formatDate:function(d){return d.toISOString().slice(0,10);}};

// Лист с настоящими ограничениями Google.
function Sheet(name,cols,frozen){
  var rows=[]; var maxRows=1000; var self={
    _name:name, _rows:rows,
    getName:function(){return name;},
    getFrozenRows:function(){return frozen||0;},
    getMaxRows:function(){return maxRows;},
    getLastRow:function(){var last=0;for(var i=0;i<rows.length;i++)
      if(rows[i]&&rows[i].some(function(x){return x!==''&&x!==null&&x!==undefined;}))last=i+1;return last;},
    getLastColumn:function(){return cols;},
    insertRowsAfter:function(after,n){ if(n<=0) throw new Error('insertRowsAfter: n<=0'); maxRows+=n; },
    deleteRows:function(start,n){
      if(start<=(frozen||0)) throw new Error('нельзя удалять закреплённые');
      if(maxRows-(frozen||0)-n<1) throw new Error('Невозможно удалить все незакрепленные строки.');
      rows.splice(start-1,n); maxRows-=n;
    },
    getRange:function(r,c,nr,nc){
      nr=nr||1;nc=nc||1;
      if(r+nr-1>maxRows) throw new Error('Диапазон выходит за границы листа ('+(r+nr-1)+' > '+maxRows+')');
      return { getValues:function(){var o=[];for(var i=0;i<nr;i++){var src=rows[r-1+i]||[];var line=[];
                 for(var j=0;j<nc;j++)line.push(src[c-1+j]!==undefined?src[c-1+j]:'');o.push(line);}return o;},
        setValues:function(v){for(var i=0;i<v.length;i++){rows[r-1+i]=rows[r-1+i]||[];
                 for(var j=0;j<v[i].length;j++)rows[r-1+i][c-1+j]=v[i][j];}return this;},
        setNumberFormat:function(){return this;}, setValue:function(){return this;} };
    }
  };
  return self;
}
var SH_BASE='БАЗА',SH_DEBTS='ДОЛГИ',B_COLS=13,D_COLS=10,B_DATE=3,B_CAT=5,B_AMT=6,B_ZREF=11,B_SHIFT=13;
var D_ID=1,D_REP=2,D_TYPE=3,D_AMT=4,D_DATE=5,D_ACC=6,D_CMT=7;
var base=Sheet('БАЗА',B_COLS,1), debts=Sheet('ДОЛГИ',D_COLS,1);
base.getRange(1,1,1,B_COLS).setValues([['ID','UUID','Дата','Тип','Категория','Сумма','Счёт','','Комментарий','','Z_Ref','','Смена']]);
debts.getRange(1,1,1,D_COLS).setValues([['ID','Представитель','Тип','Сумма','Дата','Счёт','Комментарий','Создано','Накладная','Статус']]);
var settings={};
var ss={ getId:function(){return 'SS';},
  getSheetByName:function(n){return n===SH_BASE?base:(n===SH_DEBTS?debts:null);} };
global._withLock=function(f){return f();};
global._setSetting=function(s,k,v){settings[k]=v;};
global._getSettingStr=function(s,k,d){return settings[k]!==undefined?settings[k]:d;};
global._log=function(){}; global._bustDash=function(){}; global._ddsCacheBust=function(){};
global._gnum=function(v){var n=parseFloat(String(v).replace(/\s/g,'').replace(',','.'));return isNaN(n)?0:n;};
eval(gv('DDS_COLS'));eval(gv('OPL_COLS'));eval(gv('DDS_DEBT_COLS'));eval(gv('DDS_PLAN_COLS'));
var DDS_DEBT_REP='Поставщики (из отчёта)',DDS_DEBT_LEFT_COL='долг поставщик';
eval(grab('_xlsNum'));eval(grab('_ddsDateKey'));eval(grab('_ddsSheetToOps'));
eval(grab('_ddsFindSheet'));eval(grab('_ensureRows'));eval(grab('_killRows'));
eval(grab('_ddsWipe'));eval(grab('_ddsWipeDebts'));
// Месячный итог: в этом прогоне листа «Отчёт мес» нет, но функции
// должны существовать — их зовёт загрузка.
eval(grab('_ddsFindMonthlySheet'));eval(grab('_ddsMonthlyRead'));
eval(grab('_ddsImportOpened'));

function mk(f,n,name){var raw=JSON.parse(fs.readFileSync(f,'utf8')).map(function(r){
  return r.map(function(x){return (x&&x.__d)?new Date(x.__d+'T12:00:00'):(x===null?'':x);});});
 var sh=Sheet(name,n,0); sh.insertRowsAfter(1,raw.length); sh.getRange(1,1,raw.length,n).setValues(raw); return sh;}
var wb={ getSheets:function(){return [mk(require('path').join(__dirname,'fixtures','dds-july.json'),28,'ДДС '),mk(require('path').join(__dirname,'fixtures','opl-2026.json'),8,'ОПЛАТА')];} };

function run(label){
  var r=_ddsImportOpened(ss,wb);
  if(r.__error){ console.log(label+': ОШИБКА → '+r.__error); return null; }
  return r;
}
var r1=run('1-я загрузка');
var r2=run('2-я загрузка (та же)');
var r3=run('3-я загрузка (та же)');
var totalDebt=0;
for(var i=1;i<debts._rows.length;i++){var row=debts._rows[i];
  if(!row||!row[D_AMT-1])continue;
  totalDebt+=(String(row[D_TYPE-1])==='oplata'?-1:1)*row[D_AMT-1];}

var ok=0,fail=0;
function t(n,c,x){if(c){ok++;console.log('  ✓ '+n);}else{fail++;console.log('  ✗ '+n+(x!==undefined?' → '+x:''));}}
t('загрузка проходит целиком', !!r1);
t('повторная загрузка проходит', !!r2 && !!r3);
t('операции не удваиваются ('+(r1&&r1.added)+')', r1&&r2&&r3&&r1.added===r2.added&&r2.added===r3.added);
t('долги не удваиваются ('+(r1&&r1.debts)+')', r1&&r2&&r3&&r1.debts===r2.debts&&r2.debts===r3.debts);
t('вторая загрузка заменяет прежние строки', r2&&r2.removed>0, r2&&r2.removed);
t('общий долг сходится с файлом владельца: 4 182 653',
  Math.round(totalDebt)===4182653, Math.round(totalDebt));
t('долг на начало июля — как записано в файле: 3 109 183',
  Number(settings['DDS_DEBT_START_2026-07'])===3109183, settings['DDS_DEBT_START_2026-07']);
t('план постоянных расходов за июль сохранён',
  JSON.parse(settings['DDS_PLAN_2026-07']||'{}').salary===737800, settings['DDS_PLAN_2026-07']);
t('месяцы без выручки названы (апрель–июнь)',
  r1 && (r1.noRevenue||[]).join(',')==='2026-04,2026-05,2026-06', r1&&(r1.noRevenue||[]).join(','));

// ── Берём только месяцы, где известны обе стороны ───────────────────
// Решение владельца: «только за июль посчитай». В ОПЛАТЕ платежи с
// апреля, выручка по дням — лишь за июль. Без отсева капитал уходил в
// минус на 15 млн, которых не было.
t('загружен только июль', r1 && (r1.months||[]).join(',')==='2026-07',
  r1&&(r1.months||[]).join(','));
var mset={};
for(var i=1;i<base._rows.length;i++){
  var z=String((base._rows[i]||[])[10]||''); var m=z.split(':')[1];
  if(m) mset[m]=(mset[m]||0)+1;
}
t('в БАЗЕ нет строк апреля–июня',
  !mset['2026-04'] && !mset['2026-05'] && !mset['2026-06'], Object.keys(mset).join(','));
t('июльские строки на месте', mset['2026-07']>0, mset['2026-07']);
// Долг не пострадал: он привязан к записанному остатку на 1 июля.
t('долг на начало июля остался 3 109 183',
  Number(settings['DDS_DEBT_START_2026-07'])===3109183, settings['DDS_DEBT_START_2026-07']);
t('апрельского начального долга больше нет',
  settings['DDS_DEBT_START_2026-04']===undefined, settings['DDS_DEBT_START_2026-04']);
t('общий долг всё равно 4 182 653', Math.round(totalDebt)===4182653, Math.round(totalDebt));
t('лист БАЗА не остался пустым', base.getLastRow()>1);

// Капитал по загруженному: доходы минус расходы.
var _inc=0,_exp=0;
for(var ci=1;ci<base._rows.length;ci++){
  var cr=base._rows[ci]; if(!cr||!cr[5])continue;
  if(cr[3]==='Доход')_inc+=cr[5]; else _exp+=cr[5];
}
t('капитал по июлю положительный: доходы '+Math.round(_inc)+
  ' − расходы '+Math.round(_exp)+' = '+Math.round(_inc-_exp),
  _inc-_exp>0, Math.round(_inc-_exp));
console.log('\nСквозная загрузка отчёта: '+ok+' passed, '+fail+' failed');
process.exit(fail?1:0);

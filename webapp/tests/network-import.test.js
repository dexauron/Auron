// Сводка по всем магазинам + импорт списаний и возвратов из 1С.
var fs=require('fs'), path=require('path');
var code=fs.readFileSync(path.join(__dirname,'..','Code.gs'),'utf8');
var html=fs.readFileSync(path.join(__dirname,'..','Index.html'),'utf8');
var ok=0,fail=0;
function t(n,c,x){if(c){ok++;console.log('  ✓ '+n);}else{fail++;console.log('  ✗ '+n+(x?' → '+x:''));}}
function grab(name){
  var i=code.indexOf('function '+name+'(');
  if(i<0) throw new Error('нет функции '+name);
  var d=0,j=code.indexOf('{',i);
  for(var k=j;k<code.length;k++){ if(code[k]==='{')d++; else if(code[k]==='}'){d--; if(!d){j=k+1;break;}} }
  return code.slice(i,j);
}

// ── Распознавание отчёта ─────────────────────────────────────────────
eval(grab('_xlsType'));
function typ(s){ return _xlsType([[s]]); }
t('списание товаров', typ('Списание товаров за июль')==='writeoff');
t('акт списания', typ('Акт списания №14')==='writeoff');
t('просто «Списания»', typ('Списания')==='writeoff');
t('возврат поставщику', typ('Возврат товаров поставщику')==='retvend');
t('возвраты поставщикам', typ('Возвраты поставщикам за месяц')==='retvend');
// В шапке возврата часто стоит и слово «списание» — возврат должен
// выигрывать, иначе возвраты лягут как порча и исказят убыток.
t('возврат сильнее списания в одной шапке',
  typ('Возврат товаров поставщику (списание с остатков)')==='retvend');
t('старые отчёты узнаются как раньше',
  typ('Прайс-лист')==='price' && typ('Продажи')==='sales' && typ('Остатки')==='stock');
t('чужой файл не опознаётся', typ('Приказ об отпуске')==='');

// ── Разбор строк ─────────────────────────────────────────────────────
eval(grab('_xlsCol'));
function _xlsNum(v){ if(typeof v==='number')return v;
  var s=String(v||'').replace(/\s| /g,'').replace(',','.').replace(/[^0-9.\-]/g,'');
  var n=parseFloat(s); return isFinite(n)?n:0; }
eval(grab('_lossParse'));
var R=[
  ['Списание товаров'],
  ['Номенклатура','Количество','Сумма','Причина'],
  ['Молоко 3.2%','4','320','Просрочка'],
  ['Хлеб','2','60','Порча'],
  ['Итого','','380',''],
  ['','','',''],
];
var items=_lossParse(R,'writeoff');
t('нашлись обе позиции', items.length===2, JSON.stringify(items));
t('итоговая строка отброшена', !items.some(function(x){return /итог/i.test(x.name);}));
t('сумма прочитана', items[0].amount===320, items[0]&&items[0].amount);
t('количество прочитано', items[0].qty===4);
t('причина прочитана', items[0].reason==='Просрочка');
t('вид проставлен', items[0].kind==='writeoff');
t('строка без суммы пропущена',
  _lossParse([['Списания'],['Номенклатура','Сумма'],['Пакеты','']],'writeoff').length===0);
t('без нужных колонок ничего не выдумываем',
  _lossParse([['Списания'],['Дата','Склад'],['01.07.2026','Основной']],'writeoff').length===0);
t('сумма с пробелами и запятой читается',
  _lossParse([['Списания'],['Номенклатура','Сумма'],['Сыр','1 250,50']],'writeoff')[0].amount===1250.5);
t('шапка не попала в данные', !items.some(function(x){return x.name==='Номенклатура';}));

// ── Запись ───────────────────────────────────────────────────────────
t('пишем в тот же лист, что и ручные списания',
  /function _lossApply[\s\S]{0,200}SH_LOSSES/.test(code));
t('повторная загрузка не создаёт дублей',
  /function _lossApply[\s\S]{0,900}if \(have\[key\]\) \{ skip\+\+; return; \}/.test(code));
t('ключ дубля — дата, название и сумма',
  /Utilities\.formatDate\(dt,tz,'yyyy-MM-dd'\)\+'\|'\+o\.name\.toLowerCase\(\)\+'\|'\+Math\.round\(o\.amount\)/.test(code));
t('пишем блоком, а не построчно', /sh\.getRange\(from,1,add\.length,LS_COLS\)\.setValues\(add\)/.test(code));
t('места в листе хватит', /_ensureRows\(sh, from, add\.length\)/.test(code));
t('нужны права на приём товара',
  /writeoff' \|\| type === 'retvend'[\s\S]{0,300}_permGuard\(p\.ssId,'receive'\)/.test(code));
t('владельцу сказано, сколько повторов пропущено', /Повторы пропущены: /.test(code));
t('новые отчёты названы в подсказке', /Списания, Возвраты поставщику/.test(code));

// ── Все магазины ─────────────────────────────────────────────────────
t('есть сводка по сети', /function getNetworkSummary\(/.test(code));
t('считает выручку, расход и результат',
  /row\.profit=row\.income-row\.expense/.test(code));
t('складывает деньги на счетах', /row\.cash\+=Math\.round\(a\.balance\|\|0\)/.test(code));
t('складывает долг поставщикам', /if \(v>0\) row\.debt\+=v/.test(code));
// Бухгалтеру могли не дать финансы в одной из точек — это надо показать,
// а не молча вычесть её из итога.
t('точка без доступа помечена, а не спрятана', /row\.denied=true; out\.push\(row\); return;/.test(code));
t('лучший и худший — только когда есть с чем сравнить',
  /if \(rated\.length>1\)/.test(code));
t('один магазин — экран всё равно работает', /single:orgs\.length<2/.test(code));
t('экран есть на фронте', /openNetwork:function/.test(html));
t('можно переключить период', /_netPeriods:\[\['today'/.test(html));
t('по нажатию переходим в магазин', /_netOpen:function/.test(html) && /App\.selectOrg\(\{ssId:ssId/.test(html));
t('вход из настроек', /App\.openNetwork\(\)/.test(html));

// ── Экраны ───────────────────────────────────────────────────────────
// «Отчёт» открывался пустым: сначала настрой период, потом нажми кнопку.
// Владелец заходит туда за одним ответом — он должен быть сразу.
t('отчёт строится сам при открытии', /if\(first\)try\{App\.buildReport\(\);\}catch/.test(html));
t('выбор периода спрятан под кнопку',
  /id="report-opts" style="display:none;"/.test(html) && /_reportOptsToggle:function/.test(html));
t('товары открываются полной страницей',
  /modal-title">Товары[\s\S]{0,220}'full'\)/.test(html));
t('в загрузке 1С названы списания и возвраты',
  /списания и возвраты поставщику/.test(html));

console.log('\nСеть и импорт списаний: '+ok+' passed, '+fail+' failed');
process.exit(fail?1:0);

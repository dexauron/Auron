// Переходник «Google-таблицы → устройство»: работает ли настоящая
// бухгалтерия из Code.gs без Google, без правок в самой логике.
//
// Это не проверка вёрстки, а проверка замысла: если тест зелёный —
// Android-версию можно делать, не переписывая 9320 строк расчётов.
var fs=require('fs'), path=require('path');
var ok=0,fail=0;
function t(n,c,x){if(c){ok++;console.log('  ✓ '+n);}else{fail++;console.log('  ✗ '+n+(x?' → '+x:''));}}

var bridge=require(path.join(__dirname,'..','..','android','gas-bridge.js'));
var code=fs.readFileSync(path.join(__dirname,'..','Code.gs'),'utf8');
eval(code);                    // вся логика магазина, как есть
var SSID='local';

// ── Таблицы заводятся сами ───────────────────────────────────────────
ensureSheets(bridge.SS);
// Владельца объявляем ПОСЛЕ создания листов: ensureSheets заводит лист
// НАСТРОЙКИ заново, и запись, сделанная раньше, пропадала. Дальше все
// проверки прав отказывали владельцу в доступе к его же деньгам —
// «Нет прав на счета» на пустом месте.
_setSetting(bridge.SS,'OWNER_EMAIL','owner@local');
t('листы созданы без Google', Object.keys(bridge.DB).length>15, Object.keys(bridge.DB).length);
['БАЗА','СЧЕТА','СМЕНЫ','ДОЛГИ','НАСТРОЙКИ'].forEach(function(n){
  t('есть лист '+n, bridge.DB[n]!==undefined);
});

// ── Обычный день магазина ────────────────────────────────────────────
var r1=saveAccount({ssId:SSID,data:{name:'Касса',type:'cash',balance:0}});
t('счёт заводится', r1&&r1.ok===true, JSON.stringify(r1));
var r2=saveRep({ssId:SSID,data:{name:'ООО Хлеб',phone:'+79001112233'}});
t('поставщик заводится', r2&&r2.ok===true, JSON.stringify(r2));

var today=new Date().toISOString().slice(0,10);
var inc=saveQuickEntry({ssId:SSID,data:{date:today,type:'Доход',category:'Продажи',
  amount:300000,account:'Касса',comment:'выручка за день'}});
t('выручка записывается', inc&&inc.ok===true, JSON.stringify(inc));
var exp=saveQuickEntry({ssId:SSID,data:{date:today,type:'Расход',category:'Закупка',
  amount:84000,account:'Касса',comment:'оплата поставщику'}});
t('расход записывается', exp&&exp.ok===true);

// ── Считает ли верно ─────────────────────────────────────────────────
// Это главное: цифры на экране должны сойтись с тем, что записали.
var home=getHomeSummary({ssId:SSID,period:'today'});
t('выручка за день верна', home.summary.income===300000, home.summary.income);
t('расход за день верен', home.summary.expense===84000, home.summary.expense);
t('операций посчитано две', home.summary.count===2, home.summary.count);

var an=getAnalytics({ssId:SSID,period:'month'});
t('аналитика: доход', an.income===300000, an.income);
t('аналитика: расход', an.expense===84000, an.expense);
t('аналитика: две категории', (an.byCategory||[]).length===2, (an.byCategory||[]).length);
t('прибыль сходится', (an.income-an.expense)===216000);

// ── Резервная копия ──────────────────────────────────────────────────
// Единственный способ перенести данные на другое устройство, поэтому
// проверяем не «выгрузилось», а «сошлось после загрузки».
var copy=bridge.dump();
t('копия — это текст', typeof copy==='string' && copy.length>100);
saveQuickEntry({ssId:SSID,data:{date:today,type:'Доход',category:'Продажи',
  amount:5000,account:'Касса',comment:'лишняя запись'}});
t('после лишней записи выручка выросла',
  getHomeSummary({ssId:SSID,period:'today'}).summary.income===305000);
bridge.load(copy);
t('загрузка копии вернула прежние цифры',
  getHomeSummary({ssId:SSID,period:'today'}).summary.income===300000);
t('копия ЗАМЕЩАЕТ, а не досыпает — операций снова две',
  getHomeSummary({ssId:SSID,period:'today'}).summary.count===2);

// ── Права и замки для одного человека не мешают ──────────────────────
t('владелец сам себе не запрещает', !/Нет прав/.test(JSON.stringify(r1)));
t('нет ложного «система занята»', !/Система занята/.test(JSON.stringify(inc)));

console.log('\nПереходник на устройство: '+ok+' passed, '+fail+' failed');
process.exit(fail?1:0);

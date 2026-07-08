/**
 * Интеграционные тесты денежных потоков Auron (запись → чтение).
 * Запуск:  node webapp/tests/flows.test.js
 *
 * Здесь мок Google-таблиц ХРАНИТ данные в памяти, поэтому проверяется реальный
 * сквозной поток: saveQuickEntry / saveTransfer / deleteTransaction / saveKassa
 * / receiveRep / getAccounts / setStoreDebt / переименование счёта.
 */
'use strict';
const fs = require('fs');
const path = require('path');
const vm = require('vm');

// ── In-memory мок таблицы ───────────────────────────────────────────
function MemSheet(name){ this.name=name; this.data=[]; }
MemSheet.prototype.getName=function(){return this.name;};
MemSheet.prototype.getLastRow=function(){return this.data.length;};
MemSheet.prototype.getLastColumn=function(){return this.data.reduce((m,r)=>Math.max(m,r.length),0);};
MemSheet.prototype.appendRow=function(arr){this.data.push(arr.slice());return this;};
MemSheet.prototype.deleteRow=function(r){this.data.splice(r-1,1);return this;};
MemSheet.prototype.deleteRows=function(r,n){this.data.splice(r-1,n);return this;};
MemSheet.prototype.hideSheet=function(){return this;};
MemSheet.prototype.setName=function(n){this.name=n;return this;};
MemSheet.prototype.setFrozenRows=function(){return this;};
MemSheet.prototype.getRange=function(row,col,nr,nc){
  const sh=this; nr=nr||1; nc=nc||1;
  const R={
    getValues(){
      const out=[];
      for(let i=0;i<nr;i++){ const src=sh.data[row-1+i]||[]; const line=[];
        for(let j=0;j<nc;j++) line.push(src[col-1+j]!==undefined?src[col-1+j]:'');
        out.push(line); }
      return out;
    },
    getValue(){ const src=sh.data[row-1]||[]; return src[col-1]!==undefined?src[col-1]:''; },
    setValues(vals){
      for(let i=0;i<vals.length;i++){ const rr=row-1+i; while(sh.data.length<=rr)sh.data.push([]);
        for(let j=0;j<vals[i].length;j++) sh.data[rr][col-1+j]=vals[i][j]; }
      return R;
    },
    setValue(v){ const rr=row-1; while(sh.data.length<=rr)sh.data.push([]); sh.data[rr][col-1]=v; return R; },
    setNumberFormat(){return R;}, setFontWeight(){return R;}, setBackground(){return R;}, setFontColor(){return R;}
  };
  return R;
};
function MemSS(){ this.sheets={}; }
MemSS.prototype.getSheetByName=function(n){return this.sheets[n]||null;};
MemSS.prototype.insertSheet=function(n){const s=new MemSheet(n);this.sheets[n]=s;return s;};
MemSS.prototype.getSheets=function(){return Object.keys(this.sheets).map(k=>this.sheets[k]);};
MemSS.prototype.getName=function(){return 'Auron — Тест';};
MemSS.prototype.getId=function(){return 'ss1';};
MemSS.prototype.getOwner=function(){return {getEmail:()=>'owner@x'};};

const SS = new MemSS();

// ── Мок Google Apps Script ──────────────────────────────────────────
function pad(n){return (n<10?'0':'')+n;}
const noop=()=>{};
const Utilities={ getUuid(){return 'u'+(Utilities._i=(Utilities._i||0)+1)+'-'+Math.random().toString(36).slice(2,7);},
  formatDate(d,tz,fmt){return fmt.replace('yyyy',d.getFullYear()).replace('yy',String(d.getFullYear()).slice(-2)).replace('MM',pad(d.getMonth()+1)).replace('dd',pad(d.getDate())).replace('HH',pad(d.getHours())).replace('mm',pad(d.getMinutes())).replace('MM',pad(d.getMonth()+1)).replace('dd',pad(d.getDate()));} };
const Session={ getScriptTimeZone:()=>'Europe/Moscow', getActiveUser:()=>({getEmail:()=>'owner@x'}), getEffectiveUser:()=>({getEmail:()=>'owner@x'}) };
const sandbox={
  Utilities, Session,
  SpreadsheetApp:{ openById:()=>SS, create:()=>SS, getActiveSpreadsheet:()=>SS },
  LockService:{ getScriptLock:()=>({tryLock:()=>true,waitLock:noop,releaseLock:noop}), getUserLock:()=>({tryLock:()=>true,waitLock:noop,releaseLock:noop}) },
  // РЕАЛЬНЫЙ кэш в памяти — чтобы тесты проверяли, что каждая запись
  // корректно сбрасывает кэш балансов (устаревший баланс завалит проверки).
  CacheService:(()=>{ const store={}; const c={get:k=>store[k]!==undefined?store[k]:null,
    put:(k,v)=>{store[k]=v;}, remove:k=>{delete store[k];}, removeAll:ks=>ks.forEach(k=>delete store[k])};
    return { getScriptCache:()=>c }; })(),
  PropertiesService:{ getScriptProperties:()=>({getProperty:()=>null,setProperty:noop,deleteAllProperties:noop}) },
  DriveApp:{ getFileById:()=>({getOwner:()=>({getEmail:()=>'owner@x'}),addEditor:noop,setTrashed:noop}) },
  MailApp:{ sendEmail:noop }, ScriptApp:{ getService:()=>({getUrl:()=>''}), getProjectTriggers:()=>[] },
  HtmlService:{}, UrlFetchApp:{ fetch:noop }, console,
  Date, Math, JSON, parseFloat, parseInt, isNaN, String, Number, Array, Object, RegExp
};
vm.createContext(sandbox);
vm.runInContext(fs.readFileSync(path.join(__dirname,'..','Code.gs'),'utf8')+
  '\n;this.__api={ensureSheets,getAccounts,saveQuickEntry,saveTransfer,deleteTransaction,saveAccount,receiveRep,getContractorCard,saveKassa,getStoreDebt,setStoreDebt,saveGoods,getGoods,getGoodsAnalytics,getProductDetail,getSavingsHunter,getAdvisor,askAuron,_seasonContext,getDebts,_rolePerms,PERM_CATALOG,getRestock,SH_ACCOUNTS,SH_BASE,STORE_DEBT_REP};', sandbox);
const A=sandbox.__api;

// ── Мини-фреймворк ──────────────────────────────────────────────────
let pass=0, fail=0;
function eq(name,got,want){ if(JSON.stringify(got)===JSON.stringify(want))pass++; else{fail++;console.log('  ✗ FAIL:',name,'| получено',JSON.stringify(got),'ожидалось',JSON.stringify(want));} }
function bal(name){ return (A.getAccounts({ssId:'ss1'}).find(a=>a.name===name)||{}).balance; }

// ── Подготовка: счета ───────────────────────────────────────────────
A.ensureSheets(SS);
A.saveAccount({ssId:'ss1',data:{name:'Наличные',startBalance:100000}});
A.saveAccount({ssId:'ss1',data:{name:'Карта',startBalance:50000}});

eq('старт: Наличные', bal('Наличные'), 100000);
eq('старт: Карта', bal('Карта'), 50000);

// ── Доход/расход меняют баланс ──────────────────────────────────────
A.saveQuickEntry({ssId:'ss1',data:{type:'Доход',category:'Продажи',account:'Наличные',amount:30000}});
A.saveQuickEntry({ssId:'ss1',data:{type:'Расход',category:'Закупка',account:'Наличные',amount:12000}});
eq('после дохода/расхода: Наличные', bal('Наличные'), 100000+30000-12000);

// ── Перевод: сумма сохраняется, обе стороны ─────────────────────────
const before = bal('Наличные')+bal('Карта');
A.saveTransfer({ssId:'ss1',data:{uuid:'t1',account:'Наличные',toAccount:'Карта',amount:20000}});
eq('перевод: Наличные −20000', bal('Наличные'), 118000-20000);
eq('перевод: Карта +20000', bal('Карта'), 50000+20000);
eq('перевод: сумма по счетам не изменилась', bal('Наличные')+bal('Карта'), before);

// ── Удаление одной стороны перевода удаляет обе ─────────────────────
// найдём id одной из строк перевода
const baseSh = SS.getSheetByName(A.SH_BASE);
let transferRow=null;
baseSh.data.slice(1).forEach(r=>{ if(String(r[4])==='Перевод' && !transferRow) transferRow=r; });
A.deleteTransaction({ssId:'ss1',id:String(transferRow[0])});
// удаляются ОБЕ стороны → балансы возвращаются к состоянию ДО перевода
eq('после удаления перевода: Наличные вернулся', bal('Наличные'), 118000);
eq('после удаления перевода: Карта вернулась', bal('Карта'), 50000);
eq('после удаления перевода: сумма сохранилась', bal('Наличные')+bal('Карта'), before);

// ── Приём торгового: наличная оплата + погашение + новый долг ────────
const cashBefore = bal('Наличные');
const rr = A.receiveRep({ssId:'ss1',rep:'ООО Альфа',account:'Наличные',cashPaid:0,debtRepaid:5000,newDebt:8000});
eq('приём: долг = −5000+8000', rr.debt, 3000);
eq('приём: погашение списало наличные', bal('Наличные'), cashBefore-5000);
const card = A.getContractorCard({ssId:'ss1',name:'ООО Альфа'});
eq('карточка контрагента: долг', card.debt, 3000);

// ── Переименование счёта переносит историю (баланс сохраняется) ──────
const naличBefore = bal('Наличные');
// найдём id счёта Наличные
const accSh = SS.getSheetByName(A.SH_ACCOUNTS);
let cashId=null; accSh.data.slice(1).forEach(r=>{ if(String(r[1])==='Наличные') cashId=String(r[0]); });
A.saveAccount({ssId:'ss1',data:{id:cashId,name:'Касса магазина',startBalance:100000}});
eq('переименование: старого имени нет', bal('Наличные'), undefined);
eq('переименование: баланс перешёл на новое имя', bal('Касса магазина'), naличBefore);

// ── Сверка кассы (saveKassa): сбалансированная смена ────────────────
// Хрупкость #5 ИСПРАВЛЕНА: выше мы переименовали кассовый счёт
// «Наличные» → «Касса магазина». Проводки Кассы должны следовать за
// переименованием (через настройку CASH_ACCOUNT), а не создавать
// фантомный счёт «Наличные». Поэтому кассу теперь смотрим по новому имени.
const CASH='Касса магазина';
const gcash=()=>(A.getAccounts({ssId:'ss1'}).find(a=>a.name===CASH)||{}).balance;
const kBefore=gcash()||0;
// баланс: собрано(80000)+поставщикам(15000)+оставлено(5000) = выручка(100000) → recon 0
A.saveKassa({ssId:'ss1',data:{date:new Date().toISOString(),shift:'Смена 1',cashier:'Аня',
  recon:{cashRev:100000,cashSupp:15000,cashCollect:80000,cashLeft:5000,cardRevs:[]}}});
// Касса: +выручка100000 −поставщикам15000 = +85000 (инкассация не проводится)
eq('касса(баланс): касса +85000 на переименованный счёт', gcash(), kBefore+85000);

// ── Сверка кассы: недостача создаёт расход «Недостача кассира» ───────
const kBefore2=gcash()||0;
// собрано(70000)+15000+5000 = 90000 < выручка 100000 → недостача 10000
A.saveKassa({ssId:'ss1',data:{date:new Date().toISOString(),shift:'Смена 2',cashier:'Аня',
  recon:{cashRev:100000,cashSupp:15000,cashCollect:70000,cashLeft:5000,cardRevs:[]}}});
// Касса: +100000 −15000 −10000(недостача) = +75000
eq('касса(недостача): касса +75000', gcash(), kBefore2+75000);
let hasShortage=false;
SS.getSheetByName(A.SH_BASE).data.slice(1).forEach(r=>{ if(String(r[4])==='Недостача кассира')hasShortage=true; });
eq('касса(недостача): проводка «Недостача кассира» есть', hasShortage, true);

// ── Долг магазина: накладные в долг увеличивают, погашение уменьшает ─
const debt0=A.getStoreDebt({ssId:'ss1'}).debt;
A.saveKassa({ssId:'ss1',data:{date:new Date().toISOString(),shift:'Смена 3',cashier:'Аня',
  invoices:{cashPaid:0,debtRepaid:0,newDebt:40000}}});
eq('долг магазина: +40000 новый долг', A.getStoreDebt({ssId:'ss1'}).debt, debt0+40000);
A.saveKassa({ssId:'ss1',data:{date:new Date().toISOString(),shift:'Смена 4',cashier:'Аня',
  invoices:{cashPaid:0,debtRepaid:15000,newDebt:0}}});
eq('долг магазина: −15000 погашение', A.getStoreDebt({ssId:'ss1'}).debt, debt0+40000-15000);

// ── setStoreDebt выставляет долг в целевое значение ─────────────────
A.setStoreDebt({ssId:'ss1',target:100000});
eq('setStoreDebt: долг = 100000', A.getStoreDebt({ssId:'ss1'}).debt, 100000);

// ── Аналитика товаров: проф-метрики, сортировка, карточка ───────────
// Загружаем цены (2 поставщика на товар A), продажи и остатки.
A.saveGoods({ssId:'ss1',kind:'Цены',rows:[
  {barcode:'111',name:'Молоко',group:'Молочка',supplier:'ОптТорг',buy:80},
  {barcode:'222',name:'Крупа',  group:'Бакалея', supplier:'Меркурий',buy:50}]});
A.saveGoods({ssId:'ss1',kind:'Цены',rows:[
  {barcode:'111',name:'Молоко',group:'Молочка',supplier:'Альфа',buy:75}]}); // 2-й поставщик дешевле
A.saveGoods({ssId:'ss1',kind:'Продажи',salesDays:30,rows:[
  {barcode:'111',name:'Молоко',qty:10,revenue:1000,profit:200,retail:100},
  {barcode:'222',name:'Крупа',  qty:0, revenue:0,   profit:0,  retail:60}]});
A.saveGoods({ssId:'ss1',kind:'Остатки',rows:[
  {barcode:'111',name:'Молоко',stockQty:5,stockSum:400},
  {barcode:'222',name:'Крупа',  stockQty:4,stockSum:200}]});

const ga=A.getGoodsAnalytics({ssId:'ss1'});
eq('товары: количество', ga.count, 2);
// Молоко: закуп обновлён 2-м прайсом до 75 → наценка (100−75)/75=33.3%; Крупа 20%
eq('товары: ср. наценка (33.3+20)/2', ga.avgMarkup, 26.7);
eq('товары: GMROI = прибыль/остаток (200/600)', ga.gmroi, 0.33);
eq('товары: заморожено в неликвиде (Крупа)', ga.frozen, 200);
eq('товары: оборачиваемость в днях', ga.turnoverDays, 27);
eq('товары: снимок продаж создан', ga.snapshots.length>=1, true);

// getGoods: сортировка по прибыли + вычисленная наценка/дни остатка
const gl=A.getGoods({ssId:'ss1',sort:'profit'});
eq('список: первый по прибыли — Молоко', gl.items[0].name, 'Молоко');
eq('список: наценка Молока (закуп 75)', gl.items[0].markup, 33.3);
eq('список: фильтр-фасеты (группы)', gl.groups.length, 2);
// Молоко: остаток 5, продано 10 за 30 дн → хватит на 5/(10/30)=15 дн
eq('список: дней остатка Молока', gl.items[0].daysOfStock, 15);

// Фильтр по поставщику
const glf=A.getGoods({ssId:'ss1',supplier:'Меркурий'});
eq('список: фильтр по поставщику', glf.items.length, 1);

// Поиск по коду/артикулу (сотрудники ищут товар по коду из 1С)
A.saveGoods({ssId:'ss1',kind:'Остатки',rows:[
  {barcode:'111',name:'Молоко',stockQty:5,stockSum:400,code:'340',article:'ML-1'}]});
const byCode=A.getGoods({ssId:'ss1',q:'340'});
eq('поиск по коду товара', byCode.items.some(x=>x.name==='Молоко'), true);
const byArt=A.getGoods({ssId:'ss1',q:'ML-1'});
eq('поиск по артикулу', byArt.items.some(x=>x.name==='Молоко'), true);
const pcc=A.getProductDetail({ssId:'ss1',barcode:'111',name:'Молоко'});
eq('карточка: код товара виден', pcc.item.code, '340');

// Карточка поставщика: какие товары возит (из истории цен)
const scard=A.getContractorCard({ssId:'ss1',name:'Альфа'});
eq('поставщик: список товаров есть', (scard.goods||[]).some(g=>g.name==='Молоко'), true);
eq('поставщик: цена товара', (scard.goods.find(g=>g.name==='Молоко')||{}).price, 75);

// Карточка товара: история цены + сравнение поставщиков
const pc=A.getProductDetail({ssId:'ss1',barcode:'111',name:'Молоко'});
eq('карточка: история цены (2 точки)', pc.priceHist.length, 2);
eq('карточка: поставщиков', pc.suppliers.length, 2);
eq('карточка: дешевле у Альфы (75)', pc.suppliers[0].price, 75);
eq('карточка: у поставщика есть дата поступления', !!pc.suppliers[0].date, true);

// Дата поступления из колонки «период» попадает в историю поступлений
A.saveGoods({ssId:'ss1',kind:'Цены',rows:[
  {barcode:'333',name:'Масло',supplier:'ОптТорг',buy:200,date:'15.05.2026'}]});
const pc2=A.getProductDetail({ssId:'ss1',barcode:'333',name:'Масло'});
eq('карточка: поступление датировано периодом', pc2.priceHist[0].label, '15.05.26');
eq('карточка: поставщик с датой поступления', pc2.suppliers[0].date, '15.05.26');

// ── Аврон-советник: охотник за экономией ────────────────────────────
// Сок: сейчас берём у «Дорогой» (60, свежая дата), но «Дешёвый» даёт 40.
A.saveGoods({ssId:'ss1',kind:'Цены',rows:[
  {barcode:'444',name:'Сок',supplier:'Дешёвый',buy:40,date:'01.01.2026'}]});
A.saveGoods({ssId:'ss1',kind:'Цены',rows:[
  {barcode:'444',name:'Сок',supplier:'Дорогой',buy:60,date:'01.06.2026'}]});
A.saveGoods({ssId:'ss1',kind:'Продажи',salesDays:30,rows:[
  {barcode:'444',name:'Сок',qty:30,revenue:3000,profit:900,retail:100}]});
const sav=A.getSavingsHunter({ssId:'ss1'});
const sok=(sav.items||[]).find(x=>x.name==='Сок');
eq('экономия: Сок найден', !!sok, true);
eq('экономия: дешевле у «Дешёвый»', sok&&sok.cheapSup, 'Дешёвый');
eq('экономия: разница 20 ₽/шт', sok&&sok.perUnit, 20);
// продаём 30 шт за 30 дн → 30 шт/мес × 20 ₽ = 600 ₽/мес
eq('экономия: 600 ₽/мес по Соку', sok&&sok.monthlySave, 600);
// Цена «Дешёвого» от 01.01.2026 — старая → помечается как неактуальная
eq('экономия: старая цена помечена stale', sok&&sok.stale, true);
eq('экономия: показана дата цены', sok&&sok.cheapDate, '01.01.26');
// Молоко: текущий поставщик уже самый дешёвый (Альфа 75) → в список не попадает
eq('экономия: Молоко не предлагается (уже дёшево)', !(sav.items||[]).some(x=>x.name==='Молоко'), true);

// ── Аврон-советник: проактивные подсказки ───────────────────────────
const adv=A.getAdvisor({ssId:'ss1'});
eq('советник: есть подсказки', adv.count>=1, true);
eq('советник: предлагает экономию', (adv.alerts||[]).some(a=>a.action==='savings'), true);
eq('советник: видит неликвид (Крупа)', (adv.alerts||[]).some(a=>a.icon==='🧊'), true);

// ── Аврон-помощник: локальные ответы по данным (без ключа ИИ) ────────
const q1=A.askAuron({ssId:'ss1',q:'где дешевле?'});
eq('помощник: локальный режим', q1.source, 'local');
eq('помощник: про экономию отвечает', /экономи/i.test(q1.answer), true);
const q2=A.askAuron({ssId:'ss1',q:'сколько заработал за месяц'});
eq('помощник: считает прибыль', /Прибыль/.test(q2.answer), true);
const q3=A.askAuron({ssId:'ss1',q:'что не продаётся'});
eq('помощник: показывает неликвид', q3.answer.length>0, true);
const q4=A.askAuron({ssId:'ss1',q:'сколько в кассе'});
eq('помощник: показывает счета', /₽/.test(q4.answer), true);

// ── Общий долг включает долг магазина по накладным ──────────────────
const alldebts=A.getDebts({ssId:'ss1'});
const storeRow=alldebts.find(d=>String(d.name).indexOf('🏪')===0);
eq('долг магазина по накладным есть в getDebts', !!storeRow, true);
eq('долг магазина = 100000 (setStoreDebt)', storeRow&&storeRow.debt, 100000);
// «общий долг» = сумма положительных долгов ВКЛЮЧАЕТ магазин
const realTotal=alldebts.reduce((s,d)=>s+Math.max(d.debt||0,0),0);
eq('общий долг включает накладные магазина', realTotal>=100000, true);

// ── Сезонный контекст (думать как человек: спрос по сезону/праздникам) ─
const sc1=A._seasonContext(new Date(2026,11,20)); // 20 декабря
eq('сезон: декабрь = зима', sc1.season, 'зима');
eq('сезон: скоро Новый год', sc1.upcoming[0].name, 'Новый год');
eq('сезон: до НГ 11 дней', sc1.upcoming[0].daysUntil, 11);
const sc2=A._seasonContext(new Date(2026,6,15)); // 15 июля
eq('сезон: июль = лето', sc2.season, 'лето');
// Мусульманские праздники: за ~2 недели до Ураза-байрам 2026 (20.03.2026)
const sc3=A._seasonContext(new Date(2026,2,7)); // 7 марта 2026
eq('сезон: видит Ураза-байрам', sc3.upcoming.some(e=>e.name==='Ураза-байрам'), true);
// за ~3 недели до начала Рамадана 2026 (18.02.2026)
const sc4=A._seasonContext(new Date(2026,0,30)); // 30 января 2026
eq('сезон: видит начало Рамадана', sc4.upcoming.some(e=>e.name==='Начало Рамадана'), true);
const q5=A.askAuron({ssId:'ss1',q:'что закупить к празднику?'});
eq('помощник: отвечает про сезон/спрос', /сезон|зима|весна|лето|осень|Скоро/i.test(q5.answer), true);

// ── Что заканчивается (без денег — доступно сотруднику зала) ─────────
const rs=A.getRestock({ssId:'ss1'});
eq('заканчивается: возвращает список', Array.isArray(rs.items), true);
eq('заканчивается: без денежных полей', rs.items.every(x=>x.stockQty!==undefined&&x.buy===undefined&&x.profit===undefined), true);

// ── Права доступа по ролям ──────────────────────────────────────────
eq('права: сотрудник зала без финансов', A._rolePerms('Сотрудник зала').indexOf('finance'), -1);
eq('права: сотрудник зала с кассой', A._rolePerms('Сотрудник зала').indexOf('kassa')>=0, true);
eq('права: владелец видит финансы', A._rolePerms('Владелец').indexOf('finance')>=0, true);
eq('права: владелец может удалять', A._rolePerms('Владелец').indexOf('manage')>=0, true);
eq('права: бухгалтер видит финансы, но не кассу', A._rolePerms('Бухгалтер').indexOf('finance')>=0 && A._rolePerms('Бухгалтер').indexOf('kassa')<0, true);
eq('права: каталог из 6 пунктов', A.PERM_CATALOG.length, 6);

// ── Итог ────────────────────────────────────────────────────────────
console.log('\nПотоки денег: '+pass+' passed, '+fail+' failed');
process.exit(fail?1:0);

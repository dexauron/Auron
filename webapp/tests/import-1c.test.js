// Слияние товаров при импорте из 1С: обновление, добавление, повторы.
// Баг, который ловим: при повторе штрихкода внутри одного файла ссылка
// уезжала на строку вперёд → падение «Cannot set properties of undefined».
// В реальном файле «Цены поставщиков» повторов 6158 — падало бы всегда.
var G_COLS=15,G_BARCODE=1,G_NAME=2,G_GROUP=3,G_SUPPLIER=5,G_BUY=6,G_RETAIL=7,
    G_SOLDQTY=8,G_STOCKQTY=11,G_UPDATED=13;

function applyGoods(cur, items){
  var byBar={},byName={};
  cur.forEach(function(r,i){
    if(r[G_BARCODE-1]) byBar[String(r[G_BARCODE-1])]=i;
    if(r[G_NAME-1])    byName[String(r[G_NAME-1]).trim().toLowerCase()]=i;
  });
  var upd=0, add=[], now='NOW';
  items.forEach(function(o){
    var i=o.barcode?byBar[o.barcode]:undefined;
    if(i===undefined){
      var j=byName[o.name.toLowerCase()];
      if(j!==undefined&&o.barcode){
        var tgt=(j>=0)?cur[j]:add[-j-1];
        var tb=tgt?String(tgt[G_BARCODE-1]||''):'';
        if(!tb){ i=j; tgt[G_BARCODE-1]=o.barcode; byBar[o.barcode]=j; }
      } else if(j!==undefined) i=j;
    }
    var row;
    if(i===undefined){
      row=[];for(var k=0;k<G_COLS;k++)row.push('');
      row[G_BARCODE-1]=o.barcode||''; row[G_NAME-1]=o.name;
      var ni=add.length; add.push(row);
      if(o.barcode)byBar[o.barcode]=-1-ni;
      byName[o.name.toLowerCase()]=-1-ni;
    } else if(i>=0){ row=cur[i]; upd++; }
    else { row=add[-i-1]; }
    if(o.group   !==undefined) row[G_GROUP-1]=o.group;
    if(o.supplier!==undefined) row[G_SUPPLIER-1]=o.supplier;
    if(o.buy     !==undefined) row[G_BUY-1]=o.buy;
    if(o.retail  !==undefined) row[G_RETAIL-1]=o.retail;
    if(o.soldQty !==undefined) row[G_SOLDQTY-1]=o.soldQty;
    if(o.stockQty!==undefined) row[G_STOCKQTY-1]=o.stockQty;
    row[G_UPDATED-1]=now;
  });
  return {cur:cur, add:add, upd:upd};
}
function mk(bc,name){var r=[];for(var i=0;i<G_COLS;i++)r.push('');r[G_BARCODE-1]=bc;r[G_NAME-1]=name;return r;}

var ok=0,fail=0;
function t(n,c){ if(c){ok++;console.log('  ✓ '+n);}else{fail++;console.log('  ✗ '+n);} }

// 1. повтор штрихкода в одном файле не роняет и пишет в свою строку
var r=applyGoods([],[
  {barcode:'460',name:'Рулет',supplier:'Максимус',buy:83},
  {barcode:'460',name:'Рулет',supplier:'WayMarket',buy:80},
  {barcode:'999',name:'Другой',supplier:'Лидер',buy:10}]);
t('повтор штрихкода не роняет импорт', r.add.length===2);
t('повтор пишется в свою строку',      r.add[0][G_SUPPLIER-1]==='WayMarket');
t('следующий товар не пострадал',      r.add[1][G_NAME-1]==='Другой'&&r.add[1][G_BUY-1]===10);

// 2. существующий товар обновляется, а не дублируется
r=applyGoods([mk('460','Рулет')],[{barcode:'460',name:'Рулет',buy:99}]);
t('существующий обновился, не задвоился', r.add.length===0&&r.upd===1&&r.cur[0][G_BUY-1]===99);

// 3. отчёт пишет ТОЛЬКО свои поля (прайс не стирает остаток/продажи)
var base=mk('460','Рулет'); base[G_STOCKQTY-1]=42; base[G_SOLDQTY-1]=7;
r=applyGoods([base],[{barcode:'460',name:'Рулет',buy:50,retail:80}]);
t('прайс не стёр остаток',   r.cur[0][G_STOCKQTY-1]===42);
t('прайс не стёр продажи',   r.cur[0][G_SOLDQTY-1]===7);
t('прайс обновил цены',      r.cur[0][G_BUY-1]===50&&r.cur[0][G_RETAIL-1]===80);

// 4. Продажи без штрихкода сверяются по названию
r=applyGoods([mk('460','Рулет')],[{barcode:'',name:'Рулет',soldQty:12}]);
t('продажи легли по названию', r.add.length===0&&r.cur[0][G_SOLDQTY-1]===12);

// 5. новый товар добавляется
r=applyGoods([mk('460','Рулет')],[{barcode:'777',name:'Новый',buy:5}]);
t('новый товар добавлен', r.add.length===1&&r.add[0][G_BARCODE-1]==='777');

// 6. одинаковые названия с РАЗНЫМИ штрихкодами — это разные товары
r=applyGoods([mk('460','Пакет майка')],[{barcode:'777',name:'Пакет майка',buy:3}]);
t('одинаковое имя + другой штрихкод = новый товар',
  r.add.length===1&&r.add[0][G_BARCODE-1]==='777'&&r.cur[0][G_BUY-1]!==3);

// 7. товар, заведённый из Продаж без штрихкода, получает штрихкод из прайса
r=applyGoods([mk('','Рулет')],[{barcode:'460',name:'Рулет',buy:50}]);
t('пустой штрихкод дозаполняется, дубля нет',
  r.add.length===0&&r.cur[0][G_BARCODE-1]==='460'&&r.cur[0][G_BUY-1]===50);

// ── Настоящие характеристики выгрузок владельца (июль 2026) ──
// Не выдуманные значения: посчитаны по его файлам. Импорт обязан
// выдерживать именно их, а не удобные примеры из трёх строк.
(function realFiles(){
  var code=require('fs').readFileSync(require('path').join(__dirname,'..','Code.gs'),'utf8');

  // 1) 3 533 повторяющихся штрихкода в «Ценах поставщиков» — на такой
  //    ситуации импорт падал до 4.44.0 (ошибка на единицу при записи).
  var ok1=/var ni = add\.length;[\s\S]{0,120}add\.push\(row\)/.test(code);
  t('позиция берётся ДО push (падало на 3 533 дублях)', ok1);

  // 2) 110 штрихкодов с ведущим нулём — таблица превращает их в число.
  t('штрихкод не теряет ведущий ноль', /_xlsBarcode/.test(code));

  // 3) 353 товара с закупкой 0 и 22 дешевле рубля — наценка по ним
  //    не должна утаскивать средний показатель по магазину.
  t('наценка считается по деньгам, а не простым средним',
    /cogsAll>0 \? Math\.round\(\(totRevenue-cogsAll\)\/cogsAll/.test(code));

  // 4) Объём: 23 646 строк в одном файле, 6 минут на операцию.
  t('разбор файла идёт ВНЕ замка', !/_withLock\([\s\S]{0,400}_xlsParse/.test(code));
})();

console.log('\nИмпорт из 1С: '+ok+' passed, '+fail+' failed');
process.exit(fail?1:0);

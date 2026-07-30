// Поиск товаров. Перенесён из нашего каталога, проверяем реальные случаи
// из выгрузки 1С владельца — раньше они не работали.
var fs=require('fs'), path=require('path');
var code=fs.readFileSync(path.join(__dirname,'..','Code.gs'),'utf8');
var a=code.indexOf('var _TR='), b=code.indexOf('function getGoods(p) {');
eval(code.slice(a,b));   // _sNorm, _sTranslit, _sLoose, _sScoreTok, _sScore

var DB=[
  {name:'Ulker Альбени XXL 70г',      barcode:'4870112002973', code:'340',   article:''},
  {name:'Coca Cola GR Стекло 0,33л',  barcode:'54490451',      code:'1200',  article:''},
  {name:'Яшкино Рулет Бисквитный Клубника 200г', barcode:'4603290002882', code:'14485', article:'МБ136'},
  {name:'.гт/с Бамбалби 25 см, арт. 8816-40',    barcode:'2800000147174', code:'16815', article:''},
  {name:'Хот-дог классический',       barcode:'111',           code:'900',   article:''}
];
function find(q){
  q=_sNorm(q); var t=q.split(/\s+/).filter(Boolean);
  return DB.map(function(it){return {n:it.name,s:_sScore(it,q,t)};})
           .filter(function(x){return x.s>0;})
           .sort(function(a,b){return b.s-a.s;});
}
function hits(q){return find(q).map(function(x){return x.n;});}
var ok=0,fail=0;
function t(n,c,extra){if(c){ok++;console.log('  ✓ '+n);}else{fail++;console.log('  ✗ '+n+(extra?' → '+extra:''));}}

// транслитерация в обе стороны
t('«улкер» находит Ulker', hits('улкер').some(function(n){return n.indexOf('Ulker')===0;}));
t('«ulker» находит Ulker', hits('ulker').some(function(n){return n.indexOf('Ulker')===0;}));
t('«кола» находит Coca Cola', hits('кола').some(function(n){return n.indexOf('Coca')===0;}));
// знаки и пробелы не мешают
t('«0.33» находит «0,33»',   hits('0.33').some(function(n){return n.indexOf('Coca')===0;}));
t('«арт8816» находит «арт. 8816»', hits('арт8816').length>0);
// слова в любом порядке
t('«рулет яшкино» находит «Яшкино Рулет…»', hits('рулет яшкино').length===1);
t('«яшкино рулет» тоже находит',            hits('яшкино рулет').length===1);
// ё/е
t('«елка» и «ёлка» одинаковы', _sNorm('ёлка')===_sNorm('елка'));
// поиск по кодам
t('точный штрихкод находит', hits('4870112002973').length===1);
t('код товара находит',      hits('14485').length>=1);
// сортировка по точности: точный код выше случайного вхождения
var r=find('340');
t('точный код в самом верху', r.length>0 && r[0].s>=120, r.length?('счёт '+r[0].s):'нет');
// начало названия важнее середины
var r2=find('рулет');
t('совпадение с начала слова выше середины', r2.length>0 && r2[0].s>=88, r2.length?('счёт '+r2[0].s):'нет');
// мусор ничего не находит
t('бессмыслица не находит ничего', hits('щщщxyz').length===0);
// пустой запрос не роняет
t('пустой запрос не роняет', (function(){try{find('');return true;}catch(e){return false;}})());

console.log('\nПоиск товаров: '+ok+' passed, '+fail+' failed');
process.exit(fail?1:0);

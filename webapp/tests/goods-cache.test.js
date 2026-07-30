// Кэш таблицы товаров: режется на части (лимит 100 КБ на ключ),
// собирается обратно, сбрасывается при изменении товаров.
// Ловим: битую склейку частей, отдачу устаревших данных после импорта,
// «полуживой» кэш, если часть ключей истекла раньше остальных.
var GOODS_CHUNK=90000, TTL=900;
var CACHE={};
var CacheService={getScriptCache:function(){return{
  get:function(k){return CACHE[k]===undefined?null:CACHE[k];},
  getAll:function(ks){var o={};ks.forEach(function(k){if(CACHE[k]!==undefined)o[k]=CACHE[k];});return o;},
  putAll:function(m){Object.keys(m).forEach(function(k){CACHE[k]=m[k];});},
  removeAll:function(ks){ks.forEach(function(k){delete CACHE[k];});}
};}};
function key(id){return 'gds_'+id+'_v1';}
function put(id,rows){
  var str=JSON.stringify(rows);
  if(str.length>GOODS_CHUNK*40)return;
  var base=key(id),map={},n=0;
  for(var i=0;i<str.length;i+=GOODS_CHUNK){map[base+'_'+n]=str.substr(i,GOODS_CHUNK);n++;}
  map[base]=String(n);
  CacheService.getScriptCache().putAll(map,TTL);
}
function get(id){
  try{
    var c=CacheService.getScriptCache(),base=key(id);
    var head=c.get(base); if(!head)return null;
    var n=parseInt(head,10); if(!(n>0))return null;
    var ks=[];for(var i=0;i<n;i++)ks.push(base+'_'+i);
    var parts=c.getAll(ks),out='';
    for(var j=0;j<n;j++){var v=parts[base+'_'+j];if(v==null)return null;out+=v;}
    return JSON.parse(out);
  }catch(e){return null;}
}
function drop(id){
  var c=CacheService.getScriptCache(),base=key(id);
  var head=c.get(base),n=head?parseInt(head,10):0;
  var ks=[base];for(var i=0;i<n;i++)ks.push(base+'_'+i);
  c.removeAll(ks);
}
var ok=0,fail=0;
function t(n,c,extra){if(c){ok++;console.log('  ✓ '+n);}else{fail++;console.log('  ✗ '+n+(extra?' → '+extra:''));}}

// маленький набор
CACHE={};
put('s1',[['111','Молоко'],['222','Крупа']]);
t('сохранили и прочитали', JSON.stringify(get('s1'))==='[["111","Молоко"],["222","Крупа"]]');

// большой набор — режется на части и собирается верно
CACHE={};
var big=[];for(var i=0;i<16555;i++)big.push([String(4000000000+i),'Товар номер '+i+' с длинным названием для объёма','Группа',i%7,i*3]);
put('s2',big);
var head=parseInt(CACHE['gds_s2_v1'],10);
t('нарезано на несколько частей', head>1, 'частей: '+head);
t('каждая часть в пределах лимита', Object.keys(CACHE).filter(function(k){return k!=='gds_s2_v1';})
   .every(function(k){return CACHE[k].length<=GOODS_CHUNK;}));
var back=get('s2');
t('16 555 строк вернулись целыми', back && back.length===16555);
t('данные не побились на стыках частей',
   back && back[0][1]==='Товар номер 0 с длинным названием для объёма'
        && back[16554][1]==='Товар номер 16554 с длинным названием для объёма');

// потеря одной части = кэш недействителен, а не половина данных
delete CACHE['gds_s2_v1_1'];
t('потеря части → кэш не отдаётся', get('s2')===null);

// сброс после изменения товаров
CACHE={}; put('s3',[['1','Старое']]);
drop('s3');
t('сброс убирает всё', get('s3')===null && Object.keys(CACHE).length===0);

// разные магазины не мешают друг другу
CACHE={}; put('A',[['1','A']]); put('B',[['2','B']]);
drop('A');
t('сброс одного магазина не тронул другой', get('A')===null && get('B')!==null);

console.log('\nКэш товаров: '+ok+' passed, '+fail+' failed');
process.exit(fail?1:0);

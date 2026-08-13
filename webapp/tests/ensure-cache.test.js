// Проверка логики: кэш "тяжёлой" части ensureSheets
var SCHEMA_VERSION=2, cache={}, RUN={};
var CacheService={getScriptCache:function(){return{
  get:function(k){return cache[k]||null;},put:function(k,v){cache[k]=v;}};}};
function key(id){return 'ens_'+id+'_v'+SCHEMA_VERSION;}
function done(id){if(!id)return false;if(RUN[id])return true;
  if(CacheService.getScriptCache().get(key(id))){RUN[id]=true;return true;}return false;}
function mark(id){if(!id)return;RUN[id]=true;CacheService.getScriptCache().put(key(id),'1');}

var heavy=0;
function ensure(id,isOwner){ if(done(id))return; heavy++; if(isOwner) mark(id); }

var ok=0,fail=0;
function t(n,c){ if(c){ok++;console.log('  ✓ '+n);}else{fail++;console.log('  ✗ '+n);} }

// Владелец: тяжёлое один раз, дальше пропускается
heavy=0;cache={};RUN={};
ensure('S1',true);ensure('S1',true);ensure('S1',true);
t('владелец: тяжёлое отработало 1 раз из 3 вызовов', heavy===1);

// Сотрудник (защита не встала): пробуем снова, не залипает
heavy=0;cache={};RUN={};
ensure('S1',false);ensure('S1',false);
t('сотрудник: пробуем каждый раз (не кэшируем неудачу)', heavy===2);

// Сотрудник, потом владелец -> защита ставится
heavy=0;cache={};RUN={};
ensure('S1',false); ensure('S1',true); ensure('S1',true);
t('после входа владельца защита встала и дальше пропуск', heavy===2);

// Смена версии схемы сбрасывает кэш
heavy=0;cache={};RUN={};
ensure('S1',true); SCHEMA_VERSION=3; RUN={};
ensure('S1',true);
t('новая SCHEMA_VERSION -> миграция отрабатывает снова', heavy===2);
SCHEMA_VERSION=2;

// Разные магазины не мешают друг другу
heavy=0;cache={};RUN={};
ensure('A',true);ensure('B',true);ensure('A',true);ensure('B',true);
t('разные таблицы кэшируются раздельно', heavy===2);

console.log('\nКэш ensureSheets: '+ok+' passed, '+fail+' failed');
process.exit(fail?1:0);

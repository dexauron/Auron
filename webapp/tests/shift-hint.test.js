// Подсказка про смену на Главной + таблетки статуса у операций.
// Раньше подсказка смотрела только на часы и советовала «открыть смену»
// даже когда смена за сегодня уже записана — то есть врала владельцу.
var fs=require('fs'), path=require('path');
var html=fs.readFileSync(path.join(__dirname,'..','Index.html'),'utf8');
var code=fs.readFileSync(path.join(__dirname,'..','Code.gs'),'utf8');
var ok=0,fail=0;
function t(n,c,x){if(c){ok++;console.log('  ✓ '+n);}else{fail++;console.log('  ✗ '+n+(x?' → '+x:''));}}
function grab(name){
  var i=html.indexOf('  '+name+':function');
  if(i<0) throw new Error('нет метода '+name);
  var j=html.indexOf('{',i), d=0;
  for(var k=j;k<html.length;k++){ if(html[k]==='{')d++; else if(html[k]==='}'){d--; if(!d){j=k+1;break;}} }
  return html.slice(html.indexOf(':',i)+1, j);
}

// ── Подсказка ────────────────────────────────────────────────────────
var App={_e:function(v){return String(v==null?'':v);}};
App._smartHint=eval('('+grab('_smartHint')+')');
var realDate=Date;
function atHour(h){
  global.Date=function(){ var d=new realDate(2026,7,6,h,0,0); return d; };
  global.Date.now=realDate.now;
}
function hint(state,hour){ App._shiftState=state; atHour(hour); return App._smartHint(); }

// Вчерашняя смена не записана — это дыра в учёте: выручка за целый день
// нигде не числится. Важнее любой подсказки про сегодня, поэтому первая.
var h1=hint({today:false,yesterday:false},9);
t('вчера не записана — предупреждаем', /Вчерашняя смена не записана/.test(h1));
t('и красным, а не как обычный совет', /var\(--neg\)/.test(h1));
var h2=hint({today:true,yesterday:false},9);
t('вчерашняя дыра важнее сегодняшнего порядка', /Вчерашняя смена не записана/.test(h2));

// Смена записана — не советуем сделать уже сделанное.
var h3=hint({today:true,yesterday:true},9);
t('утром при записанной смене не зовём открывать', !/Пора открыть смену/.test(h3));
t('вместо этого спокойная отметка', /Смена за сегодня записана/.test(h3));
t('отметка зелёная', /var\(--pos\)/.test(h3));
var h4=hint({today:true,yesterday:true},19);
t('вечером при записанной смене не зовём закрывать', !/закрыть кассу/i.test(h4));

// Смена не записана — работает как раньше, по времени суток.
t('утром зовём открыть', /Пора открыть смену/.test(hint({today:false,yesterday:true},9)));
t('вечером зовём закрыть', /закрыть кассу/i.test(hint({today:false,yesterday:true},19)));
t('днём молчим', hint({today:false,yesterday:true},14)==='');

// Сервер ещё не ответил: состояния нет. Молчать нельзя — но и врать
// про «вчера не записана» тоже: false и «не знаю» это разные вещи.
var h5=hint({},9);
t('без ответа сервера не пугаем вчерашним днём', !/Вчерашняя смена/.test(h5));
t('но обычную подсказку показываем', /Пора открыть смену/.test(h5));
global.Date=realDate;

// ── Сервер отдаёт факт ───────────────────────────────────────────────
t('сервер считает сегодня и вчера', /var shToday=false, shYest=false;/.test(code));
t('сравнение по дню, а не по времени', /var sk=dayKey\(sd\);/.test(code));
t('признак уходит на телефон', /shift:\{today:shToday,yesterday:shYest\}/.test(code));
t('считается в том же проходе по листу смен',
  /if\(sk===kToday\)shToday=true; else if\(sk===kYest\)shYest=true;[\s\S]{0,120}if\(pd\.from/.test(code));
// Признак «записана ли смена» не должен стоить второго чтения листа:
// он снимается в том же проходе, что и выручка за период.
var homeBody=(function(){
  var i=code.indexOf('function getHomeSummary('), d=0, j=code.indexOf('{',i);
  for(var k=j;k<code.length;k++){ if(code[k]==='{')d++; else if(code[k]==='}'){d--; if(!d)return code.slice(i,k+1);} }
  return '';
})();
t('getHomeSummary найдена', homeBody.length>500);
t('лист смен читается один раз за вызов',
  (homeBody.match(/getRange\(2,1,[^)]*getLastRow\(\)-1,8\)/g)||[]).length===1,
  (homeBody.match(/getRange\(2,1,[^)]*getLastRow\(\)-1,8\)/g)||[]).length);

// ── Подсказка обновляется после ответа сервера ───────────────────────
// Доска рисуется раньше ответа. Без этого владелец до перезагрузки
// видел бы старый совет.
t('у подсказки есть свой адрес', /id="smart-hint"/.test(html));
t('состояние запоминается', /App\._shiftState=r\.shift\|\|\{\};/.test(html));
t('подсказка перерисовывается точечно',
  /var sh=document\.getElementById\('smart-hint'\);\s*if\(sh\)sh\.innerHTML=App\._smartHint\(\);/.test(html));

// ── Таблетки статуса ─────────────────────────────────────────────────
var App2={};
App2._txTag=eval('('+grab('_txTag')+')');
t('запертая запись помечена', /заперто/.test(App2._txTag({locked:true})));
t('запись из смены помечена', /из смены/.test(App2._txTag({shift:'День'})));
t('обычная запись без метки', App2._txTag({})==='' );
t('замок важнее происхождения',
  /заперто/.test(App2._txTag({locked:true,shift:'День'})) &&
  !/из смены/.test(App2._txTag({locked:true,shift:'День'})));
t('метка стоит рядом с категорией', /App\._txTag\(tx\)\+'<\/div>'/.test(html));

console.log('\nПодсказка о смене и метки: '+ok+' passed, '+fail+' failed');
process.exit(fail?1:0);

// Офлайн для кассы и накладных + защита от повторной отправки
// + настройки не выкидывают в корень после действия.
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

// ── Обрыв связи против отказа сервера ────────────────────────────────
// Это главное различие. Отказ («нет прав», «период закрыт») повторять
// бессмысленно — его надо показать. Обрыв связи — наоборот, повторить.
var App={};
function online(v){ try{Object.defineProperty(globalThis,'navigator',
  {value:{onLine:v},configurable:true,writable:true});}catch(e){} }
online(true);
App._isOffline=eval('('+grab('_isOffline')+')');
t('обрыв сети — офлайн', App._isOffline(new Error('Failed to fetch')));
t('сетевая ошибка по-английски', App._isOffline(new Error('NetworkError when attempting to fetch')));
t('таймаут — офлайн', App._isOffline(new Error('Request timeout')));
t('наш сторож про связь — офлайн',
  App._isOffline(new Error('Сервер долго не отвечает. Проверь интернет и попробуй ещё раз.')));
t('пустая ошибка считается обрывом', App._isOffline(new Error('')));
t('отказ по правам — НЕ офлайн', !App._isOffline(new Error('Нет доступа к кассе')));
t('закрытый период — НЕ офлайн', !App._isOffline(new Error('Период закрыт по 31.07.2026')));
t('не найдено — НЕ офлайн', !App._isOffline(new Error('Запись не найдена')));
online(false);
t('телефон сам сказал «нет сети»', App._isOffline(new Error('Нет доступа к кассе')));
online(true);

// ── Касса и накладные уходят в очередь ───────────────────────────────
t('смена кладётся в очередь при обрыве',
  /App\._outboxPush\('saveKassa',payload\)/.test(html));
t('накладные по поставщикам — тоже',
  /App\._outboxPush\('saveEveningInvoices',pl2\)/.test(html));
t('накладные одной суммой — тоже',
  /App\._outboxPush\('saveEveningTotal',pl\)/.test(html));
t('после укладки в очередь форма очищается',
  /_outboxPush\('saveKassa',payload\);\s*App\._kClearMorning\(\)/.test(html));
t('владельцу объясняют, что ничего не потеряно',
  /_offlineSaved:function/.test(html) && /как появится интернет, запись уйдёт сама/.test(html));
t('отказ сервера в очередь НЕ кладём',
  /if\(App\._isOffline\(e\)\)\{[\s\S]{0,400}\}\s*App\.toast\(App\._friendlyErr\(e\),true\);/.test(html));

// ── Очередь: что с ней происходит дальше ─────────────────────────────
// gs() отклоняет обещание и на отказе сервера тоже, поэтому разбор
// обязан быть в catch — в then он бы никогда не сработал.
t('разбор отказа стоит в catch, а не в then',
  /\}\)\.catch\(function\(e\)\{\s*App\._outboxFlushing=false;\s*\/\/ Связь всё ещё не поднялась/.test(html));
t('при обрыве запись остаётся в очереди',
  /if\(App\._isOffline\(e\)\)return;/.test(html));
t('при отказе запись убирается и о ней говорят',
  /Запись не принята/.test(html) && /q2\.shift\(\);App\._outboxSet\(q2\);\s*App\.openModal/.test(html));
t('в плашке видно, что именно ждёт', /_outboxWhat:function/.test(html));
t('название по-человечески', /saveKassa:'смена'/.test(html) && /saveEveningInvoices:'накладные'/.test(html));
t('плашка без жаргона', /Нет связи: '\+what\+' ждёт отправки/.test(html));

// ── Защита от дублей ─────────────────────────────────────────────────
// Очередь может отправить одно и то же дважды: связь оборвалась на
// середине ответа. Для смены это был бы второй Z-отчёт на ту же выручку.
t('на сервере есть проверка повторов', /function _opSeen\(/.test(code));
t('смена защищена', /_opSeen\(ss, _s\(d\.opId\)\)/.test(code));
t('накладные по поставщикам защищены',
  /function saveEveningInvoices[\s\S]{0,600}_opSeen\(ss, _s\(p\.opId\)\)/.test(code));
t('накладные одной суммой защищены',
  /function saveEveningTotal[\s\S]{0,900}_opSeen\(ss, _s\(p\.opId\)\)/.test(code));
t('повтор отвечает «уже записано», а не ошибкой', /duplicate:true/.test(code));
t('список номеров не растёт бесконечно', /if \(list\.length>200\) list=list\.slice/.test(code));
t('пустой номер не считается повтором', /if \(!opId\) return false;/.test(code));
t('номер операции присылает телефон',
  /opId:uuidv4\(\)/.test(html));

// ── Настройки не выкидывают в корень ─────────────────────────────────
t('перерисовка возвращает в тот же раздел',
  /var back=App\._settingsCur;[\s\S]{0,400}if\(back\)\{\s*App\.settingsOpenGroup\(back,true\)/.test(html));
t('место на экране сохраняется',
  /var pos=host\?host\.scrollTop:0;/.test(html) && /host\.scrollTop=pos;/.test(html));
t('вход на вкладку по-прежнему начинает с корня',
  /tab==='settings'\)\{App\._settingsCur=null;App\.renderSettingsPage\(\);\}/.test(html));
t('кнопка «Назад» по-прежнему возвращает в корень',
  /settingsBack:function\(\)\{\s*App\._settingsResetRoot\(\)/.test(html));

console.log('\nОфлайн и настройки: '+ok+' passed, '+fail+' failed');
process.exit(fail?1:0);

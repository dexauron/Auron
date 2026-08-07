// Сборка содержимого Android-приложения.
//
// Берём наш экран (webapp/Index.html) и логику (webapp/Code.gs) и
// собираем ОДИН самостоятельный файл, который работает без интернета
// и без Google: вся бухгалтерия считается прямо на телефоне.
//
// Запуск:  node android/build-www.js
// Итог:    android/www/index.html
//
// Что здесь происходит по шагам — важно понимать при правках:
//   1. вырезаем вставки Apps Script (<?= ... ?>) — браузер их не знает;
//   2. вставляем переходник, который выдаёт себя за Google-таблицы;
//   3. вставляем всю логику из Code.gs как есть;
//   4. подменяем google.script.run на прямой вызов этих функций.
const fs=require('fs'), path=require('path');
const ROOT=path.join(__dirname,'..');
const OUT=path.join(__dirname,'www');

let html=fs.readFileSync(path.join(ROOT,'webapp','Index.html'),'utf8');
const code=fs.readFileSync(path.join(ROOT,'webapp','Code.gs'),'utf8');
let bridge=fs.readFileSync(path.join(__dirname,'gas-bridge.js'),'utf8');

// Переходник написан и для Node, и для браузера. Хвост с module.exports
// в браузере не нужен — отрезаем, иначе будет ошибка.
bridge=bridge.slice(0, bridge.indexOf('if (typeof module!=='));

// 1. Шаблонные вставки Apps Script
html=html.replace(/<\?[!=]?=?\s*[\w.]+\s*\?>/g,'');

// 2–4. Один блок, который делает страницу самостоятельной.
const shim=`
<script>
/* ══════════════════════════════════════════════════════════════════
   Auron на устройстве. Ни сервера, ни интернета — всё считается здесь.
   ══════════════════════════════════════════════════════════════════ */

/* Переходник написан для проверки в Node, где главный объект зовётся
   global, а в браузере — window. Даём ему привычное имя, чтобы файл
   остался ОДИН для обоих случаев: две копии разошлись бы через месяц. */
var global = (typeof globalThis!=='undefined') ? globalThis : window;

${bridge}

/* ── Данные переживают закрытие приложения ────────────────────────
   Без этого магазин «забывал» всё при выходе. Пишем при каждом
   изменении, но не чаще раза в секунду: иначе на импорте из 1С
   (23 тысячи строк) телефон встанет колом. */
var _SAVE_KEY='auron_db_v1', _saveTimer=null;
function _dbSave(){
  if(_saveTimer)return;
  _saveTimer=setTimeout(function(){
    _saveTimer=null;
    try{ localStorage.setItem(_SAVE_KEY, _dumpDB()); }
    catch(e){ console.error('не удалось сохранить:', e); }
  },800);
}
function _dumpDB(){
  return JSON.stringify(DB,function(k,v){
    return (this[k] instanceof Date)?{__d:this[k].toISOString()}:v;
  });
}
// Немедленное сохранение — без задержки. Нужно там, где ждать нельзя:
// приложение сворачивают, и телефон может выгрузить его из памяти в
// любую секунду. Отложенная запись в этот момент просто не случится.
function _dbSaveNow(){
  if(_saveTimer){clearTimeout(_saveTimer);_saveTimer=null;}
  try{ localStorage.setItem(_SAVE_KEY,_dumpDB()); }catch(e){}
}
// Телефон не спрашивает разрешения, когда закрывает приложение.
// Единственный надёжный момент — когда экран уходит из виду.
document.addEventListener('visibilitychange',function(){
  if(document.visibilityState==='hidden')_dbSaveNow();
});
window.addEventListener('pagehide',_dbSaveNow);

function _dbLoad(){
  try{
    var raw=localStorage.getItem(_SAVE_KEY); if(!raw)return false;
    var d=JSON.parse(raw,function(k,v){
      return (v&&typeof v==='object'&&typeof v.__d==='string')?new Date(v.__d):v;
    });
    Object.keys(DB).forEach(function(k){delete DB[k];});
    Object.keys(d).forEach(function(k){DB[k]=d[k];});
    return true;
  }catch(e){ console.error('копия повреждена:', e); return false; }
}

/* ── Вся логика магазина ──────────────────────────────────────── */
${code}

/* ── Подмена сервера: вызываем функции напрямую ───────────────────
   Экран написан под google.script.run и ждёт ответа обещанием.
   Здесь ответ приходит мгновенно, но форму вызова сохраняем — иначе
   пришлось бы править сотни мест в экране. */
(function(){
  var api={ _ok:null,_err:null,
    withSuccessHandler:function(f){api._ok=f;return proxy;},
    withFailureHandler:function(f){api._err=f;return proxy;},
    withUserObject:function(){return proxy;} };
  var proxy=new Proxy(api,{get:function(t,k){
    if(k in t) return t[k];
    return function(){
      var ok=t._ok, err=t._err, args=Array.prototype.slice.call(arguments);
      var res;
      try{
        var fn=(typeof window[k]==='function')?window[k]:null;
        if(!fn) throw new Error('Не найдено действие: '+k);
        res=fn.apply(null,args);
      }catch(e){
        // Ошибку отдаём тем же путём, что и настоящий сервер, — экран
        // уже умеет её показывать по-человечески.
        setTimeout(function(){ err&&err(e); },0);
        return;
      }
      _dbSave();
      setTimeout(function(){ ok&&ok(res); },0);
    };
  }});
  window.google={script:{
    run:proxy,
    host:{close:function(){},setHeight:function(){},editor:{focus:function(){}}},
    url:{getLocation:function(f){f({parameter:{},hash:''});}}
  }};
})();

/* ── Первый запуск ───────────────────────────────────────────────── */
(function(){
  var had=_dbLoad();
  if(!had){
    // Чистое устройство: заводим таблицы и объявляем хозяина телефона
    // владельцем. Проверки прав рассчитаны на несколько человек, а здесь
    // человек один — без этой строки он получал бы «нет прав» на свои же
    // деньги. Порядок важен: сначала листы, потом владелец, иначе
    // создание листов затирает запись.
    try{
      ensureSheets(SS);
      // Адрес обязан совпадать с тем, что отдаёт Session в переходнике:
      // владелец определяется сравнением этих двух строк. Разошлись на
      // одно слово — и человек получает «Нет прав» на свои же деньги.
      _setSetting(SS,'OWNER_EMAIL', Session.getActiveUser().getEmail());
      _dbSave();
    }catch(e){ console.error('первый запуск:', e); }
  }
})();
</script>
`;

// Вставляем перед закрытием body — после того, как разметка уже есть.
if(html.indexOf('</body>')<0) throw new Error('в Index.html нет </body>');
html=html.replace('</body>', shim+'</body>');

fs.mkdirSync(OUT,{recursive:true});
fs.writeFileSync(path.join(OUT,'index.html'),html);
console.log('собрано: android/www/index.html');
console.log('размер: '+Math.round(html.length/1024)+' КБ');

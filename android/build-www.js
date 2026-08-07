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

/* ── Резервные копии ──────────────────────────────────────────────
   Ручные копии люди не делают: «сделаю завтра» — и так полгода, а
   потом телефон падает в воду и уносит год работы. Поэтому копия
   делается сама, раз в сутки, и хранится последние семь штук. */
var _BAK_PREFIX='auron_bak_', _BAK_KEEP=7;

function _bakToday(){ return new Date().toISOString().slice(0,10); }

function _bakList(){
  var out=[];
  try{
    for(var i=0;i<localStorage.length;i++){
      var k=localStorage.key(i);
      if(k&&k.indexOf(_BAK_PREFIX)===0) out.push(k);
    }
  }catch(e){}
  return out.sort();
}

function _bakAuto(){
  try{
    var key=_BAK_PREFIX+_bakToday();
    if(localStorage.getItem(key)) return false;   // за сегодня уже есть
    localStorage.setItem(key,_dumpDB());
    // Старые чистим, иначе память телефона кончится незаметно, и
    // приложение начнёт молча терять данные при сохранении.
    var all=_bakList();
    while(all.length>_BAK_KEEP){ localStorage.removeItem(all.shift()); }
    return true;
  }catch(e){
    // Память кончилась — освобождаем место самой старой копией и
    // пробуем ещё раз. Данные важнее истории копий.
    try{ var a=_bakList(); if(a.length){ localStorage.removeItem(a[0]); } }catch(e2){}
    return false;
  }
}

/* Копия в файл — то, что человек отправит себе в WhatsApp или на
   Яндекс.Диск и загрузит на другом телефоне. */
window.auronBackupFile=function(){
  var name='auron-'+_bakToday()+'.json';
  var blob=new Blob([_dumpDB()],{type:'application/json'});
  var a=document.createElement('a');
  a.href=URL.createObjectURL(blob); a.download=name;
  document.body.appendChild(a); a.click();
  setTimeout(function(){ URL.revokeObjectURL(a.href); a.remove(); },1000);
  return name;
};

/* Загрузка копии. ЗАМЕЩАЕТ данные целиком, а не досыпает — иначе
   операции задвоятся. Поэтому сначала честно говорим, что потеряется. */
window.auronRestoreFile=function(text){
  var cur=0;
  try{ cur=Math.max(0,(DB['БАЗА']||[]).length-1); }catch(e){}
  var d;
  try{ d=JSON.parse(text); }catch(e){ throw new Error('Это не файл копии Auron'); }
  if(!d||!d['БАЗА']) throw new Error('В файле нет данных магазина');
  var incoming=Math.max(0,(d['БАЗА']||[]).length-1);
  return {
    current:cur, incoming:incoming,
    apply:function(){
      // Перед заменой сохраняем то, что было: если человек ошибся
      // файлом, вернуть будет нечем.
      try{ localStorage.setItem(_BAK_PREFIX+'before-restore',_dumpDB()); }catch(e){}
      var parsed=JSON.parse(text,function(k,v){
        return (v&&typeof v==='object'&&typeof v.__d==='string')?new Date(v.__d):v;
      });
      Object.keys(DB).forEach(function(k){delete DB[k];});
      Object.keys(parsed).forEach(function(k){DB[k]=parsed[k];});
      Object.keys(CACHE).forEach(function(k){delete CACHE[k];});
      _dbSaveNow();
      return true;
    }
  };
};

/* ── Напоминания с телефона ───────────────────────────────────────
   Раньше подсказка «закрой смену» была видна, только когда человек сам
   открыл приложение. А если он его открыл — он и так помнит. Такое
   напоминание бесполезно.

   Здесь напоминание приходит на телефон само, даже когда приложение
   закрыто. Ни сервера, ни интернета для этого не нужно: будильник
   ставит сам телефон.

   Внутри браузера (при проверке на компьютере) плагина нет — тогда всё
   молча пропускается, чтобы приложение не падало. */
var _Notif=(window.Capacitor&&window.Capacitor.Plugins&&window.Capacitor.Plugins.LocalNotifications)||null;

function _notifReady(){
  if(!_Notif) return Promise.resolve(false);
  return _Notif.requestPermissions()
    .then(function(r){ return !!(r&&(r.display==='granted'||r.display==='prompt-with-rationale')); })
    .catch(function(){ return false; });
}

/* Во сколько напоминать — человек меняет в настройках. По умолчанию
   21:00: магазин закрыт, смена посчитана, но ещё не поздно записать. */
function _notifHour(){
  var h=parseInt(localStorage.getItem('auron_notif_hour')||'21',10);
  return (h>=0&&h<=23)?h:21;
}
window.auronSetNotifHour=function(h){
  localStorage.setItem('auron_notif_hour',String(h));
  return _notifSchedule();
};
window.auronNotifOff=function(){
  localStorage.setItem('auron_notif_off','1');
  if(_Notif) _Notif.cancel({notifications:[{id:1},{id:2}]}).catch(function(){});
};
window.auronNotifOn=function(){
  localStorage.removeItem('auron_notif_off');
  return _notifSchedule();
};

function _notifSchedule(){
  if(localStorage.getItem('auron_notif_off')==='1') return Promise.resolve(false);
  return _notifReady().then(function(okPerm){
    if(!okPerm) return false;
    var at=new Date(); at.setHours(_notifHour(),0,0,0);
    // Старые напоминания снимаем: иначе при каждом запуске приложения
    // копился бы новый будильник, и телефон звонил бы пачками.
    return _Notif.cancel({notifications:[{id:1},{id:2}]}).catch(function(){}).then(function(){
      return _Notif.schedule({notifications:[{
        id:1,
        title:'Auron',
        body:'Пора закрыть смену и записать кассу',
        schedule:{ at:at, repeats:true, every:'day', allowWhileIdle:true },
        smallIcon:'ic_stat_icon'
      }]});
    }).then(function(){ return true; }).catch(function(){ return false; });
  });
}

/* Отдельно — то, что нельзя откладывать до вечера: просроченные
   выплаты поставщикам. Проверяем при каждом открытии приложения. */
function _notifOverdue(){
  if(!_Notif) return;
  try{
    var pays=(typeof getPayables==='function')?getPayables({ssId:'local'}):null;
    var list=(pays&&pays.items)||pays||[];
    if(!Array.isArray(list)) return;
    var today=new Date(); today.setHours(0,0,0,0);
    var n=0, sum=0;
    list.forEach(function(r){
      if(r.status!=='open'&&r.status!=='postponed') return;
      var left=Math.max((r.amount||0)-(r.paid||0),0); if(!left) return;
      var d=new Date(String(r.date)+'T00:00:00');
      if(d<today){ n++; sum+=left; }
    });
    if(!n) return;
    // Не чаще раза в день: иначе при каждом открытии приложения
    // человек получал бы одно и то же напоминание.
    var mark='auron_overdue_'+_bakToday();
    if(localStorage.getItem(mark)) return;
    localStorage.setItem(mark,'1');
    _notifReady().then(function(okPerm){
      if(!okPerm) return;
      _Notif.schedule({notifications:[{
        id:2, title:'Просроченные выплаты',
        body:n+' на сумму '+Math.round(sum).toLocaleString('ru-RU')+' ₽',
        schedule:{ at:new Date(Date.now()+5000) },
        smallIcon:'ic_stat_icon'
      }]}).catch(function(){});
    });
  }catch(e){}
}

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
  _bakAuto();   // копия за сегодня — сразу, а не «когда-нибудь»
  try{ _notifSchedule(); _notifOverdue(); }catch(e){}
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

// ПЕРЕХОДНИК: Google-таблицы → база на устройстве.
//
// ЗАЧЕМ. Вся логика магазина живёт в webapp/Code.gs — 9320 строк, 329
// функций: касса, смены, долги, аналитика, импорт из 1С. Переписывать
// это под Android означало бы месяцы работы и новые ошибки в расчётах,
// которые уже проверены на настоящем магазине.
//
// Вместо этого подменяем ТОЛЬКО то, через что код общается с Google:
// таблицы, замки, кэш, настройки. Логика остаётся нетронутой и не знает,
// что работает уже не в облаке, а на телефоне.
//
// ЧТО ЭТО ДАЁТ. Проверено запуском: счета, операции, главный экран и
// аналитика считают верно, без единой правки в Code.gs.
//
// ЧЕГО ЗДЕСЬ НЕТ И НЕ БУДЕТ (для одного пользователя не нужно):
//   • прав по ролям — владелец один, он же и есть все роли;
//   • замка «другой сотрудник сохраняет» — сотрудников нет;
//   • писем и приглашений.
//
// Хранилище пока в памяти. Следующий шаг — положить его в базу
// устройства, чтобы данные переживали закрытие приложения.

// ── Хранилище: лист = массив строк ──────────────────────────────────
const DB={};
function sheet(name){ if(!DB[name])DB[name]=[]; return DB[name]; }

// Оформление (жирный шрифт, цвет, ширина колонок) на телефоне не нужно,
// но код его вызывает. Отвечаем на ЛЮБОЙ незнакомый метод самим собой —
// тогда цепочки вида .setFontWeight().setBackground() не падают.
function chainable(real){
  return new Proxy(real,{get(t,k){
    if(k in t) return t[k];
    if(typeof k==='symbol') return undefined;
    return ()=>chainable(t);   // косметика: сделали вид, что применили
  }});
}

function makeSheet(name){
  return chainable({
    getName:()=>name,
    getLastRow:()=>sheet(name).length,
    getLastColumn:()=>Math.max(1,...sheet(name).map(r=>r.length)),
    appendRow:(row)=>{sheet(name).push(row.slice());},
    getRange:(r,c,nr,nc)=>{
      // Методы записи возвращают сам диапазон: код зовёт их цепочкой,
      // .setValues([...]).setFontWeight('bold') — без возврата всё падало.
      const range=chainable({
        getValues:()=>{
          const out=[];
          for(let i=0;i<(nr||1);i++){
            const src=sheet(name)[r-1+i]||[];
            const line=[];
            for(let j=0;j<(nc||1);j++) line.push(src[c-1+j]!==undefined?src[c-1+j]:'');
            out.push(line);
          }
          return out;
        },
        getValue:()=>{const src=sheet(name)[r-1]||[];return src[c-1]!==undefined?src[c-1]:'';},
        setValues:(vals)=>{
          vals.forEach((line,i)=>{
            const idx=r-1+i;
            if(!sheet(name)[idx])sheet(name)[idx]=[];
            line.forEach((v,j)=>{sheet(name)[idx][c-1+j]=v;});
          });
          return range;
        },
        setValue:(v)=>{const idx=r-1;if(!sheet(name)[idx])sheet(name)[idx]=[];sheet(name)[idx][c-1]=v;return range;},
        clearContent:()=>{for(let i=0;i<(nr||1);i++){const idx=r-1+i;if(sheet(name)[idx])for(let j=0;j<(nc||1);j++)sheet(name)[idx][c-1+j]='';}return range;},
      });
      return range;
    },
    insertSheet:()=>makeSheet(name), hideSheet:()=>{}, setName:()=>{},
    getDataRange:()=>chainable({getValues:()=>sheet(name).map(r=>r.slice())}),
    getProtections:()=>[], protect:()=>chainable({getEditors:()=>[],removeEditor:()=>{},addEditors:()=>{}}),
  });
}
const SS=chainable({ getSheetByName:(n)=>DB[n]!==undefined?makeSheet(n):null,
           insertSheet:(n)=>{DB[n]=[];return makeSheet(n);},
           getSheets:()=>Object.keys(DB).map(makeSheet),
           getName:()=>'Auron — Way Market', getId:()=>'local' });

global.SpreadsheetApp={ openById:()=>SS, create:()=>SS, getActiveSpreadsheet:()=>SS,
  ProtectionType:{SHEET:'SHEET'} };
global.Utilities={
  getUuid:()=>'id-'+Math.random().toString(36).slice(2,10),
  formatDate:(d,tz,fmt)=>{
    const p=n=>String(n).padStart(2,'0');
    return fmt.replace('yyyy',d.getFullYear()).replace('MM',p(d.getMonth()+1))
             .replace('dd',p(d.getDate())).replace('HH',p(d.getHours())).replace('mm',p(d.getMinutes()));
  },
  computeHmacSha256Signature:()=>[1,2,3], base64Encode:(s)=>Buffer.from(String(s)).toString('base64'),
};
global.Session={ getScriptTimeZone:()=>'Europe/Moscow',
  getActiveUser:()=>({getEmail:()=>'owner@local'}), getEffectiveUser:()=>({getEmail:()=>'owner@local'}) };
const PROPS={};
global.PropertiesService={ getUserProperties:()=>({getProperty:k=>PROPS[k]||null,setProperty:(k,v)=>{PROPS[k]=v;},deleteProperty:k=>{delete PROPS[k];}}),
                           getScriptProperties:()=>({getProperty:k=>PROPS[k]||null,setProperty:(k,v)=>{PROPS[k]=v;}}) };
// Кэш. removeAll обязателен: сброс главной после новой записи идёт
// именно через него, и без этого метода экран минуту показывал бы
// старую выручку. Поймано тестом — по коду это не видно, потому что
// вызов обёрнут в try/catch и падает молча.
const CACHE={};
const cacheApi={
  get:k=>CACHE[k]||null,
  put:(k,v)=>{CACHE[k]=v;},
  remove:k=>{delete CACHE[k];},
  removeAll:(ks)=>{(ks||[]).forEach(k=>delete CACHE[k]);},
  getAll:(ks)=>{const o={};(ks||[]).forEach(k=>{if(CACHE[k]!==undefined)o[k]=CACHE[k];});return o;},
  putAll:(o)=>{Object.keys(o||{}).forEach(k=>{CACHE[k]=o[k];});}
};
global.CacheService={ getScriptCache:()=>cacheApi, getUserCache:()=>cacheApi, getDocumentCache:()=>cacheApi };
const noLock={waitLock:()=>true,tryLock:()=>true,releaseLock:()=>{},hasLock:()=>true};
global.LockService={ getScriptLock:()=>noLock, getUserLock:()=>noLock, getDocumentLock:()=>noLock };
global.MailApp={sendEmail:()=>{}}; global.DriveApp={getFileById:()=>({addEditor:()=>{}})};
global.UrlFetchApp={fetch:()=>({getContentText:()=>'{}'})};
global.ScriptApp={getService:()=>({getUrl:()=>'local'}),newTrigger:()=>({timeBased:()=>({everyDays:()=>({atHour:()=>({create:()=>{}})}),everyHours:()=>({create:()=>{}})})}),getProjectTriggers:()=>[]};


// ── Подключение ──────────────────────────────────────────────────────
// Переходник ставит подделки в глобальную область, а логику подключает
// вызывающий: в браузере — тегом <script>, в тесте — через eval.
// Возвращаем хранилище, чтобы его можно было сохранить и загрузить.
if (typeof module!=='undefined' && module.exports) {
  module.exports = {
    DB: DB,
    SS: SS,
    // Всё содержимое магазина одной строкой — это и есть резервная копия.
    //
    // Даты помечаем особо. В текстовом файле дата неотличима от обычной
    // строки, а вся логика проверяет её через `instanceof Date`. Без
    // пометки копия загружалась «успешно», но операций в ней как будто
    // не было: выручка показывала ноль. Поймано тестом — на глаз такое
    // не увидеть, копия ведь создавалась без ошибок.
    dump: () => JSON.stringify(DB, function(k,v){
      return (this[k] instanceof Date) ? {__d:this[k].toISOString()} : v;
    }),
    // Загрузка копии ЗАМЕЩАЕТ данные целиком, а не досыпает к ним.
    // Иначе операции задвоились бы: та же смена записана дважды.
    //
    // Кэш чистим обязательно. Без этого экран ещё минуту показывал бы
    // цифры ДО загрузки, и человек решил бы, что копия не сработала,
    // и загрузил её второй раз. Поймано тестом.
    load: (json) => { const d=JSON.parse(json, (k,v)=>
        (v && typeof v==='object' && typeof v.__d==='string') ? new Date(v.__d) : v);
      Object.keys(DB).forEach(k=>delete DB[k]);
      Object.keys(d).forEach(k=>{DB[k]=d[k];});
      Object.keys(CACHE).forEach(k=>delete CACHE[k]); },
    // Один пользователь — он же владелец. Без этого проверки прав
    // отказывают ему в доступе к его собственным деньгам.
    beOwner: (email) => { try{ _setSetting(SS,'OWNER_EMAIL',email||'owner@local'); }catch(e){} }
  };
}

// Что видит человек, когда что-то ломается.
// Правило: никакого системного текста, внутренних адресов и id таблиц —
// человек за прилавком должен понять, что делать, а не пугаться.
var fs=require('fs'), path=require('path');
var h=fs.readFileSync(path.join(__dirname,'..','Index.html'),'utf8');
var m=h.match(/_friendlyErr:function\(m\)\{[\s\S]*?\n  \},/);
var App={}; eval('App={'+m[0]+'};');
var ok=0,fail=0;
function t(n,c,extra){if(c){ok++;console.log('  ✓ '+n);}else{fail++;console.log('  ✗ '+n+(extra?' → '+extra:''));}}

// Настоящие тексты ошибок Apps Script
var REAL=[
 'Exception: Service Spreadsheets failed while accessing document with id 1aB2c3D4eFgH',
 'GoogleJsonResponseException: API call to drive.files.get failed with error: File not found: 1x2Y3z',
 'Exception: Service invoked too many times for one day: urlfetch',
 'Exception: You do not have permission to call SpreadsheetApp.openById',
 'TypeError: Cannot read properties of undefined (reading getRange)',
 'Exception: Address unavailable: https://sheets.googleapis.com/v4/spreadsheets/1abc',
 'ScriptError: Authorization is required to perform that action',
 'Error: Timeout exceeded while waiting for lock'
];
REAL.forEach(function(raw){
  var out=App._friendlyErr(raw);
  var leaks = /Exception|TypeError|ScriptError|GoogleJson|https?:\/\/|SpreadsheetApp|urlfetch|[0-9a-zA-Z_-]{20,}/.test(out);
  t('не протекает: '+raw.slice(0,44)+'…', !leaks, out.slice(0,60));
});
// Наши русские сообщения показываются как есть — они понятные
t('своё русское сообщение сохраняется',
  App._friendlyErr('Нет прав на выплаты поставщикам')==='Нет прав на выплаты поставщикам');
// Длинное русское обрезается, а не занимает весь экран
var long='Очень длинное сообщение об ошибке. '.repeat(20);
t('длинное сообщение обрезается', App._friendlyErr(long).length<=161);
// Пустое/странное не даёт «undefined»
[null,undefined,'',0,{},[]].forEach(function(v){
  var o=App._friendlyErr(v);
  t('нет "undefined" при вводе '+JSON.stringify(v),
    typeof o==='string' && o.length>0 && !/undefined|null|\[object/.test(o), o);
});
// Объект ошибки, а не строка
t('принимает объект ошибки', App._friendlyErr(new Error('Нет связи с сервером')).length>0);
// Полезные подсказки на месте
t('про интернет подсказывает', /интернет/i.test(App._friendlyErr('network error')));
t('про занятость подсказывает', /повтори/i.test(App._friendlyErr('Timeout exceeded while waiting for lock')));

// В коде не осталось показа сырой ошибки
t('нигде не показывается сырой e.message', !/toast\(\w+\.message/.test(h));

console.log('\nСообщения об ошибках: '+ok+' passed, '+fail+' failed');
process.exit(fail?1:0);

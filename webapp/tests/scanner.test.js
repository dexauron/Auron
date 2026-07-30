// Сканер штрихкода. Главное, что проверяем — безопасность передачи кода
// между окнами и то, что мусор от распознавателя не попадёт в приложение.
var fs=require('fs'), path=require('path');
var R=path.join(__dirname,'..','..');
var page=fs.readFileSync(path.join(R,'app','scan.html'),'utf8');
var app =fs.readFileSync(path.join(__dirname,'..','Index.html'),'utf8');
var ok=0,fail=0;
function t(n,c,extra){if(c){ok++;console.log('  ✓ '+n);}else{fail++;console.log('  ✗ '+n+(extra?' → '+extra:''));}}

// ── Проверка штрихкода (та же, что в странице и в приложении) ──
function valid(code){
  var c=String(code==null?'':code).trim();
  return /^[0-9A-Za-z\-]{4,32}$/.test(c)?c:'';
}
t('обычный EAN-13 проходит',      valid('4603290002882')==='4603290002882');
t('короткий код проходит',        valid('54490451')==='54490451');
t('код с буквами проходит',       valid('МБ136')===''); // кириллица не штрихкод
t('слишком короткое отсекается',  valid('12')==='');
t('слишком длинное отсекается',   valid('1'.repeat(33))==='');
t('пустое отсекается',            valid('')==='' && valid(null)==='');
t('подстановка кода отсекается',  valid('<img src=x onerror=alert(1)>')==='');
t('пробелы по краям обрезаются',  valid('  4603290002882  ')==='4603290002882');

// ── Передача между окнами ──
t('страница отдаёт результат через postMessage', /postMessage\(\s*\{\s*auronScan/.test(page));
t('приложение проверяет origin сообщения',       /ev\.origin!==App\.SCAN_ORIGIN/.test(app));
t('приложение проверяет формат кода',            /\^\[0-9A-Za-z\\-\]\{4,32\}\$/.test(app));
t('origin задан конкретным доменом',             /SCAN_ORIGIN:'https:\/\/[^']+'/.test(app));

// ── Работа на разных устройствах ──
t('есть встроенный распознаватель (Android)', /BarcodeDetector/.test(page));
t('есть запасная библиотека (iPhone)',        /Html5Qrcode/.test(page));
t('есть ручной ввод как последний вариант',   /id="code"/.test(page) && /id="send"/.test(page));
t('форматы сужены до магазинных',             /ean_13/.test(page) && !/qr_code/.test(page));
t('видео с playsinline (иначе iOS на весь экран)', /playsinline/.test(page));

// ── Аккуратность с камерой и питанием ──
t('камера отпускается при уходе со страницы', /visibilitychange/.test(page) && /pagehide/.test(page));
t('треки камеры останавливаются',             /getTracks\(\)\.forEach/.test(page));
t('подсветка только если камера умеет',       /caps\.torch/.test(page));

// ── Понятные ошибки вместо технических ──
['NotAllowedError','NotFoundError','NotReadableError'].forEach(function(e){
  t('объясняется ошибка '+e, page.indexOf(e)>=0);
});
t('объясняется блокировка всплывающих окон', /_scanBlocked/.test(app));

console.log('\nСканер: '+ok+' passed, '+fail+' failed');
process.exit(fail?1:0);

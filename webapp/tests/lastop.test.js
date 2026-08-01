// «За период записей нет — последняя такого-то».
//
// Повод: владелец открыл приложение 1 августа, данные за июль, период
// стоял «Сегодня» — и все четыре карточки показали ноль. Он написал:
// «всё ещё выручку не посчитал из файла». Всё было на месте, просто он
// смотрел на пустой день.
var fs=require('fs'), path=require('path');
var code=fs.readFileSync(path.join(__dirname,'..','Code.gs'),'utf8');
var html=fs.readFileSync(path.join(__dirname,'..','Index.html'),'utf8');
var ok=0,fail=0;
function t(n,c,x){if(c){ok++;console.log('  ✓ '+n);}else{fail++;console.log('  ✗ '+n+(x!==undefined?' → '+JSON.stringify(x):''));}}

// ── Сервер отдаёт дату последней операции ───────────────────────────
var hs=code.slice(code.indexOf('function getHomeSummary('),
                  code.indexOf('function getHomeSummary(')+4000);
t('дата последней операции считается', /var lastMs=0;/.test(hs));
t('берётся по всей базе, а не за период',
  hs.indexOf('if(ms>lastMs')<hs.indexOf('if(pd.from&&ms<pd.from) return;'), 'порядок строк');
t('переводы между счетами не считаются операцией',
  /String\(r\[B_CAT-1\]\)!=='Перевод'/.test(hs));
t('отдаётся на экран', /lastOp: lastMs\?Utilities\.formatDate/.test(hs));
t('пустая база — пустая дата', /lastMs\?Utilities\.formatDate\(new Date\(lastMs\),tz,'yyyy-MM-dd'\):''/.test(hs));

// ── Экран показывает подсказку ──────────────────────────────────────
t('подсказка рисуется при загрузке главной', /App\._hintLastOp\(r\);/.test(html));
t('место под неё есть в разметке', html.indexOf('id="home-lastop"')>0);
t('подсказка прячется, если операции за период есть',
  /if\(cnt>0\|\|!last\)\{ box\.innerHTML=''; return; \}/.test(html));
t('в подсказке названа дата последней операции',
  html.indexOf('Последняя — <b>')>0);
t('кнопка открывает месяц последней операции', /App\.showMonthOf\(/.test(html));
t('месяц назван словом, а не 2026-07', /App\._monthName\(ym\)/.test(html));

// ── Период НЕ переключается молча ───────────────────────────────────
// Иначе человек смотрит на цифры и не понимает, за что они.
t('переключение только по нажатию', html.indexOf('showMonthOf:function')>0 &&
  !/_hintLastOp:function[\s\S]{0,900}App\.setPeriod\(/.test(html));

// ── Границы месяца считаются верно ──────────────────────────────────
function lastDay(ym){var y=+ym.slice(0,4),m=+ym.slice(5,7);return new Date(y,m,0).getDate();}
t('июль — 31 день', lastDay('2026-07')===31);
t('февраль 2026 — 28 дней', lastDay('2026-02')===28);
t('февраль 2028 — 29 дней (високосный)', lastDay('2028-02')===29);
t('декабрь — 31 день', lastDay('2026-12')===31);
t('день дополняется нулём', (function(){
  var l=lastDay('2026-02'); return '2026-02-'+(l<10?'0':'')+l==='2026-02-28';})());

console.log('\nПодсказка о последней операции: '+ok+' passed, '+fail+' failed');
process.exit(fail?1:0);

// Правка записей и корзина.
// Решение владельца: по умолчанию человек правит СВОЁ и только за
// СЕГОДНЯ; отдельным людям можно разрешить править всё, но след в
// журнале остаётся всегда. Удалённое лежит в корзине 30 дней.
var fs=require('fs'), path=require('path');
var code=fs.readFileSync(path.join(__dirname,'..','Code.gs'),'utf8');
var html=fs.readFileSync(path.join(__dirname,'..','Index.html'),'utf8');
var ok=0,fail=0;
function t(n,c,x){if(c){ok++;console.log('  ✓ '+n);}else{fail++;console.log('  ✗ '+n+(x?' → '+x:''));}}
function grab(name){
  var i=code.indexOf('function '+name+'(');
  if(i<0) throw new Error('нет функции '+name);
  var d=0,j=code.indexOf('{',i);
  for(var k=j;k<code.length;k++){ if(code[k]==='{')d++; else if(code[k]==='}'){d--; if(!d){j=k+1;break;}} }
  return code.slice(i,j);
}

// ── Правило «сегодня» ────────────────────────────────────────────────
eval(grab('_sameDay'));
var now=new Date();
t('сегодня — это сегодня', _sameDay(new Date(), now));
t('вчера — не сегодня',
  !_sameDay(new Date(now.getTime()-86400000), now));
t('тот же день другого года — не сегодня',
  !_sameDay(new Date(now.getFullYear()-1,now.getMonth(),now.getDate()), now));
t('пусто не ломает', !_sameDay(null, now));

// ── Кто может править ────────────────────────────────────────────────
var B_DATE=3;
var _canManageR=true, _meR='kassir@gmail.com', _freeR=[], _authorR='kassir@gmail.com', _lockR='';
function _canManage(){ return _canManageR; }
function _myEmail(){ return _meR; }
function _editFreeList(){ return _freeR; }
function _txAuthor(){ return _authorR; }
function _lockDeny(ss,row){
  if(!_lockR) return '';
  var d=row&&row[B_DATE-1];
  if(!(d instanceof Date) || d.getTime()>new Date(_lockR+'T23:59:59').getTime()) return '';
  return 'Период закрыт по '+_lockR+' — эту запись менять нельзя';
}
eval(grab('_txEditDeny'));
function deny(o){
  _canManageR=!!o.manage; _meR=o.me===undefined?'kassir@gmail.com':o.me;
  _freeR=o.free||[]; _authorR=o.author===undefined?'kassir@gmail.com':o.author;
  _lockR=o.lock||'';
  var row=[]; row[B_DATE-1]=o.date;
  return _txEditDeny({}, 'id1', row);
}
t('владелец правит что угодно', deny({manage:true,date:new Date(now-9*86400000)})==='');
t('кассир правит свою сегодняшнюю запись', deny({date:new Date()})==='');
t('кассир не правит свою вчерашнюю',
  /только записи за сегодня/i.test(deny({date:new Date(now.getTime()-86400000)})));
t('кассир не правит чужую сегодняшнюю',
  /не ваша запись/i.test(deny({date:new Date(),author:'other@gmail.com'})));
t('разрешение «править всё» снимает оба ограничения',
  deny({date:new Date(now.getTime()-40*86400000),author:'other@gmail.com',
        free:['kassir@gmail.com']})==='');
t('разрешение выдано другому — меня не касается',
  /не ваша запись/i.test(deny({date:new Date(),author:'other@gmail.com',
        free:['someone@gmail.com']})));
t('неизвестный автор + сегодня → можно (запись без следа в журнале)',
  deny({date:new Date(),author:''})==='');
t('неизвестный автор + вчера → нельзя',
  /только записи за сегодня/i.test(deny({date:new Date(now.getTime()-86400000),author:''})));
t('без даты не пропускаем', /только записи за сегодня/i.test(deny({date:null})));
// Fail-open по email: если Google не отдал почту, не запираем человека —
// то же правило, что у _isOwner. Иначе сбой Google = магазин стоит.
t('email не определился — не блокируем', deny({me:'',date:new Date(now-99*86400000)})==='');

// ── Закрытый период ──────────────────────────────────────────────────
// Так работают бухгалтерские программы: месяц закрыли — назад ходу нет.
// Замок должен быть СИЛЬНЕЕ всех прав, иначе он ничего не защищает.
function ymd(d){return d.toISOString().slice(0,10);}
var mid=new Date(now.getFullYear(),now.getMonth(),1);
t('владельца замок тоже останавливает',
  /Период закрыт/.test(deny({manage:true,lock:ymd(mid),date:new Date(mid.getTime()-86400000)})));
t('разрешение «править всё» замок не обходит',
  /Период закрыт/.test(deny({free:['kassir@gmail.com'],lock:ymd(mid),
    date:new Date(mid.getTime()-86400000)})));
t('после закрытой даты правка идёт как обычно',
  deny({manage:true,lock:ymd(mid),date:new Date()})==='');
t('день замка включительно',
  /Период закрыт/.test(deny({manage:true,lock:ymd(mid),date:new Date(mid.getFullYear(),mid.getMonth(),1,12,0)})));
t('без замка ничего не меняется', deny({manage:true,date:new Date(2000,0,1)})==='');
t('замок стоит первым в проверке', /var lk=_lockDeny\(ss,row\); if \(lk\) return lk;/.test(code));
t('ставит и снимает только владелец',
  /function setLockDate[\s\S]{0,400}Только владелец может это разрешить|function setLockDate[\s\S]{0,400}может только владелец/.test(code));
t('дата проверяется на формат', /\^\\d\{4\}-\\d\{2\}-\\d\{2\}\$/.test(code));
t('замок виден в настройках', /openLockDate:function/.test(html) && /Закрыть период/.test(html));
t('снятие замка пишется в журнал', /замок снят/.test(code));

// ── Правка на месте ──────────────────────────────────────────────────
// Раньше «Изменить» слало обычную запись с чужим номером: старая строка
// оставалась, и в журнале появлялся дубль расхода.
t('есть отдельная функция правки', /function updateTransaction\(/.test(code));
t('правка проверяет то же правило',
  /function updateTransaction[\s\S]{0,1200}_txEditDeny\(ss,id,row\)/.test(code));
t('правка уважает блокировку Z-отчётом',
  /function updateTransaction[\s\S]{0,1400}заблокирована Z-отчётом/.test(code));
t('в истории записи стоит «изменил», а не «удалил»',
  /_audit\(ss,'tx',id,'изменил'/.test(code));
t('перевод на месте не правится',
  /Перевод правится удалением и новой записью/.test(code));
t('фронт зовёт правку, а не новую запись',
  /gs\('updateTransaction',\{ssId:s\.ssId,id:editId/.test(html));
t('перевод фронт править не даёт',
  /Перевод правится так: удалить и записать заново/.test(html));

// ── Проверка стоит в удалении ────────────────────────────────────────
t('удаление проверяет правило, а не только manage',
  /function deleteTransaction[\s\S]{0,1600}_txEditDeny\(ss,id,row\)/.test(code));
t('отказ пишется в журнал отказов',
  /deny[\s\S]{0,80}_logDenied\(ss,'правка чужой записи'\)/.test(code));
t('блокировка Z-отчётом осталась',
  /function deleteTransaction[\s\S]{0,1900}заблокирована Z-отчётом/.test(code));
t('автор берётся из журнала действий',
  /function _txAuthor[\s\S]{0,500}==='создал'/.test(code));

// ── «Отменить» после своего удаления ─────────────────────────────────
t('свой откат за сегодня разрешён', /function _deletedByMeToday\(/.test(code));
t('восстановление больше не только для manage',
  /restoreTransaction[\s\S]{0,300}_deletedByMeToday\(_ss0,_id0\)/.test(code));

// ── Разрешение «править всё» ─────────────────────────────────────────
t('владелец может выдать разрешение', /function setMemberEditFree\(/.test(code));
t('выдаёт только владелец',
  /setMemberEditFree[\s\S]{0,300}Только владелец может это разрешить/.test(code));
t('разрешение видно в списке команды', /editFree:efree\.indexOf\(em\)>=0/.test(code));
t('переключатель есть на экране', /Может исправлять любые записи/.test(html));
t('владельцу объяснено про журнал', /видна в журнале действий/.test(html));

// ── Корзина 30 дней ──────────────────────────────────────────────────
t('автоочистка вызывается при открытии корзины',
  /function getTrash[\s\S]{0,300}_trashAutoClean\(_ss, p\.ssId\)/.test(code));
t('чистим не чаще раза в день', /TRASH_PURGED/.test(code));
t('порог — 30 дней', /cutoff\.setDate\(cutoff\.getDate\(\)-30\)/.test(code));
t('удаляем кусками, а не по строке', /function cleanTrash[\s\S]{0,700}_killRows\(sh, kill\)/.test(code));
t('видно, сколько дней осталось', /daysLeft:left/.test(code) && /Удалится навсегда через/.test(html));
t('последние дни подсвечены', /t\.daysLeft<=3\?'var\(--neg\)'/.test(html));

// ── Корзина: чего не хватало против Диска и Notion ───────────────────
t('видно, кто удалил', /TR_WHO/.test(code) && /удалил '\+App\._e\(t\.who\)/.test(html));
t('корзину можно очистить сразу', /function emptyTrash\(/.test(code));
t('очистить может только владелец',
  /function emptyTrash[\s\S]{0,300}Очистить корзину может только владелец/.test(code));
t('на очистку спрашивают подтверждение — вернуть будет нельзя',
  /_trashEmpty[\s\S]{0,300}confirm\(/.test(html));

// ── Приостановка доступа ─────────────────────────────────────────────
t('доступ можно приостановить, не удаляя человека',
  /function setMemberSuspended\(/.test(code));
t('приостановленный теряет ВСЕ права на сервере',
  /_suspendedList\(ss\)\.indexOf\(me\)>=0\) return \[\]/.test(code));
t('приостанавливает только владелец',
  /setMemberSuspended[\s\S]{0,300}может только владелец/.test(code));
t('видно, когда человек был в приложении', /function _lastSeenMap\(/.test(code));
t('в списке команды это показано', /доступ приостановлен/.test(html) && /был в приложении/.test(html));

// ── Замок должен закрывать ВСЕ входы, а не только правку ─────────────
// Иначе он бесполезен: месяц закрыт, а сумма в нём меняется — просто
// новой строкой или переносом даты.
t('новую запись задним числом не пропустят',
  /function saveQuickEntry[\s\S]{0,900}var lkNew=_lockDeny\(ss,newRow\)/.test(code));
t('перенести запись в закрытый период нельзя',
  /В закрытый период запись переносить нельзя/.test(code));
t('смену задним числом не записать',
  /Период закрыт — смену этой датой записать нельзя/.test(code));
t('текст отказа для новой записи переписан по-человечески',
  /записывать туда нельзя/.test(code));
// Кому можно править только сегодняшнее — тот не должен уносить расход
// во вчера, чтобы сегодняшняя касса «сошлась».
t('дату двигают только в пределах сегодня',
  /Дату можно менять только в пределах сегодняшнего дня/.test(code));
t('проверка новой даты идёт тем же правилом',
  /var denyMove=_txEditDeny\(ss,id,moved\)/.test(code));

console.log('\nПравка и корзина: '+ok+' passed, '+fail+' failed');
process.exit(fail?1:0);

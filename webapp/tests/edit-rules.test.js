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
var _canManageR=true, _meR='kassir@gmail.com', _freeR=[], _authorR='kassir@gmail.com';
function _canManage(){ return _canManageR; }
function _myEmail(){ return _meR; }
function _editFreeList(){ return _freeR; }
function _txAuthor(){ return _authorR; }
eval(grab('_txEditDeny'));
function deny(o){
  _canManageR=!!o.manage; _meR=o.me===undefined?'kassir@gmail.com':o.me;
  _freeR=o.free||[]; _authorR=o.author===undefined?'kassir@gmail.com':o.author;
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

console.log('\nПравка и корзина: '+ok+' passed, '+fail+' failed');
process.exit(fail?1:0);

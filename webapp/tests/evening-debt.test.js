// Вечер по каждому поставщику + сверка долга магазина + очистка формы.
// Решения владельца: бухгалтерия «лёгкая» — минута-две на закрытие дня,
// но ответ «кому и сколько я должен» должен быть; долг магазина
// правится не каждый день в кассе, а раз в месяц по факту, с историей.
var fs=require('fs'), path=require('path');
var code=fs.readFileSync(path.join(__dirname,'..','Code.gs'),'utf8');
var html=fs.readFileSync(path.join(__dirname,'..','Index.html'),'utf8');
var ok=0,fail=0;
function t(n,c,x){if(c){ok++;console.log('  ✓ '+n);}else{fail++;console.log('  ✗ '+n+(x?' → '+x:''));}}

// ── Форма кассового утра чистится после сохранения ───────────────────
// Раньше суммы оставались на экране: их либо стирали руками, либо
// записывали смену второй раз по тем же цифрам.
t('есть очистка формы', /_kClearMorning:function/.test(html));
t('чистится после успешной записи',
  /App\._kClearMorning\(\);\s*App\.s\.wyplatas=\[\]/.test(html));
t('чистятся все денежные поля утра',
  /_kClearMorning[\s\S]{0,400}kz-cash-rev[\s\S]{0,120}kz-cash-left/.test(html));
t('каналы безнала тоже', /_kClearMorning[\s\S]{0,500}querySelectorAll\('\.kz-ch'\)/.test(html));
t('дата, смена и кассир остаются — за день бывает две смены',
  !/_kClearMorning[\s\S]{0,500}k-cashier/.test(html));
t('сверка пересчитывается на пустых полях',
  /_kClearMorning[\s\S]{0,600}App\._kReconcile\(\)/.test(html));

// ── Вечер: строка на поставщика ──────────────────────────────────────
t('на сервере есть запись вечера', /function saveEveningInvoices\(/.test(code));
t('нужны права на приём товара',
  /function saveEveningInvoices[\s\S]{0,300}_permGuard\(ssId,'receive'\)/.test(code));
t('каждая строка — свой поставщик, долг персональный',
  /saveDebtEntry\(\{ssId:ssId,data:\{repId:rep,type:'zakupka'/.test(code));
t('погашение тоже персональное',
  /saveDebtEntry\(\{ssId:ssId,data:\{repId:rep,type:'oplata'/.test(code));
t('оплата наличными уходит расходом из кассы',
  /function saveEveningInvoices[\s\S]{0,1600}category:'Закупка'/.test(code));
t('пустые строки пропускаются, а не пишутся нулями',
  /if \(paid<=0 && repaid<=0 && debt<=0\) return;/.test(code));
t('строка без поставщика на сервер не уходит',
  /rows=\(p\.rows\|\|\[\]\)\.filter\(function\(r\)\{ return r && _s\(r\.rep\); \}\)/.test(code));
t('все строки пустые — честный отказ', /Все строки пустые/.test(code));
t('закрытый период вечер не пропустит',
  /Период закрыт — накладные этой датой записать нельзя/.test(code));
t('после записи возвращаются долги всех задействованных',
  /debts\[nm\]=\(debts\[nm\]\|\|0\)/.test(code));
t('долги считаются одним проходом по листу, а не по одному',
  /function saveEveningInvoices[\s\S]{0,2600}dsh\.getRange\(2,1,dsh\.getLastRow\(\)-1,D_COLS\)\.getValues\(\)\.forEach/.test(code));
t('дату записи долга можно задать', /var dDate=d\.date\?new Date\(d\.date\):new Date\(\);/.test(code));

// Экран
t('строки поставщиков на экране', /_ev:\[\]/.test(html) && /evRender:function/.test(html));
t('можно добавить и убрать строку',
  /evAddRow:function/.test(html) && /evDelRow:function/.test(html));
t('последняя строка не удаляется в ноль',
  /evDelRow[\s\S]{0,200}if\(!App\._ev\.length\)App\._ev=\[\{rep:''/.test(html));
// datalist заменён своим списком с умным поиском — см. search-modes.test.js
t('подсказка по названиям поставщиков', /evSuggest:function/.test(html));
t('итог показывает, сколько уйдёт из кассы', /уйдёт из кассы сегодня/.test(html));
t('в итоге видно три суммы отдельно',
  /Оплачено<b/.test(html) && /Погасили<b/.test(html) && /В долг<b/.test(html));
t('суммы в строках с разрядами', /_evCell:function/.test(html) && /App\._mfmt\(n\)/.test(html));
t('ноль не рисуем — пустая клетка честнее', /shown=\(String\(val\|\|''\)\.trim\(\)===''\)\?''/.test(html));
t('сумма без поставщика не сохранится', /У строки с суммой не указан поставщик/.test(html));
t('после записи форма очищается',
  /saveEvening[\s\S]{0,900}App\._ev=\[\{rep:'',paid:'',repaid:'',debt:''\}\];App\.evRender\(\)/.test(html));
t('в итоговом окне показан долг каждого', /Долг после записи/.test(html));
t('старых трёх общих полей больше нет',
  html.indexOf('id="ki-cash"')<0 && html.indexOf('calcInvoices')<0);

// ── Долг магазина: убран из кассы, живёт отдельно ────────────────────
t('в кассе плитки долга больше нет', html.indexOf('id="kh-debt"')<0);
t('наличные заняли всю ширину', /kh-money" style="grid-template-columns:1fr;"/.test(html));
t('есть отдельный экран долга', /editStoreDebt:function[\s\S]{0,300}'full'\)/.test(html));
t('вход из настроек', /Долг поставщикам и сверка/.test(html));
t('история долга на сервере', /function getStoreDebtHistory\(/.test(code));
t('история требует доступа к финансам',
  /function getStoreDebtHistory[\s\S]{0,120}_finGuard/.test(code));
t('в истории виден остаток до и после',
  /x\.before=run;/.test(code) && /x\.after=run;/.test(code));
t('ручные сверки помечены отдельно',
  /x\.manual = \/\^Сверка долга\|Ручная корректировка\/\.test\(x\.comment\)/.test(code));
t('новые записи сверху', /return \{items:rows\.reverse\(\), debt:cur\.debt/.test(code));
t('сверка пишет причину и автора в комментарий',
  /var note='Сверка долга: '\+cur\+' → '\+target/.test(code));
t('автор не лезет в служебный столбец смены',
  /Math\.abs\(diff\),new Date\(\),'',note,new Date\(\),'',''\]\);/.test(code));
t('отрицательный долг не принимается', /Долг не может быть отрицательным/.test(code));
t('совпало — ничего не пишем', /if \(diff===0\) return \{ok:true,debt:cur,same:true\}/.test(code));
t('сверка требует доступа к финансам',
  /function setStoreDebt[\s\S]{0,120}_finGuard/.test(code));
t('сверка пишется в журнал', /Сверка долга магазина/.test(code));

console.log('\nВечер и долг магазина: '+ok+' passed, '+fail+' failed');
process.exit(fail?1:0);
